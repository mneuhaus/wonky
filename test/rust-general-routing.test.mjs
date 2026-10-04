// boolean3d G12: a family capability refusal routed to the general exact
// Boolean, end to end from unmodified FeatureScript (CAD-Acid AC66's
// construction: a pocket cut after a through bore). Expected values are the
// closed forms 5440 - 40 pi mm^3 and 2296 + 32 pi mm^2; OCCT (validate-step.py)
// is an oracle of the written STEP only.
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

const source = `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export const f = defineFeature(function(context is Context, id is Id, definition is map) precondition {} {
    fCuboid(context,id+"base",{"corner1":vector(0,0,0)*millimeter,"corner2":vector(32,18,10)*millimeter});
    fCylinder(context,id+"bore",{"bottomCenter":vector(8,9,-1)*millimeter,"topCenter":vector(8,9,11)*millimeter,"radius":2*millimeter});
    fCuboid(context,id+"pocket",{"corner1":vector(20,4,6)*millimeter,"corner2":vector(28,14,12)*millimeter});
    opBoolean(context,id+"drill",{"targets":qCreatedBy(id+"base",EntityType.BODY),"tools":qCreatedBy(id+"bore",EntityType.BODY),"operationType":BooleanOperationType.SUBTRACTION});
    opBoolean(context,id+"cut",{"targets":qCreatedBy(id+"base",EntityType.BODY),"tools":qCreatedBy(id+"pocket",EntityType.BODY),"operationType":BooleanOperationType.SUBTRACTION});
});`;

test('pocket after bore builds through the general Boolean with exact measures and analytic STEP', async () => {
  const model = await build(source, { feature: 'f' });
  assert.equal(model.bodies.length, 1);
  const m = measureRustBody(rustModelKernel(model), model.bodies[0], { surfaceTypes: true });
  assert.equal(m.certificate, 'GeneralBooleanModel');
  const volume = 5440 - 40 * Math.PI, area = 2296 + 32 * Math.PI;
  assert.ok(Math.abs(m.volumeMm3 - volume) <= 1e-9 * volume, `volume ${m.volumeMm3}`);
  assert.ok(Math.abs(m.areaMm2 - area) <= 1e-9 * area, `area ${m.areaMm2}`);
  const t = m.topology;
  assert.deepEqual([t.bodies, t.shells, t.faces, t.edges, t.vertices, t.genus, t.ringEdges], [1, 1, 12, 26, 16, 1, 2]);
  assert.deepEqual(m.surfaceTypes, { Cylinder: 1, Plane: 11 });
  // The inputs are binary64 metres (18 mm is 0.018000000000000002 m): the
  // exact image of the input differs from the decimal value by ulps.
  [[m.bboxMm.min, [0, 0, 0]], [m.bboxMm.max, [32, 18, 10]]].forEach(([got, want]) =>
    want.forEach((x, k) => assert.ok(Math.abs(got[k] - x) <= 1e-9, `bbox ${JSON.stringify(m.bboxMm)}`)));
  // Closed-form centroid: box minus bore minus pocket first moments.
  const M = [0, 1, 2].map(k => 5760 * [16, 9, 5][k] - 40 * Math.PI * [8, 9, 5][k] - 320 * [24, 9, 8][k]);
  M.forEach((x, k) => assert.ok(Math.abs(m.centroidMm[k] - x / volume) <= 1e-9, `centroid ${m.centroidMm}`));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wonky-g12-'));
  try {
    const step = toStep(model, 'g12');
    assert.ok(step.includes('CYLINDRICAL_SURFACE') && !step.includes('B_SPLINE'));
    const prefix = path.join(dir, 'g12');
    fs.writeFileSync(`${prefix}.step`, step);
    fs.writeFileSync(`${prefix}.brep.json`, serializeModel(model));
    const v = spawnSync('uv', ['run', path.join(root, 'scripts/validate-step.py'), prefix], { cwd: root, encoding: 'utf8', timeout: 300000 });
    assert.equal(v.status, 0, v.stdout + v.stderr);
    const [report] = JSON.parse(v.stdout);
    assert.equal(report.valid, true, JSON.stringify(report).slice(0, 2000));
    assert.deepEqual(report.surfaceTypes, { Cylinder: 1, Plane: 11 }, JSON.stringify(report.surfaceTypes));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('curved Model geometric queries refuse instead of returning cache-based selections, including try silent', async () => {
  const body = 'qCreatedBy(id+"base",EntityType.BODY)';
  const queries = [
    `qParallelEdges(qOwnedByBody(${body},EntityType.EDGE),vector(1,0,0))`,
    `qCoincidesWithPlane(qOwnedByBody(${body},EntityType.FACE),plane(vector(0,0,0)*meter,vector(0,0,1)))`,
  ];
  for (const query of queries) {
    const input = source.replace(/\}\);\s*$/, `try silent { evaluateQuery(context,${query}); }\n});`);
    await assert.rejects(build(input, { feature: 'f' }), error =>
      error.name === 'RustCapabilityError' && error.reason === 'query/curved-model-geometry-unimplemented');
  }
});
