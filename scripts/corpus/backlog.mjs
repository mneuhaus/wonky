// Ranked fix backlog for the corpus (docs/corpus-triage.md).
//
// A part usually needs several fixes, and the corpus run records only the
// first blocker per unit. This script therefore builds, per unique file, the
// SET of fixes it needs, from three kinds of evidence:
//
//   1. the first blocker of every unit (out/corpus/runs.jsonl, clusters as in
//      summarize.mjs);
//   2. the next blockers that the cluster analyses measured with prototypes,
//      stubs or stand-ins (out/corpus/<cluster>/..., see SOURCES below);
//   3. static use of FeatureScript std functions and build123d names that
//      production does not implement (tmp/corpus/facts, py-api-surface tiers).
//
// Every file gets a confidence:
//   real  every unit builds today, or reached its end in a probe with REAL
//         geometry (a test-only prototype of the fix, e.g. the bake-off hybrid);
//   stub  every unit reached its end in some probe, but at least one needed a
//         stub or stand-in (geometry wrong there);
//   open  at least one unit's chain was never observed to its end, so the
//         fix set is a lower bound.
//
// Greedy ranking (families per effort): at each step, take the cheapest
// remaining fix bundle (a file's missing fixes) with the most newly building
// families per day, counted on the "estimated" track (real + stub files).
// When no bundle adds an estimated family, continue on the upper-bound track
// (open files too). Fixes that complete no family are appended, ordered by the
// number of first-blocker units they remove per day.
//
// Usage: node scripts/corpus/backlog.mjs [--label <name>] [--json <path>]
//   --label reads the first blockers of a labelled benchmark run
//   (out/corpus/bench/<name>/runs.jsonl) and writes .../backlog.json there.
//   The cluster probe data under out/corpus/ stay the same; re-run the
//   cluster probes when a fix moved many units.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, TMP_DIR, runPaths } from './lib.mjs';
import { loadRecords } from './clusters.mjs';

const args = process.argv.slice(2);
const label = args.includes('--label') ? args[args.indexOf('--label') + 1] : null;
const outPath = args.includes('--json') ? args[args.indexOf('--json') + 1] : join(runPaths(label).dir, 'backlog.json');
const read = p => JSON.parse(readFileSync(join(REPO, p), 'utf8'));
const readJsonl = p => existsSync(join(REPO, p)) ? readFileSync(join(REPO, p), 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l)) : [];

