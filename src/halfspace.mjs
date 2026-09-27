import { loadKernel } from './kernel.mjs';
import { classificationInput, loadFaceClassifier } from './face-classification.mjs';
import { vector, number, coords } from './real.mjs';
import { intersectionTolerance } from './intersections.mjs';
import { decodeAnalytic } from './analytic.mjs';
import { unsupported } from './errors.mjs';

let loaded;
export function loadHalfspace() {
  loaded ??= loadKernel().then(kernel => kernel.halfspace);
  return loaded;
}

export function halfspaceInput(body, classifier, options = {}) {
  if (options.domains?.some(value => value != null) || (Array.isArray(body.edges) && body.edges.some(edge => edge.curveRange != null))) {
    unsupported('Convex clipping accepts vertex-bounded line segments; explicit curve intervals are not supported');
  }
  return classificationInput(body, classifier, options);
}

export async function clipConvexSolid(body, plane, options = {}) {
  if (plane.type !== undefined && plane.type !== 'plane') unsupported('Convex halfspace clipping requires a plane');
  const kernel = await loadHalfspace(), classifier = await loadFaceClassifier();
  const { solid, sourceBudget } = halfspaceInput(body, classifier, options);
  if (!solid) return { $: 'Unresolved', reason: { $: 'InvalidTopology' } };
  return kernel.clip(solid, plane.origin.$ ? plane.origin : vector(plane.origin),
    plane.normal.$ ? plane.normal : vector(plane.normal), intersectionTolerance(options), sourceBudget);
}

export async function intersectConvexSolids(first, second, options = {}) {
  const kernel = await loadHalfspace(), classifier = await loadFaceClassifier();
  const a = halfspaceInput(first, classifier, options), b = halfspaceInput(second, classifier, options);
  if (!a.solid || !b.solid) return { $: 'Unresolved', reason: { $: 'InvalidTopology' } };
  return kernel.intersect(a.solid, b.solid, intersectionTolerance(options), a.sourceBudget, b.sourceBudget);
}

export function requireResolvedHalfspace(result) {
  if (!['Solid', 'Empty'].includes(result.$)) unsupported(`Convex planar clipping unresolved: ${result.reason?.$ ?? result.$}`);
  return result;
}

export function decodeHalfspace(result, id, kernel) {
  requireResolvedHalfspace(result);
  if (result.$ === 'Empty') return [];
  const body = decodeAnalytic(result.solid, id, kernel);
  body.validation.volumeMm3 = number(result.volume);
  body.validation.boundsMm = { min: coords(result.bounds.low), max: coords(result.bounds.high) };
  body.validation.scope = 'convex planar boundary, shared closed topology, volume and tight vertex bounds computed in Bend; endpoint incidence checked';
  body.construction = { method: 'convex planar halfspace clipping in Bend', numericPolicy: 'F32x2 roots; exact represented-vertex contact certificates; ambiguous contacts fail closed' };
  return [body];
}
