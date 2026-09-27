#!/usr/bin/env node
// Boolean bake-off TEST INFRASTRUCTURE for the "recover" prototype: replays the
// adversarial verifier's cases (fixtures/bakeoff/adversarial-recover.json; the
// verifier's manifold3d inputs and mutations in out/bakeoff/adversarial-recover)
// through recovery and grades every output with the same rules the verifier
// used: OCCT BRepCheck (exact CurveOnSurface), BOPAlgo_ArgumentAnalyzer
// self-interference, volume and area within 1e-7 of the OCCT CSG, and refusal
// where the case expects one. It computes no geometry.
//
//   node scripts/bakeoff/recover-adversarial.mjs [--cases a,b] [--native] [--no-occt]
//
// Inputs are copied once into out/bakeoff/recover/adversarial/inputs (the
// verifier's directory is only read). Output: report.json / report.md there.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadKernel } from '../../src/kernel.mjs';
import { loadBend } from '../../src/bend-loader.mjs';
import { ROOT } from './fixtures.mjs';
import { exportRecovered, occtCheck } from './recover-check.mjs';

const SRC = path.join(ROOT, 'out/bakeoff/adversarial-recover');
const DIR = path.join(ROOT, 'out/bakeoff/recover/adversarial');

// Verdicts that must never occur: an ok output that is invalid, wrong, or that
// accepts an input the case says must be refused.
export const BAD = /^(INVALID|WRONG|OK-ON-CONTACT|INVALID-INPUT)/;

function collect() {
  fs.mkdirSync(path.join(DIR, 'inputs'), { recursive: true });
  const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/bakeoff/adversarial-recover.json'), 'utf8'));
  const refFile = path.join(DIR, 'reference.json');
  if (!fs.existsSync(refFile)) fs.copyFileSync(path.join(SRC, 'reference.json'), refFile);
  const ref = JSON.parse(fs.readFileSync(refFile, 'utf8'));
  const globalRef = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/bakeoff/reference.json'), 'utf8')).cases;
  const cases = [];
  const copy = (from, id) => {
    const to = path.join(DIR, 'inputs', `${id}.recover.job`);
    if (!fs.existsSync(to) && fs.existsSync(from)) fs.copyFileSync(from, to);
    return fs.existsSync(to) ? to : null;
  };
  for (const c of doc.cases) {
    const input = copy(path.join(SRC, 'inputs', `${c.id}.recover.job`), c.id);
    if (input) cases.push({ id: c.id, expect: c.expect ?? 'solid', input, ref: ref[c.id] });
  }
  const mdir = path.join(SRC, 'mutations');
  const metas = fs.existsSync(mdir) ? fs.readdirSync(mdir).filter((f) => f.endsWith('.json')) : [];
  for (const f of metas) {
    const meta = JSON.parse(fs.readFileSync(path.join(mdir, f), 'utf8'));
    const metaCopy = path.join(DIR, 'inputs', f);
    if (!fs.existsSync(metaCopy)) fs.writeFileSync(metaCopy, JSON.stringify(meta, null, 1) + '\n');
    const input = copy(path.join(mdir, `${meta.id}.recover.job`), meta.id);
    if (input) cases.push({ id: meta.id, expect: meta.expect, input, ref: globalRef[meta.refCase] ?? ref[meta.refCase] });
  }
  // Verifier control (axis-aligned ice-cream cone), kept as a regression case.
  const ctl = path.join(SRC, 'control', 'ctl-cone-sphere-axis');
  if (fs.existsSync(`${ctl}.job`) && !fs.existsSync(path.join(DIR, 'inputs', 'ctl-cone-sphere-axis.recover.job'))) {
    fs.writeFileSync(path.join(DIR, 'inputs', 'ctl-cone-sphere-axis.recover.job'), fs.readFileSync(`${ctl}.job`, 'utf8') + fs.readFileSync(`${ctl}.result`, 'utf8'));
  }
  const ctlIn = path.join(DIR, 'inputs', 'ctl-cone-sphere-axis.recover.job');
  if (fs.existsSync(ctlIn)) cases.push({ id: 'ctl-cone-sphere-axis', expect: 'solid', input: ctlIn, ref: null, closedForm: Math.PI * ((3.2 / 3) * (4 + 7.2 + 12.96) + 288 - (1.44 * 16.8) / 3) /* frustum z 0..3.2 + ball - cap below z 3.2 */ });
  return cases;
}

function kind(expect) {
  if (expect.startsWith('refuse')) return 'refuse';
  if (expect.startsWith('same')) return 'solid';
  return expect;
}

