import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("revolve.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { loadKernel, list } = await import("../src/kernel.mjs");
const { real, vector, number } = await import("../src/real.mjs");
const { revolveInBend, validateAnalytic } = await import("../src/analytic.mjs");
const { toStep } = await import("../src/exporters.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");








// revolve is exercised through its driver, not through the kernel entry. The
// kernel returns a Revolved, so there is no way to obtain a solid that skipped
// admission; the driver is what turns a refusal into the capability error.
const kernel = await loadKernel();
const TOLERANCE = 1e-7;
const revolve = (profile, id = 'revolved') => revolveInBend(kernel, id, profile, [0, 0, 0], [0, 0, 1], [1, 0, 0], TOLERANCE);
const near = (actual, expected, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)),
    `${actual} is not within ${tolerance} of ${expected}`);
const refusal = profile => {
  const rings = list(profile.map(([radius, height]) => ({ $: 'Ring', radius: real(radius), height: real(height) })));
  return kernel.revolve.revolve(rings, real(TOLERANCE), vector([0, 0, 0]), vector([0, 0, 1]), vector([1, 0, 0]));
};

// Counterclockwise in (radius, height) puts the material inside the profile.
const tube = (inner, outer, low, high) => [[inner, low], [outer, low], [outer, high], [inner, high]];

test('a rectangular profile revolves into a tube with exact volume and topology', () => {
  const body = revolve(tube(2, 5, 0, 8));
  // One band per profile segment; a circle and a seam per profile point.
  assert.deepEqual([body.vertices.length, body.edges.length, body.faces.length], [4, 8, 4]);
  // A tube is genus one, so the Euler characteristic is zero, not two.
  assert.equal(body.vertices.length - body.edges.length + body.faces.length, 0);
  assert.equal(body.precision, 'F32x2');
  near(body.validation.volumeMm3, Math.PI * (25 - 4) * 8);
});

test('each band takes the surface and the outward sense its segment implies', () => {
  const body = revolve(tube(2, 5, 0, 8));
  assert.deepEqual(body.faces.map(f => [f.surface.type, f.sameSense]), [
    ['plane', false],    // bottom annulus, outward is -axis
    ['cylinder', true],  // outer wall, outward is away from the axis
    ['plane', true],     // top annulus, outward is +axis
    ['cylinder', false], // bore wall, outward is toward the axis
  ]);
  assert.equal(body.faces[1].surface.radius, 5);
  assert.equal(body.faces[3].surface.radius, 2);
});

test('every edge of a revolved shell is used once forward and once backward', () => {
  // The orientability invariant the loop ordering exists to satisfy. Checked on
  // a profile that turns around in height, which is where ordering by height
  // instead of by profile order produced two forward uses.
  const body = revolve([[2, 0], [6, 0], [6, 3], [4, 3], [4, 6], [7, 6], [7, 9], [2, 9]]);
  const tally = new Map();
  for (const face of body.faces)
    for (const loop of face.loops)
      for (const use of loop.uses ?? loop) {
        const entry = tally.get(use.edge) ?? { forward: 0, backward: 0 };
        use.forward ? entry.forward++ : entry.backward++;
        tally.set(use.edge, entry);
      }
  assert.equal(tally.size, body.edges.length);
  for (const [edge, entry] of tally)
    assert.deepEqual([entry.forward, entry.backward], [1, 1], `edge ${edge} is used ${entry.forward}f/${entry.backward}b`);
});

test('an oblique segment becomes a cone and keeps the frustum volume', () => {
  // Outer wall tapers 5 -> 3 over height 6 around a straight 2 mm bore.
  const body = revolve([[2, 0], [5, 0], [3, 6], [2, 6]]);
  assert.equal(body.faces[1].surface.type, 'cone');
  near(body.validation.volumeMm3, Math.PI * 6 * (25 + 15 + 9) / 3 - Math.PI * 4 * 6);
});

test('a stepped profile keeps one exact face per segment', () => {
  // Shoulder bushing: two outer diameters over one bore.
  const body = revolve([[3, 0], [8, 0], [8, 4], [5, 4], [5, 10], [3, 10]]);
  assert.deepEqual([body.vertices.length, body.edges.length, body.faces.length], [6, 12, 6]);
  assert.deepEqual(body.faces.map(f => f.surface.type),
    ['plane', 'cylinder', 'plane', 'cylinder', 'plane', 'cylinder']);
  near(body.validation.volumeMm3, Math.PI * (64 * 4 + 25 * 6 - 9 * 10));
});

test('a revolved body exports analytic STEP surfaces, never a facet', () => {
  const step = toStep({ bodies: [revolve(tube(2, 5, 0, 8), 'tube')], backend: { version: '2.0.25' } });
  assert.match(step, /CYLINDRICAL_SURFACE/);
  assert.match(step, /PLANE/);
  assert.match(step, /CIRCLE/);
  assert.doesNotMatch(step, /POLY_LOOP|TRIANGUL/);
});

test('the revolved shell passes the independent analytic validator', () => {
  assert.doesNotThrow(() => validateAnalytic(revolve(tube(1, 4, -2, 3)), kernel));
});

test('a clockwise profile is refused instead of building an inside-out solid', () => {
  // Every band_sense flips self-consistently, so the shell stays a closed
  // oriented two-manifold and every downstream check passes -- including
  // OpenCascade, whose STEP reader silently reverses the shell on import and
  // then reports a positive volume. The swept volume is the only signal, so
  // admission is where this has to be caught.
  const clockwise = tube(2, 5, 0, 8).slice().reverse();
  assert.equal(refusal(clockwise).reason, 4);
  assert.throws(() => revolve(clockwise), UnsupportedFeatureError);
  assert.throws(() => revolve(clockwise), /not counterclockwise/);
});

test('a segment below the linear tolerance is refused, not certified', () => {
  // Two rings a couple of ulps apart used to build a sliver band that this
  // kernel called a closed two-manifold and BRepCheck_Analyzer then rejected.
  const sliver = [[2, 0], [5, 0], [5, 8], [5, 8 + 2e-15], [2, 8]];
  assert.equal(refusal(sliver).reason, 3);
  assert.throws(() => revolve(sliver), /shorter than the linear tolerance/);
});

test('profiles this kernel cannot revolve are refused rather than approximated', () => {
  // Touching the axis needs an apex band, which is not built yet.
  assert.equal(refusal([[0, 0], [5, 0], [5, 8], [0, 8]]).reason, 2);
  assert.throws(() => revolve([[0, 0], [5, 0], [5, 8], [0, 8]]), /touching the axis/);
  // Fewer than three points bound no area. This one used to build two
  // coincident planes that validated as a closed solid and exported to STEP.
  assert.equal(refusal([[2, 0], [5, 0]]).reason, 1);
  assert.throws(() => revolve([[2, 0], [5, 0]]), UnsupportedFeatureError);
  assert.equal(refusal([]).reason, 1);
  // And the admitted profile still is.
  assert.equal(refusal(tube(2, 5, 0, 8)).$, 'Swept');
});

}
