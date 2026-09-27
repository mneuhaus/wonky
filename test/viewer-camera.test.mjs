// Camera convention 2 (viewer/render/camera.js, spec 7.1): right-handed
// basis, standard views, projection/matrix agreement, legacy conversion,
// zoom to cursor, physical limits, pitch clamp and fit.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as camera from '../viewer/render/camera.js';
import { computePanes, legacyDrawing, mirrorLegacyPoint } from '../viewer/render/panes.js';

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const determinant = ({ right, up, toward }) => dot(cross(right, up), toward);
const near = (actual, expected, tolerance, message) => assert.ok(
  Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);

function randomSource(seed) {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648;
    return value / 2147483648;
  };
}

const bracket = { min: [0, 0, 0], max: [50, 40, 8] };
const pane = { x: 0, y: 0, width: 1000, height: 600 };

test('the frozen API exists and cameras are convention 2', () => {
  for (const name of ['defaultCamera', 'viewProjection', 'project', 'unproject', 'basis',
    'lookFrom', 'preset', 'fit', 'depthPerPixel', 'fromLegacy', 'toLegacy']) {
    assert.equal(typeof camera[name], 'function', name);
  }
  const view = camera.defaultCamera(bracket);
  assert.equal(view.convention, 2);
  assert.equal(view.projection, 'orthographic');
  assert.deepEqual(view.target, [25, 20, 4]);
  assert.deepEqual([view.yaw, view.pitch], camera.PRESETS.iso);
  assert.equal(view.height, 50 / 0.67, 'without a pane: the legacy fit');
});

test('the basis is right-handed for every preset and 100 random angles', () => {
  const view = camera.defaultCamera(bracket);
  for (const name of camera.PRESET_NAMES) {
    near(determinant(camera.basis(camera.preset(name, view))), 1, 1e-12, name);
  }
  const random = randomSource(11);
  for (let i = 0; i < 100; i++) {
    const oriented = { ...view, yaw: random() * 40 - 20, pitch: random() * Math.PI - Math.PI / 2 };
    const frame = camera.basis(oriented);
    near(determinant(frame), 1, 1e-12, `random ${i}`);
    near(dot(frame.right, frame.up), 0, 1e-12, 'orthogonal');
  }
});

test('standard views look from Onshape/OCP directions; Top shows +X right and +Y up', () => {
  const view = camera.defaultCamera(bracket, pane);
  const expected = {
    front: [0, -1, 0], back: [0, 1, 0], left: [-1, 0, 0], right: [1, 0, 0],
    top: [0, 0, 1], bottom: [0, 0, -1],
    iso: [1 / Math.sqrt(3), -1 / Math.sqrt(3), 1 / Math.sqrt(3)],
  };
  for (const [name, direction] of Object.entries(expected)) {
    const { toward } = camera.basis(camera.preset(name, view));
    toward.forEach((value, axis) => near(value, direction[axis], 1e-12, `${name} toward`));
  }
  const top = camera.preset('top', view);
  const origin = camera.project([0, 0, 0], top, pane);
  const plusX = camera.project([10, 0, 0], top, pane);
  const plusY = camera.project([0, 10, 0], top, pane);
  assert.ok(plusX.x > origin.x + 1 && Math.abs(plusX.y - origin.y) < 1e-9, '+X right');
  assert.ok(plusY.y < origin.y - 1 && Math.abs(plusY.x - origin.x) < 1e-9, '+Y up');
  // The bracket L: (50, 0) lower right, (0, 40) upper left, the notch upper right.
  const foot = camera.project([50, 0, 8], top, pane);
  const post = camera.project([0, 40, 8], top, pane);
  assert.ok(foot.x > post.x && foot.y > post.y, 'L upright, not Γ');
  // Front looks from -Y: the -Y face is nearer than the +Y face.
  const front = camera.preset('front', view);
  assert.ok(camera.project([25, 0, 4], front, pane).depth
    > camera.project([25, 40, 4], front, pane).depth, 'front shows the -Y side');
  const plusZ = camera.project([0, 0, 10], front, pane);
  const frontOrigin = camera.project([0, 0, 0], front, pane);
  assert.ok(plusZ.y < frontOrigin.y, '+Z up in front');
  assert.ok(camera.project([10, 0, 0], front, pane).x > frontOrigin.x, '+X right in front');
  const bottom = camera.preset('bottom', view);
  assert.ok(camera.project([10, 0, 0], bottom, pane).x > camera.project([0, 0, 0], bottom, pane).x,
    '+X right in bottom');
  assert.equal(camera.presetOf(top), 'top');
  assert.equal(camera.presetOf(camera.orbit(top, 0.1, 0)), null);
  assert.throws(() => camera.preset('sideways', view), /Unknown view preset/);
});

