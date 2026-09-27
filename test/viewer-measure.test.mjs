import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("viewer-measure.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { mkdtemp, readFile, rm, writeFile } = await import("node:fs/promises");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { build } = await import("../src/index.mjs");
const { loadKernel } = await import("../src/kernel.mjs");
const { createReviewServer } = await import("../src/review-server.mjs");
const { ANGULAR_TOLERANCE_RAD, PAIR_ANGULAR_RULE, aliasOf, angularTolerance, geometryEntities, pairAngularTolerance, parseAlias } = await import("../src/viewer/geometry.mjs");
const { EXTREMA_REASON, REVISIONS_REASON, measureEntities } = await import("../src/viewer/measure.mjs");
// exact-measure, server side: GET /api/models/:id/geometry and
// POST /api/models/:id/measure (src/viewer/geometry.mjs, measure.mjs and
// their routes). Models are built from the example sources and the
// pin-in-bore QA fixture, so every value is a closed form over real stored
// analytic parameters.











const source = path => readFile(new URL(path, import.meta.url), 'utf8');
const kernel = await loadKernel();
const fixture = name => source(`../scripts/viewer/qa/fixtures/${name}.fs`)
  .then(text => build(text));
const [spacer, bracket, pinInBore, holeBoss, stackWasher, arcSlot, offsetWasher, crossingStack,
  offsetHalfBoss, tiltPad, axisFar, coaxFar, coaxialArcs, notchBase] = await Promise.all([
  source('../examples/bored-spacer.fs').then(text => build(text)),
  source('../examples/bracket.fs').then(text => build(text)),
  fixture('pin-in-bore'),
  fixture('hole-boss'),
  fixture('stack-washer'),
  source('../scripts/viewer/audit-data/arc-slot.fs').then(text => build(text)),
  fixture('offset-washer'),
  fixture('crossing-stack'),
  fixture('offset-half-boss'),
  fixture('tilt-pad'),
  fixture('axis-far'),
  fixture('coax-far'),
  fixture('coaxial-arcs'),
  fixture('notch-base'),
]);
const near = (actual, expected, tolerance = 1e-9, message) => assert.ok(
  Math.abs(actual - expected) <= tolerance,
  message ?? `${actual} is not ${expected} ±${tolerance}`);
const nearVector = (actual, expected, tolerance = 1e-9) => actual
  .forEach((value, axis) => near(value, expected[axis], tolerance, `${actual} vs ${expected}`));
const geometry = (model, aliases, options = {}) => geometryEntities(model,
  { kernel, aliases, modelId: 'm', ...options });
const measure = (model, entities, options = {}) => measureEntities(model, entities,
  { kernel, modelId: 'm', ...options });
const row = (result, quantity) => result.measurements.find(item => item.quantity === quantity);
// A consistent rigid move of one body (vertices, surfaces and curves), so the
// trims and the supports stay the same shape.
function translateBody(model, bodyIndex, delta) {
  const moved = structuredClone(model);
  const body = moved.bodies[bodyIndex];
  const shift = point => point.map((value, axis) => value + delta[axis]);
  body.vertices = body.vertices.map(shift);
  for (const face of body.faces) face.surface.origin = shift(face.surface.origin);
  for (const edge of body.edges) {
    if (edge.curve && typeof edge.curve === 'object' && edge.curve.origin) {
      edge.curve.origin = shift(edge.curve.origin);
    }
  }
  delete body.validation?.boundsMm;
  return moved;
}
// Replaces the boundary of a cylinder face along +Z (surface axis [0, 0, 1])
// with rims and axial lines, for trims the kernel cannot build yet (an end
// notch, a window). Each loop is a list of segments: ['arc', z, from, to]
// (degrees, counterclockwise from → to, 360 apart for a full rim) or
// ['line', angle, z0, z1]. The old edges stay unused in the body.
function trimCylinderFace(model, alias, loops) {
  const { bodyIndex, index } = parseAlias(alias);
  const trimmed = structuredClone(model);
  const body = trimmed.bodies[bodyIndex];
  const { origin, radius } = body.faces[index].surface;
  const vertexAt = (degrees, z) => {
    const angle = degrees * Math.PI / 180;
    const point = [origin[0] + radius * Math.cos(angle), origin[1] + radius * Math.sin(angle), z];
    const found = body.vertices.findIndex(vertex => vertex
      .every((value, axis) => Math.abs(value - point[axis]) <= 1e-12));
    return found >= 0 ? found : body.vertices.push(point) - 1;
  };
  const edgeOf = ([kind, level, from, to]) => {
    const curve = kind === 'arc'
      ? { type: 'circle', origin: [origin[0], origin[1], level], normal: [0, 0, 1], x: [1, 0, 0],
        radius }
      : { type: 'line', origin: [origin[0] + radius * Math.cos(level * Math.PI / 180),
        origin[1] + radius * Math.sin(level * Math.PI / 180), from], direction: [0, 0, 1] };
    const [start, end] = kind === 'arc'
      ? [vertexAt(from, level), vertexAt(to, level)] : [vertexAt(level, from), vertexAt(level, to)];
    return { edge: body.edges.push({ start, end, curve, sameSense: true }) - 1, forward: true };
  };
  body.faces[index].loops = loops.map(loop => loop.map(edgeOf));
  body.faces[index].outer = loops.map((loop, at) => at === 0);
  delete body.validation?.boundsMm;
  return trimmed;
}
// notch-base with an end notch in B1.F3: missing for |angle| < 30° above z 6.
const notchedBoss = trimCylinderFace(notchBase, 'B1.F3', [
  [['arc', 0, 0, 360]],
  [['arc', 10, 30, 330], ['line', 330, 10, 6], ['arc', 6, 330, 390], ['line', 30, 6, 10]],
]);
// The rows of a pair without the fields that name the selection order.
const orderFree = result => result.measurements.map(item => ({
  quantity: /^radius[AB]$/.test(item.quantity) ? 'radius' : item.quantity, value: item.value,
  toleranceMm: item.toleranceMm, angularToleranceRad: item.angularToleranceRad, note: item.note,
})).sort((x, y) => `${x.quantity}${x.value}`.localeCompare(`${y.quantity}${y.value}`));

test('aliases parse and print like wonky-inspect, plus logical faces', () => {
  assert.deepEqual(parseAlias('B2.F13'), { bodyIndex: 1, kind: 'face', index: 12 });
  assert.deepEqual(parseAlias('B1.L3'), { bodyIndex: 0, kind: 'logical', index: 2 });
  assert.deepEqual(parseAlias('B1'), { bodyIndex: 0, kind: 'body', index: 0 });
  for (const bad of ['B0.F1', 'B1.F0', 'F1', 'B1.X1', 'B1.F1.E2', '']) {
    assert.equal(parseAlias(bad), null, bad);
  }
  assert.equal(aliasOf(0, 'vertex', 4), 'B1.V5');
});

test('a cylinder hole reports Ø, axis direction and the axis point nearest the origin', () => {
  const result = geometry(spacer, ['B1.F3', 'B1.F4']);
  const [bore, outside] = result.faces;
  assert.equal(result.schema, 'wonky.viewer-geometry/1');
  assert.equal(bore.alias, 'B1.F3');
  assert.equal(bore.exactness, 'exact-parameters');
  assert.equal(bore.hole, true);
  assert.equal(bore.surface.type, 'cylinder');
  assert.equal(bore.surface.sense, 'hole');
  near(bore.surface.diameterMm, 4);
  nearVector(bore.surface.axis.direction, [0, 0, 1]);
  nearVector(bore.axisPointNearestOrigin, [0, 0, 0]);
  near(bore.toleranceMm, 0.0003, 1e-12);
  assert.equal(bore.outwardNormal, null, 'a cylinder has no single normal');
  assert.equal(outside.hole, false);
  assert.equal(outside.surface.sense, 'boss');
  assert.equal(result.angularToleranceRad, ANGULAR_TOLERANCE_RAD);
});

test('the axis point nearest the origin is the foot of the origin on the axis', () => {
  const moved = structuredClone(spacer);
  const bore = moved.bodies[0].faces[2].surface;
  bore.origin = [3, 4, 7];
  bore.axis = [0, 0, 2];
  const [face] = geometry(moved, ['B1.F3']).faces;
  nearVector(face.axisPointNearestOrigin, [3, 4, 0]);
  nearVector(face.surface.axis.direction, [0, 0, 1], 1e-12);
});

test('planar faces carry the outward normal (sameSense applied) and the offset', () => {
  const [bottom, top] = geometry(spacer, ['B1.F1', 'B1.F2']).faces;
  nearVector(bottom.outwardNormal, [0, 0, -1]);
  near(bottom.surface.offsetMm, 0);
  nearVector(top.outwardNormal, [0, 0, 1]);
  near(top.surface.offsetMm, 10);
  const frame = top.surface.frame;
  near(Math.hypot(...frame.x), 1);
  near(frame.x[0] * frame.y[0] + frame.x[1] * frame.y[1] + frame.x[2] * frame.y[2], 0);
});

test('edges and vertices: lines, full circles, lengths, sweeps and points', () => {
  const result = geometry(spacer, ['B1.E1', 'B1.E5', 'B1.V2']);
  const [circle, line] = result.edges;
  assert.equal(circle.curve.type, 'circle');
  assert.equal(circle.curve.full, true);
  near(circle.curve.sweepDeg, 360);
  near(circle.lengthMm, 4 * Math.PI, 1e-9);
  near(circle.curve.diameterMm, 4);
  assert.equal(line.curve.type, 'line');
  near(line.lengthMm, 10);
  nearVector(line.curve.direction, [0, 0, 1]);
  nearVector(result.vertices[0].point, [2, 0, 10]);
  assert.equal(result.vertices[0].exactness, 'exact-parameters');
});

test('logical face aliases resolve to their fragments and support', () => {
  const result = geometry(spacer, ['B1.L3']);
  assert.equal(result.logicalFaces.length, 1);
  assert.deepEqual(result.logicalFaces[0].fragments, ['B1.F3']);
  assert.equal(result.logicalFaces[0].hole, true);
  const [face] = geometry(spacer, ['B1.F3']).faces;
  assert.equal(face.logical, 'B1.L3');
  assert.deepEqual(face.fragments, ['B1.F3']);
});

test('paging covers every entity once; bad pages and aliases are explicit errors', () => {
  const first = geometryEntities(spacer, { kernel, page: 0, pageSize: 5 });
  const counts = spacer.bodies[0];
  const total = counts.faces.length + counts.edges.length + counts.vertices.length;
  assert.equal(first.pages, Math.ceil(total / 5));
  const seen = [];
  for (let page = 0; page < first.pages; page++) {
    const result = geometryEntities(spacer, { kernel, page, pageSize: 5 });
    seen.push(...result.faces, ...result.edges, ...result.vertices);
  }
  assert.equal(new Set(seen.map(entry => entry.alias)).size, total);
  assert.throws(() => geometryEntities(spacer, { kernel, page: first.pages, pageSize: 5 }),
    error => error.status === 400);
  assert.throws(() => geometry(spacer, ['B1.F99']), error => error.status === 404);
  assert.throws(() => geometry(spacer, ['B9.F1']), error => error.status === 404);
  assert.throws(() => geometry(spacer, ['nonsense']), error => error.status === 400);
  assert.throws(() => geometry(spacer, ['B1']), error => error.status === 400);
  assert.throws(() => geometryEntities(spacer, {}), /needs the loaded Bend kernel/);
});

test('recorded bounds are the union of body bounds, or not evaluated with the reason', () => {
  const bounds = geometryEntities(bracket, { kernel }).bounds;
  assert.deepEqual([bounds.minMm, bounds.maxMm], [[0, 0, 0], [50, 40, 8]]);
  assert.equal(bounds.exactness, 'recorded');
  const missing = geometryEntities(pinInBore, { kernel }).bounds;
  assert.equal(missing.minMm, null);
  assert.match(missing.note, /^not evaluated: B1 has no recorded bounds/);
});

test('bracket walls: parallel offset 8 mm, exact, primary, supporting planes', () => {
  const result = measure(bracket, ['B1.F1', 'B1.F2']);
  const offset = row(result, 'parallelOffset');
  near(offset.value, 8);
  assert.equal(offset.unit, 'mm');
  assert.equal(offset.exactness, 'exact-parameters');
  assert.equal(offset.toleranceMm, bracket.bodies[0].validation.toleranceMm);
  // Decided over the smaller face (pairAngularTolerance): never stricter than
  // the old whole-body rule, and the response names the rule it used.
  const t = bracket.bodies[0].validation.toleranceMm;
  assert.ok(offset.angularToleranceRad >= angularTolerance(bracket.bodies[0], t));
  assert.ok(offset.angularToleranceRad >= ANGULAR_TOLERANCE_RAD);
  assert.equal(result.angularToleranceRad, offset.angularToleranceRad,
    'the top-level tolerance is the one the decisions used');
  assert.equal(result.angularToleranceFloorRad, ANGULAR_TOLERANCE_RAD);
  assert.equal(result.angularToleranceRule, PAIR_ANGULAR_RULE);
  assert.match(offset.note, /supporting planes/);
  assert.deepEqual(offset.inputs, ['B1.F1@m', 'B1.F2@m']);
  assert.equal(result.measurements[result.primary], offset);
  near(row(result, 'angle').value, 180);
  assert.equal(row(result, 'parallel').value, true);
  assert.equal(row(result, 'coplanar').value, false);
  assert.equal(row(result, 'normals').value, 'opposed');
  assert.deepEqual(result.unsupported, []);
  assert.equal(offset.witness.kind, 'offset');
  near(offset.witness.lengthMm, 8);
});

test('a face pair without a closed-form distance gets the unsupported row', () => {
  const result = measure(bracket, ['B1.F2', 'B1.F3']);
  near(row(result, 'angle').value, 90);
  assert.equal(row(result, 'parallel').value, false);
  assert.equal(row(result, 'parallelOffset'), undefined);
  assert.deepEqual(result.unsupported.map(item => item.reason), [EXTREMA_REASON]);
  assert.equal(result.primary, null, 'angles are never drawn as a dimension line');
});

test('pin-in-bore: radial gap 0.2 mm and diametral clearance 0.4 mm on supporting cylinders',
  () => {
    const result = measure(pinInBore, ['B1.F7', 'B2.F3']);
    const gap = row(result, 'radialGap');
    const clearance = row(result, 'diametralClearance');
    near(gap.value, 0.2, 1e-9);
    near(clearance.value, 0.4, 1e-9);
    for (const item of [gap, clearance]) {
      assert.equal(item.exactness, 'exact-parameters');
      assert.match(item.note, /^supporting cylinders/);
    }
    assert.equal(row(result, 'coaxial').value, true);
    assert.equal(result.measurements[result.primary], gap);
    assert.deepEqual(result.entities.map(entity => entity.hole), [true, false]);
    // Order does not matter: hole and boss are told apart by sameSense.
    near(row(measure(pinInBore, ['B2.F3', 'B1.F7']), 'radialGap').value, 0.2, 1e-9);
  });

test('parallel non-coaxial hole and boss: minimum radial clearance', () => {
  const shifted = structuredClone(pinInBore);
  shifted.bodies[1].faces[2].surface.origin = [0.05, 0, -4];
  const result = measure(shifted, ['B1.F7', 'B2.F3']);
  assert.equal(row(result, 'coaxial').value, false);
  assert.equal(row(result, 'radialGap'), undefined);
  const clearance = row(result, 'minimumRadialClearance');
  near(clearance.value, 0.15, 1e-7);
  assert.match(clearance.note, /^supporting cylinders.*; parallel axes$/);
  assert.equal(clearance.witness.from.index, 0, 'the hole is the witness start');
});

// Regression (fix round): r_hole − r_boss was applied to every hole/boss
// pair, so a tube wall read as a −3 mm "interference" and a separate boss as a
// −16 mm clearance. The relation now follows the cross-section containment.
test('coaxial hole and boss of one body: the tube wall, never an interference', () => {
  const result = measure(spacer, ['B1.F3', 'B1.F4']);
  const wall = row(result, 'wallThickness');
  near(wall.value, 3, 1e-9);
  assert.equal(wall.label, 'Wall thickness');
  assert.equal(result.measurements[result.primary], wall);
  assert.equal(row(result, 'radialGap'), undefined);
  assert.equal(row(result, 'diametralClearance'), undefined);
  assert.ok(result.measurements.every(item => !/interference/.test(item.note ?? '')));
  assert.deepEqual(wall.witness.radii, [2, 5]);
  assert.deepEqual(result.unsupported, []);
});

test('hole and a separate parallel boss: the gap between the surfaces', () => {
  const result = measure(holeBoss, ['B1.F7', 'B2.F3']);
  assert.equal(row(result, 'minimumRadialClearance'), undefined);
  const gap = row(result, 'cylinderGap');
  near(gap.value, 10, 1e-9, 'd − r_hole − r_boss = 15 − 2 − 3 (OCCT: 10.000)');
  assert.equal(gap.witness.mode, 'gap');
  // The boss stands on the plate (z 6..11), the hole ends there: the faces
  // meet at one height, so their exact distance is the same 10 mm, at the
  // facing rims, and it is the drawn dimension.
  const faces = row(result, 'faceDistance');
  near(faces.value, 10, 1e-9);
  assert.equal(result.measurements[result.primary], faces);
  faces.witness.points.forEach((point, index) => nearVector(point, [[2, 0, 6], [12, 0, 6]][index]));
});

test('eccentric pin inside a hole: minimum radial clearance r_h − r_b − d', () => {
  const result = measure(holeBoss, ['B3.F3', 'B1.F7']);
  near(row(result, 'minimumRadialClearance').value, 0.2, 1e-9);
  assert.equal(result.measurements[result.primary].quantity, 'minimumRadialClearance');
});

test('a boss of another body larger than the hole is an interference; of one body a wall',
  () => {
    const oversized = structuredClone(pinInBore);
    oversized.bodies[1].faces[2].surface.radius = 4.5;
    const result = measure(oversized, ['B1.F7', 'B2.F3']);
    near(row(result, 'radialGap').value, -0.3, 1e-9);
    assert.match(row(result, 'radialGap').note,
      /^supporting cylinders; negative: interference of two bodies over 12\.0000 mm/);
    const eccentric = structuredClone(spacer);
    eccentric.bodies[0].faces[2].surface.origin = [0.5, 0, 0];
    const wall = row(measure(eccentric, ['B1.F3', 'B1.F4']), 'wallThickness');
    assert.equal(wall.label, 'Minimum wall thickness');
    near(wall.value, 2.5, 1e-9, 'r_boss − r_hole − d = 5 − 2 − 0.5');
    assert.equal(wall.witness.from.radius, 5, 'the wall is drawn from the boss surface');
  });

test('crossing supporting cylinders have no closed-form clearance', () => {
  // Boss moved to x = 3 and 3 mm down: its circle crosses the hole circle and
  // the faces overlap axially over z 3..6.
  const crossing = translateBody(holeBoss, 1, [-12, 0, -3]);
  const result = measure(crossing, ['B1.F7', 'B2.F3']);
  for (const quantity of ['radialGap', 'minimumRadialClearance', 'wallThickness', 'cylinderGap']) {
    assert.equal(row(result, quantity), undefined, quantity);
  }
  assert.deepEqual(result.unsupported.map(item => item.reason), [EXTREMA_REASON]);
});

test('entities from another revision are never measured against this one', () => {
  const result = measure(pinInBore, [{ alias: 'B1.F7', modelId: 'm' },
    { alias: 'B2.F3', modelId: 'other' }]);
  assert.deepEqual(result.measurements, []);
  assert.deepEqual(result.unsupported.map(item => item.reason), [REVISIONS_REASON]);
  assert.equal(REVISIONS_REASON, 'entities from different revisions');
});

test('vertices, edges and circles: distances, deltas, concentric circles', () => {
  const points = measure(spacer, ['B1.V1', 'B1.V4']);
  near(row(points, 'distance').value, Math.hypot(3, 10));
  near(row(points, 'deltaX').value, 3);
  near(row(points, 'deltaZ').value, 10);
  const toPlane = measure(spacer, ['B1.V2', 'B1.F1']);
  near(row(toPlane, 'signedDistance').value, -10, 1e-9);
  const circles = measure(spacer, ['B1.E1', 'B1.E3']);
  assert.equal(row(circles, 'concentric').value, true);
  near(row(circles, 'radiusDifference').value, 3);
  const lines = measure(bracket, ['B1.E1', 'B1.E2']);
  assert.ok(row(lines, 'lineDistance'));
  assert.ok(row(lines, 'endpointGap'));
  const body = measure(spacer, ['B1', 'B1.F1']);
  assert.match(body.unsupported[0].reason, /a body has no single closed-form geometry/);
});

test('selection references and fragment aliases measure their logical face', () => {
  const reference = index => ({
    modelId: 'm', bodyId: bracket.bodies[0].id, entityType: 'face', entityIndex: index,
  });
  near(row(measure(bracket, [reference(0), reference(1)]), 'parallelOffset').value, 8);
  // A logical face made of two fragments (frozen logicalFaces shape).
  const faces = bracket.bodies[0].faces.length;
  const logicalOf = Int32Array.from({ length: faces },
    (_face, index) => (index < 2 ? 0 : index - 1));
  const groups = [{ alias: 'B1.L1', fragments: [0, 1], support: null },
    ...Array.from({ length: faces - 2 }, (_group, index) => ({
      alias: `B1.L${index + 2}`, fragments: [index + 2], support: null,
    }))];
  const logical = { bodies: [{ logicalOf, groups }] };
  const merged = measure(bracket, ['B1.F2', 'B1.F4'], { logical });
  assert.equal(merged.entities[0].alias, 'B1.L1', 'a fragment measures as its logical face');
  assert.deepEqual(merged.entities[0].fragments, ['B1.F1', 'B1.F2']);
  assert.equal(merged.entities[0].face, 'B1.F2');
  const fragment = measure(bracket, ['B1.F2', 'B1.F4'], { logical, resolveLogical: false });
  assert.equal(fragment.entities[0].alias, 'B1.F2');
  assert.equal(measure(bracket, ['B1.L1', 'B1.F4'], { logical }).entities[0].alias, 'B1.L1');
});

test('measure needs two entities and rejects malformed input', () => {
  assert.throws(() => measure(bracket, ['B1.F1']), error => error.status === 400);
  assert.throws(() => measure(bracket, [42, 'B1.F1']), error => error.status === 400);
  assert.throws(() => measure(bracket, ['B1.F1', 'B1.F99']), error => error.status === 404);
});

test('HTTP: geometry and measure routes, errors and the Host/Origin checks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wonky-measure-'));
  const path = join(directory, 'pin-in-bore.brep.json');
  await writeFile(path, JSON.stringify(pinInBore));
  const server = await createReviewServer({
    modelPaths: [path], reviewDirectory: join(directory, 'reviews'), port: 0, log: () => {},
  });
  try {
    const base = server.origin;
    const [{ id }] = (await (await fetch(`${base}/api/workspace`)).json()).models;
    const geometryResponse = await fetch(`${base}/api/models/${id}/geometry?aliases=B1.F7,B2.F3`);
    assert.equal(geometryResponse.status, 200);
    const data = await geometryResponse.json();
    assert.equal(data.modelId, id);
    assert.deepEqual(data.faces.map(face => [face.alias, face.hole]), [['B1.F7', true],
      ['B2.F3', false]]);
    const full = await (await fetch(`${base}/api/models/${id}/geometry`)).json();
    assert.equal(full.pages, 1);
    assert.equal(full.faces.length, 10);
    assert.ok(full.edges.every(edge => typeof edge.class === 'string'));
    // Classes come from classifyEdges(model) (topology-classes), not the stub.
    assert.deepEqual(full.edges.filter(edge => edge.alias.startsWith('B2.'))
      .map(edge => edge.class), ['sharp', 'sharp', 'seam']);
    assert.equal((await fetch(`${base}/api/models/${id}/geometry?page=x`)).status, 400);
    assert.equal((await fetch(`${base}/api/models/${id}/geometry?aliases=B1.F99`)).status, 404);
    assert.equal((await fetch(`${base}/api/models/${'0'.repeat(64)}/geometry`)).status, 404);
    const post = (body, headers = {}) => fetch(`${base}/api/models/${id}/measure`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    const measured = await (await post({ entities: ['B1.F7', 'B2.F3'] })).json();
    near(measured.measurements.find(item => item.quantity === 'radialGap').value, 0.2, 1e-9);
    assert.equal(measured.modelId, id);
    const foreign = await (await post({ entities: [{ modelId: id, alias: 'B1.F7' },
      { modelId: 'f'.repeat(64), alias: 'B1.F1' }] })).json();
    assert.equal(foreign.unsupported[0].reason, REVISIONS_REASON);
    assert.equal((await post({ entities: ['B1.F7'] })).status, 400);
    assert.equal((await fetch(`${base}/api/models/${id}/measure`, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}',
    })).status, 415);
    assert.equal((await post({ entities: ['B1.F7', 'B2.F3'] },
      { Origin: 'https://elsewhere.invalid' })).status, 403);
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

