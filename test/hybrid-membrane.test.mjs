import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missing("fixtures/r20/membrane/oracle.json");
if (publicTreeSkip) {
  test("hybrid-membrane.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { default: fs } = await import("node:fs");
const { default: path } = await import("node:path");
const { createHash } = await import("node:crypto");
const { loadKernel, runFrame, SETS } = await import("../scripts/r20/metamorphic.mjs");
// Coplanar membranes of the hybrid Boolean (corefine/membrane.bend,
// docs/hybrid-robust.md F1): the R20 probe's freecut notch (probe.fs 307:5)
// is flush with the 15 degree tilted plate side. The symbolic perturbation
// kept the same quad in the plate face and in the flipped tool face (a
// zero-thickness sheet); the result was refused ("a face diagonal duplicates
// an edge") or, in other frames, "result self-intersects".
//
// The answers are judged by the metamorphic harness (scripts/r20/metamorphic.mjs
// judge): an exact B-rep against its closed-form volume and the manifold3d
// mesh Boolean of the job's leaf meshes (fixtures/r20/membrane/oracle.json), a
// certified mesh against the mesh Boolean. WONKY_MEMBRANE_ENTRY=<hybrid/main.bend>
// runs the same checks on another kernel tree (a snapshot before the fix
// refuses here).







const DIR = path.join(path.dirname(new URL(import.meta.url).pathname), '../fixtures/r20/membrane');
const expect = JSON.parse(fs.readFileSync(path.join(DIR, 'expect.json'), 'utf8'));
const kernel = await loadKernel(process.env.WONKY_MEMBRANE_ENTRY || undefined);
const byJob = name => expect.cases.find(c => path.basename(c.job) === name);
const text = c => fs.readFileSync(path.join(DIR, c.job), 'utf8');

test('fixtures: the membrane repros are the frozen bytes their expectations name', () => {
  for (const c of expect.cases) assert.equal(createHash('sha256').update(text(c)).digest('hex'), c.sha256, c.job);
  const reduced = byJob('probe-freecut-reduced.job');
  assert.ok(Math.abs(reduced.reference.exact.volumeMm3 - (5292 - 75 * Math.PI)) < 1e-9, 'closed form 5292 - 75 pi');
});

test('F1: the reduced probe 307:5 notch is an exact B-rep with the closed-form volume', () => {
  const c = byJob('probe-freecut-reduced.job');
  const r = runFrame(kernel, 'probe-freecut-reduced', 'p0', text(c), c.reference);
  assert.equal(r.judged.verdict, 'exact', `${r.answerHead}; ${r.judged.failed.join('; ')}`);
  assert.ok(r.judged.checks.exactReference.d <= r.judged.checks.exactReference.allowed);
});

test('F1: the reduced notch is exact in every quick frame (8 permutations x 2 scalings)', () => {
  const c = byJob('probe-freecut-reduced.job');
  const rows = SETS.quick.map(f => runFrame(kernel, 'probe-freecut-reduced', f, text(c), c.reference));
  const off = rows.filter(r => r.judged.verdict !== 'exact').map(r => `${r.frame}: ${r.judged.verdict} ${r.answerHead?.slice(0, 100)} ${r.judged.failed.join('; ')}`);
  assert.deepEqual(off, []);
});

test('F1: the frozen probe 307:5 freecut subtract is a certified mesh equal to the mesh Boolean', () => {
  const c = byJob('probe-next-freecut-subtract.job');
  const r = runFrame(kernel, 'probe-next-freecut-subtract', 'p0', text(c), c.reference);
  assert.equal(r.judged.verdict, 'mesh', `${r.answerHead}; ${r.judged.failed.join('; ')}`);
  assert.equal(r.measure.components, 1);
});

// Fix round 2 (docs/hybrid-robust.md F1b): a membrane group whose remainder
// holds faces of both orientations (face-contact unions: P's top outside the
// contact and Q's bottom outside it in one plane) is not one face. F1 gave it
// one orientation by its net area and refused correct results.
const built = (c, frame = 'p0') => {
  const r = runFrame(kernel, c.job, frame, text(c), c.reference);
  return { r, why: `${r.answerHead?.slice(0, 160)}; ${r.judged.failed.join('; ')}` };
};

test('F1b: a mixed-orientation membrane (u-overhang, frame rnd3) builds exact with the closed-form volume', () => {
  const { r, why } = built(byJob('f1b-u-overhang-bd-rnd3.job'));
  assert.equal(r.judged.verdict, 'exact', why);
  assert.ok(r.judged.checks.exactReference.d <= r.judged.checks.exactReference.allowed, why);
});

test('F1b: a membrane whose net area is zero (u-side-partial, frame r2m11_1em5) builds and matches 8000 mm3', () => {
  const { r, why } = built(byJob('f1b-u-side-partial-ac-r2m11.job'));
  assert.ok(['exact', 'mesh'].includes(r.judged.verdict), why);
  assert.ok(r.judged.checks.exactReference.d <= r.judged.checks.exactReference.allowed, why);
});

test('F1b: the CLI kt6 cross union at 89.9 deg (crossing remainder) builds as one body of 7500 mm3', () => {
  const { r, why } = built(byJob('f1b-x-cross-r57m2-step0.job'));
  assert.ok(['exact', 'mesh'].includes(r.judged.verdict), why);
  assert.ok(r.judged.checks.exactReference.d <= r.judged.checks.exactReference.allowed, why);
});

// Still open (docs/hybrid-robust.md F1b): u-overhang in permutation p7 keeps
// a mixed remainder whose halfedges cross at a point that is no vertex (the
// members overlap without cutting each other). Such a group is not
// cancelled, and the result is refused by name as before F1 (pre-F1 and F1
// refuse this frame too). It must never be a wrong answer.
const OPEN = { 'f1b-u-overhang-bd-rnd3.job': ['p7', 'p7s-3'] };

test('F1b: the mixed-orientation repros build in the quick frames (8 permutations x 2 scalings), the open ones refuse by name', () => {
  const off = [];
  for (const name of ['f1b-u-overhang-bd-rnd3.job', 'f1b-u-side-partial-ac-r2m11.job', 'f1b-x-cross-r57m2-step0.job']) {
    const c = byJob(name);
    for (const f of SETS.quick) {
      const r = runFrame(kernel, name, f, text(c), c.reference);
      const ok = (OPEN[name] ?? []).includes(f) ? ['exact', 'mesh', 'refused'] : ['exact', 'mesh'];
      if (!ok.includes(r.judged.verdict)) off.push(`${name} ${f}: ${r.judged.verdict} ${r.answerHead?.slice(0, 100)} ${r.judged.failed.join('; ')}`);
    }
  }
  assert.deepEqual(off, []);
});

// Fix round 2 (docs/hybrid-robust.md F2): probe tilted by 52 degrees. The tool
// face flush with the plate's -Y side has the normal (0, -1.0000000000000053,
// 0): a transformed, rounded carrier, not an exact axis plane. unify.bend kept
// it apart from the exact plate face (two "exact" carriers never join), the
// flush faces got no plane class, and the pillow between them was refused.
test('F2: the probe tilt-52 freecut subtract is a certified mesh equal to the mesh Boolean', () => {
  const { r, why } = built(byJob('f2-probe-t52-freecut-subtract.job'));
  assert.equal(r.judged.verdict, 'mesh', why);
  assert.equal(r.measure.components, 1);
});

test('F2: the probe tilt-52 freecut subtract builds in every quick frame (F1 and pre-F1 refused 14 of 16)', () => {
  const c = byJob('f2-probe-t52-freecut-subtract.job');
  const off = SETS.quick.map(f => runFrame(kernel, 'f2', f, text(c), c.reference)).filter(r => r.judged.verdict !== 'mesh').map(r => `${r.frame}: ${r.judged.verdict} ${r.answerHead?.slice(0, 100)} ${r.judged.failed.join('; ')}`);
  assert.deepEqual(off, []);
});

}
