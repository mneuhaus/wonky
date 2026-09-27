import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("bakeoff-harness.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { default: fs } = await import("node:fs");
const { loadBend } = await import("../src/bend-loader.mjs");
const { ensureJobs, loadCases } = await import("../scripts/bakeoff/fixtures.mjs");
const { decodeJob, decodeResult, encodeJob, encodeResult, quantize } = await import("../scripts/bakeoff/jobfmt.mjs");
const { analyticVolume, tessellateLeaf } = await import("../scripts/bakeoff/tessellate.mjs");
const { validateMesh, validateResult } = await import("../scripts/bakeoff/validate.mjs");
const { bendSources, checkGpuMem, compare, gpuMemFor, metalVariant, verdictOf } = await import("../scripts/bakeoff/run.mjs");
const { PROTOTYPES, prototype } = await import("../scripts/bakeoff/prototypes.mjs");
const { checkVerdict, recoverArbitration } = await import("../scripts/bakeoff/recover-check.mjs");
const { ARBITER_PATH, CASE_RECIPES, arbiterFor, arbitrateCase, boxesClosedForm, caseSets, circularSegmentArea, findDisputes, integrate, loadArbiter, pointInMesh } = await import("../scripts/bakeoff/arbiter.mjs");
// Boolean bake-off harness: fixture tessellation, job IO (Bend JS target),
// the validator against deliberately broken meshes, and the null prototype.













const I = { rotate: [], translate: [0, 0, 0] };
const leaf = (prim, params, transform = I) => ({ prim, params, transform });
// Leaf mesh with triangle face indices mapped to tags (positions in t.faces).
const mesh = (t) => {
  const tag = new Map(t.faces.map((f, i) => [f.faceIndex, i]));
  return { vertices: t.vertices, triangles: t.triangles.map(([a, b, c, f]) => [a, b, c, tag.get(f)]) };
};
const faceTable = (t) => t.faces.map((f) => ({ leaf: 0, faceIndex: f.faceIndex, surface: f.surface }));

// Two meshes as one (vertex indices of b shifted).
function concat(a, b) {
  const n = a.vertices.length;
  return { vertices: [...a.vertices, ...b.vertices], triangles: [...a.triangles, ...b.triangles.map(([x, y, z, g]) => [x + n, y + n, z + n, g])] };
}

const unitBox = (min, max) => mesh(tessellateLeaf(leaf('box', { min, max }), 0.01));

test('every primitive tessellates to a closed, oriented, seam-shared mesh on its surfaces', () => {
  const cases = [
    [leaf('box', { min: [0, 0, 0], max: [3, 4, 5] }), 0],
    [leaf('cylinder', { radius: 5, height: 10 }, { rotate: [{ axis: 'x', deg: 17 }], translate: [1, 2, 3] }), 0],
    [leaf('cone', { r1: 4, r2: 1, height: 6 }), 0],
    [leaf('cone', { r1: 0, r2: 3, height: 5 }), 0],
    [leaf('cone', { r1: 3, r2: 0, height: 5 }), 0],
    [leaf('sphere', { radius: 7 }), 0],
    [leaf('torus', { major: 10, minor: 2 }), 1],
    [leaf('prism', { points: [[0, 0], [10, 0], [10, 10], [5, 3], [0, 10]], height: 4 }), 0],
  ];
  for (const [l, genus] of cases) {
    const deviation = 0.01;
    const t = tessellateLeaf(l, deviation);
    const r = validateMesh(mesh(t), { faces: faceTable(t), deviation });
    assert.equal(r.valid, true, `${l.prim}: ${JSON.stringify(r.issues.slice(0, 3))}`);
    assert.equal(r.components, 1, l.prim);
    assert.equal(r.genus, genus, l.prim);
    assert.equal(r.duplicateVertexPositions, 0, `${l.prim}: seams must share vertices`);
    assert.ok(t.deviation.measured <= deviation, `${l.prim}: measured ${t.deviation.measured}`);
    assert.ok(t.deviation.vertexOnSurfaceMax <= 1e-9, l.prim);
    // Mesh volume within area x deviation of the analytic volume.
    assert.ok(Math.abs(r.volume - analyticVolume(l)) <= r.area * deviation + 1e-9, `${l.prim}: volume ${r.volume} vs ${analyticVolume(l)}`);
  }
});

test('committed fixtures are reproducible and every leaf mesh validates', () => {
  const ids = loadCases().map((c) => c.id);
  assert.ok(ids.length >= 32);
  const small = ids.filter((id) => ['hex-nut', 'torus-minus-box', 'tilted-holes-17deg', 'gear-48-bore', 'r10b-g10-union'].includes(id));
  const jobs = ensureJobs(small);
  for (const id of small) {
    const job = decodeJob(fs.readFileSync(jobs[id].job, 'utf8'));
    for (const m of job.meshes) {
      const r = validateMesh(m, { faces: job.faces, deviation: job.deviation });
      assert.equal(r.valid, true, `${id} leaf ${m.leaf}`);
    }
    for (const [i, f] of job.faces.entries()) assert.ok(f.leaf < job.prims.length, `${id} face ${i}`);
  }
});

test('wire reals are lossless F32x2 and the JS codec round-trips', () => {
  for (const x of [0, 1, -1, Math.PI, 1e-7, 123456.789, -93.30000305175781, 2 ** -30]) {
    const q = quantize(x);
    assert.equal(quantize(q), q);
    assert.ok(Math.abs(q - x) <= Math.abs(x) * 2 ** -46, `${x}`);
  }
  const text = fs.readFileSync(ensureJobs(['hex-nut'])['hex-nut'].job, 'utf8');
  assert.equal(encodeJob(decodeJob(text)), text);
  const res = encodeResult({ status: 'ok', mesh: { vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], triangles: [[0, 1, 2, 7]] } });
  assert.deepEqual(decodeResult(res).mesh.triangles, [[0, 1, 2, 7]]);
  assert.deepEqual(decodeResult('unresolved no reason given here\nend\n'), { status: 'unresolved', reason: 'no reason given here' });
  assert.throws(() => decodeResult('okay\n'));
});

