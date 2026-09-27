import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend() || missing("fixtures/r10b/modules.json", "fixtures/r10b/modules/base/Z2qDD.body.json", "fixtures/r10b/modules/base/Z76DD.body.json", "fixtures/r10b/r10b.fs");
if (publicTreeSkip) {
  test("analytic.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { readFileSync } = await import("node:fs");
const { fileURLToPath } = await import("node:url");
const { createHash } = await import("node:crypto");
const { dirname, join } = await import("node:path");
const { build } = await import("../src/index.mjs");
const { loadKernel } = await import("../src/kernel.mjs");
const { importOnshapeBody, validateAnalytic, transformAnalytic } = await import("../src/analytic.mjs");
const { toStep, toStl } = await import("../src/exporters.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");












const source = readFileSync(new URL('../fixtures/r10b/r10b.fs', import.meta.url), 'utf8');
const moduleManifest = fileURLToPath(new URL('../fixtures/r10b/modules.json', import.meta.url));
const manifest = JSON.parse(readFileSync(moduleManifest, 'utf8'));
const near = (a,b,e=0.0003) => assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);

test('all 16 revision-bound source bodies import through Bend with analytic boundaries', async () => {
  const kernel = await loadKernel(); let count = 0;
  for (const module of manifest.modules) for (const part of module.bodies) {
    const bytes = readFileSync(join(dirname(moduleManifest),part.file));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),part.sha256);
    const raw = JSON.parse(bytes);
    assert.equal(raw.documentMicroversion,module.microversion);
    const body=importOnshapeBody(kernel,raw.bodies[0],part.partId,{sha256:part.sha256});
    assert.equal(body.faces.length,part.faces);assert.equal(body.validation.closed,true);
    assert.equal(body.validation.volumeMm3,null);
    assert.ok(body.edges.every(e=>['line','circle','ellipse'].includes(e.curve.type)));
    // A generated seam must lie on its cylinder throughout the segment. Its
    // two endpoints alone cannot distinguish a generator from an invalid chord.
    body.edges.forEach((edge, i) => {
      if (i < raw.bodies[0].edges.length || edge.curve.type !== 'line') return;
      const surfaces = body.faces.filter(face => face.loops.some(loop => loop.some(use => use.edge === i))).map(face => face.surface).filter(s => s.type === 'cylinder');
      for (const surface of surfaces) for (const t of [0, .25, .5, .75, 1]) {
        const p = body.vertices[edge.start].map((a, j) => a + t * (body.vertices[edge.end][j] - a));
        const offset = p.map((v, j) => v - surface.origin[j]);
        const height = offset.reduce((sum, v, j) => sum + v * surface.axis[j], 0);
        const radius = Math.hypot(...offset.map((v, j) => v - height * surface.axis[j]));
        near(radius, surface.radius, 1e-7);
      }
    });
    raw.bodies[0].vertices.forEach((vertex, i) => vertex.point.forEach((coordinate, j) => near(body.vertices[i][j], coordinate * 1000, 1e-9)));
    if(module.namespace==='camera')assert.equal(body.provenance.recoveredCurves.length,2);
    count++;
  }
  assert.equal(count,16);
});

