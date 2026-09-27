// Measurement driver of the WK real-model spike (docs/language.md section 12,
// report docs/language/spike-real-model.md, English notes docs/language/prototype.md).
//
// For every workload:
//   record    the unmodified FS interpreter with recording builtins (src/lang/wk/record-fs.mjs)
//   fidelity  recorded op-id / name / span sequence against today's JS build (prefix
//             where today's build stops with an error)
//   js        today's production path in fresh child processes (scripts/lang/wk-real-js.mjs):
//             import, kernel load, build (cold), build (warm), export; once more with
//             the kernel-entry counter; once with WONKY_BACKEND=native (op-at-a-time)
//   oracle    today's kernel adapters on the JS target applied node by node to the
//             recorded graph (src/lang/wk/real-oracle.mjs), errors as values
//   native    kernel/lang/wk/main.bend evaluator: modes fork / seq at 1, 2, 4 threads,
//             n processes each, <reps> evaluations per process (first = cold,
//             rest = warm); timed serial mode for per-node costs
//   host      output parse + body decode, identity replay (today's identity entries
//             on the JS target), export (JSON to disk)
//   compare   native outputs against today's build (the whole model JSON: bodies incl.
//             identity, construction and operationHistory, operationEvidence, source
//             map) and against the oracle (every node's complete body JSON),
//             identical output across modes, threads and repetitions
//   gate      W_best / T4 under two statistics (median and mean of the warm reps);
//             the gate ratio is the smaller one (real-run.mjs gateRatios)
// Then: edits with the host cache, loud failures, the regression programs, and
// the first error of every step-0 candidate (partial graphs included) against
// today's first error.
// `uptime` load averages are recorded before and after every child process.
// Every timing is indicative (shared machine).
//
//   node scripts/lang/wk-real.mjs [--n 3] [--only tag,..] [--phases workloads,edits,failures,regression,partial]
//   node scripts/lang/wk-real.mjs --phases gate [--runs 3]   the gate matrix alone, repeated (robustness across runs)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { loadKernel } from '../../src/kernel.mjs';
import { build } from '../../src/index.mjs';
import { structure, printGraph, contentHashes } from '../../src/lang/wk/ir.mjs';
import { canonicalize } from '../../src/lang/wk/canon.mjs';
import { stagePython } from '../../src/lang/wk/stage-py.mjs';
import { encodeSession } from '../../src/lang/wk/encode-bend.mjs';
import { parse } from '../../src/parser.mjs';
import { recordCase, evaluate, assemble, assembleModel, modelJson, compareLists, compareModels, costWeighted, gateRatios, firstError, firstErrorOverall, cacheStore, planIncremental, mergeRaw, nodeValues, BINARY }
  from '../../src/lang/wk/real-run.mjs';
import { runNative, parseOutput, memoIdentityKernel, geomHashes, fullHashes, precisionReport } from '../../src/lang/wk/real-host.mjs';
import { oracleNodes } from '../../src/lang/wk/real-oracle.mjs';

const root = new URL('../../', import.meta.url).pathname;
const cad = join(homedir(), 'Workspace/cad');
const OUT = join(root, 'out/lang/wk/real'), TMP = join(root, 'tmp/lang/wk/real/run');
mkdirSync(OUT, { recursive: true }); mkdirSync(TMP, { recursive: true }); mkdirSync(join(TMP, 'edits'), { recursive: true });
const args = process.argv.slice(2);
const opt = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const N = Number(opt('--n', 3));
const only = opt('--only', null)?.split(',');
const phases = opt('--phases', 'workloads,edits,failures,regression,partial').split(',');
const THREADS = [1, 2, 4];
const load = () => execSync('uptime').toString().trim().replace(/.*load averages?: /, '');
const sha = text => createHash('sha256').update(text).digest('hex').slice(0, 16);
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const round = (x, d = 3) => x == null ? null : Math.round(x * 10 ** d) / 10 ** d;
const log = (...xs) => console.log(...xs);

const WORKLOADS = [
  { tag: 'washers', role: 'gate workload (step 0: the only candidate that builds on the JS path without CURVED)', file: join(cad, 'cad-project-039/belt-fixed-r29/top-clearance-r29/top-clamp-washers-r29.fs'), feature: 'topClampWashersR29', reps: 50, warm: 2 },
  { tag: 'dual-hardware', role: 'primary (today\'s build stops at operation 17; node-level comparison against the per-node oracle)', file: join(cad, 'cad-project-039/belt-return-r25/dual-hardware-r25.fs'), feature: 'dualHardware25', reps: 20, warm: 1 },
  { tag: 'mounting-r26', role: 'extra real part (today\'s build stops at operation 17)', file: join(cad, 'cad-project-039/belt-central-r26/mounting/mounting-r26.fs'), feature: 'mountingHardware26', reps: 20, warm: 0, light: true },
  { tag: 'direct-mount-r26', role: 'extra real part (today\'s build stops at operation 17)', file: join(cad, 'cad-project-039/belt-central-r26/direct-mount/direct-mount-r26.fs'), feature: 'mountingHardware26', reps: 20, warm: 0, light: true },
  { tag: 'frame-with-tab', role: 'regression: planar chain fixture (FS twin of the build123d case)', file: join(root, 'kernel/lang/wk/cases/frame-with-tab.fs'), feature: 'frameWithTab', reps: 1, warm: 0, planar: true },
];

