// Reproducible build of the out-of-process baseline service.
//   node scripts/native-bridge/build-baseline.mjs
// Produces out/native-bridge/baseline/service (ARM64, native Bend CPU target),
// out/native-bridge/baseline/reference.cjs (JS target of the independent
// op-5 reference driver) and out/native-bridge/baseline/frame-echo (plain C
// transport floor, clang -O2). Compiles strictly one after another; records source
// hash, compile wall time and load averages in build.json. Nothing here is
// hand-edited afterwards.
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadavg } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const outDir = join(root, 'out/native-bridge/baseline');
export const serviceBinary = join(outDir, 'service');
export const referenceScript = join(outDir, 'reference.cjs');
export const frameEchoBinary = join(outDir, 'frame-echo');
const frameEchoSource = 'kernel/service/baseline/frame-echo.c';
const { version } = JSON.parse(readFileSync(join(root, 'bend.lock.json'), 'utf8'));
const bend = join(root, `.tools/bend-${version}/bin/bend`);

export const entries = ['kernel/service/baseline/service.bend', 'kernel/service/baseline/reference.bend'];

// Exactly the files the two programs import (transitively), read the way Bend
// reads them: leading `import` lines until the first other code line. Base
// and the effect runtime belong to the pinned compiler (bend.lock.json).
export function importClosure(files = entries) {
  const seen = new Set();
  const visit = file => {
    const path = resolve(root, file);
    if (seen.has(path)) return;
    seen.add(path);
    for (const raw of readFileSync(path, 'utf8').split('\n')) {
      const line = raw.trim();
      if (line === '' || line.startsWith('#')) continue;
      const imported = /^import\s+(\S+)(?:\s+as\s+[A-Za-z_]\w*)?\s*(?:#.*)?$/.exec(line);
      if (!imported) break;
      if (imported[1] === 'Base') continue;
      if (!imported[1].endsWith('.bend')) throw new Error(`unexpected Bend import in ${file}: ${line}`);
      visit(relative(root, resolve(dirname(path), imported[1])));
    }
  };
  files.forEach(visit);
  return [...seen].map(path => relative(root, path)).sort();
}

export function sourceSha256() {
  const digest = createHash('sha256');
  for (const file of [...importClosure(), frameEchoSource, 'bend.lock.json']) digest.update(file).update(readFileSync(join(root, file)));
  return digest.digest('hex');
}

function run(executable, args, env = { ...process.env, BEND_NO_TELEMETRY: '1' }) {
  const started = performance.now(), load = loadavg();
  return new Promise(resolve => {
    const child = spawn(executable, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });
    child.on('error', error => { output += error.message; });
    child.on('close', (code, signal) => resolve({
      args, code, signal, wallMs: performance.now() - started, loadBefore: load, loadAfter: loadavg(),
      output: output.slice(-4000),
    }));
  });
}

export async function build() {
  mkdirSync(outDir, { recursive: true });
  const record = { schema: 'wonky.native-bridge-baseline-build/1', builtAt: new Date().toISOString(), bend: version, sourceSha256: sourceSha256(), sourceFiles: importClosure().length, steps: {} };
  const scratch = join(root, 'tmp/native-bridge/baseline');
  mkdirSync(scratch, { recursive: true });
  const steps = [
    ['service', bend, [entries[0], '-o', serviceBinary]],
    ['reference', bend, [entries[1], '-o', join(scratch, 'reference.js')]],
    ['frameEcho', 'clang', ['-O2', '-std=c11', '-Wall', '-Werror', frameEchoSource, '-o', frameEchoBinary]],
  ];
  for (const [name, executable, args] of steps) {
    const result = await run(executable, args);
    record.steps[name] = result;
    if (result.code !== 0) {
      writeFileSync(join(outDir, 'build.json'), JSON.stringify(record, null, 2) + '\n');
      throw new Error(`bend ${name} build failed (code ${result.code}):\n${result.output}`);
    }
  }
  // The JS target is CommonJS; the repository is "type": "module".
  copyFileSync(join(scratch, 'reference.js'), referenceScript);
  rmSync(join(scratch, 'reference.js'));
  writeFileSync(join(outDir, 'build.json'), JSON.stringify(record, null, 2) + '\n');
  return record;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const record = await build();
  for (const [name, step] of Object.entries(record.steps)) {
    console.log(`${name}: ${step.wallMs.toFixed(0)} ms wall, load ${step.loadBefore.map(v => v.toFixed(1)).join(' ')}`);
  }
  console.log(`source ${record.sourceSha256}`);
}