// ---------------------------------------------------------------- fix catalog
// days: S = 1, M = 3, L = 8, XL = 20 (engineering days, rough, for ranking only).
const DAYS = { XS: 0.5, S: 1, M: 3, L: 8, XL: 20 };
const FIXES = {
  P1: ['Parser: String-Token-Art ("function", "-"), try-Blöcke, for (k, v in map), \\u-Escape, catch ohne Bindung', 'fs-parser-syntax', 'S', 'frontend'],
  P2: ['Interpreter: Feature-Parameter-Defaults, Annotation nur "Default" auswerten, Bound-Spec-/Color-Typ-Tags', 'fs-interpreter-semantics', 'S', 'frontend'],
  P3: ['Std-Builtins, reine Werte (makeId, atan2, unitless, isInteger, coordSystem, toWorld, rotationAround, min/max, toString, ...)', 'fs-missing-builtin', 'S', 'frontend'],
  P4a: ['Std-Queries I (qEverything, qNothing, makeRobustQuery, qContainsPoint über Bend-Klassifikator)', 'fs-missing-builtin', 'S', 'frontend'],
  P4b: ['Std-Queries II, nicht analysiert (qGeometry, qNthElement, qClosestTo, qLargest, evPlane, evArea, ...)', 'fs-missing-builtin (Folgeblocker)', 'M', 'frontend'],
  P5: ['opTransform (starr, In-place-Record, Bend-Transform)', 'fs-missing-builtin', 'M', 'frontend'],
  P6: ['opRevolve D1 (volle Drehung, Polygonprofil) über revolveInBend', 'fs-missing-builtin', 'M', 'frontend'],
  P7: ['N-äres opBoolean, komponentenweise Union', 'boolean-capability F1', 'S', 'frontend'],
  P8: ['Modul-Loader Stufe 1: revisionsgebunden, Other-Document-Pfade, addInstance-Transform, createdBy', 'fs-module-import', 'S', 'frontend'],
  P9: ['Onshape-Capture Stufe 2 (Part-Studio-Snapshots für alle importierten Revisionen, Marcs Bridge)', 'fs-module-import / fs-needs-partstudio-input', 'M', 'Marc + tooling'],
  P10: ['evVolume/evBox3d über importierte und analytische Körper in Bend', 'fs-module-import Stufe 3', 'M', 'kernel'],
  P11: ['Feature-Studio-Quellimporte (NS::function, version "local")', 'fs-module-import Stufe 4', 'M', 'frontend'],
  P12: ['Part-Studio-Eingabe (partStudio-Manifest, modifizierbare importierte Teile, Provenienz)', 'fs-needs-partstudio-input', 'M', 'frontend'],
  P13: ['Python: Modellverzeichnis auf sys.path, --venv, Shim als Paket, Provenienz der Module', 'py-imports', 'S', 'frontend'],
  P14: ['build123d-Shim Stufe 1: vollständige, lazy Namenstabelle', 'py-api-surface', 'S', 'frontend'],
  P15: ['build123d-Shim Stufe 2: Part/Compound/Location/Plane, transform, Exporte als Outputs', 'py-api-surface', 'M', 'frontend'],
  P16: ['build123d-Shim Stufe 3: Skizzen, extrude/revolve, BuildPart/BuildSketch', 'py-api-surface', 'L', 'frontend'],
  P17: ['build123d-Selektoren (edges/faces/filter_by/sort_by)', 'py-api-surface (Tier Q)', 'M', 'frontend'],
  P18: ['Externe Geometrie/Pakete (import_step, bd_warehouse, cad_khana, OCP)', 'py-api-surface (Tier X)', 'XL', 'out of scope'],
  P19: ['fCylinder/fCone-Feature-Wrapper', 'Folgeblocker', 'S', 'frontend'],
  K1: ['F32x2-Polygonprisma + F32x2-Starrtransform, Pierce-Gate (ranged lines, null volume)', 'boolean-invalid-topology / kernel-sketch-and-ops / boolean-capability F4', 'M', 'kernel'],
  K2: ['Kollineare Profilpunkte exakt zusammenfassen (Bend, mit Provenienz)', 'kernel-sketch-and-ops', 'S', 'kernel'],
  K3: ['Loft Phase 1: gerader Loft zwischen gleichartigen Polygonen', 'kernel-sketch-and-ops', 'M', 'kernel'],
  K4: ['Loft Phase 1b: Linien + konzentrische Bögen (Kegelflächen), Print-Mesh für Bögen', 'kernel-sketch-and-ops', 'M', 'kernel'],
  K5: ['Loft Phase 2: verdrehte, Polygon-zu-Kreis- und Mehrschnitt-Lofts (B-Spline/bilinear)', 'kernel-sketch-and-ops', 'XL', 'kernel'],
  K6: ['Profil-Vertexlimit > 256', 'kernel-sketch-and-ops', 'S', 'kernel'],
  K7: ['Line/Arc-Skizze mit Kreislöchern', 'kernel-sketch-and-ops', 'M', 'kernel'],
  K8: ['Allgemeiner Boolean-Arm: Bake-off-Hybrid (corefine + recover) in Produktion', 'boolean-capability F2 / boolean-invalid-topology 2. Ebene', 'XL', 'kernel'],
  K9: ['recover-Lücken: achsparallele Zylinder, tangente Ecken, Tessellator für alle Körper', 'boolean-capability F2 (Voraussetzungen)', 'L', 'kernel'],
  K10: ['Exakte schnelle Arme: Pierce v2 + koaxiale Meridian-Anordnung', 'boolean-capability F3', 'M', 'kernel'],
  K12: ['opFillet/opChamfer (FS) bzw. fillet/chamfer (build123d)', 'nicht analysiert', 'XL', 'kernel'],
  K13: ['Text (skText, build123d Text) mit eingefrorener Schrift', 'nicht analysiert', 'XL', 'kernel'],
  K14: ['Weitere Operationen (opOffsetFace, opDeleteFace, opSplitPart, opSweep, skEllipse, offset, sweep, Sphere, ...)', 'nicht analysiert', 'XL', 'kernel'],
  K16: ['Line/Arc-Stöße: fast-tangente Fillets, exakt kollineare Nachbarlinien', 'fs-needs-partstudio-input §3.4', 'S', 'kernel'],
  K17: ['Spiegelungen in opPattern/opTransform (Bend)', 'fs-missing-builtin F', 'M', 'kernel'],
  SRC: ['Quellfehler in Marcs Datei (fehlende Einheit)', 'fs-interpreter-semantics (4 Units)', 'XS', 'Marc'],
};
const days = id => DAYS[FIXES[id][2]];

