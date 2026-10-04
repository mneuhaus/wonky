import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("viewer-reviews-context.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { execFile } = await import("node:child_process");
const { createHash } = await import("node:crypto");
const { existsSync } = await import("node:fs");
const { mkdir, mkdtemp, readFile, rm, writeFile } = await import("node:fs/promises");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { promisify } = await import("node:util");
const { build } = await import("../src/index.mjs");
const { loadKernel } = await import("../src/kernel.mjs");
const { createReviewServer } = await import("../src/review-server.mjs");
const { createGeometryInspector } = await import("../src/geometry-summary.mjs");
const { viewerRecord } = await import("../src/viewer/model-record.mjs");
const { INSPECT_SCRIPT, contextText, inspectCommand, readReferences, referenceRecord, reviewScope, shellQuote, summaryLine, targetAlias } = await import("../src/viewer/context.mjs");
const { createPrintExporter, printFileName, readDeviation, selectBody } = await import("../src/viewer/export.mjs");
const { createReviewStore, listReviews } = await import("../src/viewer/reviews.mjs");
const { createSelectionStore, describeSelection, readSelection } = await import("../src/viewer/selection.mjs");
const { createViewer } = await import("../viewer/app.js");
const { loadFeatures } = await import("../viewer/core/feature-loader.js");
const { LEGACY_FEATURES } = await import("../viewer/features/index.js");
const { dirtyPayload, dirtyState, hasContent } = await import("../viewer/features/reviews/dirty.js");
const { savedRow } = await import("../viewer/features/reviews/reviews.js");
const { selectionPost, visibleModels } = await import("../viewer/features/reviews/selection-share.js");
const { MARKUP_TOOLS, toolHint } = await import("../viewer/features/annotations/tools.js");
const { contextMarkup, printMarkup } = await import("../viewer/features/inspector/context-section.js");
const { createFakeEnvironment } = await import("../scripts/viewer/test-support/fake-env.mjs");
// reviews-context: the dirty rule (D9), one-shot and lockable markup tools
// (D8), archive-on-copy with resolvable wonky-inspect commands (D7), the
// scoped LLM context, Copy references, the selection API, print export, and
// per-review error isolation. Client parts run the real feature code in the
// fake browser environment of the VS harness; server parts run a real review
// server on port 0 with models built by the kernel.




























const run = promisify(execFile);
const { features: legacyFeatures } = await loadFeatures(LEGACY_FEATURES);
const modelA = 'a'.repeat(64);
const modelB = 'b'.repeat(64);
const flush = () => new Promise(resolve => setImmediate(resolve));
const source = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
// Client: fake browser

function squareScene(id) {
  const points = [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]];
  return {
    id, label: id.slice(0, 1), bounds: { min: [0, 0, 0], max: [1, 0, 1] },
    display: { toleranceMm: 0.02 },
    bodies: [{
      id: 'part',
      faces: [{ index: 0, surfaceType: 'plane', edgeIndices: [0], triangles: [
        { points: [points[0], points[1], points[2]], normal: [0, -1, 0] },
        { points: [points[0], points[2], points[3]], normal: [0, -1, 0] },
      ] }],
      edges: [{ index: 0, points: [points[0], points[1]], curveType: 'line' }],
      vertices: points.map((point, index) => ({ index, point })),
    }],
  };
}
const face = (modelId = modelA) => ({ modelId, bodyId: 'part', entityType: 'face',
  entityIndex: 0 });
const savedReview = {
  id: 'WKR-AAAAAAAAAA', title: 'Bore check', notes: '',
  comparison: { before: modelA, after: modelA, split: 0.5, compare: false, layout: 'wipe' },
  camera: { yaw: 1, pitch: 0, zoom: 1, pan: [0, 0] },
  annotations: [],
};

