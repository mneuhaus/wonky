// Exact geometry tables for GET /api/models/:id/geometry (spec 3.2, 9.2).
// Package: exact-measure.
//
// Frozen signature:
//   geometryEntities(model, { aliases, page }) -> { faces, edges, vertices, page, pages }
// plus the options this package needs: { kernel, modelId, logical, classes,
// pageSize }. `kernel` is the loaded Bend kernel (src/kernel.mjs).
//
// Every number is a closed form over the stored analytic parameters,
// evaluated with kernel.precise / kernel.real (double-F32 Real arithmetic in
// Bend) and labelled `exact-parameters` with its tolerance t: the recorded
// entity tolerance (validation.toleranceMm, vertexTolerancesMm) or the
// arithmetic guard, whichever is larger. Display triangles are never read.
// A quantity without a closed form is null and carries an explicit
// `unsupported` reason instead of a guess.
import { coords, number, real } from '../real.mjs';
import { EDGE_CLASSES, bodyExtent } from './edge-classes.mjs';
import { HttpError } from './http.mjs';
import { logicalFaces } from './logical-faces.mjs';
import { rustBodyFacts } from './rust-facts.mjs';
import { viewerRecord } from './model-record.mjs';
import { rustHostOf } from '../native/rust-host.mjs';
import { isRustRecord } from '../rust-review-scene.mjs';
import { binary64Math, circleParameter } from './binary64-math.mjs';

export const GEOMETRY_SCHEMA = 'wonky.viewer-geometry/1';
export const EXACT = 'exact-parameters';
// Floor of the parallel, coaxial and coplanar decisions (spec section 8); the
// measure decisions use pairAngularTolerance below, ANGULAR_RULE describes the
// per-body angularTolerance(body, t).
export const ANGULAR_TOLERANCE_RAD = 1e-9;
export const ANGULAR_RULE = 'max(1e-9 rad, stored-precision guard, t / body bounding-box diagonal)';
export const PAGE_SIZE = 500;
const FULL_TURN = 2 * Math.PI;
// Relative arithmetic guard per stored precision: one unit in the last place
// of the stored coordinates (F32) or of the Real arithmetic (F32x2).
const RELATIVE_GUARD = { F32: 2 ** -23, F32x2: 2 ** -44, binary64: 2 ** -50 };
// Stored precision of a body: Rust WC0 records are binary64 carriers.
const precisionOf = body => body?.precision ?? (isRustRecord(body) ? 'binary64' : undefined);
const LETTERS = { face: 'F', edge: 'E', vertex: 'V', logical: 'L' };
const KINDS = { F: 'face', E: 'edge', V: 'vertex', L: 'logical' };
const ALIAS = /^B([1-9][0-9]*)(?:\.([FEVL])([1-9][0-9]*))?$/;

export const aliasOf = (bodyIndex, kind = 'body', index = 0) => (kind === 'body'
  ? `B${bodyIndex + 1}` : `B${bodyIndex + 1}.${LETTERS[kind]}${index + 1}`);

// 'B1.F3' -> { bodyIndex: 0, kind: 'face', index: 2 }; null when malformed.
export function parseAlias(alias) {
  const match = ALIAS.exec(String(alias ?? ''));
  if (!match) return null;
  return {
    bodyIndex: Number(match[1]) - 1,
    kind: match[2] ? KINDS[match[2]] : 'body',
    index: match[3] ? Number(match[3]) - 1 : 0,
  };
}

// Vector helpers over kernel.precise. Inputs and outputs are plain [x, y, z]
// arrays in mm; every operation runs in Bend Real arithmetic.
const TINY = 1e-30;
const toReal = value => real(Math.abs(value) < TINY ? 0 : value);
const toVector = ([x, y, z]) => ({ $: 'V3', x: toReal(x), y: toReal(y), z: toReal(z) });

