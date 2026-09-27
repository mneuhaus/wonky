import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("curved-seam-provenance.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { loadKernel, array, extrudeInBend } = await import("../src/kernel.mjs");
const { classificationInput } = await import("../src/face-classification.mjs");
const { intersectionTolerance } = await import("../src/intersections.mjs");
const { real, vector, number } = await import("../src/real.mjs");







const k = await loadKernel(), C = k.curved, S = k.solidIntersection;
const tolerance = intersectionTolerance();
const frame = { origin: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0] };
const prepare = body => classificationInput(body, k.faceClassifier);
const cylinder = () => prepare(k.analytic.frustum(vector([0, 0, 0]), vector([0, 0, 10]),
  vector([1, 0, 0]), real(5), real(5)));
const tool = (low, high) => prepare(extrudeInBend(k, 'seam-tool',
  [[-10, -10], [10, -10], [10, 10], [-10, 10]], { ...frame, origin: [0, 0, low] }, [0, 0, high - low]));
const faceRef = (operand, index) => ({ $: 'FaceRef', operand, index });
const flipFace = ref => ({ ...ref, operand: 1 - ref.operand });
const flipEdge = ref => ref.$ === 'OriginalEdge' ? { ...ref, operand: 1 - ref.operand }
  : ref.$ === 'SurfaceSeam' ? { ...ref, face: flipFace(ref.face) }
  : { ...ref, first: flipFace(ref.first), second: flipFace(ref.second) };

function checked(body, inputs, expectedVolume) {
  const audit = C.audit(body.solid, body.domains, tolerance, real(0));
  assert.equal(audit.valid, true);
  assert.ok(Math.abs(number(audit.volume) - expectedVolume) < 1e-8);
  const edges = array(body.solid.edges), faces = array(body.solid.faces);
  const faceOrigins = array(body.face_origins), origins = array(body.edge_origins);
  const uses = edges.map(() => []);
  faces.forEach((face, index) => array(face.loops).forEach(loop => array(loop.uses)
    .forEach(use => uses[use.edge].push({ face: index, forward: use.forward }))));
  for (const [index, origin] of origins.entries()) {
    assert.deepEqual(uses[index].map(use => use.forward).toSorted(), [false, true]);
    if (origin.$ === 'OriginalEdge') continue;
    assert.ok(['FaceIntersection', 'SurfaceSeam'].includes(origin.$));
    const carriers = origin.$ === 'SurfaceSeam' ? [origin.face] : [origin.first, origin.second];
    for (const ref of carriers) {
      const surface = array(inputs[ref.operand].solid.faces)[ref.index].surface;
      // Check the whole trimmed curve on each claimed original carrier.
      const residual = C['curved-validate.edge_carrier'](edges[index], index, surface,
        body.domains, body.solid.vertices);
      assert.ok(number(residual) <= number(audit.allowance),
        `${origin.$} edge ${index} misses operand ${ref.operand} face ${ref.index}`);
    }
    if (origin.$ === 'SurfaceSeam') {
      assert.equal(uses[index][0].face, uses[index][1].face);
      const face = uses[index][0].face;
      assert.equal(faces[face].surface.$, 'Cylinder');
      assert.deepEqual(origin.face, faceOrigins[face]);
    }
  }
  assert.equal(origins.filter(origin => origin.$ === 'SurfaceSeam').length, 1);
  return origins;
}

function intersect(inputs) {
  const [a, b] = inputs;
  const result = k.curvedIntersection.intersect(a.solid, a.domains, a.sourceBudget,
    b.solid, b.domains, b.sourceBudget, tolerance, { $: 'StrictTransverse' });
  assert.equal(result.$, 'Bodies');
  assert.equal(array(result.bodies).length, 1);
  return { result, body: array(result.bodies)[0] };
}

test('full cylindrical cuts create a surface seam and compose its face through repeated clipping', () => {
  const inputs = [cylinder(), tool(2, 8)];
  let body = S.initial(inputs[0].solid, inputs[0].domains, 0);
  for (const [height, direction, cutIndex, volume] of [[8, 1, 1, 200 * Math.PI], [2, -1, 0, 150 * Math.PI]]) {
    const result = C.clip(body.solid, body.domains, vector([0, 0, height]),
      vector([0, 0, direction]), tolerance, real(0));
    assert.equal(result.$, 'Clipped');
    const seam = array(result.edge_origins).find(origin => origin.$ === 'SurfaceSeam');
    assert.ok(seam, 'the local edge origin distinguishes a periodic seam from a cut');
    assert.equal(array(body.solid.faces)[seam.face].surface.$, 'Cylinder');
    const converted = S.converted_result(result, body, faceRef(1, cutIndex));
    assert.equal(converted.$, 'Bodies');
    body = array(converted.bodies)[0];
    const origins = checked(body, inputs, volume);
    assert.deepEqual(origins.find(origin => origin.$ === 'SurfaceSeam').face, faceRef(0, 2));
  }
  assert.equal(array(body.edge_origins).filter(origin => origin.$ === 'FaceIntersection').length, 2);
});

test('sequential cylinder cuts preserve seam ancestry and both intersection carriers in either operand order', () => {
  const inputs = [cylinder(), tool(2, 8)], runs = [];
  for (const operand of [0, 1]) {
    const pair = operand ? inputs.toReversed() : inputs, run = intersect(pair);
    const origins = checked(run.body, pair, 150 * Math.PI);
    assert.equal(origins.filter(origin => origin.$ === 'FaceIntersection').length, 2);
    const expected = { $: 'SurfaceSeam', face: faceRef(operand, 2) };
    assert.deepEqual(origins.find(origin => origin.$ === 'SurfaceSeam'), expected);
    const steps = array(run.result.steps);
    assert.equal(steps.length, 6);
    for (const step of steps.slice(1)) {
      assert.deepEqual(array(step.source_edges).find(origin => origin.$ === 'SurfaceSeam'), expected);
    }
    runs.push(run);
  }
  assert.deepEqual(runs[1].body.solid, runs[0].body.solid);
  assert.deepEqual(runs[1].body.domains, runs[0].body.domains);
  assert.deepEqual(array(runs[1].body.face_origins), array(runs[0].body.face_origins).map(flipFace));
  assert.deepEqual(array(runs[1].body.edge_origins), array(runs[0].body.edge_origins).map(flipEdge));
});

test('a later cylinder intersection maps new seams to the current input face', () => {
  const first = intersect([cylinder(), tool(2, 8)]).body;
  const source = { solid: first.solid, domains: first.domains, sourceBudget: real(0) };
  const inputs = [source, tool(3, 7)], { body } = intersect(inputs);
  const origins = checked(body, inputs, 100 * Math.PI);
  const cylinderFace = array(source.solid.faces).findIndex(face => face.surface.$ === 'Cylinder');
  assert.deepEqual(origins.find(origin => origin.$ === 'SurfaceSeam').face, faceRef(0, cylinderFace));
  assert.equal(origins.filter(origin => origin.$ === 'FaceIntersection').length, 2);
});

}
