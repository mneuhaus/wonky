// Exact clash classification of two Rust solids (evCollision, bin/wonky.mjs
// --interference). Nothing here decides geometry: every verdict is one of the
// kernel's own exact host operations.
//
//   interference   the exact INTERSECTION exists and has positive volume
//   containment    the exact SUBTRACTION of one side from the other is empty
//   abutment       the INTERSECTION is empty (no positive volume) and the exact
//                  minimum distance is exactly 0 (its squared value is an exact
//                  rational; only the final root is rounded, and 0 is exact)
//   clear          the INTERSECTION is empty and the minimum distance is
//                  certified positive (distance - bound > 0)
//
// A pair whose intersection the kernel refuses is never "clear" by default: it
// is clear only if the exact distance separately certifies a positive gap, and
// otherwise it comes back undecided with the kernel's own refusal reason.
// Faults (anything that is not a named capability refusal) propagate.

const EMPTY = /(^|\/)empty-result$/;
const isRefusal = e => e?.name === 'RustCapabilityError' && typeof e.reason === 'string';
const isEmpty = e => isRefusal(e) && EMPTY.test(e.reason);

// `ops`: { intersect(a, b) -> bodies[], subtract(a, b) -> bodies[],
// distance(a, b) -> {distanceMm, boundMm}, volume(body) -> {volumeMm3, relBound} }.
// Each throws a RustCapabilityError for a named refusal.
export function classifyClash(ops, a, b) {
  if (ops.certify) {
    let proof = null;
    try { proof = ops.certify(a, b); }
    catch (e) { if (!isRefusal(e)) throw e; }
    if (proof) {
      // An enclosure proof gives a positive lower bound only. Preserve a
      // bounded exact minimum when the existing distance operation supplies it.
      if (proof.kind === 'clear') {
        try {
          const distance = ops.distance(a, b);
          if (distance.distanceMm - distance.boundMm > 0) {
            Object.assign(proof, { distanceMm: distance.distanceMm, distanceBoundMm: distance.boundMm,
              distanceMeaning: 'bounded-exact-distance' });
          }
        } catch (e) { if (!isRefusal(e)) throw e; }
      }
      return { ...proof, decided: true, exactClass: true, volumeMm3: 0, volumeBoundMm3: 0 };
    }
  }
  let intersection = null, intersectionRefusal = null;
  try { intersection = ops.intersect(a, b); }
  catch (e) { if (isEmpty(e)) intersection = []; else if (isRefusal(e)) intersectionRefusal = e.reason; else throw e; }

  if (intersection?.length) {
    let volumeMm3 = 0, boundMm3 = 0;
    for (const body of intersection) {
      const v = ops.volume(body);
      volumeMm3 += v.volumeMm3; boundMm3 += v.volumeMm3 * v.relBound;
    }
    if (!(volumeMm3 > 0)) return undecided('intersection-volume-not-positive', null);
    const inside = (x, y) => { try { ops.subtract(x, y); return false; } catch (e) { if (isEmpty(e)) return true; if (isRefusal(e)) return null; throw e; } };
    const targetInTool = inside(a, b), toolInTarget = inside(b, a);
    const type = targetInTool ? 'TARGET_IN_TOOL' : toolInTarget ? 'TOOL_IN_TARGET' : 'INTERFERE';
    // A full ClashType needs the containment verdict; without it the pair is
    // still proven to interfere, but the class is not, so `type` stays null
    // (INTERFERE would claim that neither side contains the other).
    const exactClass = type !== 'INTERFERE' || (targetInTool === false && toolInTarget === false);
    return { decided: true, type: exactClass ? type : null, kind: 'interference', volumeMm3, volumeBoundMm3: boundMm3, distanceMm: 0, distanceBoundMm: 0,
      containment: type !== 'INTERFERE' ? 'proven' : exactClass ? 'none' : 'undecided', exactClass };
  }

  let distance = null, distanceRefusal = null;
  try { distance = ops.distance(a, b); }
  catch (e) { if (isRefusal(e)) distanceRefusal = e.reason; else throw e; }
  if (distance) {
    const { distanceMm, boundMm } = distance;
    if (!intersectionRefusal && distanceMm === 0 && boundMm === 0) {
      return { decided: true, type: 'ABUT_NO_CLASS', kind: 'abutment', volumeMm3: 0, volumeBoundMm3: 0, distanceMm: 0, distanceBoundMm: 0, exactClass: true };
    }
    if (distanceMm - boundMm > 0) {
      return { decided: true, type: 'NONE', kind: 'clear', volumeMm3: 0, volumeBoundMm3: 0, distanceMm, distanceBoundMm: boundMm, exactClass: true };
    }
    return undecided(intersectionRefusal ? `${intersectionRefusal}; distance ${distanceMm}+-${boundMm} mm is not certified positive` : 'distance-not-certified', distance);
  }
  return undecided(intersectionRefusal
    ? `${intersectionRefusal}; ${distanceRefusal}` : `intersection empty but contact undecided: ${distanceRefusal}`, null);
}

function undecided(reason, distance) {
  return { decided: false, type: null, kind: 'refused', refusal: reason, volumeMm3: null, volumeBoundMm3: null,
    distanceMm: distance?.distanceMm ?? null, distanceBoundMm: distance?.boundMm ?? null, exactClass: false };
}
