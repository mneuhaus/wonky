// FDM printability per body (spec 3.6, D20). Package: fdm.
//
// Frozen query-worker handler (kind `printability`):
//   printabilityQuery(model, { alphaDeg, smallBoreMm, bodies, plateMm }, { signal })
//     -> { schema, alphaDeg, betaDeg, conventions, exemptions, plate, bodies }
//
// Conventions (cad-khana, printability/overhangs.py and holes.py):
//   - α = asin(max(0, −n·up)) is the overhang angle of an outward normal n,
//     measured from vertical. A face overhangs when α > α_max + slack; the
//     slack is 1e-6° (cad-khana) or the angular guard of the stored
//     precision when that is larger, so a 45° chamfer passes at α_max = 45°.
//   - The slicer threshold angle (OrcaSlicer, Bambu Studio) is β = 90° − α_max.
//   - Hole cylinders with Ø <= smallBoreMm (cad-khana SMALL_BORE_MM = 12) are
//     exempt ("exempt-small-bore") where they would otherwise overhang.
//   - The bridge exemption (flat ceilings <= 10 mm, cad-khana BRIDGE_MAX_MM) is
//     not applied; the response says so.
//   - Bed faces are planar faces with n = −up at the body minimum along up;
//     they are excluded from the overhang set.
//
// Exactness: planar classifications and the angular bands of cylinders and
// cones are closed forms over the stored analytic parameters
// (`exact-parameters`). A curved face's band is intersected with the face's
// own angular coverage from its circle edges (exact curve parameters); a face
// without circle edges keeps the band of its supporting surface and says so.
// The body minimum along up is `recorded` (validation.boundsMm, only for an
// axis-aligned up) or `kernel-resolved` (boundEdgePlaneBand over every edge:
// on solids bounded by planes, cylinders and cones every directional extreme
// lies on an edge). Nothing here reads display triangles; the viewer tints
// curved bands from exact per-vertex normals and labels that as display.
import { number, real, vector } from '../real.mjs';
import {
  aliasOf, bodyTolerance, cachedLogicalFaces, curveRange, faceTolerance, precisionAngularGuard,
} from './geometry.mjs';
import { HttpError } from './http.mjs';
import { rustHostOf } from '../native/rust-host.mjs';
import { circlePoint } from './binary64-math.mjs';

export const PRINTABILITY_SCHEMA = 'wonky.viewer-printability/1';
export const DEFAULT_ALPHA_DEG = 45;
export const DEFAULT_SMALL_BORE_MM = 12;
export const DEFAULT_PLATE_MM = Object.freeze([256, 256]);
export const BRIDGE_MAX_MM = 10;
export const SLACK_DEG = 1e-6;
export const MAX_BODIES = 4096;
export const DEFAULT_UP = Object.freeze([0, 0, 1]);
// Parallel decisions (bed faces): the arithmetic guard of spec section 8, or
// the angular guard of the stored precision when larger.
export { ANGULAR_TOLERANCE_RAD } from './geometry.mjs';
// Contact cap of the edge bands (the audit probes and the curve-band tests).
const BAND_CONTACT_TOLERANCE = 1e-7;
const FULL_TURN_DEG = 360;
const DEG = Math.PI / 180;

const finite = value => typeof value === 'number' && Number.isFinite(value);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]];
const length = a => Math.hypot(a[0], a[1], a[2]);
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const unit = a => {
  const size = length(a);
  if (!(size > 0)) throw new Error('A zero-length direction has no orientation');
  return scale(a, 1 / size);
};
const wrapDeg = value => ((value % FULL_TURN_DEG) + FULL_TURN_DEG) % FULL_TURN_DEG;
const degrees = radians => radians / DEG;

export const betaOf = alphaDeg => 90 - alphaDeg;

// Angular guard (rad) of a body's stored unit vectors (geometry.mjs, the same
// guard exact-measure's decisions start from).
export const angularGuard = precisionAngularGuard;

