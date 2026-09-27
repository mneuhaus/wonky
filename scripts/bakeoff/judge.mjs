#!/usr/bin/env node
// Boolean bake-off TEST INFRASTRUCTURE (judge): turns the judge's run.mjs
// reports (out/bakeoff/judge/<proto>/...) and recover checks into the
// markdown tables of docs/bakeoff.md "Results" and a machine-readable
// out/bakeoff/judge/results.json. Every number comes from a report file; it
// computes no geometry.
//
//   node scripts/bakeoff/judge.mjs [--judge out/bakeoff/judge] [--out <dir>]
//
// --out writes results.md / results.json there instead of the judge dir.
// Cases on which OCCT and manifold3d disagree are scored with the oracle
// arbitration (fixtures/bakeoff/arbiter.json, scripts/bakeoff/arbiter.mjs);
// the "Oracle arbitration" table counts the disputes of every suite and the
// ones without an arbiter entry ("unarbitrated").

import fs from 'node:fs';
import path from 'node:path';
import { arbiterFor, loadArbiter, oracleDispute } from './arbiter.mjs';
import { ROOT, loadCases } from './fixtures.mjs';
import { compare, tier, verdictOf } from './run.mjs';

const argv = process.argv.slice(2);
const J = path.resolve(argv.includes('--judge') ? argv[argv.indexOf('--judge') + 1] : path.join(ROOT, 'out/bakeoff/judge'));
const OUT = argv.includes('--out') ? path.resolve(argv[argv.indexOf('--out') + 1]) : J;
const ARBITER = loadArbiter();
const MESH = ['corefine', 'exact-plane', 'sdf'];
const SUITES = ['adv-corefine', 'adv-exact-plane', 'adv-sdf', 'adv-recover'];
const rel = (p) => path.relative(ROOT, p);
const load = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null);
const e1 = (x) => (x === null || x === undefined || Number.isNaN(x) ? '-' : x === 0 ? '0' : x.toExponential(1));
const f0 = (x) => (x === null || x === undefined ? '-' : x < 10 ? x.toFixed(1) : x.toFixed(0));
const f2 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? '-' : x.toFixed(2));
const geo = (xs) => (xs.length ? Math.exp(xs.reduce((s, x) => s + Math.log(x), 0) / xs.length) : null);
const ms = (r, t) => {
  const x = r?.targets?.[t];
  if (!x) return null;
  if (x.outcome !== 'ran') return x.outcome;
  return t === 'js' ? (x.timing.computeMs ?? x.timing.totalMs) : x.timing.computeMs;
};
const num = (r, t) => (typeof ms(r, t) === 'number' ? ms(r, t) : null);

// Re-score a stored case with the current scorer (run.mjs compare/verdictOf),
// so reports written before a scoring change are judged by the same rules.
// A reference is used only if the run accepted it (its job hash matched); the
// arbiter entry only if it was computed for that same job.
// `unarbitratedVerdict` is the verdict without the arbitration, to show what
// the arbitration changed.
function rescore(c, reference) {
  if (!c.report) return c;
  const ref = c.comparison ? reference?.cases?.[c.id] : null;
  const arb = ref ? arbiterFor(ARBITER, c.id, ref.jobSha256) : null;
  const score = (a) => {
    const comparison = ref ? compare(c.report, ref, a) : c.comparison;
    let verdict = verdictOf(c.expect, c.status, c.report, comparison);
    if (c.targetsAgree === false && verdict === 'pass') verdict = 'mismatch';
    return { comparison, verdict };
  };
  const { comparison, verdict } = score(arb);
  return { ...c, comparison, tier: tier(comparison), verdict, storedVerdict: c.verdict, unarbitratedVerdict: arb ? score(null).verdict : verdict, arbiter: arb ? { decision: arb.decision, class: arb.class } : null };
}

// Merge a native report (cpu1, cpuN, metal) and a JS report of the same
// cases; `reference` re-scores both.
function merged(native, js, reference) {
  if (!native && !js) return null;
  const base = native ?? js;
  const byId = new Map((native && js ? js.cases : []).map((c) => [c.id, c]));
  return base.cases.map((c0) => {
    const c = reference ? rescore(c0, reference) : c0;
    const j = byId.get(c.id);
    const m = { ...c, targets: { ...c.targets } };
    if (j?.targets?.js) {
      m.targets.js = j.targets.js;
      const a = c.targets.cpu1?.resultSha256, b = j.targets.js.resultSha256;
      m.jsAgrees = a && b ? a === b : null;
    }
    m.allTargetsAgree = c.targetsAgree !== false && m.jsAgrees !== false;
    return m;
  });
}

// Oracle disputes of one case set (OCCT and manifold3d disagree on shells or
// on the volume beyond OCCT area x deviation) and how each is arbitrated.
function arbitration(cases, reference) {
  const rows = [];
  for (const c of cases) {
    const ref = reference?.cases?.[c.id];
    const why = oracleDispute(ref);
    if (!why) continue;
    const arb = arbiterFor(ARBITER, c.id, ref.jobSha256);
    rows.push({ id: c.id, dispute: why, decision: arb?.decision ?? 'UNARBITRATED', class: arb?.class ?? null });
  }
  return rows;
}
const counts = (rows, key = 'verdict') => rows.reduce((m, r) => ({ ...m, [r[key]]: (m[r[key]] ?? 0) + 1 }), {});
const countStr = (m) => Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ');
const WRONG = ['invalid', 'mismatch'];

const corpusCases = loadCases();
const out = { judge: rel(J), corpus: {}, adversarial: {}, recover: {} };
const L = [];