test('Bend job/result IO round-trips byte for byte on the JS target', async () => {
  const io = await loadBend(new URL('../kernel/proto/mesh-io.bend', import.meta.url));
  const jobs = ensureJobs(['hex-nut', 'torus-minus-box', 'sphere-minus-box', 'leaf-cylinder']);
  for (const [id, j] of Object.entries(jobs)) {
    for (const file of [j.job, j.csg]) {
      const text = fs.readFileSync(file, 'utf8');
      assert.equal(io.round_trip_job(text), text, `${id} ${file}`);
    }
  }
  const ok = encodeResult({ status: 'ok', mesh: { vertices: [[0, 0, 0], [1.5, -2.25, 1e-3], [0, 1, 0]], triangles: [[0, 1, 2, 3]] } });
  assert.equal(io.round_trip_result(ok), ok);
  assert.equal(io.round_trip_result('unresolved subtract not implemented\nend\n'), 'unresolved subtract not implemented\nend\n');
  const good = fs.readFileSync(jobs['leaf-cylinder'].job, 'utf8');
  for (const bad of [good.replace('nodes 1', 'nodes 2'), good.replace(/\nend\n$/, '\n'), good.replace('face 0 0 cylinder', 'face 0 0 cylindr'), good.slice(0, 200)]) {
    assert.match(io.round_trip_job(bad), /^malformed /);
  }
  assert.equal(io.round_trip_result('ok\nmesh 3 1\n1 2\n'), 'unresolved malformed-result\nend\n');
  // Recover mode: a job immediately followed by a tagged result.
  const hex = fs.readFileSync(jobs['hex-nut'].job, 'utf8');
  const recover = hex + encodeResult({ status: 'ok', mesh: decodeJob(hex).meshes[0] });
  assert.equal(io.round_trip_recover(recover), recover);
});

