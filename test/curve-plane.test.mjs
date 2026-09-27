import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("curve-plane.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { loadKernel, array } = await import("../src/kernel.mjs");
const { real, number, vector, coords } = await import("../src/real.mjs");
const { intersectionTolerance } = await import("../src/intersections.mjs");
const { loadCurvePlane, curvePlaneCurve, curvePlaneDomain, intersectCurvePlane, requireResolvedCurvePlane } = await import("../src/curve-plane.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");








const plane = (origin, normal) => ({ type: 'plane', origin, normal });
const line = (origin = [0, 0, 0], direction = [1, 0, 0]) => ({ type: 'line', origin, direction });
const circle = (radius = 2) => ({ type: 'circle', origin: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0], radius });
const ellipse = (major = 3, minor = 2) => ({ type: 'ellipse', origin: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0], major, minor });
const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const scale = (a, factor) => a.map(v => v * factor);
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = a => scale(a, 1 / Math.hypot(...a));
const tau = 2 * Math.PI;
const canonical = t => (t % tau + tau) % tau;
const near = (actual, expected, tolerance = 1e-10) => assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
  `${actual} != ${expected}, tolerance ${tolerance}`);
const nearVector = (actual, expected, tolerance) => actual.forEach((v, i) => near(v, expected[i], tolerance));
const resolved = (result, relation, count) => {
  assert.equal(result.$, 'Resolved', JSON.stringify(result));
  assert.equal(result.relation.$, relation);
  const hits = array(result.hits);
  assert.equal(hits.length, count);
  assert.ok(number(result.linear_resolution) > 0 && Number.isFinite(number(result.linear_resolution)));
  assert.ok(number(result.parameter_resolution) >= 0 && Number.isFinite(number(result.parameter_resolution)));
  assert.deepEqual(hits.map(h => number(h.parameter)), hits.map(h => number(h.parameter)).sort((a, b) => a - b));
  return hits;
};
const unresolved = (result, reason) => {
  assert.equal(result.$, 'Unresolved', JSON.stringify(result));
  assert.equal(result.reason.$, reason);
  assert.equal(result.hits, undefined);
};
const rejected = (result, reason) => {
  assert.equal(result.$, 'Rejected', JSON.stringify(result));
  assert.equal(result.reason.$, reason);
  assert.equal(result.hits, undefined);
};

// These references use ordinary doubles, independent of Bend's root solver,
// curve evaluation, and residual functions. Production geometry stays in Bend.
function curvePoint(curve, parameter) {
  if (curve.type === 'line') return add(curve.origin, scale(curve.direction, parameter));
  const major = curve.type === 'circle' ? curve.radius : curve.major;
  const minor = curve.type === 'circle' ? curve.radius : curve.minor;
  return add(curve.origin, add(scale(curve.x, major * Math.cos(parameter)), scale(cross(curve.normal, curve.x), minor * Math.sin(parameter))));
}
function checkHits(curve, surface, hits, tolerance = 2e-10) {
  for (const hit of hits) {
    const point = coords(hit.point), parameter = number(hit.parameter);
    nearVector(point, curvePoint(curve, parameter), tolerance);
    near(dot(sub(point, surface.origin), unit(surface.normal)), 0, tolerance);
    assert.ok(hit.multiplicity === 1 || hit.multiplicity === 2);
  }
}
function referenceRound(curve, surface) {
  const n = unit(surface.normal), major = curve.type === 'circle' ? curve.radius : curve.major;
  const minor = curve.type === 'circle' ? curve.radius : curve.minor;
  const a = major * dot(n, curve.x), b = minor * dot(n, cross(curve.normal, curve.x));
  const c = dot(n, sub(curve.origin, surface.origin)), amplitude = Math.hypot(a, b);
  if (Math.abs(c) > amplitude) return [];
  const phase = Math.atan2(b, a), delta = Math.acos(-c / amplitude);
  return [canonical(phase - delta), canonical(phase + delta)].sort((u, v) => u - v);
}

