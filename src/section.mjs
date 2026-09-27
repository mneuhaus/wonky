import { loadBend } from './bend-loader.mjs';
import { classificationInput, loadFaceClassifier } from './face-classification.mjs';
import { intersectionTolerance } from './intersections.mjs';
import { vector } from './real.mjs';
import { unsupported } from './errors.mjs';

let loaded;
export function loadSection() {
  loaded ??= loadBend(new URL('../kernel/section.bend', import.meta.url));
  return loaded;
}

// Serialization only. Bend validates every finite face, associates native
// source roots, orients the retained analytic curves, and stitches all uses.
export async function sectionSolid(body, plane, options = {}) {
  if (plane.type !== undefined && plane.type !== 'plane') unsupported('Solid section requires a plane');
  const kernel = await loadSection(), classifier = await loadFaceClassifier();
  const { solid, domains, sourceBudget } = classificationInput(body, classifier, options);
  if (solid === null) return { $: 'Failed', reason: { $: 'InvalidInput' }, faces: { $: 'Nil' } };
  return kernel.section(solid, domains,
    plane.origin.$ ? plane.origin : vector(plane.origin),
    plane.normal.$ ? plane.normal : vector(plane.normal),
    intersectionTolerance(options), sourceBudget);
}

export function requireResolvedSection(result) {
  if (result.$ !== 'Resolved') {
    const location = result.reason.face === undefined ? '' : ` at face ${result.reason.face}`;
    unsupported(`Solid/plane section ${result.reason.$}${location}`);
  }
  return result;
}
