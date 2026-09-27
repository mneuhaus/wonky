// Closed-form measurements over stored analytic parameters (spec 3.3, D11).
// Package: exact-measure. Runs with kernel.precise; the browser only formats.
//
// Frozen signature:
//   measureEntities(model, entities) -> { measurements: [...], unsupported: [...] }
// plus the options this package needs: { kernel, modelId, logical,
// resolveLogical }. `entities` are aliases ('B1.F3', 'B1.L2', 'B1.E4',
// 'B1.V1'), `{ alias, modelId }` or selection references
// `{ modelId, bodyId, entityType, entityIndex }`.
//
// Every pair of entities (in selection order) gets the closed forms of its
// type pair. A row is { quantity, label, value, unit, exactness, toleranceMm,
// angularToleranceRad, method, inputs, note, pair }; relations on unbounded
// supports say so ("supporting planes", "supporting cylinders", "infinite
// lines"). A pair without a closed form gets an unsupported row with its
// reason; entities of another revision are never measured against this one.
import { HttpError } from './http.mjs';
import { bodyExtent } from './edge-classes.mjs';
import {
  ANGULAR_TOLERANCE_RAD, EXACT, PAIR_ANGULAR_RULE, aliasOf, cachedLogicalFaces, edgeEntry,
  exactMath, faceEntry, faceTolerance, locateAlias, logicalGroup, pairAngularTolerance,
  vertexEntry,
} from './geometry.mjs';
import { edgeCoverage, faceCoverage } from './printability.mjs';

export const MEASURE_SCHEMA = 'wonky.viewer-measure/1';
export const MAX_ENTITIES = 8;
export const EXTREMA_REASON = 'general minimum distance between trimmed faces needs kernel extrema';
export const REVISIONS_REASON = 'entities from different revisions';

const SUPPORTING_PLANES = 'supporting planes (trims not considered)';
const SUPPORTING_CYLINDERS = 'supporting cylinders (trims and axial overlap are not considered)';
const INFINITE_LINES = 'infinite lines';
const INPUT_SHAPES = 'Each entity is an alias, { alias, modelId } or a selection reference';
const FACE_TYPES = new Set(['plane', 'cylinder', 'cone']);
// Rows that state a distance between the supporting surfaces of two faces;
// a face pair without one gets the kernel-extrema unsupported row.
const SURFACE_DISTANCES = new Set(['parallelOffset', 'faceToPlaneOffset', 'radialGap',
  'radiusDifference', 'wallThickness', 'minimumRadialClearance', 'cylinderGap', 'surfaceToPlane',
  'signedDistance', 'surfaceDistance', 'faceDistance']);
// Primary row (drawn as the viewport dimension line): the first of these
// length rows for the first pair. Angles and flags are never primary; a pair
// without a length row has no dimension line.
// faceDistance is the exact minimum distance between two trimmed faces, so it
// comes first.
const PRIMARY = ['faceDistance', 'radialGap', 'minimumRadialClearance', 'wallThickness',
  'parallelOffset', 'faceToPlaneOffset', 'distance', 'signedDistance', 'surfaceToPlane',
  'cylinderGap', 'surfaceDistance', 'radiusDifference', 'axisToPlaneDistance', 'axisDistance',
  'lineDistance', 'distanceToAxis', 'distanceToCenter', 'endpointGap'];
const degrees = radians => radians * 180 / Math.PI;
const ORDER = ['point', 'line', 'circle', 'plane', 'cylinder', 'cone'];

// Inputs ---------------------------------------------------------------------

function referenceAlias(model, reference) {
  const bodyIndex = model.bodies.findIndex(body => body.id === reference.bodyId);
  if (bodyIndex < 0) throw new HttpError(404, `Unknown body ${reference.bodyId}`);
  if (reference.entityType === 'body') return aliasOf(bodyIndex);
  if (!['face', 'edge', 'vertex'].includes(reference.entityType)) {
    throw new HttpError(400, `Unknown entity type ${reference.entityType}`);
  }
  return aliasOf(bodyIndex, reference.entityType, reference.entityIndex);
}

function normalizeInput(model, input, modelId) {
  if (typeof input === 'string') return { alias: input, modelId };
  if (!input || typeof input !== 'object') {
    throw new HttpError(400, INPUT_SHAPES);
  }
  const owner = input.modelId ?? modelId;
  if (typeof input.alias === 'string') return { alias: input.alias, modelId: owner };
  if (typeof input.entityType === 'string') {
    if (owner !== modelId) {
      return {
        alias: `${input.bodyId} ${input.entityType} ${input.entityIndex}`, modelId: owner,
      };
    }
    return { alias: referenceAlias(model, input), modelId: owner };
  }
  throw new HttpError(400, INPUT_SHAPES);
}

// Where a face is: the centroid of its boundary vertices and the bounding-box
// diagonal of the face (vertices, plus the exact box of each circle edge:
// half extent r·√(1 − n_i²) per axis). Relations are evaluated at this
// centroid, never at the stored surface origin, which can lie far from the
// face. A face with an edge that is neither a line nor a circle takes the
// extent of its body (a bound that holds for every face of the body); a face
// without vertices has an infinite extent and no box (the decisions fall to the
// precision guard) and keeps the stored origin.
function faceSpread(context, body, faceIndices) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const include = (point, half = [0, 0, 0]) => point.forEach((value, axis) => {
    min[axis] = Math.min(min[axis], value - half[axis]);
    max[axis] = Math.max(max[axis], value + half[axis]);
  });
  const vertices = new Set();
  let bounded = true;
  for (const faceIndex of faceIndices) {
    for (const edgeIndex of new Set((body.faces[faceIndex].loops ?? []).flat().map(use => use.edge))) {
      const edge = body.edges[edgeIndex];
      vertices.add(edge.start);
      vertices.add(edge.end);
      const type = typeof edge.curve === 'string' ? edge.curve : edge.curve?.type;
      if (type === 'circle') {
        const normal = context.math.normalize(edge.curve.normal);
        include(edge.curve.origin, normal.map(value => edge.curve.radius
          * Math.sqrt(Math.max(0, 1 - value * value))));
      } else if (type !== 'line') {
        bounded = false;
      }
    }
  }
  const points = [...vertices].map(vertex => body.vertices[vertex]).filter(Boolean);
  points.forEach(point => include(point));
  if (!points.length) return { centroid: null, extentMm: Infinity, boxMm: null };
  const centroid = [0, 1, 2].map(axis => points.reduce((sum, point) => sum + point[axis], 0)
    / points.length);
  const own = Math.hypot(...max.map((value, axis) => value - min[axis]));
  if (bounded) return { centroid, extentMm: own, boxMm: [min, max] };
  // Every point of the face lies within the body's extent of its vertices.
  const pad = bodyExtent(body);
  return { centroid, extentMm: Math.max(own, pad),
    boxMm: [min.map(value => value - pad), max.map(value => value + pad)] };
}

// Box of a circle: half extent r·√(1 − n_i²) per axis about the center.
const circleBox = (center, normal, radius) => {
  const half = normal.map(value => radius * Math.sqrt(Math.max(0, 1 - value * value)));
  return [center.map((value, axis) => value - half[axis]),
    center.map((value, axis) => value + half[axis])];
};

// Bounding-box diagonal of two entities together (Infinity when one has no
// box): the lever arm over which a relation between them must hold.
function spanOf(a, b) {
  if (!a.boxMm || !b.boxMm) return Infinity;
  return Math.hypot(...[0, 1, 2].map(axis => Math.max(a.boxMm[1][axis], b.boxMm[1][axis])
    - Math.min(a.boxMm[0][axis], b.boxMm[0][axis])));
}

