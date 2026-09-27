import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("public-boolean-regressions.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");
const { regressionFixtures, verifyPublicBooleanRegressions, runPublicBooleanRegressions, checkPublicBooleanStep, classifyPublicBooleanFailure } = await import("../scripts/public-boolean-regressions.mjs");








test('public OCCT operands, adaptations, license and original assertions remain hash-pinned', () => {
  const manifest = verifyPublicBooleanRegressions();
  assert.equal(manifest.cases.length, 6);
  assert.equal(manifest.revision, '3d097a0328e71b826377d4814ab05ec3c3d23871');
  assert.equal(manifest.cases.reduce((sum, row) => sum + row.expected.probes.length, 0), 30);
  for (const row of manifest.cases) {
    const original = readFileSync(join(regressionFixtures, row.originalSource), 'utf8');
    assert.doesNotMatch(original, /locate_data_file|^restore |nurbsconvert/m);
    assert.ok(row.modifications && row.originalOracles.viewCheck && row.expected.derivation);
  }
  const base = mkdtempSync(join(tmpdir(), 'wonky-occt-provenance-'));
  try {
    cpSync(regressionFixtures, base, { recursive: true });
    writeFileSync(join(base, manifest.cases[0].originalSource), 'box replacement 1 1 1\n');
    assert.throws(() => verifyPublicBooleanRegressions(base), /SHA-256 mismatch/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('complete Boolean cases execute in Bend; unsupported cases cannot retain stale successful exports', async () => {
  const out = mkdtempSync(join(tmpdir(), 'wonky-occt-native-'));
  try {
    const manifest = verifyPublicBooleanRegressions();
    for (const row of manifest.cases) for (const ext of ['step', 'brep.json']) writeFileSync(join(out, row.id + '.' + ext), 'stale success');
    const report = await runPublicBooleanRegressions({ out, validateStep: false });
    assert.equal(report.upstream.originalSuiteExecuted, false);
    assert.equal(report.upstream.originalTestsPassed, null);
    assert.equal(report.accepted, false, 'Skipping independent area/occupancy checks cannot pass the cohort');
    assert.equal(report.cases.find(row => row.id === 'common-e1').status, 'kernel-passed');
    for (const row of report.cases) {
      // Capability improvements may turn any unsupported case into a real pass.
      assert.ok(['kernel-passed', 'unsupported-geometry'].includes(row.status), `${row.id}: ${row.status}: ${row.error?.message}`);
      if (row.status === 'unsupported-geometry') {
        assert.equal(row.error.name, 'UnsupportedFeatureError');
        assert.ok(existsSync(join(out, row.failureArtifact)));
        for (const ext of ['step', 'brep.json']) assert.equal(existsSync(join(out, row.id + '.' + ext)), false);
      } else assert.ok(row.exports.every(file => existsSync(join(out, file.path))));
    }
    assert.equal(classifyPublicBooleanFailure(new UnsupportedFeatureError("'missingAPI' is not defined or not implemented by this prototype")), 'unsupported-api');
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('original area and added bounds/occupancy oracles validate the reference intersection from a cold fixture path', async () => {
  mkdirSync(new URL('../out/', import.meta.url), { recursive: true });
  const out = mkdtempSync(new URL('../out/public-boolean-cold-', import.meta.url));
  try {
    // uv keys script environments by path. A fresh checkout must validate too,
    // not exhaust the STEP startup budget loading new copies of every dylib.
    // Keep this at the existing real-OCCT boundary; no stub or extra oracle.
    const fixtures = join(out, 'fixtures');
    cpSync(regressionFixtures, fixtures, { recursive: true });
    const report = await runPublicBooleanRegressions({ out, fixtures, caseIds: ['common-e1'] });
    const row = report.cases[0];
    const log = join(out, 'step-validation.log');
    assert.equal(row.status, 'passed-adapted-geometry',
      `${JSON.stringify(row.error)}\n${existsSync(log) ? readFileSync(log, 'utf8') : 'STEP not started'}`);
    assert.equal(report.stepValidation.status, 'passed');
    assert.equal(report.accepted, report.implementationStable);
    assert.equal(row.independentStep.validityCheck, 'BRepCheck_Analyzer(exact CurveOnSurface)');
    assert.equal(row.independentStep.pointClassification.points.length, 4);
    const wrongArea = structuredClone(row.independentStep); wrongArea.areaMm2 += 0.01;
    assert.throws(() => checkPublicBooleanStep(wrongArea, row), error => classifyPublicBooleanFailure(error) === 'wrong-geometry');
    const missingArea = structuredClone(row.independentStep); delete missingArea.areaMm2;
    assert.throws(() => checkPublicBooleanStep(missingArea, row), error => classifyPublicBooleanFailure(error) === 'incomplete-oracle');
    const unknownPoint = structuredClone(row.independentStep); unknownPoint.pointClassification.points[0].state = 'Unknown';
    assert.throws(() => checkPublicBooleanStep(unknownPoint, row), /Occupancy/);
    const missingPoint = structuredClone(row.independentStep); missingPoint.pointClassification.points.pop();
    assert.throws(() => checkPublicBooleanStep(missingPoint, row), error => classifyPublicBooleanFailure(error) === 'incomplete-oracle');
  } finally { rmSync(out, { recursive: true, force: true }); }
});

}
