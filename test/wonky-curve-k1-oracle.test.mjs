import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
const script=new URL('../rust/wonky-curve/tests/oracle/k1_circles.py',import.meta.url);
const file=new URL('../rust/wonky-curve/tests/oracle/k1_circles.json',import.meta.url);
test('K1 Cartesian SymPy oracle is reproducible and has frozen provenance',()=>{
  const expected=fs.readFileSync(file,'utf8');
  const data=JSON.parse(expected);
  assert.equal(data.provenance.script_sha256,crypto.createHash('sha256').update(fs.readFileSync(script)).digest('hex'));
  assert.equal(data.provenance.sympy,'1.13.3');
  const result=spawnSync('uv',['run',script.pathname],{encoding:'utf8',timeout:300000});
  assert.equal(result.status,0,result.stderr);
  assert.equal(result.stdout,expected);
  assert.deepEqual(data.obstruction,{prime:11,valuation:1});
  assert.equal(data.rows.length,4);
});
