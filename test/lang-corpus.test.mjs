// Classification semantics of the corpus scanners (scripts/lang/*).
// The corpus numbers in docs/language/corpus.md depend on these rules; each
// case is a minimal form of a pattern found in Marc's real files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseFs } from '../scripts/lang/fs-parse.mjs';
import { analyzeFs } from '../scripts/lang/fs-analyze.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');

const feature = body => `FeatureScript 2892;
import(path : "onshape/std/common.fs", version : "2892.0");
annotation { "Feature Type Name" : "T" }
export const t = defineFeature(function(context is Context, id is Id, definition is map)
precondition {}
{
${body}
});`;
const fsSites = body => analyzeFs(parseFs(feature(body)), feature(body)).sites.filter(s => s.sub !== 'try-rethrow');

test('FS: solid-count check is an assert, not a decision', () => {
  const [s] = fsSites('var q = qCreatedBy(id + "a", EntityType.BODY);\nif (size(evaluateQuery(context, q)) != 1) throw regenError("Expected one solid");');
  assert.equal(s.kind, 'geo-branch');
  assert.equal(s.sub, 'assert');
});

test('FS: fillet only when the selection is non-empty is an emptiness guard', () => {
  const sites = fsSites('var es = evaluateQuery(context, qCreatedBy(id + "a", EntityType.EDGE));\nif (size(es) > 0) opFillet(context, id + "f", { "entities" : qUnion(es), "radius" : 1 * millimeter });');
  const s = sites.find(x => x.kind === 'geo-branch');
  assert.equal(s.sub, 'emptiness-guard');
  assert.equal(s.geomOp, true);
});

test('FS: picking bodies by bounding box is a declarative range selection', () => {
  const sites = fsSites(`var left = [];
for (var b in evaluateQuery(context, qAllModifiableSolidBodies()))
    if (evBox3d(context, { "topology" : b, "tight" : true }).maxCorner[1] < 0 * millimeter)
        left = append(left, b);`);
  const loop = sites.find(x => x.kind === 'geo-iterate');
  const branch = sites.find(x => x.kind === 'geo-branch');
  assert.equal(loop.selects, true);
  assert.equal(branch.sub, 'measure-decision');
  assert.equal(branch.selects, true);
  assert.equal(branch.geomOp, false);
  assert.equal(branch.pred, 'range');
});

test('FS: an op per evaluated body is a map, try silent inside makes it sequential', () => {
  const map = fsSites('for (var b in evaluateQuery(context, qAllModifiableSolidBodies()))\n    opDeleteBodies(context, id + "d", { "entities" : b });').find(x => x.kind === 'geo-iterate');
  assert.equal(map.geomOp, true);
  assert.equal(map.carried, false);
  const seq = fsSites('for (var e in evaluateQuery(context, qCreatedBy(id + "a", EntityType.EDGE)))\n{ try silent { opChamfer(context, id + "c", { "entities" : e, "chamferType" : ChamferType.EQUAL_OFFSETS, "width" : 1 * millimeter }); } }').find(x => x.kind === 'geo-iterate');
  assert.equal(seq.carried, true);
});

test('FS: loops over literal arrays and measured point arrays are not geometry iteration', () => {
  assert.deepEqual(fsSites('for (var x in [1, 2, 3]) fCuboid(context, id + ("b" ~ x), { "corner1" : vector(x, 0, 0) * millimeter, "corner2" : vector(x + 1, 1, 1) * millimeter });'), []);
  const sites = fsSites(`var bb = evBox3d(context, { "topology" : qCreatedBy(id + "a", EntityType.BODY), "tight" : true });
var pts = [[0, 0], [bb.maxCorner[0] / millimeter, 0], [0, 1]];
var sk = newSketchOnPlane(context, id + "sk", { "sketchPlane" : XY_PLANE });
for (var i = 0; i < size(pts); i += 1) skLineSegment(sk, "e" ~ i, { "start" : vector(pts[i][0], pts[i][1]) * millimeter, "end" : vector(0, 0) * millimeter });`);
  assert.equal(sites.filter(s => s.kind === 'geo-iterate').length, 0);
});

test('FS: name lookup through getProperty is a metadata decision', () => {
  const sites = fsSites(`var found;
for (var b in evaluateQuery(context, qAllModifiableSolidBodies()))
    if (getProperty(context, { "entity" : b, "propertyType" : PropertyType.NAME }) == "Rotor") found = b;`);
  assert.ok(sites.some(s => s.kind === 'meta-branch' && s.sub === 'decision'));
  assert.ok(!sites.some(s => s.kind === 'geo-branch'));
});

// ---------------------------------------------------------------- Python
function pySites(name, source) {
  const dir = join(repo, 'tmp/lang/test-fixtures');
  mkdirSync(dir, { recursive: true });
  const abs = join(dir, name);
  writeFileSync(abs, source);
  const run = spawnSync('uv', ['run', '--no-project', '--offline', 'python', join(repo, 'scripts/lang/py-facts.py'), join(repo, 'fixtures/lang/b3d-vocab.json')],
    { input: JSON.stringify([{ path: name, abs }]), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout)[0];
}

test('Python: the roots idiom is a range predicate selection behind an emptiness guard', () => {
  const r = pySites('roots.py', `from build123d import *
def rail(h: float) -> Part:
    s = Box(10, 4, h)
    s += Pos(3, 0, 0) * Box(2, 4, h)
    roots = [e for e in s.edges() if abs(e.length - 4) < 1e-5 and abs(e.center().Z) < 1e-6]
    if roots:
        s = fillet(roots, 0.4)
    return s
`);
  const comp = r.sites.find(s => s.sub === 'comprehension-filter');
  assert.equal(comp.pred, 'range');
  assert.equal(comp.selects, true);
  assert.equal(r.sites.find(s => s.kind === 'geo-branch').sub, 'emptiness-guard');
  assert.ok(r.sites.some(s => s.kind === 'geo-data' && s.sub === 'predicate-selection'));
  assert.ok(!r.sites.some(s => s.sub === 'measure-param'));
});

test('Python: bed placement from a bounding box is measured dataflow; placement arithmetic is not', () => {
  const r = pySites('bed.py', `from build123d import *
def to_bed(part):
    bb = part.bounding_box()
    return part.moved(Location((0, 0, -bb.min.Z)))
T = Pos(10, 0, 0) * Rot(90, 0, 0)
apex = (T.inverse() * Pos(1, 0, 0)).position
body = Pos(apex.X, 0, 0) * Box(1, 2, 3) + Box(4, 5, 6)
body = to_bed(body)
`);
  const params = r.sites.filter(s => s.sub === 'measure-param');
  assert.equal(params.length, 1);
  assert.equal(params[0].fn, 'to_bed');
});

test('Python: loops over literal part tables are static-trip, fillet fallback loops are sequential', () => {
  const r = pySites('loops.py', `from build123d import *
solids = import_step("source.step").solids()
parts = {"a": solids[0], "b": solids[1]}
for name, shape in parts.items():
    print(name, shape.volume)
part = Box(10, 10, 10)
for edge in part.edges().filter_by(Axis.Z):
    try:
        part = fillet([edge], 1)
    except Exception:
        continue
`);
  const loops = r.sites.filter(s => s.kind === 'geo-iterate');
  assert.ok(loops.some(s => s.sub === 'static-trip'));
  const seq = loops.find(s => s.sub === 'entities');
  assert.equal(seq.modelingInBody, true);
  assert.equal(seq.carried, true);
});