// Geometry of one entity as a measurable primitive. `point` is a point of the
// entity's support near the entity (face centroid projected onto the plane,
// its foot on the axis, a circle center, a line start), `extentMm` the size
// over which a relation evaluated at `point` holds (pairAngularTolerance).
function primitive(context, input, index) {
  const { model, modelId } = context;
  const base = { index, modelId: input.modelId, requested: input.alias };
  if (input.modelId !== modelId) return { ...base, type: 'foreign', label: input.alias };
  const { bodyIndex, kind, index: entityIndex } = locateAlias(model, input.alias);
  const body = model.bodies[bodyIndex];
  const labelled = (label, extra) => ({ ...base, bodyIndex, label, ...extra });
  if (kind === 'body') {
    return labelled(input.alias, { type: 'body',
      unsupported: 'a body has no single closed-form geometry; pick a face, edge or point' });
  }
  if (kind === 'vertex') {
    const entry = vertexEntry(context, bodyIndex, entityIndex);
    return labelled(entry.alias, { type: 'point', point: entry.point,
      toleranceMm: entry.toleranceMm, extentMm: 0, boxMm: [entry.point, entry.point] });
  }
  if (kind === 'edge') {
    const entry = edgeEntry(context, bodyIndex, entityIndex);
    const curve = entry.curve;
    const extra = { toleranceMm: entry.toleranceMm, curve: curve.type };
    if (curve.type === 'line') {
      return labelled(entry.alias, { ...extra, type: 'line', point: curve.startMm,
        direction: curve.direction, start: curve.startMm, end: curve.endMm,
        lengthMm: entry.lengthMm, extentMm: entry.lengthMm,
        boxMm: [Math.min, Math.max].map(pick => curve.startMm
          .map((value, axis) => pick(value, curve.endMm[axis]))) });
    }
    if (curve.type === 'circle') {
      // Bounding-box diagonal of the full circle: 2r·√(Σ(1 − n_i²)) = 2√2·r.
      return labelled(entry.alias, { ...extra, type: 'circle', point: curve.centerMm,
        direction: curve.normal, center: curve.centerMm, radius: curve.radiusMm,
        extentMm: 2 * Math.SQRT2 * curve.radiusMm,
        boxMm: circleBox(curve.centerMm, context.math.normalize(curve.normal), curve.radiusMm) });
    }
    return labelled(entry.alias, { ...extra, type: 'curve',
      unsupported: entry.unsupported ?? `no closed-form relations for ${curve.type} edges` });
  }
  // Faces: a fragment alias resolves to its logical face unless the request
  // opts out; the support of a logical face is the support of its fragments.
  let faceIndex = entityIndex;
  let group = null;
  if (kind === 'logical') {
    const groups = context.logical?.bodies?.[bodyIndex]?.groups ?? [];
    if (!groups[entityIndex]) throw new HttpError(404, `Unknown geometry alias ${input.alias}`);
    faceIndex = groups[entityIndex].fragments[0];
    group = logicalGroup(context.logical, bodyIndex, faceIndex);
  } else if (context.resolveLogical) {
    group = logicalGroup(context.logical, bodyIndex, faceIndex);
  }
  const entry = faceEntry(context, bodyIndex, faceIndex);
  const fragments = group?.fragments ?? [entry.alias];
  const merged = group && (kind === 'logical' || fragments.length > 1);
  const label = merged ? group.alias : entry.alias;
  const toleranceMm = merged
    ? Math.max(...group.fragmentIndices.map(fragment => faceTolerance(body, fragment)))
    : entry.toleranceMm;
  const extra = { toleranceMm, fragments, logical: group?.alias ?? null, face: entry.alias,
    faceIndices: group?.fragmentIndices ?? [faceIndex] };
  const surface = entry.surface;
  const { math } = context;
  const { centroid, extentMm, boxMm } = faceSpread(context, body, extra.faceIndices);
  if (surface.type === 'plane') {
    // The centroid projected onto the plane: c − ((c − o)·n) n.
    const point = centroid ? math.sub(centroid, math.scale(surface.normal,
      math.dot(math.sub(centroid, surface.originMm), surface.normal))) : surface.originMm;
    return labelled(label, { ...extra, type: 'plane', point, normal: surface.normal, extentMm,
      boxMm });
  }
  if (surface.type === 'cylinder' || surface.type === 'cone') {
    const point = centroid ? math.foot(surface.axis.pointNearestOriginMm, surface.axis.direction,
      centroid) : surface.axis.pointNearestOriginMm;
    return labelled(label, {
      ...extra, type: surface.type, point, extentMm, boxMm,
      direction: surface.axis.direction, hole: entry.hole,
      ...(surface.type === 'cylinder' ? { radius: surface.radiusMm }
        : { halfAngleDeg: surface.halfAngleDeg }),
    });
  }
  return labelled(label, { ...extra, type: 'surface',
    unsupported: surface.unsupported ?? `no closed-form relations for ${surface.type} faces` });
}

// Rows -----------------------------------------------------------------------

// `evaluated` is the entity at whose point the pair's relations are evaluated
// (pairRows). `spanMm` is the lever arm a decision must hold over: the
// bounding-box diagonal of both entities for plane and axis pairs, the
// evaluated entity's extent otherwise. Parallel and coaxial decisions use t
// over it (geometry.mjs pairAngularTolerance), so two supports decided
// parallel deviate from parallel by at most t across both entities, not just
// across the smaller one. When the stored-precision guard dominates, the
// decision rows state the larger bound (`decisionMm`).
function createRows(context, a, b, evaluated, spanMm = evaluated.extentMm) {
  const rows = [];
  const inputs = [a, b].map(entity => `${entity.label}@${entity.modelId}`);
  const toleranceMm = Math.max(a.toleranceMm ?? 0, b.toleranceMm ?? 0);
  const bodies = [...new Set([a, b].map(entity => context.model.bodies[entity.bodyIndex]))];
  const angular = pairAngularTolerance(bodies, toleranceMm, spanMm);
  const decisionMm = Number.isFinite(spanMm) ? Math.max(toleranceMm, angular * spanMm)
    : toleranceMm;
  // How far two supports with unit directions u and v, evaluated at a point
  // of the evaluated entity, drift apart over `over` mm: |u ∓ v|·over, the
  // chord bounds the change of the reading along any path.
  const drift = (u, v, over = spanMm) => {
    const chord = Math.min(context.math.norm(context.math.sub(u, v)),
      context.math.norm(context.math.add(u, v)));
    return Number.isFinite(over) ? chord * over : (chord === 0 ? 0 : Infinity);
  };
  const add = (quantity, label, value, unit, options = {}) => {
    const length = unit === 'mm';
    rows.push({
      quantity, label, value, unit,
      exactness: EXACT,
      toleranceMm: options.decision ? decisionMm : length ? toleranceMm : null,
      angularToleranceRad: options.angularToleranceRad ?? angular,
      method: options.method ?? null,
      inputs,
      note: options.note ?? null,
      pair: [a.index, b.index],
      ...(options.witness ? { witness: options.witness } : {}),
    });
  };
  // Why a face pair got no surface distance (trim checks); folded into the
  // unsupported extrema row.
  const blocked = [];
  // Angular tolerance over the evaluated entity alone (a relation scoped to it).
  const evaluatedAngular = pairAngularTolerance(bodies, toleranceMm, evaluated.extentMm);
  return { rows, add, toleranceMm, angular, decisionMm, spanMm, drift,
    evaluatedAngular, inputs, blocked, context };
}

const mm = value => (!Number.isFinite(value) ? 'an unbounded amount'
  : value === 0 ? '0 mm' : `${value.toExponential(2)} mm`);
