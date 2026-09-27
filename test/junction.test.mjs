import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("junction.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { array } = await import("../src/kernel.mjs");
const { real, number, coords } = await import("../src/real.mjs");
const { intersectEdgePlane } = await import("../src/edge-plane.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");
const { loadJunction, junctionAnchor, junctionEvent, junctionPolicy, associateJunction, chooseJunctionAnchor, endpointJunctionProposal, requireAssociatedJunction } = await import("../src/junction.mjs");








const anchor = (point = [0, 0, 0], vertex = 0, sourceTolerance = 0) => ({ body: 0, vertex, point, sourceTolerance });
const vertex = (point, id = 1, sourceTolerance = 0) => ({ id, type: 'vertex', source: { body: 1, vertex: id, point, sourceTolerance } });
const line = (origin = [0, 0, 0], direction = [1, 0, 0]) => ({ type: 'line', origin, direction });
const circle = () => ({ type: 'circle', origin: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0], radius: 2 });
const plane = (origin = [0, 0, 0], normal = [0, 1, 0]) => ({ type: 'plane', origin, normal });
const sample = (parameter = 0, id = 1, edge = 2) => ({ id, type: 'curve-sample', body: 0, edge, curve: line(), interval: [-1, 1], parameter });
const projection = (seed, surface = plane(), id = 2, face = 3) => ({ id, type: 'plane-projection', body: 1, face, plane: surface, seed });
const hit = (curve = line(), surface = plane([0.25, 0, 0], [1, 0, 0]), id = 1) => ({ id, type: 'curve-plane-hit',
  body: 0, edge: 2, curve, interval: [-1, 1], planeBody: 1, face: 3, plane: surface, tolerance: { linear: 1e-7, angular: 1e-10 } });
const policy = { contactTolerance: 1e-7 };
const near = (actual, expected, tolerance = 1e-12) => assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
  `${actual} != ${expected}, tolerance ${tolerance}`);
const nearVector = (actual, expected, tolerance) => actual.forEach((value, index) => near(value, expected[index], tolerance));
function associated(result, mode) {
  assert.equal(result.$, 'Associated', JSON.stringify(result));
  if (mode) assert.equal(result.junction.mode.$, mode);
  return result.junction;
}
function issue(result, kind, reason) {
  assert.equal(result.$, kind, JSON.stringify(result));
  assert.equal(result.reason.$, reason);
  assert.equal(result.junction, undefined);
}

test('exact represented points preserve different entity IDs and support an explicit zero cap', async () => {
  const original = anchor([3, -2, 7], 17, 0.0003), event = vertex(original.point, 4, 0.0001);
  const junction = associated(await associateJunction(original, [event], { contactTolerance: 0 }), 'ExactRepresentedPoints');
  assert.equal(junction.anchor.vertex, 17);
  const [retained] = array(junction.events), [gap] = array(junction.gaps);
  assert.equal(retained.key, 4);
  assert.equal(retained.witness.source.body, 1);
  assert.equal(retained.witness.source.vertex, 4);
  assert.equal(gap.relation.$, 'SameRepresentedPoint');
  near(number(gap.distance), 0);
  near(number(junction.diameter), 0);
  near(number(junction.policy.contact_tolerance), 0);
  assert.equal(junction.representative, undefined);
});

test('source vertex, curve sample and plane foot retain their own words, allowances and actual gaps', async () => {
  const original = anchor([2, 4.00000000005, 7], 3, 0.0003);
  const curveEvent = { ...sample(4.000000000049), curve: line([2, 0, 7], [0, 1, 0]), interval: [0, 5], sourceTolerance: 0.0002 };
  const events = [curveEvent, projection(original, plane([0, 4, 0]))], before = structuredClone({ original, events });
  const junction = associated(await associateJunction(original, events, policy), 'ToleratedConnection');
  const [onCurve, foot] = array(junction.events), gaps = array(junction.gaps);
  assert.deepEqual(junction.anchor.point, junctionAnchor(original).point);
  assert.deepEqual(foot.witness.seed.point, junction.anchor.point);
  assert.notDeepEqual(onCurve.point, foot.point);
  assert.notDeepEqual(junction.anchor.point, foot.point);
  nearVector(coords(onCurve.point), [2, curveEvent.parameter, 7]);
  nearVector(coords(foot.point), [2, 4, 7]);
  near(number(onCurve.allowance), 0.0002, 1e-17);
  near(number(foot.allowance), 0.0003, 1e-17);
  assert.equal(gaps.length, 3);
  assert.ok(gaps.every(gap => gap.relation.$ === 'WithinTolerance'));
  near(number(foot.witness.displacement), Math.abs(original.point[1] - 4), 1e-13);
  near(number(junction.diameter), Math.max(...gaps.map(gap => number(gap.distance))));
  assert.equal(foot.witness.seed_incidence.certificate.$, 'NotCertified');
  assert.equal(foot.witness.point_incidence.certificate.$, 'ExactZero');
  assert.equal(array(junction.plane_checks)[0].incidence.certificate.$, 'NotCertified');
  assert.equal(onCurve.witness.$, 'CurveWitness');
  assert.equal(onCurve.witness.multiplicity, undefined);
  assert.deepEqual({ original, events }, before);
});

