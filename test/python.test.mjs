import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("python.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { buildPython, PythonExecutionError } = await import("../src/python.mjs");
const { build } = await import("../src/index.mjs");
const { toStep } = await import("../src/exporters.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");







const header = 'FeatureScript 3044; import(path:"onshape/std/geometry.fs",version:"3044.0");';
const feature = body => `${header}export function main(context is Context,id is Id,definition is map){${body}}`;
const python = body => `from build123d import *\n${body}\n`;
const near = (a, b) => assert.ok(Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(b)), `${a} != ${b}`);
// Compare the exported B-rep representation: JSON normalizes equivalent signed
// zeros that can differ after an identity/translation transform. Frontend IDs,
// source locations and operation histories intentionally describe different code.
const withoutId = ({ id, identity, debug, operationHistory, ...body }) => JSON.parse(JSON.stringify(body));
// FS millimetre values carry the float64 metre-conversion noise (9 mm arrives as 9.000000000000002).
// F32 construction rounded it away; the F32x2 polygon prism (W2) keeps it. Numbers are compared to
// 1e-12 relative, everything else (topology, types, keys) exactly.
const sameBody = (actual, expected, at = 'body') => {
  if (typeof expected === 'number' && typeof actual === 'number')
    return assert.ok(Math.abs(actual - expected) <= 1e-12 * Math.max(1, Math.abs(expected)), `${at}: ${actual} != ${expected}`);
  if (expected === null || typeof expected !== 'object') return assert.equal(actual, expected, at);
  assert.equal(Array.isArray(actual), Array.isArray(expected), at);
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), at);
  for (const key of Object.keys(expected)) sameBody(actual[key], expected[key], `${at}.${key}`);
};
const cylinder = (name, z0, z1, radius, x = 0, y = 0) => `
var ${name}=newSketchOnPlane(context,id+"${name}",{"sketchPlane":plane(vector(${x},${y},${z0})*millimeter,vector(0,0,1),vector(1,0,0))});
skCircle(${name},"circle",{"center":vector(0,0)*millimeter,"radius":${radius}*millimeter});skSolve(${name});
opExtrude(context,id+"${name}ex",{"entities":qSketchRegion(id+"${name}"),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":${z1-z0}*millimeter});`;
const query = name => `qCreatedBy(id+"${name}ex",EntityType.BODY)`;
const boolean = operation => `opBoolean(context,id+"boolean",{${operation === 'SUBTRACTION'
  ? `"targets":${query('a')},"tools":${query('b')}`
  : `"tools":qUnion([${query('a')},${query('b')}])`},"operationType":BooleanOperationType.${operation}});`;
const pyCylinder = ([z0, z1, radius]) => `Pos(0, 0, ${(z0 + z1) / 2}) * Cylinder(${radius}, ${z1 - z0})`;

test('real Python helpers, loops and measured volumes select a fully built final box', async () => {
  const model = await buildPython(python(`
from math import prod
def make_box(dimensions):
    return Box(*dimensions)
dimensions = tuple(i * 2 for i in range(1, 4))
shape = make_box(dimensions)
assert shape.volume == prod(dimensions)
for _ in range(2):
    shape = Pos(X=1, Y=-2, Z=3) * shape
assert shape.volume == 48
print("{not a protocol request} µm³")
result = shape
`));
  const reference = await build(feature('fCuboid(context,id+"box",{"corner1":vector(1,-6,3)*millimeter,"corner2":vector(3,-2,9)*millimeter});'));
  sameBody(model.bodies.map(withoutId), reference.bodies.map(withoutId));
  assert.equal(model.source.language, 'Python');
  assert.equal(model.backend.language, 'Bend');
  assert.equal(model.backend.precision, 'F32x2');
  assert.match(model.source.pythonVersion, /^3\./);
  assert.equal(model.execution.stdout, '{not a protocol request} µm³\n');
  assert.equal(model.execution.stderr, '');
});

test('Box centered defaults and all three alignments match FeatureScript bounds and B-reps', async () => {
  for (const [alignment, low, high] of [
    ['', [-5, -3, -2], [5, 3, 2]],
    [', align=Align.MIN', [0, 0, 0], [10, 6, 4]],
    [', align=Align.CENTER', [-5, -3, -2], [5, 3, 2]],
    [', align=Align.MAX', [-10, -6, -4], [0, 0, 0]],
    [', align=(Align.MIN, Align.CENTER, Align.MAX)', [0, -3, -4], [10, 3, 0]],
  ]) {
    const model = await buildPython(python(`result = Box(10, 6, 4${alignment})`));
    const reference = await build(feature(`fCuboid(context,id+"box",{"corner1":vector(${low})*millimeter,"corner2":vector(${high})*millimeter});`));
    assert.deepEqual(model.bodies.map(withoutId), reference.bodies.map(withoutId));
    assert.deepEqual(model.bodies[0].validation.boundsMm, { min: low, max: high });
  }
});

