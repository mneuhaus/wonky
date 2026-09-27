import { loadKernel } from './kernel.mjs';
import { real, vector } from './real.mjs';
import { intersectionTolerance } from './intersections.mjs';
import { unsupported } from './errors.mjs';

let loaded;
export function loadCurvePlane() {
  loaded ??= (async () => {
    await loadKernel();
    const { default: kernel } = await import('../kernel/curve-plane.bend');
    return kernel;
  })();
  return loaded;
}

// Serialization only. Parameterization, validation, certificates, intersections
// and trimming all run in Bend; no host-side normalization or root solving.
export function curvePlaneCurve(curve) {
  if (curve.$) return curve;
  const origin = vector(curve.origin);
  switch (curve.type) {
    case 'line': return { $: 'Line', origin, direction: vector(curve.direction) };
    case 'circle': return { $: 'Circle', origin, normal: vector(curve.normal), x: vector(curve.x), radius: real(curve.radius) };
    case 'ellipse': return { $: 'Ellipse', origin, normal: vector(curve.normal), x: vector(curve.x), major: real(curve.major), minor: real(curve.minor) };
    default: return unsupported(`Curve/plane intersection does not support '${curve.type}'`);
  }
}

export function curvePlaneDomain(interval) {
  if (interval === undefined || interval === null) return { $: 'Untrimmed' };
  if (interval.$) return interval;
  if (!Array.isArray(interval) || interval.length !== 2) throw new TypeError('A curve interval requires [first, last]');
  return { $: 'Interval', first: real(interval[0]), last: real(interval[1]) };
}

export async function intersectCurvePlane(curve, plane, { interval, ...tolerance } = {}) {
  if (plane.type !== undefined && plane.type !== 'plane') unsupported('Curve/plane intersection requires a plane');
  const kernel = await loadCurvePlane();
  return kernel.intersect(curvePlaneCurve(curve), vector(plane.origin), vector(plane.normal), curvePlaneDomain(interval), intersectionTolerance(tolerance));
}

export function requireResolvedCurvePlane(result) {
  if (result.$ !== 'Resolved') unsupported(`Curve/plane intersection ${result.$.toLowerCase()}: ${result.reason.$}`);
  return result;
}
