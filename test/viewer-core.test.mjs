// Viewer core modules: format (tolerance decades, exactness chips), the
// composition root, keyboard bindings over all features, slots, store,
// requests, settings, editor links and multi-selection highlights.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as format from '../viewer/core/format.js';
import { createViewer, FACADE_FIELDS, HARNESS_FUNCTIONS } from '../viewer/app.js';
import { loadFeatures } from '../viewer/core/feature-loader.js';
import { FEATURES, LEGACY_FEATURES } from '../viewer/features/index.js';
import { createCommands, normalizeKey } from '../viewer/core/commands.js';
import { createStore } from '../viewer/core/store.js';
import { createRequests } from '../viewer/core/requests.js';
import { createSettings } from '../viewer/core/settings.js';
import { editorLink } from '../viewer/core/editor-links.js';
import { html, markupOf, raw } from '../viewer/core/dom.js';
import { createFakeEnvironment } from '../scripts/viewer/test-support/fake-env.mjs';

const all = await loadFeatures(FEATURES);
const legacyOnly = await loadFeatures(LEGACY_FEATURES);

test('format prints values to the decade of their tolerance', () => {
  assert.equal(format.toleranceDecimals(0.0003), 4);
  assert.equal(format.toleranceDecimals(0.001), 3);
  assert.equal(format.toleranceDecimals(0.02), 2);
  assert.equal(format.toleranceDecimals(0.5), 1);
  assert.equal(format.toleranceDecimals(1), 0);
  assert.equal(format.toleranceDecimals(0), 4, 'no tolerance falls back to 4 decimals');
  assert.equal(format.formatWithTolerance(4, 0.0003, { prefix: 'Ø' }), 'Ø4.0000 mm ±0.0003');
  assert.equal(format.formatWithTolerance(20, 0.0003), '20.0000 mm ±0.0003');
  assert.equal(format.formatWithTolerance(12.345678, 0.02), '12.35 mm ±0.02');
  assert.equal(format.formatTolerance(0.00025), '0.0003', 'tolerances round up, never down');
  assert.equal(format.formatTolerance(0.0003), '0.0003');
  assert.equal(format.formatLength(Number.NaN, 0.01), 'not evaluated');
  assert.equal(format.formatAngle(45), '45.000°');
  assert.equal(format.formatAngle(format.radiansToDegrees(Math.PI / 3)), '60.000°');
  assert.equal(format.recordedValue(null), 'not evaluated');
  assert.equal(format.recordedValue(0), '0');
  assert.equal(format.number(1234.5678), '1,234.57');
  assert.equal(format.number(undefined), 'Not measured');
  assert.equal(format.short('abcdef0123456789'), 'abcdef01');
  assert.deepEqual(format.reportStatus({ accepted: false }),
    { label: 'Needs attention', className: 'failed' });
  assert.deepEqual(format.reportStatus({ status: 'passed' }), { label: 'Passed', className: '' });
  assert.deepEqual(format.reportStatus({ status: 'measured' }),
    { label: 'Measurements', className: 'unknown' });
});

test('format has exactly the seven exactness chips of spec section 8', () => {
  assert.deepEqual(format.EXACTNESS_VALUES, ['exact-parameters', 'kernel-resolved', 'recorded',
    'design-parameter', 'source-reference', 'display-approximation', 'unsupported']);
  const chips = Object.fromEntries(format.EXACTNESS_VALUES.map(value => [value,
    format.exactnessChip(value, 0.0003).label]));
  assert.deepEqual(chips, {
    'exact-parameters': 'exact ±0.0003',
    'kernel-resolved': 'kernel',
    recorded: 'recorded',
    'design-parameter': 'design',
    'source-reference': 'reference',
    'display-approximation': 'display ±0.0003',
    unsupported: 'unsupported',
  });
  assert.equal(format.exactnessChip('display-approximation', 0.02).label, 'display ±0.02');
  assert.equal(format.exactnessChip('exact-parameters').label, 'exact', 'no tolerance, no ±');
  assert.throws(() => format.exactnessChip('approximately-exact'), /Unknown exactness/);
  assert.match(format.exactnessChipMarkup('kernel-resolved'),
    /^<span class="exactness-chip exactness-kernel" title="[^"]+">kernel<\/span>$/);
});

// The convention-1 camera tests moved to test/viewer-camera.test.mjs as their
// convention-2 replacements (including the bit-identical projectLegacy check).

function createTestViewer(features, options = {}) {
  const fake = createFakeEnvironment({ dispatch: () => ({}) });
  const viewer = createViewer(fake.env, { features, log: () => {}, ...options });
  return { fake, viewer };
}

