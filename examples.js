import {THREE, OrbitControls, GLTFLoader} from './vendor/three-bundle.js';
const loader=new GLTFLoader();
for(const card of document.querySelectorAll('[data-example]')){
  const canvas=card.querySelector('canvas');
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:'low-power'});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.75));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.NoToneMapping;
  const scene=new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff,0xe0e8e7,2));
  const key=new THREE.DirectionalLight(0xffffff,1.7),fill=new THREE.DirectionalLight(0xffffff,.5);
  scene.add(key,fill);
  const camera=new THREE.PerspectiveCamera(42,1,.01,10000);
  camera.up.set(0,0,1);
  const controls=new OrbitControls(camera,canvas);
  controls.enableDamping=false;
  controls.screenSpacePanning=true;
  const draw=()=>{
    const w=canvas.clientWidth,h=canvas.clientHeight;
    if(!w||!h)return;
    renderer.setSize(w,h,false);
    camera.aspect=w/h;camera.updateProjectionMatrix();
    const f=new THREE.Vector3().subVectors(camera.position,controls.target).normalize();
    const side=new THREE.Vector3().crossVectors(f,camera.up).normalize();
    const up=new THREE.Vector3().crossVectors(side,f).normalize();
    key.position.copy(controls.target).addScaledVector(f,100).addScaledVector(side,70).addScaledVector(up,90);
    fill.position.copy(controls.target).addScaledVector(f,60).addScaledVector(side,-90).addScaledVector(up,20);
    renderer.render(scene,camera);
  };
  controls.addEventListener('change',draw);
  new ResizeObserver(draw).observe(card);
  loader.load(`./examples/models/${card.dataset.example}.glb`,model=>{
    model.scene.traverse(child=>{
      if(child.isMesh)child.material=new THREE.MeshStandardMaterial({color:0x2e699d,roughness:.94,metalness:0,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1});
      if(child.isLine||child.isLineSegments){child.material=new THREE.LineBasicMaterial({color:0x263e44,depthWrite:false});child.renderOrder=1}
    });
    scene.add(model.scene);
    const box=new THREE.Box3().setFromObject(model.scene);
    const size=box.getSize(new THREE.Vector3());
    const radius=size.length()/2;
    controls.target.copy(box.getCenter(new THREE.Vector3()));
    const direction=new THREE.Vector3(1.45,-1.75,1.25).normalize();
    const fov=THREE.MathUtils.degToRad(camera.fov);
    const aspect=canvas.clientWidth/Math.max(canvas.clientHeight,1);
    const horizontal=2*Math.atan(Math.tan(fov/2)*aspect);
    camera.position.copy(controls.target).addScaledVector(direction,radius/Math.sin(Math.min(fov,horizontal)/2)*1.28);
    camera.lookAt(controls.target);
    camera.far=radius*100;camera.updateProjectionMatrix();
    card.querySelector('.example-loading').hidden=true;
    draw();
  },undefined,()=>{card.querySelector('.example-loading').textContent='3D preview unavailable; download the STEP model instead.'});
}
