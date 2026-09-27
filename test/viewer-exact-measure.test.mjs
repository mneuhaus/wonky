// exact-measure, client side: the 4 px pointer threshold, Shift/⌘-click
// multi-selection, display anchors, the measure feature (exact geometry
// cache, hover status line, measurement section, Copy measurement with
// archive first, dimension line) and the labelled model size. Runs the real
// feature code in the fake browser environment of the VS harness.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createViewer } from '../viewer/app.js';
import { loadFeatures } from '../viewer/core/feature-loader.js';
import { DRAG_THRESHOLD_PX, isDrag } from '../viewer/core/pointer.js';
import { LEGACY_FEATURES } from '../viewer/features/index.js';
import {
  displayAnchor, toggleReference,
} from '../viewer/features/selection/selection.js';
import {
  exactRows, hoverText, summaryText, valueText,
} from '../viewer/features/measure/geometry-section.js';
import { hoverLine } from '../viewer/features/measure/hover-status.js';
import {
  measureInputs, measurementContent, measurementText, setupExactMeasure,
} from '../viewer/features/measure/measure-section.js';
import {
  dimensionEndpoints, dimensionMarkup,
} from '../viewer/features/measure/dimension-layer.js';
import {
  modelSize, overviewSizeMarkup, sizeText,
} from '../viewer/features/inspector/overview-section.js';
import { createFakeEnvironment } from '../scripts/viewer/test-support/fake-env.mjs';

const { features: legacyFeatures } = await loadFeatures(LEGACY_FEATURES);
const measureFeature = { id: 'measure', legacy: false, setup: setupExactMeasure };
const modelA = 'a'.repeat(64);
const modelB = 'b'.repeat(64);
const flush = () => new Promise(resolve => setImmediate(resolve));

// A 1 × 1 mm square in the XZ plane facing −Y (like the VS interactive scene).
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
const vertex = (index, modelId = modelA) => ({ modelId, bodyId: 'part', entityType: 'vertex',
  entityIndex: index });

function viewer({ dispatch, withMeasure = false, inspect = false } = {}) {
  const requests = [];
  const fake = createFakeEnvironment({
    dispatch: (path, options) => {
      requests.push(`${options?.method ?? 'GET'} ${path}`);
      if (!dispatch) throw new Error(`Unexpected request ${path}`);
      return dispatch(path, options);
    },
  });
  const none = () => {};
  const seams = { scheduleDraw: none, renderAnnotations: none, renderLibrary: none,
    renderSaved: none, panel: none, ...(inspect ? {} : { renderInspector: none }) };
  const features = withMeasure ? [...legacyFeatures, measureFeature] : legacyFeatures;
  const composed = createViewer(fake.env, { seams, features, legacy: !withMeasure,
    log: () => {} });
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
  const press = (point, { dx = 0, dy = 0, steps = 1, ...keys } = {}) => {
    canvas.emit('pointerdown', { clientX: point.x, clientY: point.y, ...keys });
    for (let step = 1; step <= steps; step++) {
      canvas.emit('pointermove', { clientX: point.x + dx * step / steps,
        clientY: point.y + dy * step / steps, buttons: 1, ...keys });
    }
    canvas.emit('pointerup', { clientX: point.x + dx, clientY: point.y + dy, ...keys });
  };
  return { ...composed.harness, ctx: composed.ctx, fake, canvas, requests, at, press, state };
}

test('the drag threshold is 4 CSS px for every press', () => {
  assert.equal(DRAG_THRESHOLD_PX, 4);
  assert.equal(isDrag({ x: 0, y: 0 }, { x: 3.9, y: 0 }), false);
  assert.equal(isDrag({ x: 0, y: 0 }, { x: 2, y: 2 }), false);
  assert.equal(isDrag({ x: 0, y: 0 }, { x: 4, y: 0 }), true);
  const ui = viewer();
  const center = ui.at([0.5, 0, 0.5]);
  ui.press(center, { dx: 3 });
  assert.deepEqual(ui.state.selectionSet, [face()], 'a 3 px wobble is still a click');
  assert.equal(ui.state.camera.yaw, 0);
  ui.press(center, { dx: 4 });
  assert.notEqual(ui.state.camera.yaw, 0, 'a 4 px drag orbits');
  assert.deepEqual(ui.state.selectionSet, [face()], 'orbiting keeps the selection');
});