// ---------------------------------------------------------------------------------------------
function runChild(argv, env = {}, timeout = 900000) {
  const before = load(), t0 = performance.now();
  const r = spawnSync(process.execPath, argv, { cwd: root, encoding: 'utf8', timeout, env: { ...process.env, BEND_NO_TELEMETRY: '1', ...env }, maxBuffer: 1 << 28 });
  return { status: r.status, wallMs: performance.now() - t0, stdout: r.stdout, stderr: r.stderr.slice(-2000), loadBefore: before, loadAfter: load() };
}
function jsPath(w) {
  const runs = [];
  for (let i = 0; i < N; i++) {
    const out = join(TMP, `js-${w.tag}-${i}.json`);
    const c = runChild(['scripts/lang/wk-real-js.mjs', w.file, w.feature, out, '--warm', String(w.warm), ...(i === 0 ? ['--bodies', join(TMP, `js-${w.tag}.bodies.json`)] : [])]);
    const r = JSON.parse(readFileSync(out, 'utf8'));
    runs.push({ processWallMs: c.wallMs, importMs: r.importMs, kernelMs: r.kernelMs, buildMs: r.buildMs, warmMs: r.warmMs, exportMs: r.exportMs ?? null, status: r.status,
      error: r.error ?? null, loadBefore: c.loadBefore, loadAfter: c.loadAfter });
    if (i === 0) Object.assign(runs, { reference: r });
    log(`  js ${w.tag} #${i}: ${r.status} process ${c.wallMs.toFixed(0)} ms, kernel load ${r.kernelMs.toFixed(0)}, build ${r.buildMs.toFixed(0)}, warm ${r.warmMs.map(x => x.toFixed(0))} (load ${c.loadBefore})`);
  }
  // Kernel entries inside build() (a separate run: the counter perturbs timing).
  const countOut = join(TMP, `js-${w.tag}-count.json`), calls = join(TMP, `js-${w.tag}-count.calls.json`);
  const cc = runChild(['--import', './scripts/native-bridge/count-kernel-calls.mjs', 'scripts/lang/wk-real-js.mjs', w.file, w.feature, countOut], { WONKY_NB_COUNT_OUT: calls });
  let counted = null;
  try {
    const k = JSON.parse(readFileSync(calls, 'utf8'));
    counted = { kernelEntryMs: k.totals.ms, calls: k.totals.calls ?? k.entries.reduce((s, e) => s + e.calls, 0), entries: Object.fromEntries(k.entries.map(e => [e.name, e.calls])),
      buildMs: JSON.parse(readFileSync(countOut, 'utf8')).buildMs, loadBefore: cc.loadBefore, loadAfter: cc.loadAfter };
  } catch (error) { counted = { error: String(error.message) }; }
  // Op-at-a-time native through today's binding (docs/native-bridge.md), if its build has the entries.
  const nativeOut = join(TMP, `js-${w.tag}-native.json`);
  const nc = runChild(['scripts/lang/wk-real-js.mjs', w.file, w.feature, nativeOut, '--warm', String(w.warm)], { WONKY_BACKEND: 'native' });
  let opAtATime;
  try {
    const r = JSON.parse(readFileSync(nativeOut, 'utf8'));
    opAtATime = { status: r.status, error: r.error ?? null, kernelError: r.kernelError ?? null, processWallMs: nc.wallMs, importMs: r.importMs, kernelMs: r.kernelMs, buildMs: r.buildMs, warmMs: r.warmMs,
      bodies: r.bodies ?? [], loadBefore: nc.loadBefore, loadAfter: nc.loadAfter };
  } catch (error) { opAtATime = { status: 'crash', stderr: nc.stderr }; }
  log(`  native op-at-a-time ${w.tag}: ${opAtATime.status}${opAtATime.error ? ` (${opAtATime.error.message.slice(0, 100)})` : ''}`);
  return { runs, reference: runs.reference, counted, opAtATime };
}

// Op id, name, span and the SHA-256 of the argument snapshot (identity.operation.parameters).
function fidelity(rec, reference) {
  const params = o => createHash('sha256').update(JSON.stringify(o.parameters ?? null)).digest('hex').slice(0, 16);
  const a = rec.sourceMap.operations.map(o => ({ id: o.operationId, name: o.name, line: o.source?.span?.line ?? null, column: o.source?.span?.column ?? null, params: params(o) }));
  const b = reference.operations.map(o => ({ id: o.id, name: o.name, line: o.line, column: o.column, params: o.paramsSha }));
  let prefix = 0;
  while (prefix < b.length && prefix < a.length && JSON.stringify(a[prefix]) === JSON.stringify(b[prefix])) prefix++;
  const complete = reference.status === 'ok';
  return { recorded: a.length, reference: b.length, equalPrefix: prefix, referenceComplete: complete,
    equal: complete ? prefix === a.length && a.length === b.length : prefix === b.length,
    note: complete ? 'full sequence compared' : `today's build stops at operation ${b.length} (${reference.error?.message?.slice(0, 120)} at ${reference.error?.line}:${reference.error?.column}); only that prefix can be compared` };
}

const nLines = stdout => stdout.split('\n').filter(l => l.startsWith('N ')).join('\n');
// One configuration over every stage file of the graph (real-run.mjs
// evaluateStages: a PIERCE node runs one stage after its operands, with the
// host binary64 inputs today's adapter computes). Per repetition the stage
// times add up; the host work between stages (decode, pierceInputs) is not in
// these numbers but in the host buckets (encode.hostDecodeBetweenStagesMs).
async function runStages(stages, mode, threads, reps) {
  let repsUs = null, decodeUs = 0, wallMs = 0, text = '';
  const nodeUs = new Map();
  for (const st of stages) {
    const run = await runNative(BINARY, st.file, { mode, threads, reps });
    const out = parseOutput(run.stdout);
    repsUs = repsUs ? repsUs.map((x, i) => x + out.repsUs[i]) : [...out.repsUs];
    decodeUs += out.decodeUs; wallMs += run.wallMs; text += `${nLines(run.stdout)}\n`;
    for (const n of st.members) if (out.nodeUs.has(n)) nodeUs.set(n, out.nodeUs.get(n));
  }
  return { repsUs, decodeUs, wallMs, digest: sha(text), nodeUs };
}
async function nativeMatrix(w, rec, stages) {
  const rows = [], outputs = new Map();
  for (const mode of ['fork', 'seq']) for (const threads of THREADS) for (let i = 0; i < N; i++) {
    const before = load();
    const run = await runStages(stages, mode, threads, w.reps);
    const after = load();
    outputs.set(`${mode}/${threads}/${i}`, run.digest);
    const reps = run.repsUs.map(us => us / 1000);
    rows.push({ mode, threads, i, stages: stages.length, processWallMs: run.wallMs, decodeMs: run.decodeUs / 1000, coldEvalMs: reps[0], warmEvalMs: reps.length > 1 ? median(reps.slice(1)) : null,
      repsMs: reps, overheadMs: run.wallMs - run.decodeUs / 1000 - reps.reduce((s, x) => s + x, 0), outputDigest: run.digest, loadBefore: before, loadAfter: after });
  }
  const serial = [];
  for (const threads of [1, 4]) for (let i = 0; i < (threads === 1 ? N : 1); i++) {
    const before = load();
    const run = await runStages(stages, 'serial', threads, w.reps);
    outputs.set(`serial/${threads}/${i}`, run.digest);
    serial.push({ threads, i, nodeUs: Object.fromEntries(run.nodeUs), repsMs: run.repsUs.map(us => us / 1000), loadBefore: before, loadAfter: load() });
  }
  const digests = new Set(outputs.values());
  return { rows, serial, identicalOutputs: digests.size === 1, digests: [...digests] };
}

