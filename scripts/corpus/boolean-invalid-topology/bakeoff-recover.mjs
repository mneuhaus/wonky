// Cluster boolean-invalid-topology: run the cluster repros through the bake-off
// `recover` route (robust mesh Boolean -> exact B-rep recovery), using the
// bake-off's own unchanged infrastructure (scripts/bakeoff/fixtures.mjs
// buildCase, recover-extra.py oracle, kernel/proto/recover, recover-check.mjs).
// Everything is written below tmp/corpus/boolean-invalid-topology/recover; the
// bake-off's own fixtures and out/bakeoff are not touched.
//
// Two kinds of leaves per repro:
//   prism  the bake-off's analytic prism primitive (binary64 carriers)
//   brep   the actual wonky operands of the failing opBoolean, dumped by
//          dump-operands.mjs (f32 = production F32 polygon extruder;
//          linearc = the F32x2 line/arc extruder diagnosis build)
//
//   node scripts/corpus/boolean-invalid-topology/bakeoff-recover.mjs [--no-occt]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { ROOT, buildCase } from '../../bakeoff/fixtures.mjs';
import { encodeJob } from '../../bakeoff/jobfmt.mjs';
import { exportRecovered, occtCheck, validateStep } from '../../bakeoff/recover-check.mjs';
import { loadKernel } from '../../../src/kernel.mjs';
import { loadBend } from '../../../src/bend-loader.mjs';

const DIR = path.join(ROOT, 'tmp/corpus/boolean-invalid-topology/recover');
const OPS = 'tmp/corpus/boolean-invalid-topology/operands';
const OUT = path.join(ROOT, 'out/corpus/boolean-invalid-topology/bakeoff-recover.json');
const T = (translate = [0, 0, 0], rotate = []) => ({ rotate, translate });
const prism = (points, height, transform = T()) => ({ prim: 'prism', params: { points, height }, transform });
const brep = (name, body) => ({ prim: 'brep', params: { source: `${OPS}/${name}.json.gz`, body }, transform: T() });
const op = (o, a, b) => ({ op: o, children: [a, b] });

// Expected volumes: the wedge is closed form; the brep cases use the volumes the
// --linearc diagnosis build published through the production planar arrangement;
// cases without one are compared with the bake-off's OCCT exact-CSG oracle.
const CASES = [
  { id: 'wedge-union-prism', repro: 'wedge-union.fs#slanted', expectVolume: 319, csg: op('union', prism([[0, 0], [10, 0], [0, 7]], 5), prism([[-2, -2], [4, -2], [4, 3], [-2, 3]], 6, T([0, 0, 2]))) },
  { id: 'wedge-union-brep-f32', repro: 'wedge-union.fs#slanted', expectVolume: 319, csg: op('union', brep('wedge-f32', 0), brep('wedge-f32', 1)) },
  { id: 'wedge-union-brep-linearc', repro: 'wedge-union.fs#slanted', expectVolume: 319, csg: op('union', brep('wedge-linearc', 0), brep('wedge-linearc', 1)) },
  { id: 'slanted-union-brep-f32', repro: 'slanted-prism-union.fs', expectVolume: 206767.2, csg: op('union', brep('slanted-union-f32', 0), brep('slanted-union-f32', 1)) },
  { id: 'slanted-union-brep-linearc', repro: 'slanted-prism-union.fs', expectVolume: 206767.2, csg: op('union', brep('slanted-union-linearc', 0), brep('slanted-union-linearc', 1)) },
  { id: 'slanted-cut-brep-f32', repro: 'slanted-prism-cut.fs', expectVolume: 48766.666666666664, csg: op('subtract', brep('slanted-cut-f32', 0), brep('slanted-cut-f32', 1)) },
  { id: 'slanted-cut-brep-linearc', repro: 'slanted-prism-cut.fs', expectVolume: 48766.666666666664, csg: op('subtract', brep('slanted-cut-linearc', 0), brep('slanted-cut-linearc', 1)) },
  { id: 'rotated-cut-brep-f32', repro: 'rotated-box-cut.fs', expectVolume: 36339.23451688734, csg: op('subtract', brep('rotated-cut-f32', 0), brep('rotated-cut-f32', 1)) },
  { id: 'rotated-cut-brep-linearc', repro: 'rotated-box-cut.fs', expectVolume: 36339.23451688734, csg: op('subtract', brep('rotated-cut-linearc', 0), brep('rotated-cut-linearc', 1)) },
  // Next blockers after the carrier fix (planar arrangement internals), checked on the recover route.
  { id: 'chamfer-edge-rect-prism', repro: 'next-blocker-chamfer.fs#chamferOnEdge', csg: op('subtract', prism([[0, 0], [20, 0], [20, 14], [0, 14]], 10), prism([[5, 10], [25, 2], [25, 20], [5, 20]], 30, T([0, 20, 0], [{ axis: 'x', deg: 90 }]))) },
  { id: 'chamfer-inside-rect-prism', repro: 'next-blocker-chamfer.fs#slantedCut', csg: op('subtract', prism([[0, 0], [20, 0], [20, 14], [0, 14]], 10), prism([[5, 11], [25, 2], [25, 20], [5, 20]], 30, T([0, 20, 0], [{ axis: 'x', deg: 90 }]))) },
  // Third pass: real second-level refusals with F32x2 (--linearc) operands, dumped by dump-operands.mjs.
  // The anchor's apronCrest cut and the project-component-4c7a33fe nose cut are AmbiguousContact (stage 2); the tilted
  // pocket (kernel-sketch-and-ops next blocker) and the first upperRafter union are stage 6.
  { id: 'anchor-apron-crest-linearc', repro: 'fixtures/r10b/r10b.fs#r10bTransferEdge apronCrest (call 2)', csg: op('subtract', brep('anchor-apron-crest-linearc', 0), brep('anchor-apron-crest-linearc', 1)) },
  { id: 'neon-nose-linearc', repro: 'project-component-4c7a33fe.fs#project-component-4c7a33fe noseCut (call 0)', csg: op('subtract', brep('neon-nose-linearc', 0), brep('neon-nose-linearc', 1)) },
  { id: 'tilted-pocket-linearc', repro: 'kernel-sketch-and-ops/next-tilted-pocket-subtraction.fs (call 0)', csg: op('subtract', brep('tilted-pocket-linearc', 0), brep('tilted-pocket-linearc', 1)) },
  { id: 'rafter-r4-union-linearc', repro: 'interface-r4.fs#upperRafter first rib union (call 0)', csg: op('union', brep('rafter-r4-union-linearc', 0), brep('rafter-r4-union-linearc', 1)) },
].map(c => ({ category: 'corpus-cluster-boolean-invalid-topology', fdmRationale: c.repro, deviationMm: 0.01, ...c }));

