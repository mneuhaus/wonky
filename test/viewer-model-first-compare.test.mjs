import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("viewer-model-first-compare.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { mkdtemp, readFile, rm, writeFile, mkdir } = await import("node:fs/promises");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { build } = await import("../src/index.mjs");
const { createReviewServer } = await import("../src/review-server.mjs");
const { changedSourceLines, lineRanges, splitLines } = await import("../src/viewer/source-diff.mjs");
const { boundsDelta, compareModels, compareSources, describeRevisions, revisionSource } = await import("../src/viewer/compare.mjs");
const { mergeSettings, emptySettings } = await import("../src/viewer/settings.mjs");
const { createViewer } = await import("../viewer/app.js");
const { loadFeatures } = await import("../viewer/core/feature-loader.js");
const { LEGACY_FEATURES } = await import("../viewer/features/index.js");
const { formatRevisionTime, groupRevisions, indexRevisions, localFacts, revisionText } = await import("../viewer/features/library/revisions.js");
const { deltaItems, facesText, lineRanges: clientLineRanges, signed, sourceExcerpt, sourceText } = await import("../viewer/features/compare/delta-strip.js");
const { createFakeEnvironment } = await import("../scripts/viewer/test-support/fake-env.mjs");
// model-first-compare: source line diff, compareModels, revision facts, the
// compare routes against real built revisions, and the client behavior
// (model-first startup, persisted compare mode, W, LIB-03, grouping, delta
// strip) on the fake browser environment with the legacy feature set in
// non-legacy mode.

















const { features: legacyFeatures, failures } = await loadFeatures(LEGACY_FEATURES);
assert.deepEqual(failures, []);

// ---------------------------------------------------------------------------
// Source line diff

const lcs = (a, b) => {
  const table = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      table[i][j] = a[i - 1] === b[j - 1] ? table[i - 1][j - 1] + 1
        : Math.max(table[i - 1][j], table[i][j - 1]);
    }
  }
  return table[a.length][b.length];
};

