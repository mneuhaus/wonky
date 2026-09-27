import Base
import ./real.bend as R
import ./precise.bend as G
import ./analytic.bend as A
import ./curve-plane.bend as C
import ./intersections.bend as I
import ./sketch-lines.bend as L

# Analytic finite-domain pair tests. Midpoints below decide overlap between
# coincident connected parameter intervals; they are not a sampled boundary.
# tilt and stretch are the carrier's first-order sensitivity to moving each
# of its input points by a length e: its tangent direction at either end
# turns by at most e * tilt, its radius changes by at most e * stretch
# (line_segment, arc_segment; join_clear uses them). start and end are the
# entity's input points (L.Point: SI words, F32x2 prefix, remainder); the
# geometry uses their prefix, the cusp rule their identity (join_clear).
type Segment is Data:
  Segment{curve: A.Curve, first: R.Real, last: R.Real, start: L.Point, end: L.Point, tilt: R.Real, stretch: R.Real}

def zero() -> R.Real:
  R.from_f32(0.0)

def z(point: G.Vec3) -> R.Real:
  G.V3{_, _, z} = point
  z

def geometry(segment: Segment) -> A.Curve:
  Segment{curve, _, _, _, _, _, _} = segment
  curve

def start_point(segment: Segment) -> L.Point:
  Segment{_, _, _, start, _, _, _} = segment
  start

def end_point(segment: Segment) -> L.Point:
  Segment{_, _, _, _, end, _, _} = segment
  end

def start(segment: Segment) -> G.Vec3:
  L.value(start_point(segment))

def end(segment: Segment) -> G.Vec3:
  L.value(end_point(segment))

def tilt(segment: Segment) -> R.Real:
  Segment{_, _, _, _, _, tilt, _} = segment
  tilt

def stretch(segment: Segment) -> R.Real:
  Segment{_, _, _, _, _, _, stretch} = segment
  stretch

def middle(segment: Segment) -> G.Vec3:
  Segment{curve, first, last, _, _, _, _} = segment
  A.curve_point(curve, R.mul(R.add(first, last), R.from_f32(0.5)))

def scale(curve: A.Curve) -> R.Real:
  match curve:
    case A.Line{_, direction}:
      I.length(direction)
    case A.Circle{_, _, _, radius}:
      radius
    case _:
      zero()

def contains(segment: Segment, point: G.Vec3, margin: R.Real) -> Bool:
  Segment{+curve, +first, +last, _, _, _, _} = segment
  +parameter = C.lift_parameter(C.curve_periodic(curve), A.curve_parameter(curve, point), first, last)
  +guard = R.div(margin, scale(curve))
  Bool.and(I.at_most(R.sub(first, guard), parameter), I.at_most(parameter, R.add(last, guard)))

def distance(a: G.Vec3, b: G.Vec3) -> R.Real:
  I.length(G.sub(a, b))

# Moving each input point by at most e turns the direction of a vector
# between two of them, of length l, by at most 2 e / l (first order). A line
# through a and b turns by at most 2 e / |ab|: tilt 2 / |ab|, stretch 0.
def line_segment(curve: A.Curve, first: R.Real, last: R.Real, +start: L.Point, +end: L.Point) -> Segment:
  Segment{curve, first, last, start, end, R.div(R.from_f32(2.0), distance(L.value(start), L.value(end))), zero()}

# The circle through a, m, b: its tangent at a (or b) makes the angle
# pi - angle(a m b) with the chord ab, so it turns by at most
# 2 e (1 / |ab| + 1 / |am| + 1 / |mb|). Its radius R = |ab| / (2 sin angle(a m b))
# changes by at most R (2 e / |ab| + |cot angle(a m b)| 2 e (1 / |am| + 1 / |mb|))
# with |cot| <= 2 R / |ab|: stretch (2 R / |ab|) (1 + 2 R (1 / |am| + 1 / |mb|)).
# Both grow like 1 / |ab| and R / |ab| for a flat arc.
def arc_segment(+curve: A.Curve, first: R.Real, last: R.Real, +start: L.Point, +mid: L.Point, +end: L.Point) -> Segment:
  +one = R.from_f32(1.0)
  +two = R.from_f32(2.0)
  +a = L.value(start)
  +m = L.value(mid)
  +b = L.value(end)
  +chord = distance(a, b)
  +inverse = R.add(R.div(one, distance(a, m)), R.div(one, distance(m, b)))
  +radius = scale(curve)
  tilt = R.mul(two, R.add(R.div(one, chord), inverse))
  stretch = R.mul(R.div(R.mul(two, radius), chord), R.add(one, R.mul(R.mul(two, radius), inverse)))
  Segment{curve, first, last, start, end, tilt, stretch}

