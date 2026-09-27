// camera-navigation feature logic (viewer/features/view/navigation.js) in the
// fake browser environment: view keys on event.code, arrows, the Views menu,
// projection, the fit policy across revisions and sources, per-source
// persistence, legacy reviews (spec D6) and review camera validation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createViewer } from '../viewer/app.js';
import { loadFeatures } from '../viewer/core/feature-loader.js';
import { LEGACY_FEATURES } from '../viewer/features/index.js';
import * as navigation from '../viewer/features/view/navigation.js';
import * as camera from '../viewer/render/camera.js';
import { createAnnotationGeometry } from '../viewer/features/annotations/annotation-geometry.js';
import { describeAxes, triadMarkup } from '../viewer/features/view/triad.js';
import {
  cameraConventionField, validateReviewCamera,
} from '../src/viewer/review-camera.mjs';
import { createFakeEnvironment } from '../scripts/viewer/test-support/fake-env.mjs';

// The legacy feature set with the view feature taken from navigation.js (the
// state after view.js re-exports it).
const { features: loaded, failures } = await loadFeatures(LEGACY_FEATURES);
assert.deepEqual(failures, []);
const features = loaded.map(feature => (feature.id === 'view' ? navigation : feature));

const DEGREE = Math.PI / 180;
const idA = 'a'.repeat(64);
const idB = 'b'.repeat(64);
const idC = 'c'.repeat(64);
const bracketBounds = { min: [0, 0, 0], max: [50, 40, 8] };
const scene = (id, bounds = bracketBounds) => ({
  id, label: id.slice(0, 1), bounds,
  bodies: [{ id: 'part', faces: [{ index: 0, triangles: [] }], edges: [], vertices: [] }],
});

function build({ legacy = true, settings = null, dispatch = () => ({}), models = null } = {}) {
  const puts = [];
  const putOptions = [];
  const fake = createFakeEnvironment({
    dispatch: async (path, options) => {
      if (path === '/api/settings') {
        if (options?.method === 'PUT') {
          puts.push(JSON.parse(options.body));
          putOptions.push(options);
          return settings;
        }
        return settings;
      }
      return dispatch(path, options);
    },
  });
  const none = () => {};
  const seams = { scheduleDraw: none, renderAnnotations: none, renderLibrary: none,
    renderSaved: none, panel: none, renderInspector: none };
  const viewer = createViewer(fake.env, { seams, features, legacy, log: none });
  const ui = viewer.harness;
  ui.state.workspace.models = models ?? [
    { id: idA, label: 'part', sourcePath: '/work/part.brep.json' },
    { id: idB, label: 'part', sourcePath: '/work/part.brep.json' },
    { id: idC, label: 'spacer', sourcePath: '/work/spacer.brep.json' },
  ];
  ui.state.scenes.set(idA, scene(idA));
  ui.state.scenes.set(idB, scene(idB, { min: [0, 0, 0], max: [50, 40, 12] }));
  ui.state.scenes.set(idC, scene(idC, { min: [-10, -10, 0], max: [10, 10, 30] }));
  const canvas = fake.node('#model-canvas');
  // Browser order: window capture listener first, then the core listener on
  // the document unless propagation was stopped.
  const press = values => {
    let stopped = false;
    let prevented = false;
    const event = {
      key: '', code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
      ...values,
      get defaultPrevented() {
        return prevented;
      },
      preventDefault() {
        prevented = true;
      },
      stopImmediatePropagation() {
        stopped = true;
      },
    };
    fake.window.emit('keydown', event);
    if (!stopped) fake.document.emit('keydown', event);
    return event;
  };
  return { ...ui, ui, viewer, fake, canvas, press, puts, putOptions, app: viewer.ctx.app };
}

const open = async (v, id, reset = true) => {
  v.state.after = id;
  v.state.before = id;
  await v.loadSelectedModels(reset);
};
const angles = v => [v.state.camera.yaw, v.state.camera.pitch];
const near = (actual, expected, tolerance = 1e-12, message = '') => assert.ok(
  Math.abs(actual - expected) <= tolerance, `${message} ${actual} vs ${expected}`);

