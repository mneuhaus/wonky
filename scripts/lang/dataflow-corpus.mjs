// Dataflow-graph study over Marc's real FeatureScript corpus
// (docs/language/proposal-dataflow.md, section "Evidence").
//
// For every unique FS modeling file of the corpus scan (tmp/lang/fs-facts.json,
// produced by scripts/lang/scan-fs.mjs) this script mock-executes each exported
// feature with src/lang/dataflow/fs-trace.mjs (wonky's interpreter, no kernel)
// and records whether the whole feature lowers to a WGraph without a graph
// break, the graph shape (heavy work, span, independent components), the first
// break or capability error, and - for complete traces - how much heavy work a
// content-addressed cache would recompute after single-constant edits.
// The r10b fixture (frozen, read only) is traced with its frozen modules and
// its real feature parameters.
//
//   node scripts/lang/dataflow-corpus.mjs [--out out/lang/dataflow/corpus.json] [--edits 8]
//
// Read-only on ~/Workspace/cad. Single-threaded, no kernel, no native code.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { loadavg, homedir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { parse } from '../../src/parser.mjs';
import { traceFeatureScript } from '../../src/lang/dataflow/fs-trace.mjs';
import { analyze, diffGraphs, mergeGraphs, hashGraph } from '../../src/lang/dataflow/graph.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const argv = process.argv.slice(2);
const option = (f, d) => { const i = argv.indexOf(f); return i < 0 ? d : argv[i + 1]; };
const outPath = join(root, option('--out', 'out/lang/dataflow/corpus.json'));
const maxEdits = Number(option('--edits', '8'));
const corpusRoot = process.env.WONKY_CORPUS_ROOT ?? join(homedir(), 'Workspace', 'cad');
const load = () => loadavg().map(x => Math.round(x * 100) / 100).join(' ');
const sha = s => createHash('sha256').update(s).digest('hex').slice(0, 16);
const pct = (n, d) => (d ? Math.round(1000 * n / d) / 10 : 0);
const quantile = (xs, q) => { if (!xs.length) return null; const v = [...xs].sort((a, b) => a - b); return v[Math.min(v.length - 1, Math.floor(q * v.length))]; };

// Static ladder level per site: identical to scripts/lang/corpus-report.mjs fsSiteLevel.
function fsSiteLevel(s) {
  if (s.kind === 'geo-branch') { if (s.sub === 'assert') return 2; if (s.sub === 'emptiness-guard') return 3; if (s.geomOp) return s.inMap ? 6 : 7; if (s.selects || s.filter) return 5; return 2; }
  if (s.kind === 'geo-iterate') { if (s.geomOp) return s.carried ? 7 : 6; if (s.selects) return 5; return 2; }
  if (s.kind === 'geo-data') { if (!s.geomOp) return s.sub === 'measure-param' ? 2 : 1; return s.sub === 'measure-param' ? 4 : 5; }
  if (s.kind === 'meta-branch') return s.sub === 'assert' ? 2 : 5;
  if (s.kind === 'meta-iterate') return 5;
  return 0;
}
const staticLevel = r => Math.max(0, ...(r.sites ?? []).filter(s => s.reachable !== false).map(fsSiteLevel));

// Numeric literals in the source, the edit targets. scope 'const': only inside
// top-level constant declarations (the file's parameters); scope 'any': every numeric
// literal of the program (a random design change). Returns AST literal nodes in order.
function numericLiterals(program, scope) {
  const out = [];
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (node.kind === 'literal' && typeof node.value === 'number' && node.loc?.kind === 'number') { out.push(node); return; }
    for (const [k, v] of Object.entries(node)) { if (k === 'loc') continue; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') walk(v); }
  };
  for (const d of program.declarations) {
    const isFeature = d.value?.kind === 'call' && d.value.callee?.name === 'defineFeature';
    if (scope === 'const' ? d.constant && d.value && d.value.kind !== 'function' && !isFeature : true) walk(d.value);
  }
  return out.sort((a, b) => a.loc.line - b.loc.line || a.loc.column - b.loc.column);
}
function editSource(source, lit) {
  const lines = source.split('\n');
  const line = lines[lit.loc.line - 1];
  const at = lit.loc.column - 1;
  const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(line.slice(at));
  if (!m) return null;
  const v = Number(m[0]);
  const next = v === 0 ? 0.5 : Number((v * 1.05).toPrecision(12));
  lines[lit.loc.line - 1] = line.slice(0, at) + String(next) + line.slice(at + m[0].length);
  return { source: lines.join('\n'), from: m[0], to: String(next) };
}

