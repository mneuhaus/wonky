import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
process.env.WONKY_BACKEND = 'rust';
const {build} = await import('../src/index.mjs');
const {rustMesh, rustStl, rustModelKernel, measureRustBody, rustCarriers} = await import('../src/native/rust-host.mjs');
const {displayMesh} = await import('../src/display-export.mjs');
const {viewerRecord} = await import('../src/viewer/model-record.mjs');
const source = name => fs.readFileSync(new URL(`../fixtures/mesh-general-arcs/${name}.fs`, import.meta.url), 'utf8');
const triples = values => Array.from({length:values.length/3},(_,i)=>values.slice(3*i,3*i+3));
function checkMesh(mesh) {
  mesh = {...mesh, vertices:triples(mesh.vertices), triangles:triples(mesh.triangles)};
  const edges = new Map();
  assert.ok(mesh.triangles.length > 0 && mesh.triangles.length < 20000);
  for (const t of mesh.triangles) {
    const [a,b,c] = t.map(i => mesh.vertices[i]);
    const u = b.map((v,k) => v-a[k]), v = c.map((v,k) => v-a[k]);
    const cross = [u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    assert.ok(Math.hypot(...cross) > 0, `zero-area ${t}`);
    for(let k=0;k<3;k++) {
      const a=t[k], b=t[(k+1)%3], key=[Math.min(a,b),Math.max(a,b)].join(',');
      const e=edges.get(key)??[0,0]; e[0]++; e[1]+=a<b?1:-1; edges.set(key,e);
    }
  }
  for(const e of edges.values()) assert.deepEqual(e,[2,0]);
}
function checkSurfaces(mesh, carriers, deviation) {
  const vertices=triples(mesh.vertices), triangles=triples(mesh.triangles);
  const seen=new Set();
  for(let i=0;i<triangles.length;i++) {
    const surface=carriers.faces[mesh.faces[i]];
    assert.ok(!surface.refused,JSON.stringify(surface));
    const p=triangles[i].map(k=>{seen.add(k);return vertices[k];});
    const samples=[...p,p[0].map((v,k)=>(v+p[1][k]+p[2][k])/3),
      ...p.map((v,j)=>v.map((x,k)=>(x+p[(j+1)%3][k])/2))];
    for(const point of samples) {
      const d=point.map((x,k)=>x-surface.origin[k]);
      const axis=surface.kind==='plane'?surface.normal:surface.axis;
      const n=Math.hypot(...axis), u=axis.map(x=>x/n);
      const axial=d.reduce((sum,x,k)=>sum+x*u[k],0);
      const distance=surface.kind==='plane'?Math.abs(axial):
        Math.abs(Math.hypot(...d.map((x,k)=>x-axial*u[k]))-surface.radiusMm);
      assert.ok(['plane','cylinder'].includes(surface.kind));
      assert.ok(distance<=deviation,`${surface.kind} surface distance ${distance} > ${deviation}`);
    }
  }
  assert.equal(seen.size,vertices.length,'every mesh vertex belongs to checked exact surface');
}
for(let variant=0;variant<4;variant++) test(`general concave wall ${variant}: bounded, oriented watertight mesh and STL`, async()=>{
  const model=await build(source('arc-wall'),{feature:'wall',parameters:{variant:String(variant)}});
  const k=rustModelKernel(model), mesh=rustMesh(k,model.bodies,0.02).bodies[0];
  checkMesh(mesh);
  checkSurfaces(mesh,rustCarriers(k,model.bodies)[0],0.02);
  const probes=measureRustBody(k,model.bodies[0],{probes:triples(mesh.vertices)}).probes;
  assert.equal(probes.length,mesh.vertices.length/3);
  for(const p of probes) { assert.ok(!p.refused,JSON.stringify(p)); assert.ok(p.distanceMm<=0.02); }
  const stl=rustStl(k,model.bodies,0.02);
  assert.match(stl.subarray(0,80).toString(),/tessellated mesh; deviationMm=0.02/);
  assert.equal(stl.readUInt32LE(80),mesh.triangles.length/3);
  assert.throws(()=>rustMesh(k,model.bodies,1e-15),/budget|resource|precision|resolution/);
});
for(const part of ['COUPLER','FIT']) test(`servo ${part}: part STLs and filled viewer face coverage`,async()=>{
  const model=await build(source('servo-slide'),{parameters:{part:`SlidePart.${part}`}});
  const k=rustModelKernel(model), meshes=rustMesh(k,model.bodies,0.02);
  const carriers=rustCarriers(k,model.bodies);
  for(const [i,mesh] of meshes.bodies.entries()) { checkMesh(mesh); checkSurfaces(mesh,carriers[i],0.02); }
  for(const body of model.bodies) assert.ok(rustStl(k,[body],0.02).length>84);
  // FIT intentionally places the bracket and gate in contact. Preserve the
  // existing combined-shell refusal; each exact part remains exportable.
  if(part==='FIT') assert.throws(()=>rustStl(k,model.bodies,0.02),/nonmanifold-vertex/);
  const display=await displayMesh(JSON.stringify(viewerRecord(model)));
  assert.equal(display.manifest.omittedFaces,0);
  for(const face of display.manifest.faces) assert.ok(face.triangleCount>0);
});

test('wonky-view live CLI serves the coupler filled without boundary warnings', {timeout:120000}, async t=>{
  const {spawn} = await import('node:child_process');
  const {mkdtemp, rm} = await import('node:fs/promises');
  const {tmpdir} = await import('node:os');
  const {join} = await import('node:path');
  const scratch = await mkdtemp(join(tmpdir(),'wonky-general-arcs-view-'));
  const child = spawn(process.execPath,['bin/wonky-view.mjs','fixtures/mesh-general-arcs/servo-slide.fs',
    '--param','part=SlidePart.COUPLER','--no-open','--json','--port','0','--reviews',scratch],
    {env:{...process.env,WONKY_BACKEND:'rust'},stdio:['ignore','pipe','pipe']});
  let output='', diagnostics='';
  child.stdout.on('data',chunk=>output+=chunk);
  child.stderr.on('data',chunk=>{diagnostics+=chunk; process.stderr.write(chunk);});
  t.after(async()=>{
    child.kill('SIGTERM');
    await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));
    await rm(scratch,{recursive:true,force:true});
  });
  const deadline=Date.now()+100000;
  while(Date.now()<deadline) {
    assert.equal(child.exitCode,null,diagnostics);
    const origin=diagnostics.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    const events=output.split('\n').filter(Boolean).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
    const failed=events.find(e=>e.event==='build-failed');
    assert.ok(!failed,JSON.stringify(failed));
    const revision=events.find(e=>e.event==='revision');
    if(origin && revision) {
      const response=await fetch(`${origin}/api/models/${revision.modelId}`);
      assert.equal(response.status,200);
      const model=await response.json();
      assert.deepEqual(model.display.notes,[]);
      assert.equal(model.bodies.length,1);
      for(const face of model.bodies[0].faces) assert.ok(face.triangles.length>0);
      return;
    }
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.fail(`viewer did not publish a revision: ${output}\n${diagnostics}`);
});

