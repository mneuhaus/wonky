#!/usr/bin/env node
// Build, observe and score with checked live addons and ordered cell admission.
import path from 'node:path';
import {ROOT,ALL_VARIANTS,loadCatalog,isMain} from './common.mjs';
import {executeRun,invalidateRunOutputs} from './execution.mjs';
import {score,writeScoreboard} from './score.mjs';

export async function run(options) {
  const results=await executeRun(options);
  const {catalog,zonesSha256}=loadCatalog();
  const report=score(catalog,results,{zonesSha256,...(options.errata?{errata:options.errata}:{})});
  writeScoreboard(report,options.out,{markdown:!options.jsonOnly});
  return report;
}

async function main() {
  const opts={out:path.join(ROOT,'out/cad-acid'),kernels:['wonky-rust'],variants:ALL_VARIANTS,zones:null,timeout:180,noSmoke:false};
  try {
    const args=process.argv.slice(2);
    // Resolve the destination even when an earlier argument is invalid. A failed
    // CLI attempt must retire its previous output before the parser can throw.
    for(let i=0;i<args.length-1;i++)if(args[i]==='--out'&&!args[i+1].startsWith('--'))opts.out=path.resolve(args[++i]);
    invalidateRunOutputs(opts.out);
    for(let i=0;i<args.length;i++) {
      const a=args[i],next=()=>{if(!args[i+1]||args[i+1].startsWith('--'))throw new Error(`${a} needs a value`);return args[++i];};
      if(a==='--out')opts.out=path.resolve(next());
      else if(a==='--kernels')opts.kernels=next().split(',');
      else if(a==='--zones')opts.zones=next().split(',');
      else if(a==='--variants')opts.variants=next().split(',');
      else if(a==='--timeout')opts.timeout=Number(next());
      else if(a==='--no-smoke')opts.noSmoke=true;
      else if(a==='--json-only')opts.jsonOnly=true;
      else throw new Error(`Unknown argument ${a}`);
    }
    if(!(opts.timeout>0))throw new Error('INVALID_RUN_OPTIONS');
    const r=await run(opts);console.log(JSON.stringify(r.kernels,null,2));
    if(opts.kernels.some(k=>r.kernels[k].WRONG||r.kernels[k].counts.UNVERIFIED))process.exitCode=1;
  }catch(error){console.error(error.stack);process.exitCode=1;}
}

if(isMain(import.meta.url))void main();