// Strict mode first (the file as wonky runs it today). If that fails for reasons outside
// the graph question, retry in study mode: UI defaults, user picks and unfrozen imports as
// explicit graph inputs, and - if the program itself reports an error - a Part Studio that
// already contains bodies (one opaque input.context node). The mode is recorded per feature.
const RANK = { complete: 4, break: 3, unsupported: 2, error: 1 };
function traceBest(source, options) {
  const tries = [['strict', null], ['study', { defaults: true, opaqueImports: true, createdByPrefix: true }], ['study+context', { defaults: true, opaqueImports: true, createdByPrefix: true, contextInput: true }]];
  let best = null;
  for (const [mode, study] of tries) {
    let r; try { r = traceFeatureScript(source, { ...options, study }); } catch (e) { r = null; }
    if (!r) continue;
    r.mode = mode; r.study = study;
    if (!best || RANK[r.status] > RANK[best.status]) best = r;
    if (r.status === 'complete' || r.status === 'break') break;
    if (mode === 'study' && r.status !== 'error') break; // the context retry only answers program-reported errors
  }
  return best;
}

function summarize(result) {
  const a = analyze(result.graph);
  return {
    status: result.status, mode: result.mode, inputs: result.trace.inputs, ms: Math.round(result.ms * 10) / 10, steps: result.steps,
    error: result.error ? { name: result.error.name, message: result.error.message.slice(0, 240), line: result.error.line, site: result.error.site } : null,
    nodes: a.nodes, heavy: a.work, span: a.span, parallelism: a.parallelism && Math.round(a.parallelism * 100) / 100,
    medium: a.counts.medium ?? 0, checks: result.trace.checks, speculations: result.trace.speculations.length, components: a.heavyComponents.length,
    largestComponent: a.heavyComponents[0] ?? 0,
  };
}

// ---------------------------------------------------------------------------------------------
const facts = JSON.parse(readFileSync(join(root, 'tmp/lang/fs-facts.json'), 'utf8'));
const modeling = facts.files.filter(f => f.role === 'feature' || f.role === 'library');
const unique = [...new Map(modeling.map(f => [f.sha, f])).values()];
const report = { schema: 'wonky.lang.dataflow-corpus/1', capturedAt: new Date().toISOString(), loadBefore: load(), corpusRoot, maxEdits, files: [] };
const t0 = performance.now();
for (const f of unique) {
  const row = { path: f.path, sha: f.sha, family: f.family, generated: f.generated ?? null, staticLevel: staticLevel(f), features: [] };
  report.files.push(row);
  let source;
  try { source = readFileSync(join(corpusRoot, f.path), 'utf8'); } catch { row.status = 'missing'; continue; }
  if (sha(source) !== f.sha) { row.status = 'changed-since-scan'; continue; }
  let program;
  try { program = parse(source); } catch (e) { row.status = 'parse-error'; row.error = e.message.slice(0, 200); continue; }
  const features = program.declarations.filter(d => d.exported && d.value?.kind === 'call' && d.value.callee?.name === 'defineFeature').map(d => d.name);
  row.featureCount = features.length;
  if (!features.length) { row.status = 'no-feature'; continue; }
  for (const feature of features) {
    let r;
    r = traceBest(source, { feature, sourcePath: f.path, maxSteps: 30000000 });
    if (!r) { row.features.push({ feature, status: 'error', error: { name: 'Error', message: 'tracer threw' } }); continue; }
    const s = summarize(r); s.feature = feature; row.features.push(s);
    if (r.status === 'complete' && s.heavy > 0 && maxEdits > 0 && !row.edits) {
      // Single-constant edits: re-trace, diff by content hash.
      row.edits = {};
      for (const scope of ['const', 'any']) {
        const lits = numericLiterals(program, scope);
        const step = Math.max(1, Math.floor(lits.length / maxEdits));
        const e = row.edits[scope] = { literals: lits.length, tried: 0, changedGraph: 0, failed: 0, results: [] };
        for (let i = 0; i < lits.length && e.tried < maxEdits; i += step) {
          const edit = editSource(source, lits[i]); if (!edit) continue;
          e.tried++;
          let r2; try { r2 = traceFeatureScript(edit.source, { feature, sourcePath: f.path, maxSteps: 30000000, study: r.study }); } catch { e.failed++; continue; }
          if (r2.status !== 'complete') { e.failed++; continue; }
          const d = diffGraphs(r.graph, r2.graph);
          if (!d.dirty) continue;
          e.changedGraph++;
          e.results.push({ line: lits[i].loc.line, from: edit.from, to: edit.to, heavy: d.heavy, heavyDirty: d.heavyDirty, heavyDirtyFraction: Math.round(d.heavyDirtyFraction * 1000) / 1000, added: d.added, removed: d.removed });
        }
      }
    }
  }
  // Classify each graph break by the static ladder level of the corpus-scan site at that line.
  for (const x of row.features.filter(x => x.status === 'break' && x.error?.line)) {
    const sites = (f.sites ?? []).filter(s => s.reachable !== false && s.line <= x.error.line && s.line >= x.error.line - 5);
    const at = sites.filter(s => s.line === x.error.line);
    const pick = at.length ? at : sites.filter(s => s.line === Math.max(...sites.map(y => y.line)));
    x.breakLevel = pick.length ? Math.max(...pick.map(fsSiteLevel)) : null;
    x.breakComplex = pick.some(s => s.pred === 'complex');
  }
  const best = row.features.filter(x => x.status === 'complete').sort((a, b) => b.heavy - a.heavy)[0];
  row.status = row.features.every(x => x.status === 'complete') ? 'complete' : row.features.some(x => x.status === 'complete') ? 'partial' : (row.features.find(x => x.status === 'break') ? 'break' : row.features[0]?.status);
  row.main = best ?? row.features[0];
}
report.corpusMs = Math.round(performance.now() - t0);