// Note of a parallel decision: what it covers and how far the supports drift.
function acrossNote(result, what, drift, isParallel) {
  const span = Number.isFinite(result.spanMm)
    ? `bounding-box diagonal ${result.spanMm.toFixed(3)} mm` : 'an entity has no bounded extent';
  return isParallel
    ? `decided across both entities (${span}): the ${what} deviate from parallel by at most`
      + ` ${mm(drift)} across them`
    : `decided across both entities (${span})`;
}

// Angle in [0, π] between two unit vectors: atan2(|u×v|, u·v).
function angleBetween(math, u, v) {
  return math.atan2(math.norm(math.cross(u, v)), math.dot(u, v));
}
const parallel = (math, u, v, angular) => math.norm(math.cross(u, v)) <= angular;
// Angle in [0, π/2] between two undirected lines.
const lineAngle = (math, u, v) => math.atan2(math.norm(math.cross(u, v)),
  Math.abs(math.dot(u, v)));

// Distance between two infinite lines and whether they are parallel. For
// parallel lines: the distance of a's point (the evaluated entity) from b's
// line.
function lineDistance(math, a, b, angular) {
  const between = math.sub(b.point, a.point);
  if (parallel(math, a.direction, b.direction, angular)) {
    return { parallel: true, distance: math.norm(math.cross(between, b.direction)) };
  }
  const normal = math.cross(a.direction, b.direction);
  return {
    parallel: false,
    distance: Math.abs(math.dot(between, normal)) / math.norm(normal),
  };
}

// Witnesses tell the viewer where to draw a row (dimension-layer.js); they
// never carry a displayed value. Entities are referenced by selection index.
const lineWitness = (a, b) => ({
  kind: 'lines',
  lines: [a, b].map(entity => ({
    index: entity.index, point: entity.point, direction: entity.direction,
  })),
});
const axisEnd = entity => ({ index: entity.index, point: entity.point, radius: entity.radius });

function pointPoint(math, a, b, { add }) {
  const delta = math.sub(b.point, a.point);
  add('distance', 'Distance', math.norm(delta), 'mm', {
    method: '|p2 − p1| (kernel.precise)',
    witness: { kind: 'segment', points: [a.point, b.point], exactAnchors: true },
  });
  ['ΔX', 'ΔY', 'ΔZ'].forEach((label, axis) => add(`delta${'XYZ'[axis]}`, label, delta[axis],
    'mm', { method: 'component of p2 − p1' }));
}

function pointPlane(math, point, plane, { add }) {
  const signed = math.dot(math.sub(point.point, plane.point), plane.normal);
  const foot = math.sub(point.point, math.scale(plane.normal, signed));
  add('signedDistance', 'Signed distance to plane', signed, 'mm', {
    method: '(p − o)·n with the outward normal n (kernel.precise)',
    note: `${SUPPORTING_PLANES}; positive on the outward side`,
    witness: { kind: 'segment', points: [point.point, foot], exactAnchors: true },
  });
}

function pointAxis(math, point, axisEntity, { add }) {
  const foot = math.foot(axisEntity.point, axisEntity.direction, point.point);
  const distance = math.norm(math.sub(point.point, foot));
  const label = axisEntity.type === 'line' ? 'Distance to line' : 'Distance to axis';
  add('distanceToAxis', label, distance, 'mm', {
    method: '|(p − a) × d| with the unit direction d (kernel.precise)',
    note: INFINITE_LINES,
    witness: { kind: 'segment', points: [point.point, foot], exactAnchors: true },
  });
  if (axisEntity.type === 'cylinder') {
    add('surfaceDistance', 'Distance to cylinder surface', Math.abs(distance - axisEntity.radius),
      'mm', { method: '| |(p − a) × d| − r |', note: SUPPORTING_CYLINDERS });
  }
}

function pointCircle(math, point, circle, { add }) {
  add('distanceToCenter', 'Distance to circle center',
    math.norm(math.sub(point.point, circle.center)), 'mm', {
      method: '|p − c| (kernel.precise)',
      witness: { kind: 'segment', points: [point.point, circle.center], exactAnchors: true },
    });
  pointAxis(math, point, circle, { add });
}

// a is the evaluated plane (the smaller face): the offset is the distance of
// its point (the face centroid on its plane) from b's plane, along b's normal.
// Parallel is decided across both faces. Planes that are parallel within t
// across the smaller face only (a small tilted pad far out on a large plate)
// get no parallel offset; the offset of the smaller face from the other plane
// is stated instead, scoped to that face.
function planePlane(math, a, b, result) {
  const { add, angular, decisionMm, drift, evaluatedAngular } = result;
  const angle = angleBetween(math, a.normal, b.normal);
  add('angle', 'Angle between outward normals', degrees(angle), 'deg', {
    method: 'atan2(|n1 × n2|, n1·n2) (kernel.real)',
  });
  const isParallel = parallel(math, a.normal, b.normal, angular);
  const lever = drift(a.normal, b.normal);
  add('parallel', 'Parallel', isParallel, null, {
    method: `|n1 × n2| ≤ angular tolerance ${PAIR_ANGULAR_RULE}`, decision: true,
    note: acrossNote(result, 'planes', lever, isParallel),
  });
  const signed = math.dot(math.sub(b.point, a.point), b.normal);
  const offset = Math.abs(signed);
  const witness = {
    kind: 'offset', from: a.index,
    direction: signed < 0 ? math.scale(b.normal, -1) : b.normal, lengthMm: offset,
  };
  const method = `|(o2 − c1)·n2|: c1 the centroid of the smaller face ${a.label} on its plane,`
    + ` o2 and n2 the plane of ${b.label} (kernel.precise)`;
  if (!isParallel) {
    if (!parallel(math, a.normal, b.normal, evaluatedAngular)) return;
    add('faceToPlaneOffset', `Offset of ${a.label} from the plane of ${b.label}`, offset, 'mm', {
      method, angularToleranceRad: evaluatedAngular, witness,
      note: `${SUPPORTING_PLANES}; the planes are not parallel within t across both faces;`
        + ` evaluated at the centroid of ${a.label}, varies by at most`
        + ` ${mm(drift(a.normal, b.normal, a.extentMm))} across it`,
    });
    return;
  }
  add('parallelOffset', 'Parallel offset', offset, 'mm', {
    method, witness,
    note: `${SUPPORTING_PLANES}; evaluated at the centroid of ${a.label}, varies by at most`
      + ` ${mm(lever)} across both faces`,
  });
  add('coplanar', 'Coplanar', offset + lever <= decisionMm, null, {
    method: 'parallel and offset + deviation across both faces ≤ t', decision: true,
    note: SUPPORTING_PLANES,
  });
  add('normals', 'Outward normals', math.dot(a.normal, b.normal) < 0 ? 'opposed' : 'same direction',
    null, { method: 'sign of n1·n2' });
}