// legacy: true is the VS seam (no requests from these features).
function viewer({ legacy = true, dispatch } = {}) {
  const requests = [];
  const fake = createFakeEnvironment({
    dispatch: (path, options) => {
      requests.push({ path, method: options?.method ?? 'GET', body: options?.body });
      if (path === '/api/feedback/' + savedReview.id) return structuredClone(savedReview);
      if (dispatch) return dispatch(path, options);
      if (path === '/api/selection') return {};
      throw new Error(`Unexpected request ${path}`);
    },
  });
  const none = () => {};
  const seams = { scheduleDraw: none, renderAnnotations: none, renderLibrary: none, panel: none,
    renderInspector: none };
  const composed = createViewer(fake.env, { seams, features: legacyFeatures, legacy,
    log: () => {} });
  const { state } = composed.harness;
  state.workspace.models = [{ id: modelA, label: 'A' }, { id: modelB, label: 'B' }];
  state.scenes.set(modelA, squareScene(modelA));
  state.scenes.set(modelB, squareScene(modelB));
  Object.assign(state, {
    before: modelB, after: modelA, compare: false, loading: false, layout: 'wipe',
    camera: { yaw: 0, pitch: 0, zoom: 1, pan: [0, 0] }, center: [0.5, 0, 0.5], extent: 1,
  });
  return {
    ...composed.harness, ctx: composed.ctx, app: composed.ctx.app, node: fake.node,
    document: fake.document, clipboard: fake.clipboard, requests,
    canvas: fake.node('#model-canvas'),
    key: (key, extra = {}) => fake.document.emit('keydown', { key, ...extra }),
  };
}

test('D9: an empty review never shows Unsaved changes for compare, layout or camera', () => {
  const ui = viewer();
  ui.ctx.commands.run('compare.toggle');
  ui.setLayout('side-by-side');
  ui.state.camera = { yaw: 2, pitch: 0.3, zoom: 2, pan: [1, 0] };
  ui.app.touchReview('view.camera');
  assert.equal(ui.state.dirty, false);
  assert.equal(ui.node('#save-state').textContent, '');
  ui.node('#review-notes').value = 'Check the bore';
  ui.node('#review-notes').oninput();
  assert.equal(ui.state.dirty, true, 'content makes a never-saved review dirty');
  assert.equal(ui.node('#save-state').textContent, 'Unsaved changes');
  ui.node('#review-notes').value = '  ';
  ui.node('#review-notes').oninput();
  assert.equal(ui.state.dirty, false, 'whitespace is no content');
});

test('D9: a saved review turns dirty with a rectangle and back to Saved with ⌘Z', async () => {
  const ui = viewer();
  await ui.loadReview(savedReview.id);
  assert.equal(ui.node('#save-state').textContent, 'Saved · WKR-AAAAAAAAAA');
  ui.state.camera = { yaw: 3, pitch: 0.2, zoom: 1, pan: [0, 0] };
  ui.app.touchReview('view.camera');
  assert.equal(ui.state.dirty, false, 'the camera is excluded');
  ui.app.addAnnotation(ui.app.annotationAt('box', [[0.1, 0.1], [0.4, 0.3]]));
  assert.equal(ui.node('#save-state').textContent, 'Unsaved changes');
  ui.key('z', { metaKey: true });
  assert.equal(ui.state.annotations.length, 0);
  assert.equal(ui.state.dirty, false);
  assert.equal(ui.node('#save-state').textContent, 'Saved · WKR-AAAAAAAAAA');
  ui.ctx.commands.run('compare.toggle');
  assert.equal(ui.state.dirty, true, 'compare is part of a saved review');
  ui.ctx.commands.run('compare.toggle');
  assert.equal(ui.state.dirty, false, 'toggling back returns to Saved');
});

test('D9 helpers: dirty payload drops the camera, content and state text', () => {
  const payload = {
    title: 'A review', notes: 'x', camera: { yaw: 1 }, models: [modelA],
    comparison: { before: modelA, after: modelA, split: 0.5, compare: true, layout: 'wipe' },
    annotations: [],
  };
  const value = dirtyPayload(payload, '');
  assert.deepEqual(Object.keys(value), ['title', 'notes', 'comparison', 'annotations']);
  assert.equal(value.title, '', 'the typed title, not the model fallback');
  assert.equal(hasContent(value), true);
  assert.equal(hasContent({ ...value, notes: '' }), false);
  assert.deepEqual(dirtyState(value, JSON.stringify(value), { id: 'WKR-1' }),
    { dirty: false, text: 'Saved · WKR-1' });
  assert.deepEqual(dirtyState(value, null, null), { dirty: true, text: 'Unsaved changes' });
});

