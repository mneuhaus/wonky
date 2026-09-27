import { loadFaceClassifier, classificationInput } from './face-classification.mjs';
import { vector } from './real.mjs';
import { intersectionTolerance } from './intersections.mjs';
import { unsupported } from './errors.mjs';

let loaded;
export function loadSolidClassifier() {
  loaded ??= (async () => {
    await loadFaceClassifier();
    const { default: classifier } = await import('../kernel/solid-classification.bend');
    return classifier;
  })();
  return loaded;
}

// Only serialization and dispatch live here. Bend validates edge-use closure,
// classifies every trimmed face and decides all ray crossings and tolerances.
export async function classifySolid(body, point, options = {}) {
  const face = await loadFaceClassifier();
  const classifier = await loadSolidClassifier();
  const { solid, domains, sourceBudget } = classificationInput(body, face, options);
  if (solid === null) return { $: 'Unresolved', reason: { $: 'InvalidTopology' } };
  return classifier.classify(solid, domains, point.$ ? point : vector(point), intersectionTolerance(options), sourceBudget);
}

export function requireResolvedSolidClassification(result) {
  if (result.$ === 'Unresolved') unsupported(`Solid classification unresolved: ${result.reason.$}`);
  return result;
}
