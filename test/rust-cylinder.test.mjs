// Interpreter/WC0 transport and Boolean record lifecycle, not a second owner
// of the native exact-predicate/geometry tests in wonky-ops/tests/cylinder.rs.
import test from 'node:test';
import assert from 'node:assert/strict';
process.env.WONKY_BACKEND = 'rust';
const { build } = await import('../src/index.mjs');
const { toStep } = await import('../src/exporters.mjs');
const { serializeModel } = await import('../src/construction-history.mjs');
const { measureRustBody, rustModelKernel, distanceRustBodies } = await import('../src/native/rust-host.mjs');
const source = statements => `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export const f = defineFeature(function(context is Context, id is Id, definition is map) precondition {} {${statements}});`;
const cylinder = (id,x,lo,hi) => `fCylinder(context,id+"${id}",{"bottomCenter":vector(${x},0,${lo})*millimeter,"topCenter":vector(${x},0,${hi})*millimeter,"radius":4*millimeter});`;
const q = id => `qCreatedBy(id+"${id}",EntityType.BODY)`;

test('cylinder construction, shared cap union, placement and serialization use native bodies', async () => {
  const model = await build(source(`${cylinder('a',0,0,8)}${cylinder('b',0,8,16)}
    opTransform(context,id+"move",{"bodies":qUnion([${q('a')},${q('b')}]),"transform":toWorld(coordSystem(vector(65536,-32768,16384)*millimeter,vector(0,0,1),vector(0,-1,0)))});
    opBoolean(context,id+"u",{"tools":qUnion([${q('a')},${q('b')}]),"operationType":BooleanOperationType.UNION});
    const parts=evaluateQuery(context,${q('u')});
    if(size(parts)!=1)throw "lost union result";
    setProperty(context,{"entities":${q('a')},"propertyType":PropertyType.NAME,"value":"inherited"});`),{feature:'f'});
  assert.equal(model.bodies.length,1);
  assert.equal(model.bodies[0].name,'inherited');
  const m=measureRustBody(rustModelKernel(model),model.bodies[0]);
  assert.equal(m.certificate,'AxialCylinder');
  assert.ok(m.bboxMm.min[0]>65530);
  const record=JSON.parse(serializeModel(model)).bodies[0];
  assert.equal(record.vertices.length,2);assert.equal(record.edges.length,3);assert.equal(record.faces.length,3);
  assert.equal(record.referenceMeasurements.faceAreasMm2.length,3);
  assert.ok(toStep(model,'cylinder').includes('CYLINDRICAL_SURFACE('));
});

test('tangent cylinder union retains two addressable bodies with native contact distance', async () => {
  const model=await build(source(`${cylinder('a',0,0,16)}${cylinder('b',8,0,16)}
    opBoolean(context,id+"u",{"tools":qUnion([${q('a')},${q('b')}]),"operationType":BooleanOperationType.UNION});
    const parts=evaluateQuery(context,${q('u')});
    if(size(parts)!=2)throw "lost tangent part";
    const gap=evDistance(context,{"side0":parts[0],"side1":parts[1]});
    if(gap.distance!=0*millimeter)throw "lost contact";`),{feature:'f'});
  assert.equal(model.bodies.length,2);
  assert.equal(distanceRustBodies(rustModelKernel(model),...model.bodies).distanceMm,0);
});

test('unsupported cylinder overlap escapes try silent instead of returning an incomplete model', async () => {
  await assert.rejects(build(source(`${cylinder('a',0,0,16)}${cylinder('b',7,0,16)}
    try silent {opBoolean(context,id+"u",{"tools":qUnion([${q('a')},${q('b')}]),"operationType":BooleanOperationType.UNION});}`),{feature:'f'}),
    e=>e.name==='RustCapabilityError'&&e.reason==='cylinder/parallel-overlap-arrangement');
});


