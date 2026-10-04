import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
process.env.WONKY_BACKEND='rust';
const {build}=await import('../src/index.mjs');
const {rustMesh,rustModelKernel,referenceDisplaySource,referenceBodyReport,rustHostOf,referenceBodySource,referenceChartLegalizer}=await import('../src/native/rust-host.mjs');
const {toStl}=await import('../src/exporters.mjs');
const {reviewScene}=await import('../src/review-scene.mjs');
const {languageOf}=await import('../src/viewer/live/session.mjs');
const {toHtml}=await import('../src/preview.mjs');
const {validateReferenceMesh,carrierPoint,referenceStl,placeReferencePoint,tessellateReference}=await import('../src/native/reference-mesh.mjs');
async function fixture(name) {
  const sourcePath=new URL(`../fixtures/step-reference/${name}.step`,import.meta.url).pathname;
  return build(readFileSync(sourcePath,'utf8'),{sourcePath});
}
const models=new Map();
async function get(name){if(!models.has(name))models.set(name,await fixture(name));return models.get(name);}
function stlEdges(stl) {
  const edges=new Map();
  for(let i=0;i<stl.readUInt32LE(80);i++) {
    const vertices=[0,1,2].map(j=>[0,1,2].map(k=>stl.readFloatLE(84+50*i+12+12*j+4*k)).join(','));
    for(let j=0;j<3;j++){const a=vertices[j],b=vertices[(j+1)%3],key=[a,b].sort().join('/');const uses=edges.get(key)??[];uses.push(a<b?1:-1);edges.set(key,uses);}
  }
  for(const uses of edges.values())assert.deepEqual(uses.sort(),[-1,1]);
}
test('imported tetrahedron exports a watertight labelled mesh through normal STL and HTML paths',async()=>{
  const m=await get('tetra-reference'),mesh=rustMesh(rustModelKernel(m),m.bodies,.02).bodies[0];
  assert.equal(mesh.exact,false);assert.equal(mesh.approximation,'tessellated mesh');
  assert.equal(mesh.validation.faces,4);assert.equal(mesh.validation.watertight,true);assert.ok(mesh.validation.exactCarrierChecks>0);
  assert.deepEqual(mesh.uncertainty,referenceBodyReport(m.bodies[0]).uncertainty);
  const stl=toStl(m,{deviationMm:.02});stlEdges(stl);
  const scene=await reviewScene(m,{});assert.equal(scene.display.exact,false);assert.equal(scene.bodies[0].faces.filter(f=>f.triangles.length>0).length,4);assert.equal(languageOf('reference.STEP'),'step');
  await assert.rejects(reviewScene(m,{}, {toleranceMm:.001}),/import\/mesh\/saved-boundary-budget/);
  const html=toHtml(m);assert.match(html,/Imported reference/);assert.match(html,/exact:false/);assert.match(html,/Volume not evaluated/);
});
test('retained planes, cylinders, cones, sphere caps and trimmed tori use the shared mesh path',async()=>{
  const m=await get('analytical'),kernel=rustModelKernel(m),meshes=rustMesh(kernel,m.bodies,.02).bodies;
  const kinds=new Set();
  for(let i=0;i<meshes.length;i++) {
    const mesh=meshes[i],source=referenceDisplaySource(kernel,m.bodies[i],.02);source.carriers.forEach(c=>kinds.add(c.kind));
    assert.equal(mesh.validation.faces,source.faces.length);assert.ok(mesh.validation.exactCarrierChecks>0);
    assert.ok(mesh.validation.maximumVertexDeviationMm<.02);assert.ok(mesh.validation.maximumSampledDeviationMm<.02);assert.ok(mesh.maximumInterpolationBoundMm<=.01);
    assert.equal(validateReferenceMesh(source,mesh).watertight,true);stlEdges(referenceStl([mesh],.02));
  }
  assert.deepEqual([...kinds].sort(),['cone','cylinder','plane','sphere','torus']);
  assert.ok(toStl(m,{deviationMm:.02}).readUInt32LE(80)>0);
});
test('trimmed rational B-spline face is meshed against its retained carrier',async()=>{
  const m=await get('spline-trim'),kernel=rustModelKernel(m),mesh=rustMesh(kernel,m.bodies,.02).bodies[0],source=referenceDisplaySource(kernel,m.bodies[0],.02);
  assert.ok(source.carriers.some(c=>c.kind==='spline'));assert.equal(mesh.validation.faces,4);assert.ok(mesh.validation.exactCarrierChecks>0);
  assert.equal(validateReferenceMesh(source,mesh).watertight,true);stlEdges(toStl(m,{deviationMm:.02}));
});
test('dropped source face fails watertightness rather than publishing partial success',async()=>{
  const m=await get('tetra-reference'),kernel=rustModelKernel(m),mesh=rustMesh(kernel,m.bodies,.02).bodies[0],source=referenceDisplaySource(kernel,m.bodies[0],.02),drop=mesh.faces[0];
  const keep=mesh.faces.map((f,i)=>f===drop?-1:i).filter(i=>i>=0);
  mesh.triangles=keep.flatMap(i=>mesh.triangles.slice(3*i,3*i+3));mesh.triangleUvs=keep.map(i=>mesh.triangleUvs[i]);mesh.faces=keep.map(i=>mesh.faces[i]);
  assert.throws(()=>validateReferenceMesh(source,mesh),/not-watertight/);
});
test('a full untrimmed torus fails the source trim check even with forged mesh domains',async()=>{
  const m=await get('analytical'),kernel=rustModelKernel(m),i=m.bodies.findIndex(b=>referenceBodyReport(b).faceCensus.TOROIDAL_SURFACE),body=m.bodies[i],mesh=rustMesh(kernel,[body],.02).bodies[0],source=referenceDisplaySource(kernel,body,.02),face=source.faces.find(f=>source.carriers.find(c=>c.id===f.surface).kind==='torus'),carrier=source.carriers.find(c=>c.id===face.surface);
  // A complete closed carrier mesh, including the lower half excluded by STEP.
  assert.equal(source.placements.length,2);
  const nu=128,nv=64,index=(i,j)=>(i%nu)*nv+(j%nv),angle=(i,n)=>2*Math.PI*i/n;
  mesh.vertices=[];mesh.triangles=[];mesh.faces=[];mesh.triangleUvs=[];
  for(let i=0;i<nu;i++)for(let j=0;j<nv;j++)mesh.vertices.push(...placeReferencePoint(source,carrierPoint(carrier,[angle(i,nu),angle(j,nv)],source.unitToMm)));
  for(let i=0;i<nu;i++)for(let j=0;j<nv;j++)for(const corners of [[[i,j],[i+1,j],[i,j+1]],[[i+1,j],[i+1,j+1],[i,j+1]]]) {
    mesh.triangles.push(...corners.map(([i,j])=>index(i,j)));mesh.faces.push(face.id);mesh.triangleUvs.push(corners.map(([i,j])=>[angle(i,nu),angle(j,nv)]));
  }
  stlEdges(referenceStl([mesh],.02));
  mesh.domains=[{face:face.id,loops:[[[-10,-10],[10,-10],[10,10],[-10,10]]]}];
  assert.throws(()=>validateReferenceMesh(source,mesh),/outside-trim/);
});
test('normal STEP CLI writes binary STL and an approximate sidecar',()=>{
  const dir=mkdtempSync(join(tmpdir(),'wonky-step-mesh-'));
  try {
    const path=new URL('../fixtures/step-reference/tetra-reference.step',import.meta.url).pathname,out=join(dir,'tetra');
    const result=spawnSync(process.execPath,['bin/wonky.mjs',path,'--format','stl','--out',out],{encoding:'utf8',env:process.env});
    assert.equal(result.status,0,result.stderr);stlEdges(readFileSync(`${out}.stl`));
    const sidecar=JSON.parse(readFileSync(`${out}.stl.json`));assert.equal(sidecar.exact,false);assert.equal(sidecar.approximation,'tessellated mesh');assert.equal(sidecar.bodies[0].validation.watertight,true);assert.ok(sidecar.bodies[0].uncertainty);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('CLI all fails explicitly when source uncertainty prevents every display export',()=>{
  const dir=mkdtempSync(join(tmpdir(),'wonky-step-budget-'));
  try {
    const original=readFileSync(new URL('../fixtures/step-reference/tetra-reference.step',import.meta.url),'utf8');
    assert.ok(original.includes('LENGTH_MEASURE(0.)'));
    const path=join(dir,'uncertain.step');writeFileSync(path,original.replace('LENGTH_MEASURE(0.)','LENGTH_MEASURE(0.01)'));
    const result=spawnSync(process.execPath,['bin/wonky.mjs',path,'--format','all','--out',join(dir,'out'),'--json'],{encoding:'utf8',env:process.env});
    assert.equal(result.status,3,result.stderr);const report=JSON.parse(result.stdout);assert.equal(report.status,'refused');assert.equal(report.outputs.length,0);
    assert.ok(report.skipped.some(p=>p.message.includes('import/display-budget-below-source-uncertainty')));assert.match(result.stderr,/EXPORT_UNAVAILABLE/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('planted off-carrier mesh observation fails the native exact predicate check',async()=>{
  const m=await get('tetra-reference'),kernel=rustModelKernel(m),source=referenceDisplaySource(kernel,m.bodies[0],.02);
  const face=source.faces[0];
  const result=()=>rustHostOf(kernel).addon.referenceCheckPoints(referenceBodySource(m.bodies[0]),[source.id,face.surface,0,0,99999,99999,99999].join(' '),.005);
  assert.throws(result,e=>e.code==='BX_CAPABILITY');
});

test('nonflat biquadratic rational cap retains shared boundaries and its interior curvature',async()=>{
  const provenance=JSON.parse(readFileSync(new URL('../fixtures/step-reference/curved-patch.provenance.json',import.meta.url)));assert.equal(provenance.sha256,createHash('sha256').update(readFileSync(new URL('../fixtures/step-reference/curved-patch.step',import.meta.url))).digest('hex'));
  const m=await get('curved-patch'),kernel=rustModelKernel(m),source=referenceDisplaySource(kernel,m.bodies[0],.02),mesh=rustMesh(kernel,m.bodies,.02).bodies[0];
  const spline=source.carriers.find(c=>c.kind==='spline');assert.ok(spline);
  const face=source.faces.find(f=>f.surface===spline.id),points=mesh.faces.flatMap((id,t)=>id===face.id?mesh.triangles.slice(3*t,3*t+3).map(i=>mesh.vertices.slice(3*i,3*i+3)):[]);
  assert.ok(points.some(p=>p[2]>.05),'curved interior must appear instead of a flat carrier hull');
  for(const [x,y,z] of points)assert.ok(Math.abs(z-x*(1-x)*y*(1-y))<.005);
  assert.equal(validateReferenceMesh(source,mesh).watertight,true);stlEdges(toStl(m,{deviationMm:.02}));
  assert.equal(mesh.validation.faces,6);assert.ok(mesh.validation.maximumSampledDeviationMm<.02);
});

test('live STEP server builds and serves the actual approximate reference scene',async()=>{
  const {createReviewServer}=await import('../src/review-server.mjs');
  const dir=mkdtempSync(join(tmpdir(),'wonky-step-live-'));let server;
  try {
    server=await createReviewServer({sources:[{path:new URL('../fixtures/step-reference/tetra-reference.step',import.meta.url).pathname}],port:0,
      reviewDirectory:join(dir,'reviews'),stateDirectory:join(dir,'state'),live:{pool:{spare:false}}});
    const revision=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('STEP live revision timed out')),120000);
      server.events.subscribe(event=>{
        if(event.name==='revision'){clearTimeout(timer);resolve(event.data);}
        if(event.name==='build-failed'){clearTimeout(timer);reject(new Error(JSON.stringify(event.data)));}
      });
    });
    const response=await fetch(`${server.origin}/api/models/${revision.modelId}`);assert.equal(response.status,200);
    const scene=await response.json();assert.equal(scene.display.exact,false);assert.equal(scene.display.approximation,'tessellated mesh');
    assert.equal(scene.bodies.length,1);assert.equal(scene.bodies[0].faces.filter(f=>f.triangles.length).length,4);
    const draw=await fetch(`${server.origin}/api/models/${revision.modelId}/draw`);assert.equal(draw.status,200);
    const bytes=Buffer.from(await draw.arrayBuffer());assert.equal(bytes.subarray(0,4).toString(),'WKD1');
    const {decodeDrawHeader}=await import('../viewer/render/draw-decode.js'),{header}=decodeDrawHeader(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
    assert.equal(header.bodies[0].exact,false);assert.equal(header.bodies[0].approximation,'tessellated mesh');assert.ok(header.bodies[0].uncertainty);
  }finally{await server?.close();rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

test('shape-regular refinement handles a tall trimmed cylindrical segment',async()=>{
  const radius=5.9,height=30,angle=1.2,n=256,frame={origin:[0,0,0],columns:[[1,0,0],[0,1,0],[0,0,1]]};
  const rings=[0,height].map(z=>Array.from({length:n+1},(_,i)=>{const u=-angle+2*angle*i/n;return [radius*Math.cos(u),radius*Math.sin(u),z];}));
  const vertices=[[1,rings[0][0]],[2,rings[0].at(-1)],[3,rings[1][0]],[4,rings[1].at(-1)]],point=id=>vertices.find(([i])=>i===id)[1];
  const edge=(id,a,b,points=[point(a),point(b)])=>({id,vertices:[a,b],closed:false,points});
  const face=(id,surface,sameSense,uses)=>({id,surface,sameSense,loops:[{outer:true,uses}]});
  const source={id:1,unitToMm:1,uncertaintyMm:1e-9,placements:[],vertices,
    edges:[edge(1,1,2,rings[0]),edge(2,3,4,rings[1]),edge(3,1,2),edge(4,3,4),edge(5,1,3),edge(6,2,4)],
    carriers:[{id:1,kind:'cylinder',frame,parameters:[radius]},{id:2,kind:'plane',frame:{origin:[radius*Math.cos(angle),0,0],columns:[[0,1,0],[0,0,1],[1,0,0]]},parameters:[]},
      {id:3,kind:'plane',frame,parameters:[]},{id:4,kind:'plane',frame:{...frame,origin:[0,0,height]},parameters:[]}],
    faces:[face(1,1,true,[[1,true],[6,true],[2,false],[5,false]]),face(2,2,false,[[3,false],[5,true],[4,true],[6,false]]),
      face(3,3,false,[[1,false],[3,true]]),face(4,4,true,[[2,true],[4,false]])]};
  const kernel=rustModelKernel(await get('tetra-reference'));
  const mesh=tessellateReference(source,.02,referenceChartLegalizer(kernel));assert.equal(mesh.validation.watertight,true);assert.equal(mesh.validation.faces,4);
  assert.ok(mesh.maximumInterpolationBoundMm<=.01);assert.ok(mesh.validation.maximumSampledDeviationMm<.02);stlEdges(referenceStl([mesh],.02));
});
