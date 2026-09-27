#!/usr/bin/env node
// Fillet harness TEST INFRASTRUCTURE: independent checker of prototype C,
// stage 2 (docs/fillet/proto-rollingball.md, "Stage C2"). It reads the result
// files the harness wrote for the two output variants
//   out/fillet/fillet-rollingball-tori/    (C1 "tori": cylinder/torus/sphere, plane/cone)
//   out/fillet/fillet-rollingball-spline/  (C2 "spline": B-spline)
// and measures, in float64 with scripts/fillet/geom.mjs and bspline.mjs:
//   - per blend face: the stated tolerance, and for the spline variant the
//     largest distance of the B-spline from the tori variant's face of the
//     same edge (both approximate the same rolling-ball blend);
//   - prototype A as the analytic reference (fillet.md §5.3): its ladder
//     sidecars (out/fillet/fillet-kpart/results/<case>.cpu1.result.ladder)
//     state the exact carrier and springs of every admitted stripe. The tori
//     faces' boundary samples are measured against A's carrier, C's springs
//     against A's spring curves, and A's contacts against C's face;
//   - admission: A's verdict against C's result or refusal;
//   - volumes (OCCT on the result STEP, from the harness reports) against the
//     closed form, OCCT's oracle and the Onshape probes (read only);
//   - the two Onshape chamfer probes FP15 (120° edge) and FP16 (box corner)
//     as ad-hoc cases (jobs built by `node scripts/fillet/ladder.mjs --probes`
//     into tmp/fillet/a1/probes), run with the harness-built native binaries
//     of both variants and validated like a harness case.
// It computes no blend of its own.
//
//   node scripts/fillet/rollingball-c2.mjs [--target cpu1] [--cases a,b] [--no-probes] [--out out/fillet/fillet-rollingball/c2-check.json]

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeJob, decodeResult } from './brepfmt.mjs';
import { bsplineEval } from './bspline.mjs';
import { ROOT, loadCases } from './cases.mjs';
import { edgeSamples, pointCurveDistance, pointSurfaceDistance } from './geom.mjs';
import { PROBE_CASES, decodeLadder, onshapeProbe } from './ladder.mjs';
import { checkResult, compareMeasures, occtMeasure, resultStep, verdictOf } from './validate.mjs';

export const VARIANTS = ['tori', 'spline'];
const OUT = (v) => path.join(ROOT, 'out/fillet', `fillet-rollingball-${v}`);
const A_RESULTS = path.join(ROOT, 'out/fillet/fillet-kpart/results');

function args(argv) {
  const o = { target: 'cpu1', cases: null, probes: true, out: path.join(ROOT, 'out/fillet/fillet-rollingball/c2-check.json') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--target') o.target = argv[++i];
    else if (argv[i] === '--cases') o.cases = argv[++i].split(',');
    else if (argv[i] === '--no-probes') o.probes = false;
    else if (argv[i] === '--out') o.out = path.resolve(argv[++i]);
  }
  return o;
}

const readIf = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);

// The input edge a blend face was built for: the one forward use whose index
// is below the input edge count (spring B keeps the input edge's index).
function blendEdge(face, nIn) {
  return face.loops.flat().find((u) => u.forward && u.edge < nIn)?.edge ?? null;
}

export function blendFaces(body, nIn) {
  return body.faces.map((f, i) => ({ f, i })).filter(({ f }) => f.role === 'blend').map(({ f, i }) => ({ index: i, edge: blendEdge(f, nIn), face: f }));
}

// Edges of a face shared with a support face (not a cap): the springs.
function springEdges(body, fi) {
  const users = body.edges.map(() => []);
  body.faces.forEach((f, k) => f.loops.flat().forEach((u) => users[u.edge].push(k)));
  return [...new Set(body.faces[fi].loops.flat().map((u) => u.edge))]
    .filter((e) => users[e].some((k) => k !== fi && body.faces[k].role === 'support'));
}

function boundarySamples(body, fi, n = 16) {
  const out = [];
  for (const e of new Set(body.faces[fi].loops.flat().map((u) => u.edge))) for (const s of edgeSamples(body.edges[e], body.vertices, n)) out.push(s.p);
  return out;
}