test('D8: markup tools are one-shot, a second activation or double-click locks, Esc releases',
  () => {
    const ui = viewer();
    const drag = () => {
      ui.canvas.emit('pointerdown', { clientX: 100, clientY: 100 });
      ui.canvas.emit('pointermove', { clientX: 200, clientY: 180, buttons: 1 });
      ui.canvas.emit('pointerup', { clientX: 200, clientY: 180 });
    };
    ui.key('r');
    assert.equal(ui.state.tool, 'box');
    assert.match(ui.node('#interaction-hint').textContent, /Double-click the tool to keep it/);
    drag();
    assert.equal(ui.state.annotations.length, 1);
    assert.equal(ui.state.tool, 'select', 'back to Select after one annotation');
    ui.key('r');
    ui.key('r');
    assert.equal(ui.state.toolLocked, true, 'pressing the key twice locks');
    assert.match(ui.node('#interaction-hint').textContent, /Locked · Esc to release/);
    drag();
    drag();
    assert.equal(ui.state.annotations.length, 3);
    assert.equal(ui.state.tool, 'box', 'a locked tool stays');
    ui.state.selection = face();
    ui.key('Escape');
    assert.equal(ui.state.tool, 'select');
    assert.equal(ui.state.toolLocked, false);
    assert.deepEqual(ui.state.selection, face(), 'Escape only released the tool');
    ui.node('.tool[data-tool="pen"]').ondblclick();
    assert.equal(ui.state.tool, 'pen');
    assert.equal(ui.state.toolLocked, true, 'double-click locks');
    ui.key('v');
    assert.equal(ui.state.toolLocked, false, 'another tool releases the lock');
    ui.key('c');
    ui.canvas.emit('pointerdown', { clientX: 300, clientY: 200 });
    ui.canvas.emit('pointerup', { clientX: 300, clientY: 200 });
    assert.equal(ui.state.annotations.at(-1).tool, 'comment');
    assert.equal(ui.state.tool, 'select', 'the comment tool is one-shot too');
    assert.deepEqual(MARKUP_TOOLS, ['comment', 'arrow', 'box', 'pen']);
    assert.equal(toolHint('select'), 'Drag to orbit · Scroll to zoom · Shift-drag to pan');
  });

test('the browser posts its selection once per change; the legacy seam posts nothing',
  async () => {
    const legacyUi = viewer();
    legacyUi.select(face());
    await flush();
    assert.deepEqual(legacyUi.requests, []);

    const ui = viewer({ legacy: false });
    await flush();
    ui.select([face(), { ...face(), entityType: 'edge' }]);
    ui.state.compare = true;
    await flush();
    const posts = ui.requests.filter(request => request.path === '/api/selection');
    const last = JSON.parse(posts.at(-1).body);
    assert.deepEqual(last.references, [face(), { ...face(), entityType: 'edge' }]);
    assert.deepEqual(last.visible, [modelA, modelB]);
    assert.ok(posts.length <= 3, `coalesced posts (${posts.length})`);
    assert.deepEqual(visibleModels({ compare: false, after: modelA, before: modelB }), [modelA]);
    assert.deepEqual(selectionPost({ selectionSet: [face()], compare: false, after: modelA },
      'tab').references, [face()]);
  });

test('copy actions post the visible models and the whole multi-selection', async () => {
  const bodies = [];
  const ui = viewer({
    legacy: false,
    dispatch: (path, options) => {
      if (path === '/api/selection') return {};
      if (path === '/api/context') {
        bodies.push(JSON.parse(options.body));
        return { text: `copied ${JSON.parse(options.body).kind}` };
      }
      throw new Error(`Unexpected request ${path}`);
    },
  });
  ui.select([face(modelA), { ...face(modelA), entityType: 'vertex', entityIndex: 2 }]);
  await ui.app.copyContext('references');
  assert.equal(bodies[0].kind, 'references');
  assert.equal(bodies[0].references.length, 2, 'Copy references copies the multi-selection');
  assert.equal(ui.clipboard.text, 'copied references');
  await ui.app.copyContext('llm');
  assert.deepEqual(bodies[1].visible, [modelA], 'no hidden compare model');
  ui.state.compare = true;
  await ui.app.copyContext('llm');
  assert.deepEqual(bodies[2].visible, [modelA, modelB]);
  assert.match(contextMarkup({ alias: 'B1.F1', count: 2, legacy: false }),
    /copy-references.*Copy references \(2\).*copy-llm-context/);
  assert.doesNotMatch(contextMarkup({ alias: null, count: 0, legacy: true }), /copy-llm-context/);
  assert.match(printMarkup({ bodyAlias: 'B2' }), /Export B2 for print/);
});

