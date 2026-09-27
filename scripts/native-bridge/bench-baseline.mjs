// Out-of-process baseline measurements (see docs/native-bridge/baseline.md).
//   node scripts/native-bridge/bench-baseline.mjs [--quick] [--label NAME]
// Round trips (p50/p95/p99) for 64 B, 4 KB, 100 KB and 1 MB with byte-exact
// verification of every answer, a plain-C frame-echo floor, process start, RSS,
// idle CPU, the production kernel op against its JS-target reference, and
// failure detection. Each through the async client and through the blocking
// bridge a synchronous host needs (baseline-sync.mjs), plus a replay of the
// kernel-call patterns recorded by count-kernel-calls.mjs. Load averages are recorded next to every block: the
// machine is shared, numbers under load are indicative only.
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cpus, loadavg, totalmem, arch, platform } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { build, frameEchoBinary, outDir, root, serviceBinary, sourceSha256 } from './build-baseline.mjs';
import { ProcessKernel, NativeKernelError, OP, encodeRequest } from './baseline-client.mjs';
import { Worker } from 'node:worker_threads';
import { SyncProcessKernel } from './baseline-sync.mjs';
import { DirectProcessKernel, openBlockingPipes } from './baseline-direct.mjs';
import { closeSync, readSync, writeSync } from 'node:fs';

// Blocking clients for a synchronous host: a worker thread owning the async
// client (Atomics hand-off) and the calling thread on blocking FIFOs.
const BLOCKING = { workerBridge: SyncProcessKernel, directPipes: DirectProcessKernel };
import { KIND, kernelPayload, referenceEvidence, checkEvidence } from './baseline-reference.mjs';

const quick = process.argv.includes('--quick');
// --label NAME writes report-NAME.json, so repeated runs under changing load stay side by side.
const label = process.argv.includes('--label') ? process.argv[process.argv.indexOf('--label') + 1] : null;
const reportFile = join(outDir, label ? `report-${label}.json` : quick ? 'report-quick.json' : 'report.json');
const scratch = join(root, 'tmp/native-bridge/baseline');
mkdirSync(scratch, { recursive: true });

const load = () => loadavg().map(v => Math.round(v * 100) / 100);
const round = v => Math.round(v * 1000) / 1000;
function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = q => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
  return { n: sorted.length, min: round(sorted[0]), p50: round(at(0.5)), p95: round(at(0.95)), p99: round(at(0.99)), max: round(sorted.at(-1)), mean: round(sorted.reduce((a, b) => a + b, 0) / sorted.length) };
}
const rssKiB = pid => Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)]).toString().trim());
const cpuSeconds = pid => {
  const [m, s] = execFileSync('ps', ['-o', 'time=', '-p', String(pid)]).toString().trim().split(':');
  return Number(m) * 60 + Number(s);
};

const record = existsSync(join(outDir, 'build.json')) ? JSON.parse(readFileSync(join(outDir, 'build.json'), 'utf8')) : null;
const fresh = !existsSync(serviceBinary) || record?.sourceSha256 !== sourceSha256();
const buildRecord = fresh ? await build() : record;

