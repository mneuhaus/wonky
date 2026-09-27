// Overlap check with the Boolean bake-off (corpus analysis only, read-only use
// of scripts/bakeoff and kernel/proto/recover): would the `recover` route
// build the Boolean chains that cluster files hit once the build123d API gap
// is closed? cad-project-025/beam_frame.py frame(7, 5) in both variants
// (optimize=False and the default optimize=True), the E10/E12 parts of
// cad-project-041/single-step-r10/jobs/endstop/geometry.py and the first Boolean
// that cad-project-013/sanding_head_v3.py reaches (line 255), written as bake-off
// CSG trees with the files' own values.
//
//   node scripts/corpus/py-api-surface/recover-next.mjs [--js] [--cases a,b] [--no-occt]
//
// Pipeline (the same one scripts/bakeoff/recover-extra.mjs runs, with its own
// directory tmp/corpus/py-api-surface/recover instead of out/bakeoff):
//   1. job: bake-off fixture tessellation (fixtures.mjs buildCase)
//   2. input: uv run scripts/bakeoff/recover-extra.py <dir> (manifold3d mesh
//      Boolean with face provenance = TEST INPUT; OCCT exact CSG = oracle)
//   3. recovery in Bend: kernel/proto/recover (native cpu1 build if present, else JS)
//   4. check: STEP export, OpenCascade validity + volume against the oracle
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadKernel } from '../../../src/kernel.mjs';
import { loadBend } from '../../../src/bend-loader.mjs';
import { ROOT, buildCase } from '../../bakeoff/fixtures.mjs';
import { encodeJob } from '../../bakeoff/jobfmt.mjs';
import { exportRecovered, occtCheck, validateStep, refinementOk } from '../../bakeoff/recover-check.mjs';

const DIR = path.join(ROOT, 'tmp/corpus/py-api-surface/recover');
const argv = process.argv.slice(2);
const only = argv.includes('--cases') ? argv[argv.indexOf('--cases') + 1].split(',') : null;

// beam_frame.py donor values
const PITCH = 8, GAP = 0.4, H = 7.6, BEAM_W = 7.6, HOLE_D = 4.94, CBORE_D = 6.4, CBORE_DEPTH = 0.9, R = BEAM_W / 2;
const MX = 7, MY = 5, OX = MX * PITCH - GAP, OY = MY * PITCH - GAP, CX = (MX - 1) * PITCH / 2, CY = (MY - 1) * PITCH / 2;
const cyl = (radius, height, translate = [0, 0, 0], rotate = []) => ({ prim: 'cylinder', params: { radius, height }, transform: { rotate, translate } });
const box = (min, max) => ({ prim: 'box', params: { min, max }, transform: { rotate: [], translate: [0, 0, 0] } });
const op = (o, ...xs) => xs.reduce((a, b) => ({ op: o, children: [a, b] }));

// RectangleRounded(OX, OY, R) extruded H: two crossing boxes plus four corner cylinders.
const rounded = op('union', box([-OX / 2, -CY, 0], [OX / 2, CY, H]), box([-CX, -OY / 2, 0], [CX, OY / 2, H]),
  ...[[-CX, -CY], [CX, -CY], [-CX, CY], [CX, CY]].map(([x, y]) => cyl(R, H, [x, y, 0])));
const opening = box([-OX / 2 + BEAM_W, -OY / 2 + BEAM_W, -1], [OX / 2 - BEAM_W, OY / 2 - BEAM_W, H + 1]);
const verticals = [];
for (let i = 0; i < MX; i += 2) for (const sy of [1, -1]) verticals.push([-CX + i * PITCH, sy * CY]);
// _vertical_hole_cutter(bridged=False): bore H+1 centred at H/2, counterbores CBORE_DEPTH+0.5 at both ends
const vertical = ([x, y]) => op('union', cyl(HOLE_D / 2, H + 1, [x, y, -0.5]),
  cyl(CBORE_D / 2, CBORE_DEPTH + 0.5, [x, y, CBORE_DEPTH / 2 - 0.25 - (CBORE_DEPTH + 0.5) / 2]),
  cyl(CBORE_D / 2, CBORE_DEPTH + 0.5, [x, y, H - CBORE_DEPTH / 2 + 0.25 - (CBORE_DEPTH + 0.5) / 2]));
