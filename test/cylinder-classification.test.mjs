import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend() || missing("fixtures/r10b/modules/base/ZtoDD.body.json");
if (publicTreeSkip) {
  test("cylinder-classification.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { readFileSync } = await import("node:fs");
const { createHash } = await import("node:crypto");
const { loadKernel, array, extrudeInBend } = await import("../src/kernel.mjs");
const { real, vector, coords } = await import("../src/real.mjs");
const { encodeAnalytic, importOnshapeBody, transformAnalytic } = await import("../src/analytic.mjs");
const { classifyCylinderFace, requireResolvedCylinderClassification } = await import("../src/cylinder-classification.mjs");
const { classifyPlanarFace, loadFaceClassifier } = await import("../src/face-classification.mjs");
const { intersectCurvePlane } = await import("../src/curve-plane.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");












const cylinder=()=>({type:'cylinder',origin:[0,0,0],axis:[0,0,1],x:[1,0,0],radius:5});
const makeFace=()=>({vertices:[],edges:[],faces:[{surface:cylinder(),sameSense:true,loops:[],outer:[]}]});
const point=(angle,z,r=5)=>[r*Math.cos(angle),r*Math.sin(angle),z];
const circle=z=>({type:'circle',origin:[0,0,z],normal:[0,0,1],x:[1,0,0],radius:5});
function addLine(body,start,end){
  const a=body.vertices[start],b=body.vertices[end],index=body.edges.length;
  body.edges.push({start,end,sameSense:true,curve:{type:'line',origin:a,direction:b.map((v,i)=>v-a[i])}});return index;
}
function addPanel(body,first,last,low,high,outer=true){
  const v=body.vertices.length,e=body.edges.length;
  body.vertices.push(point(first,low),point(last,low),point(last,high),point(first,high));
  body.edges.push({start:v,end:v+1,sameSense:true,curve:circle(low),curveRange:[first,last]});
  addLine(body,v+1,v+2);
  body.edges.push({start:v+2,end:v+3,sameSense:false,curve:circle(high),curveRange:[first,last]});
  addLine(body,v+3,v);
  body.faces[0].loops.push([0,1,2,3].map(i=>({edge:e+i,forward:true})));body.faces[0].outer.push(outer);
}
function band({seam=true,slope=0}={}){
  const body=makeFace(),scale=Math.hypot(1,slope);
  body.vertices.push([5,0,0],[5,0,10+5*slope]);
  body.edges.push({start:0,end:0,sameSense:true,curve:circle(0)},
    {start:1,end:1,sameSense:true,curve:slope===0?circle(10):{type:'ellipse',origin:[0,0,10],normal:[-slope/scale,0,1/scale],x:[1/scale,0,slope/scale],major:5*scale,minor:5}});
  if(seam){
    addLine(body,0,1);
    body.faces[0].loops.push([{edge:0,forward:true},{edge:2,forward:true},{edge:1,forward:false},{edge:2,forward:false}]);
    body.faces[0].outer.push(true);
  }else{
    body.faces[0].loops.push([{edge:0,forward:true}],[{edge:1,forward:false}]);body.faces[0].outer.push(true,false);
  }
  return body;
}
const expectKind=async(body,p,kind,options={})=>{
  const result=await classifyCylinderFace(body,0,p,options);
  assert.equal(result.$,kind,JSON.stringify({p:p.$?coords(p):p,result}));
  if(kind==='Inside')assert.equal(result.rays,2);
  return result;
};

test('full cylinder bands classify both meridian directions and exclude internal seam edges from Boundary',async()=>{
  for(const seam of [false,true]){
    const body=band({seam});
    for(const angle of [0,0.1,Math.PI/2,Math.PI,Math.PI*1.7,2*Math.PI]){
      await expectKind(body,point(angle,5),'Inside');
      for(const z of [-2,12])await expectKind(body,point(angle,z),'Outside');
      for(const z of [0,10])await expectKind(body,point(angle,z),'Boundary');
    }
    await expectKind(body,[0,0,5],'Outside');await expectKind(body,[6,0,5],'Outside');
  }
  const noncontractible=band({seam:false});noncontractible.faces[0].outer.fill(false);
  await expectKind(noncontractible,point(0.7,5),'Inside');await expectKind(noncontractible,point(0.7,-1),'Outside');
});

test('partial cylindrical panels and physical holes retain angular periodicity and native trims',async()=>{
  for(const [first,last] of [[-0.6,0.8],[5.7,7.1],[-2.8,2.8]]){
    const body=makeFace();addPanel(body,first,last,0,10);
    await expectKind(body,point((first+last)/2,5),'Inside');
    await expectKind(body,point(first-0.1,5),'Outside');
    await expectKind(body,point(last+0.1,5),'Outside');
    for(const [angle,z] of [[first,5],[last,5],[(first+last)/2,0],[(first+last)/2,10]])await expectKind(body,point(angle,z),'Boundary');
    assert.equal((await expectKind(body,point(first,20),'Unresolved')).reason.$,'AmbiguousMeridian');
  }
  const withHole=band();addPanel(withHole,-0.4,0.6,3,7,false);
  for(const [angle,z,kind] of [[0,5,'Outside'],[0.2,5,'Outside'],[0,2,'Inside'],[0,8,'Inside'],[1,5,'Inside'],[-1,5,'Inside'],[0.2,3,'Boundary'],[-0.4,5,'Boundary']]){
    await expectKind(withHole,point(angle,z),kind);
  }
  withHole.faces[0].loops.reverse();withHole.faces[0].outer.reverse();
  await expectKind(withHole,point(0.2,5),'Outside');await expectKind(withHole,point(1,5),'Inside');
});

test('oblique elliptical rims agree with independent cylinder height inequalities and preserve analytic boundaries',async()=>{
  for(const slope of [-0.8,0.4]){
    const body=band({slope});
    for(const angle of [0,0.25,1.2,2.7,3.8,5.8]){
      const top=10+slope*5*Math.cos(angle);
      await expectKind(body,point(angle,top/2),'Inside');
      await expectKind(body,point(angle,top+1),'Outside');
      const boundary=await expectKind(body,point(angle,top),'Boundary');assert.equal(boundary.edge,1);
    }
  }
});

test('rotated, translated and reversed cylinder representations preserve membership and seam treatment',async()=>{
  const k=await loadKernel(),body=band({slope:0.4});
  const rotation={$:'Rotation',x:vector([0.8,0,-0.6]),y:vector([0,1,0]),z:vector([0.6,0,0.8])},offset=vector([29,-17,83]);
  const transformed=k.analytic.transform(encodeAnalytic(body),rotation,offset);
  for(const [p,kind] of [[point(0,5),'Inside'],[point(1.2,5),'Inside'],[point(1.2,-1),'Outside'],[point(0,12),'Boundary']]){
    await expectKind(transformed,k.analytic.point_transform(vector(p),rotation,offset),kind);
  }
  const reversed=structuredClone(body);
  reversed.faces[0].surface.axis=[0,0,-1];reversed.faces[0].sameSense=false;
  reversed.faces[0].loops.forEach(loop=>{loop.reverse().forEach(use=>{use.forward=!use.forward;});});
  await expectKind(reversed,point(0,5),'Inside');await expectKind(reversed,point(1.2,-1),'Outside');
  for(const edge of reversed.edges){[edge.start,edge.end]=[edge.end,edge.start];edge.sameSense=!edge.sameSense;}
  for(const use of reversed.faces[0].loops.flat())use.forward=!use.forward;
  await expectKind(reversed,point(0,5),'Inside');await expectKind(reversed,point(1.2,-1),'Outside');
});

test('radial, boundary and source-incidence tolerance bands stay unresolved without moving stored curves',async()=>{
  const body=band();
  for(const side of [-1,1]){
    assert.equal((await expectKind(body,[5+side*1e-7,0,5],'Unresolved')).reason.$,'NearCylinder');
    await expectKind(body,[5+side*0.5e-7,0,5],'Inside');
  }
  assert.equal((await expectKind(body,point(0.3,1e-7),'Unresolved')).reason.$,'NearBoundary');
  const gap=band();gap.edges[0].curve.radius=5.00001;gap.vertices[0]=[5.00001,0,0];
  gap.edges[2].curve={type:'line',origin:gap.vertices[0],direction:[-0.00001,0,10]};
  assert.equal((await expectKind(gap,point(0.3,5),'Unresolved')).reason.$,'InputGap');
  const snapshot=JSON.stringify(gap);
  await expectKind(gap,point(0.3,5),'Inside',{inputTolerance:0.001});
  await expectKind(gap,point(0.3,0),'Boundary',{inputTolerance:0.001});
  assert.equal((await expectKind(gap,point(0.3,0.0005),'Unresolved',{inputTolerance:0.001})).reason.$,'NearBoundary');
  assert.equal(JSON.stringify(gap),snapshot);
  for(const options of [{inputTolerance:-0.001},{inputTolerance:0.2},{linear:0},{angular:1e-14}]){
    assert.equal((await expectKind(body,point(0.3,5),'Unresolved',options)).reason.$,'InvalidInput');
  }
  const bad=band();bad.vertexTolerancesMm=[0.001,-0.0001];
  assert.equal((await expectKind(bad,point(0.3,5),'Unresolved')).reason.$,'InvalidInput');
  assert.equal((await expectKind(body,point(0.3,5),'Unresolved',{linear:1e-13})).reason.$,'ResolutionLimit');
});

test('global analytic cylinder-incidence bounds reject curves that pass four cardinal samples',async()=>{
  const body=band(),radius=5*Math.sqrt(1.5);
  const x=[Math.sqrt(2/3),0,1/Math.sqrt(3)],y=[-1/Math.sqrt(6),1/Math.sqrt(2),1/Math.sqrt(3)];
  const normal=[x[1]*y[2]-x[2]*y[1],x[2]*y[0]-x[0]*y[2],x[0]*y[1]-x[1]*y[0]];
  body.edges[1].curve={type:'circle',origin:[0,0,10],normal,x,radius};
  body.vertices[1]=[radius*x[0],0,10+radius*x[2]];
  body.edges[2].curve={type:'line',origin:body.vertices[0],direction:body.vertices[1].map((v,i)=>v-body.vertices[0][i])};
  for(const angle of [0,Math.PI/2,Math.PI,3*Math.PI/2]){
    const p=[0,1].map(i=>radius*(x[i]*Math.cos(angle)+y[i]*Math.sin(angle)));
    assert.ok(Math.abs(Math.hypot(...p)-5)<1e-12);
  }
  const diagonal=[0,1].map(i=>radius*(x[i]+y[i])/Math.sqrt(2));
  assert.ok(Math.abs(Math.hypot(...diagonal)-5)>1);
  assert.equal((await expectKind(body,point(0.3,5),'Unresolved')).reason.$,'InputGap');
  // A repeated topological seam cannot hide a chord passing through the
  // cylinder. The complete seam curve is validated before cancellation.
  const badSeam=band();badSeam.edges[1].curve.x=[0,1,0];badSeam.vertices[1]=[0,5,10];
  badSeam.edges[2].curve={type:'line',origin:[5,0,0],direction:[-5,5,10]};
  assert.equal((await expectKind(badSeam,point(0.3,5),'Unresolved')).reason.$,'InputGap');
});

test('invalid topology, native frames, trims and unsupported seam curves fail explicitly',async()=>{
  const variants=[
    [b=>b.faces[0].loops[0].splice(1,1),'InvalidTopology'],
    [b=>{b.faces[0].loops=[];b.faces[0].outer=[];},'InvalidTopology'],
    [b=>b.faces[0].loops[0][0].edge=100,'InvalidIndex'],
    [b=>b.edges[0].start=100,'InvalidIndex'],
    [b=>b.edges[0].curve.x=[1,0,0.01],'InvalidInput'],
    [b=>b.faces[0].surface.radius=0,'InvalidInput'],
    [b=>b.faces[0].surface.axis=[0,0,0],'InvalidInput'],
    [b=>b.faces[0].surface={type:'plane',origin:[0,0,0],normal:[0,0,1],x:[1,0,0]},'NonCylindricalFace'],
  ];
  for(const [mutate,reason] of variants){
    const body=band();mutate(body);
    const result=await expectKind(body,point(0.3,5),'Unresolved');assert.equal(result.reason.$,reason);
    assert.throws(()=>requireResolvedCylinderClassification(result),UnsupportedFeatureError);
  }
  const panel=makeFace();addPanel(panel,-0.4,0.6,0,10);
  delete panel.edges[0].curveRange;
  assert.equal((await expectKind(panel,point(0.3,5),'Unresolved')).reason.$,'MissingTrim');
  assert.equal((await expectKind(panel,point(0.3,5),'Unresolved',{domains:[[1,0]]})).reason.$,'InvalidTrim');
  const duplicate=band();duplicate.faces[0].loops=[[{edge:0,forward:true},{edge:0,forward:false}]];
  assert.equal((await expectKind(duplicate,point(0.3,5),'Unresolved')).reason.$,'UnsupportedSeam');
  const unbounded=band();unbounded.faces[0].loops=[[{edge:0,forward:true}]];
  assert.equal((await expectKind(unbounded,point(0.3,5),'Unresolved')).reason.$,'UnbalancedMeridian');
  assert.equal((await classifyCylinderFace(band(),10,point(0.3,5))).reason.$,'InvalidIndex');
  await assert.rejects(classifyCylinderFace(band(),-1,point(0.3,5)),RangeError);
  const malformed=vector(point(0.3,5));malformed.x={ $:'Real',hi:1,lo:1 };
  assert.equal((await expectKind(band(),malformed,'Unresolved')).reason.$,'InvalidInput');
  const result=await expectKind(band(),point(0.3,5),'Inside');assert.equal(requireResolvedCylinderClassification(result),result);
});

test('frozen P10 cylindrical boundaries, original periodic loops and actual box placement classify analytically',async()=>{
  const file=new URL('../fixtures/r10b/modules/base/ZtoDD.body.json',import.meta.url),bytes=readFileSync(file);
  const hash='b78a8546970e360ee2a3a22661c87d4f9e835d24fe50cedeedde6a19add20dc9';
  assert.equal(createHash('sha256').update(bytes).digest('hex'),hash);
  const source=JSON.parse(bytes).bodies[0],k=await loadKernel();
  assert.deepEqual([source.vertices.length,source.edges.length,source.faces.length],[316,513,189]);
  const body=importOnshapeBody(k,source,'P10',{source:'frozen cylinder classification regression'});
  const native=encodeAnalytic(body),edges=array(native.edges);
  const cylinderFaces=body.faces.flatMap((face,i)=>face.surface.type==='cylinder'?[i]:[]);
  assert.equal(cylinderFaces.length,26);
  for(const face of cylinderFaces){
    const edge=body.faces[face].loops.flat().find(use=>body.edges[use.edge].curve.type!=='line').edge,e=body.edges[edge];
    const parameter=e.curveRange?(e.curveRange[0]+e.curveRange[1])/2:0.7;
    const query=k.analytic.curve_point(edges[edge].curve,real(parameter));
    const result=await classifyCylinderFace(body,face,query);
    assert.equal(result.$,'Boundary',JSON.stringify({face,edge,result}));assert.equal(result.edge,edge);
  }
  const elliptical=253,t=body.edges[elliptical].curveRange;
  assert.equal((await classifyCylinderFace(body,17,k.analytic.curve_point(edges[elliptical].curve,real((t[0]+t[1])/2)))).$,'Boundary');
  // Independent cylinder/plane formula for the two axial rim heights. The
  // imported closed curves determine a full bounded band for these faces.
  const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0),sub=(a,b)=>a.map((v,i)=>v-b[i]);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  for(const face of [83,110,111,169]){
    const f=body.faces[face],s=f.surface,y=cross(s.axis,s.x);
    const rims=[...new Set(f.loops.flat().map(use=>use.edge))].filter(edge=>body.edges[edge].curve.type!=='line');
    assert.equal(rims.length,2);
    for(const angle of [0,0.7,2.5,4.8]){
      const radial=s.origin.map((v,i)=>v+s.radius*(s.x[i]*Math.cos(angle)+y[i]*Math.sin(angle)));
      const heights=rims.map(edge=>{const c=body.edges[edge].curve;return dot(sub(c.origin,radial),c.normal)/dot(s.axis,c.normal);}).sort((a,b)=>a-b);
      const query=height=>radial.map((v,i)=>v+height*s.axis[i]);
      assert.equal((await classifyCylinderFace(body,face,query((heights[0]+heights[1])/2))).$,'Inside');
      assert.equal((await classifyCylinderFace(body,face,query(heights[0]-1))).$,'Outside');
      assert.equal((await classifyCylinderFace(body,face,query(heights[1]+1))).$,'Outside');
      if(face===110||face===169){
        const unseamed=structuredClone(body),indices=new Map(source.edges.map((e,i)=>[e.id,i]));
        unseamed.faces[face].loops=source.faces[face].loops.map(loop=>loop.coedges.map(use=>({edge:indices.get(use.edgeId),forward:use.orientation})));
        unseamed.faces[face].outer=source.faces[face].loops.map(loop=>loop.type==='outer');
        assert.deepEqual(unseamed.faces[face].outer,[false,false]);
        assert.equal((await classifyCylinderFace(unseamed,face,query((heights[0]+heights[1])/2))).$,'Inside');
      }
    }
  }
  const transformed=transformAnalytic(k,body,'g0',[
    [1,0,0],[0,0.9063077870366499,-0.42261826174069944],[0,0.42261826174069944,0.9063077870366499],
  ],[0,85.7915071334,-183.980480768]);
  const box=extrudeInBend(k,'g1',[[-119,4],[-92.79,4],[-92.79,46],[-119,46]],
    {origin:[0,0,-61],normal:[0,0,1],x:[1,0,0]},[0,0,129]);
  const converted=encodeAnalytic(transformed),convertedEdges=array(converted.edges),vertices=array(converted.vertices),F=await loadFaceClassifier();
  for(const [face,edge] of [[11,248],[17,254]]){
    const e=convertedEdges[edge],interval=F.auto_domain(e,vertices[e.start],vertices[e.end]).value;
    const cut=await intersectCurvePlane(e.curve,box.faces[3].surface,{interval});
    assert.equal(cut.$,'Resolved');assert.equal(cut.relation.$,'Crossing');
    const [hit]=array(cut.hits),result=await classifyCylinderFace(transformed,face,hit.point);
    assert.equal(result.$,'Boundary');assert.equal(result.edge,edge);
    assert.equal((await classifyPlanarFace(box,3,hit.point)).$,'Inside');
  }
  const arcRange=transformed.edges[488].curveRange;
  const inside=coords(k.analytic.curve_point(convertedEdges[488].curve,real((arcRange[0]+arcRange[1])/2)));
  inside[0]=box.faces[3].surface.origin[0];
  assert.equal((await classifyCylinderFace(transformed,11,inside)).$,'Inside');
  assert.equal((await classifyPlanarFace(box,3,inside)).$,'Inside');
  assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'),hash);
});

}
