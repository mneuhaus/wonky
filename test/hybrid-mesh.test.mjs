import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("hybrid-mesh.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { mkdtempSync, rmSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { build } = await import("../src/index.mjs");
const { loadKernel } = await import("../src/kernel.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");
const { certifiedMeshBody, isMeshBody, meshEdges, snapMesh, wedgeDistance, curveCurvature, curveSagitta } = await import("../src/hybrid-mesh.mjs");
const { printMesh, meshDefects } = await import("../src/print-mesh.mjs");
const { integrateVolume, meshEstimate } = await import("../src/volume.mjs");
const { toStep, toStl } = await import("../src/exporters.mjs");
const { r20Export, writeR20Export } = await import("../src/r20-export.mjs");
const { readR20Export } = await import("../scripts/r20/mesh.mjs");















// Certified-mesh bodies (docs/hybrid-mesh-bodies.md; plan section 8, step 8):
// the hybrid Boolean's `mesh` answer as a body labelled approximation, its
// carrier-method volume, its refusals, its snapped print mesh.

const header = 'FeatureScript 3044;\nimport(path : "onshape/std/geometry.fs", version : "3044.0");\n';
const cylinder = (name, [x, y, z], r, h, axis = [0, 0, 1]) => `
    var s${name} = newSketchOnPlane(context, id + "s${name}", { "sketchPlane" : plane(vector(${x},${y},${z})*millimeter, vector(${axis.join(',')})) });
    skCircle(s${name}, "c", { "center" : vector(0,0)*millimeter, "radius" : ${r}*millimeter });
    skSolve(s${name});
    opExtrude(context, id + "${name}", { "entities" : qSketchRegion(id + "s${name}"), "direction" : vector(${axis.join(',')}),
        "endBound" : BoundingType.BLIND, "endDepth" : ${h}*millimeter });`;
const box = (name, lo, hi) => `fCuboid(context, id + "${name}", { "corner1" : vector(${lo.join(',')}) * millimeter, "corner2" : vector(${hi.join(',')}) * millimeter });`;
const union = (a, b) => `
    opBoolean(context, id + "u", { "tools" : qUnion([qCreatedBy(id + "${a}", EntityType.BODY), qCreatedBy(id + "${b}", EntityType.BODY)]), "operationType" : BooleanOperationType.UNION });`;
const part = body => `${header}export function part(context is Context, id is Id, definition is map)\n{\n${body}\n}`;
// Crossed rods, r 5 along x and r 3 along y, both 20 mm long and centred on
// the origin: skew (perpendicular) axes meet in space quartics, which recover
// does not write exactly, so the answer is a certified mesh. (Two parallel
// cylinders were this fixture until recover wrote their generator lines.)
// Its volume: V = pi 25 20 + pi 9 20 - overlap, overlap = 4 int_{-3}^{3}
// sqrt((9 - z^2)(25 - z^2)) dz, with z = 3 sin(t): 36 int cos^2 t
// sqrt(25 - 9 sin^2 t) dt (Gauss-Legendre, 40 nodes; independent of the kernel).
const crossed = cylinder('p', [-10, 0, 0], 5, 20, [1, 0, 0]) + cylinder('q', [0, -10, 0], 3, 20, [0, 1, 0]) + union('p', 'q');
const gaussLegendre = n => {
  const nodes = [];
  for (let i = 1; i <= n; i++) {
    let t = Math.cos(Math.PI * (i - 0.25) / (n + 0.5)), dp = 1;
    for (let k = 0; k < 100; k++) {
      let p0 = 1, p1 = t;
      for (let j = 2; j <= n; j++) { const p2 = ((2 * j - 1) * t * p1 - (j - 1) * p0) / j; p0 = p1; p1 = p2; }
      dp = n * (t * p1 - p0) / (t * t - 1);
      const dt = p1 / dp; t -= dt;
      if (Math.abs(dt) < 1e-16) break;
    }
    nodes.push([t, 2 / ((1 - t * t) * dp * dp)]);
  }
  return nodes;
};
const overlap = gaussLegendre(40).reduce((sum, [x, w]) => { const t = x * Math.PI / 2; return sum + w * Math.PI / 2 * 36 * Math.cos(t) ** 2 * Math.sqrt(25 - 9 * Math.sin(t) ** 2); }, 0);
const crossedVolume = Math.PI * 25 * 20 + Math.PI * 9 * 20 - overlap;
const named = `\n    setProperty(context, { "entities" : qCreatedBy(id + "p", EntityType.BODY), "propertyType" : PropertyType.NAME, "value" : "L01 crossed rods" });`;

const kernel = await loadKernel();
const crossedModel = await build(part(crossed + named), { feature: 'part' });
const near = (actual, expected, relative) => assert.ok(Math.abs(actual - expected) <= relative * Math.abs(expected), `${actual} is not within ${relative} of ${expected}`);

test('a mesh answer becomes one body labelled approximation, never exact, with its carriers and provenance', () => {
  assert.equal(crossedModel.bodies.length, 1);
  const [body] = crossedModel.bodies;
  assert.ok(isMeshBody(body));
  assert.equal(body.exact, false);
  assert.equal(body.approximation.label, 'approximation');
  assert.equal(body.approximation.kind, 'certified-mesh');
  assert.equal(body.approximation.deviationMm, 0.01);
  assert.match(body.approximation.reason, /cylinder\/cylinder/);
  assert.match(body.approximation.certificate, /pre-certificate/);
  assert.deepEqual([...new Set(body.faces.map(f => f.surface.type))].sort(), ['cylinder', 'plane']);
  assert.deepEqual(body.vertices, []);
  assert.deepEqual(body.edges, []);
  assert.equal(body.validation.volumeMm3, null);
  assert.equal(body.construction.method, 'hybrid corefine+recover');
  // Each face lists the operand faces of its triangles; both operands appear.
  assert.equal(body.provenance.faces.length, body.faces.length);
  assert.deepEqual(body.provenance.operands, [0, 1]);
  assert.ok(meshEdges(body.mesh.triangles).edges);
  assert.ok(body.mesh.triangles.every(t => t[3] >= 0 && t[3] < body.faces.length));
  assert.equal(body.name, 'L01 crossed rods');
});

test('the carrier method integrates the exact solid behind the mesh (quadrature within 1e-9); the mesh estimate states its bound', () => {
  const [body] = crossedModel.bodies;
  const measured = integrateVolume(kernel, body);
  assert.equal(measured.label, 'carrier-quadrature');
  near(measured.volumeMm3, crossedVolume, 1e-9);
  assert.ok(measured.boundMm3 < 1e-6, `bound ${measured.boundMm3}`);
  const estimate = meshEstimate(body);
  assert.equal(estimate.label, 'mesh-estimate');
  assert.ok(Math.abs(estimate.volumeMm3 - crossedVolume) <= estimate.boundMm3);
});

test('evVolume of a mesh body uses the carrier method and records it as evidence', async () => {
  const model = await build(part(crossed + `\n    const v = evVolume(context, { "entities" : qCreatedBy(id + "p", EntityType.BODY) });
    if (abs(v - ${crossedVolume} * millimeter ^ 3) > 1e-6 * millimeter ^ 3)
        throw regenError("crossed volume " ~ toString(v));`), { feature: 'part' });
  const evidence = model.operationEvidence.filter(e => e.operation === 'evVolume');
  assert.equal(evidence.length, 1);
  assert.match(JSON.stringify(evidence[0]), /carrier-quadrature/);
});

test('STEP, the exact STL and the exact-geometry queries refuse a mesh body by name', async () => {
  const model = crossedModel;
  assert.throws(() => toStep(model, "crossed"), e => e instanceof UnsupportedFeatureError && /STEP export .*certified-mesh body .*approximation within 0.01 mm.*cylinder\/cylinder/.test(e.message));
  assert.throws(() => toStl(model), e => e instanceof UnsupportedFeatureError && /Exact STL .*certified-mesh body/.test(e.message));
  const refuses = async (line, pattern) => {
    await assert.rejects(build(part(crossed + `\n    ${line}`), { feature: 'part' }), e => e instanceof UnsupportedFeatureError && pattern.test(e.message));
  };
  await refuses('evaluateQuery(context, qOwnedByBody(qCreatedBy(id + "p", EntityType.BODY), EntityType.EDGE));', /An edge query is not available for certified-mesh body/);
  await refuses('evaluateQuery(context, qContainsPoint(qOwnedByBody(qCreatedBy(id + "p", EntityType.BODY), EntityType.FACE), vector(0, 0, 0) * millimeter));', /qContainsPoint over its faces is not available for certified-mesh body/);
  await refuses('evaluateQuery(context, qAdjacent(qOwnedByBody(qCreatedBy(id + "p", EntityType.BODY), EntityType.FACE), AdjacencyType.EDGE, EntityType.EDGE));', /qAdjacent .*certified-mesh body/);
  await refuses('evBox3d(context, { "topology" : qCreatedBy(id + "p", EntityType.BODY) });', /evBox3d .*certified-mesh body/);
  await refuses('evaluateQuery(context, qOwnedByBody(qCreatedBy(id + "p", EntityType.BODY), EntityType.VERTEX));', /A vertex query is not available for certified-mesh body/);
  await refuses('evaluateQuery(context, qClosestTo(qOwnedByBody(qCreatedBy(id + "p", EntityType.BODY), EntityType.FACE), vector(0, 0, 20) * millimeter));', /qClosestTo over its faces \(it has no exact boundary\) is not available for certified-mesh body/);
  // An exactly parallel carrier one kernel resolution unit (1e-7 mm) off: above the
  // rounding margin (16 x 1e-13 x 10 mm), below the zero length: undecided, refused by name.
  await refuses('evaluateQuery(context, qCoincidesWithPlane(qOwnedByBody(qCreatedBy(id + "p", EntityType.BODY), EntityType.FACE), plane(vector(10 + 1e-7, 0, 0) * millimeter, vector(1, 0, 0))));', /qCoincidesWithPlane: face \d+ of body .* lies within 0.00001 mm \(TOLERANCE.zeroLength\) of the plane but is neither certified to lie in it nor within the kernel's resolution \(plane_plane Unresolved NearCoincidentPlanes, an exactly parallel carrier\)/);
  // A carrier tilted 1e-11 rad (plane_plane NearParallelPlanes, no parallel certificate): its
  // distance varies over the face, so deciding it needs exact boundary points, which a mesh lacks.
  await refuses('evaluateQuery(context, qCoincidesWithPlane(qOwnedByBody(qCreatedBy(id + "p", EntityType.BODY), EntityType.FACE), plane(vector(10, 0, 0) * millimeter, vector(1, 0, 1e-11))));', /qCoincidesWithPlane \(face \d+'s carrier: plane_plane Unresolved NearParallelPlanes; deciding it needs exact boundary points\) is not available for certified-mesh body/);
  // Faces exist: a face query by body is answered, and so are qCoincidesWithPlane
  // and qGeometry on their recorded exact carriers (end caps x +-10 and y +-10; three cylinder faces, the r 3 rod's two ends outside the r 5 rod).
  const faces = await build(part(crossed + `
    const faces = qOwnedByBody(qCreatedBy(id + "p", EntityType.BODY), EntityType.FACE);
    const on = function(x, n) { return size(evaluateQuery(context, qCoincidesWithPlane(faces, plane(x * n * millimeter, n)))); };
    if (size(evaluateQuery(context, faces)) != 7) throw regenError("faces");
    if (on(10, vector(-1, 0, 0)) != 1 || on(10, vector(1, 0, 0)) != 1 || on(10, vector(0, 1, 0)) != 1 || on(10, vector(0, -1, 0)) != 1) throw regenError("caps");
    if (on(5, vector(1, 0, 0)) != 0 || on(10 + 2e-5, vector(1, 0, 0)) != 0) throw regenError("parallel planes");
    // Exactly parallel and off by rounding only (the real T01 rim face is 1.7e-13 mm off): decided on the carrier.
    if (on(10 + 2e-13, vector(1, 0, 0)) != 1 || on(10 - 2e-13, vector(0, -1, 0)) != 1) throw regenError("rounding offset");
    if (size(evaluateQuery(context, qCoincidesWithPlane(faces, plane(vector(0, 0, 1) * millimeter, vector(0, 0, 1))))) != 0) throw regenError("crossing plane");
    if (size(evaluateQuery(context, qGeometry(faces, GeometryType.CYLINDER))) != 3 || size(evaluateQuery(context, qGeometry(faces, GeometryType.PLANE))) != 4) throw regenError("types");
    if (size(evaluateQuery(context, qGeometry(faces, GeometryType.MESH))) != 0 || size(evaluateQuery(context, qGeometry(faces, GeometryType.CONE))) != 0) throw regenError("other types");`), { feature: 'part' });
  assert.equal(faces.bodies.length, 1);
});

test('the print mesh is the body mesh (snapped where that re-certifies) with its stated deviation; finer is refused', () => {
  const [body] = crossedModel.bodies;
  const mesh = printMesh(kernel, body, 0.01, { tags: true });
  assert.ok(mesh.achievedDeviationMm <= 0.01);
  assert.equal(mesh.approximation.label, 'approximation');
  assert.ok(meshDefects(mesh.triangles).watertight);
  assert.equal(mesh.tags.length, mesh.triangles.length);
  assert.throws(() => printMesh(kernel, body, 0.005), e => e instanceof UnsupportedFeatureError && /cannot be refined/.test(e.message));
});

test('the r20 export writes the mesh body with its approximation label and its carrier volume; the reader accepts it', async () => {
  const exported = r20Export(kernel, crossedModel, { deviationMm: 0.01, sourcePath: 'crossed.fs', source: part(crossed + named), feature: 'part' });
  const row = exported.manifest.parts.L01.wonky;
  assert.equal(row.exact, false);
  assert.equal(row.approximation.label, 'approximation');
  assert.equal(row.volumeLabel, 'carrier-quadrature');
  near(row.volumeMm3, crossedVolume, 1e-9);
  assert.ok(row.meshDeviationMm <= 0.01);
  assert.ok(row.float32RoundingMm >= 0 && row.float32RoundingMm < 1e-5);
  const sum = row.meshDeviationMm + row.float32RoundingMm;
  assert.ok(row.achievedDeviationMm >= sum);
  // One outward binary64 step after nearest addition: ULP(2^e) = 2^(e-52).
  const ulp = 2 ** (Math.floor(Math.log2(sum)) - 52);
  assert.ok(row.achievedDeviationMm <= sum + ulp, 'stored deviation is not overstated beyond one outward ULP');
  const dir = mkdtempSync(join(tmpdir(), 'wonky-hybrid-mesh-'));
  try {
    await writeR20Export(dir, exported);
    const read = readR20Export(dir, { wonky: true });
    assert.deepEqual(read.problems ?? [], []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a chained Boolean takes the mesh body as an operand (its mesh and carriers); the result keeps the label', async () => {
  // The slab x >= 6 takes 4 mm of the r 5 rod and nothing of the r 3 rod.
  const model = await build(part(crossed + box('s', [6, -10, -10], [20, 10, 10]) + `
    opBoolean(context, id + "cut", { "targets" : qCreatedBy(id + "p", EntityType.BODY), "tools" : qCreatedBy(id + "s", EntityType.BODY),
        "operationType" : BooleanOperationType.SUBTRACTION });`), { feature: 'part' });
  assert.equal(model.bodies.length, 1);
  const [body] = model.bodies;
  assert.ok(isMeshBody(body));
  assert.equal(body.exact, false);
  near(integrateVolume(kernel, body).volumeMm3, crossedVolume - Math.PI * 25 * 4, 1e-9);
});

// A synthetic mesh answer: the face table of two leaves and a mesh.
const tetra = (o, s) => ({ vertices: [[o, o, o], [o + s, o, o], [o, o + s, o], [o, o, o + s]], triangles: [[0, 2, 1, 0], [0, 1, 3, 1], [0, 3, 2, 2], [1, 2, 3, 3]] });
const planeFace = (origin, normal) => ({ surface: { type: 'plane', origin, normal, x: Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0] } });
function answer(mesh) {
  const operand = { id: 'a', faces: [planeFace([0, 0, 0], [0, 0, -1]), planeFace([0, 0, 0], [0, -1, 0]), planeFace([0, 0, 0], [-1, 0, 0]), planeFace([1, 0, 0], [0.57735, 0.57735, 0.57735])] };
  const faces = operand.faces.map((_, i) => ({ leaf: 0, faceIndex: i }));
  return { result: { status: 'mesh', deviationMm: 0.01, reason: 'test', mesh, classes: faces.map((_, i) => i), job: { deviation: 0.01, faces } }, operands: [operand] };
}

test('certifiedMeshBody refuses by name what the certificate does not cover: several shells, an open mesh', () => {
  const one = tetra(0, 1);
  const { result, operands } = answer(one);
  const [body] = certifiedMeshBody(result, 'one', operands, null);
  assert.equal(body.faces.length, 4);
  const two = { vertices: [...one.vertices, ...tetra(5, 1).vertices], triangles: [...one.triangles, ...one.triangles.map(([a, b, c, f]) => [a + 4, b + 4, c + 4, f])] };
  assert.throws(() => certifiedMeshBody(answer(two).result, 'two', operands, null), e => e instanceof UnsupportedFeatureError && /2 shells, and their nesting .* was not certified/.test(e.message));
  const open = { vertices: one.vertices, triangles: one.triangles.slice(1) };
  assert.throws(() => certifiedMeshBody(answer(open).result, 'open', operands, null), e => e instanceof UnsupportedFeatureError && /bounds only one triangle \(not closed\)/.test(e.message));
  assert.throws(() => certifiedMeshBody({ status: 'exact' }, 'x', operands, null), /expects a hybrid mesh answer/);
});

// A closed prism x in [0, 1] over a section polygon (y, z) counter-clockwise
// seen from +x, one face per section segment (segmentFace), fan caps 2 and 3.
function prism(section, segmentFace) {
  const V = [], at = pt => { V.push(pt.map(Math.fround)); return V.length - 1; };
  const left = section.map(([y, z]) => at([0, y, z])), right = section.map(([y, z]) => at([1, y, z]));
  const T = [];
  for (let i = 0; i < section.length; i++) {
    const j = (i + 1) % section.length;
    T.push([left[i], left[j], right[j], segmentFace[i]], [left[i], right[j], right[i], segmentFace[i]]);
  }
  for (let i = 1; i + 1 < section.length; i++) { T.push([left[0], left[i + 1], left[i], 2]); T.push([right[0], right[i], right[i + 1], 3]); }
  assert.ok(meshEdges(T).edges, 'the hand-made mesh is closed and oriented');
  return { V, T, left, right };
}
// A plane z = z0 meeting a unit cylinder along x at a shallow angle; a facet
// mesh of the cylinder at deviation-sized angular steps crosses z0 at yChord,
// not at the exact yExact = sqrt(1 - z0^2).
function grazing(dev) {
  const r = 1, z0 = 0.95, yExact = Math.sqrt(r * r - z0 * z0);
  const step = 2 * Math.acos(1 - dev / r) * 0.99;
  const a0 = Math.asin(yExact), k = Math.floor(a0 / step), p = [Math.sin(k * step), Math.cos(k * step)], q = [Math.sin((k + 1) * step), Math.cos((k + 1) * step)];
  const yChord = p[0] + (q[0] - p[0]) * (z0 - p[1]) / (q[1] - p[1]);
  const plane = (origin, normal) => ({ type: 'plane', origin, normal, x: Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0] });
  return { z0, yExact, yChord, p, q, rod: { type: 'cylinder', origin: [0, 0, 0], axis: [1, 0, 0], x: [0, 0, 1], radius: r }, plane,
    cap0: plane([0, 0, 0], [-1, 0, 0]), cap1: plane([1, 0, 0], [1, 0, 0]) };
}

test('snapping leaves a boundary vertex inside its carriers\' wedge in place: it lies on the exact face', () => {
  // A rod (material inside the cylinder) cut by the slab z <= z0: the chord
  // crossing lies inside the rod, on the top face, so it has no drift.
  const dev = 0.01, g = grazing(dev);
  assert.ok(Math.abs(g.yChord - g.yExact) > dev / 2, 'the chord crossing is more than half the deviation from the exact line');
  const section = [[-0.5, 0.5], [g.p[0], 0.5], g.p, [g.yChord, g.z0], [-0.5, g.z0]].map(([y, z]) => [Math.fround(y), Math.fround(z)]);
  // Segments: bottom (4), plane y = p (6), rod facet (1), top (0), side (5).
  const { V, T, left, right } = prism(section, [4, 6, 1, 0, 5]);
  const faces = [g.plane([0, 0, g.z0], [0, 0, 1]), g.rod, g.cap0, g.cap1, g.plane([0, 0, 0.5], [0, 0, -1]), g.plane([0, -0.5, 0], [0, -1, 0]), g.plane([0, g.p[0], 0], [0, 1, 0])].map(surface => ({ surface }));
  const snapped = snapMesh(kernel, { vertices: V, triangles: T }, faces, faces.map((_, i) => i), dev);
  assert.equal(snapped.refused, undefined, snapped.refused);
  assert.ok(snapped.deviationMm <= dev, `stated ${snapped.deviationMm}`);
  for (const v of [left[3], right[3]]) assert.deepEqual(snapped.vertices[v], V[v]);
  assert.ok(snapped.snap.safeVertices >= 2);
});

test('snapping moves a boundary vertex past a sharp wedge onto the exact line; left in place its drift is in the claim', () => {
  // KT1's slot edge in miniature: a bore (material outside the unit cylinder)
  // under a floor z <= z0 meeting it at 18 degrees. The chord crossing lies
  // in the bore, past the exact edge: within the deviation of both carriers,
  // but farther than that from the exact face (such a vertex used to be
  // stated as within the deviation when it stayed: KT1 turned 90 degrees,
  // 0.030 mm).
  const dev = 0.01, g = grazing(dev);
  const section = [[g.yChord, g.z0], g.q, [1.5, g.q[1]], [1.5, g.z0]].map(([y, z]) => [Math.fround(y), Math.fround(z)]);
  // Segments: bore facet (1), plane z = q_z (4), plane y = 1.5 (5), floor (0).
  const { V, T, left, right } = prism(section, [1, 4, 5, 0]);
  const faces = [g.plane([0, 0, g.z0], [0, 0, 1]), g.rod, g.cap0, g.cap1, g.plane([0, 0, g.q[1]], [0, 0, -1]), g.plane([0, 1.5, 0], [0, 1, 0])].map(surface => ({ surface }));
  const snapped = snapMesh(kernel, { vertices: V, triangles: T }, faces, faces.map((_, i) => i), dev);
  assert.equal(snapped.refused, undefined, snapped.refused);
  // corefine's mesh as it is holds only its drift: the distance to the exact
  // line, over the deviation.
  assert.ok(snapped.unsnappedClaim > dev && snapped.unsnappedClaim >= (1 - 1e-6) * Math.abs(g.yExact - g.yChord), `unsnapped claim ${snapped.unsnappedClaim}`);
  assert.equal(snapped.snap.applied, true);
  assert.ok(snapped.deviationMm <= dev, `stated ${snapped.deviationMm}`);
  for (const v of [left[0], right[0]]) near(snapped.vertices[v][1], g.yExact, 1e-9);
  assert.ok(meshEdges(snapped.triangles).edges);
});

test('a boundary edge along a curved curve is claimed over its interior, not only at its ends (verify#2: KT1 0.01013 stated 0.01)', () => {
  // KT1's rib-arc edge in miniature: a block x in [0, 1] with a bite of a
  // cylinder (axis x, r 0.45, material outside) out of its top z = 0. The
  // left cap x = 0 meets the bore in a circle of curvature 1 / 0.45. The
  // bite's inner vertices on the left cap sit past that edge: 0.0098 mm off
  // the cap (x < 0) and 0.001 mm into the bore, within the deviation of both
  // carriers and 0.00985 mm from the exact edge. The chord between two of them
  // bends away from the circle: its middle is 0.01026 mm from the exact edge.
  // The vertex-only claim was the deviation, 0.01 mm.
  const dev = 0.01, r = 0.45, zc = 0.4, a = 0.0098, b = 0.001, n = 5;
  // The bite from (y+, 0) to (y-, 0) through the circle's bottom (angles
  // about (y, z) = (0, zc)).
  const ends = [Math.sqrt(r * r - zc * zc), -Math.sqrt(r * r - zc * zc)];
  const ta = Math.atan2(-zc, ends[0]), tb = Math.atan2(-zc, ends[1]);
  const pts = Array.from({ length: n + 1 }, (_, i) => { const t = ta + (tb - ta) * (i / n); return [r * Math.cos(t), zc + r * Math.sin(t)]; });
  pts[0] = [ends[0], 0]; pts[n] = [ends[1], 0];
  const section = [[-1, -1], [1, -1], [1, 0], ...pts, [-1, 0]];
  // Faces: 0 bottom, 1 side y = 1, 4 top z = 0, 5 bore, 6 side y = -1; caps 2 (x = 0) and 3 (x = 1).
  const faceOf = [0, 1, 4, ...pts.slice(1).map(() => 5), 4, 6];
  const { V, T, left } = prism(section, faceOf);
  const plane = (origin, normal) => ({ type: 'plane', origin, normal, x: Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0] });
  const bore = { type: 'cylinder', origin: [0, 0, zc], axis: [1, 0, 0], x: [0, 0, 1], radius: r };
  const faces = [plane([0, 0, -1], [0, 0, -1]), plane([0, 1, 0], [0, 1, 0]), plane([0, 0, 0], [-1, 0, 0]), plane([1, 0, 0], [1, 0, 0]), plane([0, 0, 0], [0, 0, 1]), bore, plane([0, -1, 0], [0, -1, 0])].map(surface => ({ surface }));
  // Move the bite's inner left-cap vertices past the edge.
  const inner = left.slice(4, 3 + n);
  for (const v of inner) {
    const [, y, z] = V[v], k = (r - b) / Math.hypot(y, z - zc);
    V[v] = [-a, y * k, zc + (z - zc) * k].map(Math.fround);
  }
  // The exact distance of a point past both faces from the circle.
  const off = p => Math.hypot(p[0], r - Math.hypot(p[1], p[2] - zc));
  let trueMax = 0;
  for (let i = 0; i + 1 < inner.length; i++) for (let s = 0; s <= 1; s += 1 / 64) trueMax = Math.max(trueMax, off(V[inner[i]].map((x, j) => x + s * (V[inner[i + 1]][j] - x))));
  const cornerMax = Math.max(...inner.map(v => off(V[v])));
  assert.ok(cornerMax < dev && trueMax > dev, `corners ${cornerMax}, edge interior ${trueMax}`);
  const snapped = snapMesh(kernel, { vertices: V, triangles: T }, faces, faces.map((_, i) => i), dev);
  assert.equal(snapped.refused, undefined, snapped.refused);
  // corefine's mesh as it is: claimed at least as far as its edge interior.
  assert.ok(snapped.unsnappedClaim >= trueMax, `unsnapped claim ${snapped.unsnappedClaim} < ${trueMax}`);
  // Snapped: the inner vertices moved onto the circle, the claim holds the deviation and covers the new chords.
  assert.ok(snapped.deviationMm <= dev, `stated ${snapped.deviationMm}`);
  let after = 0;
  const W = snapped.vertices;
  for (let i = 0; i + 1 < inner.length; i++) for (let s = 0; s <= 1; s += 1 / 64) {
    const p = W[inner[i]].map((x, j) => x + s * (W[inner[i + 1]][j] - x));
    if (Math.hypot(p[1], p[2] - zc) < r) after = Math.max(after, off(p));
  }
  assert.ok(after <= snapped.deviationMm, `snapped edge interior ${after} over the claim ${snapped.deviationMm}`);
});

test('curveCurvature: a plane meets a cylinder along its axis in a straight line; the curvature bound of a curved curve; curveSagitta', () => {
  const cyl = { type: 'cylinder', origin: [0, 0, 10], axis: [1, 0, 0], radius: 1.7 };
  assert.equal(curveCurvature({ type: 'plane', origin: [0, 0, 11.6], normal: [0, 0, 1] }, cyl, [0.3, Math.sqrt(1.7 ** 2 - 1.6 ** 2), 11.6]).k, 0);
  // Plane x = 0 and the same cylinder: the circle of radius 1.7.
  near(curveCurvature({ type: 'plane', origin: [0, 0, 0], normal: [1, 0, 0] }, cyl, [0, 0, 11.7]).k, 1 / 1.7, 1e-12);
  // Two perpendicular cylinders (KT1's rib r 0.45 and the r 1.7 cross hole): at most 1 / 0.45 + 1 / 1.7 over the sine.
  const k = curveCurvature({ type: 'cylinder', origin: [-2.4, 0, 0], axis: [0, 0, 1], radius: 0.45 }, cyl, [-2.4 + 0.45 * Math.cos(0.3), 0.45 * Math.sin(0.3), 10 + Math.sqrt(1.7 ** 2 - (0.45 * Math.sin(0.3)) ** 2)]);
  assert.ok(k.k > 2 && k.k <= (1 / 0.45 + 1 / 1.7) / k.sine + 1e-12, JSON.stringify(k));
  near(curveSagitta(1 / 2, 1), 2 - Math.sqrt(4 - 0.25), 1e-12);
  assert.equal(curveSagitta(0, 1), 0);
  assert.equal(curveSagitta(3, 1), Infinity);
});

test('wedgeDistance: 0 inside, the plane value where the projection stays inside, the edge distance past a sharp wedge', () => {
  const c = Math.cos(160 * Math.PI / 180), sine = Math.sin(160 * Math.PI / 180);
  assert.equal(wedgeDistance(-0.001, -0.002, c, sine), 0);
  // KT1's slot edge: on the floor, 0.00996 mm into the bore -> 0.031 mm.
  near(wedgeDistance(0, 0.00996, c, sine), 0.00996 / sine, 1e-12);
  // Outside a right-angle wedge on one side only: its plane value.
  assert.equal(wedgeDistance(0.004, -0.01, 0, 1), 0.004);
  // Tangent planes lie within the deviation of each other: no drift.
  assert.equal(wedgeDistance(0.005, 0.005, 0.999, Math.sqrt(1 - 0.999 ** 2)), 0);
});

}
