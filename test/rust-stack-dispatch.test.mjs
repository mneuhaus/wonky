// Public FeatureScript regressions for source-chart dispatch and composition.
// Previously the Y pocket guard, multi-pocket limit and composed-placement
// guard prevented these builds. Closed forms below do not call the kernel.
import test from 'node:test';
import assert from 'node:assert/strict';
process.env.WONKY_BACKEND = 'rust';
const {build} = await import('../src/index.mjs');
const {toStep} = await import('../src/exporters.mjs');
const {measureRustBody, rustModelKernel} = await import('../src/native/rust-host.mjs');
const source = body => `FeatureScript 3044; import(path:"onshape/std/geometry.fs",version:"3044.0");
export const f=defineFeature(function(context is Context,id is Id,definition is map) precondition {} {${body}});`;
const query = n => `qCreatedBy(id+"${n}",EntityType.BODY)`;
const cylinder = (n, bottom, top, radius) => `fCylinder(context,id+"${n}",{"bottomCenter":vector(${bottom})*meter,"topCenter":vector(${top})*meter,"radius":${radius}*meter});`;
const square = (n, origin, normal, depth) => `var ${n}=newSketchOnPlane(context,id+"${n}",{"sketchPlane":plane(vector(${origin})*meter,vector(${normal}),vector(1,0,0))});
skRectangle(${n},"r",{"firstCorner":vector(-2,-2)*meter,"secondCorner":vector(2,2)*meter});skSolve(${n});
opExtrude(context,id+"${n}x",{"entities":qSketchRegion(id+"${n}"),"direction":vector(${normal}),"endBound":BoundingType.BLIND,"endDepth":${depth}*meter});`;
const cut = tools => `opBoolean(context,id+"cut",{"targets":${query('rod')},"tools":qUnion([${tools.map(query).join(',')}]),"operationType":BooleanOperationType.SUBTRACTION});`;
const expected = (Math.PI * 24 * 10 - (16 - Math.PI) * 3) * 1e9;
const near = (actual, expected) => assert.ok(Math.abs(actual-expected) <= 1e-10*Math.abs(expected), `${actual} != ${expected}`);

const yStack = cylinder('rod','0,0,0','0,10,0',5)+cylinder('bore','0,-1,0','0,11,0',1)+square('pocket','0,7,0','0,1,0',4)+cut(['bore','pocketx']);
const legacyHoles = cylinder('rod','0,0,0','0,0,10',5)+cylinder('bore','0,0,-1','0,0,11',1)+square('pocket','0,0,7','0,0,1',4)+cut(['bore','pocketx']);
const yRevolve = cylinder('rod','0,0,0','0,10,0',5)+
  `var sink=newSketchOnPlane(context,id+"sink",{"sketchPlane":plane(vector(0,0,0)*meter,vector(0,0,1),vector(0,1,0))});
  const pts=[vector(-1,0),vector(-1,1),vector(9,1),vector(11,3),vector(11,0)];
  for(var i=0;i<5;i+=1)skLineSegment(sink,"p"~i,{"start":pts[i]*meter,"end":pts[(i+1)%5]*meter});
  skSolve(sink);opRevolve(context,id+"revolve",{"entities":qSketchRegion(id+"sink"),"axis":line(vector(0,0,0)*meter,vector(0,1,0)),"angleForward":360*degree});`+cut(['revolve']);
const revolveVolume = (250-9-7/3)*Math.PI*1e9;
// Include a disjoint polygon pocket in the same subtraction. A purely coaxial
// cylinder/revolve difference belongs to the meridian owner, not this stack.
const yRevolveStack = yRevolve.replace(cut(['revolve']),
  `fCuboid(context,id+"pocket",{"corner1":vector(3.5,7,-0.5)*meter,"corner2":vector(4.5,11,0.5)*meter});`+cut(['revolve','pocket']));
for (const [name, input, volume = expected] of [
  ['Y-axis', yStack],
  ['off-origin', cylinder('rod','32,64,128','32,64,138',5)+cylinder('bore','32,64,127','32,64,139',1)+square('pocket','32,64,135','0,0,1',4)+square('bottom','32,64,127','0,0,1',3)+cut(['bore','pocketx','bottomx']), (Math.PI*24*10-(16-Math.PI)*5)*1e9],
  ['Y-axis coaxial revolve', yRevolve, revolveVolume],
  // The box is deliberately first: the Y-cylinder must select the common axis.
  ['box with Y boss', `fCuboid(context,id+"rod",{"corner1":vector(-4,0,-4)*meter,"corner2":vector(4,8,4)*meter});`+cylinder('boss','0,7,0','0,11,0',2)+
    `opBoolean(context,id+"join",{"tools":qUnion([${query('rod')},${query('boss')}]),"operationType":BooleanOperationType.UNION});`+
    cylinder('bore','0,-1,0','0,12,0',1)+cut(['bore']), (512+Math.PI)*1e9],
]) {
  test(`${name} Boolean preserves source charts and exact volume`, async () => {
    const model = await build(source(input), {feature:'f'});
    assert.equal(model.bodies.length, 1);
    const m = measureRustBody(rustModelKernel(model),model.bodies[0]);
    near(m.volumeMm3,volume);
    assert.equal(m.boundToConstruction,true);
    assert.equal(m.topology.genus,1);
    assert.ok(toStep(model,name).includes('CYLINDRICAL_SURFACE('));
  });
}

