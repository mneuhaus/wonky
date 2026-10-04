import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
process.env.WONKY_BACKEND = 'rust';
const { build } = await import('../src/index.mjs');
const { ModelingContext } = await import('../src/library.mjs');
const { Id, EnumValue, Quantity, Matrix, Vector, Transform, map } = await import('../src/values.mjs');
const { TopologyQuery } = await import('../src/queries.mjs');
const { rustModelKernel, referenceBodyReport, rustBodyWords, RustCapabilityError } = await import('../src/native/rust-host.mjs');
const sourcePath = new URL('../fixtures/step-reference/tetra-reference.step', import.meta.url).pathname;
const source = readFileSync(sourcePath, 'utf8');
const model = () => build(source, { sourcePath });
const kind = n => new EnumValue('EntityType', n);
const everything = n => {
  const body = new TopologyQuery('created', { id: new Id(['source']), entityType: kind('BODY') });
  return n === 'BODY' ? body : new TopologyQuery('owned', { query: body, entityType: kind(n) });
};
const identity = () => new Transform(new Matrix([[1,0,0],[0,1,0],[0,0,1]]), new Vector([new Quantity(0),new Quantity(0),new Quantity(0)]));

test('STEP enters the kernel as a labelled reference with certified bbox and complete face census', async () => {
  const m = await model();
  assert.equal(m.bodies.length, 1);
  const r = referenceBodyReport(m.bodies[0]);
  assert.equal(r.exact, false);
  assert.equal(r.geometryClass, 'reference');
  assert.equal(r.topology.faces, 4);
  assert.equal(r.faceBounds.length, 4);
  assert.deepEqual(r.faceCensus.PLANE, { boundedExactly: 0, boundedEnclosure: 4, refused: 0 });
  assert.equal(r.provenance.sha256, createHash('sha256').update(source).digest('hex'));
  assert.equal(r.uncertainty.mm, 0);
  assert.deepEqual(r.bboxMm, { min: [0,0,0], max: [1984.375,1984.375,1984.375] });
  assert.equal(r.areaMm2, null);
  assert.throws(() => rustBodyWords(m.bodies[0]), e => e instanceof RustCapabilityError && e.reason === 'import/reference-body/modelling');
  // Report mutations cannot alter the kernel's reference record.
  r.exact = true;
  assert.equal(referenceBodyReport(m.bodies[0]).exact, false);
  const cli = spawnSync(process.execPath, ['bin/wonky.mjs', sourcePath, '--json'], { encoding: 'utf8', env: process.env });
  assert.equal(cli.status, 0, cli.stderr);
  const report = JSON.parse(cli.stdout);
  assert.equal(report.bodies[0].exact, false);
  assert.equal(report.bodies[0].faceBounds.length, 4);
});

for (const [name, operation, definition] of [
  ['opBoolean', 'boolean', () => ({ tools: everything('BODY'), operationType: new EnumValue('BooleanOperationType','UNION') })],
  ['opFillet', 'fillet', () => ({ entities: everything('EDGE'), radius: new Quantity(.001) })],
  ['opChamfer', 'chamfer', () => ({ entities: everything('EDGE'), chamferType: new EnumValue('ChamferType','EQUAL_OFFSETS'), width: new Quantity(.001) })],
  ['opPattern', 'pattern', () => ({ entities: everything('BODY'), transforms: [identity()], instanceNames: ['copy'] })],
  ['opTransform', 'transform', () => ({ bodies: everything('BODY'), transform: identity() })],
]) test(`real ${name} refuses reference bodies by name without publication`, async () => {
  const m = await model();
  const engine = new ModelingContext(rustModelKernel(m));
  engine.addSolid(new Id(['source']), m.bodies[0]);
  const before = engine.bodies.slice();
  assert.throws(() => engine.builtins()[name].call([engine.context, new Id(['attempt']), map(definition())]),
    e => e instanceof RustCapabilityError && e.reason === `import/reference-body/${operation}`);
  assert.deepEqual(engine.bodies, before);
});