export function exactMath(kernel) {
  // The Rust kernel states its carriers in binary64 millimetres; no Bend Real.
  if (rustHostOf(kernel)) return binary64Math();
  if (!kernel?.precise || !kernel?.real) {
    throw new Error('Exact geometry needs the loaded Bend kernel (kernel.precise, kernel.real)');
  }
  const P = kernel.precise;
  const R = kernel.real;
  const dot = (a, b) => number(P.dot(toVector(a), toVector(b)));
  const norm = a => number(R.sqrt(P.dot(toVector(a), toVector(a))));
  return {
    dot,
    norm,
    cross: (a, b) => coords(P.cross(toVector(a), toVector(b))),
    sub: (a, b) => coords(P.sub(toVector(a), toVector(b))),
    add: (a, b) => coords(P.add(toVector(a), toVector(b))),
    scale: (a, s) => coords(P.scale(toVector(a), toReal(s))),
    normalize(a) {
      if (!(norm(a) > 0)) throw new Error('A zero-length direction has no orientation');
      return coords(P.normalize(toVector(a)));
    },
    atan2: (y, x) => number(R.atan2(toReal(y), toReal(x))),
    sqrt: value => number(R.sqrt(toReal(Math.max(0, value)))),
    // Point on the line through `point` along unit `direction` nearest to `target`.
    foot(point, direction, target) {
      const along = dot(coords(P.sub(toVector(target), toVector(point))), direction);
      return coords(P.add(toVector(point), P.scale(toVector(direction), toReal(along))));
    },
  };
}

const degrees = radians => radians * 180 / Math.PI;
const magnitude = points => points.reduce((max, point) => Math.max(max,
  ...point.map(value => Math.abs(value))), 1);

// Tolerances ----------------------------------------------------------------

const scales = new WeakMap();
function bodyScale(body) {
  if (!scales.has(body)) scales.set(body, magnitude(body.vertices ?? []));
  return scales.get(body);
}

// Angular guard (rad) of a body's stored unit vectors: one unit in the last
// place of the stored precision, never below ANGULAR_TOLERANCE_RAD. Shared
// with printability (bed faces).
export const precisionAngularGuard = body => Math.max(ANGULAR_TOLERANCE_RAD,
  RELATIVE_GUARD[precisionOf(body)] ?? RELATIVE_GUARD.F32);

const extents = new WeakMap();
// Angular tolerance (rad) of a parallel or coaxial decision on a body with
// entity tolerance t: two directions closer than t / (bounding-box diagonal)
// deviate by less than t across the whole body, the same rule as
// topology-classes (edge-classes.mjs); never below the precision guard.
export function angularTolerance(body, toleranceMm) {
  if (!extents.has(body)) extents.set(body, bodyExtent(body));
  const byTolerance = Number.isFinite(toleranceMm) && toleranceMm > 0
    ? toleranceMm / Math.max(extents.get(body), 1) : 0;
  return Math.max(precisionAngularGuard(body), byTolerance);
}

// Angular tolerance (rad) of a parallel or coaxial decision between two
// measured entities (exact-measure). `extentMm` is the lever arm the decision
// must hold over (measure.mjs: the bounding-box diagonal of both entities of
// a plane or axis pair, the axis entity of an axis/plane pair): two directions
// closer than t / extent deviate by less than t across it. The extent is
// floored at 1 mm, and the result never drops below either body's precision
// guard.
export const PAIR_ANGULAR_RULE = 'max(1e-9 rad, stored-precision guard of both bodies,'
  + ' t / max(1 mm, bounding-box diagonal of both entities; of the axis for an axis/plane'
  + ' pair))';
export function pairAngularTolerance(bodies, toleranceMm, extentMm) {
  const byTolerance = Number.isFinite(toleranceMm) && toleranceMm > 0
    && Number.isFinite(extentMm) ? toleranceMm / Math.max(extentMm, 1) : 0;
  return Math.max(...bodies.map(precisionAngularGuard), byTolerance);
}

export function arithmeticGuard(body) {
  return (RELATIVE_GUARD[precisionOf(body)] ?? RELATIVE_GUARD.F32) * bodyScale(body);
}

export function bodyTolerance(body) {
  const recorded = body.validation?.toleranceMm;
  return Math.max(Number.isFinite(recorded) ? recorded : 0, arithmeticGuard(body));
}