test('lines preserve native parameter scaling, reversal and original-coordinate parallel certificates', async () => {
  for (const direction of [[0, 0, 2], [0, 0, -4], [3, -5, 2], [0.003, -0.005, 0.002]]) {
    const curve = line([3, 4, 5], direction);
    for (const sign of [-1, 1]) {
      const surface = plane([1, -7, 9], [0, 0, sign * 7]);
      const hits = resolved(await intersectCurvePlane(curve, surface), 'Crossing', 1);
      near(number(hits[0].parameter), 4 / direction[2], 2e-11);
      assert.equal(hits[0].multiplicity, 1);
      assert.equal(hits[0].position.$, 'Interior');
      checkHits(curve, surface, hits);
    }
  }
  const curve = line([2, 3, 4], [4, -3, 0]);
  resolved(await intersectCurvePlane(curve, plane([2, 3, 4], [3, 4, 0])), 'Coincident', 0);
  resolved(await intersectCurvePlane(curve, plane([5, 7, 4], [-6, -8, 0])), 'Disjoint', 0);
});

test('circles and ellipses return zero, two, or one double root without losing their analytic parameterization', async () => {
  for (const curve of [circle(), ellipse()]) {
    const radius = curve.radius ?? curve.major;
    for (const offset of [-radius - 1, -radius, -radius / 2, 0, radius / 2, radius, radius + 1]) {
      for (const sign of [-1, 1]) {
        const surface = plane([offset, 0, 0], [sign * 3, 0, 0]);
        const count = Math.abs(offset) > radius ? 0 : Math.abs(offset) === radius ? 1 : 2;
        const relation = count === 0 ? 'Disjoint' : count === 1 ? 'Tangent' : 'Crossing';
        const hits = resolved(await intersectCurvePlane(curve, surface), relation, count);
        checkHits(curve, surface, hits);
        for (const hit of hits) {
          assert.equal(hit.multiplicity, count === 1 ? 2 : 1);
          assert.ok(number(hit.parameter) >= 0 && number(hit.parameter) < tau);
        }
      }
    }
    resolved(await intersectCurvePlane(curve, plane([6, -2, 0], [0, 0, -7])), 'Coincident', 0);
    resolved(await intersectCurvePlane(curve, plane([6, -2, 4], [0, 0, -7])), 'Disjoint', 0);
    const hits = resolved(await intersectCurvePlane(curve, plane([0, 0, 0], [0, 1, 0])), 'Crossing', 2);
    near(number(hits[0].parameter), 0, 1e-13);
    near(number(hits[1].parameter), Math.PI, 1e-13);
  }
});

test('translated and rotated analytic frames and reversed normals agree with independent residuals', async () => {
  const curves = [
    { ...circle(4.1), origin: [-17.4, 28, 47], normal: [1, 0, 0], x: [0, Math.cos(0.4363323129985824), Math.sin(0.4363323129985824)] },
    { ...ellipse(7.3, 1.7), origin: [143.5, -8.7, 221.4], normal: unit([2, 3, 7]), x: unit([3, -2, 0]) },
  ];
  for (const curve of curves) {
    for (const axisSign of [-1, 1]) for (const normalSign of [-1, 1]) {
      const input = { ...curve, normal: scale(curve.normal, axisSign) };
      const surface = plane(add(curve.origin, [0.25, -0.5, 0.4]), scale([1, 2, -1], normalSign));
      const expected = referenceRound(input, surface);
      const hits = resolved(await intersectCurvePlane(input, surface), 'Crossing', 2);
      hits.forEach((hit, index) => near(number(hit.parameter), expected[index], 2e-11));
      checkHits(input, surface, hits);
    }
  }
});

