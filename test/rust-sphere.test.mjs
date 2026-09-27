// Primary owner of sphere builtin transport, body lifecycle, and real STEP
// chart/reader contract. Exact geometry/admission live in Rust sphere tests.
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
const sphere = (name = 'opSphere') => `${name}(context,id+"s",{"center":vector(0,0,0)*millimeter,"radius":(0.1+8.2)*millimeter});`;
const query = id => `qCreatedBy(id+"${id}",EntityType.BODY)`;

test('sphere aliases preserve E9 inputs; mixed and spherical STEP charts pass the independent exact reader', async () => {
  const dir = fs.mkdtempSync(path.join(root, 'tmp/sphere-export-'));
  const cases = [
    ['whole', sphere('fSphere')],
    ['mixed', sphere() + 'fCuboid(context,id+"b",{"corner1":vector(20,0,0)*millimeter,"corner2":vector(22,3,4)*millimeter});'],
    ...['0,-20,-20|20,20,20', '-20,-20,-20|20,0,20'].map((bounds, i) => {
      const [lo, hi] = bounds.split('|');
      return [`half${i}`, sphere() + `fCuboid(context,id+"b",{"corner1":vector(${lo})*millimeter,"corner2":vector(${hi})*millimeter});
        opTransform(context,id+"p",{"bodies":qUnion([${query('s')},${query('b')}]),"transform":toWorld(coordSystem(vector(262144,-131072,65536)*millimeter,vector(0,0,1),vector(0,-1,0)))});
        opBoolean(context,id+"cut",{"tools":qUnion([${query('b')},${query('s')}]),"operationType":BooleanOperationType.INTERSECTION});
        const parts=evaluateQuery(context,${query('cut')});
        if(size(parts)!=1)throw "lost sphere Boolean result";
        setProperty(context,{"entities":parts[0],"propertyType":PropertyType.NAME,"value":"cut-sphere"});`];
    }),
  ];
  const prefixes = [];
  for (const [name, statements] of cases) {
    const model = await build(source(statements), { feature: 'f' });
    assert.equal(model.bodies.length, name === 'mixed' ? 2 : 1);
    const kernel = rustModelKernel(model), body = model.bodies[0];
    const wc0 = describeRustBody(kernel, body).body;
    const exactRadius = (0.1 + 8.2) * 0.001;
    const bits = new DataView(new ArrayBuffer(8)); bits.setFloat64(0, exactRadius, false);
    assert.equal(wc0.constructions[0].parameters[3], bits.getBigUint64(0, false).toString(16).padStart(16, '0'));
    const m = measureRustBody(kernel, body);
    assert.equal(m.topology.edges, name.startsWith('half') ? 1 : 0);
    if (name.startsWith('half')) assert.equal(body.name, 'cut-sphere');
    const prefix = path.join(dir, name); prefixes.push(prefix);
    fs.writeFileSync(prefix + '.step', toStep(model, name));
    fs.writeFileSync(prefix + '.brep.json', serializeModel(model));
  }
  const result = spawnSync('uv', ['run', path.join(root, 'scripts/validate-step.py'), ...prefixes], { cwd: root, encoding: 'utf8', maxBuffer: 2 << 20, timeout: 120_000 });
  fs.writeFileSync(path.join(dir, 'validation.log'), `${result.stdout}\n${result.stderr}`);
  assert.equal(result.status, 0, result.stderr);
  // A passing exit validates each artifact, including SameParameter, exact
  // CurveOnSurface, tolerances, topology, areas and volume, without repair.
});

test('non-equatorial trims are uncatchable named capabilities, not fake hemispheres', async () => {
  const statements = sphere() + `fCuboid(context,id+"b",{"corner1":vector(-20,-20,0.000000000000001)*millimeter,"corner2":vector(20,20,20)*millimeter});
    try silent {opBoolean(context,id+"cut",{"tools":qUnion([${query('s')},${query('b')}]),"operationType":BooleanOperationType.INTERSECTION});}`;
  await assert.rejects(build(source(statements), { feature: 'f' }), e => e.name === 'RustCapabilityError' && e.reason === 'sphere/non-equatorial-cut-needs-algebraic-circle');
});