// Regressions (fix round 2, verifier exactness lens).
test('coaxial hole and washer that only touch: no interference, exact face distance', () => {
  // B1 plate z 0..6 with a Ø4 hole; B2 washer z 6..8, outer Ø12. OCCT: common
  // volume 0, distance between the trimmed faces 4.0000 mm.
  const result = measure(stackWasher, ['B1.F7', 'B2.F4'], { resolveLogical: false });
  assert.equal(row(result, 'coaxial').value, true);
  for (const quantity of ['radialGap', 'diametralClearance', 'wallThickness']) {
    assert.equal(row(result, quantity), undefined, quantity);
  }
  assert.ok(result.measurements.every(item => !/interference of two bodies/.test(item.note ?? '')));
  near(row(result, 'radiusDifference').value, 4, 1e-9);
  near(row(result, 'axialGap').value, 0, 1e-9);
  assert.match(row(result, 'axialGap').note, /do not overlap axially, so no interference/);
  const distance = row(result, 'faceDistance');
  near(distance.value, 4, 1e-9);
  assert.equal(result.measurements[result.primary], distance);
  assert.deepEqual(result.unsupported, []);
  // Notes say what was checked: the axial overlap was evaluated here.
  assert.equal(row(result, 'radiusDifference').note,
    'supporting cylinders (the faces do not overlap axially)');
  assert.ok(result.measurements.every(item => !/axial overlap are not considered/
    .test(item.note ?? '')));
});