function summarizeNative(matrix) {
  const pick = (mode, threads, key) => median(matrix.rows.filter(r => r.mode === mode && r.threads === threads).map(r => r[key]));
  const table = {};
  for (const mode of ['fork', 'seq']) for (const t of THREADS)
    table[`${mode}@${t}`] = { warmEvalMs: round(pick(mode, t, 'warmEvalMs') ?? pick(mode, t, 'coldEvalMs')), coldEvalMs: round(pick(mode, t, 'coldEvalMs')),
      processWallMs: round(pick(mode, t, 'processWallMs')), decodeMs: round(pick(mode, t, 'decodeMs')) };
  const g = gateRatios(matrix.rows);
  return { table, gate: { ...g, coldRatio: round(Math.min(...THREADS.map(t => table[`seq@${t}`].coldEvalMs)) / table['fork@4'].coldEvalMs),
    processRatio: round(table['seq@4'].processWallMs / table['fork@4'].processWallMs) } };
}

function costWeights(rec, matrix) {
  const one = matrix.serial.filter(s => s.threads === 1);
  const nodeUs = new Map(rec.graph.nodes.map(n => [n.n, median(one.map(s => s.nodeUs[n.n] ?? 0))]));
  const cw = costWeighted(rec.graph, nodeUs);
  const byOp = {};
  for (const node of rec.graph.nodes) {
    const k = node.op === 'boolean' ? `boolean/${node.args.method}` : node.op;
    byOp[k] ??= { count: 0, us: 0 }; byOp[k].count++; byOp[k].us += nodeUs.get(node.n);
  }
  const top = [...nodeUs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, us]) => ({ node: n, op: rec.graph.nodes[n].op, method: rec.graph.nodes[n].args.method ?? null, id: rec.graph.nodes[n].id, us }));
  return { ...cw, costBound: round(cw.costBound), opCountBound: round(cw.opCountBound), serialRepMs: round(median(one.map(s => s.repsMs.at(-1)))), byOp, top };
}

function compareOracle(rec, oracle, nodeBodies, values) {
  let equal = 0, errorsEqual = 0, jsonEqual = 0;
  const differences = [];
  for (const node of rec.graph.nodes) {
    const o = oracle.errors.get(node.n), v = values.get(node.n);
    if (o || v?.error) {
      const nativeMsg = v?.error?.message ?? null;
      const same = o && v?.error && (o.input != null || o.message === nativeMsg);
      if (same) { errorsEqual++; continue; }
      differences.push({ node: node.n, op: node.op, method: node.args.method ?? null, oracle: o ? (o.input != null ? `input %${o.input} failed` : o.message) : null, native: nativeMsg });
      continue;
    }
    if (node.op === 'expect_count') { equal++; jsonEqual++; continue; } // a count check holds on both sides (no body)
    const mine = nodeBodies.get(node.n) ?? [];
    const rows = compareLists(mine, oracle.values.get(node.n) ?? []);
    if (rows.length && rows.every(r => r.equal)) { equal++; if (rows.every(r => r.jsonIdentical)) jsonEqual++; }
    else {
      const paths = rows.flatMap(r => r.diffs ?? []);
      differences.push({ node: node.n, op: node.op, method: node.args.method ?? null, id: node.id,
        maxAbsDelta: Math.max(0, ...paths.map(d => Math.abs(d.delta ?? Infinity))), paths: paths.map(d => `${d.path} Δ=${d.delta ?? `${d.native}|${d.reference}`}`).slice(0, 8), rows });
    }
  }
  const methods = {};
  for (const node of rec.graph.nodes) if (node.op === 'boolean') {
    const k = `${node.args.method}:${oracle.errors.has(node.n) ? (oracle.errors.get(node.n).input != null ? 'input-failed' : 'declined') : 'ok'}`;
    methods[k] = (methods[k] ?? 0) + 1;
  }
  const pierce = rec.graph.nodes.filter(n => n.op === 'boolean' && n.args.method === 'PIERCE' && nodeBodies.get(n.n)?.[0]).map(n => ({ node: n.n, id: n.id }));
  return { nodes: rec.graph.nodes.length, bodiesEqual: equal, bodiesJsonIdentical: jsonEqual, errorsEqual, differences, methods, pierce };
}

