// Interpreter/native transport and reference lifetime; geometric predicate
// behavior is owned by rust/wonky-ops/tests/query.rs, not replayed here.
import test from 'node:test';
import assert from 'node:assert/strict';
process.env.WONKY_BACKEND = 'rust';
const { build } = await import('../src/index.mjs');
const source = statements => `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export const f = defineFeature(function(context is Context, id is Id, definition is map) precondition {} {${statements}});`;
const q = 'qCreatedBy(id+"plate",EntityType.BODY)';
const box = 'fCuboid(context,id+"plate",{"corner1":vector(0,0,0)*meter,"corner2":vector(0.5,0.25,0.125)*meter});';

test('native lazy query chain selects the rim after a Boolean and transports entity references', async () => {
  for (const axes of [
    'vector(0,0,1),vector(0,-1,0)',
    'vector(0.9953610106153096,0.08075849942674315,-0.05229266982293196),vector(0.05443374184663523,-0.024540530893688527,0.9982157733135806)',
  ]) {
    const model = await build(source(`${box}
      fCylinder(context,id+"hole",{"bottomCenter":vector(0.25,0.125,-0.125)*meter,"topCenter":vector(0.25,0.125,0.25)*meter,"radius":0.03125*meter});
      opBoolean(context,id+"cut",{"targets":${q},"tools":qCreatedBy(id+"hole",EntityType.BODY),"operationType":BooleanOperationType.SUBTRACTION});
      const cs=coordSystem(vector(64,-32,16)*meter,${axes});
      const faces=qOwnedByBody(${q},EntityType.FACE);
      opTransform(context,id+"move",{"bodies":${q},"transform":toWorld(cs)});
      const topPlane=plane(toWorld(cs,vector(0,0,0.125)*meter),cs.zAxis);
      const queryTop=function(p is Plane) { return qCoincidesWithPlane(faces,p); };
      const top=queryTop(topPlane);
      if(size(evaluateQuery(context,qCoincidesWithPlane(faces,plane(toWorld(cs,vector(0,0,0)*meter),cs.xAxis))))!=1)throw "lost source x normal";
      const rim=qAdjacent(top,AdjacencyType.EDGE,EntityType.EDGE);
      const lines=qParallelEdges(qGeometry(rim,GeometryType.LINE),cs.xAxis);
      const rings=qGeometry(rim,GeometryType.CIRCLE);
      const selected=evaluateQuery(context,qUnion([lines,rings]));
      if(size(selected)!=3)throw "wrong native selection";
      if(size(evaluateQuery(context,qUnion(selected)))!=3)throw "reference transport lost entities";
      if(size(evaluateQuery(context,qIntersection([qUnion(selected),rings])))!=1)throw "query intersection lost ring";
      if(size(evaluateQuery(context,qSubtraction(qUnion(selected),rings)))!=2)throw "query subtraction lost lines";
      if(size(evaluateQuery(context,qBodyType(qEverything(EntityType.EDGE),BodyType.SOLID)))!=14)throw "seam leaked";
      setProperty(context,{"entities":${q},"propertyType":PropertyType.NAME,"value":"native queries"});`), { feature: 'f' });
    assert.equal(model.bodies.length, 1);
    assert.equal(model.bodies[0].name, 'native queries');
  }
});

test('source-plane lineage is not invented for copied values or a different frame', async () => {
  const setup = `${box}
    const cs=coordSystem(vector(64,-32,16)*meter,
      vector(0.9953610106153096,0.08075849942674315,-0.05229266982293196),
      vector(0.05443374184663523,-0.024540530893688527,0.9982157733135806));
    opTransform(context,id+"move",{"bodies":${q},"transform":toWorld(cs)});
    const faces=qOwnedByBody(${q},EntityType.FACE);`;
  for (const [plane, reason] of [
    ['plane(toWorld(cs,vector(0,0,0.125)*meter)+vector(0,0,0)*meter,cs.zAxis)', 'near-parallel-unproved'],
    ['plane(toWorld(cs,vector(0,0,0.125)*meter),vector(cs.zAxis[0],cs.zAxis[1],cs.zAxis[2]))', 'near-parallel-unproved'],
    ['plane(toWorld(cs,vector(0,0,0.12500000000000003)*meter),cs.zAxis)', 'near-plane-unproved'],
    ['plane(toWorld(cs,vector(0,0,0.125)*meter),(toWorld(cs).linear*1)*vector(0,0,1))', 'near-parallel-unproved'],
    ['plane(toWorld(cs,vector(0,0,0.125)*meter),toWorld(cs).linear*vector(0,0,1)+vector(0,0,0))', 'near-parallel-unproved'],
  ]) {
    await assert.rejects(build(source(`${setup}
      try silent { evaluateQuery(context,qCoincidesWithPlane(faces,${plane})); }`), { feature: 'f' }),
    e => e.name === 'RustCapabilityError' && e.reason === `query/${reason}`);
  }
  await assert.rejects(build(source(`${setup}
    const other=coordSystem(cs.origin+vector(1,0,0)*meter,cs.xAxis,cs.zAxis);
    try silent { evaluateQuery(context,qCoincidesWithPlane(faces,plane(toWorld(other,vector(0,0,0.125)*meter),other.zAxis))); }`), { feature: 'f' }),
  e => e.name === 'RustCapabilityError' && e.reason === 'query/different-exact-frames');
});

