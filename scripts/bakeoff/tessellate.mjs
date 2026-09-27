// Boolean bake-off TEST INFRASTRUCTURE: primitive -> tagged watertight mesh.
//
// This is fixture generation for the bake-off harness, not kernel code. It
// never runs inside a modelling path; prototypes receive its output as input
// data. Every mesh it produces is:
//   - closed and consistently oriented (outward normals), 2-manifold;
//   - built from exact on-surface vertices (each vertex satisfies its
//     surfaces' equations up to the F32x2 quantization, ~1e-12 mm);
//   - seam-shared: every vertex is emitted once and referenced by index;
//   - tagged: each triangle carries the index of the analytic face it
//     approximates (see the face table in the job).
// Approximation is explicit: every curved leaf reports the measured maximum
// distance between its triangles and its analytic surface, and the fixture
// generator refuses a leaf whose measured deviation exceeds the stated
// case deviation.

import earcut from 'earcut';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOperands, tessellateBrep } from './brep-tessellate.mjs';
import { quantize } from './jobfmt.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const brepBody = (p) => loadOperands(path.join(ROOT, p.source)).bodies[p.body].body;

// ---------------------------------------------------------------------------
// Small vector helpers

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => scale(a, 1 / norm(a));

// cos/sin of a degree angle, exact at multiples of 90 degrees so that
// axis-aligned rotations keep coplanar and touching fixtures exact.
export function cosSinDeg(deg) {
  const q = ((deg % 360) + 360) % 360;
  if (q === 0) return [1, 0];
  if (q === 90) return [0, 1];
  if (q === 180) return [-1, 0];
  if (q === 270) return [0, -1];
  const r = (deg * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r)];
}

// Angle 2*pi*k/n, exact at quarter turns.
function ringCosSin(k, n, phaseDeg = 0) {
  return cosSinDeg(phaseDeg + (360 * k) / n);
}

// ---------------------------------------------------------------------------
// Transforms. transform = {rotate?: [{axis: 'x'|'y'|'z'|[x,y,z], deg}],
// translate?: [x,y,z]}; rotations apply in list order, then the translation.
// Resolved to a row-major 3x4 matrix [r00 r01 r02 tx r10 r11 r12 ty r20 r21 r22 tz].

function axisRotation(axis, deg) {
  const [c, s] = cosSinDeg(deg);
  let a = axis;
  if (axis === 'x') a = [1, 0, 0];
  else if (axis === 'y') a = [0, 1, 0];
  else if (axis === 'z') a = [0, 0, 1];
  const [x, y, z] = unit(a);
  const t = 1 - c;
  // Rodrigues; for principal axes the exact c/s give exact entries.
  return [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ];
}

function matMul(a, b) {
  const r = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    r[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
  }
  return r;
}

export function resolveTransform(t = {}) {
  let R = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (const r of t.rotate ?? []) R = matMul(axisRotation(r.axis, r.deg), R);
  const tr = t.translate ?? [0, 0, 0];
  return [R[0][0], R[0][1], R[0][2], tr[0], R[1][0], R[1][1], R[1][2], tr[1], R[2][0], R[2][1], R[2][2], tr[2]].map((v) => (v === 0 ? 0 : v));
}

export function applyPoint(m, p) {
  return [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
    m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
    m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
  ];
}

export function applyDir(m, d) {
  return [
    m[0] * d[0] + m[1] * d[1] + m[2] * d[2],
    m[4] * d[0] + m[5] * d[1] + m[6] * d[2],
    m[8] * d[0] + m[9] * d[1] + m[10] * d[2],
  ];
}

const q3 = (p) => [quantize(p[0]), quantize(p[1]), quantize(p[2])];

function transformSurface(m, s) {
  const out = { ...s };
  if (s.o) out.o = q3(applyPoint(m, s.o));
  if (s.n) out.n = q3(applyDir(m, s.n));
  if (s.x) out.x = q3(applyDir(m, s.x));
  for (const k of ['r', 'a', 'R']) if (k in s) out[k] = quantize(s[k]);
  return out;
}

