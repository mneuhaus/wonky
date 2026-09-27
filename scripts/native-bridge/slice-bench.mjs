#!/usr/bin/env node
// End-to-end benchmark of the native slice (docs/native-bridge.md section 11).
// Every sample is a fresh CLI process (bin/wonky.mjs / bin/wonky-python.mjs,
// unchanged), js and native alternating, uptime before and after each run, and
// every native sample's outputs are byte-compared with the js sample of the
// same round (brep.json without the backend block, .step/.stl/.html, stdout
// body lines). A sample that differs or fails is reported, never dropped.
//
// Sections (all written to out/native-bridge/slice/bench.json):
//   wall      n >= 3 plain runs per workload and backend (wall, user/sys, max RSS)
//   traced    one native run with the native trace + phase preload + guard:
//             cold start (incl. stale check, dlopen+init), per-entry native /
//             encode / decode ms, frontend+host remainder, export; one js run
//             with count-kernel-calls.mjs + phases for per-entry JS kernel ms
//   diff      WONKY_BACKEND=diff per workload: compared calls per entry vs the
//             profile count run (out/native-bridge/profile/calls) and this run's count
//   threads6  one native run per workload at WONKY_NATIVE_THREADS=6 (secondary)
//   negative  bored-spacer and r10b must exit 1 on native with a capability error, no JS kernel
//   firstLoad the first dlopen of a freshly built binary (build smoke child) and of a fresh copy
//
// The hybrid Boolean runs in the build's wonky-hybrid subprocess: its wall time
// and phases (trace.hybrid) are a bucket of their own (hybridMs), next to the
// JS target's time in the same stages (kernel/hybrid/main.bend entries of the
// count run).
//
//   node scripts/native-bridge/slice-bench.mjs [--n 3] [--only id,id] [--skip diff,threads6,negative,count,firstload] [--out file.json]
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { NEGATIVE_WORKLOADS, SLICE_OPS, SLICE_WORKLOADS, entryOf, profileCalls } from './slice-ops.mjs';
import { compareOutputs, countPreload, diffEvidence, guardPreload, phasesPreload, root, runCli, uptime } from './slice-lib.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const n = Number(option('--n', '3'));
if (!Number.isInteger(n) || n < 3) throw new Error('--n must be an integer >= 3');
const only = option('--only', null)?.split(',');
const skip = new Set(option('--skip', '').split(',').filter(Boolean));
const workloads = SLICE_WORKLOADS.filter(w => !only || only.includes(w.id));
const work = join(root, 'tmp/native-bridge/slice/bench');
const outFile = option('--out', null) ? join(process.cwd(), option('--out')) : join(root, 'out/native-bridge/slice/bench.json');
const log = message => process.stderr.write(`${new Date().toISOString().slice(11, 19)} ${message}\n`);
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const round = x => x === null || x === undefined ? x : Math.round(x * 100) / 100;
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

