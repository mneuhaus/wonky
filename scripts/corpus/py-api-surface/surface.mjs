// Static build123d surface of the py-api-surface cluster (corpus analysis only).
//
// For each cluster file: every build123d construct it uses (top-level names,
// enum members, shape methods, measured properties), including the local
// helper modules it imports (resolved inside the project), mapped to the tier
// of work needed to support it without leaving Bend. Non-API blockers
// (third-party packages, direct OCP, no `result` binding) are listed next to it.
// Input: tmp/corpus/facts/py-facts.json (scripts/lang/py-facts.py, stdlib ast,
// nothing executed) and out/corpus/runs.jsonl.
//
//   node scripts/corpus/py-api-surface/surface.mjs   -> out/corpus/py-api-surface/surface.json
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { REPO, OUT_DIR, TMP_DIR, CORPUS_ROOT } from '../lib.mjs';

// ------------------------------------------------------------ tiers
// S  supported by python/build123d.py today
// A  frontend only: containers, placement, metadata, exports, measurements
//    over bodies Bend already built; rigid transforms use the existing Bend
//    transform (kernel.transform / analytic.transform accept a rotation)
// B  existing Bend construction, new frontend wiring: planar prisms
//    (extrudeInBend), line/arc profiles (sketch-arcs), frustum (cone),
//    revolve of polygonal profiles (kernel/revolve.bend), two-circle loft
// Q  topology queries/selectors over built B-reps (host side, no new geometry)
// C  missing Bend capability: fillet, chamfer, offset, sweep, splines, text,
//    sphere, torus, split, section, 2D sketch Booleans, general loft
// X  external geometry: STEP/BREP import (needs a Bend reader or a frozen
//    snapshot with provenance), direct OCP, font files
const TIER = {
  S: ['Box', 'Cylinder', 'Pos', 'Align', 'Mode', 'Align.MIN', 'Align.CENTER', 'Align.MAX', 'Mode.ADD', '.volume'],
  A: ['Part', 'Solid', 'Compound', 'Shape', 'ShapeList', 'Location', 'Locations', 'GridLocations', 'PolarLocations', 'Rot', 'Rotation',
    'Plane', 'Axis', 'Vector', 'Color', 'Unit', 'export_step', 'export_stl', 'export_brep', 'Mode.SUBTRACT', 'Mode.INTERSECT', 'Mode.PRIVATE',
    'Plane.XY', 'Plane.XZ', 'Plane.YZ', 'Plane.ZX', 'Plane.YX', 'Plane.ZY', 'Axis.X', 'Axis.Y', 'Axis.Z',
    '.moved', '.translate', '.rotate', '.located', '.locate', '.solids', '.solid', '.bounding_box', '.center', '.fuse', '.cut',
    '.intersect', '.is_valid', '.relative_to', '.inverse', '.label', '.color', '.clean', '.make_box', '.make_cylinder', '.X', '.Y', '.Z',
    '.dot', '.cross', '.normalized', '.add', '.positions'],
  B: ['Rectangle', 'RectangleRounded', 'Circle', 'Polygon', 'RegularPolygon', 'Polyline', 'Line', 'make_face', 'extrude', 'Cone',
    'SlotCenterToCenter', 'RadiusArc', 'CenterArc', 'revolve', 'BuildPart', 'BuildSketch', 'BuildLine', 'Face', 'Wire', 'Edge', '.make_polygon',
    '.make_line', '.extrude', '.mirror', 'mirror', 'Sketch', 'SlotOverall', 'face'],
  Q: ['.edges', '.faces', '.vertices', '.wires', '.filter_by', '.group_by', '.sort_by', '.sort', 'GeomType', 'GeomType.CIRCLE', 'GeomType.LINE',
    'GeomType.PLANE', 'GeomType.CYLINDER', 'edges', 'solid', '.geom_type', '.radius', '.position_at', '.normal_at', '.tangent_at', '.is_inside',
    '.distance_to', '.is_closed', '.outer_wire', '.inner_wires', 'SortBy', '.arc_center'],
  C: ['fillet', 'chamfer', 'offset', '.offset', 'sweep', 'loft', 'Spline', 'Bezier', 'Text', 'FontStyle', 'FontStyle.BOLD', 'Sphere', 'Torus',
    'split', 'Keep', 'Keep.TOP', 'Keep.BOTTOM', 'section', 'trace', 'Mesher', '.make_spline', '.add_shape', '.write', '.tessellate',
    'Kind', 'Kind.INTERSECTION', '.line', 'Side', 'Side.BOTH', '.split'],
  X: ['import_step', 'import_brep', 'import_stl', 'OCP', 'bd_warehouse'],
};
const tierOf = new Map();
for (const [t, names] of Object.entries(TIER)) for (const n of names) if (!tierOf.has(n)) tierOf.set(n, t);
const ORDER = ['S', 'A', 'B', 'Q', 'C', 'X'];
// Python/list methods the facts scanner may count; not build123d API.
const IGNORE = new Set(['.append', '.insert', '.extend', '.pop', 'os', 'math', 'edges.', '.update', '.keys']);

