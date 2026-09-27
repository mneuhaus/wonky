import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("planar-difference-native.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { createHash } = await import("node:crypto");
const { mkdirSync, readFileSync, writeFileSync } = await import("node:fs");




const root=new URL('../',import.meta.url),out=new URL('out/boolean-ports/planar-difference/production/',root);
mkdirSync(out,{recursive:true});
const {compileBend,manifestSourcePath}=await import(new URL('src/bend-loader.mjs',root));
const {loadKernel,array,list,extrudeInBend}=await import(new URL('src/kernel.mjs',root));
const {classificationInput}=await import(new URL('src/face-classification.mjs',root));
const {intersectionTolerance}=await import(new URL('src/intersections.mjs',root));
const {real,vector,number,coords}=await import(new URL('src/real.mjs',root));
const {toStep}=await import(new URL('src/exporters.mjs',root));
const {decodePlanarBoolean}=await import(new URL('src/planar-boolean.mjs',root));
const [compiled,k]=await Promise.all([compileBend(new URL('kernel/ports/planar-boolean.bend',root)),loadKernel()]);
const U=(await import(`data:text/javascript;base64,${Buffer.from(compiled.source).toString('base64')}#${compiled.key}`)).default;
const nativeManifest=JSON.parse(readFileSync(compiled.cachePath)).manifest;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),tolerance=intersectionTolerance(),frame={origin:[0,0,0],normal:[0,0,1],x:[1,0,0]};
const observations=[],probeRequests=[];
const near=(a,b,eps=1e-8)=>assert.ok(Math.abs(a-b)<=eps,`${a} != ${b}`);
const prism=(name,profile,height=2)=>extrudeInBend(k,name,profile,frame,[0,0,height]);
const box=(name,lo,hi)=>extrudeInBend(k,name,[[lo[0],lo[1]],[hi[0],lo[1]],[hi[0],hi[1]],[lo[0],hi[1]]],{...frame,origin:[0,0,lo[2]]},[0,0,hi[2]-lo[2]]);
const prepared=body=>({...classificationInput(body,k.faceClassifier),body});
const h1=()=>[prepared(prism('U',[[0,0],[1,0],[1,3],[2,3],[2,0],[3,0],[3,5],[0,5]])),prepared(box('tool',[-1,2,1],[4,3,4]))];
function evidence(){
  const nativeSourcesStable=nativeManifest.sources.every(s=>hash(readFileSync(manifestSourcePath(s.path,new URL('kernel/ports/planar-boolean.bend',root))))===s.sha256);
  assert.equal(nativeSourcesStable,true,'native sources remain unchanged during the focused suite');
  writeFileSync(new URL('evidence.json',out),JSON.stringify({schema:'wonky-planar-difference-native/1',scope:'Production native direct-input tests; unchanged-FeatureScript acceptance is checked separately',compiledKey:compiled.key,nativeManifest,nativeSourcesStable,observations},null,2)+'\n');
  writeFileSync(new URL('point-probes.json',out),JSON.stringify({schema:'wonky-solid-probes/1',toleranceMm:1e-7,models:probeRequests},null,2)+'\n');
}
function run(name,inputs,query=tolerance,operation='SUBTRACTION'){
  const before=JSON.stringify(inputs),[a,b]=inputs,start=performance.now();let result;
  try{result=U[operation==='SUBTRACTION'?'subtract':'union'](a.solid,a.domains,a.sourceBudget,b.solid,b.domains,b.sourceBudget,query);}catch(e){throw new Error(e.message);}
  assert.equal(JSON.stringify(inputs),before,'native operation preserves every source word/domain');
  writeFileSync(new URL(`${name}.native.json`,out),JSON.stringify(result)+'\n');
  const observation={name,operation,status:result.$,reason:result.reason?.$,stage:result.stage,detail:result.detail,stats:result.stats,elapsedMs:performance.now()-start,inputSha256:hash(before)};
  observations.push(observation);evidence();return {name,inputs,result,tolerance:query,operation,observation};
}
function nativeArea(part){
  let area=real(0);
  for(const f of array(part.solid.faces))area=U['../real.add'](area,U['curved-validate.loops_area'](f.loops,f.surface,f.same_sense,part.solid.edges,part.domains,part.solid.vertices));
  return number(area);
}
function check(r,volume,count=1,{area,probes=[],euler}={}){
  const {result,inputs,tolerance:query,operation,name}=r;
  assert.equal(result.$,'Bodies',JSON.stringify({status:result.$,reason:result.reason?.$,stage:result.stage,detail:result.detail}));assert.equal(number(result.source_budget),0);
  const parts=array(result.bodies);assert.equal(parts.length,count);let totalVolume=0,totalArea=0;const reversals=[];
  for(const [component,part] of parts.entries()){
    const audit=k.curved.audit(part.solid,part.domains,query,result.source_budget);assert.equal(audit.valid,true);assert.equal(U['curved-contact-topology.valid'](part.solid),true);
    assert.equal(U['../solid-classification.edges_closed'](part.solid.edges,part.solid.faces,0),true);
    const faces=array(part.solid.faces),edges=array(part.solid.edges),points=array(part.solid.vertices),origins=array(part.face_origins),edgeOrigins=array(part.edge_origins),domains=array(part.domains);
    assert.equal(origins.length,faces.length);assert.equal(edgeOrigins.length,edges.length);assert.equal(domains.length,edges.length);
    if(euler!==undefined)assert.equal(points.length-edges.length+faces.length,euler);
    for(const [index,origin] of origins.entries()){
      const refs=array(origin.contributors),key=x=>`${x.operand}/${x.index}`;
      assert.equal(new Set(refs.map(key)).size,refs.length);assert.ok(refs.some(x=>key(x)===key(origin.owner)));
      const source=array(inputs[origin.owner.operand].solid.faces)[origin.owner.index],reversed=operation==='SUBTRACTION'&&origin.owner.operand===1;
      assert.deepEqual(faces[index].surface,source.surface,'output retains the exact original carrier');
      assert.equal(faces[index].same_sense,reversed?!source.same_sense:source.same_sense,'only tool face sense is reversed');
      reversals.push({component,face:index,owner:origin.owner,reversed,contributors:refs.map(ref=>({...ref,reversed:operation==='SUBTRACTION'&&ref.operand===1}))});
      for(const ref of refs){const source=array(inputs[ref.operand].solid.faces)[ref.index];assert.equal(U['planar-boolean-arrangement.plane_equal'](source.surface,faces[index].surface),true);}
    }
    for(const [i,origin] of edgeOrigins.entries()){
      assert.equal(domains[i].$,'GivenDomain');assert.equal(domains[i].domain.$,'Interval');assert.ok(number(domains[i].domain.first)<number(domains[i].domain.last));
      if(origin.$==='OriginalEdge'){
        const source=inputs[origin.operand],edge=array(source.solid.edges)[origin.index],sourcePoints=array(source.solid.vertices);
        for(const p of [points[edges[i].start],points[edges[i].end]])assert.equal(U['occt-planar.near_segment'](p,sourcePoints[edge.start],sourcePoints[edge.end],audit.resolution),true);
      }else{
        const refs=origin.$==='FaceIntersection'?[origin.first,origin.second]:origin.$==='FaceSubdivision'?array(origin.faces):null;assert.ok(refs?.length);
        for(const ref of refs){const source=array(inputs[ref.operand].solid.faces)[ref.index],residual=U['curved-validate.edge_carrier'](edges[i],i,source.surface,part.domains,part.solid.vertices);assert.ok(number(residual)<=number(audit.allowance));}
      }
    }
    totalVolume+=number(k.solidIntersection.planar_measures(part.solid).volume);totalArea+=nativeArea(part);
  }
  near(totalVolume,volume);if(area!==undefined)near(totalArea,area);
  const classifications=[];
  for(const p of probes){
    const states=parts.map(part=>U['../solid-classification.classify'](part.solid,part.domains,vector(p.pointMm),query,result.source_budget).$);
    const state=states.includes('Unresolved')?'Unresolved':states.includes('Inside')?'Inside':states.includes('Boundary')?'Boundary':'Outside';
    assert.equal(state,p.classification,p.id);classifications.push({...p,observed:state,perBody:states});
  }
  const decoded=decodePlanarBoolean(result,name,k,query,inputs.map(p=>p.body),undefined,operation);
  for(const [i,body] of decoded.bodies.entries()){assert.equal(body.construction.operation,operation);body.validation.areaMm2=nativeArea(parts[i]);}
  if(parts.length){
    const model={schema:'wonky-brep/1',units:'millimeter',backend:{language:'Bend',version:'2.0.25'},scope:'Production native subtraction focused test',bodies:decoded.bodies};
    writeFileSync(new URL(`${name}.brep.json`,out),JSON.stringify(model,null,2)+'\n');writeFileSync(new URL(`${name}.step`,out),toStep(model,name));
    if(probes.length)probeRequests.push({prefix:new URL(name,out).pathname,points:probes.map(({id,pointMm})=>({id,pointMm}))});
  }
  writeFileSync(new URL(`${name}.orientation.json`,out),JSON.stringify(reversals,null,2)+'\n');
  Object.assign(r.observation,{bodies:parts.length,volumeMm3:totalVolume,areaMm2:totalArea,classifications});evidence();return {parts,decoded,reversals};
}
function unresolved(r,stage){assert.equal(r.result.$,'Unresolved');assert.equal(r.result.bodies,undefined);if(stage!==undefined)assert.equal(r.result.stage,stage);return r.result;}

