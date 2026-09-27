import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend() || missing("fixtures/r10b/modules/base/ZtoDD.body.json", "fixtures/r10b/r10b.fs");
if (publicTreeSkip) {
  test("face-plane.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { readFileSync } = await import("node:fs");
const { createHash } = await import("node:crypto");
const { loadKernel, array, extrudeInBend } = await import("../src/kernel.mjs");
const { real, number, vector, coords } = await import("../src/real.mjs");
const { encodeAnalytic, importOnshapeBody, transformAnalytic } = await import("../src/analytic.mjs");
const { intersectFacePlane, requireResolvedFacePlane } = await import("../src/face-plane.mjs");
const { intersectEdgePlane } = await import("../src/edge-plane.mjs");
const { classifyPlanarFace } = await import("../src/face-classification.mjs");
const { classifyCylinderFace } = await import("../src/cylinder-classification.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");













const planar=()=>({vertices:[],edges:[],faces:[{surface:{type:'plane',origin:[0,0,0],normal:[0,0,1],x:[1,0,0]},sameSense:true,loops:[],outer:[]}]});
const cylinder=()=>({vertices:[],edges:[],faces:[{surface:{type:'cylinder',origin:[0,0,0],axis:[0,0,1],x:[1,0,0],radius:5},sameSense:true,loops:[],outer:[]}]});
const plane=(origin,normal)=>({type:'plane',origin,normal});
const near=(a,b,eps=1e-9)=>assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);
const nearPoint=(a,b,eps=1e-9)=>a.forEach((v,i)=>near(v,b[i],eps));
function line(body,start,end){
  const a=body.vertices[start],b=body.vertices[end],index=body.edges.length;
  body.edges.push({start,end,sameSense:true,curve:{type:'line',origin:a,direction:b.map((v,i)=>v-a[i])}});return index;
}
function polygon(body,points,outer=true){
  const v=body.vertices.length,e=body.edges.length;body.vertices.push(...points.map(p=>p.length===2?[...p,0]:p));
  points.forEach((_,i)=>line(body,v+i,v+(i+1)%points.length));
  body.faces[0].loops.push(points.map((_,i)=>({edge:e+i,forward:true})));body.faces[0].outer.push(outer);
}
const circle=(radius,z=0)=>({type:'circle',origin:[0,0,z],normal:[0,0,1],x:[1,0,0],radius});
function round(body,radius,outer=true){
  const v=body.vertices.length,e=body.edges.length;body.vertices.push([radius,0,0]);
  body.edges.push({start:v,end:v,sameSense:true,curve:circle(radius)});
  body.faces[0].loops.push([{edge:e,forward:true}]);body.faces[0].outer.push(outer);
}
const cp=(t,z)=>[5*Math.cos(t),5*Math.sin(t),z];
function panel(body,first,last,low,high,outer=true){
  const v=body.vertices.length,e=body.edges.length;body.vertices.push(cp(first,low),cp(last,low),cp(last,high),cp(first,high));
  body.edges.push({start:v,end:v+1,sameSense:true,curve:circle(5,low),curveRange:[first,last]});line(body,v+1,v+2);
  body.edges.push({start:v+2,end:v+3,sameSense:false,curve:circle(5,high),curveRange:[first,last]});line(body,v+3,v);
  body.faces[0].loops.push([0,1,2,3].map(i=>({edge:e+i,forward:true})));body.faces[0].outer.push(outer);
}
function band(){
  const body=cylinder();body.vertices.push([5,0,0],[5,0,10]);
  body.edges.push({start:0,end:0,sameSense:true,curve:circle(5)},{start:1,end:1,sameSense:true,curve:circle(5,10)});line(body,0,1);
  body.faces[0].loops.push([{edge:0,forward:true},{edge:2,forward:true},{edge:1,forward:false},{edge:2,forward:false}]);body.faces[0].outer.push(true);return body;
}
const resolved=(result,count,relation=count?'Transverse':'Empty')=>{
  assert.equal(result.$,'Resolved',JSON.stringify(result));assert.equal(result.relation.$,relation);
  const sections=array(result.sections);assert.equal(sections.length,count);return sections;
};

test('planar sections preserve finite native line intervals, edge hits and F32 source parameters',async()=>{
  const body=planar();polygon(body,[[0,0],[8,0],[8,6],[0,6]]);
  const cut=plane([2,0,0],[1,0,0]),result=await intersectFacePlane(body,0,cut),[section]=resolved(result,1);
  nearPoint(coords(section.first.point),[2,0,0]);nearPoint(coords(section.last.point),[2,6,0]);
  near(number(section.domain.first),0);near(number(section.domain.last),6);
  assert.deepEqual([section.first.event.edge,section.last.event.edge],[0,2]);
  for(const endpoint of [section.first,section.last]){
    const reference=await intersectEdgePlane(body,endpoint.event.edge,cut);
    assert.deepEqual(endpoint.event.hit,array(reference.hits)[0]);
    assert.deepEqual(endpoint.event.source,reference.source);near(number(endpoint.event.gap),0);
  }
  resolved(await intersectFacePlane(body,0,plane([10,0,0],[1,0,0])),0);
  resolved(await intersectFacePlane(body,0,plane([0,0,1],[0,0,1])),0);
  const k=await loadKernel(),box=extrudeInBend(k,'face-cut-box',[[0,0],[8,0],[8,6],[0,6]],body.faces[0].surface,[0,0,4]);
  const [implicit]=resolved(await intersectFacePlane(box,0,cut),1);
  // The bottom face has -Z normal, so its native section direction is -Y.
  nearPoint(coords(implicit.first.point),[2,6,0]);nearPoint(coords(implicit.last.point),[2,0,0]);
  for(const endpoint of [implicit.first,implicit.last]){
    const reference=await intersectEdgePlane(box,endpoint.event.edge,cut);
    assert.deepEqual(endpoint.event.hit,array(reference.hits)[0]);
  }
  near(number(implicit.first.event.hit.parameter),0.75);near(number(implicit.last.event.hit.parameter),0.25);
});

test('bounded faces exclude distant near-parallel supports without resolving near contacts',async()=>{
  const body=planar();polygon(body,[[0,0],[8,0],[8,6],[0,6]]);
  for(const sign of [-1,1]){
    resolved(await intersectFacePlane(body,0,plane([0,0,sign],[1e-13,0,sign*3])),0);
    const nearContact=await intersectFacePlane(body,0,plane([0,0,sign*1e-9],[1e-13,0,sign]));
    assert.equal(nearContact.$,'Unresolved');assert.equal(nearContact.reason.$,'Supporting');
  }
  const tolerant=await intersectFacePlane(body,0,plane([0,0,1e-5],[1e-13,0,1]),{inputTolerance:0.001});
  assert.notEqual(tolerant.$,'Resolved');
  const curved=band();
  for(const cut of [plane([50,0,0],[1,0,1e-13]),plane([0,0,50],[1e-13,0,1]),plane([0,0,-50],[1e-13,0,1])]){
    resolved(await intersectFacePlane(curved,0,cut),0);
  }
  const tangent=await intersectFacePlane(curved,0,plane([5,0,0],[1,0,0]));
  assert.equal(tangent.$,'NonTransverse');assert.equal(tangent.reason.$,'TangentSupport');
  const invalid=structuredClone(body);invalid.edges[0].curve.direction=[0,0,0];
  assert.notEqual((await intersectFacePlane(invalid,0,plane([0,0,50],[1e-13,0,1]))).$,'Resolved');
});

test('finite exclusion encloses curved extrema between boundary vertices',async()=>{
  const sector=planar();sector.vertices.push([5,0,0],[0,5,0],[0,0,0]);
  sector.edges.push({start:0,end:1,sameSense:true,curve:circle(5),curveRange:[0,Math.PI/2]});
  line(sector,1,2);line(sector,2,0);
  sector.faces[0].loops.push([0,1,2].map(edge=>({edge,forward:true})));sector.faces[0].outer.push(true);
  // Every source vertex has x+y < 6, but the round boundary reaches 5*sqrt(2).
  // A vertex-only exclusion would incorrectly discard this genuine section.
  const [section]=resolved(await intersectFacePlane(sector,0,plane([3,3,0],[1,1,0])),1);
  for(const end of [section.first,section.last]){
    const [x,y]=coords(end.point);near(x+y,6);near(x*x+y*y,25);assert.equal(end.event.edge,0);
  }
  const curved=band();
  // Both stored seam vertices have x=5. The full cylinder still crosses x=0.
  resolved(await intersectFacePlane(curved,0,plane([0,0,0],[1,0,0])),2);
});

test('holes, concavity and partial round trims produce disconnected analytic line intervals',async()=>{
  const annulus=planar();round(annulus,5);round(annulus,2,false);
  const sections=resolved(await intersectFacePlane(annulus,0,plane([1,0,0],[1,0,0])),2);
  const expected=[[-Math.sqrt(24),-Math.sqrt(3)],[Math.sqrt(3),Math.sqrt(24)]];
  sections.forEach((s,i)=>{near(coords(s.first.point)[1],expected[i][0]);near(coords(s.last.point)[1],expected[i][1]);});
  const concave=planar();polygon(concave,[[0,0],[8,0],[8,6],[6,6],[6,2],[2,2],[2,6],[0,6]]);
  const pieces=resolved(await intersectFacePlane(concave,0,plane([0,4,0],[0,1,0])),2);
  const xs=pieces.map(s=>[coords(s.first.point)[0],coords(s.last.point)[0]].sort((a,b)=>a-b)).sort((a,b)=>a[0]-b[0]);
  nearPoint(xs[0],[0,2]);nearPoint(xs[1],[6,8]);
  const half=planar();half.vertices.push([5,0,0],[-5,0,0]);
  half.edges.push({start:0,end:1,sameSense:true,curve:circle(5),curveRange:[0,Math.PI]});line(half,1,0);
  half.faces[0].loops.push([{edge:0,forward:true},{edge:1,forward:true}]);half.faces[0].outer.push(true);
  const [arc]=resolved(await intersectFacePlane(half,0,plane([1,0,0],[1,0,0])),1);
  nearPoint(coords(arc.first.point),[1,0,0]);nearPoint(coords(arc.last.point),[1,Math.sqrt(24),0]);
  const elliptical=planar();round(elliptical,5);round(elliptical,2,false);
  elliptical.edges.forEach((e,i)=>{e.curve={type:'ellipse',origin:[0,0,0],normal:[0,0,1],x:[1,0,0],major:i?2:5,minor:i?1:3};});
  const ellipticSections=resolved(await intersectFacePlane(elliptical,0,plane([1,0,0],[1,0,0])),2);
  const outer=3*Math.sqrt(1-1/25),inner=Math.sqrt(1-1/4);
  ellipticSections.forEach((s,i)=>nearPoint([coords(s.first.point)[1],coords(s.last.point)[1]],i?[inner,outer]:[-outer,-inner]));
});

test('cylinder sections retain full circle/ellipse seams and both finite generator branches',async()=>{
  const body=band();
  const [full]=resolved(await intersectFacePlane(body,0,plane([0,0,4],[0,0,1])),1);
  assert.equal(full.curve.$,'Circle');assert.equal(full.domain.$,'Untrimmed');
  assert.equal(full.first.$,'PeriodicSeam');assert.deepEqual(full.first,full.last);nearPoint(coords(full.first.point),[5,0,4]);
  const ellipseResult=await intersectFacePlane(body,0,plane([0,0,5],[-0.4,0,1]));
  const [ellipse]=resolved(ellipseResult,1);assert.equal(ellipse.curve.$,'Ellipse');assert.equal(ellipse.domain.$,'Untrimmed');assert.equal(array(ellipseResult.events).length,0);
  const generators=resolved(await intersectFacePlane(body,0,plane([1,0,0],[1,0,0])),2);
  for(const s of generators){
    assert.equal(s.curve.$,'Line');near(coords(s.first.point)[0],1);near(Math.abs(coords(s.first.point)[1]),Math.sqrt(24));
    near(coords(s.first.point)[2],0);near(coords(s.last.point)[2],10);
    assert.deepEqual([s.first.event.edge,s.last.event.edge],[0,1]);
  }
});

test('periodic sections preserve wrapped partial intervals and remove cylindrical holes without fake seam events',async()=>{
  const partial=cylinder();panel(partial,-0.6,0.8,0,10);
  const [arc]=resolved(await intersectFacePlane(partial,0,plane([0,0,5],[0,0,1])),1);
  near(number(arc.domain.first),2*Math.PI-0.6);near(number(arc.domain.last),2*Math.PI+0.8);
  nearPoint(coords(arc.first.point),cp(-0.6,5));nearPoint(coords(arc.last.point),cp(0.8,5));
  assert.ok(number(arc.last.parameter)>2*Math.PI);assert.ok(number(arc.last.event.parameter)<2*Math.PI);
  const hole=band();panel(hole,-0.4,0.6,3,7,false);
  const result=await intersectFacePlane(hole,0,plane([0,0,5],[0,0,1])),[remaining]=resolved(result,1);
  near(number(remaining.domain.first),0.6);near(number(remaining.domain.last),2*Math.PI-0.4);
  assert.equal(array(result.events).length,2);assert.ok(array(result.events).every(e=>e.edge!==2));
  const [oblique]=resolved(await intersectFacePlane(band(),0,plane([0,0,1],[-1,0,1])),1);
  assert.equal(oblique.curve.$,'Ellipse');assert.ok(number(oblique.domain.last)>2*Math.PI);
  for(const end of [oblique.first,oblique.last]){near(coords(end.point)[0],-1);near(coords(end.point)[2],0);near(Math.abs(coords(end.point)[1]),Math.sqrt(24));}
  resolved(await intersectFacePlane(band(),0,plane([0,0,12],[0,0,1])),0);
});

test('native rigid transforms, reversed senses and explicit domains retain original source words',async()=>{
  const k=await loadKernel(),body=cylinder();panel(body,-0.6,0.8,0,10);
  for(const edge of body.edges){[edge.start,edge.end]=[edge.end,edge.start];edge.sameSense=!edge.sameSense;}
  for(const use of body.faces[0].loops[0])use.forward=!use.forward;
  body.faces[0].sameSense=false;
  const rotation={$:'Rotation',x:vector([0.8,0,-0.6]),y:vector([0,1,0]),z:vector([0.6,0,0.8])},offset=vector([29,-17,83]);
  const native=k.analytic.transform(encodeAnalytic(body),rotation,offset);
  const cut={origin:k.analytic.point_transform(vector([0,0,5]),rotation,offset),normal:k.precise.rotate(vector([0,0,1]),rotation)};
  const options={domains:body.edges.map(e=>e.curveRange&&{$:'Interval',first:real(e.curveRange[0]),last:real(e.curveRange[1])}),inputTolerance:0.0003};
  const result=await intersectFacePlane(native,0,cut,options),[section]=resolved(result,1);
  assert.equal(section.curve.$,'Circle');assert.equal(section.domain.$,'Interval');
  assert.deepEqual(result.source.face,array(native.faces)[0]);
  assert.deepEqual(result.source.plane_origin,cut.origin);assert.deepEqual(result.source.plane_normal,cut.normal);
  near(number(result.source.source_budget),0.0003,1e-16);
  const expected=[cp(-0.6,5),cp(0.8,5)].map(([x,y,z])=>[0.8*x+0.6*z+29,y-17,-0.6*x+0.8*z+83]);
  const endpoints=[section.first,section.last];
  for(const [i,end] of endpoints.entries()){
    nearPoint(coords(end.point),expected[i]);
    assert.equal(end.event.forward,false);
    const edge=array(native.edges)[end.event.edge],reference=await intersectEdgePlane(native,end.event.edge,cut,options);
    assert.equal(reference.$,'Resolved');assert.deepEqual(end.event.source,reference.source);assert.deepEqual(end.event.hit,array(reference.hits)[0]);
    assert.deepEqual(end.event.source.edge,edge);
    assert.deepEqual(end.event.source.start,array(native.vertices)[edge.start]);
    assert.deepEqual(end.event.source.end,array(native.vertices)[edge.end]);
    assert.ok(number(end.event.gap)<1e-9);
  }
  assert.ok(endpoints.some(end=>Object.values(end.event.hit.point).some(v=>v?.$==='Real'&&v.lo!==0)));
});

test('tolerant source-boundary gaps remain recorded without snapping the original edge hit',async()=>{
  const body=planar(),gap=1e-5;polygon(body,[[0,0,gap],[8,0,gap],[8,6,gap],[0,6,gap]]);
  body.vertexTolerancesMm=[2e-5,0,0,0];
  const cut=plane([2,0,0],[1,0,0]),result=await intersectFacePlane(body,0,cut),[section]=resolved(result,1);
  near(number(result.source.source_budget),2e-5,1e-16);
  for(const end of [section.first,section.last]){
    near(coords(end.point)[2],0);near(coords(end.event.hit.point)[2],gap);near(number(end.event.gap),gap);
    assert.notDeepEqual(end.point,end.event.hit.point);
    const reference=await intersectEdgePlane(body,end.event.edge,cut);
    assert.deepEqual(end.event.hit,array(reference.hits)[0]);assert.deepEqual(end.event.source,reference.source);
  }
});

test('selected surface frames reject malformed directions and preserve valid nonunit source vectors',async()=>{
  const rectangle=planar();polygon(rectangle,[[0,0],[8,0],[8,6],[0,6]]);
  const cases=[
    [rectangle,'normal',plane([2,0,0],[1,0,0]),plane([0,0,1],[0,0,1])],
    [band(),'axis',plane([0,0,5],[0,0,1]),plane([6,0,0],[1,0,0])],
  ];
  for(const [base,direction,cut,emptyCut] of cases){
    for(const x of [[0,0,1],[1,0,0.01],[0,0,0],[1e-14,0,0],[1e11,0,0]]){
      const body=structuredClone(base);body.faces[0].surface.x=x;
      const before=structuredClone(body),result=await intersectFacePlane(body,0,cut);
      assert.equal(result.$,'Rejected',JSON.stringify({surface:body.faces[0].surface,kind:result.$,reason:result.reason}));assert.equal(result.reason.$,'InvalidInput');assert.equal(result.sections,undefined);
      assert.deepEqual(body,before);
    }
    const native=encodeAnalytic(base);native.faces.head.surface.x.x={$:'Real',hi:0,lo:1};
    const before=structuredClone(native);
    for(const query of [cut,emptyCut]){
      const result=await intersectFacePlane(native,0,query);
      assert.equal(result.$,'Rejected',JSON.stringify({query,kind:result.$,reason:result.reason}));assert.equal(result.reason.$,'InvalidInput');
    }
    assert.deepEqual(native,before);
    const scaled=structuredClone(base);scaled.faces[0].surface[direction]=[0,0,7.123456789];scaled.faces[0].surface.x=[-0.123456789,0,0];
    const source=encodeAnalytic(scaled),original=structuredClone(source);
    const scaledCut={origin:vector(cut.origin),normal:vector(cut.normal.map(v=>v*3.125))};
    const result=await intersectFacePlane(source,0,scaledCut);resolved(result,1);
    assert.deepEqual(result.source.face,original.faces.head);assert.deepEqual(result.source.plane_normal,scaledCut.normal);assert.deepEqual(source,original);
  }
  const coplanar=structuredClone(rectangle);coplanar.faces[0].surface.x=[0,0,1];
  assert.equal((await intersectFacePlane(coplanar,0,plane([0,0,0],[0,0,1]))).$,'Rejected');
});

test('coplanarity, tangency, boundary coincidence, vertex contact and unresolved input never publish partial sections',async()=>{
  const rectangle=planar();polygon(rectangle,[[0,0],[8,0],[8,6],[0,6]]);
  const cases=[
    [rectangle,plane([0,0,0],[0,0,1]),'NonTransverse','Coplanar'],
    [band(),plane([5,0,0],[1,0,0]),'NonTransverse','TangentSupport'],
    [rectangle,plane([0,0,0],[1,-1,0]),'NonTransverse','VertexContact'],
    [rectangle,plane([1e-11,0,0],[1,0,0]),'Unresolved','EdgeUnresolved'],
  ];
  const annulus=planar();round(annulus,5);round(annulus,2,false);cases.push([annulus,plane([2,0,0],[1,0,0]),'NonTransverse','BoundaryTangency']);
  for(const [body,cut,kind,reason] of cases){
    const result=await intersectFacePlane(body,0,cut);assert.equal(result.$,kind,JSON.stringify(result));assert.equal(result.reason.$,reason);
    assert.equal(result.sections,undefined);assert.throws(()=>requireResolvedFacePlane(result),UnsupportedFeatureError);
  }
  const coincident=await intersectFacePlane(rectangle,0,plane([0,0,0],[1,0,0]));assert.equal(coincident.$,'NonTransverse');assert.equal(coincident.sections,undefined);
  const invalid=await intersectFacePlane(rectangle,0,plane([0,0,0],[0,0,0]));assert.equal(invalid.$,'Rejected');
  assert.equal((await intersectFacePlane(rectangle,100,plane([2,0,0],[1,0,0]))).reason.$,'InvalidIndex');
  const cone=band();cone.faces[0].surface={type:'cone',origin:[0,0,0],axis:[0,0,1],x:[1,0,0],radius:5,angle:0.2};
  assert.equal((await intersectFacePlane(cone,0,plane([0,0,4],[0,0,1]))).reason.$,'UnsupportedSurface');
  await assert.rejects(intersectFacePlane(rectangle,-1,plane([0,0,0],[1,0,0])),RangeError);
});

test('crowded events, missing trims, invalid arrangements and numeric limits fail closed',async()=>{
  const thin=planar();polygon(thin,[[0,0],[8,0],[8,4e-7],[0,4e-7]]);
  const crowded=await intersectFacePlane(thin,0,plane([2,0,0],[1,0,0]));
  assert.equal(crowded.$,'Unresolved',JSON.stringify(crowded));assert.equal(crowded.reason.$,'CrowdedEvents');assert.equal(crowded.sections,undefined);
  const missing=cylinder();panel(missing,-0.6,0.8,0,10);delete missing.edges[0].curveRange;
  const invalid=structuredClone(missing);invalid.edges[0].curveRange=[0,0];
  const broken=planar();polygon(broken,[[0,0],[8,0],[8,6],[0,6]]);broken.faces[0].loops[0].pop();
  const badIndex=structuredClone(broken);badIndex.faces[0].loops[0][0].edge=100;
  for(const [body,reason] of [[missing,'MissingTrim'],[invalid,'InvalidTrim'],[broken,'InvalidTopology'],[badIndex,'InvalidIndex']]){
    const result=await intersectFacePlane(body,0,plane([2,0,0],[1,0,0]));
    assert.equal(result.$,'Unresolved',JSON.stringify(result));assert.equal(result.reason.$,'Preparation');assert.equal(result.reason.reason.$,reason);assert.equal(result.sections,undefined);
  }
  const rectangle=planar();polygon(rectangle,[[0,0],[8,0],[8,6],[0,6]]);
  for(const options of [{inputTolerance:-1e-4},{inputTolerance:0.11},{linear:0},{linear:-1},{angular:0},{angular:0.2},{angular:1e-14}]){
    const result=await intersectFacePlane(rectangle,0,plane([2,0,0],[1,0,0]),options);
    assert.equal(result.$,'Rejected',JSON.stringify(result));assert.equal(result.reason.$,'InvalidInput');
  }
  rectangle.vertexTolerancesMm=[0.01,-1e-5];
  assert.equal((await intersectFacePlane(rectangle,0,plane([2,0,0],[1,0,0]))).reason.$,'InvalidInput');
  delete rectangle.vertexTolerancesMm;
  const large=kTransform(await loadKernel(),rectangle,[1e6,0,0]);
  const scale=await intersectFacePlane(large,0,plane([1e6+2,0,0],[1,0,0]));
  assert.equal(scale.$,'Unresolved');assert.equal(scale.reason.reason.$,'ResolutionLimit');
  const small=band();small.faces[0].surface.radius=1e-5;
  small.vertices.forEach(p=>{p[0]=1e-5;});small.edges.filter(e=>e.curve.type==='circle').forEach(e=>{e.curve.radius=1e-5;});
  const radius=await intersectFacePlane(small,0,plane([1,0,0],[1,0,0]),{inputTolerance:0.0003});
  assert.equal(radius.$,'Unresolved');assert.equal(radius.reason.reason.$,'ResolutionLimit');
  const nearTangent=await intersectFacePlane(band(),0,plane([5+1e-10,0,0],[1,0,0]));
  assert.equal(nearTangent.$,'Unresolved');assert.equal(nearTangent.reason.$,'Supporting');assert.equal(nearTangent.sections,undefined);
  const malformed=structuredClone(rectangle);delete malformed.faces[0].loops[0][0].forward;
  await assert.rejects(intersectFacePlane(malformed,0,plane([2,0,0],[1,0,0])),TypeError);
  const malformedWords=encodeAnalytic(rectangle);malformedWords.faces.head.surface.origin.x={$:'Real',hi:0,lo:1};
  assert.equal((await intersectFacePlane(malformedWords,0,plane([2,0,0],[1,0,0]))).reason.$,'InvalidInput');
});

function kTransform(k,body,offset){
  return k.analytic.transform(encodeAnalytic(body),{$:'Rotation',x:vector([1,0,0]),y:vector([0,1,0]),z:vector([0,0,1])},vector(offset));
}

test('frozen transformed P10 faces resolve against the actual F32 clipping box and retain source junction uncertainty',async()=>{
  const file=new URL('../fixtures/r10b/modules/base/ZtoDD.body.json',import.meta.url),bytes=readFileSync(file);
  const hash='b78a8546970e360ee2a3a22661c87d4f9e835d24fe50cedeedde6a19add20dc9';
  assert.equal(createHash('sha256').update(bytes).digest('hex'),hash);
  const feature=readFileSync(new URL('../fixtures/r10b/r10b.fs',import.meta.url));
  assert.equal(createHash('sha256').update(feature).digest('hex'),'219ee9630f37f9e54fe7e1b4e09094ab25748a811ed8f9e8b9ebf4892d8b8349');
  const k=await loadKernel(),source=JSON.parse(bytes).bodies[0];
  const body=transformAnalytic(k,importOnshapeBody(k,source,'face-plane-P10',{source:'frozen face-section regression'}),'face-plane-g0',[
    [1,0,0],[0,0.9063077870366499,-0.42261826174069944],[0,0.42261826174069944,0.9063077870366499],
  ],[0,85.7915071334,-183.980480768]);
  const box=extrudeInBend(k,'face-plane-box',[[-119,4],[-92.79,4],[-92.79,46],[-119,46]],
    {origin:[0,0,-61],normal:[0,0,1],x:[1,0,0]},[0,0,129]);
  const cut=box.faces[3].surface,boxX=cut.origin[0];
  assert.equal(boxX,-92.79000000000002);assert.deepEqual([body.vertices.length,body.edges.length,body.faces.length],[348,529,189]);
  for(const [face,kind,edges] of [[9,'Line',[248,190]],[11,'Circle',[255,248]],[17,'Circle',[251,254]]]){
    const result=await intersectFacePlane(body,face,cut),[section]=resolved(result,1);
    assert.equal(section.curve.$,kind);assert.deepEqual([section.first.event.edge,section.last.event.edge],edges);
    assert.equal(array(result.events).length,2);assert.ok(number(result.source.source_budget)>=0.0003);
    const classify=kind==='Line'?classifyPlanarFace:classifyCylinderFace;
    for(const end of [section.first,section.last]){
      const reference=await intersectEdgePlane(body,end.event.edge,cut);
      assert.deepEqual(end.event.hit,array(reference.hits)[0]);assert.deepEqual(end.event.source,reference.source);
      near(coords(end.point)[0],boxX);assert.ok(number(end.event.gap)<1e-9);
      assert.equal((await classify(body,face,end.event.hit.point)).$,'Boundary');
      assert.equal((await classifyPlanarFace(box,3,end.event.hit.point)).$,'Inside');
    }
    const parameter=k.real.mul(k.real.add(section.domain.first,section.domain.last),real(0.5));
    const midpoint=k.analytic.curve_point(section.curve,parameter);
    assert.equal((await classify(body,face,midpoint)).$,'Inside');assert.equal((await classifyPlanarFace(box,3,midpoint)).$,'Inside');
  }
  const [line]=resolved(await intersectFacePlane(body,9,cut),1);
  nearPoint(coords(line.first.point),[boxX,29,41.897059671572606]);nearPoint(coords(line.last.point),[boxX,29,-7]);
  resolved(await intersectFacePlane(body,4,box.faces[1].surface),3);
  // These are valid empty trims, including cylinder faces with corrected ellipse seams.
  for(const face of [0,25,30,79,83,84,85,110,169])resolved(await intersectFacePlane(body,face,cut),0);
  for(const [face,reason,nested] of [[4,'Supporting','NearParallelPlanes'],[6,'EdgeUnresolved','EndpointAmbiguity'],[63,'EdgeUnresolved','CurveUnresolved'],[71,'EdgeUnresolved','CurveUnresolved']]){
    const result=await intersectFacePlane(body,face,box.faces[2].surface);
    assert.equal(result.$,'Unresolved',JSON.stringify(result));assert.equal(result.reason.$,reason);assert.equal(result.reason.reason.$,nested);assert.equal(result.sections,undefined);
  }
  assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'),hash);
});

}
