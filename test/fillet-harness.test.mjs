// Focused tests of the fillet harness hardening (docs/fillet-plan.md §8 step
// 0): chamfer closed forms follow Onshape's setback reading, closed forms are
// evaluated on the job's own geometry, the divergence volume handles cones,
// the tight check follows the prototype's claim, and the grade on top of the
// validator's verdict. No OpenCascade and no prototype run: the "measured"
// volume below is the divergence volume standing in for OCCT's.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { decodeJob, decodeResult, encodeResult } from '../scripts/fillet/brepfmt.mjs';
import { catalogue, loadCases } from '../scripts/fillet/cases.mjs';
import { closedFormVariants, jobClosedForm, notch2D } from '../scripts/fillet/closedform.mjs';
import { divVolume } from '../scripts/fillet/divvolume.mjs';
import { jobPath, readSidecar } from '../scripts/fillet/fixtures.mjs';
import { faceOffsetSetback } from '../scripts/fillet/geom.mjs';
import { DIV_REL, gradeResult, gradeVerdict } from '../scripts/fillet/grade.mjs';
import { PROTOTYPES, prototype } from '../scripts/fillet/prototypes.mjs';
import { prismBody } from '../scripts/fillet/run-adversarial.mjs';
import { tightCheck } from '../scripts/fillet/tightcheck.mjs';
import { checkResult, compareMeasures } from '../scripts/fillet/validate.mjs';

const cases = loadCases();
const caseOf = (id) => cases.find((c) => c.id === id);
const jobText = (id) => fs.readFileSync(jobPath(id), 'utf8');
const reference = JSON.parse(fs.readFileSync(new URL('../fixtures/fillet/reference.json', import.meta.url), 'utf8'));
const occtResult = (id) => fs.readFileSync(new URL(`../out/fillet/oracle-occt/results/${id}.cpu1.result`, import.meta.url), 'utf8');
const haveOcct = fs.existsSync(new URL('../out/fillet/oracle-occt/results/pp-box-vertical-edge-r2.cpu1.result', import.meta.url));

// The harness grade of a result text, with the divergence volume standing in
// for OpenCascade's measurement of the exported STEP.
function grade(id, text, { spec = caseOf(id), claim = 'exact' } = {}) {
  const job = jobText(id), report = checkResult(job, text, spec);
  if (report.status === 'ok' && report.valid) {
    const v = divVolume(decodeResult(text).body).volume;
    report.comparison = compareMeasures({ volume: v, area: 1, valid: true, freeEdges: 0, solids: 1 }, spec, readSidecar(id), reference.cases[id], job);
  }
  return gradeResult({ spec, onshape: reference.onshape.cases[id] ?? null, ref: reference.cases[id], jobText: job, resultText: text, report, claim });
}

test('cases.json is the catalogue of cases.mjs, byte for byte', () => {
  const doc = JSON.parse(fs.readFileSync(new URL('../fixtures/fillet/cases.json', import.meta.url), 'utf8'));
  assert.equal(JSON.stringify(doc.cases), JSON.stringify(catalogue()));
});

test('chamfers follow Onshape EQUAL_OFFSETS (setback along the faces, FP-a): the face-offset form is a rejected alternative', () => {
  for (const id of ['ch-convex-60-d1', 'ch-cone-rim-0.42', 'ch-convex-120-hex-d1']) {
    const cf = caseOf(id).closedForm;
    assert.equal(cf.acceptAlternatives, false, id);
    assert.deepEqual(Object.keys(cf.alternatives), ['faceOffset'], id);
    assert.match(cf.formula, /setback d along each support face/, id);
    assert.ok(Math.abs(cf.alternatives.faceOffset - cf.deltaVolume) > 0.1 * Math.abs(cf.deltaVolume), `${id}: the readings differ`);
  }
  // 60°: -L d² sin(60°)/2 with L = 10, d = 1
  assert.ok(Math.abs(caseOf('ch-convex-60-d1').closedForm.deltaVolume + 5 * Math.sin(Math.PI / 3)) < 1e-12);
});