// --- r10b fixture: frozen modules, real feature parameters ------------------------------------------
{
  const path = join(root, 'fixtures/r10b/r10b.fs'), manifest = join(root, 'fixtures/r10b/modules.json');
  const source = readFileSync(path, 'utf8');
  const run = parameters => traceFeatureScript(source, { feature: 'singleStepR10b', moduleManifest: manifest, sourcePath: 'fixtures/r10b/r10b.fs', parameters, maxSteps: 30000000 });
  const base = run({});
  const r10b = { sha256: createHash('sha256').update(source).digest('hex'), base: summarize(base), perPart: {}, edits: [], sweep: null };
  // Heavy work per sub-feature (build function = id component after model/).
  for (const n of base.graph.nodes) {
    const part = n.name.split('/')[1] ?? '?';
    r10b.perPart[part] ??= { nodes: 0, heavy: 0 };
    r10b.perPart[part].nodes++; if (n.kind === 'op' && n.cost === 'heavy') r10b.perPart[part].heavy++;
  }
  const edits = [
    ['catchPitch', '5 * millimeter'], ['catchHeight', '0.75 * millimeter'], ['innerWallThickness', '4.2 * millimeter'],
    ['edgeAngle', 'R10bEdgeAngle.K20'],
  ];
  for (const [name, expression] of edits) {
    let r; try { r = run({ [name]: expression }); } catch (e) { r10b.edits.push({ name, expression, status: 'error', error: e.message.slice(0, 200) }); continue; }
    if (r.status !== 'complete') { r10b.edits.push({ name, expression, status: r.status, error: r.error }); continue; }
    const d = diffGraphs(base.graph, r.graph);
    const dg = diffGraphs(base.graph, r.graph, { key: 'geom' });
    const parts = [...new Set(d.dirtyNames.map(x => x.split('/')[1]))];
    r10b.edits.push({ name, expression, status: 'complete', heavy: d.heavy, heavyDirty: d.heavyDirty, heavyDirtyFraction: d.heavyDirtyFraction, heavyDirtyGeomKey: dg.heavyDirty, added: d.added, removed: d.removed, dirtyParts: parts, ms: Math.round(r.ms) });
  }
  // A 3-variant sweep of catchPitch merged by content hash (hash-consing).
  const variants = ['3 * millimeter', '4 * millimeter', '6 * millimeter'].map(v => run({ catchPitch: v }));
  if (variants.every(v => v.status === 'complete')) {
    const merged = mergeGraphs(variants.map(v => v.graph));
    const a = analyze(merged), one = analyze(variants[0].graph);
    r10b.sweep = { parameter: 'catchPitch', values: [3, 4, 6], heavyPerVariant: one.work, heavyNaive: variants.reduce((s, v) => s + analyze(v.graph).work, 0), heavyMerged: a.work, spanMerged: a.span, parallelismMerged: a.parallelism };
  }
  report.r10b = r10b;
}

