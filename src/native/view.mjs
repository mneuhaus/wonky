import {spawn,fork} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {dirname,extname,resolve,join} from 'node:path';
import {existsSync} from 'node:fs';
import {readWatchSet,watchSources} from '../viewer/live/watch.mjs';
import {watchSetOf} from '../viewer/live/session.mjs';
import {nativeRendererBinary,renderNative,renderFile,renderOptions} from './render.mjs';

export function viewArguments(args) {
  const o={parameters:{},view:'iso',resolution:'960x720',reloadCount:0};
  const value=i=>{if(!args[i+1]||args[i+1].startsWith('--'))throw new Error(`${args[i]} requires a value`);return args[i+1];};
  for(let i=0;i<args.length;i++) {
    const a=args[i];
    if(a==='--help'||a==='-h')o.help=true;
    else if(a==='--headless')o.headless=true;
    else if(['--feature','--modules','--view','--resolution','--out','--reload-count','--max-steps'].includes(a)) {const v=value(i++);o[({'--modules':'moduleManifest','--reload-count':'reloadCount','--max-steps':'maxSteps'})[a]??a.slice(2)]=v;}
    else if(a==='--param') {const v=value(i++),k=v.indexOf('=');if(k<1)throw new Error('--param expects name=expression');o.parameters[v.slice(0,k)]=v.slice(k+1);}
    else if(a.startsWith('-'))throw new Error(`Unknown view option: ${a}`);
    else if(o.file)throw new Error('view takes one input');else o.file=resolve(a);
  }
  if(o.help)return o;
  if(!o.file||!['.fs','.stl','.step','.stp'].includes(extname(o.file).toLowerCase()))throw new Error('view requires a .fs, .stl or .step input');
  if(!['front','right','top','iso'].includes(o.view))throw new Error('--view expects front, right, top or iso');
  renderOptions({views:o.view,atlas:1,resolution:o.resolution});
  o.reloadCount=Number(o.reloadCount);if(!Number.isSafeInteger(o.reloadCount)||o.reloadCount<0)throw new Error('--reload-count expects a nonnegative integer');
  if(o.maxSteps!==undefined){o.maxSteps=Number(o.maxSteps);if(!Number.isSafeInteger(o.maxSteps)||o.maxSteps<1)throw new Error('--max-steps expects a positive integer');}
  if(o.headless&&!o.out)throw new Error('--headless requires --out <frame.png>');
  if(!o.headless&&o.reloadCount)throw new Error('--reload-count requires --headless');
  if(o.moduleManifest)o.moduleManifest=resolve(o.moduleManifest);
  return o;
}
const HELP=`Usage: wonky view <part.fs|file.stl|file.step> [options]
Native wgpu/winit window. Drag: orbit; right/middle or Shift-drag: pan;
scroll: zoom; 1 front, 2 right, 3 top, 4 iso; F fit, Esc close.
FeatureScript sources, sibling modules.json and frozen modules reload on save.
Failed revisions retain the last good display, labelled failed (never current).
B-rep feature edges are sampled for display at 0.02 mm tolerance; STL has no
B-rep edges. Geometry and exports are unchanged. STEP uses the R0 import subset.
--feature <name> --param name=expression --modules <manifest> --max-steps <n>
--view front|right|top|iso --resolution WxH (window logical size; headless pixels)
--headless --out <frame.png> [--reload-count <n>] renders through the same GPU
scene without a window, then exits after n successful reloads (0 by default).
Build renderer first: node scripts/rust/build-node.mjs (via studio/run.mjs).
The browser live server remains available through wonky-view.
`;