test('closed forms on the job geometry: every F32-rounded input has one, and every one agrees with its design value', () => {
  const missing = [], far = [];
  for (const c of cases) {
    if (!c.closedForm) continue;
    const nums = [...c.input.source.matchAll(/-?\d+\.?\d*(?:e-?\d+)?/g)].map((m) => Number(m[0]));
    const rounded = nums.some((x) => Math.fround(x) !== x);
    if (rounded && !c.closedForm.job) missing.push(c.id);
    if (!c.closedForm.job) continue;
    const j = jobClosedForm(c.closedForm.job, decodeJob(jobText(c.id)));
    const V = readSidecar(c.id).kernel.volumeMm3, diff = Math.abs(j.deltaVolume - c.closedForm.deltaVolume);
    // F32 sketch coordinates move the input by < 1e-6 mm: the forms differ by < 1e-8 × V;
    // exactly representable inputs agree to rounding.
    if (diff > (rounded ? 1e-8 : 1e-13) * V) far.push(`${c.id}: design ${c.closedForm.deltaVolume} job ${j.deltaVolume}`);
  }
  assert.deepEqual(missing, []);
  assert.deepEqual(far, []);
  // pp-convex-60-r2: the design form is 1.5e-9 × V off the job's geometry.
  const v = closedFormVariants(caseOf('pp-convex-60-r2').closedForm, decodeJob(jobText('pp-convex-60-r2'))).primary;
  assert.ok(Math.abs(v.designMinusJob) > 1e-9 * 1732 && Math.abs(v.designMinusJob) < 1e-8 * 1732, `${v.designMinusJob}`);
});

test('FP09: the notch closed form equals Onshape on the design geometry; the job form differs by the input rounding', () => {
  const on = reference.onshape.cases['hard-overflow-convex-small-face-r2'];
  const cf = caseOf('hard-overflow-convex-small-face-r2').closedForm;
  assert.ok(Math.abs(cf.deltaVolume - on.deltaVolume) < 1e-11, `${cf.deltaVolume} vs ${on.deltaVolume}`);
  const pts = [[0, 0], [20, 0], [20, 9.6], [19.6, 10], [0, 10]];
  const n = notch2D(pts, 2, 2);
  // Onshape's face areas: the 20-face keeps 87.71573 mm², the top face 195.7828 mm²
  assert.ok(Math.abs(n.trim[0] * 10 - 195.7828) < 1e-4 && Math.abs(n.trim[1] - 10) < 1e-12);
  const j = jobClosedForm(cf.job, decodeJob(jobText('hard-overflow-convex-small-face-r2')));
  assert.ok(Math.abs(j.deltaVolume - cf.deltaVolume) > 5e-8 && Math.abs(j.deltaVolume - cf.deltaVolume) < 1e-7);
});

test('divergence volume: cones by the apex form (a lofted frustum and its rim chamfer)', () => {
  const job = decodeJob(jobText('ch-cone-rim-0.42'));
  assert.ok(job.body.faces.some((f) => f.surface.type === 'cone'));
  const V = (Math.PI * 10 * (64 + 40 + 25)) / 3; // frustum R 8, r 5, h 10
  assert.ok(Math.abs(divVolume(job.body).volume - V) < 1e-9 * V, `${divVolume(job.body).volume} vs ${V}`);
  if (!haveOcct) return;
  // OCCT's replayed rim fillet on the cone (cone and torus faces) meets its closed form.
  const body = decodeResult(occtResult('pc-cone-rim-r1')).body;
  const cf = closedFormVariants(caseOf('pc-cone-rim-r1').closedForm, job).primary.value;
  assert.ok(Math.abs(divVolume(body).volume - divVolume(job.body).volume - cf) < 1e-9 * V);
});

