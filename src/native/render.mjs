import {spawnSync} from 'node:child_process';
import {mkdir, rename, rm, stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {existsSync,readFileSync} from 'node:fs';
import {renderKey,rendererMatches,rendererPaths} from './render-build-key.mjs';
import {NamedRefusal} from '../errors.mjs';
import {isRustBody, rustMesh, rustModelKernel, measureRustBody, certifiedBoundsRustBody, describeRustBody} from './rust-host.mjs';

export function renderOptions({views='front,right,top,iso',atlas=2,resolution='512x512',camera='orthographic'}={}) {
  views=typeof views==='string'?views.split(','):views;
  const size=typeof resolution==='string' && /^\d+x\d+$/.test(resolution)?resolution.split('x').map(Number):resolution;
  if(!Array.isArray(views)||!views.length||views.length>16||views.some(v=>!['front','right','top','iso'].includes(v)))throw new NamedRefusal('render','render/unknown-view','Unsupported requested view');
  if(!Number.isInteger(Number(atlas))||Number(atlas)<1||Number(atlas)>16||!Array.isArray(size)||size.length!==2||size.some(v=>!Number.isInteger(v)||v<16||v>4096)||size[0]*Number(atlas)>8192||size[1]*Math.ceil(views.length/Number(atlas))>8192)throw new NamedRefusal('render','render/invalid-layout','Invalid image layout');
  if(!['orthographic','perspective'].includes(camera))throw new NamedRefusal('render','render/unknown-camera','Unsupported projection');
  return {views,atlas:Number(atlas),resolution:size,perspective:camera==='perspective'};
}
// Match Wonky's query.rs seam rule: two opposite coedge uses on the same
// face describe a chart seam, not a material B-rep feature edge. No angles.
export function featureEdgeIndices(body) {
  const uses=body.edges.map(()=>[]);
  body.faces.forEach((face,f)=>face.loops.forEach(l=>body.loops[l].coedges.forEach(id=>{
    const c=body.coedges[id];uses[c.edge].push([f,c.forward]);
  })));
  return uses.flatMap((u,i)=>u.length===2&&u[0][0]===u[1][0]&&u[0][1]!==u[1][1]?[]:[i]);
}
export function modelRenderInput(model,deviationMm=0.02) {
  if(!model.bodies.length||!model.bodies.every(isRustBody))throw new NamedRefusal('render','render/requires-rust-brep','Native rendering requires a Rust B-rep');
  const start=performance.now(),kernel=rustModelKernel(model);
  const mesh=rustMesh(kernel,model.bodies,deviationMm);
  const input={vertices:[],triangles:[],edges:[],bounds:[[Infinity,Infinity,Infinity],[-Infinity,-Infinity,-Infinity]]};
  for(let b=0;b<mesh.bodies.length;b++) {
    const body=mesh.bodies[b],m=measureRustBody(kernel,model.bodies[b]);
    const wc0=describeRustBody(kernel,model.bodies[b]).body;
    if(body.edges.length!==wc0.edges.length)throw new NamedRefusal('render','render/brep-edge-sampling-unavailable','All B-rep edges must have sampled display polylines');
    const featureEdges=featureEdgeIndices(wc0);
    const offset=input.vertices.length;
    for(let i=0;i<body.vertices.length;i+=3)input.vertices.push(body.vertices.slice(i,i+3));
    for(let i=0;i<body.triangles.length;i+=3)input.triangles.push(body.triangles.slice(i,i+3).map(k=>k+offset));
    if(featureEdges.length!==m.topology.edges)throw new NamedRefusal('render','render/edge-topology-mismatch','Feature-edge topology disagrees with kernel measurement');
    for(const index of featureEdges){const e=body.edges[index];const ids=e.vertices.map(i=>i+offset);if(e.closed&&ids.length)ids.push(ids[0]);if(ids.length<2)throw new NamedRefusal('render','render/brep-edge-sampling-unavailable','All B-rep edges must have sampled display polylines');input.edges.push(ids);}
    const bounds=certifiedBoundsRustBody(kernel,model.bodies[b]);
    const min=bounds.min??bounds[0],max=bounds.max??bounds[1];
    for(let k=0;k<3;k++){input.bounds[0][k]=Math.min(input.bounds[0][k],min[k]);input.bounds[1][k]=Math.max(input.bounds[1][k],max[k]);}
  }
  return {input,tessellateMs:performance.now()-start,exact:false,deviationMm,boundsExactness:'certified-outward-rounded-brep-bounds',edgeSource:'exact-brep',edgeGeometry:'sampled-polylines'};
}
export function nativeRendererBinary() {
  const root=fileURLToPath(new URL('../../',import.meta.url));
  const key=renderKey(root);
  const {binary,manifest:manifestPath,pointer}=rendererPaths(root,key);
  if(!existsSync(binary)||!existsSync(manifestPath))throw new NamedRefusal('render',existsSync(pointer)?'render/build-stale':'render/build-missing','Build the native renderer','Run node scripts/rust/build-node.mjs through studio/run.mjs');
  let manifest;
  try {manifest=JSON.parse(readFileSync(manifestPath,'utf8'));} catch {throw new NamedRefusal('render','render/build-stale','Renderer manifest is corrupt; rebuild the native renderer');}
  if(!rendererMatches(binary,manifest,key))throw new NamedRefusal('render','render/build-stale','Rebuild the native renderer','Run node scripts/rust/build-node.mjs through studio/run.mjs');
  return binary;
}
export async function renderNative(input,path,options={}) {
  const temporary=`${path}.${process.pid}.tmp`;
  try {
    const binary=nativeRendererBinary();
    await mkdir(dirname(path),{recursive:true});
    const run=spawnSync(binary,[temporary],{input:JSON.stringify({...input,...renderOptions(options)}),encoding:'utf8',maxBuffer:16<<20});
    if(run.stderr)process.stderr.write(run.stderr);
    if(run.error)throw run.error;
    if(run.status!==0)throw new NamedRefusal('render',(run.stderr.trim()||`render/process-exit:${run.status}`).split(':')[0],run.stderr.trim());
    const metadata=JSON.parse(run.stdout);
    await rename(temporary,path);
    return {format:'png',path,bytes:(await stat(path)).size,exact:false,...metadata};
  } catch(e) {await rm(path,{force:true});throw e;}
  finally {await rm(temporary,{force:true});}
}
export async function renderModel(model,path,options={}) {
  try {
    const {input,tessellateMs,...approximation}=modelRenderInput(model,options.deviationMm);
    const result=await renderNative(input,path,options);
    const {timings_ms,...output}=result;
    return {...output,...approximation,timingsMs:{...timings_ms,tessellate:tessellateMs}};
  } catch(e) { await rm(path,{force:true});throw e; }
}
export async function renderFile(file,path,options={}) {
  return renderNative({vertices:[],triangles:[],edges:[],bounds:[[0,0,0],[0,0,0]],file:resolve(file)},path,options);
}
