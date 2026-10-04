// Display scene of a Rust (WC0) model record, from the Rust mesh path.
//
// Faces are the triangles of `rustMesh` (host op OP_MESH, schema wonky-mesh/1)
// attributed to their WC0 face; edges are the sampled edge polylines of the same
// mesh; vertices are the exact projection vertices of the record. The mesh has a
// stated chordal deviation (`toleranceMm`), reported per face as
// `displayTessellation`. Exact carriers and measurements are not read from this
// scene. A body the mesh path refuses keeps its faces without triangles and a
// named `displayWarning` (no fallback tessellation). `display.notes` holds warnings only
// (the viewer shows them as "Some faces are shown as boundaries only"); the stated
// deviation is `display.toleranceMm` and `display.purpose`.
import { rustMesh, projectionFaceOrder } from './native/rust-host.mjs';

export const isRustRecord = body => typeof body?.wc0Words === 'string' && String(body.geometry).startsWith('rust-wc0');

// The WC0 words of a record body (base64 of the little-endian Uint32 array).
export function recordWords(body) {
  const bytes = Buffer.from(body.wc0Words, 'base64');
  if (bytes.byteLength % 4) throw new Error(`Record body '${body.id}' has a malformed wc0Words length`);
  const words = new Uint32Array(bytes.byteLength / 4);
  for (let i = 0; i < words.length; i++) words[i] = bytes.readUInt32LE(4 * i);
  return words;
}

const curveType = edge => typeof edge.curve === 'string' ? edge.curve : edge.curve?.type ?? 'unknown';
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];

// Face order of a record: projection face k is WC0 face `order[k]`.
export const recordFaceOrder = body => projectionFaceOrder(body.faces.map(face => face.loops.flatMap(loop => loop.map(use => use.edge))), body.wc0.body);

// A record whose projection no longer matches its WC0 words is stale: every edge end
// vertex of the record must match an original endpoint of that edge evaluated
// from the words. Tessellation witnesses may move within the stated deviation;
// they must not loosen the separate stale-record check.
const STALE_MM = 1e-9;
function staleCheck(body, mesh, point) {
  body.edges.forEach((edge, k) => {
    const sample = mesh.edges[k]?.vertices;
    if (!sample?.length) return;
    const source = mesh.edgeSourceEnds?.[k];
    const ends = source?.length === 6 ? [source.slice(0, 3), source.slice(3, 6)]
      : [point(sample[0]), point(sample[sample.length - 1])];
    for (const vertex of [edge.start, edge.end]) {
      const p = body.vertices[vertex];
      if (!ends.some(q => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) <= STALE_MM)) {
        throw new Error(`Stale geometry revision: vertex ${vertex} of '${body.id}' does not match the WC0 words of the body`);
      }
    }
  });
}

export function rustSceneBody(kernel, body, toleranceMm, notes) {
  const source = body.identity?.operation?.source ?? body.debug?.source;
  const order = recordFaceOrder(body);
  const faces = body.faces.map((face, index) => ({
    index, surfaceType: face.surface.type, edgeIndices: [...new Set(face.loops.flatMap(loop => loop.map(use => use.edge)))],
    triangles: [], identity: body.identity?.topology?.faces?.[index], source,
    displayTessellation: { source: 'rust-mesh', approximate: face.surface.type !== 'plane', maxChordalErrorBoundMm: toleranceMm },
  }));
  let edges = body.edges.map((edge, index) => ({ index, curveType: curveType(edge), points: [body.vertices[edge.start], body.vertices[edge.end]],
    identity: body.identity?.topology?.edges?.[index], source }));
  let mesh;
  try {
    mesh = rustMesh(kernel, [recordWords(body)], toleranceMm).bodies[0];
  } catch (error) {
    for (const face of faces) { face.displayWarning = error.message; delete face.displayTessellation; }
    notes.add(`${body.id}: ${error.message}`);
  }
  if (mesh) {
    const { vertices: flat, triangles: index, faces: owner } = mesh;
    const point = i => [flat[3 * i], flat[3 * i + 1], flat[3 * i + 2]];
    const byWc0 = new Map(order.map((wc0, k) => [wc0, k]));
    if (owner.length !== index.length / 3) {
      const why = 'rust mesh does not attribute its triangles to faces';
      for (const face of faces) { face.displayWarning = why; delete face.displayTessellation; }
      notes.add(`${body.id}: ${why}`);
    } else {
      for (let t = 0; t < owner.length; t++) {
        const k = byWc0.get(owner[t]);
        if (k === undefined) continue;
        const points = [0, 1, 2].map(j => point(index[3 * t + j]));
        const n = cross(sub(points[1], points[0]), sub(points[2], points[0])), length = Math.hypot(...n);
        if (length > 0) faces[k].triangles.push({ points, normal: n.map(v => v / length) });
      }
    }
    // The mesh samples the WC0 edges; the record projection keeps their ids and appends
    // the chart seams WC0 does not carry (projectionFaceOrder), which keep their end points.
    if (mesh.edges.length <= body.edges.length) {
      staleCheck(body, mesh, point);
      edges = body.edges.map((edge, k) => {
        const sample = mesh.edges[k];
        if (!sample) return edges[k];
        const points = sample.vertices.map(point);
        if (sample.closed && points.length) points.push(points[0]);
        return { ...edges[k], points: points.length ? points : edges[k].points };
      });
    }
  }
  return {
    id: body.id, name: body.name ?? body.id, volumeMm3: body.validation?.volumeMm3 ?? null, identity: body.identity, source, debug: body.debug,
    vertices: body.vertices.map((point, index) => ({ index, point, identity: body.identity?.topology?.vertices?.[index], source })),
    edges, faces,
  };
}

export function rustReviewScene(kernel, model, metadata, toleranceMm) {
  const notes = new Set();
  const bodies = model.bodies.map(body => {
    if (!isRustRecord(body)) throw new Error(`Body '${body.id}' is not a Rust WC0 record (geometry '${body.geometry}'); the Rust viewer shows Rust bodies only`);
    return rustSceneBody(kernel, body, toleranceMm, notes);
  });
  const all = bodies.flatMap(b => [...b.vertices.map(v => v.point), ...b.edges.flatMap(e => e.points), ...b.faces.flatMap(f => f.triangles.flatMap(t => t.points))]);
  const bounds = { min: [0, 1, 2].map(i => all.reduce((v, p) => Math.min(v, p[i]), Infinity)), max: [0, 1, 2].map(i => all.reduce((v, p) => Math.max(v, p[i]), -Infinity)) };
  if (!all.length || !Object.values(bounds).flat().every(Number.isFinite)) throw new Error('Model has no finite display geometry');
  return {
    ...metadata, bounds, bodies, sourceMap: model.sourceMap, diagnostic: model.diagnostic ?? null,
    display: { toleranceMm, notes: [...notes], purpose: `Approximate display only; the Rust WC0 body and its exact measurements are authoritative. Triangles come from the Rust mesh path (wonky-mesh/1), chordal deviation at most ${toleranceMm} mm; measurements come from the Rust kernel, never from this mesh.` },
  };
}
