import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {cpuMeasured} from './support/cpu-budget.mjs';
import {volume,zero,sum,identity,binary64,q} from './support/boolean-identities.mjs';
import {generators,source,operation} from './support/boolean-identity-generators.mjs';
process.env.WONKY_BACKEND='rust';
const {build}=await import('../src/index.mjs');
const {measureRustBody,rustModelKernel,GeometryRefusal,placeRustBody,bindRustModel}=await import('../src/native/rust-host.mjs');
const {ModelingContext}=await import('../src/library.mjs');
const {Interpreter}=await import('../src/interpreter.mjs');
const {parse}=await import('../src/parser.mjs');
const {Id,map}=await import('../src/values.mjs');
async function operand(c,which) {
  const model=await build(source(c[which]),{feature:'f'});
  if(which==='a' && c.rational) model.bodies=model.bodies.map(b=>placeRustBody(rustModelKernel(model),b,{rational:c.rational}));
  return model;
}
async function boolean(c,op) {
  if(!c.rational) return build(source(c.a+c.b+operation(op)),{feature:'f'});
  // FS has no exact rational-frame constructor. Generate its actual operands
  // with FS, place with the public rational API, then execute unmodified
  // opBoolean syntax through the same parser/interpreter and host builtins.
  const a=await operand(c,'a'),b=await operand(c,'b'),kernel=rustModelKernel(a);
  const engine=new ModelingContext(kernel);
  for(const [name,model] of [['a',a],['b',b]]) for(const body of model.bodies) engine.addSolid(new Id(['model',name]),body);
  new Interpreter(engine.builtins()).run(parse(source(operation(op))),'f',engine.context,new Id(['model']),()=>map({}));
  const model={bodies:engine.bodies};bindRustModel(model,kernel);return model;
}
const ops=['UNION','INTERSECTION','SUBTRACTION'];
const baseline=JSON.parse(fs.readFileSync(new URL('./support/boolean-identity-refusals.json',import.meta.url)));
function measure(model) {
  const kernel=rustModelKernel(model), measures=model.bodies.map(b=>measureRustBody(kernel,b));
  return {value:measures.map(volume).reduce(sum,zero()),certificates:[...new Set(measures.map(m=>m.certificate))].sort()};
}