test('the number row, the numpad (NumLock on and off) and Shift+1..7 select the same views',
  async () => {
    const v = build();
    await open(v, idA);
    const expected = {
      front: ['1', 1, 'End'], back: ['3', 3, 'PageDown'], left: ['4', 4, 'ArrowLeft'],
      right: ['6', 6, 'ArrowRight'], top: ['8', 8, 'ArrowUp'], bottom: ['2', 2, 'ArrowDown'],
      iso: ['5', 5, 'Clear'],
    };
    const shift = { front: 1, back: 2, left: 3, right: 4, top: 5, bottom: 6, iso: 7 };
    const shifted = { 1: '!', 2: '"', 3: '§', 4: '$', 5: '%', 6: '&', 7: '/' };
    for (const [name, [key, digit, numLockOff]] of Object.entries(expected)) {
      const want = camera.PRESETS[name];
      const variants = [
        { key, code: `Digit${digit}` },
        { key, code: `Numpad${digit}` },
        { key: numLockOff, code: `Numpad${digit}` },
        { key: shifted[shift[name]], code: `Digit${shift[name]}`, shiftKey: true },
      ];
      for (const variant of variants) {
        v.press({ key: 'x', code: 'Digit7', shiftKey: true });
        v.press(variant);
        assert.deepEqual(angles(v), want, `${name} via ${JSON.stringify(variant)}`);
        assert.equal(v.state.preset, name);
      }
    }
    // Numpad arrows (NumLock off) never orbit, even with the canvas focused.
    v.canvas.focus();
    v.press({ key: 'ArrowLeft', code: 'Numpad4' });
    assert.deepEqual(angles(v), camera.PRESETS.left);
  });

test('0 and Home restore the default view; F fits and keeps the orientation', async () => {
  const v = build();
  await open(v, idA);
  const initial = structuredClone(v.state.camera);
  v.press({ key: '8', code: 'Digit8' });
  v.canvas.focus();
  v.press({ key: 'ArrowRight', code: 'ArrowRight' });
  v.fake.document.activeElement = null;
  const oriented = angles(v);
  v.state.camera = camera.zoomAt(v.state.camera, v.viewPanes()[0], 100, 80, 0.2);
  v.press({ key: 'f', code: 'KeyF' });
  assert.deepEqual(angles(v), oriented, 'F keeps the orientation');
  assert.deepEqual(v.state.camera.target, [25, 20, 4], 'F centers the bounds');
  const fitted = camera.fit(bracketBounds, v.state.camera, v.viewPanes()[0]);
  near(v.state.camera.height, fitted.height, 1e-9, 'F fits');
  for (const variant of [{ key: '0', code: 'Digit0' }, { key: 'Home', code: 'Home' },
    { key: '0', code: 'Numpad0' }, { key: 'Insert', code: 'Numpad0' }]) {
    v.press({ key: '8', code: 'Digit8' });
    v.press(variant);
    assert.deepEqual(v.state.camera, initial, `default view via ${variant.code}`);
  }
  // Home inside a focus-scoped list that already handled it does nothing.
  v.press({ key: '8', code: 'Digit8' });
  const handled = { key: 'Home', code: 'Home' };
  const before = structuredClone(v.state.camera);
  v.fake.document.emit('keydown', { ...handled, defaultPrevented: true });
  assert.deepEqual(v.state.camera, before);
});

test('keys are ignored while typing and never fire with Ctrl, Cmd or Alt', async () => {
  const v = build();
  await open(v, idA);
  const before = structuredClone(v.state.camera);
  const field = v.fake.node('#review-title');
  field.tagName = 'INPUT';
  field.focus();
  v.press({ key: '8', code: 'Digit8' });
  v.press({ key: 'Home', code: 'Home' });
  v.press({ key: 'o', code: 'KeyO' });
  assert.deepEqual(v.state.camera, before);
  field.blur();
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
    v.press({ key: '8', code: 'Digit8', [modifier]: true });
  }
  assert.deepEqual(v.state.camera, before);
});