function axisPlane(math, axisEntity, plane, { add, angular }) {
  const sine = Math.abs(math.dot(axisEntity.direction, plane.normal));
  const angle = math.atan2(sine, math.norm(math.cross(axisEntity.direction, plane.normal)));
  const what = axisEntity.type === 'line' ? 'Line' : axisEntity.type === 'circle'
    ? 'Circle axis' : 'Axis';
  add('axisToPlaneAngle', `${what} to plane angle`, degrees(angle), 'deg', {
    method: 'atan2(|d·n|, |d × n|) (kernel.real)',
  });
  if (axisEntity.type === 'circle' && parallel(math, axisEntity.direction, plane.normal, angular)) {
    const signed = math.dot(math.sub(axisEntity.center, plane.point), plane.normal);
    add('signedDistance', 'Circle plane offset from plane', signed, 'mm', {
      method: '(c − o)·n with the outward normal n (kernel.precise)',
      note: `${SUPPORTING_PLANES}; positive on the outward side`,
      witness: {
        kind: 'segment', exactAnchors: true,
        points: [axisEntity.center, math.sub(axisEntity.center, math.scale(plane.normal, signed))],
      },
    });
    return;
  }
  if (sine > angular) return;
  const signed = math.dot(math.sub(axisEntity.point, plane.point), plane.normal);
  const witness = {
    kind: 'axis-plane', axisPoint: axisEntity.point, axis: axisEntity.direction,
    planePoint: plane.point, normal: plane.normal, radius: 0, from: axisEntity.index,
  };
  add('axisToPlaneDistance', `${what} to plane distance`, Math.abs(signed), 'mm', {
    method: '|(a − o)·n| for an axis parallel to the plane (kernel.precise)',
    note: `${axisEntity.type === 'line' ? INFINITE_LINES : 'infinite axis'}; ${SUPPORTING_PLANES}`,
    witness,
  });
  if (axisEntity.type === 'cylinder') {
    add('surfaceToPlane', 'Cylinder to plane gap', Math.abs(signed) - axisEntity.radius, 'mm', {
      method: '|(a − o)·n| − r (kernel.precise)',
      note: `${SUPPORTING_CYLINDERS}; negative: the supporting cylinder crosses the plane`,
      witness: { ...witness, radius: axisEntity.radius },
    });
  }
}

const isRound = entity => entity.type === 'cylinder' || entity.type === 'circle';

// a is the evaluated entity (pairRows): parallel distances are taken from its
// point near the entity; rows naming one entity keep the selection order.
function axisAxis(math, a, b, result) {
  const { add, toleranceMm, angular, decisionMm, drift, evaluatedAngular, blocked } = result;
  add('axisAngle', a.type === 'line' && b.type === 'line' ? 'Angle between lines'
    : 'Angle between axes', degrees(lineAngle(math, a.direction, b.direction)), 'deg', {
    method: 'atan2(|d1 × d2|, |d1·d2|) (kernel.real)',
  });
  const { parallel: isParallel, distance } = lineDistance(math, a, b, angular);
  const bothLines = a.type === 'line' && b.type === 'line';
  add(bothLines ? 'lineDistance' : 'axisDistance',
    bothLines ? 'Distance between lines' : 'Distance between axes', distance, 'mm', {
      method: isParallel ? `|(p2 − p1) × d2| (parallel; p1 on ${a.label} near the entity)`
        : '|(p2 − p1)·(d1 × d2)| / |d1 × d2|',
      note: INFINITE_LINES, witness: lineWitness(a, b),
    });
  const lever = drift(a.direction, b.direction);
  add('parallel', bothLines ? 'Parallel' : 'Parallel axes', isParallel, null, {
    method: `|d1 × d2| ≤ angular tolerance ${PAIR_ANGULAR_RULE}`, decision: true,
    note: acrossNote(result, bothLines ? 'lines' : 'axes', lever, isParallel),
  });
  if (!isParallel && FACE_TYPES.has(a.type) && FACE_TYPES.has(b.type)
    && parallel(math, a.direction, b.direction, evaluatedAngular)) {
    // Parallel across the smaller face only: say why there is no relation.
    blocked.push(`the axes of ${a.label} and ${b.label} are parallel within t across ${a.label}`
      + ` but deviate by up to ${mm(lever)} across both faces`);
  }
  if (bothLines) {
    const gaps = [[a.start, b.start], [a.start, b.end], [a.end, b.start], [a.end, b.end]]
      .map(([p, q]) => ({ points: [p, q], length: math.norm(math.sub(q, p)) }))
      .sort((x, y) => x.length - y.length);
    add('endpointGap', 'Nearest endpoint gap', gaps[0].length, 'mm', {
      method: 'minimum of the four endpoint distances (kernel.precise)',
      witness: { kind: 'segment', points: gaps[0].points, exactAnchors: true },
    });
    return;
  }
  if (a.type === 'line' || b.type === 'line') return;
  // The axis distance is read at the evaluated entity; across both entities
  // the axes drift apart by at most `lever` more.
  const coaxial = isParallel && distance + lever <= decisionMm;
  add('coaxial', 'Coaxial', coaxial, null, {
    method: 'parallel and axis distance + deviation across both entities ≤ t', decision: true,
  });
  if (a.type === 'circle' && b.type === 'circle') {
    const along = Math.abs(math.dot(math.sub(b.center, a.center), a.direction));
    add('concentric', 'Concentric', coaxial && along <= toleranceMm, null, {
      method: 'coaxial and centers in one plane (|(c2 − c1)·n| ≤ t)', decision: true,
    });
  }
  if (!isRound(a) || !isRound(b)) return;
  const [first, second] = a.index < b.index ? [a, b] : [b, a];
  add('radiusA', `Radius ${first.label}`, first.radius, 'mm', { method: 'stored radius' });
  add('radiusB', `Radius ${second.label}`, second.radius, 'mm', { method: 'stored radius' });
  const faces = a.type === 'cylinder' && b.type === 'cylinder';
  if (!faces) {
    if (coaxial) {
      add('radiusDifference', 'Radius difference', Math.abs(a.radius - b.radius), 'mm', {
        method: '|r1 − r2|', note: 'coaxial circles or cylinder and circle',
        witness: { kind: 'radial', axisPoint: a.point, axis: a.direction,
          radii: [a.radius, b.radius] },
      });
    }
    return;
  }
  if (isParallel) cylinderPair(math, a, b, distance, coaxial, result);
}

// Trims of a cylinder face, from its boundary edges (exact curve parameters,
// never the display mesh), in the frame of the pair (the evaluated entity's
// axis point p and direction d, pairFrame x and y):
//   coverage: angular intervals (deg) about the face's own axis, from its
//     circle edges (printability.faceCoverage), null when not evaluated;
//   axial: [min, max] of (v − p)·d over the face's vertices, known only when
//     every edge is a line along the axis or a circle across it (a rim), null
//     otherwise (an oblique cut, an ellipse). On a cylinder the height is
//     linear in the surface parameters, so no face point lies outside the
//     range of its boundary, and the boundary heights are those of the
//     vertices (rims are level, axial lines run between two vertices);
//   rims: the circle edges with their height;
//   fragments: per fragment its rims (height, angular interval) and axial
//     lines (angle, height range), and levels: the sorted vertex heights,
//     both known only with axial (see coverageAt).
// A logical face is the union of its fragments.
const FULL_TURN_DEG = 360;
const AXIAL_METHOD = 'distance between the axial ranges of the rims ((v − p)·d over the face'
  + ' vertices)';
const wrapDeg = value => ((value % FULL_TURN_DEG) + FULL_TURN_DEG) % FULL_TURN_DEG;

function pairFrame(math, a) {
  const d = a.direction;
  const seed = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const x = math.normalize(math.sub(seed, math.scale(d, math.dot(seed, d))));
  return { x, y: math.cross(d, x), point: a.point, direction: d };
}

