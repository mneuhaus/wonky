#!/usr/bin/env node
// End-to-end projections for docs/native-bridge/proposal-resident.md.
//
// Inputs are measured artifacts only:
//   out/native-bridge/profile/summary.json         (per-workload buckets, attributed basis, count-run calls)
//   out/native-bridge/binding/kernel-t{1,6}.json   (the captured planar Boolean calls, native in-process vs JS target)
// Everything that is not measured is an explicit, named assumption in ASSUMPTIONS and
// is echoed into the output. Nothing here runs a kernel; it only combines measurements.
//
//   node scripts/native-bridge/resident-projection.mjs            # writes out/native-bridge/resident/projection.json, prints tables
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const json = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const summary = json('out/native-bridge/profile/summary.json');
const kernelRuns = { t1: json('out/native-bridge/binding/kernel-t1.json').result, t6: json('out/native-bridge/binding/kernel-t6.json').result };

const ASSUMPTIONS = {
  // Not measured for a full-kernel addon. The planar-only addon (2.1 MB) loaded in 0.73 ms warm;
  // the probe in 0.65-0.87 ms. The sensitivity column uses 20 ms.
  addonLoadMs: 1, addonLoadMsPessimistic: 20,
  // Loader stale check. Upper bound measured by scripts/native-bridge/stale-check-cost.mjs (all 72 kernel
  // files, 0.88 MB): 1.4-1.6 ms median, 3.2-4.4 ms first run at load ~13-14. 5 ms is used here.
  staleCheckMs: 5,
  // Non-Boolean kernel calls (audits, measures, identity, residuals, pcurves) have no native timing.
  // Central case: same speedup as the workload's Boolean calls. Pessimistic: no speedup at all.
  restSpeedupPessimistic: 1,
  // Workloads without planar Boolean calls (bracket, bored-spacer): midpoint of the measured per-call
  // planar k (8.3-9.7). Affects only their 2.5 and 38 ms of kernel time.
  restSpeedupNoBoolean: 9,
};

// k per captured call = JS-target p50 / native p50, same process, same inputs, bit-exact results.
const captured = {
  'py-planar-union': [['planar-union', 0]],
  'py-planar-pocket': [['planar-pocket', 0]],
  'py-frame-with-tab': [['frame-with-tab', 0], ['frame-with-tab', 1]],
};
const row = (threads, name, call) => kernelRuns[threads].cases.find(c => c.case === name && c.call === call);
const jsP50 = (name, call) => row('t1', name, call).js.p50; // JS target timed once, in the t1 run
function measuredK(threads, calls) {
  const js = calls.reduce((s, [n, c]) => s + jsP50(n, c), 0);
  const nat = calls.reduce((s, [n, c]) => s + row(threads, n, c).native.p50, 0);
  return js / nat;
}
function boundary(calls) { // measured encode + decode on the JS side per captured call (t1 run)
  return calls.reduce((s, [n, c]) => s + row('t1', n, c).encodeMs + row('t1', n, c).decodeMs, 0);
}
const allCalls = Object.values(captured).flat();
const perCallK = threads => allCalls.map(([n, c]) => ({ n, c, op: row('t1', n, c).operation, k: jsP50(n, c) / row(threads, n, c).native.p50 }));
const kRange = (threads, op) => { const ks = perCallK(threads).filter(x => x.op === op).map(x => x.k); return [Math.min(...ks), Math.max(...ks)]; };
const maxBoundaryPerCall = Math.max(...allCalls.map(([n, c]) => boundary([[n, c]])));

