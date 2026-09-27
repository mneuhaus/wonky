// Wall thickness probe by ray and trim membership (spec 3.3, 9.2).
// Package: thickness-probe.
//
// Frozen query-worker handler (kind `thickness`):
//   thicknessQuery(model, { face, point } | { origin, direction, body? }, { signal })
//     -> { status: 'measured'|'unresolved'|'no-hit', mm, hit, blocking, ... }
//
// Method (docs/viewer/thickness-probe.md). Every decision is the kernel's:
//   1. Ray. `{ face, point }`: the picked display point is projected onto the
//      face's exact supporting surface (closed form, kernel.precise) and the
//      ray runs along the exact inward normal there. `{ origin, direction }`:
//      the given ray, unchanged.
//   2. Roots. `ray.line_surface` (kernel/ray.bend) against the supporting
//      surface of every face of the body. Tangent and coincident answers are
//      kept as such. An `unresolved` or `range` answer is settled only by an
//      exact closed form that shows why it cannot matter or where the root is
//      (refusedRootPlan: origin on the surface, parallel and beyond the
//      kernel range, parallel within tolerance = coincident); each one is
//      reported in `refusedRoots`. Every other refusal blocks.
//   3. Membership. In ray order, each root point is classified against its
//      trimmed face by solid-classification `membership` (planes and
//      cylinders): FaceInside counts as a crossing; FaceBoundary (an edge or
//      vertex), FaceUnknown and a tangent root on the face block.
//   4. Span. Entry = the start face (or the first entering crossing), exit =
//      the next crossing that leaves the material (outward normal · ray > 0).
//      Faces whose supporting surface contains the ray are checked by
//      membership at every root and at the midpoint between consecutive roots
//      up to the exit; any contact blocks.
//   5. Answer. `measured` only without a blocking entity at or before the
//      exit: mm = t_exit − t_entry (Bend Real arithmetic), exactness
//      `kernel-resolved`, tolerance max(entry face, exit face tolerance) as in
//      exact-measure. Otherwise `unresolved` with every blocking entity, or
//      `no-hit`. The ray is never nudged, and nothing is guessed.
import { array, loadKernel } from '../kernel.mjs';
import { loadCylinderClassifier } from '../cylinder-classification.mjs';
import { classificationInput, loadFaceClassifier } from '../face-classification.mjs';
import { intersectionSurface, intersectionTolerance } from '../intersections.mjs';
import { loadRayKernel } from '../ray.mjs';
import { coords, number, real } from '../real.mjs';
import { loadSolidClassifier } from '../solid-classification.mjs';
import {
  aliasOf, bodyTolerance, cachedLogicalFaces, exactMath, faceTolerance, logicalGroup, parseAlias,
} from './geometry.mjs';
import { CapabilityError, HttpError } from './http.mjs';

export const THICKNESS_SCHEMA = 'wonky.viewer-thickness/1';
export const EXACTNESS = 'kernel-resolved';
export const METHOD = 'ray.line_surface roots on every supporting surface; solid-classification'
  + ' membership of each root on its trimmed face; span from the entry to the first crossing'
  + ' that leaves the material';
// `line_surface` result kinds (src/ray.mjs lineIntersectionKinds).
export const ROOT_KINDS = Object.freeze(['miss', 'transverse', 'tangent', 'coincident',
  'unresolved', 'invalid', 'range']);
export const MAX_COORDINATE_MM = 1e6;
// Yield to the event loop at least this often, so a cancel message reaches
// the query worker between kernel calls.
const YIELD_MS = 8;
const MEMBERSHIP_SURFACES = new Set(['plane', 'cylinder']);

const finite = value => typeof value === 'number' && Number.isFinite(value);
const isVector = value => Array.isArray(value) && value.length === 3 && value.every(finite);
const TINY = 1e-30;
const toReal = value => real(Math.abs(value) < TINY ? 0 : value);
const toVector = ([x, y, z]) => ({ $: 'V3', x: toReal(x), y: toReal(y), z: toReal(z) });

// ---- Request ------------------------------------------------------------------------------

const FACE_ALIAS = /^B[1-9][0-9]*\.[FL][1-9][0-9]*$/;
const BODY_ALIAS = /^B[1-9][0-9]*$/;
const SHAPES = 'Thickness request must be { face, point } or { origin, direction, body? }';

