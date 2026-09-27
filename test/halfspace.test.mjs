import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("halfspace.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { mkdirSync, writeFileSync, readFileSync } = await import("node:fs");
const { loadKernel, extrudeInBend, array } = await import("../src/kernel.mjs");
const { loadFaceClassifier, classificationInput } = await import("../src/face-classification.mjs");
const { clipConvexSolid, intersectConvexSolids, decodeHalfspace, requireResolvedHalfspace } = await import("../src/halfspace.mjs");
const { number, vector } = await import("../src/real.mjs");
const { classifySolid } = await import("../src/solid-classification.mjs");
const { toStep } = await import("../src/exporters.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");
const { build } = await import("../src/index.mjs");
const { buildPython } = await import("../src/python.mjs");
const { circularFrustumInBend } = await import("../src/analytic.mjs");














const frame = { origin: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0] };
const box = (k, low = [0, 0, 0], high = [8, 6, 4]) => extrudeInBend(k, 'box',
  [[low[0], low[1]], [high[0], low[1]], [high[0], high[1]], [low[0], high[1]]],
  { ...frame, origin: [0, 0, low[2]] }, [0, 0, high[2] - low[2]]);
const plane = (origin, normal) => ({ origin, normal });
const near = (a, b, eps = 2e-10) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} differs from ${b}`);
async function decode(result, volume, name) {
  assert.equal(result.$, 'Solid', JSON.stringify(result));
  near(number(result.volume), volume);
  const [body] = decodeHalfspace(result, name, await loadKernel());
  assert.equal(body.validation.closed, true);
  assert.equal(body.vertices.length - body.edges.length + body.faces.length, 2);
  assert.equal(new Set(body.edges.flatMap(edge => [edge.start, edge.end])).size, body.vertices.length);
  if (name) {
    const root = new URL('../out/halfspace/', import.meta.url); mkdirSync(root, { recursive: true });
    const { version } = JSON.parse(readFileSync(new URL('../bend.lock.json', import.meta.url)));
    const model = { schema: 'wonky-brep/1', units: 'millimeter', backend: { language: 'Bend', version }, bodies: [body] };
    writeFileSync(new URL(`${name}.brep.json`, root), JSON.stringify(model, null, 2) + '\n');
    writeFileSync(new URL(`${name}.step`, root), toStep(model, name));
  }
  return body;
}

test('Bend halfspace clipping builds a closed shared cap and independently known mass properties', async () => {
  const body = box(await loadKernel()), original = JSON.stringify(body);
  const clipped = await decode(await clipConvexSolid(body, plane([4, 0, 0], [1, 0, 0])), 96, 'half-box');
  assert.deepEqual(clipped.validation.boundsMm, { min: [0, 0, 0], max: [4, 6, 4] });
  assert.deepEqual([clipped.vertices.length, clipped.edges.length, clipped.faces.length], [8, 12, 6]);
  for (const [point, kind] of [[[2, 2, 2], 'Inside'], [[6, 2, 2], 'Outside'], [[4, 2, 2], 'Boundary']]) {
    assert.equal((await classifySolid(clipped, point)).$, kind);
  }
  assert.equal(JSON.stringify(body), original);
});

test('oblique caps and exact source vertex/edge cuts produce complete tetrahedra', async () => {
  const body = box(await loadKernel());
  const tetrahedron = await decode(await clipConvexSolid(body, plane([3, 0, 0], [1, 1, 1])), 4.5, 'oblique-tetrahedron');
  assert.deepEqual([tetrahedron.vertices.length, tetrahedron.edges.length, tetrahedron.faces.length], [4, 6, 4]);
  await decode(await clipConvexSolid(body, plane([0, 0, 0], [1, 1, -1])), 64 / 6, 'vertex-tetrahedron');
  await decode(await clipConvexSolid(body, plane([0, 0, 0], [1, -1, 0])), 72, 'edge-wedge');
});

test('regularized empty, contained and touching intersections are genuine results', async () => {
  const k = await loadKernel(), body = box(k);
  for (const cutter of [plane([-1, 0, 0], [1, 0, 0]), plane([0, 0, 0], [1, 0, 0]), plane([0, 0, 0], [1, 1, 1])]) {
    assert.equal((await clipConvexSolid(body, cutter)).$, 'Empty');
  }
  await decode(await clipConvexSolid(body, plane([8, 0, 0], [1, 0, 0])), 192, 'unchanged');
  await decode(await intersectConvexSolids(body, body), 192, 'identical');
  await decode(await intersectConvexSolids(body, box(k, [1, 1, 1], [3, 4, 3])), 12, 'contained');
  assert.equal((await intersectConvexSolids(body, box(k, [8, 0, 0], [10, 6, 4]))).$, 'Empty');
  assert.equal((await intersectConvexSolids(body, box(k, [9, 0, 0], [10, 6, 4]))).$, 'Empty');
  assert.deepEqual(decodeHalfspace({ $: 'Empty' }, 'empty', k), []);
});

test('convex intersection results remain valid inputs for subsequent clipping', async () => {
  const k = await loadKernel(), a = box(k), b = box(k, [2, -1, 1], [10, 4, 8]);
  const ab = await decode(await intersectConvexSolids(a, b), 72, 'overlap');
  const ba = await decode(await intersectConvexSolids(b, a), 72);
  assert.deepEqual(ab.validation.boundsMm, ba.validation.boundsMm);
  const chained = await decode(await intersectConvexSolids(ab, box(k, [3, 1, 0], [7, 8, 3])), 24, 'chained');
  assert.deepEqual(chained.validation.boundsMm, { min: [3, 1, 1], max: [7, 4, 3] });
});

test('unchanged FeatureScript and Python Algebra use the same closed convex Boolean path', async () => {
  const source = `FeatureScript 3044; import(path:"onshape/std/geometry.fs",version:"3044.0");
