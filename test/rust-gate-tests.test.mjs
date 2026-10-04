import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cargoCounts, compareTests, junitCounts, checkCounts} from '../scripts/rust/gate-tests.mjs';

test('gate aggregates Cargo binary and doctest counts, preserving ignored tests', () => {
  assert.deepEqual(cargoCounts('test result: ok. 2 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out;\ntest result: ok. 3 passed; 0 failed; 0 ignored;'), {passed:5,ignored:1});
  assert.throws(() => cargoCounts('runner did not finish'), /COUNT_MISSING/);
});
test('gate checks the full test-name multiset including duplicate names across binaries', () => {
  const list = {'rust-suites':{a:{testcases:{same:{},other:{}}},b:{testcases:{same:{}}}}};
  assert.equal(compareTests('same: test\nother: test\nsame: test\n3 tests, 0 benchmarks', list), 3);
  assert.throws(() => compareTests('same: test\nother: test', list), /TEST_SET_MISMATCH/);
  assert.throws(() => compareTests('same: test\nchanged: test\nsame: test', list), /TEST_SET_MISMATCH/);
});
test('gate rejects failed, missing and mismatched nextest execution evidence', () => {
  assert.deepEqual(junitCounts('<testsuite><testcase name="a" time="1"/><testcase name="b"><skipped/></testcase></testsuite>'), {passed:1,ignored:1});
  assert.throws(() => junitCounts('<testcase name="a"><failure/></testcase>'), /NEXTEST_FAILURE/);
  assert.throws(() => junitCounts('<testsuites/>'), /COUNT_MISSING/);
  checkCounts({passed:10,ignored:2}, {passed:10,ignored:2});
  assert.throws(() => checkCounts({passed:10,ignored:2}, {passed:9,ignored:2}), /EXECUTED_COUNT_MISMATCH/);
  assert.throws(() => checkCounts({passed:10,ignored:2}, {passed:10,ignored:1}), /EXECUTED_COUNT_MISMATCH/);
});