export function adversarialVerdict(r) {
  const e = kind(r.expect);
  if (r.status === 'crash') return 'CRASH';
  if (r.status === 'unresolved') return (e === 'non-manifold-contact' || e === 'refuse') ? 'expected-refusal' : 'unresolved';
  if (e === 'refuse') return 'INVALID-INPUT-ACCEPTED-OK';
  if (r.error) return 'INVALID-OK (decode/validateAnalytic/export failed)';
  if (r.empty) return e === 'empty' ? 'exact-empty' : 'WRONG-EMPTY';
  if (e === 'empty') return 'WRONG-NONEMPTY';
  if (e === 'non-manifold-contact') return 'OK-ON-CONTACT (should refuse)';
  if (!r.occt) return 'ok-unchecked';
  if (r.occt.error || !r.occt.valid) return 'INVALID-OK (OCCT BRepCheck)';
  if (r.occt.interferenceFree === false) return 'INVALID-OK (self-interference)';
  if (r.volErr === undefined) return 'ok-unscored';
  return r.volErr < 1e-7 && r.areaErr < 1e-7 && r.solidsMatch !== false ? 'exact' : 'WRONG-GEOMETRY';
}

async function main(argv) {
  const only = argv.includes('--cases') ? argv[argv.indexOf('--cases') + 1].split(',') : null;
  const native = argv.includes('--native');
  const cases = collect().filter((c) => !only || only.includes(c.id));
  const mod = native ? null : await loadBend(path.join(ROOT, 'kernel/proto/recover/main.bend'));
  const kernel = await loadKernel();
  fs.mkdirSync(path.join(DIR, 'results'), { recursive: true });
  const rows = [];
  for (const c of cases) {
    const row = { id: c.id, expect: c.expect };
    const out = path.join(DIR, 'results', `${c.id}.${native ? 'cpu1' : 'js'}.result`);
    let text;
    try {
      if (native) {
        const r = spawnSync(path.join(ROOT, 'out/bakeoff/recover/build/cpu'), ['--threads', '1', '--gpu', 'off', '--', c.input, out], { encoding: 'utf8', env: { ...process.env, BEND_NO_TELEMETRY: '1' }, timeout: 600000 });
        if (r.status !== 0) throw new Error(`native run failed: ${r.stderr.slice(-300)}`);
        row.computeMs = JSON.parse(r.stdout.trim().split('\n').pop()).computeMs;
        text = fs.readFileSync(out, 'utf8');
      } else {
        const t0 = performance.now();
        text = mod.run(fs.readFileSync(c.input, 'utf8'));
        row.computeMs = +(performance.now() - t0).toFixed(1);
        fs.writeFileSync(out, text);
      }
    } catch (err) {
      row.status = 'crash';
      row.reason = err.message;
      rows.push(row);
      continue;
    }
    row.status = text.startsWith('ok') ? 'ok' : 'unresolved';
    if (row.status !== 'ok') row.reason = text.split('\n')[0].replace(/^unresolved /, '');
    else {
      try {
        Object.assign(row, await exportRecovered(text, c.id, path.join(DIR, 'step', c.id), kernel));
      } catch (err) {
        row.error = err.message;
      }
    }
    row.ref = c.ref?.occt ?? (c.closedForm ? { volume: c.closedForm } : null);
    rows.push(row);
  }
  const exported = rows.filter((r) => r.status === 'ok' && !r.empty && !r.error);
  if (!argv.includes('--no-occt') && exported.length) {
    const occ = await occtCheck(exported.map((r) => path.join(DIR, 'step', `${r.id}.step`)));
    exported.forEach((r, i) => {
      r.occt = occ[i];
      if (r.ref && !occ[i].error) {
        r.volErr = Math.abs(occ[i].volume - r.ref.volume) / r.ref.volume;
        r.areaErr = r.ref.area ? Math.abs(occ[i].area - r.ref.area) / r.ref.area : 0;
        r.solidsMatch = r.ref.solids === undefined ? undefined : occ[i].solids === r.ref.solids;
      }
    });
  }
  for (const r of rows) {
    r.verdict = adversarialVerdict(r);
    delete r.ref;
  }
  const e1 = (x) => (x === undefined || x === null ? '-' : x.toExponential(1));
  const L = ['| case | expect | verdict | F/E/V | vol rel err vs OCCT CSG | area rel err | interference | compute ms | reason |', '|---|---|---|---|---|---|---|---|---|'];
  for (const r of rows) {
    const t = r.topology ? `${r.topology.faces}/${r.topology.edges}/${r.topology.vertices}` : '-';
    L.push(`| ${r.id} | ${r.expect} | ${r.verdict} | ${t} | ${e1(r.volErr)} | ${e1(r.areaErr)} | ${r.occt ? JSON.stringify(r.occt.interference ?? {}) : '-'} | ${r.computeMs ?? '-'} | ${(r.reason ?? r.error ?? '').slice(0, 140)} |`);
  }
  const counts = {};
  for (const r of rows) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
  fs.writeFileSync(path.join(DIR, 'report.json'), JSON.stringify({ schema: 'wonky-recover-adversarial/1', capturedAt: new Date().toISOString(), target: native ? 'cpu1' : 'js', counts, rows }, null, 1) + '\n');
  fs.writeFileSync(path.join(DIR, 'report.md'), L.join('\n') + `\n\nverdicts: ${JSON.stringify(counts)}\n`);
  console.log(L.join('\n'));
  console.log('\nverdicts:', JSON.stringify(counts));
  if (rows.some((r) => BAD.test(r.verdict) || r.verdict === 'CRASH')) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((err) => { console.error(err.stack ?? err.message); process.exit(1); });
}