test('an interference is only stated where the faces overlap axially', () => {
  const lifted = structuredClone(stackWasher);
  // Grow the washer boss into the plate: its lower rim moves to z = 4.
  const washer = lifted.bodies[1];
  const rims = washer.faces[3].loops.flat().map(use => washer.edges[use.edge])
    .filter(edge => edge.curve?.type === 'circle');
  const low = Math.min(...rims.map(edge => washer.vertices[edge.start][2]));
  for (const edge of rims) {
    for (const vertex of [edge.start, edge.end]) {
      if (washer.vertices[vertex][2] === low) washer.vertices[vertex][2] = 4;
    }
  }
  const result = measure(lifted, ['B1.F7', 'B2.F4'], { resolveLogical: false });
  near(row(result, 'radialGap').value, -4, 1e-9);
  assert.match(row(result, 'radialGap').note, /interference of two bodies over 2\.0000 mm/);
});

test('convex arc faces facing away: no gap through the material', () => {
  // Arc slot end caps B1.F4 and B1.F6 face away from each other; the span
  // between the supporting circles lies inside the solid (OCCT: 20 mm).
  const result = measure(arcSlot, ['B1.F4', 'B1.F6'], { resolveLogical: false });
  assert.equal(row(result, 'cylinderGap'), undefined);
  assert.equal(result.unsupported.length, 1);
  assert.match(result.unsupported[0].reason, /^general minimum distance.*outside the trimmed arc/);
  // Full-turn faces still get the gap (hole-boss: 10 mm).
  near(row(measure(holeBoss, ['B1.F7', 'B2.F3']), 'cylinderGap').value, 10, 1e-9);
});

