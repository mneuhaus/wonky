import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("fillet-exact.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { loadBend } = await import("../src/bend-loader.mjs");
const { FAMILIES, MOTIONS, exactOffset, pairToS, sToPair, subTolerance, transformJob, verdictOf, wordToS } = await import("../scripts/fillet/sweeps.mjs");
// Exact decisions near boundaries in the production fillet, kernel/fillet
// (docs/fillet-plan.md §8 step 3). Near an existence boundary (r = face
// width, r = rim radius, chamfer d = face width, a dihedral towards 180°)
// the verdict must change only at the exact boundary or become a typed
// refusal (`sliver`, naming the tolerance a merge would need), and rigid
// motions and exact scaling must keep it. Built results are checked
// independently: validator, no two vertices closer than the modelling
// tolerance 1e-6 mm, no circle edge below it (scripts/fillet/sweeps.mjs
// subTolerance). JS target only; `node scripts/fillet/sweeps.mjs` runs the
// full sweeps and motions on js and cpu1.






const port = await loadBend(new URL('../kernel/fillet/main.bend', import.meta.url));
const TAU = Math.fround(1e-6);

function run(text, where) {
  const result = port.run(text);
  const verdict = verdictOf(result);
  if (verdict === 'ok') assert.deepEqual(subTolerance(text, result).issues, [], `${where}: built result with sub-tolerance topology`);
  if (verdict === 'sliver') assert.match(result.split('\n')[0], /below the modelling tolerance .* merging it needs a tolerance of \d/, `${where}: sliver names the needed tolerance`);
  return { verdict, head: result.split('\n')[0] };
}

// offsets -1e-3, -1e-6, -1e-9, -1e-12, 0, +1e-12, +1e-9, +1e-6, +1e-3 mm
const SIZE_VERDICTS = {
  // fillet on the top front edge of a 20 x 10 x 5 box, r = 5 + d: at d = 0 the
  // front face is consumed exactly; beyond it the front side notches
  'box-r': ['ok', 'ok', 'sliver', 'sliver', 'ok', 'sliver', 'sliver', 'ok', 'ok'],
  // the same edge, chamfer d = 5 + d: chamfer overflow is refused
  'box-d': ['ok', 'ok', 'sliver', 'sliver', 'ok', 'sliver', 'sliver', 'overflow', 'overflow'],
  // top rim of a post of radius 5, r = 5 + d: a sphere dome at d = 0, no
  // blend at all beyond it (the ball centre crosses the axis)
  'post-r': ['ok', 'ok', 'sliver', 'sliver', 'ok', 'radius-too-large', 'radius-too-large', 'radius-too-large', 'radius-too-large'],
};

for (const [family, want] of Object.entries(SIZE_VERDICTS)) {
  test(`${family}: the verdict changes only at the exact boundary or becomes a typed refusal`, () => {
    const cases = FAMILIES[family]();
    assert.equal(cases.length, want.length);
    cases.forEach((c, i) => {
      const off = exactOffset(c);
      assert.equal(Math.abs(off) < TAU, Math.abs(c.param) < 1e-6, `${family} ${c.param}: exact offset ${off}`);
      assert.equal(run(c.text, `${family} ${c.param}`).verdict, want[i], `${family} ${c.param}`);
    });
  });
}

// At exactly 180° the two faces are one plane: the edge is a coplanar
// fragment (Onshape has no such edge), ignored with a note, and nothing else
// is selected (integrate-fix round 2; it was tangent-edge before).
test('a dihedral towards 180°: built while the blend is at least 1e-6 wide, sliver below, a coplanar fragment at 180°', () => {
  const want = { 0.001: 'ok', 0.000001: 'ok', 1e-9: 'sliver', 1e-12: 'sliver', 0: 'invalid-input' };
  for (const family of ['ridge-a', 'valley-a']) {
    for (const c of FAMILIES[family]()) {
      const got = run(c.text, `${family} ${c.param}`);
      assert.equal(got.verdict, want[c.param], `${family} ${c.param}`);
      if (c.param === 0) assert.match(got.head, /after ignoring seam and coplanar-fragment edges/, `${family} 0`);
    }
  }
});

// A chamfer of distance d on the box's 90° edge is d√2 wide. With d the F32x2
// words next to tau/√2 the float filter cannot decide chord - tau (the words
// differ by about 1e-22 mm), so the verdict must follow the exact sign of
// 2 d² - tau², computed here from the job's size words: a sliver refusal
// decided exactly below, a built chamfer above.
test('a 90° chamfer face as wide as the tolerance within float error: the exact sign of 2 d² - tau² decides', () => {
  const isqrt = (n) => { let x = 1n << BigInt((n.toString(2).length >> 1) + 1); for (let y = (x + n / x) >> 1n; y < x; y = (x + n / x) >> 1n) x = y; return x; };
  const sTau = wordToS(new Uint32Array(new Float32Array([TAU]).buffer)[0]);
  const near = sToPair(isqrt((sTau * sTau) / 2n));
  const box = FAMILIES['box-d']().find((c) => c.param === 0).text;
  const signs = new Set();
  for (const step of [-2, -1, 0, 1, 2]) {
    const lo = (near.lo + step) >>> 0, d = pairToS(near.hi, lo), sign = 2n * d * d - sTau * sTau;
    assert.notEqual(sign, 0n, `d words (${near.hi}, ${lo})`);
    signs.add(sign < 0n);
    const got = run(box.replace(/\nsize \d+ \d+\n/, `\nsize ${near.hi} ${lo}\n`), `d words (${near.hi}, ${lo})`);
    assert.equal(got.verdict, sign < 0n ? 'sliver' : 'ok', `d words (${near.hi}, ${lo}): ${got.head}`);
    if (sign < 0n) assert.match(got.head, /blend face of edge \d+ .* wide \(exact\)/, `d words (${near.hi}, ${lo}): decided exactly`);
  }
  assert.equal(signs.size, 2, 'the words straddle the exact boundary');
});

test('translations to 1e4 and 1e7 mm, a quarter turn and scale 2 keep the verdict near the boundary', () => {
  const pick = (family, params) => FAMILIES[family]().filter((c) => params.includes(c.param));
  const cases = [...pick('box-r', [-1e-6, -1e-9, 0, 1e-12, 1e-6]), ...pick('box-d', [-1e-9, 0, 1e-6]), ...pick('post-r', [-1e-6, -1e-9, 0, 1e-12])];
  assert.equal(cases.length, 12);
  for (const c of cases) {
    const base = run(c.text, `${c.family} ${c.param}`).verdict;
    for (const m of ['translate-1e4', 'translate-1e7', 'quarter-x', 'scale-2']) {
      const t = transformJob(c.text, MOTIONS[m]);
      assert.ok(t.exact, `${c.family} ${c.param} ${m}: the moved job is word-exact`);
      const moved = run(t.text, `${c.family} ${c.param} ${m}`);
      assert.equal(moved.verdict, base, `${c.family} ${c.param} ${m}: ${moved.head}`);
    }
  }
});

}
