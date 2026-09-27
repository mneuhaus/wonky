// End-to-end native runs of staged WK graphs (proposal-core-ir.md §7.4).
//
//   source (FS or build123d) -> host staging -> canonical WK graph -> integer
//   stream -> native Bend evaluator with the production planar kernel
//   (out/lang/wk/build/wk-native, built from kernel/lang/wk/main.bend)
//
// Checks: result hashes and volume words equal the direct-kernel reference of
// the language spike / native build123d workload; identical results for 1, 2
// and 4 threads; span-mapped errors. Measures: host staging, encode, native
// process wall, native evaluation per graph, memo reuse after an edit.
// Usage: node scripts/lang/wk-native.mjs [out/lang/wk/native.json] [--reps N]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';
import { stageFeatureScript } from '../../src/lang/wk/stage-fs.mjs';
import { stagePython } from '../../src/lang/wk/stage-py.mjs';
import { canonicalize } from '../../src/lang/wk/canon.mjs';
import { contentHashes, printGraph } from '../../src/lang/wk/ir.mjs';
import { encodeSession } from '../../src/lang/wk/encode-bend.mjs';

const args = process.argv.slice(2);
const out = args.find(a => a.endsWith('.json')) ?? 'out/lang/wk/native.json';
const reps = Number(args[args.indexOf('--reps') + 1] ?? 3) || 3;
const BIN = 'out/lang/wk/build/wk-native';
const PY = 'out/build123d-performance/reference-venv/bin/python';
const load = () => execSync('uptime').toString().trim().replace(/.*load averages?: /, '');
mkdirSync('tmp/lang/wk', { recursive: true });

// Reference results of the SAME kernel calls without any language
// (out/lang/spike/run-2/report.json, direct kernel calls in the spike binary).
const REFERENCE = { 'frame-with-tab': { body: { body: { hash: 3141504600, hiBits: 1180188672, loBits: 739621607, errors: 0, faces: 64 } }, volume: { hi: 1180188672, lo: 739621607 }, faces: 64 } };

async function stage(kind, file) {
  const source = readFileSync(file, 'utf8');
  const t0 = performance.now();
  const r = kind === 'fs' ? stageFeatureScript(source, { file: file.split('/').pop() })
    : await stagePython(source, { filename: file.split('/').pop(), python: PY });
  const t1 = performance.now();
  if (r.error || r.graphBreak || r.failure || r.capability) throw r.error ?? r.graphBreak ?? r.failure ?? r.capability;
  const c = canonicalize(r.graph).graph;
  return { graph: c, stageMs: t1 - t0, source, file };
}
function runNative(graphs, threads, label) {
  const t0 = performance.now();
  const enc = encodeSession(graphs, graphs.map(contentHashes));
  const t1 = performance.now();
  const path = `tmp/lang/wk/${label}.wk`;
  writeFileSync(path, enc.text);
  const t2 = performance.now();
  const stdout = execFileSync(BIN, ['--threads', String(threads), '--gpu', 'off', '--', path], { env: { ...process.env, BEND_NO_TELEMETRY: '1' }, maxBuffer: 1 << 26 }).toString();
  const t3 = performance.now();
  const lines = stdout.trim().split('\n').map(l => JSON.parse(l));
  return { encodeMs: t1 - t0, tokens: enc.tokens, processMs: t3 - t2, decodeMs: lines[0].decodeMs, graphs: lines.slice(1), reports: enc.reports };
}
const num = v => v?.num ?? null;
const bodyOf = v => v?.body ? { hash: v.body.hash ?? v.body.solid ?? v.body, faces: v.faces } : null;
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const report = { schema: 'wonky-lang-wk-native/1', generatedAt: new Date().toISOString(), binary: BIN, load: { start: load() }, cases: {} };

