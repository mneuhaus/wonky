// Unmodified FeatureScript through native Model replay. The trapezoid's distant
// sloping wall defeats the orthogonal family; the selected supports remain
// orthogonal, so its exact chamfer boundary is rational.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
process.env.WONKY_BACKEND = 'rust';
const {build} = await import('../src/index.mjs');
const {toStep,toStl} = await import('../src/exporters.mjs');
const {serializeModel} = await import('../src/construction-history.mjs');
const {measureRustBody,rustModelKernel} = await import('../src/native/rust-host.mjs');
const source = extra => `FeatureScript 3083;
import(path : "onshape/std/geometry.fs", version : "3083.0");
export const f = defineFeature(function(context is Context, id is Id, definition is map) precondition {} {
 var s = newSketchOnPlane(context, id+"s", {"sketchPlane":plane(vector(0,0,0)*millimeter,vector(0,0,1),vector(1,0,0))});
 skPolyline(s,"outline",{"points":[vector(0,0)*millimeter,vector(20,0)*millimeter,vector(15,20)*millimeter,vector(0,20)*millimeter,vector(0,0)*millimeter]});
 skSolve(s);
 opExtrude(context,id+"x",{"entities":qSketchRegion(id+"s"),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":20*millimeter});
 const inputBody = qCreatedBy(id+"x",EntityType.BODY);
 fCuboid(context,id+"inside",{"corner1":vector(2,2,2)*millimeter,"corner2":vector(4,4,4)*millimeter});
 opBoolean(context,id+"union",{"tools":qUnion([inputBody,qCreatedBy(id+"inside",EntityType.BODY)]),"operationType":BooleanOperationType.UNION});
 const body = inputBody;
 const edge = qClosestTo(qOwnedByBody(body,EntityType.EDGE),vector(0,0,10)*millimeter);
 opChamfer(context,id+"ch",{"entities":edge,"chamferType":ChamferType.EQUAL_OFFSETS,"width":1*millimeter});
 ${extra}
});`;
test('nonorthogonal planar input routes to an authenticated Model chamfer and exports',async()=>{
 const m=await build(source('if(size(evaluateQuery(context,qOwnedByBody(body,EntityType.FACE)))!=7)throw "missing chamfer";'),{feature:'f'});
 assert.equal(m.bodies.length,1);
 const measure=measureRustBody(rustModelKernel(m),m.bodies[0]);
 assert.equal(measure.topology.faces,7);
 assert.ok(Math.abs(measure.volumeMm3-6990)<1e-9,`volume ${measure.volumeMm3}`);
 const step=await toStep(m);assert.match(step,/MANIFOLD_SOLID_BREP/);
 const mesh=await toStl(m);assert.ok(mesh.length>0);
 const root=fileURLToPath(new URL('../',import.meta.url));
 const dir=fs.mkdtempSync(path.join(root,'tmp/f1a-step-'));
 try {
   const prefix=path.join(dir,'planar-model-chamfer');
   fs.writeFileSync(prefix+'.step',step);fs.writeFileSync(prefix+'.brep.json',serializeModel(m));
   const result=spawnSync('uv',['run','scripts/validate-step.py',prefix],{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});
   if(result.stderr)process.stderr.write(result.stderr);
   assert.equal(result.status,0,result.stderr||String(result.error));
   const rows=JSON.parse(result.stdout);assert.equal(rows.length,1);assert.equal(rows[0].valid,true);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('Model replay retains a second chamfer with radical carriers',async()=>{
 const m=await build(source(`
 const next=qClosestTo(qOwnedByBody(body,EntityType.EDGE),vector(1,0,10)*millimeter);
 opChamfer(context,id+"second",{"entities":next,"chamferType":ChamferType.EQUAL_OFFSETS,"width":0.1*millimeter});
 `),{feature:'f'});
 const measure=measureRustBody(rustModelKernel(m),m.bodies[0]);
 assert.equal(measure.topology.faces,8);
 assert.ok(Math.abs(measure.volumeMm3-(6990-Math.sqrt(2)/20))<1e-8,`volume ${measure.volumeMm3}`);
 assert.match(await toStep(m),/MANIFOLD_SOLID_BREP/);
 assert.ok((await toStl(m)).length>0);
});

async function checkPlanar(input,volume,faces,label) {
 const m=await build(input,{feature:'f'});
 assert.equal(m.bodies.length,1);
 const measure=measureRustBody(rustModelKernel(m),m.bodies[0]);
 assert.equal(measure.topology.faces,faces);
 assert.ok(Math.abs(measure.volumeMm3-volume)<1e-8,`${label} volume ${measure.volumeMm3}`);
 assert.equal(measure.validity.brep,true);
 assert.ok((await toStl(m)).length>0);
 const root=fileURLToPath(new URL('../',import.meta.url));
 const dir=fs.mkdtempSync(path.join(root,'tmp/f1a-fix1-step-'));
 try {
   const prefix=path.join(dir,label);
   fs.writeFileSync(prefix+'.step',await toStep(m));fs.writeFileSync(prefix+'.brep.json',serializeModel(m));
   const result=spawnSync('uv',['run','scripts/validate-step.py',prefix],{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});
   if(result.stderr)process.stderr.write(result.stderr);
   assert.equal(result.status,0,result.stderr||String(result.error));
   const rows=JSON.parse(result.stdout);assert.equal(rows.length,1);assert.equal(rows[0].valid,true);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
 return m;
}
function withPolygon(points,edge) {
 return source('').replace(/"points":\[[^;]+?\]\}/,`"points":[${points.map(p=>`vector(${p.join(',')})*millimeter`).join(',')}]}`)
  .replace('vector(0,0,10)*millimeter',`vector(${edge.join(',')})*millimeter`);
}
test('FP15 exact radical boundary is a replay-authenticated public Model with valid STEP',async()=>{
 const h=5*Math.sqrt(3);
 const input=withPolygon([[10,0],[5,h],[-5,h],[-10,0],[-5,-h],[5,-h],[10,0]],[10,0,10]);
 await checkPlanar(input,5187.4921686687885,9,'fp15-model');
 // Plain extrusion also reaches the general exact mechanism.
 const plain=input.replace(/ fCuboid\(context,id\+"inside"[\s\S]*? const body = inputBody;/,' const body = inputBody;');
 await checkPlanar(plain,5187.4921686687885,9,'fp15-plain');
});
test('public concave planar attachment fills a re-entrant edge exactly',async()=>{
 const input=withPolygon([[0,0],[20,0],[20,10],[10,10],[10,20],[0,20],[0,0]],[10,10,10]);
 await checkPlanar(input,6010,9,'concave-model');
});
test('public tangent propagation expands an exact collinear edge chain',async()=>{
 // The redundant collinear sketch vertex produces two bottom line edges on
 // separately owned coplanar wall faces. Selection starts on one of them.
 let input=withPolygon([[0,0],[20,0],[20,10],[20,20],[0,20],[0,0]],[20,5,0]);
 input=input.replace(/ fCuboid\(context,id\+"inside"[\s\S]*? const body = inputBody;/,' const body = inputBody;');
 input=input.replace('"width":1*millimeter','"width":1*millimeter,"tangentPropagation":true');
 await checkPlanar(input,7990,8,'propagated-model');
});

test('unprobed TWO_OFFSETS refuses its real std width1/width2 definition inside try silent',async()=>{
 const input=source('').replace('"chamferType":ChamferType.EQUAL_OFFSETS,"width":1*millimeter','"chamferType":ChamferType.TWO_OFFSETS,"width1":1*millimeter,"width2":2*millimeter,"oppositeDirection":false');
 const silent=input.replace(' opChamfer(context,id+"ch",',' try silent { opChamfer(context,id+"ch",').replace('\n \n});','\n }\n});');
 await assert.rejects(build(silent,{feature:'f'}),error=>error.reason==='chamfer/two-offsets-side-order-unprobed');
});