// ---------------------------------------------------------------------------
// Surface distance (unsigned), used for deviation measurement here and for
// tag validation in validate.mjs.

export function surfaceDistance(s, p) {
  const d = sub(p, s.o);
  switch (s.type) {
    case 'plane':
      return Math.abs(dot(d, s.n) / norm(s.n));
    case 'sphere':
      return Math.abs(norm(d) - s.r);
    case 'cylinder': {
      const n = unit(s.n);
      const h = dot(d, n);
      return Math.abs(norm(sub(d, scale(n, h))) - s.r);
    }
    case 'cone': {
      // Meridian half-plane: generatrix rho = r + h*tan(a). Distance to that
      // line, and to its mirror (the other nappe past the apex).
      const n = unit(s.n);
      const h = dot(d, n);
      const rho = norm(sub(d, scale(n, h)));
      const c = Math.cos(s.a);
      const sn = Math.sin(s.a);
      const lineDist = (x) => Math.abs((x - s.r) * c - h * sn);
      return Math.min(lineDist(rho), lineDist(-rho));
    }
    case 'torus': {
      const n = unit(s.n);
      const h = dot(d, n);
      const rho = norm(sub(d, scale(n, h)));
      return Math.abs(Math.hypot(rho - s.R, h) - s.r);
    }
    default:
      throw new Error(`unknown surface ${s.type}`);
  }
}

// ---------------------------------------------------------------------------
// Segment counts

export function chordCount(radius, deviation, { multipleOf = 4, min = 8 } = {}) {
  if (!(deviation > 0)) throw new Error('deviation must be positive');
  const ratio = 1 - deviation / radius;
  const n = ratio <= -1 ? min : Math.ceil(Math.PI / Math.acos(Math.max(-1, ratio)));
  const m = Math.max(min, n);
  return Math.ceil(m / multipleOf) * multipleOf;
}

// ---------------------------------------------------------------------------
// Local primitive builders. Each returns {vertices, triangles: [a,b,c,face],
// faces: [{faceIndex, surface}]} in primitive-local coordinates.

function planeX(n) {
  const a = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return unit(cross(a, n)).map((v) => (v === 0 ? 0 : v));
}

function plane(o, n) {
  return { type: 'plane', o, n, x: planeX(n) };
}

function buildBox({ min, max }) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  if (!(x1 > x0 && y1 > y0 && z1 > z0)) throw new Error('box must have positive extent');
  const V = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const faces = [
    { faceIndex: 0, surface: plane([x0, y0, z0], [-1, 0, 0]), quad: [0, 4, 7, 3] },
    { faceIndex: 1, surface: plane([x1, y0, z0], [1, 0, 0]), quad: [1, 2, 6, 5] },
    { faceIndex: 2, surface: plane([x0, y0, z0], [0, -1, 0]), quad: [0, 1, 5, 4] },
    { faceIndex: 3, surface: plane([x0, y1, z0], [0, 1, 0]), quad: [3, 7, 6, 2] },
    { faceIndex: 4, surface: plane([x0, y0, z0], [0, 0, -1]), quad: [0, 3, 2, 1] },
    { faceIndex: 5, surface: plane([x0, y0, z1], [0, 0, 1]), quad: [4, 5, 6, 7] },
  ];
  const T = [];
  faces.forEach((f, i) => {
    const [a, b, c, d] = f.quad;
    T.push([a, b, c, i], [a, c, d, i]);
  });
  return { vertices: V, triangles: T, faces: faces.map(({ faceIndex, surface }) => ({ faceIndex, surface })) };
}

