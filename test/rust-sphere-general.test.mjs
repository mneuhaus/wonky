// boolean3d G14: sphere operands in the general exact Boolean, end to end from
// unmodified FeatureScript. CAD-Acid AC111's construction (box minus a sphere
// crossing two box faces: the front circle r^2 = 12 has no rational point)
// against its closed forms 4000 - 36 pi mm^3 and 1600 + 22 pi/3 - 4 sqrt 3
// mm^2; OCCT (validate-step.py) is an oracle of the written STEP only. A
// ball resting on a box (probe E3) touches it in one point: the union is
// non-manifold (the AC12 convention). Probe G8 (below) has no vertex at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
process.env.WONKY_BACKEND = 'rust';
const { build } = await import('../src/index.mjs');
const { toStep } = await import('../src/exporters.mjs');
const { serializeModel } = await import('../src/construction-history.mjs');
const { measureRustBody, rustModelKernel } = await import('../src/native/rust-host.mjs');
const root = fileURLToPath(new URL('../', import.meta.url));

const pocket = `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export const f = defineFeature(function(context is Context, id is Id, definition is map) precondition {} {
    fCuboid(context,id+"base",{"corner1":vector(0,0,0)*millimeter,"corner2":vector(20,20,10)*millimeter});
    fSphere(context,id+"ball",{"center":vector(10,2,10)*millimeter,"radius":4*millimeter});
    opBoolean(context,id+"cut",{"targets":qCreatedBy(id+"base",EntityType.BODY),"tools":qCreatedBy(id+"ball",EntityType.BODY),"operationType":BooleanOperationType.SUBTRACTION});
});`;

