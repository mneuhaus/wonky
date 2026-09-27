#!/usr/bin/env node
// Fillet harness TEST INFRASTRUCTURE: independent checker of prototype A's
// stage-2 corner network (kernel/proto/fillet-kpart/corners.bend,
// docs/fillet/proto-kpart.md "Stage A2").
//
//   node scripts/fillet/network.mjs [--cases a,b] [--group g] [--probes] [--constructed] [--out dir]
//
// For every case it runs the prototype's `ladder(job)` and `network(job)`
// exports on the Bend JS target and re-checks every tip, corner and consumed
// face in float64 with scripts/fillet/geom.mjs. It builds no blend itself; it
// evaluates what the network states:
//   - tips: the end curve starts at p1 and ends at p2; 17 samples lie on the
//     stripe's carrier and in the cut plane; p1/p2 lie on their support faces
//     and on the edge they are attached to (inside its extent); fillet tips
//     are G1 with the supports at p1/p2 and sweep less than π;
//   - caps: the cut plane is the cap face's plane; mitres: the curve also lies
//     on the partner stripe's carrier and the partner's tip has the same end
//     points; chains: the partner's tip has the same points and curve;
//   - sphere corners: the ball touches the three faces (distance r), its feet
//     are the tips' end points, the tips' arcs lie on the ball; chamfer
//     corners: the triangle's points lie on the faces and are the tips' ends;
//   - consumed faces: a full round has one carrier and the same spring ends;
//   - the volume change by cells: each stripe's section area × its length at
//     the section centroid between its two cut planes (Pappus × the swept
//     angle for rotation stripes), plus a cell per corner (sphere corner:
//     (r/3)·Σ face quads − Ω r³/3; chamfer corner: the polyhedron between the
//     vertex, the three edge points of the cut planes and the triangle).
//     Compared with the closed form (and its alternatives), OCCT and the
//     Onshape probes.
// --probes adds the two Onshape chamfer probes (as scripts/fillet/ladder.mjs),
// --constructed the stage-2 cases below (built into tmp/fillet/a2/cases).
// Native targets write <result>.network sidecars (run.mjs); when present they
// are compared byte for byte with the JS network text.

import fs from 'node:fs';
import path from 'node:path';
import { loadBend } from '../../src/bend-loader.mjs';
import { decodeJob, decodeResult } from './brepfmt.mjs';
import { ROOT, loadCases } from './cases.mjs';
import { divVolume } from './divvolume.mjs';
import { generateCase, jobPath } from './fixtures.mjs';
import {
  add, cross, curvePoint, dist, dot, edgeInterval, faceNormal, norm, normaliseBody, pointEdgeDistance,
  pointSurfaceDistance, scale, sub, surfaceNormal, unit,
} from './geom.mjs';
import { PROBE_CASES, PROTO, decodeLadder, onshapeInput, onshapeProbe, stripeSection } from './ladder.mjs';

const TOL = 1e-9;
// Volume agreement: the validator's 1e-7 × input volume for the closed forms
// and Onshape; OCCT is the tight cross-check at 1e-9 × input volume (its
// mitre and corner volumes carry ~1e-11 × V of their own: on the mitre cases
// the cells equal the closed form to 4e-15 while OCCT is 3e-8 off). OCCT
// results that BRepCheck rejects (the boss root) are not compared.
const VOL_REL = 1e-7, OCCT_REL = 1e-9;
const REFERENCE = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/fillet/reference.json'), 'utf8')).cases;

// Closed forms derived here for cases the catalogue leaves without one
// (INFERRED; see docs/fillet/proto-kpart.md "Stage A2").
const EXTRA_FORMS = {
  // Onshape FP08: both root blends extended to their mitre (no horn torus):
  // four sides of 10 mm, four reflex corners, ΔV = P·A + 4·2·A·x̄ with the
  // spandrel A = r²(1 − π/4) and its centroid offset x̄ = r(5/6 − π/4)/(1 − π/4).
  'hard-boss-root-concave-mitres-r1': { extendedMitre: 40 * (1 - Math.PI / 4) + 4 * (5 / 3 - Math.PI / 2) },
};

// ---------------------------------------------------------------------------
// Constructed stage-2 cases (inputs built by the kernel into
// tmp/fillet/a2/cases; not part of the 70-case catalogue). Each one drives a
// corner rule the catalogue does not reach.

const num = (x) => (Math.abs(x) < 1e-12 ? '0' : Number(x.toPrecision(17)).toString());

// A prism: the polygon pts (sketch coordinates) on the sketch plane
// (origin o, normal n, x axis x), extruded along n by depth.
function prismSource(pts, o, n, x, depth) {
  const v = (p) => `vector(${num(p[0])}, ${num(p[1])}) * millimeter`;
  const segs = pts.map((p, k) => `    skLineSegment(s0, "e${k}", { "start" : ${v(p)}, "end" : ${v(pts[(k + 1) % pts.length])} });`);
  const vec = (a) => `vector(${a.map(num).join(', ')})`;
  return ['FeatureScript 3044;', 'import(path : "onshape/std/geometry.fs", version : "3044.0");', '',
    'export function filletInput(context is Context, id is Id, definition is map)', '{',
    `    var s0 = newSketchOnPlane(context, id + "s0", { "sketchPlane" : plane(${vec(o)} * millimeter, ${vec(n)}, ${vec(x)}) });`,
    ...segs, '    skSolve(s0);',
    `    opExtrude(context, id + "x1", { "entities" : qSketchRegion(id + "s0"), "direction" : ${vec(n)}, "endBound" : BoundingType.BLIND, "endDepth" : ${num(depth)} * millimeter });`,
    '}', ''].join('\n');
}