test('Shift-click with 2 px jitter adds the entity without panning; a 4 px Shift-drag pans',
  () => {
    const ui = viewer();
    ui.press(ui.at([0.5, 0, 0.5]));
    assert.deepEqual(ui.state.selectionSet, [face()]);
    const corner = ui.at([1, 0, 1]);
    const target = [...ui.state.camera.target];
    ui.press(corner, { dx: 2, dy: 1, steps: 2, shiftKey: true });
    assert.deepEqual(ui.state.selectionSet, [face(), vertex(2)]);
    assert.deepEqual(ui.state.selection, face(), 'the primary stays the first entity');
    assert.deepEqual(ui.state.camera.target, target, 'the jittery Shift-click did not pan');
    ui.press(ui.at([0.3, 0, 0.3]), { dx: 4, steps: 4, shiftKey: true });
    assert.notDeepEqual(ui.state.camera.target, target, 'a 4 px Shift-drag pans');
    assert.deepEqual(ui.state.selectionSet, [face(), vertex(2)]);
    // ⌘-click toggles an entity out again; a plain click replaces the set.
    ui.press(corner, { metaKey: true });
    assert.deepEqual(ui.state.selectionSet, [face()]);
    ui.press(ui.at([0, 0, 0]), { ctrlKey: true });
    assert.deepEqual(ui.state.selectionSet, [face(), vertex(0)]);
    ui.press(ui.at([0.5, 0, 0.5]));
    assert.deepEqual(ui.state.selectionSet, [face()]);
    assert.deepEqual(ui.requests, [], 'selection makes no requests in the legacy seam');
  });

test('toggleReference adds and removes by reference identity', () => {
  assert.deepEqual(toggleReference([], face()), [face()]);
  assert.deepEqual(toggleReference([face(), vertex(1)], { ...face() }), [vertex(1)]);
  assert.deepEqual(toggleReference([face()], null), [face()]);
});

test('display anchors are the picked display points in world mm', () => {
  const ui = viewer();
  const pane = ui.viewPanes()[0];
  const scene = ui.state.scenes.get(modelA);
  const records = { scene, body: scene.bodies[0], entity: scene.bodies[0].faces[0] };
  const screen = ui.project([0.25, 0, 0.75], pane);
  const anchor = displayAnchor(records, face(), { ...screen, pane, project: ui.project });
  anchor.forEach((value, axis) => assert.ok(Math.abs(value - [0.25, 0, 0.75][axis]) < 1e-9));
  const edge = { ...records, entity: scene.bodies[0].edges[0] };
  const onEdge = ui.project([0.4, 0, 0], pane);
  const edgeAnchor = displayAnchor(edge, { ...face(), entityType: 'edge' },
    { x: onEdge.x, y: onEdge.y + 3, pane, project: ui.project });
  assert.ok(Math.abs(edgeAnchor[0] - 0.4) < 1e-6);
  ui.press(ui.project([0.25, 0, 0.75], pane));
  const stored = ui.ctx.app.selectionAnchor(face());
  assert.equal(stored.source, 'pick');
  stored.point.forEach((value, axis) => assert.ok(Math.abs(value - [0.25, 0, 0.75][axis]) < 1e-9));
  ui.select([face(), vertex(1)]);
  assert.equal(ui.ctx.app.selectionAnchor(face()).source, 'pick', 'a kept entity keeps its pick');
  const centroid = ui.ctx.app.selectionAnchor(vertex(1));
  assert.deepEqual(centroid, { point: [1, 0, 0], source: 'centroid' });
});