test('lookFrom inverts basis, keeps target and height, and resolves the poles with up', () => {
  const view = { ...camera.defaultCamera(bracket, pane), height: 12.5, target: [1, 2, 3] };
  const random = randomSource(3);
  for (let i = 0; i < 50; i++) {
    const oriented = { ...view, yaw: random() * 6 - 3, pitch: random() * 3 - 1.5 };
    const { toward } = camera.basis(oriented);
    const again = camera.lookFrom(toward, [0, 0, 1], oriented);
    near(Math.sin(again.yaw - oriented.yaw), 0, 1e-9, 'yaw');
    near(Math.cos(again.yaw - oriented.yaw), 1, 1e-9, 'yaw');
    near(again.pitch, oriented.pitch, 1e-9, 'pitch');
    assert.deepEqual(again.target, view.target);
    assert.equal(again.height, 12.5);
  }
  const top = camera.lookFrom([0, 0, 1], [0, 1, 0], view);
  camera.basis(top).up.forEach((value, axis) => near(value, [0, 1, 0][axis], 1e-12, 'top up'));
  const rotated = camera.lookFrom([0, 0, 1], [1, 0, 0], view);
  camera.basis(rotated).up.forEach((value, axis) => near(value, [1, 0, 0][axis], 1e-12, 'up X'));
});

test('project, unproject and the shader matrix agree (ortho and perspective)', () => {
  const random = randomSource(7);
  for (let i = 0; i < 100; i++) {
    const layout = ['single', 'wipe', 'side-by-side'][i % 3];
    const panes = computePanes({
      width: 1000, height: 600, compare: layout !== 'single', layout,
      split: 0.3, before: 'a', after: 'b',
    });
    const bounds = { min: [-50 - random() * 50, -40, -5], max: [60, 45 + random() * 20, 30] };
    const view = {
      convention: 2, projection: i % 2 ? 'perspective' : 'orthographic',
      target: [random() * 40 - 20, random() * 40 - 20, random() * 20],
      yaw: random() * 12 - 6, pitch: random() * Math.PI - Math.PI / 2, height: 60 + random() * 300,
    };
    const relativeTo = [random() * 100, random() * 100, random() * 10];
    const point = [random() * 100 - 50, random() * 80 - 40, random() * 30 - 5];
    for (const item of panes) {
      const screen = camera.project(point, view, item, bounds);
      const back = camera.unproject(screen.x, screen.y, screen.depth, view, item, bounds);
      back.forEach((value, axis) => near(value, point[axis], 1e-7, 'unproject inverts project'));
      const matrix = camera.viewProjection(view, item, bounds, { relativeTo });
      const relative = point.map((value, axis) => value - relativeTo[axis]);
      const clip = [0, 1, 2, 3].map(row => matrix[row] * relative[0] + matrix[4 + row]
        * relative[1] + matrix[8 + row] * relative[2] + matrix[12 + row]);
      const screenX = item.x + (clip[0] / clip[3] + 1) / 2 * item.width;
      const screenY = item.y + (1 - clip[1] / clip[3]) / 2 * item.height;
      near(screenX, screen.x, 1e-6, 'renderer and picker agree in x (px)');
      near(screenY, screen.y, 1e-6, 'renderer and picker agree in y (px)');
      const depth = clip[2] / clip[3];
      assert.ok(depth > -1 && depth < 1, `inside the depth window (${view.projection})`);
    }
  }
});

test('nearer points get smaller clip depth; the window follows the bounds sphere', () => {
  const view = camera.preset('front', camera.defaultCamera(bracket, pane));
  for (const projection of ['orthographic', 'perspective']) {
    const oriented = { ...view, projection };
    const matrix = camera.viewProjection(oriented, pane, bracket);
    const clipDepth = point => {
      const z = matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14];
      const w = matrix[3] * point[0] + matrix[7] * point[1] + matrix[11] * point[2] + matrix[15];
      return z / w;
    };
    assert.ok(clipDepth([25, 0, 4]) < clipDepth([25, 40, 4]), projection);
    const corners = [[0, 0, 0], [50, 40, 8], [0, 40, 8], [50, 0, 0]];
    for (const corner of corners) assert.ok(Math.abs(clipDepth(corner)) < 1, projection);
  }
});

