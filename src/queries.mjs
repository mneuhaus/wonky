import { fail, raise, refuseNamed, unsupported } from './errors.mjs';
import { EnumValue, Id, map, matchesType, Plane, Quantity, STD_ENUM_UNIMPLEMENTED, tagged, Transform, Vector, vectorNumbers } from './values.mjs';
import { cross, dot, norm, normalized, sub } from './brep.mjs';
import { array, list, transformInBend } from './kernel.mjs';
import { transformAnalytic } from './analytic.mjs';
import { classificationInput } from './face-classification.mjs';
import { intersectionTolerance } from './intersections.mjs';
import { coords as realCoords, number as realNumber, real, vector as realVector } from './real.mjs';
import { integrateVolume, VOLUME_RELATIVE_LIMIT } from './volume.mjs';
import { isMeshBody, refuseMeshBody } from './hybrid-mesh.mjs';
import { operationEvidence } from './construction-history.mjs';
import { fragmentEdges, fragmentRegion, regionEdges } from './fillet-fragments.mjs';
import { isRustBody, measureRustBody, closestRustEdges } from './native/rust-host.mjs';

export class TopologyQuery {
  constructor(kind, data = {}) { this.type = 'Query'; this.kind = kind; Object.assign(this, data); }
  // The value == compares (values.mjs equal), for the kinds whose std query map
  // is a one-to-one function of wonky's fields (query.fs: qCreatedBy
  // { CREATED_BY, featureId, entityType }, qUnion/qIntersection { ..., subqueries },
  // qSubtraction { query1, query2 }, qEverything { EVERYTHING[, entityType] },
  // qOwnedByBody { part, entityType }). Null for the others: qNothing() and
  // qUnion([]) share wonky's empty union, qAllModifiableSolidBodies() is not
  // spelled out as its std subqueries, and evaluated or robust queries hold
  // wonky's own records.
  stdFields() {
    const fields = { created: ['id', 'entityType'], union: ['queries'], intersection: ['queries'], subtract: ['a', 'b'], everything: ['entityType'], owned: ['query', 'entityType'] }[this.kind];
    if (!fields || (this.kind === 'union' && !this.queries.length)) return null;
    return map(Object.fromEntries([['kind', this.kind], ...fields.map(key => [key, this[key]])]));
  }
}
const builtin = (name, min, max, call) => ({ type: 'builtin', name, min, max, call });
// Matrix arithmetic for ordinary FS rotations rounds in binary64. Allow only
// that rounding, not a measurable scale/shear that analytic bodies would ignore.
export function rigidTransformDeterminant(rows) {
  const tolerance = 1e-14;
  const determinant = dot(rows[0], cross(rows[1], rows[2]));
  if (rows.some((row, i) => rows.some((other, j) =>
    Math.abs(dot(row, other) - (i === j ? 1 : 0)) > tolerance))
    || Math.abs(Math.abs(determinant) - 1) > tolerance) return null;
  return determinant;
}

// A std enum as wonky declares it: `names` are the members wonky implements,
// `unimplemented` the other std members (see STD_ENUM_UNIMPLEMENTED).
export function enumSet(type, names, unimplemented = []) {
  const members = map(Object.fromEntries(names.map(name => [name, new EnumValue(type, name)])));
  if (unimplemented.length) Object.defineProperty(members, STD_ENUM_UNIMPLEMENTED, { value: unimplemented, enumerable: false });
  return members;
}
const enumIs = (value, type, name) => value instanceof EnumValue && value.enumType === type && value.name === name;
const resultKey = r => `${r.record.key}:${r.kind}:${r.index ?? ''}`;
const unique = rows => [...new Map(rows.map(row => [resultKey(row), row])).values()];

// A set of sketch regions (Rust port, docs/fs-queries.md "Sketch regions on the
// Rust port"): the leaf Query of qSketchRegion (library.mjs) and these nodes,
// built lazily and evaluated by the opExtrude that consumes them
// (native/rust-host.mjs evaluateRegions). Kinds: nothing, union {queries},
// intersection {queries}, subtract {a, b}, pick {builtin, query, point, loc}
// (qContainsPoint / qClosestTo), nth {query, n}, ref {id, index} (one region
// that evaluateQuery returned).
export class RegionQuery {
  constructor(kind, data = {}) { this.type = 'Query'; this.kind = kind; Object.assign(this, data); }
}
export const isRegionQuery = query => query?.type === 'Query' && !(query instanceof TopologyQuery);
// qNothing() and qUnion([]): an empty topology query is the empty set of any entity.
const isEmptyTopology = query => query instanceof TopologyQuery && query.kind === 'union' && query.queries.every(isEmptyTopology);
export const REGION_HINTS = {
  mixed: 'Keep sketch regions and topology queries apart: extrude the regions of qSketchRegion(...) with one opExtrude, and evaluate topology queries separately.',
  topology: 'Pass qSketchRegion(sketchId) or a qUnion, qSubtraction, qIntersection, qContainsPoint, qClosestTo, qGeometry or qEntityFilter of sketch regions to opExtrude.',
};
export const regionRefusal = (builtin, reason, message, hint, loc) => refuseNamed(builtin, reason, message, hint, loc);
// The operands of a set operation as region queries, or null when none of them
// is a region query (topology operands keep their topology semantics).
function regionOperands(builtin, operands, loc) {
  if (!operands.some(isRegionQuery)) return null;
  return operands.map(query => {
    if (isRegionQuery(query)) return query;
    if (query?.type !== 'Query') raise(`${builtin} expects queries`, loc);
    if (isEmptyTopology(query)) return new RegionQuery('nothing');
    return regionRefusal(builtin, 'sketch-region/mixed-with-topology', 'a sketch-region query and a topology query cannot be combined', REGION_HINTS.mixed, loc);
  });
}
// Filters and selectors that need Onshape facts about the owner body or the
// edges of a sketch region, which are not documented: named, never guessed.
const REGION_UNDOCUMENTED = {
  qBodyType: ['sketch-region/owner-body-type-undocumented', 'the body type that owns a sketch-region face is not documented'],
  qOwnedByBody: ['sketch-region/owner-body-undocumented', 'the body that owns a sketch-region face is not documented'],
  qAdjacent: ['sketch-region/adjacency-unavailable', 'the entities adjacent to a sketch region are not computed'],
  qCoincidesWithPlane: ['sketch-region/coincidence-tolerance-unpublished', 'Onshape publishes no tolerance for qCoincidesWithPlane, so coincidence of a region with a plane is not decided'],
  qParallelEdges: ['sketch-region/parallel-edges-of-faces-undocumented', 'qParallelEdges over faces (which have no linear edge of their own) is not documented'],
  makeRobustQuery: ['sketch-region/robust-query-unavailable', 'makeRobustQuery of sketch regions is not implemented'],
};
export function refuseRegionQuery(builtin, loc) {
  const [reason, message] = REGION_UNDOCUMENTED[builtin];
  return regionRefusal(builtin, reason, message,
    `${builtin} has no exact meaning for a sketch region here; select regions with qUnion, qSubtraction, qIntersection, qContainsPoint, qClosestTo, qGeometry(..., GeometryType.PLANE) or qEntityFilter(..., EntityType.FACE) instead.`, loc);
}

