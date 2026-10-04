// The Rust host port on WONKY_BACKEND=rust (src/native/rust-host.mjs,
// host-ops.mjs): sketch, extrude and export of the planar slice through the
// real interpreter, with the Rust addon (node scripts/rust/build-node.mjs).
// Kernel evidence comes from the CAD-Acid harness (scripts/acid/run.mjs); these
// tests pin the host contract: E9 values, refusal names and classes, the
// segment controls through the port, and that the js path is untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The whole file runs on strict rust (src/exporters.mjs reads WONKY_BACKEND at
// import time), so nothing here loads Bend; the modules are imported after.
process.env.WONKY_BACKEND = 'rust';
const { build } = await import('../src/index.mjs');
const { toStep } = await import('../src/exporters.mjs');
const { serializeModel } = await import('../src/construction-history.mjs');
const { FeatureScriptException, UnsupportedFeatureError } = await import('../src/errors.mjs');
const { GeometryRefusal, RustCapabilityError, describeRustBody, measureRustBody, rustModelKernel } = await import('../src/native/rust-host.mjs');
const { HOST_OPERATIONS, guardHostBuiltins } = await import('../src/native/host-ops.mjs');

const root = fileURLToPath(new URL('../', import.meta.url));
const profile = fs.readFileSync(path.join(root, 'fixtures/cad-acid/fs/acid-profile.fs'), 'utf8');
const controls = fs.readFileSync(path.join(root, 'test/fixtures/rust-host/segment-controls.fs'), 'utf8');
const bits = x => { const b = Buffer.alloc(8); b.writeDoubleLE(x); return b.readBigUInt64LE().toString(16).padStart(16, '0'); };

const onRust = fn => fn();
const ac01 = variant => onRust(() => build(profile, { feature: 'acidProfile', parameters: { variant: `AcidVariant.${variant}`, zone: 'AcidProfileZone.AC01' }, trace: false }));
const control = name => onRust(() => build(controls, { feature: 'segmentControl', parameters: { control: `SegmentControl.${name}` }, trace: false }));

