#!/usr/bin/env node
// Long-lived-process benchmark of the native slice: does per-call native time
// stay flat when one process makes many kernel calls (a viewer or review
// server), or does it degrade with heap churn? Every child is a fresh process;
// the runtime is process-global, so each heap mode needs its own process.
//
//   record   one child with WONKY_BACKEND=native builds fs-cut-h1 and fs-fuse-g1
//            in-process through the unchanged src/index.mjs build() and records
//            every native request (op, words) and the sha256 of every reply
//   replay   one child per heap mode opens the same cached build (stale check,
//            dlopen, init({threads: 1, heap})) and replays
//              passes: the whole recorded call sequence P times (per-pass ms)
//              series: the heaviest identity.boolean_result and planarBoolean
//                      request R times each (per-call ms)
//            every reply is compared with the recorded sha256 (a mismatch fails)
//   heap 'clear' is the production behaviour (every call starts on an empty
//   heap); 'keep' is the old behaviour, available only as an init option for
//   this measurement.
//
//   node scripts/native-bridge/slice-churn.mjs [--passes 8] [--repeat 40]
// writes out/native-bridge/slice/churn.json; uptime before and after every child.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { root, uptime } from './slice-lib.mjs';

const self = fileURLToPath(import.meta.url);
const work = join(root, 'tmp/native-bridge/slice/churn');
const outFile = join(root, 'out/native-bridge/slice/churn.json');
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const round = x => Math.round(x * 100) / 100;
const hex = words => Buffer.from(words.buffer, words.byteOffset, words.byteLength);
const RECORDED = ['fixtures/public-boolean-regressions/adapted/cut-h1.fs', 'fixtures/public-boolean-regressions/adapted/fuse-g1.fs'];

async function record(file) {
  const { openNativeBackend } = await import(pathToFileURL(join(root, 'src/native/native-kernel.mjs')).href);
  const { sha256 } = await import(pathToFileURL(join(root, 'src/native/build-key.mjs')).href);
  const backend = await openNativeBackend();
  const calls = [], call = backend.call.bind(backend);
  backend.call = (op, words) => {
    const reply = call(op, words);
    calls.push({ op, label: backend.manifest.ops[op].label, request: Array.from(words), replyWords: reply.length, replySha256: sha256(hex(reply)) });
    return reply;
  };
  const { build } = await import(pathToFileURL(join(root, 'src/index.mjs')).href);
  for (const source of RECORDED) await build(readFileSync(join(root, source), 'utf8'));
  writeFileSync(file, JSON.stringify({ sourceHash: backend.manifest.sourceHash, sources: RECORDED, calls }));
  return { calls: calls.length };
}

