import test from 'node:test';
import assert from 'node:assert/strict';
import { createViewer } from '../viewer/app.js';
import { loadFeatures } from '../viewer/core/feature-loader.js';
import { LEGACY_FEATURES } from '../viewer/features/index.js';
import { createFakeEnvironment } from '../scripts/viewer/test-support/fake-env.mjs';

// The legacy feature set (features/index.js, legacy: true), loaded once.
const { features: legacyFeatures, failures } = await loadFeatures(LEGACY_FEATURES);
assert.deepEqual(failures, []);
const modelA = 'a'.repeat(64), modelB = 'b'.repeat(64);
const camera = yaw => ({ yaw, pitch: 0, zoom: 1, pan: [0, 0] });
const scene = id => ({ id, label: id.slice(0, 1), bounds: { min: [0, 0, 0], max: [1, 1, 1] },
  bodies: [{ id: 'part', faces: [{ index: 0, triangles: [] }], edges: [], vertices: [] }] });
const review = (id, modelId, yaw) => ({ id, title: id, notes: id,
  comparison: { before: modelId, after: modelId, split: .5, compare: false }, camera: camera(yaw),
  annotations: [{ tool: 'comment', text: id, points: [[.5, .5]], camera: camera(yaw),
    target: { modelId, bodyId: 'part', entityType: 'face', entityIndex: 0 } }],
});
const reviewA = review('WKR-AAAAAAAAAA', modelA, 1), reviewB = review('WKR-BBBBBBBBBB', modelB, 2);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = () => new Promise(resolve => setImmediate(resolve));

// Execute the real browser event handlers and state transitions. HTTP requests
// have controlled completion order; layout/WebGL rendering is outside this test.
function viewer(dispatch, { inspect = false } = {}) {
  const fake = createFakeEnvironment({ dispatch, hash: '#review=' + reviewA.id });
  const none = () => {};
  const seams = { scheduleDraw: none, renderAnnotations: none, renderLibrary: none, renderSaved: none, panel: none,
    ...(inspect ? {} : { renderInspector: none }) };
  const api = createViewer(fake.env, { seams, features: legacyFeatures, legacy: true }).harness;
  api.state.workspace.models = [{ id: modelA, label: 'A' }, { id: modelB, label: 'B' }];
  return { ...api, node: fake.node, document: fake.document, window: fake.window, history: fake.history,
    clipboard: fake.clipboard, flushFrames: fake.flushFrames };
}

for (const kind of ['body', 'face', 'edge', 'vertex']) {
  test(`Boolean ${kind} inspection distinguishes body source from unresolved input topology`, async () => {
    const ui = viewer(() => { throw new Error('Reference copying should not need an API call'); }, { inspect: true });
    const model = scene(modelA), body = model.bodies[0];
    const identity = { originId: 'origin', instanceId: 'instance', revision: 'sha256:geometry', stability: 'revision-local',
      role: 'unmatched-' + kind, operationId: 'intersection', lineage: { relation: 'boolean-generated',
        matching: 'unsupported-split-merge-correspondence', parents: [{ operationId: 'first-box' }, { operationId: 'second-box' }] } };
    body.identity = { ...structuredClone(identity), lineage: { ...structuredClone(identity.lineage),
      ambiguity: 'Input face correspondence is unresolved', history: [{ id: 'first-box', type: 'box' }] } };
    body.source = { file: 'intersection.fs', sha256: 'c'.repeat(64), span: { line: 14, column: 5 } };
    body.faces[0] = { index: 0, surfaceType: 'plane', triangles: [], edgeIndices: [0], identity, source: body.source };
    body.edges = [{ index: 0, curveType: 'line', points: [[0, 0, 0], [1, 0, 0]], identity, source: body.source }];
    body.vertices = [{ index: 0, point: [0, 0, 0], identity, source: body.source }];
    ui.state.scenes.set(modelA, model); ui.state.after = modelA;
    ui.state.selection = { modelId: modelA, bodyId: body.id, entityType: kind, entityIndex: 0 };
    ui.renderInspector();
    const markup = ui.node('#selection-content').innerHTML;
    assert.match(markup, /Split\/merge correspondence is unresolved/);
    assert.match(markup, /no supported mapping to individual input faces or edges/);
    assert.match(markup, /This model revision only/);
    assert.match(markup, /<h3>Operation source<\/h3>/);
    assert.match(markup, /Earlier body operations/);
    assert.ok(markup.indexOf('Split/merge correspondence') < markup.indexOf('Operation source'), 'limit is visible before source details');
    await ui.node('#copy-selection').onclick();
    const copied = JSON.parse(ui.clipboard.text);
    assert.equal(copied.modelId, modelA);
    assert.equal(copied.identity.operationId, 'intersection');
    assert.equal(copied.identity.lineage.matching, identity.lineage.matching);
    assert.equal(copied.identity.lineage.ambiguity, body.identity.lineage.ambiguity);
    assert.deepEqual(copied.identity.lineage.parents, identity.lineage.parents);
    assert.equal(copied.identity.lineage.history, undefined, 'reference remains compact; full history is available in geometry detail');
    assert.equal(copied.source.span.line, 14);
    assert.equal(identity.lineage.ambiguity, undefined, 'copying does not rewrite authoritative entity metadata');
  });
}

