// Certified-mesh bodies (docs/hybrid-mesh-bodies.md; docs/hybrid-boolean-plan.md
// section 8, step 8): what a hybrid Boolean returns when corefine built the
// result mesh and every certificate before exact recovery passed, but recover
// could not write the exact B-rep (a space quartic, a degenerate corner).
//
// Such a body is an APPROXIMATION, never exact:
//   geometry 'mesh', exact false, approximation {kind 'certified-mesh', label
//   'approximation', deviationMm, reason, certificate};
//   mesh {deviationMm, vertices, triangles [a, b, c, face]}: corefine's result
//   mesh, every point of which lies within deviationMm of the exact carrier of
//   its face (the operands' print meshes hold it, corefine keeps every result
//   triangle inside an input triangle, recover's input checks verified every
//   vertex);
//   faces: one per patch (edge-connected triangles on one carrier class), each
//   with the exact carrier it lies on; no exact edges or vertices
//   (edges = vertices = []).
//
// What it supports: print meshes and the r20 export (its own mesh, with the
// label), chained hybrid Booleans (src/hybrid.mjs tagOperand feeds the mesh
// and the carriers back into a job), evVolume (carrier method,
// src/volume.mjs), names and properties, face queries by body, and
// qCoincidesWithPlane/qGeometry on the face carriers (docs/fs-queries.md).
// Refused by name with recover's reason: STEP export, exact STL, edge and
// vertex queries and edge geometry, qContainsPoint, qClosestTo, qParallelEdges, qAdjacent,
// evBox3d, transforms.
//
// Dispatch note (src/boolean.mjs): a mesh operand must go to the hybrid arm
// directly. The exact arms read body.edges to admit an operand, and a mesh
// body has none, so `every(...)` over its edges is vacuously true
// (isMeshBody(a) || isMeshBody(b) -> last(...)).
import { createHash } from 'node:crypto';
import { fail, unsupported } from './errors.mjs';
import { sourceRef } from './hybrid.mjs';
import { list } from './kernel.mjs';
import { number, vector, coords } from './real.mjs';
import { surface as bendSurface } from './volume.mjs';
import { withHoles } from './print-mesh.mjs';

export const MESH_GEOMETRY = 'mesh';
// The dispatch's method name (src/boolean.mjs HYBRID_METHOD; not imported,
// boolean.mjs imports this module).
const HYBRID_METHOD = 'hybrid corefine+recover';

export const isMeshBody = body => body?.geometry === MESH_GEOMETRY;

// The certificate a mesh answer of kernel/hybrid/main.bend stands on (its
// header: BNo), plus the checks certifiedMeshBody runs itself.
export const MESH_CERTIFICATE = 'corefine output gate (vertex links; exact self-intersection test) passed; recover pre-certificate '
  + '(no undecided near contact between leaf faces, kernel/hybrid/recover/tangent.bend) passed; recover input checks '
  + '(every vertex within deviation x 1.000001 + 1e-9 mm of its tagged carrier, closed oriented 2-manifold, vertex links) passed; '
  + 'one closed oriented shell (checked here). Not evaluated, because recovery stopped before them: boundary distances to exact '
  + 'curves, shell nesting, clearance. The deviation is per point to the tagged exact carrier, not a Hausdorff bound to the exact result';

// "certified-mesh body <id> (approximation within 0.01 mm; <reason>)".
export function meshDescription(body) {
  const a = body.approximation ?? {};
  return `certified-mesh body ${body.id} (approximation within ${a.deviationMm} mm of its carriers; not recovered exactly: ${a.reason})`;
}

// The named refusal of an operation that needs exact geometry.
export function refuseMeshBody(body, what, loc) {
  return unsupported(`${what} is not available for ${meshDescription(body)}`, loc);
}

const sha256 = text => `sha256:${createHash('sha256').update(text).digest('hex')}`;

function unionFind(n) {
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = v => { while (parent[v] !== v) { parent[v] = parent[parent[v]]; v = parent[v]; } return v; };
  return { find, union: (x, y) => { const rx = find(x), ry = find(y); if (rx !== ry) parent[Math.max(rx, ry)] = Math.min(rx, ry); } };
}

// Every undirected edge used exactly twice, once in each direction; returns
// the map edge key -> [triangle using p->q, triangle using q->p] or the
// reason it is not a closed oriented 2-manifold.
export function meshEdges(triangles) {
  const edges = new Map();
  for (let t = 0; t < triangles.length; t++) {
    const tri = triangles[t];
    for (let k = 0; k < 3; k++) {
      const p = tri[k], q = tri[(k + 1) % 3];
      if (p === q) return { reason: `triangle ${t} is degenerate` };
      const key = p < q ? `${p},${q}` : `${q},${p}`, slot = p < q ? 0 : 1;
      let entry = edges.get(key);
      if (!entry) edges.set(key, entry = [-1, -1]);
      if (entry[slot] !== -1) return { reason: `edge ${key} is used twice in the same direction (not oriented or not 2-manifold)` };
      entry[slot] = t;
    }
  }
  for (const [key, [x, y]] of edges) if (x < 0 || y < 0) return { reason: `edge ${key} bounds only one triangle (not closed)` };
  return { edges };
}