test('a corrupt review is an error row in the saved list', () => {
  const ui = viewer();
  ui.state.workspace.feedback = [
    { id: 'WKR-BBBBBBBBBB', error: 'Review WKR-BBBBBBBBBB cannot be read: Unexpected token',
      file: '/tmp/WKR-BBBBBBBBBB.json' },
    { id: 'WKR-AAAAAAAAAA', title: 'Fine', createdAt: '2026-09-23T00:00:00Z' },
  ];
  ui.app.renderSaved();
  const markup = ui.node('#saved-reviews').innerHTML;
  assert.ok(markup.indexOf('Fine') < markup.indexOf('cannot be read'), 'error rows come last');
  assert.match(savedRow(ui.state.workspace.feedback[0]), /saved-item-error.*WKR-BBBBBBBBBB/);
  assert.doesNotMatch(savedRow(ui.state.workspace.feedback[0]), /data-review=/);
});

// ---------------------------------------------------------------------------
// Server: pure helpers

test('references, commands and shell words are validated and absolute', () => {
  assert.throws(() => readReferences([{ modelId: modelA }]), error => error.status === 400);
  assert.throws(() => readReferences([face()], { has: () => false }),
    error => error.status === 404);
  assert.deepEqual(readReferences([{ entityIndex: 0, entityType: 'face', bodyId: 'part',
    modelId: modelA, alias: 'x' }]), [face()], 'canonical key order, extra keys dropped');
  assert.equal(shellQuote('/a/b-c.json'), '/a/b-c.json');
  assert.equal(shellQuote("/a b/it's"), "'/a b/it'\\''s'");
  assert.equal(inspectCommand('/r/m.brep.json', { modelId: modelA, alias: 'B1.F2' }),
    `node ${INSPECT_SCRIPT} /r/m.brep.json --revision ${modelA} --detail B1.F2`);
  assert.ok(existsSync(INSPECT_SCRIPT));
});

test('the review scope never names a hidden compare model', () => {
  const record = {
    comparison: { before: modelB, after: modelA, compare: false, split: 0.5 },
    annotations: [{ tool: 'comment', view: { before: modelB, after: modelA, compare: false } }],
  };
  assert.deepEqual(reviewScope(record).map(entry => entry.id), [modelA]);
  record.annotations.push({ tool: 'arrow', target: face(modelB) });
  assert.deepEqual(reviewScope(record).map(entry => entry.id), [modelA, modelB],
    'an annotated model is visible context');
  record.comparison.compare = true;
  assert.deepEqual(reviewScope(record)[1].reasons, ['compare before', 'annotated']);
});

test('print export helpers: deviation limits, body selection and file names', () => {
  assert.equal(readDeviation(null), 0.02);
  assert.equal(readDeviation('0.05'), 0.05);
  assert.throws(() => readDeviation('5'), error => error.status === 400);
  const model = { bodies: [{ id: 'model/a' }, { id: 'model/b', name: 'Tab' }] };
  assert.equal(selectBody(model, null), null);
  assert.equal(selectBody(model, 'B2').body.id, 'model/b');
  assert.equal(selectBody(model, 'model/a').bodyIndex, 0);
  assert.throws(() => selectBody(model, 'B3'), error => error.status === 404);
  assert.equal(printFileName({ label: 'Bracket.brep.json', modelId: modelA, revision: 3 }),
    'bracket-r3-aaaaaaaa.stl');
  assert.equal(printFileName({ label: 'frame', modelId: modelA,
    body: { alias: 'B2', name: 'Tab' } }), 'frame-aaaaaaaa-b2-tab.stl');
});

