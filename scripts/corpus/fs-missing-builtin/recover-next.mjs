// Overlap check with the Boolean bake-off (corpus analysis only; read-only use
// of scripts/bakeoff and kernel/proto/recover). Once the fs-missing-builtin fix
// lands (opTransform, coordSystem, toWorld, rotationAround), the cluster's
// Boolean-blocked units stop at the opBoolean calls below. Each case is that
// Boolean written as a bake-off CSG tree with the corpus file's own values, so
// the question "does the recover route already build it?" is answered for the
// real shape, not for a catalogue analogue.
//
//   node scripts/corpus/fs-missing-builtin/recover-next.mjs [--js] [--cases a,b] [--no-occt]
//
// Pipeline (the one scripts/bakeoff/recover-extra.mjs runs, with its own
// directory tmp/corpus/fs-missing-builtin/recover instead of out/bakeoff):
//   1. job: bake-off fixture tessellation (fixtures.mjs buildCase)
//   2. input: uv run scripts/bakeoff/recover-extra.py <dir> (manifold3d mesh
//      Boolean with face provenance = TEST INPUT; OCCT exact CSG = oracle)
//   3. recovery in Bend: kernel/proto/recover (the bake-off's native cpu1 build
//      if present, else the JS target; --js forces JS)
//   4. check: STEP export, OpenCascade validity + volume against the oracle
// Result: out/corpus/cluster-fs-missing-builtin-recover.json
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadKernel } from '../../../src/kernel.mjs';
import { loadBend } from '../../../src/bend-loader.mjs';
import { ROOT, buildCase } from '../../bakeoff/fixtures.mjs';
import { encodeJob } from '../../bakeoff/jobfmt.mjs';
import { exportRecovered, occtCheck, validateStep, refinementOk } from '../../bakeoff/recover-check.mjs';

const DIR = path.join(ROOT, 'tmp/corpus/fs-missing-builtin/recover');
const argv = process.argv.slice(2);
const only = argv.includes('--cases') ? argv[argv.indexOf('--cases') + 1].split(',') : null;

const cyl = (radius, height, translate = [0, 0, 0], rotate = []) => ({ prim: 'cylinder', params: { radius, height }, transform: { rotate, translate } });
const cone = (r1, r2, height, translate = [0, 0, 0], rotate = []) => ({ prim: 'cone', params: { r1, r2, height }, transform: { rotate, translate } });
const box = (min, max) => ({ prim: 'box', params: { min, max }, transform: { rotate: [], translate: [0, 0, 0] } });
const prism = (points, height, translate, rotate) => ({ prim: 'prism', params: { points, height }, transform: { rotate, translate } });
const op = (o, ...xs) => xs.reduce((a, b) => ({ op: o, children: [a, b] }));
// FeatureScript leaves run +Z from z = 0; these rotations turn +Z into the named world axis.
const TO = { '+x': [{ axis: 'y', deg: 90 }], '-y': [{ axis: 'x', deg: 90 }], '+y': [{ axis: 'x', deg: -90 }], '+z': [] };

// --- fs95 distributor bottom interface, cableClamp (interface-r8.fs lines 428-433, same in
// r3..r11 and the bottom-drive native-source.fs copies). bar = block(-8,.9,25 .. 8,3.9,47.8);
// boreAlong(p=(0,4,z), n=-Y, r=1.7, h=4); cs(p=(0,3.9,z), n=+Y, d=3): hd=7.02, rr=1.7,
// hh=1.81, conicalTool lofts r 1.7 at local z=-1.81 to r 3.51 at local z=+0.01, posed with
// toWorld(coordSystem(p, X, +Y)). z = 28.3 and 43.8.
// At the bar top the frustum radius is 1.7 + 1.81 * 1.81/1.82 = 3.500055 mm. r6..r11 and the
// bottom-drive copies (11 files) put the first hole 3.3 mm from the bar end z = 25, so that
// countersink breaks out through the end face (a plane parallel to the cone axis: hyperbola).
// r5 (interface-r5.fs) leaves 3.5 mm, a breakout of 5.5e-5 mm; r4 (interface-r4.fs) leaves 6 mm.
const bar = box([-8, 0.9, 25], [8, 3.9, 47.8]);
const hole = z => cyl(1.7, 4, [0, 4, z], TO['-y']);
const sink = (z, top = 3.9) => cone(1.7, 3.51, 1.82, [0, top - 1.81, z], TO['+y']);
// interface-r5.fs lines 353-354: bar (-8,.9,27 .. 8,3.9,57), holes at z 30.5 and 53.5.
const barR5 = box([-8, 0.9, 27], [8, 3.9, 57]);
// interface-r4.fs lines 329-330: bar (-8,.7,24 .. 8,3.7,59.3); hole cyl r1.7 h5 posed at (0,4,z)
// along -Y; cs at (0,3.7,z); z 30 and 54.
const barR4 = box([-8, 0.7, 24], [8, 3.7, 59.3]);
const holeR4 = z => cyl(1.7, 5, [0, 4, z], TO['-y']);

