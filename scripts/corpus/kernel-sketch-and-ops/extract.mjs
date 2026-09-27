import { readFileSync, writeFileSync } from 'node:fs';
// Selects the units of cluster kernel-sketch-and-ops from out/corpus/runs.jsonl with the same
// normalization and cluster rules as scripts/corpus/summarize.mjs (which does not export them),
// plus every unit of the files involved (for the per-file first-blocker view), and the
// cross-cluster units used to measure the cap-normal fix (through-hole admission, planar
// arrangement failures). Writes tmp/corpus/kso/{units,files,xunits}.json.
import { mkdirSync } from 'node:fs';
import { classify, messagePattern } from '../lib.mjs';
const REPO = new URL('../../../', import.meta.url).pathname;
mkdirSync(REPO + 'tmp/corpus/kso', { recursive: true });
const targets = JSON.parse(readFileSync(REPO + 'out/corpus/targets.json', 'utf8'));
const latest = new Map();
for (const line of readFileSync(REPO + 'out/corpus/runs.jsonl', 'utf8').split('\n')) { if (!line.trim()) continue; const r = JSON.parse(line); if (r.runner === 'corpus-run/1') latest.set(r.key, r); }
function normalize(r) {
  if (r.status === 'ok' || r.status === 'timeout') return { ...r, rootMessage: r.message ?? null };
  let message = r.message ?? '', userThrow = r.userThrow, completed = r.completedOperations;
  const op = r.failingOperation;
  if (op?.status === 'failed' && op.error?.message && message !== op.error.message && message.endsWith(op.error.message)) { message = op.error.message; userThrow = false; }
  let { status, kind } = r.kind === 'runner-timeout' ? { status: 'timeout', kind: 'runner-timeout' }
    : ['signal-SIGABRT','signal-SIGSEGV','runtime-abort','missing-output','runner-error','export-refused'].includes(r.kind) ? { status: r.status, kind: r.kind }
    : classify({ errorClass: op?.status === 'failed' ? (op.error?.name ?? r.errorClass) : r.errorClass, message, userThrow, completedOperations: completed });
  if (/Face vertices do not lie on the analytic plane|Plane frame is not orthonormal|Profile has collinear|A profile must have/.test(message)) { status = 'kernel'; kind = 'sketch-profile-validation'; }
  if (/^Expected a length with units|^Expected an angle with units/.test(message) && /definition\./.test(r.sourceLine ?? '')) { status = 'frontend'; kind = 'feature-parameter-default'; }
  if (/^Unsupported string escape/.test(message)) { status = 'frontend'; kind = 'parse'; }
  if (kind === 'precondition' && /\bis boolean\b/.test(r.sourceLine ?? '')) kind = 'feature-parameter-default';
  return { ...r, status, kind, rootMessage: message, rootPattern: messagePattern(message) };
}
function clusterOf(r) {
  const k = r.kind, m = r.rootMessage ?? '';
  if (r.status === 'timeout') return 'timeout';
  if (k.startsWith('import-')) return 'fs-module-import';
  if (k === 'parse-headerless-include') return 'fs-headerless-include';
  if (k === 'undefined-builtin') return 'fs-missing-builtin';
  if (k === 'parse') return 'fs-parser-syntax';
  if (['type-check','condition-not-boolean','units','precondition','featurescript-error','feature-parameter-default'].includes(k)) return 'fs-interpreter-semantics';
  if (k === 'model-check-before-geometry' || k === 'ui-selection-missing') return 'fs-needs-partstudio-input';
  if (k === 'invalid-topology' || /UnsupportedArrangement/.test(m)) return 'boolean-invalid-topology';
  if (r.status === 'capability' && /opBoolean/.test(m)) return 'boolean-capability';
  if (k === 'sketch-profile-validation' || (r.status === 'capability' && r.frontend === 'fs')) return 'kernel-sketch-and-ops';
  return 'other';
}
const units = targets.units.filter(u => !u.anchor);
const recs = units.map(u => latest.get(u.key)).filter(Boolean).map(normalize);
for (const r of recs) if (r.status !== 'ok') r.cluster = clusterOf(r);
const mine = recs.filter(r => r.cluster === 'kernel-sketch-and-ops');
const out = mine.map(r => ({ key: r.key, path: r.path, feature: r.feature, family: r.family, representative: r.representative, status: r.status, kind: r.kind, op: r.failingOperation?.name, msg: r.rootMessage.slice(0, 300), loc: r.location, completed: r.completedOperations, chain: r.failingOperation?.callChain, src: r.sourceLine?.slice(0, 200), wallMs: r.wallMs, timeoutS: r.timeoutS, lines: r.lines }));
writeFileSync(REPO + 'tmp/corpus/kso/units.json', JSON.stringify(out, null, 1));
// all units of files in the cluster (for per-file first-blocker)
const paths = new Set(mine.map(r => r.path));
const perFile = [...paths].map(p => ({ path: p, units: recs.filter(r => r.path === p).map(r => ({ feature: r.feature, status: r.status, cluster: r.cluster ?? 'ok', msg: (r.rootMessage ?? '').slice(0, 120), completed: r.completedOperations })) }));
writeFileSync(REPO + 'tmp/corpus/kso/files.json', JSON.stringify(perFile, null, 1));
const cross = recs.filter(r => r.cluster !== 'kernel-sketch-and-ops' && /through holes need a tool axis perpendicular|planar arrangement (subtraction|union) unresolved/.test(r.rootMessage ?? ''))
  .map(r => ({ key: r.key, path: r.path, feature: r.feature, family: r.family, representative: r.representative, timeoutS: r.timeoutS, msg: r.rootMessage.slice(0, 120), completed: r.completedOperations }));
writeFileSync(REPO + 'tmp/corpus/kso/xunits.json', JSON.stringify(cross, null, 1));
console.log(JSON.stringify({ units: mine.length, files: paths.size, crossUnits: cross.length }));
