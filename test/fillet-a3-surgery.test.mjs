import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("fillet-a3-surgery.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { default: fs } = await import("node:fs");
const { default: path } = await import("node:path");
const { spawnSync } = await import("node:child_process");
const { fileURLToPath } = await import("node:url");
const { loadBend } = await import("../src/bend-loader.mjs");
const { decodeJob, decodeResult } = await import("../scripts/fillet/brepfmt.mjs");
const { loadCases } = await import("../scripts/fillet/cases.mjs");
const { jobPath } = await import("../scripts/fillet/fixtures.mjs");
const { dist, faceNormal, pointSurfaceDistance } = await import("../scripts/fillet/geom.mjs");
const { checkResult, occtMeasure, resultStep } = await import("../scripts/fillet/validate.mjs");
// Focused tests of prototype A "fillet-kpart", stage 3: the local B-rep
// surgery (kernel/proto/fillet-kpart/surgery.bend, docs/fillet/proto-kpart.md
// "Stage A3"). The prototype runs on the Bend JS target; results are checked
// with the harness validator's synchronous part (topology, geometry on the
// surfaces, exact blend types, G1 springs) and, where uv is available, with
// OCCT volumes against the closed forms. Budget: a few seconds (OCCT batch
// about 5 s).














const root = fileURLToPath(new URL('../', import.meta.url));
const mod = await loadBend(path.join(root, 'kernel/proto/fillet-kpart/main.bend'));
const cases = loadCases();
const caseOf = (id) => cases.find((c) => c.id === id);
const jobOf = (id) => fs.readFileSync(jobPath(id), 'utf8');
const bodyOf = (id) => {
  const out = mod.run(jobOf(id));
  assert.match(out, /^ok\n/, `${id}: ${out.slice(0, 200)}`);
  return decodeResult(out).body;
};
const types = (b, role) => b.faces.filter((f) => !role || f.role === role).map((f) => f.surface.type).sort();
const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
// Admitted either cases (Onshape builds all of them: probes FP01-FP05,
// FP07-FP10, FP13).
const NOTCHES = ['hard-overflow-convex-small-face-r2', 'hard-overflow-narrow-ledge-r0.4', 'hard-concave-rim-overflow-r6.5',
  'hard-overlapping-blends-thin-wall-r1', 'corpus-notch-trial-r3'];
const EITHER_BUILT = ['corpus-notch-trial-r1.5', 'hard-single-edge-r-equals-width-r10', 'hard-full-round-r5',
  'hard-boss-root-concave-mitres-r1', 'hard-near-tangent-ridge-178.9-r2', ...NOTCHES];
const ONSHAPE = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/fillet/reference.json'), 'utf8')).onshape.cases;

test('every case: ok cases give a valid exact B-rep, must-refuse cases a typed refusal, and the result is deterministic', () => {
  const bad = [];
  for (const c of cases) {
    const text = jobOf(c.id), out = mod.run(text);
    if (out !== mod.run(text)) bad.push(`${c.id}: two runs differ`);
    if (c.expect === 'must-refuse') { if (!out.startsWith('unresolved ')) bad.push(`${c.id}: must refuse`); continue; }
    if (!out.startsWith('ok\n')) {
      if (c.expect === 'ok' || EITHER_BUILT.includes(c.id)) bad.push(`${c.id}: ${out.split('\n')[0]}`);
      else assert.match(out, /^unresolved [a-z-]+ .+\nend\n$/);
      continue;
    }
    const r = checkResult(text, out, c);
    // The r = face width case consumes both supports: the blend meets only
    // the far faces, so the validator's "at least one G1 spring" rule has no
    // spring to see (checked separately below).
    const issues = r.issues.filter((m) => !(c.id === 'hard-single-edge-r-equals-width-r10' && m.startsWith('no G1 spring')));
    if (issues.length) bad.push(`${c.id}: ${issues.slice(0, 2).join('; ')}`);
    if (!r.surfaces.exact) bad.push(`${c.id}: approximated faces`);
    if (r.surfaces.blendTypesMatch === false) bad.push(`${c.id}: blend types ${r.surfaces.exactBlendTypes}`);
  }
  assert.deepEqual(bad, []);
});

test('single edge: the supports end at the springs, the caps take quarter circles, one exact cylinder', () => {
  const b = bodyOf('pp-box-top-edge-r1');
  assert.deepEqual(types(b), ['cylinder', 'plane', 'plane', 'plane', 'plane', 'plane', 'plane']);
  assert.deepEqual([b.vertices.length, b.edges.length, b.faces.length], [10, 15, 7]);
  const cyl = b.faces.find((f) => f.role === 'blend').surface;
  close(cyl.radius, 1, 0);
  // The top face now ends at y = 1, the front face at z = 7.
  const top = b.faces.find((f) => f.surface.type === 'plane' && Math.abs(f.surface.origin[2] - 8) < 1e-12 && f.surface.normal[2] > 0);
  const ys = top.loops[0].flatMap((u) => [b.edges[u.edge].start, b.edges[u.edge].end]).map((v) => b.vertices[v][1]);
  close(Math.min(...ys), 1, 1e-12);
  // The two cap faces each carry one quarter circle of radius 1.
  const arcs = b.edges.filter((e) => e.curve.type === 'circle');
  assert.equal(arcs.length, 2);
  for (const e of arcs) { close(e.curve.radius, 1, 1e-12); close(e.curveRange[1] - e.curveRange[0], Math.PI / 2, 1e-12); }
  assert.equal(b.faces.filter((f) => f.role === 'cap').length, 2);
});

test('unify: coplanar fragments of the plate top merge into one face (the boss footprint becomes its inner loop)', () => {
  for (const id of ['hard-fillet-after-boolean-fragments-r1', 'hard-boss-root-concave-mitres-r1']) {
    const b = bodyOf(id);
    const tops = b.faces.filter((f) => f.surface.type === 'plane' && Math.abs(f.surface.origin[2] - 6) < 1e-9 && Math.abs(faceNormal(f, f.surface.origin)[2] - 1) < 1e-12);
    assert.equal(tops.length, 1, `${id}: ${tops.length} plate-top faces`);
    assert.deepEqual(tops[0].outer.slice().sort(), [false, true], `${id}: outer and one inner loop`);
    // No edge joins two faces of one plane with one outward side any more.
    const uses = b.edges.map(() => []);
    b.faces.forEach((f, fi) => f.loops.flat().forEach((u) => uses[u.edge].push(fi)));
    for (const [x, y] of uses) {
      const [fa, fc] = [b.faces[x], b.faces[y]];
      if (fa.surface.type !== 'plane' || fc.surface.type !== 'plane') continue;
      const p = b.vertices[b.edges[uses.indexOf(uses.find((u) => u[0] === x && u[1] === y))].start];
      const na = faceNormal(fa, p), nc = faceNormal(fc, p);
      assert.ok(na[0] * nc[0] + na[1] * nc[1] + na[2] * nc[2] < 1 - 1e-9, `${id}: coplanar faces ${x} and ${y} share an edge`);
    }
  }
  // The fragments case: 11 planes (plate, walls, boss) and 4 cylinders, and
  // the collinear pieces the fragments left along the plate's edges are one
  // edge again (no vertex of valence 2 remains).
  const fr = bodyOf('hard-fillet-after-boolean-fragments-r1');
  assert.deepEqual(types(fr).filter((t) => t === 'cylinder').length, 4);
  assert.deepEqual([fr.faces.length, fr.edges.length, fr.vertices.length], [15, 36, 24]);
  const valence = fr.vertices.map(() => 0);
  for (const e of fr.edges) { valence[e.start]++; valence[e.end]++; }
  assert.ok(valence.every((n) => n >= 3), `valences ${valence}`);
});

test('face consumption: r = width drops both supports, a full round is one blend face, the dome drops the disc', () => {
  const w = bodyOf('hard-single-edge-r-equals-width-r10');
  assert.equal(w.faces.length, 5); // Onshape FP03: 5 faces, 1 cylinder
  assert.deepEqual(types(w, 'blend'), ['cylinder']);
  // The blend is tangent to the vanished supports along the far edges: its
  // normal there is the consumed face's normal.
  const job = mod.ladder(jobOf('hard-single-edge-r-equals-width-r10'));
  assert.match(job, /bound consumed/);
  // Full rounds: the two stripes share one carrier and become one face
  // (Onshape FP04: 6 faces, FP02: 10 faces, one cylinder each); the two cap
  // arcs that met on the consumed face join into one semicircle.
  const round = bodyOf('hard-full-round-r5');
  assert.deepEqual(types(round, 'blend'), ['cylinder']);
  assert.equal(round.faces.length, 6);
  const semis = round.edges.filter((e) => e.curve.type === 'circle');
  assert.equal(semis.length, 2);
  for (const e of semis) close(e.curveRange[1] - e.curveRange[0], Math.PI, 1e-12);
  const notch = bodyOf('corpus-notch-trial-r1.5');
  assert.deepEqual(types(notch, 'blend'), ['cylinder']);
  assert.equal(notch.faces.length, 10);
  const dome = bodyOf('pc-post-top-rim-sphere-r5');
  assert.deepEqual(types(dome), ['cylinder', 'plane', 'sphere']);
  const sph = dome.faces.find((f) => f.surface.type === 'sphere');
  // One loop: the meridian seam to the pole, the spring circle, the seam back.
  assert.equal(sph.loops.length, 1);
  assert.equal(sph.loops[0].length, 3);
  assert.equal(sph.loops[0][0].edge, sph.loops[0][2].edge);
});

test('rims: the torus band carries a seam on the meridian through the rim vertex', () => {
  const b = bodyOf('pc-hole-rim-r1');
  const tor = b.faces.find((f) => f.surface.type === 'torus');
  assert.equal(tor.loops.length, 1);
  const [s1, seam, s2, back] = tor.loops[0];
  assert.equal(seam.edge, back.edge);
  assert.notEqual(seam.forward, back.forward);
  for (const u of [s1, s2]) assert.equal(b.edges[u.edge].start, b.edges[u.edge].end);
  const e = b.edges[seam.edge];
  close(dist(b.vertices[e.start], b.vertices[e.end]), Math.SQRT2, 1e-12);
});

test('corners: the sphere octant is bounded by three great arcs, the chamfer corner by the FP-b triangle', () => {
  const s = bodyOf('pp-box-corner-3-r2');
  const sph = s.faces.find((f) => f.role === 'corner');
  assert.equal(sph.surface.type, 'sphere');
  assert.equal(sph.loops[0].length, 3);
  for (const u of sph.loops[0]) {
    const e = s.edges[u.edge];
    assert.equal(e.curve.type, 'circle');
    close(e.curve.radius, 2, 1e-12);
    close(e.curveRange[1] - e.curveRange[0], Math.PI / 2, 1e-12);
  }
  const t = bodyOf('ch-box-corner-3-d1');
  const tri = t.faces.find((f) => f.role === 'corner');
  assert.equal(tri.surface.type, 'plane');
  assert.equal(tri.loops[0].length, 3);
  const pts = tri.loops[0].map((u) => t.vertices[t.edges[u.edge].start]);
  for (let i = 0; i < 3; i++) close(dist(pts[i], pts[(i + 1) % 3]), Math.SQRT2, 1e-12);
  // The triangle faces away from the material.
  const n = faceNormal(tri, pts[0]);
  assert.ok(n[0] > 0 && n[1] > 0 && n[2] > 0);
});

test('mitres and chains: shared end curves become one edge between two blends', () => {
  const loop = bodyOf('pp-box-top-loop-r2');
  const blends = new Set(loop.faces.map((f, i) => (f.role === 'blend' ? i : -1)).filter((i) => i >= 0));
  const owners = loop.edges.map(() => []);
  loop.faces.forEach((f, fi) => f.loops.flat().forEach((u) => owners[u.edge].push(fi)));
  const mitres = loop.edges.filter((e, i) => owners[i].every((f) => blends.has(f)));
  assert.equal(mitres.length, 4);
  for (const e of mitres) { assert.equal(e.curve.type, 'ellipse'); close(e.curve.major, 2 * Math.SQRT2, 1e-12); close(e.curve.minor, 2, 1e-12); }
  const slot = bodyOf('fl-slot-outline-r1');
  assert.deepEqual(types(slot, 'blend'), ['cylinder', 'cylinder', 'torus', 'torus']);
  // Every chain curve lies on both neighbouring blends.
  const owners2 = slot.edges.map(() => []);
  slot.faces.forEach((f, fi) => f.loops.flat().forEach((u) => owners2[u.edge].push(fi)));
  const chains = slot.edges.map((e, i) => [e, owners2[i]]).filter(([, o]) => o.every((f) => slot.faces[f].role === 'blend'));
  assert.equal(chains.length, 4);
  for (const [e, o] of chains) for (const f of o) {
    const p = slot.vertices[e.start];
    assert.ok(pointSurfaceDistance(slot.faces[f].surface, p) < 1e-12);
  }
});

test('overflow as notch: the blend keeps its surface and is trimmed by the neighbour face or the other blend', () => {
  const at = (b, e) => [b.vertices[b.edges[e].start], b.vertices[b.edges[e].end]];
  const owners = (b) => { const o = b.edges.map(() => []); b.faces.forEach((fc, fi) => fc.loops.flat().forEach((u) => o[u.edge].push(fi))); return o; };
  // Convex small face: the 45° face is consumed, the y = 10 face is trimmed
  // back to the notch line x = 18 + sqrt(4 - (10 - y_c)^2), y_c = y_e - 2 tan(π/8)
  // (the kernel's input has the corner at y_e = 9.6 rounded to F32).
  const small = bodyOf('hard-overflow-convex-small-face-r2');
  assert.equal(small.faces.length, 7);
  assert.ok(!small.faces.some((fc) => fc.surface.type === 'plane' && Math.abs(Math.abs(fc.surface.normal[0]) - Math.SQRT1_2) < 1e-9));
  const ye = decodeJob(jobOf('hard-overflow-convex-small-face-r2')).body.vertices[2][1];
  const yc = ye - 2 * Math.tan(Math.PI / 8), xn = 18 + Math.sqrt(4 - (10 - yc) ** 2);
  const o1 = owners(small), blend1 = small.faces.findIndex((fc) => fc.role === 'blend');
  const notchLine = small.edges.findIndex((e, i) => e.curve.type === 'line' && o1[i].includes(blend1) && at(small, i).every((p) => Math.abs(p[1] - 10) < 1e-12));
  assert.ok(notchLine >= 0);
  for (const p of at(small, notchLine)) close(p[0], xn, 1e-12);
  // Concave narrow ledge: the ledge top is consumed, the riser x = 12.125
  // grows up to the notch line z = 2.9 - sqrt(0.16 - 0.275^2).
  const ledge = bodyOf('hard-overflow-narrow-ledge-r0.4');
  assert.equal(ledge.faces.length, 12);
  const zn = 2.9 - Math.sqrt(0.16 - 0.275 ** 2);
  assert.ok(ledge.vertices.some((p) => Math.abs(p[0] - 12.125) < 1e-12 && Math.abs(p[2] - zn) < 1e-12));
  // Concave rim overflow: the disc top is consumed, the disc's side cylinder
  // grows to the notch circle at z = 9.5 - sqrt(6.5^2 - 0.5^2).
  const rim = bodyOf('hard-concave-rim-overflow-r6.5');
  assert.deepEqual(types(rim), ['cylinder', 'cylinder', 'plane', 'plane', 'torus']);
  const zr = 9.5 - Math.sqrt(6.5 ** 2 - 0.25);
  assert.ok(rim.edges.some((e) => e.curve.type === 'circle' && Math.abs(e.curve.radius - 10) < 1e-12 && Math.abs(e.curve.origin[2] - zr) < 1e-12));
  // Meets: the thin wall's two top blends meet at y = 0.75,
  // z = 9 + sqrt(1 - 0.25^2); the notch's two root blends at x = 20,
  // y = 18 - sqrt(9 - 1.5^2). The strip between them is consumed.
  const wall = bodyOf('hard-overlapping-blends-thin-wall-r1');
  assert.equal(wall.faces.length, 7);
  const o2 = owners(wall);
  const meet = wall.edges.findIndex((e, i) => o2[i].every((fi) => wall.faces[fi].role === 'blend'));
  for (const p of at(wall, meet)) { close(p[1], 0.75, 1e-12); close(p[2], 9 + Math.sqrt(1 - 0.0625), 1e-12); }
  const notch = bodyOf('corpus-notch-trial-r3');
  assert.equal(notch.faces.length, 11);
  const o3 = owners(notch);
  const m3 = notch.edges.findIndex((e, i) => o3[i].every((fi) => notch.faces[fi].role === 'blend'));
  for (const p of at(notch, m3)) { close(p[0], 20, 1e-12); close(p[1], 18 - Math.sqrt(9 - 2.25), 1e-12); }
  // Face counts are Onshape's (FP09, FP07, FP13, FP05, FP01).
  for (const [id, b] of [['hard-overflow-convex-small-face-r2', small], ['hard-overflow-narrow-ledge-r0.4', ledge], ['hard-concave-rim-overflow-r6.5', rim],
    ['hard-overlapping-blends-thin-wall-r1', wall], ['corpus-notch-trial-r3', notch]]) assert.equal(b.faces.length, ONSHAPE[id].faces, id);
  // What notch cannot resolve stays refused: both contacts overflowing (the
  // must-refuse r12 and notch r6), an overlap next to mitres.
  for (const id of ['hard-single-edge-r-too-large-r12', 'corpus-notch-trial-r6', 'hard-chamfer-exceeds-both-faces-d5']) assert.match(mod.run(jobOf(id)), /^unresolved overflow .*no notch: both contacts/);
  assert.match(mod.run(jobOf('hard-short-edge-in-loop-r1')), /^unresolved blend-overlap /);
});

test('OCCT reads the results as valid solids with the closed-form volume (uv run)', { skip: spawnSync('uv', ['--version']).status !== 0 && 'uv not available' }, async () => {
  const ids = ['pp-box-vertical-edge-r2', 'pp-box-top-loop-r2', 'pp-box-all-edges-r2', 'ch-box-corner-3-d1', 'pc-hole-rim-r1',
    'pc-post-top-rim-sphere-r5', 'fl-slot-outline-r1', 'hard-full-round-r5', 'hard-single-edge-r-equals-width-r10', 'hard-fillet-after-boolean-fragments-r1'];
  const dir = path.join(root, 'tmp/fillet/a3/test-step');
  fs.mkdirSync(dir, { recursive: true });
  const files = ids.map((id) => {
    const f = path.join(dir, `${id}.step`);
    fs.writeFileSync(f, resultStep(decodeResult(mod.run(jobOf(id))).body, id));
    return f;
  });
  const ms = await occtMeasure(files);
  ids.forEach((id, i) => {
    const m = ms[i], c = caseOf(id), side = JSON.parse(fs.readFileSync(jobPath(id).replace(/\.job$/, '.json'), 'utf8'));
    assert.ok(m.valid, `${id}: OCCT invalid`);
    assert.equal(m.freeEdges, 0, id);
    const dV = m.volume - side.kernel.volumeMm3;
    const forms = [c.closedForm.deltaVolume, ...Object.values(c.closedForm.alternatives ?? {})];
    assert.ok(forms.some((x) => Math.abs(dV - x) <= 1e-7 * side.kernel.volumeMm3), `${id}: dV ${dV} vs ${forms}`);
  });
});

test('OCCT volumes of the notch results equal Onshape\'s (probes FP01, FP05, FP07, FP09, FP13; uv run)', { skip: spawnSync('uv', ['--version']).status !== 0 && 'uv not available' }, async () => {
  const dir = path.join(root, 'tmp/fillet/a3/test-step');
  fs.mkdirSync(dir, { recursive: true });
  const files = NOTCHES.map((id) => {
    const f = path.join(dir, `${id}.step`);
    fs.writeFileSync(f, resultStep(decodeResult(mod.run(jobOf(id))).body, id));
    return f;
  });
  const ms = await occtMeasure(files);
  NOTCHES.forEach((id, i) => {
    const m = ms[i], side = JSON.parse(fs.readFileSync(jobPath(id).replace(/\.job$/, '.json'), 'utf8'));
    assert.ok(m.valid, `${id}: OCCT invalid`);
    assert.equal(m.freeEdges, 0, id);
    const dV = m.volume - side.kernel.volumeMm3, on = ONSHAPE[id].deltaVolume;
    assert.ok(Math.abs(dV - on) <= 1e-7 * side.kernel.volumeMm3, `${id}: dV ${dV} vs Onshape ${on}`);
  });
});

}
