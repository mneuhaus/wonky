// Body lifecycle for Rust rectilinear operations. Coordinates/decisions remain
// in Rust; this module only resolves queries, transports words and updates the
// records atomically after all outputs pass the native audit.
import { EnumValue, Quantity, Transform, Vector, map } from '../values.mjs';
import { raise } from '../errors.mjs';
import { resolveTopology } from '../queries.mjs';
import { exactPlacement } from './rust-placement.mjs';

export function rustBoxBuiltins(engine, h, api) {
  const { Request, OP, call, bodyKey, point3, metres, RustBody, words, measure, GeometryRefusal, RustCapabilityError, distance } = api;
  const kernel = engine.kernel;
  const rows = (context, query, loc) => {
    if (context !== engine.context) raise('Invalid modeling context', loc);
    const r = resolveTopology(engine, query, loc);
    if (r.some(x => x.kind !== 'body' || x.record.kind !== 'solid' || !(x.record.body instanceof RustBody))) {
      throw new RustCapabilityError('query', 'only Rust solid body queries are implemented', loc);
    }
    return r;
  };
  const requestKey = (r, id) => { for (const w of bodyKey(id)) r.u32(w); return r; };
  const body = (id, w) => {
    const b = new RustBody(id, w, null), m = measure(kernel, b);
    b.validation = { closed: m.validity.closed, brep: m.validity.brep, volumeMm3: m.volumeMm3, areaMm2: m.areaMm2,
      toleranceMm: m.toleranceMm, boundsMm: m.bboxMm, certificate: m.certificate, boundToConstruction: m.boundToConstruction };
    return b;
  };
  return {
    fCylinder: ([context, id, definition], loc) => {
      const d = h.fieldMap(definition, ['bottomCenter', 'topCenter', 'radius'], [], loc);
      const r = requestKey(new Request(OP.CYLINDER), id.toString());
      for (const p of [d.bottomCenter, d.topCenter]) for (const v of point3(p, 'center', loc)) r.f64(v);
      r.f64(metres(d.radius, 'radius', loc));
      engine.claim(context, id, loc);
      engine.addSolid(id, body(id.toString(), call(kernel, r.done(), 'fCylinder', loc)));
    },
    fCuboid: ([context, id, definition], loc) => {
      const d = h.fieldMap(definition, ['corner1', 'corner2'], [], loc);
      const r = requestKey(new Request(OP.CUBOID), id.toString());
      for (const p of [d.corner1, d.corner2]) for (const v of point3(p, 'corner', loc)) r.f64(v);
      engine.claim(context, id, loc);
      engine.addSolid(id, body(id.toString(), call(kernel, r.done(), 'fCuboid', loc)));
    },
    opTransform: ([context, id, definition], loc) => {
      const d = h.fieldMap(definition, ['bodies', 'transform'], [], loc);
      const source = rows(context, d.bodies, loc);
      if (!(d.transform instanceof Transform)) raise('opTransform expects a Transform', loc);
      const frame = exactPlacement(d.transform);
      if (!frame) throw new RustCapabilityError('opTransform', 'placement lacks exact toWorld construction', loc);
      engine.claim(context, id, loc);
      const copies = source.map(({ record }) => {
        const r = new Request(OP.PLACEMENT).block(words(record.body));
        for (const v of [...frame.origin, ...frame.x, ...frame.z]) r.f64(v);
        const b = body(record.body.id, call(kernel, r.done(), 'opTransform', loc));
        for (const key of ['name', 'description', 'appearance']) if (Object.hasOwn(record.body, key)) b[key] = record.body[key];
        return b;
      });
      source.forEach(({ record }, i) => { record.topologyCreatedBy ??= record.createdBy.size === 1 ? [...record.createdBy][0] : null; record.body = copies[i]; record.createdBy = new Set([...record.createdBy, id.key()]); });
    },
    opBoolean: ([context, id, definition], loc) => {
      const d = h.fieldMap(definition, ['tools', 'operationType'], ['targets', 'keepTools'], loc);
      const operation = d.operationType instanceof EnumValue ? d.operationType.name : String(d.operationType).split('.').at(-1);
      const op = ['UNION', 'SUBTRACTION', 'INTERSECTION'].indexOf(operation);
      if (op < 0) throw new RustCapabilityError('opBoolean', `operation ${operation}`, loc);
      if (d.keepTools !== undefined && typeof d.keepTools !== 'boolean') raise('keepTools must be boolean', loc);
      const tools = rows(context, d.tools, loc);
      const targets = d.targets === undefined ? [] : rows(context, d.targets, loc);
      if (op === 1 && targets.length !== 1) throw new RustCapabilityError('opBoolean', 'subtraction requires one target body', loc);
      if (op !== 1 && targets.length) throw new RustCapabilityError('opBoolean', 'targets only supported for subtraction', loc);
      const source = [...targets, ...tools];
      if (new Set(source.map(r => r.record.key)).size !== source.length) raise('Boolean target and tools must be distinct', loc);
      const r = requestKey(new Request(OP.BOOLEAN), id.toString()).u32(op).u32(source.length);
      for (const { record } of source) r.block(words(record.body));
      engine.claim(context, id, loc);
      let reply;
      try { reply = call(kernel, r.done(), 'opBoolean', loc); }
      catch (e) {
        for (const category of ['empty-result', 'non-manifold-result']) {
          if (e instanceof RustCapabilityError && [`orthogonal/${category}`, `planar-boolean/${category}`].includes(e.reason)) throw new GeometryRefusal('opBoolean', category, category, loc);
        }
        throw e;
      }
      const copies = []; let at = 1;
      for (let i = 0; i < reply[0]; i++) { const n = reply[at++]; copies.push(body(`${id}/${i}`, reply.slice(at, at + n))); at += n; }
      const inherited = new Set(source.flatMap(r => [...r.record.createdBy])); inherited.add(id.key());
      for (const row of (op === 1 && d.keepTools ? targets : source)) engine.records.delete(row.record.key);
      for (const b of copies) { engine.addSolid(id, b); const record = [...engine.records.values()].at(-1); record.createdBy = new Set(inherited); record.topologyCreatedBy = false; }
    },
    evVolume: ([context, definition], loc) => {
      const d = h.fieldMap(definition, ['entities'], [], loc);
      return new Quantity(rows(context, d.entities, loc).reduce((s, r) => s + measure(kernel, r.record.body).volumeMm3 / 1e9, 0), 3);
    },
    evDistance: ([context, definition], loc) => {
      const d = h.fieldMap(definition, ['side0', 'side1'], [], loc);
      const a = rows(context, d.side0, loc), b = rows(context, d.side1, loc);
      if (a.length !== 1 || b.length !== 1) throw new RustCapabilityError('evDistance', 'requires one solid on each side', loc);
      return map({ distance: new Quantity(distance(kernel, a[0].record.body, b[0].record.body).distanceMm / 1000) });
    },
    evBox3d: ([context, definition], loc) => {
      const d = h.fieldMap(definition, ['topology'], ['tight', 'cSys'], loc);
      if (d.cSys !== undefined) throw new RustCapabilityError('evBox3d', 'a caller coordinate frame is not implemented', loc);
      if (d.tight !== undefined && typeof d.tight !== 'boolean') raise('tight must be boolean', loc);
      const rs = rows(context, d.topology, loc);
      if (!rs.length) raise('evBox3d requires nonempty topology', loc);
      const boxes = rs.map(r => measure(kernel, r.record.body).bboxMm);
      return map({ minCorner: new Vector([0,1,2].map(k => new Quantity(Math.min(...boxes.map(b => b.min[k])) / 1000))),
        maxCorner: new Vector([0,1,2].map(k => new Quantity(Math.max(...boxes.map(b => b.max[k])) / 1000))) });
    },
  };
}