const uptime = () => execSync('uptime').toString().trim();
const meta = { startUptime: uptime(), startedAt: new Date().toISOString(), target: 'js' };
fs.mkdirSync(path.join(DIR, 'jobs'), { recursive: true });
const rows = [], runnable = [];
for (const c of CASES) {
  try {
    fs.writeFileSync(path.join(DIR, 'jobs', `${c.id}.job`), encodeJob(buildCase(c).job));
    runnable.push(c);
  } catch (error) {
    rows.push({ id: c.id, repro: c.repro, status: 'leaf-refused', reason: error.message });
  }
}
fs.writeFileSync(path.join(DIR, 'cases.json'), JSON.stringify({ schema: 'wonky-recover-extra-cases/1', cases: runnable }, null, 1) + '\n');
const oracle = spawnSync('uv', ['run', '--quiet', 'scripts/bakeoff/recover-extra.py', DIR], { cwd: ROOT, encoding: 'utf8' });
if (oracle.status !== 0) throw new Error(`recover-extra.py failed: ${oracle.stderr.slice(-2000)}`);
const reference = JSON.parse(fs.readFileSync(path.join(DIR, 'reference.json'), 'utf8')).cases;
const mod = await loadBend(path.join(ROOT, 'kernel/proto/recover/main.bend'));
const kernel = await loadKernel();
for (const c of runnable) {
  const input = fs.readFileSync(path.join(DIR, 'jobs', `${c.id}.job`), 'utf8') + fs.readFileSync(path.join(DIR, 'results', `${c.id}.result`), 'utf8');
  const t0 = performance.now();
  const text = mod.run(input);
  const row = { id: c.id, repro: c.repro, computeMs: +(performance.now() - t0).toFixed(1), manifold: reference[c.id]?.manifold ?? null };
  try { Object.assign(row, await exportRecovered(text, c.id, path.join(DIR, 'step', c.id), kernel)); }
  catch (error) { row.status = 'invalid'; row.error = error.message; }
  rows.push(row);
}
if (!process.argv.includes('--no-occt')) {
  const exported = rows.filter(r => r.status === 'ok' && !r.empty);
  const occ = await occtCheck(exported.map(r => path.join(DIR, 'step', `${r.id}.step`)));
  for (const [i, r] of exported.entries()) {
    r.occt = occ[i];
    r.validateStep = await validateStep(path.join(DIR, 'step', r.id));
    const expect = CASES.find(c => c.id === r.id).expectVolume ?? reference[r.id]?.occt?.volume;
    if (!occ[i].error) r.volumeRelErr = Math.abs(occ[i].volume - expect) / expect;
  }
}
meta.endUptime = uptime(); meta.endedAt = new Date().toISOString();
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ schema: 'wonky-corpus-bakeoff-recover/1', meta, rows }, null, 1) + '\n');
for (const r of rows) console.log(`${r.id.padEnd(28)} ${String(r.status).padEnd(12)} ${r.topology ? `${r.topology.faces}F/${r.topology.edges}E/${r.topology.vertices}V` : ''} ${r.occt ? `occt valid=${r.occt.valid} V=${r.occt.volume}` : ''} ${r.volumeRelErr !== undefined ? `relErr=${r.volumeRelErr.toExponential(2)}` : ''} ${r.validateStep ? `validate-step=${r.validateStep.ok}` : ''} ${(r.reason ?? r.error ?? '').slice(0, 140)}`);
