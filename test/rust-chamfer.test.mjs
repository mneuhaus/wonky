// FS owns SI transport, query identity and uncaught capability refusals. The
// independent STEP reader owns carrier/trim consistency, not the native tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
process.env.WONKY_BACKEND = 'rust';
const { build } = await import('../src/index.mjs');
const { toStep, toStl } = await import('../src/exporters.mjs');
const { serializeModel } = await import('../src/construction-history.mjs');
const { RustCapabilityError, measureRustBody, rustModelKernel } = await import('../src/native/rust-host.mjs');
const { zoneFrame } = await import('../scripts/acid/common.mjs');
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
    if(size(evaluateQuery(context,qCreatedBy(id+"foot",EntityType.BODY)))!=0)throw "modifying feature incorrectly created a body";
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

// AC49 plate from first principles (mm): 16x12x8 minus an r=2 through-bore;
// width-1 chamfers on the two long top edges (prisms 1/2 x 16 each) and a
// countersink on the top rim (frustum r=2..3 over height 1 minus its core).
// Centroid (8, 6, z): z-moments 6144 (plate), 1751 pi / 12 (bore 128 pi plus the
// frustum's 575 pi / 12 less its r=2 core 30 pi) and 16 * 23/3 (the prisms).
const plate = { volume: 1536 - 32 * Math.PI - 16 - 7 * Math.PI / 3,
  area: 766 + 32 * Math.SQRT2 + 15 * Math.PI + 5 * Math.SQRT2 * Math.PI,
  centroidZ: (6144 - 1751 * Math.PI / 12 - 368 / 3) / (1520 - 103 * Math.PI / 3) };
const acidBoolean = () => fs.readFileSync(path.join(root, 'fixtures/cad-acid/fs/acid-boolean.fs'), 'utf8');
const ac49 = variant => ({ feature: 'acidBoolean', parameters: { zone: 'AcidBooleanZone.AC49', variant: `AcidVariant.${variant}` } });