async function hostSide(rec, values, jsKernel) {
  const cold = memoIdentityKernel(jsKernel);
  const a = assemble(rec, values, cold.kernel);
  const warm = assemble(rec, values, cold.kernel); // identity entries now memoized
  const t0 = performance.now();
  const model = assembleModel(rec, a), json = modelJson(rec, model);
  const file = join(TMP, `native-${sha(rec.graph.meta.file ?? '')}.model.json`);
  writeFileSync(file, json);
  const exportMs = performance.now() - t0;
  return { assembled: a, model, json, decodeMs: a.decodeMs, identityMs: a.identityMs, identityWarmMs: warm.identityMs, identityCalls: cold.stats.calls, identityHits: cold.stats.hits, exportMs };
}
// Today's exported model (wk-real-js.mjs run 0) against the native model, both
// as exported JSON (so -0 / key order are compared as the files hold them).
function compareExported(host, todayModelFile) {
  const today = JSON.parse(readFileSync(todayModelFile, 'utf8'));
  return compareModels(JSON.parse(host.json), { bodies: today.bodies, operationEvidence: today.operationEvidence, sourceMap: today.sourceMap });
}

async function workload(w, jsKernel) {
  log(`\n== ${w.tag}: ${w.role}`);
  const res = { tag: w.tag, role: w.role, file: w.file.replace(homedir(), '~'), feature: w.feature, reps: w.reps, n: N, loadStart: load() };
  // record
  const recordMs = [];
  let rec;
  for (let i = 0; i < N; i++) { rec = recordCase(w.file, w.feature); recordMs.push(rec.recordMs); }
  const st = structure(rec.graph);
  const methods = {};
  for (const node of rec.graph.nodes) if (node.op === 'boolean') methods[node.args.method] = (methods[node.args.method] ?? 0) + 1;
  const ops = {};
  for (const node of rec.graph.nodes) ops[node.op] = (ops[node.op] ?? 0) + 1;
  const precision = precisionReport(rec.graph);
  res.record = { status: rec.status, error: rec.error ? { name: rec.error.name, message: rec.error.message, line: rec.error.line ?? null } : null, ms: recordMs.map(x => round(x)),
    medianMs: round(median(recordMs)), steps: rec.steps, nodes: rec.graph.nodes.length, ops, heavy: st.heavyCount, heavySpan: st.heavySpan, opCountBound: round(st.heavyCount / Math.max(1, st.heavySpan)),
    methods, speculations: rec.trace.speculations, countChecks: rec.trace.checks, tryRethrow: rec.trace.tryRethrow, trySpeculate: rec.trace.trySpeculate, outputs: rec.outputs.length,
    precision: { rounded: precision.length, examples: precision.slice(0, 5) } };
  log(`  record ${rec.status}: ${rec.graph.nodes.length} nodes, heavy ${st.heavyCount}, span ${st.heavySpan}, ${JSON.stringify(methods)}, ${round(median(recordMs))} ms`);
  if (rec.status !== 'complete') {
    // the partial graph still runs: its first error precedes the recorder's (firstErrorOverall)
    const ev = await evaluate(rec, { mode: 'fork', threads: 1, reps: 1, file: join(TMP, `${w.tag}-partial.wkr`) });
    res.stop = 'recorder did not produce one graph'; res.firstError = firstErrorOverall(rec, ev.values);
    return res;
  }
  // today's path
  const js = jsPath(w);
  res.js = { runs: js.runs, counted: js.counted, opAtATime: js.opAtATime, status: js.reference.status, error: js.reference.error ?? null, booleans: js.reference.booleans };
  res.fidelity = fidelity(rec, js.reference);
  log(`  fidelity: ${JSON.stringify(res.fidelity)}`);
  // encode (stages: a PIERCE node runs one stage after its operands, real-run.mjs evaluateStages)
  const file = join(TMP, `${w.tag}.wkr`);
  const encodeMs = [], between = [];
  let staged;
  for (let i = 0; i < N; i++) { staged = await evaluate(rec, { mode: 'fork', threads: 1, reps: 1, file }); encodeMs.push(staged.encodeMs); between.push(staged.hostDecodeMs); }
  res.encode = { ms: encodeMs.map(x => round(x)), medianMs: round(median(encodeMs)), tokens: staged.enc.tokens, levels: staged.enc.levels.length, levelSizes: staged.enc.levels.map(l => l.length),
    stages: staged.stages.map(s => ({ stage: s.stage, nodes: s.nodes, pierce: s.pierce, literals: s.literals, tokens: s.tokens, levels: s.levels, hostStatus: s.hostInputs.map(h => h.status) })),
    hostDecodeBetweenStagesMs: round(median(between)), replays: staged.replays.length };
  // native
  const matrix = await nativeMatrix(w, rec, staged.stages);
  res.native = { matrix: matrix.rows, identicalOutputs: matrix.identicalOutputs, digests: matrix.digests, ...summarizeNative(matrix) };
  res.costWeighted = costWeights(rec, matrix);
  res.serial = matrix.serial;
  const gt = res.native.gate;
  log(`  native identical across modes/threads/reps: ${matrix.identicalOutputs}; gate W_best/T4 median ${round(gt.median.ratio)} mean ${round(gt.mean.ratio)} -> ${round(gt.ratio)} (${gt.verdict}); cost bound ${res.costWeighted.costBound} vs op-count bound ${res.costWeighted.opCountBound}`);
  // host side (parse + decode, identity, export) from one fork@1 run
  const t0 = performance.now();
  const ev = await evaluate(rec, { mode: 'fork', threads: 1, reps: 1, file });
  const host = await hostSide(rec, ev.values, jsKernel);
  res.host = { parseMs: round(ev.parseMs), decodeMs: round(host.decodeMs), identityMs: round(host.identityMs), identityWarmMs: round(host.identityWarmMs), identityCalls: host.identityCalls,
    exportMs: round(host.exportMs), pipelineMs: round(performance.now() - t0) };
  res.firstError = firstErrorOverall(rec, ev.values);
  // correctness
  const t1 = performance.now();
  const oracle = oracleNodes(rec.graph, jsKernel, { sourceMap: rec.sourceMap });
  res.oracle = { ms: round(performance.now() - t1), ...compareOracle(rec, oracle, host.assembled.nodeBodies, ev.values) };
  if (js.reference.status === 'ok') {
    const m = compareExported(host, join(TMP, `js-${w.tag}-0.json.model.json`));
    res.outputs = { count: [host.assembled.outputs.length, m.bodies.length], allEqual: m.equal, jsonIdentical: m.jsonIdentical, evidenceDiffs: m.evidence, sourceMapDiffs: m.sourceMap, rows: m.bodies };
  } else res.outputs = { note: 'today\'s build fails, so there is no model to compare; see oracle (every node)' };
  log(`  oracle: ${res.oracle.bodiesEqual} body nodes (${res.oracle.bodiesJsonIdentical} byte-identical JSON) and ${res.oracle.errorsEqual} error nodes equal of ${res.oracle.nodes}; differences ${res.oracle.differences.length} (${res.oracle.differences.map(d => `%${d.node} ${d.paths?.[0] ?? d.native ?? ''}`).join(', ')}); model vs today ${res.outputs.allEqual ?? res.outputs.note} ${res.outputs.jsonIdentical ?? ''}`);
  res.loadEnd = load();
  res._rec = rec; res._values = ev.values;
  return res;
}