// A mesh answer of the hybrid (src/hybrid.mjs hybridBoolean / decodeHybrid:
// {status 'mesh', deviationMm, reason, mesh, job, classes}) as one wonky body.
// Refused by name: an answer that is not a mesh answer, a mesh that is not
// one closed oriented shell (several shells need a nesting decision that
// recovery did not reach), a triangle tag outside the job's face table.
export function certifiedMeshBody(result, id, operands, loc) {
  if (result?.status !== 'mesh') fail(`certifiedMeshBody expects a hybrid mesh answer, got '${result?.status}'`, loc);
  const { job, mesh, reason } = result;
  if (!job || !Array.isArray(job.faces) || !mesh || !Array.isArray(mesh.vertices) || !Array.isArray(mesh.triangles)) fail('Hybrid mesh answer without its job or mesh', loc);
  if (!(result.deviationMm > 0) || !(job.deviation > 0)) fail('Hybrid mesh answer without a positive deviation', loc);
  const classes = result.classes;
  if (!Array.isArray(classes) || classes.length !== job.faces.length) fail('Hybrid mesh answer without the carrier classes of its job', loc);
  const refuse = why => unsupported(`the hybrid Boolean's certified mesh (${reason}) is not taken as a body: ${why}`, loc);
  const T = mesh.triangles;
  if (!T.length) refuse('it has no triangles');
  if (T.some(t => !(Number.isInteger(t[3]) && t[3] >= 0 && t[3] < classes.length) || t.slice(0, 3).some(v => !(Number.isInteger(v) && v >= 0 && v < mesh.vertices.length))))
    refuse('a triangle refers to a vertex or tag outside the answer');
  const manifold = meshEdges(T);
  if (!manifold.edges) refuse(manifold.reason);
  // One shell: triangles joined through shared vertices.
  const shells = unionFind(mesh.vertices.length);
  for (const [a, b, c] of T) { shells.union(a, b); shells.union(a, c); }
  const shellCount = new Set(T.map(t => shells.find(t[0]))).size;
  if (shellCount !== 1) refuse(`it has ${shellCount} shells, and their nesting (solid, void or separate body) was not certified because recovery stopped before its nesting stage`);
  // Patches: triangles of one carrier class joined across shared edges.
  const cls = t => classes[T[t][3]];
  const patches = unionFind(T.length);
  for (const [x, y] of manifold.edges.values()) if (cls(x) === cls(y)) patches.union(x, y);
  const faceOf = new Map(), faceTriangles = [];
  for (let t = 0; t < T.length; t++) {
    const root = patches.find(t);
    if (!faceOf.has(root)) { faceOf.set(root, faceTriangles.length); faceTriangles.push([]); }
    faceTriangles[faceOf.get(root)].push(t);
  }
  const operandSurface = tag => {
    const row = job.faces[tag], operand = operands?.[row.leaf];
    const surface = operand?.faces?.[row.faceIndex]?.surface;
    if (!surface) refuse(`the carrier of tag ${tag} (operand ${row.leaf}, face ${row.faceIndex}) is not available`);
    return structuredClone(surface);
  };
  const faces = faceTriangles.map(list => ({ surface: operandSurface(cls(list[0])) }));
  // The body keeps corefine's mesh: it is what the certificate covers and
  // what a chained Boolean consumes (a snapped operand drove corefine into a
  // zero-thickness membrane on KT1). Print meshes are snapped (printMesh ->
  // snappedPrintMesh).
  const meshVertices = mesh.vertices, meshTriangles = [], deviationMm = job.deviation;
  faceTriangles.forEach((list, face) => { for (const t of list) meshTriangles.push([T[t][0], T[t][1], T[t][2], face]); });
  // Compact vertices in first-use order.
  const vertexMap = new Map(), vertices = [];
  const vid = v => { if (!vertexMap.has(v)) { vertexMap.set(v, vertices.length); vertices.push([...meshVertices[v]]); } return vertexMap.get(v); };
  const triangles = meshTriangles.map(t => [vid(t[0]), vid(t[1]), vid(t[2]), t[3]]);
  const own = faceTriangles.map(() => []);
  for (const t of triangles) own[t[3]].push(t.slice(0, 3).map(v => vertices[v]));
  // The region digest makes the geometry revision (src/identity.mjs) depend on
  // the mesh, not only on the carriers.
  faces.forEach((face, i) => { face.region = { triangles: own[i].length, sha256: sha256(JSON.stringify(own[i])) }; });
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of vertices) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); }
  for (let k = 0; k < 3; k++) { min[k] -= deviationMm; max[k] += deviationMm; }
  const approximation = { kind: 'certified-mesh', label: 'approximation', deviationMm, jobDeviationMm: job.deviation, reason,
    certificate: MESH_CERTIFICATE, statement: `approximate, ${deviationMm} mm` };
  const body = {
    id: String(id), geometry: MESH_GEOMETRY, precision: 'F32x2', exact: false, approximation,
    vertices: [], edges: [], faces,
    shell: { closed: true, faces: faces.map((_, i) => i) },
    mesh: { deviationMm, vertices, triangles },
    validation: {
      vertices: vertices.length, edges: manifold.edges.size, faces: faces.length, triangles: triangles.length, closed: true,
      volumeMm3: null, boundsMm: { min, max, rule: 'mesh bounding box grown by the deviation' },
      scope: `certified mesh (approximation within ${deviationMm} mm of its exact carriers, never exact): closed oriented single shell; no exact edges or vertices; volume by the carrier method on request (src/volume.mjs)`,
    },
    construction: { method: HYBRID_METHOD, outcome: 'certified-mesh', deviationMm, reason },
    provenance: {
      method: 'hybrid corefine+recover: certified mesh (recover refused the exact B-rep; kernel/hybrid, Bend)',
      faces: faceTriangles.map(list => {
        const carrier = cls(list[0]);
        return { carrier: sourceRef(job, operands, carrier),
          carrierClass: classes.flatMap((c, t) => (c === carrier ? [sourceRef(job, operands, t)] : [])),
          sources: [...new Set(list.map(t => T[t][3]))].sort((x, y) => x - y).map(t => sourceRef(job, operands, t)) };
      }),
      statements: [{ kind: 'certified-mesh', text: `recover refused the exact B-rep (${reason}); the result is corefine's mesh within ${deviationMm} mm` }],
    },
  };
  body.provenance.operands = [...new Set(body.provenance.faces.flatMap(f => f.sources.map(s => s.leaf)))].sort((x, y) => x - y);
  return [body];
}

// The print mesh of a certified-mesh body: its mesh snapped onto the exact
// curves (snapMesh, cached per body and mesh), or the mesh as it is when
// snapping does not certify the body's deviation. The statement bounds the
// distance of every mesh point from the exact FACES, not only from their
// carriers: it is the larger of the carrier bound and the boundary drift (how
// far a boundary vertex lies from the exact boundary; snapMesh). A mesh whose
// statement exceeds the request, whose drift is unknown, or that has no kernel
// to measure it, is refused by name rather than written with a claim it does
// not hold; so is a finer request than the body holds.
const SNAPPED = new WeakMap();
//
// When the statement exceeds the request, the body's own Boolean is run again
// at half the request (setRefine: the dispatch attaches it, print-only; the
// body keeps its mesh), and that mesh is printed instead if it holds the
// request. A sharp wedge scales the boundary drift with the job deviation.
const REFINED = new WeakMap();
export function setRefine(body, refine) {
  const cache = new Map();
  Object.defineProperty(body, 'refineMesh', {
    enumerable: false, configurable: true,
    value: deviationMm => {
      if (!cache.has(deviationMm)) {
        const answer = refine(deviationMm);
        if (answer.body) REFINED.set(answer.body, true);
        cache.set(deviationMm, answer);
      }
      return cache.get(deviationMm).body ?? null;
    },
  });
  Object.defineProperty(body, 'refineReason', { enumerable: false, configurable: true, value: deviationMm => cache.get(deviationMm)?.reason ?? null });
}
export function snappedPrintMesh(kernel, body, deviationMm) {
  const first = printedMesh(kernel, body, deviationMm);
  if (typeof first.result.deviationMm === 'number' && first.result.deviationMm <= deviationMm) return first.result;
  // One refinement, not a refinement of a refinement.
  let refinedWhy = null;
  if (body.refineMesh && !REFINED.has(body)) {
    const finer = deviationMm / 2, refined = body.refineMesh(finer);
    if (refined) {
      const second = printedMesh(kernel, refined, deviationMm);
      if (typeof second.result.deviationMm === 'number' && second.result.deviationMm <= deviationMm) {
        return { ...second.result, snap: { ...second.result.snap, refinedJobDeviationMm: finer, firstStatedDeviationMm: first.result.deviationMm } };
      }
      refinedWhy = `at a job deviation of ${finer} mm it holds ${second.result.deviationMm ?? 'no bound'} mm`;
    } else refinedWhy = `the Boolean at ${finer} mm gives no mesh: ${body.refineReason(finer)}`;
  }
  const { result, why } = first;
  unsupported(`A print mesh within ${deviationMm} mm was asked of ${meshDescription(body)}; its boundary is not certified that close to the exact curves: `
    + (result.deviationMm === null ? `the distance of a boundary vertex from the exact boundary is unknown (${why})`
      : `the mesh holds ${result.deviationMm} mm (the larger of its carrier bound and its boundary drift; ${why ?? 'snapped'})`)
    + (refinedWhy ? `; refined: ${refinedWhy}` : ''));
}
function printedMesh(kernel, body, deviationMm) {
  const own = meshBodyTriangles(body, deviationMm);
  if (!kernel) unsupported(`A print mesh of ${meshDescription(body)} needs the kernel to measure its boundary drift (kernel/volume.bend mesh_snap)`);
  // Snapped towards the request (cached per mesh and request).
  if (!SNAPPED.has(body.mesh)) SNAPPED.set(body.mesh, new Map());
  let snapped = SNAPPED.get(body.mesh).get(deviationMm);
  if (!snapped) {
    const classOf = body.faces.map((_, i) => body.provenance?.faces?.[i]?.carrier?.tag ?? `face ${i}`);
    snapped = snapMesh(kernel, body.mesh, body.faces, classOf, body.mesh.deviationMm, deviationMm);
    SNAPPED.get(body.mesh).set(deviationMm, snapped);
  }
  let result, why;
  if (!snapped.refused && typeof snapped.deviationMm === 'number' && snapped.deviationMm <= deviationMm) {
    const V = snapped.vertices;
    result = { triangles: snapped.triangles.map(t => [V[t[0]], V[t[1]], V[t[2]]]), tags: snapped.triangles.map(t => t[3]), deviationMm: snapped.deviationMm, snap: snapped.snap };
  } else {
    // corefine's mesh as it is: the larger of the deviation and the largest
    // boundary drift.
    why = snapped.refused ?? `snapping certifies ${snapped.deviationMm ?? 'no bound (a drift is unknown)'} mm`;
    const claim = snapped.unsnappedClaim ?? null;
    result = { ...own, deviationMm: claim, snap: { ...(snapped.snap ?? {}), applied: false, ...(snapped.refused ? { refused: snapped.refused } : {}), unsnappedDeviationMm: claim } };
  }
  return { result, why };
}

