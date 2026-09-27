#!/usr/bin/env node
// Measures the decoder count guard of fix round 2 (gen-wire.mjs header): the
// build before the guard against the current build, same wire format, same op
// table, every child a fresh process, the two builds alternating per round.
//
//   record   one child with WONKY_BACKEND=native builds fs-cut-h1 and fs-fuse-g1
//            in-process through the unchanged src/index.mjs build() and records
//            every native request (op, words) and the sha256 of every reply
//   replay   per build and round one child dlopens the build directory directly
//            (the loader opens only the current build) and
//              - replays the recorded calls P times; every reply must equal the
//                recorded one on both builds (the guard changes no valid reply)
//              - runs every wire-probe.mjs count probe claiming 1 and 2^16
//                elements: status, heap pages, ms
//   uptime before and after every child; timings under load are indicative.
//
//   node scripts/native-bridge/count-guard-bench.mjs --before <sourceHash> [--rounds 3] [--passes 2]
// writes out/native-bridge/slice/count-guard.json
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { root, uptime } from './slice-lib.mjs';
import { countProbes } from './wire-probe.mjs';

const self = fileURLToPath(import.meta.url);
const cache = join(root, 'tmp/native-bridge/cache');
const work = join(root, 'tmp/native-bridge/slice/count-guard');
const outFile = join(root, 'out/native-bridge/slice/count-guard.json');
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const round = x => Math.round(x * 1000) / 1000;
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
  writeFileSync(file, JSON.stringify({ sourceHash: backend.manifest.sourceHash, ops: backend.manifest.ops.map(op => op.spec), sources: RECORDED, calls }));
  return { calls: calls.length };
}

async function replay(file, dir, passes) {
  const { sha256 } = await import(pathToFileURL(join(root, 'src/native/build-key.mjs')).href);
  const recorded = JSON.parse(readFileSync(file, 'utf8'));
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const module = { exports: {} };
  const t0 = performance.now();
  process.dlopen(module, join(dir, manifest.node.file));
  const addon = module.exports;
  addon.init({ threads: 1 });
  const dlopenMs = performance.now() - t0;
  const info = addon.info();
  if (JSON.stringify(info.ops) !== JSON.stringify(recorded.ops)) throw new Error(`${dir}: op table differs from the recording`);
  if (info.heap !== 'clear') throw new Error(`${dir}: heap mode ${info.heap}`);
  const requests = recorded.calls.map(c => ({ ...c, words: Uint32Array.from(c.request) }));
  let mismatches = 0;
  const perOp = {};
  for (let p = 0; p < passes; p += 1) {
    for (const c of requests) {
      const t = performance.now();
      const reply = addon.call(c.op, c.words);
      const ms = performance.now() - t;
      if (reply.length !== c.replyWords || sha256(hex(reply)) !== c.replySha256) mismatches += 1;
      (perOp[c.label] ??= []).push(ms);
    }
  }
  // the probes come from the current build's wire.json (the wire format is the same)
  const wire = JSON.parse(readFileSync(join(root, 'tmp/native-bridge/cache', recorded.sourceHash, 'wire.json'), 'utf8'));
  const probes = countProbes(wire).map(p => {
    const [one, many] = [1, 2 ** 16].map(claim => {
      const t = performance.now();
      const reply = addon.call(p.op, Uint32Array.from([...p.prefix, claim]));
      return { status: reply[0], ms: performance.now() - t, pages: addon.stats().lastCallPages };
    });
    return { name: p.name, path: p.path, type: p.type, w: p.w, one, many };
  });
  return {
    sourceHash: manifest.sourceHash, dlopenMs: round(dlopenMs), calls: requests.length * passes, mismatches,
    perOp: Object.fromEntries(Object.entries(perOp).map(([label, xs]) => [label, { calls: xs.length, medianMs: round(median(xs)), totalMs: round(xs.reduce((a, b) => a + b, 0)) }])),
    probes: {
      count: probes.length,
      statuses: [...new Set(probes.flatMap(p => [p.one.status, p.many.status]))],
      pagesDependOnClaim: probes.filter(p => p.one.pages !== p.many.pages).length,
      maxPagesClaim1: Math.max(...probes.map(p => p.one.pages)), maxPagesClaim65536: Math.max(...probes.map(p => p.many.pages)),
      totalMsClaim1: round(probes.reduce((a, p) => a + p.one.ms, 0)), totalMsClaim65536: round(probes.reduce((a, p) => a + p.many.ms, 0)),
      byType: Object.values(probes.reduce((acc, p) => {
        const row = acc[p.type] ??= { type: p.type, w: p.w, probes: 0, maxPagesClaim1: 0, maxPagesClaim65536: 0, maxMsClaim65536: 0 };
        row.probes += 1;
        row.maxPagesClaim1 = Math.max(row.maxPagesClaim1, p.one.pages);
        row.maxPagesClaim65536 = Math.max(row.maxPagesClaim65536, p.many.pages);
        row.maxMsClaim65536 = round(Math.max(row.maxMsClaim65536, p.many.ms));
        return acc;
      }, {})),
    },
    maxRssMiB: Math.round(addon.stats().maxRssBytes / 1048576),
  };
}

