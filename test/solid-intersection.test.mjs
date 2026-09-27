import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("solid-intersection.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { mkdirSync, writeFileSync, readFileSync } = await import("node:fs");
const { loadKernel, extrudeInBend, array } = await import("../src/kernel.mjs");
const { circularFrustumInBend } = await import("../src/analytic.mjs");
const { intersectWithHybrid, decodeIntersection } = await import("../src/solid-intersection.mjs");
const { toStep } = await import("../src/exporters.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");
const { booleanPortCases } = await import("../scripts/boolean-port-cases.mjs");
const { build } = await import("../src/index.mjs");
const { transformAnalytic } = await import("../src/analytic.mjs");
const { clipWithPort, decodePortResult } = await import("../src/boolean-ports.mjs");













const k = await loadKernel();
const frame = { origin: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0] };
const prism = (points, height = 4) => extrudeInBend(k, 'source', points, frame, [0, 0, height]);
const box = (lo, hi) => extrudeInBend(k, 'tool', [[lo[0], lo[1]], [hi[0], lo[1]], [hi[0], hi[1]], [lo[0], hi[1]]],
  { ...frame, origin: [0, 0, lo[2]] }, [0, 0, hi[2] - lo[2]]);
const cylinder = () => circularFrustumInBend(k, 'cylinder', { center: [0, 0], radius: 3, plane: frame }, null, [0, 0, 4]);
const volume = body => {
  const ref = body.vertices[0], d = p => p.map((x, i) => x - ref[i]);
  let result = 0;
  for (const face of body.faces) for (const loop of face.loops) {
    const points = loop.map(use => d(body.vertices[body.edges[use.edge][use.forward ? 'start' : 'end']]));
    const a = points[0];
    for (let i = 1; i < points.length - 1; i++) {
      const b = points[i], c = points[i + 1];
      result += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    }
  }
  return result;
};
const artifact = new URL('../out/boolean-ports/solid-intersection/', import.meta.url);
mkdirSync(artifact, { recursive: true });
function save(bodies, name) {
  const model = { schema: 'wonky-brep/1', units: 'millimeter', backend: { language: 'Bend', version: '2.0.25' }, bodies };
  writeFileSync(new URL(`${name}.brep.json`, artifact), JSON.stringify(model, null, 2) + '\n');
  writeFileSync(new URL(`${name}.step`, artifact), toStep(model, name));
}

test('native solid intersection clips a concave source by every tool plane, in either operand order', async () => {
  const source = prism([[0, 0], [8, 0], [8, 2], [3, 2], [3, 6], [0, 6]]), tool = box([-1, -1, 1], [9, 7, 3]);
  const before = JSON.stringify([source, tool]);
  for (const operands of [[source, tool], [tool, source]]) {
    const result = await intersectWithHybrid(...operands), bodies = await decodeIntersection(result);
    assert.equal(bodies.length, 1); assert.ok(Math.abs(volume(bodies[0]) - 56) < 1e-8);
    for (const body of bodies) for (const ref of body.construction.faceOrigins) {
      assert.equal(ref.$, 'FaceRef'); assert.ok(ref.operand === 0 || ref.operand === 1);
      assert.ok(ref.index < operands[ref.operand].faces.length);
      const surface = operands[ref.operand].faces[ref.index].surface;
      const actual = body.faces[body.construction.faceOrigins.indexOf(ref)].surface;
      assert.ok(actual.origin.every((v, i) => v === surface.origin[i]));
      assert.ok(actual.normal.every((v, i) => v === surface.normal[i]));
    }
    save(bodies, operands[0] === source ? 'concave' : 'concave-reversed');
  }
  assert.equal(JSON.stringify([source, tool]), before);
});

test('components survive remaining tool planes with original face and edge references', async () => {
  const source = prism([[0, 0], [8, 0], [8, 6], [6, 6], [6, 2], [2, 2], [2, 6], [0, 6]]);
  const tool = box([-1, 3, 1], [9, 7, 3]);
  const result = await intersectWithHybrid(source, tool), bodies = await decodeIntersection(result);
  assert.equal(bodies.length, 2);
  assert.ok(Math.abs(bodies.reduce((sum, b) => sum + volume(b), 0) - 24) < 1e-8);
  for (const body of bodies) {
    assert.ok(body.construction.edgeOrigins.some(ref => ref.$ === 'FaceIntersection'));
    for (const ref of body.construction.edgeOrigins) if (ref.$ === 'OriginalEdge') assert.ok(ref.index < [source, tool][ref.operand].edges.length);
  }
  save(bodies, 'components');
});

