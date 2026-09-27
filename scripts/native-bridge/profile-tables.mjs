#!/usr/bin/env node
// Renders the markdown tables for docs/native-bridge/profile.md from
// out/native-bridge/profile/summary.json, analysis/*.json and startup-phases.json.
// The numbers in the report come from here; nothing is typed by hand.
//
//   node scripts/native-bridge/profile-tables.mjs > tmp/native-bridge/profile-tables.md
//   node scripts/native-bridge/profile-tables.mjs --render scripts/native-bridge/profile-report.template.md docs/native-bridge/profile.md
// --render replaces every line `{{Title prefix}}` in the template with the
// generated section whose title starts with that prefix (as a #### heading).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const profile = join(root, 'out/native-bridge/profile');
const summary = JSON.parse(readFileSync(join(profile, 'summary.json'), 'utf8'));
const phases = existsSync(join(profile, 'startup-phases.json')) ? JSON.parse(readFileSync(join(profile, 'startup-phases.json'), 'utf8')) : null;
const detail = id => JSON.parse(readFileSync(join(profile, 'analysis', `${id}.json`), 'utf8'));
const ids = Object.keys(summary.workloads);
const booleanSet = ['py-planar-union', 'py-planar-pocket', 'py-frame-with-tab', 'fs-fuse-g1', 'fs-cut-h1'];
const pct = x => x === undefined || x === null ? '' : `${(100 * x).toFixed(1)}%`;
const ms = x => x === undefined || x === null ? '' : x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2);
// Columns whose cells all look numeric are right-aligned, the rest left-aligned.
const numeric = cell => /^\**[\d.,%x \-/()]*[\d%x]\**$|^$/.test(String(cell ?? ''));
const table = (header, rows) => [`| ${header.join(' | ')} |`,
  `|${header.map((h, i) => rows.every(r => numeric(r[i])) ? '---:' : '---').join('|')}|`,
  ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n');
const out = [];
const section = (title, body) => out.push(`### ${title}\n\n${body}\n`);

// T1 runs
section('Runs', table(['workload', 'plain wall ms (2 runs)', 'profiled ms', 'count-run kernel ms', 'kernel / count-run wall', 'user s', 'max RSS MiB', 'load 1m', 'exit'],
  ids.map(id => {
    const w = summary.workloads[id], c = w.calls;
    return [id, w.runs.plain.map(r => r.wallMs).join(' / '), ms(w.profile.durationMs), ms(c?.kernelInclusiveMs), pct(c?.kernelInclusiveShareOfRun),
      w.runs.plain[0]?.userS, w.runs.plain[0]?.maxRssMiB, `${w.runs.profile?.load1Before}-${w.runs.plain.at(-1)?.load1After}`,
      `${w.runs.plain[0]?.exitCode} (exp. ${w.runs.plain[0]?.expectedExit})`];
  })));

// T2 attributed shares
const cols = ['processStart', 'moduleLoading', 'bendLoad', 'frontendParse', 'interpreter', 'kernel', 'hostAdaptation', 'export', 'program', 'nodeRuntime'];
section('Bucket shares, GC and idle re-attributed to the preceding bucket (primary basis)',
  table(['workload', 'Node start', 'ESM modules', 'Bend JS load', 'parse / Py bridge', 'interpreter', '**kernel**', 'host adapt.', 'export', 'V8 (program)', 'other'],
    ids.map(id => { const s = summary.workloads[id].bucketSharesAttributed; return [id, ...cols.map(c => c === 'kernel' ? `**${pct(s[c])}**` : pct(s[c]))]; })));
section('Bucket milliseconds, raw (GC and idle as their own buckets)',
  table(['workload', 'Node start', 'ESM modules', 'Bend JS load', 'parse / Py bridge', 'interpreter', 'kernel', 'host adapt.', 'export', 'GC', 'idle', 'other'],
    ids.map(id => { const b = summary.workloads[id].bucketsMs;
      return [id, ...['processStart', 'moduleLoading', 'bendLoad', 'frontendParse', 'interpreter', 'kernel', 'hostAdaptation', 'export', 'gc', 'idle'].map(c => ms(b[c])),
        ms((b.program ?? 0) + (b.nodeRuntime ?? 0) + (b.other ?? 0))]; })));
section('Where GC and idle go (ms re-attributed by preceding bucket)',
  table(['workload', 'raw GC ms', 'GC share', 'GC -> kernel', 'idle ms', 'idle -> Bend load', 'idle -> ESM', 'idle -> Py bridge'],
    ids.map(id => { const w = summary.workloads[id], a = detail(id).analysis;
      const gcToKernel = a.bucketsGcAttributedMs.kernel - a.bucketsMs.kernel;
      return [id, ms(a.bucketsMs.gc), pct(a.bucketShares.gc), ms(gcToKernel), ms(a.bucketsMs.idle), ms(w.idleByPrecedingBucketMs.bendLoad),
        ms(w.idleByPrecedingBucketMs.moduleLoading), ms(w.idleByPrecedingBucketMs.frontendParse)]; })));

// T3 startup
if (phases) {
  const m = phases.median;
  section('Startup phases (fresh processes, warm Bend cache, medians of 5)', [
    table(['phase', 'ms'], [
      ['`node -e 0` (profile-workloads startup mode, min of 5)', ms(summary.startup?.nodeEmpty?.minMs)],
      ['`bin/wonky.mjs --help` (min of 5)', ms(summary.startup?.fsHelp?.minMs)],
      ['`bin/wonky-python.mjs --help` (min of 5)', ms(summary.startup?.pyHelp?.minMs)],
      ['process start to first script line', ms(m.processToScript)],
      ['import src/index.mjs graph (before hooks)', ms(m.frontendGraph)],
      ['registerBendImports() (Bend compiler main.ts, TypeScript strip, hooks)', ms(m.bendImports)],
      ['18 x compileBend() cache hit (fingerprint, read, verify)', ms(m.fingerprintAndReadMs)],
      ['18 x import() of data: module', ms(m.importMs)],
      ['**loadKernel() total**', `**${ms(m.loadKernelTotal)}**`],
      ['spawn reference Python `-I -S -B -u -c pass`', ms(m.pythonSpawnMs)],
    ]),
    '',
    table(['Bend module (loadKernel order)', 'emitted JS KiB', 'compileBend ms', 'import ms'],
      phases.perModule.map(p => [p.entry, p.sourceKiB, ms(p.compileBendMsMedian), ms(p.importMsMedian)])),
    '',
    `Load averages during the phase runs: ${phases.runs.map(r => r.loadBefore[0]).join(', ')}.`,
  ].join('\n'));
}

// T4 kernel by Bend file (share of kernel self time)
const kernelFiles = new Map();
for (const id of ids) {
  const a = detail(id).analysis, k = a.kernel.ms || 1;
  for (const f of a.kernel.byBendFile) {
    if (!kernelFiles.has(f.name)) kernelFiles.set(f.name, {});
    kernelFiles.get(f.name)[id] = f.ms / k;
  }
}
const kernelIds = ids.filter(id => detail(id).analysis.kernel.ms > 50);
const fileRows = [...kernelFiles].map(([name, byId]) => [name, byId])
  .sort((a, b) => kernelIds.reduce((s, id) => s + (b[1][id] ?? 0), 0) - kernelIds.reduce((s, id) => s + (a[1][id] ?? 0), 0)).slice(0, 16);
section('Kernel self time by Bend source file (share of each workload\'s kernel time; workloads with > 50 ms kernel)',
  table(['Bend file', ...kernelIds], fileRows.map(([name, byId]) => [name, ...kernelIds.map(id => pct(byId[id]))])));
section('Kernel time by host entry module and host call site',
  table(['workload', 'kernel ms', 'top entry module (share of run)', 'top host call site (share of run)', 'kernel under export'],
    kernelIds.map(id => { const k = detail(id).analysis.kernel;
      const exp = k.byCallerBucket.find(b => b.name.startsWith('export'));
      return [id, ms(k.ms), `${k.byEntryModule[0].name} (${pct(k.byEntryModule[0].share)})`, `${k.byHostCaller[0].name} (${pct(k.byHostCaller[0].share)})`, exp ? `${ms(exp.ms)} ms` : '0']; })));

// T5 top-20 self hot functions
function mergeTop(list, key) {
  const merged = new Map();
  for (const id of list) for (const f of detail(id).analysis[key]) {
    const k = `${f.bucket ?? 'kernel'}\t${f.name}`;
    merged.set(k, (merged.get(k) ?? 0) + f.ms);
  }
  const total = list.reduce((s, id) => s + detail(id).analysis.sampledMs, 0);
  return [...merged].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, v], i) => { const [bucket, name] = k.split('\t');
    return [i + 1, `\`${name}\``, bucket, ms(v), pct(v / total)]; });
}
section(`Top-20 self-time functions, Boolean set summed (${booleanSet.join(', ')})`, table(['#', 'function (Bend file:definition or JS file:function:line)', 'bucket', 'ms', 'share'], mergeTop(booleanSet, 'topSelf')));
section('Top-20 self-time functions, fs-r10b-strict', table(['#', 'function', 'bucket', 'ms', 'share'], mergeTop(['fs-r10b-strict'], 'topSelf')));
section('Top-20 self-time functions, fs-bracket (startup-dominated)', table(['#', 'function', 'bucket', 'ms', 'share'], mergeTop(['fs-bracket'], 'topSelf')));
function inclusiveTop(list, n) {
  const merged = new Map();
  for (const id of list) for (const f of detail(id).analysis.kernel.topInclusive) merged.set(f.name, (merged.get(f.name) ?? 0) + f.ms);
  const total = list.reduce((s, id) => s + detail(id).analysis.sampledMs, 0);
  return [...merged].sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, v], i) => [i + 1, `\`${name}\``, ms(v), pct(v / total)]);
}
section('Top Bend definitions by inclusive time, Boolean set summed', table(['#', 'Bend definition', 'ms', 'share'], inclusiveTop(booleanSet, 12)));
section('Top Bend definitions by inclusive time, fs-r10b-strict', table(['#', 'Bend definition', 'ms', 'share'], inclusiveTop(['fs-r10b-strict'], 12)));

