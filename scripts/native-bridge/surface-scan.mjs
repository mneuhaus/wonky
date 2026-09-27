#!/usr/bin/env node
// Maps the complete host <-> Bend kernel surface as it exists in src/ today and
// writes src/native/surface.json (tracked: the native build's entry list and
// refusal names come from it, docs/native-bridge.md). Everything in that file is derived
// from sources by this script (plus the measured call counts other stages left
// in out/native-bridge/profile/calls/); re-run it whenever kernel/ or src/
// changes. The only hand-maintained inputs are the tables below: which JS
// receiver names which Bend module in which file, what the host does with each
// entry's result, and where the host drops F32x2 low words. Every table entry
// is checked against the sources and the scan fails loudly when one goes stale.
//
//   node scripts/native-bridge/surface-scan.mjs [--out src/native/surface.json]
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { parseModule, resolveType, closure, typeKey, typeLabel, fixedWords, kernelRoot, projectRoot } from './gen-wire.mjs';
import { kernelWiring } from '../../src/native/kernel-wiring.mjs';

const rel = path => relative(projectRoot, path);
const scanError = message => { throw new Error(`surface-scan: ${message}`); };

// ------------------------------------------------------------ receiver tables

// Fields of the object loadKernel() (src/kernel.mjs) returns, parsed from
// loadJsKernel() itself (src/native/kernel-wiring.mjs; the same parser the
// native build and loader use), so a rewired namespace changes this scan too.
// The object spreads its root module (kernel/topology.bend today).
const WIRING = kernelWiring(projectRoot);
const KERNEL_FIELDS = WIRING.fields;
const PORTS = ['ports/occt.bend', 'ports/solvespace.bend', 'ports/truck.bend', 'ports/truck-cylinder.bend', 'ports/hybrid.bend'];

// Per file: a bare receiver name -> Bend module(s). `kernel.<field>` chains
// resolve through KERNEL_FIELDS in every file. A list means the receiver is
// polymorphic (the same adapter is handed different modules).
const RECEIVERS = {
  'src/kernel.mjs': { kernel: WIRING.root },
  'src/analytic.mjs': { A: 'analytic.bend' },
  'src/identity.mjs': { I: 'identity.bend' },
  'src/face-classification.mjs': { classifier: ['face-classification.bend', 'step-cylinder-pcurves.bend'] },
  'src/cylinder-classification.mjs': { classifier: 'cylinder-classification.bend' },
  'src/solid-classification.mjs': { classifier: 'solid-classification.bend' },
  'src/sketch-arcs.mjs': { native: 'sketch-arcs.bend' },
  'src/solid-intersection.mjs': { native: 'ports/solid-intersection.bend' },
  'src/step-pcurves.mjs': { native: 'step-pcurves.bend' },
  'src/step-cylinder-pcurves.mjs': { native: 'step-cylinder-pcurves.bend' },
  'src/display-cylinder.mjs': { P: 'curve-plane.bend', C: 'cylinder-classification.bend', D: 'display.bend', F: 'face-classification.bend' },
  'src/review-scene.mjs': { A: 'analytic.bend', G: 'precise.bend', D: 'display.bend' },
  'src/halfspace.mjs': { kernel: 'halfspace.bend' },
  'src/intersections.mjs': { kernel: 'intersections.bend' },
  'src/section.mjs': { kernel: 'section.bend' },
  'src/ray.mjs': { ray: 'ray.bend' },
  'src/curve-band.mjs': { kernel: 'curve-band.bend' },
  'src/curve-plane.mjs': { kernel: 'curve-plane.bend' },
  'src/edge-plane.mjs': { kernel: 'edge-plane.bend' },
  'src/face-plane.mjs': { kernel: 'face-plane.bend' },
  'src/junction.mjs': { kernel: 'junction.bend' },
  'src/boolean-ports.mjs': { kernel: PORTS },
};