function buildFrustum({ r1, r2, height, segments, phaseDeg = 0 }, deviation, kind) {
  if (!(height > 0)) throw new Error(`${kind} height must be positive`);
  if (!(r1 >= 0 && r2 >= 0 && (r1 > 0 || r2 > 0))) throw new Error(`${kind} radii invalid`);
  const rmax = Math.max(r1, r2);
  const n = segments ?? chordCount(rmax, deviation);
  const V = [];
  const T = [];
  const ring = (r, z) => {
    if (r === 0) {
      V.push([0, 0, z]);
      return { apex: V.length - 1 };
    }
    const start = V.length;
    for (let k = 0; k < n; k++) {
      const [c, s] = ringCosSin(k, n, phaseDeg);
      V.push([r * c, r * s, z]);
    }
    return { start };
  };
  const bot = ring(r1, 0);
  const top = ring(r2, height);
  const b = (k) => bot.start + (k % n);
  const t = (k) => top.start + (k % n);
  for (let k = 0; k < n; k++) {
    if (bot.apex !== undefined) T.push([bot.apex, t(k + 1), t(k), 0]);
    else if (top.apex !== undefined) T.push([b(k), b(k + 1), top.apex, 0]);
    else T.push([b(k), b(k + 1), t(k + 1), 0], [b(k), t(k + 1), t(k), 0]);
  }
  const faces = [];
  const x = [1, 0, 0];
  if (kind === 'cylinder') faces.push({ faceIndex: 0, surface: { type: 'cylinder', o: [0, 0, 0], n: [0, 0, 1], x, r: r1 } });
  else faces.push({ faceIndex: 0, surface: { type: 'cone', o: [0, 0, 0], n: [0, 0, 1], x, r: r1, a: Math.atan((r2 - r1) / height) } });
  if (bot.start !== undefined) {
    V.push([0, 0, 0]);
    const c = V.length - 1;
    for (let k = 0; k < n; k++) T.push([c, b(k + 1), b(k), 1]);
    faces.push({ faceIndex: 1, surface: { type: 'plane', o: [0, 0, 0], n: [0, 0, -1], x: [1, 0, 0] } });
  }
  if (top.start !== undefined) {
    V.push([0, 0, height]);
    const c = V.length - 1;
    for (let k = 0; k < n; k++) T.push([c, t(k), t(k + 1), 2]);
    faces.push({ faceIndex: 2, surface: { type: 'plane', o: [0, 0, height], n: [0, 0, 1], x: [1, 0, 0] } });
  }
  return { vertices: V, triangles: T, faces, segments: n };
}

function buildSphere({ radius, segments }, deviation) {
  let n = segments ?? chordCount(radius, deviation);
  for (;;) {
    const mesh = sphereGrid(radius, n);
    if (segments !== undefined || sphereDeviation(mesh, radius) <= deviation) return mesh;
    n += 4;
  }
}

function sphereGrid(radius, n) {
  const stacks = n / 2;
  const V = [[0, 0, -radius]];
  for (let j = 1; j < stacks; j++) {
    const [cp, sp] = cosSinDeg(-90 + (180 * j) / stacks);
    for (let k = 0; k < n; k++) {
      const [c, s] = ringCosSin(k, n);
      V.push([radius * cp * c, radius * cp * s, radius * sp]);
    }
  }
  V.push([0, 0, radius]);
  const north = V.length - 1;
  const at = (j, k) => 1 + (j - 1) * n + (k % n);
  const T = [];
  for (let k = 0; k < n; k++) T.push([0, at(1, k + 1), at(1, k), 0]);
  for (let j = 1; j < stacks - 1; j++) {
    for (let k = 0; k < n; k++) T.push([at(j, k), at(j, k + 1), at(j + 1, k + 1), 0], [at(j, k), at(j + 1, k + 1), at(j + 1, k), 0]);
  }
  for (let k = 0; k < n; k++) T.push([north, at(stacks - 1, k), at(stacks - 1, k + 1), 0]);
  return { vertices: V, triangles: T, faces: [{ faceIndex: 0, surface: { type: 'sphere', o: [0, 0, 0], r: radius } }], segments: n };
}