// T7 host adaptation / non-kernel sub-buckets
const subs = new Map();
for (const id of ids) for (const s of detail(id).analysis.subBuckets) {
  if (!['hostAdaptation', 'interpreter', 'frontendParse', 'export'].includes(s.bucket)) continue;
  const k = `${s.bucket}\t${s.name}`;
  if (!subs.has(k)) subs.set(k, {});
  subs.get(k)[id] = s.ms;
}
section('Host adaptation, interpreter, frontend and export sub-buckets (ms, raw)',
  table(['bucket', 'source', ...ids], [...subs].sort((a, b) => Object.values(b[1]).reduce((s, v) => s + v, 0) - Object.values(a[1]).reduce((s, v) => s + v, 0))
    .slice(0, 22).map(([k, byId]) => { const [bucket, name] = k.split('\t'); return [bucket, name, ...ids.map(id => ms(byId[id]))]; })));

// T8 calls
section('Host -> kernel calls (separate instrumented run)',
  table(['workload', 'calls', 'entries', '<10 us', '<100 us', '<1 ms', '<10 ms', '>=10 ms', 'largest call', 'arg / result nodes', 'est. wire KiB in / out', 'args from earlier kernel results', 'est. binding overhead ms'],
    ids.map(id => { const c = summary.workloads[id].calls, h = c.histogram, e = c.entries[0];
      const p = summary.workloads[id].projections.attributed;
      return [id, c.outerCalls, c.distinctEntries, h['<10us'], h['<100us'], h['<1ms'], h['<10ms'], h['>=10ms'],
        `\`${e.name.replace('kernel/', '')}\` ${ms(e.ms)} ms (${pct(e.ms / c.kernelInclusiveMs)} of kernel)`,
        `${c.argNodes} / ${c.resultNodes}`, `${(c.estimatedWireBytes.args / 1024).toFixed(0)} / ${(c.estimatedWireBytes.results / 1024).toFixed(0)}`,
        pct(c.argReusedShare), ms(p.bindingOverheadEstimateMs)]; })));