function checkPoint(value, name) {
  if (!isVector(value)) throw new HttpError(400, `${name} must be [x, y, z] in mm`);
  if (value.some(coordinate => Math.abs(coordinate) > MAX_COORDINATE_MM)) {
    throw new HttpError(400, `${name} is out of range`);
  }
  return [...value];
}

function faceInput(face) {
  if (typeof face === 'string') {
    if (!FACE_ALIAS.test(face)) {
      throw new HttpError(400, `face must be a face alias like B1.F3 or B1.L2 (got ${face})`);
    }
    return face;
  }
  if (face && typeof face === 'object' && !Array.isArray(face)) {
    const { bodyId, entityType = 'face', entityIndex } = face;
    if (typeof bodyId !== 'string' || !bodyId || bodyId.length > 512 || entityType !== 'face'
      || !Number.isInteger(entityIndex) || entityIndex < 0) {
      throw new HttpError(400, 'face must be { bodyId, entityType: "face", entityIndex }');
    }
    return { bodyId, entityType, entityIndex };
  }
  throw new HttpError(400, 'face must be a face alias or a face reference');
}

// Validates the request body; throws HttpError 400 on malformed input.
export function parseThicknessRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, SHAPES);
  const hasFace = body.face !== undefined || body.point !== undefined;
  const hasRay = body.origin !== undefined || body.direction !== undefined;
  if (hasFace === hasRay) throw new HttpError(400, SHAPES);
  if (hasFace) {
    return { mode: 'face', face: faceInput(body.face), point: checkPoint(body.point, 'point') };
  }
  const origin = checkPoint(body.origin, 'origin');
  const direction = checkPoint(body.direction, 'direction');
  if (!(Math.hypot(...direction) > 1e-12)) throw new HttpError(400, 'direction must not be zero');
  const request = { mode: 'ray', origin, direction };
  if (body.body !== undefined) {
    if (typeof body.body !== 'string' || !body.body || body.body.length > 512) {
      throw new HttpError(400, 'body must be a body alias (B1) or a body id');
    }
    request.body = body.body;
  }
  return request;
}

// ---- Kernel access --------------------------------------------------------------------------

let loading = null;
export function loadThicknessKernels() {
  loading ??= Promise.all([loadKernel(), loadRayKernel(), loadSolidClassifier(),
    loadFaceClassifier(), loadCylinderClassifier()])
    .then(([kernel, ray, solid, face, cylinder]) => ({ kernel, ray, solid, face, cylinder }))
    .catch(error => {
      loading = null;
      throw error;
    });
  return loading;
}

const prepared = new WeakMap();
// Classification input and supporting surfaces of one body, once per body
// object (the query worker keeps parsed models, so repeated probes reuse it).
function prepare(kernels, body) {
  let entry = prepared.get(body);
  if (entry) return entry;
  let input;
  try {
    input = classificationInput(body, kernels.face);
  } catch (error) {
    throw new CapabilityError(`Thickness probe cannot classify this body: ${error.message}`);
  }
  if (!input.solid) {
    throw new CapabilityError('Thickness probe cannot classify this body: its polyhedral edges'
      + ' do not convert to kernel lines');
  }
  const surfaces = body.faces.map(face => {
    try {
      return { surface: intersectionSurface(face.surface) };
    } catch (error) {
      return { error: String(error?.message ?? error) };
    }
  });
  const margin = Math.max(bodyTolerance(body), 1e-7);
  entry = { input, surfaces, margin, tolerance: intersectionTolerance() };
  prepared.set(body, entry);
  return entry;
}

// ---- Geometry helpers (closed forms in Bend Real arithmetic) ---------------------------------

const surfaceType = face => face?.surface?.type ?? 'unknown';
const senseOf = face => (face.sameSense === false ? -1 : 1);

// Exact outward unit normal of a plane or cylinder face at `point`
// (sameSense applied); null for other surfaces or on the axis.
export function outwardNormal(math, face, point) {
  const surface = face.surface;
  if (surface.type === 'plane') return math.scale(math.normalize(surface.normal), senseOf(face));
  if (surface.type === 'cylinder') {
    const axis = math.normalize(surface.axis);
    const radial = math.sub(point, math.foot(surface.origin, axis, point));
    if (!(math.norm(radial) > 0)) return null;
    return math.scale(math.normalize(radial), senseOf(face));
  }
  return null;
}

