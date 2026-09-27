import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend() || missing("local design note");
if (publicTreeSkip) {
  test("prism-boolean.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { loadKernel, extrudeInBend } = await import("../src/kernel.mjs");
const { circularFrustumInBend } = await import("../src/analytic.mjs");
const { booleanInBend } = await import("../src/boolean.mjs");
const { prismBoolean, PRISM_METHOD } = await import("../src/prism-boolean.mjs");
const { build } = await import("../src/index.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");









// The exact prism arm (kernel/prism-boolean.bend, local design note task 12a):
// right prisms along one coordinate axis with fitting cap planes, combined as
// a 2D line/arc region Boolean. KS04's outline (disc ∪ bar ∪ tip) is the case
// the hybrid refuses by design: the bar's side planes are tangent to the tip.

const kernel = await loadKernel();
const cyl = (id, c, r, z0 = 0, h = 6) => circularFrustumInBend(kernel, id,
  { plane: { origin: [0, 0, z0], normal: [0, 0, 1], x: [1, 0, 0] }, center: c, radius: r }, null, [0, 0, h]);
const box = (id, lo, hi) => extrudeInBend(kernel, id, [[lo[0], lo[1]], [hi[0], lo[1]], [hi[0], hi[1]], [lo[0], hi[1]]],
  { origin: [0, 0, lo[2]], normal: [0, 0, 1], x: [1, 0, 0] }, [0, 0, hi[2] - lo[2]]);
const relative = (actual, expected) => Math.abs(actual / expected - 1);

// Closed form of KS04's outline profile: disc r 7 at the origin, bar
// x 0..40, y ±5, tip r 5 at (40, 0). The bar covers the disc's lens between
// y = ±5 and x >= 0 and ends tangent into the tip's right half.
const discArea = 49 * Math.PI, barArea = 400, tipHalf = 12.5 * Math.PI;
const lens = 49 * Math.asin(5 / 7) + 5 * Math.sqrt(24); // disc ∩ {x >= 0, |y| <= 5}
const outlineArea = discArea + barArea + tipHalf - lens;

test('KS04 outline: disc ∪ bar ∪ tip is exact with the tangent contact decided in 2D', () => {
  const step1 = booleanInBend(kernel, cyl('disc', [0, 0], 7), box('bar', [0, -5, 0], [40, 5, 6]), 'UNION', 'u1');
  assert.equal(step1.length, 1);
  assert.equal(step1[0].construction.method, PRISM_METHOD);
  const [outline] = booleanInBend(kernel, step1[0], cyl('tip', [40, 0], 5), 'UNION', 'u2');
  assert.equal(outline.construction.method, PRISM_METHOD);
  assert.ok(relative(outline.validation.volumeMm3, 6 * outlineArea) < 1e-14, `${outline.validation.volumeMm3} vs ${6 * outlineArea}`);
  assert.ok(relative(outline.construction.profileAreaMm2, outlineArea) < 1e-14);
  // Two caps, the disc arc, two bar sides, the tip arc: the tangent sides are
  // separate faces meeting the tip cylinder along its tangent lines.
  assert.deepEqual(outline.faces.map(face => face.surface.type).sort(), ['cylinder', 'cylinder', 'plane', 'plane', 'plane', 'plane']);
  assert.deepEqual(outline.validation.boundsMm, { min: [-7, -7, 0], max: [45, 7, 6] });
  assert.equal(outline.approximation, undefined);
});

test('the arm states its evidence and decline record on the Boolean result', () => {
  const bodies = booleanInBend(kernel, cyl('disc', [0, 0], 7), box('bar', [0, -5, 0], [40, 5, 6]), 'UNION', 'u1');
  const [evidence] = bodies.operationEvidence;
  assert.equal(evidence.details?.method ?? evidence.method, PRISM_METHOD);
  assert.match(JSON.stringify(evidence), /"declined":\{"message":/);
});

test('a bore through the outline is an exact subtraction that removed material', () => {
  const [outline] = booleanInBend(kernel, booleanInBend(kernel, cyl('disc', [0, 0], 7), box('bar', [0, -5, 0], [40, 5, 6]), 'UNION', 'u1')[0],
    cyl('tip', [40, 0], 5), 'UNION', 'u2');
  const [part] = booleanInBend(kernel, outline, cyl('bore', [0, 2], 4.2, -0.5, 7), 'SUBTRACTION', 's1');
  assert.equal(part.construction.method, PRISM_METHOD);
  assert.equal(part.construction.toolBoundaryKept, true);
  assert.ok(relative(part.validation.volumeMm3, 6 * (outlineArea - Math.PI * 4.2 ** 2)) < 1e-14);
  assert.equal(part.faces[0].loops.length, 2); // the bore is a hole in each cap
});

test('a tool that misses the target keeps no tool boundary', () => {
  const r = prismBoolean(kernel, box('a', [0, 0, 0], [10, 10, 5]), cyl('far', [30, 0], 3, -1, 7), 'SUBTRACTION', 'miss');
  assert.equal(r.status, 'built');
  assert.equal(r.bodies[0].construction.toolBoundaryKept, false);
  assert.equal(r.bodies[0].validation.volumeMm3, 500);
});

test('intersection and subtraction of a disc and a bar sharing both caps', () => {
  const disc = cyl('disc', [0, 0], 7), bar = box('bar', [0, -5, 0], [40, 5, 6]);
  const [meet] = booleanInBend(kernel, disc, bar, 'INTERSECTION', 'i1');
  assert.equal(meet.construction.method, PRISM_METHOD);
  assert.ok(relative(meet.validation.volumeMm3, 6 * lens) < 1e-14);
  const [rest] = booleanInBend(kernel, disc, bar, 'SUBTRACTION', 's2');
  assert.ok(relative(rest.validation.volumeMm3, 6 * (discArea - lens)) < 1e-14);
});

test('exact tangency of two discs of one profile is decided exactly (union of tangent-inside discs)', () => {
  // A disc r 3 inside a disc r 5, touching it at (5, 0): the union is the big disc.
  const r = prismBoolean(kernel, cyl('big', [0, 0], 5), cyl('small', [2, 0], 3), 'UNION', 'tangent');
  assert.equal(r.status, 'built', r.reason);
  assert.ok(relative(r.bodies[0].validation.volumeMm3, 6 * 25 * Math.PI) < 1e-14);
});

test('the arm declines rather than guesses', () => {
  // Cap planes that do not fit a union.
  let r = prismBoolean(kernel, cyl('disc', [0, 0], 7), box('bar', [0, -5, 0], [40, 5, 5]), 'UNION', 'caps');
  assert.equal(r.status, 'declined'); assert.equal(r.code, 10);
  // A near tangency: the bar side 1e-7 mm off the tip.
  r = prismBoolean(kernel, box('bar', [0, -5, 0], [40, 5 + 1e-7, 6]), cyl('tip', [40, 0], 5), 'UNION', 'near');
  assert.equal(r.status, 'declined');
  assert.ok([20, 21, 22, 23].includes(r.code), `code ${r.code}: ${r.reason}`);
  // Two blocks touching at one corner line (a non-manifold touch).
  r = prismBoolean(kernel, box('p', [0, 0, 0], [1, 1, 1]), box('q', [1, 1, 0], [2, 2, 1]), 'UNION', 'corner');
  assert.equal(r.status, 'declined'); assert.equal(r.code, 25);
  // A different axis.
  r = prismBoolean(kernel, box('p', [0, 0, 0], [1, 1, 1]), circularFrustumInBend(kernel, 'x',
    { plane: { origin: [-1, 0.5, 0.5], normal: [1, 0, 0], x: [0, 1, 0] }, center: [0, 0], radius: 0.2 }, null, [3, 0, 0]), 'UNION', 'axis');
  assert.equal(r.status, 'declined');
});

test('KS04 through FeatureScript: the n-ary outline union builds exactly; exact-only keeps the old refusal', async () => {
  const fs = `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
function cylinder(context is Context, id is Id, c is Vector, r is number, z0 is number, h is number)
{
    var s = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(vector(0, 0, z0) * millimeter, vector(0, 0, 1)) });
    skCircle(s, "c", { "center" : c * millimeter, "radius" : r * millimeter });
    skSolve(s);
    opExtrude(context, id + "e", { "entities" : qSketchRegion(id + "s"), "direction" : vector(0, 0, 1),
        "endBound" : BoundingType.BLIND, "endDepth" : h * millimeter });
    return qCreatedBy(id + "e", EntityType.BODY);
}
export function part(context is Context, id is Id, definition is map)
{
    const disc = cylinder(context, id + "disc", vector(0, 0), 7, 0, 6);
    var s = newSketchOnPlane(context, id + "bs", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1)) });
    skRectangle(s, "r", { "firstCorner" : vector(0, -5) * millimeter, "secondCorner" : vector(40, 5) * millimeter });
    skSolve(s);
    opExtrude(context, id + "bar", { "entities" : qSketchRegion(id + "bs"), "direction" : vector(0, 0, 1),
        "endBound" : BoundingType.BLIND, "endDepth" : 6 * millimeter });
    const tip = cylinder(context, id + "tip", vector(40, 0), 5, 0, 6);
    opBoolean(context, id + "outline", { "tools" : qUnion([disc, qCreatedBy(id + "bar", EntityType.BODY), tip]),
        "operationType" : BooleanOperationType.UNION });
}`;
  const model = await build(fs, { feature: 'part' });
  assert.equal(model.bodies.length, 1);
  const [body] = model.bodies;
  assert.equal(body.construction.method, PRISM_METHOD);
  assert.ok(relative(body.validation.volumeMm3, 6 * outlineArea) < 1e-14);
  // 'exact-only' is the behaviour before the hybrid was dispatched: the prism
  // arm sits with the hybrid in last(), so the exact arms' refusal stands.
  await assert.rejects(build(fs, { feature: 'part', modelingPolicy: { boolean: 'exact-only' } }),
    error => error instanceof UnsupportedFeatureError && !/hybrid/.test(error.message));
});

}