async function replay(file, heap, passes, repeat) {
  const { locateBuild, staleCheck } = await import(pathToFileURL(join(root, 'src/native/native-kernel.mjs')).href);
  const { sha256 } = await import(pathToFileURL(join(root, 'src/native/build-key.mjs')).href);
  const recorded = JSON.parse(readFileSync(file, 'utf8'));
  const located = locateBuild();
  staleCheck(located);
  if (located.manifest.sourceHash !== recorded.sourceHash) throw new Error('the recording was made with another build');
  const module = { exports: {} };
  process.dlopen(module, join(located.dir, located.manifest.node.file));
  const addon = module.exports;
  addon.init({ threads: 1, heap });
  if (addon.info().heap !== heap) throw new Error(`addon reports heap mode ${addon.info().heap}`);
  const requests = recorded.calls.map(c => ({ ...c, words: Uint32Array.from(c.request) }));
  let mismatches = 0;
  const run = c => {
    const t = performance.now();
    const reply = addon.call(c.op, c.words);
    const ms = performance.now() - t;
    if (reply.length !== c.replyWords || sha256(hex(reply)) !== c.replySha256) mismatches += 1;
    return ms;
  };
  const passMs = [], perOp = {};
  for (let p = 0; p < passes; p += 1) {
    let total = 0;
    for (const c of requests) {
      const ms = run(c);
      total += ms;
      (perOp[c.label] ??= Array.from({ length: passes }, () => 0))[p] += ms;
    }
    passMs.push(total);
  }
  const heaviest = label => requests.filter(c => c.label === label).sort((a, b) => b.replyWords - a.replyWords)[0];
  const series = {};
  for (const label of ['identity.boolean_result', 'planarBoolean.subtract', 'planarBoolean.union']) {
    const c = heaviest(label);
    if (!c) continue;
    const ms = Array.from({ length: repeat }, () => run(c));
    const k = Math.max(1, Math.floor(repeat / 4));
    series[label] = { requestWords: c.words.length, replyWords: c.replyWords, repeat, firstQuarterMedianMs: round(median(ms.slice(0, k))),
      lastQuarterMedianMs: round(median(ms.slice(-k))), growth: round(median(ms.slice(-k)) / median(ms.slice(0, k))), ms: ms.map(round) };
  }
  const stats = addon.stats();
  return { heap, calls: recorded.calls.length, passes, passMs: passMs.map(round), lastOverFirstPass: round(passMs.at(-1) / passMs[0]),
    perOpFirstLastPassMs: Object.fromEntries(Object.entries(perOp).filter(([, v]) => v[0] >= 1).map(([l, v]) => [l, [round(v[0]), round(v.at(-1))]])),
    series, mismatches, stats: { heapClears: stats.heapClears, lastCallStartPage: stats.lastCallStartPage, lastCallPages: stats.lastCallPages, maxRssMiB: round(stats.maxRssBytes / 1048576) } };
}

const child = (argv, env = {}) => {
  const before = uptime();
  const t = performance.now();
  const run = spawnSync(process.execPath, [self, ...argv], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, BEND_NO_TELEMETRY: '1', ...env } });
  const wallMs = performance.now() - t;
  if (run.status !== 0) throw new Error(`slice-churn ${argv[0]} failed (exit ${run.status}): ${run.stderr.trim().split('\n').slice(-6).join(' | ')}`);
  return { ...JSON.parse(run.stdout.trim().split('\n').pop()), wallMs: round(wallMs), load: { before, after: uptime() } };
};

if (args[0] === '--record-child') {
  console.log(JSON.stringify(await record(args[1])));
} else if (args[0] === '--replay-child') {
  console.log(JSON.stringify(await replay(args[1], args[2], Number(args[3]), Number(args[4]))));
} else {
  const passes = Number(option('--passes', '8')), repeat = Number(option('--repeat', '40'));
  mkdirSync(work, { recursive: true });
  const file = join(work, 'requests.json');
  const recorded = child(['--record-child', file], { WONKY_BACKEND: 'native' });
  process.stderr.write(`recorded ${recorded.calls} calls\n`);
  const modes = {};
  for (const heap of ['clear', 'keep']) {
    process.stderr.write(`replay heap=${heap}\n`);
    modes[heap] = child(['--replay-child', file, heap, String(passes), String(repeat)]);
  }
  const report = {
    schema: 'wonky-native-slice-churn/1', generator: 'scripts/native-bridge/slice-churn.mjs', measuredAt: new Date().toISOString(),
    note: 'Fresh child per heap mode, 1 thread. heap=clear is production (every call starts on an empty heap); heap=keep is the behaviour before the fix. Shared machine: timings under load are indicative.',
    recorded: { sources: RECORDED, calls: recorded.calls, load: recorded.load }, passes, repeat, modes,
    allRepliesExact: Object.values(modes).every(m => m.mismatches === 0),
  };
  mkdirSync(join(root, 'out/native-bridge/slice'), { recursive: true });
  writeFileSync(outFile, JSON.stringify(report, null, 1) + '\n');
  for (const [heap, m] of Object.entries(modes)) {
    process.stderr.write(`${heap}: passes ${m.passMs.join(' / ')} ms (last/first ${m.lastOverFirstPass}); ` +
      `${Object.entries(m.series).map(([l, s]) => `${l} ${s.firstQuarterMedianMs} -> ${s.lastQuarterMedianMs} ms`).join(', ')}; mismatches ${m.mismatches}\n`);
  }
  if (!report.allRepliesExact) process.exitCode = 1;
}
