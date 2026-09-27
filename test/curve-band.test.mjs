import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend() || missing("fixtures/r10b/modules/base/ZtoDD.body.json", "fixtures/r10b/r10b.fs");
if (publicTreeSkip) {
  test("curve-band.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { existsSync, mkdirSync, readFileSync, writeFileSync } = await import("node:fs");
const { createHash } = await import("node:crypto");
const { loadKernel, array, extrudeInBend } = await import("../src/kernel.mjs");
const { real, number, vector, coords } = await import("../src/real.mjs");
const { encodeAnalytic, importOnshapeBody, transformAnalytic } = await import("../src/analytic.mjs");
const { geometryRevision } = await import("../src/identity.mjs");
const { curvePlaneCurve } = await import("../src/curve-plane.mjs");
const { classificationInput, loadFaceClassifier } = await import("../src/face-classification.mjs");
const { loadEdgePlane, intersectEdgePlane } = await import("../src/edge-plane.mjs");
const { intersectionTolerance } = await import("../src/intersections.mjs");
const { boundCurvePlaneBand, boundEdgePlaneBand, loadCurveBand, requireResolvedCurveBand } = await import("../src/curve-band.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");















const plane=(origin=[0,0,0],normal=[0,0,1])=>({type:'plane',origin,normal});
const line=(origin=[0,0,0],direction=[1,0,0])=>({type:'line',origin,direction});
const circle=(radius=1,origin=[0,0,0])=>({type:'circle',origin,normal:[0,0,1],x:[1,0,0],radius});
const ellipse=(major=2,minor=1,origin=[0,0,0])=>({type:'ellipse',origin,normal:[0,0,1],x:[1,0,0],major,minor});
const near=(a,b,eps=1e-10)=>assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);
const nearPoint=(a,b,eps=1e-10)=>a.forEach((v,i)=>near(v,b[i],eps));
const resolved=(result,kind)=>{
  assert.equal(result.$,'Resolved',JSON.stringify({kind:result.$,reason:result.reason}));
  if(kind)assert.equal(result.relation.$,kind);return result.evidence;
};
const rejected=(result,reason)=>{assert.equal(result.$,'Rejected');assert.equal(result.reason.$,reason);};
const limits=evidence=>[number(evidence.minimum.signed_distance),number(evidence.maximum.signed_distance)];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const unit=v=>v.map(x=>x/Math.hypot(...v));
const at=(curve,t)=>curve.type==='line'?curve.origin.map((v,i)=>v+curve.direction[i]*t):curve.origin.map((v,i)=>
  v+(curve.radius??curve.major)*curve.x[i]*Math.cos(t)+(curve.radius??curve.minor)*cross(curve.normal,curve.x)[i]*Math.sin(t));
const signed=(point,cut)=>dot(point.map((v,i)=>v-cut.origin[i]),unit(cut.normal));

test('finite lines retain native endpoints and signed bounds under an explicit independent cap',async()=>{
  const curve=line([0,0,0.002],[2,1,0.003]),cut=plane([0,0,0],[0,0,7]);
  const result=await boundCurvePlaneBand(curve,cut,{interval:[-2,3],contactTolerance:0.02,sourceTolerance:0.001});
  const e=resolved(result,'ToleratedBand');nearPoint(limits(e),[-0.004,0.011]);near(number(e.max_absolute),0.011);
  near(number(e.minimum.parameter),-2);near(number(e.maximum.parameter),3);assert.equal(e.certificate.$,'NotCertified');
  nearPoint(coords(e.minimum.point),at(curve,-2));nearPoint(coords(e.maximum.point),at(curve,3));
  near(number(e.source.source_allowance),0.001);near(number(e.contact_tolerance),0.02);assert.equal(e.source.edge.$,'None');
  const opposite=resolved(await boundCurvePlaneBand(curve,plane([0,0,0],[0,0,-7]),{interval:[-2,3],contactTolerance:0.02}),'ToleratedBand');
  nearPoint(limits(opposite),[-0.011,0.004]);near(number(opposite.minimum.parameter),3);
  resolved(await boundCurvePlaneBand(curve,cut,{interval:[-2,3],contactTolerance:0.005,sourceTolerance:0.1}),'ExceedsBand');
  // Tiny supporting-line slope does not prove the whole finite interval is close.
  const long=resolved(await boundCurvePlaneBand(line([0,0,0],[1,0,1e-10]),cut,{interval:[0,1e8],contactTolerance:1e-7}),'ExceedsBand');
  nearPoint(limits(long),[0,0.01]);
  assert.equal(requireResolvedCurveBand(result),result);
  await assert.rejects(boundCurvePlaneBand(curve,cut,{interval:[0,1]}),/explicit.*contactTolerance/);
});

test('threshold ambiguity is explicit and source allowance never enlarges contactTolerance',async()=>{
  const curve=line([0,0,0.002]),cut=plane(),cap=0.002;
  const uncertain=await boundCurvePlaneBand(curve,cut,{interval:[0,1],contactTolerance:cap});
  assert.equal(uncertain.$,'Unresolved');assert.equal(uncertain.reason.$,'Threshold');
  const e=uncertain.reason.evidence;nearPoint(limits(e),[cap,cap]);assert.ok(number(e.arithmetic_guard)>0);
  assert.throws(()=>requireResolvedCurveBand(uncertain),UnsupportedFeatureError);
  resolved(await boundCurvePlaneBand(curve,cut,{interval:[0,1],contactTolerance:cap+1e-8}),'ToleratedBand');
  resolved(await boundCurvePlaneBand(curve,cut,{interval:[0,1],contactTolerance:cap-1e-8,sourceTolerance:0.1}),'ExceedsBand');
  const exact=resolved(await boundCurvePlaneBand(line(),cut,{interval:[0,1],contactTolerance:0}),'ExactCurveInPlane');
  assert.equal(exact.certificate.$,'ExactZeroCoefficients');nearPoint(limits(exact),[0,0]);
});

test('circle and ellipse bounds include interior extrema, full periods, negative ranges and periodic wraps',async()=>{
  const cut=plane([0,0,0],[1,0,0]);
  const full=resolved(await boundCurvePlaneBand(circle(0.03),cut,{contactTolerance:0.04}),'ToleratedBand');
  nearPoint(limits(full),[-0.03,0.03]);near(number(full.minimum.parameter),Math.PI);near(number(full.maximum.parameter),0);
  assert.equal(full.minimum.position.$,'StationaryMinimum');assert.equal(full.maximum.position.$,'StationaryMaximum');
  const half=resolved(await boundCurvePlaneBand(circle(0.03),cut,{interval:[-Math.PI/2,Math.PI/2],contactTolerance:0.02}),'ExceedsBand');
  assert.ok(Math.abs(signed(at(circle(0.03),-Math.PI/2),cut))<1e-15);
  near(number(half.maximum.signed_distance),0.03);near(number(half.maximum.parameter),0);
  for(const interval of [[5,7],[-7,-5],[0.3,1.2],[-20,-15]]){
    const e=resolved(await boundCurvePlaneBand(circle(0.03),cut,{interval,contactTolerance:0.04}),'ToleratedBand');
    const parameters=[...interval];for(let k=-8;k<=8;k++)if(k*Math.PI>=interval[0]&&k*Math.PI<=interval[1])parameters.push(k*Math.PI);
    const distances=parameters.map(t=>0.03*Math.cos(t));nearPoint(limits(e),[Math.min(...distances),Math.max(...distances)]);
    for(const bound of [e.minimum,e.maximum])assert.ok(number(bound.parameter)>=number(e.source.domain.first)&&number(bound.parameter)<=number(e.source.domain.last));
  }
  const c=ellipse(0.04,0.015,[0.001,-0.002,0.003]),oblique=plane([0,0,0],[3,4,0]);
  const e=resolved(await boundCurvePlaneBand(c,oblique,{contactTolerance:0.05}),'ToleratedBand');
  const amplitude=Math.hypot(0.04*3/5,0.015*4/5),offset=(3*0.001-4*0.002)/5;
  nearPoint(limits(e),[offset-amplitude,offset+amplitude]);
  for(const extreme of [e.minimum,e.maximum])near(signed(coords(extreme.point),oblique),number(extreme.signed_distance));
  const constant=resolved(await boundCurvePlaneBand(c,plane(),{contactTolerance:0.01}),'ToleratedBand');
  nearPoint(limits(constant),[0.003,0.003]);assert.equal(constant.minimum.position.$,'ConstantRepresentative');
});

test('exact certificates use original coefficients and do not promote rounded-zero dot products',async()=>{
  const k=await loadKernel(),e=2**-40,n=[1,1+e,0],direction=[1+2*e,-(1+e),0];
  assert.equal(number(k.precise.dot(vector(n),vector(direction))),0);
  // The exact represented polynomial is (1+2e) - (1+e)^2 = -e^2.
  const inexact=resolved(await boundCurvePlaneBand(line([0,0,0],direction),plane([0,0,0],n),{interval:[0,2],contactTolerance:1e-7}),'ToleratedBand');
  assert.equal(inexact.certificate.$,'NotCertified');
  const zeroCap=await boundCurvePlaneBand(line(direction,[0,0,1]),plane([0,0,0],n),{interval:[0,2],contactTolerance:0});
  assert.equal(zeroCap.$,'Unresolved');assert.equal(zeroCap.reason.$,'Threshold');assert.equal(zeroCap.reason.evidence.certificate.$,'NotCertified');
  const round=resolved(await boundCurvePlaneBand(ellipse(0.04,0.015),plane(),{contactTolerance:0}),'ExactCurveInPlane');
  assert.equal(round.certificate.$,'ExactZeroCoefficients');
  // A is exactly zero. B uses the original triple product times radius: -r*e^3,
  // while dot(planeNormal, roundedCross(curveNormal,x)) rounds to zero.
  const c={...circle(0.03),normal:[1+e,e,0],x:[0,0,1]},pn=[1+2*e,e+e*e,0];
  assert.equal(number(k.precise.dot(vector(pn),k.precise.cross(vector(c.normal),vector(c.x)))),0);
  const crossCase=await boundCurvePlaneBand(c,plane([0,0,0],pn),{contactTolerance:1e-7});
  assert.ok(crossCase.$!=='Resolved'||crossCase.relation.$!=='ExactCurveInPlane');
  if(crossCase.$==='Resolved')assert.equal(crossCase.evidence.certificate.$,'NotCertified');
  else {assert.equal(crossCase.$,'Unresolved');assert.equal(crossCase.reason.$,'CoefficientConditioning');}
});

test('translated and tilted round intervals agree with independent analytic double extrema',async()=>{
  let state=49271;const random=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/2**32);
  for(let i=0;i<48;i++){
    const normal=unit([random()-0.5,random()-0.5,random()-0.5]),x=unit(cross(normal,Math.abs(normal[0])<0.8?[1,0,0]:[0,1,0]));
    const c={...ellipse(1+random()*4,0.2+random()),normal,x,origin:[random()*30,random()*30,random()*30]};
    const cut=plane([random()*30,random()*30,random()*30],[random()-0.5,random()-0.5,random()-0.5]);
    const first=-20+random()*35,last=first+0.1+random()*6,parameters=[first,last],u=unit(cut.normal);
    const phase=Math.atan2(c.minor*dot(u,cross(normal,x)),c.major*dot(u,x));
    for(let j=-5;j<=5;j++)for(const p of [phase+2*j*Math.PI,phase+(2*j+1)*Math.PI])if(p>=first&&p<=last)parameters.push(p);
    const expected=parameters.map(p=>signed(at(c,p),cut));
    const result=await boundCurvePlaneBand(c,cut,{interval:[first,last],contactTolerance:0.1});
    const e=resolved(result);nearPoint(limits(e),[Math.min(...expected),Math.max(...expected)],1e-9);
    for(const extreme of [e.minimum,e.maximum])near(signed(coords(extreme.point),cut),number(extreme.signed_distance),1e-9);
    assert.ok(number(e.arithmetic_guard)>0);
  }
});

