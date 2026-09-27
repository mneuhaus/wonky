// Record loading, normalization and clustering shared by summarize.mjs,
// compare.mjs and backlog.mjs.
//
// - Latest record per unit (runner corpus-run/1) wins.
// - Every failure is re-classified with lib.mjs from the raw recorded fields
//   (error class, message, user-throw flag, completed calls), so classifier
//   refinements do not need a re-run.
// - A decorated re-throw (a model helper that catches a kernel error and
//   throws "prefix: <kernel message>") is attributed to the failing modeling
//   call recorded by the production source-map trace.
// - Clusters: root cause = status + kind + operation + message pattern, merged
//   by the rules in clusterOf() after reading examples (docs/corpus/run.md).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUT_DIR, RUNS, TMP_DIR, REPO, classify, messagePattern } from './lib.mjs';

const b3dVocab = new Set(Object.keys(JSON.parse(readFileSync(join(REPO, 'fixtures/lang/b3d-vocab.json'), 'utf8')).categories ?? {}));

// ------------------------------------------------------------ python modules
const mirror = join(TMP_DIR, 'src');
const localModuleCache = new Map();
function projectHasModule(project, mod) {
  const key = `${project}:${mod}`;
  if (localModuleCache.has(key)) return localModuleCache.get(key);
  let found = false;
  const visit = dir => {
    if (found) return;
    let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) { if (e.name === mod && existsSync(join(dir, e.name, '__init__.py'))) { found = true; return; } visit(join(dir, e.name)); }
      else if (e.name === `${mod}.py`) { found = true; return; }
    }
  };
  visit(join(mirror, project));
  localModuleCache.set(key, found);
  return found;
}

// ------------------------------------------------------------ normalization
function normalize(r) {
  if (r.status === 'ok' || r.status === 'timeout') return { ...r, rootMessage: r.message ?? null };
  let message = r.message ?? '', userThrow = r.userThrow, completed = r.completedOperations;
  const op = r.failingOperation;
  // Decorated re-throw: the recorded failing call carries the kernel message.
  if (op?.status === 'failed' && op.error?.message && message !== op.error.message && message.endsWith(op.error.message)) {
    message = op.error.message; userThrow = false;
  }
  let { status, kind } = r.kind === 'runner-timeout' ? { status: 'timeout', kind: 'runner-timeout' }
    : ['signal-SIGABRT', 'signal-SIGSEGV', 'runtime-abort', 'missing-output', 'runner-error', 'export-refused'].includes(r.kind) ? { status: r.status, kind: r.kind }
    : classify({ errorClass: op?.status === 'failed' ? (op.error?.name ?? r.errorClass) : r.errorClass, message, userThrow, completedOperations: completed });
  if (/Face vertices do not lie on the analytic plane|Plane frame is not orthonormal|Profile has collinear|A profile must have/.test(message)) { status = 'kernel'; kind = 'sketch-profile-validation'; }
  if (/^Expected a length with units|^Expected an angle with units/.test(message) && /definition\./.test(r.sourceLine ?? '')) { status = 'frontend'; kind = 'feature-parameter-default'; }
  if (/^Unsupported string escape/.test(message)) { status = 'frontend'; kind = 'parse'; }
  if (kind === 'precondition' && /\bis boolean\b/.test(r.sourceLine ?? '')) kind = 'feature-parameter-default';
  let module = null;
  if (kind === 'python-import') {
    module = (message.match(/No module named '([^'.]+)/) ?? [])[1] ?? null;
    kind = module && projectHasModule(r.project, module) ? 'python-import-local' : 'python-import-third-party';
  }
  if (kind === 'python-name-error') {
    const name = (message.match(/name '([^']+)' is not defined/) ?? [])[1];
    if (name && b3dVocab.has(name)) { status = 'capability'; kind = 'python-api-wildcard'; }
  }
  return { ...r, status, kind, rootMessage: message, rootPattern: messagePattern(message), module };
}

