#!/usr/bin/env node
// Renders the markdown tables of docs/native-bridge/prototype.md and slice.md
// from out/native-bridge/slice/bench.json, churn.json and full-surface-build.json,
// so no number in those tables is typed by hand.
//
//   node scripts/native-bridge/slice-tables.mjs [--de]
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './slice-ops.mjs';

const de = process.argv.includes('--de');
const bench = JSON.parse(readFileSync(join(root, 'out/native-bridge/slice/bench.json'), 'utf8'));
const full = JSON.parse(readFileSync(join(root, 'out/native-bridge/slice/full-surface-build.json'), 'utf8'));
const f = (x, d = 1) => x === null || x === undefined ? '–' : (de ? Number(x).toFixed(d).replace('.', ',') : Number(x).toFixed(d));
const load = l => `${f(l.before.one, 2)}–${f(l.after.one, 2)}`;
const loads = samples => { const all = samples.flatMap(s => [s.before.one, s.after.one]); return `${f(Math.min(...all), 2)}–${f(Math.max(...all), 2)}`; };
const row = cells => `| ${cells.join(' | ')} |`;
const out = [];
const T = (en, german) => de ? german : en;

out.push(`### ${T('Wall time, fresh processes, 1 thread', 'Wall-Zeit, frische Prozesse, 1 Thread')}`, '',
  row([T('workload', 'Workload'), 'js ms (n=3)', 'native ms (n=3)', T('median factor', 'Faktor Median'), T('projected factor', 'Projektion'), T('deviation', 'Abweichung'), T('native projected ms', 'nativ projiziert ms'), '6 threads ms', T('outputs identical', 'Ausgaben identisch'), 'load 1m']),
  row(Array(10).fill('---')));
for (const c of bench.comparison) {
  const w = bench.workloads[c.id];
  out.push(row([c.id, w.wall.js.ms.map(x => f(x, 0)).join(' / '), w.wall.native.ms.map(x => f(x, 0)).join(' / '), `${f(c.measuredFactor, 2)}x`,
    `${f(c.projectedFactor, 2)}x`, `${c.deviation >= 0 ? '+' : ''}${f(c.deviation * 100, 0)} %`, f(c.projectedNativeMs, 0), f(c.threads6Ms, 0),
    c.allCorrect && w.nativeTraced.correctness.identical && w.threads6?.correctness.identical ? T('yes', 'ja') : T('NO', 'NEIN'),
    loads(w.samples.flatMap(s => [s.js.load, s.native.load]))]));
}

out.push('', `### ${T('Buckets of one traced run (ms from process time origin)', 'Buckets eines Trace-Laufs (ms ab Prozess-Zeitursprung)')}`, '',
  row([T('workload', 'Workload'), T('backend', 'Backend'), T('cold start to kernel ready', 'Kaltstart bis Kern bereit'), T('of which stale check / dlopen / init', 'davon Stale-Check / dlopen / init'),
    T('kernel (native / encode / decode)', 'Kern (nativ / Encode / Decode)'), T('frontend + host', 'Frontend + Host'), T('export', 'Export'), T('process overhead', 'Prozess-Overhead'), 'load 1m']),
  row(Array(9).fill('---')));
for (const [id, w] of Object.entries(bench.workloads)) {
  const b = w.nativeTraced.buckets;
  out.push(row([id, 'native', f(b.coldStartToKernelReadyMs), `${f(b.open.staleCheckMs, 2)} / ${f(b.open.dlopenMs, 2)} / ${f(b.open.initMs, 2)}`,
    `${f(b.kernelMs)} (${f(b.kernelNativeMs)} / ${f(b.encodeMs, 2)} / ${f(b.decodeMs, 2)})`, f(b.frontendHostMs), f(b.exportMs), f(b.processOverheadMs), load(w.nativeTraced.load)]));
  if (w.jsTraced) {
    const j = w.jsTraced.buckets;
    out.push(row([id, 'js (count)', f(j.coldStartToKernelReadyMs), '–', f(j.kernelMs), f(j.frontendHostMs), f(j.exportMs), '–', load(w.jsTraced.load)]));
  }
}

