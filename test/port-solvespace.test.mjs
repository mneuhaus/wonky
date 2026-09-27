import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend() || missing("kernel/ports/solvespace-bsp.bend", "kernel/ports/solvespace.bend");
if (publicTreeSkip) {
  test("port-solvespace.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { mkdirSync, writeFileSync } = await import("node:fs");
const { loadBend } = await import("../src/bend-loader.mjs");
const { loadKernel, extrudeInBend, array, list } = await import("../src/kernel.mjs");
const { classificationInput } = await import("../src/face-classification.mjs");
const { circularFrustumInBend, decodeAnalytic } = await import("../src/analytic.mjs");
const { vector, real, number, coords } = await import("../src/real.mjs");
const { intersectionTolerance } = await import("../src/intersections.mjs");
const { toStep } = await import("../src/exporters.mjs");











const kernel = await loadKernel();
const port = await loadBend(new URL('../kernel/ports/solvespace.bend', import.meta.url));
const bsp = await loadBend(new URL('../kernel/ports/solvespace-bsp.bend', import.meta.url));
const frame = { origin: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0] };
const profiles = {
  box: [[0, 0], [8, 0], [8, 6], [0, 6]],
  L: [[0, 0], [8, 0], [8, 2], [3, 2], [3, 6], [0, 6]],
  U: [[0, 0], [8, 0], [8, 8], [6, 8], [6, 2], [2, 2], [2, 8], [0, 8]],
};
const body = name => extrudeInBend(kernel, name, profiles[name], frame, [0, 0, 4]);
const input = name => classificationInput(body(name), kernel.faceClassifier);
const near = (a, b, eps = 1e-8) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} != ${b}`);
const clip = (source, origin, normal, options = {}) => {
  const before = structuredClone(source);
  const result = port.clip(source.solid, source.domains ?? list([]), origin.$ ? origin : vector(origin), normal.$ ? normal : vector(normal), intersectionTolerance(options), real(options.sourceBudget ?? 0));
  assert.deepEqual(source, before, 'native inputs remain unchanged');
  return result;
};
const volume = solid => number(kernel.real.div(kernel.halfspace.volume(kernel.halfspace.polygons(solid.faces, solid.edges), solid.vertices, vector([0, 0, 0])), real(6)));
const out = new URL('../out/boolean-ports/solvespace/', import.meta.url);
mkdirSync(out, { recursive: true });
function complete(result, expected, name) {
  assert.equal(result.$, 'Clipped', JSON.stringify(result));
  near(volume(result.solid), expected);
  const decoded = decodeAnalytic(result.solid, name ?? 'test', kernel);
  assert.equal(decoded.validation.closed, true);
  assert.equal(array(result.face_origins).length, decoded.faces.length);
  assert.equal(array(result.edge_origins).length, decoded.edges.length);
  assert.equal(array(result.domains).length, decoded.edges.length);
  assert.ok(array(result.domains).every(d => d.$ === 'GivenDomain' && d.domain.$ === 'Interval'));
  assert.ok(decoded.edges.every(e => e.curve.type === 'line'));
  assert.ok(decoded.faces.every(f => f.surface.type === 'plane'));
  if (name) {
    decoded.validation.volumeMm3 = volume(result.solid);
    decoded.validation.scope += '; signed volume from native planar boundary integral';
    const model = { schema: 'wonky-brep/1', units: 'millimeter', backend: { language: 'Bend', precision: 'F32x2' }, bodies: [decoded] };
    writeFileSync(new URL(`${name}.brep.json`, out), JSON.stringify(model, null, 2) + '\n');
    writeFileSync(new URL(`${name}.step`, out), toStep(model, name));
  }
  return decoded;
}

test('SolveSpace-adapted oriented BSP classifies nonconvex faces and collinear extensions', () => {
  for (const [name, points] of Object.entries(profiles)) {
    const segments = list(points.map((a, i) => ({ $: 'Segment', a: vector([...a, 0]), b: vector([...points[(i + 1) % points.length], 0]) })));
    const tree = bsp.from_segments(segments, vector([0, 0, 1]), real(1e-11));
    for (const [point, expected] of [
      [[1, 1, 0], 1], [[-1, 1, 0], 0], [[0, 1, 0], 2],
      [[4, 4, 0], name === 'box' ? 1 : 0],
      [[4, 2, 0], name === 'box' ? 1 : 2],
    ]) assert.equal(bsp.classify(tree, vector(point), vector([0, 0, 1]), real(1e-11)), expected, `${name}: ${point}`);
  }
});

test('BSP classification disagreement remains unknown instead of choosing one branch', () => {
  const tree = { $: 'Node', a: vector([0, 0, 0]), b: vector([1, 0, 0]), same: list([]),
    positive: { $: 'Leaf', inside: true }, negative: { $: 'Leaf', inside: false } };
  assert.equal(bsp.classify(tree, vector([2, 0, 0]), vector([0, 0, 1]), real(1e-11)), 3);
});

test('SolveSpace port constructs a complete closed half-box with original face and edge mapping', () => {
  const source = input('box'), result = clip(source, [4, 0, 0], [1, 0, 0]);
  const decoded = complete(result, 96, 'half-box');
  assert.deepEqual([decoded.vertices.length, decoded.edges.length, decoded.faces.length], [8, 12, 6]);
  assert.equal(array(result.face_origins).filter(o => o.$ === 'CutFace').length, 1);
  assert.equal(array(result.edge_origins).filter(o => o.$ === 'CutEdge').length, 4);
  for (const origin of array(result.face_origins)) if (origin.$ === 'SourceFace') assert.ok(origin.index < 6);
  for (const origin of array(result.edge_origins)) if (origin.$ === 'SourceEdge') assert.ok(origin.index < 12);
});

test('nonconvex L and U profiles keep their notches and produce shared closed caps', () => {
  complete(clip(input('L'), [4, 0, 0], [1, 0, 0]), 80, 'L-trim');
  complete(clip(input('L'), [0, 3, 0], [0, -1, 0]), 36, 'L-upper');
  complete(clip(input('U'), [0, 4, 0], [0, 1, 0]), 96, 'U-trim');
  complete(clip(input('U'), [4, 0, 0], [1, 0, 0]), 80, 'U-left');
});

test('transverse, exact vertex and exact edge cuts produce regularized solids', () => {
  const source = input('box');
  complete(clip(source, [3, 0, 0], [1, 1, 1]), 4.5, 'tetrahedron');
  complete(clip(source, [0, 0, 0], [1, 1, -1]), 64 / 6, 'vertex-tetrahedron');
  complete(clip(source, [0, 0, 0], [1, -1, 0]), 72, 'edge-wedge');
  complete(clip(input('L'), [3, 0, 0], [1, 0, 0]), 72, 'L-reflex-contact');
});

test('empty, face-touch, vertex-touch and unchanged clips are genuine terminal results', () => {
  const source = input('box');
  for (const [o, n] of [[[-1, 0, 0], [1, 0, 0]], [[0, 0, 0], [1, 0, 0]], [[0, 0, 0], [1, 1, 1]]]) assert.equal(clip(source, o, n).$, 'Empty');
  for (const o of [[8, 0, 0], [9, 0, 0]]) complete(clip(source, o, [1, 0, 0]), 192);
});

test('a disconnected U-profile result is explicit Unresolved, never one false Clipped solid', () => {
  const result = clip(input('U'), [0, 4, 0], [0, -1, 0]);
  assert.equal(result.$, 'Unresolved'); assert.equal(result.reason.$, 'UnsupportedArrangement');
  assert.equal(result.solid, undefined);
});

test('native output intervals support repeated clips without source mutation', () => {
  let result = clip(input('L'), [4, 0, 0], [1, 0, 0]);
  complete(result, 80);
  result = clip(result, [0, 3, 0], [0, 1, 0]); complete(result, 44);
  result = clip(result, [0, 0, 2], [0, 0, 1]); complete(result, 22, 'chained-L');
});

test('explicit source line intervals are validated and retained edge senses can be reversed', () => {
  const source = input('box'), vs = array(source.solid.vertices), es = array(source.solid.edges);
  source.domains = list(es.map(e => ({ $: 'GivenDomain', domain: kernel.faceClassifier.auto_domain(e, vs[e.start], vs[e.end]).value })));
  complete(clip(source, [4, 0, 0], [1, 0, 0]), 96);
  const reversed = structuredClone(source);
  reversed.solid.edges = list(es.map(e => ({ ...e, start: e.end, end: e.start, same_sense: !e.same_sense })));
  for (const face of array(reversed.solid.faces)) for (const loop of array(face.loops)) for (const use of array(loop.uses)) use.forward = !use.forward;
  complete(clip(reversed, [4, 0, 0], [1, 0, 0]), 96);
  const invalid = structuredClone(source); invalid.domains.head.domain.last = real(500);
  assert.equal(clip(invalid, [4, 0, 0], [1, 0, 0]).$, 'Unresolved');
  source.domains = list([{ $: 'AutoDomain' }]);
  assert.equal(clip(source, [4, 0, 0], [1, 0, 0]).reason.$, 'UnsupportedDomain');
});

test('native rigid transforms preserve clipped volumes and analytic representations', () => {
  const rotation = { $: 'Rotation', x: vector([0.8, 0, -0.6]), y: vector([0, 1, 0]), z: vector([0.6, 0, 0.8]) };
  const offset = vector([17, -31, 59]);
  for (const [name, expected] of [['box', 96], ['L', 80]]) {
    const source = input(name); source.solid = kernel.analytic.transform(source.solid, rotation, offset);
    const origin = kernel.analytic.point_transform(vector([4, 0, 0]), rotation, offset);
    const normal = kernel.precise.rotate(vector([1, 0, 0]), rotation);
    complete(clip(source, origin, normal), expected, `rotated-${name}`);
  }
});

test('known-volume axis and simplex cases cover deterministic perturbations', () => {
  const source = input('box');
  for (let i = 1; i <= 12; i++) {
    const h = (i + 0.25) / 4;
    complete(clip(source, [0, 0, h], [0, 0, 1]), 48 * h);
    complete(clip(source, [h, 0, 0], [1, 1, 1]), h ** 3 / 6);
  }
});

test('curved surfaces, holes, tolerant sources and uncertain contact stay unsupported', () => {
  const curved = circularFrustumInBend(kernel, 'round', { center: [0, 0], radius: 3, plane: frame }, null, [0, 0, 4]);
  assert.equal(clip(classificationInput(curved, kernel.faceClassifier), [1, 0, 0], [1, 0, 0]).reason.$, 'UnsupportedSurface');
  const holes = input('box');
  holes.solid.faces.head.loops = list([...array(holes.solid.faces.head.loops), { ...holes.solid.faces.head.loops.head, outer: false }]);
  assert.equal(clip(holes, [4, 0, 0], [1, 0, 0]).reason.$, 'UnsupportedArrangement');
  assert.equal(clip(input('box'), [4, 0, 0], [1, 0, 0], { sourceBudget: 0.0003 }).reason.$, 'SourceTolerance');
  assert.equal(clip(input('box'), [1e-9, 0, 0], [1, 0, 0]).reason.$, 'AmbiguousContact');
  for (const options of [{ linear: 0 }, { angular: 0 }, { angular: 1e-14 }]) assert.equal(clip(input('box'), [4, 0, 0], [1, 0, 0], options).reason.$, 'InvalidInput');
  assert.equal(clip(input('box'), [4, 0, 0], [0, 0, 0]).reason.$, 'InvalidInput');
});

test('a rounded-zero plane evaluation cannot manufacture an exact vertex contact', () => {
  const e = 2 ** -40;
  const impostor = extrudeInBend(kernel, 'impostor', [[1, 0], [2, 0], [2, 1], [1, 1]], frame, [0, 0, 1]);
  const q = 1n << 40n;
  assert.equal(q * (q - (2n * q + 2n)) + (q + 1n) ** 2n, 1n);
  assert.equal(clip(classificationInput(impostor, kernel.faceClassifier), [2 + 2 * e, -(1 + e), 0], [1, 1 + e, 0]).reason.$, 'AmbiguousContact');
});

test('invalid native topology, geometry and original orientation cannot produce a body', () => {
  const candidates = [];
  let source = input('box'); source.solid.faces = list(array(source.solid.faces).slice(1)); candidates.push(source);
  source = input('box'); source.solid.edges.head.start = 999; candidates.push(source);
  source = input('box'); source.solid.faces.head.same_sense = false; candidates.push(source);
  source = input('box'); source.solid.faces.head.surface.x = vector([0, 0, 1]); candidates.push(source);
  source = input('box'); source.solid.vertices.head.x = { $: 'Real', hi: NaN, lo: 0 }; candidates.push(source);
  for (const candidate of candidates) for (const origin of [[4, 0, 0], [9, 0, 0], [-1, 0, 0]]) {
    const result = clip(candidate, origin, [1, 0, 0]);
    assert.equal(result.$, 'Unresolved'); assert.equal(result.solid, undefined);
  }
});

}