test('the tight check follows the prototype claim', { skip: !haveOcct && 'local-only fixture: no OCCT replay results' }, () => {
  const id = 'pp-box-vertical-edge-r2', job = jobText(id), body = decodeResult(occtResult(id)).body;
  assert.equal(tightCheck(job, encodeResult({ status: 'ok', body })).ok, true);
  const approx = structuredClone(body);
  approx.faces.find((f) => f.role === 'blend').tol = 1e-9;
  const t = encodeResult({ status: 'ok', body: approx });
  assert.match(tightCheck(job, t, { claim: 'exact' }).issues[0], /^claim: .*claims exact/);
  assert.equal(tightCheck(job, t, { claim: 'approximate' }).ok, true);
  approx.faces.find((f) => f.role === 'support').tol = 1e-9;
  assert.match(tightCheck(job, encodeResult({ status: 'ok', body: approx }), { claim: 'approximate' }).issues[0], /support and cap faces lie on input surfaces/);
  // a stated tolerance must hold: a blend 5e-8 off, stating 1e-9
  const off = structuredClone(body);
  const blend = off.faces.find((f) => f.role === 'blend');
  blend.tol = 1e-9;
  blend.surface.radius += 5e-8;
  assert.ok(tightCheck(job, encodeResult({ status: 'ok', body: off }), { claim: 'approximate' }).issues.some((x) => x.startsWith('stated:')));
  assert.equal(prototype('fillet-kpart').claim, 'exact');
  assert.equal(prototype('fillet-rollingball-tori').claim, 'approximate');
  assert.equal(prototype('fillet-rollingball-spline').claim, 'approximate');
  assert.equal(prototype('fillet-someday').claim, 'exact');
  assert.ok(Object.values(PROTOTYPES).every((p) => ['exact', 'approximate'].includes(p.claim)));
});

test('a face-offset chamfer fails ch-convex-60-d1; the setback chamfer passes (and only the hardened catalogue tells them apart)', () => {
  const id = 'ch-convex-60-d1', J = decodeJob(jobText(id));
  const base = J.body.vertices.filter((v) => v[2] === 0).map((v) => [v[0], v[1]]);
  const top = base.reduce((a, p) => (p[1] > a[1] ? p : a));
  const [P, N] = base.filter((p) => p !== top).sort((a, b) => b[0] - a[0]); // right, left
  const u = (p) => { const l = Math.hypot(p[0] - top[0], p[1] - top[1]); return [(p[0] - top[0]) / l, (p[1] - top[1]) / l]; };
  const alpha = Math.acos(u(P)[0] * u(N)[0] + u(P)[1] * u(N)[1]);
  const cut = (s) => {
    const { body } = prismBody([N, P, [top[0] + s * u(P)[0], top[1] + s * u(P)[1]], [top[0] + s * u(N)[0], top[1] + s * u(N)[1]]], 10);
    body.faces = body.faces.map((f, i) => ({ ...f, role: i === 4 ? 'blend' : 'support', tol: 0 }));
    return encodeResult({ status: 'ok', body });
  };
  const setback = grade(id, cut(1)), faceOffset = grade(id, cut(faceOffsetSetback(1, alpha)));
  assert.equal(setback.verdict, 'pass');
  assert.equal(setback.checks.div.ok, true);
  assert.equal(faceOffset.verdict, 'mismatch');
  // The pre-hardening catalogue entry (face offset accepted) let it pass.
  const old = { ...caseOf(id), closedForm: { deltaVolume: caseOf(id).closedForm.alternatives.faceOffset, alternatives: { inSupport: caseOf(id).closedForm.deltaVolume }, acceptAlternatives: true } };
  assert.equal(grade(id, cut(faceOffsetSetback(1, alpha)), { spec: old }).verdict, 'pass');
});

test('grade: a pass is demoted by the tight check, then the divergence volume, then (gated) strict STEP', () => {
  const tightBad = { status: 'ok', ok: false, issues: ['x'] }, tightOk = { status: 'ok', ok: true, issues: [] };
  const divBad = { status: 'ok', ok: false }, divOk = { status: 'ok', ok: true };
  assert.equal(gradeVerdict('pass', { tight: tightBad, div: divBad }), 'tight-fail');
  assert.equal(gradeVerdict('pass-approx', { tight: tightOk, div: divBad }), 'div-mismatch');
  assert.equal(gradeVerdict('pass', { tight: tightOk, div: { status: 'unsupported' } }), 'pass');
  assert.equal(gradeVerdict('pass', { tight: tightOk, div: divOk, stepStrict: { ok: false } }), 'pass');
  assert.equal(gradeVerdict('pass', { tight: tightOk, div: divOk, stepStrict: { ok: false }, stepGate: true }), 'step-fail');
  assert.equal(gradeVerdict('declined', { tight: tightBad }), 'declined');
  assert.equal(DIV_REL, 1e-9);
});