test('Cylinder defaults and per-axis alignment match analytic FeatureScript geometry', async () => {
  for (const [alignment, low, high, center] of [
    ['', [-3, -3, -5], [3, 3, 5], [0, 0]],
    [', align=Align.MIN', [0, 0, 0], [6, 6, 10], [3, 3]],
    [', align=Align.MAX', [-6, -6, -10], [0, 0, 0], [-3, -3]],
    [', align=(Align.MAX, Align.CENTER, Align.MIN)', [-6, -3, 0], [0, 3, 10], [-3, 0]],
  ]) {
    const model = await buildPython(python(`result = Cylinder(3, 10${alignment})\nassert abs(result.volume - 90 * 3.141592653589793) < 1e-8`));
    const reference = await build(feature(cylinder('a', low[2], high[2], 3, ...center)));
    assert.deepEqual(model.bodies.map(withoutId), reference.bodies.map(withoutId));
    assert.deepEqual(model.bodies[0].validation.boundsMm, { min: low, max: high });
    assert.match(toStep(model), /CYLINDRICAL_SURFACE/);
    assert.equal(model.backend.precision, 'F32x2');
  }
});

test('Python +, - and & produce the same actual Boolean B-reps as FeatureScript', async () => {
  for (const [operator, operation, first, second, count] of [
    ['+', 'UNION', [0, 10, 5], [4, 14, 3], 1],
    ['&', 'INTERSECTION', [0, 10, 5], [4, 14, 3], 1],
    ['-', 'SUBTRACTION', [0, 10, 5], [-1, 11, 2], 1],
    ['-', 'SUBTRACTION', [0, 10, 5], [4, 6, 6], 2],
    ['+', 'UNION', [0, 10, 5], [14, 16, 3], 2],
  ]) {
    const model = await buildPython(python(`a = ${pyCylinder(first)}\nb = ${pyCylinder(second)}\nresult = a ${operator} b\nprint(result.volume)`));
    const reference = await build(feature(cylinder('a', ...first) + cylinder('b', ...second) + boolean(operation)));
    assert.equal(model.bodies.length, count);
    assert.deepEqual(model.bodies.map(withoutId), reference.bodies.map(withoutId));
    near(Number(model.execution.stdout), model.bodies.reduce((sum, body) => sum + body.validation.volumeMm3, 0));
    assert.ok(model.bodies.every(body => body.validation.closed));
  }
});

test('a cylinder subtracted from a box is an exact through hole in Python too', async () => {
  const model = await buildPython(python(`
from math import isclose, pi
plate = Box(20, 30, 5)
result = plate - Cylinder(4, 10)
assert isclose(result.volume, 20*30*5 - pi*16*5, rel_tol=1e-12)
`));
  const body = model.bodies[0];
  assert.ok(Math.abs(body.validation.volumeMm3 - (3000 - Math.PI * 16 * 5)) < 1e-9);
  assert.deepEqual([body.vertices.length, body.edges.length, body.faces.length], [10, 15, 7]);
  assert.equal(body.faces.filter(f => f.surface.type === 'cylinder').length, 1);
});

test('Pos composition translates a Boolean B-rep without mutating its operands', async () => {
  const model = await buildPython(python(`
from math import isclose, pi
a = Cylinder(5, 10)
b = Cylinder(2, 12)
bore = a - b
result = Pos((10, -20, 3)) * Pos(Z=2) * bore
assert isclose(a.volume, 250*pi, rel_tol=1e-10)
assert isclose(b.volume, 48*pi, rel_tol=1e-10)
assert isclose(bore.volume, 210*pi, rel_tol=1e-10)
assert isclose(result.volume, bore.volume, rel_tol=1e-10)
`));
  assert.deepEqual(model.bodies[0].validation.boundsMm, { min: [5, -25, 0], max: [15, -15, 10] });
  near(model.bodies[0].validation.volumeMm3, 210 * Math.PI);
});

