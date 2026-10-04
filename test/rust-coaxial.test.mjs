// The FeatureScript host and independent STEP reader own coaxial transport and export.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
process.env.WONKY_BACKEND = 'rust';
const {build} = await import('../src/index.mjs');
const {toStep, toStl} = await import('../src/exporters.mjs');
const {serializeModel} = await import('../src/construction-history.mjs');
const {measureRustBody, rustModelKernel} = await import('../src/native/rust-host.mjs');
const root = fileURLToPath(new URL('../', import.meta.url));
const source = statements => `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export const f = defineFeature(function(context is Context, id is Id, definition is map) precondition {} {
${statements}
});`;
const cylinder = (id, radius, low, high, x = 0) => `fCylinder(context,id+"${id}",{"bottomCenter":vector(${x},0,${low})*millimeter,"topCenter":vector(${x},0,${high})*millimeter,"radius":${radius}*millimeter});`;
const body = id => `qCreatedBy(id+"${id}",EntityType.BODY)`;
const subtract = tools => `opBoolean(context,id+"cut",{"targets":${body('stock')},"tools":qUnion([${tools.map(body).join(',')}]),"operationType":BooleanOperationType.SUBTRACTION});`;

// Different through, cap-start, blind, and overlapping-tool arrangements
// have distinct volumes and topologies. The multi-tool case would silently
// pass a test that only exercised the two-body Boolean route.
test('FeatureScript coaxial arrangements retain exact volume and independent STEP geometry', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wonky-coaxial-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const prefixes = [];
  for (const [name, operations, volume, faces, feature = 'f'] of [
    ['through', cylinder('stock', 6, 0, 16) + cylinder('bore', 2, -4, 20) + subtract(['bore']), 512 * Math.PI, 4],
    ['x-axis', `fCylinder(context,id+"stock",{"bottomCenter":vector(0,0,0)*millimeter,"topCenter":vector(16,0,0)*millimeter,"radius":6*millimeter});fCylinder(context,id+"bore",{"bottomCenter":vector(-4,0,0)*millimeter,"topCenter":vector(20,0,0)*millimeter,"radius":2*millimeter});` + subtract(['bore']), 512 * Math.PI, 4],
    ['rotated-frame', cylinder('stock', 6, 0, 16) + cylinder('bore', 2, -4, 20) + `opTransform(context,id+"place",{"bodies":qUnion([${body('stock')},${body('bore')}]),"transform":toWorld(coordSystem(vector(100,200,300)*millimeter,vector(0,0,1),vector(0,-1,0)))});` + subtract(['bore']), 512 * Math.PI, 4],
    ['cap-start', cylinder('stock', 6, 0, 16) + cylinder('bore', 2, 0, 12) + subtract(['bore']), 528 * Math.PI, 5],
    ['blind', cylinder('stock', 6, 0, 16) + cylinder('bore', 2, 4, 20) + subtract(['bore']), 528 * Math.PI, 5],
    ['two-tools', cylinder('stock', 6, 0, 16) + cylinder('a', 2, 0, 8) + cylinder('b', 3, 8, 16) + subtract(['a', 'b']), 472 * Math.PI, 6],
    ['stepped-union', cylinder('stock', 6, 0, 16) + cylinder('boss', 3, 16, 24) + `opBoolean(context,id+"join",{"tools":qUnion([${body('stock')},${body('boss')}]),"operationType":BooleanOperationType.UNION});`, 648 * Math.PI, 5],
    ['sketched-bore', fs.readFileSync(path.join(root, 'examples/bored-spacer.fs'), 'utf8'), 210 * Math.PI, 4, 'boredSpacer'],
  ]) {
    const model = await build(feature === 'f' ? source(operations) : operations, {feature});
    assert.equal(model.bodies.length, 1, `${name}: one result`);
    const measured = measureRustBody(rustModelKernel(model), model.bodies[0]);
    assert.equal(measured.topology.faces, faces, `${name}: boundary faces`);
    assert.ok(Math.abs(measured.volumeMm3 - volume) <= measured.volumeMm3 * 1e-12, `${name}: closed-form volume`);
    assert.ok(measured.volumeRelBound < 1e-8, `${name}: bounded measurement`);
    if (name === 'rotated-frame') {
      assert.deepEqual(measured.bboxMm.min.map(Math.round), [94, 184, 294]);
      assert.deepEqual(measured.bboxMm.max.map(Math.round), [106, 200, 306]);
    }
    const prefix = path.join(directory, name);
    fs.writeFileSync(prefix + '.step', toStep(model, name));
    fs.writeFileSync(prefix + '.brep.json', serializeModel(model));
    const stl = toStl(model);
    assert.ok(stl.length > 84, `${name}: nonempty STL`);
    if (name === 'through') {
      const triangles = stl.readUInt32LE(80);
      assert.equal(stl.length, 84 + triangles * 50, 'binary STL has complete triangle records');
      let signedSixVolume = 0;
      for (let i = 0; i < triangles; i++) {
        const vertices = Array.from({length: 3}, (_, j) => Array.from({length: 3}, (_, k) =>
          stl.readFloatLE(84 + i * 50 + 12 + 12 * j + 4 * k)));
        const [a, b, c] = vertices;
        signedSixVolume += a[0] * (b[1] * c[2] - b[2] * c[1])
          + a[1] * (b[2] * c[0] - b[0] * c[2])
          + a[2] * (b[0] * c[1] - b[1] * c[0]);
      }
      assert.ok(Math.abs(signedSixVolume / 6 - volume) < volume * 0.02, 'independent mesh integral retains the bore');
    }
    prefixes.push(prefix);
  }
  const result = spawnSync('uv', ['run', 'scripts/validate-step.py', ...prefixes], {cwd: root, encoding: 'utf8', timeout: 120_000, maxBuffer: 2 << 20});
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  for (const row of JSON.parse(result.stdout)) assert.equal(row.valid, true);
});

test('crossing off-axis cutter removes the exact lens and exports valid STEP', async t => {
  const operations = cylinder('stock', 6, 0, 16) + cylinder('bore', 2, 0, 16, 5) + subtract(['bore']);
  const model=await build(source(operations), {feature:'f'});
  assert.equal(model.bodies.length,1);
  const m=measureRustBody(rustModelKernel(model),model.bodies[0]);
  const lens=36*Math.acos(.95)+4*Math.acos(-.35)-Math.sqrt(351)/2;
  const expected=(36*Math.PI-lens)*16;
  assert.ok(Math.abs(m.volumeMm3-expected)<=expected*1e-12);
  assert.equal(m.validity.closed,true);
  assert.equal(m.topology.genus,0);
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'wonky-crossing-bore-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const prefix=path.join(directory,'crossing-bore');
  fs.writeFileSync(prefix+'.step',toStep(model,'crossing-bore'));
  fs.writeFileSync(prefix+'.brep.json',serializeModel(model));
  const result=spawnSync('uv',['run','scripts/validate-step.py',prefix],{cwd:root,encoding:'utf8',timeout:120_000,maxBuffer:2<<20});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
  for(const row of JSON.parse(result.stdout))assert.equal(row.valid,true);
});