const report = {
  schema: 'wonky.native-bridge-baseline/1', capturedAt: new Date().toISOString(), quick, label,
  environment: { cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryBytes: totalmem(), architecture: arch(), platform: platform(), node: process.version, bend: buildRecord.bend, loadAtStart: load(), uptimeAtStart: execFileSync('uptime').toString().trim() },
  build: { sourceSha256: buildRecord.sourceSha256, rebuiltForThisRun: fresh, serviceCompileWallMs: round(buildRecord.steps.service.wallMs), loadDuringCompile: buildRecord.steps.service.loadBefore },
  method: {
    transport: 'One long-lived native Bend process (ARM64 CPU target, --threads 1 unless stated), stdin/stdout pipes, 16-byte little-endian frame header. Requests are sequential (one in flight) unless stated.',
    timing: 'performance.now() in Node from encode+write to the fully parsed and byte-compared answer. Warm-up requests are excluded. Percentiles are nearest-rank.',
    floor: 'frame-echo (kernel/service/baseline/frame-echo.c, plain C) reads each identical request frame completely and writes it back through the same kind of pipes and the same client code path; its round trip is the transport + Node floor without any Bend work.',
    memory: 'RSS of the service process via ps after each block (KiB). Bend frees by reference counting; per-byte payload lists dominate.',
    correctness: 'Every echo/load answer is compared byte for byte. Kernel-op evidence (hash, F32x2 volume words, error count) must equal the JS-target build of the same production kernel sources and the independent double volume within 1e-11 relative.',
    load: 'The machine is shared; load averages are recorded before and after every block. Results under load are indicative, not a quiet-machine benchmark.',
  },
  startup: {}, roundTrip: [], pipelined: {}, kernel: {}, idle: {}, failures: {},
};
const save = () => writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');