// The body's own mesh as coordinates: [[p, q, r], ...] and per-triangle face
// indices. Refuses a finer request than the mesh holds.
export function meshBodyTriangles(body, deviationMm) {
  const m = body.mesh;
  if (!m || !Array.isArray(m.triangles) || !Array.isArray(m.vertices)) fail(`Certified-mesh body ${body.id} has no mesh`);
  if (!(m.deviationMm <= deviationMm)) {
    unsupported(`A mesh within ${deviationMm} mm was asked of ${meshDescription(body)}; it holds ${m.deviationMm} mm and cannot be refined (it has no exact faces to re-mesh)`);
  }
  return { triangles: m.triangles.map(t => [m.vertices[t[0]], m.vertices[t[1]], m.vertices[t[2]]]), tags: m.triangles.map(t => t[3]) };
}

// ---------------------------------------------------------------------------
// Snapping (print meshes only): boundary vertices onto the exact curves, with
// a re-certified deviation (docs/hybrid-mesh-bodies.md, "Snapping").
//
// corefine places a boundary vertex where two input FACETS meet. That point
// lies within the deviation of both carriers, but where the carriers meet at
// a shallow angle it can lie several deviations away from their exact curve
// along it (KT1: the Ø3.4 cross hole grazes the pocket floor at 20 degrees;
// the mesh slot is 0.028 mm narrower than the exact one). Snapping moves such
// vertices onto the curve (Bend: kernel/volume.bend mesh_snap), keeps the mesh
// valid, and states a deviation that is re-certified per triangle (Bend:
// mesh_bound) rather than assumed:
// - a boundary vertex moves only when its carriers are transversal there (the
//   smallest sine between their normals >= SNAP_SINE), Newton put it within
//   1e-9 mm of all of them, and it moved more than half the deviation (less
//   leaves the original claim intact) but at most SNAP_MOVE_CAP deviations;
//   at tangent carriers the curve is ill-conditioned and both surfaces lie
//   within the deviation of each other anyway;
// - a move that folds a triangle of a curved face is taken back; a planar face
//   with a folded triangle is re-triangulated from its boundary loops (no
//   interior vertex is needed on a plane);
// - every triangle touching a moved vertex, and every triangle made here, gets
//   a Bend bound of its distance to its carrier; a triangle whose bound
//   exceeds the target is split at its longest edge, the new vertex on the
//   carrier (or on the curve of the two carriers of a boundary edge);
// - an untouched triangle keeps the original claim (the deviation);
// - boundary drift (boundaryDrift): a point within the deviation of its
//   carrier is not within the deviation of the exact FACE when its foot lies
//   past the face's edge: at a sharp wedge a boundary vertex within 0.01 mm of
//   both carriers can sit 0.03 mm from their exact curve (KT1 turned 90
//   degrees: the slot edge, where the pocket floor and the cross hole meet at
//   20 degrees, stated 0.01 mm and was 0.030 mm off). Every boundary vertex
//   therefore gets its distance from the exact boundary in the local wedge of
//   its carriers, and every mesh edge between two carrier classes a claim
//   of adaptive samples along it (edgeDrift: the exact curve bends between
//   the edge's ends); a triangle's claim is the largest of its carrier bound,
//   its corners' drift and its boundary edges' claims. A vertex whose drift
//   exceeds half the deviation, or that ends a boundary edge over the target,
//   moves (Newton, as above); one that cannot keeps its drift in the claim.
//   A fold is first answered by moving the folding triangle's other corners
//   too (companions), then by taking moves back.
// The stated deviation is the largest of these. Any failure (a face that does
// not triangulate, a bound that cannot be computed) keeps the mesh as corefine
// made it, with the reason recorded.

export const SNAP_CERTIFICATE = 'Snapped (src/hybrid-mesh.mjs snapMesh): boundary vertices farther than half the deviation from the exact boundary of their carriers\' local wedge were moved onto the exact curve or corner by Newton in Bend (within 1e-9 mm); every triangle touching a moved vertex or made by re-triangulation or bisection has a Bend bound of its distance to its carrier (kernel/volume.bend mesh_bound), the others keep the deviation; every boundary vertex left in place has its distance from the exact boundary (boundary drift, local wedge model on Bend carrier values) in the claim of its triangles; every mesh edge between two carrier classes has the claim of adaptive samples along it (the same wedge model, Newton\'s points on the curve in Bend) plus the sagitta of the curve between neighbouring samples at twice its curvature bound there; the stated deviation is the largest';
export const SNAP_SINE = 0.1;
export const SNAP_MOVE_CAP = 10;
export const SNAP_MIN_MOVE = 0.5;
const SNAP_RESIDUAL = 1e-9;
const SNAP_ROUNDS = 24;
const SNAP_ATTEMPTS = 32;

const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalOf = (V, t) => vcross(vsub(V[t[1]], V[t[0]]), vsub(V[t[2]], V[t[0]]));
// Orientation bookkeeping on existing coordinates: the triangle keeps its side
// and does not collapse (area at least 1e-3 of what it was).
const kept = (before, after) => vdot(before, after) > 0 && vdot(after, after) >= 1e-6 * vdot(before, before);

function snapItems(kernel, items) {
  const out = [];
  for (let i = 0; i < items.length; i += 4096) out.push(...kernelArray(kernel.volume.mesh_snap(list(items.slice(i, i + 4096)))));
  // qr: the Bend point itself, handed back to Bend as it is (its binary64
  // value may not serialize again: an F32 word pair near underflow).
  return out.map(s => ({ q: coords(s.q), qr: s.q, res: number(s.res), sine: number(s.sine), moved: number(s.moved) }));
}
function boundItems(kernel, items) {
  const out = [];
  for (let i = 0; i < items.length; i += 4096) out.push(...kernelArray(kernel.volume.mesh_bound(list(items.slice(i, i + 4096)))));
  return out.map(b => ({ bound: number(b.bound), cosine: number(b.cosine) }));
}
// A moved or split triangle must stay on its side of the carrier (the sign of
// its normal against the carrier normal, from Bend) and not stand on edge.
// The snapped mesh is a print mesh, never a Boolean operand, so recover's
// stricter input check (|cosine| > 1/2) does not apply to it.
const SNAP_COSINE = 0.05;
const upright = (cosine, side) => Math.abs(cosine) >= SNAP_COSINE && Math.sign(cosine) === side;
// Which edge to split: the one that weighs most in the carrier's bound
// (kernel/volume.bend mesh_bound): on a cylinder or cone its part across the
// axis; its length otherwise. A choice only; the new point comes from Bend.
function edgeWeight(surface, e) {
  if (surface.type === 'cylinder' || surface.type === 'cone') {
    const a = surface.axis, k = vdot(e, a) / vdot(a, a), p = [e[0] - k * a[0], e[1] - k * a[1], e[2] - k * a[2]];
    // Ties (a strip's rim edge and its diagonal span the same angle) go to
    // the shorter edge, which bends less when split.
    const length = vdot(e, e);
    return vdot(p, p) * (1 + 1e-9 / (1 + length)) + (surface.type === 'cone' ? 1e-3 * length : 0);
  }
  return vdot(e, e);
}
function kernelArray(value) {
  const out = [];
  while (value.$ === 'Con') { out.push(value.head); value = value.tail; }
  if (value.$ !== 'Nil') fail('Invalid Bend list');
  return out;
}