test('validator accepts a closed box and catches flipped, missing, degenerate and mis-tagged triangles', () => {
  const t = tessellateLeaf(leaf('box', { min: [0, 0, 0], max: [2, 3, 4] }), 0.01);
  const faces = faceTable(t);
  const good = mesh(t);
  const ok = validateMesh(good, { faces, deviation: 0.01 });
  assert.equal(ok.valid, true);
  assert.equal(ok.volume, 24);
  assert.equal(ok.area, 52);
  assert.equal(ok.euler, 2);

  const flipped = { vertices: good.vertices, triangles: good.triangles.map((x, i) => (i === 3 ? [x[0], x[2], x[1], x[3]] : x)) };
  const f = validateMesh(flipped, { faces });
  assert.equal(f.valid, false);
  assert.ok(f.orientationErrors > 0);
  assert.equal(f.watertight, false);

  const holed = { vertices: good.vertices, triangles: good.triangles.slice(1) };
  const h = validateMesh(holed, { faces });
  assert.equal(h.valid, false);
  assert.equal(h.openEdges, 3);

  const degenerate = { vertices: [...good.vertices, [1, 0, 0]], triangles: [...good.triangles, [0, 1, 8, 2]] };
  const d = validateMesh(degenerate, { faces });
  assert.equal(d.valid, false);
  assert.ok(d.degenerateTriangles >= 1);

  const unknownTag = { vertices: good.vertices, triangles: good.triangles.map((x, i) => (i === 0 ? [x[0], x[1], x[2], 99] : x)) };
  assert.equal(validateMesh(unknownTag, { faces }).tags.unknown, 1);
  // Triangle 0 lies on face 0 (x = 0); tag it as face 1 (x = 2).
  const wrongTag = { vertices: good.vertices, triangles: good.triangles.map((x, i) => (i === 0 ? [x[0], x[1], x[2], 1] : x)) };
  const w = validateMesh(wrongTag, { faces, deviation: 0.01 });
  assert.equal(w.valid, false);
  assert.equal(w.tags.offSurfaceCorners, 3);

  // Duplicated vertex positions are welded: a split seam cannot hide a hole.
  const split = { vertices: [...good.vertices, good.vertices[0]], triangles: good.triangles.map((x, i) => (i === 0 ? [8, x[1], x[2], x[3]] : x)) };
  const s = validateMesh(split, { faces });
  assert.equal(s.valid, true);
  assert.equal(s.duplicateVertexPositions, 1);
});

test('validator catches self-intersections, coplanar contact and non-manifold vertices', () => {
  const crossing = concat(unitBox([0, 0, 0], [2, 2, 2]), unitBox([1, 1, 1], [3, 3, 3]));
  const c = validateMesh(crossing);
  assert.equal(c.watertight, true);
  assert.ok(c.selfIntersectingPairs > 0);
  assert.equal(c.valid, false);

  // Two blocks sharing a face but not merged: coplanar contact is invalid.
  const touching = concat(unitBox([0, 0, 0], [1, 1, 1]), unitBox([1, 0, 0], [2, 1, 1]));
  const t = validateMesh(touching);
  assert.ok(t.selfIntersectingPairs > 0);
  assert.equal(t.valid, false);

  // Blocks meeting in one corner: welded, every edge paired, but the corner's
  // fan is two cycles.
  const corner = concat(unitBox([0, 0, 0], [1, 1, 1]), unitBox([1, 1, 1], [2, 2, 2]));
  const k = validateMesh(corner);
  assert.equal(k.nonManifoldVertices, 1);
  assert.equal(k.selfIntersectingPairs, 0);
  assert.equal(k.valid, false);

  // Well separated blocks are fine: two components.
  const apart = validateMesh(concat(unitBox([0, 0, 0], [1, 1, 1]), unitBox([3, 0, 0], [4, 1, 1])));
  assert.equal(apart.valid, true);
  assert.equal(apart.components, 2);
  assert.equal(apart.euler, 4);

  // A tiny dent: one vertex of the top face pushed below the bottom face of a
  // second block stacked on top.
  const top = unitBox([0, 0, 1], [1, 1, 2]);
  top.vertices = top.vertices.map((v) => (v[0] === 1 && v[1] === 1 && v[2] === 1 ? [1, 1, 0.999] : v));
  const dent = validateMesh(concat(unitBox([0, 0, 0], [1, 1, 1]), top));
  assert.ok(dent.selfIntersectingPairs > 0);
});

