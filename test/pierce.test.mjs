import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("pierce.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { build } = await import("../src/index.mjs");
const { toStep } = await import("../src/exporters.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");
const { readFileSync } = await import("node:fs");
const { loadKernel } = await import("../src/kernel.mjs");
const { booleanInBend } = await import("../src/boolean.mjs");
const { circularFrustumInBend, decodeAnalytic, encodeAnalytic, transformAnalytic } = await import("../src/analytic.mjs");
const { solveSketchArcs, extrudeSketchArcs } = await import("../src/sketch-arcs.mjs");











// A round through hole in a planar body, driven from FeatureScript because
// that is the path a part actually takes.
const header = 'FeatureScript 3044;\nimport(path : "onshape/std/geometry.fs", version : "3044.0");\n';
const plate = ({ w = 40, d = 30, h = 5, r = 4, cx = 0, cy = 0, axis = [0, 0, 1], from = -1, depth = 7 } = {}) => `${header}
export function part(context is Context, id is Id, definition is map)
{
    var p = newSketchOnPlane(context, id + "p", { "sketchPlane" : plane(vector(0,0,0)*millimeter, vector(0,0,1)) });
    skRectangle(p, "r", { "firstCorner" : vector(${-w / 2},${-d / 2})*millimeter, "secondCorner" : vector(${w / 2},${d / 2})*millimeter });
    skSolve(p);
    opExtrude(context, id + "plate", { "entities" : qSketchRegion(id + "p"),
        "direction" : vector(0,0,1), "endBound" : BoundingType.BLIND, "endDepth" : ${h}*millimeter });
    var t = newSketchOnPlane(context, id + "t", { "sketchPlane" : plane(vector(${axis[0] * from},${axis[1] * from},${axis[2] * from})*millimeter, vector(${axis.join(',')})) });
    skCircle(t, "c", { "center" : vector(${cx},${cy})*millimeter, "radius" : ${r}*millimeter });
    skSolve(t);
    opExtrude(context, id + "tool", { "entities" : qSketchRegion(id + "t"),
        "direction" : vector(${axis.join(',')}), "endBound" : BoundingType.BLIND, "endDepth" : ${depth}*millimeter });
    opBoolean(context, id + "bore", { "targets" : qCreatedBy(id + "plate", EntityType.BODY),
        "tools" : qCreatedBy(id + "tool", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });
}`;

// The pierce arm's admissions, without the hybrid last arm behind them.
const exactOnly = { boolean: 'exact-only' };
const near = (actual, expected, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)),
    `${actual} is not within ${tolerance} of ${expected}`);

test('a cylinder subtracted from a plate leaves an exact through hole', async () => {
  const model = await build(plate(), { feature: 'part' });
  const body = model.bodies[0];
  near(body.validation.volumeMm3, 40 * 30 * 5 - Math.PI * 16 * 5);
  // Four plate walls, two pierced caps, one bore wall.
  assert.deepEqual([body.vertices.length, body.edges.length, body.faces.length], [10, 15, 7]);
  const wall = body.faces.find(f => f.surface.type === 'cylinder');
  assert.equal(wall.surface.radius, 4);
  // The bore faces the axis, not away from it.
  assert.equal(wall.sameSense, false);
});

test('the pierced shell stays a closed orientable two-manifold', async () => {
  const body = (await build(plate(), { feature: 'part' })).bodies[0];
  const tally = new Map();
  let loops = 0;
  for (const face of body.faces)
    for (const loop of face.loops) {
      loops++;
      for (const use of loop.uses ?? loop) {
        const entry = tally.get(use.edge) ?? { forward: 0, backward: 0 };
        use.forward ? entry.forward++ : entry.backward++;
        tally.set(use.edge, entry);
      }
    }
  assert.equal(tally.size, body.edges.length);
  for (const [edge, entry] of tally)
    assert.deepEqual([entry.forward, entry.backward], [1, 1], `edge ${edge} is used ${entry.forward}f/${entry.backward}b`);
  // Euler-Poincare with inner loops: V - E + 2F - L - 2S + 2G = 0. A plate with
  // a through hole is genus one, so the plain V - E + F = 2 does not apply.
  const [V, E, F] = [body.vertices.length, body.edges.length, body.faces.length];
  assert.equal(V - E + 2 * F - loops - 2 * 1 + 2 * 1, 0);
});

