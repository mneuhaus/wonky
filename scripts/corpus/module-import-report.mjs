// Aggregate the fs-module-import next-blocker probes into
// out/corpus/module-import/next-summary.json (docs/corpus/cluster-fs-module-import.md).
//
// Inputs: out/corpus/module-import/scan.json, out/corpus/module-import/next.jsonl
// (latest record per job wins). Next blockers are re-clustered with the same
// cluster keys as scripts/corpus/summarize.mjs (rules copied, not imported:
// summarize.mjs is a script with side effects).
//
// Levels per unit:
//   stub1  = import resolved, addInstance semantics complete (no loadedContext,
//            transform, hierarchical qCreatedBy), partQuery evaluated for real;
//   stub2  = stub1 + partQuery selection answered (never evaluated);
//   rebind = production code, unchanged, with the captured r10b snapshot
//            re-bound to the file (only files whose imports it covers).
//
// Usage: node scripts/corpus/module-import-report.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUT_DIR, classify, messagePattern } from './lib.mjs';

const OUT = join(OUT_DIR, 'module-import');
const { files } = JSON.parse(readFileSync(join(OUT, 'scan.json'), 'utf8'));
const latest = new Map();
for (const l of readFileSync(join(OUT, 'next.jsonl'), 'utf8').split('\n')) if (l.trim()) { const r = JSON.parse(l); latest.set(r.job, r); }

function clusterOf(r) {
  if (r.status === 'ok') return 'ok';
  if (r.status === 'timeout') return 'timeout';
  const k = r.kind, m = r.result?.message ?? '';
  if (/^stub /.test(m)) return 'stub-limit';
  if (k.startsWith('import-')) return 'fs-module-import';
  if (/loadedContext must belong|addInstance field|was not captured in this input snapshot|Imported surface|Imported curve|Imported edge|Imported vertex/.test(m)) return 'fs-module-import (snapshot semantics)';
  if (k === 'parse-headerless-include') return 'fs-headerless-include';
  if (k === 'undefined-builtin') return 'fs-missing-builtin';
  if (k === 'parse') return 'fs-parser-syntax';
  if (['type-check', 'condition-not-boolean', 'units', 'precondition', 'featurescript-error', 'feature-parameter-default'].includes(k)) {
    if (/Face vertices do not lie on the analytic plane|Plane frame is not orthonormal|Profile has collinear|A profile must have/.test(m)) return 'kernel-sketch-and-ops';
    return 'fs-interpreter-semantics';
  }
  if (k === 'model-check-before-geometry' || k === 'ui-selection-missing') return 'fs-needs-partstudio-input';
  if (k === 'model-check-failed') return 'model-check-after-geometry';
  if (k === 'invalid-topology' || /UnsupportedArrangement/.test(m)) return 'boolean-invalid-topology';
  if (r.status === 'capability' && /opBoolean/.test(m)) return 'boolean-capability';
  if (r.status === 'capability' || r.status === 'kernel') return 'kernel-sketch-and-ops';
  return 'other';
}
const detail = raw => {
  if (!raw) return null;
  let r = raw, m = r.result?.message ?? '';
  // Decorated re-throw ("prism model/g0: <kernel message>"): attribute it to the
  // failing modeling call recorded by the production trace, as summarize.mjs does.
  const opError = r.result?.trace?.failedOperation?.error;
  if (opError && m !== opError && m.endsWith(opError)) {
    m = opError;
    r = { ...r, ...classify({ errorClass: 'UnsupportedFeatureError', message: m, userThrow: false, completedOperations: r.result.trace.completed }), result: { ...r.result, message: m } };
  }
  const builtin = (m.match(/^'(\w+)' is not defined/) ?? [])[1];
  return {
    status: r.status, kind: r.kind, cluster: clusterOf(r), builtin: builtin ?? null,
    message: m.slice(0, 220), pattern: messagePattern(m), line: r.result?.line ?? null,
    completed: r.result?.trace?.completed ?? null, failingOperation: r.result?.trace?.failedOperation?.name ?? null,
    callChain: r.result?.trace?.failedOperation?.callChain ?? [], wallMs: r.wallMs,
    placeholders: r.result?.stub?.placeholders ?? null,
  };
};

const units = [];
for (const f of files) for (const u of f.units.filter(u => u.cluster === 'fs-module-import')) {
  const feature = u.feature ?? '-';
  const get = mode => detail(latest.get(`${mode}:${f.path}#${feature}`));
  units.push({ path: f.path, family: f.family, representative: f.representative, feature, stub1: get('stub1'), stub2: get('stub2'), rebind: get('rebind') });
}
const count = (arr, key) => arr.reduce((c, x) => { const k = key(x); if (k != null) c[k] = (c[k] ?? 0) + 1; return c; }, {});
const sorted = o => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]));
const level = name => {
  const rs = units.filter(u => u[name]);
  return {
    units: rs.length,
    byCluster: sorted(count(rs, u => u[name].cluster)),
    byBuiltin: sorted(count(rs.filter(u => u[name].builtin), u => u[name].builtin)),
    byPattern: Object.entries(count(rs, u => `${u[name].cluster} · ${u[name].pattern}`)).sort((a, b) => b[1] - a[1]).slice(0, 25),
    filesByCluster: sorted(count([...new Map(rs.map(u => [u.path, u])).values()].flatMap(u => [...new Set(rs.filter(x => x.path === u.path).map(x => x[name].cluster))].map(c => ({ c }))), x => x.c)),
  };
};

