#!/usr/bin/env node
// Fillet harness TEST INFRASTRUCTURE (verify:fillet-kpart, 24 September 2026):
// an independent, tighter check of `ok` results on top of validate.mjs. It
// computes no blend; it only compares the result with the job.
//
//   node scripts/fillet/tightcheck.mjs --results <dir> [--catalogue <cases.json>] [--jobs <dir>] [--target cpu1] [--claim exact|approximate] [--json <out>]
//
// Checks per `ok` result (validate.mjs checks topology/geometry at 1e-6 mm and
// G1 only where a blend meets a support at < 0.1 rad):
//   support    every support/cap face lies on a surface of the input body
//              (same point set to 1e-9 mm): catches merged near-coplanar
//              faces and moved supports (silent tolerance growth)
//   tight      every edge lies on the surfaces of both its faces to
//              1e-9 mm (plus 1e-15 x |p| for float64 evaluation far out)
//   grounded   fillets: every blend face is tangent to both input surfaces of
//              at least one selected edge (sphere corners: to >= 3 input
//              surfaces; vertex-blend faces: to an input surface and to an
//              adjacent edge blend); a mispositioned blend whose junctions are
//              steeper than 0.1 rad passes the validator as "trims" but fails here
//   g1         every edge between a fillet face and a face lying on a surface
//              tangent to that blend is G1 with agreeing orientation
//   survives   no result edge runs along a selected straight input edge
//   claim      the stated tolerances follow the prototype's claim
//              (prototypes.mjs; docs/fillet-plan.md §8 step 0): an exact
//              prototype (A) states tol 0 on every face; an approximating one
//              (C) states tol 0 on support and cap faces (they lie on input
//              surfaces) and may state 0 < tol on blend and corner faces
//   stated     every edge of a face stating tol > 0 lies on its surface
//              within that tolerance (plus 1e-9 mm)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeJob, decodeResult } from './brepfmt.mjs';
import { dist, dot, edgeSamples, faceNormal, norm, pointSurfaceDistance, scale, sub, unit } from './geom.mjs';
import { sameSurface } from './validate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SURF_TOL = 1e-9; // mm
const TAN_TOL = 1e-9; // mm, tangency distance
const PAR_TOL = 1e-12; // |cos| slack for parallel / perpendicular
const G1_TOL = 1e-7; // rad

const axisLine = (s) => ({ o: s.origin, a: unit(s.axis) });
const lineDist = (p, L) => { const d = sub(p, L.o); return norm(sub(d, scale(L.a, dot(d, L.a)))); };
const parallel = (u, v) => Math.abs(Math.abs(dot(unit(u), unit(v))) - 1) < PAR_TOL;
const perpendicular = (u, v) => Math.abs(dot(unit(u), unit(v))) < 1e-12;
const coaxial = (s, t) => parallel(s.axis, t.axis) && lineDist(t.origin, axisLine(s)) < TAN_TOL;
const near = (a, b, tol = TAN_TOL) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b) * 1e-3);

// Is the (blend) surface B tangent to the (support) surface S somewhere?
export function tangent(B, S) {
  if (S.type === 'plane') {
    const n = unit(S.normal), h = (p) => Math.abs(dot(sub(p, S.origin), n));
    if (B.type === 'cylinder') return perpendicular(B.axis, n) && near(h(B.origin), B.radius);
    if (B.type === 'sphere') return near(h(B.origin), B.radius);
    if (B.type === 'torus') return parallel(B.axis, n) && near(h(B.origin), B.minor);
    return false;
  }
  if (S.type === 'cylinder') {
    if (B.type === 'cylinder') {
      if (!parallel(B.axis, S.axis)) return false;
      const d = lineDist(B.origin, axisLine(S));
      return near(d, S.radius + B.radius) || near(d, Math.abs(S.radius - B.radius));
    }
    if (B.type === 'sphere') { const d = lineDist(B.origin, axisLine(S)); return near(d, S.radius + B.radius) || near(d, Math.abs(S.radius - B.radius)); }
    if (B.type === 'torus') return coaxial(B, S) && (near(S.radius, B.major + B.minor) || near(S.radius, Math.abs(B.major - B.minor)));
    return false;
  }
  if (S.type === 'cone' && B.type === 'torus') {
    if (!coaxial(B, S)) return false;
    const a = unit(S.axis), zc = dot(sub(B.origin, S.origin), a);
    // tube circle centre in the cone's meridian half plane: (major, zc)
    const d = Math.abs((B.major - S.radius - zc * Math.tan(S.angle)) * Math.cos(S.angle));
    return near(d, B.minor);
  }
  if (S.type === 'sphere' && B.type === 'torus') {
    if (lineDist(S.origin, axisLine(B)) > TAN_TOL) return false;
    const a = unit(B.axis), h = dot(sub(S.origin, B.origin), a);
    const d = Math.hypot(B.major, h);
    return near(d, S.radius + B.minor) || near(d, Math.abs(S.radius - B.minor));
  }
  return false;
}

