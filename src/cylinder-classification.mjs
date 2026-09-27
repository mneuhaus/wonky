import { vector } from './real.mjs';
import { classificationInput, loadFaceClassifier } from './face-classification.mjs';
import { intersectionTolerance } from './intersections.mjs';
import { unsupported } from './errors.mjs';

let loaded;
export function loadCylinderClassifier() {
  loaded ??= (async () => {
    await loadFaceClassifier();
    const { default: classifier } = await import('../kernel/cylinder-classification.bend');
    return classifier;
  })();
  return loaded;
}

// Shared serialization only. Bend validates the cylinder, trims, incidence,
// seam topology, boundary distances and both axial meridian parities.
export async function classifyCylinderFace(body, faceIndex, point, options = {}) {
  if (!Number.isInteger(faceIndex) || faceIndex < 0 || faceIndex > 0xffffffff) throw new RangeError('Face index must be an unsigned integer');
  const F = await loadFaceClassifier();
  const classifier = await loadCylinderClassifier();
  const { solid, domains, sourceBudget } = classificationInput(body, F, options);
  if (solid === null) return { $: 'Unresolved', reason: { $: 'InvalidIndex' } };
  return classifier.classify(solid, faceIndex, domains, point.$ ? point : vector(point), intersectionTolerance(options), sourceBudget);
}

export function requireResolvedCylinderClassification(result) {
  if (result.$ === 'Unresolved') unsupported(`Cylinder face classification unresolved: ${result.reason.$}`);
  return result;
}
