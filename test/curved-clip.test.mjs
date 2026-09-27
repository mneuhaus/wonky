import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend() || missing("fixtures/r10b/modules/base/ZtoDD.body.json");
if (publicTreeSkip) {
  test("curved-clip.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { mkdirSync, readFileSync, writeFileSync } = await import("node:fs");
const { createHash } = await import("node:crypto");
const { loadBend } = await import("../src/bend-loader.mjs");
const { loadKernel, array, list, extrudeInBend } = await import("../src/kernel.mjs");
const { classificationInput } = await import("../src/face-classification.mjs");
const { intersectionTolerance } = await import("../src/intersections.mjs");
const { decodeAnalytic, importOnshapeBody, transformAnalytic } = await import("../src/analytic.mjs");
const { real, vector, number, coords } = await import("../src/real.mjs");
const { toStep } = await import("../src/exporters.mjs");
const { booleanPortCases } = await import("../scripts/boolean-port-cases.mjs");













const [O,k]=await Promise.all([loadBend(new URL('../kernel/ports/curved.bend',import.meta.url)),loadKernel()]);
const frame={origin:[0,0,0],normal:[0,0,1],x:[1,0,0]};
const cylinder=()=>k.analytic.frustum(vector([0,0,0]),vector([0,0,10]),vector([1,0,0]),real(5),real(5));
const near=(a,b,eps=2e-9)=>assert.ok(Math.abs(a-b)<=eps*Math.max(1,Math.abs(b)),`${a} differs from ${b}`);
const components=r=>r.$==='Clipped'?[r]:r.$==='Components'?array(r.bodies):[];
function clip(body,origin,normal,options={}){
  const p=classificationInput(body,k.faceClassifier,options),tolerance=intersectionTolerance(options);
  return {result:O.clip(p.solid,p.domains,vector(origin),vector(normal),tolerance,p.sourceBudget),prepared:{...p,tolerance}};
}
function checked(run,expected,counts){
  const {result:r,prepared:p}=run; assert.ok(['Clipped','Components'].includes(r.$),JSON.stringify(r));
  const bodies=components(r);if(counts!==undefined)assert.equal(bodies.length,counts);
  let total=0;
  for(const b of bodies){
    const edges=array(b.solid.edges),faces=array(b.solid.faces),vertices=array(b.solid.vertices),audit=O.audit(b.solid,b.domains,p.tolerance,p.sourceBudget);
    assert.equal(audit.valid,true);assert.ok(number(audit.required)<=number(audit.allowance));
    near(number(audit.allowance),number(p.sourceBudget)+number(audit.resolution),1e-12);total+=number(audit.volume);
    assert.equal(array(b.domains).length,edges.length);assert.equal(array(b.edge_origins).length,edges.length);assert.equal(array(b.face_origins).length,faces.length);
    const incidence=edges.map(()=>[]);faces.forEach(f=>array(f.loops).forEach(l=>array(l.uses).forEach(u=>incidence[u.edge].push(u.forward))));
    incidence.forEach(uses=>assert.deepEqual(uses.toSorted(),[false,true]));
    assert.equal(new Set(edges.flatMap(e=>[e.start,e.end])).size,vertices.length);
  }
  if(expected!==undefined)near(total,expected);
  return bodies;
}
function exportRun(run,name){
  const {result:r,prepared:p}=run,root=new URL('../out/boolean-ports/curved/',import.meta.url);mkdirSync(root,{recursive:true});
  const bodies=components(r).map((c,i)=>{
    const audit=O.audit(c.solid,c.domains,p.tolerance,p.sourceBudget),allowance=number(audit.allowance),exportTolerance=Math.max(0.0003,allowance);
    const b=decodeAnalytic(c.solid,`${name}/${i}`,k,array(c.solid.vertices).map(()=>exportTolerance));
    b.validation.volumeMm3=number(audit.volume);
    array(c.domains).forEach((d,j)=>{if(d.domain.$==='Interval')b.edges[j].curveRange=[number(d.domain.first),number(d.domain.last)];});
    b.construction={method:'generic analytic curved clip in Bend',sourceBudgetMm:number(p.sourceBudget),requiredIncidenceMm:number(audit.required),allowanceMm:allowance,numericResolutionMm:number(audit.resolution),exportToleranceMm:exportTolerance,
      faceOrigins:array(c.face_origins),edgeOrigins:array(c.edge_origins)};
    return b;
  });
  const model={schema:'wonky-brep/1',units:'millimeter',backend:{language:'Bend',version:'2.0.25'},bodies};
  writeFileSync(new URL(`${name}.brep.json`,root),JSON.stringify(model,null,2)+'\n');writeFileSync(new URL(`${name}.step`,root),toStep(model,name));
}
function annularCylinder(){
  const circle=(r,z)=>({type:'circle',origin:[0,0,z],normal:[0,0,1],x:[1,0,0],radius:r});
  const use=(edge,forward)=>({edge,forward});
  const side=(radius,sameSense,uses)=>({surface:{type:'cylinder',origin:[0,0,0],axis:[0,0,1],x:[1,0,0],radius},sameSense,loops:[uses],outer:[true]});
  return {vertices:[[5,0,0],[5,0,10],[2,0,0],[2,0,10]],edges:[
    {start:0,end:0,sameSense:true,curve:circle(5,0)},{start:1,end:1,sameSense:true,curve:circle(5,10)},
    {start:0,end:1,sameSense:true,curve:{type:'line',origin:[5,0,0],direction:[0,0,1]}},
    {start:2,end:2,sameSense:true,curve:circle(2,0)},{start:3,end:3,sameSense:true,curve:circle(2,10)},
    {start:2,end:3,sameSense:true,curve:{type:'line',origin:[2,0,0],direction:[0,0,1]}}],faces:[
    {surface:{type:'plane',...frame},sameSense:false,loops:[[use(0,false)],[use(3,true)]],outer:[true,false]},
    {surface:{type:'plane',...frame,origin:[0,0,10]},sameSense:true,loops:[[use(1,true)],[use(4,false)]],outer:[true,false]},
    side(5,true,[use(0,true),use(2,true),use(1,false),use(2,false)]),
    side(2,false,[use(5,true),use(4,true),use(5,false),use(3,false)])]};
}

test('generic curved clip constructs axial and oblique cylinders with actual analytic caps and seams',()=>{
  const source=cylinder(),before=JSON.stringify(source);
  for(const [name,normal,kind] of [['axial',[0,0,1],'Circle'],['oblique',[-0.4,0,1],'Ellipse']]){
    const run=clip(source,[0,0,5],normal),[body]=checked(run,125*Math.PI,1);
    assert.ok(array(body.solid.edges).some(e=>e.curve.$===kind));
    assert.deepEqual([array(body.solid.vertices).length,array(body.solid.edges).length,array(body.solid.faces).length],[2,3,3]);
    exportRun(run,name);
  }
  assert.equal(JSON.stringify(source),before);
  assert.equal(clip(source,[0,0,-2],[0,0,1]).result.$,'Empty');
  checked(clip(source,[0,0,12],[0,0,1]),250*Math.PI,1);
});

test('generic global curve paves support longitudinal cuts, wrapped arcs and exact source seams',()=>{
  const c=1,r=5,area=Math.PI*r*r/2+c*Math.sqrt(r*r-c*c)+r*r*Math.asin(c/r);
  for(const [name,normal,volume] of [['longitudinal',[1,0,0],area*10],['longitudinal-reversed',[-1,0,0],(25*Math.PI-area)*10]]){
    const run=clip(cylinder(),[1,0,0],normal);checked(run,volume,1);exportRun(run,name);
  }
  const seam=clip(cylinder(),[0,0,0],[0,1,0]);checked(seam,125*Math.PI,1);exportRun(seam,'source-seam');
});

test('generic partial oblique construction keeps bounded ellipse arcs instead of full ellipses',()=>{
  const volume=(2/3)*24**1.5+25*Math.PI/2+Math.sqrt(24)+25*Math.asin(1/5);
  const run=clip(cylinder(),[0,0,1],[-1,0,1]),[body]=checked(run,volume,1);
  const edges=array(body.solid.edges),domains=array(body.domains);
  const ellipse=edges.findIndex(e=>e.curve.$==='Ellipse');assert.ok(ellipse>=0);
  assert.equal(domains[ellipse].domain.$,'Interval');assert.ok(number(domains[ellipse].domain.last)>2*Math.PI);
  exportRun(run,'partial-ellipse');
});

test('generic caps preserve annular holes and reconnect a bored cylinder after longitudinal clipping',()=>{
  const body=annularCylinder(),before=JSON.stringify(body),axial=clip(body,[0,0,5],[0,0,1]);
  const [result]=checked(axial,105*Math.PI,1);
  const cap=array(result.face_origins).findIndex(f=>f.$==='CutFace');
  assert.deepEqual(array(array(result.solid.faces)[cap].loops).map(l=>l.outer),[true,false]);
  exportRun(axial,'annular');
  const a=r=>Math.PI*r*r/2+Math.sqrt(r*r-1)+r*r*Math.asin(1/r),longitudinal=clip(body,[1,0,0],[1,0,0]);
  checked(longitudinal,(a(5)-a(2))*10,1);exportRun(longitudinal,'annular-longitudinal');
  assert.equal(JSON.stringify(body),before);
});

test('generic curved output is reusable with exact returned curve domains and immutable source objects',()=>{
  const first=clip(cylinder(),[0,0,5],[-0.4,0,1]),[a]=checked(first,125*Math.PI,1),before=JSON.stringify(a);
  const next=clip(a.solid,[1,0,0],[1,0,0],{domains:array(a.domains)});
  const disk=25*Math.PI/2+Math.sqrt(24)+25*Math.asin(1/5),moment=-(2/3)*24**1.5;
  checked(next,5*disk+0.4*moment,1);exportRun(next,'repeated');assert.equal(JSON.stringify(a),before);
});

test('the same curved constructor supports concave planar faces and multiple output components',()=>{
  const u=extrudeInBend(k,'U',[[0,0],[8,0],[8,6],[6,6],[6,2],[2,2],[2,6],[0,6]],frame,[0,0,4]);
  const run=clip(u,[0,3,0],[0,-1,0]);checked(run,48,2);exportRun(run,'U-components');
});

test('curved construction rejects malformed source, uncertain contacts and unsupported surfaces before shortcuts',()=>{
  const bad=structuredClone(cylinder()),faces=array(bad.faces);faces.at(-1).surface.x=vector([0,0,1]);bad.faces=list(faces);
  for(const h of [-2,5,12])assert.equal(clip(bad,[0,0,h],[0,0,1]).result.$,'Unresolved');
  for(const [origin,normal] of [[[5,0,0],[1,0,0]],[[0,0,0],[0,0,1]],[[5+1e-9,0,0],[1,0,0]]]){
    const result=clip(cylinder(),origin,normal).result;assert.equal(result.$,'Unresolved');assert.equal(result.solid,undefined);
  }
  const cone=k.analytic.frustum(vector([0,0,0]),vector([0,0,10]),vector([1,0,0]),real(5),real(3));
  assert.equal(clip(cone,[0,0,20],[0,0,1]).result.$,'Unresolved');
  assert.equal(clip(cylinder(),[0,0,5],[0,0,1],{inputTolerance:0.2}).result.reason.$,'SourceTolerance');
});

test('curved audit rejects wrong planar hole winding and surplus edge domains before shortcuts',()=>{
  const badHole=annularCylinder();
  for(const face of badHole.faces.slice(0,2))face.loops[1][0].forward=!face.loops[1][0].forward;
  const inner=badHole.faces[3];inner.sameSense=true;
  inner.loops[0]=inner.loops[0].toReversed().map(u=>({...u,forward:!u.forward}));
  for(const [body,options] of [[badHole,{}],[cylinder(),{domains:[null,null,null,null]}]]){
    for(const h of [-2,5,12]){
      const run=clip(body,[0,0,h],[0,0,1],options),p=run.prepared;
      assert.equal(O.audit(p.solid,p.domains,p.tolerance,p.sourceBudget).valid,false);
      assert.equal(run.result.$,'Unresolved');assert.equal(run.result.solid,undefined);
    }
  }
});

test('curved audit rejects the opposite double triangle zero-volume shell before Empty or contained shortcuts',async()=>{
  const source=(await booleanPortCases({imported:false})).find(c=>c.id==='zero-volume-shell').body;
  for(const h of [1,2,3]){
    const run=clip(source,[0,0,h],[0,0,1]),p=run.prepared;
    const audit=O.audit(p.solid,p.domains,p.tolerance,p.sourceBudget);
    assert.equal(number(audit.volume),0);assert.equal(audit.valid,false);
    assert.equal(run.result.$,'Unresolved');assert.equal(run.result.solid,undefined);
  }
});

test('public curved audit enforces the clip source-budget and query-tolerance gates',()=>{
  const p=classificationInput(cylinder(),k.faceClassifier),t=intersectionTolerance();
  assert.equal(O.audit(p.solid,p.domains,t,p.sourceBudget).valid,true);
  for(const budget of [-1e-12,0.10001,0.2,4]){
    const b=real(budget);
    assert.equal(O.audit(p.solid,p.domains,t,b).valid,false,`source budget ${budget}`);
    assert.equal(O.clip(p.solid,p.domains,vector([0,0,5]),vector([0,0,1]),t,b).$,'Unresolved');
  }
  for(const options of [{linear:0},{linear:-1},{angular:-1},{angular:0},{angular:1e-15},{angular:1}]){
    const invalid=intersectionTolerance(options);
    assert.equal(O.audit(p.solid,p.domains,invalid,p.sourceBudget).valid,false,JSON.stringify(options));
    assert.equal(O.clip(p.solid,p.domains,vector([0,0,5]),vector([0,0,1]),invalid,p.sourceBudget).$,'Unresolved');
  }
});

test('generic constructor clips both genuine frozen P10 top and right box planes with an explicit native budget audit',()=>{
  const bytes=readFileSync(new URL('../fixtures/r10b/modules/base/ZtoDD.body.json',import.meta.url));
  const sha=createHash('sha256').update(bytes).digest('hex');assert.equal(sha,'b78a8546970e360ee2a3a22661c87d4f9e835d24fe50cedeedde6a19add20dc9');
  const body=transformAnalytic(k,importOnshapeBody(k,JSON.parse(bytes).bodies[0],'curved-P10',{sha256:sha}),'curved-g0',
    [[1,0,0],[0,0.9063077870366499,-0.42261826174069944],[0,0.42261826174069944,0.9063077870366499]],[0,85.7915071334,-183.980480768]);
  const before=JSON.stringify(body),source=classificationInput(body,k.faceClassifier),originalVolume=number(O.volume(source.solid,source.domains));
  for(const [name,origin,normal,count] of [['r10b-plane-1',[0,0,68],[0,0,1],1],['r10b-plane-3',[-92.79000091552734,0,0],[1,0,0],2]]){
    const run=clip(body,origin,normal),parts=checked(run,undefined,count);
    assert.ok(parts.reduce((v,p)=>v+number(O.volume(p.solid,p.domains)),0)<originalVolume);
    exportRun(run,name);
  }
  assert.equal(JSON.stringify(body),before);
});

}
