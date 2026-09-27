import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("hybrid-unify-tilted.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { default: fs } = await import("node:fs");
const { default: path } = await import("node:path");
const { createHash } = await import("node:crypto");
const { fileURLToPath } = await import("node:url");
const { loadBend } = await import("../src/bend-loader.mjs");
// Carrier unification of identical tilted carriers and the tie constructed
// from one value (docs/hybrid-robust.md X1, X2; kernel/hybrid/unify.bend,
// kernel/hybrid/corefine/shadow.bend tie_canon), on the JS target:
//   X1  two leaves on a bitwise identical carrier that is not axis-exact form
//       a unified class (their rounded vertices are not on it); an identical
//       axis-exact pair stays one plain class (its vertices are exact input);
//       unified classes past the 32-bit limit are counted and named;
//   X2  a tie decided under unification is constructed from one value; the
//       largest replaced |p - q| stays <= 2^-42 * S (tools/tiegap.bend).
// Frozen repros: fixtures/r20/relief-union (probe 612:9 and kt1-rot
// ReliefUnion, kt1 control, the synthetic boxcyl frames).









const root = fileURLToPath(new URL('../', import.meta.url));
const UN = await loadBend(path.join(root, 'kernel/hybrid/unify.bend'));

const list = (xs) => xs.reduceRight((tail, head) => ({ $: 'Con', head, tail }), { $: 'Nil' });
const unlist = (l) => { const out = []; for (let c = l; c.$ === 'Con'; c = c.tail) out.push(c.head); return out; };
const f = Math.fround;
const real = (x) => { const hi = f(x); return { $: 'Real', hi, lo: f(x - hi) }; };
const v3 = (x, y, z) => ({ $: 'V3', x: real(x), y: real(y), z: real(z) });
const plane = (leaf, face, o, n) => ({ $: 'FaceTag', leaf, face, surface: { $: 'SPlane', o: v3(...o), n: v3(...n), x: v3(1, 0, 0) } });
const decide = (faces, maxabs = 10) => UN.decide(list(faces), f(maxabs));

// A tilted unit normal (no component 0) and an axis normal.
const TILT = [0.28, 0.36, Math.sqrt(1 - 0.28 ** 2 - 0.36 ** 2)];
const AXIS = [0, 0, 1];

test('X1: identical tilted carriers of two leaves are one unified class', () => {
  const u = decide([plane(0, 0, [1, 2, 3], TILT), plane(1, 0, [1, 2, 3], TILT)]);
  assert.equal(u.classes, 1);
  assert.equal(u.over, 0);
  assert.deepEqual(unlist(u.masks), [1, 1]);
});

test('X1: identical axis-exact carriers stay one plain class; different ones never join', () => {
  const same = decide([plane(0, 0, [1, 2, 3], AXIS), plane(1, 0, [5, 6, 3], AXIS)]);
  assert.equal(same.classes, 0);
  assert.deepEqual(unlist(same.masks), [0, 0]);
  // 2e-11 mm apart at scale 16: within 2^-44 * scale, but exact input planes.
  const skin = decide([plane(0, 0, [1, 2, 3], AXIS), plane(1, 0, [1, 2, 3 + 2e-11], AXIS)]);
  assert.equal(skin.classes, 0);
});

test('X1: identical tilted carriers of one leaf are not unified', () => {
  const u = decide([plane(0, 0, [1, 2, 3], TILT), plane(0, 1, [1, 2, 3], TILT)]);
  assert.equal(u.classes, 0);
  assert.deepEqual(unlist(u.masks), [0, 0]);
});

test('X1: unified classes past the 32-bit limit are counted and named', () => {
  // 34 distinct tilted planes (offsets 1 mm apart), each shared by leaf 0 and leaf 1.
  const faces = [];
  for (let i = 0; i < 34; i++) {
    const o = TILT.map((c) => c * (i + 1));
    faces.push(plane(0, i, o, TILT), plane(1, i, o, TILT));
  }
  const u = decide(faces, 64);
  assert.equal(u.classes, 34);
  assert.equal(u.over, 2);
  const masks = unlist(u.masks);
  assert.equal(masks.filter((m) => m !== 0).length, 64, '32 classes x 2 tags carry a bit');
  assert.equal(new Set(masks.filter((m) => m !== 0)).size, 32);
  assert.equal(UN.note(34, '34'), '; coplanar plane carriers unified within 2^-44*scale (34 classes; 2 past the 32-bit class limit, decided without unification)');
  assert.equal(UN.note(32, '32'), '; coplanar plane carriers unified within 2^-44*scale (32 classes)');
  assert.equal(UN.note(0, '0'), '');
});

// recover's statement names the classes past the limit too: its `unified`
// line (kernel/hybrid/recover/main.bend put_un) carries them as a third number
// only when there are any, and src/hybrid.mjs decodes and states them.
test('X1: recover states unified classes past the 32-bit limit', async () => {
  const V = await loadBend(path.join(root, 'kernel/hybrid/recover/main.bend'));
  const { decodeRecover, recoverStatements } = await import('../src/hybrid.mjs');
  const tau = f(2 ** -40);
  const brep = (un) => `ok\nbrep 0 0 0 0\nstats ${'0 '.repeat(8)}${'0 0 '.repeat(7)}0\n${V.put_un(un, 'end\n')}`;
  const past = decodeRecover(brep({ $: 'Un', n: 34, over: 2, tau }));
  assert.equal(past.stats.unifiedClasses, 34);
  assert.equal(past.stats.unifiedOverLimit, 2);
  const [stated] = recoverStatements(past.stats);
  assert.equal(stated.overLimit, 2);
  assert.match(stated.text, /\(34 classes, tolerance [^;]+; 2 past the 32-bit class limit, decided without unification\)$/);
  const below = decodeRecover(brep({ $: 'Un', n: 3, over: 0, tau }));
  assert.equal(below.stats.unifiedClasses, 3);
  assert.equal('unifiedOverLimit' in below.stats, false);
  assert.equal('overLimit' in recoverStatements(below.stats)[0], false);
});

const RELIEF = path.join(root, 'fixtures/r20/relief-union');
const cases = JSON.parse(fs.readFileSync(path.join(RELIEF, 'cases.json'), 'utf8')).cases;
const relief = (name) => fs.readFileSync(path.join(RELIEF, name), 'utf8');
const hybrid = await loadBend(path.join(root, 'kernel/hybrid/main.bend'));

// A repro job answers its cases.json expectation (status, reason, mesh size,
// unified classes, bytes where pinned).
const answersExpectation = (name) => {
  const e = cases.find((c) => c.job === name).expect;
  const a = hybrid.run(relief(name)), [first, second] = a.split('\n');
  assert.equal(first.split(' ')[0], e.status, name);
  assert.match(first, new RegExp(e.reason), name);
  assert.equal(second, `mesh ${e.mesh}`, name);
  const m = /\((\d+) classes/.exec(first);
  assert.equal(m ? Number(m[1]) : 0, e.unified, name);
  if (e.answerSha256) assert.equal(createHash('sha256').update(a).digest('hex'), e.answerSha256, `${name}: byte-identical`);
};

test('X1 + X2: probe 612:9 and kt1-rot ReliefUnion are certified meshes with one unified class; kt1 is unchanged', () => {
  for (const name of ['probe-relief-union.job', 'kt1-rot-relief-union.job', 'kt1-relief-union.job']) answersExpectation(name);
});

test('KT1 print refinement: ReliefUnion at 0.005 mm is a certified mesh, not refused at a corner open only through its triple', () => {
  // The job the r20-check export of KT1 refines model/clearCut with. Its mesh
  // vertex 408 (plane z 20, core cylinder r 0.42, relief cone: pairwise 45 to
  // 90 degrees, the three curves meeting at 7 degrees, |det| 0.088) lies
  // 0.065 mm from its exact vertex, beyond 10 dev (0.05) but within 3 dev /
  // |det|; that does not disprove the mesh, so the job keeps its certified
  // mesh (the cylinder/cone quartic is the exact recovery's refusal) and the
  // refinement has one. The nearly tangent pairs that keep such a drift a
  // certificate failure: hybrid-entry (cone shave) and proto-recover (lens).
  answersExpectation('kt1-relief-union-0.005.job');
});

test('the exact shared-vertex symbolic tie stays a named refusal (synth-relief-m12-identity)', async () => {
  const cf = await loadBend(path.join(root, 'kernel/hybrid/corefine/main.bend'));
  const e = cases.find((c) => c.job === 'synth-relief-m12-identity.job').expect;
  const a = cf.run(relief('synth-relief-m12-identity.job'));
  assert.match(a.split('\n')[0], new RegExp(e.reason));
  assert.equal(createHash('sha256').update(a).digest('hex'), e.answerSha256);
});

test('X2: ties are constructed from one value, moved by <= 2^-42 * S', async () => {
  const tg = await loadBend(path.join(RELIEF, 'tools/tiegap.bend'));
  const F = (w) => { const b = Buffer.alloc(4); b.writeUInt32LE(Number(w) >>> 0); return b.readFloatLE(0); };
  for (const name of ['synth-boxcyl-n12-r321-89.job', 'synth-boxcyl-n8-frame3.job']) {
    const a = tg.tiegap(relief(name)).trimEnd().split('\n');
    assert.equal(a[0], 'ok', name);
    const [, pairs, gap, S] = a.at(-1).split(' ');
    assert.ok(Number(pairs) > 0, `${name}: some ties canonicalised`);
    assert.ok(F(gap) / F(S) <= 2 ** -42, `${name}: gap ${F(gap)} mm at S ${F(S)}`);
  }
});

}
