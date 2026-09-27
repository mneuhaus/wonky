import { fail } from './errors.mjs';

export const add = (a, b) => a.map((v, i) => v + b[i]);
export const sub = (a, b) => a.map((v, i) => v - b[i]);
export const scale = (a, k) => a.map(v => v * k);
export const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = a => Math.hypot(...a);
export function normalized(a, loc) {
  const magnitude = norm(a);
  if (!Number.isFinite(magnitude) || magnitude < 1e-12) fail('Cannot normalize a zero or non-finite vector', loc);
  return scale(a, 1 / magnitude);
}
export const tolerance = points => Math.max(1e-5, ...points.flat().map(x => Math.abs(x) * 2 ** -20));
const turn = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
export const signedArea = points => points.reduce((sum, p, i) => {
  const q = points[(i + 1) % points.length]; return sum + p[0] * q[1] - q[0] * p[1];
}, 0) / 2;

function onSegment(p, a, b, eps) {
  return Math.abs(turn(a, b, p)) <= eps * norm(sub(b, a)) &&
    p.every((v, i) => v >= Math.min(a[i], b[i]) - eps && v <= Math.max(a[i], b[i]) + eps);
}
// Distance of p from the line a-b is at most eps (a is not equal to b).
const nearLine = (p, a, b, eps) => Math.abs(turn(a, b, p)) <= eps * norm(sub(b, a));
function intersects(a, b, c, d, eps) {
  // Boxes apart by more than eps on one axis: no endpoint lies within eps of
  // the other segment and the segments cannot cross. Same answer, O(1).
  for (let k = 0; k < 2; k++) {
    if (Math.max(a[k], b[k]) + eps < Math.min(c[k], d[k]) || Math.max(c[k], d[k]) + eps < Math.min(a[k], b[k])) return false;
  }
  if (onSegment(a, c, d, eps) || onSegment(b, c, d, eps) || onSegment(c, a, b, eps) || onSegment(d, a, b, eps)) return true;
  // Two segments on one line (within eps) that do not touch are disjoint; the
  // signs of their near-zero turns are rounding noise and decide nothing.
  if (nearLine(c, a, b, eps) && nearLine(d, a, b, eps) && nearLine(a, c, d, eps) && nearLine(b, c, d, eps)) return false;
  return Math.sign(turn(a, b, c)) !== Math.sign(turn(a, b, d)) && Math.sign(turn(c, d, a)) !== Math.sign(turn(c, d, b));
}

// Host resource limit for profiles and face loops (was 256). Measured on
// 2026-09-23 (node 22, Apple M-series, load average 11-13), whole
// validatePolygon, regular n-gon / 2-radius star (every edge box overlaps the
// centre, the early-out's worst case):
//   470 vertices:  1.6 ms / 9.5 ms   (without the box early-out: 41 / 42 ms)
//   4096 vertices: 69 ms / 458 ms    (without the box early-out: 2.7 / 3.1 s)
// validateSolid of a 4096-gon prism, with triangulation: 0.74 s / 1.7 s.
// The planar Boolean keeps its own, lower input limits and refuses explicitly.
export const PROFILE_VERTEX_LIMIT = 4096;

// A corner b between a and c, all measured against eps:
// - 'corner':    a proper corner;
// - 'collinear': b lies within eps of the line a-c and projects strictly inside
//                the segment a-c; the ring goes straight on through b;
// - 'backtrack': the triangle a, b, c is thinner than eps (relative to its
//                longest side), but b is not between a and c: the ring
//                reverses on itself;
// - 'sliver':    thinner than eps against its longest side, b between a and c,
//                but farther than eps from the line a-c (not mergeable).
// kernel/profile-ring.bend applies the same rule exactly on the F32x2 words;
// here it runs in float64.
export function classifyCorner(a, b, c, eps) {
  const t = Math.abs(turn(a, b, c)), ab = sub(b, a), ac = sub(c, a), bc = sub(c, b);
  const longest = Math.max(norm(ab), norm(bc), norm(ac));
  if (t > eps * longest) return 'corner';
  if (!(dot(ab, ac) > 0 && dot(bc, ac) > 0)) return 'backtrack';
  return t <= eps * norm(ac) ? 'collinear' : 'sliver';
}

