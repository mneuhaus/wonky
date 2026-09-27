import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend() || missing("local design note");
if (publicTreeSkip) {
  test("print-mesh-coverage.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { existsSync } = await import("node:fs");
const { homedir } = await import("node:os");
const { join } = await import("node:path");
const { loadKernel } = await import("../src/kernel.mjs");
const { sweepInBend } = await import("../src/analytic.mjs");
const { printMesh, meshDefects } = await import("../src/print-mesh.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");
const { readStl, measure, hausdorff } = await import("../scripts/r20/mesh.mjs");
// printMesh coverage for every face the R20 constructors make (local design note
// task 7): planar caps bounded by lines and trimmed arcs, cylinder patches
// between lines and arcs, partial-revolve bands, poles and apexes, planar side
// caps with arcs, and sphere and torus zones.
//
// Each mesh is checked against its own analytic carriers in closed form, not
// against another mesher: with { tags: true } every triangle names the face
// it lies on, and every sampled point of it must be within the stated
// deviation of that face's surface. For the sphere and the torus the other
// direction is checked too: surface points sampled from the parametrisation
// must be within the stated deviation of the mesh.











const kernel = await loadKernel();
const deg = d => d * Math.PI / 180;
const arc = (at, center, ccw = true) => ({ at, arc: { center, ccw } });
const sweep = (profile, angle = null, frame = {}) => sweepInBend(kernel, 'swept', profile,
  frame.origin ?? [0, 0, 0], frame.axis ?? [0, 0, 1], frame.x ?? [1, 0, 0], 1e-7, angle);

// ---- independent geometry, test side only ---------------------------------

const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const scale = (a, s) => a.map(v => v * s);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = a => Math.hypot(...a);

// Distance from a point to a face's carrier surface, in closed form.
function carrierDistance(surface, p) {
  const d = sub(p, surface.origin);
  if (surface.type === 'plane') return Math.abs(dot(d, surface.normal));
  if (surface.type === 'sphere') return Math.abs(length(d) - surface.radius);
  const height = dot(d, surface.axis), rho = length(sub(d, scale(surface.axis, height)));
  if (surface.type === 'cylinder') return Math.abs(rho - surface.radius);
  if (surface.type === 'cone') return Math.abs(rho - surface.radius - height * Math.tan(surface.angle)) * Math.cos(surface.angle);
  if (surface.type === 'torus') return Math.abs(Math.hypot(rho - surface.major, height) - surface.minor);
  throw new Error(`no closed form for ${surface.type}`);
}

// Seeded, so a failure reproduces.
function random(seed) {
  let state = seed >>> 0;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32; };
}

// Corners, edge midpoints, centroid and seeded barycentric points of each
// triangle, against the carrier of the face its tag names.
function worstCarrierDistance(body, mesh, perTriangle = 4) {
  const next = random(7);
  let worst = 0;
  mesh.triangles.forEach(([a, b, c], k) => {
    const surface = body.faces[mesh.tags[k]].surface;
    const points = [a, b, c, scale(add(a, b), 0.5), scale(add(b, c), 0.5), scale(add(c, a), 0.5), scale(add(add(a, b), c), 1 / 3)];
    for (let i = 0; i < perTriangle; i++) {
      let u = next(), v = next();
      if (u + v > 1) { u = 1 - u; v = 1 - v; }
      points.push(add(a, add(scale(sub(b, a), u), scale(sub(c, a), v))));
    }
    for (const p of points) worst = Math.max(worst, carrierDistance(surface, p));
  });
  return worst;
}

// Point to triangle (Ericson, Real-Time Collision Detection 5.1.5).
function pointTriangle(p, a, b, c) {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return length(ap);
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return length(bp);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return length(sub(p, add(a, scale(ab, d1 / (d1 - d3)))));
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return length(cp);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return length(sub(p, add(a, scale(ac, d2 / (d2 - d6)))));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return length(sub(p, add(b, scale(sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6))))));
  const denominator = 1 / (va + vb + vc);
  return length(sub(p, add(a, add(scale(ab, vb * denominator), scale(ac, vc * denominator)))));
}

// Surface points of a whole sphere or torus (seeded, uniform in parameters)
// against the mesh: the other half of a two-sided bound.
function worstSurfaceToMesh(surface, triangles, count = 300) {
  const next = random(11), y = cross(surface.axis, surface.x);
  const [major, minor] = surface.type === 'sphere' ? [0, surface.radius] : [surface.major, surface.minor];
  let worst = 0;
  for (let i = 0; i < count; i++) {
    const u = 2 * Math.PI * next(), v = surface.type === 'sphere' ? Math.PI * (next() - 0.5) : 2 * Math.PI * next();
    const radial = add(scale(surface.x, Math.cos(u)), scale(y, Math.sin(u)));
    const p = add(surface.origin, add(scale(radial, major + minor * Math.cos(v)), scale(surface.axis, minor * Math.sin(v))));
    let nearest = Infinity;
    for (const [a, b, c] of triangles) nearest = Math.min(nearest, pointTriangle(p, a, b, c));
    worst = Math.max(worst, nearest);
  }
  return worst;
}