// --- edits with the host cache ------------------------------------------------------------------
const EDITS = [
  { tag: 'dual-hardware', line: 88, from: '27.357265589908167', to: '28.7251288694', note: 'corpus.json edit 1 (1 of 42 heavy nodes dirty)' },
  { tag: 'washers', line: 70, from: '.6', to: '0.63', note: 'corpus.json edit 2: an appearance literal (0 heavy nodes dirty)' },
  { tag: 'washers', line: 49, from: '0', to: '0.5', note: 'corpus.json edit 1: the circle centre in roundBody (4 of 4 heavy nodes dirty)' },
  { tag: 'frame-with-tab', line: 14, from: '48', to: '47', note: 'regression: the tab moved by 1 mm (proposal-core-ir.md §5.2)' },
];
// The literal exactly as scripts/lang/dataflow-corpus.mjs picked it: numeric
// literals in AST order (src/parser.mjs), the edit is the one on e.line whose
// source text is e.from (the first such literal in that order).
function applyEdit(source, e) {
  const out = [];
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (node.kind === 'literal' && typeof node.value === 'number' && node.loc?.kind === 'number') { out.push(node); return; }
    for (const [k, v] of Object.entries(node)) { if (k === 'loc') continue; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') walk(v); }
  };
  for (const d of parse(source).declarations) walk(d.value);
  out.sort((a, b) => a.loc.line - b.loc.line || a.loc.column - b.loc.column);
  const lines = source.split('\n');
  const lit = out.find(l => l.loc.line === e.line && lines[e.line - 1].startsWith(e.from, l.loc.column - 1)
    && !/[0-9.eE]/.test(lines[e.line - 1][l.loc.column - 1 + e.from.length] ?? ''));
  if (!lit) throw new Error(`edit ${e.tag}:${e.line} '${e.from}' is not a numeric literal there`);
  const line = lines[e.line - 1], at = lit.loc.column - 1;
  lines[e.line - 1] = line.slice(0, at) + e.to + line.slice(at + e.from.length);
  return { source: lines.join('\n'), column: lit.loc.column };
}
// Median of the warm repetitions in one process (all of them if there is only one).
const repsWarm = us => median((us.length > 1 ? us.slice(1) : us).map(x => x / 1000));
async function editRun(e, jsKernel) {
  const w = WORKLOADS.find(x => x.tag === e.tag);
  const source = readFileSync(w.file, 'utf8');
  const { source: edited, column } = applyEdit(source, e);
  const file = join(TMP, 'edits', `${e.tag}-L${e.line}.fs`);
  writeFileSync(file, edited);
  const row = { ...e, column, file: file.replace(root, '') };
  const base = { _rec: recordCase(w.file, w.feature) };
  // base: the unedited graph fully evaluated; its values fill the cache
  const cache = new Map();
  const ev0 = await evaluate(base._rec, { mode: 'fork', threads: 4, file: join(TMP, `${e.tag}-base.wkr`) });
  cacheStore(cache, base._rec, ev0.out.values);
  const identity = memoIdentityKernel(jsKernel); // identity entry cache, shared by base and edit
  assemble(base._rec, ev0.values, identity.kernel);
  // edited: record, plan, evaluate only dirty nodes
  const t0 = performance.now();
  const rec = recordCase(file, w.feature);
  const recordMs = performance.now() - t0;
  const geom = geomHashes(rec.graph);
  const plan = planIncremental(rec, cache, geom);
  const baseGeom = new Set(geomHashes(base._rec.graph)), baseFull = new Set(fullHashes(base._rec.graph));
  const full = fullHashes(rec.graph);
  const changed = rec.graph.nodes.filter(n => !baseGeom.has(geom[n.n])).map(n => n.n);
  row.graph = { nodes: rec.graph.nodes.length, changed: changed.length, heavyChanged: changed.filter(n => rec.graph.nodes[n].op === 'boolean').length,
    errorsReevaluated: plan.dirty.filter(n => !changed.includes(n)).length,
    dirty: plan.dirty.length, heavyDirty: plan.dirty.filter(n => rec.graph.nodes[n].op === 'boolean').length,
    heavy: rec.graph.nodes.filter(n => n.op === 'boolean').length, literals: plan.literals.size, skipped: plan.skip.size,
    geomReused: rec.graph.nodes.filter(n => baseGeom.has(geom[n.n])).length, fullReused: rec.graph.nodes.filter(n => baseFull.has(full[n.n])).length };
  const incRuns = [];
  let inc;
  for (let i = 0; i < N; i++) {
    const before = load();
    inc = await evaluate(rec, { mode: 'fork', threads: 4, reps: w.reps, file: join(TMP, `${e.tag}-inc.wkr`), known: plan.known });
    incRuns.push({ processWallMs: inc.run.wallMs, evalMs: repsWarm(inc.out.repsUs), coldEvalMs: inc.out.repsUs[0] / 1000, decodeMs: inc.out.decodeUs / 1000, encodeMs: inc.encodeMs, loadBefore: before, loadAfter: load() });
  }
  const raw = mergeRaw(plan, inc.out);
  const incValues = nodeValues(rec.graph, { values: raw });
  const before = { ...identity.stats };
  const t1 = performance.now();
  const incAsm = assemble(rec, incValues, identity.kernel);
  const incHostMs = performance.now() - t1;
  // cold build of the edited file: all nodes, fresh identity
  const coldRuns = [];
  let cold;
  for (let i = 0; i < N; i++) {
    const before = load();
    cold = await evaluate(rec, { mode: 'fork', threads: 4, reps: w.reps, file: join(TMP, `${e.tag}-cold.wkr`) });
    coldRuns.push({ processWallMs: cold.run.wallMs, evalMs: repsWarm(cold.out.repsUs), coldEvalMs: cold.out.repsUs[0] / 1000, decodeMs: cold.out.decodeUs / 1000, loadBefore: before, loadAfter: load() });
  }
  const fresh = memoIdentityKernel(jsKernel);
  const t2 = performance.now();
  const coldAsm = assemble(rec, cold.values, fresh.kernel);
  const coldHostMs = performance.now() - t2;
  const nodeRows = [];
  let nodesEqual = 0;
  for (const node of rec.graph.nodes) {
    const a = incValues.get(node.n), b = cold.values.get(node.n);
    if (a?.error || b?.error || a?.ok || b?.ok) { if (JSON.stringify(a) === JSON.stringify(b)) nodesEqual++; else nodeRows.push({ node: node.n, inc: a, cold: b }); continue; }
    const rows = compareLists(incAsm.nodeBodies.get(node.n) ?? [], coldAsm.nodeBodies.get(node.n) ?? []);
    if (rows.every(r => r.equal)) nodesEqual++; else nodeRows.push({ node: node.n, rows });
  }
  const outRows = compareLists(incAsm.outputs.filter(Boolean), coldAsm.outputs.filter(Boolean));
  row.incremental = { reps: w.reps, recordMs: round(recordMs), runs: incRuns, medianProcessMs: round(median(incRuns.map(r => r.processWallMs))), medianEvalMs: round(median(incRuns.map(r => r.evalMs))), medianColdEvalMs: round(median(incRuns.map(r => r.coldEvalMs))),
    hostMs: round(incHostMs), identityCalls: identity.stats.calls - before.calls, identityHits: identity.stats.hits - before.hits };
  row.cold = { reps: w.reps, runs: coldRuns, medianProcessMs: round(median(coldRuns.map(r => r.processWallMs))), medianEvalMs: round(median(coldRuns.map(r => r.evalMs))), medianColdEvalMs: round(median(coldRuns.map(r => r.coldEvalMs))), hostMs: round(coldHostMs), identityCalls: fresh.stats.calls };
  row.equalToCold = { nodes: `${nodesEqual}/${rec.graph.nodes.length}`, allNodes: nodesEqual === rec.graph.nodes.length, outputs: outRows.every(r => r.equal) && incAsm.outputs.length === coldAsm.outputs.length,
    differences: nodeRows.slice(0, 5) };
  // today's path on the edited file (when the unedited file builds there)
  const ref = runChild(['scripts/lang/wk-real-js.mjs', file, w.feature, join(TMP, `js-edit-${e.tag}-L${e.line}.json`), '--bodies', join(TMP, `js-edit-${e.tag}-L${e.line}.bodies.json`)]);
  const jr = JSON.parse(readFileSync(join(TMP, `js-edit-${e.tag}-L${e.line}.json`), 'utf8'));
  row.js = { status: jr.status, buildMs: round(jr.buildMs), processWallMs: round(ref.wallMs), error: jr.error ?? null, loadBefore: ref.loadBefore, loadAfter: ref.loadAfter };
  if (jr.status === 'ok') {
    // the whole exported model of today's build of the edited file against the incremental result
    const today = JSON.parse(readFileSync(join(TMP, `js-edit-${e.tag}-L${e.line}.json.model.json`), 'utf8'));
    const m = compareModels(JSON.parse(modelJson(rec, assembleModel(rec, incAsm))), { bodies: today.bodies, operationEvidence: today.operationEvidence, sourceMap: today.sourceMap });
    row.js.outputsEqual = m.equal; row.js.jsonIdentical = m.jsonIdentical;
    if (!m.equal) row.js.rows = m;
  }
  log(`  edit ${e.tag}:${e.line}:${column} changed ${row.graph.changed} (heavy ${row.graph.heavyChanged}), re-evaluated ${row.graph.dirty}/${row.graph.nodes} (heavy ${row.graph.heavyDirty}/${row.graph.heavy}, errors never cached), literals ${row.graph.literals}; inc eval ${row.incremental.medianEvalMs} ms vs cold ${row.cold.medianEvalMs} ms; equal to cold: ${row.equalToCold.allNodes}/${row.equalToCold.outputs}; js ${row.js.status} ${row.js.outputsEqual ?? ''}`);
  return row;
}

