import Base
import ./real.bend as R
import ./precise.bend as G

# How finely a circular edge must be divided to stay within a requested
# deviation, and the deviation such a division actually achieves.
#
# Both live in Bend because the deviation is the only thing a print mesh can
# promise about geometry it necessarily approximates. Computed in the host it
# would be an assertion about the mesh; computed here it is a property of the
# analytic circle the mesh came from, and the host merely carries it.
#
# The count belongs to the EDGE, never to a face. Two faces meeting on a circle
# must divide it identically or the shell they form has a seam of unmatched
# vertices, which is how the existing display tessellation produces meshes with
# up to 184 unpaired edges. Sharing the count makes watertightness structural
# rather than something to check afterwards.

# An inscribed regular polygon of `count` chords misses the circle by this much
# at the middle of each chord: radius * (1 - cos(pi / count)).
def sagitta(+radius: R.Real, +count: U32) -> R.Real:
  R.mul(radius, R.sub(R.from_f32(1.0), R.cos(R.div(R.pi(), R.from_f32(U32.to_f32(count))))))

def within(+radius: R.Real, +count: U32, +deviation: R.Real) -> Bool:
  Bool.not(R.less(deviation, sagitta(radius, count)))

# Beyond this a request is refused rather than answered with a mesh nobody
# asked for the size of. At the cap a 1 m radius still holds 0.15 um.
def cap() -> U32:
  8192

# 1 - cos(t) stays below t^2/2, so inverting the loose form never under-counts:
# t = sqrt(2 * deviation / radius) and count = pi / t. The verification below
# still runs, because this estimate is evaluated in single precision and the
# guarantee has to hold on the double-word value.
def estimate(+radius: R.Real, +deviation: R.Real) -> U32:
  +ratio = R.div(radius, R.mul(R.from_f32(2.0), deviation))
  +raw = (F32.to_u32(R.approx(R.mul(R.pi(), R.sqrt(ratio)))) + 1 : U32)
  Bool.pick(U32, U32.is_lt(raw, 3), 3, Bool.pick(U32, U32.is_lt(cap(), raw), cap(), raw))

# The Bool is carried through the recursion rather than recomputed inside it,
# because Bend matches on a parameter and not on a computed value.
def refine(fuel: Nat, ok: Bool, +count: U32, +radius: R.Real, +deviation: R.Real) -> U32:
  match fuel:
    case 0n:
      count
    case 1n+left:
      match ok:
        case True{}:
          count
        case False{}:
          +next = (count + 1 : U32)
          refine(left, within(radius, next, deviation), next, radius, deviation)

def chord_count(+radius: R.Real, +deviation: R.Real) -> U32:
  +start = estimate(radius, deviation)
  refine(64n, within(radius, start, deviation), start, radius, deviation)

# The sample points of a divided circle. These are coordinates of the printed
# part, so they are computed here rather than in the host: the host may carry
# geometry and orient triangles for display, but it does not construct points.
# Index 0 sits on x, which is where the seam vertex of a revolved or lofted
# body already is, so a face's corners coincide with the B-rep vertices exactly
# instead of landing near them.
def ring_point(+origin: G.Vec3, +axis: G.Vec3, +x: G.Vec3, +radius: R.Real, +index: U32, +count: U32) -> G.Vec3:
  +angle = R.div(R.mul(R.mul(R.from_f32(2.0), R.pi()), R.from_f32(U32.to_f32(index))),
    R.from_f32(U32.to_f32(count)))
  G.add(origin, G.scale(G.add(G.scale(x, R.cos(angle)), G.scale(G.cross(axis, x), R.sin(angle))), radius))

def ring_from(remaining: Nat, +index: U32, +origin: G.Vec3, +axis: G.Vec3, +x: G.Vec3, +radius: R.Real, +count: U32) -> List<&2, G.Vec3>:
  match remaining:
    case 0n:
      Nil{}
    case 1n+left:
      ring_point(origin, axis, x, radius, index, count)
        <> ring_from(left, (index + 1 : U32), origin, axis, x, radius, count)

