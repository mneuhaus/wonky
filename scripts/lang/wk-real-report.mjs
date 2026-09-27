// Tables of the WK real-model spike, rendered from out/lang/wk/real/*.json
// (written by scripts/lang/wk-real.mjs). Every number in
// docs/language/spike-real-model.md and docs/language/prototype.md comes from here.
//   node scripts/lang/wk-real-report.mjs > out/lang/wk/real/tables.md
// Also writes out/lang/wk/real/summary.json (gate ratios and buckets per workload).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT = new URL('../../out/lang/wk/real/', import.meta.url).pathname;
const read = f => existsSync(join(OUT, f)) ? JSON.parse(readFileSync(join(OUT, f), 'utf8')) : null;
const median = xs => { const s = xs.filter(x => x != null).sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const f = (x, d = 2) => x == null ? '–' : Number(x).toFixed(d);
const range = xs => { const s = xs.filter(x => x != null); return s.length ? `${f(Math.min(...s), 1)}–${f(Math.max(...s), 1)}` : '–'; };
const loads = rows => range(rows.flatMap(r => [r.loadBefore, r.loadAfter]).filter(Boolean).map(l => Number(String(l).split(' ')[0])));
const tags = ['washers', 'dual-hardware', 'mounting-r26', 'direct-mount-r26', 'frame-with-tab'];
const W = Object.fromEntries(tags.map(t => [t, read(`${t}.json`)]).filter(([, v]) => v));
const summary = { schema: 'wonky-lang-wk-real-summary/1', workloads: {} };
const lines = [];
const p = s => lines.push(s);

p('## Workloads: record, fidelity, correctness\n');
p('Comparison level: the complete body JSON of every node (deepDiff: every field, numbers with Object.is, key sets; byte-identical = same JSON text incl. key order), and for the outputs the whole exported model (bodies, operationEvidence, source map).\n');
p('| workload | nodes | heavy / span | op-count bound | methods | record ms | fidelity (recorded / today, equal prefix) | oracle: body nodes deep-equal (byte-identical) / error nodes equal, of all | differences | stages (PIERCE nodes with host inputs) | model vs today |');
p('|---|---:|---:|---:|---|---:|---|---|---|---|---|');
for (const [t, r] of Object.entries(W)) {
  const fid = r.fidelity ? `${r.fidelity.recorded} / ${r.fidelity.reference}, ${r.fidelity.equalPrefix}${r.fidelity.referenceComplete ? ' (full)' : ' (prefix)'}` : '–';
  const outs = r.outputs?.allEqual === undefined ? 'no model today' : r.outputs.allEqual ? `${r.outputs.count[0]} of ${r.outputs.count[1]} bodies, evidence, source map: ${r.outputs.jsonIdentical ? 'byte-identical' : 'deep-equal'}` : 'DIFFERENT';
  const diffs = r.oracle.differences.map(d => `%${d.node} ${d.id ?? ''} ${(d.paths ?? []).join('; ') || d.native || ''}`).join('<br>') || '–';
  const pierce = r.encode?.stages ? `${r.encode.stages.length} (${r.encode.stages.map(s => s.pierce).join(' + ')})` : '–';
  p(`| ${t} | ${r.record.nodes} | ${r.record.heavy} / ${r.record.heavySpan} | ${r.record.opCountBound} | ${Object.entries(r.record.methods).map(([k, v]) => `${k} ${v}`).join(', ')} | ${f(r.record.medianMs)} | ${fid} | ${r.oracle.bodiesEqual} (${r.oracle.bodiesJsonIdentical ?? '?'}) / ${r.oracle.errorsEqual} of ${r.oracle.nodes} | ${diffs} | ${pierce} | ${outs} |`);
}

p('\n## Native evaluation per mode and thread count (median over n processes; warm = median of reps 2..R in a process, cold = rep 1)\n');
p('| workload | reps | seq@1 | seq@2 | seq@4 | fork@1 | fork@2 | fork@4 | cold seq@1 / fork@4 | identical outputs | load (1 min) |');
p('|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|');
for (const [t, r] of Object.entries(W)) {
  const tb = r.native.table;
  p(`| ${t} | ${r.reps} | ${f(tb['seq@1'].warmEvalMs, 3)} | ${f(tb['seq@2'].warmEvalMs, 3)} | ${f(tb['seq@4'].warmEvalMs, 3)} | ${f(tb['fork@1'].warmEvalMs, 3)} | ${f(tb['fork@2'].warmEvalMs, 3)} | ${f(tb['fork@4'].warmEvalMs, 3)} | ${f(tb['seq@1'].coldEvalMs, 3)} / ${f(tb['fork@4'].coldEvalMs, 3)} | ${r.native.identicalOutputs ? 'yes' : 'NO'} (${r.native.matrix.length + r.serial.length} runs) | ${loads(r.native.matrix)} |`);
}

p('\n## Gate: W / T4 and cost weighting\n');
p('Per configuration two statistics of the warm repetitions (reps 2..R): median = median over processes of the per-process median; mean = mean over every warm rep of every process. W_best = best serial native time over 1/2/4 threads (seq mode, same binary), T4 = fork@4, both under the same statistic. **Gate ratio = the smaller of the two W_best / T4 ratios** (real-run.mjs gateRatios): a pass on the median alone, with a heavy-tailed fork@4, is not a pass. Tail = mean / median of fork@4. Cost bound = work / critical path from the per-node times of the timed serial mode (1 thread).\n');
p('| workload | W_best / T4 median | W_best / T4 mean | **gate ratio** | verdict (>= 1.2) | W4 / T4 median | fork@4 tail | cold W_best / T4 | cost-weighted bound | op-count bound | serial work ms | largest node share |');
p('|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|');
for (const [t, r] of Object.entries(W)) {
  const g = r.native.gate, cw = r.costWeighted;
  const share = cw.workUs ? cw.top[0].us / cw.workUs : null;
  p(`| ${t} | ${f(g.median.ratio)} (${f(g.median.W_best_ms, 3)} / ${f(g.median.T4_ms, 3)}) | ${f(g.mean.ratio)} (${f(g.mean.W_best_ms, 3)} / ${f(g.mean.T4_ms, 3)}) | **${f(g.ratio)}** | ${g.verdict} | ${f(g.median.ratioSameThreads)} | ${f(g.tailFork4)} | ${f(g.coldRatio)} | ${f(cw.costBound)} | ${f(cw.opCountBound)} | ${f(cw.workUs / 1000, 3)} | ${f(100 * share, 1)} % |`);
  summary.workloads[t] = { gateRatio: g.ratio, verdict: g.verdict, median: g.median, mean: g.mean, tailFork4: g.tailFork4, costBound: cw.costBound, opCountBound: cw.opCountBound, workMs: cw.workUs / 1000 };
}

const gateRuns = read('gate-runs.json');
if (gateRuns) {
  p(`\n## Gate robustness: the whole native matrix repeated ${gateRuns.runs} times (--phases gate)\n`);
  p('A workload passes robustly only if its gate ratio (the smaller of the median and mean W_best / T4) is >= 1.2 in every run.\n');
  p('| workload | runs passing | gate ratio min | max | median of runs | robust pass | load (1 min) |');
  p('|---|---:|---:|---:|---:|---|---|');
  for (const [t, w] of Object.entries(gateRuns.workloads)) {
    p(`| ${t} | ${w.rows.filter(r => r.ratio >= 1.2).length} of ${w.rows.length} | ${f(w.min)} | ${f(w.max)} | ${f(median(w.rows.map(r => r.ratio)))} | ${w.robustPass ? 'yes' : 'no'} | ${loads(w.rows)} |`);
    if (summary.workloads[t]) Object.assign(summary.workloads[t], { gateRuns: w.rows.length, gateRunsPassing: w.rows.filter(r => r.ratio >= 1.2).length, gateMin: w.min, gateMax: w.max, robustPass: w.robustPass });
  }
}

p('\n## Per-node cost by op (timed serial mode, 1 thread, median over n)\n');
p('| workload | op | count | total µs | µs per node |');
p('|---|---|---:|---:|---:|');
for (const [t, r] of Object.entries(W)) for (const [op, v] of Object.entries(r.costWeighted.byOp)) p(`| ${t} | ${op} | ${v.count} | ${v.us} | ${f(v.us / v.count, 1)} |`);

p('\n## Buckets: today\'s path against the native graph path (ms, median over n)\n');
p('Today (JS target, fresh process): import, kernel load, build (cold, in-process: parser + interpreter + kernel + identity), warm build, export (model JSON). Kernel entries inside build: separate counted run. Native graph path: record (host), encode (host), native process (decode + eval + process start and output serialization in Bend; the sum over the graph\'s stages), host decode between stages (today\'s decoders on the operands of the PIERCE stage, fix round 3), parse + body decode (host), identity (today\'s identity entries on the JS target; cold and memoized), export (body JSON).\n');
p('| workload | today: process | import | kernel load | build | warm build | kernel entries in build | export | status | native: record | encode | stages | process fork@4 | of which decode | eval | start + output | between stages | parse | decode | identity cold / memo | export |');
p('|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|');
for (const [t, r] of Object.entries(W)) {
  const js = r.js.runs;
  const m = k => median(js.map(x => x[k]));
  const warm = median(js.flatMap(x => x.warmMs ?? []));
  const fork4 = r.native.matrix.filter(x => x.mode === 'fork' && x.threads === 4);
  const proc = median(fork4.map(x => x.processWallMs)), dec = median(fork4.map(x => x.decodeMs)), ev = median(fork4.map(x => x.repsMs.reduce((s, y) => s + y, 0)));
  const other = median(fork4.map(x => x.overheadMs));
  p(`| ${t} | ${f(m('processWallMs'), 0)} | ${f(m('importMs'), 0)} | ${f(m('kernelMs'), 0)} | ${f(m('buildMs'), 1)} | ${f(warm, 1)} | ${f(r.js.counted?.kernelEntryMs, 1)} | ${f(m('exportMs'), 1)} | ${r.js.status} | ${f(r.record.medianMs, 1)} | ${f(r.encode.medianMs, 2)} | ${r.encode.stages?.length ?? 1} | ${f(proc, 1)} (${r.reps} reps) | ${f(dec, 2)} | ${f(ev, 1)} | ${f(other, 1)} | ${f(r.encode.hostDecodeBetweenStagesMs, 1)} | ${f(r.host.parseMs, 1)} | ${f(r.host.decodeMs, 1)} | ${f(r.host.identityMs, 1)} / ${f(r.host.identityWarmMs, 1)} | ${f(r.host.exportMs, 1)} |`);
  Object.assign(summary.workloads[t], { jsProcessMs: m('processWallMs'), jsKernelLoadMs: m('kernelMs'), jsBuildMs: m('buildMs'), jsWarmMs: warm, jsKernelEntryMs: r.js.counted?.kernelEntryMs ?? null,
    jsStatus: r.js.status, recordMs: r.record.medianMs, encodeMs: r.encode.medianMs, nativeProcessFork4Ms: proc, nativeReps: r.reps, nativeOutputMs: other, stages: r.encode.stages?.length ?? 1, hostBetweenStagesMs: r.encode.hostDecodeBetweenStagesMs ?? null,
    parseMs: r.host.parseMs, decodeMs: r.host.decodeMs, identityMs: r.host.identityMs, identityMemoMs: r.host.identityWarmMs, exportMs: r.host.exportMs });
}

p('\n## Op-at-a-time native through today\'s binding (WONKY_BACKEND=native)\n');
p('| workload | status | build ms | process ms | note |');
p('|---|---|---:|---:|---|');
for (const [t, r] of Object.entries(W)) {
  const o = r.js.opAtATime;
  p(`| ${t} | ${o.status} | ${f(o.buildMs, 1)} | ${f(o.processWallMs, 0)} | ${(o.error?.message ?? o.kernelError?.message ?? '').slice(0, 140)} |`);
}

const edits = read('edits.json');
if (edits) {
  p('\n## Edits with the host cache (fork@4; median over n)\n');
  p('Changed = geom hash not in the cache after the edit; re-evaluated = changed plus error nodes (errors are never cached: their span id would go stale).\n');
  p('| edit | changed (heavy) | re-evaluated / all | heavy re-evaluated / all | literals sent | incremental eval ms warm (first rep) | cold-graph eval ms warm (first rep) | incremental process ms | cold process ms | identity calls inc / cold | equal to cold (nodes, outputs) | today\'s build of the edit | load |');
  p('|---|---:|---:|---:|---:|---|---|---:|---:|---|---|---|---|');
  for (const e of edits.edits) p(`| ${e.tag}:${e.line}:${e.column} \`${e.from}\`→\`${e.to}\` | ${e.graph.changed} (${e.graph.heavyChanged}) | ${e.graph.dirty} / ${e.graph.nodes} | ${e.graph.heavyDirty} / ${e.graph.heavy} | ${e.graph.literals} | ${f(e.incremental.medianEvalMs, 3)} (${f(e.incremental.medianColdEvalMs, 3)}) | ${f(e.cold.medianEvalMs, 3)} (${f(e.cold.medianColdEvalMs, 3)}) | ${f(e.incremental.medianProcessMs, 1)} | ${f(e.cold.medianProcessMs, 1)} | ${e.incremental.identityCalls} / ${e.cold.identityCalls} | ${e.equalToCold.nodes}, ${e.equalToCold.outputs} | ${e.js.status}${e.js.outputsEqual !== undefined ? `, whole model equal: ${e.js.outputsEqual}${e.js.jsonIdentical ? ' (byte-identical)' : ''}` : ''} | ${loads([...e.incremental.runs, ...e.cold.runs])} |`);
}
const failures = read('failures.json');
if (failures) {
  p('\n## Loud failures\n');
  p('| case | error kind | FS span | message | outputs |');
  p('|---|---|---|---|---|');
  for (const x of failures.failures) p(`| ${x.tag} | ${x.error?.kind ?? 'NONE'} | ${x.error?.file?.split('/').pop()}:${x.error?.line}:${x.error?.column} | ${x.error?.message?.slice(0, 120)} | ${[...new Set(x.outputs)].join('/')} |`);
}
const reg = read('regression.json');
if (reg) {
  p('\n## Regression\n');
  p(`frame-with-tab from FS (recorder) and build123d: identical canonical graph: ${reg.frameGraphs.identical}, output hash FS ${reg.frameGraphs.fsHash} / build123d ${reg.frameGraphs.pyHash}; earlier native evaluator on the recorder graph: ${JSON.stringify(reg.frameGraphs.oldEvaluatorBody)}\n`);
  p('| program | today\'s build | ms | recorder | op sequence equal | native | whole model equal (bodies incl. identity and operationHistory, evidence, source map) |');
  p('|---|---|---:|---|---|---|---|');
  for (const x of reg.programs) p(`| ${x.file} | ${x.build === 'ok' ? 'ok' : x.build.slice(0, 60)} | ${f(x.buildMs, 0)} | ${x.record.slice(0, 70)} | ${x.opsEqual} (${x.ops.join('/')}) | ${(x.native ?? '–').slice(0, 90)} | ${x.bodiesEqual === undefined ? '–' : `${x.bodiesEqual}${x.jsonIdentical ? ' (byte-identical)' : ''}`} |`);
}
const partial = read('partial.json');
if (partial) {
  p(`\n## First error of every step-0 candidate (partial graphs evaluated): ${partial.same} of ${partial.of} equal to today's first error (span and message); ${partial.maskedBefore} would have been masked by the recorder's own stop\n`);
  p('| candidate | recorder | recorder stop | first error (origin) | today | same |');
  p('|---|---|---|---|---|---|');
  for (const x of partial.rows) p(`| ${x.tag} | ${x.record} | ${x.recorderStop ? `${x.recorderStop.line}:${x.recorderStop.column}` : '–'} | ${x.first ? `${x.first.line}:${x.first.column} ${x.first.kind} (${x.first.origin})` : 'none'} | ${x.today ? `${x.today.line}:${x.today.column}` : 'ok'} | ${x.same ? 'yes' : 'NO'} |`);
}
const chain = read('chain.json');
if (chain) {
  p(`\n## Chains of dependent Booleans (plate with N holes, scripts/lang/wk-chain.mjs; child processes with a ${chain.heapLimitMB} MB heap)\n`);
  p('| path | N | status | native eval ms | identity MB | operationHistory MB | model JSON MB | identity replay ms | peak RSS GB | error | load |');
  p('|---|---:|---|---:|---:|---:|---:|---:|---:|---|---|');
  for (const x of chain.rows) p(`| ${x.kind} | ${x.n} | ${x.status} | ${f(x.nativeEvalMs, 1)} | ${f((x.identityBytes ?? 0) / 1e6, 1)} | ${f((x.historyBytes ?? 0) / 1e6, 1)} | ${f((x.modelBytes ?? 0) / 1e6, 1)} | ${f(x.identityMs, 0)} | ${f(x.peakRssGB, 2)} | ${(x.error?.message ?? x.stderr ?? '').slice(0, 110)} | ${x.loadBefore} |`);
}
const builds = read('build/builds.json');
if (builds) {
  p('\n## Evaluator builds\n');
  p('| build | step | wall s | peak RSS GB | load before → after |');
  p('|---|---|---:|---:|---|');
  for (const b of builds.builds) for (const s of b.steps) p(`| ${b.builtAt} | ${s.label} | ${f(s.wallS, 1)} | ${f(s.peakRssGB, 2)} | ${s.loadBefore} → ${s.loadAfter} |`);
}
writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
console.log(lines.join('\n'));
