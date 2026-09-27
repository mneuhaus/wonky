#!/usr/bin/env node
// Boolean bake-off TEST INFRASTRUCTURE: result mesh validator.
//
// Checks a prototype's tagged output mesh (docs/bakeoff.md, "Validation"):
//   - vertices are welded by exact position (the wire reals are exact
//     doubles), so duplicated indices at one point cannot fake a seam;
//   - watertight and consistently oriented: every directed edge occurs exactly
//     once and its reverse exactly once;
//   - 2-manifold: additionally the triangles around every vertex form one fan;
//   - no degenerate triangles (repeated vertex, or exactly collinear corners);
//   - no self-intersections: BVH pair search + exact closed triangle/triangle
//     test; triangles sharing an edge may only meet in it (no coplanar fold),
//     triangles sharing a vertex only in it;
//   - volume, area, bbox, components, Euler characteristic and genus;
//   - tags: every tag names a face of the job, and every corner of a triangle
//     lies on that face's carrier surface within deviation + 1e-9 mm.
//
// Usage: node scripts/bakeoff/validate.mjs <job-file> <result-file>
//   prints the report as JSON; exit 0 if valid (or a well-formed unresolved),
//   1 if invalid, 2 on malformed input.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeJob, decodeResult } from './jobfmt.mjs';
import { collinear3, orient3d, projectionAxis, project, orient2d, segTri, triTri } from './predicates.mjs';
import { surfaceDistance } from './tessellate.mjs';

export const TAG_SLACK_MM = 1e-9;
const MAX_LISTED = 20;

function weld(vertices) {
  const key = new Map();
  const id = new Int32Array(vertices.length);
  const pos = [];
  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];
    const k = `${v[0]},${v[1]},${v[2]}`;
    let w = key.get(k);
    if (w === undefined) {
      w = pos.length;
      key.set(k, w);
      pos.push(v);
    }
    id[i] = w;
  }
  return { id, pos };
}

// --- BVH over triangle boxes ------------------------------------------------

function buildBvh(boxes, n) {
  const order = Int32Array.from({ length: n }, (_, i) => i);
  const nodes = [];
  const centroid = (t, k) => boxes[6 * t + k] + boxes[6 * t + 3 + k];
  function build(lo, hi) {
    const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = lo; i < hi; i++) {
      const t = order[i];
      for (let k = 0; k < 3; k++) {
        box[k] = Math.min(box[k], boxes[6 * t + k]);
        box[3 + k] = Math.max(box[3 + k], boxes[6 * t + 3 + k]);
      }
    }
    const node = { box, lo, hi, left: null, right: null };
    nodes.push(node);
    if (hi - lo > 8) {
      let axis = 0;
      for (let k = 1; k < 3; k++) if (box[3 + k] - box[k] > box[3 + axis] - box[axis]) axis = k;
      const slice = Array.from(order.subarray(lo, hi)).sort((a, b) => centroid(a, axis) - centroid(b, axis));
      order.set(slice, lo);
      const mid = (lo + hi) >> 1;
      node.left = build(lo, mid);
      node.right = build(mid, hi);
    }
    return node;
  }
  const root = n ? build(0, n) : null;
  return { root, order };
}

const overlap = (a, b) => a[0] <= b[3] && b[0] <= a[3] && a[1] <= b[4] && b[1] <= a[4] && a[2] <= b[5] && b[2] <= a[5];

function candidatePairs(boxes, n, visit) {
  const { root, order } = buildBvh(boxes, n);
  if (!root) return;
  const tbox = (t) => boxes.subarray(6 * t, 6 * t + 6);
  const stack = [[root, root]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (a !== b && !overlap(a.box, b.box)) continue;
    const aLeaf = !a.left, bLeaf = !b.left;
    if (aLeaf && bLeaf) {
      for (let i = a.lo; i < a.hi; i++) {
        const ti = order[i];
        for (let j = a === b ? i + 1 : b.lo; j < b.hi; j++) {
          const tj = order[j];
          if (overlap(tbox(ti), tbox(tj)) && visit(Math.min(ti, tj), Math.max(ti, tj)) === false) return;
        }
      }
    } else if (a === b) {
      stack.push([a.left, a.left], [a.right, a.right], [a.left, a.right]);
    } else if (aLeaf || (!bLeaf && b.hi - b.lo > a.hi - a.lo)) {
      stack.push([a, b.left], [a, b.right]);
    } else {
      stack.push([a.left, b], [a.right, b]);
    }
  }
}

