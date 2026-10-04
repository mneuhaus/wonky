// Primary owner of cylinder transport/lifecycle and actual analytic STEP
// round trips. Rust owns exact incidence and measurement formula coverage.
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
export const f = defineFeature(function(context is Context, id is Id, definition is map) precondition {} {
${statements}
});`;
const query = id => `qCreatedBy(id+"${id}",EntityType.BODY)`;
const cylinder = `fCylinder(context,id+"c",{"bottomCenter":vector(0,0,-1000)*millimeter,"topCenter":vector(0,0,1000)*millimeter,"radius":375*millimeter});`;

test('cylinder transport and Boolean body lifecycle retain exact spherical STEP bands', async () => {
  const dir = fs.mkdtempSync(path.join(root, 'tmp/axial-export-'));
  const prefixes = [];
  for (const [name, statements, count] of [
    ['cylinder', `fCylinder(context,id+"c",{"bottomCenter":vector(250,0,1500)*millimeter,"topCenter":vector(250,0,500)*millimeter,"radius":375*millimeter});`, 1],
    ['band', cylinder + `fSphere(context,id+"s",{"center":vector(0,0,250)*millimeter,"radius":625*millimeter});
      opTransform(context,id+"p",{"bodies":qUnion([${query('s')},${query('c')}]),"transform":toWorld(coordSystem(vector(262144,-131072,65536)*millimeter,vector(0,0,1),vector(0,-1,0)))});
      opBoolean(context,id+"cut",{"targets":${query('s')},"tools":${query('c')},"keepTools":true,"operationType":BooleanOperationType.SUBTRACTION});
      if(size(evaluateQuery(context,${query('s')}))!=1)throw "lost axial result";
      if(size(evaluateQuery(context,${query('cut')}))!=0)throw "cut incorrectly created a body";
      setProperty(context,{"entities":${query('s')},"propertyType":PropertyType.NAME,"value":"spherical-band"});`, 2],
  ]) {
    const model = await build(source(statements), { feature: 'f' });
    assert.equal(model.bodies.length, count);
    const kernel = rustModelKernel(model);
    const result = name === 'band' ? model.bodies.find(b => b.name === 'spherical-band') : model.bodies[0];
    assert.ok(result);
    const m = measureRustBody(kernel, result);
    assert.equal(m.topology.genus, name === 'band' ? 1 : 0);
    assert.equal(m.topology.ringEdges, 2);
    const wc0 = describeRustBody(kernel, result).body;
    assert.equal(wc0.surfaces.filter(s => s.geometry.kind === 'Sphere').length, name === 'band' ? 1 : 0);
    const prefix = path.join(dir, name); prefixes.push(prefix);
    fs.writeFileSync(prefix + '.step', toStep(model, name));
    fs.writeFileSync(prefix + '.brep.json', serializeModel(model));
  }
  const result = spawnSync('uv', ['run', path.join(root, 'scripts/validate-step.py'), ...prefixes], { cwd: root, encoding: 'utf8', maxBuffer: 2 << 20, timeout: 120_000 });
  fs.writeFileSync(path.join(dir, 'validation.log'), `${result.stdout}\n${result.stderr}`);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('unsupported cylinder axes cannot disappear inside try silent', async () => {
  await assert.rejects(build(source(`try silent {
    fCylinder(context,id+"c",{"bottomCenter":vector(0,0,0)*millimeter,"topCenter":vector(1,0,1000)*millimeter,"radius":375*millimeter});
  }`), { feature: 'f' }), e => e.name === 'RustCapabilityError' && e.reason === 'cylinder/non-coordinate-axis');
});