test('changed source lines number changed and added lines in the after text', () => {
  assert.deepEqual(splitLines(''), []);
  assert.deepEqual(splitLines('a\nb\n'), ['a', 'b']);
  const result = changedSourceLines('a\nb\nc\nd\ne\n', 'a\nB\nc\nd\nx\ny\ne\n');
  assert.deepEqual([result.changed, result.added, result.removed], [[2], [5, 6], []]);
  assert.deepEqual(result.changedFrom, [2]);
  assert.deepEqual([result.beforeLines, result.afterLines, result.coarse], [5, 7, false]);
  const excerpt = sourceExcerpt(result, {
    before: 'a\nb\nc\nd\ne\n', after: 'a\nB\nc\nd\nx\ny\ne\n',
  });
  const row = (kind, line, mark, code) => new RegExp(`${kind}"><span class="line-number">`
    + `${line}</span><span class="line-mark">${mark}</span><code>${code}<`);
  assert.match(excerpt, row('removed', 2, '−', 'b'));
  assert.match(excerpt, row('changed', 2, '\\+', 'B'));
  assert.match(sourceExcerpt(result), /line-number">6</, 'line numbers without texts');
  const removed = changedSourceLines('a\nb\nc\n', 'a\nc\n');
  assert.deepEqual([removed.changed, removed.added, removed.removed], [[], [], [2]]);
  assert.deepEqual(changedSourceLines('x\n', 'x\n').changed, []);
  assert.deepEqual(changedSourceLines('', 'x\n').added, [1]);
  const coarse = changedSourceLines('a\nb\nc\nd\n', 'w\nx\ny\nz\n', { maxEdits: 2 });
  assert.equal(coarse.coarse, true);
  assert.deepEqual(coarse.changed, [1, 2, 3, 4]);
  assert.equal(lineRanges([1, 2, 3, 5, 7, 8]), '1-3, 5, 7-8');
  assert.equal(clientLineRanges([9, 7, 8, 1]), '1, 7-9');
});

test('the line diff is a shortest edit script (property check against LCS)', () => {
  let seed = 7;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const lines = () => Array.from({ length: Math.floor(random() * 12) },
    () => 'abcde'[Math.floor(random() * 5)]);
  for (let run = 0; run < 300; run++) {
    const a = lines();
    const b = lines();
    const result = changedSourceLines(a.map(line => `${line}\n`).join(''),
      b.map(line => `${line}\n`).join(''));
    const edits = 2 * result.changed.length + result.added.length + result.removed.length;
    assert.equal(edits, a.length + b.length - 2 * lcs(a, b), `${a.join('')} -> ${b.join('')}`);
    for (const line of [...result.changed, ...result.added]) {
      assert.ok(line >= 1 && line <= b.length);
    }
    assert.equal(result.changedFrom.length, result.changed.length);
    for (const line of result.removed) assert.ok(line >= 1 && line <= a.length);
  }
});

// ---------------------------------------------------------------------------
// compareModels on synthetic models (counts only need arrays)

const face = () => ({ surface: { type: 'plane' }, loops: [] });
const body = (id, { faces = 6, edges = 12, volume = 1000, bounds = [[0, 0, 0], [10, 10, 10]] }
  = {}) => ({
  id, faces: Array.from({ length: faces }, face), edges: Array.from({ length: edges }, () => ({})),
  vertices: Array.from({ length: 8 }, () => [0, 0, 0]),
  validation: { volumeMm3: volume, boundsMm: bounds && { min: bounds[0], max: bounds[1] } },
});
const model = (bodies, source) => ({
  schema: 'wonky-brep/1', bodies,
  ...(source ? { sourceMap: { source } } : {}),
});
const halfLogical = value => ({
  bodies: value.bodies.map(entry => ({
    groups: Array.from({ length: Math.ceil(entry.faces.length / 2) }, () => ({})),
  })),
});

test('compareModels reports raw and logical counts, recorded volume and labelled bounds', () => {
  const before = model([body('a'), body('gone', { faces: 4 })]);
  const after = model([body('a', { faces: 8, edges: 18, volume: 1500,
    bounds: [[0, 0, 0], [10, 25, 16]] }), body('new', { faces: 2 })]);
  const { deltas, sourceLines } = compareModels(before, after, { logical: halfLogical });
  assert.deepEqual(deltas.bodies, { before: 2, after: 2, delta: 0 });
  assert.deepEqual(deltas.faces, { before: 10, after: 10, delta: 0 });
  assert.deepEqual(deltas.logicalFaces, { before: 5, after: 5, delta: 0 });
  assert.equal(deltas.volumeMm3.status, 'evaluated');
  assert.equal(deltas.volumeMm3.delta, 500);
  assert.equal(deltas.volumeMm3.exactness, 'recorded');
  assert.equal(deltas.bounds.exactness, 'recorded');
  assert.equal(deltas.bounds.toleranceMm, 0);
  assert.deepEqual(deltas.bounds.delta.size, [0, 15, 6]);
  assert.deepEqual(deltas.bodyMatches.map(row => [row.bodyId, row.status]),
    [['a', 'matched'], ['new', 'added'], ['gone', 'removed']]);
  assert.deepEqual(deltas.bodyMatches[0].faces, { before: 6, after: 8, delta: 2 });
  assert.equal(sourceLines.status, 'unavailable');
});

test('null recorded values stay not evaluated; display bounds carry their tolerance', () => {
  const before = { model: model([body('a', { volume: null, bounds: null })]),
    displayBounds: { min: [0, 0, 0], max: [4, 4, 10], toleranceMm: 0.02 } };
  const after = model([body('a', { volume: 12, bounds: [[0, 0, 0], [4, 4, 12]] })]);
  const { deltas } = compareModels(before, after, { logical: halfLogical });
  assert.equal(deltas.volumeMm3.status, 'not evaluated');
  assert.equal(deltas.volumeMm3.delta, null);
  assert.deepEqual(deltas.volumeMm3.notEvaluated, ['before']);
  assert.equal(deltas.bounds.exactness, 'display-approximation');
  assert.equal(deltas.bounds.toleranceMm, 0.02);
  assert.deepEqual(deltas.bounds.delta.size, [0, 0, 2]);
  const blind = compareModels(model([body('a', { bounds: null })]), after,
    { logical: halfLogical });
  assert.equal(blind.deltas.bounds.status, 'not evaluated');
  assert.equal(boundsDelta(null, null).delta, null);
  const failing = compareModels(after, after, { logical: () => {
    throw new Error('topology unavailable');
  } });
  assert.equal(failing.deltas.logicalFaces.status, 'unavailable');
  assert.equal(failing.deltas.logicalFaces.reason, 'topology unavailable');
});

test('source comparison: unchanged, different files, unavailable and changed lines', () => {
  const source = (file, sha, text) => ({ file, sha256: sha.repeat(64), text });
  assert.equal(compareSources(source('a.fs', 'a', 'x'), source('a.fs', 'a', 'x')).status,
    'unchanged');
  assert.equal(compareSources(source('a.fs', 'a', 'x'), source('b.fs', 'b', 'y')).status,
    'different-files');
  const missing = compareSources(source('a.fs', 'a', null), source('a.fs', 'b', 'y'));
  assert.equal(missing.status, 'unavailable');
  assert.match(missing.reason, /before revision/);
  assert.equal(compareSources(null, source('a.fs', 'b', 'y')).status, 'unavailable');
  const changed = compareSources(source('a.fs', 'a', 'x\ny\n'), source('a.fs', 'b', 'x\nz\n'));
  assert.equal(changed.status, 'changed');
  assert.deepEqual(changed.changed, [2]);
  assert.equal(changed.after.text, undefined, 'texts are not echoed');
});

// Regression (fix round 3, verify:live#3): after a rebuild caused by an
// edited import (dims.py), the delta strip said "source unchanged".
test('source comparison lists changed imported modules; the strip names them', () => {
  const main = { file: '/w/main.py', sha256: 'm', language: 'python', text: 'x' };
  const modules = sha => [{ path: '/w/dims.py', sha256: sha }, { path: '/w/helper.py',
    sha256: 'h' }];
  const imported = compareSources({ ...main, modules: modules('a') },
    { ...main, modules: [...modules('b'), { path: '/w/extra.py', sha256: 'e' }] });
  assert.equal(imported.status, 'unchanged');
  assert.equal(imported.modulesChanged, true);
  assert.deepEqual(imported.modules, { changed: ['/w/dims.py'], added: ['/w/extra.py'],
    removed: [] });
  assert.equal(sourceText(imported), 'source unchanged · imports: dims.py changed, extra.py added');
  const strip = deltaItems({ deltas: {
    bodies: { delta: 0 }, faces: { delta: 0 }, logicalFaces: { delta: 0 }, edges: { delta: 0 },
    volumeMm3: { status: 'not evaluated', notEvaluated: ['before'] },
    bounds: { status: 'not evaluated' },
  }, sourceLines: imported }).find(item => item.key === 'source');
  assert.equal(strip.changed, true, 'the source item is marked changed');
  const same = compareSources({ ...main, modules: modules('a') }, { ...main, modules: modules('a') });
  assert.equal(same.modulesChanged, false);
  assert.equal(sourceText(same), 'source unchanged');
  assert.equal(compareSources(main, main).modules, null, 'no module list recorded: null');
  // compareModels reads the module list from the models themselves.
  const model = sha => ({ schema: 'wonky-brep/1', bodies: [], source: { modules: modules(sha) } });
  const compared = compareModels({ model: model('a'), source: main },
    { model: model('b'), source: main });
  assert.deepEqual(compared.sourceLines.modules.changed, ['/w/dims.py']);
});

test('revision facts: kinds, per-source numbering, live revision numbers', () => {
  const list = [
    { id: '1', sourcePath: '/w/a.brep.json' },
    { id: '2', sourcePath: '/w/b.brep.json' },
    { id: '3', sourcePath: '/w/a.brep.json' },
    { id: '4', sourcePath: '/r/models/' + 'f'.repeat(64) + '.brep.json' },
    { id: '5', sourcePath: '/w/part.fs', live: { path: '/w/part.fs', revision: 7 } },
  ];
  const facts = describeRevisions(list, {
    snapshotDirectory: '/r/models',
    modelOf: id => ({ sourceMap: { source: { file: `${id}.fs`, sha256: 'x' } } }),
    timeOf: metadata => (metadata.id === '3' ? { at: 'T', basis: 'first-registered' } : null),
  });
  assert.deepEqual(facts.map(fact => [fact.kind, fact.source, fact.revision]), [
    ['input', '/w/a.brep.json', 1], ['input', '/w/b.brep.json', 1], ['input', '/w/a.brep.json', 2],
    ['archive', 'archive', null], ['live', '/w/part.fs', 7],
  ]);
  assert.equal(facts[0].recordedSource, null, 'only archived snapshots read their model');
  assert.deepEqual(facts[3].recordedSource, { file: '4.fs', sha256: 'x', language: null });
  assert.deepEqual([facts[2].time, facts[2].timeBasis], ['T', 'first-registered']);
  assert.deepEqual(revisionSource({ id: 'z' }), { kind: 'input', source: 'z' });
});

test('client grouping: newest first per source, archive last, previous revision', () => {
  const snapshot = '/r/models/' + 'e'.repeat(64) + '.brep.json';
  const models = [
    { id: 'a1', label: 'bracket', sourcePath: '/w/bracket.brep.json' },
    { id: 's1', label: 'spacer', sourcePath: '/w/spacer.brep.json' },
    { id: 'old', label: 'Saved revision eeee', sourcePath: snapshot },
    { id: 'a2', label: 'bracket', sourcePath: '/w/bracket.brep.json' },
    { id: 'a3', label: 'bracket', sourcePath: '/w/bracket.brep.json' },
  ];
  const groups = groupRevisions(models, localFacts(models));
  assert.deepEqual(groups.map(group => [group.key, group.revisions.map(entry => entry.id)]), [
    ['/w/bracket.brep.json', ['a3', 'a2', 'a1']], ['/w/spacer.brep.json', ['s1']],
    ['archive', ['old']],
  ]);
  const index = indexRevisions(groups);
  assert.equal(index.get('a3').previous.id, 'a2');
  assert.equal(index.get('a1').previous, null);
  assert.equal(index.get('old').previous, null, 'archived snapshots have no previous');
  assert.equal(revisionText(index.get('a3').entry), 'r3');
  const now = new Date(2026, 8, 22, 18, 0);
  assert.equal(formatRevisionTime(new Date(2026, 8, 22, 14, 5).toISOString(), now), '14:05');
  assert.equal(formatRevisionTime(new Date(2026, 8, 21, 9, 7).toISOString(), now), 'Sep 21 09:07');
  assert.equal(formatRevisionTime(null, now), null);
});

test('delta strip texts: counts, logical counts, signed volume, source lines', () => {
  assert.equal(signed(0), '0');
  assert.equal(signed(1234.56, 1), '+1,234.6');
  assert.equal(signed(-2), '−2');
  const deltas = {
    bodies: { before: 1, after: 1, delta: 0 }, faces: { before: 8, after: 9, delta: 1 },
    logicalFaces: { before: 8, after: 9, delta: 1 }, edges: { before: 18, after: 21, delta: 3 },
    volumeMm3: { before: 8832, after: 14784, delta: 5952, status: 'evaluated' },
    bounds: { status: 'evaluated', exactness: 'recorded', toleranceMm: 0,
      before: { size: [50, 40, 8] }, after: { size: [50, 55, 14] },
      delta: { size: [0, 15, 6] } },
  };
  assert.equal(facesText(deltas), 'faces 8 → 9 (logical 8 → 9)');
  const items = deltaItems({ deltas, sourceLines: { status: 'changed', changed: [25, 26, 37],
    added: [], removed: [] } });
  assert.deepEqual(items.map(item => item.text), ['bodies 1', 'faces 8 → 9 (logical 8 → 9)',
    'edges 18 → 21', 'volume +5,952 mm³', 'bounds Δ 0 × +15 × +6 mm',
    'source: lines 25-26, 37 changed']);
  assert.match(items[3].chip, /exactness-recorded/);
  assert.match(items[4].chip, />recorded</);
  assert.equal(sourceText({ status: 'unchanged' }), 'source unchanged');
  assert.equal(sourceText({ status: 'changed', changed: [], added: [4], removed: [] }),
    'source: line 4 added');
  const display = deltaItems({ deltas: { ...deltas,
    volumeMm3: { before: null, after: 3, delta: null, status: 'not evaluated' },
    bounds: { ...deltas.bounds, exactness: 'display-approximation', toleranceMm: 0.04 } },
  sourceLines: { status: 'unavailable', reason: 'x' } });
  assert.equal(display[3].text, 'volume not evaluated');
  assert.match(display[4].chip, /display ±0.04/);
  assert.equal(display[5].text, 'source: not comparable');
});

// ---------------------------------------------------------------------------
// Routes against real revisions of one source

const bracket = async (directory, { arm = 40, thickness = 8 } = {}) => {
  const text = (await readFile(new URL('../examples/bracket.fs', import.meta.url), 'utf8'))
    .replaceAll('vector(18, 40)', `vector(18, ${arm})`)
    .replaceAll('vector(0, 40)', `vector(0, ${arm})`)
    .replace('"thickness" : 8 * millimeter', `"thickness" : ${thickness} * millimeter`);
  const sourcePath = join(directory, 'bracket.fs');
  await writeFile(sourcePath, text);
  const built = await build(text, { sourcePath });
  const output = join(directory, 'bracket.brep.json');
  await writeFile(output, JSON.stringify(built, null, 2) + '\n');
  return { output, text };
};

test('compare routes: revisions per source, deltas and changed source lines', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wonky-compare-'));
  const reviews = join(directory, 'reviews');
  await mkdir(reviews);
  let server;
  try {
    const first = await bracket(directory);
    server = await createReviewServer({ modelPaths: [first.output], root: directory,
      reviewDirectory: reviews, port: 0 });
    const base = server.origin;
    await bracket(directory, { arm: 55, thickness: 14 });
    const workspace = await (await fetch(base + '/api/workspace')).json();
    assert.equal(workspace.models.length, 2);
    const [before, after] = workspace.models.map(entry => entry.id);
    const facts = await (await fetch(base + '/api/compare/revisions')).json();
    assert.equal(facts.schema, 'wonky.revisions/1');
    assert.deepEqual(facts.revisions.map(fact => [fact.modelId, fact.kind, fact.revision]),
      [[before, 'input', 1], [after, 'input', 2]]);
    assert.ok(facts.revisions.every(fact => fact.timeBasis === 'first-registered' && fact.time));
    assert.equal(facts.revisions[0].source, facts.revisions[1].source);
    const response = await fetch(`${base}/api/compare?before=${before}&after=${after}`);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.schema, 'wonky.compare/1');
    assert.deepEqual(result.deltas.bodies, { before: 1, after: 1, delta: 0 });
    assert.equal(result.deltas.faces.delta, 0);
    assert.ok(Number.isInteger(result.deltas.logicalFaces.after));
    assert.equal(result.deltas.volumeMm3.status, 'evaluated');
    assert.ok(result.deltas.volumeMm3.delta > 0);
    assert.equal(result.deltas.bounds.exactness, 'recorded');
    assert.deepEqual(result.deltas.bounds.delta.size.map(value => Math.round(value * 1e6) / 1e6),
      [0, 15, 6]);
    assert.equal(result.sourceLines.status, 'changed');
    assert.ok(result.sourceLines.changed.length >= 3);
    for (const [query, status] of [['after=' + after, 400], ['before=x&after=' + after, 400],
      [`before=${'0'.repeat(64)}&after=${after}`, 404]]) {
      assert.equal((await fetch(`${base}/api/compare?${query}`)).status, status, query);
    }
    await server.close();
    // After a restart the old revision is an archived snapshot; the current
    // input starts again at r1 of its source.
    server = await createReviewServer({ modelPaths: [first.output], root: directory,
      reviewDirectory: reviews, port: 0 });
    const restarted = await (await fetch(server.origin + '/api/compare/revisions')).json();
    const byId = new Map(restarted.revisions.map(fact => [fact.modelId, fact]));
    assert.equal(byId.get(after).kind, 'input');
    assert.equal(byId.get(after).revision, 1);
    assert.equal(byId.get(before).kind, 'archive');
    assert.equal(byId.get(before).revision, null);
    assert.equal(byId.get(before).recordedSource.file, join(directory, 'bracket.fs'));
  } finally {
    await server?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Client behavior (fake browser, legacy feature set, non-legacy mode)

const hex = character => character.repeat(64);
const sceneOf = id => ({ id, label: id.slice(0, 1), bounds: { min: [0, 0, 0], max: [1, 1, 1] },
  bodies: [{ id: 'part', faces: [{ index: 0, triangles: [] }], edges: [], vertices: [] }] });

function clientViewer({ models, facts = null, settingsDocument = emptySettings() } = {}) {
  const requests = [];
  const puts = [];
  let document = structuredClone(settingsDocument);
  const dispatch = (path, options = {}) => {
    requests.push(path);
    if (path === '/api/workspace') return { models, reports: [], feedback: [] };
    if (path === '/api/compare/revisions') {
      if (!facts) throw new Error('facts unavailable');
      return facts;
    }
    if (path === '/api/settings' && options.method === 'PUT') {
      const patch = JSON.parse(options.body);
      puts.push(patch);
      document = mergeSettings(document, patch);
      return document;
    }
    if (path === '/api/settings') return document;
    if (path.startsWith('/api/models/')) return sceneOf(path.slice('/api/models/'.length));
    if (path.startsWith('/api/compare?')) {
      const query = new URLSearchParams(path.split('?')[1]);
      return { schema: 'wonky.compare/1', before: { modelId: query.get('before') },
        after: { modelId: query.get('after') }, deltas: {
          bodies: { before: 1, after: 1, delta: 0 }, faces: { before: 8, after: 9, delta: 1 },
          logicalFaces: { before: 8, after: 9, delta: 1 },
          edges: { before: 18, after: 21, delta: 3 }, vertices: { before: 12, after: 14, delta: 2 },
          volumeMm3: { before: 1, after: 2, delta: 1, status: 'evaluated' },
          bounds: { status: 'not evaluated', delta: null }, bodyMatches: [] },
        sourceLines: { status: 'changed', changed: [5, 7], added: [], removed: [] } };
    }
    return {};
  };
  const fake = createFakeEnvironment({ dispatch });
  const none = () => {};
  const viewer = createViewer(fake.env, {
    features: legacyFeatures, legacy: false,
    seams: { scheduleDraw: none, renderAnnotations: none, renderSaved: none, panel: none,
      renderInspector: none },
  });
  return { ...viewer.harness, app: viewer.ctx.app, env: fake.env, node: fake.node,
    document: fake.document, requests, puts, settingsDocument: () => document };
}
const flush = async (count = 6) => {
  for (let index = 0; index < count; index++) await new Promise(resolve => setImmediate(resolve));
};

const tenModels = Array.from('abcdefghij', (character, index) => ({
  id: hex(character), label: `model-${index}`, sourcePath: `/w/model-${index}.brep.json`,
  bodyCount: 1,
}));
tenModels[5].label = 'compare-before';
tenModels[6].label = 'compare-after';

test('startup is model-first: one model, no compare chrome, store default unchanged', async () => {
  const ui = clientViewer({ models: tenModels });
  assert.equal(ui.state.compare, true, 'the store initial value stays compare: true');
  await ui.startupWorkspace();
  assert.equal(ui.state.compare, false);
  assert.equal(ui.state.after, tenModels[0].id, 'the first model of the command line');
  assert.equal(ui.node('.version-bar').dataset.mode, 'single');
  assert.equal(ui.node('#comparison-bar').hidden, true);
  assert.equal(ui.node('#stage').dataset.layout, 'single');
  assert.equal(ui.node('#model-bar-name').textContent, 'model-0');
  assert.equal(ui.node('#model-bar-revision').textContent, 'r1');
  assert.match(ui.node('#delta-strip').innerHTML, /No earlier revision of this source/);
  assert.ok(ui.requests.includes('/api/compare/revisions'));
});

test('compare mode is persisted per source and restored at startup', async () => {
  const models = [
    { id: hex('a'), label: 'bracket', sourcePath: '/w/bracket.brep.json' },
    { id: hex('b'), label: 'bracket', sourcePath: '/w/bracket.brep.json' },
  ];
  const facts = { revisions: models.map((entry, index) => ({ modelId: entry.id, kind: 'input',
    source: entry.sourcePath, revision: index + 1, time: null, timeBasis: null,
    recordedSource: null })) };
  const ui = clientViewer({ models, facts });
  await ui.startupWorkspace();
  assert.equal(ui.state.after, hex('b'), 'the newest revision of the first source');
  assert.equal(ui.state.compare, false);
  await ui.app.comparePrevious();
  await flush();
  assert.equal(ui.state.compare, true);
  assert.equal(ui.state.before, hex('a'));
  assert.equal(ui.node('.version-bar').dataset.mode, 'compare');
  assert.deepEqual(ui.settingsDocument().sources['/w/bracket.brep.json'], { compare: true });
  // A restart with the saved settings reopens compare against the previous revision.
  const again = clientViewer({ models, facts, settingsDocument: ui.settingsDocument() });
  await again.startupWorkspace();
  assert.equal(again.state.compare, true);
  assert.equal(again.state.before, hex('a'));
  await again.app.comparePrevious();
  await flush();
  assert.equal(again.state.compare, false);
  assert.equal(again.settingsDocument().sources['/w/bracket.brep.json'].compare, false);
  const third = clientViewer({ models, facts, settingsDocument: again.settingsDocument() });
  await third.startupWorkspace();
  assert.equal(third.state.compare, false, 'compare off survives a restart');
});

test('W without a sibling revision opens compare with the before selector focused', async () => {
  const ui = clientViewer({ models: tenModels });
  await ui.startupWorkspace();
  await ui.app.comparePrevious();
  await flush();
  assert.equal(ui.state.compare, true);
  assert.equal(ui.state.before, ui.state.after);
  assert.equal(ui.document.activeElement, ui.node('#before-model'));
  assert.match(ui.node('#delta-strip').innerHTML, /Choose a before model/);
  assert.match(ui.node('#toast').textContent, /No earlier revision/);
  // Persisted on, but nothing to compare against: the next start stays single.
  const again = clientViewer({ models: tenModels, settingsDocument: ui.settingsDocument() });
  await again.startupWorkspace();
  assert.equal(again.state.compare, false);
});

test('a cross-source library click leaves compare and fits; same source keeps before', async () => {
  const models = [
    { id: hex('a'), label: 'bracket', sourcePath: '/w/bracket.brep.json' },
    { id: hex('b'), label: 'bracket', sourcePath: '/w/bracket.brep.json' },
    { id: hex('c'), label: 'bracket', sourcePath: '/w/bracket.brep.json' },
    { id: hex('d'), label: 'spacer', sourcePath: '/w/spacer.brep.json' },
  ];
  const ui = clientViewer({ models });
  await ui.startupWorkspace();
  assert.equal(ui.state.after, hex('c'));
  await ui.app.comparePrevious();
  await flush();
  assert.equal(ui.state.before, hex('b'));
  // The loader's resetCamera flag is the fit request (camera-navigation turns
  // it into its fit policy); record it.
  const load = ui.app.loadSelectedModels;
  const fits = [];
  ui.app.loadSelectedModels = (resetCamera, ...rest) => {
    fits.push(resetCamera);
    return load(resetCamera, ...rest);
  };
  const yaw = ui.state.camera.yaw + 0.5;
  ui.state.camera.yaw = yaw;
  ui.app.openModel(hex('a'));
  await flush();
  assert.equal(ui.state.compare, true, 'a same-source click keeps compare');
  assert.equal(ui.state.before, hex('b'), 'and the before model');
  assert.equal(ui.state.camera.yaw, yaw, 'and the camera');
  ui.app.openModel(hex('d'));
  await flush();
  assert.equal(ui.state.compare, false, 'a cross-source click leaves compare');
  assert.deepEqual(fits, [false, true], 'and fits');
  assert.equal(ui.node('#stage').dataset.layout, 'single');
  assert.equal(ui.settingsDocument().sources['/w/bracket.brep.json'].compare, true,
    'leaving by navigation does not rewrite the source setting');
});

test('library groups revisions newest first and folds older ones', async () => {
  const models = [
    { id: hex('a'), label: 'bracket', sourcePath: '/w/bracket.brep.json', bodyCount: 1 },
    { id: hex('d'), label: 'spacer', sourcePath: '/w/spacer.brep.json', bodyCount: 1 },
    { id: hex('b'), label: 'bracket', sourcePath: '/w/bracket.brep.json', bodyCount: 1 },
    { id: hex('c'), label: 'bracket', sourcePath: '/w/bracket.brep.json', bodyCount: 1 },
  ];
  const ui = clientViewer({ models });
  await ui.startupWorkspace();
  const markup = ui.node('#library-content').innerHTML;
  assert.ok(markup.indexOf(hex('c')) < markup.indexOf(hex('d')), 'newest bracket first');
  assert.match(markup, /r3<\/span>/);
  assert.match(markup, /2 earlier/);
  assert.doesNotMatch(markup, new RegExp(`data-model="${hex('a')}"`), 'r1 is folded');
  const options = ui.node('#before-model').innerHTML;
  assert.match(options, /<optgroup label="bracket \(this source\)">/);
  assert.ok(options.indexOf(hex('c')) < options.indexOf(hex('d')), 'same source first');
});

test('the delta strip compares with the previous revision; layout is a global setting',
  async () => {
    const models = [
      { id: hex('a'), label: 'bracket', sourcePath: '/w/bracket.brep.json' },
      { id: hex('b'), label: 'bracket', sourcePath: '/w/bracket.brep.json' },
    ];
    const ui = clientViewer({ models });
    await ui.startupWorkspace();
    await flush();
    assert.ok(ui.requests.includes(`/api/compare?before=${hex('a')}&after=${hex('b')}`));
    const strip = ui.node('#delta-strip').innerHTML;
    assert.match(strip, /Δ vs r1/);
    assert.match(strip, /faces 8 → 9 \(logical 8 → 9\)/);
    assert.match(strip, /source: lines 5, 7 changed/);
    assert.match(strip, /bounds not evaluated/);
    ui.setLayout('side-by-side');
    await flush();
    assert.equal(ui.settingsDocument().global.compareLayout, 'side-by-side');
    const again = clientViewer({ models, settingsDocument: ui.settingsDocument() });
    await again.startupWorkspace();
    assert.equal(again.state.layout, 'side-by-side');
  });

test('archived snapshots have no source setting; W on them opens the before selector',
  async () => {
    const snapshot = id => `/r/models/${id}.brep.json`;
    const models = [
      { id: hex('a'), label: 'bracket', sourcePath: '/w/bracket.brep.json' },
      { id: hex('e'), label: 'Saved revision eeeeeeee', sourcePath: snapshot(hex('e')) },
      { id: hex('f'), label: 'Saved revision ffffffff', sourcePath: snapshot(hex('f')) },
    ];
    const ui = clientViewer({ models });
    await ui.startupWorkspace();
    assert.equal(ui.state.after, hex('a'), 'the input, not an archived snapshot');
    assert.equal(ui.app.sourceKey(hex('e')), null);
    assert.equal(ui.app.sameSource(hex('e'), hex('f')), false);
    ui.app.openModel(hex('e'));
    await flush();
    await ui.app.comparePrevious();
    await flush();
    assert.equal(ui.state.compare, true);
    assert.equal(ui.state.before, hex('e'), 'no previous: before = after, selector open');
    assert.equal(ui.document.activeElement, ui.node('#before-model'));
    assert.deepEqual(ui.settingsDocument().sources, {}, 'nothing persisted without a source');
    assert.match(ui.node('#library-content').innerHTML, /Archived snapshots/);
  });

test('a review in the URL restores its own compare mode after the model-first start',
  async () => {
    const models = [
      { id: hex('a'), label: 'one', sourcePath: '/w/one.brep.json' },
      { id: hex('b'), label: 'two', sourcePath: '/w/two.brep.json' },
    ];
    const ui = clientViewer({ models });
    const review = { id: 'WKR-AAAAAAAAAA', title: 'r', notes: '', annotations: [],
      camera: { yaw: 1, pitch: 0, zoom: 1, pan: [0, 0] },
      comparison: { before: hex('a'), after: hex('b'), split: 0.4, compare: true,
        layout: 'side-by-side' } };
    const fetch = ui.env.fetch;
    ui.env.fetch = async (path, options) => (path === '/api/feedback/' + review.id
      ? { ok: true, json: async () => structuredClone(review) } : fetch(path, options));
    ui.env.location.hash = '#review=' + review.id;
    await ui.startupWorkspace();
    await flush();
    assert.equal(ui.state.compare, true);
    assert.equal(ui.state.layout, 'side-by-side');
    assert.equal(ui.state.before, hex('a'));
    assert.equal(ui.state.after, hex('b'));
    assert.deepEqual(ui.settingsDocument().global, {}, 'a review layout is not the global one');
  });

test('the legacy load path makes no compare, revisions or settings request', async () => {
  const requests = [];
  const fake = createFakeEnvironment({ dispatch: path => {
    requests.push(path);
    if (path === '/api/workspace') {
      return { models: [{ id: hex('a'), label: 'A' }, { id: hex('b'), label: 'B' }], reports: [],
        feedback: [] };
    }
    if (path.startsWith('/api/models/')) return sceneOf(path.slice('/api/models/'.length));
    throw new Error('Unexpected request ' + path);
  } });
  const none = () => {};
  const { harness } = createViewer(fake.env, { features: legacyFeatures, legacy: true,
    seams: { scheduleDraw: none, renderAnnotations: none, renderLibrary: none, renderSaved: none,
      panel: none, renderInspector: none } });
  assert.equal(harness.state.compare, true);
  await harness.startupWorkspace();
  await flush();
  assert.equal(harness.state.compare, false);
  assert.deepEqual(requests.filter(path => !path.startsWith('/api/models/')), ['/api/workspace']);
  assert.equal(fake.node('#delta-strip').hidden, true);
  assert.equal(fake.node('#global-error').textContent, '');
});

}
