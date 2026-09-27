#!/usr/bin/env node
// Boolean bake-off TEST INFRASTRUCTURE: checks the B-reps recovered by the
// "recover" prototype (kernel/proto/recover). For every case result it
//   1. decodes the recovered B-rep (scripts/bakeoff/recover-brep.mjs),
//   2. validates each body with the kernel's own validateAnalytic (closed
//      oriented 2-manifold boundary graph, analytic endpoint incidence in Bend),
//   3. exports exact STEP with the existing serializer (src/exporters.mjs),
//   4. runs OpenCascade as an independent oracle on the STEP
//      (scripts/bakeoff/recover-step.py: BRepCheck with exact CurveOnSurface
//      plus the BOPAlgo_ArgumentAnalyzer self-interference check, and
//      scripts/validate-step.py per file),
//   5. compares the exact volume and area with the OCCT CSG oracle in
//      fixtures/bakeoff/reference.json (and the mesh volume with manifold3d);
//      where OCCT and manifold3d disagree (scripts/bakeoff/arbiter.mjs
//      oracleDispute), the arbiter entry decides, and a dispute without one
//      is `unarbitrated`, never `exact`.
// It computes no geometry.
//
//   node scripts/bakeoff/recover-check.mjs [--target cpu1|js|cpuN|metal] [--cases a,b] [--no-occt]
//        [--results dir] [--out dir]

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadKernel } from '../../src/kernel.mjs';
import { validateAnalytic } from '../../src/analytic.mjs';
import { toStep } from '../../src/exporters.mjs';
import { arbiterFor, loadArbiter, oracleDispute } from './arbiter.mjs';
import { ROOT, loadCases } from './fixtures.mjs';
import { decodeRecover, toBodies } from './recover-brep.mjs';
import { needsExtendedStep, toStepRecovered } from './recover-stepx.mjs';

const { version: BEND_VERSION } = JSON.parse(fs.readFileSync(path.join(ROOT, 'bend.lock.json'), 'utf8'));

function run(exe, args, timeoutMs = 600000) {
  return new Promise((resolve) => {
    const child = spawn(exe, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (b) => { stdout += b; });
    child.stderr.on('data', (b) => { stderr += b; });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

async function pool(items, n, f) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await f(items[i], i); }
  }));
  return out;
}

// Decode + kernel validation + STEP export of one recover output text.
export async function exportRecovered(text, id, prefix, kernel) {
  const d = decodeRecover(text);
  if (d.status !== 'ok') return { status: 'unresolved', reason: d.reason };
  const bodies = toBodies(d.raw, id);
  if (!bodies.length) return { status: 'ok', empty: true, stats: d.stats, bodies: 0 };
  // Sphere and torus faces are outside the kernel body format: its validator
  // and exporter do not apply; the Bend certification and OpenCascade do.
  const extended = needsExtendedStep(bodies);
  for (const b of bodies) {
    b.validation = extended
      ? { closed: true, vertices: b.vertices.length, edges: b.edges.length, faces: b.faces.length, scope: 'recover: sphere/torus faces are not in the kernel body format; validateAnalytic not applicable (Bend certification + OpenCascade only)', toleranceMm: 0.0003, volumeMm3: null, boundsMm: null }
      : validateAnalytic(b, kernel);
  }
  const model = { schema: 'wonky-brep/1', units: 'millimeter', backend: { language: 'Bend', version: BEND_VERSION, target: 'recover', precision: 'F32x2' }, bodies };
  fs.mkdirSync(path.dirname(prefix), { recursive: true });
  fs.writeFileSync(`${prefix}.step`, extended ? toStepRecovered(model, id) : toStep(model, id));
  fs.writeFileSync(`${prefix}.brep.json`, JSON.stringify(model, null, 1) + '\n');
  const count = (k) => bodies.reduce((s, b) => s + b[k].length, 0);
  const types = (xs) => xs.reduce((m, x) => ({ ...m, [x]: (m[x] ?? 0) + 1 }), {});
  return {
    status: 'ok', stats: d.stats, bodies: bodies.length, serializer: extended ? 'recover-stepx (sphere/torus)' : 'src/exporters.mjs',
    topology: { vertices: count('vertices'), edges: count('edges'), faces: count('faces') },
    // Edges used twice by one face (explicit seams of band faces).
    seamUses: bodies.reduce((s, b) => s + b.faces.reduce((t, f) => { const u = f.loops.flat().map((x) => x.edge); return t + u.length - new Set(u).size; }, 0), 0),
    surfaces: types(bodies.flatMap((b) => b.faces.map((f) => f.surface.type))),
    curves: types(d.raw.edges.map((e) => (e.seam ? 'seam' : e.curve.type))),
  };
}