const A = (r) => r * r * (1 - Math.PI / 4);
export const A2_DIR = path.join(ROOT, 'tmp/fillet/a2/cases');

export async function constructedJob(c) {
  fs.mkdirSync(A2_DIR, { recursive: true });
  const p = path.join(A2_DIR, `${c.id}.job`);
  if (!fs.existsSync(p)) fs.writeFileSync(p, (await generateCase(c)).job);
  return p;
}
const base = { group: 'a2', rank: 99, tangentPropagation: true, chamferType: 'equal-offsets', convexity: ['convex'] };

export const A2_CASES = [
  {
    ...base, id: 'a2-oblique-cap-parallelogram-r2', op: 'fillet', size: 2, expect: 'ok', blendTypes: ['cylinder'],
    // Top front edge of a parallelogram prism: both caps are the slanted side
    // walls, oblique to the edge (ellipse caps). The walls are parallel, so the
    // length at any section point is 20: ΔV = −20·r²(1 − π/4).
    select: [{ near: [10, 0, 10] }], input: { source: prismSource([[0, 0], [20, 0], [25, 10], [5, 10]], [0, 0, 0], [0, 0, 1], [1, 0, 0], 10) },
    closedForm: { deltaVolume: -20 * A(2), formula: 'parallel oblique caps: -L r^2 (1 - pi/4), L = 20' },
  },
  {
    ...base, id: 'a2-oblique-cap-parallelogram-d1', op: 'chamfer', size: 1, expect: 'ok', blendTypes: ['plane'],
    select: [{ near: [10, 0, 10] }], input: { source: prismSource([[0, 0], [20, 0], [25, 10], [5, 10]], [0, 0, 0], [0, 0, 1], [1, 0, 0], 10) },
    closedForm: { deltaVolume: -20 * 0.5, formula: 'parallel oblique caps: -L d^2/2, L = 20' },
  },
  {
    ...base, id: 'a2-setback-mitre-wedge-r1', op: 'fillet', size: 1, expect: 'ok', blendTypes: ['cylinder'],
    // Triangular prism: the 45° edge and the 90° end edge meet on the bottom
    // face; their outer springs reach the third edge at different heights (r
    // and r(1 + 1/√2)), so the mitre is a setback mitre: the 90° blend ends in
    // the mitre ellipse, the 45° blend continues over the trim circle on the
    // end face (corners.bend "Setback mitres").
    select: [{ near: [10, 10, 0] }, { near: [20, 5, 0] }], input: { source: prismSource([[0, 0], [10, 0], [0, 10]], [0, 0, 0], [1, 0, 0], [0, 1, 0], 20) },
    closedForm: {
      deltaVolume: -26.468981543858696,
      formula: 'slice integral over the height t above the bottom: the slice x in [0, 20 - w90(t)], y in [0, 10 - t - w45(t)] (intersection semantics, mitred), Gauss-Legendre on t = r(1 - cos φ) and t = r(1 + sin ψ) (tmp/fillet/fix-kpart/wedge-cf.mjs)',
      label: 'INFERRED (fix:fillet-kpart)', note: 'Onshape not probed for unequal-depth mitres',
    },
  },
  {
    ...base, id: 'a2-pinched-trapezoid-r5', op: 'fillet', size: 5, expect: 'either', blendTypes: ['cylinder'],
    // The spring on the trapezoid top reaches the slanted back edge only at
    // its end: the face would be pinched at a point (refused, face-consumed).
    select: [{ near: [10, 0, 10] }], input: { source: prismSource([[0, 0], [20, 0], [20, 10], [0, 5]], [0, 0, 0], [0, 0, 1], [1, 0, 0], 10) },
  },
];

// ---------------------------------------------------------------------------
// Network text decoding (F32x2 reals as two IEEE-754 words, value hi + lo)

const U = new Uint32Array(1), F = new Float32Array(U.buffer);
const f32 = (w) => { U[0] = Number(w); return F[0]; };

class Words {
  constructor(line) { this.w = line.trim().split(/\s+/); this.i = 0; }
  word() { return this.w[this.i++]; }
  u32() { return Number(this.word()); }
  real() { const hi = f32(this.word()), lo = f32(this.word()); return hi + lo; }
  vec() { return [this.real(), this.real(), this.real()]; }
  expect(x) { const w = this.word(); if (w !== x) throw new Error(`network: expected ${x}, got ${w}`); }
  rest() { return this.w.slice(this.i).join(' '); }
  more() { return this.i < this.w.length; }
}

function readCurve(t) {
  const type = t.word();
  if (type === 'line') return { type, origin: t.vec(), direction: t.vec() };
  if (type === 'circle') return { type, origin: t.vec(), normal: t.vec(), x: t.vec(), radius: t.real() };
  if (type === 'ellipse') return { type, origin: t.vec(), normal: t.vec(), x: t.vec(), major: t.real(), minor: t.real() };
  throw new Error(`network: curve ${type}`);
}

