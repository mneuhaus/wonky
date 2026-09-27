// Fillet harness TEST INFRASTRUCTURE: geometry evaluation for checking B-reps
// and closed-form reference values. It never constructs a blend; it evaluates
// curves and surfaces that a job or a prototype result already states, and it
// computes independent closed forms (2D spandrel areas and centroids) for the
// case catalogue. Conventions follow kernel/analytic.bend and docs/fillet/theory.md §1:
//
//   curves   line {origin, direction}                      p(t) = o + t d
//            circle {origin, normal, x, radius}            p(t) = o + r (cos t x + sin t (n × x))
//            ellipse {origin, normal, x, major, minor}     p(t) = o + a cos t x + b sin t (n × x)
//   surfaces plane {origin, normal, x}                     natural normal = normal
//            cylinder {origin, axis, x, radius}           natural normal = radial, away from the axis
//            cone {origin, axis, x, radius, angle}        radius at axial height h = r + h tan(angle);
//                                                          natural normal = (radial − tan(angle) axis)/|·|
//            sphere {origin, axis, x, radius}             natural normal = (p − o)/r
//            torus {origin, axis, x, major, minor}        natural normal = (p − tube centre)/minor
//            bspline {du, dv, nu, nv, knotsU, knotsV, poles} natural normal = Su × Sv (bspline.mjs;
//                                                          result-only format extension of stage C2)
//   A face's outward normal is the natural normal, negated when sameSense is false.
//   An edge runs start -> end; sameSense says whether that is the direction of
//   increasing curve parameter. curveRange = [first, last] (first < last) when stated.

import { bsplineDistance, bsplineNormal } from './bspline.mjs';

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a) => Math.hypot(a[0], a[1], a[2]);
export const dist = (a, b) => norm(sub(a, b));
export function unit(a) {
  const n = norm(a);
  if (!(n > 0)) throw new Error('zero-length vector');
  return scale(a, 1 / n);
}
const TAU = 2 * Math.PI;

// ---------------------------------------------------------------------------
// Curves

export function curvePoint(c, t) {
  if (c.type === 'line') return add(c.origin, scale(c.direction, t));
  const y = cross(c.normal, c.x);
  if (c.type === 'circle') return add(c.origin, add(scale(c.x, c.radius * Math.cos(t)), scale(y, c.radius * Math.sin(t))));
  if (c.type === 'ellipse') return add(c.origin, add(scale(c.x, c.major * Math.cos(t)), scale(y, c.minor * Math.sin(t))));
  throw new Error(`unknown curve ${c.type}`);
}

// d p / d t (not normalised).
export function curveDerivative(c, t) {
  if (c.type === 'line') return c.direction;
  const y = cross(c.normal, c.x);
  if (c.type === 'circle') return add(scale(c.x, -c.radius * Math.sin(t)), scale(y, c.radius * Math.cos(t)));
  if (c.type === 'ellipse') return add(scale(c.x, -c.major * Math.sin(t)), scale(y, c.minor * Math.cos(t)));
  throw new Error(`unknown curve ${c.type}`);
}

// Parameter of the curve point closest to p (exact for lines and circles,
// Newton-refined for ellipses).
export function curveParam(c, p) {
  const d = sub(p, c.origin);
  if (c.type === 'line') return dot(d, c.direction) / dot(c.direction, c.direction);
  const y = cross(c.normal, c.x);
  if (c.type === 'circle') return Math.atan2(dot(d, y), dot(d, c.x));
  if (c.type === 'ellipse') {
    let best = 0, bestD = Infinity;
    for (let k = 0; k < 64; k++) {
      const t = (k / 64) * TAU, q = dist(curvePoint(c, t), p);
      if (q < bestD) { bestD = q; best = t; }
    }
    let t = best;
    for (let k = 0; k < 50; k++) {
      const r = sub(curvePoint(c, t), p), d1 = curveDerivative(c, t);
      const d2 = add(scale(c.x, -c.major * Math.cos(t)), scale(y, -c.minor * Math.sin(t)));
      const f = dot(r, d1), fp = dot(d1, d1) + dot(r, d2);
      if (fp === 0) break;
      const step = f / fp;
      t -= step;
      if (Math.abs(step) < 1e-15) break;
    }
    return t;
  }
  throw new Error(`unknown curve ${c.type}`);
}

