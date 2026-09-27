import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
for(const args of [
  ['examples/bracket.fs','--param','thickness=8*millimeter','--out','out/visual-before'],
  ['examples/bracket.fs','--param','thickness=12*millimeter','--out','out/visual-after'],
  ['examples/bored-spacer.fs','--format','step','--out','out/bored-spacer'],
  ['examples/convex-intersection.fs','--format','step','--out','out/convex-intersection'],
  ['examples/line-sketch.fs','--format','step','--out','out/line-sketch'],
])execFileSync(process.execPath,['bin/wonky.mjs',...args],{cwd:root,stdio:'inherit'});
const server=spawn(process.execPath,['bin/wonky-view.mjs','out/visual-before.brep.json','out/visual-after.brep.json','out/bored-spacer.brep.json','out/convex-intersection.brep.json','out/line-sketch.brep.json',...process.argv.slice(2)],{cwd:root,stdio:'inherit'});
server.on('error',error=>{console.error(error.message);process.exitCode=1;});
server.on('exit',code=>{process.exitCode=code??1;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.kill(signal));
