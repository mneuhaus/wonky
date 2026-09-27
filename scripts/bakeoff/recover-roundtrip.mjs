#!/usr/bin/env node
// Boolean bake-off TEST INFRASTRUCTURE for the "recover" prototype: round trip
// exact kernel bodies -> tagged watertight print mesh -> Bend recovery ->
// exact B-rep, compared with the original.
//
//   node scripts/bakeoff/recover-roundtrip.mjs [--ids a,b] [--no-occt] [--native]
//
// Bodies are built by the existing kernel (FeatureScript through src/index.mjs,
// revolveInBend); meshing is src/print-mesh.mjs with per-triangle face tags;
// this file only welds equal coordinates, writes the recover input in the
// bake-off job format (one frozen `brep` leaf whose face table is the body's
// own surfaces) and compares. The recovery itself runs in Bend (JS target by
// default, or the native binary with --native). OpenCascade reads both STEP
// files as an independent oracle.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../../src/index.mjs';
import { loadKernel } from '../../src/kernel.mjs';
import { revolveInBend } from '../../src/analytic.mjs';
import { printMesh } from '../../src/print-mesh.mjs';
import { toStep } from '../../src/exporters.mjs';
import { loadBend } from '../../src/bend-loader.mjs';
import { ROOT } from './fixtures.mjs';
import { encodeJob, encodeResult } from './jobfmt.mjs';
import { exportRecovered, occtCheck, validateStep } from './recover-check.mjs';

const { version: BEND_VERSION } = JSON.parse(fs.readFileSync(path.join(ROOT, 'bend.lock.json'), 'utf8'));
export const OUT = path.join(ROOT, 'out/bakeoff/recover/roundtrip');
export const DEVIATION = 0.01;

const header = 'FeatureScript 3044;\nimport(path : "onshape/std/geometry.fs", version : "3044.0");\n';
const plate = ({ w = 40, d = 30, h = 5, holes = [[0, 0, 4]] } = {}) => `${header}
export function part(context is Context, id is Id, definition is map)
{
    var p = newSketchOnPlane(context, id + "p", { "sketchPlane" : plane(vector(0,0,0)*millimeter, vector(0,0,1)) });
    skRectangle(p, "r", { "firstCorner" : vector(${-w / 2},${-d / 2})*millimeter, "secondCorner" : vector(${w / 2},${d / 2})*millimeter });
    skSolve(p);
    opExtrude(context, id + "plate", { "entities" : qSketchRegion(id + "p"),
        "direction" : vector(0,0,1), "endBound" : BoundingType.BLIND, "endDepth" : ${h}*millimeter });
${holes.map(([x, y, r], i) => `    var t${i} = newSketchOnPlane(context, id + "t${i}", { "sketchPlane" : plane(vector(0,0,-1)*millimeter, vector(0,0,1)) });
    skCircle(t${i}, "c", { "center" : vector(${x},${y})*millimeter, "radius" : ${r}*millimeter });
    skSolve(t${i});
    opExtrude(context, id + "tool${i}", { "entities" : qSketchRegion(id + "t${i}"),
        "direction" : vector(0,0,1), "endBound" : BoundingType.BLIND, "endDepth" : ${h + 3}*millimeter });
    opBoolean(context, id + "bore${i}", { "targets" : qCreatedBy(id + "${i ? `bore${i - 1}` : 'plate'}", EntityType.BODY),
        "tools" : qCreatedBy(id + "tool${i}", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });`).join('\n')}
}`;

const revolve = (kernel, id, profile) => revolveInBend(kernel, id, profile, [0, 0, 0], [0, 0, 1], [1, 0, 0], 1e-7);
const example = (file, feature) => async () => (await build(fs.readFileSync(path.join(ROOT, 'examples', file), 'utf8'), feature ? { feature } : {})).bodies;

// id -> () => bodies (exact kernel geometry, never constructed here).
export const ROUNDTRIP = {
  'rt-box': example('box.fs'),
  'rt-bracket': example('bracket.fs'),
  'rt-tilted-plate': example('tilted-plate.fs'),
  'rt-compare-before': example('compare-before.fs', 'part'),
  'rt-compare-after': example('compare-after.fs', 'part'),
  'rt-bored-spacer': example('bored-spacer.fs', 'boredSpacer'),
  'rt-conical-spacer': example('conical-spacer.fs', 'main'),
  'rt-plate-hole': async () => (await build(plate(), { feature: 'part' })).bodies,
  'rt-plate-4-holes': async () => (await build(plate({ w: 60, d: 40, h: 4, holes: [[-22, -13, 2.1], [22, -13, 2.1], [22, 13, 2.1], [-22, 13, 2.1]] }), { feature: 'part' })).bodies,
  'rt-plate-9-holes': async () => (await build(plate({ w: 60, d: 60, h: 3, holes: [-20, 0, 20].flatMap((x) => [-20, 0, 20].map((y) => [x, y, 1.6 + (x + 20) / 40])) }), { feature: 'part' })).bodies,
  'rt-revolve-tube': async (k) => [revolve(k, 'rt-revolve-tube', [[2, 0], [5, 0], [5, 8], [2, 8]])],
  'rt-revolve-groove': async (k) => [revolve(k, 'rt-revolve-groove', [[3, 0], [8, 0], [8, 3], [6, 4], [6, 6], [8, 7], [8, 10], [3, 10]])],
  'rt-revolve-taper': async (k) => [revolve(k, 'rt-revolve-taper', [[2, 0], [5, 0], [3, 6], [2.5, 6]])],
};

function wireSurface(s) {
  if (s.type === 'plane') return { type: 'plane', o: s.origin, n: s.normal, x: s.x };
  if (s.type === 'cylinder') return { type: 'cylinder', o: s.origin, n: s.axis, x: s.x, r: s.radius };
  if (s.type === 'cone') return { type: 'cone', o: s.origin, n: s.axis, x: s.x, r: s.radius, a: s.angle };
  throw new Error(`round trip: surface ${s.type} has no wire form`);
}

// Job (one brep leaf whose face table is the body's surfaces) and tagged
// result mesh for one body, as objects (tests mutate them before encoding).
export function roundTripParts(kernel, body, id) {
  const mesh = printMesh(kernel, body, DEVIATION, { tags: true });
  const index = new Map(), vertices = [];
  const vid = (p) => {
    const key = p.join(',');
    if (!index.has(key)) { index.set(key, vertices.length); vertices.push(p); }
    return index.get(key);
  };
  const triangles = mesh.triangles.map((t, i) => [...t.map(vid), mesh.tags[i]]);
  const job = {
    id, deviation: DEVIATION, tree: { leaf: 0 },
    prims: [{ kind: 'brep', params: [], matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0] }],
    faces: body.faces.map((f, i) => ({ leaf: 0, faceIndex: i, surface: wireSurface(f.surface) })),
    meshes: [{ leaf: 0, vertices, triangles }],
  };
  return { job, result: { status: 'ok', mesh: { vertices, triangles } }, achievedDeviationMm: mesh.achievedDeviationMm };
}

