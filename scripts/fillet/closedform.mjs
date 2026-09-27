// Fillet harness TEST INFRASTRUCTURE: closed forms evaluated on the job's own
// geometry (docs/fillet-plan.md §8 step 0). It computes no blend.
//
// The catalogue's closed forms (cases.mjs) are derived from the case's design
// parameters: exact angles such as 60° and coordinates such as 10·√3. The
// kernel builds the input from F32 sketch coordinates (src/kernel.mjs vector),
// so the job the prototypes read differs from the design by up to 1e-7 mm and
// the design closed form is off by up to 1.5e-9 × V (pp-convex-60-r2). The
// forms here read the same quantities from the decoded job instead: dihedral
// angles and lengths of the selected edges, perimeter and turning of selected
// face loops, the section polygon of a prism. A case opts in with
// `closedForm.job = {kind}`; the design value stays in `deltaVolume` (it is
// what an Onshape probe on the design geometry agrees with).
//
//   edges    fillets or setback chamfers (Onshape EQUAL_OFFSETS, probe FP-a)
//            on straight plane/plane edges with a perpendicular planar cap at
//            both ends, blends independent of each other:
//            ΔV = Σ ∓ L · A(α), A = r²(cot(α/2) − (π − α)/2) or d² sin(α)/2,
//            α the wedge angle between the planes, − for convex edges.
//   outline  every edge of the selected planar faces' loops, walls
//            perpendicular to the face (planes or coaxial cylinders):
//            ΔV = −Σ (P·A − K·W), A = r²(1 − π/4) or d²/2,
//            W = r³(5/3 − π/2) or d³/3, P the loop length and
//            K = Σ tan(θ/2) over corners + Σ θ/2 over arcs, θ the signed
//            turning about the face's outward normal (positive = convex).
//   notch    one convex vertical fillet of a prism whose contact overflows
//            the neighbouring face; the blend is trimmed by the face beyond
//            it (Onshape FP09): ΔV = −L · area(notch2D).

import { cornerFillet2D, cross, curveDerivative, dist, dot, edgeConvexity, edgeInterval, edgeUses, faceNormal, loopIntegrals, sub, unit } from './geom.mjs';

const A90 = (r) => r * r * (1 - Math.PI / 4);
const W2 = (r) => r ** 3 * (5 / 3 - Math.PI / 2);
const PAR = 1e-12; // |cos| slack for parallel / perpendicular directions

const ang2 = (c, p) => Math.atan2(p[1] - c[1], p[0] - c[0]);
const sub2 = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len2 = (a) => Math.hypot(a[0], a[1]);
const unit2 = (a) => { const l = len2(a); return [a[0] / l, a[1] / l]; };
const cross2 = (a, b) => a[0] * b[1] - a[1] * b[0];
// The signed sweep from angle a to angle b the short way.
const shortTo = (a, b) => {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d;
};

// ---------------------------------------------------------------------------
// 2D: the notch of a convex prism corner (shared by cases.mjs for the design
// value and by the job form below).

// poly: the section polygon, counter-clockwise (material on the left); k: the
// filleted corner; r: the radius. The ball touches the two faces at k; the
// face whose contact lies beyond its far end is consumed, and the blend is
// trimmed where its circle meets the face after it. Returns the removed area.
export function notch2D(poly, k, r) {
  const n = poly.length, at = (i) => poly[((i % n) + n) % n];
  const P = at(k), A = at(k - 1), B = at(k + 1);
  if (!(cross2(sub2(P, A), sub2(B, P)) > 0)) throw new Error(`notch: corner ${k} is not convex`);
  const u1 = unit2(sub2(A, P)), u2 = unit2(sub2(B, P));
  const f = cornerFillet2D(P, u1, u2, r);
  const over1 = f.setback > len2(sub2(A, P)), over2 = f.setback > len2(sub2(B, P));
  if (over1 === over2) throw new Error(`notch: ${over1 ? 'both contacts overflow' : 'no contact overflows'} at corner ${k}`);
  // The trimming line runs from the consumed face's far end Q to the next vertex R.
  const [Q, R, T] = over2 ? [B, at(k + 2), f.T1] : [A, at(k - 2), f.T2];
  const C = f.centre, d = unit2(sub2(R, Q)), w = sub2(Q, C);
  const b = w[0] * d[0] + w[1] * d[1], disc = b * b - (w[0] * w[0] + w[1] * w[1] - r * r);
  if (disc < 0) throw new Error('notch: the blend circle misses the trimming face');
  // The crossing met first when running along the arc from the kept contact T
  // towards the consumed side.
  const aT = ang2(C, T), toward = Math.sign(shortTo(aT, ang2(C, over2 ? f.T2 : f.T1)) - aT);
  const cands = [-b + Math.sqrt(disc), -b - Math.sqrt(disc)].map((t) => ({ t, X: [Q[0] + d[0] * t, Q[1] + d[1] * t] }))
    .map((c) => ({ ...c, sweep: (shortTo(aT, ang2(C, c.X)) - aT) * toward }))
    .filter((c) => c.sweep >= 0).sort((p, q) => p.sweep - q.sweep);
  const hit = cands[0];
  if (!hit || hit.t < 0 || hit.t > len2(sub2(R, Q))) throw new Error('notch: the trim point is not on the trimming face');
  const X = hit.X, aX = ang2(C, X);
  const segs = over2
    ? [{ type: 'line', a: T, b: P }, { type: 'line', a: P, b: Q }, { type: 'line', a: Q, b: X }, { type: 'arc', c: C, r, from: aX, to: shortTo(aX, aT) }]
    : [{ type: 'line', a: X, b: Q }, { type: 'line', a: Q, b: P }, { type: 'line', a: P, b: T }, { type: 'arc', c: C, r, from: aT, to: shortTo(aT, aX) }];
  return { area: loopIntegrals(segs).area, trim: X, setback: f.setback };
}

