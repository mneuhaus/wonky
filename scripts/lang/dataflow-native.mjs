// Native measurements for the dataflow-graph proposal (docs/language/proposal-dataflow.md).
//
// Frontends produce WGraphs (build123d through wonky's shim, FeatureScript
// through the graph tracer); src/lang/dataflow/lower-spike.mjs lowers them to
// programs of the existing native spike binary (out/lang/spike/build/main,
// Bend 2.0.25, production planar-Boolean kernel linked). No new Bend build.
//
// Measured, each in its own process, sequential samples, load recorded:
//   1. cold evaluation of frame-with-tab and bracket (hash/volume checks);
//   2. incremental re-evaluation after a one-parameter edit, in one process:
//      v1 then v2 with content-hash reuse vs v1 then v2 recomputed;
//   3. a 4-variant parameter sweep: naive (every variant recomputed, sequential),
//      hash-consed (shared nodes once, sequential), hash-consed + fork-join at
//      1/2/4 threads. Every variant's B-rep hash must equal its stand-alone run.
//
//   node scripts/lang/dataflow-native.mjs [--samples 3] [--out out/lang/dataflow/native.json]
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { compileToStream } from '../../src/lang/spike-compile.mjs';
import { tracePython } from '../../src/lang/dataflow/py-trace.mjs';
import { traceFeatureScript } from '../../src/lang/dataflow/fs-trace.mjs';
import { diffGraphs, mergeGraphs, analyze, hashGraph } from '../../src/lang/dataflow/graph.mjs';
import { lowerStages } from '../../src/lang/dataflow/lower-spike.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const argv = process.argv.slice(2);
const option = (f, d) => { const i = argv.indexOf(f); return i < 0 ? d : argv[i + 1]; };
const samples = Number(option('--samples', '3'));
const outPath = join(root, option('--out', 'out/lang/dataflow/native.json'));
const astDir = join(root, 'tmp/lang/dataflow/ast');
mkdirSync(astDir, { recursive: true });
const main = join(root, 'out/lang/spike/build/main');
const prelude = readFileSync(join(root, 'kernel/lang/spike/examples/prelude.core'), 'utf8');
const load = () => loadavg().map(x => Math.round(x * 100) / 100);
const median = xs => { const v = [...xs].sort((a, b) => a - b); const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };

function run(args) {
  return new Promise(resolve => {
    const t = performance.now();
    const child = spawn('/usr/bin/time', ['-l', main, ...args], { cwd: root, env: { ...process.env, BEND_NO_TELEMETRY: '1' } });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; });
    child.on('close', code => {
      const rss = err.match(/(\d+)\s+maximum resident set size/);
      const line = out.trim().split('\n').filter(l => l.startsWith('{')).at(-1);
      let json = null; try { json = JSON.parse(line); } catch { json = null; }
      resolve({ code, wallMs: performance.now() - t, rssBytes: rss ? Number(rss[1]) : null, json, stderr: err.slice(0, 500) });
    });
  });
}
const bodies = value => (Array.isArray(value) ? value : []).map(v => ({ volume: v[0]?.num, volumeWords: v[0] && [v[0].hi, v[0].lo], faces: v[1]?.num, hash: v[2]?.body?.hash, errors: v[2]?.body?.errors }));

async function measure(name, text, { threads = 1 } = {}) {
  const t0 = performance.now();
  const compiled = compileToStream(prelude + '\n' + text, { file: `${name}.core` });
  const compileMs = performance.now() - t0;
  const file = join(astDir, `${name}.ast`);
  writeFileSync(file, compiled.text); writeFileSync(join(astDir, `${name}.core`), text);
  const rows = [];
  for (let i = 0; i < samples; i++) {
    const loadBefore = load();
    const r = await run(['--threads', String(threads), '--gpu', 'off', '--', 'eval', file, '100000000', '1']);
    if (r.code !== 0 || !r.json) throw new Error(`${name}: native run failed (${r.code}) ${r.stderr}`);
    rows.push({ evalMs: r.json.evalMs, decodeMs: r.json.decodeMs, wallMs: Math.round(r.wallMs), rssMB: r.rssBytes && Math.round(r.rssBytes / 1e5) / 10, loadBefore, bodies: bodies(r.json.value) });
  }
  const first = JSON.stringify(rows[0].bodies);
  const result = { name, threads, astInts: compiled.ints.length, hostCompileMs: Math.round(compileMs * 100) / 100, samples: rows.map(r => ({ evalMs: r.evalMs, wallMs: r.wallMs, rssMB: r.rssMB, loadBefore: r.loadBefore })),
    medianEvalMs: median(rows.map(r => r.evalMs)), repeatIdentical: rows.every(r => JSON.stringify(r.bodies) === first), bodies: rows[0].bodies };
  console.log(`${name.padEnd(28)} t=${threads} median ${result.medianEvalMs} ms  bodies ${result.bodies.map(b => `${b.hash}/${b.faces}f/${b.volume}`).join(' ')}  load ${rows[0].loadBefore.join(' ')}`);
  return result;
}

const report = { schema: 'wonky.lang.dataflow-native/1', capturedAt: new Date().toISOString(), loadAtStart: load(), binary: { path: 'out/lang/spike/build/main', sha256: createHash('sha256').update(readFileSync(main)).digest('hex') }, samples, host: {}, runs: {}, checks: {} };

