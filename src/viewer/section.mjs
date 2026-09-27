// Exact section contours through `sectionSolid` (spec 9.2). Package: section.
//
// Frozen query-worker handler (kind `section`):
//   sectionQuery(model, { origin, normal, bodies? }, { signal }) -> result
//
// Every requested body goes through the kernel's `sectionSolid`
// (src/section.mjs, kernel/section.bend) against the one unbounded plane
// { origin, normal } in model mm. Nothing here decides geometry: the contours
// are the kernel's closed, directed rings, and a kernel failure is passed on
// verbatim (the message `requireResolvedSection` raises plus the full
// reason record). The only thing computed here is a display polyline per
// contour edge, sampled from the kernel's exact curve parameters within the
// display chord tolerance and labelled as such.
//
// result = {
//   schema: 'wonky.viewer-section/1', plane: { origin, normal },
//   status: 'resolved' | 'failed', reason?,            // reason: first failure message
//   contours: [{ body, bodyId, index, edges: [{ curve, range, forward, face, points }] }],
//   bodies: [{ alias, bodyId, status, relation?, contours, message?, detail?, face?,
//              kernelReason?, ms }],
//   exactness: { contours: 'kernel-resolved', points: 'display-approximation' },
//   displayToleranceMm, ms,
// }
// Body status: `resolved` (kernel Resolved, `relation` Empty or Transverse),
// `failed` (kernel Failed: FaceContact, FaceRejected, …), `unsupported` (the
// kernel adapter raised a capability error before sectioning) or `error`
// (anything else, with its message). `status` is `resolved` only when every
// requested body resolved; contours of resolved bodies are returned either
// way, tagged with their body, so a partial answer is never taken for a
// complete one.
import { CapabilityError, HttpError } from './http.mjs';
import { aliasOf } from './geometry.mjs';

export const SECTION_SCHEMA = 'wonky.viewer-section/1';
// Chord tolerance of the contour polylines (the viewer's display tolerance).
export const DISPLAY_TOLERANCE_MM = 0.02;
export const MAX_POINTS_PER_EDGE = 4096;
const TWO_PI = 2 * Math.PI;

const finite = value => typeof value === 'number' && Number.isFinite(value);
const isVector = value => Array.isArray(value) && value.length === 3 && value.every(finite);

// Plain [a, b, …] from a Bend list (Con/Nil) or an array.
export function items(values) {
  if (Array.isArray(values)) return values;
  const out = [];
  let cursor = values;
  while (cursor?.$ === 'Con') {
    out.push(cursor.head);
    cursor = cursor.tail;
  }
  if (cursor?.$ !== 'Nil') throw new Error('Unexpected Bend list representation');
  return out;
}

const scalar = value => (value && value.$ === 'Real' ? value.hi + value.lo : value);
const point = value => [scalar(value.x), scalar(value.y), scalar(value.z)];

// Validates the request body. Throws HttpError 400 on bad input.
export function parseSectionRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Section request must be an object { origin, normal }');
  }
  const { origin, normal, bodies } = body;
  if (!isVector(origin)) throw new HttpError(400, 'origin must be [x, y, z] in mm');
  if (!isVector(normal)) throw new HttpError(400, 'normal must be [x, y, z]');
  const length = Math.hypot(...normal);
  if (!(length > 1e-12)) throw new HttpError(400, 'normal must not be zero');
  if (origin.some(value => Math.abs(value) > 1e9)) {
    throw new HttpError(400, 'origin is out of range');
  }
  if (bodies !== undefined && (!Array.isArray(bodies) || bodies.length > 4096
    || !bodies.every(id => typeof id === 'string' && id.length <= 512))) {
    throw new HttpError(400, 'bodies must list body ids');
  }
  return {
    origin: [...origin], normal: [...normal],
    ...(bodies === undefined ? {} : { bodies: [...new Set(bodies)] }),
  };
}

// Point on an exact kernel curve at parameter t (Line, Circle, Ellipse).
export function curvePoint(curve, t) {
  if (curve.type === 'line') {
    return curve.origin.map((value, axis) => value + t * curve.direction[axis]);
  }
  const { origin, normal, x } = curve;
  const y = [normal[1] * x[2] - normal[2] * x[1], normal[2] * x[0] - normal[0] * x[2],
    normal[0] * x[1] - normal[1] * x[0]];
  const a = curve.type === 'circle' ? curve.radius : curve.major;
  const b = curve.type === 'circle' ? curve.radius : curve.minor;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return origin.map((value, axis) => value + a * c * x[axis] + b * s * y[axis]);
}

