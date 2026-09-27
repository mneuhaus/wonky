// Ghost pairing and exact edge-band bounds (spec 3.4, 9.2). Package: diff-overlay.
//
// Frozen query-worker handler (kind `diffBounds`):
//   diffBoundsQuery(model, { other }, { signal }) -> { bounds, exactness, … }
// It runs in the query worker (query-worker.mjs) and returns the kernel
// bounds of `model` alone; `other` (the model id of the other revision) is
// only echoed. Bounds are per revision, so the route caches them per model id
// and a revision's bounds serve every pair it takes part in.
//
// Exact bounds from edge bands (docs/viewer/audit-data.md section 2.2): on a
// solid bounded by planes, cylinders and cones every directional extreme lies
// on an edge. A plane carries a linear height function; a cylinder or cone
// face is ruled, and along a generator the height is linear, so an interior
// extreme needs a generator of constant height, which reaches the boundary.
// The one exception is a cone's apex: a generator can end there instead of on
// an edge. The union of the Bend edge-band extrema (boundEdgePlaneBand of
// every edge against the planes x = 0, y = 0, z = 0) is therefore the exact
// box, as long as every face is a plane, cylinder or cone and no cone face can
// reach its apex outside that box. Anything else is reported, never guessed:
// other surface types are `unsupported`, an edge band that does not resolve
// or a possibly reached apex leaves the body `unresolved` with the reason.
//
// Only bodies whose recorded bounds (validation.boundsMm) are null are
// computed; bodies with recorded bounds keep them (label `recorded`).
import { CapabilityError } from './http.mjs';
import { compareModels, describeRevisions } from './compare.mjs';

export const DIFF_SCHEMA = 'wonky.diff/1';
export const KERNEL_BOUNDS_SCHEMA = 'wonky.kernel-bounds/1';
export const BAND_CONTACT_TOLERANCE_MM = 1e-7;
export const SUPPORTED_SURFACES = Object.freeze(['plane', 'cylinder', 'cone']);
export const KERNEL_BOUNDS_METHOD = 'union of Bend edge-band extrema (boundEdgePlaneBand) of'
  + ' every edge along X, Y and Z; exact for faces bounded by planes, cylinders and cones';

export const DIFF_SCOPE = 'The ghost is the display mesh of the before revision (display'
  + ' approximation); it is drawn, never measured. Bounds deltas use recorded bounds, else'
  + ' kernel-resolved edge-band bounds for bodies whose recorded bounds are null, else the'
  + ' display envelope with its tolerance. Counts compare the stored B-rep; volumes are'
  + ' recorded values. Bodies are matched by body id; no geometric correspondence is inferred.';