function checkRing(points, loc, strict) {
  const what = strict ? 'Face loop' : 'Profile';
  if (points.length < 3 || points.length > PROFILE_VERTEX_LIMIT) fail(`${strict ? 'A face loop' : 'A profile'} must have 3–${PROFILE_VERTEX_LIMIT} vertices`, loc);
  if (points.some(p => p.length !== 2 || p.some(v => !Number.isFinite(v) || Math.abs(v) > 10000))) fail(`${what} coordinates must be finite and within ±10,000 mm`, loc);
  const eps = tolerance(points), n = points.length;
  // Local checks first (every edge, then every corner), then the pairs: a
  // short edge or a reversing corner is named as such, not as the self-touch
  // it also causes.
  for (let i = 0; i < n; i++) {
    if (norm(sub(points[(i + 1) % n], points[i])) <= eps) fail(`${what} has a duplicate vertex or an edge below the F32 tolerance`, loc);
  }
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[(i + 1) % n], c = points[(i + 2) % n];
    if (strict) {
      if (Math.abs(turn(a, b, c)) <= eps * norm(sub(b, a))) fail('Face loop has collinear or nearly collinear consecutive edges', loc);
    } else {
      const corner = classifyCorner(a, b, c, eps);
      if (corner === 'backtrack') fail('Profile has collinear consecutive edges that reverse direction (a backtracking, self-touching corner)', loc);
      if (corner === 'sliver') fail('Profile has collinear or nearly collinear consecutive edges that cannot be merged within the F32 tolerance', loc);
    }
  }
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (intersects(a, b, points[j], points[(j + 1) % n], eps)) fail(`${what} is self-intersecting or self-touching`, loc);
    }
  }
  if (Math.abs(signedArea(points)) <= eps * eps) fail(`${what} has zero or unresolved area`, loc);
  return eps;
}

// Sketch profiles: a vertex in the middle of a straight edge (collinear, not
// backtracking) is admitted. kernel/profile-ring.bend merges it before the
// prism is built and records the merge; face loops of solids never contain it.
export const validatePolygon = (points, loc) => checkRing(points, loc, false);
// Planar face loops of a solid: strict, every vertex is a proper corner.
export const validateFaceLoop = (points, loc) => checkRing(points, loc, true);

export function faceVertices(body, face) {
  return face.loops[0].map(use => {
    const edge = body.edges[use.edge]; return use.forward ? edge.start : edge.end;
  });
}

// Ear clipping is used only to derive export/preview triangles. The modeling
// representation remains the shared-edge, planar-face B-rep.
export function triangulateFace(body, face) {
  const ids = faceVertices(body, face);
  const { origin, normal, x } = face.surface;
  const y = cross(normal, x);
  const xy = ids.map(id => {
    const p = sub(body.vertices[id], origin); return [dot(p, x), dot(p, y)];
  });
  const ring = ids.map((_, i) => i), triangles = [];
  const eps = tolerance(xy) ** 2;
  while (ring.length > 3) {
    let clipped = false;
    for (let j = 0; j < ring.length; j++) {
      const a = ring[(j + ring.length - 1) % ring.length], b = ring[j], c = ring[(j + 1) % ring.length];
      if (turn(xy[a], xy[b], xy[c]) <= eps) continue;
      const inside = ring.some(p => p !== a && p !== b && p !== c &&
        turn(xy[a], xy[b], xy[p]) >= -eps && turn(xy[b], xy[c], xy[p]) >= -eps && turn(xy[c], xy[a], xy[p]) >= -eps);
      if (inside) continue;
      triangles.push([ids[a], ids[b], ids[c]]); ring.splice(j, 1); clipped = true; break;
    }
    if (!clipped) fail('Could not triangulate a face within the numeric tolerance');
  }
  triangles.push(ring.map(i => ids[i]));
  return triangles;
}
export const triangulate = body => body.faces.flatMap((face, faceIndex) => triangulateFace(body, face).map(vertices => ({ vertices, face: faceIndex })));