function trimOf(context, entity, frame, angular) {
  const { model, kernel, math } = context;
  const body = model.bodies[entity.bodyIndex];
  const own = { origin: entity.point, x: frame.x, y: frame.y };
  const height = vertex => math.dot(math.sub(body.vertices[vertex], frame.point), frame.direction);
  let coverage = [];
  let axial = [Infinity, -Infinity];
  const rims = [];
  const fragments = [];
  const heights = [];
  for (const index of entity.faceIndices ?? []) {
    const face = body.faces[index];
    const intervals = faceCoverage(kernel, body, face, own);
    coverage = coverage && intervals ? [...coverage, ...intervals] : null;
    const edges = [...new Set((face.loops ?? []).flat().map(use => use.edge))]
      .map(edge => body.edges[edge]);
    const rimsOnly = edges.every(edge => {
      const curve = edge.curve ?? {};
      const type = typeof curve === 'string' ? curve : curve.type;
      if (type === 'line') {
        const from = body.vertices[edge.start];
        const to = body.vertices[edge.end];
        const along = math.sub(to, from);
        const size = math.norm(along);
        return size > 0 && math.norm(math.cross(along, entity.direction)) <= angular * size;
      }
      // A circle in a plane across the axis: its vertices give its height.
      if (type === 'circle') {
        return math.norm(math.cross(curve.normal, entity.direction)) <= angular;
      }
      return false;
    });
    if (!axial || !rimsOnly) {
      axial = null;
      continue;
    }
    const fragment = { rims: [], lines: [] };
    for (const edge of edges) {
      const ends = [edge.start, edge.end].map(height);
      const range = [Math.min(...ends), Math.max(...ends)];
      axial = [Math.min(axial[0], range[0]), Math.max(axial[1], range[1])];
      heights.push(...ends);
      if ((edge.curve?.type ?? edge.curve) === 'circle') {
        rims.push({ edge, heights: range });
        const [interval] = edgeCoverage(kernel, body, [edge], own);
        fragment.rims.push({ height: (range[0] + range[1]) / 2, interval });
      } else {
        const relative = math.sub(body.vertices[edge.start], entity.point);
        fragment.lines.push({ range, angle: wrapDeg(math.atan2(math.dot(relative, frame.y),
          math.dot(relative, frame.x)) * 180 / Math.PI) });
      }
    }
    fragments.push(fragment);
  }
  if (axial && !(axial[0] <= axial[1])) axial = null;
  const levels = [...new Set(heights)].sort((x, y) => x - y);
  return { coverage: coverage?.length ? coverage : null, axial, rims: axial ? rims : [],
    fragments: axial ? fragments : null, levels: axial ? levels : null };
}

// Angular coverage (deg, merged intervals, possibly empty) of a face at a
// height z, for a face bounded by rims and axial lines only (trim.fragments).
// Unrolled, such a fragment is a rectilinear region of the (angle, height)
// strip, so at a height strictly between its vertex heights its coverage is
// the union of the intervals between consecutive cut angles (axial lines that
// span z, rim arc ends) that are inside: a ray from (θ, z) toward +height
// crosses the boundary only at rims above z that contain θ, and the region is
// bounded, so θ is inside when that count is odd. At a vertex height (within
// t) the face's closure there is the union of the bands below and above it.
function coverageAt(trim, z, toleranceMm) {
  const levels = trim.levels;
  const at = levels.findIndex(level => Math.abs(level - z) <= toleranceMm);
  if (at >= 0) {
    let [lower, upper] = [at, at];
    while (lower > 0 && levels[at] - levels[lower - 1] <= toleranceMm) lower--;
    while (upper < levels.length - 1 && levels[upper + 1] - levels[at] <= toleranceMm) upper++;
    const below = lower > 0 ? (levels[lower - 1] + levels[lower]) / 2 : levels[0] - 1;
    const above = upper < levels.length - 1 ? (levels[upper] + levels[upper + 1]) / 2
      : levels[upper] + 1;
    return mergeIntervals([...bandCoverage(trim, below), ...bandCoverage(trim, above)]);
  }
  return bandCoverage(trim, z);
}

const insideArc = ([first, last], angle) => wrapDeg(angle - first) <= last - first;

function bandCoverage(trim, z) {
  const intervals = [];
  for (const { rims, lines } of trim.fragments) {
    const cuts = [...new Set([
      ...lines.filter(line => line.range[0] < z && z < line.range[1]).map(line => line.angle),
      ...rims.flatMap(rim => rim.interval[1] - rim.interval[0] >= FULL_TURN_DEG ? []
        : rim.interval.map(wrapDeg)),
    ])].sort((x, y) => x - y);
    if (!cuts.length) cuts.push(0);
    cuts.forEach((cut, index) => {
      const next = index + 1 < cuts.length ? cuts[index + 1] : cuts[0] + FULL_TURN_DEG;
      const middle = wrapDeg((cut + next) / 2);
      const crossings = rims.filter(rim => rim.height > z && insideArc(rim.interval, middle))
        .length;
      if (crossings % 2 === 1) intervals.push([cut, next]);
    });
  }
  return mergeIntervals(intervals);
}

// Union of angular intervals [first, last] (deg, last ≥ first, first in
// [0, 360)); a full turn is [[0, 360]].
function mergeIntervals(intervals) {
  const sorted = intervals.map(([first, last]) => [first, last]).sort((p, q) => p[0] - q[0]);
  const merged = [];
  for (const interval of sorted) {
    const last = merged.at(-1);
    if (last && interval[0] <= last[1] + 1e-9) last[1] = Math.max(last[1], interval[1]);
    else merged.push(interval);
  }
  if (merged.length > 1 && merged.at(-1)[1] >= merged[0][0] + FULL_TURN_DEG - 1e-9) {
    const tail = merged.pop();
    merged[0] = [tail[0], merged[0][1] + FULL_TURN_DEG];
  }
  if (merged.length === 1 && merged[0][1] - merged[0][0] >= FULL_TURN_DEG - 1e-9) {
    return [[0, FULL_TURN_DEG]];
  }
  return merged;
}

// Heights at which two faces are compared over their axial overlap [lo, hi]:
// the vertex heights of both faces inside it, its ends, and the midpoints
// between consecutive ones. Coverages only change at vertex heights, so a
// common direction at a common height in the overlap shows at one of these.
function overlapHeights(trims, axial, toleranceMm) {
  const lo = Math.max(axial.ranges[0][0], axial.ranges[1][0]);
  const hi = Math.min(axial.ranges[0][1], axial.ranges[1][1]);
  const inside = [lo, hi, ...trims.flatMap(trim => trim.levels)
    .filter(level => level > lo && level < hi)].sort((x, y) => x - y);
  const levels = inside.filter((level, index) => index === 0
    || level - inside[index - 1] > toleranceMm);
  return levels.flatMap((level, index) => index + 1 < levels.length
    ? [level, (level + levels[index + 1]) / 2] : [level]);
}

// Angular coverage (deg, about the entity's axis) of the rims of a face at a
// height: the circle edges whose vertices lie within t of it; null when the
// face has no rim there.
function rimCoverage(context, entity, trim, frame, height, toleranceMm) {
  const edges = trim.rims.filter(rim => Math.abs(rim.heights[0] - height) <= toleranceMm
    && Math.abs(rim.heights[1] - height) <= toleranceMm).map(rim => rim.edge);
  if (!edges.length) return null;
  const body = context.model.bodies[entity.bodyIndex];
  return edgeCoverage(context.kernel, body, edges,
    { origin: entity.point, x: frame.x, y: frame.y });
}

// Whether a face's angular coverage contains the direction u (unit, ⟂ axis),
// with a slack of t / r: true, false, or null when coverage is unknown.
function covers(math, trim, frame, u, radius, toleranceMm) {
  if (!trim.coverage) return null;
  const angle = wrapDeg(math.atan2(math.dot(u, frame.y), math.dot(u, frame.x)) * 180 / Math.PI);
  const slack = (toleranceMm / Math.max(radius, 1e-9)) * 180 / Math.PI + 1e-9;
  return trim.coverage.some(([first, last]) => wrapDeg(angle - first) <= last - first + slack
    || wrapDeg(first - angle) <= slack);
}

// Whether two coverages about one axis share a direction.
function coveragesMeet(a, b, slackDeg) {
  if (!a.coverage || !b.coverage) return null;
  return a.coverage.some(([s1, e1]) => b.coverage.some(([s2, e2]) => {
    const start = wrapDeg(s2 - s1);
    return start <= e1 - s1 + slackDeg || wrapDeg(s1 - s2) <= e2 - s2 + slackDeg;
  }));
}