test('complete cylindrical bands accept all six tool planes and subsequent intersections', async () => {
  const source = cylinder(), tool = box([-5, -5, 1], [5, 5, 3]);
  const result = await intersectWithHybrid(source, tool), bodies = await decodeIntersection(result);
  assert.equal(bodies.length, 1); assert.equal(bodies[0].faces.length, 3);
  assert.deepEqual(bodies[0].vertices.map(p => p[2]).sort(), [1, 3]);
  save(bodies, 'cylinder');
  const next = await intersectWithHybrid(bodies[0], box([-5, -5, 1.5], [5, 5, 2.5]));
  const decoded = await decodeIntersection(next);
  assert.equal(decoded.length, 1); assert.deepEqual(decoded[0].vertices.map(p => p[2]).sort(), [1.5, 2.5]);
  save(decoded, 'cylinder-chain');
});

test('a later unresolved tool plane rejects the entire intersection after earlier successful cuts', async () => {
  const result = await intersectWithHybrid(cylinder(), box([-5, -5, -1], [5, 2, 3]));
  assert.equal(result.$, 'Unresolved'); assert.ok(result.face > 0);
  assert.equal(result.bodies, undefined); assert.equal(result.solid, undefined);
  await assert.rejects(decodeIntersection(result), UnsupportedFeatureError);
});

test('native sequences return exact emptiness and reject malformed sources and unsupported tools', async () => {
  const source = cylinder();
  assert.equal(array((await intersectWithHybrid(source, box([-5, -5, 6], [5, 5, 8]))).bodies).length, 0);
  const open = structuredClone(source); open.faces.pop();
  assert.equal((await intersectWithHybrid(open, box([-5, -5, 1], [5, 5, 3]))).$, 'Unresolved');
  assert.equal((await intersectWithHybrid(source, cylinder())).$, 'Unresolved');
  const flat = (await booleanPortCases({ imported: false })).find(c => c.id === 'zero-volume-shell').body;
  const valid = box([-1, -1, 0], [3, 3, 4]);
  for (const pair of [[flat, valid], [valid, flat]]) {
    const result = await intersectWithHybrid(...pair);
    assert.equal(result.$, 'Unresolved'); assert.equal(result.bodies, undefined);
  }
});

test('contact-created explicit intervals remain valid for subsequent transverse tool planes', async () => {
  const source = box([0, 0, 0], [8, 6, 4]), tool = box([-1, -1, 0], [9, 7, 2]);
  for (const pair of [[source, tool], [tool, source]]) {
    const result = await intersectWithHybrid(...pair), bodies = await decodeIntersection(result);
    assert.equal(bodies.length, 1); assert.ok(Math.abs(volume(bodies[0]) - 96) < 1e-8);
    save(bodies, pair[0] === source ? 'contact-chain' : 'contact-chain-reversed');
  }
});

test('ordinary FeatureScript evaluates chained concave intersections with native mass and lineage', async () => {
  const model = await build(readFileSync(new URL('../examples/concave-intersection.fs', import.meta.url), 'utf8'));
  assert.equal(model.bodies.length, 1);
  const body = model.bodies[0];
  assert.equal(body.construction.method, 'native Bend convex-tool intersection');
  assert.equal(body.validation.volumeMm3, 40);
  assert.deepEqual(body.validation.boundsMm, { min: [1, 0, 1], max: [7, 6, 3] });
  assert.ok(body.identity.lineage.history.length > 0);
  save(model.bodies, 'featurescript-chain');
  const moved = transformAnalytic(k, body, 'moved', [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [10, 20, 30]);
  assert.equal(moved.validation.volumeMm3, 40);
  assert.deepEqual(moved.validation.boundsMm, { min: [11, 20, 31], max: [17, 26, 33] });
  save([moved], 'featurescript-moved');
});

test('a prior clipped convex body remains usable as a tool with its explicit intervals', async () => {
  const source = prism([[0, 0], [8, 0], [8, 2], [3, 2], [3, 6], [0, 6]]);
  const raw = await clipWithPort('occt', box([-1, -1, 0], [9, 7, 4]), { origin: [0, 0, 2], normal: [0, 0, 1] });
  const [tool] = await decodePortResult(raw, 'occt');
  assert.ok(tool.edges.some(edge => edge.curveRange));
  for (const pair of [[source, tool], [tool, source]]) {
    const result = await intersectWithHybrid(...pair), [body] = await decodeIntersection(result);
    assert.equal(body.validation.volumeMm3, 56);
  }
  const invalid = structuredClone(tool); invalid.edges[0].curveRange = [1e4, 1e4 + 1];
  const rejected = await intersectWithHybrid(source, invalid);
  assert.equal(rejected.$, 'Unresolved'); assert.equal(rejected.bodies, undefined);
});

}