// Foot of the display pick on the exact supporting surface and the inward
// normal there. Throws CapabilityError for surfaces without membership.
export function startRay(math, face, pick) {
  const type = surfaceType(face);
  if (!MEMBERSHIP_SURFACES.has(type)) {
    throw new CapabilityError(`Thickness probe from a ${type} face is not supported: the kernel`
      + ' membership (solid-classification) covers plane and cylinder faces');
  }
  const surface = face.surface;
  let origin;
  if (type === 'plane') {
    const normal = math.normalize(surface.normal);
    const height = math.dot(math.sub(pick, surface.origin), normal);
    origin = math.sub(pick, math.scale(normal, height));
  } else {
    const axis = math.normalize(surface.axis);
    const foot = math.foot(surface.origin, axis, pick);
    const radial = math.sub(pick, foot);
    if (!(math.norm(radial) > 0)) {
      throw new HttpError(400, 'point lies on the cylinder axis; it has no surface foot');
    }
    origin = math.add(foot, math.scale(math.normalize(radial), surface.radius));
  }
  const outward = outwardNormal(math, face, origin);
  return {
    origin,
    direction: math.scale(outward, -1),
    pickOffsetMm: math.norm(math.sub(pick, origin)),
  };
}

// Beyond this parameter `line_surface` answers `range` (kernel/ray.bend), and
// every body lies inside the kernel's valid box, so no span reaches it.
export const RAY_RANGE_MM = 1e5;
// Parallel test for surfaces whose root the kernel left unresolved: the
// kernel refuses |cos| <= 1e-12 (planes) and sin^2 <= 1e-12 (cylinders); the
// wider limits here only decide which closed form applies, never a root.
const PLANE_PARALLEL = 1e-9;
const AXIS_PARALLEL = 1e-6;
const ROUNDING = 1e-15;

// Closed forms (Bend Real arithmetic over the stored parameters, like
// exact-measure) for a surface whose `line_surface` answer is `unresolved`
// or `range`. The ray is not moved; the answer says why the refusal does or
// does not matter:
//   { roots, how: 'origin-on-surface' }  the ray starts on the supporting
//        surface (the offset rounds to zero without a certificate): the
//        root at the origin, plus the far root of a cylinder
//   { excluded, how: 'near-parallel' | 'beyond-range' }  parallel within the
//        guard and farther than the tolerance: any crossing lies beyond the
//        kernel range, so outside every body
//   { coincident, how: 'near-coincident' }  parallel within the tolerance:
//        handled like a coincident surface (membership sampling)
//   null  still blocking.
export function refusedRootPlan(math, face, origin, direction, toleranceMm, rootKind) {
  const surface = face.surface;
  if (surface?.type === 'plane') {
    const normal = math.normalize(surface.normal);
    const cos = math.dot(normal, direction);
    const offset = math.dot(math.sub(origin, surface.origin), normal);
    const distance = Math.abs(offset);
    if (rootKind === 'range') {
      const beyond = distance / (Math.abs(cos) + ROUNDING);
      return beyond > RAY_RANGE_MM ? { excluded: true, how: 'beyond-range', offsetMm: distance,
        beyondMm: beyond } : null;
    }
    if (Math.abs(cos) <= PLANE_PARALLEL) {
      const beyond = distance / (Math.abs(cos) + ROUNDING);
      if (distance > toleranceMm && beyond > RAY_RANGE_MM) {
        return { excluded: true, how: 'near-parallel', offsetMm: distance, beyondMm: beyond };
      }
      return { coincident: true, how: 'near-coincident', offsetMm: distance };
    }
    if (distance <= toleranceMm) {
      return { roots: [-offset / cos], how: 'origin-on-surface', offsetMm: distance };
    }
    return null;
  }
  if (surface?.type === 'cylinder' && rootKind === 'unresolved') {
    const axis = math.normalize(surface.axis);
    const offset = math.sub(origin, surface.origin);
    const radial = math.sub(offset, math.scale(axis, math.dot(offset, axis)));
    const across = math.sub(direction, math.scale(axis, math.dot(direction, axis)));
    const sine = math.norm(across);
    const gap = Math.abs(math.norm(radial) - surface.radius);
    if (sine <= AXIS_PARALLEL) {
      const beyond = gap / (sine + ROUNDING);
      if (gap > toleranceMm && beyond > RAY_RANGE_MM) {
        return { excluded: true, how: 'near-parallel', offsetMm: gap, beyondMm: beyond };
      }
      return { coincident: true, how: 'near-coincident', offsetMm: gap };
    }
    if (gap <= toleranceMm) {
      const far = -2 * math.dot(radial, across) / (sine * sine);
      if (Math.abs(far) <= toleranceMm) {
        return { roots: [0], tangent: true, how: 'origin-on-surface', offsetMm: gap };
      }
      return { roots: [0, far], how: 'origin-on-surface', offsetMm: gap };
    }
  }
  return null;
}

