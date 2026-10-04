import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("rust-r20-export.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { build } = await import("../src/index.mjs");
const { loadKernel } = await import("../src/kernel.mjs");
const { r20Export, R20ExportError } = await import("../src/r20-export.mjs");
const { meshDefects } = await import("../src/print-mesh.mjs");
const { measure } = await import("../scripts/r20/mesh.mjs");
const { isNamedCapabilityRefusal } = await import("../scripts/r20/modules.mjs");









process.env.WONKY_BACKEND = 'rust';
const source = shape => `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export const sample = defineFeature(function(context is Context, id is Id, definition is map) {
  ${shape === 'box'
    ? 'fCuboid(context, id + "solid", { "corner1": vector(0,0,0)*millimeter, "corner2": vector(10,12,14)*millimeter });'
    : 'fCylinder(context, id + "solid", { "bottomCenter": vector(0,0,0)*millimeter, "topCenter": vector(0,0,14)*millimeter, "radius": 3*millimeter });'}
  setProperty(context, { "entities": qCreatedBy(id + "solid", EntityType.BODY),
    "propertyType": PropertyType.NAME, "value": "S01 sample" });
});`;

function storedTriangles(buffer) {
  const count = buffer.readUInt32LE(80);
  assert.equal(buffer.length, 84 + 50 * count);
  return Array.from({ length: count }, (_, i) => Array.from({ length: 3 }, (_, j) =>
    Array.from({ length: 3 }, (_, k) => buffer.readFloatLE(84 + 50 * i + 12 + j * 12 + k * 4))));
}

test('strict Rust R20 exporter publishes a watertight synthetic solid with certified storage bounds', async () => {
  const model = await build(source('box'), { feature: 'sample', trace: false });
  const exported = r20Export(await loadKernel(), model,
    { deviationMm: 0.01, sourcePath: 'sample.fs', source: source('box'), feature: 'sample' });
  const row = exported.manifest.parts.S01;
  assert.equal(row.wonky.exact, true);
  assert.equal(row.wonky.meshDeviationMm, 0.005);
  assert.equal(row.wonky.float32RoundingMm, 0.005);
  assert.equal(row.wonky.achievedDeviationMm, 0.01);
  const bytes = exported.files.find(file => file.name === 'S01.stl').data;
  const triangles = storedTriangles(bytes);
  assert.equal(meshDefects(triangles).watertight, true);
  assert.ok(Math.abs(measure(triangles).volumeMm3 - 1680) < 0.001);
  assert.equal(row.sha256.length, 64);
});

test('strict Rust R20 exporter refuses missing part identity before publishing any mesh', async () => {
  const model = await build(source('cylinder'), { feature: 'sample', trace: false });
  model.bodies[0].name = '';
  const kernel = await loadKernel();
  assert.throws(() => r20Export(kernel, model,
    { deviationMm: 0.01, sourcePath: 'sample.fs', source: source('cylinder'), feature: 'sample' }),
  e => e instanceof R20ExportError && /has no NAME/.test(e.message));
});

test('certified Rust STL preserves a synthetic half-circle boundary', async () => {
  const text = `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export const sample = defineFeature(function(context is Context, id is Id, definition is map) {
  var sk = newSketchOnPlane(context,id+"sk", {"sketchPlane":plane(vector(0,0,0)*meter,vector(0,0,1),vector(1,0,0))});
  skArc(sk,"semicircle",{"start":vector(2,0)*meter,"mid":vector(0,2)*meter,"end":vector(-2,0)*meter});
  skLineSegment(sk,"diameter",{"start":vector(-2,0)*meter,"end":vector(2,0)*meter});
  skSolve(sk);
  opExtrude(context,id+"solid",{"entities":qSketchRegion(id+"sk",false),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":1*meter});
  setProperty(context,{"entities":qCreatedBy(id+"solid",EntityType.BODY),"propertyType":PropertyType.NAME,"value":"S02 semicircle"});
});`;
  const model = await build(text, { feature: 'sample', trace: false });
  const exported = r20Export(await loadKernel(), model,
    { deviationMm: 0.01, sourcePath: 'sample.fs', source: text, feature: 'sample' });
  const triangles = storedTriangles(exported.files.find(file => file.name === 'S02.stl').data);
  assert.equal(meshDefects(triangles).watertight, true);
  assert.ok(Math.abs(measure(triangles).volumeMm3 - 2 * Math.PI * 1e9) < 0.01 * 1e9);
});

test('R20 gate classifies typed Rust refusals, never transport or runtime failures', () => {
  for (const name of ['UnsupportedFeatureError', 'NativeCapabilityError', 'RustCapabilityError'])
    assert.equal(isNamedCapabilityRefusal({ class: name }), true, name);
  for (const name of ['NativeKernelStaleError', 'TypeError', null])
    assert.equal(isNamedCapabilityRefusal({ class: name }), false, String(name));
  assert.equal(isNamedCapabilityRefusal(null), false);
});

}
