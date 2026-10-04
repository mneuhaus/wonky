// FeatureScript path of a revolve cut into an extruded plate: a countersunk
// M3-style through hole (bore r 1.6, 90 degree sink to r 3.2 at the top face)
// and a drill-point blind hole. Volume is the closed form of the meridians;
// STEP and STL are exported without approximation labels. A cut whose axis
// runs across the plate refuses by name.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = (axis) => `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
function revolveCut(context is Context, id is Id, origin is Vector, points is array)
{
    var sk = newSketchOnPlane(context, id + "profile", {"sketchPlane": plane(origin, vector(0, -1, 0), vector(1, 0, 0))});
    for (var i = 0; i < size(points); i += 1)
        skLineSegment(sk, "s" ~ i, {"start": vector(points[i][0], points[i][1]) * millimeter,
            "end": vector(points[(i + 1) % size(points)][0], points[(i + 1) % size(points)][1]) * millimeter});
    skSolve(sk);
    opRevolve(context, id + "revolve", {"entities": qSketchRegion(id + "profile", false),
        "axis": line(origin, ${axis}), "angleForward": 360 * degree});
    opDeleteBodies(context, id + "clean", {"entities": qCreatedBy(id + "profile", EntityType.BODY)});
    return qCreatedBy(id + "revolve", EntityType.BODY);
}
export const holes = defineFeature(function(context is Context, id is Id, definition is map) precondition {} {
    var base = newSketchOnPlane(context, id + "base", {"sketchPlane": plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0))});
    skRectangle(base, "r", {"firstCorner": vector(0, 0) * millimeter, "secondCorner": vector(40, 30) * millimeter});
    skSolve(base);
    opExtrude(context, id + "plate", {"entities": qSketchRegion(id + "base", false), "direction": vector(0, 0, 1),
        "endBound": BoundingType.BLIND, "endDepth": 8 * millimeter});
    opDeleteBodies(context, id + "baseClean", {"entities": qCreatedBy(id + "base", EntityType.BODY)});
    const sink = revolveCut(context, id + "sink", vector(12, 15, 0) * millimeter,
        [[0, -1], [1.6, -1], [1.6, 6.4], [3.2, 8], [3.2, 9], [0, 9]]);
    const drill = revolveCut(context, id + "drill", vector(28, 15, 0) * millimeter,
        [[0, -1], [1.25, -1], [1.25, 4], [0, 5.25]]);
    opBoolean(context, id + "cut", {"targets": qCreatedBy(id + "plate", EntityType.BODY), "tools": qUnion([sink, drill]),
        "operationType": BooleanOperationType.SUBTRACTION});
});`;

function cli(t, text, format) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wonky-revolve-holes-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  fs.writeFileSync(path.join(dir, 'holes.fs'), text);
  const run = spawnSync(process.execPath, [path.join(root, 'bin/wonky.mjs'), path.join(dir, 'holes.fs'), '--feature', 'holes',
    '--format', format, '--out', path.join(dir, 'holes'), '--json'], {cwd: root, encoding: 'utf8', timeout: 180_000,
    env: {...process.env, WONKY_BACKEND: 'rust', NODE_OPTIONS: '--max-old-space-size=8192'}});
  assert.ifError(run.error);
  return {status: run.status, report: JSON.parse(run.stdout), dir, stderr: run.stderr};
}

test('countersunk and drill-point revolve cuts in a plate: exact volume, STEP and STL', t => {
  const {status, report, dir, stderr} = cli(t, source('vector(0, 0, 1)'), 'all');
  assert.equal(status, 0, JSON.stringify(report) + stderr);
  assert.equal(report.bodies.length, 1);
  assert.equal(report.bodies[0].exact, true);
  // Sink: bore pi 1.6^2 6.4 + frustum pi 1.6 (1.6^2 + 1.6 3.2 + 3.2^2) / 3.
  // Drill: pi 1.25^2 4 + cone pi 1.25^2 1.25 / 3.
  const holes = Math.PI * (1.6 * 1.6 * 6.4 + 1.6 * (1.6 * 1.6 + 1.6 * 3.2 + 3.2 * 3.2) / 3
    + 1.25 * 1.25 * 4 + 1.25 ** 3 / 3);
  const volume = 40 * 30 * 8 - holes;
  assert.ok(Math.abs(report.bodies[0].volumeMm3 - volume) < volume * 1e-9, `${report.bodies[0].volumeMm3} vs ${volume}`);
  const step = report.outputs.find(o => o.format === 'step');
  assert.equal(step.exact, true, JSON.stringify(step));
  const text = fs.readFileSync(path.join(dir, 'holes.step'), 'utf8');
  assert.match(text, /CONICAL_SURFACE/);
  assert.doesNotMatch(text, /spline approximation/);
  assert.ok(report.outputs.some(o => o.format === 'stl'), JSON.stringify(report.outputs));
});

test('a revolve cut across the plate refuses by name', t => {
  const {status, report} = cli(t, source('vector(1, 0, 0)').replace('vector(0, -1, 0), vector(1, 0, 0)', 'vector(0, -1, 0), vector(0, 0, 1)'), 'step');
  assert.equal(status, 2, JSON.stringify(report));
  // boolean3d G12: the family refusal routes to the general Boolean, which refuses by its own row.
  assert.equal(report.refusals[0].code, 'boolean/ssi-row-unavailable');
});

const cylinderUnionSource = (x = 16) => `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export const holes = defineFeature(function(context is Context, id is Id, definition is map) precondition {} {
    fCuboid(context, id + "plate", {"corner1":vector(0,0,0)*millimeter, "corner2":vector(32,24,10)*millimeter});
    fCylinder(context, id + "bore", {"bottomCenter":vector(16,12,-1)*millimeter,
        "topCenter":vector(16,12,11)*millimeter, "radius":2*millimeter});
    fCylinder(context, id + "step", {"bottomCenter":vector(${x},12,7)*millimeter,
        "topCenter":vector(${x},12,11)*millimeter, "radius":4*millimeter});
    opBoolean(context, id + "cut", {"targets":qCreatedBy(id+"plate",EntityType.BODY),
        "tools":qUnion([qCreatedBy(id+"bore",EntityType.BODY),qCreatedBy(id+"step",EntityType.BODY)]),
        "operationType":BooleanOperationType.SUBTRACTION});
});`;

test('coaxial cylinder subtraction exports the exact stepped hole', t => {
  const {status, report, dir, stderr} = cli(t, cylinderUnionSource(), 'all');
  assert.equal(status, 0, JSON.stringify(report) + stderr);
  assert.equal(report.bodies.length, 1);
  assert.equal(report.bodies[0].exact, true);
  const volume = 32 * 24 * 10 - Math.PI * (4 * 7 + 16 * 3);
  assert.ok(Math.abs(report.bodies[0].volumeMm3 - volume) < volume * 1e-9);
  assert.equal(report.outputs.find(o => o.format === 'step').exact, true);
  assert.match(fs.readFileSync(path.join(dir, 'holes.step'), 'utf8'), /CYLINDRICAL_SURFACE/);
});

test('offset overlapping cylinder tools retain exact offset counterbore geometry', t => {
  const {status, report, dir, stderr} = cli(t, cylinderUnionSource(16.0001), 'step');
  assert.equal(status, 0, JSON.stringify(report) + stderr);
  assert.equal(report.bodies.length,1);
  const body=report.bodies[0];
  const volume=32*24*10-Math.PI*(4*7+16*3);
  assert.ok(Math.abs(body.volumeMm3-volume)<volume*1e-9);
  assert.equal(body.closed,true);
  assert.equal(body.boundToConstruction,true);
  assert.equal(body.exact,true);
  assert.equal(body.topology.faces,9);
  const result=spawnSync('uv',['run','scripts/validate-step.py',path.join(dir,'holes')],{cwd:root,encoding:'utf8',timeout:120_000,maxBuffer:2<<20});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
  for(const row of JSON.parse(result.stdout))assert.equal(row.valid,true);
});
