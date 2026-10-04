import {resolve,basename,extname} from 'node:path';
import {renderFile,renderOptions} from './native/render.mjs';
export async function renderFileCli(args) {
  const report={schema:'wonky-cli/v1',status:'ok',backend:{selected:'rust',language:'Rust'},source:{file:null,language:null,version:null},feature:null,params:{},bodies:[],outputs:[],refusals:[],warnings:[],skipped:[]};
  const options={};let file,out;const json=args.includes('--json');const start=performance.now();
  try {
    for(let i=0;i<args.length;i++) {
      const arg=args[i];
      if(arg==='--json')continue;
      if(arg==='--help'||arg==='-h'){console.log('wonky render <file.stl|file.step> [--out prefix] [--views front,right,top,iso] [--atlas 2] [--resolution 512x512] [--camera orthographic|perspective] [--json]');return 0;}
      if(['--out','--views','--atlas','--resolution','--camera'].includes(arg)) {
        if(!args[i+1]||args[i+1].startsWith('--'))throw new Error(`${arg} requires a value`);
        const v=args[++i];if(arg==='--out')out=v;else options[arg.slice(2)]=v;
      }else if(arg.startsWith('-'))throw new Error(`Unknown option '${arg}'`);
      else if(!file)file=arg;else throw new Error('render/one-file-required');
    }
    if(!file)throw new Error('render/file-required');report.source.file=resolve(file);report.source.language=/\.stl$/i.test(file)?'STL':'STEP';
    renderOptions(options);
    const path=resolve(out??`out/${basename(file,extname(file))}`)+'.png';
    const output=await renderFile(file,path,options);output.edgeSource=/\.stl$/i.test(file)?'unavailable-in-stl':'exact-brep';
    output.boundsExactness=/\.stl$/i.test(file)?'mesh-bounds':'imported-planar-vertex-bounds';
    output.timingsMs=output.timings_ms;delete output.timings_ms;report.outputs.push(output);
    if(!json)console.log(path);
  }catch(e){report.status='error';report.refusals.push({code:e.reason??e.message.split(':')[0],operation:'render',message:e.message,location:{file:report.source.file,line:null,column:null},hint:e.hint??null});console.error(`wonky: ${e.message}`);}
  report.timingsMs={build:null,export:performance.now()-start,total:performance.now()-start};if(json)console.log(JSON.stringify(report));
  return report.status==='ok'?0:2;
}
