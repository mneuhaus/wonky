#!/usr/bin/env node
// Fillet harness TEST INFRASTRUCTURE (docs/fillet-plan.md §8 step 1): A's
// built results through the production modules downstream of a fillet, on
// the production types (kernel/fillet/production.bend via src/fillet.mjs),
// against the result's own exact volume (divvolume.mjs, independent of the
// kernel and of STEP). It computes no blend geometry; the probe points of the
// classification check are test geometry.
//
//   node scripts/fillet/production-measures.mjs <resultsDir>... [--cases a,b]
//     [--deviation 0.01] [--classify all|curved|none] [--timeout 180] [--jobs 4] [--out report.json]
//
// Each result runs in its own process with a timeout (production volume
// integration of far sphere faces can take very long); a timeout is reported
// by name for the measure that did not finish.
//
// Per built result (<dir>/<case>.cpu1.result):
//   volume    src/volume.mjs integrateVolume (kernel/volume.bend): value,
//             stated bound and label, error against the divergence volume;
//   mesh      src/print-mesh.mjs printMesh at --deviation: the mesh volume
//             against the divergence volume within area x achieved deviation
//             (+ 1e-11 x V for rounding);
//   classify  src/solid-classification.mjs classifySolid at two probes per
//             blend/corner face (the middle of a boundary edge moved 1e-3 mm
//             along the face's outward normal, in and out): Inside / Outside
//             as expected, or the classifier's named refusal.
// Refusals are reported by name, never counted as agreement.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBend } from '../../src/bend-loader.mjs';
import { filletResultBody, loadFilletProduction, loadFilletValidation } from '../../src/fillet.mjs';
import { integrateVolume } from '../../src/volume.mjs';
import { printMesh } from '../../src/print-mesh.mjs';
import { classifySolid } from '../../src/solid-classification.mjs';
import { decodeResult } from './brepfmt.mjs';
import { divVolume } from './divvolume.mjs';
import { add, edgeSamples, faceNormal, scale } from './geom.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const det3 = (a, b, c) => a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
const triArea = ([a, b, c]) => {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
};

async function probe(body, harness, id) {
  const out = [];
  for (const [fi, face] of harness.faces.entries()) {
    if (face.role !== 'blend' && face.role !== 'corner') continue;
    const use = face.loops[0][0], edge = harness.edges[use.edge];
    const samples = edgeSamples(edge, harness.vertices, 4);
    const p = samples[2].p, n = faceNormal(face, p);
    for (const [where, sign] of [['Inside', -1], ['Outside', 1]]) {
      const q = add(p, scale(n, sign * 1e-3));
      let answer;
      try { answer = await classifySolid(body, q); } catch (err) { answer = { $: 'Error', reason: { $: err.message.slice(0, 120) } }; }
      const got = answer.$ === 'Classified' || answer.state ? (answer.state?.$ ?? answer.state) : answer.$ === 'Unresolved' || answer.$ === 'Error' ? `${answer.$} ${answer.reason?.$ ?? ''}` : answer.$;
      out.push({ face: fi, surface: face.surface.type, expected: where, got: typeof got === 'string' ? got : JSON.stringify(answer).slice(0, 160), ok: got === where });
    }
  }
  return out;
}

// One result, in its own process (main runs one per result with a timeout):
// prints one JSON line per finished measure, so a timeout still names the
// measures that finished and the one that did not.
async function one(file, deviation, classify) {
  const emit = (stage, value) => console.log(JSON.stringify({ stage, value }));
  const id = path.basename(file).replace('.cpu1.result', ''), text = fs.readFileSync(file, 'utf8');
  const harness = decodeResult(text);
  if (harness.status !== 'ok') return;
  const native = await loadFilletProduction(), validation = await loadFilletValidation();
  const kernel = { ...validation, volume: await loadBend(new URL('../../kernel/volume.bend', import.meta.url)), tessellate: await loadBend(new URL('../../kernel/tessellate.bend', import.meta.url)) };
  const { body } = filletResultBody(native, text, id, kernel);
  const V = divVolume(harness.body).volume, scaleV = Math.max(Math.abs(V ?? 1), 1);
  emit('head', { id, dir: path.relative(ROOT, path.dirname(file)), faces: body.faces.length, types: [...new Set(body.faces.map((x) => x.surface.type))].sort(), divVolume: V ?? null,
    spindle: body.faces.some((x) => x.surface.type === 'torus' && x.surface.minor >= x.surface.major) });
  try {
    const v = integrateVolume(kernel, body);
    emit('volume', { ok: Number.isFinite(V) && Math.abs(v.volumeMm3 - V) <= 1e-12 * scaleV, volumeMm3: v.volumeMm3, relErr: Number.isFinite(V) ? Math.abs(v.volumeMm3 - V) / scaleV : null, boundMm3: v.boundMm3, label: v.label });
  } catch (err) { emit('volume', { ok: false, refused: err.message.slice(0, 200) }); }
  try {
    const m = printMesh(kernel, body, deviation);
    const mv = m.triangles.reduce((s, tri) => s + det3(...tri), 0) / 6, area = m.triangles.reduce((s, tri) => s + triArea(tri), 0);
    // area x deviation, plus 1e-11 x V for the rounding of the triangle sum
    const allowed = area * m.achievedDeviationMm + 1e-11 * scaleV;
    emit('mesh', { ok: Number.isFinite(V) && Math.abs(mv - V) <= allowed, triangles: m.triangles.length, volumeMm3: mv, absErr: Number.isFinite(V) ? Math.abs(mv - V) : null, allowedMm3: allowed, achievedDeviationMm: m.achievedDeviationMm });
  } catch (err) { emit('mesh', { ok: false, refused: err.message.slice(0, 200) }); }
  if (classify === 'all' || (classify === 'curved' && body.faces.some((x) => ['sphere', 'torus', 'cone'].includes(x.surface.type)))) {
    const probes = await probe(body, harness.body, id);
    emit('classify', { ok: probes.length > 0 && probes.every((p) => p.ok), probes: probes.length, wrong: probes.filter((p) => !p.ok && ['Inside', 'Outside', 'Boundary'].includes(p.got)).length, first: probes.find((p) => !p.ok) ?? null });
  }
}