export function vertexTolerance(body, index) {
  const own = body.vertexTolerancesMm?.[index] ?? body.validation?.vertexTolerancesMm?.[index];
  return Math.max(Number.isFinite(own) ? own : bodyTolerance(body), arithmeticGuard(body));
}

const faceEdges = face => [...new Set((face.loops ?? []).flat().map(use => use.edge))];

export function edgeTolerance(body, index) {
  const edge = body.edges[index];
  return Math.max(bodyTolerance(body), vertexTolerance(body, edge.start),
    vertexTolerance(body, edge.end));
}

export function faceTolerance(body, index) {
  const edges = faceEdges(body.faces[index]);
  return Math.max(bodyTolerance(body), ...edges.map(edge => edgeTolerance(body, edge)));
}

// Logical faces --------------------------------------------------------------

const logicalCache = new WeakMap();
// logicalFaces(model) (topology-classes; the foundation stub has one group
// per face), computed once per model object.
export function cachedLogicalFaces(model) {
  if (!logicalCache.has(model)) logicalCache.set(model, logicalFaces(model));
  return logicalCache.get(model);
}

export function logicalGroup(logical, bodyIndex, faceIndex) {
  const body = logical?.bodies?.[bodyIndex];
  const groupIndex = body?.logicalOf?.[faceIndex];
  const group = groupIndex === undefined || groupIndex < 0 ? null : body.groups[groupIndex];
  if (!group) return null;
  return {
    alias: group.alias ?? aliasOf(bodyIndex, 'logical', groupIndex),
    index: groupIndex,
    fragments: group.fragments.map(fragment => aliasOf(bodyIndex, 'face', fragment)),
    fragmentIndices: [...group.fragments],
  };
}

// Surfaces -------------------------------------------------------------------

const curveType = edge => (typeof edge.curve === 'string' ? edge.curve : edge.curve?.type);

// Axis of a cylinder or cone: unit direction and the axis point nearest to
// the world origin, p = o - (o·a) a.
function axisOf(math, surface) {
  const direction = math.normalize(surface.axis);
  return { direction, pointNearestOriginMm: math.foot(surface.origin, direction, [0, 0, 0]) };
}

function planeSurface(math, surface, sense) {
  const normal = math.scale(math.normalize(surface.normal), sense);
  const along = math.dot(surface.x ?? [1, 0, 0], normal);
  const x = math.normalize(math.sub(surface.x ?? [1, 0, 0], math.scale(normal, along)));
  return {
    type: 'plane',
    originMm: [...surface.origin],
    normal,
    offsetMm: math.dot(surface.origin, normal),
    frame: { x, y: math.cross(normal, x) },
  };
}

function rimRadii(body, face) {
  const radii = faceEdges(face).map(edge => body.edges[edge])
    .filter(edge => curveType(edge) === 'circle').map(edge => edge.curve.radius);
  return [...new Set(radii)].sort((a, b) => a - b);
}

function describeSurface(math, body, face) {
  const surface = face.surface ?? {};
  const sense = face.sameSense === false ? -1 : 1;
  if (surface.type === 'plane') {
    const plane = planeSurface(math, surface, sense);
    return { surface: plane, outwardNormal: plane.normal, hole: null, axis: null };
  }
  if (surface.type === 'cylinder') {
    const axis = axisOf(math, surface);
    const hole = face.sameSense === false;
    return {
      surface: {
        type: 'cylinder', radiusMm: surface.radius, diameterMm: 2 * surface.radius, axis,
        originMm: [...surface.origin], sense: hole ? 'hole' : 'boss',
        normalSense: hole ? 'toward the axis' : 'away from the axis',
      },
      outwardNormal: null, hole, axis,
    };
  }
  if (surface.type === 'cone') {
    const axis = axisOf(math, surface);
    const hole = face.sameSense === false;
    const tangent = Math.tan(surface.angle);
    const apex = tangent > 0
      ? math.sub(surface.origin, math.scale(axis.direction, surface.radius / tangent)) : null;
    return {
      surface: {
        type: 'cone', halfAngleDeg: degrees(surface.angle), radiusAtOriginMm: surface.radius,
        originMm: [...surface.origin], apexMm: apex, axis, rimRadiiMm: rimRadii(body, face),
        sense: hole ? 'hole' : 'boss',
        normalSense: hole ? 'toward the axis' : 'away from the axis',
      },
      outwardNormal: null, hole, axis,
    };
  }
  return {
    surface: {
      type: surface.type ?? 'unknown',
      unsupported: `no closed-form exact descriptor for ${surface.type ?? 'unknown'} surfaces`,
    },
    outwardNormal: null, hole: null, axis: null,
  };
}