test('evaluated native subentities refuse after geometry replacement, but lazy queries stay live', async () => {
  await assert.rejects(build(source(`${box}
    const faces=evaluateQuery(context,qOwnedByBody(${q},EntityType.FACE));
    opTransform(context,id+"move",{"bodies":${q},"transform":toWorld(coordSystem(vector(1,0,0)*meter,vector(1,0,0),vector(0,0,1)))});
    try silent { evaluateQuery(context,faces[0]); }`), { feature: 'f' }),
  e => e.name === 'RustCapabilityError' && e.reason === 'stale-topology-reference');
  await assert.rejects(build(source(`${box}
    fCylinder(context,id+"hole",{"bottomCenter":vector(0.25,0.125,-0.125)*meter,"topCenter":vector(0.25,0.125,0.25)*meter,"radius":0.03125*meter});
    opBoolean(context,id+"cut",{"targets":${q},"tools":qCreatedBy(id+"hole",EntityType.BODY),"operationType":BooleanOperationType.SUBTRACTION});
    try silent { evaluateQuery(context,qCreatedBy(id+"plate",EntityType.FACE)); }`), { feature: 'f' }),
  e => e.name === 'RustCapabilityError' && e.reason === 'created-topology-identity-untracked');
  // Placement preserves the source creator, but a later blend creates new
  // topology. It must not inherit that cached source-only identity.
  await assert.rejects(build(source(`${box}
    opTransform(context,id+"move",{"bodies":${q},"transform":toWorld(coordSystem(vector(1,0,0)*meter,vector(1,0,0),vector(0,0,1)))});
    if(size(evaluateQuery(context,qCreatedBy(id+"plate",EntityType.EDGE)))!=12)throw "placed creator lost";
    opFillet(context,id+"blend",{"entities":qClosestTo(qOwnedByBody(${q},EntityType.EDGE),vector(1.5,0.25,0.0625)*meter),"radius":0.03125*meter});
    try silent { evaluateQuery(context,qCreatedBy(id+"plate",EntityType.EDGE)); }`), { feature: 'f' }),
  e => e.name === 'RustCapabilityError' && e.reason === 'created-topology-identity-untracked');
});

test('closest circular rims cross the native mixed-chart audit and keep source-plane lineage', async () => {
  for (const axes of [
    'vector(1,0,0),vector(0,0,1)',
    'vector(0,0,1),vector(0,-1,0)',
    'vector(0.9953610106153096,0.08075849942674315,-0.05229266982293196),vector(0.05443374184663523,-0.024540530893688527,0.9982157733135806)',
  ]) {
    const model = await build(source(`
      fCylinder(context,id+"post",{"bottomCenter":vector(0.25,0.125,0)*meter,"topCenter":vector(0.25,0.125,0.125)*meter,"radius":0.03125*meter});
      const body=qCreatedBy(id+"post",EntityType.BODY);
      const cs=coordSystem(vector(64,-32,16)*meter,${axes});
      opTransform(context,id+"pose",{"bodies":body,"transform":toWorld(cs)});
      const edges=qOwnedByBody(body,EntityType.EDGE);
      const closest=qClosestTo(edges,toWorld(cs,vector(0.28125,0.125,0.125)*meter));
      const selected=evaluateQuery(context,closest);
      if(size(selected)!=1)throw "closest rim selection failed";
      if(size(evaluateQuery(context,qGeometry(qUnion(selected),GeometryType.CIRCLE)))!=1)throw "seam selected";
      if(size(evaluateQuery(context,qCoincidesWithPlane(qUnion(selected),plane(toWorld(cs,vector(0,0,0.125)*meter),cs.zAxis))))!=1)throw "wrong cap selected";
      if(size(evaluateQuery(context,qClosestTo(edges,toWorld(cs,vector(0.28125,0.125,0.0625)*meter))))!=2)throw "rim tie lost";
    `), { feature: 'f' });
    assert.equal(model.bodies.length, 1);
  }
});

test('sketch rim plane queries preserve toWorld linear-axis construction through helper returns', async () => {
  for (const frame of [
    'vector(0,0,0)*meter,vector(1,0,0),vector(0,0,1)',
    'vector(64.25,-32.5,16.125)*meter,vector(1,0,0),vector(0,0,1)',
    'vector(0,0.75,0)*meter,vector(0,0,1),vector(0,-1,0)',
    'vector(0.75,0.75,0)*meter,vector(0.9953610106153096,0.08075849942674315,-0.05229266982293196),vector(0.05443374184663523,-0.024540530893688527,0.9982157733135806)',
  ]) {
    const model = await build(source(`
      const cs=coordSystem(${frame});
      const axis=function(v is Vector) { return toWorld(cs).linear*v; };
      const cap=function(z is number) { return plane(toWorld(cs,vector(0,0,z)*millimeter),axis(vector(0,0,1)),axis(vector(1,0,0))); };
      var s=newSketchOnPlane(context,id+"sketch",{"sketchPlane":cap(0)});
      skLineSegment(s,"bottom",{"start":vector(1,0)*meter,"end":vector(9,0)*meter});
      skLineSegment(s,"top",{"start":vector(9,2)*meter,"end":vector(1,2)*meter});
      skArc(s,"left",{"start":vector(1,2)*meter,"mid":vector(0,1)*meter,"end":vector(1,0)*meter});
      skArc(s,"right",{"start":vector(9,0)*meter,"mid":vector(10,1)*meter,"end":vector(9,2)*meter});
      skSolve(s);
      opExtrude(context,id+"post",{"entities":qSketchRegion(id+"sketch"),"direction":axis(vector(0,0,1)),"endBound":BoundingType.BLIND,"endDepth":6*millimeter});
      const edges=qOwnedByBody(qCreatedBy(id+"post",EntityType.BODY),EntityType.EDGE);
      const rim=qCoincidesWithPlane(edges,cap(6));
      if(size(evaluateQuery(context,rim))!=4)throw "incomplete top rim";
      if(size(evaluateQuery(context,qGeometry(rim,GeometryType.ARC)))!=2)throw "circular trims missing";
    `), {feature:'f'});
    assert.equal(model.bodies.length, 1);
  }
});
