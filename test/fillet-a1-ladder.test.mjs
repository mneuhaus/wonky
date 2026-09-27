import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("fillet-a1-ladder.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { default: fs } = await import("node:fs");
const { default: path } = await import("node:path");
const { fileURLToPath } = await import("node:url");
const { loadBend } = await import("../src/bend-loader.mjs");
const { loadCases } = await import("../scripts/fillet/cases.mjs");
const { jobPath } = await import("../scripts/fillet/fixtures.mjs");
const { PROTO, checkCase, decodeLadder } = await import("../scripts/fillet/ladder.mjs");
// Focused tests of prototype A "fillet-kpart", stage 1: the per-edge ladder
// (kernel/proto/fillet-kpart, docs/fillet/proto-kpart.md). The prototype runs
// on the Bend JS target; scripts/fillet/ladder.mjs re-checks its stripes in
// float64 (contacts on supports and carrier, G1, ball side, setbacks, stripe
// volume against the closed forms). Inputs are the harness fixtures
// (fixtures/fillet/jobs); a few selections are edited in the job text to
// test seams, duplicates, order and propagation. Budget: a few seconds.











const root = fileURLToPath(new URL('../', import.meta.url));
const mod = await loadBend(path.join(root, PROTO));
const cases = loadCases();
const caseOf = (id) => cases.find((c) => c.id === id);
const jobText = (id) => fs.readFileSync(jobPath(id), 'utf8');
const ladderOf = (text) => decodeLadder(mod.ladder(text));
const withSelect = (text, sel) => text.replace(/^select .*$/m, `select ${sel.length} ${sel.join(' ')}`);
const stripe = (L, e) => L.stripes.find((s) => s.edge === e);
const close = (a, b, tol = 1e-12) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test('every case: the ladder never admits a must-refuse case, never declines an ok case, and its stripes check', async () => {
  const bad = [];
  for (const c of cases) {
    const r = await checkCase(mod, c, jobPath(c.id), null);
    if (r.issues.length || r.outcome.startsWith('WRONG') || r.outcome === 'declined') bad.push(`${c.id}: ${r.outcome} ${r.issues.join('; ')}`);
  }
  assert.deepEqual(bad, []);
});

test('run() agrees with the ladder verdict: ok (stage-3 B-rep) when it admits, its typed refusal otherwise', () => {
  for (const id of ['pp-box-vertical-edge-r2', 'pc-post-top-rim-too-large-r6', 'hard-tangent-edge-selection-r1']) {
    const text = jobText(id), out = mod.run(text), L = ladderOf(text);
    if (L.verdict.admit) assert.match(out, /^ok\nbrep \d+ \d+ \d+\n[\s\S]*\nend\n$/);
    else assert.ok(out.startsWith(`unresolved ${L.verdict.class} `), out);
  }
});

test('plane/plane translation rung: exact cylinder, contacts at r·tan(θ/2), widths against the face', () => {
  const L = ladderOf(jobText('pp-box-vertical-edge-r2'));
  const s = stripe(L, 10);
  assert.equal(s.carrier, 'cylinder');
  assert.deepEqual(s.surface.origin, [18, 8, 0]);
  close(s.surface.radius, 2);
  assert.deepEqual(s.sides.map((sd) => sd.contact), [[20, 8, 0], [18, 10, 0]]);
  assert.deepEqual(s.sides.map((sd) => [sd.width, sd.bound, sd.limit, sd.by]), [[2, 'inside', 10, 'edge'], [2, 'inside', 20, 'edge']]);
  assert.deepEqual(s.ends.map((e) => e.kind), ['cap', 'cap']);
  // 150° edge: the contact distance is r·tan(15°), not r. The kernel-built
  // prism is at the nominal angle only to ~1e-8 (its closed form agrees with
  // OCCT to 2e-11 relative, harness.md), hence the tolerance.
  const w = stripe(ladderOf(jobText('pp-convex-150-r2')), 13).sides[0].width;
  close(w, 2 * Math.tan(Math.PI / 12), 1e-6);
});

test('rotation rung: ring torus, spindle torus, and the sphere at r = ρ (a dome that consumes the cap)', () => {
  const t = stripe(ladderOf(jobText('pc-post-top-rim-r1')), 1);
  assert.equal(t.carrier, 'torus');
  close(t.surface.major, 4); close(t.surface.minor, 1);
  assert.deepEqual(t.ends, [{ kind: 'closed' }]);
  const sp = stripe(ladderOf(jobText('pc-post-top-rim-spindle-r3.5')), 1);
  assert.equal(sp.carrier, 'torus');
  close(sp.surface.major, 1.5); close(sp.surface.minor, 3.5);
  const s = stripe(ladderOf(jobText('pc-post-top-rim-sphere-r5')), 1);
  assert.equal(s.carrier, 'sphere');
  assert.deepEqual(s.surface.origin, [0, 0, 5]);
  assert.deepEqual(s.sides.map((sd) => sd.bound), ['consumed', 'inside']);
  assert.equal(s.sides[0].by, 'axis');
  const too = ladderOf(jobText('pc-post-top-rim-too-large-r6'));
  assert.equal(too.verdict.admit, false);
  assert.equal(too.verdict.class, 'radius-too-large');
});

test('chamfers follow Onshape EQUAL_OFFSETS: setback d along each face (FP-a), cones on rims', () => {
  // 60° prism edge, d = 1: contacts 1 mm from the edge in each face, chord 2 sin 30° = 1.
  const s = stripe(ladderOf(jobText('ch-convex-60-d1')), 8);
  assert.equal(s.carrier, 'plane');
  s.sides.forEach((sd) => close(sd.width, 1, 1e-12));
  const [a, b] = s.sides.map((sd) => sd.contact);
  close(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), 1, 1e-6); // input angle 60° to ~1e-8
  const c = stripe(ladderOf(jobText('ch-hole-rim-0.42')), 13);
  assert.equal(c.carrier, 'cone');
  // Box corner with three chamfers: Onshape's corner triangle (FP-b), side √2.
  const L = ladderOf(jobText('ch-box-corner-3-d1'));
  assert.equal(L.corners.length, 1);
  assert.equal(L.corners[0].kind, 'triangle');
  const [p, q] = L.corners[0].points;
  close(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]), Math.SQRT2, 1e-12);
});

