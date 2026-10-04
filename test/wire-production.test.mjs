import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("wire-production.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { readFileSync } = await import("node:fs");
const { build } = await import("../src/index.mjs");
const { loadJsKernel, extrudeInBend, transformInBend, snapPrismCaps, CAP_SNAP, PROFILE_MERGE } = await import("../src/kernel.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");
const { real } = await import("../src/real.mjs");
// W2 task D (docs/corpus/w2-plan.md): production extrusions and rigid copies
// go through the Bend profile ring merge and the F32x2 polygon prism.








const kernel = await loadJsKernel();
const xy = { origin: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0] };
const volumeOf = body => body.validation.volumeMm3;
// Host float64 volume (brep.mjs validateSolid) of F32x2 words: closed forms to 1e-9 relative.
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
const repro = (cluster, name) => readFileSync(new URL(`../fixtures/corpus-repro/${cluster}/${name}`, import.meta.url), 'utf8');

test('a straight-on profile vertex is merged exactly and the identities name the source edges', () => {
  const points = [[0, 0], [20, 0], [20, 8], [20, 16], [0, 16]];
  const body = extrudeInBend(kernel, 'ex', points, xy, [0, 0, 5]);
  assert.equal(body.precision, 'F32x2');
  assert.equal(body.exactness, undefined);
  assert.deepEqual([body.vertices.length, body.edges.length, body.faces.length], [8, 12, 6]);
  near(volumeOf(body), 1600);
  const merge = body.construction.profileMerge;
  assert.equal(body.construction.method, 'native Bend F32x2 polygon prism');
  assert.deepEqual({ ...merge, toleranceMm: undefined }, { sourceVertices: 5, keptVertices: 4, kept: [0, 1, 3, 4],
    merged: [{ index: 2, deviationMm: 0, exact: true }], toleranceMm: undefined });
  assert.ok(body.construction.requiredIncidenceMm <= body.construction.allowanceMm);
  // Side face 1 spans source edges 1 (20,0)->(20,8) and 2 (20,8)->(20,16).
  const { identity } = body;
  assert.deepEqual(identity.profile, { sourceVertices: 5, kept: [0, 1, 3, 4] });
  assert.deepEqual(identity.topology.faces[3].source, { kind: 'profile-span', sourceVertices: 5, sourceEdges: [1, 2] });
  assert.deepEqual(identity.topology.faces[5].source.sourceEdges, [4]);
  assert.equal(identity.topology.vertices[6].source.sourceVertex, 3);
  // A rigid copy keeps the spans.
  const copy = transformInBend(kernel, body, 'copy', [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [100, 0, 0]);
  assert.deepEqual(copy.identity.profile, identity.profile);
  assert.deepEqual(copy.identity.topology.faces[3].source, identity.topology.faces[3].source);
});

test('a profile without merges carries no span metadata', () => {
  const body = extrudeInBend(kernel, 'box', [[0, 0], [3, 0], [3, 2], [0, 2]], xy, [0, 0, 1]);
  assert.deepEqual(body.construction.profileMerge.merged, []);
  assert.equal(body.construction.profileMerge.kept, undefined);
  assert.equal(body.identity.profile, undefined);
  assert.equal(body.identity.topology.faces[2].source, undefined);
});

test('a near-collinear vertex is a recorded regularization, not exact geometry', () => {
  assert.equal(PROFILE_MERGE.allowRegularized, true);
  const points = [[0, 0], [10, 0], [20, 2e-6], [20, 10], [0, 10]];
  const body = extrudeInBend(kernel, 'ex', points, xy, [0, 0, 1]);
  assert.equal(body.exactness, 'regularized');
  const [merge] = body.construction.profileMerge.merged;
  assert.equal(merge.index, 1);
  assert.equal(merge.exact, false);
  assert.ok(merge.deviationMm > 0 && merge.deviationMm <= body.construction.profileMerge.toleranceMm);
});

test('ring and prism refusals are named capability errors', () => {
  // The host admits nothing like this; the adapter is called directly.
  assert.throws(() => extrudeInBend(kernel, 'back', [[0, 0], [10, 0], [5, 0], [5, 5]], xy, [0, 0, 1]),
    e => e instanceof UnsupportedFeatureError && /Profile ring simplification in Bend refused the profile: Backtracking at vertex \d/.test(e.message));
  const skewed = { origin: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 1e-6] };
  assert.throws(() => extrudeInBend(kernel, 'frame', [[0, 0], [1, 0], [1, 1]], skewed, [0, 0, 1]),
    e => e instanceof UnsupportedFeatureError && e.message === 'Polygon prism extrusion in Bend refused: InvalidFrame');
  assert.throws(() => extrudeInBend(kernel, 'flat', [[0, 0], [1, 0], [1, 1]], xy, [1, 0, 0]),
    e => e instanceof UnsupportedFeatureError && e.message === 'Polygon prism extrusion in Bend refused: DegenerateSweep');
});