test('perforated plate: frame-relative queries chamfer two long edges and countersink the top bore in every zone frame', async t => {
  const fixture = acidBoolean();
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/cad-acid/zones.json'), 'utf8'));
  const zone = catalog.zones.find(z => z.id === 'AC49');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wonky-countersink-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  // Local probes: next to a long top edge, a short top edge, a long bottom edge,
  // on the bore axis above the plate (nearest point on the cone generator), in
  // the open bore (its wall) and in the material (distance 0, inside).
  const probes = [[[8, -2, 10], 5 / Math.SQRT2], [[-2, 6, 10], 2 * Math.SQRT2],
    [[8, -2, -2], 2 * Math.SQRT2], [[8, 6, 10], 5 / Math.SQRT2], [[8, 6, 4], 2], [[4, 3, 4], 0]];
  const prefixes = [];
  for (const variant of ['V0', 'V1', 'V2', 'V3']) {
    const model = await build(fixture, ac49(variant));
    assert.equal(model.bodies.length, 1, variant);
    assert.equal(model.bodies[0].validation.certificate, 'PerforatedChamfer', variant);
    const [r, tr] = zoneFrame(catalog, zone, variant);
    const world = p => [0, 1, 2].map(i => r[i][0] * p[0] + r[i][1] * p[1] + r[i][2] * p[2] + tr[i]);
    const inverse = [0, 1, 2].map(i => [...[0, 1, 2].map(j => r[j][i]), -[0, 1, 2].reduce((sum, j) => sum + r[j][i] * tr[j], 0)]);
    const m = measureRustBody(rustModelKernel(model), model.bodies[0], { map: inverse, probes: probes.map(([p]) => world(p)) });
    assert.ok(Math.abs(m.volumeMm3 - plate.volume) <= plate.volume * 1e-9, `${variant} volume ${m.volumeMm3}`);
    assert.ok(Math.abs(m.areaMm2 - plate.area) <= plate.area * 1e-9, `${variant} area ${m.areaMm2}`);
    assert.deepEqual([m.topology.faces, m.topology.edges, m.topology.vertices, m.topology.genus, m.topology.ringEdges],
      [10, 21, 12, 1, 3], variant);
    probes.forEach(([, expected], i) => assert.ok(m.probes[i].inside === (expected === 0)
      && Math.abs(m.probes[i].distanceMm - expected) < 1e-9, `${variant} probe ${i}: ${JSON.stringify(m.probes[i])}`));
    world([8, 6, plate.centroidZ]).forEach((x, k) => assert.ok(Math.abs(m.centroidMm[k] - x) < 1e-9, `${variant} centroid ${k}`));
    for (const [side, expected] of [['min', [0, 0, 0]], ['max', [16, 12, 8]]])
      m.mappedBboxMm[side].forEach((x, k) => assert.ok(Math.abs(x - expected[k]) < 1e-9, `${variant} bbox ${side}`));
    const step = toStep(model, `countersink-${variant}`);
    assert.match(step, /CONICAL_SURFACE/);
    const prefix = path.join(directory, variant);
    fs.writeFileSync(prefix + '.step', step);
    fs.writeFileSync(prefix + '.brep.json', serializeModel(model));
    prefixes.push(prefix);
    const stl = toStl(model);
    const triangles = stl.readUInt32LE(80);
    assert.equal(stl.length, 84 + triangles * 50, `${variant}: complete binary STL`);
    let six = 0;
    for (let i = 0; i < triangles; i++) {
      const [a, b, c] = Array.from({ length: 3 }, (_, j) => Array.from({ length: 3 }, (_, k) =>
        stl.readFloatLE(84 + i * 50 + 12 + 12 * j + 4 * k) - tr[k]));
      six += a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
    }
    assert.ok(Math.abs(six / 6 - plate.volume) < plate.volume * 2e-3, `${variant}: mesh keeps chamfers and countersink (${six / 6})`);
  }
  // OpenCascade as an independent oracle: BRepCheck, closed shells, kernel volume.
  const result = spawnSync('uv', ['run', path.join(root, 'scripts/validate-step.py'), ...prefixes], {
    cwd: root, encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  for (const row of JSON.parse(result.stdout)) assert.ok(row.valid && row.volumeComparedWithKernel, row.file);
});

test('perforated chamfer trims either selection alone and refuses tangent or unrepresentable countersinks by name', async () => {
  const fixture = acidBoolean();
  for (const [entities, volume] of [['lines', 1536 - 32 * Math.PI - 16], ['circles', 1536 - 32 * Math.PI - 7 * Math.PI / 3]]) {
    const model = await build(fixture.replace('"entities" : qUnion([lines, circles])', `"entities" : ${entities}`), ac49('V3'));
    const m = measureRustBody(rustModelKernel(model), model.bodies[0]);
    assert.ok(Math.abs(m.volumeMm3 - volume) <= volume * 1e-9, `${entities}: ${m.volumeMm3}`);
  }
  // Width 2: the countersink ring (radius 4) touches both chamfer planes exactly.
  for (const [width, reason] of [['2', 'chamfer/perforated-bore-face-contact'],
    ['0.1', 'chamfer/perforated-countersink-offset-not-representable']]) {
    const planted = fixture.replace('"width" : 1 * millimeter', `"width" : ${width} * millimeter`);
    assert.notEqual(planted, fixture);
    await assert.rejects(build(planted, ac49('V0')), error => error instanceof RustCapabilityError &&
      error.builtin === 'opChamfer' && error.reason === reason, width);
  }
});

test('overlapping chamfers and unsupported options cannot disappear in try silent', async () => {
  for (const [statement, reason] of [
    [chamfer(20), 'chamfer/face-consumed-or-overlap'],
    [chamfer(1, ',"tangentPropagation":true'), null],
    [chamfer(1).replace('EQUAL_OFFSETS', 'TWO_OFFSETS'), 'chamfer/two-offsets-side-order-unprobed'],
  ]) {
    if(reason===null) {
      const m=await build(source(`try silent { ${statement} }`),{feature:'f'});
      assert.equal(m.bodies.length,1);
      assert.equal(m.bodies[0].validation.faces,7);
      assert.ok(Math.abs(m.bodies[0].validation.volumeMm3-1528)<1e-10);
      continue;
    }
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
