// Corpus failure analysis, cluster fs-interpreter-semantics, overlap check:
// once this cluster is fixed, 19 units stop at a refused opBoolean (a round
// hole in a planar body that already carries cuts). This script sends the
// frozen operands of those refusals through the bake-off's all-Bend route,
// the same way scripts/corpus/boolean-bakeoff.mjs does for the
// boolean-capability repros, without touching the bake-off's cases, fixtures,
// binaries or outputs:
//
//   1. the operands were dumped beforehand by the production probe into
//      tmp/corpus/fs-interpreter-semantics/next-bakeoff/. For the corpus
//      copies the in-memory prototype fix of this cluster is loaded:
//        node --import ./scripts/corpus/fs-interpreter-semantics/prototype/register.mjs \
//          scripts/corpus/boolean-probe.mjs <copy.fs> [feature] --dump <operands.json.gz>
//      The two minimal repros need no prototype;
//   2. scripts/bakeoff/fixtures.mjs buildCase with `brep` leaves writes a job;
//      if buildCase refuses F32 vertices off their carriers, the job is built
//      from the same brep-tessellate output with the offset recorded (as in
//      boolean-bakeoff.mjs buildRelaxed);
//   3. corefine (native cpu build, 1 thread) computes the tagged mesh Boolean;
//      scripts/bakeoff/validate.mjs checks it;
//   4. recover (native cpu build) turns job + mesh into an exact B-rep;
//      recover-check.mjs exportRecovered validates it with the kernel
//      validator and writes STEP with src/exporters.mjs;
//   5. OpenCascade is the oracle twice: recover-step.py checks the recovered
//      STEP, and occt-cut.py computes target minus tool from the operand STEP
//      files (kernel serializer) as the expected volume.
//
// Usage: node scripts/corpus/fs-interpreter-semantics/next-bakeoff.mjs [--probe]
//   --probe  (re)creates the operand dumps first: copies the corpus files
//            (read only) to tmp/corpus/fs-interpreter-semantics/next-bakeoff/src/
//            and runs boolean-probe.mjs on each, one process at a time.
// Output: out/corpus/fs-interpreter-semantics/next-bakeoff.json
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { buildCase } from '../../bakeoff/fixtures.mjs';
import { tessellateBrep } from '../../bakeoff/brep-tessellate.mjs';
import { resolveTransform, surfaceDistance, signedVolume } from '../../bakeoff/tessellate.mjs';
import { encodeJob, decodeResult } from '../../bakeoff/jobfmt.mjs';
import { validateResult } from '../../bakeoff/validate.mjs';
import { exportRecovered, occtCheck } from '../../bakeoff/recover-check.mjs';
import { loadKernel } from '../../../src/kernel.mjs';
import { toStep } from '../../../src/exporters.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const WORK = path.join(ROOT, 'tmp/corpus/fs-interpreter-semantics/next-bakeoff');
const OUT = path.join(ROOT, 'out/corpus/fs-interpreter-semantics/next-bakeoff.json');
const CASES = [
  { id: 'notched-panel-repro', source: 'fixtures/corpus-repro/fs-interpreter-semantics/next/lochwand-hole-in-notched-panel.fs#repro',
    probe: { file: 'fixtures/corpus-repro/fs-interpreter-semantics/next/lochwand-hole-in-notched-panel.fs', feature: 'repro' },
    units: 'minimal repro of the 17 lochwand units (fs233, fs161, fs554)', dump: 'lochwand-notch.json.gz',
    closedForm: 600 * 6 * 350 - 100 * 6 * 110 - Math.PI * 15 ** 2 * 6 },
  { id: 'lochwand-topo-native', source: 'cad-project-020/lochwand/topo-native/source.fs (copy), gameA/holeCut0',
    probe: { corpus: 'cad-project-020/lochwand/topo-native/source.fs', copy: 'lochwand-topo/source.fs', prototype: true },
    units: 'fs233 representative (15 units)', dump: 'lochwand-topo.json.gz' },
  { id: 'mini-camera', source: 'cad-project-043/fsocct/cases/workspace/mini_camera.fs (copy), clampPilot52/cut',
    probe: { corpus: 'cad-project-043/fsocct/cases/workspace/mini_camera.fs', copy: 'mini-camera/mini_camera.fs', prototype: true },
    units: 'fs555 (1 unit)', dump: 'mini-camera.json.gz' },
  { id: 'gt2-mini-r1', source: 'cad-project-041/archiv/gt2-linie/single-stage-gt2-mini-r1/mini-stage.fs (copy), plateRetain-1/cut',
    probe: { corpus: 'cad-project-041/archiv/gt2-linie/single-stage-gt2-mini-r1/mini-stage.fs', copy: 'gt2-mini-r1/mini-stage.fs', prototype: true },
    units: 'fs473 gt2 mini r1 (1 unit)', dump: 'gt2-mini-r1.json.gz' },
  { id: 'blind-pilot-repro', source: 'fixtures/corpus-repro/fs-interpreter-semantics/next/blind-pilot-in-stepped-body.fs#repro',
    probe: { file: 'fixtures/corpus-repro/fs-interpreter-semantics/next/blind-pilot-in-stepped-body.fs', feature: 'repro' },
    units: 'minimal repro of the mini_camera blind pilot bore (fs555)', dump: 'blind-pilot.json.gz',
    closedForm: 60 * 3 * 50 + 20 * 11 * 20 - 20 * 3 * 20 - Math.PI * 1.3 ** 2 * 10 },
];

