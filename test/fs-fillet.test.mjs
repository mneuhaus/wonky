import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("fs-fillet.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { default: fs } = await import("node:fs");
const { build } = await import("../src/index.mjs");
const { loadKernel } = await import("../src/kernel.mjs");
const { integrateVolume } = await import("../src/volume.mjs");
const { blendJob } = await import("../src/fillet-op.mjs");
const { UnsupportedFeatureError, FeatureScriptException } = await import("../src/errors.mjs");
const { encodeJob } = await import("../scripts/fillet/brepfmt.mjs");
const { normaliseBody } = await import("../scripts/fillet/geom.mjs");
const { resolveSelection } = await import("../scripts/fillet/fixtures.mjs");
// FeatureScript opFillet / opChamfer on the production fillet (kernel/fillet;
// src/fillet-fs.mjs, src/fillet-op.mjs; docs/fillet-plan.md §8 step 4), Bend
// JS target. Volumes are checked against closed forms derived here (not from
// the fillet's output) through kernel/volume.bend's integration, which knows
// nothing about the fillet. The catalogue probes (FP11, FP12) are the
// catalogue's own input sources with the selection made in FeatureScript.













const kernel = await loadKernel();
const models = fs.readFileSync(new URL('../fixtures/fillet/fs-frontend.fs', import.meta.url), 'utf8');
const cases = JSON.parse(fs.readFileSync(new URL('../fixtures/fillet/cases.json', import.meta.url), 'utf8')).cases;
const volume = body => integrateVolume(kernel, body).volumeMm3;
const near = (got, want, what) => assert.ok(Math.abs(got - want) <= 1e-12 * want, `${what}: ${got} vs closed form ${want} (${((got - want) / want).toExponential(2)})`);
const PI = Math.PI, d = 0.42, r = 4.2;
// Removed by an equal-offsets chamfer d over a convex top outline with
// perimeter P, integrated band by band (the band of width w = d - t at depth t
// has area P w - k w^2): k = 4 at the corners of a rectangle, pi for a
// convex outline whose arcs have radius >= d.
const chamferLoss = (P, k) => P * d * d / 2 - k * d ** 3 / 3;

// Marc's house style (priorities P1-P4) on small models, end to end.
const HOUSE = {
  // P1 plane/plane: top loop of a 30 x 18 x 26 block (mitred corners).
  p1Box: { V: 30 * 18 * 26 - chamferLoss(2 * (30 + 18), 4), faces: { plane: 10 }, order: [4, 5, 6, 7] },
  // P1 plane/cylinder: stadium 20 + 2 x R5, lines and G1 arcs (plane and cone chamfers).
  p1Stadium: { V: (20 * 10 + PI * 25) * 6 - chamferLoss(40 + 10 * PI, PI), faces: { plane: 6, cylinder: 2, cone: 2 }, order: [4, 5, 6, 7] },
  // P1 bore rim: block minus a R3.3 bore; the top face selects the outer loop and the rim (cylinder/plane convex).
  p1Bore: { V: 30 * 18 * 10 - PI * 3.3 ** 2 * 10 - chamferLoss(2 * (30 + 18), 4) - PI * (3.3 * d * d + d ** 3 / 3), faces: { plane: 10, cylinder: 1, cone: 1 } },
  // P3: R4.2 on the four vertical edges, tangentPropagation false.
  p3Corners: { V: 30 * 18 * 26 - 4 * (r * r - PI * r * r / 4) * 26, faces: { plane: 6, cylinder: 4 }, order: [8, 9, 10, 11] },
  // P4: P3, then the chamfer over the top loop of lines and R4.2 arcs.
  p4ChamferAfterFillet: { V: 30 * 18 * 26 - 4 * (r * r - PI * r * r / 4) * 26 - chamferLoss(2 * (30 + 18) - 8 * r + 2 * PI * r, PI), faces: { plane: 10, cylinder: 4, cone: 4 } },
  // P2: R2 at the concave root of an L-section rib.
  p2Root: { V: (20 * 4 + 4 * 12) * 30 + (4 - PI) * 30, faces: { plane: 8, cylinder: 1 }, order: [15] },
};

for (const [feature, want] of Object.entries(HOUSE)) {
  test(`${feature}: builds exactly and matches its closed form`, async () => {
    const model = await build(models, { feature, trace: false });
    assert.equal(model.bodies.length, 1);
    const body = model.bodies[0];
    near(volume(body), want.V, feature);
    const types = {};
    for (const f of body.faces) types[f.surface.type] = (types[f.surface.type] ?? 0) + 1;
    assert.deepEqual(types, want.faces);
    assert.equal(body.fillet.claim, 'exact');
    if (want.order) assert.deepEqual(body.fillet.order, want.order);
    const evidence = model.operationEvidence.filter(e => e.blend);
    assert.ok(evidence.length >= 1 && evidence.every(e => e.status === 'Resolved' && e.blend.quantizationMm === 0));
    assert.deepEqual(evidence.at(-1).blend.order, body.fillet.order, 'the recorded order is in the operation evidence');
  });
}

// The catalogue input of `id` plus a feature `probe` that runs it and then `call`
// on its body (`part`); `at(p)` is the edge through point p.
const probe = (id, call) => cases.find(c => c.id === id).input.source + `
export function probe(context is Context, id is Id, definition is map)
{
    filletInput(context, id + "in", definition);
    const part = qCreatedBy(id + "in" + "x1", EntityType.BODY);
    ${call}
}
`;
const at = p => `qContainsPoint(qOwnedByBody(part, EntityType.EDGE), vector(${p}) * millimeter)`;
const fillet = (entities, extra = '') => `opFillet(context, id + "f", { "entities" : ${entities}, "radius" : 1 * millimeter${extra} });`;
const run = source => build(source, { feature: 'probe', trace: false });

test('FP12: a tangent edge is refused as Onshape refuses it (FILLET_FAIL_SMOOTH), an ordinary error that try catches', async () => {
  const id = 'hard-tangent-edge-selection-r1';
  await assert.rejects(run(probe(id, fillet(at('20, 0, 2'), ', "tangentPropagation" : true'))),
    e => e instanceof FeatureScriptException && /^opFillet failed: FILLET_FAIL_SMOOTH \(tangent-edge: edge 9 /.test(e.message) && /\[order 9\]$/.test(e.message));
  // try silent: the failed fillet leaves the body as it was and the feature goes on.
  const model = await run(probe(id, `try silent { ${fillet(at('20, 0, 2'), ', "tangentPropagation" : true')} }`));
  assert.equal(model.bodies[0].faces.length, 6);
  assert.equal(model.bodies[0].fillet, undefined);
  assert.equal(model.operationEvidence.filter(e => e.blend).length, 0);
});

test('FP11: tangentPropagation false (also by default) stops at the unselected G1 continuation; that refusal is a capability error, also inside try silent', async () => {
  const id = 'fl-slot-one-line-no-propagate-r1', stop = /^opFillet is not implemented for this input: vertex-blend: edge 4 stops at vertex 4 where its G1 continuation 7 is not selected .*\[order 4\]$/;
  for (const call of [fillet(at('10, 0, 4'), ', "tangentPropagation" : false'), fillet(at('10, 0, 4')),
    `try silent { ${fillet(at('10, 0, 4'))} }`, `try { ${fillet(at('10, 0, 4'))} } catch (error) { }`]) {
    await assert.rejects(run(probe(id, call)), e => e instanceof UnsupportedFeatureError && stop.test(e.message), call);
  }
  // With propagation the chain is followed: the record names the added edges.
  const model = await run(probe(id, fillet(at('10, 0, 4'), ', "tangentPropagation" : true')));
  const body = model.bodies[0];
  assert.deepEqual(body.fillet.order, [4, 5, 6, 7]);
  assert.deepEqual(body.fillet.notes, ['propagated 5', 'propagated 6', 'propagated 7']);
  // closed form of fl-slot-one-line-propagate-r1 (the whole outline): (200 + 25 pi) x 4 - 15.0248...
  near(volume(body), (200 + 25 * PI) * 4 + cases.find(c => c.id === 'fl-slot-one-line-propagate-r1').closedForm.deltaVolume, 'slot outline');
});

test('a face selection blends all edges of its loops; a seam edge is ignored with a note', async () => {
  const model = await run(probe('pc-post-top-rim-r1', fillet('qContainsPoint(qOwnedByBody(part, EntityType.FACE), vector(5, 0, 5) * millimeter)', ', "tangentPropagation" : true')));
  const body = model.bodies[0];
  assert.deepEqual(body.fillet.order, [0, 1]);
  assert.deepEqual(body.fillet.notes, ['seam-ignored 2']);
  assert.equal(body.faces.filter(f => f.surface.type === 'torus').length, 2);
});

test('the fillet keeps the body identity: queries on the input find the blended body, and the lineage gains the fillet id', async () => {
  const source = `${models}
export function identity(context is Context, id is Id, definition is map)
{
    p3Corners(context, id + "p", definition);
    if (size(evaluateQuery(context, qCreatedBy(id + "p" + "corners", EntityType.BODY))) != 1)
        throw regenError("the fillet id does not find the body");
    opChamfer(context, id + "c", { "entities" : qContainsPoint(qOwnedByBody(qCreatedBy(id + "p" + "block", EntityType.BODY), EntityType.FACE), vector(1, 1, 26) * millimeter),
        "chamferType" : ChamferType.EQUAL_OFFSETS, "width" : 0.42 * millimeter, "tangentPropagation" : true });
}
`;
  const model = await build(source, { feature: 'identity', trace: false });
  near(volume(model.bodies[0]), HOUSE.p4ChamferAfterFillet.V, 'chamfer after fillet by the block id');
});

test('definitions: other chamfer types, non-default fillet options and unknown keys are capability errors; bad values are FeatureScript errors', async () => {
  const box = call => `${models}\nexport function def(context is Context, id is Id, definition is map)\n{\n    fCuboid(context, id + "b", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(10, 10, 10) * millimeter });\n    const e = qContainsPoint(qOwnedByBody(qCreatedBy(id + "b", EntityType.BODY), EntityType.EDGE), vector(10, 10, 5) * millimeter);\n    ${call}\n}\n`;
  const def = call => build(box(call), { feature: 'def', trace: false });
  for (const type of ['TWO_OFFSETS', 'OFFSET_ANGLE']) {
    await assert.rejects(def(`try silent { opChamfer(context, id + "c", { "entities" : e, "chamferType" : ChamferType.${type}, "width1" : 1 * millimeter, "width2" : 2 * millimeter }); }`),
      e => e instanceof UnsupportedFeatureError && e.message.startsWith(`opChamfer (${type}) is not implemented; only ChamferType.EQUAL_OFFSETS`));
  }
  await assert.rejects(def('opFillet(context, id + "f", { "entities" : e, "radius" : 1 * millimeter, "allowEdgeOverflow" : false });'),
    e => e instanceof UnsupportedFeatureError && /allowEdgeOverflow other than its default/.test(e.message));
  await assert.rejects(def('opFillet(context, id + "f", { "entities" : e, "radius" : 1 * millimeter, "rho" : 0.5 });'),
    e => e instanceof UnsupportedFeatureError && /field 'rho' is not implemented/.test(e.message));
  await assert.rejects(def('opFillet(context, id + "f", { "entities" : qNothing(), "radius" : 1 * millimeter });'),
    e => e instanceof UnsupportedFeatureError && /resolved to no edges/.test(e.message));
  await assert.rejects(def('opFillet(context, id + "f", { "entities" : e, "radius" : 1 * millimeter, "tangentPropagation" : 1 });'),
    e => e instanceof FeatureScriptException && /tangentPropagation must be boolean/.test(e.message));
  await assert.rejects(def('opFillet(context, id + "f", { "entities" : e, "radius" : -1 * millimeter });'),
    e => e instanceof FeatureScriptException && /radius must be positive/.test(e.message));
  // Default keys at their defaults are accepted.
  const model = await def('opFillet(context, id + "f", { "entities" : e, "radius" : 1 * millimeter, "allowEdgeOverflow" : true, "isVariable" : false, "smoothCorners" : false });');
  near(volume(model.bodies[0]), 1000 - (1 - PI / 4) * 10, 'single box edge r1');
});

// The job the frontends build is the harness's job for the same body, word for
// word (scripts/fillet/brepfmt.mjs encodeJob on geom.mjs normaliseBody), on
// every catalogue case with the harness's own selection.
test('the frontend job equals the harness encoding of the same body on all catalogue cases', async () => {
  let n = 0;
  for (const c of cases) {
    const body = (await build(c.input.source, { feature: 'filletInput', trace: false })).bodies[0];
    const select = resolveSelection(normaliseBody(body), c.select);
    const job = blendJob({ id: c.id, op: c.op, size: c.size, chamferType: c.chamferType, tangentPropagation: c.tangentPropagation, body, select });
    assert.equal(job.text, encodeJob({ id: c.id, op: c.op, size: c.size, chamferType: c.chamferType, tangentPropagation: c.tangentPropagation, body: normaliseBody(body), select }), c.id);
    n++;
  }
  assert.equal(n, cases.length);
});

// Regression (integrate-fix, verify-1 defect 2): qCreatedBy(blend id, FACE |
// EDGE) gave every face and edge of the blended body. A blend creates only its
// blend and corner faces (and their edges); the body keeps the rest.
test('qCreatedBy(blend id, FACE | EDGE) gives the blend faces and their edges; other creators keep the rest; a later replacement refuses by name', async () => {
  const created = (op, type) => `size(evaluateQuery(context, qCreatedBy(id + "p" + "${op}", EntityType.${type})))`;
  const counts = (feature, ops) => `${models}
export function counts(context is Context, id is Id, definition is map)
{
    ${feature}(context, id + "p", definition);
    const part = qCreatedBy(id + "p" + "block", EntityType.BODY);
    const onBlend = qContainsPoint(qOwnedByBody(part, EntityType.FACE), vector(10.8 + 4.2 * sqrt(0.5), 4.8 + 4.2 * sqrt(0.5), 13) * millimeter);
    throw regenError("counts" ${ops.map(([op, type]) => `~ " " ~ ${created(op, type)}`).join(' ')}
        ~ " onBlend " ~ size(evaluateQuery(context, qIntersection([qCreatedBy(id + "p" + "corners", EntityType.FACE), onBlend]))));
}
`;
  const message = async source => (await build(source, { feature: 'counts', trace: false }).then(() => null, e => e)).message;
  // R4.2 on the 4 vertical edges of a box: 4 cylinder faces with 4 edges each;
  // the block keeps its 6 trimmed faces and 8 trimmed edges, and the body.
  assert.equal(await message(counts('p3Corners', [['corners', 'FACE'], ['corners', 'EDGE'], ['corners', 'BODY'], ['block', 'FACE'], ['block', 'EDGE']])),
    'counts 4 16 1 6 8 onBlend 1');
  // Chamfer after the fillet: the chamfer's own 8 faces (4 planes, 4 cones) and 24 edges.
  const chained = `${models}
export function counts(context is Context, id is Id, definition is map)
{
    p4ChamferAfterFillet(context, id + "p", definition);
    throw regenError("counts" ~ " " ~ ${created('break', 'FACE')} ~ " " ~ ${created('break', 'EDGE')});
}
`;
  assert.equal(await message(chained), 'counts 8 24');
  // The chamfer replaced the body the fillet built: the fillet's faces (and so
  // the block's) are no longer told apart, a capability error also in try silent.
  for (const [op, call] of [['corners', 'size(evaluateQuery(context, qCreatedBy(id + "p" + "corners", EntityType.FACE)))'],
    ['block', 'try silent { evaluateQuery(context, qCreatedBy(id + "p" + "block", EntityType.EDGE)); }']]) {
    await assert.rejects(build(`${models}
export function after(context is Context, id is Id, definition is map)
{
    p4ChamferAfterFillet(context, id + "p", definition);
    ${call};
}
`, { feature: 'after', trace: false }), e => e instanceof UnsupportedFeatureError && new RegExp(`^qCreatedBy\\(model/p/${op}, (FACE|EDGE)\\): a later operation replaced`).test(e.message), op);
  }
});

// Coplanar fragments (integrate-fix round 2, verify-2 defects 1-3): wonky's
// planar Booleans leave one plane face split into coplanar fragments joined by
// edges Onshape does not have. Marc's helpers select through them: the face
// under a point (qContainsPoint) and its edges (qAdjacent), or every X-parallel
// line edge (r10b roundX).
const HDR = 'FeatureScript 3044;\nimport(path : "onshape/std/geometry.fs", version : "3044.0");\n';
const feature = body => `${HDR}
function F(context is Context, p is Vector) returns Query
{
    return qContainsPoint(qBodyType(qEverything(EntityType.FACE), BodyType.SOLID), p * millimeter);
}
function E(context is Context, p is Vector) returns Query
{
    return qContainsPoint(qBodyType(qEverything(EntityType.EDGE), BodyType.SOLID), p * millimeter);
}
export function probe(context is Context, id is Id, definition is map)
{
${body}
}
`;
const cuboid = (n, a, b) => `    fCuboid(context, id + "${n}", { "corner1" : vector(${a}) * millimeter, "corner2" : vector(${b}) * millimeter });\n`;
const boolean = (n, type, targets, tools) => `    opBoolean(context, id + "${n}", { ${targets ? `"targets" : qCreatedBy(id + "${targets}", EntityType.BODY), ` : ''}"tools" : qUnion([${tools.map(t => `qCreatedBy(id + "${t}", EntityType.BODY)`).join(', ')}]), "operationType" : BooleanOperationType.${type} });\n`;
// A 30 x 20 x 6 box with a 28 x 18 pocket from z = 2: the top face is a 1 mm ring.
const pocketRing = cuboid('p', '0, 0, 0', '30, 20, 6') + cuboid('k', '1, 1, 2', '29, 19, 7') + boolean('s', 'SUBTRACTION', 'p', ['k']);
const ringChamfer = `opChamfer(context, id + "c", { "entities" : qAdjacent(F(context, vector(0.5, 10, 6)), AdjacencyType.EDGE, EntityType.EDGE), "chamferType" : ChamferType.EQUAL_OFFSETS, "width" : 0.42 * millimeter, "tangentPropagation" : true });`;
// Outer loop (perimeter 100, 4 mitred corners) plus the pocket rim (perimeter
// 92, 4 reflex corners, each adding a d^3/3 corner pyramid).
const ringV = 30 * 20 * 6 - 28 * 18 * 4 - (chamferLoss(100, 4) + 92 * d * d / 2 + 4 * d ** 3 / 3);
const A90 = x => x * x * (1 - PI / 4);

test('qCreatedBy(blend id, EDGE) leaves out seam edges, as qOwnedByBody and qAdjacent do (Onshape has no seam edges)', async () => {
  // A cylinder R10 x 20 with a 0.42 chamfer or an R1 fillet on its top circle:
  // Onshape creates one cone or torus face bounded by two circles.
  const probe = (blend, report) => `${models}
export function seam(context is Context, id is Id, definition is map)
{
    var s = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
    skCircle(s, "c", { "center" : vector(0, 0) * millimeter, "radius" : 10 * millimeter });
    skSolve(s);
    opExtrude(context, id + "x", { "entities" : qSketchRegion(id + "s"), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 20 * millimeter });
    const part = qCreatedBy(id + "x", EntityType.BODY);
    const rim = qContainsPoint(qOwnedByBody(part, EntityType.EDGE), vector(10, 0, 20) * millimeter);
    ${blend}
    const created = qCreatedBy(id + "b", EntityType.EDGE);
    throw regenError(${report});
}
`;
  const message = async source => (await build(source, { feature: 'seam', trace: false }).then(() => null, e => e)).message;
  const counts = '"created " ~ size(evaluateQuery(context, created)) ~ " createdAndOwned " ~ size(evaluateQuery(context, qIntersection([created, qOwnedByBody(part, EntityType.EDGE)]))) ~ " lines " ~ size(evaluateQuery(context, qGeometry(created, GeometryType.LINE)))';
  for (const blend of ['opChamfer(context, id + "b", { "entities" : rim, "chamferType" : ChamferType.EQUAL_OFFSETS, "width" : 0.42 * millimeter });',
    'opFillet(context, id + "b", { "entities" : rim, "radius" : 1 * millimeter });'])
    assert.equal(await message(probe(blend, counts)), 'created 2 createdAndOwned 2 lines 0', blend);
});

test('chamfer width bound on a plane face: an obstacle arc whose end point is the nearest point limits the width (cusp at (15, 1))', async () => {
  // A 30 x 4 plate whose top outline dips to a cusp of two R arcs at (15, 1);
  // the chamfer on the opposite edge (y = 0) grows toward it. The arcs' nearest
  // point to that edge is their shared end point, 1 mm away, not an interior point.
  const cusp = width => `${models}
export function cusp(context is Context, id is Id, definition is map)
{
    var s = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
    skLineSegment(s, "a", { "start" : vector(0, 0) * millimeter, "end" : vector(30, 0) * millimeter });
    skLineSegment(s, "b", { "start" : vector(30, 0) * millimeter, "end" : vector(30, 4) * millimeter });
    skLineSegment(s, "c", { "start" : vector(30, 4) * millimeter, "end" : vector(15.645751311064590, 4) * millimeter });
    skArc(s, "B", { "start" : vector(15.645751311064590, 4) * millimeter, "mid" : vector(15.765095172153138, 2.4048120557879136) * millimeter, "end" : vector(15, 1) * millimeter });
    skArc(s, "A", { "start" : vector(15, 1) * millimeter, "mid" : vector(14.234904827846862, 2.4048120557879149) * millimeter, "end" : vector(14.354248688935408, 3.9999999999999996) * millimeter });
    skLineSegment(s, "e", { "start" : vector(14.354248688935408, 3.9999999999999996) * millimeter, "end" : vector(0, 4) * millimeter });
    skLineSegment(s, "f", { "start" : vector(0, 4) * millimeter, "end" : vector(0, 0) * millimeter });
    skSolve(s);
    opExtrude(context, id + "x", { "entities" : qSketchRegion(id + "s"), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 6 * millimeter });
    ${width === null ? '' : `opChamfer(context, id + "c", { "entities" : qContainsPoint(qOwnedByBody(qCreatedBy(id + "x", EntityType.BODY), EntityType.EDGE), vector(7, 0, 6) * millimeter), "chamferType" : ChamferType.EQUAL_OFFSETS, "width" : ${width} * millimeter });`}
}
`;
  const bodyOf = async width => (await build(cusp(width), { feature: 'cusp', trace: false })).bodies[0];
  const plain = volume(await bodyOf(null));
  // Below the end point: an ordinary straight chamfer, a prism of cross-section w^2/2 over the 30 mm edge.
  const inside = await bodyOf(0.9);
  near(volume(inside), plain - 0.9 * 0.9 / 2 * 30, 'chamfer 0.9 below the cusp');
  assert.equal(inside.fillet?.claim, 'exact');
  // Past it: an overflow named by the arc and limited to exactly the end point's distance.
  await assert.rejects(bodyOf(1.1), error => error instanceof UnsupportedFeatureError &&
    /overflow: the contact of edge \d+ on face \d+ needs width 1\.100000000e\+0 but edge \d+ limits the face to 1\.000000000e\+0/.test(error.message));
});

test('coplanar fragments: the face under a point stands for its whole region (P1 pocket ring), also inside try silent', async () => {
  const input = (await run(feature(pocketRing))).bodies[0];
  assert.ok(input.faces.length > 11, `precondition: the Boolean leaves coplanar fragments (${input.faces.length} faces, Onshape has 11)`);
  for (const call of [ringChamfer, `try silent { ${ringChamfer} }`]) {
    const body = (await run(feature(pocketRing + '    ' + call))).bodies[0];
    near(volume(body), ringV, call.slice(0, 10));
    assert.deepEqual(body.fillet.notes, []);
  }
});

test('coplanar fragments: a selected fragment edge is ignored with a note, not refused as FILLET_FAIL_SMOOTH (r10b roundX)', async () => {
  const roundX = `    var chosen = [];
    for (var e in evaluateQuery(context, qOwnedByBody(qCreatedBy(id + "p", EntityType.BODY), EntityType.EDGE)))
    {
        var tangent = try silent(evLine(context, { "edge" : e }));
        if (tangent != undefined && abs(tangent.direction[0]) > 0.99999)
            chosen = append(chosen, e);
    }
    opFillet(context, id + "f", { "entities" : qUnion(chosen), "radius" : 0.3 * millimeter });`;
  const body = (await run(feature(pocketRing + roundX))).bodies[0];
  // The four outer X edges are convex (30 mm each); the pocket rim and floor X
  // edges (28 mm each, two convex and two concave) cancel.
  near(volume(body), 30 * 20 * 6 - 28 * 18 * 4 - 4 * 30 * A90(0.3), 'roundX');
  assert.ok(body.fillet.notes.some(n => /^fragment-ignored \d+$/.test(n)), `notes ${body.fillet.notes}`);
});

test('coplanar fragments: R4.2 riser caps of a union-built stepped block build as on the one-piece extrusion (P3)', async () => {
  const stepped = cuboid('a', '0, 0, 0', '40, 24, 5') + cuboid('u', '0, 0, 5', '30, 24, 15') + boolean('j', 'UNION', null, ['a', 'u']);
  const edges = [[30, 0, 10], [30, 24, 10], [40, 0, 2.5], [40, 24, 2.5]].map(p => `E(context, vector(${p}))`);
  const body = (await run(feature(`${stepped}    opFillet(context, id + "f", { "entities" : qUnion([${edges.join(', ')}]), "radius" : 4.2 * millimeter });`))).bodies[0];
  near(volume(body), 40 * 24 * 5 + 30 * 24 * 10 - A90(r) * 30, 'stepped');
  assert.equal(body.faces.length, 12);
});

test('an obstacle ellipse on a support cylinder is bounded: the P1 bore rim under an inclined top and the P4 bottom loop after R4.2 build', async () => {
  const adversarial = JSON.parse(fs.readFileSync(new URL('../fixtures/fillet/adversarial-fillet-kpart.json', import.meta.url), 'utf8')).cases;
  const bore = adversarial.find(c => c.id === 'v2-p1-bore-bottom-rim-under-inclined-top-0.42').input.source;
  const withCall = call => `${bore}
export function probe(context is Context, id is Id, definition is map)
{
    filletInput(context, id + "in", definition);
    ${call}
}
`;
  const V0 = volume((await run(withCall(''))).bodies[0]);
  const rim = await run(withCall(`opChamfer(context, id + "c", { "entities" : qContainsPoint(qBodyType(qEverything(EntityType.EDGE), BodyType.SOLID), vector(23, 12, 0) * millimeter), "chamferType" : ChamferType.EQUAL_OFFSETS, "width" : 0.42 * millimeter });`));
  near(volume(rim.bodies[0]), V0 - PI * (3 * d * d + d ** 3 / 3), 'bore rim');
  // Wedge 40 x 24, heights 10 and 20; R4.2 on its four vertical edges, then the
  // bottom loop (perimeter P, lines and four quarter arcs: k = 4 - 4 + pi).
  const wedge = `    var s = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, -1, 0), vector(1, 0, 0)) });
    skPolyline(s, "p", { "points" : [vector(0, 0) * millimeter, vector(40, 0) * millimeter, vector(40, 20) * millimeter, vector(0, 10) * millimeter, vector(0, 0) * millimeter] });
    skSolve(s);
    opExtrude(context, id + "w", { "entities" : qSketchRegion(id + "s"), "direction" : vector(0, 1, 0), "endBound" : BoundingType.BLIND, "endDepth" : 24 * millimeter });
    opFillet(context, id + "f", { "entities" : qUnion([E(context, vector(0, 0, 5)), E(context, vector(0, 24, 5)), E(context, vector(40, 0, 10)), E(context, vector(40, 24, 10))]), "radius" : 4.2 * millimeter });
    opChamfer(context, id + "c", { "entities" : qAdjacent(F(context, vector(20, 12, 0)), AdjacencyType.EDGE, EntityType.EDGE), "chamferType" : ChamferType.EQUAL_OFFSETS, "width" : 0.42 * millimeter, "tangentPropagation" : true });`;
  const P = 128 - 4 * (2 * r - PI * r / 2);
  near(volume((await run(feature(wedge))).bodies[0]), 40 * 24 * 15 - A90(r) * (2 * 10 + 2 * 20) - chamferLoss(P, PI), 'wedge bottom loop');
});

// Obstacle extent (fillet-arc; e2e check at 770170b, R20 return.fs:1035): the
// width bound took a circle obstacle as its whole circle and a rotation
// stripe's width over the whole turn, so two arcs of one circle limited each
// other to 0. The width now reaches only the obstacle's own arc inside the
// blended edge's own extent (slab or wedge); an arc that does come within the
// width, and a closed circle, still refuse by name.
const xy = (x, y) => `vector(${x}, ${y}) * millimeter`;
const skLine = (n, a, b) => `    skLineSegment(s, "${n}", { "start" : ${xy(...a)}, "end" : ${xy(...b)} });\n`;
const skArc3 = (n, a, m, b) => `    skArc(s, "${n}", { "start" : ${xy(...a)}, "mid" : ${xy(...m)}, "end" : ${xy(...b)} });\n`;
// The profile extruded 6 mm from z = 0 (the body `part`), then `then`.
const prism = (profile, then) => feature(`    var s = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
${profile}    skSolve(s);
    opExtrude(context, id + "x", { "entities" : qSketchRegion(id + "s"), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 6 * millimeter });
    const part = qCreatedBy(id + "x", EntityType.BODY);
${then}`);
const chamferAt = (p, w) => `    opChamfer(context, id + "c", { "entities" : qContainsPoint(qOwnedByBody(part, EntityType.EDGE), vector(${p}) * millimeter), "chamferType" : ChamferType.EQUAL_OFFSETS, "width" : ${w} * millimeter });`;
// The overflow refusal of `source`: the blended edge, the limiting edge and its limit.
const overflow = async source => {
  const e = await run(source).then(() => null, x => x);
  assert.ok(e instanceof UnsupportedFeatureError, `expected a refusal, got ${e?.message ?? 'a model'}`);
  const m = /overflow: the contact of edge (\d+) on face \d+ needs width \S+ but edge (\d+) limits the face to (\S+) /.exec(e.message);
  assert.ok(m, e.message);
  return { edge: Number(m[1]), by: Number(m[2]), limit: Number(m[3]) };
};
// Edge i of `body` is the top (z = 6) circle of radius R; closed or an arc.
const isTopCircle = (body, i, R, closed) => {
  const e = body.edges[i];
  return e.curve.type === 'circle' && Math.abs(e.curve.radius - R) < 1e-12 && Math.abs(e.curve.origin[2] - 6) < 1e-12 && (e.start === e.end) === closed;
};

test('obstacle extent, translation on a plane: a tab arc whose circle comes within the width builds; a bite arc and a bore circle within it are refused by name', async () => {
  // A 30 x 3.2 strip with a semicircle R3 on its back (centre (15, 3.2)): its
  // circle comes to 0.2 of the front edge, a tab arc does not, a bite arc does.
  const strip = mid => skLine('a', [0, 0], [30, 0]) + skLine('b', [30, 0], [30, 3.2]) + skLine('c', [30, 3.2], [18, 3.2])
    + skArc3('d', [18, 3.2], [15, mid], [12, 3.2]) + skLine('e', [12, 3.2], [0, 3.2]) + skLine('f', [0, 3.2], [0, 0]);
  const front = chamferAt('15, 0, 6', 0.42);
  const tab = strip(6.2);
  // One capped edge of length 30 loses a prism of the chamfer triangle.
  near(volume((await run(prism(tab, front))).bodies[0]), (30 * 3.2 + PI * 9 / 2) * 6 - 30 * d * d / 2, 'tab');
  const bite = strip(0.2);
  const plain = (await run(prism(bite, ''))).bodies[0];
  const o = await overflow(prism(bite, front));
  assert.ok(isTopCircle(plain, o.by, 3, false), `edge ${o.by} is the bite arc`);
  assert.ok(Math.abs(o.limit - 0.2) < 1e-9, `limit ${o.limit}`);
  // The same circle closed (a through bore R3 at (15, 3.2) in a 30 x 18 block).
  const bore = extra => feature(`    fCuboid(context, id + "b", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(30, 18, 6) * millimeter });
    const part = qCreatedBy(id + "b", EntityType.BODY);
    var s = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(vector(0, 0, -1) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
    skCircle(s, "c", { "center" : ${xy(15, 3.2)}, "radius" : 3 * millimeter });
    skSolve(s);
    opExtrude(context, id + "x", { "entities" : qSketchRegion(id + "s"), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 8 * millimeter });
    opBoolean(context, id + "cut", { "targets" : part, "tools" : qCreatedBy(id + "x", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });
${extra}`);
  const bored = (await run(bore(''))).bodies[0];
  const ob = await overflow(bore(front));
  assert.ok(isTopCircle(bored, ob.by, 3, true), `edge ${ob.by} is the bore rim`);
  assert.ok(Math.abs(ob.limit - 0.2) < 1e-9, `limit ${ob.limit}`);
});

test('obstacle extent, rotation on a plane: a C ring chamfered on its outer arc is limited by its inner arc (2 mm), builds below it and at the coaxial tie exactly', async () => {
  // Outer R10 and inner R8 over 270 degrees.
  const S = Math.sqrt(0.5);
  const ring = skArc3('o', [10, 0], [-10 * S, 10 * S], [0, -10]) + skLine('a', [0, -10], [0, -8]) + skArc3('i', [0, -8], [-8 * S, 8 * S], [8, 0]) + skLine('b', [8, 0], [10, 0]);
  const plain = (await run(prism(ring, ''))).bodies[0];
  near(volume(plain), 0.75 * PI * (100 - 64) * 6, 'ring');
  // Pappus: the triangle c^2/2 about the axis at radius 10 - c/3, over 3 pi / 2.
  for (const c of [1.5, 2]) {
    const ch = (await run(prism(ring, chamferAt('-10, 0, 6', c)))).bodies[0];
    near(volume(ch), 0.75 * PI * (100 - 64) * 6 - c * c / 2 * (10 - c / 3) * 1.5 * PI, `ring chamfer ${c}`);
    // At 2 the spring lands on the coaxial inner arc: the rim's exact form
    // decides the tie (consumed), and the top face is gone.
    assert.equal(ch.fillet.claim, 'exact');
    assert.equal(ch.faces.length, c === 2 ? 6 : 7, `faces at ${c}`);
  }
  const o = await overflow(prism(ring, chamferAt('-10, 0, 6', 2.5)));
  assert.ok(isTopCircle(plain, o.edge, 10, false) && isTopCircle(plain, o.by, 8, false), `edge ${o.edge} limited by ${o.by}`);
  assert.ok(Math.abs(o.limit - 2) < 1e-9, `limit ${o.limit}`);
});

test('obstacle extent: a disc R10 crossed by a bar (two arcs of one circle), R2 junctions and a 0.42 top chamfer builds its closed form; the one-sided bar too', async () => {
  // e2eCrossFilletChamfer / e2eTeeFilletChamfer of the R20 ARM_L reduction.
  const j = Math.sqrt(91), R = 10, h = 3, r = 2, L = 25;
  const cross = skLine('a', [L, -h], [L, h]) + skLine('b', [L, h], [j, h]) + skArc3('c', [j, h], [0, R], [-j, h]) + skLine('e', [-j, h], [-L, h])
    + skLine('f', [-L, h], [-L, -h]) + skLine('g', [-L, -h], [-j, -h]) + skArc3('i', [-j, -h], [0, -R], [j, -h]) + skLine('k', [j, -h], [L, -h]);
  const tee = skLine('a', [L, -h], [L, h]) + skLine('b', [L, h], [j, h]) + skArc3('c', [j, h], [-R, 0], [j, -h]) + skLine('k', [j, -h], [L, -h]);
  const junctions = at => `    const along = qParallelEdges(qOwnedByBody(part, EntityType.EDGE), vector(0, 0, 1));
    opFillet(context, id + "f", { "entities" : qUnion([${at.map(([x, y]) => `qContainsPoint(along, vector(${x}, ${y}, 3) * millimeter)`).join(', ')}]), "radius" : 2 * millimeter });
`;
  const top = `    opChamfer(context, id + "c", { "entities" : qCoincidesWithPlane(qOwnedByBody(part, EntityType.EDGE), plane(vector(0, 0, 6) * millimeter, vector(0, 0, 1))), "chamferType" : ChamferType.EQUAL_OFFSETS, "width" : 0.42 * millimeter });`;
  // Area between the bar side y = h, the circle R and the fillet r (polygon O J T1 F T2 less two sectors).
  const a = Math.sqrt((R + r) ** 2 - (h + r) ** 2), F = [a, h + r], T2 = [a * R / (R + r), (h + r) * R / (R + r)];
  const poly = [[0, 0], [j, h], [a, h], F, T2];
  const shoelace = poly.reduce((s, p, i) => s + p[0] * poly[(i + 1) % 5][1] - poly[(i + 1) % 5][0] * p[1], 0) / 2;
  const thF = Math.acos((h + r) / (R + r)), thT = Math.asin((h + r) / (R + r)), seg = R * R * Math.acos(h / R) - h * j;
  const fillet = shoelace - R * R * (thT - Math.asin(h / R)) / 2 - r * r * thF / 2;
  // Outline area, perimeter and the corner term k (convex right-angle corners;
  // the smooth part turns by 2 pi less the corners, halved).
  const shapes = {
    cross: { src: cross, at: [[j, h], [-j, h], [-j, -h], [j, -h]], A: 2 * L * 2 * h + 2 * seg + 4 * fillet, P: 4 * h + 4 * (L - a) + 4 * r * thF + 2 * R * (PI - 2 * thT), k: 4 },
    tee: { src: tee, at: [[j, h], [j, -h]], A: PI * R * R - (R * R * Math.acos(j / R) - j * h) + 2 * h * (L - j) + 2 * fillet, P: 2 * h + 2 * (L - a) + 2 * r * thF + R * (2 * PI - 2 * thT), k: 2 + PI / 2 },
  };
  for (const [name, s] of Object.entries(shapes)) {
    const filleted = (await run(prism(s.src, junctions(s.at)))).bodies[0];
    near(volume(filleted), s.A * 6, `${name} filleted`);
    const chamfered = (await run(prism(s.src, junctions(s.at) + top))).bodies[0];
    assert.equal(chamfered.fillet.claim, 'exact');
    near(volume(chamfered), s.A * 6 - (s.P * d * d / 2 - s.k * d ** 3 / 3), `${name} chamfer`);
  }
});

// fix-round1 (verify-1 of fillet-arc): on a rim's plane side the tie v = w was
// re-decided with the coaxial-circle form R - rc - w for any circle obstacle.
// Once the width bound reaches a non-coaxial arc's end point (or a circle off
// the axis), that form said "inside" at the tie and the chamfer built a
// pinched face claimed exact. Such a tie has no exact form: it is undecidable.
test('rim chamfer against a circle off the axis: below the tie it builds, at the tie it is undecidable by name, past it an overflow by name', async () => {
  // The outcome of `source`: the claim of a built body, or the kind and
  // edges of a refusal.
  const said = o => o.built ? `built ${o.built.faces.length} faces, claim ${o.built.fillet?.claim}` : `${o.kind} by edge ${o.by}`;
  const outcome = async source => {
    const e = await run(source).then(m => m, x => x);
    if (!(e instanceof Error)) return { built: e.bodies[0] };
    assert.ok(e instanceof UnsupportedFeatureError, e.message);
    const m = /(undecidable): the width bound of edge (\d+) on face \d+ against edge (\d+)|(overflow): the contact of edge (\d+) on face \d+ needs width \S+ but edge (\d+) limits the face to (\S+) /.exec(e.message);
    assert.ok(m, e.message);
    return m[1] ? { kind: 'undecidable', edge: Number(m[2]), by: Number(m[3]) } : { kind: 'overflow', edge: Number(m[5]), by: Number(m[6]), limit: Number(m[7]) };
  };
  // A half ring: outer R10 over 0..180 degrees, inner boundary two arcs of
  // radius sqrt(58.5) about (+-1.5, 1.5) meeting at a cusp (0, 9). The rim's
  // spring (radius 10 - w) reaches the cusp, an end point of both arcs, at
  // w = 1; the arcs' circles come to 9.77 from the axis off the arcs.
  const q = Math.SQRT1_2;
  const half = skArc3('o', [10, 0], [0, 10], [-10, 0]) + skLine('l', [-10, 0], [-6, 0]) + skArc3('A', [-6, 0], [1.5 - 9 * q, 1.5 + 6 * q], [0, 9])
    + skArc3('B', [0, 9], [-1.5 + 9 * q, 1.5 + 6 * q], [6, 0]) + skLine('r', [6, 0], [10, 0]);
  const plain = (await run(prism(half, ''))).bodies[0];
  // Half disc less the triangles (0,0) (0,9) (-+6,0) and two 90-degree segments.
  const V0 = (50 * PI - 54 - 58.5 * (PI / 2 - 1)) * 6;
  near(volume(plain), V0, 'half ring');
  const pappus = (c, R, turn) => c * c / 2 * (R - c / 3) * turn;
  const cut = w => prism(half, chamferAt('0, 10, 6', w));
  near(volume((await outcome(cut(0.9))).built), V0 - pappus(0.9, 10, PI), 'half ring chamfer 0.9');
  const tie = await outcome(cut(1));
  assert.equal(tie.kind, 'undecidable', said(tie));
  assert.ok(isTopCircle(plain, tie.edge, 10, false) && isTopCircle(plain, tie.by, Math.sqrt(58.5), false), `edge ${tie.edge} against ${tie.by}`);
  const past = await outcome(cut(1.1));
  assert.equal(past.kind, 'overflow', said(past));
  assert.ok(isTopCircle(plain, past.by, Math.sqrt(58.5), false) && Math.abs(past.limit - 1) < 1e-9, `edge ${past.by} limits to ${past.limit}`);
  // The same with a closed circle off the axis: a disc R10 with a bore R1 at
  // (0, -5); the spring touches the bore at w = 4.
  const disc = extra => prism('    skCircle(s, "d", { "center" : ' + xy(0, 0) + ', "radius" : 10 * millimeter });\n', `    var t = newSketchOnPlane(context, id + "t", { "sketchPlane" : plane(vector(0, 0, -1) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
    skCircle(t, "b", { "center" : ${xy(0, -5)}, "radius" : 1 * millimeter });
    skSolve(t);
    opExtrude(context, id + "b", { "entities" : qSketchRegion(id + "t"), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 8 * millimeter });
    opBoolean(context, id + "cut", { "targets" : part, "tools" : qCreatedBy(id + "b", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });
${extra}`);
  const bored = (await run(disc(''))).bodies[0];
  near(volume(bored), 99 * PI * 6, 'bored disc');
  const rim = w => disc(chamferAt('10, 0, 6', w));
  near(volume((await outcome(rim(3.9))).built), 99 * PI * 6 - pappus(3.9, 10, 2 * PI), 'disc chamfer 3.9');
  const touch = await outcome(rim(4));
  assert.equal(touch.kind, 'undecidable', said(touch));
  assert.ok(isTopCircle(bored, touch.edge, 10, true) && isTopCircle(bored, touch.by, 1, true), `edge ${touch.edge} against ${touch.by}`);
  const over = await outcome(rim(4.1));
  assert.equal(over.kind, 'overflow', said(over));
  assert.ok(isTopCircle(bored, over.by, 1, true) && Math.abs(over.limit - 4) < 1e-9, `edge ${over.by} limits to ${over.limit}`);
});

// Reflex seams (fillet-setback; R20 edge.fs:807, the backer-plate seam): a
// concave seam where a narrower block meets a wider wall ends at a reflex
// corner of the wall's face. Onshape builds it with the block's end planes
// grown over the spandrel ends (probe fixtures/fillet/reflex-setback-reference.json,
// input fixtures/fillet/reflex-setback.fs). kernel/fillet/corners.bend
// builds it as the concave dual of the riser cap.
const reflexSource = fs.readFileSync(new URL('../fixtures/fillet/reflex-setback.fs', import.meta.url), 'utf8');
const reflexRef = JSON.parse(fs.readFileSync(new URL('../fixtures/fillet/reflex-setback-reference.json', import.meta.url), 'utf8'));

test('a reflex seam: fillet R2 and chamfer 2 build with Onshape\'s volume, face types and topology counts', async () => {
  const spandrel = { fillet: A90(2), chamfer: 2 * 2 / 2 };
  for (const [key, ref] of Object.entries(reflexRef.cases)) {
    const model = await build(reflexSource, { feature: 'reflexSetbackProbe', parameters: { chamfer: String(key === 'chamfer') }, trace: false });
    assert.equal(model.bodies.length, 1, key);
    const body = model.bodies[0];
    const V = volume(body);
    assert.ok(Math.abs(V - ref.volume) <= 1e-9 * ref.volume, `${key}: ${V} vs Onshape ${ref.volume}`);
    near(V, 6600 + 20 * spandrel[key], key); // plate 30 x 4 x 30 + backer 20 x 10 x 15; seam 20
    const types = {};
    for (const f of body.faces) types[f.surface.type] = (types[f.surface.type] ?? 0) + 1;
    assert.deepEqual(types, ref.faceTypes, key);
    assert.deepEqual([body.faces.length, body.edges.length, body.vertices.length], [ref.faces, ref.edges, ref.vertices], key);
    assert.equal(body.fillet.claim, 'exact', key);
  }
});

test('reflex seams: the grown end plane looks into air (a 1 mm plate lip builds); what the construction cannot certify stays refused by name', async () => {
  const E3 = p => `E(context, vector(${p}))`;
  const seam = (edges = ['0, 0, 15']) => `    opFillet(context, id + "f", { "entities" : qUnion([${edges.map(E3).join(', ')}]), "radius" : 2 * millimeter });\n`;
  const backer = cuboid('b', '-10, -1, 0', '10, 10, 15');
  // The plate reaches only 1 mm past the backer: its edges x = 11 lie in front
  // of the end plane x = 10 (in the air side), within the certificate's ball.
  const lip = cuboid('p', '-15, -4, 0', '11, 0, 30') + backer + boolean('j', 'UNION', null, ['p', 'b']);
  near(volume((await run(feature(lip + seam()))).bodies[0]), 26 * 4 * 30 + 20 * 10 * 15 + A90(2) * 20, 'plate lip');
  const refused = async (source, cls, why, what) => assert.rejects(run(feature(source)),
    e => e instanceof UnsupportedFeatureError && e.message.includes(`${cls}: `) && why.test(e.message), what);
  // The plate beyond the backer only 16 high: the fillet's contact (z 17) would
  // leave the plate face there (the width bound owns this).
  const split = cuboid('p', '-15, -4, 0', '10, 0, 30') + cuboid('q', '9, -4, 0', '15, 0, 16') + backer + boolean('j', 'UNION', null, ['p', 'q', 'b']);
  await refused(split + seam(), 'overflow', /limits the face to 1\.0+e\+0/, 'split');
  // A second blend at the corner: the backer's convex top edge x = 10.
  const plain = cuboid('p', '-15, -4, 0', '15, 0, 30') + backer + boolean('j', 'UNION', null, ['p', 'b']);
  await refused(plain + seam(['0, 0, 15', '10, 5, 15']), 'mixed-convexity', /meet at vertex/, 'mixed');
  // A pocket in the backer's end face under the seam's end: its edges lie in
  // the ball on the material side of the end plane, which the conservative
  // certificate does not clear (the fillet itself would be valid).
  const pocket = plain + cuboid('k', '9.5, 0.5, 13', '10.5, 1.5, 14.5') + boolean('s', 'SUBTRACTION', 'p', ['k']);
  await refused(pocket + seam(), 'vertex-blend', /behind vertex \d+ \(reflex face corner; setback patch needed\)/, 'pocket');
});

}