test('cut-h1 retains its exact source/oracles and constructs the two original open recesses',()=>{
  const manifest=JSON.parse(readFileSync(new URL('fixtures/public-boolean-regressions/manifest.json',root))),fixture=manifest.cases.find(c=>c.id==='cut-h1');
  for(const [path,digest] of [[fixture.source,fixture.sourceSha256],[fixture.originalSource,fixture.originalSourceSha256]])assert.equal(hash(readFileSync(new URL(`fixtures/public-boolean-regressions/${path}`,root))),digest);
  const {parts,reversals}=check(run('cut-h1',h1()),fixture.expected.volumeMm3,1,{area:fixture.expected.areaMm2,probes:fixture.expected.probes,euler:2});
  const bounds=k.solidIntersection.planar_measures(parts[0].solid).bounds;assert.deepEqual(coords(bounds.low),fixture.expected.boundsMm.min);assert.deepEqual(coords(bounds.high),fixture.expected.boundsMm.max);
  assert.ok(reversals.some(r=>r.reversed),'recess faces come from the reversed original tool');assert.ok(reversals.some(r=>!r.reversed),'retained original target faces remain');
});

test('subtraction is asymmetric and its swapped result is independently closed',()=>{
  check(run('cut-h1-swapped',h1().toReversed()),13,1,{area:46,probes:[
    {id:'swapped/tool-only',pointMm:[-0.5,2.5,1.5],classification:'Inside'},
    {id:'swapped/overlap',pointMm:[0.5,2.5,1.5],classification:'Outside'},
    {id:'swapped/upper',pointMm:[1.5,2.5,3],classification:'Inside'},
  ]});
});

