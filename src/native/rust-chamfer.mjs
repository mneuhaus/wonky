// Equal-offset planar chamfers. Native WC0 owns geometry and feasibility;
// this adapter transports the original SI binary64 and commits atomically.
import { EnumValue } from '../values.mjs';
import { raise } from '../errors.mjs';
import { resolveTopology } from '../queries.mjs';

export function rustChamferBuiltins(engine, h, api) {
  const { Request, OP, call, metres, RustBody, words, measure, RustCapabilityError } = api;
  const refuse = (reason, loc) => { throw new RustCapabilityError('opChamfer', `chamfer/${reason}`, loc); };
  return {
    opChamfer: ([context, id, definition], loc) => {
      const d = h.fieldMap(definition, ['entities', 'chamferType', 'width'], ['tangentPropagation', 'oppositeDirection'], loc);
      if (context !== engine.context) raise('Invalid modeling context', loc);
      if (!(d.chamferType instanceof EnumValue) || d.chamferType.enumType !== 'ChamferType') raise('opChamfer requires ChamferType', loc);
      if (d.chamferType.name !== 'EQUAL_OFFSETS') refuse('requires-equal-offsets', loc);
      for (const key of ['tangentPropagation', 'oppositeDirection']) {
        if (d[key] !== undefined && typeof d[key] !== 'boolean') raise(`opChamfer ${key} must be boolean`, loc);
      }
      if (d.tangentPropagation === true) refuse('tangent-propagation-unimplemented', loc);
      const width = metres(d.width, 'opChamfer width', loc);
      if (!(width > 0)) raise('opChamfer width must be positive', loc);
      const selected = resolveTopology(engine, d.entities, loc);
      if (!selected.length) refuse('empty-selection', loc);
      const groups = new Map();
      for (const row of selected) {
        if (row.kind !== 'edge' || !(row.record.body instanceof RustBody)) refuse('requires-line-edges', loc);
        if (!groups.has(row.record)) groups.set(row.record, new Set());
        groups.get(row.record).add(row.index);
      }
      engine.claim(context, id, loc);
      const built = [...groups].map(([record, indices]) => {
        const edges = [...indices].sort((a, b) => a - b);
        const request = new Request(OP.CHAMFER).block(words(record.body)).f64(width).u32(edges.length);
        for (const edge of edges) request.u32(edge);
        const replacement = new RustBody(record.body.id, call(engine.kernel, request.done(), 'opChamfer', loc), null);
        const m = measure(engine.kernel, replacement);
        replacement.validation = { closed: m.validity.closed, brep: m.validity.brep, volumeMm3: m.volumeMm3,
          areaMm2: m.areaMm2, toleranceMm: m.toleranceMm, boundsMm: m.bboxMm,
          certificate: m.certificate, boundToConstruction: m.boundToConstruction,
          vertices: m.topology.vertices, edges: m.topology.edges, faces: m.topology.faces };
        for (const key of ['name', 'description', 'appearance']) if (Object.hasOwn(record.body, key)) replacement[key] = record.body[key];
        return { record, replacement };
      });
      for (const { record, replacement } of built) {
        record.body = replacement;
        record.topologyCreatedBy = false;
        record.createdBy = new Set([...record.createdBy, id.key()]);
      }
    },
  };
}
