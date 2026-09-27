import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("planar-hotspot.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { existsSync, readFileSync } = await import("node:fs");
const { fileURLToPath } = await import("node:url");
const { loadBend } = await import("../src/bend-loader.mjs");
const { loadKernel, extrudeInBend } = await import("../src/kernel.mjs");
const { vector, real } = await import("../src/real.mjs");
const { loadFaceClassifier, classificationInput } = await import("../src/face-classification.mjs");
const { intersectionTolerance } = await import("../src/intersections.mjs");
// Prepared cell classification of the planar Boolean (docs/collections.md,
// "Planar Boolean classification"): K.classify(K.prepare(solid, domains,
// tolerance, budget), point) must answer exactly what
// S.classify(solid, domains, point, tolerance, budget) answers, value for value
// (the whole Classification, including the ray count and the unresolved
// reason with its face index). Compared on planar solids (boxes, a notch, a
// cavity, separated shells, a rotated and translated box, thin slabs, the
// captured build123d Boolean operands when present) at grid, boundary,
// near-boundary, near-vertex, far and random points, for two budgets and two
// tolerances.










const root = fileURLToPath(new URL('../', import.meta.url));
const S = await loadBend(root + 'kernel/solid-classification.bend');
const K = await loadBend(root + 'kernel/ports/planar-boolean-classification.bend');

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const plane = { origin: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0] };
const f32 = x => Math.fround(x);

function combineShells(first, second) {
  const body = structuredClone(first), vi = body.vertices.length, ei = body.edges.length;
  body.vertices.push(...second.vertices);
  body.edges.push(...second.edges.map(e => ({ ...e, start: e.start + vi, end: e.end + vi })));
  body.faces.push(...second.faces.map(f => ({ ...f, loops: f.loops.map(l => l.map(u => ({ ...u, edge: u.edge + ei }))) })));
  return body;
}

async function solids() {
  const k = await loadKernel(), face = await loadFaceClassifier();
  const box = (lo = [0, 0, 0], hi = [8, 6, 4]) => extrudeInBend(k, 'box',
    [[lo[0], lo[1]], [hi[0], lo[1]], [hi[0], hi[1]], [lo[0], hi[1]]], { ...plane, origin: [0, 0, lo[2]] }, [0, 0, hi[2] - lo[2]]);
  const native = body => classificationInput(body, face);
  const out = [];
  out.push(['box', native(box())]);
  out.push(['notch', native(extrudeInBend(k, 'L', [[0, 0], [8, 0], [8, 2], [3, 2], [3, 6], [0, 6]], plane, [0, 0, 4]))]);
  out.push(['slanted', native(extrudeInBend(k, 'slant', [[0, 0], [5, 1], [4, 5], [1, 3]], plane, [1.5, -0.75, 3]))]);
  out.push(['thin', native(box([0, 0, 0], [10, 10, 0.001]))]);
  const inner = box([2, 2, 1], [6, 4, 3]);
  for (const f of inner.faces) {
    f.surface.normal = f.surface.normal.map(n => -n);
    f.loops = f.loops.map(loop => loop.toReversed().map(use => ({ ...use, forward: !use.forward })));
  }
  out.push(['cavity', native(combineShells(box(), inner))]);
  out.push(['separated', native(combineShells(box(), box([12, 0, 0], [16, 6, 4])))]);
  const rotation = { $: 'Rotation', x: vector([0.8, 0, -0.6]), y: vector([0, 1, 0]), z: vector([0.6, 0, 0.8]) };
  const rotated = native(box());
  out.push(['rotated', { ...rotated, solid: k.analytic.transform(rotated.solid, rotation, vector([127, -31, 59])) }]);
  const identity = { $: 'Rotation', x: vector([1, 0, 0]), y: vector([0, 1, 0]), z: vector([0, 0, 1]) };
  const notch = native(extrudeInBend(k, 'L', [[0, 0], [8, 0], [8, 2], [3, 2], [3, 6], [0, 6]], plane, [0, 0, 4]));
  out.push(['far-notch', { ...notch, solid: k.analytic.transform(notch.solid, identity, vector([5000.25, -3000.5, 2000.125])) }]);
  const captured = root + 'out/performance/native-build123d/captured.json';
  if (existsSync(captured)) {
    for (const c of JSON.parse(readFileSync(captured, 'utf8')).cases) for (const [i, call] of c.calls.entries()) {
      const [first, ad, , second, bd] = call.args;
      out.push([`${c.id}#${i}.a`, { solid: first, domains: ad }], [`${c.id}#${i}.b`, { solid: second, domains: bd }]);
    }
  }
  return out;
}

const num = r => typeof r === 'number' ? r : r.hi + r.lo;
const listArray = xs => { const out = []; for (let n = xs; n && n.$ === 'Con'; n = n.tail) out.push(n.head); return out; };
const vertexArray = solid => (Array.isArray(solid.vertices) ? solid.vertices : listArray(solid.vertices)).map(v => [num(v.x), num(v.y), num(v.z)]);

