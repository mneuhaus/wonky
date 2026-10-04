import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
process.env.WONKY_BACKEND = 'rust';
const {build} = await import('../src/index.mjs');
const {toStep} = await import('../src/exporters.mjs');
const {serializeModel} = await import('../src/construction-history.mjs');
const {measureRustBody, rustModelKernel} = await import('../src/native/rust-host.mjs');
const root = fileURLToPath(new URL('../', import.meta.url));
const body = id => `qCreatedBy(id+"${id}",EntityType.BODY)`;
const source = crossing => `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export const main = defineFeature(function(context is Context, id is Id, definition is map) precondition {} {
  fCuboid(context,id+"stock",{"corner1":vector(0,0,0)*millimeter,"corner2":vector(48,40,12)*millimeter});
  fCylinder(context,id+"z1",{"bottomCenter":vector(8,8,-2)*millimeter,"topCenter":vector(8,8,14)*millimeter,"radius":3*millimeter});
  fCylinder(context,id+"z2",{"bottomCenter":vector(40,32,-2)*millimeter,"topCenter":vector(40,32,14)*millimeter,"radius":3*millimeter});
  fCylinder(context,id+"y",{"bottomCenter":vector(${crossing ? 12 : 24},-2,6)*millimeter,"topCenter":vector(${crossing ? 12 : 24},42,6)*millimeter,"radius":2*millimeter});
  opBoolean(context,id+"cut",{"targets":${body('stock')},"tools":qUnion([${body('z1')},${body('z2')},${body('y')}]),"operationType":BooleanOperationType.SUBTRACTION});
});`;

test('perpendicular disjoint through-bores retain exact volume, topology and OCCT-valid STEP', async t => {
  const model = await build(source(false), {feature: 'main'});
  assert.equal(model.bodies.length, 1);
  const measured = measureRustBody(rustModelKernel(model), model.bodies[0]);
  assert.equal(measured.topology.faces, 9);
  assert.equal(measured.topology.genus, 3);
  assert.ok(Math.abs(measured.volumeMm3 - (23040 - 376 * Math.PI)) < 1e-7);
  assert.ok(measured.volumeRelBound < 1e-8);
  assert.equal(measured.validity.closed, true);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wonky-cross-axis-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const prefix = path.join(dir, 'bores');
  fs.writeFileSync(prefix + '.step', toStep(model, 'bores'));
  fs.writeFileSync(prefix + '.brep.json', serializeModel(model));
  const result = spawnSync('uv', ['run', 'scripts/validate-step.py', prefix],
    {cwd: root, encoding: 'utf8', timeout: 120_000});
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(JSON.parse(result.stdout)[0].valid, true);
});

test('crossing perpendicular bores refuse their unsolved cylinder-cylinder intersection', async () => {
  // boolean3d G12: the family refusal routes to the general Boolean, which refuses by its own row.
  await assert.rejects(build(source(true), {feature: 'main'}), e =>
    e.name === 'RustCapabilityError' && e.builtin === 'opBoolean' && e.reason === 'boolean/ssi-row-unavailable'
      && e.message.includes('revolution×revolution/non-parallel-or-metric'));
});

const sketchThroughSource = radialOrigin => `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export const main = defineFeature(function(context is Context, id is Id, definition is map) precondition {} {
  fCuboid(context,id+"stock",{"corner1":vector(0,0,0)*millimeter,"corner2":vector(40,24,20)*millimeter});
  var z = newSketchOnPlane(context,id+"sz",{"sketchPlane":plane(vector(0,0,-1)*millimeter,vector(0,0,1),vector(1,0,0))});
  skCircle(z,"c",{"center":vector(10,6)*millimeter,"radius":2*millimeter});
  skSolve(z);
  opExtrude(context,id+"z",{"entities":qSketchRegion(id+"sz",false),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":22*millimeter});
  var x = newSketchOnPlane(context,id+"sx",{"sketchPlane":plane(vector(-1,${radialOrigin},0)*millimeter,vector(1,0,0),vector(0,1,0))});
  skCircle(x,"c",{"center":vector(18,14)*millimeter,"radius":2*millimeter});
  skSolve(x);
  opExtrude(context,id+"x",{"entities":qSketchRegion(id+"sx",false),"direction":vector(1,0,0),"endBound":BoundingType.BLIND,"endDepth":42*millimeter});
  opBoolean(context,id+"cut",{"targets":${body('stock')},"tools":qUnion([${body('z')},${body('x')}]),"operationType":BooleanOperationType.SUBTRACTION});
});`;

test('sketch-frame cross-axis through cuts clip exact rational ends and export valid STEP', async t => {
  const model = await build(sketchThroughSource(0), {feature: 'main'});
  const measured = measureRustBody(rustModelKernel(model), model.bodies[0]);
  assert.equal(model.bodies.length, 1);
  assert.equal(measured.topology.faces, 8);
  assert.equal(measured.topology.genus, 2);
  assert.equal(measured.validity.closed, true);
  assert.ok(Math.abs(measured.volumeMm3 - (19200 - 240 * Math.PI)) < 1e-7);
  assert.ok(measured.volumeRelBound < 1e-8);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wonky-cross-frame-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const prefix = path.join(dir, 'bores');
  fs.writeFileSync(prefix + '.step', toStep(model, 'bores'));
  fs.writeFileSync(prefix + '.brep.json', serializeModel(model));
  const result = spawnSync('uv', ['run', 'scripts/validate-step.py', prefix],
    {cwd: root, encoding: 'utf8', timeout: 120_000});
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(JSON.parse(result.stdout)[0].valid, true);
});

// Exact through-end clipping cannot round the related radial coordinate. The
// family path refuses this source recipe's perpendicular X/Z axes; the general
// Boolean (boolean3d G12) builds it exactly. Each bore band's plane-cut rings
// are written on the band's seam (the G11 writer re-charts them).
test('a rational radial coordinate is built exactly, never rounded by through-end clipping', async t => {
  const model = await build(sketchThroughSource(1), {feature: 'main'});
  assert.equal(model.bodies.length, 1);
  const measured = measureRustBody(rustModelKernel(model), model.bodies[0]);
  assert.equal(measured.certificate, 'GeneralBooleanModel');
  assert.equal(measured.topology.faces, 8);
  assert.equal(measured.topology.genus, 2);
  assert.equal(measured.validity.closed, true);
  const volume = 19200 - 240 * Math.PI;
  assert.ok(Math.abs(measured.volumeMm3 - volume) < 1e-7);
  // Closed-form centroid: the z bore r 2 at (10, 6), the x bore r 2 at
  // (y, z) = (1 + 18, 14). A rounded radial coordinate moves the x bore.
  const moment = [0, 1, 2].map(k => 19200 * [20, 12, 10][k] - 80 * Math.PI * [10, 6, 10][k] - 160 * Math.PI * [20, 19, 14][k]);
  measured.centroidMm.forEach((c, k) => assert.ok(Math.abs(c - moment[k] / volume) < 1e-9, `centroid ${k}: ${c}`));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wonky-cross-frame-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const prefix = path.join(dir, 'bores');
  fs.writeFileSync(prefix + '.step', toStep(model, 'bores'));
  fs.writeFileSync(prefix + '.brep.json', serializeModel(model));
  const result = spawnSync('uv', ['run', 'scripts/validate-step.py', prefix],
    {cwd: root, encoding: 'utf8', timeout: 120_000});
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(JSON.parse(result.stdout)[0].valid, true);
});
