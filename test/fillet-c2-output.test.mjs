import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("fillet-c2-output.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { default: fs } = await import("node:fs");
const { default: path } = await import("node:path");
const { loadBend } = await import("../src/bend-loader.mjs");
const { encodeReal } = await import("../scripts/bakeoff/jobfmt.mjs");
const { decodeResult, encodeResult } = await import("../scripts/fillet/brepfmt.mjs");
const { bsplineClosest, bsplineEval } = await import("../scripts/fillet/bspline.mjs");
const { ROOT, loadCases } = await import("../scripts/fillet/cases.mjs");
const { jobPath } = await import("../scripts/fillet/fixtures.mjs");
const { dist, edgeSamples, pointSurfaceDistance } = await import("../scripts/fillet/geom.mjs");
const { blendFaces, splineDeviation } = await import("../scripts/fillet/rollingball-c2.mjs");
const { toStepFillet } = await import("../scripts/fillet/stepx.mjs");
const { checkResult } = await import("../scripts/fillet/validate.mjs");
// Fillet prototype C ("fillet-rollingball"), stage 2: the two output variants
// (docs/fillet/proto-rollingball.md, "Stage C2"). Both build the full body
// from the certified contact circles of stage 1 and label every blend face
// approximate with its stated tolerance:
//   fillet-rollingball-tori    the spine fitted by arcs: cylinder, torus, sphere (plane, cone for chamfers)
//   fillet-rollingball-spline  a B-spline skinned through the station sections
// The Bend code runs on the JS target; the checks are the harness validator
// (scripts/fillet/validate.mjs, without the OCCT measurement) and float64
// geometry from scripts/fillet/geom.mjs and bspline.mjs.















const tori = await loadBend(new URL('../kernel/proto/fillet-rollingball-tori/main.bend', import.meta.url));
const spline = await loadBend(new URL('../kernel/proto/fillet-rollingball-spline/main.bend', import.meta.url));
const cases = new Map(loadCases().map((c) => [c.id, c]));
const job = (id) => fs.readFileSync(jobPath(id), 'utf8');
const variant = (id, { op, size, chamfer, select }) => {
  let t = job(id);
  if (op) t = t.replace(/^op \S+$/m, `op ${op}`);
  if (size !== undefined) t = t.replace(/^size .*$/m, `size ${encodeReal(size)}`);
  if (chamfer) t = t.replace(/^chamfer \S+$/m, `chamfer ${chamfer}`);
  if (select) t = t.replace(/^select .*$/m, `select ${select.length} ${select.join(' ')}`);
  return t;
};
// Run a variant and validate its body like the harness does (no OCCT).
const build = (proto, id, text = job(id)) => {
  const out = proto.run(text);
  const res = decodeResult(out);
  const rep = res.status === 'ok' ? checkResult(text, out, cases.get(id) ?? null) : null;
  return { out, res, rep };
};
const nIn = (text) => Number(/^brep \d+ (\d+)/m.exec(text)[1]);

test('tori: a straight plane/plane edge becomes a cylinder, stated approximate at 1e-9 mm', () => {
  const { res, rep } = build(tori, 'pp-box-vertical-edge-r2');
  assert.equal(res.status, 'ok');
  assert.deepEqual(rep.issues, []);
  assert.equal(rep.valid, true);
  assert.deepEqual(rep.topology, { vertices: 10, edges: 15, faces: 7, loops: 7, shells: 1, genus: 0 });
  const [bf] = blendFaces(res.body, 12);
  assert.equal(bf.edge, 10);
  assert.equal(bf.face.surface.type, 'cylinder');
  assert.equal(bf.face.surface.radius, 2);
  assert.ok(bf.face.tol > 0 && bf.face.tol <= 1e-8, `stated tolerance ${bf.face.tol}: never exact, never loose`);
  assert.equal(res.body.faces.filter((f) => f.role === 'cap').length, 2);
  assert.equal(rep.tangency.springEdges, 2);
  assert.ok(rep.tangency.maxSpringAngleRad < 1e-9);
  // The springs sit at r cot(45°) = 2 from the box edge x = 20, y = 10.
  const springs = res.body.edges.filter((e, i) => i === 10 || i >= 12).filter((e) => e.curve.type === 'line' && Math.abs(e.curve.direction[2]) > 0.99);
  const offs = springs.map((e) => Math.hypot(res.body.vertices[e.start][0] - 20, res.body.vertices[e.start][1] - 10)).sort();
  assert.deepEqual(offs.map((x) => Math.round(x * 1e9) / 1e9), [2, 2]);
});

test('tori: rims become tori, the sphere cap drops the top disc, cone rims get cone chamfers', () => {
  const hole = build(tori, 'pc-hole-rim-r1');
  assert.equal(hole.rep.valid, true, hole.rep.issues.join('; '));
  const [t] = blendFaces(hole.res.body, nIn(job('pc-hole-rim-r1')));
  assert.equal(t.face.surface.type, 'torus');
  assert.ok(Math.abs(t.face.surface.minor - 1) < 1e-12);
  assert.ok(t.face.tol > 0 && t.face.tol <= 1e-8);
  // Fillet radius = post radius: one sphere, the top disc is gone, the pole is a vertex.
  const cap = build(tori, 'pc-post-top-rim-sphere-r5');
  assert.equal(cap.rep.valid, true, cap.rep.issues.join('; '));
  assert.deepEqual(cap.res.body.faces.map((f) => `${f.role}:${f.surface.type}`), ['support:plane', 'support:cylinder', 'blend:sphere']);
  assert.ok(cap.res.body.vertices.some((v) => dist(v, [0, 0, 10]) < 1e-12), 'the pole');
  // The sphere's axis runs to the pole, so the section edge is its u = 0 seam.
  const s = cap.res.body.faces[2].surface;
  assert.ok(dist(s.axis, [0, 0, 1]) < 1e-12 && Math.abs(s.radius - 5) < 1e-12);
  const cone = build(tori, 'ch-cone-rim-0.42');
  assert.equal(cone.rep.valid, true, cone.rep.issues.join('; '));
  assert.equal(blendFaces(cone.res.body, nIn(job('ch-cone-rim-0.42')))[0].face.surface.type, 'cone');
});

test('chamfer: Onshape EQUAL_OFFSETS setback (probe FP-a) on the 120° hex edge', () => {
  const text = variant('pp-convex-120-hex-r2', { op: 'chamfer', size: 1, chamfer: 'equal-offsets' });
  const { res, rep } = build(tori, 'pp-convex-120-hex-r2', text);
  assert.equal(rep.valid, true, rep.issues.join('; '));
  const [bf] = blendFaces(res.body, nIn(text));
  assert.equal(bf.face.surface.type, 'plane');
  // Width 2 sin 60° between the springs (the face-offset reading gives 2 cos 30° / sin 60° = 2).
  const loop = bf.face.loops[0].map((u) => res.body.edges[u.edge]);
  const sections = loop.filter((e) => e.curveRange && Math.abs(e.curveRange[1] - e.curveRange[0] - 2 * Math.sin(Math.PI / 3)) < 1e-6);
  assert.equal(sections.length, 2, `section lengths ${loop.map((e) => e.curveRange?.[1])}`);
});

test('spline: a B-spline whose stated tolerance bounds its distance from the tori face', () => {
  for (const id of ['pp-box-vertical-edge-r2', 'pc-hole-rim-r1', 'pc-post-top-rim-sphere-r5']) {
    const s = build(spline, id), t = build(tori, id);
    assert.equal(s.rep.valid, true, `${id}: ${s.rep.issues.join('; ')}`);
    assert.equal(s.rep.surfaces.exact, false);
    const n = nIn(job(id));
    const [sb] = blendFaces(s.res.body, n), [tb] = blendFaces(t.res.body, n);
    assert.equal(sb.face.surface.type, 'bspline');
    assert.equal(sb.face.surface.du, 3);
    assert.ok(sb.face.tol > 0 && sb.face.tol <= 1e-3, `${id}: tol ${sb.face.tol}`);
    const d = splineDeviation(sb.face.surface, tb.face.surface);
    assert.ok(d <= sb.face.tol + tb.face.tol, `${id}: B-spline ${d} mm from the ${tb.face.surface.type}, stated ${sb.face.tol}`);
    // Same topology as the tori variant: only the blend surface differs.
    assert.deepEqual(s.rep.topology, t.rep.topology);
    // The format extension round-trips (values; Bend's F32x2 words are not
    // always in the encoder's canonical split, so bytes may differ).
    const again = decodeResult(encodeResult({ status: 'ok', body: s.res.body })).body;
    const sp = (b) => b.faces.find((f) => f.surface.type === 'bspline').surface;
    assert.deepEqual(sp(again).poles, sp(s.res.body).poles);
    assert.deepEqual(sp(again).knotsV, sp(s.res.body).knotsV);
  }
  const box = build(spline, 'pp-box-vertical-edge-r2');
  const step = toStepFillet({ backend: { version: 'test' }, bodies: [{ id: 'b', ...box.res.body }] }, 'b', 1e-6);
  assert.match(step, /B_SPLINE_SURFACE_WITH_KNOTS\('',3,3,/);
});

test('typed refusals: overflow and consumption (notch first), overlap, vertex blends, tangent edge, radius', () => {
  const cls = (id) => decodeResult(tori.run(job(id)));
  const expect = {
    'corpus-notch-trial-r6': 'overflow', // must-refuse
    'corpus-notch-trial-r3': 'face-consumed', // Onshape builds it (FP01): notch first, refused here
    'hard-single-edge-r-too-large-r12': 'overflow', // must-refuse
    'hard-chamfer-exceeds-both-faces-d5': 'overflow', // must-refuse
    'hard-single-edge-r-equals-width-r10': 'face-consumed',
    'hard-full-round-r5': 'face-consumed',
    'hard-overlapping-blends-thin-wall-r1': 'blend-overlap',
    'pp-box-top-loop-r2': 'vertex-blend',
    'hard-tangent-edge-selection-r1': 'tangent-edge', // Onshape FP12: FILLET_FAIL_SMOOTH
    'pc-post-top-rim-too-large-r6': 'radius-too-large', // must-refuse
  };
  for (const [id, c] of Object.entries(expect)) {
    const r = cls(id);
    assert.equal(r.status, 'unresolved', id);
    assert.equal(r.class, c, `${id}: ${r.reason}`);
    assert.ok(r.knownClass);
    assert.equal(decodeResult(spline.run(job(id))).class, c, `${id}: both variants refuse alike`);
  }
  // Seam edges are ignored with a note; a selection of seams only is invalid input.
  const seam = decodeResult(tori.run(variant('pc-hole-rim-r1', { select: [14] })));
  assert.equal(seam.class, 'invalid-input');
  assert.match(seam.reason, /only seam edges.*seam edges ignored: 14/);
});

test('bspline evaluation: clamped Bezier patch, derivatives and closest point', () => {
  // Bicubic patch of the plane z = x + 2y over [0,3]^2 (poles on a grid).
  const poles = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) poles.push([i, j, i + 2 * j]);
  const s = { type: 'bspline', du: 3, dv: 3, nu: 4, nv: 4, knotsU: [0, 0, 0, 0, 1, 1, 1, 1], knotsV: [0, 0, 0, 0, 1, 1, 1, 1], poles };
  const e = bsplineEval(s, 0.25, 0.5);
  assert.ok(dist(e.p, [0.75, 1.5, 0.75 + 3]) < 1e-12);
  assert.ok(dist(e.su, [3, 0, 3]) < 1e-12 && dist(e.sv, [0, 3, 6]) < 1e-12);
  const q = [1, 1, 3 + 0.6], c = bsplineClosest(s, q);
  assert.ok(Math.abs(c.distance - 0.6 / Math.sqrt(6)) < 1e-12);
  assert.ok(Math.abs(pointSurfaceDistance(s, q) - 0.6 / Math.sqrt(6)) < 1e-12);
});

test('targets agree: the JS bytes equal the harness native results where present', (t) => {
  let compared = 0;
  for (const [proto, v] of [[tori, 'tori'], [spline, 'spline']]) {
    for (const id of ['pp-box-vertical-edge-r2', 'pc-hole-rim-r1', 'corpus-notch-trial-r3']) {
      const native = path.join(ROOT, 'out/fillet', `fillet-rollingball-${v}`, 'results', `${id}.cpu1.result`);
      if (!fs.existsSync(native)) continue;
      assert.equal(proto.run(job(id)), fs.readFileSync(native, 'utf8'), `${v} ${id}`);
      compared++;
    }
  }
  if (!compared) t.skip('no harness results yet (node scripts/fillet/run.mjs --proto fillet-rollingball-tori)');
});

test('stations and fits: the same edge alone or in a selection gives the same blend face', () => {
  const four = decodeResult(tori.run(job('pp-plate-4-vertical-edges-r4.2'))).body;
  const text = variant('pp-plate-4-vertical-edges-r4.2', { select: [9] });
  const one = decodeResult(tori.run(text)).body;
  const n = nIn(text);
  const a = blendFaces(four, n).find((b) => b.edge === 9), b = blendFaces(one, n)[0];
  assert.deepEqual(a.face.surface, b.face.surface);
  assert.equal(a.face.tol, b.face.tol);
  const samples = (body, bf) => body.faces[bf.index].loops[0].flatMap((u) => edgeSamples(body.edges[u.edge], body.vertices, 4).map((s) => s.p));
  assert.deepEqual(samples(four, a), samples(one, b));
});

}