out.push('', `### ${T('Per-entry kernel time, traced runs (ms)', 'Kernzeit pro Einstieg, Trace-Läufe (ms)')}`, '',
  row([T('workload', 'Workload'), T('entry', 'Einstieg'), T('calls', 'Aufrufe'), T('native', 'nativ'), 'encode', 'decode', T('JS target (count run)', 'JS-Target (Count-Lauf)'), T('words in / out', 'Wörter hin / her')]),
  row(Array(8).fill('---')));
for (const [id, w] of Object.entries(bench.workloads)) {
  const js = Object.fromEntries((w.jsTraced?.entries ?? []).map(e => [e.entry, e]));
  const heavy = w.nativeTraced.entries.filter(e => e.nativeMs + e.encodeMs + e.decodeMs >= 1 || (js[e.entry]?.ms ?? 0) >= 1);
  for (const e of heavy) out.push(row([id, e.label, e.calls, f(e.nativeMs, 2), f(e.encodeMs, 2), f(e.decodeMs, 2), f(js[e.entry]?.ms, 2), `${e.requestWords} / ${e.replyWords}`]));
}

out.push('', `### ${T('Differential runs (WONKY_BACKEND=diff)', 'Differenzläufe (WONKY_BACKEND=diff)')}`, '',
  row([T('workload', 'Workload'), T('exit', 'Exit'), T('compared calls', 'verglichene Aufrufe'), T('compared words', 'verglichene Wörter'), T('divergences', 'Divergenzen'),
    T('= profile count run', '= Profil-Count-Lauf'), T('= this count run', '= dieser Count-Lauf'), T('outputs = js', 'Ausgaben = js'), 'wall ms', 'load 1m']),
  row(Array(10).fill('---')));
for (const [id, w] of Object.entries(bench.workloads)) {
  const d = w.diff;
  out.push(row([id, d.exitCode, d.comparedCalls, d.comparedWords, d.divergences, d.countsMatchProfile ? T('yes', 'ja') : T('NO', 'NEIN'),
    d.countsMatchCountRun ? T('yes', 'ja') : T('NO', 'NEIN'), d.correctness.identical ? T('yes', 'ja') : T('NO', 'NEIN'), f(d.wallMs, 0), load(d.load)]));
}

out.push('', `### ${T('Negative workloads on native', 'Negativfälle auf native')}`, '',
  row([T('workload', 'Workload'), T('exit', 'Exit'), 'wall ms', T('first refused entry', 'erster verweigerter Einstieg'), T('JS kernel loaded', 'JS-Kernel geladen'), 'load 1m']), row(Array(6).fill('---')));
for (const [id, n] of Object.entries(bench.negative ?? {})) out.push(row([id, n.exitCode, f(n.wallMs, 0), `\`${n.firstRefusedEntry}\``, n.jsKernelLoaded ? T('YES', 'JA') : T('no', 'nein'), load(n.load)]));

const fl = bench.firstLoad;
out.push('', `### ${T('Loading the addon', 'Laden des Addons')}`, '',
  row([T('case', 'Fall'), 'dlopen ms', 'load 1m']), row(['---', '---', '---']),
  row([T('first load after rebuild (build smoke child)', 'erster Load nach Rebuild (Smoke-Kind des Builds)'), f(fl.afterRebuild.dlopenMs), f(fl.afterRebuild.load.one, 2)]),
  row([T('second load after rebuild', 'zweiter Load nach Rebuild'), f(fl.warmAfterRebuild.dlopenMs, 2), f(fl.warmAfterRebuild.load.one, 2)]),
  ...fl.freshCopy.map(r => row([`${T('fresh copy, fs-bracket run', 'frische Kopie, fs-bracket-Lauf')} ${r.run} (wall ${f(r.wallMs, 0)} ms)`, f(r.dlopenMs, 2), load(r.load)])));