function readAt(t) { const kind = t.word(); return { kind, id: t.u32() }; }

export function decodeNetwork(text) {
  const N = { tips: [], corners: [], consumed: [] };
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const t = new Words(line), key = t.word();
    if (key === 'wonky-fillet-network') t.expect('1');
    else if (key === 'case') N.id = t.word();
    else if (key === 'op') N.op = t.word();
    else if (key === 'size') N.size = t.real();
    else if (key === 'tip') {
      const edge = t.u32(), w = t.word();
      if (w === 'closed') { N.tips.push({ edge, kind: 'closed' }); continue; }
      const vertex = Number(w), kind = t.word();
      if (kind === 'refused') { N.tips.push({ edge, vertex, kind, class: t.word(), reason: t.rest() }); continue; }
      const tip = { edge, vertex, kind, with: t.u32() };
      t.expect('cut'); tip.cut = { origin: t.vec(), normal: t.vec() };
      t.expect('p1'); tip.p1 = t.vec(); tip.at1 = readAt(t);
      t.expect('p2'); tip.p2 = t.vec(); tip.at2 = readAt(t);
      t.expect('curve'); tip.curve = readCurve(t);
      t.expect('range'); tip.t0 = t.real(); tip.t1 = t.real();
      // A setback mitre's second piece (corners.bend "Setback mitres"): the
      // trim curve on the shorter blend's outer face, from pm to the tip's
      // point on side `side` (side 2: curve p1 -> pm, trim pm -> p2; side 1:
      // trim p1 -> pm, curve pm -> p2).
      if (t.more()) {
        t.expect('trim');
        const tr = { side: t.u32() };
        t.expect('face'); tr.face = t.u32();
        t.expect('pm'); tr.pm = t.vec();
        t.expect('cut'); tr.cut = { origin: t.vec(), normal: t.vec() };
        t.expect('curve'); tr.curve = readCurve(t);
        t.expect('range'); tr.t0 = t.real(); tr.t1 = t.real();
        tip.trim = tr;
      }
      N.tips.push(tip);
    } else if (key === 'corner') {
      const vertex = t.u32(), kind = t.word();
      if (kind === 'refused') { N.corners.push({ vertex, kind, class: t.word(), reason: t.rest() }); continue; }
      const c = { vertex, kind };
      if (kind === 'sphere') { c.centre = t.vec(); c.radius = t.real(); } else { c.plane = { origin: t.vec(), normal: t.vec() }; }
      t.expect('faces'); c.faces = [t.u32(), t.u32(), t.u32()];
      t.expect('feet'); c.feet = [t.vec(), t.vec(), t.vec()];
      N.corners.push(c);
    } else if (key === 'consumed') {
      const face = t.u32(), kind = t.word();
      if (kind === 'refused') N.consumed.push({ face, kind, class: t.word(), reason: t.rest() });
      else if (kind === 'axis') N.consumed.push({ face, kind, edge: t.u32() });
      else N.consumed.push({ face, kind, edge: t.u32(), with: t.u32() });
    } else if (key === 'verdict') {
      const v = t.word();
      N.verdict = v === 'admit' ? { admit: true, counts: t.rest() } : { admit: false, class: t.word(), reason: t.rest() };
    } else if (key === 'end') N.complete = true;
    else throw new Error(`network: unknown record ${key}`);
  }
  return N;
}

// ---------------------------------------------------------------------------
// Geometry checks

const facesOfEdge = (body, e) => {
  const out = [];
  body.faces.forEach((f, fi) => f.loops.flat().forEach((u) => { if (u.edge === e) out.push(fi); }));
  return out;
};

const planeDist = (pl, p) => Math.abs(dot(sub(p, pl.origin), unit(pl.normal)));
// The ends of a tip's own curve (without a setback trim: p1, p2).
const mitreEnds = (tip) => (!tip.trim ? [tip.p1, tip.p2] : tip.trim.side === 2 ? [tip.p1, tip.trim.pm] : [tip.trim.pm, tip.p2]);
const samples = (tip, n = 16) => Array.from({ length: n + 1 }, (_, i) => curvePoint(tip.curve, tip.t0 + ((tip.t1 - tip.t0) * i) / n));

