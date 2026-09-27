import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("intersections.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { loadKernel, array } = await import("../src/kernel.mjs");
const { real, number, vector, coords } = await import("../src/real.mjs");
const { loadIntersections, intersectionSurface, intersectionTolerance, intersectSurfaces, requireResolvedIntersection } = await import("../src/intersections.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");







const plane = (origin, normal) => ({ type: 'plane', origin, normal });
const cylinder = (origin, axis, radius) => ({ type: 'cylinder', origin, axis, radius });
const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const scale = (a, b) => a.map(v => v * b);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => Math.hypot(...a);
const unit = a => scale(a, 1 / norm(a));
const near = (actual, expected, tolerance = 1e-10) => assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
  `${actual} != ${expected}, tolerance ${tolerance}`);
const nearVector = (actual, expected, tolerance) => actual.forEach((v, i) => near(v, expected[i], tolerance));
const relation = (result, expected, count) => {
  assert.equal(result.$, 'Resolved', JSON.stringify(result));
  assert.equal(result.relation.$, expected);
  assert.equal(array(result.curves).length, count);
  assert.ok(number(result.linear_resolution) > 0 && Number.isFinite(number(result.linear_resolution)));
  assert.ok(number(result.angular_resolution) > 0);
  return array(result.curves);
};
const unresolved = (result, reason) => {
  assert.equal(result.$, 'Unresolved', JSON.stringify(result));
  if (reason) assert.equal(result.reason.$, reason);
  assert.equal(result.curves, undefined);
};
const rejected = (result, reason) => {
  assert.equal(result.$, 'Rejected', JSON.stringify(result));
  assert.equal(result.reason.$, reason);
  assert.equal(result.curves, undefined);
};

// Independent double-precision reference: no Bend residuals participate in
// these incidence checks. Curve points do come from the actual Bend curve API.
function residual(surface, point) {
  const delta = sub(point, surface.origin);
  if (surface.type === 'plane') return Math.abs(dot(delta, unit(surface.normal)));
  const axis = unit(surface.axis);
  return Math.abs(norm(sub(delta, scale(axis, dot(delta, axis)))) - surface.radius);
}
function checkCurves(A, curves, surfaces, tolerance = 2e-10) {
  for (const curve of curves) {
    if (curve.$ === 'Line') near(norm(coords(curve.direction)), 1, 2e-13);
    else {
      near(norm(coords(curve.normal)), 1, 2e-13);
      near(norm(coords(curve.x)), 1, 2e-13);
      near(dot(coords(curve.normal), coords(curve.x)), 0, 2e-13);
    }
    const parameters = curve.$ === 'Line' ? [-100, -7, 0, 0.125, 23, 150] : Array.from({ length: 37 }, (_, i) => 2 * Math.PI * i / 36);
    for (const t of parameters) {
      const p = coords(A.curve_point(curve, real(t)));
      assert.ok(p.every(Number.isFinite));
      for (const surface of surfaces) assert.ok(residual(surface, p) <= tolerance,
        `${curve.$} misses ${surface.type}: ${residual(surface, p)}, point ${p}`);
    }
  }
}

