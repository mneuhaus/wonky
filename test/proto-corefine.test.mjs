import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("proto-corefine.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { default: fs } = await import("node:fs");
const { default: path } = await import("node:path");
const { fileURLToPath } = await import("node:url");
const { loadBend } = await import("../src/bend-loader.mjs");
const { buildCase, ensureJobs } = await import("../scripts/bakeoff/fixtures.mjs");
const { decodeJob, decodeResult, encodeJob } = await import("../scripts/bakeoff/jobfmt.mjs");
const { validateResult } = await import("../scripts/bakeoff/validate.mjs");
// Focused tests of the hybrid's mesh stage "corefine" (kernel/hybrid/corefine):
// the tagged symbolic-perturbation mesh Boolean, run on the Bend JS target
// (sequential; native/Metal runs go through `npm run bakeoff -- --proto
// corefine`). Results are checked with the harness validator and against the
// manifold3d / analytic references. Budget: well under 60 s.











const root = fileURLToPath(new URL('../', import.meta.url));
const corefine = await loadBend(path.join(root, 'kernel/hybrid/corefine/main.bend'));
const reference = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/bakeoff/reference.json'), 'utf8')).cases;

const I = { rotate: [], translate: [0, 0, 0] };
const box = (min, max) => ({ prim: 'box', params: { min, max }, transform: I });
const op = (o, a, b) => ({ op: o, children: [a, b] });
const chain = (o, xs) => xs.slice(1).reduce((acc, x) => op(o, acc, x), xs[0]);
const synthetic = (id, csg) => encodeJob(buildCase({ id, deviationMm: 0.01, csg }).job);

// A valid closed mesh: returns the validator report.
function solid(jobText, label) {
  const out = corefine.run(jobText);
  const v = validateResult(jobText, out);
  assert.equal(v.status, 'ok', `${label}: ${v.reason ?? ''}`);
  assert.ok(v.report.valid, `${label}: ${JSON.stringify(v.report.issues).slice(0, 400)}`);
  assert.equal(v.report.tags.unknown, 0, `${label}: unknown tags`);
  assert.equal(v.report.tags.offSurfaceCorners, 0, `${label}: triangle off its tagged surface`);
  return { out, report: v.report };
}

const refusal = (text) => {
  const r = decodeResult(corefine.run(text));
  assert.equal(r.status, 'unresolved', 'expected an explicit refusal');
  return r.reason;
};

// Area per tag of a result mesh (as the runner computes it).
function tagAreas(mesh) {
  const areas = {};
  for (const [a, b, c, tag] of mesh.triangles) {
    const [A, B, C] = [mesh.vertices[a], mesh.vertices[b], mesh.vertices[c]];
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], w = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    areas[tag] = (areas[tag] ?? 0) + Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2;
  }
  return areas;
}

const CORPUS = ['box-union-overlap', 'box-rotated-intersect', 'box-coplanar-union', 'box-coplanar-subtract', 'box-touching-merge',
  'box-touching-partial', 'internal-void', 'disjoint-union', 'plate-through-hole', 'steinmetz-intersect', 'self-union'];

test('corpus cases: valid tagged meshes matching manifold3d to 1e-9 in volume, components and Euler characteristic', () => {
  const jobs = ensureJobs(CORPUS);
  for (const id of CORPUS) {
    const text = fs.readFileSync(jobs[id].job, 'utf8');
    const { report } = solid(text, id);
    const m = reference[id].manifold;
    assert.ok(Math.abs(report.volume - m.volume) <= 1e-9 * m.volume, `${id}: volume ${report.volume} vs ${m.volume}`);
    assert.equal(report.components, m.components, `${id}: components`);
    assert.equal(report.euler, 2 * (1 - m.genus), `${id}: Euler characteristic`);
  }
});

test('every output triangle keeps the tag of the input face it was cut from (per-tag area = manifold3d face-ID area)', () => {
  // No coplanar faces here, so each tag's area is unique.
  const { job } = ensureJobs(['box-union-overlap'])['box-union-overlap'];
  const { out } = solid(fs.readFileSync(job, 'utf8'), 'box-union-overlap');
  const got = tagAreas(decodeResult(out).mesh);
  const want = reference['box-union-overlap'].manifold.tagArea;
  assert.deepEqual(Object.keys(got).sort(), Object.keys(want).sort());
  for (const [tag, area] of Object.entries(want)) assert.ok(Math.abs(got[tag] - area) < 1e-9, `tag ${tag}: ${got[tag]} vs ${area}`);
});

