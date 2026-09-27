// Corpus failure analysis, cluster boolean-capability: run the failing
// opBoolean of every repro in fixtures/corpus-repro/boolean-capability/
// through the bake-off's all-Bend hybrid route (docs/bakeoff.md,
// docs/proto-corefine.md, docs/proto-recover.md), without touching the
// bake-off's own cases, fixtures or outputs:
//
//   1. production probe (scripts/corpus/boolean-probe.mjs --dump) freezes the
//      exact operands of the refused opBoolean as wonky-acceptance-operands/1;
//   2. the bake-off fixture code (scripts/bakeoff/fixtures.mjs buildCase with
//      `brep` leaves, or analytic CSG leaves where brep-tessellate refuses a
//      surface, e.g. cones) writes a job to tmp/corpus/boolean-capability/bakeoff/;
//   3. the corefine prototype (native cpu build, 1 thread) computes the tagged
//      mesh Boolean in Bend; scripts/bakeoff/validate.mjs checks it;
//   4. the recover prototype (native cpu build) turns job + mesh into an exact
//      B-rep in Bend; scripts/bakeoff/recover-check.mjs exportRecovered runs
//      the kernel validator and writes STEP with src/exporters.mjs;
//   5. OpenCascade (uv run scripts/bakeoff/recover-step.py) is the oracle for
//      validity, volume and area; the expected volume is closed form.
//
// Prototype binaries are used as built by the bake-off runner
// (out/bakeoff/<proto>/build/cpu); this script never builds or edits them.
// Usage: node scripts/corpus/boolean-bakeoff.mjs [--only id,...] [--skip-probe]
// Output: out/corpus/boolean-capability/bakeoff.json
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { buildCase } from '../bakeoff/fixtures.mjs';
import { tessellateBrep } from '../bakeoff/brep-tessellate.mjs';
import { resolveTransform, surfaceDistance, signedVolume } from '../bakeoff/tessellate.mjs';
import { encodeJob, decodeResult } from '../bakeoff/jobfmt.mjs';
import { validateResult } from '../bakeoff/validate.mjs';
import { exportRecovered, occtCheck } from '../bakeoff/recover-check.mjs';
import { loadKernel } from '../../src/kernel.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPRO = 'fixtures/corpus-repro/boolean-capability';
const WORK = path.join(ROOT, 'tmp/corpus/boolean-capability/bakeoff');
const OPERANDS = path.join(ROOT, 'tmp/corpus/boolean-capability/operands');
const argv = process.argv.slice(2);
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1].split(',') : null;
const skipProbe = argv.includes('--skip-probe');

const PI = Math.PI;
// Area of {x in [x0,x1], y in [y0,y1]} inside the disk of radius r about the
// origin, in closed form (0 <= x0): split [x0, x1] where the chord half-height
// h(x) = sqrt(r^2 - x^2) crosses |y0|, |y1| or 0, then integrate each piece
// with the antiderivative of h. For the closed-form volumes of the trim and
// notch repros.
function rectDisk(x0, x1, y0, y1, r) {
  const H = x => (x * Math.sqrt(Math.max(0, r * r - x * x)) + r * r * Math.asin(Math.min(1, x / r))) / 2;
  const h = x => Math.sqrt(Math.max(0, r * r - x * x));
  const cuts = [x0, x1, ...[y0, y1].filter(y => Math.abs(y) < r).map(y => Math.sqrt(r * r - y * y)), r]
    .filter(x => x >= x0 && x <= x1).sort((a, b) => a - b);
  let area = 0;
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = cuts[i], b = Math.min(cuts[i + 1], r), m = (a + b) / 2;
    if (!(b > a) || m >= r) continue;
    const top = h(m) < y1, bottom = -h(m) > y0;
    if (Math.min(y1, h(m)) - Math.max(y0, -h(m)) <= 0) continue;
    const I = H(b) - H(a), L = b - a;
    area += (top ? I : y1 * L) - (bottom ? -I : y0 * L);
  }
  return area;
}
const hexArea = af => 3 * Math.sqrt(3) / 2 * (af / Math.sqrt(3)) ** 2;
const coneVol = (r0, r1, h) => PI * h / 3 * (r0 * r0 + r0 * r1 + r1 * r1);
const tri = ([a, b, c]) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;

