// Frontend transport/lifecycle owner; analytic mathematics is independently
// covered by Rust rational properties and the CAD-Acid/OCCT export checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
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
  const m = measureRustBody(rustModelKernel(model), model.bodies[0], {surfaceTypes:true});
  assert.deepEqual(m.surfaceTypes, {Torus:1});
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

// Primary owner for full-profile transport: no coordSystem witness is supplied.
// Regressions: refusing independently constructed, exactly coincident axes;
// dropping sloped segments; failing lifecycle queries/export after construction.
// Existing disk/quarter-sector tests do not exercise any of these contracts.
test('full polygon revolution preserves an axial profile in a rotated sketch frame', async () => {
  const text = `FeatureScript 3044;
  import(path : "onshape/std/geometry.fs", version : "3044.0");
  export const profile = defineFeature(function(context is Context, id is Id, definition is map) {
    const o = vector(32,-16,8)*millimeter;
    const axis = vector(1,2,3);
    var sk = newSketchOnPlane(context,id+"sk",{"sketchPlane":plane(o,cross(axis,vector(-2,1,0)),axis)});
    const points = [vector(-2,0),vector(-2,5),vector(0,5),vector(3,2),vector(10,2),vector(10,0)];
    for (var i=0;i<size(points);i+=1)
      skLineSegment(sk,"s"~i,{"start":points[i]*millimeter,"end":points[(i+1)%size(points)]*millimeter});
    skSolve(sk);
    opRevolve(context,id+"body",{"entities":qSketchRegion(id+"sk",false),"axis":line(o,axis),"angleForward":360*degree});
    if (size(evaluateQuery(context,qCreatedBy(id+"body",EntityType.BODY))) != 1) throw regenError("missing body");
    opDeleteBodies(context,id+"clean",{"entities":qCreatedBy(id+"sk",EntityType.BODY)});
  });`;
  const model = await build(text,{feature:'profile',trace:false});
  assert.equal(model.bodies.length,1);
  const m=measureRustBody(rustModelKernel(model),model.bodies[0]);
  // Independent washer/frustum decomposition: 2*25 + 3*(25+10+4)/3 + 7*4.
  assert.ok(Math.abs(m.volumeMm3-117*Math.PI) <= m.volumeMm3*m.volumeRelBound);
  assert.equal(m.topology.faces,5);
  const record=JSON.parse(serializeModel(model)).bodies[0];
  assert.equal(record.wc0.body.surfaces.filter(s=>s.geometry.kind==='ConeMeridian').length,1);
  assert.match(toStep(model),/CONICAL_SURFACE\(/);
  // Distinct risk: OCCT must consume the emitted cone/seam charts without
  // healing beyond the source-frame export budget, not just see our metrics.
  const dir=fs.mkdtempSync(path.join(root,'tmp/revolve-step-'));
  const prefixes=[];
  for (const [name,input] of [
    ['contracting',text],
    ['expanding',text.replaceAll('vector(-2,5),vector(0,5),vector(3,2),vector(10,2)', 'vector(-2,2),vector(0,2),vector(3,5),vector(10,5)')],
    ['annular',text.replace('vector(-2,0)','vector(-2,1)').replace('vector(10,0)','vector(10,1)')],
    ['offset-axis',text.replace('vector(1,2,3)','vector(1,0,0)').replaceAll('*millimeter','*meter/1024')
      .replace('line(o,axis)','line(o + vector(0,-2,0)*meter/1024,axis)')],
    ['shifted-anchor',text.replace('vector(32,-16,8)','vector(0,0,0)')
      .replace('var sk = newSketchOnPlane(context,id+"sk",{"sketchPlane":plane(o,cross(axis,vector(-2,1,0)),axis)});',
        'const p = plane(o,cross(axis,vector(-2,1,0)),axis); var sk = newSketchOnPlane(context,id+"sk",{"sketchPlane":p});')
      .replace('line(o,axis)','line(p.x * meter/1024,axis)')],
    // Export ownership: unlike single-carrier fixtures this catches rejected or
    // dropped siblings, renumbered STEP references, and cylinder chart coercion
    // to Z-only/one-frame geometry. No new production seam is needed.
    ['mixed',text.replace('const o =', `
      fCuboid(context,id+"box",{"corner1":vector(-20,-20,-20)*millimeter,"corner2":vector(-10,-10,-10)*millimeter});
      fCylinder(context,id+"x",{"bottomCenter":vector(0,0,0)*millimeter,"topCenter":vector(8,0,0)*millimeter,"radius":2*millimeter});
      fCylinder(context,id+"y",{"bottomCenter":vector(0,20,0)*millimeter,"topCenter":vector(0,28,0)*millimeter,"radius":3*millimeter});
      opPattern(context,id+"copy",{"entities":qCreatedBy(id+"x",EntityType.BODY),"transforms":[transform(vector(100,0,0)*millimeter)],"instanceNames":["moved"]});
      const o =`)],
  ]) {
    const current=name==='contracting'?model:await build(input,{feature:'profile',trace:false});
    const prefix=path.join(dir,name);prefixes.push(prefix);
    fs.writeFileSync(prefix+'.step',toStep(current));
    fs.writeFileSync(prefix+'.brep.json',serializeModel(current));
  }
  const validation=spawnSync('uv',['run',path.join(root,'scripts/validate-step.py'),...prefixes],{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:4<<20});
  fs.writeFileSync(path.join(dir,'validation.log'),validation.stdout+'\n'+validation.stderr);
  assert.equal(validation.status,0,validation.stdout+'\n'+validation.stderr);
  await assert.rejects(build(text.replace('line(o,axis)','line(o,axis + vector(1e-15,0,0))'),{feature:'profile',trace:false}),
    e=>e instanceof RustCapabilityError && /axis-frame-proof-unavailable/.test(e.reason));
});

test('coaxial cone Boolean boundaries survive host lifecycle and independent STEP validation', async () => {
  // The native test owns exact washer integration and refusal decisions. This
  // boundary owns FS operand consumption, serialization, and trimmed STEP faces.
  const text = operation => `FeatureScript 3044;
    import(path:"onshape/std/geometry.fs",version:"3044.0");
    export const cut = defineFeature(function(context is Context,id is Id,definition is map) {
      var sk=newSketchOnPlane(context,id+"sk",{"sketchPlane":plane(vector(0,0,0)*meter,vector(0,-1,0),vector(1,0,0))});
      const points=[vector(0,0),vector(4,0),vector(2,4),vector(0,4)];
      for(var i=0;i<4;i+=1) skLineSegment(sk,"s"~i,{"start":points[i]*meter/1024,"end":points[(i+1)%4]*meter/1024});
      skSolve(sk);
      opRevolve(context,id+"cone",{"entities":qSketchRegion(id+"sk",false),"axis":line(vector(0,0,0)*meter,vector(0,0,1)),"angleForward":360*degree});
      opDeleteBodies(context,id+"clean",{"entities":qCreatedBy(id+"sk",EntityType.BODY)});
      fCylinder(context,id+"tool",{"bottomCenter":vector(0,0,-1)*meter/1024,"topCenter":vector(0,0,5)*meter/1024,"radius":3*meter/1024});
      opBoolean(context,id+"bool",${operation !== 'SUBTRACTION'
        ? '{"tools":qUnion([qCreatedBy(id+"cone",EntityType.BODY),qCreatedBy(id+"tool",EntityType.BODY)])'
        : '{"targets":qCreatedBy(id+"cone",EntityType.BODY),"tools":qCreatedBy(id+"tool",EntityType.BODY)'}
        ,"operationType":BooleanOperationType.${operation}});
    });`;
  const empty = text('SUBTRACTION').replace('"radius":3*meter/1024', '"radius":5*meter/1024');
  await assert.rejects(build(empty, { feature: 'cut', trace: false }),
    e => e instanceof GeometryRefusal && e.refusalCategory === 'empty-result');
  const rollback = await build(empty.replace('opBoolean(context,id+"bool",', 'try silent(opBoolean(context,id+"bool",')
    .replace('BooleanOperationType.SUBTRACTION});', 'BooleanOperationType.SUBTRACTION}));'),
    { feature: 'cut', trace: false });
  assert.equal(rollback.bodies.length, 2, 'a caught empty result must not consume operands');
  const dir = fs.mkdtempSync(path.join(root, 'tmp/revolve-boolean-step-'));
  const prefixes = [];
  for (const operation of ['UNION', 'SUBTRACTION', 'INTERSECTION']) {
    const model = await build(text(operation), { feature: 'cut', trace: false });
    assert.equal(model.bodies.length, 1, operation);
    const serialized = serializeModel(model);
    const record = JSON.parse(serialized).bodies[0];
    assert.ok(record.faces.length >= 3, operation);
    assert.equal(record.referenceMeasurements.faceAreasMm2.length, record.faces.length);
    const prefix = path.join(dir, operation); prefixes.push(prefix);
    fs.writeFileSync(prefix + '.brep.json', serialized);
    fs.writeFileSync(prefix + '.step', toStep(model));
  }
  const validation = spawnSync('uv', ['run', path.join(root, 'scripts/validate-step.py'), ...prefixes],
    { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 4 << 20 });
  fs.writeFileSync(path.join(dir, 'validation.log'), validation.stdout + '\n' + validation.stderr);
  assert.equal(validation.status, 0, validation.stdout + '\n' + validation.stderr);
});
