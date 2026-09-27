import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend() || missing("fixtures/return-evaluators/models.mjs");
if (publicTreeSkip) {
  test("return-evaluators.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { build } = await import("../src/index.mjs");
const { ModelingContext, loadModelingServices } = await import("../src/library.mjs");
const { loadKernel } = await import("../src/kernel.mjs");
const { Interpreter } = await import("../src/interpreter.mjs");
const { parse } = await import("../src/parser.mjs");
const { Id, EnumValue, Vector, Quantity, map, tagged, matchesType, vectorNumbers } = await import("../src/values.mjs");
const { TopologyQuery, resolveTopology } = await import("../src/queries.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");
const { hubSource, armWindowSource, quarterSource, ellipseSource } = await import("../fixtures/return-evaluators/models.mjs");












const header = 'FeatureScript 3044; import(path : "onshape/std/geometry.fs", version : "3044.0");';
const feature = body => `${header} export function main(context is Context, id is Id, definition is map) { ${body} }`;
const box = 'fCuboid(context, id + "box", { "corner1" : vector(10, 2, 3) * millimeter, "corner2" : vector(12, 5, 7) * millimeter });';

// Owner boundary: unchanged FS evaluator calls, not private helpers. Existing
// query tests cover only world-space boxes and evLine's type, not these APIs.
// Closed-form coordinates catch ignored frames and incorrect units/directions.
test('evBox3d cSys computes translated and rotated local extrema', async () => {
  const model = await build(feature(`${box}
    const q = qCreatedBy(id + "box", EntityType.BODY);
    const translated = evBox3d(context, { "topology" : q, "cSys" : coordSystem(vector(10, 0, 0) * millimeter, vector(1, 0, 0), vector(0, 0, 1)) });
    if (norm(translated.minCorner / millimeter - vector(0, 2, 3)) > 1e-8 || norm(translated.maxCorner / millimeter - vector(2, 5, 7)) > 1e-8)
      throw regenError("translated local extrema");
    const rotated = evBox3d(context, { "topology" : q, "cSys" : coordSystem(vector(10, 0, 0) * millimeter, vector(0, 1, 0), vector(0, 0, 1)) });
    if (norm(rotated.minCorner / millimeter - vector(2, -2, 3)) > 1e-8 || norm(rotated.maxCorner / millimeter - vector(5, 0, 7)) > 1e-8)
      throw regenError("rotated local extrema");
    // A world AABB rotated back is too large. Bound the actual oblique solid.
    const tr = rotationAround(line(vector(0, 0, 0) * millimeter, vector(0, 0, 1)), 45 * degree);
    opPattern(context, id + "copy", { "entities" : q, "transforms" : [tr], "instanceNames" : ["one"] });
    const local = evBox3d(context, { "topology" : qCreatedBy(id + "copy", EntityType.BODY), "cSys" : coordSystem(tr * (vector(10, 0, 0) * millimeter), tr.linear * vector(1, 0, 0), vector(0, 0, 1)) });
    if (norm(local.minCorner / millimeter - vector(0, 2, 3)) > 1e-8 || norm(local.maxCorner / millimeter - vector(2, 5, 7)) > 1e-8)
      throw regenError("actual local extrema, not transformed world AABB");
  `));
  assert.equal(model.bodies.length, 2);
});

test('line definitions and arc-length tangents return std Line values', async () => {
  const model = await build(feature(`${box}
    for (var edge in evaluateQuery(context, qOwnedByBody(qCreatedBy(id + "box", EntityType.BODY), EntityType.EDGE))) {
      const curve = evCurveDefinition(context, { "edge" : edge });
      if (!(curve is Line)) throw regenError("Line tag");
      const a = evEdgeTangentLine(context, { "edge" : edge, "parameter" : 0 });
      const m = evEdgeTangentLine(context, { "edge" : edge, "parameter" : 0.5 });
      const b = evEdgeTangentLine(context, { "edge" : edge, "parameter" : 1 });
      if (!(m is Line) || norm((m.origin - (a.origin + b.origin) / 2) / millimeter) > 1e-8 || dot(normalize(b.origin - a.origin), m.direction) < 0.999999999)
        throw regenError("oriented line midpoint");
    }
  `));
  assert.equal(model.bodies[0].edges.length, 12);
});

async function evaluate(source) {
  const engine = new ModelingContext(await loadKernel(), { services: await loadModelingServices() });
  const interpreter = new Interpreter(engine.builtins());
  interpreter.run(parse(source), 'main', engine.context, new Id(['model']), map({}));
  const call = (name, definition) => engine.builtins()[name].call([engine.context, map(definition)]);
  return { engine, interpreter, call };
}
const all = new TopologyQuery('allSolid');
const owned = type => new TopologyQuery('owned', { query: all, entityType: new EnumValue('EntityType', type) });
const ref = (engine, row) => new TopologyQuery('reference', { owner: engine, rows: [row] });
const mm = xyz => new Vector(xyz.map(v => new Quantity(v / 1000)));
const xyz = v => vectorNumbers(v, 1, 3);
const frame = (origin, x, z = [0, 0, 1]) => tagged(map({ origin: mm(origin), xAxis: new Vector(x), zAxis: new Vector(z) }), 'CoordSystem');
// 1e-8 mm: above F32x2 accumulation (~1e-10 at 275 mm) and far below
// the frozen selector's 1e-5 mm. No widening of a source tolerance.
const near = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b} (bound ${tolerance})`);
const nearPoint = (a, b) => a.forEach((value, i) => near(value, b[i]));
const refusal = name => error => error instanceof UnsupportedFeatureError && error.message.includes(name);

test('evCurveDefinition refuses a collapsed polyhedral line instead of returning a NaN direction', async () => {
  const { engine, call } = await evaluate(feature(box));
  const row = resolveTopology(engine, owned('EDGE'))[0];
  const body = row.record.body, edge = body.edges[row.index], query = ref(engine, row);
  const start = body.vertices[edge.start], end = body.vertices[edge.end];
  const delta = end.map((v, i) => v - start[i]), length = Math.hypot(...delta);
  assert.ok(length > 0);

  // Corrupt only the represented segment, not the evaluator or its services.
  body.vertices[edge.end] = [...start];
  assert.throws(() => call('evCurveDefinition', { edge: query }), refusal('evCurveDefinition: InvalidGeometry'));

  body.vertices[edge.end] = end;
  const curve = call('evCurveDefinition', { edge: query });
  assert.equal(matchesType(curve, 'Line'), true);
  nearPoint(xyz(curve.origin), start);
  nearPoint(curve.direction.items, delta.map(v => v / length));
});

test('frozen Return selectors find ARM window boundaries and RET_HUB rim/root rings', async () => {
  const arm = await evaluate(armWindowSource);
  const g = arm.interpreter.global;
  const selected = arm.interpreter.call(g.get('r20RetEdgesOnRect'), [arm.engine.context, all,
    new Quantity(0.1338), g.get('R20_RET_WINDOW_Y'), g.get('R20_RET_WINDOW_Z'), new Quantity(0)], null);
  const rows = resolveTopology(arm.engine, selected);
  const body = arm.engine.bodies[0];
  const expected = body.edges.flatMap((e, i) => [e.start, e.end].every(v => Math.abs(body.vertices[v][0] - 133.8) < 1e-8) ? [i] : []);
  assert.equal(expected.length, 4);
  assert.deepEqual(rows.map(row => row.index).sort((a, b) => a - b), expected);
  for (const row of rows) {
    const edge = ref(arm.engine, row), e = body.edges[row.index];
    const samples = arm.interpreter.call(g.get('r20RetEdgePoints'), [arm.engine.context, edge], null).map(xyz);
    nearPoint(samples[0], body.vertices[e.start]);
    nearPoint(samples[2], body.vertices[e.end]);
    nearPoint(samples[1], body.vertices[e.start].map((v, i) => (v + body.vertices[e.end][i]) / 2));
  }
  const hub = await evaluate(hubSource);
  const choices = hub.interpreter.call(hub.interpreter.global.get('selectHub'), [hub.engine.context, all], null);
  for (const [i, [x, r]] of [[133.8, 25], [152.3, 11]].entries()) {
    const selectedRows = resolveTopology(hub.engine, choices[i]);
    assert.equal(selectedRows.length, 1, `ring x=${x}, r=${r}`);
    const edge = choices[i];
    const curve = hub.call('evCurveDefinition', { edge });
    assert.equal(matchesType(curve, 'Circle'), true);
    assert.equal(matchesType(curve.coordSystem, 'CoordSystem'), true);
    nearPoint(xyz(curve.coordSystem.origin), [x, 17.453, 274.69]);
    near(curve.radius.value * 1000, r);
    nearPoint(curve.coordSystem.zAxis.items, [1, 0, 0]);
    // Both end points coincide, half a turn is diametrically opposite.
    const a = xyz(hub.call('evEdgeTangentLine', { edge, parameter: 0 }).origin);
    const m = xyz(hub.call('evEdgeTangentLine', { edge, parameter: 0.5 }).origin);
    const b = xyz(hub.call('evEdgeTangentLine', { edge, parameter: 1 }).origin);
    nearPoint(a, b);
    nearPoint(a.map((v, j) => (v + m[j]) / 2), [x, 17.453, 274.69]);
    near(Math.hypot(a[1] - 17.453, a[2] - 274.69), r);
  }
});

test('circular arc tangents respect radians, the finite trim and both edge senses', async () => {
  const { engine, call } = await evaluate(quarterSource);
  const body = engine.bodies[0];
  const rows = resolveTopology(engine, owned('EDGE')).filter(row => body.edges[row.index].curve.type === 'circle');
  assert.equal(rows.length, 4);
  for (const row of rows) {
    const edge = ref(engine, row), e = body.edges[row.index], r = e.curve.radius, x = e.curve.origin[0];
    for (const reversed of [false, true]) {
      if (reversed) { [e.start, e.end] = [e.end, e.start]; e.sameSense = !e.sameSense; }
      // The profile sweeps y+ toward z+. The starting vertex determines
      // which of the two legitimate orientations the topology requests.
      const forward = Math.abs(body.vertices[e.start][1] - r) < 1e-8;
      for (const parameter of [0, 0.25, 0.5, 1]) {
        const u = forward ? parameter : 1 - parameter, angle = u * Math.PI / 2;
        const tangent = call('evEdgeTangentLine', { edge, parameter });
        nearPoint(xyz(tangent.origin), [x, r * Math.cos(angle), r * Math.sin(angle)]);
        nearPoint(tangent.direction.items, [0, -Math.sin(angle) * (forward ? 1 : -1), Math.cos(angle) * (forward ? 1 : -1)]);
        nearPoint(xyz(call('evEdgeTangentLine', { edge, parameter, arcLengthParameterization: false }).origin), xyz(tangent.origin));
      }
      if (reversed) { [e.start, e.end] = [e.end, e.start]; e.sameSense = !e.sameSense; }
    }
  }
  const edge = ref(engine, rows[0]);
  for (const parameter of [-0.01, 1.01, NaN, new Quantity(0.5)])
    assert.throws(() => call('evEdgeTangentLine', { edge, parameter }), /parameter must be in 0\.\.1/);
  assert.throws(() => call('evEdgeTangentLine', { edge, parameter: 0.5, face: owned('FACE') }), refusal('FaceOrientationUnsupported'));
  const e = body.edges[rows[0].index], saved = e.curveRange;
  delete e.curveRange;
  assert.throws(() => call('evEdgeTangentLine', { edge, parameter: 0.5 }), refusal('MissingTrim'));
  e.curveRange = saved;
  e.sameSense = !e.sameSense;
  assert.throws(() => call('evEdgeTangentLine', { edge, parameter: 0.5 }), refusal('InputGap'));
});

test('ellipse definition preserves its std frame/radii; no uniform parameter masquerades as arc length', async () => {
  const { engine, call } = await evaluate(ellipseSource);
  const rows = resolveTopology(engine, owned('EDGE')).filter(row => engine.bodies[0].edges[row.index].curve.type === 'ellipse');
  assert.equal(rows.length, 1);
  const edge = ref(engine, rows[0]);
  const curve = call('evCurveDefinition', { edge });
  assert.equal(matchesType(curve, 'Ellipse'), true);
  assert.equal(matchesType(curve.coordSystem, 'CoordSystem'), true);
  nearPoint(xyz(curve.coordSystem.origin), [0, 0, 10]);
  near(curve.majorRadius.value * 1000, 5 * Math.sqrt(1.25));
  near(curve.minorRadius.value * 1000, 5);
  for (const parameter of [0.25, 0.5]) for (const arcLengthParameterization of [true, false])
    assert.throws(() => call('evEdgeTangentLine', { edge, parameter, arcLengthParameterization }), refusal('EllipseArcLengthUnsupported'));
});

test('local boxes include analytic vertices but explicitly refuse analytic carriers and invalid options', async () => {
  const { engine, call } = await evaluate(hubSource);
  const cSys = frame([133.8, 17.453, 274.69], [0, 1, 0], [1, 0, 0]);
  const row = { record: resolveTopology(engine, all)[0].record, kind: 'vertex', index: 0 };
  const b = call('evBox3d', { topology: ref(engine, row), cSys });
  const v = engine.bodies[0].vertices[0];
  nearPoint(xyz(b.minCorner), [v[1] - 17.453, v[2] - 274.69, v[0] - 133.8]);
  nearPoint(xyz(b.maxCorner), xyz(b.minCorner));
  for (const topology of [all, owned('EDGE'), owned('FACE')])
    assert.throws(() => call('evBox3d', { topology, cSys }), refusal('AnalyticLocalBoundsUnsupported'));
  for (const options of [{ cSys: map({}) }, { tight: 1 }])
    assert.throws(() => call('evBox3d', { topology: all, ...options }), /must be/);
});

}
