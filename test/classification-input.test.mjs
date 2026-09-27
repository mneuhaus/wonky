import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("classification-input.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { loadKernel, extrudeInBend, array } = await import("../src/kernel.mjs");
const { circularFrustumInBend, encodeAnalytic } = await import("../src/analytic.mjs");
const { classificationInput, loadFaceClassifier, classifyPlanarFace } = await import("../src/face-classification.mjs");
const { classifySolid } = await import("../src/solid-classification.mjs");
const { classifyCylinderFace } = await import("../src/cylinder-classification.mjs");
const { intersectEdgePlane } = await import("../src/edge-plane.mjs");









const kernel = await loadKernel(), classifier = await loadFaceClassifier();
const plane = { origin: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0] };
const poly = extrudeInBend(kernel, 'input-box', [[0, 0], [8, 0], [8, 6], [0, 6]], plane, [0, 0, 4]);
const analytic = circularFrustumInBend(kernel, 'input-cylinder', { center: [0, 0], radius: 5, plane }, null, [0, 0, 10]);
const native = classificationInput(poly, classifier).solid;
const formats = [
  { name: 'implicit body', source: poly, edge: b => b.edges[0], face: b => b.faces[0], use: b => b.faces[0].loops[0][0] },
  { name: 'analytic body', source: analytic, edge: b => b.edges[0], face: b => b.faces[0], use: b => b.faces[0].loops[0][0] },
  { name: 'native solid', source: native, edge: b => b.edges.head, face: b => b.faces.head, use: b => b.faces.head.loops.head.uses.head },
];
const invalidBooleans = [undefined, null, 0, 1, 'false', { $: 'False' }];
const invalidIndices = [undefined, null, -1, .5, 2 ** 32, '0', NaN, Infinity];

test('valid implicit, analytic and native inputs preserve geometry, flags and classifications', async () => {
  const originalPoly = structuredClone(poly), originalAnalytic = structuredClone(analytic);
  const converted = classificationInput(poly, classifier).solid;
  assert.deepEqual(converted, native);
  assert.equal(classificationInput(native, classifier).solid, native, 'native Real words are passed through unchanged');
  assert.deepEqual(classificationInput(analytic, classifier).solid, encodeAnalytic(analytic));
  assert.equal(array(converted.faces).every(face => face.same_sense === true && face.loops.head.outer === true), true);
  assert.equal((await classifySolid(poly, [4, 3, 2])).$, 'Inside');
  assert.equal((await classifySolid(native, [4, 3, 2])).$, 'Inside');
  assert.equal((await classifyPlanarFace(analytic, 0, [0, 0, 0])).$, 'Inside');
  assert.equal((await classifyCylinderFace(analytic, 2, [5, 0, 5])).$, 'Inside');
  assert.equal((await intersectEdgePlane(analytic, 0, { type: 'plane', origin: [0, 0, 0], normal: [1, 0, 0] })).$, 'Resolved');
  assert.deepEqual(poly, originalPoly);
  assert.deepEqual(analytic, originalAnalytic);
});

test('a missing formerly-false coedge direction cannot become a successful solid classification', async () => {
  const body = structuredClone(poly);
  assert.equal(body.faces[0].loops[0][0].forward, false);
  delete body.faces[0].loops[0][0].forward;
  await assert.rejects(classifySolid(body, [4, 3, 2]), { name: 'TypeError', message: /forward must be a boolean/ });
});

for (const format of formats) {
  test(`${format.name} rejects missing or non-boolean coedge directions`, () => {
    const missing = structuredClone(format.source);
    delete format.use(missing).forward;
    assert.throws(() => classificationInput(missing, classifier), { name: 'TypeError', message: /forward must be a boolean/ });
    for (const value of invalidBooleans) {
      const body = structuredClone(format.source);
      format.use(body).forward = value;
      assert.throws(() => classificationInput(body, classifier), TypeError);
    }
  });
  test(`${format.name} rejects non-U32 vertex and coedge indices`, () => {
    for (const select of [b => [format.edge(b), 'start'], b => [format.edge(b), 'end'], b => [format.use(b), 'edge']]) {
      for (const value of invalidIndices) {
        const body = structuredClone(format.source), [entry, key] = select(body);
        entry[key] = value;
        assert.throws(() => classificationInput(body, classifier), RangeError);
      }
    }
  });
  test(`${format.name} keeps syntactically valid missing topology as InvalidIndex`, async () => {
    for (const select of [b => [format.edge(b), 'start'], b => [format.use(b), 'edge']]) {
      const body = structuredClone(format.source), [entry, key] = select(body);
      entry[key] = 100;
      const result = await classifyPlanarFace(body, 0, [4, 3, 0]);
      assert.equal(result.$, 'Unresolved');
      assert.equal(result.reason.$, 'InvalidIndex');
    }
  });
}