function checkTip(body, job, L, N, tip) {
  const issues = [], note = (ok, msg) => { if (!ok) issues.push(msg); };
  const s = L.stripes.find((x) => x.edge === tip.edge);
  if (!s || s.refused) return ['tip of a stripe the ladder does not admit'];
  note(tip.t1 > tip.t0, 'empty range');
  // The tip curve's own ends: p1 -> p2, or with a setback trim p1 -> pm
  // (side 2) or pm -> p2 (side 1).
  const tr = tip.trim, [c1, c2] = mitreEnds(tip);
  note(dist(curvePoint(tip.curve, tip.t0), c1) <= TOL, `curve start ${dist(curvePoint(tip.curve, tip.t0), c1).toExponential(2)} from ${tr?.side === 1 ? 'pm' : 'p1'}`);
  note(dist(curvePoint(tip.curve, tip.t1), c2) <= TOL, `curve end ${dist(curvePoint(tip.curve, tip.t1), c2).toExponential(2)} from ${tr?.side === 2 ? 'pm' : 'p2'}`);
  if (tr) {
    const [q1, q2] = tr.side === 2 ? [tr.pm, tip.p2] : [tip.p1, tr.pm];
    note(tip.kind === 'mitre' && job.op === 'fillet', 'a trim on a tip that is not a fillet mitre');
    note(tr.t1 > tr.t0 && tr.t1 - tr.t0 < Math.PI, 'trim range empty or π or more');
    note(dist(curvePoint(tr.curve, tr.t0), q1) <= TOL && dist(curvePoint(tr.curve, tr.t1), q2) <= TOL, 'trim curve does not run between its end points');
    const qs = samples(tr), face = body.faces[tr.face];
    note(Math.max(...qs.map((p) => pointSurfaceDistance(s.surface, p))) <= TOL, 'trim curve off the carrier');
    note(Math.max(...qs.map((p) => planeDist(tr.cut, p))) <= TOL, 'trim curve off its cut plane');
    note(face?.surface.type === 'plane' && qs.every((p) => pointSurfaceDistance(face.surface, p) <= TOL), `trim curve off face ${tr.face}`);
    const o = L.stripes.find((x) => x.edge === tip.with);
    note(!!o && pointSurfaceDistance(o.surface, tr.pm) <= TOL, 'pm off the partner carrier');
    note(!!o && o.faces.includes(tr.face), `trim face ${tr.face} is not a support of the partner ${tip.with}`);
  }
  if (job.op === 'fillet') note(tip.t1 - tip.t0 < Math.PI, 'fillet end arc sweeps π or more');
  const ps = samples(tip);
  const onCarrier = Math.max(...ps.map((p) => pointSurfaceDistance(s.surface, p)));
  note(onCarrier <= TOL, `end curve ${onCarrier.toExponential(2)} off the carrier`);
  const onCut = Math.max(...ps.map((p) => planeDist(tip.cut, p)));
  note(onCut <= TOL, `end curve ${onCut.toExponential(2)} off the cut plane`);
  [[tip.p1, tip.at1, 0], [tip.p2, tip.at2, 1]].forEach(([p, at, i]) => {
    const f = s.faces[i], face = body.faces[f];
    // Stage 3 notches (notch.bend): a side whose support is consumed by a
    // notch ends on the neighbouring face N (the other face of the bound
    // edge), a side consumed by a meet on the other blend's carrier; neither
    // touches its own support, so the support and G1 checks do not apply.
    const eaten = N.consumed.find((c) => c.face === f && (c.kind === 'notch' || c.kind === 'meet'));
    if (eaten) {
      let onN;
      if (eaten.kind === 'notch') {
        const nf = facesOfEdge(body, eaten.with).find((x) => x !== f);
        onN = nf === undefined ? Infinity : pointSurfaceDistance(body.faces[nf].surface, p);
      } else {
        const other = L.stripes.find((x) => x.edge === (eaten.edge === tip.edge ? eaten.with : eaten.edge));
        onN = other ? pointSurfaceDistance(other.surface, p) : Infinity;
      }
      note(onN <= TOL, `p${i + 1} ${onN.toExponential(2)} off the notch neighbour of consumed face ${f}`);
      if (at.kind === 'edge') note(pointEdgeDistance(body.edges[at.id], body.vertices, p) <= TOL || eaten.kind === 'notch', `p${i + 1} off edge ${at.id}`);
      return;
    }
    const dS = pointSurfaceDistance(face.surface, p);
    note(dS <= TOL, `p${i + 1} ${dS.toExponential(2)} off support face ${f}`);
    if (at.kind === 'edge') {
      const dE = pointEdgeDistance(body.edges[at.id], body.vertices, p);
      note(dE <= TOL, `p${i + 1} ${dE.toExponential(2)} off edge ${at.id}`);
    } else {
      const dF = pointSurfaceDistance(body.faces[at.id].surface, p);
      note(dF <= TOL, `p${i + 1} ${dF.toExponential(2)} off face ${at.id}`);
    }
    if (job.op === 'fillet') {
      const g1 = norm(cross(surfaceNormal(s.surface, p), faceNormal(face, p)));
      note(g1 <= 1e-9, `not G1 with face ${f} at p${i + 1} (${g1.toExponential(2)})`);
    }
  });
  if (tip.kind === 'cap') {
    const cap = body.faces[tip.with].surface;
    note(cap.type === 'plane' && ps.every((p) => pointSurfaceDistance(cap, p) <= TOL), `cap curve off cap face ${tip.with}`);
  }
  if (tip.kind === 'mitre' || tip.kind === 'chain') {
    const o = L.stripes.find((x) => x.edge === tip.with);
    const other = N.tips.find((x) => x.edge === tip.with && x.vertex === tip.vertex);
    if (!o || !other) issues.push(`${tip.kind} partner ${tip.with} has no tip at vertex ${tip.vertex}`);
    else {
      const off = Math.max(...ps.map((p) => pointSurfaceDistance(o.surface, p)));
      note(off <= TOL, `${tip.kind} curve ${off.toExponential(2)} off the partner's carrier`);
      const same = (a, b) => dist(a, b) <= TOL;
      const [a1, a2] = mitreEnds(tip), [b1, b2] = mitreEnds(other);
      note((same(a1, b1) && same(a2, b2)) || (same(a1, b2) && same(a2, b1)), `${tip.kind} end points differ from the partner's`);
    }
  }
  if (tip.kind === 'corner-sphere' || tip.kind === 'corner-triangle') {
    const c = N.corners.find((x) => x.vertex === tip.vertex);
    if (!c) issues.push('no corner record');
    else {
      const foot = (f) => c.feet[c.faces.indexOf(f)];
      note(dist(foot(s.faces[0]), tip.p1) <= TOL && dist(foot(s.faces[1]), tip.p2) <= TOL, 'tip ends are not the corner feet');
      if (c.kind === 'sphere') {
        const off = Math.max(...ps.map((p) => Math.abs(dist(p, c.centre) - c.radius)));
        note(off <= TOL, `corner arc ${off.toExponential(2)} off the corner ball`);
      }
    }
  }
  return issues;
}

