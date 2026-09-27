// thickness-probe package, client side (viewer/features/thickness): the
// pure helpers and the feature in the fake browser environment: K and the
// one-shot tool, a click that posts { face, point }, latest wins, cancel,
// rendering of measured and refused answers, and the revision swap.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createViewer } from '../viewer/app.js';
import * as format from '../viewer/core/format.js';
import { loadFeatures } from '../viewer/core/feature-loader.js';
import { LEGACY_FEATURES } from '../viewer/features/index.js';
import {
  HINT, LOCKED_HINT, aliasReference, pickRequest, probeGeometry, probeLabel, probeMarkup,
  probeText, rayLength, setup as setupThickness,
} from '../viewer/features/thickness/thickness.js';
import { createFakeEnvironment } from '../scripts/viewer/test-support/fake-env.mjs';

const { features: legacyFeatures } = await loadFeatures(LEGACY_FEATURES);
const modelA = 'a'.repeat(64);
const modelB = 'b'.repeat(64);
const flush = () => new Promise(resolve => setImmediate(resolve));

// A 1 × 1 mm square in the XZ plane facing −Y.
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

const measured = (overrides = {}) => ({
  schema: 'wonky.viewer-thickness/1', status: 'measured', exactness: 'kernel-resolved',
  method: 'ray.line_surface roots …', mm: 8, toleranceMm: 4.76837158203125e-5,
  bodyToleranceMm: 4.76837158203125e-5, body: 'B1', bodyId: 'part',
  entry: { alias: 'B1.F1', logical: 'B1.L1', point: [0.5, 0, 0.5], t: 0 },
  hit: { alias: 'B1.F2', logical: 'B1.L2', point: [0.5, 8, 0.5], t: 8 },
  blocking: [], coincident: [], reason: null,
  ray: { mode: 'face', face: 'B1.F1', pick: [0.5, 0.001, 0.5], origin: [0.5, 0, 0.5],
    direction: [0, 1, 0], anchor: 'display-pick', pickOffsetMm: 0.001 },
  counts: { faces: 8, roots: 2, memberships: 2 }, ms: 3.2, ...overrides,
});
const refused = () => measured({
  status: 'unresolved', mm: null, toleranceMm: null, hit: null,
  reason: '3 blocking entities; the ray is not nudged',
  ray: { mode: 'ray', origin: [18, 0, 4], direction: [0, 1, 0], anchor: 'given' },
  blocking: [
    { alias: 'B1.F5', entity: 'face', reason: 'boundary', t: 12, point: [18, 12, 4],
      edges: ['B1.E16'], membership: 'FaceBoundary', text: 'the ray meets the face on its'
        + ' boundary (an edge or vertex)' },
    { alias: 'B1.F7', entity: 'face', reason: 'boundary', t: 40, point: [18, 40, 4],
      edges: ['B1.E17'], membership: 'FaceBoundary', text: 'boundary' },
    { alias: 'B1.F6', entity: 'face', reason: 'coincident', t: 12, point: [18, 12, 4],
      edges: ['B1.E16'], membership: 'FaceBoundary', text: 'the ray lies in the supporting'
        + ' surface and touches the face' },
  ],
});