test('arrows with canvas focus orbit 15°, Ctrl 5°, Shift 90°; Ctrl+Shift pans', async () => {
  const v = build();
  await open(v, idA);
  const [yaw, pitch] = angles(v);
  v.press({ key: 'ArrowLeft', code: 'ArrowLeft' });
  assert.deepEqual(angles(v), [yaw, pitch], 'no orbit without canvas focus');
  v.canvas.focus();
  v.press({ key: 'ArrowLeft', code: 'ArrowLeft' });
  near(v.state.camera.yaw, yaw - 15 * DEGREE);
  v.press({ key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true });
  near(v.state.camera.yaw, yaw - 10 * DEGREE);
  v.press({ key: 'ArrowRight', code: 'ArrowRight', metaKey: true });
  near(v.state.camera.yaw, yaw - 5 * DEGREE);
  v.press({ key: 'ArrowRight', code: 'ArrowRight', shiftKey: true });
  near(v.state.camera.yaw, yaw + 85 * DEGREE);
  v.press({ key: 'ArrowUp', code: 'ArrowUp' });
  near(v.state.camera.pitch, pitch + 15 * DEGREE);
  v.press({ key: 'ArrowDown', code: 'ArrowDown', ctrlKey: true });
  near(v.state.camera.pitch, pitch + 10 * DEGREE);
  for (let i = 0; i < 20; i++) v.press({ key: 'ArrowUp', code: 'ArrowUp', shiftKey: true });
  assert.equal(v.state.camera.pitch, Math.PI / 2, 'pitch stops at +90°');
  for (let i = 0; i < 20; i++) v.press({ key: 'ArrowDown', code: 'ArrowDown' });
  assert.equal(v.state.camera.pitch, -Math.PI / 2, 'pitch stops at -90°');
  const target = [...v.state.camera.target];
  const oriented = angles(v);
  v.press({ key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true, shiftKey: true });
  assert.deepEqual(angles(v), oriented, 'Ctrl+Shift does not orbit');
  assert.notDeepEqual(v.state.camera.target, target, 'Ctrl+Shift pans');
  v.fake.document.activeElement = null;
  const still = structuredClone(v.state.camera);
  v.press({ key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true });
  assert.deepEqual(v.state.camera, still, 'Ctrl+Arrow needs canvas focus too');
});

test('#view-presets opens the Views menu and #fit-view fits; both clear hover', async () => {
  const v = build();
  await open(v, idA);
  const menu = v.fake.node('#view-menu');
  menu.hidden = true;
  const reference = { modelId: idA, bodyId: 'part', entityType: 'face', entityIndex: 0 };
  v.app.setHover(reference, 'after');
  assert.ok(v.state.hover);
  v.fake.node('#view-presets').onclick({ detail: 1 });
  assert.equal(menu.hidden, false, 'menu open');
  assert.equal(v.fake.node('#view-presets').getAttribute('aria-expanded'), 'true');
  assert.equal(v.state.hover, null, 'Views clears hover');
  v.fake.document.emit('keydown', { key: 'Escape' });
  assert.equal(menu.hidden, true, 'Escape closes the menu');
  v.app.setHover(reference, 'after');
  v.fake.node('#fit-view').onclick();
  assert.equal(v.state.hover, null, 'Fit clears hover');
  // Menu items run their command.
  menu.hidden = true;
  v.fake.node('#view-presets').onclick({ detail: 1 });
  menu.onclick({ target: { closest: () => ({ dataset: { command: 'view.bottom' } }) } });
  assert.deepEqual(angles(v), camera.PRESETS.bottom);
  assert.equal(menu.hidden, true);
});

test('O toggles perspective; the choice is a global setting', async () => {
  const v = build();
  await open(v, idA);
  const before = structuredClone(v.state.camera);
  v.press({ key: 'o', code: 'KeyO' });
  assert.equal(v.state.camera.projection, 'perspective');
  assert.equal(v.viewer.ctx.settings.get('G', 'projection'), 'perspective');
  assert.deepEqual({ ...v.state.camera, projection: 'orthographic' }, before,
    'toggling keeps target, height and orientation');
  v.press({ key: 'O', code: 'KeyO', shiftKey: true });
  assert.equal(v.state.camera.projection, 'orthographic');
});

