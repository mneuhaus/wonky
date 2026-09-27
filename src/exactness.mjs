// Approximation labels that must survive every operation (AGENTS.md: an
// approximation stays distinguishable from exact geometry).
//
// A polygon prism states exactness 'regularized' when the profile ring merged
// a near-collinear vertex, the sketch x axis was projected, or a cap was moved
// onto a near-coplanar operand plane before a planar Boolean
// (src/kernel.mjs: construction.profileMerge, construction.frameRegularization,
// construction.capSnap). It states exactness 'quantized' when its profile
// reached the prism as F32 points (construction.profileQuantization, see
// profileQuantization below). A body with both states 'approximate'.
// An operation whose result is computed from such a body is exact only
// relative to that input, so the result states the input's label too and
// names what was approximated in regularizedSources, because its own
// construction record (a Boolean's, a pierce's) no longer holds the input's
// record. Rigid copies carry both fields unchanged (transformInBend,
// transformAnalytic).

const combine = labels => (labels.size === 1 ? [...labels][0] : 'approximate');

// F32 line-sketch profiles (W2 integrate fix round 2). kernel/sketch-lines.bend
// returns its solved profile as F32 points (Solved.points, Q.Vec3), and
// src/library.mjs skSolve (W1) hands those to extrudeInBend, so a line-segment
// profile is quantized by up to about 1.6e-6 mm while the prism words are
// F32x2. The prism records the profile it was given (recordExtrudedProfile);
// once src/library.mjs has attached body.sketchProfile, the quantization is the
// largest distance of an extruded profile point from the nearest binary64
// segment endpoint (sketchProfile.segments[].startMm/endMm, the values the
// source states). Zero means the prism got the source's own points (W1's
// skSolve diff, tmp/w2/integrate-fix/library-sksolve.diff, or coordinates that
// are F32 values already) and nothing is labelled.
const EXTRUDED_PROFILE = new WeakMap();
export function recordExtrudedProfile(body, points) {
  EXTRUDED_PROFILE.set(body, points.map(point => [point[0], point[1]]));
}
export function profileQuantization(body) {
  if (body?.construction?.profileQuantization) return body.construction.profileQuantization;
  const source = body?.sketchProfile, points = EXTRUDED_PROFILE.get(body);
  if (source?.schema !== 'wonky-line-sketch/1' || !points || !Array.isArray(source.segments)) return null;
  const ends = source.segments.flatMap(segment => [segment.startMm, segment.endMm]);
  let worst = 0;
  for (const [x, y] of points) {
    let best = Infinity;
    for (const [ex, ey] of ends) best = Math.min(best, Math.hypot(x - ex, y - ey));
    worst = Math.max(worst, best);
  }
  if (!(worst > 0)) return null;
  return { source: 'kernel/sketch-lines.bend Solved.points (F32 profile points)', sketchId: source.sketchId ?? null,
    profileVertices: points.length, maxDeviationMm: worst };
}

// Writes a body's own approximation label into the body once everything it
// depends on is attached (the line-sketch profile source is attached by the
// caller after extrusion). Idempotent; called before any use of the label.
export function settleExactness(body) {
  if (!body || Array.isArray(body.regularizedSources)) return body;
  const quantization = !body.construction?.profileQuantization && profileQuantization(body);
  if (quantization) {
    body.construction = { ...(body.construction ?? {}), profileQuantization: quantization };
    body.exactness = body.exactness ? combine(new Set([body.exactness, 'quantized'])) : 'quantized';
  }
  return body;
}

// The approximations a body stands on: its own recorded ones, or those it
// inherited. Each entry names the body where the approximation was recorded.
export function regularizedSources(body) {
  settleExactness(body);
  if (Array.isArray(body?.regularizedSources)) return body.regularizedSources;
  if (!body?.exactness) return [];
  const construction = body.construction ?? {};
  const merges = (construction.profileMerge?.merged ?? []).filter(merge => !merge.exact);
  return [{
    body: body.id, exactness: body.exactness,
    ...(merges.length ? { profileMerge: { merged: merges.map(({ index, deviationMm }) => ({ index, deviationMm })), toleranceMm: construction.profileMerge.toleranceMm } } : {}),
    ...(construction.frameRegularization ? { frameRegularization: structuredClone(construction.frameRegularization) } : {}),
    ...(construction.profileQuantization ? { profileQuantization: structuredClone(construction.profileQuantization) } : {}),
    ...(construction.capSnap ? { capSnap: structuredClone(construction.capSnap) } : {}),
  }];
}

// Sets exactness and regularizedSources on `result` when any input is not
// exact. The label is the inputs' own when they agree, 'approximate' when they
// differ. Returns true when the result was labelled.
export function inheritExactness(result, inputs) {
  const seen = new Set(), sources = [];
  for (const source of inputs.flatMap(regularizedSources)) {
    const key = JSON.stringify(source);
    if (!seen.has(key)) { seen.add(key); sources.push(structuredClone(source)); }
  }
  if (!sources.length) return false;
  result.exactness = combine(new Set(sources.map(source => source.exactness)));
  result.regularizedSources = sources;
  return true;
}

// A rigid copy states what its source states.
export function copyExactness(source, result) {
  settleExactness(source);
  if (source.exactness) result.exactness = source.exactness;
  if (source.regularizedSources) result.regularizedSources = structuredClone(source.regularizedSources);
}

// Adds `label` to a body's own exactness ('approximate' when it already states
// a different one). A body that inherited its sources keeps them and names the
// new approximation as its own entry.
export function addExactnessLabel(body, label) {
  const inherited = Array.isArray(body.regularizedSources);
  body.exactness = body.exactness ? combine(new Set([body.exactness, label])) : label;
  if (inherited) {
    const { capSnap, profileQuantization } = body.construction ?? {};
    body.regularizedSources = [...structuredClone(body.regularizedSources),
      { body: body.id, exactness: label, ...(capSnap ? { capSnap: structuredClone(capSnap) } : {}),
        ...(profileQuantization ? { profileQuantization: structuredClone(profileQuantization) } : {}) }];
  }
}