function child(file, args, timeoutMs) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [fileURLToPath(import.meta.url), '--one', file, ...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', timedOut = false;
    c.stdout.on('data', (b) => { out += b; });
    c.stderr.on('data', (b) => { err += b; });
    const timer = setTimeout(() => { timedOut = true; c.kill('SIGKILL'); }, timeoutMs);
    c.on('close', (code) => { clearTimeout(timer); resolve({ code, timedOut, out, err }); });
  });
}

async function main(argv) {
  const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const deviation = Number(opt('--deviation', 0.01)), classify = opt('--classify', 'curved');
  if (argv.includes('--one')) return one(opt('--one'), deviation, classify);
  const dirs = argv.filter((a, i) => !a.startsWith('--') && !['--cases', '--deviation', '--classify', '--out', '--timeout', '--jobs'].includes(argv[i - 1]));
  const only = opt('--cases') ? opt('--cases').split(',') : null;
  const timeoutMs = Number(opt('--timeout', 180)) * 1000, jobs = Number(opt('--jobs', 4));
  const files = dirs.flatMap((dir) => fs.readdirSync(dir).filter((x) => x.endsWith('.cpu1.result')).sort().map((x) => path.join(dir, x)))
    .filter((file) => (!only || only.includes(path.basename(file).replace('.cpu1.result', ''))) && decodeResult(fs.readFileSync(file, 'utf8')).status === 'ok');
  const rows = new Array(files.length);
  const s = (x) => (!x ? '-' : x.ok ? 'ok' : x.timeout ? 'TIMEOUT' : x.refused ? `REFUSED ${x.refused.slice(0, 70)}` : x.first ? `no (${x.first.got})` : `no ${x.relErr?.toExponential?.(1) ?? x.absErr?.toExponential?.(1) ?? ''}`);
  const run = async (i) => {
    const r = await child(files[i], ['--deviation', String(deviation), '--classify', classify], timeoutMs);
    const row = { id: path.basename(files[i]).replace('.cpu1.result', '') };
    for (const line of r.out.split('\n').filter((l) => l.startsWith('{'))) {
      const { stage, value } = JSON.parse(line);
      if (stage === 'head') Object.assign(row, value); else row[stage] = value;
    }
    if (r.timedOut) { row.timeoutS = timeoutMs / 1000; for (const k of ['volume', 'mesh']) if (!row[k]) { row[k] = { ok: false, timeout: true }; break; } }
    else if (r.code !== 0) row.error = r.err.trim().split('\n').pop()?.slice(0, 200);
    rows[i] = row;
    console.log(`${row.id.padEnd(48)} ${row.spindle ? 'spindle ' : ''}vol ${s(row.volume)} | mesh ${s(row.mesh)} | classify ${s(row.classify)}${row.error ? ` | ERROR ${row.error}` : ''}`);
  };
  for (let i = 0; i < files.length; i += jobs) await Promise.all(files.slice(i, i + jobs).map((_, k) => run(i + k)));
  const count = (k) => ({ ok: rows.filter((r) => r[k]?.ok).length, refused: rows.filter((r) => r[k]?.refused).length, timeout: rows.filter((r) => r[k]?.timeout).length, of: rows.filter((r) => r[k]).length });
  const summary = { results: rows.length, volume: count('volume'), mesh: count('mesh'), classify: count('classify'), errors: rows.filter((r) => r.error).length, deviationMm: deviation, timeoutS: timeoutMs / 1000 };
  console.log(JSON.stringify(summary));
  const out = opt('--out');
  if (out) fs.writeFileSync(out, JSON.stringify({ schema: 'wonky-fillet-production-measures/1', capturedAt: new Date().toISOString(), summary, rows }, null, 1) + '\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((err) => { console.error(err.stack ?? err.message); process.exit(1); });
}
