import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend() || missing("fixtures/r10b/modules/base/ZtoDD.body.json");
if (publicTreeSkip) {
  test("face-classification.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { readFileSync } = await import("node:fs");
const { createHash } = await import("node:crypto");
const { loadKernel, array, extrudeInBend } = await import("../src/kernel.mjs");
const { vector, coords, number } = await import("../src/real.mjs");
const { importOnshapeBody, encodeAnalytic, transformAnalytic } = await import("../src/analytic.mjs");
const { classifyPlanarFace, loadFaceClassifier, requireResolvedFaceClassification } = await import("../src/face-classification.mjs");
const { intersectCurvePlane } = await import("../src/curve-plane.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");











const surface={type:'plane',origin:[0,0,0],normal:[0,0,1],x:[1,0,0]};
const makeFace=()=>({vertices:[],edges:[],faces:[{surface, sameSense:true, loops:[],outer:[]}]});
function addPolygon(body,points,outer=true){
  const startVertex=body.vertices.length,startEdge=body.edges.length;
  body.vertices.push(...points.map(p=>p.length===2?[...p,0]:p));
  const uses=points.map((_,i)=>{
    const start=startVertex+i,end=startVertex+(i+1)%points.length,origin=body.vertices[start],target=body.vertices[end];
    body.edges.push({start,end,sameSense:true,curve:{type:'line',origin,direction:target.map((v,j)=>v-origin[j])}});
    return {edge:startEdge+i,forward:true};
  });
  body.faces[0].loops.push(uses);body.faces[0].outer.push(outer);
}
function addRound(body,center,major,minor=major,outer=true){
  const vertex=body.vertices.length,edge=body.edges.length;
  body.vertices.push([center[0]+major,center[1],center[2]??0]);
  const common={origin:[center[0],center[1],center[2]??0],normal:[0,0,1],x:[1,0,0]};
  body.edges.push({start:vertex,end:vertex,sameSense:true,curve:major===minor?{type:'circle',...common,radius:major}:{type:'ellipse',...common,major,minor}});
  body.faces[0].loops.push([{edge,forward:true}]);body.faces[0].outer.push(outer);
}
function addSegment(body,major,minor,first,last){
  const start=[major*Math.cos(first),minor*Math.sin(first),0],end=[major*Math.cos(last),minor*Math.sin(last),0];
  const curve={origin:[0,0,0],normal:[0,0,1],x:[1,0,0],...(major===minor?{type:'circle',radius:major}:{type:'ellipse',major,minor})};
  body.vertices.push(start,end);
  body.edges.push({start:0,end:1,sameSense:true,curve,curveRange:[first,last]},
    {start:1,end:0,sameSense:true,curve:{type:'line',origin:end,direction:start.map((v,i)=>v-end[i])}});
  body.faces[0].loops.push([{edge:0,forward:true},{edge:1,forward:true}]);body.faces[0].outer.push(true);
}
const expectKind=async(body,p,kind,options={})=>{
  const result=await classifyPlanarFace(body,0,p,options);
  assert.equal(result.$,kind,JSON.stringify({p,result}));
  if(kind==='Inside'||(kind==='Outside'&&result.rays!==0))assert.ok(result.rays>=2);
  return result;
};

test('planar line loops classify interior, exterior, vertices and edges without forced endpoint parity',async()=>{
  const body=makeFace();addPolygon(body,[[0,0],[8,0],[8,6],[0,6]]);
  for(const p of [[4,3,0],[0.25,0.25,0],[7.8,5.8,0]])await expectKind(body,p,'Inside');
  for(const p of [[-1,3,0],[9,6,0],[4,-1,0],[4,3,1]])await expectKind(body,p,'Outside');
  for(const p of [[0,0,0],[8,6,0],[4,0,0],[0,3,0]])await expectKind(body,p,'Boundary');
  // The horizontal ray meets the far vertex, so it must be discarded; the
  // remaining independent directions still agree on this interior point.
  const triangle=makeFace();addPolygon(triangle,[[0,0],[8,3],[0,6]]);
  await expectKind(triangle,[1,3,0],'Inside');
  const reversed=structuredClone(body);
  reversed.faces[0].loops[0].reverse().forEach(use=>{use.forward=!use.forward;});
  await expectKind(reversed,[4,3,0],'Inside');
  const concave=makeFace();addPolygon(concave,[[0,0],[8,0],[8,2],[3,2],[3,6],[0,6]]);
  for(const x of [0.5,2.5,3.5,7.5,8.5])for(const y of [0.5,1.5,2.5,5.5,6.5]){
    const expected=x<8&&y<6&&(x<3||y<2)?'Inside':'Outside';
    await expectKind(concave,[x,y,0],expected);
  }
});

test('analytic circles and ellipses classify full loops and holes without replacing them by chords',async()=>{
  const annulus=makeFace();addRound(annulus,[0,0],5);addRound(annulus,[0,0],2,2,false);
  await expectKind(annulus,[0,0,0],'Outside');
  await expectKind(annulus,[3,0,0],'Inside');
  await expectKind(annulus,[6,0,0],'Outside');
  for(const p of [[5,0,0],[0,5,0],[2,0,0],[0,-2,0]])await expectKind(annulus,p,'Boundary');
  const ellipse=makeFace();addRound(ellipse,[10,-7],6,2);
  for(const p of [[10,-7,0],[13,-6,0],[5,-7,0]])await expectKind(ellipse,p,'Inside');
  for(const p of [[10,-4,0],[17,-7,0]])await expectKind(ellipse,p,'Outside');
  for(const p of [[16,-7,0],[10,-5,0],[4,-7,0]])await expectKind(ellipse,p,'Boundary');
  const mixed=makeFace();addPolygon(mixed,[[-10,-8],[10,-8],[10,8],[-10,8]]);addRound(mixed,[0,0],6,2,false);
  await expectKind(mixed,[0,0,0],'Outside');await expectKind(mixed,[0,4,0],'Inside');
  mixed.faces[0].loops.reverse();mixed.faces[0].outer.reverse();
  await expectKind(mixed,[0,0,0],'Outside');await expectKind(mixed,[0,4,0],'Inside');
});

test('partial circular and elliptical arcs retain their ranges across seams and reversed uses',async()=>{
  for(const [major,minor] of [[5,5],[6,2]]){
    for(const shift of [0,2*Math.PI,-2*Math.PI]){
      const body=makeFace();addSegment(body,major,minor,shift,shift+Math.PI);
      await expectKind(body,[0,minor/2,0],'Inside');
      for(const p of [[0,-minor/2,0],[0,-minor,0],[0,minor+1,0]])await expectKind(body,p,'Outside');
      for(const p of [[0,minor,0],[major,0,0],[-major,0,0],[0,0,0]])await expectKind(body,p,'Boundary');
      const reversed=structuredClone(body);
      for(const edge of reversed.edges){[edge.start,edge.end]=[edge.end,edge.start];edge.sameSense=!edge.sameSense;}
      for(const use of reversed.faces[0].loops[0])use.forward=!use.forward;
      await expectKind(reversed,[0,minor/2,0],'Inside');
      await expectKind(reversed,[0,-minor,0],'Outside');
      const missing=structuredClone(body);delete missing.edges[0].curveRange;
      assert.equal((await expectKind(missing,[0,minor/2,0],'Unresolved')).reason.$,'MissingTrim');
    }
  }
  const seam=makeFace();addSegment(seam,5,5,-Math.PI/2,Math.PI/2);
  await expectKind(seam,[2,0,0],'Inside');await expectKind(seam,[-2,0,0],'Outside');
  await expectKind(seam,[5,0,0],'Boundary');await expectKind(seam,[-5,0,0],'Outside');
  // A Float32 floor of the turn count rounds this point onto the wrong turn.
  // Boundary selection must retain the radial candidate just inside the arc.
  const nearSeam=makeFace(),first=2*Math.PI+0.3,theta=first+1e-7;
  addSegment(nearSeam,6,2,first,first+Math.PI);
  await expectKind(nearSeam,[6*Math.cos(theta),2*Math.sin(theta),0],'Boundary');
  const majorArc=makeFace();addSegment(majorArc,5,5,-Math.PI/3,4*Math.PI/3);
  await expectKind(majorArc,[0,0,0],'Inside');await expectKind(majorArc,[0,-4.5,0],'Outside');
  await expectKind(majorArc,[0,-5,0],'Outside');await expectKind(majorArc,[0,5,0],'Boundary');
});

test('rotated and translated native faces preserve membership and native arc parameters',async()=>{
  const k=await loadKernel();
  const rotation={$:'Rotation',x:vector([0.8,0,-0.6]),y:vector([0,1,0]),z:vector([0.6,0,0.8])};
  const offset=vector([17,-29,83]);
  const body=makeFace();addSegment(body,6,2,0,Math.PI);
  const transformed=k.analytic.transform(encodeAnalytic(body),rotation,offset),options={domains:body.edges.map(e=>e.curveRange)};
  for(const [p,kind] of [[[0,1,0],'Inside'],[[0,-1,0],'Outside'],[[0,2,0],'Boundary'],[[0,1,1],'Outside']]){
    const query=k.analytic.point_transform(vector(p),rotation,offset);
    const result=await expectKind(transformed,query,kind,options);
    if(kind==='Boundary'){assert.equal(result.edge,0);assert.ok(Math.abs(number(result.parameter)-Math.PI/2)<1e-10);}
  }
  const reversed=structuredClone(body);
  reversed.faces[0].surface={...surface,normal:[0,0,-1]};reversed.faces[0].sameSense=false;
  await expectKind(reversed,[0,1,0],'Inside');await expectKind(reversed,[0,-1,0],'Outside');
});

test('query and source tolerance guards preserve unresolved boundary and plane cases',async()=>{
  const body=makeFace();addPolygon(body,[[0,0],[8,0],[8,6],[0,6]]);
  assert.equal((await expectKind(body,[4,-1e-7,0],'Unresolved')).reason.$,'NearBoundary');
  assert.equal((await expectKind(body,[4,3,1e-7],'Unresolved')).reason.$,'NearFacePlane');
  await expectKind(body,[4,3,0.5e-7],'Inside');await expectKind(body,[4,0,0.5e-7],'Boundary');
  const ellipse=makeFace();addRound(ellipse,[0,0],10,1);
  const scaled=(1+2e-8)*Math.SQRT1_2;
  assert.equal((await expectKind(ellipse,[10*scaled,scaled,0],'Unresolved')).reason.$,'NearBoundary');
  const gap=structuredClone(body);gap.edges[0].curve.origin=[0,0.01,0];
  assert.equal((await expectKind(gap,[4,3,0],'Unresolved')).reason.$,'InputGap');
  await expectKind(gap,[4,3,0],'Inside',{inputTolerance:0.02});
  assert.equal((await expectKind(gap,[4,0.005,0],'Unresolved',{inputTolerance:0.02})).reason.$,'NearBoundary');
  const offPlane=structuredClone(body);offPlane.edges[0].curve.origin=[0,0,0.01];
  assert.equal((await expectKind(offPlane,[4,3,0],'Unresolved')).reason.$,'InputGap');
  await expectKind(offPlane,[4,0,0],'Boundary',{inputTolerance:0.02});
  for(const options of [{inputTolerance:-0.001},{inputTolerance:0.2},{linear:0},{angular:1e-14}]){
    assert.equal((await expectKind(body,[4,3,0],'Unresolved',options)).reason.$,'InvalidInput');
  }
  const badMetadata=structuredClone(body);badMetadata.vertexTolerancesMm=[0.01,-0.0001];
  assert.equal((await expectKind(badMetadata,[4,3,0],'Unresolved')).reason.$,'InvalidInput');
  assert.equal((await expectKind(body,[4,3,0],'Unresolved',{linear:1e-13})).reason.$,'ResolutionLimit');
});

test('invalid topology, trims and geometry stay explicit and the capability helper raises',async()=>{
  const body=makeFace();addPolygon(body,[[0,0],[8,0],[8,6],[0,6]]);
  const variants=[
    [b=>b.faces[0].loops[0].splice(1,1),'InvalidTopology'],
    [b=>b.faces[0].outer.fill(false),'InvalidTopology'],
    [b=>b.faces[0].loops[0][0].edge=100,'InvalidIndex'],
    [b=>b.edges[0].start=100,'InvalidIndex'],
    [b=>b.edges[0].curve.direction=[0,0,0],'InvalidInput'],
    [b=>b.faces[0].surface={type:'cylinder',origin:[0,0,0],axis:[0,0,1],x:[1,0,0],radius:5},'NonPlanarFace'],
  ];
  for(const [mutate,reason] of variants){
    const bad=structuredClone(body);mutate(bad);
    const result=await expectKind(bad,[4,3,0],'Unresolved');assert.equal(result.reason.$,reason);
    assert.throws(()=>requireResolvedFaceClassification(result),UnsupportedFeatureError);
  }
  assert.equal((await classifyPlanarFace(body,10,[4,3,0])).reason.$,'InvalidIndex');
  await assert.rejects(classifyPlanarFace(body,-1,[4,3,0]),RangeError);
  const arc=makeFace();addSegment(arc,5,5,0,Math.PI);
  for(const domain of [[Math.PI,0],[0,2*Math.PI],[-30,-29]]){
    assert.equal((await expectKind(arc,[0,1,0],'Unresolved',{domains:[domain]})).reason.$,'InvalidTrim');
  }
  arc.edges[0].curve.x=[1,0,0.01];
  assert.equal((await expectKind(arc,[0,1,0],'Unresolved')).reason.$,'InvalidInput');
  const result=await expectKind(body,[4,3,0],'Inside');assert.equal(requireResolvedFaceClassification(result),result);
  const ambiguous=makeFace();
  const angles=[0,Math.atan(0.375),Math.atan(0.8125),Math.atan(1.3125),Math.PI/2];
  addPolygon(ambiguous,[...angles,...angles.map(a=>a+Math.PI)].map(a=>[10*Math.cos(a),10*Math.sin(a)]));
  assert.equal((await expectKind(ambiguous,[0,0,0],'Unresolved')).reason.$,'AmbiguousRays');
});

test('existing F32 polyhedral boxes use the same Bend face classifier',async()=>{
  const k=await loadKernel();
  const box=extrudeInBend(k,'classification-box',[[0,0],[8,0],[8,6],[0,6]],surface,[0,0,4]);
  await expectKind(box,[4,3,0],'Inside');await expectKind(box,[4,0,0],'Boundary');await expectKind(box,[9,3,0],'Outside');
  assert.equal((await classifyPlanarFace(box,1,[4,3,4])).$,'Inside');
  const bad=structuredClone(box);bad.edges[0].start=100;
  assert.equal((await expectKind(bad,[4,3,0],'Unresolved')).reason.$,'InvalidIndex');
  const ambiguous=structuredClone(box);ambiguous.faces[0].loops.push(ambiguous.faces[0].loops[0]);
  await assert.rejects(classifyPlanarFace(ambiguous,0,[4,3,0]),UnsupportedFeatureError);
});

test('frozen P10 planar faces retain holes, arcs and direct curve-plane boundary hits',async()=>{
  const file=new URL('../fixtures/r10b/modules/base/ZtoDD.body.json',import.meta.url),bytes=readFileSync(file);
  const hash='b78a8546970e360ee2a3a22661c87d4f9e835d24fe50cedeedde6a19add20dc9';
  assert.equal(createHash('sha256').update(bytes).digest('hex'),hash);
  const source=JSON.parse(bytes).bodies[0],k=await loadKernel();
  assert.deepEqual([source.vertices.length,source.edges.length,source.faces.length],[316,513,189]);
  const body=importOnshapeBody(k,source,'P10',{source:'frozen P10 face-classification regression'});
  assert.deepEqual([body.vertices.length,body.edges.length,body.faces.length],[348,529,189]);
  const classify=async(face,p,kind)=>{
    const result=await classifyPlanarFace(body,face,p);
    assert.equal(result.$,kind,JSON.stringify({face,p: p.$ ? coords(p) : p,result}));return result;
  };
  // The four corners in the frozen source form a tilted rectangular face.
  const rectangle=body.faces[0],ids=[...new Set(rectangle.loops.flat().flatMap(u=>[body.edges[u.edge].start,body.edges[u.edge].end]))];
  const center=[0,1,2].map(j=>ids.reduce((sum,i)=>sum+body.vertices[i][j],0)/ids.length);
  await classify(0,center,'Inside');await classify(0,[center[0]+20,center[1],center[2]],'Outside');
  // The first circular hole on face 9 is excluded; the single outer circle on
  // face 85 contains its center, despite the reversed supporting normal.
  for(const [face,kind] of [[9,'Outside'],[79,'Outside'],[85,'Inside']]){
    const use=body.faces[face].loops.find(loop=>loop.length===1)[0];
    await classify(face,body.edges[use.edge].curve.origin,kind);
  }
  // These expectations come from source edge midpoints and analytic loop
  // roles, not from the face classifier. Raw Real hit words are preserved.
  for(const [face,edge,axis] of [[0,136,1],[25,4,1],[9,369,0],[85,23,0]]){
    const e=body.edges[edge],origin=source.edges[edge].geometry.midPoint.map(v=>v*1000),normal=[0,0,0];normal[axis]=1;
    const result=await intersectCurvePlane(e.curve,{origin,normal},{interval:e.curveRange});
    assert.equal(result.$,'Resolved',JSON.stringify({edge,result}));assert.equal(result.relation.$,'Crossing');
    const hits=array(result.hits);assert.ok(hits.length>0);
    for(const hit of hits){const membership=await classify(face,hit.point,'Boundary');assert.equal(membership.edge,edge);}
  }
  // The actual first failing r10b Boolean: frozen FS line 215's rigid P10
  // transform and g1's F32 box from [-119,4,-61] to [-92.79,46,68].
  const transformed=transformAnalytic(k,body,'g0',[
    [1,0,0],[0,0.9063077870366499,-0.42261826174069944],[0,0.42261826174069944,0.9063077870366499],
  ],[0,85.7915071334,-183.980480768]);
  const box=extrudeInBend(k,'g1',[[-119,4],[-92.79,4],[-92.79,46],[-119,46]],
    {origin:[0,0,-61],normal:[0,0,1],x:[1,0,0]},[0,0,129]);
  assert.equal(box.faces[3].surface.origin[0],-92.79000000000002);
  const native=encodeAnalytic(transformed),edges=array(native.edges),vertices=array(native.vertices),classifier=await loadFaceClassifier();
  for(const [face,edge,boxFace,boxKind] of [[9,248,3,'Inside'],[9,190,3,'Inside'],[4,497,1,'Boundary']]){
    const e=transformed.edges[edge],interval=classifier.auto_domain(edges[edge],vertices[e.start],vertices[e.end]).value;
    const result=await intersectCurvePlane(e.curve,box.faces[boxFace].surface,{interval});
    assert.equal(result.$,'Resolved');assert.equal(result.relation.$,'Crossing');
    const [hit]=array(result.hits);assert.ok(hit);
    const onP10=await classifyPlanarFace(transformed,face,hit.point);
    assert.equal(onP10.$,'Boundary');assert.equal(onP10.edge,edge);
    assert.equal((await classifyPlanarFace(box,boxFace,hit.point)).$,boxKind);
  }
  const shared=[box.faces[3].surface.origin[0],29,0];
  assert.equal((await classifyPlanarFace(transformed,9,shared)).$,'Inside');
  assert.equal((await classifyPlanarFace(box,3,shared)).$,'Inside');
  assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'),hash);
});

}