// Kernel curve record -> plain parameters in mm (JSON).
export function curveParameters(curve) {
  switch (curve?.$) {
    case 'Line':
      return { type: 'line', origin: point(curve.origin), direction: point(curve.direction) };
    case 'Circle':
      return { type: 'circle', origin: point(curve.origin), normal: point(curve.normal),
        x: point(curve.x), radius: scalar(curve.radius) };
    case 'Ellipse':
      return { type: 'ellipse', origin: point(curve.origin), normal: point(curve.normal),
        x: point(curve.x), major: scalar(curve.major), minor: scalar(curve.minor) };
    default:
      return { type: String(curve?.$ ?? 'unknown') };
  }
}

// Parameter range of a section piece: Interval [first, last], or the full
// period for an untrimmed circle or ellipse.
export function pieceRange(piece) {
  const domain = piece?.section?.domain;
  if (domain?.$ === 'Interval') return [scalar(domain.first), scalar(domain.last)];
  if (domain?.$ === 'Untrimmed') return [0, TWO_PI];
  throw new Error(`Unknown section domain ${domain?.$}`);
}

// Display polyline of a curve over [a, b]. Lines: the two end points.
// Conics: uniform parameter steps with chord error <= toleranceMm, from the
// bound |p''| <= R (R = radius or major radius): sagitta <= R dt^2 / 8.
export function sampleCurve(curve, [a, b], toleranceMm = DISPLAY_TOLERANCE_MM) {
  if (curve.type === 'line') return [curvePoint(curve, a), curvePoint(curve, b)];
  if (curve.type !== 'circle' && curve.type !== 'ellipse') {
    throw new CapabilityError(`Section curve ${curve.type} has no display sampling`);
  }
  const radius = curve.type === 'circle' ? curve.radius : Math.max(curve.major, curve.minor);
  const span = b - a;
  const step = Math.sqrt(8 * toleranceMm / Math.max(radius, toleranceMm));
  const count = Math.min(MAX_POINTS_PER_EDGE - 1,
    Math.max(Math.abs(span) >= TWO_PI - 1e-9 ? 16 : 2, Math.ceil(Math.abs(span) / step)));
  return Array.from({ length: count + 1 }, (_value, index) => curvePoint(curve,
    a + span * index / count));
}

// Achieved chord bound of a sampled conic (for the response): R (1 - cos(dt/2)).
export function chordBound(curve, [a, b], count) {
  if (curve.type === 'line') return 0;
  const radius = curve.type === 'circle' ? curve.radius : Math.max(curve.major, curve.minor);
  return radius * (1 - Math.cos(Math.abs(b - a) / count / 2));
}

const formatScalar = value => (Number.isInteger(value) ? String(value)
  : String(Number(value.toPrecision(12))));

function inline(value) {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== 'object') return typeof value === 'number' ? formatScalar(value)
    : String(value);
  if (Array.isArray(value)) return `[${value.map(inline).join(', ')}]`;
  if (value.$ === 'Real') return formatScalar(value.hi + value.lo);
  if (value.$ === 'V3') return `(${point(value).map(formatScalar).join(', ')})`;
  if (value.$ === 'Con' || value.$ === 'Nil') return `[${items(value).map(inline).join(', ')}]`;
  const fields = Object.entries(value).filter(([key]) => key !== '$')
    .map(([key, field]) => `${key} ${inline(field)}`);
  const tag = value.$ ?? '';
  return fields.length ? `${tag}(${fields.join(', ')})`.trim() : tag;
}

// "FaceContact face 0 › VertexContact edge 4 location StartVertex(…)": every
// tag and field of a kernel reason record, nested `reason` records as the
// next link. Nothing is dropped or reworded.
export function reasonChain(reason) {
  const links = [];
  let current = reason;
  while (current && typeof current === 'object' && current.$) {
    let next = null;
    const fields = [];
    for (const [key, value] of Object.entries(current)) {
      if (key === '$') continue;
      if (key === 'reason' && value && typeof value === 'object' && value.$) {
        next = value;
        continue;
      }
      fields.push(`${key} ${inline(value)}`);
    }
    links.push([current.$, ...fields].join(' '));
    current = next;
  }
  return links.join(' › ');
}