def endpoint(+segment: Segment, +point: G.Vec3, +resolution: R.Real) -> Bool:
  Bool.or(I.at_most(distance(start(segment), point), resolution), I.at_most(distance(end(segment), point), resolution))

def shared(+a: Segment, +b: Segment, +point: G.Vec3, +resolution: R.Real) -> Bool:
  Bool.and(endpoint(a, point, resolution), endpoint(b, point, resolution))

# margin widens only the interval containment; the endpoint joining allowance
# stays resolution.
def candidate_within(+a: Segment, +b: Segment, +point: G.Vec3, +margin: R.Real, +resolution: R.Real) -> Bool:
  Bool.or(Bool.not(Bool.and(contains(a, point, margin), contains(b, point, margin))), shared(a, b, point, resolution))

def candidate_clear(+a: Segment, +b: Segment, +point: G.Vec3, +resolution: R.Real) -> Bool:
  candidate_within(a, b, point, resolution, resolution)

def coincident_within(+a: Segment, +b: Segment, +margin: R.Real, +resolution: R.Real) -> Bool:
  endpoints = Bool.and(candidate_within(a, b, start(a), margin, resolution), Bool.and(candidate_within(a, b, end(a), margin, resolution),
    Bool.and(candidate_within(a, b, start(b), margin, resolution), candidate_within(a, b, end(b), margin, resolution))))
  mids = Bool.and(Bool.not(contains(b, middle(a), margin)), Bool.not(contains(a, middle(b), margin)))
  Bool.and(endpoints, mids)

def coincident_clear(+a: Segment, +b: Segment, +resolution: R.Real) -> Bool:
  coincident_within(a, b, resolution, resolution)

# Unit tangent of a carrier at `at`, and the one pointing into the finite
# segment from its endpoint `at` (the middle of every admitted segment lies
# ahead of its endpoints: a line's by half its length, an arc's by
# r sin(sweep / 2) > 0 for a sweep in (0, 2 pi)).
def tangent_at(curve: A.Curve, +at: G.Vec3) -> G.Vec3:
  match curve:
    case A.Circle{center, normal, _, _}:
      G.normalize(G.cross(normal, G.sub(at, center)))
    case A.Line{_, direction}:
      direction
    case _:
      G.v3(0.0, 0.0, 0.0)

def leaving(+segment: Segment, +at: G.Vec3) -> G.Vec3:
  +tangent = tangent_at(geometry(segment), at)
  Bool.pick(G.Vec3, R.less(zero(), G.dot(tangent, G.sub(middle(segment), at))), tangent, G.scale(tangent, R.neg(R.from_f32(1.0))))

def nearest_point(+segment: Segment, +point: G.Vec3) -> L.Point:
  Bool.pick(L.Point, I.at_most(distance(start(segment), point), distance(end(segment), point)), start_point(segment), end_point(segment))

def nearest_end(+segment: Segment, +point: G.Vec3) -> G.Vec3:
  L.value(nearest_point(segment, point))

# Two segments that leave their nearest ends to `point` the same way (a cusp).
# Only join_clear's cusp case, which bounds the second contact with the
# carriers' error, admits such a join (see there).
def cusp_at(+a: Segment, +b: Segment, +point: G.Vec3) -> Bool:
  +ja = nearest_end(a, point)
  +jb = nearest_end(b, point)
  Bool.not(R.less(G.dot(leaving(a, ja), leaving(b, jb)), zero()))

# The kernel's length below which two points are one vertex: 2^-36 * S, the
# short-edge and tie rule of the hybrid Boolean (docs/proto-corefine.md), with S
# the sketch scale. solve() sets resolution = angular_guard * S, so
# S = resolution / angular_guard.
def short_length(+resolution: R.Real) -> R.Real:
  R.mul(R.div(resolution, I.angular_guard()), R.from_f32(0.000000000014551915228366852))

# How far the computed carriers may lie from the exact carriers through their
# input points, as a displacement e of those points: 2^-44 * S, the kernel's
# F32x2 convention (each operation errs below 2^-44 of its operands,
# kernel/hybrid/unify.bend); the input coordinates, of magnitude up to S, are
# subtracted first and dominate (docs/sketch-arcs.md "Conditioned cusps").
def carrier_error(+resolution: R.Real) -> R.Real:
  R.mul(R.div(resolution, I.angular_guard()), R.from_f32(0.00000000000005684341886080802))

