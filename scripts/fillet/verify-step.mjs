#!/usr/bin/env node
// Fillet harness TEST INFRASTRUCTURE (verify:fillet-kpart, 24 September 2026):
// STEP acceptance of a harness run's valid results with the repository's
// independent checker `uv run scripts/validate-step.py` (OpenCascade reads the
// STEP, BRepCheck with exact CurveOnSurface, topology counts against the
// result B-rep, volume against the expected volume). It computes no geometry.
//
//   node scripts/fillet/verify-step.mjs --run <out/fillet/.../run> [--jobs fixtures/fillet/jobs] [--catalogue fixtures/fillet/cases.json] [--target cpu1] [--writer production|harness]
//
// For each case the run scored `pass*` it writes <run>/stepcheck/<id>.step
// (validate.mjs resultStepFor: --writer production = src/exporters.mjs on the
// production types, the default for a run whose report names it; else the
// harness writer) and <id>.brep.json (the result B-rep; expected volume =
// the passing closed form, else the matching Onshape value, else a valid
// matching OCCT oracle's, else the result's divergence volume),
// runs validate-step.py per case (4 at a time) and writes
// <run>/stepcheck/report.json. run.mjs uses strictStep for every valid result
// of a run (docs/fillet-plan.md §8 step 0).

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkResult, resultStepFor } from './validate.mjs';
import { decodeResult } from './brepfmt.mjs';
import { divVolume } from './divvolume.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function run(exe, args) {
  return new Promise((resolve) => {
    const c = spawn(exe, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    c.stdout.on('data', (b) => { out += b; });
    c.stderr.on('data', (b) => { err += b; });
    c.on('close', (code) => resolve({ code, out, err }));
  });
}

// Strict STEP of one result: <prefix>.step must exist; writes <prefix>.brep.json
// (the result B-rep with the expected volume) and runs validate-step.py.
export async function strictStep(prefix, body, expected) {
  fs.writeFileSync(`${prefix}.brep.json`, JSON.stringify({ bodies: [{ vertices: body.vertices, edges: body.edges, faces: body.faces, validation: { volumeMm3: expected } }] }));
  const r = await run('uv', ['run', '--quiet', 'scripts/validate-step.py', path.relative(ROOT, prefix)]);
  let j = null;
  try { j = r.code === 0 ? JSON.parse(r.out)[0] : null; } catch { j = null; }
  return j ? { ok: true, faces: j.faces, edges: j.edges, vertices: j.vertices, volumeMm3: j.volumeMm3, expected, relErr: expected ? Math.abs(j.volumeMm3 - expected) / expected : null, seamsAdded: j.periodicSeamsAdded, degenerated: j.degeneratedEdgesAdded }
    : { ok: false, error: (r.err.trim().split('\n').pop() ?? '').slice(0, 400) };
}

async function main(argv) {
  const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const runDir = path.resolve(opt('--run'));
  const jobs = path.resolve(opt('--jobs', path.join(ROOT, 'fixtures/fillet/jobs')));
  const target = opt('--target', 'cpu1');
  const cat = JSON.parse(fs.readFileSync(path.resolve(opt('--catalogue', path.join(ROOT, 'fixtures/fillet/cases.json'))), 'utf8')).cases;
  const rep = JSON.parse(fs.readFileSync(path.join(runDir, 'report.json'), 'utf8'));
  const writer = opt('--writer', rep.stepWriter ?? 'harness');
  const results = [];
  const dir = path.join(runDir, 'stepcheck');
  fs.mkdirSync(dir, { recursive: true });
  const todo = [];
  for (const e of rep.cases) {
    if (!String(e.verdict).startsWith('pass')) continue;
    const spec = cat.find((c) => c.id === e.id);
    const text = fs.readFileSync(path.join(runDir, 'results', `${e.id}.${target}.result`), 'utf8');
    const r = checkResult(fs.readFileSync(path.join(jobs, `${e.id}.job`), 'utf8'), text, spec);
    const cmp = e.report?.comparison ?? {};
    const cf = cmp.closedForm ? Object.values(cmp.closedForm).find((v) => v.ok) : null;
    // as run.mjs strictSteps: never an oracle volume the result does not match
    const occt = cmp.occt?.occtValid && cmp.occt.volumeOk ? cmp.occt.volume : null;
    const expected = cf?.expected ?? (cmp.onshape?.ok ? cmp.onshape.expected : null) ?? occt ?? divVolume(decodeResult(text).body).volume ?? null;
    const prefix = path.join(dir, e.id);
    const written = await resultStepFor(writer, r.body, text, e.id);
    if (!written.ok) { results.push({ id: e.id, ok: false, error: written.error }); console.log(`${e.id.padEnd(46)} FAIL ${written.error}`); continue; }
    fs.writeFileSync(`${prefix}.step`, written.step);
    todo.push({ id: e.id, prefix, expected, body: written.body });
  }
  const one = async (t) => {
    const res = { id: t.id, ...(await strictStep(t.prefix, t.body, t.expected)) };
    results.push(res);
    console.log(`${t.id.padEnd(46)} ${res.ok ? `ok   vol rel err ${res.relErr?.toExponential(1) ?? '-'}` : `FAIL ${res.error}`}`);
  };
  for (let i = 0; i < todo.length; i += 4) await Promise.all(todo.slice(i, i + 4).map(one));
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(results, null, 1) + '\n');
  console.log(`${results.filter((r) => r.ok).length}/${results.length} pass validate-step.py (${writer} writer)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((err) => { console.error(err.stack ?? err.message); process.exit(1); });
}
