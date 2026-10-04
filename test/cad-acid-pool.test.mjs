import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {executeRun} from '../scripts/acid/execution.mjs';
import assert from 'node:assert/strict';
import {acidJobs,orderedPool,cellPreloads} from '../scripts/acid/pool.mjs';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('Acid jobs default leaves two cores and rejects invalid bounds',()=>{
  const before=process.env.WONKY_ACID_JOBS;
  try {
    delete process.env.WONKY_ACID_JOBS;
    assert.equal(acidJobs(undefined,18),16);
    assert.equal(acidJobs('',1),1);
    assert.equal(acidJobs('1',18),1);
    for(const setting of ['0','-1','1.5','NaN','Infinity','9007199254740992'])assert.throws(()=>acidJobs(setting,18),/positive integer/);
    process.env.WONKY_ACID_JOBS='3';
    assert.equal(acidJobs(undefined,18),3);
  } finally {
    if(before===undefined)delete process.env.WONKY_ACID_JOBS;else process.env.WONKY_ACID_JOBS=before;
  }
});

test('bounded cells overlap but publish in serial order, including smoke entries',async()=>{
  const items=['ALL','AC1','AC2','ALL','AC3'];
  let active=0,peak=0;
  const started=[],completed=[],published=[];
  await orderedPool(items,3,async (cell,index)=>{
    started.push(cell);peak=Math.max(peak,++active);
    await pause(index===0?40:2);
    completed.push(cell);active--;
    return {cell};
  },row=>published.push(row.cell));
  assert.equal(peak,3);
  assert.deepEqual(started,items);
  assert.notEqual(completed[0],'ALL');
  assert.deepEqual(published,items);
  assert.equal(active,0);
});

test('one job preserves serial dispatch, completion and publication',async()=>{
  const events=[];
  await orderedPool([0,1,2],1,async cell=>{events.push(`start${cell}`);await pause(1);return cell;},cell=>events.push(`commit${cell}`));
  assert.deepEqual(events,['start0','commit0','start1','commit1','start2','commit2']);
});

test('cell failure drains running cells without admitting rows beyond the gap',async()=>{
  let active=0;
  const started=[],published=[];
  await assert.rejects(orderedPool([0,1,2,3],3,async cell=>{
    started.push(cell);active++;
    try {await pause(cell===1?2:20);if(cell===1)throw new Error('cell defect');return cell;}
    finally {active--;}
  },cell=>published.push(cell)),/cell defect/);
  assert.deepEqual(started,[0,1,2]);
  assert.deepEqual(published,[]);
  assert.equal(active,0);
});

test('publication failure rejects pending cells and drains the pool',async()=>{
  await assert.rejects(orderedPool([0,1,2],2,async cell=>{await pause(1);return cell;},()=>{throw new Error('save defect');}),/save defect/);
});

test('invalid job setting retires earlier run outputs before refusing',async()=>{
  const out=fs.mkdtempSync(path.join(os.tmpdir(),'acid-pool-invalid-'));
  const before=process.env.WONKY_ACID_JOBS;
  try {
    for(const file of ['results.json','scoreboard.json','scoreboard.md'])fs.writeFileSync(path.join(out,file),'old output');
    process.env.WONKY_ACID_JOBS='0';
    await assert.rejects(executeRun({out}),/positive integer/);
    for(const file of ['results.json','scoreboard.json','scoreboard.md'])assert.equal(fs.existsSync(path.join(out,file)),false);
  } finally {
    if(before===undefined)delete process.env.WONKY_ACID_JOBS;else process.env.WONKY_ACID_JOBS=before;
    fs.rmSync(out,{recursive:true,force:true});
  }
});

test('cell children preserve preloads without replaying parent entry-point flags',()=>{
  assert.deepEqual(cellPreloads(['--input-type=module','-e','parent program','--import','guard.mjs','--require=hook.cjs','-r','other.cjs','--test','--test-name-pattern=foo']),
    ['--import','guard.mjs','--require=hook.cjs','-r','other.cjs']);
});