for (const [name, input, volume, bounds] of [
  ['stack', yStack, expected, [[28000,56000,126000],[38000,66000,136000]]],
  ['legacy prism-holes', legacyHoles, expected, [[33000,61000,126000],[43000,71000,136000]]],
  ['coaxial revolve stack', yRevolveStack, revolveVolume-3e9, [[28000,56000,126000],[38000,66000,136000]]],
]) {
  test(`two placements of a ${name} preserve volume and source frames`, async () => {
    const place = `opTransform(context,id+"place",{"bodies":${query('rod')},"transform":toWorld(coordSystem(vector(32,64,128)*meter,vector(0,0,1),vector(1,0,0)))});
      opTransform(context,id+"again",{"bodies":${query('rod')},"transform":toWorld(coordSystem(vector(1,2,3)*meter,vector(1,0,0),vector(0,0,1)))});`;
    const model = await build(source(input+place),{feature:'f'});
    assert.equal(model.bodies.length,1);
    const measured = measureRustBody(rustModelKernel(model),model.bodies[0]);
    near(measured.volumeMm3,volume);
    // Independently compose the maps: (x,y,z) -> (33+z,66-y,131+x).
    for (let axis=0;axis<3;axis++) {
      near(measured.bboxMm.min[axis],bounds[0][axis]);
      near(measured.bboxMm.max[axis],bounds[1][axis]);
    }
  });
}

test('planar Boolean source replay survives a curved cut and two placements', async () => {
  const place = `opTransform(context,id+"place",{"bodies":${query('rod')},"transform":toWorld(coordSystem(vector(32,64,128)*meter,vector(0,0,1),vector(1,0,0)))});
  opTransform(context,id+"again",{"bodies":${query('rod')},"transform":toWorld(coordSystem(vector(1,2,3)*meter,vector(1,0,0),vector(0,0,1)))});`;
  // Different source planes force a replayed planar Boolean, rather than a
  // cuboid grid. The union is a triangular prism 8*8/2 by 10 metres.
  const triangle = (n,z) => `var ${n}=newSketchOnPlane(context,id+"${n}",{"sketchPlane":plane(vector(0,0,${z})*meter,vector(0,0,1),vector(1,0,0))});
  skPolyline(${n},"p",{"points":[vector(0,0)*meter,vector(8,0)*meter,vector(0,8)*meter,vector(0,0)*meter]});skSolve(${n});
  opExtrude(context,id+"${n}x",{"entities":qSketchRegion(id+"${n}"),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":6*meter});`;
  const joined = triangle('first',0)+triangle('second',4)+
    `opBoolean(context,id+"join",{"tools":qUnion([${query('firstx')},${query('secondx')}]),"operationType":BooleanOperationType.UNION});`+
    cylinder('bore','2,2,-1','2,2,11',1)+
    `opBoolean(context,id+"cut",{"targets":${query('firstx')},"tools":${query('bore')},"operationType":BooleanOperationType.SUBTRACTION});`;
  const prism = await build(source(joined+place.replaceAll(query('rod'),query('firstx'))),{feature:'f'});
  assert.equal(prism.bodies.length,1);
  const measured = measureRustBody(rustModelKernel(prism),prism.bodies[0]);
  near(measured.volumeMm3,(320-10*Math.PI)*1e9);
  for (let axis=0;axis<3;axis++) {
    near(measured.bboxMm.min[axis],[33000,58000,131000][axis]);
    near(measured.bboxMm.max[axis],[43000,66000,139000][axis]);
  }
});

test('binary64-tilted Y-axis circular stack refuses rather than projecting its frame', async () => {
  // Two pockets enter the shared stack, not the one-pocket legacy owner.
  // The circular bore carries a binary64 tilt relative to the Y-axis target;
  // its relation to the target chart must not be normalized or projected.
  const disk = (n,radius,start,depth) => `var ${n}=newSketchOnPlane(context,id+"${n}",{"sketchPlane":plane(vector(0,${start},0)*meter,vector(0,1,0),vector(1,0,0.0000001))});
  skCircle(${n},"c",{"center":vector(0,0)*meter,"radius":${radius}*meter});skSolve(${n});
  opExtrude(context,id+"${n}x",{"entities":qSketchRegion(id+"${n}"),"direction":vector(0,1,0),"endBound":BoundingType.BLIND,"endDepth":${depth}*meter});`;
  const pockets = square('pocket','0,7,0','0,1,0',4)+square('bottom','0,-1,0','0,1,0',3);
  const outer = disk('outer',5,0,10).replace('vector(1,0,0.0000001))','vector(1,0,0))');
  await assert.rejects(build(source(outer+disk('inner',1,-1,12)+pockets+
    `opBoolean(context,id+"cut",{"targets":${query('outerx')},"tools":qUnion([${query('innerx')},${query('pocketx')},${query('bottomx')}]),"operationType":BooleanOperationType.SUBTRACTION});`),{feature:'f'}),
    error => /prism-stack\/non-isometric-frame-relation/.test(error.message));
});