export function pointCurveDistance(c, p) {
  if (c.type === 'line') {
    const d = sub(p, c.origin), u = unit(c.direction);
    return norm(sub(d, scale(u, dot(d, u))));
  }
  if (c.type === 'circle') {
    const d = sub(p, c.origin), h = dot(d, c.normal), inPlane = sub(d, scale(c.normal, h));
    return Math.hypot(h, norm(inPlane) - c.radius);
  }
  return dist(curvePoint(c, curveParam(c, p)), p);
}

// Wrap angle a into [base, base + 2π).
const wrapFrom = (a, base) => base + ((((a - base) % TAU) + TAU) % TAU);

// The parameter interval an edge covers, in the direction start -> end:
// {t0, t1} with t1 > t0 when sameSense, t1 < t0 otherwise.
export function edgeInterval(edge, vertices) {
  const c = edge.curve, same = edge.sameSense !== false;
  if (edge.curveRange) {
    const [a, b] = edge.curveRange;
    return same ? { t0: a, t1: b } : { t0: b, t1: a };
  }
  const ps = vertices[edge.start], pe = vertices[edge.end];
  if (c.type === 'line') return { t0: curveParam(c, ps), t1: curveParam(c, pe) };
  const a = curveParam(c, ps);
  if (edge.start === edge.end) return same ? { t0: a, t1: a + TAU } : { t0: a, t1: a - TAU };
  const b = curveParam(c, pe);
  return same ? { t0: a, t1: wrapFrom(b, a) } : { t0: a, t1: wrapFrom(b, a) - TAU };
}

// n+1 points from start to end (inclusive), uniform in the parameter.
export function edgeSamples(edge, vertices, n = 16) {
  const { t0, t1 } = edgeInterval(edge, vertices);
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((t1 - t0) * i) / n;
    out.push({ t, p: curvePoint(edge.curve, t) });
  }
  return out;
}

// Unit tangent in the start -> end direction at parameter t.
export function edgeTangent(edge, t) {
  const d = unit(curveDerivative(edge.curve, t));
  return edge.sameSense === false ? scale(d, -1) : d;
}

export function edgeLength(edge, vertices, n = 256) {
  const s = edgeSamples(edge, vertices, n);
  let L = 0;
  for (let i = 1; i < s.length; i++) L += dist(s[i - 1].p, s[i].p);
  return L;
}

// Distance from p to the edge (curve restricted to its interval).
export function pointEdgeDistance(edge, vertices, p) {
  const c = edge.curve, { t0, t1 } = edgeInterval(edge, vertices);
  const lo = Math.min(t0, t1), hi = Math.max(t0, t1);
  let t = curveParam(c, p);
  if (c.type !== 'line') {
    // Periodic: move t into [lo, lo + 2π) and clamp to the interval.
    t = wrapFrom(t, lo);
    if (t > hi) {
      const dLo = dist(curvePoint(c, lo), p), dHi = dist(curvePoint(c, hi), p);
      return Math.min(dLo, dHi);
    }
    return dist(curvePoint(c, t), p);
  }
  t = Math.min(hi, Math.max(lo, t));
  return dist(curvePoint(c, t), p);
}

// ---------------------------------------------------------------------------
// Surfaces

function axial(s, p) {
  const d = sub(p, s.origin), h = dot(d, s.axis), radial = sub(d, scale(s.axis, h));
  return { d, h, radial, rho: norm(radial) };
}

