import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("plane-axis-corpus.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { parseExpression } = await import("../src/parser.mjs");
const { Interpreter } = await import("../src/interpreter.mjs");
const { ModelingContext } = await import("../src/library.mjs");
const { build } = await import("../src/index.mjs");
const { loadKernel } = await import("../src/kernel.mjs");
const { FeatureScriptError, UnsupportedFeatureError } = await import("../src/errors.mjs");
// The two-argument plane(origin, normal) takes its x axis from std
// perpendicularVector: surfaceGeometry.fs:86
//   plane(origin, normal) = plane(origin, normal, perpendicularVector(normal))
// and vector.fs:339 perpendicularVector picks a helper axis `different` by the
// ratio thresholds 1.0366…, 0.9517… and 0.9204… and returns
// normalize(cross(different, vec)). Every expectation below is derived by hand
// from that source, not from wonky. Before this fix wonky projected (1,0,0), or
// (0,1,0) when |n.x| >= 0.9, which moved every sketch on a -Z, +Y, -Y or -X plane.









async function evaluator() {
  const engine = new ModelingContext(await loadKernel());
  const interpreter = new Interpreter(engine.builtins());
  return text => interpreter.expression(parseExpression(text));
}
const close = (actual, expected, label) => {
  assert.equal(actual.length, expected.length, label);
  actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-12, `${label}: [${actual}] != [${expected}]`));
};
const r2 = Math.SQRT1_2;
// [normal, perpendicularVector(normal)], hand-evaluated from vector.fs:339.
const cases = [
  ['0,0,1', [1, 0, 0]], // else branch, |y| > .92|z| false -> different = Y; Y x Z = X
  ['0,0,-1', [-1, 0, 0]], // Y x -Z = -X
  ['0,1,0', [0, 0, 1]], // else branch, |y| > .92|z| -> different = X; X x Y = Z
  ['0,-1,0', [0, 0, -1]], // X x -Y = -Z
  ['1,0,0', [0, 1, 0]], // |x| > 1.0366|y| and |x| > .9517|z| -> different = Z; Z x X = Y
  ['-1,0,0', [0, -1, 0]], // Z x -X = -Y
  ['0,0,7', [1, 0, 0]], // not normalized first: the thresholds are ratios
  ['1,1,0', [0, 0, 1]], // |x| > 1.0366|y| false -> else, different = X; X x (1,1,0) = Z
  ['1.04,1,0', [-1 / Math.hypot(1, 1.04), 1.04 / Math.hypot(1, 1.04), 0]], // just above 1.0366: different = Z
  ['1.03,1,0', [0, 0, 1]], // just below 1.0366: different = X
  ['0,1,1', [0, -r2, r2]], // |y| > .9204|z| -> different = X; X x (0,1,1) = (0,-1,1)
  ['0,0.9,1', [1, 0, 0]], // .9 < .9204: different = Y; Y x (0,.9,1) = (1,0,0)
  ['1,0,1.06', [1.06 / Math.hypot(1, 1.06), 0, -1 / Math.hypot(1, 1.06)]], // |x| > .9517|z| false (1 < 1.0088) -> different = Y; Y x (1,0,1.06) = (1.06,0,-1)
];

test('plane(origin, normal).x is std perpendicularVector(normal) for axis, oblique and threshold normals', async () => {
  const evaluate = await evaluator();
  for (const [normal, x] of cases) {
    const plane = evaluate(`plane(vector(1, 2, 3) * millimeter, vector(${normal}))`);
    close(plane.x.items, x, `plane x for normal (${normal})`);
    const n = normal.split(',').map(Number), length = Math.hypot(...n);
    close(plane.normal.items, n.map(v => v / length), `plane normal for (${normal})`);
    close(evaluate(`perpendicularVector(vector(${normal}))`).items, x, `perpendicularVector(${normal})`);
  }
});

test('perpendicularVector drops units and maps a zero vector to (1, 0, 0), as vector.fs does', async () => {
  const evaluate = await evaluator();
  close(evaluate('perpendicularVector(vector(0, -5, 0) * millimeter)').items, [0, 0, -1], 'length vector');
  assert.ok(evaluate('perpendicularVector(vector(0, -5, 0) * millimeter)').items.every(v => typeof v === 'number'));
  close(evaluate('perpendicularVector(vector(0, 0, 0))').items, [1, 0, 0], 'zero vector');
  // vector.fs: precondition @size(vec) == 3 is a FeatureScript exception, not a wonky gap.
  assert.throws(() => evaluate('perpendicularVector(vector(1, 0))'), error => error instanceof FeatureScriptError && !(error instanceof UnsupportedFeatureError));
  // An explicit x axis is untouched: surfaceGeometry.fs:72 plane(origin, normal, x).
  close(evaluate('plane(vector(0, 0, 0) * millimeter, vector(0, -1, 0), vector(1, 0, 0))').x.items, [1, 0, 0], 'explicit x');
});