// ---------------------------------------------------------------------------
// Corpus
const corpusRef = load(path.join(ROOT, "fixtures/bakeoff/reference.json"));
const corpus = {};
// The interleaved timing run (tmp/judge2/interleave.mjs: one case at a time,
// every prototype in turn, quiet machine) is preferred; the sequential run
// stays as a determinism cross-check (same result bytes).
const sameBytes = (a, b) => {
  if (!a || !b) return null;
  const m = new Map(b.cases.map((c) => [c.id, c.targets.cpu1?.resultSha256]));
  return a.cases.filter((c) => c.targets.cpu1?.resultSha256 && c.targets.cpu1.resultSha256 === m.get(c.id)).length;
};
out.determinism = {};
for (const p of MESH) {
  const inter = load(path.join(J, p, 'corpus-native-interleaved/report.json'));
  const seq = load(path.join(J, p, 'corpus-native/report.json'));
  const js = load(path.join(J, p, 'corpus-js/report.json'));
  corpus[p] = { rows: merged(inter ?? seq, js, corpusRef), timingSource: inter ? 'corpus-native-interleaved' : 'corpus-native' };
  out.determinism[p] = { sameCpu1BytesAcrossRuns: sameBytes(inter, seq), cases: (inter ?? seq)?.cases.length };
}

L.push('### Corpus leaderboard (38 cases, all four targets)', '');
L.push('| prototype | pass | expected refusal | unresolved | invalid | mismatch | error / timeout | exact tier (<= 1e-7 vs manifold3d) | max vol rel err vs manifold3d | max vol err / (OCCT area x dev) | bbox within 2 dev of manifold3d | all 4 targets byte-identical |');
L.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const p of MESH) {
  const rows = corpus[p].rows;
  if (!rows) { L.push(`| ${p} | not run |||||||||||`); continue; }
  const c = counts(rows);
  const scored = rows.filter((r) => r.comparison && r.verdict === 'pass' && r.report?.triangles > 0);
  const maxRel = Math.max(0, ...scored.map((r) => r.comparison.volumeRelErrVsManifold ?? 0));
  const maxRatio = Math.max(0, ...scored.filter((r) => r.comparison.analyticBound > 0).map((r) => r.comparison.volumeAbsErrVsOcct / r.comparison.analyticBound));
  const bbox = scored.filter((r) => r.comparison.bboxMatch).length;
  const exact = rows.filter((r) => r.tier === 'exact' && r.verdict === 'pass').length;
  const agree = rows.filter((r) => r.allTargetsAgree).length;
  out.corpus[p] = { counts: c, exactTier: exact, maxVolRelErrVsManifold: maxRel, maxOcctBoundRatio: maxRatio, bboxOk: bbox, bboxScored: scored.length, targetsAgree: agree, cases: rows.length };
  L.push(`| ${p} | ${c.pass ?? 0} | ${c['expected-refusal'] ?? 0} | ${c.unresolved ?? 0} | ${c.invalid ?? 0} | ${c.mismatch ?? 0} | ${(c.error ?? 0) + (c.timeout ?? 0)} | ${exact} | ${e1(maxRel)} | ${f2(maxRatio)} | ${bbox}/${scored.length} | ${agree}/${rows.length} |`);
}
L.push('');

// Per category
const cats = [...new Set(corpusCases.map((c) => c.category))];
L.push('### Corpus by category (pass or expected refusal, out of the category\'s cases)', '');
L.push(`| category | cases | ${MESH.join(' | ')} |`);
L.push(`|---|---|${MESH.map(() => '---|').join('')}`);
for (const cat of cats) {
  const ids = corpusCases.filter((c) => c.category === cat).map((c) => c.id);
  const cells = MESH.map((p) => {
    const rows = (corpus[p].rows ?? []).filter((r) => ids.includes(r.id));
    const good = rows.filter((r) => r.verdict === 'pass' || r.verdict === 'expected-refusal').length;
    const bad = rows.filter((r) => !['pass', 'expected-refusal'].includes(r.verdict)).map((r) => `${r.id}: ${r.verdict}`);
    return `${good}/${ids.length}${bad.length ? ` (${bad.join('; ')})` : ''}`;
  });
  L.push(`| ${cat} | ${ids.length} | ${cells.join(' | ')} |`);
}
L.push('');

// Timing per case
L.push('### Corpus compute time per target (ms, median)', '');
const inter = MESH.some((p) => corpus[p].timingSource.endsWith('interleaved'));
L.push(`Native source: ${MESH.map((p) => `${p} \`${corpus[p].timingSource}\``).join(', ')}, median of the processes per target (\`IO.now\`, whole ms). ${inter ? `Interleaved = one case at a time, the prototypes in turn, so each case sees the same load. Result bytes of the interleaved and the sequential native run: ${MESH.map((p) => `${p} ${out.determinism[p].sameCpu1BytesAcrossRuns ?? '-'}/${out.determinism[p].cases}`).join(', ')} identical. ` : 'Sequential run: the prototypes ran at different times (see Run conditions for their load). '}JS: median of 3 warm runs after one cold run. cpu18 = \`--threads 18 --gpu off\`; metal = \`--threads 18 --gpu 1GB\`. A verdict in brackets means the case did not pass.`, '');
L.push(`| case | ${MESH.map((p) => `${p} js / cpu1 / cpu18 / metal`).join(' | ')} |${inter ? " 1-min load at the case's native runs (min-max) |" : ''}`);
L.push(`|---|${MESH.map(() => '---|').join('')}${inter ? '---|' : ''}`);
for (const c of corpusCases) {
  const cells = MESH.map((p) => {
    const r = (corpus[p].rows ?? []).find((x) => x.id === c.id);
    if (!r) return '-';
    const v = ['js', 'cpu1', 'cpuN', 'metal'].map((t) => { const x = ms(r, t); return typeof x === 'number' ? f0(x) : (x ?? '-'); }).join(' / ');
    return r.verdict === 'pass' ? v : `${v} (${r.verdict})`;
  });
  for (const p of MESH) { const r = (corpus[p].rows ?? []).find((x) => x.id === c.id); if (r) ((out.caseTimes ??= {})[p] ??= {})[c.id] = { verdict: r.verdict, js: num(r, 'js'), cpu1: num(r, 'cpu1'), cpuN: num(r, 'cpuN'), metal: num(r, 'metal'), metalPasses: r.targets.metal?.metalPasses ?? null }; }
  const loads = MESH.flatMap((p) => (corpus[p].rows ?? []).find((x) => x.id === c.id)?.loadavgRun ?? []).flatMap((x) => (x ? [x[0]] : []));
  L.push(`| ${c.id} | ${cells.join(' | ')} |${inter ? ` ${loads.length ? `${Math.min(...loads).toFixed(0)}-${Math.max(...loads).toFixed(0)}` : '-'} |` : ''}`);
}
L.push('');

