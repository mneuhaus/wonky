import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("solid-classification.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { loadKernel, extrudeInBend } = await import("../src/kernel.mjs");
const { vector } = await import("../src/real.mjs");
const { loadFaceClassifier, classificationInput } = await import("../src/face-classification.mjs");
const { classifySolid, requireResolvedSolidClassification } = await import("../src/solid-classification.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");
const { readFileSync } = await import("node:fs");
const { build } = await import("../src/index.mjs");










const plane = { origin: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0] };
const box = (k, lo = [0, 0, 0], hi = [8, 6, 4]) => extrudeInBend(k, 'box',
  [[lo[0], lo[1]], [hi[0], lo[1]], [hi[0], hi[1]], [lo[0], hi[1]]],
  { ...plane, origin: [0, 0, lo[2]] }, [0, 0, hi[2] - lo[2]]);
async function expect(body, point, kind, options) {
  const result = await classifySolid(body, point, options);
  assert.equal(result.$, kind, JSON.stringify({ point, result }));
  if (kind === 'Inside' || kind === 'Outside') assert.ok(result.rays >= 2);
  return result;
}

test('closed box membership distinguishes finite faces, material and all boundary dimensions', async () => {
  const body = box(await loadKernel()), original = JSON.stringify(body);
  for (const x of [-1, 0.25, 4, 7.75, 9]) for (const y of [-1, 0.25, 3, 5.75, 7]) {
    await expect(body, [x, y, 2], x > 0 && x < 8 && y > 0 && y < 6 ? 'Inside' : 'Outside');
  }
  for (const point of [[4, 3, -1], [4, 3, 5], [100, 100, 100], [-4, 3, 0]]) await expect(body, point, 'Outside');
  for (const point of [[4, 3, 0], [0, 3, 2], [8, 3, 2], [4, 6, 2], [0, 0, 2], [0, 0, 0], [8, 6, 4]]) {
    const result = await expect(body, point, 'Boundary');
    assert.ok(result.face >= 0 && result.face < body.faces.length);
  }
  assert.equal(JSON.stringify(body), original);
});

test('concave solid membership follows its notch rather than a box or an infinite surface', async () => {
  const k = await loadKernel();
  const body = extrudeInBend(k, 'L', [[0, 0], [8, 0], [8, 2], [3, 2], [3, 6], [0, 6]], plane, [0, 0, 4]);
  for (const x of [0.5, 2.5, 3.5, 7.5, 8.5]) for (const y of [0.5, 1.5, 2.5, 5.5, 6.5]) {
    await expect(body, [x, y, 2], x < 8 && y < 6 && (x < 3 || y < 2) ? 'Inside' : 'Outside');
  }
  await expect(body, [3, 4, 2], 'Boundary');
  await expect(body, [5, 2, 2], 'Boundary');
  await expect(body, [3, 2, 4], 'Boundary');
});

test('native rotated and translated closed boundaries preserve membership', async () => {
  const k = await loadKernel(), f = await loadFaceClassifier();
  const native = classificationInput(box(k), f).solid;
  const rotation = { $: 'Rotation', x: vector([0.8, 0, -0.6]), y: vector([0, 1, 0]), z: vector([0.6, 0, 0.8]) };
  const offset = vector([127, -31, 59]);
  const transformed = k.analytic.transform(native, rotation, offset);
  for (const [point, kind] of [[[4, 3, 2], 'Inside'], [[4, 3, 0], 'Boundary'], [[9, 3, 2], 'Outside'], [[0, 0, 0], 'Boundary']]) {
    await expect(transformed, k.analytic.point_transform(vector(point), rotation, offset), kind);
  }
});

function combineShells(first, second) {
  const body = structuredClone(first), vi = body.vertices.length, ei = body.edges.length;
  body.vertices.push(...second.vertices);
  body.edges.push(...second.edges.map(e => ({ ...e, start: e.start + vi, end: e.end + vi })));
  body.faces.push(...second.faces.map(f => ({ ...f, loops: f.loops.map(l => l.map(u => ({ ...u, edge: u.edge + ei }))) })));
  return body;
}

