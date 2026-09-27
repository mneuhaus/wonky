import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend() || missing("fixtures/r10b/modules/base/ZtoDD.body.json", "fixtures/r10b/r10b.fs");
if (publicTreeSkip) {
  test("edge-plane.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { readFileSync } = await import("node:fs");
const { createHash } = await import("node:crypto");
const { loadKernel, array, extrudeInBend } = await import("../src/kernel.mjs");
const { real, number, vector, coords } = await import("../src/real.mjs");
const { importOnshapeBody, transformAnalytic } = await import("../src/analytic.mjs");
const { loadFaceClassifier, classificationInput, classifyPlanarFace } = await import("../src/face-classification.mjs");
const { intersectCurvePlane } = await import("../src/curve-plane.mjs");
const { intersectionTolerance } = await import("../src/intersections.mjs");
const { loadEdgePlane, intersectEdgePlane, requireResolvedEdgePlane } = await import("../src/edge-plane.mjs");
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
const near = (actual, expected, tolerance = 1e-10) => assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
  `${actual} != ${expected}, tolerance ${tolerance}`);
const nearVector = (actual, expected, tolerance) => actual.forEach((v, i) => near(v, expected[i], tolerance));

// Independent source construction and validation. None of these host formulas
// participates in production edge preparation or intersection.
function pointOn(curve, parameter) {
  if (curve.type === 'line') return add(curve.origin, scale(curve.direction, parameter));
  return add(curve.origin, add(scale(curve.x, (curve.radius ?? curve.major) * Math.cos(parameter)),
    scale(cross(curve.normal, curve.x), (curve.radius ?? curve.minor) * Math.sin(parameter))));
}
function finite(curve, first, last, sameSense = true, explicit = true) {
  const a = pointOn(curve, first), b = pointOn(curve, last);
  return { vertices: sameSense ? [a, b] : [b, a], edges: [{ start: 0, end: 1, sameSense, curve,
    ...(explicit ? { curveRange: [first, last] } : {}) }], faces: [] };
}
function full(curve = circle(), sameSense = true) {
  return { vertices: [pointOn(curve, 0)], edges: [{ start: 0, end: 0, sameSense, curve }], faces: [] };
}
const implicit = (start = [0, 0, 0], end = [2, 0, 0]) => ({ vertices: [start, end], edges: [{ start: 0, end: 1, curve: 'line' }], faces: [] });
function resolved(result, relation, count) {
  assert.equal(result.$, 'Resolved', JSON.stringify(result));
  assert.equal(result.relation.$, relation);
  const hits = array(result.hits);
  assert.equal(hits.length, count);
  assert.ok(number(result.linear_resolution) > 0 && Number.isFinite(number(result.linear_resolution)));
  assert.ok(number(result.source.endpoint_error) <= number(result.source.source_budget) + number(result.source.resolution));
  assert.deepEqual(hits.map(h => number(h.parameter)), hits.map(h => number(h.parameter)).sort((a, b) => a - b));
  return hits;
}
function unresolved(result, reason, nested) {
  assert.equal(result.$, 'Unresolved', JSON.stringify(result));
  assert.equal(result.reason.$, reason);
  if (nested) assert.equal(result.reason.reason.$, nested);
  assert.equal(result.hits, undefined);
}
function rejected(result, reason) {
  assert.equal(result.$, 'Rejected', JSON.stringify(result));
  assert.equal(result.reason.$, reason);
  assert.equal(result.hits, undefined);
}
function checkHits(curve, surface, hits, tolerance = 2e-10) {
  for (const hit of hits) {
    const point = coords(hit.point);
    nearVector(point, pointOn(curve, number(hit.parameter)), tolerance);
    near(dot(sub(point, surface.origin), unit(surface.normal)), 0, tolerance);
  }
}

test('implicit F32 segments are constructed in Bend and retain the native [0,1] parameter', async () => {
  const body = implicit([3, -2, 7], [11, 6, 7]);
  for (const [x, relation, count, location] of [[2, 'Disjoint', 0], [3, 'Crossing', 1, 'StartVertex'], [5, 'Crossing', 1, 'Interior'], [11, 'Crossing', 1, 'EndVertex'], [12, 'Disjoint', 0]]) {
    const result = await intersectEdgePlane(body, 0, plane([x, 0, 0], [1, 0, 0]));
    const hits = resolved(result, relation, count);
    near(number(result.source.domain.first), 0);
    near(number(result.source.domain.last), 1);
    nearVector(coords(result.source.edge.curve.direction), [8, 8, 0]);
    nearVector(coords(result.source.start), body.vertices[0]);
    nearVector(coords(result.source.end), body.vertices[1]);
    if (count) {
      near(number(hits[0].parameter), (x - 3) / 8);
      assert.equal(hits[0].location.$, location);
    }
  }
});

test('native line scaling, automatic ranges, explicit trims and sameSense retain source vertex identity', async () => {
  for (const sameSense of [true, false]) for (const explicit of [true, false]) {
    const curve = line([1, 3, 5], [4, 0, 0]), body = finite(curve, -2, 3, sameSense, explicit);
    for (const [parameter, nativeLocation] of [[-2, 'First'], [0, 'Interior'], [3, 'Last']]) {
      const surface = plane(pointOn(curve, parameter), [7, 0, 0]);
      const result = await intersectEdgePlane(body, 0, surface), [hit] = resolved(result, 'Crossing', 1);
      near(number(hit.parameter), parameter);
      assert.equal(result.source.edge.same_sense, sameSense);
      assert.equal(result.source.edge.start, 0);
      assert.equal(result.source.edge.end, 1);
      if (nativeLocation === 'Interior') assert.equal(hit.location.$, 'Interior');
      else {
        const isStart = (nativeLocation === 'First') === sameSense;
        assert.equal(hit.location.$, isStart ? 'StartVertex' : 'EndVertex');
        assert.equal(hit.location.index, isStart ? 0 : 1);
        nearVector(coords(hit.location.point), body.vertices[hit.location.index]);
      }
      checkHits(curve, surface, [hit]);
    }
    const wrong = structuredClone(body); wrong.edges[0].sameSense = !sameSense;
    unresolved(await intersectEdgePlane(wrong, 0, plane([1, 0, 0], [1, 0, 0])), 'InputGap');
  }
  const curve = line([0, 0, 0], [0.25, 0, 0]), body = finite(curve, 4, 8);
  const [hit] = resolved(await intersectEdgePlane(body, 0, plane([1.5, 0, 0], [1, 0, 0])), 'Crossing', 1);
  near(number(hit.parameter), 6);
});

test('full periodic edges retain one seam, native parameters, tangent multiplicity and source sense', async () => {
  for (const curve of [circle(), ellipse()]) for (const sense of [true, false]) {
    const body = full(curve, sense);
    const ordinary = await intersectEdgePlane(body, 0, plane([0, 0, 0], [1, 0, 0]));
    const hits = resolved(ordinary, 'Crossing', 2);
    assert.equal(ordinary.source.domain.$, 'Untrimmed');
    assert.equal(ordinary.source.edge.same_sense, sense);
    assert.ok(hits.every(h => h.location.$ === 'Interior'));
    const seam = resolved(await intersectEdgePlane(body, 0, plane([0, 0, 0], [0, 1, 0])), 'Crossing', 2);
    assert.equal(seam.filter(h => h.location.$ === 'SeamVertex').length, 1);
    assert.equal(seam[0].location.index, 0);
    near(number(seam[0].parameter), 0);
    near(number(seam[1].parameter), Math.PI);
    const [tangent] = resolved(await intersectEdgePlane(body, 0, plane([curve.radius ?? curve.major, 0, 0], [1, 0, 0])), 'Tangent', 1);
    assert.equal(tangent.multiplicity, 2);
    assert.equal(tangent.location.$, 'SeamVertex');
    resolved(await intersectEdgePlane(body, 0, plane([0, 0, 0], [0, 0, -3])), 'Coincident', 0);
    checkHits(curve, plane([0, 0, 0], [1, 0, 0]), hits);
  }
  const arbitrarySeam = full(); arbitrarySeam.vertices[0] = [0, 2, 0];
  resolved(await intersectEdgePlane(arbitrarySeam, 0, plane([0, 0, 0], [0, 1, 0])), 'Crossing', 2);
  unresolved(await intersectEdgePlane(arbitrarySeam, 0, plane([0, 0, 0], [1, 0, 0])), 'EndpointAmbiguity');
});

test('explicit arcs keep increasing unwrapped ranges and never infer a shorter arc', async () => {
  for (const curve of [circle(), ellipse(2, 1)]) for (const sense of [true, false]) {
    for (const [first, last, expected] of [[-2, 2, [-Math.PI / 3, Math.PI / 3]], [5, 8, [5 * Math.PI / 3, 7 * Math.PI / 3]], [2, 4, []]]) {
      const body = finite(curve, first, last, sense), surface = plane([1, 0, 0], [1, 0, 0]);
      const result = await intersectEdgePlane(body, 0, surface);
      const hits = resolved(result, expected.length ? 'Crossing' : 'Disjoint', expected.length);
      near(number(result.source.domain.first), first);
      near(number(result.source.domain.last), last);
      hits.forEach((hit, i) => near(number(hit.parameter), expected[i]));
      checkHits(curve, surface, hits);
    }
    const body = finite(curve, 0, 2, sense), result = await intersectEdgePlane(body, 0, plane([0, 0, 0], [0, 1, 0]));
    const [hit] = resolved(result, 'Crossing', 1);
    assert.equal(hit.location.$, sense ? 'StartVertex' : 'EndVertex');
    delete body.edges[0].curveRange;
    unresolved(await intersectEdgePlane(body, 0, plane([0, 0, 0], [0, 1, 0])), 'MissingTrim');
  }
});

test('source incidence allowance is retained without moving vertices or promoting coincidence', async () => {
  const body = finite(line(), 0, 2), gap = 0.0002;
  body.vertices[0] = [0, gap, 0];
  unresolved(await intersectEdgePlane(body, 0, plane([1, 0, 0], [1, 0, 0])), 'InputGap');
  body.vertexTolerancesMm = [0.0003, 0.0001];
  const result = await intersectEdgePlane(body, 0, plane([0, 0, 0], [1, 0, 0]));
  const [hit] = resolved(result, 'Crossing', 1);
  near(number(result.source.source_budget), 0.0003, 1e-16);
  near(number(result.source.endpoint_error), gap, 1e-16);
  nearVector(coords(hit.point), [0, 0, 0]);
  nearVector(coords(hit.location.point), [0, gap, 0]);
  near(number(hit.location.gap), gap, 1e-16);
  assert.deepEqual(body.vertices[0], [0, gap, 0]);
  unresolved(await intersectEdgePlane(body, 0, plane([0, 0, 0], [0, 1, 0])), 'EndpointAmbiguity');
  const nearCoincident = finite(line([0, 0, 1e-8]), 0, 2);
  nearCoincident.vertexTolerancesMm = [0.001, 0.001];
  unresolved(await intersectEdgePlane(nearCoincident, 0, plane([0, 0, 0], [0, 0, 1])), 'CurveUnresolved', 'NearCoincidence');
  // An unrelated source vertex allowance is intentionally included by the
  // shared body-wide policy, and is visible in the resulting source record.
  body.vertices.push([9, 9, 9]); body.vertexTolerancesMm.push(0.002);
  const enlarged = await intersectEdgePlane(body, 0, plane([1, 0, 0], [1, 0, 0]));
  resolved(enlarged, 'Crossing', 1);
  near(number(enlarged.source.source_budget), 0.002, 1e-16);
});

test('uncertain finite endpoints withhold all hits, including an otherwise clear second root', async () => {
  const body = finite(line(), 0, 2); body.vertexTolerancesMm = [0.001, 0.001];
  for (const offset of [-1e-6, 1e-6]) unresolved(await intersectEdgePlane(body, 0, plane([offset, 0, 0], [1, 0, 0])), 'EndpointAmbiguity');
  const arc = finite(circle(), Math.PI / 3, 6);
  unresolved(await intersectEdgePlane(arc, 0, plane([1, 0, 0], [1, 0, 0])), 'CurveUnresolved', 'TrimBoundary');
  const ring = full(); ring.vertexTolerancesMm = [0.001];
  unresolved(await intersectEdgePlane(ring, 0, plane([2 - 1e-6, 0, 0], [1, 1, 0])), 'EndpointAmbiguity');
});

test('finite separation resolves remote near-parallel supports without claiming near-coincidence', async () => {
  const curve = line([0, 0, 0], [1, 0, 1e-11]), body = finite(curve, 0, 10), surface = plane([0, 0, 1], [0, 0, 1]);
  unresolved(await intersectCurvePlane(curve, surface), 'NearParallel');
  resolved(await intersectEdgePlane(body, 0, surface), 'Disjoint', 0);
  const ring = full(), tiltedPlane = plane([0, 0, 1], [1e-11, 0, 1]);
  unresolved(await intersectCurvePlane(ring.edges[0].curve, tiltedPlane), 'NearParallel');
  resolved(await intersectEdgePlane(ring, 0, tiltedPlane), 'Disjoint', 0);
  unresolved(await intersectEdgePlane(body, 0, plane([0, 0, 0], [0, 0, 1])), 'CurveUnresolved', 'NearParallel');
});

test('independent randomized finite segment and arc references cover scaling, reversal and frames', async () => {
  let seed = 172894;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const randomVec = magnitude => Array.from({ length: 3 }, () => (random() - 0.5) * magnitude);
  for (let i = 0; i < 64; i++) {
    const direction = randomVec(8), curve = line(randomVec(200), direction), first = -2, last = 3;
    const desired = i % 3 === 0 ? 4 + random() : -1.5 + 4 * random();
    const surface = plane(pointOn(curve, desired), direction), body = finite(curve, first, last, i % 2 === 0, i % 2 === 1);
    const hits = resolved(await intersectEdgePlane(body, 0, surface), desired > last ? 'Disjoint' : 'Crossing', desired > last ? 0 : 1);
    if (hits.length) near(number(hits[0].parameter), desired, 2e-11);
    checkHits(curve, surface, hits, 4e-10);
    const normal = unit(randomVec(2)), x = unit(cross(normal, Math.abs(normal[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0]));
    const round = { ...ellipse(2 + random() * 4, 1 + random()), origin: randomVec(200), normal, x };
    const angle = 0.5 + random(), p = plane(add(round.origin, scale(x, round.major * Math.cos(angle))), x);
    const arc = finite(round, -2, 2, i % 2 === 0), roundHits = resolved(await intersectEdgePlane(arc, 0, p), 'Crossing', 2);
    near(number(roundHits[0].parameter), -angle, 2e-11);
    near(number(roundHits[1].parameter), angle, 2e-11);
    checkHits(round, p, roundHits, 4e-10);
  }
});

test('rounded-zero endpoint and coincidence impostors cannot acquire topological contacts', async () => {
  const e = 2 ** -40, n = [1, 1 + e, 0], body = finite(line(), 1, 2);
  const surface = plane([2 + 2 * e, -(1 + e), 0], n);
  // Exact n·([1,0,0]-origin) = e². Represent its polynomial independently
  // on the integer grid 2^-40; ordinary F32x2 rounds this residual to zero.
  const q = 1n << 40n, exact = q * (q - (2n * q + 2n)) + (q + 1n) * (q + 1n);
  assert.equal(exact, 1n);
  unresolved(await intersectEdgePlane(body, 0, surface), 'CurveUnresolved', 'TrimBoundary');
  const almost = [1 + 2 * e, -(1 + e), 0], coincident = finite(line(almost, [0, 0, 1]), 0, 2);
  unresolved(await intersectEdgePlane(coincident, 0, plane([0, 0, 0], n)), 'CurveUnresolved', 'NearCoincidence');
});

test('malformed domains, topology, geometry and budgets fail explicitly', async () => {
  const surface = plane([1, 0, 0], [1, 0, 0]);
  rejected(await intersectEdgePlane(implicit(), 3, surface), 'InvalidIndex');
  const missingVertex = implicit(); missingVertex.edges[0].end = 7;
  rejected(await intersectEdgePlane(missingVertex, 0, surface), 'InvalidIndex');
  const partial = finite(circle(), 0, 2);
  rejected(await intersectEdgePlane(partial, 0, surface, { domains: [{ $: 'Untrimmed' }] }), 'InvalidTopology');
  for (const domain of [[0, 7], [2, 1], [1, 1], [30, 31]]) rejected(await intersectEdgePlane(partial, 0, surface, { domains: [domain] }), 'InvalidTrim');
  const fullWithTrim = full(); fullWithTrim.edges[0].curveRange = [0, 2];
  rejected(await intersectEdgePlane(fullWithTrim, 0, surface), 'InvalidTopology');
  rejected(await intersectEdgePlane(finite(line(), 0, 2), 0, surface, { domains: [{ $: 'Untrimmed' }] }), 'InvalidTrim');
  for (const budget of [-1, 0.2]) rejected(await intersectEdgePlane(implicit(), 0, surface, { inputTolerance: budget }), 'InvalidSourceTolerance');
  const badSource = implicit(); badSource.vertexTolerancesMm = [0.01, -0.0001];
  rejected(await intersectEdgePlane(badSource, 0, surface), 'InvalidSourceTolerance');
  for (const options of [{ linear: 0 }, { linear: -1 }, { angular: 0 }, { angular: 0.2 }]) rejected(await intersectEdgePlane(implicit(), 0, surface, options), 'InvalidTolerance');
  unresolved(await intersectEdgePlane(implicit(), 0, surface, { angular: 1e-14 }), 'CurveUnresolved', 'AngularBudget');
  unresolved(await intersectEdgePlane(implicit([1e6, 0, 0], [1e6 + 2, 0, 0]), 0, surface), 'ResolutionLimit');
  rejected(await intersectEdgePlane(implicit(), 0, plane([0, 0, 0], [0, 0, 0])), 'InvalidGeometry');
  const invalidCurve = full(); invalidCurve.edges[0].curve.x = [2, 0, 0];
  rejected(await intersectEdgePlane(invalidCurve, 0, surface), 'InvalidGeometry');
  const E = await loadEdgePlane(), F = await loadFaceClassifier(), input = classificationInput(finite(line(), 0, 2), F);
  const malformed = structuredClone(input.solid); malformed.vertices.head.x = { $: 'Real', hi: 0, lo: 1 };
  rejected(E.intersect(malformed, 0, input.domains, vector(surface.origin), vector(surface.normal), intersectionTolerance(), real(0)), 'InvalidGeometry');
  const result = await intersectEdgePlane(implicit(), 0, surface);
  assert.equal(requireResolvedEdgePlane(result), result);
  assert.throws(() => requireResolvedEdgePlane({ $: 'Unresolved', reason: { $: 'EndpointAmbiguity' } }), UnsupportedFeatureError);
  assert.throws(() => requireResolvedEdgePlane({ $: 'Rejected', reason: { $: 'InvalidTrim' } }), UnsupportedFeatureError);
  await assert.rejects(intersectEdgePlane(implicit(), -1, surface), RangeError);
  await assert.rejects(intersectEdgePlane(implicit(), 0, { ...surface, type: 'cylinder' }), UnsupportedFeatureError);
});

test('native source words and shared source allowances survive the adapter unchanged', async () => {
  const F = await loadFaceClassifier(), body = finite(line([0.123456789, 0, 0], [0.234567891, 0, 0]), 1, 5);
  const input = classificationInput(body, F), native = input.solid;
  const result = await intersectEdgePlane(native, 0, { origin: vector([0.75, 0, 0]), normal: vector([1, 0, 0]) },
    { domains: body.edges.map(e => e.curveRange), inputTolerance: 0.0003 });
  resolved(result, 'Crossing', 1);
  assert.deepEqual(result.source.edge, array(native.edges)[0]);
  assert.deepEqual(result.source.start, array(native.vertices)[0]);
  assert.deepEqual(result.source.end, array(native.vertices)[1]);
  near(number(result.source.source_budget), 0.0003, 1e-16);
});

test('frozen transformed P10 and actual F32 box retain finite hits and expose unresolved source junctions', async () => {
  const file = new URL('../fixtures/r10b/modules/base/ZtoDD.body.json', import.meta.url), bytes = readFileSync(file);
  const hash = 'b78a8546970e360ee2a3a22661c87d4f9e835d24fe50cedeedde6a19add20dc9';
  assert.equal(createHash('sha256').update(bytes).digest('hex'), hash);
  const feature = readFileSync(new URL('../fixtures/r10b/r10b.fs', import.meta.url));
  assert.equal(createHash('sha256').update(feature).digest('hex'), '219ee9630f37f9e54fe7e1b4e09094ab25748a811ed8f9e8b9ebf4892d8b8349');
  const k = await loadKernel(), source = JSON.parse(bytes).bodies[0];
  const imported = importOnshapeBody(k, source, 'edge-plane-P10', { source: 'frozen finite-edge regression' });
  const body = transformAnalytic(k, imported, 'edge-plane-g0', [
    [1, 0, 0], [0, 0.9063077870366499, -0.42261826174069944], [0, 0.42261826174069944, 0.9063077870366499],
  ], [0, 85.7915071334, -183.980480768]);
  const box = extrudeInBend(k, 'edge-plane-box', [[-119, 4], [-92.79, 4], [-92.79, 46], [-119, 46]],
    { origin: [0, 0, -61], normal: [0, 0, 1], x: [1, 0, 0] }, [0, 0, 129]);
  assert.equal(box.faces[3].surface.origin[0], -92.79000000000002);
  assert.deepEqual([body.vertices.length, body.edges.length, body.faces.length], [348, 529, 189]);
  for (const [edge, face, boxFace, boxKind] of [[248, 9, 3, 'Inside'], [190, 9, 3, 'Inside'], [497, 4, 1, 'Boundary']]) {
    const result = await intersectEdgePlane(body, edge, box.faces[boxFace].surface);
    const [hit] = resolved(result, 'Crossing', 1);
    assert.equal(hit.location.$, 'Interior');
    assert.ok(number(result.source.source_budget) >= 0.0003);
    assert.equal((await classifyPlanarFace(body, face, hit.point)).$, 'Boundary');
    assert.equal((await classifyPlanarFace(box, boxFace, hit.point)).$, boxKind);
    checkHits(body.edges[edge].curve, box.faces[boxFace].surface, [hit], 1e-9);
  }
  unresolved(await intersectEdgePlane(body, 1, box.faces[2].surface), 'EndpointAmbiguity');
  unresolved(await intersectEdgePlane(body, 40, box.faces[2].surface), 'CurveUnresolved', 'NearCoincidence');
  unresolved(await intersectEdgePlane(body, 52, box.faces[2].surface), 'CurveUnresolved', 'NearParallel');
  // The corrected importer places ellipse seams on their cylinder generator.
  // Those genuine source vertices are not silently replaced by ellipse(t=0).
  const ellipseSeams = body.edges.flatMap((edge, index) => edge.curve.type === 'ellipse' && edge.start === edge.end ? [index] : []);
  assert.deepEqual(ellipseSeams, [309, 484]);
  for (const index of ellipseSeams) {
    const edge = body.edges[index], seam = body.vertices[edge.start];
    assert.ok(Math.hypot(...sub(seam, pointOn(edge.curve, 0))) > 1);
    const seamContact = await intersectEdgePlane(body, index, plane(seam, [1, 0, 0]));
    assert.equal(seamContact.$, 'Unresolved', JSON.stringify(seamContact));
    assert.equal(seamContact.hits, undefined);
  }
  // A real F32 box edge touching the clipping plane is a retained source vertex.
  const [corner] = resolved(await intersectEdgePlane(box, 0, box.faces[3].surface), 'Crossing', 1);
  assert.equal(corner.location.$, 'EndVertex');
  nearVector(coords(corner.location.point), box.vertices[box.edges[0].end]);
  assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), hash);
});

}
