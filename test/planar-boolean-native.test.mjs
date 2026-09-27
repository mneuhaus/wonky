import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend() || missing("fixtures/boolean-stress/r10b-g7-operands.json");
if (publicTreeSkip) {
  test("planar-boolean-native.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { createHash } = await import("node:crypto");
const { mkdirSync, readFileSync, writeFileSync } = await import("node:fs");




const root=new URL('../',import.meta.url);
const {compileBend,manifestSourcePath}=await import(new URL('src/bend-loader.mjs',root));
const {loadKernel,array,list,extrudeInBend}=await import(new URL('src/kernel.mjs',root));
const {classificationInput}=await import(new URL('src/face-classification.mjs',root));
const {intersectionTolerance}=await import(new URL('src/intersections.mjs',root));
const {real,vector,number,coords}=await import(new URL('src/real.mjs',root));
const {decodePlanarBoolean}=await import(new URL('src/planar-boolean.mjs',root));
const {decodeAnalytic}=await import(new URL('src/analytic.mjs',root));
const {toStep}=await import(new URL('src/exporters.mjs',root));
const [compiled,k]=await Promise.all([compileBend(new URL('kernel/ports/planar-boolean.bend',root)),loadKernel()]);
const U=(await import(`data:text/javascript;base64,${Buffer.from(compiled.source).toString('base64')}#${compiled.key}`)).default;
const manifest=JSON.parse(readFileSync(compiled.cachePath)).manifest;
const out=new URL('out/boolean-ports/planar-boolean/',root);mkdirSync(out,{recursive:true});
const tolerance=intersectionTolerance(),frame={origin:[0,0,0],normal:[0,0,1],x:[1,0,0]};
const observations=[],hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const near=(a,b,eps=1e-10)=>assert.ok(Math.abs(a-b)<=eps*Math.max(1,Math.abs(b)),`${a} != ${b}`);
const prism=(name,profile,height=2)=>extrudeInBend(k,name,profile,frame,[0,0,height]);
const box=(name,lo,hi)=>extrudeInBend(k,name,[[lo[0],lo[1]],[hi[0],lo[1]],[hi[0],hi[1]],[lo[0],hi[1]]],{...frame,origin:[0,0,lo[2]]},[0,0,hi[2]-lo[2]]);
const prepared=body=>({...classificationInput(body,k.faceClassifier),body});
const identity={$:'Rotation',x:vector([1,0,0]),y:vector([0,1,0]),z:vector([0,0,1])};
function evidence(){
  writeFileSync(new URL('evidence.json',out),JSON.stringify({schema:'wonky-planar-boolean-focused/1',compiledKey:compiled.key,nativeManifest:manifest,nativeSourcesStable:manifest.sources.every(s=>hash(readFileSync(manifestSourcePath(s.path,new URL('kernel/ports/planar-boolean.bend',root))))===s.sha256),observations},null,2)+'\n');
}
function run(name,inputs,query=tolerance){
  const before=JSON.stringify(inputs),[a,b]=inputs,start=performance.now();
  const result=U.union(a.solid,a.domains,a.sourceBudget,b.solid,b.domains,b.sourceBudget,query),elapsedMs=performance.now()-start;
  assert.equal(JSON.stringify(inputs),before,'native UNION does not modify source words or domains');
  writeFileSync(new URL(`${name}.native.json`,out),JSON.stringify(result)+'\n');
  observations.push({name,status:result.$,reason:result.reason?.$,stage:result.stage,detail:result.detail,stats:result.stats,elapsedMs,inputSha256:hash(before)});evidence();
  return {name,inputs,result,tolerance:query};
}
function checked(run,volume,count=1,{emit=true}={}){
  const {name,inputs,result:r,tolerance:query}=run;
  assert.equal(r.$,'Bodies',JSON.stringify({status:r.$,reason:r.reason?.$,stage:r.stage,detail:r.detail}));assert.equal(number(r.source_budget),0);
  const parts=array(r.bodies);assert.equal(parts.length,count);let actual=0;
  for(const part of parts){
    const audit=k.curved.audit(part.solid,part.domains,query,r.source_budget);assert.equal(audit.valid,true);assert.equal(U['curved-contact-topology.valid'](part.solid),true);
    actual+=number(k.solidIntersection.planar_measures(part.solid).volume);
    const faces=array(part.solid.faces),edges=array(part.solid.edges),origins=array(part.face_origins),sources=inputs.map(p=>array(p.solid.faces));
    assert.equal(origins.length,faces.length);assert.equal(array(part.edge_origins).length,edges.length);assert.equal(array(part.domains).length,edges.length);
    for(const [i,origin] of origins.entries()){
      assert.ok(array(origin.contributors).some(ref=>ref.operand===origin.owner.operand&&ref.index===origin.owner.index));
      assert.deepEqual(faces[i].surface,sources[origin.owner.operand][origin.owner.index].surface);
      assert.equal(faces[i].same_sense,sources[origin.owner.operand][origin.owner.index].same_sense);
    }
    for(const [i,origin] of array(part.edge_origins).entries()){
      const refs=origin.$==='FaceIntersection'?[origin.first,origin.second]:origin.$==='FaceSubdivision'?array(origin.faces):[];
      if(origin.$==='FaceIntersection')assert.notDeepEqual(origin.first,origin.second);
      for(const ref of refs){
        const residual=U['curved-validate.edge_carrier'](edges[i],i,sources[ref.operand][ref.index].surface,part.domains,part.solid.vertices);
        assert.ok(number(residual)<=number(audit.allowance));
      }
      if(origin.$==='OriginalEdge'){
        const source=inputs[origin.operand],edge=array(source.solid.edges)[origin.index],points=array(part.solid.vertices);
        for(const p of [points[edges[i].start],points[edges[i].end]])assert.ok(k.analytic.curve_residual(edge.curve,p)<=number(audit.allowance));
      }
    }
  }
  near(actual,volume);
  if(emit){
    const host=inputs.map(p=>p.body??decodeAnalytic(p.solid,'input',k)),decoded=decodePlanarBoolean(r,name,k,query,host);
    run.decoded=decoded;
    const model={schema:'wonky-brep/1',units:'millimeter',backend:{language:'Bend',version:'2.0.25'},bodies:decoded.bodies};
    writeFileSync(new URL(`${name}.brep.json`,out),JSON.stringify(model,null,2)+'\n');writeFileSync(new URL(`${name}.step`,out),toStep(model,name));
  }
  return parts;
}
function unresolved(run){
  assert.equal(run.result.$,'Unresolved');assert.equal(run.result.bodies,undefined);return run.result;
}

test('planar UNION selects coplanar regions once and removes a partial shared face',()=>{
  const a=prepared(box('a',[0,0,0],[4,4,2]));
  for(const [name,b,volume] of [
    ['coplanar-overlap',box('b',[2,1,0],[6,3,2]),40],
    ['partial-face-contact',box('b',[4,1,0],[8,3,2]),48],
    ['identical',box('b',[0,0,0],[4,4,2]),32],
  ]){
    const inputs=[a,prepared(b)];
    for(const order of [0,1])checked(run(`${name}-${order}`,order?inputs.toReversed():inputs),volume);
  }
});

test('nonconvex UNION can create a handle without emitting overlapping source bodies',()=>{
  const u=prepared(prism('U',[[0,0],[8,0],[8,6],[6,6],[6,2],[2,2],[2,6],[0,6]])),bridge=prepared(box('bridge',[1,4,0],[7,5,2]));
  const [body]=checked(run('U-handle',[u,bridge]),72);
  assert.equal(array(body.solid.vertices).length-array(body.solid.edges).length+array(body.solid.faces).length,0);
});

test('disjoint and vertex-touching components are complete; an edge-only nonmanifold join is unresolved',()=>{
  const a=prepared(box('unit',[0,0,0],[1,1,1]));
  checked(run('disjoint',[a,prepared(box('other',[2,0,0],[3,1,1]))]),2,2);
  checked(run('vertex-contact',[a,prepared(box('other',[1,1,1],[2,2,2]))]),2,2);
  const bad=unresolved(run('edge-contact',[a,prepared(box('other',[1,1,0],[2,2,1]))]));assert.equal(bad.stage,7);
});

test('near contacts preserve real positive gaps or return an atomic resolution failure',()=>{
  const a=prepared(box('a',[0,0,0],[1,1,1])),b=prepared(box('b',[1,0,0],[2,1,1]));
  for(const [delta,query,accepted] of [[2**-12,tolerance,true],[2**-28,intersectionTolerance({linear:1e-10}),true],[2**-40,tolerance,false]]){
    const moved={...b,body:undefined,solid:k.analytic.transform(b.solid,identity,vector([delta,0,0]))};
    const r=run(`gap-${delta}`,[a,moved],query);if(accepted)checked(r,2,2);else unresolved(r);
  }
});

test('invalid shells, unsupported families and nonzero source ceilings reject before geometry publication',()=>{
  const a=prepared(box('a',[0,0,0],[4,4,2])),b=prepared(box('b',[2,1,0],[6,3,2]));
  const open={...a,solid:{...a.solid,faces:list(array(a.solid.faces).slice(1))}};
  assert.equal(unresolved(run('invalid-open',[open,b])).reason.$,'InvalidTopology');
  assert.equal(unresolved(run('source-budget',[{...a,sourceBudget:real(1e-7)},b])).reason.$,'SourceTolerance');
  assert.equal(unresolved(run('negative-budget',[{...a,sourceBudget:real(-1e-7)},b])).reason.$,'InvalidInput');
  const duplicated={...a,solid:{...a.solid,faces:list([...array(a.solid.faces),array(a.solid.faces)[0]])}};
  assert.equal(unresolved(run('duplicate-face',[duplicated,b])).reason.$,'InvalidTopology');
});

test('trimmed face ownership rejects concave notches and partial contributors that point samples miss',()=>{
  const source=prepared(prism('C-profile',[[0,0],[10,0],[10,3],[2,3],[2,4],[10,4],[10,10],[0,10]]));
  const other=prepared(box('disjoint',[20,20,0],[21,21,1])),face=array(source.solid.faces)[1];
  const resolution=U['../real.max'](U['curved-validate.resolution'](source.solid),U['curved-validate.resolution'](other.solid));
  const context={$:'Context',first:source.solid,ad:source.domains,second:other.solid,bd:other.domains,tolerance,resolution,subtraction:false};
  const sample=point=>U['planar-boolean-provenance.on_face'](source.solid,face,source.domains,vector(point),tolerance).$;
  const corners=[[0,0,2],[10,0,2],[10,10,2],[0,10,2]];
  assert.equal(sample([5,5,2]),'Inside');
  for(const point of corners)assert.ok(['Inside','Boundary'].includes(sample(point)),'the old corner samples all pass');
  const cases=[
    {name:'inside-centroid-crosses-notch',points:corners,valid:false},
    {name:'outside-centroid-partial-contributor',points:[[1,3,2],[9,3,2],[9,4,2],[1,4,2]],valid:false},
    {name:'wholly-covered-control',points:[[0,4,2],[10,4,2],[10,10,2],[0,10,2]],valid:true},
  ];
  assert.equal(sample([5,3.5,2]),'Outside');
  for(const {name,points,valid} of cases){
    const polygon={$:'Polygon',surface:face.surface,sense:face.same_sense,vertices:list([0,1,2,3])};
    const result=U['planar-boolean-provenance.owners'](polygon,list(points.map(vector)),context);
    writeFileSync(new URL(`trim-${name}.native.json`,out),JSON.stringify(result)+'\n');
    assert.equal(result.valid,valid,name);
    if(valid)assert.deepEqual(array(result.refs),[{$:'FaceRef',operand:0,index:1}]);
    observations.push({name:`trim-${name}`,status:result.$,valid:result.valid});evidence();
  }
});

test('frozen actual g7 in both orders and sequential g9 satisfy their analytic UNION oracles',()=>{
  const path=new URL('fixtures/boolean-stress/r10b-g7-operands.json',root),bytes=readFileSync(path);
  assert.equal(hash(bytes),'1ac9496d29364343e9a55ae2e1d2b03a6209fa69d35e1d128c570464d72e7cd7');
  const inputs=JSON.parse(bytes).bodies.map(({body})=>prepared(body));
  let forward;
  for(const order of [0,1]){
    const r=run(`g7-${order}`,order?inputs.toReversed():inputs),[body]=checked(r,51985.642486572266);
    assert.equal(array(body.solid.vertices).length-array(body.solid.edges).length+array(body.solid.faces).length,2);
    const metrics=k.solidIntersection.planar_measures(body.solid);
    for(const [actual,expected] of [[coords(metrics.bounds.low),[-93.30000305175781,0,-15]],[coords(metrics.bounds.high),[93.30000305175781,25,48]]])actual.forEach((x,i)=>near(x,expected[i]));
    assert.ok(array(body.face_origins).some(o=>array(o.contributors).length===2),'the overlapping z=48 patch retains both trimmed source contributors');
    if(order===0)forward={solid:body.solid,domains:body.domains,sourceBudget:r.result.source_budget,body:r.decoded.bodies[0]};
  }
  const offset=[-180.79000091552734,0,0];
  const leftSolid=k.analytic.transform(inputs[1].solid,identity,vector(offset));
  // Serialize the precise implicit source. Its raw line directions use [0,1]
  // parameter domains, so it is not a normalized analytic output body.
  const leftBody={id:'left-rib',vertices:array(leftSolid.vertices).map(coords),edges:structuredClone(inputs[1].body.edges),
    faces:array(leftSolid.faces).map((f,i)=>({...structuredClone(inputs[1].body.faces[i]),surface:{type:'plane',origin:coords(f.surface.origin),normal:coords(f.surface.normal),x:coords(f.surface.x)}})),
    shell:structuredClone(inputs[1].body.shell)};
  const left={...inputs[1],body:leftBody,solid:leftSolid};
  assert.deepEqual(classificationInput(leftBody,k.faceClassifier).solid,left.solid,'native transformed source and host source encode identically');
  const [body]=checked(run('g9-sequential',[forward,left]),56948.083435058594);
  assert.equal(array(body.solid.vertices).length-array(body.solid.edges).length+array(body.solid.faces).length,2);
});

}