// mesh: {vertices, triangles [a, b, c, face]}; faces[i].surface (body format);
// classOf[i]: the carrier class of face i (faces of one class share a
// carrier). Returns {vertices, triangles, deviationMm, snap} or
// {refused: reason}.
export function snapMesh(kernel, mesh, faces, classOf, deviationMm, target = deviationMm) {
  // A triangle still above the target after bisection is usually held up by
  // an unmoved corner up to the deviation off its carrier: that corner is
  // moved too (forced) and snapping starts over. A triangle with no such
  // corner pins the moves that made it instead. The first attempt that
  // certifies within the deviation is the answer.
  const pinned = new Set(), forced = new Set();
  let result, best = null;
  for (let attempt = 0; attempt < SNAP_ATTEMPTS; attempt++) {
    result = snapOnce(kernel, mesh, faces, classOf, deviationMm, target, pinned, forced);
    if (!result.refused && result.deviationMm !== null && !(best && best.deviationMm <= result.deviationMm)) best = result;
    if (process.env.WONKY_SNAP_DEBUG) console.error(`snap attempt ${attempt}: ${result.refused ?? `claim ${result.deviationMm}`} force ${result.force?.size} pin ${result.pin?.size} worst ${JSON.stringify(result.snap?.worst)}`);
    if (result.refused || !(result.deviationMm > target)) break;
    const grow = [...(result.force ?? [])].filter(v => !forced.has(v) && !pinned.has(v));
    const pin = [...(result.pin ?? [])].filter(v => !pinned.has(v));
    if (!grow.length && !pin.length) break;
    for (const v of grow) forced.add(v);
    for (const v of pin) { pinned.add(v); forced.delete(v); }
  }
  // The attempt with the smallest claim is the answer.
  if (best && !(result.deviationMm <= best.deviationMm)) result = best;
  if (result.snap) Object.assign(result.snap, { pinned: pinned.size, forced: forced.size });
  delete result.force; delete result.pin;
  return result;
}

// The boundary drift of every boundary vertex (see the comment above), and
// where to move it. Returns {drift: Map vertex -> mm (NaN: unknown), moveTo:
// Map vertex -> Snapped for a vertex on three classes or more whose corner is
// ill-conditioned (Newton's corner lies more than twice as far as the curves
// of its carrier pairs; it moves onto the curve it is farthest from instead),
// safe: how many vertices have no drift}.
//
// Local wedge model. Near the curve of two carriers A and B that meet along a
// mesh edge at the vertex, the exact solid is the intersection of their inner
// sides (a convex edge: the mesh dihedral folds inward) or their union (a
// concave edge; its complement is the intersection of the outer sides). f is
// a carrier's signed value at the vertex (Bend Value: the carrier function, a
// distance to first order; outward positive by the face's oriented mesh
// normal N); the tangent planes stand in for the carriers. The drift is the
// vertex's distance from the wedge's boundary when it lies outside the convex
// set (wedgeDistance), 0 inside it: a point inside is within |f| <= the
// carrier bound of the boundary. The largest over the vertex's pairs is its
// drift. The wedge is convex only while the edge is straight: along a curved
// intersection curve a mesh edge's interior can lie farther from the exact
// boundary than both its ends (verify#2: KT1 0.01013 mm where the corners
// were 0.00986 / 0.00961 and 0.01 was stated), so every boundary mesh edge
// has its own claim (edgeDrift), and a triangle's claim is the largest of its
// carrier bound, its corners' drift and its boundary edges' claims.
function boundaryDrift(kernel, V, T, around, classOf, surfaces, boundary, snapped) {
  const byClass = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
  const faceOfClass = v => {
    const m = new Map();
    for (const f of [...around[v]].sort((x, y) => x - y)) if (!m.has(classOf[f])) m.set(classOf[f], f);
    return m;
  };
  const index = new Map(boundary.map((v, i) => [v, i]));
  const onBoundary = new Set(boundary);
  const classesAt = new Map(boundary.map(v => [v, faceOfClass(v)]));
  const many = new Set(boundary.filter(v => classesAt.get(v).size >= 3));
  // Oriented mesh normals per vertex and class; the mesh edges between two
  // classes at a boundary vertex, with the vertex opposite on each side.
  const normal = new Map(), edges = new Map();
  for (const t of T) {
    const n = normalOf(V, t), c = classOf[t[3]];
    for (let k = 0; k < 3; k++) {
      const p = t[k], q = t[(k + 1) % 3], o = t[(k + 2) % 3];
      if (onBoundary.has(p)) {
        const key = `${p}|${c}`, m = normal.get(key) ?? [0, 0, 0];
        normal.set(key, [m[0] + n[0], m[1] + n[1], m[2] + n[2]]);
      }
      if (!onBoundary.has(p) && !onBoundary.has(q)) continue;
      const key = p < q ? `${p},${q}` : `${q},${p}`;
      if (!edges.has(key)) edges.set(key, { p, q, sides: [] });
      edges.get(key).sides.push({ c, o });
    }
  }
  const unit = a => { const l = Math.hypot(a[0], a[1], a[2]); return l > 0 ? a.map(x => x / l) : a; };
  const N = (v, c) => unit(normal.get(`${v}|${c}`) ?? [0, 0, 0]);
  // pairs[v]: Map pairKey -> {a, b, convex}
  const pairs = new Map(boundary.map(v => [v, new Map()]));
  for (const { p, q, sides } of edges.values()) {
    if (sides.length !== 2 || sides[0].c === sides[1].c) continue;
    for (const v of [p, q]) {
      if (!onBoundary.has(v)) continue;
      const [x, y] = [...sides].sort((u, w) => byClass(u.c, w.c));
      const key = JSON.stringify([x.c, y.c]);
      if (pairs.get(v).has(key)) continue;
      // Convex iff B's triangle folds to the inner side of A's.
      const convex = vdot(vsub(V[y.o], V[v]), N(v, x.c)) < 0;
      pairs.get(v).set(key, { a: x.c, b: y.c, convex });
    }
  }
  // The signed value of every carrier at a boundary vertex (Bend Value: the
  // carrier function, a distance to first order), and Newton's foot on the
  // curve of every pair at a vertex on three classes.
  const items = [], owners = [];
  for (const v of boundary) {
    const fc = classesAt.get(v);
    for (const [c, face] of fc) { items.push({ $: 'Value', p: vector(V[v]), s: surfaces[face] }); owners.push({ v, c }); }
    if (many.has(v)) for (const { a, b } of pairs.get(v).values()) { items.push({ $: 'Onto', p: vector(V[v]), cs: list([surfaces[fc.get(a)], surfaces[fc.get(b)]]) }); owners.push({ v, pair: [a, b] }); }
  }
  const feet = items.length ? snapItems(kernel, items) : [];
  const signed = new Map(), pairDrift = new Map(), worstFoot = new Map(), curve = new Map();
  feet.forEach((r, k) => {
    const { v, c, pair } = owners[k];
    if (pair) {
      curve.set(`${v}|${pair[0]}|${pair[1]}`, r.res <= SNAP_RESIDUAL ? r.moved : NaN);
      const d = !(r.res <= SNAP_RESIDUAL) ? Infinity : r.sine < SNAP_SINE ? 0 : r.moved;
      if (!(d <= (pairDrift.get(v) ?? -1))) worstFoot.set(v, r);
      pairDrift.set(v, Math.max(pairDrift.get(v) ?? 0, d));
    } else signed.set(`${v}|${c}`, vdot(vsub(V[v], r.q), N(v, c)));
  });
  const moveTo = new Map();
  for (const v of many) {
    const s = snapped[index.get(v)], p = pairDrift.get(v), r = worstFoot.get(v);
    if (s.res <= SNAP_RESIDUAL && !(s.moved > 2 * p)) continue;
    if (r && p < Infinity) moveTo.set(v, r);
  }
  // drift: the vertex's distance from the exact boundary in the wedge of every
  // carrier pair at it (the largest over the pairs; 0 inside the solid of the
  // wedge; NaN when a value is unknown).
  const drift = new Map();
  let safe = 0;
  for (const v of boundary) {
    const list = [...pairs.get(v).values()];
    let d = 0;
    for (const { a, b, convex } of list) {
      const sign = convex ? 1 : -1, fa = sign * signed.get(`${v}|${a}`), fb = sign * signed.get(`${v}|${b}`);
      const c = vdot(N(v, a), N(v, b)), sine = Math.sqrt(Math.max(0, 1 - c * c));
      if (!(fa >= -Infinity && fb >= -Infinity)) { d = NaN; break; }
      let w = wedgeDistance(fa, fb, c, sine);
      // Past the edge the tangent planes understate the distance where the
      // wedge is sharp (their error grows as 1/sine): the distance to Newton's
      // point on the exact curve is used instead (a vertex on two classes: its
      // own Newton point).
      if (w > Math.max(fa, fb)) {
        const e = many.has(v) ? curve.get(`${v}|${a}|${b}`) : (snapped[index.get(v)].res <= SNAP_RESIDUAL ? snapped[index.get(v)].moved : NaN);
        w = e >= 0 ? Math.max(w, e) : NaN;
      }
      d = Number.isNaN(w) ? NaN : Math.max(d, w);
      if (Number.isNaN(d)) break;
    }
    drift.set(v, d);
    if (d === 0) safe++;
  }
  return { drift, moveTo, safe };
}

