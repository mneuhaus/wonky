import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("proto-recover.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { spawnSync } = await import("node:child_process");
const { default: fs } = await import("node:fs");
const { default: os } = await import("node:os");
const { default: path } = await import("node:path");
const { fileURLToPath } = await import("node:url");
const { loadBend } = await import("../src/bend-loader.mjs");
const { loadKernel } = await import("../src/kernel.mjs");
const { build } = await import("../src/index.mjs");
const { validateAnalytic } = await import("../src/analytic.mjs");
const { decodeRecover, toBodies } = await import("../scripts/bakeoff/recover-brep.mjs");
const { ROUNDTRIP, roundTripParts, recoverText } = await import("../scripts/bakeoff/recover-roundtrip.mjs");
const { exportRecovered, occtCheck } = await import("../scripts/bakeoff/recover-check.mjs");
const { buildCase, ensureJobs } = await import("../scripts/bakeoff/fixtures.mjs");
const { decodeResult, encodeJob } = await import("../scripts/bakeoff/jobfmt.mjs");
// Focused tests of the hybrid's recovery stage "recover" (kernel/hybrid/recover):
// analytic B-rep recovery from a tagged mesh, run on the Bend JS target.
// Inputs are built here from exact kernel bodies (src/print-mesh.mjs with face
// tags); corpus Boolean inputs (manifold3d oracle dumps) are used only when
// `npm run bakeoff:reference` has produced them. OpenCascade checks run only
// when uv is available. Budget: well under 60 s.


















const root = fileURLToPath(new URL('../', import.meta.url));
const kernel = await loadKernel();
const recover = await loadBend(path.join(root, 'kernel/hybrid/recover/main.bend'));
const bodyOf = async (id) => (await ROUNDTRIP[id](kernel))[0];
const run = (parts) => recover.run(recoverText(parts));
const reason = (text) => {
  const d = decodeRecover(text);
  assert.equal(d.status, 'unresolved', `expected a refusal, got ${text.slice(0, 200)}`);
  return d.reason;
};

test('a pierced plate mesh recovers its exact B-rep: planes, one cylinder, circles and a seam', async () => {
  const body = await bodyOf('rt-plate-hole');
  const text = run(roundTripParts(kernel, body, 'plate'));
  const d = decodeRecover(text);
  assert.equal(d.status, 'ok', text.slice(0, 300));
  const [rec] = toBodies(d.raw, 'plate');
  rec.validation = validateAnalytic(rec, kernel);
  assert.deepEqual([rec.vertices.length, rec.edges.length, rec.faces.length], [10, 15, 7]);
  const cyl = rec.faces.find((f) => f.surface.type === 'cylinder');
  assert.equal(cyl.surface.radius, 4);
  assert.equal(cyl.sameSense, false, 'a bore faces its axis');
  assert.equal(cyl.loops.length, 1, 'the band is closed by a seam into one loop');
  const circles = d.raw.edges.filter((e) => e.curve.type === 'circle');
  assert.equal(circles.length, 2);
  for (const c of circles) assert.equal(c.curve.radius, 4);
  assert.equal(d.raw.edges.filter((e) => e.seam).length, 1);
  // Exact vertices: every vertex on its curves within the F32x2 residual.
  assert.ok(d.stats.maxVertexResidualMm < 1e-9);
  assert.ok(d.stats.maxDeviationOverBound <= 1);
});

test('revolved bodies recover cones and cylinders with their exact parameters', async () => {
  for (const id of ['rt-revolve-groove', 'rt-revolve-taper', 'rt-conical-spacer']) {
    const body = await bodyOf(id);
    const d = decodeRecover(run(roundTripParts(kernel, body, id)));
    assert.equal(d.status, 'ok', `${id}: ${d.reason}`);
    const [rec] = toBodies(d.raw, id);
    validateAnalytic(rec, kernel);
    const key = (s) => `${s.type} ${s.radius?.toFixed(12)} ${s.angle?.toFixed(12)}`;
    assert.deepEqual(rec.faces.map((f) => key(f.surface)).sort(), body.faces.map((f) => key(f.surface)).sort(), id);
    assert.equal(rec.faces.length, body.faces.length);
  }
});

test('multi-hole plates keep one exact circle pair and one seam per hole', async () => {
  const body = await bodyOf('rt-plate-9-holes');
  const d = decodeRecover(run(roundTripParts(kernel, body, 'p9')));
  assert.equal(d.status, 'ok', d.reason);
  const radii = d.raw.edges.filter((e) => e.curve.type === 'circle').map((e) => e.curve.radius).sort();
  const want = body.edges.filter((e) => e.curve?.type === 'circle').map((e) => e.curve.radius).sort();
  assert.deepEqual(radii, want);
  assert.equal(d.raw.edges.filter((e) => e.seam).length, 9);
  validateAnalytic(toBodies(d.raw, 'p9')[0], kernel);
});

test('a mis-wound triangle is refused, not repaired', async () => {
  const parts = roundTripParts(kernel, await bodyOf('rt-plate-hole'), 'flip');
  const t = parts.result.mesh.triangles[5];
  [t[0], t[1]] = [t[1], t[0]];
  assert.match(reason(run(parts)), /not a closed oriented 2-manifold|not clearly oriented/);
});

test('a triangle tagged with a carrier it does not lie on is refused', async () => {
  const parts = roundTripParts(kernel, await bodyOf('rt-plate-hole'), 'tag');
  const plane = parts.job.faces.findIndex((f) => f.surface.type === 'plane');
  const cyl = parts.job.faces.findIndex((f) => f.surface.type === 'cylinder');
  const tri = parts.result.mesh.triangles.find((x) => x[3] === cyl);
  tri[3] = plane;
  assert.match(reason(run(parts)), /off its carrier|not clearly oriented/);
});


test('malformed input and refused sources are reported, never guessed', async () => {
  assert.match(reason(recover.run('wonky-bakeoff-job 1\ncase x\n')), /malformed/);
  const parts = roundTripParts(kernel, await bodyOf('rt-box'), 'src');
  parts.result = { status: 'unresolved', reason: 'upstream refused' };
  assert.match(reason(run(parts)), /source mesh unresolved: upstream refused/);
});

// A second copy of a body in the same job: every vertex and carrier moved by
// p -> c + s (p - c) + d (test input construction only).
function withCopy(parts, { d = [0, 0, 0], s = 1, c = [0, 0, 0] }) {
  const map = (p) => p.map((x, i) => c[i] + s * (x - c[i]) + d[i]);
  const { job, result } = parts;
  const nf = job.faces.length, nv = result.mesh.vertices.length;
  for (let i = 0; i < nf; i++) {
    const surface = { ...job.faces[i].surface, o: map(job.faces[i].surface.o) };
    if (surface.r !== undefined) surface.r *= s;
    job.faces.push({ leaf: 0, faceIndex: nf + i, surface });
  }
  result.mesh.vertices.push(...result.mesh.vertices.slice(0, nv).map(map));
  result.mesh.triangles.push(...result.mesh.triangles.map(([a, b, cc, t]) => [a + nv, b + nv, cc + nv, t + nf]));
  return parts;
}

test('clearance: two tubes closer than the deviation allows are refused; apart they are two bodies', async () => {
  const tube = await bodyOf('rt-revolve-tube');
  // Outer radius 5: centres 10.005 apart leave a 0.005 mm gap between the
  // curved walls, below 2 x deviation (0.02 mm): the exact walls could touch.
  const near = run(withCopy(roundTripParts(kernel, tube, 'near'), { d: [10.005, 0, 0] }));
  assert.match(reason(near), /faces on a (plane|cylinder) and a (plane|cylinder) carrier come within 0\.00\d+ mm without sharing an edge or a vertex/);
  const far = decodeRecover(run(withCopy(roundTripParts(kernel, tube, 'far'), { d: [10.5, 0, 0] })));
  assert.equal(far.status, 'ok', far.reason);
  assert.equal(toBodies(far.raw, 'far').length, 2);
});

test('a solid shell inside another solid (overlapping bodies) is refused by the winding test', async () => {
  const box = await bodyOf('rt-box');
  const parts = roundTripParts(kernel, box, 'nested');
  const vs = parts.result.mesh.vertices;
  const c = [0, 1, 2].map((k) => (Math.min(...vs.map((p) => p[k])) + Math.max(...vs.map((p) => p[k]))) / 2);
  assert.match(reason(run(withCopy(parts, { s: 0.5, c }))), /solid shell .* lies inside other shells .*overlapping bodies/);
});

test('recovery is deterministic on the JS target', async () => {
  const text = recoverText(roundTripParts(kernel, await bodyOf('rt-revolve-groove'), 'det'));
  assert.equal(recover.run(text), recover.run(text));
});

// A four-centre oval of three-point arcs, extruded 5 mm: end arcs r 3 about
// (+-4.2, 0), side arcs R 10 about (0, -+5.6), joined at (+-6, +-2.4). Its
// side faces are cylinders on parallel axes that meet along generator lines
// through the joints. The joints lie on both circles; with lift 0 the arcs are
// tangent there. `lift` raises the upper arc's mid point (0, 4.4): it then
// crosses both end arcs at its joints under 6e-4 rad (lift 0.002), like the
// R20 tray profile's arcs, and a second time 0.005 mm away.
const oval = (lift) => `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export function part(context is Context, id is Id, definition is map)
{
    var s = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1)) });
    skArc(s, "top", { "start" : vector(6, 2.4) * millimeter, "mid" : vector(0, ${4.4 + lift}) * millimeter, "end" : vector(-6, 2.4) * millimeter });
    skArc(s, "left", { "start" : vector(-6, 2.4) * millimeter, "mid" : vector(-7.2, 0) * millimeter, "end" : vector(-6, -2.4) * millimeter });
    skArc(s, "bottom", { "start" : vector(-6, -2.4) * millimeter, "mid" : vector(0, -4.4) * millimeter, "end" : vector(6, -2.4) * millimeter });
    skArc(s, "right", { "start" : vector(6, -2.4) * millimeter, "mid" : vector(7.2, 0) * millimeter, "end" : vector(6, 2.4) * millimeter });
    skSolve(s);
    opExtrude(context, id + "oval", { "entities" : qSketchRegion(id + "s"), "direction" : vector(0, 0, 1),
        "endBound" : BoundingType.BLIND, "endDepth" : 5 * millimeter });
}`;
const ovalParts = async (lift) => roundTripParts(kernel, (await build(oval(lift), { feature: 'part' })).bodies[0], `oval${lift}`);
const joints = [0, 5].flatMap((z) => [[6, 2.4, z], [-6, 2.4, z], [-6, -2.4, z], [6, -2.4, z]]);

test('parallel cylinders meet in generator lines: tangent and grazing arc joints of a profile recover exactly', async () => {
  for (const lift of [0, 0.002]) {
    const d = decodeRecover(run(await ovalParts(lift)));
    assert.equal(d.status, 'ok', `lift ${lift}: ${d.reason}`);
    const { vertices, edges, faces } = d.raw;
    assert.deepEqual([vertices.length, edges.length, faces.length], [8, 12, 6], `lift ${lift}`);
    const lines = edges.filter((e) => e.curve.type === 'line');
    assert.equal(lines.length, 4, `lift ${lift}: one generator line per joint`);
    // Every vertex is a joint (the lines run through the shared end points,
    // not through the contact point of the nearly tangent circles).
    const nearest = vertices.map((v) => Math.min(...joints.map((j) => Math.hypot(v[0] - j[0], v[1] - j[1], v[2] - j[2]))));
    assert.ok(Math.max(...nearest) < 1e-9, `lift ${lift}: vertex ${Math.max(...nearest)} mm off its joint`);
    for (const e of lines) assert.ok(e.boundaryDeviationMm < 1e-9, `lift ${lift}: line edge ${e.boundaryDeviationMm} mm off the mesh`);
    validateAnalytic(toBodies(d.raw, `oval${lift}`)[0], kernel);
  }
});

test('a grazing joint whose mesh boundary does not pin one intersection line is refused by name', async () => {
  // Planted: the mesh corner at (6, 2.4, 5) moves 0.0018 mm toward the second
  // intersection line (0.7 of the way to the foot of the joint on the line of
  // centres (0, -5.590009) to (4.2, 0), 0.0026 mm away); it stays within 1e-6 mm
  // of both carriers and within the deviation of the joint line. The run
  // starts at the other corner, whose seed picks the joint line; the moved
  // corner leaves it by more than a quarter of the 0.0051 mm between the lines,
  // so the mesh does not decide which line is the edge.
  const parts = await ovalParts(0.002);
  const vs = parts.result.mesh.vertices;
  const k = vs.findIndex((v) => Math.hypot(v[0] - 6, v[1] - 2.4, v[2] - 5) < 1e-9);
  assert.ok(k >= 0);
  vs[k] = [6 + 0.7 * 0.002056318152269, 2.4 - 0.7 * 0.001544995053395, 5];
  assert.match(reason(run(parts)), /tangent carriers along an edge that is neither an exact tangent contact line nor pinned to one of two parallel intersection lines .*\[cylinder\/cylinder\]/);
});

// Two parallel r 5 cylinders 9.99 mm apart (a lens crossing at 5 degrees),
// joined into one recover input with the tangent oval 40 mm away.
const lensParts = async () => roundTripParts(kernel, (await build(`FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export function part(context is Context, id is Id, definition is map)
{
${[['p', 0], ['q', 9.99]].map(([n, x]) => `    var s${n} = newSketchOnPlane(context, id + "s${n}", { "sketchPlane" : plane(vector(${x}, 0, 0) * millimeter, vector(0, 0, 1)) });
    skCircle(s${n}, "c", { "center" : vector(0, 0) * millimeter, "radius" : 5 * millimeter });
    skSolve(s${n});
    opExtrude(context, id + "${n}", { "entities" : qSketchRegion(id + "s${n}"), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 10 * millimeter });`).join('\n')}
    opBoolean(context, id + "u", { "tools" : qUnion([qCreatedBy(id + "p", EntityType.BODY), qCreatedBy(id + "q", EntityType.BODY)]), "operationType" : BooleanOperationType.UNION });
}`, { feature: 'part' })).bodies[0], 'lens');
const joinParts = (first, second) => {
  const a = structuredClone(first), b = structuredClone(second), nv = a.result.mesh.vertices.length, nf = a.job.faces.length;
  const move = (p) => [p[0] + 40, p[1], p[2]];
  a.job.faces.push(...b.job.faces.map((f, i) => ({ ...f, faceIndex: i + nf, surface: { ...f.surface, o: move(f.surface.o) } })));
  const vertices = [...a.result.mesh.vertices, ...b.result.mesh.vertices.map(move)];
  const triangles = [...a.result.mesh.triangles, ...b.result.mesh.triangles.map(([x, y, z, t]) => [x + nv, y + nv, z + nv, t + nf])];
  a.result.mesh = { vertices, triangles };
  a.job.meshes = [{ leaf: 0, vertices, triangles }];
  return a;
};
const recoverClass = (parts) => recover.solve(recover.parse(recoverText(parts))).o;
const meshVertex = (parts, q) => parts.result.mesh.vertices.findIndex((v) => Math.hypot(v[0] - q[0], v[1] - q[1], v[2] - q[2]) < 1e-8);
// Planted: the lens corner (4.995, 0.2236, 10) moved 0.11 mm along -y.
const plantLensCorner = (lens) => {
  const k = meshVertex(lens, [9.99 / 2, Math.sqrt(25 - (9.99 / 2) ** 2), 10]);
  assert.ok(k >= 0);
  lens.result.mesh.vertices[k][1] -= 0.11;
  return lens;
};

test('a failed corner certificate refuses the mesh whatever tangent component the input also holds', async () => {
  // The oval's joints are decided by contact helpers; that relaxes their own
  // corners only. Planted: the lens corner (4.995, 0.2236, 10) moved 0.11 mm
  // along -y stays within 0.004 mm of both cylinders and the cap, but is
  // farther than its bound (10 x 0.01 mm) from the exact corner: BCert, alone
  // and with the oval before or after it.
  const oval0 = await ovalParts(0), lens = await lensParts();
  for (const parts of [lens, joinParts(oval0, lens), joinParts(lens, oval0)]) assert.equal(recoverClass(parts).$, 'BOk');
  plantLensCorner(lens);
  for (const [name, parts] of [['lens', lens], ['oval first', joinParts(oval0, lens)], ['oval last', joinParts(lens, oval0)]]) {
    const o = recoverClass(parts);
    assert.equal(o.$, 'BCert', `${name}: ${o.reason}`);
    assert.match(o.reason, /exact vertex is 0\.11 mm from the mesh/, name);
  }
});

test('a drifted helper-decided corner refuses only the exact recovery and masks no later certificate', async () => {
  // A slot (lines and r 3 end arcs, 5 mm high) whose caps are sheared to
  // oblique planes, z += 11 x: the side faces stay a plane tangent to a
  // cylinder, so the joint corners are decided by contact helpers. Planted:
  // the joint corner (5, 3, 60) moved 0.108 mm along z stays on both tangent
  // side faces and within 0.01 mm of the cap, but is 0.108 mm from the exact
  // corner (bound 10 x 0.01 mm): alone that refuses the exact recovery (BNo).
  // Joined with the lens whose corner is planted as above (BCert alone), the
  // lens certificate must still refuse the mesh, whichever body comes first.
  const slot = `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export function part(context is Context, id is Id, definition is map)
{
    var s = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1)) });
    skLineSegment(s, "a", { "start" : vector(-5, -3) * millimeter, "end" : vector(5, -3) * millimeter });
    skArc(s, "b", { "start" : vector(5, -3) * millimeter, "mid" : vector(8, 0) * millimeter, "end" : vector(5, 3) * millimeter });
    skLineSegment(s, "c", { "start" : vector(5, 3) * millimeter, "end" : vector(-5, 3) * millimeter });
    skArc(s, "d", { "start" : vector(-5, 3) * millimeter, "mid" : vector(-8, 0) * millimeter, "end" : vector(-5, -3) * millimeter });
    skSolve(s);
    opExtrude(context, id + "slot", { "entities" : qSketchRegion(id + "s"), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 5 * millimeter });
}`;
  const K = 11, Q = Math.sqrt(1 + K * K), shear = (p) => [p[0], p[1], p[2] + K * p[0]];
  const slotted = roundTripParts(kernel, (await build(slot, { feature: 'part' })).bodies[0], 'slot');
  for (const f of slotted.job.faces) {
    const s = f.surface, z = s.n[2];
    if (s.type !== 'plane' || Math.abs(z) < 0.5) continue;
    s.o = shear(s.o);
    s.n = [-K * z / Q, 0, z / Q];
  }
  slotted.result.mesh.vertices = slotted.result.mesh.vertices.map(shear);
  const j = meshVertex(slotted, [5, 3, 5 + 5 * K]);
  assert.ok(j >= 0);
  slotted.result.mesh.vertices[j][2] += 0.108;
  slotted.job.meshes = [{ leaf: 0, ...slotted.result.mesh }];
  const alone = recoverClass(slotted);
  assert.equal(alone.$, 'BNo', alone.reason);
  assert.match(alone.reason, /exact vertex is 0\.108 mm from the mesh .*decided by a contact line; exact recovery refused/);
  const lens = plantLensCorner(await lensParts());
  for (const [name, parts] of [['slot first', joinParts(slotted, lens)], ['lens first', joinParts(lens, slotted)]]) {
    const o = recoverClass(parts);
    assert.equal(o.$, 'BCert', `${name}: ${o.reason}`);
    assert.match(o.reason, /exact vertex is 0\.11 mm from the mesh/, name);
  }
});

// Tangent joints of an extruded profile whose top edges are chamfered 0.5 mm
// (45 degrees): the oval's arcs give chamfer cones on parallel axes tangent
// along a common generator; a slot (two lines, two arcs) gives chamfer planes
// through the cones' apexes, tangent along one too. At the joint's top vertex
// the three carriers (cap, two chamfers) have dependent normals: the vertex
// is decided by the contact generator (the R20 return plate, item 2).
const chamferedTop = (sketch) => `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export function part(context is Context, id is Id, definition is map)
{
    var s = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1)) });
${sketch}
    skSolve(s);
    opExtrude(context, id + "x", { "entities" : qSketchRegion(id + "s"), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 5 * millimeter });
    opChamfer(context, id + "c", { "entities" : qCoincidesWithPlane(qOwnedByBody(qCreatedBy(id + "x", EntityType.BODY), EntityType.EDGE), plane(vector(0, 0, 5) * millimeter, vector(0, 0, 1))),
        "chamferType" : ChamferType.EQUAL_OFFSETS, "width" : 0.5 * millimeter });
}`;
const tangentJoints = {
  cone: oval(0).split('\n').filter((l) => l.includes('skArc')).join('\n'),
  plane: `    skLineSegment(s, "a", { "start" : vector(-5, -3) * millimeter, "end" : vector(5, -3) * millimeter });
    skArc(s, "b", { "start" : vector(5, -3) * millimeter, "mid" : vector(8, 0) * millimeter, "end" : vector(5, 3) * millimeter });
    skLineSegment(s, "c", { "start" : vector(5, 3) * millimeter, "end" : vector(-5, 3) * millimeter });
    skArc(s, "d", { "start" : vector(-5, 3) * millimeter, "mid" : vector(-8, 0) * millimeter, "end" : vector(-5, -3) * millimeter });`,
};
const chamferedParts = async (kind) => {
  const body = (await build(chamferedTop(tangentJoints[kind]), { feature: 'part' })).bodies.at(-1);
  return { body, parts: roundTripParts(kernel, body, `chamfer-${kind}`) };
};

test('chamfer cones tangent to a cone or a plane along a generator: contact lines and their vertices recover exactly', async () => {
  for (const kind of ['cone', 'plane']) {
    const { body, parts } = await chamferedParts(kind);
    const d = decodeRecover(run(parts));
    assert.equal(d.status, 'ok', `${kind}: ${d.reason}`);
    assert.deepEqual([d.raw.vertices.length, d.raw.faces.length], [body.vertices.length, body.faces.length], kind);
    // The four joints' chamfer edges: lines between a cone face and a `kind` face.
    const type = (f) => d.raw.faces[f].surface.type;
    const facesOf = new Map();
    d.raw.faces.forEach((f, i) => f.loops.flat().forEach((u) => facesOf.set(u.edge, [...(facesOf.get(u.edge) ?? []), i])));
    const joints = d.raw.edges.filter((e, i) => e.curve.type === 'line' && facesOf.get(i).map(type).sort().join('/') === ['cone', kind].sort().join('/'));
    assert.equal(joints.length, 4, kind);
    const nearest = d.raw.vertices.map((v) => Math.min(...body.vertices.map((w) => Math.hypot(v[0] - w[0], v[1] - w[1], v[2] - w[2]))));
    assert.ok(Math.max(...nearest) < 1e-9, `${kind}: a vertex ${Math.max(...nearest)} mm off the body's`);
    validateAnalytic(toBodies(d.raw, `chamfer-${kind}`)[0], kernel);
  }
});

test('a carrier moved 1e-10 or 1e-4 mm off tangency gets no contact line: its joint vertex stays refused', async () => {
  // Planted: one carrier's radius grows (the mesh stays within the deviation
  // of it): a chamfer cone of the chamfered oval (against a cone) and slot
  // (against a plane), and the R 10 side cylinder of the oval, whose r 3 end
  // cylinders then lie strictly inside it. 1e-10 mm is far above the wire
  // band of these carriers (2^-44 x 10 mm, 5.7e-13 mm) and below any absolute
  // contact tolerance of 1e-9 mm: the carriers have no common line, so no
  // helper decides the joint vertex and recovery refuses instead of inventing
  // a contact generator. The unmoved inputs recover exactly (the two tests
  // above).
  const grown = (parts, type, pick) => {
    const i = parts.job.faces.findIndex((f) => f.surface.type === type && pick(f.surface));
    assert.ok(i >= 0, type);
    return (delta) => {
      const job = { ...parts.job, faces: parts.job.faces.map((f, j) => (j === i ? { ...f, surface: { ...f.surface, r: f.surface.r + delta } } : f)) };
      return { ...parts, job };
    };
  };
  const cases = [
    ...await Promise.all(['cone', 'plane'].map(async (kind) => [kind, grown((await chamferedParts(kind)).parts, 'cone', () => true)])),
    ['cylinder', grown(await ovalParts(0), 'cylinder', (s) => s.r > 9)],
  ];
  for (const [kind, moved] of cases) {
    for (const delta of [1e-10, 1e-4]) assert.match(reason(run(moved(delta))), /degenerate vertex, carriers dependent/, `${kind} + ${delta}`);
  }
});

// Corpus Boolean results (manifold3d with face provenance), when present.
const dump = (id) => path.join(root, 'out/bakeoff/oracle-manifold', `${id}.result`);
const corpus = (id) => fs.readFileSync(ensureJobs([id])[id].job, 'utf8') + fs.readFileSync(dump(id), 'utf8');
const haveDumps = ['plate-through-hole', 'tilted-holes-17deg', 'r10b-g10-union', 'pipe-tee'].every((id) => fs.existsSync(dump(id)));

test('corpus Booleans: exact recovery where the curves are analytic, named refusal where not', { skip: !haveDumps && 'run npm run bakeoff:reference first' }, () => {
  const tilted = decodeRecover(recover.run(corpus('tilted-holes-17deg')));
  assert.equal(tilted.status, 'ok', tilted.reason);
  assert.equal(tilted.raw.edges.filter((e) => e.curve.type === 'ellipse').length, 8, 'oblique holes meet the plate in ellipses');
  const r10b = decodeRecover(recover.run(corpus('r10b-g10-union')));
  assert.equal(r10b.status, 'ok', r10b.reason);
  for (const b of toBodies(r10b.raw, 'r10b')) validateAnalytic(b, kernel);
  assert.match(reason(recover.run(corpus('pipe-tee'))), /cylinder\/cylinder intersection .* quartic/);
});

const haveSpheres = ['sphere-minus-box', 'torus-minus-box', 'internal-void'].every((id) => fs.existsSync(dump(id)));

test('sphere caps, torus bands and inner void shells recover exactly', { skip: !haveSpheres && 'run npm run bakeoff:reference first' }, () => {
  const cap = decodeRecover(recover.run(corpus('sphere-minus-box')));
  assert.equal(cap.status, 'ok', cap.reason);
  const sphere = cap.raw.faces.find((f) => f.surface.type === 'sphere');
  assert.equal(sphere.surface.radius, 10);
  assert.equal(sphere.loops.length, 1, 'a cap is bounded by its rim only');
  const [rim] = cap.raw.edges;
  assert.equal(rim.curve.type, 'circle');
  assert.ok(Math.abs(rim.curve.radius - Math.sqrt(91)) < 1e-12, 'plane z = -3 cuts the r = 10 sphere in a circle of radius sqrt(91)');
  assert.ok(Math.abs(Math.abs(sphere.surface.axis[2]) - 1) < 1e-12, 'the cap frame axis is the rim normal');
  const torus = decodeRecover(recover.run(corpus('torus-minus-box')));
  assert.equal(torus.status, 'ok', torus.reason);
  const radii = torus.raw.edges.filter((e) => !e.seam).map((e) => e.curve.radius).sort((a, b) => a - b);
  assert.deepEqual(radii, [9, 15], 'the plane through the torus centre cuts circles of radius R - r and R + r');
  const seam = torus.raw.edges.find((e) => e.seam);
  assert.equal(seam.curve.type, 'circle', 'the torus band seam is a meridian arc');
  assert.equal(seam.curve.radius, 3);
  assert.ok(Math.abs(seam.curveRange[1] - seam.curveRange[0] - Math.PI) < 1e-12, 'a half tube: the seam arc spans pi');
  const voided = decodeRecover(recover.run(corpus('internal-void')));
  assert.equal(voided.status, 'ok', voided.reason);
  const [body] = toBodies(voided.raw, 'void');
  assert.equal(body.shell.faces.length, 6);
  assert.equal(body.voids?.length, 1, 'the inner box is a void shell of the same solid');
  assert.equal(body.voids[0].faces.length, 6);
});

// Extra recover cases (scripts/bakeoff/recover-extra.mjs), when generated.
const extra = (id) => path.join(root, 'out/bakeoff/recover/extra', id);
const haveExtra = ['x-tube-window', 'x-boss-slot', 'x-torus-tilted'].every((id) => fs.existsSync(extra(`results/${id}.result`)));
const extraRun = (id) => recover.run(fs.readFileSync(extra(`jobs/${id}.job`), 'utf8') + fs.readFileSync(extra(`results/${id}.result`), 'utf8'));

test('periodic faces with holes and rims with vertices keep their loops; spiric sections are refused', { skip: !haveExtra && 'run node scripts/bakeoff/recover-extra.mjs first' }, () => {
  const win = decodeRecover(extraRun('x-tube-window'));
  assert.equal(win.status, 'ok', win.reason);
  const walls = win.raw.faces.filter((f) => f.surface.type === 'cylinder');
  assert.deepEqual(walls.map((f) => f.loops.length), [3, 3], 'two rims and the window, no seam (kernel convention)');
  assert.equal(win.raw.edges.filter((e) => e.seam).length, 0);
  const slot = decodeRecover(extraRun('x-boss-slot'));
  assert.equal(slot.status, 'ok', slot.reason);
  const band = slot.raw.faces.find((f) => f.surface.type === 'cylinder');
  assert.deepEqual(band.loops.map((l) => l.length).sort((a, b) => a - b), [1, 8], 'a plain bottom rim and a notched top rim');
  assert.match(reason(extraRun('x-torus-tilted')), /spiric/);
});

// Verifier-derived inputs (scripts/bakeoff/recover-adversarial.mjs copies
// them into out/bakeoff/recover/adversarial/inputs), when present.
const adv = (id) => path.join(root, 'out/bakeoff/recover/adversarial/inputs', `${id}.recover.job`);
const advIds = ['adv2-sphere-void', 'adv2-cone-sphere-rotated', 'adv2-torus-rotated-half', 'adv-hole-breaks-top-within-dev', 'adv-boss-pokes-within-dev', 'mut2-void-reversed'];
const haveAdv = advIds.every((id) => fs.existsSync(adv(id)));
const advRun = (id) => recover.run(fs.readFileSync(adv(id), 'utf8'));

test('verifier cases: full sphere void, cone rim blister, half torus; refusals below the tolerance', { skip: !haveAdv && 'run node scripts/bakeoff/recover-adversarial.mjs first' }, () => {
  const ball = decodeRecover(advRun('adv2-sphere-void'));
  assert.equal(ball.status, 'ok', ball.reason);
  const [body] = toBodies(ball.raw, 'void');
  assert.equal(body.voids?.length, 1);
  const sphere = ball.raw.faces.find((f) => f.surface.type === 'sphere');
  assert.equal(sphere.loops.length, 1, 'a full sphere: one loop of its meridian seam used twice');
  assert.equal(sphere.loops[0].length, 2);
  const seam = ball.raw.edges.find((e) => e.seam);
  assert.ok(Math.abs(seam.curveRange[1] - seam.curveRange[0] - Math.PI) < 1e-12, 'pole to pole');
  const cone = decodeRecover(advRun('adv2-cone-sphere-rotated'));
  assert.equal(cone.status, 'ok', cone.reason);
  assert.ok(cone.stats.slivers > 0, 'the cone rim blisters poking through the sphere tessellation are absorbed');
  const half = decodeRecover(advRun('adv2-torus-rotated-half'));
  assert.equal(half.status, 'ok', half.reason);
  const hseam = half.raw.edges.find((e) => e.seam);
  assert.equal(hseam.curve.radius, 15, 'the band between two meridians is closed by an outer-equator arc (R + r)');
  // A bore 0.005 mm from breaking the top face; a boss 0.005 mm wider than its
  // bar: leaf tessellations closer than the deviation that never touch, and no
  // result edge between the two faces: refused before any recovery work.
  assert.match(reason(advRun('adv-hole-breaks-top-within-dev')), /come within 0\.00\d+ mm \(clearance 0\.010001 mm\) without touching/);
  assert.match(reason(advRun('adv-boss-pokes-within-dev')), /come within 0\.00\d+ mm \(clearance 0\.010001 mm\) without touching/);
  assert.match(reason(advRun('mut2-void-reversed')), /overlapping bodies/);
});

// Plan step 2 (docs/hybrid-boolean-plan.md): no silent topology below the
// deviation. Jobs are the verifier's cases (fixtures/bakeoff/adversarial-
// recover.json) tessellated by the harness; the result meshes are what a mesh
// Boolean returns when its tessellations miss a crossing the exact faces have.
const advCases = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/bakeoff/adversarial-recover.json'), 'utf8')).cases;
const advJob = (id, edit) => {
  const c = structuredClone(advCases.find((x) => x.id === id));
  edit?.(c);
  return buildCase(c).job;
};
const leafMesh = (job, leaf) => {
  const m = job.meshes.find((x) => x.leaf === leaf);
  return { vertices: m.vertices, triangles: m.triangles };
};
const recoverOf = (job, mesh) => recover.run(recoverText({ job, result: { status: 'ok', mesh } }));

test('near contacts below the deviation are refused by name at any tilt, for cones and crossed rods too', () => {
  // The tool misses the target's tessellation, so the mesh Boolean returns
  // the untouched target: its face contributes nothing to the result.
  for (const id of ['adv4-cyl-shave-tilt-1e-8rad', 'adv3-cyl-plane-shave-tilt-1e-5rad', 'adv3-cone-side-shave']) {
    const job = advJob(id);
    assert.match(reason(recoverOf(job, leafMesh(job, 0))), /carrier \(the carriers of tags \d+ and \d+\) come within 0\.00\d+ mm \(clearance 0\.010001 mm\) without touching, and one of them contributes no triangle to the result/, id);
  }
  const rods = advJob('adv3-crossed-cyl-graze');
  assert.match(reason(recoverOf(rods, leafMesh(rods, 0))), /leaf faces on a cylinder carrier and a cylinder carrier .* without touching/);
  // The exact intersection is a 0.005 mm shaving; the mesh one is empty.
  const cap = advJob('adv3-cyl-plane-shave-tilt-intersect');
  assert.match(reason(recoverOf(cap, { vertices: [], triangles: [] })), /^the result is empty although leaf faces on a cylinder carrier and a plane carrier .* without touching/);
  // Control: the same tool face 0.5 mm away is no near contact.
  const far = advJob('adv4-cyl-shave-tilt-1e-8rad', (c) => { c.csg.children[1].params.min[0] = 5.5; });
  const d = decodeRecover(recoverOf(far, leafMesh(far, 0)));
  assert.equal(d.status, 'ok', d.reason);
  assert.equal(d.raw.faces.length, 3);
});

// A closed tagged mesh of a convex polyhedron: per face (outward normal n,
// tag) the vertices on its supporting plane, fanned counter-clockwise.
function convexMesh(vertices, faces) {
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const sub = (a, b) => a.map((x, i) => x - b[i]);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const triangles = [];
  for (const { n, tag } of faces) {
    const top = Math.max(...vertices.map((p) => dot(n, p)));
    const on = vertices.map((p, i) => i).filter((i) => dot(n, vertices[i]) > top - 1e-9);
    const c = [0, 1, 2].map((k) => on.reduce((s, i) => s + vertices[i][k], 0) / on.length);
    const u = sub(vertices[on[0]], c), v = cross(n, u);
    on.sort((i, j) => Math.atan2(dot(sub(vertices[i], c), v), dot(sub(vertices[i], c), u)) - Math.atan2(dot(sub(vertices[j], c), v), dot(sub(vertices[j], c), u)));
    for (let k = 1; k + 1 < on.length; k++) triangles.push([on[0], on[k], on[k + 1], tag]);
  }
  return { vertices, triangles };
}

test('a planar corner chip narrower than the deviation stays a face: no sliver absorption between planes', () => {
  // 2 mm cube minus a 0.09 mm corner chip at deviation 0.1: every point of the
  // chip lies within the deviation of its three neighbour planes.
  const job = advJob('adv4-planar-chip-dev0.1');
  const chip = job.faces.findIndex((f) => f.leaf === 1 && f.surface.n.every((x) => x < 0));
  const { o, n } = job.faces[chip].surface;
  const level = n[0] * o[0] + n[1] * o[1] + n[2] * o[2];
  const at = (k) => { const p = [2, 2, 2]; p[k] = 2 + (level - (n[0] + n[1] + n[2]) * 2) / n[k]; return p; };
  const corners = [];
  for (const x of [0, 2]) for (const y of [0, 2]) for (const z of [0, 2]) if (x + y + z < 6) corners.push([x, y, z]);
  const faces = [...job.faces.slice(0, 6).map((f, tag) => ({ n: f.surface.n, tag })), { n: n.map((x) => -x), tag: chip }];
  const d = decodeRecover(recoverOf(job, convexMesh([...corners, at(0), at(1), at(2)], faces)));
  assert.equal(d.status, 'ok', d.reason);
  assert.equal(d.raw.faces.length, 7, 'the chip is a face of its own');
  assert.equal(d.stats.slivers, 0);
  validateAnalytic(toBodies(d.raw, 'chip')[0], kernel);
});

test('a mesh that touches itself at one vertex is refused by recovery itself (vertex-link check)', async () => {
  // Two boxes corner to corner sharing one vertex: every edge has its twin,
  // but the link of the shared vertex is two cycles.
  const parts = roundTripParts(kernel, await bodyOf('rt-box'), 'touch');
  const vs = parts.result.mesh.vertices;
  const lo = [0, 1, 2].map((k) => Math.min(...vs.map((p) => p[k]))), hi = [0, 1, 2].map((k) => Math.max(...vs.map((p) => p[k])));
  const nv = vs.length;
  withCopy(parts, { d: hi.map((x, k) => x - lo[k]) });
  const key = (p) => p.join(',');
  const shared = vs.findIndex((p, i) => i < nv && key(p) === key(hi));
  const copy = vs.findIndex((p, i) => i >= nv && key(p) === key(hi));
  for (const t of parts.result.mesh.triangles) for (let k = 0; k < 3; k++) if (t[k] === copy) t[k] = shared;
  vs[copy] = [1000, 1000, 1000]; // now unused
  assert.match(reason(run(parts)), /touches itself at a point: 1 extra vertex-link cycles/);
});

// Plan step 4 (carrier unification): corefine decides rotated coplanar faces
// of two leaves as coplanar when their plane carriers agree within
// 2^-44*scale (kernel/hybrid/unify.bend); recover states that decision.
const epCases = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/bakeoff/adversarial-exact-plane.json'), 'utf8')).cases;
const epJob = (id) => buildCase(epCases.find((x) => x.id === id)).job;

test('rotated flush pocket and touching union: exact B-rep, the unified class stated in the output', async () => {
  const corefine = await loadBend(path.join(root, 'kernel/hybrid/corefine/main.bend'));
  for (const id of ['adv-ep2-sweep-pocket-3', 'adv-ep2-sweep-touch-union-5']) {
    const job = epJob(id);
    const text = encodeJob(job);
    const mesh = corefine.run(text);
    const d = decodeRecover(recover.run(text + mesh));
    assert.equal(d.status, 'ok', `${id}: ${d.reason}`);
    assert.equal(d.raw.faces.length, 11, `${id}: 5 + 1 + 5 faces, no sliver`);
    assert.equal(d.stats.unifiedClasses, 1, id);
    assert.equal(d.stats.unifiedToleranceMm, 2 ** -39, `${id}: 2^-44 * scale 32`);
    validateAnalytic(toBodies(d.raw, id)[0], kernel);
    // Recovery's own refusals in such a job name the tolerance too.
    const bad = decodeResult(mesh).mesh;
    const [a, b, c, tag] = bad.triangles[0];
    bad.triangles[0] = [a, c, b, tag];
    assert.match(reason(recoverOf(job, bad)), /; coplanar plane carriers unified within 2\^-44\*scale \(1 classes\)$/, id);
  }
  // Without a unified class the record is absent.
  assert.equal(decodeRecover(run(roundTripParts(kernel, await bodyOf('rt-plate-hole'), 'plate'))).stats.unifiedClasses, undefined);
});

// Regression (hybrid gate fix#1 and fix#2): planes that really are apart (a
// sealed void under a skin) are not unified: exact axis-aligned planes 2e-11
// mm apart, a tilted face 1e-11 mm under a tilted face (not axis-aligned),
// and a rotated block's top 1e-11 mm over a rotated pocket (400x the
// rounding). The hybrid never writes the one-shell B-rep of the opened
// pocket: recover either rebuilds both shells or refuses by name, and states
// no unification.
test('a sealed void under a 1e-11 or 2e-11 mm skin: no unified class, never a one-shell B-rep', async () => {
  const corefine = await loadBend(path.join(root, 'kernel/hybrid/corefine/main.bend'));
  const cases = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/bakeoff/adversarial-corefine.json'), 'utf8')).cases;
  for (const id of ['adv-skin-void-2e-11', 'adv-skin-void-prism-tilted-1e-11', 'adv-skin-void-rot-1e-11']) {
    const text = encodeJob(buildCase(cases.find((x) => x.id === id)).job);
    const d = decodeRecover(recover.run(text + corefine.run(text)));
    if (d.status === 'ok') {
      assert.equal(d.stats.unifiedClasses, undefined, id);
      assert.equal(toBodies(d.raw, 'skin').length, 1, id);
      assert.equal(new Set(d.raw.faces.map((x) => x.shell)).size, 2, `${id}: block and sealed void`);
    } else {
      assert.equal(d.status, 'unresolved', id);
      assert.doesNotMatch(d.reason, /unified/, id);
    }
  }
});

// Regression (hybrid gate fix#2): a plane tilted 5e-4 along a rod, 0.005 to
// 0.015 mm inside its surface, crosses the rod's facets only where z < 12,
// and a third operand removes z < 12. The exact result keeps a flat strip on
// z in [12, 20]; the mesh result is a plain facetted cylinder segment. The
// leaf tessellations of the (plane, cylinder) pair do cross, but only in the
// removed half, and the result's cylinder faces lie within the deviation of
// the plane: refused by name. Control: a transversal cut removed the same way
// leaves the rod far from the cut plane and recovers exactly.
test('a grazing plane whose crossings a third operand removed is refused; a removed transversal cut is exact', async () => {
  const corefine = await loadBend(path.join(root, 'kernel/hybrid/corefine/main.bend'));
  const graze = encodeJob(advJob('adv-graze-crossing-removed'));
  assert.match(reason(recover.run(graze + corefine.run(graze))), /^leaf faces on a cylinder carrier and a plane carrier \(the carriers of tags \d+ and \d+\) cross only where the result does not keep them, and the result's faces on one of them come within [0-9.e-]+ mm of the other's leaf faces \(clearance 0\.010001 mm\) without touching them or an edge between them/);
  const cut = encodeJob(advJob('adv-transversal-crossing-removed'));
  const d = decodeRecover(recover.run(cut + corefine.run(cut)));
  assert.equal(d.status, 'ok', d.reason);
  assert.equal(d.raw.faces.length, 3, 'cylinder band and two caps');
  validateAnalytic(toBodies(d.raw, 'cut')[0], kernel);
});

const suiteDir = path.join(root, 'out/bakeoff/judge2/suites/adv-recover');
const haveSuite = ['adv4-cone-tip-dimple'].every((id) => fs.existsSync(path.join(suiteDir, 'results', `${id}.result`)));

test('a cone tip narrower than the deviation is refused with its area, not absorbed as a sliver', { skip: !haveSuite && 'needs the adv-recover suite (scripts/bakeoff/suite.mjs)' }, () => {
  const text = fs.readFileSync(path.join(suiteDir, 'jobs/adv4-cone-tip-dimple.job'), 'utf8') + fs.readFileSync(path.join(suiteDir, 'results/adv4-cone-tip-dimple.result'), 'utf8');
  assert.match(reason(recover.run(text)), /sliver absorption would delete a patch of 0\.6\d+ mm2, more than deviation x its perimeter/);
});

const haveUv = spawnSync('uv', ['--version']).status === 0;

test('a recovered sphere cap is exact under OpenCascade (recover STEP serializer)', { skip: (!haveUv || !haveSpheres) && 'needs uv and the oracle dumps' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wonky-recover-'));
  try {
    const out = await exportRecovered(recover.run(corpus('sphere-minus-box')), 'cap', path.join(dir, 'cap'), kernel);
    assert.equal(out.serializer, 'recover-stepx (sphere/torus)');
    const [o] = await occtCheck([path.join(dir, 'cap.step')]);
    assert.ok(o.valid, JSON.stringify(o));
    const exact = Math.PI * (2 * 1000 / 3 + 100 * 3 - 27 / 3); // sphere r=10 above z=-3: pi (2R^3/3 + R^2 h - h^3/3), h = 3
    assert.ok(Math.abs(o.volume - exact) / exact < 1e-12, `${o.volume} vs ${exact}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('recovered STEP is exact under OpenCascade (volume vs the original body)', { skip: !haveUv && 'uv not available' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wonky-recover-'));
  try {
    const body = await bodyOf('rt-revolve-groove');
    const text = run(roundTripParts(kernel, body, 'groove'));
    const out = await exportRecovered(text, 'groove', path.join(dir, 'groove'), kernel);
    assert.equal(out.status, 'ok');
    const [o] = await occtCheck([path.join(dir, 'groove.step')]);
    assert.ok(o.valid, JSON.stringify(o));
    assert.ok(Math.abs(o.volume - body.validation.volumeMm3) / body.validation.volumeMm3 < 1e-12, `${o.volume} vs ${body.validation.volumeMm3}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

}