test('disjoint/tangent tools retain material and full coverage produces an honest empty result',()=>{
  const a=prepared(box('target',[0,0,0],[2,2,2]));
  check(run('disjoint-noop',[a,prepared(box('tool',[3,0,0],[4,2,2]))]),8,1,{area:24});
  check(run('tangent-noop',[a,prepared(box('tool',[2,0,0],[4,2,2]))]),8,1,{area:24});
  check(run('identical-empty',[a,a]),0,0);
  check(run('enclosing-empty',[a,prepared(box('tool',[-1,-1,-1],[3,3,3]))]),0,0);
});

test('a slicing tool returns both complete remaining bodies and a through hole has one connected handle shell',()=>{
  check(run('separate-remnants',[prepared(box('target',[0,0,0],[4,2,2])),prepared(box('slice',[1,-1,-1],[3,3,3]))]),8,2,{area:32,probes:[
    {id:'remnants/left',pointMm:[0.5,1,1],classification:'Inside'},
    {id:'remnants/right',pointMm:[3.5,1,1],classification:'Inside'},
    {id:'remnants/cut',pointMm:[2,1,1],classification:'Outside'},
  ],euler:2});
  check(run('through-hole',[prepared(box('target',[0,0,0],[4,4,4])),prepared(box('tool',[1,1,-1],[3,3,5]))]),48,1,{area:120,euler:0,probes:[
    {id:'hole/material',pointMm:[0.5,2,2],classification:'Inside'},
    {id:'hole/void',pointMm:[2,2,2],classification:'Outside'},
    {id:'hole/wall',pointMm:[1,2,2],classification:'Boundary'},
  ]});
});