export function resolveTopology(engine, query, loc) {
  if (!(query instanceof TopologyQuery)) {
    // A sketch-region Query is an Onshape Query too; wonky keeps it separate.
    if (query?.type === 'Query') regionRefusal('query', 'sketch-region/not-a-topology-query', 'a sketch-region query cannot be used as a topology query here',
      'Sketch regions are consumed by opExtrude; use a topology query (qEverything, qCreatedBy, qAllModifiableSolidBodies, ...) here.', loc);
    raise('Expected a topology Query', loc);
  }
  const native = engine.nativeTopologyResolver?.(query, loc);
  if (native !== undefined) return native;
  const records = [...engine.records.values()];
  const bodies = records.map(record => ({ record, kind: 'body' }));
  switch (query.kind) {
    case 'allSolid': return bodies.filter(row => row.record.kind === 'solid');
    case 'created': {
      if (enumIs(query.entityType, 'EntityType', 'BODY')) {
        return bodies.filter(({ record }) => (record.bodyCreatedBy ?? record.createdBy).has(query.id.key()));
      }
      const found = bodies.filter(row => row.record.createdBy.has(query.id.key()));
      if (engine.entityCreators?.has(query.id.key())) return createdEntities(found, query, loc);
      return withoutCreatedInBody(engine, owned(engine, found, query.entityType, loc), query, loc);
    }
    case 'union': return unique(query.queries.flatMap(q => resolveTopology(engine, q, loc)));
    case 'subtract': {
      const remove = new Set(resolveTopology(engine, query.b, loc).map(resultKey));
      return resolveTopology(engine, query.a, loc).filter(row => !remove.has(resultKey(row)));
    }
    // std query.fs qBodyType: the entities (bodies, faces, edges) that belong
    // to a body of the given type. A SOLID filter excludes Onshape's default
    // bodies, so qEverything directly below it is decidable (see everything()).
    case 'bodyType': {
      if (!enumIs(query.bodyType, 'BodyType', 'SOLID')) unsupported('Only solid body-type filtering is implemented', loc);
      const rows = query.query instanceof TopologyQuery && query.query.kind === 'everything' ? everything(engine, query.query, loc, true) : resolveTopology(engine, query.query, loc);
      return rows.filter(row => row.record.kind === 'solid');
    }
    case 'owned': return owned(engine, resolveTopology(engine, query.query, loc), query.entityType, loc);
    case 'reference': {
      if (query.owner !== engine) fail('Query refers to a different modeling context', loc);
      return query.rows.filter(row => engine.records.get(row.record.key) === row.record);
    }
    case 'everything': return everything(engine, query, loc, false);
    // std query.fs qIntersection: the entities of the first subquery that every other subquery also matches.
    case 'intersection': {
      const [first = [], ...others] = query.queries.map(q => resolveTopology(engine, q, loc));
      const keep = others.map(rows => new Set(rows.map(resultKey)));
      return first.filter(row => keep.every(keys => keys.has(resultKey(row))));
    }
    case 'containsPoint': return containsPoint(engine, resolveTopology(engine, query.query, loc), query.point, loc);
    case 'robust': return robust(engine, query, loc);
    case 'adjacent': return adjacent(engine, resolveTopology(engine, query.query, loc), query, loc);
    case 'coincidesWithPlane': return coincidesWithPlane(engine, resolveTopology(engine, query.query, loc), query.plane, loc);
    case 'geometry': return resolveTopology(engine, query.query, loc).filter(row => hasGeometryType(row, query.geometryType.name, loc));
    case 'closestTo': return closestTo(engine, resolveTopology(engine, query.query, loc), query.point, loc);
    case 'parallelEdges': return parallelEdges(engine, resolveTopology(engine, query.query, loc), query.reference, loc);
    // An unsupplied Query feature parameter (Interpreter.dialogDefault): the
    // user's pick in Onshape, which a standalone build does not have.
    case 'uiSelection': unsupported(`Feature parameter '${query.parameter}' is a UI selection (Query) with no value (uiSelection); supply it with --param (for example '${query.parameter}=qNothing()') or a Part Studio input`, loc);
    default: unsupported(`Query '${query.kind}' is not implemented`, loc);
  }
}
// std query.fs qEverything(entityType): every entity of that type in the
// context. In Onshape that includes the default bodies every Part Studio has
// (std defaultFeatures.fs: the Origin and the Top, Front and Right planes;
// derive.fs subtracts qDefaultBodies() from qEverything(EntityType.BODY)).
// wonky creates no default geometry, so only the solid-filtered form
// qBodyType(qEverything(...), BodyType.SOLID) has a result wonky can give.
function everything(engine, query, loc, solidFiltered) {
  if (query.entityType === undefined) unsupported('qEverything() without an EntityType is not implemented', loc);
  if (!solidFiltered) unsupported("qEverything would include Onshape's default bodies (the Origin and the Top, Front and Right planes), which wonky does not create; filter it with qBodyType(qEverything(...), BodyType.SOLID)", loc);
  const solids = [...engine.records.values()].filter(record => record.kind === 'solid').map(record => ({ record, kind: 'body' }));
  return enumIs(query.entityType, 'EntityType', 'BODY') ? solids : owned(engine, solids, query.entityType, loc);
}
// std feature.fs makeRobustQuery(context, q) = qUnion(evaluateQuery(q) +
// startTrackingIdentity(q)): the evaluated entities plus "the new entities
// inheriting the identity" of each. wonky tracks identity per body record:
// a Boolean keeps the record of the target (or of the earliest merged tool,
// as std opBoolean documents), so the query follows it, and a body deleted
// with opDeleteBodies no longer exists. Whether the result of a Boolean
// inherits the identity of a tool it consumed, and which piece of a split
// body inherits the identity, is not documented, so both refuse, and so do
// faces and edges, whose indices a later operation renumbers.
function robust(engine, query, loc) {
  if (query.owner !== engine) fail('Query refers to a different modeling context', loc);
  const tracked = new Set(query.rows.map(row => row.record.key));
  const splitLater = record => tracked.has(record.splitFrom) && Number(record.key) >= query.firstLaterRecord;
  if ([...engine.records.values()].some(splitLater)) unsupported('makeRobustQuery cannot track a body that a Boolean split into several bodies', loc);
  const consumed = query.rows.find(row => engine.records.get(row.record.key) !== row.record && engine.consumedBy?.has(row.record.key));
  if (consumed) unsupported(`makeRobustQuery cannot track a body that the Boolean '${engine.consumedBy.get(consumed.record.key)}' consumed: which body inherits its identity is not documented`, loc);
  return query.rows.filter(row => engine.records.get(row.record.key) === row.record);
}
// std query.fs qContainsPoint(queryToFilter, point): the entities that contain
// the point. Every decision is a Bend classifier's; an Unresolved result, a
// vertex and a face carrier without a Bend classifier are capability errors.
// - body: the point-in-solid classifier; Inside and Boundary contain it.
// - face: on the carrier within tolerance and inside the trimmed face, by the
//   planar (face-classification.bend) or cylindrical
//   (cylinder-classification.bend) face classifier; Inside and Boundary
//   contain it.
// - edge: on the curve within its parameter range (edgeContains).
function containsPoint(engine, rows, point, loc) {
  const p = vectorNumbers(point, 1, 3, loc);
  if (!rows.length) return rows;
  const services = engine.services;
  if (!services?.solidClassifier || !services?.faceClassifier) unsupported('qContainsPoint needs the Bend solid classifier, which this build did not load (the native backend does not include it; JS builds load it with loadModelingServices())', loc);
  const inputs = new Map(), tolerance = intersectionTolerance(), at = realVector(p);
  const input = record => {
    if (!inputs.has(record)) {
      const value = classificationInput(record.body, services.faceClassifier);
      if (value.solid === null) unsupported('qContainsPoint: classification input is invalid', loc);
      inputs.set(record, value);
    }
    return inputs.get(record);
  };
  return rows.filter(row => {
    if (row.record.kind !== 'solid') unsupported('qContainsPoint over sketch bodies is not implemented', loc);
    // A certified mesh has no exact trimmed faces or edges to classify against.
    if (isMeshBody(row.record.body)) refuseMeshBody(row.record.body, `qContainsPoint over its ${row.kind === 'body' ? 'body' : `${row.kind}s`}`, loc);
    if (row.kind === 'vertex') unsupported('qContainsPoint over vertices is not implemented', loc);
    const { solid, domains, sourceBudget } = input(row.record);
    if (row.kind === 'body') {
      const result = services.solidClassifier.classify(solid, domains, at, tolerance, sourceBudget);
      if (result.$ === 'Unresolved') unsupported(`qContainsPoint: solid classification unresolved: ${result.reason.$}`, loc);
      return result.$ === 'Inside' || result.$ === 'Boundary';
    }
    if (row.kind === 'face') return faceContains(services, solid, domains, sourceBudget, row.index, at, tolerance, loc);
    if (row.kind === 'edge') return edgeContains(services.faceClassifier, solid, domains, sourceBudget, row.index, at, tolerance, loc);
    unsupported(`qContainsPoint over ${row.kind} entities is not implemented`, loc);
  });
}
function faceContains(services, solid, domains, sourceBudget, index, point, tolerance, loc) {
  const face = array(solid.faces)[index];
  const classify = { Plane: services.faceClassifier.classify, Cylinder: services.solidClassifier['cylinder-classification.classify'] }[face?.surface?.$];
  if (!classify) unsupported(`qContainsPoint over a ${face?.surface?.$?.toLowerCase() ?? 'missing'} face is not implemented (Bend face classification covers plane and cylinder faces)`, loc);
  const result = classify(solid, index, domains, point, tolerance, sourceBudget);
  if (result.$ === 'Unresolved') unsupported(`qContainsPoint: ${face.surface.$.toLowerCase()} face classification unresolved: ${result.reason.$}`, loc);
  return result.$ === 'Inside' || result.$ === 'Boundary';
}
// A point is on an edge when it lies within tolerance of the curve at a
// parameter inside the edge's range. The distance bounds are the face
// classifier's own boundary test (face-classification.bend edge_boundary:
// the nearest parameter clamped to the range; a certified upper bound decides
// "on", a lower bound decides "clear"), evaluated in a frame plane that holds
// the curve: the plane of a circle or ellipse, any plane through a line. Its
// round lower bound is measured in that plane, so a point it cannot clear is
// cleared only when its distance to the plane exceeds the same margin; any
// other gap refuses by name.
function edgeContains(F, solid, domains, sourceBudget, index, point, tolerance, loc) {
  const edges = array(solid.edges), vertices = array(solid.vertices), edge = edges[index];
  if (!edge) unsupported('qContainsPoint: edge index is invalid', loc);
  const choice = array(domains)[index] ?? { $: 'AutoDomain' };
  const domain = F.resolve_domain(choice, edge, vertices[edge.start], vertices[edge.end]);
  if (domain.$ !== 'Some') unsupported('qContainsPoint: the edge has no parameter range', loc);
  const curve = edge.curve;
  let origin, normal;
  if (curve.$ === 'Line') {
    // Any unit normal of the line: crossed with the world axis it is least
    // aligned with (a frame choice, not a geometric decision).
    const d = [curve.direction.x, curve.direction.y, curve.direction.z].map(v => Math.abs(F['real.approx'](v)));
    const k = d.indexOf(Math.min(...d));
    origin = curve.origin;
    normal = F['precise.normalize'](F['precise.cross'](curve.direction, realVector([0, 1, 2].map(i => Number(i === k)))));
  } else if (curve.$ === 'Circle' || curve.$ === 'Ellipse') ({ origin, normal } = curve);
  else unsupported(`qContainsPoint over a ${curve.$} edge is not implemented`, loc);
  const R = name => F[`real.${name}`], I = name => F[`intersections.${name}`];
  const linear = I('tolerance_linear')(tolerance);
  const resolution = R('mul')(I('angular_guard')(), F.edges_scale(list([edge]), I('input_scale')(point, origin, R('from_f32')(1))));
  if (!R('less')(resolution, linear)) unsupported('qContainsPoint: edge classification unresolved: ResolutionLimit', loc);
  const prepared = { $: 'PreparedEdge', index, edge, domain: domain.value, start: vertices[edge.start], end: vertices[edge.end], forward: true };
  const state = F.edge_boundary(prepared, point, origin, normal, linear, sourceBudget, resolution);
  if (state.$ === 'OnBoundary') return true;
  if (state.$ === 'ClearBoundary') return false;
  const height = R('abs')(I('signed_distance')(F['precise.sub'](point, origin), normal));
  if (R('less')(R('add')(R('add')(linear, resolution), sourceBudget), height)) return false;
  unsupported('qContainsPoint: edge classification unresolved: NearBoundary', loc);
}
// std query.fs qAdjacent(seed, AdjacencyType.EDGE, entityType): the entities
// that share at least an edge with a seed entity; a seed is in the result only
// when it is adjacent to another seed. For face seeds that is, by topology
// alone: EDGE -> the edges that bound them; FACE -> every other face that uses
// one of those edges. Vertex adjacency, edge seeds and the untyped form refuse.
// A face a planar Boolean left split into coplanar fragments is one face in
// Onshape: with the Bend services loaded (src/fillet-fragments.mjs, Bend
// decides the fragment edges) a seed stands for its whole region, EDGE gives
// the region's edges without the fragment edges inside it, and FACE gives the
// faces across those edges, each with its own region. Without the services
// (the native backend) each fragment is its own face, as before.
function adjacent(engine, seeds, query, loc) {
  if (!enumIs(query.adjacencyType, 'AdjacencyType', 'EDGE')) unsupported(`qAdjacent with ${display(query.adjacencyType)} is not implemented (only AdjacencyType.EDGE)`, loc);
  if (query.entityType === undefined) unsupported('qAdjacent without an EntityType is not implemented', loc);
  const kind = enumIs(query.entityType, 'EntityType', 'EDGE') ? 'edge' : enumIs(query.entityType, 'EntityType', 'FACE') ? 'face' : null;
  if (!kind) unsupported(`qAdjacent(..., AdjacencyType.EDGE, ${display(query.entityType)}) is not implemented (only EntityType.EDGE and EntityType.FACE)`, loc);
  const rows = [];
  for (const seed of seeds) {
    if (seed.kind !== 'face') unsupported(`qAdjacent over ${seed.kind} seeds is not implemented (only face seeds)`, loc);
    if (isMeshBody(seed.record.body)) refuseMeshBody(seed.record.body, 'qAdjacent (its faces have no exact edges)', loc);
    const body = seed.record.body, native = engine.services?.fillet;
    const fragments = native ? fragmentEdges(native, body) : null;
    const edges = new Set(regionEdges(body, fragments, seed.index)), region = new Set(fragmentRegion(body, fragments, seed.index));
    // A seam edge (wonkyTopology) bounds its own face only and is no Onshape edge.
    const { seamEdges } = wonkyTopology(body);
    if (kind === 'edge') rows.push(...[...edges].filter(index => !seamEdges.has(index)).sort((a, b) => a - b).map(index => ({ record: seed.record, kind, index })));
    else body.faces.forEach((_, index) => {
      if (region.has(index) || !faceEdges(body, index).some(edge => edges.has(edge))) return;
      for (const face of fragmentRegion(body, fragments, index)) rows.push({ record: seed.record, kind, index: face });
    });
  }
  return unique(rows);
}
const display = value => value instanceof EnumValue ? `${value.enumType}.${value.name}` : String(value);

