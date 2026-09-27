import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend() || missing("fixtures/r20/metamorphic/jobs/kt6-rz1e-4__model_union_step2.job");
if (publicTreeSkip) {
  test("proto-corefine-robust.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { default: fs } = await import("node:fs");
const { default: path } = await import("node:path");
const { fileURLToPath } = await import("node:url");
const { loadBend } = await import("../src/bend-loader.mjs");
// Robustness of corefine's repair and triangulation (docs/hybrid-robust.md X3,
// X4; docs/proto-corefine.md steps 6-7), on the JS target:
//   X3  the short-edge collapse runs again after T-junction splits and zipping
//       (a bounded fixpoint of at most 3 rounds), then a named census;
//   X4  the triangulator subtracts in Reals before rounding (translation
//       invariant lengths) and treats a corner within delta = 2^-42 * S of its
//       chord as flat (S the job scale).
// Frozen repros: fixtures/r20/diag-rotation (kt6 turned, kt1 far) and
// fixtures/r20/relief-union (kt2-rotfar step 2, the far fan plate).








const root = fileURLToPath(new URL('../', import.meta.url));
const stats = await loadBend(path.join(root, 'kernel/hybrid/corefine/stats.bend'));
const earclip = await loadBend(path.join(root, 'kernel/hybrid/corefine/earclip.bend'));
const recover = await loadBend(path.join(root, 'kernel/proto/recover/main.bend'));
const hybrid = await loadBend(path.join(root, 'kernel/hybrid/main.bend'));

const DELTA_K = 2 ** -42;
const f32 = (w) => { const b = Buffer.alloc(4); b.writeUInt32LE(w >>> 0); return b.readFloatLE(0); };

// corefine's text and the root Boolean's statistics (kernel/hybrid/corefine/stats.bend).
function corefine(job) {
  const lines = stats.stats(job).trimEnd().split('\n');
  const m = /^stats (\d+) (\d+) (\d+)$/.exec(lines.at(-1));
  assert.ok(m || lines.at(-1) === 'stats none', `stats line: ${lines.at(-1)}`);
  return { text: `${lines.slice(0, -1).join('\n')}\n`, rounds: m ? Number(m[1]) : 0, recol: m ? Number(m[2]) : 0, dm: m ? f32(Number(m[3])) : 0 };
}
const head2 = (s) => s.split('\n').slice(0, 2).join(' ').replace(/\s*end$/, '');

test('the flatness factor is exactly 2^-42 and the scale record carries delta = 2^-42 * S', () => {
  assert.equal(stats['boolean.delta_k'](), DELTA_K);
  const sc = earclip.scale(Math.fround(812.5), DELTA_K);
  assert.equal(sc.s, 812.5);
  assert.equal(sc.dl, 812.5 * DELTA_K);
});

// A near-collinear run of constructed points (kt2-rotfar step 2: spacings
// 6.6e-6 .. 2.4e-2 mm; kt1-far: 7.256e-4 / 9.08e-7 mm) with dents of 2.7e-13 ..
// 1e-12 mm, on one side of a thin strip, turned and moved far from the origin
// (coordinates rounded to F32x2 like constructed points).
const f2 = (v) => { const hi = Math.fround(v); return { $: 'Real', hi, lo: Math.fround(v - hi) }; };
const list = (xs) => xs.reduceRight((tail, head) => ({ $: 'Con', head, tail }), { $: 'Nil' });
const arr = (l) => { const o = []; for (; l.$ === 'Con'; l = l.tail) o.push(l.head); return o; };
function stripLoop(tx, ty, ang) {
  const xs = [6.6e-6, 1.33e-5, 2.4e-2, 2.4e-2 + 9.08e-7, 5, 5 + 7.256e-4, 5 + 7.256e-4 + 9.08e-7, 5 + 1.4521e-3, 10];
  const dent = [1e-12, -1e-12, 0, 2.7e-13, -1e-12, 1e-12, -2.7e-13, 0, 1e-12];
  const pts = [[0, 0], ...xs.map((x, i) => [x, dent[i]]), [11, 0], [11, 0.5], [0, 0.5]];
  const c = Math.cos(ang), s = Math.sin(ang);
  return pts.map(([x, y], i) => earclip.v2(i, f2(tx + c * x - s * y), f2(ty + s * x + c * y)));
}

test('X4: a collinear run of constructed points triangulates without slivers, identically near and far from the origin', () => {
  const chain = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  let first = null;
  for (const [tx, ty] of [[0, 0], [812.123, -523.456], [-3000.5, 2000.25]]) for (const ang of [0.3, 1.1]) {
    const S = Math.fround(Math.max(Math.abs(tx), Math.abs(ty)) + 11);
    const r = earclip.tri_face(list([list(stripLoop(tx, ty, ang))]), earclip.scale(S, DELTA_K));
    const tris = arr(r.tris);
    const at = `T=(${tx}, ${ty}) angle ${ang}`;
    assert.equal(r.bad, false, at);
    assert.equal(tris.length, 11, at);
    // No triangle of three run vertices (its plane would be rounding noise).
    assert.equal(tris.filter((t) => chain.has(t.a) && chain.has(t.b) && chain.has(t.c)).length, 0, at);
    assert.ok(r.dm <= DELTA_K * (1 + 2 ** -20), `${at}: delta-only distance ${r.dm} exceeds 2^-42`);
    const key = tris.map((t) => [t.a, t.b, t.c].sort((a, b) => a - b).join(',')).sort().join(' ');
    first ??= key;
    assert.equal(key, first, `${at}: the triangulation depends on the frame`);
  }
});

test('X4: delta separates rounding from features: a corner delta/3 off its chord is flat, one 3 delta off is not', () => {
  // Micrometre edges at 800 mm: the angle term (1e-7 rad) alone would keep
  // both corners (turns of 1.2e-4 and 1.2e-3 rad).
  const S = Math.fround(810), delta = S * DELTA_K;
  const loopWith = (h) => [[0, 0], [1e-6, -h], [2e-6, 0], [10, 0], [10, 1], [0, 1]].map(([x, y], i) => earclip.v2(i, f2(800 + x), f2(-600 + y)));
  const near = earclip.tri_face(list([list(loopWith(delta / 3))]), earclip.scale(S, DELTA_K));
  assert.equal(near.bad, false);
  const r = near.dm * S / (delta / 3);
  assert.ok(r > 0.9 && r < 1.1, `delta-only distance ${near.dm} vs ${delta / 3 / S}`);
  const far = earclip.tri_face(list([list(loopWith(3 * delta))]), earclip.scale(S, DELTA_K));
  assert.equal(far.bad, false);
  assert.equal(far.dm, 0);
});

const ROT = path.join(root, 'fixtures/r20/diag-rotation');
const repros = JSON.parse(fs.readFileSync(path.join(ROT, 'repros.json'), 'utf8')).jobs;

test('X3 + X4: the diag-rotation repros reach their fixed expectation', () => {
  for (const j of repros) {
    const job = fs.readFileSync(path.join(ROT, j.file), 'utf8');
    const c = corefine(job);
    assert.equal(c.text.split('\n')[0], j.fixed.corefine, `${j.file}: corefine`);
    const rec = head2(recover.run(job + c.text));
    // The expectation's own words: "ok brep 1 8 12 6 (the rotated ...)" or the refusal text.
    const want = j.fixed.recover.replace(/ \(=.*$| \(the .*$/, '');
    assert.equal(rec, want, `${j.file}: recover`);
    if (/^kt6-/.test(j.file)) {
      // Before X1/X2 (unify.bend, shadow.bend tie_canon) the split made a
      // sub-eps edge that the second collapse removed (recol 1). The near
      // duplicate came from ties constructed twice and from identical tilted
      // carriers left un-unified; with X1/X2 it is not made at all (recol 0).
      // X3's second collapse stays pinned by kt6-rz1e-4 step 2 below.
      assert.equal(c.rounds, 1, `${j.file}: repair rounds`);
      assert.equal(c.recol, 0, `${j.file}: no collapse needed after the split`);
    }
    assert.ok(c.dm <= DELTA_K, `${j.file}: delta-only distance ${c.dm}`);
  }
});

test('X3: kt6-rz1e-4 union step 2 still needs the collapse after the split (and gets it)', () => {
  // With X1/X2 the turned kt6 repros above need no second collapse; this
  // frame (1e-4 deg about Z, fixtures/r20/metamorphic) still makes one
  // sub-eps edge in the split, which the fixpoint's second collapse removes.
  const job = fs.readFileSync(path.join(root, 'fixtures/r20/metamorphic/jobs/kt6-rz1e-4__model_union_step2.job'), 'utf8');
  const c = corefine(job);
  assert.equal(c.text.split('\n')[0], 'ok');
  assert.equal(c.rounds, 1);
  assert.equal(c.recol, 1);
  assert.equal(head2(recover.run(job + c.text)).split(' ')[0], 'ok');
});

const RELIEF = path.join(root, 'fixtures/r20/relief-union');
const relief = (name) => fs.readFileSync(path.join(RELIEF, name), 'utf8');

test('X4: kt2-rotfar hole cut step 2 is an exact B-rep (brep 1 18 27 12)', () => {
  const job = relief('kt2-rotfar-holecut-step2.job');
  assert.equal(head2(hybrid.run(job)), 'exact brep 1 18 27 12');
});

test('X4: the far fan plate (near-duplicate spokes at 800 mm) is exact like the origin copy', () => {
  for (const name of ['synth-fanplate-far-g1e-6.job', 'synth-fanplate-origin-g1e-6.job']) {
    const job = relief(name);
    assert.equal(head2(hybrid.run(job)), 'exact brep 1 10 15 7', name);
    assert.ok(corefine(job).dm <= DELTA_K, name);
  }
});

// Signed axis permutations are exact on the F32x2 wire (a word pair is
// permuted or its sign bits flipped); odd ones reverse the triangle winding.
const LAYOUT = { plane: 'vdd', cylinder: 'vddr', cone: 'vddra', sphere: 'vr', torus: 'vdrr' };
function permuted(text, p, signs) {
  const neg = (w) => (Number(w) ^ 0x80000000) >>> 0;
  const vec = (w) => [0, 1, 2].flatMap((i) => (signs[i] ? [neg(w[2 * p[i]]), neg(w[2 * p[i] + 1])] : [Number(w[2 * p[i]]), Number(w[2 * p[i] + 1])]));
  let par = signs.reduce((a, b) => a + b, 0);
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) if (p[i] > p[j]) par++;
  const flip = par % 2 === 1;
  const out = []; let mode = null, left = 0, tris = 0;
  for (const line of text.split('\n')) {
    const w = line.trim().split(/\s+/);
    if (w[0] === 'face') {
      const words = w.slice(4); const res = []; let i = 0;
      for (const c of LAYOUT[w[3]]) { if (c === 'v' || c === 'd') { res.push(...vec(words.slice(i, i + 6))); i += 6; } else { res.push(words[i], words[i + 1]); i += 2; } }
      out.push(`${w.slice(0, 4).join(' ')} ${res.join(' ')}`); continue;
    }
    const m = /^mesh (\d+) (\d+) (\d+)$/.exec(line.trim());
    if (m) { out.push(line); mode = 'v'; left = Number(m[2]); tris = Number(m[3]); continue; }
    if (mode === 'v' && left > 0) { out.push(vec(w).join(' ')); if (--left === 0) mode = tris ? 't' : null; continue; }
    if (mode === 't' && tris > 0) { out.push(flip ? `${w[0]} ${w[2]} ${w[1]} ${w[3]}` : line); if (--tris === 0) mode = null; continue; }
    out.push(line);
  }
  return out.join('\n');
}

test('metamorphic: turned kt6 repros keep one verdict under signed axis permutations', () => {
  const frames = [[[0, 1, 2], [0, 0, 0]], [[1, 0, 2], [0, 0, 0]], [[2, 0, 1], [1, 0, 0]], [[0, 2, 1], [0, 1, 1]], [[1, 2, 0], [1, 1, 1]], [[2, 1, 0], [0, 0, 1]]];
  for (const file of ['kt6-rot-ab.job', 'kt6-rz60-step2.job', 'kt6-rz45-attached-step2.job']) {
    const src = fs.readFileSync(path.join(ROT, file), 'utf8');
    const want = repros.find((j) => j.file === file).fixed.recover.replace(/ \(the .*$/, '');
    for (const [p, s] of frames) {
      const job = permuted(src, p, s);
      const c = corefine(job);
      assert.equal(c.text.split('\n')[0], 'ok', `${file} p=${p} s=${s}`);
      assert.equal(head2(recover.run(job + c.text)), want, `${file} p=${p} s=${s}`);
    }
  }
});

test('the stats entry prints corefine\'s exact text before its stats line', async () => {
  const cf = await loadBend(path.join(root, 'kernel/hybrid/corefine/main.bend'));
  for (const j of repros) {
    const job = fs.readFileSync(path.join(ROT, j.file), 'utf8');
    assert.equal(corefine(job).text, cf.run(job), j.file);
  }
});

}
