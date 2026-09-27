// Frontend transport/lifecycle owner; analytic mathematics is independently
// covered by Rust rational properties and the CAD-Acid/OCCT export checks.
import test from 'node:test';
import assert from 'node:assert/strict';
process.env.WONKY_BACKEND = 'rust';
const { build } = await import('../src/index.mjs');
const { measureRustBody, rustModelKernel, GeometryRefusal, RustCapabilityError } = await import('../src/native/rust-host.mjs');
const { serializeModel } = await import('../src/construction-history.mjs');
const { toStep } = await import('../src/exporters.mjs');

const source = ({ major = 11, minor = 3, height = 7, angle = '360 * degree', extra = '', cleanup = true } = {}) => `
FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export const ring = defineFeature(function(context is Context, id is Id, definition is map) {
    const origin = vector(65550.125, -42121.0625, 5555.25) * millimeter;
    var sk = newSketchOnPlane(context, id + "sk", { "sketchPlane" : plane(origin, vector(0,-1,0), vector(1,0,0)) });
    skCircle(sk, "disk", { "center" : vector(${major},${height}) * millimeter, "radius" : ${minor} * millimeter });
    ${extra}
    skSolve(sk);
    opRevolve(context, id + "body", { "entities" : qSketchRegion(id + "sk", false), "axis" : line(origin, vector(0,0,1)), "angleForward" : ${angle} });
    ${cleanup ? 'opDeleteBodies(context, id + "cleanup", { "entities":qCreatedBy(id + "sk", EntityType.BODY) });' : ''}
});`;
const run = options => build(source(options), { feature: 'ring', trace: false });

