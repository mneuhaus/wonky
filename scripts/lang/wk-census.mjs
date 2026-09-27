// Dynamic staging census (docs/language/proposal-core-ir.md §5.4).
//
// Runs the FeatureScript -> WK/0 stager (src/lang/wk/stage-fs.mjs) on every
// unique FeatureScript modeling file of Marc's corpus (~/Workspace/cad, read
// only) and records, per exported feature, whether the program lowers to ONE
// WK graph (no host<->kernel synchronization at all), where it needs its first
// graph break, or why the prototype frontend cannot stage it. Cross-tabulated
// with the static ladder of the corpus stage (tmp/lang/fs-facts.json, level
// rule copied from scripts/lang/corpus-report.mjs fsSiteLevel).
//
// Usage: node scripts/lang/wk-census.mjs [out/lang/wk/census.json]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';
import { parse } from '../../src/parser.mjs';
import { stageFeatureScript } from '../../src/lang/wk/stage-fs.mjs';
import { structure, HEAVY } from '../../src/lang/wk/ir.mjs';
import { UnsupportedFeatureError, FeatureScriptError } from '../../src/errors.mjs';

const out = process.argv[2] ?? 'out/lang/wk/census.json';
const facts = JSON.parse(readFileSync('tmp/lang/fs-facts.json', 'utf8'));
const load = () => execSync('uptime').toString().trim().replace(/.*load averages?: /, '');

// Static ladder level of the corpus stage (scripts/lang/corpus-report.mjs).
function fsSiteLevel(s) {
  if (s.kind === 'geo-branch') {
    if (s.sub === 'assert') return 2;
    if (s.sub === 'emptiness-guard') return 3;
    if (s.geomOp) return s.inMap ? 6 : 7;
    if (s.selects || s.filter) return 5;
    return 2;
  }
  if (s.kind === 'geo-iterate') {
    if (s.geomOp) return s.carried ? 7 : 6;
    if (s.selects) return 5;
    return 2;
  }
  if (s.kind === 'geo-data') {
    if (!s.geomOp) return s.sub === 'measure-param' ? 2 : 1;
    return s.sub === 'measure-param' ? 4 : 5;
  }
  if (s.kind === 'meta-branch') return s.sub === 'assert' ? 2 : 5;
  if (s.kind === 'meta-iterate') return 5;
  return 0;
}
const staticLevel = r => Math.max((r.calls && Object.keys(r.calls).some(k => /^call:q[A-Z]/.test(k))) ? 1 : 0,
  ...(r.sites ?? []).filter(s => s.reachable !== false).map(fsSiteLevel));

const modeling = facts.files.filter(f => f.role === 'feature' || f.role === 'library');
const unique = [...new Map(modeling.map(f => [f.sha, f])).values()];
const familyRep = new Map();
for (const f of unique) { const cur = familyRep.get(f.family); if (!cur || f.mtime > cur.mtime) familyRep.set(f.family, f); }