export const recoverText = ({ job, result }) => encodeJob(job) + encodeResult(result);

// Recover input text for one body: job + tagged result mesh.
export function roundTripInput(kernel, body, id) {
  const parts = roundTripParts(kernel, body, id);
  return { text: recoverText(parts), triangles: parts.result.mesh.triangles.length, achievedDeviationMm: parts.achievedDeviationMm };
}

const tally = (xs) => xs.reduce((m, x) => ({ ...m, [x]: (m[x] ?? 0) + 1 }), {});
const surfaceKey = (s) => `${s.type}${s.radius !== undefined ? ` r${+s.radius.toFixed(9)}` : ''}${s.angle !== undefined ? ` a${+s.angle.toFixed(9)}` : ''}`;
const curveKey = (c) => `${c.type}${c.radius !== undefined ? ` r${+c.radius.toFixed(9)}` : ''}${c.major !== undefined ? ` ${+c.major.toFixed(9)}x${+c.minor.toFixed(9)}` : ''}`;

export async function runRoundTrip({ ids = Object.keys(ROUNDTRIP), occt = true, native = false } = {}) {
  const kernel = await loadKernel();
  const mod = native ? null : await loadBend(path.join(ROOT, 'kernel/proto/recover/main.bend'));
  const bin = path.join(ROOT, 'out/bakeoff/recover/build/cpu');
  fs.mkdirSync(OUT, { recursive: true });
  const rows = [];
  for (const id of ids) {
    const row = { id };
    try {
      const bodies = await ROUNDTRIP[id](kernel);
      if (bodies.length !== 1) throw new Error(`expected one body, got ${bodies.length}`);
      const original = bodies[0];
      const input = roundTripInput(kernel, original, id);
      const inFile = path.join(OUT, `${id}.recover.job`), outFile = path.join(OUT, `${id}.result`);
      fs.writeFileSync(inFile, input.text);
      const t0 = performance.now();
      let text;
      if (native) {
        const r = spawnSync(bin, ['--threads', '1', '--gpu', 'off', '--', inFile, outFile], { env: { ...process.env, BEND_NO_TELEMETRY: '1' } });
        if (r.status !== 0) throw new Error(`native recover failed: ${r.stderr}`);
        text = fs.readFileSync(outFile, 'utf8');
      } else {
        text = mod.run(input.text);
        fs.writeFileSync(outFile, text);
      }
      row.recoverMs = performance.now() - t0;
      row.triangles = input.triangles;
      const model = { schema: 'wonky-brep/1', units: 'millimeter', backend: { language: 'Bend', version: BEND_VERSION, target: 'JavaScript', precision: 'F32x2' }, bodies: [original] };
      fs.writeFileSync(path.join(OUT, `${id}.original.step`), toStep(model, id));
      Object.assign(row, await exportRecovered(text, id, path.join(OUT, id), kernel));
      row.original = {
        topology: { vertices: original.vertices.length, edges: original.edges.length, faces: original.faces.length },
        surfaces: tally(original.faces.map((f) => surfaceKey(f.surface))),
        curves: tally(original.edges.filter((e) => typeof e.curve === 'object').map((e) => curveKey(e.curve))),
        kernelVolumeMm3: original.validation?.volumeMm3 ?? null,
        precision: original.precision ?? 'F32',
      };
      if (row.status === 'ok') {
        const rec = JSON.parse(fs.readFileSync(path.join(OUT, `${id}.brep.json`), 'utf8')).bodies;
        row.recovered = {
          surfaces: tally(rec.flatMap((b) => b.faces.map((f) => surfaceKey(f.surface)))),
          curves: tally(rec.flatMap((b) => b.edges.map((e) => curveKey(e.curve)))),
        };
        // Periodic seams and implicit polyhedral lines are bookkeeping; compare
        // the analytic surfaces exactly and the non-line curve families.
        const nonLine = (m) => Object.fromEntries(Object.entries(m).filter(([k]) => !k.startsWith('line')));
        const same = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
        row.surfacesMatch = same(row.recovered.surfaces, row.original.surfaces);
        row.curvesMatch = same(nonLine(row.recovered.curves), nonLine(row.original.curves));
        row.facesMatch = row.topology.faces === row.original.topology.faces;
      }
    } catch (err) {
      row.status = 'error';
      row.error = err.message;
    }
    rows.push(row);
  }
  if (occt) {
    const ok = rows.filter((r) => r.status === 'ok');
    const occ = await occtCheck(ok.flatMap((r) => [path.join(OUT, `${r.id}.step`), path.join(OUT, `${r.id}.original.step`)]));
    for (const [i, r] of ok.entries()) {
      const [a, b] = [occ[2 * i], occ[2 * i + 1]];
      r.occt = { recovered: a, original: b };
      if (!a.error && !b.error) {
        r.volumeRelErr = Math.abs(a.volume - b.volume) / b.volume;
        r.areaRelErr = Math.abs(a.area - b.area) / b.area;
        if (r.original.kernelVolumeMm3) r.volumeRelErrVsKernel = Math.abs(a.volume - r.original.kernelVolumeMm3) / r.original.kernelVolumeMm3;
      }
      const v = await validateStep(path.join(OUT, r.id));
      r.validateStep = v.ok ? { ok: true } : v;
    }
  }
  for (const r of rows) {
    // F32 polyhedral sources (topology.bend extrusions) store vertices that sit
    // ~1e-6 mm off their own F32 planes; recovery intersects the planes
    // exactly, so the two exact models may differ at that level.
    r.tolerance = r.original?.precision === 'F32x2' ? 1e-9 : 1e-6;
    r.verdict = r.status !== 'ok' ? r.status
      : !occt ? 'recovered'
        : r.occt?.recovered?.valid && r.occt?.recovered?.interferenceFree !== false && r.validateStep?.ok && r.volumeRelErr < r.tolerance && r.areaRelErr < r.tolerance && r.surfacesMatch && r.curvesMatch && r.facesMatch ? 'exact' : 'mismatch';
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ schema: 'wonky-recover-roundtrip/1', capturedAt: new Date().toISOString(), deviationMm: DEVIATION, native, rows }, null, 1) + '\n');
  return rows;
}