const booleanEntry = /ports\/planar-boolean\.bend:(union|subtract)$/;
const workloads = [];
for (const [id, w] of Object.entries(summary.workloads)) {
  const a = w.projections.attributed;
  const T = a.totalMs, K = a.kernelMs, B = a.bendLoadMs, S = a.startupMs, O = a.bindingOverheadEstimateMs;
  const plain = w.runs.plain.map(r => r.wallMs).sort((x, y) => x - y);
  const plainMedian = plain.reduce((s, v) => s + v, 0) / plain.length;
  const entries = w.calls.entries ?? [];
  const boolCalls = entries.filter(e => booleanEntry.test(e.name));
  const boolMs = boolCalls.reduce((s, e) => s + e.ms, 0), boolCount = boolCalls.reduce((s, e) => s + e.calls, 0);
  const shareBool = boolMs / w.calls.kernelInclusiveMs;
  const blocked = entries.some(e => /curved-intersection\.bend:intersect$/.test(e.name));
  let k1, k6, kSource;
  if (captured[id]) { k1 = [measuredK('t1', captured[id]), measuredK('t1', captured[id])]; k6 = [measuredK('t6', captured[id]), measuredK('t6', captured[id])]; kSource = 'measured on this workload\'s captured calls'; }
  else if (boolCount) {
    const ops = [...new Set(boolCalls.map(e => e.name.endsWith('union') ? 'union' : 'subtract'))];
    const r = th => ops.map(op => kRange(th, op)).reduce(([lo, hi], [l, h]) => [Math.min(lo, l), Math.max(hi, h)], [Infinity, -Infinity]);
    k1 = r('t1'); k6 = r('t6'); kSource = `range of measured ${ops.join('/')} calls on other inputs (extrapolated)`;
  } else { k1 = null; k6 = null; kSource = 'no Boolean calls; kernel share negligible'; }
  const boundaryMs = captured[id] ? boundary(captured[id]) : boolCount * maxBoundaryPerCall;
  const out = { id, T, K, B, S, O, plainMedian, shareBool, boolCount, kSource, k1, k6, blocked };
  const speed = t => T / t, wall = t => plainMedian * t / T;
  // Kernel time after the move: Boolean part / kBool + rest / kRest.
  const kPrime = (kBool, kRest) => kBool ? K * (shareBool / kBool + (1 - shareBool) / kRest) : K / kRest;
  const scen = (label, kBool, kRestCentral) => {
    if (blocked) return { label, blocked: true };
    const kc = kBool ?? 1;
    // S1: only the planar Boolean calls move to the addon (fine-grained, JS kernel still loaded).
    const s1 = boolCount ? T - K * shareBool + K * shareBool / kc + boundaryMs + ASSUMPTIONS.addonLoadMs : T;
    // S3: every production kernel entry native, JS kernel never loaded.
    const s3 = rest => T - K - B + kPrime(kBool, rest) + ASSUMPTIONS.addonLoadMs + ASSUMPTIONS.staleCheckMs + O;
    const s3c = s3(kRestCentral ?? kc), s3p = s3(ASSUMPTIONS.restSpeedupPessimistic) + ASSUMPTIONS.addonLoadMsPessimistic - ASSUMPTIONS.addonLoadMs;
    // Resident session: startup already paid (viewer, review server, test runner).
    const U = T - S, res = U - K + kPrime(kBool, kRestCentral ?? kc) + O;
    return { label, kBool, s1: { ms: s1, speedup: speed(s1), wallMs: wall(s1) },
      s3: { ms: s3c, speedup: speed(s3c), wallMs: wall(s3c) }, s3Pessimistic: { ms: s3p, speedup: speed(s3p), wallMs: wall(s3p) },
      resident: { jsMs: U, ms: res, speedup: U / res } };
  };
  out.scenarios = [];
  for (const [label, ks, rest] of [['t1 low', k1, k1?.[0]], ['t1 high', k1, k1?.[1]], ['t6 low', k6, k1?.[0]], ['t6 high', k6, k1?.[1]]]) {
    const kb = ks ? (label.endsWith('low') ? ks[0] : ks[1]) : null;
    out.scenarios.push(scen(label, kb, rest ?? (captured[id] || boolCount ? undefined : ASSUMPTIONS.restSpeedupNoBoolean)));
  }
  workloads.push(out);
}

const report = { schema: 'wonky-resident-projection/1', generatedBy: 'scripts/native-bridge/resident-projection.mjs',
  inputs: ['out/native-bridge/profile/summary.json', 'out/native-bridge/binding/kernel-t1.json', 'out/native-bridge/binding/kernel-t6.json'],
  assumptions: ASSUMPTIONS, perCallK: { t1: perCallK('t1'), t6: perCallK('t6') }, maxBoundaryPerCallMs: maxBoundaryPerCall,
  loadDuringInputs: { profile: '11.6-14.7', binding: kernelRuns.t1.loadBefore.concat(kernelRuns.t6.loadAfter) }, workloads };
