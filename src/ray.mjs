import { loadKernel } from './kernel.mjs';
import { vector } from './real.mjs';
import { intersectionSurface } from './intersections.mjs';
import { unsupported } from './errors.mjs';

export const lineIntersectionKinds = Object.freeze({
  miss: 0, transverse: 1, tangent: 2, coincident: 3,
  unresolved: 4, invalid: 5, range: 6,
});

let loaded;
export function loadRayKernel() {
  loaded ??= (async () => {
    await loadKernel();
    const { default: ray } = await import('../kernel/ray.bend');
    return ray;
  })();
  return loaded;
}

// Serialization only. The infinite oriented line, its normalization, surface
// equation, zero certificates, roots, and finite bounds are handled in Bend.
export async function lineSurfaceIntersections(origin, direction, surface) {
  const ray = await loadRayKernel();
  return ray.line_surface(origin.$ ? origin : vector(origin), direction.$ ? direction : vector(direction), intersectionSurface(surface));
}

export function requireResolvedLineIntersection(result) {
  if (result.kind >= lineIntersectionKinds.unresolved) {
    const reason = Object.keys(lineIntersectionKinds).find(name => lineIntersectionKinds[name] === result.kind) ?? 'unknown result';
    unsupported(`Supporting-line intersection ${reason}`);
  }
  // Tangent/coincident results still require handling by the caller. This
  // helper does not make them transverse crossings or classify a trimmed face.
  return result;
}
