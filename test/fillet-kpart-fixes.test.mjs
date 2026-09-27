import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("fillet-kpart-fixes.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { default: fs } = await import("node:fs");
const { default: path } = await import("node:path");
const { fileURLToPath } = await import("node:url");
const { loadBend } = await import("../src/bend-loader.mjs");
const { decodeResult, encodeJob } = await import("../scripts/fillet/brepfmt.mjs");
const { divVolume } = await import("../scripts/fillet/divvolume.mjs");
const { jobPath } = await import("../scripts/fillet/fixtures.mjs");
const { cross, dist, dot, norm, sub, unit } = await import("../scripts/fillet/geom.mjs");
const { prismBody } = await import("../scripts/fillet/run-adversarial.mjs");
const { checkResult } = await import("../scripts/fillet/validate.mjs");
// Focused tests of the fix:fillet-kpart repairs (docs/fillet/proto-kpart.md,
// "Fix: sphere-corner frame and setback mitres"):
//   - corner balls are framed on their bounding arcs (iso-lines of the sphere,
//     so a STEP reader finds their pcurves exactly);
//   - a trimmed mitre between fillets of unequal sweep is a setback mitre (the
//     longer blend continues over a trim curve on the shorter blend's outer
//     face) instead of a vertex-blend refusal; chamfers stay refused.
// Volumes are the result B-rep's own (scripts/fillet/divvolume.mjs), against
// closed forms derived independently (slice integral, Steiner).














const root = fileURLToPath(new URL('../', import.meta.url));
const mod = await loadBend(path.join(root, 'kernel/proto/fillet-kpart/main.bend'));
const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

const prismJob = (id, op, size, poly, h, select, shear = [0, 0]) => {
  const { body, volume } = prismBody(poly, h, [0, 0, 0], shear);
  return { text: encodeJob({ id, op, size, chamferType: op === 'chamfer' ? 'equal-offsets' : 'none', tangentPropagation: true, body, select }), volume };
};
const run = (text) => {
  const out = mod.run(text);
  assert.match(out, /^ok\n/, out.slice(0, 300));
  return { out, body: decodeResult(out).body };
};

// For each corner sphere: its bounding arcs as {meridian, equator} against its
// axis, and whether the pole (centre + r·axis) is a vertex of the face.
function sphereArcs(body) {
  return body.faces.filter((f) => f.surface.type === 'sphere').map((f) => {
    const s = f.surface, a = unit(s.axis), arcs = f.loops.flat().map((u) => body.edges[u.edge].curve);
    arcs.forEach((c) => { assert.equal(c.type, 'circle'); close(dist(c.origin, s.origin), 0, 1e-12); close(c.radius, s.radius, 1e-12); });
    const pole = s.origin.map((x, i) => x + s.radius * a[i]);
    const verts = f.loops.flat().flatMap((u) => [body.edges[u.edge].start, body.edges[u.edge].end]).map((v) => body.vertices[v]);
    return {
      meridians: arcs.filter((c) => Math.abs(dot(unit(c.normal), a)) < 1e-12).length,
      equators: arcs.filter((c) => norm(cross(unit(c.normal), a)) < 1e-12).length,
      poleAtVertex: verts.some((p) => dist(p, pole) < 1e-9),
    };
  });
}

test('orthogonal corner balls: one arc is the equator, two are meridians meeting at the pole (a patch corner)', () => {
  for (const id of ['pp-box-corner-3-r2', 'pp-box-all-edges-r2', 'corpus-probestab-all-edges-r1']) {
    const { body } = run(fs.readFileSync(jobPath(id), 'utf8'));
    const arcs = sphereArcs(body);
    assert.ok(arcs.length > 0, id);
    for (const x of arcs) assert.deepEqual(x, { meridians: 2, equators: 1, poleAtVertex: true }, id);
  }
  // A box turned 30° about z: the arcs lie in rotated planes, the frame follows.
  const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6);
  const poly = [[0, 0], [20, 0], [20, 10], [0, 10]].map(([x, y]) => [x * c - y * s, x * s + y * c]);
  const j = prismJob('rotated-box', 'fillet', 1, poly, 8, [...Array(12).keys()]);
  const { body } = run(j.text);
  for (const x of sphereArcs(body)) assert.deepEqual(x, { meridians: 2, equators: 1, poleAtVertex: true });
  close(divVolume(body).volume - j.volume, -31.280244880340433, 1e-9);
});

