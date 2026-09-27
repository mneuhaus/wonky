// build123d fillet / chamfer of solid edges on the production fillet
// (src/fillet-op.mjs, kernel/fillet; docs/fillet-plan.md §8 step 4): the host
// side of the Python bridge request 'blend' (src/python.mjs shapeSession).
//
// build123d 0.13 runs OCCT's BRepFilletAPI_MakeFillet / _MakeChamfer, which
// add the tangent-continuous chain of every selected edge, so the job runs
// with tangent propagation on. chamfer(length) is the symmetric distance
// chamfer: a setback `length` along each support face, which is kernel/fillet's
// equal-offsets chamfer (Onshape FP-a); length2 and angle are refused by the
// Python module before the request.
//
// A selected build123d edge is one of edges()'s records (src/python.mjs
// unifiedEdgeRecords): a Bend edge, or a chain of Bend edges merged into one
// build123d edge, whose members are all selected. Solids of the shape without
// a selected edge stay unchanged. Outcomes: the new bodies (each carrying
// body.fillet with the stripe order and the notes), or
//   - failed(message): a refusal OCCT and Onshape raise for the same input too
//     (ONSHAPE_FAILURES), which python/_b3d_blend.py raises as build123d's
//     ValueError, so the model may catch it;
//   - capability(message): every other refusal, latched by the host.
import { blendBody, refusalMessage } from './fillet-op.mjs';

export function pythonBlend({ kernel, native, bodies, request, id, records, failed, capability }) {
  const what = request.kind === 'chamfer' ? 'chamfer' : request.kind === 'fillet' ? 'fillet' : null;
  if (!what) capability(`Unknown blend kind '${request.kind}'`);
  if (!native) capability(`${what} needs the production fillet (kernel/fillet), which runs on the Bend JS target; this build did not load it`);
  const size = request.size;
  if (typeof size !== 'number' || !Number.isFinite(size)) failed(`${what} size must be a finite number`);
  if (!(size > 0)) failed(`${what} ${what === 'fillet' ? 'radius' : 'length'} must be positive`);
  if (!Array.isArray(request.edges) || !request.edges.length) failed(`${what} needs at least one edge`);
  const selected = bodies.map(() => new Set());
  for (const pick of request.edges) {
    if (!Array.isArray(pick) || pick.length !== 2 || !Number.isInteger(pick[0]) || !Number.isInteger(pick[1]) || !bodies[pick[0]]) failed(`${what}: an edge is not an edge of this shape`);
    selected[pick[0]].add(pick[1]);
  }
  return bodies.map((body, solid) => {
    if (!selected[solid].size) return body;
    const byIndex = new Map(records(body, solid).map(record => [record.index, record]));
    const select = [...selected[solid]].flatMap(index => {
      const record = byIndex.get(index);
      if (!record) failed(`${what}: edge ${index} is not an edge of solid ${solid}`);
      return record.members ?? [index];
    });
    const out = blendBody(native, kernel, { id: `${id}/${solid}`, op: what, size, chamferType: 'equal-offsets', tangentPropagation: true, body, select });
    if (out.status !== 'ok') (out.onshape ? failed : capability)(refusalMessage(what, out));
    return out.body;
  });
}
