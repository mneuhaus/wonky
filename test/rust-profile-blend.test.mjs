// Public modelling/export boundary for extrusion-generator blends, not cuboids.
// Independent polygon areas and circle sectors expose wrong setbacks, radius,
// carrier choice, missing operation dispatch and source-replay failures.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
process.env.WONKY_BACKEND='rust';
const {build}=await import('../src/index.mjs');
const {toStep,toStl}=await import('../src/exporters.mjs');
const {serializeModel}=await import('../src/construction-history.mjs');
const {measureRustBody,rustModelKernel}=await import('../src/native/rust-host.mjs');
const root=fileURLToPath(new URL('../',import.meta.url));
const source=body=>`FeatureScript 3044; import(path:"onshape/std/geometry.fs",version:"3044.0");
export const f=defineFeature(function(context is Context,id is Id,definition is map) precondition {} {${body}});`;
// Perpendicular 3-4-5 directions, lengths 10 and 5; area 50, height 4.
const prism=`var s=newSketchOnPlane(context,id+"s",{"sketchPlane":plane(vector(0,0,0)*meter,vector(0,0,1),vector(1,0,0))});
const pts=[vector(0,0),vector(6,8),vector(2,11),vector(-4,3)];
for(var k=0;k<4;k+=1)skLineSegment(s,"e"~k,{"start":pts[k]*meter,"end":pts[(k+1)%4]*meter});
skSolve(s);opExtrude(context,id+"post",{"entities":qSketchRegion(id+"s"),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":4*meter});
const edges=qParallelEdges(qOwnedByBody(qCreatedBy(id+"post",EntityType.BODY),EntityType.EDGE),vector(0,0,1));`;
const triangle=prism.replace('[vector(0,0),vector(6,8),vector(2,11),vector(-4,3)]','[vector(0,0),vector(6,0),vector(3,4)]')
  .replace('k<4','k<size(pts)').replace('pts[(k+1)%4]','pts[(k+1)%size(pts)]');
const arcPrism=`var s=newSketchOnPlane(context,id+"s",{"sketchPlane":plane(vector(0,0,0)*meter,vector(0,0,1),vector(1,0,0))});
skLineSegment(s,"a",{"start":vector(0,0)*meter,"end":vector(4,0)*meter});
skLineSegment(s,"b",{"start":vector(4,0)*meter,"end":vector(4,4)*meter});
skLineSegment(s,"c",{"start":vector(4,4)*meter,"end":vector(0,4)*meter});
skArc(s,"d",{"start":vector(0,4)*meter,"mid":vector(-2,2)*meter,"end":vector(0,0)*meter});
skSolve(s);opExtrude(context,id+"post",{"entities":qSketchRegion(id+"s"),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":4*meter});
const allEdges=qOwnedByBody(qCreatedBy(id+"post",EntityType.BODY),EntityType.EDGE);
const edges=qUnion([qClosestTo(allEdges,vector(4,0,2)*meter),qClosestTo(allEdges,vector(4,4,2)*meter)]);`;
const cases=[
  {name:'sloped-rectangle',prism,chamfer:198,fillet:196+Math.PI,cylinders:4,point:'vector(0,0,4)'},
  // Triangle area 12, semiperimeter 8, inradius 3/2. Filleting removes
  // h*r^2*(sum cot(A/2)-pi), with sum cot(A/2)=16/3, not four right angles.
  {name:'rational-triangle',prism:triangle,chamfer:46.72,fillet:128/3+Math.PI,cylinders:3,point:'vector(0,0,4)'},
  // Rectangle plus a semicircle, with only its two sharp line/line joints cut.
  {name:'line-arc-profile',prism:arcPrism,chamfer:63+8*Math.PI,fillet:62+8.5*Math.PI,cylinders:3,point:'vector(4,0,4)',originalCylinders:1},
];
const operation=(fillet,size)=>fillet
  ? `opFillet(context,id+"blend",{"entities":edges,"radius":${size}*meter});`
  : `opChamfer(context,id+"blend",{"entities":edges,"chamferType":ChamferType.EQUAL_OFFSETS,"width":${size}*meter});`;
function near(a,b){assert.ok(Math.abs(a-b)<=Math.abs(b)*1e-11,`${a} != ${b}`);}

