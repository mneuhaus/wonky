import {THREE, OrbitControls, GLTFLoader} from './vendor/three-bundle.js';
const K=['onshape','wonky-rust','occt'];
const COLORS={'wonky-rust':'#2e699d',onshape:'#c9825e',occt:'#198257'};
const loader=new GLTFLoader();
const camera=new THREE.PerspectiveCamera(42,1,.00001,20000);
camera.up.set(0,0,1);
const direction=new THREE.Vector3(1.45,-1.75,1.25).normalize();
let manifest,dialog,stages=new Map(),generation=0,frame=false,center=new THREE.Vector3();
function shade(object,kernel){
  const previousMaterials=new Set();
  object.traverse(child=>{
    if(child.isMesh){if(child.material)previousMaterials.add(child.material);child.material=new THREE.MeshStandardMaterial({color:COLORS[kernel],roughness:.94,metalness:0,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1});}
    if(child.isLine||child.isLineSegments){if(child.material)previousMaterials.add(child.material);child.material=new THREE.LineBasicMaterial({color:0x263e44,depthTest:true,depthWrite:false});child.renderOrder=1;}
  });
  for(const material of previousMaterials)for(const entry of Array.isArray(material)?material:[material])entry.dispose();
  return object;
}
function lighting(scene){
  scene.add(new THREE.HemisphereLight(0xffffff,0xe0e8e7,2.0));
  const key=new THREE.DirectionalLight(0xffffff,1.7),fill=new THREE.DirectionalLight(0xffffff,.5);
  scene.add(key,fill);return {key,fill};
}
function updateLights(stage){
  // Lights follow the camera, not the CAD coordinate system: orbiting never moves a highlight.
  const forward=new THREE.Vector3().subVectors(camera.position,center).normalize();
  const side=new THREE.Vector3().crossVectors(forward,camera.up).normalize();
  const up=new THREE.Vector3().crossVectors(side,forward).normalize();
  stage.key.position.copy(center).addScaledVector(forward,100).addScaledVector(side,70).addScaledVector(up,90);
  stage.fill.position.copy(center).addScaledVector(forward,60).addScaledVector(side,-90).addScaledVector(up,20);
}
function render(){
  if(frame)return;frame=true;
  requestAnimationFrame(()=>{frame=false;for(const stage of stages.values()){
    const {canvas,renderer,scene}=stage,w=canvas.clientWidth,h=canvas.clientHeight;
    if(!w||!h)continue;
    renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();
    updateLights(stage);renderer.render(scene,camera);
  }});
}
function setup(panel,kernel){
  const existing=stages.get(kernel);
  if(existing){
    const target=panel.querySelector('canvas');
    if(target!==existing.canvas){
      if(target)target.replaceWith(existing.canvas);
      else panel.querySelector('.canvas-wrap').prepend(existing.canvas);
    }
    return;
  }
  const canvas=panel.querySelector('canvas');
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:'low-power',preserveDrawingBuffer:false});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.75));
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;
  const scene=new THREE.Scene(),lights=lighting(scene);
  const controls=new OrbitControls(camera,canvas);
  controls.enableDamping=false;controls.screenSpacePanning=true;controls.target.copy(center);
  controls.addEventListener('change',()=>{
    center.copy(controls.target);
    for(const s of stages.values())if(s.controls!==controls)s.controls.target.copy(center);
    render();
  });
  stages.set(kernel,{canvas,renderer,scene,controls,...lights,model:null});
}
function dispose(object){
  object?.traverse(child=>{child.geometry?.dispose();if(child.material){for(const m of Array.isArray(child.material)?child.material:[child.material])m.dispose()}});
  object?.parent?.remove(object);
}
function clearModels(){
  generation++;
  for(const stage of stages.values()){dispose(stage.model);stage.model=null}
  render();
}
function boundsOf(zone){
  const box=new THREE.Box3();
  for(const k of K){const b=manifest.zones[zone].kernels[k].boundsMm;if(b)box.union(new THREE.Box3(new THREE.Vector3(...b[0]),new THREE.Vector3(...b[1])))}
  return box;
}
function fit(box){
  if(box.isEmpty())return;
  const radius=Math.max(box.getSize(new THREE.Vector3()).length()/2,.01);
  const aspect=Math.min(...[...stages.values()].map(s=>s.canvas.clientWidth/Math.max(s.canvas.clientHeight,1)));
  const fov=THREE.MathUtils.degToRad(camera.fov),horizontal=2*Math.atan(Math.tan(fov/2)*aspect);
  const distance=radius/Math.sin(Math.min(fov,horizontal)/2)*1.28;
  center=box.getCenter(new THREE.Vector3());
  camera.position.copy(center).addScaledVector(direction,distance);camera.lookAt(center);
  camera.near=Math.max(distance/10000,.00001);camera.far=Math.max(distance+8*radius,camera.near*100);
  for(const stage of stages.values()){
    stage.controls.target.copy(center);stage.controls.minDistance=Math.max(radius*.025,.0001);
    stage.controls.maxDistance=distance*30;
  }
  render();
}
async function open(zone){
  if(!manifest?.zones?.[zone])return;
  if(dialog?.open)dialog.close();
  clearModels();
  dialog=document.getElementById(`zone-${zone}`);
  dialog.showModal();
  const run=++generation;
  for(const k of K)setup(dialog.querySelector(`[data-kernel="${k}"]`),k);
  fit(boundsOf(zone));
  for(const k of K){
    const data=manifest.zones[zone].kernels[k];
    if(!data.mesh)continue;
    loader.load(`./${data.mesh}`,gltf=>{
      if(run!==generation){dispose(gltf.scene);return}
      shade(gltf.scene,k);
      const stage=stages.get(k);
      stage.model=gltf.scene;stage.scene.add(gltf.scene);
      dialog.querySelector(`[data-kernel="${k}"] .placeholder`).classList.add('hidden');
      render();
    },undefined,()=>{
      if(run===generation)dialog.querySelector(`[data-kernel="${k}"] .placeholder`).textContent='Mesh unavailable. Reload this page.';
    });
  }
}
function linkedZone(){return location.hash.slice(1).toUpperCase().replace(/^ZONE-(?:WONKY-RUST-|ONSHAPE-|OCCT-)?/, '')}
function fromHash(){
  const z=linkedZone();
  if(manifest?.zones?.[z])void open(z);
  else if(dialog?.open)dialog.close();
}
function navigate(delta){
  if(!dialog?.open)return;
  const ids=Object.keys(manifest.zones),now=dialog.dataset.zone;
  location.hash=ids[(ids.indexOf(now)+delta+ids.length)%ids.length];
}
document.addEventListener('click',e=>{
  if(e.target.closest('.close'))dialog?.close();
  if(e.target.closest('.prev'))navigate(-1);
  if(e.target.closest('.next'))navigate(1);
  if(e.target.closest('.fit')&&dialog)fit(boundsOf(dialog.dataset.zone));
});
document.addEventListener('keydown',e=>{
  if(!dialog?.open||e.altKey||e.metaKey||e.ctrlKey)return;
  if(e.key==='ArrowLeft')navigate(-1);
  if(e.key==='ArrowRight')navigate(1);
});
document.addEventListener('close',e=>{
  if(!e.target.classList?.contains('zone-modal')||e.target!==dialog)return;
  clearModels();
  if(linkedZone()===e.target.dataset.zone)history.replaceState(null,'',location.pathname+location.search);
},true);
window.addEventListener('hashchange',fromHash);
window.addEventListener('resize',render);
for(const input of document.querySelectorAll('[data-filter]'))input.addEventListener('change',()=>{
  const k=input.dataset.filter;
  const shown=new Set([...document.querySelectorAll(`[data-filter="${k}"]:checked`)].map(el=>el.value));
  for(const tile of document.querySelectorAll(`[data-grid="${k}"] .tile`))tile.hidden=!shown.has(tile.dataset.verdict);
});
// Build-time thumbnail path uses exactly the modal shaders, mesh and lights. Never used on normal visits.
window.renderAcidThumbnail=async function(k,z){
  const data=manifest.zones[z].kernels[k];if(!data.mesh)return null;
  const w=250,h=160,canvas=document.createElement('canvas');
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true,alpha:true});
  renderer.setSize(w,h);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;
  const scene=new THREE.Scene(),lights=lighting(scene);
  const model=shade((await loader.loadAsync('./'+data.mesh)).scene,k);scene.add(model);
  const box=boundsOf(z),size=box.getSize(new THREE.Vector3()),radius=Math.max(size.length()/2,.01);
  const target=box.getCenter(new THREE.Vector3());
  const cam=new THREE.PerspectiveCamera(42,w/h,0.1,1000);cam.up.set(0,0,1);
  const distance=radius/Math.sin(THREE.MathUtils.degToRad(cam.fov/2))*1.28;
  cam.near=Math.max(distance/10000,.00001);cam.far=Math.max(distance+8*radius,cam.near*100);
  cam.position.copy(target).addScaledVector(direction,distance);cam.lookAt(target);
  const forward=new THREE.Vector3().subVectors(cam.position,target).normalize();
  const side=new THREE.Vector3().crossVectors(forward,cam.up).normalize();
  const up=new THREE.Vector3().crossVectors(side,forward).normalize();
  lights.key.position.copy(target).addScaledVector(forward,100).addScaledVector(side,70).addScaledVector(up,90);
  lights.fill.position.copy(target).addScaledVector(forward,60).addScaledVector(side,-90).addScaledVector(up,20);
  renderer.render(scene,cam);
  const image=canvas.toDataURL('image/png');dispose(model);renderer.dispose();renderer.forceContextLoss();return image;
};
try{
  const response=await fetch('./manifest.json');if(!response.ok)throw Error('Manifest fetch failed');
  manifest=await response.json();
  fromHash();
}catch(e){console.error('Status viewer initialization failed',e);document.querySelector('.hero p:not(.eyebrow)').textContent='3D preview unavailable; reload this page.'}