test('pure helpers: pick request, alias references, drawings, labels and text', () => {
  const scene = squareScene(modelA);
  const reference = { modelId: modelA, bodyId: 'part', entityType: 'face', entityIndex: 0 };
  assert.deepEqual(pickRequest(scene, { reference, point: [0.5, 0, 0.5] }), {
    request: { face: 'B1.F1', point: [0.5, 0, 0.5] }, reference,
  });
  assert.equal(pickRequest(scene, { reference: { ...reference, entityType: 'edge' },
    point: [0, 0, 0] }), null, 'only faces start a probe');
  assert.deepEqual(aliasReference(scene, 'B1.E1'), { modelId: modelA, bodyId: 'part',
    entityType: 'edge', entityIndex: 0 });
  assert.equal(aliasReference(scene, 'B2.F1'), null);

  const probe = { status: 'measured', modelId: modelA, result: measured() };
  assert.deepEqual(probeGeometry(probe), { kind: 'span', from: [0.5, 0, 0.5],
    to: [0.5, 8, 0.5] });
  assert.deepEqual(probeLabel(probe, format), { value: '8.00000 mm', chip: 'kernel-resolved',
    detail: 'B1.F1 → B1.F2 · anchor: display pick' });
  const blocked = { status: 'unresolved', modelId: modelA, result: refused() };
  assert.equal(rayLength(blocked.result), 40, 'drawn up to the furthest blocking entity');
  const ray = probeGeometry(blocked);
  assert.deepEqual([ray.kind, ray.from, ray.to], ['ray', [18, 0, 4], [18, 40, 4]]);
  assert.deepEqual(ray.markers.map(marker => marker.label), ['B1.F5', 'B1.F7', 'B1.F6']);
  assert.equal(probeLabel(blocked, format).detail,
    'blocked by B1.F5, B1.F7, B1.F6 · not nudged');
  assert.deepEqual(probeGeometry({ status: 'pending', request: { face: 'B1.F1',
    point: [1, 2, 3] } }), { kind: 'pending', at: [1, 2, 3] });
  assert.equal(probeGeometry({ status: 'error', message: 'x' }), null);

  const text = probeText(probe, format);
  assert.match(text,
    /Thickness: 8\.00000 mm ±0\.00005 \(kernel-resolved\) from B1\.F1 to B1\.F2/);
  assert.match(text, /inward normal of B1\.F1 at the display pick/);
  assert.match(probeText(blocked, format),
    /blocking B1\.F5 \(B1\.E16\): boundary at 12\.00000 mm/);

  const pane = { side: 'after', clipX: 0, clipWidth: 400, modelId: modelA };
  const project = point => ({ x: point[0] * 10, y: point[1] * 10, depth: 0 });
  const markup = probeMarkup({ geometry: probeGeometry(probe), label: probeLabel(probe, format),
    pane, project, height: 300, chips: format });
  assert.match(markup, /class="thickness-line" x1="5" y1="0" x2="5" y2="80"/);
  assert.match(markup, /8\.00000 mm<tspan class="thickness-chip" dx="8">kernel<\/tspan>/);
  assert.match(markup, /anchor: display pick/);
  assert.doesNotMatch(markup, /style=/);
  const refusal = probeMarkup({ geometry: ray, label: probeLabel(blocked, format), pane,
    project, height: 300, chips: format });
  assert.equal(refusal.match(/class="thickness-block"/g).length, 3);
  assert.match(refusal, /class="thickness-ray"/);
});

function viewer({ dispatch } = {}) {
  const requests = [];
  const fake = createFakeEnvironment({
    dispatch: (path, options) => {
      requests.push({ path, method: options?.method ?? 'GET',
        body: options?.body ? JSON.parse(options.body) : null, signal: options?.signal });
      return dispatch?.(path, options) ?? {};
    },
  });
  const none = () => {};
  const seams = { scheduleDraw: none, renderAnnotations: none, renderLibrary: none,
    renderSaved: none, panel: none, renderInspector: none };
  const features = [...legacyFeatures,
    { id: 'thickness', legacy: false, setup: setupThickness }];
  const composed = createViewer(fake.env, { seams, features, log: () => {} });
  const { state } = composed.harness;
  state.workspace.models = [{ id: modelA, label: 'A' }, { id: modelB, label: 'B' }];
  state.scenes.set(modelA, squareScene(modelA));
  state.scenes.set(modelB, squareScene(modelB));
  Object.assign(state, {
    before: modelA, after: modelA, compare: false, loading: false,
    camera: { yaw: 0, pitch: 0, zoom: 1, pan: [0, 0] }, center: [0.5, 0, 0.5], extent: 1,
  });
  const canvas = fake.node('#model-canvas');
  const at = world => composed.harness.project(world, composed.harness.viewPanes()[0]);
  const click = (point, keys = {}) => {
    canvas.emit('pointerdown', { clientX: point.x, clientY: point.y, ...keys });
    canvas.emit('pointerup', { clientX: point.x, clientY: point.y, ...keys });
  };
  const key = (value, extra = {}) => fake.document.emit('keydown', { key: value, ...extra });
  const probes = () => requests.filter(item => item.path.endsWith('/thickness'));
  return {
    ...composed, fake, requests, probes, state, canvas, at, click, key,
    app: composed.ctx.app, store: composed.ctx.store,
  };
}