test('semantic and unattributed selections do not acquire invented Boolean correspondence', async () => {
  const ui = viewer(() => {}, { inspect: true });
  const model = scene(modelA), body = model.bodies[0], face = body.faces[0];
  face.edgeIndices = []; face.surfaceType = 'plane';
  ui.state.scenes.set(modelA, model); ui.state.after = modelA;
  ui.state.selection = { modelId: modelA, bodyId: body.id, entityType: 'face', entityIndex: 0 };
  ui.renderInspector();
  assert.match(ui.node('#selection-content').innerHTML, /Unattributed/);
  assert.doesNotMatch(ui.node('#selection-content').innerHTML, /Split\/merge correspondence/);
  await ui.node('#copy-selection').onclick();
  assert.equal(JSON.parse(ui.clipboard.text).identity, null);
  face.identity = { stability: 'semantic', role: 'cap/start', lineage: { relation: 'created', matching: 'semantic-role', parents: [] } };
  ui.renderInspector();
  assert.match(ui.node('#selection-content').innerHTML, /Semantic role/);
  assert.doesNotMatch(ui.node('#selection-content').innerHTML, /Split\/merge correspondence/);
  await ui.node('#copy-selection').onclick();
  assert.equal(JSON.parse(ui.clipboard.text).identity.lineage.matching, 'semantic-role');
  assert.equal(JSON.parse(ui.clipboard.text).identity.lineage.ambiguity, undefined);
});

function assertReviewB(ui) {
  assert.equal(ui.state.after, modelB);
  assert.equal(ui.state.annotations[0].target.modelId, modelB);
  assert.equal(ui.state.camera.yaw, 2);
  assert.equal(ui.state.saved.id, reviewB.id);
  assert.equal(ui.node('#review-title').value, reviewB.title);
  assert.equal(ui.history.url, '#review=' + reviewB.id);
  assert.equal(ui.state.loading, false);
  assert.equal(ui.node('#global-error').textContent, '');
}

for (const phase of ['review', 'model']) for (const completion of ['success', 'failure']) {
  test(`a delayed ${phase} ${completion} cannot overwrite a newer loaded review`, async () => {
    const gate = deferred(), started = deferred();
    const ui = viewer(async path => {
      if (path === '/api/feedback/' + reviewA.id) {
        if (phase === 'review') { started.resolve(); return gate.promise; }
        return reviewA;
      }
      if (path === '/api/models/' + modelA) { started.resolve(); return gate.promise; }
      if (path === '/api/feedback/' + reviewB.id) return reviewB;
      if (path === '/api/models/' + modelB) return scene(modelB);
      throw new Error('Unexpected request ' + path);
    });
    const old = ui.loadReview(reviewA.id);
    await started.promise;
    await ui.loadReview(reviewB.id);
    if (completion === 'failure') gate.reject(new Error('Old request failed'));
    else gate.resolve(phase === 'review' ? reviewA : scene(modelA));
    await assert.doesNotReject(old);
    assertReviewB(ui);
  });
}

