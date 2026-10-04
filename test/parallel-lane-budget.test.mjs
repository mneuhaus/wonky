import test from 'node:test';
import assert from 'node:assert/strict';
import {splitPoolBudget} from '../scripts/acid/pool.mjs';

test('parallel pools share the host allowance and preserve individual limits', () => {
  assert.deepEqual(splitPoolBudget(5,[5,5]),{concurrent:true,jobs:[3,2]});
  assert.deepEqual(splitPoolBudget(16,[6,16]),{concurrent:true,jobs:[6,10]});
  for(let total=1;total<=24;total++)for(const limits of [[1,8],[8,1],[2,3,4],[1,1]]) {
    const result=splitPoolBudget(total,limits);
    assert.equal(result.jobs.length,limits.length);
    assert.ok(result.jobs.every((n,i)=>n>=1&&n<=limits[i]));
    if(result.concurrent)assert.ok(result.jobs.reduce((a,b)=>a+b,0)<=total);
    else assert.ok(result.jobs.every(n=>n<=total));
    assert.equal(result.concurrent,total>=limits.length);
  }
});
test('a one-worker allowance executes every pool serially; invalid budgets fail', () => {
  assert.deepEqual(splitPoolBudget(1,[5,5]),{concurrent:false,jobs:[1,1]});
  for(const [total,limits] of [[0,[1]],[-1,[1]],[1.5,[1]],[1,[]],[2,[0,1]],[2,[1.5,1]]])assert.throws(()=>splitPoolBudget(total,limits),/INVALID_POOL_BUDGET/);
});