// Speedups
L.push('### Parallel speed-up and Metal', '');
L.push('Over the cases each prototype passes with cpu1 compute >= 20 ms. `cpu1/cpu18` > 1 means 18 threads are faster; `metal/cpu18` > 1 means Metal is slower than the 18-thread CPU pool.', '');
L.push('| prototype | cases | sum js ms | sum cpu1 ms | sum cpu18 ms | sum metal ms | cpu1/cpu18 geo-mean (min-max) | metal/cpu18 geo-mean (min-max) | Metal passes per case | Metal failures (whole corpus) |');
L.push('|---|---|---|---|---|---|---|---|---|---|');
for (const p of MESH) {
  const all = corpus[p].rows ?? [];
  const rows = all.filter((r) => r.verdict === 'pass' && num(r, 'cpu1') >= 20);
  const sp = rows.filter((r) => num(r, 'cpuN') > 0).map((r) => num(r, 'cpu1') / num(r, 'cpuN'));
  const mt = rows.filter((r) => num(r, 'metal') !== null && num(r, 'cpuN') > 0).map((r) => num(r, 'metal') / num(r, 'cpuN'));
  const sum = (t) => rows.reduce((s, r) => s + (num(r, t) ?? 0), 0);
  const passes = [...new Set(all.map((r) => r.targets.metal?.metalPasses).filter((x) => x !== undefined && x !== null))].sort();
  const merr = all.filter((r) => r.targets.metal && r.targets.metal.outcome !== 'ran').map((r) => `${r.id} ${r.targets.metal.outcome}`);
  out.corpus[p] = { ...out.corpus[p], speedupCases: rows.length, cpu1OverCpu18Geo: geo(sp), metalOverCpu18Geo: geo(mt), sums: { js: sum('js'), cpu1: sum('cpu1'), cpuN: sum('cpuN'), metal: sum('metal') }, metalFailures: merr };
  L.push(`| ${p} | ${rows.length} | ${f0(sum('js'))} | ${f0(sum('cpu1'))} | ${f0(sum('cpuN'))} | ${f0(sum('metal'))} | ${f2(geo(sp))} (${f2(Math.min(...sp))}-${f2(Math.max(...sp))}) | ${f2(geo(mt))} (${f2(Math.min(...mt))}-${f2(Math.max(...mt))}) | ${passes.join(', ')} | ${merr.join('; ') || 'none'} |`);
}
L.push('');

const m8 = load(path.join(J, 'sdf/corpus-metal-8gb/report.json'));
if (m8) {
  const sdfRows = corpus.sdf.rows ?? [];
  L.push(`sdf Metal re-run with \`--gpu 8GB\` (repeat ${m8.repeat}) for the cases that ran out of the 1 GB device heap: ${m8.cases.map((c) => {
    const cpu = sdfRows.find((r) => r.id === c.id);
    return `${c.id} ${c.verdict}, metal ${f0(num(c, 'metal'))} ms vs cpu18 ${f0(num(cpu, 'cpuN'))} ms (${c.targets.metal?.metalPasses ?? '-'} pass)`;
  }).join('; ')}. Result bytes equal the CPU result: ${m8.cases.map((c) => (c.targets.metal?.resultSha256 === sdfRows.find((r) => r.id === c.id)?.targets.cpu1?.resultSha256 ? 'yes' : 'NO')).join(', ')}.`, '');
}

// Common-set totals (cases every mesh prototype passes).
const common = corpusCases.map((c) => c.id).filter((id) => MESH.every((p) => (corpus[p].rows ?? []).find((r) => r.id === id)?.verdict === 'pass'));
out.commonSet = common;
L.push(`Common set (the ${common.length} cases every mesh prototype passes), summed compute ms:`, '');
L.push('| prototype | js | cpu1 | cpu18 | metal |', '|---|---|---|---|---|');
for (const p of MESH) {
  const rows = (corpus[p].rows ?? []).filter((r) => common.includes(r.id));
  const sum = (t) => rows.reduce((s, r) => s + (num(r, t) ?? 0), 0);
  const missing = (t) => rows.filter((r) => num(r, t) === null).length;
  (out.commonSums ??= {})[p] = { js: sum('js'), cpu1: sum('cpu1'), cpuN: sum('cpuN'), metal: sum('metal'), jsMissing: missing('js'), metalMissing: missing('metal') };
  L.push(`| ${p} | ${f0(sum('js'))}${missing('js') ? ` (${missing('js')} not finished)` : ''} | ${f0(sum('cpu1'))} | ${f0(sum('cpuN'))} | ${f0(sum('metal'))}${missing('metal') ? ` (${missing('metal')} failed)` : ''} |`);
}
L.push('');