// Decision slack (deg) of the α > α_max test for a body.
export const slackDeg = body => Math.max(SLACK_DEG, degrees(angularGuard(body)));

// ---- Request ---------------------------------------------------------------

const isVector = value => Array.isArray(value) && value.length === 3 && value.every(finite);

// Shape check of a request body (no model needed). Throws HttpError(400).
export function checkRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'The printability request must be a JSON object');
  }
  const alphaDeg = body.alphaDeg ?? DEFAULT_ALPHA_DEG;
  if (!finite(alphaDeg) || alphaDeg <= 0 || alphaDeg >= 90) {
    throw new HttpError(400, 'alphaDeg must be a number of degrees between 0 and 90 (exclusive)');
  }
  const smallBoreMm = body.smallBoreMm === undefined ? DEFAULT_SMALL_BORE_MM : body.smallBoreMm;
  if (smallBoreMm !== null && smallBoreMm !== false
    && (!finite(smallBoreMm) || smallBoreMm < 0 || smallBoreMm > 1000)) {
    throw new HttpError(400, 'smallBoreMm must be a diameter in mm (0 to 1000), or null for off');
  }
  const plateMm = body.plateMm ?? DEFAULT_PLATE_MM;
  if (!Array.isArray(plateMm) || plateMm.length !== 2
    || !plateMm.every(value => finite(value) && value > 0 && value <= 10000)) {
    throw new HttpError(400, 'plateMm must be [width, depth] in mm (each 0 to 10000)');
  }
  let bodies = null;
  if (body.bodies !== undefined && body.bodies !== null) {
    if (!Array.isArray(body.bodies) || body.bodies.length > MAX_BODIES) {
      throw new HttpError(400, `bodies must be a list of at most ${MAX_BODIES} entries`);
    }
    const seen = new Set();
    bodies = body.bodies.map(entry => {
      if (!entry || typeof entry.bodyId !== 'string' || !entry.bodyId) {
        throw new HttpError(400, 'Every bodies entry needs a bodyId string');
      }
      if (seen.has(entry.bodyId)) throw new HttpError(400, `Body ${entry.bodyId} is listed twice`);
      seen.add(entry.bodyId);
      const up = entry.up ?? DEFAULT_UP;
      if (!isVector(up) || !(length(up) > 1e-12)) {
        throw new HttpError(400, `up of body ${entry.bodyId} must be a nonzero [x, y, z] vector`);
      }
      if (entry.printed !== undefined && typeof entry.printed !== 'boolean') {
        throw new HttpError(400, `printed of body ${entry.bodyId} must be true or false`);
      }
      return { bodyId: entry.bodyId, up: unit(up), printed: entry.printed !== false };
    });
  }
  return {
    alphaDeg,
    smallBoreMm: smallBoreMm === false ? null : smallBoreMm,
    plateMm: [...plateMm],
    bodies,
  };
}

// ---- Planar faces ------------------------------------------------------------

// α (deg) of an outward unit normal against a unit up axis.
export function overhangAngle(normal, up) {
  const downward = Math.min(1, Math.max(0, -dot(normal, up)));
  return degrees(Math.asin(downward));
}

// Angle (rad) between n and −up, well conditioned near 0.
const antiParallelAngle = (normal, up) => Math.atan2(length(cross(normal, up)), -dot(normal, up));

// ---- Curved faces ------------------------------------------------------------