test('every feature loads and no two commands bind the same key in one scope', () => {
  assert.deepEqual(all.failures, []);
  assert.deepEqual(all.features.map(feature => feature.id), FEATURES.map(entry => entry.id));
  const { viewer } = createTestViewer(all.features);
  const { commands } = viewer.ctx;
  assert.deepEqual(commands.conflicts(), []);
  const bindings = commands.bindings().map(binding => `${binding.scope}:${binding.key}`);
  for (const key of ['global:V', 'global:H', 'global:C', 'global:A', 'global:R', 'global:P',
    'global:F', 'global:E', 'global:Mod+S', 'global:Mod+Z', 'global:Escape',
    'canvas:ArrowLeft', 'canvas:ArrowRight', 'canvas:ArrowUp', 'canvas:ArrowDown']) {
    assert.ok(bindings.includes(key), `binding ${key}`);
  }
  const probe = createCommands({ dom: { $: () => null } });
  probe.register({ id: 'a', keys: ['g'], run() {} });
  probe.register({ id: 'b', keys: ['G'], run() {} });
  probe.register({ id: 'c', keys: ['G'], scope: 'canvas', run() {} });
  assert.deepEqual(probe.conflicts(), [{ key: 'G', scope: 'global', commands: ['a', 'b'] }]);
  assert.equal(normalizeKey('shift+mod+g'), 'Mod+Shift+G');
});

test('keyboard dispatch keeps the pre-foundation guards', () => {
  const { fake, viewer } = createTestViewer(legacyOnly.features, {
    seams: { scheduleDraw() {}, renderInspector() {}, panel() {}, renderAnnotations() {} },
  });
  const state = viewer.harness.state;
  const key = (value, extra = {}) => fake.document.emit('keydown', { key: value, ...extra });
  key('c');
  assert.equal(state.tool, 'comment');
  key('V', { shiftKey: true });
  assert.equal(state.tool, 'select', 'letters ignore Shift like before');
  key('c', { metaKey: true });
  assert.equal(state.tool, 'select', 'single keys never fire with ⌘');
  const field = fake.node('#review-title');
  field.tagName = 'INPUT';
  field.focus();
  key('a');
  assert.equal(state.tool, 'select', 'shortcuts are ignored while typing');
  key('Escape');
  assert.equal(fake.document.activeElement, null, 'Escape blurs the field');
  const yaw = state.camera.yaw;
  key('ArrowLeft');
  assert.equal(state.camera.yaw, yaw, 'arrows orbit only with the viewport focused');
  fake.node('#model-canvas').focus();
  key('ArrowLeft');
  assert.ok(Math.abs(state.camera.yaw - (yaw - 15 * Math.PI / 180)) < 1e-12);
});

test('the composition root merges features and rejects duplicate names', () => {
  const legacy = createTestViewer(legacyOnly.features, { legacy: true }).viewer;
  for (const name of HARNESS_FUNCTIONS) assert.equal(typeof legacy.harness[name], 'function', name);
  for (const name of FACADE_FIELDS) assert.ok(name in legacy.harness.state, name);
  const feature = (id, result) => ({ id, legacy: false, setup: () => result });
  const build = features => createTestViewer(features).viewer;
  assert.throws(() => build([feature('a', { api: { go() {} } }),
    feature('b', { api: { go() {} } })]), /Feature b redefines go/);
  assert.throws(() => build([feature('a', { defaults: { thing: {} } }),
    feature('b', { defaults: { thing: {} } })]), /Store slice thing is defined twice/);
  const accessor = { get: () => 1, set() {} };
  assert.throws(() => build([feature('a', { legacy: { state: { dup: accessor } } }),
    feature('b', { legacy: { state: { dup: accessor } } })]), /dup is defined twice/);
  assert.throws(() => build([feature('a', { legacy: { harness: { go() {} } } }),
    feature('b', { legacy: { harness: { go() {} } } })]), /go is defined twice/);
  assert.throws(() => createTestViewer([], { legacy: true }), /Legacy contract incomplete/);
  const seamed = createTestViewer(legacyOnly.features, {
    legacy: true, seams: { renderInspector: () => 'seam' },
  }).viewer;
  assert.equal(seamed.harness.renderInspector(), 'seam', 'seams replace app functions');
});

test('a feature that fails to load or set up becomes a viewport banner, the rest works', () => {
  const broken = {
    id: 'broken', legacy: false,
    setup() {
      throw new Error('setup exploded');
    },
  };
  const { viewer } = createTestViewer([...legacyOnly.features, broken], {
    failures: [{ id: 'help', error: new Error('SyntaxError') }],
  });
  assert.deepEqual(viewer.failures.map(failure => failure.id), ['help', 'broken']);
  const banners = viewer.ctx.slots.list('viewportBanner.item');
  assert.deepEqual(banners.map(item => item.html), [
    '<p class="viewport-banner-item">Feature help failed to load</p>',
    '<p class="viewport-banner-item">Feature broken failed to load</p>',
  ]);
  assert.equal(typeof viewer.harness.select, 'function', 'the loaded features still work');
});