for (const phase of ['review', 'model']) {
  test(`selecting another model cancels a review waiting for its ${phase}`, async () => {
    const gate = deferred(), started = deferred();
    const ui = viewer(async path => {
      if (path === '/api/feedback/' + reviewA.id) {
        if (phase === 'review') { started.resolve(); return gate.promise; }
        return reviewA;
      }
      if (path === '/api/models/' + modelA) { started.resolve(); return gate.promise; }
      if (path === '/api/models/' + modelB) return scene(modelB);
      throw new Error('Unexpected request ' + path);
    });
    ui.state.before = ui.state.after = modelB;
    const old = ui.loadReview(reviewA.id);
    await started.promise;
    ui.node('#after-model').onchange({ target: { value: modelB } });
    await flush();
    assert.equal(ui.state.loading, false, 'single-model navigation does not wait for the hidden old before model');
    gate.resolve(phase === 'review' ? reviewA : scene(modelA));
    await old;
    await flush();
    assert.equal(ui.state.after, modelB);
    assert.equal(ui.state.saved, null);
    assert.notEqual(ui.state.camera.yaw, reviewA.camera.yaw);
    assert.equal(ui.state.loading, false);
    assert.equal(ui.node('#global-error').textContent, '');
  });
}

test('restoring an annotation cannot reselect its old revision after model navigation', async () => {
  const gate = deferred(), started = deferred();
  const ui = viewer(async path => {
    if (path === '/api/models/' + modelA) { started.resolve(); return gate.promise; }
    if (path === '/api/models/' + modelB) return scene(modelB);
    throw new Error('Unexpected request ' + path);
  });
  ui.state.before = ui.state.after = modelB;
  ui.state.annotations = [{ ...reviewA.annotations[0], view: reviewA.comparison }];
  const restoring = ui.restoreAnnotation(0);
  await started.promise;
  ui.node('#after-model').onchange({ target: { value: modelB } });
  gate.resolve(scene(modelA));
  await restoring;
  await flush();
  assert.equal(ui.state.after, modelB);
  assert.equal(ui.state.selection, null);
  assert.notEqual(ui.state.camera.yaw, reviewA.camera.yaw);
});

test('a delayed workspace refresh cannot replace a newer review', async () => {
  const gate = deferred();
  const ui = viewer(async path => {
    if (path === '/api/workspace') return gate.promise;
    if (path === '/api/feedback/' + reviewB.id) return reviewB;
    if (path === '/api/models/' + modelB) return scene(modelB);
    throw new Error('Unexpected request ' + path);
  });
  const refresh = ui.workspace();
  await ui.loadReview(reviewB.id);
  gate.resolve({ models: [{ id: modelA }], reports: [], feedback: [] });
  await refresh;
  assertReviewB(ui);
});