// Area of the disk (radius rb, centre at distance d from the origin) outside
// the disk of radius ri about the origin (circle-circle lens complement).
function lensArea(rb, d, ri) {
  const a1 = Math.acos((d * d + rb * rb - ri * ri) / (2 * d * rb)), a2 = Math.acos((d * d + ri * ri - rb * rb) / (2 * d * ri));
  const inside = rb * rb * a1 + ri * ri * a2 - 0.5 * Math.sqrt((-d + rb + ri) * (d + rb - ri) * (d - rb + ri) * (d + rb + ri));
  return PI * rb * rb - inside;
}
// Boss (r 5 at 116, z 52..60) and wall ring (118.5..122, z 21.4..58) overlap
// where the boss lies outside r = 118.5 (the boss never reaches r = 122), for z 52..58.
const ringBossOverlap = () => lensArea(5, 116, 118.5) * 6;
const T = (translate = [0, 0, 0]) => ({ rotate: [], translate });
const REPROS = [
  { id: 'ring-union', file: 'coaxial-revolution.fs', feature: 'ringUnion', op: 'union',
    expected: PI * (122 ** 2 - 76 ** 2) * 6 + PI * (122 ** 2 - 118.5 ** 2) * (32.6 - 0.1) },
  { id: 'countersunk-head', file: 'coaxial-revolution.fs', feature: 'countersunkHead', op: 'union',
    // brep-tessellate has no cone faces: the same two primitives as analytic CSG leaves.
    csg: { op: 'union', children: [
      { prim: 'cylinder', params: { radius: 2, height: 17.57 }, transform: T([0, 0, -20]) },
      { prim: 'cone', params: { r1: 2, r2: 4.48, height: 2.48 }, transform: T([0, 0, -2.48]) }] },
    expected: PI * 4 * 17.57 + coneVol(2, 4.48, 2.48) - PI * 4 * 0.05 },
  { id: 'oblique-hole', file: 'through-hole-admission.fs', feature: 'obliqueHole', op: 'subtract',
    expected: tri([[0, 0], [198.0000000000001, 7.105427357601002e-15], [494.3470366716323, -267.8865669526646]]) * 3.2 - PI * 1.7 ** 2 * 3.2,
    // As built: the plate's F32 carriers. Plate volume from the kernel, minus
    // the tool cylinder between the two cap planes (exact for planar caps:
    // pi r^2 times the axial distance between them on the axis).
    asBuilt: ([plate, tool]) => {
      const t = tool.primitive, a = unitv(t.top.map((v, i) => v - t.bottom[i]));
      const hits = plate.faces.filter(f => f.surface.type === 'plane' && Math.abs(dotv(f.surface.normal, a)) > 0.99)
        .map(f => dotv(f.surface.origin.map((v, i) => v - t.bottom[i]), f.surface.normal) / dotv(a, f.surface.normal));
      return plate.validation.volumeMm3 - PI * t.r0 ** 2 * Math.abs(hits[1] - hits[0]);
    } },
  { id: 'stepped-hole', file: 'through-hole-admission.fs', feature: 'steppedHole', op: 'subtract',
    expected: (60 * 10 + 20 * 20) * 16 - PI * 1.7 ** 2 * 10 },
  { id: 'arc-plate-hole', file: 'through-hole-admission.fs', feature: 'arcPlateHole', op: 'subtract',
    expected: (40 * 24 - (4 - PI) * 16) * 4 - PI * 1.7 ** 2 * 4 },
  { id: 'united-plate-hole', file: 'through-hole-admission.fs', feature: 'unitedPlateHole', op: 'subtract',
    expected: (40 * 20 + 20 * 10) * 3 - PI * 1.7 ** 2 * 3 },
  { id: 'socket-hex', file: 'general-trimmed-face.fs', feature: 'socketHex', op: 'subtract',
    // The coaxial union splits the head cylinder at z = 0.05 into two faces that
    // share a circle, which brep-tessellate refuses: the same model as CSG.
    csg: { op: 'subtract', children: [
      { op: 'union', children: [
        { prim: 'cylinder', params: { radius: 1.5, height: 8.05 }, transform: T([0, 0, -8]) },
        { prim: 'cylinder', params: { radius: 2.75, height: 3 }, transform: T([0, 0, 0]) }] },
      { prim: 'prism', params: { points: [0, 1, 2, 3, 4, 5].map(k => [2.5 / Math.sqrt(3) * Math.cos(k * PI / 3), 2.5 / Math.sqrt(3) * Math.sin(k * PI / 3)]), height: 2 }, transform: T([0, 0, 1.6]) }] },
    expected: PI * 1.5 ** 2 * 8.05 + PI * 2.75 ** 2 * 3 - PI * 1.5 ** 2 * 0.05 - hexArea(2.5) * 1.4 },
  { id: 'band-notch', file: 'general-trimmed-face.fs', feature: 'bandNotch', op: 'subtract',
    expected: (PI * (132.25 ** 2 - 126 ** 2) / 4 - (rectDisk(85, 100, 85, 100, 132.25) - rectDisk(85, 100, 85, 100, 126))) * 12 },
  { id: 'boss-union', file: 'general-trimmed-face.fs', feature: 'bossUnion', op: 'union',
    expected: (178 * 44.8 + PI * 22.4 ** 2 / 2) * 15.2 },
  { id: 'ring-boss', file: 'general-trimmed-face.fs', feature: 'ringBoss', op: 'union',
    // wall ring + boss minus their overlap (boss disk inside r = 118.5 removed from the overlap)
    expected: PI * (122 ** 2 - 118.5 ** 2) * 36.6 + PI * 25 * 8 - ringBossOverlap() },
  { id: 'spoke-trim', file: 'general-trimmed-face.fs', feature: 'spokeTrim', op: 'subtract',
    expected: (170.8 * 42 - rectDisk(117, 287.8, -21, 21, 122.2)) * 54,
    // As built: the planar kernel stores 287.8 as the F32 287.79998779296875.
    asBuilt: ([box]) => {
      const [x, y, z] = [0, 1, 2].map(i => [Math.min(...box.vertices.map(v => v[i])), Math.max(...box.vertices.map(v => v[i]))]);
      return ((x[1] - x[0]) * (y[1] - y[0]) - rectDisk(x[0], x[1], y[0], y[1], 122.2)) * (z[1] - z[0]);
    } },
];