// Axial overlap (mm, negative: the gap between the ranges); both ranges are
// heights along the pair frame. null when either range is unknown.
function axialOverlap(trims) {
  if (!trims[0].axial || !trims[1].axial) return null;
  const [[a0, a1], [b0, b1]] = trims.map(trim => trim.axial);
  return { overlap: Math.min(a1, b1) - Math.max(a0, b0), ranges: [[a0, a1], [b0, b1]] };
}

// Note of a supporting-cylinder row, naming what the trims decided.
function cylinderNote(axial, coaxial, toleranceMm) {
  const scope = !axial ? ' (axial extent not evaluated: a boundary edge is not a rim)'
    : axial.overlap > toleranceMm
      ? ` over ${axial.overlap.toFixed(4)} mm of axial overlap of the faces`
      : ' (the faces do not overlap axially)';
  return `supporting cylinders${scope}${coaxial ? '' : '; parallel axes'}`;
}

// Exact minimum distance between two cylinder faces with parallel axes that
// do not overlap axially (overlap ≤ t), both bounded by rims and axial lines.
// Lower bound: a face point lies on its supporting cylinder at a height inside
// the face's axial range, and |p − q|² splits into the cross-section part
// (at least D², D the distance between the full circles:
// max(|r1 − r2| − d, d − r1 − r2, 0)) and the axial part (at least g², g the
// gap between the ranges). The bound is attained, and so is the minimum, when
// the closest points of the circles lie on the facing rim edges: those points
// are the witness. Otherwise the pair is refused with the reason.
function faceDistance(math, a, b, state) {
  const { add, blocked, context, trims, frame, axial, coaxial, distance, t } = state;
  const what = 'minimum distance between the faces';
  const [[a0, a1], [b0, b1]] = axial.ranges;
  // The axes must stay parallel within t over the span of both faces
  // (heights and rim tilt), or the separation of the bound does not hold.
  const tilt = math.norm(math.cross(a.direction, b.direction));
  const span = Math.max(a1, b1) - Math.min(a0, b0) + a.radius + b.radius;
  if (tilt * span > t) {
    blocked.push(`${what}: the axes deviate by ${(tilt * span).toExponential(2)} mm over the`
      + ` span of the faces, more than t`);
    return;
  }
  const below = a0 + a1 <= b0 + b1;
  const [za, zb] = below ? [a1, b0] : [a0, b1];
  const gap = Math.max(0, below ? b0 - a1 : a0 - b1);
  const d = coaxial ? 0 : distance;
  const [ra, rb] = [a.radius, b.radius];
  const cross = Math.max(Math.abs(ra - rb) - d, d - ra - rb, 0);
  const rimA = { coverage: rimCoverage(context, a, trims[0], frame, za, t) };
  const rimB = { coverage: rimCoverage(context, b, trims[1], frame, zb, t) };
  for (const [rim, entity] of [[rimA, a], [rimB, b]]) {
    if (!rim.coverage) {
      blocked.push(`${what}: ${entity.label} has no rim edge at its facing end`);
      return;
    }
  }
  // Closest directions in the cross-section, as [on a, on b] (unit, ⟂ axis).
  const between = math.sub(b.point, a.point);
  const across = math.sub(between, math.scale(a.direction, math.dot(between, a.direction)));
  const direction = deg => math.add(math.scale(frame.x, Math.cos(deg * Math.PI / 180)),
    math.scale(frame.y, Math.sin(deg * Math.PI / 180)));
  let candidates;
  if (coaxial || !(math.norm(across) > 0)) {
    // Every direction is closest; try the frame x axis, then the arc ends
    // and middles (two arcs that meet contain an end of one of them).
    const angles = [0, ...[rimA, rimB].flatMap(rim => rim.coverage
      .flatMap(([first, last]) => [(first + last) / 2, first, last]))];
    candidates = angles.map(deg => [direction(deg), direction(deg)]);
  } else {
    const u = math.normalize(across);
    const v = math.cross(a.direction, u);
    if (d >= ra + rb) {
      candidates = [[u, math.scale(u, -1)]];
    } else if (Math.abs(ra - rb) >= d) {
      // One circle inside the other: both points on the side the inner
      // circle is offset to, seen from the outer circle's center.
      const side = ra >= rb ? u : math.scale(u, -1);
      candidates = [[side, side]];
    } else {
      // Crossing circles: the two intersection points x·u ± y·v.
      const x = (d * d + ra * ra - rb * rb) / (2 * d);
      const y = math.sqrt(ra * ra - x * x);
      candidates = [1, -1].map(sign => {
        const point = math.add(math.scale(u, x), math.scale(v, sign * y));
        return [math.scale(point, 1 / ra),
          math.scale(math.sub(point, math.scale(u, d)), 1 / rb)];
      });
    }
  }
  const found = candidates.find(([onA, onB]) => covers(math, rimA, frame, onA, ra, t)
    && covers(math, rimB, frame, onB, rb, t));
  if (!found) {
    blocked.push(`${what}: the closest points of the supporting circles are not on the facing`
      + ` rims of ${a.label} and ${b.label}`);
    return;
  }
  // Exact points: a's axis at height za, b's axis at height zb (heights along
  // the pair frame), each moved out by its radius along its direction.
  const axisAt = (entity, height) => math.add(entity.point, math.scale(entity.direction,
    (height - math.dot(math.sub(entity.point, frame.point), frame.direction))
      / math.dot(entity.direction, frame.direction)));
  const onA = math.add(axisAt(a, za), math.scale(found[0], ra));
  const onB = math.add(axisAt(b, zb), math.scale(found[1], rb));
  const value = math.sqrt(cross * cross + gap * gap);
  const length = math.norm(math.sub(onB, onA));
  if (!(Math.abs(length - value) <= t)) {
    blocked.push(`${what}: the witness points are ${length} mm apart, not the closed form`
      + ` ${value} mm within t`);
    return;
  }
  add('faceDistance', 'Minimum distance between the faces', value, 'mm', {
    method: '√(D² + g²): D = max(|r1 − r2| − d, d − r1 − r2, 0) between the cross-section'
      + ' circles (d the axis offset), g the axial gap; attained on the facing rims',
    note: 'trimmed faces: the faces do not overlap axially; lower bound over their axial'
      + ' ranges, attained at exact points of their facing rim edges',
    // Points in selection order, like the pair.
    witness: { kind: 'segment', points: a.index < b.index ? [onA, onB] : [onB, onA],
      exactAnchors: true },
  });
}