async function main(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--ids') opts.ids = argv[++i].split(',');
    else if (argv[i] === '--no-occt') opts.occt = false;
    else if (argv[i] === '--native') opts.native = true;
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  const rows = await runRoundTrip(opts);
  const L = ['| body | source precision | verdict | tris | faces (orig/rec) | surfaces | non-line curves | OCCT volume rel err | area rel err | vs kernel volume | recover ms | reason |', '|---|---|---|---|---|---|---|---|---|---|---|---|'];
  const e1 = (x) => (x === undefined || x === null ? '-' : x.toExponential(1));
  for (const r of rows) {
    L.push(`| ${r.id} | ${r.original?.precision ?? '-'} | ${r.verdict} | ${r.triangles ?? '-'} | ${r.original?.topology.faces ?? '-'}/${r.topology?.faces ?? '-'} | ${r.surfacesMatch === undefined ? '-' : r.surfacesMatch ? 'match' : 'DIFF'} | ${r.curvesMatch === undefined ? '-' : r.curvesMatch ? 'match' : 'DIFF'} | ${e1(r.volumeRelErr)} | ${e1(r.areaRelErr)} | ${e1(r.volumeRelErrVsKernel)} | ${r.recoverMs?.toFixed(1) ?? '-'} | ${(r.reason ?? r.error ?? r.validateStep?.error ?? '').slice(0, 100)} |`);
  }
  fs.writeFileSync(path.join(OUT, 'report.md'), L.join('\n') + '\n');
  console.log(L.join('\n'));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((err) => { console.error(err.stack ?? err.message); process.exit(1); });
}