export function faceEntry(context, bodyIndex, index) {
  const { model, math, logical } = context;
  const body = model.bodies[bodyIndex];
  const face = body.faces[index];
  const described = describeSurface(math, body, face);
  const group = logicalGroup(logical, bodyIndex, index);
  const measured = rustBodyFacts(context.kernel, body)?.faces[index];
  return {
    ...(measured ? { areaMm2: measured.areaMm2, perimeterMm: measured.perimeterMm,
      measure: 'rust-kernel-measure' } : {}),
    alias: aliasOf(bodyIndex, 'face', index),
    bodyId: body.id,
    index,
    logical: group?.alias ?? null,
    fragments: group?.fragments ?? [aliasOf(bodyIndex, 'face', index)],
    surface: described.surface,
    outwardNormal: described.outwardNormal,
    hole: described.hole,
    axisPointNearestOrigin: described.axis?.pointNearestOriginMm ?? null,
    toleranceMm: faceTolerance(body, index),
    exactness: described.surface.unsupported ? 'unsupported' : EXACT,
  };
}

// Curves ---------------------------------------------------------------------

const encode = geometry => Object.fromEntries(Object.entries(geometry).map(([key, value]) => [
  key === 'type' ? '$' : key,
  key === 'type' ? value[0].toUpperCase() + value.slice(1)
    : Array.isArray(value) ? toVector(value) : toReal(value),
]));

// Parameter range of a circle or ellipse edge, as review-scene evaluates it:
// the recorded curveRange, a full turn for a closed edge, else the vertex
// parameters from kernel.analytic.curve_parameter.
export function curveRange(kernel, body, edge) {
  if (edge.curveRange) return [...edge.curveRange];
  const rust = rustHostOf(kernel);
  const curve = rust ? edge.curve : encode(edge.curve);
  const parameter = vertex => (rust ? circleParameter(curve, body.vertices[vertex])
    : number(kernel.analytic.curve_parameter(curve, toVector(body.vertices[vertex]))));
  if (edge.start === edge.end) {
    const first = parameter(edge.start);
    return [first, first + FULL_TURN];
  }
  const reversed = edge.sameSense === false;
  const first = parameter(reversed ? edge.end : edge.start);
  let last = parameter(reversed ? edge.start : edge.end);
  while (last <= first) last += FULL_TURN;
  return [first, last];
}

function describeCurve(context, body, edge) {
  const { math, kernel } = context;
  const type = curveType(edge);
  const start = body.vertices[edge.start];
  const end = body.vertices[edge.end];
  if (type === 'line') {
    const lengthMm = math.norm(math.sub(end, start));
    return {
      curve: {
        type: 'line', startMm: [...start], endMm: [...end],
        direction: lengthMm > 0 ? math.normalize(math.sub(end, start)) : null,
      },
      range: null, lengthMm,
    };
  }
  if (type === 'circle') {
    const range = curveRange(kernel, body, edge);
    const sweep = Math.min(FULL_TURN, range[1] - range[0]);
    const radius = edge.curve.radius;
    return {
      curve: {
        type: 'circle', centerMm: [...edge.curve.origin], normal: math.normalize(edge.curve.normal),
        radiusMm: radius, diameterMm: 2 * radius, sweepDeg: degrees(sweep),
        full: edge.start === edge.end && !edge.curveRange,
        startMm: [...start], endMm: [...end],
      },
      range, lengthMm: radius * sweep,
    };
  }
  if (type === 'ellipse') {
    const range = curveRange(kernel, body, edge);
    return {
      curve: {
        type: 'ellipse', centerMm: [...edge.curve.origin],
        normal: edge.curve.normal ? math.normalize(edge.curve.normal) : null,
        majorRadiusMm: edge.curve.major, minorRadiusMm: edge.curve.minor,
        sweepDeg: degrees(Math.min(FULL_TURN, range[1] - range[0])),
        startMm: [...start], endMm: [...end],
      },
      range, lengthMm: null,
      unsupported: 'ellipse arc length has no closed form (elliptic integral)',
    };
  }
  return {
    curve: { type: type ?? 'unknown', startMm: [...start], endMm: [...end] },
    range: null, lengthMm: null,
    unsupported: `no closed-form exact descriptor for ${type ?? 'unknown'} curves`,
  };
}

