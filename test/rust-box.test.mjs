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

test('Boolean modifications preserve body creator, query-order identity and saved body selections', async () => {
  for (const operation of ['UNION', 'SUBTRACTION']) {
    const model = await build(source(`${box('a', '0,0,0', '8,8,8')}${box('b', '4,0,0', '12,8,8')}
      ${label(query('b'))}
      const saved = evaluateQuery(context,${query('b')})[0];
      opBoolean(context,id+"modify",{"tools":${operation === 'UNION' ? `qUnion([${query('b')},${query('a')}])` : query('a')},
        ${operation === 'SUBTRACTION' ? `"targets":${query('b')},"keepTools":true,` : ''}
        "operationType":BooleanOperationType.${operation}});
      if(size(evaluateQuery(context,${query('modify')}))!=0)throw "modification is not body creation";
      if(size(evaluateQuery(context,${query('b')}))!=1)throw "lost original creator";
      if(size(evaluateQuery(context,saved))!=1)throw "lost stored body identity";
      if(size(evaluateQuery(context,${query('a')}))!=${operation === 'UNION' ? 0 : 1})throw "wrong consumed or retained tool";
      setProperty(context,{"entities":saved,"propertyType":PropertyType.DESCRIPTION,"value":"survivor"});`), { feature: 'f' });
    const survivors = model.bodies.filter(b => b.description === 'survivor');
    assert.equal(survivors.length, 1, operation);
    assert.equal(survivors[0].name, 'selected', operation);
    assert.ok(Math.abs(measureRustBody(rustModelKernel(model), survivors[0]).volumeMm3 - (operation === 'UNION' ? 768 : 256)) < 1e-9);
  }
});

test('E9 SI inputs survive distant placement, query evaluation and exact body distance', async () => {
  const model = await build(source(`${box('a', '0,0,0', '0.1+8.2,4,4')}${box('b', '8.3,0,0', '16,4,4')}
    opTransform(context,id+"t",{"bodies":qUnion([${query('a')},${query('b')}]),"transform":toWorld(coordSystem(vector(131072,-32768,16384)*millimeter,vector(0,0,1),vector(0,-1,0)))});
    const saved = evaluateQuery(context,qUnion([${query('a')},${query('b')}]));
    opBoolean(context,id+"u",{"tools":qUnion([${query('b')},${query('a')}]),"operationType":BooleanOperationType.UNION});
    if(size(evaluateQuery(context,${query('u')}))!=0)throw "disjoint union created bodies";
    if(size(evaluateQuery(context,${query('a')}))!=1 || size(evaluateQuery(context,${query('b')}))!=1)throw "mixed component creators";
    const parts=evaluateQuery(context,qUnion(saved));
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
    const beforeSplit=evaluateQuery(context,${query('a')})[0];
    opBoolean(context,id+"cut",{"targets":${query('a')},"tools":${query('b')},"operationType":BooleanOperationType.SUBTRACTION,"keepTools":true});
    const parts=evaluateQuery(context,${query('cut')});
    if(size(parts)!=2)throw "wrong cut result";
    if(size(evaluateQuery(context,beforeSplit))!=0)throw "split arbitrarily retained the first fragment identity";
    if(size(evaluateQuery(context,${query('a')}))!=2)throw "split lost target creator";
    if(size(evaluateQuery(context,${query('b')}))!=1)throw "tool incorrectly became a result creator";
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
  const translated = await build(source(`${setup}opTransform(context,id+"move",{"bodies":${query('a')},"transform":transform(vector(1,0,0)*millimeter)});`), {feature:'f'});
  assert.equal(translated.bodies.length, 2);
  assert.ok(Math.abs(measureRustBody(rustModelKernel(translated), translated.bodies[0]).bboxMm.min[0] - 1) < 1e-12);
  const unsupported = source(`${setup}opTransform(context,id+"move",{"bodies":${query('a')},"transform":transform(matrix([[2,0,0],[0,1,0],[0,0,1]]),vector(1,0,0)*millimeter)});`);
  await assert.rejects(build(unsupported,{feature:'f'}), e => e.name === 'RustCapabilityError' && /metric-not-near-isometric/.test(e.message));
});

test('explicit translations and toWorld images retain moved bore geometry through Boolean replay', async () => {
  for (const move of ['transform(vector(40,8,0)*millimeter)', 'toWorld(coordSystem(vector(40,8,0)*millimeter,vector(1,0,0),vector(0,0,1)))']) {
    const model = await build(source(`${box('block', '0,0,0', '24,16,8')}
      opTransform(context,id+"move",{"bodies":${query('block')},"transform":${move}});
      fCylinder(context,id+"bore",{"bottomCenter":vector(52,16,-1)*millimeter,"topCenter":vector(52,16,9)*millimeter,"radius":2*millimeter});
      opTransform(context,id+"frame",{"bodies":qUnion([${query('block')},${query('bore')}]),"transform":toWorld(coordSystem(vector(8192,-4096,2048)*millimeter,vector(0,1,0),vector(1,0,0)))});
      opBoolean(context,id+"cut",{"targets":${query('block')},"tools":${query('bore')},"operationType":BooleanOperationType.SUBTRACTION});`), {feature:'f'});
    assert.equal(model.bodies.length, 1);
    const m = measureRustBody(rustModelKernel(model), model.bodies[0], {probes:[[8196,-4044,2064],[8196,-4054,2058]]});
    assert.equal(m.boundToConstruction, true);
    assert.equal(m.validity.closed, true);
    assert.equal(m.validity.brep, true);
    assert.ok(Math.abs(m.volumeMm3 - (24*16*8-32*Math.PI)) <= 1e-7);
    assert.deepEqual(m.probes.map(p => p.inside), [false,true]);
    assert.ok(m.probes.every(p => !p.refused));
    // Exact-rational offsets, in mm, between the integer-mm query and the
    // binary64 centre (-4096*.001+52*.001, 2048*.001+16*.001).
    const expectedDistance = 2 - Math.hypot(727 / 2**53, 387 / 2**53);
    assert.ok(Math.abs(m.probes[0].distanceMm-expectedDistance) <= m.probes[0].boundMm);
  }
});