test('sloped extrusion side blends retain exact cylinders/planes, volume and valid exports',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wonky-profile-blend-'));
  try {
    const prefixes=[];
    for(const c of cases)for(const fillet of [false,true]) {
      const model=await build(source(c.prism+operation(fillet,0.5)+`
const closest=evaluateQuery(context,qClosestTo(qOwnedByBody(qCreatedBy(id+"post",EntityType.BODY),EntityType.EDGE),${c.point}*meter));
if(size(closest)!=1)throw "blend edges cannot be queried from exact source";`),{feature:'f'});
      assert.equal(model.bodies.length,1);
      const measured=measureRustBody(rustModelKernel(model),model.bodies[0]);
      near(measured.volumeMm3,c[fillet?'fillet':'chamfer']*1e9);
      const step=toStep(model,'profile-blend');
      assert.equal(step.match(/CYLINDRICAL_SURFACE\(/g)?.length??0,fillet?c.cylinders:c.originalCylinders??0);
      assert.ok(toStl(model,{deviationMm:2}).length>84);
      const prefix=path.join(dir,`${c.name}-${fillet?'fillet':'chamfer'}`);
      fs.writeFileSync(prefix+'.step',step);
      fs.writeFileSync(prefix+'.brep.json',serializeModel(model));
      prefixes.push(prefix);
    }
    const result=spawnSync('uv',['run',path.join(root,'scripts/validate-step.py'),...prefixes],{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:8<<20});
    process.stderr.write(result.stderr??'');
    assert.equal(result.status,0,result.stderr||result.stdout||String(result.error));
    assert.equal(JSON.parse(result.stdout).length,cases.length*2);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('side blends refuse whole-face consumption by name rather than omit or overlap patches',async()=>{
  for(const fillet of [false,true]) {
    await assert.rejects(build(source(prism+operation(fillet,3)),{feature:'f'}),
      e=>e.name==='RustCapabilityError'&&e.reason==='profile-blend/adjacent-face-consumed');
  }
});

function arcArea(center,start,end,angle,radius) {
  return (center[0]*(end[1]-start[1])-center[1]*(end[0]-start[0])+radius*radius*angle)/2;
}
const curvedCases=[
  {
    name:'line-circle',radius:2.5,
    sketch:`skArc(s,"a",{"start":vector(-3,4)*meter,"mid":vector(0,-5)*meter,"end":vector(3,4)*meter});skLineSegment(s,"b",{"start":vector(3,4)*meter,"end":vector(-3,4)*meter});`,
    area:arcArea([0,0],[-4,3],[4,3],Math.PI+2*Math.atan(3/4),5)
      +arcArea([2,1.5],[4,3],[2,4],Math.atan(4/3),2.5)
      +8+arcArea([-2,1.5],[-2,4],[-4,3],Math.atan(4/3),2.5),
  },
  {
    name:'circle-circle',radius:1.25,
    sketch:`skArc(s,"a",{"start":vector(0,-4)*meter,"mid":vector(2,0)*meter,"end":vector(0,4)*meter});skArc(s,"b",{"start":vector(0,4)*meter,"mid":vector(-2,0)*meter,"end":vector(0,-4)*meter});`,
    area:2*arcArea([-3,0],[1,-3],[1,3],2*Math.atan(3/4),5)
      +2*arcArea([0,2.25],[1,3],[-1,3],Math.PI-2*Math.atan(3/4),1.25),
  },
];

function curvedSource(shape,radius=shape.radius) {
  return source(`var s=newSketchOnPlane(context,id+"s",{"sketchPlane":plane(vector(0,0,0)*meter,vector(0,0,1),vector(1,0,0))});${shape.sketch}
skSolve(s);opExtrude(context,id+"post",{"entities":qSketchRegion(id+"s"),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":4*meter});
const edges=qParallelEdges(qOwnedByBody(qCreatedBy(id+"post",EntityType.BODY),EntityType.EDGE),vector(0,0,1));${operation(true,radius)}`);
}

test('curved generators use exact rolling-ball contact on lines and circles',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wonky-curved-generator-'));
  try {
    const prefixes=[];
    for(const shape of curvedCases) {
      const model=await build(curvedSource(shape),{feature:'f'});
      const measured=measureRustBody(rustModelKernel(model),model.bodies[0]);
      near(measured.volumeMm3,shape.area*4e9);
      assert.ok(Math.abs(measured.centroidMm[0])<1e-8);
      near(measured.centroidMm[2],2000);
      const step=toStep(model);
      assert.equal(step.match(/CYLINDRICAL_SURFACE\(/g)?.length,shape.name==='line-circle'?3:4);
      assert.ok(toStl(model,{deviationMm:2}).length>84);
      const prefix=path.join(dir,shape.name);
      fs.writeFileSync(prefix+'.step',step);
      fs.writeFileSync(prefix+'.brep.json',serializeModel(model));
      prefixes.push(prefix);
    }
    const checked=spawnSync('uv',['run',path.join(root,'scripts/validate-step.py'),...prefixes],{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:8<<20});
    process.stderr.write(checked.stderr??'');
    assert.equal(checked.status,0,checked.stdout+checked.stderr);
    assert.equal(JSON.parse(checked.stdout).length,2);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('curved generators keep exact-storage refusals visible inside try silent',async()=>{
  // Quadratic offset intersections are stored exactly; the rational-only
  // blend contact consumer must propagate its refusal through try silent.
  const src=curvedSource(curvedCases[0],0.5);
  const silent=src.replace(operation(true,0.5),`try silent { ${operation(true,0.5)} }`);
  for(const text of [src,silent])await assert.rejects(build(text,{feature:'f'}),
    error=>error.name==='RustCapabilityError'&&error.reason==='curve2/crossing-needs-algebraic-vertex');
  await assert.rejects(build(curvedSource(curvedCases[0],5),{feature:'f'}),
    error=>error.name==='RustCapabilityError'&&error.reason==='profile-blend/offset-curvature-consumed');
});

// EQUAL_OFFSETS measures each new edge's distance from the original generator.
// Circle chord geometry supplies a second route independent of kernel contacts.
test('curved EQUAL_OFFSETS preserves quadratic setbacks, planar chamfers and STEP topology',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wonky-curved-chamfer-'));
  try {
    const prefixes=[];
    for(const shape of curvedCases)for(const width of [0.5,shape.radius]) {
      const text=curvedSource(shape,width).replace(operation(true,width),operation(false,width));
      const model=await build(text,{feature:'f'});
      assert.equal(model.bodies.length,1);
      const cos=1-width*width/50;
      const sin=(width/5)*Math.sqrt(1-width*width/100);
      const x=3*cos+4*sin,y=4*cos-3*sin,b=3-width;
      const lensX=x-3;
      const area=shape.name==='line-circle'
        ?12.5*(Math.PI+2*Math.atan2(y,x))+4*x-y*b+4*b
        :50*Math.atan2(y,x)-6*y+2*lensX*y;
      const measured=measureRustBody(rustModelKernel(model),model.bodies[0]);
      near(measured.volumeMm3,4e9*area);
      assert.ok(Math.abs(measured.centroidMm[0])<1e-8);
      near(measured.centroidMm[2],2000);
      const step=toStep(model);
      assert.equal(step.match(/CYLINDRICAL_SURFACE\(/g)?.length,shape.name==='line-circle'?1:2);
      assert.equal(step.match(/PLANE\(/g)?.length,shape.name==='line-circle'?5:4);
      assert.ok(toStl(model,{deviationMm:2}).length>84);
      const prefix=path.join(dir,`${shape.name}-width-${width}`);
      fs.writeFileSync(prefix+'.step',step);
      fs.writeFileSync(prefix+'.brep.json',serializeModel(model));
      prefixes.push(prefix);
    }
    const checked=spawnSync('uv',['run',path.join(root,'scripts/validate-step.py'),...prefixes],{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:8<<20});
    process.stderr.write(checked.stderr??'');
    assert.equal(checked.status,0,checked.stdout+checked.stderr);
    assert.equal(JSON.parse(checked.stdout).length,4);
    // Both setbacks on the straight side meet at its midpoint at width 3.
    const consumed=curvedSource(curvedCases[0],3).replace(operation(true,3),operation(false,3));
    await assert.rejects(build(consumed,{feature:'f'}),
      e=>e.name==='RustCapabilityError'&&e.reason==='profile-blend/adjacent-face-consumed');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