// Overhang band of a cylinder (halfAngleRad 0) or cone about its axis, in
// degrees from the surface frame x toward y = axis × x. The outward normal at
// u is n(u) = s (cos θ ρ(u) − sin θ a) with ρ(u) = cos u x + sin u y and
// s = +1 (boss) or −1 (hole), so
//   −n·up = −s cos θ R cos(u − φ) + s sin θ (a·up),  R = hypot(x·up, y·up),
//   φ = atan2(y·up, x·up).
// The face overhangs where −n·up > sin(α_max + slack): an interval centred on
// φ (K > 0) or φ + 180° (K < 0), with K = −s cos θ R.
// Returns { kind: 'none' | 'full' | 'band', centerDeg?, halfWidthDeg?, bandsDeg }.
export function curvedBand({ sense, halfAngleRad = 0, axis, x, y, up, alphaDeg, slack = 0 }) {
  const threshold = Math.sin((alphaDeg + slack) * DEG);
  const ux = dot(x, up);
  const uy = dot(y, up);
  const ua = dot(axis, up);
  const radial = Math.hypot(ux, uy);
  const k = -sense * Math.cos(halfAngleRad) * radial;
  const c = sense * Math.sin(halfAngleRad) * ua;
  if (Math.abs(k) < 1e-15) {
    return c > threshold ? { kind: 'full', bandsDeg: [[0, FULL_TURN_DEG]] }
      : { kind: 'none', bandsDeg: [] };
  }
  const phi = degrees(Math.atan2(uy, ux));
  const centerDeg = wrapDeg(k > 0 ? phi : phi + 180);
  const t = (threshold - c) / Math.abs(k);
  if (t >= 1) return { kind: 'none', bandsDeg: [] };
  if (t <= -1) return { kind: 'full', bandsDeg: [[0, FULL_TURN_DEG]] };
  const halfWidthDeg = degrees(Math.acos(t));
  const start = wrapDeg(centerDeg - halfWidthDeg);
  return {
    kind: 'band', centerDeg, halfWidthDeg, bandsDeg: [[start, start + 2 * halfWidthDeg]],
  };
}

// Intersection of angular intervals [start, end] (deg, start in [0, 360),
// end possibly past 360) on the circle.
export function intersectIntervals(left, right) {
  const result = [];
  for (const [a, b] of left) {
    for (const [c, d] of right) {
      for (const shift of [-FULL_TURN_DEG, 0, FULL_TURN_DEG]) {
        const start = Math.max(a, c + shift);
        const end = Math.min(b, d + shift);
        if (end - start > 1e-9) result.push([start, end]);
      }
    }
  }
  return result.map(([start, end]) => {
    const wrapped = wrapDeg(start);
    return [wrapped, wrapped + (end - start)];
  }).sort((p, q) => p[0] - q[0]);
}

const isFull = intervals => intervals.some(([start, end]) => end - start >= FULL_TURN_DEG - 1e-9);

// Angle (deg) of a point about a surface axis in its frame.
const angleIn = (frame, point) => {
  const relative = sub(point, frame.origin);
  return wrapDeg(degrees(Math.atan2(dot(relative, frame.y), dot(relative, frame.x))));
};

const encodeCircle = curve => ({
  $: 'Circle', origin: vector(curve.origin), normal: vector(curve.normal), x: vector(curve.x),
  radius: real(curve.radius),
});

// Angular coverage (deg) of a cylinder or cone face about its axis, from its
// circle edges: exact curve parameters, evaluated with kernel.analytic.
// null when the face has no circle edge (coverage not evaluated).
export function faceCoverage(kernel, body, face, frame) {
  const edges = [...new Set((face.loops ?? []).flat().map(use => use.edge))]
    .map(index => body.edges[index]);
  return edgeCoverage(kernel, body, edges, frame);
}