test('fromLegacy keeps the eye direction, mirrors X about the pane center, round-trips', () => {
  const random = randomSource(5);
  for (let i = 0; i < 100; i++) {
    const legacy = {
      yaw: random() * 12 - 6, pitch: random() * 6 - 3, zoom: 0.05 + random() * 20,
      pan: [random() - 0.5, random() - 0.5],
    };
    const frame = { center: [random() * 200 - 100, random() * 200 - 100, random() * 50],
      extent: 1 + random() * 300 };
    const view = camera.fromLegacy(legacy, frame);
    assert.equal(view.convention, 2);
    const back = camera.toLegacy(view, frame);
    for (const key of ['yaw', 'pitch', 'zoom']) near(back[key], legacy[key], 1e-9, key);
    back.pan.forEach((value, axis) => near(value, legacy.pan[axis], 1e-9, 'pan'));
    // Same eye direction as the legacy view.
    const cp = Math.cos(legacy.pitch);
    const legacyToward = [Math.sin(legacy.yaw) * cp, Math.cos(legacy.yaw) * cp,
      -Math.sin(legacy.pitch)];
    camera.basis(view).toward.forEach((value, axis) => near(value, legacyToward[axis], 1e-12,
      'toward'));
    // Mirror image of the legacy projection about the pane center.
    for (const item of computePanes({ width: 1000, height: 600, compare: i % 2 === 1,
      layout: 'side-by-side', split: 0.5, before: 'a', after: 'b' })) {
      const point = [random() * 300 - 150, random() * 300 - 150, random() * 100 - 50];
      const old = camera.projectLegacy(point, legacy, frame.center, frame.extent, item);
      const now = camera.project(point, view, item);
      near(now.x - (item.x + item.width / 2), (item.x + item.width / 2) - old.x, 1e-6, 'x');
      near(now.y, old.y, 1e-6, 'y unchanged');
      near(now.depth, old.depth, 1e-6, 'depth unchanged');
    }
  }
  const world = camera.defaultCamera(bracket, pane);
  assert.deepEqual(camera.fromLegacy(world), world, 'a world camera passes through');
  assert.notEqual(camera.fromLegacy(world), world, 'as a copy');
});

test('zoom keeps the point under the cursor and respects 1 µm..10 m per px', () => {
  const random = randomSource(9);
  for (let i = 0; i < 60; i++) {
    const view = { ...camera.defaultCamera(bracket, pane), yaw: random() * 6, pitch: -0.4,
      projection: i % 2 ? 'perspective' : 'orthographic' };
    const x = random() * 1000;
    const y = random() * 600;
    const anchor = camera.unproject(x, y, 0, view, pane);
    const zoomed = camera.zoomAt(view, pane, x, y, Math.exp((random() - 0.5) * 2));
    const screen = camera.project(anchor, zoomed, pane);
    near(screen.x, x, 1e-6, 'x stays');
    near(screen.y, y, 1e-6, 'y stays');
  }
  let view = camera.defaultCamera(bracket, pane);
  for (let i = 0; i < 200; i++) view = camera.zoomAt(view, pane, 500, 300, 0.5);
  near(camera.depthPerPixel(view, pane), 1e-3, 1e-12, 'closest: 1 µm per CSS px');
  for (let i = 0; i < 200; i++) view = camera.zoomAt(view, pane, 500, 300, 2);
  near(camera.depthPerPixel(view, pane), 1e4, 1e-6, 'farthest: 10 m per CSS px');
  // A 0.2 mm gap reaches 200 CSS px at the limit (>= 100 px required).
  const closest = camera.heightLimits(pane).min / Math.min(pane.width, pane.height);
  assert.ok(0.2 / closest >= 100);
});

test('pan follows the pointer; orbit clamps pitch at ±90° without pushing a legacy pitch', () => {
  const view = camera.defaultCamera(bracket, pane);
  const point = [10, 5, 2];
  const before = camera.project(point, view, pane);
  const after = camera.project(point, camera.panBy(view, pane, 37, -12), pane);
  near(after.x - before.x, 37, 1e-9, 'dx');
  near(after.y - before.y, -12, 1e-9, 'dy');
  let pitched = view;
  for (let i = 0; i < 40; i++) pitched = camera.orbit(pitched, 0, -0.2);
  assert.equal(pitched.pitch, -Math.PI / 2);
  for (let i = 0; i < 40; i++) pitched = camera.orbit(pitched, 0, 0.2);
  assert.equal(pitched.pitch, Math.PI / 2);
  const legacyPitch = { ...view, pitch: 2 };
  assert.equal(camera.orbit(legacyPitch, 0, 0.1).pitch, 2, 'does not grow');
  near(camera.orbit(legacyPitch, 0, -0.1).pitch, 1.9, 1e-12, 'may return');
});