test('fit policy: first model fits, same source keeps the camera, another source fits',
  async () => {
    const v = build();
    await open(v, idA);
    const first = structuredClone(v.state.camera);
    assert.deepEqual([first.yaw, first.pitch], camera.PRESETS.iso, 'default view: Iso');
    assert.deepEqual(first.target, [25, 20, 4]);
    v.canvas.focus();
    v.press({ key: 'ArrowRight', code: 'ArrowRight' });
    v.state.camera = camera.zoomAt(v.state.camera, v.viewPanes()[0], 300, 200, 0.5);
    const moved = structuredClone(v.state.camera);
    await open(v, idB);
    assert.deepEqual(v.state.camera, moved, 'another revision of the same source keeps it');
    await open(v, idA, false);
    assert.deepEqual(v.state.camera, moved);
    await open(v, idC);
    assert.deepEqual(angles(v), [moved.yaw, moved.pitch], 'another source keeps orientation');
    assert.deepEqual(v.state.camera.target, [0, 0, 15], 'and fits its bounds');
    await open(v, idA);
    assert.deepEqual(v.state.camera.target, [25, 20, 4], 'back to the first source fits it');
  });

// Regression (fix round, CMP-09): choosing a before model from another source
// kept the camera, so the before model could be entirely off screen.
test('fit policy: a compare before model from another source is framed with the model',
  async () => {
    const v = build();
    v.state.compare = false;
    await open(v, idA);
    v.canvas.focus();
    v.press({ key: 'ArrowRight', code: 'ArrowRight' });
    const moved = structuredClone(v.state.camera);
    v.state.compare = true;
    v.state.before = idC;
    await v.loadSelectedModels(true);
    assert.deepEqual(angles(v), [moved.yaw, moved.pitch], 'orientation kept');
    assert.deepEqual(v.state.camera.target, [20, 15, 15], 'fits the union of both models');
    const framed = structuredClone(v.state.camera);
    v.state.after = idB;
    await v.loadSelectedModels(true);
    assert.deepEqual(v.state.camera, framed, 'a revision of a shown source keeps the camera');
  });

test('a projection setting written by the Settings dialog applies at once', async () => {
  const v = build({ legacy: false, settings: { schema: 'wonky.viewer-settings/1', global: {},
    sources: {}, bodies: {} } });
  await v.viewer.ctx.settings.load();
  await open(v, idA);
  assert.equal(v.state.camera.projection, 'orthographic');
  await v.viewer.ctx.settings.set('G', 'projection', 'perspective');
  assert.equal(v.state.camera.projection, 'perspective');
  await v.viewer.ctx.settings.set('G', 'projection', 'orthographic');
  assert.equal(v.state.camera.projection, 'orthographic');
  v.press({ key: 'o', code: 'KeyO' });
  assert.equal(v.state.camera.projection, 'perspective', 'O still toggles');
});

test('the camera of a source survives a restart (settings scope S)', async () => {
  const saved = { convention: 2, projection: 'orthographic', target: [5, 6, 7], yaw: 0.3,
    pitch: -0.4, height: 33 };
  const document = {
    schema: 'wonky.viewer-settings/1', global: {},
    sources: { '/work/part.brep.json': { camera: saved } }, bodies: {},
  };
  const v = build({ legacy: false, settings: document });
  await v.viewer.ctx.settings.load();
  await open(v, idA);
  assert.deepEqual(v.state.camera, saved, 'restored on the first model of the session');
  // Late settings: the default view is replaced once they arrive.
  const late = build({ legacy: false, settings: document });
  await open(late, idA);
  assert.deepEqual([late.state.camera.yaw, late.state.camera.pitch], camera.PRESETS.iso);
  await late.viewer.ctx.settings.load();
  assert.deepEqual(late.state.camera, saved, 'restored when settings arrive');
  // Navigation is written back per source (after a short debounce).
  const pending = [];
  const w = build({ legacy: false, settings: { ...document, sources: {} } });
  w.fake.env.setTimeout = callback => pending.push(callback);
  await w.viewer.ctx.settings.load();
  await open(w, idA);
  w.canvas.focus();
  w.press({ key: 'ArrowRight', code: 'ArrowRight' });
  pending.splice(0).forEach(callback => callback());
  const put = w.puts.at(-1);
  assert.deepEqual(put.sources['/work/part.brep.json'].camera, w.state.camera);
});

test('legacy cameras convert in the bounds frame; center and extent re-anchor them', async () => {
  const v = build();
  await open(v, idA);
  const legacy = { yaw: 0.7, pitch: -0.3, zoom: 2, pan: [0.1, -0.05] };
  Object.assign(v.state, { camera: legacy, center: [1, 2, 3], extent: 10 });
  assert.deepEqual(v.state.camera, camera.fromLegacy(legacy, { center: [1, 2, 3], extent: 10 }));
  assert.equal(v.state.camera.yaw, 0.7, 'yaw keeps its meaning');
  await Promise.resolve();
  v.state.center = [0, 0, 0];
  assert.deepEqual(v.state.camera.target, camera.fromLegacy(legacy,
    { center: [1, 2, 3], extent: 10 }).target, 'a later frame change does not move it');
});