// Consecutive roots whose parameters lie within `margin` form one event.
export function groupRoots(roots, margin) {
  const events = [];
  for (const root of [...roots].sort((a, b) => a.t - b.t)) {
    const last = events.at(-1);
    if (last && root.t - last.roots.at(-1).t <= margin) last.roots.push(root);
    else events.push({ t: root.t, roots: [root] });
  }
  return events;
}

// Sample parameters for faces that contain the ray: every partition point in
// [0, limit] and the midpoint of every gap between consecutive ones.
export function coincidenceSamples(partition, limit) {
  const points = [...new Set([0, ...partition.filter(t => t > 0 && t < limit), limit])]
    .sort((a, b) => a - b);
  const samples = [];
  points.forEach((t, index) => {
    samples.push(t);
    const next = points[index + 1];
    if (next !== undefined && next > t) samples.push((t + next) / 2);
  });
  return samples;
}

// ---- Probe --------------------------------------------------------------------------------

const REASON_TEXT = {
  boundary: 'the ray meets the face on its boundary (an edge or vertex)',
  tangent: 'the ray touches the face tangentially',
  coincident: 'the ray lies in the supporting surface and touches the face',
  'membership-unknown': 'the kernel cannot decide whether the root lies on the trimmed face',
  overlap: 'two faces contain the same crossing point',
  orientation: 'the crossing does not alternate between entering and leaving the material',
  grazing: 'the ray is perpendicular to the outward normal at the crossing',
  'root-unresolved': 'line_surface cannot decide the crossing with the supporting surface',
  'root-invalid': 'line_surface rejected the ray for this supporting surface',
  'root-range': 'the crossing with the supporting surface lies outside the kernel range',
  'unsupported-surface': 'the supporting surface has no ray intersection in the kernel',
  'start-boundary': 'the probe starts on the boundary of the picked face (an edge or vertex)',
  'start-outside': 'the pick projects outside the trimmed picked face',
  'start-missing': 'the picked face has no root at the ray origin',
};

