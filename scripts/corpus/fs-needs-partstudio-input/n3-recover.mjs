// Cluster fs-needs-partstudio-input: run the dominant next blocker (the
// fixed-frame R30 subtraction n3 = n1 - n2, 20 files) through the bake-off
// `recover` route (robust mesh Boolean -> exact B-rep recovery) with the
// bake-off's own unchanged infrastructure (scripts/bakeoff/fixtures.mjs
// buildCase, recover-extra.py oracle, kernel/proto/recover, recover-check.mjs).
//
// Three kinds of leaves:
//   prism         the bake-off's analytic prism primitive (binary64 carriers)
//   brep-f32      wonky's actual operands, production F32 polygon extruder
//   brep-linearc  wonky's operands built by the F32x2 line/arc extruder
//                 (the fix proposed in docs/corpus/cluster-boolean-invalid-topology.md)
// The brep operands are dumped first with
//   node scripts/corpus/boolean-invalid-topology/dump-operands.mjs \
//     tmp/corpus/cluster-partstudio/fixed-frame-r30-n3.fs \
//     --out tmp/corpus/cluster-partstudio/operands/n3-{f32,linearc}.json.gz [--linearc]
//
// Mesh sources for recover: the harness oracle (manifold3d via uv, a TEST
// input), and the two Bend mesh-Boolean prototypes that take the same job
// (kernel/proto/corefine, kernel/proto/exact-plane), each run on the JS target
// through scripts/bakeoff/js-worker.mjs, one process at a time. A corefine or
// exact-plane 'ok' mesh is fed to recover like the bake-off's --source <proto>.
//
// Writes tmp/corpus/cluster-partstudio/recover/** and
// out/corpus/fs-needs-partstudio-input/n3-recover.json. Diagnosis only.
//   node scripts/corpus/fs-needs-partstudio-input/n3-recover.mjs [--no-occt]
import { spawnSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, buildCase } from '../../bakeoff/fixtures.mjs';
import { encodeJob } from '../../bakeoff/jobfmt.mjs';
import { exportRecovered, occtCheck, validateStep } from '../../bakeoff/recover-check.mjs';
import { loadKernel } from '../../../src/kernel.mjs';
import { loadBend } from '../../../src/bend-loader.mjs';

const DIR = path.join(ROOT, 'tmp/corpus/cluster-partstudio/recover');
const OPS = 'tmp/corpus/cluster-partstudio/operands';
const SOURCE = path.join(ROOT, 'tmp/corpus/cluster-partstudio/fixed-frame-r30-n3.fs');
const OUT = path.join(ROOT, 'out/corpus/fs-needs-partstudio-input/n3-recover.json');

const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
// Axis-angle of the rotation with columns (x, y, n): the bake-off prism
// (profile in local xy, extruded along local +z) lands on the FS sketch plane.
function frame(x, y, n) {
  const R = [[x[0], y[0], n[0]], [x[1], y[1], n[1]], [x[2], y[2], n[2]]];
  const c = (R[0][0] + R[1][1] + R[2][2] - 1) / 2, th = Math.acos(Math.max(-1, Math.min(1, c)));
  return [{ axis: [R[2][1] - R[1][2], R[0][2] - R[2][0], R[1][0] - R[0][1]], deg: th * 180 / Math.PI }];
}
const nums = t => t.split(',').map(Number);
function prismFromLine(line) {
  const m = line.match(/plane\(vector\(([^)]*)\)\*millimeter,vector\(([^)]*)\),vector\(([^)]*)\)\),(\[\[.*\]\]),vector\(([^)]*)\),([0-9.]+)\);$/);
  if (!m) throw new Error('unparsed prism line: ' + line.slice(0, 120));
  const [o, n, x, pts, d, depth] = [nums(m[1]), nums(m[2]), nums(m[3]), JSON.parse(m[4]), nums(m[5]), Number(m[6])];
  const dot = n[0] * d[0] + n[1] * d[1] + n[2] * d[2];
  if (Math.abs(Math.abs(dot) - 1) > 1e-12) throw new Error('extrusion not along the plane normal');
  const y = cross(n, x);
  return dot > 0
    ? { prim: 'prism', params: { points: pts, height: depth }, transform: { rotate: frame(x, y, n), translate: o } }
    : { prim: 'prism', params: { points: pts.map(([px, py]) => [px, -py]), height: depth }, transform: { rotate: frame(x, y.map(v => -v), d), translate: o } };
}
const lines = fs.readFileSync(SOURCE, 'utf8').split('\n');
const [l1, l2] = [/^ var q1=prism/, /^ var q2=prism/].map(re => lines.find(l => re.test(l)));
const brep = (name, body) => ({ prim: 'brep', params: { source: `${OPS}/${name}.json.gz`, body }, transform: { rotate: [], translate: [0, 0, 0] } });
const sub = (a, b) => ({ op: 'subtract', children: [a, b] });
const CASES = [
  { id: 'ff30-n3-prism', csg: sub(prismFromLine(l1), prismFromLine(l2)) },
  { id: 'ff30-n3-brep-f32', csg: sub(brep('n3-f32', 0), brep('n3-f32', 1)) },
  { id: 'ff30-n3-brep-linearc', csg: sub(brep('n3-linearc', 0), brep('n3-linearc', 1)) },
].map(c => ({ category: 'corpus-cluster-fs-needs-partstudio-input', fdmRationale: 'fixed-frame-r30.fs:81-83 n3', deviationMm: 0.01, ...c }));