// Boundary-edge drift (verify#2 of the gate): the wedge model of a vertex is
// exact for a straight edge only. Along a curved intersection curve the
// distance of a mesh edge's interior from the exact boundary can exceed that
// of both its ends: KT1's boundary edge on the rib arc (r 0.45 mm) and the
// Ø3.4 cross hole, 0.060 mm long, has ends 0.00986 / 0.00961 mm and a middle
// 0.01013 mm from the exact edge (the feet's chord bends 0.0011 mm off the
// curve). So every mesh edge between two carrier classes gets its own claim:
// the larger of its ends' drift and the wedge drift of its midpoint (Bend
// Value of both carriers there, and Newton's point on their curve past the
// edge), plus how far the curve can bend away from the chord between the
// feet (Newton's points on the curve, Bend) of neighbouring samples: the
// sagitta (1 - sqrt(1 - (k h / 2)^2)) / k over the feet's chord h. k is twice
// the largest curvature of the curve at the three feet (the margin for its
// change in between); there it is at most (|IIA(t,t)| + |IIB(t,t)|) / sine
// (the curvature vector lies in the plane of the two normals, with normal
// curvatures II(t,t) of the carriers along the curve's tangent t: 0 along a
// cylinder's ruling, so a plane meets a cylinder parallel to its axis in a
// straight line). Tangent carriers (a sine below SNAP_SINE) keep the wedge
// model's convention (0). Returns Map edge key -> claim (NaN: unknown).
export function curveSagitta(k, h) {
  if (k === 0 || h === 0) return 0;
  if (!(k > 0) || !(h > 0)) return NaN;
  const x = k * h / 2;
  return x >= 1 ? Infinity : (1 - Math.sqrt(1 - x * x)) / k;
}
const vunit = a => { const l = Math.hypot(a[0], a[1], a[2]); return l > 0 ? a.map(x => x / l) : a; };
// A carrier's unit normal at a point X on it and its normal curvature along a
// unit tangent (up to sign; |II(t,t)|).
export function carrierFrame(surface, X) {
  const t = surface.type;
  if (t === 'plane') return { n: vunit(surface.normal), II: () => 0 };
  if (t === 'sphere') return { n: vunit(vsub(X, surface.origin)), II: () => 1 / surface.radius };
  const k = vunit(surface.axis), d = vsub(X, surface.origin), h = vdot(d, k);
  const radial = [d[0] - h * k[0], d[1] - h * k[1], d[2] - h * k[2]], rho = Math.hypot(...radial), r = vunit(radial), e = vcross(k, r);
  if (t === 'cylinder') return { n: r, II: u => vdot(u, e) ** 2 / surface.radius };
  if (t === 'cone') {
    const tan = Math.tan(surface.angle), cos = Math.cos(surface.angle);
    return { n: vunit([r[0] - tan * k[0], r[1] - tan * k[1], r[2] - tan * k[2]]), II: u => (rho > 0 ? vdot(u, e) ** 2 * cos / rho : Infinity) };
  }
  if (t === 'torus') {
    const C = [0, 1, 2].map(i => surface.origin[i] + surface.major * r[i]); // the tube centre
    const n = vunit(vsub(X, C)), m = vcross(n, e);
    return { n, II: u => vdot(u, m) ** 2 / surface.minor + (rho > 0 ? vdot(u, e) ** 2 * Math.abs(vdot(n, r)) / rho : Infinity) };
  }
  return { n: [0, 0, 0], II: () => NaN };
}
// The curvature bound of the curve of two carriers at a point X on both.
export function curveCurvature(sa, sb, X) {
  const A = carrierFrame(sa, X), B = carrierFrame(sb, X);
  const tv = vcross(A.n, B.n), sine = Math.hypot(...tv);
  if (!(sine > 0)) return { k: NaN, sine: 0 };
  const u = tv.map(x => x / sine);
  return { k: (Math.abs(A.II(u)) + Math.abs(B.II(u))) / sine, sine };
}
// Samples are adaptive: an interval between two samples whose sagitta term
// exceeds EDGE_TOL of the target, or whose claim exceeds the target, is halved
// (a new sample at its middle), at most EDGE_DEPTH times, so a long chord of
// a gently curved edge is claimed by its samples rather than by one bound
// over its whole length.
export const EDGE_DEPTH = 8;
export const EDGE_TOL = 0.05;
function edgeDrift(kernel, V, T, classOf, surfaces, faces, driftOf, target) {
  const tol = EDGE_TOL * target;
  const byClass = (x, y) => (x.c < y.c ? -1 : x.c > y.c ? 1 : 0);
  const sides = new Map();
  for (const t of T) {
    const n = vunit(normalOf(V, t)), c = classOf[t[3]];
    for (let k = 0; k < 3; k++) {
      const p = t[k], q = t[(k + 1) % 3], key = p < q ? `${p},${q}` : `${q},${p}`;
      if (!sides.has(key)) sides.set(key, { p, q, sides: [] });
      sides.get(key).sides.push({ c, face: t[3], o: t[(k + 2) % 3], n });
    }
  }
  const edges = [];
  for (const [key, e] of sides) {
    if (e.sides.length !== 2 || e.sides[0].c === e.sides[1].c) continue;
    const [x, y] = [...e.sides].sort(byClass), P = V[e.p], Q = V[e.q];
    const convex = vdot(vsub(V[y.o], P), x.n) < 0;
    const c = vdot(x.n, y.n);
    edges.push({ key, ...e, x, y, P, Q, sign: convex ? 1 : -1, c, sine: Math.sqrt(Math.max(0, 1 - c * c)),
      cs: list([surfaces[x.face], surfaces[y.face]]), sa: faces[x.face].surface, sb: faces[y.face].surface, samples: [], claim: 0 });
  }
  // One sample of an edge at parameter s: its drift (the wedge model; the
  // ends keep their vertex drift) and Newton's foot on the curve.
  const at = (e, s) => [0, 1, 2].map(i => e.P[i] + s * (e.Q[i] - e.P[i]));
  let todo = edges.flatMap(e => [{ e, s: 0 }, { e, s: 1 }, { e, s: 0.5 }]);
  for (let depth = 0; todo.length; depth++) {
    const items = [];
    for (const { e, s } of todo) {
      const p = vector(at(e, s));
      items.push({ $: 'Onto', p, cs: e.cs });
      if (s > 0 && s < 1) items.push({ $: 'Value', p, s: surfaces[e.x.face] }, { $: 'Value', p, s: surfaces[e.y.face] });
    }
    const got = snapItems(kernel, items);
    let k = 0;
    for (const { e, s } of todo) {
      const foot = got[k++];
      let d;
      if (s === 0 || s === 1) d = driftOf(s === 0 ? e.p : e.q);
      else {
        const ra = got[k++], rb = got[k++], m = at(e, s);
        const fa = e.sign * vdot(vsub(m, ra.q), e.x.n), fb = e.sign * vdot(vsub(m, rb.q), e.y.n);
        d = fa >= -Infinity && fb >= -Infinity ? wedgeDistance(fa, fb, e.c, e.sine) : NaN;
        if (d > Math.max(fa, fb)) d = foot.res <= SNAP_RESIDUAL ? Math.max(d, foot.moved) : NaN;
      }
      const X = foot.res <= SNAP_RESIDUAL ? foot.q : null;
      e.samples.push({ s, d, X, curv: X ? curveCurvature(e.sa, e.sb, X) : null, tangent: foot.res <= SNAP_RESIDUAL && foot.sine < SNAP_SINE });
    }
    // Intervals between neighbouring samples: max drift + sagitta of the
    // curve over the feet's chord (k: twice the larger curvature at the two
    // feet); intervals over tol are halved.
    todo = [];
    for (const e of edges) {
      if (e.done) continue;
      e.samples.sort((u, w) => u.s - w.s);
      let claim = 0, more = false;
      for (let i = 0; i + 1 < e.samples.length; i++) {
        const u = e.samples[i], w = e.samples[i + 1];
        const d = Math.max(u.d, w.d);
        if (!(d >= 0)) { claim = NaN; break; }
        let rest = 0;
        // Tangent carriers (mesh normals or Newton's): the wedge convention.
        if (!(e.sine < SNAP_SINE || u.tangent || w.tangent)) {
          if (!u.X || !w.X) { claim = NaN; break; }
          if (!(u.curv.sine < SNAP_SINE || w.curv.sine < SNAP_SINE)) {
            rest = curveSagitta(2 * Math.max(u.curv.k, w.curv.k), Math.hypot(...vsub(u.X, w.X)));
            if (!(rest >= 0)) { claim = NaN; break; }
            if ((rest > tol || (d + rest > target && rest > 0)) && depth < EDGE_DEPTH) { todo.push({ e, s: (u.s + w.s) / 2 }); more = true; }
          }
        }
        claim = Math.max(claim, d + rest);
      }
      e.claim = claim;
      if (!more || Number.isNaN(claim)) e.done = true;
    }
    todo = todo.filter(x => !x.e.done);
  }
  return new Map(edges.map(e => [e.key, e.claim]));
}
const edgeKeyOf = (p, q) => (p < q ? `${p},${q}` : `${q},${p}`);
// The largest boundary-edge claim over a triangle's edges (0 when none).
const edgeClaimOf = (edges, t) => {
  let m = 0;
  for (let k = 0; k < 3; k++) {
    const d = edges.get(edgeKeyOf(t[k], t[(k + 1) % 3]));
    if (d === undefined) continue;
    if (!(d >= 0)) return NaN;
    m = Math.max(m, d);
  }
  return m;
};

