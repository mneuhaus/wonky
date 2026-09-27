import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("fillet-c1-solver.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { default: fs } = await import("node:fs");
const { loadBend } = await import("../src/bend-loader.mjs");
const { encodeReal } = await import("../scripts/bakeoff/jobfmt.mjs");
const { decodeResult } = await import("../scripts/fillet/brepfmt.mjs");
const { loadCases } = await import("../scripts/fillet/cases.mjs");
const { jobPath } = await import("../scripts/fillet/fixtures.mjs");
const { checkCase, decodeSamples, onshapeProbe } = await import("../scripts/fillet/rollingball-c1.mjs");
// Fillet prototype C ("fillet-rollingball"), stage 1: the contact-circle
// solver (docs/fillet/proto-rollingball.md). The Bend solver runs on the JS
// target; scripts/fillet/rollingball-c1.mjs re-checks every station in
// float64 against closed forms, the swept section volume and the Onshape probes.










const proto = await loadBend(new URL('../kernel/proto/fillet-rollingball/main.bend', import.meta.url));
const cases = new Map(loadCases().map((c) => [c.id, c]));
const job = (id) => fs.readFileSync(jobPath(id), 'utf8');
const solve = (text) => ({ result: decodeResult(proto.run(text)), samples: proto.sample(text) });
const check = (id, text = job(id)) => {
  const { result, samples } = solve(text);
  return { result, samples: decodeSamples(samples), rep: checkCase(text, samples, { closedForm: cases.get(id)?.closedForm ?? null }) };
};
// The job with its op, size and selection replaced (same body).
const variant = (id, { op, size, chamfer, select }) => {
  let t = job(id);
  if (op) t = t.replace(/^op \S+$/m, `op ${op}`);
  if (size !== undefined) t = t.replace(/^size .*$/m, `size ${encodeReal(size)}`);
  if (chamfer) t = t.replace(/^chamfer \S+$/m, `chamfer ${chamfer}`);
  if (select) t = t.replace(/^select .*$/m, `select ${select.length} ${select.join(' ')}`);
  return t;
};

test('plane/plane edges: the first 3x3 solve is exact and the swept section is the closed form', () => {
  for (const id of ['pp-box-vertical-edge-r2', 'pp-concave-270-r2', 'hard-single-edge-r9.999', 'hard-full-round-r5']) {
    const { result, samples, rep } = check(id);
    assert.equal(result.status, 'unresolved');
    assert.equal(result.class, 'not-implemented', `${id}: stage 1 builds no B-rep and says so`);
    assert.match(result.reason, /certified to 1e-9 mm/);
    assert.equal(samples.intervals, 32);
    for (const e of samples.edges) assert.equal(e.stations.length, 33);
    assert.ok(rep.summary.solverRes < 1e-12, `${id}: solver certificate ${rep.summary.solverRes}`);
    assert.ok(rep.summary.f64Res < 1e-12, `${id}: float64 re-certification ${rep.summary.f64Res}`);
    assert.ok(rep.summary.closedCentreErr < 1e-12, `${id}: closed-form centre ${rep.summary.closedCentreErr}`);
    assert.ok(rep.summary.closedForm.absErr < 1e-9, `${id}: ΔV ${rep.summary.deltaVolume} vs ${rep.summary.closedForm.deltaVolume}`);
  }
});

test('coaxial rims (torus blends) and the sphere cap certify and give the Pappus volume', () => {
  for (const id of ['pc-hole-rim-r1', 'pc-post-base-concave-r1', 'pc-post-top-rim-spindle-r3.5', 'pc-post-top-rim-sphere-r5', 'pc-cone-rim-r1']) {
    const { samples, rep } = check(id);
    assert.ok(rep.summary.solverRes < 1e-12, `${id}: solver certificate ${rep.summary.solverRes}`);
    assert.ok(rep.summary.f64Res < 1e-12, `${id}: float64 re-certification ${rep.summary.f64Res}`);
    assert.ok(rep.summary.closedCentreErr < 1e-12, `${id}: closed-form centre ${rep.summary.closedCentreErr}`);
    assert.ok(rep.summary.closedForm.absErr < 1e-9, `${id}: ΔV ${rep.summary.deltaVolume} vs ${rep.summary.closedForm.deltaVolume}`);
    assert.equal(samples.edges[0].convexity, id.includes('concave') ? 'concave' : 'convex');
  }
  // Fillet radius = post radius: every ball centre sits on the post axis.
  const { samples } = check('pc-post-top-rim-sphere-r5');
  const P0 = samples.edges[0].stations[0].c;
  for (const st of samples.edges[0].stations) assert.ok(Math.hypot(st.c[0] - P0[0], st.c[1] - P0[1], st.c[2] - P0[2]) < 1e-12);
});

test('a plane meeting a cylinder along a generator: the line-circle section centre', () => {
  for (const id of ['pc-dflat-generator-convex-r1', 'pc-bump-generator-concave-r1']) {
    const { rep } = check(id);
    assert.ok(rep.edges.every((e) => e.section === 'line-circle'), `${id}: ${rep.edges.map((e) => e.section)}`);
    assert.ok(rep.summary.closedCentreErr < 1e-12, `${id}: closed-form centre ${rep.summary.closedCentreErr}`);
    assert.ok(rep.summary.f64Res < 1e-12);
  }
});

test('chamfer setback follows Onshape EQUAL_OFFSETS (probe FP-a): distance along each face, not a face offset', () => {
  // The 120° hex-prism edge chamfered with d = 1 (FP-a is the same edge, L = 20).
  const text = variant('pp-convex-120-hex-r2', { op: 'chamfer', size: 1, chamfer: 'equal-offsets' });
  const { rep, samples } = check('pp-convex-120-hex-r2', text);
  const L = 10, alongFaces = -L * 0.5 * Math.sin((2 * Math.PI) / 3), faceOffset = -L * 0.5 * (1 / Math.sin((2 * Math.PI) / 3)) ** 2 * Math.sin((2 * Math.PI) / 3);
  assert.ok(Math.abs(rep.summary.deltaVolume - alongFaces) < 1e-6, `ΔV ${rep.summary.deltaVolume} vs setback ${alongFaces}`);
  assert.ok(Math.abs(rep.summary.deltaVolume - faceOffset) > 1, 'not the face-offset reading');
  // The job's hexagon vertices are F32-rounded (8.66025447845459 for 10 sin 60°),
  // so the 120° holds to ~1e-7 only.
  const st = samples.edges[0].stations[0];
  assert.ok(Math.abs(Math.hypot(...st.pa.map((x, i) => x - st.pb[i])) - 2 * Math.sin(Math.PI / 3)) < 1e-6, 'chamfer width 2 sin 60°');
  const probe = onshapeProbe('chamfer-semantics-120deg-d1');
  if (probe?.deltaVolume !== null && probe?.deltaVolume !== undefined) {
    assert.ok(Math.abs((rep.summary.deltaVolume / L) * 20 - probe.deltaVolume) < 1e-6, `Onshape FP-a ${probe.deltaVolume}`);
  }
  // The 60° and cone-rim cases match the primary (setback) form of cases.json,
  // not its rejected face-offset alternative.
  for (const id of ['ch-convex-60-d1', 'ch-cone-rim-0.42']) {
    const r = check(id).rep;
    assert.ok(r.summary.f64Res < 1e-12);
    assert.ok(r.summary.closedForm.absErr < 1e-6, `${id}: ${r.summary.deltaVolume}`);
    assert.ok(r.summary.closedForm.alternatives.faceOffset.absErr > 1e-3, id);
  }
});

test('typed refusals: radius above the curvature radius, tangent edge, malformed job', () => {
  assert.equal(solve(job('pc-post-top-rim-too-large-r6')).result.class, 'radius-too-large');
  // Onshape refuses the same selection with FILLET_FAIL_SMOOTH (probe FP12).
  assert.equal(solve(job('hard-tangent-edge-selection-r1')).result.class, 'tangent-edge');
  const bad = solve('wonky-fillet-job 1\ncase x\nop fillet\nsize 0 0\nend\n');
  assert.equal(bad.result.class, 'invalid-input');
  assert.match(bad.samples, /^wonky-fillet-samples 1\ninvalid /);
  assert.equal(solve('something else\n').result.class, 'invalid-input');
});

test('seam edges in the selection are ignored with a note', () => {
  // Edge 14 of pc-hole-rim-r1 is the seam of the hole's cylinder (used twice by one face).
  const both = solve(variant('pc-hole-rim-r1', { select: [13, 14] }));
  assert.equal(both.result.class, 'not-implemented');
  assert.match(both.result.reason, /1 edges, .*seam edges ignored: 14/);
  assert.deepEqual(decodeSamples(both.samples).edges.map((e) => (e.seam ? 'seam' : e.convexity)), ['convex', 'seam']);
  const only = solve(variant('pc-hole-rim-r1', { select: [14] }));
  assert.equal(only.result.class, 'invalid-input');
  assert.match(only.result.reason, /only seam edges/);
});

test('stations are solved independently: a station does not depend on the rest of the selection', () => {
  // The same edge solved alone and inside a four-edge selection gives the same bytes.
  const alone = decodeSamples(proto.sample(variant('pp-box-top-loop-r2', { select: [4] })));
  const loop = decodeSamples(proto.sample(job('pp-box-top-loop-r2')));
  const e = loop.edges.find((x) => x.edge === 4);
  assert.ok(e, 'edge 4 is in the loop selection');
  assert.deepEqual(alone.edges[0].stations, e.stations);
});

}