// --- loud failures ------------------------------------------------------------------------------
async function failures(base) {
  const rows = [];
  const run = async (tag, rec, expect) => {
    const ev = await evaluate(rec, { mode: 'fork', threads: 1, file: join(TMP, `fail-${tag}.wkr`) });
    const err = firstError(rec, ev.values);
    const outputs = rec.outputs.map(o => ev.values.get(o.ref.node)).map(v => v?.error ? 'error' : v?.native ? 'bodies' : v?.ok ? 'ok' : 'missing');
    rows.push({ tag, expect, error: err, outputs, noResult: outputs.every(x => x === 'error') });
    log(`  ${tag}: ${err ? `${err.kind} at ${err.file?.split('/').pop()}:${err.line}:${err.column}: ${err.message.slice(0, 110)}` : 'NO ERROR'}; outputs ${outputs}`);
  };
  await run('curved-method', recordCase(join(root, 'kernel/lang/wk/cases/curved-intersection.fs'), 'curvedIntersection'), 'capability error at the opBoolean span (CURVED is not in the native evaluator)');
  await run('split-count', recordCase(join(root, 'kernel/lang/wk/cases/split-count.fs'), 'splitCount'), 'speculation error: the Boolean returns 2 bodies, the recorder assumed 1');
  const unknown = recordCase(WORKLOADS[0].file, WORKLOADS[0].feature);
  const victim = unknown.graph.nodes.find(n => n.op === 'frustum');
  victim.op = 'loft'; // an op the native evaluator does not know (op code 99 on the wire)
  await run('unknown-op', unknown, `capability error at ${victim.id}'s FS span`);
  const wrong = recordCase(WORKLOADS[1].file, WORKLOADS[1].feature);
  const check = wrong.graph.nodes.find(n => n.op === 'expect_count');
  check.args = { ...check.args, count: check.args.count + 1 }; // a deliberately wrong count speculation
  await run('wrong-count', wrong, 'expect error at the evaluateQuery span');
  return rows;
}

