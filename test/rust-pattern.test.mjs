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
const { measureRustBody, distanceRustBodies, describeRustBody, rustModelKernel, RustCapabilityError } = await import('../src/native/rust-host.mjs');
const { toStep } = await import('../src/exporters.mjs');
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