export function edgeEntry(context, bodyIndex, index) {
  const body = context.model.bodies[bodyIndex];
  const edge = body.edges[index];
  const described = describeCurve(context, body, edge);
  const code = context.classes?.bodies?.[bodyIndex]?.classes?.[index];
  return {
    alias: aliasOf(bodyIndex, 'edge', index),
    bodyId: body.id,
    index,
    curve: described.curve,
    range: described.range,
    lengthMm: described.lengthMm,
    ...(described.unsupported ? { unsupported: described.unsupported } : {}),
    class: code === undefined ? null : EDGE_CLASSES[code] ?? null,
    start: aliasOf(bodyIndex, 'vertex', edge.start),
    end: aliasOf(bodyIndex, 'vertex', edge.end),
    toleranceMm: edgeTolerance(body, index),
    exactness: described.curve.type === 'line' || described.curve.type === 'circle'
      ? EXACT : 'unsupported',
  };
}

export function vertexEntry(context, bodyIndex, index) {
  const body = context.model.bodies[bodyIndex];
  return {
    alias: aliasOf(bodyIndex, 'vertex', index),
    bodyId: body.id,
    index,
    point: [...body.vertices[index]],
    toleranceMm: vertexTolerance(body, index),
    exactness: EXACT,
  };
}

// Model-level data -----------------------------------------------------------

// Union of the recorded body bounds; null (not evaluated) when any body has
// none. The viewer labels the display envelope instead in that case.
export function recordedBounds(model) {
  const bounds = model.bodies.map(body => body.validation?.boundsMm ?? null);
  const missing = bounds.findIndex(value => !value);
  if (missing >= 0) {
    return {
      minMm: null, maxMm: null, exactness: 'recorded',
      note: `not evaluated: ${aliasOf(missing)} has no recorded bounds`,
    };
  }
  return {
    minMm: [0, 1, 2].map(axis => Math.min(...bounds.map(value => value.min[axis]))),
    maxMm: [0, 1, 2].map(axis => Math.max(...bounds.map(value => value.max[axis]))),
    exactness: 'recorded',
    scope: 'union of the recorded body bounds (validation.boundsMm); envelopes, not occupancy',
  };
}

function bodyRows(model) {
  return model.bodies.map((body, bodyIndex) => ({
    alias: aliasOf(bodyIndex),
    id: body.id,
    name: body.name ?? null,
    precision: precisionOf(body) ?? null,
    toleranceMm: bodyTolerance(body),
    recordedToleranceMm: body.validation?.toleranceMm ?? null,
    boundsMm: body.validation?.boundsMm ?? null,
    counts: { faces: body.faces.length, edges: body.edges.length, vertices: body.vertices.length },
  }));
}

// Entities -------------------------------------------------------------------

function entityList(model) {
  const list = [];
  for (const kind of ['face', 'edge', 'vertex']) {
    const key = { face: 'faces', edge: 'edges', vertex: 'vertices' }[kind];
    model.bodies.forEach((body, bodyIndex) => {
      for (let index = 0; index < body[key].length; index++) list.push([kind, bodyIndex, index]);
    });
  }
  return list;
}