mkdirSync(new URL('out/native-bridge/resident/', root), { recursive: true });
writeFileSync(new URL('out/native-bridge/resident/projection.json', root), JSON.stringify(report, null, 2) + '\n');

const f = (v, d = 1) => v == null ? '-' : v.toFixed(d);
const span = (a, b, d = 0) => Math.abs(a - b) < 0.5 * 10 ** -d ? f(a, d) : `${f(Math.min(a, b), d)}-${f(Math.max(a, b), d)}`;
console.log('per-call k (JS p50 / native p50):', report.perCallK.t1.map(x => `${x.n}#${x.c} ${x.op} t1 ${f(x.k, 2)}`).join('; '));
console.log('                                  ', report.perCallK.t6.map(x => `${x.n}#${x.c} t6 ${f(x.k, 2)}`).join('; '));
console.log('\n| workload | T ms | K | B | Boolean share of K | k (t1) | S1 t1 | S3 t1 | S3 t6 | S3 pessimistic | resident t1 | resident t6 | S3 t1 indicative wall ms (plain median) |');
console.log('|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|');
for (const w of workloads) {
  if (w.blocked) { console.log(`| ${w.id} | ${f(w.T, 0)} | ${f(w.K, 0)} | ${f(w.B, 0)} | ${f(100 * w.shareBool)} % (curved) | - | blocked | blocked | blocked | blocked | blocked | blocked | - |`); continue; }
  const [lo, hi, lo6, hi6] = w.scenarios;
  const rng = (a, b, pick) => { const x = pick(a), y = pick(b); return Math.abs(x - y) < 0.05 ? `${f(x, 2)}x` : `${f(Math.min(x, y), 2)}-${f(Math.max(x, y), 2)}x`; };
  console.log(`| ${w.id} | ${f(w.T, 0)} | ${f(w.K, 0)} | ${f(w.B, 0)} | ${f(100 * w.shareBool)} % | ${w.k1 ? (w.k1[0] === w.k1[1] ? f(w.k1[0], 2) : `${f(w.k1[0], 2)}-${f(w.k1[1], 2)}`) : '-'} | ` +
    `${rng(lo, hi, s => s.s1.speedup)} | ${rng(lo, hi, s => s.s3.speedup)} | ${rng(lo6, hi6, s => s.s3.speedup)} | ${rng(lo, hi, s => s.s3Pessimistic.speedup)} | ` +
    `${rng(lo, hi, s => s.resident.speedup)} | ${rng(lo6, hi6, s => s.resident.speedup)} | ${f(w.plainMedian, 0)} -> ${span(lo.s3.wallMs, hi.s3.wallMs)} (t6 ${span(lo6.s3.wallMs, hi6.s3.wallMs)}) |`);
}

// Worked arithmetic, so the proposal shows every term instead of a bare ratio.
console.log('\nWorked arithmetic (attributed profile basis, central case t1 low):');
for (const w of workloads.filter(x => !x.blocked)) {
  const s = w.scenarios[0], kb = s.kBool, rest = kb ?? ASSUMPTIONS.restSpeedupNoBoolean;
  const keep = w.T - w.K - w.B, kNative = kb ? w.K * (w.shareBool / kb + (1 - w.shareBool) / rest) : w.K / rest;
  console.log(`- ${w.id}: T ${f(w.T)}; stays in JS T-K-B = ${f(w.T)} - ${f(w.K)} - ${f(w.B)} = ${f(keep)}; ` +
    `native kernel K' = ${f(w.K)} x (${f(w.shareBool, 3)}/${f(kb ?? rest, 2)} + ${f(1 - w.shareBool, 3)}/${f(rest, 2)}) = ${f(kNative)}; ` +
    `+ addon load ${ASSUMPTIONS.addonLoadMs} + stale check ${ASSUMPTIONS.staleCheckMs} + boundary O ${f(w.O, 2)} ` +
    `=> S3 ${f(s.s3.ms)} ms, ${f(s.s3.speedup, 2)}x; S1 (JS kernel kept) ${f(s.s1.ms)} ms, ${f(s.s1.speedup, 2)}x; ` +
    `resident U ${f(s.resident.jsMs)} -> ${f(s.resident.ms)} ms, ${f(s.resident.speedup, 2)}x`);
}