// Angular coverage (deg) of the circle edges among `edges` about the axis of
// `frame` ({ origin on the axis, x, y }), union of their arcs; null when none
// of them is a circle. exact-measure uses it for single rims.
export function edgeCoverage(kernel, body, edges, frame) {
  const circles = edges.filter(edge => (edge.curve?.type ?? edge.curve) === 'circle');
  if (!circles.length) return null;
  const intervals = [];
  for (const edge of circles) {
    const [first, last] = curveRange(kernel, body, edge);
    if (last - first >= 2 * Math.PI - 1e-12) return [[0, FULL_TURN_DEG]];
    const rust = rustHostOf(kernel);
    const curve = rust ? edge.curve : encodeCircle(edge.curve);
    const point = t => {
      if (rust) return circlePoint(curve, t);
      const value = kernel.analytic.curve_point(curve, real(t));
      return [number(value.x), number(value.y), number(value.z)];
    };
    const [a, m, b] = [first, (first + last) / 2, last].map(t => angleIn(frame, point(t)));
    const toMid = wrapDeg(m - a);
    const toEnd = wrapDeg(b - a);
    intervals.push(toMid <= toEnd ? [a, a + toEnd] : [b, b + wrapDeg(a - b)]);
  }
  // Union of the arcs (the rims of one face usually coincide).
  intervals.sort((p, q) => p[0] - q[0]);
  const merged = [];
  for (const interval of intervals) {
    const last = merged.at(-1);
    if (last && interval[0] <= last[1] + 1e-9) last[1] = Math.max(last[1], interval[1]);
    else merged.push([...interval]);
  }
  return merged;
}

// ---- Bodies ------------------------------------------------------------------

const AXES = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const isUnitAxis = direction => {
  const index = direction.findIndex(value => Math.abs(value) === 1);
  return index >= 0 && direction.every((value, axis) => axis === index || value === 0)
    ? { axis: index, sign: Math.sign(direction[index]) } : null;
};
const sameDirection = (a, b) => a.every((value, axis) => value === b[axis]);

const bandCache = new WeakMap();

// Exact min and max of p·direction over a body, by edge bands (Bend). Cached
// per body object and direction (the query worker keeps parsed models).
async function kernelExtremes(body, direction, { signal } = {}) {
  if (!bandCache.has(body)) bandCache.set(body, new Map());
  const cache = bandCache.get(body);
  const key = direction.join(',');
  if (!cache.has(key)) {
    const run = (async () => {
      const { boundEdgePlaneBand } = await import('../curve-band.mjs');
      const plane = { type: 'plane', origin: [0, 0, 0], normal: direction };
      let min = Infinity;
      let max = -Infinity;
      for (let edge = 0; edge < body.edges.length; edge++) {
        if (signal?.aborted) throw new HttpError(499, 'Printability query aborted');
        const band = await boundEdgePlaneBand(body, edge, plane,
          { contactTolerance: BAND_CONTACT_TOLERANCE });
        if (band.$ !== 'Resolved') {
          return {
            status: 'unresolved', edge,
            reason: `curve band ${band.$} on edge E${edge + 1}: ${band.reason?.$ ?? 'no reason'}`,
          };
        }
        min = Math.min(min, number(band.evidence.minimum.signed_distance));
        max = Math.max(max, number(band.evidence.maximum.signed_distance));
      }
      if (!body.edges.length) return { status: 'unresolved', reason: 'the body has no edges' };
      return { status: 'resolved', min, max };
    })();
    cache.set(key, run);
    run.catch(() => cache.delete(key));
    run.then(result => {
      if (result.status !== 'resolved') cache.delete(key);
    }, () => {});
  }
  return cache.get(key);
}

const KERNEL_METHOD = 'boundEdgePlaneBand over every edge (Bend): exact min and max signed'
  + ' distance of each edge to the plane through the origin normal to the direction';
const RECORDED_METHOD = 'validation.boundsMm (recorded at build time)';

// { minMm, maxMm, exactness, method } of p·direction, or { unresolved, reason }.
export async function bodyExtent(body, direction, options = {}) {
  const aligned = isUnitAxis(direction);
  const bounds = body.validation?.boundsMm;
  if (aligned && bounds?.min && bounds?.max) {
    const low = bounds.min[aligned.axis];
    const high = bounds.max[aligned.axis];
    return {
      minMm: aligned.sign > 0 ? low : -high, maxMm: aligned.sign > 0 ? high : -low,
      exactness: 'recorded', method: RECORDED_METHOD,
    };
  }
  const result = await kernelExtremes(body, direction, options);
  if (result.status !== 'resolved') return { unresolved: true, reason: result.reason };
  return {
    minMm: result.min, maxMm: result.max, exactness: 'kernel-resolved', method: KERNEL_METHOD,
  };
}

