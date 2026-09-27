import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missing("fixtures/diagnostics/r20-carriers.json", "fixtures/r20-modules/manifest.json");
if (publicTreeSkip) {
  test("r20-diagnostics.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { spawnSync } = await import("node:child_process");
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { fileURLToPath } = await import("node:url");
// Authoring gate: the CAD-facing report must not blame CAD for double-rounding
// at internal tangencies or for the gap between tessellation leaves. Existing
// tests prove provenance/export bytes, not advice. Real frozen inputs, exercised
// through the report CLI; no exported test seam. Planted 1e-5 mm offsets prevent
// a blanket "kernel case" or an unbounded sqrt(overlap) from passing.








const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = JSON.parse(readFileSync(join(root, 'fixtures/diagnostics/r20-carriers.json')));
function report(mutate = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wonky-carrier-report-'));
  try {
    const cases = structuredClone(fixture.cases);
    mutate(cases);
    const modules = {};
    for (const row of cases) {
      modules[row.module] = { featureType: row.featureType };
      const target = join(dir, row.module, 'fallbacks');
      mkdirSync(target, { recursive: true });
      writeFileSync(join(target, `${row.part}.json`), JSON.stringify({ current: row.current, history: [] }));
    }
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ modules }));
    const result = spawnSync(process.execPath, [join(root, 'scripts/r20/diagnostics.mjs'), dir, dir], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const rows = JSON.parse(readFileSync(join(dir, 'r20-near-tangent.json'))).rows;
    return Object.fromEntries(rows.filter(row => row.status === 'located').map(row => [row.part, row]));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('real R20 internal tangencies use square-root rounding uncertainty, never a CAD edit', () => {
  const rows = report();
  for (const part of ['HUB_R', 'ARM_R', 'P01']) {
    const row = rows[part];
    assert.equal(row.hint, 'kernel case: tangency-amplified rounding', part);
    assert.equal(row.cadChange, null, `${part}: no CAD edit is justified`);
    assert.ok(Math.abs(row.tangency.effectiveRadiusMm - 0.525) < 1e-12);
    assert.ok(Math.abs(row.tangency.overlapMm) < 1e-12);
    assert.ok(row.tangency.uncertaintyMm >= row.residualMm);
    assert.ok(row.tangency.uncertaintyMm < 1e-6, 'a geometry-scale tolerance must not replace roundoff');
  }
  // Independent worked value: sqrt(2 * 1.0658141036401503e-14 * 0.525).
  assert.ok(Math.abs(rows.HUB_R.tangency.observedUncertaintyMm - 1.0578775018035677e-7) < 2e-9);
});

test('RACK shows the carrier separation beside the leaf gap and names the kernel case', () => {
  const row = report().RACK;
  assert.equal(row.gapMm, 0.0056079486);
  assert.ok(Math.abs(row.carrierDistanceMm + 2.1e-14) < 1e-14);
  assert.equal(row.hint, 'kernel case: tessellation leaves near, carriers tangent');
  assert.equal(row.cadChange, null);
});

test('genuine 1e-5 mm CAD offsets are not hidden by the tangency-rounding hint', () => {
  const rows = report(cases => {
    const hub = cases.find(row => row.part === 'HUB_R').current;
    hub.residualMm = 1e-5;
    hub.reason = 'mesh vertex 8: carriers are not concurrent (residual 1e-5 mm)';
    const arm = cases.find(row => row.part === 'ARM_R').current;
    arm.carriers.find(c => c.type === 'cylinder').parameters.origin[2] += 1e-5;
    const rack = cases.find(row => row.part === 'RACK').current;
    const plane = rack.carriers.find(c => c.type === 'plane').parameters;
    const length = Math.hypot(...plane.normal);
    plane.origin = plane.origin.map((v, i) => v + plane.normal[i] / length * 1e-5);
  });
  for (const part of ['HUB_R', 'ARM_R', 'RACK']) {
    assert.match(rows[part].hint, /^CAD case:/, part);
    assert.ok(rows[part].cadChange, `${part}: the CAD case must remain actionable`);
  }
  assert.ok(Math.abs(rows.RACK.carrierDistanceMm - 1e-5) < 1e-12);
});

}
