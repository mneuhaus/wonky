// Diagnostic timing only. No timing field is admitted to a scored observation.
import os from 'node:os';
import {performance} from 'node:perf_hooks';
export const PHASES = ['frontend','kernelBuild','measurement','stepExport','meshExport','stepRoundTrip','total'];
let clockCostMs=0;
export const clockCost = () => clockCostMs;
export const clock = () => {const start=performance.now(),cpu=process.cpuUsage(),wallMs=performance.now();clockCostMs+=wallMs-start;return {wallMs,cpuMs:(cpu.user+cpu.system)/1000};};
export const elapsed = start => { const end=clock(); return {wallMs:end.wallMs-start.wallMs,cpuMs:end.cpuMs-start.cpuMs}; };
export const familyFor = (zone,group) => zone?.family??zone?.group??group.id;
export function context(jobs, addonWarm) {
  return {host:os.hostname(),platform:process.platform,arch:process.arch,logicalCpus:os.cpus().length,
    slotCount:process.env.WONKY_HOST_SLOTS ? Number(process.env.WONKY_HOST_SLOTS) : ({mini:3,studio:1}[process.env.WONKY_REMOTE_PROFILE]??null),
    slotCpuBudget:process.env.CARGO_BUILD_JOBS ? Number(process.env.CARGO_BUILD_JOBS) : null,
    load1:os.loadavg()[0],parallelCells:jobs,addonWarm,at:new Date().toISOString()};
}
export function phases() { return Object.fromEntries(PHASES.map(key=>[key,{status:'not_run',wallMs:null,cpuMs:null}])); }
export function add(a,b) { return {wallMs:a.wallMs+b.wallMs,cpuMs:a.cpuMs+b.cpuMs}; }
// Same boundaries as bench-wonky: N-API decoding/copying/audits included.
// CPU is process user+system, including native threads, not child processes.
export function nativeTimer(addon, collectLabels=false) {
  const originals=new Map(); let active=false, sum={wallMs:0,cpuMs:0}, overheadMs=0, depth=0, nativeCalls={};
  for(const key of ['hostOp','call']) {
    if(typeof addon[key]!=='function')continue;
    const original=addon[key]; originals.set(key,original);
    const wrapper=function(...args) {
      if(!active||depth)return original.apply(this,args);
      const outer=performance.now(), start=clock(); depth++;
      try { return original.apply(this,args); }
      finally { depth--; const cost=elapsed(start); sum=add(sum,cost);
        if(collectLabels){const label=`${key}:${key==='hostOp'?args[0][2]:args[0]}`,entry=nativeCalls[label]??={calls:0,ms:0};entry.calls++;entry.ms+=cost.wallMs;}
        overheadMs+=Math.max(0,performance.now()-outer-cost.wallMs); }
    };
    addon[key]=wrapper;
    if(addon[key]!==wrapper)throw new Error(`NATIVE_TIMING_WRAPPER_UNAVAILABLE: ${key}`);
  }
  return {start(){sum={wallMs:0,cpuMs:0};nativeCalls={};active=true;},stop(){active=false;return {...sum};},
    get overheadMs(){return overheadMs;},get nativeCalls(){return nativeCalls;},restore(){active=false;for(const [key,value] of originals)addon[key]=value;}};
}
export const phaseScopes = {
  frontend:'build() minus synchronous N-API hostOp/call; includes parsing, interpretation, JS adapters and construction bookkeeping. Imports/setup outside build() are in total only.',
  kernelBuild:'Synchronous N-API hostOp/call during build(), including copies/decode/audits/encode and construction-time validation; not pure algorithm time.',
  measurement:'Native in-memory observation (bench-wonky scope); build123d uses bench-occt observe() scope.',
  stepExport:'STEP generation plus synchronous write/close; no fsync.',
  meshExport:'Diagnostic STL generation/write with explicit deviationMm=0.02; refusal/failure affects perf only, never the scored STEP verdict. Tessellation is an export approximation, not production geometry.',
  stepRoundTrip:'Existing STEP observer plus independent validate-step command, including subprocess startup. CPU sums Python observer process usage, including interpreter/native threads; uv launcher CPU is not available and is excluded.',
  total:'Live cell build, exports, observation and roundtrip; excludes build123d comparison and queue wait. CPU includes measured roundtrip subprocesses.',
  addonWarm:'True means addon loaded before cell start by the existing admission preflight; it does not claim warm model-operation caches.',
  comparison:'Common pipeline: wonky frontend + kernelBuild + measurement + stepExport vs build123d construction + measurement + STEP export. One fresh model in an addon-loaded process; no warmup/repetition. Python module imports excluded; startup is not compared.'
};