// Footprint on the plate (world XY, plate centred on the origin).
async function footprintOf(body, plateMm, tolerance, options) {
  const extents = [];
  for (const axis of [0, 1]) {
    const extent = await bodyExtent(body, AXES[axis], options);
    if (extent.unresolved) return { evaluated: false, reason: extent.reason };
    extents.push(extent);
  }
  const half = plateMm.map(value => value / 2);
  const exceeds = extents.some((extent, axis) => extent.minMm < -half[axis] - tolerance
    || extent.maxMm > half[axis] + tolerance);
  return {
    evaluated: true,
    exceeds,
    minMm: extents.map(extent => extent.minMm),
    maxMm: extents.map(extent => extent.maxMm),
    exactness: extents.some(extent => extent.exactness === 'kernel-resolved')
      ? 'kernel-resolved' : 'recorded',
  };
}

// ---- Classification ------------------------------------------------------------

const surfaceFrame = surface => {
  const axis = unit(surface.axis);
  const along = dot(surface.x ?? [1, 0, 0], axis);
  const x = unit(sub(surface.x ?? [1, 0, 0], scale(axis, along)));
  return { origin: [...surface.origin], axis, x, y: cross(axis, x) };
};

function classifyCurved(context, body, face, surface) {
  const { request, up, slack, kernel } = context;
  const frame = surfaceFrame(surface);
  const hole = face.sameSense === false;
  const halfAngleRad = surface.type === 'cone' ? surface.angle : 0;
  const band = curvedBand({
    sense: hole ? -1 : 1, halfAngleRad, axis: frame.axis, x: frame.x, y: frame.y, up,
    alphaDeg: request.alphaDeg, slack,
  });
  const coverage = faceCoverage(kernel, body, face, frame);
  const bandsDeg = !band.bandsDeg.length ? []
    : coverage ? intersectIntervals(band.bandsDeg, coverage) : band.bandsDeg;
  const entry = {
    surface: surface.type,
    hole,
    ...(surface.type === 'cylinder' ? { diameterMm: 2 * surface.radius }
      : { halfAngleDeg: degrees(surface.angle) }),
    band: {
      kind: band.kind,
      centerDeg: band.centerDeg ?? null,
      halfWidthDeg: band.halfWidthDeg ?? null,
      supportingBandsDeg: band.bandsDeg,
      coverageDeg: coverage,
      scope: coverage ? 'face (supporting band ∩ angular coverage of the circle edges)'
        : 'supporting surface (face has no circle edge; trim not evaluated)',
      frame: { axis: frame.axis, x: frame.x, y: frame.y },
      angleConvention: 'degrees about the axis from the frame x toward y = axis × x',
    },
    bandsDeg,
  };
  const overhangs = isFull(bandsDeg) || bandsDeg.length > 0;
  const smallBore = context.request.smallBoreMm;
  const exempt = surface.type === 'cylinder' && hole && smallBore !== null
    && 2 * surface.radius <= smallBore + context.toleranceOf(face);
  if (overhangs && exempt) {
    return {
      ...entry, kind: 'exempt-small-bore',
      reason: `hole Ø${2 * surface.radius} mm <= ${smallBore} mm: self-supporting small bore`
        + ' (cad-khana SMALL_BORE_MM); its ceiling band is not tinted',
    };
  }
  return { ...entry, kind: overhangs ? 'overhang' : 'ok' };
}

