import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend() || missing("fixtures/boolean-stress/r10b-g7-operands.json", "fixtures/boolean-stress/r10b-union-probes.json");
if (publicTreeSkip) {
  test("planar-boolean-integration.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { mkdirSync, readFileSync, writeFileSync } = await import("node:fs");
const { loadKernel, extrudeInBend, array } = await import("../src/kernel.mjs");
const { booleanInBend } = await import("../src/boolean.mjs");
const { transformAnalytic } = await import("../src/analytic.mjs");
const { classificationInput } = await import("../src/face-classification.mjs");
const { constructionBudget, historyEvidence } = await import("../src/construction-history.mjs");
const { real, number } = await import("../src/real.mjs");
const { geometryRevision } = await import("../src/identity.mjs");
const { toStep } = await import("../src/exporters.mjs");
const { build } = await import("../src/index.mjs");
const { createGeometryInspector } = await import("../src/geometry-summary.mjs");
const { classifySolid } = await import("../src/solid-classification.mjs");















const k = await loadKernel();
const frozen = JSON.parse(readFileSync(new URL('../fixtures/boolean-stress/r10b-g7-operands.json', import.meta.url)));
const probes = JSON.parse(readFileSync(new URL('../fixtures/boolean-stress/r10b-union-probes.json', import.meta.url))).points;
const inputs = () => frozen.bodies.map(entry => structuredClone(entry.body));
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);
const join = (a, b, id) => booleanInBend(k, a, b, 'UNION', id, { line: 25, column: 2 });
async function checkProbes(body, stage, transform = p => p) {
  for (const probe of probes) {
    const result = await classifySolid(body, transform(probe.pointMm));
    assert.equal(result.$, probe[stage], `${stage}/${probe.id}: ${JSON.stringify(result)}`);
  }
}
function emit(name, bodies) {
  const directory = new URL('../out/planar-boolean-integration/', import.meta.url);
  mkdirSync(directory, { recursive: true });
  const model = { schema: 'wonky-brep/1', units: 'millimeter', backend: { language: 'Bend' },
    modelingPolicy: { curvedContacts: 'strict' }, operationEvidence: bodies.operationEvidence ?? [], bodies };
  writeFileSync(new URL(`${name}.brep.json`, directory), JSON.stringify(model, null, 2) + '\n');
  writeFileSync(new URL(`${name}.step`, directory), toStep(model, name));
}

test('actual frozen g7 union reaches the production Bend path with full provenance and original budget', async () => {
  for (const swap of [false, true]) {
    const original = inputs(), [a, b] = swap ? original.toReversed() : original;
    const revisions = [a, b].map(geometryRevision);
    const bodies = join(a, b, `g7-${swap}`);
    assert.equal(bodies.length, 1);
    const [body] = bodies, evidence = bodies.operationEvidence[0];
    near(body.validation.volumeMm3, 51985.642486572266);
    assert.deepEqual(body.validation.boundsMm, { min: [-93.30000305175781, 0, -15], max: [93.30000305175781, 25, 48] });
    assert.deepEqual([a, b].map(geometryRevision), revisions);
    assert.equal(body.validation.closed, true);
    assert.equal(body.constructionBudget.ceilingMm, 0);
    assert.equal(evidence.status, 'Bodies');
    assert.equal(evidence.operation, 'UNION');
    assert.equal(evidence.frame.id, `g7-${swap}/input-frame`);
    assert.deepEqual(evidence.inputs.map(input => input.revision), revisions);
    assert.equal(evidence.outputs[0].revision, body.identity.revision);
    assert.equal(body.identity.operation.source.span.line, 25);
    assert.equal(body.construction.faceOrigins.length, body.faces.length);
    assert.equal(body.construction.edgeOrigins.length, body.edges.length);
    assert.ok(body.construction.faceOrigins.some(origin => array(origin.contributors).length > 1), 'shared coplanar ownership is retained');
    assert.ok(body.construction.edgeOrigins.some(origin => origin.$ === 'FaceSubdivision'), 'arrangement seams are explicitly distinguished');
    const inspector = createGeometryInspector({ schema: 'wonky-brep/1', units: 'millimeter', bodies });
    const sharedFace = body.construction.faceOrigins.findIndex(origin => array(origin.contributors).length > 1);
    const detail = inspector.detail({ modelId: inspector.modelId, alias: `B1.F${sharedFace + 1}` }).constructionOrigin;
    assert.equal(detail.references.length, array(body.construction.faceOrigins[sharedFace].contributors).length);
    assert.ok(detail.references.every(ref => ref.status === 'recorded-input-reference' && ref.identity));
    assert.deepEqual(detail.references.map(ref => ref.bodyId), detail.references.map(ref => [a, b][ref.operand].id));
    await checkProbes(body, 'g7');
    emit(`g7-${swap ? 'swapped' : 'original'}`, bodies);
  }
});

test('the next g9 union consumes a subdivided result without losing its zero budget or operation history', async () => {
  const g7 = join(...inputs(), 'g7-sequence'), [first] = g7;
  const profile = [[2, -12], [25, -12], [25, 16], [17, 24], [17, 48], [2, 48]];
  const left = extrudeInBend(k, 'g8', profile,
    { origin: [-92.79, 0, 0], normal: [1, 0, 0], x: [0, 1, 0] }, [4.790000000000006, 0, 0]);
  const history = structuredClone(first.operationHistory), bodies = join(first, left, 'g9');
  assert.equal(bodies.length, 1);
  // One 1036 mm² slab is bounded by the frozen F32 g7 face (thickness 4.790000915527344), the other by the
  // F32x2 g8 prism itself, whose thickness is exactly 4.790000000000006 (W2 polygon prism; before W2 both
  // slabs had the F32 thickness and the pin was 56948.083435058594, relative change -1.7e-8).
  near(bodies[0].validation.volumeMm3, 47023.20153808594 + 1036 * 4.790000915527344 + 1036 * 4.790000000000006);
  assert.equal(bodies[0].constructionBudget.ceilingMm, 0);
  // evidence/2: the input's earlier operation by reference (summary + transform chain), resolving to its full evidence.
  const [reference] = bodies.operationEvidence[0].inputs[0].history;
  assert.deepEqual([reference], history.map(({ evidence, transformChain }) => ({ evidence: { schema: 'wonky-operation-evidence/2',
    operationId: evidence.operationId, operation: evidence.operation, method: evidence.method, status: evidence.status }, transformChain })));
  assert.equal(historyEvidence({ operationEvidence: [...g7.operationEvidence, ...bodies.operationEvidence] }, reference), g7.operationEvidence[0]);
  assert.deepEqual(first.operationHistory, history);
  await checkProbes(bodies[0], 'g9');
  emit('g9-sequence', bodies);
});

test('rigid transforms preserve planar union metrics and historical provenance without enlarging budgets', async () => {
  const [body] = join(...inputs(), 'g7-before-move');
  const previous = structuredClone(body.operationHistory);
  const rows = [[0, -1, 0], [1, 0, 0], [0, 0, 1]], offset = [10, 20, 30];
  const moved = transformAnalytic(k, body, 'moved-union', rows, offset);
  near(moved.validation.volumeMm3, body.validation.volumeMm3);
  assert.deepEqual(moved.validation.boundsMm, { min: [-15, -73.30000305175781, 15], max: [10, 113.30000305175781, 78] });
  assert.deepEqual(moved.operationHistory[0].evidence, previous[0].evidence);
  assert.deepEqual(moved.operationHistory[0].transformChain, [{ operationId: 'moved-union', rows, offsetMm: offset }]);
  assert.equal(number(classificationInput(moved, k.faceClassifier).sourceBudget), 0);
  assert.throws(() => classificationInput(moved, k.faceClassifier, { inputTolerance: 1e-9 }), /cannot enlarge/);
  await checkProbes(moved, 'g7', p => [10 - p[1], 20 + p[0], 30 + p[2]]);
  emit('g7-moved', [moved]);
});

test('a nonzero source construction budget is rejected atomically and remains visible in evidence', () => {
  const [a, b] = inputs();
  a.constructionBudget = constructionBudget(real(0.0003));
  const revision = geometryRevision(a);
  assert.throws(() => join(a, b, 'budget-rejected'), error => {
    assert.equal(error.name, 'UnsupportedFeatureError');
    assert.equal(error.operationEvidence[0].status, 'Unresolved');
    assert.deepEqual(error.operationEvidence[0].inputBudgets[0], a.constructionBudget.nativeCeiling);
    assert.deepEqual(error.operationEvidence[0].sourceBudget, a.constructionBudget.nativeCeiling);
    assert.equal(number(error.operationEvidence[0].nativeSourceBudget), 0);
    assert.equal(error.operationEvidence[0].outputs, undefined);
    return true;
  });
  assert.equal(geometryRevision(a), revision);
});

test('unmodified FeatureScript Boolean syntax builds and exports a real touching-face union', async () => {
  const source = `FeatureScript 3044;
import(path:"onshape/std/geometry.fs",version:"3044.0");
export function main(context is Context,id is Id,definition is map) {
  for (var part in [["a",0],["b",2]]) {
    var sk = newSketchOnPlane(context,id+part[0]+"s",{"sketchPlane":plane(vector(0,0,part[1])*millimeter,vector(0,0,1))});
    skRectangle(sk,"rect",{"firstCorner":vector(0,0)*millimeter,"secondCorner":vector(2,2)*millimeter});
    skSolve(sk);
    opExtrude(context,id+part[0],{"entities":qSketchRegion(id+part[0]+"s"),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":2*millimeter});
  }
  opBoolean(context,id+"joined",{"tools":qUnion([qCreatedBy(id+"a",EntityType.BODY),qCreatedBy(id+"b",EntityType.BODY)]),"operationType":BooleanOperationType.UNION});
}`;
  const model = await build(source);
  assert.equal(model.bodies.length, 1);
  near(model.bodies[0].validation.volumeMm3, 16);
  assert.equal(model.operationEvidence.at(-1).operation, 'UNION');
  assert.equal(model.operationEvidence.at(-1).status, 'Bodies');
  emit('touching-feature-script', model.bodies);
});

}