// Closest point of a triangle to a point (Ericson, Real-Time Collision Detection 5.1.5).
export function closestPointOnTriangle(p, a, b, c) {
  const ab = sub(b, a); const ac = sub(c, a); const ap = sub(p, a);
  const d1 = dot(ab, ap); const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b); const d3 = dot(ab, bp); const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return add(a, scale(ab, d1 / (d1 - d3)));
  const cp = sub(p, c); const d5 = dot(ab, cp); const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return add(a, scale(ac, d2 / (d2 - d6)));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return add(b, scale(sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6))));
  const denom = 1 / (va + vb + vc);
  return add(a, add(scale(ab, vb * denom), scale(ac, vc * denom)));
}

// Exact for a convex inscribed mesh: the farthest sphere point from a
// triangle lies over the triangle's closest point to the centre.
function sphereDeviation(mesh, radius) {
  let worst = 0;
  const o = [0, 0, 0];
  for (const [a, b, c] of mesh.triangles) {
    const q = closestPointOnTriangle(o, mesh.vertices[a], mesh.vertices[b], mesh.vertices[c]);
    worst = Math.max(worst, radius - norm(q));
  }
  return worst;
}

function buildTorus({ major, minor, segments, minorSegments }, deviation) {
  if (!(major > minor && minor > 0)) throw new Error('torus needs major > minor > 0');
  const n = segments ?? chordCount(major + minor, deviation / 2);
  const m = minorSegments ?? chordCount(minor, deviation / 2);
  const V = [];
  for (let i = 0; i < n; i++) {
    const [cu, su] = ringCosSin(i, n);
    for (let j = 0; j < m; j++) {
      const [cv, sv] = ringCosSin(j, m);
      const rr = major + minor * cv;
      V.push([rr * cu, rr * su, minor * sv]);
    }
  }
  const at = (i, j) => (i % n) * m + (j % m);
  const T = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
    T.push([at(i, j), at(i + 1, j), at(i + 1, j + 1), 0], [at(i, j), at(i + 1, j + 1), at(i, j + 1), 0]);
  }
  return {
    vertices: V,
    triangles: T,
    faces: [{ faceIndex: 0, surface: { type: 'torus', o: [0, 0, 0], n: [0, 0, 1], R: major, r: minor } }],
    segments: n,
    minorSegments: m,
  };
}

function signedArea2(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]; const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function buildPrism({ points, height }) {
  if (!(height > 0)) throw new Error('prism height must be positive');
  const pts = signedArea2(points) < 0 ? [...points].reverse() : points;
  const n = pts.length;
  if (n < 3) throw new Error('prism needs at least 3 points');
  const V = [...pts.map(([x, y]) => [x, y, 0]), ...pts.map(([x, y]) => [x, y, height])];
  const T = [];
  const tri = earcut(pts.flat());
  if (tri.length !== 3 * (n - 2)) throw new Error(`earcut produced ${tri.length / 3} triangles for a ${n}-gon`);
  for (let i = 0; i < tri.length; i += 3) {
    let [a, b, c] = [tri[i], tri[i + 1], tri[i + 2]];
    if (signedArea2([pts[a], pts[b], pts[c]]) < 0) [b, c] = [c, b];
    T.push([a, c, b, 0]);
    T.push([n + a, n + b, n + c, 1]);
  }
  const faces = [
    { faceIndex: 0, surface: { type: 'plane', o: [0, 0, 0], n: [0, 0, -1], x: [1, 0, 0] } },
    { faceIndex: 1, surface: { type: 'plane', o: [0, 0, height], n: [0, 0, 1], x: [1, 0, 0] } },
  ];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    T.push([i, j, n + j, 2 + i], [i, n + j, n + i, 2 + i]);
    const dx = pts[j][0] - pts[i][0];
    const dy = pts[j][1] - pts[i][1];
    const len = Math.hypot(dx, dy);
    if (!(len > 0)) throw new Error('prism has a zero-length edge');
    const nrm = [dy / len, -dx / len, 0];
    faces.push({ faceIndex: 2 + i, surface: { type: 'plane', o: [pts[i][0], pts[i][1], 0], n: nrm, x: [dx / len, dy / len, 0] } });
  }
  return { vertices: V, triangles: T, faces };
}