// The three source points put the exact centre at (1, 1 + 2^-105).
// WC0 rounds it to (1,1); that cache makes the endpoint cross zero.
// This goes through FeatureScript and the public native observation boundary.
const cacheSignSource = `FeatureScript 3000;
import(path : "onshape/std/geometry.fs", version : "3000.0");
annotation { "Feature Type Name" : "Cache sign probe" }
export const probe = defineFeature(function(context is Context, id is Id, definition is map)
precondition {} {
var sk = newSketchOnPlane(context,id+"sk",{"sketchPlane":plane(vector(0,0,0)*meter,vector(0,0,1),vector(1,0,0))});
skArc(sk,"arc",{"start":vector(0,1)*meter,"mid":vector(1.0000000000000002,2)*meter,"end":vector(2,1)*meter});
skLineSegment(sk,"a",{"start":vector(2,1)*meter,"end":vector(1,0)*meter});
skLineSegment(sk,"b",{"start":vector(1,0)*meter,"end":vector(0,1)*meter});
skSolve(sk);
opExtrude(context,id+"ex",{"entities":qSketchRegion(id+"sk"),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":0.01*meter});
});`;
test('source arc with a rounded half-turn cache uses exact-profile sampling', async()=>{
  const model = await build(cacheSignSource, {feature:'probe'});
  const k = rustModelKernel(model);
  const mesh = rustMesh(k, model.bodies, 0.02).bodies[0];
  checkMesh(mesh);
  // The former WC0 sweep route produces 8196 triangles. The shared exact
  // profile sampler has its own certified chord budget, not that half-turn.
  assert.ok(mesh.triangles.length / 3 < 8196);
  const points = triples(mesh.vertices);
  const probes = measureRustBody(k, model.bodies[0], {probes:points}).probes;
  assert.equal(probes.length, points.length);
  for(const p of probes) {
    assert.ok(!p.refused, JSON.stringify(p));
    assert.ok(p.distanceMm + p.boundMm <= 0.02, JSON.stringify(p));
  }
  console.log(JSON.stringify({cacheSignTriangles:mesh.triangles.length/3, probes:probes.length}));
});
