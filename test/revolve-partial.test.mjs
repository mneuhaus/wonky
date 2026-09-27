import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("revolve-partial.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { loadKernel } = await import("../src/kernel.mjs");
const { real, vector, number } = await import("../src/real.mjs");
const { sweepInBend, decodeAnalytic, encodeAnalytic, validateAnalytic } = await import("../src/analytic.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");







// The general exact revolve (kernel/revolve.bend `sweep`, docs/revolve.md):
// partial angles, profile vertices on the axis, arcs (sphere and torus faces).
// The legacy full-turn polygon entry `revolve` is covered, unchanged, by
// test/revolve.test.mjs.
const kernel = await loadKernel();
const TOLERANCE = 1e-7;
const deg = d => d * Math.PI / 180;
const sweep = (profile, angle = null, frame = {}) => sweepInBend(kernel, 'swept', profile,
  frame.origin ?? [0, 0, 0], frame.axis ?? [0, 0, 1], frame.x ?? [1, 0, 0], TOLERANCE, angle);
const relative = (actual, expected) => Math.abs(actual - expected) / Math.abs(expected);
const arc = (at, center, ccw = true) => ({ at, arc: { center, ccw } });

// ---- independent geometry, test side only ---------------------------------

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const scale = (a, s) => a.map(v => v * s);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = a => scale(a, 1 / Math.hypot(...a));

// The profile as a closed (r, h) polyline, arcs sampled finely: only used to
// decide inside/outside for probe points well away from the boundary.
function polyline(profile) {
  const nodes = profile.map(n => Array.isArray(n) ? { at: n } : n);
  const out = [];
  nodes.forEach((node, i) => {
    const next = nodes[(i + 1) % nodes.length].at;
    out.push(node.at);
    if (!node.arc) return;
    const [cr, ch] = node.arc.center, rho = Math.hypot(node.at[0] - cr, node.at[1] - ch);
    const a0 = Math.atan2(node.at[1] - ch, node.at[0] - cr);
    let d = Math.atan2(next[1] - ch, next[0] - cr) - a0;
    if (node.arc.ccw) { while (d <= 0) d += 2 * Math.PI; } else { while (d >= 0) d -= 2 * Math.PI; }
    for (let k = 1; k < 400; k++) out.push([cr + rho * Math.cos(a0 + d * k / 400), ch + rho * Math.sin(a0 + d * k / 400)]);
  });
  return out;
}
function insideProfile(poly, [r, h]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ri, hi] = poly[i], [rj, hj] = poly[j];
    if ((hi > h) !== (hj > h) && r < (rj - ri) * (h - hi) / (hj - hi) + ri) inside = !inside;
  }
  return inside;
}
// The grid point of the profile farthest from its boundary.
function deepInside(poly) {
  const rs = poly.map(p => p[0]), hs = poly.map(p => p[1]);
  const [r0, r1, h0, h1] = [Math.min(...rs), Math.max(...rs), Math.min(...hs), Math.max(...hs)];
  let best = null, depth = -1;
  for (let i = 1; i < 40; i++) for (let j = 1; j < 40; j++) {
    const q = [r0 + (r1 - r0) * i / 40, h0 + (h1 - h0) * j / 40];
    if (!insideProfile(poly, q)) continue;
    const d = Math.min(...poly.map(p => Math.hypot(p[0] - q[0], p[1] - q[1])));
    if (d > depth) { depth = d; best = q; }
  }
  return best;
}
function insideSolid(poly, angle, frame, point) {
  const y = cross(frame.axis, frame.x), d = sub(point, frame.origin);
  const h = dot(d, frame.axis), radial = sub(d, scale(frame.axis, h));
  let phi = Math.atan2(dot(radial, y), dot(radial, frame.x));
  if (phi < 0) phi += 2 * Math.PI;
  if (angle !== null && !(phi > 0 && phi < angle)) return false;
  return insideProfile(poly, [Math.hypot(...radial), h]);
}
// Outward normal of an analytic face at a point on it, from the carrier and
// the face sense alone.
function outward(face, p) {
  const s = face.surface, sign = face.sameSense ? 1 : -1;
  const axial = a => { const d = sub(p, s.origin); return sub(d, scale(a, dot(d, a))); };
  let n;
  if (s.type === 'plane') n = s.normal;
  else if (s.type === 'cylinder') n = unit(axial(s.axis));
  else if (s.type === 'cone') n = unit(sub(scale(unit(axial(s.axis)), Math.cos(s.angle)), scale(s.axis, Math.sin(s.angle))));
  else if (s.type === 'sphere') n = unit(sub(p, s.origin));
  else if (s.type === 'torus') n = unit(sub(p, add(s.origin, scale(unit(axial(s.axis)), s.major))));
  return scale(n, sign);
}
// A point inside each face, from the profile: segment i lifted at mid-angle
// is on band face i (axis segments have none); the side planes get a point
// just inside the profile next to its first segment.
function faceProbes(profile, angle, frame) {
  const nodes = profile.map(n => Array.isArray(n) ? { at: n } : n);
  const y = cross(frame.axis, frame.x);
  const lift = ([r, h], phi) => add(frame.origin, add(scale(frame.axis, h), scale(add(scale(frame.x, Math.cos(phi)), scale(y, Math.sin(phi))), r)));
  const mid = angle === null ? Math.PI * 0.7 : angle / 2;
  const probes = [];
  nodes.forEach((node, i) => {
    const a = node.at, b = nodes[(i + 1) % nodes.length].at;
    if (!node.arc && a[0] === 0 && b[0] === 0) return;
    let m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (node.arc) {
      const [cr, ch] = node.arc.center, rho = Math.hypot(a[0] - cr, a[1] - ch);
      const a0 = Math.atan2(a[1] - ch, a[0] - cr);
      let d = Math.atan2(b[1] - ch, b[0] - cr) - a0;
      if (node.arc.ccw) { while (d <= 0) d += 2 * Math.PI; } else { while (d >= 0) d -= 2 * Math.PI; }
      m = [cr + rho * Math.cos(a0 + d / 2), ch + rho * Math.sin(a0 + d / 2)];
    }
    probes.push(lift(m, mid));
  });
  if (angle !== null) {
    const m = deepInside(polyline(profile));
    probes.push(lift(m, 0), lift(m, angle));
  }
  return probes;
}
function assertOutward(body, profile, angle, frame) {
  const f = { origin: [0, 0, 0], axis: [0, 0, 1], x: [1, 0, 0], ...frame };
  const poly = polyline(profile), probes = faceProbes(profile, angle, f);
  assert.equal(probes.length, body.faces.length, 'one probe per face');
  body.faces.forEach((face, i) => {
    const p = probes[i], n = outward(face, p);
    assert.ok(A_residual(face, p) < 1e-9, `probe ${i} is on face ${i} (${face.surface.type})`);
    assert.equal(insideSolid(poly, angle, f, add(p, scale(n, 1e-3))), false, `face ${i} (${face.surface.type}) outward side is outside`);
    assert.equal(insideSolid(poly, angle, f, sub(p, scale(n, 1e-3))), true, `face ${i} (${face.surface.type}) inward side is inside`);
  });
}
const A_residual = (face, p) => kernel.analytic.surface_residual(encodeAnalytic({ vertices: [], edges: [], faces: [{ ...face }] }).faces.head.surface, vector(p));