test('rigid transforms preserve native curve and cutting-plane words and distance bounds',async()=>{
  const k=await loadKernel(),rotation={$:'Rotation',x:vector([0.8,0,-0.6]),y:vector([0,1,0]),z:vector([0.6,0,0.8])},offset=vector([29,-17,83]);
  const c=curvePlaneCurve(ellipse(0.04,0.015,[0.001,-0.002,0.003]));
  const native=k.analytic.curve_transform(c,rotation,offset),cut={origin:k.analytic.point_transform(vector([0,0,0]),rotation,offset),normal:k.precise.rotate(vector([3,4,0]),rotation)};
  const interval={$:'Interval',first:real(-1.123456789),last:real(4.876543211)};
  const e=resolved(await boundCurvePlaneBand(native,cut,{interval,contactTolerance:0.05,sourceTolerance:0.01}),'ToleratedBand');
  assert.deepEqual(e.source.curve,native);assert.deepEqual(e.source.domain,interval);assert.deepEqual(e.source.plane_origin,cut.origin);assert.deepEqual(e.source.plane_normal,cut.normal);
  const amplitude=Math.hypot(0.04*3/5,0.015*4/5),center=-0.001;
  nearPoint(limits(e),[center-amplitude,center+amplitude]);
});

test('native edge preparation retains source vertices, senses, domains and words without moving them',async()=>{
  const k=await loadKernel(),curve=line([0.123456789,0,0.00001],[0.234567891,0,0]);
  const body={vertices:[at(curve,1),at(curve,5)],edges:[{start:1,end:0,sameSense:false,curve,curveRange:[1,5]}],faces:[]};
  body.vertices[0][2]+=1e-5;body.vertexTolerancesMm=[0.0003,0.0003];
  const native=encodeAnalytic(body),before=structuredClone(native),cut=plane();
  const result=await boundEdgePlaneBand(native,0,{origin:vector(cut.origin),normal:vector(cut.normal)},
    {domains:[{$:'Interval',first:real(1),last:real(5)}],contactTolerance:0.00002,inputTolerance:0.0003});
  const e=resolved(result,'ToleratedBand'),source=e.source.edge.value;
  assert.equal(source.index,0);assert.deepEqual(source.edge,array(native.edges)[0]);assert.deepEqual(source.start,array(native.vertices)[1]);
  assert.deepEqual(source.end,array(native.vertices)[0]);nearPoint(limits(e),[1e-5,1e-5]);
  assert.ok(number(source.endpoint_error)>0);assert.deepEqual(native,before);
  const direct=await intersectEdgePlane(body,0,cut);assert.equal(direct.$,'Unresolved');
  const inPlane={vertices:[[0,0,1e-5],[1,0,0]],edges:[{start:0,end:1,sameSense:true,curve:line()}],faces:[],vertexTolerancesMm:[0.0003,0.0003]};
  const certified=resolved(await boundEdgePlaneBand(inPlane,0,cut,{contactTolerance:0}),'ExactCurveInPlane');
  near(coords(certified.source.edge.value.start)[2],1e-5);near(number(certified.max_absolute),0);
  assert.equal((await intersectEdgePlane(inPlane,0,cut)).$,'Unresolved');
  const box=extrudeInBend(k,'curve-band-F32',[[0,0],[8,0],[8,6],[0,6]],{origin:[0,0,0],normal:[0,0,1],x:[1,0,0]},[0,0,4]);
  const f32=resolved(await boundEdgePlaneBand(box,0,plane([0,0,1e-5]),{contactTolerance:1e-4}),'ToleratedBand');
  nearPoint([number(f32.source.domain.first),number(f32.source.domain.last)],[0,1]);nearPoint(limits(f32),[-1e-5,-1e-5]);
});

