import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {cpuMeasured} from './support/cpu-budget.mjs';

test('CPU accounting includes spawned descendants and preserves unsuccessful exit',()=>{
  const dir=mkdtempSync(join(tmpdir(),'wonky-cpu-child-'));
  try {
    const output=join(dir,'child.json');
    const child=`const fs=require('node:fs');const start=process.cpuUsage();
      let value=0;for(let i=0;i<30000000;i++)value=Math.sin(value+i);
      const cpu=process.cpuUsage(start);fs.writeFileSync(process.argv[1],JSON.stringify({value,cpuSeconds:(cpu.user+cpu.system)/1e6}));`;
    const parent=`const {spawnSync}=require('node:child_process');
      const r=spawnSync(process.execPath,['-e',${JSON.stringify(child)},${JSON.stringify(output)}],{stdio:'inherit'});
      if(r.status!==0)process.exit(r.status);process.exit(7);`;
    const usage=cpuMeasured(process.execPath,['-e',parent]);
    const charged=JSON.parse(readFileSync(output));
    assert.equal(usage.status,7);
    assert.ok(Number.isFinite(charged.value));
    assert.ok(charged.cpuSeconds>0);
    assert.ok(usage.cpuSeconds>=charged.cpuSeconds,
      `descendant consumed ${charged.cpuSeconds}s, charged ${usage.cpuSeconds}s`);
    assert.ok(Number.isFinite(usage.wallSeconds)&&usage.wallSeconds>=0);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('a nested test runner executes despite inherited NODE_TEST_CONTEXT',()=>{
  const dir=mkdtempSync(join(tmpdir(),'wonky-cpu-nested-'));
  try {
    const file=join(dir,'nested.cjs');
    writeFileSync(file,`require('node:test')('real nested test',()=>{require('node:assert/strict').fail('executed nested test');});`);
    const usage=cpuMeasured(process.execPath,['--test',file],{env:{...process.env,NODE_TEST_CONTEXT:'child-v8'}});
    assert.equal(usage.status,1,'the nested test must execute and fail its actual assertion');
  } finally {rmSync(dir,{recursive:true,force:true});}
});
