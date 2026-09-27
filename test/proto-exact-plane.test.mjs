import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("proto-exact-plane.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { default: fs } = await import("node:fs");
const { default: path } = await import("node:path");
const { loadBend } = await import("../src/bend-loader.mjs");
const { ensureJobs, ROOT } = await import("../scripts/bakeoff/fixtures.mjs");
const { validateResult } = await import("../scripts/bakeoff/validate.mjs");
// Bake-off prototype "exact-plane" (kernel/proto/exact-plane, docs/proto-exact-plane.md):
// exact integer arithmetic against BigInt, the filtered plane-side predicate
// against exact determinants (including constructed zeros), and end-to-end
// Booleans on the Bend JavaScript target, validated by the bake-off validator
// and compared with the manifold3d oracle. Runs in about 20-30 s.








const G = await loadBend('kernel/proto/exact-plane/geom.bend');
const EP = await loadBend('kernel/proto/exact-plane/main.bend');
const D = await loadBend('kernel/proto/exact-plane/device.bend');

const NIL = { $: 'Nil' };
const list = (xs) => xs.reduceRight((tail, head) => ({ $: 'Con', head, tail }), NIL);
const items = (xs) => {
  const out = [];
  for (let c = xs; c.$ === 'Con'; c = c.tail) out.push(c.head);
  return out;
};

// Big <-> BigInt (16-bit limbs, little endian, no top zero limb).
function toBig(v) {
  const neg = v < 0n;
  let m = neg ? -v : v;
  const limbs = [];
  while (m > 0n) {
    limbs.push(Number(m & 0xffffn));
    m >>= 16n;
  }
  return { $: 'Big', neg: neg && limbs.length > 0, mag: list(limbs) };
}
function fromBig(b) {
  const limbs = items(b.mag);
  assert.ok(limbs.length === 0 || limbs.at(-1) !== 0, 'no most-significant zero limb');
  assert.ok(!(b.neg && limbs.length === 0), 'zero is never negative');
  let v = 0n;
  for (let i = limbs.length - 1; i >= 0; i--) v = (v << 16n) + BigInt(limbs[i]);
  return b.neg ? -v : v;
}

// Deterministic pseudo-random numbers (mulberry32).
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20260922);
function randBig(bits) {
  let v = 0n;
  const n = Math.floor(rand() * (bits + 1));
  for (let i = 0; i < n; i += 16) v = (v << 16n) | BigInt(Math.floor(rand() * 65536));
  v &= (1n << BigInt(n)) - 1n;
  return rand() < 0.5 ? -v : v;
}
const sgn = (v) => (v > 0n ? 'Gt0' : v < 0n ? 'Lt0' : 'Eq0');
const sideSign = (s) => ({ FNeg: -1, XNeg: -1, XZero: 0, SZero: 0, FPos: 1, XPos: 1 })[s.$];

test('Big arithmetic agrees with BigInt (add, sub, mul, cmp, floor division)', () => {
  for (let i = 0; i < 400; i++) {
    const a = randBig(340);
    const b = randBig(340);
    assert.equal(fromBig(G['big.add'](toBig(a), toBig(b))), a + b);
    assert.equal(fromBig(G['big.sub'](toBig(a), toBig(b))), a - b);
    assert.equal(fromBig(G['big.mul'](toBig(a), toBig(b))), a * b);
    assert.equal(G['big.sign'](toBig(a * b)).$, sgn(a * b));
    const c = G['big.cmp'](toBig(a), toBig(b)).$;
    assert.equal(c, a < b ? 'LT' : a > b ? 'GT' : 'EQ');
    // floor(n / d) for d > 0 with |n| < d 2^(k+1).
    const d = (b < 0n ? -b : b) + 1n;
    const n = randBig(60) * d + randBig(20);
    const k = 64;
    const want = n >= 0n ? n / d : -((-n + d - 1n) / d);
    assert.equal(fromBig(G['big.floor_div'](toBig(n), toBig(d), k)), want, `floor(${n} / ${d})`);
  }
});

// Exact side of plane (a, b, c, d) at homogeneous point (x, y, z, w).
const exactSide = (p, v) => p[0] * v[0] + p[1] * v[1] + p[2] * v[2] + p[3] * v[3];
const gridPt = (x, y, z) => G.point(toBig(x), toBig(y), toBig(z));
const planeOf = (pl) => [pl.a, pl.b, pl.c, pl.d].map(fromBig);
const vtxOf = (v) => [v.x, v.y, v.z, v.w].map(fromBig);
const R34 = () => BigInt(Math.floor((rand() * 2 - 1) * 2 ** 34));