// --- aggregates ---------------------------------------------------------------------------------------
const rows = report.files;
const families = new Map();
for (const r of rows) { const cur = families.get(r.family); if (!cur) families.set(r.family, r); }
const count = (xs, pred) => xs.filter(pred).length;
const agg = xs => {
  const traced = xs.filter(r => r.features?.length);
  const complete = xs.filter(r => r.status === 'complete' || r.status === 'partial');
  const heavy = complete.map(r => r.main).filter(m => m?.heavy > 0);
  return {
    files: xs.length,
    byStatus: Object.fromEntries([...new Set(xs.map(r => r.status))].map(s => [s, count(xs, r => r.status === s)])),
    traced: traced.length, completeOrPartial: complete.length, completePctOfTraced: pct(complete.length, traced.length),
    completeByMode: Object.fromEntries(['strict', 'study', 'study+context'].map(m => [m, count(complete, r => r.main?.mode === m)])),
    breakFiles: count(xs, r => r.status === 'break'),
    breakFreeAmongGraphOutcomes: pct(complete.length, complete.length + count(xs, r => r.status === 'break')),
    heavyGraphs: heavy.length,
    heavyWork: { median: quantile(heavy.map(m => m.heavy), 0.5), p90: quantile(heavy.map(m => m.heavy), 0.9), max: Math.max(0, ...heavy.map(m => m.heavy)) },
    parallelism: { median: quantile(heavy.map(m => m.parallelism), 0.5), p25: quantile(heavy.map(m => m.parallelism), 0.25), p75: quantile(heavy.map(m => m.parallelism), 0.75), p90: quantile(heavy.map(m => m.parallelism), 0.9) },
    parallelismAtLeast2: pct(count(heavy, m => m.parallelism >= 2), heavy.length),
    components: { median: quantile(heavy.map(m => m.components), 0.5), p90: quantile(heavy.map(m => m.components), 0.9) },
  };
};
const editAgg = (xs, scope) => {
  const perFile = xs.filter(r => r.edits?.[scope]?.changedGraph).map(r => {
    const fr = r.edits[scope].results.map(e => e.heavyDirtyFraction);
    return fr.reduce((s, v) => s + v, 0) / fr.length;
  });
  const all = xs.flatMap(r => (r.edits?.[scope]?.results ?? []).map(e => e.heavyDirtyFraction));
  return { files: perFile.length, edits: all.length,
    meanDirtyPerFile: { median: quantile(perFile, 0.5), p25: quantile(perFile, 0.25), p75: quantile(perFile, 0.75) },
    editsDirtyAtMost25pct: pct(count(all, v => v <= 0.25), all.length), editsDirtyAll: pct(count(all, v => v >= 0.999), all.length) };
};
const byLevel = xs => Object.fromEntries([0, 1, 2, 3, 4, 5, 6, 7].map(l => {
  const ys = xs.filter(r => r.staticLevel === l && r.features?.length);
  return [l, { traced: ys.length, complete: count(ys, r => r.status === 'complete' || r.status === 'partial'), break: count(ys, r => r.status === 'break'), unsupported: count(ys, r => r.status === 'unsupported') }];
}).filter(([, v]) => v.traced));
const hist = (xs, key) => { const h = {}; for (const r of xs) for (const f of r.features ?? []) if (f.status === key && f.error) { const k = key === 'break' ? (f.error.site ?? '?') : (f.error.message.match(/'([^']+)' is not defined/)?.[1] ?? f.error.message.slice(0, 80)); h[k] = (h[k] ?? 0) + 1; } return Object.entries(h).sort((a, b) => b[1] - a[1]).slice(0, 25); };
report.aggregate = {
  unique: agg(rows), families: agg([...families.values()]),
  editsConstUnique: editAgg(rows, 'const'), editsConstFamilies: editAgg([...families.values()], 'const'),
  editsAnyUnique: editAgg(rows, 'any'), editsAnyFamilies: editAgg([...families.values()], 'any'),
  byStaticLevelUnique: byLevel(rows),
  breaksByStaticSiteLevel: (() => { const h = {}; for (const r of rows) for (const x of r.features ?? []) if (x.status === 'break') { const k = x.breakLevel === null ? 'unclassified' : `${x.breakLevel}${x.breakComplex ? '-complex' : ''}`; h[k] = (h[k] ?? 0) + 1; } return h; })(),
  breakFilesByStaticSiteLevel: (() => { const h = {}; for (const r of rows.filter(r => r.status === 'break')) { const lv = Math.max(-1, ...r.features.filter(x => x.status === 'break').map(x => x.breakLevel ?? -1)); const k = lv < 0 ? 'unclassified' : String(lv); h[k] = (h[k] ?? 0) + 1; } return h; })(),
  breakSites: hist(rows, 'break'), unsupported: hist(rows, 'unsupported'),
};
report.loadAfter = load();
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(report, null, 1) + '\n');
console.log(JSON.stringify({ corpusMs: report.corpusMs, load: [report.loadBefore, report.loadAfter], unique: report.aggregate.unique, families: report.aggregate.families, editsConst: report.aggregate.editsConstUnique, editsAny: report.aggregate.editsAnyUnique, editsAnyFamilies: report.aggregate.editsAnyFamilies, byLevel: report.aggregate.byStaticLevelUnique, breaksBySite: report.aggregate.breaksByStaticSiteLevel, breakFilesBySite: report.aggregate.breakFilesByStaticSiteLevel, breakSites: report.aggregate.breakSites.slice(0, 10), unsupported: report.aggregate.unsupported.slice(0, 15), r10b: { base: report.r10b.base, edits: report.r10b.edits, sweep: report.r10b.sweep } }, null, 1));
