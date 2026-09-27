// Host lifecycle and the independent STEP consumer, not a second arithmetic
// oracle. Covers publication of the new certificate, keepTools, and geometric
// refusal transport. Rust tests own rational clipping and exact-volume laws.
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
const source = statements => `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export const f = defineFeature(function(context is Context, id is Id, definition is map) precondition {} {
  const sketch = newSketchOnPlane(context,id+"sketch",{"sketchPlane":plane(vector(0,0,0)*meter,vector(0,0,1),vector(0,1,0))});
  skPolyline(sketch,"diamond",{"points":[vector(-2,0)*meter,vector(0,-2)*meter,vector(2,0)*meter,vector(0,2)*meter,vector(-2,0)*meter]});
  skSolve(sketch);
  opExtrude(context,id+"diamond",{"entities":qSketchRegion(id+"sketch",false),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":2*meter});
  opDeleteBodies(context,id+"clean",{"entities":qCreatedBy(id+"sketch",EntityType.BODY)});
  ${statements}
});`;
const query = id => `qCreatedBy(id+"${id}",EntityType.BODY)`;

test('different-frame Boolean publishes audited output, retains the tool and exports valid STEP', async () => {
  const model = await build(source(`
    fCuboid(context,id+"box",{"corner1":vector(0.1,0,0)*meter,"corner2":vector(2,2,2)*meter});
    opBoolean(context,id+"cut",{"targets":${query('box')},"tools":${query('diamond')},"keepTools":true,"operationType":BooleanOperationType.SUBTRACTION});
    const result=${query('cut')};
    if(size(evaluateQuery(context,result))!=1)throw "cut output not selectable";
    if(size(evaluateQuery(context,${query('diamond')}))!=2)throw "source history not inherited";
    setProperty(context,{"entities":result,"propertyType":PropertyType.NAME,"value":"result"});
  `), { feature: 'f' });
  assert.equal(model.bodies.length, 2);
  const output = model.bodies.find(b => b.name === 'result');
  assert.ok(output);
  const measurement = measureRustBody(rustModelKernel(model), output);
  assert.equal(measurement.certificate, 'ExactPlaneArrangement');
  assert.equal(measurement.axis, null, 'a general polyhedron must not advertise an extrusion axis');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wonky-planar-step-'));
  try {
    const prefix = path.join(dir, 'cut');
    fs.writeFileSync(prefix + '.step', toStep(model, 'planar-cut'));
    fs.writeFileSync(prefix + '.brep.json', serializeModel(model));
    const result = spawnSync('uv', ['run', path.join(root, 'scripts/validate-step.py'), prefix], {
      cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024,
    });
    assert.equal(result.status, 0, result.stderr || String(result.error));
    assert.equal(JSON.parse(result.stdout).length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('general planar failures distinguish empty geometry from an unsuppressible capability', async () => {
  await assert.rejects(build(source(`
    fCuboid(context,id+"box",{"corner1":vector(-4,-4,-1)*meter,"corner2":vector(4,4,3)*meter});
    opBoolean(context,id+"cut",{"targets":${query('diamond')},"tools":${query('box')},"operationType":BooleanOperationType.SUBTRACTION});
  `), { feature: 'f' }), e => e.refusalCategory === 'empty-result' && e.operationUnderTest === true);
  await assert.rejects(build(source(`
    fCuboid(context,id+"box",{"corner1":vector(3,0,0)*meter,"corner2":vector(5,2,2)*meter});
    try silent { opBoolean(context,id+"cut",{"tools":qUnion([${query('diamond')},${query('box')}]),"operationType":BooleanOperationType.UNION}); }
  `), { feature: 'f' }), e => e.name === 'RustCapabilityError' && e.reason === 'planar-boolean/multiple-shells-unsupported');
});