function createProbe({ kernels, math, model, logical, signal }) {
  let lastYield = performance.now();
  const counts = { roots: 0, memberships: 0 };
  async function checkpoint() {
    if (signal?.aborted) throw signal.reason ?? new HttpError(499, 'Thickness query aborted');
    if (performance.now() - lastYield < YIELD_MS) return;
    await new Promise(resolve => setImmediate(resolve));
    lastYield = performance.now();
    if (signal?.aborted) throw signal.reason ?? new HttpError(499, 'Thickness query aborted');
  }

  function faceRef(bodyIndex, faceIndex) {
    return {
      alias: aliasOf(bodyIndex, 'face', faceIndex),
      logical: logicalGroup(logical, bodyIndex, faceIndex)?.alias ?? null,
    };
  }

  // Edge of the face boundary through `point`, from the face classifier.
  function boundaryEdges(body, bodyIndex, entry, faceIndex, point) {
    const type = surfaceType(body.faces[faceIndex]);
    const classifier = type === 'plane' ? kernels.face : type === 'cylinder'
      ? kernels.cylinder : null;
    if (!classifier) return { edges: [], classifier: null };
    const { solid, domains, sourceBudget } = entry.input;
    const result = classifier.classify(solid, faceIndex, domains, point, entry.tolerance,
      sourceBudget);
    if (result.$ === 'Boundary') {
      return { edges: [aliasOf(bodyIndex, 'edge', result.edge)], classifier: result.$ };
    }
    return { edges: [], classifier: result.$ === 'Unresolved'
      ? `Unresolved ${result.reason?.$ ?? ''}`.trim() : result.$ };
  }

  async function probeBody(bodyIndex, origin, direction, { startFaces = null } = {}) {
    const body = model.bodies[bodyIndex];
    const entry = prepare(kernels, body);
    const { margin } = entry;
    const { solid, domains, sourceBudget } = entry.input;
    const O = toVector(origin);
    const D = toVector(direction);
    const roots = [];
    const blocking = [];
    const coincident = [];
    const refused = [];
    const block = (faceIndex, reason, extra = {}) => blocking.push({
      ...faceRef(bodyIndex, faceIndex), entity: 'face', reason, text: REASON_TEXT[reason],
      ...extra,
    });

    for (const [index, item] of entry.surfaces.entries()) {
      await checkpoint();
      if (item.error) {
        block(index, 'unsupported-surface', { detail: item.error });
        continue;
      }
      const result = kernels.ray.line_surface(O, D, item.surface);
      const kind = ROOT_KINDS[result.kind] ?? `kind ${result.kind}`;
      if (kind === 'transverse' || kind === 'tangent') {
        for (const value of array(result.values)) {
          roots.push({ face: index, value, t: number(value), kind });
        }
      } else if (kind === 'coincident') {
        coincident.push(index);
      } else if (kind !== 'miss') {
        const plan = kind === 'unresolved' || kind === 'range'
          ? refusedRootPlan(math, body.faces[index], origin, direction, margin, kind) : null;
        const note = plan && {
          ...faceRef(bodyIndex, index), rootKind: kind, how: plan.how,
          offsetMm: plan.offsetMm, ...(plan.beyondMm ? { beyondMm: plan.beyondMm } : {}),
        };
        if (plan?.roots) {
          for (const t of plan.roots) {
            roots.push({ face: index, value: toReal(t), t, kind: plan.tangent ? 'tangent'
              : 'transverse', source: plan.how });
          }
        } else if (plan?.coincident) coincident.push(index);
        if (plan) refused.push(note);
        else block(index, `root-${kind}`, { rootKind: kind });
      }
    }
    counts.roots += roots.length;

    const membership = async (faceIndex, point) => {
      await checkpoint();
      counts.memberships++;
      return kernels.solid.membership(solid, faceIndex, domains, point, entry.tolerance,
        sourceBudget).$;
    };
    const pointAt = value => kernels.ray.point(O, D, value);
    const problem = (root, reason) => {
      const extra = { t: root.t, point: coords(root.point), membership: root.membership,
        rootKind: root.kind };
      if (reason === 'boundary' || reason === 'start-boundary') {
        Object.assign(extra, boundaryEdges(body, bodyIndex, entry, root.face, root.point));
      }
      block(root.face, reason, extra);
    };
    const orientation = root => {
      const normal = outwardNormal(math, body.faces[root.face], coords(root.point));
      if (!normal) return 0;
      const along = math.dot(direction, normal);
      return Math.abs(along) <= 1e-9 ? 0 : Math.sign(along);
    };

    // Walk the events in ray order. `state` is where the ray is just after
    // the current parameter: 'inside' or 'outside' the material, or
    // 'unknown' before the first crossing of a free ray. A face-normal probe
    // starts inside by construction (inward normal). Once something blocks,
    // the scan ends at the next crossing: the answer is refused either way,
    // and that crossing bounds which later contacts still count.
    const events = groupRoots(roots.filter(root => root.t >= -margin), margin);
    let state = startFaces ? 'inside' : 'unknown';
    let entryRoot = null;
    let exitRoot = null;
    let originInside = false;
    let processedT = 0;
    if (startFaces && !(events[0] && Math.abs(events[0].t) <= margin)) {
      block(startFaces[0], 'start-missing');
    }
    for (const event of events) {
      for (const root of event.roots) {
        root.point = pointAt(root.value);
        root.membership = await membership(root.face, root.point);
      }
      processedT = event.roots.at(-1).t;
      const atStart = Math.abs(event.t) <= margin;
      const blockedBefore = blocking.length > 0;
      const crossings = [];
      for (const root of event.roots) {
        if (atStart && startFaces?.includes(root.face)) continue;
        if (root.membership === 'FaceOutside') continue;
        if (root.membership === 'FaceBoundary') problem(root, 'boundary');
        else if (root.membership !== 'FaceInside') problem(root, 'membership-unknown');
        else if (root.kind === 'tangent') problem(root, 'tangent');
        else crossings.push(root);
      }
      if (atStart && startFaces) {
        const own = event.roots.filter(root => startFaces.includes(root.face));
        const start = own.find(root => root.membership === 'FaceInside');
        if (start) crossings.push(start);
        else if (!own.length) block(startFaces[0], 'start-missing');
        else if (own[0].membership === 'FaceBoundary') problem(own[0], 'start-boundary');
        else if (own[0].membership === 'FaceOutside') problem(own[0], 'start-outside');
        else problem(own[0], 'membership-unknown');
      }
      if (crossings.length > 1) {
        for (const root of crossings) problem(root, 'overlap');
        continue;
      }
      if (!crossings.length) continue;
      const crossing = crossings[0];
      const sign = orientation(crossing);
      if (sign === 0) {
        problem(crossing, 'grazing');
        continue;
      }
      if (atStart) {
        if (sign < 0) {
          state = 'inside';
          entryRoot = crossing;
        } else if (startFaces) {
          problem(crossing, 'orientation');
        } else state = 'outside';
        continue;
      }
      if (state === 'inside') {
        if (sign > 0) exitRoot = crossing;
        else problem(crossing, 'orientation');
        break;
      }
      if (sign > 0) {
        if (state === 'unknown') originInside = true;
        else problem(crossing, 'orientation');
        break;
      }
      state = 'inside';
      entryRoot = crossing;
      if (blockedBefore) break;
    }

    // Faces whose supporting surface contains the ray: membership at every
    // root and between consecutive roots up to the exit (or the last root).
    const lastRoot = roots.length ? roots.at(-1).t : 0;
    const limit = exitRoot ? exitRoot.t : Math.max(processedT, lastRoot, 0);
    if (coincident.length) {
      const partition = roots.map(root => root.t);
      const samples = coincidenceSamples(partition, limit);
      if (!exitRoot) samples.push(limit + Math.max(1, margin));
      for (const faceIndex of coincident) {
        for (const t of samples) {
          const point = pointAt(toReal(t));
          const result = await membership(faceIndex, point);
          if (result === 'FaceOutside') continue;
          const extra = { t, point: coords(point), membership: result, rootKind: 'coincident' };
          if (result === 'FaceBoundary') {
            Object.assign(extra, boundaryEdges(body, bodyIndex, entry, faceIndex, point));
          }
          block(faceIndex, result === 'FaceUnknown' ? 'membership-unknown' : 'coincident',
            extra);
          break;
        }
      }
    }

    const relevant = blocking.filter(item => item.t === undefined || !exitRoot
      || item.t <= exitRoot.t + margin);
    const describe = root => root && {
      ...faceRef(bodyIndex, root.face), point: coords(root.point), t: root.t,
    };
    const base = {
      body: aliasOf(bodyIndex), bodyId: body.id, bodyToleranceMm: bodyTolerance(body),
      coincident: coincident.map(index => aliasOf(bodyIndex, 'face', index)),
      refusedRoots: refused,
      blocking: relevant,
    };
    if (relevant.length) {
      return { ...base, status: 'unresolved', mm: null, entry: describe(entryRoot),
        hit: describe(exitRoot), reason: `${relevant.length} blocking`
          + ` ${relevant.length === 1 ? 'entity' : 'entities'}; the ray is not nudged` };
    }
    if (originInside) {
      return { ...base, status: 'unresolved', mm: null, entry: null, hit: null,
        reason: 'the ray starts inside the material; start it outside or on the boundary' };
    }
    if (!entryRoot) {
      return { ...base, status: 'no-hit', mm: null, entry: null, hit: null,
        reason: 'the ray does not enter the material of this body' };
    }
    if (!exitRoot) {
      return { ...base, status: 'unresolved', mm: null, entry: describe(entryRoot), hit: null,
        reason: 'no crossing leaves the material after the entry (open or invalid body)' };
    }
    const mm = number(kernels.kernel.real.sub(exitRoot.value, entryRoot.value));
    return {
      ...base, status: 'measured', mm,
      toleranceMm: Math.max(faceTolerance(body, entryRoot.face),
        faceTolerance(body, exitRoot.face)),
      entry: describe(entryRoot), hit: describe(exitRoot), reason: null,
    };
  }

  return { probeBody, counts };
}