// std math.fs TOLERANCE.zeroLength (1e-8 m), in mm. std query.fs qClosestTo
// resolves a tie to every entity within it of the closest. qCoincidesWithPlane
// states no tolerance (its source carries "TODO: tolerance"); wonky assumes
// Onshape's is not larger than this zero length, which is also Parasolid's
// linear resolution, and uses it as the edge of the band it cannot decide.
const ZERO_LENGTH_MM = 1e-5;
// face-plane.bend's exclusion margin: sixteen times the kernel's
// scale-dependent arithmetic guard (intersections.bend guard: 1e-13 x
// max(1, |coordinates|, radius)). It bounds the F32x2 rounding of a computed
// distance; it is an operational guard, not a certified interval bound.
const GUARD_FACTOR = 16;

// The Bend services these queries run on (library.mjs loadModelingServices).
function bendServices(engine, what, loc) {
  const services = engine.services;
  if (!services?.faceClassifier || !services?.solidClassifier || !services?.edgePlane) unsupported(`${what} needs the Bend face, solid and edge-plane services, which this build did not load (the native backend does not include them; JS builds load them with loadModelingServices())`, loc);
  const F = services.faceClassifier;
  const R = name => F[`real.${name}`], G = name => F[`precise.${name}`], I = name => F[`intersections.${name}`];
  const zero = R('from_f32')(0);
  const inputs = new Map();
  return {
    ...services, F, R, G, I, zero,
    // classificationInput once per record: the native solid, edge domains and
    // the body's source allowance (vertex tolerances), as qContainsPoint uses them.
    input(record) {
      if (!inputs.has(record)) {
        const value = classificationInput(record.body, F);
        if (value.solid === null) unsupported(`${what}: classification input is invalid`, loc);
        inputs.set(record, value);
      }
      return inputs.get(record);
    },
    margin: (scale, budget) => R('add')(R('mul')(R('from_f32')(GUARD_FACTOR), I('guard')(scale)), budget),
  };
}

// std query.fs qCoincidesWithPlane(queryToFilter, plane): the entities that
// coincide with the infinite plane. Coincidence is a relation of point sets,
// so the plane's normal direction and a face's orientation do not matter.
// Each entity is decided in this order; the band left over refuses by name:
// 1. Exact: a Bend certificate on the stored words. Face: its carrier by
//    intersections.plane_plane (CoincidentPlanes: exact parallel and incidence
//    certificates); edge: edge-plane.intersect (Coincident: exact curve and
//    source-vertex certificates); vertex: coincidence_certificate of
//    n . (p - o) = 0.
// 2. Exact no: a curved face carrier (cylinder, cone, sphere, torus) never
//    holds a face of positive area in a plane; plane_plane's ParallelPlanes
//    (farther apart than ZERO_LENGTH_MM plus the guard) and CrossingPlanes
//    (sine above the default angular tolerance 1e-10, itself above std
//    TOLERANCE.zeroAngle 1e-11); edge-plane's Disjoint, Crossing and Tangent.
//    A planar face is decided on its carrier here, as a relation of surfaces:
//    a sliver face within the zero length of a crossing plane does not count.
// 3. Rounding: the plane and the entity were computed on two paths, by
//    FeatureScript in binary64 metres and by the kernel in F32x2 millimetres
//    (48-bit significands). The same exact plane then differs by rounding
//    only, a few units of 2^-48 relative to the coordinates, which the
//    kernel's margin (GUARD_FACTOR x 1e-13 x scale) covers. When every
//    extreme point of the entity (vertices; the extremes of a circle or
//    ellipse inside its range) lies within that margin of the plane, the
//    entity coincides at the kernel's resolution. A planar face whose carrier
//    is exactly parallel to the plane (plane_plane NearCoincidentPlanes) is
//    decided on the carrier's one distance first.
// 4. Clearly off: a point of the entity farther than ZERO_LENGTH_MM plus the
//    margin plus the body's source allowance does not coincide.
// Anything else lies between the kernel's resolution and Onshape's zero
// length and refuses. A certified-mesh face is decided on its recorded exact
// carrier by steps 1 and 2 and, when the carrier is exactly parallel, by
// step 3 on the carrier; otherwise steps 3 and 4 need exact boundary points
// and refuse there. Bodies refuse: whether Onshape asks a body to lie in the
// plane or tests its faces is not documented.
function coincidesWithPlane(engine, rows, plane, loc) {
  if (!rows.length) return rows;
  const B = bendServices(engine, 'qCoincidesWithPlane', loc);
  const origin = realVector(vectorNumbers(plane.origin, 1, 3, loc)), normal = realVector(vectorNumbers(plane.normal, 0, 3, loc));
  const tolerance = intersectionTolerance({ linear: ZERO_LENGTH_MM });
  const { R, G, I } = B;
  const distance = point => R('abs')(I('signed_distance')(G('sub')(point, origin), normal));
  const margin = (point, budget) => B.margin(I('input_scale')(point, origin, B.zero), budget);
  // Steps 3 and 4 over the entity's points; `complete` says they include its extremes.
  const undecided = (where, reason) => unsupported(`qCoincidesWithPlane: ${where} lies within ${ZERO_LENGTH_MM} mm (TOLERANCE.zeroLength) of the plane but is neither certified to lie in it nor within the kernel's resolution (${reason})`, loc);
  const byPoints = ({ points, complete }, sourceBudget, where, reason) => {
    if (complete && points.every(point => !R('less')(margin(point, B.zero), distance(point)))) return true;
    if (points.some(point => R('less')(R('add')(real(ZERO_LENGTH_MM), margin(point, sourceBudget)), distance(point)))) return false;
    undecided(where, reason);
  };
  return rows.filter(row => {
    const body = row.record.body, where = `${row.kind} ${row.index} of body ${body.id}`;
    if (row.kind === 'body') unsupported('qCoincidesWithPlane over bodies is not implemented (whether Onshape tests the body or its faces is not documented)', loc);
    if (row.record.kind !== 'solid') unsupported('qCoincidesWithPlane over sketch bodies is not implemented', loc);
    if (row.kind === 'face') {
      const surface = body.faces[row.index].surface;
      if (['cylinder', 'cone', 'sphere', 'torus'].includes(surface.type)) return false;
      if (surface.type !== 'plane') unsupported(`qCoincidesWithPlane over a ${surface.type} face is not implemented`, loc);
      const carrier = realVector(surface.origin);
      const result = B.F['intersections.plane_plane'](carrier, realVector(surface.normal), origin, normal, tolerance);
      if (result.$ === 'Resolved') return result.relation.$ === 'CoincidentPlanes'; // else ParallelPlanes or CrossingPlanes
      const reason = `plane_plane ${result.$} ${result.reason.$}`;
      // Step 3 on the carrier: plane_plane answers NearCoincidentPlanes only
      // after its exact parallel certificate, so every point of the carrier
      // lies at the one distance |n . (carrier origin - plane origin)| and no
      // boundary point is needed; the margin's scale is plane_plane's,
      // max(1, |carrier origin|, |plane origin|). A margin of the zero length
      // or more (scale above 6.25e6 mm) cannot tell rounding from an offset.
      // Beyond the margin the distance lies in the undecided band (plane_plane
      // answers ParallelPlanes past the zero length plus its guard): a mesh
      // face refuses there, an exact face tries its boundary points.
      if (result.reason.$ === 'NearCoincidentPlanes') {
        const within = margin(carrier, B.zero);
        if (R('less')(within, real(ZERO_LENGTH_MM)) && !R('less')(within, distance(carrier))) return true;
        if (isMeshBody(body)) undecided(where, `${reason}, an exactly parallel carrier`);
      }
      if (isMeshBody(body)) refuseMeshBody(body, `qCoincidesWithPlane (face ${row.index}'s carrier: ${reason}; deciding it needs exact boundary points)`, loc);
      const edges = [...new Set(faceEdges(body, row.index))].map(index => extremePoints(B, body, index, normal));
      return byPoints({ points: edges.flatMap(e => e.points), complete: edges.every(e => e.complete) }, B.input(row.record).sourceBudget, where, reason);
    }
    if (isMeshBody(body)) refuseMeshBody(body, `qCoincidesWithPlane over its ${row.kind}s`, loc);
    const { solid, domains, sourceBudget } = B.input(row.record);
    if (row.kind === 'edge') {
      const result = B.edgePlane.intersect(solid, row.index, domains, origin, normal, tolerance, sourceBudget);
      if (result.$ === 'Resolved') return result.relation.$ === 'Coincident'; // else Disjoint, Crossing or Tangent
      return byPoints(extremePoints(B, body, row.index, normal), sourceBudget, where, `edge-plane ${result.$} ${result.reason.$}`);
    }
    if (row.kind === 'vertex') {
      const point = realVector(body.vertices[row.index]);
      if (I('coincidence_certificate')(true, normal, point, origin)) return true;
      return byPoints({ points: [point], complete: true }, sourceBudget, where, 'no exact incidence certificate');
    }
    unsupported(`qCoincidesWithPlane over ${row.kind} entities is not implemented`, loc);
  });
}
// Faces and edges an operation created inside a body it kept (a blend: the
// body's record, and so its BODY lineage, stays; only the blend and corner
// faces and their edges are new). body -> Map<id key, { face, edge }>.
const CREATED_IN_BODY = new WeakMap();
export function recordCreatedEntities(engine, id, body, { faces, edges }) {
  (engine.entityCreators ??= new Set()).add(id.key());
  const created = CREATED_IN_BODY.get(body) ?? new Map();
  created.set(id.key(), { face: [...faces].sort((a, b) => a - b), edge: [...edges].sort((a, b) => a - b) });
  CREATED_IN_BODY.set(body, created);
}
// std qCreatedBy(id, FACE | EDGE) for such an operation: its own faces and
// edges. A later operation that replaced the body renumbers them, and wonky
// does not track them through it, so that refuses by name instead of
// answering with the whole body.
function createdEntities(rows, query, loc) {
  if (enumIs(query.entityType, 'EntityType', 'VERTEX')) unsupported('Vertex queries are not implemented', loc);
  const kind = enumIs(query.entityType, 'EntityType', 'EDGE') ? 'edge' : enumIs(query.entityType, 'EntityType', 'FACE') ? 'face' : null;
  if (!kind) (query.entityType instanceof EnumValue && query.entityType.enumType === 'EntityType' ? unsupported : raise)('Expected EntityType.EDGE or EntityType.FACE', loc);
  return rows.filter(row => row.record.kind === 'solid').flatMap(({ record }) => {
    const created = CREATED_IN_BODY.get(record.body)?.get(query.id.key());
    if (!created) unsupported(`qCreatedBy(${query.id}, ${query.entityType.name}): a later operation replaced the body that '${query.id}' built, and wonky does not track the ${kind}s '${query.id}' created through it`, loc);
    // A seam edge (wonkyTopology) bounds its own face only and is no Onshape edge,
    // as in qOwnedByBody and qAdjacent.
    const seams = kind === 'edge' ? wonkyTopology(record.body).seamEdges : null;
    return created[kind].filter(index => !seams?.has(index)).map(index => ({ record, kind, index }));
  });
}
// The other creators of such a body (its lineage) own its faces and edges
// except those. When a later operation replaced the body, the faces a blend
// in its lineage created are no longer told apart, so that refuses by name.
function withoutCreatedInBody(engine, rows, query, loc) {
  if (!engine.entityCreators) return rows;
  const checked = new Set();
  return rows.filter(row => {
    const created = CREATED_IN_BODY.get(row.record.body);
    if (!checked.has(row.record)) {
      const lost = [...row.record.createdBy].find(key => engine.entityCreators.has(key) && !created?.has(key));
      if (lost !== undefined) unsupported(`qCreatedBy(${query.id}, ${query.entityType.name}): a later operation replaced a body that a blend in its history changed, and wonky no longer tells the faces and edges that blend created from those of '${query.id}'`, loc);
      checked.add(row.record);
    }
    return !created || ![...created.values()].some(entities => entities[row.kind].includes(row.index));
  });
}
// The points of an edge where its distance from a plane (normal n) is
// extreme: its vertices, and on a circle or ellipse the two parameters where
// n . (a cos t x + b sin t y) peaks, t* = atan2(b n.y, a n.x) and t* + pi,
// when they lie in the edge's range (a closed edge: always). `complete` is
// false for an arc without a stored range, whose extremes are unknown.
function extremePoints(B, body, index, normal) {
  const { R, G, F } = B, edge = body.edges[index], c = edge.curve;
  const points = [realVector(body.vertices[edge.start]), realVector(body.vertices[edge.end])];
  const type = c.type ?? c;
  if (type === 'line') return { points, complete: true };
  if (type !== 'circle' && type !== 'ellipse') return { points, complete: false };
  const curve = type === 'circle' ? F['analytic.circle'](realVector(c.origin), realVector(c.normal), realVector(c.x), real(c.radius))
    : F['analytic.ellipse'](realVector(c.origin), realVector(c.normal), realVector(c.x), real(c.major), real(c.minor));
  const [a, b] = type === 'circle' ? [curve.radius, curve.radius] : [curve.major, curve.minor];
  const peak = R('atan2')(R('mul')(b, G('dot')(normal, G('cross')(curve.normal, curve.x))), R('mul')(a, G('dot')(normal, curve.x)));
  const full = edge.start === edge.end && !edge.curveRange;
  if (!full && !edge.curveRange) return { points, complete: false };
  for (const t of [peak, R('add')(peak, R('pi')())]) {
    if (full || withinRange(B, t, edge.curveRange)) points.push(F['analytic.curve_point'](curve, t));
  }
  return { points, complete: true };
}
// Whether the angle t, lifted into [first, first + 2 pi), is at most last.
function withinRange(B, t, [first, last]) {
  const { R } = B, turn = R('mul')(R('from_f32')(2), R('pi')()), lo = real(first);
  let angle = t;
  while (R('less')(angle, lo)) angle = R('add')(angle, turn);
  while (!R('less')(angle, R('add')(lo, turn))) angle = R('sub')(angle, turn);
  return !R('less')(real(last), angle);
}

