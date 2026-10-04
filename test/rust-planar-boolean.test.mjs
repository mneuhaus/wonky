// Host lifecycle and the independent STEP consumer, not a second arithmetic
// oracle. Covers publication of the new certificate, keepTools, and geometric
// refusal transport. Rust tests own rational clipping and exact-volume laws.
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
const { measureRustBody, rustModelKernel, rustMesh } = await import('../src/native/rust-host.mjs');
const root = fileURLToPath(new URL('../', import.meta.url));
const source = statements => `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export const f = defineFeature(function(context is Context, id is Id, definition is map) precondition {} {
  const sketch = newSketchOnPlane(context,id+"sketch",{"sketchPlane":plane(vector(0,0,0)*meter,vector(0,0,1),vector(0,1,0))});
  skPolyline(sketch,"diamond",{"points":[vector(-2,0)*meter,vector(0,-2)*meter,vector(2,0)*meter,vector(0,2)*meter,vector(-2,0)*meter]});
  skSolve(sketch);
  opExtrude(context,id+"diamond",{"entities":qSketchRegion(id+"sketch",false),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":2*meter});
  opDeleteBodies(context,id+"clean",{"entities":qCreatedBy(id+"sketch",EntityType.BODY)});
  ${statements}
});`;
const query = id => `qCreatedBy(id+"${id}",EntityType.BODY)`;