test('through-hole Boolean consumes tools and remains serializable after a later placement', async () => {
  const model = await build(source(`
    fCuboid(context,id+"plate",{"corner1":vector(0,0,0)*millimeter,"corner2":vector(64,64,8)*millimeter});
    fCylinder(context,id+"hole",{"bottomCenter":vector(32,32,-1)*millimeter,"topCenter":vector(32,32,9)*millimeter,"radius":0.00390625*millimeter});
    opBoolean(context,id+"cut",{"targets":${q('plate')},"tools":${q('hole')},"operationType":BooleanOperationType.SUBTRACTION});
    if(size(evaluateQuery(context,${q('cut')}))!=1)throw "missing cut result";
    opTransform(context,id+"move",{"bodies":${q('cut')},"transform":toWorld(coordSystem(vector(65536,-32768,16384)*millimeter,vector(0,0,1),vector(0,-1,0)))});
    setProperty(context,{"entities":${q('plate')},"propertyType":PropertyType.NAME,"value":"perforated"});`), { feature: 'f' });
  assert.equal(model.bodies.length, 1);
  assert.equal(model.bodies[0].name, 'perforated');
  const record = JSON.parse(serializeModel(model)).bodies[0];
  assert.equal(record.vertices.length, 10);
  assert.equal(record.faces.length, 7);
  assert.equal(record.referenceMeasurements.faceAreasMm2.length, 7);
  assert.equal(record.faces.filter(f => f.loops.length === 2).length, 2);
  assert.ok(toStep(model, 'hole').includes('CYLINDRICAL_SURFACE('));
});