// ---- Handler ------------------------------------------------------------------------------

function locateBody(model, key) {
  if (BODY_ALIAS.test(key)) {
    const index = Number(key.slice(1)) - 1;
    if (!model.bodies[index]) throw new HttpError(404, `Unknown body ${key}`);
    return index;
  }
  const index = model.bodies.findIndex(body => body.id === key);
  if (index < 0) throw new HttpError(404, `Unknown body ${key}`);
  return index;
}

// { bodyIndex, faces: [face indices sharing the support], alias } of a face input.
function locateFace(model, face, logical) {
  if (typeof face === 'object') {
    const bodyIndex = model.bodies.findIndex(body => body.id === face.bodyId);
    if (bodyIndex < 0) throw new HttpError(404, `Unknown body ${face.bodyId}`);
    if (face.entityIndex >= model.bodies[bodyIndex].faces.length) {
      throw new HttpError(404, `Unknown face ${face.entityIndex} of ${face.bodyId}`);
    }
    return { bodyIndex, faces: [face.entityIndex],
      alias: aliasOf(bodyIndex, 'face', face.entityIndex) };
  }
  const parsed = parseAlias(face);
  const body = parsed && model.bodies[parsed.bodyIndex];
  if (!body) throw new HttpError(404, `Unknown geometry alias ${face}`);
  if (parsed.kind === 'face') {
    if (parsed.index >= body.faces.length) throw new HttpError(404, `Unknown face ${face}`);
    return { bodyIndex: parsed.bodyIndex, faces: [parsed.index], alias: face };
  }
  const group = logical?.bodies?.[parsed.bodyIndex]?.groups?.[parsed.index];
  if (!group) throw new HttpError(404, `Unknown logical face ${face}`);
  return { bodyIndex: parsed.bodyIndex, faces: [...group.fragments], alias: face };
}