test('supporting plane intersections classify crossing, coincident, parallel, and reversed normals in Bend', async () => {
  const { analytic: A } = await loadKernel();
  const cases = [
    [plane([2, 3, 4], [0, 0, 2]), plane([-1, 8, 9], [3, 0, 0])],
    [plane([12.5, -80, 32], [1, 2, 3]), plane([-7, 20, 9], [-2, 4, 1])],
    [plane([1e5, -2e5, 3e5], [3, 0, 4]), plane([1e5 + 3, -2e5 + 7, 3e5 - 8], [4, 2, -3])],
  ];
  for (const surfaces of cases) {
    for (const sign of [1, -1]) {
      const pair = [surfaces[0], { ...surfaces[1], normal: scale(surfaces[1].normal, sign) }];
      const result = await intersectSurfaces(...pair, { linear: 1e-6 });
      const [curve] = relation(result, 'CrossingPlanes', 1);
      checkCurves(A, [curve], pair, 5e-9);
      near(Math.abs(dot(coords(curve.direction), unit(cross(pair[0].normal, pair[1].normal)))), 1, 2e-13);
      const swapped = relation(await intersectSurfaces(pair[1], pair[0], { linear: 1e-6 }), 'CrossingPlanes', 1)[0];
      near(norm(cross(sub(coords(swapped.origin), coords(curve.origin)), coords(curve.direction))), 0, 2e-8);
    }
  }
  relation(await intersectSurfaces(plane([10, 2, -3], [3, 0, 4]), plane([14, 9, -6], [-6, 0, -8])), 'CoincidentPlanes', 0);
  relation(await intersectSurfaces(plane([10, 2, -3], [3, 0, 4]), plane([13, 2, 1], [-6, 0, -8])), 'ParallelPlanes', 0);
});

test('plane/cylinder circles and ellipses retain analytic geometry in translated and rotated frames', async () => {
  const { analytic: A } = await loadKernel();
  const circles = [
    [plane([0, 0, 7], [0, 0, -3]), cylinder([2, -4, 1], [0, 0, 2], 2.2)],
    [plane([13, -7, 9], [-6, 0, -8]), cylinder([10, -8, -2], [3, 0, 4], 4.5)],
    [plane([1e6 + 0.002, -2e6, 3e6], [1, 0, 0]), cylinder([1e6, -2e6, 3e6], [3, 0, 0], 0.001)],
  ];
  for (const surfaces of circles) {
    const [curve] = relation(await intersectSurfaces(...surfaces, { linear: 1e-5 }), 'CircleSection', 1);
    const [p, c] = surfaces, axis = unit(c.axis);
    const expected = add(c.origin, scale(axis, dot(p.normal, sub(p.origin, c.origin)) / dot(p.normal, axis)));
    nearVector(coords(curve.origin), expected, 2e-8);
    near(number(curve.radius), c.radius, 1e-13);
    checkCurves(A, [curve], surfaces, 3e-8);
  }
  const surfaces = [plane([4, -9, 2], [1, 2, 4]), cylinder([12, -3, -8], [3, 0, 4], 2.5)];
  for (const planeSign of [1, -1]) for (const axisSign of [1, -1]) {
    const pair = [{ ...surfaces[0], normal: scale(surfaces[0].normal, planeSign) }, { ...surfaces[1], axis: scale(surfaces[1].axis, axisSign) }];
    const [curve] = relation(await intersectSurfaces(...pair), 'EllipseSection', 1);
    near(number(curve.major), pair[1].radius / Math.abs(dot(unit(pair[0].normal), unit(pair[1].axis))), 2e-12);
    near(number(curve.minor), pair[1].radius, 2e-13);
    checkCurves(A, [curve], pair);
    const reversed = relation(await intersectSurfaces(pair[1], pair[0]), 'EllipseSection', 1);
    checkCurves(A, reversed, pair);
  }
});

test('axis-parallel planes yield two generators, an exact tangent, or a separated empty section', async () => {
  const { analytic: A } = await loadKernel();
  const co = [12.5, -30, 4], axis = [4, 0, -3], normal = [3, 0, 4], radius = 2.5;
  for (const distance of [-4, -2.5, -1.25, 0, 1.25, 2.5, 4]) {
    const origin = add(co, scale(normal, distance / 5));
    for (const normalSign of [1, -1]) for (const axisSign of [1, -1]) {
      const pair = [plane(origin, scale(normal, normalSign)), cylinder(co, scale(axis, axisSign), radius)];
      const expected = Math.abs(distance) > radius ? ['EmptySection', 0] : Math.abs(distance) === radius ? ['TangentGenerator', 1] : ['TwoGenerators', 2];
      const curves = relation(await intersectSurfaces(...pair), ...expected);
      checkCurves(A, curves, pair);
      if (curves.length === 2) near(norm(sub(coords(curves[0].origin), coords(curves[1].origin))), 2 * Math.sqrt(radius ** 2 - distance ** 2), 2e-12);
    }
  }
  for (const offset of [-1e-4, 1e-4]) {
    const pair = [plane([2 + offset, 0, 0], [1, 0, 0]), cylinder([0, 0, 0], [0, 0, 1], 2)];
    const curves = relation(await intersectSurfaces(...pair), offset < 0 ? 'TwoGenerators' : 'EmptySection', offset < 0 ? 2 : 0);
    checkCurves(A, curves, pair);
  }
});