// --- module-r4-upload.fs frameR4Diagonal (lines 567-578). web = prism in the plane x=-10
// (sketch x = world Y, sketch y = world Z), extruded 20 along +X; footHole = axialCylinder
// ((-11,332,586.2), +X, r 2.75, 22); headPilot = cyl((0,181,H-9.8), r 1.35, 10) along +Z.
// At y=181 the web spans z H-12..H, so the pilot is BLIND (stops 2.2 mm above the underside).
const H = 778.5895640637211;
const webPoints = [[170, H], [192, H], [198, H - 8], [344, 603.2], [344, 571.2], [320, 571.2], [320, 583.2], [184, H - 12], [170, H - 12]];
// local (u,v,w) -> world (w-10, u, v): Rz(90) then Ry(90)
const web = prism(webPoints, 20, [-10, 0, 0], [{ axis: 'z', deg: 90 }, { axis: 'y', deg: 90 }]);
const footHole = cyl(2.75, 22, [-11, 332, 586.2], TO['+x']);
const headPilot = cyl(1.35, 10, [0, 181, H - 9.8]);

// --- module-r4-upload.fs frameR4HeadRetainer (lines 663-670): z = PLATE_Z + 6.35 - 0.19;
// unite(cyl((0,181,z-40), r 1.5, 38.14), axialFrustum((0,181,z-1.86), +Z, r 1.5 -> 3.36, 1.86)).
const ZR = 804.7895640637212 + 6.35 - 0.19;

// --- top-structure-r1.fs motorCrossmemberU2 (lines 129-133), first loop pass side = -1,
// angle 120: crossbeam block(-211,-132,650 .. -187,132,678); boss = crossHole((-24,230,660),
// r 6, h 13) = cylinder along +X from p, then spin() = rotationAround(Z axis, 120 deg).
const rz = (deg, [x, y, z]) => { const a = deg * Math.PI / 180; return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a), z]; };
const boss = deg => cyl(6, 13, rz(deg, [-24, 230, 660]), [...TO['+x'], { axis: 'z', deg }]);
const crossbeam = box([-211, -132, 650], [-187, 132, 678]);

const CASES = [
  { id: 'fs95-cs-first', note: 'interface-r8.fs cableClamp cs0 > cut: bar with one 1.7 mm hole along -Y, minus the posed countersink frustum whose small circle lies on the hole wall (the failing Boolean in 13 fs95 files)',
    csg: op('subtract', op('subtract', bar, hole(28.3)), sink(28.3)) },
  { id: 'fs95-cableclamp', note: 'the whole cableClamp feature: two holes, two countersinks (4 Booleans)',
    csg: op('subtract', bar, hole(28.3), sink(28.3), hole(43.8), sink(43.8)) },
  { id: 'fs95-r5-cs-first', note: 'interface-r5.fs cableClamp cs0 > cut: the countersink rim grazes the bar end face (breakout 5.5e-5 mm)',
    csg: op('subtract', op('subtract', barR5, hole(30.5)), sink(30.5)) },
  { id: 'fs95-r4-cableclamp', note: 'interface-r4.fs cableClamp before its skText mark: both countersinks stay 5.3 mm or more inside the bar (the plate-countersink topology twice)',
    csg: op('subtract', barR4, holeR4(30), sink(30, 3.7), holeR4(54), sink(54, 3.7)) },
  { id: 'r4-diagonal-headpilot', note: 'module-r4-upload.fs frameR4Diagonal cut@575: the web (9-gon, x -10..10) after the X foot hole, minus a BLIND r1.35 pilot from the top (production: pierce decline 2)',
    csg: op('subtract', op('subtract', web, footHole), headPilot) },
  { id: 'r4-head-retainer', note: 'module-r4-upload.fs frameR4HeadRetainer unite@666: coaxial screw envelope, shaft r1.5 plus a frustum head r1.5 -> 3.36 that meets it at equal radius',
    csg: op('union', cyl(1.5, 38.14, [0, 181, ZR - 40]), cone(1.5, 3.36, 1.86, [0, 181, ZR - 1.86])) },
  { id: 'u2-boss-join', note: 'top-structure-r1.fs motorCrossmemberU2 unite@133 (side -1): crossbeam box plus an r6 boss at 120 deg that crosses its vertical corner edge obliquely',
    csg: op('union', crossbeam, boss(120)) },
].filter(c => !only || only.includes(c.id)).map(c => ({ category: 'corpus-fs-missing-builtin', fdmRationale: c.note, deviationMm: 0.01, expect: 'exact', ...c }));