test('Metal variant marks exactly the call on the device line; scoring rules', () => {
  const src = 'a\n        +o : M.Outcome = P.solve(p) # @bakeoff-device-call\nb';
  assert.equal(metalVariant(src), 'a\n        +o : M.Outcome = P.solve!(p) # @bakeoff-device-call\nb');
  assert.equal(metalVariant('no mark'), 'no mark');
  assert.throws(() => metalVariant(`${src}\n${src}`));
  assert.equal(verdictOf('solid', 'unresolved', null, null), 'unresolved');
  assert.equal(verdictOf('non-manifold-contact', 'unresolved', null, null), 'expected-refusal');
  assert.equal(verdictOf('empty', 'ok', { valid: true, triangles: 0 }, null), 'pass');
  assert.equal(verdictOf('solid', 'ok', { valid: true, triangles: 12 }, { componentsMatch: true, eulerMatch: true, volumeRelErrVsManifold: 1e-9 }), 'pass');
  assert.equal(verdictOf('solid', 'ok', { valid: true, triangles: 12 }, { componentsMatch: false, eulerMatch: true, volumeRelErrVsManifold: 0 }), 'mismatch');
  assert.equal(verdictOf('solid', 'ok', { valid: false, triangles: 12 }, null), 'invalid');
  // An invalid mesh is never an answer, also for a contact case; a lost
  // feature inside the volume bound is caught by the bbox.
  assert.equal(verdictOf('non-manifold-contact', 'ok', { valid: false, triangles: 12 }, null), 'invalid');
  assert.equal(verdictOf('non-manifold-contact', 'ok', { valid: true, triangles: 12 }, null), 'info');
  assert.equal(verdictOf('solid', 'ok', { valid: true, triangles: 12 }, { componentsMatch: true, eulerMatch: true, volumeRelErrVsManifold: 1e-9, bboxMatch: false }), 'mismatch');
});

test('native build keys follow the import closure of native.bend only', () => {
  const files = bendSources('kernel/proto/null/native.bend');
  assert.ok(files.includes('kernel/proto/null/native.bend') && files.includes('kernel/proto/null/main.bend'));
  assert.ok(files.includes('kernel/proto/mesh.bend') && files.includes('kernel/proto/mesh-io.bend') && files.includes('kernel/real.bend'));
  assert.ok(!files.some((f) => f.startsWith('kernel/proto/corefine/')));
  // No prototype's key contains another prototype's directory: an edit in
  // one team's directory never rebuilds another team's binaries.
  const names = Object.keys(PROTOTYPES);
  for (const p of names) {
    const own = bendSources(`kernel/proto/${p}/native.bend`);
    for (const q of names.filter((x) => x !== p)) assert.ok(!own.some((f) => f.startsWith(`kernel/proto/${q}/`)), `${p} build key includes kernel/proto/${q}/`);
    // Generated files (the Metal variant) are never part of the key.
    assert.ok(!own.some((f) => f.includes('.bakeoff-native-metal')), p);
  }
});

test('the Metal device heap is set per prototype and --gpu overrides it', () => {
  assert.equal(prototype('sdf').gpu, '8GB');
  assert.equal(prototype('corefine').gpu, '1GB');
  assert.deepEqual(gpuMemFor(prototype('sdf'), null), { gpuMem: '8GB', gpuSource: 'prototype' });
  assert.deepEqual(gpuMemFor(prototype('exact-plane'), null), { gpuMem: '1GB', gpuSource: 'prototype' });
  assert.deepEqual(gpuMemFor(prototype('sdf'), '2GB'), { gpuMem: '2GB', gpuSource: 'cli' });
  assert.equal(checkGpuMem('on', 't'), 'on');
  assert.equal(checkGpuMem('512MB', 't'), '512MB');
  // The runtime rejects these; `off` would silently run the metal target on the CPU.
  for (const bad of ['off', '2gb', '100KB', '0GB', '1.5GB']) assert.throws(() => checkGpuMem(bad, 't'), bad);
});