test('original retained-context FeatureScript imports, transforms, names and cleans five solids', async () => {
  const model=await build(source,{feature:'r10bRetainedContext',moduleManifest});
  assert.equal(model.bodies.length,5);
  assert.deepEqual(model.bodies.map(b=>b.name.split(' ')[0]),['T05','T06','R10','R39','R77']);
  assert.ok(model.bodies.every(b=>b.provenance.microversion===manifest.modules[0].microversion));
  assert.equal(model.bodies.reduce((n,b)=>n+b.faces.length,0),172);
  const step=toStep(model);
  assert.equal((step.match(/MANIFOLD_SOLID_BREP\(/g)||[]).length,5);
  assert.ok(step.includes('CYLINDRICAL_SURFACE('));
  assert.throws(()=>toStl(model),UnsupportedFeatureError);
  // The manifest binds revisions; its source SHA-256 is provenance only (docs/onshape-inputs.md).
  const edited=await build(source+'\n',{feature:'r10bRetainedContext',moduleManifest});
  assert.ok(edited.bodies.length===5&&edited.bodies.every(b=>b.provenance.sourceBinding==='mismatch'));
  assert.ok(model.bodies.every(b=>b.provenance.sourceBinding===undefined));
});

test('analytic rigid transforms preserve radii, topology and geometry under inverse',async()=>{
  const kernel=await loadKernel(), raw=JSON.parse(readFileSync(new URL('../fixtures/r10b/modules/base/Z76DD.body.json',import.meta.url)));
  const body=importOnshapeBody(kernel,raw.bodies[0],'cap',{});
  const rotated=transformAnalytic(kernel,body,'moved',[[0,-1,0],[1,0,0],[0,0,1]],[40,20,10]);
  const restored=transformAnalytic(kernel,rotated,'restored',[[0,1,0],[-1,0,0],[0,0,1]],[-20,40,-10]);
  assert.deepEqual(body.faces.map(f=>f.loops),restored.faces.map(f=>f.loops));
  body.vertices.forEach((p,i)=>p.forEach((v,j)=>near(v,restored.vertices[i][j])));
  const bad=structuredClone(body);bad.faces[0].loops[0][0].forward=!bad.faces[0].loops[0][0].forward;
  assert.throws(()=>validateAnalytic(bad),/boundary|two-manifold/);
  const badSource=structuredClone(raw.bodies[0]);badSource.edges[0].geometry.midPoint[0]+=0.01;
  assert.throws(()=>importOnshapeBody(kernel,badSource,'bad',{}),/misses its curve/);
});

test('source vertex tolerances are explicit, bounded, and do not move the input geometry',async()=>{
  const kernel=await loadKernel();
  const raw=JSON.parse(readFileSync(new URL('../fixtures/r10b/modules/base/Z2qDD.body.json',import.meta.url))).bodies[0];
  const body=importOnshapeBody(kernel,raw,'lower',{});
  body.vertices[20].forEach((v,i)=>near(v,raw.vertices[20].point[i]*1000,1e-10));
  assert.notEqual(body.vertices[20][0],Math.fround(raw.vertices[20].point[0]*1000));
  const disagreements=raw.edges.flatMap(e=>e.vertices.flatMap((v,i)=>v===raw.vertices[20].id
    ? [Math.hypot(...raw.vertices[20].point.map((p,j)=>(p-e.geometry[i===0?'startPoint':'endPoint'][j])*1000))] : []));
  near(body.vertexTolerancesMm[20],Math.max(...disagreements)+0.0003,1e-9);
  assert.ok(body.provenance.maxInputEndpointDisagreementMm>0.0046);
  raw.vertices[20].point[0]+=0.0001;
  assert.throws(()=>importOnshapeBody(kernel,raw,'bad',{}),/input tolerance beyond/);
});

const header='FeatureScript 3044;import(path:"onshape/std/geometry.fs",version:"3044.0");';
const feature=body=>`${header}export function main(context is Context,id is Id,definition is map){${body}}`;
const circle=(id,z,r)=>`var ${id}=newSketchOnPlane(context,id+"${id}",{"sketchPlane":plane(vector(0,0,${z})*millimeter,vector(0,0,1),vector(1,0,0))});skCircle(${id},"c",{"center":vector(0,0)*millimeter,"radius":${r}*millimeter});skSolve(${id});`;

test('circular extrusions are cylinders with analytic volume, bounds and shared seam',async()=>{
  for(const depth of [8,-8]){
    const model=await build(feature(circle('s',3,5)+`opExtrude(context,id+"ex",{"entities":qSketchRegion(id+"s"),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":${depth}*millimeter});`));
    const b=model.bodies[0];near(b.validation.volumeMm3,Math.PI*25*8);
    assert.equal(model.backend.precision,'F32x2');
    assert.deepEqual([b.vertices.length,b.edges.length,b.faces.length],[2,3,3]);
    assert.deepEqual(b.validation.boundsMm,{min:[-5,-5,Math.min(3,3+depth)],max:[5,5,Math.max(3,3+depth)]});
    assert.equal(b.faces[2].surface.type,'cylinder');assert.match(toStep(model),/CYLINDRICAL_SURFACE/);
  }
});

test('cylinder validation rejects a seam chord even when both vertices lie on all incident surfaces', async () => {
  const k = await loadKernel();
  const model = await build(feature(circle('s', 0, 5) + 'opExtrude(context,id+"ex",{"entities":qSketchRegion(id+"s"),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":8*millimeter});'));
  const body = structuredClone(model.bodies[0]);
  body.vertices[1] = [0, 5, 8];
  const seam = body.edges[2], start = body.vertices[seam.start], end = body.vertices[seam.end];
  const delta = end.map((v, i) => v - start[i]), length = Math.hypot(...delta);
  seam.curve = { type: 'line', origin: start, direction: delta.map(v => v / length) };
  assert.throws(() => validateAnalytic(body, k), /line edge 2 leaves cylinder face 2/);
});

test('two coaxial circular profiles loft into cones in either taper direction',async()=>{
  for(const [r0,r1]of [[5,2],[2,5],[3,3]]){
    const model=await build(feature(circle('a',0,r0)+circle('b',8,r1)+`opLoft(context,id+"loft",{"profileSubqueries":[qSketchRegion(id+"a"),qSketchRegion(id+"b")]});`));
    near(model.bodies[0].validation.volumeMm3,Math.PI*8*(r0*r0+r0*r1+r1*r1)/3);
    assert.equal(model.bodies[0].faces[2].surface.type,r0===r1?'cylinder':'cone');
  }
});

test('oblique circular extrusion is an explicit capability failure inside try silent',async()=>{
  await assert.rejects(build(feature(circle('s',0,5)+`try silent(opExtrude(context,id+"ex",{"entities":qSketchRegion(id+"s"),"direction":vector(1,0,1),"endBound":BoundingType.BLIND,"endDepth":8*millimeter}));`)),UnsupportedFeatureError);
});

}