test('independent random analytic references cover oblique sections and crossing planes', async () => {
  const { analytic: A } = await loadKernel();
  let seed = 954182;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const randomVec = magnitude => Array.from({ length: 3 }, () => (random() - 0.5) * magnitude);
  let covered = 0;
  while (covered < 80) {
    const n = randomVec(2), a = randomVec(2), cosine = Math.abs(dot(unit(n), unit(a)));
    if (cosine < 0.15 || cosine > 0.95) continue;
    const translation = randomVec(10000), po = add(translation, randomVec(40)), co = add(translation, randomVec(40));
    const radius = 0.25 + random() * 10;
    const surfaces = [plane(po, n), cylinder(co, a, radius)];
    const [ellipse] = relation(await intersectSurfaces(...surfaces, { linear: 1e-6 }), 'EllipseSection', 1);
    near(number(ellipse.major), radius / cosine, 1e-11);
    const axis = unit(a), center = add(co, scale(axis, dot(n, sub(po, co)) / dot(n, axis)));
    nearVector(coords(ellipse.origin), center, 1e-9);
    checkCurves(A, [ellipse], surfaces, 2e-9);
    const planes = [surfaces[0], plane(co, a)];
    const lines = relation(await intersectSurfaces(...planes, { linear: 1e-6 }), 'CrossingPlanes', 1);
    checkCurves(A, lines, planes, 2e-9);
    covered++;
  }
});

test('near degeneracies stay unresolved rather than being snapped to disjoint, coincident, or tangent', async () => {
  const c = cylinder([0, 0, 0], [0, 0, 1], 2);
  unresolved(await intersectSurfaces(plane([0, 0, 0], [0, 0, 1]), plane([0, 0, 1], [1e-11, 0, 1])), 'NearParallelPlanes');
  unresolved(await intersectSurfaces(plane([0, 0, 0], [0, 0, 1]), plane([0, 0, 1e-8], [0, 0, -1])), 'NearCoincidentPlanes');
  unresolved(await intersectSurfaces(plane([4, 0, 0], [1, 0, 1e-11]), c), 'NearAxisParallelPlane');
  unresolved(await intersectSurfaces(plane([0, 0, 0], [1e-11, 0, 1]), c), 'NearCircleSection');
  for (const side of [-1, 1]) unresolved(await intersectSurfaces(plane([2 + side * 1e-8, 0, 0], [1, 0, 0]), c), 'NearTangency');
  // The oblique plane intersects the unbounded cylinder far from its origin.
  // A near-parallel direction is never evidence of an empty intersection.
  unresolved(await intersectSurfaces(plane([4, 0, 0], [1, 0, 1e-8]), c), 'LinearBudget');
  unresolved(await intersectSurfaces(plane([1e6, 0, 0], [1, 0, 0]), c, { linear: 1e-8 }), 'LinearBudget');
  unresolved(await intersectSurfaces(plane([0, 0, 0], [0, 0, 1]), c, { angular: 1e-14 }), 'AngularBudget');
  unresolved(await intersectSurfaces(plane([0, 0, 0], [0, 0, 1]), cylinder([0, 0, 0], [0, 0, 1], 1e-8)), 'RadiusBelowTolerance');
});

