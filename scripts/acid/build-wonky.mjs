// Isolated production frontend/export path, using R20's named error and Bend-load guard.
// Unlike R20's mesh export this permits multiple bodies with the same zone NAME.
import fs from 'node:fs';
import path from 'node:path';
import {ROOT, readJSON, writeJSON, sha256, isMain} from './common.mjs';
import {clock,elapsed,phases,nativeTimer} from './perf.mjs';
import {nativeObservation} from './native-observation.mjs';
import {errorCode} from '../../src/errors.mjs';

// Returning the result directly keeps construction, native observation and scoring
// in one process. Persisted JSON is diagnostic output, never an execution receipt.
export async function buildWonky(request) {
if(process.env.WONKY_BACKEND!=='rust')throw new Error('STRICT_RUST_REQUIRED');
fs.mkdirSync(request.out,{recursive:true});
const catalog=readJSON(request.catalog), zone=catalog.zones.find(z=>z.id===request.zone)??null;
let stage='build', builtResult, timer, model;
const perf={phases:phases(),overheadMs:0};
const timed=async (key,fn)=>{const start=clock();try{return await fn();}finally{perf.phases[key]={status:'executed',...elapsed(start)};}};
try {
  const {build}=await import('../../src/index.mjs');
  const {toStep}=await import('../../src/exporters.mjs');
  const {serializeModel}=await import('../../src/construction-history.mjs');
  const source=fs.readFileSync(request.source,'utf8');
  if(sha256(source)!==request.sourceSha256)throw new Error('SOURCE_CHANGED_DURING_RUN');
  const {openRustBackend}=await import('../../src/native/rust-kernel.mjs');
  const setupStart=performance.now();
  timer=nativeTimer(request.perfAddon??(await openRustBackend()).addon);
  perf.setupMs=performance.now()-setupStart;timer.start();
  const constructionStart=clock();
  try { model=await build(source,{feature:request.feature,parameters:request.parameters,sourcePath:request.source,
    moduleManifest:request.moduleManifest,maxSteps:20_000_000,diagnosticsDirectory:request.out});
  } finally {
    const construction=elapsed(constructionStart), native=timer.stop();
    perf.phases.kernelBuild={status:'executed',...native};
    perf.phases.frontend={status:'executed',wallMs:Math.max(0,construction.wallMs-native.wallMs),cpuMs:Math.max(0,construction.cpuMs-native.cpuMs)};
  }
  const bodies=model.bodies.map(b=>({id:b.id,name:b.name,description:b.description,validation:b.validation,geometry:b.geometry}));
  builtResult={outcome:'built',nativeValidity:bodies.every(b=>b.validation?.closed===true),
    bodies,backend:model.backend,operationEvidence:model.operationEvidence,
    stamp:{zonesSha256:request.zonesSha256,sourceSha256:request.sourceSha256,parameters:request.parameters,source:path.relative(ROOT,request.source)}};
  stage='export';
  fs.writeFileSync(path.join(request.out,'model.brep.json'),serializeModel(model));
  if(process.env.WONKY_BACKEND==='rust'&&zone) {
    stage='observe';
    const rust=await import('../../src/native/rust-host.mjs');
    if(rust.rustModel(model)) {
      builtResult.nativeObservation=await timed('measurement',()=>nativeObservation(model,rust,catalog,zone,request.variant));
      builtResult.metrics=builtResult.nativeObservation.metrics;
    }
  }
  stage='export';
  await timed('stepExport',()=>fs.writeFileSync(path.join(request.out,'model.step'),toStep(model,`acid-${request.zone}-${request.variant}`)));
  writeJSON(path.join(request.out,'build.json'),builtResult);
  return builtResult;
}catch(error){
  const {writeR20Error}=await import('../../src/r20-export.mjs');
  await writeR20Error(request.out,error,request.source);
  const capability=['UnsupportedFeatureError','NativeCapabilityError'].includes(error.name)||error.name?.endsWith('CapabilityError');
  const named=capability||Boolean(error.refusalCategory);
  // Decision D3: the refusal is the operation under test only when the kernel
  // says so for its own builtin and that builtin is one the zone exercises.
  const underTest=stage==='build'&&error.operationUnderTest===true&&typeof error.builtin==='string'&&(zone?.fsFeatures??[]).includes(error.builtin);
  const failure={name:error.name,message:error.message,code:errorCode(error)};
  const result=builtResult
    ? {...builtResult,stage,builtBeforeFailure:true,error:failure,stepRoundTrip:{ok:false,error:failure}}
    : {outcome:named?'refused':'error',stage,error:failure,
      refusal:named?{name:error.name,code:errorCode(error),category:error.refusalCategory??'capability',capability,
        operationUnderTest:underTest,...(error.builtin?{builtin:error.builtin}:{}),...(error.location?{location:error.location}:{})}:undefined};
  writeJSON(path.join(request.out,'build.json'),result);
  console.error(`${error.name}: ${error.message}`);
  return result;
} finally {
  if(timer){const start=performance.now();timer.restore();perf.overheadMs=timer.overheadMs;perf.restoreMs=performance.now()-start;}
  if(model&&builtResult?.outcome==='built') {
    const start=clock();
    try {
      const {toStl}=await import('../../src/exporters.mjs');
      fs.writeFileSync(path.join(request.out,'model.stl'),toStl(model,{deviationMm:0.02}));
      perf.phases.meshExport={status:'executed',...elapsed(start),deviationMm:0.02};
    } catch(error) {
      perf.phases.meshExport={status:error.name?.endsWith('CapabilityError')||error.name==='UnsupportedFeatureError'?'refused':'error',...elapsed(start),deviationMm:0.02,error:{name:error.name,message:error.message}};
      console.error(`Diagnostic STL ${error.name}: ${error.message}`);
    }
  }
  const persistStart=performance.now();
  writeJSON(path.join(request.out,'perf-build.json'),perf);
  perf.persistMs=performance.now()-persistStart;
  // Return diagnostics through an out-of-band request callback, never in the row.
  request.onPerf?.(perf);
}
}
if(isMain(import.meta.url)) {
  const result=await buildWonky(readJSON(process.argv[2]));
  if(result.outcome!=='built'||result.builtBeforeFailure)process.exitCode=1;
}