test('the two pierced caps carry the hole as an inner loop, wound against their outer one', async () => {
  const body = (await build(plate(), { feature: 'part' })).bodies[0];
  const pierced = body.faces.filter(f => f.loops.length === 2);
  assert.equal(pierced.length, 2);
  for (const face of pierced) {
    assert.deepEqual(face.outer, [true, false]);
    const hole = face.loops[1], uses = hole.uses ?? hole;
    assert.equal(uses.length, 1);
    assert.equal(body.edges[uses[0].edge].curve.type, 'circle');
    // Outward against the circle's normal decides the direction. The caps look
    // opposite ways down the axis, so exactly one of them takes it forward.
    const outward = face.surface.normal.map(v => v * (face.sameSense ? 1 : -1));
    assert.equal(uses[0].forward, outward[2] < 0);
  }
});

test('a pierced plate exports analytic STEP, with the bore as a cylinder', async () => {
  const model = await build(plate(), { feature: 'part' });
  const step = toStep(model, 'plate');
  assert.match(step, /CYLINDRICAL_SURFACE/);
  assert.match(step, /CIRCLE/);
  assert.doesNotMatch(step, /POLY_LOOP|TRIANGUL/);
});

test('holes this kernel cannot cut are refused rather than approximated', async () => {
  // Breaks out through the plate's edge: the circle no longer clears a
  // boundary, so what is left is not a through hole at all.
  await assert.rejects(build(plate({ cx: 19 }), { feature: 'part', modelingPolicy: exactOnly }), UnsupportedFeatureError);
  await assert.rejects(build(plate({ cx: 19 }), { feature: 'part', modelingPolicy: exactOnly }), /clear a boundary edge/);
  // A tool lying along the plate does meet the two side walls, but a radius-4
  // circle on a 5 mm edge hangs off it, so containment refuses it first. Which
  // admission catches a bad input is not the contract; that one does, is.
  await assert.rejects(build(plate({ axis: [1, 0, 0], from: -25, depth: 50 }), { feature: 'part', modelingPolicy: exactOnly }),
    /perpendicular to exactly two faces|clear a boundary edge|must land in material/);
});

test('a blind tool that does not pass through is not treated as a through hole', async () => {
  // The tool starts inside the plate, so only one cap is pierced and the other
  // end would need a floor this operation does not build.
  await assert.rejects(build(plate({ from: 2, depth: 1 }), { feature: 'part', modelingPolicy: exactOnly }), UnsupportedFeatureError);
});

test('a hole that misses the body is refused, not invented in mid-air', async () => {
  // Clearance alone never asked whether the axis lands in material: being far
  // from every boundary segment is just as true outside the outline. A sweep
  // declined only the narrow band where the circle straddled an edge and
  // admitted everything past it -- at 1000 mm away the kernel still reported
  // 251 mm3 removed, while OpenCascade read the export as two disjoint solids,
  // an untouched plate beside a free-floating cylinder.
  for (const cx of [24.1, 26, 40, 1000]) {
    await assert.rejects(build(plate({ cx }), { feature: 'part', modelingPolicy: exactOnly }), UnsupportedFeatureError);
    await assert.rejects(build(plate({ cx }), { feature: 'part', modelingPolicy: exactOnly }), /must land in material/);
  }
  // And the positions that do sit in material still work, right up to the edge.
  for (const cx of [0, 15, 15.9]) {
    const body = (await build(plate({ cx }), { feature: 'part' })).bodies[0];
    near(body.validation.volumeMm3, 40 * 30 * 5 - Math.PI * 16 * 5);
  }
});