test('negative inner shells reject the entire cavity operation without publishing its positive outside shell',()=>{
  const r=unresolved(run('enclosed-void',[prepared(box('target',[0,0,0],[4,4,4])),prepared(box('inner',[1,1,1],[3,3,3]))]),10);
  assert.equal(r.reason.$,'UnsupportedArrangement');assert.ok(r.stats.boundary_faces>6);
});

test('source budgets, invalid topology and unresolved small gaps remain atomic failures',()=>{
  const a=prepared(box('target',[0,0,0],[2,2,2])),b=prepared(box('tool',[1,1,1],[3,3,3]));
  assert.equal(unresolved(run('budget-rejected',[{...a,sourceBudget:real(1e-7)},b]),0).reason.$,'SourceTolerance');
  assert.equal(unresolved(run('negative-budget-rejected',[a,{...b,sourceBudget:real(-1e-7)}]),0).reason.$,'InvalidInput');
  assert.equal(unresolved(run('open-rejected',[{...a,solid:{...a.solid,faces:list(array(a.solid.faces).slice(1))}},b]),1).reason.$,'InvalidTopology');
  const touching=prepared(box('near',[2,0,0],[3,2,2])),identity={$:'Rotation',x:vector([1,0,0]),y:vector([0,1,0]),z:vector([0,0,1])};
  unresolved(run('subresolution-gap',[a,{...touching,solid:k.analytic.transform(touching.solid,identity,vector([2**-40,0,0]))}]));
});

test('the full trim guard uses output orientation for reversed tool faces',()=>{
  const tool=prepared(prism('C',[[0,0],[10,0],[10,3],[2,3],[2,4],[10,4],[10,10],[0,10]])),target=prepared(box('other',[20,20,0],[21,21,1]));
  const face=array(tool.solid.faces)[1],resolution=U['../real.max'](U['curved-validate.resolution'](target.solid),U['curved-validate.resolution'](tool.solid));
  const context={$:'Context',first:target.solid,ad:target.domains,second:tool.solid,bd:tool.domains,tolerance,resolution,subtraction:true};
  for(const [name,points,valid] of [
    ['inside-centroid',[[0,0,2],[10,0,2],[10,10,2],[0,10,2]],false],
    ['outside-centroid',[[1,3,2],[9,3,2],[9,4,2],[1,4,2]],false],
    ['covered',[[0,4,2],[10,4,2],[10,10,2],[0,10,2]],true],
  ]){
    const polygon={$:'Polygon',surface:face.surface,sense:!face.same_sense,vertices:list([3,2,1,0])};
    const found=U['planar-boolean-provenance.owners'](polygon,list(points.map(vector)),context);assert.equal(found.valid,valid,name);
    if(valid)assert.deepEqual(array(found.refs),[{$:'FaceRef',operand:1,index:1}]);
  }
});

}