test('intersection events retain genuine solver parameters, root multiplicity and separate certificates', async () => {
  const crossing = associated(await associateJunction(anchor([0.25, 0, 0]), [hit()], policy));
  const root = array(crossing.events)[0];
  assert.equal(root.witness.$, 'IntersectionWitness');
  near(number(root.witness.parameter), 0.25);
  assert.equal(root.witness.multiplicity, 1);
  assert.equal(root.witness.position.$, 'Interior');
  assert.equal(root.witness.analytic_certificate.$, 'ExactZero');
  assert.equal(root.witness.point_incidence.certificate.$, 'ExactZero');
  const tangentSpec = { ...hit(circle(), plane([2, 0, 0], [1, 0, 0])), interval: null };
  const tangent = associated(await associateJunction(anchor([2, 0, 0]), [tangentSpec], policy));
  assert.equal(array(tangent.events)[0].witness.multiplicity, 2);
  near(number(array(tangent.events)[0].witness.parameter), 0);
  const noncanonical = { ...hit(circle(), plane([0, 0, 0], [1, 0, 0])), interval: null };
  const round = associated(await associateJunction(anchor([0, 2, 0]), [noncanonical], policy));
  near(number(array(round.events)[0].witness.parameter), Math.PI / 2);
  assert.equal(array(round.events)[0].witness.analytic_certificate.$, 'NotCertified');
});

test('source allowances cannot enlarge the explicit contact cap or create transitive tolerance chains', async () => {
  const separated = await associateJunction(anchor([0, 0, 0], 0, 0.05), [vertex([0.0002, 0, 0], 1, 0.05)], { contactTolerance: 0.0001 });
  assert.equal(separated.$, 'Separated');
  assert.equal(separated.witness.relation.$, 'OutsideTolerance');
  near(number(separated.witness.distance), 0.0002, 1e-16);
  near(number(separated.witness.tolerance), 0.0001, 1e-16);
  const chain = await associateJunction(anchor(), [vertex([-0.00006, 0, 0], 1), vertex([0.00006, 0, 0], 2)], { contactTolerance: 0.0001 });
  assert.equal(chain.$, 'Separated');
  assert.equal(chain.witness.first.$, 'EventKey');
  assert.equal(chain.witness.last.$, 'EventKey');
  near(number(chain.witness.distance), 0.00012, 1e-16);
});

test('the diameter cap has an explicit unresolved guard band and construction uncertainty has its own budget', async () => {
  const cap = { contactTolerance: 0.0001 };
  associated(await associateJunction(anchor(), [vertex([0.00009999, 0, 0])], cap), 'ToleratedConnection');
  const boundary = await associateJunction(anchor(), [vertex([0.0001, 0, 0])], cap);
  issue(boundary, 'Unresolved', 'Threshold');
  assert.equal(boundary.reason.witness.relation.$, 'ThresholdBand');
  near(number(boundary.reason.witness.distance), 0.0001, 1e-16);
  near(number(boundary.reason.witness.tolerance), 0.0001, 1e-16);
  assert.ok(number(boundary.reason.witness.resolution) > 0);
  assert.equal((await associateJunction(anchor(), [vertex([0.00010001, 0, 0])], cap)).$, 'Separated');
  issue(await associateJunction(anchor(), [sample()], { contactTolerance: 0 }), 'Unresolved', 'ConstructionBudget');
  issue(await associateJunction(anchor([1e9, 0, 0]), [{ ...sample(), curve: line([1e9, 0, 0]) }], policy), 'Unresolved', 'ConstructionBudget');
});