test('a hole in the empty notch of an L is refused while both of its arms accept one', async () => {
  // The decisive case, because an L extruded from one profile has a single
  // L-shaped cap: the tool axis is perpendicular to exactly two faces and
  // clears every boundary edge by a wide margin, so everything except
  // containment says yes. All three used to produce identical bodies.
  const bracket = (cx, cy) => `${header}
export function part(context is Context, id is Id, definition is map)
{
    var p = newSketchOnPlane(context, id + "p", { "sketchPlane" : plane(vector(0,0,0)*millimeter, vector(0,0,1)) });
    skPolyline(p, "poly", { "points" : [vector(-25,-25)*millimeter, vector(25,-25)*millimeter, vector(25,-12)*millimeter,
        vector(-12,-12)*millimeter, vector(-12,25)*millimeter, vector(-25,25)*millimeter, vector(-25,-25)*millimeter] });
    skSolve(p);
    opExtrude(context, id + "plate", { "entities" : qSketchRegion(id + "p"),
        "direction" : vector(0,0,1), "endBound" : BoundingType.BLIND, "endDepth" : 5*millimeter });
    var t = newSketchOnPlane(context, id + "t", { "sketchPlane" : plane(vector(0,0,-1)*millimeter, vector(0,0,1)) });
    skCircle(t, "c", { "center" : vector(${cx},${cy})*millimeter, "radius" : 4*millimeter });
    skSolve(t);
    opExtrude(context, id + "tool", { "entities" : qSketchRegion(id + "t"),
        "direction" : vector(0,0,1), "endBound" : BoundingType.BLIND, "endDepth" : 7*millimeter });
    opBoolean(context, id + "bore", { "targets" : qCreatedBy(id + "plate", EntityType.BODY),
        "tools" : qCreatedBy(id + "tool", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });
}`;
  await assert.rejects(build(bracket(8, 8), { feature: 'part', modelingPolicy: exactOnly }), /must land in material/);
  for (const [cx, cy] of [[8, -18.5], [-18, 8]]) {
    const body = (await build(bracket(cx, cy), { feature: 'part' })).bodies[0];
    near(body.validation.volumeMm3, 5655 - Math.PI * 16 * 5);
  }
});

// A plate bored several times in turn, which is what a mounting plate is.
const drilled = holes => `${header}
export function part(context is Context, id is Id, definition is map)
{
    var p = newSketchOnPlane(context, id + "p", { "sketchPlane" : plane(vector(0,0,0)*millimeter, vector(0,0,1)) });
    skRectangle(p, "r", { "firstCorner" : vector(-30,-20)*millimeter, "secondCorner" : vector(30,20)*millimeter });
    skSolve(p);
    opExtrude(context, id + "plate", { "entities" : qSketchRegion(id + "p"),
        "direction" : vector(0,0,1), "endBound" : BoundingType.BLIND, "endDepth" : 4*millimeter });
${holes.map(([x, y, r], i) => `    var t${i} = newSketchOnPlane(context, id + "t${i}", { "sketchPlane" : plane(vector(0,0,-1)*millimeter, vector(0,0,1)) });
    skCircle(t${i}, "c", { "center" : vector(${x},${y})*millimeter, "radius" : ${r}*millimeter });
    skSolve(t${i});
    opExtrude(context, id + "tool${i}", { "entities" : qSketchRegion(id + "t${i}"),
        "direction" : vector(0,0,1), "endBound" : BoundingType.BLIND, "endDepth" : 6*millimeter });
    opBoolean(context, id + "bore${i}", { "targets" : qCreatedBy(id + "${i ? `bore${i - 1}` : 'plate'}", EntityType.BODY),
        "tools" : qCreatedBy(id + "tool${i}", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });`).join('\n')}
}`;

test('a plate takes four mounting holes, each exact', async () => {
  // The second bore used to be refused outright: the first left a cylindrical
  // wall and circular rims behind, and admission demanded an all-planar body.
  const corners = [[-22, -13, 2.1], [22, -13, 2.1], [22, 13, 2.1], [-22, 13, 2.1]];
  const body = (await build(drilled(corners), { feature: 'part' })).bodies[0];
  near(body.validation.volumeMm3, 60 * 40 * 4 - 4 * Math.PI * 2.1 * 2.1 * 4);
  // Eight plate vertices and two per hole; twelve plate edges and three per
  // hole; six plate faces and one wall per hole.
  assert.deepEqual([body.vertices.length, body.edges.length, body.faces.length], [16, 24, 10]);
  let loops = 0;
  const tally = new Map();
  for (const face of body.faces)
    for (const loop of face.loops) {
      loops++;
      for (const use of loop.uses ?? loop) {
        const entry = tally.get(use.edge) ?? { forward: 0, backward: 0 };
        use.forward ? entry.forward++ : entry.backward++;
        tally.set(use.edge, entry);
      }
    }
  for (const [edge, entry] of tally)
    assert.deepEqual([entry.forward, entry.backward], [1, 1], `edge ${edge} is used ${entry.forward}f/${entry.backward}b`);
  // Four through holes is genus four: V - E + 2F - L - 2S + 2G = 0.
  assert.equal(16 - 24 + 2 * 10 - loops - 2 * 1 + 2 * 4, 0);
});

test('a second hole may not open into the first, nor sit inside it', async () => {
  // Both are refused by admissions the first hole itself created: its rim is
  // now a boundary edge the next hole has to clear, and its interior is a
  // region the containment test counts as outside the material.
  await assert.rejects(build(drilled([[0, 0, 3], [5, 0, 3]]), { feature: 'part', modelingPolicy: exactOnly }), /clear a boundary edge/);
  await assert.rejects(build(drilled([[0, 0, 5], [0, 0, 2]]), { feature: 'part', modelingPolicy: exactOnly }), /must land in material/);
  // Far enough apart and both are cut.
  const body = (await build(drilled([[0, 0, 3], [12, 0, 3]]), { feature: 'part' })).bodies[0];
  near(body.validation.volumeMm3, 60 * 40 * 4 - 2 * Math.PI * 9 * 4);
});

// --- The pierce gate (docs/corpus/cluster-boolean-capability.md §4, pierce v2
// step 0): ranged lines are admitted, ranged circles and volume-less targets
// are refused by name, and a rigid copy of a pierced body keeps its volume.

const repro = name => readFileSync(new URL(`../fixtures/corpus-repro/${name}`, import.meta.url), 'utf8');

// A 40 x 30 x 5 plate from the native line/arc sketch path with lines only:
// every one of its twelve line edges carries a curveRange.
async function rangedPlate(kernel) {
  const points = [[-0.02, -0.015], [0.02, -0.015], [0.02, 0.015], [-0.02, 0.015]];
  const entities = points.map((p, index) => ({ type: 'line', index, startMeters: p, endMeters: points[(index + 1) % 4] }));
  const plane = { origin: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0] };
  return extrudeSketchArcs(kernel.sketchArcs, kernel, solveSketchArcs(kernel.sketchArcs, entities), 'plate', plane, [0, 0, 5]);
}
const pin = (kernel, center, radius = 4) => circularFrustumInBend(kernel, 'tool',
  { center, radius, plane: { origin: [0, 0, -1], normal: [0, 0, 1], x: [1, 0, 0] } }, null, [0, 0, 7]);