def ring(+origin: G.Vec3, +axis: G.Vec3, +x: G.Vec3, +radius: R.Real, +count: U32) -> List<&2, G.Vec3>:
  ring_from(U32.to_nat(count), 0, origin, axis, x, radius, count)

# ---- arcs, meridians and doubly curved zones (R20 print-mesh coverage) -----
#
# A trimmed arc, a meridian of a revolved face and the interior rows of a
# sphere or torus zone are sampled here for the same reason whole circles are:
# they are coordinates of the printed part. The host decides only how many
# samples an edge gets and how triangles connect them. Each edge is sampled
# once and shared by both faces that use it, and its two ends are the B-rep
# vertices themselves, so these functions return only the interior samples.

# The parameter of a point on a circle frame: the angle from x towards
# normal x x. The same convention as analytic.curve_parameter on a circle.
def angle_of(+origin: G.Vec3, +normal: G.Vec3, +x: G.Vec3, point: G.Vec3) -> R.Real:
  +d = G.sub(point, origin)
  R.atan2(G.dot(d, G.cross(normal, x)), G.dot(d, x))

def fraction(+whole: R.Real, +index: U32, +count: U32) -> R.Real:
  R.div(R.mul(whole, R.from_f32(U32.to_f32(index))), R.from_f32(U32.to_f32(count)))

# The point of a circle at parameter first + sweep * index / count.
def arc_point(+origin: G.Vec3, +normal: G.Vec3, +x: G.Vec3, +radius: R.Real, +first: R.Real, +sweep: R.Real, +index: U32, +count: U32) -> G.Vec3:
  +angle = R.add(first, fraction(sweep, index, count))
  G.add(origin, G.scale(G.add(G.scale(x, R.cos(angle)), G.scale(G.cross(normal, x), R.sin(angle))), radius))

def arc_from(remaining: Nat, +index: U32, +origin: G.Vec3, +normal: G.Vec3, +x: G.Vec3, +radius: R.Real, +first: R.Real, +sweep: R.Real, +count: U32) -> List<&2, G.Vec3>:
  match remaining:
    case 0n:
      Nil{}
    case 1n+left:
      arc_point(origin, normal, x, radius, first, sweep, index, count)
        <> arc_from(left, (index + 1 : U32), origin, normal, x, radius, first, sweep, count)

# Samples 1 .. count - 1 of an arc divided into `count` equal steps from
# parameter `first` through `sweep` (signed, radians). A full circle is an arc
# of sweep 2 pi that starts and ends on its own vertex.
def arc_interior(+origin: G.Vec3, +normal: G.Vec3, +x: G.Vec3, +radius: R.Real, +first: R.Real, +sweep: R.Real, +count: U32) -> List<&2, G.Vec3>:
  arc_from(U32.to_nat(Bool.pick(U32, U32.is_lt(count, 1), 0, (count - 1 : U32))), 1, origin, normal, x, radius, first, sweep, count)

# A point turned by `angle` about the line through `origin` along the unit
# `axis` (right hand). On a surface of revolution this carries a meridian
# sample to the same meridian position at another angle, so it lands on the
# surface for every carrier the revolve builds.
def rotate_about(point: G.Vec3, +origin: G.Vec3, +axis: G.Vec3, +angle: R.Real) -> G.Vec3:
  +d = G.sub(point, origin)
  +height = G.dot(d, axis)
  +radial = G.sub(d, G.scale(axis, height))
  G.add(G.add(origin, G.scale(axis, height)),
    G.add(G.scale(radial, R.cos(angle)), G.scale(G.cross(axis, radial), R.sin(angle))))

def row_from(remaining: Nat, +index: U32, +point: G.Vec3, +origin: G.Vec3, +axis: G.Vec3, +sweep: R.Real, +count: U32) -> List<&2, G.Vec3>:
  match remaining:
    case 0n:
      Nil{}
    case 1n+left:
      rotate_about(point, origin, axis, fraction(sweep, index, count))
        <> row_from(left, (index + 1 : U32), point, origin, axis, sweep, count)

