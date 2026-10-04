// Real FeatureScript profiles through the strict Rust host, WC0 replay,
// independent STEP validation, and an explicitly non-planar ruled quad.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
process.env.WONKY_BACKEND = 'rust';
const { build } = await import('../src/index.mjs');
const { toStep } = await import('../src/exporters.mjs');
const { serializeModel } = await import('../src/construction-history.mjs');
const { measureRustBody, rustModelKernel, RustCapabilityError } = await import('../src/native/rust-host.mjs');
const root = fileURLToPath(new URL('../', import.meta.url));
const profile = fs.readFileSync(path.join(root, 'fixtures/cad-acid/fs/acid-profile.fs'), 'utf8');
const ac05 = variant => build(profile, { feature: 'acidProfile', parameters: { variant: `AcidVariant.${variant}`, zone: 'AcidProfileZone.AC05' }, trace: false });

test('AC05 V0–V3 carry exact planar faces, replayed WC0, volume and point distances', async () => {
  for (const variant of ['V0', 'V1', 'V2', 'V3']) {
    const model = await ac05(variant);
    assert.equal(model.backend.language, 'Rust');
    assert.equal(model.bodies.length, 1);
    const [body] = model.bodies;
    assert.equal(body.validation.certificate, 'RuledPlanarLoft');
    assert.equal(body.validation.closed, true);
    assert.equal(body.validation.boundToConstruction, true);
    assert.ok(Math.abs(body.validation.volumeMm3 - 224) <= 224e-9, variant);
    const m = measureRustBody(rustModelKernel(model), body);
    assert.equal(m.certificate, 'RuledPlanarLoft');
    assert.equal(m.axis, null);
    assert.equal(m.topology.faces, 6);
    assert.equal(m.topology.edges, 12);
    const exported = JSON.parse(serializeModel(model)).bodies[0];
    assert.equal(exported.faces.length, 6);
    assert.equal(exported.vertices.length, 8);
    assert.equal(exported.wc0.body.surfaces.length, 6);
    assert.ok(exported.wc0.body.surfaces.every(s => s.geometry.kind === 'Plane'));
    assert.match(exported.wc0Sha256, /^[a-f0-9]{64}$/);
    assert.equal(toStep(model).match(/ADVANCED_FACE\(/g)?.length, 6);
  }
});

test('AC05 STEP is independently readable as one closed solid', async t => {
  const model = await ac05('V0');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wonky-loft-step-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const prefix = path.join(dir, 'loft');
  fs.writeFileSync(`${prefix}.step`, toStep(model, 'loft'));
  fs.writeFileSync(`${prefix}.brep.json`, serializeModel(model));
  const result = spawnSync('uv', ['run', path.join(root, 'scripts/validate-step.py'), prefix], {
    cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  assert.equal(JSON.parse(result.stdout).length, 1);
});

const twisted = `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export const f = defineFeature(function(context is Context, id is Id, definition is map) precondition {} {
  const cs = coordSystem(vector(0,0,0)*millimeter, vector(1,0,0), vector(0,0,1));
  var bottom = newSketchOnPlane(context,id+"bottom",{"sketchPlane":plane(cs.origin,cs.zAxis,cs.xAxis)});
  skRectangle(bottom,"section",{"firstCorner":vector(0,0)*millimeter,"secondCorner":vector(8,8)*millimeter});
  skSolve(bottom);
  var top = newSketchOnPlane(context,id+"top",{"sketchPlane":plane(toWorld(cs,vector(0,0,6)*millimeter),cs.zAxis,cs.xAxis)});
  skPolyline(top,"section",{"points":[vector(2,2)*millimeter,vector(6,2)*millimeter,vector(7,6)*millimeter,vector(2,6)*millimeter,vector(2,2)*millimeter]});
  skSolve(top);
  opLoft(context,id+"solid",{"profileSubqueries":[qSketchRegion(id+"bottom",false),qSketchRegion(id+"top",false)]});
});`;

test('a twisted ruled quad refuses at the loft operation, including inside try silent', async () => {
  for (const source of [twisted, twisted.replace('opLoft(context,id+"solid",', 'try silent { opLoft(context,id+"solid",').replace('qSketchRegion(id+"top",false)]});', 'qSketchRegion(id+"top",false)]}); }')]) {
    await assert.rejects(build(source, { feature: 'f', trace: false }), e =>
      e instanceof RustCapabilityError && e.reason === 'loft/non-planar-ruled-face');
  }
});