const RESIDUAL = new Set(['arith', 'cmp', 'math', 'choose', 'not', 'count', 'get', 'format']);
const loadBefore = load();
const t0 = performance.now();
const rows = [];
for (const f of unique) {
  const source = readFileSync(join(facts.root, f.path), 'utf8');
  const row = { path: f.path, sha: f.sha, family: f.family, familyRep: familyRep.get(f.family) === f, lines: f.lines, generated: f.generated ?? null, staticLevel: staticLevel(f), features: [] };
  let exports;
  try {
    exports = parse(source).declarations.filter(d => d.exported && d.kind === 'declaration' && d.value?.kind === 'call' && d.value.callee?.name === 'defineFeature').map(d => d.name);
  } catch (error) { row.outcome = 'parse-error'; row.detail = error.message.slice(0, 160); rows.push(row); continue; }
  if (!exports.length) { row.outcome = 'no-feature'; rows.push(row); continue; }
  for (const feature of exports) {
    const t = performance.now();
    let r;
    try {
      r = stageFeatureScript(source, { feature, file: f.path.split('/').pop(), maxSteps: 20_000_000 });
      // A model error on an empty Part Studio is often a feature written to
      // run after earlier Onshape features ("... into a NEW Part Studio
      // first"): retry once with a symbolic initial Part Studio.
      if (r.error instanceof FeatureScriptError && !(r.error instanceof UnsupportedFeatureError) && r.context === 'empty') {
        const retry = stageFeatureScript(source, { feature, file: f.path.split('/').pop(), maxSteps: 20_000_000, context: 'symbolic' });
        if (!retry.error) r = { ...retry, retriedWithContext: r.error.message.slice(0, 120) };
      }
    }
    catch (error) { row.features.push({ feature, outcome: 'desugar-error', detail: error.message.slice(0, 160) }); continue; }
    const ms = performance.now() - t;
    const entry = { feature, ms: Math.round(ms * 10) / 10, idioms: r.idioms.length, context: r.context, ...(r.retriedWithContext ? { emptyStudioError: r.retriedWithContext } : {}), stats: { checks: r.stats.checks, choices: r.stats.choices, regions: r.stats.regions,
      imports: r.stats.imports, genericOps: r.stats.genericOps, genericQueries: r.stats.genericQueries, decorations: r.stats.decorations ?? 0, optionals: r.stats.optionals ?? 0 } };
    if (r.graphBreak) Object.assign(entry, { outcome: 'graph-break', kind: r.graphBreak.kind, line: r.graphBreak.loc?.line ?? null, detail: r.graphBreak.message.slice(0, 160) });
    else if (r.error instanceof UnsupportedFeatureError) Object.assign(entry, { outcome: 'frontend-gap', detail: r.error.message.slice(0, 160), line: r.error.line ?? null });
    else if (r.error instanceof FeatureScriptError) Object.assign(entry, { outcome: 'model-error', detail: r.error.message.slice(0, 160), line: r.error.line ?? null });
    else if (r.error) Object.assign(entry, { outcome: 'internal-error', detail: String(r.error.stack ?? r.error).split('\n').slice(0, 3).join(' | ').slice(0, 300) });
    else {
      const s = structure(r.graph);
      const byOp = s.byOp;
      entry.outcome = 'single-graph';
      entry.graph = { nodes: s.nodes, topLevel: s.topLevel, levels: s.levels, widest: s.widest, heavy: s.heavyCount, heavySpan: s.heavySpan,
        heavyParallelism: Math.round(s.heavyParallelism * 100) / 100, outputs: r.graph.outputs.length,
        residualValueNodes: Object.entries(byOp).filter(([op]) => RESIDUAL.has(op)).reduce((n, [, c]) => n + c, 0),
        expects: byOp.expect ?? 0, regions: (byOp.select ?? 0) + (byOp.map ?? 0) + (byOp.fold ?? 0), folds: byOp.fold ?? 0,
        heavyOps: Object.fromEntries(Object.entries(byOp).filter(([op]) => HEAVY.has(op) || op === 'op')) };
    }
    row.features.push(entry);
  }
  const outcomes = row.features.map(x => x.outcome);
  row.outcome = outcomes.every(o => o === 'single-graph') ? 'single-graph'
    : outcomes.includes('internal-error') ? 'internal-error' : outcomes.includes('desugar-error') ? 'desugar-error'
      : outcomes.includes('frontend-gap') ? 'frontend-gap' : outcomes.includes('model-error') ? 'model-error' : 'graph-break';
  rows.push(row);
}
const wallMs = performance.now() - t0;

