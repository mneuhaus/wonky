// The public FS transport owns arc ordering, reverse-depth and serialization.
// Independent closed forms protect the result, never private carrier layout.
import test from 'node:test';
import assert from 'node:assert/strict';
process.env.WONKY_BACKEND = 'rust';
const {build}=await import('../src/index.mjs');
const {toStep}=await import('../src/exporters.mjs');
const {serializeModel}=await import('../src/construction-history.mjs');
const {measureRustBody,rustModelKernel}=await import('../src/native/rust-host.mjs');
const source=body=>`FeatureScript 3044; import(path:"onshape/std/geometry.fs",version:"3044.0");
export const f=defineFeature(function(context is Context,id is Id,definition is map) precondition {} {${body}});`;
const sketch=`var s=newSketchOnPlane(context,id+"s",{"sketchPlane":plane(vector(0,0,0)*meter,vector(0,0,1),vector(1,0,0))});`;
const extrude=(reverse=false)=>`skSolve(s);opExtrude(context,id+"e",{"entities":qSketchRegion(id+"s"),"direction":vector(0,0,${reverse?-1:1}),"endBound":BoundingType.BLIND,"endDepth":0.5*meter});`;
const chain=(count=1)=>{
  const lines=[];
  for(let i=0;i<count;i++){
    const a=1+i*8/count,b=1+(i+1)*8/count;
    lines.push(`skLineSegment(s,"bottom${i}",{"start":vector(${a},0)*meter,"end":vector(${b},0)*meter});`);
    lines.push(`skLineSegment(s,"top${i}",{"start":vector(${a},2)*meter,"end":vector(${b},2)*meter});`);
  }
  // Deliberately unordered, with the upper line running opposite the boundary.
  return lines.join('\n')+`skArc(s,"left",{"start":vector(1,2)*meter,"mid":vector(0,1)*meter,"end":vector(1,0)*meter});
    skArc(s,"right",{"start":vector(9,0)*meter,"mid":vector(10,1)*meter,"end":vector(9,2)*meter});`;
};
const near=(actual,expected,rel=1e-10)=>assert.ok(Math.abs(actual-expected)<=rel*Math.max(1,Math.abs(expected)),`${actual} != ${expected}`);
test('unordered mixed arcs retain exact cylindrical trims, volume, probes and reversed depth',async()=>{
  for(const reverse of [false,true]){
    const model=await build(source(sketch+chain()+extrude(reverse)),{feature:'f'});
    assert.equal(model.bodies.length,1);
    const z=reverse?-250:250;
    const m=measureRustBody(rustModelKernel(model),model.bodies[0],{probes:[[13000,1000,z],[5000,5000,z],[5000,1000,z],[10000,1000,z]]});
    near(m.volumeMm3,(16+Math.PI)*0.5e9);
    near(m.areaMm2,(2*(16+Math.PI)+0.5*(16+2*Math.PI))*1e6);
    assert.equal(m.topology.faces,6);assert.equal(m.topology.edges,12);assert.equal(m.topology.vertices,8);
    for(let i=0;i<4;i++){assert.ok(!m.probes[i].refused);near(m.probes[i].distanceMm,[3000,3000,0,0][i]);}
    assert.equal(m.probes[2].inside,true);assert.equal(m.probes[3].inside,true);
    near(m.centroidMm[0],5000);near(m.centroidMm[1],1000);near(m.centroidMm[2],z);
    const record=JSON.parse(serializeModel(model)).bodies[0];assert.equal(record.faces.length,6);
    const step=toStep(model,'arc-chain');assert.equal(step.match(/CYLINDRICAL_SURFACE\(/g)?.length,2);assert.equal(step.match(/CIRCLE\(/g)?.length,4);
  }
});
test('432-segment tangent chain preserves 286 analytic arcs without a small-profile ceiling',async()=>{
  const pieces=[];
  const line=(a,b)=>pieces.push(`skLineSegment(s,"e${pieces.length}",{"start":vector(${a})*meter,"end":vector(${b})*meter});`);
  const arc=(a,mid,b)=>pieces.push(`skArc(s,"e${pieces.length}",{"start":vector(${a})*meter,"mid":vector(${mid})*meter,"end":vector(${b})*meter});`);
  // Integer 3-4-5 circle points produce exactly tangent quarter arcs. Each
  // 40-wide wave has area 200 above its baseline, by reflection symmetry.
  for(let j=0;j<71;j++){
    const x=j*40;
    arc([x,0],[x+3,1],[x+5,5]); arc([x+5,5],[x+7,9],[x+10,10]);
    line([x+10,10],[x+20,10]);
    arc([x+20,10],[x+23,9],[x+25,5]); arc([x+25,5],[x+27,1],[x+30,0]);
    line([x+30,0],[x+40,0]);
  }
  const width=71*40;
  arc([width,0],[width+5,-5],[width,-10]);
  for(let j=0;j<4;j++)line([width*(4-j)/4,-10],[width*(3-j)/4,-10]);
  arc([0,-10],[-5,-5],[0,0]);
  const model=await build(source(sketch+pieces.join('\n')+extrude()),{feature:'f'});
  const m=measureRustBody(rustModelKernel(model),model.bodies[0]);
  near(m.volumeMm3,(width*15+25*Math.PI)*0.5e9);
  assert.equal(m.topology.faces,434);assert.equal(m.topology.edges,1296);
  assert.equal(toStep(model,'long-chain').match(/CYLINDRICAL_SURFACE\(/g)?.length,286);
});
test('collinear arcs and disconnected mixed endpoints refuse instead of inventing closure',async()=>{
  const invalid=[
    [chain().replace('vector(10,1)','vector(9,1)'), 'arc-profile/collinear-three-point-arc'],
    // Shorten the top line. Extending it would still bound a closed region:
    // the arc endpoint lies in the extended line's interior and must be split.
    [chain().replace('vector(9,2)*meter});','vector(8.999999,2)*meter});'), 'open-profile'],
  ];
  for(const [body,reason] of invalid)await assert.rejects(build(source(sketch+body+extrude()),{feature:'f'}),e=>(e.reason??e.refusalCategory)===reason);
});
// The same-sketch region selection is fused in opExtrude; the native per-face
// tests still verify each selected source region's exact volume separately.
test('FeatureScript fuses split arc regions and exports one exact STEP solid',async()=>{
  const entities=`skArc(s,"arc",{"start":vector(5,0)*meter,"mid":vector(0,5)*meter,"end":vector(-5,0)*meter});
    skLineSegment(s,"base",{"start":vector(-5,0)*meter,"end":vector(5,0)*meter});
    skLineSegment(s,"cut",{"start":vector(5,0)*meter,"end":vector(-4,6)*meter});`;
  const model=await build(source(sketch+entities+extrude()),{feature:'f'});
  assert.equal(model.bodies.length,1);
  near(measureRustBody(rustModelKernel(model),model.bodies[0]).volumeMm3,25*Math.PI*0.25e9);
  assert.equal(JSON.parse(serializeModel(model)).bodies.length,1);
  assert.equal(toStep(model,'split-arcs').match(/MANIFOLD_SOLID_BREP\(/g)?.length,1);
});

// Two half-disks share the exact diameter. One opExtrude must return their
// fused outer disk, while a mere vertex contact must never invent a manifold.
test('one opExtrude fuses adjacent arc regions along a shared sketch edge', async () => {
  const diameter = `skLineSegment(s,"diameter",{"start":vector(-1,0)*meter,"end":vector(1,0)*meter});
    skArc(s,"upper",{"start":vector(1,0)*meter,"mid":vector(0,1)*meter,"end":vector(-1,0)*meter});
    skArc(s,"lower",{"start":vector(-1,0)*meter,"mid":vector(0,-1)*meter,"end":vector(1,0)*meter});`;
  const model = await build(source(sketch + diameter + extrude()), { feature: 'f' });
  assert.equal(model.bodies.length, 1);
  const m = measureRustBody(rustModelKernel(model), model.bodies[0]);
  assert.equal(m.validity.closed, true);
  near(m.volumeMm3, Math.PI * 0.5e9);
  assert.equal(toStep(model, 'fused-half-disks').match(/CYLINDRICAL_SURFACE\(/g)?.length, 2);
});

test('point-only arc sketch contact refuses rather than fusing solids', async () => {
  const touching = `skLineSegment(s,"a0",{"start":vector(0,0)*meter,"end":vector(2,0)*meter});
    skLineSegment(s,"a1",{"start":vector(2,0)*meter,"end":vector(0,2)*meter});
    skArc(s,"a2",{"start":vector(0,2)*meter,"mid":vector(-1,1)*meter,"end":vector(0,0)*meter});
    skLineSegment(s,"b0",{"start":vector(0,0)*meter,"end":vector(-2,0)*meter});
    skLineSegment(s,"b1",{"start":vector(-2,0)*meter,"end":vector(-2,-2)*meter});
    skLineSegment(s,"b2",{"start":vector(-2,-2)*meter,"end":vector(0,0)*meter});`;
  await assert.rejects(build(source(sketch + touching + extrude()), { feature: 'f' }),
    e => e.name === 'RustCapabilityError' && /non-simple-exterior-walk|tangent-branch-order/.test(e.reason));
});

test('axial profile holes survive FS tool consumption, WC0 serialization and independent STEP reimport',async()=>{
  const fs=await import('node:fs');const os=await import('node:os');const path=await import('node:path');
  const {spawnSync}=await import('node:child_process');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wonky-profile-holes-'));const prefixes=[];
  try {
    for(const [name,target,tools] of [
      ['arc',sketch+`skLineSegment(s,"a",{"start":vector(0,5)*meter,"end":vector(0,0)*meter});
        skLineSegment(s,"b",{"start":vector(0,0)*meter,"end":vector(5,0)*meter});
        skArc(s,"c",{"start":vector(5,0)*meter,"mid":vector(3,4)*meter,"end":vector(0,5)*meter});`+extrude(),[[1,2,-1,1,0.25]]],
      ['polygon',sketch+`skPolyline(s,"outline",{"points":[vector(0,0)*meter,vector(8,0)*meter,vector(6,6)*meter,vector(0,6)*meter,vector(0,0)*meter]});`+extrude(),[[2,2,-1,1,0.5],[5,2,0.25,1,0.5]]],
      // A trig polygon has exact input vertices but non-binary64 lateral normals.
      // Its bored volume and STEP must use the replayed rational planes.
      ['trig-polygon',sketch+`var points=[]; for(var i=0;i<19;i+=1) points=append(points,vector(6*cos(i*360/19*degree),6*sin(i*360/19*degree))*meter);
        points=append(points,points[0]); skPolyline(s,"outline",{"points":points});`+extrude(),[[0,0,-1,1,0.5]]],
      ['offaxis',`fCylinder(context,id+"e",{"bottomCenter":vector(0,0,0)*meter,"topCenter":vector(0,0,0.5)*meter,"radius":5*meter});`,[[2,0,0.25,1,1]]],
    ]) {
      const cuts=tools.map(([x,y,lo,hi,r],i)=>`fCylinder(context,id+"tool${i}",{"bottomCenter":vector(${x},${y},${lo})*meter,"topCenter":vector(${x},${y},${hi})*meter,"radius":${r}*meter});`).join('\n');
      const queries=tools.map((_,i)=>`qCreatedBy(id+"tool${i}",EntityType.BODY)`).join(',');
      const model=await build(source(target+cuts+`opBoolean(context,id+"cut",{"targets":qCreatedBy(id+"e",EntityType.BODY),"tools":qUnion([${queries}]),"operationType":BooleanOperationType.SUBTRACTION});`),{feature:'f'});
      assert.equal(model.bodies.length,1,'tools must be consumed, not retained as fake cut solids');
      if(name==='trig-polygon') {
        near(measureRustBody(rustModelKernel(model),model.bodies[0]).volumeMm3,
          (19*18*Math.sin(2*Math.PI/19)-Math.PI*0.25)*0.5*1e9);
      }
      const prefix=path.join(dir,name);fs.writeFileSync(prefix+'.step',toStep(model,name));
      const serialized=serializeModel(model);assert.equal(JSON.parse(serialized).bodies.length,1);
      fs.writeFileSync(prefix+'.brep.json',serialized);prefixes.push(prefix);
    }
    const run=spawnSync('uv',['run','scripts/validate-step.py',...prefixes],{encoding:'utf8',timeout:120000,maxBuffer:8<<20});
    assert.equal(run.status,0,run.stderr||String(run.error));
    assert.equal(JSON.parse(run.stdout).length,prefixes.length);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

// The frontend owns geometric-error translation and Boolean rollback, distinct
// from the native chart/predicate contracts.
test('empty and tangent axial cuts keep geometric error categories and leave inputs intact',async()=>{
  for(const [center,radius,category] of [[0,5,'empty-result'],[4,1,'non-manifold-result']]) {
    const body=`fCylinder(context,id+"base",{"bottomCenter":vector(0,0,0)*meter,"topCenter":vector(0,0,1)*meter,"radius":5*meter});
      fCylinder(context,id+"tool",{"bottomCenter":vector(${center},0,-1)*meter,"topCenter":vector(${center},0,2)*meter,"radius":${radius}*meter});`;
    const cut=`opBoolean(context,id+"cut",{"targets":qCreatedBy(id+"base",EntityType.BODY),"tools":qCreatedBy(id+"tool",EntityType.BODY),"operationType":BooleanOperationType.SUBTRACTION});`;
    await assert.rejects(build(source(body+cut),{feature:'f'}),e=>e.refusalCategory===category);
    const model=await build(source(body+`try silent {${cut}}`),{feature:'f'});
    assert.equal(model.bodies.length,2);
    near(measureRustBody(rustModelKernel(model),model.bodies[0]).volumeMm3,25*Math.PI*1e9);
  }
});

// Unlike the native dyadic topology tests, this transport/oracle case exercises
// a floor at origin+depth that is not representable in binary64, and a trig
// outer profile with rational side planes. OCCT only validates the exported STEP.
// The sequential form subtracts bore then pocket from the cylinder (a coaxial
// tube stage) and pocket then bore from the polygon (a pocket-only stage).
test('polygon pockets from one or two subtractions export sewn circular and rational-profile boundaries at exact source heights',async()=>{
  const fs=await import('node:fs');const os=await import('node:os');const path=await import('node:path');
  const {spawnSync}=await import('node:child_process');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wonky-polygon-pocket-'));const prefixes=[];
  try {
    for(const polygon of [false,true]) for(const sequential of [false,true]) {
      const target=polygon?sketch+`var pts=[]; for(var i=0;i<23;i+=1) pts=append(pts,vector(9*cos(i*360/23*degree),9*sin(i*360/23*degree))*millimeter);
        pts=append(pts,pts[0]);skPolyline(s,"outline",{"points":pts});skSolve(s);
        opExtrude(context,id+"e",{"entities":qSketchRegion(id+"s"),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":17*millimeter});`
        :`fCylinder(context,id+"e",{"bottomCenter":vector(0,0,0)*millimeter,"topCenter":vector(0,0,17)*millimeter,"radius":9*millimeter});`;
      const cuts=`fCylinder(context,id+"bore",{"bottomCenter":vector(0,0,-1)*millimeter,"topCenter":vector(0,0,18)*millimeter,"radius":1.3*millimeter});
        var p=newSketchOnPlane(context,id+"p",{"sketchPlane":plane(vector(0,0,-0.03)*millimeter,vector(0,0,1),vector(1,0,0))});
        const a=2.7*millimeter; const h=a/sqrt(3);
        skPolyline(p,"pocket",{"points":[vector(2*h,0*meter),vector(h,a),vector(-h,a),vector(-2*h,0*meter),vector(-h,-a),vector(h,-a),vector(2*h,0*meter)]});skSolve(p);
        opExtrude(context,id+"pocket",{"entities":qSketchRegion(id+"p"),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":3.73*millimeter});`+
        (sequential?(polygon?['pocket','bore']:['bore','pocket']).map((tool,i)=>
          `opBoolean(context,id+"cut${i}",{"targets":qCreatedBy(id+"e",EntityType.BODY),"tools":qCreatedBy(id+"${tool}",EntityType.BODY),"operationType":BooleanOperationType.SUBTRACTION});`).join('')
        :`opBoolean(context,id+"cut",{"targets":qCreatedBy(id+"e",EntityType.BODY),"tools":qUnion([qCreatedBy(id+"bore",EntityType.BODY),qCreatedBy(id+"pocket",EntityType.BODY)]),"operationType":BooleanOperationType.SUBTRACTION});`);
      const model=await build(source(target+cuts),{feature:'f'});
      assert.equal(model.bodies.length,1);
      const m=measureRustBody(rustModelKernel(model),model.bodies[0]);
      const outer=polygon?23*81/2*Math.sin(2*Math.PI/23):81*Math.PI;
      near(m.volumeMm3,outer*17-2*Math.sqrt(3)*2.7**2*3.7-Math.PI*1.3**2*(17-3.7));
      const prefix=path.join(dir,(polygon?'polygon':'cylinder')+(sequential?'-sequential':''));
      fs.writeFileSync(prefix+'.step',toStep(model,'polygon-pocket'));
      fs.writeFileSync(prefix+'.brep.json',serializeModel(model));prefixes.push(prefix);
    }
    const run=spawnSync('uv',['run','scripts/validate-step.py',...prefixes],{encoding:'utf8',timeout:120000,maxBuffer:8<<20});
    assert.equal(run.status,0,run.stderr||run.stdout||String(run.error));
    assert.equal(JSON.parse(run.stdout).length,4);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});


test('composed polygon placement retains exact bore geometry through STEP reimport',async()=>{
  const fs=await import('node:fs');const os=await import('node:os');const path=await import('node:path');
  const {spawnSync}=await import('node:child_process');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wonky-placed-polygon-bore-'));
  try {
    const model=await build(source(sketch+`
      skPolyline(s,"outline",{"points":[vector(0,0)*meter,vector(16,0)*meter,vector(16,12)*meter,vector(0,12)*meter,vector(0,0)*meter]});
      skSolve(s);opExtrude(context,id+"e",{"entities":qSketchRegion(id+"s"),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":5*meter});
      fCylinder(context,id+"tool",{"bottomCenter":vector(8,6,-1)*meter,"topCenter":vector(8,6,6)*meter,"radius":1*meter});
      const bodies=qUnion([qCreatedBy(id+"e",EntityType.BODY),qCreatedBy(id+"tool",EntityType.BODY)]);
      opTransform(context,id+"first",{"bodies":bodies,"transform":toWorld(coordSystem(vector(32,8,4)*meter,vector(0,1,0),vector(0,0,-1)))});
      opTransform(context,id+"second",{"bodies":bodies,"transform":toWorld(coordSystem(vector(17,19,23)*meter,vector(0,0,1),vector(0,-1,0)))});
      opBoolean(context,id+"cut",{"targets":qCreatedBy(id+"e",EntityType.BODY),"tools":qCreatedBy(id+"tool",EntityType.BODY),"operationType":BooleanOperationType.SUBTRACTION});`),{feature:'f'});
    assert.equal(model.bodies.length,1);
    const observed=measureRustBody(rustModelKernel(model),model.bodies[0],{probes:[[1000,17000,61000],[7000,17000,61000]]});
    near(observed.volumeMm3,(960-5*Math.PI)*1e9);
    assert.deepEqual(observed.probes.map(p=>p.inside),[false,true]);
    const prefix=path.join(dir,'composed-bore');
    fs.writeFileSync(prefix+'.step',toStep(model,'composed polygon bore'));
    fs.writeFileSync(prefix+'.brep.json',serializeModel(model));
    const checked=spawnSync('uv',['run','scripts/validate-step.py',prefix],{encoding:'utf8',timeout:120000,maxBuffer:8<<20});
    assert.equal(checked.status,0,checked.stderr||String(checked.error));
    assert.equal(JSON.parse(checked.stdout).length,1);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