test('legacy review drawings: single mode mirrored over the same geometry, wipe hidden',
  async () => {
    const v = build();
    await open(v, idA);
    const frame = { center: [25, 20, 4], extent: 50 };
    Object.assign(v.state, { compare: false, center: frame.center, extent: frame.extent });
    const legacyCamera = { yaw: -0.65, pitch: -0.55, zoom: 1.2, pan: [0.05, 0] };
    const pane = v.viewPanes()[0];
    const point = [50, 0, 8];
    const old = camera.projectLegacy(point, legacyCamera, frame.center, frame.extent, pane);
    const annotation = {
      tool: 'comment', text: '', points: [[old.x / 1000, old.y / 600]], camera: legacyCamera,
      view: { before: idA, after: idA, compare: false, split: 0.5, aspect: 1000 / 600 },
    };
    v.state.annotations = [annotation];
    v.state.camera = structuredClone(legacyCamera);
    assert.equal(v.viewMatches(annotation), true, 'restored legacy view matches');
    const drawn = v.annotationPoint(annotation.points[0], annotation);
    const now = v.project(point);
    near(drawn[0], now.x, 1e-9, 'x over the same vertex');
    near(drawn[1], now.y, 1e-9, 'y over the same vertex');
    const geometry = createAnnotationGeometry({ canvas: v.canvas });
    const wipe = { ...annotation, view: { ...annotation.view, compare: true, before: idC } };
    assert.equal(geometry.drawingMarkup(wipe, 0), '', 'wipe over two models is hidden');
    assert.notEqual(geometry.drawingMarkup(annotation, 0), '');
    const current = v.annotationAt('comment', [[0.3, 0.4]], null);
    assert.equal(current.camera.convention, 2, 'new annotations store world cameras');
    near(v.annotationPoint([0.3, 0.4], current)[0], 300, 1e-9, 'not mirrored');
    v.state.annotations = [wipe];
    Object.assign(v.state, { compare: true, before: idC, layout: 'wipe' });
    v.ui.renderOverlay();
    const note = v.fake.node('#legacy-drawings-note');
    assert.equal(note.hidden, false);
    assert.match(note.textContent,
      /Drawn on the legacy mirrored wipe view; cannot be re-projected/);
  });

test('review camera validation accepts both conventions and rejects invalid ones', () => {
  const legacy = { yaw: -0.6, pitch: -0.5, zoom: 1, pan: [0, 0] };
  assert.deepEqual(validateReviewCamera(legacy), legacy);
  const world = { convention: 2, projection: 'perspective', target: [1, 2, 3], yaw: 0.1,
    pitch: -0.2, height: 40, extra: 'dropped' };
  const { extra, ...clean } = world;
  assert.deepEqual(validateReviewCamera(world), clean);
  assert.deepEqual(cameraConventionField(clean), { cameraConvention: 2 });
  assert.deepEqual(cameraConventionField(legacy), {});
  const invalid = [
    null, {}, { ...legacy, zoom: 0 }, { ...legacy, zoom: 101 }, { ...legacy, pan: [0] },
    { ...legacy, yaw: Number.NaN }, { ...legacy, pan: [0, 'x'] },
    { ...clean, convention: 1 }, { ...clean, projection: 'fisheye' }, { ...clean, height: 0 },
    { ...clean, height: 1e12 }, { ...clean, target: [1, 2] }, { ...clean, target: [1, 2, 1e12] },
    { ...clean, yaw: Infinity },
  ];
  for (const value of invalid) {
    assert.throws(() => validateReviewCamera(value), /Invalid review camera/,
      JSON.stringify(value));
  }
});