test('faces parallel within t over the body are parallel (tolerance-aware angle)', () => {
  // Tilt the bracket's inner wall by 1e-7 rad: far below t / diagonal.
  const tilted = structuredClone(bracket);
  const face = tilted.bodies[0].faces[1];
  const [nx, ny, nz] = face.surface.normal;
  const tilt = 1e-7;
  face.surface.normal = nz !== 0 ? [nx + tilt, ny, nz] : [nx, ny, nz + tilt];
  const result = measure(tilted, ['B1.F1', 'B1.F2']);
  assert.equal(row(result, 'parallel').value, true);
  near(row(result, 'parallelOffset').value, 8, 1e-5);
  assert.ok(row(result, 'angle').value > 0);
  // A real 1° tilt is not parallel.
  const steep = structuredClone(bracket);
  steep.bodies[0].faces[1].surface.normal = nz !== 0 ? [Math.sin(0.0175), 0, Math.cos(0.0175)]
    : face.surface.normal;
  if (nz !== 0) assert.equal(row(measure(steep, ['B1.F1', 'B1.F2']), 'parallel').value, false);
});

// Regressions (fix round 3, verifier exactness lens, round 3 report).
const onCylinder = (model, alias, point) => {
  const [face] = geometry(model, [alias]).faces;
  const { direction, pointNearestOriginMm } = face.surface.axis;
  const relative = point.map((value, axis) => value - pointNearestOriginMm[axis]);
  const along = relative.reduce((sum, value, axis) => sum + value * direction[axis], 0);
  return Math.hypot(...relative.map((value, axis) => value - along * direction[axis]))
    - face.surface.radiusMm;
};

