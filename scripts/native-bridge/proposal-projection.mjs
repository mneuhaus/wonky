// Projection arithmetic for docs/native-bridge/proposal-functional.md.
// Every input is read from the profile and binding artifacts. The only typed
// numbers are the stated assumptions L (addon load + init) and O (per-run
// crossing plus JS codec cost), both deliberately generous.
//
//   W      mean of the two plain (uninstrumented) wall times            profile runs.json
//   T,K,B  profiled total, kernel incl. kernel-caused GC, Bend JS load   profile summary.json (attributed basis)
//   f      share of the dominant call(s) in count-run kernel time        profile summary.json calls
//   N      native in-process p50 of the same captured call               binding kernel-t1/t6.json
//          (fuse-g1 / cut-h1 were not captured: count-run ms / median measured ratio, with range)
//   s      = W / T scales profiled buckets to plain wall
//   W_nat  = s*(T - B - K) + N + s*K*(1 - f)/k_rest + L + O
//
// usage: node scripts/native-bridge/proposal-projection.mjs [--json]
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = p => JSON.parse(readFileSync(new URL(p, root)));
const S = read('out/native-bridge/profile/summary.json');
const R = read('out/native-bridge/profile/runs.json');
const K1 = read('out/native-bridge/binding/kernel-t1.json').result.cases;
const K6 = read('out/native-bridge/binding/kernel-t6.json').result.cases;

const L = 5;
const O = { 'py-planar-union': 3, 'py-planar-pocket': 3, 'py-frame-with-tab': 5, 'fs-bracket': 1,
  'fs-bored-spacer-print': 2, 'fs-fuse-g1': 3, 'fs-cut-h1': 3, 'fs-r10b-strict': 30 };
const BIG = /ports\/(planar-boolean\.bend:(union|subtract)|curved-intersection\.bend:intersect)$/;
const CAPTURED = { 'py-planar-union': 'planar-union', 'py-planar-pocket': 'planar-pocket', 'py-frame-with-tab': 'frame-with-tab' };

const plainWall = id => {
  const rows = (R.runs.plain[id]?.runs ?? []).map(r => r.wallMs);
  return rows.reduce((a, b) => a + b, 0) / rows.length;
};
const loadRange = id => {
  const rows = R.runs.plain[id]?.runs ?? [];
  const ones = rows.flatMap(r => [r.loadBefore?.one, r.loadAfter?.one]).filter(Number.isFinite);
  return [Math.min(...ones), Math.max(...ones)];
};
const nativeSum = (cases, name) => cases.filter(c => c.case === name).reduce((a, c) => a + c.native.p50, 0);
const jsSum = (cases, name) => cases.filter(c => c.case === name).reduce((a, c) => a + c.js.p50, 0);

// Measured native/count-run ratios on the three captured cases give the extrapolation for fuse-g1 / cut-h1.
const ratio = { t1: [], t6: [] };
const rows = [];
for (const [id, w] of Object.entries(S.workloads)) {
  const a = w.projections.attributed;
  const entries = w.calls.entries ?? [];
  const countKernel = entries.reduce((s, e) => s + e.ms, 0);
  const big = entries.filter(e => BIG.test(e.entry ?? e.name));
  const bigMs = big.reduce((s, e) => s + e.ms, 0);
  rows.push({ id, W: plainWall(id), load: loadRange(id), T: a.totalMs, K: a.kernelMs, B: a.bendLoadMs,
    countKernel, bigMs, bigEntries: big.map(e => `${(e.entry ?? e.name).split('/').pop()} x${e.calls}`),
    captured: CAPTURED[id] });
  if (CAPTURED[id]) {
    ratio.t1.push(bigMs / nativeSum(K1, CAPTURED[id]));
    ratio.t6.push(bigMs / nativeSum(K6, CAPTURED[id]));
  }
}
const med = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const r1 = { med: med(ratio.t1), lo: Math.min(...ratio.t1), hi: Math.max(...ratio.t1) };
const r6 = { med: med(ratio.t6), lo: Math.min(...ratio.t6), hi: Math.max(...ratio.t6) };

