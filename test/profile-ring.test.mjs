import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend() || missing("fixtures/r10b/r10b.fs");
if (publicTreeSkip) {
  test("profile-ring.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { readFileSync } = await import("node:fs");
const { loadBend } = await import("../src/bend-loader.mjs");
const { list, array } = await import("../src/kernel.mjs");
const { number, vector } = await import("../src/real.mjs");
const { classifyCorner, PROFILE_VERTEX_LIMIT, tolerance, validateFaceLoop, validatePolygon, validateSolid } = await import("../src/brep.mjs");
const { build } = await import("../src/index.mjs");
const { ModelingContext } = await import("../src/library.mjs");
// W2 K2 + K6 (docs/corpus/w2-plan.md, task C): the Bend profile ring
// simplification (kernel/profile-ring.bend) and the host profile / face-loop
// admission of src/brep.mjs.










const ring = await loadBend(new URL('../kernel/profile-ring.bend', import.meta.url));
const encode = points => list(points.map(p => vector([...p, 0])));
function simplify(points, allowRegularized = true) {
  const result = ring.simplify(encode(points), allowRegularized);
  if (result.$ === 'Refused') return { refused: result.reason.$, index: result.reason.index };
  assert.equal(result.$, 'Simplified');
  return { kept: array(result.kept), toleranceMm: number(result.tolerance),
    merged: array(result.merged).map(m => ({ index: m.index, deviationMm: number(m.deviation), exact: m.exact })) };
}
const range = n => Array.from({ length: n }, (_, i) => i);
const gon = (n, r = 100) => range(n).map(i => [r * Math.cos(2 * Math.PI * i / n), r * Math.sin(2 * Math.PI * i / n)]);
const star = n => range(n).map(i => { const r = i % 2 ? 100 : 30; return [r * Math.cos(2 * Math.PI * i / n), r * Math.sin(2 * Math.PI * i / n)]; });

// Exact test oracle on the represented F32x2 words (hi + lo as dyadic
// rationals scaled by 2^300): the distance of b from the line a-c.
const scaled = value => { const { hi, lo } = vector([value, 0, 0]).x; return BigInt(hi * 2 ** 300) + BigInt(lo * 2 ** 300); };
function exactDeviation(a, b, c) {
  const [ax, ay, bx, by, cx, cy] = [...a, ...b, ...c].map(scaled);
  const cross = (cx - ax) * (by - ay) - (cy - ay) * (bx - ax);
  const magnitude = Number(cross < 0n ? -cross : cross) / 2 ** 600;
  return magnitude / Math.hypot(Number(cx - ax) / 2 ** 300, Number(cy - ay) / 2 ** 300);
}

// The first profile of a frozen FS unit, captured at ModelingContext.addProfile;
// the build is stopped right there.
async function firstProfile(path, feature) {
  const original = ModelingContext.prototype.addProfile, stop = new Error('profile captured');
  let points;
  ModelingContext.prototype.addProfile = function (sketch, id, profile) { points = profile.map(p => [...p]); throw stop; };
  try { await build(readFileSync(path, 'utf8'), { feature }); }
  catch (error) { if (points === undefined) throw error; }
  finally { ModelingContext.prototype.addProfile = original; }
  return points;
}

test('r10b SideDrive rack g0: the exactly collinear vertices merge with deviation 0', async () => {
  const rack = await firstProfile('fixtures/r10b/r10b.fs', 'r10bSideDrive');
  assert.equal(rack.length, 147);
  assert.deepEqual([rack[139], rack[140], rack[141]].map(p => p[1]), Array(3).fill(-18.000000000000004));
  assert.deepEqual([rack[142], rack[143], rack[144]].map(p => p[1]), Array(3).fill(-184));
  for (const allow of [true, false]) {
    const result = simplify(rack, allow);
    assert.deepEqual(result.merged, [{ index: 140, deviationMm: 0, exact: true }, { index: 143, deviationMm: 0, exact: true }]);
    assert.deepEqual(result.kept, range(147).filter(i => i !== 140 && i !== 143));
  }
  // The host admits the profile; its classification agrees with the kernel's.
  const eps = validatePolygon(rack);
  const collinear = range(147).filter(i => classifyCorner(rack[(i + 146) % 147], rack[i], rack[(i + 1) % 147], eps) === 'collinear');
  assert.deepEqual(collinear, [140, 143]);
});

// cad-project-014 machine-interface-r11/top-entry-r12/baseline/interface-r11.fs,
// feature bottomSpoke, sketch line 33 (outside the repo; values captured through
// ModelingContext.addProfile). Collinear up to the decimal rounding of its inputs.
const spoke = [[117, 57], [278, 32], [287.8, 30.47826087], [287.8, 60.4627451], [278, 62], [125, 86], [117, 86]];

test('bottomSpoke: a 1.8e-9 mm corner merges as a recorded regularization', () => {
  const result = simplify(spoke);
  assert.deepEqual(result.kept, [0, 2, 3, 5, 6]);
  assert.deepEqual(result.merged.map(m => [m.index, m.exact]), [[1, false], [4, false]]);
  const reference = [exactDeviation(spoke[0], spoke[1], spoke[2]), exactDeviation(spoke[3], spoke[4], spoke[5])];
  assert.ok(Math.abs(reference[0] - 4.05e-10) < 1e-12 && Math.abs(reference[1] - 1.8205e-9) < 1e-12, String(reference));
  // The deviation is the exact value rounded to F32x2 (relative 2^-46).
  result.merged.forEach((m, i) => assert.ok(Math.abs(m.deviationMm - reference[i]) <= 2 ** -40 * reference[i], `${m.deviationMm} != ${reference[i]}`));
  // tol is the F32x2 image of the host's tolerance(points).
  const host = tolerance(spoke);
  assert.ok(Math.abs(result.toleranceMm - host) <= host * 2 ** -40, `${result.toleranceMm} != ${host}`);
  assert.ok(result.merged.every(m => m.deviationMm > 0 && m.deviationMm <= result.toleranceMm));
  // Without the regularization policy only exact merges happen.
  assert.deepEqual(simplify(spoke, false), { kept: range(7), merged: [], toleranceMm: result.toleranceMm });
});

test('a backtracking corner is refused, never merged', () => {
  for (const allow of [true, false]) {
    assert.deepEqual(simplify([[0, 0], [10, 0], [5, 0], [5, 5]], allow), { refused: 'Backtracking', index: 1 });
    // 1e-7 mm off the line: still a reversal, not a straight-on vertex.
    assert.deepEqual(simplify([[0, 0], [10, 0], [5, 1e-7], [5, 5]], allow), { refused: 'Backtracking', index: 1 });
  }
  // A 2e-6 mm sliver: its tips are too flat to be corners and too far off to
  // merge. Refused, not reduced below 3 vertices.
  assert.deepEqual(simplify([[0, 0], [5, -1e-6], [10, 0], [5, 1e-6]]), { refused: 'Sliver', index: 0 });
});

test('kept indices and merges come back in source order', () => {
  // Vertex 0 is merged: the walk starts at the anchor 1 and wraps around.
  const wrapped = simplify([[5, 0], [10, 0], [10, 5], [10, 10], [0, 10], [0, 0]]);
  assert.deepEqual(wrapped.kept, [1, 3, 4, 5]);
  assert.deepEqual(wrapped.merged, [{ index: 0, deviationMm: 0, exact: true }, { index: 2, deviationMm: 0, exact: true }]);
  // Below 10 mm the floor applies: the F32x2 words nearest to 1e-5.
  assert.equal(wrapped.toleranceMm, number(vector([1e-5, 0, 0]).x));
  // A run of several collinear vertices.
  const chain = simplify([[0, 0], [2, 0], [4, 0], [6, 0], [10, 0], [10, 10], [0, 10]]);
  assert.deepEqual(chain.kept, [0, 4, 5, 6]);
  assert.deepEqual(chain.merged.map(m => [m.index, m.deviationMm, m.exact]), [[1, 0, true], [2, 0, true], [3, 0, true]]);
  // The smallest result: a triangle with a midpoint on each side keeps exactly 3.
  assert.deepEqual(simplify([[0, 0], [5, 0], [10, 0], [10, 5], [10, 10], [5, 5]]).kept, [0, 2, 4]);
});

test('random convex rings with exact midpoints recover their corners, never fewer than 3', () => {
  let seed = 12345;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  let checked = 0, mergedTotal = 0;
  for (let round = 0; round < 60; round++) {
    const n = 3 + Math.floor(random() * 6), phase = random();
    // Even integer corners on a circle: every midpoint is exact.
    const corners = range(n).map(i => { const t = 2 * Math.PI * (i + phase) / n; return [2 * Math.round(40 * Math.cos(t)), 2 * Math.round(40 * Math.sin(t))]; })
      .filter((p, i, all) => { const q = all[(i + all.length - 1) % all.length]; return p[0] !== q[0] || p[1] !== q[1]; });
    if (corners.length < 3 || corners.some((p, i) => classifyCorner(corners[(i + corners.length - 1) % corners.length], p, corners[(i + 1) % corners.length], 1e-5) !== 'corner')) continue;
    const points = [], cornerIndices = [];
    corners.forEach((p, i) => {
      cornerIndices.push(points.length); points.push(p);
      const q = corners[(i + 1) % corners.length];
      if (random() < 0.6) points.push([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]);
    });
    const result = simplify(points);
    assert.deepEqual(result.kept, cornerIndices, JSON.stringify(points));
    assert.ok(result.kept.length >= 3);
    assert.ok(result.merged.every(m => m.exact && m.deviationMm === 0));
    checked++; mergedTotal += result.merged.length;
  }
  assert.ok(checked >= 40 && mergedTotal >= 60, `${checked} rings, ${mergedTotal} merges`);
});

test('regularized runs stay within tol of their final span', () => {
  // A 30 mm arc of radius 1000 in 0.02 mm steps, closed by two straight edges:
  // every vertex is locally within tol (5e-8 mm), the whole arc (0.45 mm) is not.
  const arc = range(1501).map(i => { const t = i * 0.00002; return [1000 * Math.sin(t), 1000 * (1 - Math.cos(t))]; });
  const points = [...arc, [30, 30], [0, 30]];
  const result = simplify(points);
  // Chords up to sqrt(8 R tol) = 0.48 mm: at least 30 / 0.48 = 63 spans.
  assert.ok(result.kept.length >= 64 && result.kept.length < 200, String(result.kept.length));
  assert.equal(result.kept.length + result.merged.length, points.length);
  const kept = new Set(result.kept);
  for (const m of result.merged) {
    let before = m.index, after = m.index;
    while (!kept.has(before)) before = (before + points.length - 1) % points.length;
    while (!kept.has(after)) after = (after + 1) % points.length;
    const deviation = exactDeviation(points[before], points[m.index], points[after]);
    assert.ok(deviation <= result.toleranceMm, `${m.index}: ${deviation} > ${result.toleranceMm}`);
    assert.ok(Math.abs(m.deviationMm - deviation) <= 1e-12 * deviation, `${m.index}: ${m.deviationMm} != ${deviation}`);
  }
  // Exact-only policy: nothing on the arc merges.
  assert.equal(simplify(points, false).merged.length, 0);
});

test('ring refusals: vertex count, short edges and invalid words', t => {
  assert.deepEqual(simplify([[0, 0], [1, 0]]), { refused: 'VertexCount', index: undefined });
  assert.deepEqual(simplify(gon(4097)), { refused: 'VertexCount', index: undefined });
  assert.deepEqual(simplify([[0, 0], [10, 0], [10, 1e-6], [0, 10]]), { refused: 'ShortEdge', index: 1 });
  assert.deepEqual(simplify([[0, 0], [10, 0], [10, 0], [0, 10]]), { refused: 'ShortEdge', index: 1 });
  const points = array(encode([[0, 0], [10, 0], [0, 10]]));
  points[2] = { ...points[2], y: { $: 'Real', hi: NaN, lo: 0 } };
  assert.deepEqual(ring.simplify(list(points), true).reason, { $: 'InvalidPoint', index: 2 });
  const started = performance.now(), result = simplify(gon(4096));
  t.diagnostic(`Bend JS simplify, 4096-gon: ${Math.round(performance.now() - started)} ms`);
  assert.equal(result.kept.length, 4096);
});

test('validatePolygon admits collinear straight-on corners and a 470-vertex ring', () => {
  assert.equal(PROFILE_VERTEX_LIMIT, 4096);
  validatePolygon([[0, 0], [20, 0], [20, 8], [20, 16], [0, 16]]);
  validatePolygon(spoke);
  validatePolygon(gon(470, 50));
  validatePolygon(gon(4096));
  // 470 corners of a 235-gon, each edge split at its exact midpoint.
  const split = gon(235, 50).flatMap((p, i, all) => { const q = all[(i + 1) % all.length]; return [p, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]]; });
  validatePolygon(split);
  // Two collinear corners in a row do not read as a self-touch of their outer edges.
  validatePolygon([[0, 0], [3, 0], [6, 0], [9, 0], [9, 9], [0, 9]]);
  validatePolygon([[0, 0], [3, 1], [6, 2], [9, 3], [9, 9], [0, 9]]);
});

test('validatePolygon still refuses self-intersection, backtracking, short edges and over 4096 vertices', () => {
  assert.throws(() => validatePolygon([[0, 0], [10, 10], [0, 10], [10, 0]]), /self-intersecting/);
  assert.throws(() => validatePolygon([[0, 0], [10, 0], [10, 10], [5, 0], [0, 10]]), /self-intersecting or self-touching/);
  assert.throws(() => validatePolygon([[0, 0], [10, 0], [5, 0], [5, 5]]), /reverse direction/);
  assert.throws(() => validatePolygon([[0, 0], [10, 0], [5, 1e-7], [5, 5]]), /reverse direction/);
  assert.throws(() => validatePolygon([[0, 0], [10, 0], [10, 1e-6], [0, 10]]), /edge below the F32 tolerance/);
  assert.throws(() => validatePolygon([[0, 0], [10, 0], [10, 0], [0, 10]]), /duplicate vertex/);
  assert.throws(() => validatePolygon(gon(4097)), /A profile must have 3–4096 vertices/);
  assert.throws(() => validatePolygon([[0, 0], [1, 0]]), /3–4096/);
  assert.throws(() => validatePolygon([[0, 0], [5, -1e-6], [10, 0], [5, 1e-6]]), /cannot be merged within the F32 tolerance/);
});

// A prism in the brep.json layout of kernel/topology.bend extrude (test oracle).
function prism(profile, h) {
  const n = profile.length, vertices = [...profile.map(([x, y]) => [x, y, 0]), ...profile.map(([x, y]) => [x, y, h])], edges = [];
  for (let i = 0; i < n; i++) edges.push({ start: i, end: (i + 1) % n });
  for (let i = 0; i < n; i++) edges.push({ start: n + i, end: n + (i + 1) % n });
  for (let i = 0; i < n; i++) edges.push({ start: i, end: n + i });
  const faces = [
    { surface: { origin: [0, 0, 0], normal: [0, 0, -1], x: [1, 0, 0] }, loops: [range(n).map(k => ({ edge: n - 1 - k, forward: false }))] },
    { surface: { origin: [0, 0, h], normal: [0, 0, 1], x: [1, 0, 0] }, loops: [range(n).map(k => ({ edge: n + k, forward: true }))] }];
  for (let i = 0; i < n; i++) {
    const p = profile[i], q = profile[(i + 1) % n], l = Math.hypot(q[0] - p[0], q[1] - p[1]), d = [(q[0] - p[0]) / l, (q[1] - p[1]) / l];
    faces.push({ surface: { origin: [p[0], p[1], 0], normal: [d[1], -d[0], 0], x: [d[0], d[1], 0] },
      loops: [[{ edge: i, forward: true }, { edge: 2 * n + (i + 1) % n, forward: true }, { edge: n + i, forward: false }, { edge: 2 * n + i, forward: false }]] });
  }
  return { vertices, edges, faces };
}

test('validateSolid still refuses collinear face loops', () => {
  const box = [[0, 0], [20, 0], [20, 16], [0, 16]];
  assert.ok(Math.abs(validateSolid(prism(box, 5)).volumeMm3 - 1600) < 1e-9);
  const collinear = [[0, 0], [20, 0], [20, 8], [20, 16], [0, 16]];
  assert.throws(() => validateFaceLoop(collinear), /Face loop has collinear/);
  assert.throws(() => validateSolid(prism(collinear, 5)), /Face loop has collinear/);
  assert.throws(() => validateFaceLoop(gon(4097)), /A face loop must have 3–4096 vertices/);
  const volume = validateSolid(prism(gon(470, 50), 2)).volumeMm3;
  assert.ok(Math.abs(volume - 235 * 2500 * Math.sin(2 * Math.PI / 470) * 2) < 1e-6 * volume);
});

test('the O(n²) profile admission at 470 and 4096 vertices', t => {
  const time = points => { const started = performance.now(); validatePolygon(points); return performance.now() - started; };
  for (const n of [470, 4096]) for (const [name, points] of [['n-gon', gon(n)], ['star', star(n)]]) {
    const ms = time(points);
    t.diagnostic(`validatePolygon ${name} ${n}: ${ms.toFixed(1)} ms`);
    // Recorded on 2026-09-23 under load: 470 star 9.5 ms, 4096 star 458 ms. The
    // bound only catches a complexity regression, not a slow machine.
    assert.ok(ms < 20000);
  }
});

test('production: a collinear polyline vertex fails only at the strict face loop until the prism merges it', async () => {
  const source = readFileSync('fixtures/corpus-repro/kernel-sketch-and-ops/collinear-polyline-vertex.fs', 'utf8');
  try {
    const model = await build(source);
    // After the profile-ring merge is wired into extrudeInBend (task D).
    assert.equal(model.bodies.length, 1);
    assert.ok(Math.abs(model.bodies[0].validation.volumeMm3 - 1600) < 1e-6);
  } catch (error) {
    assert.match(error.message, /Face loop has collinear or nearly collinear consecutive edges/);
  }
});

}
