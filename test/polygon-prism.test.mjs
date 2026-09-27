import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("polygon-prism.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { loadBend } = await import("../src/bend-loader.mjs");
const { array, list } = await import("../src/kernel.mjs");
const { coords, number, real, vector } = await import("../src/real.mjs");
// kernel/polygon-prism.bend in isolation (docs/polygon-prism.md). The float64
// arithmetic below is diagnosis only: it measures the F32x2 words the kernel
// returns; it constructs no geometry.






const kernelUrl = name => new URL(`../kernel/${name}`, import.meta.url);
const prism = await loadBend(kernelUrl('polygon-prism.bend'));
const precise = await loadBend(kernelUrl('precise.bend'));
const f32 = await loadBend(kernelUrl('topology.bend'));

const deg = Math.PI / 180;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => a.map(v => v * s);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => Math.sqrt(dot(a, a));
const normalize = a => mul(a, 1 / norm(a));
const words = r => [r.hi, r.lo];
const vecWords = v => [...words(v.x), ...words(v.y), ...words(v.z)];

// The cap origins are summed in binary64 and split once, as src/kernel.mjs prismInputs does.
function extrude(points, { origin = [0, 0, 0], normal = [0, 0, 1], x = [1, 0, 0], shift = [0, 0, 0], delta }) {
  const near = add(origin, shift);
  return prism.extrude(list(points.map(([u, v]) => vector([u, v, 0]))), vector(near), vector(normal), vector(x), vector(add(near, delta)));
}
function built(result) {
  assert.equal(result.$, 'Built', JSON.stringify(result.reason ?? result.$));
  return result;
}
function refusal(result) {
  assert.equal(result.$, 'Refused');
  return result.reason;
}
// The kernel solid decoded to float64: exact for F32x2 words (48 significand bits).
function decode(solid) {
  return {
    vertices: array(solid.vertices).map(coords),
    edges: array(solid.edges).map(({ start, end }) => [start, end]),
    faces: array(solid.faces).map(face => ({ origin: coords(face.origin), normal: coords(face.normal), x: coords(face.x),
      loop: array(face.boundary).map(({ edge, forward }) => ({ edge, forward })) })),
  };
}
const faceVertices = (body, face) => face.loop.map(({ edge, forward }) => body.edges[edge][forward ? 0 : 1]);
const scaleOf = body => Math.max(1, ...body.vertices.flat().map(Math.abs), ...body.faces.flatMap(f => f.origin.map(Math.abs)));
// Largest distance of a face's loop vertex from that face's carrier plane.
function worstIncidence(body) {
  let worst = 0;
  for (const face of body.faces) {
    const unit = normalize(face.normal);
    for (const v of faceVertices(body, face)) worst = Math.max(worst, Math.abs(dot(sub(body.vertices[v], face.origin), unit)));
  }
  return worst;
}
// Divergence theorem over fan triangles of each face loop; positive for outward loops.
function signedVolume(body) {
  let six = 0;
  for (const face of body.faces) {
    const ring = faceVertices(body, face).map(v => body.vertices[v]);
    for (let i = 1; i + 1 < ring.length; i++) six += dot(ring[0], cross(ring[i], ring[i + 1]));
  }
  return six / 6;
}
function checkClosed(body) {
  const uses = new Map();
  for (const face of body.faces) {
    const ring = faceVertices(body, face);
    face.loop.forEach(({ edge, forward }, i) => {
      const [a, b] = forward ? body.edges[edge] : [...body.edges[edge]].reverse();
      assert.equal(a, ring[i]);
      assert.equal(b, ring[(i + 1) % ring.length], 'face loop is not connected');
      uses.set(edge, (uses.get(edge) ?? 0) + (forward ? 1 : -1) * 10 + 1);
    });
  }
  // Every edge is used exactly twice, once in each direction.
  for (let e = 0; e < body.edges.length; e++) assert.equal(uses.get(e), 2, `edge ${e}`);
  assert.equal(body.vertices.length - body.edges.length + body.faces.length, 2);
}
function assertPrecise(result, label) {
  const body = decode(result.solid);
  checkClosed(body);
  const scale = scaleOf(body);
  const worst = worstIncidence(body);
  assert.ok(worst <= 1e-12 * scale, `${label}: vertex ${worst} mm off its carrier > 1e-12 x ${scale}`);
  assert.ok(number(result.required) <= number(result.allowance));
  // The kernel's own allowance is angular_guard x the result scale.
  assert.ok(Math.abs(number(result.allowance) - 1e-12 * scale) <= 1e-12 * scale * 1e-6, `${number(result.allowance)} vs ${1e-12 * scale}`);
  // The structural O(n) prism audit and the general indexed audit agree word for word.
  const again = built(prism.admit(result.solid));
  assert.deepEqual(words(again.required), words(result.required));
  return { body, worst, scale };
}
// Today's F32 path (kernel/topology.bend on kernel/geometry.bend), for the report only.
function f32Incidence(points, { origin = [0, 0, 0], normal = [0, 0, 1], x = [1, 0, 0], delta }, rotation) {
  const fv = ([a, b, c]) => ({ $: 'V3', x: Math.fround(a), y: Math.fround(b), z: Math.fround(c) });
  const frame = f32['geometry.frame'](fv(origin), fv(normal), fv(x));
  let solid = f32.extrude(f32['geometry.lift_points'](list(points.map(p => fv([...p, 0]))), frame), fv(delta));
  if (rotation) {
    const [columns, offset] = rotation;
    solid = f32.transform(solid, { $: 'Rotation', x: fv(columns[0]), y: fv(columns[1]), z: fv(columns[2]) }, fv(offset));
  }
  const f = v => [v.x, v.y, v.z];
  return worstIncidence({ vertices: array(solid.vertices).map(f), edges: array(solid.edges).map(({ start, end }) => [start, end]),
    faces: array(solid.faces).map(face => ({ origin: f(face.origin), normal: f(face.normal), loop: array(face.boundary) })) });
}

// fixtures/corpus-repro/boolean-invalid-topology/wedge-union.fs#slanted
const wedge = { points: [[0, 0], [10, 0], [0, 7]], frame: { delta: [0, 0, 5] } };
// fixtures/corpus-repro/kernel-sketch-and-ops/cap-normal-far-from-origin.fs
const footNormal = [-0.25, -Math.sqrt(3) / 4, Math.sqrt(3) / 2];
const far = add([77.1263837814323 - 100, -454.3231642470163, -320.2202765531271], mul(footNormal, 10));
const footFrame = origin => ({ origin, normal: footNormal, x: [Math.sqrt(3) / 2, -0.5, 0], delta: mul(footNormal, 6) });
const octagon = { points: [[-31.58, -10], [31.58, -10], [32, -9.58], [32, 9.58], [31.58, 10], [-31.58, 10], [-32, 9.58], [-32, -9.58]], frame: footFrame(far) };
const pocket = { points: [[-20.2, -3], [20.2, -3], [20.2, 3], [-20.2, 3]], frame: footFrame(sub(far, mul(footNormal, 0.1))) };
// fixtures/corpus-repro/boolean-invalid-topology/rotated-box-cut.fs: the 600 mm box and its opPattern pose.
const box = { points: [[0, 0], [600, 0], [600, 600], [0, 600]], frame: { origin: [-300, -300, 0], delta: [0, 0, 300] } };
const k = Math.tan(15 * deg);
const n = normalize([-k, -Math.tan(5 * deg), 1]);
const u = normalize([1, 0, k]);
const pose = { columns: [u, cross(n, u), n], offset: [0, 4, 121.03 - 90.2 * k] };
const rotation = columns => ({ $: 'Rotation', x: vector(columns[0]), y: vector(columns[1]), z: vector(columns[2]) });
// R10b_Print_Package r10b-uploaded-snapshot.fs buildTransferEdge nose (K15, noseLength 11 mm).
const railTop = 121.03 + (-93.3 - 90.2) * k;
const noseSweep = mul([1, Math.sin(25 * deg) * k, Math.cos(25 * deg) * k], 186.6);
const nose = { points: [[-3, -4], [11, -4], [11, 0], [-3, 0]],
  frame: { origin: [-93.3, Math.cos(25 * deg) * 4 + Math.sin(25 * deg) * railTop, 203 - Math.sin(25 * deg) * 4 + Math.cos(25 * deg) * railTop],
    normal: [1, 0, 0], x: [0, 1, 0], delta: noseSweep } };

test('an axis-aligned box keeps the topology.bend layout exactly', () => {
  const result = built(extrude([[0, 0], [10, 0], [10, 7], [0, 7]], { delta: [0, 0, 5] }));
  const { body } = assertPrecise(result, 'box');
  assert.deepEqual(body.vertices, [[0, 0, 0], [10, 0, 0], [10, 7, 0], [0, 7, 0], [0, 0, 5], [10, 0, 5], [10, 7, 5], [0, 7, 5]]);
  assert.deepEqual(body.faces.map(f => f.normal), [[0, 0, -1], [0, 0, 1], [0, -1, 0], [1, 0, 0], [0, 1, 0], [-1, 0, 0]]);
  assert.equal(number(result.required), 0);
  assert.equal(signedVolume(body), 350);
});

test('the slanted wedge has every vertex on its carriers', t => {
  const result = built(extrude(wedge.points, wedge.frame));
  const { body, worst, scale } = assertPrecise(result, 'wedge');
  assert.ok(Math.abs(signedVolume(body) - 175) <= 1e-12 * 175);
  t.diagnostic(`wedge: F32x2 ${worst.toExponential(2)} mm (bound ${(1e-12 * scale).toExponential(2)}), F32 path ${f32Incidence(wedge.points, wedge.frame).toExponential(2)} mm`);
});

test('the far tilted octagon and its key pocket have every vertex on their carriers', t => {
  for (const [label, { points, frame }, area] of [['octagon', octagon, 64 * 20 - 2 * 0.42 * 0.42], ['pocket', pocket, 40.4 * 6]]) {
    const result = built(extrude(points, frame));
    const { body, worst, scale } = assertPrecise(result, label);
    assert.ok(Math.abs(signedVolume(body) - 6 * area) <= 1e-9 * 6 * area, `${label} volume ${signedVolume(body)}`);
    t.diagnostic(`${label}: F32x2 ${worst.toExponential(2)} mm (bound ${(1e-12 * scale).toExponential(2)}), F32 path ${f32Incidence(points, frame).toExponential(2)} mm`);
  }
});

test('cap normals are the F32x2 image of +z under the sketch frame', () => {
  for (const { points, frame } of [octagon, pocket, wedge, nose]) {
    const result = built(extrude(points, frame));
    const f = precise.frame(vector(frame.origin ?? [0, 0, 0]), vector(frame.normal ?? [0, 0, 1]), vector(frame.x ?? [1, 0, 0]));
    const image = z => precise.rotate(vector([0, 0, z]), { $: 'Rotation', x: f.x, y: f.y, z: f.normal });
    const [bottom, top] = array(result.solid.faces);
    assert.deepEqual(vecWords(top.normal), vecWords(image(1)));
    assert.deepEqual(vecWords(bottom.normal), vecWords(image(-1)));
    // That image is the normalized plane normal itself, word for word.
    assert.deepEqual(vecWords(top.normal), vecWords(f.normal));
  }
});

test('the rotated 600 mm box copy has every vertex on its carriers', t => {
  const source = built(extrude(box.points, box.frame));
  assertPrecise(source, 'box');
  const result = built(prism.transform(source.solid, rotation(pose.columns), vector(pose.offset)));
  const { body, worst, scale } = assertPrecise(result, 'rotated box');
  assert.ok(Math.abs(signedVolume(body) - 600 ** 2 * 300) <= 1e-12 * 600 ** 2 * 300);
  t.diagnostic(`rotated box: F32x2 ${worst.toExponential(2)} mm (bound ${(1e-12 * scale).toExponential(2)}), F32 path ${f32Incidence(box.points, box.frame, [pose.columns, pose.offset]).toExponential(2)} mm`);
});

test('the oblique nose sweep builds with parallelogram sides', t => {
  const result = built(extrude(nose.points, nose.frame));
  const { body, worst, scale } = assertPrecise(result, 'nose');
  // Top vertex i is bottom vertex i plus the sweep.
  for (let i = 0; i < 4; i++) assert.ok(norm(sub(sub(body.vertices[i + 4], body.vertices[i]), noseSweep)) <= 1e-12 * scale);
  // Each side face is a parallelogram: its opposite edges are equal vectors.
  for (const face of body.faces.slice(2)) {
    const [a, b, c, d] = faceVertices(body, face).map(v => body.vertices[v]);
    assert.ok(norm(sub(sub(b, a), sub(c, d))) <= 1e-12 * scale);
    assert.ok(Math.abs(dot(normalize(face.normal), normalize(noseSweep))) <= 1e-12, 'side carrier contains the sweep');
  }
  // Cavalieri: profile area times the sweep component along the plane normal.
  assert.ok(Math.abs(signedVolume(body) - 14 * 4 * noseSweep[0]) <= 1e-9 * 14 * 4 * noseSweep[0]);
  t.diagnostic(`nose: F32x2 ${worst.toExponential(2)} mm (bound ${(1e-12 * scale).toExponential(2)}), F32 path ${f32Incidence(nose.points, nose.frame).toExponential(2)} mm`);
});

test('decoding to float64 loses at most half a float64 ulp and is idempotent', t => {
  // An F32x2 pair can span more than 53 bits (hi = 0.25, lo = -3.8e-17), so
  // hi + lo is rounded once when the host decodes it. The loss is <= 2^-53 x
  // |value|, and the decoded number re-encodes (src/real.mjs real()) to words
  // that decode to the same number: the host round trip is lossless after the
  // first decode.
  let rounded = 0, total = 0;
  const check = w => {
    const value = number(w), back = real(value);
    total++;
    if (back.hi !== w.hi || back.lo !== w.lo) rounded++;
    assert.ok(Math.abs((value - w.hi) - w.lo) <= 2 ** -53 * Math.abs(value));
    assert.equal(number(back), value);
    const again = real(number(back));
    assert.ok(again.hi === back.hi && again.lo === back.lo);
  };
  const results = [wedge, octagon, pocket, nose].map(({ points, frame }) => built(extrude(points, frame)));
  results.push(built(prism.transform(results[1].solid, rotation(pose.columns), vector(pose.offset))));
  for (const { solid } of results) {
    for (const v of array(solid.vertices)) for (const c of 'xyz') check(v[c]);
    for (const f of array(solid.faces)) for (const key of ['origin', 'normal', 'x']) for (const c of 'xyz') check(f[key][c]);
  }
  t.diagnostic(`${rounded} of ${total} words are not float64-exact; each decodes within half a float64 ulp`);
});

test('a start offset moves the sketch plane as part of the one rigid transform', () => {
  const plain = built(extrude(octagon.points, { ...octagon.frame, origin: add(far, [0, 0, 2]) }));
  const shifted = built(extrude(octagon.points, { ...octagon.frame, shift: [0, 0, 2] }));
  assertPrecise(shifted, 'shifted');
  const a = decode(plain.solid).vertices, b = decode(shifted.solid).vertices;
  a.forEach((v, i) => assert.ok(norm(sub(v, b[i])) <= 1e-12 * 600));
});

test('degenerate input is refused by name', () => {
  const square = [[0, 0], [4, 0], [4, 4], [0, 4]];
  assert.equal(refusal(extrude(square, { delta: [3, 1, 0] })).$, 'DegenerateSweep');
  assert.equal(refusal(extrude(square, { delta: [3, 1, 1e-13] })).$, 'DegenerateSweep');
  assert.equal(refusal(extrude(square, { delta: [0, 0, 0] })).$, 'DegenerateSweep');
  const zero = refusal(extrude([[0, 0], [4, 0], [4, 0], [4, 4], [0, 4]], { delta: [0, 0, 1] }));
  assert.deepEqual([zero.$, zero.index], ['ZeroLengthEdge', 1]);
  const closing = refusal(extrude([[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]], { delta: [0, 0, 1] }));
  assert.deepEqual([closing.$, closing.index], ['ZeroLengthEdge', 4]);
  assert.equal(refusal(extrude([[0, 0], [4, 0]], { delta: [0, 0, 1] })).$, 'TooFewVertices');
  assert.equal(refusal(extrude([...square].reverse(), { delta: [0, 0, 1] })).$, 'ProfileOrientation');
  assert.equal(refusal(extrude(square, { delta: [0, 0, -1] })).$, 'ProfileOrientation');
  assert.equal(built(extrude([...square].reverse(), { delta: [0, 0, -1] })).$, 'Built');
  assert.equal(refusal(extrude(square, { x: [1, 0, 1e-9], delta: [0, 0, 1] })).$, 'InvalidFrame');
  assert.equal(refusal(extrude(square, { normal: [0, 0, 0], delta: [0, 0, 1] })).$, 'InvalidInput');
  const lifted = prism.extrude(list(square.map(([a, b], i) => vector([a, b, i === 2 ? 1 : 0]))), vector([0, 0, 0]), vector([0, 0, 1]), vector([1, 0, 0]), vector([0, 0, 1]));
  assert.deepEqual([refusal(lifted).$, refusal(lifted).index], ['InvalidPoint', 2]);
});

test('an audit overrun and a non-rigid copy are refused by name', () => {
  const source = built(extrude([[0, 0], [10, 0], [10, 7], [0, 7]], { delta: [0, 0, 5] })).solid;
  // Move one top vertex 1e-9 mm off both of its side carriers and the top cap.
  const vertices = array(source.vertices);
  vertices[6] = vector(add(coords(vertices[6]), [1e-9, 1e-9, 1e-9]));
  const bent = { ...source, vertices: list(vertices) };
  const overrun = refusal(prism.admit(bent));
  assert.equal(overrun.$, 'IncidenceAudit');
  assert.ok(Math.abs(number(overrun.required) - 1e-9) <= 1e-15);
  assert.ok(Math.abs(number(overrun.allowance) - 1e-11) <= 1e-17);
  // A rigid copy keeps an imprecise source's residual; it does not make it worse.
  const copy = built(prism.transform(bent, rotation(pose.columns), vector(pose.offset)));
  assert.ok(number(copy.required) > number(copy.allowance));
  assert.ok(Math.abs(number(copy.required) - 1e-9) <= 1e-12);
  const scaled = pose.columns.map(c => mul(c, 1 + 1e-9));
  assert.equal(refusal(prism.transform(source, rotation(scaled), vector(pose.offset))).$, 'NonRigidRotation');
  const mirrored = [pose.columns[0], pose.columns[1], mul(pose.columns[2], -1)];
  assert.equal(refusal(prism.transform(source, rotation(mirrored), vector(pose.offset))).$, 'NonRigidRotation');
  const dangling = { ...source, edges: list([...array(source.edges).slice(0, -1), { $: 'Edge', start: 3, end: 99 }]) };
  assert.equal(refusal(prism.admit(dangling)).$, 'DanglingIndex');
});

const polygon = count => Array.from({ length: count }, (_, i) => {
  const a = 2 * Math.PI * i / count;
  return [50 * Math.cos(a), 30 * Math.sin(a)];
});

test('extrude and transform time grows about linearly with the profile', t => {
  const rows = [];
  for (const count of [4, 192, 470, 4096]) {
    const points = polygon(count);
    extrude(points, octagon.frame);
    const start = performance.now();
    const result = built(extrude(points, octagon.frame));
    const extrudeMs = performance.now() - start;
    const middle = performance.now();
    built(prism.transform(result.solid, rotation(pose.columns), vector(pose.offset)));
    const transformMs = performance.now() - middle;
    assertPrecise(result, `${count}-gon`);
    rows.push({ count, extrudeMs, transformMs });
    t.diagnostic(`${count} vertices: extrude ${extrudeMs.toFixed(1)} ms (${(1000 * extrudeMs / count).toFixed(1)} us/vertex), transform ${transformMs.toFixed(1)} ms, uptime ${process.uptime().toFixed(1)} s`);
  }
  const perVertex = row => row.extrudeMs / row.count;
  const [, , mid, big] = rows;
  // About linear: the per-vertex cost at 4096 stays within 4x of the one at 470
  // (an O(n^2) audit would be about 9x).
  assert.ok(perVertex(big) <= 4 * perVertex(mid), `${perVertex(big)} vs ${perVertex(mid)} ms/vertex`);
});

}