// The distance of a point from the boundary of the wedge {fa <= 0, fb <= 0}
// of two planes with unit normals at cosine c (sine = sqrt(1 - c^2)), given
// its signed values fa, fb: 0 inside; the value of one plane when its
// projection onto that plane lands inside the other; else the distance to
// their edge line. Tangent planes (sine below SNAP_SINE) lie within the
// deviation of each other: 0.
export function wedgeDistance(fa, fb, c, sine) {
  if (sine < SNAP_SINE || (fa <= 0 && fb <= 0)) return 0;
  if (fa > 0 && fb - fa * c <= 0) return fa;
  if (fb > 0 && fa - fb * c <= 0) return fb;
  return Math.sqrt(Math.max(0, fa * fa + fb * fb - 2 * fa * fb * c)) / sine;
}

function snapOnce(kernel, mesh, faces, classOf, deviationMm, target, pinned, forced) {
  if (!kernel?.volume?.mesh_snap || !kernel.volume.mesh_bound) return { refused: 'mesh_snap / mesh_bound (kernel/volume.bend) are not loaded in this kernel backend' };
  const V = mesh.vertices.map(p => [...p]), T = mesh.triangles.map(t => [...t]);
  const VR = new Map(); // vertex -> Bend point, for points Bend made
  const bendPoint = v => VR.get(v) ?? vector(V[v]);
  const surfaces = faces.map((f, i) => bendSurface(f.surface, i));
  // Faces around every vertex, and the boundary vertices (two classes or more).
  const around = V.map(() => new Set());
  for (const t of T) for (let k = 0; k < 3; k++) around[t[k]].add(t[3]);
  const carriersAt = v => {
    const byClass = new Map();
    for (const f of [...around[v]].sort((x, y) => x - y)) if (!byClass.has(classOf[f])) byClass.set(classOf[f], f);
    return [...byClass.entries()].sort((x, y) => x[0] - y[0]).map(([, f]) => surfaces[f]);
  };
  const boundary = [];
  for (let v = 0; v < V.length; v++) if (new Set([...around[v]].map(f => classOf[f])).size >= 2) boundary.push(v);
  const snapped = snapItems(kernel, boundary.map(v => ({ $: 'Onto', p: vector(V[v]), cs: list(carriersAt(v)) })));
  const { drift, moveTo, safe } = boundaryDrift(kernel, V, T, around, classOf, surfaces, boundary, snapped);
  const move = new Map(), stats = { boundaryVertices: boundary.length, transversal: 0, maxDriftMm: 0, maxTangentDriftMm: 0, unconverged: 0 };
  const knownDrift = [...drift.values()];
  // The claim of corefine's mesh as it is: the deviation plus the largest
  // boundary drift of a vertex or a boundary edge; none when one is unknown.
  const edges0 = knownDrift.some(d => !(d >= 0)) ? new Map() : edgeDrift(kernel, V, T, classOf, surfaces, faces, v => drift.get(v) ?? 0, target);
  const knownEdges = [...edges0.values()];
  const unsnappedClaim = knownDrift.some(d => !(d >= 0)) || knownEdges.some(d => !(d >= 0)) ? null : Math.max(deviationMm, ...knownDrift, ...knownEdges);
  stats.unsnappedEdgeDriftMm = knownEdges.length ? Math.max(...knownEdges) : 0;
  stats.unsnappedDeviationMm = unsnappedClaim;
  stats.safeVertices = safe;
  // corefine's mesh already holds the target: nothing to move.
  if (unsnappedClaim !== null && unsnappedClaim <= target) return { vertices: mesh.vertices, triangles: mesh.triangles, deviationMm: unsnappedClaim, unsnappedClaim, snap: { ...stats, applied: false } };
  // stuck: vertices that drifted more than the move threshold but stay (not
  // converged, tangent carriers, beyond the cap, or taken back below). Their
  // neighbours stay too, so every triangle around them keeps corefine's
  // shape and the original claim.
  const stuck = new Set();
  boundary.forEach((v, i) => {
    const s = moveTo.get(v) ?? snapped[i];
    if (forced.has(v) && s.res <= SNAP_RESIDUAL && s.moved <= SNAP_MOVE_CAP * deviationMm) { move.set(v, s.q); VR.set(v, s.qr); return; }
    const drifted = !(s.moved <= SNAP_MIN_MOVE * deviationMm);
    if (!(s.res <= SNAP_RESIDUAL)) { stats.unconverged++; if (drifted) stuck.add(v); return; }
    if (s.sine < SNAP_SINE) { stats.maxTangentDriftMm = Math.max(stats.maxTangentDriftMm, s.moved); if (drifted) stuck.add(v); return; }
    stats.transversal++;
    stats.maxDriftMm = Math.max(stats.maxDriftMm, s.moved);
    // Only a vertex whose drift counts (not on the solid's side of its wedge)
    // needs to move; any drift of it would add to its triangles' claim.
    if (!(drift.get(v) > SNAP_MIN_MOVE * target)) return;
    // A pinned vertex (snapMesh) stays where it is; unlike a stuck one its
    // neighbours may still move.
    if (pinned.has(v)) return;
    if (s.moved <= SNAP_MOVE_CAP * deviationMm) { move.set(v, s.q); VR.set(v, s.qr); } else stuck.add(v);
  });
  stats.moved = move.size;
  // Take back moves that fold curved-face triangles; planar faces that fold
  // are re-triangulated below.
  const planar = faces.map(f => f.surface.type === 'plane');
  const at = (v, moved) => (moved.has(v) ? moved.get(v) : V[v]);
  const trianglesOf = V.map(() => []);
  T.forEach((t, i) => { for (let k = 0; k < 3; k++) trianglesOf[t[k]].push(i); });
  const folds = moved => {
    const bad = new Set(), planes = new Set();
    for (const v of moved.keys()) for (const i of trianglesOf[v]) {
      const t = T[i], before = normalOf(V, t), after = vcross(vsub(at(t[1], moved), at(t[0], moved)), vsub(at(t[2], moved), at(t[0], moved)));
      if (kept(before, after)) continue;
      if (planar[t[3]]) planes.add(t[3]); else bad.add(i);
    }
    return { bad, planes };
  };
  let reverted = 0;
  const neighbours = v => trianglesOf[v].flatMap(i => T[i].slice(0, 3));
  // Vertices that may join a move to undo a fold: converged on all carriers
  // (or on the pair curve chosen for an ill-conditioned corner), within the
  // cap, neither stuck nor pinned.
  const companion = new Map(), joined = new Set();
  boundary.forEach((v, i) => {
    const c = moveTo.get(v) ?? snapped[i];
    if (c.res <= SNAP_RESIDUAL && c.sine >= SNAP_SINE && c.moved <= SNAP_MOVE_CAP * deviationMm && !pinned.has(v) && !stuck.has(v)) companion.set(v, c);
  });
  // The side of every curved-face triangle a move could touch (Bend cosine of
  // corefine's triangle; a planar face is re-triangulated instead).
  const bendTri = t => ({ $: 'BTri', a: bendPoint(t[0]), b: bendPoint(t[1]), c: bendPoint(t[2]), s: surfaces[t[3]] });
  const bendAt = (t, moved) => ({ $: 'BTri', ...Object.fromEntries(['a', 'b', 'c'].map((k, i) => [k, moved.has(t[i]) ? VR.get(t[i]) : vector(V[t[i]])])), s: surfaces[t[3]] });
  const candidates = [...new Set([...move.keys()].flatMap(v => trianglesOf[v]))].filter(i => !planar[T[i][3]]);
  const side = new Map(boundItems(kernel, candidates.map(i => bendAt(T[i], new Map()))).map((b, k) => [candidates[k], Math.sign(b.cosine)]));
  for (let round = 0; ; round++) {
    let changed = false;
    // A forced vertex (snapMesh: a triangle stayed over the target with it in
    // place) moves even next to a stuck one; its triangles are re-certified.
    for (const v of stuck) for (const w of neighbours(v)) if (!forced.has(w) && move.delete(w)) { reverted++; changed = true; }
    const { bad } = folds(move);
    // A moved triangle of a curved face must stay clearly on its side.
    const live = [...new Set([...move.keys()].flatMap(v => trianglesOf[v]))].filter(i => !planar[T[i][3]] && !bad.has(i));
    boundItems(kernel, live.map(i => bendAt(T[i], move))).forEach((b, k) => { if (!upright(b.cosine, side.get(live[k]))) bad.add(live[k]); });
    for (const i of bad) {
      // A fold is first answered by moving the triangle's other corners onto
      // their curves as well (a fan of slivers from one far vertex to a row of
      // moved edge vertices folds unless its apex moves too); only a triangle
      // that still folds takes its moves back.
      const along = T[i].slice(0, 3).filter(v => !move.has(v) && companion.has(v) && !joined.has(v));
      if (along.length) { for (const v of along) { const c = companion.get(v); move.set(v, c.q); VR.set(v, c.qr); joined.add(v); } changed = true; continue; }
      for (let k = 0; k < 3; k++) if (move.delete(T[i][k])) { reverted++; changed = true; }
    }
    if (!changed) break;
    // Every round takes a move back or lets a vertex join (once each), so it
    // ends; the cap only guards that argument.
    if (round > 50 + 2 * boundary.length) return { refused: 'snapping did not settle: moves keep folding triangles of curved faces', unsnappedClaim };
  }
  stats.reverted = reverted;
  stats.stuck = stuck.size;
  for (const [v, q] of move) V[v] = q;
  for (const v of [...VR.keys()]) if (!move.has(v)) VR.delete(v);
  // The drift every boundary vertex keeps where it now is (a vertex moved to a
  // pair curve's foot still has the others').
  const finalDrift = move.size ? boundaryDrift(kernel, V, T, around, classOf, surfaces, boundary,
    snapItems(kernel, boundary.map(v => ({ $: 'Onto', p: bendPoint(v), cs: list(carriersAt(v)) })))).drift : drift;
  const touched = new Set();
  for (const v of move.keys()) for (const i of trianglesOf[v]) touched.add(i);
  // Planar faces with a folded triangle: all of their triangles are replaced
  // by a triangulation of the face's boundary loops.
  const refold = new Set();
  for (const v of move.keys()) for (const i of trianglesOf[v]) {
    const t = T[i];
    if (planar[t[3]] && !kept(normalOf(mesh.vertices, t), normalOf(V, t))) refold.add(t[3]);
  }
  let retriangulated = 0;
  let current = T.map((t, i) => ({ t, touched: touched.has(i), root: i }));
  for (const face of refold) {
    const own = current.filter(x => x.t[3] === face).map(x => x.t);
    const tris = retriangulate(V, own, faces[face].surface);
    if (!tris) return { refused: `snapping: planar face ${face} does not re-triangulate from its boundary loops`, unsnappedClaim };
    const roots = current.filter(x => x.t[3] === face).map(x => x.root);
    current = [...current.filter(x => x.t[3] !== face), ...tris.map(t => ({ t: [...t, face], touched: true, root: null, roots }))];
    retriangulated++;
  }
  stats.retriangulatedFaces = retriangulated;
  // Certify, then split what exceeds the target.
  const bounds = new Map(), cosines = new Map();
  const certify = items => {
    const b = boundItems(kernel, items.map(x => bendTri(x.t)));
    items.forEach((x, i) => { bounds.set(x, b[i].bound); cosines.set(x, b[i].cosine); });
  };
  certify(current.filter(x => x.touched));
  // The drift a triangle's corners keep where they now are (new vertices from
  // bisection lie on their carrier or curve: 0; NaN when unknown).
  const nOriginal = mesh.vertices.length;
  const driftOf = v => (v >= nOriginal ? 0 : finalDrift.get(v) ?? 0);
  const leftDrift = t => t.slice(0, 3).reduce((m, v) => { const d = driftOf(v); return d >= 0 ? Math.max(m, d) : NaN; }, 0);
  const carrierClaim = x => (x.touched ? bounds.get(x) : deviationMm);
  const claimOf = x => Math.max(carrierClaim(x), leftDrift(x.t));
  let bisected = 0;
  const failedEdges = new Set(), splitCap = Math.max(256, 4 * touched.size);
  const edgeKey = (p, q) => (p < q ? `${p},${q}` : `${q},${p}`);
  for (let round = 0; round < SNAP_ROUNDS && bisected < splitCap; round++) {
    const over = current.filter(x => x.touched && !(bounds.get(x) >= 0 && claimOf(x) <= target));
    if (!over.length) break;
    // The heaviest edge of every triangle over the target, once each.
    const edges = new Map();
    for (const x of over) {
      const t = x.t;
      let best = -1, bl = -1;
      for (let k = 0; k < 3; k++) {
        const p = t[k], q = t[(k + 1) % 3];
        if (failedEdges.has(edgeKey(p, q))) continue;
        const l = edgeWeight(faces[t[3]].surface, vsub(V[q], V[p]));
        if (l > bl) { bl = l; best = k; }
      }
      if (best < 0) continue;
      const a = t[best], b = t[(best + 1) % 3];
      edges.set(edgeKey(a, b), [Math.min(a, b), Math.max(a, b)]);
    }
    const byEdge = new Map();
    for (const x of current) for (let k = 0; k < 3; k++) {
      const key = edgeKey(x.t[k], x.t[(k + 1) % 3]);
      if (edges.has(key)) byEdge.set(key, [...(byEdge.get(key) ?? []), x]);
    }
    // Splits that share no triangle, this round.
    const claimed = new Set(), plan = [];
    for (const [key, [a, b]] of edges) {
      const pair = byEdge.get(key);
      if (pair?.length !== 2 || pair.some(x => claimed.has(x))) continue;
      // An untouched neighbour keeps corefine's shape and the original claim;
      // splitting it would make it answer to a bound its unmoved corners (up to
      // the deviation off the carrier) may not meet. Its edge is not split.
      if (pair.some(x => !x.touched)) { failedEdges.add(key); continue; }
      pair.forEach(x => claimed.add(x));
      plan.push({ key, a, b, pair });
    }
    if (!plan.length) break;
    const unknown = plan.flatMap(p => p.pair).filter(x => !cosines.has(x));
    boundItems(kernel, unknown.map(x => bendTri(x.t))).forEach((b, k) => cosines.set(unknown[k], b.cosine));
    const mids = snapItems(kernel, plan.map(({ a, b, pair }) => {
      const cs = [...new Map(pair.map(x => [classOf[x.t[3]], surfaces[x.t[3]]])).entries()].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)).map(([, s]) => s);
      return { $: 'Mid', a: bendPoint(a), b: bendPoint(b), cs: list(cs) };
    }));
    const tent = [];
    plan.forEach((p, k) => {
      const m = mids[k];
      if (!(m.res <= SNAP_RESIDUAL)) { failedEdges.add(p.key); return; }
      const index = V.length;
      V.push(m.q); VR.set(index, m.qr);
      const children = p.pair.flatMap(x => {
        const t = x.t, e = [0, 1, 2].find(j => (t[j] === p.a && t[(j + 1) % 3] === p.b) || (t[j] === p.b && t[(j + 1) % 3] === p.a));
        const u = t[e], w = t[(e + 1) % 3], r = t[(e + 2) % 3];
        return [{ parent: x, c: [u, index, r, t[3]] }, { parent: x, c: [index, w, r, t[3]] }];
      });
      tent.push({ ...p, index, children });
    });
    // One Bend call for every child: its bound and its side.
    const measured = boundItems(kernel, tent.flatMap(x => x.children.map(({ c }) => bendTri(c))));
    let n = 0, split = 0;
    const replaced = new Set(), added = [];
    for (const x of tent) {
      const got = measured.slice(n, n + x.children.length);
      n += x.children.length;
      const ok = x.children.every(({ parent, c }, k) => kept(normalOf(V, parent.t), normalOf(V, c)) && upright(got[k].cosine, Math.sign(cosines.get(parent) ?? 0)));
      if (!ok) { failedEdges.add(x.key); VR.delete(x.index); continue; }
      x.children.forEach(({ parent, c }, k) => {
        replaced.add(parent);
        const child = { t: c, touched: true, root: parent.root, roots: parent.roots };
        bounds.set(child, got[k].bound); cosines.set(child, got[k].cosine);
        added.push(child);
      });
      split++;
    }
    bisected += split;
    current = [...current.filter(x => !replaced.has(x)), ...added];
    if (!split && !plan.some(p => !failedEdges.has(p.key))) break;
  }
  stats.bisectedEdges = bisected;
  // The boundary edges where they now are (edgeDrift): a triangle's claim is
  // also at least the claim of each of its boundary edges.
  const finalEdges = edgeDrift(kernel, V, current.map(x => x.t), classOf, surfaces, faces, driftOf, target);
  const knownFinal = [...finalEdges.values()].filter(d => d >= 0);
  stats.edgeDriftMm = knownFinal.length ? Math.max(...knownFinal) : 0;
  stats.boundaryEdges = finalEdges.size;
  const finalClaimOf = x => Math.max(claimOf(x), edgeClaimOf(finalEdges, x.t));
  let claim = 0, failed = 0, worst = null, leaning = 0, unknown = 0, driftLeft = 0;
  for (const x of current) {
    const d = Math.max(leftDrift(x.t), edgeClaimOf(finalEdges, x.t));
    if (!(d >= 0)) { unknown++; continue; }
    driftLeft = Math.max(driftLeft, d);
    if (x.touched && !(bounds.get(x) >= 0)) { failed++; continue; }
    const c = finalClaimOf(x);
    if (c > claim) { worst = x; claim = c; }
    if (x.touched && !(Math.abs(cosines.get(x)) > 0.5)) leaning++;
  }
  stats.boundaryDriftMm = driftLeft;
  if (unknown) stats.unknownDriftTriangles = unknown;
  stats.steepTriangles = leaning;
  // The moved vertices behind every triangle above the target (its original
  // triangle's corners), for snapMesh to pin.
  const force = new Set(), pin = new Set(), isBoundary = new Set(boundary);
  for (const x of current) if (finalClaimOf(x) > target) {
    const held = x.t.slice(0, 3).filter(v => v < mesh.vertices.length && isBoundary.has(v) && !move.has(v) && !pinned.has(v) && !forced.has(v));
    // Over by the drift of a corner left in place, or of a boundary edge: that
    // corner (every corner of such an edge) must move; the moves around it
    // are not to blame (nothing is pinned for it).
    if (carrierClaim(x) <= target) {
      const onEdge = new Set();
      for (let k = 0; k < 3; k++) {
        const p = x.t[k], q = x.t[(k + 1) % 3];
        if (!(finalEdges.get(edgeKeyOf(p, q)) <= target) && finalEdges.has(edgeKeyOf(p, q))) { onEdge.add(p); onEdge.add(q); }
      }
      for (const v of held) if (driftOf(v) > target || onEdge.has(v)) force.add(v);
      continue;
    }
    if (held.length) { for (const v of held) force.add(v); continue; }
    for (const i of x.root !== null ? [x.root] : x.roots ?? []) for (let k = 0; k < 3; k++) if (move.has(T[i][k])) pin.add(T[i][k]);
  }
  if (worst && claim > target) stats.worst = { face: worst.t[3], carrier: faces[worst.t[3]].surface.type, boundMm: carrierClaim(worst), driftMm: leftDrift(worst.t), edgeDriftMm: edgeClaimOf(finalEdges, worst.t), corners: worst.t.slice(0, 3).map(v => V[v]) };
  if (failed) return { refused: `snapping: ${failed} triangles have no Bend bound of their distance to the carrier`, unsnappedClaim };
  if (unknown) claim = null;
  const triangles = current.map(x => x.t);
  const manifold = meshEdges(triangles);
  if (!manifold.edges) return { refused: `snapping broke the mesh: ${manifold.reason}`, unsnappedClaim };
  return { vertices: V, triangles, deviationMm: claim, unsnappedClaim, force, pin, snap: { ...stats, applied: move.size > 0 || bisected > 0 || retriangulated > 0, triangles: triangles.length, statedDeviationMm: claim } };
}