const count = (xs, key) => xs.reduce((m, x) => { const k = key(x); m[k] = (m[k] ?? 0) + 1; return m; }, {});
const pct = (n, d) => d ? Math.round(1000 * n / d) / 10 : 0;
const summarize = xs => {
  const staged = xs.filter(r => ['single-graph', 'graph-break'].includes(r.outcome));
  const single = xs.filter(r => r.outcome === 'single-graph');
  const graphs = single.flatMap(r => r.features.map(f => f.graph));
  const sorted = (key) => graphs.map(key).sort((a, b) => a - b);
  const q = (arr, p) => arr.length ? arr[Math.min(arr.length - 1, Math.floor(p * arr.length))] : null;
  const par = sorted(g => g.heavyParallelism), nodes = sorted(g => g.nodes), heavy = sorted(g => g.heavy), residual = sorted(g => g.residualValueNodes);
  return {
    files: xs.length, outcomes: count(xs, r => r.outcome),
    stagedToEnd: staged.length, singleGraph: single.length,
    singleGraphWithSymbolicStudio: single.filter(r => r.features.some(x => x.context === 'symbolic')).length,
    idiomsUsed: count(xs.flatMap(r => r.features.filter(x => x.outcome === 'single-graph' && x.idioms).map(() => 'with-idioms')), k => k),
    singleGraphShareOfStaged: pct(single.length, staged.length), singleGraphShareOfAll: pct(single.length, xs.length),
    firstBreakKinds: count(xs.filter(r => r.outcome === 'graph-break'), r => r.features.find(f => f.outcome === 'graph-break').kind),
    gapNames: Object.entries(count(xs.filter(r => r.outcome === 'frontend-gap'), r => (r.features.find(f => f.outcome === 'frontend-gap').detail.match(/'([^']+)'/) ?? [, '?'])[1]))
      .sort((a, b) => b[1] - a[1]).slice(0, 25),
    byStaticLevel: Object.fromEntries([...new Set(xs.map(r => r.staticLevel))].sort().map(l => [l, count(xs.filter(r => r.staticLevel === l), r => r.outcome)])),
    graphs: { n: graphs.length, nodesMedian: q(nodes, 0.5), nodesP90: q(nodes, 0.9), nodesMax: nodes.at(-1) ?? null,
      heavyMedian: q(heavy, 0.5), heavyP90: q(heavy, 0.9), heavyMax: heavy.at(-1) ?? null,
      heavyParallelismMedian: q(par, 0.5), heavyParallelismP90: q(par, 0.9), heavyParallelismMax: par.at(-1) ?? null,
      shareWithParallelismAtLeast2: pct(graphs.filter(g => g.heavyParallelism >= 2).length, graphs.length),
      residualValueNodesMedian: q(residual, 0.5), residualValueNodesP90: q(residual, 0.9), residualValueNodesMax: residual.at(-1) ?? null,
      withRegions: graphs.filter(g => g.regions).length, withFolds: graphs.filter(g => g.folds).length, withExpects: graphs.filter(g => g.expects).length },
  };
};
const report = {
  schema: 'wonky-lang-wk-census/1', generatedAt: new Date().toISOString(), load: { before: loadBefore, after: load() }, wallMs: Math.round(wallMs),
  corpusRoot: facts.root, factsScannedAt: facts.scannedAt,
  notes: [
    'Dynamic: every unique FS modeling file is actually staged; one outcome per file (worst over its exported features).',
    'single-graph: all features lower to one WK graph with zero graph breaks; graph-break: staging stops at the first point where the program forces a kernel result that no structured node covers.',
    'frontend-gap: the prototype frontend lacks a value-level function or construct (not a kernel limit; kernel functions are always staged as generic nodes).',
    'heavyParallelism = heavy nodes / heavy critical path over top-level nodes (a fold counts once); the upper bound on inter-feature fork-join speedup if all heavy ops cost the same.',
  ],
  unique: summarize(rows), families: summarize(rows.filter(r => r.familyRep)), rows,
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(report, null, 1));
const { rows: _, ...brief } = report;
console.log(JSON.stringify({ ...brief, unique: { ...brief.unique }, families: { ...brief.families } }, null, 1));
