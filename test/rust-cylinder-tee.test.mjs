// Interpreter ownership and radical wire transport, including later placement.
// Native tests own arithmetic/admission; live acid owns independent STEP import.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
process.env.WONKY_BACKEND = 'rust';
const { build } = await import('../src/index.mjs');
const { toStep } = await import('../src/exporters.mjs');
const { serializeModel } = await import('../src/construction-history.mjs');
const { measureRustBody, rustModelKernel } = await import('../src/native/rust-host.mjs');
const source = `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export const f = defineFeature(function(context is Context, id is Id, definition is map) precondition {} {
    fCylinder(context,id+"post",{"bottomCenter":vector(0,0,-11)*millimeter,"topCenter":vector(0,0,11)*millimeter,"radius":7*millimeter});
    fCylinder(context,id+"branch",{"bottomCenter":vector(0,0,0)*millimeter,"topCenter":vector(19,0,0)*millimeter,"radius":3*millimeter});
    opBoolean(context,id+"tee",{"tools":qUnion([qCreatedBy(id+"post",EntityType.BODY),qCreatedBy(id+"branch",EntityType.BODY)]),"operationType":BooleanOperationType.UNION});
    if(size(evaluateQuery(context,qCreatedBy(id+"tee",EntityType.BODY)))!=0)throw "modification is not body creation";
    if(size(evaluateQuery(context,qCreatedBy(id+"branch",EntityType.BODY)))!=0)throw "consumed tool retained";
    if(size(evaluateQuery(context,qCreatedBy(id+"post",EntityType.BODY)))!=1)throw "missing union";
    opTransform(context,id+"move",{"bodies":qCreatedBy(id+"post",EntityType.BODY),"transform":toWorld(coordSystem(vector(65536.25,-32768.5,16384.125)*millimeter,vector(1,0,0),vector(0,0,1)))});
    setProperty(context,{"entities":qCreatedBy(id+"post",EntityType.BODY),"propertyType":PropertyType.NAME,"value":"tee"});
});`;
test('unequal-cylinder union retains aliases, exact ring transport and later placement', async () => {
  const model = await build(source, { feature: 'f' });
  assert.equal(model.bodies.length, 1);
  assert.equal(model.bodies[0].name, 'tee');
  const m = measureRustBody(rustModelKernel(model), model.bodies[0], { probes: [[65551.25, -32768.5, 16389.125]] });
  assert.equal(m.certificate, 'PerpendicularCylinderUnion');
  assert.ok(Math.abs(m.probes[0].distanceMm - 2) < 1e-9, JSON.stringify(m.probes[0]));
  const record = JSON.parse(serializeModel(model)).bodies[0];
  assert.equal(record.edges.length, 6);
  assert.equal(record.faces.length, 5);
  assert.equal(record.vertices.length, 4);
  const step = toStep(model, 'cylinder-tee');
  assert.ok(step.includes('B_SPLINE_CURVE_WITH_KNOTS('));
  assert.ok(step.includes('bounded STEP-only spline approximation'));
  assert.equal(m.exportApproximation.format, 'step');
  assert.ok(m.exportApproximation.budgetMm > 0 && m.exportApproximation.budgetMm < 1e-6, JSON.stringify(m.exportApproximation));
  if (process.env.WONKY_TEST_EXPORT_PREFIX) {
    const prefix = path.resolve(process.env.WONKY_TEST_EXPORT_PREFIX);
    fs.mkdirSync(path.dirname(prefix), { recursive: true });
    fs.writeFileSync(`${prefix}.step`, step);
    fs.writeFileSync(`${prefix}.brep.json`, serializeModel(model));
  }
});

// CLI boundary: the STEP file is labelled a bounded spline approximation, never
// "exact"; a crossing (through) branch is a named refusal, not a wrong union.
const root = fileURLToPath(new URL('../', import.meta.url));
const teeSource = (from, to) => `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export const tee = defineFeature(function(context is Context, id is Id, definition is map) precondition {} {
    fCylinder(context,id+"post",{"bottomCenter":vector(0,0,-12)*millimeter,"topCenter":vector(0,0,12)*millimeter,"radius":8*millimeter});
    fCylinder(context,id+"branch",{"bottomCenter":vector(${from},0,0)*millimeter,"topCenter":vector(${to},0,0)*millimeter,"radius":4*millimeter});
    opBoolean(context,id+"u",{"tools":qUnion([qCreatedBy(id+"post",EntityType.BODY),qCreatedBy(id+"branch",EntityType.BODY)]),"operationType":BooleanOperationType.UNION});
});`;
function cli(t, source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wonky-tee-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  fs.writeFileSync(path.join(dir, 'tee.fs'), source);
  const run = spawnSync(process.execPath, [path.join(root, 'bin/wonky.mjs'), path.join(dir, 'tee.fs'), '--feature', 'tee',
    '--format', 'step', '--out', path.join(dir, 'tee'), '--json'], {cwd: root, encoding: 'utf8', timeout: 120_000,
    env: {...process.env, WONKY_BACKEND: 'rust', NODE_OPTIONS: '--max-old-space-size=8192'}});
  assert.ifError(run.error);
  return {status: run.status, report: JSON.parse(run.stdout), dir};
}
test('CLI declares the STEP ring as bounded splines and refuses a crossing branch by name', t => {
  const {status, report, dir} = cli(t, teeSource(0, 16));
  assert.equal(status, 0, JSON.stringify(report));
  assert.equal(report.bodies.length, 1);
  assert.equal(report.bodies[0].exact, true); // native model: exact quartic carrier
  // AC20 closed form: pi*64*24 + pi*256 - (2560 E(1/4) - 1536 K(1/4))/3.
  assert.ok(Math.abs(report.bodies[0].volumeMm3 - 5240.60379826064748) < 1e-9, report.bodies[0].volumeMm3);
  const step = report.outputs.find(o => o.format === 'step');
  assert.equal(step.exact, false);
  assert.equal(step.approximation, 'bounded spline curves');
  assert.ok(step.deviationMm > 0 && step.deviationMm < 1e-6);
  assert.match(fs.readFileSync(path.join(dir, 'tee.step'), 'utf8'), /bounded STEP-only spline approximation/);
  const crossing = cli(t, teeSource(-16, 16));
  assert.equal(crossing.status, 2, JSON.stringify(crossing.report));
  assert.equal(crossing.report.status, 'refused');
  assert.equal(crossing.report.refusals.length, 1);
  assert.equal(crossing.report.refusals[0].operation, 'opBoolean');
  // boolean3d G12: the family refusal routes to the general Boolean, which refuses by its own row.
  assert.equal(crossing.report.refusals[0].code, 'boolean/ssi-row-unavailable');
  assert.deepEqual(crossing.report.outputs, []);
});