function child(mode, extra) {
  const before = uptime();
  const run = spawnSync(process.execPath, [self, `--${mode}`, ...extra], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, BEND_NO_TELEMETRY: '1', WONKY_BACKEND: 'native' } });
  const after = uptime();
  if (run.status !== 0) throw new Error(`${mode} child failed (${run.status ?? run.signal}): ${run.stderr.trim().split('\n').slice(-5).join(' | ')}`);
  return { result: JSON.parse(run.stdout.trim().split('\n').pop()), load: { before, after } };
}

if (args[0] === '--record') console.log(JSON.stringify(await record(args[1])));
else if (args[0] === '--replay') console.log(JSON.stringify(await replay(args[1], args[2], Number(args[3]))));
else {
  const beforeHash = option('--before') ?? (() => { throw new Error('usage: count-guard-bench.mjs --before <sourceHash of the build before the guard> [--rounds 3] [--passes 2]'); })();
  const rounds = Number(option('--rounds', 3)), passes = Number(option('--passes', 2));
  const current = JSON.parse(readFileSync(join(cache, 'planar.json'), 'utf8')).sourceHash;
  const builds = { before: join(cache, beforeHash), after: join(cache, current) };
  for (const [name, dir] of Object.entries(builds)) if (!existsSync(join(dir, 'manifest.json'))) throw new Error(`build '${name}' ${dir} is not in the cache`);
  mkdirSync(work, { recursive: true });
  const recording = join(work, 'recorded.json');
  const startedAt = new Date().toISOString();
  const rec = child('record', [recording]);
  const runs = [];
  for (let r = 0; r < rounds; r += 1) {
    for (const name of r % 2 ? ['after', 'before'] : ['before', 'after']) {
      const { result, load } = child('replay', [recording, builds[name], String(passes)]);
      runs.push({ round: r + 1, build: name, ...result, load });
      console.error(`count-guard-bench: round ${r + 1} ${name}: ${result.calls} calls, ${result.mismatches} mismatches, probes pages depend on claim ${result.probes.pagesDependOnClaim}, load ${load.before.one}`);
    }
  }
  const labels = Object.keys(runs[0].perOp);
  const perOp = labels.map(label => {
    const of = name => runs.filter(r => r.build === name).map(r => r.perOp[label].medianMs);
    const b = median(of('before')), a = median(of('after'));
    return { label, calls: runs[0].perOp[label].calls / passes, beforeMedianMs: round(b), afterMedianMs: round(a), ratio: round(a / b) };
  });
  const result = {
    schema: 'wonky-native-count-guard/1', generator: 'scripts/native-bridge/count-guard-bench.mjs', startedAt, finishedAt: new Date().toISOString(),
    builds: { before: beforeHash, after: current }, rounds, passes, recorded: { sources: RECORDED, calls: rec.result.calls, load: rec.load },
    mismatches: runs.reduce((a, r) => a + r.mismatches, 0), perOp, runs,
  };
  mkdirSync(join(root, 'out/native-bridge/slice'), { recursive: true });
  writeFileSync(outFile, JSON.stringify(result, null, 1) + '\n');
  console.log(JSON.stringify({ out: outFile, mismatches: result.mismatches, perOp: perOp.map(p => `${p.label} ${p.beforeMedianMs}->${p.afterMedianMs} (${p.ratio}x)`) }));
  if (result.mismatches) process.exitCode = 1;
}
