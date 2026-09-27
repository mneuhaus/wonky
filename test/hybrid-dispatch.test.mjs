import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("hybrid-dispatch.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { build } = await import("../src/index.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");
const { normalizeModelingPolicy, booleanPolicy } = await import("../src/modeling-policy.mjs");
const { HYBRID_METHOD } = await import("../src/boolean.mjs");







// The hybrid corefine+recover Boolean as the last arm of booleanInBend
// (docs/hybrid-boolean-plan.md section 8, step 7): every exact arm runs first;
// what none admits goes to the hybrid instead of being refused, unless the
// policy is 'exact-only'. Driven from FeatureScript, the path a part takes.

const header = 'FeatureScript 3044;\nimport(path : "onshape/std/geometry.fs", version : "3044.0");\n';
const box = (name, lo, hi) => `fCuboid(context, id + "${name}", { "corner1" : vector(${lo.join(',')}) * millimeter, "corner2" : vector(${hi.join(',')}) * millimeter });`;
const cylinder = (name, [x, y, z], r, h, axis = [0, 0, 1]) => `
    var s${name} = newSketchOnPlane(context, id + "s${name}", { "sketchPlane" : plane(vector(${x},${y},${z})*millimeter, vector(${axis.join(',')})) });
    skCircle(s${name}, "c", { "center" : vector(0,0)*millimeter, "radius" : ${r}*millimeter });
    skSolve(s${name});
    opExtrude(context, id + "${name}", { "entities" : qSketchRegion(id + "s${name}"), "direction" : vector(${axis.join(',')}),
        "endBound" : BoundingType.BLIND, "endDepth" : ${h}*millimeter });`;
// A right circular cone about Z: base radius R at z = 0, apex at z = H.
const cone = (name, R, H) => `
    var s${name} = newSketchOnPlane(context, id + "s${name}", { "sketchPlane" : plane(vector(0,0,0)*millimeter, vector(0,-1,0), vector(1,0,0)) });
    skLineSegment(s${name}, "a", { "start" : vector(0,0)*millimeter, "end" : vector(${R},0)*millimeter });
    skLineSegment(s${name}, "b", { "start" : vector(${R},0)*millimeter, "end" : vector(0,${H})*millimeter });
    skLineSegment(s${name}, "c", { "start" : vector(0,${H})*millimeter, "end" : vector(0,0)*millimeter });
    skSolve(s${name});
    opRevolve(context, id + "${name}", { "entities" : qSketchRegion(id + "s${name}"),
        "axis" : line(vector(0,0,0)*millimeter, vector(0,0,1)), "angleForward" : 360 * degree });`;
const boolean = (operation, targets, tools) => `
    opBoolean(context, id + "op", { ${targets ? `"targets" : qCreatedBy(id + "${targets}", EntityType.BODY), ` : ''}
        "tools" : qUnion([${tools.map(t => `qCreatedBy(id + "${t}", EntityType.BODY)`).join(',')}]),
        "operationType" : BooleanOperationType.${operation} });`;
const part = body => `${header}export function part(context is Context, id is Id, definition is map)\n{\n${body}\n}`;

const cases = {
  // A blind pocket: the pierce arm declines (the tool stops inside).
  pocket: part(box('a', [0, 0, 0], [20, 20, 10]) + cylinder('t', [10, 10, 6], 4, 10) + boolean('SUBTRACTION', 'a', ['t'])),
  // A boss on a block: no exact arm unions a box with a cylinder.
  boss: part(box('a', [0, 0, 0], [20, 20, 10]) + cylinder('t', [10, 10, 5], 4, 10) + boolean('UNION', null, ['a', 't'])),
  // A cone cut by a slab: INTERSECTION with a cone face, which no exact arm takes.
  frustum: part(cone('k', 10, 20) + box('b', [-20, -20, -1], [20, 20, 8]) + boolean('INTERSECTION', null, ['k', 'b'])),
  // Two parallel, not coaxial, cylinder primitives: the coaxial arm's !supported.
  // Their heights differ, so the exact prism arm (equal cap planes) declines.
  lens: part(cylinder('p', [0, 0, 0], 5, 10) + cylinder('q', [6, 0, 0], 5, 12) + boolean('UNION', null, ['p', 'q'])),
  // Crossed rods r 5 along x and r 3 along y: the axes are skew to each other
  // (perpendicular), so the cylinders meet in space quartics, which recover
  // does not write exactly (a certified mesh).
  // The lens with the second axis tilted by 1e-12 rad: not parallel, so the
  // carriers meet in a space quartic (a certified mesh), not in two lines.
  tilted: part(cylinder('p', [0, 0, 0], 5, 10) + cylinder('q', [6, 0, 0], 5, 12, [0, 1e-12, 1]) + boolean('UNION', null, ['p', 'q'])),
  crossed: part(cylinder('p', [-10, 0, 0], 5, 20, [1, 0, 0]) + cylinder('q', [0, -10, 0], 3, 20, [0, 1, 0]) + boolean('UNION', null, ['p', 'q'])),
  // The crossed union (a certified mesh), then a slab cut from it: a mesh
  // operand goes to the hybrid directly.
  crossedCut: part(cylinder('p', [-10, 0, 0], 5, 20, [1, 0, 0]) + cylinder('q', [0, -10, 0], 3, 20, [0, 1, 0]) + boolean('UNION', null, ['p', 'q'])
    + box('s', [6, -10, -10], [20, 10, 10]) + `
    opBoolean(context, id + "cut", { "targets" : qCreatedBy(id + "p", EntityType.BODY), "tools" : qCreatedBy(id + "s", EntityType.BODY),
        "operationType" : BooleanOperationType.SUBTRACTION });`),
  // A cylinder beside a block: the pierce arm declines (the axis misses), and
  // the hybrid result keeps the block unchanged, so the subtraction is a no-op.
  miss: part(box('a', [0, 0, 0], [20, 20, 20]) + cylinder('t', [23, 23, -1], 4, 22) + boolean('SUBTRACTION', 'a', ['t'])),
  // A cylinder touching a block's side along a line: the hybrid refuses the
  // contact by name.
  tangent: part(box('a', [0, 0, 0], [10, 10, 10]) + cylinder('t', [15, 5, -2], 5, 14) + boolean('UNION', null, ['a', 't'])),
  // Two overlapping boxes: the planar arrangement admits this union.
  boxes: part(box('a', [0, 0, 0], [10, 10, 10]) + box('b', [5, 5, 5], [15, 15, 15]) + boolean('UNION', null, ['a', 'b'])),
};

const near = (actual, expected, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} is not within ${tolerance} of ${expected}`);
const run = (name, modelingPolicy) => build(cases[name], { feature: 'part', modelingPolicy });
const last = model => model.operationEvidence.findLast(e => e.operationId === 'model/op' || e.operationId.startsWith('model/op/'));

test('the Boolean policy defaults to hybrid-last without changing the normalized policy', () => {
  assert.deepEqual(normalizeModelingPolicy({}), { curvedContacts: 'strict' });
  assert.deepEqual(normalizeModelingPolicy({ boolean: 'hybrid-last' }), { curvedContacts: 'strict' });
  assert.deepEqual(normalizeModelingPolicy({ boolean: 'exact-only' }), { curvedContacts: 'strict', boolean: 'exact-only' });
  assert.deepEqual(normalizeModelingPolicy({ curvedContacts: 'tolerated-regularized', contactCapMm: 0.001, boolean: 'exact-only' }),
    { curvedContacts: 'tolerated-regularized', contactCapMm: 0.001, boolean: 'exact-only' });
  assert.equal(booleanPolicy(undefined), 'hybrid-last');
  assert.equal(booleanPolicy({ boolean: 'exact-only' }), 'exact-only');
  assert.throws(() => normalizeModelingPolicy({ boolean: 'hybrid' }), /Unknown Boolean policy 'hybrid'/);
});

test('a blind pocket goes to the hybrid: exact B-rep, closed-form volume, evidence, removed material', async () => {
  const model = await run('pocket');
  assert.equal(model.bodies.length, 1);
  const [body] = model.bodies;
  assert.equal(body.construction.method, HYBRID_METHOD);
  assert.equal(body.construction.operation, 'SUBTRACTION');
  near(body.validation.volumeMm3, 20 * 20 * 10 - Math.PI * 16 * 4);
  assert.equal(body.validation.integratedVolume.label, 'exact');
  assert.equal(body.approximation ?? null, null);
  const evidence = last(model);
  assert.equal(evidence.method, HYBRID_METHOD);
  assert.equal(evidence.status, 'exact');
  assert.equal(evidence.booleanPolicy, 'hybrid-last');
  assert.equal(evidence.deviationMm, 0.01);
  assert.match(evidence.declined.message, /blind pocket needs a floor/);
  assert.equal(evidence.declined.arm, 'native Bend through-hole pierce');
  assert.ok(Number.isFinite(evidence.certificate.maxBoundaryDeviationMm));
  // Every face names its operand faces; the pocket wall and floor come from the tool.
  const sources = body.provenance.faces.map(f => f.sources);
  assert.ok(sources.every(Array.isArray));
  assert.ok(sources.some(list => list.some(s => s.leaf === 1)));
  const wall = body.faces.findIndex(f => f.surface.type === 'cylinder');
  assert.deepEqual(body.identity.topology.faces[wall].sources.map(s => s.operand), [1]);
});

test('exact-only restores the exact arms\' refusals', async () => {
  const policy = { boolean: 'exact-only' };
  await assert.rejects(run('pocket', policy), error => error instanceof UnsupportedFeatureError
    && /blind pocket needs a floor this operation does not build$/.test(error.message));
  await assert.rejects(run('boss', policy), error => error instanceof UnsupportedFeatureError
    && /general trimmed-face booleans are not implemented$/.test(error.message));
  await assert.rejects(run('lens', policy), error => error instanceof UnsupportedFeatureError
    && /requires coaxial cylinders/.test(error.message) && !/hybrid/.test(error.message));
});

test('UNION of a block and a boss builds exactly', async () => {
  const boss = await run('boss');
  assert.equal(boss.bodies.length, 1);
  near(boss.bodies[0].validation.volumeMm3, 20 * 20 * 10 + Math.PI * 16 * 5);
  assert.match(last(boss).declined.message, /general trimmed-face booleans/);
});

test('UNION of two parallel cylinders off a common axis builds exactly: they meet in two generator lines', async () => {
  // Lens union (r 5 at x 0 and x 6, 10 and 12 high): the coaxial arm declines,
  // recover writes the two lines x 3, y +-4 from z 0 to 10 exactly.
  const model = await run('lens');
  assert.equal(model.bodies.length, 1);
  const [body] = model.bodies;
  assert.equal(last(model).status, 'exact');
  assert.equal(body.approximation ?? null, null);
  const cylinderUses = body.faces.filter(f => f.surface.type === 'cylinder').flatMap(f => f.loops.flat().map(u => u.edge));
  const shared = [...new Set(cylinderUses)].filter(e => cylinderUses.filter(x => x === e).length === 2);
  assert.equal(shared.length, 2);
  assert.equal(shared.filter(e => body.edges[e].curve.type === 'line').length, 2);
  for (const e of shared) for (const v of [body.edges[e].start, body.edges[e].end]) {
    const [x, y, z] = body.vertices[v];
    assert.ok(Math.abs(x - 3) < 1e-9 && Math.abs(Math.abs(y) - 4) < 1e-9 && (Math.abs(z) < 1e-9 || Math.abs(z - 10) < 1e-9), `vertex ${[x, y, z]}`);
  }
  const union = 2 * Math.PI * 25 - (50 * Math.acos(0.6) - 24);
  near(body.validation.volumeMm3, 10 * union + 2 * Math.PI * 25);
});

test('cylinders whose axes differ by a 1e-12 rad tilt are not parallel: a certified mesh naming the quartic, not exact lines', async () => {
  const model = await run('tilted');
  const [body] = model.bodies;
  assert.equal(last(model).status, 'mesh');
  assert.equal(last(model).exact, false);
  assert.match(body.approximation.reason, /cylinder\/cylinder intersection off a common axis is a space quartic/);
});

test('a certified-mesh answer is never exact: a mesh body labelled as an approximation, or a named refusal', async () => {
  // recover does not write cylinder/cylinder curves of skew axes (space
  // quartics), so the coaxial arm's refusal becomes a certified mesh
  // (src/hybrid-mesh.mjs) that names the quartic.
  let model;
  try { model = await run('crossed'); } catch (error) {
    assert.ok(error instanceof UnsupportedFeatureError);
    assert.match(error.message, /^opBoolean requires coaxial cylinders.*\[hybrid: the result is a certified mesh \(cylinder\/cylinder intersection off a common axis/);
    assert.equal(error.operationEvidence[0].status, 'Refused');
    assert.equal(error.operationEvidence[0].answer, 'mesh');
    assert.equal(error.operationEvidence[0].exact, false);
    return;
  }
  assert.equal(model.bodies.length, 1);
  const evidence = last(model);
  assert.equal(evidence.status, 'mesh');
  assert.equal(evidence.exact, false);
  assert.equal(evidence.declined.arm, 'coaxial radial/axial arrangement in Bend');
  assert.ok(model.bodies[0].approximation, 'a certified mesh body states its approximation');
  assert.match(model.bodies[0].approximation.reason, /cylinder\/cylinder intersection off a common axis is a space quartic/);
});

test('a certified-mesh operand goes to the hybrid directly, and exact-only refuses it by name', async () => {
  const model = await run('crossedCut');
  assert.equal(model.bodies.length, 1);
  const evidence = model.operationEvidence.findLast(e => e.operationId === 'model/cut');
  assert.equal(evidence.method, HYBRID_METHOD);
  assert.equal(evidence.declined.arm, 'none (certified-mesh operand)');
  assert.notEqual(evidence.status, 'exact');
  assert.ok(model.bodies[0].approximation);
  await assert.rejects(run('crossedCut', { boolean: 'exact-only' }), error => error instanceof UnsupportedFeatureError
    && /requires coaxial cylinders/.test(error.message));
});

test('an unresolved hybrid answer refuses by name after the exact arm\'s refusal', async () => {
  await assert.rejects(run('tangent'), error => error instanceof UnsupportedFeatureError
    && /^opBoolean supports coaxial cylinder primitives.*general trimmed-face booleans are not implemented \[hybrid: .*touching contact\)\]$/.test(error.message)
    && error.operationEvidence?.[0]?.method === HYBRID_METHOD && error.operationEvidence[0].status === 'Refused');
});

test('INTERSECTION through the hybrid: a cone cut by a slab is an exact frustum', async () => {
  const model = await run('frustum');
  assert.equal(model.bodies.length, 1);
  const [body] = model.bodies;
  assert.equal(body.construction.operation, 'INTERSECTION');
  assert.ok(body.faces.some(f => f.surface.type === 'cone'));
  near(body.validation.volumeMm3, Math.PI / 3 * (100 * 20 - 36 * 12));
});

test('a hybrid subtraction whose faces all come from the target removes nothing and is refused as a no-op', async () => {
  await assert.rejects(run('miss'), error => error instanceof UnsupportedFeatureError && /removes nothing/.test(error.message));
});

test('admitted arms are unchanged; WONKY_BOOLEAN_DIFF=1 compares them with the hybrid as evidence only', async t => {
  const previous = process.env.WONKY_BOOLEAN_DIFF;
  t.mock.method(process.stderr, 'write', () => true);
  try {
    delete process.env.WONKY_BOOLEAN_DIFF;
    const plain = await run('boxes');
    assert.equal(last(plain).method, 'native Bend planar arrangement union');
    assert.equal(last(plain).hybridDiff, undefined);
    process.env.WONKY_BOOLEAN_DIFF = '1';
    const diffed = await run('boxes');
    const evidence = last(diffed);
    assert.equal(evidence.method, 'native Bend planar arrangement union');
    assert.equal(diffed.bodies[0].construction.method, 'native Bend planar arrangement union');
    assert.equal(diffed.bodies[0].validation.volumeMm3, plain.bodies[0].validation.volumeMm3);
    assert.equal(evidence.hybridDiff.status, 'exact');
    assert.equal(evidence.hybridDiff.agree, true);
    assert.deepEqual(evidence.hybridDiff.differences, []);
    assert.ok(Math.abs(evidence.hybridDiff.volumesMm3.hybrid[0] - 1875) <= 1e-9 * 1875);
  } finally {
    if (previous === undefined) delete process.env.WONKY_BOOLEAN_DIFF; else process.env.WONKY_BOOLEAN_DIFF = previous;
  }
});

}