function logicalOf(model) {
  try {
    return cachedLogicalFaces(model);
  } catch {
    return null;
  }
}

// Probes one request against a parsed model. `kernels` from loadThicknessKernels().
export async function probeThickness(model, request, { kernels, signal } = {}) {
  const started = performance.now();
  const math = exactMath(kernels.kernel);
  const logical = logicalOf(model);
  const probe = createProbe({ kernels, math, model, logical, signal });
  let bodyIndex;
  let ray;
  let result;
  if (request.mode === 'face') {
    const located = locateFace(model, request.face, logical);
    bodyIndex = located.bodyIndex;
    const face = model.bodies[bodyIndex].faces[located.faces[0]];
    const start = startRay(math, face, request.point);
    ray = {
      mode: 'face', face: located.alias, pick: request.point, origin: start.origin,
      direction: start.direction, anchor: 'display-pick', pickOffsetMm: start.pickOffsetMm,
      originExactness: 'exact-parameters',
    };
    result = await probe.probeBody(bodyIndex, start.origin, start.direction,
      { startFaces: located.faces });
  } else {
    if (request.body === undefined && model.bodies.length > 1) {
      throw new HttpError(400, `body is required: this model has ${model.bodies.length} bodies`);
    }
    bodyIndex = request.body === undefined ? 0 : locateBody(model, request.body);
    const direction = math.normalize(request.direction);
    ray = { mode: 'ray', origin: [...request.origin], direction, anchor: 'given' };
    result = await probe.probeBody(bodyIndex, request.origin, direction);
  }
  return {
    schema: THICKNESS_SCHEMA,
    exactness: EXACTNESS,
    method: METHOD,
    ...result,
    toleranceMm: result.toleranceMm ?? null,
    ray,
    counts: { faces: model.bodies[bodyIndex].faces.length, ...probe.counts },
    ms: Math.round((performance.now() - started) * 10) / 10,
  };
}

// Query-worker handler (kind `thickness`).
export async function thicknessQuery(model, payload, { signal } = {}) {
  if (!Array.isArray(model?.bodies) || !model.bodies.length) {
    throw new CapabilityError('Thickness probe needs at least one body; this model has none');
  }
  const request = parseThicknessRequest(payload);
  const kernels = await loadThicknessKernels();
  if (signal?.aborted) throw signal.reason ?? new HttpError(499, 'Thickness query aborted');
  return probeThickness(model, request, { kernels, signal });
}
