import { loadKernel } from './kernel.mjs';
import { vector } from './real.mjs';
import { intersectionTolerance } from './intersections.mjs';
import { classificationInput, loadFaceClassifier } from './face-classification.mjs';
import { unsupported } from './errors.mjs';

let loaded;
export function loadEdgePlane() {
  loaded ??= (async () => {
    await loadKernel();
    const { default: kernel } = await import('../kernel/edge-plane.bend');
    return kernel;
  })();
  return loaded;
}

// Shared body/domain/source-budget serialization only. Bend prepares the finite
// edge, checks vertex incidence, solves intersections, and assigns contacts.
export async function intersectEdgePlane(body, edgeIndex, plane, options = {}) {
  if (!Number.isInteger(edgeIndex) || edgeIndex < 0 || edgeIndex > 0xffffffff) {
    throw new RangeError('Edge index must be an unsigned integer');
  }
  if (plane.type !== undefined && plane.type !== 'plane') unsupported('Finite edge intersection requires a plane');
  const kernel = await loadEdgePlane(), classifier = await loadFaceClassifier();
  const { solid, domains, sourceBudget } = classificationInput(body, classifier, options);
  if (solid === null) return { $: 'Rejected', reason: { $: 'InvalidIndex' } };
  return kernel.intersect(solid, edgeIndex, domains,
    plane.origin.$ ? plane.origin : vector(plane.origin),
    plane.normal.$ ? plane.normal : vector(plane.normal),
    intersectionTolerance(options), sourceBudget);
}

export function requireResolvedEdgePlane(result) {
  if (result.$ !== 'Resolved') unsupported(`Finite edge intersection ${result.$.toLowerCase()}: ${result.reason.$}`);
  return result;
}
