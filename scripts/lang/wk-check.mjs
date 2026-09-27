// Staging preserves meaning (proposal-core-ir.md §7.3, H2 on the JS target):
// every runnable wonky example is built twice on today's JS-target kernel,
//   (a) src/index.mjs build()                       (the FS interpreter), and
//   (b) FS -> WK staging -> JS reference WK evaluator (src/lang/wk/eval-js.mjs),
// and the resulting bodies are compared: geometry revision (sha256 of the
// decoded B-rep, src/identity.mjs) and the full body JSON including identity.
// Usage: node scripts/lang/wk-check.mjs [out/lang/wk/check.json]
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { build } from '../../src/index.mjs';
import { geometryRevision } from '../../src/identity.mjs';
import { stageFeatureScript } from '../../src/lang/wk/stage-fs.mjs';
import { evaluateGraphJS } from '../../src/lang/wk/eval-js.mjs';
import { printGraph } from '../../src/lang/wk/ir.mjs';

const out = process.argv[2] ?? 'out/lang/wk/check.json';
const load = () => execSync('uptime').toString().trim().replace(/.*load averages?: /, '');
const files = [...readdirSync('examples').filter(f => f.endsWith('.fs')).map(f => `examples/${f}`), 'kernel/lang/wk/cases/frame-with-tab.fs', 'kernel/lang/wk/cases/four-pockets.fs'];
const strip = body => JSON.parse(JSON.stringify(body, (k, v) => (k === 'construction' || k === 'operationEvidence' || k === 'sourceMap' ? undefined : v)));
const rows = [];
const loadBefore = load();
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const row = { file };
  try {
    let t = performance.now();
    const direct = await build(source, { trace: false });
    row.buildMs = performance.now() - t;
    t = performance.now();
    const staged = stageFeatureScript(source, { file: file.split('/').pop() });
    row.stageMs = performance.now() - t;
    if (staged.error || staged.graphBreak) throw staged.error ?? staged.graphBreak;
    t = performance.now();
    const viaWK = await evaluateGraphJS(staged.graph);
    row.wkEvalMs = performance.now() - t;
    row.nodes = staged.graph.nodes.length;
    const a = direct.bodies.map(geometryRevision), b = viaWK.bodies.map(geometryRevision);
    row.bodies = [a.length, b.length];
    row.revisionsEqual = a.length === b.length && a.every((x, i) => x === b[i]);
    row.bodyJsonEqual = JSON.stringify(direct.bodies.map(strip)) === JSON.stringify(viaWK.bodies.map(strip));
    if (!row.bodyJsonEqual) {
      const x = direct.bodies.map(strip), y = viaWK.bodies.map(strip);
      row.firstDifference = Object.keys(x[0] ?? {}).find(k => JSON.stringify(x[0][k]) !== JSON.stringify(y[0]?.[k])) ?? null;
    }
    row.volumes = direct.bodies.map(body => body.validation?.volumeMm3);
    row.graph = printGraph(staged.graph, { spans: true, ids: true }).split('\n');
  } catch (error) { row.error = `${error.name}: ${error.message}`.slice(0, 200); }
  for (const k of ['buildMs', 'stageMs', 'wkEvalMs']) if (row[k] !== undefined) row[k] = Math.round(row[k] * 10) / 10;
  rows.push(row);
  console.log(file.padEnd(40), row.error ?? `revisions ${row.revisionsEqual} json ${row.bodyJsonEqual}${row.firstDifference ? ` (${row.firstDifference})` : ''} build ${row.buildMs} ms, stage ${row.stageMs} ms, wk-eval ${row.wkEvalMs} ms`);
}
mkdirSync('out/lang/wk', { recursive: true });
writeFileSync(out, JSON.stringify({ schema: 'wonky-lang-wk-check/1', generatedAt: new Date().toISOString(), load: { before: loadBefore, after: load() },
  note: 'JS target (Bend compiled to JS) for both sides; timings indicative, shared machine.', rows }, null, 1));