// Largest distance of the B-spline (65 x 257 samples) from surface `ref`.
export function splineDeviation(spline, ref) {
  const u0 = spline.knotsU[0], u1 = spline.knotsU.at(-1), v0 = spline.knotsV[0], v1 = spline.knotsV.at(-1);
  let worst = 0;
  for (let a = 0; a <= 64; a++) for (let b = 0; b <= 256; b++) {
    const p = bsplineEval(spline, u0 + ((u1 - u0) * a) / 64, v0 + ((v1 - v0) * b) / 256).p;
    worst = Math.max(worst, pointSurfaceDistance(ref, p));
  }
  return worst;
}

function trackDistance(track, p) {
  if (!track) return Infinity;
  return pointCurveDistance(track.type === 'line' ? { type: 'line', origin: track.origin, direction: track.direction } : track, p);
}

// Prototype A's stripe for input edge e against C's tori blend face.
export function crossA(stripe, body, bf) {
  const out = { edge: bf.edge, aCarrier: stripe.carrier, cType: bf.face.surface.type };
  if (!stripe.surface) return { ...out, note: 'A states no carrier surface' };
  out.sameType = stripe.surface.type === bf.face.surface.type;
  out.cBoundaryOnA = Math.max(...boundarySamples(body, bf.index).map((p) => pointSurfaceDistance(stripe.surface, p)));
  out.aContactsOnC = Math.max(...stripe.sides.map((s) => pointSurfaceDistance(bf.face.surface, s.contact)));
  const springs = springEdges(body, bf.index);
  const tracks = stripe.sides.map((sd) => sd.spring).filter(Boolean);
  out.cSpringsOnA = tracks.length ? Math.max(0, ...springs.flatMap((e) => edgeSamples(body.edges[e], body.vertices, 16).map((s) => Math.min(...tracks.map((t) => trackDistance(t, s.p)))))) : null;
  out.maxMm = Math.max(out.cBoundaryOnA, out.aContactsOnC, out.cSpringsOnA ?? 0);
  return out;
}

function casesReport(v) {
  const p = path.join(OUT(v), 'report.json');
  if (!fs.existsSync(p)) { console.error(`warning: ${path.relative(ROOT, p)} is missing (run the harness for fillet-rollingball-${v})`); return {}; }
  return Object.fromEntries(JSON.parse(fs.readFileSync(p, 'utf8')).cases.map((c) => [c.id, c]));
}