# Near-tangent join of two adjacent entities (docs/sketch-arcs.md
# "Near-tangent joins"). In the near-tangent branch every point where the two
# carriers come within resolution lies within 2 sqrt(resolution * relative) of
# the tangent point F, where 1 / relative is the relative curvature of the
# pair (1/r for line/circle, 1/r1 + 1/r2 external, |1/r1 - 1/r2| internal).
# reach = 8 sqrt(resolution * relative_hi) (relative_hi >= relative, see
# conditioning below) covers that neighbourhood from the join J when F lies
# within reach / 2 of J (plus drift); reach stays below the smallest radius
# so the neighbourhood is local. J is an endpoint of both entities (within
# resolution), and neither segment's interval comes back past J within reach
# (one_sided: no near-full arc wraps around). Then:
# - smooth join (the segments leave J in opposite tangent directions): inside
#   the neighbourhood one segment lies before J and the other after it, so the
#   only contact of the finite segments is J, wherever the ill-conditioned
#   roots fall; the second root lies beyond J outside one finite interval and
#   the loop encloses no sliver. No length and no common root enter this case,
#   so a join gap (ja != jb within resolution) is fine.
# - cusp (both leave J the same way): the second root X lies in both segments
#   or in neither. It is the join when |X - J| <= short_length: the sliver
#   between J and X is then shorter than the vertex length and at most
#   |gap| <= resolution wide, so the region is unchanged at resolution.
#   X = 2 F - J (|X - J| = 2 |F - J|) only when J is a root of both
#   carriers. With a carrier separation g at J the far root lies
#   |F - J| + sqrt(|F - J|^2 + 2 relative |g|) from J; certifying that below
#   short_length needs |g| < short_length^2 / (2 relative), about 2^-73 S,
#   far below the rounding of any computed distance. So a cusp is certified
#   only at an exact join, `exact`: the two nearest input points are one
#   point by the kernel's identity (L.point_equal: SI words, prefix and
#   remainder, docs/sketch-lines.md). The line through its two input points
#   and the circle through its three pass through it by definition. Equal
#   F32x2 prefixes are not enough: two input doubles with one prefix differ
#   by their remainders (a gap g <= 2^-48 S, still far above 2^-73 S), and
#   their carriers can cross hundreds of short_length from J. The carriers
#   built from the prefixes lie within the remainder (<= 2^-48 S) of the
#   input carriers, inside carrier_error below. A cusp at a join gap, or
#   whose second contact lies farther from J, stays refused.
# - conditioning (both cases, docs/sketch-arcs.md "Conditioned cusps"): the
#   computed F is not the exact one. Moving F across the centre line (along
#   the common tangent) is what moves X: a carrier whose tangent at J turns by
#   t moves the foot of a circle centre on a line by r t, and the centre line
#   of two circles at J by relative (t_a + t_b). So |X - J| exceeds the
#   computed 2 |F - J| by at most drift = 2 relative_hi e (tilt_a + tilt_b),
#   e = carrier_error, relative_hi the relative radius with every radius
#   moved by e * stretch the unfavourable way. An error of F along the centre
#   line only lengthens the computed |F - J|. When the radius errors reach the
#   radius difference of an internal pair (`certain` false) relative_hi is
#   unbounded and the join is refused. Flat arcs (tilt ~ 1 / chord, stretch
#   ~ R / chord) and nearly equal internal radii make drift large: such a
#   cusp is refused although its exact second contact may lie within
#   short_length (a conservative refusal, never a false admission).
def join_clear(+a: Segment, +b: Segment, +ja: G.Vec3, +jb: G.Vec3, exact: Bool, +point: G.Vec3, +reach: R.Real, +radius: R.Real, +drift: R.Real, certain: Bool, +resolution: R.Real) -> Bool:
  +ua = leaving(a, ja)
  +ub = leaving(b, jb)
  +second = R.add(R.mul(R.from_f32(2.0), distance(ja, point)), drift)
  joined = I.at_most(distance(ja, jb), resolution)
  local = Bool.and(certain, Bool.and(I.at_most(second, reach), R.less(reach, radius)))
  one_sided = Bool.and(Bool.not(contains(a, G.sub(ja, G.scale(ua, reach)), resolution)), Bool.not(contains(b, G.sub(jb, G.scale(ub, reach)), resolution)))
  smooth = R.less(G.dot(ua, ub), zero())
  cusp = Bool.and(exact, I.at_most(second, short_length(resolution)))
  Bool.and(joined, Bool.and(local, Bool.and(one_sided, Bool.or(smooth, cusp))))

