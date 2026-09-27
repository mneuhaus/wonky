#!/usr/bin/env node
// Fillet harness TEST INFRASTRUCTURE: independent check of prototype C
// ("fillet-rollingball"), stage 1, the contact-circle solver
// (docs/fillet/proto-rollingball.md). It computes no blend: it reads the
// sampled blend the Bend solver wrote and checks it three ways.
//
//   node scripts/fillet/rollingball-c1.mjs [--cases a,b] [--group g]
//        [--targets cpu1,cpuN,metal] [--json out.json]
//
// 1. Re-certification in float64 (geom.mjs, a separate implementation of the
//    surfaces): every station's ball centre is at distance r from both
//    supports on the right side, its contact points lie on the supports with
//    the contact normal along c − p, and it lies in the normal plane of the
//    edge. Chamfer stations: the contact points lie on the supports, at
//    in-face distance d perpendicular to the edge, pointing into the face.
// 2. Closed-form centres where the section is two lines (plane/plane edges,
//    coaxial rims on planes/cylinders/cones): c* = P + σ r (n_A + n_B)/(1 + n_A·n_B);
//    and where it is a line and a circle (a plane meeting a cylinder along a
//    generator): the offset line intersected with the offset circle.
// 3. Section volume: the removed (convex) or added (concave) section area
//    swept along the edge (prism for lines, Pappus for circles), summed over
//    the selected edges when no two of them share a vertex, against the case's
//    closed form (and its accepted alternatives), the OCCT oracle and the
//    Onshape probes (~/Workspace/cad/cad-project-041/single-step-r20/kernel-cases/fp-*).
//
// The solver runs on the JS target through `sample(job)`; with --targets the
// `.samples` sidecars the native targets wrote in a harness run
// (out/fillet/fillet-rollingball/results) must be byte-identical to it.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBend } from '../../src/bend-loader.mjs';
import { decodeJob } from './brepfmt.mjs';
import { ROOT, loadCases } from './cases.mjs';
import {
  add, cross, curvePoint, dist, dot, edgeLength, edgeTangent, edgeUses, faceNormal, loopIntegrals,
  norm, normaliseBody, pointSurfaceDistance, scale, sub, unit,
} from './geom.mjs';
import { jobPath } from './fixtures.mjs';

export const PROTO_MAIN = path.join(ROOT, 'kernel/proto/fillet-rollingball/main.bend');
export const PROBES_DIR = path.join(os.homedir(), 'Workspace/cad/cad-project-041/single-step-r20/kernel-cases');
export const CERT_TOL = 1e-9; // mm, the solver's own certificate bound
export const F64_TOL = 1e-9; // mm, float64 re-certification bound

const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
const word = (w) => { u32[0] = Number(w); return f32[0]; };

// ---------------------------------------------------------------------------
// Sample text (main.bend "wonky-fillet-samples 1")

export function decodeSamples(text) {
  const w = text.split(/\s+/).filter(Boolean);
  let i = 0;
  const next = () => { if (i >= w.length) throw new Error('samples: unexpected end'); return w[i++]; };
  const expect = (x) => { const g = next(); if (g !== x) throw new Error(`samples: expected ${x}, got ${g}`); };
  const real = () => word(next()) + word(next());
  const vec = () => [real(), real(), real()];
  expect('wonky-fillet-samples'); expect('1');
  const head = next();
  if (head === 'invalid') return { invalid: text.split('\n')[1] };
  if (head !== 'case') throw new Error(`samples: bad header ${head}`);
  const out = { id: next() };
  expect('op'); out.op = next();
  expect('size'); out.size = real();
  expect('intervals'); out.intervals = Number(next());
  expect('edges');
  const k = Number(next());
  out.edges = [];
  for (let e = 0; e < k; e++) {
    expect('edge');
    const edge = Number(next()), status = next();
    if (status === 'seam') { expect('ignored'); out.edges.push({ edge, seam: true }); continue; }
    if (status === 'unresolved') {
      const cls = next(), words = [];
      while (i < w.length && w[i] !== 'edge' && w[i] !== 'end') words.push(next());
      out.edges.push({ edge, refusal: { class: cls, reason: words.join(' ') } });
      continue;
    }
    if (status !== 'ok') throw new Error(`samples: bad edge status ${status}`);
    const convexity = next(), n = Number(next()), stations = [];
    for (let s = 0; s < n; s++) {
      expect('s');
      stations.push({ k: Number(next()), t: real(), P: vec(), c: vec(), pa: vec(), pb: vec(), res: real(), s: real() });
    }
    expect('cert');
    out.edges.push({ edge, convexity, stations, cert: { res: real(), dev: real() } });
  }
  expect('end');
  return out;
}

