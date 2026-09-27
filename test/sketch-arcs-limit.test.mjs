import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("sketch-arcs-limit.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { readFileSync } = await import("node:fs");
const { build } = await import("../src/index.mjs");
const { array } = await import("../src/kernel.mjs");
const { coords, number, real, vector } = await import("../src/real.mjs");
const { encodeSketchArcEntities, loadSketchArcs, sketchArcPoint } = await import("../src/sketch-arcs.mjs");
const { SKETCH_ENTITY_LIMIT, SKETCH_LINES_SEGMENT_LIMIT } = await import("../src/library.mjs");
// Line/arc profile limits, the O(n log n) admission (sort-and-sweep broad
// phase), the near-collinear pair test (R20 D03) and near-tangent joins
// (R20 top plate DXF). docs/sketch-arcs.md.









const native = await loadSketchArcs();
const solve = entities => native.solve(encodeSketchArcEntities(entities));
const mm = point => point.map(v => v / 1000);
const line = (a, b, index) => ({ type: 'line', startMeters: mm(a), endMeters: mm(b), ...(index === undefined ? {} : { index }) });
const arc = (a, m, b, index) => ({ type: 'arc', startMeters: mm(a), midMeters: mm(m), endMeters: mm(b), ...(index === undefined ? {} : { index }) });
const loop = points => points.map((p, i) => line(p, points[(i + 1) % points.length], i));
const regular = (n, r = 20) => Array.from({ length: n }, (_, i) => [r * Math.cos(2 * Math.PI * i / n), r * Math.sin(2 * Math.PI * i / n)]);
const polygonArea = (n, r = 20) => n * r * r * Math.sin(2 * Math.PI / n) / 2;
const relative = (actual, expected) => Math.abs(actual - expected) / Math.abs(expected);

// R20 datums D03: 180 deg annular sector about P, radius |C - P| +- 1 mm, as
// r20AnnularSector builds it (cos/sin of 180 deg leave y = 1.66e-14 mm).
const radius = Math.hypot(100, 90), inner = radius - 1, outer = radius + 1;
const polar = (r, degrees) => [r * Math.cos(degrees * Math.PI / 180), r * Math.sin(degrees * Math.PI / 180)];
const d03 = [line(polar(inner, 0), polar(outer, 0), 0), arc(polar(outer, 0), polar(outer, 90), polar(outer, 180), 1),
  line(polar(outer, 180), polar(inner, 180), 2), arc(polar(inner, 180), polar(inner, 90), polar(inner, 0), 3)];
const d03Area = Math.PI / 2 * (outer * outer - inner * inner);

test('the JS limits match the kernel', () => {
  assert.equal(Number(native.entity_limit()), SKETCH_ENTITY_LIMIT);
  assert.ok(SKETCH_ENTITY_LIMIT >= 1000);
  assert.ok(SKETCH_LINES_SEGMENT_LIMIT < SKETCH_ENTITY_LIMIT);
});

test('native admission takes the limit and refuses one more by name', () => {
  const entities = loop(regular(SKETCH_ENTITY_LIMIT));
  const result = solve(entities);
  assert.equal(result.$, 'Solved');
  assert.ok(relative(number(result.area), polygonArea(SKETCH_ENTITY_LIMIT)) < 1e-12);
  assert.equal(solve([...entities, line([30, 0], [31, 0], SKETCH_ENTITY_LIMIT)]).reason.$, 'EntityCount');
});

test('D03: a thin 180 deg annular sector is admitted with its analytic area', () => {
  const result = solve(d03);
  assert.equal(result.$, 'Solved', JSON.stringify(result.reason));
  assert.ok(relative(number(result.area), d03Area) < 1e-12);
});

// P.clear on two lines as the admission builds them (sketch-arcs pair_segment):
// endpoints are input points whose F32x2 prefix is the given mm coordinate.
const point = a => {
  const value = vector([...a, 0]), stored = coords(value);
  return { ...sketchArcPoint(mm(a)), value, remainder: vector([a[0] - stored[0], a[1] - stored[1], 0]) };
};
const segment = (a, b) => {
  const [p, q] = a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? [a, b] : [b, a];
  const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
  return { $: 'Segment', curve: { $: 'Line', origin: vector([...p, 0]), direction: vector([(q[0] - p[0]) / length, (q[1] - p[1]) / length, 0]) },
    first: real(0), last: real(length), start: point(a), end: point(b), tilt: real(2 / length), stretch: real(0) };
};
const clear = (a, b, resolution = 1e-10) => native['sketch-arcs-intersections.clear'](segment(...a), segment(...b), real(resolution));

test('near-collinear lines: disjoint intervals are clear, overlapping or touching ones are not', () => {
  const tilt = 1.66e-14;
  assert.equal(clear([[133.5, 0], [135.5, 0]], [[-135.5, tilt], [-133.5, tilt * 0.98]]), true, 'D03 radial edges');
  assert.equal(clear([[0, 0], [10, 0]], [[4, tilt], [6, tilt * 1.3]]), false, 'overlap');
  assert.equal(clear([[0, 0], [10, 0]], [[10 + 1e-6, tilt], [12, tilt * 1.3]]), true, 'gap along the line');
  // Exactly parallel: the unchanged coincident test gives the same answers.
  assert.equal(clear([[0, 0], [10, 0]], [[4, 0], [6, 0]]), false);
  assert.equal(clear([[0, 0], [10, 0]], [[11, 0], [12, 0]]), true);
});

// Seeded random profiles: every Solved profile has no failing pair (all pairs,
// no broad phase); every self-intersection names a failing pair.
test('the broad phase loses no failing pair', () => {
  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  let solved = 0, crossed = 0;
  for (let k = 0; k < 60; k++) {
    const n = 4 + Math.floor(random() * 24), scale = [1, 20, 300][k % 3];
    const angles = Array.from({ length: n }, (_, i) => 2 * Math.PI * (i + random() * 0.8) / n);
    if (k % 4 === 1) { const i = Math.floor(random() * n), j = Math.floor(random() * n); [angles[i], angles[j]] = [angles[j], angles[i]]; }
    const points = angles.map(t => { const r = scale * (0.5 + random()); return [r * Math.cos(t), r * Math.sin(t)]; });
    const entities = points.map((p, i) => {
      const q = points[(i + 1) % n];
      if (random() >= 0.3) return line(p, q, i);
      const b = (random() - 0.5) * 0.6;
      return arc(p, [(p[0] + q[0]) / 2 - (q[1] - p[1]) * b, (p[1] + q[1]) / 2 + (q[0] - p[0]) * b], q, i);
    });
    const result = solve(entities);
    if (result.$ === 'Solved') {
      solved++;
      const segments = array(result.uses).map(({ fit }) => native.pair_segment(fit));
      for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
        assert.equal(native['sketch-arcs-intersections.clear'](segments[i], segments[j], result.resolution), true, `case ${k}: pair ${i}/${j}`);
      }
    } else if (result.reason.$ === 'SelfIntersectionOrTouch') crossed++;
  }
  assert.ok(solved > 10 && crossed > 10, `${solved} solved, ${crossed} crossed`);
});

