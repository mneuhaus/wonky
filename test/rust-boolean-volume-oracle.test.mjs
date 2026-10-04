import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {twinSource} from '../scripts/acid/common.mjs';
import {generators,source} from './support/boolean-identity-generators.mjs';
import {q,add,binary64,volume,sum,zero} from './support/boolean-identities.mjs';
process.env.WONKY_BACKEND='rust';
const {build}=await import('../src/index.mjs');
const {rustModelKernel,rustHostOf,HOST_OP,GeometryRefusal}=await import('../src/native/rust-host.mjs');
const {boolean}=await import('./support/boolean-volume-execution.mjs');
const root=fileURLToPath(new URL('../',import.meta.url));
const digest=x=>createHash('sha256').update(x).digest('hex');
const wordHash=words=>digest(JSON.stringify(Array.from(words)));
const cmp=(a,b)=>a[0]*b[1]-b[0]*a[1];
const rationalNumber=([n,d])=>{
  const sign=n<0n?-1:1;n=n<0n?-n:n;
  const sn=Math.max(0,n.toString(2).length-53),sd=Math.max(0,d.toString(2).length-53);
  return sign*Number(n>>BigInt(sn))/Number(d>>BigInt(sd))*2**(sn-sd);
};
const sub=(a,b)=>q(a[0]*b[1]-b[0]*a[1],a[1]*b[1]);
function run(cmd,args,cwd,input,env=process.env) {
  const r=spawnSync(cmd,args,{cwd,input,env,encoding:'utf8',maxBuffer:64<<20});
  if(r.stderr)process.stderr.write(r.stderr);
  assert.equal(r.status,0,`${cmd}: ${r.error?.message??r.stdout.slice(-2000)}`);return r.stdout;
}
const frozenProvenance=JSON.parse(fs.readFileSync(path.join(root,'fixtures/boolean-volume-oracle/provenance.json')));
const liveCatalog=process.env.WONKY_BOOLEAN_ORACLE_LARGE==='1'||process.env.WONKY_BOOLEAN_ORACLE_CAPTURE==='1'||process.env.WONKY_BOOLEAN_ORACLE_LIVE==='1';
// Input captures stay bound to the exact catalog against which they were made.
// Live construction still checks the current catalog and its complete case list.
const catalogBytes=fs.readFileSync(path.join(root,liveCatalog?'fixtures/cad-acid/zones.json':
  `fixtures/cad-acid/catalog-history/${frozenProvenance.catalogSha256}.json`));