test('a sphere pocket crossing two box faces builds with exact measures and an analytic sphere in STEP', async () => {
  const model = await build(pocket, { feature: 'f' });
  assert.equal(model.bodies.length, 1);
  const m = measureRustBody(rustModelKernel(model), model.bodies[0], { surfaceTypes: true });
  assert.equal(m.certificate, 'GeneralBooleanModel');
  const volume = 4000 - 36 * Math.PI, area = 1600 + 22 * Math.PI / 3 - 4 * Math.sqrt(3);
  assert.ok(Math.abs(m.volumeMm3 - volume) <= 1e-9 * volume, `volume ${m.volumeMm3}`);
  assert.ok(Math.abs(m.areaMm2 - area) <= 1e-9 * area, `area ${m.areaMm2}`);
  const t = m.topology;
  assert.deepEqual([t.bodies, t.shells, t.faces, t.edges, t.vertices, t.genus, t.ringEdges], [1, 1, 7, 15, 10, 0, 0]);
  assert.deepEqual(m.surfaceTypes, { Plane: 6, Sphere: 1 });
  [[m.bboxMm.min, [0, 0, 0]], [m.bboxMm.max, [20, 20, 10]]].forEach(([got, want]) =>
    want.forEach((x, k) => assert.ok(Math.abs(got[k] - x) <= 1e-9, `bbox ${JSON.stringify(m.bboxMm)}`)));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wonky-g14-'));
  try {
    const step = toStep(model, 'g14');
    // Analytic geometry throughout: the sphere is written in a chart whose
    // coordinate lines are its trims, so every sphere pcurve is an exact LINE.
    assert.ok(step.includes('SPHERICAL_SURFACE') && step.includes('PCURVE(') && !step.includes('B_SPLINE'));
    const prefix = path.join(dir, 'g14');
    fs.writeFileSync(`${prefix}.step`, step);
    fs.writeFileSync(`${prefix}.brep.json`, serializeModel(model));
    const v = spawnSync('uv', ['run', path.join(root, 'scripts/validate-step.py'), prefix], { cwd: root, encoding: 'utf8', timeout: 300000 });
    assert.equal(v.status, 0, v.stdout + v.stderr);
    const [report] = JSON.parse(v.stdout);
    assert.equal(report.valid, true, JSON.stringify(report).slice(0, 2000));
    assert.deepEqual(report.surfaceTypes, { Plane: 6, Sphere: 1 }, JSON.stringify(report.surfaceTypes));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a ball touching a box in one point makes a non-manifold union', async () => {
  const touch = pocket
    .replace('"corner1":vector(0,0,0)*millimeter,"corner2":vector(20,20,10)*millimeter', '"corner1":vector(-10,-10,-4)*millimeter,"corner2":vector(10,10,0)*millimeter')
    .replace('"center":vector(10,2,10)*millimeter,"radius":4*millimeter', '"center":vector(0,0,5)*millimeter,"radius":5*millimeter')
    .replace('{"targets":qCreatedBy(id+"base",EntityType.BODY),"tools":qCreatedBy(id+"ball",EntityType.BODY),"operationType":BooleanOperationType.SUBTRACTION}',
      '{"tools":qUnion([qCreatedBy(id+"base",EntityType.BODY),qCreatedBy(id+"ball",EntityType.BODY)]),"operationType":BooleanOperationType.UNION}');
  assert.notEqual(touch, pocket);
  await assert.rejects(build(touch, { feature: 'f' }), error => /non-manifold-result/.test(`${error.reason ?? ''} ${error.message}`));
});

// Probe G8: an r 5 ball ∪ an r 2 coaxial pin (fCylinder, z −10..0) meet in the
// ring z = −√21, so the result has no vertex at all (three faces, two rings).
// V = π(370/3 + 14√21), A = π(94 + 6√21) from the zone, pin side and pin end.
test('a sphere joined by a coaxial pin builds without vertices, measures exactly and writes valid STEP', async () => {
  const pin = pocket
    .replace('fCuboid(context,id+"base",{"corner1":vector(0,0,0)*millimeter,"corner2":vector(20,20,10)*millimeter});',
      'fCylinder(context,id+"base",{"bottomCenter":vector(0,0,-10)*millimeter,"topCenter":vector(0,0,0)*millimeter,"radius":2*millimeter});')
    .replace('"center":vector(10,2,10)*millimeter,"radius":4*millimeter', '"center":vector(0,0,0)*millimeter,"radius":5*millimeter')
    .replace('{"targets":qCreatedBy(id+"base",EntityType.BODY),"tools":qCreatedBy(id+"ball",EntityType.BODY),"operationType":BooleanOperationType.SUBTRACTION}',
      '{"tools":qUnion([qCreatedBy(id+"ball",EntityType.BODY),qCreatedBy(id+"base",EntityType.BODY)]),"operationType":BooleanOperationType.UNION}');
  assert.ok(pin.includes('fCylinder') && pin.includes('UNION'));
  const model = await build(pin, { feature: 'f' });
  assert.equal(model.bodies.length, 1);
  const m = measureRustBody(rustModelKernel(model), model.bodies[0], { surfaceTypes: true });
  assert.equal(m.certificate, 'GeneralBooleanModel');
  const r21 = Math.sqrt(21), volume = Math.PI * (370 / 3 + 14 * r21), area = Math.PI * (94 + 6 * r21);
  assert.ok(Math.abs(m.volumeMm3 - volume) <= 1e-9 * volume, `volume ${m.volumeMm3}`);
  assert.ok(Math.abs(m.areaMm2 - area) <= 1e-9 * area, `area ${m.areaMm2}`);
  const t = m.topology;
  assert.deepEqual([t.bodies, t.faces, t.ringEdges], [1, 3, 2], JSON.stringify(t));
  assert.deepEqual(m.surfaceTypes, { Plane: 1, Cylinder: 1, Sphere: 1 });
  // The ball's pole and equator bound the box; no ring reaches them.
  [[m.bboxMm.min, [-5, -5, -10]], [m.bboxMm.max, [5, 5, 5]]].forEach(([got, want]) =>
    want.forEach((x, k) => assert.ok(Math.abs(got[k] - x) <= 1e-9, `bbox ${JSON.stringify(m.bboxMm)}`)));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wonky-g14-g8-'));
  try {
    const step = toStep(model, 'g8');
    assert.ok(step.includes('SPHERICAL_SURFACE') && step.includes('CYLINDRICAL_SURFACE') && !step.includes('B_SPLINE'));
    const prefix = path.join(dir, 'g8');
    fs.writeFileSync(`${prefix}.step`, step);
    fs.writeFileSync(`${prefix}.brep.json`, serializeModel(model));
    const v = spawnSync('uv', ['run', path.join(root, 'scripts/validate-step.py'), prefix], { cwd: root, encoding: 'utf8', timeout: 300000 });
    assert.equal(v.status, 0, v.stdout + v.stderr);
    const [report] = JSON.parse(v.stdout);
    assert.equal(report.valid, true, JSON.stringify(report).slice(0, 2000));
    assert.deepEqual(report.surfaceTypes, { Plane: 1, Cylinder: 1, Sphere: 1 }, JSON.stringify(report.surfaceTypes));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