// ---- Near-tangent joins (docs/sketch-arcs.md "Near-tangent joins") ----------
// R20 top plate: a real laser DXF (43 outline entities, 23 through loops) whose
// tangent joins carry tangency noise, the same rounded to 1e-9 mm, and the CAD
// side's exact-tangent rebuild. Geometry below is independent double precision.
const plate = name => JSON.parse(readFileSync(new URL(`../fixtures/sketch/${name}.json`, import.meta.url))).loops;
const mapPlate = (loops, f) => Object.fromEntries(Object.entries(loops).map(([layer, list]) => [layer, list.map(loop => loop.map(s =>
  ({ ...s, start: s.start.map(f), end: s.end.map(f), ...(s.mid ? { mid: s.mid.map(f) } : {}) })))]));
const rawPlate = plate('topplate-raw-dxf-loops'), exactPlate = plate('topplate-exact-tangent-loops');
const plateEntity = (s, i) => s.kind === 'line' ? line(s.start, s.end, i) : arc(s.start, s.mid, s.end, i);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const norm = a => Math.hypot(a[0], a[1]), unit = a => [a[0] / norm(a), a[1] / norm(a)];
const circleOf = ({ start: a, mid: m, end: b }) => {
  const u = sub(m, a), v = sub(b, a), det = 2 * (u[0] * v[1] - u[1] * v[0]), u2 = dot(u, u), v2 = dot(v, v);
  const center = [a[0] + (u2 * v[1] - v2 * u[1]) / det, a[1] + (u[0] * v2 - v[0] * u2) / det];
  const angle = p => Math.atan2(p[1] - center[1], p[0] - center[0]), turn = p => ((angle(p) - angle(a)) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  const sweep = turn(m) < turn(b) ? turn(b) : turn(b) - 2 * Math.PI;
  return { center, radius: norm(sub(a, center)), first: angle(a), sweep };
};
const entityLength = s => s.kind === 'line' ? norm(sub(s.end, s.start)) : (c => c.radius * Math.abs(c.sweep))(circleOf(s));
// Largest distance between corresponding points (same normalized parameter) of
// two variants of one entity: lines interpolate their endpoints; an arc point
// c + r u(first + t sweep) moves by at most |dc| + |dr| + r (|dfirst| + |dsweep|).
const displacement = (s, t) => {
  if (s.kind === 'line') return Math.max(norm(sub(s.start, t.start)), norm(sub(s.end, t.end)));
  const a = circleOf(s), b = circleOf(t), wrap = x => Math.abs(Math.atan2(Math.sin(x), Math.cos(x)));
  return norm(sub(a.center, b.center)) + Math.abs(a.radius - b.radius) + b.radius * (wrap(a.first - b.first) + Math.abs(a.sweep - b.sweep));
};

test('R20 top plate: raw, 1e-9 mm rounded and exact-tangent DXF loops are admitted with an unchanged region', () => {
  const variants = { raw: rawPlate, rounded: mapPlate(rawPlate, v => Math.round(v * 1e9) / 1e9), exact: exactPlate };
  const solved = Object.fromEntries(Object.entries(variants).map(([name, loops]) => [name, Object.fromEntries(Object.entries(loops).map(([layer, list]) =>
    [layer, list.map((loop, i) => {
      const result = solve(loop.map(plateEntity));
      assert.equal(result.$, 'Solved', `${name} ${layer}[${i}]: ${JSON.stringify(result.reason)}`);
      assert.equal(array(result.uses).length, loop.length, 'every entity bounds the region; nothing is merged');
      return result;
    })]))]));
  assert.deepEqual(Object.values(rawPlate).map(list => list.length), [1, 23]);
  // ΔA = ∮ δ×γ' + ½ ∮ δ×δ' for a pointwise displacement δ, so per entity
  // |ΔA| <= h (L + (L + L') / 2); each native area also carries its documented
  // numeric budget resolution * perimeter (the mass-budget convention).
  for (const name of ['raw', 'rounded']) for (const [layer, list] of Object.entries(variants[name])) list.forEach((loop, i) => {
    const target = exactPlate[layer][i], ours = solved[name][layer][i], theirs = solved.exact[layer][i];
    const geometric = loop.reduce((sum, s, k) => sum + displacement(s, target[k]) * (1.5 * entityLength(target[k]) + 0.5 * entityLength(s)), 0);
    const numeric = number(ours.resolution) * loop.reduce((sum, s) => sum + entityLength(s), 0) + number(theirs.resolution) * target.reduce((sum, s) => sum + entityLength(s), 0);
    const change = Math.abs(number(ours.area) - number(theirs.area));
    assert.ok(change <= geometric + numeric, `${name} ${layer}[${i}]: area change ${change} > ${geometric} + ${numeric}`);
  });
});

// Kernel sketch scale S (max |coordinate|, at least 1) and the vertex length 2^-36 S.
const sketchScale = loop => Math.max(1, ...loop.flatMap(s => [s.start, s.mid, s.end].filter(Boolean)).flatMap(p => p.map(Math.abs)));
// Second carrier root X = 2F - J of entity `s` (a line or an arc) meeting arc `a`
// at join J. F is the foot of a's centre on the line, or of J on the line
// through both centres.
const foot = (p, origin, direction) => {
  const u = unit(direction), t = dot(sub(p, origin), u);
  return [origin[0] + u[0] * t, origin[1] + u[1] * t];
};
const secondRoot = (s, a, J) => {
  const { center } = circleOf(a);
  const F = s.kind === 'line' ? foot(center, s.start, sub(s.end, s.start)) : foot(J, center, sub(circleOf(s).center, center));
  return [2 * F[0] - J[0], 2 * F[1] - J[1]];
};
// Move the arc's middle point radially by eps: a tangency error at both of its joins.
const bumped = (loop, k, eps) => {
  const n = unit(sub(loop[k].mid, circleOf(loop[k]).center));
  return loop.map((s, i) => i === k ? { ...s, mid: [s.mid[0] + n[0] * eps, s.mid[1] + n[1] * eps] } : s);
};
const pair = result => [result.reason.first, result.reason.second].sort((a, b) => a - b);

test('near-tangent cusp: a second contact beyond 2^-36 S of the join stays refused by name', () => {
  // CUT_OUTER entities 10 (line) and 11 (arc) meet in a cusp (a horn tip):
  // both leave their join J the same way. Scaling the tangency error moves the
  // second root X along both entities (a real crossing of the finite segments).
  const outer = rawPlate.CUT_OUTER[0], short = 2 ** -36 * sketchScale(outer);
  for (const [eps, admitted] of [[1e-9, true], [1e-8, false]]) {
    const loop = bumped(outer, 11, eps), J = loop[10].end, X = secondRoot(loop[10], loop[11], J);
    assert.ok(dot(sub(X, J), sub(loop[10].start, J)) > 0 && dot(sub(X, J), sub(loop[11].mid, J)) > 0, 'X lies inside both entities');
    assert.equal(norm(sub(X, J)) <= short, admitted, `|X - J| = ${norm(sub(X, J))}, 2^-36 S = ${short}`);
    const result = solve(loop.map(plateEntity));
    if (admitted) assert.equal(result.$, 'Solved', JSON.stringify(result.reason));
    else {
      assert.equal(result.reason.$, 'SelfIntersectionOrTouch');
      assert.deepEqual(pair(result), [10, 11]);
    }
  }
});

test('near-tangent planted cusps: line/arc and internal/external arc/arc second contacts beyond 2^-36 S stay refused by pair, also at a join gap', () => {
  // Entity 1 is an arc of radius r2 = 20 about (0, 20) that leaves the join
  // J = (0, 0) along +x. Entity 0 arrives at J from +x (a cusp): a line, or an
  // arc of radius r1 = 5 inside (internal) or outside (external) that circle.
  // Tilting entity 0's carrier by phi about J puts the second carrier root X
  // on both finite entities (a real second contact) at |X - J| = gain sin(phi),
  // gain = 2 r2 for the line and 2 r1 r2 / |c1 - c2| for the arcs. The spans
  // (sweeps 0.8 and 1.4 rad, a 10 mm line) keep the carriers well conditioned:
  // their error margin (docs/sketch-arcs.md "Conditioned cusps") stays below
  // 0.2 x 2^-36 S, so the admission threshold lies between k 0.8 and 1.25.
  const J = [0, 0], r1 = 5, r2 = 20, c2 = [0, r2];
  const turn = (v, a) => [Math.cos(a) * v[0] - Math.sin(a) * v[1], Math.sin(a) * v[0] + Math.cos(a) * v[1]];
  const along = (c, psi) => (p => [c[0] + p[0], c[1] + p[1]])(turn(sub(J, c), c[1] > 0 ? psi : -psi)); // psi from J towards +x
  const centre1 = (kind, phi) => turn([0, kind === 'external' ? -r1 : r1], phi);
  const cusp = (kind, phi) => {
    const c1 = centre1(kind, phi), P1 = kind === 'line' ? turn([10, 0], phi) : along(c1, 1.4), P2 = along(c2, 0.8);
    const first = kind === 'line' ? { kind, start: P1, end: J } : { kind: 'arc', start: P1, mid: along(c1, 0.7), end: J };
    return [first, { kind: 'arc', start: J, mid: along(c2, 0.4), end: P2 }, { kind: 'line', start: P2, end: P1 }];
  };
  // Intersections of entity 0's carrier (a line through P along u, or a circle
  // about c of radius r) with entity 1's circle, from their analytic data.
  const lineRoots = (P, u) => {
    const w = sub(P, c2), b = dot(w, u), root = Math.sqrt(b * b - dot(w, w) + r2 * r2);
    return [-b - root, -b + root].map(t => [P[0] + t * u[0], P[1] + t * u[1]]);
  };
  const circleRoots = (c, r) => {
    const d = norm(sub(c2, c)), e = unit(sub(c2, c)), a = (r * r - r2 * r2 + d * d) / (2 * d), h = Math.sqrt(r * r - a * a);
    return [-h, h].map(s => [c[0] + a * e[0] - s * e[1], c[1] + a * e[1] + s * e[0]]);
  };
  for (const [kind, gain, sign, into] of [['line', 2 * r2, 1, 1], ['internal', 2 * r1 * r2 / (r2 - r1), -1, -1], ['external', 2 * r1 * r2 / (r2 + r1), 1, 1]]) {
    const phiOf = k => sign * Math.asin(k * 2 ** -36 * sketchScale(cusp(kind, 0)) / gain);
    for (const [k, admitted] of [[0.8, true], [1.25, false]]) {
      const loop = cusp(kind, phiOf(k));
      const short = 2 ** -36 * sketchScale(loop), X = secondRoot(loop[0], loop[1], J);
      assert.ok(dot(sub(X, J), sub(loop[0].mid ?? loop[0].start, J)) > 0 && dot(sub(X, J), sub(loop[1].mid, J)) > 0, `${kind}: X lies inside both entities`);
      assert.equal(norm(sub(X, J)) <= short, admitted, `${kind}: |X - J| = ${norm(sub(X, J))}, 2^-36 S = ${short}`);
      const result = solve(loop.map(plateEntity));
      if (admitted) assert.equal(result.$, 'Solved', `${kind} k ${k}: ${JSON.stringify(result.reason)}`);
      else {
        assert.equal(result.reason?.$, 'SelfIntersectionOrTouch', `${kind} k ${k}`);
        assert.deepEqual(pair(result), [0, 1], `${kind} k ${k}`);
      }
    }
    // Join gap: the admitted exact-join cusp (k 0.8, and the exact tangency
    // k 0) with entity 0 moved by half a resolution towards entity 1's side
    // (`into`), so J_a = J + g is still joined to J_b = J within resolution but
    // J is no longer a root of entity 0's carrier. The carriers now cross at
    // about sqrt(2 relative g) from J, on both finite entities, far beyond 2^-36 S.
    for (const k of [0, 0.8]) {
      const exact = cusp(kind, phiOf(k)), control = solve(exact.map(plateEntity));
      assert.equal(control.$, 'Solved', `${kind} k ${k} exact join: ${JSON.stringify(control.reason)}`);
      const g = [0, into * 0.5 * number(control.resolution)], moved = p => [p[0] + g[0], p[1] + g[1]];
      const [first, second, closing] = exact;
      const gapped = [{ ...first, start: moved(first.start), end: moved(first.end), ...(first.mid ? { mid: moved(first.mid) } : {}) }, second, { ...closing, end: moved(closing.end) }];
      const Ja = gapped[0].end, short = 2 ** -36 * sketchScale(gapped);
      assert.ok(norm(sub(Ja, J)) > 0 && norm(sub(Ja, J)) < number(control.resolution), `${kind} k ${k}: joined within resolution, not exactly`);
      const roots = kind === 'line' ? lineRoots(Ja, turn([1, 0], phiOf(k))) : circleRoots(moved(centre1(kind, phiOf(k))), r1);
      const X = roots.reduce((p, q) => (q[0] > p[0] ? q : p));
      // Both entities are x-monotone over their spans, so X lies on both when its x does.
      assert.ok(X[0] > Math.max(Ja[0], J[0]) && X[0] < Math.min(first.start[0], second.end[0]), `${kind} k ${k}: X = ${X} lies inside both entities`);
      assert.ok(norm(sub(X, J)) > 1000 * short, `${kind} k ${k}: |X - J| = ${norm(sub(X, J))}, 2^-36 S = ${short}`);
      const result = solve(gapped.map(plateEntity));
      assert.equal(result.reason?.$, 'SelfIntersectionOrTouch', `${kind} k ${k} join gap: ${result.$}`);
      assert.deepEqual(pair(result), [0, 1], `${kind} k ${k} join gap`);
    }
  }
});

// Exact rationals [numerator, denominator] (BigInt) over the entities' own
// double coordinates: no rounding enters the second root below.
const Qexact = x => { let n = x, d = 1n; while (!Number.isInteger(n)) { n *= 2; d *= 2n; } return [BigInt(n), d]; };
const qadd = ([a, b], [c, d]) => [a * d + c * b, b * d], qsub = ([a, b], [c, d]) => [a * d - c * b, b * d];
const qmul = ([a, b], [c, d]) => [a * c, b * d], qdiv = ([a, b], [c, d]) => (c < 0n ? [-a * d, -b * c] : [a * d, b * c]);
const qsign = ([a]) => (a > 0n) - (a < 0n);
const Psub = (p, q) => [qsub(p[0], q[0]), qsub(p[1], q[1])], Pdot = (p, q) => qadd(qmul(p[0], q[0]), qmul(p[1], q[1]));
const Pcross = (p, q) => qsub(qmul(p[0], q[1]), qmul(p[1], q[0])), Pat = (p, t, d) => [qadd(p[0], qmul(t, d[0])), qadd(p[1], qmul(t, d[1]))];
const centre = (A, M, B) => {
  const u = Psub(M, A), v = Psub(B, A), det = qmul([2n, 1n], Pcross(u, v)), u2 = Pdot(u, u), v2 = Pdot(v, v);
  return [qadd(A[0], qdiv(qsub(qmul(u2, v[1]), qmul(v2, u[1])), det)), qadd(A[1], qdiv(qsub(qmul(u[0], v2), qmul(v[0], u2)), det))];
};
// X strictly inside arc {A, M, B}: on M's side of the chord AB.
const onArc = ([A, M, B], X) => qsign(Pcross(Psub(B, A), Psub(X, A))) === qsign(Pcross(Psub(B, A), Psub(M, A))) && qsign(Pcross(Psub(B, A), Psub(X, A))) !== 0;

test('near-tangent ill-conditioned cusps: an exact second contact beyond 2^-36 S stays refused by pair (flat arc, nearly equal internal radii)', () => {
  // Cusps at an exact (bit-identical) join J. Exact carriers: the line through
  // its two points, the circle through each arc's three points. Their second
  // root X lies strictly inside both entities beyond 2^-36 S, but the
  // computed tangent point of such a pair errs by more than that (a flat arc:
  // sweep 1e-4 rad; two internal arcs of radius 10 and 9.99), so an admission
  // needs the carriers' error bound (docs/sketch-arcs.md "Conditioned cusps").
  const cases = {
    'line/flat arc, S 250, r 3000, chord 0.3': { J: [250.3, 180.7], L: [250.2395704324316, 180.2540759399141], M: [250.27985309478572, 180.5513591502796], B: [250.2596987575539, 180.40271930809035] },
    'line/flat arc, S 9600, r 1000, chord 0.1': { J: [9600.3, 4100.7], L: [9600.201529282036, 4100.5868473698765], M: [9600.267175484441, 4100.662283277213], B: [9600.234349083086, 4100.624568195698] },
    // Its computed tangent point lies within resolution of J (the `shared` escape).
    'line/flat arc, S 9600, r 1e5, chord 0.5': { J: [9600.3, 4100.7], L: [9599.606361678369, 4100.985247048655], M: [9600.068787344979, 4100.795082638564], B: [9599.83757492766, 4100.890165855162] },
    'internal arcs r 10 / 9.99, S 5': { J: [3.3, 2.1], P1: [5.032696412307752, 1.1078066849008117], Q1: [4.1415226818907005, 1.5605497981663827], Q2: [4.140681159208804, 1.5610892483682104], P2: [5.030963715895437, 1.1087988782158984] },
  };
  for (const [name, p] of Object.entries(cases)) {
    const loop = p.L ? [{ kind: 'line', start: p.L, end: p.J }, { kind: 'arc', start: p.J, mid: p.M, end: p.B }, { kind: 'line', start: p.B, end: p.L }]
      : [{ kind: 'arc', start: p.P1, mid: p.Q1, end: p.J }, { kind: 'arc', start: p.J, mid: p.Q2, end: p.P2 }, { kind: 'line', start: p.P2, end: p.P1 }];
    const q = Object.fromEntries(Object.entries(p).map(([key, point]) => [key, point.map(Qexact)])), J = q.J;
    let X, inside;
    if (p.L) {
      // X = J + t (L - J) with t = -2 (L - J).(J - C) / |L - J|^2, C the arc's centre.
      const d = Psub(q.L, J), t = qdiv(qmul([-2n, 1n], Pdot(d, Psub(J, centre(J, q.M, q.B)))), Pdot(d, d));
      X = Pat(J, t, d);
      inside = qsign(t) > 0 && qsign(qsub([1n, 1n], t)) > 0 && onArc([J, q.M, q.B], X);
    } else {
      // X = the reflection of J across the line through both centres.
      const a0 = [q.P1, q.Q1, J], a1 = [J, q.Q2, q.P2], C0 = centre(...a0), e = Psub(centre(...a1), C0);
      X = Pat(J, [2n, 1n], Psub(Pat(C0, qdiv(Pdot(Psub(J, C0), e), Pdot(e, e)), e), J));
      inside = onArc(a0, X) && onArc(a1, X);
    }
    assert.ok(inside, `${name}: X lies strictly inside both entities`);
    // |X - J|^2 > (2^-36 S)^2, S = max(1, |coordinate|) as the kernel scales a sketch.
    const S = Qexact(sketchScale(loop)), dX = Psub(X, J), short2 = qmul(qmul(S, S), [1n, 1n << 72n]);
    assert.equal(qsign(qsub(Pdot(dX, dX), short2)), 1, `${name}: |X - J| > 2^-36 S`);
    const result = solve(loop.map(plateEntity));
    assert.equal(result.reason?.$, 'SelfIntersectionOrTouch', `${name}: ${result.$}`);
    assert.deepEqual(pair(result), [0, 1], name);
  }
});

test('near-tangent cusp: a join of two different input doubles with one F32x2 prefix is a join gap, its crossing stays refused by pair', () => {
  // A line/arc cusp at J: the arc (radius 20, chord 10) leaves its join J_b
  // upwards, its centre 20 mm to -x; the vertical line arrives at J_a. The
  // two join x values are neighbouring SI doubles whose mm values share an
  // F32x2 prefix, so they differ only in their remainders (about 1e-13 mm
  // at S 250). J_a lies inside the circle: the carriers cross on both entities
  // hundreds of 2^-36 S from J. With the line through J_b itself (one input
  // point) the same cusp is exactly tangent and admitted.
  const bits = new DataView(new ArrayBuffer(8));
  const neighbour = (x, n) => { bits.setFloat64(0, x); bits.setBigInt64(0, bits.getBigInt64(0) + BigInt(n)); return bits.getFloat64(0); };
  const prefix = x => JSON.stringify(sketchArcPoint([x, 0]).value);
  for (const [x, y] of [[0.2503, 0.1807], [9.0003, 3.0007]]) {
    // The farthest neighbour towards the centre whose mm prefix equals x's.
    let inner = x;
    for (let n = -1; n >= -64; n--) if (prefix(neighbour(x, n)) === prefix(x)) inner = neighbour(x, n);
    assert.notEqual(inner, x, 'a different input double with the same prefix');
    const r = 0.02, phi = 2 * Math.asin(0.01 / (2 * r)), on = a => [x - r + r * Math.cos(a), y + r * Math.sin(a)];
    const arcEntity = { type: 'arc', startMeters: [x, y], midMeters: on(phi / 2), endMeters: on(phi), index: 1 };
    const cusp = joinX => [{ type: 'line', startMeters: [joinX, y + 0.02], endMeters: [joinX, y], index: 0 }, arcEntity,
      { type: 'line', startMeters: on(phi), endMeters: [joinX, y + 0.02], index: 2 }];
    const [Ja, Jb] = [[inner, y], [x, y]].map(sketchArcPoint);
    assert.deepEqual(Ja.value, Jb.value, 'the kernel prefixes of both join points are equal');
    assert.notDeepEqual(Ja.source, Jb.source, 'their SI words differ');
    // Exact rationals over the kernel's mm doubles (SI * 1000): the circle C, r
    // through the arc's three points; f(t) = |(x_a, y_J + t) - C|^2 - r^2 < 0 at
    // t = 2^-36 S and > 0 at t = 10 mm puts a carrier root X on the line strictly
    // between them. Both probe points lie strictly on the arc's side of its
    // chord (a half-plane), so X lies strictly inside the arc too.
    const q = meters => meters.map(v => Qexact(v * 1000));
    const [A, M, B] = [arcEntity.startMeters, arcEntity.midMeters, arcEntity.endMeters].map(q), C = centre(A, M, B), r2 = Pdot(Psub(A, C), Psub(A, C));
    const S = Math.max(1, ...cusp(inner).flatMap(e => [e.startMeters, e.midMeters, e.endMeters].filter(Boolean)).flat().map(v => Math.abs(v * 1000)));
    const probe = t => [Qexact(inner * 1000), qadd(Qexact(y * 1000), Qexact(t))], f = P => qsub(Pdot(Psub(P, C), Psub(P, C)), r2);
    const near = probe(2 ** -36 * S), far = probe(10);
    assert.equal(qsign(f(near)), -1, `x ${x}: the carriers are apart at 2^-36 S from J`);
    assert.equal(qsign(f(far)), 1, `x ${x}: the line leaves the circle within 10 mm`);
    assert.ok(onArc([A, M, B], near) && onArc([A, M, B], far), `x ${x}: the crossing lies strictly inside the arc`);
    const result = solve(cusp(inner));
    assert.equal(result.reason?.$, 'SelfIntersectionOrTouch', `x ${x}: ${result.$}`);
    assert.deepEqual(pair(result), [0, 1], `x ${x}`);
    const joined = solve(cusp(x));
    assert.equal(joined.$, 'Solved', `x ${x} one input join point: ${JSON.stringify(joined.reason)}`);
  }
});

test('near-tangent smooth join: the same scaled error stays admitted, its second root lies outside one entity', () => {
  // CUT_THROUGH[21] entities 4 (line) and 5 (arc) meet smoothly; with the error
  // scaled tenfold past the cusp limit the second root lies beyond J on one side.
  const loop0 = rawPlate.CUT_THROUGH[21], short = 2 ** -36 * sketchScale(loop0);
  const loop = bumped(loop0, 5, 1e-8), J = loop[4].end, X = secondRoot(loop[4], loop[5], J);
  assert.ok(norm(sub(X, J)) > 10 * short);
  assert.ok(dot(sub(X, J), sub(loop[4].start, J)) < 0 || dot(sub(X, J), sub(loop[5].mid, J)) < 0, 'X lies outside one entity');
  const result = solve(loop.map(plateEntity));
  assert.equal(result.$, 'Solved', JSON.stringify(result.reason));
});

test('near-tangent planted touches stay refused with their entity pair', () => {
  // A line through the join J = (0, 0) of an arc on the circle centre (0, 5),
  // r 5, with slope 1e-7 meets that circle again at X = (1e-6, 1e-13): inside
  // the arc, and inside the line when the line lies on the arc's side of J.
  const M = [5 * Math.SQRT1_2, 5 - 5 * Math.SQRT1_2], E = [5, 5], bend = arc([0, 0], M, E, 1);
  const crossing = [line([10, 1e-6], [0, 0], 0), bend, line(E, [10, 1e-6], 2)];
  const smooth = [line([-10, -1e-6], [0, 0], 0), bend, line(E, [-10, -1e-6], 2)];
  const crossed = solve(crossing);
  assert.equal(crossed.reason?.$, 'SelfIntersectionOrTouch');
  assert.deepEqual(pair(crossed), [0, 1]);
  assert.equal(solve(smooth).$, 'Solved', 'the same carriers joined smoothly');
  // Two arcs kissing at their middles (external tangency, no shared endpoint).
  const kiss = gap => [arc([0, -4], [5, 0], [10, -4], 0), line([10, -4], [10, 4], 1), arc([10, 4], [5, gap], [0, 4], 2), line([0, 4], [0, -4], 3)];
  const kissed = solve(kiss(0));
  assert.equal(kissed.reason?.$, 'SelfIntersectionOrTouch');
  assert.deepEqual(pair(kissed), [0, 2]);
  assert.equal(solve(kiss(1e-3)).$, 'Solved', 'the same arcs 1e-3 mm apart');
});

test('near-tangent pair test: a smooth-looking pair that is not one join is not clear', () => {
  // Pair test only: in a whole profile both cases below bring a third entity
  // next to the join, whose own touch would be reported first. The line runs
  // along y = 1e-8 x into (0, 0), tangent to the circle centre (0, 5), r 5.
  const clearPair = (entities) => {
    const fitted = native.fit_inputs(encodeSketchArcEntities(entities), real(1e-11));
    assert.equal(fitted.$, 'Fitted');
    const [a, b] = array(fitted.fits).map(fit => native.pair_segment(fit));
    return native['sketch-arcs-intersections.clear'](a, b, real(1e-11));
  };
  const onCircle = turn => [5 * Math.sin(turn), 5 - 5 * Math.cos(turn)];
  const incoming = line([-10, -1e-7], [0, 0], 0);
  // A near-full arc from the join that wraps back and ends just before it.
  assert.equal(clearPair([incoming, arc([0, 0], [0, 10], onCircle(-2e-6), 1)]), false, 'arc ends 1e-5 mm before the join, along the line');
  assert.equal(clearPair([incoming, arc([0, 0], [0, 10], onCircle(-1e-3), 1)]), true, 'arc ends 5e-3 mm before the join');
  // An arc starting 1e-5 mm back along the line: it passes through the line's end.
  assert.equal(clearPair([incoming, arc(onCircle(-2e-6), onCircle(Math.PI / 4), [5, 5], 1)]), false, 'no shared join, overlapping');
  assert.equal(clearPair([incoming, arc([0, 0], onCircle(Math.PI / 4), [5, 5], 1)]), true, 'the same arc from the join');
});

const header = 'FeatureScript 3000; import(path : "onshape/std/geometry.fs", version : "3000.0");';
const sketch = 'var s = newSketchOnPlane(context, id + "s", {"sketchPlane":plane(vector(0,0,0)*millimeter, vector(0,0,1), vector(1,0,0))});';
const extrude = 'opExtrude(context,id+"e",{"entities":qSketchRegion(id+"s"),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":5*millimeter});';
const v = p => `vector(${p[0].toPrecision(17)},${p[1].toPrecision(17)})*millimeter`;
const model = calls => `${header}\nexport function main(context is Context, id is Id, definition is map) {\n${sketch}\n${calls.join('\n')}\nskSolve(s);\n${extrude}\n}`;
const lineCalls = points => points.map((p, i) => `skLineSegment(s,"e${i}",{"start":${v(p)},"end":${v(points[(i + 1) % points.length])}});`);

test('a 1000-segment polygon builds a prism with its exact volume and segment provenance', async () => {
  const n = 1000, { bodies: [body] } = await build(model(lineCalls(regular(n))));
  assert.equal(body.faces.length, n + 2);
  assert.ok(relative(body.validation.volumeMm3, polygonArea(n) * 5) < 1e-12);
  assert.equal(body.sketchProfile.schema, 'wonky-line-sketch/1');
  assert.equal(body.sketchProfile.solver, 'kernel/sketch-arcs.bend');
  assert.equal(body.sketchProfile.profileUses.length, n);
});

test('a profile above the limit refuses by name', async () => {
  await assert.rejects(build(model(lineCalls(regular(SKETCH_ENTITY_LIMIT + 1)))), new RegExp(`at most ${SKETCH_ENTITY_LIMIT} entities`));
});

test('a profile with arcs at the limit extrudes', async () => {
  const n = SKETCH_ENTITY_LIMIT, points = regular(n);
  const calls = points.map((p, i) => {
    const q = points[(i + 1) % n];
    if (i % 2 === 0) return `skLineSegment(s,"e${i}",{"start":${v(p)},"end":${v(q)}});`;
    const m = 2 * Math.PI * (i + 0.5) / n, r = 20 + 0.2 * 2 * Math.PI * 20 / n;
    return `skArc(s,"e${i}",{"start":${v(p)},"mid":${v([r * Math.cos(m), r * Math.sin(m)])},"end":${v(q)}});`;
  });
  const { bodies: [body] } = await build(model(calls));
  assert.equal(body.faces.length, n + 2);
  assert.ok(body.validation.volumeMm3 > polygonArea(n) * 5);
});

test('D03 extrudes through FeatureScript with the sector volume', async () => {
  const text = entity => entity.type === 'line'
    ? `skLineSegment(s,"e${entity.index}",{"start":${v(entity.startMeters.map(x => x * 1000))},"end":${v(entity.endMeters.map(x => x * 1000))}});`
    : `skArc(s,"e${entity.index}",{"start":${v(entity.startMeters.map(x => x * 1000))},"mid":${v(entity.midMeters.map(x => x * 1000))},"end":${v(entity.endMeters.map(x => x * 1000))}});`;
  const { bodies: [body] } = await build(model(d03.map(text)));
  assert.ok(relative(body.validation.volumeMm3, d03Area * 5) < 1e-9);
});

}