export function main(context is Context, id is Id, definition is map) {
  fCuboid(context,id+"a",{"corner1":vector(0,0,0)*millimeter,"corner2":vector(8,6,4)*millimeter});
  fCuboid(context,id+"b",{"corner1":vector(2,-1,1)*millimeter,"corner2":vector(10,4,8)*millimeter});
  opBoolean(context,id+"ab",{"tools":qUnion([qCreatedBy(id+"a",EntityType.BODY),qCreatedBy(id+"b",EntityType.BODY)]),"operationType":BooleanOperationType.INTERSECTION});
  fCuboid(context,id+"c",{"corner1":vector(3,1,0)*millimeter,"corner2":vector(7,8,3)*millimeter});
  opBoolean(context,id+"abc",{"tools":qUnion([qCreatedBy(id+"ab",EntityType.BODY),qCreatedBy(id+"c",EntityType.BODY)]),"operationType":BooleanOperationType.INTERSECTION});
}`;
  const fs = await build(source);
  const py = await buildPython(`from build123d import *\na = Box(8,6,4,align=Align.MIN)\nb = Pos(2,-1,1)*Box(8,5,7,align=Align.MIN)\nc = Pos(3,1,0)*Box(4,7,3,align=Align.MIN)\nresult = a & b & c\nassert result.volume == 24\n`);
  for (const model of [fs, py]) {
    assert.equal(model.bodies.length, 1);
    near(model.bodies[0].validation.volumeMm3, 24);
    assert.ok(model.bodies[0].identity.lineage.history.length > 0);
    assert.deepEqual(model.bodies[0].validation.boundsMm, { min: [3, 1, 1], max: [7, 4, 3] });
    assert.match(toStep(model), /MANIFOLD_SOLID_BREP/);
  }
  const moved = await buildPython('from build123d import *\nresult = Pos(10,20,30)*(Box(8,6,4,align=Align.MIN) & Pos(2,-1,1)*Box(8,5,7,align=Align.MIN))\nassert result.volume == 72\n');
  assert.deepEqual(moved.bodies[0].validation.boundsMm, { min: [12, 20, 31], max: [18, 24, 34] });
});

test('convex clipping commutes with a native rigid transform on transverse cuts', async () => {
  const k = await loadKernel(), f = await loadFaceClassifier();
  const native = classificationInput(box(k), f).solid;
  const rotation = { $: 'Rotation', x: vector([0.8, 0, -0.6]), y: vector([0, 1, 0]), z: vector([0.6, 0, 0.8]) };
  const offset = vector([17, -31, 59]);
  const transformed = k.analytic.transform(native, rotation, offset);
  const origin = k.analytic.point_transform(vector([4, 0, 0]), rotation, offset);
  const normal = k.precise.rotate(vector([1, 0, 0]), rotation);
  const result = await clipConvexSolid(transformed, { origin, normal });
  await decode(result, 96, 'rotated');
});

test('independent box and simplex references cover many transverse cuts', async () => {
  const k = await loadKernel(), body = box(k);
  let seed = 715;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (let i = 0; i < 32; i++) {
    const height = 0.2 + random() * 3.6;
    const result = await clipConvexSolid(body, plane([0, 0, height], [0, 0, 1]));
    assert.equal(result.$, 'Solid'); near(number(result.volume), 48 * height);
    const intercept = 0.2 + random() * 3.6;
    const simplex = await clipConvexSolid(body, plane([intercept, 0, 0], [1, 1, 1]));
    assert.equal(simplex.$, 'Solid'); near(number(simplex.volume), intercept ** 3 / 6);
    for (const point of array(simplex.solid.vertices)) {
      near(number(point.x) + number(point.y) + number(point.z) > 1e-10 ?
        number(point.x) + number(point.y) + number(point.z) : intercept, intercept);
    }
  }
});

test('nonconvex, curved, tolerant, malformed and uncertain inputs never produce partial bodies', async () => {
  const k = await loadKernel(), body = box(k), cut = plane([4, 0, 0], [1, 0, 0]);
  const concave = extrudeInBend(k, 'L', [[0, 0], [8, 0], [8, 2], [3, 2], [3, 6], [0, 6]], frame, [0, 0, 4]);
  const open = structuredClone(body); open.faces.pop();
  const invalid = structuredClone(body); invalid.edges[0].start = 100;
  const flipped = structuredClone(body); flipped.faces[0].surface.normal = [0, 0, 1];
  const cylinder = circularFrustumInBend(k, 'round', { center: [0, 0], radius: 3, plane: frame }, null, [0, 0, 4]);
  for (const candidate of [concave, open, invalid, flipped, cylinder]) {
    const result = await clipConvexSolid(candidate, cut);
    assert.equal(result.$, 'Unresolved'); assert.equal(result.solid, undefined);
    assert.throws(() => requireResolvedHalfspace(result), UnsupportedFeatureError);
  }
  const uncertain = await clipConvexSolid(body, plane([1e-9, 0, 0], [1, 0, 0]));
  assert.equal(uncertain.reason.$, 'AmbiguousContact');
  const budget = await clipConvexSolid(body, cut, { inputTolerance: 0.0003 });
  assert.equal(budget.reason.$, 'SourceTolerance');
  for (const options of [{ linear: 0 }, { angular: 0 }, { angular: 1e-14 }]) {
    assert.equal((await clipConvexSolid(body, cut, options)).reason.$, 'InvalidInput');
  }
  assert.equal((await clipConvexSolid(body, plane([0, 0, 0], [0, 0, 0]))).reason.$, 'InvalidInput');
  await assert.rejects(clipConvexSolid(body, cut, { domains: [[0, 1]] }), UnsupportedFeatureError);
  const e = 2 ** -40, impostor = box(k, [1, 0, 0], [2, 1, 1]);
  // Exact n·(corner-origin) = e², independently nonzero on the integer grid.
  const q = 1n << 40n;
  assert.equal(q * (q - (2n * q + 2n)) + (q + 1n) ** 2n, 1n);
  assert.equal((await clipConvexSolid(impostor, plane([2 + 2 * e, -(1 + e), 0], [1, 1 + e, 0]))).reason.$, 'AmbiguousContact');
});

test('overlaid disconnected shells cannot masquerade as one convex solid with Euler characteristic two', async () => {
  const a = box(await loadKernel()), b = structuredClone(a);
  const map = b.vertices.map((_, i) => i < 2 ? i : a.vertices.length + i - 2), offset = a.edges.length;
  const doubled = { ...a, vertices: [...a.vertices, ...b.vertices.slice(2)],
    edges: [...a.edges, ...b.edges.map(e => ({ ...e, start: map[e.start], end: map[e.end] }))],
    faces: [...a.faces, ...b.faces.map(f => ({ ...f, loops: f.loops.map(l => l.map(u => ({ ...u, edge: u.edge + offset }))) }))] };
  assert.equal(doubled.vertices.length - doubled.edges.length + doubled.faces.length, 2);
  for (const origin of [[10, 0, 0], [4, 0, 0]]) {
    const result = await clipConvexSolid(doubled, plane(origin, [1, 0, 0]));
    assert.equal(result.$, 'Unresolved');
    assert.equal(result.reason.$, 'NonConvexOrInconsistent');
    assert.equal(result.solid, undefined);
  }
});

test('invalid source plane frames are rejected before clipping or canonicalization', async () => {
  const k = await loadKernel(), f = await loadFaceClassifier(), body = box(k);
  const native = classificationInput(body, f).solid;
  for (const x of [vector([0, 0, 1]), vector([1, 0, 0.01]), vector([0, 0, 0]),
    { ...vector([1, 0, 0]), x: { $: 'Real', hi: 0, lo: 1 } }]) {
    const bad = structuredClone(native);
    bad.faces.head.surface.x = x;
    for (const origin of [[10, 0, 0], [4, 0, 0], [-1, 0, 0]]) {
      const result = await clipConvexSolid(bad, plane(origin, [1, 0, 0]));
      assert.equal(result.$, 'Unresolved');
      assert.equal(result.reason.$, 'NonConvexOrInconsistent');
      assert.equal(result.solid, undefined);
    }
  }
  const scaled = structuredClone(body);
  for (const face of scaled.faces) {
    face.surface.normal = face.surface.normal.map(v => v * 3);
    face.surface.x = face.surface.x.map(v => v * 2);
  }
  await decode(await clipConvexSolid(scaled, plane([4, 0, 0], [2, 0, 0])), 96);
});

test('an extra collinear source vertex does not create a spurious zero-area face', async () => {
  const body = box(await loadKernel()), edge = body.edges[0];
  const midpoint = body.vertices.length, split = body.edges.length;
  body.vertices.push([4, 0, 0]);
  body.edges.push({ ...edge, start: midpoint });
  body.edges[0] = { ...edge, end: midpoint };
  for (const face of body.faces) face.loops = face.loops.map(loop => loop.flatMap(use => use.edge !== 0 ? [use] :
    use.forward ? [{ edge: 0, forward: true }, { edge: split, forward: true }] : [{ edge: split, forward: false }, { edge: 0, forward: false }]));
  await decode(await clipConvexSolid(body, plane([10, 0, 0], [1, 0, 0])), 192);
  const result = await decode(await clipConvexSolid(body, plane([0, 0, 0], [0, 1, -1])), 64, 'collinear-edge');
  for (const face of result.faces) {
    const ids = face.loops[0].map(use => result.edges[use.edge][use.forward ? 'start' : 'end']);
    assert.ok(ids.length >= 3);
  }
});

}
