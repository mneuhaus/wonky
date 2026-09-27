#!/usr/bin/env node
// Fillet harness TEST INFRASTRUCTURE: independent checker of prototype A's
// stage-1 ladder (kernel/proto/fillet-kpart, docs/fillet/proto-kpart.md).
//
//   node scripts/fillet/ladder.mjs [--cases a,b] [--group g] [--probes] [--out dir]
//
// For every case it runs the prototype's `ladder(job)` export on the Bend JS
// target and re-checks the stripes in float64 with scripts/fillet/geom.mjs.
// It computes no blend of its own; it evaluates what the ladder states:
//   - contacts lie on their support surface and on the blend carrier;
//   - fillets: carrier radius = r, the carrier is G1 with each support at the
//     contact, the ball centre is on the ball side (m = −n convex, +n concave),
//     the spine is at distance r from both supports;
//   - chamfers: both contacts at setback d from the edge (Onshape
//     EQUAL_OFFSETS, probe FP-a), the carrier contains both contacts;
//   - corners: sphere at distance r from the corner's faces, chamfer triangle
//     points at setback d along the edges;
//   - the admission against the case expectation and the Onshape probes
//     (~/Workspace/cad/cad-project-041/single-step-r20/kernel-cases/fp-*, read only);
//   - where every stripe ends at caps, chains or closes on itself, and no
//     corner or mitre is involved: the sum of the stripes' volume changes
//     (section area × length, or Pappus × swept angle) against the closed
//     form, its alternatives and the Onshape probe.
// Native targets write <result>.ladder sidecars (run.mjs); when present they
// are compared byte for byte with the JS ladder text.
//
// --probes also builds the two Onshape chamfer probes (FP15 120° edge, FP16
// box corner) with the kernel into tmp/fillet/a1/probes and checks them.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadBend } from '../../src/bend-loader.mjs';
import { decodeJob } from './brepfmt.mjs';
import { ROOT, loadCases } from './cases.mjs';
import { generateCase, jobPath } from './fixtures.mjs';
import {
  add, cross, dist, dot, edgeInterval, faceNormal, loopIntegrals, norm, normaliseBody, pointCurveDistance,
  pointSurfaceDistance, scale, sub, surfaceNormal, unit,
} from './geom.mjs';

export const PROTO = 'kernel/proto/fillet-kpart/main.bend';
export const PROBE_DIR = path.join(os.homedir(), 'Workspace/cad/cad-project-041/single-step-r20/kernel-cases');
const TOL = 1e-9;
// Volume agreement with the closed forms and Onshape: the validator's
// tolerance, 1e-7 × the input volume (docs/fillet/harness.md). The angled
// prisms' nominal closed forms are only good to ~1e-7 relative because the
// kernel-built inputs are not exactly at the nominal angle; OCCT on the same
// input is the tight cross-check (required ≤ 1e-9 relative).
const VOL_REL = 1e-7, OCCT_REL = 1e-9;
const REFERENCE = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/fillet/reference.json'), 'utf8')).cases;

// ---------------------------------------------------------------------------
// Ladder text decoding (F32x2 reals as two IEEE-754 words, value hi + lo)

const U = new Uint32Array(1), F = new Float32Array(U.buffer);
const f32 = (w) => { U[0] = Number(w); return F[0]; };

class Words {
  constructor(line) { this.w = line.trim().split(/\s+/); this.i = 0; }
  word() { return this.w[this.i++]; }
  u32() { return Number(this.word()); }
  real() { const hi = f32(this.word()), lo = f32(this.word()); return hi + lo; }
  vec() { return [this.real(), this.real(), this.real()]; }
  p2() { return [this.real(), this.real()]; }
  expect(x) { const w = this.word(); if (w !== x) throw new Error(`ladder: expected ${x}, got ${w}`); }
  rest() { return this.w.slice(this.i).join(' '); }
}

