import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { benchmarkOptions, checkGeometryAgreement, timingStatistics, verifyPerformanceFixtures } from '../scripts/benchmark-build123d.mjs';

test('same-source performance fixtures freeze candidates, capability probes and isolated dependencies', () => {
  const manifest = verifyPerformanceFixtures();
  assert.equal(manifest.cases.filter(row => row.eligibility === 'candidate').length, 6);
  assert.equal(manifest.cases.filter(row => row.eligibility === 'capability-probe').length, 2);
  assert.ok(manifest.cases.every(row => row.sourceSha256.length === 64));
  const directory = mkdtempSync(join(tmpdir(), 'wonky-perf-fixtures-'));
  try {
    cpSync(new URL('../fixtures/performance-build123d/', import.meta.url), directory, { recursive: true });
    const path = join(directory, manifest.cases[0].source);
    writeFileSync(path, readFileSync(path, 'utf8') + '\n# altered benchmark source\n');
    assert.throws(() => verifyPerformanceFixtures(directory), /SHA-256 mismatch/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('geometry gate rejects missing metrics, changed bounds and wrong cavity membership', () => {
  const manifest = verifyPerformanceFixtures(), expected = manifest.cases.find(row => row.id === 'planar-pocket').expected;
  const actual = { ...expected, probes: expected.probes.map(point => ({ ...point, state: point.classification })) };
  assert.equal(checkGeometryAgreement(actual, expected, manifest.tolerances, { probes: true }), true);
  assert.throws(() => checkGeometryAgreement({ ...actual, volumeMm3: null }, expected, manifest.tolerances), /Volume/);
  assert.throws(() => checkGeometryAgreement({ ...actual, boundsMm: null }, expected, manifest.tolerances), /Bounds/);
  assert.throws(() => checkGeometryAgreement({ ...actual, probes: actual.probes.map(point => ({ ...point, state: 'Inside' })) }, expected, manifest.tolerances, { probes: true }), /Point membership/);
  assert.throws(() => checkGeometryAgreement({ ...actual, probes: actual.probes.slice(1) }, expected, manifest.tolerances, { probes: true }), /Incomplete/);
});

test('timings retain raw spread and interpolate even medians; undersampled principal runs are rejected', () => {
  assert.deepEqual(timingStatistics([8, 2, 4, 6]), { samples: 4, medianMs: 5, p25Ms: 3.5, p75Ms: 6.5, minMs: 2, maxMs: 8, rawMs: [8, 2, 4, 6] });
  assert.throws(() => timingStatistics([NaN]), /finite/);
  assert.throws(() => benchmarkOptions(['--rounds', '1']), /at least three/);
  assert.throws(() => benchmarkOptions(['--warmups', '0']), /positive integer/);
  assert.throws(() => benchmarkOptions(['--rounds', '3ms']), /positive integer/);
  assert.equal(benchmarkOptions(['--check']).checkOnly, true);
});
