import { real, vector } from './real.mjs';
import { curvePlaneCurve, curvePlaneDomain } from './curve-plane.mjs';
import { classificationInput, loadFaceClassifier } from './face-classification.mjs';
import { intersectionTolerance } from './intersections.mjs';
import { unsupported } from './errors.mjs';

let loaded;
export function loadCurveBand() {
  loaded ??= (async () => {
    await loadFaceClassifier();
    const { default: kernel } = await import('../kernel/curve-band.bend');
    return kernel;
  })();
  return loaded;
}

const asReal = value => value?.$ === 'Real' ? value : real(value);
const asVector = value => value?.$ === 'V3' ? value : vector(value);
function contactCap(options) {
  if (options.contactTolerance === undefined) throw new TypeError('An explicit curve-band contactTolerance is required');
  return asReal(options.contactTolerance);
}
function checkPlane(plane) {
  if (plane.type !== undefined && plane.type !== 'plane') unsupported('Curve band checks require a plane');
}

// Serialization only. Bounds, candidate parameters, guards and decisions are
// computed in Bend. Source allowance never supplies or increases the cap.
export async function boundCurvePlaneBand(curve, plane, options = {}) {
  const cap = contactCap(options); checkPlane(plane);
  const kernel = await loadCurveBand();
  return kernel.bound(curvePlaneCurve(curve), curvePlaneDomain(options.interval),
    asVector(plane.origin), asVector(plane.normal), cap, asReal(options.sourceTolerance ?? 0));
}

export async function boundEdgePlaneBand(body, edgeIndex, plane, options = {}) {
  const cap = contactCap(options); checkPlane(plane);
  if (!Number.isInteger(edgeIndex) || edgeIndex < 0 || edgeIndex > 0xffffffff) throw new RangeError('Edge index must be an unsigned integer');
  const kernel = await loadCurveBand(), F = await loadFaceClassifier();
  const { solid, domains, sourceBudget } = classificationInput(body, F, options);
  if (solid === null) return { $: 'Rejected', reason: { $: 'EdgeRejected', reason: { $: 'InvalidIndex' } } };
  return kernel.bound_edge(solid, edgeIndex, domains, asVector(plane.origin), asVector(plane.normal),
    intersectionTolerance(options), cap, sourceBudget);
}

export function requireResolvedCurveBand(result) {
  if (result.$ !== 'Resolved') unsupported(`Curve band ${result.$}: ${result.reason.$}`);
  return result;
}
