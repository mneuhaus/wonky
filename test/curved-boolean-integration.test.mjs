import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("curved-boolean-integration.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { mkdirSync, writeFileSync } = await import("node:fs");
const { loadKernel, extrudeInBend } = await import("../src/kernel.mjs");
const { decodeAnalytic, transformAnalytic } = await import("../src/analytic.mjs");
const { booleanInBend } = await import("../src/boolean.mjs");
const { classificationInput } = await import("../src/face-classification.mjs");
const { real, vector, number } = await import("../src/real.mjs");
const { toStep } = await import("../src/exporters.mjs");
const { createGeometryInspector } = await import("../src/geometry-summary.mjs");
const { historyEvidence, serializeModel } = await import("../src/construction-history.mjs");












const k = await loadKernel();
const frame = { origin: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0] };
const cylinder = () => decodeAnalytic(k.analytic.frustum(vector([0, 0, 0]), vector([0, 0, 10]), vector([1, 0, 0]), real(5), real(5)), 'cylinder', k);
const box = (name, low, high) => extrudeInBend(k, name,
  [[low[0], low[1]], [high[0], low[1]], [high[0], high[1]], [low[0], high[1]]],
  { ...frame, origin: [0, 0, low[2]] }, [0, 0, high[2] - low[2]]);
const cut = (body, tool, id) => booleanInBend(k, body, tool, 'INTERSECTION', id);
// A later Boolean records its input's earlier operations by reference (evidence/2):
// the operation summary and this input's transform chain, not a nested copy of that
// evidence; the full evidence is resolved from the model-level list.
const historyReferences = history => history.map(({ evidence, transformChain }) => ({ evidence: { schema: 'wonky-operation-evidence/2',
  operationId: evidence.operationId, operation: evidence.operation, method: evidence.method, status: evidence.status }, transformChain }));
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8 * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
function emit(name, bodies) {
  const prefix = new URL(`../out/curved-boolean-integration/${name}`, import.meta.url);
  mkdirSync(new URL('../out/curved-boolean-integration/', import.meta.url), { recursive: true });
  const model = { schema: 'wonky-brep/1', units: 'millimeter', backend: { language: 'Bend' },
    modelingPolicy: { curvedContacts: 'strict' }, operationEvidence: bodies.operationEvidence ?? [], bodies };
  writeFileSync(new URL(`${prefix.href}.brep.json`), serializeModel(model));
  writeFileSync(new URL(`${prefix.href}.step`), toStep(model, name));
}

test('production curved intersection decodes native domains, volume and original-operand provenance', () => {
  const outputs = cut(cylinder(), box('tool', [-10, -10, -1], [10, 10, 6]), 'axial');
  assert.equal(outputs.length, 1);
  const [body] = outputs, evidence = outputs.operationEvidence[0];
  near(body.validation.volumeMm3, 150 * Math.PI);
  assert.equal(body.validation.boundsMm, null);
  assert.equal(body.construction.faceOrigins.length, body.faces.length);
  assert.equal(body.construction.edgeOrigins.length, body.edges.length);
  assert.ok(body.edges.every(edge => edge.curveRange?.length === 2 ||
    (edge.start === edge.end && ['circle', 'ellipse'].includes(edge.curve.type))));
  assert.ok(body.construction.faceOrigins.some(face => face.operand === 0));
  assert.ok(body.construction.faceOrigins.some(face => face.operand === 1));
  assert.equal(evidence.policy.$, 'StrictTransverse');
  assert.equal(evidence.steps.length, 6);
  assert.ok(evidence.steps.every(step => step.origin && step.normal && step.source_vertices));
  assert.equal(evidence.inputs[0].bodyId, 'cylinder');
  assert.equal(evidence.inputs[0].identity.instanceId, body.identity.lineage.parents[0].instanceId);
  assert.equal(evidence.inputs[0].identity.topology.faces.length, 3);
  assert.deepEqual(body.operationHistory[0].transformChain, []);
  assert.equal(evidence.outputs[0].revision, body.identity.revision);
  emit('axial', outputs);
});

test('reader allowance cannot increase native construction budget after export, transform or a later Boolean', () => {
  const first = cut(cylinder(), box('tool', [-10, -10, -1], [10, 10, 6]), 'initial'), [initial] = first;
  const saved = JSON.parse(JSON.stringify(initial));
  assert.equal(saved.constructionBudget.ceilingMm, 0);
  assert.ok(saved.vertexTolerancesMm.every(value => value === 0.0003));
  saved.vertexTolerancesMm.fill(0.009);
  assert.equal(number(classificationInput(saved, k.faceClassifier).sourceBudget), 0);
  assert.throws(() => classificationInput(saved, k.faceClassifier, { inputTolerance: 1e-8 }), /cannot enlarge/);
  const before = structuredClone(saved.operationHistory);
  const rows = [[0, -1, 0], [1, 0, 0], [0, 0, 1]], offset = [3, 2, 1];
  const moved = transformAnalytic(k, saved, 'moved', rows, offset);
  assert.deepEqual(saved.operationHistory, before);
  assert.deepEqual(moved.operationHistory[0].evidence, before[0].evidence);
  assert.deepEqual(moved.operationHistory[0].transformChain, [{ operationId: 'moved', rows, offsetMm: offset }]);
  assert.deepEqual(moved.constructionBudget, saved.constructionBudget);
  const later = cut(moved, box('later-tool', [-20, -20, -10], [20, 20, 5]), 'later');
  assert.equal(later.length, 1);
  near(later[0].validation.volumeMm3, 100 * Math.PI);
  assert.equal(later[0].constructionBudget.ceilingMm, 0);
  const [reference] = later.operationEvidence[0].inputs[0].history;
  assert.deepEqual([reference], historyReferences(moved.operationHistory));
  const model = { operationEvidence: [...first.operationEvidence, ...later.operationEvidence] };
  assert.equal(historyEvidence(model, reference), first.operationEvidence[0]);
  assert.deepEqual(JSON.parse(JSON.stringify(historyEvidence(model, reference))), moved.operationHistory[0].evidence);
  assert.deepEqual(JSON.parse(JSON.stringify(later[0])).operationHistory, later[0].operationHistory);
  emit('transformed-repeat', later);
});

