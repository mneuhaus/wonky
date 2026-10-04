// Warm killable evaluation process; share the browser worker parent-death watchdog.
import {startWatchdog} from '../viewer/live/build-worker.mjs';
import {build} from '../index.mjs';
import {modelRenderInput} from './render.mjs';
startWatchdog();
process.on('disconnect',()=>process.exit(0));
const send=result=>{if(process.connected)process.send(result);};
process.on('message',async ({revision,source,options})=>{
  try {
    const model=await build(source,options);
    const {input,...display}=modelRenderInput(model,0.02);
    send({revision,input,display});
  } catch(error) {send({revision,error:{code:error.reason??error.code??'view/build-failed',message:error.message}});}
});
