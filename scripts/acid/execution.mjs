#!/usr/bin/env node
// Bounded, isolated foreground runs. One zone's failure cannot erase its neighbours.
// WONKY_ACID_JOBS defaults to available host cores - 2 (at least 1).
// 1 preserves the original in-process serial order, including smoke builds.
// Parallel cells use private processes; publication always follows serial order.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync, fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {acidJobs, orderedPool, cellPreloads} from './pool.mjs';
import {codeIdentity, artifactHashes, verifyExactObservation, canonical} from './evidence.mjs';
import {ROOT,CATALOG,isMain,ALL_VARIANTS,KERNELS,loadCatalog,sourceHashes,sha256,readJSON,writeJSON,verifyFrozenReference,kernelClass,zoneVariants,twinSource,catalogBySha,activeReferenceKeys,requireZonesBound} from './common.mjs';
import {cachedClosedForms} from './closed-forms-cache.mjs';
import {RoundTripPool} from './roundtrip-worker.mjs';
import {clock,clockCost,elapsed,context,phases,add,phaseScopes,familyFor} from './perf.mjs';
import {execFileSync} from 'node:child_process';
import {GUARD} from '../r20/modules.mjs';
// Only this module's execution path can register an observation. No JSON flag,
// copied row, caller-supplied token or self-consistent artifact set can mint it.
const executions=new WeakMap();
export function executionEvidence(row) {
  const proof=executions.get(row);
  return proof && proof.digest===sha256(canonical(row)) ? {status:proof.status,fixtures:{...proof.fixtures}} : null;
}
const remember=(row,status,fixtures={})=>{executions.set(row,{status,fixtures:{...fixtures},digest:sha256(canonical(row))});return row;};

