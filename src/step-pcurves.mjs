import { loadBend } from './bend-loader.mjs';
import { encodeAnalytic } from './analytic.mjs';
import { array, list } from './kernel.mjs';
import { real, number, vector } from './real.mjs';

let loaded;
export function loadStepPCurves() {
  loaded ??= loadBend(new URL('../kernel/step-pcurves.bend', import.meta.url));
  return loaded;
}

// These adapters only serialize inputs and decode native output. All topology
// admission, support checks, chart choices and approximation run in Bend.
const geometry = value => value.$ ? value : Object.fromEntries(Object.entries(value).map(([key, entry]) => [
  key === 'type' ? '$' : key,
  key === 'type' ? entry[0].toUpperCase() + entry.slice(1) : Array.isArray(entry) ? vector(entry) : real(entry),
]));
const point = value => value.$ ? value : vector(value);
const index = value => {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new TypeError('PCurve topology index must be an unsigned 32-bit integer');
  return value;
};

export function decodePCurve(result) {
  if (result.$ !== 'Resolved') return { status: 'Unresolved', reason: result.reason.$ };
  return {
    status: 'Resolved', first: number(result.first), last: number(result.last), degree: result.degree,
    points: array(result.points).map(({ u, v }) => [number(u), number(v)]),
    knots: array(result.knots).map(number), multiplicities: array(result.multiplicities),
    approximationBoundMm: number(result.approximation_bound), supportBoundMm: number(result.support_bound),
    numericGuardMm: number(result.numeric_guard), totalBoundMm: number(result.total_bound),
  };
}

export function cylinderPCurve(native, curve, surface, start, seam, { budgetMm = 1e-8 } = {}) {
  return decodePCurve(native.cylinder_round(geometry(curve), geometry(surface), point(start), point(seam), real(budgetMm)));
}

// Synchronous when the caller already holds the loaded native module. Body
// curveRange metadata is serialized as an explicit domain and rejected by the
// current full-band native scope; it must never be lost during conversion.
export function fullBandPCurve(native, bodyOrSolid, edgeIndex, faceIndex, { budgetMm = 1e-8, domains } = {}) {
  const solid = bodyOrSolid.$ === 'Solid' ? bodyOrSolid : encodeAnalytic(bodyOrSolid);
  const specified = domains ? array(domains) : [];
  const choices = bodyOrSolid.$ === 'Solid' ? (domains ?? list([])) : list([
    ...bodyOrSolid.edges.map((edge, i) => edge.curveRange
      ? { $: 'GivenDomain', domain: { $: 'Interval', first: real(edge.curveRange[0]), last: real(edge.curveRange[1]) } }
      : (specified[i] ?? { $: 'AutoDomain' })),
    ...specified.slice(bodyOrSolid.edges.length),
  ]);
  return decodePCurve(native.for_edge_domains(solid, choices, index(edgeIndex), index(faceIndex), real(budgetMm)));
}

// Sphere faces (kernel/step-pcurves.bend, "Sphere faces"): the frame the STEP
// writer gives a sphere face bounded by `curves`, whether a circle is a
// latitude or meridian of it, and the parameter curve of any other circle over
// [first, last]. Bend chooses the frame and builds the curve and its
// (sampled) bound.
const bool = value => value?.$ === 'True' || value === true;
export function sphereFrame(native, surface, curves) {
  const frame = native.sphere_frame(geometry(surface), list(curves.map(geometry)));
  return { bend: frame, origin: array3(frame.origin), axis: array3(frame.axis), x: array3(frame.x), radius: number(frame.radius) };
}
const array3 = v => [number(v.x), number(v.y), number(v.z)];
export function sphereFrameKept(native, surface, curves) {
  return bool(native.sphere_frame_kept(geometry(surface), list(curves.map(geometry))));
}
export function sphereNeedsPCurve(native, frame, curve) {
  return bool(native.sphere_needs_pcurve(frame.bend, geometry(curve)));
}
export function sphereCirclePCurve(native, frame, curve, first, last, { budgetMm = 1e-8 } = {}) {
  return decodePCurve(native.sphere_circle(frame.bend, geometry(curve), real(first), real(last), real(budgetMm)));
}

// The writer's frame for a sphere face bounded by `arcs` ([{ curve, range }],
// range = the edge's curveRange, absent for a whole circle), with poles kept
// off the arcs' interiors, and whether it is the face's own frame.
export function sphereFaceFrame(native, surface, arcs) {
  const result = native.sphere_face_frame(geometry(surface), list(arcs.map(({ curve, range }) => ({
    $: 'Arc', curve: geometry(curve), whole: !range, first: real(range?.[0] ?? 0), last: real(range?.[1] ?? 0) }))));
  const frame = result.frame;
  return { kept: bool(result.kept), bend: frame, origin: array3(frame.origin), axis: array3(frame.axis), x: array3(frame.x), radius: number(frame.radius) };
}

// Is every boundary curve of every cylinder face of the body a parameter line
// of its cylinder (a reader then builds its parameter curve exactly)?
export function cylinderLinesOnly(native, bodyOrSolid) {
  return bool(native.cylinder_lines_only(bodyOrSolid.$ === 'Solid' ? bodyOrSolid : encodeAnalytic(bodyOrSolid)));
}