const uptime = () => execSync('uptime').toString().trim();
const meta = { startUptime: uptime(), startedAt: new Date().toISOString(), target: 'js', source: path.relative(ROOT, SOURCE) };
fs.mkdirSync(path.join(DIR, 'jobs'), { recursive: true });
const rows = [], runnable = [];
for (const c of CASES) {
  try { fs.writeFileSync(path.join(DIR, 'jobs', `${c.id}.job`), encodeJob(buildCase(c).job)); runnable.push(c); }
  catch (error) { rows.push({ id: c.id, status: 'leaf-refused', reason: error.message }); }
}
fs.writeFileSync(path.join(DIR, 'cases.json'), JSON.stringify({ schema: 'wonky-recover-extra-cases/1', cases: runnable }, null, 1) + '\n');
const oracle = spawnSync('uv', ['run', '--quiet', 'scripts/bakeoff/recover-extra.py', DIR], { cwd: ROOT, encoding: 'utf8' });
if (oracle.status !== 0) throw new Error(`recover-extra.py failed: ${oracle.stderr.slice(-2000)}`);
const reference = JSON.parse(fs.readFileSync(path.join(DIR, 'reference.json'), 'utf8')).cases;
const mod = await loadBend(path.join(ROOT, 'kernel/proto/recover/main.bend'));
const kernel = await loadKernel();
const meshSources = [];
for (const c of runnable) {
  const job = path.join(DIR, 'jobs', `${c.id}.job`);
  meshSources.push({ c, source: 'oracle-manifold', file: path.join(DIR, 'results', `${c.id}.result`) });
  for (const proto of ['corefine', 'exact-plane']) {
    const file = path.join(DIR, proto, `${c.id}.js.result`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const w = spawnSync('node', ['scripts/bakeoff/js-worker.mjs', `kernel/proto/${proto}/main.bend`, job, file, '1'], { cwd: ROOT, encoding: 'utf8', timeout: 300_000 });
    const first = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n', 2).join(' ').trim() : null;
    const timing = (() => { try { return JSON.parse(w.stdout.trim().split('\n').pop()).warm; } catch { return null; } })();
    rows.push({ id: `${c.id}`, meshBoolean: proto, status: first?.startsWith('ok') ? 'mesh-ok' : 'mesh-refused', head: first?.slice(0, 160) ?? w.stderr.slice(-300), computeMs: timing?.computeMs ?? null });
    if (first?.startsWith('ok')) meshSources.push({ c, source: proto, file });
  }
}
for (const { c, source, file } of meshSources) {
  const input = fs.readFileSync(path.join(DIR, 'jobs', `${c.id}.job`), 'utf8') + fs.readFileSync(file, 'utf8');
  const t0 = performance.now();
  const text = mod.run(input);
  const key = source === 'oracle-manifold' ? c.id : `${c.id}+${source}`;
  const row = { id: key, meshBoolean: source, recover: true, computeMs: +(performance.now() - t0).toFixed(1), manifold: source === 'oracle-manifold' ? reference[c.id]?.manifold ?? null : null, occtReference: reference[c.id]?.occt ?? null };
  try { Object.assign(row, await exportRecovered(text, key, path.join(DIR, 'step', key), kernel)); }
  catch (error) { row.status = 'invalid'; row.error = error.message; }
  rows.push(row);
}
// The exact CSG volume: OCCT on the binary64 prism leaves (brep leaves need the
// bake-off's out/bakeoff/brep STEP files, which this analysis does not write).
const exactVolume = reference['ff30-n3-prism']?.occt?.volume;
if (!process.argv.includes('--no-occt')) {
  const exported = rows.filter(r => r.status === 'ok' && !r.empty);
  const occ = await occtCheck(exported.map(r => path.join(DIR, 'step', `${r.id}.step`)));
  for (const [i, r] of exported.entries()) {
    r.occt = occ[i];
    r.validateStep = await validateStep(path.join(DIR, 'step', r.id));
    if (!occ[i].error && exactVolume) r.volumeRelErrVsExactCsg = Math.abs(occ[i].volume - exactVolume) / exactVolume;
  }
}
meta.endUptime = uptime(); meta.endedAt = new Date().toISOString();
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ schema: 'wonky-corpus-bakeoff-recover/1', meta, exactVolumeMm3: exactVolume ?? null, rows }, null, 1) + '\n');
for (const r of rows) console.log(`${r.id.padEnd(30)} ${String(r.meshBoolean ?? '').padEnd(16)} ${r.recover ? 'recover' : '       '} ${String(r.status).padEnd(12)} ${r.topology ? `${r.topology.faces}F/${r.topology.edges}E/${r.topology.vertices}V` : ''} ${r.occt ? `occt valid=${r.occt.valid} V=${r.occt.volume}` : ''} ${r.volumeRelErrVsExactCsg !== undefined ? `relErr=${r.volumeRelErrVsExactCsg.toExponential(2)}` : ''} ${r.validateStep ? `validate-step=${r.validateStep.ok}` : ''} ${r.computeMs ?? ''}ms ${(r.reason ?? r.error ?? r.head ?? '').slice(0, 160)}`);