test('empty Boolean shapes have volume zero; an empty final result cannot export a model', async () => {
  const source = python('a = Cylinder(5, 10)\nempty = a - a\nassert empty.volume == 0\nresult = a');
  const model = await buildPython(source);
  assert.equal(model.bodies.length, 1);
  await assert.rejects(buildPython(source + '\nresult = empty'), /contains no solid bodies/);
});

test('missing geometry and API capabilities stay fatal even when Python catches BaseException', async () => {
  for (const [expression, message] of [
    // A radius-1 tool exactly meets the +-1 walls of a 2 mm box, so this is
    // still refused -- now by the through-hole admission, which says why.
    ['Box(2, 3, 4) - Cylinder(1, 8)', /does not clear a boundary edge/],
    ['Cylinder(5, 10) - Cylinder(2, 4)', /enclosed void/],
    ['Box(2, 3, 4, rotation=(0, 0, 15))', /Nonzero rotations/],
    ['Cylinder(2, 5, arc_size=180)', /360-degree/],
    ['Box(2, 3, 4, mode=Mode.SUBTRACT)', /only Mode.ADD/],
    ['Box(2, 3, 4, mystery=True)', /Unsupported primitive argument/],
    ['Box(2, 3, 4).faces()', /Shape.faces/],
    ['Sphere(3)', /build123d.Sphere/],
    ['Torus(3, 1)', /build123d.Torus/],
    // Module-qualified build123d names fail where they are used. A name that
    // build123d 0.13.0 does not have is an AttributeError (test/python-names.test.mjs).
    ['__import__("build123d").import_step("part.step")', /build123d.import_step/],
    ['__import__("OCP")', /production geometry must be constructed in Bend/],
    // An unimplemented class attribute of a real build123d name fails at its use.
    ['Plane.XY.shift_origin((0, 0, 1))', /Plane.shift_origin/],
  ]) {
    const source = python(`result = Box(1, 1, 1)\ntry:\n    ${expression}\nexcept BaseException:\n    pass`);
    await assert.rejects(buildPython(source, { filename: 'unsupported.py' }), error =>
      error instanceof UnsupportedFeatureError && message.test(error.message) && Number.isInteger(error.line));
  }
  // Refused by the exact arms, built by the hybrid Boolean (src/boolean.mjs);
  // the pin inside the bore does not touch the tube, so the union keeps both.
  for (const [expression, bodies] of [['Cylinder(5, 10) - Pos(1, 0, 0) * Cylinder(2, 12)', 1], ['(Cylinder(5, 10) - Cylinder(2, 12)) + Cylinder(1, 2)', 2]]) {
    const model = await buildPython(python(`result = ${expression}`), { filename: 'hybrid.py' });
    assert.equal(model.bodies.length, bodies);
  }
});

test('Python syntax/runtime errors, missing result and invalid final values are explicit failures', async () => {
  for (const [source, message] of [
    ['result = (', /SyntaxError/],
    [python('result = Box(2, 3, 4)\nraise ValueError("unfinished")'), /unfinished/],
    [python('shape = Box(2, 3, 4)'), /bind its final Shape/],
    [python('result = 42'), /must be a Bend Shape/],
    [python('result = Cylinder(-2, 3)'), /positive/],
    [python('result = Box(float("nan"), 3, 4)'), /finite/],
  ]) await assert.rejects(buildPython(source), error => error instanceof PythonExecutionError && message.test(error.message));
});

test('a script cannot report success without completing the bridge protocol', async () => {
  await assert.rejects(buildPython('import os\nos._exit(0)'), /without a completed result/);
  await assert.rejects(buildPython('while True:\n    pass', { timeoutMs: 100 }), /exceeded 100 ms/);
  await assert.rejects(buildPython(python('result = Box(1, 1, 1)\nprint(result.volume)\nprint(result.volume)'), { maxRequests: 2 }), /exceeded 2 requests/);
  await assert.rejects(buildPython(python('result = Box(1, 1, 1)'), { python: '/no/such/wonky-python' }), /Cannot start Python/);
});

test('concurrent Python sessions keep their bodies and streams independent', async () => {
  const models = await Promise.all([2, 7].map(size => buildPython(python(`result = Box(${size}, 3, 4)\nprint(${size})`))));
  assert.deepEqual(models.map(model => model.bodies[0].validation.volumeMm3), [24, 84]);
  assert.deepEqual(models.map(model => model.execution.stdout), ['2\n', '7\n']);
});

}
