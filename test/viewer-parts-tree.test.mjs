// parts-tree (client): the default tab rule, settings keys, the display.parts
// composition, visibility actions (Y / Shift+Y / I), row and revision markup,
// column state, and the feature on the fake browser (legacy feature set plus
// the parts feature, non-legacy mode).
import test from 'node:test';
import assert from 'node:assert/strict';
import { settingsKeys } from '../src/viewer/parts.mjs';
import { emptySettings, mergeSettings } from '../src/viewer/settings.mjs';
import { createViewer } from '../viewer/app.js';
import { loadFeatures } from '../viewer/core/feature-loader.js';
import { FEATURES, LEGACY_FEATURES } from '../viewer/features/index.js';
import {
  bodySettings, composePartsStyle, defaultLibraryTab, liveAttemptLine, settingsKeysOf,
  visibilityPlan,
} from '../viewer/features/parts/parts.js';
import {
  countsText, hexToRgb, matchesPart, revisionsMarkup, rgbToHex, rowMarkup, summaryText,
} from '../viewer/features/parts/parts-row.js';
import { columnState, COLUMNS, toggleLabel } from '../viewer/features/parts/columns.js';
import { hiddenMask } from '../viewer/render/picking.js';
import { composeStyle, resolveBodyStyle } from '../viewer/render/style.js';
import { createFakeEnvironment } from '../scripts/viewer/test-support/fake-env.mjs';

const legacy = await loadFeatures(LEGACY_FEATURES);
const partsFeature = await loadFeatures(FEATURES.filter(entry => entry.id === 'parts'));
const all = await loadFeatures(FEATURES);
assert.deepEqual([legacy.failures, partsFeature.failures], [[], []]);

// ---- Pure logic ----

test('Parts is the default tab for two or more bodies or a live source', () => {
  assert.equal(defaultLibraryTab({ bodyCount: 4 }), 'parts');
  assert.equal(defaultLibraryTab({ bodyCount: 2 }), 'parts');
  assert.equal(defaultLibraryTab({ bodyCount: 1 }), 'models');
  assert.equal(defaultLibraryTab({ bodyCount: 1, live: true }), 'parts');
  assert.equal(defaultLibraryTab({ bodyCount: 0 }), 'models', 'unknown body count');
  assert.equal(defaultLibraryTab({ bodyCount: 4, stored: 'models' }), 'models',
    'an explicit choice per source wins');
  assert.equal(defaultLibraryTab({ bodyCount: 1, stored: 'parts' }), 'parts');
  assert.equal(defaultLibraryTab({ bodyCount: 1, stored: 'checks' }), 'checks');
  assert.equal(defaultLibraryTab({ bodyCount: 3, stored: 'bogus' }), 'parts');
});

test('client and server settings keys agree: unique name, else body id', () => {
  const bodies = [{ id: 'model/a', name: 'Lid' }, { id: 'model/b', name: 'Clip' },
    { id: 'model/c', name: 'Clip' }, { id: 'model/d' }, { id: 'model/e', name: '' }];
  assert.deepEqual(settingsKeysOf(bodies), ['Lid', 'model/b', 'model/c', 'model/d', 'model/e']);
  assert.deepEqual(settingsKeysOf(bodies), settingsKeys(bodies));
});

test('body settings are normalized; defaults are visible, opaque, no override', () => {
  const read = values => name => values[name];
  assert.deepEqual(bodySettings(read({})), { visible: true, opacity: null, color: null });
  assert.deepEqual(bodySettings(read({ visible: false, opacity: 0.4, color: '#AABBCC' })),
    { visible: false, opacity: 0.4, color: '#aabbcc' });
  assert.deepEqual(bodySettings(read({ visible: 'no', opacity: 0.01, color: 'red' })),
    { visible: true, opacity: null, color: null }, 'invalid values fall back');
  assert.equal(bodySettings(read({ opacity: 1 })).opacity, null, '100 % is the default');
});