let modules = null;
async function kernelSection() {
  modules ??= import('../section.mjs').catch(error => {
    modules = null;
    throw error;
  });
  return modules;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason ?? new HttpError(499, 'Section query aborted');
}

// JSON contours of one Resolved kernel result.
export function contoursOf(result, bodyIndex, bodyId, toleranceMm = DISPLAY_TOLERANCE_MM) {
  const edges = items(result.edges);
  const pieces = items(result.pieces);
  return items(result.contours).map((ring, index) => ({
    body: aliasOf(bodyIndex), bodyId, index,
    edges: items(ring.uses).map(use => {
      const edge = edges[use.edge];
      const piece = pieces[use.edge];
      const curve = curveParameters(edge.curve);
      const range = pieceRange(piece);
      const points = sampleCurve(curve, range, toleranceMm);
      if (!use.forward) points.reverse();
      return {
        edge: use.edge, forward: !!use.forward, curve, range,
        face: aliasOf(bodyIndex, 'face', piece.face.index),
        chordBoundMm: chordBound(curve, range, points.length - 1),
        points,
      };
    }),
  }));
}

async function sectionBody(section, body, bodyIndex, plane) {
  const alias = aliasOf(bodyIndex);
  const started = performance.now();
  const done = entry => ({ alias, bodyId: body.id, ...entry,
    ms: Math.round((performance.now() - started) * 10) / 10 });
  let result;
  try {
    result = await section.sectionSolid(body, plane, {});
  } catch (error) {
    const kind = error?.name === 'UnsupportedFeatureError' ? 'unsupported' : 'error';
    return done({ status: kind, message: String(error?.message ?? error), contours: [] });
  }
  if (result.$ === 'Resolved') {
    return done({ status: 'resolved', relation: result.relation?.$ ?? null,
      contours: contoursOf(result, bodyIndex, body.id) });
  }
  let message;
  try {
    section.requireResolvedSection(result);
    message = `Solid/plane section ${result.$}`;
  } catch (error) {
    message = String(error?.message ?? error);
  }
  const faceIndex = result.reason?.face;
  return done({
    status: 'failed', message, detail: reasonChain(result.reason),
    face: Number.isInteger(faceIndex) ? aliasOf(bodyIndex, 'face', faceIndex) : null,
    kernelReason: result.reason ?? null, contours: [],
  });
}

// Query-worker handler (kind `section`).
export async function sectionQuery(model, payload, { signal } = {}) {
  const bodies = Array.isArray(model?.bodies) ? model.bodies : [];
  if (!bodies.length) {
    throw new CapabilityError('Exact section needs at least one body; this model has none');
  }
  const request = parseSectionRequest(payload);
  const wanted = request.bodies ? new Set(request.bodies) : null;
  if (wanted) {
    const known = new Set(bodies.map(body => body.id));
    const unknown = [...wanted].filter(id => !known.has(id));
    if (unknown.length) throw new HttpError(400, `Unknown body ${unknown[0]}`);
  }
  const started = performance.now();
  const section = await kernelSection();
  const plane = { origin: request.origin, normal: request.normal };
  const results = [];
  for (const [index, body] of bodies.entries()) {
    if (wanted && !wanted.has(body.id)) continue;
    throwIfAborted(signal);
    results.push(await sectionBody(section, body, index, plane));
  }
  throwIfAborted(signal);
  const failed = results.find(entry => entry.status !== 'resolved');
  return {
    schema: SECTION_SCHEMA,
    plane,
    status: failed ? 'failed' : 'resolved',
    ...(failed ? { reason: `${failed.alias}: ${failed.message}` } : {}),
    contours: results.flatMap(entry => entry.contours),
    bodies: results.map(({ contours, ...entry }) => ({ ...entry, contours: contours.length })),
    exactness: { contours: 'kernel-resolved', points: 'display-approximation' },
    displayToleranceMm: DISPLAY_TOLERANCE_MM,
    ms: Math.round((performance.now() - started) * 10) / 10,
  };
}
