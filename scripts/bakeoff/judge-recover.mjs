#!/usr/bin/env node
// Boolean bake-off TEST INFRASTRUCTURE (judge): grades the B-reps that the
// "recover" prototype wrote during a run.mjs run, for the corpus or for a
// suite directory (scripts/bakeoff/suite.mjs). Same checks as
// scripts/bakeoff/recover-check.mjs (whose functions it reuses unchanged):
// kernel validation, STEP export, OpenCascade BRepCheck + self-interference,
// scripts/validate-step.py, volume and area against the OCCT CSG oracle.
// Additionally it records whether scripts/validate-step.py accepted the STEP
// file as is (`strictValidateStep`) or only through recover-check's
// seam/vertex refinement rule. It computes no geometry.
//
//   node scripts/bakeoff/judge-recover.mjs --results <dir> --out <dir> [--suite <dir>] [--target cpu1]
//
// Results of the "hybrid" prototype (kernel/hybrid/main.bend) are graded as the
// recover text they carry: `exact` as recover's `ok`, `mesh <dev> <reason>` as
// recover's refusal `unresolved <reason>`.

import fs from 'node:fs';
import path from 'node:path';
import { loadKernel } from '../../src/kernel.mjs';
import { ROOT, loadCases } from './fixtures.mjs';
import { checkVerdict, exportRecovered, gradeRows } from './recover-check.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const results = path.resolve(arg('--results'));
const out = path.resolve(arg('--out'));
const suite = arg('--suite') ? path.resolve(arg('--suite')) : null;
const target = arg('--target', 'cpu1');

function recoverTextOf(text) {
  if (text.startsWith('exact\n')) return `ok\n${text.slice(6)}`;
  const m = /^mesh \d+ \d+ (.*)\n/.exec(text);
  return m ? `unresolved ${m[1]}\nend\n` : text;
}

const cases = suite ? JSON.parse(fs.readFileSync(path.join(suite, 'cases.json'), 'utf8')).cases : loadCases();
const reference = JSON.parse(fs.readFileSync(suite ? path.join(suite, 'reference.json') : path.join(ROOT, 'fixtures/bakeoff/reference.json'), 'utf8'));
const kernel = await loadKernel();
const rows = [];
for (const c of cases) {
  const file = [target, 'cpu1', 'cpuN', 'js', 'metal'].map((t) => path.join(results, `${c.id}.${t}.result`)).find((p) => fs.existsSync(p));
  const row = { id: c.id, category: c.category, expect: c.expect ?? 'solid' };
  if (!file) {
    row.status = 'no-source';
    rows.push(row);
    continue;
  }
  row.source = path.relative(ROOT, file);
  try {
    Object.assign(row, await exportRecovered(recoverTextOf(fs.readFileSync(file, 'utf8')), c.id, path.join(out, 'step', c.id), kernel));
  } catch (err) {
    row.status = 'invalid';
    row.error = err.message;
  }
  rows.push(row);
}
const exported = rows.filter((r) => r.status === 'ok' && !r.empty);
await gradeRows(exported, reference, out);
for (const r of rows) {
  r.verdict = r.status === 'no-source' ? 'no-source' : checkVerdict(r);
  if (r.validateStep) r.strictValidateStep = r.validateStep.ok === true && !r.validateStep.refinement;
}
const counts = {};
for (const r of rows) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
const exact = rows.filter((r) => r.verdict === 'exact');
const summary = {
  counts,
  exact: exact.length,
  exactNonEmpty: exact.filter((r) => !r.empty).length,
  exactStrictValidateStep: exact.filter((r) => r.strictValidateStep).length,
  exactViaRefinementRule: exact.filter((r) => r.validateStep?.refinement).length,
};
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'check.json'), JSON.stringify({ schema: 'wonky-judge-recover/1', capturedAt: new Date().toISOString(), results: path.relative(ROOT, results), suite: suite && path.relative(ROOT, suite), summary, rows }, null, 1) + '\n');
console.log(JSON.stringify(summary));
