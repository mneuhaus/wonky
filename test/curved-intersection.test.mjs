import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend() || missing("fixtures/r10b/modules/base/ZtoDD.body.json");
if (publicTreeSkip) {
  test("curved-intersection.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { createHash } = await import("node:crypto");
const { mkdirSync, readFileSync, writeFileSync } = await import("node:fs");
const { compileBend, loadBend, manifestSourcePath } = await import("../src/bend-loader.mjs");
const { loadKernel, array, list, extrudeInBend } = await import("../src/kernel.mjs");
const { classificationInput } = await import("../src/face-classification.mjs");
const { intersectionTolerance } = await import("../src/intersections.mjs");
const { importOnshapeBody, transformAnalytic } = await import("../src/analytic.mjs");
const { real, vector, number, coords } = await import("../src/real.mjs");











const entry=new URL('../kernel/ports/curved-intersection.bend',import.meta.url);
const [compiled,C,T,k]=await Promise.all([compileBend(entry),loadBend(new URL('../kernel/ports/curved.bend',import.meta.url)),loadBend(new URL('../kernel/ports/curved-contact-topology.bend',import.meta.url)),loadKernel()]);
const O=(await import(`data:text/javascript;base64,${Buffer.from(compiled.source).toString('base64')}#${compiled.key}`)).default;
const manifest=JSON.parse(readFileSync(compiled.cachePath)).manifest;
const out=new URL('../out/boolean-ports/curved-intersection-test/',import.meta.url);mkdirSync(out,{recursive:true});
const tolerance=intersectionTolerance(),strict={$:'StrictTransverse'},regularized=cap=>({$:'ToleratedRegularized',contact_cap:real(cap)});
const angularGuard=C['../intersections.angular_guard'](),length=v=>k.real.sqrt(k.precise.dot(v,v));
const frame={origin:[0,0,0],normal:[0,0,1],x:[1,0,0]},profile=[[0,0],[8,0],[8,6],[6,6],[6,2],[2,2],[2,6],[0,6]];
const source=()=>extrudeInBend(k,'sequence-U',profile,frame,[0,0,4]);
const box=(lo,hi)=>extrudeInBend(k,'sequence-tool',[[lo[0],lo[1]],[hi[0],lo[1]],[hi[0],hi[1]],[lo[0],hi[1]]],{...frame,origin:[0,0,lo[2]]},[0,0,hi[2]-lo[2]]);
const prepare=(body,budget)=>{const p=classificationInput(body,k.faceClassifier);return {solid:p.solid,domains:p.domains,sourceBudget:budget??p.sourceBudget};};
const near=(a,b,eps=1e-9)=>assert.ok(Math.abs(a-b)<=eps*Math.max(1,Math.abs(b)),`${a} != ${b}`);
const observations=[];
function call(inputs,policy,sourceOperand=0){
  const before=JSON.stringify(inputs),[a,b]=inputs,start=performance.now();
  const result=O.intersect(a.solid,a.domains,a.sourceBudget,b.solid,b.domains,b.sourceBudget,tolerance,policy);
  assert.equal(JSON.stringify(inputs),before);assert.deepEqual(result.policy,policy);assert.deepEqual(result.source_budget,inputs[sourceOperand].sourceBudget);
  return {inputs,policy,sourceOperand,result,elapsedMs:performance.now()-start};
}
function faceRef(ref,inputs){
  assert.equal(ref.$,'FaceRef');assert.ok(ref.operand===0||ref.operand===1);assert.ok(ref.index<array(inputs[ref.operand].solid.faces).length);
}
function edgeRef(ref,inputs){
  if(ref.$==='OriginalEdge'){assert.ok(ref.operand===0||ref.operand===1);assert.ok(ref.index<array(inputs[ref.operand].solid.edges).length);}
  else if(ref.$==='SurfaceSeam')faceRef(ref.face,inputs);
  else {assert.equal(ref.$,'FaceIntersection');faceRef(ref.first,inputs);faceRef(ref.second,inputs);}
}
function steps(run){
  const {inputs,result:r,sourceOperand,policy}=run,values=array(r.steps);
  let previous=-1;
  for(const s of values){
    faceRef(s.cut,inputs);assert.equal(s.cut.operand,1-sourceOperand);assert.ok(s.cut.index>=previous);previous=s.cut.index;
    const plane=array(inputs[s.cut.operand].solid.faces)[s.cut.index];
    assert.deepEqual(s.origin,plane.surface.origin);
    const outward=k.precise.scale(plane.surface.normal,real(plane.same_sense?1:-1));assert.deepEqual(s.normal,outward);
    array(s.source_faces).forEach(ref=>faceRef(ref,inputs));array(s.source_edges).forEach(ref=>edgeRef(ref,inputs));
    assert.ok(array(s.source_vertices).length>0);
    if(s.method.$==='RegularizedContact'){
      assert.equal(policy.$,'ToleratedRegularized');assert.deepEqual(s.method.policy.contact_cap,policy.contact_cap);
      assert.deepEqual(s.method.policy.source_budget,r.source_budget);assert.deepEqual(s.method.policy.tolerance,tolerance);
      assert.equal(s.method.ledger.version,1);assert.ok(['AmbiguousContact','UnsupportedArrangement'].includes(s.method.strict_reason.$));
      for(const c of array(s.method.ledger.components))near(number(c.audit.allowance),number(r.source_budget)+number(c.audit.resolution),1e-13);
    }else assert.equal(s.method.$,'Transverse');
  }
  if(policy.$==='StrictTransverse')assert.ok(values.every(s=>s.method.$==='Transverse'));
  return values;
}
function unresolved(run){
  const r=run.result;assert.equal(r.$,'Unresolved');assert.equal(r.bodies,undefined);assert.equal(r.solid,undefined);steps(run);return r;
}
function surfaceOrigin(bodyFace,ref,inputs,budget){
  const expected=array(inputs[ref.operand].solid.faces)[ref.index],actual=bodyFace.surface;
  assert.equal(actual.$,expected.surface.$);
  if(actual.$==='Plane'){
    const a=coords(actual.normal).map(x=>x*(bodyFace.same_sense?1:-1)),b=coords(expected.surface.normal).map(x=>x*(expected.same_sense?1:-1));
    near(a.reduce((s,x,i)=>s+x*b[i],0)/(Math.hypot(...a)*Math.hypot(...b)),1,1e-10);
    const p=coords(actual.origin),q=coords(expected.surface.origin),gap=Math.abs(p.reduce((s,x,i)=>s+(x-q[i])*b[i],0)/Math.hypot(...b));
    assert.ok(gap<=budget+1e-9);
  }else if(actual.$==='Cylinder'){
    assert.equal(bodyFace.same_sense,expected.same_sense);
    assert.deepEqual(actual.origin,expected.surface.origin);assert.deepEqual(actual.radius,expected.surface.radius);
    // Strict transverse construction canonicalizes these directions. Check
    // their unit vectors within the native angular rounding guard; neither
    // source uncertainty, query tolerance nor contact cap enlarges this bound.
    for(const key of ['axis','x']){
      const gap=length(k.precise.sub(actual[key],k.precise.normalize(expected.surface[key])));
      assert.ok(number(gap)<=number(angularGuard),`cylinder ${key} changed by ${number(gap)}`);
    }
  }else assert.deepEqual(actual,expected.surface);
}
function checked(run,expectedVolume,count){
  const r=run.result;assert.equal(r.$,'Bodies',JSON.stringify({status:r.$,reason:r.reason?.$,face:r.face}));steps(run);
  const bodies=array(r.bodies);if(count!==undefined)assert.equal(bodies.length,count);let volume=0;
  for(const b of bodies){
    const audit=C.audit(b.solid,b.domains,tolerance,r.source_budget);assert.equal(audit.valid,true);assert.equal(T.valid(b.solid),true);
    assert.ok(number(audit.required)<=number(audit.allowance));near(number(audit.allowance),number(r.source_budget)+number(audit.resolution),1e-13);volume+=number(audit.volume);
    const edges=array(b.solid.edges),faces=array(b.solid.faces),fo=array(b.face_origins),eo=array(b.edge_origins);
    assert.equal(array(b.domains).length,edges.length);assert.equal(fo.length,faces.length);assert.equal(eo.length,edges.length);
    fo.forEach((ref,i)=>{faceRef(ref,run.inputs);surfaceOrigin(faces[i],ref,run.inputs,number(r.source_budget));});eo.forEach(ref=>edgeRef(ref,run.inputs));
    const incidence=edges.map(()=>[]);faces.forEach((f,index)=>array(f.loops).forEach(l=>array(l.uses).forEach(u=>incidence[u.edge].push({face:index,forward:u.forward}))));incidence.forEach(pair=>assert.deepEqual(pair.map(u=>u.forward).toSorted(),[false,true]));
    for(const [i,ref] of eo.entries()){
      if(ref.$==='OriginalEdge'){
        const curve=array(run.inputs[ref.operand].solid.edges)[ref.index].curve,e=edges[i],vertices=array(b.solid.vertices);
        for(const point of [vertices[e.start],vertices[e.end]])assert.ok(k.analytic.curve_residual(curve,point)<=number(r.source_budget)+1e-9);
      }else{
        const carriers=ref.$==='SurfaceSeam'?[ref.face]:[ref.first,ref.second];
        for(const origin of carriers){
          const surface=array(run.inputs[origin.operand].solid.faces)[origin.index].surface;
          const residual=C['curved-validate.edge_carrier'](edges[i],i,surface,b.domains,b.solid.vertices);
          assert.ok(number(residual)<=number(audit.allowance),`${ref.$} edge ${i} misses operand ${origin.operand} face ${origin.index}: ${number(residual)} > ${number(audit.allowance)}`);
        }
        if(ref.$==='SurfaceSeam'){
          assert.equal(incidence[i][0].face,incidence[i][1].face,'a periodic seam has opposite uses in one face');
          assert.equal(faces[incidence[i][0].face].surface.$,'Cylinder');
          assert.deepEqual(fo[incidence[i][0].face],ref.face);
        }
      }
    }
  }
  if(expectedVolume!==undefined)near(volume,expectedVolume);return bodies;
}
function save(name,run){
  writeFileSync(new URL(`${name}.native.json`,out),JSON.stringify(run.result)+'\n');
  const r=run.result;observations.push({name,compiledKey:compiled.key,elapsedMs:run.elapsedMs,status:r.$,reason:r.reason?.$,face:r.face,sourceOperand:run.sourceOperand,sourceBudgetMm:number(r.source_budget),policy:r.policy,bodyCount:r.bodies?array(r.bodies).length:0,volumes:r.bodies?array(r.bodies).map(b=>number(C.volume(b.solid,b.domains))):[],steps:array(r.steps).map(s=>({cut:s.cut,inputComponent:s.input_component,method:s.method.$,contactStage:s.method.ledger?.stage,components:s.components}))});
  const stable=manifest.sources.every(s=>createHash('sha256').update(readFileSync(manifestSourcePath(s.path,entry))).digest('hex')===s.sha256);
  writeFileSync(new URL('evidence.json',out),JSON.stringify({schema:'wonky-curved-intersection-focused/1',compiledKey:compiled.key,nativeSourcesStable:stable,nativeManifest:manifest,observations},null,2)+'\n');
}

test('explicit contact sequence preserves multiple components and original operand provenance in either order',()=>{
  const inputs=[prepare(source(),real(2e-7)),prepare(box([-1,2,-1],[9,7,5]))];
  for(const sourceOperand of [0,1]){
    const pair=sourceOperand?inputs.toReversed():inputs,r=call(pair,regularized(1e-7),sourceOperand),bodies=checked(r,64,2),s=steps(r);
    assert.equal(s.length,9);const contact=s.find(s=>s.method.$==='RegularizedContact');assert.equal(contact.cut.index,2);assert.equal(contact.components,2);
    for(const index of [3,4,5])assert.deepEqual(s.filter(s=>s.cut.index===index).map(s=>s.input_component),[0,1]);
    for(const b of bodies){assert.ok(array(b.face_origins).some(r=>r.operand===1-sourceOperand&&r.index===2));assert.ok(array(b.edge_origins).some(r=>r.$==='FaceIntersection'));}
    save(`U-${sourceOperand?'swapped':'forward'}`,r);
  }
});

test('strict contact rejection is atomic even after an earlier plane split and one surviving component',()=>{
  const r=call([prepare(source()),prepare(box([-1,3,-1],[8,7,5]))],strict),failed=unresolved(r),s=steps(r);
  assert.equal(failed.face,3);assert.ok(s.some(s=>s.cut.index===2&&s.components===2));
  const last=s.filter(s=>s.cut.index===3);assert.deepEqual(last.map(s=>s.input_component),[0,1]);assert.equal(last[0].components,1);assert.equal(last[1].components,0);
  save('later-component-failure',r);
});

test('an explicit cap never raises the inherited construction budget in a later sequence plane',()=>{
  const l=prepare(extrudeInBend(k,'budget-L',[[0,0],[4,0],[4,2],[2,2],[2,6],[0,6]],frame,[0,0,4])),base=prepare(box([-1,2,-1],[5,7,5]));
  const rotation={$:'Rotation',x:vector([1,0,0]),y:vector([0,1,0]),z:vector([0,0,1])};
  const tool={...base,solid:k.analytic.transform(base.solid,rotation,vector([0,2e-8,0]))};
  for(const cap of [1e-7,1e-6]){
    const r=call([l,tool],regularized(cap)),failed=unresolved(r),s=steps(r),last=s.at(-1);
    assert.equal(failed.face,2);assert.ok(s.slice(0,-1).every(s=>s.components===1));assert.equal(last.method.$,'RegularizedContact');assert.equal(last.method.ledger.stage,6);
    assert.ok(array(last.method.ledger.components).some(c=>number(c.audit.required)>number(c.audit.allowance)));save(`budget-reject-${cap}`,r);
  }
  const accepted=call([{...l,sourceBudget:real(1e-7)},tool],regularized(1e-7));checked(accepted,undefined,1);save('budget-explicitly-sufficient',accepted);
});

test('empty results retain the explicit policy, removing cutter and coordinate witnesses without a body',()=>{
  const input=prepare(source(),real(1e-7));
  for(const [name,lo,policy,method] of [['separated',6,strict,'Transverse'],['contact',4,regularized(1e-7),'RegularizedContact']]){
    const r=call([input,prepare(box([-1,-1,lo],[9,7,lo+2]))],policy);checked(r,0,0);
    const s=steps(r);assert.equal(s.length,1);assert.equal(s[0].components,0);assert.equal(s[0].method.$,method);assert.equal(s[0].cut.index,0);
    assert.deepEqual(s[0].source_vertices,input.solid.vertices);assert.deepEqual(coords(s[0].origin),[-1,-1,lo]);assert.deepEqual(coords(s[0].normal),[0,0,-1]);
    if(method==='RegularizedContact'){assert.equal(s[0].method.ledger.stage,7);assert.equal(array(s[0].method.ledger.components).length,0);assert.ok(array(s[0].method.ledger.vertices).length>0);}
    assert.deepEqual(JSON.parse(JSON.stringify(r.result)),r.result);save(`empty-${name}`,r);
  }
});

test('curved contact failure after transverse cuts keeps history and discards the whole result',()=>{
  const cylinder=k.analytic.frustum(vector([0,0,0]),vector([0,0,10]),vector([1,0,0]),real(5),real(5));
  const r=call([prepare(cylinder),prepare(box([-6,-6,1],[5,6,9]))],regularized(1e-7)),failed=unresolved(r),s=steps(r);
  assert.equal(failed.face,3);assert.equal(s.length,4);assert.ok(s.slice(0,3).every(s=>s.components===1));assert.equal(s.at(-1).method.$,'RegularizedContact');assert.equal(s.at(-1).method.ledger.stage,2);save('later-curved-contact-failure',r);
});

test('sequence validates explicit cap and operand budgets before it chooses a source',()=>{
  const [a,b]=[prepare(source()),prepare(box([-1,2,-1],[9,7,5]))];
  for(const cap of [-1e-12,.10001]){
    const p=regularized(cap),r=O.intersect(a.solid,a.domains,a.sourceBudget,b.solid,b.domains,b.sourceBudget,tolerance,p);assert.equal(r.$,'Unresolved');assert.equal(r.reason.$,'InvalidInput');assert.equal(r.bodies,undefined);assert.deepEqual(r.policy,p);assert.equal(array(r.steps).length,0);
  }
  for(const budget of [-1e-12,.10001]){
    const r=O.intersect(a.solid,a.domains,real(budget),b.solid,b.domains,b.sourceBudget,tolerance,regularized(1e-7));assert.equal(r.$,'Unresolved');assert.equal(r.reason.$,'InvalidInput');assert.equal(r.bodies,undefined);
  }
});

function p10Operands(){
  const bytes=readFileSync(new URL('../fixtures/r10b/modules/base/ZtoDD.body.json',import.meta.url)),sha=createHash('sha256').update(bytes).digest('hex');assert.equal(sha,'b78a8546970e360ee2a3a22661c87d4f9e835d24fe50cedeedde6a19add20dc9');
  const body=transformAnalytic(k,importOnshapeBody(k,JSON.parse(bytes).bodies[0],'sequence-P10',{sha256:sha}),'sequence-g0',[[1,0,0],[0,0.9063077870366499,-0.42261826174069944],[0,0.42261826174069944,0.9063077870366499]],[0,85.7915071334,-183.980480768]);
  const inputs=[prepare(body),prepare(box([-119,4,-61],[-92.79000091552734,46,68]))];
  // Matched once, bit for bit, against the actual failed g2/op operands:
  // out/acceptance-pcurves/first-failure-operands.json, SHA b282eb76…428f.
  // The permanent test regenerates these operands; it does not depend on out.
  assert.equal(createHash('sha256').update(JSON.stringify(inputs)).digest('hex'),'b7e9fe267994402a8005935e26516dc92e5b2209ddb2efebe015faa66ce19ac9');return inputs;
}

test('actual P10 box sequence rejects strict contact and solves all six planes under a preselected explicit policy',()=>{
  const inputs=p10Operands(),rejected=call(inputs,strict);save('P10-strict',rejected);
  const failed=unresolved(rejected);assert.equal(failed.tool,1);assert.equal(failed.face,2);assert.equal(array(failed.steps).length,3);
  const forward=call(inputs,regularized(1e-7));save('P10-forward',forward);
  const backward=call(inputs.toReversed(),regularized(1e-7),1);save('P10-swapped',backward);
  for(const r of [forward,backward]){
    const [body]=checked(r,30269.952370419458,1),s=steps(r);assert.equal(s.length,6);assert.deepEqual(s.map(s=>s.cut.index),[0,1,2,3,4,5]);
    assert.deepEqual([array(body.solid.vertices).length,array(body.solid.edges).length,array(body.solid.faces).length],[90,135,50]);
    assert.equal(array(body.edge_origins).filter(ref=>ref.$==='SurfaceSeam').length,7);
    const contact=s.filter(s=>s.method.$==='RegularizedContact');assert.equal(contact.length,1);assert.equal(contact[0].cut.index,2);assert.equal(contact[0].method.ledger.stage,7);
    assert.ok(array(contact[0].source_faces).some(ref=>ref.operand===contact[0].cut.operand&&ref.index===1),'the earlier top cap retains its original tool-face identity');
    assert.ok(array(contact[0].source_edges).some(ref=>ref.$==='FaceIntersection'&&[ref.first,ref.second].some(f=>f.operand===contact[0].cut.operand&&f.index===1)),'earlier top-cut edges keep composed face provenance');
    const vertices=array(contact[0].method.ledger.vertices).filter(v=>v.kind===0);assert.ok(vertices.length>0);assert.ok(vertices.every(v=>v.exact.sign.$==='Negative'));
  }
  const a=array(forward.result.bodies)[0],b=array(backward.result.bodies)[0];assert.deepEqual(a.solid,b.solid);assert.deepEqual(a.domains,b.domains);
  const flipFace=f=>({...f,operand:1-f.operand}),flipEdge=e=>e.$==='OriginalEdge'?{...e,operand:1-e.operand}:e.$==='SurfaceSeam'?{...e,face:flipFace(e.face)}:{...e,first:flipFace(e.first),second:flipFace(e.second)};
  assert.deepEqual(array(a.face_origins).map(flipFace),array(b.face_origins));assert.deepEqual(array(a.edge_origins).map(flipEdge),array(b.edge_origins));
});

}