test('off-axis hole inside a boss without axial overlap: exact face distance', () => {
  // offset-washer: Ø4 hole B1.F7 (z 0..6) under a washer B2.F4 (Ø12, z 6..8)
  // centred at (1, 0). OCCT BRepExtrema: 3.0000 at (-2, 0, 6) and (-5, 0, 6).
  // The coaxial formula gave √((6 − 2)² + 0²) = 4 with (6, 0, 6) off the face.
  for (const order of [['B1.F7', 'B2.F4'], ['B2.F4', 'B1.F7']]) {
    const result = measure(offsetWasher, order, { resolveLogical: false });
    assert.equal(row(result, 'coaxial').value, false);
    assert.equal(row(result, 'radiusDifference'), undefined, 'no coaxial row off the axis');
    assert.equal(row(result, 'surfaceDistance'), undefined);
    const distance = row(result, 'faceDistance');
    near(distance.value, 3, 1e-9);
    assert.equal(distance.exactness, 'exact-parameters');
    assert.equal(result.measurements[result.primary], distance);
    const expected = { 'B1.F7': [-2, 0, 6], 'B2.F4': [-5, 0, 6] };
    distance.witness.points.forEach((point, index) => {
      nearVector(point, expected[order[index]]);
      near(onCylinder(offsetWasher, order[index], point), 0, 1e-9, 'witness on the face');
    });
    assert.deepEqual(result.unsupported, []);
  }
  // Lifted by 2 mm: √(3² + 2²) (OCCT on the verifier probe offset-gap: 3.6056).
  const lifted = measure(translateBody(offsetWasher, 1, [0, 0, 2]), ['B1.F7', 'B2.F4'],
    { resolveLogical: false });
  near(row(lifted, 'axialGap').value, 2, 1e-9);
  near(row(lifted, 'faceDistance').value, Math.sqrt(13), 1e-9);
  row(lifted, 'faceDistance').witness.points
    .forEach((point, index) => nearVector(point, [[-2, 0, 6], [-5, 0, 8]][index]));
});