export function validateSolid(body) {
  const { vertices, edges, faces } = body;
  if (vertices.length < 4 || edges.length < 6 || faces.length < 4) fail('Invalid solid: insufficient topology');
  if (vertices.some(v => v.length !== 3 || v.some(x => !Number.isFinite(x) || Math.abs(x) > 10000))) fail('Solid exceeds the finite ±10,000 mm coordinate envelope');
  const eps = tolerance(vertices), incident = edges.map(() => []), referenced = new Set();
  for (const edge of edges) {
    if (![edge.start, edge.end].every(i => Number.isInteger(i) && i >= 0 && i < vertices.length)) fail('Invalid edge vertex reference');
    if (norm(sub(vertices[edge.end], vertices[edge.start])) <= eps) fail('Solid contains an edge collapsed by F32 precision');
    referenced.add(edge.start); referenced.add(edge.end);
  }
  if (referenced.size !== vertices.length) fail('Solid has unreferenced vertices');
  for (let f = 0; f < faces.length; f++) {
    const face = faces[f];
    if (face.loops.length !== 1 || face.loops[0].length < 3) fail('Expected one outer loop per planar face');
    const loop = face.loops[0];
    for (const use of loop) {
      if (!Number.isInteger(use.edge) || !edges[use.edge] || typeof use.forward !== 'boolean') fail('Invalid coedge');
      incident[use.edge].push({ f, forward: use.forward });
    }
    loop.forEach((use, i) => {
      const e = edges[use.edge], nextUse = loop[(i + 1) % loop.length], next = edges[nextUse.edge];
      if ((use.forward ? e.end : e.start) !== (nextUse.forward ? next.start : next.end)) fail('Face loop is not closed');
    });
    const { origin, normal, x } = face.surface;
    if ([...origin, ...normal, ...x].some(v => !Number.isFinite(v))) fail('Non-finite plane geometry');
    if (Math.abs(norm(normal) - 1) > 1e-5 || Math.abs(norm(x) - 1) > 1e-5 || Math.abs(dot(normal, x)) > 1e-5) fail('Plane frame is not orthonormal');
    const points = faceVertices(body, face).map(i => vertices[i]);
    if (points.some(p => Math.abs(dot(sub(p, origin), normal)) > eps)) fail('Face vertices do not lie on the analytic plane');
    const y = cross(normal, x), xy = points.map(p => [dot(sub(p, origin), x), dot(sub(p, origin), y)]);
    validateFaceLoop(xy);
    if (signedArea(xy) <= eps * eps) fail('Face loop orientation disagrees with its outward surface normal');
  }
  if (incident.some(uses => uses.length !== 2 || uses[0].forward === uses[1].forward || uses[0].f === uses[1].f)) fail('Solid is not a closed, consistently oriented two-manifold');
  const seen = new Set([0]), stack = [0];
  while (stack.length) {
    const faceIndex = stack.pop();
    for (const use of faces[faceIndex].loops[0]) {
      for (const adjacent of incident[use.edge]) if (!seen.has(adjacent.f)) { seen.add(adjacent.f); stack.push(adjacent.f); }
    }
  }
  if (seen.size !== faces.length) fail('Solid shell is disconnected');
  const euler = vertices.length - edges.length + faces.length;
  if (euler !== 2) fail(`Expected genus-zero Euler characteristic 2, got ${euler}`);
  const triangles = triangulate(body), reference = vertices[0];
  let volume = 0, area = 0;
  for (const { vertices: ids } of triangles) {
    const [a, b, c] = ids.map(i => vertices[i]);
    volume += dot(sub(a, reference), cross(sub(b, reference), sub(c, reference))) / 6;
    area += norm(cross(sub(b, a), sub(c, a))) / 2;
  }
  if (!Number.isFinite(volume) || volume <= eps ** 3) fail('Solid has nonpositive or unresolved volume');
  return { vertices: vertices.length, edges: edges.length, faces: faces.length, eulerCharacteristic: euler,
    closed: true, volumeMm3: volume, areaMm2: area, toleranceMm: eps, triangles: triangles.length,
    boundsMm: { min: [0, 1, 2].map(k => Math.min(...vertices.map(p => p[k]))), max: [0, 1, 2].map(k => Math.max(...vertices.map(p => p[k]))) } };
}