// Two cylinder faces with parallel axes (d = axis offset, 0 when coaxial);
// a is the evaluated entity. The relation depends on how the supporting
// circles lie in a cross-section, decided with the entity tolerance t:
//   hole and boss, boss circle inside the hole circle (d + r_b ≤ r_h):
//     clearance r_h − r_b − d (radial gap and diametral clearance if coaxial);
//   hole and boss, hole circle inside the boss circle (d + r_h ≤ r_b):
//     same body: the material wall r_b − r_h − d (a tube wall, a screw hole in
//     a standoff); two bodies: interference, clearance r_h − r_b − d < 0;
//   disjoint circles (d ≥ r1 + r2): the gap d − r1 − r2 between the surfaces;
//   one circle inside the other otherwise: r_big − r_small − d between them;
//   crossing circles: no closed form while the faces overlap axially.
// Trims: a relation between the supporting cylinders is only stated for the
// faces when their trims allow it. Off-axis relations need the closest points
// (along the axis offset) on both faces' angular coverage, coaxial ones a
// common direction, at one common height where the faces overlap; a wall or an
// interference needs the faces to overlap axially by more than t. Faces that
// do not overlap axially get the axial gap and their exact minimum distance
// (faceDistance), whatever the cross-section relation.
function cylinderPair(math, a, b, distance, coaxial, result) {
  const { add, toleranceMm, blocked, context } = result;
  const t = toleranceMm;
  const offset = coaxial ? 0 : distance;
  const radial = { kind: 'radial', axisPoint: a.point, axis: a.direction };
  const axes = (mode, from, to) => ({ kind: 'axes', mode, axis: a.direction,
    from: axisEnd(from), to: axisEnd(to) });
  const sameBody = a.bodyIndex === b.bodyIndex;
  const frame = pairFrame(math, a);
  // A face's rims are checked against its own axis, over its own extent.
  const trims = [a, b].map(entity => trimOf(context, entity, frame, pairAngularTolerance(
    [context.model.bodies[entity.bodyIndex]], t, entity.extentMm)));
  const trimFor = entity => trims[entity === a ? 0 : 1];
  const frameOf = entity => ({ origin: entity.point, ...frame });
  const axial = axialOverlap(trims);
  const apart = axial !== null && axial.overlap <= t;
  const note = cylinderNote(axial, coaxial, t);
  // Where the faces overlap axially (by more than t), a relation between the
  // supporting cylinders holds for the faces only when both faces cover the
  // closest directions at one common height of the overlap (coverageAt), not
  // anywhere along their rims. Without overlap the rows stay relations of the
  // supporting cylinders ("the faces do not overlap axially") next to the
  // exact face distance, and each face's coverage over all heights (the union
  // of its rim arcs) is checked.
  const overlapping = axial !== null && !apart;
  const heights = overlapping ? overlapHeights(trims, axial, t) : [];
  const coverageOf = (entity, z) => ({ coverage: coverageAt(trimFor(entity), z, t) });
  // Off-axis: the closest points lie along u (from one axis toward the other).
  const offAxis = (toward, pairs, what) => {
    const between = math.sub(toward[1].point, toward[0].point);
    const across = math.sub(between, math.scale(a.direction, math.dot(between, a.direction)));
    const u = math.normalize(across);
    const checks = pairs.map(([entity, sign]) => [entity, sign < 0 ? math.scale(u, -1) : u]);
    if (!axial) {
      const unknown = [a, b].filter(entity => !trimFor(entity).axial).map(entity => entity.label);
      blocked.push(`${what}: angular coverage of ${unknown.join(' and ')} over the axial`
        + ' overlap not evaluated (a boundary edge is not a rim or an axial line)');
      return false;
    }
    if (overlapping) {
      const coversAt = (entity, direction, z) => covers(math, coverageOf(entity, z),
        frameOf(entity), direction, entity.radius, t);
      const reached = z => checks.every(([entity, direction]) => coversAt(entity, direction, z));
      if (heights.some(reached)) return true;
      const outside = checks.find(([entity, direction]) => !heights
        .some(z => coversAt(entity, direction, z)));
      blocked.push(outside
        ? `${what}: the closest points of the supporting cylinders lie outside the trimmed`
          + ` arc of ${outside[0].label} at every height of the axial overlap of the faces`
        : `${what}: ${a.label} and ${b.label} never both reach the closest points of the`
          + ' supporting cylinders at one height of their axial overlap');
      return false;
    }
    for (const [entity, direction] of checks) {
      const inside = covers(math, trimFor(entity), frameOf(entity), direction, entity.radius, t);
      if (inside === true) continue;
      blocked.push(inside === null
        ? `${what}: angular coverage of ${entity.label} not evaluated (no circle edge)`
        : `${what}: the closest points of the supporting cylinders lie outside the`
          + ` trimmed arc of ${entity.label}`);
      return false;
    }
    return true;
  };
  const coaxialFacing = what => {
    const smallest = Math.max(Math.min(a.radius, b.radius), 1e-9);
    const slack = (t / smallest) * 180 / Math.PI + 1e-9;
    const meet = overlapping
      ? heights.some(z => coveragesMeet(coverageOf(a, z), coverageOf(b, z), slack))
      : coveragesMeet(trims[0], trims[1], slack);
    if (meet === false) {
      blocked.push(`${what}: the trimmed arcs of ${a.label} and ${b.label} share no direction`
        + (overlapping ? ' at any height of their axial overlap' : ''));
    }
    return meet !== false;
  };
  const radiusDifference = extra => add('radiusDifference', 'Radius difference',
    Math.abs(a.radius - b.radius), 'mm', {
      method: '|r1 − r2|', note: extra ? `${note}; ${extra}` : note,
      witness: { ...radial, radii: [a.radius, b.radius] },
    });
  // Faces without axial overlap: the axial gap and the exact face distance.
  const apartRows = what => {
    const gap = Math.max(0, -axial.overlap);
    const touching = gap <= t ? 'the faces meet at one height; they do not overlap axially'
      : 'the faces do not overlap axially';
    add('axialGap', 'Axial gap between the faces', gap, 'mm', {
      method: AXIAL_METHOD, note: what ? `${touching}, so no ${what} is stated` : touching,
    });
    faceDistance(math, a, b, { add, blocked, context, trims, frame, axial, coaxial, distance, t });
  };
  if (a.hole !== b.hole) {
    const [hole, boss] = a.hole ? [a, b] : [b, a];
    if (offset + boss.radius <= hole.radius + t) {
      const clearance = hole.radius - boss.radius - offset;
      if (coaxial) {
        if (coaxialFacing('radial gap')) {
          add('radialGap', 'Radial gap', clearance, 'mm', {
            method: 'r_hole − r_boss (boss inside the hole)', note,
            witness: { ...radial, radii: [boss.radius, hole.radius] },
          });
          add('diametralClearance', 'Diametral clearance', 2 * clearance, 'mm', {
            method: '2·(r_hole − r_boss)', note,
          });
        }
      } else if (offAxis([hole, boss], [[hole, 1], [boss, 1]], 'minimum radial clearance')) {
        add('minimumRadialClearance', 'Minimum radial clearance', clearance, 'mm', {
          method: 'r_hole − r_boss − axis offset (boss inside the hole)', note,
          witness: axes('clearance', hole, boss),
        });
      }
      if (apart) apartRows(null);
      return;
    }
    if (offset + hole.radius <= boss.radius + t) {
      const what = sameBody ? 'wall thickness' : 'interference';
      // A wall or an interference exists only where the faces overlap axially.
      if (!axial) {
        if (coaxial) radiusDifference(`so no ${what} is stated`);
        else blocked.push(`${what}: axial overlap not evaluated (a boundary edge is not a rim)`);
        return;
      }
      if (apart) {
        if (coaxial) radiusDifference(null);
        apartRows(what);
        return;
      }
      if (coaxial ? !coaxialFacing(what)
        : !offAxis([boss, hole], [[boss, 1], [hole, 1]], what)) return;
      if (sameBody) {
        add('wallThickness', coaxial ? 'Wall thickness' : 'Minimum wall thickness',
          boss.radius - hole.radius - offset, 'mm', {
            method: coaxial ? 'r_boss − r_hole (hole inside the boss, one body)'
              : 'r_boss − r_hole − axis offset (hole inside the boss, one body)',
            note, witness: coaxial ? { ...radial, radii: [hole.radius, boss.radius] }
              : axes('clearance', boss, hole),
          });
        return;
      }
      const clearance = hole.radius - boss.radius - offset;
      const interference = `supporting cylinders${coaxial ? '' : ', parallel axes'}; negative:`
        + ` interference of two bodies over ${axial.overlap.toFixed(4)} mm of axial overlap`;
      if (coaxial) {
        add('radialGap', 'Radial gap', clearance, 'mm', {
          method: 'r_hole − r_boss (boss of another body larger than the hole)',
          note: interference, witness: { ...radial, radii: [boss.radius, hole.radius] },
        });
        add('diametralClearance', 'Diametral clearance', 2 * clearance, 'mm', {
          method: '2·(r_hole − r_boss)', note: interference,
        });
      } else {
        add('minimumRadialClearance', 'Minimum radial clearance', clearance, 'mm', {
          method: 'r_hole − r_boss − axis offset (boss of another body covers the hole)',
          note: interference, witness: axes('clearance', hole, boss),
        });
      }
      return;
    }
  }
  if (coaxial) {
    radiusDifference(null);
  } else if (distance >= a.radius + b.radius - t) {
    const label = a.hole && b.hole ? 'Wall between holes'
      : !a.hole && !b.hole ? 'Gap between cylinders' : 'Distance between cylinder surfaces';
    if (offAxis([a, b], [[a, 1], [b, -1]], label.toLowerCase())) {
      add('cylinderGap', label, distance - a.radius - b.radius, 'mm', {
        method: 'axis offset − r1 − r2 (disjoint circles)', note,
        witness: axes('gap', a, b),
      });
    }
  } else {
    const [small, big] = a.radius <= b.radius ? [a, b] : [b, a];
    if (distance + small.radius <= big.radius + t
      && offAxis([big, small], [[big, 1], [small, 1]], 'minimum distance between cylinders')) {
      add('surfaceDistance', 'Minimum distance between cylinders',
        big.radius - small.radius - distance, 'mm', {
          method: 'r_big − r_small − axis offset (one circle inside the other)', note,
          witness: axes('clearance', big, small),
        });
    }
  }
  if (apart) apartRows(null);
}

