#!/usr/bin/env node
// Fillet harness TEST INFRASTRUCTURE: validator self-test by mutation.
//
//   node scripts/fillet/selftest.mjs [--no-occt]
//
// Takes known-good blends (OCCT results replayed from out/fillet/oracle-occt,
// produced by `uv run scripts/fillet/reference.py --dump ...`) and the input
// bodies, applies one defect each, and asserts the verdict the harness must
// give: the validator's (validate.mjs) and the grade on top of it (grade.mjs:
// tight check with the prototype's claim, divergence volume). Exit 1 if any
// expectation fails.

import fs from 'node:fs';
import path from 'node:path';
import { encodeResult, decodeJob, decodeResult } from './brepfmt.mjs';
import { ROOT, loadCases } from './cases.mjs';
import { jobPath, readSidecar } from './fixtures.mjs';
import { faceOffsetSetback } from './geom.mjs';
import { gradeResult } from './grade.mjs';
import { prismBody } from './run-adversarial.mjs';
import { checkResult, compareMeasures, occtMeasure, resultStep } from './validate.mjs';

const noOcct = process.argv.includes('--no-occt');
const cases = loadCases();
const reference = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/fillet/reference.json'), 'utf8'));
const spec = (id) => cases.find((c) => c.id === id);
const job = (id) => fs.readFileSync(jobPath(id), 'utf8');
const occt = (id) => {
  const p = path.join(ROOT, 'out/fillet/oracle-occt/results', `${id}.cpu1.result`);
  if (!fs.existsSync(p)) throw new Error(`missing ${p}: run uv run scripts/fillet/reference.py --dump out/fillet/oracle-occt/results`);
  return decodeResult(fs.readFileSync(p, 'utf8')).body;
};
const clone = (x) => JSON.parse(JSON.stringify(x));
const text = (body) => encodeResult({ status: 'ok', body });

const T = [];
const test = (name, id, resultText, expect, specOverride = null, claim = 'exact') => T.push({ name, id, resultText, expect, spec: specOverride ?? spec(id), claim });