for (const change of ['notes', 'model', 'review', 'layout', 'none']) {
  test(`a save response preserves ${change === 'none' ? 'the saved snapshot' : 'newer ' + change}`, async () => {
    const gate = deferred();
    let posted, posts = 0;
    const ui = viewer(async (path, options) => {
      if (path === '/api/feedback') { posts++; posted = JSON.parse(options.body); return gate.promise; }
      if (path === '/api/feedback/' + reviewB.id) return reviewB;
      if (path === '/api/models/' + modelB) return scene(modelB);
      throw new Error('Unexpected request ' + path);
    });
    ui.state.before = ui.state.after = modelA;
    ui.state.scenes.set(modelA, scene(modelA));
    ui.node('#review-notes').value = 'Original notes';
    const saving = ui.saveReview();
    await flush();
    assert.equal(ui.node('#save-review').disabled, true);
    await ui.saveReview();
    assert.equal(posts, 1, 'keyboard save cannot submit a duplicate while saving');
    if (change === 'notes') {
      ui.node('#review-notes').value = 'New notes';
      ui.node('#review-notes').oninput();
    }
    if (change === 'model') { ui.node('#after-model').onchange({ target: { value: modelB } }); await flush(); }
    if (change === 'review') await ui.loadReview(reviewB.id);
    if (change === 'layout') ui.node('#layout-side-by-side').onclick();
    gate.resolve({ id: reviewA.id, url: '/viewer/#review=' + reviewA.id });
    await saving;
    assert.equal(posted.comparison.after, modelA);
    assert.equal(posted.notes, 'Original notes');
    assert.ok(ui.state.workspace.feedback.some(item => item.id === reviewA.id));
    assert.equal(ui.state.saving, false);
    if (change === 'review') { assertReviewB(ui); assert.equal(ui.state.dirty, false); }
    else if (change === 'none') {
      assert.equal(ui.state.saved.id, reviewA.id);
      assert.equal(ui.state.dirty, false);
      assert.equal(ui.history.url, '#review=' + reviewA.id);
    } else {
      assert.equal(ui.state.saved, null);
      assert.equal(ui.state.dirty, true);
      assert.equal(ui.node('#save-state').textContent, 'Unsaved changes');
      assert.equal(ui.history.url, '');
      if (change === 'notes') assert.equal(ui.node('#review-notes').value, 'New notes');
      if (change === 'model') assert.equal(ui.state.after, modelB);
      if (change === 'layout') assert.equal(ui.state.layout, 'side-by-side');
    }
  });
}

test('a failure in the current review remains visible to the caller', async () => {
  const ui = viewer(async () => { throw new Error('Current request failed'); });
  await assert.rejects(ui.loadReview(reviewA.id), /Current request failed/);
  assert.equal(ui.state.loading, false);
});

for (const completion of ['success', 'failure']) {
  test(`a delayed report ${completion} cannot replace the newer report content`, async () => {
    const gate = deferred();
    const ui = viewer(path => path.endsWith('/first') ? gate.promise : { scope: 'second evidence', status: 'failed' });
    ui.state.workspace.reports = [{ id: 'first', label: 'First report' }, { id: 'second', label: 'Second report' }];
    const first = ui.openReport('first');
    await ui.openReport('second');
    if (completion === 'failure') gate.reject(new Error('Old report failed'));
    else gate.resolve({ scope: 'first evidence', status: 'passed' });
    await assert.doesNotReject(first);
    assert.equal(ui.node('#report-title').textContent, 'Second report');
    assert.match(ui.node('#report-content').innerHTML, /second evidence/);
    assert.doesNotMatch(ui.node('#report-content').innerHTML, /first evidence/);
  });
}

test('source and report loading share drawer navigation, and closing invalidates pending content', async () => {
  const gates = [deferred(), deferred(), deferred()]; let calls = 0;
  const ui = viewer(() => gates[calls++].promise);
  ui.state.workspace.reports = [{ id: 'current', label: 'Current report' }];
  const old = ui.openSource({ sha256: 'old', span: { line: 1 } });
  const current = ui.openReport('current');
  gates[1].resolve({ scope: 'current evidence' }); await current;
  gates[0].resolve({ file: 'old.fs', sha256: 'old', text: 'old source' }); await old;
  assert.equal(ui.node('#report-title').textContent, 'Current report');
  assert.match(ui.node('#report-content').innerHTML, /current evidence/);
  const late = ui.openSource({ sha256: 'late', span: { line: 1 } });
  ui.node('#close-report').onclick();
  gates[2].resolve({ file: 'late.fs', sha256: 'late', text: 'late source' }); await late;
  assert.equal(ui.node('#report-drawer').hidden, true);
  assert.doesNotMatch(ui.node('#report-content').innerHTML, /late source/);
});

