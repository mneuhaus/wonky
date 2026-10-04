// Binary draw payload (spec 9.3, `wonky.draw/1`). Package: render-transport.
//
// Frozen producer signature:
//   buildDrawPayload(model, scene, { logical, classes }) -> { header, buffer } | null
// `null` means "compute lazily in the query worker": no display scene was
// passed, or the Bend display module is not loaded yet (loadDrawKernel()).
//
// The arrays come from viewer/render/draw-decode.js (shared with the
// browser's JSON adapter, so picking data is identical): float32 positions
// relative to the model center (subtracted in float64), triangle winding
// normalized to the outward display normal, per-vertex face and body, B-rep
// vertex points, edge polylines with their class, logical faces. What this
// module adds: exact per-vertex normals for planes, cylinders and cones,
// evaluated in Bend from the stored surface parameters at each display
// vertex (other faces keep their triangle normals, flagged `display`), and
// the header (aliases, appearance, tolerances, notes).
//
// Query-worker handler (kind `draw`): drawQuery(model, payload, { signal })
// with payload { modelId, scene? }. `scene` is an optional prepared review
// scene (an in-process shortcut); without it the handler prepares one.
import { loadKernel } from '../kernel.mjs';
import { real, vector, coords } from '../real.mjs';
import { reviewScene } from '../review-scene.mjs';
import { isRustRecord } from '../rust-review-scene.mjs';
import {
  DRAW_MAGIC as SHARED_MAGIC, DRAW_SCHEMA as SHARED_SCHEMA, EDGE_CLASS_NAMES, UNRESOLVED_CLASS,
  buildDrawArrays, encodeDraw, pointKey,
} from '../../viewer/render/draw-decode.js';
import { CapabilityError } from './http.mjs';
import { classifyEdges } from './edge-classes.mjs';
import { logicalFaces } from './logical-faces.mjs';
import { viewerRecord } from './model-record.mjs';

export const DRAW_SCHEMA = SHARED_SCHEMA;
export const DRAW_MAGIC = SHARED_MAGIC; // 'WKD1' little-endian
// Bumped whenever the payload bytes for the same model change.
export const DRAW_VERSION = 1;
export const OCT16_MAX_ERROR_DEG = 0.004;

export const drawEtag = modelId => `"${modelId}.wkd1.v${DRAW_VERSION}"`;

let display = null;
let loading = null;
const isReferenceDisplay = body => body?.geometryClass === 'reference' && body.referenceDisplay?.mesh?.exact === false;

// Loads the Bend kernel and its display module once (exact normals of Bend
// bodies). On the Rust backend there is no Bend display module: exact normals
// of Rust bodies come from the Rust carriers in `rustFaceNormals`.
export function loadDrawKernel() {
  if ((process.env.WONKY_BACKEND ?? 'rust') !== 'js') return Promise.resolve(null);
  loading ??= (async () => {
    await loadKernel();
    const module = await import('../../kernel/display.bend');
    display = module.default;
    return display;
  })().catch(error => {
    loading = null;
    throw error;
  });
  return loading;
}

const encodeSurface = surface => Object.fromEntries(Object.entries(surface).map(([key, value]) => [
  key === 'type' ? '$' : key,
  key === 'type' ? value[0].toUpperCase() + value.slice(1)
    : Array.isArray(value) ? vector(value) : real(value),
]));

