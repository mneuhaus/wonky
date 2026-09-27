// Native runs of WPy graphs on the existing spike binary (no Bend compile):
// frame-with-tab and bracket at 1 thread; pockets with automatic par vs the same
// lowering with append, at 1/2/4 threads. 3 samples each, sequential, load recorded.
//   node scripts/lang/surface-native.mjs  -> out/lang/surface/native.json
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { preflightWpy } from '../../src/lang/surface/index.mjs';
import { runNative } from '../../src/lang/surface/backend-native.mjs';

const load = () => execSync('uptime').toString().trim().replace(/.*load averages?: /, '');
const graph = f => preflightWpy(readFileSync(`fixtures/lang/surface/${f}`, 'utf8'), { file: f }).graph;
const median = xs => [...xs].sort((a, b) => a - b)[xs.length >> 1];
const runs = [];
for (const [file, threads, parallel] of [['bracket.py', 1, true], ['frame-with-tab.py', 1, true], ['frame-with-tab.py', 4, true],
  ['pockets.py', 1, false], ['pockets.py', 1, true], ['pockets.py', 2, true], ['pockets.py', 4, false], ['pockets.py', 4, true]]) {
  const g = graph(file), samples = [], l = load();
  let last;
  for (let i = 0; i < 3; i++) { last = await runNative(g, { threads, parallel }); samples.push(last.evalMs); }
  runs.push({ file, threads, parallel: parallel && last.groups > 1, groups: last.groups, load: l, evalMs: samples, medianEvalMs: median(samples),
    outputs: last.outputs.map(o => ({ id: o.id, volume: o.volume, faces: o.faces, hash: o.hash })) });
  console.log(file, threads, parallel, samples, l);
}
writeFileSync('out/lang/surface/native.json', JSON.stringify({ binary: 'out/lang/spike/build/main (built by the bend-feasibility stage, reused unchanged)', runs }, null, 1));