// Do welded triangles i and j (non-degenerate) meet outside their shared
// vertices / edge?
function pairIntersects(T, P, Q) {
  const shared = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (T.p[i] === T.q[j]) shared.push([i, j]);
  if (shared.length === 0) return triTri(P, Q);
  if (shared.length >= 3) return true; // the same triangle twice
  if (shared.length === 2) {
    // Shared edge a-b: they meet elsewhere only if coplanar and folded onto
    // the same side of the edge.
    const [[i0], [i1]] = shared;
    const a = P[i0], b = P[i1];
    const c1 = P[3 - i0 - i1];
    const c2 = Q[3 - shared[0][1] - shared[1][1]];
    if (orient3d(a, b, c1, c2) !== 0) return false;
    const k = projectionAxis(P[0], P[1], P[2]);
    return orient2d(project(a, k), project(b, k), project(c1, k)) * orient2d(project(a, k), project(b, k), project(c2, k)) > 0;
  }
  // One shared vertex v: any other contact touches an opposite edge
  // (see docs/bakeoff.md, "Validation").
  const [iv, jv] = shared[0];
  const p1 = P[(iv + 1) % 3], p2 = P[(iv + 2) % 3];
  const q1 = Q[(jv + 1) % 3], q2 = Q[(jv + 2) % 3];
  if (segTri(p1, p2, orient3d(Q[0], Q[1], Q[2], p1), orient3d(Q[0], Q[1], Q[2], p2), Q)) return true;
  return segTri(q1, q2, orient3d(P[0], P[1], P[2], q1), orient3d(P[0], P[1], P[2], q2), P);
}