# The interior samples 1 .. count - 1 of the parallel through `point`, turned
# through `sweep` in `count` equal steps: an interior row of a revolved zone.
def row_interior(+point: G.Vec3, +origin: G.Vec3, +axis: G.Vec3, +sweep: R.Real, +count: U32) -> List<&2, G.Vec3>:
  row_from(U32.to_nat(Bool.pick(U32, U32.is_lt(count, 1), 0, (count - 1 : U32))), 1, point, origin, axis, sweep, count)

# How far the chords of an arc divided into `count` equal steps of a total
# `sweep` stay from it: radius * (1 - cos(|sweep| / (2 count))). For a whole
# circle (sweep 2 pi) this is `sagitta` above.
def arc_sagitta(+radius: R.Real, +sweep: R.Real, +count: U32) -> R.Real:
  R.mul(radius, R.sub(R.from_f32(1.0), R.cos(R.div(R.abs(sweep), R.mul(R.from_f32(2.0), R.from_f32(U32.to_f32(count)))))))

# A bound on how far a flat triangle strays from a sphere or torus zone when
# its corners lie on the surface at parameters no more than `du` apart about
# the axis and `dv` apart along the meridian circle (radius `minor`, centre at
# distance `major` from the axis; a sphere is major 0).
#
# With sigma(u, v) = O + (major + minor cos v) e(u) + minor sin v axis, the
# second derivatives are bounded by |s_uu| <= major + minor, |s_uv| <= minor
# and |s_vv| <= minor. Expanding each corner about any point p of the
# parameter triangle, the linear terms cancel in the barycentric sum and
#   |sum l_i sigma(p_i) - sigma(p)| <= 1/2 sum l_i |D2 sigma [p_i - p]|
#     <= 1/2 ((major + minor) Var u + 2 minor sqrt(Var u Var v) + minor Var v),
# and a weighted variance of values spread over w is at most w^2 / 4. So every
# point of the flat triangle is within this distance of the surface point with
# the same barycentric parameters, and every surface point of the parameter
# triangle within it of the flat one: a two-sided (Hausdorff) bound.
def grid_bound(+major: R.Real, +minor: R.Real, +du: R.Real, +dv: R.Real) -> R.Real:
  +a = R.abs(du)
  +b = R.abs(dv)
  R.div(R.add(R.add(R.mul(R.add(major, minor), R.mul(a, a)),
    R.mul(R.mul(R.from_f32(2.0), minor), R.mul(a, b))), R.mul(minor, R.mul(b, b))), R.from_f32(8.0))

def grid_within(+major: R.Real, +minor: R.Real, +count: U32, +deviation: R.Real) -> Bool:
  +step = R.div(R.mul(R.from_f32(2.0), R.pi()), R.from_f32(U32.to_f32(count)))
  Bool.not(R.less(deviation, grid_bound(major, minor, step, step)))

# With du = dv = t the bound is t^2 (major + 4 minor) / 8, so
# count = 2 pi / t = pi sqrt((major + 4 minor) / (2 deviation)).
def grid_estimate(+major: R.Real, +minor: R.Real, +deviation: R.Real) -> U32:
  +ratio = R.div(R.add(major, R.mul(R.from_f32(4.0), minor)), R.mul(R.from_f32(2.0), deviation))
  +raw = (F32.to_u32(R.approx(R.mul(R.pi(), R.sqrt(ratio)))) + 1 : U32)
  Bool.pick(U32, U32.is_lt(raw, 3), 3, Bool.pick(U32, U32.is_lt(cap(), raw), cap(), raw))

def grid_refine(fuel: Nat, ok: Bool, +count: U32, +major: R.Real, +minor: R.Real, +deviation: R.Real) -> U32:
  match fuel:
    case 0n:
      count
    case 1n+left:
      match ok:
        case True{}:
          count
        case False{}:
          +next = (count + 1 : U32)
          grid_refine(left, grid_within(major, minor, next, deviation), next, major, minor, deviation)

# The divisions per full turn a sphere or torus zone needs, in both directions,
# for grid_bound to hold `deviation`. The caller checks grid_within on the
# answer, as it checks `within` on chord_count.
def grid_count(+major: R.Real, +minor: R.Real, +deviation: R.Real) -> U32:
  +start = grid_estimate(major, minor, deviation)
  grid_refine(64n, grid_within(major, minor, start, deviation), start, major, minor, deviation)