// Transport risks not covered by the native carrier tests: selecting the holed
// region versus its disk, reverse depth, and a copy of an already placed disk.
test('circle sketch extrusion and pattern keep separate, named analytic solids', async () => {
  const model = await build(source(`
    const cs=coordSystem(vector(512,-256,128)*millimeter,vector(0,1,0),vector(1,0,0));
    var s=newSketchOnPlane(context,id+"s",{"sketchPlane":plane(cs.origin,cs.zAxis,cs.xAxis)});
    skCircle(s,"disk",{"center":vector(9,2)*millimeter,"radius":3*millimeter}); skSolve(s);
    opExtrude(context,id+"seed",{"entities":qSketchRegion(id+"s"),"direction":-cs.zAxis,"endBound":BoundingType.BLIND,"endDepth":5*millimeter});
    opPattern(context,id+"copy",{"entities":${q('seed')},"transforms":[rotationAround(line(cs.origin,cs.zAxis),90*degree)],"instanceNames":["quarter"]});
    setProperty(context,{"entities":${q('copy')},"propertyType":PropertyType.NAME,"value":"copy"});`), {feature:'f'});
  assert.equal(model.bodies.length,2);
  assert.equal(model.bodies[1].name,'copy');
  const [seed,copy]=model.bodies.map(b=>measureRustBody(rustModelKernel(model),b));
  assert.ok(Math.abs(seed.volumeMm3-141.3716694115407)<1e-9);
  assert.ok(Math.abs(copy.volumeMm3-seed.volumeMm3)<1e-9);
  for (const [m,c] of [[seed,[509.5,-247,130]],[copy,[509.5,-258,137]]])
    c.forEach((v,k)=>assert.ok(Math.abs(m.centroidMm[k]-v)<1e-9));
  assert.equal(toStep(model,'copies').match(/CYLINDRICAL_SURFACE\(/g).length,2);
});

test('mixed rectangular and circle regions honor filterInnerLoops and reject contact', async () => {
  const sketch=(filter,radius=3)=>`
    var s=newSketchOnPlane(context,id+"s",{"sketchPlane":plane(vector(0,0,0)*millimeter,vector(0,0,1),vector(1,0,0))});
    skRectangle(s,"outer",{"firstCorner":vector(-10,-6)*millimeter,"secondCorner":vector(10,6)*millimeter});
    skCircle(s,"inner",{"center":vector(2,0)*millimeter,"radius":${radius}*millimeter}); skSolve(s);
    opExtrude(context,id+"solid",{"entities":qSketchRegion(id+"s",${filter}),"direction":vector(0,0,-1),"endBound":BoundingType.BLIND,"endDepth":7*millimeter});`;
  for (const filter of [true,false]) {
    const model=await build(source(sketch(filter)),{feature:'f'});
    assert.equal(model.bodies.length,filter?1:2);
    const measurements=model.bodies.map(b=>measureRustBody(rustModelKernel(model),b));
    const hole=measurements.find(m=>m.topology.genus===1);
    assert.ok(hole);
    assert.ok(Math.abs(hole.volumeMm3-1482.079662823843)<1e-8);
    assert.equal(hole.bboxMm.min[2],-7);
    assert.equal(hole.bboxMm.max[2],0);
    assert.equal(JSON.parse(serializeModel(model)).bodies[0].faces.filter(f=>f.loops.length===2).length,2);
    if (filter) assert.equal(toStep(model,'regions').match(/MANIFOLD_SOLID_BREP\(/g).length,1);
    else assert.throws(()=>toStep(model,'regions'), /mixed.*(families|carriers)/);
  }
  await assert.rejects(build(source(sketch(true,6)),{feature:'f'}),e=>e.name==='RustCapabilityError'&&/contact|crossing/.test(e.reason));
});

test('composed cylinder membership resolves next-ulp boundaries without an epsilon', async () => {
  const model=await build(source(`
    fCylinder(context,id+"a",{"bottomCenter":vector(0,0,0)*meter,"topCenter":vector(0,0,1)*meter,"radius":1*meter});
    opPattern(context,id+"b",{"entities":${q('a')},"transforms":[transform(vector(16,-8,4)*meter)],"instanceNames":["shift"]});
    opPattern(context,id+"c",{"entities":${q('b')},"transforms":[transform(vector(-16,8,-4)*meter)],"instanceNames":["back"]});`),{feature:'f'});
  const next=x=>{const b=Buffer.alloc(8);b.writeDoubleLE(x);b.writeBigUInt64LE(b.readBigUInt64LE()+1n);return b.readDoubleLE();};
  const m=measureRustBody(rustModelKernel(model),model.bodies[2],{probes:[[1000,0,500],[next(1000),0,500],[0,0,1000],[0,0,next(1000)]]});
  assert.deepEqual(m.probes.map(p=>p.inside),[true,false,true,false]);
  for (const i of [1,3]) {
    const distance=next(1000)-1000;
    assert.ok(Math.abs(m.probes[i].distanceMm-distance)<=m.probes[i].boundMm);
    assert.ok(m.probes[i].boundMm<1e-8);
  }
  const wc0=JSON.parse(serializeModel(model)).bodies[2];
  assert.equal(wc0.vertices.length,2);
  assert.equal(toStep(model,'composed').match(/MANIFOLD_SOLID_BREP\(/g).length,3);
});

test('circle clearance uses binary64 signs and newly admitted holes cannot be discarded by revolve', async () => {
  const previous=1-Number.EPSILON/2;
  const sketch=radius=>`
    var s=newSketchOnPlane(context,id+"s",{"sketchPlane":plane(vector(0,0,0)*meter,vector(0,0,1),vector(1,0,0))});
    skRectangle(s,"outer",{"firstCorner":vector(-1,-1)*meter,"secondCorner":vector(1,1)*meter});
    skCircle(s,"inner",{"center":vector(0,0)*meter,"radius":${radius}*meter}); skSolve(s);`;
  const model=await build(source(sketch(previous)+`
    opExtrude(context,id+"solid",{"entities":qSketchRegion(id+"s",true),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":0.125*meter});`),{feature:'f'});
  assert.equal(model.bodies.length,1);
  assert.equal(measureRustBody(rustModelKernel(model),model.bodies[0]).topology.genus,1);
  for (const radius of [1,1+Number.EPSILON])
    await assert.rejects(build(source(sketch(radius)),{feature:'f'}),e=>e.name==='RustCapabilityError'&&e.reason==='circle-profile/circle-contact-or-crossing');
  await assert.rejects(build(source(sketch(0.5)+`
    try silent { opRevolve(context,id+"r",{"entities":qSketchRegion(id+"s",true),"axis":line(vector(3,0,0)*meter,vector(0,1,0)),"angleForward":360*degree}); }`),{feature:'f'}),
    e=>e.name==='RustCapabilityError'&&e.reason==='revolve/mixed-circle-profile');
});

test('unsupported cylindrical reflections and non-isometric copies are named refusals', async () => {
  for (const [transform,reason] of [
    ['mirrorAcross(plane(vector(0,0,0)*meter,vector(1,0,0)))','cylinder/reflected-placement'],
    ['transform(matrix([[2,0,0],[0,1,0],[0,0,1]]),vector(0,0,0)*meter)','cylinder/non-rigid-placement'],
  ]) {
    await assert.rejects(build(source(`${cylinder('a',0,0,8)}
      try silent { opPattern(context,id+"p",{"entities":${q('a')},"transforms":[${transform}],"instanceNames":["copy"]}); }`),{feature:'f'}),
      e=>e.name==='RustCapabilityError'&&e.reason===reason);
  }
});
