// Canonical WK/0 text of the proposal's example programs (proposal-core-ir.md
// §3) plus the staging summary of the frozen r10b fixture. Reads the corpus
// files in place (~/Workspace/cad, read only) and checks their pinned SHA-256
// (out/lang/corpus.json testCases) before staging.
// Usage: node --stack-size=8000 scripts/lang/wk-examples.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { stageFeatureScript } from '../../src/lang/wk/stage-fs.mjs';
import { stagePython } from '../../src/lang/wk/stage-py.mjs';
import { canonicalize } from '../../src/lang/wk/canon.mjs';
import { printGraph, structure, contentHashes } from '../../src/lang/wk/ir.mjs';

const corpus = JSON.parse(readFileSync('out/lang/corpus.json', 'utf8'));
const pinned = Object.fromEntries(corpus.testCases.map(t => [t.path, t.sha256 ?? t.identity?.sha256]));
const load = () => execSync('uptime').toString().trim().replace(/.*load averages?: /, '');
mkdirSync('out/lang/wk/examples', { recursive: true });
const summary = { generatedAt: new Date().toISOString(), load: { start: load() }, examples: {} };

const cases = [
  { name: 'bracket', kind: 'fs', path: 'examples/bracket.fs' },
  { name: 'frame-with-tab.fs', kind: 'fs', path: 'kernel/lang/wk/cases/frame-with-tab.fs' },
  { name: 'frame-with-tab.py', kind: 'py', path: 'fixtures/performance-build123d/cases/frame-with-tab.py' },
  { name: 'four-pockets', kind: 'fs', path: 'kernel/lang/wk/cases/four-pockets.fs' },
  { name: 'inserts', kind: 'fs', corpus: 'cad-project-039/hopper-corner-inserts-r1/inserts.fs' },
  { name: 'guide-r2', kind: 'fs', corpus: 'cad-project-002/funnel-holder-r2/guide-r2.fs' },
  { name: 'drive-purpose', kind: 'fs', corpus: 'cad-project-014/bottom-drive-purpose-2026-09-19/src/drive-purpose.fs' },
  { name: 'r10b', kind: 'fs', path: 'fixtures/r10b/r10b.fs', feature: 'singleStepR10b', summaryOnly: true },
];
for (const c of cases) {
  const path = c.corpus ? join(corpus.corpusRoot, c.corpus) : c.path;
  const source = readFileSync(path, 'utf8');
  const sha = createHash('sha256').update(source).digest('hex');
  const entry = { path: c.corpus ?? c.path, sha256: sha };
  if (c.corpus) entry.pinnedShaMatches = pinned[c.corpus] ? pinned[c.corpus] === sha : null;
  const t0 = performance.now();
  let r;
  try {
  r = c.kind === 'fs' ? stageFeatureScript(source, { file: path.split('/').pop(), feature: c.feature })
    : await stagePython(source, { filename: path.split('/').pop(), python: 'out/build123d-performance/reference-venv/bin/python' });
  } catch (error) { entry.outcome = `frontend error: ${error.message}`; summary.examples[c.name] = entry; console.log(c.name, entry.outcome); continue; }
  entry.stageMs = Math.round((performance.now() - t0) * 10) / 10;
  if (r.graphBreak || r.error || r.failure) { entry.outcome = r.graphBreak ? `graph-break (${r.graphBreak.kind}) at ${r.graphBreak.loc?.line}: ${r.graphBreak.message}` : String((r.error ?? r.failure).message); summary.examples[c.name] = entry; continue; }
  const g = canonicalize(r.graph).graph;
  const s = structure(g); delete s.level;
  Object.assign(entry, { outcome: 'single-graph', structure: s, idioms: r.idioms?.length ?? 0, stats: r.stats ?? null });
  if (!c.summaryOnly) writeFileSync(`out/lang/wk/examples/${c.name}.wk.txt`, printGraph(g, { hashes: contentHashes(g), sourceName: path.split('/').pop() }) + '\n');
  summary.examples[c.name] = entry;
  console.log(c.name.padEnd(20), entry.outcome, entry.stageMs, 'ms', s.nodes, 'nodes', s.heavyCount, 'heavy', s.heavySpan, 'span');
}
summary.load.end = load();
writeFileSync('out/lang/wk/examples/summary.json', JSON.stringify(summary, null, 1));
