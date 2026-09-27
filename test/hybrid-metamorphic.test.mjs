import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missing("fixtures/r20/metamorphic/expect.json");
if (publicTreeSkip) {
  test("hybrid-metamorphic.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { default: fs } = await import("node:fs");
const { default: path } = await import("node:path");
const { createHash } = await import("node:crypto");
const { FIXTURES, SETS, SPREAD, PERMUTATIONS, TRANSLATIONS, frame, transformJob, checkWire, parseJob, sourceNames, sourceText, readExpect, loadKernel, runFrame, judge, consensusReference } = await import("../scripts/r20/metamorphic.mjs");
// Metamorphic regression of the hybrid Boolean (docs/hybrid-robust.md section 4,
// scripts/r20/metamorphic.mjs): frozen hybrid jobs (fixtures/r20/metamorphic)
// under transforms that are exact on the F32x2 job wire (signed axis
// permutations, 2^k scalings) must give answers that are never wrong, and
// should give one verdict class (exact | mesh | refused) in every frame.
//
// The wire tests cover every source and frame without Bend. The quick set runs
// a few sources that refuse or wobble today (goals 1-3) plus stable controls in
// 8 permutations x 2 scalings on the production entry: "never wrong" is
// asserted; one class and the target class are asserted where production has
// them already and are `todo` (with the production census as the note) where
// the robustness fixes still have to deliver them. The full sweep (3920 jobs)
// is `node scripts/r20/metamorphic.mjs sweep`. Budget: about 30 s.
// WONKY_METAMORPHIC_ENTRY=<path to a hybrid/main.bend> runs the quick set on
// another entry (a snapshot of the production kernel, a fix tree).








const expect = readExpect();
const provenance = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'provenance.json'), 'utf8'));
const names = sourceNames();

test('fixtures: 35 frozen sources, each with provenance, references and a target class', () => {
  assert.equal(names.length, 35);
  assert.deepEqual(Object.keys(expect.sources).sort(), names);
  assert.deepEqual(Object.keys(provenance.jobs).sort(), names);
  for (const n of names) {
    const sha = createHash('sha256').update(fs.readFileSync(path.join(FIXTURES, 'jobs', `${n}.job`))).digest('hex');
    assert.equal(provenance.jobs[n].sha256, sha, `${n}: provenance sha256`);
    assert.equal(expect.sources[n].sha256, sha, `${n}: expect sha256`);
    const s = expect.sources[n];
    assert.ok(s.reference.oracle?.volumeMm3 > 0 && s.reference.oracle.areaMm2 > 0, `${n}: mesh Boolean reference`);
    assert.ok(['exact', 'mesh'].includes(s.target.class), `${n}: target class`);
    if (s.target.class === 'exact') assert.ok(s.reference.exact?.volumeMm3 > 0 && s.reference.exact.basis, `${n}: exact reference volume with its basis`);
    assert.ok(provenance.jobs[n].dump && provenance.jobs[n].cli, `${n}: origin`);
  }
});

test('frames: 48 distinct signed permutations, p0 the identity; the sets hold what the plan names', () => {
  const keys = new Set(PERMUTATIONS.map(({ p, signs }) => `${p}|${signs}`));
  assert.equal(keys.size, 48);
  assert.deepEqual(PERMUTATIONS[0], { p: [0, 1, 2], signs: [0, 0, 0] });
  assert.equal(SETS.perm.length, 48);
  assert.deepEqual([...new Set(SETS.scale.map(f => frame(f).k))].sort((a, b) => a - b), [-3, -2, -1, 1, 2, 3]);
  assert.deepEqual(Object.keys(TRANSLATIONS), ['t1e3', 't1e4']);
  assert.equal(SETS.quick.length, 16);
  // the spread permutations reach all six axis orders and both parities
  assert.equal(new Set(SPREAD.map(i => String(PERMUTATIONS[i].p))).size, 6);
  assert.equal(new Set(SPREAD.map(i => frame(`p${i}`).flip)).size, 2);
});