const store = values => (source, key) => bodySettings(name => values[`${source}|${key}`]?.[name]);

test('display.parts: per-model entries, shared map for picking and carry-over', () => {
  const settingsOf = store({
    'plate.fs|Pin': { visible: false },
    'plate.fs|Bracket': { opacity: 0.5, color: '#ff0000' },
    'other.fs|model/body': { visible: true },
  });
  const models = [
    { modelId: 'after', source: 'plate.fs', bodies: [{ id: 'model/pin', key: 'Pin' },
      { id: 'model/bracket', key: 'Bracket' }, { id: 'model/body', key: 'model/body' }] },
    { modelId: 'before', source: 'other.fs', bodies: [{ id: 'model/body', key: 'model/body' }] },
  ];
  const parts = composePartsStyle(models, settingsOf);
  assert.deepEqual(parts.models.after.bodies['model/pin'], { visible: false });
  assert.deepEqual(parts.models.after.bodies['model/bracket'],
    { visible: true, opacity: 0.5, color: [1, 0, 0] });
  assert.deepEqual(parts.bodies['model/pin'], { visible: false }, 'the picker reads this map');
  assert.deepEqual(parts.models.before.bodies['model/body'], { visible: true });
  const preview = composePartsStyle(models, settingsOf,
    { after: { 'model/bracket': { opacity: 0.3, color: '#00ff00' } } });
  assert.deepEqual(preview.models.after.bodies['model/bracket'],
    { visible: true, opacity: 0.3, color: [0, 1, 0] }, 'a drag preview wins over settings');
  // The renderer and picker read the composed style.
  const style = composeStyle({ parts });
  const drawModel = {
    bodies: [{ id: 'model/pin' }, { id: 'model/bracket' }, { id: 'model/body' }],
  };
  assert.deepEqual([...hiddenMask(drawModel, style)], [1, 0, 0], 'hidden bodies are not pickable');
  const pin = resolveBodyStyle(style, 'after', { id: 'model/pin', index: 0 });
  assert.equal(pin.visible, false);
  const bracket = resolveBodyStyle(style, 'after', { id: 'model/bracket', index: 1 });
  assert.deepEqual([bracket.colorSource, bracket.opacity], ['override', 0.5]);
  // A new revision of the same source keeps the hidden body hidden before its
  // own entries are composed (shared map by body id).
  const next = resolveBodyStyle(style, 'r2', { id: 'model/pin', index: 0 });
  assert.equal(next.visible, false);
});

test('Y hides, Shift+Y shows all, I isolates, the eye toggles', () => {
  const parts = [{ id: 'a', key: 'A', visible: true }, { id: 'b', key: 'B', visible: true },
    { id: 'c', key: 'C', visible: false }];
  assert.deepEqual(visibilityPlan('hide', parts, new Set(['a'])),
    [{ key: 'A', id: 'a', visible: false }]);
  assert.deepEqual(visibilityPlan('hide', parts, new Set(['c'])), [], 'already hidden');
  assert.deepEqual(visibilityPlan('show-all', parts), [{ key: 'C', id: 'c', visible: true }]);
  assert.deepEqual(visibilityPlan('isolate', parts, new Set(['c'])), [
    { key: 'A', id: 'a', visible: false }, { key: 'B', id: 'b', visible: false },
    { key: 'C', id: 'c', visible: true }]);
  assert.deepEqual(visibilityPlan('toggle', parts, new Set(['b', 'c'])), [
    { key: 'B', id: 'b', visible: false }, { key: 'C', id: 'c', visible: true }]);
  assert.throws(() => visibilityPlan('explode', parts), /Unknown visibility action/);
});