test('oblique corner balls: two arcs are meridians meeting at the pole; no frame makes the third an iso-line', () => {
  // Parallelepiped sheared by (3, 2): no arc plane of a corner is
  // perpendicular to the other two. Steiner on the inner parallel body.
  const j = prismJob('sheared-box', 'fillet', 1, [[0, 0], [20, 0], [20, 12], [0, 12]], 10, [...Array(12).keys()], [3, 2]);
  const { out, body } = run(j.text);
  const arcs = sphereArcs(body);
  assert.equal(arcs.length, 8);
  for (const x of arcs) assert.deepEqual(x, { meridians: 2, equators: 0, poleAtVertex: true });
  close(divVolume(body).volume - j.volume, -38.78196966685982, 1e-9);
  const r = checkResult(j.text, out, { op: 'fillet', size: 1, blendTypes: ['cylinder', 'sphere'] });
  assert.deepEqual(r.issues, []);
});

test('setback mitre: the 45° blend runs on over a trim circle on the 90° blend\'s outer face; the volume is the slice integral', () => {
  // Triangular prism along z; the face y = 0 is shared by its bottom edge
  // (90°, sweep π/2) and its vertical edge at x = 10 (45°, sweep 3π/4); the
  // third edge (bottom of the slanted face) is convex: a trimmed mitre.
  const j = prismJob('setback-wedge', 'fillet', 1, [[0, 0], [10, 0], [0, 10]], 20, [0, 7]);
  const { out, body } = run(j.text);
  const r = checkResult(j.text, out, { op: 'fillet', size: 1, blendTypes: ['cylinder'] });
  assert.deepEqual(r.issues, []);
  assert.deepEqual(body.faces.map((f) => f.surface.type).sort(), ['cylinder', 'cylinder', 'plane', 'plane', 'plane', 'plane', 'plane']);
  // The bottom face (the 90° blend's outer face) gains the trim: an arc of the
  // vertical blend's circle (radius 1, centre on its axis x = 10 - 1 - √2, y = 1).
  const bottom = body.faces.find((f) => f.surface.type === 'plane' && Math.abs(unit(f.surface.normal)[2]) > 0.999 && Math.abs(f.surface.origin[2]) < 1e-12);
  const trims = bottom.loops.flat().map((u) => body.edges[u.edge].curve).filter((c) => c.type === 'circle');
  assert.equal(trims.length, 1);
  close(trims[0].radius, 1, 1e-12);
  close(dist(trims[0].origin, [10 - 1 - Math.SQRT2, 1, 0]), 0, 1e-12);
  // The mitre curve between the two blends is an ellipse (bisector plane).
  const blends = body.faces.filter((f) => f.surface.type === 'cylinder').map((f) => new Set(f.loops.flat().map((u) => u.edge)));
  const shared = [...blends[0]].filter((e) => blends[1].has(e)).map((e) => body.edges[e].curve.type);
  assert.deepEqual(shared, ['ellipse']);
  close(divVolume(body).volume - j.volume, -26.468981543858696, 1e-9);
});

test('setback mitres stay refused for chamfers (not probed in Onshape), typed and named', () => {
  const j = prismJob('setback-wedge-d1', 'chamfer', 1, [[0, 0], [10, 0], [0, 10]], 20, [0, 7]);
  assert.match(mod.run(j.text), /^unresolved vertex-blend mitre of edges \d+ and \d+ at vertex \d+ needs a setback patch: the outer springs end \d\.\d{3}e[+-]\d+ apart on edge \d+\nend\n$/);
});

test('refusal reasons name the needed and the available value and their difference in exponent form (plan §8 step 0)', async () => {
  const { resolveSelection } = await import('../scripts/fillet/fixtures.mjs');
  // adv-step-1e-7-front-top-edges-r1: a 1e-7 mm step between two front faces;
  // the two top-front blends overlap by exactly the step.
  const poly = [[0, 0], [10, 0], [10, -1e-7], [20, -1e-7], [20, 10], [0, 10]];
  const { body } = prismBody(poly, 8);
  const select = resolveSelection(body, [{ near: [5, 0, 8] }, { near: [15, -1e-7, 8] }]);
  const out = mod.run(encodeJob({ id: 'step-1e-7', op: 'fillet', size: 1, chamferType: 'none', tangentPropagation: true, body, select }));
  assert.match(out, /^unresolved blend-overlap .*needs width 1\.000000000e\+0 but the spring of edge \d+ lies at 9\.999999000e-1 \(short by 1\.000e-7; blends overlap\)/);
  // A post rim 1e-7 above the largest feasible radius (r = rho gives the sphere).
  const post = fs.readFileSync(jobPath('pc-post-top-rim-too-large-r6'), 'utf8');
  assert.match(mod.run(post), /^unresolved radius-too-large ball centre crosses the axis \(torus major -1\.000000000e\+0 < 0: the radius exceeds the largest feasible by 1\.000e\+0\)/);
});

}