fs.mkdirSync(path.join(DIR, 'jobs'), { recursive: true });
for (const c of CASES) fs.writeFileSync(path.join(DIR, 'jobs', `${c.id}.job`), encodeJob(buildCase(c).job));
fs.writeFileSync(path.join(DIR, 'cases.json'), JSON.stringify({ schema: 'wonky-recover-extra-cases/1', cases: CASES }, null, 1) + '\n');
const uptime = () => spawnSync('uptime', { encoding: 'utf8' }).stdout.trim();
const meta = { startedAt: new Date().toISOString(), uptimeStart: uptime() };
const oracle = spawnSync('uv', ['run', '--quiet', 'scripts/bakeoff/recover-extra.py', DIR], { cwd: ROOT, encoding: 'utf8' });
process.stdout.write(oracle.stdout);
if (oracle.status !== 0) throw new Error(`recover-extra.py failed: ${oracle.stderr.slice(-2000)}`);
const reference = JSON.parse(fs.readFileSync(path.join(DIR, 'reference.json'), 'utf8')).cases;
const nativeBin = path.join(ROOT, 'out/bakeoff/recover/build/cpu');
const native = !argv.includes('--js') && fs.existsSync(nativeBin);
const mod = native ? null : await loadBend(path.join(ROOT, 'kernel/proto/recover/main.bend'));
const kernel = await loadKernel();
fs.mkdirSync(path.join(DIR, 'recovered'), { recursive: true });
const rows = [];
for (const c of CASES) {
  const input = fs.readFileSync(path.join(DIR, 'jobs', `${c.id}.job`), 'utf8') + fs.readFileSync(path.join(DIR, 'results', `${c.id}.result`), 'utf8');
  let text, ms;
  if (native) {
    const inFile = path.join(DIR, 'recovered', `${c.id}.in`), outFile = path.join(DIR, 'recovered', `${c.id}.result`);
    fs.writeFileSync(inFile, input);
    const r = spawnSync(nativeBin, ['--threads', '1', '--gpu', 'off', '--', inFile, outFile], { encoding: 'utf8', env: { ...process.env, BEND_NO_TELEMETRY: '1' }, timeout: 600000 });
    if (r.status !== 0) { rows.push({ id: c.id, status: 'invalid', error: `native run failed: ${(r.stderr || String(r.error)).slice(-400)}` }); continue; }
    ms = JSON.parse(r.stdout.trim().split('\n').pop()).computeMs;
    text = fs.readFileSync(outFile, 'utf8');
    fs.rmSync(inFile);
  } else {
    const t0 = performance.now();
    text = mod.run(input);
    ms = performance.now() - t0;
  }
  const row = { id: c.id, note: c.note, computeMs: ms, target: native ? 'cpu1' : 'js' };
  try { Object.assign(row, await exportRecovered(text, c.id, path.join(DIR, 'step', c.id), kernel)); }
  catch (err) { row.status = 'invalid'; row.error = err.message; }
  rows.push(row);
}
const exported = rows.filter(r => r.status === 'ok' && !r.empty);
if (!argv.includes('--no-occt') && exported.length) {
  const occ = await occtCheck(exported.map(r => path.join(DIR, 'step', `${r.id}.step`)));
  for (const [i, r] of exported.entries()) {
    const o = occ[i], ref = reference[r.id]?.occt;
    r.occt = o;
    const vs = await validateStep(path.join(DIR, 'step', r.id));
    r.validateStep = vs.ok ? { ok: true } : (refinementOk(r, o) ?? vs);
    if (ref && !o.error) r.exact = { volumeRelErr: Math.abs(o.volume - ref.volume) / ref.volume, areaRelErr: Math.abs(o.area - ref.area) / ref.area, solidsMatch: o.solids === ref.solids, occtCsgVolume: ref.volume };
  }
}
for (const r of rows) {
  if (r.status === 'unresolved') r.verdict = 'unresolved';
  else if (r.status !== 'ok') r.verdict = 'invalid';
  else if (!r.occt) r.verdict = 'recovered';
  else if (r.occt.error || !r.occt.valid || !r.validateStep?.ok) r.verdict = 'invalid-step';
  else r.verdict = r.exact && r.exact.volumeRelErr < 1e-7 && r.exact.areaRelErr < 1e-7 && r.exact.solidsMatch ? 'exact' : 'mismatch';
}
meta.endedAt = new Date().toISOString(); meta.uptimeEnd = uptime();
fs.writeFileSync(path.join(ROOT, 'out/corpus/cluster-fs-missing-builtin-recover.json'), JSON.stringify({ schema: 'wonky-corpus-recover-next/1', meta, rows }, null, 1) + '\n');
for (const r of rows) console.log(`${r.id}: ${r.verdict} ${r.topology ? `F/E/V ${r.topology.faces}/${r.topology.edges}/${r.topology.vertices}` : ''} ${r.exact ? `dV ${r.exact.volumeRelErr.toExponential(1)}` : ''} ${r.reason ?? r.error ?? r.validateStep?.error ?? ''} ${r.computeMs?.toFixed?.(1) ?? ''} ms`);
