#!/usr/bin/env node
// Measures what a live viewer rebuild costs today, phase by phase, on the
// JavaScript Bend target. Each case runs in a fresh child process so the cold
// numbers include module loading and Bend kernel start-up, then repeats the
// build in the same process to show what a warm, persistent build worker saves.
//
// Usage: node scripts/viewer/measure-pipeline.mjs [--out out/viewer/audit/code/pipeline-latency.json]
//        [--repeats 3] [--python <executable>] [--only <substring>] [--with-r10b]
//
// Python cases never call python3 directly: the default interpreter is a
// wrapper that runs `uv run --no-project python`.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const self = fileURLToPath(import.meta.url);
const now = () => performance.now();
const round = value => Math.round(value * 10) / 10;
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

const cases = [
  { file: 'examples/box.fs' },
  { file: 'examples/bracket.fs' },
  { file: 'examples/line-sketch.fs' },
  { file: 'examples/tilted-plate.fs' },
  { file: 'examples/compare-before.fs' },
  { file: 'examples/bored-spacer.fs' },
  { file: 'examples/conical-spacer.fs' },
  { file: 'examples/convex-intersection.fs' },
  { file: 'examples/concave-intersection.fs' },
  { file: 'examples/python-box.py' },
  { file: 'examples/python-spacer.py' },
  { file: 'examples/convex-intersection.py' },
];
const r10b = { file: 'fixtures/r10b/r10b.fs', feature: 'singleStepR10b', expectFailure: true };

async function uvPython() {
  const wrapper = join(root, 'tmp/viewer/uv-python');
  if (!existsSync(wrapper)) {
    await mkdir(dirname(wrapper), { recursive: true });
    await writeFile(wrapper, '#!/bin/sh\nexec uv run --no-project --quiet python "$@"\n');
    await chmod(wrapper, 0o755);
  }
  return wrapper;
}

function run(command, args, { timeoutMs = 600000 } = {}) {
  return new Promise(resolvePromise => {
    const start = now();
    const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolvePromise({ code, signal, wallMs: round(now() - start), stdout, stderr });
    });
  });
}

async function child(file, { feature, repeats, python }) {
  const timings = {};
  const phase = async (name, action) => {
    const start = now();
    // Recorded on failure too: time-to-error is what a live loop waits for.
    try { return await action(); } finally { timings[name] = round(now() - start); }
  };
  const source = await readFile(resolve(root, file), 'utf8');
  const isPython = file.endsWith('.py');
  const modules = await phase('importModulesMs', async () => ({
    index: await import('../../src/index.mjs'),
    python: await import('../../src/python.mjs'),
    kernel: await import('../../src/kernel.mjs'),
    scene: await import('../../src/review-scene.mjs'),
    summary: await import('../../src/geometry-summary.mjs'),
  }));
  await phase('loadKernelMs', () => modules.kernel.loadKernel());
  const sourcePath = resolve(root, file);
  const siblingManifest = join(dirname(sourcePath), 'modules.json');
  const buildOnce = () => isPython
    ? modules.python.buildPython(source, { filename: sourcePath, python })
    : modules.index.build(source, { feature, sourcePath,
      ...(existsSync(siblingManifest) ? { moduleManifest: siblingManifest } : {}) });
  let model;
  try {
    model = await phase('buildColdMs', buildOnce);
  } catch (error) {
    return { file, timings, failure: { name: error.name, message: error.message, line: error.line ?? null, column: error.column ?? null,
      operations: error.modelTrace?.operations?.length ?? null,
      failedOperation: error.modelTrace?.operations?.find(operation => operation.status === 'failed')
        ? (({ sequence, name, operationId, source: s }) => ({ sequence, name, operationId, span: s?.span ?? null }))(error.modelTrace.operations.find(operation => operation.status === 'failed'))
        : null } };
  }
  const warm = [];
  for (let index = 0; index < repeats; index++) {
    const start = now();
    await buildOnce();
    warm.push(now() - start);
  }
  timings.buildWarmMedianMs = warm.length ? round(median(warm)) : null;
  const bytes = await phase('serializeMs', () => Buffer.from(JSON.stringify(model, null, 2) + '\n'));
  const modelId = await phase('hashMs', () => createHash('sha256').update(bytes).digest('hex'));
  const parsed = await phase('parseMs', () => JSON.parse(bytes));
  await phase('inspectorMs', () => modules.summary.createGeometryInspector(parsed, { modelBytes: bytes, modelId }));
  const scene = await phase('sceneColdMs', () => modules.scene.reviewScene(parsed, { id: modelId, sha256: modelId }));
  await phase('sceneWarmMs', () => modules.scene.reviewScene(JSON.parse(bytes), { id: modelId, sha256: modelId }));
  const compact = await phase('sceneCompactJsonMs', () => JSON.stringify(scene));
  const pretty = JSON.stringify(scene, null, 2);
  const faces = scene.bodies.reduce((sum, body) => sum + body.faces.length, 0);
  return { file, timings,
    sizes: { brepJsonBytes: bytes.length, sceneJsonCompactBytes: Buffer.byteLength(compact), sceneJsonServedBytes: Buffer.byteLength(pretty) + 1 },
    counts: { bodies: scene.bodies.length, faces, edges: scene.bodies.reduce((sum, body) => sum + body.edges.length, 0),
      triangles: scene.bodies.reduce((sum, body) => sum + body.faces.reduce((n, face) => n + face.triangles.length, 0), 0),
      boundaryOnlyFaces: scene.bodies.reduce((sum, body) => sum + body.faces.filter(face => face.displayWarning).length, 0) } };
}