// ------------------------------------------------------------ inputs
const facts = JSON.parse(readFileSync(join(TMP_DIR, 'facts/py-facts.json'), 'utf8')).files;
const byPath = new Map(facts.map(f => [f.path, f]));
const latest = new Map();
for (const line of readFileSync(join(OUT_DIR, 'runs.jsonl'), 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const r = JSON.parse(line);
  if (r.runner === 'corpus-run/1') latest.set(r.key, r);
}
const vocab = new Set(Object.keys(JSON.parse(readFileSync(join(REPO, 'fixtures/lang/b3d-vocab.json'), 'utf8')).categories));
const inCluster = r => r.frontend === 'py' && (r.kind === 'python-api'
  || (r.kind === 'python-name-error' && vocab.has((r.message.match(/name '([^']+)' is not defined/) ?? [])[1])));
const units = [...latest.values()].filter(inCluster).sort((a, b) => a.key.localeCompare(b.key));
const nextOf = mode => {
  const p = join(OUT_DIR, 'py-api-surface', `next-${mode}.jsonl`);
  if (!existsSync(p)) return new Map();
  return new Map(readFileSync(p, 'utf8').trim().split('\n').map(l => JSON.parse(l)).map(r => [r.key, r]));
};
const next = { lazy: nextOf('lazy'), local: nextOf('lazy-localpath'), khana: nextOf('lazy-localpath-khana') };

const THIRD_PARTY = new Set(['numpy', 'pytest', 'cad_khana', 'bd_warehouse', 'trimesh', 'yaml', 'httpx', 'PIL', 'OCP', 'scipy', 'shapely']);
const STDLIB = new Set(['__future__', 'math', 'os', 'sys', 'json', 'pathlib', 'hashlib', 'itertools', 'dataclasses', 'typing', 'argparse', 'struct',
  'importlib', 'functools', 'urllib', 'xml', 'inspect', 'subprocess', 'tempfile', 'time', 'shutil', 'traceback', 'ast', 'build123d', 'enum', 'collections', 're']);

function localModule(entry, name) {
  const dir = dirname(entry);
  for (const d of [dir, dirname(dir), dirname(dirname(dir))]) {
    for (const p of [`${d}/${name}.py`, `${d}/${name}/__init__.py`]) if (byPath.has(p)) return byPath.get(p);
    // facts hold modeling/check/tooling files; plain helper modules may be absent
    if (existsSync(join(CORPUS_ROOT, `${d}/${name}.py`))) return { path: `${d}/${name}.py`, absent: true };
  }
  return null;
}

function constructs(f) {
  const out = new Set();
  for (const n of Object.keys(f.b3dNames ?? {})) out.add(n);
  for (const n of Object.keys(f.members ?? {})) out.add(n);
  for (const n of Object.keys(f.methods ?? {})) out.add('.' + n);
  for (const n of Object.keys(f.props ?? {})) out.add('.' + n);
  for (const n of IGNORE) out.delete(n);
  return out;
}

const rows = [];
for (const u of units) {
  const f = byPath.get(u.key);
  const used = constructs(f);
  const locals = [], thirdParty = new Set();
  const seen = new Set([u.key]);
  const visit = (file, depth) => {
    for (const imp of file.imports ?? []) {
      if (STDLIB.has(imp)) continue;
      if (THIRD_PARTY.has(imp)) { thirdParty.add(imp); continue; }
      const m = localModule(u.key, imp);
      if (!m) { thirdParty.add(imp); continue; }
      if (seen.has(m.path)) continue;
      seen.add(m.path);
      locals.push({ module: imp, path: m.path, inFacts: !m.absent, cluster: latest.get(m.path) && inCluster(latest.get(m.path)) ? true : undefined });
      if (!m.absent) { for (const c of constructs(m)) used.add(c); if (depth < 2) visit(m, depth + 1); }
    }
  };
  visit(f, 0);
  if (f.imports.includes('OCP')) used.add('OCP');
  if (thirdParty.has('bd_warehouse')) used.add('bd_warehouse');
  const byTier = Object.fromEntries(ORDER.map(t => [t, []]));
  const unknown = [];
  for (const c of [...used].sort()) {
    const t = tierOf.get(c);
    if (t) byTier[t].push(c); else unknown.push(c);
  }
  const needed = ORDER.filter(t => t !== 'S' && byTier[t].length);
  const worst = needed.at(-1) ?? 'S';
  const nx = next.lazy.get(u.key), nl = next.local.get(u.key), nk = next.khana.get(u.key);
  const brief = r => r ? { status: r.status, kind: r.kind, line: r.line, message: (r.message ?? '').replace(/^.*?\.py:\d+(:\d+)?: /, ''), sourceLine: r.sourceLine,
    completedOperations: r.completedOperations, callChain: r.failedOperation?.callChain } : null;
  rows.push({
    key: u.key, family: u.family, representative: u.representative, lines: f.lines,
    firstBlocker: { kind: u.kind, line: u.location?.line ?? null, message: u.message, sourceLine: u.sourceLine },
    // where the first blocker fires: the build123d import statement, a return annotation evaluated at `def`, or a use
    firstBlockerAt: /^\s*(from build123d import|import |from \S+ import)/.test(u.sourceLine ?? '') ? 'import' : /->\s*\w+\s*:\s*$|->\s*(Sketch|Part)\b/.test(u.sourceLine ?? '') ? 'annotation' : 'use',
    completedOperations: u.completedOperations ?? null,
    tiers: byTier, unknown, maxTier: worst,
    locals, thirdParty: [...thirdParty].sort(),
    bindsResult: false, exportCalls: (f.b3dNames?.export_stl ?? 0) + (f.b3dNames?.export_step ?? 0),
    next: { lazy: brief(nx), lazyLocalPath: brief(nl), lazyLocalPathKhana: brief(nk) },
  });
}

// ------------------------------------------------------------ aggregates
const count = (xs, key) => xs.reduce((m, x) => { const k = key(x); m[k] = (m[k] ?? 0) + 1; return m; }, {});
const demand = {};
for (const r of rows) for (const t of ORDER) for (const c of r.tiers[t]) (demand[c] ??= { tier: t, files: 0 }).files++;
const coverage = {};
for (const upto of ['A', 'B', 'Q', 'C']) {
  const allowed = new Set(ORDER.slice(0, ORDER.indexOf(upto) + 1));
  coverage[`S..${upto}`] = rows.filter(r => ORDER.every(t => allowed.has(t) || !r.tiers[t].length)
    && !r.thirdParty.some(p => THIRD_PARTY.has(p)) && !r.unknown.length).map(r => r.key);
}
const out = {
  schema: 'wonky-corpus-py-api-surface/1', generatedAt: new Date().toISOString(),
  tiers: TIER, files: rows.length,
  maxTierCounts: count(rows, r => r.maxTier),
  thirdPartyCounts: count(rows.flatMap(r => r.thirdParty), x => x),
  demand: Object.fromEntries(Object.entries(demand).sort((a, b) => b[1].files - a[1].files)),
  coverageWithoutThirdParty: coverage,
  rows,
};
mkdirSync(join(OUT_DIR, 'py-api-surface'), { recursive: true });
writeFileSync(join(OUT_DIR, 'py-api-surface', 'surface.json'), JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify({ maxTierCounts: out.maxTierCounts, thirdParty: out.thirdPartyCounts, coverage: Object.fromEntries(Object.entries(coverage).map(([k, v]) => [k, v.length])) }, null, 1));
console.log('unknown constructs:', [...new Set(rows.flatMap(r => r.unknown))].join(' '));