function checkCorner(body, job, c) {
  const issues = [];
  if (c.kind === 'refused') return issues;
  c.faces.forEach((f, i) => {
    const pl = body.faces[f].surface;
    if (pl.type !== 'plane') issues.push(`corner face ${f} is not a plane`);
    if (pointSurfaceDistance(pl, c.feet[i]) > TOL) issues.push(`foot ${i + 1} off face ${f}`);
    if (c.kind === 'sphere') {
      if (Math.abs(pointSurfaceDistance(pl, c.centre) - job.size) > TOL) issues.push(`ball ${pointSurfaceDistance(pl, c.centre)} from face ${f}`);
      if (Math.abs(dist(c.feet[i], c.centre) - job.size) > TOL) issues.push(`foot ${i + 1} not on the ball`);
    } else if (planeDist(c.plane, c.feet[i]) > TOL) issues.push(`foot ${i + 1} off the corner triangle`);
  });
  if (c.kind === 'triangle') {
    const v = body.vertices[c.vertex], n = unit(c.plane.normal);
    if (!(dot(n, sub(v, c.feet[0])) > 0)) issues.push('corner triangle faces into the material');
  }
  return issues;
}

function checkConsumed(body, L, N, k) {
  if (k.kind === 'refused') return [];
  const s = L.stripes.find((x) => x.edge === k.edge), issues = [];
  if (!s) return ['consumption by an unknown stripe'];
  const side = s.faces.indexOf(k.face);
  if (side < 0) issues.push(`face ${k.face} is not a support of edge ${k.edge}`);
  if (k.kind === 'merge') {
    const o = L.stripes.find((x) => x.edge === k.with);
    const a = s.surface, b = o?.surface;
    if (!b || a.type !== b.type || Math.abs((a.radius ?? a.minor) - (b.radius ?? b.minor)) > TOL
      || norm(cross(unit(a.axis), unit(b.axis))) > TOL || dist(a.origin, add(b.origin, scale(unit(b.axis), dot(sub(a.origin, b.origin), unit(b.axis))))) > TOL) issues.push('full round of two different carriers');
    const pts = (e, face) => {
      const st = L.stripes.find((x) => x.edge === e), i = st.faces.indexOf(face);
      return N.tips.filter((t) => t.edge === e && t.p1).map((t) => (i === 0 ? t.p1 : t.p2));
    };
    const pa = pts(k.edge, k.face), pb = pts(k.with, k.face);
    if (!pa.every((p) => pb.some((q) => dist(p, q) <= TOL))) issues.push('full-round springs end at different points');
  }
  if (k.kind === 'edge') {
    const e = body.edges[k.with];
    const pa = N.tips.filter((t) => t.edge === k.edge && t.p1).map((t) => (side === 0 ? t.p1 : t.p2));
    if (!pa.every((p) => [body.vertices[e.start], body.vertices[e.end]].some((q) => dist(p, q) <= TOL))) issues.push(`springs do not end at edge ${k.with}'s vertices`);
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Volume by cells

// Signed angle from a to b about the unit axis n.
const angleAbout = (n, a, b) => Math.atan2(dot(n, cross(a, b)), dot(a, b));

function stripeCell(body, job, L, N, s) {
  const I = stripeSection(body, job, s), sec = s.section, sign = s.convex ? -1 : 1;
  const e = body.edges[s.edge], tips = N.tips.filter((t) => t.edge === s.edge);
  if (sec.family === 'translation') {
    const c3 = add(sec.e, add(scale(sec.u, I.centroid[0]), scale(sec.w, I.centroid[1])));
    const at = (v) => {
      const t = tips.find((x) => x.vertex === v);
      const n = unit(t.cut.normal);
      return dot(n, sub(t.cut.origin, c3)) / dot(n, sec.d);
    };
    const len = at(e.end) - at(e.start);
    return { dV: sign * I.area * len, length: len };
  }
  if (sec.closed) return { dV: sign * I.momentX * 2 * Math.PI };
  const radial = (p) => { const q = sub(p, sec.o); return unit(sub(q, scale(sec.a, dot(q, sec.a)))); };
  const ts = tips.find((x) => x.vertex === e.start), te = tips.find((x) => x.vertex === e.end);
  const { t0, t1 } = edgeInterval(e, body.vertices);
  const dir = Math.sign(t1 - t0) * Math.sign(dot(unit(e.curve.normal), sec.a)) || 1;
  let phi = dir * angleAbout(sec.a, radial(ts.p1), radial(te.p1));
  if (phi <= 0) phi += 2 * Math.PI;
  return { dV: sign * I.momentX * phi, sweep: phi };
}

const tri = (a, b, c) => norm(cross(sub(b, a), sub(c, a))) / 2;
const tet = (a, b, c, d) => Math.abs(dot(sub(b, a), cross(sub(c, a), sub(d, a)))) / 6;

function cornerCell(body, job, L, N, c) {
  const v = body.vertices[c.vertex];
  const edges = body.edges.map((e, i) => [e, i]).filter(([e, i]) => (e.start === c.vertex || e.end === c.vertex) && L.order.includes(i)).map(([, i]) => i);
  const convex = L.stripes.find((s) => s.edge === edges[0]).convex, sign = convex ? -1 : 1;
  // The edge point of each stripe's cut plane at this corner.
  const E = new Map(edges.map((k) => {
    const t = N.tips.find((x) => x.edge === k && x.vertex === c.vertex), e = body.edges[k];
    const other = body.vertices[e.start === c.vertex ? e.end : e.start], d = unit(sub(other, v)), n = unit(t.cut.normal);
    return [k, add(v, scale(d, dot(n, sub(t.cut.origin, v)) / dot(n, d)))];
  }));
  const onFace = (f) => edges.filter((k) => facesOfEdge(body, k).includes(f));
  if (c.kind === 'sphere') {
    let quads = 0;
    c.faces.forEach((f, i) => { const [a, b] = onFace(f); quads += norm(cross(sub(c.feet[i], v), sub(E.get(b), E.get(a)))) / 2; });
    const [a, b, d] = c.feet.map((p) => unit(sub(p, c.centre)));
    const omega = 2 * Math.atan2(Math.abs(dot(a, cross(b, d))), 1 + dot(a, b) + dot(b, d) + dot(d, a));
    return sign * ((job.size / 3) * quads - (omega * job.size ** 3) / 3);
  }
  // Chamfer corner: tetrahedra from the vertex over the three end triangles
  // (E_k, Q_a, Q_b) and the corner triangle.
  let vol = tet(v, ...c.feet);
  for (const k of edges) {
    const [fa, fb] = facesOfEdge(body, k);
    vol += tet(v, E.get(k), c.feet[c.faces.indexOf(fa)], c.feet[c.faces.indexOf(fb)]);
  }
  return sign * vol;
}

// The closed forms of a case (primary, the alternatives the catalogue
// accepts, the extra forms here).
const formsOf = (c) => ({ ...(c.closedForm ? { primary: c.closedForm.deltaVolume, ...(c.closedForm.acceptAlternatives ? c.closedForm.alternatives ?? {} : {}) } : {}), ...(EXTRA_FORMS[c.id] ?? {}) });

// The result B-rep's own volume change (scripts/fillet/divvolume.mjs: the
// divergence theorem on its exact faces and edges, less the job body's), against
// the closed forms.
function brepVolume(result, c, job) {
  if (!/^ok\n/.test(result)) return null;
  const d = divVolume(decodeResult(result).body), d0 = divVolume(job.body);
  if (d.errors || d0.errors) return { unsupported: (d.errors ?? d0.errors)[0] };
  const inputVolume = d0.volume;
  const dV = d.volume - inputVolume, tol = VOL_REL * inputVolume;
  const closedForm = Object.fromEntries(Object.entries(formsOf(c)).map(([k, v]) => [k, { value: v, absErr: Math.abs(dV - v) }]));
  return { dV, closedForm, agrees: Object.entries(closedForm).filter(([, v]) => v.absErr <= tol).map(([k]) => k) };
}

function volumeCheck(L, N, body, job, c, probe, inputVolume) {
  if (!N.verdict?.admit) return { eligible: false };
  // A setback mitre ends its long stripe partly on the trim plane: the cells
  // (each stripe between its two cut planes) do not cover that; the B-rep
  // volume (brepVolume) checks these cases.
  if (N.tips.some((t) => t.trim)) return { eligible: false, why: 'setback mitre: no trim cell; see the B-rep volume' };
  // The cells are stage 2: they do not model the stage-3 notches (a notched
  // side keeps its blend up to the neighbour); the B-rep volume checks these.
  if (N.consumed.some((k) => k.kind === 'notch' || k.kind === 'meet')) return { eligible: false, why: 'notch: the cells do not model it; see the B-rep volume' };
  let dV = 0;
  const cells = [];
  for (const s of L.stripes) { const x = stripeCell(body, job, L, N, s); dV += x.dV; cells.push({ edge: s.edge, ...x }); }
  for (const k of N.corners) { const x = cornerCell(body, job, L, N, k); dV += x; cells.push({ corner: k.vertex, dV: x }); }
  const out = { eligible: true, dV, cells };
  const forms = formsOf(c);
  const tol = VOL_REL * inputVolume;
  out.closedForm = Object.fromEntries(Object.entries(forms).map(([k, v]) => [k, { value: v, absErr: Math.abs(dV - v) }]));
  out.agrees = Object.entries(out.closedForm).filter(([, v]) => v.absErr <= tol).map(([k]) => k);
  out.tolerance = tol;
  const o = REFERENCE[c.id];
  if (o?.status === 'done' && o.result.valid !== false) {
    const occt = o.result.volume - o.input.volume;
    out.occt = { value: occt, relErr: Math.abs(dV - occt) / Math.max(1, Math.abs(occt)), relToInput: Math.abs(dV - occt) / inputVolume };
  }
  if (probe?.dV !== null && probe?.dV !== undefined) {
    out.onshape = { value: probe.dV, absErr: Math.abs(dV - probe.dV) };
    // Onshape's mass properties carry a [min, max] range; a result inside it
    // is as close as the probe can tell.
    if (probe.volumeRange) { const [v, lo, hi] = probe.volumeRange, x = v + (dV - probe.dV); out.onshape.inRange = x >= lo && x <= hi; }
  }
  return out;
}

// ---------------------------------------------------------------------------

export async function checkNetwork(mod, c, jobFile, outDir) {
  const text = fs.readFileSync(jobFile, 'utf8');
  const job = decodeJob(text), body = normaliseBody(job.body);
  const t0 = performance.now();
  const netText = mod.network(text);
  const ms = performance.now() - t0;
  const L = decodeLadder(mod.ladder(text)), N = decodeNetwork(netText), result = mod.run(text);
  const issues = [];
  if (!N.complete) issues.push('network text incomplete');
  if (L.verdict?.admit) {
    for (const t of N.tips) if (t.kind !== 'closed' && t.kind !== 'refused') checkTip(body, job, L, N, t).forEach((m) => issues.push(`tip ${t.edge}@${t.vertex}: ${m}`));
    for (const k of N.corners) checkCorner(body, job, k).forEach((m) => issues.push(`corner ${k.vertex}: ${m}`));
    for (const k of N.consumed) checkConsumed(body, L, N, k).forEach((m) => issues.push(`consumed ${k.face}: ${m}`));
    const openEnds = L.stripes.reduce((a, s) => a + s.ends.filter((e) => e.kind !== 'closed').length, 0);
    if (N.verdict?.admit && N.tips.filter((t) => t.p1).length !== openEnds) issues.push(`${N.tips.length} tips for ${openEnds} open stripe ends`);
  } else if (N.verdict?.admit) issues.push('network admits a case the ladder refuses');
  // Stage 3: an admitted network gives `ok` (the B-rep) or the surgery's
  // typed refusal.
  const admit = /^ok\n/.test(result) || /^unresolved not-implemented stage-3 surgery: /.test(result);
  if (admit !== !!N.verdict?.admit) issues.push('run() and network() disagree on the verdict');
  if (!admit && N.verdict && !result.startsWith(`unresolved ${N.verdict.class} `)) issues.push('run() refuses with another class than network()');
  const probe = onshapeProbe(c.probe ?? c.id);
  const inputVolume = REFERENCE[c.id]?.input?.volume ?? onshapeInput(c.probe) ?? 1;
  const volume = volumeCheck(L, N, body, job, c, probe, inputVolume);
  if (volume.eligible && Object.keys(volume.closedForm).length && !volume.agrees.length) issues.push(`cell dV ${volume.dV} matches no closed form`);
  if (volume.occt && volume.occt.relToInput > OCCT_REL) issues.push(`cell dV ${volume.dV} differs from OCCT ${volume.occt.value}`);
  const brep = brepVolume(result, c, job);
  if (brep) volume.brep = brep;
  if (brep?.dV !== undefined) {
    // Notched cases have no cell volume (volumeCheck); every B-rep is
    // compared with Onshape.
    if (volume.eligible && Math.abs(brep.dV - volume.dV) > VOL_REL * inputVolume) issues.push(`B-rep dV ${brep.dV} differs from the cells ${volume.dV}`);
    if (probe?.dV !== null && probe?.dV !== undefined) {
      brep.onshape = { value: probe.dV, absErr: Math.abs(brep.dV - probe.dV) };
      if (probe.volumeRange) { const [v, lo, hi] = probe.volumeRange, x = v + (brep.dV - probe.dV); brep.onshape.inRange = x >= lo && x <= hi; }
      if (brep.onshape.inRange === false) issues.push(`B-rep dV ${brep.dV} outside Onshape's range (${probe.dV})`);
    }
    if (!volume.eligible && Object.keys(brep.closedForm).length && !brep.agrees.length) issues.push(`B-rep dV ${brep.dV} matches no closed form`);
  }
  const natives = {};
  for (const tgt of ['cpu1', 'cpuN', 'metal']) {
    const p = path.join(ROOT, 'out/fillet/fillet-kpart/results', `${c.id}.${tgt}.result.network`);
    if (fs.existsSync(p)) natives[tgt] = fs.readFileSync(p, 'utf8') === netText ? 'identical' : 'DIFFERENT';
  }
  Object.entries(natives).forEach(([t, v]) => { if (v !== 'identical') issues.push(`${t} network differs from JS`); });
  if (outDir) fs.writeFileSync(path.join(outDir, `${c.id}.network`), netText);
  const admitCase = !!N.verdict?.admit;
  const outcome = c.expect === 'must-refuse' ? (admitCase ? 'WRONG' : 'refused-correctly')
    : probe?.verdict === 'refused' ? (admitCase ? 'WRONG (Onshape refuses)' : 'refused-as-onshape')
      : c.expect === 'ok' ? (admitCase ? 'admitted' : 'declined') : (admitCase ? 'admitted (either)' : 'refused (either)');
  return {
    id: c.id, group: c.group, expect: c.expect, op: c.op, size: c.size, outcome, ms, verdict: N.verdict,
    tips: N.tips.map((t) => t.kind), curves: N.tips.filter((t) => t.curve).map((t) => t.curve.type),
    corners: N.corners.map((k) => k.kind), consumed: N.consumed.map((k) => k.kind),
    volume, onshape: probe, natives, issues, result: result.split('\n')[0],
  };
}

const tally = (xs) => Object.entries(xs.reduce((m, k) => ({ ...m, [k]: (m[k] ?? 0) + 1 }), {})).map(([k, n]) => `${n} ${k}`).join(', ');

export function summary(rep) {
  const L = ['# fillet-kpart stage 2: corner network check (scripts/fillet/network.mjs)', '', `${rep.capturedAt} · Bend JS target · ${rep.cases.length} cases`, ''];
  L.push(`Outcomes: ${tally(rep.cases.map((c) => c.outcome))}`, '');
  for (const g of [...new Set(rep.cases.map((c) => c.group))]) L.push(`- ${g}: ${tally(rep.cases.filter((c) => c.group === g).map((c) => c.outcome))}`);
  L.push('', `Geometry issues: ${rep.cases.reduce((a, c) => a + c.issues.length, 0)}`);
  const vol = rep.cases.filter((c) => c.volume.eligible), occt = vol.filter((c) => c.volume.occt);
  L.push(`Tips: ${tally(rep.cases.flatMap((c) => c.tips))}; end curves: ${tally(rep.cases.flatMap((c) => c.curves))}; corners: ${tally(rep.cases.flatMap((c) => c.corners))}; consumed faces: ${tally(rep.cases.flatMap((c) => c.consumed))}`);
  L.push(`Cell volume checks: ${vol.length} admitted cases; ${vol.filter((c) => c.volume.agrees?.length).length} agree with a closed form (≤ 1e-7 × input volume), ${vol.filter((c) => !Object.keys(c.volume.closedForm ?? {}).length).length} have none; ${occt.length} have an OCCT result, max difference ${Math.max(0, ...occt.map((c) => c.volume.occt.relErr)).toExponential(1)} relative to ΔV, ${Math.max(0, ...occt.map((c) => c.volume.occt.relToInput)).toExponential(1)} relative to the input volume; ${vol.filter((c) => c.volume.onshape).length} have an Onshape probe`, '');
  L.push('| case | expect | outcome | verdict | tips | corners | consumed | cell ΔV | closed form | vs OCCT | Onshape ΔV | issues |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const c of rep.cases) {
    const v = c.verdict?.admit ? 'admit' : `refuse ${c.verdict?.class ?? '?'}`;
    const cf = c.volume.eligible ? (c.volume.agrees?.length ? c.volume.agrees.join('/') : (Object.keys(c.volume.closedForm ?? {}).length ? 'DIFFERS' : '-')) : '-';
    const os = c.onshape ? (c.onshape.verdict === 'refused' ? `refused ${c.onshape.error}` : `${(c.onshape.dV ?? 0).toFixed(4)}${c.volume.onshape ? ` (Δ ${c.volume.onshape.absErr.toExponential(1)})` : ''}`) : '-';
    L.push(`| ${c.id} | ${c.expect} | ${c.outcome} | ${v} | ${tally(c.tips)} | ${tally(c.corners)} | ${tally(c.consumed)} | ${c.volume.eligible ? c.volume.dV.toFixed(6) : '-'} | ${cf} | ${c.volume.occt ? c.volume.occt.relErr.toExponential(0) : '-'} | ${os} | ${c.issues.join('; ').slice(0, 140)} |`);
  }
  return L.join('\n') + '\n';
}

async function main(argv) {
  const arg = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
  const only = arg('--cases')?.split(','), group = arg('--group');
  const outDir = path.resolve(arg('--out') ?? path.join(ROOT, 'out/fillet/fillet-kpart/network'));
  fs.mkdirSync(outDir, { recursive: true });
  const mod = await loadBend(path.join(ROOT, PROTO));
  const list = [];
  for (const c of loadCases()) if ((!only || only.includes(c.id)) && (!group || c.group === group)) list.push([c, jobPath(c.id)]);
  if (argv.includes('--probes')) for (const c of PROBE_CASES) if (!only || only.includes(c.id)) list.push([c, path.join(ROOT, 'tmp/fillet/a1/probes', `${c.id}.job`)]);
  if (argv.includes('--constructed')) for (const c of A2_CASES) if (!only || only.includes(c.id)) list.push([c, await constructedJob(c)]);
  const cases = [];
  for (const [c, file] of list) cases.push(await checkNetwork(mod, c, file, outDir));
  const rep = { capturedAt: new Date().toISOString(), proto: 'fillet-kpart', stage: 2, cases };
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(rep, null, 1));
  fs.writeFileSync(path.join(outDir, 'summary.md'), summary(rep));
  const bad = cases.filter((c) => c.issues.length || c.outcome.startsWith('WRONG') || c.outcome === 'declined');
  console.log(summary(rep).split('\n').slice(0, 14).join('\n'));
  for (const c of bad) console.log(`! ${c.id}: ${c.outcome} ${c.issues.join('; ')}`);
  process.exitCode = bad.length ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) await main(process.argv.slice(2));
