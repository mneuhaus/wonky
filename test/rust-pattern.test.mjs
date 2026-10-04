// Interpreter/transport owner: patterns select real bodies, apply binary64
// transforms without mm rounding, keep copies separately named, and publish
// all copies atomically. Numerical proof belongs to pattern_distance.rs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
process.env.WONKY_BACKEND = 'rust';
const { build } = await import('../src/index.mjs');
const { measureRustBody, distanceRustBodies, describeRustBody, placeRustBody, rustModelKernel, RustCapabilityError } = await import('../src/native/rust-host.mjs');
const { toStep } = await import('../src/exporters.mjs');
const { serializeModel } = await import('../src/construction-history.mjs');
const { UnsupportedFeatureError } = await import('../src/errors.mjs');
const profile = fs.readFileSync(new URL('../fixtures/cad-acid/fs/acid-profile.fs', import.meta.url), 'utf8');

function feature(operations) {
  return `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export const f = defineFeature(function(context is Context, id is Id, definition is map) precondition {} {
  var s = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1)) });
  skRectangle(s, "r", { "firstCorner" : vector(2, 0) * millimeter, "secondCorner" : vector(6, 3) * millimeter });
  skSolve(s);
  opExtrude(context, id + "seed", { "entities" : qSketchRegion(id + "s"), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 5 * millimeter });
  ${operations}
});`;
}
test('mirror AC09 builds and exports separately selected outward-oriented bodies in every frame', async () => {
  for (const variant of ['V0', 'V1', 'V2', 'V3']) {
    const model = await build(profile, { feature: 'acidProfile', parameters: { zone: 'AcidProfileZone.AC09', variant: `AcidVariant.${variant}` }, trace: false });
    assert.equal(model.bodies.length, 2);
    assert.deepEqual(model.bodies.map(b => b.name), [`AC09_0_${variant}`, `AC09_1_${variant}`]);
    const kernel = rustModelKernel(model);
    const measurements = model.bodies.map(b => measureRustBody(kernel, b));
    assert.ok(measurements.every(m => m.boundToConstruction && m.validity.closed && m.validity.positive));
    assert.ok(measurements.every(m => Math.abs(m.volumeMm3 - 96) < 1e-10));
    // Public observation projection is consumed without STEP: its oriented
    // loops must also be outward, independently of the exporter owner test.
    for (const { projection: { vertices, edges, faces } } of measurements) {
      const subtract = (a, b) => a.map((v, k) => v - b[k]);
      const centroid = vertices[0].map((v, k) => v + vertices.reduce((s, p) => s + p[k] - v, 0) / vertices.length);
      for (const face of faces.flat()) {
        const ends = face.map(([edge, forward]) => forward ? edges[edge] : [...edges[edge]].reverse());
        ends.forEach((end, k) => assert.equal(end[1], ends[(k + 1) % ends.length][0], 'native projection loop must close'));
        const points = ends.map(([start]) => vertices[start]);
        const a = subtract(points[1], points[0]), b = subtract(points[2], points[0]);
        const normal = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
        assert.ok(normal.reduce((sum, v, k) => sum + v * (points[0][k] - centroid[k]), 0) > 0, 'native projection face must point outward');
      }
    }
    assert.ok(Math.abs(distanceRustBodies(kernel, ...model.bodies).distanceMm - 4) < 1e-9);
    assert.equal(toStep(model, 'mirror').match(/MANIFOLD_SOLID_BREP\(/g).length, 2);
    const wc0 = describeRustBody(kernel, model.bodies[1]).body;
    assert.equal(wc0.frames.at(-1).kind, 'AffineImage');
    assert.equal(wc0.constructions.at(-1).operation.kind, 'AffineTransform');
  }
});
// The observation boundary, not the numeric algorithm, owns keeping the
// proven interval in saved evidence. The previous script silently dropped it.
test('saved native observations retain distance bounds and misplaced-body measurement failures', () => {
 for (const misplaced of [false, true]) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rust-distance-observation-'));
  try {
    const catalog = path.join(root, 'fixtures/cad-acid/zones.json');
    const source = path.join(dir, 'profile.fs');
    fs.writeFileSync(source, misplaced ? profile.replace('mirrorAcross(plane(cs.origin, cs.xAxis))', 'rotationAround(line(cs.origin, cs.zAxis), 180 * degree)') : profile);
    const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const request = { source, sourceSha256: hash(source), zonesSha256: hash(catalog), feature: 'acidProfile', catalog,
      parameters: { zone: 'AcidProfileZone.AC09', variant: 'AcidVariant.V3' }, zone: 'AC09', variant: 'V3', out: dir };
    const file = path.join(dir, 'request.json');
    fs.writeFileSync(file, JSON.stringify(request));
    const run = spawnSync(process.execPath, [path.join(root, 'scripts/acid/build-wonky.mjs'), file],
      { cwd: root, env: { ...process.env, WONKY_BACKEND: 'rust' }, encoding: 'utf8', timeout: 60_000 });
    assert.equal(run.status, 0, run.stderr);
    const record = JSON.parse(fs.readFileSync(path.join(dir, 'build.json')));
    assert.equal(record.outcome, 'built', 'successful geometry must not become a capability refusal during observation');
    const zone = JSON.parse(fs.readFileSync(catalog)).zones.find(z => z.id === 'AC09');
    if (misplaced) {
      assert.match(Object.values(record.nativeObservation.metrics.measurementErrors).join(' '), /selector must identify one solid/);
      assert.equal(Object.keys(record.nativeObservation.metrics.measurements).includes('gap'), false);
      assert.ok(record.nativeObservation.metrics.validity.brep);
      assert.equal(record.nativeObservation.metrics.bodies.length, 2);
      continue;
    }
    const distances = zone.closedForm.measurements.filter(m => m.definition.kind === 'bodyDistance');
    assert.ok(distances.length > 0);
    for (const { name } of distances) {
      const metrics = record.nativeObservation.metrics;
      const interval = record.nativeObservation.measurementEvidence?.[name];
      assert.ok(interval, 'saved distance enclosure missing');
      assert.ok(Number.isFinite(interval.distanceMm) && Number.isFinite(interval.boundMm));
      assert.ok(interval.distanceMm === metrics.measurements[name] && interval.boundMm >= 0);
      assert.ok(interval.boundMm < 1e-12);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
 }
});
test('pattern translation keeps interpreter metres, not rounded millimetres, and rotation copies are general', async () => {
  const source = feature(`opPattern(context, id + "copies", { "entities" : qCreatedBy(id + "seed", EntityType.BODY),
    "transforms" : [transform(vector(10.000000000000002, 0, 0) * millimeter), rotationAround(line(vector(0, 0, 0) * millimeter, vector(0, 0, 1)), 90 * degree)], "instanceNames" : ["shift", "turn"] });`);
  const model = await build(source, { feature: 'f', trace: false });
  assert.equal(model.bodies.length, 3);
  const kernel = rustModelKernel(model);
  const wc0 = describeRustBody(kernel, model.bodies[1]).body;
  const bytes = Buffer.alloc(8); bytes.writeDoubleLE(10.000000000000002 * 0.001);
  assert.equal(wc0.frames.at(-1).translation[0], bytes.readBigUInt64LE().toString(16).padStart(16, '0'));
  const turned = measureRustBody(kernel, model.bodies[2]);
  assert.ok(Math.abs(turned.bboxMm.min[0] + 3) < 1e-12);
  assert.ok(Math.abs(turned.bboxMm.max[1] - 6) < 1e-12);
  assert.ok(Math.abs(turned.volumeMm3 - 60) < 1e-12);
});
test('pattern refuses unsupported metrics through try silent and rejects duplicate names without partial output', async () => {
  const scaled = feature(`try silent { opPattern(context, id + "p", { "entities" : qCreatedBy(id + "seed", EntityType.BODY),
    "transforms" : [transform(vector(10, 0, 0) * millimeter), transform(matrix([[2,0,0],[0,1,0],[0,0,1]]), vector(0,0,0) * millimeter)], "instanceNames" : ["ok", "bad"] }); }`);
  const error = await build(scaled, { feature: 'f', trace: false }).then(() => null, e => e);
  assert.ok(error instanceof RustCapabilityError && error instanceof UnsupportedFeatureError, String(error));
  assert.match(error.message, /pattern\/metric-not-near-isometric/);
  const duplicates = feature(`try silent { opPattern(context, id + "p", { "entities" : qCreatedBy(id + "seed", EntityType.BODY),
    "transforms" : [transform(vector(10,0,0) * millimeter), transform(vector(20,0,0) * millimeter)], "instanceNames" : ["a","a"] }); }`);
  const model = await build(duplicates, { feature: 'f', trace: false });
  assert.equal(model.bodies.length, 1);
  assert.equal(model.bodies[0].validation.volumeMm3, 60);
});

test('translated and rationally rotated planar Boolean construction lines survive repeated public placement and wire replay', async () => {
  const model = await build(`FeatureScript 3044;
import(path:"onshape/std/geometry.fs",version:"3044.0");
export const f=defineFeature(function(context is Context,id is Id,definition is map) precondition {} {
  fCuboid(context,id+"a",{"corner1":vector(0,0,0)*meter,"corner2":vector(2,2,2)*meter});
  opTransform(context,id+"turn",{"bodies":qCreatedBy(id+"a",EntityType.BODY),"transform":toWorld(coordSystem(vector(0,0,0)*meter,vector(12,5,0),vector(0,0,1)))});
  fCuboid(context,id+"b",{"corner1":vector(1,1,0)*meter,"corner2":vector(3,3,2)*meter});
  opBoolean(context,id+"union",{"tools":qUnion([qCreatedBy(id+"a",EntityType.BODY),qCreatedBy(id+"b",EntityType.BODY)]),"operationType":BooleanOperationType.UNION});
});`, { feature: 'f' });
  assert.equal(model.bodies.length, 1);
  const kernel = rustModelKernel(model), source = model.bodies[0];
  const original = measureRustBody(kernel, source);
  assert.ok(describeRustBody(kernel, source).body.curves.some(c => c.geometry.kind === 'ConstructionLine'));
  const translation = { origin: [1, 0, 0], x: [1, 0, 0], z: [0, 0, 1] };
  const rotation = { rational: { rows: [[4, -3, 0], [3, 4, 0], [0, 0, 5]], denominator: 5 } };
  for (const maps of [[translation], [rotation], [translation, rotation, translation]]) {
    const placed = maps.reduce((body, frame) => placeRustBody(kernel, body, frame), source);
    const measured = measureRustBody(kernel, placed);
    assert.equal(measured.boundToConstruction, true);
    assert.equal(measured.validity.closed, true);
    assert.equal(measured.validity.positive, true);
    assert.ok(Math.abs(measured.volumeMm3 - original.volumeMm3) <= original.volumeMm3 * original.volumeRelBound);
    const expected = original.projection.vertices.map(point => maps.reduce((p, frame) => {
      if (!frame.rational) return p.map((x, k) => x + 1000 * frame.origin[k]);
      const { rows, denominator } = frame.rational;
      return rows.map(row => row.reduce((sum, x, k) => sum + x * p[k], 0) / denominator);
    }, point));
    measured.projection.vertices.forEach((point, i) => point.forEach((x, k) => {
      assert.ok(Math.abs(x - expected[i][k]) <= 1e-9, 'observed vertices retain transform order');
    }));
    // describe and measure decode and audit the published wire independently.
    assert.equal(describeRustBody(kernel, placed).body.frames.at(-1).kind, maps.at(-1).rational ? 'RationalImage' : 'InterpreterImage');
  }
});
// Exercise the geometry consumer, after ordinary FS matrix reconstruction has
// discarded all Matrix metadata. No taint or scalar lineage is a rigid witness.
test('circular placement refuses reconstructed rounded rotations through try silent', async () => {
  const source = expression => `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export const f = defineFeature(function(context is Context, id is Id, definition is map) precondition {} {
  fCylinder(context, id + "seed", {"bottomCenter": vector(0,0,0)*millimeter,
    "topCenter": vector(0,0,8)*millimeter, "radius": 4*millimeter});
  const r = rotationMatrix3d(vector(0,0,1), 15*degree);
  try silent { opPattern(context, id + "p", {"entities": qCreatedBy(id + "seed", EntityType.BODY),
    "transforms": [transform(${expression}, vector(0,0,0)*meter)], "instanceNames": ["copy"]}); }
});`;
  for (const expression of ['matrix([r[0],r[1],r[2]])',
    'matrix([[r[0][0],r[0][1],r[0][2]],[r[1][0],r[1][1],r[1][2]],[r[2][0],r[2][1],r[2][2]]])',
    'matrix([[1, -1e-20, 0],[1e-20, 1, 0],[0,0,1]])']) {
    await assert.rejects(build(source(expression), {feature:'f',trace:false}),
      e => e instanceof RustCapabilityError && /cylinder\/non-rigid-placement/.test(e.message), expression);
  }
  await assert.rejects(build(source('matrix([r[0],r[1],r[2]])').replace('15*degree','90*degree'), {feature:'f',trace:false}),
    e => e instanceof RustCapabilityError && /cylinder\/non-rigid-placement/.test(e.message));
  // A non-quarter constructor has no exact rigid witness either.
  await assert.rejects(build(source('matrix([r[0],r[1],r[2]])').replace(
    'transform(matrix([r[0],r[1],r[2]]), vector(0,0,0)*meter)',
    'rotationAround(line(vector(0,0,0)*meter,vector(0,0,1)),15*degree)'), {feature:'f',trace:false}),
    e => e instanceof RustCapabilityError && /cylinder\/non-rigid-placement/.test(e.message));
  // Exactly representable rotations and translations remain usable geometry.
  const model = await build(source('matrix([[0,-1,0],[1,0,0],[0,0,1]])'), {feature:'f',trace:false});
  assert.equal(model.bodies.length, 2);
  assert.ok(JSON.parse(serializeModel(model)).bodies.every(b => b.exact === true));
  for (const body of model.bodies) {
    const m = measureRustBody(rustModelKernel(model),body);
    assert.equal(m.boundToConstruction,true);
    assert.ok(m.validity.closed && m.validity.positive);
  }
});

test('exact quarter-turn witness is tied to unchanged constructor output', async () => {
  const { Matrix, Transform, Vector, Quantity } = await import('../src/values.mjs');
  const { rememberRotationPlacement, exactRotationSteps } = await import('../src/native/rust-placement.mjs');
  const matrix = () => new Matrix([[Math.cos(Math.PI/2),-1,0],[1,Math.cos(Math.PI/2),0],[0,0,1]]);
  const zero = () => new Vector([0,0,0].map(v => new Quantity(v)));
  const t = rememberRotationPlacement(new Transform(matrix(),new Vector([0.256,-0.768,0].map(v => new Quantity(v)))), [0,0,1],Math.PI/2,[0.512,-0.256,0.128]);
  assert.equal(exactRotationSteps(t).length,3, 'hinge translations stay separate');
  assert.deepEqual(exactRotationSteps(t)[1], {origin:[0,0,0],x:[0,1,0],z:[0,0,1]});
  assert.equal(exactRotationSteps(new Transform(new Matrix(t.linear.rows.map(r => [...r])),t.translation)),null);
  t.linear.rows[0][0] = 1e-20;
  assert.equal(exactRotationSteps(t),null, 'edited coefficients invalidate the witness');
  const shifted = rememberRotationPlacement(new Transform(matrix(),zero()), [0,0,1],Math.PI/2,[0,0,0]);
  shifted.translation.items[0] = new Quantity(1e-20);
  assert.equal(exactRotationSteps(shifted),null, 'edited translation invalidates the witness');
  for (const [axis,angle] of [[[0,0,1],Math.PI/12],[[0.6,0.8,0],Math.PI/2]]) {
    const unsupported = rememberRotationPlacement(new Transform(matrix(),zero()),axis,angle,[0,0,0]);
    assert.equal(exactRotationSteps(unsupported),null);
  }
});

test('source-chart quarter patterns retain exact constructed geometry in every AC08 frame', async () => {
  for (const variant of ['V0','V1','V2','V3']) {
    const model = await build(profile, { feature:'acidProfile', parameters:{ zone:'AcidProfileZone.AC08', variant:`AcidVariant.${variant}` },trace:false });
    assert.equal(model.bodies.length,4);
    for (const body of model.bodies) {
      const m = measureRustBody(rustModelKernel(model),body);
      assert.ok(m.boundToConstruction && m.validity.closed && m.validity.positive);
      assert.ok(Math.abs(m.volumeMm3 - 16*Math.PI) < 1e-10);
    }
    assert.equal(toStep(model,'source-quarter').match(/MANIFOLD_SOLID_BREP\(/g).length,4);
  }
});

test('source rotation chart requires constructor lineage and unchanged axis and plane snapshots', async () => {
  const { Vector } = await import('../src/values.mjs');
  const { rememberFrame, rememberPlane, rememberLine, sourceRotationChart } = await import('../src/construction-frame.mjs');
  const make = () => {
    const cs = rememberFrame({origin:new Vector([1.5,0,0]),xAxis:new Vector([0.8,0.6,0]),zAxis:new Vector([0,0,1])});
    const plane = rememberPlane({origin:cs.origin,x:cs.xAxis,normal:cs.zAxis},cs.zAxis,cs.xAxis);
    const line = rememberLine({origin:cs.origin,direction:new Vector([0,0,1])},cs.zAxis);
    return {cs,plane,line};
  };
  const a = make();
  assert.deepEqual(sourceRotationChart(a.line),{origin:[1.5,0,0],x:[0.8,0.6,0],z:[0,0,1]});
  const copied = rememberLine({origin:a.cs.origin,direction:new Vector([0,0,1])},new Vector([0,0,1]));
  assert.equal(sourceRotationChart(copied),null,'equal values are not source construction identity');
  a.line.direction.items[0] = 1e-20;
  assert.equal(sourceRotationChart(a.line),null,'edited axis invalidates chart');
  const b = make(); b.plane.x.items[0] = 0.8000000000000002;
  assert.equal(sourceRotationChart(b.line),null,'edited plane invalidates chart');
  const c = make(); c.line.origin.items[0] += 1e-20; // Binary64 increment may round away; use one representable ULP.
  c.line.origin.items[0] = 1.5000000000000002;
  assert.equal(sourceRotationChart(c.line),null,'edited hinge invalidates chart');
});
