// Runs every spike workload once on the Bend JS kernel with capture-preload.mjs
// (sequentially, one process at a time) and writes tmp/rust/planar-spike/calls/<id>.json.
//   node --max-old-space-size=8192 scripts/rust/planar-spike/capture.mjs [id ...]
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { WORKLOADS, root, work } from './workloads.mjs';

const only = process.argv.slice(2);
mkdirSync(join(work, 'calls'), { recursive: true });
for (const w of WORKLOADS.filter(w => !only.length || only.includes(w.id))) {
  const file = join(work, 'calls', `${w.id}.json`);
  const outDir = join(work, 'runs', w.id, 'model');
  const t0 = Date.now();
  const run = spawnSync(process.execPath, ['--import', './scripts/rust/planar-spike/capture-preload.mjs', ...w.argv, '--out', outDir],
    { cwd: root, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS, '--max-old-space-size=8192'].filter(Boolean).join(' '), WONKY_BACKEND: 'js', RUST_SPIKE_CAPTURE: file }, maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0) { process.stderr.write(run.stderr); throw new Error(`${w.id} exited ${run.status}`); }
  const captured = JSON.parse(readFileSync(file, 'utf8'));
  console.log(JSON.stringify({ id: w.id, calls: captured.calls.map(c => `${c.operation}:${c.result.$}:${Math.round(c.jsMs)}ms`), wallMs: Date.now() - t0 }));
}