// ------------------------------------------------------------ clusters
const CLUSTERS = {
  'fs-module-import': ['FeatureScript module imports cannot be resolved (no frozen Onshape snapshot, local library path)', 'fs'],
  'fs-headerless-include': ['Header-less include fragments counted as modeling files (not standalone FeatureScript)', 'fs'],
  'fs-missing-builtin': ['Onshape std builtins not implemented (opTransform, makeId, qContainsPoint, makeRobustQuery, ...)', 'fs'],
  'fs-parser-syntax': ['FeatureScript syntax the parser rejects (try blocks, for k,v in map, "function" string, escapes)', 'fs'],
  'fs-interpreter-semantics': ['Interpreter semantic gaps (feature parameter defaults, annotation Filter &&, bound-spec/Color type tags, units)', 'fs'],
  'fs-needs-partstudio-input': ['Feature expects existing Part Studio parts (model check throws before any geometry)', 'fs'],
  'boolean-capability': ['opBoolean outside the admitted Boolean paths (general trimmed-face, through-hole and arity limits)', 'fs'],
  'boolean-invalid-topology': ['Planar arrangement Boolean returns InvalidTopology / UnsupportedArrangement', 'fs'],
  'kernel-sketch-and-ops': ['Sketch/profile validation and other operation limits (loft, mixed sketch entities, plane frames)', 'fs'],
  'py-imports': ['Python imports fail in the isolated runner (-I -S: no script directory, no site-packages)', 'py'],
  'py-api-surface': ['build123d API outside the Bend shim (Part, Compound, Text, sketches, selectors, ...)', 'py'],
  'timeout': ['Runner timeout', 'both'],
  'other': ['Other (library-only files, model checks after geometry, unclassified)', 'both'],
};
function clusterOf(r) {
  const k = r.kind, m = r.rootMessage ?? '';
  if (r.status === 'timeout') return 'timeout';
  if (k.startsWith('import-')) return 'fs-module-import';
  if (k === 'parse-headerless-include') return 'fs-headerless-include';
  if (k === 'undefined-builtin') return 'fs-missing-builtin';
  if (k === 'parse') return 'fs-parser-syntax';
  if (['type-check', 'condition-not-boolean', 'units', 'precondition', 'featurescript-error', 'feature-parameter-default'].includes(k)) return 'fs-interpreter-semantics';
  if (k === 'model-check-before-geometry' || k === 'ui-selection-missing') return 'fs-needs-partstudio-input';
  // Every native planar arrangement refusal (UnsupportedArrangement, AmbiguousContact,
  // ResolutionLimit, ...) is a planar Boolean limit, not an FS capability gap (corpus W2;
  // no baseline record changes cluster under this rule).
  if (k === 'invalid-topology' || /UnsupportedArrangement|Native planar arrangement \w+ unresolved/.test(m)) return 'boolean-invalid-topology';
  if (r.status === 'capability' && /opBoolean/.test(m)) return 'boolean-capability';
  if (k === 'sketch-profile-validation' || (r.status === 'capability' && r.frontend === 'fs')) return 'kernel-sketch-and-ops';
  if (k === 'python-import-local' || k === 'python-import-third-party') return 'py-imports';
  if (k.startsWith('python-api') || k === 'python-external-geometry-import') return 'py-api-surface';
  return 'other';
}

export { CLUSTERS, clusterOf, normalize };

// Latest normalized record per corpus unit (anchor excluded), with clusters.
export function loadRecords({ runs = RUNS } = {}) {
  const targets = JSON.parse(readFileSync(join(OUT_DIR, 'targets.json'), 'utf8'));
  const latest = new Map();
  if (existsSync(runs)) for (const line of readFileSync(runs, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    if (r.runner === 'corpus-run/1') latest.set(r.key, r);
  }
  const units = targets.units.filter(u => !u.anchor);
  const anchorUnit = targets.units.find(u => u.anchor);
  const recs = units.map(u => latest.get(u.key)).filter(Boolean).map(normalize);
  for (const r of recs) if (r.status !== 'ok') r.cluster = clusterOf(r);
  return { targets, latest, units, anchorUnit, recs };
}