// 1. frame-with-tab through both frontends: same graph, same native result as the direct kernel calls.
const fsFrame = await stage('fs', 'kernel/lang/wk/cases/frame-with-tab.fs');
const pyFrame = await stage('py', 'fixtures/performance-build123d/cases/frame-with-tab.py');
const hf = contentHashes(fsFrame.graph), hp = contentHashes(pyFrame.graph);
report.cases.frameWithTab = {
  graphIdenticalAcrossFrontends: hf[fsFrame.graph.outputs[0].value.node] === hp[pyFrame.graph.outputs[0].value.node],
  stageMs: { featurescript: fsFrame.stageMs, build123d: pyFrame.stageMs },
  graph: printGraph(pyFrame.graph, { spans: false, ids: false }).split('\n'),
  runs: {},
};
for (const threads of [1, 4]) {
  const samples = [];
  for (let i = 0; i < reps; i++) samples.push(runNative([pyFrame.graph], threads, `frame-t${threads}`));
  const first = samples[0].graphs[0];
  report.cases.frameWithTab.runs[`t${threads}`] = {
    evalMs: samples.map(s => s.graphs[0].evalMs), processMs: samples.map(s => Math.round(s.processMs)), encodeMs: samples[0].encodeMs, tokens: samples[0].tokens,
    outputs: first.outputs, rounded: samples[0].reports[0].rounded.length,
    identicalAcrossReps: samples.every(s => JSON.stringify(s.graphs[0].outputs) === JSON.stringify(first.outputs)), load: load(),
  };
}
const frameOut = report.cases.frameWithTab.runs.t1.outputs;
const ref = REFERENCE['frame-with-tab'];
report.cases.frameWithTab.matchesDirectKernel = JSON.stringify(frameOut[0]) === JSON.stringify(ref.body) && frameOut[1]?.hi === ref.volume.hi && frameOut[1]?.lo === ref.volume.lo && frameOut[2]?.num === ref.faces;
report.cases.frameWithTab.reference = { source: 'out/lang/spike/run-2/report.json kernel[frame-with-tab].refValue (direct kernel calls, no language)', ...ref };
report.cases.frameWithTab.identicalAcrossThreads = JSON.stringify(report.cases.frameWithTab.runs.t1.outputs) === JSON.stringify(report.cases.frameWithTab.runs.t4.outputs);

// 2. four independent pockets from plain FeatureScript: fork-join found from the dataflow.
const pockets = await stage('fs', 'kernel/lang/wk/cases/four-pockets.fs');
report.cases.fourPockets = { stageMs: pockets.stageMs, nodes: pockets.graph.nodes.length, runs: {} };
for (const threads of [1, 2, 4]) {
  const samples = [];
  for (let i = 0; i < reps; i++) samples.push(runNative([pockets.graph], threads, `pockets-t${threads}`));
  report.cases.fourPockets.runs[`t${threads}`] = { evalMs: samples.map(s => s.graphs[0].evalMs), processMs: samples.map(s => Math.round(s.processMs)),
    levels: samples[0].reports[0].levels.map(l => l.length), rounded: samples[0].reports[0].rounded, outputs: samples[0].graphs[0].outputs, load: load() };
}
const pk = report.cases.fourPockets.runs;
report.cases.fourPockets.identicalAcrossThreads = JSON.stringify(pk.t1.outputs) === JSON.stringify(pk.t2.outputs) && JSON.stringify(pk.t1.outputs) === JSON.stringify(pk.t4.outputs);
report.cases.fourPockets.speedup = { t2: median(pk.t1.evalMs) / median(pk.t2.evalMs), t4: median(pk.t1.evalMs) / median(pk.t4.evalMs) };

// 2b. Eight pockets (the same file with the loop bound 4 -> 8): scaling to 8 threads.
writeFileSync('tmp/lang/wk/eight-pockets.fs', readFileSync('kernel/lang/wk/cases/four-pockets.fs', 'utf8').replace('i < 4; i += 1', 'i < 8; i += 1'));
const eight = await stage('fs', 'tmp/lang/wk/eight-pockets.fs');
report.cases.eightPockets = { source: 'kernel/lang/wk/cases/four-pockets.fs with the loop bound 4 -> 8', runs: {} };
for (const threads of [1, 2, 4, 8]) {
  const samples = [];
  for (let i = 0; i < Math.min(reps, 2); i++) samples.push(runNative([eight.graph], threads, `eight-t${threads}`));
  report.cases.eightPockets.runs[`t${threads}`] = { evalMs: samples.map(x => x.graphs[0].evalMs), outputs: samples[0].graphs[0].outputs, load: load() };
}
const ep = report.cases.eightPockets.runs;
report.cases.eightPockets.identicalAcrossThreads = ['t2', 't4', 't8'].every(k => JSON.stringify(ep[k].outputs) === JSON.stringify(ep.t1.outputs));
report.cases.eightPockets.speedup = Object.fromEntries(['t2', 't4', 't8'].map(k => [k, median(ep.t1.evalMs) / median(ep[k].evalMs)]));