function checkCase(c, reps, target) {
  const jobText = fs.readFileSync(path.join(ROOT, 'fixtures/fillet/jobs', `${c.id}.job`), 'utf8');
  const nIn = decodeJob(jobText).body.edges.length;
  const row = { id: c.id, group: c.group, expect: c.expect, op: c.op, variants: {} };
  const bodies = {};
  for (const v of VARIANTS) {
    const r = reps[v][c.id];
    const text = readIf(path.join(OUT(v), 'results', `${c.id}.${target}.result`));
    const res = text ? decodeResult(text) : null;
    const cmp = r?.report?.comparison;
    row.variants[v] = {
      verdict: r?.verdict ?? null, targetsAgree: r?.targetsAgree ?? null,
      refusal: res?.status === 'unresolved' ? res.class : null,
      reason: res?.status === 'unresolved' ? res.reason : undefined,
      computeMs: Object.fromEntries(Object.entries(r?.targets ?? {}).map(([t, x]) => [t, x.timing?.computeMs ?? null])),
    };
    if (res?.status === 'ok') {
      bodies[v] = res.body;
      const bfs = blendFaces(res.body, nIn);
      row.variants[v].blends = bfs.map((b) => ({ edge: b.edge, type: b.face.surface.type, tol: b.face.tol }));
      row.variants[v].maxTol = Math.max(...bfs.map((b) => b.face.tol));
      if (cmp && !cmp.error) {
        row.variants[v].deltaVolume = cmp.deltaVolume;
        if (cmp.closedForm) row.variants[v].closedFormErr = Math.min(...Object.values(cmp.closedForm).map((x) => x.absErr));
        if (cmp.occt) row.variants[v].occtErr = cmp.occt.volumeAbsErr;
      }
    }
  }
  // Spline against tori, edge by edge.
  if (bodies.tori && bodies.spline) {
    const T = blendFaces(bodies.tori, nIn), S = blendFaces(bodies.spline, nIn);
    row.splineVsTori = S.map((s) => {
      const t = T.find((x) => x.edge === s.edge);
      if (!t || s.face.surface.type !== 'bspline') return { edge: s.edge, note: 'no counterpart' };
      const d = splineDeviation(s.face.surface, t.face.surface);
      return { edge: s.edge, deviationMm: d, statedTol: s.face.tol, toriTol: t.face.tol, within: d <= s.face.tol + t.face.tol };
    });
  }
  // Prototype A (analytic reference).
  const ladderText = readIf(path.join(A_RESULTS, `${c.id}.cpu1.result.ladder`));
  if (ladderText) {
    const L = decodeLadder(ladderText);
    const aAdmit = !!L.verdict?.admit;
    const cOk = !!bodies.tori;
    row.a = { admit: aAdmit, class: aAdmit ? null : L.verdict?.class ?? null };
    row.a.agreement = aAdmit === cOk ? (cOk ? 'both build' : 'both refuse') : (aAdmit ? 'A admits, C refuses' : 'C builds, A refuses');
    if (bodies.tori) {
      row.a.stripes = blendFaces(bodies.tori, nIn).map((bf) => {
        const s = L.stripes.find((x) => x.edge === bf.edge && !x.refused);
        return s ? crossA(s, bodies.tori, bf) : { edge: bf.edge, note: 'no admitted A stripe' };
      });
      const m = row.a.stripes.map((s) => s.maxMm).filter((x) => x !== undefined);
      if (m.length) row.a.maxMm = Math.max(...m);
      row.a.sameTypes = row.a.stripes.every((s) => s.sameType !== false);
    }
  }
  const probe = onshapeProbe(c.id);
  if (probe) {
    row.onshape = { code: probe.code, verdict: probe.verdict, error: probe.error, dV: probe.dV, faces: probe.faces };
    for (const v of VARIANTS) if (row.variants[v].deltaVolume !== undefined && probe.dV !== null) row.variants[v].onshapeErr = Math.abs(row.variants[v].deltaVolume - probe.dV);
  }
  return row;
}

// ---------------------------------------------------------------------------
// The Onshape chamfer probes as ad-hoc cases.

export function polygonArea(body, fi) {
  const loop = body.faces[fi].loops[0];
  const pts = loop.map((u) => body.vertices[u.forward ? body.edges[u.edge].start : body.edges[u.edge].end]);
  let a = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a = [a[0] + p[1] * q[2] - p[2] * q[1], a[1] + p[2] * q[0] - p[0] * q[2], a[2] + p[0] * q[1] - p[1] * q[0]];
  }
  return Math.hypot(...a) / 2;
}

async function checkProbes(target) {
  const out = [], steps = [];
  for (const c of PROBE_CASES) {
    const jobFile = path.join(ROOT, 'tmp/fillet/a1/probes', `${c.id}.job`);
    if (!fs.existsSync(jobFile)) { out.push({ id: c.id, note: 'probe job missing (node scripts/fillet/ladder.mjs --probes builds it)' }); continue; }
    const jobText = fs.readFileSync(jobFile, 'utf8');
    const probe = onshapeProbe(c.probe);
    const row = { id: c.id, probe: probe?.code ?? null, onshape: probe ? { dV: probe.dV, faces: probe.faces, faceAreas: probe.faceAreas } : null, variants: {} };
    for (const v of VARIANTS) {
      const bin = path.join(OUT(v), 'build', target === 'metal' ? 'metal' : 'cpu');
      const resFile = path.join(ROOT, 'tmp/fillet/c2/probes', `${c.id}.${v}.result`);
      fs.mkdirSync(path.dirname(resFile), { recursive: true });
      if (!fs.existsSync(bin)) { row.variants[v] = { note: `no binary ${path.relative(ROOT, bin)}` }; continue; }
      const r = spawnSync(bin, ['--threads', '1', '--gpu', 'off', '--', jobFile, resFile], { encoding: 'utf8' });
      if (r.status !== 0) { row.variants[v] = { note: `binary failed: ${r.stderr.slice(-300)}` }; continue; }
      const report = checkResult(jobText, fs.readFileSync(resFile, 'utf8'), c);
      row.variants[v] = { status: report.status, valid: report.valid, issues: report.issues.slice(0, 5), refusal: report.refusal?.class ?? null, reason: report.refusal?.reason };
      if (report.status === 'ok' && report.valid) {
        const step = resFile.replace(/\.result$/, '.step');
        fs.writeFileSync(step, resultStep(report.body, c.id));
        steps.push({ step, row: row.variants[v], report, c });
      }
    }
    out.push(row);
  }
  if (steps.length) {
    const ms = await occtMeasure(steps.map((s) => s.step));
    steps.forEach((s, k) => {
      const m = ms[k], body = s.report.body;
      const onshapeIn = onshapeProbe(s.c.probe);
      s.report.comparison = m.error ? { error: m.error } : compareMeasures(m, { ...s.c, _approxTolMm: Math.max(0, ...s.report.surfaces.approximated.map((a) => a.tolMm)) }, null, null);
      s.row.volume = m.volume;
      s.row.faces = body.faces.length;
      s.row.blendAreas = body.faces.map((f, i) => ({ f, i })).filter(({ f }) => f.role === 'blend').map(({ f, i }) => (f.surface.type === 'plane' ? polygonArea(body, i) : null));
      s.row.onshapeFaces = onshapeIn?.faces ?? null;
      delete s.report.body;
      s.row.verdict = s.report.comparison.error ? 'unmeasured' : (s.report.valid ? (s.report.surfaces.exact ? 'valid' : 'valid-approx') : 'invalid');
    });
  }
  return out;
}