const entries = new Map();
for (const id of ids) for (const e of detail(id).calls.entries) {
  const v = entries.get(e.name) ?? { calls: 0, ms: 0, workloads: new Set(), argNodes: 0, maxArg: 0, maxFacesIn: 0 };
  v.calls += e.calls; v.ms += e.ms; v.workloads.add(id); v.argNodes += e.argNodesPerCall * e.calls;
  v.maxArg = Math.max(v.maxArg, e.argNodesPerCall); v.maxFacesIn = Math.max(v.maxFacesIn, e.facesInPerCall);
  entries.set(e.name, v);
}
section('Kernel entry points across all workloads (by inclusive ms)',
  table(['entry (Bend module:export)', 'workloads', 'calls', 'ms', 'mean ms', 'max arg nodes/call', 'max faces in/call'],
    [...entries].sort((a, b) => b[1].ms - a[1].ms).slice(0, 18).map(([name, v]) =>
      [`\`${name.replace('kernel/', '')}\``, v.workloads.size, v.calls, ms(v.ms), ms(v.ms / v.calls), v.maxArg, v.maxFacesIn])));
section('Entry points by call count (the chatty ones)',
  table(['entry', 'calls', 'ms', 'mean us'],
    [...entries].sort((a, b) => b[1].calls - a[1].calls).slice(0, 10).map(([name, v]) =>
      [`\`${name.replace('kernel/', '')}\``, v.calls, ms(v.ms), (1000 * v.ms / v.calls).toFixed(1)])));