test('filtered plane-side predicate is exact on random, near-degenerate and constructed-zero inputs', () => {
  let filtered = 0;
  let total = 0;
  for (let i = 0; i < 300; i++) {
    const p = [R34(), R34(), R34()];
    const q = [R34(), R34(), R34()];
    const r = [R34(), R34(), R34()];
    const pl = G.plane3(gridPt(...p), gridPt(...q), gridPt(...r));
    // A point exactly on the plane (integer combination), a random point,
    // and a point one grid unit off the plane (tiny nonzero values).
    const a = BigInt(Math.floor(rand() * 5) - 2);
    const b = BigInt(Math.floor(rand() * 5) - 2);
    const on = p.map((x, j) => x + a * (q[j] - x) + b * (r[j] - x));
    const off = [on[0] + 1n, on[1], on[2]];
    for (const s of [on, [R34(), R34(), R34()], off]) {
      if (s.some((x) => x >= 2n ** 35n || x <= -(2n ** 35n))) continue;
      const v = gridPt(...s);
      const got = G.side(pl, v);
      const want = exactSide(planeOf(pl), vtxOf(v));
      assert.equal(sideSign(got), want > 0n ? 1 : want < 0n ? -1 : 0);
      total++;
      if (got.$ === 'FNeg' || got.$ === 'FPos') filtered++;
    }
    // The meet of three planes lies on all three (exact zeros) and the side
    // of a fourth plane matches the determinant.
    const pl2 = G.plane3(gridPt(...q), gridPt(R34(), R34(), R34()), gridPt(...r));
    const pl3 = G.plane3(gridPt(R34(), R34(), R34()), gridPt(...p), gridPt(R34(), R34(), R34()));
    const m = G.meet(pl, pl2, pl3);
    if (G.degenerate(m)) continue;
    for (const x of [pl, pl2, pl3]) assert.equal(G.side(x, m).$, 'XZero');
    // With input-plane ids the same zeros are known by construction.
    const [q1, q2, q3] = [G.with_id(pl, 4 * i), G.with_id(pl2, 4 * i + 1), G.with_id(pl3, 4 * i + 2)];
    const mi = G.meet(q1, q2, q3);
    for (const x of [q1, q2, q3, G.plane_neg(q2)]) assert.equal(G.side(x, mi).$, 'SZero');
    assert.deepEqual(vtxOf(mi), vtxOf(m));
    const pl4 = G.plane3(gridPt(R34(), R34(), R34()), gridPt(R34(), R34(), R34()), gridPt(R34(), R34(), R34()));
    const want = exactSide(planeOf(pl4), vtxOf(m));
    assert.equal(sideSign(G.side(pl4, m)), want > 0n ? 1 : want < 0n ? -1 : 0);
    assert.ok(fromBig(m.w) > 0n, 'homogeneous W > 0');
  }
  assert.ok(filtered / total > 0.5, `filter decided ${filtered}/${total}`);
});

test('device pair filter only certifies pairs that are exactly disjoint (never touching or coplanar ones)', () => {
  const vi = { $: 'VI', a: 0, b: 1, c: 2 };
  const tri = (id, a, b, c) => D['setup.mk_tri'](id, 0, 0, gridPt(...a), gridPt(...b), gridPt(...c), vi);
  const R20 = () => BigInt(Math.floor((rand() * 2 - 1) * 2 ** 20));
  const pt = () => [R20(), R20(), R20()];
  const signs = (t, pts) => pts.map((p) => exactSide(planeOf(t.s), [...p, 1n])).map((x) => (x > 0n ? 1 : x < 0n ? -1 : 0));
  const strict = (s) => s[0] !== 0 && s.every((x) => x === s[0]);
  let certified = 0;
  let touching = 0;
  for (let i = 0; i < 400; i++) {
    const [p, q, r] = [pt(), pt(), pt()];
    const t = tri(0, p, q, r);
    if (G.bzero(G.normal_of(t.s))) continue;
    // b: random; sharing a vertex with t; with a vertex exactly on t's plane;
    // coplanar with t.
    const on = () => {
      const a = BigInt(Math.floor(rand() * 7) - 3);
      const b = BigInt(Math.floor(rand() * 7) - 3);
      return p.map((x, j) => x + a * (q[j] - x) + b * (r[j] - x));
    };
    const shift = [BigInt(2 ** 21), 0n, 0n];
    const far = () => pt().map((x, j) => x + shift[j]);
    const bs = [[pt(), pt(), pt()], [p, far(), far()], [on(), far(), far()], [on(), on(), on()], [far(), far(), far()]];
    for (const [k, [a, b, c]] of bs.entries()) {
      if ([a, b, c].some((v) => v.some((x) => x >= 2n ** 34n || x <= -(2n ** 34n)))) continue;
      const u = tri(1, a, b, c);
      if (G.bzero(G.normal_of(u.s))) continue;
      const code = D.code(D.ft_of(t), D.ft_of(u));
      const disjoint = strict(signs(t, [a, b, c])) || strict(signs(u, [p, q, r]));
      // A shared vertex or a coplanar pair can never be certified (zeros).
      if (k === 1 || k === 3) {
        touching++;
        assert.equal(code, 0, `touching pair ${k} certified disjoint`);
      }
      if (code === 1) {
        certified++;
        assert.ok(disjoint, 'certified pair is exactly disjoint');
      }
    }
  }
  assert.ok(certified > 100 && touching > 200, `certified ${certified}, touching ${touching}`);
});

