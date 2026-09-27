import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("library-corpus.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { readFileSync } = await import("node:fs");
const { parse, parseExpression } = await import("../src/parser.mjs");
const { Interpreter } = await import("../src/interpreter.mjs");
const { ModelingContext, loadModelingServices } = await import("../src/library.mjs");
const { build } = await import("../src/index.mjs");
const { loadKernel } = await import("../src/kernel.mjs");
const { FeatureScriptError, UnsupportedFeatureError } = await import("../src/errors.mjs");
const { Id, Matrix, Quantity, Transform, Vector, map, matchesType } = await import("../src/values.mjs");
// W1 package "library": pure std value builtins (P3), std queries I (P4a) and
// N-ary opBoolean (P7), checked against the corpus repros and the std source
// semantics cited in src/library.mjs and src/queries.mjs.











const header = 'FeatureScript 3044; import(path:"onshape/std/common.fs",version:"3044.0");';
const feature = body => `${header} export function main(context is Context,id is Id,definition is map){${body}}`;
const cube = (name, a, b) => `fCuboid(context,id+"${name}",{"corner1":vector(${a})*millimeter,"corner2":vector(${b})*millimeter});`;
const created = name => `qCreatedBy(id+"${name}",EntityType.BODY)`;
const repro = path => readFileSync(new URL(`../fixtures/corpus-repro/${path}`, import.meta.url), 'utf8');
const volumes = model => model.bodies.map(body => body.validation.volumeMm3);
const near = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
const bounds = body => [0, 1, 2].map(k => [Math.min(...body.vertices.map(p => p[k])), Math.max(...body.vertices.map(p => p[k]))]);

// An engine with the Bend services that qContainsPoint needs (src/index.mjs
// build() wires the same services), for tests that inspect the engine directly.
async function buildWithServices(source, featureName) {
  const kernel = await loadKernel(), services = await loadModelingServices();
  const engine = new ModelingContext(kernel, { services });
  new Interpreter(engine.builtins()).run(parse(source), featureName, engine.context, new Id(['model']), map({}));
  return engine;
}
async function evaluator() {
  const engine = new ModelingContext(await loadKernel());
  const interpreter = new Interpreter(engine.builtins());
  return text => interpreter.expression(parseExpression(text));
}

test('pure std values: atan2, asin, acos, atan follow units.fs', async () => {
  const evaluate = await evaluator();
  near(evaluate('atan2(3, 4)').value, Math.atan2(3, 4));
  assert.equal(evaluate('atan2(3, 4)').angle, 1);
  near(evaluate('atan2(-3 * millimeter, -4 * millimeter) + 360 * degree').value, Math.atan2(-3, -4) + 2 * Math.PI);
  near(evaluate('atan2(1 * inch, 0 * inch) / degree'), 90);
  assert.throws(() => evaluate('atan2(1 * millimeter, 1)'), FeatureScriptError);
  assert.throws(() => evaluate('atan2(1 * millimeter, 1 * degree)'), FeatureScriptError);
  near(evaluate('asin(0.5) / degree'), 30);
  near(evaluate('acos(0.5) / degree'), 60);
  near(evaluate('atan(1) / degree'), 45);
  assert.throws(() => evaluate('asin(1.5)'), FeatureScriptError);
});

test('pure std values: min, max, toString, makeId, newId, concatenateArrays, makeArray', async () => {
  const evaluate = await evaluator();
  assert.equal(evaluate('min(3, 2)'), 2);
  assert.equal(evaluate('max(1.2, (8 - 0) / 3)'), 8 / 3);
  near(evaluate('min(1 * meter, 1 * inch)').value, 0.0254);
  assert.equal(evaluate('max([1, 5, 3])'), 5);
  assert.equal(evaluate('min([])'), undefined);
  assert.throws(() => evaluate('min(1 * millimeter, 1)'), FeatureScriptError);
  assert.equal(evaluate('toString(3)'), '3');
  assert.equal(evaluate('toString("abc")'), 'abc');
  assert.equal(evaluate('toString([1, 2])'), '[ 1 , 2 ]');
  assert.equal(evaluate('toString(2 * meter)'), '2 meter');
  assert.equal(evaluate('toString(vector(1, 2, 3))'), '(1, 2, 3)');
  // The shared string.fs conversion used by print/println now admits maps;
  // protect recursive unit formatting and FS key order, not host JSON layout.
  assert.equal(evaluate('toString({"b" : 1, "a" : 2 * meter})'), '{ a : 2 meter , b : 1 }');
  const id = evaluate('makeId("model") + "a"');
  assert.ok(id instanceof Id); assert.equal(id.toString(), 'model/a');
  assert.throws(() => evaluate('makeId("a/b")'), FeatureScriptError);
  assert.throws(() => evaluate('makeId("")'), FeatureScriptError);
  assert.equal((evaluate('newId() + "x"')).toString(), 'x');
  assert.deepEqual(evaluate('concatenateArrays([[1, 2], [3], []])'), [1, 2, 3]);
  assert.deepEqual(evaluate('concatenateArrays([1], [[2]])'), [1, [2]]);
  // R20's tray module fills arrays with makeArray (reported by cad-31, 2026-09-24).
  assert.deepEqual(evaluate('makeArray(3, 0)'), [0, 0, 0]);
  assert.deepEqual(evaluate('makeArray(2)'), [undefined, undefined]);
  assert.deepEqual(evaluate('makeArray(0, 1)'), []);
  assert.throws(() => evaluate('makeArray(-1, 0)'), FeatureScriptError);
  assert.throws(() => evaluate('makeArray(1.5, 0)'), FeatureScriptError);
});

test('makeArray slots are independent values under index assignment', async () => {
  const evaluate = await evaluator();
  assert.deepEqual(evaluate('(function() { var a = makeArray(2, [0]); a[0][0] = 5; return a; })()'), [[5], [0]]);
});

test('coordSystem, toWorld, fromWorld follow coordSystem.fs', async () => {
  const evaluate = await evaluator();
  const cs = evaluate('coordSystem(vector(1, 2, 3) * millimeter, vector(0, 2, 0), vector(0, 0, 5))');
  assert.ok(matchesType(cs, 'CoordSystem'));
  assert.deepEqual(cs.xAxis.items, [0, 1, 0]); assert.deepEqual(cs.zAxis.items, [0, 0, 1]);
  assert.throws(() => evaluate('coordSystem(vector(0, 0, 0) * millimeter, vector(1, 0, 0), vector(1, 0, 1))'), FeatureScriptError);
  const world = evaluate('toWorld(coordSystem(vector(1, 2, 3) * millimeter, vector(0, 1, 0), vector(0, 0, 1)))');
  assert.ok(world instanceof Transform);
  // x -> +Y, y = z × x -> -X, z -> +Z; translation = origin.
  assert.deepEqual(world.linear.rows, [[0, -1, 0], [1, 0, 0], [0, 0, 1]]);
  const point = evaluate('toWorld(coordSystem(vector(1, 2, 3) * millimeter, vector(0, 1, 0), vector(0, 0, 1)), vector(1, 0, 0) * millimeter)');
  near(point.items[0].value, 0.001); near(point.items[1].value, 0.003); near(point.items[2].value, 0.003);
  const back = evaluate('fromWorld(coordSystem(vector(1, 2, 3) * millimeter, vector(0, 1, 0), vector(0, 0, 1)), vector(1, 3, 3) * millimeter)');
  back.items.forEach((q, i) => near(q.value, [0.001, 0, 0][i], 1e-12));
  const identity = evaluate('fromWorld(coordSystem(vector(1, 2, 3) * millimeter, vector(0, 1, 0), vector(0, 0, 1))) * toWorld(coordSystem(vector(1, 2, 3) * millimeter, vector(0, 1, 0), vector(0, 0, 1)))');
  identity.linear.rows.forEach((row, i) => row.forEach((v, j) => near(v, i === j ? 1 : 0, 1e-15)));
  identity.translation.items.forEach(q => near(q.value, 0, 1e-15));
  // std toWorld(cSys is CoordSystem): an untagged map matches no overload.
  assert.throws(() => evaluate('toWorld({ "origin" : vector(0, 0, 0) * millimeter, "xAxis" : vector(1, 0, 0), "zAxis" : vector(0, 0, 1) })'), FeatureScriptError);
  const fromPlane = evaluate('coordSystem(plane(vector(0, 0, 1) * millimeter, vector(0, 0, 1), vector(1, 0, 0)))');
  assert.deepEqual(fromPlane.xAxis.items, [1, 0, 0]);
});

test('rotationAround and mirrorAcross build the std transforms', async () => {
  const evaluate = await evaluator();
  const spin = evaluate('rotationAround(line(vector(1, 0, 0) * millimeter, vector(0, 0, 1)), 90 * degree)');
  const moved = evaluate('rotationAround(line(vector(1, 0, 0) * millimeter, vector(0, 0, 1)), 90 * degree) * (vector(2, 0, 0) * millimeter)');
  assert.ok(spin.linear instanceof Matrix);
  // Counterclockwise looking against +Z about x = 1 mm: (2, 0, 0) -> (1, 1, 0).
  moved.items.forEach((q, i) => near(q.value, [0.001, 0.001, 0][i], 1e-15));
  assert.throws(() => evaluate('rotationAround(line(vector(0, 0, 0) * millimeter, vector(0, 0, 1)), 1)'), FeatureScriptError);
  const mirror = evaluate('mirrorAcross(plane(vector(1, 0, 0) * millimeter, vector(1, 0, 0)))');
  assert.deepEqual(mirror.linear.rows, [[-1, 0, 0], [0, 1, 0], [0, 0, 1]]);
  near(mirror.translation.items[0].value, 0.002);
  assert.ok(mirror.translation.items[0] instanceof Quantity);
});

test('pure-values.fs repro: atan2Angle and rotatedCopy build, mirroredCopy stays refused', async () => {
  const source = repro('fs-missing-builtin/pure-values.fs');
  const atan = await build(source, { feature: 'atan2Angle' });
  assert.deepEqual(volumes(atan).map(v => Math.round(v * 1e6) / 1e6), [192]);
  const rotated = await build(source, { feature: 'rotatedCopy' });
  assert.equal(rotated.bodies.length, 2);
  assert.deepEqual(volumes(rotated).map(v => Math.round(v * 1e6) / 1e6), [8, 8]);
  const copy = bounds(rotated.bodies[1]);
  [[-2, 0], [5, 7], [0, 2]].forEach(([lo, hi], k) => { near(copy[k][0], lo, 1e-6); near(copy[k][1], hi, 1e-6); });
  await assert.rejects(build(source, { feature: 'mirroredCopy' }), error => error instanceof UnsupportedFeatureError && error.line === 54 && /Only proper rigid transforms/.test(error.message));
});

test('std-queries.fs repro: makeRobustQuery, qEverything, makeId and qContainsPoint', async () => {
  const source = repro('fs-missing-builtin/std-queries.fs');
  for (const name of ['robustEverything', 'idFromString']) {
    const model = await build(source, { feature: name });
    assert.equal(model.bodies.length, 1, name);
    near(model.bodies[0].validation.volumeMm3, 1000);
  }
  const engine = await buildWithServices(source, 'containsPoint');
  assert.equal(engine.bodies.length, 1);
  assert.deepEqual(bounds(engine.bodies[0]), [[0, 10], [0, 10], [0, 10]]);
  // build() (src/index.mjs) loads the services, so the production CLI builds it.
  const model = await build(source, { feature: 'containsPoint' });
  assert.equal(model.bodies.length, 1);
  assert.deepEqual(bounds(model.bodies[0]), [[0, 10], [0, 10], [0, 10]]);
  // A modeling context without the Bend classifier refuses explicitly, never guesses.
  const bare = new ModelingContext(await loadKernel());
  assert.throws(() => new Interpreter(bare.builtins()).run(parse(source), 'containsPoint', bare.context, new Id(['model']), map({})),
    error => error instanceof UnsupportedFeatureError && /qContainsPoint needs the Bend solid classifier/.test(error.message));
});

test('qContainsPoint: boundary points contain, sketches and vertices refuse, try silent does not hide it', async () => {
  const count = point => `if (size(evaluateQuery(context, qContainsPoint(qAllModifiableSolidBodies(), vector(${point}) * millimeter))) != 1) throw regenError("count ${point}");`;
  await buildWithServices(feature(cube('a', '0,0,0', '10,10,10') + count('10,5,5') + count('5,5,5') +
    'if (size(evaluateQuery(context, qContainsPoint(qAllModifiableSolidBodies(), vector(11, 5, 5) * millimeter))) != 0) throw regenError("outside");'));
  const sketch = 'var s = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1)) });' +
    'skRectangle(s, "r", { "firstCorner" : vector(0, 0) * millimeter, "secondCorner" : vector(1, 1) * millimeter }); skSolve(s);';
  await assert.rejects(buildWithServices(feature(cube('a', '0,0,0', '10,10,10') + sketch +
    'try silent { evaluateQuery(context, qContainsPoint(qCreatedBy(id + "s", EntityType.BODY), vector(1, 1, 1) * millimeter)); }')),
  error => error instanceof UnsupportedFeatureError && /sketch bodies/.test(error.message));
  await assert.rejects(buildWithServices(feature(cube('a', '0,0,0', '10,10,10') +
    `evaluateQuery(context, qContainsPoint(qOwnedByBody(${created('a')}, EntityType.VERTEX), vector(0, 0, 0) * millimeter));`)),
  error => error instanceof UnsupportedFeatureError && /qContainsPoint over vertices is not implemented/.test(error.message));
});

// std defaultFeatures.fs: every Onshape Part Studio has the Origin and the
// Top, Front and Right planes as default bodies, which qEverything includes and
// wonky does not create. Only the solid-filtered form is answered.
test('qEverything, qNothing and qIntersection resolve like query.fs; unfiltered qEverything refuses', async () => {
  const sketch = 'var s = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(vector(0, 0, 50) * millimeter, vector(0, 0, 1)) });' +
    'skRectangle(s, "r", { "firstCorner" : vector(0, 0) * millimeter, "secondCorner" : vector(1, 1) * millimeter }); skSolve(s);';
  const expect = (query, n) => `if (size(evaluateQuery(context, ${query})) != ${n}) throw regenError("${query.replaceAll('"', "'")} != ${n}");`;
  await build(feature(cube('a', '0,0,0', '10,10,10') + cube('b', '20,0,0', '30,10,10') + sketch +
    expect('qBodyType(qEverything(EntityType.BODY), BodyType.SOLID)', 2) +
    expect('qNothing()', 0) +
    expect(`qIntersection([qBodyType(qEverything(EntityType.BODY), BodyType.SOLID), ${created('a')}])`, 1) +
    expect(`qIntersection(${created('a')}, ${created('b')})`, 0) +
    expect(`qUnion([qNothing(), ${created('b')}])`, 1)));
  // Unfiltered BODY, FACE and EDGE forms would count the default bodies and
  // their faces (Onshape: 5 bodies here), so they refuse, also inside try silent.
  for (const type of ['BODY', 'FACE', 'EDGE']) {
    await assert.rejects(build(feature(cube('a', '0,0,0', '10,10,10') + `try silent { evaluateQuery(context, qEverything(EntityType.${type})); }`)),
      error => error instanceof UnsupportedFeatureError && /default bodies/.test(error.message));
  }
  // qBodyType filters faces and edges by their owning body (query.fs), so the
  // solid-filtered face and edge forms are answered, sketch bodies or not.
  await build(feature(cube('a', '0,0,0', '10,10,10') + sketch + expect('qBodyType(qEverything(EntityType.FACE), BodyType.SOLID)', 6) +
    expect('qBodyType(qEverything(EntityType.EDGE), BodyType.SOLID)', 12) +
    expect(`qBodyType(qOwnedByBody(${created('a')}, EntityType.FACE), BodyType.SOLID)`, 6)));
  await assert.rejects(build(feature(cube('a', '0,0,0', '10,10,10') + 'evaluateQuery(context, qEverything(EntityType.VERTEX));')),
    error => error instanceof UnsupportedFeatureError);
});

// Whether a Boolean result inherits the identity of a tool it consumed is not
// documented (std feature.fs makeRobustQuery = evaluateQuery + startTrackingIdentity),
// so resolving such a query refuses instead of answering "nothing".
test('makeRobustQuery tracks a Boolean target, refuses a consumed tool and a split', async () => {
  const join = `opBoolean(context, id + "join", { "tools" : qUnion([${created('a')}, ${created('b')}]), "operationType" : BooleanOperationType.UNION });`;
  const model = await build(feature(cube('a', '0,0,0', '10,10,10') + cube('b', '5,0,0', '15,10,10') +
    `var target = makeRobustQuery(context, ${created('a')});` + join +
    'if (size(evaluateQuery(context, target)) != 1) throw regenError("tracking");'));
  assert.deepEqual(volumes(model).map(Math.round), [1500]);
  await assert.rejects(build(feature(cube('a', '0,0,0', '10,10,10') + cube('b', '5,0,0', '15,10,10') +
    `var tool = makeRobustQuery(context, ${created('b')});` + join + 'try silent { evaluateQuery(context, tool); }')),
  error => error instanceof UnsupportedFeatureError && /consumed/.test(error.message));
  // A body deleted with opDeleteBodies no longer exists: the query is empty.
  await build(feature(cube('a', '0,0,0', '10,10,10') + cube('b', '20,0,0', '30,10,10') +
    `var gone = makeRobustQuery(context, ${created('b')}); opDeleteBodies(context, id + "del", { "entities" : ${created('b')} });` +
    'if (size(evaluateQuery(context, gone)) != 0) throw regenError("deleted");'));
  await assert.rejects(build(feature(cube('box', '0,0,0', '30,10,10') + cube('slab', '10,-1,-1', '20,11,11') +
    `var r = makeRobustQuery(context, ${created('box')});` +
    `opBoolean(context, id + "cut", { "targets" : ${created('box')}, "tools" : ${created('slab')}, "operationType" : BooleanOperationType.SUBTRACTION });` +
    'evaluateQuery(context, r);')), error => error instanceof UnsupportedFeatureError && /split/.test(error.message));
  // A split before tracking started is not a reason to refuse.
  await build(feature(cube('box', '0,0,0', '30,10,10') + cube('slab', '10,-1,-1', '20,11,11') +
    `opBoolean(context, id + "cut", { "targets" : ${created('box')}, "tools" : ${created('slab')}, "operationType" : BooleanOperationType.SUBTRACTION });` +
    `if (size(evaluateQuery(context, makeRobustQuery(context, ${created('box')}))) != 2) throw regenError("pieces");`));
});

test('nary-union.fs repro: both features give one body of 15000 mm³', async () => {
  const source = repro('boolean-capability/nary-union.fs');
  for (const name of ['threeToolUnion', 'bridgedThreeToolUnion']) {
    const model = await build(source, { feature: name });
    assert.equal(model.bodies.length, 1, name);
    near(model.bodies[0].validation.volumeMm3, 15000, 1e-9);
    const decomposition = model.operationEvidence.at(-1);
    assert.equal(decomposition.operationId, 'model/join');
    assert.match(decomposition.method, /N-ary opBoolean/);
    assert.ok(decomposition.decomposition.steps.every(step => ['merged', 'not touching', 'disjoint bounds', 'tool touching', 'tool not touching', 'disjoint bounds: tool'].includes(step.outcome)));
  }
});

test('N-ary subtraction and intersection fold over every piece; empty operands refuse explicitly', async () => {
  const subtract = await build(feature(cube('plate', '0,0,0', '30,20,5') + cube('t1', '2,2,-1', '5,5,6') + cube('t2', '10,2,-1', '13,5,6') + cube('far', '100,0,0', '101,1,1') +
    `opBoolean(context, id + "cut", { "targets" : ${created('plate')}, "tools" : qUnion([${created('t1')}, ${created('t2')}, ${created('far')}]), "operationType" : BooleanOperationType.SUBTRACTION });`));
  assert.equal(subtract.bodies.length, 1);
  near(subtract.bodies[0].validation.volumeMm3, 3000 - 2 * 45, 1e-9);
  const kept = await build(feature(cube('box', '0,0,0', '30,10,10') + cube('slab', '10,-1,-1', '20,11,11') + cube('slab2', '24,-1,-1', '26,11,11') +
    `opBoolean(context, id + "cut", { "targets" : ${created('box')}, "tools" : qUnion([${created('slab')}, ${created('slab2')}]), "operationType" : BooleanOperationType.SUBTRACTION, "keepTools" : true });` +
    `if (size(evaluateQuery(context, ${created('box')})) != 3) throw regenError("pieces keep the target lineage");`));
  assert.deepEqual(volumes(kept).map(Math.round).sort((a, b) => a - b), [288, 400, 400, 1000, 1440]);
  const intersect = await build(feature(cube('a', '0,0,0', '10,10,10') + cube('b', '5,0,0', '15,10,10') + cube('c', '0,5,0', '10,15,10') +
    `opBoolean(context, id + "x", { "tools" : qUnion([${created('a')}, ${created('b')}, ${created('c')}]), "operationType" : BooleanOperationType.INTERSECTION });`));
  assert.deepEqual(volumes(intersect).map(Math.round), [250]);
  await assert.rejects(build(feature(cube('a', '0,0,0', '10,10,10') +
    `opBoolean(context, id + "x", { "targets" : ${created('a')}, "tools" : qNothing(), "operationType" : BooleanOperationType.SUBTRACTION });`)),
  error => error instanceof UnsupportedFeatureError && /tools resolved to no bodies/.test(error.message));
});

// std geomOperations.fs opBoolean UNION "will merge any tool bodies that
// intersect or abut": tools that touch nothing stay as they were, with their
// own identity, whether the call has two tools (binary path) or more (N-ary).
test('a union of disjoint tools leaves them untouched on the binary and the N-ary path alike', async () => {
  const count = name => `size(evaluateQuery(context, ${created(name)}))`;
  for (const names of [['a', 'b'], ['a', 'b', 'c']]) {
    const boxes = names.map((name, i) => cube(name, `${20 * i},0,0`, `${20 * i + 10},10,10`)).join('');
    const tools = `qUnion([${names.map(created).join(', ')}])`;
    const model = await build(feature(boxes + `var rb = makeRobustQuery(context, ${created('b')});` +
      `opBoolean(context, id + "u", { "tools" : ${tools}, "operationType" : BooleanOperationType.UNION });` +
      `if (${names.map(count).join(' + ')} != ${names.length} || size(evaluateQuery(context, ${created('u')})) != 0 || size(evaluateQuery(context, rb)) != 1) throw regenError("identities");` +
      `opDeleteBodies(context, id + "del", { "entities" : ${created('a')} });`));
    assert.deepEqual(model.bodies.map(body => body.id).sort(), names.slice(1).map(name => `model/${name}`), names.join(''));
  }
});

// std boolean.fs reportBooleanNoOpWarning: an intersection that leaves nothing
// is the feature info BOOLEAN_INTERSECT_NO_OP, not an error. Whether Onshape
// keeps or deletes the tools is not verified, so wonky refuses explicitly on
// the binary and the N-ary path, also inside try silent (verifier nary2.fs).
test('an INTERSECTION with an empty result is an explicit capability error, never a silent deletion', async () => {
  for (const names of [['a', 'b'], ['a', 'b', 'c']]) {
    const boxes = names.map((name, i) => cube(name, `${20 * i},0,0`, `${20 * i + 10},10,10`)).join('');
    const call = `opBoolean(context, id + "x", { "tools" : qUnion([${names.map(created).join(', ')}]), "operationType" : BooleanOperationType.INTERSECTION });`;
    for (const body of [call, `try silent { ${call} }`]) {
      await assert.rejects(build(feature(boxes + body)), error => error instanceof UnsupportedFeatureError && /empty result/.test(error.message), `${names.join('')}: ${body}`);
    }
  }
  // Touching only in the fold: a ∩ b is nonempty, then ∩ c is empty.
  await assert.rejects(build(feature(cube('a', '0,0,0', '10,10,10') + cube('b', '5,0,0', '15,10,10') + cube('c', '0,50,0', '10,60,10') +
    `opBoolean(context, id + "x", { "tools" : qUnion([${created('a')}, ${created('b')}, ${created('c')}]), "operationType" : BooleanOperationType.INTERSECTION });`)), /empty result/);
});

// std boolean.fs:1764 reportBooleanNoOpWarning reports a subtraction that
// removes nothing as BOOLEAN_SUBTRACT_NO_OP, exactly like the empty
// intersection above. Whether Onshape keeps the tools and gives the target the
// feature identity is not verified, so both paths refuse before committing,
// whether the kernel ran (an abutting tool) or bounds ruled the tools out.
test('a SUBTRACTION that removes nothing refuses on the binary and the N-ary path alike; untouched targets keep their identity', async () => {
  const noOp = error => error instanceof UnsupportedFeatureError && /SUBTRACTION that removes nothing/.test(error.message);
  const target = cube('target', '0,0,0', '10,10,10');
  for (const [tools, names] of [[cube('t1', '10,0,0', '20,10,10'), ['t1']], [cube('t1', '50,0,0', '60,10,10'), ['t1']],
    [cube('t1', '10,0,0', '20,10,10') + cube('t2', '50,0,0', '60,10,10'), ['t1', 't2']]]) {
    const call = `opBoolean(context, id + "cut", { "targets" : ${created('target')}, "tools" : qUnion([${names.map(created).join(', ')}]), "operationType" : BooleanOperationType.SUBTRACTION });`;
    for (const body of [call, `try silent { ${call} }`]) await assert.rejects(build(feature(target + tools + body)), noOp, `${names}: ${body}`);
  }
  // Two targets, one of them untouched (the tool only abuts it, so the kernel
  // runs): the call is not a no-op, and the untouched target keeps its body and
  // record, so qCreatedBy(cut) finds only the cut target.
  const model = await build(feature(target + cube('other', '0,20,0', '10,30,10') + cube('tool', '5,5,5', '6,20,11') +
    `opBoolean(context, id + "cut", { "targets" : qUnion([${created('target')}, ${created('other')}]), "tools" : ${created('tool')}, "operationType" : BooleanOperationType.SUBTRACTION });` +
    `if (size(evaluateQuery(context, ${created('cut')})) != 1 || size(evaluateQuery(context, ${created('other')})) != 1) throw regenError("identities");`));
  // (The cut body's id carries the internal step id, a known open item of the N-ary path.)
  assert.deepEqual(model.bodies.map(body => [body.id.replace(/~step\d+\//, ''), Math.round(body.validation.volumeMm3)]).sort(), [['model/cut/0', 975], ['model/other', 1000]]);
});

// Whether a SUBTRACTION removed anything is read from the kernel's account of
// the result (planar face provenance, coaxial surfaces), not from a relative
// volume threshold: a 1.25e-4 mm3 corner notch in a 100 mm cube (relative
// 1.25e-10) and a 5e-9 mm coaxial trim (relative 5e-10) are real cuts that
// Onshape makes, and the 1e-9 volume rule refused the binary call and silently
// kept the N-ary target unchanged.
test('a SUBTRACTION below any relative volume threshold still cuts, on the binary and the N-ary path', async () => {
  const notch = cube('t', '0,0,0', '100,100,100') + cube('k', '-0.05,-0.05,-0.05', '0.05,0.05,0.05');
  const binary = await build(feature(notch + `opBoolean(context, id + "cut", { "targets" : ${created('t')}, "tools" : ${created('k')}, "operationType" : BooleanOperationType.SUBTRACTION });`));
  const nary = await build(feature(notch + cube('far', '200,0,0', '210,10,10') +
    `opBoolean(context, id + "cut", { "targets" : ${created('t')}, "tools" : qUnion([${created('k')}, ${created('far')}]), "operationType" : BooleanOperationType.SUBTRACTION });`));
  for (const model of [binary, nary]) {
    assert.equal(model.bodies.length, 1);
    near(model.bodies[0].validation.volumeMm3, 1e6 - 0.1 ** 3 / 8, 1e-14);
    assert.ok(model.bodies[0].validation.volumeMm3 < 1e6 - 1e-4);
    assert.match(model.bodies[0].id, /^model\/cut\//);
  }
  assert.deepEqual(nary.operationEvidence.at(-1).decomposition.steps.map(step => step.outcome), ['1 bodies', 'disjoint bounds: unchanged']);
  const cylinder = (name, r, z0) => `{ const sk = newSketchOnPlane(context, id + "${name}sk", { "sketchPlane" : plane(vector(0, 0, ${z0}) * millimeter, vector(0, 0, 1)) });` +
    `skCircle(sk, "c", { "center" : vector(0, 0) * millimeter, "radius" : ${r} * millimeter }); skSolve(sk);` +
    `opExtrude(context, id + "${name}", { "entities" : qSketchRegion(id + "${name}sk"), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 10 * millimeter }); }`;
  const coaxial = z0 => feature(cylinder('t', 5, 0) + cylinder('k', 8, z0) +
    `opBoolean(context, id + "cut", { "targets" : ${created('t')}, "tools" : ${created('k')}, "operationType" : BooleanOperationType.SUBTRACTION });`);
  const trimmed = await build(coaxial('9.999999995'));
  assert.equal(trimmed.bodies.length, 1);
  near(trimmed.bodies[0].validation.volumeMm3, Math.PI * 25 * 9.999999995, 1e-12);
  assert.equal(Math.max(...trimmed.bodies[0].vertices.map(p => p[2])) < 10, true);
  // Abutting (and within the coaxial path's own 1e-9 mm axis tolerance) is still a no-op.
  for (const z0 of ['10', '9.9999999999']) await assert.rejects(build(coaxial(z0)), error => error instanceof UnsupportedFeatureError && /SUBTRACTION that removes nothing/.test(error.message), z0);
});

// The N-ary UNION folds in source order and skips a pair only by geometry:
// bounds farther apart than the separation margin, for the pair itself or for
// every tool a merged body was built from. It never lets the kernel's verdict
// on another pair stand in for a call: for C touching the component B only at
// a vertex, Bend returns two bodies for C with B, but refuses the merged A+C
// with B, and refuses the same unions done one by one, so the N-ary call must
// refuse as well (a tool-first kernel test had turned this into two bodies).
test('the N-ary UNION skips a merged body only by the bounds of its tools, and agrees with binary unions on vertex contact', async () => {
  const unionOf = names => `opBoolean(context, id + "u", { "tools" : qUnion([${names.map(created).join(', ')}]), "operationType" : BooleanOperationType.UNION });`;
  const steps = model => model.operationEvidence.at(-1).decomposition.steps.map(step => [step.operationId, step.outcome]);
  // a and b are near (0.0008 mm, inside the margin) but apart; c touches a.
  const near3 = await build(feature(cube('a', '0,0,0', '10,10,10') + cube('b', '10.0008,0,0', '20,10,10') + cube('c', '0,10,0', '10,20,10') + unionOf(['a', 'b', 'c']) +
    `if (size(evaluateQuery(context, ${created('u')})) != 1 || size(evaluateQuery(context, ${created('a')})) != 1 || size(evaluateQuery(context, ${created('b')})) != 1) throw regenError("identities");`));
  assert.deepEqual(near3.bodies.map(body => [body.id, Math.round(body.validation.volumeMm3 * 1000) / 1000]).sort(), [['model/b', 999.92], ['model/u/~step1/0', 2000]]);
  assert.deepEqual(steps(near3), [['model/u/~step0', 'not touching'], ['model/u/~step1', 'merged'], ['model/u/~step2', 'not touching']]);
  // a+c overlaps b's bounds, but a and c are each more than the margin from b.
  const apart = await build(feature(cube('a', '0,0,0', '10,10,10') + cube('b', '20,0,0', '30,9,10') + cube('c', '0,10,0', '25,20,10') + unionOf(['a', 'b', 'c'])));
  assert.deepEqual(apart.bodies.map(body => [body.id, Math.round(body.validation.volumeMm3)]).sort(), [['model/b', 900], ['model/u/~step1/0', 3500]]);
  assert.deepEqual(steps(apart), [[null, 'disjoint bounds'], ['model/u/~step1', 'merged'], [null, 'disjoint bounds: every tool of the merged body']]);
  // Vertex contact: c meets a by a face and b only at the vertex (20,10,10).
  const boxes = cube('a', '0,0,0', '10,10,10') + cube('b', '20,10,10', '30,20,20') + cube('c', '10,0,0', '20,10,10');
  const refused = error => error instanceof UnsupportedFeatureError && /union unresolved/.test(error.message);
  await assert.rejects(build(feature(boxes + unionOf(['a', 'b', 'c']))), refused);
  await assert.rejects(build(feature(boxes + `opBoolean(context, id + "ac", { "tools" : qUnion([${created('a')}, ${created('c')}]), "operationType" : BooleanOperationType.UNION });` +
    `opBoolean(context, id + "acb", { "tools" : qUnion([${created('a')}, ${created('b')}]), "operationType" : BooleanOperationType.UNION });`)), refused);
});

}
