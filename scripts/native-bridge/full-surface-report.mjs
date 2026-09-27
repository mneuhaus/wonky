#!/usr/bin/env node
// Extra measurement for docs/native-bridge.md step 1: the full emittable compat
// surface (84 production entries, everything but curved-intersection) built once
// with `build-native.mjs --set full`. Reads that build's manifest (bend and clang
// seconds, C and .node bytes, first load = the build's smoke-test child, the first
// process that ever loaded the binary), adds three more warm dlopen+init
// measurements in fresh processes, and writes out/native-bridge/slice/full-surface-build.json.
// The full build is not wired into production (the loader opens set 'planar').
//
//   node scripts/native-bridge/build-native.mjs --set full   (one compile, minutes)
//   node scripts/native-bridge/full-surface-report.mjs
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './slice-ops.mjs';
import { uptime } from './slice-lib.mjs';

const cache = join(root, 'tmp/native-bridge/cache');
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const full = readJson(join(cache, readJson(join(cache, 'full.json')).sourceHash, 'manifest.json'));
const planar = readJson(join(cache, readJson(join(cache, 'planar.json')).sourceHash, 'manifest.json'));
const dir = join(cache, full.sourceHash);
const warm = [];
for (let i = 0; i < 3; i += 1) {
  const run = spawnSync(process.execPath, [join(root, 'scripts/native-bridge/build-native.mjs'), '--load-only', dir], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`warm load failed: ${run.stderr}`);
  warm.push(JSON.parse(run.stdout.trim().split('\n').pop()));
}
const pick = m => ({ ops: m.ops.length, sourceHash: m.sourceHash, bendSeconds: m.seconds.bend, clangSeconds: m.seconds.clang,
  cBytes: m.emitted.cBytes, nodeBytes: m.node.bytes, firstLoadDlopenMs: m.firstLoad.dlopenMs, firstLoadInitMs: m.firstLoad.initMs,
  warmDlopenMs: m.warmLoad.dlopenMs, buildLoad: m.load, smokeOk: m.smoke.ok, smokeReplaysExact: m.smoke.replays.every(r => r.exact),
  smokeReplayMs: m.smoke.replays.map(r => Math.round(r.ms * 10) / 10) });
const report = {
  schema: 'wonky-native-full-surface-build/1', generator: 'scripts/native-bridge/full-surface-report.mjs', measuredAt: new Date().toISOString(),
  wiredIntoProduction: false,
  note: 'One build of the full emittable compat surface (84 entries). Shared machine: the load averages are recorded with the build and each load; times under load are indicative.',
  full: pick(full),
  fullWarmLoads: warm.map(w => ({ dlopenMs: w.dlopenMs, initMs: w.initMs, load: w.load.text })),
  planarForComparison: pick(planar),
  ratios: { clangSeconds: full.seconds.clang / planar.seconds.clang, cBytes: full.emitted.cBytes / planar.emitted.cBytes, nodeBytes: full.node.bytes / planar.node.bytes },
  loadAtReport: uptime(),
};
mkdirSync(join(root, 'out/native-bridge/slice'), { recursive: true });
writeFileSync(join(root, 'out/native-bridge/slice/full-surface-build.json'), JSON.stringify(report, null, 1) + '\n');
console.log(JSON.stringify({ full: report.full, warm: report.fullWarmLoads.map(w => w.dlopenMs), ratios: report.ratios }));