test('a through hole is cut into a body whose line edges carry a curveRange', async () => {
  const kernel = await loadKernel(), plate = await rangedPlate(kernel);
  assert.equal(plate.edges.length, 12);
  assert.ok(plate.edges.every(edge => edge.curve.type === 'line' && edge.curveRange));
  const [body] = booleanInBend(kernel, plate, pin(kernel, [3, 2]), 'SUBTRACTION', 'bore', null);
  assert.equal(body.construction.method, 'native Bend through-hole pierce');
  near(body.validation.volumeMm3, 40 * 30 * 5 - Math.PI * 16 * 5);
  assert.deepEqual([body.vertices.length, body.edges.length, body.faces.length], [10, 15, 7]);
  // The kernel kept every original line, so each keeps its range; the new
  // rims and the seam line carry none.
  assert.deepEqual(body.edges.map(edge => edge.curveRange ?? null), [...plate.edges.map(edge => edge.curveRange), null, null, null]);
});

test('a through-hole target without a certified volume is refused by name, with its location', async () => {
  const kernel = await loadKernel(), plate = await rangedPlate(kernel);
  // A kernel solid decoded without measures, as recovered bodies and imported
  // snapshots are: validateAnalytic states no volume rather than invent one.
  const bare = decodeAnalytic(encodeAnalytic(plate), 'bare', kernel);
  assert.equal(bare.validation.volumeMm3, null);
  const loc = { line: 12, column: 5 };
  assert.throws(() => booleanInBend(kernel, bare, pin(kernel, [3, 2]), 'SUBTRACTION', 'bore', loc, { modelingPolicy: exactOnly }), error =>
    error instanceof UnsupportedFeatureError && !(error instanceof RangeError) &&
    /through hole needs a target with a certified volume/.test(error.message) && error.line === 12 && error.column === 5);
  // A declined hole still reports its own reason first.
  assert.throws(() => booleanInBend(kernel, bare, pin(kernel, [19, 2]), 'SUBTRACTION', 'bore', loc, { modelingPolicy: exactOnly }), /clear a boundary edge/);
});