function readSurface(t) {
  const type = t.word();
  if (type === 'plane') return { type, origin: t.vec(), normal: t.vec(), x: t.vec() };
  if (type === 'cylinder' || type === 'sphere') return { type, origin: t.vec(), axis: t.vec(), x: t.vec(), radius: t.real() };
  if (type === 'cone') return { type, origin: t.vec(), axis: t.vec(), x: t.vec(), radius: t.real(), angle: t.real() };
  if (type === 'torus') return { type, origin: t.vec(), axis: t.vec(), x: t.vec(), major: t.real(), minor: t.real() };
  throw new Error(`ladder: surface ${type}`);
}

function readTrack(t) {
  const type = t.word();
  if (type === 'line') return { type, origin: t.vec(), direction: t.vec(), length: t.real() };
  if (type === 'circle') return { type, origin: t.vec(), normal: t.vec(), x: t.vec(), radius: t.real() };
  if (type === 'none') return null;
  throw new Error(`ladder: track ${type}`);
}

export function decodeLadder(text) {
  const L = { notes: [], stripes: [], corners: [], merges: [] };
  let cur = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const t = new Words(line), key = t.word();
    if (key === 'wonky-fillet-ladder') t.expect('1');
    else if (key === 'case') L.id = t.word();
    else if (key === 'op') L.op = t.word();
    else if (key === 'size') L.size = t.real();
    else if (key === 'chamfer-def') L.chamferDef = t.word();
    else if (key === 'propagate') L.propagate = t.word() === '1';
    else if (key === 'note') L.notes.push(t.rest());
    else if (key === 'order') { const n = t.u32(); L.order = Array.from({ length: n }, () => t.u32()); }
    else if (key === 'stripe') {
      const edge = t.u32(), st = t.word();
      if (st === 'refused') { cur = { edge, refused: { class: t.word(), reason: t.rest() }, sides: [], ends: [] }; L.stripes.push(cur); continue; }
      t.expect('faces');
      cur = { edge, faces: [t.u32(), t.u32()], convex: t.word() === 'convex', sides: [], ends: [] };
      t.expect('sin'); cur.sin = t.real();
      t.expect('cos'); cur.cos = t.real();
      t.expect('carrier'); cur.carrier = t.word();
      t.expect('sense'); cur.sense = t.word() === '1';
      L.stripes.push(cur);
    } else if (key === 'section') {
      const fam = t.word();
      cur.section = fam === 'translation'
        ? { family: fam, e: t.vec(), d: t.vec(), u: t.vec(), w: t.vec(), length: t.real() }
        : { family: fam, o: t.vec(), a: t.vec(), r: t.vec(), closed: t.word() === '1' };
    } else if (key === 'corner2') { cur.corner2 = t.p2(); t.expect('centre2'); cur.centre2 = t.p2(); }
    else if (key === 'surface') cur.surface = readSurface(t);
    else if (key === 'spine') cur.spine = readTrack(t);
    else if (key === 'side') {
      const i = t.u32() - 1;
      t.expect('face'); const face = t.u32();
      t.expect('support'); const support = t.word();
      t.expect('contact'); const contact = t.vec();
      t.expect('width'); const width = t.real();
      t.expect('bound'); const bound = t.word();
      t.expect('limit'); const has = t.word() === '1', limit = t.real();
      t.expect('by'); const by = t.word(), id = t.u32();
      cur.sides[i] = { face, support, contact, width, bound, limit: has ? limit : null, by, byId: id };
    } else if (key === 'spring') { const i = t.u32() - 1; cur.sides[i].spring = readTrack(t); }
    else if (key === 'end' && t.w.length === 1) L.complete = true;
    else if (key === 'end') {
      const kind = t.word();
      if (kind === 'closed') cur.ends.push({ kind });
      else if (kind === 'cap' || kind === 'corner') cur.ends.push({ kind, vertex: t.u32() });
      else if (kind === 'mitre') cur.ends.push({ kind, vertex: t.u32(), other: t.u32(), join: t.word() });
      else if (kind === 'chain') cur.ends.push({ kind, vertex: t.u32(), other: t.u32() });
      else if (kind === 'refused') cur.ends.push({ kind, vertex: t.u32(), class: t.word(), reason: t.rest() });
      else throw new Error(`ladder: end ${kind}`);
    } else if (key === 'corner') {
      const vertex = t.u32(), kind = t.word();
      if (kind === 'sphere') L.corners.push({ vertex, kind, centre: t.vec(), radius: t.real() });
      else if (kind === 'triangle') L.corners.push({ vertex, kind, points: [t.vec(), t.vec(), t.vec()] });
      else L.corners.push({ vertex, kind, class: t.word(), reason: t.rest() });
    } else if (key === 'merge') L.merges.push([t.u32(), t.u32(), t.word()]);
    else if (key === 'verdict') {
      const v = t.word();
      L.verdict = v === 'admit' ? { admit: true, stripes: t.u32() } : { admit: false, class: t.word(), reason: t.rest() };
    } else throw new Error(`ladder: unknown record ${key}`);
  }
  return L;
}