function classifyPlanar(context, body, face, surface) {
  const { up, slack, request, extent } = context;
  const sense = face.sameSense === false ? -1 : 1;
  const normal = scale(unit(surface.normal), sense);
  const angleDeg = overhangAngle(normal, up);
  const entry = { surface: 'plane', normal, angleDeg, offsetAlongUpMm: dot(surface.origin, up) };
  if (antiParallelAngle(normal, up) <= angularGuard(body) * 4) {
    if (!extent || extent.unresolved) {
      return {
        ...entry, kind: 'unsupported',
        reason: 'bed contact unknown: the body minimum along up is unresolved'
          + (extent?.reason ? ` (${extent.reason})` : ''),
      };
    }
    const tolerance = context.toleranceOf(face);
    if (Math.abs(entry.offsetAlongUpMm - extent.minMm) <= tolerance) {
      return { ...entry, kind: 'bed', reason: 'n = −up at the body minimum along up' };
    }
  }
  return { ...entry, kind: angleDeg > request.alphaDeg + slack ? 'overhang' : 'ok' };
}

function classifyGroup(context, body, bodyIndex, group) {
  const faceIndex = group.fragments[0];
  const face = body.faces[faceIndex];
  const surface = face.surface ?? {};
  const toleranceMm = Math.max(...group.fragments.map(index => faceTolerance(body, index)));
  const base = {
    alias: group.alias ?? aliasOf(bodyIndex, 'logical', group.index),
    fragments: group.fragments.map(index => aliasOf(bodyIndex, 'face', index)),
    toleranceMm,
  };
  const local = { ...context, toleranceOf: () => toleranceMm };
  let result;
  if (surface.type === 'plane') result = classifyPlanar(local, body, face, surface);
  else if (surface.type === 'cylinder' || surface.type === 'cone') {
    result = classifyCurved(local, body, face, surface);
  } else {
    result = {
      surface: surface.type ?? 'unknown', kind: 'unsupported',
      reason: `no closed-form overhang classification for ${surface.type ?? 'unknown'} surfaces`,
    };
  }
  return {
    ...base, ...result,
    exactness: result.kind === 'unsupported' ? 'unsupported'
      : result.kind === 'bed' ? context.extent.exactness : 'exact-parameters',
  };
}

const COUNT_KINDS = ['ok', 'overhang', 'bed', 'exempt-small-bore', 'unsupported'];

function plateRelation({ up, extent, bedFaces, footprint, tolerance }) {
  if (!extent || extent.unresolved) {
    return {
      relation: 'unresolved', reason: extent?.reason ?? 'not evaluated', bedFaces,
      exactness: 'unsupported', toleranceMm: tolerance,
    };
  }
  const base = {
    minAlongUpMm: extent.minMm, bedFaces, exactness: extent.exactness, method: extent.method,
    toleranceMm: tolerance,
  };
  if (!sameDirection(up, DEFAULT_UP)) {
    return {
      ...base, relation: bedFaces.length ? 'bed-faces' : 'no-bed-face',
      note: 'up is not +Z: the plate relation is the body minimum along up; geometry is not moved',
    };
  }
  const min = extent.minMm;
  const relation = Math.abs(min) <= tolerance ? 'on-plate' : min > 0 ? 'floats' : 'cuts';
  return {
    ...base, relation,
    distanceMm: relation === 'on-plate' ? 0 : Math.abs(min),
    footprint,
  };
}