def adjacent_clear(+a: Segment, +b: Segment, +point: G.Vec3, +radius: R.Real, +bound: R.Real, certain: Bool, +resolution: R.Real) -> Bool:
  +reach = R.mul(R.from_f32(8.0), R.sqrt(R.mul(resolution, bound)))
  +drift = R.mul(R.mul(R.from_f32(2.0), bound), R.mul(carrier_error(resolution), R.add(tilt(a), tilt(b))))
  +ja = nearest_point(a, point)
  +jb = nearest_point(b, point)
  join_clear(a, b, L.value(ja), L.value(jb), L.point_equal(ja, jb), point, reach, radius, drift, certain, resolution)

# The square-root neighbourhood bounds *exclusion* in a near-tangent pair.
# It never increases the endpoint joining allowance. A prescribed join is
# accepted when the analytic tangent point itself agrees within resolution
# (shared) unless the pair is a cusp: its real second contact lies at
# 2 |F - J| plus the carriers' drift, or sqrt(2 relative |gap|) from F at a
# join gap, and only join_clear bounds those. The pair is also clear when it
# is a near-tangent join of adjacent entities (adjacent_clear above). `bound`
# is relative_hi, `certain` whether it is finite (join_clear).
def tangent_clear(+a: Segment, +b: Segment, +point: G.Vec3, +size: R.Real, +radius: R.Real, +bound: R.Real, certain: Bool, +resolution: R.Real) -> Bool:
  +exclusion = R.mul(R.from_f32(4.0), R.sqrt(R.mul(resolution, size)))
  separated = Bool.not(Bool.and(contains(a, point, exclusion), contains(b, point, exclusion)))
  prescribed = Bool.and(shared(a, b, point, resolution), Bool.not(cusp_at(a, b, point)))
  Bool.or(separated, Bool.or(prescribed, adjacent_clear(a, b, point, radius, bound, certain, resolution)))

def line_intersection(parallel: Bool, +a: Segment, +b: Segment, +origin: G.Vec3, +direction: G.Vec3, +other: G.Vec3, +tangent: G.Vec3, +resolution: R.Real) -> Bool:
  match parallel:
    case True{}:
      +gap = R.abs(z(G.cross(G.sub(other, origin), direction)))
      +det = R.abs(z(G.cross(direction, tangent)))
      +drift = R.mul(det, R.max(distance(start(a), end(a)), distance(start(b), end(b))))
      # Collinear within resolution + drift (both segments lie that close to one
      # line, e.g. the two radial edges of a 180 deg sector): the connected
      # parameter intervals decide, with the containment margin widened by the
      # drift. An exactly parallel pair (det = 0) is the unchanged coincident test.
      Bool.or(R.less(R.add(resolution, drift), gap), coincident_within(a, b, R.add(resolution, drift), resolution))
    case False{}:
      t = R.div(z(G.cross(G.sub(other, origin), tangent)), z(G.cross(direction, tangent)))
      candidate_clear(a, b, G.add(origin, G.scale(direction, t)), resolution)

def line_circle_roots(disjoint: Bool, near: Bool, +a: Segment, +b: Segment, +foot: G.Vec3, +direction: G.Vec3, +height2: R.Real, +radius: R.Real, +resolution: R.Real) -> Bool:
  match disjoint near:
    case True{} _:
      True{}
    case False{} True{}:
      # a is the line, b the arc: relative_hi is b's radius plus its error.
      tangent_clear(a, b, foot, radius, radius, R.add(radius, R.mul(carrier_error(resolution), stretch(b))), True{}, resolution)
    case False{} False{}:
      +step = G.scale(direction, R.sqrt(height2))
      Bool.and(candidate_clear(a, b, G.add(foot, step), resolution), candidate_clear(a, b, G.sub(foot, step), resolution))