// Exact independent oracle for the represented F32 words. Each float is an
// integer multiple of 2^-149; BigInt can retain every bit of the polynomial.
const bitsBuffer = new ArrayBuffer(4), bitsView = new DataView(bitsBuffer);
function floatInteger(value) {
  bitsView.setFloat32(0, value, false);
  const bits = bitsView.getUint32(0, false), exponent = (bits >>> 23) & 255;
  const fraction = bits & 0x7fffff;
  assert.notEqual(exponent, 255);
  const magnitude = exponent ? BigInt(0x800000 | fraction) << BigInt(exponent - 1) : BigInt(fraction);
  return bits >>> 31 ? -magnitude : magnitude;
}
const realInteger = value => floatInteger(value.hi) + floatInteger(value.lo);
const vecIntegers = value => [value.x, value.y, value.z].map(realInteger);
const dotInteger = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0n);
const crossInteger = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

test('exact-zero certificates distinguish rounded zero determinants with an independent BigInt oracle', async () => {
  const I = await loadIntersections();
  const { precise: P, real: R } = await loadKernel();
  const e = 2 ** -40;
  const n = vector([1, 1 + e, 0]), almostParallel = vector([1 + e, 1 + 2 * e, 0]);
  assert.ok(coords(P.cross(n, almostParallel)).every(value => value === 0), 'regression must exercise a rounded zero');
  assert.ok(crossInteger(vecIntegers(n), vecIntegers(almostParallel)).some(value => value !== 0n));
  assert.equal(I.parallel_certificate(true, n, almostParallel), false);
  const almostPerpendicular = vector([1 + 2 * e, -(1 + e), 0]);
  assert.equal(number(P.dot(n, almostPerpendicular)), 0);
  assert.notEqual(dotInteger(vecIntegers(n), vecIntegers(almostPerpendicular)), 0n);
  assert.equal(I.perpendicular_certificate(true, n, almostPerpendicular), false);
  const exact = I.exact_dot(n, almostPerpendicular);
  assert.equal(exact.safe, true);
  assert.equal(I.expansion_zero(exact), false);
  const zero = vector([0, 0, 0]), tolerance = intersectionTolerance();
  unresolved(I.plane_plane(zero, n, zero, almostParallel, tolerance), 'NearParallelPlanes');
  unresolved(I.plane_cylinder(zero, n, zero, almostParallel, real(2), tolerance), 'NearCircleSection');
  unresolved(I.plane_cylinder(vector([5, 0, 0]), n, zero, almostPerpendicular, real(2), tolerance), 'NearAxisParallelPlane');
  unresolved(I.plane_plane(zero, n, almostPerpendicular, n, tolerance), 'NearCoincidentPlanes');
  // sqrt(1 + e^2) rounds to 1 in F32x2, although the plane is not tangent.
  const tangentNormal = vector([1, e, 0]), tangentPoint = vector([1, 0, 0]);
  assert.equal(number(R.sqrt(P.dot(tangentNormal, tangentNormal))), 1);
  const ni = vecIntegers(tangentNormal), pi = vecIntegers(tangentPoint), ri = realInteger(real(1));
  const signed = dotInteger(ni, pi);
  assert.notEqual(signed * signed - ri * ri * dotInteger(ni, ni), 0n);
  assert.equal(I.tangency_certificate(true, tangentNormal, tangentPoint, zero, real(1)), false);
  unresolved(I.plane_cylinder(tangentPoint, tangentNormal, zero, vector([0, 0, 1]), real(1), tolerance), 'NearTangency');
});

