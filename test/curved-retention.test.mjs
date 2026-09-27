import test, {after} from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("curved-retention.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { mkdirSync, writeFileSync } = await import("node:fs");
const { loadBend } = await import("../src/bend-loader.mjs");
const { loadKernel, array, list } = await import("../src/kernel.mjs");
const { decodeAnalytic } = await import("../src/analytic.mjs");
const { intersectionTolerance } = await import("../src/intersections.mjs");
const { real, vector, number, coords } = await import("../src/real.mjs");
const { toStep } = await import("../src/exporters.mjs");
const { booleanPortCases } = await import("../scripts/boolean-port-cases.mjs");











const [O,RT,k]=await Promise.all([loadBend(new URL('../kernel/ports/curved.bend',import.meta.url)),loadBend(new URL('../kernel/ports/curved-retention.bend',import.meta.url)),loadKernel()]);
const output=new URL('../out/boolean-ports/curved-retention/',import.meta.url),observations=[],exports=[];
mkdirSync(output,{recursive:true});
const nil=list([]),zero=real(0),tolerance=intersectionTolerance();
const cylinder=()=>k.analytic.frustum(vector([0,0,0]),vector([0,0,10]),vector([1,0,0]),real(5),real(5));
const near=(a,b,eps=2e-9)=>assert.ok(Math.abs(a-b)<=eps*Math.max(1,Math.abs(b)),`${a} != ${b}`);
function shiftedSeams(angle){
  const s=cylinder(),vs=array(s.vertices),es=array(s.edges),fs=array(s.faces);
  vs[1]=vector([5*Math.cos(angle),5*Math.sin(angle),10]);
  fs[2].loops=list([0,1].map(i=>({$:'Loop',outer:true,uses:list([{$:'Use',edge:i,forward:i===0}])})));
  s.vertices=list(vs);s.edges=list(es.slice(0,2));s.faces=list(fs);return s;
}
function run(name,solid,origin,normal,options={}){
  const domains=options.domains??nil,tol=options.tolerance??tolerance,budget=options.budget??zero,before=structuredClone(solid),beforeDomains=structuredClone(domains);
  const audit=O.audit(solid,domains,tol,budget),disposition=RT.classify(solid,domains,vector(origin),vector(normal),tol,budget,audit.resolution);
  const result=O.clip(solid,domains,vector(origin),vector(normal),tol,budget);
  assert.deepEqual(solid,before);assert.deepEqual(domains,beforeDomains);
  observations.push({name,sourceValid:audit.valid,sourceVolume:number(audit.volume),resolution:number(audit.resolution),sourceBudget:number(budget),queryLinear:number(tol.linear),disposition:disposition.$,status:result.$,reason:result.reason?.$});
  return {result,audit,disposition,solid,domains,tol,budget};
}
function retained(run){
  const {result:r,solid,domains,tol,budget}=run;assert.equal(run.audit.valid,true);assert.equal(run.disposition.$,'Retained');assert.equal(r.$,'Clipped');assert.deepEqual(r.solid,solid);
  const es=array(solid.edges),fs=array(solid.faces),vs=array(solid.vertices),choices=array(domains),ds=array(r.domains);
  assert.deepEqual(array(r.face_origins),fs.map((_,index)=>({$:'SourceFace',index})));
  assert.deepEqual(array(r.edge_origins),es.map((_,index)=>({$:'SourceEdge',index})));assert.equal(ds.length,es.length);
  es.forEach((e,i)=>{const expected=k.faceClassifier.resolve_domain(choices[i]??{$:'AutoDomain'},e,vs[e.start],vs[e.end]);assert.equal(expected.$,'Some');assert.deepEqual(ds[i],{$:'GivenDomain',domain:expected.value});});
  assert.equal(O.audit(r.solid,r.domains,tol,budget).valid,true);near(number(O.volume(r.solid,r.domains)),number(run.audit.volume));return r;
}
function exportRetained(run,name,expectedVolume,cylinderAreas=false){
  const r=retained(run),audit=O.audit(r.solid,r.domains,run.tol,run.budget),exportTolerance=Math.max(.0003,number(audit.allowance));
  const body=decodeAnalytic(r.solid,name,k,array(r.solid.vertices).map(()=>exportTolerance));
  body.validation.volumeMm3=expectedVolume;
  array(r.domains).forEach((choice,i)=>{if(choice.domain.$==='Interval')body.edges[i].curveRange=[number(choice.domain.first),number(choice.domain.last)];});
  if(cylinderAreas)body.referenceMeasurements={source:'independent exact radius-5 height-10 cylinder formulas',faceAreasMm2:[25*Math.PI,25*Math.PI,100*Math.PI],facePerimetersMm:[10*Math.PI,10*Math.PI,20*Math.PI],faceTolerancesMm:[exportTolerance,exportTolerance,exportTolerance]};
  body.construction={method:'Bend complete retained source',sourceBudgetMm:number(run.budget),requiredIncidenceMm:number(audit.required),allowanceMm:number(audit.allowance),exportToleranceMm:exportTolerance,faceOrigins:array(r.face_origins),edgeOrigins:array(r.edge_origins)};
  const model={schema:'wonky-brep/1',units:'millimeter',backend:{language:'Bend',version:'2.0.25'},bodies:[body]};
  writeFileSync(new URL(`${name}.brep.json`,output),JSON.stringify(model,null,2)+'\n');writeFileSync(new URL(`${name}.step`,output),toStep(model,name));exports.push(name);
}

test('complete retained cylinders preserve independently shifted periodic seam vertices',()=>{
  for(const [name,angle] of [['aligned',0],['shifted-small',.3],['shifted-quarter',Math.PI/2],['shifted-opposite',Math.PI]]){
    const solid=shiftedSeams(angle),kept=run(name,solid,[0,0,12],[0,0,1]);
    exportRetained(kept,name,250*Math.PI,true);
    const removed=run(`${name}-removed`,solid,[0,0,-2],[0,0,1]);assert.equal(removed.disposition.$,'Removed');assert.deepEqual(removed.result,{$:'Empty'});
  }
});

test('returned domains are explicit without changing supplied parameters, supports, frames or indices',()=>{
  const solid=cylinder(),es=array(solid.edges),fs=array(solid.faces);
  es[2].curve.origin=vector([5,0,-10]);es[2].curve.direction=vector([0,0,2]);solid.edges=list(es);
  fs[0].surface.normal=vector([0,0,3]);fs[0].surface.x=vector([2,0,0]);fs[2].surface.axis=vector([0,0,-4]);solid.faces=list(fs);
  const choices=list([{$:'GivenDomain',domain:{$:'Untrimmed'}},{$:'AutoDomain'},{$:'GivenDomain',domain:{$:'Interval',first:real(5),last:real(10)}}]);
  const kept=retained(run('given-line-domain',solid,[0,0,12],[0,0,7],{domains:choices}));
  assert.deepEqual(array(kept.domains)[2],array(choices)[2]);assert.deepEqual(coords(array(kept.solid.edges)[2].curve.direction),[0,0,2]);
  const automatic=retained(run('automatic-line-domain',solid,[0,0,12],[0,0,1]));assert.deepEqual(automatic.domains,kept.domains);
});

test('complete curve and cylinder bounds prevent vertex-only retained or empty results',()=>{
  for(const normal of [[1,0,0],[-1,0,0]]){
    const solid=cylinder();assert.ok(array(solid.vertices).every(p=>coords(p)[0]===5));
    const r=run(`interior-extrema-${normal[0]}`,solid,[0,0,0],normal);
    assert.equal(r.disposition.$,'Undecided');assert.equal(r.result.$,'Clipped');assert.notDeepEqual(r.result.solid,solid);near(number(O.volume(r.result.solid,r.result.domains)),125*Math.PI);
  }
});

test('strict complete-source decisions include source budget and query separation margins',()=>{
  const budget=real(.001),tol=intersectionTolerance({linear:.00001});
  for(const [z,expected] of [[10.0005,'Undecided'],[10.003,'Retained'],[-.0005,'Undecided'],[-.003,'Removed']]){
    const r=run(`budget-margin-${z}`,shiftedSeams(.3),[0,0,z],[0,0,1],{budget,tolerance:tol});assert.equal(r.disposition.$,expected);
    if(expected==='Retained')retained(r);if(expected==='Removed')assert.equal(r.result.$,'Empty');
  }
  const offset=cylinder();array(offset.faces)[0].surface.origin=vector([0,0,-.0005]);
  const nearBudget=run('displaced-source-within-margin',offset,[0,0,-.0006],[0,0,-1],{budget,tolerance:tol});assert.equal(nearBudget.audit.valid,true);assert.equal(nearBudget.disposition.$,'Undecided');
  retained(run('displaced-source-separated',offset,[0,0,-.003],[0,0,-1],{budget,tolerance:tol}));
  const contact=run('exact-cap-contact',cylinder(),[0,0,10],[0,0,1]);assert.equal(contact.disposition.$,'Undecided');assert.equal(contact.result.$,'Unresolved');
});

test('arithmetic separation guard scales with coordinates and uncertain preparation stays undecided',()=>{
  const rotation={$:'Rotation',x:vector([1,0,0]),y:vector([0,1,0]),z:vector([0,0,1])};
  const solid=k.analytic.transform(shiftedSeams(.3),rotation,vector([0,0,10000]));
  const close=run('scaled-guard-close',solid,[0,0,10010+1.5e-7],[0,0,1]);assert.equal(close.audit.valid,true);assert.equal(close.disposition.$,'Undecided');
  retained(run('scaled-guard-separated',solid,[0,0,10010+1e-5],[0,0,1]));
  const origin=vector([0,0,1e9]),a=O.audit(solid,nil,tolerance,zero);
  assert.equal(RT.classify(solid,nil,origin,vector([0,0,1]),tolerance,zero,a.resolution).$,'Undecided');
  assert.equal(RT.separated(true,{$:'UnknownBounds'}).$,'Undecided');
});

test('retention preserves bounded conic ranges and permits subsequent clipping',()=>{
  const source=cylinder(),first=O.clip(source,nil,vector([1,0,0]),vector([1,0,0]),tolerance,zero);assert.equal(first.$,'Clipped');
  const area=25*Math.PI/2+Math.sqrt(24)+25*Math.asin(.2),kept=run('bounded-arcs-retained',first.solid,[0,0,12],[0,0,1],{domains:first.domains});
  exportRetained(kept,'bounded-arcs',area*10);assert.deepEqual(kept.result.domains,first.domains);
  const again=O.clip(kept.result.solid,kept.result.domains,vector([0,0,5]),vector([0,0,1]),tolerance,zero);assert.equal(again.$,'Clipped');near(number(O.volume(again.solid,again.domains)),area*5);
  exportRetained(run('original-generator-seam',source,[0,0,12],[0,0,1]),'original-generator-seam',250*Math.PI);
});

test('invalid, inward and zero-volume sources cannot use either complete-body path',async()=>{
  const invalid=cylinder();array(invalid.faces)[2].surface.x=vector([0,0,1]);
  const inward=cylinder();for(const f of array(inward.faces)){f.same_sense=!f.same_sense;for(const l of array(f.loops))l.uses=list(array(l.uses).toReversed().map(u=>({...u,forward:!u.forward})));}
  const zeroVolume=(await booleanPortCases({imported:false})).find(c=>c.id==='zero-volume-shell').body;
  for(const [name,solid,domains] of [['invalid-surface',invalid,nil],['inward',inward,nil],['zero-volume',zeroVolume,nil],['invalid-domain',cylinder(),list([{$:'AutoDomain'},{$:'AutoDomain'},{$:'GivenDomain',domain:{$:'Interval',first:zero,last:real(2)}}])]]){
    for(const z of [-2,12]){const r=run(`${name}-${z}`,solid,[0,0,z],[0,0,1],{domains});assert.equal(r.audit.valid,false);assert.deepEqual(r.result,{$:'Unresolved',reason:{$:'InvalidTopology'}});}
  }
  for(const [options,reason] of [[{budget:real(.2)},'SourceTolerance'],[{tolerance:intersectionTolerance({linear:0})},'InvalidInput']]){
    for(const z of [-2,12]){const r=O.clip(cylinder(),nil,vector([0,0,z]),vector([0,0,1]),options.tolerance??tolerance,options.budget??zero);assert.deepEqual(r,{$:'Unresolved',reason:{$:reason}});}
  }
});

after(()=>writeFileSync(new URL('observations.json',output),JSON.stringify({schema:'wonky-curved-retention-tests/1',observations,exports},null,2)+'\n'));

}