// Roles of two entities of the same kind of relation: the smaller one (by
// extent; ties by body and alias) is evaluated against the other's support,
// so the selection order never changes a value or a decision.
function smallerFirst(x, y) {
  if (x.extentMm !== y.extentMm) return x.extentMm < y.extentMm ? [x, y] : [y, x];
  if (x.bodyIndex !== y.bodyIndex) return x.bodyIndex < y.bodyIndex ? [x, y] : [y, x];
  return x.label <= y.label ? [x, y] : [y, x];
}

function pairRows(context, first, second) {
  const [a, b] = [first, second].sort((x, y) => ORDER.indexOf(x.type) - ORDER.indexOf(y.type));
  const { math } = context;
  const types = `${a.type}/${b.type}`;
  const roles = a.type === 'point' ? [a, b]
    : types === 'plane/plane' ? smallerFirst(a, b)
      : b.type === 'plane' ? [a, b]
        : a.type === 'plane' ? [b, a]
          : smallerFirst(a, b);
  // Plane and axis pairs relate both entities, so their decisions must hold
  // over both; an axis/plane relation is read along the axis.
  const bothSpan = a.type !== 'point'
    && (types === 'plane/plane' || (a.type !== 'plane' && b.type !== 'plane'));
  const result = createRows(context, first, second, roles[0],
    bothSpan ? spanOf(a, b) : roles[0].extentMm);
  if (types === 'point/point') pointPoint(math, a, b, result);
  else if (types === 'point/plane') pointPlane(math, a, b, result);
  else if (b.type === 'circle' && a.type === 'point') pointCircle(math, a, b, result);
  else if (a.type === 'point') pointAxis(math, a, b, result);
  else if (types === 'plane/plane') planePlane(math, ...roles, result);
  else if (a.type === 'plane' || b.type === 'plane') axisPlane(math, ...roles, result);
  else axisAxis(math, ...roles, result);
  const involvesFace = FACE_TYPES.has(a.type) || FACE_TYPES.has(b.type);
  const unsupported = [];
  // A refused check is always reported, also next to a relation between the
  // supporting surfaces (a radius difference is no face distance); next to
  // the exact face distance it names only the refused relation.
  const blocked = result.blocked.join('; ');
  const surface = result.rows.some(row => SURFACE_DISTANCES.has(row.quantity));
  const faceDistance = result.rows.some(row => row.quantity === 'faceDistance');
  const item = reason => unsupported.push({ quantity: faceDistance ? 'relation' : 'minimumDistance',
    reason, inputs: result.inputs, pair: [first.index, second.index] });
  if (involvesFace && !faceDistance && (blocked || !surface)) {
    item(blocked ? `${EXTREMA_REASON} (${blocked})` : EXTREMA_REASON);
  } else if (involvesFace && blocked) {
    item(blocked);
  }
  return { rows: result.rows, unsupported };
}

const describe = entity => ({
  index: entity.index,
  alias: entity.label,
  requested: entity.requested,
  modelId: entity.modelId,
  type: entity.type,
  ...(entity.face ? { face: entity.face, logical: entity.logical, fragments: entity.fragments }
    : {}),
  ...(entity.hole !== undefined && entity.hole !== null ? { hole: entity.hole } : {}),
  toleranceMm: entity.toleranceMm ?? null,
});

function primaryRow(measurements) {
  const first = measurements.filter(row => row.pair[0] === 0 && row.pair[1] === 1
    && row.unit === 'mm' && Number.isFinite(row.value));
  for (const quantity of PRIMARY) {
    const index = measurements.indexOf(first.find(row => row.quantity === quantity));
    if (index >= 0) return index;
  }
  return null;
}

export function measureEntities(model, entities, {
  kernel, modelId = null, logical = cachedLogicalFaces(model), resolveLogical = true,
} = {}) {
  if (!Array.isArray(entities) || entities.length < 2) {
    throw new HttpError(400, 'Measuring needs at least two entities');
  }
  const context = { model, modelId, kernel, math: exactMath(kernel), logical, resolveLogical };
  const unsupported = [];
  if (entities.length > MAX_ENTITIES) {
    unsupported.push({
      quantity: 'selection',
      reason: `measurement covers the first ${MAX_ENTITIES} of ${entities.length} entities`,
      inputs: [],
    });
  }
  const resolved = entities.slice(0, MAX_ENTITIES)
    .map((input, index) => primitive(context, normalizeInput(model, input, modelId), index));
  const measurements = [];
  for (let i = 0; i < resolved.length; i++) {
    for (let j = i + 1; j < resolved.length; j++) {
      const [a, b] = [resolved[i], resolved[j]];
      const inputs = [a, b].map(entity => `${entity.label}@${entity.modelId}`);
      const pair = [i, j];
      if (a.modelId !== b.modelId || a.type === 'foreign' || b.type === 'foreign') {
        unsupported.push({ quantity: 'relation', reason: REVISIONS_REASON, inputs, pair });
        continue;
      }
      const blocked = [a, b].find(entity => entity.unsupported);
      if (blocked) {
        unsupported.push({ quantity: 'relation', reason: blocked.unsupported, inputs, pair });
        continue;
      }
      const result = pairRows(context, a, b);
      measurements.push(...result.rows);
      unsupported.push(...result.unsupported);
    }
  }
  return {
    schema: MEASURE_SCHEMA,
    modelId,
    units: 'mm',
    // The largest angular tolerance a decision of this response used (each
    // row carries its own); the floor when there are no rows.
    angularToleranceRad: Math.max(ANGULAR_TOLERANCE_RAD,
      ...measurements.map(row => row.angularToleranceRad)),
    angularToleranceFloorRad: ANGULAR_TOLERANCE_RAD,
    angularToleranceRule: PAIR_ANGULAR_RULE,
    method: 'closed forms over stored analytic parameters with kernel.precise and kernel.real,'
      + ' evaluated at points of the selected entities; decisions use the pair angular'
      + ' tolerance and the larger entity tolerance t',
    entities: resolved.map(describe),
    measurements,
    unsupported,
    primary: primaryRow(measurements),
  };
}
