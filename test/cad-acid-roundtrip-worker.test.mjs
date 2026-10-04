import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync, execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {roundTripPool} from '../scripts/acid/execution.mjs';
import {RoundTripPool,RoundTripWorker} from '../scripts/acid/roundtrip-worker.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const PYTHON=path.join(ROOT,'out/build123d-performance/reference-venv/bin/python');
const STEP=path.join(ROOT,'fixtures/cad-acid/occt-ext/catalog-errata/artifacts/AC25/V0/model.step');
const readJSON=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const tail=text=>text.trim().split('\n').slice(-4);
const measureArgs=(step,out)=>[step,'--zone','AC25','--variant','V0','--out',out];
// A FIFO nobody writes: OpenCascade's STEP read blocks inside the request,
// a real hang at a known point, with no test hook in the worker.
const fifo=dir=>{const file=path.join(dir,'hang.step');execFileSync('mkfifo',[file]);return file;};

test('warm workers answer exactly as a fresh process per check did',{skip:!fs.existsSync(PYTHON)&&'reference venv missing'},async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acid-roundtrip-'));
  const pool=roundTripPool(1);
  try {
    await pool.start();
    const fresh=spawnSync('uv',['run','--no-project',PYTHON,'-B',path.join(ROOT,'scripts/acid/measure.py'),...measureArgs(STEP,path.join(dir,'fresh.json'))],{cwd:ROOT,encoding:'utf8'});
    assert.equal(fresh.status,0,fresh.stderr);
    const freshFail=spawnSync('uv',['run',path.join(ROOT,'scripts/validate-step.py'),path.join(dir,'missing')],{cwd:ROOT,encoding:'utf8'});
    assert.equal(freshFail.status,1);
    await pool.with(async run=>{
      for(const name of ['warm-1.json','warm-2.json']) {
        const answer=await run('measure',measureArgs(STEP,path.join(dir,name)),{timeoutMs:120000,perfFile:path.join(dir,`perf-${name}`)});
        assert.equal(answer.status,0,answer.stderr);assert.equal(answer.infrastructure,undefined);
        assert.equal(fs.readFileSync(path.join(dir,name),'utf8'),fs.readFileSync(path.join(dir,'fresh.json'),'utf8'),'byte-identical observation');
        const perf=readJSON(path.join(dir,`perf-${name}`));
        assert(perf.wallMs>0&&perf.cpuMs>=0&&perf.cpuScope.includes('this request only'));
      }
      // A failing check keeps its status and the recorded stderr tail; the worker survives it.
      const failed=await run('validate',[path.join(dir,'missing')],{timeoutMs:120000});
      assert.equal(failed.status,1);assert.equal(failed.infrastructure,undefined);
      assert.deepEqual(tail(failed.stderr),tail(freshFail.stderr));
      const again=await run('measure',measureArgs(STEP,path.join(dir,'warm-3.json')),{timeoutMs:120000});
      assert.equal(again.status,0);
    });
  } finally { pool.close();fs.rmSync(dir,{recursive:true,force:true}); }
});

test('a worker killed or hung mid-request is an infrastructure failure and is replaced',{skip:!fs.existsSync(PYTHON)&&'reference venv missing'},async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acid-roundtrip-'));
  const pool=roundTripPool(1);
  try {
    await pool.start();
    const hang=fifo(dir);
    await pool.with(async run=>{
      const worker=pool.slots[0].measure;
      assert.equal((await run('measure',measureArgs(STEP,path.join(dir,'before.json')),{timeoutMs:120000})).status,0);
      const pid=worker.pid;
      const pending=run('measure',measureArgs(hang,path.join(dir,'killed.json')),{timeoutMs:120000});
      await new Promise(resolve=>setTimeout(resolve,500));
      process.kill(pid,'SIGKILL');
      const killed=await pending;
      assert.equal(killed.infrastructure,true);assert.notEqual(killed.status,0);
      assert.match(killed.error,/^ROUNDTRIP_WORKER_EXITED/);
      assert(!fs.existsSync(path.join(dir,'killed.json')));
      await worker.start();
      const hung=await run('measure',measureArgs(hang,path.join(dir,'hung.json')),{timeoutMs:3000});
      assert.equal(hung.infrastructure,true);assert.equal(hung.signal,'SIGKILL');
      assert.match(hung.error,/^ROUNDTRIP_WORKER_TIMEOUT after 3000 ms/);
      await worker.start();
      const recovered=await run('measure',measureArgs(STEP,path.join(dir,'after.json')),{timeoutMs:120000});
      assert.equal(recovered.status,0);assert.notEqual(worker.pid,pid);
      assert.equal(fs.readFileSync(path.join(dir,'after.json'),'utf8'),fs.readFileSync(path.join(dir,'before.json'),'utf8'));
    });
  } finally { pool.close();fs.rmSync(dir,{recursive:true,force:true}); }
});

