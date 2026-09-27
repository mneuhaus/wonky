import { vector } from './real.mjs';
import { classificationInput, loadFaceClassifier } from './face-classification.mjs';
import { intersectionTolerance } from './intersections.mjs';
import { unsupported } from './errors.mjs';

let loaded;
export function loadFacePlane() {
  loaded ??= (async () => {
    await loadFaceClassifier();
    const { default: kernel } = await import('../kernel/face-plane.bend');
    return kernel;
  })();
  return loaded;
}

// Serialization only. Supporting curves, boundary events, their native
// parameters, ordered intervals, and membership decisions are all Bend-owned.
export async function intersectFacePlane(body, faceIndex, plane, options = {}) {
  if (!Number.isInteger(faceIndex) || faceIndex < 0 || faceIndex > 0xffffffff) throw new RangeError('Face index must be an unsigned integer');
  if (plane.type !== undefined && plane.type !== 'plane') unsupported('Face intersection requires a plane');
  const kernel = await loadFacePlane(), F = await loadFaceClassifier();
  const { solid, domains, sourceBudget } = classificationInput(body, F, options);
  if (solid === null) return { $: 'Rejected', reason: { $: 'InvalidIndex' } };
  return kernel.intersect(solid, faceIndex, domains,
    plane.origin.$ ? plane.origin : vector(plane.origin),
    plane.normal.$ ? plane.normal : vector(plane.normal),
    intersectionTolerance(options), sourceBudget);
}

export function requireResolvedFacePlane(result) {
  if (result.$ !== 'Resolved') unsupported(`Face/plane intersection ${result.$}: ${result.reason.$}`);
  return result;
}
