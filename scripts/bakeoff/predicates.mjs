// Boolean bake-off TEST INFRASTRUCTURE: exact geometric predicates for the
// validator. Never used to build production geometry.
//
// Inputs are doubles. Every wire real (hi + lo, two F32 words) is exactly a
// double, so these signs are the exact signs for the coordinates on the wire.
// A double evaluation with Shewchuk's static error bound decides almost every
// call; the rest are recomputed exactly with BigInt.

const EPS = 2 ** -53;
const O3_BOUND = (7 + 56 * EPS) * EPS;
const O2_BOUND = (3 + 16 * EPS) * EPS;

const view = new DataView(new ArrayBuffer(8));

// x = m * 2^e with integer m; returns [m (BigInt), e] or null for zero.
function decompose(x) {
  if (x === 0) return null;
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const sign = hi >>> 31 ? -1n : 1n;
  const biased = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e;
  if (biased === 0) e = -1074;
  else {
    m |= 1n << 52n;
    e = biased - 1075;
  }
  return [sign * m, e];
}

function exactInts(values) {
  const parts = values.map(decompose);
  let e0 = Infinity;
  for (const p of parts) if (p && p[1] < e0) e0 = p[1];
  return parts.map((p) => (p ? p[0] << BigInt(p[1] - e0) : 0n));
}

function sign(x) {
  return x > 0 ? 1 : x < 0 ? -1 : 0;
}

function orient3dExact(a, b, c, d) {
  const [ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz] = exactInts([...a, ...b, ...c, ...d]);
  const adx = ax - dx, ady = ay - dy, adz = az - dz;
  const bdx = bx - dx, bdy = by - dy, bdz = bz - dz;
  const cdx = cx - dx, cdy = cy - dy, cdz = cz - dz;
  const det = adx * (bdy * cdz - bdz * cdy) + bdx * (cdy * adz - cdz * ady) + cdx * (ady * bdz - adz * bdy);
  return det > 0n ? 1 : det < 0n ? -1 : 0;
}

// Sign of det[a-d; b-d; c-d]: positive when d lies below the plane of a, b, c
// seen counter-clockwise (Shewchuk's convention).
export function orient3d(a, b, c, d) {
  const adx = a[0] - d[0], ady = a[1] - d[1], adz = a[2] - d[2];
  const bdx = b[0] - d[0], bdy = b[1] - d[1], bdz = b[2] - d[2];
  const cdx = c[0] - d[0], cdy = c[1] - d[1], cdz = c[2] - d[2];
  const bc = bdy * cdz - bdz * cdy;
  const ca = cdy * adz - cdz * ady;
  const ab = ady * bdz - adz * bdy;
  const det = adx * bc + bdx * ca + cdx * ab;
  const permanent = Math.abs(adx) * (Math.abs(bdy * cdz) + Math.abs(bdz * cdy))
    + Math.abs(bdx) * (Math.abs(cdy * adz) + Math.abs(cdz * ady))
    + Math.abs(cdx) * (Math.abs(ady * bdz) + Math.abs(adz * bdy));
  if (Math.abs(det) > O3_BOUND * permanent) return sign(det);
  return orient3dExact(a, b, c, d);
}

function orient2dExact(a, b, c) {
  const [ax, ay, bx, by, cx, cy] = exactInts([...a, ...b, ...c]);
  const det = (ax - cx) * (by - cy) - (ay - cy) * (bx - cx);
  return det > 0n ? 1 : det < 0n ? -1 : 0;
}

// Sign of the 2D cross product (a-c) x (b-c): positive when a, b, c turn
// counter-clockwise.
export function orient2d(a, b, c) {
  const l = (a[0] - c[0]) * (b[1] - c[1]);
  const r = (a[1] - c[1]) * (b[0] - c[0]);
  const det = l - r;
  if (Math.abs(det) > O2_BOUND * (Math.abs(l) + Math.abs(r))) return sign(det);
  return orient2dExact(a, b, c);
}