// 0. Controls: unmodified OCCT blends pass.
test('control: OCCT single-edge fillet', 'pp-box-vertical-edge-r2', text(occt('pp-box-vertical-edge-r2')), ['pass']);
test('control: OCCT rim torus', 'pc-post-top-rim-r1', text(occt('pc-post-top-rim-r1')), ['pass']);
// 1. F15 silent no-op: the input body returned with a support face relabelled as the chamfer.
{
  const b = decodeJob(job('ch-box-vertical-edge-d1')).body;
  b.faces = b.faces.map((f, i) => ({ ...f, role: i === 0 ? 'blend' : 'support', tol: 0 }));
  test('F15 no-op (input returned as result)', 'ch-box-vertical-edge-d1', text(b), ['no-op']);
}
// 2. Wrong radius: torus minor 1 -> 1.05 (the springs no longer lie on the torus).
{
  const b = clone(occt('pc-post-top-rim-r1'));
  b.faces.find((f) => f.surface.type === 'torus').surface.minor = 1.05;
  test('wrong blend radius', 'pc-post-top-rim-r1', text(b), ['invalid']);
}
// 3. Flipped blend face orientation.
{
  const b = clone(occt('pp-box-vertical-edge-r2'));
  const f = b.faces.find((x) => x.role === 'blend');
  f.sameSense = !f.sameSense;
  test('flipped blend face', 'pp-box-vertical-edge-r2', text(b), ['invalid']);
}
// 4. Dropped face (open shell).
{
  const b = clone(occt('pp-box-vertical-edge-r2'));
  b.faces.splice(b.faces.findIndex((x) => x.role === 'support'), 1);
  test('dropped face', 'pp-box-vertical-edge-r2', text(b), ['invalid']);
}
// 5. Vertex moved by 1e-4 mm.
{
  const b = clone(occt('pp-box-all-edges-r2'));
  b.vertices[0] = b.vertices[0].map((x) => x + 1e-4);
  test('vertex off by 1e-4 mm', 'pp-box-all-edges-r2', text(b), ['invalid']);
}
// 6. A valid fillet on the wrong edge of the same box.
test('fillet on the wrong edge', 'pp-box-vertical-edge-r2', text(occt('pp-box-top-edge-r1')), ['invalid', 'mismatch']);
// 7. Stated approximations (a prototype claiming approximate blends): 0.001 mm
// admitted (pass-approx), 0.05 mm rejected.
{
  const b = clone(occt('pc-post-top-rim-r1'));
  b.faces.find((f) => f.surface.type === 'torus').tol = 0.001;
  test('approximation 0.001 mm', 'pc-post-top-rim-r1', text(b), ['pass-approx'], null, 'approximate');
  const c = clone(b);
  c.faces.find((f) => f.surface.type === 'torus').tol = 0.05;
  test('approximation 0.05 mm', 'pc-post-top-rim-r1', text(c), ['invalid'], null, 'approximate');
}
// 8. A result where the case must refuse.
test('result for a must-refuse case', 'pp-box-vertical-edge-r2', text(occt('pp-box-vertical-edge-r2')), ['wrong'], { ...spec('pp-box-vertical-edge-r2'), expect: 'must-refuse' });
// 9. Refusals: typed, untyped class, malformed.
test('typed refusal on an ok case', 'pp-box-vertical-edge-r2', 'unresolved not-implemented test\nend\n', ['declined']);
test('unknown refusal class on either case', 'hard-full-round-r5', 'unresolved gave-up\nend\n', ['expected-refusal']);
test('malformed result', 'pp-box-vertical-edge-r2', 'ok\nbrep 1 0 0\nv 1 2\nend\n', ['error']);
// 10. Closed-form alternative accepted (OCCT's corner triangle).
test('accepted alternative closed form', 'ch-box-corner-3-d1', text(occt('ch-box-corner-3-d1')), ['pass']);
// 11. Chamfer semantics (docs/fillet-plan.md §8 step 0): the 60° triangle
// prism of ch-convex-60-d1, rebuilt from the job's own vertices with its apex
// cut back by s along both faces. Onshape EQUAL_OFFSETS sets back d along each
// face (probe FP-a); the face-offset reading (s = d cot(a/2)) must not pass.
{
  const J = decodeJob(job('ch-convex-60-d1')), h = 10, d = 1;
  const base = J.body.vertices.filter((v) => v[2] === 0).map((v) => [v[0], v[1]]);
  const c = [0, 1].map((k) => base.reduce((a, p) => a + p[k], 0) / base.length);
  base.sort((p, q) => Math.atan2(p[1] - c[1], p[0] - c[0]) - Math.atan2(q[1] - c[1], q[0] - c[0]));
  const k = base.findIndex((p) => p[1] === Math.max(...base.map((q) => q[1]))), A = base[k], P = base[(k + 1) % 3], N = base[(k + 2) % 3];
  const u = (p) => { const l = Math.hypot(p[0] - A[0], p[1] - A[1]); return [(p[0] - A[0]) / l, (p[1] - A[1]) / l]; };
  const alpha = Math.acos(u(P)[0] * u(N)[0] + u(P)[1] * u(N)[1]);
  const cut = (sb) => {
    // counter-clockwise: ..., N, A, P, ... becomes ..., N, A + s u(N), A + s u(P), P, ...
    const poly = [P, N, [A[0] + sb * u(N)[0], A[1] + sb * u(N)[1]], [A[0] + sb * u(P)[0], A[1] + sb * u(P)[1]]];
    const { body } = prismBody(poly, h);
    body.faces = body.faces.map((f, i) => ({ ...f, role: i === 4 ? 'blend' : 'support', tol: 0 }));
    return text(body);
  };
  test('chamfer setback d along the faces (Onshape FP-a)', 'ch-convex-60-d1', cut(d), ['pass']);
  test('face-offset chamfer mutant', 'ch-convex-60-d1', cut(faceOffsetSetback(d, alpha)), ['mismatch']);
}
// 12. Tight-check mutations the validator's tolerances admit (grade.mjs):
// a support plane moved by 1e-8 mm (GEOM_TOL 1e-6), a blend radius off by
// 5e-8 mm (RADIUS_TOL 1e-7), and a face stating a tolerance from a prototype
// that claims exact geometry.
{
  const b = clone(occt('pp-box-vertical-edge-r2'));
  const f = b.faces.find((x) => x.role === 'support' && x.surface.type === 'plane' && x.surface.normal[0] === 1);
  f.surface.origin = f.surface.origin.map((x, i) => x + 1e-8 * f.surface.normal[i]);
  test('support plane moved by 1e-8 mm', 'pp-box-vertical-edge-r2', text(b), ['tight-fail']);
}
{
  const b = clone(occt('pc-post-top-rim-r1'));
  b.faces.find((f) => f.surface.type === 'torus').surface.minor = 1 + 5e-8;
  test('blend radius off by 5e-8 mm', 'pc-post-top-rim-r1', text(b), ['tight-fail']);
}
{
  const b = clone(occt('pp-box-vertical-edge-r2'));
  b.faces.find((f) => f.role === 'blend').tol = 1e-9;
  test('exact claim, a blend states tol 1e-9', 'pp-box-vertical-edge-r2', text(b), ['tight-fail']);
  test('approximate claim, a blend states tol 1e-9', 'pp-box-vertical-edge-r2', text(b), ['pass-approx'], null, 'approximate');
  const c = clone(b);
  c.faces.find((f) => f.role === 'support').tol = 1e-9;
  test('approximate claim, a support states tol 1e-9', 'pp-box-vertical-edge-r2', text(c), ['tight-fail'], null, 'approximate');
}