async function parent(options) {
  const python = options.python ?? await uvPython();
  const selected = [...cases, ...(options.withR10b ? [r10b] : [])].filter(entry => !options.only || entry.file.includes(options.only));
  const nodeStartup = [];
  for (let index = 0; index < 3; index++) nodeStartup.push((await run(process.execPath, ['-e', '0'])).wallMs);
  const results = [];
  for (const entry of selected) {
    const isPython = entry.file.endsWith('.py');
    const cli = isPython
      ? await run(process.execPath, ['bin/wonky-python.mjs', entry.file, '--check', '--python', python])
      : await run(process.execPath, ['bin/wonky.mjs', entry.file, '--check', ...(entry.feature ? ['--feature', entry.feature] : [])]);
    const measured = await run(process.execPath, [self, '--child', entry.file, '--repeats', String(entry.expectFailure ? 0 : options.repeats),
      '--python', python, ...(entry.feature ? ['--feature', entry.feature] : [])]);
    let detail;
    try { detail = JSON.parse(measured.stdout); } catch { detail = { error: measured.stderr.trim().split('\n').slice(-3).join(' ') }; }
    const result = { file: entry.file, cli: { wallMs: cli.wallMs, exitCode: cli.code, lastError: cli.code ? cli.stderr.trim().split('\n').at(-1)?.slice(0, 300) : null },
      childWallMs: measured.wallMs, ...detail };
    results.push(result);
    const t = result.timings ?? {};
    console.error(`${entry.file}: cli ${cli.wallMs} ms (exit ${cli.code}) · kernel ${t.loadKernelMs} · cold ${t.buildColdMs} · warm ${t.buildWarmMedianMs} · scene ${t.sceneColdMs}/${t.sceneWarmMs}${result.failure ? ' · FAILED ' + result.failure.message.slice(0, 80) : ''}`);
  }
  const report = { schema: 'wonky.viewer-pipeline-latency/1', measuredAt: new Date().toISOString(),
    environment: { node: process.version, platform: `${process.platform}-${process.arch}`, cpus: (await import('node:os')).cpus().length,
      loadAverage: (await import('node:os')).loadavg().map(round), note: 'Shared, loaded machine; JavaScript Bend target only. Not a native/GPU estimate.' },
    nodeStartupMedianMs: median(nodeStartup), repeats: options.repeats, pythonInterpreter: 'uv run --no-project python (wrapper)',
    phases: {
      cli: 'Fresh `node bin/wonky.mjs <file> --check` (or wonky-python) wall time: process start, module load, Bend load, build, validation; no files written.',
      importModulesMs: 'Import of src/index.mjs, python.mjs, kernel.mjs, review-scene.mjs, geometry-summary.mjs in a fresh process.',
      loadKernelMs: 'loadKernel(): Bend modules from the JS cache.',
      buildColdMs: 'First build() / buildPython() in the process.',
      buildWarmMedianMs: 'Median of repeated builds in the same process (warm kernel, warm JIT).',
      serializeMs: 'JSON.stringify(model, null, 2) as bin/wonky.mjs writes it.',
      inspectorMs: 'createGeometryInspector() as review-server register() runs it.',
      sceneColdMs: 'First reviewScene() (loads kernel/display.bend and cylinder display on demand).',
      sceneWarmMs: 'Second reviewScene() on the same bytes.',
    },
    results };
  const out = resolve(root, options.out);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(report, null, 2) + '\n');
  console.error(out);
}

const args = process.argv.slice(2), options = { repeats: 3, out: 'out/viewer/audit/code/pipeline-latency.json' };
for (let index = 0; index < args.length; index++) {
  const arg = args[index];
  if (arg === '--child') options.child = args[++index];
  else if (arg === '--repeats') options.repeats = Number(args[++index]);
  else if (arg === '--python') options.python = args[++index];
  else if (arg === '--feature') options.feature = args[++index];
  else if (arg === '--out') options.out = args[++index];
  else if (arg === '--only') options.only = args[++index];
  else if (arg === '--with-r10b') options.withR10b = true;
  else throw new Error(`Unknown option ${arg}`);
}
if (options.child) {
  const result = await child(options.child, options);
  process.stdout.write(JSON.stringify(result));
} else await parent(options);