function run(exe, args, { timeoutMs = 300000, env = process.env } = {}) {
  return new Promise(resolve => {
    const t0 = performance.now();
    const child = spawn(exe, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false;
    child.stdout.on('data', b => { stdout += b; });
    child.stderr.on('data', b => { stderr += b; });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut, ms: performance.now() - t0 }); });
  });
}
// The planar kernel's polyhedral bodies write straight edges as curve: 'line'
// (implicit, from their end vertices) and leave sameSense implicit (outward
// normals); brep-tessellate reads the analytic body form. Same edges, same
// faces, only the notation changes: no coordinate is altered.
const dotv = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unitv = a => { const n = Math.hypot(...a); return a.map(v => v / n); };
function analyticForm(body) {
  if (!body.edges.some(e => typeof e.curve === 'string')) return body;
  return { ...body,
    edges: body.edges.map(e => typeof e.curve === 'string'
      ? { start: e.start, end: e.end, curve: { type: 'line', origin: body.vertices[e.start], direction: unitv(body.vertices[e.end].map((v, i) => v - body.vertices[e.start][i])) }, sameSense: true, ...(e.curveRange ? { curveRange: e.curveRange } : {}) }
      : e),
    faces: body.faces.map(f => ({ sameSense: true, ...f })) };
}
// buildCase refuses a brep leaf whose tessellation vertices lie more than
// 1e-9 mm off their face carriers. The planar kernel's F32 prisms far from the
// origin (the hopper plate at ~600 mm) have vertices up to ~2e-4 mm off their
// own planes, inside the body's stated vertex tolerance. For those operands
// the job is assembled here from the same brep-tessellate output, with the
// measured off-surface distance recorded instead of refused (recover's own
// check is deviation + 1e-9 mm, 0.01 mm here).
function buildRelaxed(id, deviation, op, source) {
  const operands = JSON.parse(zlib.gunzipSync(fs.readFileSync(source)));
  const faces = [], meshes = [], prims = []; let onSurface = 0;
  operands.bodies.forEach(({ body }, leaf) => {
    const b = tessellateBrep(body, deviation);
    if (!(signedVolume(b.vertices, b.triangles) > 0)) throw new Error('brep: tessellation is not outward-oriented');
    const tagOf = new Map(), surf = new Map(b.faces.map(f => [f.faceIndex, f.surface]));
    for (const f of b.faces) { tagOf.set(f.faceIndex, faces.length); faces.push({ leaf, faceIndex: f.faceIndex, surface: f.surface }); }
    for (const t of b.triangles) for (const i of t.slice(0, 3)) onSurface = Math.max(onSurface, surfaceDistance(surf.get(t[3]), b.vertices[i]));
    meshes.push({ leaf, vertices: b.vertices, triangles: b.triangles.map(([a, bb, c, f]) => [a, bb, c, tagOf.get(f)]) });
    prims.push({ kind: 'brep', params: [], matrix: resolveTransform({}) });
  });
  return { job: { id, deviation, tree: { op, children: [{ leaf: 0 }, { leaf: 1 }] }, prims, faces, meshes }, onSurface };
}
const native = proto => path.join(ROOT, `out/bakeoff/${proto}/build/cpu`);
const rel = p => path.relative(ROOT, p);