// The build must exist and be current; a cache hit is the normal case.
const build = spawnSync(process.execPath, [join(root, 'scripts/native-bridge/build-native.mjs'), '--set', 'planar'], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
if (build.status !== 0) throw new Error(`build-native failed: ${build.stderr}`);
const buildReport = JSON.parse(build.stdout.trim().split('\n').pop());
const manifest = readJson(join(root, 'tmp/native-bridge/cache', buildReport.sourceHash, 'manifest.json'));
log(`build ${buildReport.hit ? 'cache hit' : 'fresh'} ${buildReport.sourceHash.slice(0, 12)} in ${buildReport.ms} ms`);

const result = {
  schema: 'wonky-native-slice-bench/1', generator: 'scripts/native-bridge/slice-bench.mjs', startedAt: new Date().toISOString(),
  machine: { node: process.versions.node, arch: process.arch, platform: process.platform, cpus: (await import('node:os')).cpus().length },
  note: 'Shared machine. Every timing carries the load averages it ran under; timings under load are indicative.',
  build: { hit: buildReport.hit, ms: buildReport.ms, sourceHash: manifest.sourceHash, wireHash: manifest.wireHash, ops: manifest.ops.length,
    seconds: manifest.seconds, cBytes: manifest.emitted.cBytes, nodeBytes: manifest.node.bytes, flags: manifest.toolchain.flags.join(' '),
    firstLoad: manifest.firstLoad, warmLoad: manifest.warmLoad, load: manifest.load },
  loadStart: uptime(), workloads: {},
};

const sample = (w, backend, tag, extra = {}) => {
  const dir = join(work, w.id, `${backend}-${tag}`);
  mkdirSync(dir, { recursive: true });
  const run = runCli({ argv: w.args(dir), backend, ...extra });
  return { dir, run };
};
const summary = (run, dir) => ({ exitCode: run.exitCode, wallMs: round(run.wallMs), userS: run.userS, sysS: run.sysS, maxRssMiB: round(run.maxRssMiB), load: run.load,
  ...(run.exitCode !== 0 ? { stderr: run.stderr.slice(-2000) } : {}), dir: dir.slice(root.length) });
const compare = (js, native) => compareOutputs({ jsDir: js.dir, nativeDir: native.dir, jsStdout: js.run.stdout, nativeStdout: native.run.stdout });
// The last js round is the reference for the traced, diff and 6-thread runs.
const reference = new Map();
const againstJs = (w, dir, stdout) => { const js = reference.get(w.id); return compareOutputs({ jsDir: js.dir, nativeDir: dir, jsStdout: js.stdout, nativeStdout: stdout }); };

for (const w of workloads) {
  const record = result.workloads[w.id] = { command: w.args('<out>').map(a => a.startsWith(root) ? a.slice(root.length) : a).join(' '), samples: [] };
  // ---- wall: alternate js/native, n rounds
  for (let i = 0; i < n; i += 1) {
    const order = i % 2 === 0 ? ['js', 'native'] : ['native', 'js'];
    const runs = {};
    for (const backend of order) {
      log(`${w.id} ${backend} round ${i + 1}/${n}`);
      runs[backend] = sample(w, backend, `r${i}`);
    }
    const correctness = compare(runs.js, runs.native);
    reference.set(w.id, { dir: runs.js.dir, stdout: runs.js.run.stdout });
    record.samples.push({ round: i, order, js: summary(runs.js.run, runs.js.dir), native: summary(runs.native.run, runs.native.dir), correctness });
    if (!correctness.identical) log(`  OUTPUT DIFFERS in round ${i}: ${JSON.stringify(correctness)}`);
  }
  const ok = s => s.js.exitCode === 0 && s.native.exitCode === 0 && s.correctness.identical;
  const jsWall = record.samples.map(s => s.js.wallMs), nativeWall = record.samples.map(s => s.native.wallMs);
  record.wall = { js: { medianMs: round(median(jsWall)), ms: jsWall }, native: { medianMs: round(median(nativeWall)), ms: nativeWall },
    factor: round(median(jsWall) / median(nativeWall)), allCorrect: record.samples.every(ok) };

  // ---- traced native run: trace + phases + guard
  log(`${w.id} traced native`);
  const tDir = join(work, w.id, 'native-traced');
  mkdirSync(tDir, { recursive: true });
  const files = { trace: join(tDir, 'trace.json'), phases: join(tDir, 'phases.json'), guard: join(tDir, 'guard.json') };
  const traced = runCli({ argv: w.args(tDir), backend: 'native', preloads: [guardPreload, phasesPreload],
    env: { WONKY_NATIVE_TRACE: files.trace, WONKY_SLICE_PHASES: files.phases, WONKY_SLICE_GUARD_LOG: files.guard } });
  const trace = readJson(files.trace), phases = readJson(files.phases).phases, guard = readJson(files.guard).summary;
  const entries = Object.entries(trace.entries).filter(([, e]) => e.calls).map(([label, e]) => ({ label, entry: e.entry, calls: e.calls,
    encodeMs: round(e.encodeMs), nativeMs: round(e.nativeMs), decodeMs: round(e.decodeMs), requestWords: e.requestWords, replyWords: e.replyWords }));
  const kernelMs = entries.reduce((s, e) => s + e.encodeMs + e.nativeMs + e.decodeMs, 0);
  const hybrid = trace.hybrid ?? null;
  const hybridMs = hybrid ? hybrid.boolean.wallMs + hybrid.classes.wallMs : 0;
  record.nativeTraced = {
    ...summary(traced, tDir), correctness: againstJs(w, tDir, traced.stdout),
    buckets: {
      coldStartToKernelReadyMs: round(phases.kernelReady), coldStartToFirstCallMs: round(trace.firstCallAt),
      open: { staleCheckMs: round(trace.open.staleMs), dlopenMs: round(trace.open.dlopenMs), initMs: round(trace.open.initMs),
        locateMs: round(trace.open.locateMs), infoMs: round(trace.open.infoMs), wireImportMs: round(trace.open.wireImportMs), totalMs: round(trace.open.totalMs) },
      kernelMs: round(kernelMs), kernelNativeMs: round(entries.reduce((s, e) => s + e.nativeMs, 0)),
      encodeMs: round(entries.reduce((s, e) => s + e.encodeMs, 0)), decodeMs: round(entries.reduce((s, e) => s + e.decodeMs, 0)),
      hybridMs: round(hybridMs), hybridCalls: hybrid ? hybrid.boolean.calls + hybrid.classes.calls : 0,
      frontendHostMs: round(phases.buildEnd - phases.kernelReady - kernelMs - hybridMs),
      exportMs: round(phases.exit - phases.buildEnd), inProcessMs: round(phases.exit), processOverheadMs: round(traced.wallMs - phases.exit),
    },
    hybrid,
    // What the stale check spent, by part (file re-hash, wiring parse, toolchain, key, .node sha256, codecs).
    staleCheck: { totalMs: round(trace.open.staleMs), ...Object.fromEntries(Object.entries(trace.open.stale ?? {}).map(([k, v]) => [k, typeof v === 'number' ? round(v) : v])) },
    heap: { clearsPerRun: trace.stats?.heapClears ?? null, lastCallStartPage: trace.stats?.lastCallStartPage ?? null },
    entries, guard,
  };

  // ---- traced js run: count-kernel-calls + phases
  if (!skip.has('count')) {
    log(`${w.id} traced js (count-kernel-calls)`);
    const jDir = join(work, w.id, 'js-count');
    mkdirSync(jDir, { recursive: true });
    const jFiles = { count: join(jDir, 'count.json'), phases: join(jDir, 'phases.json') };
    const counted = runCli({ argv: w.args(jDir), backend: 'js', preloads: [countPreload, phasesPreload], env: { WONKY_NB_COUNT_OUT: jFiles.count, WONKY_SLICE_PHASES: jFiles.phases } });
    const count = readJson(jFiles.count), jPhases = readJson(jFiles.phases).phases;
    const jsEntries = count.entries.map(e => ({ entry: e.name.replace(/^kernel\/topology\.bend:geometry\./, 'kernel/geometry.bend:'), calls: e.calls, ms: round(e.ms) }));
    const jsKernel = count.entries.reduce((s, e) => s + e.ms, 0);
    const jsHybrid = count.entries.filter(e => e.name.startsWith('kernel/hybrid/')).reduce((s, e) => s + e.ms, 0);
    record.jsTraced = { ...summary(counted, jDir), note: 'count-kernel-calls.mjs instruments every kernel call and walks argument/result sizes outside the timed region; its wall is slower than a plain run',
      buckets: { coldStartToKernelReadyMs: round(jPhases.kernelReady), kernelMs: round(jsKernel), hybridMs: round(jsHybrid), frontendHostMs: round(jPhases.buildEnd - jPhases.kernelReady - jsKernel),
        exportMs: round(jPhases.exit - jPhases.buildEnd), inProcessMs: round(jPhases.exit) },
      entries: jsEntries };
  }

  // ---- diff run
  if (!skip.has('diff')) {
    log(`${w.id} diff`);
    const dDir = join(work, w.id, 'diff');
    mkdirSync(dDir, { recursive: true });
    const dTrace = join(dDir, 'trace.json');
    const dumps = join(dDir, 'divergence');
    const diffed = runCli({ argv: w.args(dDir), backend: 'diff', env: { WONKY_NATIVE_TRACE: dTrace, WONKY_DIVERGENCE_DIR: dumps } });
    // Divergences are counted from the evidence, never inferred from the exit
    // code: the dump directories the comparator wrote and the trace's counter.
    const evidence = diffEvidence({ dumpDir: dumps, traceFile: dTrace }), dt = evidence.trace;
    const profile = profileCalls(w.id);
    const fresh = record.jsTraced ? Object.fromEntries(record.jsTraced.entries.map(e => [e.entry, e.calls])) : null;
    const perEntry = SLICE_OPS.map(entryOf).map(entry => {
      const stat = dt && Object.values(dt.entries).find(e => e.entry === entry);
      return { entry, compared: stat?.compared ?? 0, words: stat?.words ?? 0, profileCalls: profile[entry] ?? 0, countRunCalls: fresh ? (fresh[entry] ?? 0) : null };
    }).filter(e => e.compared || e.profileCalls || e.countRunCalls);
    record.diff = { ...summary(diffed, dDir), divergences: evidence.divergences, divergencesInTrace: evidence.divergencesInTrace, divergenceDumps: evidence.dumps,
      ok: diffed.exitCode === 0 && evidence.divergences === 0 && evidence.divergencesInTrace === 0,
      comparedCalls: perEntry.reduce((s, e) => s + e.compared, 0), comparedWords: perEntry.reduce((s, e) => s + e.words, 0),
      countsMatchProfile: perEntry.every(e => e.compared === e.profileCalls), countsMatchCountRun: fresh ? perEntry.every(e => e.compared === e.countRunCalls) : null,
      // wonky-hybrid answers compared with the JS target's, character for character (hybrid-process.mjs).
      hybrid: dt?.hybrid ? { booleanCompared: dt.hybrid.boolean.compared, booleanCalls: dt.hybrid.boolean.calls,
        classesCompared: dt.hybrid.classes.compared, classesCalls: dt.hybrid.classes.calls } : null,
      perEntry, correctness: againstJs(w, dDir, diffed.stdout) };
  }

  // ---- 6 threads (secondary)
  if (!skip.has('threads6')) {
    log(`${w.id} native 6 threads`);
    const sDir = join(work, w.id, 'native-t6');
    mkdirSync(sDir, { recursive: true });
    const t6 = runCli({ argv: w.args(sDir), backend: 'native', env: { WONKY_NATIVE_THREADS: '6' } });
    record.threads6 = { ...summary(t6, sDir), correctness: againstJs(w, sDir, t6.stdout) };
  }
  writeFileSync(join(work, 'partial.json'), JSON.stringify(result, null, 1));
}

// ---- negative workloads
if (!skip.has('negative')) {
  result.negative = {};
  for (const w of NEGATIVE_WORKLOADS) {
    log(`negative ${w.id}`);
    const dir = join(work, w.id);
    mkdirSync(dir, { recursive: true });
    const guardFile = join(dir, 'guard.json');
    const run = runCli({ argv: w.args(dir), backend: 'native', preloads: [guardPreload], env: { WONKY_SLICE_GUARD_LOG: guardFile } });
    const guard = readJson(guardFile).summary;
    const entry = /kernel entry (\S+) \(kernel\.(\S+)\) is not in the native build/.exec(run.stderr);
    result.negative[w.id] = { exitCode: run.exitCode, wallMs: round(run.wallMs), load: run.load, message: run.stderr.split('\n').find(l => l.includes('native build')) ?? run.stderr.slice(-500),
      firstRefusedEntry: entry?.[1] ?? null, jsKernelLoaded: guard.jsKernel, addons: guard.addons,
      ok: run.exitCode === 1 && Boolean(entry) && !guard.jsKernel && run.wallMs < 2000 };
  }
}

// ---- first load of a fresh copy of the binary (a new file for macOS' first-use check)
if (!skip.has('firstload')) {
  const copy = join(work, 'fresh-cache');
  rmSync(copy, { recursive: true, force: true });
  mkdirSync(copy, { recursive: true });
  cpSync(join(root, 'tmp/native-bridge/cache', manifest.sourceHash), join(copy, manifest.sourceHash), { recursive: true });
  cpSync(join(root, 'tmp/native-bridge/cache/planar.json'), join(copy, 'planar.json'));
  const w = SLICE_WORKLOADS.find(x => x.id === 'fs-bracket');
  const runs = [];
  for (const tag of ['first', 'second']) {
    const dir = join(work, `fresh-copy-${tag}`);
    mkdirSync(dir, { recursive: true });
    const trace = join(dir, 'trace.json');
    const run = runCli({ argv: w.args(dir), backend: 'native', env: { WONKY_NATIVE_CACHE: copy, WONKY_NATIVE_TRACE: trace } });
    const t = run.exitCode === 0 ? readJson(trace) : null;
    runs.push({ run: tag, exitCode: run.exitCode, wallMs: round(run.wallMs), dlopenMs: round(t?.open.dlopenMs), staleCheckMs: round(t?.open.staleMs), load: run.load });
  }
  result.firstLoad = { afterRebuild: manifest.firstLoad, warmAfterRebuild: manifest.warmLoad, freshCopy: runs,
    note: 'afterRebuild is the smoke-test child of build-native.mjs, the first process that ever loaded this binary; freshCopy copies the cache entry to new files and runs fs-bracket twice' };
}

// ---- projections (docs/native-bridge/proposal-functional.md) next to the measurement
const projection = readJson(join(root, 'out/native-bridge/proposal-functional/projection.json'));
result.comparison = workloads.map(w => {
  const p = projection.rows.find(r => r.id === w.id), r = result.workloads[w.id];
  const measured = r.wall.factor;
  const projected = p?.t1?.speedup ?? null;
  return { id: w.id, jsMedianMs: r.wall.js.medianMs, nativeMedianMs: r.wall.native.medianMs, measuredFactor: measured,
    projectedJsMs: round(p?.W), projectedNativeMs: round(p?.t1?.wall), projectedFactor: round(projected), projectedPessimisticFactor: round(p?.t1pess?.speedup),
    projectionSource: p?.source ?? null, deviation: projected ? round((measured - projected) / projected) : null,
    threads6Ms: r.threads6?.wallMs ?? null, allCorrect: r.wall.allCorrect };
});
result.loadEnd = uptime();
result.finishedAt = new Date().toISOString();
mkdirSync(join(root, 'out/native-bridge/slice'), { recursive: true });
writeFileSync(outFile, JSON.stringify(result, null, 1) + '\n');
log(`wrote ${outFile.slice(root.length)}`);
for (const c of result.comparison) log(`${c.id}: js ${c.jsMedianMs} ms, native ${c.nativeMedianMs} ms, x${c.measuredFactor} (projected x${c.projectedFactor}), correct ${c.allCorrect}`);