test('startOffset moves the prism rigidly with the plane', () => {
  const body = extrudeInBend(kernel, 'ex', [[0, 0], [2, 0], [2, 1], [0, 1]], xy, [0, 0, 3], [0, 0, 1.5]);
  assert.deepEqual([Math.min(...body.vertices.map(v => v[2])), Math.max(...body.vertices.map(v => v[2]))], [1.5, 4.5]);
  near(volumeOf(body), 6);
});

// W2 integrate: the cap origins are summed in binary64 and split once
// (src/kernel.mjs prismInputs). With an F32x2 sum of the split summands the
// pocket top below (1.68 + 10.1) drifted 2.9e-14 mm from the box top (0 + 11.78)
// and the planar arrangement refused the contact (AmbiguousContact, stage 2);
// HEAD's F32 rounding had hidden it. Found by W5b (tmp/w5b/h-report/regress/tray.fs).
test('coplanar caps reached by different sums get equal words: an open-top tray builds', async () => {
  const box = extrudeInBend(kernel, 'a', [[-28, -14.72], [28, -14.72], [28, 14.72], [-28, 14.72]], { ...xy, origin: [0, 0, 0] }, [0, 0, 11.78]);
  const pocket = extrudeInBend(kernel, 'b', [[-26.32, -12.2], [26.32, -12.2], [26.32, 12.2], [-26.32, 12.2]], { ...xy, origin: [0, 0, 1.68] }, [0, 0, 11.78 - 1.68]);
  const top = body => body.faces[1].surface.origin[2];
  assert.equal(top(pocket), top(box));
  assert.equal(new Set(pocket.vertices.slice(4).map(v => v[2])).size, 1);
  const source = `FeatureScript 2909;
import(path : "onshape/std/geometry.fs", version : "2909.0");
annotation { "Feature Type Name" : "Tray" }
export const tray = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        fCuboid(context, id + "a", { "corner1" : vector(-28, -14.72, 0) * millimeter, "corner2" : vector(28, 14.72, 11.78) * millimeter });
        fCuboid(context, id + "b", { "corner1" : vector(-26.32, -12.2, 1.68) * millimeter, "corner2" : vector(26.32, 12.2, 11.78) * millimeter });
        opBoolean(context, id + "s", { "tools" : qCreatedBy(id + "b", EntityType.BODY), "targets" : qCreatedBy(id + "a", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });
    });`;
  const [tray] = (await build(source, { feature: 'tray' })).bodies;
  assert.deepEqual([tray.vertices.length, tray.edges.length, tray.faces.length], [48, 92, 46]);
  near(volumeOf(tray), 56 * 29.44 * 11.78 - 52.64 * 24.4 * 10.1);
});

test('a sketch x axis within 1e-8 rad of orthogonal is projected and recorded; beyond it the frame is refused', () => {
  const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
  // archive-r16/hopper.fs:121 has n.x = 8.43e-11 (archive-r17 and r21 hoppers 2.04e-9); the prism admits 1e-11.
  const generated = { origin: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 8.43e-11] };
  const body = extrudeInBend(kernel, 'gen', square, generated, [0, 0, 2]);
  assert.equal(body.exactness, 'regularized');
  const { frameRegularization } = body.construction;
  assert.ok(Math.abs(frameRegularization.orthogonalityDefect - 8.43e-11) < 1e-15, JSON.stringify(frameRegularization));
  assert.equal(frameRegularization.toleranceRad, 1e-8);
  assert.ok(body.vertices.every(v => v[2] === 0 || v[2] === 2));
  near(volumeOf(body), 200);
  // At or below 1e-12 nothing is recorded; above 1e-8 the prism refuses by name.
  const clean = extrudeInBend(kernel, 'clean', square, { ...generated, x: [1, 0, 5e-13] }, [0, 0, 2]);
  assert.equal(clean.exactness, undefined);
  assert.equal(clean.construction.frameRegularization, undefined);
  assert.throws(() => extrudeInBend(kernel, 'far', square, { ...generated, x: [1, 0, 2e-8] }, [0, 0, 2]),
    e => e instanceof UnsupportedFeatureError && e.message === 'Polygon prism extrusion in Bend refused: InvalidFrame');
});