// Canned server answers (the server functions are tested in viewer-measure.test.mjs).
const planeEntry = alias => ({
  alias, bodyId: 'part', index: Number(alias.split('.F')[1]) - 1, logical: 'B1.L1',
  fragments: [alias], outwardNormal: [0, -1, 0], hole: null, axisPointNearestOrigin: null,
  toleranceMm: 0.0003, exactness: 'exact-parameters',
  surface: { type: 'plane', originMm: [0, 0, 0], normal: [0, -1, 0], offsetMm: 0,
    frame: { x: [1, 0, 0], y: [0, 0, 1] } },
});
const cylinderEntry = {
  kind: 'face', alias: 'B1.F3', bodyId: 'part', logical: 'B1.L3', fragments: ['B1.F3'],
  toleranceMm: 0.0003, exactness: 'exact-parameters', hole: true,
  surface: { type: 'cylinder', radiusMm: 2, diameterMm: 4, sense: 'hole',
    normalSense: 'toward the axis', originMm: [0, 0, 0],
    axis: { direction: [0, 0, 1], pointNearestOriginMm: [0, 0, 0] } },
};
const offsetRow = {
  quantity: 'parallelOffset', label: 'Parallel offset', value: 8, unit: 'mm',
  exactness: 'exact-parameters', toleranceMm: 0.0003, angularToleranceRad: 1e-9,
  method: '|(o2 − o1)·n1| (kernel.precise)', inputs: [`B1.F1@${modelA}`, `B1.V3@${modelA}`],
  note: 'supporting planes (trims not considered)', pair: [0, 1],
  witness: { kind: 'offset', from: 0, direction: [0, -1, 0], lengthMm: 8 },
};
const measured = {
  schema: 'wonky.viewer-measure/1', modelId: modelA, primary: 0,
  entities: [{ index: 0, alias: 'B1.F1', modelId: modelA, type: 'plane', face: 'B1.F1' },
    { index: 1, alias: 'B1.V3', modelId: modelA, type: 'point' }],
  measurements: [offsetRow],
  unsupported: [{ quantity: 'minimumDistance', pair: [0, 1], inputs: offsetRow.inputs,
    reason: 'general minimum distance between trimmed faces needs kernel extrema' }],
};

function measureDispatch(log) {
  return (path, options) => {
    log?.push(`${options?.method ?? 'GET'} ${path}`);
    if (/\/geometry\?page=0$/.test(path)) {
      return { pages: 1, faces: [planeEntry('B1.F1')], edges: [], vertices: [],
        bounds: { minMm: [0, 0, 0], maxMm: [1, 0, 1], exactness: 'recorded' } };
    }
    if (/\/geometry\?aliases=/.test(path)) return { faces: [planeEntry('B1.F1')] };
    if (/\/measure$/.test(path)) return measured;
    if (/\/archive$/.test(path)) {
      return { path: `/reviews/models/${modelA}.brep.json`, modelId: modelA };
    }
    throw new Error(`Unexpected request ${path}`);
  };
}

test('the measure feature measures the selection, draws the line and copies after archiving',
  async () => {
    const log = [];
    const ui = viewer({ dispatch: measureDispatch(log), withMeasure: true, inspect: true });
    ui.press(ui.at([0.5, 0, 0.5]));
    ui.press(ui.at([1, 0, 1]), { shiftKey: true });
    await flush();
    const measureCalls = log.filter(entry => entry.startsWith('POST') && /measure$/.test(entry));
    assert.equal(measureCalls.length, 1, 'one measure request for the selection set');
    const entry = ui.ctx.app.measureSelection();
    assert.equal(entry.status, 'ok');
    assert.deepEqual(measureInputs(ui.state.scenes, ui.state.selectionSet),
      [{ modelId: modelA, alias: 'B1.F1' }, { modelId: modelA, alias: 'B1.V3' }]);
    ui.renderOverlay();
    const overlay = ui.fake.node('#annotation-overlay').innerHTML;
    assert.match(overlay, /class="dimension-line"/);
    assert.match(overlay, /8\.0000 mm/);
    assert.match(overlay, /exact ±0\.0003/);
    assert.match(overlay, /anchor: display pick/);
    await ui.ctx.app.copyMeasurement();
    const archive = log.findIndex(item => /POST .*\/archive$/.test(item));
    assert.ok(archive > log.findIndex(item => /measure$/.test(item)), 'archive before copy');
    const copied = ui.fake.clipboard.text;
    assert.match(copied, /Parallel offset: 8\.0000 mm · exact ±0\.0003/);
    assert.match(copied, /unsupported: general minimum distance/);
    assert.ok(copied.includes(`node bin/wonky-inspect.mjs "/reviews/models/${modelA}.brep.json"`
      + ` --revision ${modelA} --detail B1.F1`));
  });

