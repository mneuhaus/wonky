#!/usr/bin/env node
// Boolean bake-off TEST INFRASTRUCTURE for the "recover" prototype: extra
// recovery cases beyond the shared corpus (fixtures/bakeoff/cases.json is
// owned by the harness), aimed at face topologies a general Boolean produces
// in FDM parts: periodic faces with holes (a window through a tube wall), band
// rims with vertices (a slot across a round boss), partial cylinders (D
// shaft), spherical faces bounded by arcs with vertices, sphere and torus
// bands, and named refusals (spiric torus sections, cross holes).
//
//   node scripts/bakeoff/recover-extra.mjs [--cases a,b] [--native] [--no-occt] [--no-oracle]
//
// Steps (all geometry of the recovery runs in Bend; this file coordinates):
//   1. jobs: the harness's own fixture tessellation (fixtures.mjs buildCase)
//      -> out/bakeoff/recover/extra/jobs/<id>.job
//   2. inputs: uv run scripts/bakeoff/recover-extra.py (manifold3d Boolean of
//      those meshes with face provenance = TEST INPUT; OCCT exact CSG oracle)
//   3. recovery: kernel/proto/recover on the JS target (or the native binary)
//   4. check: STEP export and OpenCascade, as scripts/bakeoff/recover-check.mjs

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadKernel } from '../../src/kernel.mjs';
import { loadBend } from '../../src/bend-loader.mjs';
import { ROOT, buildCase } from './fixtures.mjs';
import { encodeJob } from './jobfmt.mjs';
import { exportRecovered, occtCheck, validateStep, refinementOk } from './recover-check.mjs';

export const EXTRA_DIR = path.join(ROOT, 'out/bakeoff/recover/extra');

const cyl = (radius, height, translate = [0, 0, 0], rotate = []) => ({ prim: 'cylinder', params: { radius, height }, transform: { rotate, translate } });
const box = (min, max, rotate = []) => ({ prim: 'box', params: { min, max }, transform: { rotate, translate: [0, 0, 0] } });
const sphere = (radius, translate = [0, 0, 0]) => ({ prim: 'sphere', params: { radius }, transform: { rotate: [], translate } });
const torus = (major, minor) => ({ prim: 'torus', params: { major, minor }, transform: { rotate: [], translate: [0, 0, 0] } });
const cone = (r1, r2, height, translate = [0, 0, 0]) => ({ prim: 'cone', params: { r1, r2, height }, transform: { rotate: [], translate } });
const op = (o, a, b) => ({ op: o, children: [a, b] });
const tube = (ro, ri, h) => op('subtract', cyl(ro, h), cyl(ri, h + 2, [0, 0, -1]));