// Compare measured claims, not elapsed time, process logs or artifact locations.
// Refusals retain their name, category, builtin and under-test classification.
function observation(row) {
  return Object.fromEntries(['kernel','zone','variant','outcome','backend','nativeValidity','builtBeforeFailure','stage',
    'refusal','error','reason','metrics','nativeObservation','stepRoundTrip','bodies','operationEvidence']
    .filter(k=>row[k]!==undefined).map(k=>[k,row[k]]));
}
function mismatch(claim,live,code,zone,artifactRoot) {
  if(claim.code?.treeSha256!==code.treeSha256)return 'recorded row tree identity differs from live tree';
  if(claim.backend?.sourceHash!==live.backend?.sourceHash)return 'recorded addon sourceHash differs from live addon';
  if(claim.backend?.addonSha256!==live.backend?.addonSha256)return 'recorded addon binary hash differs from live addon';
  if(canonical(observation(claim))!==canonical(observation(live)))return 'recorded observation differs from live execution (including named refusal category)';
  if(claim.outcome==='built'&&!claim.builtBeforeFailure) {
    const consistency=verifyExactObservation(zone,claim,{code,artifactRoot});
    if(!consistency.ok)return consistency.reason;
  }
  return null;
}
const PYTHON=path.join(ROOT,'out/build123d-performance/reference-venv/bin/python');
function execute(command,args,out,timeout,extraEnv={},perfFile=null) {
  if(perfFile)extraEnv={...extraEnv,WONKY_ACID_PHASE_PERF:perfFile};
  fs.mkdirSync(out,{recursive:true});
  const wrapperStart=performance.now();
  const r=spawnSync(command,args,{cwd:ROOT,encoding:'utf8',detached:process.platform!=='win32',timeout:timeout*1000,killSignal:'SIGKILL',maxBuffer:16*1024*1024,
    env:{...process.env,...extraEnv,NODE_OPTIONS:'--max-old-space-size=8192'}});
  if(perfFile&&fs.existsSync(perfFile)){const t=readJSON(perfFile);t.pythonWallMs=t.wallMs;t.wallMs=performance.now()-wrapperStart;t.overheadUpperBoundMs=t.timingOverheadMs??0;writeJSON(perfFile,t);}
  if(r.error && r.pid && process.platform!=='win32') { try { process.kill(-r.pid,'SIGKILL'); } catch(error) { if(error.code!=='ESRCH')throw error; } }
  fs.writeFileSync(path.join(out,'command.log'),`$ ${[command,...args].join(' ')}\nstatus=${r.status} signal=${r.signal} error=${r.error?.message??''}\n--- stdout\n${r.stdout??''}\n--- stderr\n${r.stderr??''}`);
  return {ok:r.status===0&&!r.error,status:r.status,signal:r.signal,error:r.error?.message,stderrTail:r.stderr?.trim().split('\n').slice(-4)};
}
const uvArgs=(file,...args)=>['run','--no-project',PYTHON,'-B',path.join(ROOT,'scripts/acid',file),...args];
// The STEP round-trip checks run in warm workers (roundtrip-worker.mjs), in the
// same interpreters and with the same arguments a per-cell process received.
const ROUNDTRIP_KINDS={measure:['uv',uvArgs('measure.py','--serve')],validate:['uv',['run',path.join(ROOT,'scripts/validate-step.py'),'--serve']]};
export const roundTripPool=(size,options={})=>new RoundTripPool(size,ROUNDTRIP_KINDS,{cwd:ROOT,env:{...process.env,NODE_OPTIONS:'--max-old-space-size=8192'},...options});
// execute()'s record for one warm request. `infrastructure` marks a worker that
// exited, hung or broke the protocol: no check ran to completion.
async function roundTrip(opts,kind,argv,out,perfFile) {
  fs.mkdirSync(out,{recursive:true});
  const wrapperStart=performance.now();
  const r=await opts.roundTrip(kind,argv,{timeoutMs:opts.timeout*1000,perfFile});
  if(perfFile&&fs.existsSync(perfFile)){const t=readJSON(perfFile);t.pythonWallMs=t.wallMs;t.wallMs=performance.now()-wrapperStart;t.overheadUpperBoundMs=t.timingOverheadMs??0;writeJSON(perfFile,t);}
  const [command,args]=ROUNDTRIP_KINDS[kind];
  fs.writeFileSync(path.join(out,'command.log'),`$ ${[command,...args].join(' ')} <<< ${JSON.stringify(argv)}\nstatus=${r.status} signal=${r.signal} error=${r.error??''}\n--- stdout\n${r.stdout??''}\n--- stderr\n${r.stderr??''}`);
  return {ok:r.status===0&&!r.error,status:r.status,signal:r.signal,error:r.error,stderrTail:r.stderr?.trim().split('\n').slice(-4),...(r.infrastructure?{infrastructure:true}:{})};
}
const roundTripError=(identity,kind,execution,seconds)=>({...identity,outcome:'error',reason:`ROUNDTRIP_INFRASTRUCTURE_ERROR: ${kind}: ${execution.error}`,execution,seconds});
async function buildOne(catalog,zonesSha256,group,zone,variant,kernel,opts,sources) {
  const identity={kernel,zone,variant,group:group.id,code:opts.code,
    ...(opts.backends[kernel]?{backend:opts.backends[kernel]}:{})};
  // The 'ALL' smoke build has no single zone to key a twin override off of, so
  // it always uses the group default; a real zone may override its twin (e.g.
  // V5's alternate-idiom rewrite) via twinSource().
  const zoneObj=zone!=='ALL'?catalog.zones.find(z=>z.id===zone):null;
  const source=zoneObj?twinSource(catalog,group,zoneObj,kernel,variant):path.join(ROOT,kernel==='occt'?group.b3d:group.fs);
  const sourceSha256=sources[path.relative(ROOT,source)];
  if(!sourceSha256)return {...identity,outcome:'not_run',reason:`TWIN_UNAVAILABLE: ${path.relative(ROOT,source)}`};
  if(kernel==='wonky-rust'&&!opts.rustAvailable)return {...identity,outcome:'not_run',reason:'STRICT_BACKEND_UNAVAILABLE: rust is not registered; no Bend fallback'};
  if(kernel==='occt'&&!fs.existsSync(PYTHON))return {...identity,outcome:'not_run',reason:'REFERENCE_VENV_UNAVAILABLE'};
  const out=path.join(opts.out,kernel,group.id,variant,zone);
  fs.mkdirSync(out,{recursive:true});
  // Never reuse stale geometry, build/error records or guard logs after a failed attempt.
  for(const f of ['perf-build.json','perf-cell.json','perf-measure.json','perf-validate.json','perf-twin.json','build.json','error.json','model.step','model.brep.json','measure.json','bend-guard.json'])fs.rmSync(path.join(out,f),{force:true});
  const parameters={variant:`AcidVariant.${variant}`,zone:`${group.featureScript.parameters.zone.type.replace('enum ','')}.${zone}`};
  const request={source,sourceSha256,zonesSha256,feature:group.featureScript.customFeature,parameters,zone,variant,out,catalog:CATALOG};
  const sibling=path.join(path.dirname(source),'modules.json');if(fs.existsSync(sibling))request.moduleManifest=sibling;
  const reqFile=path.join(out,'request.json');writeJSON(reqFile,request);
  const start=performance.now(), clockBefore=clockCost(), cellStart=clock();
  const perf={kernel,zone,variant,family:familyFor(zoneObj,group),context:context(opts.jobs,true),phases:phases()};
  let result,execution;
  if(kernel==='occt') {
    execution=execute('uv',uvArgs('build-occt.py',reqFile),out,opts.timeout);
    if(fs.existsSync(path.join(out,'build.json')))result=readJSON(path.join(out,'build.json'));
  } else {
    const {buildWonky}=await import('./build-wonky.mjs');
    // The opt-in shadow of the general Boolean (rust/wonky-ops/src/shadow.rs)
    // labels its report lines with the cell it runs in; it changes no output.
    if(process.env.WONKY_BOOLEAN_SHADOW==='1')process.env.WONKY_BOOLEAN_SHADOW_CELL=`${group.id}/${variant}/${zone}`;
    request.onPerf=p=>{perf.buildTiming=p;};request.perfAddon=opts.perfAddon;
    result=await buildWonky(request);
    delete request.onPerf;delete request.perfAddon;
    const guard=opts.guardSummary();
    if(guard.bendLoaded)throw new Error('STRICT_BACKEND_BEND_LEAK');
    // Import counts accumulate in serial mode; keep them in guard logs,
    // not in the deterministic observation. All load checks remain enforced.
    const {modules,...loadEvidence}=guard;
    result.guard=loadEvidence;
    execution={ok:result.outcome==='built'&&!result.builtBeforeFailure,mode:'in-process'};
  }
  const seconds=(performance.now()-start)/1000;
  if(!result)return {...identity,outcome:'error',reason:`BUILD_PROCESS_FAILED: ${JSON.stringify(execution)}`,seconds};
  if(result.outcome==='built'&&!result.builtBeforeFailure&&zone!=='ALL'&&kernel!=='occt') {
    const step=path.join(out,'model.step'), observed=path.join(out,'measure.json');
    const measurement=await roundTrip(opts,'measure',[step,'--zone',zone,'--variant',variant,'--out',observed],path.join(out,'measure'),path.join(out,'perf-measure.json'));
    if(measurement.infrastructure)return roundTripError(identity,'measure',measurement,seconds);
    if(measurement.ok&&fs.existsSync(observed)) {
      const measured=readJSON(observed);result={...result,...measured};
      const nativeBodies=result.bodies;
      // Check the production kernel's own volume when available, not only healed STEP.
      result.nativeBodies=nativeBodies;
      if(kernelClass(catalog,kernel)==='exact'&&result.nativeObservation) {
        // Decision D1: the exact class is scored on its own construction's
        // observation, bound to this build: the addon source hash of the
        // backend block, and each body's WC0 words hash as brep.json records it.
        // The OCCT observation stays disclosed and keeps the STEP round trip.
        result.occtMetrics=result.metrics;result.metrics={...result.nativeObservation.metrics};
      } else {
        if(nativeBodies.every(b=>Number.isFinite(b.validation?.volumeMm3)))result.metrics.volume=nativeBodies.reduce((s,b)=>s+b.validation.volumeMm3,0);
        if(nativeBodies.every(b=>Number.isFinite(b.validation?.areaMm2)))result.metrics.area=nativeBodies.reduce((s,b)=>s+b.validation.areaMm2,0);
      }
      result.metrics.nativeBodyCount=nativeBodies.length;
      if(nativeBodies.length!==result.metrics.bodies.length)result.nativeValidity=false;
      const validation=await roundTrip(opts,'validate',[path.join(out,'model')],path.join(out,'validate-step'),path.join(out,'perf-validate.json'));
      if(validation.infrastructure)return roundTripError(identity,'validate',validation,seconds);
      result.stepValidation=validation;
      // Preserve the catalog's unhealed STEP exception without accepting a
      // validator crash or hiding OCCT's disclosed topology loss on import.
      const sliver=result.stepRoundTrip?.unhealedSliver;
      const unhealedCatalogException=zone==='AC41'&&kernel==='wonky-rust'&&
        sliver?.closedShells===1&&sliver.distinctShellPoints===8&&sliver.localExtentX>0&&sliver.localExtentX<=2e-5&&
        validation.stderrTail?.some(line=>line.startsWith('ValueError:')&&line.includes('topology differs'));
      if(unhealedCatalogException)result.stepValidation.catalogException='AC41 unhealed sliver; healed topology loss disclosed';
      if(!validation.ok&&!unhealedCatalogException) {
        result.builtBeforeFailure=true;
        result.error={name:'VALIDATOR_EXECUTION_FAILED',message:validation.stderrTail?.join(' / ')??validation.error};
        result.stepRoundTrip={ok:false,error:result.error};
      }
      result.nativeValidity=result.nativeValidity&&(validation.ok||unhealedCatalogException);
    }else {
      result.builtBeforeFailure=true;
      result.stepRoundTrip={ok:false,reason:'STEP_MEASUREMENT_FAILED',execution:measurement};
    }
  }
  if(kernel==='wonky-rust') {
    const bookkeepingStart=performance.now();let twinWorkMs=0,subprocessOverheadMs=0;
    const buildPerf=path.join(out,'perf-build.json');
    if(fs.existsSync(buildPerf)){const b=perf.buildTiming??readJSON(buildPerf);perf.phases=b.phases;perf.overheadMs=b.overheadMs;perf.persistMs=b.persistMs??0;perf.setupMs=b.setupMs??0;perf.restoreMs=b.restoreMs??0;}
    delete perf.buildTiming;
    let childCpuMs=0,roundtrip={wallMs:0,cpuMs:0},checked=false;
    for(const file of ['perf-measure.json','perf-validate.json'])if(fs.existsSync(path.join(out,file))){const t=readJSON(path.join(out,file));roundtrip=add(roundtrip,t);subprocessOverheadMs+=t.overheadUpperBoundMs??0;checked=true;}
    if(checked){perf.phases.stepRoundTrip={status:'executed',...roundtrip};childCpuMs=roundtrip.cpuMs;}
    perf.phases.total={status:'executed',...elapsed(cellStart)};perf.phases.total.cpuMs+=childCpuMs;
    perf.outcome=result.outcome;perf.error=result.error;perf.refusal=result.refusal;perf.builtBeforeFailure=result.builtBeforeFailure??false;
    if(zone!=='ALL') {
      const twinSourcePath=twinSource(catalog,group,zoneObj,'occt',variant);
      const twinOut=path.join(out,'perf-twin');fs.mkdirSync(twinOut,{recursive:true});
      const twinResult=path.join(out,'perf-twin.json'),twinRequest=path.join(twinOut,'request.json');
      writeJSON(twinRequest,{source:twinSourcePath,sourceSha256:sources[path.relative(ROOT,twinSourcePath)],out:twinOut,result:twinResult,catalog:CATALOG,zone,variant,reps:1,livePerf:true,jobs:opts.jobs});
      perf.twinContext=context(opts.jobs,null);
      const twinStart=performance.now();
      const twinExecution=execute('uv',uvArgs('bench-occt.py',twinRequest),twinOut,opts.timeout);
      twinWorkMs=performance.now()-twinStart;
      perf.build123d=fs.existsSync(twinResult)?readJSON(twinResult):{outcome:'error',execution:twinExecution,samples:[]};
      perf.build123d.source=path.relative(ROOT,twinSourcePath);perf.build123d.sourceSha256=sources[path.relative(ROOT,twinSourcePath)];
      perf.build123d.context={...perf.twinContext,...perf.build123d.context};
    }
    perf.comparisonWorkMs=twinWorkMs;
    perf.timingOverheadUpperBoundMs=(perf.overheadMs??0)+(perf.persistMs??0)+(perf.setupMs??0)+(perf.restoreMs??0)+(clockCost()-clockBefore)+subprocessOverheadMs+Math.max(0,performance.now()-bookkeepingStart-twinWorkMs);
    writeJSON(path.join(out,'perf-cell.json'),perf);
  }
  if(sha256(fs.readFileSync(source))!==sourceSha256)return {...identity,outcome:'error',reason:'SOURCE_CHANGED_DURING_RUN',seconds};
  const row={...identity,...result,...(result.backend||opts.backends[kernel]?{backend:{...result.backend,...opts.backends[kernel]}}:{}),seconds,execution,artifacts:path.relative(ROOT,out),artifactHashes:artifactHashes(out)};
  if(kernel==='wonky-rust'&&result.backend?.sourceHash&&result.backend.sourceHash!==opts.backends[kernel].sourceHash)throw new Error('LIVE_ADDON_IDENTITY_MISMATCH');
  if(result.outcome==='built'&&zone!=='ALL'&&kernelClass(catalog,kernel)==='exact')
    row.evidence=verifyExactObservation(catalog.zones.find(z=>z.id===zone),row);
  return row;
}
// Frozen reference directories: the v1 capture plus one directory per catalog
// extension capture (<kind>-ext/<push>/). Each is verified on its own; only its
// active rows (per-zone binding, common.mjs) are admitted. Two active rows for
// one (zone, variant) are ambiguous, never merged or chosen between.
function referenceDirs(kind) {
  const base=path.join(ROOT,'fixtures/cad-acid',kind),ext=path.join(ROOT,'fixtures/cad-acid',`${kind}-ext`);
  const extensions=fs.existsSync(ext)?fs.readdirSync(ext,{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>path.join(ext,d.name)).sort():[];
  return [base,...extensions].filter(dir=>fs.existsSync(path.join(dir,'provenance.json')));
}
function admitUnique(admitted,row,fixtures,dir) {
  const key=`${row.zone}/${row.variant}`;
  if(admitted.has(key))throw Object.assign(new Error(`REFERENCE_AMBIGUOUS: ${row.kernel??'reference'} ${key} is active in ${path.relative(ROOT,admitted.get(key).dir)} and ${path.relative(ROOT,dir)}`),{name:'REFERENCE_AMBIGUOUS'});
  admitted.set(key,{row,fixtures,dir});
}
async function frozenRows(catalog,zonesSha256,sources,opts) {
  const admitted=new Map();
  for(const [index,frozen] of referenceDirs('onshape').entries()) {
    const manifest=path.join(frozen,'SHA256SUMS'),hashes=fs.readFileSync(manifest,'utf8');
    const fixtures={[path.relative(ROOT,manifest)]:sha256(hashes)};
    const {provenance:p,active}=verifyFrozenReference(frozen,catalog,sources);
    if(!active.size)continue;
    let rows;
    if(p.observations) {
      const file=path.join(frozen,p.observations),bytes=fs.readFileSync(file);
      const digest=sha256(bytes);
      if(!hashes.split('\n').includes(`${digest}  ${p.observations}`))throw new Error('REFERENCE_OBSERVATIONS_UNHASHED');
      fixtures[path.relative(ROOT,file)]=digest;
      const rr=JSON.parse(bytes);
      if(rr.zonesSha256!==p.zonesSha256)throw new Error('REFERENCE_ZONES_SHA_MISMATCH');
      rows=rr.rows.map(r=>({...r,kernel:'onshape'}));
    } else {
      // Re-observe the frozen STEP with today's catalog, only for the active rows.
      const suffix=index?`-${index}`:'';
      const target=path.join(opts.out,`onshape-observations${suffix}.json`),keys=path.join(opts.out,`onshape-active${suffix}.json`);
      fs.rmSync(target,{force:true});writeJSON(keys,[...active].sort());
      const observed=execute('uv',uvArgs('frozen-onshape.py',frozen,CATALOG,target,keys),path.join(opts.out,`onshape-observer${suffix}`),opts.timeout);
      if(!observed.ok||!fs.existsSync(target))throw new Error('ONSHAPE_FROZEN_OBSERVER_FAILED');
      rows=readJSON(target).rows;
    }
    if(sha256(fs.readFileSync(manifest))!==fixtures[path.relative(ROOT,manifest)])throw new Error('REFERENCE_CHANGED_DURING_OBSERVATION');
    for(const row of rows)if(active.has(`${row.zone}/${row.variant}`))admitUnique(admitted,row,fixtures,frozen);
  }
  return [...admitted.values()];
}
// Frozen OCCT rows are stored observations: they stay active only while the
// zone's contract binding (construction, frame, cell, expected outcomes,
// closed forms, tolerance) and its b3d twin are unchanged.
function frozenOcctRows(catalog,sources) {
  const admitted=new Map();
  for(const dir of referenceDirs('occt')) {
    const manifest=path.join(dir,'SHA256SUMS'),hashes=fs.readFileSync(manifest,'utf8');
    const checked=new Map();
    for(const line of hashes.trim().split('\n')) {
      const match=line.match(/^([a-f0-9]{64}) {2}([^/]+(?:\/[^/]+)*)$/);
      if(!match||checked.has(match[2])||match[2].split('/').some(part=>part==='..'||part==='.'))throw new Error('FROZEN_OCCT_CHECKSUM_MISMATCH');
      const bytes=fs.readFileSync(path.join(dir,match[2]));
      if(sha256(bytes)!==match[1])throw new Error('FROZEN_OCCT_CHECKSUM_MISMATCH');
      checked.set(match[2],bytes);
    }
    if(!checked.has('provenance.json'))throw new Error('FROZEN_OCCT_PROVENANCE_MISMATCH');
    const p=JSON.parse(checked.get('provenance.json'));
    const copy=catalogBySha(p.zonesSha256,checked.has('inputs/zones.json')?[path.join(dir,'inputs/zones.json')]:[]);
    if(p.schema!=='wonky/cad-acid-occt-frozen/1'||!checked.has(p.observations)||!copy)throw new Error('FROZEN_OCCT_PROVENANCE_MISMATCH');
    const bytes=checked.get(p.observations),stored=JSON.parse(bytes);
    const fixtures={[path.relative(ROOT,manifest)]:sha256(hashes),[path.relative(ROOT,path.join(dir,p.observations))]:sha256(bytes)};
    if(stored.zonesSha256!==p.zonesSha256)throw new Error('FROZEN_OCCT_CATALOG_MISMATCH');
    const {active}=activeReferenceKeys(catalog,copy,sources,p.sources,'occt','contract'),seen=new Set();
    for(const row of stored.rows) {
      const key=`${row.zone}/${row.variant}`;
      if(row.kernel!=='occt'||seen.has(key))throw new Error('FROZEN_OCCT_DUPLICATE_OR_KERNEL');
      seen.add(key);
      // A stored row's own stamp must name this capture's catalog and twin bytes.
      const zone=copy.zones.find(z=>z.id===row.zone),group=zone&&copy.groups.find(g=>g.id===zone.group);
      const twin=zone&&path.relative(ROOT,twinSource(copy,group,zone,'occt',row.variant));
      if(row.stamp&&(row.stamp.zonesSha256!==p.zonesSha256||row.stamp.sourceSha256!==p.sources?.[twin]))throw new Error('FROZEN_OCCT_PROVENANCE_MISMATCH');
      if(active.has(key))admitUnique(admitted,row,fixtures,dir);
    }
  }
  return admitted;
}

// Frozen verification is deliberately separate from execution admission. A
// stored external observation can be checked against a fixed artifact, not
// promoted to evidence of a live invocation. No live Onshape calls occur.
export async function verifyStoredReferences(results,{out,timeout=180}={}) {
  const {catalog}=loadCatalog(),sources=sourceHashes(catalog);
  resultsCatalog(results,catalog);
  if(results.rows.some(r=>r.kernel==='onshape')) {
    const byKey=new Map((await frozenRows(catalog,null,sources,{out,timeout})).map(e=>[`${e.row.zone}/${e.row.variant}`,e]));
    for(const row of results.rows.filter(r=>r.kernel==='onshape')) {
      const frozen=byKey.get(`${row.zone}/${row.variant}`);
      const matches=frozen&&canonical(observation(row))===canonical(observation(frozen.row));
      remember(row,matches?'frozen':'unverified',matches?frozen.fixtures:{});
    }
  }
  const storedOcct=results.rows.filter(r=>r.kernel==='occt');
  if(storedOcct.length) {
    const frozen=frozenOcctRows(catalog,sources);
    for(const row of storedOcct) {
      const reference=frozen.get(`${row.zone}/${row.variant}`);
      // Self-written artifacts can be internally consistent without being a
      // frozen reference. Only an exact observation match admits stored rows.
      const matches=reference&&canonical(observation(row))===canonical(observation(reference.row));
      remember(row,matches?'frozen':'unverified',matches?reference.fixtures:{});
    }
  }
}
// Results name the catalog they were produced against. Rows stay scorable
// under an extended catalog only for zones that are unchanged (common.mjs).
export function resultsCatalog(results,catalog) {
  const {zonesSha256}=loadCatalog();
  if(results.zonesSha256===zonesSha256)return;
  const ids=[...(results.rows??[]),...(results.liveReferences??[])].map(r=>r.zone).filter(id=>catalog.zones.some(z=>z.id===id));
  requireZonesBound(catalog,results.zonesSha256,ids,'REFERENCE_ZONES_SHA_MISMATCH','results');
}

// Shared by the CLI before argument validation and direct execution callers.
// Logs may stay, but old results must not remain eligible for publication.
export function invalidateRunOutputs(out) {
  for(const file of ['scoreboard.json','scoreboard.md','results.json','perf.json'])fs.rmSync(path.join(out,file),{force:true});
}

export async function executeRun(options) {
  const opts={variants:ALL_VARIANTS,kernels:['wonky-rust'],timeout:180,noSmoke:false,...options};
  invalidateRunOutputs(opts.out);
  const jobs=acidJobs();opts.jobs=jobs;
  const runStart=clock();
  fs.mkdirSync(opts.out,{recursive:true});
  const {catalog,zonesSha256}=loadCatalog(),sources=sourceHashes(catalog);
  if(opts.kernels.some(k=>!['wonky-rust','occt','onshape'].includes(k)))throw new Error('RETIRED_OR_UNKNOWN_KERNEL');
  if(opts.variants.some(v=>!ALL_VARIANTS.includes(v))||opts.zones?.some(id=>!catalog.zones.some(z=>z.id===id)))throw new Error('INVALID_RUN_SELECTION');
  const claims=opts.claims;
  if(claims)resultsCatalog(claims,catalog);
  const claimed=new Map();
  for(const row of claims?.rows??[]) {
    const key=`${row.kernel}/${row.zone}/${row.variant}`;
    if(claimed.has(key))throw new Error(`DUPLICATE_OBSERVATION: ${key}`);
    if(!KERNELS.includes(row.kernel)||!catalog.zones.some(z=>z.id===row.zone)||!ALL_VARIANTS.includes(row.variant))throw new Error(`UNKNOWN_OBSERVATION: ${key}`);
    claimed.set(key,row);
  }
  let closed;
  try {closed=cachedClosedForms({out:path.join(opts.out,'closed-forms'),execute,timeout:opts.timeout});}
  catch(error) {
    const dir=path.join(opts.out,'closed-forms'),log=path.join(dir,'command.log');
    fs.mkdirSync(dir,{recursive:true});
    fs.appendFileSync(log,`\n--- closed-form cache preflight/publication failed\n${error.stack??error}\n`);
    throw new Error(`CLOSED_FORMS_FAILED: ${log}: ${error.message}`,{cause:error});
  }
  if(!closed.ok)throw new Error(`CLOSED_FORMS_FAILED: ${path.join(opts.out,'closed-forms/command.log')}`);
  opts.code=codeIdentity();opts.backends={};opts.rustAvailable=false;
  let checkBackend;
  if(opts.kernels.includes('wonky-rust')) {
    process.env.WONKY_BACKEND='rust';
    process.env.WONKY_BEND_GUARD_LOG??=path.join(opts.out,'bend-guard.json');
    opts.guardSummary=(await import(GUARD)).guardSummary;
    const {openRustBackend,locateRustBuild,rustStaleCheck}=await import('../../src/native/rust-kernel.mjs');
    const addon=await openRustBackend(); // loaded and checked in the scorer's process
    checkBackend=()=>{const live=rustStaleCheck(locateRustBuild());return {sourceHash:live.sourceHash,addonSha256:sha256(fs.readFileSync(live.path))};};
    opts.backends['wonky-rust']=checkBackend();
    if(addon.sourceHash!==opts.backends['wonky-rust'].sourceHash)throw new Error('LIVE_ADDON_IDENTITY_MISMATCH');
    opts.rustAvailable=true;opts.perfAddon=addon.addon;
  }
  const results={schema:'wonky/cad-acid-results/1',zonesSha256,sources,rows:[],liveReferences:[],smoke:[],closedForms:closed,
    code:opts.code,requestedKernels:opts.kernels,startedAt:new Date().toISOString(),reverification:claims?{mismatches:[]}:undefined};
  const git=(...args)=>{try{return execFileSync('git',['-C',ROOT,...args],{encoding:'utf8'}).trim();}catch{return null;}};
  const perf={schema:'wonky/cad-acid-live-perf/1',startedAt:results.startedAt,zonesSha256,
    gitTree:process.env.WONKY_PERF_GIT_TREE??git('rev-parse','HEAD^{tree}'),revision:process.env.WONKY_PERF_REVISION??git('rev-parse','HEAD'),
    clean:process.env.WONKY_PERF_CLEAN==='1'||git('status','--porcelain')==='',context:context(jobs,true),phaseScopes,cells:[]};
  let publicationMs=0;
  const save=()=>{
    writeJSON(path.join(opts.out,'results.json'),results);
    // Per-cell files are durable diagnostics. Rewriting their growing aggregate
    // every cell measured 15 s at 398 cells; batch it without changing results.
    if(perf.cells.length%32===0||perf.finishedAt){const start=performance.now();perf.publicationMs=publicationMs;writeJSON(path.join(opts.out,'perf.json'),perf);publicationMs+=performance.now()-start;}
  };
  if(!claims||claims.rows.some(r=>r.kernel==='onshape')) {
    for(const {row,fixtures} of await frozenRows(catalog,zonesSha256,sources,opts)) {
      const claim=claimed.get(`onshape/${row.zone}/${row.variant}`);
      if(!claims)results.rows.push(remember(row,'frozen',fixtures));
      else if(claim)results.rows.push(canonical(observation(claim))===canonical(observation(row))?remember(row,'frozen',fixtures):{...claim,reverification:{reason:'frozen reference observation mismatch'}});
    }
  }
  // Only active frozen OCCT rows enter the run: a zone without a frozen
  // reference stays NOT_RUN for OCCT, never an unverified or agreeing row.
  if(!claims)for(const {row,fixtures} of frozenOcctRows(catalog,sources).values())results.rows.push(remember(row,'frozen',fixtures));
  const cells=[];
  for(const kernel of opts.kernels.filter(k=>k!=='onshape'))for(const group of catalog.groups) {
    const zones=group.zoneIds.filter(id=>!opts.zones||opts.zones.includes(id));if(!zones.length)continue;
    // A group's smoke ('ALL') build only needs to run the variants at least
    // one member zone declares; a legacy group whose zones never set
    // `variants` collapses this straight back to VARIANTS, matching prior
    // behaviour exactly even though opts.variants now defaults to ALL_VARIANTS.
    const groupVariants=opts.variants.filter(v=>zones.some(id=>zoneVariants(catalog.zones.find(z=>z.id===id)).includes(v)));
    for(const variant of groupVariants) {
      if(!opts.noSmoke&&!claims)cells.push({kernel,group,zone:'ALL',variant});
      for(const zone of zones) {
        if(!zoneVariants(catalog.zones.find(z=>z.id===zone)).includes(variant))continue;
        const claim=claimed.get(`${kernel}/${zone}/${variant}`);if(claims&&!claim)continue;
        cells.push({kernel,group,zone,variant});
      }
    }
  }
  perf.workerStartup=[];
  const workers=roundTripPool(Math.min(jobs,cells.length),{onStart:timing=>{
    const record={...timing,load1:context(jobs,true).load1};perf.workerStartup.push(record);
    console.log(`ROUNDTRIP_WORKER_READY ${JSON.stringify(record)}`);
  }});
  try {
  await workers.start();
  await orderedPool(cells,jobs,cell=>workers.with(roundTrip=>jobs===1
    ? buildOne(catalog,zonesSha256,cell.group,cell.zone,cell.variant,cell.kernel,{...opts,roundTrip},sources)
    : isolatedCell({catalog,zonesSha256,...cell,opts,sources},roundTrip)), (built,cell)=>{
    const {kernel,zone,variant}=cell;
    if(kernel==='wonky-rust'){const file=path.join(opts.out,kernel,cell.group.id,variant,zone,'perf-cell.json');
      perf.cells.push(fs.existsSync(file)?readJSON(file):{kernel,zone,variant,family:familyFor(catalog.zones.find(z=>z.id===zone),cell.group),context:context(jobs,opts.rustAvailable),outcome:built.outcome,error:built.error,reason:built.reason,phases:phases()});}
    if(zone==='ALL'){results.smoke.push(built);save();return;}
    const claim=claimed.get(`${kernel}/${zone}/${variant}`);
    let row=built;
    if(kernel==='occt') {
      // Live diagnostics are not a frozen reference, even when OCCT succeeds.
      // Keep them separate so scoring and merging cannot replace frozen rows.
      row.evidence={status:'live-reference',scored:false};
      results.liveReferences.push(remember(row,'live-reference'));
      console.log(`${kernel} ${zone} ${variant}: ${row.outcome} live-reference (unscored)`);save();return;
    }
    const reason=claims?(claims.code?.treeSha256!==opts.code.treeSha256?'recorded run tree identity differs from live tree':mismatch(claim,row,opts.code,catalog.zones.find(z=>z.id===zone),opts.artifactRoot)):null;
    if(reason) {
      results.reverification.mismatches.push({kernel,zone,variant,reason,claimedOutcome:claim.outcome,liveOutcome:row.outcome});
      row={...claim,reverification:{reason,liveOutcome:row.outcome}};
    } else remember(row,claims?'re-verified':'live');
    results.rows.push(row);console.log(`${kernel} ${zone} ${variant}: ${row.outcome}${reason?' UNVERIFIED: '+reason:''}`);save();
  });
  } finally { workers.close(); }
  // External stored observations are never replayed as wonky or labelled live.
  if(claims) {
    const stored=claims.rows.filter(row=>!results.rows.some(r=>r.kernel===row.kernel&&r.zone===row.zone&&r.variant===row.variant));
    await verifyStoredReferences({...claims,rows:stored},{out:path.join(opts.out,'stored-references'),artifactRoot:opts.artifactRoot});
    results.rows.push(...stored);
  }
  if(codeIdentity().treeSha256!==results.code.treeSha256)throw new Error('CODE_CHANGED_DURING_RUN');
  if(checkBackend&&canonical(checkBackend())!==canonical(opts.backends['wonky-rust']))throw new Error('ADDON_CHANGED_DURING_RUN');
  if(opts.guardSummary?.().bendLoaded)throw new Error('STRICT_BACKEND_BEND_LEAK');
  results.finishedAt=new Date().toISOString();perf.finishedAt=results.finishedAt;perf.runTime=elapsed(runStart);save();
  return results;
}

// IPC is private to children launched here; disk records never admit a live row.
function isolatedCell(input,roundTrip) {
  const {out:output,timeout,code,backends,rustAvailable,jobs}=input.opts;
  const opts={out:output,timeout,code,backends,rustAvailable,jobs};
  const out=path.join(opts.out,input.kernel,input.group.id,input.variant,input.zone);
  fs.mkdirSync(out,{recursive:true});
  return new Promise((resolve,reject)=>{
    const child=fork(fileURLToPath(import.meta.url),['--cell-worker'],{
      cwd:ROOT,execArgv:cellPreloads(),serialization:'advanced',stdio:['ignore','inherit','inherit','ipc'],
      env:{...process.env,WONKY_BEND_GUARD_LOG:path.join(out,'bend-guard.json')},
    });
    let reply;
    // A cell's round-trip requests run in this process's warm worker slot.
    child.on('message',message=>{
      if(!message.roundTrip){reply=message;return;}
      const {id,kind,argv,options}=message.roundTrip;
      roundTrip(kind,argv,options).then(answer=>{if(child.connected)child.send({roundTripReply:{id,...answer}});},reject);
    });
    child.once('error',reject);
    child.once('exit',(code,signal)=>{
      if(code!==0||!reply?.row)return reject(new Error(`ACID_CELL_FAILED: ${input.kernel}/${input.zone}/${input.variant}: ${reply?.error??`exit=${code} signal=${signal}`}`));
      resolve(reply.row);
    });
    child.send({...input,opts});
  });
}
if(isMain(import.meta.url)&&process.argv[2]==='--cell-worker') {
  const waiting=new Map();let nextId=0;
  process.on('message',message=>{if(message.roundTripReply){waiting.get(message.roundTripReply.id)(message.roundTripReply);waiting.delete(message.roundTripReply.id);}});
  process.once('message',async ({catalog,zonesSha256,group,zone,variant,kernel,opts,sources})=>{
    opts.roundTrip=(kind,argv,options)=>new Promise(resolve=>{const id=++nextId;waiting.set(id,resolve);process.send({roundTrip:{id,kind,argv,options}});});
    try {
      if(kernel==='wonky-rust') {
        opts.guardSummary=(await import(GUARD)).guardSummary;
        const {openRustBackend,locateRustBuild,rustStaleCheck}=await import('../../src/native/rust-kernel.mjs');
        const addon=await openRustBackend(),live=rustStaleCheck(locateRustBuild());
        opts.perfAddon=addon.addon;
        if(addon.sourceHash!==opts.backends[kernel].sourceHash||live.sourceHash!==opts.backends[kernel].sourceHash||sha256(fs.readFileSync(live.path))!==opts.backends[kernel].addonSha256)throw new Error('LIVE_ADDON_IDENTITY_MISMATCH');
      }
      const row=await buildOne(catalog,zonesSha256,group,zone,variant,kernel,opts,sources);
      process.send({row},()=>process.disconnect());
    } catch(error) {
      console.error(error.stack);
      process.exitCode=1;
      process.send({error:error.stack},()=>process.disconnect());
    }
  });
}