// ---------------------------------------------------------------------------
// Job geometry

const facesOf = (job) => { const u = edgeUses(job.body); return (e) => u[e].map((x) => x.face); };

function edgeLine(job, e) {
  const edge = job.body.edges[e];
  if (edge.curve.type !== 'line') throw new Error(`edge ${e} is a ${edge.curve.type}, not a line`);
  const a = job.body.vertices[edge.start], b = job.body.vertices[edge.end];
  return { a, b, d: unit(sub(b, a)), L: dist(a, b) };
}

// A planar face through p whose normal is parallel to d (a perpendicular cap).
function capAt(job, p, d) {
  return job.body.faces.findIndex((f) => f.surface.type === 'plane' && Math.abs(Math.abs(dot(unit(f.surface.normal), d)) - 1) < PAR
    && Math.abs(dot(sub(p, f.surface.origin), unit(f.surface.normal))) < 1e-9);
}

function edgesForm(job) {
  const faces = facesOf(job), uses = edgeUses(job.body);
  let dV = 0;
  const parts = [];
  for (const e of job.select) {
    const { a, b, d, L } = edgeLine(job, e);
    const [f1, f2] = faces(e).map((i) => job.body.faces[i]);
    if (f1?.surface.type !== 'plane' || f2?.surface.type !== 'plane') throw new Error(`edges form: edge ${e} is not between two planes`);
    if (capAt(job, a, d) < 0 || capAt(job, b, d) < 0) throw new Error(`edges form: edge ${e} has no perpendicular planar cap at both ends`);
    const mid = a.map((x, i) => (x + b[i]) / 2);
    const cosN = dot(faceNormal(f1, mid), faceNormal(f2, mid));
    const alpha = Math.PI - Math.acos(Math.max(-1, Math.min(1, cosN))); // wedge angle
    const cx = edgeConvexity(job.body, e, uses).convexity;
    if (cx !== 'convex' && cx !== 'concave') throw new Error(`edges form: edge ${e} is ${cx}`);
    const s = job.size, area = job.op === 'fillet' ? s * s * (1 / Math.tan(alpha / 2) - (Math.PI - alpha) / 2) : (s * s * Math.sin(alpha)) / 2;
    const part = (cx === 'convex' ? -1 : 1) * L * area;
    parts.push({ edge: e, convexity: cx, wedgeDeg: (alpha * 180) / Math.PI, length: L, deltaVolume: part });
    dV += part;
  }
  return { deltaVolume: dV, parts };
}

// Signed turning of a loop use about n (radians): circles by their parameter
// sweep, lines 0.
function useTurning(job, u, n) {
  const e = job.body.edges[u.edge], c = e.curve;
  if (c.type === 'line') return 0;
  if (c.type !== 'circle') throw new Error(`outline form: edge ${u.edge} is a ${c.type}`);
  const { t0, t1 } = edgeInterval(e, job.body.vertices);
  return (u.forward ? t1 - t0 : t0 - t1) * Math.sign(dot(unit(c.normal), n));
}

// Unit tangent of a loop use at its start (at = 0) or end (at = 1), in the
// loop's direction.
function useTangent(job, u, at) {
  const e = job.body.edges[u.edge], { t0, t1 } = edgeInterval(e, job.body.vertices);
  const t = u.forward ? (at ? t1 : t0) : (at ? t0 : t1);
  // the use runs along increasing parameter iff its direction is the edge's sense
  const along = (e.sameSense !== false) === u.forward ? 1 : -1;
  return unit(curveDerivative(e.curve, t)).map((x) => x * along);
}

