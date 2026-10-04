import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("cadbench-build123d.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { spawnSync } = await import("node:child_process");
const { existsSync, mkdtempSync, readFileSync, rmSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");
const { NativeCapabilityError } = await import("../src/native/errors.mjs");
const { cadbenchRoot } = await import("../scripts/cadbench-sources.mjs");
const { build123dOptions, classifyBuild123dFailure, verifyBuild123dProbes } = await import("../scripts/cadbench-build123d.mjs");











test('build123d probes pin licensed upstream tests and document omitted assertions', () => {
  const manifest = verifyBuild123dProbes();
  assert.equal(manifest.cases.length, 10);
  assert.equal(manifest.upstreamTestMethodsInFile, 95);
  assert.ok(manifest.cases.every(row => row.modifications && row.upstreamTest && row.sourceSha256.length === 64));
});

test('unported kernel entries, unsupported frontend APIs, unsupported native geometry and wrong geometry remain separate', () => {
  const unported = new NativeCapabilityError({ entry: 'kernel/profile-ring.bend:simplify', label: 'profileRing.simplify', backend: 'rust', sourceHash: '0'.repeat(64) });
  assert.equal(classifyBuild123dFailure(unported), 'not-ported');
  assert.equal(classifyBuild123dFailure(new UnsupportedFeatureError('Shape.edges is not implemented by the Python frontend')), 'unsupported-api');
  assert.equal(classifyBuild123dFailure(new UnsupportedFeatureError('opBoolean supports coaxial cylinder primitives')), 'unsupported-geometry');
  assert.equal(classifyBuild123dFailure(Object.assign(new Error('Wrong volume'), { name: 'GeometryCheckError' })), 'wrong-geometry');
});

// PARKED (coordination decision, 2026-09-28; docs/python-frontend.md): src/python.mjs
// still calls the legacy Bend-era op table, which the Rust kernel does not serve,
// and it is not being ported. This pins the honest current behaviour: every probe
// fails closed with the named not-ported capability error and none reports success.
// Porting the frontend to the Rust host boundary replaces this test.
test('parked Python frontend: every build123d probe fails closed as not ported to the Rust kernel', () => {
  const out = mkdtempSync(join(tmpdir(), 'wonky-build123d-probes-'));
  try {
    const result = spawnSync(process.execPath, ['scripts/cadbench-build123d.mjs', '--out', out, '--skip-step-validation'],
      { cwd: cadbenchRoot, encoding: 'utf8', timeout: 120000 });
    assert.equal(result.status, 1, result.stderr);
    const report = JSON.parse(readFileSync(join(out, 'report.json')));
    assert.equal(report.cases.length, 10);
    assert.equal(report.upstream.originalSuiteExecuted, false);
    assert.equal(report.upstream.originalTestsPassed, null);
    assert.deepEqual(report.counts, { 'not-ported': 10 });
    for (const row of report.cases) {
      assert.match(row.error.message, /^kernel entry \S+ \(kernel\.\S+\) is not ported to the Rust kernel /, row.id);
      assert.ok(existsSync(join(out, `${row.id}.failure.json`)), row.id);
      for (const extension of ['step', 'brep.json']) assert.equal(existsSync(join(out, `${row.id}.${extension}`)), false, row.id);
    }
    assert.equal(report.stepValidation.status, 'not-run');
    assert.equal(report.accepted, false);
    assert.match(result.stdout, new RegExp(`${out.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}/report\\.json`));
    assert.throws(() => build123dOptions(['--out']), /--out requires a value/);
    assert.throws(() => build123dOptions(['--unknown']), /Usage/);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

}