test('per-review isolation: a corrupt file is an error row, valid reviews still list',
  async t => {
    const dir = await mkdtemp(join(tmpdir(), 'wonky-rc-list-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    await writeFile(join(dir, 'WKR-AAAAAAAAAA.json'), JSON.stringify({
      id: 'WKR-AAAAAAAAAA', title: 'Older', createdAt: '2026-09-20T00:00:00Z' }));
    await writeFile(join(dir, 'WKR-CCCCCCCCCC.json'), JSON.stringify({
      id: 'WKR-CCCCCCCCCC', title: 'Newer', createdAt: '2026-09-22T00:00:00Z' }));
    await writeFile(join(dir, 'WKR-BBBBBBBBBB.json'), '{"id": "WKR-BBBBBBBBBB", "title": ');
    await writeFile(join(dir, 'WKR-DDDDDDDDDD.json'), JSON.stringify({ id: 'WKR-XXXXXXXXXX' }));
    const rows = await listReviews(dir);
    assert.deepEqual(rows.map(row => row.id), ['WKR-CCCCCCCCCC', 'WKR-AAAAAAAAAA',
      'WKR-BBBBBBBBBB', 'WKR-DDDDDDDDDD']);
    assert.match(rows[2].error, /cannot be read/);
    assert.match(rows[3].error, /does not match the file name/);
    assert.equal(rows[2].file, join(dir, 'WKR-BBBBBBBBBB.json'));
  });

// ---------------------------------------------------------------------------
// Server: real models

const models = {};
const modelOf = async name => {
  models[name] ??= viewerRecord(await build(await source(name)));
  return models[name];
};
const bytesOf = model => Buffer.from(JSON.stringify(model, null, 2) + '\n');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('exact summaries and scoped review context with inline exact data', async () => {
  const kernel = await loadKernel();
  const spacer = await modelOf('examples/bored-spacer.fs');
  const bracket = await modelOf('examples/bracket.fs');
  const spacerId = sha(bytesOf(spacer));
  const bracketId = sha(bytesOf(bracket));
  const bore = spacer.bodies[0].faces.findIndex(item => item.surface.type === 'cylinder'
    && item.sameSense === false);
  const reference = { modelId: spacerId, bodyId: spacer.bodies[0].id, entityType: 'face',
    entityIndex: bore };
  const record = referenceRecord(spacer, reference);
  assert.equal(record.alias, `B1.F${bore + 1}`);
  assert.equal(record.identity?.lineage?.history, undefined);
  const selection = describeSelection(createSelectionStore().set(readSelection({
    references: [reference], visible: [spacerId],
  }, { has: () => true })), { registry: {
    model: () => spacer, get: () => ({ label: 'bored-spacer' }), snapshotDirectory: '/r/models',
  }, kernel });
  assert.equal(selection.references[0].alias, record.alias);
  assert.match(selection.references[0].summary.text, /^cylinder hole Ø4\.0000 mm/);
  assert.equal(selection.references[0].summary.exactness, 'exact-parameters');
  assert.match(summaryLine({ ...spacer.bodies[0], validation: {} }), /volume not evaluated/);

  const inspectors = {
    [spacerId]: createGeometryInspector(spacer, { modelBytes: bytesOf(spacer) }),
    [bracketId]: createGeometryInspector(bracket, { modelBytes: bytesOf(bracket) }),
  };
  const review = {
    id: 'WKR-AAAAAAAAAA', title: 'Bore', notes: 'n', models: [spacerId, bracketId],
    comparison: { before: bracketId, after: spacerId, split: 0.5, compare: false },
    annotations: [{ tool: 'comment', text: 'Here', target: { ...reference, alias: record.alias } }],
  };
  const options = {
    originPrefix: '', reviewDirectory: '/r', snapshotDirectory: '/r/models',
    inspector: id => inspectors[id], model: id => (id === spacerId ? spacer : bracket), kernel,
  };
  const text = contextText(review, options);
  assert.ok(!text.includes(bracketId), 'the hidden compare model is not named');
  assert.match(text, /Not included \(hidden in the saved view\): 1 referenced revision/);
  assert.match(text, /exact: cylinder hole Ø4\.0000 mm/);
  assert.match(text, /--detail B1\.F1/);
  assert.equal(contextText(review, options), text, 'deterministic for the on-disk file');

  // Regression (fix round): targets saved before reviews stored aliases carry
  // only bodyId/entityType/entityIndex. The alias is derived from the frozen
  // revision, so the exact data and the --detail command still name the face.
  const legacy = { ...review, annotations: [{ tool: 'comment', text: 'Here', target: reference }] };
  const legacyText = contextText(legacy, options);
  assert.match(legacyText, new RegExp(`1\\. comment on ${record.alias} \\(face, model`));
  assert.match(legacyText, /exact: cylinder hole Ø4\.0000 mm/);
  assert.match(legacyText, new RegExp(`--revision ${spacerId} --detail ${record.alias}`));
  assert.equal(targetAlias(reference, spacer), record.alias);
  assert.equal(targetAlias({ ...reference, entityIndex: 999 }, spacer), null);
  const missing = contextText({ ...legacy, annotations: [{ tool: 'comment', text: 'x',
    target: { ...reference, entityIndex: 999 } }] }, options);
  assert.match(missing, /detail unavailable: .* face 999 is not in the stored revision/);
  assert.ok(!/--detail undefined/.test(missing));
});