const meshVolume = triangles => triangles.reduce((sum, [a, b, c]) => sum + dot(a, cross(b, c)) / 6, 0);

// Watertight, within the request, and every sampled point of every triangle
// within the achieved bound of its own face's carrier.
function assertCovered(body, deviation, label) {
  const mesh = printMesh(kernel, body, deviation, { tags: true });
  const defects = meshDefects(mesh.triangles);
  assert.ok(defects.watertight, `${label} at ${deviation}: ${JSON.stringify(defects)}`);
  assert.ok(mesh.achievedDeviationMm <= deviation, `${label}: achieved ${mesh.achievedDeviationMm} > ${deviation}`);
  assert.equal(mesh.tags.length, mesh.triangles.length);
  const worst = worstCarrierDistance(body, mesh);
  assert.ok(worst <= mesh.achievedDeviationMm + 1e-9, `${label} at ${deviation}: a mesh point is ${worst} mm off its face, bound ${mesh.achievedDeviationMm}`);
  // Chords are inscribed on convex rims and the volume lies within the
  // deviation times the area of the exact solid's.
  const { areaMm2 } = measure(mesh.triangles);
  assert.ok(Math.abs(meshVolume(mesh.triangles) - body.validation.volumeMm3) <= areaMm2 * mesh.achievedDeviationMm,
    `${label}: mesh volume ${meshVolume(mesh.triangles)} vs exact ${body.validation.volumeMm3}`);
  return mesh;
}

// ---- revolved faces (kernel/revolve.bend sweep) ---------------------------

test('a whole sphere and a whole torus mesh within the stated deviation, both ways', () => {
  const cases = [
    ['sphere', sweep([arc([0, -0.9], [0, 0]), [0, 0.9]], null, { origin: [10, 4, 5.85], axis: [1, 0, 0], x: [0, 0, 1] })],
    ['torus', sweep([arc([15, 0], [12, 0])])],
  ];
  for (const [label, body] of cases) {
    const surface = body.faces.find(f => f.surface.type === label).surface;
    for (const deviation of [0.05, 0.01]) {
      const mesh = assertCovered(body, deviation, label);
      // Every vertex is a Bend sample on the surface itself.
      const onSurface = Math.max(...mesh.triangles.flat().map(p => carrierDistance(surface, p)));
      assert.ok(onSurface < 1e-12, `${label}: a vertex is ${onSurface} mm off the surface`);
      if (deviation === 0.05) {
        const back = worstSurfaceToMesh(surface, mesh.triangles);
        assert.ok(back <= mesh.achievedDeviationMm, `${label}: a surface point is ${back} mm from the mesh, bound ${mesh.achievedDeviationMm}`);
      }
    }
  }
});

test('the sphere and torus bound is the stated grid bound, and tighter requests divide more finely', () => {
  const torus = sweep([arc([15, 0], [12, 0])]);
  const coarse = printMesh(kernel, torus, 0.05), fine = printMesh(kernel, torus, 0.01);
  assert.ok(fine.count > coarse.count);
  // Both directions step 2 pi / count; the body's circles hold their sagitta
  // too, and the grid bound is the larger of the two here.
  const step = 2 * Math.PI / fine.count;
  const expected = ((12 + 3) * step ** 2 + 2 * 3 * step * step + 3 * step ** 2) / 8;
  assert.ok(Math.abs(fine.achievedDeviationMm - expected) < 1e-12 * expected, `${fine.achievedDeviationMm} vs ${expected}`);
});

test('partial revolves: bands between meridians, poles, apexes and side caps with arcs', () => {
  const tube = [[2, 0], [5, 0], [5, 8], [2, 8]];
  const bumpGroove = [[2, 0], [5, 0], arc([5, 2], [5, 3]), [5, 4], [5, 8], [2, 8], arc([2, 6], [2, 5], false), [2, 4]];
  const cases = [
    ['tube 270', sweep(tube, deg(270))],
    ['relief cone (apex)', sweep([[0, 0], [2.1, 0], [0, 2.1]])],
    ['cone 90 (apex, side caps)', sweep([[0, 0], [2.1, 0], [0, 2.1]], deg(90))],
    ['sphere 90 (lune, two poles)', sweep([arc([0, -3], [0, 0]), [0, 3]], deg(90))],
    ['torus 45', sweep([arc([15, 0], [12, 0])], deg(45))],
    ['bump and groove, whole', sweep(bumpGroove)],
    ['bump and groove, 200', sweep(bumpGroove, deg(200))],
    ['KS03-like cone band', sweep([[0, -0.5], [12 - 3 / 34, -0.5], [18 + 3 / 34, 34.5], [0, 34.5]])],
  ];
  for (const [label, body] of cases)
    for (const deviation of [0.05, 0.01]) assertCovered(body, deviation, label);
});