test('cross-axis polygon tool clear of the rod leaves it unchanged', async () => {
  // boolean3d G12 routes this to the general Boolean. The tool (z 7..11)
  // misses the rod (|z| <= 5), so the result is the rod itself: a body with
  // ring edges and no vertex (G14 emits it; G12 refused it by name).
  const model = await build(source(cylinder('rod','0,0,0','0,10,0',5)+square('cross','0,0,7','0,0,1',4)+cut(['crossx'])),{feature:'f'});
  assert.equal(model.bodies.length,1);
  const measured = measureRustBody(rustModelKernel(model),model.bodies[0]);
  near(measured.volumeMm3,250*Math.PI*1e9);
  near(measured.areaMm2,150*Math.PI*1e6);
  assert.deepEqual([measured.topology.faces,measured.topology.vertices,measured.topology.ringEdges],[3,0,2]);
  for (let axis=0;axis<3;axis++) {
    near(measured.bboxMm.min[axis],[-5000,0,-5000][axis]);
    near(measured.bboxMm.max[axis],[5000,10000,5000][axis]);
  }
});

test('a cross-axis polygon tool clear of the rod leaves the rod exactly', async () => {
  // boolean3d G12 routes this to the general Boolean. The tool (z in [7, 11])
  // misses the rod (z in [-5, 5]); the result is the rod itself, a body with
  // rings only, which a Model body now owns through its surfaces (G12b).
  const model = await build(source(cylinder('rod','0,0,0','0,10,0',5)+square('cross','0,0,7','0,0,1',4)+cut(['crossx'])),{feature:'f'});
  assert.equal(model.bodies.length, 1);
  const m = measureRustBody(rustModelKernel(model), model.bodies[0]);
  const rod = Math.PI * 25 * 10 * 1e9;
  assert.ok(Math.abs(m.volumeMm3 - rod) < 1e-12 * rod, `volume ${m.volumeMm3} != ${rod}`);
  assert.equal(m.topology.faces, 3);
  assert.equal(m.topology.vertices, 0);
  assert.deepEqual(m.bboxMm, {min:[-5000,0,-5000], max:[5000,10000,5000]});
});

// Polynomial area 56/3 times depth 3, plus the exposed two-metre boss.
for (const translation of ['1,2,3', '32,64,128']) {
  test(`translated polynomial profile joins a cylinder at ${translation}`, async () => {
    const model = await build(source(`var s=newSketchOnPlane(context,id+"s",{"sketchPlane":plane(vector(0,0,0)*meter,vector(0,0,1),vector(1,0,0))});
skLineSegment(s,"b",{"start":vector(0,0)*meter,"end":vector(4,0)*meter});
skLineSegment(s,"r",{"start":vector(4,0)*meter,"end":vector(4,4)*meter});
skBezier(s,"arch",{"points":[vector(4,4)*meter,vector(2,6)*meter,vector(0,4)*meter]});
skLineSegment(s,"l",{"start":vector(0,4)*meter,"end":vector(0,0)*meter});
skSolve(s);opExtrude(context,id+"sx",{"entities":qSketchRegion(id+"s"),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":3*meter});
fCylinder(context,id+"hub",{"bottomCenter":vector(2,2,2)*meter,"topCenter":vector(2,2,5)*meter,"radius":0.5*meter});
opTransform(context,id+"place",{"bodies":qUnion([qCreatedBy(id+"sx",EntityType.BODY),qCreatedBy(id+"hub",EntityType.BODY)]),"transform":toWorld(coordSystem(vector(${translation})*meter,vector(1,0,0),vector(0,0,1)))});
opBoolean(context,id+"join",{"tools":qUnion([qCreatedBy(id+"sx",EntityType.BODY),qCreatedBy(id+"hub",EntityType.BODY)]),"operationType":BooleanOperationType.UNION});
`), {feature:'f'});
    assert.equal(model.bodies.length, 1);
    const m = measureRustBody(rustModelKernel(model),model.bodies[0]);
    near(m.volumeMm3,(56+Math.PI/2)*1e9);
    assert.equal(m.boundToConstruction,true);
    assert.equal(m.topology.genus,0);
    assert.ok(toStep(model,'translated-spline').includes('SURFACE_OF_LINEAR_EXTRUSION('));
  });
}