// Planted: the parent's first round-trip request kills its worker the moment
// it is written. That cell must be an ERROR; the next cell gets a fresh worker.
for(const jobs of ['1','2'])test(`a worker killed mid-run makes only its cell an infrastructure ERROR (jobs=${jobs})`,{skip:!fs.existsSync(PYTHON)&&'reference venv missing'},()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acid-roundtrip-kill-'));
  try {
    const preload=path.join(dir,'kill-worker.mjs');
    fs.writeFileSync(preload,`import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
const spawn=cp.spawn;let planted=false;
cp.spawn=function(command,args,...rest){const child=spawn.call(this,command,args,...rest);
  if(args?.includes('--serve')){const write=child.stdin.write.bind(child.stdin);child.stdin.write=(chunk,...more)=>{const r=write(chunk,...more);
    if(!planted){planted=true;process.kill(-child.pid,'SIGKILL');}return r;};}
  return child;};
syncBuiltinESMExports();`);
    const r=spawnSync(process.execPath,['--import',preload,path.join(ROOT,'scripts/acid/run.mjs'),'--out',dir,'--kernels','wonky-rust','--zones','AC01','--variants','V0,V1','--no-smoke','--json-only'],
      {cwd:ROOT,encoding:'utf8',timeout:300000,env:{...process.env,WONKY_BACKEND:'rust',WONKY_ACID_JOBS:jobs,NODE_OPTIONS:'--max-old-space-size=8192'}});
    const rows=readJSON(path.join(dir,'results.json')).rows.filter(row=>row.kernel==='wonky-rust');
    assert.equal(rows.length,2,r.stderr);
    const failed=rows.filter(row=>row.outcome==='error'),passed=rows.filter(row=>row.outcome==='built');
    assert.equal(failed.length,1,JSON.stringify(rows.map(row=>[row.variant,row.outcome,row.reason])));
    assert.match(failed[0].reason,/^ROUNDTRIP_INFRASTRUCTURE_ERROR: measure: ROUNDTRIP_WORKER_EXITED/);
    if(jobs==='1')assert.equal(failed[0].variant,'V0');
    assert.equal(passed.length,1);assert.equal(passed[0].stepRoundTrip.ok,true);
    const zone=readJSON(path.join(dir,'scoreboard.json')).zones.find(z=>z.kernel==='wonky-rust'&&z.zone==='AC01');
    assert.equal(zone.variants[failed[0].variant].status,'ERROR');
    assert.notEqual(zone.variants[passed[0].variant].status,'ERROR');
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

// Real uv/OCP workers, delayed before launch by longer than the former 180 s
// request budget. No geometry is mocked: both cells still build and round-trip.
test('startup longer than the old cell timeout precedes dispatch and preserves exact results',{skip:!fs.existsSync(PYTHON)&&'reference venv missing'},()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acid-roundtrip-slow-'));
  try {
    const shim=path.join(dir,'delay.mjs'),preload=path.join(dir,'delay-worker.mjs');
    fs.writeFileSync(shim,`import {spawn} from 'node:child_process';
setTimeout(()=>{const child=spawn(process.argv[2],process.argv.slice(3),{stdio:'inherit'});
child.on('error',error=>{console.error(error);process.exitCode=1;});
child.on('exit',(code,signal)=>{if(signal)process.kill(process.pid,signal);else process.exitCode=code;});},181000);`);
    fs.writeFileSync(preload,`import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
const spawn=cp.spawn;
cp.spawn=function(command,args,options){return args?.includes('--serve')
  ?spawn(process.execPath,[${JSON.stringify(shim)},command,...args],options):spawn(command,args,options);};
syncBuiltinESMExports();`);
    const run=(out,imports=[])=>spawnSync(process.execPath,[...imports,path.join(ROOT,'scripts/acid/run.mjs'),'--out',out,'--kernels','wonky-rust','--zones','AC01,AC02','--variants','V0','--no-smoke','--json-only'],
      {cwd:ROOT,encoding:'utf8',timeout:600000,maxBuffer:1<<22,env:{...process.env,WONKY_BACKEND:'rust',WONKY_ACID_JOBS:'2',NODE_OPTIONS:'--max-old-space-size=8192'}});
    const baseline=path.join(dir,'baseline'),slow=path.join(dir,'slow');
    const normal=run(baseline);assert.equal(normal.status,0,normal.stderr);
    const delayed=run(slow,['--import',preload]);assert.equal(delayed.status,0,delayed.stderr);
    const perf=readJSON(path.join(slow,'perf.json'));
    assert.equal(perf.workerStartup.length,4);
    assert(perf.workerStartup.every(worker=>worker.wallMs>180000));
    console.log(`planted slow start: ${JSON.stringify(perf.workerStartup)}`);
    const rows=readJSON(path.join(slow,'results.json')).rows.filter(row=>row.kernel==='wonky-rust');
    assert.equal(rows.length,2);
    for(const row of rows) {
      assert.equal(row.outcome,'built',row.reason??row.error?.message);
      assert.equal(row.stepRoundTrip.ok,true);
      assert.equal(readJSON(path.join(slow,'scoreboard.json')).zones.find(z=>z.kernel==='wonky-rust'&&z.zone===row.zone).variants.V0.status,'CORRECT');
      for(const artifact of ['measure.json','model.step','model.brep.json']) {
        const relative=path.join('wonky-rust',row.group,row.variant,row.zone,artifact);
        assert.deepEqual(fs.readFileSync(path.join(slow,relative)),fs.readFileSync(path.join(baseline,relative)),`${row.zone}/${artifact} byte-identical`);
      }
    }
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

// Startup failures invalidate the entire run before dispatch; they must never
// manufacture per-cell ERROR observations or leave publishable stale outputs.
test('a worker that exits before ready aborts the run by name without dispatch',{skip:!fs.existsSync(PYTHON)&&'reference venv missing'},()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acid-roundtrip-start-fail-'));
  try {
    const preload=path.join(dir,'fail-worker.mjs');
    fs.writeFileSync(preload,`import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
const spawn=cp.spawn;cp.spawn=function(command,args,options){return args?.includes('--serve')
  ?spawn(process.execPath,['-e','console.error("planted startup exit");process.exit(23)'],options):spawn(command,args,options);};
syncBuiltinESMExports();`);
    fs.writeFileSync(path.join(dir,'results.json'),'stale');
    const r=spawnSync(process.execPath,['--import',preload,path.join(ROOT,'scripts/acid/run.mjs'),'--out',dir,'--zones','AC01','--variants','V0','--no-smoke','--json-only'],
      {cwd:ROOT,encoding:'utf8',timeout:120000,env:{...process.env,WONKY_BACKEND:'rust',WONKY_ACID_JOBS:'2',NODE_OPTIONS:'--max-old-space-size=8192'}});
    assert.equal(r.status,1,r.stderr);
    assert.match(r.stderr,/ROUNDTRIP_WORKERS_START_FAILED: ROUNDTRIP_WORKER_EXITED: status=23/);
    assert.match(r.stderr,/planted startup exit/);
    assert(!fs.existsSync(path.join(dir,'results.json')));
    assert(!fs.existsSync(path.join(dir,'scoreboard.json')));
    assert(!fs.existsSync(path.join(dir,'wonky-rust')),'no cell dispatched');
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

// Protocol-only planted never-ready process exercises the independent startup
// bound, cleanup and admission rule without presenting it as geometry evidence.
test('startup has its own bound and cannot admit a cell on timeout',async()=>{
  const pool=new RoundTripPool(1,{hung:[process.execPath,['-e','setInterval(()=>{},1000)']]},{startTimeoutMs:100});
  let dispatched=false;
  try {
    await assert.rejects(pool.with(()=>{dispatched=true;}),/ROUNDTRIP_POOL_NOT_READY/);
    await assert.rejects(pool.start(),/ROUNDTRIP_WORKERS_START_FAILED: ROUNDTRIP_WORKER_START_TIMEOUT after 100 ms/);
    assert.equal(dispatched,false);
    assert.equal(pool.slots[0].hung.child,null);
  } finally {pool.close();}
});

// Protocol-only check: readiness is not a promise that a process stays alive
// throughout its cell's build. Its actual exit must survive until the request.
test('an exit after readiness retains its infrastructure answer until replacement',async()=>{
  const worker=new RoundTripWorker(process.execPath,['-e',`console.log(JSON.stringify({ready:true,pid:process.pid}));process.stdin.resume();process.stdin.on('end',()=>process.exit(0));`]);
  try {
    await worker.start();
    const closed=new Promise(resolve=>worker.child.once('close',resolve));
    process.kill(worker.pid,'SIGKILL');await closed;
    const answer=await worker.run([],{timeoutMs:1000});
    assert.equal(answer.infrastructure,true);assert.notEqual(answer.status,0);
    assert.match(answer.error,/^ROUNDTRIP_WORKER_EXITED/);
    await worker.start();assert.equal(worker.failureAnswer,null);
  } finally {worker.close();}
});

// Kill a real measure worker after the pool admits its cell, and delay that
// cell's input until the exit has been observed. No request has yet been sent.
test('a worker that exits between readiness and first request makes its owning cell ERROR',{skip:!fs.existsSync(PYTHON)&&'reference venv missing'},()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acid-roundtrip-admitted-crash-'));
  try {
    const preload=path.join(dir,'kill-admitted-worker.mjs');
    fs.writeFileSync(preload,`import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
const spawn=cp.spawn,fork=cp.fork,measure=[];let planted=false;
cp.spawn=function(command,args,...rest){const child=spawn(command,args,...rest);
  if(args?.includes('--serve')&&args.some(arg=>arg.endsWith('/measure.py')))measure.push(child);return child;};
cp.fork=function(...args){const child=fork(...args);
  if(!planted){planted=true;const worker=measure.at(-1);if(!worker)throw new Error('planted worker missing');
    const closed=new Promise(resolve=>worker.once('close',resolve));process.kill(-worker.pid,'SIGKILL');
    const send=child.send.bind(child);child.send=(...message)=>{void closed.then(()=>send(...message));return true;};}
  return child;};syncBuiltinESMExports();`);
    const r=spawnSync(process.execPath,['--import',preload,path.join(ROOT,'scripts/acid/run.mjs'),'--out',dir,'--zones','AC01','--variants','V0,V1','--no-smoke','--json-only'],
      {cwd:ROOT,encoding:'utf8',timeout:300000,maxBuffer:1<<22,env:{...process.env,WONKY_BACKEND:'rust',WONKY_ACID_JOBS:'2',NODE_OPTIONS:'--max-old-space-size=8192'}});
    assert.equal(r.error,undefined,r.stderr);
    const rows=readJSON(path.join(dir,'results.json')).rows.filter(row=>row.kernel==='wonky-rust');
    assert.equal(rows.length,2,r.stderr);
    const failed=rows.filter(row=>row.outcome==='error'),passed=rows.filter(row=>row.outcome==='built');
    assert.equal(failed.length,1,JSON.stringify(rows));assert.equal(failed[0].variant,'V0');
    assert.match(failed[0].reason,/^ROUNDTRIP_INFRASTRUCTURE_ERROR: measure: ROUNDTRIP_WORKER_EXITED/);
    assert.equal(passed.length,1);assert.equal(passed[0].stepRoundTrip.ok,true);
    const zone=readJSON(path.join(dir,'scoreboard.json')).zones.find(z=>z.kernel==='wonky-rust'&&z.zone==='AC01');
    assert.equal(zone.variants.V0.status,'ERROR');assert.equal(zone.variants.V1.status,'CORRECT');
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