test('wire: every identity copy is its source byte for byte; permutations and 2^k scalings are exact', () => {
  const exactFrames = [...SETS.perm, ...SPREAD.flatMap(i => [-3, -2, -1, 1, 2, 3].map(k => `p${i}s${k}`))];
  let n = 0;
  for (const s of names) {
    const text = sourceText(s);
    assert.equal(transformJob(text, frame('p0')), text, `${s}: identity copy`);
    for (const f of exactFrames) {
      const r = checkWire(text, frame(f)); n++;
      assert.ok(r.ok, `${s} ${f}: ${JSON.stringify(r)}`);
    }
  }
  assert.equal(n, 35 * (48 + 48));
});

test('wire: translations re-round each point to its nearest F32x2 value, and only that', () => {
  for (const s of ['kt6-id__model_union_step1', 'kt1-far__model_clearCut']) {
    const text = sourceText(s), src = parseJob(text);
    for (const t of Object.keys(TRANSLATIONS)) {
      const fr = frame(`p13${t}`), r = checkWire(text, fr), out = parseJob(transformJob(text, fr));
      const far = Math.max(...out.meshes.flatMap(m => m.vertices.flat().map(Math.abs)));
      assert.equal(r.exact, false);
      assert.ok(r.maxRoundingMm <= 2 ** -48 * far, `${s} ${t}: ${r.maxRoundingMm} mm`);
      assert.equal(out.deviationMm, src.deviationMm, 'a translation keeps the deviation');
    }
  }
});

test('wire: a scaling that would round is refused, not written', () => {
  const tiny = 8388608; // 2^-126 as an F32 word: times 2^-3 it is subnormal
  const job = ['wonky-bakeoff-job 1', 'case t', 'deviation 1008981770 0', 'meshes 1', 'mesh 0 1 0', `${tiny} 0 0 0 0 0`, 'end', ''].join('\n');
  assert.throws(() => transformJob(job, frame('p0s-3')), /not an F32 value/);
  assert.doesNotThrow(() => transformJob(job, frame('p0s3')));
});

test('judge: wrong answers are caught', () => {
  const ref = expect.sources['kt6-id__model_union_step1'].reference;
  const exactRow = v => ({ frame: 'p0', measure: { status: 'exact', S: 40, badEdges: 0, bodies: 1, volumeMm3: v, boundMm3: 1e-9 } });
  assert.equal(judge(exactRow(9100), ref).verdict, 'exact');
  assert.equal(judge(exactRow(9100.001), ref).verdict, 'wrong', 'a tight exact reference');
  assert.equal(judge({ ...exactRow(9100 * 8), frame: 'p5s1' }, ref).verdict, 'exact', 'volume scales by 2^3k');
  assert.equal(judge({ frame: 'p0', measure: { ...exactRow(9100).measure, badEdges: 2 } }, ref).verdict, 'wrong');
  const meshRow = patch => ({ frame: 'p0', measure: { status: 'mesh', S: 40, watertight: true, unpaired: 0, repeated: 0, degenerate: 0, components: 1, volumeMm3: 9100, areaMm2: 3420,
    statedDeviationWords: [1008981770, 796246671], jobDeviationWords: [1008981770, 796246671], maxInputDistanceMm: 0, ...patch } });
  assert.equal(judge(meshRow({}), ref).verdict, 'mesh');
  assert.equal(judge(meshRow({ watertight: false, unpaired: 3 }), ref).verdict, 'wrong');
  assert.equal(judge(meshRow({ maxInputDistanceMm: 1e-6 }), ref).verdict, 'wrong', 'a vertex off the input surface');
  assert.equal(judge(meshRow({ statedDeviationWords: [1008981771, 0] }), ref).verdict, 'wrong', 'a misstated deviation');
  assert.equal(judge(meshRow({ volumeMm3: 9099.99 }), ref).verdict, 'wrong', 'the mesh Boolean volume');
  assert.equal(judge(meshRow({ components: 2 }), ref).verdict, 'wrong');
  assert.equal(judge({ frame: 'p0', measure: { status: 'refused', reason: 'face triangulation failed', S: 40 } }, ref).verdict, 'refused');
  assert.equal(judge({ frame: 'p0', measure: { status: 'malformed', why: 'unnamed refusal', S: 40 } }, ref).verdict, 'malformed');
  assert.equal(judge({ frame: 'p0', crash: 'RangeError' }, ref).verdict, 'crash');
});