test('raw malformed geometry, frames, domains, policy words and finite source topology fail closed',async()=>{
  const cut=plane(),opts={interval:[0,1],contactTolerance:1e-7};
  for(const c of [line([0,0,0],[0,0,0]),{...circle(),normal:[0,0,2]},{...circle(),x:[2,0,0]},{...circle(),x:[0,0,1]},circle(0),ellipse(2,-1)])
    rejected(await boundCurvePlaneBand(c,cut,opts),'InvalidGeometry');
  for(const normal of [[0,0,0],[0,0,1e-13],[0,0,1e11]])rejected(await boundCurvePlaneBand(line(),plane([0,0,0],normal),opts),'InvalidGeometry');
  for(const interval of [undefined,[1,0],[1,1],[0,1e11]])rejected(await boundCurvePlaneBand(line(),cut,{...opts,interval}),'InvalidDomain');
  for(const interval of [[0,2*Math.PI],[-30,-29]])rejected(await boundCurvePlaneBand(circle(),cut,{...opts,interval}),'InvalidDomain');
  for(const contactTolerance of [-1,0.11,{$:'Real',hi:0,lo:1}])rejected(await boundCurvePlaneBand(line(),cut,{...opts,contactTolerance}),'InvalidContactTolerance');
  rejected(await boundCurvePlaneBand(line(),cut,{...opts,sourceTolerance:-1e-5}),'InvalidSourceAllowance');
  const malformed=curvePlaneCurve(circle());malformed.x.x={$:'Real',hi:0,lo:1};
  rejected(await boundCurvePlaneBand(malformed,cut,opts),'InvalidGeometry');
  const B=await loadCurveBand();
  rejected(B.bound(curvePlaneCurve(line()),{$:'Interval',first:{$:'Real',hi:0,lo:1},last:real(2)},vector([0,0,0]),vector([0,0,1]),real(0.01),real(0)),'InvalidDomain');
  const body={vertices:[[0,0,0],[1,0,0]],edges:[{start:0,end:1,sameSense:true,curve:line()}],faces:[]};
  const malformedBody=structuredClone(body);delete malformedBody.edges[0].sameSense;
  await assert.rejects(boundEdgePlaneBand(malformedBody,0,cut,{contactTolerance:1e-7}),TypeError);
  rejected(await boundEdgePlaneBand(body,100,cut,{contactTolerance:1e-7}),'EdgeRejected');
  rejected(await boundEdgePlaneBand(body,0,cut,{contactTolerance:1e-7,angular:1e-14}),'InvalidPreparationTolerance');
  await assert.rejects(boundEdgePlaneBand(body,0,cut),/explicit.*contactTolerance/);
});