test('the empty result and the tangent contacts: ok/mesh 0 0 and explicit refusals', () => {
  const jobs = ensureJobs(['self-subtract', 'cylinder-tangent-box-face', 'hole-tangent-edge']);
  assert.equal(corefine.run(fs.readFileSync(jobs['self-subtract'].job, 'utf8')), 'ok\nmesh 0 0\nend\n');
  for (const id of ['cylinder-tangent-box-face', 'hole-tangent-edge']) {
    const reason = refusal(fs.readFileSync(jobs[id].job, 'utf8'));
    assert.match(reason, /manifold|triangulation/, `${id}: ${reason}`);
  }
});

test('n-ary union: box-disjoint operands are concatenated, bridged clusters joined by Booleans (exact volume)', () => {
  // Three pairwise disjoint boxes, a bridge overlapping the first two, one
  // more box far away: volume by inclusion-exclusion.
  const csg = chain('union', [
    box([0, 0, 0], [10, 10, 10]), box([20, 0, 0], [30, 10, 10]), box([40, 0, 0], [50, 10, 10]),
    box([5, 2, 2], [25, 8, 8]), box([100, 100, 100], [101, 101, 101]),
  ]);
  const { report } = solid(synthetic('nary-union', csg), 'nary-union');
  const vol = 3 * 1000 + (20 * 6 * 6) - 2 * (5 * 6 * 6) + 1;
  assert.ok(Math.abs(report.volume - vol) < 1e-9 * vol, `${report.volume} vs ${vol}`);
  assert.equal(report.components, 3);
});

test('subtract spine A - B - C - D with overlapping cutters equals A - (B u C u D) (exact volume)', () => {
  const csg = chain('subtract', [
    box([0, 0, 0], [30, 20, 10]), box([5, 5, -1], [15, 15, 11]), box([10, 5, -1], [20, 15, 11]), box([25, -1, 5], [31, 21, 11]),
  ]);
  const { report } = solid(synthetic('sub-spine', csg), 'sub-spine');
  const vol = 30 * 20 * 10 - 15 * 10 * 10 - 5 * 20 * 5;
  assert.ok(Math.abs(report.volume - vol) < 1e-9 * vol, `${report.volume} vs ${vol}`);
});

test('intersection chain and an intersection of apart boxes', () => {
  const csg = chain('intersect', [box([0, 0, 0], [10, 10, 10]), box([2, -1, -1], [11, 8, 11]), box([-1, 3, 1], [9, 11, 9])]);
  const { report } = solid(synthetic('int-chain', csg), 'int-chain');
  const vol = 7 * 5 * 8;
  assert.ok(Math.abs(report.volume - vol) < 1e-9 * vol, `${report.volume} vs ${vol}`);
  const empty = synthetic('int-apart', op('intersect', box([0, 0, 0], [1, 1, 1]), box([5, 5, 5], [6, 6, 6])));
  assert.equal(corefine.run(empty), 'ok\nmesh 0 0\nend\n');
});

test('refusals: malformed job, open operand, CSG-only job (no meshes)', () => {
  assert.match(refusal('wonky-bakeoff-job 1\ncase x\n'), /^malformed-job/);
  const { job, csg } = ensureJobs(['box-union-overlap'])['box-union-overlap'];
  const j = decodeJob(fs.readFileSync(job, 'utf8'));
  j.meshes[1].triangles.pop();
  assert.match(refusal(encodeJob(j)), /not a closed consistently oriented 2-manifold/);
  assert.match(refusal(fs.readFileSync(csg, 'utf8')), /no mesh for a leaf/);
});

test('deterministic: identical bytes on repeated runs', () => {
  const { job } = ensureJobs(['plate-through-hole'])['plate-through-hole'];
  const text = fs.readFileSync(job, 'utf8');
  assert.equal(corefine.run(text), corefine.run(text));
});