test('arbiter geometry: exact point-in-mesh, closed forms and quadrature', () => {
  const box = unitBox([0, 0, 0], [2, 3, 4]);
  assert.equal(pointInMesh([1, 1, 1], box), 'in');
  assert.equal(pointInMesh([1, 1, 4], box), 'on');
  assert.equal(pointInMesh([1, 1, 4 + 1e-13], box), 'out');
  assert.equal(pointInMesh([1, 1, 4 - 1e-13], box), 'in');
  assert.equal(pointInMesh([2, 3, 4], box), 'on');
  assert.ok(Math.abs(circularSegmentArea(2, 0) - 2 * Math.PI) < 1e-15);
  assert.equal(circularSegmentArea(2, 2), 0);
  assert.ok(Math.abs(integrate((x) => x ** 7 - 3 * x, 0, 2) - (2 ** 8 / 8 - 6)) < 1e-12);
  const B = (lo, hi) => ({ lo, hi });
  assert.deepEqual(boxesClosedForm('union', B([0, 0, 0], [1, 1, 1]), B([1 + 1e-9, 0, 0], [2, 1, 1])).shells, 2);
  assert.equal(boxesClosedForm('union', B([0, 0, 0], [2, 2, 2]), B([1, 1, 1], [3, 3, 3])).volume, 15);
  assert.equal(boxesClosedForm('union', B([0, 0, 0], [1, 1, 1]), B([0, 0, 1], [1, 1, 2])).shells, 1);
  assert.throws(() => boxesClosedForm('union', B([0, 0, 0], [1, 1, 1]), B([1, 1, 0], [2, 2, 1])), /edge or vertex contact/);
  const slab = boxesClosedForm('subtract', B([0, 0, 0], [20, 20, 20]), B([-1, -1, 1e-7], [21, 21, 21]));
  assert.equal(slab.shells, 1);
  assert.ok(Math.abs(slab.volume - 4e-5) < 1e-18);
  assert.deepEqual([boxesClosedForm('subtract', B([0, 0, 0], [4, 4, 4]), B([1, 1, 1], [3, 3, 4])).shells, boxesClosedForm('subtract', B([0, 0, 0], [4, 4, 4]), B([1, 1, 1], [3, 3, 3])).shells], [1, 2]);
});

test('oracle arbitration: every committed entry recomputes from the fixtures and confirms one oracle', () => {
  const doc = JSON.parse(fs.readFileSync(ARBITER_PATH, 'utf8'));
  const sets = caseSets();
  const byId = new Map(sets.flatMap((x) => x.cases.map((c) => [c.id, c])));
  assert.equal(doc.entries.length, Object.keys(CASE_RECIPES).length);
  const decisions = {};
  for (const e of doc.entries) {
    const again = { suite: e.suite, ...arbitrateCase(byId.get(e.id), e.oracles, e.dispute) };
    assert.deepEqual(again, e, e.id);
    decisions[e.decision] = (decisions[e.decision] ?? 0) + 1;
    const R = e.reference, m = e.oracles.manifold, o = e.oracles.occt;
    const okM = m.components === R.shells && m.euler === R.euler && Math.abs(m.volume - R.volume) <= R.volumeTolAbs;
    const okO = o.shells === R.shells && Math.abs(o.volume - R.volume) <= R.volumeTolAbs;
    if (e.decision === 'manifold') assert.ok(okM && !okO, e.id);
    if (e.decision === 'occt') assert.ok(okO && !okM, e.id);
    if (e.decision === 'ambiguous') {
      assert.equal(e.class, 'input-rounding', e.id);
      // The rounding displaces the analytically coincident faces by less
      // than 1e-12 mm: far below anything a mesh engine can resolve.
      for (const p of e.evidence.probe) assert.ok(p.maxDistanceFromCarrierMm < 1e-12, e.id);
      assert.ok(e.admissible.length === 2, e.id);
    }
  }
  // manifold: 7 judge-round disputes + the 2 skin-void regressions of fix#1
  // and the 2 of fix#2 (tilted prism face, rotated block).
  assert.deepEqual(decisions, { manifold: 11, occt: 4, expectation: 1, ambiguous: 4 });
  // Coverage against the suite oracles where they were prepared
  // (out/bakeoff/judge2/suites, gitignored): no dispute is unarbitrated.
  if (sets.every((x) => x.reference)) {
    const arb = loadArbiter();
    const open = findDisputes(sets).filter((d) => !arbiterFor(arb, d.id, d.jobSha256));
    assert.deepEqual(open.map((d) => d.id), []);
  }
});