test('crossing circles without axial overlap: the axial gap at a crossing point', () => {
  // crossing-stack: Ø4 hole B1.F7 (z 0..6), Ø6 boss B2.F3 at (3, 0), z 8..11.
  // The circles cross at x = 2/3, y = ±√32/3; OCCT: 2.0000 at those points.
  const result = measure(crossingStack, ['B1.F7', 'B2.F3'], { resolveLogical: false });
  const distance = row(result, 'faceDistance');
  near(distance.value, 2, 1e-9);
  const [onHole, onBoss] = distance.witness.points;
  nearVector(onHole, [2 / 3, Math.sqrt(32) / 3, 6], 1e-9);
  nearVector(onBoss, [2 / 3, Math.sqrt(32) / 3, 8], 1e-9);
  near(onCylinder(crossingStack, 'B1.F7', onHole), 0, 1e-9);
  near(onCylinder(crossingStack, 'B2.F3', onBoss), 0, 1e-9);
});

test('closest points outside a trimmed arc: the face distance is refused with the reason', () => {
  // offset-half-boss: the arc face B2.F3 covers only the +x side; the closest
  // points of the full circles lie at -x. OCCT: 4.0828 at the arc ends, which
  // no closed form here covers, so nothing is stated as exact.
  const result = measure(offsetHalfBoss, ['B1.F7', 'B2.F3'], { resolveLogical: false });
  assert.equal(row(result, 'faceDistance'), undefined);
  assert.equal(row(result, 'radiusDifference'), undefined);
  assert.equal(result.unsupported.length, 1);
  assert.match(result.unsupported[0].reason,
    /^general minimum distance.*not on the facing rims of B1\.F7 and B2\.F3\)$/);
});

test('an axial overlap between 0 and t: the witness joins the facing rims', () => {
  // stack-washer with the washer 1e-4 mm lower (overlap 1e-4 < t = 3e-4).
  // OCCT on the verifier probe stack-overlap-tiny: 3.99999.
  const sunk = translateBody(stackWasher, 1, [0, 0, -1e-4]);
  const result = measure(sunk, ['B1.F7', 'B2.F4'], { resolveLogical: false });
  const distance = row(result, 'faceDistance');
  near(distance.value, 4, 1e-9);
  const [onHole, onWasher] = distance.witness.points;
  near(onHole[2], 6, 1e-9, 'the top rim of the hole');
  near(onWasher[2], 6 - 1e-4, 1e-9, 'the bottom rim of the washer');
  const length = Math.hypot(...onWasher.map((value, axis) => value - onHole[axis]));
  near(length, distance.value, distance.toleranceMm);
});