// Query points: grid over the padded box, vertices, edge midpoints and thirds,
// face-ish points between vertex pairs, the same nudged by tiny and
// tolerance-sized offsets along every axis, far points and random points.
function points(solid, count, seed) {
  const vs = vertexArray(solid), random = rng(seed);
  const lo = [0, 1, 2].map(i => Math.min(...vs.map(v => v[i]))), hi = [0, 1, 2].map(i => Math.max(...vs.map(v => v[i])));
  const pad = hi.map((h, i) => Math.max(1, (h - lo[i]) * 0.25));
  const out = [];
  for (const a of [0, 0.25, 0.5, 0.75, 1]) for (const b of [0, 0.3, 0.6, 1]) for (const c of [0, 0.5, 1])
    out.push([lo[0] + a * (hi[0] - lo[0]), lo[1] + b * (hi[1] - lo[1]), lo[2] + c * (hi[2] - lo[2])]);
  for (const v of vs) out.push(v);
  for (let i = 0; i + 1 < vs.length; i++) for (const t of [0.5, 1 / 3]) out.push(vs[i].map((x, k) => x + t * (vs[i + 1][k] - x)));
  const base = out.slice();
  const offsets = [1e-9, 1e-7, 2e-7, 1e-5, 1e-4, 1e-3];
  for (const p of base) for (let n = 0; n < 2; n++) {
    const q = p.slice(); q[Math.floor(random() * 3)] += (random() < 0.5 ? -1 : 1) * offsets[Math.floor(random() * offsets.length)]; out.push(q);
  }
  for (const p of [[1e4, 0, 0], [-3e4, 2e4, 1e4], [0, 0, -9e4]]) out.push(p);
  while (out.length < count) out.push([0, 1, 2].map(i => lo[i] - pad[i] + random() * (hi[i] - lo[i] + 2 * pad[i])));
  return out.map(p => p.map(f32));
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// npm test samples every fourth point of every solid and one tolerance/budget
// pair per solid (rotating); PLANAR_HOTSPOT_FULL=1 compares all of them.
const full = process.env.PLANAR_HOTSPOT_FULL === '1';

test('prepared planar cell classification answers exactly S.classify', async () => {
  const cases = await solids();
  const tallies = {};
  let compared = 0;
  for (const [c, [name, { solid, domains }]] of cases.entries()) {
    for (const [ti, [tname, tolerance]] of [['default', intersectionTolerance()], ['loose', intersectionTolerance({ linear: 1e-5, angular: 1e-8 })]].entries()) {
      for (const [bi, budget] of [real(0), real(1e-6)].entries()) {
        if (!full && (c + ti + 2 * bi) % 4 !== 0 && !(ti === 0 && bi === 0)) continue;
        if (full) console.error(`# ${name} ${tname} budget ${num(budget)} (${compared} so far)`);
        const prepared = K.prepare(solid, domains, tolerance, budget);
        for (const [i, p] of points(solid, full ? 700 : 260, compared + 17).entries()) {
          if (!full && i % 4 !== c % 4) continue;
          const point = vector(p);
          const want = S.classify(solid, domains, point, tolerance, budget);
          const got = K.classify(prepared, point);
          if (!same(want, got)) assert.fail(`${name} ${tname} budget ${num(budget)} point ${JSON.stringify(p)}: S ${JSON.stringify(want)} != K ${JSON.stringify(got)}`);
          const key = want.$ === 'Unresolved' ? `Unresolved.${want.reason.$}` : want.$;
          tallies[key] = (tallies[key] ?? 0) + 1;
          compared++;
        }
      }
    }
  }
  // The comparison must cover decided, boundary and unresolved answers.
  for (const kind of ['Inside', 'Outside', 'Boundary']) assert.ok(tallies[kind] > (full ? 50 : 10), `${kind}: ${JSON.stringify(tallies)}`);
  assert.ok(Object.keys(tallies).some(k => k.startsWith('Unresolved')), JSON.stringify(tallies));
  console.log(`# ${compared} points, ${cases.length} solids: ${JSON.stringify(tallies)}`);
});

test('invalid points and budgets are refused the same way', async () => {
  const [[, { solid, domains }]] = await solids();
  const tolerance = intersectionTolerance();
  for (const budget of [real(0), real(0.5), { $: 'Real', hi: NaN, lo: 0 }]) {
    const prepared = K.prepare(solid, domains, tolerance, budget);
    for (const point of [vector([1, 2, 3]), { $: 'V3', x: { $: 'Real', hi: NaN, lo: 0 }, y: real(0), z: real(0) }, vector([1e11, 0, 0])]) {
      assert.deepEqual(K.classify(prepared, point), S.classify(solid, domains, point, tolerance, budget));
    }
  }
});

}
