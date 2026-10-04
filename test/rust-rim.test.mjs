// Consumer boundary: rim patches must survive native transport, placement,
// serialization and independent STEP reimport (not merely native integrals).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
process.env.WONKY_BACKEND='rust';
const {build}=await import('../src/index.mjs');
const {toStep,toStl}=await import('../src/exporters.mjs');
const {serializeModel}=await import('../src/construction-history.mjs');
const {describeRustBody,measureRustBody,rustModelKernel}=await import('../src/native/rust-host.mjs');
const root=fileURLToPath(new URL('../',import.meta.url));
const source=body=>`FeatureScript 3044; import(path:"onshape/std/geometry.fs",version:"3044.0");
export const f=defineFeature(function(context is Context,id is Id,definition is map) precondition {} {${body}});`;
// An eight-piece rounded rectangle, with rational 3-4-5 arc witnesses.
// Its area is 20*12-(4-pi)*5^2; no trigonometric fixture rounding.
const keyPrism=height=>`var s=newSketchOnPlane(context,id+"s",{"sketchPlane":plane(vector(0,0,0)*meter,vector(0,0,1),vector(1,0,0))});
const p=[vector(0,-5),vector(10,-5),vector(15,0),vector(15,2),vector(10,7),vector(0,7),vector(-5,2),vector(-5,0)];
const mid=[vector(13,-4),vector(14,5),vector(-3,6),vector(-4,-3)];
for(var k=0;k<8;k+=1) {
  if(k%2==0)skLineSegment(s,"l"~k,{"start":p[k]*meter,"end":p[(k+1)%8]*meter});
  else skArc(s,"a"~k,{"start":p[k]*meter,"mid":mid[(k-1)/2]*meter,"end":p[(k+1)%8]*meter});
}
skSolve(s);opExtrude(context,id+"post",{"entities":qSketchRegion(id+"s"),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":${height}*meter});
const rim=qCoincidesWithPlane(qOwnedByBody(qCreatedBy(id+"post",EntityType.BODY),EntityType.EDGE),plane(vector(0,0,${height})*meter,vector(0,0,1)));`;
const keyFillet=radius=>`opFillet(context,id+"rim",{"entities":rim,"radius":${radius}*meter});`;
function meshVolumeMm3(stl) {
  const data=new DataView(stl.buffer,stl.byteOffset,stl.byteLength);
  const edges=new Map();
  let volume=0;
  for(let f=0;f<data.getUint32(80,true);f++) {
    const p=[0,1,2].map(j=>[0,1,2].map(k=>data.getFloat32(84+50*f+12+12*j+4*k,true)));
    volume+=(p[0][0]*(p[1][1]*p[2][2]-p[1][2]*p[2][1])+p[0][1]*(p[1][2]*p[2][0]-p[1][0]*p[2][2])+p[0][2]*(p[1][0]*p[2][1]-p[1][1]*p[2][0]))/6;
    const keys=p.map(v=>JSON.stringify(v));
    assert.equal(new Set(keys).size,3,'binary STL must have no collapsed triangle');
    for(let j=0;j<3;j++) {
      const a=keys[j],b=keys[(j+1)%3],forward=a<b;
      const key=forward?`${a}|${b}`:`${b}|${a}`;
      const edge=edges.get(key)??{uses:0,sense:0};
      edge.uses++;edge.sense+=forward?1:-1;edges.set(key,edge);
    }
  }
  for(const [key,edge] of edges) {
    assert.equal(edge.uses,2,`binary STL boundary at ${key}`);
    assert.equal(edge.sense,0,`binary STL winding at ${key}`);
  }
  return volume;
}
function assertChamferPcurveIncidence(model) {
  const body=describeRustBody(rustModelKernel(model),model.bodies[0]).body;
  const number=bits=>Buffer.from(bits,'hex').readDoubleBE();
  const vector=v=>v.map(number);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  for(const co of body.coedges) {
    const pc=body.pcurves[co.pcurve],g=body.surfaces[pc.surface].geometry;
    if(pc.geometry.kind!=='Line'||!['Plane','ConeMeridian'].includes(g.kind))continue;
    const origin=vector(g.origin),x=vector(g.x),axis=vector(g.kind==='Plane'?g.normal:g.axis),y=cross(axis,x);
    const edge=body.edges[co.edge];
    for(const [j,uv] of [pc.geometry.a,pc.geometry.b].map(vector).entries()) {
      let at;
      if(g.kind==='Plane')at=origin.map((o,k)=>o+x[k]*uv[0]+y[k]*uv[1]);
      else {
        const [r0,z0]=vector(g.start),[r1,z1]=vector(g.end);
        const radius=r0+(r1-r0)*(uv[1]-z0)/(z1-z0);
        const turn=(uv[0]%1+1)%1;
        const trig=new Map([[0,[1,0]],[0.25,[0,1]],[0.5,[-1,0]],[0.75,[0,-1]]]).get(turn);
        assert.ok(trig,'fixture pcurve ends must be cardinal, not trigonometric approximations');
        at=origin.map((o,k)=>o+axis[k]*uv[1]+radius*(x[k]*trig[0]+y[k]*trig[1]));
      }
      const expected=vector(body.vertices[edge.vertices[j]].point);
      assert.ok(at.every((v,k)=>v===expected[k]),`${g.kind} pcurve ${JSON.stringify(at)} != ${JSON.stringify(expected)}`);
    }
  }
}
const frameAxes=[
  'vector(1,0,0),vector(0,0,1)',
  'vector(0,0,1),vector(0,-1,0)',
  'vector(0.9953610106153096,0.08075849942674315,-0.05229266982293196),vector(0.05443374184663523,-0.024540530893688527,0.9982157733135806)',
];
test('convex tangent rims export sewn toroidal and cylindrical patches in placed frames',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wonky-rim-step-'));
  try{
    const prefixes=[];
    for(const [index,{axes,bottom}] of frameAxes.flatMap(axes=>[{axes,bottom:false},{axes,bottom:true}]).entries()){
      const model=await build(source(`
        const cs=coordSystem(vector(65536.25,-32768.5,16384.125)*millimeter,${axes});
        const axis=toWorld(cs).linear*vector(0,0,1);
        var s=newSketchOnPlane(context,id+"s",{"sketchPlane":plane(toWorld(cs,vector(0,0,0)*meter),axis,cs.xAxis)});
        skLineSegment(s,"a",{"start":vector(0.125,0)*meter,"end":vector(0.5,0)*meter});
        skLineSegment(s,"b",{"start":vector(0.5,0)*meter,"end":vector(0.625,0)*meter});
        skArc(s,"c",{"start":vector(0.625,0)*meter,"mid":vector(0.75,0.125)*meter,"end":vector(0.625,0.25)*meter});
        skLineSegment(s,"d",{"start":vector(0.625,0.25)*meter,"end":vector(0.125,0.25)*meter});
        skArc(s,"e",{"start":vector(0.125,0.25)*meter,"mid":vector(0,0.125)*meter,"end":vector(0.125,0)*meter});
        skSolve(s);
        opExtrude(context,id+"post",{"entities":qSketchRegion(id+"s"),"direction":axis,"endBound":BoundingType.BLIND,"endDepth":0.5*meter});
        const body=qCreatedBy(id+"post",EntityType.BODY);
        const rim=qCoincidesWithPlane(qOwnedByBody(body,EntityType.EDGE),plane(toWorld(cs,vector(0,0,${bottom?0:0.5})*meter),axis));
        opFillet(context,id+"rim",{"entities":rim,"radius":0.03125*meter});
      `),{feature:'f'});
      const m=measureRustBody(rustModelKernel(model),model.bodies[0]);
      assert.equal(m.certificate,'ConvexTangentRim');
      assert.equal(m.topology.faces,12);
      assert.equal(m.topology.edges,25);
      assert.equal(m.topology.vertices,15);
      const meshVolume=meshVolumeMm3(toStl(model,{deviationMm:0.3}));
      assert.ok(meshVolume>0&&Math.abs(meshVolume-m.volumeMm3)<m.volumeMm3*0.002);
      const prefix=path.join(dir,`rim-${index}`);
      fs.writeFileSync(prefix+'.step',toStep(model,'rim'));
      fs.writeFileSync(prefix+'.brep.json',serializeModel(model));
      prefixes.push(prefix);
    }
    const key=await build(source(keyPrism(4)+keyFillet(0.5)),{feature:'f'});
    const volume=measureRustBody(rustModelKernel(key),key.bodies[0]).volumeMm3;
    // Integrate removed strips: L*r²*(1-pi/4)-K*r³*(5/6-pi/4), K=2pi.
    const removed=(24+10*Math.PI)*0.25*(1-Math.PI/4)-2*Math.PI*0.125*(5/6-Math.PI/4);
    const expected=(4*(140+25*Math.PI)-removed)*1e9;
    assert.ok(Math.abs(volume-expected)<=expected*1e-11,`${volume} != ${expected}`);
    const prefix=path.join(dir,'rounded-key');
    const step=toStep(key,'rounded-key');
    assert.equal(step.match(/TOROIDAL_SURFACE\(/g)?.length,4);
    const stl=toStl(key,{deviationMm:2});
    assert.ok(stl.length>84);
    // The mesh is approximate, but it must be closed and have the solid's
    // winding and volume, not the unfilleted prism's top face.
    const meshVolume=meshVolumeMm3(stl);
    assert.ok(meshVolume>0&&Math.abs(meshVolume-expected)<expected*0.002,`${meshVolume} != ${expected}`);
    fs.writeFileSync(prefix+'.step',step);
    fs.writeFileSync(prefix+'.brep.json',serializeModel(key));
    prefixes.push(prefix);
    const result=spawnSync('uv',['run',path.join(root,'scripts/validate-step.py'),...prefixes],{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});
    assert.equal(result.status,0,result.stderr||result.stdout||String(result.error));
    assert.equal(JSON.parse(result.stdout).length,prefixes.length);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('equal-offset cap chamfer sweeps line planes and arc cones, with closed-form volume and exports',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wonky-cap-chamfer-'));
  try {
    const model=await build(source(keyPrism(4)+`opChamfer(context,id+"rim",{"entities":rim,"chamferType":ChamferType.EQUAL_OFFSETS,"width":0.5*meter});`),{feature:'f'});
    // Integrating A(t)=A0-P*t+pi*t² over the one-width cap band removes
    // P*w²/2-pi*w³/3. The shape is neither a loft nor a faceted arc.
    const expected=(4*(140+25*Math.PI)-(24+10*Math.PI)*0.25/2+Math.PI*0.125/3)*1e9;
    const m=measureRustBody(rustModelKernel(model),model.bodies[0]);
    assertChamferPcurveIncidence(model);
    assert.ok(Math.abs(m.volumeMm3-expected)<=expected*1e-11);
    const step=toStep(model,'cap-chamfer');
    assert.equal(step.match(/CONICAL_SURFACE\(/g)?.length,4);
    assert.ok(toStl(model,{deviationMm:2}).length>84);
    const prefix=path.join(dir,'cap-chamfer');
    fs.writeFileSync(prefix+'.step',step);
    fs.writeFileSync(prefix+'.brep.json',serializeModel(model));
    const result=spawnSync('uv',['run',path.join(root,'scripts/validate-step.py'),prefix],{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:8<<20});
    assert.equal(result.status,0,result.stderr||result.stdout||String(result.error));
    assert.equal(JSON.parse(result.stdout).length,1);
    await assert.rejects(build(source(keyPrism(4)+`opChamfer(context,id+"rim",{"entities":rim,"chamferType":ChamferType.EQUAL_OFFSETS,"width":4*meter});`),{feature:'f'}),
      e=>e.name==='RustCapabilityError'&&e.reason==='fillet/rim-height-consumed');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('lower cap bands reflect exact geometry, centroid and sewn exports rather than blend the upper cap',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wonky-lower-band-'));
  try {
    const prefixes=[];
    for(const chamfer of [false,true]) {
      const blend=chamfer
        ? `opChamfer(context,id+"rim",{"entities":rim,"chamferType":ChamferType.EQUAL_OFFSETS,"width":0.5*meter});`
        : keyFillet(0.5);
      const top=await build(source(keyPrism(4)+blend),{feature:'f'});
      const lowerSource=keyPrism(4).replace('plane(vector(0,0,4)*meter,vector(0,0,1))','plane(vector(0,0,0)*meter,vector(0,0,1))');
      const lower=await build(source(lowerSource+blend+`
const boundary=qOwnedByBody(qCreatedBy(id+"post",EntityType.BODY),EntityType.EDGE);
// The lower inset and original upper circles have different radii and levels.
// A query in the trim interior must select exactly one, not use top-rim levels.
for(var p in [vector(12.7,-3.6,0),vector(13,-4,4)]) {
  if(size(evaluateQuery(context,qClosestTo(boundary,p*meter)))!=1)throw "lower arc query lost source chart";
}`),{feature:'f'});
      const a=measureRustBody(rustModelKernel(top),top.bodies[0]);
      const b=measureRustBody(rustModelKernel(lower),lower.bodies[0]);
      if(chamfer)assertChamferPcurveIncidence(lower);
      assert.ok(Math.abs(a.volumeMm3-b.volumeMm3)<=a.volumeMm3*1e-12);
      assert.ok(Math.abs(a.areaMm2-b.areaMm2)<=a.areaMm2*1e-12);
      assert.ok(Math.abs(a.centroidMm[2]+b.centroidMm[2]-4000)<1e-8);
      assert.ok(b.centroidMm[2]>2000&&a.centroidMm[2]<2000);
      assert.ok(Math.abs(a.centroidMm[0]-b.centroidMm[0])<1e-8);
      assert.ok(Math.abs(a.centroidMm[1]-b.centroidMm[1])<1e-8);
      const stl=toStl(lower,{deviationMm:2});
      const volume=meshVolumeMm3(stl);
      assert.ok(volume>0&&Math.abs(volume-b.volumeMm3)<b.volumeMm3*0.002);
      const prefix=path.join(dir,chamfer?'lower-chamfer':'lower-fillet');
      fs.writeFileSync(prefix+'.step',toStep(lower,'lower'));
      fs.writeFileSync(prefix+'.brep.json',serializeModel(lower));
      prefixes.push(prefix);
    }
    const result=spawnSync('uv',['run',path.join(root,'scripts/validate-step.py'),...prefixes],{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:8<<20});
    assert.equal(result.status,0,result.stderr||result.stdout||String(result.error));
    assert.equal(JSON.parse(result.stdout).length,2);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

// Same public source, distinct representability and reach contracts. A refusal
// here must identify the radius constraint, not fail in an unrelated query.
test('cap fillets name torus radius inexactness and adjacent-face reach',async()=>{
  for(const [height,radius,reason] of [
    [4,0.1,'fillet/rim-torus-radius-not-binary64'],
    [4,4,'fillet/rim-height-consumed'],
    [8,5.5,'fillet/rim-offset-curvature'],
  ]) {
    await assert.rejects(build(source(keyPrism(height)+keyFillet(radius)),{feature:'f'}),
      e=>e.name==='RustCapabilityError'&&e.reason===reason);
  }
});