export async function occtCheck(stepFiles) {
  if (!stepFiles.length) return [];
  const r = await run('uv', ['run', '--quiet', 'scripts/bakeoff/recover-step.py', ...stepFiles]);
  if (r.code !== 0) throw new Error(`recover-step.py failed: ${r.stderr.slice(-2000)}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

// scripts/validate-step.py admits the reader's seam refinement only for
// bodies that carry reference face areas (frozen Onshape inputs). Recovered
// periodic faces left without an explicit seam (the kernel convention for
// everything but plain bands: holes, rims with vertices, sphere caps) are
// completed by the STEP reader with seam edges, pole vertices + degenerated
// edges or split vertices. Accept exactly that refinement: same solids and
// faces, BRepCheck-valid with exact CurveOnSurface, and every added edge
// accounted for by an added seam or an added vertex. Exactness itself is then
// judged by volume and area against the OCCT CSG oracle.
export function refinementOk(r, o) {
  if (!o || o.error || !o.valid || !r.topology) return null;
  const seams = o.seams - (r.seamUses ?? 0), verts = o.vertices - r.topology.vertices;
  const ok = o.faces === r.topology.faces && seams >= 0 && verts >= 0 && o.edges - r.topology.edges === seams + verts;
  return ok ? { ok: true, refinement: `reader added ${seams} seam(s), ${verts} vertex(es), ${o.degenerated} degenerated edge(s)`, volumeMm3: o.volume } : null;
}

export async function validateStep(prefix) {
  const r = await run('uv', ['run', '--quiet', 'scripts/validate-step.py', prefix]);
  if (r.code === 0) return { ok: true, report: JSON.parse(r.stdout)[0] };
  const line = r.stderr.trim().split('\n').pop();
  return { ok: false, error: line };
}

// Verdict of one checked case row (status, expect, occt, validateStep, exact).
export function checkVerdict(r) {
  if (r.status === 'unresolved') return r.expect === 'non-manifold-contact' ? 'expected-refusal' : 'unresolved';
  if (r.status !== 'ok') return 'invalid';
  if (r.empty) return r.expect === 'empty' ? 'exact' : 'invalid';
  // The exact result touches itself: recovery must refuse (clearance or
  // coincident-vertex check); an ok output is never scored as exact.
  if (r.expect === 'non-manifold-contact') return 'contact-accepted';
  if (!r.occt) return 'recovered';
  if (!r.occt.error && !r.occt.valid && r.occt.validSampled) return r.exact?.volumeRelErrVsOcctCsg < 1e-6 ? 'valid-sampled' : 'mismatch';
  if (r.occt.error || !r.occt.valid || !r.validateStep?.ok) return 'invalid-step';
  // BOPAlgo_ArgumentAnalyzer: self-interference or small edges.
  if (r.occt.interferenceFree === false) return 'invalid-interference';
  const e = r.exact;
  if (!e) return 'mismatch';
  const vsOcct = e.volumeRelErrVsOcctCsg < 1e-7 && e.areaRelErrVsOcctCsg < 1e-7 && e.solidsMatch;
  const a = e.arbitration;
  if (!a) return vsOcct ? 'exact' : 'mismatch';
  // The oracles disagree. Without an arbiter entry neither decides alone: an
  // answer that matches one of them is unarbitrated, one that matches
  // neither is wrong either way.
  if (a.decision === 'UNARBITRATED') return vsOcct || a.matchesManifold ? 'unarbitrated' : 'mismatch';
  if (a.decision === 'occt' || a.decision === 'expectation') return vsOcct ? 'exact' : 'mismatch';
  // manifold / reference / ambiguous: the third reference decides (shells,
  // or one of the admissible shell counts; volume and, where the topology is
  // the reference's own, area). Within the reference's own tolerance but not
  // 1e-7: agrees with a reference that is not exact itself (a constructed
  // mesh), neither exact nor wrong.
  if (!a.shellsOk) return 'mismatch';
  if (a.volumeRelErrVsReference < 1e-7 && (a.areaRelErrVsReference === null || a.areaRelErrVsReference < 1e-7)) return 'exact';
  return a.withinReferenceTolerance ? 'reference-tolerance' : 'mismatch';
}

// How the arbitration applies to one exported row: o = OCCT's measure of the
// recovered STEP (null: the oracles agree on the case).
export function recoverArbitration(o, ref, arbiter, id) {
  const dispute = oracleDispute(ref);
  if (!dispute) return null;
  const arb = arbiterFor(arbiter, id, ref.jobSha256);
  const m = ref.manifold;
  // Shells, not solids: a sealed void is one solid with two shells, and the
  // references count shells (manifold3d components).
  const shells = o.shells ?? o.solids;
  if (!arb) {
    // A B-rep is exact; manifold3d's mesh is within area x deviation of it.
    const matchesManifold = shells === m.components && Math.abs(o.volume - m.volume) <= Math.max(1e-4 * Math.abs(m.volume), m.area * ref.deviationMm);
    return { decision: 'UNARBITRATED', dispute, matchesManifold };
  }
  const R = arb.reference;
  const ambiguous = arb.decision === 'ambiguous';
  return {
    decision: arb.decision,
    class: arb.class,
    referenceShells: ambiguous ? arb.admissible.map((x) => x.shells) : [R.shells],
    shells,
    shellsOk: ambiguous ? arb.admissible.some((x) => x.shells === shells) : shells === R.shells,
    volumeRelErrVsReference: Math.abs(o.volume - R.volume) / Math.max(Math.abs(R.volume), 1e-300),
    // The reference area belongs to its own topology (an admissible
    // alternative of an ambiguous case has other faces).
    areaRelErrVsReference: ambiguous && shells !== R.shells ? null : Math.abs(o.area - R.area) / Math.max(R.area, 1e-300),
    withinReferenceTolerance: Math.abs(o.volume - R.volume) <= R.volumeTolAbs,
    dispute,
  };
}

// Grade exported rows against the OCCT oracle (in place).
export async function gradeRows(exported, reference, outDir, arbiter = loadArbiter()) {
  if (!exported.length) return;
  const occ = await occtCheck(exported.map((r) => path.join(outDir, 'step', `${r.id}.step`)));
  const vs = await pool(exported, 6, (r) => validateStep(path.join(outDir, 'step', r.id)));
  exported.forEach((r, i) => {
    const o = occ[i], ref = reference.cases[r.id];
    r.occt = o;
    r.validateStep = vs[i].ok ? { ok: true, volumeMm3: vs[i].report.volumeMm3, periodicSeamsAdded: vs[i].report.periodicSeamsAdded } : vs[i];
    if (!vs[i].ok) r.validateStep = refinementOk(r, o) ?? vs[i];
    if (ref?.occt && !o.error) {
      r.exact = {
        volumeRelErrVsOcctCsg: Math.abs(o.volume - ref.occt.volume) / ref.occt.volume,
        areaRelErrVsOcctCsg: Math.abs(o.area - ref.occt.area) / ref.occt.area,
        meshVolumeRelErrVsOcctCsg: ref.manifold ? Math.abs(ref.manifold.volume - ref.occt.volume) / ref.occt.volume : null,
        solidsMatch: o.solids === ref.occt.solids,
      };
      const a = recoverArbitration(o, ref, arbiter, r.id);
      if (a) r.exact.arbitration = a;
    }
  });
}

async function main(argv) {
  const opts = { target: 'cpu1', occt: true, results: path.join(ROOT, 'out/bakeoff/recover/results'), out: path.join(ROOT, 'out/bakeoff/recover') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--target') opts.target = argv[++i];
    else if (a === '--cases') opts.cases = argv[++i].split(',');
    else if (a === '--no-occt') opts.occt = false;
    else if (a === '--results') opts.results = path.resolve(argv[++i]);
    else if (a === '--out') opts.out = path.resolve(argv[++i]);
    else throw new Error(`unknown argument ${a}`);
  }
  const kernel = await loadKernel();
  const reference = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/bakeoff/reference.json'), 'utf8'));
  const cases = loadCases().filter((c) => !opts.cases || opts.cases.includes(c.id));
  const rows = [];
  for (const c of cases) {
    const file = [opts.target, 'cpu1', 'js', 'cpuN'].map((t) => path.join(opts.results, `${c.id}.${t}.result`)).find((p) => fs.existsSync(p));
    if (!file) continue;
    const row = { id: c.id, expect: c.expect ?? 'solid', source: path.relative(ROOT, file) };
    try {
      Object.assign(row, await exportRecovered(fs.readFileSync(file, 'utf8'), c.id, path.join(opts.out, 'step', c.id), kernel));
    } catch (err) {
      row.status = 'invalid';
      row.error = err.message;
    }
    rows.push(row);
  }
  const exported = rows.filter((r) => r.status === 'ok' && !r.empty);
  if (opts.occt) await gradeRows(exported, reference, opts.out);
  for (const r of rows) r.verdict = checkVerdict(r);
  fs.mkdirSync(opts.out, { recursive: true });
  fs.writeFileSync(path.join(opts.out, 'check.json'), JSON.stringify({ schema: 'wonky-recover-check/1', capturedAt: new Date().toISOString(), target: opts.target, rows }, null, 1) + '\n');
  const L = ['| case | verdict | faces/edges/vertices | surfaces | curves | max boundary dev / bound (mm) | OCCT volume rel err vs exact CSG | mesh volume rel err | area rel err | validate-step | reason |', '|---|---|---|---|---|---|---|---|---|---|---|'];
  const e1 = (x) => (x === undefined || x === null ? '-' : x.toExponential(1));
  for (const r of rows) {
    const t = r.topology ? `${r.topology.faces}/${r.topology.edges}/${r.topology.vertices}` : '-';
    const s = r.surfaces ? Object.entries(r.surfaces).map(([k, v]) => `${k} ${v}`).join(', ') : '-';
    const cv = r.curves ? Object.entries(r.curves).map(([k, v]) => `${k} ${v}`).join(', ') : '-';
    const dev = r.stats ? `${e1(r.stats.maxBoundaryDeviationMm)} (${r.stats.maxDeviationOverBound.toFixed(2)} of bound)` : '-';
    L.push(`| ${r.id} | ${r.verdict} | ${t} | ${s} | ${cv} | ${dev} | ${e1(r.exact?.volumeRelErrVsOcctCsg)} | ${e1(r.exact?.meshVolumeRelErrVsOcctCsg)} | ${e1(r.exact?.areaRelErrVsOcctCsg)} | ${r.validateStep ? (r.validateStep.ok ? 'ok' : 'FAIL') : '-'} | ${(r.reason ?? r.error ?? r.validateStep?.error ?? '').slice(0, 90)} |`);
  }
  fs.writeFileSync(path.join(opts.out, 'check.md'), L.join('\n') + '\n');
  console.log(L.join('\n'));
  const counts = {};
  for (const r of rows) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
  console.log('\nverdicts:', JSON.stringify(counts));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((err) => { console.error(err.stack ?? err.message); process.exit(1); });
}