test('hovering fetches exact geometry and shows the status line', async () => {
  const log = [];
  const ui = viewer({ dispatch: measureDispatch(log), withMeasure: true });
  const center = ui.at([0.5, 0, 0.5]);
  ui.canvas.emit('pointermove', { clientX: center.x, clientY: center.y });
  ui.fake.flushFrames();
  await flush();
  assert.deepEqual(ui.state.hover, face());
  assert.equal(ui.fake.node('#hover-status').textContent,
    'Plane · normal (0, -1, 0) · offset 0.0000 mm · exact ±0.0003 · B1.F1');
  assert.ok(log.some(item => /geometry\?(page=0|aliases=B1\.F1)$/.test(item)));
});

test('legacy seam: selecting and multi-selecting makes no request', async () => {
  const ui = viewer({ inspect: true });
  ui.select([face(), vertex(1)]);
  ui.renderInspector();
  await flush();
  assert.deepEqual(ui.requests, []);
});

test('formatters: hover text, exact rows and measurement values', () => {
  assert.equal(hoverText(cylinderEntry), 'Cylinder hole Ø4.0000 mm · exact ±0.0003 · B1.F3');
  assert.equal(summaryText(cylinderEntry), 'Cylinder hole Ø4.0000 mm');
  const rows = Object.fromEntries(exactRows(cylinderEntry));
  assert.equal(rows['Axis direction'], '(0, 0, 1)');
  assert.equal(rows['Axis point nearest origin · mm'], '(0.0000, 0.0000, 0.0000)');
  assert.equal(rows.Diameter, 'Ø4.0000 mm');
  const merged = { ...cylinderEntry, fragments: ['B1.F3', 'B1.F9'] };
  assert.match(hoverText(merged), /B1\.L3 \(2 fragments\)$/);
  assert.equal(valueText(offsetRow), '8.0000 mm');
  assert.equal(valueText({ ...offsetRow, value: 90, unit: 'deg' }), '90.000°');
  assert.equal(valueText({ ...offsetRow, value: true, unit: null }), 'yes');
  const scene = squareScene(modelA);
  assert.equal(hoverLine({ reference: face(), scene, entry: null }),
    'Face B1.F1 · loading exact geometry…');
  assert.equal(hoverLine({ reference: face(), scene, entry: null, error: true }),
    'Face B1.F1 · exact geometry unavailable');
});

test('measurement section: rows, unsupported reasons and the revisions row', () => {
  const references = [face(), vertex(2)];
  const markup = measurementContent(references, { status: 'ok', data: measured });
  assert.match(markup, /Parallel offset/);
  assert.match(markup, /8\.0000 mm/);
  assert.match(markup, /unsupported: general minimum distance between trimmed faces needs kernel/);
  const foreign = {
    ...measured, primary: null, measurements: [],
    entities: [measured.entities[0], { ...measured.entities[1], modelId: modelB,
      type: 'foreign' }],
    unsupported: [{ quantity: 'relation', reason: 'entities from different revisions',
      inputs: [], pair: [0, 1] }],
  };
  const other = measurementContent([face(), vertex(2, modelB)], { status: 'ok', data: foreign });
  assert.match(other, /unsupported: entities from different revisions/);
  assert.match(other, /rev bbbbbbbb/);
  assert.match(measurementContent(references, { status: 'pending' }), /Measuring…/);
  assert.match(measurementContent(references, { status: 'error', error: new Error('boom') }),
    /Measurement failed: boom/);
  const text = measurementText(measured, { archives: {} });
  assert.doesNotMatch(text, /wonky-inspect/, 'no command without an archived path');
});

