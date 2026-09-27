import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildWonky} from '../scripts/acid/build-wonky.mjs';
import {geometryDigest} from '../scripts/acid/bench-report.mjs';
import {CATALOG, ROOT, loadCatalog, readJSON, sha256, writeJSON} from '../scripts/acid/common.mjs';
import {observationProbes} from '../scripts/acid/evidence.mjs';
import {assertValidTimedNativeObservation} from '../scripts/acid/native-observation.mjs';

const {catalog, zonesSha256} = loadCatalog();
const worker = fileURLToPath(new URL('../scripts/acid/bench-wonky.mjs', import.meta.url));

for (const [id, kind, variant = 'V0'] of [
  ['AC09', 'bodyDistance'], ['AC39', 'bodyDistance'], ['AC01', 'probeDistance'], ['AC41', 'bboxExtent'],
  ['AC39', 'bodyDistance', 'V3'], ['AC41', 'bboxExtent', 'V3'],
]) {
  test(`Rust timed request observes scored ${kind} for ${id}/${variant} (one warmup, one rep)`, async () => {
    process.env.WONKY_BACKEND = 'rust';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acid-probes-'));
    try {
      const group = catalog.groups.find(g => g.zoneIds.includes(id));
      const source = path.join(ROOT, group.fs);
      const zone = catalog.zones.find(z => z.id === id);
      const probes = observationProbes(zone);
      const names = probes.map(p => p.name);
      assert.ok(probes.some(p => p.definition.kind === kind), `${id} must exercise ${kind}`);
      const request = {zone: id, variant, catalog: CATALOG, zonesSha256, source,
        sourceSha256: sha256(fs.readFileSync(source)), out: path.join(dir, 'timed'),
        result: path.join(dir, 'timed', 'warm.json'), reps: 1,
        feature: group.featureScript.customFeature,
        parameters: {variant: `AcidVariant.${variant}`, zone: `${group.featureScript.parameters.zone.type.replace('enum ', '')}.${id}`}};
      const manifest = path.join(path.dirname(source), 'modules.json');
      if (fs.existsSync(manifest)) request.moduleManifest = manifest;
      fs.mkdirSync(request.out);
      const file = path.join(dir, 'request.json');
      writeJSON(file, request);
      const child = spawnSync(process.execPath, [worker, file], {cwd: ROOT, encoding: 'utf8', timeout: 180_000,
        env: {...process.env, NODE_OPTIONS: '--max-old-space-size=8192',
          WONKY_BEND_GUARD_LOG: path.join(dir, 'guard.json')}});
      assert.equal(child.status, 0, `timed request failed: ${child.error?.message ?? ''}\n${child.stderr}`);
      assert.equal(readJSON(path.join(dir, 'guard.json')).summary.bendLoaded, false);
      const timed = readJSON(request.result);
      assert.equal(timed.samples.length, 1);
      assert.ok(timed.warmup.measurementMs >= 0);
      assert.ok(timed.samples[0].measurementMs >= 0);

      const scored = await buildWonky({...request, out: path.join(dir, 'scored')});
      assert.equal(scored.outcome, 'built', JSON.stringify(scored.error));
      assert.equal(scored.builtBeforeFailure, undefined);
      assertValidTimedNativeObservation(scored.nativeObservation, zone);
      for (const {name, definition} of probes) {
        assert.ok(Number.isFinite(scored.metrics.measurements[name]), `${name} must be measured`);
        if (definition.kind !== 'probeDistance')
          assert.equal(scored.nativeObservation.measurementEvidence[name].kind, definition.kind);
      }
      for (const sample of [timed.warmup, ...timed.samples]) {
        assert.equal(sample.observationSha256, geometryDigest(scored.nativeObservation.metrics));
        assert.equal(sample.observationSha256, geometryDigest(sample.observation));
        assert.equal(sample.volume, scored.nativeObservation.metrics.volume);
        assert.deepEqual(Object.keys(sample.observation.measurements).sort(), [...names].sort());
        assert.deepEqual(sample.observation.measurements, scored.nativeObservation.metrics.measurements);
        assert.deepEqual(sample.observation.measurementErrors, scored.nativeObservation.metrics.measurementErrors);
        assert.deepEqual(sample.observation.measurementEvidence, scored.nativeObservation.measurementEvidence);
      }

      if (id === 'AC09' && variant === 'V0') {
        const badCatalog = structuredClone(catalog);
        const badZone = badCatalog.zones.find(z => z.id === id);
        const badSelector = observationProbes(badZone).find(p => p.definition.kind === 'bodyDistance');
        badSelector.definition.bodyA = [1_000_000, 1_000_000, 1_000_000];
        const badCatalogPath = path.join(dir, 'bad-catalog.json');
        writeJSON(badCatalogPath, badCatalog);
        const badResult = path.join(request.out, 'invalid.json');
        writeJSON(file, {...request, catalog: badCatalogPath, result: badResult});
        const badGuardLog = path.join(dir, 'bad-guard.json');
        const rejected = spawnSync(process.execPath, [worker, file], {cwd: ROOT, encoding: 'utf8', timeout: 180_000,
          env: {...process.env, NODE_OPTIONS: '--max-old-space-size=8192', WONKY_BEND_GUARD_LOG: badGuardLog}});
        assert.notEqual(rejected.status, 0, 'worker must reject a misbound body selector');
        assert.match(rejected.stderr, /TIMED_NATIVE_OBSERVATION_INVALID/);
        assert.equal(readJSON(badGuardLog).summary.bendLoaded, false);
        assert.equal(fs.existsSync(badResult), false, 'invalid observation must not produce a timed sample');
      }

      // No digest-only success: even matching topology/volume/bbox is invalid
      // when an observation is missing, refused or reports an invalid body.
      const bad = structuredClone(scored.nativeObservation);
      const measured = bad.metrics.measurements[names[0]];
      delete bad.metrics.measurements[names[0]];
      assert.throws(() => assertValidTimedNativeObservation(bad, zone), /TIMED_NATIVE_OBSERVATION_INVALID/);
      bad.metrics.measurements[names[0]] = measured;
      bad.metrics.measurementErrors[names[0]] = 'selector mismatch';
      assert.throws(() => assertValidTimedNativeObservation(bad, zone), /TIMED_NATIVE_OBSERVATION_INVALID/);
      bad.metrics.measurementErrors = {};
      if (bad.bodies[0].probes.length) {
        bad.bodies[0].probes[0].refused = 'unavailable';
        assert.throws(() => assertValidTimedNativeObservation(bad, zone), /TIMED_NATIVE_OBSERVATION_INVALID/);
        bad.bodies[0].probes[0].refused = null;
      } else {
        bad.measurementEvidence[names[0]].refused = 'unavailable';
        assert.throws(() => assertValidTimedNativeObservation(bad, zone), /TIMED_NATIVE_OBSERVATION_INVALID/);
        delete bad.measurementEvidence[names[0]].refused;
      }
      assert.doesNotThrow(() => assertValidTimedNativeObservation(bad, zone));
      bad.metrics.validity.brep = false;
      assert.throws(() => assertValidTimedNativeObservation(bad, zone), /TIMED_NATIVE_OBSERVATION_INVALID/);
    } finally {
      fs.rmSync(dir, {recursive: true, force: true});
    }
  });
}