// std query.fs qGeometry(queryToFilter, geometryType), GeometryType as
// documented there. wonky's carriers are plane, cylinder, cone, sphere and
// torus surfaces and line, circle and ellipse curves; a revolve or extrude
// always builds one of these (kernel/revolve.bend), so REVOLVED, EXTRUDED
// and OTHER_SURFACE never match. A circle edge is a CIRCLE when it is the
// whole circle (one seam vertex, no parameter range: the kernel's full-curve
// rule, docs/edge-plane.md) and an ARC between two vertices; an ellipse is an
// OTHER_CURVE. ALL_MESH, MIXED_MESH and MESH name Onshape mesh entities; wonky
// has none. A certified-mesh body stands for the exact B-rep Onshape builds,
// so its faces take the type of their recorded exact carrier. Bodies with
// any other type and vertices refuse: the docs give them no geometry type.
export const GEOMETRY_TYPES = ['LINE', 'CIRCLE', 'ARC', 'OTHER_CURVE', 'PLANE', 'CYLINDER', 'CONE', 'SPHERE', 'TORUS',
  'REVOLVED', 'EXTRUDED', 'OTHER_SURFACE', 'ALL_MESH', 'MIXED_MESH', 'MESH']; // query.fs GeometryType, std order
const MESH_TYPES = ['ALL_MESH', 'MIXED_MESH', 'MESH'];
function hasGeometryType(row, type, loc) {
  if (MESH_TYPES.includes(type)) return false;
  const body = row.record.body;
  if (row.record.kind !== 'solid') unsupported('qGeometry over sketch bodies is not implemented', loc);
  if (row.kind === 'body') unsupported(`qGeometry(..., GeometryType.${type}) over bodies is not implemented (the docs give a body no geometry type besides the mesh types)`, loc);
  return geometryType(row, loc) === type;
}
function geometryType(row, loc) {
  const body = row.record.body;
  if (row.kind === 'face') {
    const type = { plane: 'PLANE', cylinder: 'CYLINDER', cone: 'CONE', sphere: 'SPHERE', torus: 'TORUS' }[body.faces[row.index].surface.type];
    if (!type) unsupported(`qGeometry: face ${row.index} of body ${body.id} has a ${body.faces[row.index].surface.type} carrier`, loc);
    return type;
  }
  if (row.kind === 'edge') {
    if (isMeshBody(body)) refuseMeshBody(body, 'qGeometry over its edges', loc);
    const edge = body.edges[row.index], curve = edge.curve.type ?? edge.curve;
    if (curve === 'line') return 'LINE';
    if (curve === 'ellipse') return 'OTHER_CURVE';
    if (curve !== 'circle') unsupported(`qGeometry: edge ${row.index} of body ${body.id} has a ${curve} curve`, loc);
    if (edge.start !== edge.end) return 'ARC';
    if (edge.curveRange) unsupported(`qGeometry: circle edge ${row.index} of body ${body.id} has one vertex and a parameter range (the kernel rejects that edge)`, loc);
    return 'CIRCLE';
  }
  unsupported(`qGeometry over ${row.kind} entities is not implemented (the docs give them no geometry type)`, loc);
}

