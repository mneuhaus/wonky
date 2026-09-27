// Owns the build/observation handoff: a successfully constructed but wrong
// model must reach scoring even when its body selectors have no unique match.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, CATALOG, loadCatalog, sha256 } from '../scripts/acid/common.mjs';
import { scoreVariant } from '../scripts/acid/score.mjs';

const { catalog, zonesSha256 } = loadCatalog();
const zone = catalog.zones.find(z => z.id === 'AC39');

test('decided missing or ambiguous body selectors preserve built topology for scoring', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wonky-observation-'));
  try {
    // Deliberately incomplete/overlapping real models, not fake measurements.
    // AC39 asks for points at x=4 and x=12; these boxes end at x=8.
    for (const count of [1, 2]) {
      const source = path.join(dir, 'wrong.fs');
      const text = `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export function main(context is Context, id is Id, definition is map) {
${Array.from({ length: count }, (_, i) => `fCuboid(context, id + "box${i}", {"corner1":vector(0,1000,0)*millimeter,"corner2":vector(8,1004,4)*millimeter});`).join('\n')}
}`;
      fs.writeFileSync(source, text);
      const out = path.join(dir, `case-${count}`);
      fs.mkdirSync(out);
      const request = path.join(out, 'request.json');
      fs.writeFileSync(request, JSON.stringify({ source, sourceSha256: sha256(text), zonesSha256,
        feature: 'main', parameters: {}, zone: zone.id, variant: 'V0', out, catalog: CATALOG }));
      const guard = path.join(out, 'guard.json');
      const child = spawnSync(process.execPath, ['--import', path.join(ROOT, 'scripts/r20/bend-guard.mjs'),
        path.join(ROOT, 'scripts/acid/build-wonky.mjs'), request], {
        cwd: ROOT, encoding: 'utf8', timeout: 30000,
        env: { ...process.env, WONKY_BACKEND: 'rust', WONKY_BEND_GUARD_LOG: guard },
      });
      const built = JSON.parse(fs.readFileSync(path.join(out, 'build.json')));
      assert.equal(child.status, 0, child.stderr);
      assert.equal(built.outcome, 'built', built.error?.message);
      const metrics = built.nativeObservation.metrics;
      assert.equal(metrics.bodies.length, count);
      assert.equal(metrics.topology.bodies, count);
      assert.equal(Object.hasOwn(metrics.measurements, 'gap'), false);
      assert.match(metrics.measurementErrors.gap, /selector must identify one solid/);
      const verdict = scoreVariant(catalog, zone, 'wonky-rust', { ...built, variant: 'V0', metrics });
      // Serialized output is not a live execution receipt. The handoff above
      // must preserve the wrong geometry without minting standalone points.
      assert.equal(verdict.status, 'UNVERIFIED');
      assert.match(verdict.reason, /LIVE_EXECUTION_REQUIRED/);
      assert.equal(JSON.parse(fs.readFileSync(guard)).summary.bendLoaded, false);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// These assertions own the new measurement-kind evidence contract, not the
// kernel distance arithmetic. Mutations alter internally consistent artifacts
// to isolate measurement/body binding from the existing artifact-hash tests.
test('live gap and extent evidence bind native operands and preserve the catalog sliver exception', {skip: !fs.existsSync(path.join(ROOT, 'out/build123d-performance/reference-venv/bin/python')) && 'REFERENCE_VENV_UNAVAILABLE: frozen STEP observer integration'}, async () => {
  const { artifactHashes, verifyExactObservation } = await import('../scripts/acid/evidence.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wonky-box-evidence-'));
  try {
    const run = spawnSync(process.execPath, [path.join(ROOT, 'scripts/acid/run.mjs'), '--out', dir,
      '--kernels', 'wonky-rust', '--zones', 'AC39,AC41', '--variants', 'V0', '--no-smoke', '--json-only'], {
      cwd: ROOT, encoding: 'utf8', timeout: 120000, maxBuffer: 1 << 22,
      env: { ...process.env, WONKY_BACKEND: 'rust' },
    });
    const report = JSON.parse(fs.readFileSync(path.join(dir, 'scoreboard.json')));
    const results = JSON.parse(fs.readFileSync(path.join(dir, 'results.json')));
    for (const id of ['AC39', 'AC41']) {
      const zone = catalog.zones.find(z => z.id === id);
      const row = results.rows.find(r => r.kernel === 'wonky-rust' && r.zone === id);
      assert.equal(report.zones.find(z => z.kernel === 'wonky-rust' && z.zone === id).variants.V0.status, 'CORRECT');
      assert.equal(verifyExactObservation(zone, row).ok, true);
      const artifact = path.resolve(ROOT, row.artifacts, 'build.json');
      const original = fs.readFileSync(artifact);
      const mutations = id === 'AC39' ? [
        [r => r.nativeObservation.measurementEvidence.gap.bodyA = 'absent', /unbound native distance/],
        [r => r.nativeObservation.bodies[0].probes.pop(), /probe coverage/],
        [r => r.nativeObservation.measurementEvidence.gap.distanceMm *= 2, /unbound native measurement/],
      ] : [
        [r => r.nativeObservation.measurementEvidence.thickness.body = 'absent', /unbound native extent/],
        [r => r.nativeObservation.measurementEvidence.thickness.axis = 1, /unbound native extent/],
        [r => r.nativeObservation.measurementEvidence.thickness.extentsMm[0] *= 2, /unbound native measurement/],
      ];
      for (const [mutate, reason] of mutations) {
        const planted = structuredClone(row);
        mutate(planted);
        const build = JSON.parse(original);
        build.nativeObservation = planted.nativeObservation;
        fs.writeFileSync(artifact, JSON.stringify(build));
        planted.artifactHashes = artifactHashes(path.dirname(artifact));
        const rejected = verifyExactObservation(zone, planted);
        assert.equal(rejected.ok, false);
        assert.match(rejected.reason, reason);
        fs.writeFileSync(artifact, original);
      }
      if (id === 'AC41') {
        assert.equal(row.nativeValidity, true);
        assert.equal(row.stepValidation.ok, false, 'OCCT healing loss remains disclosed');
        assert.equal(row.stepRoundTrip.unhealedSliver.distinctShellPoints, 8);
      }
    }
    assert.equal(run.status, 0, run.stderr);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