export async function viewCli(args) {
  let options;
  try {options=viewArguments(args);}catch(e){console.error(e.message);return 2;}
  if(options.help){console.log(HELP);return 0;}
  // This command has one supported construction backend, irrespective of shell defaults.
  process.env.WONKY_BACKEND='rust';
  let child,worker,watcher,closed=false,revision=0,active=0,successes=0;
  let resolveDone;const done=new Promise(r=>{resolveDone=r;});
  const jobs=new Set();
  const track=p=>{jobs.add(p);p.finally(()=>jobs.delete(p)).catch(()=>{});return p;};
  const stopBuild=w=>{
    if(!w.pid||w.exitCode!==null||w.signalCode!==null)return Promise.resolve();
    const exited=new Promise(r=>w.once('exit',r));w.kill('SIGKILL');return exited;
  };
  const finish=code=>{if(closed)return;closed=true;watcher?.close();resolveDone(code);};
  const event=e=>process.stdout.write(`${JSON.stringify(e)}\n`);
  const status=(r,status,elapsed_ms=0)=>{event({type:'status',revision:r,status,elapsedMs:elapsed_ms});if(child&&!child.stdin.destroyed)child.stdin.write(JSON.stringify({revision:r,status,elapsed_ms})+'\n');};
  const failure=(r,e)=>{if(r!==revision||closed)return;console.error(`${e.code??e.reason??'view/build-failed'}: ${e.message}`);status(r,'failed');if(options.headless)finish(2);};
  const interrupt=()=>finish(130);
  process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);
  try {
    if(!options.headless) {
      child=spawn(nativeRendererBinary(),['--view',options.resolution],{stdio:['pipe','pipe','inherit']});
      child.stdout.pipe(process.stdout,{end:false});child.stdin.on('error',e=>{if(!closed)failure(revision,e);});
      child.on('error',e=>{console.error(e.message);finish(2);});child.on('exit',code=>finish(code??2));
    }
    const fsInput=extname(options.file).toLowerCase()==='.fs';
    const paths=async()=>fsInput?(await watchSetOf(options.file,'featurescript',options)).map(e=>e.path):[options.file];
    const startWorker=()=>{
      const w=fork(new URL('./view-worker.mjs',import.meta.url),{env:{...process.env,WONKY_BACKEND:'rust',WONKY_VIEW_BUILD_WORKER:'0'},detached:true,serialization:'advanced',stdio:['ignore','pipe','inherit','ipc']});
      w.stdout.on('data',data=>process.stderr.write(data));
      w.on('error',e=>{if(worker===w){worker=null;active=0;track(stopBuild(w));failure(revision,e);}});w.on('exit',(code,signal)=>{if((code!==0||signal)&&!closed&&worker===w){worker=null;active=0;failure(revision,new Error(`view/worker-exit:${code??signal}`));}});return w;
    };
    const publish=async(r,input,display,started,hash,attempt=0)=>{
      if(closed||r!==revision)return;
      // Modules are read by the existing frozen loader. Reject a result if any
      // watched byte changed while it ran, including a manifest's new paths.
      const current=await readWatchSet(await paths());if(closed||r!==revision)return;
      if(current.hash!==hash){
        // Let the existing watcher settle atomic/truncate saves; never evaluate
        // a transient empty file merely because an older build finished now.
        watcher.update(await paths());
        if(attempt<10){await delay(100);await publish(r,input,display,started,hash,attempt+1);}
        return;
      }
      const request={...input,...renderOptions({views:options.view,atlas:1,resolution:options.resolution})};
      if(options.headless) {
        const frame=input.file?await renderFile(input.file,options.out,{views:options.view,atlas:1,resolution:options.resolution}):await renderNative(input,options.out,{views:options.view,atlas:1,resolution:options.resolution});
        if(closed||r!==revision)return;
        event({type:'frame',revision:r,elapsedMs:Math.round((performance.now()-started)*10)/10,...display,...frame});
        if(++successes>options.reloadCount)finish(0);
      }else if(!child.stdin.destroyed)child.stdin.write(JSON.stringify({revision:r,request,status:'ready',elapsed_ms:Math.round((performance.now()-started)*10)/10})+'\n');
    };
    const rebuild=async(snapshot)=>{
      if(closed)return;
      const r=++revision,started=performance.now();status(r,'building');
      watcher?.update(await paths());
      if(closed||r!==revision)return;
      if(!fsInput){await publish(r,{vertices:[],triangles:[],edges:[],bounds:[[0,0,0],[0,0,0]],file:options.file},{edgeSource:extname(options.file).toLowerCase()==='.stl'?'unavailable-in-stl':'exact-brep',...(extname(options.file).toLowerCase()==='.stl'?{geometryKind:'triangle-mesh'}:{deviationMm:0.02,edgeGeometry:'sampled-polylines'})},started,snapshot.hash);return;}
      const source=snapshot.bytes.get(options.file);if(!source){failure(r,new Error('view/source-unavailable'));return;}
      // Cancel a superseded synchronous interpreter without blocking watcher or window.
      if(active){const old=worker;worker=null;active=0;track(stopBuild(old));}
      worker??=startWorker();active=r;const w=worker;
      w.removeAllListeners('message');w.on('message',result=>{if(w!==worker||result.revision!==revision||closed)return;active=0;if(result.error)failure(result.revision,result.error);else track(publish(r,result.input,result.display,started,snapshot.hash).catch(e=>failure(r,e)));});
      const manifest=options.moduleManifest??join(dirname(options.file),'modules.json');
      worker.send({revision:r,source:source.toString('utf8'),options:{sourcePath:options.file,feature:options.feature,parameters:options.parameters,moduleManifest:existsSync(manifest)?manifest:undefined,maxSteps:options.maxSteps}});
    };
    const initialPaths=await paths(),snapshot=await readWatchSet(initialPaths);
    watcher=watchSources(initialPaths,{initialHash:snapshot.hash,initialBytes:snapshot.bytes,onChange:(hash,bytes)=>track(rebuild({hash,bytes}).catch(e=>failure(revision,e))),onError:e=>failure(revision,e)});
    await rebuild(snapshot);
    return await done;
  }catch(e){console.error(`${e.reason??'view/start-failed'}: ${e.message}`);finish(2);return 2;}
  finally {
    closed=true;watcher?.close();if(worker)await stopBuild(worker);
    if(child&&child.exitCode===null&&child.signalCode===null){const exited=new Promise(r=>child.once('exit',r));child.stdin.end();child.kill('SIGTERM');await exited;}
    await Promise.allSettled([...jobs]);process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);
  }
}