test('bounds: overflow and blend overlap are typed refusals; exact consumption is admitted and a full round merges', () => {
  const too = ladderOf(jobText('hard-single-edge-r-too-large-r12'));
  assert.equal(too.verdict.class, 'overflow');
  // Needed and available width in exponent form with their difference
  // (docs/fillet-plan.md §8 step 0).
  assert.match(too.verdict.reason, /needs width 1\.200000000e\+1 .* limits the face to 1\.000000000e\+1 \(short by 2\.000e\+0\)/);
  // Stage 3 turns the thin wall's overlap into a meet (notch.bend); an
  // overlap it cannot resolve stays a typed blend-overlap refusal.
  assert.equal(ladderOf(jobText('hard-overlapping-blends-thin-wall-r1')).verdict.admit, true);
  assert.equal(ladderOf(jobText('hard-short-edge-in-loop-r1')).verdict.class, 'blend-overlap');
  const r10 = ladderOf(jobText('hard-single-edge-r-equals-width-r10'));
  assert.equal(r10.verdict.admit, true);
  assert.deepEqual(stripe(r10, 10).sides.map((sd) => sd.bound), ['consumed', 'consumed']);
  const full = ladderOf(jobText('hard-full-round-r5'));
  assert.equal(full.verdict.admit, true);
  assert.deepEqual(full.merges, [[4, 6, 'full-round']]);
  const notch = ladderOf(jobText('corpus-notch-trial-r1.5'));
  assert.deepEqual(notch.merges, [[20, 21, 'full-round']]);
});

test('tangent edges are refused like Onshape (FP12 FILLET_FAIL_SMOOTH); a near-tangent 178.9° ridge is admitted', () => {
  const t = ladderOf(jobText('hard-tangent-edge-selection-r1'));
  assert.equal(t.verdict.class, 'tangent-edge');
  const n = ladderOf(jobText('hard-near-tangent-ridge-178.9-r2'));
  assert.equal(n.verdict.admit, true);
  assert.ok(stripe(n, 13).sides[0].width < 0.02);
});