// ---------------------------------------------------------------------------
// Geometry helpers (float64)

// The two faces of an edge with the coedge direction each runs.
function edgeFaces(body, uses, e) {
  const u = uses[e];
  if (u.length !== 2) throw new Error(`edge ${e} has ${u.length} uses`);
  return u.map(({ face, forward }) => ({ face: body.faces[face], forward }));
}

const coaxial = (curve, s) => {
  if (curve.type !== 'circle' || (s.type !== 'cylinder' && s.type !== 'cone')) return false;
  const a = unit(s.axis), off = sub(curve.origin, s.origin);
  return norm(cross(unit(curve.normal), a)) < 1e-12 && norm(cross(off, a)) < 1e-9;
};
const generator = (curve, s) => curve.type === 'line' && s.type === 'cylinder' && norm(cross(unit(curve.direction), unit(s.axis))) < 1e-12;

// Section type of the blend of an edge: 'lines' | 'line-circle' | null.
export function sectionKind(curve, sa, sb) {
  const lineLike = (s) => s.type === 'plane' || coaxial(curve, s);
  if (lineLike(sa) && lineLike(sb)) return 'lines';
  if ((sa.type === 'plane' && generator(curve, sb)) || (sb.type === 'plane' && generator(curve, sa))) return 'line-circle';
  return null;
}

// Closed-form ball centre (independent of the solver's iteration).
export function closedCentre(kind, P, T, fa, fb, sigma, r) {
  const na = faceNormal(fa.face, P), nb = faceNormal(fb.face, P);
  if (kind === 'lines') return add(P, scale(add(na, nb), (sigma * r) / (1 + dot(na, nb))));
  // line-circle: plane face `pl`, cylinder face `cy` meeting along a generator.
  const [pl, cy] = fa.face.surface.type === 'plane' ? [fa, fb] : [fb, fa];
  const np = faceNormal(pl.face, P), w = unit(cross(T, np));
  const s = cy.face.surface, a = unit(s.axis), sense = cy.face.sameSense === false ? -1 : 1;
  const rho = s.radius + sigma * r * sense; // natural radial distance of the centre
  // c = L0 + u w, |radial(c)| = rho, L0 = P + σ r n_plane.
  const L0 = add(P, scale(np, sigma * r));
  const rad = (p) => { const d = sub(p, s.origin); return sub(d, scale(a, dot(d, a))); };
  const q = rad(L0), wr = sub(w, scale(a, dot(w, a)));
  const A = dot(wr, wr), B = 2 * dot(q, wr), C = dot(q, q) - rho * rho, disc = B * B - 4 * A * C;
  if (disc < 0) return null;
  const us = [(-B + Math.sqrt(disc)) / (2 * A), (-B - Math.sqrt(disc)) / (2 * A)];
  const u = Math.abs(us[0]) < Math.abs(us[1]) ? us[0] : us[1];
  return add(L0, scale(w, u));
}

// Float64 re-certification of one station; returns the worst deviation (mm).
export function recertify(op, st, curve, t, T, fa, fb, sigma, r) {
  const sa = fa.face.surface, sb = fb.face.surface, dev = [];
  dev.push(dist(st.P, curvePoint(curve, t)));
  if (op === 'fillet') {
    dev.push(Math.abs(pointSurfaceDistance(sa, st.c) - r), Math.abs(pointSurfaceDistance(sb, st.c) - r));
    dev.push(pointSurfaceDistance(sa, st.pa), pointSurfaceDistance(sb, st.pb));
    // contact normal: c − p = σ r n_face(p) (side and direction at once)
    dev.push(norm(sub(sub(st.c, st.pa), scale(faceNormal(fa.face, st.pa), sigma * r))));
    dev.push(norm(sub(sub(st.c, st.pb), scale(faceNormal(fb.face, st.pb), sigma * r))));
    dev.push(Math.abs(dot(T, sub(st.c, st.P))));
  } else {
    for (const [p, f] of [[st.pa, fa], [st.pb, fb]]) {
      const n = faceNormal(f.face, st.P), into = unit(cross(n, scale(T, f.forward ? 1 : -1)));
      dev.push(pointSurfaceDistance(f.face.surface, p), Math.abs(dot(T, sub(p, st.P))));
      dev.push(norm(sub(sub(p, st.P), scale(into, r)))); // setback d along the face, into it
    }
  }
  return Math.max(...dev);
}