const unit = value => {
  const length = Math.hypot(...value);
  return length > 0 && Number.isFinite(length) ? value.map(item => item / length) : null;
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Exact outward normals at the display points of one face, or null when the
// surface has no closed-form normal here or a normal disagrees with the
// display triangle it belongs to (never silently wrong).
// Exact outward normals of a Rust body's face from its Rust carrier (float64,
// world mm): plane normal, cylinder and sphere radial directions. The sign
// follows the face's `sameSense` and every normal must agree with its display
// triangle, else the face keeps its triangle normals (flagged `display`).
// Cones, tori and refused carriers have no closed form here.
function rustFaceNormals(brepFace, points) {
  const surface = brepFace?.surface;
  if (!surface) return null;
  const sign = brepFace.sameSense === false ? -1 : 1;
  const normals = new Map();
  if (surface.type === 'plane') {
    const normal = unit(surface.normal);
    if (!normal) return null;
    for (const point of points) normals.set(pointKey(point), normal.map(value => value * sign));
  } else if (surface.type === 'cylinder' || surface.type === 'sphere') {
    const axis = unit(surface.axis);
    if (!axis) return null;
    for (const point of points) {
      const key = pointKey(point);
      if (normals.has(key)) continue;
      const offset = point.map((value, i) => value - surface.origin[i]);
      const along = surface.type === 'cylinder' ? dot(offset, axis) : 0;
      const normal = unit(offset.map((value, i) => value - along * axis[i]));
      if (!normal) return null;
      normals.set(key, normal.map(value => value * sign));
    }
  } else return null;
  return normals;
}

function faceNormals(model, D) {
  return (bodyIndex, face) => {
    if (!face.triangles?.length) return null;
    const points = face.triangles.flatMap(triangle => triangle.points);
    const body = model.bodies[bodyIndex];
    const brepFace = body?.faces[face.index];
    if (isReferenceDisplay(body)) return null;
    if (isRustRecord(body)) {
      const normals = rustFaceNormals(brepFace, points);
      if (!normals) return null;
      for (const triangle of face.triangles) {
        for (const point of triangle.points) {
          if (!(dot(normals.get(pointKey(point)), triangle.normal) > 0)) return null;
        }
      }
      return normals;
    }
    const surface = brepFace?.surface;
    if (!surface) return null;
    const analytic = body.geometry === 'analytic';
    const sign = analytic && brepFace.sameSense === false ? -1 : 1;
    const normals = new Map();
    if (surface.type === 'plane') {
      const normal = unit(surface.normal);
      if (!normal) return null;
      const outward = normal.map(value => value * sign);
      for (const point of points) normals.set(pointKey(point), outward);
    } else if (analytic && (surface.type === 'cylinder' || surface.type === 'cone')) {
      const encoded = encodeSurface(surface);
      const origin = vector(surface.origin);
      const axis = vector(surface.axis);
      const x = vector(surface.x);
      for (const point of points) {
        const key = pointKey(point);
        if (normals.has(key)) continue;
        const angle = coords(D.cylinder_coordinates(vector(point), origin, axis, x))[0];
        const normal = unit(coords(D.surface_normal(encoded, real(angle))));
        if (!normal) return null;
        normals.set(key, normal.map(value => value * sign));
      }
    } else return null;
    for (const triangle of face.triangles) {
      for (const point of triangle.points) {
        if (!(dot(normals.get(pointKey(point)), triangle.normal) > 0)) return null;
      }
    }
    return normals;
  };
}

// Rounds a bound up to two significant digits (never understates it).
export function ceilBound(value) {
  if (!(value > 0)) return value;
  let rounded = Number(value.toPrecision(2));
  const step = 10 ** (Math.floor(Math.log10(value)) - 1);
  while (rounded < value) rounded = Number((rounded + step).toPrecision(2));
  return rounded;
}

function chordBound(face, body, toleranceMm) {
  if (!face.triangles?.length) return null;
  const bound = face.displayTessellation?.maxChordalErrorBoundMm;
  if (Number.isFinite(bound)) return ceilBound(bound);
  const straight = (face.edgeIndices ?? []).every(index => body.edges[index]?.curveType === 'line');
  return face.surfaceType === 'plane' && straight ? 0 : toleranceMm;
}

// Exact normals of every face, computed in slices that yield to the event
// loop every ~15 ms (and honor `signal`): Map "body:face" -> Map | null.
export async function exactNormals(model, scene, { signal } = {}) {
  model = viewerRecord(model);
  await loadDrawKernel();
  const compute = faceNormals(model, display);
  const result = new Map();
  let slice = performance.now();
  for (const [bodyIndex, body] of scene.bodies.entries()) {
    for (const face of body.faces) {
      result.set(`${bodyIndex}:${face.index}`, compute(bodyIndex, face));
      if (performance.now() - slice > 15) {
        await new Promise(resolve => setImmediate(resolve));
        signal?.throwIfAborted();
        slice = performance.now();
      }
    }
  }
  return result;
}

// `normals` (optional): the result of exactNormals() for this scene.
export function buildDrawPayload(model, scene, { logical, classes, modelId, normals } = {}) {
  model = viewerRecord(model);
  if (!scene || (!display && !model.bodies.every(body => isRustRecord(body) || isReferenceDisplay(body)))) return null;
  const compute = faceNormals(model, display);
  const lookup = normals
    ? (bodyIndex, face) => normals.get(`${bodyIndex}:${face.index}`) ?? null
    : compute;
  const toleranceMm = scene.display?.toleranceMm ?? null;
  const edgeClass = classes
    ? (bodyIndex, edge) => classes.bodies?.[bodyIndex]?.classes?.[edge] ?? UNRESOLVED_CLASS
    : null;
  const built = buildDrawArrays(scene, { exactNormals: lookup, edgeClass, logical });
  const exactFaces = built.faces.filter(face => face.normalSource === 'exact').length;
  const header = {
    schema: DRAW_SCHEMA,
    version: DRAW_VERSION,
    modelId: modelId ?? scene.id ?? null,
    exactness: 'display-approximation',
    center: built.center,
    bounds: built.bounds,
    toleranceMm,
    diagnostic: scene.diagnostic ?? model.diagnostic ?? null,
    counts: built.counts,
    bodies: built.bodies.map((body, index) => ({
      index, alias: `B${index + 1}`, id: body.id, name: body.name,
      appearance: model.bodies[index]?.appearance ?? null,
      ...(isReferenceDisplay(model.bodies[index]) ? {exact:false,approximation:'tessellated mesh',uncertainty:model.bodies[index].uncertainty} : {}),
      faceRange: body.faceRange, indexRange: body.indexRange, vertexRange: body.vertexRange,
      edgeRange: body.edgeRange, segmentRange: body.segmentRange, pointRange: body.pointRange,
    })),
    faces: built.faces.map(face => {
      const body = scene.bodies[face.body];
      const entry = {
        alias: `B${face.body + 1}.F${face.index + 1}`,
        surfaceType: face.surfaceType,
        logical: face.logical,
        indexRange: face.indexRange,
        normalSource: face.normalSource,
        maxChordErrorMm: chordBound(body.faces[face.index], body, toleranceMm),
      };
      if (face.displayWarning) entry.displayWarning = face.displayWarning;
      return entry;
    }),
    logicalFaces: built.logicalFaces.map((group, index) => ({
      alias: group.alias ?? `L${index + 1}`, fragments: group.fragments,
    })),
    // Edge aliases (B<b>.E<i>) and class names (edgeClass section) are
    // derived by the client; repeating them here would cost 13 KB on r10b.
    edges: built.edges.map(edge => ({ curveType: edge.curveType })),
    edgeClassNames: EDGE_CLASS_NAMES,
    notes: [
      `Display approximation (chord tolerance ${toleranceMm} mm); `
        + (model.bodies.some(isReferenceDisplay) ? 'retained STEP surfaces and source uncertainty remain authoritative.' : 'the analytic B-rep remains authoritative.'),
      `Normals: ${exactFaces} of ${built.faces.length} faces use exact outward normals of their`
        + ` ${model.bodies.some(isReferenceDisplay) ? 'available carriers (reference faces use display normals)' : model.bodies.every(isRustRecord) ? 'plane, cylinder or sphere carrier (float64, from the Rust carriers)' : 'plane, cylinder or cone evaluated in Bend'} at each display vertex (oct16, error`
        + ` <= ${OCT16_MAX_ERROR_DEG} deg); the others use display triangle normals.`,
      ...(scene.display?.notes ?? []),
      ...(classes?.note ? [classes.note] : []),
      ...(logical?.note ? [logical.note] : []),
    ],
  };
  return { header, buffer: encodeDraw(header, built.arrays) };
}

// Topology helpers from topology-classes; a failure keeps the payload honest
// (classes unresolved, one logical face per fragment) and says why.
function topology(model, scene) {
  let classes = null;
  let logical = null;
  try {
    classes = classifyEdges(model, scene);
  } catch (error) {
    classes = { bodies: [], note: `Edge classes unavailable: ${error.message}` };
  }
  try {
    logical = logicalFaces(model, classes.bodies.length ? { classes } : undefined);
  } catch (error) {
    logical = { bodies: [], note: `Logical faces unavailable: ${error.message}` };
  }
  return { classes, logical };
}

// Query-worker handler (kind `draw`): (model, payload, { signal }) -> { header, buffer }.
export async function drawQuery(model, payload = {}, { signal } = {}) {
  if (!model?.bodies?.length) {
    throw new CapabilityError('Draw payload unavailable: the model has no bodies');
  }
  model = viewerRecord(model);
  await loadDrawKernel();
  signal?.throwIfAborted();
  let scene = payload?.scene;
  if (!scene) {
    try {
      scene = await reviewScene(model, {});
    } catch (error) {
      throw new CapabilityError(`Display preparation failed: ${error.message}`, { cause: error });
    }
  }
  signal?.throwIfAborted();
  const { classes, logical } = topology(model, scene);
  const normals = await exactNormals(model, scene, { signal });
  signal?.throwIfAborted();
  return buildDrawPayload(model, scene, { logical, classes, normals, modelId: payload?.modelId });
}
