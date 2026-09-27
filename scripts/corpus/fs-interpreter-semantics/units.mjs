// List the corpus units of cluster fs-interpreter-semantics, with the same
// normalization and cluster rules as scripts/corpus/summarize.mjs (copied, not
// imported, because summarize.mjs writes summary.json on import).
//
// Usage: node scripts/corpus/fs-interpreter-semantics/units.mjs [--json]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { OUT_DIR, RUNS, TMP_DIR, classify } from '../lib.mjs';

const targets = JSON.parse(readFileSync(join(OUT_DIR, 'targets.json'), 'utf8'));
const latest = new Map();
for (const line of readFileSync(RUNS, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const r = JSON.parse(line);
  if (r.runner === 'corpus-run/1') latest.set(r.key, r);
}

function normalize(r) {
  let message = r.message ?? '', userThrow = r.userThrow;
  const op = r.failingOperation;
  if (op?.status === 'failed' && op.error?.message && message !== op.error.message && message.endsWith(op.error.message)) {
    message = op.error.message; userThrow = false;
  }
  let { status, kind } = r.kind === 'runner-timeout' ? { status: 'timeout', kind: 'runner-timeout' }
    : ['signal-SIGABRT', 'signal-SIGSEGV', 'runtime-abort', 'missing-output', 'runner-error', 'export-refused'].includes(r.kind) ? { status: r.status, kind: r.kind }
    : classify({ errorClass: op?.status === 'failed' ? (op.error?.name ?? r.errorClass) : r.errorClass, message, userThrow, completedOperations: r.completedOperations });
  if (/Face vertices do not lie on the analytic plane|Plane frame is not orthonormal|Profile has collinear|A profile must have/.test(message)) { status = 'kernel'; kind = 'sketch-profile-validation'; }
  if (/^Expected a length with units|^Expected an angle with units/.test(message) && /definition\./.test(r.sourceLine ?? '')) { status = 'frontend'; kind = 'feature-parameter-default'; }
  if (/^Unsupported string escape/.test(message)) { status = 'frontend'; kind = 'parse'; }
  if (kind === 'precondition' && /\bis boolean\b/.test(r.sourceLine ?? '')) kind = 'feature-parameter-default';
  return { ...r, status, kind, rootMessage: message };
}
// Same rules as summarize.mjs clusterOf().
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
  if (k === 'python-import-local' || k === 'python-import-third-party') return 'py-imports';
  if (k.startsWith('python-api') || k === 'python-external-geometry-import') return 'py-api-surface';
  return 'other';
}
const KINDS = ['type-check', 'condition-not-boolean', 'units', 'precondition', 'featurescript-error', 'feature-parameter-default'];
const units = targets.units.filter(u => !u.anchor);
const recs = units.map(u => latest.get(u.key)).filter(r => r && r.status !== 'ok').map(normalize)
  .filter(r => r.status !== 'timeout' && KINDS.includes(r.kind));
const allByPath = new Map();
for (const u of units) { const r = latest.get(u.key); if (!r) continue; if (!allByPath.has(r.path)) allByPath.set(r.path, []); allByPath.get(r.path).push(r); }
const rows = recs.map(r => ({
  key: r.key, path: r.path, feature: r.feature, family: r.family, representative: r.representative, sha: r.sha,
  kind: r.kind, message: r.rootMessage, line: r.location?.line ?? null, column: r.location?.column ?? null,
  sourceLine: r.sourceLine, completedOperations: r.completedOperations,
  unitsInFile: allByPath.get(r.path)?.length ?? 1,
}));
rows.sort((a, b) => a.kind.localeCompare(b.kind) || a.path.localeCompare(b.path) || String(a.feature).localeCompare(String(b.feature)));
mkdirSync(join(TMP_DIR, 'fs-interpreter-semantics'), { recursive: true });
// Every unit with its cluster, for joins (all-units.json).
const all = units.map(u => latest.get(u.key)).filter(Boolean).map(r => r.status === 'ok' ? { ...r, rootMessage: null } : normalize(r))
  .map(r => ({ key: r.key, path: r.path, feature: r.feature, family: r.family, frontend: r.frontend, status: r.status, kind: r.kind, cluster: clusterOf(r), message: (r.rootMessage ?? '').slice(0, 200), line: r.location?.line ?? null, completedOperations: r.completedOperations }));
writeFileSync(join(TMP_DIR, 'fs-interpreter-semantics', 'all-units.json'), JSON.stringify(all, null, 1));
writeFileSync(join(TMP_DIR, 'fs-interpreter-semantics', 'units.json'), JSON.stringify(rows, null, 1));
if (process.argv.includes('--json')) console.log(JSON.stringify(rows, null, 1));
else {
  console.log(`${rows.length} units, ${new Set(rows.map(r => r.path)).size} files, ${new Set(rows.map(r => r.family)).size} families`);
  for (const r of rows) console.log([r.kind.padEnd(26), r.family.padEnd(7), `${r.path}#${r.feature ?? ''}`.padEnd(100), `${r.line}:${r.column}`.padEnd(8), r.message.slice(0, 45), '|', (r.sourceLine ?? '').slice(0, 90)].join(' '));
}