// ---------------------------------------------------------------------------
// Adversarial
const suiteSize = (s) => load(path.join(J, 'suites', s, 'cases.json'))?.cases.length ?? 0;
L.push(`### Adversarial suites (the verifiers' ${SUITES.reduce((n, s) => n + suiteSize(s), 0)} cases, all four targets)`, '');
L.push('Same runner and scorer as the corpus (`run.mjs --suite`). `invalid` = an `ok` answer whose mesh the validator rejects; `mismatch` = a valid mesh whose topology, volume or bbox disagrees with the oracles (bbox: within 2 x deviation of manifold3d); both are wrong answers. `unresolved` is an explicit refusal (safe). `error` includes Metal out-of-memory at `--gpu 1GB`. The oracle for mesh engines is manifold3d on the same tessellated leaves (topology, volume, bbox) plus OCCT (volume bound).', '');
L.push(`| suite (cases) | ${MESH.join(' | ')} |`);
L.push(`|---|${MESH.map(() => '---|').join('')}`);
const advRows = {};
// The native report of one suite run. An interrupted run is completed by a
// second run of the remaining cases (`native-rest`); cases the native runner
// could not finish at all (it crashed on them) are taken from the JS report
// and marked `nativeMissing`.
function nativeOf(p, s) {
  const a = load(path.join(J, p, s, 'native/report.json'));
  const b = load(path.join(J, p, s, 'native-rest/report.json'));
  const js = load(path.join(J, p, s, 'js/report.json'));
  if (!a) return b;
  const cases = [...a.cases, ...(b?.cases ?? []).filter((c) => !a.cases.some((x) => x.id === c.id))];
  if (b && js) for (const c of js.cases) if (!cases.some((x) => x.id === c.id)) cases.push({ ...c, targets: { native: { outcome: 'error', stderr: 'native runner crashed (node heap out of memory while scoring)' } }, nativeMissing: true });
  return { ...a, cases };
}
for (const s of SUITES) {
  const n = load(path.join(J, 'suites', s, 'cases.json'))?.cases.length ?? '?';
  const cells = MESH.map((p) => {
    const rows = merged(nativeOf(p, s), load(path.join(J, p, s, 'js/report.json')), load(path.join(J, 'suites', s, 'reference.json')));
    if (!rows) return 'not run';
    (advRows[p] ??= []).push(...rows.map((r) => ({ ...r, suite: s })));
    return countStr(counts(rows));
  });
  L.push(`| ${s} (${n}) | ${cells.join(' | ')} |`);
}
L.push('');
L.push('| prototype | cases | pass + expected refusal | explicit refusal | WRONG (invalid + mismatch) | ambiguous (oracles disagree, undecidable on the rounded input; neither right nor wrong) | error / timeout | targets disagree | verdicts changed by the arbitration |', '|---|---|---|---|---|---|---|---|---|');
for (const p of MESH) {
  const rows = advRows[p] ?? [];
  const c = counts(rows);
  const wrong = WRONG.reduce((s, k) => s + (c[k] ?? 0), 0);
  const dis = rows.filter((r) => r.allTargetsAgree === false).length;
  const changed = rows.filter((r) => r.arbiter && r.unarbitratedVerdict !== r.verdict).map((r) => `${r.id}: ${r.unarbitratedVerdict} -> ${r.verdict} (${r.arbiter.decision})`);
  out.adversarial[p] = { counts: c, wrong, ambiguous: c.ambiguous ?? 0, disagree: dis, cases: rows.length, wrongCases: rows.filter((r) => WRONG.includes(r.verdict)).map((r) => `${r.suite}/${r.id}:${r.verdict}${r.arbiter ? ` (arbiter: ${r.arbiter.decision})` : ''}`), changedByArbitration: changed };
  L.push(`| ${p} | ${rows.length} | ${(c.pass ?? 0) + (c['expected-refusal'] ?? 0)} | ${c.unresolved ?? 0} | ${wrong} | ${c.ambiguous ?? 0} | ${(c.error ?? 0) + (c.timeout ?? 0)} | ${dis} | ${changed.length ? changed.join('<br>') : 'none'} |`);
}
L.push('');

// Oracle arbitration (plan step 3): every dispute of every case set, and the
// ones without an arbiter entry for the current job.
L.push('#### Oracle arbitration', '');
L.push('A case is disputed when OCCT and manifold3d give different shell counts, or volumes further apart than OCCT area x deviation. Each dispute is decided by a third reference (`scripts/bakeoff/arbiter.mjs`, `fixtures/bakeoff/arbiter.json`): the reference confirms manifold3d or OCCT, the case expectation decides it, or the case is ambiguous because the F32x2 rounding of the input decides the topology. Unarbitrated = a dispute without an arbiter entry for the current job.', '');
L.push('| case set | cases | disputes | manifold3d confirmed | OCCT confirmed | third reference alone | expectation | ambiguous | unarbitrated |', '|---|---|---|---|---|---|---|---|---|');
out.arbitration = { sets: {}, unarbitrated: 0, unarbitratedCases: [] };
for (const [name, cases, reference] of [['corpus', corpusCases, corpusRef], ...SUITES.map((s) => [s, load(path.join(J, 'suites', s, 'cases.json'))?.cases ?? [], load(path.join(J, 'suites', s, 'reference.json'))])]) {
  const rows = arbitration(cases, reference);
  const k = counts(rows, 'decision');
  const un = rows.filter((r) => r.decision === 'UNARBITRATED');
  out.arbitration.sets[name] = { cases: cases.length, reference: Boolean(reference), disputes: rows.length, decisions: k, rows };
  out.arbitration.unarbitrated += un.length;
  out.arbitration.unarbitratedCases.push(...un.map((r) => `${name}/${r.id}`));
  L.push(`| ${name} | ${cases.length}${reference ? '' : ' (no reference)'} | ${rows.length} | ${k.manifold ?? 0} | ${k.occt ?? 0} | ${k.reference ?? 0} | ${k.expectation ?? 0} | ${k.ambiguous ?? 0} | ${un.length}${un.length ? ` (${un.map((r) => r.id).join(', ')})` : ''} |`);
}
L.push('');
const disputeRows = Object.entries(out.arbitration.sets).flatMap(([name, x]) => x.rows.map((r) => ({ ...r, set: name })));
if (disputeRows.length) {
  L.push('<details><summary>Disputed cases and their arbitration</summary>', '');
  L.push('| case set | case | dispute | decision | class |', '|---|---|---|---|---|');
  for (const r of disputeRows) L.push(`| ${r.set} | ${r.id} | ${r.dispute.join('; ').replaceAll('|', '/')} | ${r.decision} | ${r.class ?? '-'} |`);
  L.push('', '</details>', '');
}