// _side_hole_cutter(teardrop=False) along Y (long edges, odd x) or X (short edges): bore through one
// beam plus a counterbore at its outer and inner face (lengths as in the file)
const side = (axis, along, sign, outerHalf) => {
  const beamC = sign * (outerHalf - BEAM_W / 2);
  const parts = [[HOLE_D / 2, BEAM_W + 1, beamC]];
  for (const [face, inward] of [[outerHalf, -1], [outerHalf - BEAM_W, 1]]) parts.push([CBORE_D / 2, CBORE_DEPTH + 0.5, sign * (face + inward * (CBORE_DEPTH - 0.5) / 2)]);
  // cylinder leaves run +Z from z=0; rotate to the bore axis, centre them on c
  return op('union', ...parts.map(([r, len, c]) => axis === 'y'
    ? cyl(r, len, [along, c + len / 2, H / 2], [{ axis: 'x', deg: 90 }])
    : cyl(r, len, [c - len / 2, along, H / 2], [{ axis: 'y', deg: 90 }])));
};
const sides = [];
for (let i = 1; i < MX; i += 2) for (const sy of [1, -1]) sides.push(side('y', -CX + i * PITCH, sy, OY / 2));
for (let j = 1; j < MY - 1; j++) for (const sx of [1, -1]) sides.push(side('x', -CY + j * PITCH, sx, OX / 2));

// optimize=True: bridged vertical cutters (two crossed stadium slabs, Cylinder & Box, at both
// counterbore floors) and teardrop side bores (Circle + 45-degree Polygon roof, apex +Z)
const SLAB_T = 0.3, SLOT_W = HOLE_D + 0.02;
const prism = (points, height, translate, rotate) => ({ prim: 'prism', params: { points, height }, transform: { rotate, translate } });
const bridged = ([x, y]) => {
  const slabs = [];
  for (const [zRef, dir] of [[CBORE_DEPTH, 1], [H - CBORE_DEPTH, -1]]) for (const [i, alongX] of [[0, true], [1, false]]) {
    const zc = zRef + dir * (SLAB_T / 2 + i * SLAB_T), hx = (alongX ? CBORE_D + 1 : SLOT_W) / 2, hy = (alongX ? SLOT_W : CBORE_D + 1) / 2;
    slabs.push(op('intersect', cyl(CBORE_D / 2, SLAB_T, [x, y, zc - SLAB_T / 2]), box([x - hx, y - hy, zc - SLAB_T / 2], [x + hx, y + hy, zc + SLAB_T / 2])));
  }
  return op('union', vertical([x, y]), ...slabs);
};
const teardropSide = (axis, along, sign, outerHalf) => {
  const beamC = sign * (outerHalf - BEAM_W / 2);
  const parts = [[HOLE_D / 2, BEAM_W + 1, beamC]];
  for (const [face, inward] of [[outerHalf, -1], [outerHalf - BEAM_W, 1]]) parts.push([CBORE_D / 2, CBORE_DEPTH + 0.5, sign * (face + inward * (CBORE_DEPTH - 0.5) / 2)]);
  const leaf = ([r, len, c]) => {
    const t = r / Math.SQRT2, f = r * (Math.SQRT2 - 1);
    const roof = [[-t, t], [t, t], [f, r], [-f, r]];
    // sketch y (apex) -> world +Z; extrusion +Z -> world -Y (Rot(90,0,0)), then Rot(0,0,-90) for the X case
    return axis === 'y'
      ? op('union', cyl(r, len, [along, c + len / 2, H / 2], [{ axis: 'x', deg: 90 }]), prism(roof, len, [along, c + len / 2, H / 2], [{ axis: 'x', deg: 90 }]))
      : op('union', cyl(r, len, [c + len / 2, along, H / 2], [{ axis: 'x', deg: 90 }, { axis: 'z', deg: -90 }]), prism(roof, len, [c + len / 2, along, H / 2], [{ axis: 'x', deg: 90 }, { axis: 'z', deg: -90 }]));
  };
  return op('union', ...parts.map(leaf));
};
const tsides = [];
for (let i = 1; i < MX; i += 2) for (const sy of [1, -1]) tsides.push(teardropSide('y', -CX + i * PITCH, sy, OY / 2));
for (let j = 1; j < MY - 1; j++) for (const sx of [1, -1]) tsides.push(teardropSide('x', -CY + j * PITCH, sx, OX / 2));