test('scoring with the arbiter: the overruled oracle no longer decides', () => {
  const report = (components, euler, volume) => ({ valid: true, triangles: 12, components, euler, volume, area: 100, bbox: { min: [0, 0, 0], max: [1, 1, 1] } });
  const ref = { deviationMm: 0.01, occt: { volume: 10, area: 100, shells: 1 }, manifold: { volume: 11, area: 100, components: 2, genus: -1, bbox: { min: [0, 0, 0], max: [1, 1, 1] } } };
  const arb = (decision, reference, extra = {}) => ({ decision, class: 'test', reference: { volumeTolAbs: 1e-3, ...reference }, ...extra });
  // Without an arbiter entry neither oracle decides: an answer that agrees
  // with one of them is unarbitrated (not right, not wrong); one that agrees
  // with neither is wrong either way.
  assert.equal(verdictOf('solid', 'ok', report(2, 4, 11), compare(report(2, 4, 11), ref)), 'unarbitrated');
  assert.equal(verdictOf('solid', 'ok', report(1, 2, 10), compare(report(1, 2, 10), ref)), 'unarbitrated');
  assert.equal(verdictOf('solid', 'ok', report(3, 6, 10), compare(report(3, 6, 10), ref)), 'mismatch');
  // Undisputed cases score as before.
  const agreed = { ...ref, occt: { volume: 11, area: 100, shells: 2 } };
  assert.equal(verdictOf('solid', 'ok', report(2, 4, 11), compare(report(2, 4, 11), agreed)), 'pass');
  // OCCT confirmed: its topology and volume decide.
  const occt = arb('occt', { shells: 1, euler: 2, volume: 10 });
  assert.equal(verdictOf('solid', 'ok', report(1, 2, 10), compare(report(1, 2, 10), ref, occt)), 'pass');
  assert.equal(verdictOf('solid', 'ok', report(2, 4, 11), compare(report(2, 4, 11), ref, occt)), 'mismatch');
  // manifold3d confirmed: OCCT's volume bound (area x deviation = 1) no
  // longer admits a wrong volume.
  const mf = arb('manifold', { shells: 2, euler: 4, volume: 11 });
  assert.equal(verdictOf('solid', 'ok', report(2, 4, 11), compare(report(2, 4, 11), ref, mf)), 'pass');
  assert.equal(verdictOf('solid', 'ok', report(2, 4, 10.2), compare(report(2, 4, 10.2), ref, mf)), 'mismatch');
  // Ambiguous: an admissible topology with the reference volume is neither
  // right nor wrong; anything else is still wrong.
  const amb = arb('ambiguous', { shells: 1, euler: 2, volume: 10 }, { admissible: [{ shells: 1, euler: 2 }, { shells: 2, euler: 4 }] });
  assert.equal(verdictOf('solid', 'ok', report(2, 4, 10), compare(report(2, 4, 10), ref, amb)), 'ambiguous');
  assert.equal(verdictOf('solid', 'ok', report(1, 2, 10), compare(report(1, 2, 10), ref, amb)), 'ambiguous');
  assert.equal(verdictOf('solid', 'ok', report(3, 6, 10), compare(report(3, 6, 10), ref, amb)), 'mismatch');
  assert.equal(verdictOf('solid', 'ok', report(1, 2, 12), compare(report(1, 2, 12), ref, amb)), 'mismatch');
  assert.equal(verdictOf('solid', 'ok', { ...report(1, 2, 10), valid: false }, compare(report(1, 2, 10), ref, amb)), 'invalid');
  // An entry computed for another job is not used.
  const map = new Map([['x', { id: 'x', jobSha256: 'aa' }]]);
  assert.equal(arbiterFor(map, 'x', 'bb'), null);
  assert.equal(arbiterFor(map, 'x', 'aa').id, 'x');
});