const DROP = [[1, 2], [2, 0], [0, 1]];
export const project = (p, axis) => [p[DROP[axis][0]], p[DROP[axis][1]]];

// Exact: all three coordinate projections of the triangle are collinear.
export function collinear3(a, b, c) {
  for (let k = 0; k < 3; k++) if (orient2d(project(a, k), project(b, k), project(c, k)) !== 0) return false;
  return true;
}

// A projection axis along which the (non-degenerate) triangle stays a triangle.
export function projectionAxis(a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [Math.abs(u[1] * v[2] - u[2] * v[1]), Math.abs(u[2] * v[0] - u[0] * v[2]), Math.abs(u[0] * v[1] - u[1] * v[0])];
  const order = [0, 1, 2].sort((i, j) => n[j] - n[i]);
  for (const k of order) if (orient2d(project(a, k), project(b, k), project(c, k)) !== 0) return k;
  return -1;
}

// --- closed 2D tests --------------------------------------------------------

function onSegment2(p, a, b) {
  return Math.min(a[0], b[0]) <= p[0] && p[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= p[1] && p[1] <= Math.max(a[1], b[1]);
}

export function segSeg2(p, q, a, b) {
  const d1 = orient2d(a, b, p), d2 = orient2d(a, b, q), d3 = orient2d(p, q, a), d4 = orient2d(p, q, b);
  if (d1 * d2 < 0 && d3 * d4 < 0) return true;
  if (d1 === 0 && onSegment2(p, a, b)) return true;
  if (d2 === 0 && onSegment2(q, a, b)) return true;
  if (d3 === 0 && onSegment2(a, p, q)) return true;
  if (d4 === 0 && onSegment2(b, p, q)) return true;
  return false;
}

export function pointInTri2(p, a, b, c) {
  const s1 = orient2d(a, b, p), s2 = orient2d(b, c, p), s3 = orient2d(c, a, p);
  return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
}

function segTri2(p, q, a, b, c) {
  return pointInTri2(p, a, b, c) || pointInTri2(q, a, b, c) || segSeg2(p, q, a, b) || segSeg2(p, q, b, c) || segSeg2(p, q, c, a);
}

function triTri2(P, Q) {
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (segSeg2(P[i], P[(i + 1) % 3], Q[j], Q[(j + 1) % 3])) return true;
  return pointInTri2(P[0], Q[0], Q[1], Q[2]) || pointInTri2(Q[0], P[0], P[1], P[2]);
}

// --- closed 3D tests (triangles must be non-degenerate) -----------------------

// Closed segment pq against closed triangle T; op / oq are orient3d(T, p|q).
export function segTri(p, q, op, oq, T) {
  if (op * oq > 0) return false;
  const [a, b, c] = T;
  if (op === 0 && oq === 0) {
    const k = projectionAxis(a, b, c);
    return segTri2(project(p, k), project(q, k), project(a, k), project(b, k), project(c, k));
  }
  const s1 = orient3d(p, q, a, b), s2 = orient3d(p, q, b, c), s3 = orient3d(p, q, c, a);
  return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
}

// Closed triangle/triangle intersection (touching counts).
export function triTri(P, Q) {
  const s = P.map((p) => orient3d(Q[0], Q[1], Q[2], p));
  if ((s[0] > 0 && s[1] > 0 && s[2] > 0) || (s[0] < 0 && s[1] < 0 && s[2] < 0)) return false;
  const t = Q.map((q) => orient3d(P[0], P[1], P[2], q));
  if ((t[0] > 0 && t[1] > 0 && t[2] > 0) || (t[0] < 0 && t[1] < 0 && t[2] < 0)) return false;
  if (s[0] === 0 && s[1] === 0 && s[2] === 0) {
    const k = projectionAxis(Q[0], Q[1], Q[2]);
    return triTri2(P.map((p) => project(p, k)), Q.map((q) => project(q, k)));
  }
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    if (segTri(P[i], P[j], s[i], s[j], Q)) return true;
    if (segTri(Q[i], Q[j], t[i], t[j], P)) return true;
  }
  return false;
}
