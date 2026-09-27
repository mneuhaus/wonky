// The interpreter/query boundary, distinct from the rational geometry oracles
// in wonky-ops/tests/orthogonal.rs. No test-only production hook or Bend load.
import test from 'node:test';
import assert from 'node:assert/strict';
process.env.WONKY_BACKEND = 'rust';
const { build } = await import('../src/index.mjs');
const { distanceRustBodies, sourceExtentsRustBody, rustModelKernel, measureRustBody } = await import('../src/native/rust-host.mjs');
const source = statements => `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export const f = defineFeature(function(context is Context, id is Id, definition is map) precondition {} {
${statements}
});`;
const box = (id, lo, hi) => `fCuboid(context,id+"${id}",{"corner1":vector(${lo})*millimeter,"corner2":vector(${hi})*millimeter});`;
const query = id => `qCreatedBy(id+"${id}",EntityType.BODY)`;
const label = q => `setProperty(context,{"entities":${q},"propertyType":PropertyType.NAME,"value":"selected"});`;

test('E9 SI inputs survive distant placement, query evaluation and exact body distance', async () => {
  const model = await build(source(`${box('a', '0,0,0', '0.1+8.2,4,4')}${box('b', '8.3,0,0', '16,4,4')}
    opTransform(context,id+"t",{"bodies":qUnion([${query('a')},${query('b')}]),"transform":toWorld(coordSystem(vector(131072,-32768,16384)*millimeter,vector(0,0,1),vector(0,-1,0)))});
    opBoolean(context,id+"u",{"tools":qUnion([${query('a')},${query('b')}]),"operationType":BooleanOperationType.UNION});
    const parts=evaluateQuery(context,${query('u')});
    if(size(parts)!=2)throw "lost a body";
    const d=evDistance(context,{"side0":parts[0],"side1":parts[1]});
    if(d.distance<=0*millimeter)throw "lost the gap";
    const bounds=evBox3d(context,{"topology":parts[0]});
    if(bounds.minCorner[0]<131000*millimeter)throw "lost the placement";
    ${label('parts[1]')}`), { feature: 'f' });
  assert.equal(model.bodies.length, 2);
  assert.equal(model.bodies[1].name, 'selected');
  const kernel = rustModelKernel(model);
  const expected = (8.3 * 0.001 - (0.1 + 8.2) * 0.001) * 1000;
  const result = distanceRustBodies(kernel, ...model.bodies);
  assert.ok(Math.abs(result.distanceMm - expected) <= result.boundMm);
  assert.equal(sourceExtentsRustBody(kernel, model.bodies[0])[1], 4);
});

test('subtraction keepTools retains only the selected tool and creates real target output', async () => {
  const model = await build(source(`${box('a', '0,0,0', '7,5,3')}${box('b', '2,-1,-1', '4,6,4')}
    opBoolean(context,id+"cut",{"targets":${query('a')},"tools":${query('b')},"operationType":BooleanOperationType.SUBTRACTION,"keepTools":true});
    const parts=evaluateQuery(context,${query('cut')});
    if(size(parts)!=2)throw "wrong cut result";
    ${label(query('cut'))}`), { feature: 'f' });
  const kernel = rustModelKernel(model);
  assert.equal(model.bodies.length, 3);
  const retained = model.bodies.filter(b => b.name !== 'selected');
  assert.equal(retained.length, 1);
  assert.ok(Math.abs(measureRustBody(kernel, retained[0]).volumeMm3 - 70) < 1e-10);
  const cutVolume = model.bodies.filter(b => b.name === 'selected').reduce((s,b) => s + measureRustBody(kernel,b).volumeMm3, 0);
  assert.ok(Math.abs(cutVolume - 75) < 1e-10);
});

test('empty and nonmanifold operations are geometric refusals, unsupported placements remain capabilities', async () => {
  const setup = box('a', '0,0,0', '7,5,3') + box('b', '0,0,0', '7,5,3');
  const empty = source(`${setup}opBoolean(context,id+"cut",{"targets":${query('a')},"tools":${query('b')},"operationType":BooleanOperationType.SUBTRACTION});`);
  await assert.rejects(build(empty,{feature:'f'}), e => e.refusalCategory === 'empty-result' && e.operationUnderTest === true);
  const unsupported = source(`${setup}opTransform(context,id+"move",{"bodies":${query('a')},"transform":transform(vector(1,0,0)*millimeter)});`);
  await assert.rejects(build(unsupported,{feature:'f'}), e => e.name === 'RustCapabilityError' && /exact toWorld/.test(e.message));
});
