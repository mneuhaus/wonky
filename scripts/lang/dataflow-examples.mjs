// Worked examples for docs/language/proposal-dataflow.md: the WGraph/0 text of
// the bracket, the build123d frame-with-tab case and the pinned corpus design
// test cases (out/lang/corpus.json testCases), traced by the prototype
// frontends. Writes out/lang/dataflow/examples/*.wg and examples.json.
// Read-only on ~/Workspace/cad (files are checked against their pinned SHA-256).
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { traceFeatureScript } from '../../src/lang/dataflow/fs-trace.mjs';
import { tracePython } from '../../src/lang/dataflow/py-trace.mjs';
import { analyze, printGraph } from '../../src/lang/dataflow/graph.mjs';
import { lowerStages } from '../../src/lang/dataflow/lower-spike.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cad = join(homedir(), 'Workspace', 'cad');
const out = join(root, 'out/lang/dataflow/examples');
mkdirSync(out, { recursive: true });
const corpus = JSON.parse(readFileSync(join(root, 'out/lang/corpus.json'), 'utf8'));
const pinned = Object.fromEntries(corpus.testCases.map(t => [t.id, t]));
const summary = [];

function save(name, result, extra = {}) {
  const a = analyze(result.graph);
  writeFileSync(join(out, `${name}.wg`), printGraph(result.graph));
  const row = { name, status: result.status, mode: result.mode ?? 'strict', error: result.error ?? result.break ?? null, nodes: a.nodes, heavy: a.work, span: a.span, parallelism: a.parallelism, counts: a.counts, components: a.heavyComponents, ms: Math.round(result.ms), ...extra };
  summary.push(row); console.log(JSON.stringify(row));
}
function corpusSource(id) {
  const t = pinned[id]; const source = readFileSync(join(cad, t.path), 'utf8');
  const sha = createHash('sha256').update(source).digest('hex');
  if (sha !== t.sha256) throw new Error(`${id}: ${t.path} changed since it was pinned`);
  return { source, path: t.path };
}

save('bracket', traceFeatureScript(readFileSync(join(root, 'examples/bracket.fs'), 'utf8'), { sourcePath: 'examples/bracket.fs' }));
const fwt = await tracePython(readFileSync(join(root, 'fixtures/performance-build123d/cases/frame-with-tab.py'), 'utf8'), { filename: 'frame-with-tab.py' });
save('frame-with-tab', fwt);
writeFileSync(join(out, 'frame-with-tab.lowered.core'), lowerStages([{ graph: fwt.graph }]).text);

for (const [id, feature] of [['fs-simple', 'cornerInsertsR1'], ['fs-medium', 'universalFunnelBracket'], ['fs-hard', 'bottomRotor']]) {
  const { source, path } = corpusSource(id);
  let r;
  try { r = traceFeatureScript(source, { feature: feature ?? undefined, sourcePath: path }); }
  catch (e) { const row = { name: id, path, status: 'parse-error', error: e.message.slice(0, 200), line: e.line }; summary.push(row); console.log(JSON.stringify(row)); continue; }
  if (r.status !== 'complete') {
    const s = traceFeatureScript(source, { feature: feature ?? undefined, sourcePath: path, study: { defaults: true, opaqueImports: true, createdByPrefix: true } });
    s.mode = 'study'; s.strict = { status: r.status, error: r.error }; r = s;
  }
  save(id, r, { path, strict: r.strict ?? null });
}
for (const id of ['py-medium', 'py-hard']) {
  const { source, path } = corpusSource(id);
  try { const r = await tracePython(source, { filename: path }); save(id, r, { path }); }
  catch (e) { const row = { name: id, path, status: 'unsupported', error: e.message.slice(0, 300) }; summary.push(row); console.log(JSON.stringify(row)); }
}
writeFileSync(join(root, 'out/lang/dataflow/examples.json'), JSON.stringify(summary, null, 1) + '\n');
