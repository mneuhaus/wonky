import { loadKernel } from './kernel.mjs';
import { real, vector } from './real.mjs';
import { unsupported } from './errors.mjs';

let loaded;
export function loadIntersections() {
  loaded ??= (async () => {
    await loadKernel();
    const { default: intersections } = await import('../kernel/intersections.bend');
    return intersections;
  })();
  return loaded;
}

// This adapter only serializes. Bend validates directions, radii, tolerances,
// arithmetic range, and conditioning, and constructs/classifies every curve.
export function intersectionSurface(surface) {
  if (surface.$) return surface;
  const origin = vector(surface.origin);
  const x = vector(surface.x ?? [1, 0, 0]); // Unused by supporting-surface sets.
  switch (surface.type) {
    case 'plane': return { $: 'Plane', origin, normal: vector(surface.normal), x };
    case 'cylinder': return { $: 'Cylinder', origin, axis: vector(surface.axis), x, radius: real(surface.radius) };
    case 'cone': return { $: 'Cone', origin, axis: vector(surface.axis), x, radius: real(surface.radius), angle: real(surface.angle) };
    default: return unsupported(`Supporting-surface intersection does not support '${surface.type}'`);
  }
}

export function intersectionTolerance({ linear = 1e-7, angular = 1e-10 } = {}) {
  return { $: 'Tolerance', linear: real(linear), angular: real(angular) };
}

// Returns the Bend Result ADT unchanged, retaining every F32x2 word. Resolved
// intersections may legitimately have no curves; Unresolved/Rejected never do.
export async function intersectSurfaces(first, second, tolerance) {
  const kernel = await loadIntersections();
  return kernel.intersect(intersectionSurface(first), intersectionSurface(second), intersectionTolerance(tolerance));
}

export function requireResolvedIntersection(result) {
  if (result.$ !== 'Resolved') {
    unsupported(`Supporting-surface intersection ${result.$.toLowerCase()}: ${result.reason.$}`);
  }
  return result;
}