test('delayed startup does not reopen the URL review after the user selects another model', async () => {
  const gate = deferred();
  const ui = viewer(path => {
    if (path === '/api/workspace') return gate.promise;
    if (path === '/api/models/' + modelB) return scene(modelB);
    throw new Error('Unexpected stale navigation ' + path);
  });
  ui.state.before = ui.state.after = modelA;
  const opening = ui.startupWorkspace();
  ui.node('#after-model').onchange({ target: { value: modelB } });
  await flush();
  gate.resolve({ models: [{ id: modelA }, { id: modelB }], reports: [], feedback: [] });
  await opening;
  assert.equal(ui.state.after, modelB);
  assert.equal(ui.state.saved, null);
  assert.equal(ui.state.loading, false);
});

// A square facing the camera, with an extra vertex and edge behind its face.
// Real pointer handlers share the same pane-aware, occlusion-aware picker.
function interactiveViewer() {
  const ui = viewer(() => { throw new Error('Cached models must not fetch'); });
  for (const id of [modelA, modelB]) {
    const model = scene(id), points = [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], body = model.bodies[0];
    model.bounds = { min: [0, 0, 0], max: [1, 0, 1] };
    body.faces = [{ index: 0, surfaceType: 'plane', edgeIndices: [0], triangles: [
      { points: [points[0], points[1], points[2]], normal: [0, -1, 0] },
      { points: [points[0], points[2], points[3]], normal: [0, -1, 0] },
    ] }];
    body.edges = [{ index: 0, points: [points[0], points[1]], curveType: 'line' },
      { index: 1, points: [[.25, -.25, .5], [.75, -.25, .5]], curveType: 'line' }];
    body.vertices = [...points, [.5, -.25, .5]].map((point, index) => ({ index, point }));
    ui.state.scenes.set(id, model);
  }
  Object.assign(ui.state, { before: modelA, after: modelB, camera: camera(0), center: [.5, 0, .5], extent: 1 });
  const canvas = ui.node('#model-canvas');
  const move = (point, extra) => canvas.emit('pointermove', { clientX: point.x, clientY: point.y, ...extra });
  return { ...ui, canvas, move, hover(point) { move(point); ui.flushFrames(); } };
}
const reference = (modelId, entityType, entityIndex = 0) => ({ modelId, bodyId: 'part', entityType, entityIndex });

test('side-by-side shows complete independently pickable models at one shared camera scale', () => {
  const ui = interactiveViewer();
  ui.node('#layout-side-by-side').onclick();
  const panes = ui.viewPanes();
  assert.deepEqual(Array.from(panes, pane => [pane.x, pane.width, pane.clipX, pane.clipWidth]), [[0, 500, 0, 500], [500, 500, 500, 500]]);
  for (const pane of panes) for (const [mode, point] of [['face', [.5, 0, .5]], ['edge', [.5, 0, 0]], ['vertex', [0, 0, 0]]]) {
    const screen = ui.project(point, pane);
    assert.equal(JSON.stringify(ui.pick(screen.x, screen.y, mode)), JSON.stringify(reference(pane.modelId, mode)));
  }
  const left = ui.project([1, 0, 1], panes[0]), right = ui.project([1, 0, 1], panes[1]);
  assert.equal(right.x - left.x, 500); assert.equal(right.y, left.y);
  assert.equal(ui.node('#wipe-handle').hidden, true); assert.equal(ui.node('#comparison-range').hidden, true);
  assert.equal(ui.node('#layout-side-by-side').getAttribute('aria-pressed'), 'true');
  for (const point of [[-1, 300], [1000, 300], [250, -1], [250, 600]]) assert.equal(ui.pick(...point), null);
  ui.node('#layout-wipe').onclick();
  assert.equal(ui.pick(450, 300, 'face').modelId, modelA);
  assert.equal(ui.pick(550, 300, 'face').modelId, modelB);
  assert.equal(ui.node('#wipe-handle').hidden, false);
  ui.node('#comparison-split').oninput({ target: { value: 80 } });
  assert.equal(ui.pick(550, 300, 'face').modelId, modelA, 'wipe still follows its adjustable clip boundary');
});

