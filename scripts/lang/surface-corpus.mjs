// Corpus coverage of WPy v0 over Marc's build123d modeling files (read-only).
// For every unique file (and per design family): does the WPy parser accept
// it, does it stay inside the WPy subset, does it evaluate to a kernel graph
// without CPython (preflight), and what does that graph need from the kernel.
//
//   node scripts/lang/surface-corpus.mjs [out/lang/surface/corpus.json]
//
// Inputs: tmp/lang/py-facts.json (file roles, families, hashes from the corpus
// stage) and the files under ~/Workspace/cad. Nothing in the corpus is written.
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';
import { parse } from '../../src/lang/surface/parse.mjs';
import { checkModule } from '../../src/lang/surface/check.mjs';
import { Evaluator } from '../../src/lang/surface/eval.mjs';
import { IMPLEMENTED_OPS } from '../../src/lang/surface/index.mjs';

const outPath = process.argv[2] ?? 'out/lang/surface/corpus.json';
// Hardest thing standing between a file and WPy, most expensive first.
const DRIVER_IO = new Set(['pathlib', 'json', 'hashlib', 'sys', 'argparse', 'os', 'time', 'subprocess', 'struct', 'shutil', 'tempfile', 'traceback',
  'inspect', 'importlib', 'pytest', 'ast', 'xml', 'yaml', 'ocp_vscode', 'ocp_tessellate', 'matplotlib', 'PIL']);
const LANGUAGE = new Set(['class', 'decorator', 'global', 'import dataclasses', 'import itertools', 'import functools']);
const OTHER_KERNELS = new Set(['OCP', 'trimesh', 'scipy', 'shapely', 'bd_warehouse']);
function blockerOf(r) {
  if (r.stage === 'parse') return 'generator (yield)';
  const rej = r.rejectRules ?? [];
  const mods = rej.filter(x => x.startsWith('import ')).map(x => x.slice(7));
  if (mods.some(m => OTHER_KERNELS.has(m))) return 'other geometry kernels or libraries (OCP, trimesh, scipy, shapely, bd_warehouse)';
  if (mods.includes('cad_khana')) return 'cad_khana diagnostics wrapper';
  if (rej.some(x => LANGUAGE.has(x))) return 'Python language features outside WPy (class, dataclass, decorator, global)';
  if (mods.some(m => !DRIVER_IO.has(m)) ) return 'other imports';
  if (rej.length) return 'driver IO outside the main block (pathlib, json, hashlib, argparse, ...)';
  if ((r.plannedRules ?? []).length) return 'planned WPy v1 features only (project modules, builders, numpy-lite)';
  if (r.stage === 'eval') return 'WPy v0 vocabulary gap';
  return 'WPy as-is (graph built without CPython)';
}
const facts = JSON.parse(readFileSync('tmp/lang/py-facts.json', 'utf8'));
const load = () => execSync('uptime').toString().trim().replace(/.*load averages?: /, '');
const loadBefore = load();
const uniq = new Map();
for (const f of facts.files) if (f.role === 'b3d-model' && !uniq.has(f.sha)) uniq.set(f.sha, f);
const families = new Map();
for (const f of uniq.values()) { const c = families.get(f.family); if (!c || f.mtime > c.mtime) families.set(f.family, f); }
const representatives = new Set([...families.values()].map(f => f.sha));