test('curved Empty results retain operation frame, cutter, source budget and prior history', () => {
  const first = cut(cylinder(), box('tool', [-10, -10, -1], [10, 10, 6]), 'initial-empty'), [initial] = first;
  const outputs = cut(initial, box('away', [-10, -10, 20], [10, 10, 21]), 'empty');
  assert.equal(outputs.length, 0);
  const evidence = outputs.operationEvidence[0];
  assert.equal(evidence.status, 'Bodies');
  assert.deepEqual(evidence.outputs, []);
  assert.equal(evidence.frame.id, 'empty/input-frame');
  assert.equal(number(evidence.sourceBudget), 0);
  assert.ok(evidence.steps.length > 0);
  assert.ok(evidence.steps.some(step => step.components === 0 && step.origin && step.normal));
  assert.deepEqual(evidence.inputs[0].history, historyReferences(initial.operationHistory));
  assert.equal(historyEvidence({ operationEvidence: [...first.operationEvidence, evidence] }, evidence.inputs[0].history[0]), first.operationEvidence[0]);
});

test('an enlarged reader allowance cannot conceal damage in a later native source audit', () => {
  const [initial] = cut(cylinder(), box('tool', [-10, -10, -1], [10, 10, 6]), 'undamaged');
  const damaged = structuredClone(initial);
  damaged.vertexTolerancesMm.fill(0.009);
  damaged.vertices[0][0] += 0.001;
  assert.throws(() => cut(damaged, box('enclosing', [-20, -20, -10], [20, 20, 20]), 'rejected'), error => {
    assert.match(error.message, /InvalidTopology/);
    assert.equal(error.operationEvidence[0].status, 'Unresolved');
    assert.equal(number(error.operationEvidence[0].sourceBudget), 0);
    assert.equal(error.operationEvidence[0].outputs, undefined);
    return true;
  });
});

test('planar Boolean results also preserve the native ceiling independently of reader allowances', () => {
  const [body] = cut(box('left', [0, 0, 0], [4, 4, 4]), box('right', [2, -1, -1], [5, 5, 5]), 'planar');
  assert.equal(body.constructionBudget.ceilingMm, 0);
  body.vertexTolerancesMm = body.vertices.map(() => 0.009);
  assert.equal(number(classificationInput(body, k.faceClassifier).sourceBudget), 0);
  const again = cut(body, box('top', [-1, -1, -1], [6, 6, 3]), 'planar-again');
  near(again[0].validation.volumeMm3, 24);
  assert.equal(again[0].constructionBudget.ceilingMm, 0);
});

test('geometry details resolve native face ancestry in its historical operation frame after a transform', () => {
  const [body] = cut(cylinder(), box('inspector-tool', [-10, -10, -1], [10, 10, 6]), 'inspector-cut');
  const rows = [[0, -1, 0], [1, 0, 0], [0, 0, 1]], offset = [3, 2, 1];
  const moved = transformAnalytic(k, body, 'inspector-moved', rows, offset);
  const inspector = createGeometryInspector({ schema: 'wonky-brep/1', units: 'millimeter', bodies: [moved] });
  for (let index = 0; index < moved.faces.length; index++) {
    const detail = inspector.detail({ modelId: inspector.modelId, alias: `B1.F${index + 1}` });
    const origin = detail.constructionOrigin;
    assert.deepEqual(origin.origin, body.construction.faceOrigins[index]);
    assert.equal(origin.frame.id, 'inspector-cut/input-frame');
    assert.deepEqual(origin.transformChain, [{ operationId: 'inspector-moved', rows, offsetMm: offset }]);
    assert.equal(origin.references.length, 1);
    const [ref] = origin.references, input = body.operationHistory[0].evidence.inputs[ref.operand];
    assert.equal(ref.status, 'recorded-input-reference');
    assert.equal(ref.bodyId, input.bodyId);
    assert.equal(ref.geometryRevision, input.revision);
    assert.deepEqual(ref.identity, input.identity.topology.faces[ref.index]);
  }
  const withoutHistory = structuredClone(moved);
  delete withoutHistory.operationHistory;
  const incomplete = createGeometryInspector({ schema: 'wonky-brep/1', units: 'millimeter', bodies: [withoutHistory] });
  const unresolved = incomplete.detail({ modelId: incomplete.modelId, alias: 'B1.F1' }).constructionOrigin;
  assert.deepEqual(unresolved.origin, moved.construction.faceOrigins[0]);
  assert.ok(unresolved.references.every(ref => ref.status === 'unresolved-input-reference' && ref.identity === null));
});

}