for (const [mode, point] of [['face', [.5, 0, .5]], ['edge', [.5, 0, 0]], ['vertex', [0, 0, 0]]]) {
  test(`${mode} hover previews the pointed pane without changing selection, inspector or saved review`, () => {
    const ui = interactiveViewer(); ui.setLayout('side-by-side');
    ui.state.selection = reference(modelA, 'body'); ui.state.saved = { id: reviewA.id }; ui.state.dirty = false;
    ui.state.panel = 'review'; ui.node('#selection-content').innerHTML = 'Retained inspector'; ui.node('#save-state').textContent = 'Saved';
    ui.node('#selection-mode').onchange({ target: { value: mode } });
    const screen = ui.project(point, ui.viewPanes()[1]);
    ui.hover(screen);
    assert.equal(JSON.stringify(ui.state.hover), JSON.stringify(reference(modelB, mode)));
    assert.equal(ui.state.hoverPane, 'after'); assert.equal(ui.canvas.classList.contains('hovering'), true);
    assert.equal(JSON.stringify(ui.state.selection), JSON.stringify(reference(modelA, 'body')));
    assert.equal(ui.state.panel, 'review'); assert.equal(ui.node('#selection-content').innerHTML, 'Retained inspector');
    assert.equal(ui.state.dirty, false); assert.equal(ui.node('#save-state').textContent, 'Saved');
    assert.equal(ui.state.annotations.length, 0);
    ui.canvas.emit('pointerdown', { clientX: screen.x, clientY: screen.y });
    assert.equal(ui.state.hover, null, 'pointer capture clears the transient preview');
    ui.canvas.emit('pointerup', { clientX: screen.x, clientY: screen.y });
    assert.equal(JSON.stringify(ui.state.selection), JSON.stringify(reference(modelB, mode)), 'click selects the previewed geometry');
  });
}

test('hidden edges and vertices cannot prehighlight through a face', () => {
  const ui = interactiveViewer(); ui.setLayout('side-by-side');
  const screen = ui.project([.5, -.25, .5], ui.viewPanes()[1]);
  for (const mode of ['vertex', 'edge']) {
    ui.node('#selection-mode').onchange({ target: { value: mode } }); ui.hover(screen);
    assert.equal(ui.state.hover, null); assert.equal(ui.pick(screen.x, screen.y, mode), null);
  }
  ui.node('#selection-mode').onchange({ target: { value: 'auto' } }); ui.hover(screen);
  assert.equal(ui.state.hover.entityType, 'face');
});

test('leaving, navigation, mode and model changes invalidate pending and visible hover', async () => {
  for (const action of [
    ui => ui.canvas.emit('pointerleave'),
    ui => ui.window.emit('blur'),
    ui => ui.canvas.emit('pointerdown', { clientX: 750, clientY: 300 }),
    ui => ui.canvas.emit('wheel', { deltaY: 10 }),
    ui => { ui.canvas.focus(); ui.document.emit('keydown', { key: 'ArrowRight' }); },
    ui => ui.node('#selection-mode').onchange({ target: { value: 'edge' } }),
    ui => ui.tool('pen'),
    ui => ui.node('#fit-view').onclick(),
    ui => ui.node('#view-presets').onclick(),
    ui => ui.setLayout('wipe'),
    ui => ui.loadSelectedModels(false),
  ]) {
    const ui = interactiveViewer(); ui.setLayout('side-by-side');
    const screen = ui.project([.5, 0, .5], ui.viewPanes()[1]);
    ui.hover(screen); assert.ok(ui.state.hover);
    ui.move(screen); await action(ui); ui.flushFrames();
    assert.equal(ui.state.hover, null, action.toString()); assert.equal(ui.state.hoverPane, null);
  }
});