const out = [];
for (const r of rows) {
  const s = r.W / r.T;
  const stay = s * (r.T - r.B - r.K);
  const f = r.countKernel > 0 ? r.bigMs / r.countKernel : 0;
  const rest = s * r.K * (1 - f);
  const curved = r.bigEntries.some(e => e.startsWith('curved-intersection'));
  let N1, N6, N1range = null, source;
  if (r.captured) { N1 = nativeSum(K1, r.captured); N6 = nativeSum(K6, r.captured); source = 'measured (binding kernel-t1/t6)'; }
  else if (r.bigMs > 0) {
    N1 = r.bigMs / r1.med; N6 = r.bigMs / r6.med; N1range = [r.bigMs / r1.hi, r.bigMs / r1.lo];
    source = curved ? 'hypothetical: not emittable natively (arity > 255)' : 'extrapolated: count-run ms / median measured ratio';
  } else { N1 = N6 = 0; source = 'no dominant call'; }
  const o = O[r.id];
  const nat = (N, kRest) => stay + N + rest / kRest + L + o;
  const row = {
    id: r.id, W: r.W, load: r.load, T: r.T, K: r.K, B: r.B, s, stay, f, rest, bigMs: r.bigMs, bigEntries: r.bigEntries,
    N1, N6, N1range, source, L, O: o,
    t1: { wall: nat(N1, r1.med), speedup: r.W / nat(N1, r1.med) },
    t1pess: { wall: nat(N1, 1), speedup: r.W / nat(N1, 1) },
    t6: { wall: nat(N6, r1.med), speedup: r.W / nat(N6, r1.med) },
    t1range: N1range ? N1range.map(n => r.W / nat(n, r1.med)).reverse() : null,
    firstRunAfterRebuild: { wall: nat(N1, r1.med) + 287, speedup: r.W / (nat(N1, r1.med) + 287) },
    // JS kernel still loaded, only the dominant call native (migration step 1 variant)
    bigOnly: { wall: s * (r.T - r.K) + N1 + rest + L + o, speedup: r.W / (s * (r.T - r.K) + N1 + rest + L + o) },
  };
  out.push(row);
}

if (process.argv.includes('--json')) { console.log(JSON.stringify({ L, O, ratio: { r1, r6, t1: ratio.t1, t6: ratio.t6 }, rows: out }, null, 2)); }
else {
  const f = (x, d = 1) => x.toFixed(d);
  console.log(`median native ratio vs count-run JS ms: 1 thread ${f(r1.med, 2)} (${f(r1.lo, 2)}-${f(r1.hi, 2)}), 6 threads ${f(r6.med, 2)} (${f(r6.lo, 2)}-${f(r6.hi, 2)})`);
  console.log('| workload | W plain ms | load | stays in JS ms | dominant JS ms | N native 1t / 6t ms | rest ms | W_nat 1t ms | S 1t | S 1t pess. | S 6t | first run after rebuild | only dominant call native |');
  for (const r of out) {
    console.log(`| ${r.id} | ${f(r.W, 0)} | ${f(r.load[0], 2)}-${f(r.load[1], 2)} | ${f(r.stay)} | ${f(r.bigMs)} | ${f(r.N1)} / ${f(r.N6)} | ${f(r.rest)} | ${f(r.t1.wall)} | ${f(r.t1.speedup, 2)}x${r.t1range ? ` (${f(r.t1range[0], 2)}-${f(r.t1range[1], 2)})` : ''} | ${f(r.t1pess.speedup, 2)}x | ${f(r.t6.speedup, 2)}x | ${f(r.firstRunAfterRebuild.speedup, 2)}x | ${f(r.bigOnly.speedup, 2)}x | ${r.source}`);
  }
}