// The triangles of one planar face, re-made from its boundary loops (earcut's
// bridge and ear clipping, src/print-mesh.mjs withHoles), oriented like the
// face's own triangles. Null when the loops do not triangulate.
function retriangulate(V, own, surface) {
  const across = new Set(own.flatMap(t => [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]].map(([p, q]) => `${p},${q}`)));
  const next = new Map();
  for (const t of own) for (const [p, q] of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]]) if (!across.has(`${q},${p}`)) {
    if (next.has(p)) return null; // a pinch vertex: not handled here
    next.set(p, q);
  }
  const loops = [], seen = new Set();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    for (let v = start; !seen.has(v); v = next.get(v)) { seen.add(v); loop.push(v); if (!next.has(v)) return null; }
    loops.push(loop);
  }
  const side = own.reduce((sum, t) => sum + vdot(normalOf(V, t), surface.normal), 0) >= 0 ? 1 : -1;
  const n = surface.normal.map(x => x * side), x = surface.x;
  const y = vcross(n, x);
  const area = loop => loop.reduce((sum, v, k) => { const p = V[v], q = V[loop[(k + 1) % loop.length]]; return sum + vdot(p, x) * vdot(q, y) - vdot(q, x) * vdot(p, y); }, 0);
  const outer = loops.filter(l => area(l) > 0);
  if (outer.length !== 1) return null;
  const index = new Map(loops.flat().map(v => [V[v], v]));
  const parts = withHoles(outer[0].map(v => V[v]), loops.filter(l => l !== outer[0]).map(l => l.map(v => V[v])), n, x);
  if (!parts) return null;
  const tris = parts.map(tri => tri.map(p => index.get(p)));
  if (tris.some(t => t.some(v => v === undefined))) return null;
  // withHoles emits counter-clockwise about n, in the same (x, n x x) frame the
  // ear test decided in; that order is kept. Re-deciding each triangle by the
  // sign of its 3D normal flips near-degenerate ears (collinear boundary
  // vertices along a straight plane-cylinder line, ~800 mm from the origin:
  // adv:kt1-rotfar, face 5) against their loop edge, and the snapped mesh then
  // uses that edge twice in one direction.
  return tris;
}