test('deterministic random line and round-curve roots agree with independent analytic references', async () => {
  let seed = 812763;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const randomVec = magnitude => Array.from({ length: 3 }, () => (random() - 0.5) * magnitude);
  for (let i = 0; i < 64; i++) {
    const normal = unit(randomVec(2)), x = unit(cross(normal, Math.abs(normal[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0]));
    const curve = { ...(i % 2 ? circle(0.5 + random() * 12) : ellipse(3 + random() * 10, 0.5 + random() * 2)), origin: randomVec(1000), normal, x };
    const n = unit(add(x, scale(normal, random() * 2))), major = curve.radius ?? curve.major;
    const surface = plane(add(curve.origin, scale(n, (random() * 1.6 - 0.8) * major * dot(n, x))), n);
    const expected = referenceRound(curve, surface);
    const hits = resolved(await intersectCurvePlane(curve, surface), 'Crossing', 2);
    hits.forEach((hit, index) => near(number(hit.parameter), expected[index], 3e-11));
    checkHits(curve, surface, hits, 5e-10);
    const lineCurve = line(randomVec(1000), add(n, scale(normal, 0.2)));
    const reference = dot(n, sub(surface.origin, lineCurve.origin)) / dot(n, lineCurve.direction);
    const lineHits = resolved(await intersectCurvePlane(lineCurve, surface), 'Crossing', 1);
    near(number(lineHits[0].parameter), reference, 3e-10);
    checkHits(lineCurve, surface, lineHits, 5e-10);
  }
});

test('increasing closed intervals preserve unwrapped arcs and count the periodic seam once', async () => {
  const curve = circle(), surface = plane([1, 0, 0], [1, 0, 0]);
  const cases = [
    [[0, 2], [Math.PI / 3]], [[2, 4], []], [[4, 6], [5 * Math.PI / 3]],
    [[-2, 2], [-Math.PI / 3, Math.PI / 3]], [[5, 8], [5 * Math.PI / 3, 7 * Math.PI / 3]],
    [[-6, -4], [-5 * Math.PI / 3]], [[-20, -15], [-19 * Math.PI / 3, -17 * Math.PI / 3]],
  ];
  for (const [interval, expected] of cases) {
    const hits = resolved(await intersectCurvePlane(curve, surface, { interval }), expected.length ? 'Crossing' : 'Disjoint', expected.length);
    hits.forEach((hit, index) => near(number(hit.parameter), expected[index], 1e-12));
    checkHits(curve, surface, hits);
  }
  const seam = plane([0, 0, 0], [0, 1, 0]);
  const first = resolved(await intersectCurvePlane(curve, seam, { interval: [0, 2] }), 'Crossing', 1)[0];
  assert.equal(first.position.$, 'FirstEndpoint');
  assert.equal(number(first.parameter), 0);
  const last = resolved(await intersectCurvePlane(curve, seam, { interval: [-2, 0] }), 'Crossing', 1)[0];
  assert.equal(last.position.$, 'LastEndpoint');
  assert.equal(number(last.parameter), 0);
  const tangent = resolved(await intersectCurvePlane(curve, plane([2, 0, 0], [1, 0, 0]), { interval: [0, 1] }), 'Tangent', 1)[0];
  assert.equal(tangent.multiplicity, 2);
  assert.equal(tangent.position.$, 'FirstEndpoint');
});

test('line endpoints require exact incidence and uncertain trim boundaries remain unresolved', async () => {
  const curve = line([3, 4, 5], [2, 0, 0]), surface = plane([5, 0, 0], [3, 0, 0]);
  for (const [interval, position] of [[[1, 3], 'FirstEndpoint'], [[-2, 1], 'LastEndpoint']]) {
    const [hit] = resolved(await intersectCurvePlane(curve, surface, { interval }), 'Crossing', 1);
    assert.equal(number(hit.parameter), 1);
    assert.equal(hit.position.$, position);
    checkHits(curve, surface, [hit]);
  }
  resolved(await intersectCurvePlane(curve, surface, { interval: [2, 3] }), 'Disjoint', 0);
  for (const side of [-1, 1]) {
    unresolved(await intersectCurvePlane(curve, surface, { interval: [1 + side * 1e-14, 3] }), 'TrimBoundary');
    unresolved(await intersectCurvePlane(circle(), plane([1, 0, 0], [1, 0, 0]), { interval: [Math.PI / 3 + side * 1e-14, 2] }), 'TrimBoundary');
  }
  // Nonzero-angle endpoints have no transcendental exact-incidence certificate.
  unresolved(await intersectCurvePlane(circle(), plane([0, 0, 0], [1, 0, 0]), { interval: [Math.PI / 2, 3] }), 'TrimBoundary');
});

test('public parameter classification distinguishes equality, uncertainty, lifting and invalid domains', async () => {
  const C = await loadCurvePlane();
  const classify = (value, interval, periodic = false, resolution = 1e-10) => C.classify_parameter(real(value), curvePlaneDomain(interval), periodic, real(resolution));
  for (const [value, expected] of [[1, 'AtFirst'], [3, 'AtLast'], [2, 'Inside'], [4, 'Outside'], [1 - 1e-12, 'NearFirst'], [3 + 1e-12, 'NearLast']]) {
    assert.equal(classify(value, [1, 3]).$, expected);
  }
  near(number(classify(-0.5, undefined, true).parameter), tau - 0.5, 1e-13);
  near(number(classify(0.5, [6, 8], true).parameter), tau + 0.5, 1e-13);
  near(number(classify(tau - 0.5, [-1, 1], true).parameter), -0.5, 1e-13);
  assert.equal(classify(0, [2, 1]).$, 'InvalidDomain');
  assert.equal(classify(0, [0, 7], true).$, 'InvalidDomain');
  assert.equal(classify(100, undefined, true).$, 'InvalidDomain');
  assert.equal(classify(0, [0, 1], false, -1).$, 'InvalidDomain');
  assert.equal(C.curve_periodic(curvePlaneCurve(circle())), true);
  assert.equal(C.curve_periodic(curvePlaneCurve(line())), false);
  assert.equal(C.curve_valid(curvePlaneCurve(ellipse())), true);
});

test('near parallelism, coincidence, tangency and insufficient budgets stay explicit', async () => {
  unresolved(await intersectCurvePlane(line([0, 0, 0], [1, 0, 1e-11]), plane([0, 0, 1], [0, 0, 1])), 'NearParallel');
  unresolved(await intersectCurvePlane(line(), plane([0, 0, 1e-8], [0, 0, 1])), 'NearCoincidence');
  unresolved(await intersectCurvePlane(circle(), plane([0, 0, 1e-8], [0, 0, 1])), 'NearCoincidence');
  unresolved(await intersectCurvePlane(circle(), plane([0, 0, 1], [1e-11, 0, 1])), 'NearParallel');
  for (const side of [-1, 1]) unresolved(await intersectCurvePlane(circle(), plane([2 + side * 1e-8, 0, 0], [1, 0, 0])), 'NearTangency');
  unresolved(await intersectCurvePlane(circle(), plane([1, 0, 0], [1, 0, 0]), { angular: 1e-14 }), 'AngularBudget');
  unresolved(await intersectCurvePlane({ ...circle(), origin: [1e6, 0, 0] }, plane([1e6, 0, 0], [1, 0, 0]), { linear: 1e-8 }), 'LinearBudget');
  unresolved(await intersectCurvePlane(circle(1e-8), plane([0, 0, 0], [1, 0, 0])), 'RadiusBelowTolerance');
  unresolved(await intersectCurvePlane(ellipse(2, 1e-8), plane([0, 0, 0], [1, 0, 0])), 'RadiusBelowTolerance');
  unresolved(await intersectCurvePlane(line([0, 0, 0], [1, 0, 1e-8]), plane([0, 0, 1], [0, 0, 1])), 'LinearBudget');
});

// Independent exact polynomial oracle: F32 words are integer multiples of
// 2^-149, so all represented input bits survive in BigInt arithmetic.
const bits = new DataView(new ArrayBuffer(4)), q = 1n << 149n;
function integerFloat(value) {
  bits.setFloat32(0, value, false);
  const word = bits.getUint32(0, false), exponent = (word >>> 23) & 255;
  assert.notEqual(exponent, 255);
  const magnitude = exponent ? BigInt(0x800000 | (word & 0x7fffff)) << BigInt(exponent - 1) : BigInt(word & 0x7fffff);
  return word >>> 31 ? -magnitude : magnitude;
}
const integerReal = r => integerFloat(r.hi) + integerFloat(r.lo);
const integerVector = v => [v.x, v.y, v.z].map(integerReal);
const integerDot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0n);
function exactRoundDiscriminant(curve, surface) {
  const c = curvePlaneCurve(curve), n = integerVector(vector(surface.normal));
  const x = integerVector(c.x), normal = integerVector(c.normal);
  const co = integerVector(c.origin), po = integerVector(vector(surface.origin));
  const major = integerReal(c.radius ?? c.major), minor = integerReal(c.radius ?? c.minor);
  // Bring radius*n.x, radius*n.(normal cross x), and n.(co-po) to q^-4.
  const a = major * integerDot(n, x) * q, b = minor * integerDot(n, cross(normal, x));
  const d = integerDot(n, sub(co, po)) * q * q;
  return a * a + b * b - d * d;
}