// ---- R20 KT3 against Onshape's own meshes ----------------------------------

const R20 = process.env.R20_ROOT ?? join(homedir(), 'Workspace/cad/cad-project-041/single-step-r20');
const KT3 = join(R20, 'kernel-cases/kt3_partial_revolve');
const onX = start => ({ axis: [1, 0, 0], x: [0, Math.cos(deg(start)), Math.sin(deg(start))] });
test('KT3a and KT3b mesh watertight and within tolerance of Onshape\'s STL', { skip: !existsSync(join(KT3, 'KT3a.stl')) && 'R20 kernel cases not present' }, () => {
  // The profiles of kernel-cases/kt3_partial_revolve in Onshape's frame
  // (test/revolve-partial.test.mjs), counterclockwise in (radius, height).
  const parts = {
    KT3a: sweep([[0, 0], [20, 0], [20, 20], [12, 30], [0, 30]], deg(135), onX(0)),
    KT3b: sweep([[5, 40], [25, 40], [25, 60], [5, 60]], deg(60), onX(30)),
  };
  const deviation = 0.01;
  for (const [key, body] of Object.entries(parts)) {
    const mesh = assertCovered(body, deviation, key);
    const ours = measure(mesh.triangles), ref = measure(readStl(join(KT3, `${key}.stl`))[0].triangles);
    assert.ok(ref.watertight && ref.components === 1);
    // The acceptance tolerance (scripts/r20/acceptance.mjs): our deviation,
    // Onshape's chord error over the half diagonal, float32 rounding.
    const half = length(sub(ref.bbox[1], ref.bbox[0])) / 2;
    const tol = deviation + half * (1 - Math.cos(0.025)) + 1e-4;
    const bbox = Math.max(...[0, 1].flatMap(i => [0, 1, 2].map(j => Math.abs(ours.bbox[i][j] - ref.bbox[i][j]))));
    assert.ok(bbox <= tol, `${key}: bbox off by ${bbox} (tol ${tol})`);
    const h = hausdorff(mesh.triangles, readStl(join(KT3, `${key}.stl`))[0].triangles, { extra: 4000 });
    assert.ok(h.hausdorffMm <= tol, `${key}: Hausdorff ${h.hausdorffMm} (tol ${tol})`);
  }
});

// ---- arc prisms (sketch-arcs extrusions) -----------------------------------

const header = 'FeatureScript 3044;\nimport(path : "onshape/std/geometry.fs", version : "3044.0");\n';
const onTop = 'newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) })';
const extrude = depth => `skSolve(sk);
    opExtrude(context, id + "e", { "entities" : qSketchRegion(id + "s"), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : ${depth} * millimeter });`;

// The KT1 M3 hybrid core: 12 exact arcs (kernel-cases/kt1_m3_hybrid, m3.fs).
const M3_ARCS = [
  [[1.663246643885392, 0.13016887084596582], [0.9526279441628823, 0.5500000000000006], [0.9443528708772371, 1.375329410940977]],
  [[0.9443528708772365, 1.375329410940977], [0.969783865689786, 1.7253567251610853], [0.7206058308061871, 1.9724926455143315]],
  [[0.7206058308061873, 1.9724926455143315], [-6.845637154536563e-16, 2.1], [-0.7206058308061887, 1.9724926455143315]],
  [[-0.7206058308061889, 1.9724926455143315], [-0.9697838656897876, 1.7253567251610848], [-0.9443528708772381, 1.3753294109409766]],
  [[-0.9443528708772382, 1.3753294109409766], [-0.9526279441628829, 0.5499999999999993], [-1.663246643885392, 0.13016887084596387]],
  [[-1.6632466438853917, 0.1301688708459645], [-1.9790946874247182, -0.022820898712910896], [-2.0685316551964785, -0.36218336716381583]],
  [[-2.068531655196479, -0.36218336716381583], [-1.818653347947321, -1.050000000000002], [-1.3479258243902885, -1.6103092783505175]],
  [[-1.347925824390288, -1.610309278350518], [-1.0093108217349296, -1.702535826448175], [-0.7188937730081535, -1.5054982817869427]],
  [[-0.7188937730081535, -1.5054982817869427], [7.564982820643778e-16, -1.1000000000000003], [0.7188937730081556, -1.5054982817869413]],
  [[0.7188937730081557, -1.5054982817869411], [1.0093108217349327, -1.702535826448173], [1.3479258243902912, -1.6103092783505148]],
  [[1.347925824390291, -1.6103092783505155], [1.8186533479473226, -1.0499999999999998], [2.0685316551964794, -0.3621833671638144]],
  [[2.068531655196479, -0.36218336716381383], [1.9790946874247186, -0.02282089871290927], [1.6632466438853921, 0.13016887084596593]],
];
const v2 = ([x, y]) => `vector(${x}, ${y}) * millimeter`;
const core = `${header}export function core(context is Context, id is Id, definition is map)
{
    var sk = ${onTop};
${M3_ARCS.map(([s, m, e], i) => `    skArc(sk, "a${i}", { "start" : ${v2(s)}, "mid" : ${v2(m)}, "end" : ${v2(e)} });`).join('\n')}
    ${extrude(8.4)}
}`;