test('consensus reference: accepted only when every exact answer agrees and the mesh Boolean is within area x deviation', () => {
  const ref = { deviationMm: 0.01, oracle: { volumeMm3: 100, areaMm2: 100 } };
  const row = v => ({ kind: 'perm', measure: { status: 'exact', volumeMm3: v, boundMm3: 0, S: 16, badEdges: 0 } });
  assert.equal(consensusReference([row(100.5), row(100.5), row(100.5)], ref).ok, true);
  assert.equal(consensusReference([row(100.5), row(100.5), row(100.6)], ref).ok, false, 'an answer off the median');
  assert.equal(consensusReference([row(102), row(102)], ref).ok, false, 'beyond area x deviation of the mesh Boolean');
});

// ---------------------------------------------------------------------------
// The quick set on the production entry (kernel/hybrid/main.bend)

const QUICK = [
  'probe__model_hybrid_Tool_ReliefUnion', // goal 1: probe 612:9 (C1/C2)
  'kt6-rz45__model_union_step2', // goal 2: kt6 turned 45 deg (R1)
  'kt6-rz60__model_union_step2', // goal 2
  'kt6-rot__model_union_step0', // goal 2: 37 deg about (1,2,3)
  'kt1-far__model_clearCut', // goal 3: the recover needle at ~1000 mm (R2/R3)
  'kt6-id__model_union_step1', // control: exact everywhere
  'probe__model_pins_union1', // control: exact everywhere
];
const hist = rows => rows.reduce((h, r) => { const k = r.judged.cls ?? r.judged.verdict; h[k] = (h[k] ?? 0) + 1; return h; }, {});
const census = p => (p ? `production: identity ${p.identity}; 48 permutations ${JSON.stringify(p.perm)}, 2^k ${JSON.stringify(p.scale)}; reasons ${JSON.stringify(p.reasons)}` : 'no production census in expect.json');
const meetsTarget = (cls, reason, target) => cls === target.class || (cls === 'refused' && target.allowRefusal && new RegExp(target.allowRefusal).test(reason ?? ''));

const kernel = await loadKernel(process.env.WONKY_METAMORPHIC_ENTRY || undefined);
for (const source of QUICK) {
  test(`quick: ${source}`, async (t) => {
    const e = expect.sources[source], rows = SETS.quick.map(f => runFrame(kernel, source, f));
    await t.test('never wrong: each answer is a validated B-rep, a validated certified mesh or a named refusal', () => {
      const bad = rows.filter(r => !['exact', 'mesh', 'refused'].includes(r.judged.verdict)).map(r => `${r.frame}: ${r.judged.verdict}: ${r.judged.failed.join('; ')}`);
      assert.deepEqual(bad, []);
    });
    const p = e.production, stableToday = p?.stable === true;
    await t.test('one verdict class over the exact frames', stableToday ? {} : { todo: census(p) }, () => {
      assert.equal(Object.keys(hist(rows)).length, 1, JSON.stringify(hist(rows)));
    });
    const productionClasses = p ? Object.entries({ ...p.perm, ...p.scale }).filter(([, n]) => n) : [];
    const targetToday = p && productionClasses.every(([k]) => k === e.target.class) && productionClasses.length > 0;
    await t.test(`target class ${e.target.class}`, targetToday ? {} : { todo: `target after ${e.target.wave}; ${census(p)}` }, () => {
      const off = rows.filter(r => !meetsTarget(r.judged.cls, r.measure?.reason, e.target)).map(r => `${r.frame}: ${r.judged.cls ?? r.judged.verdict} ${r.judged.reason ?? ''}`);
      assert.deepEqual(off, []);
    });
  });
}

}