// A dispatch whose thickness answers wait until the test releases them.
function gated() {
  const pending = [];
  const dispatch = (path, options) => {
    if (!path.endsWith('/thickness')) return {};
    return new Promise((resolve, reject) => {
      pending.push({ resolve, body: JSON.parse(options.body) });
      options.signal?.addEventListener('abort', () => reject(Object.assign(
        new Error('aborted'), { name: 'AbortError' })), { once: true });
    });
  };
  return { pending, dispatch };
}

test('K selects the one-shot tool; K again locks it until Escape', async () => {
  const ui = viewer();
  await flush();
  assert.ok(ui.ctx.commands.has('thickness.tool'));
  assert.deepEqual(ui.ctx.commands.get('thickness.tool').keys, ['K']);
  assert.deepEqual(ui.ctx.commands.conflicts(), [], 'K does not clash with another binding');
  ui.key('k');
  assert.equal(ui.state.tool, 'thickness');
  assert.equal(ui.fake.node('#interaction-hint').textContent, HINT);
  ui.key('k');
  assert.equal(ui.app.thicknessState().locked, true);
  assert.equal(ui.fake.node('#interaction-hint').textContent, LOCKED_HINT);
  ui.key('Escape');
  assert.equal(ui.state.tool, 'select', 'Escape releases the locked tool');
  assert.equal(ui.app.thicknessState().locked, false);
  ui.key('k');
  ui.key('v');
  assert.equal(ui.state.tool, 'select');
  ui.dispose();
});

test('a click posts the face and its display pick, then the rail returns to Select',
  async () => {
    const gate = gated();
    const ui = viewer({ dispatch: gate.dispatch });
    await flush();
    ui.key('k');
    ui.click(ui.at([0.5, 0, 0.5]));
    assert.equal(ui.state.tool, 'select', 'one-shot');
    assert.equal(ui.probes().length, 1);
    const [request] = ui.probes();
    assert.equal(request.path, `/api/models/${modelA}/thickness`);
    assert.equal(request.method, 'POST');
    assert.equal(request.body.face, 'B1.F1');
    request.body.point.forEach((value, axis) => assert.ok(
      Math.abs(value - [0.5, 0, 0.5][axis]) < 1e-9, 'display pick on the face'));
    assert.equal(ui.app.thicknessState().probe.status, 'pending');
    assert.equal(ui.fake.node('#thickness-panel').hidden, false);
    assert.match(ui.fake.node('#thickness-body').innerHTML,
      /Probing B1\.F1 in the query worker/);
    assert.equal(ui.fake.node('#thickness-cancel').hidden, false);
    gate.pending[0].resolve(measured());
    await flush();
    const state = ui.app.thicknessState();
    assert.equal(state.probe.status, 'measured');
    assert.equal(state.label.value, '8.00000 mm');
    const html = ui.fake.node('#thickness-body').innerHTML;
    assert.match(html,
      /<strong>8\.00000 mm<\/strong> <span class="exactness-chip exactness-kernel"/);
    assert.match(html, /±0\.00005 mm<\/span>/);
    assert.match(html, /<details class="thickness-how"><summary>How · 3\.2 ms<\/summary>/);
    assert.match(html, /data-thickness-select="B1\.F2"/);
    assert.equal(ui.fake.node('#thickness-cancel').hidden, true);
    assert.deepEqual(ui.app.thicknessState().probe.reference, { modelId: modelA,
      bodyId: 'part', entityType: 'face', entityIndex: 0 });
    ui.key('k');
    ui.click({ x: 2, y: 2 });
    assert.equal(ui.probes().length, 1, 'a click beside the model posts nothing');
    ui.dispose();
  });

test('latest wins: a new probe aborts the running one; Escape cancels', async () => {
  const gate = gated();
  const ui = viewer({ dispatch: gate.dispatch });
  await flush();
  const first = ui.app.thicknessProbe({ face: 'B1.F1', point: [0.2, 0, 0.2] });
  const second = ui.app.thicknessProbe({ face: 'B1.F1', point: [0.8, 0, 0.8] });
  assert.equal(await first, null, 'the first probe is superseded');
  assert.equal(ui.probes()[0].signal.aborted, true, 'its request is aborted');
  await flush();
  gate.pending[1].resolve(measured());
  assert.equal((await second).status, 'measured');
  const stats = ui.app.thicknessStats();
  assert.deepEqual([stats.requests, stats.completed, stats.superseded, stats.pending],
    [2, 1, 1, false]);
  const third = ui.app.thicknessProbe({ face: 'B1.F1', point: [0.5, 0, 0.5] });
  ui.key('Escape');
  assert.equal(await third, null);
  assert.equal(ui.app.thicknessState().probe.status, 'cancelled');
  assert.equal(ui.probes()[2].signal.aborted, true);
  ui.key('Escape');
  assert.equal(ui.app.thicknessState().probe, null, 'a second Escape clears the card');
  assert.equal(ui.fake.node('#thickness-panel').hidden, true);
  ui.dispose();
});