// Adversarial by category (all suites pooled): good (pass or expected
// refusal) / refused / WRONG / error+timeout per prototype.
const advCats = [...new Set(MESH.flatMap((p) => (advRows[p] ?? []).map((r) => r.category)))].sort();
L.push('Adversarial by category, all suites pooled. Cell = good / explicit refusal / WRONG / error+timeout, where good = pass or expected refusal. Ambiguous answers (see Oracle arbitration) are in none of the four numbers.', '');
L.push(`| category | cases | ${MESH.join(' | ')} |`, `|---|---|${MESH.map(() => '---|').join('')}`);
for (const cat of advCats) {
  const n = Math.max(...MESH.map((p) => (advRows[p] ?? []).filter((r) => r.category === cat).length));
  const cells = MESH.map((p) => {
    const c = counts((advRows[p] ?? []).filter((r) => r.category === cat));
    return `${(c.pass ?? 0) + (c['expected-refusal'] ?? 0)} / ${c.unresolved ?? 0} / ${WRONG.reduce((s, k) => s + (c[k] ?? 0), 0)} / ${(c.error ?? 0) + (c.timeout ?? 0)}`;
  });
  L.push(`| ${cat} | ${n} | ${cells.join(' | ')} |`);
}
L.push('');

// Verifier defects: the current verdict of every case a verifier named.
const DEFECTS = [
  ['corefine', 'critical', 'point contact returned ok with a non-manifold vertex', 'adv-corefine', ['adv-cube-vertex-touch', 'adv-sphere-point-touch-box', 'adv-cone-apex-on-face']],
  ['corefine', 'major', 'near-coincident sphere union: slow refusal (JS over the timeout)', 'adv-corefine', ['adv-perturb-sphere-rot-1e-6deg']],
  ['corefine', 'minor', 'zero-volume face-touch intersection refused instead of empty', 'adv-corefine', ['adv-empty-intersect-face-touch']],
  ['exact-plane', 'critical', 'point contact returned ok (edge-only self-check)', 'adv-exact-plane', ['adv-ep2-sphere-sphere-pole-touch', 'adv-ep2-sphere-inscribed-in-cube', 'adv-ep2-r1-cone-apex-on-face', 'adv-ep2-sphere-gap-1e-9-box', 'adv-ep2-r1-cube-vertex-gap-1e-9']],
  ['exact-plane', 'critical', 'rotated coplanar pocket sealed into a void by input quantization', 'adv-exact-plane', ['adv-ep2-rot-coplanar-pocket', 'adv-ep2-sweep-pocket-0', 'adv-ep2-sweep-pocket-1']],
  ['exact-plane', 'major', 'Metal out of memory at --gpu 1GB', 'adv-exact-plane', ['adv-ep2-rot-sphere-minus-cone']],
  ['exact-plane', 'minor', 'sub-micron skins: volume off by the quantization', 'adv-exact-plane', ['adv-ep2-skin-5e-7', 'adv-ep2-r1-skin-1e-7']],
  ['exact-plane', 'minor', 'quantization-made contact refused with a reason blaming the exact result', 'adv-exact-plane', ['adv-ep2-cube-edge-overlap-1e-9']],
  ['sdf', 'critical', 'thin solid features below the cell vanish, returned ok', 'adv-sdf', ['adv2-sdf-enclosure-wall-1.2', 'adv-sdf-large-plate-rib-1.2', 'adv-sdf-membrane-0.3', 'adv-sdf-large-membrane-0.6', 'adv-sdf-rib-0.1', 'adv2-sdf-sliver-wedge-blade']],
  ['sdf', 'critical', 'thin gaps and slots close, returned ok', 'adv-sdf', ['adv2-sdf-slot-0.4', 'adv-sdf-gap-0.02', 'adv-sdf-large-gap-0.5']],
  ['sdf', 'critical', 'small parts in a large extent come back empty', 'adv-sdf', ['adv2-sdf-far-small-cubes']],
  ['sdf', 'critical', 'pointed cone leaf gives h = 0 and an empty ok', 'adv-sdf', ['adv-sdf-cone-apex-leaf']],
  ['sdf', 'critical', 'invalid meshes returned ok (orientation, point contact)', 'adv-sdf', ['adv-sdf-pipe-tee-rot', 'adv-sdf-box-edge-contact', 'adv2-sdf-box-corner-contact']],
  ['sdf', 'critical', 'needle-thin hole dropped', 'adv-sdf', ['adv-sdf-needle-hole']],
  ['sdf', 'major', 'global cell size: timeouts on tiny radii / apex in material', 'adv-sdf', ['adv-sdf-drill-point-hole', 'adv-sdf-big-cyl-tiny-pin']],
];
const RDEFECTS = [
  ['critical', 'sliver absorption deletes real planar faces', 'adv-recover', ['adv4-planar-chip-dev0.1', 'adv4-planar-chip-dev0.01-1mm', 'adv4-planar-corner-bump', 'adv4-planar-corner-bump-rotated']],
  ['critical', 'cone tips absorbed as slivers', 'adv-recover', ['adv4-cone-tip-dimple', 'adv4-cone-tip-bump-rotated']],
  ['critical', 'near-tangency pre-check bypassed (tilt, crossed cylinders, cones, tori)', 'adv-recover', ['adv4-cyl-shave-tilt-1e-8rad', 'adv3-cyl-plane-shave-tilt-1e-5rad', 'adv3-cyl-plane-shave-tilt-intersect', 'adv3-cyl-cyl-graze-tilt-1e-5rad', 'adv3-crossed-cyl-graze', 'adv3-torus-top-shave', 'adv3-torus-top-cap-intersect', 'adv3-cone-side-shave', 'adv3-cone-side-shave-rotated']],
  ['minor', 'recovered B-rep at 1e5 mm not exportable by the kernel exporter', 'adv-recover', ['adv4-far-plate-hole']],
];
const findAdv = (p, s, id) => (advRows[p] ?? []).find((r) => r.suite === s && r.id === id);
const recCheck = (dir) => load(path.join(J, 'recover', dir, 'check.json'));
L.push('#### Verifier defects: current status (this run)', '');
L.push('Every case a verifier named, re-run on all four targets with the unchanged prototype code. "reproduced" = the case still gives the defect\'s wrong or unsafe outcome.', '');
L.push('| prototype | severity | defect | case: verdict (this run) |', '|---|---|---|---|');
out.defects = [];
for (const [p, sev, what, s, ids] of DEFECTS) {
  const cells = ids.map((id) => {
    const r = findAdv(p, s, id);
    if (!r) return `${id}: not in suite`;
    const fails = Object.entries(r.targets).filter(([, x]) => x.outcome !== 'ran').map(([t, x]) => `${t} ${x.outcome}`);
    return `${id}: ${r.verdict}${r.reason ? ` ("${r.reason.slice(0, 50).replaceAll('|', '/')}")` : ''}${fails.length ? ` [${fails.join(', ')}]` : ''}`;
  });
  out.defects.push({ proto: p, severity: sev, defect: what, cases: cells });
  L.push(`| ${p} | ${sev} | ${what} | ${cells.join('<br>')} |`);
}
for (const [sev, what, s, ids] of RDEFECTS) {
  const cells = ids.map((id) => {
    const per = ['manifold', 'corefine'].map((src) => {
      const r = recCheck(`check-${s}-${src}`)?.rows.find((x) => x.id === id);
      if (!r) return `${src} -`;
      const e = r.exact ? `, vol ${e1(r.exact.volumeRelErrVsOcctCsg)}, area ${e1(r.exact.areaRelErrVsOcctCsg)}` : '';
      return `${src} ${r.verdict}${e}`;
    });
    return `${id}: ${per.join('; ')}`;
  });
  out.defects.push({ proto: 'recover', severity: sev, defect: what, cases: cells });
  L.push(`| recover | ${sev} | ${what} | ${cells.join('<br>')} |`);
}
L.push('');
const issueKinds = (r) => [...new Set((r.report?.issues ?? []).map((i) => i.kind ?? i.type ?? i.issue ?? JSON.stringify(i).slice(0, 30)))].slice(0, 3).join(', ');
for (const p of MESH) {
  const bad = (advRows[p] ?? []).filter((r) => [...WRONG, 'error', 'timeout', 'info', 'ambiguous'].includes(r.verdict) || r.allTargetsAgree === false);
  if (!bad.length) continue;
  L.push(`<details><summary>${p}: ${bad.length} wrong, ambiguous, failed or target-disagreeing adversarial answers</summary>`, '');
  L.push('| suite | case | expect | verdict | detail |', '|---|---|---|---|---|');
  for (const r of bad) {
    const cmp = r.comparison ?? {};
    let d = '';
    if (r.verdict === 'invalid') d = `validator: ${issueKinds(r)}`;
    else if (r.verdict === 'mismatch' || r.verdict === 'ambiguous') {
      const ref = r.arbiter ? (r.arbiter.decision === 'manifold' ? 'manifold3d' : 'the arbiter reference') : 'manifold3d';
      d = `comps ${r.report?.components} (${cmp.componentsMatch === false ? '!=' : '='} ${ref}), chi ${cmp.eulerMatch === false ? '!=' : '='}, vol rel ${e1(cmp.volumeRelErrVsManifold)}, vs OCCT ${e1(cmp.volumeAbsErrVsOcct)} / bound ${e1(cmp.analyticBound)}${cmp.volumeAbsErrVsReference !== undefined ? `, vs reference ${e1(cmp.volumeAbsErrVsReference)} / tol ${e1(cmp.referenceTolerance)}` : ''}, bbox err ${e1(cmp.bboxMaxAbsErrVsManifold)}${cmp.bboxMatch === false ? ' (off)' : ''}, tris ${r.report?.triangles}${r.arbiter ? `; arbiter: ${r.arbiter.decision} (${r.arbiter.class})` : ''}`;
    }
    else if (r.verdict === 'info') d = 'valid mesh for a contact case';
    const fails = Object.entries(r.targets).filter(([, x]) => x.outcome !== 'ran').map(([t, x]) => `${t} ${x.outcome}${x.stderr ? `: ${x.stderr.split('\n').filter(Boolean).pop()?.slice(0, 60)}` : ''}`).join('; ');
    if (fails) d = d ? `${d}; ${fails}` : fails;
    if (r.allTargetsAgree === false) d += ' TARGETS DISAGREE';
    L.push(`| ${r.suite} | ${r.id} | ${r.expect} | ${r.verdict} | ${d.replaceAll('|', '/')} |`);
  }
  L.push('', '</details>', '');
}

