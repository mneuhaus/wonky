import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend() || missing("fixtures/r10b/modules.json", "fixtures/r10b/r10b.fs");
if (publicTreeSkip) {
  test("modeling-policy.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { spawnSync } = await import("node:child_process");
const { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { fileURLToPath } = await import("node:url");
const { build } = await import("../src/index.mjs");
const { ModelingContext } = await import("../src/library.mjs");
const { Interpreter } = await import("../src/interpreter.mjs");
const { array, loadKernel } = await import("../src/kernel.mjs");
const { circularFrustumInBend } = await import("../src/analytic.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");
const { EnumValue, Id, map } = await import("../src/values.mjs");
const { TopologyQuery } = await import("../src/queries.mjs");
const { acceptanceOptions, runAcceptance, traceBuild } = await import("../scripts/check-acceptance.mjs");

















const root = fileURLToPath(new URL('../', import.meta.url));
const strict = { curvedContacts: 'strict' };
const tolerated = cap => ({ curvedContacts: 'tolerated-regularized', contactCapMm: cap });
const feature = body => `FeatureScript 3044;
import(path:"onshape/std/geometry.fs",version:"3044.0");
export function main(context is Context,id is Id,definition is map) { ${body} }`;
const box = (name, low, high) => `fCuboid(context,id+"${name}",{
  "corner1":vector(${low},${low},${low})*millimeter,"corner2":vector(${high},${high},${high})*millimeter});`;
const intersection = (id = 'result', a = 'a', b = 'b') => `opBoolean(context,id+"${id}",{
  "tools":qUnion([qCreatedBy(id+"${a}",EntityType.BODY),qCreatedBy(id+"${b}",EntityType.BODY)]),
  "operationType":BooleanOperationType.INTERSECTION});`;
const overlap = box('a', 0, 4) + box('b', 2, 6) + intersection();
// An empty Boolean result: the tool encloses the target, so the subtraction
// leaves nothing. (An empty INTERSECTION is refused instead: std boolean.fs
// reports it as the info BOOLEAN_INTERSECT_NO_OP, and Onshape's resulting
// model is not verified; see the last assertion of the evidence test.)
const empty = box('a', 0, 1) + box('b', -1, 2) + `opBoolean(context,id+"result",{"targets":qCreatedBy(id+"a",EntityType.BODY),
  "tools":qCreatedBy(id+"b",EntityType.BODY),"operationType":BooleanOperationType.SUBTRACTION});`;

test('contexts default to an immutable strict policy and reject invalid policy selections', async () => {
  const first = new ModelingContext(null), second = new ModelingContext(null);
  assert.deepEqual(first.modelingPolicy, strict);
  assert.ok(Object.isFrozen(first.modelingPolicy));
  assert.deepEqual(first.operationEvidence, []);
  assert.notEqual(first.operationEvidence, second.operationEvidence);
  const requested = tolerated(0.002), selected = new ModelingContext(null, { modelingPolicy: requested });
  requested.contactCapMm = 2;
  assert.deepEqual(selected.modelingPolicy, tolerated(0.002));
  assert.ok(Object.isFrozen(selected.modelingPolicy));
  const invalid = [null, [], { curvedContacts: 'automatic' }, { contactCapMm: 0 },
    { curvedContacts: 'tolerated-regularized' }, tolerated(-1), tolerated(Infinity), tolerated(NaN),
    { ...strict, extra: true }];
  for (const modelingPolicy of invalid) {
    assert.throws(() => new ModelingContext(null, { modelingPolicy }));
    await assert.rejects(build(feature(box('a', 0, 1)), { modelingPolicy }));
  }
});

test('build policy reaches Boolean evidence with strict, zero-cap and finite-cap selections', async () => {
  for (const modelingPolicy of [undefined, tolerated(0), tolerated(0.002)]) {
    const model = await build(feature(overlap), { modelingPolicy });
    assert.deepEqual(model.modelingPolicy, modelingPolicy ?? strict);
    assert.ok(Object.isFrozen(model.modelingPolicy));
    assert.equal(model.bodies.length, 1);
    assert.ok(Math.abs(model.bodies[0].validation.volumeMm3 - 8) < 1e-8);
    assert.equal(model.operationEvidence.length, 1);
    const evidence = model.operationEvidence[0];
    assert.equal(evidence.schema, 'wonky-operation-evidence/2');
    assert.equal(evidence.operationId, 'model/result');
    assert.equal(evidence.operation, 'INTERSECTION');
    assert.deepEqual(evidence.modelingPolicy, model.modelingPolicy);
    assert.deepEqual(evidence.inputs.map(input => input.bodyId), ['model/a', 'model/b']);
    assert.deepEqual(evidence.outputs.map(output => output.bodyId), model.bodies.map(body => body.id));
  }
});

test('frozen module contexts receive the selected policy and independent evidence arrays', async t => {
  const contexts = new Set(), originalCall = Interpreter.prototype.call;
  t.mock.method(Interpreter.prototype, 'call', function (fn, args, loc) {
    const result = originalCall.call(this, fn, args, loc);
    if (fn?.name?.endsWith('::build')) contexts.add(result.engine);
    return result;
  });
  const source = readFileSync(join(root, 'fixtures/r10b/r10b.fs'), 'utf8');
  const model = await build(source, { feature: 'r10bRetainedContext',
    moduleManifest: join(root, 'fixtures/r10b/modules.json'), modelingPolicy: tolerated(0.002) });
  assert.equal(model.bodies.length, 5);
  assert.ok(contexts.size > 0);
  for (const context of contexts) {
    assert.equal(context.readOnly, true);
    assert.deepEqual(context.modelingPolicy, model.modelingPolicy);
    assert.ok(Object.isFrozen(context.modelingPolicy));
    assert.deepEqual(context.operationEvidence, []);
    assert.notEqual(context.operationEvidence, model.operationEvidence);
  }
  assert.equal(new Set([...contexts].map(context => context.operationEvidence)).size, contexts.size);
});

test('completed Empty Booleans retain evidence, including a final no-solid-model failure', async () => {
  const model = await build(feature(empty + box('survivor', 4, 5)), { modelingPolicy: tolerated(0) });
  assert.deepEqual(model.bodies.map(body => body.id), ['model/survivor']);
  assert.equal(model.operationEvidence.length, 1);
  assert.deepEqual(model.operationEvidence[0].outputs, []);
  assert.deepEqual(model.operationEvidence[0].modelingPolicy, tolerated(0));
  await assert.rejects(build(feature(empty)), error => {
    assert.match(error.message, /no solid bodies/);
    assert.equal(error.completedOperationEvidence.length, 1);
    assert.deepEqual(error.completedOperationEvidence[0].outputs, []);
    return true;
  });
  const traced = await traceBuild(feature(empty), { feature: 'main', modelingPolicy: tolerated(0) });
  assert.equal(traced.model, null);
  assert.match(traced.error.message, /no solid bodies/);
  assert.equal(traced.completedOperationEvidence.length, 1);
  assert.deepEqual(traced.completedOperationEvidence[0].outputs, []);
  await assert.rejects(build(feature(box('a', 0, 1) + box('b', 2, 3) + intersection())), error => error instanceof UnsupportedFeatureError && /empty result/.test(error.message));
});

test('a failure decoding the second native component commits neither geometry nor evidence', async () => {
  const kernel = await loadKernel();
  const brokenKernel = { ...kernel, boolean: { ...kernel.boolean, coaxial(...args) {
    const result = structuredClone(kernel.boolean.coaxial(...args));
    const parts = array(result.bodies);
    assert.equal(parts.length, 2);
    parts[1].solid.edges.head.start = 999;
    return result;
  } } };
  const engine = new ModelingContext(brokenKernel, { modelingPolicy: tolerated(0.002) });
  for (const [name, z] of [['a', 0], ['b', 3]]) {
    const id = new Id([name]);
    engine.addSolid(id, circularFrustumInBend(kernel, String(id), { center: [0, 0], radius: 1,
      plane: { origin: [0, 0, z], normal: [0, 0, 1], x: [1, 0, 0] } }, null, [0, 0, 1]));
  }
  const originals = [...engine.bodies], before = JSON.stringify(originals);
  assert.throws(() => engine.builtins().opBoolean.call([engine.context, new Id(['result']), map({
    tools: new TopologyQuery('allSolid'), operationType: new EnumValue('BooleanOperationType', 'UNION'),
  })]), /Invalid analytic edge vertex/);
  assert.deepEqual(engine.bodies, originals);
  assert.equal(JSON.stringify(engine.bodies), before);
  assert.deepEqual(engine.operationEvidence, []);
});

test('a later unsupported operation preserves completed evidence without returning a model', async () => {
  const source = feature(overlap + 'try silent(opPolicyDeliberatelyUnsupported());');
  await assert.rejects(build(source, { modelingPolicy: tolerated(0.002) }), error => {
    assert.ok(error instanceof UnsupportedFeatureError);
    assert.equal(error.completedOperationEvidence.length, 1);
    assert.equal(error.completedOperationEvidence[0].operationId, 'model/result');
    return true;
  });
  const traced = await traceBuild(source, { feature: 'main', modelingPolicy: tolerated(0.002) });
  assert.equal(traced.model, null);
  assert.equal(traced.error.name, 'UnsupportedFeatureError');
  assert.equal(traced.firstFailure.name, 'opPolicyDeliberatelyUnsupported');
  assert.equal(traced.completedOperationEvidence.length, 1);
  assert.deepEqual(traced.completedOperationEvidence[0].modelingPolicy, tolerated(0.002));
});

test('build failure retains optional failed-operation evidence after completed operations', async t => {
  const diagnostic = { schema: 'wonky-operation-evidence/1', operationId: 'model/failed', status: 'Unresolved' };
  const failure = Object.assign(new UnsupportedFeatureError('Injected native capability failure'), {
    operationEvidence: [diagnostic],
  });
  const originalCall = Interpreter.prototype.call;
  t.mock.method(Interpreter.prototype, 'call', function (fn, args, loc) {
    if (fn?.name === 'opBoolean' && String(args[1]) === 'model/failed') throw failure;
    return originalCall.call(this, fn, args, loc);
  });
  await assert.rejects(build(feature(overlap + box('c', 1, 5) + intersection('failed', 'result', 'c'))), error => {
    assert.equal(error, failure);
    assert.deepEqual(error.completedOperationEvidence.map(item => item.operationId), ['model/result', 'model/failed']);
    assert.equal(error.completedOperationEvidence[1], diagnostic);
    assert.deepEqual(error.operationEvidence, [diagnostic]);
    return true;
  });
});

test('CLI serializes the explicit policy and Boolean evidence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wonky-policy-cli-'));
  try {
    const source = join(dir, 'model.fs');
    writeFileSync(source, feature(overlap));
    for (const [name, flags, modelingPolicy] of [
      ['strict', [], strict],
      ['zero', ['--curved-contacts', 'tolerated-regularized', '--contact-cap-mm', '0'], tolerated(0)],
      ['finite', ['--contact-cap-mm', '0.002', '--curved-contacts', 'tolerated-regularized'], tolerated(0.002)],
    ]) {
      const prefix = join(dir, name);
      const result = spawnSync(process.execPath, ['bin/wonky.mjs', source, '--format', 'step', '--out', prefix, ...flags], {
        cwd: root, encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stderr);
      const model = JSON.parse(readFileSync(`${prefix}.brep.json`, 'utf8'));
      assert.deepEqual(model.modelingPolicy, modelingPolicy);
      assert.deepEqual(model.operationEvidence[0].modelingPolicy, modelingPolicy);
      assert.ok(existsSync(`${prefix}.step`));
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const invalidFlags = [
  ['--curved-contacts'], ['--contact-cap-mm'], ['--contact-cap-mm', '0'],
  ['--curved-contacts', 'strict', '--contact-cap-mm', '0'], ['--curved-contacts', 'automatic'],
  ['--curved-contacts', 'tolerated-regularized'],
  ...['-1', 'NaN', 'Infinity'].map(cap => ['--curved-contacts', 'tolerated-regularized', '--contact-cap-mm', cap]),
];

test('CLI and acceptance reject incomplete or invalid policy flags without writing output', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wonky-policy-invalid-'));
  try {
    for (const flags of invalidFlags) {
      const result = spawnSync(process.execPath, ['bin/wonky.mjs', 'examples/box.fs', '--out', join(dir, 'model'), ...flags], {
        cwd: root, encoding: 'utf8',
      });
      assert.equal(result.status, 1, flags.join(' '));
      assert.match(result.stderr, /requires|Unknown curved-contact policy/);
      assert.throws(() => acceptanceOptions(['--out', dir, ...flags]));
    }
    const acceptance = spawnSync(process.execPath, ['scripts/check-acceptance.mjs', '--out', dir,
      '--curved-contacts', 'tolerated-regularized'], { cwd: root, encoding: 'utf8' });
    assert.equal(acceptance.status, 1);
    assert.match(acceptance.stderr, /explicit finite nonnegative contactCapMm/);
    await assert.rejects(runAcceptance({ out: join(dir, 'api'), modelingPolicy: { curvedContacts: 'tolerated-regularized' } }),
      /explicit finite nonnegative contactCapMm/);
    assert.deepEqual(readdirSync(dir), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('acceptance parsing and successful tracing preserve the selected policy and evidence', async () => {
  assert.deepEqual(acceptanceOptions([]).modelingPolicy, strict);
  for (const cap of [0, 0.002]) {
    const options = acceptanceOptions(['--out', 'out/policy-acceptance', '--curved-contacts', 'tolerated-regularized',
      '--contact-cap-mm', String(cap)]);
    assert.equal(options.out, join(root, 'out/policy-acceptance'));
    assert.deepEqual(options.modelingPolicy, tolerated(cap));
  }
  const traced = await traceBuild(feature(overlap), { feature: 'main', modelingPolicy: tolerated(0.002) });
  assert.equal(traced.error, null);
  assert.equal(traced.firstFailure, null);
  assert.deepEqual(traced.model.modelingPolicy, tolerated(0.002));
  assert.equal(traced.completedOperationEvidence.length, 1);
  assert.deepEqual(traced.completedOperationEvidence, traced.model.operationEvidence);
});

}