test('fresh frozen P10 and actual box keep 21 whole-interval band cases separate from 21 endpoint cases',async()=>{
  const root=new URL('../',import.meta.url),read=path=>readFileSync(new URL(path,root));
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  const frozen={
    'fixtures/r10b/r10b.fs':'219ee9630f37f9e54fe7e1b4e09094ab25748a811ed8f9e8b9ebf4892d8b8349',
    'fixtures/r10b/modules/base/ZtoDD.body.json':'b78a8546970e360ee2a3a22661c87d4f9e835d24fe50cedeedde6a19add20dc9',
  };
  for(const [path,expected] of Object.entries(frozen))assert.equal(hash(read(path)),expected,path);
  const implementationPaths=[
    'bend.lock.json','kernel/curve-band.bend','kernel/edge-plane.bend','kernel/curve-plane.bend',
    'kernel/face-classification.bend','kernel/intersections.bend','kernel/real.bend','kernel/precise.bend',
    'kernel/analytic.bend','kernel/topology.bend','kernel/geometry.bend','kernel/identity.bend',
    'src/curve-band.mjs','src/edge-plane.mjs','src/curve-plane.mjs','src/face-classification.mjs',
    'src/intersections.mjs','src/real.mjs','src/kernel.mjs','src/analytic.mjs','src/identity.mjs','src/bend-loader.mjs',
    'test/curve-band.test.mjs',
  ];
  const implementation=()=>Object.fromEntries(implementationPaths.sort().map(path=>[path,hash(read(path))]));
  // Retain only pair identifiers/reasons from the junction report, so ordinary
  // regression tests also run in a fresh checkout without generated artifacts.
  const selection=[
    {name:'p10EdgesAgainstBoxPlanes',sourceBody:0,targetBody:1,face:2,
      endpoint:[1,2,3,49,55,57,59,63,66,79,81,374,377,380,493,495,505],
      parallel:[52,56,58,62,67,80,378,379,497,498,501,503],coincident:[40,41,60,267,500]},
    {name:'boxEdgesAgainstP10Planes',sourceBody:1,targetBody:0,face:4,
      endpoint:[1,3,5,7],parallel:[0,4,8,9],coincident:[]},
  ].map(({endpoint,parallel,coincident,...direction})=>({...direction,rows:[
    ...endpoint.map(edge=>({edge,reason:'EndpointAmbiguity'})),...parallel.map(edge=>({edge,reason:'NearParallel'})),
    ...coincident.map(edge=>({edge,reason:'NearCoincidence'})),
  ].sort((a,b)=>a.edge-b.edge)}));
  const before=implementation(),basisPath='out/junction/diagnostic.json';
  const basisBytes=existsSync(new URL(basisPath,root))?read(basisPath):null,basis=basisBytes&&JSON.parse(basisBytes);
  const k=await loadKernel(),B=await loadCurveBand(),E=await loadEdgePlane(),F=await loadFaceClassifier();
  const imported=importOnshapeBody(k,JSON.parse(read('fixtures/r10b/modules/base/ZtoDD.body.json')).bodies[0],
    'curve-band-P10',{source:'frozen interval-band regression',sha256:frozen['fixtures/r10b/modules/base/ZtoDD.body.json']});
  const reconstruction={
    rows:[[1,0,0],[0,0.9063077870366499,-0.42261826174069944],[0,0.42261826174069944,0.9063077870366499]],
    offset:[0,85.7915071334,-183.980480768],boxPoints:[[-119,4],[-92.79,4],[-92.79,46],[-119,46]],
    boxPlane:{origin:[0,0,-61],normal:[0,0,1],x:[1,0,0]},boxDelta:[0,0,129],
  };
  const p10=transformAnalytic(k,imported,'curve-band-g0',reconstruction.rows,reconstruction.offset);
  const box=extrudeInBend(k,'curve-band-box',reconstruction.boxPoints,reconstruction.boxPlane,reconstruction.boxDelta);
  assert.equal(box.faces[3].surface.origin[0],-92.79000000000002);
  assert.deepEqual([p10.vertices.length,p10.edges.length,p10.faces.length],[348,529,189]);
  const bodies=[p10,box],inputs=bodies.map(body=>classificationInput(body,F));
  // The artifact's source words are compared only while it was built from the same geometry: the
  // 2026-09-22 report predates the F32x2 polygon prism (W2), whose box differs in its low words.
  const sameGeometry=basis?.geometry?.length===bodies.length&&basis.geometry.every((g,i)=>g.revision===geometryRevision(bodies[i]));
  const policy={contactTolerance:1e-7},tolerance={linear:1e-7,angular:1e-10},nativeTolerance=intersectionTolerance(tolerance);
  const counts={originalUnresolved:0,intervalCases:0,endpointCasesExcluded:0,nearParallel:0,nearCoincidence:0,toleratedBand:0,exactCurveInPlane:0,exceedsBand:0,unresolvedBand:0,rejectedBand:0};
  const maxima={absoluteDistanceMm:0,arithmeticGuardMm:0,independentBoundsDifferenceMm:0,sourceAllowanceMm:0};
  const directions=[];
  for(const direction of selection){
    const {name,sourceBody,targetBody}=direction,input=inputs[sourceBody],edges=array(input.solid.edges),domains=array(input.domains);
    const previousDirection=basis?.directions.find(d=>d.name===name);
    if(previousDirection)assert.equal(previousDirection.rows.length,direction.rows.length);
    const intervals=[],endpointsExcluded=[];
    for(const selected of direction.rows){
      const {edge}=selected,face=direction.face,cut=bodies[targetBody].faces[face].surface,origin=vector(cut.origin),normal=vector(cut.normal);
      const previous=previousDirection?.rows.find(row=>row.edge===edge&&row.face===face);
      const original=E.intersect(input.solid,edge,input.domains,origin,normal,nativeTolerance,input.sourceBudget);
      const expectedReason=selected.reason==='EndpointAmbiguity'?{$:'EndpointAmbiguity'}:{$:'CurveUnresolved',reason:{$:selected.reason}};
      assert.equal(original.$,'Unresolved');assert.deepEqual(original.reason,expectedReason);
      if(previousDirection)assert.deepEqual(original,previous.originalFiniteEdgeResult);
      counts.originalUnresolved++;
      const preparation=E.prepare_edge({$:'Some',value:edges[edge]},edge,input.solid.vertices,domains[edge]??{$:'AutoDomain'},origin,nativeTolerance,input.sourceBudget);
      assert.equal(preparation.$,'Prepared');if(previous&&sameGeometry)assert.deepEqual(preparation.source,previous.source);
      const references={sourceBody,edge,targetBody,face};
      if(original.reason.$==='EndpointAmbiguity'){
        if(previous)assert.equal(previous.intervalPolicyRequired,false);counts.endpointCasesExcluded++;
        endpointsExcluded.push({references,originalFiniteEdgeResult:original,source:preparation.source,
          reason:'Endpoint cases are outside this whole-interval diagnostic; no band result or overlap permission is inferred.'});
        continue;
      }
      if(previous)assert.equal(previous.intervalPolicyRequired,true);assert.equal(original.reason.$,'CurveUnresolved');
      const reason=original.reason.reason.$;assert.ok(['NearParallel','NearCoincidence'].includes(reason));
      counts[reason==='NearParallel'?'nearParallel':'nearCoincidence']++;counts.intervalCases++;
      const result=B.bound_edge(input.solid,edge,input.domains,origin,normal,nativeTolerance,real(policy.contactTolerance),input.sourceBudget);
      const e=resolved(result,'ToleratedBand');counts.toleratedBand++;
      assert.equal(e.certificate.$,'NotCertified');assert.deepEqual(e.source.edge.value,preparation.source);
      assert.deepEqual(e.source.curve,edges[edge].curve);assert.equal(e.source.edge.value.index,edge);
      assert.equal(e.source.domain.$,'Interval');assert.equal(e.source.curve.$,'Line');
      const curve={type:'line',origin:coords(e.source.curve.origin),direction:coords(e.source.curve.direction)};
      const ends=[number(e.source.domain.first),number(e.source.domain.last)],distances=ends.map(parameter=>signed(at(curve,parameter),cut));
      const referenceBounds=[Math.min(...distances),Math.max(...distances)],actualBounds=limits(e);
      const error=Math.max(...actualBounds.map((v,i)=>Math.abs(v-referenceBounds[i])));
      assert.ok(error<number(e.arithmetic_guard));assert.ok(number(e.max_absolute)+number(e.arithmetic_guard)<=policy.contactTolerance);
      maxima.absoluteDistanceMm=Math.max(maxima.absoluteDistanceMm,number(e.max_absolute));
      maxima.arithmeticGuardMm=Math.max(maxima.arithmeticGuardMm,number(e.arithmetic_guard));
      maxima.independentBoundsDifferenceMm=Math.max(maxima.independentBoundsDifferenceMm,error);
      maxima.sourceAllowanceMm=Math.max(maxima.sourceAllowanceMm,number(e.source.source_allowance));
      assert.deepEqual(E.intersect(input.solid,edge,input.domains,origin,normal,nativeTolerance,input.sourceBudget),original);
      intervals.push({references,originalFiniteEdgeResult:original,band:result,independentDoubleBoundsMm:referenceBounds,independentDifferenceMm:error});
    }
    directions.push({name,sourceBody,targetBody,intervals,endpointsExcluded});
  }
  assert.deepEqual(counts,{originalUnresolved:42,intervalCases:21,endpointCasesExcluded:21,nearParallel:16,nearCoincidence:5,toleratedBand:21,exactCurveInPlane:0,exceedsBand:0,unresolvedBand:0,rejectedBand:0});
  const after=implementation();assert.deepEqual(after,before,'Relevant implementation changed during the diagnostic');
  for(const [path,expected] of Object.entries(frozen))assert.equal(hash(read(path)),expected,path);
  const report={schema:'wonky-curve-band-diagnostic/1',createdAt:new Date().toISOString(),
    scope:'Analytic whole-interval plane-band checks only. No edge overlap, junction permission, trimmed-face incidence, clipping or Boolean result. All 42 original finite-edge intersections remain unresolved.',
    inputs:frozen,pairBasis:{path:basisPath,sha256:basisBytes?hash(basisBytes):null,
      originalSelectionSha256:'c21e1504e19f1a2250d59c7e3505ca7118bf6bd5f95311ded251b90f2663c2e6',
      retainedIn:'test/curve-band.test.mjs',use:'Pair indices/reasons only; geometry imported and transformed afresh. Compare native source records with the report when it is available.'},
    implementation:{stable:true,sha256:hash(JSON.stringify(before)),files:before},
    geometry:bodies.map((body,id)=>({id,name:id===0?'P10 g0':'F32 clipping box',revision:geometryRevision(body),vertices:body.vertices.length,edges:body.edges.length,faces:body.faces.length})),
    reconstruction,preparationTolerance:tolerance,policy,
    sourceAllowancePolicy:'Retained separately for finite-edge preparation; never added to contactTolerance or used as a coincidence certificate.',
    counts,maxima,directions};
  if(process.env.CURVE_BAND_REPORT==='1'){
    mkdirSync(new URL('out/curve-band/',root),{recursive:true});
    writeFileSync(new URL('out/curve-band/diagnostic.json',root),`${JSON.stringify(report,null,2)}\n`);
  }
});

}