// ---------------------------------------------------------------------------
// Recover
L.push('### Recover: exact B-rep / STEP from tagged meshes', '');
L.push('`exact` = OCCT BRepCheck-valid (exact CurveOnSurface), free of self-interference, same solid count, volume and area within 1e-7 relative of the OCCT CSG, or, on a disputed case, of the arbiter reference that the entry names (an empty result counts when the case expects empty). `strict validate-step` = exact and `uv run scripts/validate-step.py` accepts the STEP as written; the rest pass it only through recover-check\'s documented seam/vertex refinement rule.', '');
L.push('Disputed cases (OCCT and manifold3d disagree) are graded against the arbiter entry; a dispute without one is `unarbitrated` (never exact).', '');
L.push('| input meshes | cases | exact | of which strict validate-step | exact via refinement rule | unresolved (named) | expected refusal | wrong | unarbitrated / within a non-exact reference | no source (mesh engine refused) |', '|---|---|---|---|---|---|---|---|---|---|');
const WRONG_R = ['mismatch', 'invalid', 'invalid-step', 'invalid-interference', 'contact-accepted', 'valid-sampled'];
const recChecks = [];
for (const dir of fs.existsSync(path.join(J, 'recover')) ? fs.readdirSync(path.join(J, 'recover')).filter((d) => d.startsWith('check-')).sort() : []) {
  const ck = load(path.join(J, 'recover', dir, 'check.json'));
  if (!ck) continue;
  const c = ck.summary.counts;
  const wrong = WRONG_R.reduce((s, k) => s + (c[k] ?? 0), 0);
  out.recover[dir] = { ...ck.summary, wrongCases: ck.rows.filter((r) => WRONG_R.includes(r.verdict)).map((r) => `${r.id}:${r.verdict}`) };
  recChecks.push({ dir, ck });
  L.push(`| ${dir.replace('check-', '')} | ${ck.rows.length} | ${ck.summary.exact} | ${ck.summary.exactStrictValidateStep} | ${ck.summary.exactViaRefinementRule} | ${c.unresolved ?? 0} | ${c['expected-refusal'] ?? 0} | ${wrong}${wrong ? ` (${WRONG_R.filter((k) => c[k]).map((k) => `${k} ${c[k]}`).join(', ')})` : ''} | ${c.unarbitrated ?? 0} / ${c['reference-tolerance'] ?? 0} | ${c['no-source'] ?? 0} |`);
}
L.push('');
// Why a recover output is not exact. Only `wrong-geometry`, `wrong-empty` and
// `contact-accepted` are wrong B-reps; the export classes are limits of the
// STEP path (kernel exporter coordinate planner; the sphere/torus test
// serializer writes no parameter curves) for B-reps whose OCCT volume and
// area match the exact CSG, or for which OCCT's exact check is unavailable.
function recoverClass(r) {
  const err = String(r.error ?? r.validateStep?.error ?? '');
  if (r.verdict === 'contact-accepted') return 'contact-accepted';
  if (/InvalidSource|ResolutionLimit/.test(err)) return 'export: kernel exporter coordinate limit';
  if (r.verdict === 'invalid' && !r.error) return 'wrong-empty';
  if (r.serializer?.startsWith('recover-stepx') && (r.verdict !== 'mismatch' || r.occt?.valid === false)) return 'export: sphere/torus test serializer (no pcurves / seam count)';
  if (r.verdict === 'mismatch') return 'wrong-geometry';
  return r.verdict;
}
const RCLASS = ['wrong-geometry', 'wrong-empty', 'contact-accepted', 'export: kernel exporter coordinate limit', 'export: sphere/torus test serializer (no pcurves / seam count)'];
L.push('Why the non-exact, non-refused recover outputs fail (classes: `wrong-geometry` = OCCT-valid exact STEP of a solid whose volume or area differs from the exact CSG; `wrong-empty` = empty output where the exact CSG is not empty; `contact-accepted` = B-rep of a result that touches itself; the two `export` classes are STEP-path limits, not wrong B-reps):', '');
L.push(`| input meshes | ${RCLASS.join(' | ')} |`, `|---|${RCLASS.map(() => '---|').join('')}`);
out.recoverClasses = {};
for (const { dir, ck } of recChecks) {
  const bad = ck.rows.filter((r) => WRONG_R.includes(r.verdict));
  const m = counts(bad.map((r) => ({ c: recoverClass(r) })), 'c');
  out.recoverClasses[dir] = { ...m, wrongCases: bad.filter((r) => ['wrong-geometry', 'wrong-empty', 'contact-accepted'].includes(recoverClass(r))).map((r) => r.id) };
  L.push(`| ${dir.replace('check-', '')} | ${RCLASS.map((k) => m[k] ?? 0).join(' | ')} |`);
}
L.push('');
for (const { dir, ck } of recChecks) {
  const bad = ck.rows.filter((r) => WRONG_R.includes(r.verdict));
  if (!bad.length) continue;
  L.push(`<details><summary>recover ${dir.replace('check-', '')}: ${bad.length} wrong answers</summary>`, '');
  L.push('| case | verdict | class | OCCT volume rel err vs exact CSG | area rel err | solids match | detail |', '|---|---|---|---|---|---|---|');
  for (const r of bad) L.push(`| ${r.id} | ${r.verdict} | ${recoverClass(r)} | ${e1(r.exact?.volumeRelErrVsOcctCsg)} | ${e1(r.exact?.areaRelErrVsOcctCsg)} | ${r.exact?.solidsMatch ?? '-'} | ${String(r.error ?? r.validateStep?.error ?? r.occt?.error ?? '').slice(0, 100).replaceAll('|', '/')} |`);
  L.push('', '</details>', '');
}