function validateStep(model, points = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wonky-planar-step-'));
  try {
    const prefix = path.join(dir, 'result');
    fs.writeFileSync(prefix + '.step', toStep(model, 'planar-result'));
    fs.writeFileSync(prefix + '.brep.json', serializeModel(model));
    const args = ['run', path.join(root, 'scripts/validate-step.py'), prefix];
    if (points.length) {
      const probes = path.join(dir, 'probes.json');
      fs.writeFileSync(probes, JSON.stringify({ schema: 'wonky-solid-probes/1', toleranceMm: 1e-7,
        models: [{ prefix, points }] }));
      args.push('--points', probes);
    }
    const result = spawnSync('uv', args, {
      cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024,
    });
    assert.equal(result.status, 0, result.stderr || String(result.error));
    const report = JSON.parse(result.stdout);
    assert.equal(report.length, 1);
    return report[0];
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('different-frame Boolean publishes audited output, retains the tool and exports valid STEP', async () => {
  const model = await build(source(`
    fCuboid(context,id+"box",{"corner1":vector(0.1,0,0)*meter,"corner2":vector(2,2,2)*meter});
    opBoolean(context,id+"cut",{"targets":${query('box')},"tools":${query('diamond')},"keepTools":true,"operationType":BooleanOperationType.SUBTRACTION});
    const result=${query('box')};
    if(size(evaluateQuery(context,${query('cut')}))!=0)throw "cut modified rather than created the body";
    if(size(evaluateQuery(context,result))!=1)throw "cut output not selectable";
    if(size(evaluateQuery(context,${query('diamond')}))!=1)throw "tool became a target creator";
    setProperty(context,{"entities":result,"propertyType":PropertyType.NAME,"value":"result"});
  `), { feature: 'f' });
  assert.equal(model.bodies.length, 2);
  const output = model.bodies.find(b => b.name === 'result');
  assert.ok(output);
  const measurement = measureRustBody(rustModelKernel(model), output);
  assert.equal(measurement.certificate, 'ExactPlaneArrangement');
  assert.equal(measurement.axis, null, 'a general polyhedron must not advertise an extrusion axis');
  validateStep(model);
});

test('STEP retains both holes after a planar bridge union', async () => {
  const model = await build(source(`
    fCuboid(context,id+"box",{"corner1":vector(-4,-4,0)*meter,"corner2":vector(4,4,2)*meter});
    opBoolean(context,id+"cut",{"targets":${query('box')},"tools":${query('diamond')},"operationType":BooleanOperationType.SUBTRACTION});
    fCuboid(context,id+"bar",{"corner1":vector(-2,-0.5,0)*meter,"corner2":vector(2,0.5,2)*meter});
    opBoolean(context,id+"join",{"tools":qUnion([${query('box')},${query('bar')}]),"operationType":BooleanOperationType.UNION});
  `), { feature: 'f' });
  assert.equal(model.bodies.length, 1);
  // Two triangular through holes in a box: 8 outer vertices + 6 per hole,
  // 12 outer edges + 9 per hole, two caps + four outer + six inner walls.
  // Coplanar source fragments and straight subdivisions are not final faces.
  const topology = measureRustBody(rustModelKernel(model), model.bodies[0]).topology;
  assert.deepEqual([topology.faces, topology.edges, topology.vertices, topology.loops, topology.genus],
    [12, 30, 20, 16, 2]);
  const report = validateStep(model, [
    { id: 'upper-hole', pointMm: [0, 1000, 1000] },
    { id: 'lower-hole', pointMm: [0, -1000, 1000] },
    { id: 'bridge', pointMm: [0, 0, 1000] },
    { id: 'wall', pointMm: [3000, 0, 1000] },
  ]);
  assert.equal(report.valid, true);
  assert.ok(Math.abs(report.volumeMm3 - 119e9) < 119e9 * 1e-12);
  assert.equal(report.pointClassification.solidCount, 1);
  assert.deepEqual(report.pointClassification.points.map(p => p.state), ['Outside', 'Outside', 'Inside', 'Inside']);
});

test('general planar failures distinguish empty geometry from an unsuppressible capability', async () => {
  await assert.rejects(build(source(`
    fCuboid(context,id+"box",{"corner1":vector(-4,-4,-1)*meter,"corner2":vector(4,4,3)*meter});
    opBoolean(context,id+"cut",{"targets":${query('diamond')},"tools":${query('box')},"operationType":BooleanOperationType.SUBTRACTION});
  `), { feature: 'f' }), e => e.refusalCategory === 'empty-result' && e.operationUnderTest === true);
  // A capability refusal inside try silent is not suppressed: a rod along x
  // meets the diamond's 45-degree walls in ellipses, a row the general
  // Boolean does not have.
  await assert.rejects(build(source(`
    fCylinder(context,id+"rod",{"bottomCenter":vector(-3,0,1)*meter,"topCenter":vector(3,0,1)*meter,"radius":0.2*meter});
    try silent { opBoolean(context,id+"cut",{"targets":${query('diamond')},"tools":${query('rod')},"operationType":BooleanOperationType.SUBTRACTION}); }
  `), { feature: 'f' }), e => e.name === 'RustCapabilityError' && e.builtin === 'opBoolean'
    && e.message.includes('boolean/ssi-row-unavailable:plane×cylinder/oblique'));
});

test('a curved operand of a planar Model is cut exactly through the general Boolean', async () => {
  // boolean3d G12: the joined diamond (a Model) minus a vertical bore. Its
  // bore band rings, charted in the cap planes, are written on the band seam;
  // the 45-degree walls' sqrt(2) area factor is enclosed, not rounded.
  const model = await build(source(`
    fCuboid(context,id+"box",{"corner1":vector(3,0,0)*meter,"corner2":vector(5,2,2)*meter});
    opBoolean(context,id+"join",{"tools":qUnion([${query('diamond')},${query('box')}]),"operationType":BooleanOperationType.UNION});
    fCylinder(context,id+"round",{"bottomCenter":vector(0,0,-1)*meter,"topCenter":vector(0,0,3)*meter,"radius":0.2*meter});
    opBoolean(context,id+"cut",{"targets":${query('diamond')},"tools":${query('round')},"operationType":BooleanOperationType.SUBTRACTION});
  `), { feature: 'f' });
  assert.equal(model.bodies.length, 2);
  const kernel = rustModelKernel(model);
  const [drilled] = model.bodies.map(b => measureRustBody(kernel, b)).filter(m => m.certificate === 'GeneralBooleanModel');
  assert.ok(drilled, 'the drilled diamond is a general-Boolean Model');
  // V = 2 * (8 - 0.04 pi) m^3; A = 2 * (8 - 0.04 pi) + 16 sqrt 2 + 0.8 pi m^2.
  const volume = (16 - 0.08 * Math.PI) * 1e9, area = (16 + 16 * Math.SQRT2 + 0.72 * Math.PI) * 1e6;
  assert.ok(Math.abs(drilled.volumeMm3 - volume) <= 1e-9 * volume, `${drilled.volumeMm3}`);
  assert.ok(Math.abs(drilled.areaMm2 - area) <= 1e-9 * area, `${drilled.areaMm2}`);
  assert.deepEqual([drilled.topology.faces, drilled.topology.edges, drilled.topology.vertices, drilled.topology.ringEdges, drilled.topology.genus], [7, 14, 8, 2, 1]);
  assert.equal(validateStep(model).valid, true);
});


test('general live disjoint union preserves separate bodies and creator identity', async () => {
  const model = await build(source(`
    fCuboid(context,id+"box",{"corner1":vector(3,0,0)*meter,"corner2":vector(5,2,2)*meter});
    opBoolean(context,id+"join",{"tools":qUnion([${query('diamond')},${query('box')}]),"operationType":BooleanOperationType.UNION});
    if(size(evaluateQuery(context,${query('diamond')}))!=1)throw "diamond identity lost";
    if(size(evaluateQuery(context,${query('box')}))!=1)throw "box identity lost";
    if(size(evaluateQuery(context,${query('join')}))!=0)throw "union invented a creator";
  `), {feature:'f'});
  assert.equal(model.bodies.length, 2);
  const report = validateStep(model);
  assert.equal(report.valid, true);
  assert.ok(Math.abs(report.volumeMm3 - 24e9) < 24e9 * 1e-12);
});

const concave = statements => `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export const f = defineFeature(function(context is Context, id is Id, definition is map) precondition {} {
  const sk = newSketchOnPlane(context,id+"sk",{"sketchPlane":plane(vector(0,0,0)*millimeter,vector(0,0,1),vector(1,0,0))});
  skPolyline(sk,"L",{"points":[vector(0,0)*millimeter,vector(24,0)*millimeter,vector(24,6)*millimeter,vector(6,6)*millimeter,vector(6,20)*millimeter,vector(0,20)*millimeter,vector(0,0)*millimeter]});
  skSolve(sk);
  opExtrude(context,id+"L",{"entities":qSketchRegion(id+"sk",false),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":6*millimeter});
  opDeleteBodies(context,id+"drop",{"entities":qCreatedBy(id+"sk",EntityType.BODY)});
  fCuboid(context,id+"tool",{"corner1":vector(2,8,-1)*millimeter,"corner2":vector(4,10,7)*millimeter});
  opBoolean(context,id+"cut",{"targets":${query('L')},"tools":${query('tool')},"operationType":BooleanOperationType.SUBTRACTION});
  ${statements}
});`;

test('concave planar subtraction is live rule 6 with exact holes and continuation', async () => {
  const model = await build(concave(''), {feature:'f'});
  assert.equal(model.bodies.length, 1);
  const history = JSON.parse(serializeModel(model));
  assert.ok(history.bodies[0].wc0.body.constructions.some(n => n.rule_version === 6 && n.parameters[1] === "c018000000000000"), 'general construction published');
  const measurement = measureRustBody(rustModelKernel(model), model.bodies[0]);
  assert.equal(measurement.certificate, 'ExactPlaneArrangement');
  const report = validateStep(model, [
    {id:'hole',pointMm:[3,9,3]}, {id:'notch',pointMm:[12,12,3]}, {id:'leg',pointMm:[1,9,3]},
  ]);
  assert.equal(report.valid,true);
  assert.ok(Math.abs(report.volumeMm3-1344)<1344*1e-12);
  assert.deepEqual(report.pointClassification.points.map(p=>p.state),['Outside','Outside','Inside']);
  const second = await build(concave(`
    fCuboid(context,id+"next",{"corner1":vector(2,12,-1)*millimeter,"corner2":vector(4,14,7)*millimeter});
    opBoolean(context,id+"again",{"targets":${query('L')},"tools":${query('next')},"operationType":BooleanOperationType.SUBTRACTION});
  `),{feature:'f'});
  assert.equal(second.bodies.length,1);
  const continued=validateStep(second);
  assert.equal(continued.valid,true);
  assert.ok(Math.abs(continued.volumeMm3-1320)<1320*1e-12);
});


test('live planar inner shell exports a valid void and mesh', async () => {
  const model = await build(concave(`
    fCuboid(context,id+"pocket",{"corner1":vector(8,1,1)*millimeter,"corner2":vector(10,3,5)*millimeter});
    opBoolean(context,id+"void",{"targets":${query('L')},"tools":${query('pocket')},"operationType":BooleanOperationType.SUBTRACTION});
  `),{feature:'f'});
  assert.equal(model.bodies.length,1);
  const record=JSON.parse(serializeModel(model));
  assert.equal(record.bodies[0].wc0.body.shells.length,2);
  const report=validateStep(model,[{id:'void',pointMm:[9,2,3]},{id:'wall',pointMm:[9,0.5,3]}]);
  assert.equal(report.valid,true);
  assert.equal(report.pointClassification.solidCount,1);
  assert.deepEqual(report.pointClassification.points.map(p=>p.state),['Outside','Inside']);
  assert.ok(Math.abs(report.volumeMm3-1328)<1328*1e-12);
  const mesh=rustMesh(rustModelKernel(model),model.bodies,1e-8);
  assert.equal(mesh.bodies.length,1);
  assert.ok(mesh.bodies[0].triangles.length>0);
});

// Disjoint curved prisms still reach the shared stack owner's explicit refusal.
test('disjoint curved prism union refusal is unsuppressible', async () => {
  await assert.rejects(build(source(`
    fCylinder(context,id+"round",{"bottomCenter":vector(4,0,0)*meter,"topCenter":vector(4,0,2)*meter,"radius":0.2*meter});
    try silent { opBoolean(context,id+"cut",{"tools":qUnion([${query('diamond')},${query('round')}]),"operationType":BooleanOperationType.UNION}); }
  `), { feature: 'f' }), e => e.name === 'RustCapabilityError' && e.reason === 'prism-stack/multiple-result-bodies');
});