const catalog=JSON.parse(catalogBytes);
const booleanZones=['AC10','AC11','AC12','AC13','AC14','AC15','AC16','AC17','AC18','AC49','AC19','AC20','AC21','AC22','AC23','AC24','AC27','AC28','AC36','AC39','AC40','AC41','AC42','AC43','AC44','AC46','AC47','AC61','AC63','AC64','AC51','AC62','AC67','AC68','AC71','AC75','AC79','AC98','AC60','AC77','AC89','AC102'];
assert.deepEqual(catalog.zones.filter(z=>z.fsFeatures.includes('opBoolean')).map(z=>z.id),booleanZones,'update the fixed Boolean oracle case list for a changed catalog');
const fixtureDir=path.join(root,'fixtures/boolean-volume-oracle');
function frozenOperands() {
  const bytes=fs.readFileSync(path.join(fixtureDir,'operands.json'));
  const provenance=JSON.parse(fs.readFileSync(path.join(fixtureDir,'provenance.json')));
  assert.equal(digest(bytes),provenance.sha256,'operand capture changed');
  assert.equal(digest(catalogBytes),provenance.catalogSha256,'operand catalog changed');
  for(const [file,hash] of Object.entries(provenance.sources))assert.equal(digest(fs.readFileSync(path.join(root,file))),hash,`capture source changed: ${file}`);
  const capture=JSON.parse(bytes);assert.deepEqual(capture.booleanZones,booleanZones);
  for(const [hash,words] of Object.entries(capture.operands))assert.equal(wordHash(words),hash,'operand content address changed');
  const records=capture.cases.map(r=>({...r,inputs:r.inputs.map(hash=>{assert.ok(capture.operands[hash]);return capture.operands[hash];})}));
  return {...capture,records,provenance};
}
// These are INPUT captures, not golden results. Default runs execute production
// Boolean again and observe its volume; no result volume/boundary is frozen.
// Full original FS construction (including costly spline area/length) is opt-in.
// Capture is explicit and preserves source/operand hashes; never runs in a gate.
test('operand-only volume enclosure: FS generators and frozen CAD-Acid operands with fresh Boolean results',async()=>{
  const totalStart=performance.now();
  // Reuse production release dependencies. The test executable parallelizes
  // code generation and limits final optimization; dependency flags stay unchanged.
  // Keep Rust thin LTO: Apple's linker cannot read rustc's LLVM summaries.
  run('cargo',['rustc','--release','--offline','--locked','-p','wonky-ops','--example','boolean-volume-oracle',
    '--','-C','lto=thin','-C','opt-level=1','-C','codegen-units=16','-C','debuginfo=0'],path.join(root,'rust'));
  const binary=path.resolve(root,process.env.CARGO_TARGET_DIR??'rust/target','release/examples/boolean-volume-oracle');
  const initial=await build(source(generators()[0].a),{feature:'f'});
  const backend=rustHostOf(rustModelKernel(initial)),originalAddon=backend.addon,original=originalAddon.hostOp;
  const large=process.env.WONKY_BOOLEAN_ORACLE_LARGE==='1';
  const captureMode=process.env.WONKY_BOOLEAN_ORACLE_CAPTURE==='1';
  const live=large||captureMode||process.env.WONKY_BOOLEAN_ORACLE_LIVE==='1';
  let current='',records=[];const refusals=[],attempts=[],measures=new Map(),sources={};
  const wrappedAddon={};
  for(const key of Reflect.ownKeys(originalAddon)) {
    const value=originalAddon[key];wrappedAddon[key]=typeof value==='function'?value.bind(originalAddon):value;
  }
  wrappedAddon.hostOp=function(request) {
    const reply=original.call(originalAddon,request);
    if(request[2]===HOST_OP.BOOLEAN&&reply[0]===0) {
      let at=7;const op=request[at++],count=request[at++],inputs=[];
      for(let i=0;i<count;i++){const n=request[at++];inputs.push(Array.from(request.slice(at,at+n)));at+=n;}
      let out=2;const outputs=[];
      for(let i=0;i<reply[1];i++){const n=reply[out++];outputs.push(wordHash(reply.slice(out,out+n)));out+=n;}
      records.push({id:current,resultKey:Array.from(request.slice(3,7)),op,inputs,outputs});
    } else if(request[2]===HOST_OP.MEASURE&&reply[0]===0) {
      measures.set(wordHash(request.slice(4,4+request[3])),JSON.parse(String.fromCodePoint(...reply.slice(1))));
    }
    return reply;
  };
  backend.addon=wrappedAddon;
  const preparationSeconds=(performance.now()-totalStart)/1000;
  const executionCpuStart=process.cpuUsage();
  const start=performance.now(),cases=generators(large);
  let provenance=null;
  try {
    for(const c of cases)for(const op of ['UNION','INTERSECTION','SUBTRACTION']) {
      current=`generator/${c.id}/${op}`;
      const attempt={id:current,outcome:'building',admission:'live FS'};attempts.push(attempt);
      try{await boolean(c,op);attempt.outcome='built';}catch(e){
        attempt.outcome='refused';
        if(!((e.name==='RustCapabilityError'||e instanceof GeometryRefusal)&&e.builtin==='opBoolean'))throw e;
        refusals.push({id:current,reason:e.reason??e.refusalCategory});
      }
    }
    if(live)for(const id of booleanZones)for(const variant of ['V0','V1','V2','V3']) {
      current=`acid/${id}/${variant}`;
      const zone=catalog.zones.find(z=>z.id===id),group=catalog.groups.find(g=>g.id===zone.group),spec=group.featureScript;
      const sourcePath=twinSource(catalog,group,zone,'wonky-rust',variant),bytes=fs.readFileSync(sourcePath);
      sources[path.relative(root,sourcePath)]=digest(bytes);
      const manifest=path.join(path.dirname(sourcePath),'modules.json');
      if(fs.existsSync(manifest))sources[path.relative(root,manifest)]=digest(fs.readFileSync(manifest));
      const attempt={id:current,outcome:'building',admission:'live FS'};attempts.push(attempt);
      try{await build(bytes.toString(),{feature:spec.customFeature,sourcePath,
        ...(fs.existsSync(manifest)?{moduleManifest:manifest}:{}),
        parameters:{variant:`AcidVariant.${variant}`,zone:`${spec.parameters.zone.type.replace('enum ','')}.${id}`},maxSteps:20_000_000});attempt.outcome='built';}
      catch(e){
        attempt.outcome='refused';
        if(!(e.name==='RustCapabilityError'||e instanceof GeometryRefusal||e.name==='UnsupportedFeatureError'||e.name==='NativeCapabilityError'))throw e;
        refusals.push({id:current,reason:e.reason??e.refusalCategory??e.message,builtin:e.builtin});
      }
      console.log(JSON.stringify({stage:'FS case',id:current,outcome:attempt.outcome,seconds:(performance.now()-start)/1000}));
    }
    if(!live) {
      const frozen=frozenOperands();provenance=frozen.provenance;
      records.push(...frozen.records);refusals.push(...frozen.refusals);
      attempts.push(...frozen.attempts.map(a=>({...a,admission:'frozen FS capture; Boolean replayed live'})));
    }
  } finally {backend.addon=originalAddon;}
  const constructionSeconds=(performance.now()-start)/1000;
  console.log(JSON.stringify({stage:'operands-ready',constructionSeconds,records:records.length}));
  if(captureMode) {
    const operands={},cad=records.filter(r=>r.id.startsWith('acid/'));
    const capture={schema:'wonky/boolean-oracle-operands/1',booleanZones,operands,
      cases:cad.map(({outputs,...r})=>({...r,inputs:r.inputs.map(words=>{const hash=wordHash(words);operands[hash]=words;return hash;})})),
      attempts:attempts.filter(a=>a.id.startsWith('acid/')),refusals:refusals.filter(a=>a.id.startsWith('acid/'))};
    const bytes=JSON.stringify(capture)+'\n';
    provenance={origin:'Unmodified fixtures/cad-acid FeatureScript through the production Rust frontend; operand WC0 words captured BEFORE opBoolean, no result geometry/volume stored',
      nativeSourceHash:originalAddon.info().sourceHash,catalogSha256:digest(catalogBytes),sources,sha256:digest(bytes),bytes:Buffer.byteLength(bytes)};
    fs.mkdirSync(fixtureDir,{recursive:true});fs.writeFileSync(path.join(fixtureDir,'operands.json'),bytes);
    fs.writeFileSync(path.join(fixtureDir,'provenance.json'),JSON.stringify(provenance,null,2)+'\n');
  }
  assert.ok(records.length>0,'no Boolean captured');
  const budget=large?16384:128;
  // Generator results were just built and measured by the real frontend.
  // Reuse those observations; CAD captures have no results and are replayed.
  const observedVolumes=records.map(r=>{
    const observations=r.outputs?.map(hash=>measures.get(hash));
    if(!observations?.every(Boolean))return null;
    const actual=observations.reduce((v,m)=>add(v,m.volumeExactMm3?
      q(m.volumeExactMm3.numerator,m.volumeExactMm3.denominator):binary64(m.volumeMm3)),q(0));
    return {actual,exact:observations.every(m=>!!m.volumeExactMm3)};
  });
  const input=records.map((r,i)=>[r.op,budget,r.inputs.length,...r.inputs.flatMap(w=>[w.length,...w]),
    ...(observedVolumes[i]?['observed',...observedVolumes[i].actual.map(String),String(observedVolumes[i].exact)]:[])].join(' ')).join('\n')+'\n';
  fs.mkdirSync(path.join(root,'tmp/boolean-volume-oracle'),{recursive:true});
  fs.writeFileSync(path.join(root,'tmp/boolean-volume-oracle/operands.txt'),input);
  // Exercise the full sweep and independent one/two-worker replay batches in
  // ONE bounded native pool. Every original replay remains a fresh Boolean;
  // scheduling checks repeat the same cases with no cached results.
  const indices=[...new Set([0,1,2,records.length-3,records.length-2,records.length-1])];
  const inputLines=input.trim().split('\n');
  const schedulingInput=indices.map(i=>inputLines[i]).join('\n')+'\n';
  const oracleStart=performance.now();
  const timingFile=path.join(root,'tmp/boolean-volume-oracle/native-cpu.txt');
  // Test-only planted regression: repeat the actual native workload, never a
  // sleep or fabricated timing. The OS accounts every thread in each child;
  // process.cpuUsage accounts frontend/addon work in this Node process.
  const workRepeats=Number(process.env.WONKY_BOOLEAN_ORACLE_REPEAT_WORK??1);
  assert.ok(Number.isSafeInteger(workRepeats)&&workRepeats>=1,'invalid oracle work repeats');
  let nativeCpuSeconds=0,allOutput;
  for(let repeat=0;repeat<workRepeats;repeat++) {
    const output=run('/usr/bin/time',['-p','-o',timingFile,binary],root,input+schedulingInput+schedulingInput,
      {...process.env,WONKY_ORACLE_BATCHES:`${records.length}:all,${indices.length}:1,${indices.length}:2`}).trim().split('\n');
    const timing=fs.readFileSync(timingFile,'utf8');
    const cpuField=name=>{const match=timing.match(new RegExp(`^${name}\\s+(\\d+(?:\\.\\d+)?)$`,'m'));assert.ok(match,`missing ${name} CPU accounting: ${timing}`);return Number(match[1]);};
    nativeCpuSeconds+=cpuField('user')+cpuField('sys');
    if(allOutput)assert.deepEqual(output.map(line=>line.split(' ').slice(0,11)),allOutput.map(line=>line.split(' ').slice(0,11)),'repeated oracle work changed exact fields');
    allOutput=output;
  }
  const refinementSeconds=(performance.now()-oracleStart)/1000;
  assert.equal(allOutput.length,records.length+2*indices.length);
  const output=allOutput.slice(0,records.length);
  const exactFields=line=>line.split(' ').slice(0,11);
  const serial=allOutput.slice(records.length,records.length+indices.length);
  const parallel=allOutput.slice(records.length+indices.length);
  assert.deepEqual(parallel.map(exactFields),serial.map(exactFields),'pool size changed exact oracle fields or row order');
  assert.deepEqual(serial.map(exactFields),indices.map(i=>exactFields(output[i])),'batch scheduling changed exact oracle fields');
  const rows=output.map((line,i)=>{
    const [ln,ld,hn,hd,cells,boundary,converged,enclosureOnly,vn,vd,exact,operandSeconds,refinementSeconds,resultSeconds]=line.split(' ');
    const lo=q(ln,ld),hi=q(hn,hd),actual=q(vn,vd),r=records[i],width=sub(hi,lo);
    const observations=r.outputs?.map(hash=>measures.get(hash));
    if(observations?.every(Boolean)) {
      const reported=observations.map(volume).reduce(sum,zero());
      assert.ok(cmp(actual,reported.lo)>=0n&&cmp(actual,reported.hi)<=0n,`${r.id}: fresh Boolean volume differs from frontend observation`);
    }
    return {id:r.id,resultKey:r.resultKey,operation:r.op,inside:cmp(actual,lo)>=0n&&cmp(actual,hi)<=0n,
      buildOutcome:attempts.find(a=>a.id===r.id)?.outcome,lowerMm3:rationalNumber(lo),upperMm3:rationalNumber(hi),
      lowerExactMm3:lo.map(String),upperExactMm3:hi.map(String),reportedMm3:rationalNumber(actual),reportedExact:exact==='true',
      frontendObservationCompared:observations?.every(Boolean)??false,
      reportedSource:observedVolumes[i]?'live frontend Boolean':'fresh native Boolean replay',
      widthMm3:rationalNumber(width),widthRelative:actual[0]===0n?null:rationalNumber(width)/rationalNumber(actual),
      operandSeconds:Number(operandSeconds),refinementSeconds:Number(refinementSeconds),resultSeconds:Number(resultSeconds),
      cells:Number(cells),unresolvedCells:Number(boundary),converged:converged==='true',enclosureOnlyOperands:Number(enclosureOnly)};
  });
  const executionSeconds=(performance.now()-start)/1000;
  const seconds=(performance.now()-totalStart)/1000;
  const nodeCpu=process.cpuUsage(executionCpuStart);
  const executionCpuSeconds=nativeCpuSeconds+(nodeCpu.user+nodeCpu.system)/1e6;
  const report={scope:'volume only; no topology or shape claim',membership:'exact operand box predicates; result never classified',
    cadMode:live?'live FeatureScript':'frozen exact operands; fresh production Boolean',provenance,
    budget,cases:cases.map(c=>c.id),booleanZones,attempts,rows,refusals,preparationSeconds,constructionSeconds,refinementSeconds,executionSeconds,workRepeats,nativeCpuSeconds,executionCpuSeconds,seconds};
  fs.writeFileSync(path.join(root,'tmp/boolean-volume-oracle/report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({checked:rows.length,converged:rows.filter(r=>r.converged).length,budgetReached:rows.filter(r=>!r.converged).length,
    refused:refusals.length,preparationSeconds,constructionSeconds,refinementSeconds,executionSeconds,workRepeats,nativeCpuSeconds,executionCpuSeconds,seconds,report:'tmp/boolean-volume-oracle/report.json'}));
  assert.deepEqual(rows.filter(r=>!r.inside).map(r=>r.id),[],'reported volume outside operand enclosure');
  for(const a of attempts.filter(a=>a.outcome==='built'))assert.ok(rows.some(r=>r.id===a.id),`${a.id}: built but no Boolean oracle check`);
  // Compilation is preparation, not oracle work. Wall time remains reported
  // against the 60 s quiet-host target; CPU work is unaffected by scheduler waits.
  // 120 CPU seconds counts all native workers, rather than dividing by pool size.
  if(!large&&!live)assert.ok(executionCpuSeconds<120,`oracle work used ${executionCpuSeconds} CPU seconds (limit 120); wall ${seconds}s`);
});