test('one edge cannot collapse distinct native parameters even at the same periodic point', async () => {
  issue(await associateJunction(anchor(), [sample(0, 1), sample(1e-9, 2)], policy), 'Unresolved', 'ParameterConflict');
  associated(await associateJunction(anchor(), [sample(0, 1), sample(0, 2)], policy));
  const c = { ...sample(), curve: circle(), interval: null };
  issue(await associateJunction(anchor([2, 0, 0]), [c, { ...c, id: 2, parameter: 2 * Math.PI }], policy), 'Unresolved', 'ParameterConflict');
});

test('duplicate event IDs and contradictory source, curve or plane descriptors are rejected', async () => {
  issue(await associateJunction(anchor(), [vertex([0, 0, 0]), vertex([0, 0, 0])], policy), 'Rejected', 'DuplicateEvent');
  issue(await associateJunction(anchor(), [{ id: 1, type: 'vertex', source: anchor([1e-9, 0, 0]) }], policy), 'Rejected', 'ConflictingReference');
  issue(await associateJunction(anchor(), [{ id: 1, type: 'vertex', source: anchor([0, 0, 0], 0, 0.001) }], policy), 'Rejected', 'ConflictingReference');
  issue(await associateJunction(anchor(), [sample(0, 1), { ...sample(0, 2), curve: line([0, 0, 0], [2, 0, 0]) }], policy), 'Rejected', 'ConflictingReference');
  issue(await associateJunction(anchor(), [sample(0, 1), { ...sample(0, 2), interval: [-2, 2] }], policy), 'Rejected', 'ConflictingReference');
  issue(await associateJunction(anchor(), [projection(anchor(), plane(), 1), projection(anchor(), plane([0, 1e-9, 0]), 2)], policy), 'Rejected', 'ConflictingReference');
});

test('anchor selection never substitutes nearest for unique and preserves uncertain competitors', async () => {
  const event = vertex([0, 0, 0]), cap = { contactTolerance: 0.0001 };
  const unique = await chooseJunctionAnchor([anchor([0, 0, 0], 1), anchor([0.01, 0, 0], 2)], [event], cap);
  assert.equal(unique.$, 'Unique'); assert.equal(unique.junction.anchor.vertex, 1);
  issue(await chooseJunctionAnchor([anchor([0, 0, 0], 1), anchor([0.00004, 0, 0], 2)], [event], cap), 'UnresolvedSelection', 'CompetingAnchors');
  issue(await chooseJunctionAnchor([anchor([0, 0, 0], 1), anchor([0.0001, 0, 0], 2)], [event], cap), 'UnresolvedSelection', 'IndeterminateAnchor');
  assert.equal((await chooseJunctionAnchor([anchor([0.01, 0, 0])], [event], cap)).$, 'NoneFound');
  issue(await chooseJunctionAnchor([anchor(), anchor()], [event], cap), 'RejectedSelection', 'DuplicateAnchor');
  issue(await chooseJunctionAnchor([], [event], cap), 'RejectedSelection', 'NoAnchors');
  issue(await chooseJunctionAnchor([anchor()], [], cap), 'RejectedSelection', 'NoEvents');
});

test('independent double references check projection, retained displacement, every gap and diameter', async () => {
  let state = 3791;
  const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (let i = 0; i < 24; i++) {
    const point = [random() * 400 - 200, random() * 400 - 200, random() * 400 - 200];
    const normal = [random() + 0.2, random() - 0.5, random() - 0.5];
    const norm = Math.hypot(...normal), unit = normal.map(v => v / norm), offset = 1e-5 * (0.2 + random());
    const origin = point.map((v, axis) => v - offset * unit[axis]);
    const original = anchor(point, i), eventPoint = point.map((v, axis) => v + 2e-6 * unit[axis]);
    const junction = associated(await associateJunction(original, [projection(original, plane(origin, normal)), vertex(eventPoint, 3)], { contactTolerance: 0.0001 }));
    const events = array(junction.events), points = [coords(junction.anchor.point), ...events.map(event => coords(event.point))];
    const signed = point.reduce((sum, value, axis) => sum + (value - origin[axis]) * unit[axis], 0);
    nearVector(coords(events[0].point), point.map((v, axis) => v - signed * unit[axis]), 2e-11);
    near(number(events[0].witness.displacement), Math.abs(signed), 2e-11);
    const expected = [Math.hypot(...points[1].map((v, a) => v - points[0][a])),
      Math.hypot(...points[2].map((v, a) => v - points[0][a])), Math.hypot(...points[2].map((v, a) => v - points[1][a]))];
    array(junction.gaps).forEach((gap, j) => near(number(gap.distance), expected[j], 2e-11));
    near(number(junction.diameter), Math.max(...expected), 2e-11);
  }
});