test('even/odd closed shell membership handles enclosed cavities and separated components', async () => {
  const k = await loadKernel(), outer = box(k), inner = box(k, [2, 2, 1], [6, 4, 3]);
  // Inward orientation on the cavity shell. No topology or geometry is inferred
  // from this body's old validation metadata; classification checks actual uses.
  for (const face of inner.faces) {
    face.surface.normal = face.surface.normal.map(n => -n);
    face.loops = face.loops.map(loop => loop.toReversed().map(use => ({ ...use, forward: !use.forward })));
  }
  const cavity = combineShells(outer, inner);
  await expect(cavity, [1, 3, 2], 'Inside');
  await expect(cavity, [4, 3, 2], 'Outside');
  await expect(cavity, [2, 3, 2], 'Boundary');
  await expect(cavity, [9, 3, 2], 'Outside');
  const separated = combineShells(outer, box(k, [12, 0, 0], [16, 6, 4]));
  for (const [point, kind] of [[[4, 3, 2], 'Inside'], [[10, 3, 2], 'Outside'], [[14, 3, 2], 'Inside']]) await expect(separated, point, kind);
});

test('invalid closure, unsupported surfaces and tolerance ambiguity remain explicit', async () => {
  const body = box(await loadKernel());
  const open = structuredClone(body); open.faces.pop();
  assert.equal((await expect(open, [4, 3, 2], 'Unresolved')).reason.$, 'InvalidTopology');
  const nonmanifold = structuredClone(body); nonmanifold.faces.push(structuredClone(body.faces[0]));
  assert.equal((await expect(nonmanifold, [4, 3, 2], 'Unresolved')).reason.$, 'InvalidTopology');
  const invalidIndex = structuredClone(body); invalidIndex.edges[0].start = 100;
  assert.equal((await expect(invalidIndex, [4, 3, 2], 'Unresolved')).reason.$, 'InvalidTopology');
  const wrongLoop = structuredClone(body); wrongLoop.faces.at(-1).loops[0].reverse();
  // Query lies on the first face: it cannot hide malformed later topology.
  assert.equal((await expect(wrongLoop, [4, 3, 0], 'Unresolved')).reason.$, 'FaceUnresolved');
  const cone = structuredClone(body); cone.faces[1].surface = { type: 'cone', origin: [0, 0, 0], axis: [0, 0, 1], x: [1, 0, 0], radius: 2, angle: 0.2 };
  assert.equal((await expect(cone, [30, 30, 30], 'Unresolved')).reason.$, 'UnsupportedSurface');
  await expect(body, [4, 3, 0.5e-7], 'Boundary');
  await expect(body, [4, 3, 1e-7], 'Unresolved');
  for (const options of [{ linear: 0 }, { angular: 1e-14 }, { inputTolerance: -1 }]) {
    assert.equal((await expect(body, [4, 3, 2], 'Unresolved', options)).reason.$, 'InvalidInput');
  }
  const unresolved = await classifySolid(open, [4, 3, 2]);
  assert.throws(() => requireResolvedSolidClassification(unresolved), UnsupportedFeatureError);
  const resolved = await classifySolid(body, [4, 3, 2]);
  assert.equal(requireResolvedSolidClassification(resolved), resolved);
});

test('cylindrical solids count trimmed wall and cap crossings, including an empty through bore', async () => {
  for (const [name, cases] of [
    ['compare-before', [[[0, 0, 5], 'Inside'], [[4, 0, 5], 'Inside'], [[6, 0, 5], 'Outside'], [[5, 0, 5], 'Boundary'], [[0, 0, 0], 'Boundary'], [[0, 0, -1], 'Outside']]],
    ['bored-spacer', [[[0, 0, 5], 'Outside'], [[3, 0, 5], 'Inside'], [[2, 0, 5], 'Boundary'], [[5, 0, 5], 'Boundary'], [[3, 0, 0], 'Boundary'], [[0, 0, 0], 'Outside']]],
  ]) {
    const source = readFileSync(new URL(`../examples/${name}.fs`, import.meta.url), 'utf8');
    const body = (await build(source)).bodies[0];
    for (const [point, kind] of cases) await expect(body, point, kind);
  }
});

}