// Std names production does not implement -> fix.
const BUILTIN = {};
const put = (fix, names) => names.split(/\s+/).filter(Boolean).forEach(n => { BUILTIN[n] = fix; });
put('P3', 'makeId atan2 asin acos atan unitless isInteger isAngle isReal coordSystem toWorld fromWorld rotationAround min max toString concatenateArrays mergeMaps newId println reportFeatureInfo setVariable getVariable setAttribute buildFunction newSketch');
put('P4a', 'qEverything qNothing makeRobustQuery qContainsPoint');
put('P4b', 'qGeometry qNthElement qClosestTo qLargest qIntersection qAdjacent qCompressed qSplitBy qCoincidesWithPlane qEdgeConvexityTypeFilter evPlane evSurfaceDefinition evArea evLength evDistance evEdgeTangentLine evFaceTangentPlane evApproximateCentroid');
put('P5', 'opTransform');
put('P6', 'opRevolve');
put('P19', 'fCylinder fCone');
put('K12', 'opFillet opChamfer');
put('K13', 'skText');
put('K14', 'opOffsetFace opDeleteFace opMoveFace opThicken opSplitPart opSweep skEllipse');
const builtinFix = name => BUILTIN[name] ?? 'P4b';

// Message -> fixes. Order matters only for readability; all matches apply.
const RULES = [
  [/space quartic|does not traverse|tessellate|carriers are not concurrent|clearly oriented|corefine|off its exact curve|hybrid refused/, ['K8', 'K9']],
  [/Bend Real serialization|real\(null\)|pierce-after-copy|null volume/, ['K1']],
  [/InvalidTopology|boolean-invalid-topology|F32 operands|Plane frame is not orthonormal|Face vertices do not lie|cap-normal/, ['K1']],
  [/AmbiguousContact|stage 6|ResolutionLimit|input size|killed \(SIGKILL\)/, ['K1', 'K8']],
  [/NonNormalSweep/, ['K1']],
  [/general trimmed-face|boolean-capability|opBoolean supports|general-trim|coaxial|through hole|pierce-admission|opBoolean requires coaxial/, ['K8']],
  [/requires two tools|\bnary\b/, ['P7']],
  [/opLoft|loft profiles/, ['K3']],
  [/collinear/, ['K2']],
  [/3.256 vertices|max-vertices/, ['K6']],
  [/cannot mix entities|inner-loops/, ['K7']],
  [/SelfIntersectionOrTouch/, ['K16']],
  [/Unresolved Onshape module|module import/, ['P8', 'P9']],
  [/was not captured/, ['P9']],
  [/Ambiguous reference volume|ev\* over analytic|evVolume|evBox3d|Imported surface/, ['P10']],
  [/Expected a length with units|Feature precondition failed|conditions must be boolean|AngleBoundSpec|Expected Color|type tag|IntegerBoundSpec/, ['P2']],
  [/Incompatible units/, ['SRC']],
  [/Expected '\(', found|Expected ';', found|Unsupported expression|Unsupported string escape|catch without binding|catch-binding/, ['P1']],
  [/External geometry import|cad_khana|bd_warehouse|build_common|import_step|'OCP'/, ['P18']],
  [/must bind|no-result|python-no-result/, ['P15']],
  [/NameError/, ['P14']],
  [/opFillet|opChamfer/, ['K12']],
  [/skText/, ['K13']],
];
const PS_INPUT = /Derive|Use a copy|Copy the|Expected exactly|Expected one|model check \/ stand-in|empty all-bodies|fs-needs-partstudio-input/;
function fixesOf(message) {
  const m = String(message ?? '');
  const out = new Set();
  for (const [re, fx] of RULES) if (re.test(m)) fx.forEach(f => out.add(f));
  for (const re of [/'(\w+)' is not defined/, /builtin (\w+)/, /'(\w+)' missing/, /fs-missing-builtin \((\w+)\)/]) {
    const b = m.match(re); if (b) out.add(builtinFix(b[1]));
  }
  const b3d = m.match(/build123d\.(\w+(?:\.\w+)?)/); if (b3d) pyTierFix(b3d[1]).forEach(f => out.add(f));
  if (PS_INPUT.test(m)) { out.add('P12'); out.add('P9'); }
  const mod = m.match(/No module named '([\w]+)/); if (mod) out.add(['cad_khana', 'bd_warehouse', 'OCP', 'OCC', 'cadquery'].includes(mod[1]) ? 'P18' : 'P13');
  return out;
}
// Stub names used by the cluster probes -> the fix they stand in for.
const STUBS = {
  mixed: ['K7'], boolean: ['K8'], loft: ['K5'], loftplanar: ['K3'], frame: ['K1'], maxverts: ['K6'], collinear: ['K2'], pvol: ['K1'],
  'unitless-zero-in-length-vector': ['P3'], 'plate-volume-tolerance': ['P10'], 'volume-tolerance-0.01-to-2': ['P10'], 'catch-binding': ['P1'],
  qGeometry: ['P4b'], toString: ['P3'], lwCut: ['K8'],
};

// build123d tiers (py-api-surface) -> fixes.
const surface = read('out/corpus/py-api-surface/surface.json');
const TIER_OF = new Map();
for (const [tier, names] of Object.entries(surface.tiers)) for (const n of names) if (!TIER_OF.has(n)) TIER_OF.set(n, tier);
const C_FIX = n => /fillet|chamfer/.test(n) ? 'K12' : /Text|FontStyle/.test(n) ? 'K13' : /loft/.test(n) ? 'K5' : 'K14';
function pyTierFix(name) {
  const tier = TIER_OF.get(name) ?? TIER_OF.get('.' + name) ?? TIER_OF.get(name.split('.')[0]);
  return tier === 'S' ? ['P14'] : tier === 'A' ? ['P14', 'P15'] : tier === 'B' ? ['P14', 'P15', 'P16'] : tier === 'Q' ? ['P14', 'P17']
    : tier === 'C' ? ['P14', C_FIX(name)] : tier === 'X' ? ['P18'] : ['P14'];
}

// ---------------------------------------------------------------- population
const targets = read('out/corpus/targets.json');
const featuresOf = new Map(targets.files.map(f => [f.path, f.features ?? []]));
const unitKey = (path, feature) => (featuresOf.get(path)?.length > 1 && feature && feature !== '-' ? `${path}#${feature}` : path);
const { recs } = loadRecords({ runs: runPaths(label).runs });
const units = new Map(); // key -> { path, family, frontend, status, cluster, message, fixes:Set, ends:[] }
for (const r of recs) {
  const u = { key: r.key, path: r.path, family: `${r.frontend}:${r.family}`, frontend: r.frontend, status: r.status, cluster: r.cluster ?? null,
    message: r.rootMessage, fixes: new Set(), ends: [], evidence: [] };
  if (r.status === 'ok') u.ends.push('real');
  else addFirstBlocker(u, r);
  units.set(r.key, u);
}
function addFirstBlocker(u, r) {
  const c = r.cluster, m = r.rootMessage ?? '';
  fixesOf(m).forEach(f => u.fixes.add(f));
  if (c === 'fs-module-import') {
    u.fixes.add('P8'); u.fixes.add('P9');
    const ns = (m.match(/module '(\w+)'/) ?? [])[1];
    if (/version local/.test(m) || (ns && new RegExp(`${ns}::(?!build\\b)\\w+`).test(r.sourceLine ?? ''))) u.fixes.add('P11');
  }
  if (c === 'boolean-capability' && !u.fixes.has('P7')) u.fixes.add('K8');
  if (c === 'boolean-invalid-topology') u.fixes.add('K1');
  if (c === 'fs-needs-partstudio-input') { u.fixes.add('P12'); u.fixes.add('P9'); }
  if (c === 'fs-parser-syntax') u.fixes.add('P1');
  if (c === 'fs-interpreter-semantics' && !u.fixes.has('SRC')) u.fixes.add('P2');
  if (c === 'py-imports') u.fixes.add(/cad_khana|bd_warehouse/.test(m) ? 'P18' : 'P13');
  if (c === 'py-api-surface') u.fixes.add('P14');
  if (c === 'fs-headerless-include') u.fragment = true;
  if (c === 'other') u.notModel = true;
  u.evidence.push(`first: ${c}`);
}
const unit = (path, feature) => units.get(unitKey(path, feature)) ?? units.get(path);
const note = (u, src, message, end = null, stubs = []) => {
  if (!u) return;
  fixesOf(message).forEach(f => u.fixes.add(f));
  for (const s of stubs) (STUBS[s] ?? []).forEach(f => u.fixes.add(f));
  if (end) u.ends.push(end);
  u.evidence.push(`${src}: ${String(message ?? '').slice(0, 90)}${end ? ` [end:${end}]` : ''}`);
};

// ---------------------------------------------------------------- measured next blockers
const SOURCES = [];
// boolean-capability: fix ladder on stubbed geometry and the hybrid route on real geometry.
{
  const x = read('out/corpus/boolean-capability/files.json'); SOURCES.push('out/corpus/boolean-capability/files.json');
  for (const f of x.files) for (const cu of f.clusterUnits) {
    const u = unit(f.path, cu.feature);
    if (!u) continue;
    if (cu.subcause?.key === 'nary') u.fixes.add('P7');
    for (const [step, v] of Object.entries(cu.next)) {
      if (/^builds \(hybrid/.test(v)) note(u, `bool:${step}`, 'general trimmed-face', 'real');
      else if (/^builds \(stubbed/.test(v)) note(u, `bool:${step}`, 'general trimmed-face', 'stub');
      else note(u, `bool:${step}`, v.replace(/^builtin /, "builtin "));
    }
  }
}
// boolean-invalid-topology: F32x2 simulated, all Booleans stubbed.
{
  const x = read('out/corpus/boolean-invalid-topology/next-table.json'); SOURCES.push('out/corpus/boolean-invalid-topology/next-table.json');
  for (const r of x.unitsList) {
    const u = units.get(r.key) ?? unit(r.key.split('#')[0], r.feature);
    if (!u) continue;
    u.fixes.add('K1');
    for (const reason of Object.keys(r.planarReasons ?? {})) note(u, 'bit:planar', reason);
    if (r.stubbedCapability > 0) u.fixes.add('K8');
    note(u, 'bit:next', r.outcome, /reaches the end/.test(r.outcome) ? 'stub' : null);
  }
}
// kernel-sketch-and-ops: exact fixes emulated, deeper stubs.
{
  const x = read('out/corpus/cluster-kernel-sketch-and-ops.summary.json'); SOURCES.push('out/corpus/cluster-kernel-sketch-and-ops.summary.json');
  for (const r of x.perUnit) {
    const u = units.get(r.key) ?? unit(r.key.split('#')[0], r.key.split('#')[1]);
    if (!u) continue;
    if (r.cause === 'loft') {
      u.fixes.delete('K3');
      const kinds = new Set([r.firstLoft, ...(r.loftsAfterFix ?? [])].filter(Boolean));
      if (kinds.has('planar sides')) u.fixes.add('K3');
      if ([...kinds].some(k => k !== 'planar sides')) u.fixes.add('K5');
      if (!kinds.size) u.fixes.add('K3');
    }
    note(u, 'kso:next', r.next, r.next === 'OK' ? (Object.keys(r.nextStubs ?? {}).some(s => ['boolean', 'loft', 'mixed', 'pvol'].includes(s)) ? 'stub' : 'real') : null, Object.keys(r.nextStubs ?? {}));
    note(u, 'kso:deep', r.deep, r.deep === 'OK' ? 'stub' : null, Object.keys(r.deepStubs ?? {}));
  }
}
// fs-needs-partstudio-input: stand-in parts, levels 1-2.
{
  const x = read('out/corpus/fs-needs-partstudio-input/files.json'); SOURCES.push('out/corpus/fs-needs-partstudio-input/files.json');
  for (const f of x.files) {
    const u = unit(f.path, f.feature);
    if (!u) continue;
    if (f.firstBlocker?.correctCluster === 'fs-parser-syntax') { u.fixes.add('P1'); }
    else { u.fixes.add('P12'); u.fixes.add('P9'); }
    if (f.level1) note(u, 'ps:l1', f.level1.message, f.level1.ok ? 'stub' : null, f.level1.stubs ?? []);
    for (const lvl of ['level2PassAll', 'level2Hybrid']) {
      const l = f[lvl]; if (!l) continue;
      if (l.stubbedBooleans > 0 && lvl === 'level2PassAll') u.fixes.add('K8');
      note(u, `ps:${lvl}`, l.ok ? 'ok' : l.message, l.ok ? 'stub' : null);
    }
  }
}
// fs-module-import: placeholder bodies (stub1/stub2) and the r10b family re-bound to the real capture.
{
  const x = read('out/corpus/module-import/next-summary.json'); SOURCES.push('out/corpus/module-import/next-summary.json');
  for (const r of x.unitRows) {
    const u = unit(r.path, r.feature);
    if (!u) continue;
    // A placeholder for imported CODE (NS::function, P11) says nothing about the
    // imported functions' own blockers, so it does not close the chain.
    const codeImport = u.fixes.has('P11');
    for (const lvl of ['stub1', 'stub2']) if (r[lvl]) note(u, `mi:${lvl}`, r[lvl].status === 'ok' ? 'ok' : r[lvl].message, r[lvl].status === 'ok' && !codeImport ? 'stub' : null);
    if (r.rebind) note(u, 'mi:rebind', r.rebind.status === 'ok' ? 'ok' : r.rebind.message, r.rebind.status === 'ok' ? 'real' : null);
  }
  for (const f of x.perFile) for (const u of [...units.values()].filter(v => v.path === f.path)) {
    if ((f.importForms ?? []).some(k => /measure|volume|box/.test(k))) u.fixes.add('P10');
  }
}
// fs-interpreter-semantics: prototype fix, then stubbed deeper.
{
  SOURCES.push('out/corpus/fs-interpreter-semantics/next-blocker.jsonl', 'out/corpus/fs-interpreter-semantics/stub-deeper.jsonl');
  for (const r of readJsonl('out/corpus/fs-interpreter-semantics/next-blocker.jsonl')) {
    if (r.variant === 'current') continue;
    const u = units.get(r.key) ?? unit(r.path, r.feature);
    note(u, `sem:${r.variant}`, r.ok ? 'ok' : r.message, r.ok ? 'real' : null);
  }
  for (const r of readJsonl('out/corpus/fs-interpreter-semantics/stub-deeper.jsonl')) {
    for (const u of [...units.values()].filter(v => v.path === r.path)) note(u, 'sem:deeper', r.ok ? 'ok' : r.message, r.ok ? 'stub' : null, Object.entries(r.stubbed ?? {}).filter(([, n]) => n > 0).map(([k]) => k));
  }
}
// fs-missing-builtin: prototype builtins (real geometry), optional text stub.
{
  const x = read('out/corpus/cluster-fs-missing-builtin.json'); SOURCES.push('out/corpus/cluster-fs-missing-builtin.json');
  for (const f of x.rows) for (const n of f.next ?? []) {
    const u = unit(f.path, n.feature);
    if (!u) continue;
    if (n.builtin) u.fixes.add(builtinFix(n.builtin));
    note(u, 'bi:next', n.next === 'ok' ? 'ok' : `${n.next} ${n.nextMessage ?? ''}`, n.next === 'ok' ? 'real' : null);
    if (n.thenNext) {
      if (n.stubbed?.some(s => /text/i.test(s))) u.fixes.add('K13');
      note(u, 'bi:then', n.thenNext === 'ok' ? 'ok' : `${n.thenNext} ${n.thenMessage ?? ''}`, n.thenNext === 'ok' ? 'stub' : null);
    }
  }
}
// fs-needs-partstudio-input level 3: two fixed-frame representatives with the
// sketch joins stubbed and Booleans passed; the result holds for lineage A.
{
  SOURCES.push('out/corpus/fs-needs-partstudio-input/level3-fixed-frame.jsonl');
  const lineage = new Map(read('out/corpus/fs-needs-partstudio-input/files.json').files.map(f => [f.path, f.lineage]));
  const l3 = readJsonl('out/corpus/fs-needs-partstudio-input/level3-fixed-frame.jsonl').filter(r => !r.meta);
  if (l3.length) for (const u of units.values()) if (lineage.get(u.path) === 'A-fixed-frame-r25-side') {
    u.fixes.add('K16'); u.fixes.add('K8');
    // rounded-rectangle loft between parallel line/arc profiles: loft phase 1b
    for (const r of l3) { note(u, 'ps:l3 (lineage)', r.message.replace(/opLoft.*/, 'rounded-rectangle loft')); u.fixes.add('K4'); u.fixes.delete('K3'); }
  }
}
// Hand-carried findings from the cluster reports (not in a machine-readable file).
const MANUAL = [
  // docs/corpus/cluster-fs-module-import.md: the M3 library inlined in a tmp copy stops at opRevolve after 21 calls.
  ['cad-project-043/fsocct/examples/canonical_m3_tool.fs', 'opRevolve (M3 library inlined, 21 calls)', ['P6']],
];
for (const [path, message, fx] of MANUAL) for (const u of units.values()) if (u.path === path) { fx.forEach(f => u.fixes.add(f)); note(u, 'manual', message); }

// py-imports: runner patched (dir, env, lazy shim).
const pyRole = new Map();
{
  const x = read('out/corpus/py-imports-files.json'); SOURCES.push('out/corpus/py-imports-files.json');
  for (const r of [...x.rows, ...(x.hidden ?? [])]) {
    pyRole.set(r.path, r.role ?? (r.note ? 'tool' : null));
    const u = units.get(r.path);
    for (const lvl of ['nextDir', 'nextDirEnv', 'nextDirEnvLazy']) if (r[lvl]) note(u, `pyi:${lvl}`, r[lvl].message);
  }
}
// py-api-surface: lazy shim, local path, cad_khana on the path.
{
  SOURCES.push('out/corpus/py-api-surface/next-lazy-localpath-khana.jsonl');
  for (const r of readJsonl('out/corpus/py-api-surface/next-lazy-localpath-khana.jsonl')) note(units.get(r.key), 'pyapi:next', r.message);
  for (const r of surface.rows) {
    if (/\/common\.py$|\/cores\.py$/.test(r.key)) pyRole.set(r.key, 'helper');
  }
}

// ---------------------------------------------------------------- static requirements
const fsFacts = JSON.parse(readFileSync(join(TMP_DIR, 'facts/fs-facts.json'), 'utf8'));
const pyFacts = JSON.parse(readFileSync(join(TMP_DIR, 'facts/py-facts.json'), 'utf8'));
const factOf = new Map([...fsFacts.files, ...pyFacts.files].map(f => [f.path, f]));
const PROD = new Set(await productionBuiltins());
async function productionBuiltins() {
  const { ModelingContext } = await import(join(REPO, 'src/library.mjs'));
  const c = Object.create(ModelingContext.prototype); c.records = new Map();
  return Object.keys(ModelingContext.prototype.builtins.call(c));
}
const fragments = new Set(read('out/corpus/fragments.json').rows.map(r => r.path));
const files = new Map();
for (const f of targets.files) {
  const us = [...units.values()].filter(u => u.path === f.path);
  if (!us.length) continue;
  const fixes = new Set(us.flatMap(u => [...u.fixes]));
  // Static use only matters while a chain is open: once every unit reached its
  // end in a probe, calls the probe never reached are dead code for this file.
  const chainClosed = us.every(u => u.status === "ok" || u.ends.length);
  const fact = chainClosed ? null : factOf.get(f.path);
  const staticMissing = [];
  if (f.frontend === 'fs' && fact) {
    for (const c of Object.keys(fact.calls ?? {})) {
      const n = c.replace(/^call:/, '');
      if (PROD.has(n) || n.startsWith('imported:')) continue;
      if (n.startsWith('ns:')) { fixes.add('P8'); fixes.add('P9'); if (n !== 'ns:build') fixes.add('P11'); continue; }
      staticMissing.push(n); fixes.add(builtinFix(n));
      if (n === 'mirrorAcross') fixes.add('K17');
    }
  }
  if (f.frontend === 'py' && fact) {
    const names = [...Object.keys(fact.b3dNames ?? {}), ...Object.keys(fact.members ?? {}), ...Object.keys(fact.methods ?? {}).map(m => '.' + m)];
    for (const n of names) if (TIER_OF.has(n) && TIER_OF.get(n) !== 'S') { staticMissing.push(n); pyTierFix(n.replace(/^\./, '')).forEach(x => fixes.add(x)); }
    fixes.add('P14'); fixes.add('P15'); // no corpus file binds `result`: the export-as-output contract is stage 2
    for (const imp of fact.imports ?? []) {
      if (['build123d', 'math', 'pathlib', 'os', 'sys', 'json', 'typing', 'dataclasses', '__future__', 'functools', 'itertools', 'collections', 'enum', 'argparse', 'copy', 're', 'datetime', 'hashlib', 'subprocess', 'time', 'random', 'statistics', 'textwrap', 'shutil', 'csv', 'string', 'warnings', 'logging', 'importlib', 'tempfile', 'glob', 'io', 'fractions', 'decimal', 'operator', 'abc', 'contextlib', 'inspect', 'traceback', 'struct', 'zipfile', 'base64', 'uuid', 'platform'].includes(imp)) continue;
      fixes.add(imp === 'ocp_vscode' ? 'P15' : ['cad_khana', 'bd_warehouse', 'OCP', 'OCC', 'cadquery'].includes(imp) ? 'P18' : 'P13');
    }
  }
  const role = f.frontend === 'py' ? pyRole.get(f.path) ?? 'model' : 'model';
  const excluded = fragments.has(f.path) || us.some(u => u.fragment) ? 'fragment'
    : us.some(u => u.notModel) || ['test', 'tool', 'helper'].includes(role) ? 'not-a-model' : null;
  const allOk = us.every(u => u.status === 'ok');
  const conf = allOk ? 'real' : us.every(u => u.status === 'ok' || u.ends.length) ? (us.every(u => u.status === 'ok' || u.ends.includes('real')) ? 'real' : 'stub') : 'open';
  files.set(f.path, { path: f.path, frontend: f.frontend, family: `${f.frontend}:${f.family}`, units: us.length, fixes: allOk ? new Set() : fixes, conf, excluded, staticMissing, okToday: allOk });
}

// ---------------------------------------------------------------- greedy
// P18 (a Bend port of cad_khana, bd_warehouse, a STEP reader) is not planned:
// files that need it stay out of reach instead of pulling it into the ranking.
const NOT_PLANNED = new Set(['P18']);
const cand = [...files.values()].filter(f => !f.excluded);
for (const f of cand) f.unreachable = [...f.fixes].some(x => NOT_PLANNED.has(x));
const familiesAll = new Set([...files.values()].map(f => f.family));
const familiesModel = new Set(cand.map(f => f.family));
const subset = (a, S) => [...a].every(x => S.has(x));
const famCount = (S, confs) => new Set(cand.filter(f => !f.unreachable && confs.includes(f.conf) && subset(f.fixes, S)).map(f => f.family));
const EST = ['real', 'stub'], ALL = ['real', 'stub', 'open'];
const selected = new Set();
const steps = [];
const snapshot = () => ({ measured: famCount(selected, ['real']).size, estimated: famCount(selected, EST).size, upper: famCount(selected, ALL).size });
const base = snapshot();
for (const track of [EST, ALL]) {
  for (;;) {
    const cur = famCount(selected, track);
    let best = null;
    const bundles = new Map();
    for (const f of cand.filter(f => !f.unreachable && track.includes(f.conf))) {
      const missing = [...f.fixes].filter(x => !selected.has(x)).sort();
      if (!missing.length) continue;
      bundles.set(missing.join('+'), missing);
    }
    for (const missing of bundles.values()) {
      const S = new Set([...selected, ...missing]);
      const gain = famCount(S, track).size - cur.size;
      if (gain <= 0) continue;
      const cost = missing.reduce((s, x) => s + days(x), 0);
      const ratio = gain / cost;
      if (!best || ratio > best.ratio + 1e-12 || (Math.abs(ratio - best.ratio) < 1e-12 && cost < best.cost)) best = { missing, gain, cost, ratio };
    }
    if (!best) break;
    const before = famCount(selected, track);
    for (const x of [...best.missing].sort((a, b) => days(a) - days(b) || a.localeCompare(b))) {
      const prev = snapshot();
      selected.add(x);
      const now = snapshot();
      steps.push({ fix: x, track: track === EST ? 'estimated' : 'upper', bundleGain: best.gain, bundleDays: best.cost, ...now,
        delta: { measured: now.measured - prev.measured, estimated: now.estimated - prev.estimated, upper: now.upper - prev.upper } });
    }
    const after = famCount(selected, track);
    steps.at(-1).newFamilies = [...after].filter(x => !before.has(x));
  }
}
// Fixes that complete no family: order by first-blocker units removed per day.
const firstBlockerUnits = id => [...units.values()].filter(u => u.status !== 'ok' && u.evidence[0]?.startsWith('first:') && [...fixesOf(u.message)].includes(id)).length;
const rest = Object.keys(FIXES).filter(x => !selected.has(x)).map(x => ({ x, n: firstBlockerUnits(x) })).sort((a, b) => b.n / days(b.x) - a.n / days(a.x));
for (const { x } of rest) { const prev = snapshot(); selected.add(x); const now = snapshot(); steps.push({ fix: x, track: 'rest', ...now, delta: { measured: now.measured - prev.measured, estimated: now.estimated - prev.estimated, upper: now.upper - prev.upper } }); }

// Per-fix reach: families (and files) whose fix set contains the fix.
const reach = id => {
  const fs = cand.filter(f => f.fixes.has(id));
  return { files: fs.length, families: new Set(fs.map(f => f.family)).size };
};
const result = {
  schema: 'wonky-corpus-backlog/1', generatedAt: new Date().toISOString(), sources: SOURCES,
  daysPerEffort: DAYS,
  population: {
    files: files.size, families: familiesAll.size, modelFiles: cand.length, modelFamilies: familiesModel.size,
    excluded: Object.fromEntries(['fragment', 'not-a-model'].map(k => [k, [...files.values()].filter(f => f.excluded === k).length])),
    confidence: Object.fromEntries(['real', 'stub', 'open'].map(k => [k, { files: cand.filter(f => f.conf === k).length, families: new Set(cand.filter(f => f.conf === k).map(f => f.family)).size }])),
  },
  baseline: base,
  steps: steps.map(s => ({ ...s, title: FIXES[s.fix][0], owner: FIXES[s.fix][3], cluster: FIXES[s.fix][1], effort: FIXES[s.fix][2], days: days(s.fix), reach: reach(s.fix) })),
  fixes: Object.fromEntries(Object.entries(FIXES).map(([id, [title, cluster, effort, owner]]) => [id, { title, cluster, effort, owner, days: days(id), reach: reach(id) }])),
  files: [...files.values()].map(f => ({ ...f, fixes: [...f.fixes].sort() })),
};
writeFileSync(outPath, JSON.stringify(result, null, 1));
console.log(JSON.stringify({ population: result.population, baseline: base }, null, 1));
console.log('step fix       track      +est  est  meas  upper  days  reach(files/fam)');
for (const s of result.steps) console.log(`${s.fix.padEnd(5)} ${s.track.padEnd(10)} ${String(s.delta.estimated).padStart(4)} ${String(s.estimated).padStart(4)} ${String(s.measured).padStart(5)} ${String(s.upper).padStart(6)} ${String(s.days).padStart(5)}  ${s.reach.files}/${s.reach.families}  ${s.newFamilies ? s.newFamilies.join(',') : ''}`);