test('tangent propagation: on, the slot loop is one G1 chain; off, the lone line stops at an unselected G1 continuation', () => {
  const on = ladderOf(jobText('fl-slot-one-line-propagate-r1'));
  assert.deepEqual(on.order, [4, 5, 6, 7]);
  assert.deepEqual(on.notes, ['propagated 5', 'propagated 6', 'propagated 7']);
  assert.deepEqual(on.stripes.map((s) => s.carrier), ['cylinder', 'torus', 'cylinder', 'torus']);
  assert.ok(on.stripes.every((s) => s.ends.every((e) => e.kind === 'chain')));
  const off = ladderOf(jobText('fl-slot-one-line-no-propagate-r1'));
  assert.deepEqual(off.order, [4]);
  assert.equal(off.verdict.class, 'vertex-blend');
});

test('selection: seams are ignored with a note, duplicates dropped, and the stripe order is recorded ascending', () => {
  const post = jobText('pc-post-top-rim-r1');
  const L = ladderOf(withSelect(post, [2, 1, 1]));
  assert.deepEqual(L.notes, ['duplicate-ignored 1', 'seam-ignored 2']);
  assert.deepEqual(L.order, [1]);
  assert.equal(L.verdict.admit, true);
  const onlySeam = ladderOf(withSelect(post, [2]));
  assert.equal(onlySeam.verdict.class, 'invalid-input');
  const plate = jobText('pp-plate-4-vertical-edges-r4.2');
  const a = mod.ladder(withSelect(plate, [11, 8, 10, 9])), b = mod.ladder(withSelect(plate, [8, 9, 10, 11]));
  assert.equal(a, b);
  assert.deepEqual(decodeLadder(a).order, [8, 9, 10, 11]);
  assert.equal(ladderOf(withSelect(plate, [99])).verdict.class, 'invalid-input');
  assert.equal(mod.run('not a job\n'), 'unresolved invalid-input first line is not wonky-fillet-job 1\nend\n');
});

test('vertex census: trimmed mitres, extended mitres beside an opposite-convexity edge (FP08), sphere corners, mixed convexity refused', () => {
  const loop = ladderOf(jobText('pp-box-top-loop-r2'));
  assert.ok(loop.stripes.every((s) => s.ends.every((e) => e.kind === 'mitre' && e.join === 'trimmed')));
  const boss = ladderOf(jobText('hard-boss-root-concave-mitres-r1'));
  assert.equal(boss.verdict.admit, true);
  assert.ok(boss.stripes.every((s) => s.ends.every((e) => e.kind === 'mitre' && e.join === 'extended')));
  const all = ladderOf(jobText('pp-box-all-edges-r2'));
  assert.equal(all.corners.length, 8);
  assert.ok(all.corners.every((k) => k.kind === 'sphere'));
  assert.equal(ladderOf(jobText('hard-mixed-convexity-corner-r1')).verdict.class, 'mixed-convexity');
  // Coplanar fragments of a planar union do not count as vertex edges.
  const frag = ladderOf(jobText('hard-fillet-after-boolean-fragments-r1'));
  assert.equal(frag.verdict.admit, true);
});

test('stripe-sum volume change matches the closed form, OCCT and the Onshape probes where the stripes are independent', async () => {
  for (const id of ['pc-post-top-rim-spindle-r3.5', 'fl-slot-outline-r1', 'ch-cone-rim-0.42', 'hard-full-round-r5', 'corpus-notch-trial-r1.5', 'hard-single-edge-r-equals-width-r10']) {
    const r = await checkCase(mod, caseOf(id), jobPath(id), null);
    assert.equal(r.volume.eligible, true, id);
    assert.ok(r.volume.agrees.length > 0, `${id}: ${r.volume.dV}`);
    if (r.volume.occt) assert.ok(r.volume.occt.relErr <= 1e-9, id);
    if (r.volume.onshape) assert.ok(r.volume.onshape.absErr <= 1e-9, `${id} vs Onshape ${r.volume.onshape.value}`);
  }
  // The cone rim chamfer measures its setback along the faces (Onshape FP-a,
  // OCCT's in-support value): the catalogue's primary form; the rejected
  // face-offset reading does not agree.
  const cone = await checkCase(mod, caseOf('ch-cone-rim-0.42'), jobPath('ch-cone-rim-0.42'), null);
  assert.deepEqual(cone.volume.agrees, ['primary']);
});

}