function assertClosedOriented(body) {
  const tally = new Map();
  for (const face of body.faces) for (const loop of face.loops) for (const use of loop) {
    const entry = tally.get(use.edge) ?? [0, 0];
    entry[use.forward ? 0 : 1]++;
    tally.set(use.edge, entry);
  }
  assert.equal(tally.size, body.edges.length, 'every edge is used');
  for (const [edge, [f, b]] of tally) assert.deepEqual([f, b], [1, 1], `edge ${edge}`);
  const used = new Set(body.edges.flatMap(e => [e.start, e.end]));
  assert.equal(used.size, body.vertices.length, 'every vertex is on an edge');
}

// ---- R20 KT3 (kernel-cases/kt3_partial_revolve), in Onshape's frame -------
// Axis = world X, start radial = (0, cos s, sin s). The FS profiles are drawn
// in (along X, radial), clockwise in (radius, height); here they are given
// counterclockwise in (radius, height), as sweep requires.

const KT3A = [[0, 0], [20, 0], [20, 20], [12, 30], [0, 30]];
const KT3B = [[5, 40], [25, 40], [25, 60], [5, 60]];
const onX = start => ({ axis: [1, 0, 0], x: [0, Math.cos(deg(start)), Math.sin(deg(start))] });

test('KT3a: 135 degrees with an edge on the axis matches Onshape\'s volume and builds a closed oriented shell', () => {
  const body = sweep(KT3A, deg(135), onX(0));
  assert.ok(relative(body.validation.volumeMm3, 12503.538761287378) < 1e-6, `${body.validation.volumeMm3}`);
  assert.ok(relative(body.validation.volumeMm3, 12503.538761287378) < 1e-12);
  // Two vertices per node off the axis, one per node on it; an arc per node
  // off the axis, two profile edges per band, one shared axis line.
  assert.deepEqual([body.vertices.length, body.edges.length, body.faces.length], [8, 12, 6]);
  assert.equal(body.vertices.length - body.edges.length + body.faces.length, 2);
  assert.deepEqual(body.faces.map(f => f.surface.type), ['plane', 'cylinder', 'cone', 'plane', 'plane', 'plane']);
  const axisEdges = body.edges.filter(e => e.curve.type === 'line' &&
    [e.start, e.end].every(v => Math.hypot(body.vertices[v][1], body.vertices[v][2]) === 0));
  assert.equal(axisEdges.length, 1, 'the profile segment on the axis is one line edge');
  const axisIndex = body.edges.indexOf(axisEdges[0]);
  assert.deepEqual(body.faces.flatMap((f, i) => f.loops.flat().some(u => u.edge === axisIndex) ? [i] : []), [4, 5],
    'shared by the two side planes only');
  assertClosedOriented(body);
  assertOutward(body, KT3A, deg(135), onX(0));
  // Onshape's mesh bbox is [0,-14.142135,0]..[30,20,20]; every vertex is in it.
  for (const v of body.vertices) {
    assert.ok(v[0] >= -1e-9 && v[0] <= 30 + 1e-9 && v[1] >= -14.142136 && v[1] <= 20 + 1e-9 && v[2] >= -1e-9 && v[2] <= 20 + 1e-9, `${v}`);
  }
});

