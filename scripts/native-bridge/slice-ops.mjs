#!/usr/bin/env node
// The native-bridge vertical slice: which kernel entries the native build
// serves, where each one lives in today's loadKernel() namespace, and the six
// workloads that must run through it (docs/native-bridge.md, section 11).
//
// The entry list is fixed here (its order is the wire op id), and checked
// against the measured call counts of the workloads, kept tracked in
// src/native/slice-calls.json (refreshed from the count files under
// out/native-bridge/profile/calls/ by slice-inputs.mjs): the set of entries the
// slice workloads call must equal SLICE_OPS. Namespace placement comes from the
// wiring of loadJsKernel() in src/kernel.mjs (src/native/kernel-wiring.mjs), the
// production entry list from src/native/surface.json (surface-scan.mjs). Nothing
// here reads out/, so a fresh clone builds the addon.
//
//   node scripts/native-bridge/slice-ops.mjs --check     (exit 1 on any mismatch)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { kernelWiring, placementOf } from '../../src/native/kernel-wiring.mjs';
import { SLICE_CALLS_FILE } from './slice-inputs.mjs';

export const SURFACE_FILE = 'src/native/surface.json';

export const root = fileURLToPath(new URL('../../', import.meta.url));
const python = join(root, 'out/build123d-performance/reference-venv/bin/python');
const cases = join(root, 'fixtures/performance-build123d/cases');

// Wire op id = index. Kernel-relative spec as gen-wire.mjs takes it. Since the
// W2 re-baseline (2026-09-23) the polyhedral path is the F32x2 profile ring
// merge and polygon prism (src/kernel.mjs extrudeInBend / transformInBend); the
// F32 topology.bend extrude/transform and geometry.bend frame/lift_points/
// translate are no longer called by production. Since the W2 integrate fix
// (2026-09-24) a translation of a prism is extruded again (src/kernel.mjs
// translatedPrismInputs), so no workload calls polygon-prism.bend:transform any
// more; it left the slice (16 entries) and a rotated prism copy on native is
// refused by name.
export const SLICE_OPS = [
  'ports/planar-boolean.bend:union',
  'ports/planar-boolean.bend:subtract',
  'ports/curved.bend:audit',
  'ports/solid-intersection.bend:planar_measures',
  'identity.bend:boolean_result',
  'identity.bend:box',
  'identity.bend:box_layout',
  'identity.bend:transform',
  'identity.bend:extrusion',
  'analytic.bend:curve_residual',
  'analytic.bend:surface_residual',
  'profile-ring.bend:simplify',
  'polygon-prism.bend:extrude',
  'face-classification.bend:linear_edge',
  'face-classification.bend:max_budget',
  'real.bend:max',
  // R20 gate (local design note task 12b): what the R20 kernel cases KT6
  // (coplanar union through the hybrid) and KT2 (608 seat: cylinders, pierce,
  // hybrid cuts, print mesh, STEP) call besides the planar entries above.
  'sketch-lines.bend:solve',
  'volume.bend:volume',
  'analytic.bend:frustum',
  'analytic.bend:frustum_bounds',
  'analytic.bend:frustum_volume_between',
  'analytic.bend:cylinder_line_residual',
  'identity.bend:frustum',
  'pierce.bend:pierce',
  'prism-boolean.bend:boolean', // the exact prism arm runs (and declines) before the hybrid
  'precise.bend:add',
  'precise.bend:sub',
  'precise.bend:dot',
  'precise.bend:normalize',
  'precise.bend:frame',
  'precise.bend:lift',
  'tessellate.bend:chord_count',
  'tessellate.bend:within',
  'tessellate.bend:sagitta',
  'tessellate.bend:angle_of',
  'tessellate.bend:arc_interior',
  'step-cylinder-pcurves.bend:for_cylinders_domains',
  'step-cylinder-pcurves.bend:max_budget',
];