const rows = [];
const t0 = performance.now();
for (const f of uniq.values()) {
  const path = join(facts.root, f.path);
  const source = readFileSync(path, 'utf8');
  // project modules: .py files or packages next to the file or in any ancestor directory inside the corpus
  const siblings = new Set();
  for (let d = dirname(path); d.startsWith(facts.root); d = dirname(d)) {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith('.py')) siblings.add(e.name.slice(0, -3));
      else if (e.isDirectory() && !e.name.startsWith('.')) siblings.add(e.name);
    }
    if (d === facts.root) break;
  }
  siblings.delete('build123d'); siblings.delete('cad_khana'); siblings.delete('cad-khana');
  const row = { path: f.path, sha: f.sha, family: f.family, representative: representatives.has(f.sha), lines: source.split('\n').length };
  let ast;
  const tp = performance.now();
  try { ast = parse(source, { file: f.path }); }
  catch (e) { row.stage = 'parse'; row.reason = /yield/.test(e.message) ? 'generator (yield)' : e.message; rows.push(row); continue; }
  row.parseMs = +(performance.now() - tp).toFixed(2);
  const checked = checkModule(ast, { localModules: siblings });
  row.subset = checked.verdict;
  row.rules = checked.rules;
  row.rejectRules = [...new Set(checked.findings.filter(x => x.severity === 'reject').map(x => x.rule === 'import' ? `import ${x.message.replace(/^import /, '').split(/[ .]/)[0]}` : x.rule))];
  row.plannedRules = [...new Set(checked.findings.filter(x => x.severity === 'planned').map(x => x.rule))];
  if (checked.verdict !== 'accept') { row.stage = 'subset'; rows.push(row); continue; }
  const te = performance.now();
  try {
    const ev = new Evaluator({ file: f.path, source, backend: null, maxSteps: 2_000_000 });
    ev.run(ast);
    const g = ev.graph;
    row.stage = 'graph';
    row.evalMs = +(performance.now() - te).toFixed(2);
    const ops = g.summary().ops;
    row.nodes = g.nodes.length;
    row.outputs = g.outputs.length;
    row.gapOps = Object.fromEntries(Object.entries(ops).filter(([op]) => !IMPLEMENTED_OPS.has(op)));
    const sels = g.nodes.filter(n => n.op === 'select');
    row.selections = { lowered: sels.filter(n => n.params.predicate.op !== 'host').length, host: sels.filter(n => n.params.predicate.op === 'host').length, structural: g.nodes.filter(n => ['filter', 'sort', 'group', 'pick', 'pick_group'].includes(n.op)).length };
    row.syncPoints = g.syncPoints.length;
    row.syncReasons = [...new Set(g.syncPoints.map(s => s.reason.replace(/^.*: /, '')))];
    row.failureSites = g.failureSites.length;
    row.kernelReady = Object.keys(row.gapOps).length === 0 && row.outputs > 0;
  } catch (e) {
    row.stage = 'eval';
    row.evalMs = +(performance.now() - te).toFixed(2);
    row.errorKind = e.kind ?? 'internal';
    row.reason = (e.message ?? String(e)).slice(0, 200);
    row.line = e.span?.line;
    if (!e.kind) row.stack = String(e.stack).split('\n').slice(0, 4).join(' | ');
  }
  rows.push(row);
}
for (const r of rows) r.blocker = blockerOf(r);
const ms = performance.now() - t0;
const share = (xs, pred) => ({ n: xs.filter(pred).length, of: xs.length, pct: +(100 * xs.filter(pred).length / xs.length).toFixed(1) });
const sum = (xs, k) => xs.reduce((s, r) => s + (r[k] ?? 0), 0);
const agg = xs => {
  const graphs = xs.filter(r => r.stage === 'graph');
  const count = key => { const m = {}; for (const r of xs) for (const x of r[key] ?? []) m[x] = (m[x] ?? 0) + 1; return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1])); };
  const gap = {}; for (const r of graphs) for (const op of Object.keys(r.gapOps)) gap[op] = (gap[op] ?? 0) + 1;
  const evalFail = {}; for (const r of xs.filter(r => r.stage === 'eval')) { const k = r.reason.replace(/'[^']*'/g, "'…'").slice(0, 90); evalFail[k] = (evalFail[k] ?? 0) + 1; }
  return {
    files: xs.length,
    parsed: share(xs, r => r.stage !== 'parse'),
    inSubset: share(xs, r => r.subset === 'accept'),
    subsetOrPlanned: share(xs, r => r.subset === 'accept' || r.subset === 'planned'),
    graphBuilt: share(xs, r => r.stage === 'graph'),
    kernelReadyToday: share(xs, r => r.kernelReady),
    blockers: Object.fromEntries(Object.entries(xs.reduce((m, r) => ({ ...m, [r.blocker]: (m[r.blocker] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1])),
    reachableWithDriverSplitAndV1: share(xs, r => ['WPy as-is (graph built without CPython)', 'WPy v0 vocabulary gap', 'planned WPy v1 features only (project modules, builders, numpy-lite)', 'driver IO outside the main block (pathlib, json, hashlib, argparse, ...)'].includes(r.blocker)),
    rejectRules: count('rejectRules'),
    plannedRules: count('plannedRules'),
    evalFailures: Object.fromEntries(Object.entries(evalFail).sort((a, b) => b[1] - a[1])),
    graphs: {
      nodes: sum(graphs, 'nodes'), outputs: sum(graphs, 'outputs'),
      selectionsLowered: graphs.reduce((s, r) => s + r.selections.lowered, 0), selectionsHost: graphs.reduce((s, r) => s + r.selections.host, 0),
      filesWithSyncPoints: graphs.filter(r => r.syncPoints > 0).length, syncPoints: sum(graphs, 'syncPoints'),
      filesWithFailureSites: graphs.filter(r => r.failureSites > 0).length,
      kernelGapOpsByFiles: Object.fromEntries(Object.entries(gap).sort((a, b) => b[1] - a[1])),
    },
  };
};
const report = {
  schema: 'wonky-wpy-corpus/1', generatedAt: new Date().toISOString(), corpusRoot: facts.root,
  load: { before: loadBefore, after: load() }, ms: +ms.toFixed(0),
  unique: agg(rows), families: agg(rows.filter(r => r.representative)),
  files: rows,
};
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ ms: report.ms, load: report.load, unique: { ...report.unique, graphs: undefined }, families: { ...report.families, evalFailures: undefined, graphs: report.families.graphs } }, null, 1));
