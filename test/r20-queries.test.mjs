import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend() || missing("local design note", "fixtures/r10b/modules/carrier/RxXD.body.json");
if (publicTreeSkip) {
  test("r20-queries.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { readFileSync } = await import("node:fs");
const { default: assert } = await import("node:assert/strict");
const { parse } = await import("../src/parser.mjs");
const { Interpreter } = await import("../src/interpreter.mjs");
const { ModelingContext, loadModelingServices } = await import("../src/library.mjs");
const { build } = await import("../src/index.mjs");
const { loadKernel } = await import("../src/kernel.mjs");
const { importOnshapeBody } = await import("../src/analytic.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");
const { EnumValue, Id, Plane, Quantity, Vector, map } = await import("../src/values.mjs");
const { TopologyQuery, resolveTopology } = await import("../src/queries.mjs");
// R20 gate task fs-queries (local design note section 4, task 2): the query and
// property gaps of the R20 kernel cases. PropertyType.DESCRIPTION,
// qContainsPoint over faces and edges, qAdjacent(faces, AdjacencyType.EDGE,
// ...) and the opFillet/opChamfer capability refusals (src/queries.mjs).













const header = 'FeatureScript 3044;\nimport(path : "onshape/std/geometry.fs", version : "3044.0");\n';
const feature = body => `${header}export function main(context is Context, id is Id, definition is map)\n{\n${body}\n}\n`;
const box = (name, a, b) => `fCuboid(context, id + "${name}", { "corner1" : vector(${a}) * millimeter, "corner2" : vector(${b}) * millimeter });\n`;
// A 40 x 30 x 5 plate with a Ø8 through hole on the z axis (the pierce arm):
// 4 top lines, 4 bottom lines, 4 vertical lines, two rim circles and the bore
// seam line; top, bottom, four walls and the bore.
const plate = `
    var p = newSketchOnPlane(context, id + "p", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1)) });
    skRectangle(p, "r", { "firstCorner" : vector(-20, -15) * millimeter, "secondCorner" : vector(20, 15) * millimeter });
    skSolve(p);
    opExtrude(context, id + "plate", { "entities" : qSketchRegion(id + "p"),
        "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 5 * millimeter });
    var t = newSketchOnPlane(context, id + "t", { "sketchPlane" : plane(vector(0, 0, -1) * millimeter, vector(0, 0, 1)) });
    skCircle(t, "c", { "center" : vector(0, 0) * millimeter, "radius" : 4 * millimeter });
    skSolve(t);
    opExtrude(context, id + "tool", { "entities" : qSketchRegion(id + "t"),
        "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 7 * millimeter });
    opBoolean(context, id + "bore", { "targets" : qCreatedBy(id + "plate", EntityType.BODY),
        "tools" : qCreatedBy(id + "tool", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });
`;

async function engineFor(body) {
  const engine = new ModelingContext(await loadKernel(), { services: await loadModelingServices() });
  new Interpreter(engine.builtins()).run(parse(feature(body)), 'main', engine.context, new Id(['model']), map({}));
  return engine;
}
const entityType = name => new EnumValue('EntityType', name);
const mm = xyz => new Vector(xyz.map(v => new Quantity(v / 1000)));
const owned = type => new TopologyQuery('owned', { query: new TopologyQuery('allSolid'), entityType: entityType(type) });
// Empty-result assertions compare entity kinds and indices, never raw rows: a failing
// deepEqual over rows renders the whole B-rep (4.8 GB for a 7-face plate, verify-3).
const assertNone = rows => assert.deepEqual(rows.map(row => `${row.kind} ${row.index}`), []);
const containing = (engine, type, xyz) => resolveTopology(engine, new TopologyQuery('containsPoint', { query: owned(type), point: mm(xyz) }));
const faceOf = (engine, row) => engine.bodies[0].faces[row.index];
const edgeOf = (engine, row) => engine.bodies[0].edges[row.index];
const edgeVertices = (engine, row) => { const e = edgeOf(engine, row); return [engine.bodies[0].vertices[e.start], engine.bodies[0].vertices[e.end]]; };
const planeZ = (engine, rows) => rows.map(row => faceOf(engine, row).surface).map(s => s.type === 'plane' ? `plane z=${s.origin[2]}` : s.type).sort();

test('PropertyType.DESCRIPTION: set and get round trip; the default is empty; a rolled-back sub-feature restores it', async () => {
  const get = 'getProperty(context, { "entity" : qCreatedBy(id + "a", EntityType.BODY), "propertyType" : PropertyType.DESCRIPTION })';
  const set = value => `setProperty(context, { "entities" : qCreatedBy(id + "a", EntityType.BODY), "propertyType" : PropertyType.DESCRIPTION, "value" : ${value} });`;
  const model = await build(feature(`${box('a', '0,0,0', '1,1,1')}
    if (${get} != "") throw regenError("default");
    ${set('"stamp" ~ " | " ~ "text"')}
    if (${get} != "stamp | text") throw regenError("round trip");
    if (getProperty(context, { "entity" : qCreatedBy(id + "a", EntityType.BODY), "propertyType" : PropertyType.NAME }) != "model/a") throw regenError("name");`));
  assert.equal(model.bodies[0].description, 'stamp | text');
  assert.equal(JSON.parse(JSON.stringify(model.bodies[0])).description, 'stamp | text');
  // std feature.fs @abortFeature: a caught sub-feature failure undoes its setProperty.
  const source = `${header}
    const setsDescription = defineFeature(function(context is Context, id is Id, definition is map) precondition {} {
        setProperty(context, { "entities" : qCreatedBy(makeId("model") + "a", EntityType.BODY), "propertyType" : PropertyType.DESCRIPTION, "value" : "rolled back" });
        throw regenError("x");
    });
    export const main = defineFeature(function(context is Context, id is Id, definition is map) precondition {} {
        ${box('a', '0,0,0', '1,1,1')}
        ${set('"kept"')}
        try silent { setsDescription(context, id + "sub", {}); }
        if (${get} != "kept") throw regenError("restored " ~ ${get});
    });`;
  assert.equal((await build(source)).bodies[0].description, 'kept');
  const unset = await build(source.replace(set('"kept"'), '').replace('!= "kept"', '!= ""'));
  assert.equal(unset.bodies[0].description, undefined);
  await assert.rejects(build(feature(`${box('a', '0,0,0', '1,1,1')} ${set('3')}`)), /DESCRIPTION expects a string/);
  await assert.rejects(build(feature(`${box('a', '0,0,0', '1,1,1')} ${set('"x"').replace('DESCRIPTION', 'MATERIAL')}`)),
    error => error instanceof UnsupportedFeatureError && /PropertyType.MATERIAL is not implemented/.test(error.message));
});

test('qContainsPoint over faces: on the carrier and inside the trimmed face, a hole excluded', async () => {
  const engine = await engineFor(plate);
  const body = engine.bodies[0];
  assert.deepEqual([body.vertices.length, body.edges.length, body.faces.length], [10, 15, 7]);
  assert.deepEqual(planeZ(engine, containing(engine, 'FACE', [10, 5, 5])), ['plane z=5']);
  // Inside the hole's outline on the top plane: the plane carrier, but not the trimmed face.
  assertNone(containing(engine, 'FACE', [1, 1, 5]));
  assertNone(containing(engine, 'FACE', [0, 0, 0]));
  // Off the carrier by 1 µm, and on the carrier outside the outer loop.
  assertNone(containing(engine, 'FACE', [10, 5, 5.001]));
  assertNone(containing(engine, 'FACE', [25, 5, 5]));
  // The bore wall (cylinder classifier) and a rim point, which bounds both faces.
  const wall = containing(engine, 'FACE', [4 * Math.cos(1), 4 * Math.sin(1), 2.5]);
  assert.deepEqual(planeZ(engine, wall), ['cylinder']);
  assert.deepEqual(planeZ(engine, containing(engine, 'FACE', [0, -4, 5])), ['cylinder', 'plane z=5']);
  // A block corner lies on three faces.
  assert.equal(containing(engine, 'FACE', [20, 15, 5]).length, 3);
});

test('qContainsPoint over edges: circles and lines within their range', async () => {
  const engine = await engineFor(plate);
  // A point on the top rim circle: that circle only (not the bottom rim, not the seam).
  const rim = containing(engine, 'EDGE', [4 * Math.cos(2), 4 * Math.sin(2), 5]);
  assert.equal(rim.length, 1);
  assert.equal(edgeOf(engine, rim[0]).curve.type, 'circle');
  assert.ok(Math.abs(edgeOf(engine, rim[0]).curve.origin[2] - 5) < 1e-9);
  // On the bore wall between the rims: above and below both circles, on neither.
  assertNone(containing(engine, 'EDGE', [4 * Math.cos(2), 4 * Math.sin(2), 2.5]));
  // The circle's centre and a point 1 µm outside the rim.
  assertNone(containing(engine, 'EDGE', [0, 0, 5]));
  assertNone(containing(engine, 'EDGE', [0, -4.001, 5]));
  // A vertical block edge at mid height: exactly that line.
  const line = containing(engine, 'EDGE', [20, 15, 2.5]);
  assert.equal(line.length, 1);
  assert.deepEqual(edgeVertices(engine, line[0]).map(p => p.map(v => Math.round(v))).sort(), [[20, 15, 0], [20, 15, 5]]);
  // Beyond the line's range, on its carrier: no edge.
  assertNone(containing(engine, 'EDGE', [20, 15, 6]));
  // A top edge's midpoint; its end vertex lies on three edges.
  assert.equal(containing(engine, 'EDGE', [0, 15, 5]).length, 1);
  assert.equal(containing(engine, 'EDGE', [20, 15, 5]).length, 3);
  // A polyhedral body (fCuboid; lines only, no stored ranges): the same rules.
  const cube = await engineFor(box('a', '-15,-9,0', '15,9,26'));
  assert.equal(cube.bodies[0].edges.every(edge => edge.curve === 'line'), true);
  for (const xyz of [[15, 9, 13], [-15, 9, 13], [15, -9, 13], [-15, -9, 13]]) assert.equal(containing(cube, 'EDGE', xyz).length, 1);
  assertNone(containing(cube, 'EDGE', [15, 9, 27]));
  assertNone(containing(cube, 'EDGE', [14.999, 9, 13]));
  assert.equal(containing(cube, 'FACE', [8, 3, 0]).length, 1);
  // The same queries through FeatureScript (KS01's ksEdgesAt shape).
  await engineFor(`${plate}
    const edge = qContainsPoint(qOwnedByBody(qCreatedBy(id + "plate", EntityType.BODY), EntityType.EDGE), vector(-20, -15, 2.5) * millimeter);
    if (size(evaluateQuery(context, edge)) != 1) throw regenError("edge");
    const face = qContainsPoint(qOwnedByBody(qCreatedBy(id + "plate", EntityType.BODY), EntityType.FACE), vector(8, 3, 0) * millimeter);
    if (size(evaluateQuery(context, face)) != 1) throw regenError("face");`);
});

test('qAdjacent(faces, AdjacencyType.EDGE, EDGE | FACE); other forms refuse by name', async () => {
  const engine = await engineFor(plate);
  const top = containing(engine, 'FACE', [10, 5, 5]);
  const seed = new TopologyQuery('reference', { rows: top, owner: engine });
  const adjacent = type => resolveTopology(engine, new TopologyQuery('adjacent', { query: seed, adjacencyType: new EnumValue('AdjacencyType', 'EDGE'), entityType: entityType(type) }));
  const edges = adjacent('EDGE');
  // Four outer lines and the top rim circle.
  assert.deepEqual(edges.map(row => edgeOf(engine, row).curve.type).sort(), ['circle', 'line', 'line', 'line', 'line']);
  assert.ok(edges.every(row => row.kind === 'edge'));
  // Four walls and the bore; not the top face itself, not the bottom.
  const neighbours = adjacent('FACE').map(row => faceOf(engine, row).surface);
  assert.deepEqual(neighbours.map(s => s.type).sort(), ['cylinder', 'plane', 'plane', 'plane', 'plane']);
  assert.ok(neighbours.every(s => s.type !== 'plane' || Math.abs(s.normal[2]) < 1e-12));
  // Through FeatureScript, as KS01's ksFaceEdges uses it.
  await engineFor(`${plate}
    const top = qContainsPoint(qOwnedByBody(qCreatedBy(id + "plate", EntityType.BODY), EntityType.FACE), vector(10, 5, 5) * millimeter);
    if (size(evaluateQuery(context, qAdjacent(top, AdjacencyType.EDGE, EntityType.EDGE))) != 5) throw regenError("edges");`);
  const refuses = async (query, pattern) => assert.rejects(engineFor(`${plate} try silent { evaluateQuery(context, ${query}); }`),
    error => error instanceof UnsupportedFeatureError && pattern.test(error.message));
  const faces = 'qOwnedByBody(qCreatedBy(id + "plate", EntityType.BODY), EntityType.FACE)';
  const edgeSeeds = 'qOwnedByBody(qCreatedBy(id + "plate", EntityType.BODY), EntityType.EDGE)';
  await refuses(`qAdjacent(${faces}, AdjacencyType.VERTEX, EntityType.EDGE)`, /qAdjacent with AdjacencyType.VERTEX is not implemented/);
  await refuses(`qAdjacent(${faces}, AdjacencyType.EDGE)`, /qAdjacent without an EntityType/);
  await refuses(`qAdjacent(${edgeSeeds}, AdjacencyType.EDGE, EntityType.FACE)`, /qAdjacent over edge seeds/);
  // query.fs preconditions are FeatureScript exceptions, which a try catches.
  await engineFor(`${plate} try silent { qAdjacent(${faces}, AdjacencyType.EDGE, EntityType.VERTEX); throw regenError("unreached"); }`);
});

// opFillet/opChamfer run the production fillet (test/fs-fillet.test.mjs). An
// empty selection is still refused by name as a capability error (it usually
// means edges of a Part Studio that a standalone build does not have), also
// inside try silent.
test('opFillet and opChamfer over an empty selection refuse by name with a capability error, also inside try silent', async () => {
  const chamfer = `try silent { opChamfer(context, id + "c", { "entities" : qNothing(), "chamferType" : ChamferType.EQUAL_OFFSETS, "width" : 0.42 * millimeter }); }`;
  await assert.rejects(build(feature(`${box('a', '0,0,0', '1,1,1')}${chamfer}`)),
    error => error instanceof UnsupportedFeatureError && error.line === 6 && /^opChamfer entities resolved to no edges$/.test(error.message));
  await assert.rejects(build(feature(`${box('a', '0,0,0', '1,1,1')}try { opFillet(context, id + "f", { "entities" : qNothing(), "radius" : 1 * millimeter }); } catch { }`)),
    error => error instanceof UnsupportedFeatureError && /^opFillet entities resolved to no edges$/.test(error.message));
});

test('qContainsPoint refuses vertices and unresolved classifications by name', async () => {
  await assert.rejects(engineFor(`${plate} try silent { evaluateQuery(context, qContainsPoint(qOwnedByBody(qCreatedBy(id + "plate", EntityType.BODY), EntityType.VERTEX), vector(20, 15, 5) * millimeter)); }`),
    error => error instanceof UnsupportedFeatureError && /qContainsPoint over vertices is not implemented/.test(error.message));
  // A point exactly one linear tolerance (1e-7 mm) off the top plane is
  // neither on nor off the carrier: the planar classifier's NearFacePlane.
  const engine = await engineFor(plate);
  assert.throws(() => containing(engine, 'FACE', [10, 5, 5 + 1e-7]), error => error instanceof UnsupportedFeatureError && /plane face classification unresolved: NearFacePlane/.test(error.message));
});

// ---- qCoincidesWithPlane, qGeometry, qClosestTo (std query.fs; src/queries.mjs)
const q = (kind, data) => new TopologyQuery(kind, data);
const planeAt = (origin, normal) => new Plane(mm(origin), new Vector(normal), null);
const ownedBy = (engine, type) => q('owned', { query: q('allSolid'), entityType: entityType(type) });
const coinciding = (engine, type, origin, normal) => resolveTopology(engine, q('coincidesWithPlane', { query: ownedBy(engine, type), plane: planeAt(origin, normal) }));
const ofType = (engine, type, geometryType) => resolveTopology(engine, q('geometry', { query: ownedBy(engine, type), geometryType: new EnumValue('GeometryType', geometryType) }));
const closest = (engine, type, xyz) => resolveTopology(engine, q('closestTo', { query: ownedBy(engine, type), point: mm(xyz) }));
const refusesWith = pattern => error => error instanceof UnsupportedFeatureError && pattern.test(error.message);
const revolved = (name, points, angle) => `
    { var sk = newSketchOnPlane(context, id + "${name}sk", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
      const pts = [${points.map(([a, r]) => `vector(${a}, ${r})`).join(', ')}];
      for (var i = 0; i < size(pts); i += 1)
          skLineSegment(sk, "s" ~ i, { "start" : pts[i] * millimeter, "end" : pts[(i + 1) % size(pts)] * millimeter });
      skSolve(sk);
      opRevolve(context, id + "${name}", { "entities" : qSketchRegion(id + "${name}sk", false), "axis" : line(vector(0, 0, 0) * millimeter, vector(1, 0, 0)), "angleForward" : ${angle} * degree });
      opDeleteBodies(context, id + "${name}clean", { "entities" : qCreatedBy(id + "${name}sk", EntityType.BODY) }); }`;
// A frustum (x 0..4, r 6 -> 3): two discs and a conical face, two circles.
const cone = revolved('cone', [[0, 0], [4, 0], [4, 3], [0, 6]], 360);
// A quarter turn of a ring section (r 2..5, x 0..4): four arcs, eight lines.
const quarter = revolved('quarter', [[0, 2], [4, 2], [4, 5], [0, 5]], 90);
// A r 5 cylinder with its top cut by a plane tilted about x: an ellipse edge.
const slanted = `
    var s = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1)) });
    skCircle(s, "c", { "center" : vector(0, 0) * millimeter, "radius" : 5 * millimeter });
    skSolve(s);
    opExtrude(context, id + "cyl", { "entities" : qSketchRegion(id + "s"), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 20 * millimeter });
    const n = vector(0, 0.5, 1) / norm(vector(0, 0.5, 1));
    var t = newSketchOnPlane(context, id + "t", { "sketchPlane" : plane(vector(0, 0, 10) * millimeter, n, vector(1, 0, 0)) });
    skRectangle(t, "r", { "firstCorner" : vector(-50, -50) * millimeter, "secondCorner" : vector(50, 50) * millimeter });
    skSolve(t);
    opExtrude(context, id + "tool", { "entities" : qSketchRegion(id + "t"), "direction" : n, "endBound" : BoundingType.BLIND, "endDepth" : 50 * millimeter });
    opBoolean(context, id + "cut", { "targets" : qCreatedBy(id + "cyl", EntityType.BODY), "tools" : qCreatedBy(id + "tool", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });`;

test('qOwnedByBody leaves out the seam edges and seam vertices Onshape bodies do not have; qAdjacent too', async () => {
  const engine = await engineFor(plate);
  // Stored: 10 vertices, 15 edges (with the bore's seam line and its two ends).
  assert.deepEqual([resolveTopology(engine, ownedBy(engine, 'VERTEX')).length, resolveTopology(engine, ownedBy(engine, 'EDGE')).length], [8, 14]);
  assert.ok(resolveTopology(engine, ownedBy(engine, 'VERTEX')).every(row => [0, 5].includes(Math.round(engine.bodies[0].vertices[row.index][2])) && Math.abs(engine.bodies[0].vertices[row.index][0]) === 20));
  const bore = containing(engine, 'FACE', [4 * Math.cos(1), 4 * Math.sin(1), 2.5]);
  const rims = resolveTopology(engine, q('adjacent', { query: q('reference', { rows: bore, owner: engine }), adjacencyType: new EnumValue('AdjacencyType', 'EDGE'), entityType: entityType('EDGE') }));
  assert.deepEqual(rims.map(row => edgeOf(engine, row).curve.type), ['circle', 'circle']);
  // A frustum: two circles and no vertex (its conical seam and both seam vertices left out).
  const frustum = await engineFor(cone);
  assert.deepEqual(resolveTopology(frustum, ownedBy(frustum, 'EDGE')).map(row => edgeOf(frustum, row).curve.type), ['circle', 'circle']);
  assertNone(resolveTopology(frustum, ownedBy(frustum, 'VERTEX')));
  // A revolved sphere: one face, no edge; its poles end only the seam meridian, which refuses.
  const ball = await engineFor(`
    var sk = newSketchOnPlane(context, id + "sk", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, -1, 0), vector(1, 0, 0)) });
    skArc(sk, "a", { "start" : vector(-5, 0) * millimeter, "mid" : vector(0, 5) * millimeter, "end" : vector(5, 0) * millimeter });
    skLineSegment(sk, "l", { "start" : vector(5, 0) * millimeter, "end" : vector(-5, 0) * millimeter });
    skSolve(sk);
    opRevolve(context, id + "ball", { "entities" : qSketchRegion(id + "sk", false), "axis" : line(vector(0, 0, 0) * millimeter, vector(1, 0, 0)), "angleForward" : 360 * degree });`);
  assertNone(resolveTopology(ball, ownedBy(ball, 'EDGE')));
  assert.equal(ofType(ball, 'FACE', 'SPHERE').length, 1);
  assert.throws(() => resolveTopology(ball, ownedBy(ball, 'VERTEX')), refusesWith(/vertex \d+ ends only seam edges \(a pole or apex\)/));
});

test('qCoincidesWithPlane: faces, edges and vertices lying in the plane, either normal direction', async () => {
  const engine = await engineFor(plate);
  for (const normal of [[0, 0, 1], [0, 0, -1]]) {
    assert.deepEqual(planeZ(engine, coinciding(engine, 'FACE', [3, -7, 5], normal)), ['plane z=5']);
    // Four top lines and the top rim circle; not the vertical lines that end on the plane.
    assert.deepEqual(coinciding(engine, 'EDGE', [0, 0, 5], normal).map(row => edgeOf(engine, row).curve.type).sort(), ['circle', 'line', 'line', 'line', 'line']);
    assert.equal(coinciding(engine, 'VERTEX', [0, 0, 5], normal).length, 4);
  }
  // A side wall: its face, its four lines, its four corners.
  assert.equal(coinciding(engine, 'FACE', [20, 0, 0], [1, 0, 0]).length, 1);
  const wall = coinciding(engine, 'EDGE', [20, 0, 0], [-1, 0, 0]);
  assert.equal(wall.length, 4);
  assert.ok(wall.every(row => edgeVertices(engine, row).every(p => p[0] === 20)));
  assert.equal(coinciding(engine, 'VERTEX', [20, 0, 0], [1, 0, 0]).length, 4);
  // Planted negatives. The mid plane z 2.5: the vertical lines cross it, the
  // bore wall is curved, the walls cross it; nothing lies in it.
  assertNone(coinciding(engine, 'FACE', [0, 0, 2.5], [0, 0, 1]));
  assertNone(coinciding(engine, 'EDGE', [0, 0, 2.5], [0, 0, 1]));
  // The plane through the bore axis: the cylinder never, the planar faces and all edges cross it.
  assertNone(coinciding(engine, 'FACE', [0, 0, 0], [1, 0, 0]));
  assertNone(coinciding(engine, 'EDGE', [0, 0, 0], [1, 0, 0]));
  assertNone(coinciding(engine, 'VERTEX', [0, 0, 0], [1, 0, 0]));
  // An empty query stays empty.
  assertNone(resolveTopology(engine, q('coincidesWithPlane', { query: q('union', { queries: [] }), plane: planeAt([0, 0, 5], [0, 0, 1]) })));
});

test('qCoincidesWithPlane: offsets below the kernel resolution coincide; one linear resolution unit refuses; beyond TOLERANCE.zeroLength none', async () => {
  const engine = await engineFor(plate);
  // 4e-14 mm: FeatureScript/F32x2 rounding level, far inside the margin
  // 16 x 1e-13 x 20 mm (intersections.bend guard at this scale).
  assert.equal(coinciding(engine, 'FACE', [0, 0, 5 + 4e-14], [0, 0, 1]).length, 1);
  assert.equal(coinciding(engine, 'EDGE', [0, 0, 5 + 4e-14], [0, 0, 1]).length, 5);
  assert.equal(coinciding(engine, 'VERTEX', [0, 0, 5 + 4e-14], [0, 0, 1]).length, 4);
  // Offset by one unit of the kernel's linear resolution (1e-7 mm,
  // intersections.bend default): not certified, above the rounding margin,
  // below Onshape's zero length. Never selected: a named refusal.
  for (const type of ['FACE', 'EDGE', 'VERTEX']) {
    assert.throws(() => coinciding(engine, type, [0, 0, 5 + 1e-7], [0, 0, 1]), refusesWith(/lies within 0.00001 mm \(TOLERANCE.zeroLength\) of the plane but is neither certified/));
    // Twice the zero length off: definitely not coinciding.
    assertNone(coinciding(engine, type, [0, 0, 5 + 2e-5], [0, 0, 1]));
  }
  // A plane tilted by 1e-6 rad about the top face's centre line: CrossingPlanes, not the face.
  assertNone(coinciding(engine, 'FACE', [0, 0, 5], [1e-6, 0, 1]));
});

test('qCoincidesWithPlane on conical and cylindrical faces, arcs and ellipses', async () => {
  const frustum = await engineFor(cone);
  // The x 4 disc (r 3) lies in the plane; the cone never does.
  assert.deepEqual(coinciding(frustum, 'FACE', [4, 1, 1], [1, 0, 0]).map(row => faceOf(frustum, row).surface.type), ['plane']);
  assert.deepEqual(coinciding(frustum, 'EDGE', [4, 1, 1], [-1, 0, 0]).map(row => edgeOf(frustum, row).curve.radius), [3]);
  const ring = await engineFor(quarter);
  // The x 4 end: the quarter annulus, its two arcs and two radial lines.
  assert.equal(coinciding(ring, 'FACE', [4, 0, 0], [1, 0, 0]).length, 1);
  assert.deepEqual(coinciding(ring, 'EDGE', [4, 0, 0], [1, 0, 0]).map(row => edgeOf(ring, row).curve.type).sort(), ['circle', 'circle', 'line', 'line']);
  // The profile plane z 0 holds one end face and its four lines, no arc.
  assert.deepEqual(coinciding(ring, 'EDGE', [0, 0, 0], [0, 0, 1]).map(row => edgeOf(ring, row).curve.type), ['line', 'line', 'line', 'line']);
  const cut = await engineFor(slanted);
  const n = [0, 0.5, 1].map(v => v / Math.hypot(0.5, 1));
  assert.deepEqual(coinciding(cut, 'FACE', [0, 0, 10], n).map(row => faceOf(cut, row).surface.type), ['plane']);
  assert.deepEqual(coinciding(cut, 'EDGE', [0, 0, 10], n).map(row => edgeOf(cut, row).curve.type), ['ellipse']);
  // Bodies refuse by name.
  assert.throws(() => resolveTopology(cut, q('coincidesWithPlane', { query: q('allSolid'), plane: planeAt([0, 0, 0], [0, 0, 1]) })), refusesWith(/qCoincidesWithPlane over bodies is not implemented/));
});

test('qGeometry: every GeometryType against faces and edges; CIRCLE is a whole circle, ARC a part', async () => {
  const ALL = ['LINE', 'CIRCLE', 'ARC', 'OTHER_CURVE', 'PLANE', 'CYLINDER', 'CONE', 'SPHERE', 'TORUS', 'REVOLVED', 'EXTRUDED', 'OTHER_SURFACE', 'ALL_MESH', 'MIXED_MESH', 'MESH'];
  const cases = [
    [plate, { PLANE: 6, CYLINDER: 1 }, { LINE: 12, CIRCLE: 2 }],
    [cone, { PLANE: 2, CONE: 1 }, { CIRCLE: 2 }],
    [quarter, { PLANE: 4, CYLINDER: 2 }, { LINE: 8, ARC: 4 }],
    [slanted, { PLANE: 2, CYLINDER: 1 }, { CIRCLE: 1, OTHER_CURVE: 1 }],
  ];
  for (const [source, faces, edges] of cases) {
    const engine = await engineFor(source);
    for (const type of ALL) {
      assert.equal(ofType(engine, 'FACE', type).length, faces[type] ?? 0, `faces ${type}`);
      assert.equal(ofType(engine, 'EDGE', type).length, edges[type] ?? 0, `edges ${type}`);
    }
  }
  const engine = await engineFor(plate);
  assert.throws(() => ofType(engine, 'VERTEX', 'LINE'), refusesWith(/qGeometry over vertex entities is not implemented/));
  assertNone(resolveTopology(engine, q('geometry', { query: q('allSolid'), geometryType: new EnumValue('GeometryType', 'MESH') })));
  assert.throws(() => resolveTopology(engine, q('geometry', { query: q('allSolid'), geometryType: new EnumValue('GeometryType', 'PLANE') })), refusesWith(/over bodies is not implemented/));
  // Through FeatureScript: std's GeometryType members, and a non-member is an error.
  await engineFor(`${quarter}
    if (size(evaluateQuery(context, qGeometry(qOwnedByBody(qCreatedBy(id + "quarter", EntityType.BODY), EntityType.EDGE), GeometryType.ARC))) != 4) throw regenError("arcs");`);
  await assert.rejects(engineFor(`${quarter} qGeometry(qNothing(), GeometryType.ELLIPSE);`), /qGeometry expects a GeometryType/);
});

test('qClosestTo: vertices, lines, circles, arcs and faces; ties within TOLERANCE.zeroLength', async () => {
  const cube = await engineFor(box('a', '-15,-9,0', '15,9,26'));
  // The centre: all eight corners tie; near a corner, that one.
  assert.equal(closest(cube, 'VERTEX', [0, 0, 13]).length, 8);
  assert.deepEqual(closest(cube, 'VERTEX', [14, 8, 25]).map(row => cube.bodies[0].vertices[row.index].map(Math.round)), [[15, 9, 26]]);
  // The four x-direction edges (y +-9, z 0 / 26) are 15.81 mm from (0, d, 13).
  // Moving d changes the y +9 and y -9 distances by +-0.57 d: d 3e-6 keeps all
  // four within 1e-5 mm, d 2e-5 leaves the two y +9 edges.
  assert.equal(closest(cube, 'EDGE', [0, 0, 13]).length, 4);
  assert.equal(closest(cube, 'EDGE', [0, 3e-6, 13]).length, 4);
  const near = closest(cube, 'EDGE', [0, 2e-5, 13]);
  assert.equal(near.length, 2);
  assert.ok(near.every(row => edgeVertices(cube, row).every(p => Math.round(p[1]) === 9)));
  // Faces: the top face (a projection inside it) and a side face from outside.
  assert.deepEqual(closest(cube, 'FACE', [1, 1, 30]).map(row => Math.round(cube.bodies[0].faces[row.index].surface.origin[2])), [26]);
  assert.equal(closest(cube, 'FACE', [20, 0, 13]).length, 1);
  // The plate: from inside the bore the cylinder is closest (3 mm; the top and
  // bottom faces project into the hole, their rims are 3.9 mm away).
  const engine = await engineFor(plate);
  assert.deepEqual(planeZ(engine, closest(engine, 'FACE', [1, 0, 2.5])), ['cylinder']);
  // Above the top rim: the top circle, not the bottom one.
  const rim = closest(engine, 'EDGE', [0, -4, 5.5]);
  assert.equal(rim.length, 1);
  assert.equal(edgeOf(engine, rim[0]).curve.origin[2], 5);
  // Arcs: across the missing three quarters the closest point of an arc is its end.
  const ring = await engineFor(quarter);
  const arcs = q('geometry', { query: ownedBy(ring, 'EDGE'), geometryType: new EnumValue('GeometryType', 'ARC') });
  const toArc = xyz => resolveTopology(ring, q('closestTo', { query: arcs, point: mm(xyz) })).map(row => edgeOf(ring, row).curve);
  // (0, 0, -5.5): below the axis, opposite the quarter (y >= 0, z >= 0 side is swept from +y towards +z);
  // the r 5 arc at x 0 ends at (0, 5, 0) and (0, 0, 5); its end (0, 0, 5) is 10.5 away, the r 2 arc's 7.5.
  assert.deepEqual(toArc([0, 0, -5.5]).map(c => [c.origin[0], c.radius]), [[0, 2]]);
  // (0, 3.6, 3.6): inside the quarter, 0.09 mm from the r 5 arc at x 0.
  assert.deepEqual(toArc([0, 3.6, 3.6]).map(c => [c.origin[0], c.radius]), [[0, 5]]);
  // Empty in, empty out; conical faces and a point on a cylinder's axis refuse by name.
  assertNone(resolveTopology(engine, q('closestTo', { query: q('union', { queries: [] }), point: mm([0, 0, 0]) })));
  const frustum = await engineFor(cone);
  assert.throws(() => closest(frustum, 'FACE', [9, 9, 9]), refusesWith(/qClosestTo over a cone face is not implemented/));
  assert.throws(() => closest(engine, 'FACE', [0, 0, 2.5]), refusesWith(/lies on the axis of cylindrical face/));
});

// An imported Onshape body (src/modules.mjs importOnshapeBody) carries a
// vertex tolerance of 3e-4 mm, far above TOLERANCE.zeroLength (1e-5 mm), so
// each distance is known to +-3e-4 mm only. The frozen r10b carrier part.
test('qClosestTo on an imported Onshape body: a certain winner is kept; ties within its vertex tolerance refuse', async () => {
  const kernel = await loadKernel();
  const source = JSON.parse(readFileSync(new URL('../fixtures/r10b/modules/carrier/RxXD.body.json', import.meta.url))).bodies[0];
  const engine = new ModelingContext(kernel, { services: await loadModelingServices() });
  engine.addSolid(new Id(['carrier']), importOnshapeBody(kernel, source, 'carrier/RxXD', { source: 'frozen r10b carrier part' }));
  const body = engine.bodies[0];
  assert.ok(Math.max(...body.vertexTolerancesMm) < 3.01e-4 && Math.min(...body.vertexTolerancesMm) >= 3e-4);
  const vertices = resolveTopology(engine, ownedBy(engine, 'VERTEX'));
  const at = row => body.vertices[row.index];
  const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
  // 50 mm beyond the vertex with the largest x + y + z: the closest by plain
  // distances is millimetres ahead of the runner-up.
  const extreme = vertices.reduce((best, row) => at(row).reduce((s, v) => s + v) > at(best).reduce((s, v) => s + v) ? row : best);
  const far = at(extreme).map(v => v + 50);
  const [first, second] = vertices.map(row => ({ row, d: distance(at(row), far) })).sort((a, b) => a.d - b.d);
  assert.ok(second.d - first.d > 1);
  // Vertex indices: a failing deepEqual over rows would render the whole body.
  const toPoint = (rows, point) => resolveTopology(engine, q('closestTo', { query: q('reference', { rows, owner: engine }), point: mm(point) })).map(row => row.index);
  assert.deepEqual(toPoint(vertices, far), [first.row.index]);
  assert.deepEqual(toPoint([first.row], far), [first.row.index]);
  // Two vertices, a point on the line through them offset from their midpoint
  // by gap / 2: the distances differ by the gap. With u = 3e-4 mm each, the
  // nearer is certainly closest from gap 2u - zeroLength and the other certainly
  // out beyond 2u + zeroLength (6.1e-4 mm); below that it is undecided.
  const [a, b] = [first.row, second.row], length = distance(at(a), at(b));
  const towardA = gap => at(a).map((v, i) => (v + at(b)[i]) / 2 + (v - at(b)[i]) / length * gap / 2);
  assert.deepEqual(toPoint([a, b], towardA(1e-3)), [a.index]);
  assert.deepEqual(toPoint([b, a], towardA(1e-3)), [a.index]);
  for (const gap of [0, 3e-4]) assert.throws(() => toPoint([a, b], towardA(gap)), refusesWith(/qClosestTo: whether vertex \d+ of body carrier\/RxXD ties with the closest within TOLERANCE.zeroLength/));
});

test('evBox3d over vertices: the box of their points, on polyhedral and analytic bodies', async () => {
  // fCuboid gives a polyhedral body, the extruded and bored plate an analytic one.
  const boxOf = (topology, min, max) => `
    { const b = evBox3d(context, { "topology" : ${topology} });
      if (b.minCorner != vector(${min}) * millimeter || b.maxCorner != vector(${max}) * millimeter)
          throw regenError("evBox3d " ~ toString(b.minCorner / millimeter) ~ " .. " ~ toString(b.maxCorner / millimeter)); }`;
  const vertices = name => `qOwnedByBody(qCreatedBy(id + "${name}", EntityType.BODY), EntityType.VERTEX)`;
  const inPlane = (query, z) => `qCoincidesWithPlane(${query}, plane(vector(0, 0, ${z}) * millimeter, vector(0, 0, 1)))`;
  await build(feature(`${box('a', '0,0,0', '10,20,30')}${plate}
    ${boxOf(vertices('a'), '0, 0, 0', '10, 20, 30')}
    ${boxOf(inPlane(vertices('a'), 0), '0, 0, 0', '10, 20, 0')}
    ${boxOf(inPlane(vertices('plate'), 5), '-20, -15, 5', '20, 15, 5')}`));
});

// std query.fs qParallelEdges(queryToFilter, direction | edges); return.fs
// r20RetArmPlateBlends/r20RetBlockBlends/r20RetXbarBlends call it in both forms.
const parallelTo = (engine, query, reference) => resolveTopology(engine, q('parallelEdges', { query, reference }));
const lineDirection = (engine, row) => { const [a, b] = edgeVertices(engine, row); const d = b.map((v, i) => v - a[i]); const n = Math.hypot(...d); return d.map(v => v / n); };
// A 10 x 5 x 3 box rotated 30 deg about z (sketched corners, so its carriers
// come from FeatureScript-rounded points): four edges along (cos 30, sin 30, 0).
const rotatedBox = `
    const u = vector(cos(30 * degree), sin(30 * degree));
    const w = vector(-sin(30 * degree), cos(30 * degree));
    var sk = newSketchOnPlane(context, id + "rsk", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
    const pts = [vector(0, 0), 10 * u, 10 * u + 5 * w, 5 * w];
    for (var i = 0; i < 4; i += 1)
        skLineSegment(sk, "s" ~ i, { "start" : pts[i] * millimeter, "end" : pts[(i + 1) % 4] * millimeter });
    skSolve(sk);
    opExtrude(context, id + "rot", { "entities" : qSketchRegion(id + "rsk", false), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 3 * millimeter });`;

test('qParallelEdges: the linear edges parallel or anti-parallel to a direction or to reference edges; nothing else', async () => {
  const engine = await engineFor(plate);
  const edges = ownedBy(engine, 'EDGE');
  // x: the four 40 mm lines at y +-15, z 0 / 5; -x (anti-parallel) gives the same.
  for (const reference of [new Vector([1, 0, 0]), new Vector([-3, 0, 0])]) {
    const along = parallelTo(engine, edges, reference);
    assert.equal(along.length, 4);
    assert.ok(along.every(row => { const d = lineDirection(engine, row); return Math.abs(d[1]) === 0 && Math.abs(d[2]) === 0; }));
  }
  // z: the four corner lines; the bore's seam line is no Onshape edge (qOwnedByBody leaves it out).
  assert.ok(parallelTo(engine, edges, new Vector([0, 0, 1])).every(row => { const [a, b] = edgeVertices(engine, row); return Math.abs(a[0]) === 20 && a[0] === b[0] && a[1] === b[1]; }));
  assert.equal(parallelTo(engine, edges, new Vector([0, 0, 1])).length, 4);
  // Planted negatives: a diagonal, 1e-6 rad off x (beyond the 1e-10 angular
  // tolerance), faces (not edges), the two rim circles (not linear), an empty query.
  assertNone(parallelTo(engine, edges, new Vector([1, 1, 0])));
  assertNone(parallelTo(engine, edges, new Vector([1, 1e-6, 0])));
  assertNone(parallelTo(engine, ownedBy(engine, 'FACE'), new Vector([0, 0, 1])));
  const circles = q('geometry', { query: edges, geometryType: new EnumValue('GeometryType', 'CIRCLE') });
  assertNone(parallelTo(engine, circles, new Vector([0, 0, 1])));
  assertNone(parallelTo(engine, q('union', { queries: [] }), new Vector([1, 0, 0])));
  // 1e-13 rad off x is below the kernel's angular guard (1e-12): parallel. 1e-11
  // rad is above it and below the 1e-10 tolerance: undecided, a named refusal.
  assert.equal(parallelTo(engine, edges, new Vector([1, 1e-13, 0])).length, 4);
  assert.throws(() => parallelTo(engine, edges, new Vector([1, 1e-11, 0])), refusesWith(/qParallelEdges: edge \d+ of body .* is within 1e-10 rad of parallel to the reference but neither certified parallel nor within the kernel's angular guard/));
  // The edge-query form: parallel to any linear edge of the reference; a circle gives no direction.
  const xEdge = q('reference', { rows: parallelTo(engine, edges, new Vector([1, 0, 0])).slice(0, 1), owner: engine });
  const zEdge = q('reference', { rows: parallelTo(engine, edges, new Vector([0, 0, 1])).slice(0, 1), owner: engine });
  assert.equal(parallelTo(engine, edges, xEdge).length, 4);
  assert.equal(parallelTo(engine, edges, q('union', { queries: [xEdge, zEdge] })).length, 8);
  assertNone(parallelTo(engine, edges, circles));
  // A rotated box: the FeatureScript direction (cos 30, sin 30, 0) against
  // carriers from rounded sketch points is decided by the rounding step.
  const rotated = await engineFor(rotatedBox);
  const turned = parallelTo(rotated, ownedBy(rotated, 'EDGE'), new Vector([Math.cos(Math.PI / 6), Math.sin(Math.PI / 6), 0]));
  assert.equal(turned.length, 4);
  assert.ok(turned.every(row => Math.abs(lineDirection(rotated, row)[1] / lineDirection(rotated, row)[0] - Math.tan(Math.PI / 6)) < 1e-12));
  // Through FeatureScript: the return.fs call shapes (vector and subtraction), the internal one-argument form, a zero direction.
  await engineFor(`${box('a', '0,0,0', '30,10,5')}
    const edges = qOwnedByBody(qCreatedBy(id + "a", EntityType.BODY), EntityType.EDGE);
    const along = qParallelEdges(edges, vector(1, 0, 0));
    if (size(evaluateQuery(context, along)) != 4 || size(evaluateQuery(context, qSubtraction(edges, along))) != 8) throw regenError("box");
    if (size(evaluateQuery(context, qParallelEdges(edges, vector(0, 0, -2) * millimeter))) != 4) throw regenError("length vector");
    // The x edge at y 0, z 0 as the reference edge.
    const xEdge = qCoincidesWithPlane(qCoincidesWithPlane(edges, plane(vector(0, 0, 0) * millimeter, vector(0, 1, 0))), plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1)));
    if (size(evaluateQuery(context, xEdge)) != 1 || size(evaluateQuery(context, qParallelEdges(edges, xEdge))) != 4) throw regenError("edge form");`);
  await assert.rejects(engineFor(`${box('a', '0,0,0', '30,10,5')} qParallelEdges(qCreatedBy(id + "a", EntityType.EDGE));`), refusesWith(/qParallelEdges\(referenceEdges\) is internal to std/));
  await assert.rejects(engineFor(`${box('a', '0,0,0', '30,10,5')} qParallelEdges(qCreatedBy(id + "a", EntityType.EDGE), vector(0, 0, 0));`), /the direction is a zero vector/);
});

// edge.fs r20EdgeCrestChamfer / r20EdgeSeamFillets call shapes (edge.fs:775-816),
// on a synthetic plate: edge.fs cannot build at HEAD (edge.fs:647). The same
// constants, frames and operations: a six-line section extruded along the rail
// normal, cut by the tilted top plane, unioned with the backer and two feet.
const edgeSites = `
    const ORIGIN = vector(0.0, 0.0, 203.0) * millimeter;
    const RZ = vector(0.00000000000000000, 0.42261826174069944, 0.90630778703664994);
    const railX = vector(1, 0, 0);
    const railRy = cross(RZ, railX);
    const railPlane = plane(ORIGIN, RZ, railX);
    const back = 49.99 * millimeter;
    const extrudeLoop = function(name is string, sketchPlane is Plane, pts is array, forward is ValueWithUnits, depthBack is ValueWithUnits) returns Query
    {
        var sk = newSketchOnPlane(context, id + (name ~ "sk"), { "sketchPlane" : plane(sketchPlane.origin - depthBack * sketchPlane.normal, sketchPlane.normal, sketchPlane.x) });
        for (var i = 0; i < size(pts); i += 1)
            skLineSegment(sk, "s" ~ i, { "start" : pts[i] * millimeter, "end" : pts[(i + 1) % size(pts)] * millimeter });
        skSolve(sk);
        opExtrude(context, id + name, { "entities" : qSketchRegion(id + (name ~ "sk"), false), "direction" : sketchPlane.normal, "endBound" : BoundingType.BLIND, "endDepth" : forward + depthBack });
        opDeleteBodies(context, id + (name ~ "clean"), { "entities" : qCreatedBy(id + (name ~ "sk"), EntityType.BODY) });
        return qCreatedBy(id + name, EntityType.BODY);
    };
    const rect = function(lo, hi) { return [lo, vector(hi[0], lo[1]), hi, vector(lo[0], hi[1])]; };
    const count = function(q is Query) returns number { return size(evaluateQuery(context, q)); };
    var plate = extrudeLoop("plate", railPlane, [vector(-92.8, 0.5), vector(-92.8, 2.5), vector(-90.8, 4.5), vector(90.8, 4.5), vector(92.8, 2.5), vector(92.8, 0.5)], 250 * millimeter, back);
    // edge.fs r20EdgeTopPlane for theta 15 deg.
    const normalRaw = RZ - tan(15 * degree) * railX - tan(5 * degree) * railRy;
    const normal = normalRaw / norm(normalRaw);
    const xRaw = railX - dot(railX, normal) * normal;
    const cutPlane = plane(ORIGIN - 90 * millimeter * railX + 4.5 * millimeter * railRy + 55.44256378523035 * millimeter * RZ, normal, xRaw / norm(xRaw));
    const cutter = extrudeLoop("cutter", cutPlane, rect(vector(-500, -500), vector(500, 500)), 500 * millimeter, 0 * millimeter);
    opBoolean(context, id + "cut", { "targets" : plate, "tools" : cutter, "operationType" : BooleanOperationType.SUBTRACTION });
    const topFace = qCoincidesWithPlane(qOwnedByBody(plate, EntityType.FACE), cutPlane);
    const crestRyPlane = plane(ORIGIN + 4.5 * millimeter * railRy, railRy);
    const crestEdge = qCoincidesWithPlane(qAdjacent(topFace, AdjacencyType.EDGE, EntityType.EDGE), crestRyPlane);
    const backer = extrudeLoop("backer", railPlane, rect(vector(-88, 4), vector(88, 13.5)), -21.509830580600397 * millimeter, back);
    const footL = extrudeLoop("footL", railPlane, rect(vector(-70, 4), vector(-50, 22)), -36 * millimeter, back);
    const footR = extrudeLoop("footR", railPlane, rect(vector(50, 4), vector(70, 22)), -36 * millimeter, back);
    opBoolean(context, id + "join", { "tools" : qUnion([plate, backer, footL, footR]), "operationType" : BooleanOperationType.UNION });
    const body = qUnion([plate, qCreatedBy(id + "join", EntityType.BODY)]);
    const backerFace = qCoincidesWithPlane(qOwnedByBody(body, EntityType.FACE), plane(ORIGIN - 21.509830580600397 * millimeter * RZ, RZ));
    const backerSeam = qCoincidesWithPlane(qAdjacent(backerFace, AdjacencyType.EDGE, EntityType.EDGE), crestRyPlane);
    const footFaces = qCoincidesWithPlane(qOwnedByBody(body, EntityType.FACE), plane(ORIGIN - 36 * millimeter * RZ, RZ));
    const footSeam = qCoincidesWithPlane(qAdjacent(footFaces, AdjacencyType.EDGE, EntityType.EDGE), crestRyPlane);`;

test('edge.fs call sites on a synthetic plate: the tilted top face, the crest edge, the backer seam; no foot seam exists', async () => {
  // Before the union (the crest chamfer runs on the plate alone).
  const crestOnly = edgeSites.slice(0, edgeSites.indexOf('    const backer = '));
  const engine = await engineFor(`${crestOnly}
    if (count(topFace) != 1 || count(crestEdge) != 1) throw regenError("crest " ~ count(topFace) ~ " " ~ count(crestEdge));`);
  // The top face lies on the tilted plane; its carrier was built from the
  // same Plane on another path (plane_plane: NearParallelPlanes), so it is
  // selected by the rounding step. The crest edge is the one line of that face
  // on the rail_ry 4.5 wall: both its ends have rail_ry 4.5.
  const railRy = [0, 0.90630778703664994, -0.42261826174069944];
  const top = resolveTopology(engine, q('coincidesWithPlane', { query: ownedBy(engine, 'EDGE'), plane: planeAt([0, 4.5 * railRy[1], 203 + 4.5 * railRy[2]], railRy) }));
  const crest = top.filter(row => edgeVertices(engine, row).every(p => p[2] > 203 + 40));
  assert.equal(crest.length, 1);
  assert.ok(edgeVertices(engine, crest[0]).every(p => Math.abs(p[1] * railRy[1] + (p[2] - 203) * railRy[2] - 4.5) < 1e-9));
  // After the union: the backer's top face and its seam with the plate at
  // rail_ry 4.5. The feet's top faces are exposed only for rail_ry 13.5..22
  // (the backer covers rail_ry 4..13.5 up to rz -21.5 above them), so no
  // foot/plate seam lies on the crest plane: edge.fs:816 finds 0, not 2.
  await engineFor(`${edgeSites}
    if (count(backerFace) != 1 || count(backerSeam) != 1) throw regenError("backer " ~ count(backerFace) ~ " " ~ count(backerSeam));
    if (count(footFaces) != 2 || count(footSeam) != 0) throw regenError("feet " ~ count(footFaces) ~ " " ~ count(footSeam));`);
});

// tray.fs r20TrayBlends call shapes (tray.fs:1032-1045) on an analytic tray:
// the real T01 is a certified mesh already after its cavity cut, so its edge
// queries refuse there (no exact edges). An open box (end walls x +-100 inside,
// rim z 40) with a round hole through the left end wall.
test('tray.fs blend call shapes: end-wall faces, their straight edges below the rim, the rim edges', async () => {
  await engineFor(`
    fCuboid(context, id + "outer", { "corner1" : vector(-103.15, 0, 0) * millimeter, "corner2" : vector(103.15, 60, 40) * millimeter });
    fCuboid(context, id + "cavity", { "corner1" : vector(-100, 3, 3) * millimeter, "corner2" : vector(100, 57, 50) * millimeter });
    opBoolean(context, id + "hollow", { "targets" : qCreatedBy(id + "outer", EntityType.BODY), "tools" : qCreatedBy(id + "cavity", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });
    var s = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(vector(-110, 30, 20) * millimeter, vector(1, 0, 0)) });
    skCircle(s, "c", { "center" : vector(0, 0) * millimeter, "radius" : 2 * millimeter });
    skSolve(s);
    opExtrude(context, id + "pin", { "entities" : qSketchRegion(id + "s"), "direction" : vector(1, 0, 0), "endBound" : BoundingType.BLIND, "endDepth" : 15 * millimeter });
    opBoolean(context, id + "hole", { "targets" : qCreatedBy(id + "outer", EntityType.BODY), "tools" : qCreatedBy(id + "pin", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });
    const body = qCreatedBy(id + "outer", EntityType.BODY);
    const count = function(q is Query) returns number { return size(evaluateQuery(context, q)); };
    const rimPlane = plane(vector(0, 30, 40) * millimeter, vector(0, 0, 1));
    var concave = [];
    for (var side in [-1, 1])
    {
        const wall = qCoincidesWithPlane(qOwnedByBody(body, EntityType.FACE), plane(vector(side * 100, 30, 20) * millimeter, vector(side, 0, 0)));
        const edges = qAdjacent(wall, AdjacencyType.EDGE, EntityType.EDGE);
        // The left wall also has the hole's circle; LINE drops it, the rim plane drops the top line.
        if (count(wall) != 1 || count(edges) != (side == -1 ? 5 : 4)) throw regenError("wall " ~ side);
        concave = append(concave, qSubtraction(qGeometry(edges, GeometryType.LINE), qCoincidesWithPlane(edges, rimPlane)));
    }
    if (count(qUnion(concave)) != 6) throw regenError("concave " ~ count(qUnion(concave)));
    // The rim face's outer and inner rectangle; the vertical edges only end on the plane.
    if (count(qCoincidesWithPlane(qOwnedByBody(body, EntityType.EDGE), rimPlane)) != 8) throw regenError("rim");`);
});

}
