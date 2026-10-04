// Booleans of extruded line/arc/polynomial profiles with a common extrusion axis, through
// the public FeatureScript path. Closed forms from first principles only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {keywayCases,keywayBody,keywayVolume,probeSources} from '../scripts/curve-quadratic-probes.mjs';
const consumerReferences=JSON.parse(fs.readFileSync(new URL('../fixtures/curve-quadratic-consumers.json',import.meta.url),'utf8'));

process.env.WONKY_BACKEND = 'rust';
const {build}=await import('../src/index.mjs');
const {toStep,toStl}=await import('../src/exporters.mjs');
const {measureRustBody,rustMesh,rustModelKernel}=await import('../src/native/rust-host.mjs');
const source=body=>`FeatureScript 3044; import(path:"onshape/std/geometry.fs",version:"3044.0");
export const f=defineFeature(function(context is Context,id is Id,definition is map) precondition {} {${body}});`;
const plane=z=>`plane(vector(0,0,${z})*meter,vector(0,0,1),vector(1,0,0))`;
const extrude=(name,depth)=>`skSolve(${name});opExtrude(context,id+"${name}x",{"entities":qSketchRegion(id+"${name}"),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":${depth}*meter});`;
// 20 x 10 m stadium, end radius 5 m, 4 m thick; a two-arc circle of radius 2 m
// through it (the interpreter's region path) and a 4 x 4 x 2 m top pocket.
const plate=`var s=newSketchOnPlane(context,id+"s",{"sketchPlane":${plane(0)}});
skLineSegment(s,"b",{"start":vector(-10,-5)*meter,"end":vector(10,-5)*meter});
skArc(s,"r",{"start":vector(10,-5)*meter,"mid":vector(15,0)*meter,"end":vector(10,5)*meter});
skLineSegment(s,"t",{"start":vector(10,5)*meter,"end":vector(-10,5)*meter});
skArc(s,"l",{"start":vector(-10,5)*meter,"mid":vector(-15,0)*meter,"end":vector(-10,-5)*meter});
${extrude('s',4)}`;
const tools=`var h=newSketchOnPlane(context,id+"h",{"sketchPlane":${plane(-1)}});
skArc(h,"a",{"start":vector(2,0)*meter,"mid":vector(0,2)*meter,"end":vector(-2,0)*meter});
skArc(h,"c",{"start":vector(-2,0)*meter,"mid":vector(0,-2)*meter,"end":vector(2,0)*meter});
${extrude('h',6)}
fCuboid(context,id+"pocket",{"corner1":vector(5,-2,2)*meter,"corner2":vector(9,2,6)*meter});`;
const near=(actual,expected,rel=1e-10)=>assert.ok(Math.abs(actual-expected)<=rel*Math.abs(expected),`${actual} != ${expected}`);

// qClosestTo is the consumer seam used to select blend edges. A circular
// rim must be measured against its carrier, not the chord or its WC0 cache.
test('closest stacked-profile edges select outer, inner and pocket rims in exact source charts',async()=>{
  const model=await build(source(`${plate}${tools}
opBoolean(context,id+"cut",{"targets":qCreatedBy(id+"sx",EntityType.BODY),"tools":qUnion([qCreatedBy(id+"hx",EntityType.BODY),qCreatedBy(id+"pocket",EntityType.BODY)]),"operationType":BooleanOperationType.SUBTRACTION});
const edges=qOwnedByBody(qCreatedBy(id+"sx",EntityType.BODY),EntityType.EDGE);
for(var p in [vector(15,0,4),vector(0,-5,0),vector(0,2,4),vector(7,-2,2)]) {
  const closest=evaluateQuery(context,qClosestTo(edges,p*meter));
  if(size(closest)!=1)throw "stack rim selection lost";
}
const arc=evaluateQuery(context,qGeometry(qClosestTo(edges,vector(15,0,4)*meter),GeometryType.ARC));
if(size(arc)!=1)throw "outer arc was replaced by its chord";
const lineEdge=evaluateQuery(context,qGeometry(qClosestTo(edges,vector(7,-2,2)*meter),GeometryType.LINE));
if(size(lineEdge)!=1)throw "pocket floor rim selection lost";
`),{feature:'f'});
  near(measureRustBody(rustModelKernel(model),model.bodies[0]).volumeMm3,(768+84*Math.PI)*1e9);
});

