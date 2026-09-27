// Fillet harness TEST INFRASTRUCTURE: evaluation of the `bspline` surface of
// the stage-C2 format extension (docs/fillet/proto-rollingball.md, "Format
// extension"). It evaluates a surface a prototype states; it never fits one.
//
//   bspline <du> <dv> <nu> <nv> <nu+du+1 u-knots> <nv+dv+1 v-knots> <nu*nv poles>
//
// Non-rational, clamped knot vectors, poles in u-major order (pole (i, j) at
// i*nv + j). Natural normal Su × Sv (normalised); a face's outward normal is
// the natural normal, negated when sameSense is false (as for the analytic
// surfaces of geom.mjs).

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);

export function checkBspline(s) {
  const { du, dv, nu, nv, knotsU, knotsV, poles } = s;
  if (!(du >= 1 && dv >= 1 && nu > du && nv > dv)) throw new Error(`bspline: bad degrees/counts ${du} ${dv} ${nu} ${nv}`);
  if (knotsU.length !== nu + du + 1 || knotsV.length !== nv + dv + 1) throw new Error('bspline: knot count');
  if (poles.length !== nu * nv) throw new Error('bspline: pole count');
  for (const k of [knotsU, knotsV]) for (let i = 1; i < k.length; i++) if (k[i] < k[i - 1]) throw new Error('bspline: knots not ascending');
  return s;
}

// Span index i with k[i] <= t < k[i+1] (the last non-empty span at the end).
function span(k, deg, n, t) {
  if (t >= k[n]) return n - 1;
  if (t <= k[deg]) return deg;
  let lo = deg, hi = n;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t < k[mid]) hi = mid; else lo = mid;
  }
  return lo;
}

// Basis functions N_{i-deg..i} and their first derivatives at t (The NURBS
// Book, A2.3 with n = 1).
function basis(k, deg, i, t) {
  const ndu = Array.from({ length: deg + 1 }, () => new Array(deg + 1).fill(0));
  const left = new Array(deg + 1).fill(0), right = new Array(deg + 1).fill(0);
  ndu[0][0] = 1;
  for (let j = 1; j <= deg; j++) {
    left[j] = t - k[i + 1 - j];
    right[j] = k[i + j] - t;
    let saved = 0;
    for (let r = 0; r < j; r++) {
      ndu[j][r] = right[r + 1] + left[j - r];
      const tmp = ndu[r][j - 1] / ndu[j][r];
      ndu[r][j] = saved + right[r + 1] * tmp;
      saved = left[j - r] * tmp;
    }
    ndu[j][j] = saved;
  }
  const N = [], D = [];
  for (let j = 0; j <= deg; j++) N.push(ndu[j][deg]);
  for (let r = 0; r <= deg; r++) {
    // First derivative: deg * (N_{r-1,deg-1}/(k.. ) - N_{r,deg-1}/(..)).
    let d = 0;
    if (r >= 1) d += ndu[r - 1][deg - 1] / ndu[deg][r - 1];
    if (r <= deg - 1) d -= ndu[r][deg - 1] / ndu[deg][r];
    D.push(deg * d);
  }
  return { N, D };
}

// Point and first partial derivatives at (u, v).
export function bsplineEval(s, u, v) {
  const { du, dv, nu, nv, knotsU, knotsV, poles } = s;
  const iu = span(knotsU, du, nu, u), iv = span(knotsV, dv, nv, v);
  const bu = basis(knotsU, du, iu, u), bv = basis(knotsV, dv, iv, v);
  const P = [0, 0, 0], Su = [0, 0, 0], Sv = [0, 0, 0];
  for (let a = 0; a <= du; a++) {
    const row = (iu - du + a) * nv;
    for (let b = 0; b <= dv; b++) {
      const q = poles[row + iv - dv + b];
      const w = bu.N[a] * bv.N[b], wu = bu.D[a] * bv.N[b], wv = bu.N[a] * bv.D[b];
      for (let c = 0; c < 3; c++) { P[c] += w * q[c]; Su[c] += wu * q[c]; Sv[c] += wv * q[c]; }
    }
  }
  return { p: P, su: Su, sv: Sv };
}

const GRID = new WeakMap();
// A sample grid of the surface (per knot span 6 x 6), cached per record.
function grid(s) {
  let g = GRID.get(s);
  if (g) return g;
  const params = (k, deg, n) => {
    const out = [];
    for (let i = deg; i < n; i++) {
      if (k[i + 1] <= k[i]) continue;
      for (let j = 0; j < 6; j++) out.push(k[i] + ((k[i + 1] - k[i]) * j) / 6);
    }
    out.push(k[n]);
    return out;
  };
  const us = params(s.knotsU, s.du, s.nu), vs = params(s.knotsV, s.dv, s.nv);
  const pts = [];
  for (const u of us) for (const v of vs) pts.push({ u, v, p: bsplineEval(s, u, v).p });
  g = { pts, u0: s.knotsU[s.du], u1: s.knotsU[s.nu], v0: s.knotsV[s.dv], v1: s.knotsV[s.nv] };
  GRID.set(s, g);
  return g;
}

// Closest point by grid search, then Newton on the squared distance (Gauss-
// Newton with the second-order term, clamped to the parameter box).
export function bsplineClosest(s, p) {
  const g = grid(s);
  let best = g.pts[0], bd = Infinity;
  for (const q of g.pts) {
    const d = (q.p[0] - p[0]) ** 2 + (q.p[1] - p[1]) ** 2 + (q.p[2] - p[2]) ** 2;
    if (d < bd) { bd = d; best = q; }
  }
  let { u, v } = best;
  for (let it = 0; it < 40; it++) {
    const e = bsplineEval(s, u, v), r = sub(e.p, p);
    const a = dot(e.su, e.su), b = dot(e.su, e.sv), c = dot(e.sv, e.sv);
    const fu = dot(r, e.su), fv = dot(r, e.sv), det = a * c - b * b;
    if (!(Math.abs(det) > 1e-300)) break;
    const du = (c * fu - b * fv) / det, dv = (a * fv - b * fu) / det;
    const nu = Math.min(g.u1, Math.max(g.u0, u - du)), nv = Math.min(g.v1, Math.max(g.v0, v - dv));
    const step = Math.abs(nu - u) + Math.abs(nv - v);
    u = nu; v = nv;
    if (step < 1e-15) break;
  }
  const e = bsplineEval(s, u, v);
  return { u, v, p: e.p, su: e.su, sv: e.sv, distance: norm(sub(e.p, p)) };
}

export function bsplineDistance(s, p) {
  return bsplineClosest(s, p).distance;
}

// Natural normal Su × Sv at the closest point.
export function bsplineNormal(s, p) {
  const c = bsplineClosest(s, p), n = cross(c.su, c.sv), l = norm(n);
  if (!(l > 0)) throw new Error('bspline: degenerate normal');
  return [n[0] / l, n[1] / l, n[2] / l];
}