// T10 projections
const kcols = ['7.5', '25', '75'];
const projection = (key, title, basis = 'attributed') => section(title, table(['workload', key === 'residentSession' ? 'U ms' : 'T ms', ...kcols.map(k => `k = ${k}`), 'k -> inf'],
  ids.map(id => { const p = summary.workloads[id].projections[basis], r = p[key];
    return r ? [id, ms(key === 'residentSession' ? p.totalMs - p.startupMs : p.totalMs), ...kcols.map(k => `${r.speedup[k].toFixed(2)}x`), `${r.limit.toFixed(2)}x`] : [id]; })));
projection('kernelOnly', 'A. Kernel k times faster, everything else unchanged: S = T / (T - K + K/k)');
projection('kernelAndHost', 'B. Kernel and host adaptation k times faster: S = T / (T - K - H + (K+H)/k)');
projection('nativeCli', 'C. Native CLI: kernel k times faster and the addon replaces the Bend JS load: S = T / (T - K + K/k - B + L + O)');
projection('residentSession', 'D. Resident session (startup already paid): S = U / (U - K + K/k), U = T - S_start');
projection('kernelOnly', 'A (pessimistic). Raw buckets, GC stays in JS: S = T / (T - K + K/k)', 'raw');
section('Projection inputs (ms, attributed basis)', table(['workload', 'T', 'K kernel', 'H host', 'B Bend load', 'S_start', 'O binding est.', 'L addon'],
  ids.map(id => { const p = summary.workloads[id].projections.attributed;
    return [id, ms(p.totalMs), ms(p.kernelMs), ms(p.hostMs), ms(p.bendLoadMs), ms(p.startupMs), ms(p.bindingOverheadEstimateMs), ms(p.addonLoadMs)]; })));
const renderAt = process.argv.indexOf('--render');
if (renderAt < 0) process.stdout.write(out.join('\n'));
else {
  const [template, target] = process.argv.slice(renderAt + 1);
  const text = readFileSync(template, 'utf8').replace(/^\{\{(.+)\}\}$/gm, (_, prefix) => {
    const found = out.filter(s => s.startsWith(`### ${prefix}`));
    if (found.length !== 1) throw new Error(`Template marker '${prefix}' matches ${found.length} sections`);
    return '#' + found[0].trimEnd();
  });
  writeFileSync(target, text);
  console.log(`wrote ${target}`);
}
