// TEST INFRASTRUCTURE: build the sdf FDM driver for CPU and Metal, run the
// FDM demos on cpu1 / cpu18 / metal, validate the meshes (offset/shell against
// the job with shifted carriers) and print the table for docs/proto-sdf.md.
//   node kernel/proto/sdf/tools/fdm-demo.mjs [--no-build] [--repeat 3]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { decodeJob, encodeJob } from '../../../../scripts/bakeoff/jobfmt.mjs';
import { validateResult } from '../../../../scripts/bakeoff/validate.mjs';

const ROOT = new URL('../../../../', import.meta.url).pathname.replace(/\/$/, '');
const BEND = `${ROOT}/.tools/bend-2.0.25/bin/bend`;
const OUT = `${ROOT}/tmp/sdf/fdm`;
fs.mkdirSync(OUT, { recursive: true });
const args = process.argv.slice(2);
const repeat = Number(args[args.indexOf('--repeat') + 1] || 3) || 3;
const env = { ...process.env, BEND_NO_TELEMETRY: '1' };
const sh = (exe, a, o = {}) => {
  const r = spawnSync(exe, a, { env, encoding: 'utf8', maxBuffer: 1 << 28, ...o });
  if (r.status !== 0) throw new Error(`${exe} ${a.join(' ')}\n${r.stdout}\n${r.stderr}`);
  return r;
};

if (!args.includes('--no-build')) {
  sh(BEND, [`${ROOT}/kernel/proto/sdf/fdm-native.bend`, '-o', `${OUT}/cpu`]);
  sh(BEND, [`${ROOT}/kernel/proto/sdf/fdm-native.bend`, '-o', `${OUT}/metal.c`]);
  let c = fs.readFileSync(`${OUT}/metal.c`, 'utf8');
  const PASS = 'static void gpu_pass(u32 f) {\n  @autoreleasepool {';
  const DONE = '  io_sync();\n  return code;';
  if (!c.includes(PASS) || !c.includes(DONE)) throw new Error('Metal anchors changed');
  c = c.replace(PASS, 'static unsigned long wonky_metal_passes = 0;\nstatic void gpu_pass(u32 f) {\n  wonky_metal_passes++;\n  @autoreleasepool {')
    .replace(DONE, '  io_sync();\n  fprintf(stderr, "wonky_metal_passes=%lu\\n", wonky_metal_passes);\n  return code;');
  fs.writeFileSync(`${OUT}/metal.c`, c);
  sh('clang', ['-DBEND_METAL=1', '-x', 'objective-c', '-fobjc-arc', '-fmodules', '-std=c11', '-O3', `${OUT}/metal.c`, '-lpthread', '-lm', '-o', `${OUT}/metal`]);
  sh(`${OUT}/metal`, ['--gpu-build']);
}

const oracle = JSON.parse(fs.readFileSync(`${ROOT}/tmp/sdf/fdm-oracle.json`, 'utf8'));
const jobPath = (id) => [`${ROOT}/fixtures/bakeoff/jobs/${id}.csg.job`, `${ROOT}/out/bakeoff/jobs/${id}.csg.job`].find((p) => fs.existsSync(p));
const fullPath = (id) => [`${ROOT}/fixtures/bakeoff/jobs/${id}.job`, `${ROOT}/out/bakeoff/jobs/${id}.job`].find((p) => fs.existsSync(p));

// Analytic references where OCCT has none (hand-derived from cases.json).
const DEMOS = [
  { op: 'offset', id: 'plate-through-hole', um: 300, note: 'hole r 3.2 -> 2.9, plate 40.6 x 30.6 x 5.6' },
  { op: 'offset', id: 'enclosure-shell', um: -200, note: 'print clearance: every face 0.2 mm inward' },
  { op: 'shell', id: 'box-union-overlap', um: 2000, note: 'closed hollow body, 2 mm walls', exact: 5264 },
  { op: 'shell', id: 'leaf-cylinder', um: 1000, note: 'closed hollow cylinder, 1 mm walls' },
  { op: 'interference', id: 'box-union-overlap', um: 0, note: 'overlap of the two blocks' },
  { op: 'interference', id: 'steinmetz-union', um: 0, note: 'overlap of the two pipes (Steinmetz solid, 2000/3 exactly)' },
  { op: 'thickness', id: 'plate-blind-pocket', um: 2500, note: 'pocket floor 2 mm (exact)', expectMm: 2 },
  { op: 'thickness', id: 'enclosure-shell', um: 1500, note: 'blind vent leaves a 1 mm membrane in the 2 mm wall', expectMm: 1 },
  { op: 'thickness', id: 'pipe-tee', um: 1200, note: 'pipe walls 1 mm (6-5 and 4-3)', expectMm: 1 },
];