// Recover timings.
const rn = load(path.join(J, 'recover/corpus-manifold-native-interleaved/report.json')) ?? load(path.join(J, 'recover/corpus-manifold-native/report.json'));
out.determinism.recover = { sameCpu1BytesAcrossRuns: sameBytes(load(path.join(J, 'recover/corpus-manifold-native-interleaved/report.json')), load(path.join(J, 'recover/corpus-manifold-native/report.json'))) };
const rj = load(path.join(J, 'recover/corpus-manifold-js/report.json'));
const rrows = merged(rn, rj) ?? [];
if (rrows.length) {
  L.push('Recover compute ms (median; native 5 processes, JS 3 warm runs), corpus, input = manifold3d dumps:', '');
  L.push('| case | js | cpu1 | cpu18 | metal (passes) | status |', '|---|---|---|---|---|---|');
  for (const r of rrows) {
    ((out.recoverCaseTimes ??= {}))[r.id] = { js: num(r, 'js'), cpu1: num(r, 'cpu1'), cpuN: num(r, 'cpuN'), metal: num(r, 'metal'), status: r.status };
    const t = (x) => { const v = ms(r, x); return typeof v === 'number' ? f0(v) : (v ?? '-'); };
    L.push(`| ${r.id} | ${t('js')} | ${t('cpu1')} | ${t('cpuN')} | ${t('metal')} (${r.targets.metal?.metalPasses ?? '-'}) | ${r.verdict === 'no-source' ? 'no-source' : r.status}${r.reason ? `: ${r.reason.slice(0, 70).replaceAll('|', '/')}` : ''} |`);
  }
  const big = rrows.filter((r) => num(r, 'cpu1') >= 20);
  const rs = big.filter((r) => num(r, 'cpuN') > 0).map((r) => num(r, 'cpu1') / num(r, 'cpuN'));
  const rm = big.filter((r) => num(r, 'metal') !== null && num(r, 'cpuN') > 0).map((r) => num(r, 'metal') / num(r, 'cpuN'));
  out.recover.speedupGeo = geo(rs);
  out.recover.metalOverCpu18Geo = geo(rm);
  out.recover.sums = Object.fromEntries(['js', 'cpu1', 'cpuN', 'metal'].map((t) => [t, rrows.reduce((s, r) => s + (num(r, t) ?? 0), 0)]));
  L.push('', `Recover over ${big.length} cases with cpu1 >= 20 ms: cpu1/cpu18 geo-mean ${f2(geo(rs))}, metal/cpu18 geo-mean ${f2(geo(rm))}. Corpus sums (ms): js ${f0(out.recover.sums.js)}, cpu1 ${f0(out.recover.sums.cpu1)}, cpu18 ${f0(out.recover.sums.cpuN)}, metal ${f0(out.recover.sums.metal)}. All targets byte-identical on ${rrows.filter((r) => r.allTargetsAgree).length}/${rrows.length}.`, '');
}