function outlineForm(job) {
  const sel = new Set(job.select), faces = facesOf(job);
  const picked = job.body.faces.map((f, i) => i).filter((i) => {
    const f = job.body.faces[i];
    return f.surface.type === 'plane' && f.loops.every((l) => l.every((u) => sel.has(u.edge)));
  });
  const covered = new Set(picked.flatMap((i) => job.body.faces[i].loops.flat().map((u) => u.edge)));
  if (covered.size !== sel.size || [...sel].some((e) => !covered.has(e))) throw new Error('outline form: the selection is not the loops of planar faces');
  const s = job.size, A = job.op === 'fillet' ? A90(s) : (s * s) / 2, W = job.op === 'fillet' ? W2(s) : s ** 3 / 3;
  let dV = 0;
  const loops = [];
  for (const fi of picked) {
    const f = job.body.faces[fi], n = unit(f.surface.normal).map((x) => x * (f.sameSense === false ? -1 : 1));
    for (const loop of f.loops) {
      let P = 0, K = 0;
      loop.forEach((u, i) => {
        const e = job.body.edges[u.edge];
        // wall: perpendicular plane or a cylinder coaxial with n
        const wall = job.body.faces[faces(u.edge).find((x) => x !== fi)]?.surface;
        const ok = wall && ((wall.type === 'plane' && Math.abs(dot(unit(wall.normal), n)) < PAR)
          || (wall.type === 'cylinder' && Math.abs(Math.abs(dot(unit(wall.axis), n)) - 1) < PAR));
        if (!ok) throw new Error(`outline form: the wall at edge ${u.edge} is not perpendicular to face ${fi}`);
        // exact lengths: lines by their ends, arcs by radius × sweep
        const turn = useTurning(job, u, n);
        P += e.curve.type === 'line' ? dist(job.body.vertices[e.start], job.body.vertices[e.end]) : e.curve.radius * Math.abs(turn);
        K += turn / 2;
        // corner between this use and the next one
        const next = loop[(i + 1) % loop.length];
        const tin = useTangent(job, u, 1), tout = useTangent(job, next, 0);
        const theta = Math.atan2(dot(cross(tin, tout), n), dot(tin, tout));
        K += Math.tan(theta / 2);
      });
      loops.push({ face: fi, perimeter: P, turning: K });
      dV -= P * A - K * W;
    }
  }
  return { deltaVolume: dV, loops };
}

function notchForm(job) {
  if (job.op !== 'fillet' || job.select.length !== 1) throw new Error('notch form: one fillet edge');
  const e = job.select[0], { a, d, L } = edgeLine(job, e);
  const ci = capAt(job, a, d);
  if (ci < 0) throw new Error('notch form: no perpendicular cap');
  const cap = job.body.faces[ci], n = unit(cap.surface.normal).map((x) => x * (cap.sameSense === false ? -1 : 1));
  // the cap's outer loop as a polygon, counter-clockwise about its outward normal
  const loop = cap.loops[cap.outer.findIndex(Boolean)];
  const pts = loop.map((u) => { const x = job.body.edges[u.edge]; if (x.curve.type !== 'line') throw new Error('notch form: curved cap edge'); return job.body.vertices[u.forward ? x.start : x.end]; });
  const e1 = unit(sub(pts[1], pts[0])), e2 = cross(n, e1);
  const poly = pts.map((p) => [dot(sub(p, a), e1), dot(sub(p, a), e2)]);
  const k = poly.findIndex((q) => Math.hypot(q[0], q[1]) < 1e-9);
  if (k < 0) throw new Error('notch form: the edge does not end on the cap loop');
  const r = notch2D(poly, k, job.size);
  return { deltaVolume: -L * r.area, area: r.area, length: L, setback: r.setback };
}

const KINDS = { edges: edgesForm, outline: outlineForm, notch: notchForm };

// The closed form of `spec` (a catalogue case's closedForm) on the decoded job.
export function jobClosedForm(spec, job) {
  const f = KINDS[spec?.kind];
  if (!f) throw new Error(`unknown job closed form ${spec?.kind}`);
  return { kind: spec.kind, ...f(job) };
}

// The closed-form variants a result is graded against: {key: {design, value,
// job?}}, `value` = the job-geometry value where the case states a job form,
// else the design value. Alternatives only when acceptAlternatives.
export function closedFormVariants(cf, job) {
  if (!cf) return null;
  const out = { primary: { design: cf.deltaVolume, value: cf.deltaVolume } };
  if (cf.job && job) {
    try {
      const j = jobClosedForm(cf.job, job);
      Object.assign(out.primary, { value: j.deltaVolume, job: j.deltaVolume, jobKind: j.kind, designMinusJob: cf.deltaVolume - j.deltaVolume });
    } catch (err) {
      out.primary.jobError = err.message;
    }
  }
  if (cf.acceptAlternatives) for (const [k, v] of Object.entries(cf.alternatives ?? {})) out[k] = { design: v, value: v };
  return out;
}