test('disk revolution travels through the strict host and exports analytic seam charts', async () => {
  const model = await run();
  assert.equal(model.backend.language, 'Rust'); assert.equal(model.bodies.length, 1);
  const m = measureRustBody(rustModelKernel(model), model.bodies[0]);
  assert.equal(m.certificate, 'RingTorus'); assert.equal(m.boundToConstruction, true);
  assert.equal(m.topology.genus, 1); assert.equal(m.topology.edges, 0);
  assert.ok(Math.abs(m.volumeMm3 - 2 * Math.PI ** 2 * 11 * 9) <= m.volumeMm3 * m.volumeRelBound);
  assert.ok(m.volumeEnclosureMm3[0] <= m.volumeMm3 && m.volumeMm3 <= m.volumeEnclosureMm3[1]);
  // E9 basis is fl(mm * 0.001), not the original decimal in millimetres.
  for (const [k, expected] of [65550.125, -42121.0625, 5562.25].entries()) assert.ok(Math.abs(m.centroidMm[k] - expected) <= m.toleranceMm);
  const exported = JSON.parse(serializeModel(model)).bodies[0];
  assert.equal(exported.faces.length, 1); assert.equal(exported.vertices.length, 1); assert.equal(exported.edges.length, 2);
  assert.equal(exported.wc0.body.surfaces[0].geometry.kind, 'Torus');
  const step = toStep(model, "ring 'quoted'");
  assert.match(step, /TOROIDAL_SURFACE\(/); assert.equal(step.match(/SEAM_CURVE\(/g)?.length, 2);
});

test('a shared interpreter frame carries the meridian and axis without float incidence tests', async () => {
  // Transport owner: the frame identity must survive FS function arguments,
  // cross/negation, plane/line normalization and the host request. Rebuilding
  // an almost identical axis has no such construction witness.
  const shared = source().replace(
    'var sk = newSketchOnPlane(context, id + "sk", { "sketchPlane" : plane(origin, vector(0,-1,0), vector(1,0,0)) });',
    `const cs = coordSystem(origin, vector(1, 2, 3), vector(-2, 1, 0));
     var sk = newSketchOnPlane(context, id + "sk", { "sketchPlane" : plane(cs.origin, -cross(cs.zAxis, cs.xAxis), cs.xAxis) });`,
  ).replace('line(origin, vector(0,0,1))', 'line(cs.origin, cs.zAxis)');
  const model = await build(shared, { feature: 'ring', trace: false });
  const m = measureRustBody(rustModelKernel(model), model.bodies[0]);
  assert.equal(model.bodies.length, 1);
  assert.equal(m.topology.genus, 1);
  assert.ok(m.frame.orthonormalityDefect > 0);
  assert.ok(m.volumeEnclosureMm3[0] <= 2 * Math.PI ** 2 * 11 * 9);
  assert.ok(m.volumeEnclosureMm3[1] >= 2 * Math.PI ** 2 * 11 * 9);
  assert.match(toStep(model), /TOROIDAL_SURFACE\(/);
  await assert.rejects(build(shared.replace('line(cs.origin, cs.zAxis)',
    'line(cs.origin, cs.zAxis + vector(0, 0, 1e-15))'), { feature: 'ring', trace: false }),
  e => e instanceof RustCapabilityError && e.reason === 'revolve/axis-frame-proof-unavailable');
});

test('origin contact is a geometric refusal, not an unsupported-operation refusal', async () => {
  await assert.rejects(run({ major: 3, minor: 3, height: 0 }), e => e instanceof GeometryRefusal && e.refusalCategory === 'singular-geometry' && e.builtin === 'opRevolve' && e.operationUnderTest === true);
  await assert.rejects(run({ angle: '6.283185307179587 * radian' }), e => e instanceof RustCapabilityError && e.reason === 'revolve/partial-circle-angle');
});

test('a circle cannot silently discard open wires or another disk', async () => {
  await assert.rejects(run({ extra: 'skLineSegment(sk, "line", {"start":vector(0,0)*millimeter,"end":vector(1,0)*millimeter});' }), /circle-profile\/one-rectangle-required/);
  await assert.rejects(run({ extra: 'skCircle(sk, "second", {"center":vector(20,0)*millimeter,"radius":2*millimeter});' }), /sketch\/multiple-circle-arrangement/);
  // Successful circle extrusion is owned by rust-cylinder.test.mjs now.
});

test('polygon revolve survives strict-host transport, serialization and exact angle refusal', async () => {
  // Transport risk distinct from the Rust geometry owner: the segment payload,
  // shared construction frame and observation fields must reach serialization.
  const sector = source({angle:'90 * degree'}).replace(
    'var sk = newSketchOnPlane(context, id + "sk", { "sketchPlane" : plane(origin, vector(0,-1,0), vector(1,0,0)) });',
    'const cs = coordSystem(origin, vector(1,0,0), vector(0,0,1)); var sk = newSketchOnPlane(context, id + "sk", { "sketchPlane" : plane(cs.origin, -cross(cs.zAxis, cs.xAxis), cs.xAxis) });',
  ).replace('line(origin, vector(0,0,1))','line(cs.origin, cs.zAxis)').replace(
    /skCircle\(sk, "disk", .*?\);/,
    'skRectangle(sk, "profile", {"firstCorner":vector(3, -2)*millimeter,"secondCorner":vector(9, 5)*millimeter});',
  );
  const model = await build(sector, {feature:'ring',trace:false});
  const record = JSON.parse(serializeModel(model));
  assert.equal(record.bodies.length,1);
  assert.equal(record.bodies[0].faces.length,6);
  assert.equal(record.bodies[0].edges.length,12);
  assert.equal(record.bodies[0].vertices.length,8);
  assert.equal(record.bodies[0].referenceMeasurements.faceAreasMm2.length,6);
  const m = measureRustBody(rustModelKernel(model),model.bodies[0]);
  assert.ok(Math.abs(m.volumeMm3 - Math.PI/4*(81-9)*7) <= m.volumeMm3*m.volumeRelBound);
  assert.match(toStep(model), /CYLINDRICAL_SURFACE\(/);
  await assert.rejects(build(sector.replace('90 * degree','1.5707963267948968 * radian'), {feature:'ring',trace:false}),
    e=>e instanceof RustCapabilityError && e.reason==='revolve/sector/partial-angle-not-quarter-turn');
});