// ---------------------------------------------------------------------------
// Geometry checks (float64, independent of the Bend code)

const ang2 = (c, p) => Math.atan2(p[1] - c[1], p[0] - c[0]);
const shortSweep = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

function section2D(sec, X) {
  if (sec.family === 'translation') { const q = sub(X, sec.e); return [dot(sec.u, q), dot(sec.w, q)]; }
  const q = sub(X, sec.o), h = dot(sec.a, q);
  return [norm(sub(q, scale(sec.a, h))), h];
}

// Ball-side unit normal of support face f at p (theory §1.3).
const ballSide = (body, f, p, convex) => scale(faceNormal(body.faces[f], p), convex ? -1 : 1);

// Nearest point of the carrier's spine to p (the ball centre for a fillet).
function ballCentre(s, p) {
  if (s.type === 'sphere') return s.origin;
  if (s.type === 'cylinder') { const q = sub(p, s.origin); return add(s.origin, scale(s.axis, dot(q, s.axis))); }
  if (s.type === 'torus') {
    const q = sub(p, s.origin), h = dot(q, s.axis), rad = sub(q, scale(s.axis, h));
    return add(s.origin, scale(unit(rad), s.major));
  }
  return null;
}

// The support boundary in the section from the corner e2 to the contact p2:
// a line, or an arc of the support's circle (translation family, cylinder).
function supportSegment(body, sec, f, e2, p2) {
  const surf = body.faces[f].surface;
  if (sec.family === 'translation' && surf.type === 'cylinder') {
    const q = section2D(sec, surf.origin), a0 = ang2(q, e2);
    return { type: 'arc', c: q, r: surf.radius, from: a0, to: a0 + shortSweep(a0, ang2(q, p2)) };
  }
  return { type: 'line', a: e2, b: p2 };
}

// The stripe's section region (support boundaries and blend curve) in the
// section plane: area, first moments and centroid (loopIntegrals). Used by
// the stage-2 network checker for its cell volumes (scripts/fillet/network.mjs).
export function stripeSection(body, job, s) {
  const sec = s.section, e2 = s.corner2;
  const [c1, c2] = s.sides.map((sd) => section2D(sec, sd.contact));
  const segs = [supportSegment(body, sec, s.faces[0], e2, c1)];
  if (job.op === 'fillet') {
    const c = s.centre2, a1 = ang2(c, c1);
    segs.push({ type: 'arc', c, r: job.size, from: a1, to: a1 + shortSweep(a1, ang2(c, c2)) });
  } else segs.push({ type: 'line', a: c1, b: c2 });
  const back = supportSegment(body, sec, s.faces[1], e2, c2);
  segs.push(back.type === 'line' ? { type: 'line', a: c2, b: e2 } : { ...back, from: back.to, to: back.from });
  return loopIntegrals(segs);
}

