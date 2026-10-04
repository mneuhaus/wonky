import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,renameSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {viewArguments} from '../src/native/view.mjs';

function command(args,env={}) {
  const r=spawnSync(process.execPath,['bin/wonky.mjs','view',...args],{encoding:'utf8',timeout:120000,env:{...process.env,...env}});
  if(r.stderr)process.stderr.write(r.stderr);assert.ifError(r.error);assert.equal(r.status,0,r.stdout);
  return r.stdout.trim().split('\n').map(s=>JSON.parse(s));
}
test('native view options refuse invalid input and preserve FS build parameters',()=>{
  const o=viewArguments(['examples/tea-box.fs','--param','width=90 * millimeter','--headless','--out','tmp/view.png','--view','front','--reload-count','2']);
  assert.equal(o.parameters.width,'90 * millimeter');assert.equal(o.reloadCount,2);assert.equal(o.view,'front');
  for(const args of [[],['a.py'],['a.fs','--banana'],['a.fs','b.fs'],['a.fs','--view','banana'],['a.fs','--view','front,top'],['a.fs','--headless'],['a.fs','--reload-count','-1'],['a.fs','--max-steps','NaN']])assert.throws(()=>viewArguments(args));
});
test('native headless viewer draws tea box and frozen servo with independently fitted silhouette bounds',t=>{
  const dir=mkdtempSync(join(tmpdir(),'wonky-view-smoke-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  for(const [file,flags] of [['examples/tea-box.fs',[]],['fixtures/render/servo-slide-v5.fs',['--feature','jawSlideMount']]]) {
    // The modeling CLI's certified bounds provide an independent camera-fit oracle.
    const model=spawnSync(process.execPath,['bin/wonky.mjs',file,...flags,'--check','--json'],{encoding:'utf8',timeout:120000,env:{...process.env,WONKY_BACKEND:'rust'}});
    if(model.stderr)process.stderr.write(model.stderr);assert.ifError(model.error);assert.equal(model.status,0);
    const report=JSON.parse(model.stdout),min=[0,1,2].map(k=>Math.min(...report.bodies.map(b=>b.bboxMm.min[k]))),max=[0,1,2].map(k=>Math.max(...report.bodies.map(b=>b.bboxMm.max[k])));
    const frame=command([file,...flags,'--headless','--out',join(dir,'frame.png'),'--view','front','--resolution','256x192']).find(e=>e.type==='frame');
    assert.ok(frame.bytes>100);assert.equal(readFileSync(frame.path).subarray(1,4).toString(),'PNG');assert.equal(frame.edgeSource,'exact-brep');assert.equal(frame.deviationMm,0.02);assert.equal(frame.exact,false);
    assert.equal(frame.edges,report.bodies.reduce((sum,b)=>sum+b.topology.edges,0));
    const width=max[0]-min[0],height=max[2]-min[2],scale=Math.min(256/width,192/height)/1.1;
    const expected=[(256-width*scale)/2,(192-height*scale)/2,(256+width*scale)/2,(192+height*scale)/2];
    assert.ok(frame.silhouette_bounds_px[0].every((p,k)=>Math.abs(p-expected[k])<=1),`${file}: ${frame.silhouette_bounds_px[0]} expected ${expected}`);
    console.log(JSON.stringify({file,headlessMs:frame.elapsedMs,silhouette:frame.silhouette_bounds_px[0]}));
  }
});
test('native view imports STEP/STL through existing renderer and refuses malformed STEP',t=>{
  const dir=mkdtempSync(join(tmpdir(),'wonky-view-import-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const frame=command(['fixtures/step-import/tetra-si.step','--headless','--out',join(dir,'step.png')]).find(e=>e.type==='frame');assert.equal(frame.edges,6);assert.ok(frame.silhouette_bounds_px[0]);
  const stl=join(dir,'tetra.stl');writeFileSync(stl,`solid tetra\n${[[[0,0,0],[0,1,0],[1,0,0]],[[0,0,0],[1,0,0],[0,0,1]],[[0,0,0],[0,0,1],[0,1,0]],[[1,0,0],[0,1,0],[0,0,1]]].map(ps=>`facet normal 0 0 0\nouter loop\n${ps.map(p=>`vertex ${p.join(' ')}`).join('\n')}\nendloop\nendfacet`).join('\n')}\nendsolid tetra\n`);
  const mesh=command([stl,'--headless','--out',join(dir,'stl.png')]).find(e=>e.type==='frame');assert.equal(mesh.edges,0);assert.equal(mesh.edgeSource,'unavailable-in-stl');assert.ok(mesh.silhouette_bounds_px[0]);
  const bad=join(dir,'bad.step');writeFileSync(bad,'invalid STEP');const r=spawnSync(process.execPath,['bin/wonky.mjs','view',bad,'--headless','--out',join(dir,'bad.png')],{encoding:'utf8',timeout:120000});if(r.stderr)process.stderr.write(r.stderr);assert.ifError(r.error);assert.equal(r.status,2);assert.match(r.stderr,/import\//);
});
test('atomic FS save reloads a changed shape, measures save-to-frame latency and closes all workers',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'wonky-view-reload-')),file=join(dir,'tea.fs'),output=join(dir,'frame.png');
  const source=readFileSync('examples/tea-box.fs','utf8');writeFileSync(file,source);
  const child=spawn(process.execPath,['bin/wonky.mjs','view',file,'--headless','--out',output,'--view','front','--resolution','256x192','--reload-count','1'],{stdio:['ignore','pipe','pipe']});
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const frames=[];let savedAt,pending='',error='';
  child.stderr.on('data',b=>{error+=b;process.stderr.write(b);});
  child.stdout.on('data',chunk=>{pending+=chunk;const lines=pending.split('\n');pending=lines.pop();for(const line of lines){const e=JSON.parse(line);if(e.type==='frame'){frames.push(e);if(frames.length===1){savedAt=performance.now();writeFileSync(`${file}.tmp`,source.replace('160 * millimeter','90 * millimeter'));renameSync(`${file}.tmp`,file);}else e.saveToFrameMs=Math.round((performance.now()-savedAt)*10)/10;}}});
  const timeout=setTimeout(()=>child.kill('SIGTERM'),120000);
  const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code));});clearTimeout(timeout);
  assert.equal(exit,0,error);assert.equal(frames.length,2);assert.ok(frames[1].revision>frames[0].revision);assert.notDeepEqual(frames[0].silhouette_bounds_px,frames[1].silhouette_bounds_px);assert.ok(frames[1].saveToFrameMs>0&&frames[1].saveToFrameMs<10000);
  console.log(JSON.stringify({reloadBuildToFrameMs:frames[1].elapsedMs,saveToFrameMs:frames[1].saveToFrameMs}));
});
test('native macOS window opens and presents tea box and frozen servo, then exits cleanly',()=>{
  for(const [file,flags] of [['examples/tea-box.fs',[]],['fixtures/render/servo-slide-v5.fs',['--feature','jawSlideMount']]]) {
    const frames=command([file,...flags,'--resolution','320x240'],{WONKY_VIEW_SMOKE_FRAMES:'1'}).filter(e=>e.type==='frame');assert.equal(frames.length,1);assert.ok(frames[0].revision>0);assert.equal(frames[0].visible,true);assert.equal(frames[0].width/frames[0].scaleFactor,320);assert.equal(frames[0].height/frames[0].scaleFactor,240);
  }
});
test('native window labels a failed save, keeps the last good scene and recovers on the next save',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'wonky-view-recovery-')),file=join(dir,'tea.fs');
  const source=readFileSync('examples/tea-box.fs','utf8');writeFileSync(file,source);
  const child=spawn(process.execPath,['bin/wonky.mjs','view',file],{stdio:['ignore','pipe','pipe']});
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  let pending='',error='',firstRevision,failedRevision,retained=false,recovered=false;
  child.stderr.on('data',b=>{error+=b;process.stderr.write(b);});
  child.stdout.on('data',chunk=>{pending+=chunk;const lines=pending.split('\n');pending=lines.pop();for(const line of lines){const e=JSON.parse(line);
    if(e.type==='frame'&&!firstRevision){firstRevision=e.revision;writeFileSync(file,'FeatureScript 3000;\nthis is invalid syntax');}
    else if(e.type==='status'&&e.status==='failed'){failedRevision=e.revision;}
    else if(e.type==='frame'&&failedRevision&&e.statusRevision>=failedRevision&&!retained){assert.equal(e.revision,firstRevision);assert.equal(e.statusRevision,failedRevision);retained=true;writeFileSync(`${file}.tmp`,source.replace('160 * millimeter','90 * millimeter'));renameSync(`${file}.tmp`,file);}
    else if(e.type==='frame'&&retained&&e.revision>failedRevision){recovered=true;child.kill('SIGTERM');}
  }});
  const timeout=setTimeout(()=>child.kill('SIGTERM'),120000);
  const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code));});clearTimeout(timeout);
  assert.equal(exit,130,error);assert.ok(retained,'failed save retains actual last-good scene');assert.ok(recovered,'subsequent save presents rebuilt scene');assert.match(error,/view\/build-failed|syntax|Parse|Expected|parse/i);
});
test('publication during an in-flight truncate/write save waits for stable source bytes',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'wonky-view-truncate-')),file=join(dir,'tea.fs'),output=join(dir,'frame.png');
  const source=readFileSync('examples/tea-box.fs','utf8'),changed=source.replace('160 * millimeter','90 * millimeter');writeFileSync(file,source);
  const child=spawn(process.execPath,['bin/wonky.mjs','view',file,'--headless','--out',output,'--view','front','--resolution','256x192','--reload-count','1'],{stdio:['ignore','pipe','pipe']});
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  let pending='',error='',frames=[],interrupted=false,failures=0,restore;
  child.stderr.on('data',b=>{error+=b;process.stderr.write(b);});
  child.stdout.on('data',chunk=>{pending+=chunk;const lines=pending.split('\n');pending=lines.pop();for(const line of lines){const e=JSON.parse(line);
    if(e.type==='frame'){frames.push(e);if(frames.length===1)writeFileSync(file,changed);}
    if(e.type==='status'&&e.status==='failed')failures++;
    if(e.type==='status'&&e.status==='building'&&e.revision===2&&!interrupted){interrupted=true;writeFileSync(file,'');restore=setTimeout(()=>writeFileSync(file,changed),200);}
  }});
  const timeout=setTimeout(()=>child.kill('SIGTERM'),120000);
  const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code));});clearTimeout(timeout);clearTimeout(restore);
  assert.equal(exit,0,error);assert.ok(interrupted);assert.equal(failures,0,'transient empty save must not become a failed revision');assert.equal(frames.length,2);assert.notDeepEqual(frames[0].silhouette_bounds_px,frames[1].silhouette_bounds_px);
});
test('a superseded build publishes only the latest saved geometry and drains its build processes',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'wonky-view-superseded-')),file=join(dir,'tea.fs'),output=join(dir,'frame.png');
  const source=readFileSync('examples/tea-box.fs','utf8');writeFileSync(file,source);
  const child=spawn(process.execPath,['bin/wonky.mjs','view',file,'--headless','--out',output,'--view','front','--resolution','256x192','--reload-count','1'],{stdio:['ignore','pipe','pipe']});
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  let pending='',error='',frames=[],superseded=false;
  child.stderr.on('data',b=>{error+=b;process.stderr.write(b);});
  child.stdout.on('data',chunk=>{pending+=chunk;const lines=pending.split('\n');pending=lines.pop();for(const line of lines){const e=JSON.parse(line);
    if(e.type==='frame'){frames.push(e);if(frames.length===1)writeFileSync(file,source.replace('160 * millimeter','120 * millimeter'));}
    if(e.type==='status'&&e.status==='building'&&e.revision===2&&!superseded){superseded=true;writeFileSync(file,source.replace('160 * millimeter','90 * millimeter'));}
  }});
  const timeout=setTimeout(()=>child.kill('SIGTERM'),120000);
  const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code));});clearTimeout(timeout);
  assert.equal(exit,0,error);assert.ok(superseded);assert.equal(frames.length,2);assert.ok(frames[1].revision>=3);assert.ok(frames[1].silhouette_bounds_px[0][3]-frames[1].silhouette_bounds_px[0][1]>100,'latest 90 mm width, not intermediate 120 mm width');
});
