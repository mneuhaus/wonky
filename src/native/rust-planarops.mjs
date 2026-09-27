// Shell lifecycle. Source offsets and topology decisions run in Rust; the
// adapter transports inputs and replaces the body only after native validation.
import { raise } from '../errors.mjs';
import { resolveTopology } from '../queries.mjs';

export function rustPlanarBuiltins(engine, h, api) {
  const { Request, OP, call, metres, RustBody, words, measure, RustCapabilityError } = api;
  return {
    opShell: ([context, id, definition], loc) => {
      const d = h.fieldMap(definition, ['entities', 'thickness'], [], loc);
      if (context !== engine.context) raise('Invalid modeling context', loc);
      const thickness = metres(d.thickness, 'opShell thickness', loc);
      if (!(thickness < 0)) throw new RustCapabilityError('opShell', 'shell/inward-only', loc);
      const rows = resolveTopology(engine, d.entities, loc);
      if (rows.length !== 1 || rows[0].kind !== 'face' || !(rows[0].record.body instanceof RustBody)) {
        throw new RustCapabilityError('opShell', 'shell/exactly-one-removed-face', loc);
      }
      const { record, index } = rows[0];
      const request = new Request(OP.SHELL).block(words(record.body)).u32(index).f64(-thickness);
      engine.claim(context, id, loc);
      const replacement = new RustBody(record.body.id, call(engine.kernel, request.done(), 'opShell', loc), null);
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