// Per file: is the import the file's only first blocker? What comes next?
const perFile = files.map(f => {
  const us = units.filter(u => u.path === f.path);
  const next = us.map(u => u.rebind ?? u.stub1);
  return {
    path: f.path, family: f.family, representative: f.representative,
    unitsTotal: f.units.length, unitsImport: f.importUnits, unitsOk: f.okUnits,
    otherFirstBlockers: [...new Set(f.units.filter(u => !u.cluster && u.status !== 'ok').map(u => u.kind))],
    importIsOnlyFirstBlocker: f.otherUnits === f.okUnits,
    importForms: [...new Set((f.imports ?? []).map(i => i.form))], uses: f.usesBuild && f.usesCode ? 'build+code' : f.usesBuild ? 'build' : 'code',
    nextSource: us.some(u => u.rebind) ? 'rebind' : 'stub1',
    next: sorted(count(next.filter(Boolean), d => d.cluster === 'fs-missing-builtin' ? `fs-missing-builtin:${d.builtin}` : d.cluster)),
    afterQueries: sorted(count(us.map(u => u.stub2).filter(Boolean), d => d.cluster === 'fs-missing-builtin' ? `fs-missing-builtin:${d.builtin}` : d.cluster)),
    wouldBuild: next.length > 0 && next.every(d => d?.status === 'ok') && f.otherUnits === f.okUnits,
  };
});
const summary = {
  schema: 'wonky-corpus-module-import-next/1', generatedAt: new Date().toISOString(),
  units: units.length, files: files.length,
  levels: { stub1: level('stub1'), stub2: level('stub2'), rebind: level('rebind') },
  filesImportOnlyFirstBlocker: perFile.filter(f => f.importIsOnlyFirstBlocker).length,
  filesWouldBuildAtStub1: perFile.filter(f => f.wouldBuild).length,
  unitsOk: { stub1: units.filter(u => u.stub1?.status === 'ok').length, stub2: units.filter(u => u.stub2?.status === 'ok').length, rebind: units.filter(u => u.rebind?.status === 'ok').length },
  rebindVsStub1: units.filter(u => u.rebind).map(u => ({ unit: `${u.path}#${u.feature}`, rebind: `${u.rebind.cluster}: ${u.rebind.message.slice(0, 120)}`, stub1: `${u.stub1?.cluster}: ${u.stub1?.message.slice(0, 120)}` })),
  perFile, unitRows: units,
};
writeFileSync(join(OUT, 'next-summary.json'), JSON.stringify(summary, null, 1));

// Per-file markdown table for the cluster document (appendix).
const label = d => !d ? '–' : d.cluster === 'ok' ? 'ok' : d.cluster === 'fs-missing-builtin' ? `\`${d.builtin}\``
  : d.cluster === 'model-check-after-geometry' ? 'model check' : d.cluster.replace(/^fs-module-import \(snapshot semantics\)$/, 'snapshot gap');
const cell = obj => Object.entries(obj).map(([k, n]) => `${k.replace(/^fs-missing-builtin:(\w+)$/, '`$1`')} ${n}`).join(', ');
const scanByPath = new Map(files.map(f => [f.path, f]));
const idioms = f => {
  const a = f.addInstance ?? {}, out = [];
  if (f.usesCode) out.push('code');
  if (a.count > a.withLoadedContext) out.push('no loadedContext');
  if ((a.keys ?? []).includes('transform')) out.push('transform');
  for (const [k] of a.partQueryKinds ?? []) {
    if (/source-feature-id/.test(k)) out.push('makeId query');
    else if (/all bodies/.test(k)) out.push('qEverything/qContainsPoint');
    else if (/name lookup/.test(k)) out.push('name table');
    else out.push('other query');
  }
  return [...new Set(out)].join(', ');
};
const md = ['| file | family | units (import/all) | import form | idioms | first blocker | next (stub1 or rebind) | after source queries (stub2) |', '|---|---|---:|---|---|---|---|---|'];
for (const p of perFile.sort((a, b) => a.family.localeCompare(b.family, 'en', { numeric: true }) || a.path.localeCompare(b.path))) {
  const f = scanByPath.get(p.path);
  const us = units.filter(u => u.path === p.path);
  const next = {}; for (const u of us) { const d = u.rebind ?? u.stub1, k = `${label(d)}${u.rebind ? ' (rebind)' : ''}`; next[k] = (next[k] ?? 0) + 1; }
  const after = {}; for (const u of us) { const k = label(u.stub2); after[k] = (after[k] ?? 0) + 1; }
  md.push(`| \`${p.path}\` | ${p.family}${p.representative ? ' (rep)' : ''} | ${p.unitsImport}/${p.unitsTotal} | ${p.importForms.join(', ').replace('same-document-element', 'same doc').replace('other-document', 'other doc')} | ${idioms(f)} | ${p.importIsOnlyFirstBlocker ? 'only' : 'shared'} | ${cell(next)} | ${cell(after)} |`);
}
writeFileSync(join(OUT, 'files.md'), md.join('\n') + '\n');
console.log(JSON.stringify({ units: summary.units, unitsOk: summary.unitsOk, filesImportOnlyFirstBlocker: summary.filesImportOnlyFirstBlocker,
  stub1: summary.levels.stub1.byCluster, stub1Builtins: summary.levels.stub1.byBuiltin, stub2: summary.levels.stub2.byCluster, stub2Builtins: summary.levels.stub2.byBuiltin, rebind: summary.levels.rebind.byCluster }, null, 1));
