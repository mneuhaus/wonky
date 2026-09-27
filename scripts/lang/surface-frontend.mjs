// Warm host-side cost of the WPy frontend (parse + evaluate to a graph, no kernel)
// per example, median of 20 runs after 5 warmups.  -> out/lang/surface/frontend.json
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { parse } from '../../src/lang/surface/parse.mjs';
import { Evaluator } from '../../src/lang/surface/eval.mjs';

const files = {
  'bracket.py': 'fixtures/lang/surface/bracket.py',
  'frame-with-tab.py': 'fixtures/lang/surface/frame-with-tab.py',
  'pockets.py': 'fixtures/lang/surface/pockets.py',
  'inserts.py (from inserts.fs)': 'fixtures/lang/surface/inserts.py',
  'guide-r2.py (from guide-r2.fs)': 'fixtures/lang/surface/guide-r2.py',
  'project-component-d98e059b.py (unmodified corpus file)': `${process.env.HOME}/Workspace/cad/cad-project-035/project-component-d98e059b.py`,
  'cad-project-025/beam_frame.py (largest corpus graph)': `${process.env.HOME}/Workspace/cad/cad-project-025/beam_frame.py`,
};
const median = xs => [...xs].sort((a, b) => a - b)[xs.length >> 1];
const load = () => execSync('uptime').toString().trim().replace(/.*load averages?: /, '');
const out = { load: { before: load() }, rows: [] };
for (const [name, path] of Object.entries(files)) {
  const src = readFileSync(path, 'utf8');
  const p = [], e = [];
  let nodes = 0;
  for (let i = 0; i < 25; i++) {
    const t0 = performance.now(); const ast = parse(src, { file: name }); const t1 = performance.now();
    const ev = new Evaluator({ file: name, source: src }); ev.run(ast); const t2 = performance.now();
    if (i >= 5) { p.push(t1 - t0); e.push(t2 - t1); }
    nodes = ev.graph.nodes.length;
  }
  out.rows.push({ name, lines: src.split('\n').length, bytes: src.length, nodes, parseMs: +median(p).toFixed(3), evalMs: +median(e).toFixed(3) });
}
out.load.after = load();
writeFileSync('out/lang/surface/frontend.json', JSON.stringify(out, null, 1));
console.table(out.rows); console.log(out.load);
