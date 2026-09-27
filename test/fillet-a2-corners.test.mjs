import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("fillet-a2-corners.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { default: fs } = await import("node:fs");
const { default: path } = await import("node:path");
const { fileURLToPath } = await import("node:url");
const { loadBend } = await import("../src/bend-loader.mjs");
const { loadCases } = await import("../scripts/fillet/cases.mjs");
const { jobPath } = await import("../scripts/fillet/fixtures.mjs");
const { PROBE_CASES } = await import("../scripts/fillet/ladder.mjs");
const { A2_CASES, checkNetwork, constructedJob, decodeNetwork } = await import("../scripts/fillet/network.mjs");
// Focused tests of prototype A "fillet-kpart", stage 2: the corner network
// (kernel/proto/fillet-kpart/corners.bend, docs/fillet/proto-kpart.md
// "Stage A2"). The prototype runs on the Bend JS target;
// scripts/fillet/network.mjs re-checks every tip, corner and consumed face in
// float64 and sums the volume change over cells (stripes between their cut
// planes, corner cells) against the closed forms, OCCT and the Onshape
// probes. Inputs are the harness fixtures, the two Onshape chamfer probes and
// the stage-2 constructed cases (built by the kernel into tmp/fillet/a2/cases).
// Budget: a few seconds (plus the kernel builds of four constructed inputs on
// the first run).












const root = fileURLToPath(new URL('../', import.meta.url));
const mod = await loadBend(path.join(root, 'kernel/proto/fillet-kpart/main.bend'));
const cases = loadCases();
const caseOf = (id) => cases.find((c) => c.id === id) ?? PROBE_CASES.find((c) => c.id === id) ?? A2_CASES.find((c) => c.id === id);
const fileOf = async (id) => (id.startsWith('a2-') ? constructedJob(caseOf(id))
  : id.startsWith('probe-') ? path.join(root, 'tmp/fillet/a1/probes', `${id}.job`) : jobPath(id));
const netOf = async (id) => decodeNetwork(mod.network(fs.readFileSync(await fileOf(id), 'utf8')));
const check = async (id) => checkNetwork(mod, caseOf(id), await fileOf(id), null);
const close = (a, b, tol = 1e-12) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
const closeV = (a, b, tol = 1e-12) => a.forEach((x, i) => close(x, b[i], tol));
const tipAt = (N, e, v) => N.tips.find((t) => t.edge === e && t.vertex === v);

test('every case: the network checks, never admits a must-refuse case, never declines an ok case, and its cells give the closed form', async () => {
  const bad = [];
  const all = [...cases.map((c) => c.id), ...PROBE_CASES.map((c) => c.id), ...A2_CASES.map((c) => c.id)];
  for (const id of all) {
    if (id.startsWith('probe-') && !fs.existsSync(await fileOf(id))) continue; // built by ladder.mjs --probes
    const r = await check(id);
    if (r.issues.length || r.outcome.startsWith('WRONG') || r.outcome === 'declined') bad.push(`${id}: ${r.outcome} ${r.issues.join('; ')}`);
    if (r.volume.eligible && Object.keys(r.volume.closedForm).length && !r.volume.agrees.length) bad.push(`${id}: cell dV ${r.volume.dV}`);
  }
  assert.deepEqual(bad, []);
});

test('run() answers the network: the stage-3 B-rep when it admits, its refusal class otherwise', async () => {
  for (const id of ['pp-box-corner-3-r2', 'a2-setback-mitre-wedge-r1', 'a2-pinched-trapezoid-r5', 'pc-post-top-rim-too-large-r6']) {
    const text = fs.readFileSync(await fileOf(id), 'utf8'), out = mod.run(text), N = decodeNetwork(mod.network(text));
    if (N.verdict.admit) assert.match(out, /^ok\nbrep \d+ \d+ \d+\n/);
    else assert.ok(out.startsWith(`unresolved ${N.verdict.class} `), out);
  }
});

test('caps: circle on a perpendicular cap, ellipse on an oblique one, segment for a chamfer; a curved cap face is refused', async () => {
  const box = await netOf('pp-box-vertical-edge-r2');
  assert.deepEqual(box.tips.map((t) => [t.kind, t.curve.type]), [['cap', 'circle'], ['cap', 'circle']]);
  close(box.tips[0].t1 - box.tips[0].t0, Math.PI / 2);
  // Parallelogram prism: the slanted end walls cut the fillet in ellipses
  // (minor r, major r/|n·d|); the parallel walls keep the length 20 at every
  // section point, so ΔV = −20 r²(1 − π/4).
  const obl = await netOf('a2-oblique-cap-parallelogram-r2');
  assert.deepEqual(obl.tips.map((t) => [t.kind, t.curve.type]), [['cap', 'ellipse'], ['cap', 'ellipse']]);
  obl.tips.forEach((t) => { close(t.curve.minor, 2); close(t.curve.major, 2 / Math.abs(t.cut.normal[0]), 1e-12); });
  close(Math.abs(obl.tips[0].cut.normal[0]), 2 / Math.sqrt(5), 1e-13);
  const r = await check('a2-oblique-cap-parallelogram-r2');
  assert.deepEqual(r.volume.agrees, ['primary']);
  const ch = await netOf('a2-oblique-cap-parallelogram-d1');
  assert.deepEqual(ch.tips.map((t) => t.curve.type), ['line', 'line']);
  // The D-flat's top flat edge ends on the cylinder wall: a space curve.
  const dflat = fs.readFileSync(jobPath('pc-dflat-generator-convex-r1'), 'utf8').replace(/^select .*$/m, 'select 1 2');
  assert.match(mod.run(dflat), /^unresolved not-implemented the cap face 3 at vertex \d+ is a cylinder/);
});

test('mitres: trimmed ellipses on the box top loop, extended ones at the boss root (Onshape FP08), setback mitres trimmed on the shorter blend\'s outer face', async () => {
  const loop = await netOf('pp-box-top-loop-r2');
  assert.equal(loop.tips.length, 8);
  for (const t of loop.tips) {
    assert.equal(t.kind, 'mitre');
    assert.equal(t.curve.type, 'ellipse');
    close(t.curve.minor, 2); close(t.curve.major, 2 * Math.SQRT2, 1e-14);
    close(t.t1 - t.t0, Math.PI / 2, 1e-14);
  }
  // The two tips of a mitre share their end points (the springs meet on the
  // shared face, the outer springs on the third edge) and their ellipse.
  const a = tipAt(loop, 4, 4), b = tipAt(loop, a.with, 4);
  const shared = (t) => (t.at1.kind === 'face' ? t.p1 : t.p2), outer = (t) => (t.at1.kind === 'edge' ? t.p1 : t.p2);
  closeV(shared(a), shared(b), 1e-12); closeV(outer(a), outer(b), 1e-12);
  closeV(a.curve.origin, b.curve.origin, 1e-12);
  const boss = await check('hard-boss-root-concave-mitres-r1');
  assert.deepEqual(boss.volume.agrees, ['extendedMitre']);
  close(boss.volume.dV, 40 * (1 - Math.PI / 4) + 4 * (5 / 3 - Math.PI / 2), 1e-12);
  assert.ok(Math.abs(boss.volume.dV - boss.onshape.dV) < 0.004 && boss.volume.onshape.inRange);
  // Setback mitre (triangular prism): the 90° end blend (sweep π/2) ends in
  // the mitre ellipse at P, where its outer spring meets the mitre plane; the
  // 45° blend (sweep 3π/4) runs over the same ellipse to P and on over the
  // trim circle on the end face (its carrier ∩ the plane x = 20) to its outer
  // spring on the third edge. Both mitre curves share P = (20, 10 − √2, r).
  const wedge = await netOf('a2-setback-mitre-wedge-r1');
  assert.ok(wedge.verdict.admit);
  const short = tipAt(wedge, 3, 4), long = tipAt(wedge, 7, 4);
  assert.equal(short.kind, 'mitre'); assert.equal(long.kind, 'mitre');
  assert.equal(short.trim, undefined);
  assert.deepEqual([long.trim.side, long.trim.face, long.trim.curve.type], [2, 1, 'circle']);
  close(long.trim.curve.radius, 1); close(long.trim.t1 - long.trim.t0, Math.PI / 4, 1e-14);
  close(short.t1 - short.t0, Math.PI / 2, 1e-14); close(long.t1 - long.t0, Math.PI / 2, 1e-14);
  closeV(long.trim.pm, [20, 10 - Math.SQRT2, 1], 1e-13);
  closeV(short.at1.id === long.trim.face ? short.p1 : short.p2, long.trim.pm, 1e-13);
  assert.deepEqual(long.at2, { kind: 'edge', id: 4 });
  // The cells do not cover the trim; the B-rep's own volume (divergence
  // theorem) equals the slice integral.
  const w = await check('a2-setback-mitre-wedge-r1');
  assert.equal(w.volume.eligible, false);
  assert.deepEqual(w.volume.brep.agrees, ['primary']);
  close(w.volume.brep.dV, -26.468981543858696, 1e-11);
  assert.deepEqual(w.issues, []);
});

test('sphere corners: the 3×3 ball, feet on the faces, great arcs; the rank test is exact', async () => {
  const N = await netOf('pp-box-corner-3-r2');
  assert.equal(N.corners.length, 1);
  const c = N.corners[0];
  assert.equal(c.kind, 'sphere');
  closeV(c.centre, [18, 18, 18]);
  assert.deepEqual(c.feet, [[18, 18, 20], [20, 18, 18], [18, 20, 18]]);
  const ends = N.tips.filter((t) => t.vertex === c.vertex);
  assert.equal(ends.length, 3);
  ends.forEach((t) => { assert.equal(t.kind, 'corner-sphere'); closeV(t.curve.origin, c.centre); close(t.t1 - t.t0, Math.PI / 2, 1e-14); });
  // The corner cell of an orthogonal corner is r³(1 − π/6).
  const r = await check('pp-box-corner-3-r2');
  close(r.volume.cells.find((x) => x.corner === c.vertex).dV, -8 * (1 - Math.PI / 6), 1e-12);
  const all = await check('pp-box-all-edges-r2');
  assert.equal(all.corners.length, 8);
  assert.deepEqual(all.volume.agrees, ['primary']);
  // Exact determinant of the stored normals (robust-predicates, base-4096 integers).
  const C = await loadBend(path.join(root, 'kernel/proto/fillet-kpart/corners.bend'));
  const R = (x) => ({ $: 'Real', hi: Math.fround(x), lo: x - Math.fround(x) });
  const V = (p) => ({ $: 'V3', x: R(p[0]), y: R(p[1]), z: R(p[2]) });
  const sign = (a, b, d) => ({ Negative: '-', ExactlyZero: '0', Positive: '+' })[C['../../robust-predicates.sign'](C.det3(V(a), V(b), V(d))).$];
  assert.equal(sign([1, 2, 3], [4, 5, 6], [7, 8, 9]), '0');
  assert.equal(sign([0.6, 0.8, 0], [1, 0, 0], [0, 1, 0]), '0');
  assert.equal(sign([1, 1e-12, 0], [0, 1, 0], [1, 1, 1e-13]), '+');
  assert.equal(sign([0, 1, 0], [1, 0, 0], [0, 0, 1]), '-');
});

test('chamfer corner: Onshape FP-b triangle through the spring meeting points, rectangular chamfer faces', async () => {
  for (const id of ['ch-box-corner-3-d1', 'probe-fp16-chamfer-box-corner-d1']) {
    if (id.startsWith('probe-') && !fs.existsSync(await fileOf(id))) continue;
    const N = await netOf(id), c = N.corners[0];
    assert.equal(c.kind, 'triangle');
    const [p, q, s] = c.feet, d = (x, y) => Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
    close(d(p, q), Math.SQRT2, 1e-12); close(d(q, s), Math.SQRT2, 1e-12);
    // Each chamfer ends at the segment between two feet: a rectangle √2 × 19.
    for (const t of N.tips.filter((x) => x.kind === 'corner-triangle')) close(d(t.p1, t.p2), Math.SQRT2, 1e-12);
    const r = await check(id);
    close(r.volume.dV, -29.333333333333332, 1e-12);
    if (r.volume.onshape) assert.ok(r.volume.onshape.absErr < 1e-9);
  }
});

test('chains: G1 continuations end in one section; the slot loop closes', async () => {
  const N = await netOf('fl-slot-outline-r1');
  assert.equal(N.tips.length, 8);
  for (const t of N.tips) {
    assert.equal(t.kind, 'chain');
    const o = tipAt(N, t.with, t.vertex);
    closeV(t.p1, o.p1, 1e-12); closeV(t.p2, o.p2, 1e-12);
    closeV(t.curve.origin, o.curve.origin, 1e-12);
  }
  const r = await check('fl-slot-outline-r1');
  assert.deepEqual(r.volume.agrees, ['primary']);
});

test('face consumption: full rounds merge, r = face width and the dome are admitted, a pinched face is refused', async () => {
  assert.deepEqual((await netOf('hard-full-round-r5')).consumed, [{ face: 1, kind: 'merge', edge: 4, with: 6 }]);
  assert.deepEqual((await netOf('corpus-notch-trial-r1.5')).consumed.map((k) => k.kind), ['merge']);
  assert.deepEqual((await netOf('hard-single-edge-r-equals-width-r10')).consumed.map((k) => [k.kind, k.with]), [['edge', 9], ['edge', 11]]);
  assert.deepEqual((await netOf('pc-post-top-rim-sphere-r5')).consumed, [{ face: 1, kind: 'axis', edge: 1 }]);
  for (const id of ['hard-full-round-r5', 'corpus-notch-trial-r1.5', 'hard-single-edge-r-equals-width-r10']) {
    const r = await check(id);
    assert.ok(r.volume.onshape.absErr <= 1e-9, `${id}: ${r.volume.dV} vs Onshape ${r.volume.onshape.value}`);
  }
  const pinch = await netOf('a2-pinched-trapezoid-r5');
  assert.equal(pinch.verdict.class, 'face-consumed');
  assert.match(pinch.verdict.reason, /face pinched at a point/);
});

}
