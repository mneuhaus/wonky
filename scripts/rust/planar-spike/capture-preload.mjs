// Preload (node --import) for the Rust spike harness (adopted from the spike, K0): records every production
// planarBoolean.union/subtract call of an unchanged CLI run on the Bend JS
// kernel, with its arguments and its JS-kernel result, and writes them at exit.
//   RUST_SPIKE_CAPTURE=<file.json> node --import ./scripts/rust/planar-spike/capture-preload.mjs bin/wonky.mjs ...
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { loadKernel } from '../../../src/kernel.mjs';

const out = process.env.RUST_SPIKE_CAPTURE;
if (!out) throw new Error('RUST_SPIKE_CAPTURE must name the output file');
if ((process.env.WONKY_BACKEND ?? 'js') !== 'js') throw new Error('capture runs on the JS kernel only');
const kernel = await loadKernel();
const calls = [];
for (const operation of ['union', 'subtract']) {
  const original = kernel.planarBoolean[operation];
  kernel.planarBoolean[operation] = (...args) => {
    const snapshot = structuredClone(args);
    const t0 = performance.now();
    const result = original(...args);
    const ms = performance.now() - t0;
    calls.push({ operation, jsMs: ms, args: snapshot, result: structuredClone(result) });
    return result;
  };
}
process.on('exit', () => {
  writeFileSync(out, JSON.stringify({ schema: 'rust-spike-captured-calls/1', argv: process.argv.slice(1), calls }) + '\n');
});