test('edge overlays are projected and clipped to their pane, including repeated model IDs', () => {
  const ui = interactiveViewer(); ui.setLayout('side-by-side'); ui.state.before = modelB;
  ui.state.mode = 'edge'; ui.hover(ui.project([.5, 0, 0], ui.viewPanes()[1])); ui.renderOverlay();
  const hoverMarkup = ui.node('#annotation-overlay').innerHTML;
  assert.match(hoverMarkup, /id="hover-after-clip"><rect x="500" y="0" width="500"/);
  assert.doesNotMatch(hoverMarkup, /hover-before-clip|NaN/);
  ui.select(reference(modelB, 'edge')); ui.renderOverlay();
  const selectedMarkup = ui.node('#annotation-overlay').innerHTML;
  assert.match(selectedMarkup, /selection-before-clip/); assert.match(selectedMarkup, /selection-after-clip/);
  assert.doesNotMatch(selectedMarkup, /NaN/);
});

test('side-by-side annotations keep their pane projection when the viewport aspect changes', () => {
  const ui = interactiveViewer(); ui.setLayout('side-by-side');
  for (const side of [0, 1]) {
    const world = [.25, 0, .75], screen = ui.project(world, ui.viewPanes()[side]);
    const annotation = ui.annotationAt('comment', [[screen.x / 1000, screen.y / 600]], null);
    assert.equal(annotation.view.layout, 'side-by-side');
    ui.canvas.clientWidth = 600; ui.canvas.clientHeight = 800;
    const scaled = ui.annotationPoint(annotation.points[0], annotation), projected = ui.project(world, ui.viewPanes()[side]);
    assert.ok(Math.abs(scaled[0] - projected.x) < 1e-7); assert.ok(Math.abs(scaled[1] - projected.y) < 1e-7);
    ui.setLayout('wipe'); assert.equal(ui.viewMatches(annotation), false);
    ui.setLayout('side-by-side'); assert.equal(ui.viewMatches(annotation), true);
    ui.canvas.clientWidth = 1000; ui.canvas.clientHeight = 600;
  }
});

test('saved reviews and annotation jumps restore their layout; legacy reviews use wipe', async () => {
  const paired = { ...structuredClone(reviewA), comparison: { before: modelA, after: modelB, split: .7, compare: true, layout: 'side-by-side' } };
  paired.annotations[0].view = { ...paired.comparison, aspect: 5 / 3 };
  const ui = viewer(path => path === '/api/feedback/' + reviewA.id ? paired : reviewB);
  ui.state.scenes.set(modelA, scene(modelA)); ui.state.scenes.set(modelB, scene(modelB));
  await ui.loadReview(reviewA.id);
  assert.equal(ui.state.layout, 'side-by-side'); assert.equal(ui.reviewPayload().comparison.layout, 'side-by-side');
  assert.equal(ui.reviewPayload().annotations[0].view.layout, 'side-by-side');
  ui.setLayout('wipe'); assert.equal(ui.viewMatches(ui.state.annotations[0]), false);
  await ui.restoreAnnotation(0); assert.equal(ui.state.layout, 'side-by-side'); assert.equal(ui.viewMatches(ui.state.annotations[0]), true);
  await ui.loadReview(reviewB.id); assert.equal(ui.state.layout, 'wipe');
  ui.state.compare = true; ui.setLayout('side-by-side');
  ui.state.annotations[0].view = { before: modelB, after: modelB, compare: true, split: .5 };
  await ui.restoreAnnotation(0); assert.equal(ui.state.layout, 'wipe', 'legacy annotation views also restore wipe');
});