test('fit keeps the orientation and fits the projected bounds; depthPerPixel', () => {
  const oriented = camera.orbit(camera.defaultCamera(bracket, pane), 0.3, 0.2);
  for (const projection of ['orthographic', 'perspective']) {
    const fitted = camera.fit(bracket, { ...oriented, projection, target: [900, 0, 0],
      height: 3 }, pane);
    assert.equal(fitted.yaw, oriented.yaw);
    assert.equal(fitted.pitch, oriented.pitch);
    assert.equal(fitted.projection, projection);
    assert.deepEqual(fitted.target, [25, 20, 4]);
    const xs = [];
    const ys = [];
    for (const x of [0, 50]) for (const y of [0, 40]) for (const z of [0, 8]) {
      const screen = camera.project([x, y, z], fitted, pane);
      xs.push(screen.x);
      ys.push(screen.y);
    }
    // Every corner lies inside the centered FIT_FILL box of the pane.
    const fill = camera.FIT_FILL;
    assert.ok(xs.every(x => Math.abs(x - 500) <= fill * 500 + 1e-6), projection);
    assert.ok(ys.every(y => Math.abs(y - 300) <= fill * 300 + 1e-6), projection);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    // Orthographic fits are tight; perspective ones are conservative (near
    // corners grow), but still use most of the pane.
    const tight = projection === 'orthographic' ? fill : 0.8 * fill;
    assert.ok(width >= tight * 1000 - 1 || height >= tight * 600 - 1, `${projection} is tight`);
  }
  const view = camera.defaultCamera(bracket, pane);
  near(camera.depthPerPixel(view, pane), view.height / 600, 1e-15, 'mm per px');
  near(camera.pixelsPerMm(view, { ...pane, width: 400 }), 400 / view.height, 1e-12,
    'the shorter side sets the scale');
});

test('legacy drawings: mirrored per pane, hidden in a wipe over two models', () => {
  const legacyCamera = { yaw: 0, pitch: 0, zoom: 1, pan: [0, 0] };
  const world = camera.defaultCamera(bracket);
  const single = { camera: legacyCamera, view: { compare: false } };
  const paired = { camera: legacyCamera, view: { compare: true, layout: 'side-by-side',
    before: 'a', after: 'b' } };
  const wipeTwo = { camera: legacyCamera, view: { compare: true, before: 'a', after: 'b' } };
  const wipeOne = { camera: legacyCamera, view: { compare: true, before: 'a', after: 'a' } };
  assert.equal(legacyDrawing(single), 'mirrored');
  assert.equal(legacyDrawing(paired), 'mirrored');
  assert.equal(legacyDrawing(wipeTwo), 'hidden');
  assert.equal(legacyDrawing(wipeOne), 'mirrored');
  assert.equal(legacyDrawing({ camera: world, view: wipeTwo.view }), 'current');
  assert.equal(legacyDrawing({ camera: legacyCamera, view: { ...wipeTwo.view,
    cameraConvention: 2 } }), 'current', 'drawn in this session on the corrected view');
  assert.deepEqual(mirrorLegacyPoint([0.2, 0.3], single), [0.8, 0.3]);
  assert.deepEqual(mirrorLegacyPoint([0.1, 0.3], paired), [0.4, 0.3]);
  assert.deepEqual(mirrorLegacyPoint([0.6, 0.3], paired), [0.9, 0.3]);
});

// The pre-foundation projection, copied from viewer/app.js before the split
// (convention 1, mirrored screen X). Legacy drawings are restored against it.
function preFoundationProject(point, state, pane, canvasWidth, canvasHeight, sideBySide) {
  const [x, y, z] = point.map((value, axis) => value - state.center[axis]);
  const { yaw, pitch, pan } = state.camera;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const a = x * c - y * s;
  const b = x * s + y * c;
  const factor = Math.min(canvasWidth / (sideBySide ? 2 : 1), canvasHeight) * .67
    / state.extent * state.camera.zoom;
  return {
    x: pane.x + pane.width / 2 + (a + pan[0] * state.extent) * factor,
    y: canvasHeight / 2 - (b * Math.sin(pitch) + z * Math.cos(pitch) + pan[1] * state.extent)
      * factor,
    depth: b * Math.cos(pitch) - z * Math.sin(pitch),
  };
}

test('projectLegacy reproduces the pre-foundation projection bit for bit', () => {
  const random = randomSource(13);
  for (let i = 0; i < 100; i++) {
    const state = {
      center: [random() * 200 - 100, random() * 200 - 100, random() * 50],
      extent: 1 + random() * 300,
      camera: { yaw: random() * 12 - 6, pitch: random() * 6 - 3, zoom: 0.05 + random() * 20,
        pan: [random() - 0.5, random() - 0.5] },
    };
    const layout = ['single', 'wipe', 'side-by-side'][i % 3];
    const panes = computePanes({ width: 1000, height: 600, compare: layout !== 'single', layout,
      split: 0.3, before: 'a', after: 'b' });
    const point = [random() * 300 - 150, random() * 300 - 150, random() * 100 - 50];
    for (const item of panes) {
      assert.deepEqual(camera.projectLegacy(point, state.camera, state.center, state.extent, item),
        preFoundationProject(point, state, item, 1000, 600, layout === 'side-by-side'));
    }
  }
});
