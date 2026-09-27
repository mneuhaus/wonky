#!/usr/bin/env node
// Measures the fixed startup phases of a wonky CLI run in fresh processes,
// with a warm Bend JS cache and without editing src/:
//   processToScript   time from process start (performance.timeOrigin) to this script
//   frontendGraph     import of src/index.mjs (FS) or src/python.mjs (Python)
//   bendImports       registerBendImports(): imports the Bend compiler main.ts (TypeScript strip)
//   per kernel module compileBend() (fingerprint + cache read + checks) and import() of the data: URL
//   loadKernelTotal   the sum, in the order src/kernel.mjs loadKernel() uses
//   pythonSpawn       spawn + exit of the reference Python with the runner flags (-I -S -B -u -c pass)
//
//   node scripts/native-bridge/startup-phases.mjs [--repeat 5]
// Writes out/native-bridge/profile/startup-phases.json with uptime load averages.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const root = fileURLToPath(new URL('../../', import.meta.url));
const outPath = join(root, 'out/native-bridge/profile/startup-phases.json');
const python = join(root, 'out/build123d-performance/reference-venv/bin/python');

function uptime() {
  const text = spawnSync('uptime', { encoding: 'utf8' }).stdout.trim();
  const match = /load averages?:\s*([\d.]+),?\s+([\d.]+),?\s+([\d.]+)/.exec(text);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : text;
}

async function child() {
  const processToScript = performance.now();
  const t0 = performance.now();
  await import(pathToFileURL(join(root, 'src/index.mjs')).href);
  const frontendGraph = performance.now() - t0;
  const t1 = performance.now();
  await import(pathToFileURL(join(root, 'src/python.mjs')).href);
  const pythonGraphIncremental = performance.now() - t1;
  const loader = await import(pathToFileURL(join(root, 'src/bend-loader.mjs')).href);
  const t2 = performance.now();
  await loader.registerBendImports();
  const bendImports = performance.now() - t2;
  // Same module list and order as src/kernel.mjs loadKernel().
  const kernelSource = readFileSync(join(root, 'src/kernel.mjs'), 'utf8');
  const entries = [...kernelSource.matchAll(/loadBend\(new URL\('(\.\.\/kernel\/[^']+)'/g)].map(m => m[1].slice(3));
  const modules = [];
  for (const entry of entries) {
    const a = performance.now();
    const compiled = await loader.compileBend(join(root, entry));
    const b = performance.now();
    await import(`data:text/javascript;base64,${Buffer.from(compiled.source).toString('base64')}#${compiled.key}`);
    const c = performance.now();
    modules.push({ entry, cacheHit: compiled.cacheHit, sourceKiB: +(compiled.source.length / 1024).toFixed(0),
      compileBendMs: +(b - a).toFixed(2), importMs: +(c - b).toFixed(2) });
  }
  if (modules.some(m => !m.cacheHit)) throw new Error('Bend cache miss: warm the cache first (run a workload once)');
  const loadKernelTotal = bendImports + modules.reduce((s, m) => s + m.compileBendMs + m.importMs, 0);
  process.stdout.write(JSON.stringify({ processToScript, frontendGraph, pythonGraphIncremental, bendImports, loadKernelTotal,
    fingerprintAndReadMs: modules.reduce((s, m) => s + m.compileBendMs, 0), importMs: modules.reduce((s, m) => s + m.importMs, 0),
    modules }));
}

function main() {
  const args = process.argv.slice(2);
  const repeatAt = args.indexOf('--repeat');
  const repeat = repeatAt >= 0 ? Number(args[repeatAt + 1]) : 5;
  const runs = [];
  for (let i = 0; i < repeat; i++) {
    const loadBefore = uptime();
    const started = performance.now();
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--child'], { cwd: root, encoding: 'utf8',
      env: { ...process.env, BEND_NO_TELEMETRY: '1' }, maxBuffer: 64 * 1024 * 1024 });
    const wallMs = performance.now() - started;
    if (result.status !== 0) throw new Error(`child failed: ${result.stderr}`);
    const s = performance.now();
    const py = spawnSync(python, ['-I', '-S', '-B', '-u', '-c', 'pass']);
    const pythonSpawnMs = performance.now() - s;
    if (py.status !== 0) throw new Error('reference python failed');
    runs.push({ wallMs: +wallMs.toFixed(1), pythonSpawnMs: +pythonSpawnMs.toFixed(1), loadBefore, loadAfter: uptime(), ...JSON.parse(result.stdout) });
    console.log(`run ${i + 1}: wall ${wallMs.toFixed(0)} ms loadKernel ${runs.at(-1).loadKernelTotal.toFixed(0)} ms ` +
      `(bendImports ${runs.at(-1).bendImports.toFixed(0)}, fingerprint+read ${runs.at(-1).fingerprintAndReadMs.toFixed(0)}, ` +
      `import ${runs.at(-1).importMs.toFixed(0)}) frontend graph ${runs.at(-1).frontendGraph.toFixed(0)} ms python spawn ${pythonSpawnMs.toFixed(0)} ms load ${loadBefore[0]}`);
  }
  const median = key => { const v = runs.map(r => r[key]).sort((a, b) => a - b); return +v[v.length >> 1].toFixed(1); };
  const perModule = runs[0].modules.map((m, i) => ({ entry: m.entry, sourceKiB: m.sourceKiB,
    compileBendMsMedian: +runs.map(r => r.modules[i].compileBendMs).sort((a, b) => a - b)[runs.length >> 1].toFixed(2),
    importMsMedian: +runs.map(r => r.modules[i].importMs).sort((a, b) => a - b)[runs.length >> 1].toFixed(2) }));
  mkdirSync(join(root, 'out/native-bridge/profile'), { recursive: true });
  writeFileSync(outPath, JSON.stringify({ schema: 'wonky-native-bridge-startup-phases/1', node: process.version, at: new Date().toISOString(),
    median: Object.fromEntries(['wallMs', 'processToScript', 'frontendGraph', 'pythonGraphIncremental', 'bendImports', 'fingerprintAndReadMs',
      'importMs', 'loadKernelTotal', 'pythonSpawnMs'].map(k => [k, median(k)])), perModule,
    runs: runs.map(({ modules, ...rest }) => rest) }, null, 1) + '\n');
}

if (process.argv.includes('--child')) await child();
else main();