test('analytic and native sense and outer flags are required booleans, including false', () => {
  for (const format of formats.slice(1)) {
    const nativeForm = format.name === 'native solid', sense = nativeForm ? 'same_sense' : 'sameSense';
    const selections = [b => [format.edge(b), sense], b => [format.face(b), sense],
      b => nativeForm ? [format.face(b).loops.head, 'outer'] : [format.face(b).outer, 0]];
    for (const select of selections) {
      const missing = structuredClone(format.source), [entry, key] = select(missing);
      delete entry[key];
      assert.throws(() => classificationInput(missing, classifier), TypeError);
      for (const value of invalidBooleans) {
        const body = structuredClone(format.source), [entry, key] = select(body);
        entry[key] = value;
        assert.throws(() => classificationInput(body, classifier), TypeError);
      }
    }
    const body = structuredClone(format.source);
    format.edge(body)[sense] = false;
    format.face(body)[sense] = false;
    format.use(body).forward = false;
    if (nativeForm) format.face(body).loops.head.outer = false;
    else format.face(body).outer[0] = false;
    const output = classificationInput(body, classifier).solid;
    assert.equal(output.edges.head.same_sense, false);
    assert.equal(output.faces.head.same_sense, false);
    assert.equal(output.faces.head.loops.head.outer, false);
    assert.equal(output.faces.head.loops.head.uses.head.forward, false);
  }
});

test('implicit face defaults remain available, while supplied flags must be booleans', () => {
  const body = structuredClone(poly);
  body.faces[0].sameSense = null;
  body.faces[0].outer = null;
  const converted = classificationInput(body, classifier).solid;
  assert.equal(converted.faces.head.same_sense, true);
  assert.equal(converted.faces.head.loops.head.outer, true);
  for (const value of [0, 1, 'false', {}]) {
    const badSense = structuredClone(poly); badSense.faces[0].sameSense = value;
    assert.throws(() => classificationInput(badSense, classifier), TypeError);
    const badOuter = structuredClone(poly); badOuter.faces[0].outer = [value];
    assert.throws(() => classificationInput(badOuter, classifier), TypeError);
  }
  for (const source of [poly, analytic]) for (const outer of [[], [true, false], Array(1)]) {
    const body = structuredClone(source); body.faces[0].outer = outer;
    assert.throws(() => classificationInput(body, classifier), TypeError);
  }
});

test('malformed native lists, tags and inherited required fields fail before Bend dispatch', () => {
  const cycle = structuredClone(native); cycle.edges.tail = cycle.edges;
  assert.throws(() => classificationInput(cycle, classifier), /acyclic native list/);
  const missingTail = structuredClone(native); delete missingTail.faces.head.loops.tail;
  assert.throws(() => classificationInput(missingTail, classifier), TypeError);
  const badUse = structuredClone(native); badUse.faces.head.loops.head.uses.head.$ = 'Edge';
  assert.throws(() => classificationInput(badUse, classifier), TypeError);
  const inherited = structuredClone(poly), use = inherited.faces[0].loops[0][0];
  const inheritedDirection = use.forward; delete use.forward;
  Object.setPrototypeOf(use, { forward: inheritedDirection });
  assert.throws(() => classificationInput(inherited, classifier), TypeError);
});

test('every public classifier using classificationInput rejects malformed shared flags', async () => {
  const body = structuredClone(analytic); delete body.edges[0].sameSense;
  for (const operation of [
    () => classifyPlanarFace(body, 0, [0, 0, 0]),
    () => classifyCylinderFace(body, 2, [5, 0, 5]),
    () => classifySolid(body, [0, 0, 5]),
    () => intersectEdgePlane(body, 0, { type: 'plane', origin: [0, 0, 0], normal: [1, 0, 0] }),
  ]) await assert.rejects(operation, { name: 'TypeError', message: /sameSense must be a boolean/ });
});

}