// Hybrid end to end: corefine mesh Boolean + recover on corefine's own meshes.
const hyb = load(path.join(J, 'recover/corpus-from-corefine-native/report.json'));
const hybCheck = load(path.join(J, 'recover/check-corpus-from-corefine/check.json'));
if (hyb && corpus.corefine.rows && hybCheck) {
  const verdict = new Map(hybCheck.rows.map((r) => [r.id, r.verdict]));
  L.push('Hybrid end to end (corefine compute + recover compute on corefine\'s result, native medians; recover-from-corefine ran with 3 processes per target):', '');
  L.push('| case | hybrid verdict | corefine cpu1 / cpu18 | recover cpu1 / cpu18 | total cpu1 / cpu18 | recover share of total (cpu18) |', '|---|---|---|---|---|---|');
  const tot = { c1: 0, c18: 0, r1: 0, r18: 0 };
  for (const r of hyb.cases) {
    const c = corpus.corefine.rows.find((x) => x.id === r.id);
    const [c1, c18, r1, r18] = [num(c, 'cpu1'), num(c, 'cpuN'), num(r, 'cpu1'), num(r, 'cpuN')];
    const v = verdict.get(r.id) ?? r.verdict;
    ((out.hybridCases ??= {}))[r.id] = { verdict: v, c1, c18, r1, r18 };
    if (v === 'exact') { tot.c1 += c1 ?? 0; tot.c18 += c18 ?? 0; tot.r1 += r1 ?? 0; tot.r18 += r18 ?? 0; }
    if ((c1 ?? 0) + (r1 ?? 0) < 20 && v === 'exact') continue;
    L.push(`| ${r.id} | ${v} | ${f0(c1)} / ${f0(c18)} | ${f0(r1)} / ${f0(r18)} | ${f0((c1 ?? 0) + (r1 ?? 0))} / ${f0((c18 ?? 0) + (r18 ?? 0))} | ${c18 + r18 > 0 ? `${Math.round((100 * (r18 ?? 0)) / ((c18 ?? 0) + (r18 ?? 0)))} %` : '-'} |`);
  }
  out.hybridTotals = tot;
  L.push('', `Rows below 20 ms total cpu1 with an exact verdict are omitted. Sum over the exact cases: corefine ${f0(tot.c1)} / ${f0(tot.c18)} ms, recover ${f0(tot.r1)} / ${f0(tot.r18)} ms (cpu1 / cpu18).`, '');
}

// Run conditions
L.push('### Run conditions and raw reports', '');
L.push('| report | captured (UTC) | load average start -> end | builds |', '|---|---|---|---|');
const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name === 'report.json' ? [path.join(d, e.name)] : [])) : []);
for (const f of walk(J).filter((f) => !f.includes('/suites/') && !f.includes('team-reports')).sort()) {
  const r = load(f);
  if (!r?.capturedAt) continue;
  const la = (x) => (x ? x.map((v) => v.toFixed(1)).join(' ') : '-');
  L.push(`| ${rel(f)} | ${r.capturedAt.slice(0, 16)} | ${la(r.loadavgStart)} -> ${la(r.loadavgEnd)} | ${Object.entries(r.builds ?? {}).map(([k, b]) => `${k} ${b.error ? 'FAILED' : b.cached ? 'cached' : `${(b.ms / 1000).toFixed(1)} s`}`).join(', ')} |`);
}
L.push('');

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'results.md'), L.join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(out, null, 1) + '\n');
console.log(`wrote ${rel(path.join(OUT, 'results.md'))} and results.json`);
console.log(`oracle disputes: ${Object.values(out.arbitration.sets).reduce((n, x) => n + x.disputes, 0)}, unarbitrated: ${out.arbitration.unarbitrated}${out.arbitration.unarbitrated ? ` (${out.arbitration.unarbitratedCases.join(', ')})` : ''}`);