test('KT3b: a 60 degree ring sector from 30 degrees matches Onshape\'s volume', () => {
  const body = sweep(KT3B, deg(60), onX(30));
  assert.ok(relative(body.validation.volumeMm3, 6283.185307179588) < 1e-12, `${body.validation.volumeMm3}`);
  assert.deepEqual([body.vertices.length, body.edges.length, body.faces.length], [8, 12, 6]);
  assert.deepEqual(body.faces.map(f => [f.surface.type, f.sameSense]),
    [['plane', false], ['cylinder', true], ['plane', true], ['cylinder', false], ['plane', false], ['plane', true]]);
  assertClosedOriented(body);
  assertOutward(body, KT3B, deg(60), onX(30));
  // The start half plane is at 30 degrees: its vertices have z/y = tan 30.
  for (const v of body.vertices.slice(0, 1)) near(v[2] / v[1], Math.tan(deg(30)));
});
const near = (actual, expected, tolerance = 1e-12) => assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);

// ---- full turns reaching the axis, spheres and tori -----------------------

test('KT1 relief: a cone profile to the axis gives a disc and a cone with an apex, exact volume', () => {
  const profile = [[0, 0], [2.1, 0], [0, 2.1]];
  const body = sweep(profile);
  assert.ok(relative(body.validation.volumeMm3, Math.PI * 2.1 ** 3 / 3) < 1e-9);
  // Disc: bounded by its circle alone, no seam and no centre vertex. Cone: its
  // circle, a seam to the apex and back.
  assert.deepEqual([body.vertices.length, body.edges.length, body.faces.length], [2, 2, 2]);
  assert.deepEqual(body.faces.map(f => [f.surface.type, f.sameSense, f.loops.map(l => l.length)]), [['plane', false, [1]], ['cone', true, [3]]]);
  assert.ok(body.faces[1].surface.radius > 0, 'the cone is anchored away from its apex');
  assertClosedOriented(body);
  assertOutward(body, profile, null);
});

test('KS03 cone: a frustum closed by two discs on the axis, exact volume', () => {
  const [r0, r1] = [12 - 0.5 * 6 / 34, 18 + 0.5 * 6 / 34];
  const profile = [[0, -0.5], [r0, -0.5], [r1, 34.5], [0, 34.5]];
  const body = sweep(profile);
  assert.ok(relative(body.validation.volumeMm3, Math.PI * 35 * (r0 * r0 + r0 * r1 + r1 * r1) / 3) < 1e-9);
  assert.deepEqual([body.vertices.length, body.edges.length, body.faces.length], [2, 3, 3]);
  assert.deepEqual(body.faces.map(f => f.surface.type), ['plane', 'cone', 'plane']);
  assertClosedOriented(body);
  assertOutward(body, profile, null);
});