test('a target with a ranged circle edge is still refused, now as a through-hole refusal', async () => {
  // Rounded plate corners are arcs: the admission reads every circle edge as a
  // full turn, so this must not reach it.
  const source = repro('boolean-capability/through-hole-admission.fs');
  await assert.rejects(build(source, { feature: 'arcPlateHole', modelingPolicy: exactOnly }), error =>
    error instanceof UnsupportedFeatureError && /through holes do not admit arc edges/.test(error.message));
});

test('a pierced plate copied by opPattern takes a second exact hole (next-pierce-after-copy.fs)', async () => {
  // r10b's cut() clones its target before every Boolean. The copy used to lose
  // its volume, and the second pierce threw a RangeError in real(null).
  const model = await build(repro('kernel-sketch-and-ops/next-pierce-after-copy.fs'), { feature: 'pierceAfterCopy' });
  const [first, second] = model.bodies;
  const hole = Math.PI * 1.6 * 1.6 * 5;
  near(first.validation.volumeMm3, 40 * 20 * 5 - hole);
  near(second.validation.volumeMm3, 40 * 20 * 5 - 2 * hole);
  assert.equal(second.construction.method, 'native Bend through-hole pierce');
  assert.deepEqual([second.vertices.length, second.edges.length, second.faces.length], [12, 18, 8]);
});

test('pierce, a moving opPattern copy, then a second pierce in the copy gives the exact volume', async () => {
  const source = `${header}
export function part(context is Context, id is Id, definition is map)
{
    fCuboid(context, id + "plate", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(40, 20, 5) * millimeter });
    var t1 = newSketchOnPlane(context, id + "t1", { "sketchPlane" : plane(vector(10, 10, -1) * millimeter, vector(0, 0, 1)) });
    skCircle(t1, "c", { "center" : vector(0, 0) * millimeter, "radius" : 3 * millimeter });
    skSolve(t1);
    opExtrude(context, id + "tool1", { "entities" : qSketchRegion(id + "t1"), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 7 * millimeter });
    opBoolean(context, id + "b1", { "targets" : qCreatedBy(id + "plate", EntityType.BODY), "tools" : qCreatedBy(id + "tool1", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });
    opPattern(context, id + "copy", { "entities" : qCreatedBy(id + "plate", EntityType.BODY),
        "transforms" : [transform(vector(0, 50, 10) * millimeter)], "instanceNames" : ["moved"] });
    var t2 = newSketchOnPlane(context, id + "t2", { "sketchPlane" : plane(vector(30, 60, 9) * millimeter, vector(0, 0, 1)) });
    skCircle(t2, "c", { "center" : vector(0, 0) * millimeter, "radius" : 2 * millimeter });
    skSolve(t2);
    opExtrude(context, id + "tool2", { "entities" : qSketchRegion(id + "t2"), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 7 * millimeter });
    opBoolean(context, id + "b2", { "targets" : qCreatedBy(id + "copy", EntityType.BODY), "tools" : qCreatedBy(id + "tool2", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });
}`;
  const model = await build(source, { feature: 'part' });
  const copy = model.bodies.find(body => body.construction?.method === 'native Bend through-hole pierce' && body.vertices.every(v => v[1] >= 50 - 1e-9));
  assert.ok(copy, 'the second pierce acts on the moved copy');
  near(copy.validation.volumeMm3, 40 * 20 * 5 - Math.PI * 9 * 5 - Math.PI * 4 * 5);
  assert.deepEqual([copy.vertices.length, copy.edges.length, copy.faces.length], [12, 18, 8]);
});

test('a rigid copy of a pierced body keeps its exact volume and states no invented bounds', async () => {
  const kernel = await loadKernel();
  const [body] = booleanInBend(kernel, await rangedPlate(kernel), pin(kernel, [3, 2]), 'SUBTRACTION', 'bore', null);
  const moved = transformAnalytic(kernel, body, 'moved', [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [100, 0, 0]);
  assert.equal(moved.validation.volumeMm3, body.validation.volumeMm3);
  assert.equal(moved.validation.boundsMm, null);
  assert.equal(moved.construction.method, 'native Bend through-hole pierce');
  assert.match(moved.validation.scope, /rigidly preserved exact through-hole volume/);
});

}
