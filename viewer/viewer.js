import { THREE, OrbitControls, GLTFLoader } from './vendor/three-bundle.js';

const KERNELS = ['onshape', 'wonky-rust', 'occt'];
const COLORS = { 'wonky-rust': '#2e699d', onshape: '#c9825e', occt: '#198257' };
const panels = new Map(KERNELS.map(kernel => [kernel, document.querySelector(`[data-kernel="${kernel}"]`)]));
const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 20000);
camera.up.set(0, 0, 1);
const direction = new THREE.Vector3(1.45, -1.75, 1.25).normalize();
const loader = new GLTFLoader();
const stages = new Map();
let manifest;
let zones;
let selected;
let requestId = 0;
let pendingFrame = false;
let cameraTarget = new THREE.Vector3();

function requestRender() {
  if (pendingFrame) return;
  pendingFrame = true;
  requestAnimationFrame(() => {
    pendingFrame = false;
    for (const { renderer, scene, canvas } of stages.values()) {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width || !height) continue;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      const forward = new THREE.Vector3().subVectors(camera.position, cameraTarget).normalize();
      const side = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
      const up = new THREE.Vector3().crossVectors(side, forward).normalize();
      const stage = [...stages.values()].find(s => s.renderer === renderer);
      stage.key.position.copy(cameraTarget).addScaledVector(forward,100).addScaledVector(side,70).addScaledVector(up,90);
      stage.fill.position.copy(cameraTarget).addScaledVector(forward,60).addScaledVector(side,-90).addScaledVector(up,20);
      renderer.render(scene, camera);
    }
  });
}

function makeStage(kernel) {
  const panel = panels.get(kernel);
  const canvas = panel.querySelector('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xe0e8e7, 2));
  const key = new THREE.DirectionalLight(0xffffff, 1.7);
  key.position.set(1.8, -2.2, 3.1);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, .5);
  fill.position.set(-2.5, 1.6, 1.2);
  scene.add(fill);
  const control = new OrbitControls(camera, canvas);
  control.enableDamping = false;
  control.screenSpacePanning = true;
  control.target.copy(cameraTarget);
  control.addEventListener('change', () => {
    cameraTarget.copy(control.target);
    for (const stage of stages.values()) {
      if (stage.control !== control) stage.control.target.copy(cameraTarget);
    }
    requestRender();
  });
  stages.set(kernel, { renderer, scene, canvas, control, key, fill, model: null, grid: null });
}

function disposeObject(object) {
  if (!object) return;
  object.traverse(child => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) material.dispose();
    }
  });
  object.parent?.remove(object);
}

function clearStage(stage) {
  disposeObject(stage.model);
  disposeObject(stage.grid);
  stage.model = null;
  stage.grid = null;
}

function setPanel(kernel, caseData, message) {
  const panel = panels.get(kernel);
  const badge = panel.querySelector('.verdict');
  badge.textContent = caseData.verdict;
  badge.className = `verdict ${caseData.verdict.toLowerCase()}`;
  badge.setAttribute('aria-label', `Four-variant verdict: ${caseData.verdict}`);
  panel.querySelector('.reason').textContent = [
    caseData.v0Verdict !== caseData.verdict ? `V0: ${caseData.v0Verdict}.` : '',
    caseData.reason, caseData.displayNote || ''
  ].filter(Boolean).join(' ');
  const placeholder = panel.querySelector('.placeholder');
  placeholder.textContent = message;
  placeholder.classList.toggle('hidden', !message);
}

function drawGrid(bounds) {
  const size = new THREE.Vector3().subVectors(bounds.max, bounds.min);
  const diagonal = Math.max(size.length(), 1);
  const spacing = 10 ** Math.floor(Math.log10(diagonal / 5));
  const extent = Math.max(10, Math.ceil(diagonal / spacing) * spacing);
  for (const stage of stages.values()) {
    const grid = new THREE.GridHelper(extent * 2, Math.max(2, Math.round(extent * 2 / spacing)), 0xa9bdc9, 0xdce7ec);
    grid.rotation.x = Math.PI / 2;
    grid.position.set(bounds.getCenter(new THREE.Vector3()).x, bounds.getCenter(new THREE.Vector3()).y,
      bounds.min.z - Math.max(diagonal * .075, .1));
    grid.material.transparent = true;
    grid.material.opacity = .37;
    grid.material.depthWrite = false;
    stage.grid = grid;
    stage.scene.add(grid);
  }
}

function fitAll(bounds) {
  if (bounds.isEmpty()) return;
  const size = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(size.length() / 2, .01);
  const narrowestAspect = Math.min(...Array.from(stages.values(), s => s.canvas.clientWidth / Math.max(s.canvas.clientHeight, 1)));
  const vertical = THREE.MathUtils.degToRad(camera.fov);
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * narrowestAspect);
  const distance = radius / Math.sin(Math.min(vertical, horizontal) / 2) * 1.28;
  cameraTarget = bounds.getCenter(new THREE.Vector3());
  camera.position.copy(cameraTarget).addScaledVector(direction, distance);
  camera.near = Math.max(distance / 10000, 0.00001);
  camera.far = Math.max(distance + 8 * radius, camera.near * 100);
  camera.updateProjectionMatrix();
  for (const { control } of stages.values()) {
    control.target.copy(cameraTarget);
    control.minDistance = Math.max(radius * .025, .0001);
    control.maxDistance = distance * 30;
    control.update();
  }
  requestRender();
}