// loadKernel().hybrid (kernel/hybrid/main.bend) is not an addon op: its
// corefine and recover place device calls ('!'), and a fail-stop on a pool
// worker would end the Node process. WONKY_BACKEND=native|diff serve it with
// the subprocess wonky-hybrid (kernel/hybrid/native.bend, plan step 11a),
// built with the addon under the same source hash (build-native.mjs) and run
// by src/native/hybrid-process.mjs. These are the hybrid namespace keys the
// host (src/hybrid.mjs runHybrid, carrierClasses) calls, i.e. the stages the
// subprocess computes in one run; every other hybrid key refuses by name.
export const HYBRID_DRIVER = 'kernel/hybrid/native.bend';
export const HYBRID_HOSTED = Object.freeze(['corefine/main.run', 'rjob', 'mid.go', 'map', 'finish', 'show',
  'mesh-io.parse_job', 'recover/topo.surfs.go', 'recover/topo.cls.go']);
export const hybridEntry = key => `kernel/hybrid/main.bend:${key}`;

const pythonCase = (id, file) => ({ id, frontend: 'python',
  args: out => ['bin/wonky-python.mjs', join(cases, file), '--python', python, '--out', join(out, 'model')] });
const fsCase = (id, file, extra = []) => ({ id, frontend: 'featurescript',
  args: out => ['bin/wonky.mjs', file, ...extra, '--out', join(out, 'model')] });

// The R20 kernel cases live in Marc's R20 project (read only; local design note).
export const R20_CASES = join(process.env.HOME ?? '', 'Workspace/cad/cad-project-041/single-step-r20/kernel-cases');
const r20Case = (id, dir, feature) => ({ id, frontend: 'featurescript', external: join(R20_CASES, dir, 'case.fs'),
  args: out => ['bin/wonky.mjs', join(R20_CASES, dir, 'case.fs'), '--feature', feature, '--format', 'print', '--deviation-mm', '0.01', '--out', join(out, 'model')] });

// Same commands as docs/native-bridge/profile.md (the six planar workloads)
// and the count runs of the two R20 cases (slice-inputs.mjs).
export const SLICE_WORKLOADS = [
  pythonCase('py-planar-union', 'planar-union.py'),
  pythonCase('py-planar-pocket', 'planar-pocket.py'),
  pythonCase('py-frame-with-tab', 'frame-with-tab.py'),
  fsCase('fs-fuse-g1', 'fixtures/public-boolean-regressions/adapted/fuse-g1.fs', ['--format', 'step']),
  fsCase('fs-cut-h1', 'fixtures/public-boolean-regressions/adapted/cut-h1.fs', ['--format', 'step']),
  fsCase('fs-bracket', 'examples/bracket.fs'),
  r20Case('r20-kt6', 'kt6_coplanar_union', 'kt6CoplanarUnion'),
  r20Case('r20-kt2', 'kt2_608_seat', 'kt2Seat608'),
];

// Must fail loudly on native, without loading the JS kernel.
export const NEGATIVE_WORKLOADS = [
  { id: 'fs-bored-spacer-print', args: out => ['bin/wonky.mjs', 'examples/bored-spacer.fs', '--format', 'print', '--out', join(out, 'model')] },
  { id: 'fs-r10b-strict', args: () => ['bin/wonky.mjs', 'fixtures/r10b/r10b.fs', '--feature', 'singleStepR10b', '--check'] },
];

let surfaceCache;
export function surface() {
  surfaceCache ??= JSON.parse(readFileSync(join(root, SURFACE_FILE), 'utf8'));
  return surfaceCache;
}

// Where a kernel entry sits in today's loadKernel() result, derived from the
// wiring of loadJsKernel() in src/kernel.mjs: a wired module's defs under its
// field ('planarBoolean.union'), the root module's defs at the root, and the
// defs of the modules the root imports under their import prefix
// ('geometry.frame'). The two STEP pcurve modules are loaded by
// src/exporters.mjs and appear under exportKernels(). Nothing else is reachable
// through loadKernel().
const EXPORT_MODULES = { 'kernel/step-pcurves.bend': 'stepPCurves', 'kernel/step-cylinder-pcurves.bend': 'stepCylinderPCurves' };
let wiringCache;
export function wiring() {
  wiringCache ??= kernelWiring(root);
  return wiringCache;
}
export function placement(entry) {
  const [file, def] = entry.split(':');
  const slot = placementOf(entry, wiring(), root);
  if (slot) return { scope: 'kernel', ...slot };
  if (EXPORT_MODULES[file]) return { scope: 'export', namespace: EXPORT_MODULES[file], key: def };
  return { scope: 'other', namespace: null, key: def };
}