test('parallel decisions and offsets do not depend on the selection order', () => {
  // tilt-pad: the pad bottom B2.F1 is tilted by 2e-5 rad against the plate top
  // B1.F2 and sits 282 mm from the plate origin. OCCT: 4.99995 to 5.00005 mm
  // across the pad; across the plate the planes drift by 6e-3 mm (20 t), so
  // they are not parallel, and the offset is stated for the pad only.
  const ab = measure(tiltPad, ['B1.F2', 'B2.F1'], { resolveLogical: false });
  const ba = measure(tiltPad, ['B2.F1', 'B1.F2'], { resolveLogical: false });
  assert.deepEqual(orderFree(ab), orderFree(ba));
  assert.equal(row(ab, 'parallel').value, false);
  assert.equal(row(ab, 'parallelOffset'), undefined);
  const offset = row(ab, 'faceToPlaneOffset');
  near(offset.value, 5, 5e-5);
  assert.equal(offset.label, 'Offset of B2.F1 from the plane of B1.F2');
  assert.match(offset.note, /not parallel within t across both faces; evaluated at the centroid of B2\.F1, varies by at most 1\.4\d?e-4 mm across it$/);
  assert.equal(offset.witness.from, 1, 'drawn from the pad');
  assert.equal(row(ba, 'faceToPlaneOffset').witness.from, 0);
  assert.equal(ab.measurements[ab.primary], offset);
  // The scoped row uses t over the pad; the decision t over both faces.
  const t = offset.toleranceMm;
  assert.ok(offset.angularToleranceRad * 8 > t && offset.angularToleranceRad * 7 < t,
    'pad diagonal √(5² + 5² + (5·2e-5)²) ≈ 7.07 mm');
  const decision = row(ab, 'parallel');
  assert.ok(decision.angularToleranceRad * 425 > t && decision.angularToleranceRad * 420 < t,
    'plate top and pad together: diagonal ≈ 422 mm');
  assert.equal(ab.angularToleranceRad, offset.angularToleranceRad);
  // axis-far: two cylinders 500 mm from the origin with axes 1e-4 mm apart.
  const cylinders = [['B1.F3', 'B2.F3'], ['B2.F3', 'B1.F3']]
    .map(order => measure(axisFar, order, { resolveLogical: false }));
  assert.deepEqual(orderFree(cylinders[0]), orderFree(cylinders[1]));
  assert.equal(row(cylinders[0], 'coaxial').value, true);
  near(row(cylinders[0], 'axisDistance').value, 5e-5, 1e-6);
  near(row(cylinders[0], 'radiusDifference').value, 2, 1e-9);
  // Every face pair of the fixtures, both orders: the same rows.
  for (const model of [spacer, bracket, holeBoss, stackWasher, offsetWasher, crossingStack]) {
    model.bodies.forEach((body, b) => body.faces.forEach((_face, f) => {
      model.bodies.forEach((other, c) => other.faces.forEach((_otherFace, g) => {
        if (c < b || (c === b && g <= f)) return;
        const [p, q] = [aliasOf(b, 'face', f), aliasOf(c, 'face', g)];
        assert.deepEqual(orderFree(measure(model, [p, q])), orderFree(measure(model, [q, p])),
          `${p} / ${q}`);
      }));
    }));
  }
});

// Vertices of a face and its raw support, read straight from the model (plain
// doubles), for independent checks of what a decision claims.
function rawFace(model, alias) {
  const { bodyIndex, index } = parseAlias(alias);
  const body = model.bodies[bodyIndex];
  const face = body.faces[index];
  const ends = face.loops.flat().flatMap(use => [body.edges[use.edge].start, body.edges[use.edge].end]);
  const unit = vector => vector.map(value => value / Math.hypot(...vector));
  const surface = face.surface;
  return {
    vertices: [...new Set(ends)].map(vertex => body.vertices[vertex]),
    type: surface.type, origin: surface.origin,
    direction: unit(surface.type === 'plane' ? surface.normal : surface.axis ?? [0, 0, 1]),
  };
}
const dot3 = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const sub3 = (u, v) => u.map((value, axis) => value - v[axis]);
const planeDistance = (point, plane) => Math.abs(dot3(sub3(point, plane.origin), plane.direction));
const axisDistance = (point, axis) => {
  const along = sub3(point, axis.origin);
  const foot = dot3(along, axis.direction);
  return Math.sqrt(Math.max(0, dot3(along, along) - foot * foot));
};
const onAxis = (point, axis) => axis.origin.map((value, i) => value
  + axis.direction[i] * dot3(sub3(point, axis.origin), axis.direction));

test('parallel and coaxial decisions hold across both faces, not only the smaller one', () => {
  // Refix 1 (verifier: pad-lateral, direct-mount): a pair decided parallel
  // must keep its offset within the stated tolerance at every vertex of BOTH
  // faces; coaxial axes must stay within it at both faces. Faces parallel
  // across the smaller face only get the scoped offset, true across that face.
  let parallelPlanes = 0;
  let scoped = 0;
  let coaxialPairs = 0;
  for (const model of [spacer, bracket, holeBoss, stackWasher, offsetWasher, crossingStack,
    tiltPad, axisFar, coaxFar]) {
    const faces = model.bodies.flatMap((body, b) => body.faces.map((_face, f) => aliasOf(b, 'face', f)))
      .filter(alias => ['plane', 'cylinder'].includes(rawFace(model, alias).type));
    for (let i = 0; i < faces.length; i++) {
      for (let j = i + 1; j < faces.length; j++) {
        const [p, q] = [rawFace(model, faces[i]), rawFace(model, faces[j])];
        if (p.type !== q.type) continue;
        const result = measure(model, [faces[i], faces[j]], { resolveLogical: false });
        const where = `${faces[i]} / ${faces[j]}`;
        const decision = row(result, 'parallel');
        if (p.type === 'plane') {
          const offset = row(result, 'parallelOffset');
          if (decision.value) {
            parallelPlanes++;
            for (const [face, other] of [[p, q], [q, p]]) {
              for (const vertex of face.vertices) {
                near(planeDistance(vertex, other), offset.value, decision.toleranceMm + 1e-9, where);
              }
            }
          }
          const local = row(result, 'faceToPlaneOffset');
          if (local) {
            scoped++;
            const [, own, plane] = /^Offset of (\S+) from the plane of (\S+)$/.exec(local.label);
            for (const vertex of rawFace(model, own).vertices) {
              near(planeDistance(vertex, rawFace(model, plane)), local.value, local.toleranceMm, where);
            }
          }
        } else if (row(result, 'coaxial').value) {
          coaxialPairs++;
          for (const [face, other] of [[p, q], [q, p]]) {
            for (const vertex of face.vertices) {
              assert.ok(axisDistance(onAxis(vertex, face), other) <= decision.toleranceMm + 1e-9,
                `${where}: axes ${axisDistance(onAxis(vertex, face), other)} apart at a vertex`);
            }
          }
        }
      }
    }
  }
  assert.ok(parallelPlanes > 50 && scoped >= 4 && coaxialPairs >= 5,
    `${parallelPlanes} parallel planes, ${scoped} scoped offsets, ${coaxialPairs} coaxial pairs`);
});

