// Corpus failure analysis, cluster boolean-capability: per-file view.
// For every unique file with at least one unit in the cluster:
//   - all of its units (latest corpus-run/1 record per unit) and the cluster
//     each failing unit's first blocker belongs to (same rules as
//     scripts/corpus/summarize.mjs normalize()/clusterOf(), FS part);
//   - role of this cluster for the file: sole (every failing unit is here),
//     primary (most failing units are here), minor (fewer);
//   - per cluster unit: its sub-cause (out/corpus/boolean-capability/probe.jsonl)
//     and what it hits next on each step of the fix ladder
//     (probe-nary / probe-pass-coaxial-revolution /
//     probe-pass-coaxial-revolution-pierce-admission / probe-pass /
//     probe-pass-all .jsonl, see scripts/corpus/boolean-hook-loader.mjs),
//     plus the two real-geometry passes through the bake-off prototypes
//     (probe-hybrid: this cluster's refusals; probe-hybrid-all: every
//     booleanInBend refusal; probe-hybrid-all-linearc: the same with every
//     polygon prism built in F32x2). The stub steps are cumulative and run on wrong
//     geometry; the hybrid steps are not part of the ladder.
// Writes out/corpus/boolean-capability/files.json and prints the tables that
// docs/corpus/cluster-boolean-capability.md quotes.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { OUT_DIR, RUNS, classify } from './lib.mjs';
import { clusterUnits } from './boolean-batch.mjs';

const DIR = join(OUT_DIR, 'boolean-capability');
const load = name => {
  const f = join(DIR, `${name}.jsonl`);
  return existsSync(f) ? new Map(readFileSync(f, 'utf8').trim().split('\n').map(l => JSON.parse(l)).map(r => [r.key, r])) : new Map();
};
const STEPS = [
  ['base', 'probe'], ['nary', 'probe-nary'], ['coaxial', 'probe-pass-coaxial-revolution'],
  ['coaxial+pierce', 'probe-pass-coaxial-revolution-pierce-admission'], ['all-cluster', 'probe-pass'], ['all-boolean', 'probe-pass-all'],
  ['hybrid', 'probe-hybrid'], ['hybrid-all', 'probe-hybrid-all'],
  // hybrid-all with every polygon prism built in F32x2 (WONKY_CORPUS_SIMULATE=linearc).
  ['hybrid-all+f32x2', 'probe-hybrid-all-linearc'],
];
const realGeometry = step => step.startsWith('hybrid');
const runs = Object.fromEntries(STEPS.map(([k, f]) => [k, load(f)]));

// --- first-blocker cluster of any FS unit (summarize.mjs, FS subset) ---------
function clusterOf(r) {
  if (r.status === 'ok') return null;
  if (r.status === 'timeout') return 'timeout';
  let message = r.message ?? '', userThrow = r.userThrow;
  const op = r.failingOperation;
  if (op?.status === 'failed' && op.error?.message && message !== op.error.message && message.endsWith(op.error.message)) { message = op.error.message; userThrow = false; }
  let { status, kind } = classify({ errorClass: op?.status === 'failed' ? (op.error?.name ?? r.errorClass) : r.errorClass, message, userThrow, completedOperations: r.completedOperations });
  if (/Face vertices do not lie on the analytic plane|Plane frame is not orthonormal|Profile has collinear|A profile must have/.test(message)) { status = 'kernel'; kind = 'sketch-profile-validation'; }
  if (/^Expected a length with units|^Expected an angle with units/.test(message) && /definition\./.test(r.sourceLine ?? '')) kind = 'feature-parameter-default';
  if (/^Unsupported string escape/.test(message)) kind = 'parse';
  if (kind === 'precondition' && /\bis boolean\b/.test(r.sourceLine ?? '')) kind = 'feature-parameter-default';
  if (kind.startsWith('import-')) return 'fs-module-import';
  if (kind === 'parse-headerless-include') return 'fs-headerless-include';
  if (kind === 'undefined-builtin') return 'fs-missing-builtin';
  if (kind === 'parse') return 'fs-parser-syntax';
  if (['type-check', 'condition-not-boolean', 'units', 'precondition', 'featurescript-error', 'feature-parameter-default'].includes(kind)) return 'fs-interpreter-semantics';
  if (kind === 'model-check-before-geometry' || kind === 'ui-selection-missing') return 'fs-needs-partstudio-input';
  if (kind === 'invalid-topology' || /UnsupportedArrangement/.test(message)) return 'boolean-invalid-topology';
  if (status === 'capability' && /opBoolean/.test(message)) return 'boolean-capability';
  if (kind === 'sketch-profile-validation' || status === 'capability') return 'kernel-sketch-and-ops';
  return 'other';
}
// Short label for what a stubbed or hybrid probe run hit.
function hit(p, step) {
  if (!p) return 'no probe (timeout)';
  if (p.ok) return realGeometry(step) ? 'builds (hybrid prototypes: real geometry)' : 'builds (stubbed Booleans: geometry wrong)';
  const m = p.message ?? '';
  // A refusal of the prototype route: production message + ' [hybrid <stage>: <reason>]'
  // (reason cut at 200 characters by boolean-hybrid.mjs, so the bracket may be missing).
  const h = m.match(/\[hybrid (\w+): ([^;[\]]*)/);
  if (h) return `hybrid refused, ${h[1]}: ${h[2].replace(/^(recover|corefine|brep-tessellate): /, '').replace(/-?[0-9]+(\.[0-9]+)?(e-?[0-9]+)?/g, '#').trim().slice(0, 70)}`;
  if (/InvalidTopology|UnsupportedArrangement|ResolutionLimit/.test(m)) return 'boolean-invalid-topology';
  if (/^opBoolean (supports coaxial|through hole|requires coaxial|currently requires two tools)/.test(m)) return `boolean-capability/${p.subcause?.key ?? '?'}`;
  const b = m.match(/^'([^']+)' is not defined/); if (b) return `builtin ${b[1]}`;
  if (/^Unresolved Onshape module/.test(m)) return 'module import';
  if (/opLoft/.test(m)) return 'opLoft profiles';
  return m.replace(/[0-9]+(\.[0-9]+)?/g, '#').slice(0, 60);
}

