import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("step-cylinder-pcurves.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { mkdirSync, writeFileSync } = await import("node:fs");
const { loadBend } = await import("../src/bend-loader.mjs");
const { loadKernel, array, list } = await import("../src/kernel.mjs");
const { classificationInput } = await import("../src/face-classification.mjs");
const { decodeAnalytic, encodeAnalytic } = await import("../src/analytic.mjs");
const { intersectionTolerance } = await import("../src/intersections.mjs");
const { real, number, vector } = await import("../src/real.mjs");
const { loadStepCylinderPCurves, cylinderPCurves } = await import("../src/step-cylinder-pcurves.mjs");











const [native, kernel, curved] = await Promise.all([
  loadStepCylinderPCurves(), loadKernel(), loadBend(new URL('../kernel/ports/curved.bend', import.meta.url)),
]);
const artifact = new URL('../out/step-pcurves/cylinder-focused/', import.meta.url);
mkdirSync(artifact, { recursive: true });
const evidence = [];
const near = (a, b, eps = 1e-12) => assert.ok(Math.abs(a-b) <= eps, `${a} != ${b}`);
const dot = (a,b) => a.reduce((sum,v,i)=>sum+v*b[i],0);
const sub = (a,b) => a.map((v,i)=>v-b[i]);
const mul = (a,s) => a.map(v=>v*s);
const add = (a,b) => a.map((v,i)=>v+b[i]);
const unit = a => mul(a,1/Math.hypot(...a));
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const frame = (axis,x) => { const z=unit(axis),u=unit(sub(x,mul(z,dot(x,z)))); return [z,u,cross(z,u)]; };
const cylinder = () => kernel.analytic.frustum(vector([0,0,0]),vector([0,0,10]),vector([1,0,0]),real(5),real(5));

function clip(body, origin, normal, domains) {
  const input=classificationInput(body,kernel.faceClassifier,{domains:domains&&array(domains)});
  const result=curved.clip(input.solid,input.domains,vector(origin),vector(normal),intersectionTolerance(),input.sourceBudget);
  assert.equal(result.$,'Clipped',result.reason?.$);
  return result;
}
function decode(result, id) {
  const body=decodeAnalytic(result.solid,id,kernel);
  array(result.domains).forEach((d,i)=>{if(d.$==='GivenDomain'&&d.domain.$==='Interval')body.edges[i].curveRange=[number(d.domain.first),number(d.domain.last)];});
  body.validation.volumeMm3=number(curved.volume(result.solid,result.domains));
  return body;
}
function partial() { return decode(clip(cylinder(),[0,0,1],[-1,0,1]),'partial'); }
function repeated() {
  const first=clip(cylinder(),[0,0,5],[-0.4,0,1]);
  return decode(clip(first.solid,[1,0,0],[1,0,0],first.domains),'repeated');
}
const use=(edge,forward)=>({edge,forward});
const circle=(r,z)=>({type:'circle',origin:[0,0,z],normal:[0,0,1],x:[1,0,0],radius:r});
const plane=(z,sameSense,loops,outer)=>({surface:{type:'plane',origin:[0,0,z],normal:[0,0,1],x:[1,0,0]},sameSense,loops,outer});
const side=(radius,sameSense,uses)=>({surface:{type:'cylinder',origin:[0,0,0],axis:[0,0,1],x:[1,0,0],radius},sameSense,loops:[uses],outer:[true]});
function stacked() {
  return {vertices:[[5,0,0],[5,0,5],[5,0,10]],edges:[0,5,10].map((z,i)=>({start:i,end:i,sameSense:true,curve:circle(5,z)})).concat([
    {start:0,end:1,sameSense:true,curve:{type:'line',origin:[5,0,0],direction:[0,0,1]},curveRange:[0,5]},
    {start:1,end:2,sameSense:true,curve:{type:'line',origin:[5,0,5],direction:[0,0,1]},curveRange:[0,5]},
  ]),faces:[plane(0,false,[[use(0,false)]],[true]),plane(10,true,[[use(2,true)]],[true]),
    side(5,true,[use(0,true),use(3,true),use(1,false),use(3,false)]),
    side(5,true,[use(1,true),use(4,true),use(2,false),use(4,false)])]};
}
function annular() {
  return {vertices:[[5,0,0],[5,0,10],[2,0,0],[2,0,10]],edges:[
    {start:0,end:0,sameSense:true,curve:circle(5,0)},{start:1,end:1,sameSense:true,curve:circle(5,10)},
    {start:0,end:1,sameSense:true,curve:{type:'line',origin:[5,0,0],direction:[0,0,1]},curveRange:[0,10]},
    {start:2,end:2,sameSense:true,curve:circle(2,0)},{start:3,end:3,sameSense:true,curve:circle(2,10)},
    {start:2,end:3,sameSense:true,curve:{type:'line',origin:[2,0,0],direction:[0,0,1]},curveRange:[0,10]},
  ],faces:[plane(0,false,[[use(0,false)],[use(3,true)]],[true,false]),plane(10,true,[[use(1,true)],[use(4,false)]],[true,false]),
    side(5,true,[use(0,true),use(2,true),use(1,false),use(2,false)]),
    side(2,false,[use(5,true),use(4,true),use(5,false),use(3,false)])]};
}

// Independent binary64 observations of native splines and the untouched source.
// This oracle never constructs or replaces production geometry.
function inspect(body,result) {
  assert.equal(result.status,'Resolved',JSON.stringify(result));
  let maximum=0;
  for(const chart of result.charts) {
    const face=body.faces[chart.faceIndex],surface=face.surface,[axis,x,y]=frame(surface.axis,surface.x);
    assert.equal(chart.pcurves.length,face.loops[0].length);
    for(const p of chart.pcurves) {
      const edge=body.edges[p.edgeIndex],curve=edge.curve,u=face.loops[p.loopIndex][p.useIndex];
      assert.equal(u.edge,p.edgeIndex);assert.equal(u.forward,p.forward);
      assert.equal(p.increasing,u.forward===edge.sameSense);
      assert.ok(Number.isInteger(p.periodLift));assert.ok(p.totalBoundMm<=1e-8);
      near(p.totalBoundMm,p.approximationBoundMm+p.supportBoundMm+p.normalizationBoundMm+p.numericGuardMm,1e-20);
      if(edge.curveRange)edge.curveRange.forEach((v,i)=>near([p.first,p.last][i],number(real(v)),1e-20));
      assert.equal(p.knots[0],p.first);assert.equal(p.knots.at(-1),p.last);
      const n=p.knots.length-1;
      assert.equal(p.points.length,p.degree*n+1);
      assert.deepEqual(p.multiplicities,[p.degree+1,...Array(n-1).fill(p.degree),p.degree+1]);
      for(let i=0;i<n;i++)for(const s of [0,0.25,0.5,0.75,1]) {
        const weights=p.degree===1?[1-s,s]:[(1-s)**3,3*(1-s)**2*s,3*(1-s)*s*s,s**3];
        const uv=[0,1].map(j=>weights.reduce((v,w,k)=>v+w*p.points[p.degree*i+k][j],0));
        const t=p.knots[i]+s*(p.knots[i+1]-p.knots[i]);
        const q=add(surface.origin,add(mul(axis,uv[1]),add(mul(x,surface.radius*Math.cos(uv[0])),mul(y,surface.radius*Math.sin(uv[0])))));
        let expected;
        if(curve.type==='line')expected=add(curve.origin,mul(curve.direction,t));
        else expected=add(curve.origin,add(mul(curve.x,(curve.radius??curve.major)*Math.cos(t)),mul(cross(curve.normal,curve.x),(curve.radius??curve.minor)*Math.sin(t))));
        const distance=Math.hypot(...sub(expected,q));maximum=Math.max(maximum,distance);
        assert.ok(distance<=p.totalBoundMm,`${curve.type} ${distance} exceeds ${p.totalBoundMm}`);
      }
    }
  }
  for(const edge of result.edges) {
    assert.ok(edge.associations.length>=1&&edge.associations.length<=2);
    const pc=edge.associations.map(ref=>result.charts.find(c=>c.faceIndex===ref.faceIndex).pcurves[ref.pcurveIndex]);
    assert.ok(pc.every(p=>p.edgeIndex===edge.edgeIndex));
    if(edge.kind==='Seam') {
      assert.equal(pc.length,2);assert.equal(edge.associations[0].faceIndex,edge.associations[1].faceIndex);
      assert.equal(pc[0].degree,1);assert.equal(pc[0].first,pc[1].first);assert.equal(pc[0].last,pc[1].last);
      assert.notEqual(pc[0].increasing,pc[1].increasing);assert.equal(pc[1].periodLift-pc[0].periodLift,1);
      pc[0].points.forEach((p,i)=>{near(pc[1].points[i][0]-p[0],2*Math.PI);near(pc[1].points[i][1],p[1]);});
    }
  }
  return maximum;
}
function verify(body,name,options) {
  const before=JSON.stringify(body),result=cylinderPCurves(native,body,options),maximum=inspect(body,result);
  assert.equal(JSON.stringify(body),before);
  evidence.push({name,charts:result.charts.length,edges:result.edges.length,maxObservedMm:maximum,maxTotalBoundMm:result.maxTotalBoundMm});
  writeFileSync(new URL(`${name}.cylinder-pcurves.json`,artifact),JSON.stringify(result,null,2)+'\n');
  const solid=encodeAnalytic(body),output=decodeAnalytic(solid,name,kernel);
  body.edges.forEach((edge,i)=>{if(edge.curveRange)output.edges[i].curveRange=[...edge.curveRange];});
  output.validation.volumeMm3=number(curved.volume(solid,classificationInput(body,kernel.faceClassifier).domains));
  writeFileSync(new URL(`${name}.brep.json`,artifact),JSON.stringify({schema:'wonky-brep/1',units:'millimeter',backend:{language:'Bend',version:'2.0.25'},bodies:[output]},null,2)+'\n');
  return result;
}

test('trimmed Circle/Ellipse/Line PCurves preserve negative and beyond-period natural domains',()=>{
  const a=partial();assert.ok(a.edges.some(e=>e.curveRange?.[1]>2*Math.PI));verify(a,'partial-ellipse');
  const b=repeated();
  for(const e of b.edges)if(e.curve.type!=='line')e.curveRange=e.curveRange.map(t=>t-2*Math.PI);
  else {e.curve.origin=sub(e.curve.origin,mul(e.curve.direction,7));e.curveRange=e.curveRange.map(t=>t+7);}
  verify(b,'negative-trims-line-offset');
  for(const e of b.edges)if(e.curve.type!=='line') {e.curve.normal=mul(e.curve.normal,-1);e.sameSense=!e.sameSense;e.curveRange=[-e.curveRange[1],-e.curveRange[0]];}
  verify(b,'reversed-curves');
});

test('native association lists distinguish a shared cylinder/cylinder edge from two seam uses',()=>{
  const body=stacked(),result=verify(body,'two-cylinder-faces');
  const shared=result.edges.find(e=>e.edgeIndex===1);
  assert.equal(shared.kind,'Ordinary');assert.deepEqual(shared.associations.map(a=>a.faceIndex),[2,3]);
  assert.equal(result.edges.filter(e=>e.kind==='Seam').length,2);
  for(const e of body.edges)if(e.curve.type==='line') {[e.start,e.end]=[e.end,e.start];e.sameSense=!e.sameSense;}
  for(const f of body.faces)for(const loop of f.loops)for(const u of loop)if(body.edges[u.edge].curve.type==='line')u.forward=!u.forward;
  verify(body,'reversed-seams');
});

test('inward cylindrical faces and native rigid transforms retain oriented chart associations',()=>{
  const body=annular(),result=verify(body,'inward-bore');assert.equal(result.charts.length,2);
  body.faces[3].surface.x=[0,1,0];verify(body,'inward-shifted-chart');
  const rotation={$:'Rotation',x:vector([0.8,0,-0.6]),y:vector([0,1,0]),z:vector([0.6,0,0.8])};
  const transformed=kernel.analytic.transform(encodeAnalytic(body),rotation,vector([19,-23,47]));
  const moved=decodeAnalytic(transformed,'moved',kernel);
  body.edges.forEach((e,i)=>{if(e.curveRange)moved.edges[i].curveRange=[...e.curveRange];});
  verify(moved,'inward-transformed');
});

test('GivenDomain Untrimmed is admitted only for genuinely closed conics; explicit full periods are rejected',()=>{
  const body=stacked(),domains=body.edges.map(e=>e.curve.type==='line'?{$:'AutoDomain'}:{$:'GivenDomain',domain:{$:'Untrimmed'}});
  verify(body,'explicit-untrimmed',{domains});
  body.edges[0].curveRange=[0,2*Math.PI];
  assert.equal(cylinderPCurves(native,body,{domains}).reason,'UnsupportedDomain');
  assert.equal(cylinderPCurves(native,body,{domains:list(body.edges.map(()=>({$:'AutoDomain'})))}).reason,'UnsupportedDomain');
  const open=partial(),choices=open.edges.map(()=>({$:'GivenDomain',domain:{$:'Untrimmed'}}));
  const nativeOpen=encodeAnalytic(open);
  assert.equal(cylinderPCurves(native,nativeOpen,{domains:choices}).reason,'UnsupportedDomain');
  assert.equal(cylinderPCurves(native,nativeOpen,{domains:choices.slice(1)}).reason,'UnsupportedDomain');
});

test('STEP normalization is separately bounded and cannot silently rescale line trims',()=>{
  const body=stacked();body.faces[2].surface.x=[1+4e-12,0,0];
  const result=verify(body,'frame-normalization');
  assert.ok(result.charts.find(c=>c.faceIndex===2).pcurves.every(p=>p.normalizationBoundMm>1e-12));
  const line=body.edges[3];line.curve.direction=mul(line.curve.direction,2);line.curveRange=line.curveRange.map(t=>t/2);
  const failure=cylinderPCurves(native,body);assert.equal(failure.status,'Unresolved');assert.equal(failure.reason,'ParameterMismatch');
  assert.ok(!('charts' in failure));
});

test('source budgets cannot enlarge PCurve allowance and body failures are atomic',()=>{
  const body=stacked();body.faces[3].surface.radius+=2e-6;
  const failure=cylinderPCurves(native,body,{inputTolerance:1e-3});
  assert.equal(failure.status,'Unresolved');assert.equal(failure.reason,'IncidenceFailure');assert.ok(!('charts' in failure));
  for(const budgetMm of [0,-1e-8,1e-7])assert.equal(cylinderPCurves(native,stacked(),{budgetMm}).reason,'InvalidInput');
  assert.equal(cylinderPCurves(native,stacked(),{budgetMm:1e-14}).reason,'ResolutionLimit');
  const fine=cylinderPCurves(native,partial(),{budgetMm:1e-9});inspect(partial(),fine);assert.ok(fine.maxTotalBoundMm<=1e-9);
  const invalid=stacked();invalid.faces[2].loops[0][0].forward=false;
  assert.equal(cylinderPCurves(native,invalid).reason,'InvalidSource');
  const twoLoops=stacked();twoLoops.edges=twoLoops.edges.slice(0,3);
  twoLoops.faces[2].loops=[[use(0,true)],[use(1,false)]];twoLoops.faces[2].outer=[true,false];
  twoLoops.faces[3].loops=[[use(1,true)],[use(2,false)]];twoLoops.faces[3].outer=[true,false];
  assert.equal(cylinderPCurves(native,twoLoops).reason,'UnsupportedLoops');
  const input=classificationInput(stacked(),kernel.faceClassifier);
  assert.equal(native.for_cylinders_domains(input.solid,input.domains,intersectionTolerance({angular:1e-15}),input.sourceBudget,real(1e-8)).reason.$,'InvalidInput');
});

test.after(()=>writeFileSync(new URL('evidence.json',artifact),JSON.stringify(evidence,null,2)+'\n'));

}