test('the axis triad agrees with the projection in all seven views', () => {
  const pane = { x: 0, y: 0, width: 1000, height: 600 };
  const expectations = {
    front: '+X right, +Y away, +Z up', back: '+X left, +Y toward you, +Z up',
    left: '+X away, +Y left, +Z up', right: '+X toward you, +Y right, +Z up',
    top: '+X right, +Y up, +Z toward you', bottom: '+X right, +Y down, +Z away',
  };
  const base = camera.defaultCamera(bracketBounds, pane);
  for (const name of camera.PRESET_NAMES) {
    const view = camera.preset(name, base);
    if (expectations[name]) assert.equal(describeAxes(view), expectations[name], name);
    const markup = triadMarkup(view);
    const origin = camera.project([0, 0, 0], view, pane);
    for (const [axis, vector] of [['X', [1, 0, 0]], ['Y', [0, 1, 0]], ['Z', [0, 0, 1]]]) {
      const tip = camera.project(vector.map(value => value * 10), view, pane);
      const match = new RegExp(`data-axis="${axis}" data-x="([-\\d.]+)" data-y="([-\\d.]+)"`)
        .exec(markup);
      const dx = Number(match[1]) - 38;
      const dy = Number(match[2]) - 38;
      const sx = tip.x - origin.x;
      const sy = tip.y - origin.y;
      if (Math.hypot(sx, sy) < 1e-6) {
        assert.ok(Math.hypot(dx, dy) < 0.1, `${name} ${axis} end-on`);
        continue;
      }
      near(dx * sy - dy * sx, 0, 0.5 * Math.hypot(sx, sy), `${name} ${axis} parallel`);
      assert.ok(dx * sx + dy * sy > 0, `${name} ${axis} same direction`);
    }
  }
});

// The model point under a canvas pixel on the plane z = 8 (the bracket top),
// for the current camera: the cursor ray intersected with that plane.
function pointOnTop(v, x, y) {
  const pane = v.viewPanes()[0];
  const near = camera.unproject(x, y, 0, v.state.camera, pane);
  const far = camera.unproject(x, y, -10, v.state.camera, pane);
  const t = (8 - near[2]) / (far[2] - near[2]);
  return near.map((value, axis) => value + t * (far[axis] - value));
}
const wheel = (v, x, y, deltaY) => v.canvas.emit('wheel', { deltaY, deltaMode: 0, clientX: x,
  clientY: y });

test('wheel zoom keeps the model point under the cursor in both projections', async () => {
  for (const projection of ['orthographic', 'perspective']) {
    const v = build();
    await open(v, idA);
    if (projection === 'perspective') v.press({ key: 'o', code: 'KeyO' });
    assert.equal(v.state.camera.projection, projection);
    const renderer = v.viewer.ctx.renderer;
    let picks = 0;
    renderer.pickDetail = (x, y, mode) => {
      picks++;
      assert.equal(mode, 'face');
      return { point: pointOnTop(v, x, y) };
    };
    const [x, y] = [612, 233];
    const surface = pointOnTop(v, x, y);
    const toward = () => camera.basis(v.state.camera).toward;
    const targetDepth = () => v.state.camera.target.reduce((sum, value, axis) => sum + value
      * toward()[axis], 0);
    const depthBefore = targetDepth();
    // Distance from the eye to the model point along the view direction.
    const eyeToSurface = () => camera.eyeDistance(v.state.camera) - surface.reduce((sum, value,
      axis) => sum + (value - v.state.camera.target[axis]) * toward()[axis], 0);
    const eyeBefore = eyeToSurface();
    const deltas = [-240, -240, 180, -500, 300, -900, -900];
    for (const delta of deltas) {
      wheel(v, x, y, delta);
      const screen = v.project(surface);
      near(screen.x, x, 1e-7, `${projection} x`);
      near(screen.y, y, 1e-7, `${projection} y`);
    }
    if (projection === 'orthographic') {
      assert.equal(picks, 0, 'orthographic zoom needs no pick');
      near(targetDepth(), depthBefore, 1e-9, 'the orbit pivot keeps its depth');
    } else {
      assert.equal(picks, 1, 'one pick per wheel gesture');
      // The camera is scaled about the model point: the eye dollies toward it
      // by the zoom factor and never passes it.
      const factor = Math.exp(deltas.reduce((sum, delta) => sum + delta * 0.001, 0));
      near(eyeToSurface(), eyeBefore * factor, 1e-9 * eyeBefore, 'eye distance scales');
      assert.ok(eyeToSurface() > 0, 'the model point stays in front of the eye');
      v.canvas.focus();
      v.press({ key: 'ArrowLeft', code: 'ArrowLeft' });
      wheel(v, x, y, -100);
      assert.equal(picks, 2, 'another camera change picks again');
      wheel(v, x + 5, y, -100);
      assert.equal(picks, 3, 'a new cursor position picks again');
    }
    // Over the background (no pick): the target-plane point stays.
    renderer.pickDetail = () => null;
    const plane = camera.unproject(100, 90, 0, v.state.camera, v.viewPanes()[0]);
    wheel(v, 100, 90, -300);
    const screen = v.project(plane);
    near(screen.x, 100, 1e-7, 'background x');
    near(screen.y, 90, 1e-7, 'background y');
  }
});

