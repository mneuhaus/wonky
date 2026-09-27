// Coplanar fragments: a planar Boolean may leave one plane face split into
// several faces joined by edges whose two faces lie on the same plane with the
// same outward side. Onshape has no such edges: its face is the whole region.
// Bend decides which edges these are (kernel/fillet/production.bend
// fragments, the test the fillet uses to ignore a selected fragment edge:
// ladder.bend is_fragment); this file only encodes the body and groups the
// faces, so a face selection or a face query means the region, as in Onshape.
// Nothing here computes geometry.
import { array } from './kernel.mjs';
import { blendJob } from './fillet-op.mjs';

const cache = new WeakMap();

// Set of the body's coplanar-fragment edge indices, or null when the body has
// no job form (then no face is read as a region). `native` is the production
// fillet module (loadFilletProduction()).
export function fragmentEdges(native, body) {
  if (cache.has(body)) return cache.get(body);
  const job = blendJob({ id: 'fragments', op: 'fillet', size: 1, tangentPropagation: false, body, select: [] });
  const found = job.text ? new Set(array(native.fragments(job.text))) : null;
  cache.set(body, found);
  return found;
}

const faceEdges = (body, face) => body.faces[face].loops.flatMap(loop => (loop.uses ?? loop).map(use => use.edge));

// The faces of the region `face` belongs to (joined through fragment edges),
// ascending; [face] when there are none.
export function fragmentRegion(body, fragments, face) {
  if (!fragments?.size) return [face];
  const byEdge = new Map();
  body.faces.forEach((_, f) => faceEdges(body, f).forEach(e => { if (fragments.has(e)) byEdge.set(e, [...(byEdge.get(e) ?? []), f]); }));
  const seen = new Set([face]), stack = [face];
  while (stack.length) {
    for (const e of faceEdges(body, stack.pop())) for (const g of byEdge.get(e) ?? []) if (!seen.has(g)) { seen.add(g); stack.push(g); }
  }
  return [...seen].sort((a, b) => a - b);
}

// The edges bounding the region of `face`: every edge of its faces except the
// fragment edges between them, ascending.
export function regionEdges(body, fragments, face) {
  const edges = new Set(fragmentRegion(body, fragments, face).flatMap(f => faceEdges(body, f)));
  return [...edges].filter(e => !fragments?.has(e)).sort((a, b) => a - b);
}