// 3. Content-hash reuse (H4): the tab moves by 1 mm, everything upstream is reused.
const edited = pyFrame.source.replace('Pos(48, 10, 0)', 'Pos(47, 10, 0)');
if (edited === pyFrame.source) throw new Error('edit did not apply');
writeFileSync('tmp/lang/wk/frame-with-tab-edit.py', edited);
const pyEdit = await stage('py', 'tmp/lang/wk/frame-with-tab-edit.py');
const he = contentHashes(pyEdit.graph);
report.cases.memoAfterEdit = { edit: 'tab Pos(48, 10, 0) -> Pos(47, 10, 0)', unchangedNodes: pyEdit.graph.nodes.filter(n => hp.includes(he[n.n])).length, nodes: pyEdit.graph.nodes.length, runs: [] };
for (let i = 0; i < reps; i++) {
  const cold = runNative([pyEdit.graph], 1, 'edit-cold');
  const warm = runNative([pyFrame.graph, pyEdit.graph], 1, 'edit-warm');
  report.cases.memoAfterEdit.runs.push({ coldEditMs: cold.graphs[0].evalMs, sessionFirstMs: warm.graphs[0].evalMs, sessionEditMs: warm.graphs[1].evalMs,
    memoHits: warm.graphs[1].memoHits, sameResult: JSON.stringify(cold.graphs[0].outputs) === JSON.stringify(warm.graphs[1].outputs), load: load() });
}

// 4. Errors come back as span ids and map to source lines.
const badSource = pyFrame.source.replace('result = frame + tab', 'result = frame + tab\n');
const bad = await stage('py', 'fixtures/performance-build123d/cases/frame-with-tab.py');
bad.graph.nodes[0].args.delta = [0, 0, -10]; // a downward extrusion: outside the native subset -> preflight error
try { encodeSession([bad.graph], [contentHashes(bad.graph)]); report.cases.preflight = { error: null }; }
catch (error) { report.cases.preflight = { error: error.message, node: error.node, source: bad.graph.spans[error.span] ?? null }; }
void badSource;
const check = await stage('fs', 'kernel/lang/wk/cases/frame-with-tab.fs');
const vol = check.graph.nodes.length;
check.graph.nodes.push({ n: vol, op: 'expect_range', args: { of: check.graph.outputs[0].value, lo: 0, hi: 1 }, type: 'check', id: 'model/check', span: check.graph.nodes.at(-1).span, stack: null, attrs: null, region: null });
// expect_range on a body (not a number) must fail with the node's span, natively.
const errRun = runNative([check.graph], 1, 'error');
const errOut = errRun.graphs[0].outputs.find(o => o?.error);
report.cases.nativeError = { error: errOut ?? null, mappedTo: errOut ? check.graph.spans[errOut.span] ?? null : null };

report.load.end = load();
writeFileSync(out, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ frame: { identicalGraph: report.cases.frameWithTab.graphIdenticalAcrossFrontends, matchesDirectKernel: report.cases.frameWithTab.matchesDirectKernel,
  threadsIdentical: report.cases.frameWithTab.identicalAcrossThreads, t1: report.cases.frameWithTab.runs.t1.evalMs, t4: report.cases.frameWithTab.runs.t4.evalMs, out: frameOut },
  eight: { identical: report.cases.eightPockets.identicalAcrossThreads, speedup: report.cases.eightPockets.speedup, t1: ep.t1.evalMs, t8: ep.t8.evalMs },
  pockets: { identical: report.cases.fourPockets.identicalAcrossThreads, t1: pk.t1.evalMs, t2: pk.t2.evalMs, t4: pk.t4.evalMs, levels: pk.t1.levels, rounded: pk.t1.rounded.length },
  memo: report.cases.memoAfterEdit, preflight: report.cases.preflight, nativeError: report.cases.nativeError, load: report.load }, null, 1));