// --- frontends -> graphs ---------------------------------------------------------------------------
const fwtPath = 'fixtures/performance-build123d/cases/frame-with-tab.py';
const fwt = readFileSync(join(root, fwtPath), 'utf8');
const variant = (from, to) => { if (!fwt.includes(from)) throw new Error(`edit anchor missing: ${from}`); return fwt.replace(from, to); };
const t0 = performance.now();
const traced = async (src, label) => { const r = await tracePython(src, { filename: fwtPath }); if (r.status !== 'complete') throw new Error(`${label}: ${r.status}`); return r; };
const v1 = await traced(fwt, 'v1');
report.host.tracePythonMs = Math.round(performance.now() - t0);
const v2 = await traced(variant('Pos(48, 10, 0)', 'Pos(48, 12, 0)'), 'v2 (tab moved)');
const v3 = await traced(variant('Box(34, 24, 12', 'Box(32, 24, 12'), 'v3 (opening narrowed)');
const sweepYs = [4, 10, 16, 20];
const sweep = [];
for (const y of sweepYs) sweep.push(await traced(variant('Pos(48, 10, 0)', `Pos(48, ${y}, 0)`), `sweep y=${y}`));
const t1 = performance.now();
const d12 = diffGraphs(v1.graph, v2.graph, { key: 'geom' }), d13 = diffGraphs(v1.graph, v3.graph, { key: 'geom' });
const merged = mergeGraphs(sweep.map(s => s.graph), { key: 'geom' });
report.host.diffAndMergeMs = Math.round((performance.now() - t1) * 100) / 100;
report.host.diffs = { tabMoved: { heavy: d12.heavy, heavyDirty: d12.heavyDirty, dirty: d12.dirtyNames }, openingNarrowed: { heavy: d13.heavy, heavyDirty: d13.heavyDirty, dirty: d13.dirtyNames } };
report.host.sweep = { variants: sweep.length, heavyNaive: sweep.reduce((s, g) => s + analyze(g.graph).work, 0), heavyMerged: analyze(merged).work, spanMerged: analyze(merged).span };
const bracketTrace = traceFeatureScript(readFileSync(join(root, 'examples/bracket.fs'), 'utf8'), { sourcePath: 'examples/bracket.fs' });

// --- 1. cold ---------------------------------------------------------------------------------------------
report.runs.frameWithTab = await measure('fwt-v1', lowerStages([{ graph: v1.graph }]).text);
report.runs.bracket = await measure('bracket', lowerStages([{ graph: bracketTrace.graph }]).text);
report.runs.v2alone = await measure('fwt-v2', lowerStages([{ graph: v2.graph }]).text);
report.runs.v3alone = await measure('fwt-v3', lowerStages([{ graph: v3.graph }]).text);

// --- 2. incremental in one process ------------------------------------------------------------------------
for (const [label, g] of [['tab', v2], ['opening', v3]]) {
  const cold = lowerStages([{ graph: v1.graph }, { graph: g.graph, reuse: false }]);
  const incr = lowerStages([{ graph: v1.graph }, { graph: g.graph, reuse: true }]);
  report.runs[`${label}Cold`] = await measure(`fwt-v1-then-${label}-cold`, cold.text);
  report.runs[`${label}Incremental`] = await measure(`fwt-v1-then-${label}-incr`, incr.text);
  report.runs[`${label}Incremental`].stageStats = incr.stats;
}

// --- 3. sweep -----------------------------------------------------------------------------------------------
const alone = [];
for (const [i, s] of sweep.entries()) alone.push(await measure(`sweep-alone-y${sweepYs[i]}`, lowerStages([{ graph: s.graph }]).text));
report.runs.sweepAlone = alone;
report.runs.sweepNaive = await measure('sweep-naive-seq', lowerStages(sweep.map(s => ({ graph: s.graph, reuse: false })), { par: false }).text);
report.runs.sweepMergedSeq = await measure('sweep-merged-seq', lowerStages([{ graph: merged }], { par: false }).text);
report.runs.sweepMergedPar = [];
for (const threads of [1, 2, 4]) report.runs.sweepMergedPar.push(await measure(`sweep-merged-par`, lowerStages([{ graph: merged }], { par: true }).text, { threads }));

// --- checks --------------------------------------------------------------------------------------------------
const hashes = r => r.bodies.map(b => b.hash);
report.checks = {
  frameWithTabHashMatchesSpike: report.runs.frameWithTab.bodies[0]?.hash === 3141504600,
  frameWithTabVolume: report.runs.frameWithTab.bodies[0]?.volume,
  bracketVolume: report.runs.bracket.bodies[0]?.volume,
  tabIncrementalEqualsCold: JSON.stringify(hashes(report.runs.tabIncremental)) === JSON.stringify(hashes(report.runs.tabCold)),
  tabIncrementalV2EqualsAlone: hashes(report.runs.tabIncremental)[1] === hashes(report.runs.v2alone)[0],
  openingIncrementalEqualsCold: JSON.stringify(hashes(report.runs.openingIncremental)) === JSON.stringify(hashes(report.runs.openingCold)),
  sweepNaiveEqualsAlone: JSON.stringify(hashes(report.runs.sweepNaive)) === JSON.stringify(alone.map(a => hashes(a)[0])),
  sweepMergedSeqEqualsAlone: JSON.stringify(hashes(report.runs.sweepMergedSeq)) === JSON.stringify(alone.map(a => hashes(a)[0])),
  sweepMergedParEqualsAlone: report.runs.sweepMergedPar.every(r => JSON.stringify(hashes(r)) === JSON.stringify(alone.map(a => hashes(a)[0]))),
  allRepeatsIdentical: Object.values(report.runs).flat().every(r => r.repeatIdentical),
};
report.loadAtEnd = load();
mkdirSync(join(root, 'out/lang/dataflow'), { recursive: true });
writeFileSync(outPath, JSON.stringify(report, null, 1) + '\n');
console.log(JSON.stringify({ host: report.host, checks: report.checks }, null, 1));
