#!/usr/bin/env node
// Offline unless explicitly --live. Never import an Onshape client or probe at startup.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {PRIVATE_POTS, publicDocument, publicRuns} from './public-capture.mjs';
import {setTimeout as wait} from 'node:timers/promises';
import {ROOT,VARIANTS,loadCatalog,sourceHashes,sha256,writeJSON,isMain} from './common.mjs';
const BASE='http://127.0.0.1:8317';
// One Part Studio per variant holds every group feature: the STEP translation pot is tiny
// so one translation per variant, not per group.
// Failed features are diagnosed with one getFeatureError evaluation per variant at most.
const FS_EVAL_MAX=VARIANTS.length;
const FEATURE_ID=/^[A-Za-z0-9_]+$/;
export function assertBridge(base) { if(base!==BASE)throw new Error('BRIDGE_BASE_REFUSED: only http://127.0.0.1:8317 is allowed'); }
export function callPlan(catalog,base=BASE) {
  assertBridge(base);
  const groups=catalog.groups.length,variants=VARIANTS.length,states=groups*variants,zones=catalog.zones.length*variants;
  return {dryRun:true,networkRequests:0,base,document:{name:'wonky CAD-Acid v1',isPublic:true},
    calls:[
      {pot:'local',method:'GET',path:'/_bridge/health',count:1},
      {pot:'sessioninfo',method:'GET',path:'/api/users/sessioninfo',count:1},
      {pot:'metering',method:'GET',path:'/api/v14/metrics/api/summary?startDate=<explicit-window>',count:2},
      {pot:'local',method:'GET',path:'/_bridge/limits',count:2},
      {pot:'documents',method:'POST',path:'/api/documents',count:1},
      {pot:'writes',method:'POST',path:'/api/v9/featurestudios/d/<d>/w/<w>',count:groups},
      {pot:'writes',method:'POST',path:'/api/v9/featurestudios/d/<d>/w/<w>/e/<fs> (contents)',count:groups},
      {pot:'reads',method:'GET',path:'/api/v9/featurestudios/d/<d>/w/<w>/e/<fs>/featurespecs',count:groups},
      {pot:'writes',method:'POST',path:'/api/v9/partstudios/d/<d>/w/<w> (one Part Studio per variant)',count:variants},
      {pot:'writes',method:'POST',path:'/api/v9/partstudios/d/<d>/w/<w>/e/<ps>/features',count:states,fallbackMax:states+zones},
      {pot:'fs_eval',method:'POST',path:'/api/v9/partstudios/d/<d>/w/<w>/e/<ps>/featurescript (getFeatureError, only if a feature failed)',count:0,max:FS_EVAL_MAX},
      {pot:'microversion',method:'GET',path:'/api/documents/d/<d>/w/<w>/currentmicroversion (before and after export)',count:2*variants},
      {pot:'parts',method:'GET',path:'/api/parts/d/<d>/m/<mv>/e/<ps>',count:variants},
      {pot:'reads',method:'GET',path:'/api/partstudios/d/<d>/m/<mv>/e/<ps>/massproperties?massAsGroup=false',count:variants},
      {pot:'mass',method:'GET',path:'/api/parts/d/<d>/m/<mv>/e/<ps>/partid/<part>/massproperties',count:'only parts missing from the grouped response'},
      {pot:'bodydetails',method:'GET',path:'/api/partstudios/d/<d>/m/<mv>/e/<ps>/bodydetails',count:variants},
      {pot:'reads',method:'GET',path:'/api/partstudios/d/<d>/m/<mv>/e/<ps>/boundingboxes',count:variants},
      {pot:'translations',method:'POST',path:'/api/v11/partstudios/d/<d>/w/<w>/e/<ps>/translations (no /m/ route; microversion checked before and after)',count:variants},
      {pot:'translations-get',method:'GET',path:'/api/translations/<id>',count:'up to 60 polls per translation'},
      {pot:'downloads',method:'GET',path:'/api/documents/d/<d>/externaldata/<id>',count:variants},
    ],constraints:{features_get:0,features_get_max:4,fs_eval:0,fs_eval_max:FS_EVAL_MAX,noRetriesOnUncertainWrite:true,featureStatus:'must be OK in write response; ERROR falls back per zone; any other status stops the push',
      fallback:'a failed ALL feature is followed by isolated zone features in the same variant Part Studio; failures recorded, never omitted',sourceFiles:catalog.groups.map(g=>g.fs)}};
}
function counters(data) {
  const found={};
  const visit=x=>{if(!x||typeof x!=='object')return;for(const [k,v]of Object.entries(x)){if(['keyCount','clientCount'].includes(k)){if(!Number.isFinite(v))throw new Error('METERING_COUNTER_INVALID');(found[k]??=[]).push(v);}else visit(v);}};
  visit(data);
  if(!found.keyCount?.length||!found.clientCount?.length)throw new Error('METERING_COUNTERS_MISSING');
  return Object.fromEntries(Object.entries(found).map(([k,v])=>[k,v.sort((a,b)=>a-b)]));
}
async function live(catalog,zonesSha256,opts) {
  assertBridge(opts.base);
  if(!opts.meterStart||!Number.isFinite(Date.parse(opts.meterStart)))throw new Error('METER_WINDOW_REQUIRED: --meter-start <ISO date>');
  const sources=sourceHashes(catalog);for(const g of catalog.groups)if(!sources[g.fs])throw new Error(`STUDIO_MISSING: ${g.fs}`);
  const out=opts.out,privateOut=path.join(ROOT,'var/cad-acid-private',sha256(path.resolve(out)).slice(0,16));
  const statePath=path.join(privateOut,'state.json');
  if(fs.existsSync(path.join(out,'provenance.json')))throw new Error('EXISTING_FREEZE_REFUSED: provenance.json exists');
  let state;
  if(fs.existsSync(statePath)) {
    // Recovery is deliberate: an uncertain POST may have succeeded. No automatic replay.
    if(!opts.resume)throw new Error('EXISTING_FREEZE_REFUSED: inspect saved state/pending write, then --resume');
    state=JSON.parse(fs.readFileSync(statePath,'utf8'));
    if(state.pending)throw new Error(`PENDING_WRITE_UNRESOLVED: ${state.pending.method} ${state.pending.path}; reconcile the live state before resuming`);
    if(state.zonesSha256!==zonesSha256||JSON.stringify(state.sources)!==JSON.stringify(sources))throw new Error('SOURCE_CHANGED_SINCE_FREEZE_START');
    const open=state.partStudios.find(p=>!p.complete);
    if(open)throw new Error(`VARIANT_INCOMPLETE: ${open.variant} Part Studio ${open.element}; reconcile before resuming`);
  } else {
    if(opts.resume)throw new Error('NOTHING_TO_RESUME');
    fs.mkdirSync(path.join(out,'inputs'),{recursive:true});
    fs.copyFileSync(path.join(ROOT,'fixtures/cad-acid/zones.json'),path.join(out,'inputs/zones.json'));
    for(const group of catalog.groups)fs.copyFileSync(path.join(ROOT,group.fs),path.join(out,'inputs',path.basename(group.fs)));
    state={schema:'wonky/cad-acid-onshape/1',zonesSha256,sources,featureStudios:[],partStudios:[],studios:[],runs:[],fsEvals:0,calls:[],pending:null};
  }
  state.publicFiles ??= ['inputs/zones.json', ...catalog.groups.map(g=>'inputs/'+path.basename(g.fs))];
  const save=()=>writeJSON(statePath,state);
  const recordPublic=file=>{const rel=path.relative(out,file);if(!state.publicFiles.includes(rel))state.publicFiles.push(rel);};
  const publicJSON=(file,value)=>{writeJSON(file,value);recordPublic(file);};
  const caps={writes:3000,reads:3000,parts:500,bodydetails:500,documents:200,microversion:400,mass:1000,features_get:100,fs_eval:100};
  let last=0;
  async function call(method,endpoint,pot,body,binary=false) {
    if(!endpoint.startsWith('/api/')&&!endpoint.startsWith('/_bridge/'))throw new Error('ENDPOINT_REFUSED');
    if(endpoint.includes('://')||endpoint.includes('..'))throw new Error('ENDPOINT_REFUSED');
    if(pot==='features_get')throw new Error('BUDGET_POT_REFUSED');
    if(pot==='fs_eval'&&state.fsEvals>=FS_EVAL_MAX)throw new Error('BUDGET_POT_REFUSED: fs_eval diagnosis cap reached');
    const url=new URL(endpoint,opts.base);if(url.origin!==BASE)throw new Error('BRIDGE_BASE_REFUSED');
    await wait(Math.max(0,400-(Date.now()-last)));last=Date.now();
    const log={method,path:endpoint,pot,at:new Date().toISOString()};state.calls.push(log);
    if(pot==='fs_eval')state.fsEvals++;
    if(method!=='GET'){state.pending={method,path:endpoint,bodySha256:sha256(JSON.stringify(body)),at:log.at};save();}
    try {
      const r=await fetch(url,{method,headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(120000)});
      Object.assign(log,{status:r.status,remaining:r.headers.get('x-rate-limit-remaining'),retryAfter:r.headers.get('retry-after')});
      save();
      if(!r.ok)throw new Error(`BRIDGE_HTTP_${r.status}: ${endpoint}: retry-after ${log.retryAfter}: ${(await r.text()).slice(0,1000)}`);
      const data=binary?Buffer.from(await r.arrayBuffer()):await r.json();
      // Save the response before clearing pending or consulting budgets.
      if(!binary) {
        const file=`${String(state.calls.length).padStart(4,'0')}.json`;
        if(PRIVATE_POTS.has(pot))writeJSON(path.join(privateOut,run.startedAt.replace(/[:.]/g,'-'),'responses',file),data);
        else publicJSON(path.join(out,'responses',file),method==='POST'&&endpoint==='/api/documents'?publicDocument(data):data);
        save();
      }
      if(method!=='GET'){state.pending=null;save();}
      if(log.remaining!==null&&caps[pot]&&Number(log.remaining)<caps[pot]*0.2)throw new Error(`BUDGET_LOW: ${pot} remaining ${log.remaining}; state saved, stop`);
      return data;
    }catch(e){log.error=e.message;save();throw e;}
  }
  const meterPath=`/api/v14/metrics/api/summary?startDate=${encodeURIComponent(opts.meterStart)}`;
  const run={startedAt:new Date().toISOString(),variants:opts.variants};state.runs.push(run);
  let before;
  try {
    run.health=await call('GET','/_bridge/health','local');
    const session=await call('GET','/api/users/sessioninfo','sessioninfo');
    if(session.isGuest!==false)throw new Error('ONSHAPE_SESSION_NOT_AUTHENTICATED');
    before=counters(await call('GET',meterPath,'metering'));run.meterBefore=before;
    run.limitsBefore=await call('GET','/_bridge/limits','local');
    if(!state.document) {
      const doc=await call('POST','/api/documents','documents',{name:'wonky CAD-Acid v1',isPublic:true});
      state.document=doc.id;state.workspace=doc.defaultWorkspace?.id;
      if(!state.document||!state.workspace)throw new Error('DOCUMENT_IDS_MISSING');save();
    }
    const dw=`/d/${state.document}/w/${state.workspace}`;
    for(const group of catalog.groups) {
      if(state.featureStudios.some(f=>f.group===group.id))continue;
      const fsPath=`/api/v9/featurestudios${dw}`,studio=await call('POST',fsPath,'writes',{name:`acid-${group.id}`});
      const contents=fs.readFileSync(path.join(ROOT,group.fs),'utf8');
      if(sha256(contents)!==sources[group.fs])throw new Error('SOURCE_CHANGED_DURING_PUSH');
      await call('POST',`${fsPath}/e/${studio.id}`,'writes',{contents});
      const specs=await call('GET',`${fsPath}/e/${studio.id}/featurespecs`,'reads');
      const spec=specs.featureSpecs?.find(s=>s.featureType===group.featureScript.customFeature);
      if(!spec?.namespace?.startsWith(`e${studio.id}::m`))throw new Error(`STUDIO_COMPILE_FAILED: ${group.id}`);
      state.featureStudios.push({group:group.id,element:studio.id,namespace:spec.namespace,sourceMicroversion:spec.sourceMicroversionId??spec.namespace.match(/::m([a-f0-9]{24})$/)?.[1],sha256:sources[group.fs]});save();
    }
    const namespaces=Object.fromEntries(state.featureStudios.map(f=>[f.group,f.namespace]));
    async function buildVariant(variant) {
      const ps=await call('POST',`/api/v9/partstudios${dw}`,'writes',{name:`acid-${variant}`});
      const studio={variant,element:ps.id,complete:false};state.partStudios.push(studio);save();
      async function addFeature(group,zone) {
        const namespace=namespaces[group.id],name=`${group.id}-${variant}-${zone}`;
        const parameters=[['variant','AcidVariant',variant],['zone',group.featureScript.parameters.zone.type.replace('enum ',''),zone]].map(([parameterId,enumName,value])=>({btType:'BTMParameterEnum-145',parameterId,enumName,namespace,value}));
        const write=await call('POST',`/api/v9/partstudios${dw}/e/${ps.id}/features`,'writes',{btType:'BTFeatureDefinitionCall-1406',feature:{btType:'BTMFeature-134',featureType:group.featureScript.customFeature,name,namespace,parameters,suppressed:false}});
        const record={group:group.id,variant,zone,element:ps.id,featureId:write.feature?.featureId??null,featureStatus:write.featureState?.featureStatus??null};
        state.studios.push(record);save();
        if(!FEATURE_ID.test(record.featureId??''))throw new Error(`FEATURE_ID_MISSING: ${name}`);
        // An ERROR feature is rolled back by Onshape (checked below); WARNING/INFO keep geometry and need a decision.
        if(!['OK','ERROR'].includes(record.featureStatus))throw new Error(`FEATURE_STATUS_UNHANDLED: ${name} ${record.featureStatus}`);
        if(record.featureStatus==='ERROR')record.failure='FEATURE_STATUS_ERROR';
        return record;
      }
      for(const group of catalog.groups)if((await addFeature(group,'ALL')).featureStatus!=='OK')for(const zone of group.zoneIds)await addFeature(group,zone);
      const dir=path.join(out,'studios',`acid-${variant}`);fs.mkdirSync(dir,{recursive:true});
      const freeze=(file,value)=>{publicJSON(path.join(dir,file),value);return path.relative(out,path.join(dir,file));};
      const records=state.studios.filter(s=>s.element===ps.id),failed=records.filter(s=>s.featureStatus!=='OK');
      if(failed.length) {
        // Raw Onshape verdict (error enum) plus proof that the failed feature left no body; no category mapping here.
        const script=`function(context is Context, queries) { var result = {}; ${failed.map(f=>`result["${f.featureId}"] = { "error" : getFeatureError(context, makeId("${f.featureId}")), "bodies" : size(evaluateQuery(context, qCreatedBy(makeId("${f.featureId}"), EntityType.BODY))) };`).join(' ')} return result; }`;
        // Diagnosis only: a failed evaluation is recorded and never blocks the geometry freeze.
        try { studio.featureErrors=freeze('feature-errors.json',await call('POST',`/api/v9/partstudios${dw}/e/${ps.id}/featurescript`,'fs_eval',{script,queries:{}})); }
        catch(error) { if(/BUDGET_LOW|METERING/.test(error.message))throw error; studio.featureErrorsFailure=error.message; }
        save();
      }
      const microversion=async()=>{const m=await call('GET',`/api/documents${dw}/currentmicroversion`,'microversion');const id=m.microversion??m.microversionId??m.id;if(!/^[a-f0-9]{24}$/.test(id??''))throw new Error('IMMUTABLE_MICROVERSION_MISSING');return id;};
      studio.microversion=await microversion();save();
      const dm=`/d/${state.document}/m/${studio.microversion}/e/${ps.id}`;
      const parts=await call('GET',`/api/parts${dm}`,'parts');studio.parts=freeze('parts.json',parts);
      const grouped=await call('GET',`/api/partstudios${dm}/massproperties?massAsGroup=false`,'reads');
      const groupedFile=freeze('massproperties.json',grouped);studio.mass={};
      for(const part of parts)studio.mass[part.partId]=grouped.bodies?.[part.partId]?groupedFile:
        freeze(`mass-${part.partId}.json`,await call('GET',`/api/parts${dm}/partid/${encodeURIComponent(part.partId)}/massproperties`,'mass'));
      studio.bodydetails=freeze('bodydetails.json',await call('GET',`/api/partstudios${dm}/bodydetails`,'bodydetails'));
      studio.boundingboxes=freeze('boundingboxes.json',await call('GET',`/api/partstudios${dm}/boundingboxes`,'reads'));save();
      // Translations have no /m/ route: export the workspace and prove it still is that microversion.
      const job=await call('POST',`/api/v11/partstudios${dw}/e/${ps.id}/translations`,'translations',{formatName:'STEP',storeInDocument:false});
      let translation=job;
      for(let n=0;n<60&&!['DONE','FAILED','CANCELED','CANCELLED'].includes(translation.requestState);n++){await wait(2000);translation=await call('GET',`/api/translations/${job.id}`,'translations-get');}
      studio.translation=freeze('translation.json',translation);
      if(translation.requestState!=='DONE'||translation.resultExternalDataIds?.length!==1)throw new Error(`STEP_TRANSLATION_FAILED: ${variant} ${translation.requestState}`);
      const binary=await call('GET',`/api/documents/d/${state.document}/externaldata/${translation.resultExternalDataIds[0]}`,'downloads',undefined,true);
      if(binary.length<100||!binary.toString('ascii',0,100).includes('ISO-10303-21'))throw new Error('STEP_BINARY_INVALID');
      if(await microversion()!==studio.microversion)throw new Error('MICROVERSION_MOVED_DURING_EXPORT');
      fs.writeFileSync(path.join(dir,'model.step'),binary);recordPublic(path.join(dir,'model.step'));studio.step=path.relative(out,path.join(dir,'model.step'));
      for(const r of records)if(r.featureStatus==='OK')Object.assign(r,{microversion:studio.microversion,parts:studio.parts,mass:studio.mass,
        bodydetails:studio.bodydetails,boundingboxes:studio.boundingboxes,translation:studio.translation,step:studio.step});
      studio.complete=true;save();
    }
    for(const variant of opts.variants)if(!state.partStudios.some(p=>p.variant===variant))await buildVariant(variant);
    state.complete=VARIANTS.every(v=>state.partStudios.some(p=>p.variant===v&&p.complete));
  } finally {
    if(before) {
      const after=counters(await call('GET',meterPath,'metering'));run.meterAfter=after;
      run.limitsAfter=await call('GET','/_bridge/limits','local');run.finishedAt=new Date().toISOString();writeJSON(path.join(privateOut,'runs.json'),state.runs);save();
      if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('METERING_CHANGED: keyCount/clientCount changed; stop');
    }
  }
  if(!state.complete){save();console.log(`Partial freeze saved in ${statePath}; continue with --resume --variants <rest>`);return;}
  writeJSON(path.join(privateOut,'call-log.json'),state.calls);
  publicJSON(path.join(out,'provenance.json'),{...state,pending:undefined,calls:undefined,publicFiles:undefined,runs:publicRuns(state.runs),frozenAt:new Date().toISOString()});
  fs.rmSync(statePath);
  const tracked=execFileSync('git',['ls-files','-z','--',path.relative(ROOT,out)],{cwd:ROOT}).toString().split('\0').filter(Boolean).map(f=>path.relative(out,path.join(ROOT,f)));
  const files=[...new Set([...tracked,...state.publicFiles])].filter(f=>f!=='SHA256SUMS'&&fs.existsSync(path.join(out,f))).sort();
  fs.writeFileSync(path.join(out,'SHA256SUMS'),files.map(f=>`${sha256(fs.readFileSync(path.join(out,f)))}  ${f}`).join('\n')+'\n');
  console.log(`Frozen ${state.studios.length} feature states in ${state.partStudios.length} Part Studios in ${out}`);
}
if(isMain(import.meta.url)) {
  try {
    const args=process.argv.slice(2),opts={live:false,resume:false,base:BASE,out:path.join(ROOT,'fixtures/cad-acid/onshape'),variants:VARIANTS};
    for(let i=0;i<args.length;i++){const a=args[i];if(a==='--live')opts.live=true;else if(a==='--dry-run')opts.live=false;else if(a==='--resume')opts.resume=true;
      else if(['--base','--out','--meter-start','--variants'].includes(a)){if(!args[i+1])throw new Error(`${a} needs a value`);opts[{'--base':'base','--out':'out','--meter-start':'meterStart','--variants':'variants'}[a]]=args[++i];}else throw new Error(`Unknown argument ${a}`);}
    if(typeof opts.variants==='string')opts.variants=opts.variants.split(',');
    if(!opts.variants.length||opts.variants.some(v=>!VARIANTS.includes(v)))throw new Error('INVALID_VARIANTS');
    const {catalog,zonesSha256}=loadCatalog();assertBridge(opts.base);
    if(!opts.live)console.log(JSON.stringify(callPlan(catalog,opts.base),null,2));else await live(catalog,zonesSha256,opts);
  }catch(error){console.error(error.stack);process.exitCode=1;}
}
