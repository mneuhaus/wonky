// FS owns SI transport, query identity and uncaught capability refusals. The
// independent STEP reader owns carrier/trim consistency, not the native tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
process.env.WONKY_BACKEND = 'rust';
const { build } = await import('../src/index.mjs');
const { toStep } = await import('../src/exporters.mjs');
const { serializeModel } = await import('../src/construction-history.mjs');
const { RustCapabilityError } = await import('../src/native/rust-host.mjs');
const root = fileURLToPath(new URL('../', import.meta.url));
const example = fs.readFileSync(path.join(root, 'examples/tea-box-chamfer.fs'), 'utf8');
const source = statements => `FeatureScript 3000;
import(path : "onshape/std/geometry.fs", version : "3000.0");
export const f = defineFeature(function(context is Context, id is Id, definition is map) precondition {} {
  fCuboid(context,id+"box",{"corner1":vector(0,0,0)*millimeter,"corner2":vector(16,12,8)*millimeter});
  const body=qCreatedBy(id+"box",EntityType.BODY);
  const edge=qClosestTo(qOwnedByBody(body,EntityType.EDGE),vector(8,0,0)*millimeter);
  ${statements}
});`;
const chamfer = (width, extras = '') => `opChamfer(context,id+"foot",{"entities":edge,"chamferType":ChamferType.EQUAL_OFFSETS,"width":${width}*millimeter${extras}});`;

test('native chamfer preserves body lineage and metadata while invalidating old topology', async () => {
  const model = await build(source(`
    setProperty(context,{"entities":body,"propertyType":PropertyType.NAME,"value":"Foot"});
    ${chamfer(0.42)}
    if(size(evaluateQuery(context,body))!=1)throw "old body identity lost";
    if(size(evaluateQuery(context,qCreatedBy(id+"foot",EntityType.BODY)))!=1)throw "new body identity lost";
    if(size(evaluateQuery(context,qOwnedByBody(body,EntityType.FACE)))!=7)throw "chamfer face missing";
  `), { feature: 'f' });
  assert.equal(model.backend.language, 'Rust');
  assert.equal(model.bodies.length, 1);
  const body = model.bodies[0];
  assert.equal(body.name, 'Foot');
  assert.equal(body.validation.certificate, 'PlanarChamfer');
  // Transport regression: 0.42mm must not become 0.42m or a rounded-mm input.
  assert.ok(Math.abs(body.validation.volumeMm3 - (16 * 12 * 8 - 16 * 0.42 ** 2 / 2)) < 1e-10);
  await assert.rejects(build(source(`const old=evaluateQuery(context,edge)[0];${chamfer(0.42)}evaluateQuery(context,old);`), { feature: 'f' }),
    error => error instanceof RustCapabilityError && error.reason === 'stale-topology-reference');
});

test('overlapping chamfers and unsupported options cannot disappear in try silent', async () => {
  for (const [statement, reason] of [
    [chamfer(20), 'chamfer/face-consumed-or-overlap'],
    [chamfer(1, ',"tangentPropagation":true'), 'chamfer/tangent-propagation-unimplemented'],
    [chamfer(1).replace('EQUAL_OFFSETS', 'TWO_OFFSETS'), 'chamfer/requires-equal-offsets'],
  ]) {
    await assert.rejects(build(source(`try silent { ${statement} }`), { feature: 'f' }),
      error => error instanceof RustCapabilityError && error.builtin === 'opChamfer' && error.reason === reason);
  }
});

test('Boolean foot and three-edge corner planes survive independent STEP reimport at their stated budgets', async () => {
  const dir = fs.mkdtempSync(path.join(root, 'tmp/chamfer-step-'));
  try {
    const prefixes = [];
    const pose = 'toWorld(coordSystem(vector(65536.25,-32768.5,16384.125)*millimeter,vector(0,0,1),vector(0,-1,0)))';
    const placedTea = example.replace('        const body =', `        opTransform(context,id+"pose",{"bodies":qCreatedBy(id+"outer",EntityType.BODY),"transform":${pose}});
        const body =`).replace('vector(p[0], p[1], zero)', `${pose} * vector(p[0],p[1],zero)`);
    const allEdges = chamfer(0.42).replace('"entities":edge', '"entities":qOwnedByBody(body,EntityType.EDGE)');
    const cases = [
      ['tea-origin', example, 'teaBox'],
      ['tea-placed', placedTea, 'teaBox'],
      ['corners-origin', source(allEdges), 'f'],
      ['corners-placed', source(`opTransform(context,id+"pose",{"bodies":body,"transform":${pose}});${allEdges}`), 'f'],
    ];
    for (const [name, input, feature] of cases) {
      const model = await build(input, { feature });
      assert.equal(model.bodies.length, 1);
      assert.equal(model.bodies[0].validation.certificate, 'PlanarChamfer');
      const prefix = path.join(dir, name);
      fs.writeFileSync(prefix + '.step', toStep(model, name));
      fs.writeFileSync(prefix + '.brep.json', serializeModel(model));
      prefixes.push(prefix);
    }
    const result = spawnSync('uv', ['run', path.join(root, 'scripts/validate-step.py'), ...prefixes], {
      cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024,
    });
    assert.equal(result.status, 0, result.stderr || String(result.error));
    const rows = JSON.parse(result.stdout);
    assert.equal(rows.length, cases.length);
    for (const row of rows) assert.equal(row.valid, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