const b = bench.build;
out.push('', `### ${T('Builds', 'Builds')}`, '',
  row([T('set', 'Set'), T('ops', 'Ops'), 'bend s', 'clang s', 'C MB', '.node MB', T('first dlopen ms', 'erstes dlopen ms'), T('warm dlopen ms', 'warmes dlopen ms'), 'load 1m']), row(Array(9).fill('---')),
  row(['planar', b.ops, f(b.seconds.bend), f(b.seconds.clang), f(b.cBytes / 1e6, 2), f(b.nodeBytes / 1e6, 2), f(b.firstLoad.dlopenMs), f(b.warmLoad.dlopenMs, 2), `${f(b.load.before.one, 2)}–${f(b.load.after.one, 2)}`]),
  row(['full (84)', full.full.ops, f(full.full.bendSeconds), f(full.full.clangSeconds), f(full.full.cBytes / 1e6, 2), f(full.full.nodeBytes / 1e6, 2), f(full.full.firstLoadDlopenMs),
    full.fullWarmLoads.map(w => f(w.dlopenMs, 2)).join(' / '), `${f(full.full.buildLoad.before.one, 2)}–${f(full.full.buildLoad.after.one, 2)}`]));
// The stale check of the traced native runs, by part (docs: "What the stale check covers").
const staleParts = Object.entries(bench.workloads).map(([id, w]) => [id, w.nativeTraced.staleCheck, w.nativeTraced.load]).filter(([, p]) => p);
if (staleParts.length) {
  out.push('', `### ${T('Stale check of the traced native runs (ms)', 'Stale-Check der Trace-Läufe (ms)')}`, '',
    row([T('workload', 'Workload'), T('total', 'gesamt'), T('input files', 'Eingabedateien'), 'wiring', 'toolchain', T('key', 'Schlüssel'), '.node sha256', T('codecs', 'Codecs'), 'load 1m']), row(Array(9).fill('---')));
  for (const [id, p, l] of staleParts) out.push(row([id, f(p.totalMs, 2), f(p.filesMs, 2), f(p.wiringMs, 2), f(p.toolchainMs, 2), f(p.keyMs, 2), f(p.nodeMs, 2), f(p.wireMs, 2), load(l)]));
}

const churnFile = join(root, 'out/native-bridge/slice/churn.json');
if (existsSync(churnFile)) {
  const churn = JSON.parse(readFileSync(churnFile, 'utf8'));
  out.push('', `### ${T('One long-lived process: per-call time with and without the per-call heap clear', 'Ein langlebiger Prozess: Zeit pro Aufruf mit und ohne Heap-Leeren pro Aufruf')}`, '',
    `${T('Recorded', 'Aufgezeichnet')}: ${churn.recorded.calls} ${T('calls', 'Aufrufe')} (${churn.recorded.sources.map(x => x.split('/').pop()).join(', ')}), ${churn.passes} ${T('passes, then', 'Durchläufe, danach')} ${churn.repeat} ${T('repeats of the heaviest request per entry; every reply compared with the recording', 'Wiederholungen der schwersten Anfrage je Einstieg; jede Antwort mit der Aufzeichnung verglichen')} (${churn.allRepliesExact ? T('all exact', 'alle exakt') : T('MISMATCH', 'ABWEICHUNG')}).`, '',
    row([T('heap', 'Heap'), T('pass 1 / last pass ms', 'Durchlauf 1 / letzter ms'), 'identity.boolean_result ms (1st → last quarter)', 'planarBoolean.subtract ms', 'planarBoolean.union ms', T('heap pages last call', 'Heap-Seiten letzter Aufruf'), 'max RSS MiB', 'load 1m']), row(Array(8).fill('---')));
  for (const [heap, m] of Object.entries(churn.modes)) {
    const sr = l => m.series[l] ? `${f(m.series[l].firstQuarterMedianMs)} → ${f(m.series[l].lastQuarterMedianMs)} (${f(m.series[l].growth, 2)}x)` : '–';
    out.push(row([heap === 'clear' ? T('clear (production)', 'leeren (Produktion)') : T('keep (before the fix)', 'behalten (vor dem Fix)'), `${f(m.passMs[0], 0)} / ${f(m.passMs.at(-1), 0)}`,
      sr('identity.boolean_result'), sr('planarBoolean.subtract'), sr('planarBoolean.union'), m.stats.lastCallPages, f(m.stats.maxRssMiB, 0), load(m.load)]));
  }
}

