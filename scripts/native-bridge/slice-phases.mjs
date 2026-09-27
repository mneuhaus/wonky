// Timing preload for slice-bench.mjs: records when loadKernel() first resolves
// (kernel ready), when build()/buildPython() returns (model built, export
// begins) and when the process exits, as performance.now() offsets from the
// process time origin. It wraps the three exported functions by rewriting the
// module text in memory at load time (module.registerHooks); nothing on disk
// changes and nothing else is touched. Each rewrite must match exactly once.
//
//   WONKY_SLICE_PHASES=<file.json> node --import ./scripts/native-bridge/slice-phases.mjs bin/wonky.mjs ...
import { registerHooks } from 'node:module';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const out = process.env.WONKY_SLICE_PHASES;
if (!out) throw new Error('slice-phases: WONKY_SLICE_PHASES must name the output file');
const phases = {};
globalThis.__wonkySlicePhase = name => { phases[name] ??= performance.now(); };

const rewrites = [
  { file: '/src/kernel.mjs', find: 'export function loadKernel() {', replace: `export function loadKernel() {
  const pending = __sliceLoadKernel();
  pending.then(() => globalThis.__wonkySlicePhase('kernelReady'), () => globalThis.__wonkySlicePhase('kernelFailed'));
  return pending;
}
function __sliceLoadKernel() {` },
  { file: '/src/index.mjs', find: 'export async function build(', replace: `export async function build(...args) {
  const model = await __sliceBuild(...args);
  globalThis.__wonkySlicePhase('buildEnd');
  return model;
}
async function __sliceBuild(` },
  { file: '/src/python.mjs', find: 'export async function buildPython(', replace: `export async function buildPython(...args) {
  const model = await __sliceBuildPython(...args);
  globalThis.__wonkySlicePhase('buildEnd');
  return model;
}
async function __sliceBuildPython(` },
];

registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    const rewrite = url.startsWith('file:') && rewrites.find(r => url.endsWith(r.file));
    if (!rewrite) return result;
    const text = typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString('utf8');
    const at = text.indexOf(rewrite.find);
    if (at < 0 || text.indexOf(rewrite.find, at + 1) >= 0) throw new Error(`slice-phases: '${rewrite.find}' must occur exactly once in ${url}`);
    return { ...result, source: text.slice(0, at) + rewrite.replace + text.slice(at + rewrite.find.length), shortCircuit: true };
  },
});

process.on('exit', code => {
  phases.exit = performance.now();
  writeFileSync(out, JSON.stringify({ schema: 'wonky-slice-phases/1', exitCode: code, timeOrigin: performance.timeOrigin, phases }, null, 1) + '\n');
});
