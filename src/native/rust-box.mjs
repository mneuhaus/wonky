// Body lifecycle for Rust rectilinear operations. Coordinates/decisions remain
// in Rust; this module only resolves queries, transports words and updates the
// records atomically after all outputs pass the native audit.
import { EnumValue, Quantity, Transform, Vector, map, tagged } from '../values.mjs';
import { raise } from '../errors.mjs';
import { resolveTopology, TopologyQuery } from '../queries.mjs';
import { exactPlacement } from './rust-placement.mjs';
import { rustContextOwner } from './rust-query.mjs';

export function rustBoxBuiltins(engine, h, api) {
  const { Request, OP, call, bodyKey, point3, metres, RustBody, requireExact, words, measure, GeometryRefusal, RustCapabilityError, distance, clash } = api;
  const kernel = engine.kernel;
  const rows = (context, query, loc, allowImported = false) => {
    const owner = rustContextOwner(engine, context, loc, allowImported);
    const r = resolveTopology(owner, query, loc);
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
      for (const row of source) requireExact(row.record.body, 'transform', loc);
      if (!(d.transform instanceof Transform)) raise('opTransform expects a Transform', loc);
      const frame = exactPlacement(d.transform);
      engine.claim(context, id, loc);
      const copies = source.map(({ record }) => {
        const r = new Request(frame ? OP.PLACEMENT : OP.PATTERN).block(words(record.body));
        if (frame) {
          for (const v of [...frame.origin, ...frame.x, ...frame.z]) r.f64(v);
        } else {
          for (const w of bodyKey(record.body.id)) r.u32(w);
          r.u32(0);
          for (const row of d.transform.linear.rows) for (const v of row) r.f64(v);
          for (const v of point3(d.transform.translation, 'transform translation', loc)) r.f64(v);
        }
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
      for (const row of source) requireExact(row.record.body, 'boolean', loc);
      if (new Set(source.map(r => r.record.key)).size !== source.length) raise('Boolean target and tools must be distinct', loc);
      const r = requestKey(new Request(OP.BOOLEAN), id.toString()).u32(op).u32(source.length);
      for (const { record } of source) r.block(words(record.body));
      if (engine.modelingPolicy.curvedContacts === 'tolerated-regularized') r.f64(engine.modelingPolicy.contactCapMm);
      engine.claim(context, id, loc);
      let reply;
      try { reply = call(kernel, r.done(), 'opBoolean', loc); }
      catch (e) {
        if (e.carrierCoincidence) {
          e.carrierCoincidence.operationId = id.toString();
          for (const candidate of e.carrierCoincidence.coincidences) {
            candidate.entities = candidate.entities.map(entity => ({...entity, body:source[entity.bodyIndex].record.body.id}));
          }
        }
        for (const category of ['empty-result', 'non-manifold-result']) {
          if (e instanceof RustCapabilityError && [`boolean/${category}`, `orthogonal/${category}`, `planar-boolean/${category}`, `prism-holes/${category}`, `coaxial/${category}`, `revolve/boolean/${category}`].includes(e.reason)) throw new GeometryRefusal('opBoolean', category, category, loc);
        }
        throw e;
      }
      const copies = []; let at = 1;
      for (let i = 0; i < reply[0]; i++) { const n = reply[at++]; copies.push(body(`${id}/${i}`, reply.slice(at, at + n))); at += n; }
      const owners = [...reply.slice(at)];
      if (owners.length !== copies.length || owners.some(i => !source[i])) {
        throw new RustCapabilityError('opBoolean', 'body-identity-untracked', loc);
      }
      const inherited = new Set(source.flatMap(r => [...r.record.createdBy])); inherited.add(id.key());
      const creators = record => record.bodyCreatedBy ?? record.createdBy;
      const split = op === 1 && copies.length > 1;
      const newCreators = op === 2 ? new Set([...source.flatMap(r => [...creators(r.record)]), id.key()])
        : split ? new Set([...creators(targets[0].record), id.key()]) : null;
      // A split creates all fragments. Do not arbitrarily assign a captured
      // pre-split BODY reference to whichever component Rust emitted first.
      const survivors = new Set(op === 2 || split ? [] : owners.map(i => source[i].record));
      // Delete consumed inputs, not surviving identities. Saved BODY selections
      // refer to these records and must continue to resolve after modification.
      for (const { record } of (op === 1 && d.keepTools ? targets : source)) {
        if (!survivors.has(record)) engine.consume(record, id);
      }
      copies.forEach((b, i) => {
        const original = source[owners[i]].record;
        for (const key of ['name', 'description', 'appearance']) {
          if (Object.hasOwn(original.body, key)) b[key] = original.body[key];
        }
        let record;
        if (op === 2 || split) {
          engine.addSolid(id, b);
          record = engine.records.get(String(engine.nextRecord - 1));
          if (split) record.splitFrom = original.key;
        } else {
          record = original;
          b.id = record.body.id;
          record.body = b;
        }
        if (newCreators) record.bodyCreatedBy = new Set(newCreators);
        record.createdBy = new Set(inherited);
        record.topologyCreatedBy = false;
      });
    },
    evVolume: ([context, definition], loc) => {
      const d = h.fieldMap(definition, ['entities'], [], loc);
      return new Quantity(rows(context, d.entities, loc, true).reduce((s, r) => s + measure(kernel, r.record.body).volumeMm3 / 1e9, 0), 3);
    },
    evDistance: ([context, definition], loc) => {
      const d = h.fieldMap(definition, ['side0', 'side1'], [], loc);
      const a = rows(context, d.side0, loc, true), b = rows(context, d.side1, loc, true);
      if (a.length !== 1 || b.length !== 1) throw new RustCapabilityError('evDistance', 'requires one solid on each side', loc);
      return map({ distance: new Quantity(distance(kernel, a[0].record.body, b[0].record.body).distanceMm / 1000) });
    },
    // std evaluate.fs evCollision: one map {type, target, targetBody, tool, toolBody}
    // per clashing (target, tool) body pair, in target-major order; pairs that do
    // not clash are absent, as in Onshape. Interference and containment come from
    // the exact Boolean, abutment and clearance from the exact distance
    // (rust-clash.mjs). A pair the kernel cannot decide refuses by name; it is
    // never reported as not clashing. ABUT_TOOL_IN_TARGET / ABUT_TOOL_OUT_TARGET /
    // EXISTS are not produced: touching pairs are ABUT_NO_CLASS, and a tool inside
    // the target that touches its boundary is TOOL_IN_TARGET. Known deviation from
    // Onshape: there `target`/`tool` may be the clashing faces or edges, with
    // several maps per body pair (std boolean.fs reads collision.target as a face
    // or edge); here they are the bodies, identical to targetBody/toolBody.
    evCollision: ([context, definition], loc) => {
      const d = h.fieldMap(definition, ['tools', 'targets'], ['passOwners'], loc);
      if (d.passOwners !== undefined && typeof d.passOwners !== 'boolean') raise('passOwners must be boolean', loc);
      const owner = rustContextOwner(engine, context, loc, true);
      const tools = rows(context, d.tools, loc, true), targets = rows(context, d.targets, loc, true);
      const reference = row => new TopologyQuery('reference', { rows: [row], owner });
      const out = [];
      for (const target of targets) for (const tool of tools) {
        if (target.record === tool.record) continue;
        const verdict = clash(kernel, target.record.body, tool.record.body);
        if (!verdict.decided) throw new RustCapabilityError('evCollision', `${target.record.body.id} vs ${tool.record.body.id}: ${verdict.refusal}`, loc);
        if (!verdict.exactClass) throw new RustCapabilityError('evCollision', `${target.record.body.id} vs ${tool.record.body.id}: containment-undecided (interference proven, class not)`, loc);
        if (verdict.type === 'NONE') continue;
        out.push(map({ type: new EnumValue('ClashType', verdict.type), target: reference(target), targetBody: reference(target), tool: reference(tool), toolBody: reference(tool) }));
      }
      return out;
    },
    evBox3d: ([context, definition], loc) => {
      const d = h.fieldMap(definition, ['topology'], ['tight', 'cSys'], loc);
      if (d.cSys !== undefined) throw new RustCapabilityError('evBox3d', 'a caller coordinate frame is not implemented', loc);
      if (d.tight !== undefined && typeof d.tight !== 'boolean') raise('tight must be boolean', loc);
      const rs = rows(context, d.topology, loc, true);
      if (!rs.length) raise('evBox3d requires nonempty topology', loc);
      const boxes = rs.map(r => measure(kernel, r.record.body).bboxMm);
      // box.fs: evBox3d returns a Box3d (a tagged map), as the shared queries do.
      return tagged(map({ minCorner: new Vector([0,1,2].map(k => new Quantity(Math.min(...boxes.map(b => b.min[k])) / 1000))),
        maxCorner: new Vector([0,1,2].map(k => new Quantity(Math.max(...boxes.map(b => b.max[k])) / 1000))) }), 'Box3d');
    },
  };
}