// expect: the verdict the case must reach ('exact': recovered, OCCT-valid with
// exact CurveOnSurface, volume and area within 1e-7 of the OCCT CSG) or a
// RegExp the refusal reason must match.
export const EXTRA_CASES = [
  { id: 'x-tube-window', note: 'rectangular window through a tube wall across the default seam generator: cylinder faces with a hole', csg: op('subtract', tube(10, 8, 30), box([5, -4, 10], [12, 4, 20])), expect: 'exact' },
  { id: 'x-tube-window-y', note: 'the same window on the +y side (seam generator free)', csg: op('subtract', tube(10, 8, 30), box([-4, 5, 10], [4, 12, 20])), expect: 'exact' },
  { id: 'x-boss-slot', note: 'slot across a round boss: the band rim carries vertices', csg: op('subtract', cyl(6, 12), box([-7, -1.5, 8], [7, 1.5, 13])), expect: 'exact' },
  { id: 'x-d-shaft', note: 'D shaft: a flat on a shaft (partial cylinder)', csg: op('subtract', cyl(4, 20), box([3, -5, -1], [5, 5, 21])), expect: 'exact' },
  { id: 'x-sphere-octant', note: 'sphere minus an octant: spherical face bounded by three arcs with vertices', csg: op('subtract', sphere(10), box([0, 0, 0], [11, 11, 11])), expect: 'valid-sampled' },
  { id: 'x-sphere-band', note: 'sphere cut by two parallel planes: spherical band with a meridian seam', csg: op('intersect', sphere(10), box([-11, -11, -6], [11, 11, 7])), expect: 'exact' },
  { id: 'x-torus-cyl', note: 'torus intersected with a coaxial cylinder: torus/cylinder circles', csg: op('intersect', torus(12, 3), cyl(12.5, 10, [0, 0, -5])), expect: 'exact' },
  { id: 'x-sphere-cone', note: 'sphere intersected with a coaxial cone: sphere/cone circle', csg: op('intersect', sphere(10), cone(2, 12, 14, [0, 0, -4])), expect: 'exact' },
  { id: 'x-torus-tilted', note: 'torus minus a tilted slab: spiric sections', csg: op('subtract', torus(12, 3), box([-20, -20, -10], [20, 20, 0], [{ axis: 'x', deg: 20 }])), expect: /spiric/ },
  { id: 'x-rod-cross-hole', note: 'cross hole through a rod: non-coaxial cylinders', csg: op('subtract', cyl(5, 30), cyl(2, 12, [-6, 0, 15], [{ axis: 'y', deg: 90 }])), expect: /quartic/ },
  { id: 'x-torus-half', note: 'U handle: a torus cut by a plane through its axis (torus band between two meridian circles)', csg: op('subtract', torus(12, 3), box([-20, -20, -5], [0, 20, 5])), expect: 'exact' },
  { id: 'x-icecream', note: 'cone whose rim lies on a ball: rim and cap fragments poke through the sphere tessellation (blister slivers)', csg: op('union', cone(2, 6, 8), sphere(6, [0, 0, 8])), expect: 'exact' },
  { id: 'x-thin-wall', note: 'bore 0.005 mm from a side face: the wall is below 2 x deviation, so the mesh cannot certify it', csg: op('subtract', box([0, 0, 0], [20, 20, 5]), cyl(3, 7, [3.005, 10, -1])), expect: /without sharing an edge or a vertex|tangency or coincidence/ },
  { id: 'x-pins-touching', note: 'two pins whose walls touch along a line: contact, refused', csg: op('union', cyl(3, 10), cyl(3, 10, [6, 0, 0])), expect: /coincide|without sharing an edge or a vertex|not a closed oriented/ },
].map((c) => ({ category: 'recover-extra', fdmRationale: c.note, deviationMm: 0.01, ...c }));

const matches = (c, row) => (typeof c.expect === 'string' ? row.verdict === c.expect : row.status === 'unresolved' && c.expect.test(row.reason ?? ''));

export function prepareJobs(cases = EXTRA_CASES) {
  fs.mkdirSync(path.join(EXTRA_DIR, 'jobs'), { recursive: true });
  for (const c of cases) fs.writeFileSync(path.join(EXTRA_DIR, 'jobs', `${c.id}.job`), encodeJob(buildCase(c).job));
  fs.writeFileSync(path.join(EXTRA_DIR, 'cases.json'), JSON.stringify({ schema: 'wonky-recover-extra-cases/1', cases: cases.map(({ expect, ...c }) => ({ ...c, expect: String(expect) })) }, null, 1) + '\n');
}

export function runOracle() {
  const r = spawnSync('uv', ['run', '--quiet', 'scripts/bakeoff/recover-extra.py', EXTRA_DIR], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`recover-extra.py failed: ${r.stderr.slice(-2000)}`);
  return r.stdout;
}

export const extraInput = (id) => fs.readFileSync(path.join(EXTRA_DIR, 'jobs', `${id}.job`), 'utf8') + fs.readFileSync(path.join(EXTRA_DIR, 'results', `${id}.result`), 'utf8');

