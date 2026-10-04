import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
process.env.WONKY_BACKEND='rust';
const {build}=await import('../src/index.mjs');
const {toStep,toStl}=await import('../src/exporters.mjs');
const {serializeModel}=await import('../src/construction-history.mjs');
const {measureRustBody,rustModelKernel}=await import('../src/native/rust-host.mjs');
const profile=`function profile(s,scale) {
const p=[vector(0,-5),vector(10,-5),vector(15,0),vector(15,2),vector(10,7),vector(0,7),vector(-5,2),vector(-5,0)];
const m=[vector(13,-4),vector(14,5),vector(-3,6),vector(-4,-3)];
for(var k=0;k<8;k+=1) {
if(k%2==0)skLineSegment(s,"l"~k,{"start":(p[k]*scale+vector(5,1)*(1-scale))*meter,"end":(p[(k+1)%8]*scale+vector(5,1)*(1-scale))*meter});
else skArc(s,"a"~k,{"start":(p[k]*scale+vector(5,1)*(1-scale))*meter,"mid":(m[(k-1)/2]*scale+vector(5,1)*(1-scale))*meter,"end":(p[(k+1)%8]*scale+vector(5,1)*(1-scale))*meter});
} }
`;
const source=(blend,top=false,hole=false,both=false)=>`FeatureScript 3044;import(path:"onshape/std/geometry.fs",version:"3044.0");${profile}
export const f=defineFeature(function(context is Context,id is Id,definition is map) precondition{} {
var s=newSketchOnPlane(context,id+"s",{"sketchPlane":plane(vector(0,0,0)*meter,vector(0,0,1),vector(1,0,0))});profile(s,1);skSolve(s);
opExtrude(context,id+"outer",{"entities":qSketchRegion(id+"s"),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":8*meter});
var t=newSketchOnPlane(context,id+"t",{"sketchPlane":plane(vector(0,0,2)*meter,vector(0,0,1),vector(1,0,0))});profile(t,0.5);skSolve(t);
opExtrude(context,id+"pocket",{"entities":qSketchRegion(id+"t"),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":8*meter});
opBoolean(context,id+"open",{"targets":qCreatedBy(id+"outer",EntityType.BODY),"tools":qCreatedBy(id+"pocket",EntityType.BODY),"operationType":BooleanOperationType.SUBTRACTION});
const edges=qOwnedByBody(qCreatedBy(id+"outer",EntityType.BODY),EntityType.EDGE);
var rim=[];for(var p in [[5,-5],[13,-4],[15,1],[14,5],[5,7],[-3,6],[-5,1],[-4,-3]])rim=append(rim,qClosestTo(edges,vector(${hole?'p[0]*0.5+2.5,p[1]*0.5+0.5':'p[0],p[1]'},${top?8:0})*meter));
${both?'var inner=[];for(var p in [[5,-5],[13,-4],[15,1],[14,5],[5,7],[-3,6],[-5,1],[-4,-3]])inner=append(inner,qClosestTo(edges,vector(p[0]*0.5+2.5,p[1]*0.5+0.5,8)*meter));for(var e in inner)rim=append(rim,e);':''}
${blend}
});`;
const blend=(fillet,r)=>fillet?`opFillet(context,id+"blend",{"entities":qUnion(rim),"radius":${r}*meter});`:`opChamfer(context,id+"blend",{"entities":qUnion(rim),"chamferType":ChamferType.EQUAL_OFFSETS,"width":${r}*meter});`;
function closedStl(stl){const d=new DataView(stl.buffer,stl.byteOffset,stl.byteLength),edges=new Map();let vol=0;for(let f=0;f<d.getUint32(80,true);f++) {const p=[0,1,2].map(j=>[0,1,2].map(k=>d.getFloat32(84+50*f+12+12*j+4*k,true)));vol+=(p[0][0]*(p[1][1]*p[2][2]-p[1][2]*p[2][1])+p[0][1]*(p[1][2]*p[2][0]-p[1][0]*p[2][2])+p[0][2]*(p[1][0]*p[2][1]-p[1][1]*p[2][0]))/6;const keys=p.map(v=>JSON.stringify(v));assert.equal(new Set(keys).size,3);for(let j=0;j<3;j++){const a=keys[j],b=keys[(j+1)%3],f=a<b,k=f?`${a}|${b}`:`${b}|${a}`,e=edges.get(k)??{n:0,s:0};e.n++;e.s+=f?1:-1;edges.set(k,e);}}for(const e of edges.values()){assert.equal(e.n,2);assert.equal(e.s,0);}return vol;}
test('stack cap bands retain the pocket and sew analytic outer rims above and below',async()=>{
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wonky-stack-blend-'));
try{for(const fillet of [false,true])for(const top of [false,true])for(const hole of top?[false,true]:[false]){
const model=await build(source(blend(fillet,0.5),top,hole),{feature:'f'}),m=measureRustBody(rustModelKernel(model),model.bodies[0]);
const A=140+25*Math.PI,P=24+10*Math.PI,r=0.5;
const perimeter=hole?P/2:P,sign=hole?1:-1;
const removed=fillet?perimeter*r*r*(1-Math.PI/4)+sign*Math.PI*r*r*r*(5/3-Math.PI/2):perimeter*r*r/2+sign*Math.PI*r*r*r/3;
const expected=(A*8-A*0.25*6-removed)*1e9;
assert.ok(Math.abs(m.volumeMm3-expected)<expected*1e-12,`${m.volumeMm3} != ${expected}`);
const zc=top?7.5:0.5,K1=fillet?r**3/6:r**3/3,K2=fillet?r**4/12:r**4/4;
const zmRemoved=zc*removed+(top?1:-1)*(perimeter*K1+sign*Math.PI*K2);
const expectedZ=(A*8*4-A*0.25*6*5-zmRemoved)/(expected/1e9)*1000;
assert.ok(Math.abs(m.centroidMm[2]-expectedZ)<1e-8);
assert.ok(Math.abs(m.centroidMm[0]-5000)<1e-8);assert.ok(Math.abs(m.centroidMm[1]-1000)<1e-8);
const prefix=path.join(dir,`${fillet?'fillet':'chamfer'}-${top?'top':'bottom'}-${hole?'inner':'outer'}`);
fs.writeFileSync(prefix+'.step',toStep(model));fs.writeFileSync(prefix+'.brep.json',serializeModel(model));
const result=spawnSync('uv',['run','scripts/validate-step.py',prefix],{encoding:'utf8',maxBuffer:4<<20});process.stderr.write(result.stderr);assert.equal(result.status,0,result.stdout+result.stderr);
const v=closedStl(toStl(model,{deviationMm:25}));assert.ok(Math.abs(v-expected)<expected*0.008,`${v} != ${expected}`);
}}
finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('stack cap bands refuse face consumption and binary64-inexact torus radii',async()=>{
for(const [fillet,r,reason] of [[false,8,'stack-blend/adjacent-face-consumed'],[true,8,'stack-blend/adjacent-face-consumed'],[true,0.1,'fillet/rim-torus-radius-not-binary64']])await assert.rejects(build(source(blend(fillet,r)),{feature:'f'}),e=>e.name==='RustCapabilityError'&&e.reason===reason);
});

test('one operation fillets both outer and inner top loops of a pocketed stack',async()=>{
const model=await build(source(blend(true,0.5),true,false,true),{feature:'f'}),m=measureRustBody(rustModelKernel(model),model.bodies[0]);
const A=140+25*Math.PI,P=24+10*Math.PI,r=0.5;
const expected=(A*8-A*0.25*6-1.5*P*r*r*(1-Math.PI/4))*1e9;
assert.ok(Math.abs(m.volumeMm3-expected)<expected*1e-12);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wonky-both-rims-'));try{
const prefix=path.join(dir,'both');fs.writeFileSync(prefix+'.step',toStep(model));fs.writeFileSync(prefix+'.brep.json',serializeModel(model));
const result=spawnSync('uv',['run','scripts/validate-step.py',prefix],{encoding:'utf8',maxBuffer:4<<20});process.stderr.write(result.stderr);assert.equal(result.status,0,result.stdout+result.stderr);
const v=closedStl(toStl(model,{deviationMm:25}));assert.ok(Math.abs(v-expected)<expected*0.008);
}finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('frozen tea-box source preserves an explicit exact-radius refusal, including try silent',async()=>{
const rr=fs.readFileSync(new URL('../fixtures/blend-extrusions/rr.fs',import.meta.url),'utf8');
const rrc=fs.readFileSync(new URL('../fixtures/blend-extrusions/rrc.fs',import.meta.url),'utf8');
const model=await build(rr,{feature:'teaBoxRounded'});
assert.ok(measureRustBody(rustModelKernel(model),model.bodies[0]).volumeMm3>0);
for(const source of [rrc,rrc.replace(/        (opChamfer\(context, id \+ "foot",[^\n]+);/, '        try silent { $1; }')])await assert.rejects(build(source,{feature:'teaBoxRounded'}),e=>e.name==='RustCapabilityError'&&e.reason==='fillet/rim-radius-not-representable');
});

test('combined cap offsets refuse a collectively consumed wall',async()=>{
await assert.rejects(build(source(blend(true,2),true,false,true),{feature:'f'}),e=>e.name==='RustCapabilityError'&&['stack-blend/bands-collide','stack-blend/bands-consume-cap','stack-blend/adjacent-cap-consumed','stack-blend/offset-boundary-collision'].includes(e.reason));
});

test('a concave pocket-floor dihedral adds material and sews valid analytic surfaces',async()=>{
for(const fillet of [true,false]) {
const src=source(blend(fillet,0.5),true,true).replace('p[1]*0.5+0.5,8','p[1]*0.5+0.5,2');
const model=await build(src,{feature:'f'}),m=measureRustBody(rustModelKernel(model),model.bodies[0]);
const A=140+25*Math.PI,P=(24+10*Math.PI)/2,r=0.5;
const added=fillet?P*r*r*(1-Math.PI/4)-Math.PI*r*r*r*(5/3-Math.PI/2):P*r*r/2-Math.PI*r*r*r/3;
const expected=(A*8-A*0.25*6+added)*1e9;
assert.ok(Math.abs(m.volumeMm3-expected)<expected*1e-12,`${m.volumeMm3} != ${expected}`);
const K1=fillet?r**3/6:r**3/3,K2=fillet?r**4/12:r**4/4;
const addedMoment=2.5*added-(P*K1-Math.PI*K2);
const expectedZ=(A*8*4-A*0.25*6*5+addedMoment)/(expected/1e9)*1000;
assert.ok(Math.abs(m.centroidMm[2]-expectedZ)<1e-8,`${m.centroidMm[2]} != ${expectedZ}`);
assert.ok(Math.abs(m.centroidMm[0]-5000)<1e-8);assert.ok(Math.abs(m.centroidMm[1]-1000)<1e-8);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wonky-floor-blend-'));try {
const prefix=path.join(dir,'floor');fs.writeFileSync(prefix+'.step',toStep(model));fs.writeFileSync(prefix+'.brep.json',serializeModel(model));
const result=spawnSync('uv',['run','scripts/validate-step.py',prefix],{encoding:'utf8',maxBuffer:4<<20});process.stderr.write(result.stderr);assert.equal(result.status,0,result.stdout+result.stderr);
const v=closedStl(toStl(model,{deviationMm:25}));assert.ok(Math.abs(v-expected)<expected*0.008);
}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
});

// The square pocket has four concave material corners; the outer boundary
// remains a line/arc profile. Its blind lower endpoints test cap sewing.
test('stack vertical-edge blends rebuild exact slab boundaries at blind endpoints',async()=>{
const declarations=source('',true).replace('profile(t,0.5);',`const points=[vector(2,-1),vector(8,-1),vector(8,3),vector(2,3)];for(var k=0;k<4;k+=1)skLineSegment(t,"e"~k,{"start":points[k]*meter,"end":points[(k+1)%4]*meter});`);
for(const fillet of [true,false]) {
const operation=fillet?'opFillet(context,id+"vertical",{"entities":vertical,"radius":0.5*meter});':'opChamfer(context,id+"vertical",{"entities":vertical,"chamferType":ChamferType.EQUAL_OFFSETS,"width":0.5*meter});';
const src=declarations.replace('var rim=[];',`const vertical=qUnion([qClosestTo(edges,vector(2,-1,5)*meter),qClosestTo(edges,vector(8,-1,5)*meter),qClosestTo(edges,vector(8,3,5)*meter),qClosestTo(edges,vector(2,3,5)*meter)]);${operation}var rim=[];`);
const model=await build(src,{feature:'f'}),m=measureRustBody(rustModelKernel(model),model.bodies[0]);
const expected=((140+25*Math.PI)*8-24*6+(fillet?1-Math.PI/4:0.5)*6)*1e9;
assert.ok(Math.abs(m.volumeMm3-expected)<expected*1e-12,`${m.volumeMm3} != ${expected}`);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wonky-vertical-blend-'));try {
const prefix=path.join(dir,'vertical');fs.writeFileSync(prefix+'.step',toStep(model));fs.writeFileSync(prefix+'.brep.json',serializeModel(model));
const result=spawnSync('uv',['run','scripts/validate-step.py',prefix],{encoding:'utf8',maxBuffer:4<<20});process.stderr.write(result.stderr);assert.equal(result.status,0,result.stdout+result.stderr);
assert.ok(toStl(model,{deviationMm:25}).length>84);
}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
});

test('stack exterior generators span internal levels without losing the pocket',async()=>{
const outer=`skLineSegment(s,"a",{"start":vector(0,0)*meter,"end":vector(4,0)*meter});skLineSegment(s,"b",{"start":vector(4,0)*meter,"end":vector(4,4)*meter});skLineSegment(s,"c",{"start":vector(4,4)*meter,"end":vector(0,4)*meter});skArc(s,"d",{"start":vector(0,4)*meter,"mid":vector(-2,2)*meter,"end":vector(0,0)*meter});`;
const pocket=`const points=[vector(1,1),vector(3,1),vector(3,3),vector(1,3)];for(var k=0;k<4;k+=1)skLineSegment(t,"e"~k,{"start":points[k]*meter,"end":points[(k+1)%4]*meter});`;
for(const fillet of [true,false]) {
const operation=fillet?'opFillet(context,id+"vertical",{"entities":vertical,"radius":0.5*meter});':'opChamfer(context,id+"vertical",{"entities":vertical,"chamferType":ChamferType.EQUAL_OFFSETS,"width":0.5*meter});';
const src=source('',true).replace('profile(s,1);',outer).replace('profile(t,0.5);',pocket).replaceAll('endDepth":8*meter','endDepth":4*meter').replace('var rim=[];',`const vertical=qUnion([qClosestTo(edges,vector(4,0,2)*meter),qClosestTo(edges,vector(4,4,2)*meter)]);${operation}var rim=[];`);
const model=await build(src,{feature:'f'}),m=measureRustBody(rustModelKernel(model),model.bodies[0]);
const expected=((16+2*Math.PI)*4-4*2-2*4*0.25*(fillet?1-Math.PI/4:0.5))*1e9;
assert.ok(Math.abs(m.volumeMm3-expected)<expected*1e-12,`${m.volumeMm3} != ${expected}`);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wonky-exterior-generator-'));try {
const prefix=path.join(dir,'outer');fs.writeFileSync(prefix+'.step',toStep(model));fs.writeFileSync(prefix+'.brep.json',serializeModel(model));
const result=spawnSync('uv',['run','scripts/validate-step.py',prefix],{encoding:'utf8',maxBuffer:4<<20});process.stderr.write(result.stderr);assert.equal(result.status,0,result.stdout+result.stderr);
const v=closedStl(toStl(model,{deviationMm:10}));assert.ok(Math.abs(v-expected)<expected*0.008);
}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
});

test('blind-pocket curved generators share the exact rolling-ball construction',async()=>{
const sketch=`skArc(t,"arc",{"start":vector(3.5,3)*meter,"mid":vector(5,-1.5)*meter,"end":vector(6.5,3)*meter});skLineSegment(t,"line",{"start":vector(6.5,3)*meter,"end":vector(3.5,3)*meter});`;
const src=source('',true).replace('profile(t,0.5);',sketch).replace('var rim=[];',`const vertical=qUnion([qClosestTo(edges,vector(3.5,3,5)*meter),qClosestTo(edges,vector(6.5,3,5)*meter)]);opFillet(context,id+"vertical",{"entities":vertical,"radius":1.25*meter});var rim=[];`);
const model=await build(src,{feature:'f'}),measured=measureRustBody(rustModelKernel(model),model.bodies[0]);
const pocketArea=(25*(Math.PI+2*Math.atan(3/4))/2+6.25*Math.atan(4/3)+13)/4;
const expected=((140+25*Math.PI)*8-pocketArea*6)*1e9;
assert.ok(Math.abs(measured.volumeMm3-expected)<expected*1e-12,`${measured.volumeMm3} != ${expected}`);
assert.ok(Math.abs(measured.centroidMm[0]-5000)<1e-8);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wonky-curved-pocket-'));try {
const prefix=path.join(dir,'curved-pocket');fs.writeFileSync(prefix+'.step',toStep(model));fs.writeFileSync(prefix+'.brep.json',serializeModel(model));
const result=spawnSync('uv',['run','scripts/validate-step.py',prefix],{encoding:'utf8',maxBuffer:4<<20});process.stderr.write(result.stderr);assert.equal(result.status,0,result.stdout+result.stderr);
assert.equal(JSON.parse(result.stdout)[0].surfaceTypes.Cylinder,7);
const volume=closedStl(toStl(model,{deviationMm:2}));assert.ok(Math.abs(volume-expected)<expected*0.008);
}finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('non-tangent polygon pocket-floor chamfers sew exact mitres and integrate the whole band',async()=>{
const src=fs.readFileSync(new URL('../fixtures/blend-extrusions-2/mitred-pocket.fs',import.meta.url),'utf8');
const resized=width=>src.replace('"width":0.5*meter',`"width":${width}*meter`);
const model=await build(src,{feature:'f'}),m=measureRustBody(rustModelKernel(model),model.bodies[0]);
// Second route: integrate four triangular strips, subtract their four corner
// overlaps. At height u above the floor: 20*(r-u)-4*(r-u)^2.
const A=140+25*Math.PI,r=0.5,added=20*r*r/2-4*r**3/3;
const expected=(A*8-24*6+added)*1e9;
assert.ok(Math.abs(m.volumeMm3-expected)<expected*1e-12,`${m.volumeMm3} != ${expected}`);
const areas=m.faceAreasMm2.slice(-4).sort((a,b)=>a-b);
const perimeters=m.facePerimetersMm.slice(-4).sort((a,b)=>a-b);
for(const [k,length] of [3.5,3.5,5.5,5.5].entries())assert.ok(Math.abs(areas[k]-length*r*Math.sqrt(2)*1e6)<1e-6);
for(const [k,length] of [7,7,11,11].entries())assert.ok(Math.abs(perimeters[k]-(length+Math.sqrt(3))*1000)<1e-8);
const addedMoment=2*added+20*r**3/6-4*r**4/12;
const expectedZ=(A*8*4-24*6*5+addedMoment)/(expected/1e9)*1000;
assert.ok(Math.abs(m.centroidMm[2]-expectedZ)<1e-8,`${m.centroidMm[2]} != ${expectedZ}`);
assert.ok(Math.abs(m.centroidMm[0]-5000)<1e-8);assert.ok(Math.abs(m.centroidMm[1]-1000)<1e-8);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wonky-mitred-floor-'));try {
const prefix=path.join(dir,'floor');fs.writeFileSync(prefix+'.step',toStep(model));fs.writeFileSync(prefix+'.brep.json',serializeModel(model));
const result=spawnSync('uv',['run','scripts/validate-step.py',prefix],{encoding:'utf8',maxBuffer:4<<20});process.stderr.write(result.stderr);assert.equal(result.status,0,result.stdout+result.stderr);
const volume=closedStl(toStl(model,{deviationMm:2}));assert.ok(Math.abs(volume-expected)<expected*0.008);
}finally{fs.rmSync(dir,{recursive:true,force:true});}
for(const width of [2,3])await assert.rejects(build(resized(width),{feature:'f'}),
e=>e.name==='RustCapabilityError'&&e.reason==='fillet/rim-offset-curvature');
});

test('the currently requested tea-box source is frozen separately and keeps exact-radius refusals visible',async()=>{
const src=fs.readFileSync(new URL('../fixtures/blend-extrusions-2/rrc.fs',import.meta.url),'utf8');
const silent=src.replace(/        (opChamfer\(context, id \+ "foot",[^\n]+);/,'        try silent { $1; }');
assert.notEqual(silent,src);
for(const input of [src,silent])await assert.rejects(build(input,{feature:'teaBoxRounded'}),
e=>e.name==='RustCapabilityError'&&e.reason==='fillet/rim-radius-not-representable');
});


test('polygon floor fillets share exact ellipse joints, analytic integrals and watertight exports', async()=>{
const original=fs.readFileSync(new URL('../fixtures/blend-extrusions-2/mitred-pocket.fs',import.meta.url),'utf8');
for(const r of [0.25,0.5,0.75]) {
const src=original.replace('opChamfer(context,id+"floor",{"entities":qUnion(floor),"chamferType":ChamferType.EQUAL_OFFSETS,"width":0.5*meter})',`opFillet(context,id+"floor",{"entities":qUnion(floor),"radius":${r}*meter})`);
assert.notEqual(src,original);
const model=await build(src,{feature:'f'}),m=measureRustBody(rustModelKernel(model),model.bodies[0]);
// Independent strips minus four corner overlaps, integrated from the floor.
const added=20*r*r*(1-Math.PI/4)-4*r**3*(5/3-Math.PI/2);
const expected=((140+25*Math.PI)*8-24*6+added)*1e9;
assert.ok(Math.abs(m.volumeMm3-expected)<expected*1e-12,`${m.volumeMm3} != ${expected}`);
const addedMoment=(2+r)*added-(20*r**3/6-4*r**4/12);
const expectedZ=((140+25*Math.PI)*8*4-24*6*5+addedMoment)/(expected/1e9)*1000;
assert.ok(Math.abs(m.centroidMm[2]-expectedZ)<1e-8,`${m.centroidMm[2]} != ${expectedZ}`);
assert.ok(Math.abs(m.centroidMm[0]-5000)<1e-8);assert.ok(Math.abs(m.centroidMm[1]-1000)<1e-8);
const areas=m.faceAreasMm2.slice(-4).sort((a,b)=>a-b);
for(const [k,length] of [4,4,6,6].entries()) {
const expectedArea=r*((length-2*r)*Math.PI/2+2*r)*1e6;
assert.ok(Math.abs(areas[k]-expectedArea)<1e-6,`${areas[k]} != ${expectedArea}`);
}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wonky-floor-ellipses-'));try {
const prefix=path.join(dir,'floor');fs.writeFileSync(prefix+'.step',toStep(model));fs.writeFileSync(prefix+'.brep.json',serializeModel(model));
const result=spawnSync('uv',['run','scripts/validate-step.py',prefix],{encoding:'utf8',maxBuffer:4<<20});process.stderr.write(result.stderr);assert.equal(result.status,0,result.stdout+result.stderr);
const validation=JSON.parse(result.stdout)[0];assert.equal(validation.surfaceTypes.Cylinder,8);assert.equal(validation.valid,true);
const meshVolume=closedStl(toStl(model,{deviationMm:2}));assert.ok(Math.abs(meshVolume-expected)<expected*0.008,`${meshVolume} != ${expected}`);
}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
});