export function pointSurfaceDistance(s, p) {
  switch (s.type) {
    case 'plane': return Math.abs(dot(sub(p, s.origin), s.normal));
    case 'cylinder': return Math.abs(axial(s, p).rho - s.radius);
    case 'cone': {
      const { h, rho } = axial(s, p);
      // Perpendicular distance to the generator line in the (rho, h) half plane.
      return Math.abs((rho - s.radius - h * Math.tan(s.angle)) * Math.cos(s.angle));
    }
    case 'sphere': return Math.abs(dist(p, s.origin) - s.radius);
    case 'torus': {
      const { h, rho } = axial(s, p);
      return Math.abs(Math.hypot(rho - s.major, h) - s.minor);
    }
    case 'bspline': return bsplineDistance(s, p); // stage-C2 format extension (bspline.mjs)
    default: throw new Error(`unknown surface ${s.type}`);
  }
}

export function surfaceNormal(s, p) {
  switch (s.type) {
    case 'plane': return unit(s.normal);
    case 'cylinder': return unit(axial(s, p).radial);
    case 'cone': {
      const { radial } = axial(s, p);
      return unit(sub(unit(radial), scale(s.axis, Math.tan(s.angle))));
    }
    case 'sphere': return unit(sub(p, s.origin));
    case 'torus': {
      const { radial } = axial(s, p);
      const centre = add(s.origin, scale(unit(radial), s.major));
      return unit(sub(p, centre));
    }
    case 'bspline': return bsplineNormal(s, p);
    default: throw new Error(`unknown surface ${s.type}`);
  }
}

export const faceNormal = (face, p) => scale(surfaceNormal(face.surface, p), face.sameSense === false ? -1 : 1);

// The radius a rolling-ball blend face must carry (cylinder radius, torus
// minor, sphere radius); null for planes and cones.
export function blendRadius(s) {
  if (s.type === 'cylinder' || s.type === 'sphere') return s.radius;
  if (s.type === 'torus') return s.minor;
  return null;
}

// ---------------------------------------------------------------------------
// Bodies

// The planar body format of src/ (edge.curve = "line", no sameSense, plane
// normals outward) and the analytic format, as one analytic record. No
// geometry changes: the line of a planar edge is spanned by its vertices.
export function normaliseBody(body) {
  const vertices = body.vertices.map((v) => [...v]);
  const edges = body.edges.map((e) => {
    if (typeof e.curve === 'string') {
      if (e.curve !== 'line') throw new Error(`planar body edge curve ${e.curve}`);
      const a = vertices[e.start], b = vertices[e.end], L = dist(a, b);
      return { start: e.start, end: e.end, curve: { type: 'line', origin: a, direction: unit(sub(b, a)) }, sameSense: true, curveRange: [0, L] };
    }
    const out = { start: e.start, end: e.end, curve: e.curve, sameSense: e.sameSense !== false };
    if (e.curveRange) out.curveRange = [...e.curveRange];
    return out;
  });
  const faces = body.faces.map((f) => ({
    surface: f.surface,
    sameSense: f.sameSense !== false,
    loops: f.loops.map((l) => l.map((u) => ({ edge: u.edge, forward: u.forward !== false }))),
    outer: f.outer ?? f.loops.map((_, i) => i === 0),
  }));
  return { vertices, edges, faces };
}

// face indices using each edge: [{face, forward}]
export function edgeUses(body) {
  const uses = body.edges.map(() => []);
  body.faces.forEach((f, fi) => f.loops.forEach((l) => l.forEach((u) => uses[u.edge].push({ face: fi, forward: u.forward }))));
  return uses;
}

