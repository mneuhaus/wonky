import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("fillet-rb-fixes.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { default: fs } = await import("node:fs");
const { loadBend } = await import("../src/bend-loader.mjs");
const { decodeResult } = await import("../scripts/fillet/brepfmt.mjs");
const { bsplineEval } = await import("../scripts/fillet/bspline.mjs");
const { ROOT } = await import("../scripts/fillet/cases.mjs");
const { generateCase, jobPath } = await import("../scripts/fillet/fixtures.mjs");
const { curvePoint, dist, dot, faceNormal } = await import("../scripts/fillet/geom.mjs");
const { edgeRange, isoPcurves, toStepFillet } = await import("../scripts/fillet/stepx.mjs");
const { checkResult } = await import("../scripts/fillet/validate.mjs");
// Fillet prototype C ("fillet-rollingball"): regressions of the six defects
// fixed by fix:fillet-rollingball (2026-09-24; docs/fillet/proto-rollingball.md,
// "fix:fillet-rollingball"). The repros are cases of
// fixtures/fillet/adversarial-fillet-rollingball.json (a `regression` record
// on each, adv-rb-fix-* at the limits); their jobs are generated here from
// the FeatureScript inputs, the Bend code runs on the JS target, and the
// checks are the harness validator (no OCCT) plus float64 geometry.












const tori = await loadBend(new URL('../kernel/proto/fillet-rollingball-tori/main.bend', import.meta.url));
const spline = await loadBend(new URL('../kernel/proto/fillet-rollingball-spline/main.bend', import.meta.url));
const adv = JSON.parse(fs.readFileSync(`${ROOT}/fixtures/fillet/adversarial-fillet-rollingball.json`, 'utf8')).cases;
const spec = (id) => adv.find((c) => c.id === id);
const jobs = new Map();
const job = async (id) => {
  if (!jobs.has(id)) jobs.set(id, (await generateCase(spec(id))).job);
  return jobs.get(id);
};
const run = async (proto, id) => {
  const text = await job(id), out = proto.run(text), res = decodeResult(out);
  return { res, rep: res.status === 'ok' ? checkResult(text, out, spec(id)) : null };
};
const refusal = (res) => `${res.class} ${res.reason}`;

test('every repro carries a regression record', () => {
  const ids = adv.filter((c) => c.regression).map((c) => c.id);
  for (const id of ['adv-rb-ridge-normal-1e-5rad', 'adv-rb-hole-near-edge-sampled-overflow', 'adv-rb-tiny-radius-r1e-5', 'adv-rb-cap-tilt-7.6e-7-r1', 'adv-rb-box-r-width-minus-1e-9', 'adv-rb-tiny-edge-1.2e-4-r1']) assert.ok(ids.includes(id), id);
  assert.ok(adv.filter((c) => c.id.startsWith('adv-rb-fix-')).length >= 7);
});

test('D1: a near-tangent ridge (normal angle 1e-5 rad) keeps its blend face outward', async () => {
  for (const id of ['adv-rb-ridge-normal-1e-5rad', 'adv-rb-fix-ridge-normal-1e-5rad-chamfer-d1']) {
    for (const proto of [tori, spline]) {
      const { res, rep } = await run(proto, id);
      assert.equal(res.status, 'ok', `${id}: ${res.status === 'ok' ? '' : refusal(res)}`);
      assert.equal(rep.valid, true, `${id}: ${rep.issues.join('; ')}`);
      // Outward normals of the blend and its support agree along the springs.
      const b = res.body, fi = b.faces.findIndex((f) => f.role === 'blend');
      for (const u of b.faces[fi].loops.flat()) {
        const other = b.faces.findIndex((f, k) => k !== fi && f.role === 'support' && f.loops.flat().some((x) => x.edge === u.edge));
        if (other < 0) continue;
        const e = b.edges[u.edge], p = curvePoint(e.curve, (edgeRange(e, b.vertices)[0] + edgeRange(e, b.vertices)[1]) / 2);
        if (b.faces[fi].surface.type === 'bspline') continue; // the validator's G1 check covers the spline
        assert.ok(dot(faceNormal(b.faces[fi], p), faceNormal(b.faces[other], p)) > 0.999, `${id}: blend normal opposed at edge ${u.edge}`);
      }
    }
  }
});

test('D2: a hole reaching into the strip between samples is an overflow; the clear control builds', async () => {
  for (const proto of [tori, spline]) {
    for (const id of ['adv-rb-hole-near-edge-sampled-overflow', 'adv-rb-fix-hole-rim-near-hole-overflow']) {
      const { res } = await run(proto, id);
      assert.equal(res.status, 'unresolved', id);
      assert.equal(res.class, 'overflow', `${id}: ${refusal(res)}`);
    }
    for (const id of ['adv-rb-hole-near-edge-clear-control', 'adv-rb-fix-hole-rim-near-hole-clear-control']) {
      const { res, rep } = await run(proto, id);
      assert.equal(res.status, 'ok', `${id}: ${res.status === 'ok' ? '' : refusal(res)}`);
      assert.equal(rep.valid, true, `${id}: ${rep.issues.join('; ')}`);
    }
  }
});

test('D3: r = 1e-5 end sections are quarter arcs (not 270°), also on a rim', async () => {
  for (const proto of [tori, spline]) {
    for (const id of ['adv-rb-tiny-radius-r1e-5', 'adv-rb-fix-hole-rim-tiny-r1e-5']) {
      const { res, rep } = await run(proto, id);
      assert.equal(res.status, 'ok', `${id}: ${res.status === 'ok' ? '' : refusal(res)}`);
      assert.equal(rep.valid, true, `${id}: ${rep.issues.join('; ')}`);
      const arcs = res.body.edges.filter((e) => e.curve.type === 'circle' && Math.abs(e.curve.radius - 1e-5) < 1e-12);
      assert.ok(arcs.length >= 1, id);
      for (const e of arcs) {
        const [a, b] = edgeRange(e, res.body.vertices);
        assert.ok(Math.abs(b - a - Math.PI / 2) < 1e-9, `${id}: section sweep ${b - a}`);
      }
    }
  }
});

test('D4: a cap tilted by 7.6e-7 rad is refused naming the needed tolerance; 9.3e-11 rad is built', async () => {
  for (const proto of [tori, spline]) {
    const r = (await run(proto, 'adv-rb-cap-tilt-7.6e-7-r1')).res;
    assert.equal(r.status, 'unresolved');
    assert.equal(r.class, 'vertex-blend');
    assert.match(r.reason, /tilted.*up to 1e-6 mm, above 1e-9 mm/);
    const ok = await run(proto, 'adv-rb-fix-cap-tilt-9.3e-11-r1');
    assert.equal(ok.res.status, 'ok', ok.res.status === 'ok' ? '' : refusal(ok.res));
    assert.equal(ok.rep.valid, true, ok.rep.issues.join('; '));
  }
});

test('D5: a face narrower than 1e-6 mm is consumed; 2e-6 mm is built', async () => {
  for (const proto of [tori, spline]) {
    for (const id of ['adv-rb-box-r-width-minus-1e-9', 'adv-rb-fix-box-r-width-minus-5e-7']) {
      const { res } = await run(proto, id);
      assert.equal(res.status, 'unresolved', id);
      assert.equal(res.class, 'face-consumed', `${id}: ${refusal(res)}`);
    }
    const { res, rep } = await run(proto, 'adv-rb-fix-box-r-width-minus-2e-6');
    assert.equal(res.status, 'ok', res.status === 'ok' ? '' : refusal(res));
    assert.equal(rep.valid, true, rep.issues.join('; '));
  }
});

test('D6: spline STEP carries isoline pcurves within 1e-7 mm of the exact edges; rims state <= 1e-7 mm', () => {
  for (const id of ['pp-box-top-edge-r1', 'pc-hole-rim-r1']) {
    const text = fs.readFileSync(jobPath(id), 'utf8'), res = decodeResult(spline.run(text));
    assert.equal(res.status, 'ok', id);
    const b = res.body, fi = b.faces.findIndex((f) => f.surface.type === 'bspline'), face = b.faces[fi], s = face.surface;
    assert.ok(face.tol <= 1e-7, `${id}: stated ${face.tol}`);
    const uses = face.loops.flat().map((u) => u.edge);
    for (const e of new Set(uses)) {
      const seam = uses.filter((x) => x === e).length > 1, pcs = isoPcurves(s, b.edges[e], b.vertices, seam);
      assert.ok(pcs, `${id}: edge ${e} has an isoline pcurve`);
      for (const pc of pcs) {
        // Evaluate the 2D cubic Bezier pieces at their own parameter (the 3D one).
        let worst = 0;
        for (let j = 0; j + 1 < pc.knots.length; j++) {
          const [t0, t1] = [pc.knots[j], pc.knots[j + 1]], P = pc.poles.slice(3 * j, 3 * j + 4);
          for (let k = 0; k <= 8; k++) {
            const x = k / 8, w = [(1 - x) ** 3, 3 * x * (1 - x) ** 2, 3 * x * x * (1 - x), x ** 3];
            const uv = [0, 1].map((c) => w.reduce((acc, wi, i) => acc + wi * P[i][c], 0));
            const q = bsplineEval(s, uv[0], uv[1]).p, p = curvePoint(b.edges[e].curve, t0 + (t1 - t0) * x);
            worst = Math.max(worst, dist(p, q));
          }
        }
        assert.ok(worst < 1e-7, `${id}: edge ${e} pcurve ${worst} mm off the exact edge`);
      }
    }
    const step = toStepFillet({ backend: { version: 'test' }, bodies: [{ id, ...b }] }, id, 1e-6);
    assert.match(step, /PCURVE\(/);
    assert.match(step, /SURFACE_CURVE\(|SEAM_CURVE\(/);
  }
});

}
