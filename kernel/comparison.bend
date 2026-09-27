import Base
import ./real.bend as R
import ./precise.bend as G

type CylinderComparison is Data:
  CylinderComparison{supported: Bool, relation: U32, equivalent: Bool, axis_deviation: F32,
    before_volume: R.Real, after_volume: R.Real, common_volume: R.Real,
    added_volume: R.Real, removed_volume: R.Real, symmetric_difference: R.Real,
    clearance: R.Real, axial_overlap: R.Real, contact_area: R.Real}

def cylinder_volume(+radius: R.Real, height: R.Real) -> R.Real:
  R.mul(R.mul(R.pi(), R.mul(radius, radius)), height)

# Relation: 0 separated, 1 cap contact, 2 volume overlap, 3 within resolution.
# This measures complete coaxial cylinders. It is not a general distance or
# penetration-depth algorithm and does not sample or tessellate boundaries.
def coaxial(+a0: G.Vec3, +a1: G.Vec3, +ra: R.Real, +b0: G.Vec3, +b1: G.Vec3, +rb: R.Real, +tolerance: R.Real) -> CylinderComparison:
  +axis = G.normalize(G.sub(a1, a0))
  +ha = G.dot(G.sub(a1, a0), axis)
  +d0 = G.sub(b0, a0)
  +d1 = G.sub(b1, a0)
  +z0 = G.dot(d0, axis)
  +z1 = G.dot(d1, axis)
  +lo = R.min(z0, z1)
  +hi = R.max(z0, z1)
  +axis_deviation = R.max(R.from_f32(G.distance(d0, G.scale(axis, z0))), R.from_f32(G.distance(d1, G.scale(axis, z1))))
  +supported = R.less(axis_deviation, R.from_f32(0.000000001))
  +height = R.max(R.from_f32(0.0), R.sub(R.min(ha, hi), R.max(R.from_f32(0.0), lo)))
  +gap = R.max(R.sub(lo, ha), R.neg(hi))
  +radius = R.min(ra, rb)
  +before = cylinder_volume(ra, ha)
  +after = cylinder_volume(rb, R.sub(hi, lo))
  +common = cylinder_volume(radius, height)
  +added = R.max(R.from_f32(0.0), R.sub(after, common))
  +removed = R.max(R.from_f32(0.0), R.sub(before, common))
  +contact = R.equal(gap, R.from_f32(0.0))
  relation = Bool.pick(U32, contact, 1, Bool.pick(U32, R.less(tolerance, gap), 0, Bool.pick(U32, R.less(gap, R.neg(tolerance)), 2, 3)))
  delta = R.max(R.abs(R.sub(ra, rb)), R.max(R.abs(lo), R.abs(R.sub(hi, ha))))
  equivalent = Bool.and(supported, Bool.not(R.less(tolerance, R.max(delta, axis_deviation))))
  CylinderComparison{supported, relation, equivalent, R.approx(axis_deviation), before, after, common, added, removed,
    R.add(added, removed), R.max(R.from_f32(0.0), gap), height,
    Bool.pick(R.Real, contact, cylinder_volume(radius, R.from_f32(1.0)), R.from_f32(0.0))}
