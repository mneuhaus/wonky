// Cluster boolean-invalid-topology: per corpus file of the cluster, every unit
// (exported feature) with its first blocker, re-classified with the same rules as
// scripts/corpus/summarize.mjs (normalize + clusterOf, FS subset copied here so
// that script stays untouched). Writes out/corpus/boolean-invalid-topology/files.json.
//   node scripts/corpus/boolean-invalid-topology/files.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUT_DIR, RUNS, classify } from '../lib.mjs';

const latest = new Map();
for (const line of readFileSync(RUNS, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const r = JSON.parse(line);
  if (r.runner === 'corpus-run/1') latest.set(`${r.key}`, r);
}
function normalize(r) {
  if (r.status === 'ok' || r.status === 'timeout') return { ...r, rootMessage: r.message ?? null };
  let message = r.message ?? '', userThrow = r.userThrow;
  const op = r.failingOperation;
  if (op?.status === 'failed' && op.error?.message && message !== op.error.message && message.endsWith(op.error.message)) { message = op.error.message; userThrow = false; }
  let { status, kind } = classify({ errorClass: op?.status === 'failed' ? (op.error?.name ?? r.errorClass) : r.errorClass, message, userThrow, completedOperations: r.completedOperations });
  if (/Face vertices do not lie on the analytic plane|Plane frame is not orthonormal|Profile has collinear|A profile must have/.test(message)) { status = 'kernel'; kind = 'sketch-profile-validation'; }
  if (/^Expected a length with units|^Expected an angle with units/.test(message) && /definition\./.test(r.sourceLine ?? '')) { status = 'frontend'; kind = 'feature-parameter-default'; }
  if (/^Unsupported string escape/.test(message)) { status = 'frontend'; kind = 'parse'; }
  if (kind === 'precondition' && /\bis boolean\b/.test(r.sourceLine ?? '')) kind = 'feature-parameter-default';
  return { ...r, status, kind, rootMessage: message };
}
function clusterOf(r) {
  const k = r.kind, m = r.rootMessage ?? '';
  if (r.status === 'ok') return 'ok';
  if (r.status === 'timeout') return 'timeout';
  if (k.startsWith('import-')) return 'fs-module-import';
  if (k === 'parse-headerless-include') return 'fs-headerless-include';
  if (k === 'undefined-builtin') return 'fs-missing-builtin';
  if (k === 'parse') return 'fs-parser-syntax';
  if (['type-check', 'condition-not-boolean', 'units', 'precondition', 'featurescript-error', 'feature-parameter-default'].includes(k)) return 'fs-interpreter-semantics';
  if (k === 'model-check-before-geometry' || k === 'ui-selection-missing') return 'fs-needs-partstudio-input';
  if (k === 'invalid-topology' || /UnsupportedArrangement/.test(m)) return 'boolean-invalid-topology';
  if (r.status === 'capability' && /opBoolean/.test(m)) return 'boolean-capability';
  if (k === 'sketch-profile-validation' || (r.status === 'capability' && r.frontend === 'fs')) return 'kernel-sketch-and-ops';
  return 'other';
}
const recs = [...latest.values()].filter(r => r.frontend === 'fs' && r.phase !== 0).map(normalize).map(r => ({ ...r, cluster: clusterOf(r) }));
const paths = [...new Set(recs.filter(r => r.cluster === 'boolean-invalid-topology').map(r => r.path))];
const files = paths.map(path => {
  const units = recs.filter(r => r.path === path).map(r => ({ feature: r.feature, cluster: r.cluster, message: (r.rootMessage ?? '').slice(0, 160),
    completed: r.completedOperations, chain: (r.failingOperation?.callStack ?? []).map(f => `${f.name}@${f.calledAt?.line ?? '?'}:${f.calledAt?.column ?? '?'}`).join(' > ') }));
  const counts = units.reduce((c, u) => ({ ...c, [u.cluster]: (c[u.cluster] ?? 0) + 1 }), {});
  const first = recs.find(r => r.path === path);
  return { path, family: first.family, representative: first.representative, units: units.length, clusterUnits: counts,
    primary: Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0], unitList: units };
});
files.sort((a, b) => a.family.localeCompare(b.family) || a.path.localeCompare(b.path));
writeFileSync(join(OUT_DIR, 'boolean-invalid-topology', 'files.json'), JSON.stringify({ schema: 'wonky-corpus-cluster-files/1', cluster: 'boolean-invalid-topology', generatedAt: new Date().toISOString(), files }, null, 1) + '\n');
for (const f of files) {
  console.log(`${f.family} ${f.representative ? 'R' : ' '} ${f.path}  units=${f.units} ${JSON.stringify(f.clusterUnits)} primary=${f.primary}`);
  for (const u of f.unitList) console.log(`     ${u.cluster === 'boolean-invalid-topology' ? '*' : ' '} ${String(u.feature).padEnd(26)} ${u.cluster.padEnd(26)} ${u.message.slice(0, 110)}`);
}