function negMap(job) {
  const neg = new Map();
  (function walk(n, s) {
    if (n.leaf !== undefined) { neg.set(n.leaf, s); return; }
    walk(n.a ?? n.children[0], s);
    walk(n.b ?? n.children[1], n.op === 'subtract' ? -s : s);
  })(job.tree, 1);
  return neg;
}
function shiftedFaces(job, d) {
  const neg = negMap(job);
  const move = (s, e) => {
    if (s.type === 'plane') return { ...s, o: s.o.map((x, i) => x + e * s.n[i]) };
    if (['cylinder', 'sphere', 'torus'].includes(s.type)) return { ...s, r: s.r + e };
    if (s.type === 'cone') return { ...s, r: s.r + e / Math.cos(s.a) };
    throw new Error(s.type);
  };
  return job.faces.map((f) => ({ ...f, surface: move(f.surface, d * neg.get(f.leaf)) }));
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const rows = [];
for (const d of DEMOS) {
  const job = jobPath(d.id);
  const times = {};
  let text = null;
  const texts = {};
  for (const [t, bin, a] of [['cpu1', 'cpu', ['--threads', '1', '--gpu', 'off']], ['cpu18', 'cpu', ['--threads', '18', '--gpu', 'off']], ['metal', 'metal', ['--threads', '18', '--gpu', '4GB']]]) {
    const samples = [];
    let passes = null;
    for (let k = 0; k < repeat; k++) {
      const out = `${OUT}/${d.op}-${d.id}.${t}.out`;
      const r = sh(`${OUT}/${bin}`, [...a, '--', d.op, String(d.um), job, out]);
      samples.push(JSON.parse(r.stdout.trim().split('\n').pop()));
      const m = /wonky_metal_passes=(\d+)/.exec(r.stderr);
      if (m) passes = Number(m[1]);
      texts[t] = fs.readFileSync(out, 'utf8');
    }
    const keys = Object.keys(samples[0]);
    times[t] = Object.fromEntries(keys.map((k) => [k, median(samples.map((s) => s[k]))]));
    if (passes !== null) times[t].passes = passes;
    text ??= texts[t];
  }
  const agree = texts.cpu1 === texts.cpu18 && texts.cpu1 === texts.metal;
  const line = text.split('\n', 1)[0];
  const row = { ...d, line, agree, times };
  if (d.op !== 'thickness' && !line.endsWith('unresolved')) {
    const j = decodeJob(fs.readFileSync(fullPath(d.id), 'utf8'));
    const faces = d.op === 'offset' ? shiftedFaces(j, d.um / 1000) : d.op === 'shell' ? [...j.faces, ...shiftedFaces(j, -d.um / 1000)] : j.faces;
    const { report } = validateResult(encodeJob({ ...j, faces }), text.slice(text.indexOf('\n') + 1));
    row.valid = report.valid; row.volume = report.volume; row.tris = report.triangles; row.components = report.components; row.genus = report.genus;
    row.maxDist = report.tags.maxDistanceMm; row.issues = report.issues?.slice(0, 2);
    row.stats = /^sdf (.*)$/m.exec(text)?.[1];
    const o = oracle[`${d.op}:${d.id}`];
    row.occt = o?.occtVolume || null;
  }
  rows.push(row);
  console.error(JSON.stringify({ ...row, stats: undefined }));
}
fs.writeFileSync(`${OUT}/fdm-demo.json`, JSON.stringify(rows, null, 1));

const f = (x, n = 3) => (x === null || x === undefined ? '–' : Number(x).toFixed(n));
const tcell = (t) => (t.computeMs !== undefined ? `${t.computeMs}` : `${t.prepMs} + ${t.traceMs}`);
console.log('| operation | case | parameter | result (sdf) | reference | mesh check | cpu1 ms | cpu18 ms | metal ms (passes) |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  let res; let ref; let chk;
  if (r.op === 'thickness') {
    const m = / min_um (\d+) .* thin_tris (\d+) thin_area_mm2 ([\d.]+) rays (\d+) grazing_rejected (\d+)/.exec(r.line);
    res = m ? `min ${f(Number(m[1]) / 1000)} mm; ${m[2]} of ${m[4]} triangles (${m[3]} mm²) thinner than ${r.um / 1000} mm; ${m[5]} grazing rays rejected` : r.line;
    ref = `${r.expectMm} mm (${r.note})`;
    chk = '–';
  } else {
    const v = Number(/vol_mm3 (-?[\d.]+)/.exec(r.line)?.[1]);
    res = `${f(v)} mm³`;
    const refV = r.exact ?? r.occt;
    ref = refV ? `${f(refV)} mm³ ${r.exact ? '(exact, by hand)' : '(OCCT)'}` : '–';
    chk = `${r.valid ? 'valid' : 'INVALID'}, ${r.tris} tris, ${r.components} comp., genus ${r.genus}, max corner dist ${f(r.maxDist * 1000, 2)} µm`;
  }
  const par = r.op === 'interference' ? '–' : `${r.um / 1000} mm`;
  console.log(`| ${r.op} | ${r.id} | ${par} | ${res} | ${ref} | ${chk} | ${tcell(r.times.cpu1)} | ${tcell(r.times.cpu18)} | ${tcell(r.times.metal)} (${r.times.metal.passes ?? '?'})${r.agree ? '' : ' DISAGREE'} |`);
}