async function main() {
  const o = args(process.argv.slice(2));
  const reps = Object.fromEntries(VARIANTS.map((v) => [v, casesReport(v)]));
  const cases = loadCases().filter((c) => !o.cases || o.cases.includes(c.id));
  const rows = cases.map((c) => checkCase(c, reps, o.target));
  const probes = o.probes ? await checkProbes(o.target) : [];
  const S = { target: o.target, cases: rows.length, capturedAt: new Date().toISOString() };
  const tally = (f) => rows.reduce((m, r) => { const k = f(r); if (k !== undefined) m[k] = (m[k] ?? 0) + 1; return m; }, {});
  for (const v of VARIANTS) S[`verdicts_${v}`] = tally((r) => r.variants[v].verdict);
  S.variantsAgree = tally((r) => (r.variants.tori.verdict === r.variants.spline.verdict ? 'same verdict' : 'differ'));
  S.aAgreement = tally((r) => r.a?.agreement);
  const aGeo = rows.filter((r) => Number.isFinite(r.a?.maxMm));
  S.aGeometry = { cases: aGeo.length, maxMm: aGeo.length ? Math.max(...aGeo.map((r) => r.a.maxMm)) : null, typesAgree: aGeo.every((r) => r.a.sameTypes) };
  const sv = rows.flatMap((r) => r.splineVsTori ?? []).filter((x) => x.deviationMm !== undefined);
  S.splineVsTori = { faces: sv.length, maxDeviationMm: sv.length ? Math.max(...sv.map((x) => x.deviationMm)) : null, allWithinStatedTol: sv.every((x) => x.within) };
  for (const v of VARIANTS) {
    const ok = rows.filter((r) => r.variants[v].maxTol !== undefined);
    S[`maxTol_${v}`] = ok.length ? Math.max(...ok.map((r) => r.variants[v].maxTol)) : null;
    const cf = ok.filter((r) => r.variants[v].closedFormErr !== undefined);
    S[`closedFormMaxAbsErr_${v}`] = cf.length ? Math.max(...cf.map((r) => r.variants[v].closedFormErr)) : null;
    S[`onshape_${v}`] = rows.filter((r) => r.onshape).map((r) => ({ id: r.id, code: r.onshape.code, onshape: r.onshape.verdict, verdict: r.variants[v].verdict, refusal: r.variants[v].refusal, dV: r.variants[v].deltaVolume, onshapeDV: r.onshape.dV, absErr: r.variants[v].onshapeErr }));
  }
  const report = { summary: S, cases: rows, probes };
  fs.mkdirSync(path.dirname(o.out), { recursive: true });
  fs.writeFileSync(o.out, JSON.stringify(report, null, 1));
  console.log(JSON.stringify(S, null, 1));
  for (const p of probes) console.log(JSON.stringify(p));
  console.log(`wrote ${path.relative(ROOT, o.out)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => { console.error(err.stack ?? err.message); process.exit(1); });
}