const AXES = Object.freeze([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
const AXIS_NAMES = Object.freeze(['X', 'Y', 'Z']);
const YIELD_MS = 15;

const finite = value => typeof value === 'number' && Number.isFinite(value);
const triple = value => Array.isArray(value) && value.length === 3 && value.every(finite);
const validBox = value => !!value && triple(value.min) && triple(value.max)
  && value.min.every((entry, index) => entry <= value.max[index]);
const sub = (left, right) => left.map((value, index) => value - right[index]);
const dot = (left, right) => left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
const add = (left, right) => left.map((value, index) => value + right[index]);
const scale = (vector, factor) => vector.map(value => value * factor);
const norm = vector => Math.sqrt(dot(vector, vector));

// A Bend Real ({ $: 'Real', hi, lo }) or a plain number as a JS number.
export const realValue = value => (finite(value) ? value
  : finite(value?.hi) && finite(value?.lo) ? value.hi + value.lo : Number.NaN);

const boxOf = (min, max) => ({ min: [...min], max: [...max], size: sub(max, min) });

export const unionBox = boxes => boxOf(
  [0, 1, 2].map(axis => Math.min(...boxes.map(value => value.min[axis]))),
  [0, 1, 2].map(axis => Math.max(...boxes.map(value => value.max[axis]))),
);

const surfaceType = face => face?.surface?.type ?? null;

// Faces whose surface type rules out edge-band bounds, as `B1.F3 (sphere)`.
export function unsupportedFaces(body, alias = 'B1') {
  return (body.faces ?? []).flatMap((face, index) => {
    const type = surfaceType(face);
    if (SUPPORTED_SURFACES.includes(type)) return [];
    return [`${alias}.F${index + 1} (${type ?? 'no surface'})`];
  });
}

// Full circle edge coaxial with a cone: its signed height along the axis.
function coaxialCircleHeight(edge, surface, tolerance) {
  const curve = edge?.curve;
  if (curve?.type !== 'circle' || !triple(curve.origin) || !triple(curve.normal)) return null;
  const full = !Array.isArray(edge.curveRange) || edge.start === edge.end;
  if (!full) return null;
  const axis = surface.axis;
  const length = norm(axis) * norm(curve.normal);
  if (!(length > 0) || Math.abs(Math.abs(dot(axis, curve.normal)) / length - 1) > 1e-9) return null;
  const unit = scale(axis, 1 / norm(axis));
  const offset = sub(curve.origin, surface.origin);
  const height = dot(offset, unit);
  const radial = sub(offset, scale(unit, height));
  return norm(radial) <= tolerance ? height : null;
}

// Apex of a cone face and whether the face provably excludes it: a cone face
// whose loops hold two full coaxial circles at different heights on the same
// side of the apex is the band between them. Otherwise the apex matters only
// if it lies outside the edge-band box (checked by the caller).
export function coneApex(body, faceIndex, tolerance = 1e-9) {
  const face = body.faces[faceIndex];
  const { surface } = face;
  if (!triple(surface.origin) || !triple(surface.axis) || !finite(surface.radius)
    || !finite(surface.angle)) {
    return { apex: null, excluded: false, reason: 'cone parameters are incomplete' };
  }
  const tangent = Math.tan(surface.angle);
  if (tangent === 0) return { apex: null, excluded: true };
  const unit = scale(surface.axis, 1 / norm(surface.axis));
  const apexHeight = -surface.radius / tangent;
  const apex = add(surface.origin, scale(unit, apexHeight));
  const heights = [];
  for (const loop of face.loops ?? []) {
    for (const use of loop) {
      const height = coaxialCircleHeight(body.edges[use.edge], surface, tolerance);
      if (height !== null) heights.push(height);
    }
  }
  const low = Math.min(...heights);
  const high = Math.max(...heights);
  const band = heights.length >= 2 && high - low > tolerance
    && !(apexHeight > low + tolerance && apexHeight < high - tolerance);
  return { apex, excluded: band };
}

const insideBox = (point, box, tolerance) => point.every((value, axis) => value
  >= box.min[axis] - tolerance && value <= box.max[axis] + tolerance);

const reasonName = result => {
  const names = [];
  for (let value = result?.reason; value && typeof value === 'object' && names.length < 4;
    value = value.reason) {
    if (typeof value.$ === 'string') names.push(value.$);
  }
  return [result?.$ ?? 'Unknown', ...names].join('/');
};

// The extrema of one band result, or null when it gives none. A resolved
// band has evidence whatever its relation; an Unresolved Threshold only
// leaves the contact decision open and still carries the computed extrema.
export function bandExtrema(result) {
  const evidence = result?.$ === 'Resolved' ? result.evidence
    : result?.$ === 'Unresolved' && result.reason?.$ === 'Threshold' ? result.reason.evidence
      : null;
  if (!evidence) return null;
  const minimum = realValue(evidence.minimum?.signed_distance);
  const maximum = realValue(evidence.maximum?.signed_distance);
  const guard = realValue(evidence.arithmetic_guard);
  if (![minimum, maximum].every(finite) || minimum > maximum) return null;
  return { minimum, maximum, guard: finite(guard) ? guard : 0 };
}

const defaultBand = async () => (await import('../curve-band.mjs')).boundEdgePlaneBand;
const tick = () => new Promise(done => setImmediate(done));

// Kernel bounds of one body: { status, bounds?, toleranceMm, guardMm, reason?, issues }.
export async function kernelBodyBounds(body, {
  alias = 'B1', signal, band, now = () => performance.now(),
} = {}) {
  const started = now();
  const modelToleranceMm = finite(body.validation?.toleranceMm) ? body.validation.toleranceMm : 0;
  const base = { method: KERNEL_BOUNDS_METHOD, modelToleranceMm, edges: body.edges?.length ?? 0 };
  const unsupported = unsupportedFaces(body, alias);
  if (unsupported.length) {
    return {
      ...base, status: 'unsupported', bounds: null,
      reason: `Exact bounds from edge bands need plane, cylinder and cone faces; ${unsupported
        .slice(0, 3).join(', ')}${unsupported.length > 3 ? ` and ${unsupported.length - 3} more`
        : ''} ${unsupported.length === 1 ? 'is' : 'are'} not`,
    };
  }
  if (!body.edges?.length) {
    return { ...base, status: 'unresolved', bounds: null, reason: 'The body has no edges' };
  }
  const bound = band ?? await defaultBand();
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const issues = [];
  let guardMm = 0;
  let calls = 0;
  let last = now();
  for (let axis = 0; axis < 3; axis++) {
    const plane = { type: 'plane', origin: [0, 0, 0], normal: AXES[axis] };
    for (let edge = 0; edge < body.edges.length; edge++) {
      signal?.throwIfAborted();
      let result;
      try {
        result = await bound(body, edge, plane, { contactTolerance: BAND_CONTACT_TOLERANCE_MM });
      } catch (error) {
        result = { $: 'Failed', reason: { $: error?.name ?? 'Error' }, message: error?.message };
      }
      calls++;
      const extrema = bandExtrema(result);
      if (!extrema) {
        issues.push({
          edge: `${alias}.E${edge + 1}`, axis: AXIS_NAMES[axis], status: reasonName(result),
          ...(result?.message ? { message: result.message } : {}),
        });
      } else {
        min[axis] = Math.min(min[axis], extrema.minimum);
        max[axis] = Math.max(max[axis], extrema.maximum);
        guardMm = Math.max(guardMm, extrema.guard);
      }
      if (now() - last > YIELD_MS) {
        await tick();
        last = now();
      }
    }
  }
  const timing = { calls, ms: Math.round(now() - started) };
  if (issues.length) {
    const first = issues[0];
    return {
      ...base, ...timing, status: 'unresolved', bounds: null, guardMm, issues,
      reason: `${issues.length} of ${calls} edge bands did not resolve (first: ${first.edge}`
        + ` along ${first.axis}: ${first.status})`,
    };
  }
  const bounds = boxOf(min, max);
  const tolerance = Math.max(modelToleranceMm, guardMm);
  for (let index = 0; index < body.faces.length; index++) {
    if (surfaceType(body.faces[index]) !== 'cone') continue;
    const { apex, excluded, reason } = coneApex(body, index, Math.max(tolerance, 1e-9));
    if (excluded) continue;
    if (!apex) {
      return {
        ...base, ...timing, status: 'unresolved', bounds: null, guardMm,
        reason: `${alias}.F${index + 1}: ${reason}`,
      };
    }
    if (!insideBox(apex, bounds, tolerance)) {
      return {
        ...base, ...timing, status: 'unresolved', bounds: null, guardMm,
        reason: `Cone face ${alias}.F${index + 1} may reach its apex at`
          + ` (${apex.map(value => Number(value.toFixed(6))).join(', ')}) outside the edge-band`
          + ' box; whether the trimmed face contains it is not decided',
      };
    }
  }
  return { ...base, ...timing, status: 'resolved', bounds, guardMm, toleranceMm: tolerance };
}

const recordedBoundsOf = body => (validBox(body.validation?.boundsMm)
  ? boxOf(body.validation.boundsMm.min, body.validation.boundsMm.max) : null);

// Kernel bounds of a model (the diffBounds query). Bodies with recorded
// bounds are copied (source `recorded`) unless `onlyMissing` is false.
export async function kernelBounds(model, {
  signal, band, onlyMissing = true, now = () => performance.now(),
} = {}) {
  if (model?.schema !== 'wonky-brep/1' || !Array.isArray(model.bodies)) {
    throw new CapabilityError('Kernel bounds need a wonky-brep/1 model');
  }
  const started = now();
  const bodies = [];
  for (let index = 0; index < model.bodies.length; index++) {
    const body = model.bodies[index];
    const alias = `B${index + 1}`;
    const recorded = onlyMissing ? recordedBoundsOf(body) : null;
    const row = { bodyId: body.id, alias, name: body.name ?? null };
    if (recorded) {
      bodies.push({ ...row, source: 'recorded', status: 'resolved', bounds: recorded,
        exactness: 'recorded' });
      continue;
    }
    const result = await kernelBodyBounds(body, { alias, signal, band, now });
    bodies.push({
      ...row, source: 'kernel', exactness: result.status === 'resolved' ? 'kernel-resolved' : null,
      ...result,
    });
  }
  const kernelRows = bodies.filter(row => row.source === 'kernel');
  const failed = bodies.filter(row => row.status !== 'resolved');
  const resolved = !failed.length;
  const bounds = resolved && bodies.length ? unionBox(bodies.map(row => row.bounds)) : null;
  const toleranceMm = Math.max(0, ...kernelRows.map(row => row.toleranceMm ?? 0));
  const status = !kernelRows.length ? 'not-needed'
    : resolved ? 'resolved'
      : failed.some(row => row.status === 'unsupported') ? 'unsupported' : 'unresolved';
  return {
    schema: KERNEL_BOUNDS_SCHEMA,
    status,
    method: KERNEL_BOUNDS_METHOD,
    contactToleranceMm: BAND_CONTACT_TOLERANCE_MM,
    bounds,
    exactness: bounds ? (kernelRows.length ? 'kernel-resolved' : 'recorded') : null,
    ...(bounds && kernelRows.length ? { toleranceMm } : {}),
    ...(failed.length
      ? { reason: failed.map(row => `${row.alias}: ${row.reason}`).join('; ') } : {}),
    bodies,
    ms: Math.round(now() - started),
  };
}

// Frozen handler of the `diffBounds` query kind.
export async function diffBoundsQuery(model, payload = {}, { signal } = {}) {
  const result = await kernelBounds(model, { signal });
  return { ...result, other: typeof payload?.other === 'string' ? payload.other : null };
}

// ---------------------------------------------------------------------------
// Server side: kernel bounds per model id through the query pool, shared by
// every route of one server (keyed by its registry).

const caches = new WeakMap();

const needsKernel = model => model.bodies.some(body => !validBox(body.validation?.boundsMm));

// Kernel bounds of a registered revision, or { status: 'not-needed' } when
// every body has recorded bounds. Capability errors are answers (cached);
// transient pool failures (timeout, worker down, superseded) are not cached.
export async function kernelBoundsFor(ctx, modelId, { other = null, timeoutMs } = {}) {
  const model = ctx.registry.model(modelId);
  if (!model) throw new Error('Unknown model revision');
  if (!needsKernel(model)) {
    return { schema: KERNEL_BOUNDS_SCHEMA, status: 'not-needed', bounds: null, exactness: null };
  }
  if (!caches.has(ctx.registry)) caches.set(ctx.registry, new Map());
  const cache = caches.get(ctx.registry);
  if (!cache.has(modelId)) {
    const run = ctx.pool.query('diffBounds', modelId, { other }, timeoutMs ? { timeoutMs } : {})
      .catch(error => {
        if (error?.status === 501) {
          return { schema: KERNEL_BOUNDS_SCHEMA, status: 'unsupported', bounds: null,
            exactness: null, reason: error.message };
        }
        cache.delete(modelId);
        return { schema: KERNEL_BOUNDS_SCHEMA, status: 'failed', bounds: null, exactness: null,
          reason: error?.message ?? String(error), transient: true };
      });
    cache.set(modelId, run);
    while (cache.size > 256) cache.delete(cache.keys().next().value);
  }
  return cache.get(modelId);
}

// Per-body result summary for the API (no per-edge issue list).
export const kernelSummary = result => (result ? {
  status: result.status,
  ...(result.bounds ? { bounds: result.bounds, exactness: result.exactness } : {}),
  ...(result.toleranceMm !== undefined ? { toleranceMm: result.toleranceMm } : {}),
  ...(result.reason ? { reason: result.reason } : {}),
  ...(result.ms !== undefined ? { ms: result.ms } : {}),
  ...(result.transient ? { transient: true } : {}),
  bodies: (result.bodies ?? []).map(row => ({
    bodyId: row.bodyId, alias: row.alias, source: row.source, status: row.status,
    ...(row.bounds ? { bounds: row.bounds, exactness: row.exactness } : {}),
    ...(row.toleranceMm !== undefined ? { toleranceMm: row.toleranceMm } : {}),
    ...(row.reason ? { reason: row.reason } : {}),
    ...(row.issues?.length ? { unresolvedEdges: row.issues.length } : {}),
  })),
} : null);

// ---------------------------------------------------------------------------
// Ghost pairing.

// The revision to show as the ghost of `after`: `before` when given
// (explicit), else the previous revision of the same source (highest
// revision number below after's). Archived snapshots have no previous.
export function ghostPairing(list, { after, before = null, snapshotDirectory } = {}) {
  const facts = describeRevisions(list, { snapshotDirectory });
  const byId = new Map(facts.map(fact => [fact.modelId, fact]));
  const target = byId.get(after) ?? null;
  const summary = fact => (fact ? {
    modelId: fact.modelId, kind: fact.kind, source: fact.source, revision: fact.revision,
  } : null);
  if (before) {
    return { pairing: 'explicit', before: summary(byId.get(before)) ?? { modelId: before },
      after: summary(target) ?? { modelId: after } };
  }
  if (!target || target.kind === 'archive' || !Number.isInteger(target.revision)) {
    return { pairing: 'none', before: null, after: summary(target) ?? { modelId: after },
      reason: 'No earlier revision of this source' };
  }
  const previous = facts
    .filter(fact => fact.kind === target.kind && fact.source === target.source
      && Number.isInteger(fact.revision) && fact.revision < target.revision)
    .reduce((best, fact) => (!best || fact.revision > best.revision ? fact : best), null);
  if (!previous) {
    return { pairing: 'none', before: null, after: summary(target),
      reason: 'No earlier revision of this source' };
  }
  return { pairing: 'previous-revision', before: summary(previous), after: summary(target) };
}

// ---------------------------------------------------------------------------
// The GET /api/diff body from two revision descriptors (see compare.mjs) that
// may carry `kernelBounds`.
export function diffModels(before, after, { logical, pairing = 'explicit', labels = {} } = {}) {
  const compared = compareModels(before, after, logical ? { logical } : {});
  const side = (descriptor, extra) => ({
    modelId: descriptor.id ?? null,
    label: extra?.label ?? null,
    revision: extra?.revision ?? null,
    kind: extra?.kind ?? null,
    kernelBounds: kernelSummary(descriptor.kernelBounds ?? null),
  });
  return {
    schema: DIFF_SCHEMA,
    pairing,
    identical: !!before.id && before.id === after.id,
    before: side(before, labels.before),
    after: side(after, labels.after),
    ghost: {
      modelId: before.id ?? null,
      forModelId: after.id ?? null,
      representation: 'display-approximation',
      note: 'Display mesh of the before revision, drawn translucent over the after revision;'
        + ' never measured',
    },
    scope: DIFF_SCOPE,
    deltas: compared.deltas,
    sourceLines: compared.sourceLines,
  };
}