test('the live attempt line names building, failed and cancelled attempts', () => {
  assert.equal(liveAttemptLine(null), null);
  assert.equal(liveAttemptLine({ attempt: { status: 'ok', revision: 2 } }), null);
  assert.deepEqual(liveAttemptLine({ attempt: { status: 'building', revision: 3,
    phase: 'evaluating' } }), { revision: 3, status: 'building', text: 'building · evaluating',
    failure: false });
  assert.deepEqual(liveAttemptLine({ attempt: { status: 'failed', revision: 4 }, failure: {
    kind: 'capability', error: { location: { file: '/w/part.fs', line: 24, column: 17 } } } }),
  { revision: 4, status: 'failed', text: 'fails · capability error at part.fs:24',
    failure: true });
  assert.equal(liveAttemptLine({ attempt: { status: 'cancelled', revision: 5 } }).text,
    'cancelled');
});

// ---- Markup ----

const part = (overrides = {}) => ({
  index: 0, alias: 'B1', id: 'model/base/0', name: 'Base plate', label: 'Base plate',
  settingsKey: 'Base plate', appearance: { red: 0.55, green: 0.68, blue: 0.58 },
  counts: { faces: 12, logicalFaces: 9, edges: 30, vertices: 20 }, volumeMm3: 11520,
  boundsMm: { min: [0, 0, 0], max: [60, 40, 9], size: [60, 40, 9] },
  operation: { id: 'model/base', type: 'boolean:UNION', name: 'opBoolean',
    source: { file: '/w/multi-body.fs', sha256: 'x', span: { line: 22, column: 5 } } },
  ...overrides,
});
const style = (overrides = {}) => ({
  visible: true, opacity: 1, hex: '#8cad94', colorSource: 'appearance', ...overrides,
});
const row = (overrides = {}) => ({
  part: part(), style: style(), selected: false, expanded: false, badges: '', details: '',
  actions: [], ...overrides,
});

test('counts read "12 faces (9 logical)"', () => {
  assert.equal(countsText({ faces: 12, logicalFaces: 9 }), '12 faces (9 logical)');
  assert.equal(countsText({ faces: 1, logicalFaces: 1 }), '1 face (1 logical)');
  assert.equal(countsText({ faces: 5, logicalFaces: null }), '5 faces (logical unavailable)');
  assert.equal(summaryText({ totals: { bodies: 4, faces: 63, logicalFaces: 28 } }, 1),
    '4 bodies · 63 faces (28 logical) · 1 hidden');
  assert.equal(summaryText({ totals: { bodies: 1, faces: 8, logicalFaces: 8 } }, 0),
    '1 body · 8 faces (8 logical)');
});