// ---------------------------------------------------------------------------
// Primitive parameters as written into the job's `prim` lines.

export function primParams(leaf) {
  const p = leaf.params;
  switch (leaf.prim) {
    case 'box': return [...p.min, ...p.max];
    case 'cylinder': return [p.radius, p.height];
    case 'cone': return [p.r1, p.r2, p.height];
    case 'sphere': return [p.radius];
    case 'torus': return [p.major, p.minor];
    case 'prism': return [p.height, ...p.points.flat()];
    case 'brep': return [];
    default: throw new Error(`unknown primitive ${leaf.prim}`);
  }
}

function buildLocal(leaf, deviation) {
  const p = leaf.params;
  switch (leaf.prim) {
    case 'box': return buildBox(p);
    case 'cylinder': return buildFrustum({ r1: p.radius, r2: p.radius, height: p.height, segments: p.segments, phaseDeg: p.phaseDeg }, deviation, 'cylinder');
    case 'cone': return buildFrustum({ r1: p.r1, r2: p.r2, height: p.height, segments: p.segments, phaseDeg: p.phaseDeg }, deviation, 'cone');
    case 'sphere': return buildSphere(p, deviation);
    case 'torus': return buildTorus(p, deviation);
    case 'prism': return buildPrism(p);
    default: throw new Error(`unknown primitive ${leaf.prim}`);
  }
}

// Sampled distance over a barycentric grid of `k` subdivisions per edge.
function sampledDeviation(vertices, triangles, surfaceOf, k = 8) {
  let worst = 0;
  for (const [a, b, c, f] of triangles) {
    const s = surfaceOf(f);
    if (s.type === 'plane') continue;
    const A = vertices[a]; const B = vertices[b]; const C = vertices[c];
    for (let i = 0; i <= k; i++) for (let j = 0; j <= k - i; j++) {
      const u = i / k; const v = j / k; const w = 1 - u - v;
      const p = [A[0] * w + B[0] * u + C[0] * v, A[1] * w + B[1] * u + C[1] * v, A[2] * w + B[2] * u + C[2] * v];
      worst = Math.max(worst, surfaceDistance(s, p));
    }
  }
  return worst;
}

function signedVolume(vertices, triangles) {
  let v = 0;
  for (const [a, b, c] of triangles) v += dot(vertices[a], cross(vertices[b], vertices[c]));
  return v / 6;
}