// Printability of one body (async: body extents may need the kernel).
async function bodyPrintability(model, bodyIndex, settings, request, options) {
  const body = model.bodies[bodyIndex];
  const base = {
    bodyId: body.id, alias: aliasOf(bodyIndex), name: body.name ?? null, up: [...settings.up],
    printed: settings.printed,
  };
  if (!settings.printed) {
    return {
      ...base, plate: null, faces: [], counts: null,
      note: 'not printed: excluded from the overhang and plate checks',
    };
  }
  const tolerance = bodyTolerance(body);
  const extent = await bodyExtent(body, settings.up, options);
  const upIsZ = sameDirection(settings.up, DEFAULT_UP);
  const footprint = upIsZ && !extent.unresolved
    ? await footprintOf(body, request.plateMm, tolerance, options) : null;
  const context = {
    request, up: settings.up, slack: slackDeg(body), kernel: options.kernel, extent,
  };
  const groups = options.logical.bodies[bodyIndex].groups;
  const faces = groups.map((group, index) => classifyGroup(context, body, bodyIndex,
    { ...group, index }));
  const counts = Object.fromEntries(COUNT_KINDS.map(kind => [kind,
    faces.filter(face => face.kind === kind).length]));
  const bedFaces = faces.filter(face => face.kind === 'bed').map(face => face.alias);
  return {
    ...base,
    slackDeg: context.slack,
    toleranceMm: tolerance,
    plate: plateRelation({ up: settings.up, extent, bedFaces, footprint, tolerance }),
    faces,
    counts,
  };
}

export function conventions(request) {
  return {
    overhang: 'α = asin(max(0, −n·up)) from vertical; a face overhangs when α > α_max'
      + ' (cad-khana convention); slack 1e-6° or the stored-precision guard',
    slicer: 'β = 90° − α_max: the slicer threshold angle from horizontal (OrcaSlicer, Bambu'
      + ' Studio)',
    legend: `overhang α > ${request.alphaDeg}° from vertical (slicer threshold β = `
      + `${betaOf(request.alphaDeg)}°)`,
    bands: 'cylinder and cone bands are exact on the stored parameters; the viewer draws them'
      + ' from exact per-vertex normals over display strips',
    slackDeg: SLACK_DEG,
  };
}

export function exemptions(request) {
  const smallBore = request.smallBoreMm;
  return {
    bed: { applied: true, note: 'planar faces with n = −up at the body minimum along up' },
    smallBore: {
      applied: smallBore !== null,
      maxDiameterMm: smallBore,
      note: smallBore === null ? 'small-bore exemption off'
        : `hole cylinders Ø <= ${smallBore} mm are self-supporting (cad-khana SMALL_BORE_MM)`,
    },
    bridge: {
      applied: false,
      maxSpanMm: BRIDGE_MAX_MM,
      note: `bridge exemption (<= ${BRIDGE_MAX_MM} mm) not applied: it needs span analysis of`
        + ' anchored flat regions',
    },
  };
}

// The printability of a model for a checked request (see checkRequest).
// options: { kernel, logical, signal }.
export async function printabilityOf(model, request, options) {
  const entries = new Map((request.bodies ?? []).map(entry => [entry.bodyId, entry]));
  for (const bodyId of entries.keys()) {
    if (!model.bodies.some(body => body.id === bodyId)) {
      throw new HttpError(400, `Unknown body ${bodyId} in this revision`);
    }
  }
  const indices = request.bodies
    ? request.bodies.map(entry => model.bodies.findIndex(body => body.id === entry.bodyId))
    : model.bodies.map((_body, index) => index);
  const logical = options.logical ?? cachedLogicalFaces(model);
  const bodies = [];
  for (const index of indices) {
    const settings = entries.get(model.bodies[index].id) ?? { up: [...DEFAULT_UP], printed: true };
    bodies.push(await bodyPrintability(model, index, settings, request, { ...options, logical }));
  }
  return {
    schema: PRINTABILITY_SCHEMA,
    units: 'mm',
    alphaDeg: request.alphaDeg,
    betaDeg: betaOf(request.alphaDeg),
    smallBoreMm: request.smallBoreMm,
    conventions: conventions(request),
    exemptions: exemptions(request),
    plate: { sizeMm: [...request.plateMm], center: [0, 0, 0], up: [...DEFAULT_UP] },
    bodies,
  };
}

// Query-worker handler (kind `printability`).
export async function printabilityQuery(model, payload, { signal } = {}) {
  const request = checkRequest(payload);
  const { loadKernel } = await import('../kernel.mjs');
  const kernel = await loadKernel();
  return printabilityOf(model, request, { kernel, signal });
}
