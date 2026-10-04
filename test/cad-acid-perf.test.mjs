import test from 'node:test';
import assert from 'node:assert/strict';
import {stats,comparable,report,markdown} from '../scripts/acid/perf-report.mjs';
import {nativeTimer,phases,familyFor} from '../scripts/acid/perf.mjs';
const context={host:'synthetic',logicalCpus:8,load1:1,slotCount:3,parallelCells:2,addonWarm:true};
function cell(zone,ms,options={}) {return {zone,variant:'V0',family:'family',outcome:'built',context:{...context},phases:{...phases(),
  frontend:{wallMs:ms/2,cpuMs:ms/2},kernelBuild:{wallMs:ms/4,cpuMs:ms/4},measurement:{wallMs:ms/8,cpuMs:ms/8},stepExport:{wallMs:ms/8,cpuMs:ms/8},total:{wallMs:ms,cpuMs:ms}},
  build123d:{outcome:'built',context:{...context,addonWarm:null},samples:[{warmPipelineMs:ms/2}]},...options};}
const perf=cells=>({schema:'wonky/cad-acid-live-perf/1',zonesSha256:'synthetic-catalog',gitTree:'synthetic-tree',clean:true,finishedAt:'synthetic-completed-run',cells});
test('median and nearest-rank p95 include all finite observations',()=>{assert.deepEqual(stats([4,1,2,3,null,NaN]),{n:4,median:2.5,p95:4});assert.deepEqual(stats([]),{n:0,median:null,p95:null});});
test('planted 3x slowdown flags only with comparable load and both thresholds',()=>{
  const old=perf([cell('AC01',300),cell('AC02',300),cell('AC03',50)]),current=perf([cell('AC01',900),cell('AC02',900,{context:{...context,load1:12}}),cell('AC03',150)]);
  const r=report(current,old);assert.deepEqual(r.comparison.regressions,[{cell:'AC01/V0',ratio:3,increaseMs:600}]);
  assert.equal(r.comparison.comparableCells,2);assert.equal(r.comparison.medianAbsoluteRelativeDifference,2);assert.deepEqual(r.comparison.excluded,['AC02/V0']);
  assert.match(markdown(r),/SLOWDOWN AC01\/V0/);
});
test('unknown slots, different jobs, host, warmth or noisy load prevent comparison',()=>{
  for(const patch of [{slotCount:null},{parallelCells:4},{host:'other'},{addonWarm:false},{load1:12}])assert.equal(comparable(context,{...context,...patch}),false);
  assert.equal(comparable(context,{...context,load1:1.5}),true);
});
test('coverage denominator includes refusals and twin failures, ratios use built comparable pairs only',()=>{
  const r=report(perf([cell('AC01',400),cell('AC02',100,{outcome:'refused'}),cell('AC03',100,{build123d:{outcome:'error'}}),cell('AC04',100,{outcome:'error',build123d:{outcome:'error'}})]));
  assert.deepEqual(r.denominator,{zones:4,both:1,wonkyOnly:1,build123dOnly:1,none:1,matchedCells:1,cells:4});assert.equal(r.zones.AC01.ratios.median,2);assert.equal(r.families.family.ratios.p95,2);assert.equal(r.summary.failures.length,3);
});
test('duplicate cells and mismatched catalogs refuse misleading reports',()=>{
  assert.throws(()=>report(perf([cell('AC01',1),cell('AC01',2)])),/DUPLICATE/);
  assert.throws(()=>report(perf([]),{...perf([]),zonesSha256:'different'}),/CATALOG_MISMATCH/);
});
test('native instrumentation preserves receiver, return value and exception; always restores addon',()=>{
  const error=new Error('named refusal'),addon={value:7,hostOp(x){if(x<0)throw error;return this.value+x;}};
  const original=addon.hostOp,timer=nativeTimer(addon);timer.start();assert.equal(addon.hostOp(2),9);assert.throws(()=>addon.hostOp(-1),e=>e===error);
  const timing=timer.stop();assert.ok(timing.wallMs>=0);assert.ok(timing.cpuMs>=0);assert.ok(timer.overheadMs>=0);timer.restore();assert.equal(addon.hostOp,original);
});

test('CLI reads synthetic perf files and renders slowdown and noisy-load evidence', async()=>{
  const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs');
  const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {spawnSync}=await import('node:child_process');
  const dir=mkdtempSync(join(tmpdir(),'wonky-perf-report-'));
  try {
    const before=join(dir,'before.json'),now=join(dir,'now.json');
    writeFileSync(before,JSON.stringify(perf([cell('AC01',300),cell('AC02',300)])));
    writeFileSync(now,JSON.stringify(perf([cell('AC01',900),cell('AC02',900,{context:{...context,load1:15}})])));
    const cli=spawnSync(process.execPath,['scripts/acid/perf-report.mjs',now,before,'--json'],{encoding:'utf8'});
    assert.equal(cli.status,0,cli.stderr);const data=JSON.parse(cli.stdout);
    assert.deepEqual(data.comparison.regressions.map(c=>c.cell),['AC01/V0']);assert.deepEqual(data.comparison.excluded,['AC02/V0']);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('ratio table retains both-build pairs under noisy load and discloses comparability',()=>{
  const c=cell('AC01',100);c.build123d.context.load1=15;
  const r=report(perf([c]));assert.equal(r.summary.matched,1);assert.equal(r.summary.comparableLoadPairs,0);assert.equal(r.summary.ratios.median,2);
});

test('Python phase timer preserves failure exit and stderr while recording process CPU',async()=>{
  const {mkdtempSync,readFileSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {spawnSync}=await import('node:child_process');
  const dir=mkdtempSync(join(tmpdir(),'wonky-python-perf-'));
  try {
    const output=join(dir,'phase.json');
    const source='import sys;sys.path.insert(0,"scripts/acid");from python_perf import start_timing;start_timing(sys.argv[1]);print("original stdout");raise ValueError("original failure")';
    const child=spawnSync('python3',['-B','-c',source,output],{encoding:'utf8'});
    assert.equal(child.status,1);assert.equal(child.stdout,'original stdout\n');assert.match(child.stderr,/ValueError: original failure/);
    const timing=JSON.parse(readFileSync(output,'utf8'));assert.ok(timing.cpuMs>=0);assert.ok(timing.wallMs>=0);assert.ok(timing.timingOverheadMs>=0);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('extension groups aggregate by the catalog family, with base group and smoke fallbacks',()=>{
  assert.equal(familyFor({group:'holes-a',family:'booleans-holes'},{id:'holes-a'}),'booleans-holes');
  assert.equal(familyFor({group:'boolean-z1',family:'booleans-holes'},{id:'boolean-z1'}),'booleans-holes');
  assert.equal(familyFor({group:'profile'},{id:'profile'}),'profile');
  assert.equal(familyFor(null,{id:'profile'}),'profile');
});

test('raw run noise includes loaded cells while slowdown flags and comparable noise exclude them',()=>{
  const before=perf([cell('AC01',300),cell('AC02',300)]);
  const now=perf([cell('AC01',900),cell('AC02',1200,{context:{...context,load1:15}})]);
  const r=report(now,before);assert.equal(r.comparison.medianAbsoluteRelativeDifference,2.5);
  assert.equal(r.comparison.comparableMedianAbsoluteRelativeDifference,2);assert.equal(r.comparison.pairedCells,2);
  assert.deepEqual(r.comparison.regressions.map(c=>c.cell),['AC01/V0']);assert.equal(r.comparison.differences[1].comparableLoad,false);
});
