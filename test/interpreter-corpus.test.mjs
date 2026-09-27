import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend() || missing("fixtures/r10b/r10b.fs");
if (publicTreeSkip) {
  test("interpreter-corpus.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { readFileSync } = await import("node:fs");
const { parse } = await import("../src/parser.mjs");
const { Interpreter } = await import("../src/interpreter.mjs");
const { ModelingContext } = await import("../src/library.mjs");
const { build } = await import("../src/index.mjs");
const { catchable, fail, FeatureScriptError, FeatureScriptException, UnsupportedFeatureError } = await import("../src/errors.mjs");
const { EnumValue, Id, map, Quantity } = await import("../src/values.mjs");
// Interpreter semantics the corpus triage found missing (W1, package P2):
// feature dialog defaults, annotation metadata, type tags, bound specs and
// unit handling. Each behavior follows Onshape std (valueBounds.fs,
// properties.fs, curveGeometry.fs, feature.fs) and the repros in
// fixtures/corpus-repro/fs-interpreter-semantics/.










const repro = name => readFileSync(new URL(`../fixtures/corpus-repro/${name}`, import.meta.url), 'utf8');
const volume = model => model.bodies.reduce((sum, body) => sum + body.validation.volumeMm3, 0);
const header = 'FeatureScript 2909; import(path : "onshape/std/geometry.fs", version : "2909.0");';
// A feature whose body is 'body' and whose precondition is 'precondition'.
const featureSource = (precondition, body, defaults = '') => `${header}
  annotation { "Feature Type Name" : "Test" }
  export const main = defineFeature(function(context is Context, id is Id, definition is map)
    precondition { ${precondition} }
    { ${body} }${defaults ? `, ${defaults}` : ''});`;
const box = (x, y, z) => `fCuboid(context, id + "c", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(${x}, ${y}, ${z}) * millimeter });`;

// The definition map run() passes to the selected feature, without building.
function definitionOf(source, feature) {
  const engine = new ModelingContext(null), interpreter = new Interpreter(engine.builtins());
  const call = interpreter.call.bind(interpreter); let captured;
  interpreter.call = (fn, args, loc) => {
    if (loc === null && !captured) { captured = args[2]; throw new Error('captured'); }
    return call(fn, args, loc);
  };
  assert.throws(() => interpreter.run(parse(source), feature, engine.context, new Id(['model']), map({})), /captured/);
  return captured;
}
const mm = value => { assert.ok(value instanceof Quantity && value.dimension === 1 && value.angle === 0, 'expected a length'); return value.value * 1000; };

test('fs-interpreter-semantics repros build as their README states', async () => {
  const cases = [
    ['fs-interpreter-semantics/length-bounds-default.fs', 15625], // LENGTH_BOUNDS default 25 mm
    ['fs-interpreter-semantics/boolean-default.fs', 1000], // open = false
    ['fs-interpreter-semantics/annotation-filter-and.fs', 1000],
    ['fs-interpreter-semantics/angle-bound-spec.fs', 1000],
    ['fs-interpreter-semantics/color-type-tag.fs', 1000],
    ['annotation-filter-and.fs', 1000],
    ['feature-parameter-defaults.fs', 3500], // position 25 mm, review false
  ];
  for (const [file, expected] of cases) {
    const model = await build(repro(file));
    assert.equal(model.bodies.length, 1, file);
    assert.ok(Math.abs(volume(model) - expected) < 1e-6, `${file}: ${volume(model)} mm³`);
  }
});

test('the corpus unit source error still fails: a unitless vector plus a length vector', async () => {
  await assert.rejects(build(repro('fs-interpreter-semantics/units-source-error.fs')), error => /Incompatible units in expression/.test(error.message) && error.line === 15 && error.column === 22);
  await assert.rejects(build(featureSource('', `const p = vector(1, 2, 3) + vector(1, 2, 3) * millimeter; ${box(1, 1, 1)}`)), /Incompatible units/);
});

test('an IntegerBoundSpec with (unitless) gives its default and checks its range', async () => {
  const source = repro('fs-missing-builtin/integer-bound.fs');
  assert.ok(Math.abs(volume(await build(source, { feature: 'integerBound' })) - 2) < 1e-9);
  assert.ok(Math.abs(volume(await build(source, { feature: 'plainBox' })) - 1) < 1e-9);
  assert.ok(Math.abs(volume(await build(source, { feature: 'integerBound', parameters: { count: '4' } })) - 4) < 1e-9);
  await assert.rejects(build(source, { feature: 'integerBound', parameters: { count: '5' } }), /PARAMETER_OUT_OF_RANGE/); // valueBounds.fs verifyBounds throws
  await assert.rejects(build(source, { feature: 'integerBound', parameters: { count: '2.5' } }), /precondition/);
});

test('supplied parameters win over every dialog default', async () => {
  assert.ok(Math.abs(volume(await build(repro('fs-interpreter-semantics/length-bounds-default.fs'), { parameters: { size: '10*millimeter' } })) - 1000) < 1e-6);
  assert.ok(Math.abs(volume(await build(repro('fs-interpreter-semantics/boolean-default.fs'), { parameters: { open: 'true' } })) - 500) < 1e-6);
});

// std feature.fs defineFeature: the defaults map "does NOT control the
// user-visible default value when creating this feature"; it is merged under
// the definition (mergeMaps(defaults, definition)) and so only fills keys the
// dialog does not have.
test('dialog default precedence: defineFeature map < implied < "Default" annotation < bound spec < supplied', () => {
  const source = featureSource(`
      annotation { "Name" : "Flag" } definition.flag is boolean;
      annotation { "Name" : "Mapped" } definition.mapped is boolean;
      annotation { "Name" : "Annotated", "Default" : true } definition.annotated is boolean;
      annotation { "Name" : "Width", "Default" : 7 * millimeter } isLength(definition.width, { (millimeter) : [1, 12, 40] } as LengthBoundSpec);`,
  box(1, 1, 1), '{ "mapped" : true, "annotated" : false, "width" : 3 * millimeter }');
  const definition = definitionOf(source, 'main');
  assert.equal(definition.flag, false);
  assert.equal(definition.mapped, false, 'the implied dialog default, not the defineFeature map');
  assert.equal(definition.annotated, true);
  assert.equal(mm(definition.width), 12);
});

test('the defineFeature defaults map fills only keys the dialog lacks; dialog defaults beat it', async () => {
  // Onshape inserts half = false (boolean dialog default) and side = LEFT
  // (first enum member) when the feature is created; the map value never applies.
  const flag = featureSource('annotation { "Name" : "Half" } definition.half is boolean;', box(10, 10, 'definition.half ? 5 : 10'), '{ "half" : true }');
  assert.ok(Math.abs(volume(await build(flag)) - 1000) < 1e-6);
  const choice = `${header}
    export enum Side { LEFT, RIGHT }
    export const main = defineFeature(function(context is Context, id is Id, definition is map)
      precondition { annotation { "Name" : "Side" } definition.side is Side; }
      { ${box(10, 10, 'definition.side == Side.RIGHT ? 20 : 10')} }, { "side" : Side.RIGHT });`;
  assert.ok(Math.abs(volume(await build(choice)) - 1000) < 1e-6);
  // A key outside the dialog comes from the map, as when called from FeatureScript.
  const hidden = featureSource('', box(10, 10, 'definition.depth'), '{ "depth" : 5 }');
  assert.ok(Math.abs(volume(await build(hidden)) - 500) < 1e-6);
});

test('implied defaults: boolean false, string "", first enum member', async () => {
  const source = `${header}
    export enum Side { LEFT, RIGHT }
    annotation { "Feature Type Name" : "Test" }
    export const main = defineFeature(function(context is Context, id is Id, definition is map)
      precondition {
        annotation { "Name" : "Flag" } definition.flag is boolean;
        annotation { "Name" : "Label" } definition.label is string;
        annotation { "Name" : "Side" } definition.side is Side;
        annotation { "Name" : "Operation" } definition.operation is BooleanOperationType;
      } {
        if (definition.flag != false || definition.label != "" || definition.side != Side.LEFT || definition.operation != BooleanOperationType.UNION)
          throw regenError("wrong implied default");
        ${box(10, 10, 10)}
      });`;
  const definition = definitionOf(source, 'main');
  assert.ok(definition.side instanceof EnumValue && definition.side.name === 'LEFT');
  assert.equal((await build(source)).bodies.length, 1);
});

test('an unpicked Query parameter is a capability error where it is resolved, never an invented selection', async () => {
  const precondition = 'annotation { "Name" : "Part", "Filter" : EntityType.BODY && BodyType.SOLID, "MaxNumberOfPicks" : 1 } definition.part is Query;';
  // A body that never reads the pick builds (fixtures/corpus-repro/.../annotation-filter-and.fs).
  assert.equal((await build(featureSource(precondition, box(10, 10, 10)))).bodies.length, 1);
  assert.equal(definitionOf(featureSource(precondition, box(1, 1, 1)), 'main').part.type, 'Query');
  // Reading it fails loudly, also inside try silent, and not as a model check.
  const reads = featureSource(precondition, `${box(10, 10, 10)}
    try silent { opDeleteBodies(context, id + "picked", { "entities" : definition.part }); }`);
  await assert.rejects(build(reads), error => error instanceof UnsupportedFeatureError && /uiSelection/.test(error.message));
  const counts = featureSource(precondition, `${box(10, 10, 10)} if (size(evaluateQuery(context, definition.part)) != 1) throw regenError("Select original part");`);
  await assert.rejects(build(counts), UnsupportedFeatureError);
  // A supplied selection replaces it.
  assert.equal((await build(reads, { parameters: { part: 'qUnion([])' } })).bodies.length, 1);
});

test('parameters declared inside precondition if-blocks get their defaults too', () => {
  const source = featureSource(`
      annotation { "Name" : "Custom" } definition.custom is boolean;
      if (definition.custom) {
        annotation { "Name" : "Size" } isLength(definition.size, NONNEGATIVE_LENGTH_BOUNDS);
      } else {
        annotation { "Name" : "Angle" } isAngle(definition.angle, ANGLE_360_BOUNDS);
      }`, box(1, 1, 1));
  const definition = definitionOf(source, 'main');
  assert.equal(definition.custom, false);
  assert.equal(mm(definition.size), 25);
  assert.ok(Math.abs(definition.angle.value - 30 * Math.PI / 180) < 1e-15 && definition.angle.angle === 1);
});

test('annotations are metadata: only "Default" is evaluated, and a failing "Default" fails loudly', async () => {
  const filterOnly = featureSource('annotation { "Name" : "Part", "Filter" : notDefinedAnywhere && (1 + "x"), "UIHint" : UIHint.NONSENSE } definition.part is Query;', box(10, 10, 10));
  assert.equal((await build(filterOnly)).bodies.length, 1);
  const badDefault = featureSource('annotation { "Name" : "Flag", "Default" : notDefinedAnywhere } definition.flag is boolean;', box(10, 10, 10));
  await assert.rejects(build(badDefault), error => error instanceof UnsupportedFeatureError && /notDefinedAnywhere/.test(error.message));
});

test('std bound specs carry the std valueBounds.fs defaults in millimeter and degree documents', () => {
  const source = featureSource(`
      isLength(definition.a, LENGTH_BOUNDS);
      isLength(definition.b, NONNEGATIVE_ZERO_DEFAULT_LENGTH_BOUNDS);
      isLength(definition.c, BLEND_BOUNDS);
      isAngle(definition.d, ANGLE_360_90_DEFAULT_BOUNDS);
      isInteger(definition.e, POSITIVE_COUNT_BOUNDS);
      isReal(definition.f, POSITIVE_REAL_BOUNDS);
      isLength(definition.g, { (inch) : [0, 1, 1e4] } as LengthBoundSpec);`, box(1, 1, 1));
  const d = definitionOf(source, 'main');
  assert.equal(mm(d.a), 25);
  assert.equal(mm(d.b), 0);
  assert.equal(mm(d.c), 5);
  assert.ok(Math.abs(d.d.value - Math.PI / 2) < 1e-15);
  assert.equal(d.e, 2);
  assert.equal(d.f, 1);
  // valueBounds.fs: "The default value for a unit that is not listed is the default value of the first unit".
  assert.ok(Math.abs(mm(d.g) - 25.4) < 1e-12);
});

test('AngleBoundSpec: typecheck, default and range', async () => {
  const source = `${header}
    const TILT = { (degree) : [60, 65, 70] } as AngleBoundSpec;
    annotation { "Feature Type Name" : "Tilt" }
    export const main = defineFeature(function(context is Context, id is Id, definition is map)
      precondition { annotation { "Name" : "Tilt" } isAngle(definition.tilt, TILT); }
      { if (abs(definition.tilt / degree - 65) > 1e-12) throw regenError("tilt default"); ${box(10, 10, 10)} });`;
  assert.equal((await build(source)).bodies.length, 1);
  await assert.rejects(build(source, { parameters: { tilt: '71*degree' } }), /PARAMETER_OUT_OF_RANGE/);
  await assert.rejects(build(source, { parameters: { tilt: '65*millimeter' } }), /precondition/);
  await assert.rejects(build(featureSource('', `const bad = { (degree) : [70, 65, 60] } as AngleBoundSpec; ${box(1, 1, 1)}`)), /Invalid AngleBoundSpec/);
  await assert.rejects(build(featureSource('', `const bad = { (millimeter) : [0, 1, 2] } as AngleBoundSpec; ${box(1, 1, 1)}`)), /Invalid AngleBoundSpec/);
  await assert.rejects(build(featureSource('', `const bad = { (unitless) : 3 } as IntegerBoundSpec; ${box(1, 1, 1)}`)), /Invalid IntegerBoundSpec/);
});

test('Color and Line are tagged maps: is, as, member assignment and export', async () => {
  const model = await build(featureSource('', `
    const c = color(0.65, 0.57, 0.43);
    if (!(c is Color) || !(c is map) || c.alpha != 1) throw regenError("color() is a Color");
    if ({ "red" : 1, "green" : 0, "blue" : 0, "alpha" : 1 } is Color) throw regenError("an untagged map is not a Color");
    var d = { "red" : 1, "green" : 0, "blue" : 0, "alpha" : 1 } as Color;
    d.green = 0.5;
    if (!(d is Color)) throw regenError("member assignment keeps the tag");
    const l = line(vector(0, 0, 0) * millimeter, vector(0, 0, 2));
    if (!(l is Line) || l.direction != vector(0, 0, 1)) throw regenError("line() is a Line");
    if (!({ "origin" : vector(0, 0, 0) * millimeter, "direction" : vector(1, 0, 0) } as Line is Line)) throw regenError("as Line");
    ${box(10, 10, 10)}
    setProperty(context, { "entities" : qCreatedBy(id + "c", EntityType.BODY), "propertyType" : PropertyType.APPEARANCE, "value" : c });
    if (!(getProperty(context, { "entity" : qCreatedBy(id + "c", EntityType.BODY), "propertyType" : PropertyType.APPEARANCE }) is Color)) throw regenError("appearance");`));
  assert.deepEqual(JSON.parse(JSON.stringify(model.bodies[0].appearance)), { red: 0.65, green: 0.57, blue: 0.43, alpha: 1 });
  await assert.rejects(build(featureSource('', `const c = { "red" : 2, "green" : 0, "blue" : 0, "alpha" : 1 } as Color; ${box(1, 1, 1)}`)), /Invalid Color/);
  await assert.rejects(build(featureSource('', `const l = { "origin" : vector(0, 0, 0) * millimeter, "direction" : vector(2, 0, 0) } as Line; ${box(1, 1, 1)}`)), /Invalid Line/);
  // A type wonky does not model is a capability gap, never a (catchable) failed cast.
  await assert.rejects(build(featureSource('', `const c = { "red" : 1 } as Nonsense; ${box(1, 1, 1)}`)), error => error instanceof UnsupportedFeatureError && /Type 'Nonsense' is not implemented/.test(error.message));
});

test('for-in over maps binds key and value, in key order; over arrays the index', async () => {
  const model = await build(featureSource('', `
    var order = "";
    for (var k, v in { "b" : 2, "a" : 1, "c" : 3 }) order = order ~ k ~ v;
    if (order != "a1b2c3") throw regenError("key order " ~ order);
    var pairs = "";
    for (var entry in { "y" : 2, "x" : 1 }) pairs = pairs ~ entry.key ~ entry.value;
    if (pairs != "x1y2") throw regenError("entry form " ~ pairs);
    var indices = 0;
    for (var i, item in ["p", "q", "r"]) indices += i;
    if (indices != 3) throw regenError("indices");
    ${box(10, 10, 10)}`));
  assert.equal(model.bodies.length, 1);
  const reproModel = await build(repro('for-in-key-value.fs'));
  assert.ok(Math.abs(volume(reproModel) - 9000) < 1e-6);
});

test('catch without a binding and try statements never swallow capability errors', async () => {
  assert.ok(Math.abs(volume(await build(repro('fs-needs-partstudio-input/catch-without-binding.fs'))) - 2000) < 1e-6);
  assert.equal((await build(featureSource('', `try { throw regenError("x"); } catch { } try silent { throw regenError("y"); } ${box(1, 1, 1)}`))).bodies.length, 1);
  await assert.rejects(build(featureSource('', `try silent { opNotImplementedAnywhere(context, id + "x", {}); } ${box(1, 1, 1)}`)), UnsupportedFeatureError);
});

test('r10b definition maps are unchanged by the dialog defaults', () => {
  const source = readFileSync(new URL('../fixtures/r10b/r10b.fs', import.meta.url), 'utf8');
  const d = definitionOf(source, 'singleStepR10b');
  assert.deepEqual(Object.keys(d).sort(), ['catchHeight', 'catchPitch', 'edgeAngle', 'innerWallThickness', 'noseLength', 'overrideNose']);
  assert.equal(d.edgeAngle.enumType, 'R10bEdgeAngle'); assert.equal(d.edgeAngle.name, 'K15');
  assert.equal(d.overrideNose, false);
  assert.equal(mm(d.noseLength), 0);
  assert.ok(Math.abs(mm(d.catchPitch) - 4) < 1e-12);
  assert.ok(Math.abs(mm(d.catchHeight) - 0.5) < 1e-12);
  assert.ok(Math.abs(mm(d.innerWallThickness) - 3.2) < 1e-12);
});

// FsDoc exceptions.html: try catches FeatureScript exceptions (a failing
// precondition, an invalid numeric operation, a map lookup on undefined, a
// failing operation). wonky's own limits are not exceptions: a missing std
// overload, a type wonky does not model, the step budget and a kernel
// self-audit must escape every try, or a try silent would skip real work.
test('try and try silent catch FeatureScript exceptions only, never wonky gaps or limits', async () => {
  assert.ok(catchable(new FeatureScriptException('x')) && !catchable(new FeatureScriptError('x')) && !catchable(new UnsupportedFeatureError('x')));
  // Modeled exceptions stay catchable: user throws (all regenError overloads),
  // failed preconditions, units, array bounds, map lookup on undefined.
  assert.equal((await build(featureSource('', `
    var caught = 0;
    try silent { throw regenError("a", ["catchPitch"]); } catch { caught += 1; }
    try { const x = 1 * millimeter + 1; } catch { caught += 1; }
    try { const x = [1][3]; } catch { caught += 1; }
    try { const u = undefined; const x = u.field; } catch { caught += 1; }
    try { const x = sqrt(-1); } catch { caught += 1; }
    if (caught != 5) throw regenError("caught " ~ caught);
    ${box(1, 1, 1)}`))).bodies.length, 1);
  // std query.fs qUnion(query1, query2) and units.fs isLength(val) exist, so
  // they must run, not fail into the try silent (verifier overloads.fs).
  const union = await build(featureSource('', `
    fCuboid(context, id + "a", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(10, 10, 10) * millimeter });
    fCuboid(context, id + "b", { "corner1" : vector(5, 0, 0) * millimeter, "corner2" : vector(15, 10, 10) * millimeter });
    if (try silent(isLength(5 * millimeter)) != true || isLength(5) != false) throw regenError("isLength(val)");
    try silent { opBoolean(context, id + "u", { "tools" : qUnion(qCreatedBy(id + "a", EntityType.BODY), qCreatedBy(id + "b", EntityType.BODY)), "operationType" : BooleanOperationType.UNION }); }`));
  assert.equal(union.bodies.length, 1);
  assert.ok(Math.abs(volume(union) - 1500) < 1e-6);
  // An overload wonky does not implement (math.fs floor(value, multiple)), an
  // std type wonky does not model, an Id + fraction: capability errors, also in try silent.
  for (const statement of ['const x = floor(5, 2);', 'const x = { "a" : 1 } is Cylinder;', 'const x = id + 1.5;', 'const x = "a" < "b";']) {
    await assert.rejects(build(featureSource('', `try silent { ${statement} } ${box(1, 1, 1)}`)), error => error instanceof UnsupportedFeatureError, statement);
  }
  // The step budget escapes try silent.
  await assert.rejects(build(featureSource('', `try silent { while (true) { } } ${box(1, 1, 1)}`), { maxSteps: 1000 }), /Execution limit exceeded/);
  // A builtin that stops with fail() (a kernel self-audit, a resource limit) escapes try.
  const engine = new ModelingContext(null);
  const audit = { type: 'builtin', name: 'audit', min: 0, max: 0, call: (args, loc) => fail('Bend result failed validation', loc) };
  const interpreter = new Interpreter({ ...engine.builtins(), audit });
  assert.throws(() => interpreter.run(parse(featureSource('', 'try silent { audit(); } catch { }')), 'main', engine.context, new Id(['model']), map({})),
    error => error instanceof FeatureScriptError && !(error instanceof FeatureScriptException) && /failed validation/.test(error.message));
});

test('std values carry their std types: evLine is a Line, evBox3d a Box3d, Id + Id and Id + integer', async () => {
  const model = await build(featureSource('', `
    ${box(10, 10, 10)}
    const edges = evaluateQuery(context, qOwnedByBody(qCreatedBy(id + "c", EntityType.BODY), EntityType.EDGE));
    const l = evLine(context, { "edge" : edges[0] });
    if (!(l is Line)) throw regenError("evLine is a Line");
    const t = try silent(rotationAround(l, 90 * degree));
    if (!(t is Transform)) throw regenError("rotationAround(evLine(...))");
    const b = evBox3d(context, { "topology" : qCreatedBy(id + "c", EntityType.BODY) });
    if (!(b is Box3d) || !((b as Box3d) is Box3d)) throw regenError("evBox3d is a Box3d");
    if (id + makeId("x") != id + "x" || id + 3 != id + "3") throw regenError("Id overloads");`));
  assert.equal(model.bodies.length, 1);
});

// A sweep of zero height (up to std math.fs TOLERANCE.zeroLength, 1e-8 m) fails
// in Onshape too, and FsDoc exceptions.html lists "a failing operation" among
// the exceptions a try catches, so the decorate and fallback idioms work. A
// wonky limit on the same path (the ±10,000 mm F32 envelope) still escapes.
test('a zero-height extrusion or loft is a catchable operation failure; the F32 envelope is not', async () => {
  const circle = (sid, z, r) => `newSketchOnPlane(context, id + "${sid}", { "sketchPlane" : plane(vector(0, 0, ${z}) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });` +
    `skCircle(sk${sid}, "c", { "center" : vector(0, 0) * millimeter, "radius" : ${r} * millimeter }); skSolve(sk${sid});`;
  const sketch = (sid, z, r) => `var sk${sid} = ${circle(sid, z, r)}`;
  const loft = sketch('s0', 0, 5) + sketch('s1', 0, 4) +
    'opLoft(context, id + "loft", { "profileSubqueries" : [qSketchRegion(id + "s0", true), qSketchRegion(id + "s1", true)] });';
  const fallback = 'fCuboid(context, id + "fb", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(10, 10, 10) * millimeter });';
  const flat = 'fCuboid(context, id + "flat", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(10, 10, 0) * millimeter });';
  for (const failing of [loft, flat]) {
    const model = await build(featureSource('', `try { ${failing} } catch (e) { ${fallback} }`));
    assert.deepEqual(model.bodies.map(body => Math.round(body.validation.volumeMm3)), [1000]);
    await assert.rejects(build(featureSource('', `try { ${failing} } catch (e) { throw regenError("R4 build: " ~ e); }`)), /R4 build: .*zero or unresolved/);
  }
  const huge = 'fCuboid(context, id + "huge", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(10, 10, 20000) * millimeter });';
  await assert.rejects(build(featureSource('', `try silent { ${huge} } ${fallback}`)),
    error => error instanceof FeatureScriptError && !catchable(error) && /coordinate envelope/.test(error.message));
});

// W1 fix round 3 (verifier tmp/w1-verify/semantic2/try-gaps*.fs). Pattern: s
// starts at 3 and the try body sets s = 2 when the expression works in
// Onshape, so a swallowed wonky gap shows up as a 27 mm³ cube instead of 8.
const trySize = async statements => volume(await build(featureSource('', `var s = 3; try silent { ${statements} } ${box('s', 's', 's')}`)));
const rotation = 'rotationAround(line(vector(0, 0, 0) * millimeter, vector(0, 0, 1)), 90 * degree)';

// context.fs canBeId: an Id is an array of strings. units.fs: a ValueWithUnits
// is { value, unit }. transform.fs / surfaceGeometry.fs: Transform and Plane
// are maps, and a missing map key reads as undefined (FsDoc variables.html).
// error.fs: regenError returns { message : CUSTOM_ERROR, customMessage }.
test('Id, ValueWithUnits, Transform, Plane and caught regenErrors are the std arrays and maps inside try', async () => {
  for (const statements of [
    'if (id[0] == "model") s = 2;',
    's = size(id) + 1;',
    'for (var part in id + "x") s = 2;',
    's = size(concatenateArrays([id, ["y"]]));',
    'if (abs((5 * millimeter).value - 0.005) < 1e-12 && (5 * millimeter).other == undefined) s = 2;',
    `const t = ${rotation}; if (t.translation is Vector && t.linear is Matrix && size(t) == 2) s = 2;`,
    'const p = plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1)); s = p.y == undefined && p.normal[2] == 1 ? 2 : 4;',
    'try { throw regenError("boom"); } catch (e) { s = e.customMessage == "boom" && ("" ~ e.message) == "CUSTOM_ERROR" ? 2 : 4; }',
    'try { throw regenError("boom", ["depth"]); } catch (e) { s = e.faultyParameters[0] == "depth" && e is map ? 2 : 4; }',
  ]) assert.ok(Math.abs(await trySize(statements) - 8) < 1e-9, statements);
  // `~ e` keeps the message text the corpus decorate idiom relies on.
  await assert.rejects(build(featureSource('', 'try { throw regenError("inner"); } catch (e) { throw regenError("outer: " ~ e); }')), /outer: inner/);
  // A value wonky does not model as the std map is a capability error, also in try silent.
  for (const statement of ['const x = qCreatedBy(id + "x", EntityType.BODY).queryType;', 'const x = (5 * millimeter).unit;',
    'try { const u = [1][3]; } catch (e) { const x = e.message; }', 'try { const u = [1][3]; } catch (e) { const x = e is map; }',
    'for (var x in qCreatedBy(id + "x", EntityType.BODY)) { }', 'const x = size(qCreatedBy(id + "x", EntityType.BODY));']) {
    await assert.rejects(build(featureSource('', `try silent { ${statement} } ${box(1, 1, 1)}`)), error => error instanceof UnsupportedFeatureError, statement);
  }
  // Values without members stay FeatureScript exceptions.
  assert.ok(Math.abs(await trySize('s = 2; const x = (1).field; s = 4;') - 8) < 1e-9);
  assert.ok(Math.abs(await trySize('s = 2; for (var x in 5) s = 4;') - 8) < 1e-9);
});

// surfaceGeometry.fs:198 operator*(Transform, Plane), curveGeometry.fs:79
// operator*(Transform, Line), matrix.fs:96-139 Matrix +, -, unary minus, * and
// / with a number. A std overload wonky lacks is a capability error.
test('std operator overloads on Transform, Plane, Line and Matrix run; missing ones are capability errors', async () => {
  const model = await build(featureSource('', `
    const t = ${rotation} * transform(vector(0, 0, 5) * millimeter);
    const p = t * plane(vector(1, 0, 0) * millimeter, vector(1, 0, 0), vector(0, 1, 0));
    if (abs(p.origin[1] - 1 * millimeter) > 1e-12 * meter || abs(p.origin[2] - 5 * millimeter) > 1e-12 * meter || abs(p.normal[1] - 1) > 1e-12 || abs(p.x[0] + 1) > 1e-12) throw regenError("plane " ~ toString(p.origin));
    const l = t * line(vector(1, 0, 0) * millimeter, vector(1, 0, 0));
    if (!(l is Line) || abs(l.direction[1] - 1) > 1e-12 || abs(l.origin[2] - 5 * millimeter) > 1e-12 * meter) throw regenError("line");
    const m = matrix([[1, 2], [3, 4]]);
    const r = (m * 2 + 2 * m - m / 0.5 - (-m)) * 1;
    if (r[0][1] != 6 || r[1][0] != 9) throw regenError("matrix " ~ r[0][1] ~ " " ~ r[1][0]);
    ${box(1, 1, 1)}`));
  assert.equal(model.bodies.length, 1);
  for (const statement of [`const x = ${rotation} * coordSystem(vector(0, 0, 0) * millimeter, vector(1, 0, 0), vector(0, 0, 1));`,
    'const x = matrix([[1, 0], [0, 1]]) * (2 * millimeter);', `const x = ${rotation} + ${rotation};`]) {
    await assert.rejects(build(featureSource('', `try silent { ${statement} } ${box(1, 1, 1)}`)), error => error instanceof UnsupportedFeatureError, statement);
  }
  // No overload in std for plain values: an exception, as in Onshape.
  assert.ok(Math.abs(await trySize('s = 2; const x = "a" + 1; s = 4;') - 8) < 1e-9);
  assert.ok(Math.abs(await trySize('s = 2; const x = matrix([[1, 0], [0, 1]]) + matrix([[1]]); s = 4;') - 8) < 1e-9);
});

// units.fs:537-555 operator<(ValueWithUnits, number) and (number,
// ValueWithUnits) with the precondition that the number is 0; math.fs min/max use <.
test('a ValueWithUnits compares with the number 0; any other unit mismatch is an exception', async () => {
  assert.ok(Math.abs(volume(await build(featureSource('', `const gap = 0.5 * millimeter;
    if (!(gap > 0 && 0 < gap && gap >= 0 && !(gap <= 0) && -gap < 0 && 90 * degree > 0)) throw regenError("compare");
    if (min(3 * millimeter, 0) != 0 || !(max(0, 3 * millimeter) is ValueWithUnits)) throw regenError("min/max");
    ${box(2, 2, 2)}`))) - 8) < 1e-9);
  assert.ok(Math.abs(await trySize('s = 2; const x = 3 * millimeter > 1; s = 4;') - 8) < 1e-9);
  assert.ok(Math.abs(await trySize('s = 2; const x = 3 * millimeter > 1 * degree; s = 4;') - 8) < 1e-9);
  const units = readFileSync(new URL('../fixtures/corpus-repro/fs-interpreter-semantics/units-source-error.fs', import.meta.url), 'utf8');
  await assert.rejects(build(units), /Incompatible units in expression/);
});

// std feature.fs:53-83 defineFeature: a sub-feature that throws is aborted
// (@abortFeature) before the exception is rethrown to the calling feature.
test('a failed sub-feature is rolled back when a try catches its exception; an uncaught failure reports the state at the failure', async () => {
  const cube = (name, size) => `fCuboid(context, id + "${name}", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(${size}, ${size}, ${size}) * millimeter });`;
  const sub = (name, body) => `const ${name} = defineFeature(function(context is Context, id is Id, definition is map) precondition {} { ${body} });`;
  const source = (subs, body) => `${header} ${subs}
    export const main = defineFeature(function(context is Context, id is Id, definition is map) precondition {} { ${body} });`;
  const names = model => model.bodies.map(body => body.id).sort();
  const thrower = sub('thrower', `${cube('partial', 10)} throw regenError("sub failed");`);
  const flat = sub('flat', `${cube('partial', 10)} fCuboid(context, id + "flat", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(5, 5, 0) * millimeter });`);
  const setsName = sub('setsName', `setProperty(context, { "entities" : qCreatedBy(makeId("model") + "keep", EntityType.BODY), "propertyType" : PropertyType.NAME, "value" : "renamed" }); throw regenError("x");`);
  const outer = sub('outer', `${cube('mid', 3)} thrower(context, id + "inner", {});`);
  assert.deepEqual(names(await build(source(thrower, `try silent { thrower(context, id + "sub", {}); } ${cube('keep', 1)}`))), ['model/keep']);
  assert.deepEqual(names(await build(source(flat, `try { flat(context, id + "sub", {}); } catch { ${cube('fallback', 2)} } ${cube('keep', 1)}`))), ['model/fallback', 'model/keep']);
  // Nested: the outermost sub-feature below the try is rolled back; the ids it used are free again.
  await assert.rejects(build(source(thrower + outer, `try silent { outer(context, id + "sub", {}); } ${cube('keep', 1)} outer(context, id + "sub", {});`)), /sub failed/);
  await assert.rejects(build(source(thrower + outer, `try silent { outer(context, id + "sub", {}); } ${cube('keep', 1)} throw regenError("bodies " ~ size(evaluateQuery(context, qAllModifiableSolidBodies())));`)), /bodies 1/);
  // A try inside the sub-feature itself catches its own operation failure: no rollback.
  const inner = sub('inner', `${cube('partial', 10)} try silent { throw regenError("x"); }`);
  assert.deepEqual(names(await build(source(inner, `try silent { inner(context, id + "sub", {}); } ${cube('keep', 1)}`))), ['model/keep', 'model/sub/partial']);
  // setProperty on an existing body is undone too.
  const renamed = await build(source(setsName, `${cube('keep', 1)} try silent { setsName(context, id + "sub", {}); }`));
  assert.equal(renamed.bodies[0].name, undefined);
  // Uncaught: the failure report keeps the sub-feature's completed operations;
  // caught: they are rolled back with the bodies.
  const unites = sub('unites', `${cube('a', 2)} fCuboid(context, id + "b", { "corner1" : vector(1, 0, 0) * millimeter, "corner2" : vector(3, 2, 2) * millimeter });
    opBoolean(context, id + "u", { "tools" : qUnion([qCreatedBy(id + "a", EntityType.BODY), qCreatedBy(id + "b", EntityType.BODY)]), "operationType" : BooleanOperationType.UNION });
    throw regenError("sub failed");`);
  const mentions = (records, text) => records.filter(record => JSON.stringify(record).includes(text)).length;
  const error = await build(source(unites, 'unites(context, id + "sub", {});')).then(() => null, e => e);
  assert.match(error.message, /sub failed/);
  assert.ok(mentions(error.completedOperationEvidence, 'model/sub/u') > 0);
  const caughtUnion = await build(source(unites, `try silent { unites(context, id + "sub", {}); } ${cube('keep', 1)}`));
  assert.deepEqual([names(caughtUnion), mentions(caughtUnion.operationEvidence, 'model/sub/u')], [['model/keep'], 0]);
});

// FsDoc type-tags.html ("E.A is string == true"), transform.fs and query.fs
// (canBeTransform / canBeQuery start with 'value is map'), error.fs (a regenError is a map).
test('type tests follow the std types: Transform, Query and a caught regenError are maps, an enum value is a string', async () => {
  const functions = 'function takesMap(m is map) returns number { return 2; } function takesString(v is string) returns number { return 2; }';
  const source = featureSource('', `
    const t = ${rotation}; const q = qCreatedBy(id + "x", EntityType.BODY);
    var s = 3;
    try { throw regenError("boom"); } catch (e) { s = e is map ? 2 : 4; }
    if (!(t is map && q is map && EntityType.BODY is string && !(qCreatedBy is map) && takesMap(q) == 2 && takesString(EntityType.BODY) == 2)) throw regenError("types");
    ${box('s', 's', 's')}`).replace('annotation', `${functions} annotation`);
  assert.ok(Math.abs(volume(await build(source)) - 8) < 1e-9);
  await assert.rejects(build(featureSource('', `try silent { const x = matrix([[1]]) is array; } ${box(1, 1, 1)}`)), UnsupportedFeatureError);
});

// std query.fs:295 enum EntityType { VERTEX, EDGE, FACE, BODY }: the implied
// dialog default of an enum parameter is the first std member.
test('std enums keep the std first member, so enum dialog defaults match Onshape', async () => {
  const d = definitionOf(featureSource('definition.kind is EntityType; definition.op is BooleanOperationType; definition.body is BodyType; definition.property is PropertyType;', ''), 'main');
  // query.fs:268 BodyType, booleanoperationtype.gen.fs, propertytype.gen.fs.
  assert.deepEqual([d.kind.name, d.op.name, d.body.name, d.property.name], ['VERTEX', 'UNION', 'SOLID', 'NAME']);
});

// `as` converts a value that passes the std typecheck (FsDoc type-tags.html:
// '"A" as Example // same as Example.A'): surfaceGeometry.fs canBePlane,
// transform.fs canBeTransform, matrix.fs canBeMatrix, vector.fs canBeVector.
// A value that fails the typecheck is an exception; a valid std value wonky
// cannot represent is a capability error that try silent does not swallow.
test('valid std casts work: map as Plane, map as Transform, array as Matrix, string as enum', async () => {
  const planeMap = '{ "origin" : vector(0, 0, 1) * millimeter, "normal" : vector(0, 0, 1), "x" : vector(1, 0, 0) }';
  for (const statements of [
    `const p = ${planeMap} as Plane; if (p is Plane && p == plane(vector(0, 0, 1) * millimeter, vector(0, 0, 1), vector(1, 0, 0))) s = 2;`,
    'const t = { "linear" : matrix([[1, 0, 0], [0, 1, 0], [0, 0, 1]]), "translation" : vector(0, 0, 2) * millimeter } as Transform; if (t is Transform && (t * (vector(0, 0, 0) * millimeter))[2] == 2 * millimeter) s = 2;',
    'const m = [[1, 0], [0, 2]] as Matrix; if (m is Matrix && (m * vector(1, 1))[1] == 2 && m == matrix([[1, 0], [0, 2]])) s = 2;',
    'const e = "FACE" as EntityType; if (e == EntityType.FACE && e is EntityType) s = 2;',
    'const v = [5 * millimeter] as Vector; if (v is Vector && v[0] == 5 * millimeter) s = 2;',
  ]) assert.ok(Math.abs(await trySize(statements) - 8) < 1e-9, statements);
  // An enum in the input casts the same way.
  assert.ok(Math.abs(volume(await build(featureSource('', `const c = "GREEN" as Col; ${box('c == Col.GREEN ? 2 : 4', 2, 2)}`).replace('annotation', 'enum Col { RED, GREEN } annotation'))) - 8) < 1e-9);
  // Values that fail the typecheck raise, as in Onshape (the try swallows them).
  for (const statement of ['const p = { "origin" : vector(0, 0, 0) * millimeter } as Plane;', 'const p = { "origin" : vector(0, 0, 0) * millimeter, "normal" : vector(0, 0, 1), "x" : vector(0, 0, 1) } as Plane;',
    'const t = { "linear" : [[1, 0, 0], [0, 1, 0], [0, 0, 1]], "translation" : vector(0, 0, 0) * millimeter } as Transform;',
    'const m = [[1, 2], [3]] as Matrix;', 'const e = "NOPE" as EntityType;', 'const m = matrix([[1], ["a"]]);']) {
    assert.ok(Math.abs(await trySize(`s = 2; ${statement} s = 4;`) - 8) < 1e-9, statement);
  }
  // Valid std values wonky does not represent: capability errors, also in try silent.
  for (const statement of [`const p = { "origin" : vector(0, 0, 0) * millimeter, "normal" : vector(0, 0, 1), "x" : vector(1, 0, 0), "extra" : 1 } as Plane;`,
    'const e = "X" as ErrorStringEnum;', 'const e = "MATERIAL" as PropertyType;', 'const q = { "historyType" : "CREATION" } as Query;', 'const e = PropertyType.MATERIAL;', 'const e = BodyType.COMPOSITE;', 'const m = [] as Matrix;']) {
    await assert.rejects(build(featureSource('', `try silent { ${statement} } ${box(1, 1, 1)}`)), error => error instanceof UnsupportedFeatureError, statement);
  }
});

// FsDoc variables.html: "setting the value to undefined removes the element
// from the map"; relational.html: == compares values, also of the std maps
// wonky represents with its own classes; exceptions.html: any value can be thrown.
test('undefined removes a map key; == compares std map values; throw passes maps and undefined through', async () => {
  for (const statements of [
    'var m = { "a" : 1, "b" : 2 }; m.a = undefined; if (size(m) == 1 && m == { "b" : 2 }) s = 2;',
    'var m = { "a" : { "b" : 1 } }; m.a.b = undefined; var n = 0; for (var k, v in m.a) n += 1; if (n == 0 && m.a == {}) s = 2;',
    'definition.extra = 1; definition.extra = undefined; if (!(definition.extra != undefined) && size(definition) == 0) s = 2;',
    'if (plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) == plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0))) s = 2;',
    `if (${rotation} == ${rotation} && ${rotation} != identityTransform()) s = 2;`,
    'if (matrix([[1, 2]]) == matrix([[1, 2]]) && matrix([[1, 2]]) != matrix([[1, 3]])) s = 2;',
    'if (qCreatedBy(id + "x", EntityType.BODY) == qCreatedBy(id + "x", EntityType.BODY) && qCreatedBy(id + "x", EntityType.BODY) != qCreatedBy(id + "y", EntityType.BODY)) s = 2;',
    'var a; var b; try { throw regenError("x"); } catch (e) { a = e; } try { throw regenError("x"); } catch (e) { b = e; } if (a == b) s = 2;',
    'try { throw { "k" : 2 }; } catch (e) { if (e.k == 2 && e is map) s = 2; }',
    'try { throw undefined; } catch (e) { if (e == undefined) s = 2; }',
  ]) assert.ok(Math.abs(await trySize(statements) - 8) < 1e-9, statements);
  // An uncaught thrown map is a FeatureScript error with a readable message.
  await assert.rejects(build(featureSource('', 'throw { "k" : 2 };')), error => error instanceof FeatureScriptException && /"k":2/.test(error.message));
  // Queries wonky does not hold as their std maps, and exceptions wonky raised itself, cannot be compared.
  for (const statement of ['const x = qNothing() == qNothing();', 'var a; var b; try { const u = [1][3]; } catch (e) { a = e; } try { const u = [1][4]; } catch (e) { b = e; } const x = a == b;']) {
    await assert.rejects(build(featureSource('', `try silent { ${statement} } ${box(1, 1, 1)}`)), error => error instanceof UnsupportedFeatureError, statement);
  }
});

}
