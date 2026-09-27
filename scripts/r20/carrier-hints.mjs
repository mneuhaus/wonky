// CAD-facing observations only: never feed these floating-point estimates back
// into the Bend kernel, exactness, topology admission, or export tolerances.
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const sub = (a, b) => a.map((x, i) => x - b[i]);
const norm = a => Math.hypot(...a);
const unit = a => a.map(x => x / norm(a));
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const ulp = x => Math.max(Number.MIN_VALUE, 2 ** (Math.floor(Math.log2(Math.abs(x))) - 52));
// Two half-ULP roundings per stored coordinate. This is a scale-dependent
// diagnostic budget, not an adjustable mm tolerance or a kernel certificate.
// L1/triangle-inequality bound: do not assume independent rounding directions.
const pointRoundoff = p => p.reduce((sum, x) => sum + ulp(x), 0);
const angularRoundoff = 32 * Number.EPSILON;

function sectionCircle(surface, plane) {
  if (!['cylinder', 'cone'].includes(surface.type)) return null;
  const axis = unit(surface.axis), normal = unit(plane.normal);
  if (!(norm(cross(axis, normal)) <= angularRoundoff)) return null; // oblique section is not a circle
  const offset = sub(plane.origin, surface.origin);
  const along = dot(axis, normal), t = dot(offset, normal) / along;
  const slope = surface.type === 'cone' ? Math.tan(surface.angle) : 0;
  const center = surface.origin.map((x, i) => x + t * axis[i]);
  const radius = surface.radius + t * slope;
  if (!(radius > 0)) return null;
  // Input coordinate rounding plus dot/division roundoff, propagated through
  // the axial projection and r(t) = r0 + t*tan(angle). The small fixed operation
  // count bounds arithmetic, not geometric error; it does not depend on the
  // residual we are trying to explain.
  const tRoundoff = normal.reduce((s, n, i) => s + Math.abs(n) * (ulp(plane.origin[i]) + ulp(surface.origin[i])), 0)
    + 8 * Number.EPSILON * (offset.reduce((s, x, i) => s + Math.abs(x * normal[i]), 0) + Math.abs(t));
  const roundoffMm = pointRoundoff(surface.origin) + pointRoundoff(center)
    + tRoundoff * (1 + Math.abs(slope)) + ulp(surface.radius) + ulp(radius)
    + (surface.type === 'cone' ? Math.abs(t) * (1 + slope * slope) * ulp(surface.angle) : 0);
  return { center, radius, roundoffMm };
}

function internalTangency(surfaces) {
  const plane = surfaces.find(s => s.type === 'plane');
  if (!plane || surfaces.length !== 3) return null;
  const circles = surfaces.filter(s => s !== plane).map(s => sectionCircle(s, plane));
  if (circles.length !== 2 || circles.some(c => !c)) return null;
  const [small, large] = circles.sort((a, b) => a.radius - b.radius);
  const r = small.radius, R = large.radius, difference = R - r;
  if (!(difference > 0)) return null; // concentric equal-radius case is not isolated tangency
  const distance = norm(sub(small.center, large.center));
  const overlapMm = distance - difference;
  const roundoffMm = small.roundoffMm + large.roundoffMm + 8 * Number.EPSILON * (distance + R + r);
  const effectiveRadiusMm = r * R / difference;
  // Circle overlap eps opens the tangent point by sqrt(2*eps*r_eff), NOT eps.
  // Show the nominal measured estimate as well as its input/arithmetic budget.
  const epsilonMm = Math.abs(overlapMm) + roundoffMm;
  const uncertaintyMm = Math.sqrt(2 * epsilonMm * effectiveRadiusMm);
  if (![overlapMm, roundoffMm, uncertaintyMm].every(Number.isFinite)) return null;
  return { overlapMm, roundoffMm, epsilonMm, effectiveRadiusMm,
    observedUncertaintyMm: Math.sqrt(2 * Math.abs(overlapMm) * effectiveRadiusMm), uncertaintyMm,
    withinRoundoff: Math.abs(overlapMm) <= roundoffMm,
    basis: 'internal circle sections: r_eff = r*R/(R-r); uncertainty = sqrt(2*epsilon*r_eff); epsilon includes double-rounding and projection arithmetic' };
}

function cylinderPlaneDistance(surfaces) {
  if (surfaces.length !== 2) return null;
  const cylinder = surfaces.find(s => s.type === 'cylinder'), plane = surfaces.find(s => s.type === 'plane');
  if (!cylinder || !plane) return null;
  const normal = unit(plane.normal), axis = unit(cylinder.axis);
  if (!(Math.abs(dot(normal, axis)) <= angularRoundoff)) return null;
  const offset = sub(cylinder.origin, plane.origin);
  const axisDistance = Math.abs(dot(offset, normal));
  const distanceMm = axisDistance - cylinder.radius;
  const roundoffMm = pointRoundoff(cylinder.origin) + pointRoundoff(plane.origin) + ulp(cylinder.radius)
    + 8 * Number.EPSILON * (norm(offset) + cylinder.radius);
  if (![distanceMm, roundoffMm].every(Number.isFinite)) return null;
  return { distanceMm, roundoffMm,
    basis: 'signed carrier separation = abs(unit plane normal dot (cylinder origin - plane origin)) - cylinder radius; negative means overlap' };
}

export function carrierHint(diagnostic) {
  const surfaces = (diagnostic.carriers ?? []).map(c => c.parameters).filter(Boolean);
  if (Number.isFinite(diagnostic.gapMm)) {
    const distance = cylinderPlaneDistance(surfaces);
    if (!distance) return { hint: 'unresolved: carrier distance unavailable', carrierDistanceMm: null,
      cadChange: 'Obtain the supporting-carrier distance before inferring a CAD clearance defect from the leaf gap.' };
    const measurement = { carrierDistanceMm: distance.distanceMm, carrierDistanceRoundoffMm: distance.roundoffMm, carrierDistanceBasis: distance.basis };
    return Math.abs(distance.distanceMm) <= distance.roundoffMm
      ? { ...measurement, hint: 'kernel case: tessellation leaves near, carriers tangent', cadChange: null }
      : { ...measurement, hint: 'CAD case: carrier offset exceeds rounding',
        cadChange: `Check the intended contact/clearance against the signed carrier separation ${distance.distanceMm} mm, not the tessellation leaf gap ${diagnostic.gapMm} mm.` };
  }
  if (Number.isFinite(diagnostic.residualMm) && /carriers are not concurrent/.test(diagnostic.reason ?? diagnostic.message)) {
    const tangency = internalTangency(surfaces);
    if (!tangency) return { hint: 'unresolved: tangency uncertainty unavailable', cadChange: 'Obtain a supported carrier-section measurement before choosing a CAD edit.' };
    return tangency.withinRoundoff && diagnostic.residualMm <= tangency.uncertaintyMm
      ? { tangency, hint: 'kernel case: tangency-amplified rounding', cadChange: null }
      : { tangency, hint: 'CAD case: concurrency error exceeds tangency rounding',
        cadChange: 'Check the intended shared carrier intersection: the measured offset or residual exceeds the double-rounding tangency budget.' };
  }
  return null;
}