const reports = T.map((t) => ({ t, r: checkResult(job(t.id), t.resultText, t.spec) }));
const need = reports.filter(({ r }) => r.status === 'ok' && r.valid);
if (need.length && !noOcct) {
  fs.mkdirSync(path.join(ROOT, 'tmp/fillet/selftest-harness'), { recursive: true });
  const files = need.map(({ t, r }, i) => {
    const f = path.join(ROOT, 'tmp/fillet/selftest-harness', `${i}-${t.id}.step`);
    fs.writeFileSync(f, resultStep(r.body, t.id));
    return f;
  });
  const ms = await occtMeasure(files);
  need.forEach(({ t, r }, i) => {
    const s = { ...t.spec, _approxTolMm: Math.max(0, ...r.surfaces.approximated.map((a) => a.tolMm)) };
    r.comparison = compareMeasures(ms[i], s, readSidecar(t.id), reference.cases[t.id], job(t.id));
  });
}
let failed = 0;
for (const { t, r } of reports) {
  const g = gradeResult({ spec: t.spec, onshape: t.spec?.onshape ?? null, ref: reference.cases[t.id], jobText: job(t.id), resultText: t.resultText, report: r, claim: t.claim });
  const v = g.verdict;
  const ok = t.expect.includes(v);
  if (!ok) failed++;
  const why = r.status === 'unresolved' ? `refusal ${r.refusal.class} known=${r.refusal.knownClass}`
    : v === 'tight-fail' ? g.checks.tight.issues[0]
      : (r.issues?.[0] ?? (r.comparison?.matchesClosedForm ? `closed form ${r.comparison.matchesClosedForm}${g.checks.div?.status === 'ok' ? `, div ${g.checks.div.ok ? 'ok' : 'FAIL'}` : ''}` : ''));
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${t.name.padEnd(44)} ${v.padEnd(17)} (want ${t.expect.join('|')}) ${String(why).slice(0, 110)}`);
}
console.log(`${T.length - failed}/${T.length} expectations met`);
process.exit(failed ? 1 : 0);
