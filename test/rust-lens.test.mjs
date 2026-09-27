// Owns host Boolean lifecycle, versioned radical-circle transport and STEP
// delivery. Rust owns exact construction predicates and independent formulas.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
process.env.WONKY_BACKEND = 'rust';
const { build } = await import('../src/index.mjs');
const { toStep } = await import('../src/exporters.mjs');
const { serializeModel } = await import('../src/construction-history.mjs');
const { measureRustBody, rustModelKernel, describeRustBody } = await import('../src/native/rust-host.mjs');
const root = fileURLToPath(new URL('../', import.meta.url));
const source = statements => `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export const f = defineFeature(function(context is Context, id is Id, definition is map) precondition {} { ${statements} });`;
const query = id => `qCreatedBy(id+"${id}",EntityType.BODY)`;
const pair = `fSphere(context,id+"a",{"center":vector(250,-500,125)*millimeter,"radius":500*millimeter});
fSphere(context,id+"b",{"center":vector(250,0,125)*millimeter,"radius":500*millimeter});`;
const intersection = `opBoolean(context,id+"cut",{"tools":qUnion([${query('a')},${query('b')}]),"operationType":BooleanOperationType.INTERSECTION});`;
test('radical lens survives unrelated bodies, placement and unhealed spherical STEP', async () => {
  const model = await build(source(pair + intersection + `
    fSphere(context,id+"other",{"center":vector(2000,0,0)*millimeter,"radius":125*millimeter});
    if(size(evaluateQuery(context,${query('cut')}))!=1)throw "lost lens result";
    setProperty(context,{"entities":${query('cut')},"propertyType":PropertyType.NAME,"value":"lens"});
    opTransform(context,id+"p",{"bodies":qUnion([${query('cut')},${query('other')}]),"transform":toWorld(coordSystem(vector(262144,-131072,65536)*millimeter,vector(0,0,1),vector(0,-1,0)))});`), { feature: 'f' });
  assert.equal(model.bodies.length, 2);
  const body = model.bodies.find(b => b.name === 'lens'); assert.ok(body);
  const kernel = rustModelKernel(model);
  const wire = describeRustBody(kernel, body);
  assert.equal(wire.schemaVersion, 4);
  assert.equal(wire.body.curves[0].geometry.kind, 'SphereCircle');
  assert.equal(wire.body.vertices.length, 0);
  assert.equal(wire.body.edges[0].vertices.length, 0);
  const m = measureRustBody(kernel, body);
  assert.equal(m.topology.faces, 2); assert.equal(m.topology.edges, 1); assert.equal(m.topology.vertices, 0);
  assert.equal(m.boundToConstruction, true);
  const dir = fs.mkdtempSync(path.join(root, 'tmp/lens-export-'));
  const prefix = path.join(dir, 'mixed-lens');
  fs.writeFileSync(prefix + '.step', toStep(model, 'radical lens'));
  fs.writeFileSync(prefix + '.brep.json', serializeModel(model));
  const r = spawnSync('uv', ['run', path.join(root, 'scripts/validate-step.py'), prefix], { cwd: root, encoding: 'utf8', maxBuffer: 2 << 20, timeout: 120_000 });
  fs.writeFileSync(path.join(dir, 'validation.log'), `${r.stdout}\n${r.stderr}`);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
});
test('unsupported sphere pairs remain named errors inside try silent', async () => {
  await assert.rejects(build(source(pair + `try silent {
    fSphere(context,id+"other",{"center":vector(250,0,125)*millimeter,"radius":501*millimeter});
    opBoolean(context,id+"cut",{"tools":qUnion([${query('a')},${query('other')}]),"operationType":BooleanOperationType.INTERSECTION});
  }`), { feature: 'f' }), e => e.name === 'RustCapabilityError' && e.reason === 'lens/unequal-radii');
});
