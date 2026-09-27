#!/usr/bin/env node
// Diagnostics of the exact-plane prototype (reporting tool, not kernel code):
// builds kernel/proto/exact-plane/stats.bend natively, runs it on the bake-off
// jobs and writes out/bakeoff/exact-plane/stats.json plus a markdown table
// (filter hit rate, exact fallbacks, integer widths, quantization error,
// export level, phase times).
//
//   node kernel/proto/exact-plane/tools/stats.mjs [--cases a,b] [--threads N]
//
// All geometry is computed by the Bend program; this script only runs it and
// decodes the F32 bit patterns it prints.

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ensureJobs, loadCases, ROOT } from '../../../../scripts/bakeoff/fixtures.mjs';

const BEND = path.join(ROOT, '.tools/bend-2.0.25/bin/bend');
const SRC = path.join(ROOT, 'kernel/proto/exact-plane');
const OUT = path.join(ROOT, 'out/bakeoff/exact-plane');

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const only = arg('--cases')?.split(',').filter(Boolean);
const threads = arg('--threads') ?? '18';

function sourceKey() {
  const h = crypto.createHash('sha256');
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.bend')) h.update(path.relative(ROOT, p)).update(fs.readFileSync(p));
    }
  };
  walk(path.join(ROOT, 'kernel'));
  return h.digest('hex');
}

function build() {
  const dir = path.join(OUT, 'build');
  fs.mkdirSync(dir, { recursive: true });
  const bin = path.join(dir, 'stats');
  const key = sourceKey();
  if (fs.existsSync(bin) && fs.existsSync(`${bin}.key`) && fs.readFileSync(`${bin}.key`, 'utf8') === key) return bin;
  const r = spawnSync(BEND, [path.join(SRC, 'stats.bend'), '-o', bin], { encoding: 'utf8', env: { ...process.env, BEND_NO_TELEMETRY: '1' } });
  if (r.status !== 0) throw new Error(`stats build failed:\n${r.stdout}\n${r.stderr}`);
  fs.writeFileSync(`${bin}.key`, key);
  return bin;
}

const f32 = (bits) => new Float32Array(new Uint32Array([bits]).buffer)[0];

const bin = build();
const cases = loadCases().filter((c) => !only || only.includes(c.id));
const jobs = ensureJobs(cases.map((c) => c.id));
const rows = [];
for (const c of cases) {
  const r = spawnSync(bin, ['--threads', threads, '--gpu', 'off', '--', jobs[c.id].job], { encoding: 'utf8', env: { ...process.env, BEND_NO_TELEMETRY: '1' }, maxBuffer: 1 << 24 });
  const line = r.stdout.split('\n').find((l) => l.startsWith('{'));
  if (r.status !== 0 || !line) {
    rows.push({ case: c.id, error: (r.stderr || r.stdout).slice(-500) });
    continue;
  }
  const s = JSON.parse(line);
  s.quantErrMm = f32(s.quantErrBits);
  delete s.quantErrBits;
  s.export.roundingMaxMm = f32(s.export.exportRoundingMaxBits);
  delete s.export.exportRoundingMaxBits;
  const all = ['arrangement', 'freeRays'].map((k) => s[k]).concat([s.assembly.predicates]);
  const symbolic = all.reduce((t, x) => t + x.symbolicZero, 0);
  const sum = (k) => all.reduce((t, x) => t + x[k], 0);
  const decided = sum('filtered') + sum('exactNonzero') + sum('exactZero') + all.reduce((t, x) => t + x.symbolicZero, 0);
  s.predicates = {
    total: decided,
    filterHitRate: decided ? sum('filtered') / decided : 1,
    // Among the evaluations that needed arithmetic (symbolic zeros excluded).
    filterHitRateArith: decided - symbolic ? sum('filtered') / (decided - symbolic) : 1,
    exactNonzero: sum('exactNonzero'),
    exactZero: sum('exactZero'),
    symbolicZero: symbolic,
    constructed: sum('constructed'),
  };
  rows.push(s);
  process.stderr.write(`${c.id.padEnd(28)} ${s.export.ok ? 'ok' : 'refused'}\n`);
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'stats.json'), JSON.stringify({ schema: 'exact-plane-stats/1', threads: Number(threads), capturedAt: new Date().toISOString(), cases: rows }, null, 1) + '\n');

const pct = (x) => `${(100 * x).toFixed(3)}%`;
const lines = [
  '| case | input tris | device pairs / disjoint | pieces | free tris / comps | predicates | filter hit (all / arithmetic) | exact != 0 | exact = 0 | symbolic = 0 | built vertices | max bits X / W / n / d | T-junctions | export | quant err mm | export rounding mm |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
];
for (const s of rows) {
  if (s.error) {
    lines.push(`| ${s.case} | error | | | | | | | | | | | | | | |`);
    continue;
  }
  const w = s.widthsBits;
  const e = s.export;
  lines.push(`| ${s.case} | ${s.inputTris} | ${s.devicePairs} / ${s.deviceDisjoint} | ${s.pieces} | ${s.freeTris} / ${s.freeGroups} | ${s.predicates.total} | ${pct(s.predicates.filterHitRate)} / ${pct(s.predicates.filterHitRateArith)} | ${s.predicates.exactNonzero} | ${s.predicates.exactZero} | ${s.predicates.symbolicZero} | ${s.predicates.constructed} | ${w.vertexXYZ} / ${w.vertexW} / ${w.planeNormal} / ${w.planeOffset} | ${s.assembly.tjunctions} | ${e.ok ? 'ok' : 'refused'} | ${s.quantErrMm.toExponential(2)} | ${e.roundingMaxMm.toExponential(2)} |`);
}
fs.writeFileSync(path.join(OUT, 'stats.md'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
