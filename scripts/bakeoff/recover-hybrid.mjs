#!/usr/bin/env node
// Boolean bake-off TEST INFRASTRUCTURE: the hybrid pipeline end to end. The
// tagged result meshes of a mesh-Boolean prototype (out/bakeoff/<proto>/results,
// written by scripts/bakeoff/run.mjs; only read here) are fed to the "recover"
// prototype, and the recovered B-reps are graded exactly like the corpus
// (scripts/bakeoff/recover-check.mjs: kernel validation, STEP, OpenCascade
// BRepCheck + self-interference, volume and area against the OCCT CSG). It
// computes no geometry.
//
//   node scripts/bakeoff/recover-hybrid.mjs --source corefine|exact-plane [--cases a,b] [--native] [--no-occt]
//
// Output: out/bakeoff/recover/hybrid/<source>/report.{json,md}.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadKernel } from '../../src/kernel.mjs';
import { loadBend } from '../../src/bend-loader.mjs';
import { ROOT, ensureJobs, loadCases } from './fixtures.mjs';
import { exportRecovered, gradeRows, checkVerdict } from './recover-check.mjs';

async function main(argv) {
  const arg = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const source = arg('--source') ?? 'corefine';
  const only = arg('--cases')?.split(',');
  const native = argv.includes('--native');
  const out = path.join(ROOT, 'out/bakeoff/recover/hybrid', source);
  fs.mkdirSync(path.join(out, 'inputs'), { recursive: true });
  fs.mkdirSync(path.join(out, 'results'), { recursive: true });
  const cases = loadCases().filter((c) => !only || only.includes(c.id));
  const jobs = ensureJobs(cases.map((c) => c.id));
  const reference = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/bakeoff/reference.json'), 'utf8'));
  const mod = native ? null : await loadBend(path.join(ROOT, 'kernel/proto/recover/main.bend'));
  const kernel = await loadKernel();
  const rows = [];
  for (const c of cases) {
    const row = { id: c.id, expect: c.expect ?? 'solid' };
    const src = ['cpu1', 'cpuN', 'js', 'metal'].map((t) => path.join(ROOT, 'out/bakeoff', source, 'results', `${c.id}.${t}.result`)).find((p) => fs.existsSync(p));
    const srcText = src ? fs.readFileSync(src, 'utf8') : null;
    if (!srcText || !srcText.startsWith('ok')) {
      row.status = 'no-source';
      row.reason = srcText ? `${source}: ${srcText.split('\n')[0].slice(0, 120)}` : `${source}: no result`;
      rows.push(row);
      continue;
    }
    row.source = path.relative(ROOT, src);
    const input = path.join(out, 'inputs', `${c.id}.recover.job`);
    fs.writeFileSync(input, fs.readFileSync(jobs[c.id].job, 'utf8') + srcText);
    const res = path.join(out, 'results', `${c.id}.${native ? 'cpu1' : 'js'}.result`);
    let text;
    if (native) {
      const r = spawnSync(path.join(ROOT, 'out/bakeoff/recover/build/cpu'), ['--threads', '1', '--gpu', 'off', '--', input, res], { encoding: 'utf8', env: { ...process.env, BEND_NO_TELEMETRY: '1' }, timeout: 600000 });
      if (r.status !== 0) { row.status = 'crash'; row.reason = r.stderr.slice(-200); rows.push(row); continue; }
      row.computeMs = JSON.parse(r.stdout.trim().split('\n').pop()).computeMs;
      text = fs.readFileSync(res, 'utf8');
    } else {
      const t0 = performance.now();
      text = mod.run(fs.readFileSync(input, 'utf8'));
      row.computeMs = +(performance.now() - t0).toFixed(1);
      fs.writeFileSync(res, text);
    }
    try {
      Object.assign(row, await exportRecovered(text, c.id, path.join(out, 'step', c.id), kernel));
    } catch (err) {
      row.status = 'invalid';
      row.error = err.message;
    }
    rows.push(row);
  }
  const exported = rows.filter((r) => r.status === 'ok' && !r.empty);
  if (!argv.includes('--no-occt')) await gradeRows(exported, reference, out);
  for (const r of rows) r.verdict = r.status === 'no-source' || r.status === 'crash' ? r.status : checkVerdict(r);
  const e1 = (x) => (x === undefined || x === null ? '-' : x.toExponential(1));
  const L = [`| case | verdict | F/E/V | slivers | OCCT volume rel err vs exact CSG | area rel err | compute ms | reason |`, '|---|---|---|---|---|---|---|---|'];
  for (const r of rows) {
    const t = r.topology ? `${r.topology.faces}/${r.topology.edges}/${r.topology.vertices}` : '-';
    L.push(`| ${r.id} | ${r.verdict} | ${t} | ${r.stats?.slivers ?? '-'} | ${e1(r.exact?.volumeRelErrVsOcctCsg)} | ${e1(r.exact?.areaRelErrVsOcctCsg)} | ${r.computeMs ?? '-'} | ${(r.reason ?? r.error ?? '').slice(0, 120)} |`);
  }
  const counts = {};
  for (const r of rows) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ schema: 'wonky-recover-hybrid/1', capturedAt: new Date().toISOString(), source, target: native ? 'cpu1' : 'js', counts, rows }, null, 1) + '\n');
  fs.writeFileSync(path.join(out, 'report.md'), `${L.join('\n')}\n\nverdicts: ${JSON.stringify(counts)}\n`);
  console.log(L.join('\n'));
  console.log('\nverdicts:', JSON.stringify(counts));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((err) => { console.error(err.stack ?? err.message); process.exit(1); });
}