test('selection API, archive-on-copy and print export on a live server; commands resolve after'
  + ' it stops', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'wonky-rc-server-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const pin = await modelOf('scripts/viewer/qa/fixtures/pin-in-bore.fs');
  // The print mesh refuses an oblique cut of a round bar (an ellipse edge);
  // arc slots, bands and revolves are covered (test/print-mesh-coverage.test.mjs).
  const slot = await modelOf('scripts/viewer/audit-data/oblique-cut.fs');
  const pinPath = join(dir, 'pin.brep.json');
  const slotPath = join(dir, 'slot.brep.json');
  await writeFile(pinPath, bytesOf(pin));
  await writeFile(slotPath, bytesOf(slot));
  const reviews = join(dir, 'reviews');
  await mkdir(reviews, { recursive: true });
  await writeFile(join(reviews, 'WKR-EEEEEEEEEE.json'), '{ corrupt');
  const server = await createReviewServer({
    modelPaths: [pinPath, slotPath], reviewDirectory: reviews, port: 0, log: () => {},
  });
  let stopped = false;
  t.after(() => (stopped ? null : server.close()));
  const base = server.origin;
  const post = (path, body) => fetch(base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const workspace = await (await fetch(base + '/api/workspace')).json();
  assert.equal(workspace.feedback.at(-1).id, 'WKR-EEEEEEEEEE', 'the corrupt review is a row');
  assert.match(workspace.feedback.at(-1).error, /cannot be read/);
  const [pinModel, slotModel] = workspace.models;
  const scene = await (await fetch(`${base}/api/models/${pinModel.id}`)).json();
  const cylinders = scene.bodies.flatMap(body => body.faces
    .filter(item => item.surfaceType === 'cylinder').map(item => ({
      modelId: pinModel.id, bodyId: body.id, entityType: 'face', entityIndex: item.index,
    })));
  assert.equal((await (await fetch(base + '/api/selection')).json()).references.length, 0);
  await post('/api/selection', { references: [], visible: [pinModel.id] });
  const clicked = performance.now();
  assert.equal((await post('/api/selection', { references: cylinders.slice(0, 2),
    visible: [pinModel.id] })).status, 200);
  const selection = await (await fetch(base + '/api/selection')).json();
  const elapsed = performance.now() - clicked;
  assert.ok(elapsed < 500, `GET within 500 ms of the post (${Math.round(elapsed)} ms)`);
  assert.deepEqual(selection.references.map(item => item.summary.text.split(' · ')[0]),
    ['cylinder hole Ø8.4000 mm (r 4.2000 mm)', 'cylinder boss Ø8.0000 mm (r 4.0000 mm)']);
  assert.equal(selection.modelId, pinModel.id);
  assert.equal((await post('/api/selection', { references: [{ modelId: 'c'.repeat(64),
    bodyId: 'x', entityType: 'face', entityIndex: 0 }] })).status, 404);

  const commands = [];
  for (const kind of ['references', 'geometry', 'overview', 'llm']) {
    const response = await post('/api/context', {
      kind, references: cylinders.slice(0, 2), visible: [pinModel.id],
    });
    assert.equal(response.status, 200, kind);
    const copied = await response.json();
    assert.equal(copied.archived[0].modelId, pinModel.id);
    assert.ok(existsSync(copied.archived[0].path), `${kind} archived its revision`);
    commands.push(...copied.text.match(/node \S+wonky-inspect\.mjs [^\n"]+/g));
    if (kind === 'references') {
      assert.equal(JSON.parse(copied.text).references.length, 2, 'multi-selection');
    }
    if (kind === 'llm') {
      assert.match(copied.text, /Radial gap: 0\.2000 mm · exact ±0\.0003/);
      assert.ok(!copied.text.includes(slotModel.id), 'only the visible model');
    }
  }
  assert.ok(commands.length >= 6, `commands in the copied texts (${commands.length})`);

  const manifest = await (await fetch(`${base}/api/models/${pinModel.id}/print.json`)).json();
  assert.equal(manifest.scope, 'revision');
  assert.equal(manifest.deviation.exactness, 'display-approximation');
  assert.ok(manifest.deviation.achievedMm > 0 && manifest.deviation.achievedMm <= 0.02);
  assert.match(manifest.deviation.statement, /within 0\.019\d mm of the exact B-rep/);
  const stl = await fetch(`${base}/api/models/${pinModel.id}/print.stl`);
  assert.match(stl.headers.get('content-disposition'), /attachment; filename="pin-/);
  const stlBytes = Buffer.from(await stl.arrayBuffer());
  assert.equal(sha(stlBytes), manifest.file.sha256, 'the manifest describes this STL');
  const body = await (await fetch(`${base}/api/models/${pinModel.id}/print.json?body=B2`))
    .json();
  assert.equal(body.scope, 'body');
  assert.deepEqual(body.bodies.map(item => item.alias), ['B2']);
  const refused = await fetch(`${base}/api/models/${slotModel.id}/print.json`);
  assert.equal(refused.status, 422);
  assert.equal((await refused.json()).kind, 'capability');
  assert.equal((await fetch(`${base}/api/models/${pinModel.id}/print.stl?body=B9`)).status, 404);
  commands.push(manifest.inspect);

  await server.close();
  stopped = true;
  for (const command of commands) {
    const { stdout } = await run('sh', ['-c', command], { maxBuffer: 16 * 1024 * 1024 });
    assert.ok(stdout.length > 0, command);
  }
});

test('saving a review archives every referenced revision before writing it', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'wonky-rc-save-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const model = await modelOf('examples/bracket.fs');
  const bytes = bytesOf(model);
  const id = sha(bytes);
  const archived = [];
  const snapshotDirectory = join(dir, 'models');
  const registry = {
    snapshotDirectory,
    models: new Map([[id, { id, label: 'bracket', sha256: id }]]),
    rawModels: new Map([[id, model]]),
    get: key => ({ id: key, label: 'bracket', sha256: key }),
    model: () => model,
    inspector: () => createGeometryInspector(model, { modelBytes: bytes }),
    async archive(key) {
      archived.push(key);
      await mkdir(snapshotDirectory, { recursive: true });
      await writeFile(join(snapshotDirectory, `${key}.brep.json`), bytes);
      return join(snapshotDirectory, `${key}.brep.json`);
    },
  };
  const store = createReviewStore({ reviewDirectory: dir, registry, origin: () => 'http://x' });
  const camera = { yaw: 0, pitch: 0, zoom: 1, pan: [0, 0] };
  const saved = await store.save({
    title: 'Live check', notes: '', models: [id], camera,
    comparison: { before: id, after: id, split: 0.5, compare: false }, annotations: [],
  });
  assert.deepEqual(archived, [id]);
  assert.deepEqual(saved.archived, [{ modelId: id, path: join(snapshotDirectory,
    `${id}.brep.json`) }]);
  const record = JSON.parse(await readFile(saved.file, 'utf8'));
  assert.equal(record.revisions[0].snapshot, saved.archived[0].path);
  const loaded = await store.load(saved.id);
  assert.equal(loaded.contextError, undefined);
  const exporter = createPrintExporter({ idleMs: 50 });
  const result = await exporter.run(bytes, { modelId: id, label: 'bracket' });
  assert.equal(result.manifest.deviation.achievedMm, 0, 'planar facets carry no deviation');
  assert.match(result.stl.toString('utf8', 0, 5), /^solid/);
  exporter.close();
});

}