test('BigInt oracles reject rounded-zero parallel, coincident, tangent and endpoint impostors', async () => {
  const C = await loadCurvePlane(), { precise: P } = await loadKernel();
  const e = 2 ** -40, n = [1, 1 + e, 0], direction = [1 + 2 * e, -(1 + e), 0];
  const nv = vector(n), dv = vector(direction);
  assert.equal(number(P.dot(nv, dv)), 0, 'must exercise a rounded-zero dot product');
  assert.notEqual(integerDot(integerVector(nv), integerVector(dv)), 0n);
  unresolved(await intersectCurvePlane(line([0, 0, 0], direction), plane([0, 0, 0], n)), 'NearParallel');
  unresolved(await intersectCurvePlane(line(direction, [0, 0, 1]), plane([0, 0, 0], n)), 'NearCoincidence');
  const tangentCurve = circle(1), tangentPlane = plane([1, 0, 0], [1, e, 0]);
  assert.notEqual(exactRoundDiscriminant(tangentCurve, tangentPlane), 0n);
  assert.equal(C.tangent_certificate(C.exact_coefficients(curvePlaneCurve(tangentCurve), vector(tangentPlane.origin), vector(tangentPlane.normal))), false);
  unresolved(await intersectCurvePlane(tangentCurve, tangentPlane), 'NearTangency');
  const endpointPlane = plane([2 + 2 * e, -(1 + e), 0], n), parameter = real(1);
  const difference = sub(integerVector(vector([1, 0, 0])), integerVector(vector(endpointPlane.origin)));
  assert.notEqual(integerDot(integerVector(nv), difference), 0n);
  assert.equal(C.endpoint_certificate(curvePlaneCurve(line()), vector(endpointPlane.origin), nv, parameter), false);
  unresolved(await intersectCurvePlane(line(), endpointPlane, { interval: [1, 2] }), 'TrimBoundary');
});