const frameOpen = op('subtract', rounded, opening);
const CASES = [
  { id: 'beam-rounded-outline', note: 'RectangleRounded(55.6, 39.6, 3.8) extruded 7.6 mm (G1 plane/cylinder edges)', csg: rounded },
  { id: 'beam-rounded-open', note: 'rounded outline minus the centre opening (audit: fails in the FS port)', csg: frameOpen },
  { id: 'beam-open-one-bore', note: '... minus the first vertical bore with both counterbores (audit: fails in the FS port)', csg: op('subtract', frameOpen, vertical(verticals[0])) },
  { id: 'beam-frame-plain', note: 'frame(7, 5, optimize=False): opening, 8 vertical and 12 sideways counterbored bores', csg: op('subtract', frameOpen, ...verticals.map(vertical), ...sides) },
  { id: 'beam-one-teardrop', note: 'rounded open frame minus one teardrop side bore with counterbores (Circle + Polygon roof, tangent flanks)', csg: op('subtract', frameOpen, tsides[0]) },
  { id: 'beam-one-bridged', note: 'rounded open frame minus one bridged vertical cutter (stadium slabs Cylinder & Box)', csg: op('subtract', frameOpen, bridged(verticals[0])) },
  { id: 'beam-frame-optimized', note: 'frame(7, 5, optimize=True), the default print variant', csg: op('subtract', frameOpen, ...verticals.map(bridged), ...tsides) },
  // cad-project-041/single-step-r10/jobs/endstop/geometry.py build(): E10 bracket and one E12 boss
  // (Solid.make_box from a corner, Solid.make_cylinder along +Y from its base point)
  { id: 'endstop-e10-bracket', note: 'box minus two stadium slots (box + 2 parallel cylinders), plus two bosses with blind pilot holes, all axes along Y',
    csg: (() => {
      const yCyl = (p, r, h) => cyl(r, h, p, [{ axis: 'x', deg: -90 }]);
      const slot = x => op('union', box([x - 1.7, 10.9, -198], [x + 1.7, 15.1, -194]), yCyl([x, 10.9, -198], 1.7, 4.2), yCyl([x, 10.9, -194], 1.7, 4.2));
      let b = op('subtract', box([-91, 11, -208], [-47, 15, -188]), slot(-86), slot(-52));
      for (const x of [-76.5, -61.5]) b = op('subtract', op('union', b, yCyl([x, 7.6, -203.5], 3.2, 3.5)), yCyl([x, 7.5, -203.5], 1.05, 5.2));
      return b;
    })() },
  { id: 'endstop-e12-boss', note: 'boss cylinder minus a coaxial blind pilot from below (production coaxial path)',
    csg: op('subtract', cyl(5, 14, [-86, 15, -196], [{ axis: 'x', deg: -90 }]), cyl(1.31, 10.7, [-86, 14.9, -196], [{ axis: 'x', deg: -90 }])) },
  // sanding_head_v3.py:249-259:annulus(BODY_D, BODY_BORE_D, TOP_CAP_Z - BODY_BOTTOM_Z) at BODY_BOTTOM_Z,
  // minus the coaxial index chamber Cylinder(INDEX_CHAMBER_D / 2, TOP_CAP_Z - INDEX_CHAMBER_Z + 0.2) at INDEX_CHAMBER_Z
  { id: 'sanding-v3-index-chamber', note: 'tube OD 39 / ID 31.4, z 3.8..28, minus a coaxial r16.7 chamber from z 17.5 (production: coaxial result + coaxial tool refused)',
    csg: op('subtract', op('subtract', cyl(19.5, 24.2, [0, 0, 3.8]), cyl(15.7, 24.4, [0, 0, 3.7])), cyl(16.7, 10.7, [0, 0, 17.5])) },
  // cad-project-003/project-component-abeb2fd3.py tray(), the prefix before its stage-1 next blocker (line 559), as in
  // fixtures/corpus-repro/py-api-surface/next-box-chain.py: tray box minus cavity (coplanar top), plus
  // the motor block. Production's planar arrangement returns 114 faces for this 11-face solid.
  { id: 'bristle-box-chain', note: 'tray box minus cavity box (coplanar top) plus motor block box (production: 114 faces, ~34 s CPU)',
    csg: op('union', op('subtract', box([-28, -14.72, 0], [28, 14.72, 11.78]), box([-26.32, -12.2, 1.68], [26.32, 12.2, 11.78])),
      box([8.38, -13.2, 0.5], [27, 13.2, 11.78])) },
].filter(c => !only || only.includes(c.id)).map(c => ({ category: 'corpus-py-api-surface', fdmRationale: c.note, deviationMm: 0.01, expect: 'exact', ...c }));

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
fs.mkdirSync(path.join(ROOT, 'out/corpus/py-api-surface'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'out/corpus/py-api-surface/recover-next.json'), JSON.stringify({ schema: 'wonky-corpus-recover-next/1', meta, rows }, null, 1) + '\n');
for (const r of rows) console.log(`${r.id}: ${r.verdict} ${r.topology ? `F/E/V ${r.topology.faces}/${r.topology.edges}/${r.topology.vertices}` : ''} ${r.exact ? `dV ${r.exact.volumeRelErr.toExponential(1)}` : ''} ${r.reason ?? r.error ?? r.validateStep?.error ?? ''} ${r.computeMs?.toFixed?.(1) ?? ''} ms`);