test('KS06 detent: a half disc (arc + axis line) gives a sphere, exact volume', () => {
  const profile = [arc([0, -0.9], [0, 0]), [0, 0.9]];
  const body = sweep(profile, null, { origin: [10, 4, 5.85], axis: [1, 0, 0], x: [0, 0, 1] });
  assert.ok(relative(body.validation.volumeMm3, 4 / 3 * Math.PI * 0.9 ** 3) < 1e-9);
  // One sphere face bounded by its meridian seam from pole to pole.
  assert.deepEqual([body.vertices.length, body.edges.length, body.faces.length], [2, 1, 1]);
  assert.deepEqual(body.faces[0].surface.type, 'sphere');
  body.faces[0].surface.origin.forEach((v, i) => near(v, [10, 4, 5.85][i]));
  near(body.faces[0].surface.radius, 0.9); // 0.9 itself is not an F32x2 number
  assertClosedOriented(body);
  assertOutward(body, profile, null, { origin: [10, 4, 5.85], axis: [1, 0, 0], x: [0, 0, 1] });
});

test('KS08 torus: a full circle profile gives a torus with one vertex, exact volume', () => {
  const profile = [arc([15, 0], [12, 0])];
  const body = sweep(profile);
  assert.ok(relative(body.validation.volumeMm3, 2 * Math.PI ** 2 * 12 * 9) < 1e-9);
  assert.deepEqual([body.vertices.length, body.edges.length, body.faces.length], [1, 2, 1]);
  const s = body.faces[0].surface;
  assert.deepEqual([s.type, s.major, s.minor], ['torus', 12, 3]);
  assertClosedOriented(body);
  assertOutward(body, profile, null);
});

const BUMP_GROOVE = [[2, 0], [5, 0], arc([5, 2], [5, 3]), [5, 4], [5, 8], [2, 8], arc([2, 6], [2, 5], false), [2, 4]];
const BUMP_GROOVE_VOLUME = Math.PI * 21 * 8 + 2 * Math.PI * (5 + 4 / (3 * Math.PI)) * Math.PI / 2 - 2 * Math.PI * (2 + 4 / (3 * Math.PI)) * Math.PI / 2;
test('partial spheres and tori, and arcs inside ordinary profiles', () => {
  const cases = [
    [[arc([0, -3], [0, 0]), [0, 3]], deg(90), 9 * Math.PI],
    [[arc([15, 0], [12, 0])], deg(45), 2 * Math.PI ** 2 * 12 * 9 / 8],
    // A tube with a bump on its outer wall (counterclockwise torus arc) and
    // a groove in its bore (clockwise arc): tube + bump - groove by Pappus.
    [BUMP_GROOVE, null, BUMP_GROOVE_VOLUME],
    [BUMP_GROOVE, deg(200), BUMP_GROOVE_VOLUME * 200 / 360],
  ];
  for (const [profile, angle, expected] of cases) {
    const body = sweep(profile, angle);
    assertClosedOriented(body);
    assertOutward(body, profile, angle);
    if (expected !== null) assert.ok(relative(body.validation.volumeMm3, expected) < 1e-9, `${body.validation.volumeMm3} != ${expected}`);
  }
});

test('the swept volume of arcs is exact: a bulged tube against its closed form', () => {
  // Outer wall bulges by a half circle of radius 2 centred at r = 5, h = 4
  // over a bore of radius 2, height 8: tube + half torus tube (Pappus with the
  // centroid of a half disc at 5 + 4*2/(3 pi)).
  const profile = [[2, 0], [5, 0], arc([5, 2], [5, 4]), [5, 6], [5, 8], [2, 8]];
  const body = sweep(profile);
  const expected = Math.PI * (25 - 4) * 8 + 2 * Math.PI * (5 + 8 / (3 * Math.PI)) * Math.PI * 4 / 2;
  assert.ok(relative(body.validation.volumeMm3, expected) < 1e-12, `${body.validation.volumeMm3} != ${expected}`);
  assert.equal(body.faces.filter(f => f.surface.type === 'torus').length, 1);
  assertOutward(body, profile, null);
  // A partial sweep is exactly the matching fraction.
  near(sweep(profile, deg(72)).validation.volumeMm3, expected / 5);
});

test('full-turn planes carry no seam: an annulus has its two circles as loops', () => {
  const body = sweep([[2, 0], [5, 0], [5, 8], [2, 8]]);
  assert.deepEqual([body.vertices.length, body.edges.length, body.faces.length], [4, 6, 4]);
  assert.deepEqual(body.faces.map(f => f.loops.length), [2, 1, 2, 1]);
  assert.deepEqual(body.faces[0].outer, [true, false]);
  const outerCircle = body.edges[body.faces[0].loops[0][0].edge];
  assert.equal(outerCircle.curve.radius, 5, 'the outer loop is the larger circle');
  assertClosedOriented(body);
});