// perpendicularVector gets the normal as the caller passed it, not normalized:
// shorter than TOLERANCE.zeroLength (1e-8) it returns (1, 0, 0) for every
// direction (vector.fs:344). plane(origin, normal, x) then normalizes the
// normal and its `as Plane` (surfaceGeometry.fs canBePlane: |x . normal| <
// TOLERANCE.zeroAngle) holds only if that normal is perpendicular to (1, 0, 0);
// otherwise Onshape throws, which try catches.
test('plane(origin, normal) with a normal shorter than TOLERANCE.zeroLength takes x = (1, 0, 0) or fails its Plane typecheck', async () => {
  const evaluate = await evaluator();
  for (const normal of ['0, 5e-9, 0', '0, 0, 5e-9', '0, -3e-9, 4e-9']) {
    const plane = evaluate(`plane(vector(0, 0, 0) * millimeter, vector(${normal}))`);
    close(plane.x.items, [1, 0, 0], `x for tiny normal (${normal})`);
    const n = normal.split(',').map(Number), length = Math.hypot(...n);
    close(plane.normal.items, n.map(v => v / length), `normal for tiny normal (${normal})`);
  }
  for (const normal of ['5e-9, 0, 0', '3e-9, 4e-9, 0', '-1e-9, 0, 1e-9']) {
    assert.throws(() => evaluate(`plane(vector(0, 0, 0) * millimeter, vector(${normal}))`),
      error => error instanceof FeatureScriptError && !(error instanceof UnsupportedFeatureError) && /perpendicular/.test(error.message), `tiny normal (${normal})`);
  }
  // Just above the tolerance the ratio thresholds pick the axis again: (0, 2e-8, 0) -> Y branch, x = Z.
  close(evaluate('plane(vector(0, 0, 0) * millimeter, vector(0, 2e-8, 0))').x.items, [0, 0, 1], 'normal (0, 2e-8, 0)');
});

// A 10 x 2 mm rectangle at sketch (0,0)..(10,2) extruded 3 mm along the normal;
// the box is x = perpendicularVector(n), y = n x x (std Plane frame, the same
// frame toWorld(coordSystem(plane)) uses in coordSystem.fs).
const slab = normal => `FeatureScript 2909;
import(path : "onshape/std/geometry.fs", version : "2909.0");
export const slab = defineFeature(function(context is Context, id is Id, definition is map) precondition {}
{
    const sk = newSketchOnPlane(context, id + "sk", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(${normal})) });
    skRectangle(sk, "r", { "firstCorner" : vector(0, 0) * millimeter, "secondCorner" : vector(10, 2) * millimeter });
    skSolve(sk);
    opExtrude(context, id + "ex", { "entities" : qSketchRegion(id + "sk"), "direction" : vector(${normal}), "endBound" : BoundingType.BLIND, "endDepth" : 3 * millimeter });
});`;
const slabBoxes = [
  ['0,0,1', [[0, 0, 0], [10, 2, 3]]],
  ['0,0,-1', [[-10, 0, -3], [0, 2, 0]]], // x = -X, y = -Z x -X = +Y
  ['0,1,0', [[0, 0, 0], [2, 3, 10]]], // x = +Z, y = Y x Z = +X
  ['0,-1,0', [[0, -3, -10], [2, 0, 0]]], // x = -Z, y = -Y x -Z = +X
  ['1,0,0', [[0, 0, 0], [3, 10, 2]]], // x = +Y, y = X x Y = +Z
  ['-1,0,0', [[-3, -10, 0], [0, 0, 2]]], // x = -Y, y = -X x -Y = +Z
];

test('sketches on plane(origin, normal) land where Onshape puts them for all six axis normals', async () => {
  for (const [normal, [min, max]] of slabBoxes) {
    const model = await build(slab(normal), { feature: 'slab' });
    assert.equal(model.bodies.length, 1);
    const { boundsMm, volumeMm3 } = model.bodies[0].validation;
    assert.ok(Math.abs(volumeMm3 - 60) < 1e-9, `volume for normal (${normal})`);
    close(boundsMm.min, min, `min corner for normal (${normal})`);
    close(boundsMm.max, max, `max corner for normal (${normal})`);
  }
});

test('the plane x axis read back in FeatureScript is the std one (verifier probe xAxisValue)', async () => {
  const source = `FeatureScript 2909;
import(path : "onshape/std/geometry.fs", version : "2909.0");
export const probe = defineFeature(function(context is Context, id is Id, definition is map) precondition {}
{
    const p = plane(vector(0, 0, 0) * millimeter, vector(0, -1, 0));
    const s = abs(p.x[2] + 1) < 1e-9 ? 2 : 4;
    fCuboid(context, id + "c", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(s, s, s) * millimeter });
});`;
  // Onshape: p.x = (0, 0, -1), so s = 2 and the cube is 8 mm³ (the old axis gave 64).
  assert.ok(Math.abs((await build(source, { feature: 'probe' })).bodies[0].validation.volumeMm3 - 8) < 1e-9);
});

}