test('a copy of an imprecise source keeps its residual and is not called F32x2', () => {
  const body = extrudeInBend(kernel, 'ex', [[0, 0], [2, 0], [2, 1], [0, 1]], xy, [0, 0, 3]);
  const bent = structuredClone(body);
  bent.vertices[4][2] += 1e-7;
  const copy = transformInBend(kernel, bent, 'copy', [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0, 0, 0]);
  assert.equal(copy.precision, 'F32');
  assert.ok(copy.construction.requiredIncidenceMm > copy.construction.allowanceMm);
  const clean = transformInBend(kernel, body, 'copy', [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [5, 0, 0]);
  assert.equal(clean.precision, 'F32x2');
  // The copy keeps its source's construction record, with its own audit.
  assert.deepEqual({ ...clean.construction, requiredIncidenceMm: 0, allowanceMm: 0 }, { ...body.construction, requiredIncidenceMm: 0, allowanceMm: 0 });
  // A source without a construction record (an F32 body from before W2) is named by the transform.
  const legacy = structuredClone(body);
  delete legacy.construction; delete legacy.precision;
  const moved = transformInBend(kernel, legacy, 'copy', [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [5, 0, 0]);
  assert.deepEqual([moved.construction.method, moved.construction.sourcePrecision, moved.precision], ['native Bend F32x2 rigid transform', 'F32', 'F32x2']);
});

test('a polyhedral face with an inner loop is refused by the rigid transform, never dropped', () => {
  const body = extrudeInBend(kernel, 'ex', [[0, 0], [2, 0], [2, 1], [0, 1]], xy, [0, 0, 3]);
  const holed = structuredClone(body);
  holed.faces[0].loops.push([...holed.faces[0].loops[0]]);
  assert.throws(() => transformInBend(kernel, holed, 'copy', [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0, 0, 0]),
    e => e instanceof UnsupportedFeatureError && /inner face loops/.test(e.message));
});

test('planar arrangement plane equality holds for a prism face with itself', () => {
  // The words of the slanted-prism-union web face (324.8, 30) -> (315, 36):
  // their F32x2 cross with themselves is 1.8e-15 off zero (R.mul is not
  // commutative in its last bits); the exact certificate decides equality.
  const v = (x, y, z) => ({ $: 'V3', x, y, z });
  const r = (hi, lo) => ({ $: 'Real', hi, lo });
  const surface = { $: 'Plane', origin: v(r(324.79998779296875, 0.00001220703143189894), r(18, 3.552713678800501e-15), r(30, 0)),
    normal: v(r(0.5221538543701172, 5.268407043956813e-9), r(0, 0), r(0.8528513312339783, -2.715771074690565e-8)),
    x: v(r(-0.8528513312339783, 2.715770719419197e-8), r(0, 0), r(0.5221538543701172, 5.268405711689184e-9)) };
  const cross = kernel.precise.cross(surface.normal, surface.normal);
  assert.notEqual(cross.y.hi + cross.y.lo, 0);
  assert.equal(kernel.planarBoolean['planar-boolean-arrangement.plane_equal'](surface, surface), true);
  const tilted = { ...surface, normal: kernel.precise.add(surface.normal, v(real(0), real(1e-9), real(0))) };
  assert.equal(kernel.planarBoolean['planar-boolean-arrangement.plane_equal'](surface, tilted), false);
});

test('W2 repros: far tilted prisms, collinear vertex and over-256 profile build exactly', async () => {
  const far = repro('kernel-sketch-and-ops', 'cap-normal-far-from-origin.fs');
  for (const [feature, volume] of [['tiltedOctagonFar', 7677.8832], ['tiltedRectangleFar', 40.4 * 6 * 6], ['tiltedOctagonNear', 7677.8832]]) {
    const [body] = (await build(far, { feature })).bodies;
    assert.ok(Math.abs(volumeOf(body) - volume) < 1e-9, `${feature}: ${volumeOf(body)}`);
    assert.equal(body.precision, 'F32x2');
  }
  const [collinear] = (await build(repro('kernel-sketch-and-ops', 'collinear-polyline-vertex.fs'))).bodies;
  assert.equal(collinear.faces.length, 6);
  near(volumeOf(collinear), 1600);
  const [polygon] = (await build(repro('kernel-sketch-and-ops', 'profile-over-256-vertices.fs'))).bodies;
  // 300-gon of radius 20, 2 mm deep: 300/2 * 20^2 * sin(1.2 deg) * 2.
  assert.ok(Math.abs(volumeOf(polygon) - 300 * 400 * Math.sin(1.2 * Math.PI / 180)) < 1e-9);
  const [panel] = (await build(repro('kernel-sketch-and-ops', 'through-hole-tilted-panel.fs'))).bodies;
  assert.ok(Math.abs(volumeOf(panel) - (280 * 70 * 3.2 - Math.PI * 1.7 ** 2 * 3.2)) < 1e-6);
});

test('W2 repros: slanted planar Booleans build with their closed-form volumes', async () => {
  const cases = [
    ['wedge-union.fs', 'slanted', 319],
    ['slanted-prism-union.fs', undefined, 206767.2],
    ['next-blocker-chamfer.fs', 'chamferOnEdge', 2800 - 14 * 45],
  ];
  for (const [file, feature, volume] of cases) {
    const [body] = (await build(repro('boolean-invalid-topology', file), { feature })).bodies;
    assert.ok(Math.abs(volumeOf(body) - volume) < 1e-6, `${file}#${feature}: ${volumeOf(body)}`);
  }
  await assert.rejects(build(repro('boolean-invalid-topology', 'many-vertex-prism-cut.fs'), { modelingPolicy: { boolean: 'exact-only' } }),
    /Native planar arrangement subtraction unresolved: UnsupportedArrangement \(stage 1, detail 0\)$/);
  // Under the default policy the exact prism arm (src/prism-boolean.mjs)
  // takes it before the hybrid: both operands are prisms on the same caps.
  const [cut] = (await build(repro('boolean-invalid-topology', 'many-vertex-prism-cut.fs'))).bodies;
  assert.equal(cut.construction.method, 'native Bend prism region Boolean');
});

// W2 integrate fix 1 (tmp/w2/verify-1/regularized-through-boolean.fs): a Boolean
// or a pierce of a regularized body is exact only relative to it. The result
// used to drop exactness (its construction record replaces the prism's), and
// the pierce scope claimed an exact through-hole volume.
test('a Boolean, a pierce and a copy of a regularized body keep the label and name the regularization', async () => {
  const plate = `
function plate(context is Context, id is Id)
{
    var s = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
    skPolyline(s, "outline", { "points" : [vector(0, 0) * millimeter, vector(20, 0) * millimeter, vector(20.000005, 8) * millimeter, vector(20, 16) * millimeter, vector(0, 16) * millimeter, vector(0, 0) * millimeter] });
    skSolve(s);
    opExtrude(context, id + "ex", { "entities" : qSketchRegion(id + "s", false), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 5 * millimeter });
    return qCreatedBy(id + "ex", EntityType.BODY);
}`;
  const source = `FeatureScript 2909;
import(path : "onshape/std/geometry.fs", version : "2909.0");
${plate}
annotation { "Feature Type Name" : "Cut" }
export const regCut = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        var p = plate(context, id + "p");
        fCuboid(context, id + "b", { "corner1" : vector(5, 4, -1) * millimeter, "corner2" : vector(10, 12, 6) * millimeter });
        opBoolean(context, id + "cut", { "tools" : qCreatedBy(id + "b", EntityType.BODY), "targets" : p, "operationType" : BooleanOperationType.SUBTRACTION });
    });
annotation { "Feature Type Name" : "Pierce" }
export const regPierce = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        var p = plate(context, id + "p");
        var h = newSketchOnPlane(context, id + "h", { "sketchPlane" : plane(vector(0, 0, -1) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
        skCircle(h, "c", { "center" : vector(10, 8) * millimeter, "radius" : 2 * millimeter });
        skSolve(h);
        opExtrude(context, id + "c", { "entities" : qSketchRegion(id + "h", false), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 7 * millimeter });
        opBoolean(context, id + "hole", { "tools" : qCreatedBy(id + "c", EntityType.BODY), "targets" : p, "operationType" : BooleanOperationType.SUBTRACTION });
        opPattern(context, id + "copy", { "entities" : qCreatedBy(id + "hole", EntityType.BODY), "transforms" : [transform(vector(0, 30, 0) * millimeter)], "instanceNames" : ["a"] });
    });
annotation { "Feature Type Name" : "Exact" }
export const exactCut = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        fCuboid(context, id + "a", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(20, 16, 5) * millimeter });
        fCuboid(context, id + "b", { "corner1" : vector(5, 4, -1) * millimeter, "corner2" : vector(10, 12, 6) * millimeter });
        opBoolean(context, id + "cut", { "tools" : qCreatedBy(id + "b", EntityType.BODY), "targets" : qCreatedBy(id + "a", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });
    });`;
  const merge = sources => sources.map(s => [s.body, s.exactness, s.profileMerge.merged.map(m => m.index)]);
  const [cut] = (await build(source, { feature: 'regCut' })).bodies;
  assert.equal(cut.construction.method, 'native Bend planar arrangement subtraction');
  assert.equal(cut.exactness, 'regularized');
  assert.deepEqual(merge(cut.regularizedSources), [['model/p/ex', 'regularized', [2]]]);
  const [{ deviationMm }] = cut.regularizedSources[0].profileMerge.merged;
  assert.ok(deviationMm > 4.9e-6 && deviationMm <= cut.regularizedSources[0].profileMerge.toleranceMm, String(deviationMm));
  const [hole, copy] = (await build(source, { feature: 'regPierce' })).bodies;
  assert.equal(hole.construction.method, 'native Bend through-hole pierce');
  for (const body of [hole, copy]) {
    assert.equal(body.exactness, 'regularized', body.id);
    assert.deepEqual(merge(body.regularizedSources), [['model/p/ex', 'regularized', [2]]], body.id);
    assert.doesNotMatch(body.validation.scope, /exact through-hole volume/, body.id);
    assert.match(body.validation.scope, /exact relative to a regularized target/, body.id);
  }
  // Exact inputs give an exact result, without a sources list.
  const [exact] = (await build(source, { feature: 'exactCut' })).bodies;
  assert.deepEqual([exact.exactness, exact.regularizedSources], [undefined, undefined]);
});

// W2 integrate fix 2 (tmp/w2/verify-1/pattern-flush.fs): the rigid-copy
// translation added the offset in F32x2, so a pocket moved up by opPattern got a
// top 2.9e-14 mm off the box top and the planar arrangement refused the contact
// (AmbiguousContact, stage 2); Python Pos() * Box() hit the same (next-box-chain.py).
test('a translated copy of a prism is the prism of its translated caps: a pocket moved flush by opPattern builds', async () => {
  const box = extrudeInBend(kernel, 'box', [[0, 0], [30, 0], [30, 30], [0, 30]], xy, [0, 0, 11.78]);
  const tool = extrudeInBend(kernel, 'tool', [[5, 5], [25, 5], [25, 25], [5, 25]], { ...xy, origin: [0, 0, -5.05] }, [0, 0, 10.1]);
  const identity = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const moved = transformInBend(kernel, tool, 'moved', identity, [0, 0, 6.73]);
  const top = body => Math.max(...body.vertices.map(v => v[2]));
  assert.equal(top(moved), top(box));
  // The same words as the pocket extruded in place, and a chain of translations sums in binary64.
  const twice = transformInBend(kernel, transformInBend(kernel, tool, 'up', identity, [0, 0, 3]), 'twice', identity, [0, 0, 3.73]);
  assert.equal(top(twice), top(box));
  assert.deepEqual({ ...moved.construction, requiredIncidenceMm: 0, allowanceMm: 0 }, { ...tool.construction, requiredIncidenceMm: 0, allowanceMm: 0 });
  // A clone carries no prism inputs and a rotation is not a translation: both take the F32x2 transform.
  const cloned = transformInBend(kernel, structuredClone(tool), 'cloned', identity, [0, 0, 6.73]);
  assert.notEqual(top(cloned), top(box));
  const bodies = (await build(PATTERN_FLUSH, { feature: 'patternFlush' })).bodies;
  const cut = bodies.find(body => body.faces.length === 46);
  assert.ok(cut, bodies.map(body => body.faces.length).join());
  near(volumeOf(cut), 30 * 30 * 11.78 - 20 * 20 * 10.1);
});
const PATTERN_FLUSH = `FeatureScript 2909;
import(path : "onshape/std/geometry.fs", version : "2909.0");
annotation { "Feature Type Name" : "Pattern-moved flush pocket" }
export const patternFlush = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        fCuboid(context, id + "box", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(30, 30, 11.78) * millimeter });
        fCuboid(context, id + "tool", { "corner1" : vector(5, 5, -5.05) * millimeter, "corner2" : vector(25, 25, 5.05) * millimeter });
        opPattern(context, id + "move", { "entities" : qCreatedBy(id + "tool", EntityType.BODY), "transforms" : [transform(vector(0, 0, 6.73) * millimeter)], "instanceNames" : ["up"] });
        opBoolean(context, id + "cut", { "tools" : qCreatedBy(id + "move", EntityType.BODY), "targets" : qCreatedBy(id + "box", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });
    });`;

// W2 integrate fix 3 (tmp/w2/verify-1/flush-line-sketch.fs): skLineSegment
// profiles reached the F32x2 prism as the line-sketch solver's F32 points
// (kernel/sketch-lines.bend Solved.points), so a pocket flush with a polyline
// face at x = 50.6 left a 1.5e-6 mm wall while the body claimed F32x2. The fix
// is in src/library.mjs skSolve: the profile takes the segments'
// binary64 endpoints in the solved order.
test('a line-segment profile reaches the prism unquantized: a flush pocket leaves no skin', async () => {
  const box = (name, x0, x1, y0, y1, z0, h, lines) => {
    const p = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], v = ([x, y]) => `vector(${x}, ${y}) * millimeter`;
    const outline = lines ? p.map((q, i) => `skLineSegment(s${name}, "l${i}", { "start" : ${v(q)}, "end" : ${v(p[(i + 1) % 4])} });`).join('\n        ')
      : `skPolyline(s${name}, "pl", { "points" : [${[...p, p[0]].map(v).join(', ')}] });`;
    return `var s${name} = newSketchOnPlane(context, id + "s${name}", { "sketchPlane" : plane(vector(0, 0, ${z0}) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
        ${outline}
        skSolve(s${name});
        opExtrude(context, id + "${name}", { "entities" : qSketchRegion(id + "s${name}", false), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : ${h} * millimeter });`;
  };
  const source = `FeatureScript 2909;
import(path : "onshape/std/geometry.fs", version : "2909.0");
annotation { "Feature Type Name" : "Flush" }
export const flushLines = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        ${box('b', 0, 50.6, 0, 20, 0, 10, false)}
        ${box('t', 20, 50.6, 5, 15, 2, 20, true)}
        opBoolean(context, id + "cut", { "tools" : qCreatedBy(id + "t", EntityType.BODY), "targets" : qCreatedBy(id + "b", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });
    });`;
  const [cut] = (await build(source, { feature: 'flushLines' })).bodies;
  const xPlanes = [...new Set(cut.faces.filter(face => Math.abs(face.surface.normal[0]) === 1).map(face => face.surface.origin[0]))].sort((a, b) => a - b);
  // one plane at x = 50.6 (as the polyline box face: 50.60000000000002, FS's metre conversion), not two 1.5e-6 mm apart
  assert.equal(xPlanes.length, 3, xPlanes.join());
  assert.ok(Math.abs(xPlanes[2] - 50.6) < 1e-12, xPlanes.join());
  assert.equal(cut.faces.length, 34);
  near(volumeOf(cut), 7672);
  // With the source's own points there is no quantization to label.
  assert.deepEqual([cut.exactness, cut.regularizedSources], [undefined, undefined]);
});

// W2 integrate fix round 2, finding 1 (tmp/w2/verify-1/flush-line-sketch.fs):
// until W1 applies the skSolve diff above, a skLineSegment profile reaches the
// prism as F32 points. The body and everything computed from it must say so
// (AGENTS.md: an approximation stays distinguishable): exactness 'quantized'
// with the measured deviation, through a Boolean and a rigid copy.
const lineSketchSource = (x1, withCopy) => `FeatureScript 2909;
import(path : "onshape/std/geometry.fs", version : "2909.0");
function boxBody(context is Context, id is Id, x0 is number, x1 is number, y0 is number, y1 is number, z0 is number, h is number, lines is boolean)
{
    var s = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(vector(0, 0, z0) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
    var p = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    if (lines)
    {
        for (var i = 0; i < 4; i += 1)
            skLineSegment(s, "l" ~ i, { "start" : vector(p[i][0], p[i][1]) * millimeter, "end" : vector(p[(i + 1) % 4][0], p[(i + 1) % 4][1]) * millimeter });
    }
    else
        skPolyline(s, "pl", { "points" : [vector(x0, y0) * millimeter, vector(x1, y0) * millimeter, vector(x1, y1) * millimeter, vector(x0, y1) * millimeter, vector(x0, y0) * millimeter] });
    skSolve(s);
    opExtrude(context, id + "ex", { "entities" : qSketchRegion(id + "s", false), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : h * millimeter });
    return qCreatedBy(id + "ex", EntityType.BODY);
}
annotation { "Feature Type Name" : "Line box" }
export const lineBox = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        var b = boxBody(context, id + "b", 0, ${x1}, 0, 20, 0, 10, true);
        ${withCopy ? 'opPattern(context, id + "copy", { "entities" : b, "transforms" : [transform(vector(0, 0, 30) * millimeter)], "instanceNames" : ["a"] });' : ''}
    });
annotation { "Feature Type Name" : "Flush" }
export const flushLines = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        var b = boxBody(context, id + "b", 0, ${x1}, 0, 20, 0, 10, false);
        var t = box(context, id + "t", 20, ${x1}, 5, 15, 2, 20, true);
        opBoolean(context, id + "cut", { "tools" : t, "targets" : b, "operationType" : BooleanOperationType.SUBTRACTION });
    });`;
test('a line-segment profile quantized to F32 states exactness quantized, through a Boolean and a copy', async () => {
  // The invariant holds before and after W1's skSolve diff: the label is there
  // exactly when the prism got other points than the source states.
  // maxDeviationMm is measured against the source's binary64 endpoints, the
  // vertices are decoded F32x2 words: equal within 1e-12 mm.
  const q = ({ maxDeviationMm, profileVertices, source }) => ({ profileVertices, source: /sketch-lines\.bend Solved\.points/.test(source),
    maxDeviationMm: Math.abs(maxDeviationMm - deviation) < 1e-12 });
  const [line, copy] = (await build(lineSketchSource(50.6, true), { feature: 'lineBox' })).bodies;
  const [polyline] = (await build(lineSketchSource(50.6, false).replace('box(context, id + "b", 0, 50.6, 0, 20, 0, 10, true)', 'box(context, id + "b", 0, 50.6, 0, 20, 0, 10, false)'), { feature: 'lineBox' })).bodies;
  const right = body => Math.max(...body.vertices.map(v => v[0]));
  const deviation = Math.abs(right(line) - right(polyline));
  const [cut] = (await build(lineSketchSource(50.6, false), { feature: 'flushLines' })).bodies;
  if (deviation === 0) {
    for (const body of [line, copy, cut]) assert.deepEqual([body.exactness, body.regularizedSources, body.construction.profileQuantization], [undefined, undefined, undefined], body.id);
    return;
  }
  // Today: the solver's F32 point, fround(50.6), about 1.526e-6 mm inside.
  assert.ok(Math.abs(deviation - Math.abs(Math.fround(50.6) - 50.6)) < 1e-12, String(deviation));
  for (const body of [line, copy]) assert.equal(body.exactness, 'quantized', body.id);
  assert.deepEqual(q(line.construction.profileQuantization), { profileVertices: 4, source: true, maxDeviationMm: true });
  assert.deepEqual(q(copy.construction.profileQuantization), q(line.construction.profileQuantization));
  assert.equal(cut.exactness, 'quantized');
  assert.deepEqual(cut.regularizedSources.map(s => [s.body, s.exactness, q(s.profileQuantization)]),
    [['model/t/ex', 'quantized', { profileVertices: 4, source: true, maxDeviationMm: true }]]);
  // An F32 value loses nothing: no label.
  const [exact] = (await build(lineSketchSource(50.5, false), { feature: 'lineBox' })).bodies;
  assert.deepEqual([exact.exactness, exact.construction.profileQuantization], [undefined, undefined]);
});

// W2 integrate fix round 2, finding 2 (tmp/w2/verify-2/fold-residual.fs): a
// flush cap reached by another binary64 sum still split to other F32x2 words
// in 7-9.5 % of two-decimal cases (tmp/w2/verify-2/fold-residual.mjs), and the
// planar arrangement refused the contact as AmbiguousContact. After that
// refusal, and only then, the Boolean is retried with the prism's cap moved
// onto the other operand's plane within the arrangement's resolution; the move
// is stated (construction.capSnap) and labelled 'regularized'.
const FOLD_RESIDUAL = `FeatureScript 2909;
import(path : "onshape/std/geometry.fs", version : "2909.0");
// verify-2: the pattern-flush idiom with other decimals (tmp/w2/verify-2/fold-residual.mjs examples).
// Box z 0..B; pocket z L..U moved up by t = B - U: an open-top pocket in Onshape.
annotation { "Feature Type Name" : "Centred pocket moved flush (B 28.26, U 3.04, t 25.22)" }
export const centredFlush = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        fCuboid(context, id + "box", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(30, 30, 28.26) * millimeter });
        fCuboid(context, id + "tool", { "corner1" : vector(5, 5, -3.04) * millimeter, "corner2" : vector(25, 25, 3.04) * millimeter });
        opPattern(context, id + "move", { "entities" : qCreatedBy(id + "tool", EntityType.BODY), "transforms" : [transform(vector(0, 0, 25.22) * millimeter)], "instanceNames" : ["up"] });
        opBoolean(context, id + "cut", { "tools" : qCreatedBy(id + "move", EntityType.BODY), "targets" : qCreatedBy(id + "box", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });
    });
annotation { "Feature Type Name" : "Pocket from 0 moved flush (B 27.08, U 20.96, t 6.12)" }
export const zeroFlush = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        fCuboid(context, id + "box", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(30, 30, 27.08) * millimeter });
        fCuboid(context, id + "tool", { "corner1" : vector(5, 5, 0) * millimeter, "corner2" : vector(25, 25, 20.96) * millimeter });
        opPattern(context, id + "move", { "entities" : qCreatedBy(id + "tool", EntityType.BODY), "transforms" : [transform(vector(0, 0, 6.12) * millimeter)], "instanceNames" : ["up"] });
        opBoolean(context, id + "cut", { "tools" : qCreatedBy(id + "move", EntityType.BODY), "targets" : qCreatedBy(id + "box", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });
    });
annotation { "Feature Type Name" : "P9 moved Boolean result flush" }
export const movedUnionFlush = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        fCuboid(context, id + "box", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(30, 30, 11.78) * millimeter });
        fCuboid(context, id + "t1", { "corner1" : vector(5, 5, -5.05) * millimeter, "corner2" : vector(15, 25, 5.05) * millimeter });
        fCuboid(context, id + "t2", { "corner1" : vector(12, 5, -5.05) * millimeter, "corner2" : vector(25, 25, 5.05) * millimeter });
        opBoolean(context, id + "u", { "tools" : qUnion([qCreatedBy(id + "t1", EntityType.BODY), qCreatedBy(id + "t2", EntityType.BODY)]), "operationType" : BooleanOperationType.UNION });
        opPattern(context, id + "move", { "entities" : qCreatedBy(id + "t1", EntityType.BODY), "transforms" : [transform(vector(0, 0, 6.73) * millimeter)], "instanceNames" : ["up"] });
        opBoolean(context, id + "cut", { "tools" : qCreatedBy(id + "move", EntityType.BODY), "targets" : qCreatedBy(id + "box", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });
    });`;
test('a flush cap off by binary64 noise is snapped onto the other operand before a retried planar Boolean, stated and labelled', async () => {
  for (const [feature, volume, moved] of [['centredFlush', 30 * 30 * 28.26 - 20 * 20 * 6.08, 25.22], ['zeroFlush', 30 * 30 * 27.08 - 20 * 20 * 20.96, 6.12]]) {
    const model = await build(FOLD_RESIDUAL, { feature });
    const cut = model.bodies.find(body => body.id === 'model/cut/0');
    assert.ok(cut, feature);
    assert.deepEqual([cut.vertices.length, cut.edges.length, cut.faces.length], [48, 92, 46], feature);
    near(volumeOf(cut), volume);
    assert.equal(cut.exactness, 'regularized', feature);
    const [source] = cut.regularizedSources;
    assert.equal(source.body, 'model/move/up/model/tool', feature);
    const [snap] = source.capSnap;
    assert.deepEqual([snap.cap, snap.axis, snap.onto], ['far', 'z', 'model/box'], feature);
    assert.ok(snap.distanceMm > 0 && snap.distanceMm <= snap.toleranceMm && snap.toleranceMm === CAP_SNAP.angularGuard * 30, JSON.stringify(snap));
    assert.ok(Math.abs(snap.toMm - (moved + (feature === 'centredFlush' ? 3.04 : 20.96))) < 1e-13, JSON.stringify(snap));
    const evidence = model.operationEvidence.find(entry => entry.capSnap);
    assert.deepEqual([evidence.capSnap.refused.reason, evidence.capSnap.retry], ['AmbiguousContact', 'Bodies'], feature);
  }
  // Caps whose words already agree resolve at once: no retry, no label.
  const flush = await build(PATTERN_FLUSH, { feature: 'patternFlush' });
  assert.ok(flush.operationEvidence.every(entry => !entry.capSnap));
  assert.ok(flush.bodies.every(body => body.exactness === undefined));
});
test('a cap snap needs an axis-aligned prism with its inputs and a plane within the resolution; a failed retry keeps the refusal', async () => {
  const box = extrudeInBend(kernel, 'box', [[0, 0], [30, 0], [30, 30], [0, 30]], xy, [0, 0, 11.78]);
  const pocket = top => extrudeInBend(kernel, 'pocket', [[5, 5], [25, 5], [25, 25], [5, 25]], { ...xy, origin: [0, 0, 2] }, [0, 0, top - 2]);
  const noisy = snapPrismCaps(kernel, pocket(11.780000000000047), box);
  assert.ok(noisy);
  assert.deepEqual(noisy.construction.capSnap.map(s => [s.cap, s.toMm]), [['far', box.vertices[4][2]]]);
  assert.ok(noisy.vertices.slice(4).every(v => v[2] === box.vertices[4][2]));
  assert.equal(noisy.exactness, 'regularized');
  assert.deepEqual(noisy.identity, pocket(11.780000000000047).identity);
  // 1e-9 mm is a real step, far above the 3e-11 mm resolution: not snapped.
  assert.equal(snapPrismCaps(kernel, pocket(11.780000001), box), null);
  // Equal words: nothing to snap.
  assert.equal(snapPrismCaps(kernel, pocket(11.78), box), null);
  // A tilted prism and a clone without prism inputs are not snapped.
  const tilted = { origin: [0, 0, 2], normal: [0, Math.sin(0.3), Math.cos(0.3)], x: [1, 0, 0] };
  assert.equal(snapPrismCaps(kernel, extrudeInBend(kernel, 'tilted', [[5, 5], [25, 5], [25, 25], [5, 25]], tilted, [0, 0, 9.78]), box), null);
  assert.equal(snapPrismCaps(kernel, structuredClone(pocket(11.780000000000047)), box), null);
  // A moved Boolean result has no prism inputs; the box cap is snapped onto it,
  // the retry stops at the in-place limit (stage 6, coplanar union fragments)
  // and the original refusal is what the user sees.
  await assert.rejects(build(FOLD_RESIDUAL, { feature: 'movedUnionFlush', modelingPolicy: { boolean: 'exact-only' } }), error => {
    const evidence = error.operationEvidence?.find(entry => entry.capSnap);
    return /AmbiguousContact \(stage 2, detail 9\)/.test(error.message) && evidence?.capSnap.snapped[0].body === 'model/box'
      && evidence.capSnap.retry === 'Unresolved' && evidence.capSnap.retryReason.stage === 6;
  });
});

}
