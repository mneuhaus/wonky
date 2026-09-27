// Interpreter record ownership, conic wire serialization and later placement.
// Native tests own the exact admission predicates and analytic measurements.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
process.env.WONKY_BACKEND = 'rust';
const { build } = await import('../src/index.mjs');
const { toStep } = await import('../src/exporters.mjs');
const { serializeModel } = await import('../src/construction-history.mjs');
const { measureRustBody, rustModelKernel } = await import('../src/native/rust-host.mjs');
const source = `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export const f = defineFeature(function(context is Context, id is Id, definition is map) precondition {} {
    fCylinder(context,id+"a",{"bottomCenter":vector(-20,0,0)*millimeter,"topCenter":vector(20,0,0)*millimeter,"radius":5*millimeter});
    fCylinder(context,id+"b",{"bottomCenter":vector(0,-20,0)*millimeter,"topCenter":vector(0,20,0)*millimeter,"radius":5*millimeter});
    opBoolean(context,id+"cut",{"tools":qUnion([qCreatedBy(id+"a",EntityType.BODY),qCreatedBy(id+"b",EntityType.BODY)]),"operationType":BooleanOperationType.INTERSECTION});
    if(size(evaluateQuery(context,qCreatedBy(id+"cut",EntityType.BODY)))!=1)throw "missing intersection";
    opTransform(context,id+"move",{"bodies":qCreatedBy(id+"a",EntityType.BODY),"transform":toWorld(coordSystem(vector(65536.25,-32768.5,16384.125)*millimeter,vector(1,0,0),vector(0,0,1)))});
    setProperty(context,{"entities":qCreatedBy(id+"b",EntityType.BODY),"propertyType":PropertyType.NAME,"value":"lens"});
});`;

test('bicylinder intersection preserves aliases, conic transport and later placement', async () => {
  const model = await build(source, { feature: 'f' });
  assert.equal(model.bodies.length, 1);
  assert.equal(model.bodies[0].name, 'lens');
  const m = measureRustBody(rustModelKernel(model), model.bodies[0], {
    probes: [[65536.25, -32768.5, 16394.125], [65543.25, -32761.5, 16384.125]],
  });
  assert.equal(m.certificate, 'PerpendicularBicylinder');
  assert.ok(Math.abs(m.probes[0].distanceMm - 5) < 1e-9, JSON.stringify(m.probes[0]));
  assert.ok(Math.abs(m.probes[1].distanceMm - Math.sqrt(8)) < 1e-9, JSON.stringify(m.probes[1]));
  const record = JSON.parse(serializeModel(model)).bodies[0];
  assert.equal(record.vertices.length, 2);
  assert.equal(record.edges.length, 4);
  assert.equal(record.faces.length, 4);
  assert.equal(record.referenceMeasurements.faceAreasMm2.length, 4);
  const step = toStep(model, 'bicylinder');
  assert.ok(step.includes('ELLIPSE('));
  assert.ok(step.includes('SURFACE_CURVE('));
  // Optional export requested by the independent STEP validation command.
  if (process.env.WONKY_TEST_EXPORT_PREFIX) {
    const prefix = path.resolve(process.env.WONKY_TEST_EXPORT_PREFIX);
    fs.mkdirSync(path.dirname(prefix), { recursive: true });
    fs.writeFileSync(`${prefix}.step`, step);
    fs.writeFileSync(`${prefix}.brep.json`, serializeModel(model));
  }
});