async function selectZone(zone) {
  if (!manifest?.zones[zone]) return;
  selected = zone;
  const run = ++requestId;
  const record = manifest.zones[zone];
  document.getElementById('zone-id').textContent = zone;
  document.getElementById('zone-title').textContent = record.title;
  document.getElementById('position').textContent = `${String(zones.indexOf(zone) + 1).padStart(2, '0')} / ${zones.length}`;
  document.querySelectorAll('.zone-button').forEach(button => {
    const active = button.dataset.zone === zone;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  });
  document.querySelector('.zone-button.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  for (const kernel of KERNELS) {
    const stage = stages.get(kernel);
    clearStage(stage);
    const c = record.kernels[kernel];
    setPanel(kernel, c, c.mesh ? 'Loading geometry…' : c.reason);
  }
  requestRender();
  const union = new THREE.Box3();
  const loads = KERNELS.map(async kernel => {
    const c = record.kernels[kernel];
    if (!c.mesh) return;
    try {
      const gltf = await loader.loadAsync(`./${c.mesh}`);
      if (run !== requestId) { disposeObject(gltf.scene); return; }
      gltf.scene.traverse(child => {
        if (child.isLine || child.isLineSegments) { child.material = new THREE.LineBasicMaterial({ color: 0x263e44, depthWrite: false }); child.renderOrder = 1; return; }
        if (!child.isMesh) return;
        child.material = new THREE.MeshStandardMaterial({ color: COLORS[kernel], roughness: .94, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
          side: THREE.DoubleSide });
      });
      stages.get(kernel).model = gltf.scene;
      stages.get(kernel).scene.add(gltf.scene);
      union.expandByObject(gltf.scene);
      setPanel(kernel, c, '');
    } catch {
      if (run === requestId) setPanel(kernel, c, 'Mesh could not be loaded. Check the local file or reload.');
    }
  });
  await Promise.all(loads);
  if (run !== requestId) return;
  if (!union.isEmpty()) {
    fitAll(union);
  }
  requestRender();
}

function zoneFromHash() {
  const requested = decodeURIComponent(location.hash.slice(1)).toUpperCase();
  return zones.includes(requested) ? requested : zones[0];
}

function navigate(delta) {
  if (!zones) return;
  location.hash = zones[(zones.indexOf(selected) + delta + zones.length) % zones.length];
}

async function main() {
  try {
    const response = await fetch('./manifest.json');
    if (!response.ok) throw new Error('Manifest unavailable');
    manifest = await response.json();
    zones = Object.keys(manifest.zones);
    document.getElementById('revision').textContent = manifest.revision.slice(0, 12);
    document.getElementById('zone-count').textContent = zones.length;
    for (const zone of zones) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'zone-button';
      if (manifest.zones[zone].kernels['wonky-rust'].verdict === 'DISPUTED') button.classList.add('disputed');
      button.dataset.zone = zone;
      button.title = `${zone}: ${manifest.zones[zone].title}`;
      button.textContent = zone;
      const marker = document.createElement('span');
      marker.className = 'marker';
      marker.setAttribute('aria-hidden', 'true');
      button.append(marker);
      button.addEventListener('click', () => { location.hash = zone; });
      document.getElementById('zone-list').append(button);
    }
    for (const kernel of KERNELS) makeStage(kernel);
    const resize = new ResizeObserver(requestRender);
    for (const { canvas } of stages.values()) resize.observe(canvas.parentElement);
    window.addEventListener('hashchange', () => { void selectZone(zoneFromHash()); });
    document.getElementById('fit-button').addEventListener('click', () => {
      const bounds = new THREE.Box3();
      for (const { model } of stages.values()) if (model) bounds.expandByObject(model);
      fitAll(bounds);
    });
    document.getElementById('prev-button').addEventListener('click', () => navigate(-1));
    document.getElementById('next-button').addEventListener('click', () => navigate(1));
    document.addEventListener('keydown', event => {
      if (event.altKey || event.ctrlKey || event.metaKey || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
      if (event.key === 'ArrowLeft') navigate(-1);
      if (event.key === 'ArrowRight') navigate(1);
    });
    await selectZone(zoneFromHash());
  } catch (error) {
    document.getElementById('zone-title').textContent = 'Viewer unavailable';
    for (const panel of panels.values()) panel.querySelector('.placeholder').textContent = 'Viewer initialization failed. Reload this page.';
    console.error('Viewer initialization failed', error);
  }
}

void main();