// leaf -> {vertices, triangles: [a,b,c,localFace], faces, matrix, deviation:
//   {measured, method}, segments?}
// Vertices and surfaces are in world coordinates, quantized to F32x2.
export function tessellateLeaf(leaf, deviation) {
  if (leaf.prim === 'brep') return tessellateBrepLeaf(leaf, deviation);
  const local = buildLocal(leaf, deviation);
  const matrix = resolveTransform(leaf.transform);
  const det = matrix[0] * (matrix[5] * matrix[10] - matrix[6] * matrix[9])
    - matrix[1] * (matrix[4] * matrix[10] - matrix[6] * matrix[8])
    + matrix[2] * (matrix[4] * matrix[9] - matrix[5] * matrix[8]);
  if (Math.abs(det - 1) > 1e-12) throw new Error('transform must be a proper rotation');
  const vertices = local.vertices.map((v) => q3(applyPoint(matrix, v)));
  const faces = local.faces.map(({ faceIndex, surface }) => ({ faceIndex, surface: transformSurface(matrix, surface) }));
  const byIndex = new Map(faces.map((f) => [f.faceIndex, f.surface]));
  const triangles = local.triangles;
  if (!(signedVolume(vertices, triangles) > 0)) throw new Error(`${leaf.prim}: tessellation is not outward-oriented`);
  let measured = 0;
  let method = 'exact-planar';
  if (leaf.prim === 'sphere') {
    measured = sphereDeviation(local, leaf.params.radius);
    method = 'closest-point (exact for inscribed convex mesh)';
  } else if (leaf.prim === 'cylinder' || leaf.prim === 'cone') {
    measured = sampledDeviation(vertices, triangles, (f) => byIndex.get(f), 8);
    method = 'barycentric-grid-8 (max lies on sampled chord midlines)';
  } else if (leaf.prim === 'torus') {
    measured = sampledDeviation(vertices, triangles, (f) => byIndex.get(f), 16);
    method = 'barycentric-grid-16 (sampled estimate)';
  }
  // Vertices must lie on every surface of the faces that use them.
  let onSurface = 0;
  for (const [a, b, c, f] of triangles) {
    const s = byIndex.get(f);
    for (const i of [a, b, c]) onSurface = Math.max(onSurface, surfaceDistance(s, vertices[i]));
  }
  if (onSurface > 1e-9) throw new Error(`${leaf.prim}: vertex off its surface by ${onSurface}`);
  return {
    vertices,
    triangles,
    faces,
    matrix,
    deviation: { measured, method, vertexOnSurfaceMax: onSurface },
    segments: local.segments,
    minorSegments: local.minorSegments,
  };
}

// A frozen exact B-rep body ({prim: 'brep', params: {source, body}}), placed
// as stored (identity transform only).
function tessellateBrepLeaf(leaf, deviation) {
  const t = leaf.transform ?? {};
  if ((t.rotate ?? []).length || (t.translate ?? [0, 0, 0]).some((x) => x !== 0)) throw new Error('brep leaves take no transform');
  const b = tessellateBrep(brepBody(leaf.params), deviation);
  if (!(signedVolume(b.vertices, b.triangles) > 0)) throw new Error('brep: tessellation is not outward-oriented');
  const byIndex = new Map(b.faces.map((f) => [f.faceIndex, f.surface]));
  let onSurface = 0;
  for (const [a, bb, c, f] of b.triangles) for (const i of [a, bb, c]) onSurface = Math.max(onSurface, surfaceDistance(byIndex.get(f), b.vertices[i]));
  if (onSurface > 1e-9) throw new Error(`brep: vertex off its surface by ${onSurface}`);
  return {
    vertices: b.vertices,
    triangles: b.triangles,
    faces: b.faces,
    matrix: resolveTransform({}),
    deviation: { measured: b.deviation.measured, method: b.deviation.method, vertexOnSurfaceMax: onSurface, sourceToleranceMm: b.sourceToleranceMm },
  };
}

// Analytic (exact-geometry) volume of a leaf, for the fixture sidecar.
export function analyticVolume(leaf) {
  const p = leaf.params;
  switch (leaf.prim) {
    case 'box': return (p.max[0] - p.min[0]) * (p.max[1] - p.min[1]) * (p.max[2] - p.min[2]);
    case 'cylinder': return Math.PI * p.radius ** 2 * p.height;
    case 'cone': return (Math.PI * p.height * (p.r1 ** 2 + p.r1 * p.r2 + p.r2 ** 2)) / 3;
    case 'sphere': return (4 / 3) * Math.PI * p.radius ** 3;
    case 'torus': return 2 * Math.PI ** 2 * p.major * p.minor ** 2;
    case 'prism': return Math.abs(signedArea2(p.points)) * p.height;
    case 'brep': return brepBody(p).validation?.volumeMm3 ?? null;
    default: throw new Error(`unknown primitive ${leaf.prim}`);
  }
}

export { signedVolume };
