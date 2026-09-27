#!/usr/bin/env node
// Sequential, bounded foreground runs. One zone's failure cannot erase its neighbours.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {codeIdentity, artifactHashes, verifyExactObservation, canonical} from './evidence.mjs';
import {ROOT,CATALOG,VARIANTS,KERNELS,loadCatalog,sourceHashes,sha256,readJSON,writeJSON,verifyFrozenReference,kernelClass} from './common.mjs';
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
function execute(command,args,out,timeout,extraEnv={}) {
  fs.mkdirSync(out,{recursive:true});
  const r=spawnSync(command,args,{cwd:ROOT,encoding:'utf8',detached:process.platform!=='win32',timeout:timeout*1000,killSignal:'SIGKILL',maxBuffer:16*1024*1024,
    env:{...process.env,...extraEnv,NODE_OPTIONS:'--max-old-space-size=8192'}});
  if(r.error && r.pid && process.platform!=='win32') { try { process.kill(-r.pid,'SIGKILL'); } catch(error) { if(error.code!=='ESRCH')throw error; } }
  fs.writeFileSync(path.join(out,'command.log'),`$ ${[command,...args].join(' ')}\nstatus=${r.status} signal=${r.signal} error=${r.error?.message??''}\n--- stdout\n${r.stdout??''}\n--- stderr\n${r.stderr??''}`);
  return {ok:r.status===0&&!r.error,status:r.status,signal:r.signal,error:r.error?.message,stderrTail:r.stderr?.trim().split('\n').slice(-4)};
}
const uvArgs=(file,...args)=>['run','--no-project',PYTHON,'-B',path.join(ROOT,'scripts/acid',file),...args];
async function buildOne(catalog,zonesSha256,group,zone,variant,kernel,opts,sources) {
  const identity={kernel,zone,variant,group:group.id,code:opts.code,
    ...(opts.backends[kernel]?{backend:opts.backends[kernel]}:{})};
  const source=path.join(ROOT,kernel==='occt'?group.b3d:group.fs);
  const sourceSha256=sources[path.relative(ROOT,source)];
  if(!sourceSha256)return {...identity,outcome:'not_run',reason:`TWIN_UNAVAILABLE: ${path.relative(ROOT,source)}`};
  if(kernel==='wonky-rust'&&!opts.rustAvailable)return {...identity,outcome:'not_run',reason:'STRICT_BACKEND_UNAVAILABLE: rust is not registered; no Bend fallback'};
  if(kernel==='occt'&&!fs.existsSync(PYTHON))return {...identity,outcome:'not_run',reason:'REFERENCE_VENV_UNAVAILABLE'};
  const out=path.join(opts.out,kernel,group.id,variant,zone);
  fs.mkdirSync(out,{recursive:true});
  // Never reuse stale geometry, build/error records or guard logs after a failed attempt.
  for(const f of ['build.json','error.json','model.step','model.brep.json','measure.json','bend-guard.json'])fs.rmSync(path.join(out,f),{force:true});
  const parameters={variant:`AcidVariant.${variant}`,zone:`${group.featureScript.parameters.zone.type.replace('enum ','')}.${zone}`};
  const request={source,sourceSha256,zonesSha256,feature:group.featureScript.customFeature,parameters,zone,variant,out,catalog:CATALOG};
  const sibling=path.join(path.dirname(source),'modules.json');if(fs.existsSync(sibling))request.moduleManifest=sibling;
  const reqFile=path.join(out,'request.json');writeJSON(reqFile,request);
  const start=performance.now();
  let result,execution;
  if(kernel==='occt') {
    execution=execute('uv',uvArgs('build-occt.py',reqFile),out,opts.timeout);
    if(fs.existsSync(path.join(out,'build.json')))result=readJSON(path.join(out,'build.json'));
  } else {
    const {buildWonky}=await import('./build-wonky.mjs');
    result=await buildWonky(request);
    const guard=opts.guardSummary();
    if(guard.bendLoaded)throw new Error('STRICT_BACKEND_BEND_LEAK');
    result.guard=guard;
    execution={ok:result.outcome==='built'&&!result.builtBeforeFailure,mode:'in-process',pid:process.pid};
  }
  const seconds=(performance.now()-start)/1000;
  if(!result)return {...identity,outcome:'error',reason:`BUILD_PROCESS_FAILED: ${JSON.stringify(execution)}`,seconds};
  if(result.outcome==='built'&&!result.builtBeforeFailure&&zone!=='ALL'&&kernel!=='occt') {
    const step=path.join(out,'model.step'), observed=path.join(out,'measure.json');
    const measurement=execute('uv',uvArgs('measure.py',step,'--zone',zone,'--variant',variant,'--out',observed),path.join(out,'measure'),opts.timeout);
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
      const validation=execute('uv',['run',path.join(ROOT,'scripts/validate-step.py'),path.join(out,'model')],path.join(out,'validate-step'),opts.timeout);
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
  if(sha256(fs.readFileSync(source))!==sourceSha256)return {...identity,outcome:'error',reason:'SOURCE_CHANGED_DURING_RUN',seconds};
  const row={...identity,...result,...(result.backend||opts.backends[kernel]?{backend:{...result.backend,...opts.backends[kernel]}}:{}),seconds,execution,artifacts:path.relative(ROOT,out),artifactHashes:artifactHashes(out)};
  if(kernel==='wonky-rust'&&result.backend?.sourceHash&&result.backend.sourceHash!==opts.backends[kernel].sourceHash)throw new Error('LIVE_ADDON_IDENTITY_MISMATCH');
  if(result.outcome==='built'&&zone!=='ALL'&&kernelClass(catalog,kernel)==='exact')
    row.evidence=verifyExactObservation(catalog.zones.find(z=>z.id===zone),row);
  return row;
}
async function frozenRows(catalog,zonesSha256,sources,opts) {
  const frozen=path.join(ROOT,'fixtures/cad-acid/onshape');
  if(!fs.existsSync(path.join(frozen,'provenance.json')))return {rows:[],fixtures:{}};
  const manifest=path.join(frozen,'SHA256SUMS'),hashes=fs.readFileSync(manifest,'utf8');
  const fixtures={[path.relative(ROOT,manifest)]:sha256(hashes)};
  const p=verifyFrozenReference(frozen,zonesSha256,sources);
  let rows;
  if(p.observations) {
    const file=path.join(frozen,p.observations),bytes=fs.readFileSync(file);
    const digest=sha256(bytes);
    if(!hashes.split('\n').includes(`${digest}  ${p.observations}`))throw new Error('REFERENCE_OBSERVATIONS_UNHASHED');
    fixtures[path.relative(ROOT,file)]=digest;
    const rr=JSON.parse(bytes);
    if(rr.zonesSha256!==zonesSha256)throw new Error('REFERENCE_ZONES_SHA_MISMATCH');
    rows=rr.rows.map(r=>({...r,kernel:'onshape'}));
  } else {
    const target=path.join(opts.out,'onshape-observations.json');fs.rmSync(target,{force:true});
    const observed=execute('uv',uvArgs('frozen-onshape.py',frozen,CATALOG,target),path.join(opts.out,'onshape-observer'),opts.timeout);
    if(!observed.ok||!fs.existsSync(target))throw new Error('ONSHAPE_FROZEN_OBSERVER_FAILED');
    rows=readJSON(target).rows;
  }
  if(sha256(fs.readFileSync(manifest))!==fixtures[path.relative(ROOT,manifest)])throw new Error('REFERENCE_CHANGED_DURING_OBSERVATION');
  return {rows,fixtures};
}

// Frozen verification is deliberately separate from execution admission. A
// stored external observation can be checked against a fixed artifact, not
// promoted to evidence of a live invocation. No live Onshape calls occur.
export async function verifyStoredReferences(results,{out,timeout=180}={}) {
  const {catalog,zonesSha256}=loadCatalog(),sources=sourceHashes(catalog);
  if(results.zonesSha256!==zonesSha256)throw new Error('REFERENCE_ZONES_SHA_MISMATCH');
  if(results.rows.some(r=>r.kernel==='onshape')) {
    const {rows,fixtures}=await frozenRows(catalog,zonesSha256,sources,{out,timeout});
    const byKey=new Map(rows.map(r=>[`${r.zone}/${r.variant}`,r]));
    for(const row of results.rows.filter(r=>r.kernel==='onshape')) {
      const frozen=byKey.get(`${row.zone}/${row.variant}`);
      const matches=frozen&&canonical(observation(row))===canonical(observation(frozen));
      remember(row,matches?'frozen':'unverified',matches?fixtures:{});
    }
  }
  const storedOcct=results.rows.filter(r=>r.kernel==='occt');
  if(storedOcct.length) {
    const dir=path.join(ROOT,'fixtures/cad-acid/occt');
    const frozen=new Map(),fixtures={};
    if(fs.existsSync(path.join(dir,'provenance.json'))) {
      const manifest=path.join(dir,'SHA256SUMS'),hashes=fs.readFileSync(manifest,'utf8');
      const checked=new Map();
      for(const line of hashes.trim().split('\n')) {
        const match=line.match(/^([a-f0-9]{64}) {2}([^/]+)$/);
        if(!match||checked.has(match[2]))throw new Error('FROZEN_OCCT_CHECKSUM_MISMATCH');
        const bytes=fs.readFileSync(path.join(dir,match[2]));
        if(sha256(bytes)!==match[1])throw new Error('FROZEN_OCCT_CHECKSUM_MISMATCH');
        checked.set(match[2],bytes);
      }
      if(!checked.has('provenance.json'))throw new Error('FROZEN_OCCT_PROVENANCE_MISMATCH');
      const p=JSON.parse(checked.get('provenance.json'));
      if(p.schema!=='wonky/cad-acid-occt-frozen/1'||!checked.has(p.observations)||p.zonesSha256!==zonesSha256)throw new Error('FROZEN_OCCT_PROVENANCE_MISMATCH');
      for(const group of catalog.groups)if(p.sources?.[group.b3d]!==sources[group.b3d])throw new Error('FROZEN_OCCT_TWIN_MISMATCH');
      const bytes=checked.get(p.observations),stored=JSON.parse(bytes);
      fixtures[path.relative(ROOT,manifest)]=sha256(hashes);
      fixtures[path.relative(ROOT,path.join(dir,p.observations))]=sha256(bytes);
      if(stored.zonesSha256!==zonesSha256)throw new Error('FROZEN_OCCT_CATALOG_MISMATCH');
      for(const row of stored.rows) {
        const key=`${row.zone}/${row.variant}`;
        if(row.kernel!=='occt'||frozen.has(key))throw new Error('FROZEN_OCCT_DUPLICATE_OR_KERNEL');
        frozen.set(key,row);
      }
    }
    for(const row of storedOcct) {
      const reference=frozen.get(`${row.zone}/${row.variant}`);
      // Self-written artifacts can be internally consistent without being a
      // frozen reference. Only an exact observation match admits stored rows.
      const matches=reference&&canonical(observation(row))===canonical(observation(reference));
      remember(row,matches?'frozen':'unverified',matches?fixtures:{});
    }
  }
}

export async function executeRun(options) {
  const opts={variants:VARIANTS,kernels:['wonky-rust'],timeout:180,noSmoke:false,...options};
  const {catalog,zonesSha256}=loadCatalog(),sources=sourceHashes(catalog);
  if(opts.kernels.some(k=>!['wonky-rust','occt','onshape'].includes(k)))throw new Error('RETIRED_OR_UNKNOWN_KERNEL');
  if(opts.variants.some(v=>!VARIANTS.includes(v))||opts.zones?.some(id=>!catalog.zones.some(z=>z.id===id)))throw new Error('INVALID_RUN_SELECTION');
  fs.mkdirSync(opts.out,{recursive:true});
  const claims=opts.claims;
  if(claims&&claims.zonesSha256!==zonesSha256)throw new Error('REFERENCE_ZONES_SHA_MISMATCH');
  const claimed=new Map();
  for(const row of claims?.rows??[]) {
    const key=`${row.kernel}/${row.zone}/${row.variant}`;
    if(claimed.has(key))throw new Error(`DUPLICATE_OBSERVATION: ${key}`);
    if(!KERNELS.includes(row.kernel)||!catalog.zones.some(z=>z.id===row.zone)||!VARIANTS.includes(row.variant))throw new Error(`UNKNOWN_OBSERVATION: ${key}`);
    claimed.set(key,row);
  }
  const closed=execute('uv',['run',path.join(ROOT,'scripts/acid/closed-forms.py'),'--zones',CATALOG],path.join(opts.out,'closed-forms'),Math.max(90,opts.timeout));
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
    opts.rustAvailable=true;
  }
  const results={schema:'wonky/cad-acid-results/1',zonesSha256,sources,rows:[],liveReferences:[],smoke:[],closedForms:closed,
    code:opts.code,requestedKernels:opts.kernels,startedAt:new Date().toISOString(),reverification:claims?{mismatches:[]}:undefined};
  for(const file of ['scoreboard.json','scoreboard.md'])fs.rmSync(path.join(opts.out,file),{force:true});
  const save=()=>writeJSON(path.join(opts.out,'results.json'),results);
  if(!claims||claims.rows.some(r=>r.kernel==='onshape')) {
    const {rows,fixtures}=await frozenRows(catalog,zonesSha256,sources,opts);
    for(const row of rows) {
      const claim=claimed.get(`onshape/${row.zone}/${row.variant}`);
      if(!claims)results.rows.push(remember(row,'frozen',fixtures));
      else if(claim)results.rows.push(canonical(observation(claim))===canonical(observation(row))?remember(row,'frozen',fixtures):{...claim,reverification:{reason:'frozen reference observation mismatch'}});
    }
  }
  if(!claims) {
    const stored=path.join(ROOT,'fixtures/cad-acid/occt/observations.json');
    if(fs.existsSync(stored)) {
      const frozen=readJSON(stored);
      await verifyStoredReferences(frozen,{out:path.join(opts.out,'stored-references')});
      results.rows.push(...frozen.rows);
    }
  }
  for(const kernel of opts.kernels.filter(k=>k!=='onshape'))for(const group of catalog.groups) {
    const zones=group.zoneIds.filter(id=>!opts.zones||opts.zones.includes(id));if(!zones.length)continue;
    for(const variant of opts.variants) {
      if(!opts.noSmoke&&!claims) {results.smoke.push(await buildOne(catalog,zonesSha256,group,'ALL',variant,kernel,opts,sources));save();}
      for(const zone of zones) {
        const claim=claimed.get(`${kernel}/${zone}/${variant}`);if(claims&&!claim)continue;
        let row=await buildOne(catalog,zonesSha256,group,zone,variant,kernel,opts,sources);
        if(kernel==='occt') {
          // Live diagnostics are not a frozen reference, even when OCCT succeeds.
          // Keep them separate so scoring and merging cannot replace frozen rows.
          row.evidence={status:'live-reference',scored:false};
          results.liveReferences.push(remember(row,'live-reference'));
          console.log(`${kernel} ${zone} ${variant}: ${row.outcome} live-reference (unscored)`);save();continue;
        }
        const reason=claims?(claims.code?.treeSha256!==opts.code.treeSha256?'recorded run tree identity differs from live tree':mismatch(claim,row,opts.code,catalog.zones.find(z=>z.id===zone),opts.artifactRoot)):null;
        if(reason) {
          results.reverification.mismatches.push({kernel,zone,variant,reason,claimedOutcome:claim.outcome,liveOutcome:row.outcome});
          row={...claim,reverification:{reason,liveOutcome:row.outcome}};
        } else remember(row,claims?'re-verified':'live');
        results.rows.push(row);console.log(`${kernel} ${zone} ${variant}: ${row.outcome}${reason?' UNVERIFIED: '+reason:''}`);save();
      }
    }
  }
  // External stored observations are never replayed as wonky or labelled live.
  if(claims) {
    const stored=claims.rows.filter(row=>!results.rows.some(r=>r.kernel===row.kernel&&r.zone===row.zone&&r.variant===row.variant));
    await verifyStoredReferences({...claims,rows:stored},{out:path.join(opts.out,'stored-references'),artifactRoot:opts.artifactRoot});
    results.rows.push(...stored);
  }
  if(codeIdentity().treeSha256!==results.code.treeSha256)throw new Error('CODE_CHANGED_DURING_RUN');
  if(checkBackend&&canonical(checkBackend())!==canonical(opts.backends['wonky-rust']))throw new Error('ADDON_CHANGED_DURING_RUN');
  if(opts.guardSummary?.().bendLoaded)throw new Error('STRICT_BACKEND_BEND_LEAK');
  results.finishedAt=new Date().toISOString();save();
  return results;
}