// Volume change of one stripe run over its whole edge: −(convex) / +(concave)
// section area × length, or Pappus × swept angle for the rotation family.
function stripeVolume(body, job, s) {
  const sec = s.section, I = stripeSection(body, job, s), sign = s.convex ? -1 : 1;
  if (sec.family === 'translation') return { dV: sign * I.area * sec.length, area: I.area };
  const e = body.edges[s.edge], { t0, t1 } = edgeInterval(e, body.vertices);
  const sweep = sec.closed ? 2 * Math.PI : Math.abs(t1 - t0);
  return { dV: sign * I.momentX * sweep, area: I.area };
}

function checkStripe(body, job, s) {
  const issues = [], note = (ok, msg) => { if (!ok) issues.push(msg); };
  if (s.refused) return { issues };
  const e = body.edges[s.edge], blend = s.surface;
  s.sides.forEach((sd, i) => {
    const f = s.faces[i], supp = body.faces[f].surface;
    note(f === sd.face, `side ${i + 1} face ${sd.face} is not stripe face ${f}`);
    const dS = pointSurfaceDistance(supp, sd.contact), dB = pointSurfaceDistance(blend, sd.contact);
    note(dS <= TOL, `contact ${i + 1} is ${dS.toExponential(2)} mm off its support`);
    note(dB <= TOL, `contact ${i + 1} is ${dB.toExponential(2)} mm off the carrier`);
    if (job.op === 'fillet') {
      const g1 = norm(cross(surfaceNormal(blend, sd.contact), faceNormal(body.faces[f], sd.contact)));
      note(g1 <= 1e-9, `carrier not G1 with face ${f} at contact ${i + 1} (${g1.toExponential(2)})`);
      const c = ballCentre(blend, sd.contact), want = add(sd.contact, scale(ballSide(body, f, sd.contact, s.convex), job.size));
      note(dist(c, want) <= TOL, `ball centre off the ball side of face ${f} by ${dist(c, want).toExponential(2)}`);
    } else {
      const setback = pointCurveDistance(e.curve, sd.contact);
      note(Math.abs(setback - job.size) <= TOL, `chamfer contact ${i + 1} at setback ${setback} ≠ ${job.size}`);
    }
    if (sd.spring) {
      const far = sd.spring.type === 'line' ? add(sd.spring.origin, scale(sd.spring.direction, sd.spring.length)) : add(sd.spring.origin, scale(sd.spring.x, sd.spring.radius));
      note(pointSurfaceDistance(supp, far) <= TOL, `spring ${i + 1} leaves its support`);
    }
  });
  if (job.op === 'fillet') {
    const rad = blend.type === 'torus' ? blend.minor : blend.radius;
    note(Math.abs(rad - job.size) <= 1e-12, `carrier radius ${rad} ≠ ${job.size}`);
    if (s.spine) {
      const p = s.spine.type === 'line' ? s.spine.origin : add(s.spine.origin, scale(s.spine.x, s.spine.radius));
      for (const f of s.faces) note(Math.abs(pointSurfaceDistance(body.faces[f].surface, p) - job.size) <= TOL, `spine not at distance r from face ${f}`);
    }
  }
  return { issues };
}