function uses(body) {
  const u = body.edges.map(() => []);
  body.faces.forEach((f, fi) => f.loops.flat().forEach((x) => u[x.edge]?.push(fi)));
  return u;
}

export const CLAIMS = ['exact', 'approximate'];

export function tightCheck(jobText, resultText, { claim = 'exact' } = {}) {
  if (!CLAIMS.includes(claim)) throw new Error(`unknown claim ${claim}`);
  const job = decodeJob(jobText);
  let res;
  try { res = decodeResult(resultText); } catch (err) { return { status: 'malformed', issues: [err.message] }; }
  if (res.status !== 'ok') return { status: res.status };
  const body = res.body, issues = [];
  const bad = (m) => { if (issues.length < 60) issues.push(m); };
  const inSurf = job.body.faces.map((f) => f.surface);
  const inUses = uses(job.body);
  // With tangent propagation the chain may add unselected input edges.
  const grounding = job.tangentPropagation ? job.body.edges.map((_, i) => i) : job.select;
  const pairs = grounding.map((e) => inUses[e].map((fi) => job.body.faces[fi].surface));
  const isBlend = (f) => f.role === 'blend' || f.role === 'corner';
  // claim
  body.faces.forEach((f, i) => {
    if (!(f.tol > 0)) return;
    if (claim === 'exact') bad(`claim: face ${i} (${f.role}) states tol ${f.tol}, the prototype claims exact geometry`);
    else if (!isBlend(f)) bad(`claim: ${f.role} face ${i} states tol ${f.tol}; support and cap faces lie on input surfaces`);
  });
  // support
  body.faces.forEach((f, i) => {
    if (isBlend(f)) return;
    if (!inSurf.some((s) => sameSurface(s, f.surface, SURF_TOL))) bad(`support: ${f.role} face ${i} (${f.surface.type}) lies on no input surface (1e-9 mm)`);
  });
  // tight (tol 0 faces) and stated (faces stating tol > 0)
  const u = uses(body);
  let maxDev = 0, maxStated = 0;
  body.edges.forEach((e, i) => {
    const samples = edgeSamples(e, body.vertices, 12);
    for (const fi of new Set(u[i])) {
      const f = body.faces[fi];
      if (f.tol > 0) {
        for (const s of samples) {
          const d = pointSurfaceDistance(f.surface, s.p);
          maxStated = Math.max(maxStated, d / f.tol);
          if (d > f.tol + SURF_TOL + 1e-15 * norm(s.p)) { bad(`stated: edge ${i} is ${d.toExponential(2)} mm off the ${f.surface.type} of face ${fi}, which states tol ${f.tol}`); break; }
        }
        continue;
      }
      for (const s of samples) {
        const d = pointSurfaceDistance(f.surface, s.p), tol = SURF_TOL + 1e-15 * norm(s.p);
        maxDev = Math.max(maxDev, d);
        if (d > tol) { bad(`tight: edge ${i} is ${d.toExponential(2)} mm off the ${f.surface.type} of face ${fi}`); break; }
      }
    }
  });
  // grounded + g1 (fillets)
  let g1Edges = 0, maxG1 = 0, vertexBlends = 0;
  if (job.op === 'fillet') {
    // Edge blends: tangent to both supports of a selected edge. Vertex blends
    // (the torus of a mixed-convexity corner, Onshape FP14): tangent to an
    // input surface and to the surface of an edge blend next to it.
    const exact = body.faces.map((f, i) => i).filter((i) => isBlend(body.faces[i]) && !(body.faces[i].tol > 0));
    const onEdge = new Set(exact.filter((i) => body.faces[i].surface.type !== 'sphere'
      && pairs.some((p) => p.length === 2 && tangent(body.faces[i].surface, p[0]) && tangent(body.faces[i].surface, p[1]))));
    const nextTo = (i) => new Set(body.faces[i].loops.flat().flatMap((x) => u[x.edge]).filter((j) => j !== i));
    for (const i of exact) {
      const B = body.faces[i].surface;
      if (B.type === 'sphere') {
        const n = inSurf.filter((s) => tangent(B, s)).length;
        if (n < 3) bad(`grounded: sphere face ${i} is tangent to ${n} input surfaces (need >= 3)`);
      } else if (!onEdge.has(i)) {
        const vertexBlend = inSurf.some((S) => tangent(B, S)) && [...nextTo(i)].some((j) => onEdge.has(j) && tangent(B, body.faces[j].surface));
        if (vertexBlend) vertexBlends++;
        else bad(`grounded: ${B.type} face ${i} is not tangent to both supports of any selected edge, nor a vertex blend between an input surface and an edge blend`);
      }
    }
    body.edges.forEach((e, i) => {
      const [a, b] = u[i];
      if (a === undefined || b === undefined || a === b) return;
      const fa = body.faces[a], fb = body.faces[b];
      if (isBlend(fa) === isBlend(fb)) return;
      const [bl, sp] = isBlend(fa) ? [fa, fb] : [fb, fa];
      if (bl.tol > 0 || !tangent(bl.surface, sp.surface)) return;
      g1Edges++;
      for (const s of edgeSamples(e, body.vertices, 10).slice(1, -1)) {
        const c = Math.max(-1, Math.min(1, dot(faceNormal(bl, s.p), faceNormal(sp, s.p))));
        const ang = Math.acos(c);
        maxG1 = Math.max(maxG1, ang);
        if (ang > G1_TOL) { bad(`g1: edge ${i} between ${bl.surface.type} face and tangent ${sp.surface.type} face meets at ${ang.toExponential(2)} rad`); break; }
      }
    });
  }
  // survives
  for (const ei of job.select) {
    const e = job.body.edges[ei];
    if (e.curve.type !== 'line') continue;
    const L = { o: e.curve.origin, a: unit(e.curve.direction) };
    const A = job.body.vertices[e.start], B = job.body.vertices[e.end];
    const len = dist(A, B), t = (p) => dot(sub(p, A), unit(sub(B, A)));
    body.edges.forEach((r, ri) => {
      if (r.curve.type !== 'line') return;
      const p = body.vertices[r.start], q = body.vertices[r.end];
      if (lineDist(p, L) > 1e-12 * Math.max(1, norm(p)) || lineDist(q, L) > 1e-12 * Math.max(1, norm(q))) return;
      const lo = Math.max(0, Math.min(t(p), t(q))), hi = Math.min(len, Math.max(t(p), t(q)));
      if (hi - lo > 1e-6) bad(`survives: result edge ${ri} runs ${(hi - lo).toExponential(2)} mm along selected input edge ${ei}`);
    });
  }
  return { status: 'ok', ok: issues.length === 0, issues, claim, maxEdgeOffSurfaceMm: maxDev, maxStatedUse: maxStated, g1Edges, maxG1Rad: maxG1, vertexBlends };
}