test('a refusal lists every blocking entity; 501 shows the capability error', async () => {
  const ui = viewer({ dispatch: path => (path.endsWith('/thickness') ? refused() : {}) });
  await flush();
  const result = await ui.app.thicknessProbe({ origin: [18, 0, 4], direction: [0, 1, 0] });
  assert.equal(result.status, 'unresolved');
  const html = ui.fake.node('#thickness-body').innerHTML;
  assert.match(html, /<strong>unresolved<\/strong>/);
  assert.match(html, /3 blocking entities; the ray is not nudged/);
  for (const alias of ['B1.F5', 'B1.E16', 'B1.F7', 'B1.E17', 'B1.F6']) {
    assert.match(html, new RegExp(`data-thickness-select="${alias.replace('.', '\\.')}"`));
  }
  assert.match(html, /boundary hit/);
  assert.match(html, /ray in face/);
  assert.match(html, /The ray is not nudged/);
  assert.equal(ui.fake.node('#thickness-state').textContent, 'unresolved');

  ui.fake.env.fetch = async () => ({ ok: false, status: 501,
    json: async () => ({ error: 'Thickness probe from a cone face is not supported' }) });
  assert.equal(await ui.app.thicknessProbe({ face: 'B1.F1', point: [0, 0, 0] }), null);
  assert.equal(ui.app.thicknessState().probe.status, 'unsupported');
  assert.match(ui.fake.node('#thickness-body').innerHTML, new RegExp('exactness-unsupported'
    + '[^>]*>unsupported</span> <span class="thickness-verbatim">Thickness probe from a cone'));
  ui.dispose();
});

test('a revision swap re-probes the carried face, or marks the probe stale', async () => {
  let resolveAnswer = { status: 'exact', reference: { modelId: modelB, bodyId: 'part',
    entityType: 'face', entityIndex: 0 } };
  const ui = viewer({ dispatch: path => {
    if (path.endsWith('/resolve')) return { results: [resolveAnswer] };
    if (path.endsWith('/thickness')) return measured();
    return {};
  } });
  await flush();
  await ui.app.thicknessProbe({ face: 'B1.F1', point: [0.5, 0, 0.5] }, {
    reference: { modelId: modelA, bodyId: 'part', entityType: 'face', entityIndex: 0 } });
  ui.state.after = modelB;
  for (let tries = 0; tries < 10; tries++) await flush();
  const resolve = ui.requests.find(item => item.path.endsWith('/resolve'));
  assert.equal(resolve.path, `/api/models/${modelB}/resolve`);
  assert.deepEqual(resolve.body, { from: modelA, references: [{ modelId: modelA,
    bodyId: 'part', entityType: 'face', entityIndex: 0 }] });
  assert.equal(ui.probes().at(-1).path, `/api/models/${modelB}/thickness`);
  assert.deepEqual(ui.probes().at(-1).body, { face: 'B1.F1', point: [0.5, 0, 0.5] });
  const carried = ui.app.thicknessState().probe;
  assert.deepEqual([carried.status, carried.modelId], ['measured', modelB]);
  assert.match(ui.fake.node('#thickness-body').innerHTML, /Re-probed on this revision/);

  resolveAnswer = { status: 'lost', reason: 'B1.F1 has a revision-local identity' };
  ui.state.after = modelA;
  for (let tries = 0; tries < 10; tries++) await flush();
  const stale = ui.app.thicknessState().probe;
  assert.equal(stale.status, 'stale');
  assert.match(ui.fake.node('#thickness-body').innerHTML, /revision-local identity/);
  assert.equal(ui.app.thicknessStats().carried, 1);
  ui.state.after = modelB;
  await flush();
  assert.equal(ui.app.thicknessState().probe, null,
    'a stale probe is dropped on the next swap');
  ui.dispose();
});
