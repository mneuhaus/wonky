import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("cadbench-build123d.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { mkdtempSync, rmSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");
const { classifyBuild123dFailure, runBuild123dProbes, verifyBuild123dProbes } = await import("../scripts/cadbench-build123d.mjs");








test('build123d probes pin licensed upstream tests and document omitted assertions', () => {
  const manifest = verifyBuild123dProbes();
  assert.equal(manifest.cases.length, 10);
  assert.equal(manifest.upstreamTestMethodsInFile, 95);
  assert.ok(manifest.cases.every(row => row.modifications && row.upstreamTest && row.sourceSha256.length === 64));
});

test('unsupported frontend APIs, unsupported native geometry and wrong geometry remain separate', () => {
  assert.equal(classifyBuild123dFailure(new UnsupportedFeatureError('Shape.edges is not implemented by the Python frontend')), 'unsupported-api');
  assert.equal(classifyBuild123dFailure(new UnsupportedFeatureError('opBoolean supports coaxial cylinder primitives')), 'unsupported-geometry');
  assert.equal(classifyBuild123dFailure(Object.assign(new Error('Wrong volume'), { name: 'GeometryCheckError' })), 'wrong-geometry');
});

test('selected real upstream modeling sequences execute through the Bend Python frontend', async () => {
  const out = mkdtempSync(join(tmpdir(), 'wonky-build123d-probes-'));
  try {
    const report = await runBuild123dProbes({ out, validateStep: false });
    assert.equal(report.cases.length, 10);
    assert.equal(report.upstream.originalSuiteExecuted, false);
    assert.equal(report.upstream.originalTestsPassed, null);
    for (const id of ['box-min', 'cylinder']) assert.equal(report.cases.find(row => row.id === id).status, 'kernel-passed');
    for (const row of report.cases.filter(row => row.status.startsWith('unsupported-'))) assert.ok(row.error.message);
    assert.equal(report.accepted, false);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

}