test('Boolean volume identities through unmodified FeatureScript (exact rationals or published enclosures)',async()=>{
  // Warm sweep measured 12.72 CPU seconds on the Studio and 7.74–9.33 on
  // the MacBook under load. Three fresh sweeps used 23.61 CPU seconds there:
  // a 20 s ceiling keeps normal headroom and rejects that planted slowdown.
  if(process.env.WONKY_IDENTITY_CPU_CHILD!=='1') {
    const reportPath=new URL('../tmp/boolean-identities/report.json',import.meta.url);
    fs.mkdirSync(new URL('../tmp/boolean-identities/',import.meta.url),{recursive:true});
    fs.rmSync(reportPath,{force:true});
    const usage=cpuMeasured(process.execPath,[fileURLToPath(import.meta.url)],
      {env:{...process.env,WONKY_IDENTITY_CPU_CHILD:'1'}});
    assert.equal(usage.status,0,'identity sweep child failed');
    const report=JSON.parse(fs.readFileSync(reportPath));
    assert.equal(report.complete,true,'CPU bound requires a completed live sweep');
    Object.assign(report,usage,{cpuScope:'sweep process, native threads and reaped descendants; includes startup'});
    fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(usage));
    if(process.env.WONKY_BOOLEAN_IDENTITY_LARGE!=='1')
      assert.ok(usage.cpuSeconds<20,`one-core sweep used ${usage.cpuSeconds} CPU seconds (wall ${usage.wallSeconds}s)`);
    return;
  }
  const start=performance.now(),large=process.env.WONKY_BOOLEAN_IDENTITY_LARGE==='1';
  const allKeys=new Set(generators(true).flatMap(c=>ops.map(op=>`${c.id}/${op}`)));
  assert.ok(Object.keys(baseline).every(key=>allKeys.has(key)), 'baseline names an absent generator/operation');
  const cases=generators(large);
  assert.equal(new Set(cases.map(c=>c.id)).size,cases.length,'duplicate generator ID');
  const report={complete:false,completeCases:0,refusedCases:0,cases:0,operations:0,built:0,refused:0,violations:0,identities:{exact:0,enclosure:0},routes:{},refusals:{},failures:[]};
  const reportPath=new URL('../tmp/boolean-identities/report.json',import.meta.url);
  fs.mkdirSync(new URL('../tmp/boolean-identities/',import.meta.url),{recursive:true});
  const save=()=>fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
  for(const c of cases) {
    report.cases++;
    const row=report.routes[c.route]??={cases:0,completeCases:0,refusedCases:0,built:0,refused:0,violations:0,identities:{exact:0,enclosure:0},certificates:{}};
    row.cases++;
    // Operand construction/measurement errors are never Boolean refusals.
    const a=measure(await operand(c,'a')).value;
    const b=measure(await operand(c,'b')).value;
    const results={};
    for(const op of ops) {
      report.operations++;
      try {
        const result=measure(await boolean(c,op));
        results[op]=result.value; report.built++; row.built++;
        for(const cert of result.certificates) row.certificates[cert]=(row.certificates[cert]??0)+1;
      } catch(e) {
        if (!((e.name==='RustCapabilityError' || e instanceof GeometryRefusal) && e.builtin==='opBoolean')) throw e;
        const key=`${c.id}/${op}`,reason=`${e.refusalCategory??'capability'}:${e.reason??e.message.replace(/^opBoolean: /,'')}`;
        report.refusals[key]=reason;report.refused++;row.refused++;
        // A named refusal is recorded, never credited as an identity pass.
        if (baseline[key]!==reason)
          report.failures.push(`new/changed refusal ${key}: ${reason} (baseline ${baseline[key]??'built'})`);
      }
    }
    for(const [label,left,right] of [
      ['A+B=union+intersection',sum(a,b),results.UNION&&results.INTERSECTION&&sum(results.UNION,results.INTERSECTION)],
      ['A=minus+intersection',a,results.SUBTRACTION&&results.INTERSECTION&&sum(results.SUBTRACTION,results.INTERSECTION)],
    ]) if(right) {
      try {const mode=identity(left,right,`${c.id}: ${label}`);report.identities[mode]++;row.identities[mode]++;}
      catch(e) {report.violations++;row.violations++;report.failures.push(e.message);}
    }
    if(Object.keys(results).length===3) {report.completeCases++;row.completeCases++;}
    else {report.refusedCases++;row.refusedCases++;}
    save(); // Preserve completed cases if a later operand/measurement fails.
  }
  report.complete=true;
  report.seconds=(performance.now()-start)/1000;
  save();
  console.log(JSON.stringify({...report,refusals:undefined,failures:undefined}));
  const ids=new Set(generators(large).map(c=>c.id));
  const permitted=Object.keys(baseline).filter(key=>ids.has(key.slice(0,key.lastIndexOf('/')))).length;
  assert.equal(report.violations,0,report.failures.join('\n'));
  assert.ok(report.refused<=permitted,`${report.refused} refusals exceed recorded baseline ${permitted}`);
  assert.deepEqual(report.failures,[]);
  for(const [route,row] of Object.entries(report.routes)) assert.ok(row.built>0,`${route}: no admitted operation reached`);
  assert.ok(report.identities.exact>0 && report.identities.enclosure>0,'both measure modes must execute');
});

test('identity arithmetic rejects one-ulp exact differences and honors enclosure endpoints',()=>{
  const exact=x=>({lo:x,hi:x,exact:true});
  assert.equal(identity(exact(q(1,3)),exact(q(2,6)),'canonical rational'),'exact');
  const one=binary64(1),ulp=binary64(1+Number.EPSILON);
  assert.throws(()=>identity(exact(one),exact(ulp),'one ulp'),/WRONG.*exact/);
  assert.equal(identity(volume({volumeEnclosureMm3:[1,1]}),exact(one),'degenerate certified interval'),'exact');
  assert.equal(identity(volume({volumeMm3:1,volumeRelBound:0}),exact(one),'zero certified bound'),'exact');
  const m=volume({volumeMm3:1,volumeRelBound:Number.EPSILON});
  assert.equal(identity(m,exact(ulp),'closed endpoint'),'enclosure');
  assert.throws(()=>identity(m,exact(binary64(1+2*Number.EPSILON)),'outside bound'),/WRONG/);
  assert.throws(()=>volume({volumeMm3:1}),/missing certified/);
});