const guardFile = join(root, 'out/native-bridge/slice/count-guard.json');
if (existsSync(guardFile)) {
  const g = JSON.parse(readFileSync(guardFile, 'utf8'));
  const runsOf = name => g.runs.filter(r => r.build === name);
  const loadsOf = name => loads(runsOf(name).map(r => r.load));
  out.push('', `### ${T('Count guard: the build before it against this build (fresh processes, alternating)', 'Zählwächter: der Build davor gegen diesen Build (frische Prozesse, abwechselnd)')}`, '',
    `${T('Builds', 'Builds')}: ${g.builds.before.slice(0, 12)} (${T('before', 'davor')}) / ${g.builds.after.slice(0, 12)} (${T('after', 'danach')}); ${g.recorded.calls} ${T('recorded calls', 'aufgezeichnete Aufrufe')} (${g.recorded.sources.map(x => x.split('/').pop()).join(', ')}) × ${g.passes} ${T('passes', 'Durchläufe')} × ${g.rounds} ${T('rounds per build; replies equal to the recording on both builds', 'Runden je Build; Antworten auf beiden Builds gleich der Aufzeichnung')}: ${g.mismatches === 0 ? T('all', 'alle') : `${T('MISMATCHES', 'ABWEICHUNGEN')} ${g.mismatches}`}. Load 1m ${T('before', 'davor')} ${loadsOf('before')}, ${T('after', 'danach')} ${loadsOf('after')}.`, '',
    row([T('entry', 'Einstieg'), T('calls per pass', 'Aufrufe je Durchlauf'), T('median ms before', 'Median ms davor'), T('median ms after', 'Median ms danach'), T('after / before', 'danach / davor')]), row(Array(5).fill('---')));
  for (const p of [...g.perOp].sort((a, b) => b.beforeMedianMs - a.beforeMedianMs)) out.push(row([p.label, p.calls, f(p.beforeMedianMs, 3), f(p.afterMedianMs, 3), `${f(p.ratio, 2)}x`]));
  const typesOf = name => Object.fromEntries(runsOf(name)[0].probes.byType.map(t => [t.type, t]));
  const [before, after] = [typesOf('before'), typesOf('after')];
  const maxMs = (name, type) => Math.max(...runsOf(name).map(r => r.probes.byType.find(t => t.type === type).maxMsClaim65536));
  out.push('', row([T('count word of', 'Zählwort von'), T('min words per element', 'min. Wörter je Element'), T('probes', 'Proben'), T('heap pages, claim 1 / 2^16, before', 'Heap-Seiten, Anspruch 1 / 2^16, davor'),
    T('heap pages, claim 1 / 2^16, after', 'Heap-Seiten, Anspruch 1 / 2^16, danach'), T('max ms of a 2^16 claim, before / after', 'max. ms eines 2^16-Anspruchs, davor / danach')]), row(Array(6).fill('---')));
  for (const [type, b] of Object.entries(before)) {
    const a = after[type];
    out.push(row([`\`${type}\``, b.w, b.probes, `${b.maxPagesClaim1} / ${b.maxPagesClaim65536}`, `${a.maxPagesClaim1} / ${a.maxPagesClaim65536}`, `${f(maxMs('before', type), 2)} / ${f(maxMs('after', type), 3)}`]));
  }
  const p = runsOf('after')[0].probes;
  out.push('', `${T('Probes', 'Proben')}: ${p.count} ${T('per run; heap pages that depend on the claim', 'je Lauf; Heap-Seiten, die vom Anspruch abhängen')}: ${T('before', 'davor')} ${runsOf('before').map(r => r.probes.pagesDependOnClaim).join(' / ')}, ${T('after', 'danach')} ${runsOf('after').map(r => r.probes.pagesDependOnClaim).join(' / ')}. ${T('One heap page is 128 words (1 KiB).', 'Eine Heap-Seite sind 128 Wörter (1 KiB).')}`);
}

out.push('', `${T('Bench', 'Bench')}: ${bench.startedAt} – ${bench.finishedAt}, build ${bench.build.sourceHash.slice(0, 12)} (${bench.build.hit ? T('cache hit', 'Cache-Treffer') : T('fresh', 'frisch')}), load ${f(bench.loadStart.one, 2)} → ${f(bench.loadEnd.one, 2)}.`);
console.log(out.join('\n'));