// How a Bend module reaches the host (src/bend-loader.mjs loadBend with the
// persistent cache, loadKernel() field, or the raw registerBendImports hook).
function loadPaths(files) {
  const out = new Map();
  const add = (module, how, where) => { if (!out.has(module)) out.set(module, []); out.get(module).push({ how, where }); };
  for (const [field, module] of Object.entries(KERNEL_FIELDS)) add(module, `loadKernel().${field}`, 'src/kernel.mjs');
  add(WIRING.root, 'loadKernel() root (spread)', 'src/kernel.mjs');
  for (const file of files) {
    const lines = readFileSync(join(projectRoot, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      let m;
      if (file === 'src/kernel.mjs') return;
      if ((m = /loadBend\(new URL\(['`]\.\.\/kernel\/([^'`$]+\.bend)['`]/.exec(line))) add(m[1], 'loadBend (cached)', `${file}:${i + 1}`);
      else if (/loadBend\(new URL\(`\.\.\/kernel\/ports\/\$\{name\}\.bend`/.test(line)) PORTS.forEach(port => add(port, 'loadBend (cached, dynamic name)', `${file}:${i + 1}`));
      if ((m = /await import\(['"]\.\.\/kernel\/([^'"]+\.bend)['"]\)/.exec(line))) add(m[1], 'raw import (registerBendImports hook, uncached)', `${file}:${i + 1}`);
    });
  }
  return out;
}

// ------------------------------------------------------------ source graph

function importGraph(entries) {
  const seen = new Map();
  const visit = (file, from) => {
    if (seen.has(file)) return;
    seen.set(file, from);
    const text = readFileSync(join(projectRoot, file), 'utf8');
    const re = /(?:import\s[^;]*?from\s*|import\s*\(\s*|export\s[^;]*?from\s*)["'](\.[^"']+\.mjs)["']/g;
    let m;
    while ((m = re.exec(text))) visit(rel(resolve(dirname(join(projectRoot, file)), m[1])), file);
  };
  entries.forEach(entry => visit(entry, null));
  return seen;
}

const TIERS = {
  model: ['src/index.mjs', 'src/library.mjs', 'src/queries.mjs', 'src/modules.mjs', 'src/python.mjs', 'src/kernel.mjs', 'src/analytic.mjs',
    'src/boolean.mjs', 'src/planar-boolean.mjs', 'src/curved-intersection.mjs', 'src/solid-intersection.mjs', 'src/halfspace.mjs',
    'src/face-classification.mjs', 'src/intersections.mjs', 'src/identity.mjs', 'src/sketch-arcs.mjs', 'src/construction-history.mjs', 'src/real.mjs'],
  export: ['src/exporters.mjs', 'src/step-pcurves.mjs', 'src/step-cylinder-pcurves.mjs'],
  print: ['src/print-mesh.mjs'],
  compare: ['src/comparison.mjs'],
  viewer: ['src/review-scene.mjs', 'src/display-cylinder.mjs', 'src/cylinder-classification.mjs'],
};
// Exported functions that no production-reachable file imports (and that
// their own file never calls) are diagnostic adapters even inside a reachable
// file, e.g. classifyPlanarFace or revolveInBend.
function usedExports(reachable) {
  const used = new Map();
  for (const file of reachable.keys()) {
    const text = readFileSync(join(projectRoot, file), 'utf8');
    for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"](\.[^'"]+\.mjs)['"]/g)) {
      const target = rel(resolve(dirname(join(projectRoot, file)), m[2]));
      if (!used.has(target)) used.set(target, new Set());
      for (const spec of m[1].split(',')) { const name = spec.trim().split(/\s+as\s+/)[0]; if (name) used.get(target).add(name); }
    }
  }
  return used;
}
function productionFunction(file, fn, used) {
  if (!fn) return true;
  const text = readFileSync(join(projectRoot, file), 'utf8');
  if (!new RegExp(`^export\\s+(?:async\\s+)?(?:function|const)\\s+${fn}\\b`, 'm').test(text)) return true;
  if (used.get(file)?.has(fn)) return true;
  return text.split('\n').some(line => new RegExp(`\\b${fn}\\(`).test(line) && !new RegExp(`(?:function|const)\\s+${fn}\\b`).test(line));
}
const tierOf = (file, reachable, fn = null, used = null) => {
  if (!reachable.has(file)) return 'diagnostic';
  if (used && !productionFunction(file, fn, used)) return 'diagnostic';
  for (const [tier, files] of Object.entries(TIERS)) if (files.includes(file)) return tier;
  return 'model';
};

// Nearest enclosing JS function and FeatureScript builtin / Python request.
function context(lines, index) {
  let fn = null, builtin = null;
  for (let i = index; i >= 0 && (!fn || !builtin); i--) {
    const line = lines[i];
    let m;
    if (!builtin && (m = /(?:register|builtin)\('(\w+)'/.exec(line))) builtin = `FeatureScript ${m[1]}`;
    if (!builtin && (m = /^\s*case '(\w+)': \{/.exec(line)) && lines.slice(0, i).some(l => /request\(request\)/.test(l))) builtin = `Python request '${m[1]}'`;
    if (!fn && (m = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/.exec(line))) fn = m[1];
    if (!fn && (m = /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:\([^)]*\)|\w+)\s*=>/.exec(line))) fn = m[1];
  }
  return { function: fn, builtin };
}

// ------------------------------------------------------------ call-site scan

function scanCalls(files) {
  const hits = [];
  const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const file of files) {
    const text = readFileSync(join(projectRoot, file), 'utf8'), lines = text.split('\n');
    const receivers = [];
    for (const [field, module] of Object.entries(KERNEL_FIELDS)) receivers.push({ expr: `(?:this\\.|engine\\.)?kernel\\.${field}`, modules: [module] });
    for (const [name, modules] of Object.entries(RECEIVERS[file] ?? {})) receivers.push({ expr: `(?<![.\\w])${escape(name)}`, modules: [modules].flat() });
    lines.forEach((line, i) => {
      if (/^\s*\/\//.test(line)) return;
      for (const { expr, modules } of receivers) {
        const re = new RegExp(`${expr}(?:\\.([A-Za-z_]\\w*)|\\[([^\\]]+)\\])\\s*\\(`, 'g');
        let m;
        while ((m = re.exec(line))) {
          const names = m[1] ? [m[1]] : [...m[2].matchAll(/'([\w.]+)'/g)].map(x => x[1]);
          if (!names.length) scanError(`${file}:${i + 1}: computed kernel member without string candidates: ${m[0]}`);
          hits.push({ file, line: i + 1, modules, names, dynamic: !m[1], ...context(lines, i) });
        }
      }
    });
  }
  return hits;
}

// Resolves `name` (possibly `geometry.frame`, `../real.from_f32`) exported by
// the namespace of `moduleFile` to the Bend def that implements it.
function resolveDef(moduleFile, name) {
  const module = parseModule(join(kernelRoot, moduleFile));
  if (module.defs.has(name)) return { module, def: module.defs.get(name) };
  const dot = name.lastIndexOf('.');
  if (dot > 0) {
    const prefix = name.slice(0, dot), local = name.slice(dot + 1);
    for (const file of module.aliases.values()) {
      const key = relative(dirname(module.file), file).replace(/\.bend$/, '');
      if (key === prefix || key === `./${prefix}`) return resolveDef(relative(kernelRoot, file), local);
    }
  }
  return null;
}

// ------------------------------------------------------------ types

const BASE_KIND = { U32: 'U32', F32: 'F32', Bool: 'Bool', String: 'String', Nat: 'Nat', Char: 'Char' };
function typeInfo(module, text) {
  try {
    const t = resolveType(module, text);
    const adts = closure([t]);
    const scalars = new Set();
    const walk = x => {
      if (x.kind === 'base') scalars.add(x.name);
      else if (x.kind === 'list' || x.kind === 'maybe') walk(x.elem);
      else if (x.kind === 'adt') {
        if (typeKey(x) === 'real_Real') scalars.add('Real(F32x2)');
        for (const ctor of x.type.ctors) for (const f of ctor.fields) walk(resolveType(x.module, f.type));
      }
    };
    walk(t);
    return { type: typeLabel(t), wire: 'ok', fixedWords: fixedWords(t), scalars: [...scalars].sort(), adts: adts.map(typeLabel) };
  } catch (error) {
    const base = Object.keys(BASE_KIND).find(k => new RegExp(`\\b${k}\\b`).test(text));
    return { type: text, wire: 'unsupported', reason: error.message.replace(/^[^:]*: /, ''), scalars: base ? [base] : [] };
  }
}

// ------------------------------------------------------------ annotations

// What the host does with each production entry's result. Keys are
// `kernel/<module>:<def>` exactly as they appear in the entries list; the scan
// fails if a production entry has no annotation or an annotation names no
// entry. `decode` names the host conversion (see PRECISION_SITES), `branch`
// what host control flow reads from the result, `post` the host work that
// follows, `api` the proposed coarse operation that absorbs the call.
const A = (role, decode, branch, post, api) => ({ role, decode, branch, post, api });
const ANNOTATIONS = {
  'kernel/profile-ring.bend:simplify': A('construct-helper', 'kept indices (U32) select the profile points; merges -> number() deviation into construction.profileMerge', 'result.$ !== Simplified -> unsupported(reason)', 'polygonPrism.extrude on the kept points', 'extrude_polygon'),
  'kernel/polygon-prism.bend:extrude': A('construct', 'decodePrism: coords() per F32x2 word (at most half a binary64 ulp), -0 -> +0; number() on required/allowance', 'result.$ !== Built -> unsupported(reason); required > allowance -> precision F32', 'validateSolid (host), identifyExtrusion', 'extrude_polygon'),
  'kernel/polygon-prism.bend:admit': A('construct', 'decodePrism (as extrude); input is the host-mirrored oriented solid from real.mjs preciseVector()', 'result.$ !== Built -> unsupported(reason) (refusePrism, reflected transform)', 'validateSolid, transformConstructionHistory, identifyTransform', 'transform'),
  'kernel/polygon-prism.bend:transform': A('construct', 'decodePrism (as extrude); input re-encoded from the decoded JS body by real.mjs vector()', 'result.$ !== Built -> unsupported(reason); required > allowance -> precision F32', 'validateSolid, transformConstructionHistory, identifyTransform', 'transform'),
  'kernel/analytic.bend:plane': A('import-helper', 'kept as Bend value', 'reads .$ of sibling surfaces', 'none', 'import_brep'),
  'kernel/analytic.bend:cylinder': A('import-helper', 'kept as Bend value', 'none', 'none', 'import_brep'),
  'kernel/analytic.bend:cone': A('import-helper', 'kept as Bend value', 'none', 'none', 'import_brep'),
  'kernel/analytic.bend:axis_x': A('import-helper', 'kept as Bend value', 'none', 'none', 'import_brep'),
  'kernel/analytic.bend:circle': A('import-helper', 'kept as Bend value', 'none', 'none', 'import_brep'),
  'kernel/analytic.bend:ellipse': A('import-helper', 'kept as Bend value', 'none', 'none', 'import_brep'),
  'kernel/analytic.bend:plane_cylinder': A('import-helper', 'kept as Bend value', 'none', 'none', 'import_brep'),
  'kernel/analytic.bend:ellipse_forward': A('import-helper', 'Bool used as edge sense', 'none', 'none', 'import_brep'),
  'kernel/analytic.bend:arc_range': A('import-helper', 'number() on first/last -> curveRange (binary64)', 'none', 'stored as body.edges[i].curveRange', 'import_brep'),
  'kernel/analytic.bend:periodic_vertex': A('import-helper', 'Maybe; Some.value pushed as Bend vertex', 'Maybe tag -> capability error', 'none', 'import_brep'),
  'kernel/analytic.bend:assemble': A('import-helper', 'kept as Bend value', 'none', 'none', 'import_brep'),
  'kernel/analytic.bend:with_seams': A('construct', 'decodeAnalytic -> binary64 body', 'none', 'validateAnalytic, identifyImport', 'import_brep'),
  'kernel/analytic.bend:curve_residual': A('validate', 'F32 number (approximate residual), compared in JS with the vertex tolerance', 'threshold -> fail()', 'none', 'measure (audit folded into every body-producing op)'),
  'kernel/analytic.bend:surface_residual': A('validate', 'F32 number (approximate residual), compared in JS with the vertex tolerance', 'threshold -> fail()', 'none', 'measure (audit folded into every body-producing op)'),
  'kernel/analytic.bend:cylinder_line_residual': A('validate', 'number() then threshold', 'threshold -> fail()', 'none', 'measure (audit folded into every body-producing op)'),
  'kernel/analytic.bend:frustum': A('construct', 'decodeAnalytic -> binary64 body', 'none', 'applyFrustumMeasures, validateAnalytic, identifyFrustum', 'frustum'),
  'kernel/analytic.bend:frustum_bounds': A('measure', 'coords() -> boundsMm', 'none', 'stored in body.validation', 'frustum'),
  'kernel/analytic.bend:frustum_volume_between': A('measure', 'number() -> volumeMm3', 'none', 'stored in body.validation', 'frustum'),
  'kernel/analytic.bend:transform': A('construct', 'decodeAnalytic -> binary64 body; input re-encoded by encodeAnalytic', 'none', 'measure carry-over, transformConstructionHistory, identifyTransform', 'transform'),
  'kernel/analytic.bend:point_transform': A('construct-helper', 'kept as Bend value for frustum measures', 'none', 'applyFrustumMeasures', 'transform'),
  'kernel/analytic.bend:curve_parameter': A('display', 'number()', 'none', 'display polyline', 'display_mesh'),
  'kernel/analytic.bend:curve_point': A('display', 'coords()', 'none', 'display polyline', 'display_mesh'),
  'kernel/precise.bend:dot': A('scalar-helper', 'number() then JS threshold', 'threshold -> fail()/unsupported()', 'none', 'frustum / import_brep (admission moves into Bend)'),
  'kernel/precise.bend:normalize': A('scalar-helper', 'kept as Bend value', 'none', 'none', 'frustum / import_brep'),
  'kernel/precise.bend:distance': A('scalar-helper', 'F32 number; JS 0.01 mm threshold and Math.max into vertexTolerancesMm', 'threshold -> unsupported()', 'vertexTolerancesMm', 'import_brep'),
  'kernel/precise.bend:frame': A('scalar-helper', 'kept as Bend value', 'none', 'none', 'frustum'),
  'kernel/precise.bend:lift': A('scalar-helper', 'kept as Bend value', 'none', 'none', 'frustum'),
  'kernel/precise.bend:add': A('scalar-helper', 'kept as Bend value', 'none', 'none', 'frustum / extrude_profile'),
  'kernel/precise.bend:sub': A('scalar-helper', 'kept as Bend value', 'none', 'none', 'frustum'),
  'kernel/precise.bend:cross': A('display', 'kept as Bend value', 'none', 'none', 'display_mesh'),
  'kernel/real.bend:max': A('scalar-helper', 'kept as Real in evidence; number() in constructionBudget', 'none', 'operation evidence', 'boolean'),
  'kernel/boolean.bend:coaxial': A('boolean', 'decodeAnalytic per part, number()/coords() for volume and bounds', 'supported / enclosed_void flags -> unsupported()', 'identifyBoolean, operation evidence', 'boolean'),
  'kernel/boolean.bend:rim_bounds': A('measure', 'coords()', 'none', 'transformAnalytic measure carry-over', 'transform'),
  'kernel/halfspace.bend:intersect': A('boolean', 'decodeHalfspace -> decodeAnalytic, number()/coords()', "result.$ Unresolved -> solid-intersection fallback branch (a designed dispatch, not a target fallback)", 'identifyBoolean, constructionBudget, evidence', 'boolean'),
  'kernel/halfspace.bend:bounds': A('measure', 'coords()', 'none', 'transformAnalytic measure carry-over', 'transform'),
  'kernel/halfspace.bend:clip': A('boolean', 'raw result', 'result.$', 'none', 'diagnostic only'),
  'kernel/ports/solid-intersection.bend:intersect': A('boolean', 'decodeNativeIntersection -> decodeAnalytic, number() for curveRange', 'result.$ !== Bodies -> unsupported()', 'planar_measures, identifyBoolean', 'boolean'),
  'kernel/ports/solid-intersection.bend:planar_measures': A('measure', 'number()/coords()', 'finite/positive checks -> fail()', 'stored in body.validation', 'boolean (measures returned with every body)'),
  'kernel/ports/curved-intersection.bend:intersect': A('boolean', 'decodeCurvedIntersection -> decodeAnalytic, number() for curveRange', 'result.$ !== Bodies -> unsupported()', 'curved.audit per component, identifyBoolean, evidence', 'boolean'),
  'kernel/ports/planar-boolean.bend:union': A('boolean', 'decodePlanarBoolean -> decodeAnalytic, number() for curveRange', 'result.$ !== Bodies -> unsupported(); provenance index checks -> fail()', 'curved.audit, planar_measures, identifyBoolean, evidence', 'boolean'),
  'kernel/ports/planar-boolean.bend:subtract': A('boolean', 'decodePlanarBoolean -> decodeAnalytic, number() for curveRange', 'result.$ !== Bodies -> unsupported(); provenance index checks -> fail()', 'curved.audit, planar_measures, identifyBoolean, evidence', 'boolean'),
  'kernel/ports/curved.bend:audit': A('validate', 'number() on required/allowance/resolution/volume', 'audit.valid -> fail()', 'construction record, exportToleranceMm', 'boolean (audit folded in)'),
  'kernel/prism-boolean.bend:boolean': A('boolean', 'src/prism-boolean.mjs: decodeAnalytic per part, number() for curveRange/volume/area/slab, coords() for bounds', 'answer.$ !== Built -> declined (PRISM_DECLINES[code]); the dispatch goes on to the hybrid', 'identifyBoolean, operation evidence, removedMaterial (construction.toolBoundaryKept)', 'boolean'),
  'kernel/pierce.bend:pierce': A('boolean', 'decodeAnalytic', 'result.$ !== Bored -> unsupported(decline code)', 'bore_depth, pierced_volume, identifyBoolean', 'boolean'),
  'kernel/pierce.bend:bore_depth': A('measure', 'kept as Real, number() for report', 'none', 'pierced_volume input', 'boolean'),
  'kernel/pierce.bend:pierced_volume': A('measure', 'number() -> volumeMm3; input volume re-encoded by real() from binary64', 'none', 'stored in body.validation', 'boolean'),
  'kernel/comparison.bend:coaxial': A('compare', 'number() per volume; axis_deviation published as raw Real object', 'supported -> unsupported()', 'report assembly', 'compare_coaxial'),
  'kernel/identity.bend:box_layout': A('identity', 'Bool', 'false -> unsupported()', 'none', 'identity (inside each body-producing op, or separate identify op)'),
  'kernel/identity.bend:box': A('identity', 'strings copied (decodeEntity)', 'count checks -> fail()', 'attach()', 'identity'),
  'kernel/identity.bend:extrusion': A('identity', 'strings copied', 'count checks -> fail()', 'attach()', 'identity'),
  'kernel/identity.bend:frustum': A('identity', 'strings copied', 'count checks -> fail()', 'attach()', 'identity'),
  'kernel/identity.bend:named_extrusion': A('identity', 'strings copied', 'count checks -> fail()', 'attach(), per-entity source records', 'identity'),
  'kernel/identity.bend:unattributed': A('identity', 'strings copied', 'count checks -> fail()', 'attach()', 'identity'),
  'kernel/identity.bend:transform': A('identity', 'strings copied; input IdentitySet re-encoded from JS', 'count checks -> fail()', 'attach(), lineage history', 'identity'),
  'kernel/identity.bend:boolean_result': A('identity', 'strings copied', 'count checks -> fail()', 'attach(), lineage history', 'identity'),
  'kernel/identity.bend:from_source': A('identity', 'kept as Bend value', 'none', 'attach()', 'identity'),
  'kernel/identity.bend:parent': A('identity', 'kept as Bend value', 'none', 'none', 'identity'),
  'kernel/identity.bend:created': A('identity', 'kept as Bend value', 'none', 'attach()', 'identity'),
  'kernel/face-classification.bend:linear_edge': A('adapt', 'Maybe; Some.value kept as Bend Edge', 'None -> null solid -> fail()', 'none', 'removed: polyhedral->analytic conversion moves into Bend'),
  'kernel/face-classification.bend:max_budget': A('adapt', 'kept as Real', 'none', 'none', 'removed: source budget is part of the resident Body'),
  'kernel/face-classification.bend:endpoint_error': A('display', 'number()', 'threshold', 'none', 'display_mesh'),
  'kernel/step-cylinder-pcurves.bend:linear_edge': A('adapt', 'Maybe (same contract as face-classification)', 'None -> null solid', 'none', 'removed (as face-classification)'),
  'kernel/step-cylinder-pcurves.bend:max_budget': A('adapt', 'kept as Real', 'none', 'none', 'removed (as face-classification)'),
  'kernel/step-cylinder-pcurves.bend:for_cylinders_domains': A('export', 'decodeCylinderPCurves: number() on every knot/pole/bound', 'result.$ Resolved', 'STEP B_SPLINE text (host)', 'step_pcurves'),
  'kernel/step-pcurves.bend:for_edge_domains': A('export', 'decodePCurve: number()', 'status Resolved -> unsupported()', 'STEP text', 'step_pcurves'),
  'kernel/step-pcurves.bend:cylinder_round': A('export', 'decodePCurve: number()', 'status', 'STEP text', 'step_pcurves'),
  'kernel/step-pcurves.bend:sphere_frame_kept': A('export', 'Bool (src/step-pcurves.mjs sphereFrameKept)', 'True -> the face keeps its own placement', 'STEP text', 'step_pcurves'),
  'kernel/step-pcurves.bend:sphere_frame': A('export', 'number() on origin/axis/x/radius; the Bend frame is kept for later calls', 'none', 'STEP SPHERICAL_SURFACE placement', 'step_pcurves'),
  'kernel/step-pcurves.bend:sphere_needs_pcurve': A('export', 'Bool (src/step-pcurves.mjs sphereNeedsPCurve)', 'False -> no parameter curve written', 'STEP text', 'step_pcurves'),
  'kernel/step-pcurves.bend:sphere_circle': A('export', 'decodePCurve: number()', 'status Resolved -> PCURVE written, else none (reader builds its own)', 'STEP text', 'step_pcurves'),
  'kernel/step-pcurves.bend:sphere_face_frame': A('export', 'Bool kept + number() on origin/axis/x/radius; the Bend frame is kept for later calls', 'kept -> the face keeps its own placement', 'STEP SPHERICAL_SURFACE placement', 'step_pcurves'),
  'kernel/step-pcurves.bend:cylinder_lines_only': A('export', 'Bool (src/step-pcurves.mjs cylinderLinesOnly)', 'True -> an unresolved cylinder plan writes no parameter curves, else unsupported()', 'STEP text', 'step_pcurves'),
  'kernel/sketch-lines.bend:solve': A('sketch', 'points copied as F32 numbers, uses copied; whole result kept as native profile', 'result.$ !== Solved -> unsupported()', 'lineProfileSource; later extrude_polygon via F32 points', 'sketch_lines'),
  'kernel/sketch-arcs.bend:solve': A('sketch', 'kept as Bend value (native profile)', 'result.$ !== Solved -> unsupported()', 'arcProfileSource', 'sketch_arcs'),
  'kernel/sketch-arcs.bend:extrude': A('construct', 'decodeSketchArcExtrusion -> decodeAnalytic, number() for domains/audit', 'result.$ !== Extruded -> unsupported(); audit.valid -> Error', 'identifySketchArcExtrusion', 'extrude_profile'),
  'kernel/revolve.bend:revolve': A('construct', 'decodeAnalytic', 'result.$ !== Swept -> unsupported(refusal code)', 'volume', 'revolve'),
  'kernel/revolve.bend:volume': A('measure', 'number()', 'none', 'stored in body.validation', 'revolve'),
  'kernel/revolve.bend:sweep': A('construct', 'sweepInBend: decodeAnalytic; number() on the exact volume', 'result.$ !== Built -> unsupported(SWEEP_REFUSALS[reason]); library.mjs retries a code-4 (clockwise) profile reversed', 'curveRange of arcs from analytic.curve_parameter (library.mjs revolveEdgeDomains)', 'revolve'),
  'kernel/volume.bend:volume': A('measure', 'number() on volume and bound (src/volume.mjs integrateVolume, integrateMeshVolume)', 'result.$ Refused -> unsupported(refusal code), or the labelled mesh estimate for a certified-mesh body', 'evVolume operation evidence, r20 manifest row (volume, bound, label); never stored in body.validation', 'measure'),
  'kernel/volume.bend:mesh_snap': A('measure', 'coords()/number() per point (src/hybrid-mesh.mjs snapMesh); the Bend point is kept for later calls', 'residual/sine/move thresholds decide which vertex moves; Value items (signed carrier values) give the boundary drift in the stated deviation', 'print mesh of a certified-mesh body (printMesh, r20-check)', 'measure'),
  'kernel/volume.bend:mesh_bound': A('measure', 'number() on bound and cosine per triangle (src/hybrid-mesh.mjs snapMesh)', 'bound < 0 -> snapping refused by name; bound > deviation -> bisection', 'stated deviation of the snapped print mesh', 'measure'),
  'kernel/tessellate.bend:chord_count': A('print', 'U32', 'none', 'within check', 'print_mesh'),
  'kernel/tessellate.bend:within': A('print', 'Bool', 'false -> capability error', 'none', 'print_mesh'),
  'kernel/tessellate.bend:sagitta': A('print', 'number()', 'none', 'manifest achieved deviation', 'print_mesh'),
  'kernel/tessellate.bend:arc_sagitta': A('print', 'number()', 'none', 'manifest achieved deviation', 'print_mesh'),
  'kernel/tessellate.bend:grid_count': A('print', 'U32', 'none', 'grid_within check', 'print_mesh'),
  'kernel/tessellate.bend:grid_within': A('print', 'Bool', 'false -> capability error', 'none', 'print_mesh'),
  'kernel/tessellate.bend:grid_bound': A('print', 'number()', 'none', 'manifest achieved deviation', 'print_mesh'),
  'kernel/tessellate.bend:angle_of': A('print', 'number()', 'none', 'arc interval of a circle edge', 'print_mesh'),
  'kernel/tessellate.bend:arc_interior': A('print', 'coords() per arc sample', 'none', 'STL triangles (host)', 'print_mesh'),
  'kernel/tessellate.bend:row_interior': A('print', 'coords() per row sample', 'none', 'STL triangles (host)', 'print_mesh'),
  'kernel/display.bend:surface_point': A('display', 'coords()', 'none', 'display mesh', 'display_mesh'),
  'kernel/display.bend:surface_normal': A('display', 'coords()', 'none', 'display mesh', 'display_mesh'),
  'kernel/display.bend:cylinder_coordinates': A('display', 'coords()', 'none', 'display mesh', 'display_mesh'),
  'kernel/display.bend:cylinder_trim_coefficients': A('display', 'kept as Bend value', 'none', 'trim_height', 'display_mesh'),
  'kernel/display.bend:trim_height': A('display', 'number()', 'none', 'display mesh', 'display_mesh'),
  'kernel/curve-plane.bend:frame_valid': A('display', 'Bool', 'false -> fail()', 'none', 'display_mesh'),
  'kernel/cylinder-classification.bend:prepare_loops': A('display', 'kept as Bend value', "result.$ -> fail()", 'none', 'display_mesh'),
  'kernel/cylinder-classification.bend:flatten': A('display', 'kept as Bend value', 'none', 'none', 'display_mesh'),
  'kernel/cylinder-classification.bend:physical_edges': A('display', 'array() of Bend values', "result.$ -> fail()", 'none', 'display_mesh'),
  'kernel/cylinder-classification.bend:curve_incidence': A('display', 'number()', 'threshold', 'none', 'display_mesh'),
};

// Places where the host converts between Bend F32x2 words and binary64 JS
// numbers. `pattern` must occur exactly once in `file`; the scan records its
// current line. `direction`: 'decode' Bend -> JS, 'encode' JS -> Bend,
// 'refeed' a decoded value becomes a kernel input again (the chain break).
const P = (file, pattern, direction, effect) => ({ file, pattern, direction, effect });
const PRECISION_SITES = [
  P('src/real.mjs', 'export const number = value => value.hi + value.lo;', 'decode',
    'binary64 collapse of F32x2: exact only if lo lies within 5 binades below the last bit of hi (span <= 53 bits); e.g. hi=-1, lo=2.2438708385304134e-31 becomes -1 and 8 + 1.1368683094535245e-14 rounds to 8 + 6*2^-49'),
  P('src/real.mjs', 'export const coords = value => [number(value.x), number(value.y), number(value.z)];', 'decode', 'the same collapse per Vec3 component'),
  P('src/real.mjs', "  return { $: 'Real', hi, lo: Math.fround(value - hi) };", 'encode',
    're-split of a binary64 into hi = fround(v), lo = fround(v - hi); cannot restore the words the collapse dropped, and refuses |v| > 1e20 or F32 underflow'),
  P('src/kernel.mjs', "{ $: 'V3', x: Math.fround(x), y: Math.fround(y), z: Math.fround(z) }", 'encode',
    'F32 words for the kernel modules that still take them; since the W2 re-baseline the polyhedral path no longer uses it (see decodePrism / transformInBend). Bend backends only: WONKY_BACKEND=rust sends the binary64 (wire v2)'),
  P('src/kernel.mjs', 'const decoded = value => preciseCoords(value).map(x => x + 0);', 'decode',
    'decodePrism: every F32x2 prism vertex and face frame collapsed to binary64 (at most half a binary64 ulp, docs/polygon-prism.md); -0 written as +0'),
  P('src/kernel.mjs', "$: 'Solid', vertices: list(body.vertices.map(preciseVector)),", 'refeed',
    'transformInBend: the decoded polyhedral body re-split by real() before polygonPrism.transform'),
  P('src/identity.mjs', "Math.fround(x), y: Math.fround(y), z: 0", 'encode', 'box_layout test on F32-rounded profile corners'),
  P('src/analytic.mjs', "key === '$' ? value.toLowerCase() : value?.$ === 'V3' ? coords(value) : number(value)", 'decode', 'decodeGeometry: every curve/surface parameter collapsed to binary64'),
  P('src/analytic.mjs', "id, geometry: 'analytic', precision: 'F32x2', vertices: array(solid.vertices).map(coords),", 'decode', 'decodeAnalytic: every vertex collapsed to binary64 (the body the interpreter keeps)'),
  P('src/analytic.mjs', "key === 'type' ? value[0].toUpperCase() + value.slice(1) : Array.isArray(value) ? vector(value) : real(value)", 'refeed', 'encodeGeometry: decoded parameters re-split into Real'),
  P('src/analytic.mjs', "return { $: 'Solid', vertices: list(body.vertices.map(vector)),", 'refeed', 'encodeAnalytic: decoded vertices re-split; the cause of nativeChainExact:false (first Boolean result -> second Boolean input)'),
  P('src/analytic.mjs', 'kernel.analytic.point_transform(vector(p.bottom), rotation, vector(offset))', 'refeed', 'frustum primitive (stored as binary64) re-encoded for transformed measures'),
  P('src/analytic.mjs', 'const vertices = list(result.vertices.map(vector)), first = vector(result.vertices[0]);', 'refeed', 'transformed planar body re-encoded for halfspace.bounds'),
  P('src/analytic.mjs', 'const residual = kernel.analytic.curve_residual(encodeGeometry(e.curve), vector(vertices[index]));', 'refeed', 'validateAnalytic re-encodes decoded geometry per vertex (validation of the lossy copy, not of the kernel result)'),
  P('src/face-classification.mjs', "? { $: 'Interval', first: real(value[0]), last: real(value[1]) }", 'refeed', 'curveRange (binary64 from number()) re-split into a DomainChoice interval'),
  P('src/face-classification.mjs', 'const vertices = list(body.vertices.map(vector));', 'refeed', 'polyhedralSolid: F32 vertices lifted into Real (exact for F32 inputs)'),
  P('src/face-classification.mjs', 'classifier.max_budget(list((body.vertexTolerancesMm ?? []).map(real)), real(options.inputTolerance ?? 0));', 'refeed', 'vertex tolerances and inputTolerance re-split'),
  P('src/construction-history.mjs', "return { schema: 'wonky-construction-budget/1', ceilingMm: number(nativeCeiling), nativeCeiling: structuredClone(nativeCeiling) };", 'decode',
    'the one deliberate exact path: the construction budget keeps the native Real words next to its binary64 display value'),
  P('src/intersections.mjs', "case 'cylinder': return { $: 'Cylinder', origin, axis: vector(surface.axis), x, radius: real(surface.radius) };", 'refeed', 'intersectionSurface: decoded surface re-encoded for polyhedral classification input'),
  P('src/boolean.mjs', 'body.validation.volumeMm3 = number(kernel.pierce.pierced_volume(real(a.validation.volumeMm3), radius, depth));', 'refeed', 'target volume (binary64) re-encoded as the pierce volume base'),
  P('src/boolean.mjs', "const axis = vector(span.map(v => v / length)), radius = real(tool.r0);", 'refeed', 'pierce axis normalised in binary64 JS and re-encoded; tool radius from the decoded primitive'),
  P('src/boolean.mjs', 'const result = kernel.boolean.coaxial(vector(first.bottom), vector(first.top), real(first.r0),', 'refeed', 'coaxial Boolean inputs come from the decoded frustum primitive'),
  P('src/planar-boolean.mjs', 'const range = [number(choice.domain.first), number(choice.domain.last)];', 'decode', 'native line intervals collapsed into curveRange'),
  P('src/sketch-arcs.mjs', "body.edges[index].curveRange = [number(choice.domain.first), number(choice.domain.last)];", 'decode', 'native line/arc intervals collapsed into curveRange'),
  P('src/solid-intersection.mjs', "if (choice.$ === 'GivenDomain' && choice.domain.$ === 'Interval') body.edges[i].curveRange = [number(choice.domain.first), number(choice.domain.last)];", 'decode', 'intersection intervals collapsed'),
  P('src/curved-intersection.mjs', 'edge.curveRange = [number(choice.domain.first), number(choice.domain.last)];', 'decode', 'curved intersection intervals collapsed'),
  P('src/step-pcurves.mjs', "? { $: 'GivenDomain', domain: { $: 'Interval', first: real(edge.curveRange[0]), last: real(edge.curveRange[1]) } }", 'refeed', 'STEP export re-encodes decoded body and ranges'),
  P('src/step-cylinder-pcurves.mjs', 'domains: ranges, inputTolerance: inputTolerance ?? bodyOrSolid.construction?.sourceBudgetMm ?? 0,', 'refeed', 'STEP export re-encodes the decoded body; source budget via its binary64 display value'),
  P('src/comparison.mjs', 'const c = kernel.comparison.coaxial(vector(a.bottom), vector(a.top), real(a.r0), vector(b.bottom), vector(b.top), real(b.r0), real(toleranceMm));', 'refeed', 'comparison inputs from decoded primitives'),
];

function locate(site) {
  const lines = readFileSync(join(projectRoot, site.file), 'utf8').split('\n');
  const found = lines.flatMap((line, i) => line.includes(site.pattern) ? [i + 1] : []);
  if (found.length !== 1) scanError(`precision site pattern occurs ${found.length} times in ${site.file}: ${site.pattern}`);
  return { file: site.file, line: found[0], direction: site.direction, effect: site.effect, code: site.pattern.trim() };
}

// ------------------------------------------------------------ proposed API

// The narrow "extension module" surface this map argues for. Signatures are
// Bend-style sketches for kernel/service (not yet written); `Body` and
// `Profile` are resident native values addressed by U32 handles, `View` is
// the exact wire image of a body the host decodes for queries and export.
// Every production entry above must map (its `api` annotation) onto one of
// these operations or be marked removed; the scan checks that.
const OP = (name, signature, reachedFrom, absorbs, crosses, notes) => ({ name, signature, reachedFrom, absorbs, crosses, notes });
const PROPOSED_API = [
  OP('extrude_polygon', 'extrude_polygon(points: List<GE.Vec3>, origin: GE.Vec3, normal: GE.Vec3, x: GE.Vec3, delta: GE.Vec3, offset: GE.Vec3, box: Bool) -> Built',
    ['FeatureScript opExtrude (rectangle/polyline/line-sketch profile)', 'FeatureScript fCuboid', "Python request 'box'"],
    ['src/kernel.mjs extrudeInBend (profileRing.simplify, polygonPrism.extrude)', 'identity.box_layout admission'],
    'in: F32x2 words (points and plane, exactly what src/real.mjs vector() sends today); out: handle + View (F32x2 polyhedral solid, kept indices, merge record)',
    'F32x2 polygon prism with its incidence audit (docs/polygon-prism.md); host keeps validatePolygon/signedArea orientation (FeatureScript input rules)'),
  OP('frustum', 'frustum(first: Circle, second: Maybe<Circle>, delta: Maybe<G.Vec3>, offset: G.Vec3) -> Built   # Circle{origin, normal, x: G.Vec3, center_x, center_y, radius: R.Real}',
    ['FeatureScript opExtrude (circle profile)', 'FeatureScript opLoft', "Python request 'cylinder'"],
    ['src/analytic.mjs circularFrustumInBend (precise.frame/lift/add/sub/dot/normalize, height and coaxiality admission)', 'applyFrustumMeasures (frustum_bounds, frustum_volume_between)', 'validateAnalytic residual calls'],
    'in: Real words; out: handle + View (+ Frustum primitive kept native for later coaxial/pierce/compare)',
    'the 1e-10 height and 1 - 1e-6 coaxiality thresholds move into Bend with the same values'),
  OP('revolve', 'revolve(profile: List<RV.Node>, turn: RV.Turn, tolerance: R.Real, origin: G.Vec3, axis: G.Vec3, x: G.Vec3) -> Built{solid, volume} | Declined{reason: U32}',
    ['FeatureScript opRevolve (line/arc, polyline, rectangle or circle profile)'],
    ['src/analytic.mjs sweepInBend (decodeAnalytic, validateAnalytic residual calls)', 'src/library.mjs revolveEdgeDomains (analytic.curve_parameter per arc edge)'],
    'in: Real words (profile nodes in (r, h) and the frame); out: handle + View (arc domains included)',
    'exact Green/Pappus volume in Bend; the host keeps the (r, h) mapping, snapping, winding retry and refusal messages'),
  OP('sketch_lines', 'sketch_lines(segments: List<SL.Segment>) -> Solved{profile: Handle, points: List<GE.Vec3>, uses: List<SL.Use>} | Refused{reason}',
    ['FeatureScript skSolve (line segments)'], ['this.kernel.sketchLines.solve'], 'in: SourcePoint words + Real values/remainders exactly as today; out: profile handle + points/uses for lineProfileSource', ''),
  OP('sketch_arcs', 'sketch_arcs(entities: List<SA.Entity>) -> Solved{profile: Handle, view: SA.Profile} | Refused{reason}',
    ['FeatureScript skSolve (line/arc)'], ['src/sketch-arcs.mjs solveSketchArcs'], 'in: SourcePoint + Real words; out: profile handle + native profile view', ''),
  OP('extrude_profile', 'extrude_profile(profile: Handle, origin: G.Vec3, normal: G.Vec3, x: G.Vec3, delta: G.Vec3, offset: G.Vec3) -> Built',
    ['FeatureScript opExtrude (line/arc profile)'], ['src/sketch-arcs.mjs extrudeSketchArcs + decodeSketchArcExtrusion checks', 'precise.add of the start offset'],
    'in: handle + Real words; out: handle + View (domains, audit, depth, volume)', ''),
  OP('transform', 'transform(body: Handle, rotation: G.Rotation, offset: G.Vec3) -> Built',
    ['FeatureScript opPattern', "Python request 'translate'"],
    ['src/kernel.mjs transformInBend', 'src/analytic.mjs transformAnalytic incl. measure carry-over (point_transform, rim_bounds, halfspace.bounds)'],
    'in: handle + rotation/offset (Real words; a polyhedral body goes through polygonPrism.transform with its incidence audit); out: handle + View', 'removes the encodeAnalytic re-split of the input body'),
  OP('boolean', 'boolean(a: Handle, b: Handle, op: U32, policy: CI.Policy, tolerance: I.Tolerance) -> Booleaned{bodies: List<Built>, evidence: Evidence} | Refused{method: U32, code: U32, stage: U32, detail: U32, evidence: Evidence}',
    ['FeatureScript opBoolean', "Python request 'boolean'", 'wonky-compare --geometry'],
    ['src/boolean.mjs booleanInBend branch selection (primitive, surface/curve families, curveRange, construction budget)', 'classificationInput (linear_edge, max_budget, domainChoice, encodeAnalytic)',
      'decodePlanarBoolean / decodeCurvedIntersection / decodeNativeIntersection / decodeHalfspace checks', 'curved.audit, planar_measures, pierce bore_depth/pierced_volume, real.max'],
    'in: two handles + policy + tolerance (about 10 words instead of 892 to 1,284 words of re-encoded operands); out: handles + Views + evidence (stats, steps, audits, source budget as Real words)',
    'the host keeps decline-code -> message tables and operation-evidence JSON; it no longer reads decoded geometry to pick a branch'),
  OP('import_brep', 'import_brep(source: ImportBody) -> Built{body, view, recovered: List<U32>, max_disagreement: R.Real} | Refused{code, entity: U32}',
    ['frozen module instantiation (src/modules.mjs, lazy per part)'],
    ['src/analytic.mjs importOnshapeBody: every analytic.* constructor, residual and periodic-seam call, precise.distance tolerance accumulation, with_seams/assemble'],
    'in: ImportBody (vertices, surfaces, curves, sample points, loops; Real words produced by the same mm scaling as today); out: handle + View + provenance tolerances',
    'r10b: 18,604 fine-grained calls in one run collapse to one call per imported part'),
  OP('measure', 'measure(body: Handle) -> Measures{volume: Maybe<R.Real>, bounds: Maybe<A.Bounds>, audit: V.Audit}',
    ['every body-producing op returns it inline; evVolume/evBox3d read it from the View'],
    ['src/analytic.mjs validateAnalytic kernel residual calls (curve_residual, surface_residual, cylinder_line_residual)'],
    'out: Real words (volume/bounds) plus the audit',
    'host keeps the pure topology checks of validateSolid/validateAnalytic as a second, independent check on the decoded View'),
  OP('view', 'view(body: Handle) -> View   # View{solid: A.Solid | T.Solid, domains: List<F.DomainChoice>, budget: R.Real, measures: Measures, provenance: Provenance}',
    ['queries (evaluateQuery, qOwnedByBody, evLine, evBox3d, evVolume), brep.json, STEP/STL/HTML writers'],
    ['src/analytic.mjs decodeAnalytic and every per-adapter curveRange/measure decode'],
    'out: exact words; the host decodes to binary64 for display/export only and never re-encodes them',
    'returned inline by every body-producing op; a separate call exists for lazy decoding'),
  OP('identity', 'identify(body: Handle, kind: U32, namespace: String, operation: String, occurrence: String, revision: String, extra: IdentityArgs) -> E.IdentitySet',
    ['after every body-producing op (identifyExtrusion/Frustum/SketchArcExtrusion/Transform/Boolean/Import)'],
    ['kernel.identity.* calls in src/identity.mjs'],
    'in/out: Strings (1 word per code point today); identity.transform moved 142,741 words in and 190,974 words out in one captured call',
    'open: keep identity host-side on the JS reference, fold it into the body-producing ops with a native revision hash, or pack strings (4 bytes/word) first'),
  OP('step_pcurves', 'step_pcurves(body: Handle, budget: R.Real) -> Charts{full_band: List<PCurve>, cylinders: SC.Result}',
    ['toStep (src/exporters.mjs)'], ['fullBandPCurve, cylinderPCurves (re-encode of the decoded body and ranges)'],
    'in: handle; out: pcurve knots/poles as Real words', ''),
  OP('print_mesh', 'print_mesh(body: Handle, deviation: R.Real) -> Mesh{triangles: List<G.Vec3>, achieved: R.Real, chords: List<U32>}',
    ['wonky --format print (src/print-mesh.mjs)'], ['tessellate.chord_count/within/sagitta/arc_sagitta per circle and arc, grid_count/grid_within/grid_bound per sphere or torus face, angle_of/arc_interior/row_interior per edge and row'], 'in: handle; out: triangle soup', 'src/print-mesh.mjs is owned by the Boolean bake-off; the op boundary is only proposed here'),
  OP('display_mesh', 'display_mesh(body: Handle, tolerance: R.Real) -> DisplayMesh',
    ['wonky-view review scene (src/review-scene.mjs, src/display-cylinder.mjs)'],
    ['display.*, analytic.curve_point/curve_parameter, precise.*, cylinder-classification.prepare_loops/flatten/physical_edges/curve_incidence, curve-plane.frame_valid, face-classification.endpoint_error'],
    'in: handle; out: display triangles and polylines', 'viewer only; may stay on the JS reference backend'),
  OP('compare_coaxial', 'compare_coaxial(a: Handle, b: Handle, tolerance: R.Real) -> CO.CylinderComparison',
    ['wonky-compare (src/comparison.mjs)'], ['comparison.coaxial on decoded primitives'], 'in: two handles; out: comparison record', ''),
  OP('release', 'release(handles: List<U32>) -> Unit', ['end of build()/buildPython()'], [], 'in: handle list', 'explicit lifetime; handles never outlive their session'),
];
const API_NAMES = new Set(PROPOSED_API.map(op => op.name));

// ------------------------------------------------------------ profile merge

function profileData() {
  const dir = join(projectRoot, 'out/native-bridge/profile/calls');
  if (!existsSync(dir)) return { runs: [], entries: new Map() };
  const entries = new Map(), runs = [];
  for (const file of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
    const data = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    runs.push({ run: file.replace(/\.json$/, ''), exitCode: data.exitCode, calls: data.totals?.calls ?? null, kernelMs: data.totals?.ms ?? null });
    for (const e of data.entries) {
      const row = entries.get(e.name) ?? { calls: 0, inclusiveMs: 0, runs: [], callers: {} };
      row.calls += e.calls; row.inclusiveMs += e.ms; row.runs.push(file.replace(/\.json$/, ''));
      for (const [k, v] of Object.entries(e.callers ?? {})) row.callers[k] = (row.callers[k] ?? 0) + v;
      entries.set(e.name, row);
    }
  }
  return { runs, entries };
}

// ------------------------------------------------------------ main

export function scan() {
  const srcFiles = readdirSync(join(projectRoot, 'src')).filter(f => f.endsWith('.mjs')).map(f => `src/${f}`).sort();
  const binFiles = readdirSync(join(projectRoot, 'bin')).filter(f => f.endsWith('.mjs')).map(f => `bin/${f}`).sort();
  const reachable = importGraph([...binFiles, 'src/index.mjs']);
  for (const file of Object.keys(RECEIVERS)) if (!srcFiles.includes(file)) scanError(`receiver table names missing file ${file}`);
  const hits = scanCalls(srcFiles);
  const used = usedExports(reachable);
  const profile = profileData();
  const entries = new Map(), unresolved = [];
  for (const { names, ...site } of hits) {
    let matched = 0;
    for (const [moduleFile, name] of site.modules.flatMap(m => names.map(n => [m, n]))) {
      const hit = { ...site, name };
      const found = resolveDef(moduleFile, name);
      if (!found) continue;
      matched++;
      const defModule = relative(kernelRoot, found.module.file);
      const key = `kernel/${defModule}:${found.def.name}`;
      let entry = entries.get(key);
      if (!entry) {
        const params = found.def.params.map(p => ({ name: p.name, mode: p.mode || null, ...typeInfo(found.module, p.type ?? '?') }));
        const result = typeInfo(found.module, found.def.ret);
        entry = { entry: key, def: `kernel/${defModule}:${found.def.line}`, signature: `${found.def.name}(${found.def.params.map(p => `${p.mode}${p.name}: ${p.type}`).join(', ')}) -> ${found.def.ret}`,
          params, result, exposedAs: new Set(), callSites: [], tiers: new Set() };
        entries.set(key, entry);
      }
      entry.exposedAs.add(`kernel/${moduleFile}${hit.name === found.def.name ? '' : ` as '${hit.name}'`}`);
      const tier = tierOf(hit.file, reachable, hit.function, used);
      entry.tiers.add(tier);
      entry.callSites.push({ file: hit.file, line: hit.line, function: hit.function, builtin: hit.builtin, tier,
        ...(hit.modules.length > 1 ? { polymorphicReceiver: hit.modules.map(m => `kernel/${m}`) } : {}), ...(hit.dynamic ? { computedMember: true } : {}) });
    }
    if (!matched) unresolved.push(`${site.file}:${site.line} ${names.join('|')} (${site.modules.join('|')})`);
  }
  if (unresolved.length) scanError(`call sites that resolve to no Bend def:\n  ${unresolved.join('\n  ')}`);

  const rows = [...entries.values()].map(entry => {
    const tiers = [...entry.tiers].sort();
    const production = tiers.some(t => t !== 'diagnostic');
    const moduleName = entry.entry.replace(/^kernel\//, '');
    const measured = [...entry.exposedAs].map(e => e.split(' as ')).map(([mod, as]) => `${mod}:${as ? as.slice(1, -1) : entry.entry.split(':')[1]}`)
      .map(name => profile.entries.get(name)).filter(Boolean);
    const merged = measured.length ? measured.reduce((a, b) => ({ calls: a.calls + b.calls, inclusiveMs: a.inclusiveMs + b.inclusiveMs,
      runs: [...new Set([...a.runs, ...b.runs])], callers: { ...a.callers, ...b.callers } })) : null;
    const annotation = ANNOTATIONS[entry.entry] ?? null;
    return { ...entry, module: moduleName.split(':')[0], exposedAs: [...entry.exposedAs].sort(), tiers, production,
      precision: [...new Set([...entry.params.flatMap(p => p.scalars), ...entry.result.scalars])].sort(),
      resultPrecision: entry.result.scalars.includes('Real(F32x2)') ? 'F32x2' : entry.result.scalars.includes('F32') ? 'F32' : entry.result.scalars.join('+') || 'none',
      synchronous: true, measured: merged ? { ...merged, inclusiveMs: Math.round(merged.inclusiveMs * 1000) / 1000 } : null,
      host: annotation };
  }).sort((a, b) => (b.production - a.production) || a.entry.localeCompare(b.entry));

  for (const row of rows.filter(r => r.production && r.host)) {
    const targets = row.host.api.split(/\s*\(/)[0].split('/').map(x => x.trim()).filter(Boolean);
    if (!(row.host.api.startsWith('removed') || targets.every(t => API_NAMES.has(t))))
      scanError(`production entry ${row.entry} maps to '${row.host.api}', which is not a proposed API operation`);
  }
  const missing = rows.filter(r => r.production && !r.host).map(r => r.entry);
  if (missing.length) scanError(`production entries without a host annotation: ${missing.join(', ')}`);
  const stale = Object.keys(ANNOTATIONS).filter(key => !entries.has(key));
  if (stale.length) scanError(`annotations for entries the scan no longer finds: ${stale.join(', ')}`);

  // ADTs every production entry needs on the wire, with their users.
  const adtUsers = new Map();
  for (const row of rows.filter(r => r.production)) {
    for (const t of [...row.params, row.result]) for (const adt of t.adts ?? []) {
      if (!adtUsers.has(adt)) adtUsers.set(adt, new Set());
      adtUsers.get(adt).add(row.entry);
    }
  }
  const adtRows = [...adtUsers].map(([label, users]) => {
    const [file, name] = label.split(':');
    const module = parseModule(join(kernelRoot, file)), type = module.types.get(name);
    const ref = resolveType(module, name);
    return { type: label, source: `kernel/${file}:${type.line}`, constructors: type.ctors.map((c, tag) => ({ tag, name: c.name, fields: c.fields.map(f => `${f.name}: ${f.type}`) })),
      tagged: type.ctors.length > 1, fixedWords: fixedWords(ref), users: [...users].sort() };
  }).sort((a, b) => b.users.length - a.users.length || a.type.localeCompare(b.type));
  const unsupportedTypes = rows.filter(r => r.production).flatMap(r => [...r.params, r.result].filter(t => t.wire !== 'ok').map(t => ({ entry: r.entry, type: t.type, reason: t.reason })));

  const loads = loadPaths(srcFiles);
  const modules = [...new Set(rows.map(r => r.module))].sort().map(module => ({
    module: `kernel/${module}`, loadedBy: loads.get(module) ?? [...new Set(rows.filter(r => r.module === module).flatMap(r => r.exposedAs))].map(via => ({ how: `re-exported through ${via.split(' as ')[0]} namespace`, where: via })), entries: rows.filter(r => r.module === module).map(r => r.entry.split(':')[1]),
    production: rows.some(r => r.module === module && r.production),
  }));
  const viaOther = [...loads.keys()].filter(m => !modules.some(x => x.module === `kernel/${m}`)).map(m => ({ module: `kernel/${m}`, loadedBy: loads.get(m), entries: [], production: false,
    note: 'loaded but no call site resolves to a def declared in this file (its entries are re-exports, or the module is only handed to another adapter)' }));

  const closureFile = join(projectRoot, 'out/native-bridge/wire-closure.json');
  const closureData = existsSync(closureFile) ? JSON.parse(readFileSync(closureFile, 'utf8')) : null;
  if (closureData) for (const row of rows) {
    const found = closureData.entries.find(e => e.entry === row.entry);
    if (!found || !found.samples.length) continue;
    row.wire = { samples: found.samples.length, allExact: found.samples.every(s => s.ok),
      maxRequestWords: Math.max(0, ...found.samples.map(s => s.requestWords ?? 0)), maxResultWords: Math.max(0, ...found.samples.map(s => s.result?.words ?? 0)),
      dispatch: [...new Set(found.samples.map(s => s.dispatch?.startsWith('skipped') ? 'skipped' : s.dispatch))],
      resultRealsChangedByHostRoundTrip: found.samples.reduce((n, s) => n + (s.result?.hostRoundTrip?.changed ?? 0) + (s.result?.hostRoundTrip?.refused ?? 0), 0) };
  }
  const surveyFile = join(projectRoot, 'out/native-bridge/wire-survey.json');
  const surveyData = existsSync(surveyFile) ? JSON.parse(readFileSync(surveyFile, 'utf8')) : null;
  const emitFile = join(projectRoot, 'out/native-bridge/wire-native-emit.json');
  const emitData = existsSync(emitFile) ? JSON.parse(readFileSync(emitFile, 'utf8')) : null;
  const proposed = PROPOSED_API.map(op => ({ ...op, currentEntries: rows.filter(r => r.production && r.host && r.host.api.split(/\s*\(/)[0].split('/').map(x => x.trim()).includes(op.name)).map(r => r.entry) }));

  return {
    schema: 'wonky-native-bridge-surface/1', generator: 'scripts/native-bridge/surface-scan.mjs', generatedAt: new Date().toISOString(),
    sources: { src: srcFiles.length, bin: binFiles.length, productionReachable: [...reachable.keys()].filter(f => f.startsWith('src/')).sort() },
    counts: {
      entries: rows.length, productionEntries: rows.filter(r => r.production).length, diagnosticOnlyEntries: rows.filter(r => !r.production).length,
      callSites: rows.reduce((n, r) => n + r.callSites.length, 0), productionCallSites: rows.reduce((n, r) => n + r.callSites.filter(c => c.tier !== 'diagnostic').length, 0),
      modules: modules.length, productionModules: modules.filter(m => m.production).length,
      measuredEntries: rows.filter(r => r.measured).length, productionAdts: adtRows.length, unsupportedProductionTypes: unsupportedTypes.length,
      byRole: Object.fromEntries(Object.entries(rows.filter(r => r.host).reduce((acc, r) => ({ ...acc, [r.host.role]: (acc[r.host.role] ?? 0) + 1 }), {})).sort()),
    },
    profileRuns: profile.runs,
    modules: [...modules, ...viaOther],
    entries: rows,
    wireAdts: adtRows,
    unsupportedProductionTypes: unsupportedTypes,
    precisionSites: PRECISION_SITES.map(locate),
    proposedApi: proposed,
    removedEntries: rows.filter(r => r.production && r.host?.api.startsWith('removed')).map(r => ({ entry: r.entry, why: r.host.api })),
    wireFormat: {
      word: 'little-endian U32', U32: '1 word', F32: '1 word, IEEE-754 bits (F32.bits): -0, subnormals and NaN payloads kept', Bool: '1 word, 0 or 1 (else decode error)',
      String: 'code point count, then 1 word per Char code (<= 0x10FFFF)', Real: '2 words: bits(hi), bits(lo); never a binary64',
      adt: 'constructor tag word when the type has more than one constructor, then fields in declaration order', List: 'count word, then elements', Maybe: 'tag word (0 None, 1 Some), then the value',
      request: 'op id selects the def; arguments in parameter order', response: 'status word (0 ok, 1 malformed request, 2 unknown op) then the result',
      refused: 'Nat, Cmp, Char outside String, closures, arrays, generics, recursive types (the generator fails loudly; none occur on the production surface)',
    },
    generatorEvidence: {
      survey: surveyData ? { types: `${surveyData.types.codable}/${surveyData.types.total}`, defs: `${surveyData.defs.codable}/${surveyData.defs.total}`,
        refusedTypes: surveyData.types.refused, refusedDefsBy: Object.fromEntries(Object.entries(surveyData.defs.refusedBy).map(([k, v]) => [k, v.length])) } : null,
      closure: closureData ? { generation: closureData.generation, compile: closureData.compile, replay: { ...closureData.replay }, workloads: closureData.workloads.length,
        load: [closureData.loadBefore, closureData.loadAfter] } : null,
      nativeEmission: emitData ? { emitter: emitData.emitter, bend: emitData.bend, results: emitData.results.map(({ case: name, ok, ms, cBytes, error, loadBefore }) => ({ case: name, ok, ms, cBytes, error, loadBefore })) } : null,
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const i = process.argv.indexOf('--out');
  const out = resolve(projectRoot, i > 0 ? process.argv[i + 1] : 'src/native/surface.json');
  const result = scan();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(result, null, 1) + '\n');
  console.log(JSON.stringify({ out: rel(out), ...result.counts }));
}