for (const silent of [false, true]) test(`AC38 reports a named Rust draft capability refusal, try silent=${silent}`, async () => {
  const { buildWonky } = await import('../scripts/acid/build-wonky.mjs');
  const { CATALOG, loadCatalog, sha256 } = await import('../scripts/acid/common.mjs');
  const { zonesSha256 } = loadCatalog();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rust-draft-refusal-'));
  try {
    let text = fs.readFileSync(path.join(root, 'fixtures/cad-acid/fs/acid-blend-errata.fs'), 'utf8');
    if (silent) text = text.replace(/    opDraft\([\s\S]*?atan\(0\.125\) \}\);/, call => `    try silent {\n${call}\n    }`);
    if (silent) assert.match(text, /try silent \{\s+opDraft/);
    const source = path.join(dir, 'draft.fs');
    fs.writeFileSync(source, text);
    for (const variant of ['V0', 'V1', 'V2', 'V3']) {
      const out = path.join(dir, variant);
      const result = await buildWonky({ source, sourceSha256: sha256(text), zonesSha256,
        catalog: CATALOG, zone: 'AC38', variant, feature: 'acidBlend', out,
        parameters: { zone: 'AcidBlendZone.AC38', variant: `AcidVariant.${variant}` } });
      assert.equal(result.outcome, 'refused', JSON.stringify(result));
      assert.equal(result.error.name, 'NativeCapabilityError');
      assert.equal(result.error.code, 'host/draft/not-ported');
      assert.equal(result.refusal.code, 'host/draft/not-ported');
      assert.equal(result.refusal.builtin, 'opDraft');
      assert.equal(result.refusal.capability, true);
      assert.equal(result.refusal.operationUnderTest, true);
      assert.equal(fs.existsSync(path.join(out, 'model.step')), false);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('AC01 builds on strict rust in V0..V3 with the interpreter values bit for bit (E9)', async () => {
  // fl(k * 0.001) in metres, never mm-rounded (src/values.mjs length()).
  const polygon = [[0, 0], [16, 0], [16, 4], [4, 4], [4, 12], [0, 12]].map(p => p.map(k => bits(k * 0.001)).join(','));
  for (const variant of ['V0', 'V1', 'V2', 'V3']) {
    const model = await ac01(variant);
    assert.equal(model.backend.language, 'Rust');
    assert.equal(model.bodies.length, 1);
    const [body] = model.bodies;
    assert.equal(body.name, `AC01_0_${variant}`);
    assert.equal(body.description, `acid=AC01@${variant}`);
    assert.equal(body.validation.closed, true);
    assert.equal(body.validation.certificate, 'AxisPrism');
    assert.equal(body.validation.boundToConstruction, true);
    assert.ok(Math.abs(body.validation.volumeMm3 - 768) <= 768e-9, `${variant} volume`);
    const wc0 = describeRustBody(rustModelKernel(model), body).body;
    assert.deepEqual(wc0.constructions[4].parameters, [bits(0), bits(8 * 0.001)], `${variant} extrude levels`);
    const region = wc0.constructions[3].parameters;
    const pairs = new Set(region.flatMap((_, i) => i % 2 ? [] : [`${region[i]},${region[i + 1]}`]));
    assert.deepEqual([...pairs].sort(), [...polygon].sort(), `${variant} region`);
    assert.equal(wc0.frames[1].kind, 'Interpreter');
  }
});

test('AC01 exports STEP and a brep.json with the WC0 reading and a Rust projection', async () => {
  const model = await ac01('V1');
  const step = toStep(model, 'ac01');
  assert.equal(step.match(/ADVANCED_FACE\(/g).length, 8);
  assert.equal(step.match(/EDGE_CURVE\(/g).length, 18);
  assert.equal(step.match(/VERTEX_POINT\(/g).length, 12);
  const brep = JSON.parse(serializeModel(model));
  assert.equal(brep.backend.language, 'Rust');
  const [body] = brep.bodies;
  assert.equal(body.faces.length, 8); assert.equal(body.edges.length, 18); assert.equal(body.vertices.length, 12);
  assert.ok(body.validation.toleranceMm > 0 && body.validation.toleranceMm <= 2 ** -35);
  assert.match(body.wc0Sha256, /^[0-9a-f]{64}$/);
  assert.equal(body.wc0.magic, 'WKV3');
  // Beyond the legacy +-10,000 mm envelope: no refusal on the rust path.
  assert.ok(body.vertices.some(v => v[0] > 65536));
});

test('measurements are general and take a frame and probes as data', async () => {
  const model = await ac01('V0');
  const m = measureRustBody(rustModelKernel(model), model.bodies[0], { map: [[1, 0, 0, -1], [0, 1, 0, 0], [0, 0, 1, 0]], probes: [[10, 10, 4], [20, 2, 4], [1, 1, 1]] });
  assert.equal(m.basis, 'native-f64-construction');
  assert.deepEqual(m.mappedBboxMm, { min: [-1, 0, 0], max: [15, 12, 8] });
  assert.deepEqual(m.probes.map(p => p.inside), [false, false, true]);
  for (const [i, expected] of [6, 4, 0].entries()) {
    const probe = m.probes[i];
    assert.ok(probe.boundMm >= 0 && probe.boundMm < 1e-10);
    assert.ok(Math.abs(probe.distanceMm - expected) <= probe.boundMm);
  }
  assert.deepEqual({ ...m.topology }, { bodies: 1, shells: 1, faces: 8, edges: 18, vertices: 12, loops: 8, ringEdges: 0, closedToroidalFaces: 0, genus: 0, singularPoints: 0, pinchPoints: 0 });
});

test('line-segment controls through the port: closed in any order or direction builds, open refuses as the operation under test', async () => {
  for (const name of ['CLOSED', 'SHUFFLED', 'REVERSED']) {
    const model = await control(name);
    assert.equal(model.bodies.length, 1, name);
    assert.equal(model.bodies[0].name, 'control');
    assert.ok(Math.abs(model.bodies[0].validation.volumeMm3 - 512) <= 512e-9, name);
  }
  // AC45's 2^-30 mm gap stays open under exact incidence: opExtrude has no region.
  const open = await control('OPEN').then(() => null, error => error);
  assert.ok(open instanceof GeometryRefusal && open instanceof FeatureScriptException, String(open));
  assert.equal(open.refusalCategory, 'open-profile');
  assert.equal(open.operationUnderTest, true);
  assert.equal(open.builtin, 'opExtrude');
  // Self-touching at a vertex: a capability gap, never a FeatureScript exception.
  const touching = await control('TOUCHING').then(() => null, error => error);
  assert.ok(touching instanceof RustCapabilityError && !(touching instanceof FeatureScriptException), String(touching));
  assert.match(touching.message, /skSolve: sketch\/branching/);
});

test('caught subfeature failures restore Rust sketch geometry before the next solve and extrude', async () => {
  for (const abandoned of [
    'skRectangle(s,"aborted",{"firstCorner":vector(20,20)*millimeter,"secondCorner":vector(24,24)*millimeter});',
    'skCircle(s,"aborted",{"center":vector(20,20)*millimeter,"radius":2*millimeter});',
    `skArc(s,"aborted",{"start":vector(1,2)*meter,"mid":vector(0,1)*meter,"end":vector(1,0)*meter});
      skLineSegment(s,"bottom",{"start":vector(1,0)*meter,"end":vector(9,0)*meter});
      skArc(s,"right",{"start":vector(9,0)*meter,"mid":vector(10,1)*meter,"end":vector(9,2)*meter});
      skLineSegment(s,"top",{"start":vector(9,2)*meter,"end":vector(1,2)*meter});`,
  ]) {
    const source = `FeatureScript 3044;
      import(path : "onshape/std/geometry.fs", version : "3044.0");
      const abort = defineFeature(function(context is Context, id is Id, definition is map) precondition {} {
        const s = definition.sketch;
        ${abandoned}
        skSolve(s);
        throw "abort this sketch edit";
      });
      export const f = defineFeature(function(context is Context, id is Id, definition is map) precondition {} {
        const s = newSketchOnPlane(context,id+"sketch",{"sketchPlane":plane(vector(0,0,0)*millimeter,vector(0,0,1))});
        try silent { abort(context,id+"abort",{"sketch":s}); }
        skRectangle(s,"aborted",{"firstCorner":vector(0,0)*millimeter,"secondCorner":vector(4,4)*millimeter});
        skSolve(s);
        opExtrude(context,id+"e",{"entities":qSketchRegion(id+"sketch"),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":2*millimeter});
      });`;
    const model = await build(source, { feature: 'f' });
    assert.equal(model.bodies.length, 1, abandoned);
    assert.ok(Math.abs(measureRustBody(rustModelKernel(model), model.bodies[0]).volumeMm3 - 32) < 1e-10);
  }
});

// CAD-Acid AC99: two disjoint squares (0,0)-(10,10) and (20,0)-(30,10) in one
// sketch; a point picks regions for opExtrude. V5's qClosestTo over
// qSketchRegion used to fail with an unnamed "expects a topology Query".
test('sketch regions picked by qContainsPoint or qClosestTo extrude exactly the selected regions', async () => {
  const frames = {
    identity: 'coordSystem(vector(0, 0, 0) * millimeter, vector(1, 0, 0), vector(0, 0, 1))',
    // AC99 V3's skew frame: toWorld rounds the point off the rotated plane.
    rotated: 'coordSystem(r * (vector(0, 0, 0) * millimeter), r.linear * vector(1, 0, 0), r.linear * vector(0, 0, 1))',
  };
  const pick = ({ query, point, frame = 'identity', consume = 'opExtrude(context, id + "e", { "entities" : region, "direction" : cs.zAxis, "endBound" : BoundingType.BLIND, "endDepth" : 4 * millimeter });' }) => build(`FeatureScript 3044;
    import(path : "onshape/std/geometry.fs", version : "3044.0");
    export const f = defineFeature(function(context is Context, id is Id, definition is map) precondition {} {
      const r = rotationAround(line(vector(3, -2, 5) * millimeter, vector(1, 2, 3)), 0.1 * radian);
      const cs = ${frames[frame]};
      var s = newSketchOnPlane(context, id + "sketch", { "sketchPlane" : plane(cs.origin, cs.zAxis, cs.xAxis) });
      skRectangle(s, "left", { "firstCorner" : vector(0, 0) * millimeter, "secondCorner" : vector(10, 10) * millimeter });
      skRectangle(s, "right", { "firstCorner" : vector(20, 0) * millimeter, "secondCorner" : vector(30, 10) * millimeter });
      skSolve(s);
      const region = ${query}(qSketchRegion(id + "sketch"), toWorld(cs, vector(${point}) * millimeter));
      ${consume}
    });`, { feature: 'f', trace: false });
  // Each selected square extrudes to its own 400 mm^3 body; identity bodies
  // are named by their minimum x (0 left, 20 right).
  for (const [c, left] of [
    [{ query: 'qClosestTo', point: '25, 5, 0' }, [20]],
    [{ query: 'qContainsPoint', point: '25, 5, 0' }, [20]],
    [{ query: 'qContainsPoint', point: '20, 5, 0' }, [20]], // a region is closed
    [{ query: 'qClosestTo', point: '15, 5, 0' }, [0, 20]], // equally far: both
    [{ query: 'qClosestTo', point: '25, 5, 1' }, [20]], // off the plane: still closest
  ]) {
    const model = await pick(c);
    assert.deepEqual(model.bodies.map(b => Math.round(b.validation.boundsMm.min[0])).sort((a, b) => a - b), left, JSON.stringify(c));
    for (const body of model.bodies) assert.ok(Math.abs(body.validation.volumeMm3 - 400) <= 400e-9, JSON.stringify(c));
  }
  const rotated = await pick({ query: 'qContainsPoint', point: '25, 5, 0', frame: 'rotated' });
  assert.equal(rotated.bodies.length, 1);
  assert.ok(Math.abs(rotated.bodies[0].validation.volumeMm3 - 400) <= 400e-9);
  // 1 mm above the plane no region contains the point: opExtrude has nothing to extrude.
  const none = await pick({ query: 'qContainsPoint', point: '25, 5, 1' }).then(() => null, e => e);
  assert.ok(none instanceof GeometryRefusal, String(none));
  assert.equal(none.refusalCategory, 'empty-region');
  assert.match(none.message, /selects no region/);
  // Another consumer refuses the selection by name instead of using every region.
  const revolve = await pick({ query: 'qClosestTo', point: '25, 5, 0',
    consume: 'opRevolve(context, id + "r", { "entities" : region, "axis" : line(vector(0, -5, 0) * millimeter, vector(1, 0, 0)), "angleForward" : 90 * degree });' }).then(() => null, e => e);
  assert.ok(revolve instanceof RustCapabilityError, String(revolve));
  assert.equal(revolve.reason, 'sketch-region/point-selection-outside-extrude');
});

test('ported loft refuses absent profiles by name before publishing a body', async () => {
  const source = `FeatureScript 3044;\nimport(path : "onshape/std/geometry.fs", version : "3044.0");\nexport const f = defineFeature(function(context is Context, id is Id, definition is map) precondition {} {\n opLoft(context, id + "loft", { "profileSubqueries" : [] });\n});`;
  const error = await onRust(() => build(source, { feature: 'f', trace: false })).then(() => null, e => e);
  assert.ok(error instanceof RustCapabilityError, String(error));
  assert.equal(error.reason, 'loft/two-profiles-required');
  for (const name of ['instantiate', 'opTransform', 'opDeleteBodies', 'fCuboid', 'opBoolean', 'evVolume']) assert.ok(HOST_OPERATIONS[name], name);
});

test('a Rust body has no legacy B-rep view; the js path builtins are untouched', async () => {
  const model = await ac01('V2');
  for (const field of ['vertices', 'edges', 'faces', 'shell']) assert.throws(() => model.bodies[0][field], UnsupportedFeatureError);
  const values = { opExtrude: { type: 'builtin', call: () => 1 } };
  assert.equal(guardHostBuiltins(values, {}, false, {}), values);
  assert.equal(values.opExtrude.call(), 1);
});

test('strict rust never loads Bend for AC01 (R20 load guard)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rust-host-'));
  const log = path.join(dir, 'guard.json');
  const script = `const {build}=await import(${JSON.stringify(path.join(root, 'src/index.mjs'))});const fs=await import('node:fs');` +
    `await build(fs.readFileSync(${JSON.stringify(path.join(root, 'fixtures/cad-acid/fs/acid-profile.fs'))},'utf8'),{feature:'acidProfile',parameters:{variant:'AcidVariant.V3',zone:'AcidProfileZone.AC01'}});`;
  const r = spawnSync(process.execPath, ['--import', path.join(root, 'scripts/r20/bend-guard.mjs'), '--input-type=module', '-e', script],
    { cwd: root, encoding: 'utf8', env: { ...process.env, WONKY_BACKEND: 'rust', WONKY_BEND_GUARD_LOG: log } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(fs.readFileSync(log, 'utf8')).summary.bendLoaded, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the N-API host and WC0 entries enforce initialization, argument types and canonical transport', async () => {
  const { locateRustBuild } = await import('../src/native/rust-kernel.mjs');
  const { rustBodyWords } = await import('../src/native/rust-host.mjs');
  const body = rustBodyWords((await ac01('V0')).bodies[0]);
  // Fresh process: the public initialization contract cannot be observed after
  // this file's earlier interpreter builds have initialized the shared addon.
  const script = `
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const words = Uint32Array.from(JSON.parse(fs.readFileSync(0, 'utf8')));
    const module = { exports: {} };
    process.dlopen(module, ${JSON.stringify(path.join(locateRustBuild().dir, 'wonky-node.node'))});
    const a = module.exports;
    for (const op of ['hostOp', 'wireV3', 'wireV3Json']) {
      assert.throws(() => a[op](words), { code: 'BX_POISONED' });
    }
    a.init({ threads: 1 });
    assert.deepEqual(a.info().wireVersions, [1, 2, 3]);
    assert.equal(a.info().hostOpVersion, 1);
    for (const op of ['hostOp', 'wireV3', 'wireV3Json']) {
      assert.throws(() => a[op](), { code: 'BX_ARGS' });
      for (const bad of [[], new Float64Array(2), null]) {
        assert.throws(() => a[op](bad), { code: 'BX_ARGS' });
      }
    }
    assert.deepEqual([...a.wireV3(words)], [0, ...words]);
    const body = JSON.parse(a.wireV3Json(words)).body;
    assert.equal(body.frames[1].kind, 'Interpreter');
    assert.equal(a.wireV3(new Uint32Array())[0], 1);
    assert.throws(() => a.wireV3Json(new Uint32Array()), { code: 'BX_WIRE' });
    assert.equal(a.hostOp(new Uint32Array())[0], 1);
    const calls = a.stats().calls;
    const r = a.hostOp(Uint32Array.from([0x31484b57, 1, 1, 0]));
    assert.equal(r[0], 7);
    assert.match(String.fromCodePoint(...r.slice(1)), /sketch\\/invalid/);
    assert.equal(a.stats().calls, calls + 1);
  `;
  const run = spawnSync(process.execPath, ['-e', script], {
    cwd: root, encoding: 'utf8', input: JSON.stringify([...body]), timeout: 30000,
    env: { ...process.env, WONKY_BACKEND: 'rust', NODE_OPTIONS: '--max-old-space-size=8192' },
  });
  assert.equal(run.status, 0, run.stderr);
});
