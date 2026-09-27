// Offline validation of frozen INPUT geometry, not evaluation of singleStepR10b.
// OpenCascade is only the independent STEP reader/checker in validate-step.py.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadKernel, precisionForBodies } from '../src/kernel.mjs';
import { ModelingContext } from '../src/library.mjs';
import { frozenModules } from '../src/modules.mjs';
import { parse } from '../src/parser.mjs';
import { build } from '../src/index.mjs';
import { toStep } from '../src/exporters.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const source=readFileSync(join(root,'fixtures/r10b/r10b.fs'),'utf8');
const moduleManifest=join(root,'fixtures/r10b/modules.json');
const manifest=JSON.parse(readFileSync(moduleManifest,'utf8'));
const kernel=await loadKernel();
const resolver=frozenModules(moduleManifest,source,()=>new ModelingContext(kernel));
const prefixes=[];
mkdirSync(join(root,'out/imports'),{recursive:true});
for(const spec of parse(source).imports.filter(i=>i.namespace)){
  const context=resolver(spec).build.call([{}]);
  for(const part of manifest.modules.find(m=>m.namespace===spec.namespace).bodies){
    const records=[...context.engine.records.values()].filter(r=>r.name===part.name);
    if(records.length!==1)throw new Error(`Ambiguous source part '${part.name}'`);
    const bodies=[records[0].body];
    const model={schema:'wonky-brep/1',units:'millimeter',backend:{language:'Bend',version:'2.0.25',target:'JavaScript',precision:precisionForBodies(bodies)},bodies};
    const prefix=join(root,'out/imports',`${spec.namespace}-${encodeURIComponent(part.partId)}`);
    writeFileSync(prefix+'.brep.json',JSON.stringify(model,null,2)+'\n');
    writeFileSync(prefix+'.step',toStep(model,part.name));
    prefixes.push(prefix);
  }
}
const retained=await build(source,{feature:'r10bRetainedContext',moduleManifest});
const prefix=join(root,'out/r10b-retained');
writeFileSync(prefix+'.brep.json',JSON.stringify(retained,null,2)+'\n');
writeFileSync(prefix+'.step',toStep(retained,'r10b-retained'));
prefixes.push(prefix);
const result=spawnSync('uv',['run','scripts/validate-step.py',...prefixes],{cwd:root,encoding:'utf8',maxBuffer:10*1024*1024});
if(result.error)throw result.error;
writeFileSync(join(root,'out/input-step-validation.log'),result.stdout+result.stderr);
if(result.status!==0){process.stderr.write(result.stderr);process.exitCode=result.status??1;}
else{
  writeFileSync(join(root,'out/input-step-validation.json'),result.stdout);
  const report=JSON.parse(result.stdout);
  console.log(`${report.length} STEP files validated: 16 frozen source parts and the five-body retained feature. Full r10b evaluation is a separate check.`);
}