test('sphere and torus carriers transform rigidly and validate', () => {
  const body = sweep([arc([15, 0], [12, 0])], deg(120));
  const quarter = { $: 'Rotation', x: vector([0, 1, 0]), y: vector([-1, 0, 0]), z: vector([0, 0, 1]) };
  const moved = decodeAnalytic(kernel.analytic.transform(encodeAnalytic(body), quarter, vector([7, -3, 2])), 'moved', kernel);
  const s = moved.faces[0].surface;
  assert.equal(s.type, 'torus');
  assert.deepEqual(s.origin, [7, -3, 2]);
  assert.deepEqual([s.major, s.minor], [12, 3]);
  assert.doesNotThrow(() => validateAnalytic(moved, kernel));
  // surface_residual: distance to the sphere / to the torus tube.
  const sphere = { $: 'Sphere', origin: vector([1, 2, 3]), axis: vector([0, 0, 1]), x: vector([1, 0, 0]), radius: real(2) };
  near(kernel.analytic.surface_residual(sphere, vector([1, 2, 6])), 1, 1e-6);
  const torus = { $: 'Torus', origin: vector([0, 0, 0]), axis: vector([0, 0, 1]), x: vector([1, 0, 0]), major: real(12), minor: real(3) };
  near(kernel.analytic.surface_residual(torus, vector([0, 12, 3])), 0, 1e-6);
  near(kernel.analytic.surface_residual(torus, vector([0, 0, 0])), 9, 1e-6);
});

test('the volume entry agrees with the built solid', () => {
  const nodes = { $: 'Con', head: { $: 'Node', point: { $: 'Ring', radius: real(15), height: real(0) }, segment: { $: 'Arc', center: { $: 'Ring', radius: real(12), height: real(0) }, ccw: true } }, tail: { $: 'Nil' } };
  near(number(kernel.revolve.sweep_volume(nodes, { $: 'Full' })), 2 * Math.PI ** 2 * 12 * 9, 1e-12);
});

// ---- refusals -------------------------------------------------------------

const code = (profile, angle = null) => {
  try { sweep(profile, angle); return 0; } catch (error) {
    assert.ok(error instanceof UnsupportedFeatureError, error.message);
    return error.message;
  }
};
test('profiles sweep cannot build are refused by name, never approximated', () => {
  const cases = [
    [[[2, 0], [5, 0]], null, /bounds no area/],
    [[[-1, 0], [5, 0], [5, 8]], null, /crosses or touches the axis/],
    // An arc from (1, 2) counterclockwise about (1, 0) passes r = -1.
    [[arc([1, 2], [1, 0]), [1, -2]], null, /crosses or touches the axis/],
    // A torus profile circle touching the axis.
    [[arc([6, 0], [3, 0])], null, /crosses or touches the axis/],
    [[[2, 0], [5, 0], [5, 8], [5, 8 + 2e-15], [2, 8]], null, /not longer than the linear tolerance/],
    [[[2, 0], [2, 8], [5, 8], [5, 0]], null, /not counterclockwise/],
    [[arc([5, 0], [3, 0]), [1.5, 0]], null, /does not end on its own circle/],
    [[[2, 0], [5, 0], [5, 8], [2, 8]], deg(360), /Revolve angle/],
    [[[2, 0], [5, 0], [5, 8], [2, 8]], 0, /Revolve angle/],
    [[[0, 0], [5, -5], [5, 5]], null, /pinches the solid/],
    [[arc([1, -3], [-4, 0]), [1, 3]], null, /centre lies across the axis/],
    [[[1e-9, 0], [5, 0], [5, 8], [2, 8]], null, /snap it first/],
    [[[2, 0], [5, 1e-9], [5, 8], [2, 8]], null, /snap it first/],
    [[[2, 0], [5, 0], [5 + 1e-9, 8], [2, 8]], null, /snap it first/],
  ];
  for (const [profile, angle, message] of cases) assert.match(String(code(profile, angle)), message, JSON.stringify(profile));
  // The pinch is only a full-turn defect: a partial sweep of it is a manifold.
  assert.doesNotThrow(() => sweep([[0, 0], [5, -5], [5, 5]], deg(90)));
  assert.doesNotThrow(() => validateAnalytic(sweep([[0, 0], [5, -5], [5, 5]], deg(90)), kernel));
});

}