test('a row shows eye, swatch, name, alias, counts, color source and badges', () => {
  const markup = rowMarkup(row({ badges: '<span class="fdm-badge">on plate</span>' }));
  assert.match(markup, /data-part-eye="B1"[^>]*aria-pressed="true"/);
  assert.match(markup, /<rect[^>]*fill="#8cad94"/);
  assert.match(markup, /<span class="part-label">Base plate<\/span><code class="part-alias">B1/);
  assert.match(markup, /12 faces \(9 logical\)/);
  assert.match(markup, />appearance</);
  assert.match(markup, /<span class="part-badges"><span class="fdm-badge">on plate/);
  assert.doesNotMatch(markup, /part-details/, 'collapsed');
  assert.doesNotMatch(markup, /style="/, 'no inline style attributes');
  const palette = rowMarkup(row({
    style: style({ colorSource: 'viewer-palette', hex: '#a3bfdb' }),
  }));
  assert.match(palette, />viewer color</);
  assert.match(palette, /Viewer palette color; the model records no appearance \(#a3bfdb\)/);
  const hidden = rowMarkup(row({ style: style({ visible: false }) }));
  assert.match(hidden, /class="part-row is-hidden"/);
  assert.match(hidden, /aria-pressed="false"[^>]*title="Show Base plate"/);
  assert.match(hidden, />hidden</);
  const hostile = rowMarkup(row({ part: part({ label: '<img src=x>', alias: 'B1' }) }));
  assert.doesNotMatch(hostile, /<img/, 'names are escaped');
});

test('an expanded row has opacity, color, recorded facts, details and actions', () => {
  const markup = rowMarkup(row({
    expanded: true, style: style({ opacity: 0.45, colorSource: 'override', hex: '#ff0000' }),
    details: '<div class="fdm-detail">printed</div>',
    actions: [{ id: 'reviews.printBody', label: 'Export for print', icon: 'cube' }],
  }));
  assert.match(markup, /class="part-row is-expanded"/);
  assert.match(markup, /type="range" min="10" max="100" step="5" value="45"/);
  assert.match(markup, /<output data-part-opacity-value="B1">45 %<\/output>/);
  assert.match(markup, /type="color" value="#ff0000"/);
  assert.match(markup, />custom color</);
  assert.match(markup, /data-part-color-reset="B1"/);
  assert.match(markup, /11,520 mm³/);
  assert.match(markup, /exactness-recorded/);
  assert.match(markup, /60\.000 × 40\.000 × 9\.000 mm/);
  assert.match(markup, /opBoolean · multi-body\.fs:22/);
  assert.match(markup, /<div class="fdm-detail">printed<\/div>/);
  assert.match(markup, /data-part-action="reviews\.printBody" data-part="B1"/);
  assert.match(markup, /Export for print/);
  const missing = rowMarkup(row({ expanded: true, part: part({ volumeMm3: null,
    boundsMm: null }) }));
  assert.match(missing, /Volume<\/dt><dd><span>not evaluated/);
  assert.match(missing, /Size<\/dt><dd><span>not evaluated/);
});

test('colors convert both ways; the filter matches label, alias and id', () => {
  assert.equal(rgbToHex([0.55, 0.68, 0.58]), '#8cad94');
  assert.deepEqual(hexToRgb('#ff8000').map(value => Math.round(value * 255)), [255, 128, 0]);
  assert.equal(hexToRgb('red'), null);
  assert.ok(matchesPart(part(), 'plate'));
  assert.ok(matchesPart(part(), 'b1'));
  assert.ok(matchesPart(part(), 'model/base'));
  assert.ok(!matchesPart(part(), 'bracket'));
});

test('revisions below the tree: newest first, open badge, fold, live attempt', () => {
  const entries = Array.from({ length: 10 }, (_value, index) => ({
    id: `m${10 - index}`, text: `r${10 - index}`, title: '', open: index === 0, before: false,
  }));
  const markup = revisionsMarkup({ label: '/w/multi-body.fs', entries, live: null, limit: 8,
    showAll: false });
  assert.match(markup, /Revisions<\/span><span class="parts-source"[^>]*>multi-body\.fs/);
  assert.match(markup, /<span class="count">10<\/span>/);
  assert.equal((markup.match(/data-part-revision=/g) ?? []).length, 8);
  assert.match(markup, /data-part-revision="m10"[^>]*>.*?r10.*?Open/);
  assert.match(markup, />2 earlier</);
  const all = revisionsMarkup({ label: 'x', entries, live: null, limit: 8, showAll: true });
  assert.equal((all.match(/data-part-revision=/g) ?? []).length, 10);
  assert.match(all, />Show fewer</);
  const live = revisionsMarkup({ label: 'x', entries: entries.slice(0, 1), limit: 8,
    live: { revision: 11, status: 'failed', text: 'fails · input error at x.fs:3',
      failure: true } });
  assert.match(live, /parts-live-failed[^>]*><span class="revision-tag">r11<\/span>/);
  assert.match(live, /data-parts-live-details/);
  assert.equal(revisionsMarkup({ label: 'x', entries: [], live: null, limit: 8 }), '');
});

test('columns: state from settings with the first-paint cache as fallback', () => {
  assert.deepEqual(columnState(() => undefined, {}), { library: false, inspector: false });
  assert.deepEqual(columnState(() => undefined, { library: true }),
    { library: true, inspector: false });
  assert.deepEqual(columnState(key => key === 'inspectorCollapsed', { library: true }),
    { library: false, inspector: true }, 'loaded settings win over the cache');
  assert.equal(toggleLabel('library', false), 'Hide the library column ([)');
  assert.equal(toggleLabel('inspector', true), 'Show the inspector column (])');
  assert.deepEqual(COLUMNS.library.keys, ['[', 'Alt+[']);
});

// ---- Feature on the fake browser ----

const hex = character => character.repeat(64);
const sceneOf = id => ({ id, label: 'multi-body', bounds: { min: [0, 0, 0], max: [1, 1, 1] },
  bodies: ['model/base/0', 'model/pin'].map(bodyId => ({ id: bodyId,
    faces: [{ index: 0, triangles: [] }], edges: [], vertices: [] })) });
const partsDocumentOf = id => ({
  schema: 'wonky.viewer-parts/1', modelId: id,
  totals: { bodies: 2, faces: 49, logicalFaces: 14, edges: 95, vertices: 50 },
  bodies: [
    part(),
    part({ index: 1, alias: 'B2', id: 'model/pin', name: 'Pin', label: 'Pin', settingsKey: 'Pin',
      appearance: null, counts: { faces: 3, logicalFaces: 3, edges: 3, vertices: 2 } }),
  ],
});

function clientViewer({ settingsDocument = emptySettings(), features = legacy.features } = {}) {
  const puts = [];
  let document = structuredClone(settingsDocument);
  const models = [{ id: hex('a'), label: 'multi-body', sourcePath: '/w/multi-body.brep.json',
    bodyCount: 2 }];
  const dispatch = (path, options = {}) => {
    if (path === '/api/workspace') return { models, reports: [], feedback: [] };
    if (path === '/api/compare/revisions') throw new Error('facts unavailable');
    if (path === '/api/settings' && options.method === 'PUT') {
      const patch = JSON.parse(options.body);
      puts.push(patch);
      document = mergeSettings(document, patch);
      return document;
    }
    if (path === '/api/settings') return document;
    const parts = /^\/api\/models\/([a-f0-9]{64})\/parts$/.exec(path);
    if (parts) return partsDocumentOf(parts[1]);
    if (path.startsWith('/api/models/')) return sceneOf(path.slice('/api/models/'.length));
    return {};
  };
  const fake = createFakeEnvironment({ dispatch });
  const none = () => {};
  const viewer = createViewer(fake.env, {
    features: [...features, ...partsFeature.features], legacy: false,
    seams: { scheduleDraw: none, renderAnnotations: none, renderSaved: none, panel: none,
      renderInspector: none },
  });
  return { ...viewer.harness, ctx: viewer.ctx, app: viewer.ctx.app, node: fake.node, puts,
    settingsDocument: () => document };
}
const flush = async (count = 8) => {
  for (let index = 0; index < count; index++) await new Promise(resolve => setImmediate(resolve));
};

test('every feature loads with the parts feature and no key binding conflicts', () => {
  assert.deepEqual(all.failures, []);
  const fake = createFakeEnvironment({ dispatch: () => ({}) });
  const viewer = createViewer(fake.env, { features: all.features, log: () => {} });
  const { commands } = viewer.ctx;
  assert.deepEqual(commands.conflicts(), []);
  const keys = commands.bindings().filter(binding => binding.id.startsWith('parts.')
    || binding.id.startsWith('columns.')).map(binding => `${binding.id}:${binding.key}`);
  assert.deepEqual(keys.sort(), ['columns.inspector:Alt+]', 'columns.inspector:]',
    'columns.library:Alt+[', 'columns.library:[', 'parts.hide:Y', 'parts.isolate:I',
    'parts.showAll:Shift+Y']);
});

test('a multi-body model opens on Parts; Y / Shift+Y / I persist per body', async () => {
  const ui = clientViewer();
  await ui.startupWorkspace();
  await flush();
  const modelId = hex('a');
  assert.equal(ui.state.after, modelId);
  assert.equal(ui.app.partsState().active, true, 'two bodies: Parts is the default tab');
  assert.equal(ui.node('#parts-tab').getAttribute('aria-selected'), 'true');
  assert.equal(ui.node('#parts-panel').hidden, false);
  assert.match(ui.node('#parts-panel').innerHTML, /12 faces \(9 logical\)/);
  assert.match(ui.node('#parts-panel').innerHTML, />viewer color</, 'the pin has no appearance');
  assert.equal(ui.node('#parts-count').textContent, '2');
  // Y with a face of the pin selected hides the pin and drops the selection.
  ui.select({ modelId, bodyId: 'model/pin', entityType: 'face', entityIndex: 0 });
  ui.ctx.commands.run('parts.hide');
  await flush();
  assert.equal(ui.state.selection, null, 'hidden bodies leave the selection');
  const source = '/w/multi-body.brep.json';
  assert.deepEqual(ui.settingsDocument().bodies[source], { Pin: { visible: false } });
  const displayParts = ui.ctx.store.get().display.parts;
  assert.deepEqual(displayParts.models[modelId].bodies['model/pin'], { visible: false });
  assert.equal(displayParts.bodies['model/pin'].visible, false);
  assert.match(ui.node('#parts-panel').innerHTML,
    /2 bodies · 49 faces \(14 logical\) · 1 hidden/);
  // Shift+Y shows every body again.
  ui.ctx.commands.run('parts.showAll');
  await flush();
  assert.deepEqual(ui.settingsDocument().bodies, {}, 'visible is the default: nothing stored');
  // I isolates the selected body.
  ui.select({ modelId, bodyId: 'model/base/0', entityType: 'body', entityIndex: 0 });
  ui.ctx.commands.run('parts.isolate');
  await flush();
  assert.deepEqual(ui.settingsDocument().bodies[source], { Pin: { visible: false } });
  assert.equal(ui.state.selection?.bodyId, 'model/base/0', 'the isolated body stays selected');
  // A restart with the saved settings keeps the pin hidden.
  const again = clientViewer({ settingsDocument: ui.settingsDocument() });
  await again.startupWorkspace();
  await flush();
  const rows = again.app.partsState().rows;
  assert.deepEqual(rows.map(entry => [entry.key, entry.visible]),
    [['Base plate', true], ['Pin', false]]);
  assert.equal(again.ctx.store.get().display.parts.bodies['model/pin'].visible, false);
});

test('an explicit Models choice is remembered per source and wins on restart', async () => {
  const ui = clientViewer();
  await ui.startupWorkspace();
  await flush();
  ui.node('#models-tab').emit('click');
  await flush();
  assert.equal(ui.app.partsState().active, false);
  assert.equal(ui.app.partsState().manual, true);
  assert.deepEqual(ui.settingsDocument().sources['/w/multi-body.brep.json'],
    { libraryTab: 'models' });
  const again = clientViewer({ settingsDocument: ui.settingsDocument() });
  await again.startupWorkspace();
  await flush();
  assert.equal(again.app.partsState().active, false, 'the stored choice wins');
});

test('[ and ] collapse the columns; the state is a global setting', async () => {
  const ui = clientViewer();
  await ui.startupWorkspace();
  await flush();
  ui.ctx.commands.run('columns.library');
  ui.ctx.commands.run('columns.inspector');
  await flush();
  assert.deepEqual(ui.app.partsState().columns, { library: true, inspector: true });
  assert.equal(ui.node('.workspace').getAttribute('data-library-collapsed'), '');
  assert.equal(ui.node('#library-column-toggle').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(ui.settingsDocument().global,
    { libraryCollapsed: true, inspectorCollapsed: true });
  const again = clientViewer({ settingsDocument: ui.settingsDocument() });
  await again.startupWorkspace();
  await flush();
  assert.deepEqual(again.app.partsState().columns, { library: true, inspector: true });
  again.ctx.commands.run('columns.library');
  await flush();
  assert.deepEqual(again.settingsDocument().global, { inspectorCollapsed: true });
});
