import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("boolean-stress.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { mkdtempSync, rmSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { booleanStressCases, runBooleanStress } = await import("../scripts/boolean-stress.mjs");







test('Boolean stress corpus binds real r10b input and includes complex/metamorphic cases', () => {
  const cases = booleanStressCases({ full: true });
  assert.equal(new Set(cases.map(item => item.id)).size, cases.length);
  assert.ok(cases.some(item => item.parameters?.teeth === 32));
  assert.ok(cases.some(item => item.family === 'operand-swap'));
  assert.ok(cases.some(item => item.family === 'rigid-transform'));
  assert.equal(cases.find(item => item.id === 'r10b-g7-union').expected.volumeMm3, 51985.642486572266);
});

test('Boolean stress runner separates real resolved geometry, missing capability and independent validation', async () => {
  const out = mkdtempSync(join(tmpdir(), 'wonky-boolean-stress-'));
  try {
    const report = await runBooleanStress({ out, caseIds: ['comb-4-y-1.5', 'comb-4-swapped', 'comb-4-rigid', 'r10b-g7-union'], validateStep: false });
    assert.equal(report.counts.total, 4);
    for (const row of report.cases.filter(item => item.family !== 'real-r10b-coplanar-overlap')) {
      assert.equal(row.status, 'native-resolved', JSON.stringify(row.error));
      assert.equal(row.result.components, 4);
      assert.ok(Math.abs(row.result.volumeMm3 - 48) < 1e-7);
      assert.equal(row.independentValidation, 'not-run');
    }
    const realCase = report.cases.find(item => item.id === 'r10b-g7-union');
    // When support is added this becomes a genuine geometry/volume assertion.
    assert.ok(['native-resolved', 'unsupported'].includes(realCase.status), JSON.stringify(realCase.error));
    if (realCase.status === 'native-resolved') assert.ok(Math.abs(realCase.result.volumeMm3 - realCase.expected.volumeMm3) < 0.001);
    assert.equal(report.counts.independentlyValidated, 0);
    assert.equal(report.counts.incorrect, 0);
    assert.equal(report.complete, false, 'native-only checks do not claim independent validation');
  } finally { rmSync(out, { recursive: true, force: true }); }
});

}