// Convexity of an edge between its two faces at parameter t (theory §1.2):
// sign of (n1 × n2) · t with t oriented along face 1's coedge.
export function edgeConvexity(body, edgeIndex, uses) {
  const e = body.edges[edgeIndex], u = uses[edgeIndex];
  if (u.length !== 2) return { convexity: 'non-manifold', uses: u.length };
  const { t0, t1 } = edgeInterval(e, body.vertices);
  const t = (t0 + t1) / 2, p = curvePoint(e.curve, t);
  const tan = scale(edgeTangent(e, t), u[0].forward ? 1 : -1);
  const n1 = faceNormal(body.faces[u[0].face], p), n2 = faceNormal(body.faces[u[1].face], p);
  const s = dot(cross(n1, n2), tan);
  const angle = Math.acos(Math.max(-1, Math.min(1, dot(n1, n2))));
  // Interior dihedral: π − angle for convex, π + angle for concave.
  const convexity = Math.abs(s) < 1e-9 ? 'smooth' : s > 0 ? 'convex' : 'concave';
  const dihedralDeg = ((convexity === 'concave' ? Math.PI + angle : Math.PI - angle) * 180) / Math.PI;
  return { convexity, dihedralDeg, normalAngleDeg: (angle * 180) / Math.PI, point: p };
}

// ---------------------------------------------------------------------------
// 2D closed forms (section plane). Loops are lists of segments
//   {type: 'line', a: [x, y], b: [x, y]}
//   {type: 'arc', c: [x, y], r, from, to}    angles in radians, from -> to
// Returns the signed area and the first moments (∬ x dA, ∬ y dA) by Green's
// theorem, exact for lines and circular arcs.

function segmentIntegrals(s) {
  if (s.type === 'line') {
    const [ax, ay] = s.a, [bx, by] = s.b, dy = by - ay, dx = bx - ax;
    return {
      A: ((ax + bx) / 2) * dy,
      Mx: (dy * (ax * ax + ax * bx + bx * bx)) / 6, // ½∮ x² dy
      My: (-dx * (ay * ay + ay * by + by * by)) / 6, // −½∮ y² dx
    };
  }
  const { c: [cx, cy], r, from: a, to: b } = s;
  const S = (f) => f(b) - f(a);
  // ∮ x dy with x = cx + r cos φ, dy = r cos φ dφ
  const A = S((p) => cx * r * Math.sin(p) + r * r * (p / 2 + Math.sin(2 * p) / 4));
  // ½∮ x² dy
  const Mx = 0.5 * S((p) => cx * cx * r * Math.sin(p) + 2 * cx * r * r * (p / 2 + Math.sin(2 * p) / 4) + r ** 3 * (Math.sin(p) - Math.sin(p) ** 3 / 3));
  // −½∮ y² dx, y = cy + r sin φ, dx = −r sin φ dφ
  const My = 0.5 * S((p) => -cy * cy * r * Math.cos(p) + 2 * cy * r * r * (p / 2 - Math.sin(2 * p) / 4) + r ** 3 * (-Math.cos(p) + Math.cos(p) ** 3 / 3));
  return { A, Mx, My };
}

export function loopIntegrals(segments) {
  let A = 0, Mx = 0, My = 0;
  for (const s of segments) {
    const r = segmentIntegrals(s);
    A += r.A; Mx += r.Mx; My += r.My;
  }
  const sgn = A < 0 ? -1 : 1;
  return { area: sgn * A, momentX: sgn * Mx, momentY: sgn * My, centroid: [Mx / A, My / A] };
}

const v2 = { add: (a, b) => [a[0] + b[0], a[1] + b[1]], sub: (a, b) => [a[0] - b[0], a[1] - b[1]], scale: (a, s) => [a[0] * s, a[1] * s], len: (a) => Math.hypot(a[0], a[1]) };
const ang = (c, p) => Math.atan2(p[1] - c[1], p[0] - c[0]);
// Short signed sweep from angle a to angle b.
const shortTo = (a, b) => {
  let d = b - a;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return a + d;
};