function run(exe, args, { timeoutMs = 300000 } = {}) {
  return new Promise(resolve => {
    const t0 = performance.now();
    const child = spawn(exe, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false;
    child.stdout.on('data', b => { stdout += b; });
    child.stderr.on('data', b => { stderr += b; });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut, ms: performance.now() - t0 }); });
  });
}
// Same notation change as boolean-bakeoff.mjs analyticForm: the planar
// kernel's implicit line edges and implicit sameSense become explicit.
// No coordinate changes.
const unitv = a => { const n = Math.hypot(...a); return a.map(v => v / n); };
function analyticForm(body) {
  if (!body.edges.some(e => typeof e.curve === 'string')) return body;
  return { ...body,
    edges: body.edges.map(e => typeof e.curve === 'string'
      ? { start: e.start, end: e.end, curve: { type: 'line', origin: body.vertices[e.start], direction: unitv(body.vertices[e.end].map((v, i) => v - body.vertices[e.start][i])) }, sameSense: true, ...(e.curveRange ? { curveRange: e.curveRange } : {}) }
      : e),
    faces: body.faces.map(f => ({ sameSense: true, ...f })) };
}
function buildRelaxed(id, deviation, op, operands) {
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
const T = () => ({ rotate: [], translate: [0, 0, 0] });

const CAD = path.join(process.env.HOME, 'Workspace/cad');
const PROTOTYPE = './scripts/corpus/fs-interpreter-semantics/prototype/register.mjs';
if (process.argv.includes('--probe')) {
  const env = { ...process.env }; delete env.WONKY_BACKEND;
  for (const c of CASES) {
    let file = c.probe.file;
    if (c.probe.corpus) {
      file = path.join(WORK, 'src', c.probe.copy);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.copyFileSync(path.join(CAD, c.probe.corpus), file);
    }
    const args = [...(c.probe.prototype ? ['--import', PROTOTYPE] : []), 'scripts/corpus/boolean-probe.mjs', file,
      ...(c.probe.feature ? [c.probe.feature] : []), '--dump', path.join(WORK, c.dump)];
    const p = await new Promise(resolve => {
      const child = spawn('node', args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = ''; child.stdout.on('data', b => { stdout += b; });
      const timer = setTimeout(() => child.kill('SIGKILL'), 400000);
      child.on('close', code => { clearTimeout(timer); resolve({ code, stdout }); });
    });
    fs.writeFileSync(path.join(WORK, `probe-${c.id}.json`), p.stdout);
    console.log('probe', c.id, p.stdout.trim().split('\n').pop().slice(0, 160));
  }
}
const kernel = await loadKernel();
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'bend.lock.json'), 'utf8'));
const meta = { at: new Date().toISOString(), uptime: execSync('uptime').toString().trim(),
  binaries: Object.fromEntries(['corefine', 'recover'].map(p => [p, { path: rel(native(p)), mtime: fs.statSync(native(p)).mtime.toISOString(),
    key: fs.readFileSync(`${native(p)}.key`, 'utf8').trim() }])) };