test('dimension endpoints follow the witness; anchors are labelled', () => {
  const pick = point => ({ point, source: 'pick' });
  const anchors = [pick([1, 2, 3]), pick([4, 5, 6])];
  const offset = dimensionEndpoints(offsetRow.witness, anchors);
  assert.deepEqual(offset, { points: [[1, 2, 3], [1, -6, 3]], anchor: 'pick' });
  const radial = dimensionEndpoints({ kind: 'radial', axisPoint: [0, 0, 0], axis: [0, 0, 1],
    radii: [4, 4.2] }, [null, { point: [0, 10, 5], source: 'centroid' }]);
  assert.deepEqual(radial, { points: [[0, 4, 5], [0, 4.2, 5]], anchor: 'centroid' });
  // A clicked entity's pick beats the centroid of one chosen without a click
  // (Browse geometry): the bore's centroid lies on the axis and has no side.
  const centroid = point => ({ point, source: 'centroid' });
  const radialPick = dimensionEndpoints({ kind: 'radial', axisPoint: [0, 0, 0], axis: [0, 0, 1],
    radii: [4, 4.2] }, [centroid([0, 0, 6]), pick([4, 0, 13])]);
  assert.deepEqual(radialPick, { points: [[4, 0, 13], [4.2, 0, 13]], anchor: 'pick' });
  const offsetBack = dimensionEndpoints(offsetRow.witness, [centroid([1, 2, 3]), pick([4, -6, 6])]);
  assert.deepEqual(offsetBack, { points: [[4, -6, 6], [4, 2, 6]], anchor: 'pick' },
    'from the pick on the second plane back to the first');
  const axes = { kind: 'axes', mode: 'gap', axis: [0, 0, 1],
    from: { index: 0, point: [0, 0, 0], radius: 1 },
    to: { index: 1, point: [5, 0, 0], radius: 2 } };
  assert.deepEqual(dimensionEndpoints(axes, [pick([0, 1, 3]), null]).points,
    [[1, 0, 3], [3, 0, 3]]);
  assert.equal(dimensionEndpoints(axes, []).anchor, 'exact', 'no pick: exact axis points');
  const skew = dimensionEndpoints({ kind: 'lines', lines: [
    { index: 0, point: [0, 0, 0], direction: [1, 0, 0] },
    { index: 1, point: [0, 0, 2], direction: [0, 1, 0] }] }, anchors);
  assert.deepEqual(skew, { points: [[0, 0, 0], [0, 0, 2]], anchor: 'exact' });
  const exact = dimensionEndpoints({ kind: 'segment', points: [[0, 0, 0], [1, 0, 0]] }, []);
  assert.equal(exact.anchor, 'exact');
  assert.equal(dimensionEndpoints(undefined, anchors), null, 'no witness, no line');
  assert.equal(dimensionEndpoints(offsetRow.witness, [null, null]), null);
  const pane = { x: 0, y: 0, width: 100, height: 100, clipX: 0, clipWidth: 100, side: 'after' };
  const markup = dimensionMarkup({
    row: offsetRow, endpoints: { points: [[0, 0, 0], [8, 0, 0]], anchor: 'pick' }, pane,
    project: point => ({ x: 10 + point[0] * 5, y: 50, depth: 0 }), height: 100,
  });
  assert.match(markup, /dimension-line/);
  assert.match(markup, />8\.0000 mm</);
  assert.match(markup, />exact ±0\.0003</);
  assert.match(markup, />anchor: display pick</);
});

test('the model size says recorded, kernel or display ±0.02', () => {
  const scene = squareScene(modelA);
  scene.bounds = { min: [0, 0, 0], max: [20, 20, 20] };
  const display = modelSize(scene, { minMm: null, maxMm: null, exactness: 'recorded',
    note: 'not evaluated: B1 has no recorded bounds' });
  assert.equal(display.exactness, 'display-approximation');
  assert.equal(sizeText(display), '≈ 20.00 × 20.00 × 20.00 mm');
  assert.match(overviewSizeMarkup(scene, null), /display ±0\.02/);
  const recorded = { minMm: [0, 0, 0], maxMm: [50, 40, 8], exactness: 'recorded' };
  assert.equal(sizeText(modelSize(scene, recorded)), '50 × 40 × 8 mm');
  assert.match(overviewSizeMarkup(scene, recorded), /exactness-recorded[^>]*>recorded</);
  const kernel = { ...recorded, exactness: 'kernel-resolved' };
  assert.match(overviewSizeMarkup(scene, kernel), />kernel</);
});

test('the selection filter is a global setting (in memory under the legacy seam)', async () => {
  const ui = viewer();
  ui.fake.node('#selection-mode').onchange({ target: { value: 'edge' } });
  assert.equal(ui.state.mode, 'edge');
  assert.equal(ui.ctx.settings.get('G', 'selectionFilter'), 'edge');
  await ui.ctx.settings.set('G', 'selectionFilter', 'vertex');
  assert.equal(ui.state.mode, 'vertex', 'a loaded or changed setting applies the filter');
  assert.equal(ui.fake.node('#selection-mode').value, 'vertex');
  await ui.ctx.settings.set('G', 'selectionFilter', 'nonsense');
  assert.equal(ui.state.mode, 'vertex', 'unknown values are ignored');
  assert.deepEqual(ui.requests, []);
});
