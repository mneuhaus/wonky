import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("cadbench.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { spawnSync } = await import("node:child_process");
const { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { build } = await import("../src/index.mjs");
const { cadbenchRoot, cadbenchFixtures, verifyCadbenchFixtures } = await import("../scripts/cadbench-sources.mjs");
const { cadbenchOptions, checkCadbenchModel, runCadbench } = await import("../scripts/cadbench.mjs");










test('pinned public CADBench metadata covers exactly all 100 official v2 task IDs', () => {
  const { provenance, corpus, policy, pilot } = verifyCadbenchFixtures();
  assert.equal(provenance.license, 'Apache-2.0');
  assert.equal(corpus.length, 100);
  assert.equal(Object.keys(policy.task_digests).length, 100);
  assert.equal(policy.dataset_content_hash, 'sha256:ab2e040d0adcfd2779b4f1ad554890cd98b5aa19845e00162933ba165144fe56');
  assert.equal(pilot.cases.length, 5);
  assert.equal(corpus.find(row => row.id === '21d1517841').key_parameters,
    '- outer_diameter=9.0mm\n- inner_diameter=3.2mm\n- thickness=0.8mm\n');
});

test('changed source data or adapted programs fail before creating benchmark output', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wonky-cadbench-integrity-'));
  try {
    const fixtures = join(dir, 'fixtures'), out = join(dir, 'out');
    cpSync(cadbenchFixtures, fixtures, { recursive: true });
    const source = join(fixtures, 'adapted/washer.fs');
    writeFileSync(source, readFileSync(source, 'utf8') + '\n');
    await assert.rejects(runCadbench({ fixtures, out, validateStep: false }), /adapted source SHA-256 mismatch/);
    assert.equal(existsSync(out), false);
    cpSync(join(cadbenchFixtures, 'adapted/washer.fs'), source);
    const metadata = join(fixtures, 'upstream/public-corpus.json');
    writeFileSync(metadata, readFileSync(metadata, 'utf8').replace('9.0mm', '90.0mm'));
    assert.throws(() => verifyCadbenchFixtures(fixtures), /fixture SHA-256 mismatch/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Rust pilot retains every case and failed attempt without awarding an official score', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wonky-cadbench-pilot-'));
  try {
    writeFileSync(join(dir, 'cadbench-frustum.step'), 'stale successful-looking output');
    const report = await runCadbench({ out: dir, validateStep: false });
    assert.equal(report.official.totalTasks, 100);
    assert.equal(report.official.attemptedTasks, 0);
    assert.equal(report.official.scoredTasks, 0);
    assert.equal(report.official.reward, null);
    assert.equal(report.official.submissionEligible, false);
    assert.equal(report.local.cases.length, 5);
    assert.equal(report.local.completePilot, true);
    assert.equal(report.inventory.length, 100);
    assert.equal(report.inventory.filter(row => row.localAdaptation === 'not-attempted').length, 95);
    assert.equal(report.accepted, false);
    assert.equal(report.stepValidation.status, 'not-run');
    for (const id of ['washer', 'cup', 'stairs', 'square-washer']) {
      const row = report.local.cases.find(row => row.id === id);
      assert.equal(row.status, 'kernel-passed', JSON.stringify(row.error));
      assert.ok(row.actual.volumeMm3 > 0);
      for (const extension of ['step', 'brep.json']) assert.ok(existsSync(join(dir, `cadbench-${id}.${extension}`)));
    }
    // The Rust kernel lofts only planar line profiles today: the circle-to-circle
    // frustum is a named capability refusal, never a pass or a silent approximation.
    const frustum = report.local.cases.find(row => row.id === 'frustum');
    assert.equal(frustum.status, 'unsupported');
    assert.equal(frustum.error.code, 'loft/planar-line-profiles-required');
    assert.match(frustum.error.message, /^opLoft: /);
    assert.deepEqual(report.local.counts, { 'kernel-passed': 4, unsupported: 1 });
    for (const row of report.local.cases.filter(row => row.status === 'unsupported' || row.status === 'failed')) {
      assert.ok(row.error.message);
      assert.equal(existsSync(join(dir, `cadbench-${row.id}.step`)), false);
      assert.equal(existsSync(join(dir, `cadbench-${row.id}.brep.json`)), false);
      assert.ok(existsSync(join(dir, row.failureArtifact)));
    }
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'report.json'))).local.counts, report.local.counts);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('local geometry checks reject a wrong volume, extra solid, alternate backend or inexact or unvalidated bodies', async () => {
  const item = verifyCadbenchFixtures().pilot.cases.find(row => row.id === 'washer');
  const washer = () => build(readFileSync(join(cadbenchFixtures, item.source), 'utf8'), { feature: 'main', trace: false });
  const model = await washer();
  assert.ok(checkCadbenchModel(model, item.expected).volumeMm3 > 0);
  assert.throws(() => checkCadbenchModel(model, { ...item.expected, volumeMm3: item.expected.volumeMm3 * 2 }), /Volume/);
  assert.throws(() => checkCadbenchModel(model, { ...item.expected, surfaceTypes: ['plane'] }), /Analytic surface types/);
  assert.throws(() => checkCadbenchModel({ ...model, bodies: [...model.bodies, ...model.bodies] }, item.expected), /Solid count/);
  // No real geometry: another backend's label, or a Rust label over bodies the
  // Rust kernel did not build (a legacy-shaped body that claims to be closed).
  const noGeometry = /requires exact, closed, validated Rust kernel bodies/;
  for (const language of ['OpenCascade', 'Bend'])
    assert.throws(() => checkCadbenchModel({ ...model, backend: { language } }, item.expected), noGeometry);
  const legacy = { id: 'model/outer', validation: { ...model.bodies[0].validation }, faces: [], edges: [], vertices: [] };
  assert.throws(() => checkCadbenchModel({ ...model, bodies: [legacy] }, item.expected), noGeometry);
  const regularized = await washer();
  regularized.bodies[0].exactness = 'regularized';
  assert.throws(() => checkCadbenchModel(regularized, item.expected), /has regularized, not exact, geometry/);
  const unvalidated = await washer();
  unvalidated.bodies[0].validation = { ...unvalidated.bodies[0].validation, closed: false };
  assert.throws(() => checkCadbenchModel(unvalidated, item.expected), /is not a closed, validated B-rep/);
});

test('subset CLI retains the full denominator and skipped STEP checks cannot yield a validated pass', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wonky-cadbench-cli-'));
  try {
    const result = spawnSync(process.execPath, ['scripts/cadbench.mjs', '--out', dir, '--case', 'washer', '--skip-step-validation'],
      { cwd: cadbenchRoot, encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    const report = JSON.parse(readFileSync(join(dir, 'report.json')));
    assert.equal(report.local.selectedCases, 1);
    assert.equal(report.local.pilotCases, 5);
    assert.equal(report.local.completePilot, false);
    assert.equal(report.local.cases[0].status, 'kernel-passed');
    assert.equal(report.official.totalTasks, 100);
    assert.equal(report.official.reward, null);
    assert.equal(report.accepted, false);
    assert.match(result.stdout, /0\/100 scored/);
    assert.throws(() => cadbenchOptions(['--out']), /requires a value/);
    assert.throws(() => cadbenchOptions(['--unknown']), /Unknown CADBench option/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

}