test('transform-and-boolean refuses at the first operation and does not publish a transformed reference', async () => {
  const m = await model(), engine = new ModelingContext(rustModelKernel(m));
  engine.addSolid(new Id(['source']), m.bodies[0]);
  const ops = engine.builtins();
  assert.throws(() => {
    ops.opTransform.call([engine.context,new Id(['move']),map({ bodies: everything('BODY'), transform: identity() })]);
    ops.opBoolean.call([engine.context,new Id(['join']),map({ tools: everything('BODY'), operationType: new EnumValue('BooleanOperationType','UNION') })]);
  }, e => e instanceof RustCapabilityError && e.reason === 'import/reference-body/transform');
  assert.equal(engine.bodies.length, 1);
  assert.equal(engine.bodies[0], m.bodies[0]);
});

test('owned trimmed spline surface is admitted through the same reference path and states its enclosure slack', async () => {
  const path = new URL('../fixtures/step-reference/spline-trim.step', import.meta.url).pathname;
  const text = readFileSync(path,'utf8'), m = await build(text,{ sourcePath: path });
  const r = referenceBodyReport(m.bodies[0]);
  assert.equal(r.topology.faces,4);
  assert.equal(r.faceCensus.B_SPLINE_SURFACE_WITH_KNOTS.boundedEnclosure,1);
  const f = r.faceBounds.find(f=>f.entityType==='B_SPLINE_SURFACE_WITH_KNOTS');
  assert.ok(f.boundsMm[0][0]<=0 && f.boundsMm[0][1]>=1984.375);
  assert.ok(f.boundsMm[1][0]<=0 && f.boundsMm[1][1]>=1984.375);
  assert.ok(f.slackUpperMm.every(s=>s>=0 && Number.isFinite(s)));
});

test('owned fixture bytes match provenance, including rational surface data', () => {
  const dir = new URL('../fixtures/step-reference/',import.meta.url);
  const p = JSON.parse(readFileSync(new URL('provenance.json',dir)));
  for(const [file,entry] of Object.entries(p.files)) assert.equal(createHash('sha256').update(readFileSync(new URL(file,dir))).digest('hex'),entry.sha256,file);
});

test('unsupported or oversized STEP input fails by name rather than reaching FeatureScript or truncated parsing', async () => {
  await assert.rejects(build('not a Part 21 file',{sourcePath}), e=>e instanceof RustCapabilityError && e.reason==='import/part21-syntax');
  await assert.rejects(build(source.padEnd(16*1024*1024+1,' '),{sourcePath}), e=>e instanceof RustCapabilityError && e.reason==='import/source-byte-limit');
});


test('CLI refuses invalid STEP text encoding without replacing source bytes', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(),'wonky-reference-encoding-'));
  try {
    const file = path.join(dir,'invalid.step');
    writeFileSync(file,Buffer.concat([Buffer.from(source),Buffer.from([0xff])]));
    const result = spawnSync(process.execPath,['bin/wonky.mjs',file,'--json'],{encoding:'utf8',env:process.env});
    assert.notEqual(result.status,0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status,'refused');
    assert.equal(report.refusals[0].code,'import/source-encoding-unsupported');
    assert.equal(report.bodies.length,0);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});


test('reference admission refuses a corrupt torus pcurve before publishing certified bounds', async () => {
  const sourcePath = new URL('../fixtures/step-reference/analytical.step', import.meta.url).pathname;
  const source = readFileSync(sourcePath, 'utf8');
  const from = "#235=CARTESIAN_POINT('',(0.,3.141592653589793));";
  assert.ok(source.includes(from));
  const corrupt = source.replace(from, "#235=CARTESIAN_POINT('',(0.,0.));");
  await assert.rejects(build(corrupt, { sourcePath }),
    e => e instanceof RustCapabilityError && e.reason === 'import/pcurve-trim-endpoint-mismatch');
  const valid = (await build(source, { sourcePath })).bodies.map(referenceBodyReport);
  assert.equal(valid.reduce((n, body) => n + body.faceBounds.length, 0), 10);
  const torus = valid.find(body => body.faceCensus.TOROIDAL_SURFACE);
  assert.ok(torus.bboxMm.max[2] >= 19, 'retained upper half torus reaches z=19 mm');
});