test('axes coaxial across the smaller face only are neither parallel nor coaxial, with the reason', () => {
  // coax-far (verifier probe coax-far-apart): at B2 the axes are 1e-4 mm
  // apart, at B1 about 0.01 mm. Before refix 1: "Parallel axes true · Coaxial
  // true · Radius difference 2", and no word on the missing face distance.
  for (const order of [['B1.F3', 'B2.F3'], ['B2.F3', 'B1.F3']]) {
    const result = measure(coaxFar, order, { resolveLogical: false });
    assert.equal(row(result, 'parallel').value, false, order.join());
    assert.equal(row(result, 'coaxial').value, false, order.join());
    assert.equal(row(result, 'radiusDifference'), undefined);
    assert.equal(result.unsupported.length, 1);
    assert.match(result.unsupported[0].reason, new RegExp(`^${EXTREMA_REASON} \\(the axes of B2\\.F3`
      + ' and B1\\.F3 are parallel within t across B2\\.F3 but deviate by up to 1\\.0\\de-2 mm'
      + ' across both faces\\)$'));
  }
});

test('a refused face distance is reported next to a supporting-cylinder row', () => {
  // coaxial-arcs: coaxial D-shaped bosses, axially 2 mm apart, arcs sharing no
  // direction. The radius difference of the supporting cylinders is stated;
  // the refused face distance used to vanish because that row counted as a
  // surface distance.
  for (const order of [['B1.F3', 'B2.F4'], ['B2.F4', 'B1.F3']]) {
    const result = measure(coaxialArcs, order, { resolveLogical: false });
    assert.equal(row(result, 'coaxial').value, true);
    near(row(result, 'radiusDifference').value, 2, 1e-9);
    near(row(result, 'axialGap').value, 2, 1e-9);
    assert.equal(row(result, 'faceDistance'), undefined);
    assert.equal(result.unsupported.length, 1);
    assert.equal(result.unsupported[0].quantity, 'minimumDistance');
    assert.match(result.unsupported[0].reason, /^general minimum distance.*\(minimum distance between the faces: the closest points of the supporting circles are not on the facing rims of B2\.F4 and B1\.F3\)$/);
  }
});

test('off-axis trim checks use the coverage at the common heights of the axial overlap', () => {
  // notch-base, B1.F3 notched toward B2 above z 6, B2.F3 at z 7..10 of the
  // overlap: the notch-floor arc at z 6 covers the closest direction, but the
  // faces only meet at z 7..10, where B1.F3 does not. The supporting cylinders
  // are 2 mm apart; the faces are not (OCCT BRepExtrema 2.2360680 between
  // (5, 0, 6) and (7, 0, 7)). Before, 'Gap between cylinders 2.0000' was
  // stated exact from the union of all rims of B1.F3.
  for (const order of [['B1.F3', 'B2.F3'], ['B2.F3', 'B1.F3']]) {
    const result = measure(notchedBoss, order, { resolveLogical: false });
    assert.equal(row(result, 'parallel').value, true);
    near(row(result, 'axisDistance').value, 9, 1e-9);
    assert.equal(row(result, 'cylinderGap'), undefined, order.join());
    assert.equal(row(result, 'faceDistance'), undefined);
    assert.equal(result.unsupported.length, 1);
    assert.match(result.unsupported[0].reason, /^general minimum distance.*\(gap between cylinders: the closest points of the supporting cylinders lie outside the trimmed arc of B1\.F3 at every height of the axial overlap of the faces\)$/);
  }
  // The untrimmed fixture, and a notch floor at z 7 (the face reaches the
  // closest direction exactly where B2.F3 starts): 2 mm, exact.
  const floorAt7 = trimCylinderFace(notchBase, 'B1.F3', [
    [['arc', 0, 0, 360]],
    [['arc', 10, 30, 330], ['line', 330, 10, 7], ['arc', 7, 330, 390], ['line', 30, 7, 10]],
  ]);
  for (const model of [notchBase, floorAt7]) {
    for (const order of [['B1.F3', 'B2.F3'], ['B2.F3', 'B1.F3']]) {
      const result = measure(model, order, { resolveLogical: false });
      near(row(result, 'cylinderGap').value, 2, 1e-9);
      assert.equal(row(result, 'cylinderGap').note,
        'supporting cylinders over 3.0000 mm of axial overlap of the faces; parallel axes');
      assert.deepEqual(result.unsupported, []);
    }
  }
});

test('coaxial trim checks use the coverage at the common heights of the axial overlap', () => {
  // pin-in-bore with the bore full around at z 0..4 and only 0..90° above,
  // and the pin a 180..270° window at z 6..10: every direction is on some rim
  // of the bore, but at z 6..10 the arcs share none, so no radial gap is a
  // gap between these faces. A pin window at 45..135° shares 45..90°.
  const bore = trimCylinderFace(pinInBore, 'B1.F7', [
    [['arc', 0, 0, 360]],
    [['arc', 4, 90, 360], ['line', 0, 4, 12], ['arc', 12, 0, 90], ['line', 90, 12, 4]],
  ]);
  const pinAt = from => trimCylinderFace(bore, 'B2.F3', [
    [['arc', 6, from, from + 90], ['line', from + 90, 6, 10], ['arc', 10, from, from + 90],
      ['line', from, 10, 6]],
  ]);
  for (const order of [['B1.F7', 'B2.F3'], ['B2.F3', 'B1.F7']]) {
    const apart = measure(pinAt(180), order, { resolveLogical: false });
    assert.equal(row(apart, 'coaxial').value, true);
    assert.equal(row(apart, 'radialGap'), undefined, order.join());
    assert.equal(row(apart, 'diametralClearance'), undefined);
    assert.equal(apart.unsupported.length, 1);
    assert.match(apart.unsupported[0].reason, /\(radial gap: the trimmed arcs of B[12]\.F[37] and B[12]\.F[37] share no direction at any height of their axial overlap\)$/);
    const facing = measure(pinAt(45), order, { resolveLogical: false });
    near(row(facing, 'radialGap').value, 0.2, 1e-9);
    assert.match(row(facing, 'radialGap').note,
      /^supporting cylinders over 4\.0000 mm of axial overlap/);
  }
});

}