test('a rounded-zero dot product and unavailable exponent range never become exact plane certificates', async () => {
  const e = 2 ** -40, scale = 1n << 40n;
  // Exact dyadic numerator of n dot p is -1, despite rounded F32x2 zero.
  assert.equal((scale + 2n) * scale - (scale + 1n) ** 2n, -1n);
  const original = anchor([1 + 2 * e, -(1 + e), 0]);
  const junction = associated(await associateJunction(original, [projection(original, plane([0, 0, 0], [1, 1 + e, 0]))], policy));
  const witness = array(junction.events)[0].witness;
  near(number(witness.seed_incidence.signed_distance), 0, 1e-30);
  assert.equal(witness.seed_incidence.certificate.$, 'NotCertified');
  assert.equal(array(junction.plane_checks)[0].incidence.certificate.$, 'NotCertified');
  assert.equal(witness.point_incidence.certificate.$, 'NotCertified');
  const tiny = anchor([0, 1, 0]);
  const exponent = associated(await associateJunction(tiny, [projection(tiny, plane([0, 0, 0], [1e-12, 1e-40, 0]))], policy));
  assert.equal(array(exponent.events)[0].witness.seed_incidence.certificate.$, 'NotCertified');
});

test('unresolved or empty curve intersections cannot be replaced by samples or partial junctions', async () => {
  for (const [curve, surface, reason] of [
    [line([0, 1e-8, 0]), plane(), 'NearCoincidence'],
    [line([0, 0, 0], [1, 1e-12, 0]), plane(), 'NearParallel'],
  ]) {
    const result = await associateJunction(anchor(), [vertex([0, 0, 0], 2), hit(curve, surface)], policy);
    issue(result, 'Unresolved', 'CurveUnresolved'); assert.equal(result.reason.reason.$, reason);
  }
  issue(await associateJunction(anchor(), [hit(line(), plane())], policy), 'Rejected', 'MissingIntersectionHit');
  issue(await associateJunction(anchor(), [{ ...hit(), hit: 1 }], policy), 'Rejected', 'MissingIntersectionHit');
  issue(await associateJunction(anchor(), [hit(line([0, 1, 0]), plane())], policy), 'Rejected', 'MissingIntersectionHit');
  const invalidTolerance = await associateJunction(anchor(), [{ ...hit(), tolerance: { linear: 0 } }], policy);
  issue(invalidTolerance, 'Rejected', 'CurveRejected'); assert.equal(invalidTolerance.reason.reason.$, 'InvalidTolerance');
});

test('invalid geometry, ranges, budgets and parameters fail closed at the Bend entrypoint', async () => {
  for (const value of [-1, 0.2]) issue(await associateJunction(anchor(), [vertex([0, 0, 0])], { contactTolerance: value }), 'Rejected', 'InvalidPolicy');
  issue(await associateJunction(anchor([1e11, 0, 0]), [vertex([0, 0, 0])], policy), 'Rejected', 'InvalidSource');
  issue(await associateJunction(anchor([0, 0, 0], 0, -1), [vertex([0, 0, 0])], policy), 'Rejected', 'InvalidSource');
  issue(await associateJunction(anchor(), [{ ...sample(), sourceTolerance: -1 }], policy), 'Rejected', 'InvalidAllowance');
  issue(await associateJunction(anchor(), [{ ...sample(), curve: line([0, 0, 0], [0, 0, 0]) }], policy), 'Rejected', 'InvalidCurve');
  issue(await associateJunction(anchor(), [{ ...sample(), curve: { ...circle(), normal: [0, 0, 2] } }], policy), 'Rejected', 'InvalidCurve');
  issue(await associateJunction(anchor(), [{ ...sample(), interval: [1, -1] }], policy), 'Rejected', 'InvalidCurve');
  issue(await associateJunction(anchor(), [{ ...sample(), parameter: 2 }], policy), 'Rejected', 'OutsideDomain');
  issue(await associateJunction(anchor(), [{ ...sample(), parameter: 1e11 }], policy), 'Rejected', 'InvalidParameter');
  issue(await associateJunction(anchor(), [projection(anchor(), plane([0, 0, 0], [0, 0, 0]))], policy), 'Rejected', 'InvalidPlane');
  issue(await associateJunction(anchor(), [{ ...sample(1e10), interval: null, curve: line([1e10, 0, 0]) }], policy), 'Rejected', 'OutputRange');
  issue(await associateJunction(anchor(), [], policy), 'Rejected', 'NoEvents');
  const malformed = junctionAnchor(anchor()); malformed.point.x = { $: 'Real', hi: 1, lo: 1 };
  issue(await associateJunction(malformed, [vertex([0, 0, 0])], policy), 'Rejected', 'InvalidSource');
});