// std query.fs qClosestTo(queryToFilter, point): the entity closest to the
// point; a tie resolves to every entity within TOLERANCE.zeroLength of the
// closest. Distances are computed in Bend reals; each carries an uncertainty u
// of the arithmetic margin plus the body's source allowance (an imported
// Onshape body's vertex tolerance, 3e-4 mm, dominates it). An entity is in
// when its distance is at most every other entity's distance plus zeroLength
// for every value in the intervals: d + u <= lo' + zeroLength, with lo' the
// smallest d - u of the OTHER entities (none: in). It is out when some other
// entity is certainly closer by more than zeroLength: d - u > hi' +
// zeroLength, with hi' the smallest d + u of the others. In between the tie
// is undecided and refuses by name. A single entity, or one whose upper bound
// lies below every other lower bound, is therefore always kept, whatever u is;
// a real tie needs 2u <= zeroLength to be decided.
// - vertex: the distance to its point;
// - line edge: to the segment between its vertices;
// - circle edge: sqrt(h^2 + (rho - r)^2) with h the height over the circle's
//   plane and rho the radius of the point's projection, when that projection's
//   angle lies in the edge's range (a full circle always); otherwise, and
//   always as a candidate, its end vertices (the distance along a circle has
//   one minimum and one maximum, so outside the range it falls to an end);
// - planar or cylindrical face: the foot of the point on the carrier (the
//   projection, resp. the radial foot) classified by the Bend face classifier;
//   Inside or Boundary gives the carrier distance, Outside the closest of its
//   boundary edges (a face without an interior critical point takes its
//   minimum on the boundary).
// Ellipse edges, other faces, bodies, a point on a cylinder's axis and
// certified meshes refuse by name.
function closestTo(engine, rows, point, loc) {
  if (rows.some(r => isRustBody(r.record.body))) return closestRustEdges(engine.kernel, rows, point, loc);
  if (!rows.length) return rows;
  const B = bendServices(engine, 'qClosestTo', loc);
  const { R, G, I } = B;
  const q = realVector(vectorNumbers(point, 1, 3, loc));
  const lengthOf = v => R('sqrt')(G('dot')(v, v));
  const pointDistance = p => lengthOf(G('sub')(q, p));
  const scaleOf = (...values) => values.reduce((s, v) => R('max')(s, v.$ === 'V3' ? I('magnitude')(v) : R('abs')(v)), R('from_f32')(1));
  const vertex = (body, index) => realVector(body.vertices[index]);
  const segment = (a, b) => {
    const d = G('sub')(b, a), length2 = G('dot')(d, d);
    let t = R('div')(G('dot')(G('sub')(q, a), d), length2);
    if (R('less')(t, B.zero)) t = B.zero;
    if (R('less')(R('from_f32')(1), t)) t = R('from_f32')(1);
    return pointDistance(G('add')(a, G('scale')(d, t)));
  };
  const edgeDistance = (row, body, index) => {
    const edge = body.edges[index], c = edge.curve, type = c.type ?? c;
    const a = vertex(body, edge.start), b = vertex(body, edge.end);
    if (type === 'line') return { d: segment(a, b), scale: scaleOf(q, a, b) };
    if (type !== 'circle') unsupported(`qClosestTo over a ${type} edge is not implemented`, loc);
    const center = realVector(c.origin), n = G('normalize')(realVector(c.normal)), x = G('normalize')(realVector(c.x)), r = real(c.radius);
    const rel = G('sub')(q, center), h = G('dot')(rel, n), radial = G('sub')(rel, G('scale')(n, h)), rho = lengthOf(radial);
    const scale = scaleOf(q, center, r);
    const onCurve = R('sqrt')(R('add')(R('mul')(h, h), R('mul')(R('sub')(rho, r), R('sub')(rho, r))));
    if (edge.start === edge.end) return { d: onCurve, scale };
    if (!edge.curveRange) unsupported(`qClosestTo: arc edge ${index} of body ${body.id} has no parameter range`, loc);
    // The projection's angle, lifted into [first, first + 2 pi).
    const ends = R('min')(pointDistance(a), pointDistance(b));
    if (!R('less')(I('guard')(scale), rho)) return { d: ends, scale }; // on the axis: every point of the arc is equally far
    const angle = R('atan2')(G('dot')(radial, G('cross')(n, x)), G('dot')(radial, x));
    return { d: withinRange(B, angle, edge.curveRange) ? R('min')(onCurve, ends) : ends, scale };
  };
  const faceDistance = (row, body) => {
    const surface = body.faces[row.index].surface;
    const { solid, domains, sourceBudget } = B.input(row.record);
    const tolerance = intersectionTolerance();
    let foot, d, classify;
    if (surface.type === 'plane') {
      const o = realVector(surface.origin), n = G('normalize')(realVector(surface.normal));
      const h = G('dot')(G('sub')(q, o), n);
      foot = G('sub')(q, G('scale')(n, h)); d = R('abs')(h); classify = B.F.classify;
    } else if (surface.type === 'cylinder') {
      const o = realVector(surface.origin), axis = G('normalize')(realVector(surface.axis)), r = real(surface.radius);
      const rel = G('sub')(q, o), radial = G('sub')(rel, G('scale')(axis, G('dot')(rel, axis))), rho = lengthOf(radial);
      if (!R('less')(I('guard')(scaleOf(q, o, r)), rho)) unsupported(`qClosestTo: the point lies on the axis of cylindrical face ${row.index} of body ${body.id} (every generator is equally far)`, loc);
      foot = G('add')(G('sub')(q, radial), G('scale')(radial, R('div')(r, rho))); d = R('abs')(R('sub')(rho, r));
      classify = B.solidClassifier['cylinder-classification.classify'];
    } else unsupported(`qClosestTo over a ${surface.type} face is not implemented (Bend face classification covers plane and cylinder faces)`, loc);
    const state = classify(solid, row.index, domains, foot, tolerance, sourceBudget);
    if (state.$ === 'Unresolved') unsupported(`qClosestTo: ${surface.type} face ${row.index} of body ${body.id}: classification unresolved (${state.reason.$})`, loc);
    if (state.$ === 'Inside' || state.$ === 'Boundary') return { d, scale: scaleOf(q, foot) };
    const boundary = [...new Set(faceEdges(body, row.index))].map(index => edgeDistance(row, body, index));
    return boundary.reduce((best, next) => R('less')(next.d, best.d) ? next : best);
  };
  const measured = rows.map(row => {
    const body = row.record.body;
    if (row.record.kind !== 'solid') unsupported('qClosestTo over sketch bodies is not implemented', loc);
    if (isMeshBody(body)) refuseMeshBody(body, `qClosestTo over its ${row.kind === 'body' ? 'body' : `${row.kind}s`} (it has no exact boundary)`, loc);
    let result;
    if (row.kind === 'vertex') { const p = vertex(body, row.index); result = { d: pointDistance(p), scale: scaleOf(q, p) }; }
    else if (row.kind === 'edge') result = edgeDistance(row, body, row.index);
    else if (row.kind === 'face') result = faceDistance(row, body);
    else unsupported(`qClosestTo over ${row.kind} entities is not implemented`, loc);
    const u = B.margin(result.scale, B.input(row.record).sourceBudget);
    return { row, d: result.d, lo: R('sub')(result.d, u), hi: R('add')(result.d, u) };
  });
  // The bounds of every other entity: the smallest and the second smallest
  // over all, so an entity is never compared with its own interval (its own
  // d - u would make it undecided against itself whenever 2u > zeroLength).
  const smallestTwo = key => measured.reduce(([first, second], m, index) => {
    if (first === null || R('less')(m[key], measured[first][key])) return [index, first];
    if (second === null || R('less')(m[key], measured[second][key])) return [first, index];
    return [first, second];
  }, [null, null]);
  const [loFirst, loSecond] = smallestTwo('lo'), [hiFirst, hiSecond] = smallestTwo('hi');
  const others = (index, first, second, key) => { const at = index === first ? second : first; return at === null ? null : measured[at][key]; };
  const zeroLength = real(ZERO_LENGTH_MM);
  return measured.filter((m, index) => {
    const lo = others(index, loFirst, loSecond, 'lo'), hi = others(index, hiFirst, hiSecond, 'hi');
    if (lo === null || !R('less')(R('add')(lo, zeroLength), m.hi)) return true;
    if (R('less')(R('add')(hi, zeroLength), m.lo)) return false;
    const at = m.row;
    unsupported(`qClosestTo: whether ${at.kind} ${at.index} of body ${at.record.body.id} ties with the closest within TOLERANCE.zeroLength (${ZERO_LENGTH_MM} mm) is undecided at the arithmetic margin`, loc);
  }).map(m => m.row);
}
// std query.fs qParallelEdges(queryToFilter, direction is Vector): "all
// linear edges in queryToFilter which are parallel (or anti-parallel) to the
// given direction"; qParallelEdges(queryToFilter, edges is Query): the same
// against "any linear edge in edges". Entities that are not linear edges
// (faces, bodies, circles, ellipses) are not selected, and non-linear
// reference edges give no direction. A line's direction is its carrier's
// (analytic.mjs Line direction) or, for a plain segment, end minus start
// vertex. Each pair is decided like plane_plane decides plane normals:
// 1. Exact yes: intersections.parallel_certificate (the exact cross product
//    of the stored words is zero).
// 2. Rounding: the sine between the unit directions is at most the kernel's
//    angular guard (intersections.bend angular_guard, 1e-12): one direction
//    computed on two paths (FeatureScript binary64, kernel F32x2) differs by
//    a few units of 2^-48, far below it. std TOLERANCE.zeroAngle is 1e-11,
//    so such a pair is parallel for Onshape too.
// 3. Exact no: the sine exceeds the kernel's default angular tolerance 1e-10
//    plus the guard (the bound plane_plane's CrossingPlanes uses).
// In between refuses by name: Onshape publishes no tolerance for this query.
// Edges of certified meshes refuse (owned() already refuses to list them).
const ANGULAR_TOLERANCE = 1e-10; // intersectionTolerance() default
function parallelEdges(engine, rows, reference, loc) {
  const lineDirection = row => {
    const body = row.record.body;
    if (row.record.kind !== 'solid') unsupported('qParallelEdges over sketch bodies is not implemented', loc);
    if (row.kind !== 'edge') return null;
    if (isMeshBody(body)) refuseMeshBody(body, 'qParallelEdges over its edges', loc);
    const edge = body.edges[row.index], c = edge.curve;
    if ((c.type ?? c) !== 'line') return null;
    if (c.direction) return realVector(c.direction);
    const [a, b] = [body.vertices[edge.start], body.vertices[edge.end]];
    return realVector(b.map((v, i) => v - a[i]));
  };
  const lines = rows.map(row => ({ row, direction: lineDirection(row) })).filter(line => line.direction);
  if (!lines.length) return [];
  const references = reference instanceof TopologyQuery
    ? resolveTopology(engine, reference, loc).map(lineDirection).filter(Boolean)
    : [realVector(vectorNumbers(reference, 0, 3, loc))];
  if (!references.length) return [];
  const B = bendServices(engine, 'qParallelEdges', loc);
  const { R, G, I } = B;
  const guard = I('angular_guard')(), crossing = R('add')(real(ANGULAR_TOLERANCE), guard);
  const parallel = (line, direction) => {
    if (I('parallel_certificate')(true, line.direction, direction)) return true;
    const c = G('cross')(G('normalize')(line.direction), G('normalize')(direction)), sine = R('sqrt')(G('dot')(c, c));
    if (!R('less')(guard, sine)) return true;
    if (R('less')(crossing, sine)) return false;
    const { row } = line;
    unsupported(`qParallelEdges: edge ${row.index} of body ${row.record.body.id} is within ${ANGULAR_TOLERANCE} rad of parallel to the reference but neither certified parallel nor within the kernel's angular guard (Onshape publishes no tolerance for this query)`, loc);
  };
  // Every reference is decided (no short cut), so an undecided pair refuses whatever the order.
  return lines.filter(line => references.map(direction => parallel(line, direction)).includes(true)).map(line => line.row);
}
const faceEdges = (body, index) => body.faces[index].loops.flatMap(loop => (loop.uses ?? loop).map(use => use.edge));
// Topology wonky stores that an Onshape (Parasolid) body does not have. A
// periodic face (cylinder, cone, sphere, torus) is closed in wonky by a seam
// edge that the face uses twice, once in each direction (kernel/analytic.bend
// with_seams, frustum), and a closed circle or ellipse edge starts and ends at
// a seam vertex (analytic.mjs periodic_vertex). Onshape's periodic faces have
// no seam edge and its closed edges no vertex, so qOwnedByBody and qAdjacent
// leave both out: a seam vertex is the vertex of a closed edge that no open,
// non-seam edge ends at. A vertex that only seam edges reach (the pole of a
// revolved sphere, the apex of a cone) is singular: whether Onshape has a
// vertex there is not documented, so a vertex query over its body refuses.
const topologyCache = new WeakMap();
function wonkyTopology(body) {
  if (!topologyCache.has(body)) {
    const uses = new Map();
    body.faces.forEach((face, index) => (face.loops ?? []).forEach(loop => (loop.uses ?? loop).forEach(use => {
      if (!uses.has(use.edge)) uses.set(use.edge, []);
      uses.get(use.edge).push({ face: index, forward: use.forward });
    })));
    const seamEdges = new Set([...uses].filter(([, list]) => list.length === 2 && list[0].face === list[1].face && list[0].forward !== list[1].forward).map(([edge]) => edge));
    const open = new Set(body.edges.flatMap((edge, index) => seamEdges.has(index) || edge.start === edge.end ? [] : [edge.start, edge.end]));
    const closed = new Set(body.edges.flatMap(edge => edge.start === edge.end ? [edge.start] : []));
    const others = body.vertices.map((_, index) => index).filter(index => !open.has(index));
    topologyCache.set(body, { seamEdges, seamVertices: new Set(others.filter(index => closed.has(index))), singularVertices: others.filter(index => !closed.has(index)) });
  }
  return topologyCache.get(body);
}
function owned(engine, rows, type, loc) {
  const kind = { VERTEX: 'vertex', EDGE: 'edge', FACE: 'face' }[type instanceof EnumValue && type.enumType === 'EntityType' ? type.name : ''];
  if (!kind) (type instanceof EnumValue && type.enumType === 'EntityType' ? unsupported : raise)('Expected EntityType.VERTEX, EntityType.EDGE or EntityType.FACE', loc);
  return rows.filter(row => row.record.kind === 'solid').flatMap(({ record }) => {
    if (isRustBody(record.body)) {
      // Only the planar audited topology is exposed here. Analytic periodic
      // carriers will need canonical seam filtering before this can grow.
      const m = measureRustBody(engine.kernel, record.body);
      const count = m.topology[{ vertex: 'vertices', edge: 'edges', face: 'faces' }[kind]];
      return Array.from({ length: count }, (_, index) => ({ record, kind, index }));
    }
    // A certified mesh has faces (its patches on exact carriers) but no exact
    // edges or vertices: an empty list would be a silent wrong answer.
    if (kind !== 'face' && isMeshBody(record.body)) refuseMeshBody(record.body, kind === 'edge' ? 'An edge query' : 'A vertex query', loc);
    if (kind === 'face') return record.body.faces.map((_, index) => ({ record, kind, index }));
    const { seamEdges, seamVertices, singularVertices } = wonkyTopology(record.body);
    if (kind === 'vertex' && singularVertices.length) unsupported(`A vertex query over body ${record.body.id}: vertex ${singularVertices[0]} ends only seam edges (a pole or apex); whether Onshape has a vertex there is not documented`, loc);
    const [list, seams] = kind === 'edge' ? [record.body.edges, seamEdges] : [record.body.vertices, seamVertices];
    return list.flatMap((_, index) => seams.has(index) ? [] : [{ record, kind, index }]);
  });
}
// The corner points of an entity of a polyhedral body (and of a vertex of any
// body): its box is theirs.
function points(row, loc) {
  if (row.record.kind !== 'solid') unsupported('This evaluator requires solid-body geometry', loc);
  const { body } = row.record;
  if (row.kind === 'body') return body.vertices;
  if (row.kind === 'vertex') return [body.vertices[row.index]];
  if (row.kind === 'edge') {
    const e = body.edges[row.index]; return [body.vertices[e.start], body.vertices[e.end]];
  }
  if (row.kind !== 'face') unsupported(`The points of a ${row.kind} entity are not implemented`, loc);
  return body.faces[row.index].loops[0].map(use => {
    const edge = body.edges[use.edge]; return body.vertices[use.forward ? edge.start : edge.end];
  });
}
const lengthVector = xyz => new Vector(xyz.map(v => new Quantity(v / 1000)));