// Spandrel of a circular fillet of radius r in the corner at P between two
// straight boundaries leaving P along unit directions u1, u2 (interior angle
// between them < π). Region P -> T1 -> arc -> T2 -> P.
export function cornerFillet2D(P, u1, u2, r) {
  const alpha = Math.acos(Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1])));
  const bis = [(u1[0] + u2[0]), (u1[1] + u2[1])], bl = v2.len(bis);
  const C = v2.add(P, v2.scale(bis, r / Math.sin(alpha / 2) / bl));
  const s = r / Math.tan(alpha / 2);
  const T1 = v2.add(P, v2.scale(u1, s)), T2 = v2.add(P, v2.scale(u2, s));
  const a1 = ang(C, T1);
  return { alpha, centre: C, T1, T2, setback: s, ...loopIntegrals([
    { type: 'line', a: P, b: T1 },
    { type: 'arc', c: C, r, from: a1, to: shortTo(a1, ang(C, T2)) },
    { type: 'line', a: T2, b: P },
  ]) };
}

// Chamfer triangle at P with in-face distances s1 along u1 and s2 along u2.
export function cornerChamfer2D(P, u1, u2, s1, s2) {
  const T1 = v2.add(P, v2.scale(u1, s1)), T2 = v2.add(P, v2.scale(u2, s2));
  return { T1, T2, ...loopIntegrals([{ type: 'line', a: P, b: T1 }, { type: 'line', a: T1, b: T2 }, { type: 'line', a: T2, b: P }]) };
}

// Face-offset (Onshape default, Parasolid) symmetric chamfer distance d at
// interior angle phi: in-face contact distance s = d·cot(phi/2) (theory §5.2).
export const faceOffsetSetback = (d, phi) => d / Math.tan(phi / 2);

// Plane/plane spandrel area at interior dihedral alpha (convex, alpha < π):
// r²(cot(α/2) − (π − α)/2) = r²(tan(θ/2) − θ/2), θ = π − α (theory §14).
export const planePlaneSpandrel = (r, alpha) => r * r * (1 / Math.tan(alpha / 2) - (Math.PI - alpha) / 2);

// Spandrel between a straight boundary and a circular one. The corner P is
// where the line (through P along u, the material/void region side given by
// the fillet centre side) meets the circle (centre O, radius R). `internal`:
// the fillet circle lies inside the big circle (|C − O| = R − r), otherwise
// outside (|C − O| = R + r). `side` = unit normal of the line pointing to the
// fillet centre. Picks the centre nearest P.
export function lineCircleFillet2D(P, u, side, O, R, r, internal) {
  // C = L0 + side·r + t·u with |C − O| = R ∓ r.
  const L0 = v2.add(P, v2.scale(side, r)), D = internal ? R - r : R + r;
  const w = v2.sub(L0, O), b = w[0] * u[0] + w[1] * u[1], c = w[0] * w[0] + w[1] * w[1] - D * D;
  const disc = b * b - c;
  if (disc < 0) throw new Error('no line/circle fillet');
  const cands = [-b + Math.sqrt(disc), -b - Math.sqrt(disc)].map((t) => v2.add(L0, v2.scale(u, t)));
  const C = cands.sort((a, b2) => v2.len(v2.sub(a, P)) - v2.len(v2.sub(b2, P)))[0];
  const T1 = v2.sub(C, v2.scale(side, r));
  const dir = v2.scale(v2.sub(C, O), 1 / v2.len(v2.sub(C, O)));
  const T2 = v2.add(O, v2.scale(dir, R));
  const aT1 = ang(C, T1), aT2 = ang(O, T2);
  return { centre: C, T1, T2, ...loopIntegrals([
    { type: 'line', a: P, b: T1 },
    { type: 'arc', c: C, r, from: aT1, to: shortTo(aT1, ang(C, T2)) },
    { type: 'arc', c: O, r: R, from: aT2, to: shortTo(aT2, ang(O, P)) },
  ]) };
}