// Regression (hybrid gate fix#1): the recover grader compared only with
// OCCT's fuzzy CSG, so a wrong topology that OCCT shares (a sealed void under
// a 2e-11 mm skin, opened) was graded exact. Disputed cases are graded
// against the arbiter entry; without one they are unarbitrated, never exact.
test('recover grading: disputed cases follow the arbiter, unarbitrated ones are never exact', () => {
  const ref = { deviationMm: 0.01, jobSha256: 'j', occt: { shells: 1, solids: 1, volume: 3400.0000000013, area: 1840 }, manifold: { components: 2, genus: -1, volume: 3400.000000002, area: 2040 } };
  const opened = { solids: 1, shells: 1, volume: 3400.0000000013, area: 1840, valid: true, interferenceFree: true };
  const sealed = { solids: 1, shells: 2, volume: 3400.000000002, area: 2040, valid: true, interferenceFree: true };
  const row = (o, arbiter) => ({ status: 'ok', expect: 'solid', occt: o, validateStep: { ok: true },
    exact: { volumeRelErrVsOcctCsg: Math.abs(o.volume - ref.occt.volume) / ref.occt.volume, areaRelErrVsOcctCsg: Math.abs(o.area - ref.occt.area) / ref.occt.area, solidsMatch: o.solids === ref.occt.solids, arbitration: recoverArbitration(o, ref, arbiter, 'skin') } });
  // No entry: the opened pocket matches OCCT only -> unarbitrated, not exact.
  const none = new Map();
  assert.equal(checkVerdict(row(opened, none)), 'unarbitrated');
  assert.equal(checkVerdict(row(sealed, none)), 'unarbitrated');
  // The entry confirms manifold3d (closed form: 2 shells).
  const entry = new Map([['skin', { id: 'skin', jobSha256: 'j', decision: 'manifold', class: 'occt-fuzzy', reference: { shells: 2, euler: 4, volume: 3400.000000002, area: 2040, volumeTolAbs: 0.34 } }]]);
  assert.equal(checkVerdict(row(opened, entry)), 'mismatch');
  assert.equal(checkVerdict(row(sealed, entry)), 'exact');
  // An entry for another job is not used.
  assert.equal(checkVerdict(row(opened, new Map([['skin', { ...entry.get('skin'), jobSha256: 'other' }]]))), 'unarbitrated');
  // Undisputed: OCCT decides as before.
  assert.equal(recoverArbitration(opened, { ...ref, manifold: { ...ref.manifold, components: 1, volume: 3400.0000000013 } }, none, 'skin'), null);
});

test('null prototype (Bend JS target) passes a leaf and a disjoint union and refuses overlap', async () => {
  const proto = await loadBend(new URL('../kernel/proto/null/main.bend', import.meta.url));
  const jobs = ensureJobs(['leaf-cylinder', 'disjoint-union', 'box-union-overlap']);
  const reference = JSON.parse(fs.readFileSync(new URL('../fixtures/bakeoff/reference.json', import.meta.url), 'utf8'));
  for (const id of ['leaf-cylinder', 'disjoint-union']) {
    const text = fs.readFileSync(jobs[id].job, 'utf8');
    const out = proto.run(text);
    const v = validateResult(text, out);
    assert.equal(v.status, 'ok', id);
    assert.equal(v.report.valid, true, id);
    const m = reference.cases[id].manifold;
    assert.ok(Math.abs(v.report.volume - m.volume) <= 1e-9 * m.volume, `${id}: ${v.report.volume} vs manifold ${m.volume}`);
    assert.equal(v.report.components, m.components);
  }
  const out = proto.run(fs.readFileSync(jobs['box-union-overlap'].job, 'utf8'));
  assert.match(out, /^unresolved .+\nend\n$/);
  assert.match(proto.run('garbage'), /^unresolved malformed-job /);
});

}
