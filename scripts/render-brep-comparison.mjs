import { readFileSync, writeFileSync, readdirSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { displayMesh } from '../src/display-export.mjs';
import { publishRenderGeneration } from '../src/render-publication.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const args = process.argv.slice(2), paths = [], options = { out: resolve('out/curved-visual-comparison'), tolerance: 0.02 };
for (let i=0; i<args.length; i++) {
  const arg=args[i];
  if (['--out','--camera','--cad-project-043','--size','--pixel-threshold','--tolerance'].includes(arg)) {
    if (!args[i+1] || args[i+1].startsWith('--')) throw new Error(`Missing value for ${arg}`);
    const value=args[++i]; options[arg.slice(2)]=['--out','--camera','--cad-project-043'].includes(arg)?resolve(value):Number(value);
  } else if (arg.startsWith('-')) throw new Error(`Unknown argument ${arg}`);
  else paths.push(resolve(arg));
}
if (paths.length!==2) throw new Error('Usage: node scripts/render-brep-comparison.mjs before.brep.json after.brep.json [--out directory] [--tolerance mm] [--camera camera.json]');
const implementation = () => {
  const files=['bend.lock.json','package-lock.json','scripts/render-brep-comparison.mjs','scripts/render-comparison.py',
    ...['src','kernel'].flatMap(d=>readdirSync(join(root,d)).sort().map(f=>`${d}/${f}`))];
  return Object.fromEntries(files.map(file=>[file,hash(readFileSync(join(root,file)))]));
};
const before=implementation(), bytes=paths.map(path=>readFileSync(path));
const meshes=[];
for (const input of bytes) meshes.push(await displayMesh(input,{toleranceMm:options.tolerance}));
mkdirSync(dirname(options.out),{recursive:true});
const staging=mkdtempSync(join(dirname(options.out),'.wonky-render-'));
try {
  const meshPaths=['before','after'].map((name,i)=>{
    const path=join(staging,`${name}.display.stl`);writeFileSync(path,meshes[i].stl);return path;
  });
  const command=['run',join(root,'scripts/render-comparison.py'),...meshPaths,'--out',staging];
  for(const name of ['camera','cad-project-043','size','pixel-threshold'])if(options[name]!==undefined)command.push(`--${name}`,String(options[name]));
  const result=await new Promise((resolve,reject)=>{
    const child=spawn('uv',command,{cwd:root,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
    child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
    child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));
  });
  writeFileSync(join(staging,'renderer.log'),result.stdout+result.stderr);
  if(result.code!==0)throw new Error(`Display renderer failed (${result.code}): ${result.stderr||result.stdout}`);
  if(JSON.stringify(implementation())!==JSON.stringify(before))throw new Error('Implementation changed during rendering; no new report published');
  for(let i=0;i<paths.length;i++)if(hash(readFileSync(paths[i]))!==hash(bytes[i]))throw new Error('B-rep input changed during rendering; no new report published');
  let report=JSON.parse(readFileSync(join(staging,'report.json')));
  report.brepInputs=paths.map((path,i)=>({path,sha256:hash(bytes[i]),displayMesh:meshes[i].manifest}));
  report.displayImplementation={stable:true,files:before};
  report.limitations.push('All source faces have display triangles; that does not certify geometric equivalence or fabrication readiness',
    'Displayed curved surfaces are approximate; original B-reps and declared display tolerances are recorded separately');
  report=publishRenderGeneration({staging,out:options.out,report});
  console.log(JSON.stringify({report:join(options.out,'report.json'),assetGeneration:report.assetGeneration,cameraFile:report.cameraFile,brepInputs:report.brepInputs.map(input=>({path:input.path,sha256:input.sha256,
    faces:input.displayMesh.faceCount,triangles:input.displayMesh.triangleCount,toleranceMm:input.displayMesh.toleranceMm})),
    views:report.views.map(({name,changedPixels,maxChannelDifference})=>({name,changedPixels,maxChannelDifference}))},null,2));
} finally { rmSync(staging,{recursive:true,force:true}); }