test('quantization rounds to the 2^-24 mm grid and export rounding is the floor on 2^-36 mm', () => {
  const real = (x) => {
    const hi = Math.fround(x);
    return { $: 'Real', hi, lo: Math.fround(x - hi) };
  };
  for (const x of [0, 1, -1, 12.345678, -1023.9999999, 0.1, 1e-9, 7.56989480098127]) {
    const r = real(x);
    const v = r.hi + r.lo;
    const q = fromBig(G.quantize(r));
    assert.ok(Math.abs(Number(q) - v * 2 ** 24) <= 0.5 + 1e-6, `${x}`);
  }
  // A homogeneous point (X, Y, Z, W): the exported coordinate is
  // floor(X 2^12 / W) 2^-36 and exact in F32x2.
  const v = G.vtx(toBig(12345678901234n), toBig(-98765432109876n), toBig(3n), toBig(7n));
  const rv = G.round_vertex(v);
  assert.equal(rv.ok, true);
  const exp = (n, w) => {
    const t = n * 4096n;
    const f = t >= 0n ? t / w : -((-t + w - 1n) / w);
    return Number(f) * 2 ** -36;
  };
  assert.equal(rv.r.x.hi + rv.r.x.lo, exp(12345678901234n, 7n));
  assert.equal(rv.r.y.hi + rv.r.y.lo, exp(-98765432109876n, 7n));
  assert.equal(rv.r.z.hi + rv.r.z.lo, exp(3n, 7n));
});

const reference = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/bakeoff/reference.json'), 'utf8')).cases;

// Small cases on the JS target: planar, coplanar, touching, rotated,
// internal void, empty result, a curved hole, the frozen r10b bodies, and a
// tangent contact that must be refused.
const CASES = [
  'box-union-overlap', 'box-subtract-overlap', 'box-coplanar-union', 'box-coplanar-subtract', 'box-touching-merge',
  'box-touching-partial', 'box-rotated-intersect', 'internal-void', 'disjoint-union', 'plate-through-hole',
  'r10b-g10-union', 'cylinder-tangent-box-face',
];

test('end-to-end Booleans on the JS target are valid, exact against manifold3d, or refused for tangent contact', () => {
  const jobs = ensureJobs(CASES);
  for (const id of CASES) {
    const text = fs.readFileSync(jobs[id].job, 'utf8');
    const out = EP.run(text);
    assert.equal(EP.run(text), out, `${id}: deterministic`);
    const v = validateResult(text, out);
    const ref = reference[id].manifold;
    if (id === 'cylinder-tangent-box-face') {
      assert.equal(v.status, 'unresolved', `${id} must be refused`);
      assert.match(v.reason, /non-manifold contact/);
      continue;
    }
    assert.equal(v.status, 'ok', `${id}: ${v.reason}`);
    // Report line after "end": the measured deviations stay within their bounds
    // (quantization <= 2^-25 mm, export rounding < 2^-36 mm).
    const info = out.slice(out.indexOf('\nend\n') + 5).trim().split(' ');
    const num = (k) => Number(info[info.indexOf(k) + 1]);
    assert.equal(info[0], 'exact-plane');
    assert.ok(num('quantization_max_fm') <= 2 ** -25 * 1e12 + 1, `${id}: quantization ${num('quantization_max_fm')} fm`);
    assert.ok(num('export_rounding_max_fm') <= 2 ** -36 * 1e12 + 1, `${id}: export rounding ${num('export_rounding_max_fm')} fm`);
    const r = v.report;
    assert.equal(r.valid, true, `${id}: ${JSON.stringify(r.issues?.slice(0, 3))}`);
    assert.equal(r.components, ref.components, `${id}: components`);
    const rel = Math.abs(r.volume - ref.volume) / Math.max(1, Math.abs(ref.volume));
    assert.ok(rel <= 1e-7, `${id}: volume ${r.volume} vs manifold3d ${ref.volume} (rel ${rel})`);
  }
});

test('self-subtract gives the empty mesh', () => {
  const jobs = ensureJobs(['self-subtract']);
  const out = EP.run(fs.readFileSync(jobs['self-subtract'].job, 'utf8'));
  assert.ok(out.startsWith('ok\nmesh 0 0\nend\nexact-plane '), out.slice(0, 80));
});

test('malformed input and coordinates outside the quantization box are refused with a reason', () => {
  assert.match(EP.run('wonky-bakeoff-job 1\ncase x\n'), /^unresolved malformed-job/);
  const jobs = ensureJobs(['box-union-overlap']);
  const text = fs.readFileSync(jobs['box-union-overlap'].job, 'utf8');
  // Scale every vertex of the first leaf by 2^11 (hi words only): far outside +-1024 mm.
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.startsWith('mesh '));
  const nv = Number(lines[start].split(' ')[2]);
  const f32 = new Float32Array(1);
  const u32 = new Uint32Array(f32.buffer);
  for (let i = start + 1; i <= start + nv; i++) {
    const w = lines[i].split(' ').map(Number);
    for (let j = 0; j < 6; j += 2) {
      u32[0] = w[j];
      f32[0] *= 2048;
      w[j] = u32[0];
    }
    lines[i] = w.join(' ');
  }
  assert.match(EP.run(lines.join('\n')), /^unresolved exact-plane: coordinates outside the \+-1024 mm quantization box/);
});

}