test('multi-selection keeps a primary reference and highlights every entity', () => {
  const calls = [];
  const gl = new Proxy({}, {
    get(_target, name) {
      if (name === 'getShaderParameter' || name === 'getProgramParameter') return () => true;
      if (typeof name === 'string' && /^[A-Z_]+$/.test(name)) return name;
      return (...args) => {
        calls.push(name);
        return name === 'createBuffer' ? { id: calls.length, args } : null;
      };
    },
  });
  const { fake, viewer } = createTestViewer(legacyOnly.features, {
    seams: { scheduleDraw() {}, renderInspector() {}, panel() {} },
  });
  fake.node('#model-canvas').getContext = () => gl;
  viewer.ctx.renderer.init();
  const state = viewer.harness.state;
  const face = index => ({ modelId: 'm', bodyId: 'b', entityType: 'face', entityIndex: index });
  const triangle = { points: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], normal: [0, 0, 1] };
  state.scenes.set('m', {
    id: 'm', bounds: { min: [0, 0, 0], max: [1, 1, 0] },
    bodies: [{
      id: 'b', vertices: [], edges: [],
      faces: [0, 1].map(index => ({ index, triangles: [triangle], edgeIndices: [] })),
    }],
  });
  const buffers = () => calls.filter(name => name === 'createBuffer').length;
  viewer.harness.select([face(0), face(1)]);
  assert.deepEqual(state.selection, face(0));
  assert.deepEqual(state.selectionSet, [face(0), face(1)]);
  assert.deepEqual(viewer.ctx.renderer.highlights().selection, [face(0), face(1)]);
  assert.deepEqual(viewer.ctx.renderer.highlightState('m').selectedFaces, [0, 1],
    'every selected entity is highlighted (shader state texture)');
  assert.equal(buffers(), 0, 'highlights allocate no buffers');
  viewer.harness.select(face(1));
  assert.deepEqual(state.selectionSet, [face(1)]);
  assert.deepEqual(viewer.ctx.renderer.highlightState('m').selectedFaces, [1]);
  state.selection = null;
  assert.deepEqual(state.selectionSet, [], 'assigning state.selection replaces the set');
});

test('store, requests, settings, editor links and html escaping', async () => {
  const store = createStore({ view: { camera: { yaw: 1 } } });
  const reasons = [];
  store.subscribe((_state, list) => reasons.push(...list));
  const changes = [];
  store.select(state => state.view.camera.yaw, (value, previous) => {
    changes.push([previous, value]);
  });
  store.update('yaw', state => {
    state.view.camera.yaw = 2;
  });
  store.batch('both', () => {
    store.update('a', () => {});
    store.update('b', () => {});
  });
  assert.deepEqual(reasons, ['yaw', 'a', 'b', 'both']);
  assert.deepEqual(changes, [[1, 2]]);
  assert.equal(Object.isFrozen(store.get().view), false, 'the store never freezes');
  assert.throws(() => store.define('view', {}), /defined twice/);
  const scope = createRequests().scope('drawer');
  const first = scope.begin();
  const second = scope.begin();
  assert.equal(first.current(), false);
  assert.equal(second.current(), true);
  assert.equal(first.signal.aborted, true, 'an older request is aborted');
  const settings = createSettings({ api: null, legacy: true });
  assert.equal(settings.get('G', 'editor', 'zed'), 'zed');
  await settings.set('SB', 'visible', false, { source: '/a.fs', body: 'plate' });
  assert.equal(settings.get('SB', 'visible', true, { source: '/a.fs', body: 'plate' }), false);
  assert.throws(() => settings.get('X', 'k'), /Unknown settings scope/);
  assert.equal(editorLink({ file: '/public-fixture/cad/part one.fs', line: 24, column: 17 }),
    'zed://file/public-fixture/cad/part%20one.fs:24:17');
  assert.equal(editorLink({ file: '/a.fs', line: 3 }, 'vscode'), 'vscode://file/a.fs:3');
  assert.equal(editorLink({ file: 'relative.fs', line: 3 }), null);
  const name = '<b>&"';
  assert.equal(markupOf(html`<p title="${name}">${raw('<i>ok</i>')}${[1, 2]}</p>`),
    '<p title="&lt;b&gt;&amp;&quot;"><i>ok</i>12</p>');
});