// Output gate (kernel/hybrid/corefine/gate.bend, docs/hybrid-boolean-plan.md
// section 8 step 1): results with a non-manifold vertex or an exact
// self-intersection are refused with a named reason, never returned as `ok`.
const adversarial = (file, id) => {
  const spec = JSON.parse(fs.readFileSync(path.join(root, `fixtures/bakeoff/${file}.json`), 'utf8'));
  const c = (spec.cases ?? spec).find((x) => x.id === id);
  assert.ok(c, `${file}: ${id}`);
  return encodeJob(buildCase(c).job);
};

test('gate: point contacts are refused as non-manifold contact (point)', () => {
  const touch = synthetic('vertex-touch', op('union', box([0, 0, 0], [10, 10, 10]), box([10, 10, 10], [20, 20, 20])));
  assert.equal(refusal(touch), 'non-manifold contact (point)');
  assert.equal(refusal(adversarial('adversarial-corefine', 'adv-cone-apex-on-face')), 'non-manifold contact (point)');
  // An edge contact is still refused earlier, by the triangulation.
  const edge = synthetic('edge-touch', op('union', box([0, 0, 0], [10, 10, 10]), box([10, 10, 0], [20, 20, 10])));
  assert.equal(decodeResult(corefine.run(edge)).status, 'unresolved');
});

// The rotated coplanar cases without carrier unification (plan step 4): the
// face table is the only input of the unification decision, so moving the
// coplanar face of the second leaf (the pocket top, or the bottom of the box
// on top) by 1e-9 mm along its normal (far outside 2^-44*scale, the meshes
// unchanged) gives the step-1 answers back.
function deunified(id) {
  const job = decodeJob(adversarial('adversarial-exact-plane', id));
  const face = /union/.test(id) ? 4 : 5;
  const f = job.faces.find((x) => x.leaf === 1 && x.surface.type === 'plane' && x.faceIndex === face);
  assert.ok(f, `${id}: coplanar face of leaf 1`);
  f.surface.o = f.surface.o.map((c, k) => c + 1e-9 * f.surface.n[k]);
  return encodeJob(job);
}

test('gate: rotated coplanar results that self-intersect are refused when their carriers are not unified', () => {
  for (const id of ['adv-ep2-sweep-pocket-3', 'adv-ep2-sweep-pocket-5', 'adv-ep2-sweep-touch-union-5']) {
    assert.equal(refusal(deunified(id)), 'result self-intersects (below 2^-36*scale)', id);
  }
  // The link check runs first: this one also has a non-manifold vertex.
  assert.equal(refusal(deunified('adv-ep2-rot-coplanar-pocket')), 'non-manifold contact (point)');
});

// Carrier unification (kernel/hybrid/unify.bend + corefine/unify.bend, plan
// step 4): plane carriers of two leaves that agree within 2^-44*scale are
// decided as exactly coplanar. The rotated flush pockets and touching unions
// become valid meshes with the exact volume and area of the analytic CSG.
const ROTATED = ['adv-ep2-rot-coplanar-pocket', 'adv-ep2-rot-coplanar-intersect',
  ...[0, 1, 2, 3, 4, 5].flatMap((i) => [`adv-ep2-sweep-pocket-${i}`, `adv-ep2-sweep-touch-union-${i}`])];
const EXACT = { pocket: [3400, 1840], union: [1125, 700], intersect: [1800, 900] };

test('carrier unification: the 14 rotated coplanar cases are valid, one component, exact volume and area', () => {
  for (const id of ROTATED) {
    const { report } = solid(adversarial('adversarial-exact-plane', id), id);
    const [vol, area] = EXACT[/pocket/.test(id) ? 'pocket' : /union/.test(id) ? 'union' : 'intersect'];
    assert.equal(report.components, 1, id);
    assert.ok(Math.abs(report.volume - vol) < 1e-9 * vol, `${id}: volume ${report.volume}`);
    // A membrane or sliver left between the coplanar faces would add area.
    assert.ok(Math.abs(report.area - area) < 1e-9 * area, `${id}: area ${report.area}`);
  }
});

test('carrier unification: a refusal of a job with unified classes names the tolerance', () => {
  // Two rotated rods touching along a line: still a named contact refusal.
  const r = refusal(adversarial('adversarial-exact-plane', 'adv-ep2-rot-cylinders-line-touch'));
  assert.match(r, /; coplanar plane carriers unified within 2\^-44\*scale \(\d+ classes\)$/);
  // Jobs without unified classes keep their exact refusal text.
  assert.equal(refusal(deunified('adv-ep2-rot-coplanar-pocket')), 'non-manifold contact (point)');
});

