#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync,mkdirSync,copyFileSync,renameSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {renderKey,renderBinaryHash,rendererMatches,rendererPaths} from '../../src/native/render-build-key.mjs';
import {artifactInsideSources} from './build-key.mjs';
if(process.argv.length>2)throw new Error('render/build-arguments-unavailable');
const t0=performance.now();
const root=fileURLToPath(new URL('../../',import.meta.url));
const cwd=join(root,'render/wonky-render');
const key=renderKey(root);
const {dir,binary,manifest,pointer}=rendererPaths(root,key);
mkdirSync(dir,{recursive:true});
const publishPointer=()=>{const staging=`${pointer}.${process.pid}.tmp`;writeFileSync(staging,JSON.stringify({sourceHash:key.sourceHash})+'\n');renameSync(staging,pointer);};
const report=extra=>console.log(JSON.stringify({...extra,sourceHash:key.sourceHash,buildMs:Math.round(performance.now()-t0)}));
if(existsSync(manifest)&&existsSync(binary)) {
  let valid=false;
  try {valid=rendererMatches(binary,JSON.parse(readFileSync(manifest)),key);} catch { /* Rebuild malformed or corrupted cache entries. */ }
  if(valid){publishPointer();report({cached:true,cargoMs:0});process.exit(0);}
}
// Cargo clean must not delete another workspace's release artifacts. In
// particular the renderer's profile differs from the kernel/example profile.
const target=process.env.CARGO_TARGET_DIR?resolve(root,'rust',process.env.CARGO_TARGET_DIR):join(cwd,'target');
const renderEnv={...process.env,CARGO_TARGET_DIR:join(target,'renderer')};
function cargo(args,env=renderEnv) {
  const r=spawnSync('cargo',args,{cwd,env,encoding:'utf8',maxBuffer:64<<20});
  if(r.stderr)process.stderr.write(r.stderr);
  if(r.error)throw r.error;
  if(r.status!==0)throw new Error(`cargo ${args.join(' ')} exited ${r.status}: ${r.stdout}`);
  return r.stdout;
}
// Clean local packages on a content-key miss: Cargo's mtime freshness alone
// cannot prove that an older-mtime source edit was compiled into this binary.
const metadata=JSON.parse(cargo(['metadata','--locked','--format-version','1']));
const packages=metadata.packages.filter(p=>p.source===null).map(p=>p.name);
cargo(['clean','--release',...packages.flatMap(p=>['-p',p])]);
const t1=performance.now();
const output=cargo(['build','--release','--locked','--message-format=json'],{...renderEnv,WONKY_RENDER_SOURCE_HASH:key.sourceHash});
const cargoMs=Math.round(performance.now()-t1);
const paths=output.trim().split('\n').map(line=>JSON.parse(line)).filter(m=>m.reason==='compiler-artifact'&&m.target.name==='wonky-render'&&m.executable).map(m=>m.executable);
if(paths.length!==1)throw new Error('render/build-artifact-missing');
const artifact=paths[0];
if(artifactInsideSources(artifact,cwd))throw new Error('render/target-inside-sources');
const identity=spawnSync(artifact,['--build-identity'],{encoding:'utf8'});
if(identity.error)throw identity.error;
if(identity.status!==0||identity.stdout.trim()!==key.sourceHash)throw new Error('render/build-identity-mismatch');
if(renderKey(root,{tools:key.toolchain}).sourceHash!==key.sourceHash)throw new Error('render/sources-changed-during-build');
mkdirSync(dir,{recursive:true});
if(artifact!==binary){const staging=`${binary}.${process.pid}.tmp`;copyFileSync(artifact,staging);renameSync(staging,binary);}
const record={...key,binaryHash:renderBinaryHash(binary),binaryBytes:readFileSync(binary).length,cargoMs};
if(!rendererMatches(binary,record,key))throw new Error('render/build-identity-mismatch');
const staging=`${manifest}.${process.pid}.tmp`;
writeFileSync(staging,JSON.stringify(record)+'\n');renameSync(staging,manifest);
publishPointer();
report({cached:false,cargoMs});