test('exact round certificates agree with the integer oracle and fail closed for unsafe exponents', async () => {
  const C = await loadCurvePlane();
  for (let radius = 1; radius <= 16; radius++) {
    const curve = { ...ellipse(radius, radius + 1), origin: [13, -7, 5] };
    for (const offset of [-radius - 1, -radius, 0, radius, radius + 1]) {
      const surface = plane([13 + offset, -7, 5], [3, 0, 4]);
      const exact = C.exact_coefficients(curvePlaneCurve(curve), vector(surface.origin), vector(surface.normal));
      assert.equal(C.tangent_certificate(exact), exactRoundDiscriminant(curve, surface) === 0n);
    }
  }
  const curve = circle(1), surface = plane([1, 0, 0], [1e-12, 1e-40, 0]);
  const exact = C.exact_coefficients(curvePlaneCurve(curve), vector(surface.origin), vector(surface.normal));
  assert.equal(C.tangent_certificate(exact), false);
  unresolved(await intersectCurvePlane(curve, surface), 'NearTangency');
});

test('invalid geometry, frames, radii, domains, tolerances and output ranges reject explicitly', async () => {
  const C = await loadCurvePlane(), surface = plane([0, 0, 0], [1, 0, 0]);
  for (const radius of [0, -1]) rejected(await intersectCurvePlane(circle(radius), surface), 'InvalidRadius');
  rejected(await intersectCurvePlane(ellipse(2, 0), surface), 'InvalidRadius');
  for (const normal of [[0, 0, 0], [0, 0, 1e-13]]) rejected(await intersectCurvePlane(circle(), { ...surface, normal }), 'InvalidDirection');
  rejected(await intersectCurvePlane(line([0, 0, 0], [0, 0, 0]), surface), 'InvalidDirection');
  for (const change of [{ normal: [0, 0, 2] }, { x: [2, 0, 0] }, { x: [1, 0, 1] }]) {
    rejected(await intersectCurvePlane({ ...circle(), ...change }, surface), 'InvalidFrame');
  }
  for (const interval of [[1, 1], [2, 1], [0, 7], [30, 31], [-30, -29]]) rejected(await intersectCurvePlane(circle(), surface, { interval }), 'InvalidInterval');
  rejected(await intersectCurvePlane(circle(), surface, { interval: { $: 'Interval', first: real(0), last: C.tau() } }), 'InvalidInterval');
  for (const options of [{ linear: 0 }, { linear: -1 }, { angular: 0 }, { angular: 0.2 }]) rejected(await intersectCurvePlane(circle(), surface, options), 'InvalidTolerance');
  rejected(await intersectCurvePlane({ ...circle(), origin: [1e11, 0, 0] }, surface), 'InvalidGeometry');
  rejected(await intersectCurvePlane(line([0, 0, 0], [0.001, 0, 0]), plane([1e10, 0, 0], [1, 0, 0]), { linear: 1 }), 'OutputRange');
  rejected(await intersectCurvePlane(line([1e10, 0, 0], [1, 0, 1]), plane([0, 0, 1e10], [0, 0, 1]), { linear: 1 }), 'OutputRange');
  for (const bad of [{ $: 'Real', hi: NaN, lo: 0 }, { $: 'Real', hi: Infinity, lo: 0 }, { $: 'Real', hi: 0, lo: 1 }]) {
    const curve = curvePlaneCurve(circle());
    curve.origin.x = bad;
    rejected(C.intersect(curve, vector(surface.origin), vector(surface.normal), curvePlaneDomain(), intersectionTolerance()), 'InvalidGeometry');
  }
  const result = await intersectCurvePlane(circle(), surface);
  assert.equal(requireResolvedCurvePlane(result), result);
  assert.throws(() => requireResolvedCurvePlane({ $: 'Unresolved', reason: { $: 'TrimBoundary' } }), UnsupportedFeatureError);
  assert.throws(() => requireResolvedCurvePlane({ $: 'Rejected', reason: { $: 'InvalidFrame' } }), UnsupportedFeatureError);
  assert.throws(() => curvePlaneDomain([0]), TypeError);
  await assert.rejects(intersectCurvePlane({ type: 'spline', origin: [0, 0, 0] }, surface), UnsupportedFeatureError);
  await assert.rejects(intersectCurvePlane(circle(), { ...surface, type: 'cylinder' }), UnsupportedFeatureError);
  await assert.rejects(intersectCurvePlane({ ...circle(), origin: [Infinity, 0, 0] }, surface), RangeError);
});

}
