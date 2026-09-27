// Native query routing. JS transports entity indices and combines sets; WC0
// incidence and geometric predicates stay in Rust. No legacy geometry access.
import { EnumValue, Vector } from '../values.mjs';
import { raise } from '../errors.mjs';
import { queryBuiltins, resolveTopology, TopologyQuery } from '../queries.mjs';
import { exactQueryPlane } from './rust-placement.mjs';

const kinds = ['body', 'face', 'edge', 'vertex'];
const rowKey = row => `${row.record.key}:${row.kind}:${row.index ?? ''}`;
const unique = rows => [...new Map(rows.map(row => [rowKey(row), row])).values()];
export function rustQueryBuiltins(engine, api) {
  const { Request, OP, call, words, RustBody, RustCapabilityError, point3, direction3, closestEdges } = api;
  const refuse = (reason, loc) => { throw new RustCapabilityError('query', reason, loc); };
  const kind = (value, loc) => {
    if (!(value instanceof EnumValue) || value.enumType !== 'EntityType') raise('Expected an EntityType', loc);
    const index = kinds.indexOf(value.name.toLowerCase());
    if (index < 0) refuse('entity-kind', loc);
    return index;
  };
  const native = (rows, mode, args, loc) => {
    const groups = new Map();
    for (const row of rows) {
      if (!(row.record.body instanceof RustBody)) refuse('non-native-solid', loc);
      if (!groups.has(row.record)) groups.set(row.record, []);
      groups.get(row.record).push(row);
    }
    return [...groups].flatMap(([record, selected]) => {
      const r = new Request(OP.QUERY).block(words(record.body)).u32(mode).u32(selected.length);
      for (const row of selected) r.u32(kinds.indexOf(row.kind)).u32(row.index ?? 0);
      args(r);
      const reply = call(engine.kernel, r.done(), 'query', loc);
      const out = [];
      for (let i = 0; i < reply[0]; i++) {
        const type = kinds[reply[1 + i * 2]], index = reply[2 + i * 2];
        out.push({ record, kind: type, ...(type === 'body' ? {} : { index }), nativeBody: record.body });
      }
      return out;
    });
  };
  const owned = (rows, entityType, loc) => {
    const target = kind(entityType, loc);
    if (target === 0) refuse('owned-body-semantics', loc);
    return native(unique(rows.filter(r => r.record.kind === 'solid').map(r => ({ record: r.record, kind: 'body' }))), 0, r => r.u32(target), loc);
  };
  // Returning undefined delegates set operations and body bookkeeping to the
  // shared resolver. Only native geometry access is intercepted here.
  engine.nativeTopologyResolver = (q, loc) => {
    const resolve = query => resolveTopology(engine, query, loc);
    switch (q.kind) {
      case 'owned': return owned(resolve(q.query), q.entityType, loc);
      case 'created': {
        const k = kind(q.entityType, loc);
        if (k === 0) return undefined;
        const records = [...engine.records.values()].filter(r => r.createdBy.has(q.id.key()));
        for (const r of records) {
          if (r.kind !== 'solid') refuse('created-sketch-topology', loc);
          const creator = r.topologyCreatedBy ?? (r.createdBy.size === 1 ? [...r.createdBy][0] : null);
          if (creator !== q.id.key()) refuse('created-topology-identity-untracked', loc);
        }
        return owned(records.map(record => ({ record, kind: 'body' })), q.entityType, loc);
      }
      case 'bodyType': {
        if (q.query.kind !== 'everything') return undefined;
        if (!(q.bodyType instanceof EnumValue) || q.bodyType.enumType !== 'BodyType' || q.bodyType.name !== 'SOLID') refuse('body-type', loc);
        const bodies = [...engine.records.values()].filter(r => r.kind === 'solid').map(record => ({ record, kind: 'body' }));
        return kind(q.query.entityType, loc) === 0 ? bodies : owned(bodies, q.query.entityType, loc);
      }
      case 'reference': {
        if (q.owner !== engine) raise('Query refers to a different modeling context', loc);
        const live = q.rows.filter(r => engine.records.get(r.record.key) === r.record);
        if (live.some(r => r.kind !== 'body' && r.nativeBody !== r.record.body)) refuse('stale-topology-reference', loc);
        return live;
      }
      case 'closestTo': {
        const candidates = resolve(q.query);
        // Preserve the existing exact edge path, including across bodies.
        if (!candidates.length) return [];
        if (candidates.every(row => row.kind === 'edge')) return closestEdges(engine.kernel, candidates, q.point, loc);
        const record = candidates[0].record;
        if (candidates.some(row => row.record !== record || row.kind !== 'face') || !(record.body instanceof RustBody)) {
          refuse('closest-one-box-face-query-required', loc);
        }
        const r = new Request(OP.CLOSEST_BOX_FACES).block(words(record.body));
        for (const x of point3(q.point, 'qClosestTo point', loc)) r.f64(x);
        // FS zeroLength in metres, not a geometric snap tolerance.
        r.f64(1e-8).u32(candidates.length);
        for (const row of candidates) r.u32(row.index);
        const selected = new Set(call(engine.kernel, r.done(), 'qClosestTo', loc));
        return candidates.filter(row => selected.has(row.index));
      }
      case 'geometry':
        return native(resolve(q.query), 1, r => r.text(q.geometryType.name), loc);
      case 'adjacent': {
        if (!(q.adjacencyType instanceof EnumValue) || q.adjacencyType.enumType !== 'AdjacencyType' || q.adjacencyType.name !== 'EDGE') refuse('adjacency-type', loc);
        const target = kind(q.entityType, loc);
        return native(resolve(q.query), 2, r => r.u32(target), loc);
      }
      case 'coincidesWithPlane': {
        const origin = point3(q.plane.origin, 'plane origin', loc), normal = direction3(q.plane.normal, 'plane normal', loc);
        const source = exactQueryPlane(q.plane);
        if (source) return native(resolve(q.query), 5, r => {
          for (const x of [...source.frame.origin, ...source.frame.x, ...source.frame.z, ...source.origin, ...source.normal]) r.f64(x);
        }, loc);
        return native(resolve(q.query), 3, r => { for (const x of [...origin, ...normal]) r.f64(x); }, loc);
      }
      case 'parallelEdges': {
        if (!(q.reference instanceof Vector)) refuse('parallel-edge-reference-query', loc);
        const direction = direction3(q.reference, 'edge direction', loc);
        return native(resolve(q.query), 4, r => { for (const x of direction) r.f64(x); }, loc);
      }
      default: return undefined;
    }
  };
  const constructors = queryBuiltins(engine);
  return {
    qAdjacent: constructors.qAdjacent.call,
    qCoincidesWithPlane: constructors.qCoincidesWithPlane.call,
    qParallelEdges: constructors.qParallelEdges.call,
    evaluateQuery: ([context, query], loc) => {
      if (context !== engine.context) raise('Invalid modeling context', loc);
      const selected = resolveTopology(engine, query, loc);
      if (selected.some(row => row.record.kind !== 'solid' || !(row.record.body instanceof RustBody))) {
        throw new RustCapabilityError('evaluateQuery', 'requires Rust solid topology', loc);
      }
      return selected.map(row => new TopologyQuery('reference', { rows: [row], owner: engine }));
    },
  };
}