// Resolves an alias against the model or throws 404 (unknown) / 400 (malformed).
export function locateAlias(model, alias) {
  const parsed = parseAlias(alias);
  if (!parsed) throw new HttpError(400, `Malformed geometry alias ${alias}`);
  const body = model.bodies[parsed.bodyIndex];
  const key = { face: 'faces', logical: 'faces', edge: 'edges', vertex: 'vertices' }[parsed.kind];
  const known = body && (parsed.kind === 'body' || parsed.kind === 'logical'
    || parsed.index < body[key].length);
  if (!known) throw new HttpError(404, `Unknown geometry alias ${alias}`);
  return parsed;
}

function logicalEntry(context, bodyIndex, groupIndex) {
  const body = context.logical?.bodies?.[bodyIndex];
  const group = body?.groups?.[groupIndex];
  if (!group) throw new HttpError(404, `Unknown geometry alias ${aliasOf(bodyIndex, 'logical',
    groupIndex)}`);
  const support = faceEntry(context, bodyIndex, group.fragments[0]);
  return {
    alias: group.alias ?? aliasOf(bodyIndex, 'logical', groupIndex),
    fragments: group.fragments.map(fragment => aliasOf(bodyIndex, 'face', fragment)),
    surface: support.surface,
    outwardNormal: support.outwardNormal,
    hole: support.hole,
    axisPointNearestOrigin: support.axisPointNearestOrigin,
    toleranceMm: Math.max(...group.fragments.map(fragment => faceTolerance(
      context.model.bodies[bodyIndex], fragment))),
    exactness: support.exactness,
    scope: 'support of the first fragment; topology-classes joins only fragments on the'
      + ' identical oriented support within tolerance',
  };
}

export function geometryEntities(rawModel, {
  aliases = null, page = 0, pageSize = PAGE_SIZE, kernel, modelId = null,
  logical = cachedLogicalFaces(rawModel), classes = null,
} = {}) {
  const model = viewerRecord(rawModel);
  const context = { model, kernel, math: exactMath(kernel), logical, classes };
  const faces = [];
  const edges = [];
  const vertices = [];
  const logicalFacesOut = [];
  const push = (kind, bodyIndex, index) => {
    if (kind === 'face') faces.push(faceEntry(context, bodyIndex, index));
    else if (kind === 'edge') edges.push(edgeEntry(context, bodyIndex, index));
    else if (kind === 'vertex') vertices.push(vertexEntry(context, bodyIndex, index));
    else if (kind === 'logical') logicalFacesOut.push(logicalEntry(context, bodyIndex, index));
  };
  let pages = 1;
  let current = 0;
  if (aliases?.length) {
    for (const alias of new Set(aliases)) {
      const { bodyIndex, kind, index } = locateAlias(model, alias);
      if (kind === 'body') throw new HttpError(400, `Body alias ${alias} has no single geometry;`
        + ' list its faces, edges or vertices');
      push(kind, bodyIndex, index);
    }
  } else {
    if (!Number.isInteger(pageSize) || pageSize < 1) throw new HttpError(400, 'Invalid page size');
    const list = entityList(model);
    pages = Math.max(1, Math.ceil(list.length / pageSize));
    current = Number(page);
    if (!Number.isInteger(current) || current < 0 || current >= pages) {
      throw new HttpError(400, `Page ${page} is out of range 0..${pages - 1}`);
    }
    for (const entry of list.slice(current * pageSize, (current + 1) * pageSize)) push(...entry);
  }
  return {
    schema: GEOMETRY_SCHEMA,
    modelId,
    units: 'mm',
    exactness: EXACT,
    angularToleranceRad: ANGULAR_TOLERANCE_RAD,
    method: context.math.label
      ? `closed forms over the carrier parameters the Rust kernel states, ${context.math.label}; display meshes are not used`
      : 'closed forms over stored analytic parameters, kernel.precise and kernel.real'
        + ' (double-F32 Real) in Bend; display meshes are not used',
    page: current,
    pages,
    pageSize: aliases?.length ? null : pageSize,
    bounds: recordedBounds(model),
    bodies: bodyRows(model),
    faces,
    edges,
    vertices,
    logicalFaces: logicalFacesOut,
  };
}