function checkCorner(body, job, c) {
  const issues = [];
  if (c.kind === 'sphere') {
    const faces = new Set();
    body.faces.forEach((f, fi) => f.loops.flat().forEach((u) => { const e = body.edges[u.edge]; if (e.start === c.vertex || e.end === c.vertex) faces.add(fi); }));
    for (const fi of faces) {
      const d = pointSurfaceDistance(body.faces[fi].surface, c.centre);
      if (Math.abs(d - job.size) > TOL) issues.push(`corner sphere ${d} from face ${fi}`);
    }
    if (Math.abs(c.radius - job.size) > 1e-12) issues.push('corner radius');
  } else if (c.kind === 'triangle') {
    // Onshape's corner triangle (probe FP-b) runs through the points where
    // the springs on each face meet: each lies at setback d from two of the
    // corner's edges (stage 2; stage 1 put them on the edges).
    const v = c.vertex, es = body.edges.map((e, i) => [e, i]).filter(([e]) => e.start === v || e.end === v).map(([e]) => e);
    for (const q of c.points) {
      const hits = es.filter((e) => Math.abs(pointCurveDistance(e.curve, q) - job.size) <= TOL).length;
      if (hits < 2) issues.push('triangle point not at setback d from two corner edges');
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Onshape probes (read only)

export function onshapeInput(id) {
  const ref = id && path.join(PROBE_DIR, `fp-${id}`, 'reference.json');
  return ref && fs.existsSync(ref) ? JSON.parse(fs.readFileSync(ref, 'utf8')).parts?.[0]?.input_volume_mm3 ?? null : null;
}

export function onshapeProbe(id) {
  const ref = path.join(PROBE_DIR, `fp-${id}`, 'reference.json');
  if (!fs.existsSync(ref)) return null;
  const r = JSON.parse(fs.readFileSync(ref, 'utf8')), p = r.parts?.[0];
  return { code: r.probe?.code, verdict: r.verdict, error: r.onshape?.error ?? null, dV: p?.delta_volume_mm3 ?? null,
    volumeRange: p?.volume_mm3_value_min_max ?? null, faces: p?.face_count ?? null, faceTypes: p?.face_types ?? null,
    faceAreas: p?.faces?.map((f) => [f.type, f.area_mm2_mesh]) ?? null };
}

// The two chamfer-semantics probes as ad-hoc cases (inputs built by the
// kernel; they are not part of the 70-case catalogue).
function hexSource() {
  const pts = Array.from({ length: 6 }, (_, k) => { const a = ((30 + 60 * k) * Math.PI) / 180; return [10 * Math.cos(a), 10 * Math.sin(a)]; });
  const n = (x) => (Math.abs(x) < 1e-12 ? '0' : Number(x.toPrecision(17)).toString());
  const segs = pts.map((p, k) => `    skLineSegment(s0, "e${k}", { "start" : vector(${n(p[0])}, ${n(p[1])}) * millimeter, "end" : vector(${n(pts[(k + 1) % 6][0])}, ${n(pts[(k + 1) % 6][1])}) * millimeter });`);
  return ['FeatureScript 3044;', 'import(path : "onshape/std/geometry.fs", version : "3044.0");', '',
    'export function filletInput(context is Context, id is Id, definition is map)', '{',
    '    var s0 = newSketchOnPlane(context, id + "s0", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(1, 0, 0), vector(0, 1, 0)) });',
    ...segs, '    skSolve(s0);',
    '    opExtrude(context, id + "x1", { "entities" : qSketchRegion(id + "s0"), "direction" : vector(1, 0, 0), "endBound" : BoundingType.BLIND, "endDepth" : 20 * millimeter });',
    '}', ''].join('\n');
}

function boxSource() {
  return ['FeatureScript 3044;', 'import(path : "onshape/std/geometry.fs", version : "3044.0");', '',
    'export function filletInput(context is Context, id is Id, definition is map)', '{',
    '    var s0 = newSketchOnPlane(context, id + "s0", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });',
    '    skRectangle(s0, "e0", { "firstCorner" : vector(0, 0) * millimeter, "secondCorner" : vector(20, 20) * millimeter });',
    '    skSolve(s0);',
    '    opExtrude(context, id + "x1", { "entities" : qSketchRegion(id + "s0"), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 20 * millimeter });',
    '}', ''].join('\n');
}

export const PROBE_CASES = [
  {
    id: 'probe-fp15-chamfer-120-d1', probe: 'chamfer-semantics-120deg-d1', group: 'probe', rank: 99, op: 'chamfer', size: 1, chamferType: 'equal-offsets',
    tangentPropagation: true, expect: 'ok', convexity: ['convex'], blendTypes: ['plane'], select: [{ near: [10, 0, 10] }],
    closedForm: { deltaVolume: -20 * 0.5 * Math.sin((120 * Math.PI) / 180), formula: 'Onshape FP15: setback d along each face, -L d^2 sin(120°)/2' },
    input: { source: hexSource() },
  },
  {
    id: 'probe-fp16-chamfer-box-corner-d1', probe: 'chamfer-semantics-box-corner-d1', group: 'probe', rank: 99, op: 'chamfer', size: 1, chamferType: 'equal-offsets',
    tangentPropagation: true, expect: 'ok', convexity: ['convex'], blendTypes: ['plane'], select: [{ near: [10, 20, 20] }, { near: [20, 10, 20] }, { near: [20, 20, 10] }],
    closedForm: { deltaVolume: -29.333333333333332, formula: 'Onshape FP16: three setback chamfers plus the corner triangle' },
    input: { source: boxSource() },
  },
];

async function probeJob(c, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `${c.id}.job`);
  if (!fs.existsSync(p)) fs.writeFileSync(p, (await generateCase(c)).job);
  return p;
}

// ---------------------------------------------------------------------------

function volumeCheck(L, body, job, c, probe, inputVolume) {
  const ok = L.verdict?.admit && L.corners.length === 0
    && L.stripes.every((s) => !s.refused && s.ends.every((e) => ['cap', 'closed', 'chain'].includes(e.kind))
      && s.sides.every((sd) => sd.bound === 'inside' || sd.bound === 'consumed'));
  if (!ok) return { eligible: false };
  const dV = L.stripes.map((s) => stripeVolume(body, job, s)).reduce((a, x) => a + x.dV, 0);
  const out = { eligible: true, dV };
  // alternatives only where the catalogue accepts them (a rejected reading, e.g. the face-offset chamfer, must not agree)
  const forms = c.closedForm ? { primary: c.closedForm.deltaVolume, ...(c.closedForm.acceptAlternatives ? c.closedForm.alternatives ?? {} : {}) } : {};
  out.closedForm = Object.fromEntries(Object.entries(forms).map(([k, v]) => [k, { value: v, relErr: Math.abs(dV - v) / Math.max(1, Math.abs(v)) }]));
  const tol = VOL_REL * inputVolume;
  for (const v of Object.values(out.closedForm)) v.absErr = Math.abs(dV - v.value);
  out.agrees = Object.entries(out.closedForm).filter(([, v]) => v.absErr <= tol).map(([k]) => k);
  out.tolerance = tol;
  const o = REFERENCE[c.id];
  if (o?.status === 'done') { const occt = o.result.volume - o.input.volume; out.occt = { value: occt, relErr: Math.abs(dV - occt) / Math.max(1, Math.abs(occt)) }; }
  if (probe?.dV !== null && probe?.dV !== undefined) out.onshape = { value: probe.dV, absErr: Math.abs(dV - probe.dV) };
  return out;
}

function outcomeOf(c, L, probe) {
  const admit = !!L.verdict?.admit;
  if (c.expect === 'must-refuse') return admit ? 'WRONG' : 'refused-correctly';
  if (probe?.verdict === 'refused') return admit ? 'WRONG (Onshape refuses)' : 'refused-as-onshape';
  if (c.expect === 'ok') return admit ? 'admitted' : 'declined';
  return admit ? 'admitted (either)' : 'refused (either)';
}

export async function checkCase(mod, c, jobFile, outDir) {
  const text = fs.readFileSync(jobFile, 'utf8');
  const job = decodeJob(text), body = normaliseBody(job.body);
  const t0 = performance.now();
  const ladderText = mod.ladder(text);
  const ms = performance.now() - t0;
  const result = mod.run(text);
  const L = decodeLadder(ladderText);
  const issues = [];
  if (!L.complete) issues.push('ladder text incomplete');
  const stripes = L.stripes.map((s) => ({ edge: s.edge, carrier: s.carrier ?? null, refused: s.refused ?? null, issues: checkStripe(body, job, s).issues }));
  stripes.forEach((s) => s.issues.forEach((m) => issues.push(`edge ${s.edge}: ${m}`)));
  L.corners.forEach((k) => checkCorner(body, job, k).forEach((m) => issues.push(`corner ${k.vertex}: ${m}`)));
  // Stage 2 (corner network) may refuse a case the ladder admits; run() then
  // answers the network's refusal (scripts/fillet/network.mjs checks that).
  // Once both admit, stage 3 answers `ok` with the B-rep, or a typed
  // `not-implemented stage-3 surgery:` refusal.
  const admitResult = /^ok\n/.test(result) || /^unresolved not-implemented stage-3 surgery: /.test(result);
  const netRefuses = typeof mod.network === 'function' && /\nverdict refuse /.test(mod.network(text));
  if (!result.startsWith('unresolved ') && !result.startsWith('ok\n')) issues.push('run() answered neither ok nor a typed refusal');
  if ((admitResult || (netRefuses && !!L.verdict?.admit)) !== !!L.verdict?.admit) issues.push('run() and ladder() disagree on the verdict');
  if (c.blendTypes?.length && L.verdict?.admit) {
    const kinds = new Set(L.stripes.map((s) => s.carrier).concat(L.corners.filter((k) => k.kind === 'sphere').map(() => 'sphere')));
    for (const k of kinds) if (!c.blendTypes.includes(k)) issues.push(`carrier ${k} not in the case's blend types ${c.blendTypes.join('/')}`);
  }
  const probe = onshapeProbe(c.probe ?? c.id);
  const inputVolume = REFERENCE[c.id]?.input?.volume ?? onshapeInput(c.probe) ?? 1;
  const volume = volumeCheck(L, body, job, c, probe, inputVolume);
  if (volume.eligible && Object.keys(volume.closedForm).length && !volume.agrees.length) issues.push(`stripe-sum dV ${volume.dV} matches no closed form`);
  if (volume.occt && volume.occt.relErr > OCCT_REL) issues.push(`stripe-sum dV ${volume.dV} differs from OCCT ${volume.occt.value}`);
  if (volume.onshape && volume.onshape.absErr > volume.tolerance) issues.push(`stripe-sum dV ${volume.dV} differs from Onshape ${volume.onshape.value}`);
  const natives = {};
  for (const tgt of ['cpu1', 'cpuN', 'metal']) {
    const p = path.join(ROOT, 'out/fillet/fillet-kpart/results', `${c.id}.${tgt}.result.ladder`);
    if (fs.existsSync(p)) natives[tgt] = fs.readFileSync(p, 'utf8') === ladderText ? 'identical' : 'DIFFERENT';
  }
  Object.entries(natives).forEach(([t, v]) => { if (v !== 'identical') issues.push(`${t} ladder differs from JS`); });
  if (outDir) fs.writeFileSync(path.join(outDir, `${c.id}.ladder`), ladderText);
  return {
    id: c.id, group: c.group, expect: c.expect, op: c.op, size: c.size, outcome: outcomeOf(c, L, probe), ms,
    verdict: L.verdict, notes: L.notes, order: L.order, stripes,
    corners: L.corners.map((k) => ({ vertex: k.vertex, kind: k.kind, ...(k.kind === 'triangle' ? { area: norm(cross(sub(k.points[1], k.points[0]), sub(k.points[2], k.points[0]))) / 2 } : {}) })),
    merges: L.merges, ends: L.stripes.flatMap((s) => s.ends.map((e) => (e.kind === 'mitre' ? `mitre-${e.join}` : e.kind))),
    bounds: L.stripes.flatMap((s) => s.sides.map((sd) => sd.bound)),
    contactChords: job.op === 'chamfer' ? L.stripes.filter((s) => !s.refused).map((s) => dist(s.sides[0].contact, s.sides[1].contact)) : undefined,
    volume, onshape: probe, natives, issues, result: result.split('\n')[0],
  };
}

const tally = (xs) => Object.entries(xs.reduce((m, k) => ({ ...m, [k]: (m[k] ?? 0) + 1 }), {})).map(([k, n]) => `${n} ${k}`).join(', ');

export function summary(rep) {
  const L = ['# fillet-kpart stage 1: ladder check (scripts/fillet/ladder.mjs)', '', `${rep.capturedAt} · Bend JS target · ${rep.cases.length} cases`, ''];
  L.push(`Outcomes: ${tally(rep.cases.map((c) => c.outcome))}`, '');
  for (const g of [...new Set(rep.cases.map((c) => c.group))]) L.push(`- ${g}: ${tally(rep.cases.filter((c) => c.group === g).map((c) => c.outcome))}`);
  L.push('', `Geometry issues: ${rep.cases.reduce((a, c) => a + c.issues.length, 0)}`);
  const vol = rep.cases.filter((c) => c.volume.eligible);
  const occt = vol.filter((c) => c.volume.occt);
  L.push(`Stripe-sum volume checks: ${vol.length} eligible; ${vol.filter((c) => c.volume.agrees?.length).length} agree with a closed form (≤ 1e-7 × input volume); ${occt.length} have an OCCT result, max relative difference ${Math.max(0, ...occt.map((c) => c.volume.occt.relErr)).toExponential(1)}; ${vol.filter((c) => c.volume.onshape).length} have an Onshape probe`, '');
  L.push('| case | expect | outcome | verdict | stripes | ends | bounds | stripe-sum ΔV | closed form | vs OCCT | Onshape ΔV | issues |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const c of rep.cases) {
    const v = c.verdict?.admit ? `admit ${c.verdict.stripes}` : `refuse ${c.verdict?.class ?? '?'}`;
    const cf = c.volume.eligible ? (c.volume.agrees?.length ? c.volume.agrees.join('/') : (Object.keys(c.volume.closedForm ?? {}).length ? 'DIFFERS' : '-')) : '-';
    const os = c.onshape ? (c.onshape.verdict === 'refused' ? `refused ${c.onshape.error}` : (c.onshape.dV ?? 0).toFixed(4)) : '-';
    L.push(`| ${c.id} | ${c.expect} | ${c.outcome} | ${v} | ${tally(c.stripes.map((s) => s.carrier ?? 'refused'))} | ${tally(c.ends)} | ${tally(c.bounds)} | ${c.volume.eligible ? c.volume.dV.toFixed(6) : '-'} | ${cf} | ${c.volume.occt ? c.volume.occt.relErr.toExponential(0) : '-'} | ${os} | ${c.issues.join('; ').slice(0, 120)} |`);
  }
  return L.join('\n') + '\n';
}

async function main(argv) {
  const arg = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
  const only = arg('--cases')?.split(','), group = arg('--group');
  const outDir = path.resolve(arg('--out') ?? path.join(ROOT, 'out/fillet/fillet-kpart/ladder'));
  fs.mkdirSync(outDir, { recursive: true });
  const mod = await loadBend(path.join(ROOT, PROTO));
  const list = [];
  for (const c of loadCases()) if ((!only || only.includes(c.id)) && (!group || c.group === group)) list.push([c, jobPath(c.id)]);
  if (argv.includes('--probes')) for (const c of PROBE_CASES) if (!only || only.includes(c.id)) list.push([c, await probeJob(c, path.join(ROOT, 'tmp/fillet/a1/probes'))]);
  const cases = [];
  for (const [c, file] of list) cases.push(await checkCase(mod, c, file, outDir));
  const rep = { capturedAt: new Date().toISOString(), proto: 'fillet-kpart', stage: 1, cases };
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(rep, null, 1));
  fs.writeFileSync(path.join(outDir, 'summary.md'), summary(rep));
  const bad = cases.filter((c) => c.issues.length || c.outcome.startsWith('WRONG') || c.outcome === 'declined');
  console.log(summary(rep).split('\n').slice(0, 12).join('\n'));
  for (const c of bad) console.log(`! ${c.id}: ${c.outcome} ${c.issues.join('; ')}`);
  process.exitCode = bad.length ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) await main(process.argv.slice(2));