const latest = new Map();
for (const l of readFileSync(RUNS, 'utf8').split('\n')) { if (!l.trim()) continue; const r = JSON.parse(l); if (r.runner === 'corpus-run/1') latest.set(r.key, r); }
const cluster = clusterUnits();
const clusterKeys = new Set(cluster.map(u => u.key));
const paths = [...new Set(cluster.map(u => u.path))].sort();
const files = paths.map(path => {
  const units = [...latest.values()].filter(r => r.path === path);
  const clusters = {};
  for (const r of units) { const c = clusterOf(r) ?? 'ok'; clusters[c] = (clusters[c] ?? 0) + 1; }
  const failing = units.length - (clusters.ok ?? 0), here = clusters['boolean-capability'] ?? 0;
  const others = Object.entries(clusters).filter(([k]) => !['ok', 'boolean-capability'].includes(k));
  const role = here === failing ? 'sole' : others.every(([, n]) => n < here) ? 'primary' : 'minor';
  const mine = units.filter(r => clusterKeys.has(r.key)).map(r => ({
    feature: r.feature, completed: r.completedOperations,
    subcause: runs.base.get(r.key)?.probe?.subcause ?? null,
    next: Object.fromEntries(STEPS.slice(1).map(([k]) => [k, runs[k].size ? hit(runs[k].get(r.key)?.probe, k) : null])),
  }));
  const f0 = units[0];
  return { path, family: f0.family, representative: f0.representative, units: units.length, clusters, role, clusterUnits: mine };
});
writeFileSync(join(DIR, 'files.json'), JSON.stringify({ schema: 'corpus-boolean-files/1', steps: STEPS.map(([k, f]) => ({ step: k, file: `${f}.jsonl` })), files }, null, 1) + '\n');

// --- printed summaries -------------------------------------------------------
const roles = files.reduce((m, f) => ({ ...m, [f.role]: (m[f.role] ?? 0) + 1 }), {});
console.log('roles', roles, 'families', new Set(files.map(f => f.family)).size);
for (const [step] of STEPS.slice(1)) {
  const c = {};
  for (const f of files) for (const u of f.clusterUnits) { const k = u.next[step]; if (!k) continue; (c[k] ??= { units: 0, files: new Set(), fams: new Set() }); c[k].units++; c[k].files.add(f.path); c[k].fams.add(f.family); }
  console.log(`\n## next after step '${step}'`);
  for (const [k, v] of Object.entries(c).sort((a, b) => b[1].units - a[1].units)) console.log(`${String(v.units).padStart(4)} ${String(v.files.size).padStart(3)} ${String(v.fams.size).padStart(3)}  ${k}`);
}
// A whole file reaches its end when every failing unit is in this cluster and
// every one of them builds at that step.
for (const [step] of STEPS.slice(1)) {
  const whole = files.filter(f => f.role === 'sole' && f.clusterUnits.every(u => u.next[step]?.startsWith('builds')));
  const units = files.flatMap(f => f.clusterUnits.filter(u => u.next[step]?.startsWith('builds')).map(() => f));
  console.log(`\n## reaches the end after '${step}': ${units.length} units, ${new Set(units.map(f => f.path)).size} files, ${new Set(units.map(f => f.family)).size} families; whole files: ${whole.length}`);
  for (const f of whole) console.log(`   ${f.family.padEnd(6)} ${f.path}`);
}
console.log('\n## files');
for (const f of files) console.log(f.role.padEnd(8), f.family.padEnd(6), f.path, JSON.stringify(f.clusters));