async function main(argv) {
  const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const resDir = path.resolve(opt('--results'));
  const jobsDir = path.resolve(opt('--jobs', path.join(ROOT, 'fixtures/fillet/jobs')));
  const target = opt('--target', 'cpu1'), claim = opt('--claim', 'exact');
  const cat = JSON.parse(fs.readFileSync(path.resolve(opt('--catalogue', path.join(ROOT, 'fixtures/fillet/cases.json'))), 'utf8')).cases;
  const out = [];
  let failed = 0;
  for (const c of cat) {
    const rf = path.join(resDir, `${c.id}.${target}.result`), jf = path.join(jobsDir, `${c.id}.job`);
    if (!fs.existsSync(rf) || !fs.existsSync(jf)) continue;
    const r = tightCheck(fs.readFileSync(jf, 'utf8'), fs.readFileSync(rf, 'utf8'), { claim });
    out.push({ id: c.id, ...r });
    if (r.status === 'ok') {
      if (!r.ok) failed++;
      console.log(`${c.id.padEnd(50)} ${r.ok ? 'OK  ' : 'FAIL'} dev ${r.maxEdgeOffSurfaceMm.toExponential(1)} g1 ${r.g1Edges} ${r.maxG1Rad.toExponential(1)} ${r.issues.slice(0, 2).join(' | ')}`);
    }
  }
  console.log(`${out.filter((x) => x.status === 'ok').length} ok results checked, ${failed} with issues`);
  if (opt('--json')) fs.writeFileSync(path.resolve(opt('--json')), JSON.stringify(out, null, 1) + '\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((err) => { console.error(err.stack ?? err.message); process.exit(1); });
}