test('zero certificates agree with exact integer predicates and fail closed outside their exponent range', async () => {
  const I = await loadIntersections();
  for (let i = 1; i <= 60; i++) {
    const a = vector([i, 2 * i - 3, i + 7]), b = vector([2 * i - 3, -i, 0]);
    const parallel = vector([2 * i, 4 * i - 6, 2 * i + 14]);
    assert.equal(I.parallel_certificate(true, a, parallel), crossInteger(vecIntegers(a), vecIntegers(parallel)).every(v => v === 0n));
    assert.equal(I.perpendicular_certificate(true, a, b), dotInteger(vecIntegers(a), vecIntegers(b)) === 0n);
    assert.equal(I.expansion_zero(I.exact_dot(a, b)), dotInteger(vecIntegers(a), vecIntegers(b)) === 0n);
  }
  const tiny = vector([1e-12, 0, 0]), tilted = vector([1e-12, 1e-40, 0]), zero = vector([0, 0, 0]);
  assert.equal(I.parallel_certificate(true, tiny, tilted), false);
  unresolved(I.plane_plane(zero, tiny, zero, tilted, intersectionTolerance()), 'NearParallelPlanes');
  const unsafe = I.exact_product(real(1e-30), real(1e-30));
  assert.equal(unsafe.safe, false);
  assert.equal(I.expansion_zero(unsafe), false);
  const overflow = I.exact_product(real(1e20), real(1e20));
  assert.equal(overflow.safe, false);
  assert.equal(I.expansion_zero(overflow), false);
});

test('invalid geometry, unsupported pairs, and generated range limits are explicit', async () => {
  const I = await loadIntersections();
  const p = plane([0, 0, 0], [0, 0, 1]), c = cylinder([0, 0, 0], [0, 0, 1], 2);
  for (const radius of [0, -2]) rejected(await intersectSurfaces(p, { ...c, radius }), 'InvalidRadius');
  for (const normal of [[0, 0, 0], [0, 0, 1e-13]]) rejected(await intersectSurfaces({ ...p, normal }, c), 'InvalidDirection');
  for (const tolerance of [{ linear: 0 }, { linear: -1 }, { angular: 0 }, { angular: 0.2 }]) rejected(await intersectSurfaces(p, c, tolerance), 'InvalidTolerance');
  rejected(await intersectSurfaces({ ...p, origin: [1e11, 0, 0] }, c), 'InvalidGeometry');
  rejected(await intersectSurfaces(c, c), 'UnsupportedSurfacePair');
  rejected(await intersectSurfaces(p, { type: 'cone', origin: [0, 0, 0], axis: [0, 0, 1], radius: 2, angle: 0.2 }), 'UnsupportedSurfacePair');
  rejected(await intersectSurfaces(p, plane([0, 0, 1e10], [0.001, 0, 1]), { linear: 1 }), 'OutputRange');
  rejected(await intersectSurfaces(plane([1e10, 0, 1e10], [1, 0, 1]), cylinder([1e10, 0, 0], [1, 0, 1], 2), { linear: 0.01 }), 'OutputRange');
  rejected(await intersectSurfaces(plane([0, 0, 0], [1, 0, 0.01]), { ...c, radius: 1e10 }, { linear: 0.01 }), 'OutputRange');
  for (const bad of [{ $: 'Real', hi: NaN, lo: 0 }, { $: 'Real', hi: Infinity, lo: 0 }, { $: 'Real', hi: 0, lo: 1 }]) {
    const input = intersectionSurface(p);
    input.origin.x = bad;
    rejected(I.intersect(input, intersectionSurface(c), intersectionTolerance()), 'InvalidGeometry');
  }
  const result = await intersectSurfaces(p, c);
  assert.equal(requireResolvedIntersection(result), result);
  assert.throws(() => requireResolvedIntersection({ $: 'Unresolved', reason: { $: 'NearTangency' } }), UnsupportedFeatureError);
  assert.throws(() => requireResolvedIntersection({ $: 'Rejected', reason: { $: 'UnsupportedSurfacePair' } }), UnsupportedFeatureError);
  await assert.rejects(intersectSurfaces({ ...p, origin: [Infinity, 0, 0] }, c), RangeError);
});

}
