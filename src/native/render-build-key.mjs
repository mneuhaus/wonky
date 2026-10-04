import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {outerCargoConfigs} from '../../scripts/rust/build-key.mjs';
import {computeKey,sha256} from './rust-build-key.mjs';
export function renderKey(root,{env=process.env,tools}={}) {
  const cwd=join(root,'render/wonky-render');
  if(!tools) {
    const probe=(cmd,args)=>{
      const run=spawnSync(cmd,args,{cwd,encoding:'utf8'});
      if(run.error)throw run.error;
      if(run.status!==0)throw new Error(`${cmd} failed: ${run.stderr}`);
      return run.stdout.trim();
    };
    tools={rustc:probe('rustc',['-vV']),cargo:probe('cargo',['-V'])};
  }
  const base=computeKey(root,{env,tools});
  const files=['scripts/rust/build-render.mjs','src/native/render-build-key.mjs'];
  const walk=dir=>{for(const e of readdirSync(join(root,dir),{withFileTypes:true})){if(e.name==='target')continue;const p=`${dir}/${e.name}`;if(e.isDirectory())walk(p);else if(e.isFile())files.push(p);}};
  walk('render/wonky-render');
  const key={...base,schema:'wonky-render-build/2',cargoConfigs:outerCargoConfigs(cwd,env,cwd),files:[...base.files,...files.map(path=>({path,sha256:sha256(readFileSync(join(root,path)))}))].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)};
  delete key.sourceHash;
  return {...key,sourceHash:sha256(JSON.stringify(key))};
}
export const renderSourceHash=(root,options)=>renderKey(root,options).sourceHash;
export const renderBinaryHash=path=>sha256(readFileSync(path));
export function rendererMatches(binary,manifest,key) {
  const bytes=readFileSync(binary);
  return manifest?.schema===key.schema && manifest.sourceHash===key.sourceHash && manifest.binaryHash===sha256(bytes)
    && manifest.binaryBytes===bytes.length && bytes.includes(key.sourceHash,0,'latin1');
}

export function rendererPaths(root,key) {
  const cache=join(process.env.WONKY_RUST_CACHE ?? join(root,'tmp/rust/cache'),'render');
  const dir=join(cache,key.sourceHash);
  return {dir,binary:join(dir,'wonky-render'),manifest:join(dir,'manifest.json'),pointer:join(cache,'render.json')};
}