// mesh: {vertices: [[x,y,z]...], triangles: [[a,b,c,tag]...]}
// options: {faces?: job face table, deviation?: mm, selfIntersections?: bool}
export function validateMesh(mesh, { faces = null, deviation = 0, selfIntersections = true } = {}) {
  const t0 = performance.now();
  const { vertices, triangles } = mesh;
  const nt = triangles.length;
  const issues = [];
  const note = (kind, detail) => {
    if (issues.filter((i) => i.kind === kind).length < MAX_LISTED) issues.push({ kind, ...detail });
  };

  let badIndex = 0;
  for (let t = 0; t < nt; t++) {
    for (let k = 0; k < 3; k++) {
      const v = triangles[t][k];
      if (!(Number.isInteger(v) && v >= 0 && v < vertices.length)) {
        badIndex++;
        note('bad-index', { triangle: t });
      }
    }
  }
  if (badIndex) return { valid: false, badIndex, issues, ms: performance.now() - t0 };

  const { id, pos } = weld(vertices);
  const W = (t) => [id[triangles[t][0]], id[triangles[t][1]], id[triangles[t][2]]];
  const nv = pos.length;

  // Degenerate triangles.
  const degenerate = new Uint8Array(nt);
  let degenerateCount = 0;
  for (let t = 0; t < nt; t++) {
    const [a, b, c] = W(t);
    if (a === b || b === c || c === a || collinear3(pos[a], pos[b], pos[c])) {
      degenerate[t] = 1;
      degenerateCount++;
      note('degenerate', { triangle: t });
    }
  }

  // Directed edges.
  const directed = new Map();
  const key = (a, b) => a * nv + b;
  for (let t = 0; t < nt; t++) {
    const w = W(t);
    for (let k = 0; k < 3; k++) {
      const e = key(w[k], w[(k + 1) % 3]);
      directed.set(e, (directed.get(e) ?? 0) + 1);
    }
  }
  let boundaryEdges = 0, duplicateDirected = 0, undirected = 0, nonManifoldEdges = 0;
  for (const [e, n] of directed) {
    const a = Math.floor(e / nv), b = e % nv;
    const r = directed.get(key(b, a)) ?? 0;
    if (n > 1) {
      duplicateDirected++;
      note('orientation', { edge: [a, b], count: n });
    }
    if (r === 0) {
      boundaryEdges++;
      note('open-edge', { edge: [a, b], at: pos[a] });
    }
    if (a < b || r === 0) {
      undirected++;
      if (n + r !== 2) nonManifoldEdges++;
    }
  }
  const watertight = boundaryEdges === 0 && duplicateDirected === 0 && nonManifoldEdges === 0;

  // Vertex fans: link edges x->y of the triangles around v form one cycle.
  let nonManifoldVertices = 0;
  if (watertight) {
    const links = Array.from({ length: nv }, () => []);
    for (let t = 0; t < nt; t++) {
      const [a, b, c] = W(t);
      links[a].push(b, c);
      links[b].push(c, a);
      links[c].push(a, b);
    }
    for (let v = 0; v < nv; v++) {
      const l = links[v];
      if (!l.length) continue;
      const next = new Map();
      for (let i = 0; i < l.length; i += 2) next.set(l[i], l[i + 1]);
      let x = l[0], steps = 0;
      do {
        x = next.get(x);
        steps++;
      } while (x !== undefined && x !== l[0] && steps <= l.length);
      if (steps !== l.length / 2) {
        nonManifoldVertices++;
        note('non-manifold-vertex', { vertex: v, at: pos[v] });
      }
    }
  }

  // Components (vertex connectivity) and Euler characteristic.
  const parent = Int32Array.from({ length: nv }, (_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  const used = new Uint8Array(nv);
  for (let t = 0; t < nt; t++) {
    const [a, b, c] = W(t);
    used[a] = used[b] = used[c] = 1;
    parent[find(b)] = find(a);
    parent[find(c)] = find(a);
  }
  let usedVertices = 0;
  const roots = new Set();
  for (let v = 0; v < nv; v++) if (used[v]) {
    usedVertices++;
    roots.add(find(v));
  }
  const components = roots.size;
  const euler = usedVertices - undirected + nt;
  const genus = watertight && nonManifoldVertices === 0 ? (2 * components - euler) / 2 : null;

  // Volume (about the bbox centre), area, bbox.
  const bbox = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (let v = 0; v < nv; v++) if (used[v]) for (let k = 0; k < 3; k++) {
    bbox.min[k] = Math.min(bbox.min[k], pos[v][k]);
    bbox.max[k] = Math.max(bbox.max[k], pos[v][k]);
  }
  const o = nt ? bbox.min.map((m, k) => (m + bbox.max[k]) / 2) : [0, 0, 0];
  let volume = 0, area = 0;
  for (let t = 0; t < nt; t++) {
    const [a, b, c] = W(t).map((i) => [pos[i][0] - o[0], pos[i][1] - o[1], pos[i][2] - o[2]]);
    const cx = b[1] * c[2] - b[2] * c[1], cy = b[2] * c[0] - b[0] * c[2], cz = b[0] * c[1] - b[1] * c[0];
    volume += (a[0] * cx + a[1] * cy + a[2] * cz) / 6;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    area += Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2;
  }

  // Self-intersections.
  let intersectingPairs = null;
  let pairsTested = 0;
  if (selfIntersections) {
    intersectingPairs = 0;
    const boxes = new Float64Array(6 * nt);
    for (let t = 0; t < nt; t++) {
      const w = W(t);
      for (let k = 0; k < 3; k++) {
        boxes[6 * t + k] = Math.min(pos[w[0]][k], pos[w[1]][k], pos[w[2]][k]);
        boxes[6 * t + 3 + k] = Math.max(pos[w[0]][k], pos[w[1]][k], pos[w[2]][k]);
      }
    }
    candidatePairs(boxes, nt, (i, j) => {
      if (degenerate[i] || degenerate[j]) return true;
      pairsTested++;
      const p = W(i), q = W(j);
      if (pairIntersects({ p, q }, p.map((x) => pos[x]), q.map((x) => pos[x]))) {
        intersectingPairs++;
        note('self-intersection', { triangles: [i, j] });
      }
      return true;
    });
  }

  // Tags.
  let tags = null;
  if (faces) {
    const tolerance = deviation + TAG_SLACK_MM;
    let unknown = 0, offSurface = 0, maxDistance = 0;
    for (let t = 0; t < nt; t++) {
      const tag = triangles[t][3];
      const face = faces[tag];
      if (!face) {
        unknown++;
        note('unknown-tag', { triangle: t, tag });
        continue;
      }
      for (let k = 0; k < 3; k++) {
        const d = surfaceDistance(face.surface, vertices[triangles[t][k]]);
        maxDistance = Math.max(maxDistance, d);
        if (!(d <= tolerance)) {
          offSurface++;
          note('off-surface', { triangle: t, tag, surface: face.surface.type, distanceMm: d });
        }
      }
    }
    tags = { unknown, offSurfaceCorners: offSurface, maxDistanceMm: maxDistance, toleranceMm: tolerance };
  }

  const valid = watertight && nonManifoldVertices === 0 && degenerateCount === 0
    && (intersectingPairs ?? 0) === 0 && (!tags || (tags.unknown === 0 && tags.offSurfaceCorners === 0));
  return {
    valid,
    watertight,
    vertices: vertices.length,
    weldedVertices: nv,
    duplicateVertexPositions: vertices.length - nv,
    triangles: nt,
    edges: undirected,
    openEdges: boundaryEdges,
    orientationErrors: duplicateDirected,
    nonManifoldEdges,
    nonManifoldVertices,
    degenerateTriangles: degenerateCount,
    selfIntersectingPairs: intersectingPairs,
    pairsTested,
    components,
    euler,
    genus,
    volume,
    area,
    bbox: nt ? bbox : null,
    tags,
    issues,
    ms: performance.now() - t0,
  };
}

// Job text + result text -> {status, reason?, report?}.
export function validateResult(jobText, resultText, options = {}) {
  const job = decodeJob(jobText);
  const result = decodeResult(resultText);
  if (result.status !== 'ok') return { status: result.status, reason: result.reason };
  const report = validateMesh(result.mesh, { faces: job.faces, deviation: job.deviation, ...options });
  return { status: 'ok', report };
}

function main(argv) {
  if (argv.length < 2) {
    console.error('usage: node scripts/bakeoff/validate.mjs <job-file> <result-file>');
    process.exit(2);
  }
  let out;
  try {
    out = validateResult(fs.readFileSync(argv[0], 'utf8'), fs.readFileSync(argv[1], 'utf8'));
  } catch (err) {
    console.error(`malformed input: ${err.message}`);
    process.exit(2);
  }
  console.log(JSON.stringify(out, null, 1));
  process.exit(out.status !== 'ok' || out.report.valid ? 0 : 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2));
}