test('arc plate minus a two-arc through hole and a box pocket is one exact stacked prism',async()=>{
  const model=await build(source(`${plate}${tools}
opBoolean(context,id+"cut",{"targets":qCreatedBy(id+"sx",EntityType.BODY),"tools":qUnion([qCreatedBy(id+"hx",EntityType.BODY),qCreatedBy(id+"pocket",EntityType.BODY)]),"operationType":BooleanOperationType.SUBTRACTION});`),{feature:'f'});
  assert.equal(model.bodies.length,1);
  const m=measureRustBody(rustModelKernel(model),model.bodies[0]);
  assert.equal(m.certificate,'StackedPrismArrangement');
  // (200 + 25 pi) * 4 - pi * 2^2 * 4 - 4 * 4 * 2 cubic metres.
  near(m.volumeMm3,(768+84*Math.PI)*1e9);
  // Bottom and top, 2 planar + 2 cylindrical plate sides, 2 half-cylinder
  // hole walls, pocket floor and 4 walls; genus 1 from the through hole.
  assert.equal(m.topology.faces,13);assert.equal(m.topology.genus,1);
  const step=toStep(model,'stacked-plate');
  assert.equal(step.match(/CYLINDRICAL_SURFACE\(/g)?.length,4);
  assert.ok(toStl(model,{deviationMm:0.05}).length>84);
});

test('a later union with a rib box and a cross-axis prism keep exact or named outcomes',async()=>{
  const model=await build(source(`${plate}
fCuboid(context,id+"rib",{"corner1":vector(-8,-1,3)*meter,"corner2":vector(-4,1,9)*meter});
opBoolean(context,id+"join",{"tools":qUnion([qCreatedBy(id+"sx",EntityType.BODY),qCreatedBy(id+"rib",EntityType.BODY)]),"operationType":BooleanOperationType.UNION});`),{feature:'f'});
  assert.equal(model.bodies.length,1);
  const m=measureRustBody(rustModelKernel(model),model.bodies[0]);
  // Stadium prism plus the rib part above the plate: 4 * 2 * 5 cubic metres.
  near(m.volumeMm3,((200+25*Math.PI)*4+40)*1e9);
  await assert.rejects(build(source(`${plate}
var y=newSketchOnPlane(context,id+"y",{"sketchPlane":plane(vector(0,-8,0)*meter,vector(0,1,0),vector(1,0,0))});
skLineSegment(y,"b",{"start":vector(-1,-3)*meter,"end":vector(1,-3)*meter});
skArc(y,"r",{"start":vector(1,-3)*meter,"mid":vector(2,-2)*meter,"end":vector(1,-1)*meter});
skLineSegment(y,"t",{"start":vector(1,-1)*meter,"end":vector(-1,-1)*meter});
skArc(y,"l",{"start":vector(-1,-1)*meter,"mid":vector(-2,-2)*meter,"end":vector(-1,-3)*meter});
skSolve(y);opExtrude(context,id+"yx",{"entities":qSketchRegion(id+"y"),"direction":vector(0,1,0),"endBound":BoundingType.BLIND,"endDepth":16*meter});
opBoolean(context,id+"cross",{"targets":qCreatedBy(id+"sx",EntityType.BODY),"tools":qCreatedBy(id+"yx",EntityType.BODY),"operationType":BooleanOperationType.SUBTRACTION});`),{feature:'f'}),
    // boolean3d G12: routed to the general Boolean; the arc-prism operand
    // builds, the cross-axis operand reframes exactly (F2c: radical lines and
    // planar arcs), and its arc's plane chart then refuses by name.
    error=>/boolean\/ssi-row-unavailable:circle\/elliptic-plane-chart/.test(error.message));
});

// A full-turn revolve of (axial, radial) lines about a z axis through (x, 0):
// bore r 1 m from z -1 to 3, then a 45 deg cone leaving the top at r 2 m.
const countersink=x=>`var m=newSketchOnPlane(context,id+"m",{"sketchPlane":plane(vector(${x},0,0)*meter,vector(0,1,0),vector(0,0,1))});
const pts=[vector(-1,0),vector(-1,1),vector(3,1),vector(5,3),vector(5,0)];
for(var i=0;i<5;i+=1)skLineSegment(m,"p"~i,{"start":pts[i]*meter,"end":pts[(i+1)%5]*meter});
skSolve(m);opRevolve(context,id+"cs",{"entities":qSketchRegion(id+"m"),"axis":line(vector(${x},0,0)*meter,vector(0,0,1)),"angleForward":360*degree});
opBoolean(context,id+"sink",{"targets":qCreatedBy(id+"sx",EntityType.BODY),"tools":qCreatedBy(id+"cs",EntityType.BODY),"operationType":BooleanOperationType.SUBTRACTION});`;

test('a coaxial countersink revolve cuts the arc plate exactly; a wall-touching one refuses by name',async()=>{
  const model=await build(source(`${plate}${countersink(2)}`),{feature:'f'});
  assert.equal(model.bodies.length,1);
  const m=measureRustBody(rustModelKernel(model),model.bodies[0]);
  assert.equal(m.certificate,'StackedPrismArrangement');
  // Bore pi * 1^2 * 3 and frustum pi * 1 * (1 + 2 + 4) / 3 leave the plate.
  near(m.volumeMm3,((200+25*Math.PI)*4-16*Math.PI/3)*1e9);
  assert.equal(m.topology.faces,10);assert.equal(m.topology.genus,1);
  const step=toStep(model,'countersunk-plate');
  assert.equal(step.match(/CONICAL_SURFACE\(/g)?.length,2);
  assert.ok(toStl(model,{deviationMm:0.5}).length>84);
  // Centred at x 12 the cone's reach (r 3 m) touches the r 5 m end wall.
  await assert.rejects(build(source(`${plate}${countersink(12)}`),{feature:'f'}),
    error=>/prism-stack\/tool-crosses-boundary/.test(error.message));
});

// The distinct production risk here is admission + audit/replay + export of
// radical vertices, not the scalar arithmetic already owned by wonky-curve.
const discPrism=`var s=newSketchOnPlane(context,id+"s",{"sketchPlane":${plane(0)}});
skArc(s,"u",{"start":vector(2,0)*meter,"mid":vector(0,2)*meter,"end":vector(-2,0)*meter});
skArc(s,"d",{"start":vector(-2,0)*meter,"mid":vector(0,-2)*meter,"end":vector(2,0)*meter});
${extrude('s',4)}`;

test('quadratic keyway contacts survive audit and exact exports; a sub-reader lens is refused before a body',async()=>{
  const cut=(x,y)=>`${discPrism}
fCuboid(context,id+"key",{"corner1":vector(${x},${y},1)*meter,"corner2":vector(3,3,5)*meter});
opBoolean(context,id+"cut",{"targets":qCreatedBy(id+"sx",EntityType.BODY),"tools":qCreatedBy(id+"key",EntityType.BODY),"operationType":BooleanOperationType.SUBTRACTION});`;
  const model=await build(source(`${discPrism}
fCuboid(context,id+"key",{"corner1":vector(1,-1,1)*meter,"corner2":vector(3,1,5)*meter});
opBoolean(context,id+"cut",{"targets":qCreatedBy(id+"sx",EntityType.BODY),"tools":qCreatedBy(id+"key",EntityType.BODY),"operationType":BooleanOperationType.SUBTRACTION});`),{feature:'f'});
  assert.equal(model.bodies.length,1);
  const m=measureRustBody(rustModelKernel(model),model.bodies[0]);
  near(m.volumeMm3,(16*Math.PI-3*(Math.sqrt(3)+2*Math.PI/3-2))*1e9);
  assert.equal(m.certificate,'StackedPrismArrangement');
  assert.equal(m.topology.genus,0);
  assert.ok(toStep(model,'quadratic-keyway').includes('CYLINDRICAL_SURFACE('));
  assert.ok(toStl(model,{deviationMm:20}).length>84);
  // One source sketch produces two separate tool bodies. Their later audit
  // must replay each recorded region, not all regions or merely the first.
  const double=await build(source(`${discPrism}
var k=newSketchOnPlane(context,id+"k",{"sketchPlane":${plane(1)}});
skRectangle(k,"r",{"firstCorner":vector(1,-1)*meter,"secondCorner":vector(3,1)*meter});
skRectangle(k,"l",{"firstCorner":vector(-3,-1)*meter,"secondCorner":vector(-1,1)*meter});
${extrude('k',3)}
opBoolean(context,id+"cut",{"targets":qCreatedBy(id+"sx",EntityType.BODY),"tools":qCreatedBy(id+"kx",EntityType.BODY),"operationType":BooleanOperationType.SUBTRACTION});`),{feature:'f'});
  assert.equal(double.bodies.length,1);
  const dm=measureRustBody(rustModelKernel(double),double.bodies[0]);
  near(dm.volumeMm3,(16*Math.PI-6*(Math.sqrt(3)+2*Math.PI/3-2))*1e9);
  assert.equal(dm.certificate,'StackedPrismArrangement');
  assert.equal(dm.topology.genus,0);
  assert.ok(toStep(double,'two-region-keyway').includes('CYLINDRICAL_SURFACE('));
  await assert.rejects(build(source(cut(-3,2-2**-40)),{feature:'f'}),
    error=>/curve2\/sub-resolution-feature/.test(error.message));
});

// All six public-corpus keyway parameter sets, not the two earlier archetypes.
// The corpus specifies no axial position; centre the windows in the shaft and
// place paired keys on opposite sides. Integrate the circular strip directly.
for(const c of keywayCases){
  const [id]=c;
  test(`public corpus ${id} keyways preserve exact volume and exports`,async()=>{
    const model=await build(source(keywayBody(c)),{feature:'f'});
    assert.equal(model.bodies.length,1);
    const measured=measureRustBody(rustModelKernel(model),model.bodies[0]);
    near(measured.volumeMm3,keywayVolume(c));
    // The independently observed reference is rounded to four decimal places.
    assert.ok(Math.abs(measured.volumeMm3-consumerReferences.references[id].volumeMm3)<=0.00005);
    assert.equal(measured.certificate,'StackedPrismArrangement');
    assert.equal(measured.topology.genus,0);
    assert.ok(toStep(model,id).includes('CYLINDRICAL_SURFACE('));
    assert.ok(toStl(model,{deviationMm:0.1}).length>84);
  });
}

// A periodic carrier can own a window: retain its original seam while merging
// the split arc bands, rather than refusing the resulting closed carrier chain.
test('closed cylindrical bands with axial windows retain exact periodic topology',async()=>{
  for(const [offset,low,high] of [[0,8,22],[40,8,22],[0,0,14],[0,16,30]]){
    const model=await build(source(`
      fCylinder(context,id+"shaft",{"bottomCenter":vector(${offset},0,0)*millimeter,"topCenter":vector(${offset},0,30)*millimeter,"radius":5*millimeter});
      fCuboid(context,id+"slot",{"corner1":vector(${offset-3},3,${low})*millimeter,"corner2":vector(${offset+3},7,${high})*millimeter});
      opBoolean(context,id+"cut",{"targets":qCreatedBy(id+"shaft",EntityType.BODY),"tools":qCreatedBy(id+"slot",EntityType.BODY),"operationType":BooleanOperationType.SUBTRACTION});
    `),{feature:'f'});
    assert.equal(model.bodies.length,1);
    const measured=measureRustBody(rustModelKernel(model),model.bodies[0]);
    near(measured.volumeMm3,750*Math.PI+84-350*Math.asin(3/5));
    assert.equal(measured.topology.genus,0);
    assert.ok(toStep(model,'window-shaft').includes('CYLINDRICAL_SURFACE('));
    assert.ok(toStl(model,{deviationMm:0.05}).length>84);
  }
});

// A blind revolve endpoint is absent from the extrusion-level list. The
// remaining floor still has to survive the same declared reader allowance.
test('quadratic prism tools certify blind floor and wall clearances',async()=>{
  const bore=(floor,radius=1)=>source(`
    fCylinder(context,id+"shaft",{"bottomCenter":vector(0,0,0)*meter,"topCenter":vector(0,0,4)*meter,"radius":5*meter});
    fCuboid(context,id+"slot",{"corner1":vector(3.5,-1,0)*meter,"corner2":vector(9,1,4)*meter});
    var m=newSketchOnPlane(context,id+"m",{"sketchPlane":plane(vector(-2,0,0)*meter,vector(0,1,0),vector(0,0,1))});
    const pts=[vector(${floor},0),vector(${floor},${radius}),vector(5,${radius}),vector(5,0)];
    for(var i=0;i<4;i+=1)skLineSegment(m,"p"~i,{"start":pts[i]*meter,"end":pts[(i+1)%4]*meter});
    skSolve(m);opRevolve(context,id+"bore",{"entities":qSketchRegion(id+"m"),"axis":line(vector(-2,0,0)*meter,vector(0,0,1)),"angleForward":360*degree});
    opBoolean(context,id+"cut",{"targets":qCreatedBy(id+"shaft",EntityType.BODY),"tools":qUnion([qCreatedBy(id+"slot",EntityType.BODY),qCreatedBy(id+"bore",EntityType.BODY)]),"operationType":BooleanOperationType.SUBTRACTION});`);
  await assert.rejects(build(bore(1e-12),{feature:'f'}),error=>/curve2\/sub-resolution-feature/.test(error.message));
  const resolved=await build(bore(1e-6),{feature:'f'});
  assert.equal(resolved.bodies.length,1);
  assert.ok(toStep(resolved,'resolved-blind-floor').includes('CYLINDRICAL_SURFACE('));
  await assert.rejects(build(bore(1e-6,3-1e-12),{feature:'f'}),error=>/curve2\/sub-resolution-feature/.test(error.message));
});

for (const c of probeSources().filter(c=>c.name.startsWith('ac73-'))) {
  test(`${c.name} exact hub/shaft integration and exported geometry`,async()=>{
    const model=await build(c.source,{feature:'probe'});
    assert.equal(model.bodies.length,1);
    const m=measureRustBody(rustModelKernel(model),model.bodies[0]);
    near(m.volumeMm3,c.expectedMm3,1e-12);
    assert.equal(m.certificate,'StackedPrismArrangement');
    assert.equal(m.topology.genus,c.name.includes('hub')?1:0);
    assert.ok(toStep(model,c.name).includes('CYLINDRICAL_SURFACE('));
    assert.ok(toStl(model,{deviationMm:0.05}).length>84);
  });
}

for (const c of probeSources().filter(c=>c.name.endsWith('-unchamfered'))) {
  test(`${c.name} reference-dimension pin builds exact crossing geometry`,async()=>{
    const model=await build(c.source,{feature:'probe'});
    assert.equal(model.bodies.length,1);
    const m=measureRustBody(rustModelKernel(model),model.bodies[0]);
    near(m.volumeMm3,c.expectedMm3,1e-12);
    assert.equal(m.certificate,'StackedPrismArrangement');
    assert.equal(m.topology.genus,0);
    assert.ok(toStep(model,c.name).includes('CYLINDRICAL_SURFACE('));
    assert.ok(toStl(model,{deviationMm:0.01}).length>84);
  });
}
for (const c of probeSources().filter(c=>c.name.endsWith('-full'))) {
  test(`${c.name} retains named incomplete cap-loop chamfer refusal`,async()=>{
    // The merged stack blend admits complete cap loops. These queries select
    // only circular/arc rims and omit the straight edges of the slot caps.
    await assert.rejects(build(c.source,{feature:'probe'}),
      error=>error.name==='RustCapabilityError'&&error.reason==='stack-blend/whole-cap-loop-required');
  });
}
// Public interpreter routing: a polynomial cap with a round boss and bore.
// y(t)=4+4t-4t^2, x(t)=4-4t gives area 56/3 independently.
test('a polynomial prism joins a round boss then drills a bore without legacy clearance refusal',async()=>{
  const model=await build(source(`
var s=newSketchOnPlane(context,id+"s",{"sketchPlane":${plane(0)}});
skLineSegment(s,"b",{"start":vector(0,0)*meter,"end":vector(4,0)*meter});
skLineSegment(s,"r",{"start":vector(4,0)*meter,"end":vector(4,4)*meter});
skBezier(s,"arch",{"points":[vector(4,4)*meter,vector(2,6)*meter,vector(0,4)*meter]});
skLineSegment(s,"l",{"start":vector(0,4)*meter,"end":vector(0,0)*meter});
${extrude('s',3)}
fCylinder(context,id+"hub",{"bottomCenter":vector(2,2,2)*meter,"topCenter":vector(2,2,5)*meter,"radius":0.5*meter});
opBoolean(context,id+"join",{"tools":qUnion([qCreatedBy(id+"sx",EntityType.BODY),qCreatedBy(id+"hub",EntityType.BODY)]),"operationType":BooleanOperationType.UNION});
fCylinder(context,id+"bore",{"bottomCenter":vector(2,2,-1)*meter,"topCenter":vector(2,2,6)*meter,"radius":0.25*meter});
// UNION modifies a surviving input identity; it need not create a new BODY.
opBoolean(context,id+"cut",{"targets":qUnion([qCreatedBy(id+"sx",EntityType.BODY),qCreatedBy(id+"hub",EntityType.BODY)]),"tools":qCreatedBy(id+"bore",EntityType.BODY),"operationType":BooleanOperationType.SUBTRACTION});
`),{feature:'f'});
  assert.equal(model.bodies.length,1);
  const m=measureRustBody(rustModelKernel(model),model.bodies[0],{surfaceTypes:true});
  assert.equal(m.certificate,'StackedPrismArrangement');
  assert.deepEqual(m.surfaceTypes,{Plane:6,Cylinder:2,SurfaceOfExtrusion:1});
  near(m.volumeMm3,(56+3*Math.PI/16)*1e9);
  assert.equal(m.topology.genus,1);
  assert.equal(m.topology.faces,9);
  // Four unanchored rings, no artificial cylindrical chart seams/vertices.
  assert.equal(m.topology.edges,16);assert.equal(m.topology.vertices,8);
  assert.equal(m.topology.loops,14);assert.equal(m.topology.ringEdges,4);
  const step=toStep(model,'polynomial-stack');
  assert.equal(step.match(/SURFACE_OF_LINEAR_EXTRUSION\(/g)?.length,1);
  assert.equal(step.match(/CYLINDRICAL_SURFACE\(/g)?.length,2);
  assert.ok(toStl(model,{deviationMm:1}).length>84);
});

// Only the test input changes: this hub crosses the polynomial gear flanks
// (root r 10.125 mm, base r about 11.276 mm, tip r 13.5 mm). An algebraic
// arrangement vertex is not supported by this strand, so no successful solid.
test('a gear hub larger than the root and base refuses algebraic flank crossings',async()=>{
  const original=fs.readFileSync(new URL('../fixtures/cad-acid/fs/acid-splines-a.fs',import.meta.url),'utf8');
  assert.equal(original.split('6 + dr').length-1,2);
  const crossing=original.replaceAll('6 + dr','12 + dr');
  await assert.rejects(build(crossing,{feature:'acidSplinesA',
    parameters:{variant:'AcidVariant.V0',zone:'AcidSplinesAZone.AC102'}}),
    error=>/curve2\/crossing-needs-algebraic-vertex/.test(error.message));
});

const identityUnion = `opBoolean(context,id+"identity",{"tools":qUnion([qCreatedBy(id+"sx",EntityType.BODY),qCreatedBy(id+"copyx",EntityType.BODY)]),"operationType":BooleanOperationType.UNION});`;
const meshProfile = (points, apex, origin = 0, depth = 0.001, name = 's') => `var ${name}=newSketchOnPlane(context,id+"${name}",{"sketchPlane":${plane(origin)}});
skBezier(${name},"arch",{"points":[${points.map(p=>`vector(${p[0]},${p[1]})*meter`).join(',')}]});
${apex ? `skLineSegment(${name},"r",{"start":vector(${points.at(-1)})*meter,"end":vector(${apex})*meter});
skLineSegment(${name},"l",{"start":vector(${apex})*meter,"end":vector(0,0)*meter});` : `skLineSegment(${name},"chord",{"start":vector(${points.at(-1)})*meter,"end":vector(0,0)*meter});`}
${extrude(name,depth)}`;

test('Boolean identity retains thin-feature refinement in public display mesh and serialized STL',async()=>{
  const points=[[0,0],[0.008,0.006],[0.012,0.006],[0.020,0]];
  const apex=[0.007156982421875,(4.060546875-1/128)*0.001];
  const input=meshProfile(points,apex);
  const leaf=await build(source(input),{feature:'f'});
  // Rebuild the identical leaf: spline opPattern is not supported yet.
  const stack=await build(source(input+meshProfile(points,apex,0,0.001,'copy')+identityUnion),{feature:'f'});
  const before=rustMesh(rustModelKernel(leaf),leaf.bodies,0.2).bodies[0];
  const after=rustMesh(rustModelKernel(stack),stack.bodies,0.2).bodies[0];
  assert.ok(after.vertices.length>=before.vertices.length,'identity cannot replace refined boundary by coarse chords');
  assert.ok(after.vertices.length/3>100,'thin gap requires refinement');
  const stl=toStl(stack,{deviationMm:0.2});
  assert.equal(stl.readUInt32LE(80),after.triangles.length/3);
});

test('Boolean identity cannot hide world-coordinate rounding beyond mesh deviation',async()=>{
  const points=[[0,0],[0.008,0.006],[0.018,0.006],[0.026,0]];
  const input=meshProfile(points,null,1e12,0.00103);
  const model=await build(source(input+meshProfile(points,null,1e12,0.00103,'copy')+identityUnion),{feature:'f'});
  assert.equal(measureRustBody(rustModelKernel(model),model.bodies[0]).certificate,'StackedPrismArrangement');
  assert.throws(()=>rustMesh(rustModelKernel(model),model.bodies,0.01),/export\/stl\/vertex-precision-budget/);
  assert.throws(()=>toStl(model,{deviationMm:0.01}),/export\/stl\/vertex-precision-budget/);
});

// Integration seam: spline and quadratic vertices coexist in one arrangement.
// The window meets only the round boss; no unsupported spline crossing is needed.
test('a spline stack retains exact quadratic boss-window contacts and exports',async()=>{
  const model=await build(source(`
var s=newSketchOnPlane(context,id+"s",{"sketchPlane":${plane(0)}});
skLineSegment(s,"b",{"start":vector(0,0)*meter,"end":vector(4,0)*meter});
skLineSegment(s,"r",{"start":vector(4,0)*meter,"end":vector(4,4)*meter});
skBezier(s,"arch",{"points":[vector(4,4)*meter,vector(2,6)*meter,vector(0,4)*meter]});
skLineSegment(s,"l",{"start":vector(0,4)*meter,"end":vector(0,0)*meter});
${extrude('s',3)}
fCylinder(context,id+"hub",{"bottomCenter":vector(2,2,2)*meter,"topCenter":vector(2,2,5)*meter,"radius":0.5*meter});
opBoolean(context,id+"join",{"tools":qUnion([qCreatedBy(id+"sx",EntityType.BODY),qCreatedBy(id+"hub",EntityType.BODY)]),"operationType":BooleanOperationType.UNION});
fCuboid(context,id+"window",{"corner1":vector(2.3,1.8,3)*meter,"corner2":vector(3,2.2,6)*meter});
opBoolean(context,id+"cut",{"targets":qUnion([qCreatedBy(id+"sx",EntityType.BODY),qCreatedBy(id+"hub",EntityType.BODY)]),"tools":qCreatedBy(id+"window",EntityType.BODY),"operationType":BooleanOperationType.SUBTRACTION});
`),{feature:'f'});
  assert.equal(model.bodies.length,1);
  const m=measureRustBody(rustModelKernel(model),model.bodies[0]);
  const removed=2*(0.2*Math.sqrt(0.25-0.04)+0.25*Math.asin(0.4)-0.12);
  near(m.volumeMm3,(56+Math.PI/2-removed)*1e9);
  assert.equal(m.certificate,'StackedPrismArrangement');
  assert.equal(m.topology.genus,0);
  const step=toStep(model,'spline-quadratic-stack');
  assert.ok(step.includes('SURFACE_OF_LINEAR_EXTRUSION('));
  assert.ok(step.includes('CYLINDRICAL_SURFACE('));
  assert.ok(toStl(model,{deviationMm:1}).length>84);
});
