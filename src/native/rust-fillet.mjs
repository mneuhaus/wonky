// Rust analytic edge selection and constant-radius rolling-ball blends. No JS geometry and
// no geometric failure inferred from a kernel capability refusal, even in try.
import { EnumValue } from '../values.mjs';
import { raise } from '../errors.mjs';
import { resolveTopology, TopologyQuery } from '../queries.mjs';

export function rustFilletBuiltins(engine, h, api) {
  const { Request, OP, call, metres, point3, RustBody, words, measure, RustCapabilityError } = api;
  const defaults = {
    allowEdgeOverflow: true, tangentPropagation: false, isVariable: false,
    smoothCorners: false, createDetachedSurface: false, isPartial: false, isAsymmetric: false,
  };
  return {
    qClosestTo: ([query, point], loc) => {
      if (!(query instanceof TopologyQuery)) raise('qClosestTo expects a topology Query', loc);
      point3(point, 'qClosestTo point', loc);
      return new TopologyQuery('closestTo', { query, point });
    },
    opFillet: ([context, id, definition], loc) => {
      const d = h.fieldMap(definition, ['entities', 'radius'], [...Object.keys(defaults), 'crossSection'], loc);
      if (context !== engine.context) raise('Invalid modeling context', loc);
      for (const [key, value] of Object.entries(defaults)) {
        if (d[key] !== undefined && typeof d[key] !== 'boolean') raise(`opFillet ${key} must be boolean`, loc);
        if (d[key] !== undefined && d[key] !== value) throw new RustCapabilityError('opFillet', `fillet/option-${key}`, loc);
      }
      if (d.crossSection !== undefined && !(d.crossSection instanceof EnumValue &&
          d.crossSection.enumType === 'FilletCrossSection' && d.crossSection.name === 'CIRCULAR')) {
        throw new RustCapabilityError('opFillet', 'fillet/non-circular-cross-section', loc);
      }
      const radius = metres(d.radius, 'opFillet radius', loc);
      if (!(radius > 0)) raise('opFillet radius must be positive', loc);
      const selected = resolveTopology(engine, d.entities, loc);
      if (!selected.length) throw new RustCapabilityError('opFillet', 'fillet/empty-selection', loc);
      if (selected.some(row => row.kind !== 'edge' || !(row.record.body instanceof RustBody))) {
        throw new RustCapabilityError('opFillet', 'fillet/requires-line-edges', loc);
      }
      const record = selected[0].record;
      if (selected.some(row => row.record !== record)) throw new RustCapabilityError('opFillet', 'fillet/multiple-bodies', loc);
      engine.claim(context, id, loc);
      const edges = [...new Set(selected.map(row => row.index))];
      const request = new Request(OP.FILLET).block(words(record.body)).f64(radius).u32(edges.length);
      for (const edge of edges) request.u32(edge);
      const replacement = new RustBody(record.body.id, call(engine.kernel, request.done(), 'opFillet', loc), null);
      const m = measure(engine.kernel, replacement);
      replacement.validation = { closed: m.validity.closed, brep: m.validity.brep, volumeMm3: m.volumeMm3,
        areaMm2: m.areaMm2, toleranceMm: m.toleranceMm, boundsMm: m.bboxMm,
        certificate: m.certificate, boundToConstruction: m.boundToConstruction };
      for (const key of ['name', 'description', 'appearance']) if (Object.hasOwn(record.body, key)) replacement[key] = record.body[key];
      record.body = replacement;
      record.topologyCreatedBy = false;
      record.createdBy = new Set([...record.createdBy, id.key()]);
    },
  };
}