const rows = [];
for (const c of CASES) {
  const row = { id: c.id, source: c.source, units: c.units };
  const dump = path.join(WORK, c.dump);
  if (!fs.existsSync(dump)) { row.verdict = 'no-operands'; rows.push(row); continue; }
  const operands = JSON.parse(zlib.gunzipSync(fs.readFileSync(dump)));
  row.production = { operation: operands.operation, operationId: operands.operationId };
  row.operands = operands.bodies.map(b => ({ role: b.role, faces: b.body.faces.length, edges: b.body.edges.length,
    surfaces: b.body.faces.reduce((m, f) => ({ ...m, [f.surface.type]: (m[f.surface.type] ?? 0) + 1 }), {}),
    kernelVolumeMm3: b.body.validation?.volumeMm3 ?? null, toleranceMm: b.body.validation?.toleranceMm ?? null }));
  // Oracle: OCCT target minus tool on the operand STEP files.
  const stepDir = path.join(WORK, 'operands-step'); fs.mkdirSync(stepDir, { recursive: true });
  const stepFiles = operands.bodies.map(({ body }, i) => {
    const file = path.join(stepDir, `${c.id}-body${i}.step`);
    fs.writeFileSync(file, toStep({ bodies: [body], backend: { version } }, path.basename(file, '.step')));
    return file;
  });
  const oc = await run('uv', ['run', '--quiet', 'scripts/corpus/fs-interpreter-semantics/occt-cut.py', ...stepFiles]);
  try { row.oracle = JSON.parse(oc.stdout.trim().split('\n').pop()); } catch { row.oracle = { error: oc.stderr.slice(-800) }; }
  row.expectedVolumeMm3 = c.closedForm ?? row.oracle?.cut?.volume ?? null;
  row.expectedFrom = c.closedForm != null ? 'closed form' : 'OCCT cut of the operand STEP files';
  if (c.closedForm != null && row.oracle?.cut?.volume != null) row.oracleVsClosedForm = (row.oracle.cut.volume - c.closedForm) / c.closedForm;

  const converted = path.join(WORK, `${c.id}.analytic.json.gz`);
  const analytic = { ...operands, bodies: operands.bodies.map(b => ({ ...b, body: analyticForm(b.body) })) };
  fs.writeFileSync(converted, zlib.gzipSync(JSON.stringify(analytic)));
  const leaves = { op: 'subtract', children: [0, 1].map(body => ({ prim: 'brep', params: { source: rel(converted), body }, transform: T() })) };
  row.leaves = 'frozen production operands (brep)';
  let job;
  try {
    job = encodeJob(buildCase({ id: `corpus-${c.id}`, deviationMm: 0.01, csg: leaves }).job);
  } catch (error) {
    if (!/vertex off its surface/.test(error.message)) { row.verdict = 'fixture-refused'; row.reason = error.message; rows.push(row); continue; }
    const relaxed = buildRelaxed(`corpus-${c.id}`, 0.01, 'subtract', analytic);
    job = encodeJob(relaxed.job);
    row.leaves += `; fixture check relaxed: vertices up to ${relaxed.onSurface.toExponential(2)} mm off their carriers (buildCase demands 1e-9)`;
  }
  const jobFile = path.join(WORK, `${c.id}.job`), meshFile = path.join(WORK, `${c.id}.corefine.result`);
  fs.writeFileSync(jobFile, job);
  fs.rmSync(meshFile, { force: true });
  const cf = await run(native('corefine'), ['--threads', '1', '--gpu', 'off', '--', jobFile, meshFile]);
  const meshText = fs.existsSync(meshFile) ? fs.readFileSync(meshFile, 'utf8') : '';
  const mesh = meshText ? decodeResult(meshText) : null;
  row.corefine = { code: cf.code, wallMs: Math.round(cf.ms), status: mesh?.status ?? 'error', reason: mesh?.reason, phases: cf.stdout.trim().split('\n').pop() };
  if (mesh?.status !== 'ok') { row.verdict = 'corefine-unresolved'; rows.push(row); continue; }
  const v = validateResult(job, meshText).report;
  row.corefine.valid = v.valid; row.corefine.volumeMm3 = v.volume; row.corefine.triangles = mesh.mesh.triangles.length;
  if (row.expectedVolumeMm3) row.corefine.meshVolumeRelErr = (v.volume - row.expectedVolumeMm3) / row.expectedVolumeMm3;
  const recoverIn = path.join(WORK, `${c.id}.recover.job`), recoverOut = path.join(WORK, `${c.id}.recover.result`);
  fs.writeFileSync(recoverIn, job + meshText);
  fs.rmSync(recoverOut, { force: true });
  const rc = await run(native('recover'), ['--threads', '1', '--gpu', 'off', '--', recoverIn, recoverOut]);
  const text = fs.existsSync(recoverOut) ? fs.readFileSync(recoverOut, 'utf8') : '';
  row.recover = { code: rc.code, wallMs: Math.round(rc.ms), phases: rc.stdout.trim().split('\n').pop() };
  if (!text.startsWith('ok')) { row.recover.status = 'unresolved'; row.recover.reason = text.split('\n', 1)[0]; row.verdict = 'recover-unresolved'; rows.push(row); continue; }
  try {
    Object.assign(row.recover, await exportRecovered(text, `corpus-${c.id}`, path.join(WORK, 'step', c.id), kernel));
  } catch (error) { row.recover.status = 'export-failed'; row.recover.reason = error.message; row.verdict = 'recover-export-failed'; rows.push(row); continue; }
  const [o] = await occtCheck([path.join(WORK, 'step', `${c.id}.step`)]);
  row.occt = o;
  row.recoveredVolumeRelErr = o?.volume != null && row.expectedVolumeMm3 ? (o.volume - row.expectedVolumeMm3) / row.expectedVolumeMm3 : null;
  row.verdict = o?.valid && Math.abs(row.recoveredVolumeRelErr) < 1e-7 ? 'exact' : o?.valid ? 'valid-volume-off' : 'occt-invalid';
  rows.push(row);
}
for (const r of rows) console.log(r.id.padEnd(22), r.verdict, r.recoveredVolumeRelErr?.toExponential(2) ?? '', r.reason ?? r.corefine?.reason ?? r.recover?.reason ?? '');
meta.uptimeEnd = execSync('uptime').toString().trim();
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ schema: 'corpus-next-bakeoff/1', meta, rows }, null, 1) + '\n');