// --- regression: frame-with-tab from both frontends, and the WK check programs --------------------
async function regression(jsKernel) {
  const res = {};
  const fsRec = recordCase(join(root, 'kernel/lang/wk/cases/frame-with-tab.fs'), 'frameWithTab');
  const py = await stagePython(readFileSync(join(root, 'fixtures/performance-build123d/cases/frame-with-tab.py'), 'utf8'), { filename: 'frame-with-tab.py', python: join(root, 'out/build123d-performance/reference-venv/bin/python') });
  const bare = g => printGraph(g, { spans: false, ids: false }).split('\n').slice(1).map(l => l.replace(/ name="result"$/, '')).join('\n');
  const strip = g => { for (const n of g.nodes) if (n.op === 'boolean') { const { method, components, ...rest } = n.args; n.args = rest; } return g; };
  const cf = canonicalize(strip(recordCase(join(root, 'kernel/lang/wk/cases/frame-with-tab.fs'), 'frameWithTab').graph)).graph;
  const cp = py.failure ? null : canonicalize(py.graph).graph;
  const hashOut = g => contentHashes(g)[g.outputs[0].value.node];
  res.frameGraphs = { identical: cp ? bare(cf) === bare(cp) : null, fsHash: hashOut(cf), pyHash: cp ? hashOut(cp) : null, pyFailure: py.failure ?? null };
  // the earlier native evaluator (out/lang/wk/build/wk-native) over the recorder graph: its evidence hash
  const old = join(root, 'out/lang/wk/build/wk-native');
  if (existsSync(old)) {
    const { text } = encodeSession([cf], [contentHashes(cf)]);
    const path = join(TMP, 'frame-old.wk');
    writeFileSync(path, text);
    const r = spawnSync(old, ['--threads', '1', '--gpu', 'off', '--', path], { encoding: 'utf8', env: { ...process.env, BEND_NO_TELEMETRY: '1' } });
    const lines = r.stdout.trim().split('\n').map(l => JSON.parse(l));
    res.frameGraphs.oldEvaluatorBody = lines[1].outputs[0];
  }
  // the WK check programs: recorder fidelity, native result against build()
  const files = [...['bored-spacer', 'box', 'bracket', 'compare-after', 'compare-before', 'concave-intersection', 'conical-spacer', 'convex-intersection', 'line-sketch', 'tilted-plate'].map(f => `examples/${f}.fs`),
    'kernel/lang/wk/cases/frame-with-tab.fs', 'kernel/lang/wk/cases/four-pockets.fs'];
  res.programs = [];
  for (const f of files) {
    const path = join(root, f), source = readFileSync(path, 'utf8');
    const row = { file: f };
    const t0 = performance.now();
    let model = null;
    try { model = await build(source, { sourcePath: path }); row.build = 'ok'; }
    catch (error) { row.build = `${error.name}: ${error.message.slice(0, 120)}`; model = { sourceMap: error.modelTrace, bodies: null }; }
    row.buildMs = round(performance.now() - t0, 1);
    const rec = recordCase(path);
    row.record = rec.status + (rec.error ? `: ${rec.error.message.slice(0, 120)} (line ${rec.error.line ?? '?'})` : '');
    const a = rec.sourceMap.operations.map(o => `${o.operationId}|${o.name}|${o.source?.span?.line}:${o.source?.span?.column}`);
    const b = (model.sourceMap?.operations ?? []).map(o => `${o.operationId}|${o.name}|${o.source?.span?.line}:${o.source?.span?.column}`);
    row.opsEqual = JSON.stringify(a) === JSON.stringify(b);
    row.ops = [a.length, b.length];
    if (rec.status === 'complete') {
      const ev = await evaluate(rec, { mode: 'fork', threads: 1, file: join(TMP, `prog-${f.split('/').pop()}.wkr`) });
      row.nativeMs = round(ev.out.repsUs[0] / 1000);
      const err = firstError(rec, ev.values);
      if (err) row.native = `${err.kind} at ${err.line}:${err.column}: ${err.message.slice(0, 120)}`;
      else {
        const asm = assemble(rec, ev.values, memoIdentityKernel(jsKernel).kernel);
        const m = compareModels(assembleModel(rec, asm), model);
        row.native = 'ok';
        row.bodiesEqual = m.equal; row.jsonIdentical = m.jsonIdentical;
        if (!m.equal) row.rows = m;
      }
    }
    res.programs.push(row);
    log(`  ${f.padEnd(40)} build ${row.build === 'ok' ? 'ok' : 'error'} ${row.buildMs} ms; record ${row.record.slice(0, 60)}; ops equal ${row.opsEqual}; native ${row.native ?? '-'} ${row.bodiesEqual ?? ''}`);
  }
  return res;
}