// loadKernel()'s sub-namespaces (the compat proxies mirror exactly these).
export const namespaces = () => Object.keys(wiring().fields).sort();

export const entryOf = spec => `kernel/${spec}`;
const label = p => p.namespace ? `${p.namespace}.${p.key}` : p.key;

// One record per op: wire id, gen-wire spec, kernel entry, namespace placement.
// Export-scope ops (the STEP pcurve modules) are served through
// exportKernels(), under their own namespace.
export function opTable(specs) {
  return specs.map((spec, id) => {
    const entry = entryOf(spec), where = placement(entry);
    if (where.scope === 'other') throw new Error(`${entry} is not reachable through loadKernel() or exportKernels()`);
    return { id, spec, entry, ...(where.scope === 'export' ? { scope: 'export' } : {}), namespace: where.namespace, key: where.key, label: label(where) };
  });
}

// Every production entry of today's surface with its placement: the compat
// proxies use it to name the entry in a capability error.
export function surfaceTable() {
  return surface().entries.filter(e => e.production).map(e => ({ entry: e.entry, ...placement(e.entry) }))
    .map(({ entry, scope, namespace, key }) => ({ entry, scope, namespace, key }));
}

// The production entries Bend 2.0.25 can emit as C (all but curved-intersection;
// 82 since the W2 re-baseline, 84 before).
export const CURVED_INTERSECTION = 'ports/curved-intersection.bend:intersect';
export function fullOps() {
  return surface().entries.filter(e => e.production).map(e => e.entry.replace(/^kernel\//, '')).filter(spec => spec !== CURVED_INTERSECTION);
}

// Measured calls per entry of one workload (count-kernel-calls.mjs; the
// re-exported topology geometry.* entries already mapped to geometry.bend).
let callsCache;
export function profileCalls(workload) {
  callsCache ??= JSON.parse(readFileSync(join(root, SLICE_CALLS_FILE), 'utf8'));
  const record = callsCache.workloads[workload];
  if (!record) throw new Error(`${SLICE_CALLS_FILE} has no count record for ${workload} (node scripts/native-bridge/slice-inputs.mjs)`);
  if (record.exitCode !== 0) throw new Error(`the count run of ${workload} records exit ${record.exitCode}`);
  return { ...record.entries };
}

// The hybrid namespace is served by the subprocess (HYBRID_HOSTED), so its
// entries count as covered, not as addon ops.
export function checkSlice() {
  const declared = SLICE_OPS.map(entryOf);
  const hosted = new Set(HYBRID_HOSTED.map(hybridEntry));
  const used = new Set(), perWorkload = {};
  for (const w of SLICE_WORKLOADS) {
    perWorkload[w.id] = profileCalls(w.id);
    for (const entry of Object.keys(perWorkload[w.id])) if (!hosted.has(entry)) used.add(entry);
  }
  const missing = [...used].filter(e => !declared.includes(e)).sort();
  const unused = declared.filter(e => !used.has(e)).sort();
  if (new Set(declared).size !== declared.length) throw new Error('duplicate slice entry');
  return { ok: !missing.length && !unused.length, declared: declared.length, used: used.size, missing, unused, perWorkload };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = checkSlice();
  const table = opTable(SLICE_OPS);
  console.log(JSON.stringify({ ok: result.ok, declared: result.declared, usedBySliceWorkloads: result.used,
    missing: result.missing, unused: result.unused, ops: table.map(op => `${op.id} ${op.entry} -> ${op.label}`) }, null, 1));
  if (!result.ok) process.exitCode = 1;
}