// Regression (hybrid gate fix#1): carriers whose normals are both exactly
// axis-aligned are never unified. No rotation rounded them, so two such
// planes that differ are distinct planes of the input: a sealed void under a
// skin thinner than the tolerance stays sealed (2 shells), at scale 32 and
// at 1000 mm. The rotated cases above stay unified.
test('carrier unification: exact axis-aligned planes are never unified (sealed void under a 2e-11 mm skin)', () => {
  for (const [id, skin] of [['adv-skin-void-2e-11', 2e-11], ['adv-skin-void-5e-10-at-1000', 5e-10]]) {
    const { report } = solid(adversarial('adversarial-corefine', id), id);
    assert.equal(report.components, 2, `${id}: the void must stay sealed`);
    const vol = 4000 - 100 * (6 - skin), area = 1600 + 200 + 40 * (6 - skin);
    assert.ok(Math.abs(report.volume - vol) < 1e-9 * vol, `${id}: volume ${report.volume}`);
    // An opened pocket loses the skin's two 100 mm2 faces (area 1840).
    assert.ok(Math.abs(report.area - area) < 1e-9 * area, `${id}: area ${report.area}`);
  }
});

// Regression (hybrid gate fix#2): the tolerance is 2^-44*scale, the F32x2
// rounding of one rigid transform with a margin, not more. A sealed void 1e-11
// mm under a tilted face (normal (1,1,0)/sqrt2, not axis-aligned) and under a
// rotated block's top (2^-41.7*scale at scale 32) stays sealed; with 2^-40 it
// was merged and the void opened.
test('carrier unification: a 1e-11 mm skin on tilted or rotated input is not unified', () => {
  const a = 12 - 1e-11 * Math.SQRT2;
  const prism = { volume: 2000 - 3 * a * a, area: 400 + 400 + 200 * Math.SQRT2 + a * a + 6 * a * (2 + Math.SQRT2) };
  const rot = { volume: 4000 - 100 * (6 - 1e-11), area: 1600 + 200 + 40 * (6 - 1e-11) };
  for (const [id, want] of [['adv-skin-void-prism-tilted-1e-11', prism], ['adv-skin-void-rot-1e-11', rot]]) {
    const { report } = solid(adversarial('adversarial-corefine', id), id);
    assert.equal(report.components, 2, `${id}: the void must stay sealed`);
    assert.ok(Math.abs(report.volume - want.volume) < 1e-9 * want.volume, `${id}: volume ${report.volume}`);
    assert.ok(Math.abs(report.area - want.area) < 1e-9 * want.area, `${id}: area ${report.area}`);
  }
});

// The tolerance boundary on a rotated flush pocket (scale 32: 2^-44*32 =
// 1.8e-12 mm): moving the pocket top's face-table carrier by 1e-12 mm keeps
// it unified (valid, one solid); by 4e-12 mm it is no longer unified and the
// step-1 answer comes back.
test('carrier unification: offsets within 2^-44*scale are unified, beyond are not', () => {
  const moved = (d) => {
    const job = decodeJob(adversarial('adversarial-exact-plane', 'adv-ep2-rot-coplanar-pocket'));
    const f = job.faces.find((x) => x.leaf === 1 && x.surface.type === 'plane' && x.faceIndex === 5);
    f.surface.o = f.surface.o.map((c, k) => c + d * f.surface.n[k]);
    return encodeJob(job);
  };
  assert.equal(solid(moved(1e-12), 'moved 1e-12').report.components, 1);
  assert.equal(refusal(moved(4e-12)), 'non-manifold contact (point)');
});

test('gate: touching and coplanar boxes that are valid stay ok (axis-aligned exact planes)', () => {
  // Faces meet exactly in a plane; the pocket floor touches nothing.
  const flush = synthetic('flush-pocket', op('subtract', box([0, 0, 0], [20, 20, 10]), box([5, 5, 4], [15, 15, 10])));
  const { report } = solid(flush, 'flush-pocket');
  assert.ok(Math.abs(report.volume - (4000 - 600)) < 1e-9 * 4000, `${report.volume}`);
  const stack = synthetic('stack', op('union', box([0, 0, 0], [10, 10, 10]), box([2, 2, 10], [8, 8, 15])));
  solid(stack, 'stack');
});

}