async function main(argv) {
  const only = argv.includes('--cases') ? argv[argv.indexOf('--cases') + 1].split(',') : null;
  const cases = EXTRA_CASES.filter((c) => !only || only.includes(c.id));
  prepareJobs(EXTRA_CASES);
  if (!argv.includes('--no-oracle')) process.stdout.write(runOracle());
  const reference = JSON.parse(fs.readFileSync(path.join(EXTRA_DIR, 'reference.json'), 'utf8')).cases;
  const native = argv.includes('--native');
  const mod = native ? null : await loadBend(path.join(ROOT, 'kernel/proto/recover/main.bend'));
  const kernel = await loadKernel();
  fs.mkdirSync(path.join(EXTRA_DIR, 'recovered'), { recursive: true });
  const rows = [];
  for (const c of cases) {
    const input = extraInput(c.id);
    let text, ms;
    if (native) {
      const inFile = path.join(EXTRA_DIR, 'recovered', `${c.id}.in`), outFile = path.join(EXTRA_DIR, 'recovered', `${c.id}.result`);
      fs.writeFileSync(inFile, input);
      const r = spawnSync(path.join(ROOT, 'out/bakeoff/recover/build/cpu'), ['--threads', '1', '--gpu', 'off', '--', inFile, outFile], { encoding: 'utf8', env: { ...process.env, BEND_NO_TELEMETRY: '1' } });
      if (r.status !== 0) throw new Error(`${c.id}: native run failed ${r.stderr}`);
      ms = JSON.parse(r.stdout.trim().split('\n').pop()).computeMs;
      text = fs.readFileSync(outFile, 'utf8');
      fs.rmSync(inFile);
    } else {
      const t0 = performance.now();
      text = mod.run(input);
      ms = performance.now() - t0;
      fs.writeFileSync(path.join(EXTRA_DIR, 'recovered', `${c.id}.result`), text);
    }
    const row = { id: c.id, note: c.note, expect: String(c.expect), computeMs: ms };
    try {
      Object.assign(row, await exportRecovered(text, c.id, path.join(EXTRA_DIR, 'step', c.id), kernel));
    } catch (err) {
      row.status = 'invalid';
      row.error = err.message;
    }
    rows.push(row);
  }
  const exported = rows.filter((r) => r.status === 'ok' && !r.empty);
  if (!argv.includes('--no-occt') && exported.length) {
    const occ = await occtCheck(exported.map((r) => path.join(EXTRA_DIR, 'step', `${r.id}.step`)));
    for (const [i, r] of exported.entries()) {
      const o = occ[i], ref = reference[r.id]?.occt;
      r.occt = o;
      const vs = await validateStep(path.join(EXTRA_DIR, 'step', r.id));
      r.validateStep = vs.ok ? { ok: true } : (refinementOk(r, o) ?? vs);
      if (ref && !o.error) r.exact = { volumeRelErr: Math.abs(o.volume - ref.volume) / ref.volume, areaRelErr: Math.abs(o.area - ref.area) / ref.area, solidsMatch: o.solids === ref.solids };
    }
  }
  for (const r of rows) {
    if (r.status === 'unresolved') r.verdict = 'unresolved';
    else if (r.status !== 'ok') r.verdict = 'invalid';
    else if (!r.occt) r.verdict = 'recovered';
    // Valid only under the sampled CurveOnSurface check: the STEP reader had to
    // approximate parameter curves (e.g. oblique great-circle arcs on a sphere).
    else if (!r.occt.error && !r.occt.valid && r.occt.validSampled) r.verdict = r.exact?.volumeRelErr < 1e-6 ? 'valid-sampled' : 'mismatch';
    else if (r.occt.error || !r.occt.valid || !r.validateStep?.ok) r.verdict = 'invalid-step';
    else if (r.occt.interferenceFree === false) r.verdict = 'invalid-interference';
    else r.verdict = r.exact && r.exact.volumeRelErr < 1e-7 && r.exact.areaRelErr < 1e-7 && r.exact.solidsMatch ? 'exact' : 'mismatch';
    r.asExpected = matches(cases.find((c) => c.id === r.id), r);
  }
  const e1 = (x) => (x === undefined || x === null ? '-' : x.toExponential(1));
  const L = ['| case | verdict | as expected | F/E/V | surfaces | curves | OCCT vol err vs exact CSG | area err | STEP check | compute ms | reason |', '|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const r of rows) {
    const t = r.topology ? `${r.topology.faces}/${r.topology.edges}/${r.topology.vertices}` : '-';
    const s = r.surfaces ? Object.entries(r.surfaces).map(([k, v]) => `${k} ${v}`).join(', ') : '-';
    const cv = r.curves ? Object.entries(r.curves).map(([k, v]) => `${k} ${v}`).join(', ') : '-';
    const step = r.validateStep ? (r.validateStep.ok ? (r.validateStep.refinement ? `ok (${r.validateStep.refinement})` : 'ok') : 'FAIL') : '-';
    L.push(`| ${r.id} | ${r.verdict} | ${r.asExpected ? 'yes' : 'NO'} | ${t} | ${s} | ${cv} | ${e1(r.exact?.volumeRelErr)} | ${e1(r.exact?.areaRelErr)} | ${step} | ${r.computeMs.toFixed(1)} | ${(r.reason ?? r.error ?? r.validateStep?.error ?? '').slice(0, 110)} |`);
  }
  fs.writeFileSync(path.join(EXTRA_DIR, 'report.json'), JSON.stringify({ schema: 'wonky-recover-extra/1', capturedAt: new Date().toISOString(), target: native ? 'cpu1' : 'js', rows }, null, 1) + '\n');
  fs.writeFileSync(path.join(EXTRA_DIR, 'report.md'), L.join('\n') + '\n');
  console.log(L.join('\n'));
  if (rows.some((r) => !r.asExpected)) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((err) => { console.error(err.stack ?? err.message); process.exit(1); });
}