// Transport floor: frame-echo answers with the request frame itself.
class FloorPipe {
  #child; #want = 0; #got = 0; #resolve = null;
  constructor() {
    this.#child = spawn(frameEchoBinary, [], { stdio: ['pipe', 'pipe', 'ignore'] });
    this.#child.stdout.on('data', chunk => {
      this.#got += chunk.length;
      if (this.#resolve && this.#got >= this.#want) { const r = this.#resolve; this.#resolve = null; r(); }
    });
  }
  roundTrip(frame) {
    this.#want = frame.length; this.#got = 0;
    const done = new Promise(resolve => { this.#resolve = resolve; });
    this.#child.stdin.write(frame);
    return done;
  }
  close() { this.#child.stdin.end(); }
}

async function timed(samples, warmup, once) {
  for (let i = 0; i < warmup; i++) await once();
  const times = new Array(samples);
  for (let i = 0; i < samples; i++) {
    const t = performance.now();
    await once();
    times[i] = performance.now() - t;
  }
  return times;
}

// Startup
// -------
{
  // A new file copy: the first exec of a freshly written binary pays macOS
  // first-launch checks; afterwards starts are warm.
  const copy = join(scratch, `service-copy-${process.pid}`);
  copyFileSync(serviceBinary, copy);
  const firstLoad = load();
  const first = await ProcessKernel.start(copy);
  const firstMs = first.startMs;
  await first.close();
  rmSync(copy);
  const runs = quick ? 5 : 20, ready = [], lifecycle = [], rss = [];
  const loadBefore = load();
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    const kernel = await ProcessKernel.start(serviceBinary);
    ready.push(kernel.startMs);
    rss.push(rssKiB(kernel.pid));
    const exit = await kernel.close();
    if (exit.code !== 0) throw new Error(`service exited ${exit.code} after startup`);
    lifecycle.push(performance.now() - t);
  }
  // Control: the plain C frame-echo, copied the same way (stdin at EOF, so it
  // exits at once). If its first exec is just as slow, the cost is the OS
  // (first launch of a new file), not Bend.
  const control = frameEchoBinary;
  const controlRuns = [];
  for (let i = 0; i < 3; i++) {
    const copyC = join(scratch, `control-copy-${process.pid}-${i}`);
    copyFileSync(control, copyC);
    const timeExec = () => { const t = performance.now(); const r = spawnSync(copyC, [], { stdio: 'ignore' }); if (r.status !== 0) throw new Error(`control exited ${r.status}`); return round(performance.now() - t); };
    controlRuns.push({ firstMs: timeExec(), secondMs: timeExec() });
    rmSync(copyC);
  }
  const serviceCopies = [];
  for (let i = 0; i < 2; i++) {
    const again = join(scratch, `service-copy-${process.pid}-${i}`);
    copyFileSync(serviceBinary, again);
    const a = await ProcessKernel.start(again); await a.close();
    const b = await ProcessKernel.start(again); await b.close();
    serviceCopies.push({ firstMs: round(a.startMs), secondMs: round(b.startMs) });
    rmSync(again);
  }
  const blockingStarts = {};
  for (const [name, Client] of Object.entries(BLOCKING)) {
    const starts = [];
    for (let i = 0; i < (quick ? 3 : 10); i++) {
      const kernel = Client.start(serviceBinary);
      starts.push(kernel.startMs);
      await kernel.close();
    }
    blockingStarts[name] = stats(starts);
  }
  report.startup = {
    firstExecOfNewCopyMs: round(firstMs), firstExecLoad: firstLoad,
    newCopyExperiment: { service: serviceCopies, plainCBinary: controlRuns, note: 'first = first exec of a freshly copied file, second = the same file again. The C control (frame-echo, spawn to exit) has no Bend runtime; the service values are spawn to READY.' },
    blockingClientStartMs: blockingStarts,
    spawnToReadyMs: stats(ready), spawnToCleanExitMs: stats(lifecycle), idleRssKiB: stats(rss),
    loadBefore, loadAfter: load(),
    note: 'spawnToReady covers fork/exec, Bend runtime init, opening /dev/stdin and /dev/stdout and the READY frame reaching Node. spawnToCleanExit adds stdin EOF and process exit.',
  };
  save();
  console.log(`startup: ready p50 ${report.startup.spawnToReadyMs.p50} ms (first exec of new copy ${report.startup.firstExecOfNewCopyMs} ms), idle RSS ${report.startup.idleRssKiB.p50} KiB`);
}

// Round trips
// -----------
const plan = [
  { label: '64 B', size: 64, samples: quick ? 300 : 2000, warmup: 200 },
  { label: '4 KB', size: 4096, samples: quick ? 300 : 2000, warmup: 200 },
  { label: '100 KB', size: 102400, samples: quick ? 50 : 300, warmup: 20 },
  { label: '1 MB', size: 1048576, samples: quick ? 20 : 100, warmup: 5 },
];
{
  const kernel = await ProcessKernel.start(serviceBinary, { requestTimeoutMs: 60000 });
  const floor = new FloorPipe();
  let peakRss = rssKiB(kernel.pid);
  for (const { label, size, samples, warmup } of plan) {
    const payload = randomBytes(size);
    const row = { label, payloadBytes: size, loadBefore: load() };
    const rssBefore = rssKiB(kernel.pid);
    let mismatches = 0;
    row.echoMs = stats(await timed(samples, warmup, async () => {
      if (!(await kernel.request(OP.echo, payload)).equals(payload)) mismatches++;
    }));
    row.echoMismatches = mismatches;
    row.rssKiBBefore = rssBefore;
    row.rssKiBAfter = rssKiB(kernel.pid);
    peakRss = Math.max(peakRss, row.rssKiBAfter);
    const frame = encodeRequest(OP.echo, 1, payload);
    row.floorMs = stats(await timed(samples, warmup, () => floor.roundTrip(frame)));
    if (size >= 102400) {
      // Split the echo into its two directions: store = payload in, 4 bytes out;
      // load = 16 bytes in, payload out (blob kept resident by store).
      row.storeMs = stats(await timed(samples, warmup, () => kernel.request(OP.store, payload)));
      let loadMismatches = 0;
      row.loadMs = stats(await timed(samples, warmup, async () => {
        if (!(await kernel.request(OP.load)).equals(payload)) loadMismatches++;
      }));
      row.loadMismatches = loadMismatches;
      row.rssKiBAfterStoreLoad = rssKiB(kernel.pid);
      peakRss = Math.max(peakRss, row.rssKiBAfterStoreLoad);
    }
    row.loadAfter = load();
    row.throughputMBps = round(size / 1e6 / (row.echoMs.p50 / 1000));
    report.roundTrip.push(row);
    save();
    console.log(`${label}: echo p50 ${row.echoMs.p50} / p95 ${row.echoMs.p95} / p99 ${row.echoMs.p99} ms, floor p50 ${row.floorMs.p50} ms, RSS ${row.rssKiBAfter} KiB, load ${row.loadBefore[0]}`);
  }
  report.memory = { peakRssKiB: peakRss, note: 'Peak of the sampled RSS values of the long-lived service across all round-trip blocks.' };
  const counters = await kernel.request(OP.ping);
  report.memory.serviceCounters = { requests: counters.readUInt32LE(0), bytesIn: counters.readUInt32LE(4), bytesOut: counters.readUInt32LE(8), residentBlobBytes: counters.readUInt32LE(12) };
  report.memory.rssAfterAllKiB = rssKiB(kernel.pid);
  floor.close();
  const exit = await kernel.close();
  if (exit.code !== 0 || report.roundTrip.some(r => r.echoMismatches || r.loadMismatches)) throw new Error('round-trip block failed verification');
  save();
}

// Blocking clients (synchronous host), same sizes
// -----------------------------------------------
function timedSync(samples, warmup, once) {
  for (let i = 0; i < warmup; i++) once();
  const times = new Array(samples);
  for (let i = 0; i < samples; i++) { const t = performance.now(); once(); times[i] = performance.now() - t; }
  return times;
}
report.blockingRoundTrip = {};
for (const [name, Client] of Object.entries(BLOCKING)) {
  const kernel = Client.start(serviceBinary, { requestTimeoutMs: 60000 });
  const rows = [];
  for (const { label, size, samples, warmup } of plan) {
    const payload = randomBytes(size);
    const row = { label, payloadBytes: size, loadBefore: load() };
    let mismatches = 0;
    row.echoMs = stats(timedSync(samples, warmup, () => { if (!kernel.request(OP.echo, payload).equals(payload)) mismatches++; }));
    Object.assign(row, { echoMismatches: mismatches, rssKiB: rssKiB(kernel.pid), loadAfter: load() });
    rows.push(row);
    console.log(`${name} ${label}: echo p50 ${row.echoMs.p50} / p95 ${row.echoMs.p95} / p99 ${row.echoMs.p99} ms, load ${row.loadBefore[0]}`);
  }
  report.blockingRoundTrip[name] = rows;
  save();
  if ((await kernel.close()).code !== 0 || rows.some(r => r.echoMismatches)) throw new Error(`${name} round-trip block failed verification`);
}
// Floor of the direct variant: frame-echo on the same blocking FIFOs. (A
// streaming echo such as /bin/cat deadlocks here on frames larger than the
// pipe buffer, because the client writes the whole frame before reading.)
{
  const pipes = openBlockingPipes();
  const echo = spawn(frameEchoBinary, [], { stdio: [pipes.childIn, pipes.childOut, 'ignore'] });
  closeSync(pipes.childIn); closeSync(pipes.childOut);
  const rows = [];
  for (const { label, size, samples, warmup } of plan) {
    const frame = encodeRequest(OP.echo, 1, randomBytes(size)), back = Buffer.alloc(frame.length);
    const once = () => {
      for (let at = 0; at < frame.length;) at += writeSync(pipes.parentWrite, frame, at, frame.length - at);
      for (let at = 0; at < back.length;) { const got = readSync(pipes.parentRead, back, at, back.length - at, null); if (!got) throw new Error('frame-echo closed'); at += got; }
    };
    rows.push({ label, payloadBytes: size, floorMs: stats(timedSync(samples, warmup, once)), exact: back.equals(frame) });
  }
  closeSync(pipes.parentWrite);
  closeSync(pipes.parentRead);
  await new Promise(resolve => echo.on('close', resolve));
  report.blockingRoundTrip.directPipesFloor = rows;
  save();
  console.log(`direct floor: ${rows.map(r => `${r.label} p50 ${r.floorMs.p50}`).join(', ')} ms`);
}

// Small round trips with more Bend worker threads (the in-process binding
// fixes its pool size at init; the service fixes it at spawn)
// -------------------------------------------------------------------------
report.roundTripThreads = {};
for (const threads of [6, 18]) {
  const kernel = await ProcessKernel.start(serviceBinary, { threads });
  const rows = {};
  for (const { label, size } of plan.slice(0, 2)) {
    const payload = randomBytes(size);
    let mismatches = 0;
    const loadBefore = load();
    const times = await timed(quick ? 300 : 1000, 100, async () => { if (!(await kernel.request(OP.echo, payload)).equals(payload)) mismatches++; });
    rows[label] = { echoMs: stats(times), mismatches, loadBefore, loadAfter: load() };
  }
  rows.rssKiB = rssKiB(kernel.pid);
  report.roundTripThreads[`threads${threads}`] = rows;
  await kernel.close();
  save();
  console.log(`threads ${threads}: 64 B p50 ${rows['64 B'].echoMs.p50} ms, 4 KB p50 ${rows['4 KB'].echoMs.p50} ms`);
}

// Replay of recorded kernel-call patterns
// ---------------------------------------
// out/native-bridge/profile/calls/*.json (scripts/native-bridge/count-kernel-calls.mjs)
// records, per kernel function, the call count and the summed size of the
// argument and result value graphs of a real JS-target run. Each call becomes
// one op-6 request: request = 4 + 4 * ceil(argWords / calls) bytes, reply =
// max(4, 4 * ceil(resultWords / calls)) bytes, with wire words approximated as
// numbers + object nodes + bigints (an over-estimate of the generated U32
// format: it counts one word per list cell, gen-wire needs one per list). The
// service decodes every request word and sums it; the client checks the sum
// and the reply length. No kernel work runs: this is the transport cost of the
// call pattern, sequential like the synchronous host.
{
  const callsDir = join(root, 'out/native-bridge/profile/calls');
  report.replay = { source: 'out/native-bridge/profile/calls', workloads: {} };
  const files = existsSync(callsDir) ? readdirSync(callsDir).filter(f => f.endsWith('.json')).sort() : [];
  if (!files.length) report.replay.missing = 'no recorded call profiles; run scripts/native-bridge/profile-workloads.mjs first';
  const asyncKernel = await ProcessKernel.start(serviceBinary, { requestTimeoutMs: 60000 });
  const blocking = Object.fromEntries(Object.entries(BLOCKING).map(([name, Client]) => [name, Client.start(serviceBinary, { requestTimeoutMs: 60000 })]));
  for (const file of files) {
    const bytes = readFileSync(join(callsDir, file));
    const profile = JSON.parse(bytes);
    const words = size => size.numbers + size.nodes + size.bigint;
    const schedule = profile.entries.map(e => {
      const argWords = Math.ceil(words(e.args) / e.calls), resultWords = Math.ceil(words(e.result) / e.calls);
      const payload = Buffer.alloc(4 + 4 * argWords);
      randomBytes(4 * argWords).copy(payload, 4);
      const reply = Math.max(4, 4 * resultWords);
      payload.writeUInt32LE(reply, 0);
      let sum = 0;
      for (let i = 4; i < payload.length; i += 4) sum = (sum + payload.readUInt32LE(i)) >>> 0;
      return { name: e.name, calls: e.calls, payload, reply, sum, truncated: e.args.truncated || e.result.truncated };
    });
    const calls = schedule.reduce((a, e) => a + e.calls, 0);
    const bytesOut = schedule.reduce((a, e) => a + e.calls * (16 + e.payload.length), 0);
    const bytesIn = schedule.reduce((a, e) => a + e.calls * (16 + e.reply), 0);
    const check = (e, answer) => answer.length === e.reply && answer.readUInt32LE(0) === e.sum;
    const row = {
      profileSha256: createHash('sha256').update(bytes).digest('hex'), profileExitCode: profile.exitCode,
      calls, requestBytes: bytesOut, responseBytes: bytesIn, truncatedEntries: schedule.filter(e => e.truncated).length,
      recordedJsKernelMs: round(profile.totals.ms), loadBefore: load(),
    };
    let bad = 0;
    let t = performance.now();
    for (const e of schedule) for (let i = 0; i < e.calls; i++) if (!check(e, await asyncKernel.request(OP.replay, e.payload))) bad++;
    row.asyncMs = round(performance.now() - t);
    row.asyncPerCallUs = round(1000 * row.asyncMs / calls);
    for (const [name, kernel] of Object.entries(blocking)) {
      t = performance.now();
      for (const e of schedule) for (let i = 0; i < e.calls; i++) if (!check(e, kernel.request(OP.replay, e.payload))) bad++;
      row[`${name}Ms`] = round(performance.now() - t);
      row[`${name}PerCallUs`] = round(1000 * row[`${name}Ms`] / calls);
    }
    row.badAnswers = bad;
    row.loadAfter = load();
    report.replay.workloads[file.replace(/\.json$/, '')] = row;
    save();
    if (bad) throw new Error(`replay ${file}: ${bad} wrong answers`);
    console.log(`replay ${file}: ${calls} calls, ${(bytesOut / 1e6).toFixed(2)} MB out, ${(bytesIn / 1e6).toFixed(2)} MB in: async ${row.asyncMs} ms, worker bridge ${row.workerBridgeMs} ms, direct ${row.directPipesMs} ms (recorded JS kernel time ${row.recordedJsKernelMs} ms)`);
  }
  report.replay.rssKiB = { async: rssKiB(asyncKernel.pid), ...Object.fromEntries(Object.entries(blocking).map(([name, k]) => [name, rssKiB(k.pid)])) };
  await asyncKernel.close();
  for (const kernel of Object.values(blocking)) await kernel.close();
  save();
}

// Pipelined small requests (several in flight, answered in order)
// ---------------------------------------------------------------
{
  const kernel = await ProcessKernel.start(serviceBinary);
  const payload = randomBytes(64), total = quick ? 2000 : 10000, window = 32;
  const loadBefore = load();
  const started = performance.now();
  let sent = 0, bad = 0;
  const lane = async () => {
    while (sent < total) { sent++; if (!(await kernel.request(OP.echo, payload)).equals(payload)) bad++; }
  };
  await Promise.all(Array.from({ length: window }, lane));
  const elapsed = performance.now() - started;
  report.pipelined = { payloadBytes: 64, inFlight: window, requests: total, mismatches: bad, elapsedMs: round(elapsed), requestsPerSecond: Math.round(total / (elapsed / 1000)), loadBefore, loadAfter: load() };
  await kernel.close();
  save();
  console.log(`pipelined 64 B x${window}: ${report.pipelined.requestsPerSecond} req/s`);
}

// Production kernel op end to end
// -------------------------------
{
  const cases = { oneBoolean: [KIND.boolean, 0, 1, 37], oneComparison: [KIND.comparison, 0, 1, 37], booleans1024: [KIND.boolean, 8, 4, 37] };
  const reference = referenceEvidence(Object.values(cases));
  for (const threads of [1, 6]) {
    const kernel = await ProcessKernel.start(serviceBinary, { threads, requestTimeoutMs: 60000 });
    const rows = {};
    for (const [i, [name, c]] of Object.entries(cases).entries()) {
      if (threads !== 1 && name !== 'booleans1024') continue;
      const payload = kernelPayload(...c);
      const first = await kernel.request(OP.kernel, payload);
      const evidence = JSON.parse(first.toString('utf8'));
      const check = checkEvidence(evidence, reference[i], c);
      if (!check.ok) throw new Error(`kernel op ${name} failed verification: ${JSON.stringify({ evidence, reference: reference[i], check })}`);
      const samples = name === 'booleans1024' ? (quick ? 5 : 20) : (quick ? 100 : 500);
      let drift = 0;
      const loadBefore = load();
      const times = await timed(samples, 3, async () => { if (!(await kernel.request(OP.kernel, payload)).equals(first)) drift++; });
      rows[name] = { case: { kind: c[0] === KIND.boolean ? 'boolean' : 'comparison', depth: c[1], count: c[2], seed: c[3], operations: c[2] * 2 ** c[1] }, rttMs: stats(times), responseBytes: first.length, sameAsJsTarget: check.sameAsJsTarget, relativeVolumeError: check.relativeVolumeError, answersDifferingFromFirst: drift, loadBefore, loadAfter: load() };
    }
    if (threads === 1) {
      const echo16 = randomBytes(16);
      rows.echo16 = { rttMs: stats(await timed(quick ? 100 : 500, 20, () => kernel.request(OP.echo, echo16))), note: 'Same request size as the kernel op, no kernel work.' };
    }
    rows.rssKiB = rssKiB(kernel.pid);
    report.kernel[`threads${threads}`] = rows;
    await kernel.close();
    save();
    console.log(`kernel op threads ${threads}: ${Object.entries(rows).filter(([, r]) => r.rttMs).map(([n, r]) => `${n} p50 ${r.rttMs.p50} ms`).join(', ')}`);
  }
}

// Idle CPU of a waiting service
// -----------------------------
for (const threads of [1, 18]) {
  const kernel = await ProcessKernel.start(serviceBinary, { threads });
  await kernel.request(OP.ping);
  const before = cpuSeconds(kernel.pid);
  await sleep(2000);
  report.idle[`threads${threads}`] = { idleWallMs: 2000, cpuSeconds: round(cpuSeconds(kernel.pid) - before), rssKiB: rssKiB(kernel.pid), note: 'ps TIME has 10 ms resolution.' };
  await kernel.close();
}
save();

// Failure behaviour
// -----------------
async function timeToReject(promise) {
  const t = performance.now();
  try { await promise; return { rejected: false }; } catch (error) {
    return { rejected: error instanceof NativeKernelError, afterMs: round(performance.now() - t), message: error.message, timeout: Boolean(error.timeout), signal: error.signal ?? null, code: error.code ?? null };
  }
}
{
  const f = report.failures;
  // SIGKILL while a 1 MB echo is being processed.
  {
    const kernel = await ProcessKernel.start(serviceBinary);
    const pending = kernel.request(OP.echo, randomBytes(1 << 20));
    await sleep(10);
    const killedAt = performance.now();
    kernel.kill('SIGKILL');
    try { await pending; } catch { /* measured below */ }
    const detectMs = performance.now() - killedAt;
    const exit = await kernel.exited;
    const next = await timeToReject(kernel.request(OP.ping));
    f.sigkillDuringRequest = { detectedAfterMs: round(detectMs), exitSignal: exit.signal, laterRequest: next };
  }
  // SIGKILL while idle, detected at the next request.
  {
    const kernel = await ProcessKernel.start(serviceBinary);
    kernel.kill('SIGKILL');
    await kernel.exited;
    f.sigkillWhileIdle = { nextRequest: await timeToReject(kernel.request(OP.echo, Buffer.from('x'))) };
  }
  // A stopped (hung) process: only the per-request timeout can detect it.
  {
    const kernel = await ProcessKernel.start(serviceBinary, { requestTimeoutMs: 250 });
    process.kill(kernel.pid, 'SIGSTOP');
    f.sigstopHang = { requestTimeoutMs: 250, request: await timeToReject(kernel.request(OP.ping)), exit: await kernel.exited };
  }
  // Malformed input: bad magic, oversize length, EOF inside a frame.
  for (const [name, bytes] of [
    ['badMagic', Buffer.from('GARBAGE-NOT-A-FRAME-')],
    ['tooLarge', (() => { const b = encodeRequest(OP.echo, 5, Buffer.alloc(0)); b.writeUInt32LE(0xffffffff, 12); return b; })()],
  ]) {
    const kernel = await ProcessKernel.start(serviceBinary);
    const t = performance.now();
    const frame = kernel.expect(0, 5000);
    kernel.writeRaw(bytes);
    const answer = await frame;
    const exit = await kernel.exited;
    f[name] = { answerStatus: answer.status, answer: answer.payload.toString('utf8'), exitCode: exit.code, stderr: exit.stderr.trim(), exitAfterMs: round(performance.now() - t) };
  }
  for (const [name, bytes] of [
    ['eofInsideHeader', encodeRequest(OP.echo, 1, Buffer.alloc(10)).subarray(0, 7)],
    ['eofInsidePayload', encodeRequest(OP.echo, 1, Buffer.alloc(10)).subarray(0, 20)],
  ]) {
    const kernel = await ProcessKernel.start(serviceBinary);
    kernel.writeRaw(bytes);
    const exit = await kernel.close();
    f[name] = { exitCode: exit.code, stderr: exit.stderr.trim() };
  }
  // Unknown op is recoverable.
  {
    const kernel = await ProcessKernel.start(serviceBinary);
    const unknown = await timeToReject(kernel.request(77));
    const after = await kernel.request(OP.echo, Buffer.from('ok'));
    f.unknownOp = { ...unknown, processStillAnswers: after.toString() === 'ok' };
    await kernel.close();
  }
  // Blocking clients: SIGKILL during requests (a killer thread kills the child
  // 50 ms in while the blocked thread loops over 1 MB echos and stamps the
  // kill time), and a stopped process.
  const KILLER = `
const { workerData } = require('node:worker_threads');
Atomics.wait(new Int32Array(workerData.sleep), 0, 0, workerData.delayMs);
new Float64Array(workerData.stamp)[0] = performance.timeOrigin + performance.now();
process.kill(workerData.pid, 'SIGKILL');`;
  for (const [name, Client] of Object.entries(BLOCKING)) {
    const kernel = Client.start(serviceBinary);
    const payload = randomBytes(1 << 20), stamp = new SharedArrayBuffer(8);
    const killer = new Worker(KILLER, { eval: true, workerData: { sleep: new SharedArrayBuffer(4), stamp, delayMs: 50, pid: kernel.pid } });
    const killerDone = new Promise(resolve => killer.on('exit', resolve));
    let error = null, answered = 0;
    try { for (;;) { kernel.request(OP.echo, payload); answered++; } } catch (e) { error = e; }
    const thrownAt = performance.timeOrigin + performance.now();
    const sigkill = { rejected: error instanceof NativeKernelError, detectedAfterMs: round(thrownAt - new Float64Array(stamp)[0]), answeredBeforeKill: answered, message: error?.message };
    let later = null;
    try { kernel.request(OP.ping); } catch (e) { later = e; }
    sigkill.laterRequestRejected = later instanceof NativeKernelError;
    sigkill.exit = await kernel.exited;
    await killerDone;
    const stopped = Client.start(serviceBinary, { requestTimeoutMs: 250 });
    process.kill(stopped.pid, 'SIGSTOP');
    const s = performance.now();
    let hang = null;
    try { stopped.request(OP.ping); } catch (e) { hang = e; }
    f[`${name}`] = { sigkillDuringRequests: sigkill, sigstopHang: { requestTimeoutMs: 250, rejected: hang instanceof NativeKernelError, timeout: Boolean(hang?.timeout), afterMs: round(performance.now() - s), message: hang?.message, exit: await stopped.exited } };
  }
  f.restartAfterCrashMs = report.startup.spawnToReadyMs.p50;
  save();
  console.log(`failures: SIGKILL detected after ${f.sigkillDuringRequest.detectedAfterMs} ms (worker bridge ${f.workerBridge.sigkillDuringRequests.detectedAfterMs}, direct ${f.directPipes.sigkillDuringRequests.detectedAfterMs}), SIGSTOP after ${f.sigstopHang.request.afterMs} ms (timeout), bad magic exit ${f.badMagic.exitCode}, too large exit ${f.tooLarge.exitCode}, EOF exits ${f.eofInsideHeader.exitCode}/${f.eofInsidePayload.exitCode}`);
}
report.environment.loadAtEnd = load();
report.environment.uptimeAtEnd = execFileSync('uptime').toString().trim();
save();
console.log(`report: ${reportFile}`);