test('views record the camera convention; legacy-form cameras drawn now are current', async () => {
  const v = build();
  await open(v, idA);
  assert.equal(v.currentView().cameraConvention, 2);
  const drawn = v.annotationAt('comment', [[0.4, 0.5]], null);
  assert.equal(drawn.view.cameraConvention, 2);
  // The foundation view feature keeps a legacy-form facade camera; drawings
  // made on the corrected view are still not mirrored.
  const legacyForm = { ...drawn, camera: { yaw: 0.2, pitch: -0.3, zoom: 1, pan: [0, 0] } };
  const geometry = createAnnotationGeometry({ canvas: v.canvas });
  assert.deepEqual(geometry.annotationPoint([0.4, 0.5], legacyForm),
    geometry.annotationPoint([0.4, 0.5], drawn));
});

test('leaving the page delivers the pending camera with keepalive; snapshots persist nothing',
  async () => {
    const document = { schema: 'wonky.viewer-settings/1', global: {}, sources: {}, bodies: {} };
    const snapshot = `/reviews/models/${'d'.repeat(64)}.brep.json`;
    const idD = 'd'.repeat(64);
    const v = build({ legacy: false, settings: document, models: [
      { id: idA, label: 'part', sourcePath: '/work/part.brep.json' },
      { id: idD, label: 'Saved revision dddddddd', sourcePath: snapshot },
    ] });
    v.state.scenes.set(idD, scene(idD));
    await v.viewer.ctx.settings.load();
    await open(v, idA);
    v.canvas.focus();
    v.press({ key: 'ArrowRight', code: 'ArrowRight' });
    assert.equal(v.putOptions.length, 0, 'debounced');
    v.fake.window.emit('pagehide');
    await Promise.resolve();
    assert.equal(v.putOptions.at(-1).keepalive, true);
    assert.deepEqual(v.puts.at(-1), { sources: { '/work/part.brep.json': {
      camera: v.state.camera } } });
    // An archived snapshot counts as its own source and is never persisted.
    await open(v, idD);
    const count = v.puts.length;
    v.canvas.focus();
    v.press({ key: 'ArrowRight', code: 'ArrowRight' });
    v.fake.window.emit('pagehide');
    await Promise.resolve();
    assert.equal(v.puts.length, count);
  });

// Regression (fix round 2, CMP-08/09): a fit in wipe filled the wide pane, so
// switching to side by side cut both models. A layout change now refits
// when the models were complete before and would be cut after; a view the
// user zoomed into is left alone.
test('switching wipe to side by side refits models that would be cut off', async () => {
  const v = build();
  const wide = { min: [0, 0, 0], max: [120, 20, 8] };
  v.state.scenes.set(idA, scene(idA, wide));
  v.state.scenes.set(idB, scene(idB, wide));
  await open(v, idA);
  v.state.before = idB;
  v.state.compare = true;
  v.setLayout('wipe');
  v.press({ key: '8', code: 'Digit8' });
  v.press({ key: 'f', code: 'KeyF' });
  assert.equal(v.app.modelFits(), true, 'fitted in wipe');
  v.setLayout('side-by-side');
  assert.equal(v.state.layout, 'side-by-side');
  assert.equal(v.app.modelFits(), true, 'both panes show the complete model');
  // Zoomed in on purpose: the layout change keeps the camera.
  v.setLayout('wipe');
  v.state.camera = { ...v.state.camera, height: v.state.camera.height / 4 };
  const zoomed = JSON.stringify(v.state.camera);
  assert.equal(v.app.modelFits(), false);
  v.setLayout('side-by-side');
  assert.equal(JSON.stringify(v.state.camera), zoomed, 'a zoomed-in view is not refitted');
});