// Section area of the removed/added region and its centroid in (ρ, h) of the
// meridian plane (circle edges) or 2D coordinates of the normal plane (lines).
export function sectionIntegrals(op, st, curve) {
  let to2;
  if (curve.type === 'circle') {
    const a = unit(curve.normal), o = curve.origin;
    const u = unit(sub(sub(st.P, o), scale(a, dot(sub(st.P, o), a))));
    to2 = (p) => [dot(sub(p, o), u), dot(sub(p, o), a)];
  } else {
    const T = unit(curve.direction), e1 = unit(sub(st.pa, st.P)), e2 = cross(T, e1);
    to2 = (p) => [dot(sub(p, st.P), e1), dot(sub(p, st.P), e2)];
  }
  const P = to2(st.P), A = to2(st.pa), B = to2(st.pb);
  if (op === 'chamfer') return loopIntegrals([{ type: 'line', a: P, b: A }, { type: 'line', a: A, b: B }, { type: 'line', a: B, b: P }]);
  const C = to2(st.c), ang = (p) => Math.atan2(p[1] - C[1], p[0] - C[0]);
  let a0 = ang(A), a1 = ang(B), d = a1 - a0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return loopIntegrals([{ type: 'line', a: P, b: A }, { type: 'arc', c: C, r: dist(st.c, st.pa), from: a0, to: a0 + d }, { type: 'line', a: B, b: P }]);
}

// Onshape probe delta volume by case id (null when no probe).
export function onshapeProbe(id) {
  const dir = path.join(PROBES_DIR, `fp-${id}`, 'reference.json');
  if (!fs.existsSync(dir)) return null;
  const j = JSON.parse(fs.readFileSync(dir, 'utf8'));
  const part = j.parts?.[0];
  return { verdict: j.verdict, deltaVolume: part?.delta_volume_mm3 ?? null, error: j.error ?? j.onshape?.error ?? null };
}

// ---------------------------------------------------------------------------
// One case

export function checkCase(jobText, samplesText, { closedForm = null, occtDelta = null, onshape = null } = {}) {
  const job = decodeJob(jobText), body = normaliseBody(job.body), uses = edgeUses(body);
  const smp = decodeSamples(samplesText);
  const rep = { id: job.id, op: job.op, size: job.size, edges: [], refusals: [], seams: [] };
  if (smp.invalid) return { ...rep, invalid: smp.invalid };
  let cfWorst = 0, cfEdges = 0, f64Worst = 0, solverWorst = 0, midWorst = 0, volume = 0, volumeOk = true, sectionSpread = 0;
  for (const e of smp.edges) {
    if (e.seam) { rep.seams.push(e.edge); continue; }
    if (e.refusal) { rep.refusals.push({ edge: e.edge, ...e.refusal }); volumeOk = false; continue; }
    const edge = body.edges[e.edge], curve = edge.curve;
    const [fa, fb] = edgeFaces(body, uses, e.edge);
    const sigma = e.convexity === 'convex' ? -1 : 1, r = job.size;
    const kind = job.op === 'fillet' ? sectionKind(curve, fa.face.surface, fb.face.surface) : null;
    let eF64 = 0, eCf = 0, areas = [];
    for (const st of e.stations) {
      const T = edgeTangent(edge, st.t);
      eF64 = Math.max(eF64, recertify(job.op, st, curve, st.t, T, fa, fb, sigma, r));
      if (kind) {
        const c = closedCentre(kind, st.P, T, fa, fb, sigma, r);
        eCf = Math.max(eCf, c ? dist(c, st.c) : Infinity);
      }
      if (job.op === 'chamfer' || kind === 'lines') areas.push(sectionIntegrals(job.op, st, curve));
    }
    f64Worst = Math.max(f64Worst, eF64);
    solverWorst = Math.max(solverWorst, e.cert.res);
    midWorst = Math.max(midWorst, e.cert.dev);
    if (kind) { cfWorst = Math.max(cfWorst, eCf); cfEdges++; }
    let dV = null;
    if (areas.length) {
      const a0 = areas[0].area;
      sectionSpread = Math.max(sectionSpread, ...areas.map((a) => Math.abs(a.area - a0)));
      const sign = e.convexity === 'convex' ? -1 : 1;
      if (curve.type === 'line') dV = sign * a0 * edgeLength(edge, body.vertices, 1);
      else if (curve.type === 'circle' && edge.start === edge.end && !edge.curveRange) dV = sign * 2 * Math.PI * areas[0].centroid[0] * a0;
    }
    if (dV === null) volumeOk = false; else volume += dV;
    rep.edges.push({ edge: e.edge, convexity: e.convexity, stations: e.stations.length, section: kind ?? (job.op === 'chamfer' ? 'chamfer' : 'none'), solverRes: e.cert.res, f64Res: eF64, closedCentreErr: kind ? eCf : null, midpointDev: e.cert.dev, deltaVolume: dV });
  }
  // Swept-section volumes add up only when the selected edges share no vertex
  // (no corners, mitres or caps between them).
  const verts = smp.edges.filter((e) => !e.seam).flatMap((e) => [body.edges[e.edge].start, body.edges[e.edge].end]);
  const closedLoops = smp.edges.every((e) => e.seam || body.edges[e.edge].start === body.edges[e.edge].end);
  const independent = closedLoops || new Set(verts).size === verts.length;
  rep.summary = {
    solverRes: solverWorst, f64Res: f64Worst, closedCentreErr: cfEdges ? cfWorst : null, closedCentreEdges: cfEdges,
    midpointDev: midWorst, sectionSpread, independent,
    deltaVolume: volumeOk && independent && rep.edges.length ? volume : null,
  };
  const dv = rep.summary.deltaVolume;
  const cmp = (ref) => (ref === null || ref === undefined || dv === null ? null : Math.abs(dv - ref));
  if (closedForm) {
    const alts = Object.entries(closedForm.alternatives ?? {});
    rep.summary.closedForm = { deltaVolume: closedForm.deltaVolume, absErr: cmp(closedForm.deltaVolume), alternatives: Object.fromEntries(alts.map(([k, v]) => [k, { deltaVolume: v, absErr: cmp(v) }])) };
  }
  if (occtDelta !== null) rep.summary.occt = { deltaVolume: occtDelta, absErr: cmp(occtDelta) };
  if (onshape) rep.summary.onshape = { ...onshape, absErr: cmp(onshape.deltaVolume) };
  return rep;
}

// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const o = { targets: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => argv[++i];
    if (a === '--cases') o.cases = next().split(',').filter(Boolean);
    else if (a === '--group') o.group = next();
    else if (a === '--targets') o.targets = next().split(',').filter(Boolean);
    else if (a === '--json') o.json = next();
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

const e1 = (x) => (x === null || x === undefined ? '-' : x === 0 ? '0' : x.toExponential(1));

async function main(argv) {
  const o = parseArgs(argv);
  const all = loadCases();
  const cases = o.cases ? o.cases.map((id) => all.find((c) => c.id === id)) : all.filter((c) => !o.group || c.group === o.group);
  const reference = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/fillet/reference.json'), 'utf8'));
  const mod = await loadBend(PROTO_MAIN);
  const reports = [];
  console.log('| case | result | edges | stations | solver res | f64 res | closed-form centre | midpoint dev | ΔV sampled | ΔV closed form (alt) | ΔV OCCT | ΔV Onshape | targets |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const c of cases) {
    const jobText = fs.readFileSync(jobPath(c.id), 'utf8');
    const t0 = performance.now();
    const samplesText = mod.sample(jobText), result = mod.run(jobText);
    const ms = performance.now() - t0;
    const ref = reference.cases[c.id];
    const occtDelta = ref?.status === 'done' && ref.result ? ref.result.volume - ref.input.volume : null;
    const rep = checkCase(jobText, samplesText, { closedForm: c.closedForm, occtDelta, onshape: onshapeProbe(c.id) });
    rep.result = result.split('\n')[0];
    rep.jsMs = ms;
    rep.targets = {};
    for (const t of o.targets) {
      const f = path.join(ROOT, 'out/fillet/fillet-rollingball/results', `${c.id}.${t}.result.samples`);
      rep.targets[t] = fs.existsSync(f) ? (fs.readFileSync(f, 'utf8') === samplesText ? 'same' : 'DIFFERENT') : 'missing';
    }
    reports.push(rep);
    const s = rep.summary ?? {};
    const status = rep.result.replace(/^unresolved /, '').split(' ')[0];
    const stations = rep.edges.reduce((n, e) => n + e.stations, 0);
    const cf = s.closedForm ? `${e1(s.closedForm.absErr)}${Object.values(s.closedForm.alternatives).length ? ` (${Object.values(s.closedForm.alternatives).map((a) => e1(a.absErr)).join(', ')})` : ''}` : '-';
    const tg = Object.entries(rep.targets).map(([k, v]) => `${k} ${v}`).join(', ') || '-';
    console.log(`| ${c.id} | ${status}${rep.refusals.length ? ` (${rep.refusals[0].class})` : ''} | ${rep.edges.length} | ${stations} | ${e1(s.solverRes)} | ${e1(s.f64Res)} | ${e1(s.closedCentreErr)} | ${e1(s.midpointDev)} | ${s.deltaVolume === null || s.deltaVolume === undefined ? '-' : s.deltaVolume.toFixed(6)} | ${cf} | ${e1(s.occt?.absErr)} | ${e1(s.onshape?.absErr)} | ${tg} |`);
  }
  if (o.json) fs.writeFileSync(o.json, JSON.stringify({ schema: 'wonky-fillet-rollingball-c1/1', capturedAt: new Date().toISOString(), cases: reports }, null, 1));
  return reports;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => { console.error(err); process.exit(1); });
}