test('serialization preserves native words, requires explicit policy and rejects coercible IDs', async () => {
  const native = junctionAnchor(anchor([2 ** -40, 0, 0]));
  assert.equal(junctionAnchor(native), native);
  const nativeEvent = junctionEvent({ id: 1, type: 'vertex', source: native });
  assert.equal(junctionEvent(nativeEvent), nativeEvent);
  const nativePolicy = junctionPolicy({ contactTolerance: real(1e-7) });
  assert.equal(junctionPolicy(nativePolicy), nativePolicy);
  assert.throws(() => junctionPolicy(), /explicit/);
  await assert.rejects(associateJunction(anchor(), [vertex([0, 0, 0])]), /explicit/);
  for (const value of [-1, 0.5, 2 ** 32, '1']) {
    assert.throws(() => junctionAnchor({ ...anchor(), body: value }), RangeError);
    assert.throws(() => junctionAnchor({ ...native, vertex: value }), RangeError);
    assert.throws(() => junctionEvent({ ...sample(), id: value }), RangeError);
    assert.throws(() => junctionEvent({ ...nativeEvent, key: value }), RangeError);
  }
  assert.throws(() => junctionEvent({ ...sample(), type: 'approximate-root' }), UnsupportedFeatureError);
  assert.throws(() => requireAssociatedJunction({ $: 'Unresolved', reason: { $: 'Threshold' } }), UnsupportedFeatureError);
  const result = await associateJunction(native, [nativeEvent], { contactTolerance: 0 });
  assert.equal(requireAssociatedJunction(result), result.junction);
  assert.deepEqual(result.junction.anchor.point, native.point);
});

test('native endpoint proposals respect edge sense and retain a noncanonical periodic seam', async () => {
  for (const sameSense of [true, false]) {
    const vertices = sameSense ? [[-4, 0, 0], [6, 0, 0]] : [[6, 0, 0], [-4, 0, 0]];
    const body = { vertices, edges: [{ start: 0, end: 1, sameSense, curve: line([0, 0, 0], [2, 0, 0]), curveRange: [-2, 3] }], faces: [] };
    const result = await intersectEdgePlane(body, 0, plane());
    assert.equal(result.$, 'Resolved');
    for (const atStart of [true, false]) {
      const proposed = await endpointJunctionProposal(result.source, 5, { body: 6, face: 7, plane: plane() }, { atStart, sampleId: 11, projectionId: 12 });
      const specs = array(proposed.specs);
      near(number(specs[0].parameter), atStart === sameSense ? -2 : 3);
      nearVector(coords(proposed.anchor.point), vertices[atStart ? 0 : 1]);
      assert.equal(proposed.anchor.vertex, atStart ? 0 : 1);
      assert.equal(proposed.anchor.body, 5);
      associated(await associateJunction(proposed.anchor, specs, policy));
    }
  }
  const round = { vertices: [[0, 2, 0]], edges: [{ start: 0, end: 0, sameSense: true, curve: circle() }], faces: [] };
  const result = await intersectEdgePlane(round, 0, plane([0, 0, 1], [0, 0, 1]));
  assert.equal(result.$, 'Resolved');
  const proposed = await endpointJunctionProposal(result.source, 5, { body: 6, face: 7, plane: plane([0, 2, 0]) }, { atStart: true, sampleId: 11, projectionId: 12 });
  near(number(array(proposed.specs)[0].parameter), Math.PI / 2);
  assert.deepEqual(coords(proposed.anchor.point), [0, 2, 0]);
  associated(await associateJunction(proposed.anchor, array(proposed.specs), policy));
  await assert.rejects(endpointJunctionProposal(result.source, 5, { body: 6, face: 7, plane: plane() }, { atStart: 1, sampleId: 11, projectionId: 12 }), TypeError);
  const kernel = await loadJunction();
  assert.equal(kernel.source_point(proposed.anchor).$, 'V3');
});

}