export function queryBuiltins(engine) {
  const context = (value, loc) => { if (!value?.engine || value.engine.context !== value) raise('Invalid modeling context', loc); return value.engine; };
  const resolve = (c, query, loc) => resolveTopology(context(c, loc), query, loc);
  // Input adaptation only: carrier evaluation, orientation and local extrema
  // belong to kernel/evaluate.bend. A native-only backend refuses explicitly.
  const evaluationServices = (name, loc) => {
    if (!engine.services?.evaluator) unsupported(name + ': BendEvaluationUnavailable', loc);
    return engine.services;
  };
  const curveInput = (c, query, name, loc) => {
    const row = resolve(c, query, loc)[0];
    if (!row || row.kind !== 'edge') raise(name + ' expects an edge', loc);
    if (isMeshBody(row.record.body)) refuseMeshBody(row.record.body, name, loc);
    if (row.record.kind !== 'solid') unsupported(name + ': SolidEdgeRequired', loc);
    const services = evaluationServices(name, loc);
    const input = classificationInput(row.record.body, services.faceClassifier);
    if (!input.solid) unsupported(name + ': InvalidEdgeGeometry', loc);
    return { ...input, index: row.index, services };
  };
  return {
    // std enums in std member order (query.fs:268 BodyType, query.fs:295
    // EntityType, booleanoperationtype.gen.fs, propertytype.gen.fs): the first
    // member is the implied dialog default of an enum parameter
    // (Interpreter.dialogDefault), so each wonky subset starts with it.
    EntityType: enumSet('EntityType', ['VERTEX', 'EDGE', 'FACE', 'BODY']),
    BodyType: enumSet('BodyType', ['SOLID', 'SHEET', 'WIRE'], ['POINT', 'MATE_CONNECTOR', 'COMPOSITE']), // query.fs:268
    BooleanOperationType: enumSet('BooleanOperationType', ['UNION', 'SUBTRACTION', 'INTERSECTION']),
    PropertyType: enumSet('PropertyType', ['NAME', 'APPEARANCE', 'DESCRIPTION'], ['MATERIAL', 'PART_NUMBER', 'VENDOR', 'PROJECT', 'PRODUCT_LINE',
      'TITLE_1', 'TITLE_2', 'TITLE_3', 'EXCLUDE_FROM_BOM', 'CUSTOM', 'MASS_OVERRIDE', 'REVISION']), // propertytype.gen.fs
    // clashtype.gen.fs, std member order.
    ClashType: enumSet('ClashType', ['NONE', 'INTERFERE', 'EXISTS', 'ABUT_NO_CLASS', 'ABUT_TOOL_IN_TARGET', 'ABUT_TOOL_OUT_TARGET', 'TARGET_IN_TOOL', 'TOOL_IN_TARGET']),
    AdjacencyType: enumSet('AdjacencyType', ['VERTEX', 'EDGE']), // query.fs:315
    ChamferType: enumSet('ChamferType', ['EQUAL_OFFSETS', 'TWO_OFFSETS', 'OFFSET_ANGLE', 'RAW_OFFSET']), // chamfertype.gen.fs
    DraftType: enumSet('DraftType', ['NEUTRAL_PLANE', 'REFERENCE_ENTITY', 'REFERENCE_SURFACE']), // drafttype.gen.fs
    // std query.fs qAdjacent(seed, adjacencyType[, entityType]); see adjacent().
    qAdjacent: builtin('qAdjacent', 2, 3, ([query, adjacencyType, entityType], loc) => {
      if (isRegionQuery(query)) refuseRegionQuery('qAdjacent', loc);
      if (!(query instanceof TopologyQuery)) raise('qAdjacent expects a topology Query', loc);
      if (!(adjacencyType instanceof EnumValue && adjacencyType.enumType === 'AdjacencyType')) raise('qAdjacent expects an AdjacencyType', loc);
      if (entityType !== undefined && !(entityType instanceof EnumValue && entityType.enumType === 'EntityType')) raise('qAdjacent expects an EntityType', loc);
      // query.fs preconditions of the three-argument form.
      if (enumIs(entityType, 'EntityType', 'BODY')) raise('qAdjacent cannot return bodies', loc);
      if (enumIs(adjacencyType, 'AdjacencyType', 'EDGE') && enumIs(entityType, 'EntityType', 'VERTEX')) raise('Entities cannot have AdjacencyType.EDGE with vertices, use AdjacencyType.VERTEX instead', loc);
      return new TopologyQuery('adjacent', { query, adjacencyType, entityType });
    }),
    // opFillet and opChamfer: src/fillet-fs.mjs (registered by src/library.mjs).
    qCreatedBy: builtin('qCreatedBy', 2, 2, ([id, entityType], loc) => {
      if (!(id instanceof Id) || !(entityType instanceof EnumValue) || entityType.enumType !== 'EntityType') raise('qCreatedBy expects an Id and EntityType', loc);
      return new TopologyQuery('created', { id, entityType });
    }),
    qAllModifiableSolidBodies: builtin('qAllModifiableSolidBodies', 0, 0, () => new TopologyQuery('allSolid')),
    // std query.fs qUnion(subqueries is array) and qUnion(query1, ..., query4).
    qUnion: builtin('qUnion', 1, 4, (args, loc) => {
      const queries = args.length === 1 ? args[0] : args;
      if (!Array.isArray(queries) || (args.length > 1 && Array.isArray(args[0]))) raise('qUnion expects an array of queries or two to four queries', loc);
      const regions = regionOperands('qUnion', queries, loc);
      if (regions) return new RegionQuery('union', { queries: regions });
      if (!queries.every(q => q instanceof TopologyQuery)) raise('qUnion expects an array of topology queries', loc);
      return new TopologyQuery('union', { queries });
    }),
    qSubtraction: builtin('qSubtraction', 2, 2, ([a, b], loc) => {
      const regions = regionOperands('qSubtraction', [a, b], loc);
      return regions ? new RegionQuery('subtract', { a: regions[0], b: regions[1] }) : new TopologyQuery('subtract', { a, b });
    }),
    // std query.fs qNothing(): an empty query.
    qNothing: builtin('qNothing', 0, 0, () => new TopologyQuery('union', { queries: [] })),
    qEverything: builtin('qEverything', 0, 1, ([entityType], loc) => {
      if (entityType !== undefined && !(entityType instanceof EnumValue && entityType.enumType === 'EntityType')) raise('qEverything expects an EntityType', loc);
      return new TopologyQuery('everything', { entityType });
    }),
    // std query.fs qIntersection(subqueries is array) and qIntersection(query1, query2).
    qIntersection: builtin('qIntersection', 1, 2, (args, loc) => {
      const queries = args.length === 2 ? args : args[0];
      const regions = Array.isArray(queries) ? regionOperands('qIntersection', queries, loc) : null;
      if (regions) return new RegionQuery('intersection', { queries: regions });
      if (!Array.isArray(queries) || !queries.every(q => q instanceof TopologyQuery)) raise('qIntersection expects topology queries', loc);
      return new TopologyQuery('intersection', { queries });
    }),
    qContainsPoint: builtin('qContainsPoint', 2, 2, ([query, point], loc) => {
      if (isRegionQuery(query)) return regionRefusal('qContainsPoint', 'sketch-region/point-selection-needs-rust-kernel', 'qContainsPoint over sketch regions is decided by the Rust kernel only',
        'Run with WONKY_BACKEND=rust (the wonky CLI default backend).', loc);
      if (!(query instanceof TopologyQuery)) raise('qContainsPoint expects a topology Query', loc);
      vectorNumbers(point, 1, 3, loc);
      return new TopologyQuery('containsPoint', { query, point });
    }),
    // std query.fs qCoincidesWithPlane / qGeometry / qClosestTo; see
    // coincidesWithPlane(), hasGeometryType() and closestTo().
    GeometryType: enumSet('GeometryType', GEOMETRY_TYPES),
    qCoincidesWithPlane: builtin('qCoincidesWithPlane', 2, 2, ([query, plane], loc) => {
      if (isRegionQuery(query)) refuseRegionQuery('qCoincidesWithPlane', loc);
      if (!(query instanceof TopologyQuery)) raise('qCoincidesWithPlane expects a topology Query', loc);
      if (!(plane instanceof Plane)) raise('qCoincidesWithPlane expects a Plane', loc);
      return new TopologyQuery('coincidesWithPlane', { query, plane });
    }),
    qGeometry: builtin('qGeometry', 2, 2, ([query, geometryType], loc) => {
      if (!(query instanceof TopologyQuery) && !isRegionQuery(query)) raise('qGeometry expects a topology Query', loc);
      if (!(geometryType instanceof EnumValue && geometryType.enumType === 'GeometryType')) raise('qGeometry expects a GeometryType', loc);
      // Every sketch region is a planar face: PLANE keeps the set, any other type keeps nothing.
      if (isRegionQuery(query)) return enumIs(geometryType, 'GeometryType', 'PLANE') ? query : new RegionQuery('nothing');
      return new TopologyQuery('geometry', { query, geometryType });
    }),
    qClosestTo: builtin('qClosestTo', 2, 2, ([query, point], loc) => {
      if (isRegionQuery(query)) return regionRefusal('qClosestTo', 'sketch-region/point-selection-needs-rust-kernel', 'qClosestTo over sketch regions is decided by the Rust kernel only',
        'Run with WONKY_BACKEND=rust (the wonky CLI default backend).', loc);
      if (!(query instanceof TopologyQuery)) raise('qClosestTo expects a topology Query', loc);
      vectorNumbers(point, 1, 3, loc); // query.fs precondition is3dLengthVector(point)
      return new TopologyQuery('closestTo', { query, point });
    }),
    // std query.fs qParallelEdges(queryToFilter, direction | edges); see
    // parallelEdges(). The one-argument form is @internal in std ("Unconventional
    // semantics, not for general use") and refuses by name.
    qParallelEdges: builtin('qParallelEdges', 1, 2, ([query, reference], loc) => {
      // Regions as the reference `edges` too: that is a valid std call, not a
      // (try-catchable) type error.
      if (isRegionQuery(query) || isRegionQuery(reference)) refuseRegionQuery('qParallelEdges', loc);
      if (!(query instanceof TopologyQuery)) raise('qParallelEdges expects a topology Query', loc);
      if (reference === undefined) unsupported('qParallelEdges(referenceEdges) is internal to std (query.fs: "Unconventional semantics, not for general use") and not implemented; use qParallelEdges(queryToFilter, direction) or qParallelEdges(queryToFilter, edges)', loc);
      if (reference instanceof Vector) {
        // query.fs precondition @size(direction) == 3; normalize() rejects a zero vector.
        if (reference.items.length !== 3) raise('qParallelEdges expects a 3D direction Vector', loc);
        // Any one unit (std normalize divides it out): unitless or lengths, not mixed.
        const units = new Set(reference.items.map(x => x instanceof Quantity ? `${x.dimension}:${x.angle}` : '0:0'));
        const numbers = reference.items.map(x => x instanceof Quantity ? x.value : x);
        if (units.size !== 1 || !numbers.every(Number.isFinite)) raise('qParallelEdges expects a direction Vector of numbers or of one unit', loc);
        if (numbers.every(x => x === 0)) raise('qParallelEdges: the direction is a zero vector', loc);
        return new TopologyQuery('parallelEdges', { query, reference: new Vector(numbers) });
      }
      if (!(reference instanceof TopologyQuery)) raise('qParallelEdges expects a direction Vector or an edge Query', loc);
      return new TopologyQuery('parallelEdges', { query, reference });
    }),
    makeRobustQuery: builtin('makeRobustQuery', 2, 2, ([c, query], loc) => {
      const rows = resolve(c, query, loc);
      if (rows.some(row => row.kind !== 'body')) unsupported('makeRobustQuery over faces or edges is not implemented', loc);
      const owner = context(c, loc);
      return new TopologyQuery('robust', { rows, owner, firstLaterRecord: owner.nextRecord });
    }),
    qBodyType: builtin('qBodyType', 2, 2, ([query, bodyType], loc) => {
      if (isRegionQuery(query)) refuseRegionQuery('qBodyType', loc);
      return new TopologyQuery('bodyType', { query, bodyType });
    }),
    qOwnedByBody: builtin('qOwnedByBody', 2, 2, ([query, entityType], loc) => {
      // Regions as the `body` of std qOwnedByBody(queryToFilter, body) too.
      if (isRegionQuery(query) || isRegionQuery(entityType)) refuseRegionQuery('qOwnedByBody', loc);
      return new TopologyQuery('owned', { query, entityType });
    }),
    // std query.fs qEntityFilter(query, entityType): the entities of that type in
    // the query. A sketch region is a face: FACE keeps the set; a region has no
    // edge, vertex or body of its own in the set, so those keep nothing.
    qEntityFilter: builtin('qEntityFilter', 2, 2, ([query, entityType], loc) => {
      if (!(entityType instanceof EnumValue && entityType.enumType === 'EntityType')) raise('qEntityFilter expects an EntityType', loc);
      if (isRegionQuery(query)) return enumIs(entityType, 'EntityType', 'FACE') ? query : new RegionQuery('nothing');
      if (query instanceof TopologyQuery) return regionRefusal('qEntityFilter', 'query/entity-filter-topology-not-implemented', 'qEntityFilter over topology queries is not implemented',
        'Use qEverything(entityType), qOwnedByBody(query, entityType) or qAdjacent(query, ..., entityType) to select entities of one type.', loc);
      return raise('qEntityFilter expects a Query', loc);
    }),
    // std query.fs qNthElement(query, n): zero-based, negative n counts from the
    // end, "deterministic but arbitrary" order. Onshape's order is not
    // reproducible, so a set of regions is decided only when it has one member.
    qNthElement: builtin('qNthElement', 2, 2, ([query, n], loc) => {
      if (!Number.isInteger(n)) raise('qNthElement expects an integer index', loc);
      if (isRegionQuery(query)) return new RegionQuery('nth', { query, n, loc });
      if (query instanceof TopologyQuery) return regionRefusal('qNthElement', 'query/nth-element-topology-not-implemented', 'qNthElement over topology queries is not implemented',
        'Select the entity with a geometric query such as qClosestTo(query, point) or qContainsPoint(query, point).', loc);
      return raise('qNthElement expects a Query', loc);
    }),
    evaluateQuery: builtin('evaluateQuery', 2, 2, ([c, query], loc) => {
      return resolve(c, query, loc).map(row => new TopologyQuery('reference', { rows: [row], owner: context(c, loc) }));
    }),
    getProperty: builtin('getProperty', 2, 2, ([c, definition], loc) => {
      const rows = resolve(c, definition.entity, loc);
      if (rows.length !== 1) raise('getProperty expects one entity', loc);
      if (rows[0].kind !== 'body' || rows[0].record.kind !== 'solid') unsupported('getProperty is implemented for solid bodies only', loc);
      if (enumIs(definition.propertyType, 'PropertyType', 'NAME')) return rows[0].record.name ?? rows[0].record.body.name ?? rows[0].record.body.id;
      if (enumIs(definition.propertyType, 'PropertyType', 'APPEARANCE')) return rows[0].record.appearance ?? rows[0].record.body.appearance;
      // Onshape's default part description is empty.
      if (enumIs(definition.propertyType, 'PropertyType', 'DESCRIPTION')) return rows[0].record.description ?? rows[0].record.body.description ?? '';
      unsupported('Property type is not implemented', loc);
    }),
    setProperty: builtin('setProperty', 2, 2, ([c, definition], loc) => {
      if (context(c, loc) !== engine || engine.readOnly) fail('Cannot change properties in an imported source context', loc);
      const key = ['NAME', 'APPEARANCE', 'DESCRIPTION'].find(name => enumIs(definition.propertyType, 'PropertyType', name))?.toLowerCase();
      if (!key) unsupported('Property type is not implemented', loc);
      if (key === 'description' && typeof definition.value !== 'string') raise('PropertyType.DESCRIPTION expects a string value', loc);
      for (const row of resolve(c, definition.entities, loc)) {
        if (row.kind !== 'body' || row.record.kind !== 'solid') unsupported('setProperty is implemented for solid bodies only', loc);
        const { record } = row;
        record[key] = definition.value;
        // The record is what a rolled-back sub-feature restores in full
        // (ModelingContext.snapshot). The body's description reads through to
        // it, so an export never sees a description that was rolled back.
        if (key === 'description') Object.defineProperty(record.body, key, { get: () => record.description, enumerable: true, configurable: true });
        else record.body[key] = definition.value;
      }
    }),
    evVolume: builtin('evVolume', 2, 2, ([c, definition], loc) => {
      const rows = resolve(c, definition.entities, loc);
      if (rows.some(row => row.kind !== 'body' || row.record.kind !== 'solid')) unsupported('evVolume is implemented for solid bodies only', loc);
      // A body without a volume of its own (imported, recovered by the hybrid
      // Boolean) is integrated in Bend (src/volume.mjs); its label, bound and
      // method go into the operation evidence, never into body.validation.
      let total = 0;
      const integrated = [];
      for (const row of rows) {
        const body = row.record.body;
        if (body.validation.volumeMm3 !== null) { total += body.validation.volumeMm3; continue; }
        // A certified-mesh body: the carrier method (src/volume.mjs); its mesh
        // estimate (area x deviation) is far above the limit below and refuses.
        if (body.geometry !== 'analytic' && !isMeshBody(body)) unsupported('evVolume: this body has no volume and is not an analytic B-rep to integrate', loc);
        const measured = integrateVolume(engine.kernel, body, { loc });
        if (!(measured.relativeBound <= VOLUME_RELATIVE_LIMIT)) {
          unsupported(`evVolume: the integrated volume's relative bound ${measured.relativeBound.toExponential(2)} exceeds ${VOLUME_RELATIVE_LIMIT}${measured.carrierRefusal ? ` (${measured.label}; ${measured.carrierRefusal})` : ''}`, loc);
        }
        total += measured.volumeMm3;
        integrated.push({ body, measured });
      }
      if (integrated.length) {
        const at = loc?.line ? `${loc.line}:${loc.column}` : 'unknown';
        engine.operationEvidence.push(operationEvidence(`evVolume@${at}`, 'evVolume', integrated.map(({ body }) => body), engine.modelingPolicy, {
          method: 'integrated volume (kernel/volume.bend)', status: 'Resolved',
          volumes: integrated.map(({ body, measured }) => ({ bodyId: body.id, volumeMm3: measured.volumeMm3, boundMm3: measured.boundMm3,
            relativeBound: measured.relativeBound, label: measured.label, method: measured.method, boundRule: measured.boundRule })),
        }));
      }
      return new Quantity(total * 1e-9, 3);
    }),
    evCollision: builtin('evCollision', 2, 2, (_args, loc) => unsupported('evCollision requires the Rust host port', loc)),
    evDistance: builtin('evDistance', 2, 2, (_args, loc) => unsupported('evDistance requires the Rust host port', loc)),
    evBox3d: builtin('evBox3d', 2, 2, ([c, definition], loc) => {
      if (definition.tight !== undefined && typeof definition.tight !== 'boolean') raise('evBox3d.tight must be boolean', loc);
      if (definition.cSys !== undefined && !matchesType(definition.cSys, 'CoordSystem')) raise('evBox3d.cSys must be a CoordSystem', loc);
      const rows = resolve(c, definition.topology, loc);
      const mesh = rows.find(row => isMeshBody(row.record.body));
      if (mesh) refuseMeshBody(mesh.record.body, 'evBox3d (a tight box of the exact solid)', loc);
      // A vertex is its point on any body; an analytic body has its tight
      // bounds; its faces and edges would need their curved extremes.
      const byPoints = row => row.kind === 'vertex' || row.record.body.geometry !== 'analytic';
      if (definition.cSys !== undefined) {
        if (rows.some(row => !byPoints(row))) unsupported('evBox3d: AnalyticLocalBoundsUnsupported', loc);
        const { evaluator } = evaluationServices('evBox3d', loc);
        const cs = definition.cSys;
        const bounds = evaluator.local_bounds(list(rows.flatMap(row => points(row, loc)).map(realVector)),
          realVector(vectorNumbers(cs.origin, 1, 3, loc)), realVector(vectorNumbers(cs.xAxis, 0, 3, loc)), realVector(vectorNumbers(cs.zAxis, 0, 3, loc)));
        if (bounds.$ === 'EmptyBounds') raise('Cannot bound an empty query', loc);
        return tagged(map({ minCorner: lengthVector(realCoords(bounds.minimum)), maxCorner: lengthVector(realCoords(bounds.maximum)) }), 'Box3d');
      }
      if (rows.some(row => !byPoints(row) && (row.kind !== 'body' || row.record.body.validation.boundsMm === null))) unsupported('Tight bounds over faces or edges of analytic bodies, or over an analytic body without recorded bounds, are not implemented', loc);
      const all = rows.flatMap(row => byPoints(row) ? points(row, loc) : [row.record.body.validation.boundsMm.min, row.record.body.validation.boundsMm.max]);
      if (!all.length) raise('Cannot bound an empty query', loc);
      return tagged(map({ minCorner: lengthVector([0, 1, 2].map(i => Math.min(...all.map(p => p[i])))), maxCorner: lengthVector([0, 1, 2].map(i => Math.max(...all.map(p => p[i])))) }), 'Box3d'); // box.fs: evBox3d returns Box3d
    }),
    evCurveDefinition: builtin('evCurveDefinition', 2, 2, ([c, definition], loc) => {
      if (definition.returnBSplinesAsOther !== undefined && typeof definition.returnBSplinesAsOther !== 'boolean') raise('evCurveDefinition.returnBSplinesAsOther must be boolean', loc);
      const { solid, index, services } = curveInput(c, definition.edge, 'evCurveDefinition', loc);
      const curve = array(solid.edges)[index].curve;
      // curveGeometry.fs uses nominal Line/Circle/Ellipse tags, not a
      // invented curveType field; CoordSystem stores origin, xAxis, zAxis.
      if (curve.$ === 'Line') {
        // A collapsed polyhedral segment has no line direction. Reuse Bend's
        // carrier check, without requiring a valid trim of an analytic carrier.
        if (!services.faceClassifier['curve-plane.curve_valid'](curve)) unsupported('evCurveDefinition: InvalidGeometry', loc);
        return tagged(map({ origin: lengthVector(realCoords(curve.origin)), direction: new Vector(realCoords(engine.kernel.precise.normalize(curve.direction))) }), 'Line');
      }
      const coordSystem = tagged(map({ origin: lengthVector(realCoords(curve.origin)), xAxis: new Vector(realCoords(curve.x)), zAxis: new Vector(realCoords(curve.normal)) }), 'CoordSystem');
      if (curve.$ === 'Circle') return tagged(map({ coordSystem, radius: new Quantity(realNumber(curve.radius) / 1000) }), 'Circle');
      if (curve.$ === 'Ellipse') return tagged(map({ coordSystem, majorRadius: new Quantity(realNumber(curve.major) / 1000), minorRadius: new Quantity(realNumber(curve.minor) / 1000) }), 'Ellipse');
      unsupported('evCurveDefinition: UnsupportedCarrier', loc);
    }),
    evEdgeTangentLine: builtin('evEdgeTangentLine', 2, 2, ([c, definition], loc) => {
      if (definition.face !== undefined) unsupported('evEdgeTangentLine: FaceOrientationUnsupported', loc);
      if (typeof definition.parameter !== 'number' || !Number.isFinite(definition.parameter) || definition.parameter < 0 || definition.parameter > 1) raise('evEdgeTangentLine.parameter must be in 0..1', loc);
      if (definition.arcLengthParameterization !== undefined && typeof definition.arcLengthParameterization !== 'boolean') raise('evEdgeTangentLine.arcLengthParameterization must be boolean', loc);
      const { solid, domains, sourceBudget, index, services } = curveInput(c, definition.edge, 'evEdgeTangentLine', loc);
      // For lines/circles the natural parameter is already constant-speed.
      // Ellipse evaluation is refused even for false, until its contract is bounded.
      if (array(solid.edges)[index].curve.$ === 'Ellipse') unsupported('evEdgeTangentLine: EllipseArcLengthUnsupported', loc);
      const result = services.evaluator.edge_tangent(solid, index, domains, real(definition.parameter), intersectionTolerance(), sourceBudget);
      if (result.$ !== 'Tangent') unsupported('evEdgeTangentLine: ' + (result.preparation?.reason?.$ ?? result.$), loc);
      return tagged(map({ origin: lengthVector(realCoords(result.origin)), direction: new Vector(realCoords(result.direction)) }), 'Line');
    }),
    evLine: builtin('evLine', 2, 2, ([c, definition], loc) => {
      const rows = resolve(c, definition.edge, loc);
      if (rows.length !== 1 || rows[0].kind !== 'edge') raise('evLine expects one line edge', loc);
      const edge = rows[0].record.body.edges[rows[0].index];
      if (edge.curve !== 'line' && edge.curve.type !== 'line') raise('The selected edge is not a line', loc);
      // evaluate.fs evLine returns a Line (curveGeometry.fs), so 'is Line' and the Line overloads apply.
      if (edge.curve.type === 'line') return tagged(map({ origin: lengthVector(edge.curve.origin), direction: new Vector(edge.curve.direction) }), 'Line');
      const [a, b] = points(rows[0], loc); return tagged(map({ origin: lengthVector(a), direction: new Vector(normalized(sub(b, a), loc)) }), 'Line');
    }),
    opDeleteBodies: builtin('opDeleteBodies', 3, 3, ([c, id, definition], loc) => {
      engine.claim(c, id, loc);
      for (const row of resolve(c, definition.entities, loc)) {
        if (row.kind !== 'body') unsupported('opDeleteBodies of faces or edges is not implemented', loc);
        engine.records.delete(row.record.key);
        if (row.record.kind === 'sketch') row.record.sketch.deleted = true;
      }
    }),
    opTransform: builtin('opTransform', 3, 3, ([c, id, definition], loc) => {
      if (!definition || !Object.hasOwn(definition, 'bodies') || !Object.hasOwn(definition, 'transform')) raise('opTransform requires bodies and transform', loc);
      if (Object.keys(definition).some(key => !['bodies', 'transform'].includes(key))) unsupported('opTransform has an unsupported definition field', loc);
      const source = resolve(c, definition.bodies, loc);
      if (!source.length) unsupported('opTransform bodies resolved to no solids', loc);
      if (source.some(row => row.kind !== 'body' || row.record.kind !== 'solid')) unsupported('opTransform requires solid bodies', loc);
      const transform = definition.transform;
      if (!(transform instanceof Transform) || !(transform.linear?.rows?.length === 3) || transform.linear.rows.some(row => row.length !== 3 || row.some(x => !Number.isFinite(x)))) raise('opTransform expects a 3×3 Transform', loc);
      const rows = transform.linear.rows, offset = vectorNumbers(transform.translation, 1, 3, loc);
      const det = rigidTransformDeterminant(rows);
      if (det === null) unsupported('opTransform supports only rigid transforms and reflections', loc);
      if (source.some(row => isMeshBody(row.record.body))) unsupported('opTransform of a certified mesh is not implemented', loc);
      if (det < 0 && source.some(row => row.record.body.geometry === 'analytic')) unsupported('opTransform reflection of analytic bodies is not implemented', loc);
      engine.claim(c, id, loc);
      // Build all copies before updating the store: an unsupported input does
      // not leave some of the selected bodies transformed and others untouched.
      const copies = source.map(row => {
        const body = row.record.body;
        return (body.geometry === 'analytic' ? transformAnalytic : transformInBend)(engine.kernel, body, body.id, rows, offset);
      });
      source.forEach((row, i) => { row.record.body = copies[i]; row.record.createdBy = new Set([...row.record.createdBy, id.key()]); });
    }),
    opPattern: builtin('opPattern', 3, 3, ([c, id, definition], loc) => {
      engine.claim(c, id, loc);
      const { transforms, instanceNames } = definition;
      if (!Array.isArray(transforms) || !Array.isArray(instanceNames) || transforms.length !== instanceNames.length || new Set(instanceNames).size !== instanceNames.length) raise('opPattern requires matching transforms and unique instanceNames', loc);
      const source = resolve(c, definition.entities, loc);
      if (source.some(row => row.kind !== 'body' || row.record.kind !== 'solid')) unsupported('Only solid-body patterns are implemented', loc);
      const mesh = source.find(row => isMeshBody(row.record.body));
      if (mesh) refuseMeshBody(mesh.record.body, 'opPattern (a rigid copy of a certified mesh is not implemented)', loc);
      // An operation fails as a whole: every transform is checked before the
      // first instance is added, so a caught failure leaves no partial pattern.
      const checked = transforms.map(t => {
        if (!(t instanceof Transform)) raise('Expected a Transform', loc);
        const rows = t.linear.rows;
        const proper = rows.every((row, j) => Math.abs(norm(row) - 1) < 1e-6 && rows.every((other, k) => j === k || Math.abs(dot(row, other)) < 1e-6)) && Math.abs(dot(rows[0], cross(rows[1], rows[2])) - 1) < 1e-6;
        if (!proper) unsupported('Only proper rigid transforms are implemented', loc);
        return { rows, offset: vectorNumbers(t.translation, 1, 3, loc) };
      });
      checked.forEach(({ rows, offset }, i) => {
        for (const row of source) {
          const name = `${id}/${instanceNames[i]}/${row.record.body.id}`;
          const body = row.record.body;
          engine.addSolid(id, (body.geometry === 'analytic' ? transformAnalytic : transformInBend)(engine.kernel, body, name, rows, offset));
        }
      });
    }),
  };
}