// --- the first error of every step-0 candidate (defect 6 of fix round 2) ------------------------
// The recorder stops at its own error after every recorded operation; the partial
// graph is evaluated natively and its first error, if any, precedes the recorder's
// (real-run.mjs firstErrorOverall). Compared with today's first error (selection.json).
async function partialPhase() {
  const selection = JSON.parse(readFileSync(join(OUT, 'selection.json'), 'utf8'));
  const rows = [];
  for (const c of selection.candidates) {
    const before = load();
    const rec = recordCase(join(cad, c.path), c.feature);
    const ev = await evaluate(rec, { mode: 'fork', threads: 1, reps: 1, file: join(TMP, `partial-${c.tag}.wkr`) });
    const fe = firstErrorOverall(rec, ev.values);
    const today = c.status === 'ok' ? null : { kind: c.status, line: c.error?.line ?? null, column: c.error?.column ?? null, message: c.error?.message ?? null };
    const recorderStop = rec.status === 'complete' ? null : { status: rec.status, line: rec.error?.line ?? null, column: rec.error?.column ?? null, message: String(rec.error?.message ?? '').slice(0, 200) };
    const same = today === null ? fe === null : fe !== null && fe.line === today.line && fe.column === today.column && fe.message === today.message;
    rows.push({ tag: c.tag, feature: c.feature, record: rec.status, nodes: rec.graph.nodes.length, recorderStop, first: fe && { origin: fe.origin, kind: fe.kind, line: fe.line, column: fe.column, message: fe.message.slice(0, 200) },
      today, same, loadBefore: before, loadAfter: load() });
    log(`  ${c.tag.padEnd(46)} ${rec.status.padEnd(11)} recorder stop ${recorderStop ? `${recorderStop.line}:${recorderStop.column}` : '-'}; first ${fe ? `${fe.line}:${fe.column} (${fe.origin})` : 'none'}; today ${today ? `${today.line}:${today.column}` : 'ok'}; ${same ? 'same' : 'DIFFERENT'}`);
  }
  return { rows, same: rows.filter(r => r.same).length, of: rows.length, maskedBefore: rows.filter(r => r.recorderStop && r.first?.origin === 'native').length };
}

// --- the gate matrix repeated: is a pass stable across runs? ----------------------------------------
// Each run is the full native matrix (fork / seq x 1 / 2 / 4 threads x n processes);
// a workload passes robustly only if its gate ratio (gateRatios) is >= 1.2 in every run.
async function gatePhase(runs) {
  const out = {};
  for (const w of WORKLOADS.filter(x => !x.planar && (!only || only.includes(x.tag)))) {
    const rec = recordCase(w.file, w.feature);
    const staged = await evaluate(rec, { mode: 'fork', threads: 1, reps: 1, file: join(TMP, `${w.tag}-gate.wkr`) });
    out[w.tag] = [];
    for (let r = 0; r < runs; r++) {
      const before = load();
      const m = await nativeMatrix(w, rec, staged.stages);
      const g = gateRatios(m.rows);
      out[w.tag].push({ run: r, median: round(g.median.ratio), mean: round(g.mean.ratio), ratio: round(g.ratio), verdict: g.verdict, tailFork4: round(g.tailFork4), identical: m.identicalOutputs, loadBefore: before, loadAfter: load() });
      log(`  ${w.tag} run ${r}: median ${round(g.median.ratio)} mean ${round(g.mean.ratio)} -> ${round(g.ratio)} (${g.verdict}), load ${before}`);
    }
  }
  return { runs, workloads: Object.fromEntries(Object.entries(out).map(([t, rows]) => [t, { rows, min: Math.min(...rows.map(r => r.ratio)), max: Math.max(...rows.map(r => r.ratio)), robustPass: rows.every(r => r.ratio >= 1.2) }])) };
}

// ---------------------------------------------------------------------------------------------
const meta = { schema: 'wonky-lang-wk-real/1', startedAt: new Date().toISOString(), n: N, threads: THREADS, binary: BINARY.replace(root, ''),
  binarySha256: sha(readFileSync(BINARY)), machine: 'Apple M5 Pro (18 logical CPUs), macOS arm64', node: process.version, loadStart: load(),
  note: 'All timings indicative: shared machine (load averages recorded next to every run). Hashes, words, node values are exact.' };
log(JSON.stringify(meta));
const t0 = performance.now();
const jsKernel = await loadKernel();
meta.jsKernelLoadMs = round(performance.now() - t0);
const results = {};
if (phases.includes('workloads')) {
  for (const w of WORKLOADS.filter(x => !only || only.includes(x.tag))) {
    const r = await workload(w, jsKernel);
    results[w.tag] = r;
    const { _rec, _values, ...plain } = r;
    writeFileSync(join(OUT, `${w.tag}.json`), JSON.stringify({ meta, ...plain }, null, 1));
  }
}
if (phases.includes('edits')) {
  const rows = [];
  for (const e of EDITS.filter(x => !only || only.includes(x.tag))) rows.push(await editRun(e, jsKernel));
  writeFileSync(join(OUT, 'edits.json'), JSON.stringify({ meta, edits: rows }, null, 1));
}
if (phases.includes('failures')) {
  log('\n== loud failures');
  writeFileSync(join(OUT, 'failures.json'), JSON.stringify({ meta, failures: await failures() }, null, 1));
}
if (phases.includes('gate')) {
  log('\n== gate matrix repeated');
  writeFileSync(join(OUT, 'gate-runs.json'), JSON.stringify({ meta, ...(await gatePhase(Number(opt('--runs', 3)))) }, null, 1));
}
if (phases.includes('partial')) {
  log('\n== first error of every step-0 candidate (partial graphs)');
  writeFileSync(join(OUT, 'partial.json'), JSON.stringify({ meta, ...(await partialPhase()) }, null, 1));
}
if (phases.includes('regression')) {
  log('\n== regression');
  writeFileSync(join(OUT, 'regression.json'), JSON.stringify({ meta, ...(await regression(jsKernel)) }, null, 1));
}
meta.loadEnd = load();
meta.finishedAt = new Date().toISOString();
log(`\ndone in ${((performance.now() - t0) / 1000).toFixed(0)} s, load ${meta.loadEnd}`);