def line_circle(+a: Segment, +b: Segment, +origin: G.Vec3, +direction: G.Vec3, +center: G.Vec3, +radius: R.Real, +resolution: R.Real) -> Bool:
  +foot = G.add(origin, G.scale(direction, G.dot(G.sub(center, origin), direction)))
  +offset = distance(center, foot)
  height2 = R.sub(R.mul(radius, radius), R.mul(offset, offset))
  +gap = R.sub(offset, radius)
  line_circle_roots(R.less(resolution, gap), I.at_most(R.abs(gap), resolution), a, b, foot, direction, height2, radius, resolution)

def circle_roots(disjoint: Bool, near: Bool, +a: Segment, +b: Segment, +center: G.Vec3, +direction: G.Vec3, +along: R.Real, +radius: R.Real, +size: R.Real, +smallest: R.Real, +bound: R.Real, certain: Bool, +resolution: R.Real) -> Bool:
  match disjoint near:
    case True{} _:
      True{}
    case False{} True{}:
      tangent_clear(a, b, G.add(center, G.scale(direction, along)), size, smallest, bound, certain, resolution)
    case False{} False{}:
      +foot = G.add(center, G.scale(direction, along))
      +height2 = R.sub(R.mul(radius, radius), R.mul(along, along))
      +step = G.scale(G.cross(G.v3(0.0, 0.0, 1.0), direction), R.sqrt(R.max(zero(), height2)))
      Bool.and(R.less(zero(), height2), Bool.and(candidate_clear(a, b, G.add(foot, step), resolution), candidate_clear(a, b, G.sub(foot, step), resolution)))

def circle_centers(coincident: Bool, +a: Segment, +b: Segment, +center: G.Vec3, +other: G.Vec3, +radius: R.Real, +other_radius: R.Real, +d: R.Real, +resolution: R.Real) -> Bool:
  match coincident:
    case True{}:
      Bool.or(R.less(resolution, R.abs(R.sub(radius, other_radius))), coincident_clear(a, b, resolution))
    case False{}:
      +sum = R.add(radius, other_radius)
      +difference = R.abs(R.sub(radius, other_radius))
      disjoint = Bool.or(R.less(R.add(sum, resolution), d), R.less(d, R.sub(difference, resolution)))
      near = Bool.or(I.at_most(R.abs(R.sub(d, sum)), resolution), I.at_most(R.abs(R.sub(d, difference)), resolution))
      along = R.div(R.add(R.sub(R.mul(radius, radius), R.mul(other_radius, other_radius)), R.mul(d, d)), R.mul(R.from_f32(2.0), d))
      # Radius of relative curvature: r1 r2 / (r1 + r2) for an external,
      # r1 r2 / |r1 - r2| for an internal tangency. relative_hi (join_clear):
      # both radii moved up by their error bound, the sum or difference down
      # by both; certain when that difference stays positive.
      +external = I.at_most(R.abs(R.sub(d, sum)), resolution)
      +e = carrier_error(resolution)
      +ra = R.add(radius, R.mul(e, stretch(a)))
      +rb = R.add(other_radius, R.mul(e, stretch(b)))
      +slack = R.sub(R.add(ra, rb), sum)
      +apart = Bool.pick(R.Real, external, sum, difference)
      bound = R.div(R.mul(ra, rb), R.max(R.sub(apart, slack), resolution))
      circle_roots(disjoint, near, a, b, center, G.scale(G.sub(other, center), R.div(R.from_f32(1.0), d)), along, radius, R.max(radius, other_radius), R.min(radius, other_radius), bound, R.less(slack, apart), resolution)

def pair_curves(first: A.Curve, second: A.Curve, a: Segment, b: Segment, +resolution: R.Real) -> Bool:
  match first second:
    case A.Line{origin, +direction} A.Line{other, +tangent}:
      parallel = I.at_most(R.abs(z(G.cross(direction, tangent))), I.angular_guard())
      line_intersection(parallel, a, b, origin, direction, other, tangent, resolution)
    case A.Line{origin, direction} A.Circle{center, _, _, radius}:
      line_circle(a, b, origin, direction, center, radius, resolution)
    case A.Circle{center, _, _, radius} A.Line{origin, direction}:
      line_circle(b, a, origin, direction, center, radius, resolution)
    case A.Circle{+center, _, _, radius} A.Circle{+other, _, _, other_radius}:
      +d = distance(center, other)
      circle_centers(I.at_most(d, resolution), a, b, center, other, radius, other_radius, d, resolution)
    case _ _:
      False{}

def clear(+a: Segment, +b: Segment, resolution: R.Real) -> Bool:
  pair_curves(geometry(a), geometry(b), a, b, resolution)
