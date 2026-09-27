import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend() || missing("fixtures/r10b/modules/base/ZtoDD.body.json");
if (publicTreeSkip) {
  test("curved-contact.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { createHash } = await import("node:crypto");
const { mkdirSync, readFileSync, writeFileSync } = await import("node:fs");
const { loadBend } = await import("../src/bend-loader.mjs");
const { loadKernel, array, list, extrudeInBend } = await import("../src/kernel.mjs");
const { classificationInput } = await import("../src/face-classification.mjs");
const { intersectionTolerance } = await import("../src/intersections.mjs");
const { decodeAnalytic, importOnshapeBody, transformAnalytic } = await import("../src/analytic.mjs");
const { real, vector, number, coords } = await import("../src/real.mjs");
const { toStep } = await import("../src/exporters.mjs");
const { booleanPortCases } = await import("../scripts/boolean-port-cases.mjs");













const [O,C,Q,T,k]=await Promise.all([
  loadBend(new URL('../kernel/ports/curved-contact.bend',import.meta.url)),
  loadBend(new URL('../kernel/ports/curved.bend',import.meta.url)),
  loadBend(new URL('../kernel/section.bend',import.meta.url)),
  loadBend(new URL('../kernel/ports/curved-contact-topology.bend',import.meta.url)),loadKernel()]);
const out=new URL('../out/boolean-ports/contact-work/',import.meta.url);
mkdirSync(out,{recursive:true});
const frame={origin:[0,0,0],normal:[0,0,1],x:[1,0,0]};
const uProfile=[[0,0],[8,0],[8,6],[6,6],[6,2],[2,2],[2,6],[0,6]];
// Native fixture geometry supports sub-F32-scale features; the host only
// serializes an explicit profile and, where requested, a known triangulation.
function prism(points,height=4,triangles){
  const f32=p=>({$:'V3',x:Math.fround(p[0]),y:Math.fround(p[1]),z:Math.fround(p[2])});
  const topology=k.extrude(list(points.map(p=>f32([...p,0]))),f32([0,0,height])),n=points.length,delta=vector([0,0,height]);
  const vertices=[...points.map(p=>vector([...p,0])),...points.map(p=>k.precise.add(vector([...p,0]),delta))];
  const line=(a,b)=>({$:'Edge',start:a,end:b,same_sense:true,curve:{$:'Line',origin:vertices[a],direction:k.precise.normalize(k.precise.sub(vertices[b],vertices[a]))}});
  const edges=array(topology.edges).map(e=>line(e.start,e.end));
  const face=(surface,uses)=>({$:'Face',surface,same_sense:true,loops:list([{$:'Loop',outer:true,uses:list(uses)}])});
  const surfaces=[k.analytic.plane(vertices[0],vector([0,0,-1])),k.analytic.plane(vertices[n],vector([0,0,1])),...points.map((_,i)=>k.analytic.plane(vertices[i],k.precise.cross(k.precise.sub(vertices[(i+1)%n],vertices[i]),delta)))];
  let faces=array(topology.faces).map((f,i)=>face(surfaces[i],array(f.boundary)));
  if(triangles){
    const use=(a,b)=>{let i=edges.findIndex(e=>(e.start===a&&e.end===b)||(e.start===b&&e.end===a));if(i<0){i=edges.length;edges.push(line(a,b));}return {$:'Use',edge:i,forward:edges[i].start===a};};
    const ends=[];for(const level of [0,1])for(const triangle of triangles){const ids=(level?triangle:triangle.toReversed()).map(i=>i+level*n);ends.push(face(surfaces[level],ids.map((a,i)=>use(a,ids[(i+1)%3]))));}
    faces=[...ends,...faces.slice(2)];
  }
  return {$:'Solid',vertices:list(vertices),edges:list(edges),faces:list(faces)};
}
const u=()=>prism(uProfile);
function tubeAndIsland(island){
  // A connected exact cubical source: one base joins a square tube and an
  // optional central post. All source faces are elementary planar squares.
  const xy=[-5,-3,-1,1,3,5],z=[0,1,4],vertices=[],edges=[],faces=[],vertexIds=new Map(),edgeIds=new Map();
  const occupied=(i,j,l)=>i>=0&&i<5&&j>=0&&j<5&&l>=0&&l<2&&(l===0||i===0||i===4||j===0||j===4||(island&&i===2&&j===2));
  const vertex=p=>{const key=p.join('/');if(!vertexIds.has(key)){vertexIds.set(key,vertices.length);vertices.push(vector(p));}return vertexIds.get(key);};
  const face=(points,normal)=>{
    const ids=points.map(vertex),uses=ids.map((a,i)=>{const b=ids[(i+1)%4],key=a<b?`${a}/${b}`:`${b}/${a}`;if(!edgeIds.has(key)){edgeIds.set(key,edges.length);edges.push({$:'Edge',start:a,end:b,same_sense:true,curve:{$:'Line',origin:vertices[a],direction:k.precise.sub(vertices[b],vertices[a])}});}const index=edgeIds.get(key);return {$:'Use',edge:index,forward:edges[index].start===a};});
    faces.push({$:'Face',surface:k.analytic.plane(vertices[ids[0]],vector(normal)),same_sense:true,loops:list([{$:'Loop',outer:true,uses:list(uses)}])});
  };
  for(let i=0;i<5;i++)for(let j=0;j<5;j++)for(let l=0;l<2;l++)if(occupied(i,j,l)){
    const a=xy[i],b=xy[i+1],c=xy[j],d=xy[j+1],e=z[l],f=z[l+1];
    if(!occupied(i-1,j,l))face([[a,c,e],[a,c,f],[a,d,f],[a,d,e]],[-1,0,0]);
    if(!occupied(i+1,j,l))face([[b,c,e],[b,d,e],[b,d,f],[b,c,f]],[1,0,0]);
    if(!occupied(i,j-1,l))face([[a,c,e],[b,c,e],[b,c,f],[a,c,f]],[0,-1,0]);
    if(!occupied(i,j+1,l))face([[a,d,e],[a,d,f],[b,d,f],[b,d,e]],[0,1,0]);
    if(!occupied(i,j,l-1))face([[a,c,e],[a,d,e],[b,d,e],[b,c,e]],[0,0,-1]);
    if(!occupied(i,j,l+1))face([[a,c,f],[b,c,f],[b,d,f],[a,d,f]],[0,0,1]);
  }
  return {solid:{$:'Solid',vertices:list(vertices),edges:list(edges),faces:list(faces)},domains:edges.map(()=>({$:'GivenDomain',domain:{$:'Interval',first:real(0),last:real(1)}}))};
}
const cylinder=()=>k.analytic.frustum(vector([0,0,0]),vector([0,0,10]),vector([1,0,0]),real(5),real(5));
const parts=r=>r.$==='Clipped'?[r]:r.$==='Components'?array(r.bodies):[];
const near=(a,b,eps=1e-9)=>assert.ok(Math.abs(a-b)<=eps*Math.max(1,Math.abs(b)),`${a} != ${b}`);
const evidence=[];
function run(body,origin=[0,2,0],normal=[0,-1,0],options={}){
  const p=classificationInput(body,k.faceClassifier,options),tolerance=intersectionTolerance(options);
  // Native sequences inherit this original ceiling explicitly; STEP export
  // uncertainty is never fed back through classificationInput.
  const budget=options.sourceBudget??p.sourceBudget,cap=real(options.cap??1e-7);
  const start=performance.now(),attempt=O.clip(p.solid,p.domains,vector(origin),vector(normal),tolerance,budget,cap);
  return {attempt,prepared:{...p,sourceBudget:budget,tolerance},elapsedMs:performance.now()-start};
}
function policy(run){
  assert.equal(run.attempt.policy.$,'ToleratedRegularized');assert.equal(run.attempt.ledger.version,1);
  assert.deepEqual(run.attempt.policy.source_budget,run.prepared.sourceBudget);
  assert.deepEqual(run.attempt.policy.tolerance,run.prepared.tolerance);
}
function failure(run,stage){
  policy(run);const a=run.attempt;assert.equal(a.result.$,'Unresolved',JSON.stringify({result:a.result.$,stage:a.ledger.stage}));
  assert.equal(a.result.solid,undefined);assert.equal(a.result.bodies,undefined);
  if(stage!==undefined)assert.equal(a.ledger.stage,stage);
  return a;
}
// Independent combinatorial oracle: every edge-end node has degree two and
// its undirected vertex-link graph is connected, including periodic ends.
function vertexLinks(solid){
  const edges=array(solid.edges),graphs=array(solid.vertices).map(()=>new Map());
  for(const f of array(solid.faces))for(const l of array(f.loops)){
    const uses=array(l.uses);
    uses.forEach((a,i)=>{
      const b=uses[(i+1)%uses.length],ea=edges[a.edge],eb=edges[b.edge];
      const v=a.forward?ea.end:ea.start;assert.equal(v,b.forward?eb.start:eb.end);
      const na=`${a.edge}/${a.forward?1:0}`,nb=`${b.edge}/${b.forward?0:1}`,g=graphs[v];
      g.set(na,[...(g.get(na)??[]),nb]);g.set(nb,[...(g.get(nb)??[]),na]);
    });
  }
  for(const g of graphs){
    assert.ok(g.size>0);for(const adjacent of g.values())assert.equal(adjacent.length,2);
    const seen=new Set(),todo=[g.keys().next().value];
    while(todo.length){const v=todo.pop();if(seen.has(v))continue;seen.add(v);todo.push(...g.get(v));}
    assert.equal(seen.size,g.size);
  }
}
function checked(run,volume,count){
  policy(run);const a=run.attempt;assert.ok(['Clipped','Components'].includes(a.result.$),JSON.stringify({result:a.result.$,reason:a.result.reason,stage:a.ledger.stage}));
  assert.equal(a.ledger.stage,7);const bodies=parts(a.result),records=array(a.ledger.components);
  assert.equal(records.length,bodies.length);if(count!==undefined)assert.equal(bodies.length,count);
  const source=run.prepared.solid,sv=array(source.vertices),se=array(source.edges),sf=array(source.faces);
  let total=0;
  bodies.forEach((b,i)=>{
    const audit=records[i].audit,vs=array(b.solid.vertices),es=array(b.solid.edges),fs=array(b.solid.faces);
    assert.equal(audit.valid,true);assert.equal(records[i].vertex_links,true);vertexLinks(b.solid);
    assert.ok(number(audit.required)<=number(audit.allowance));
    near(number(audit.allowance),number(run.prepared.sourceBudget)+number(audit.resolution),1e-13);total+=number(audit.volume);
    assert.equal(array(b.domains).length,es.length);assert.equal(array(b.edge_origins).length,es.length);assert.equal(array(b.face_origins).length,fs.length);
    const uses=es.map(()=>[]),neighbors=fs.map(()=>new Set());
    fs.forEach((f,j)=>array(f.loops).forEach(l=>array(l.uses).forEach(u=>uses[u.edge].push({...u,face:j}))));
    uses.forEach(pair=>{assert.deepEqual(pair.map(u=>u.forward).toSorted(),[false,true]);neighbors[pair[0].face].add(pair[1].face);neighbors[pair[1].face].add(pair[0].face);});
    const seen=new Set(),todo=[0];while(todo.length){const f=todo.pop();if(seen.has(f))continue;seen.add(f);todo.push(...neighbors[f]);}assert.equal(seen.size,fs.length);
    assert.equal(new Set(es.flatMap(e=>[e.start,e.end])).size,vs.length);
    array(records[i].vertices).filter(m=>m.before<sv.length).forEach(m=>assert.deepEqual(vs[m.after],sv[m.before]));
    array(b.edge_origins).forEach((o,j)=>{if(o.$==='SourceEdge'){assert.deepEqual(es[j].curve,se[o.index].curve);assert.equal(es[j].same_sense,se[o.index].same_sense);}});
    array(b.face_origins).forEach((o,j)=>{if(o.$==='SourceFace'){assert.deepEqual(fs[j].surface,sf[o.index].surface);assert.equal(fs[j].same_sense,sf[o.index].same_sense);}});
  });
  if(volume!==undefined)near(total,volume);
  return bodies;
}
function exportRun(run,name){
  const records=array(run.attempt.ledger.components),bodies=parts(run.attempt.result).map((p,i)=>{
    const audit=records[i].audit,allowance=number(audit.allowance),exportTolerance=Math.max(0.0003,allowance);
    const b=decodeAnalytic(p.solid,`${name}/${i}`,k,array(p.solid.vertices).map(()=>exportTolerance));
    b.validation.volumeMm3=number(audit.volume);
    array(p.domains).forEach((d,j)=>{if(d.domain.$==='Interval')b.edges[j].curveRange=[number(d.domain.first),number(d.domain.last)];});
    b.construction={method:run.method??'explicit tolerated regularized contact in Bend',sourceBudgetMm:number(run.prepared.sourceBudget),contactCapMm:number(run.attempt.policy.contact_cap),requiredIncidenceMm:number(audit.required),allowanceMm:allowance,numericResolutionMm:number(audit.resolution),exportToleranceMm:exportTolerance,faceOrigins:array(p.face_origins),edgeOrigins:array(p.edge_origins),contactPolicy:run.attempt.policy,contactLedger:run.contactLedger??run.attempt.ledger};
    return b;
  });
  const model={schema:'wonky-brep/1',units:'millimeter',backend:{language:'Bend',version:'2.0.25'},bodies};
  writeFileSync(new URL(`${name}.native.json`,out),JSON.stringify(run.nativeRecord??run.attempt)+'\n');
  writeFileSync(new URL(`${name}.brep.json`,out),JSON.stringify(model,null,2)+'\n');writeFileSync(new URL(`${name}.step`,out),toStep(model,name));
  evidence.push({name,elapsedMs:run.elapsedMs,result:run.attempt.result.$,sourceBudgetMm:number(run.prepared.sourceBudget),contactCapMm:number(run.attempt.policy.contact_cap),components:records.map(c=>({...Object.fromEntries(Object.entries(c.audit).map(([k,v])=>[k,v?.$==='Real'?number(v):v])),vertexLinks:c.vertex_links}))});
  writeFileSync(new URL('test-evidence.json',out),JSON.stringify(evidence,null,2)+'\n');
}

test('explicit contact crossbar returns two complete connected boxes totaling 64 mm3',()=>{
  const source=u(),before=JSON.stringify(source),r=run(source),bodies=checked(r,64,2);
  for(const b of bodies)assert.deepEqual([array(b.solid.vertices).length,array(b.solid.edges).length,array(b.solid.faces).length],[8,12,6]);
  assert.equal(JSON.stringify(source),before);assert.equal(array(r.attempt.ledger.vertices).filter(v=>v.kind===0).length,4);
  assert.ok(array(r.attempt.ledger.vertices).filter(v=>v.kind===0).every(v=>v.exact.sign.$==='ExactlyZero'));
  exportRun(r,'U-crossbar');
  const nonunit=extrudeInBend(k,'nonunit-U',uProfile,frame,[0,0,4]);checked(run(nonunit),64,2);
  checked(run(source,[0,3,0]),48,2);checked(run(source,[0,8,0],[0,1,0]),128,1);
  const empty=run(source,[0,-1,0],[0,1,0]);policy(empty);assert.equal(empty.attempt.result.$,'Empty');assert.equal(empty.attempt.ledger.stage,7);
});

test('contact keeps represented signs and original supports under shift/tilt with a fixed budget',()=>{
  for(const [name,origin,normal] of [['shifted',[0,2+2e-8,0],[0,-1,0]],['tilted',[0,2,0],[1e-9,-1,0]]]){
    const r=run(u(),origin,normal,{sourceBudget:real(1e-7)});checked(r,undefined,2);
    const contacts=array(r.attempt.ledger.vertices).filter(v=>v.kind===0);assert.equal(contacts.length,4);
    assert.ok(contacts.every(v=>v.exact.sign.$==='Positive'));
    assert.ok(contacts.every(v=>v.association.value.$==='Associated'));
    exportRun(r,`U-${name}`);
  }
  // With two rings the containment probe rejects the insufficient budget
  // before component assembly. A single retained L branch reaches the final
  // component audit and exposes the measured construction shortfall there.
  failure(run(u(),[0,2+2e-8,0],[0,-1,0]),5);
  const branch=prism([[0,0],[4,0],[4,2],[2,2],[2,6],[0,6]]);
  checked(run(branch,[0,2+2e-8,0],[0,-1,0],{sourceBudget:real(1e-7)}),undefined,1);
  const rejected=failure(run(branch,[0,2+2e-8,0],[0,-1,0]),6);
  assert.ok(array(rejected.ledger.components).some(c=>number(c.audit.required)>number(c.audit.allowance)));
  failure(run(u(),[0,2+1e-7,0],[0,-1,0],{sourceBudget:real(1e-6)}),3);
  failure(run(u(),undefined,undefined,{cap:0}),3);
});

test('contact rejects invalid policy/source before Empty or contained shortcuts',async()=>{
  const source=u();
  for(const cap of [-1e-12,0.10001,1])failure(run(source,[0,-1,0],[0,1,0],{cap}),0);
  for(const sourceBudget of [-1e-12,0.10001,1])failure(run(source,[0,8,0],[0,1,0],{sourceBudget:real(sourceBudget)}),0);
  for(const opts of [{linear:0},{linear:-1},{angular:0},{angular:1e-15},{angular:1}])failure(run(source,undefined,undefined,opts),0);
  failure(run(source,[0,2,0],[0,0,0]),0);
  const bad=classificationInput(source,k.faceClassifier).solid,faces=array(bad.faces);faces[0].surface.x=vector([0,0,1]);bad.faces=list(faces);
  for(const h of [-1,8])failure(run(bad,[0,h,0],[0,1,0]),1);
  const zero=(await booleanPortCases({imported:false})).find(c=>c.id==='zero-volume-shell').body;
  failure(run(zero,[0,0,30],[0,0,1]),1);
});

test('contact rejects curved contact/tangency, competing anchors and retained-face/cap overlays',()=>{
  for(const [origin,normal] of [[[0,0,0],[0,0,1]],[[5,0,0],[1,0,0]],[[0,0,5],[0,0,1]],[[0,0,0],[0,1,0]]])failure(run(cylinder(),origin,normal),2);
  checked(run(cylinder(),[0,0,20],[0,0,1]),250*Math.PI,1);
  failure(run(u(),[0,2,0],[0,1,0]),5);
  const thin=prism(uProfile,1e-7);
  const conflict=failure(run(thin),3);assert.ok(array(conflict.ledger.vertices).some(v=>v.kind===3&&v.association?.value?.$==='Associated'));
  // A full trim extending far beyond its endpoints cannot be accepted from
  // those near vertices; source budget does not excuse the domain mismatch.
  const p=classificationInput(u(),k.faceClassifier),edges=array(p.solid.edges),contact=edges.findIndex(e=>coords(array(p.solid.vertices)[e.start])[1]===2&&coords(array(p.solid.vertices)[e.end])[1]===2);
  const domains=edges.map(()=>({$:'AutoDomain'}));domains[contact]={$:'GivenDomain',domain:{$:'Interval',first:real(-100),last:real(100)}};
  failure(run(p.solid,undefined,undefined,{domains}),1);
});

test('caps use common-plane checking witnesses to reject overlapping projected regions',()=>{
  // Independent review established a simple source profile, disjoint cap
  // triangles and exact area coverage for this fixture. Raw representatives
  // at y=+/-9e-8 are separated; their cutter-plane cap projections overlap.
  const d=5e-8,e=9e-8,points=[[-2,-1],[2,-1],[2,1],[1,1],[-d,e],[.5,-.2],[-.5,-.2],[d,-e],[-1,1],[-2,1]];
  const source=prism(points,4,[[0,1,5],[0,5,6],[1,2,5],[2,3,5],[3,4,5],[0,6,9],[6,8,9],[6,7,8]]),budget=real(.001),before=JSON.stringify(source);
  assert.equal(C.audit(source,list([]),intersectionTolerance(),budget).valid,true);vertexLinks(source);
  failure(run(source,[0,0,0],[0,-1,0],{sourceBudget:budget}),5);assert.equal(JSON.stringify(source),before);
});

test('contact supports a simple cap hole but deliberately rejects an island nested inside it',()=>{
  const tube=tubeAndIsland(false),r=run(tube.solid,[0,0,2],[0,0,-1],{domains:tube.domains,sourceBudget:real(1e-7)}),[body]=checked(r,128,1);
  const cap=array(body.face_origins).findIndex(o=>o.$==='CutFace');assert.deepEqual(array(array(body.solid.faces)[cap].loops).map(l=>l.outer),[true,false]);
  const nested=tubeAndIsland(true),before=JSON.stringify(nested);vertexLinks(nested.solid);
  assert.equal(C.audit(nested.solid,list(nested.domains),intersectionTolerance(),real(1e-7)).valid,true);
  near(number(C.volume(nested.solid,list(nested.domains))),304);
  const rejected=failure(run(nested.solid,[0,0,2],[0,0,-1],{domains:nested.domains,sourceBudget:real(1e-7)}),5);
  assert.equal(rejected.result.reason.$,'UnsupportedArrangement');assert.equal(JSON.stringify(nested),before);
});

test('contact topology audit rejects a pinched vertex with two otherwise closed link cycles',()=>{
  const p=classificationInput(u(),k.faceClassifier).solid;assert.equal(T.valid(p),true);
  const other=classificationInput(u(),k.faceClassifier).solid,vertices=array(p.vertices),edges=array(p.edges),offset=vertices.length-1,eo=edges.length;
  // Join disjoint valid shells at only one topological vertex. Edge pairing
  // still holds; the shared vertex has two disconnected link cycles.
  const map=i=>i===0?0:i+offset;
  const pinched={$:'Solid',vertices:list([...vertices,...array(other.vertices).slice(1)]),edges:list([...edges,...array(other.edges).map(e=>({...e,start:map(e.start),end:map(e.end)}))]),faces:list([...array(p.faces),...array(other.faces).map(f=>({...f,loops:list(array(f.loops).map(l=>({...l,uses:list(array(l.uses).map(u=>({...u,edge:u.edge+eo})))})))}))])};
  assert.equal(T.valid(pinched),false);failure(run(pinched,[0,8,0],[0,1,0]),1);
  assert.equal(T.valid(cylinder()),true);
});

test('contact is stable under ordering, a rigid transform and repeated clipping with returned domains',()=>{
  const p=classificationInput(u(),k.faceClassifier),vs=array(p.solid.vertices),es=array(p.solid.edges),fs=array(p.solid.faces);
  const nv=vs.length,ne=es.length;
  const permuted={$:'Solid',vertices:list(vs.toReversed()),edges:list(es.toReversed().map(e=>({...e,start:nv-1-e.start,end:nv-1-e.end}))),faces:list(fs.toReversed().map(f=>({...f,loops:list(array(f.loops).map(l=>({...l,uses:list(array(l.uses).map(u=>({...u,edge:ne-1-u.edge})))})))})))};
  checked(run(permuted),64,2);
  const rot={$:'Rotation',x:vector([0,1,0]),y:vector([0,0,1]),z:vector([1,0,0])};
  const transformed=k.analytic.transform(p.solid,rot,vector([10,-3,8]));checked(run(transformed,[10,-3,10],[0,0,-1]),64,2);
  const first=run(p.solid),before=JSON.stringify(first.attempt);for(const b of checked(first,64,2)){
    const repeated=run(b.solid,undefined,undefined,{domains:array(b.domains),sourceBudget:first.prepared.sourceBudget});checked(repeated,32,1);
    assert.equal(array(parts(repeated.attempt.result)[0].solid.faces).length,6);
  }
  assert.equal(JSON.stringify(first.attempt),before);
});

let frozen;
function p10(){
  if(frozen)return frozen;
  const bytes=readFileSync(new URL('../fixtures/r10b/modules/base/ZtoDD.body.json',import.meta.url)),sha=createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha,'b78a8546970e360ee2a3a22661c87d4f9e835d24fe50cedeedde6a19add20dc9');
  const body=transformAnalytic(k,importOnshapeBody(k,JSON.parse(bytes).bodies[0],'contact-P10',{sha256:sha}),'contact-g0',[[1,0,0],[0,0.9063077870366499,-0.42261826174069944],[0,0.42261826174069944,0.9063077870366499]],[0,85.7915071334,-183.980480768]);
  frozen=classificationInput(body,k.faceClassifier);return frozen;
}
test('actual frozen P10 y=4 uses tolerated negative contacts while strict entrypoints remain unresolved',()=>{
  const p=p10(),before=JSON.stringify(p),r=run(p.solid,[0,4,0],[0,-1,0],{domains:array(p.domains),sourceBudget:p.sourceBudget});
  checked(r,184483.26061960915,1);const contacts=array(r.attempt.ledger.vertices).filter(v=>v.kind===0);assert.equal(contacts.length,17);
  assert.ok(contacts.every(v=>v.exact.sign.$==='Negative'&&v.exact.method.$==='ExactDyadic'));
  assert.equal(array(r.attempt.ledger.bands).length,17);assert.ok(array(r.attempt.ledger.bands).every(b=>b.result.relation.$==='ToleratedBand'));
  const tolerance=intersectionTolerance();assert.equal(Q.section(p.solid,p.domains,vector([0,4,0]),vector([0,-1,0]),tolerance,p.sourceBudget).$,'Failed');
  assert.equal(C.clip(p.solid,p.domains,vector([0,4,0]),vector([0,-1,0]),tolerance,p.sourceBudget).$,'Unresolved');
  assert.equal(JSON.stringify(p),before);exportRun(r,'P10-y4');
});

test('actual P10 top then contact then right reuses explicit domains and the unchanged original budget',()=>{
  const p=p10(),t=intersectionTolerance(),top=C.clip(p.solid,p.domains,vector([0,0,68]),vector([0,0,1]),t,p.sourceBudget);
  assert.equal(top.$,'Clipped');
  const contact=run(top.solid,[0,4,0],[0,-1,0],{domains:array(top.domains),sourceBudget:p.sourceBudget}),[middle]=checked(contact,undefined,1);
  exportRun(contact,'P10-top-y4');const before=JSON.stringify(middle);
  const right=C.clip(middle.solid,middle.domains,vector([-92.79000091552734,0,0]),vector([1,0,0]),t,p.sourceBudget);
  assert.ok(['Clipped','Components'].includes(right.$),JSON.stringify(right));
  const audits=parts(right).map(b=>C.audit(b.solid,b.domains,t,p.sourceBudget));assert.ok(audits.every(a=>a.valid));
  parts(right).forEach(b=>vertexLinks(b.solid));assert.equal(JSON.stringify(middle),before);
  const wrapper={prepared:{...p,tolerance:t},method:'strict analytic clip after explicit tolerated contact',contactLedger:contact.attempt.ledger,nativeRecord:{contact:contact.attempt,right:{result:right,audits,sourceBudget:p.sourceBudget}},attempt:{result:right,policy:contact.attempt.policy,ledger:{components:list(audits.map(audit=>({audit,vertex_links:true})))}}};
  exportRun(wrapper,'P10-top-y4-right');
  assert.ok(audits.reduce((sum,a)=>sum+number(a.volume),0)<number(array(contact.attempt.ledger.components)[0].audit.volume));
});

}