fs.mkdirSync(WORK, { recursive: true });
fs.mkdirSync(OPERANDS, { recursive: true });
const kernel = await loadKernel();
const meta = { at: new Date().toISOString(), uptime: execSync('uptime').toString().trim(),
  binaries: Object.fromEntries(['corefine', 'recover'].map(p => [p, { path: rel(native(p)), mtime: fs.statSync(native(p)).mtime.toISOString(),
    key: fs.readFileSync(`${native(p)}.key`, 'utf8').trim() }])) };
const rows = [];
for (const r of REPROS.filter(r => !only || only.includes(r.id))) {
  const row = { id: r.id, repro: `${REPRO}/${r.file}#${r.feature}`, op: r.op, expectedVolumeMm3: r.expected };
  const dump = path.join(OPERANDS, `${r.id}.json.gz`);
  if (!skipProbe || !fs.existsSync(dump)) {
    const p = await run('node', ['scripts/corpus/boolean-probe.mjs', path.join(ROOT, REPRO, r.file), r.feature, '--dump', dump]);
    const probe = JSON.parse(p.stdout.trim().split('\n').pop());
    row.production = { message: probe.message, subcause: probe.subcause, arm: probe.failingBoolean?.arm, operation: probe.failingBoolean?.operation };
  }
  const operands = JSON.parse(zlib.gunzipSync(fs.readFileSync(dump)));
  if (r.asBuilt) { row.expectedVolumeMm3 = r.asBuilt(operands.bodies.map(b => b.body)); row.idealVolumeMm3 = r.expected; }
  row.operands = operands.bodies.map(b => ({ role: b.role, faces: b.body.faces.length, edges: b.body.edges.length,
    surfaces: b.body.faces.reduce((m, f) => ({ ...m, [f.surface.type]: (m[f.surface.type] ?? 0) + 1 }), {}) }));
  const converted = path.join(OPERANDS, `${r.id}.analytic.json.gz`);
  fs.writeFileSync(converted, zlib.gzipSync(JSON.stringify({ ...operands, bodies: operands.bodies.map(b => ({ ...b, body: analyticForm(b.body) })) })));
  const leaves = r.csg ?? { op: r.op, children: [0, 1].map(body => ({ prim: 'brep', params: { source: rel(converted), body }, transform: T() })) };
  row.leaves = r.csg ? 'analytic CSG (cone faces are outside brep-tessellate)' : 'frozen production operands (brep)';
  let job;
  try {
    job = encodeJob(buildCase({ id: `corpus-${r.id}`, deviationMm: 0.01, csg: leaves }).job);
  } catch (error) {
    if (r.csg || !/vertex off its surface/.test(error.message)) { row.verdict = 'fixture-refused'; row.reason = error.message; rows.push(row); continue; }
    const relaxed = buildRelaxed(`corpus-${r.id}`, 0.01, r.op, converted);
    job = encodeJob(relaxed.job);
    row.leaves += `; fixture check relaxed: vertices up to ${relaxed.onSurface.toExponential(2)} mm off their carriers (buildCase demands 1e-9)`;
  }
  const jobFile = path.join(WORK, `${r.id}.job`), meshFile = path.join(WORK, `${r.id}.corefine.result`);
  fs.writeFileSync(jobFile, job);
  const c = await run(native('corefine'), ['--threads', '1', '--gpu', 'off', '--', jobFile, meshFile]);
  const meshText = fs.existsSync(meshFile) ? fs.readFileSync(meshFile, 'utf8') : '';
  const mesh = meshText ? decodeResult(meshText) : null;
  row.corefine = { code: c.code, wallMs: Math.round(c.ms), status: mesh?.status ?? 'error', reason: mesh?.reason, phases: c.stdout.trim().split('\n').pop() };
  if (mesh?.status !== 'ok') { row.verdict = 'corefine-unresolved'; rows.push(row); continue; }
  const v = validateResult(job, meshText).report;
  row.corefine.valid = v.valid; row.corefine.volumeMm3 = v.volume; row.corefine.triangles = mesh.mesh.triangles.length;
  row.corefine.meshVolumeRelErr = (v.volume - row.expectedVolumeMm3) / row.expectedVolumeMm3;
  const recoverIn = path.join(WORK, `${r.id}.recover.job`), recoverOut = path.join(WORK, `${r.id}.recover.result`);
  fs.writeFileSync(recoverIn, job + meshText);
  const rc = await run(native('recover'), ['--threads', '1', '--gpu', 'off', '--', recoverIn, recoverOut]);
  const text = fs.existsSync(recoverOut) ? fs.readFileSync(recoverOut, 'utf8') : '';
  row.recover = { code: rc.code, wallMs: Math.round(rc.ms), phases: rc.stdout.trim().split('\n').pop() };
  if (!text.startsWith('ok')) { row.recover.status = 'unresolved'; row.recover.reason = text.split('\n', 1)[0]; row.verdict = 'recover-unresolved'; rows.push(row); continue; }
  try {
    Object.assign(row.recover, await exportRecovered(text, `corpus-${r.id}`, path.join(WORK, 'step', r.id), kernel));
  } catch (error) { row.recover.status = 'export-failed'; row.recover.reason = error.message; row.verdict = 'recover-export-failed'; rows.push(row); continue; }
  const [o] = await occtCheck([path.join(WORK, 'step', `${r.id}.step`)]);
  row.occt = o;
  row.recoveredVolumeRelErr = o?.volume != null ? (o.volume - row.expectedVolumeMm3) / row.expectedVolumeMm3 : null;
  row.verdict = o?.valid && Math.abs(row.recoveredVolumeRelErr) < 1e-7 ? 'exact' : o?.valid ? 'valid-volume-off' : 'occt-invalid';
  rows.push(row);
  console.log(r.id.padEnd(20), row.verdict, row.recoveredVolumeRelErr?.toExponential(2) ?? '');
}
for (const r of rows) if (!['exact', 'valid-volume-off', 'occt-invalid'].includes(r.verdict)) console.log(r.id.padEnd(20), r.verdict, r.reason ?? r.corefine?.reason ?? r.recover?.reason ?? '');
meta.uptimeEnd = execSync('uptime').toString().trim();
fs.writeFileSync(path.join(ROOT, 'out/corpus/boolean-capability/bakeoff.json'), JSON.stringify({ schema: 'corpus-boolean-bakeoff/1', meta, rows }, null, 1) + '\n');