// D03's shape (datums, r 133.5..135.5 over 180 degrees): an annular sector,
// two trimmed arcs and two lines. It was refused as 'Print mesh needs full
// circles; face 3 is bounded by a trimmed arc'.
const sector = `${header}export function sector(context is Context, id is Id, definition is map)
{
    const ri = sqrt(100 * 100 + 90 * 90) - 1;
    const ro = sqrt(100 * 100 + 90 * 90) + 1;
    var sk = ${onTop};
    skLineSegment(sk, "l0", { "start" : vector(ri, 0) * millimeter, "end" : vector(ro, 0) * millimeter });
    skArc(sk, "a0", { "start" : vector(ro, 0) * millimeter, "mid" : vector(0, ro) * millimeter, "end" : vector(-ro, 0) * millimeter });
    skLineSegment(sk, "l1", { "start" : vector(-ro, 0) * millimeter, "end" : vector(-ri, 0) * millimeter });
    skArc(sk, "a1", { "start" : vector(-ri, 0) * millimeter, "mid" : vector(0, ri) * millimeter, "end" : vector(ri, 0) * millimeter });
    ${extrude(3)}
}`;

// A teardrop (KS02's outline): one trimmed arc closed by two tangent lines.
const teardrop = `${header}export function teardrop(context is Context, id is Id, definition is map)
{
    var sk = ${onTop};
    skLineSegment(sk, "l0", { "start" : vector(0, 8) * millimeter, "end" : vector(-2 * sqrt(3), 2) * millimeter });
    skArc(sk, "a0", { "start" : vector(-2 * sqrt(3), 2) * millimeter, "mid" : vector(0, -4) * millimeter, "end" : vector(2 * sqrt(3), 2) * millimeter });
    skLineSegment(sk, "l1", { "start" : vector(2 * sqrt(3), 2) * millimeter, "end" : vector(0, 8) * millimeter });
    ${extrude(2)}
}`;

test('arc prisms: the KT1 12-arc core, a D03 sector and a teardrop mesh watertight within the deviation', async () => {
  const { build } = await import('../src/index.mjs');
  for (const [source, feature] of [[core, 'core'], [sector, 'sector'], [teardrop, 'teardrop']]) {
    const body = (await build(source, { feature })).bodies[0];
    assert.ok(body.faces.some(f => f.surface.type === 'cylinder'), `${feature} has no arc sides`);
    for (const deviation of [0.05, 0.01, 0.002]) assertCovered(body, deviation, feature);
  }
});

// ---- refusals stay named ---------------------------------------------------

test('faces outside the covered set are refused by name, never meshed silently', () => {
  // An ellipse edge (an oblique cut of a cylinder) is not sampled here.
  const tube = sweep([[2, 0], [5, 0], [5, 8], [2, 8]]);
  const oblique = structuredClone(tube);
  const circle = oblique.edges.findIndex(e => e.curve.type === 'circle');
  const c = oblique.edges[circle].curve;
  oblique.edges[circle].curve = { type: 'ellipse', origin: c.origin, normal: c.normal, x: c.x, major: c.radius * 1.1, minor: c.radius };
  assert.throws(() => printMesh(kernel, oblique, 0.02), e => e instanceof UnsupportedFeatureError && /ellipse edge/.test(e.message));
  // A spherical face bounded by a line that is neither parallel nor meridian.
  const lune = structuredClone(sweep([arc([0, -3], [0, 0]), [0, 3]], deg(90)));
  const face = lune.faces.findIndex(f => f.surface.type === 'sphere');
  lune.faces[face].surface = { ...lune.faces[face].surface, axis: [1, 0, 0], x: [0, 1, 0] };
  assert.throws(() => printMesh(kernel, lune, 0.02), e => e instanceof UnsupportedFeatureError && /parallels and meridians/.test(e.message));
});

}
