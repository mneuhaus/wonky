import Base
import ./real.bend as R
import ./precise.bend as G
import ./analytic.bend as A

# Supporting-surface intersections only. These curves are not trimmed edges,
# face classifications, or a solid Boolean result. All predicates and geometry
# below run in Bend on normalized F32x2 words.
type Tolerance is Data:
  Tolerance{linear: R.Real, angular: R.Real}

type Relation is Data:
  CrossingPlanes{}
  CoincidentPlanes{}
  ParallelPlanes{}
  CircleSection{}
  EllipseSection{}
  TwoGenerators{}
  TangentGenerator{}
  EmptySection{}

type ResolutionIssue is Data:
  LinearBudget{}
  AngularBudget{}
  NearParallelPlanes{}
  NearCoincidentPlanes{}
  NearAxisParallelPlane{}
  NearCircleSection{}
  NearTangency{}
  RadiusBelowTolerance{}

type Rejection is Data:
  InvalidTolerance{}
  InvalidGeometry{}
  InvalidDirection{}
  InvalidRadius{}
  OutputRange{}
  UnsupportedSurfacePair{}

type IntersectionResult is Data:
  Resolved{relation: Relation, curves: List<&2, A.Curve>, linear_resolution: R.Real, angular_resolution: R.Real}
  Unresolved{reason: ResolutionIssue, linear_resolution: R.Real, angular_resolution: R.Real}
  Rejected{reason: Rejection}

# Operational guard, not an interval-arithmetic proof. The supported coordinate
# and radius magnitude is <= 1e10; directions have max component >= 1e-12.
# The guard is amplified by the actual conditioning before accepting a curve.
def round_guard() -> R.Real:
  R.from_f32(0.0000000000001)

def angular_guard() -> R.Real:
  R.from_f32(0.000000000001)

def limit() -> R.Real:
  R.from_f32(10000000000.0)

def at_most(+a: R.Real, +b: R.Real) -> Bool:
  Bool.or(R.less(a, b), R.equal(a, b))

def scalar_valid(+a: R.Real) -> Bool:
  R.Real{hi, lo} = a
  Bool.and(R.equal(a, R.renorm(hi, lo)), at_most(R.abs(a), limit()))

def vec_valid(v: G.Vec3) -> Bool:
  G.V3{x, y, z} = v
  Bool.and(scalar_valid(x), Bool.and(scalar_valid(y), scalar_valid(z)))

def magnitude(v: G.Vec3) -> R.Real:
  G.V3{x, y, z} = v
  R.max(R.abs(x), R.max(R.abs(y), R.abs(z)))

def zero_vec(v: G.Vec3) -> Bool:
  G.V3{x, y, z} = v
  Bool.and(R.equal(x, R.from_f32(0.0)), Bool.and(R.equal(y, R.from_f32(0.0)), R.equal(z, R.from_f32(0.0))))

def length(+v: G.Vec3) -> R.Real:
  R.sqrt(G.dot(v, v))

def direction_valid(v: G.Vec3) -> Bool:
  at_most(angular_guard(), magnitude(v))

def input_scale(a: G.Vec3, b: G.Vec3, radius: R.Real) -> R.Real:
  R.max(R.from_f32(1.0), R.max(magnitude(a), R.max(magnitude(b), radius)))

def guard(scale: R.Real) -> R.Real:
  R.mul(round_guard(), scale)

def unresolved(reason: ResolutionIssue, resolution: R.Real) -> IntersectionResult:
  Unresolved{reason, resolution, angular_guard()}

def resolved(relation: Relation, curves: List<&2, A.Curve>, resolution: R.Real) -> IntersectionResult:
  Resolved{relation, curves, resolution, angular_guard()}

def tolerance_linear(tolerance: Tolerance) -> R.Real:
  Tolerance{linear, _} = tolerance
  linear

def tolerance_angular(tolerance: Tolerance) -> R.Real:
  Tolerance{_, angular} = tolerance
  angular

def tolerance_valid(tolerance: Tolerance) -> Bool:
  Tolerance{+linear, +angular} = tolerance
  Bool.and(Bool.and(scalar_valid(linear), scalar_valid(angular)),
    Bool.and(R.less(R.from_f32(0.0), linear), Bool.and(R.less(R.from_f32(0.0), angular), at_most(angular, R.from_f32(0.1)))))

# Raw directions are used in the zero tests. Normalizing a direction first can
# turn an exactly representable orthogonality relation into a nonzero residual.
def signed_distance(delta: G.Vec3, +normal: G.Vec3) -> R.Real:
  R.div(G.dot(delta, normal), length(normal))

# Exact-zero certificates use error-free F32 expansions, not a rounded F32x2
# determinant. A product is admitted only when the splitter and its complete
# 48-bit result fit the F32 exponent range. An unavailable certificate keeps
# the geometric degeneracy unresolved; it never proves a zero.
type Expansion is Data:
  Expansion{safe: Bool, words: List<&2, F32>}

def put_word(+word: F32, +words: List<&2, F32>) -> List<&2, F32>:
  Bool.pick(List<&2, F32>, F32.is_eq(word, 0.0), words, word <> words)

def real_hi(value: R.Real) -> F32:
  R.Real{hi, _} = value
  hi

def real_lo(value: R.Real) -> F32:
  R.Real{_, lo} = value
  lo

def grow_words(words: List<&2, F32>, word: F32) -> List<&2, F32>:
  match words:
    case Nil{}:
      put_word(word, Nil{})
    case head <> tail:
      +sum = R.add(R.from_f32(head), R.from_f32(word))
      put_word(real_lo(sum), grow_words(tail, real_hi(sum)))

def add_words(a: List<&2, F32>, b: List<&2, F32>) -> List<&2, F32>:
  match a:
    case Nil{}:
      b
    case head <> tail:
      add_words(tail, grow_words(b, head))

def neg_words(words: List<&2, F32>) -> List<&2, F32>:
  match words:
    case Nil{}:
      Nil{}
    case head <> tail:
      F32.neg(head) <> neg_words(tail)

def expansion_real(value: R.Real) -> Expansion:
  R.Real{hi, lo} = value
  Expansion{True{}, put_word(lo, put_word(hi, Nil{}))}

def expansion_add(a: Expansion, b: Expansion) -> Expansion:
  Expansion{safe_a, words_a} = a
  Expansion{safe_b, words_b} = b
  Expansion{Bool.and(safe_a, safe_b), add_words(words_a, words_b)}

def expansion_neg(a: Expansion) -> Expansion:
  Expansion{safe, words} = a
  Expansion{safe, neg_words(words)}

def word_exponent(word: F32) -> U32:
  U32.and(U32.shrn(F32.bits(word), 23n), 255)

def product_exponents(+a: U32, +b: U32) -> Bool:
  +sum = (a + b : U32)
  Bool.and(Bool.and(U32.is_le(1, a), U32.is_le(a, 240)),
    Bool.and(Bool.and(U32.is_le(1, b), U32.is_le(b, 240)), Bool.and(U32.is_le(151, sum), U32.is_le(sum, 350))))

def product_safe(+a: F32, +b: F32) -> Bool:
  Bool.or(Bool.or(F32.is_eq(a, 0.0), F32.is_eq(b, 0.0)), product_exponents(word_exponent(a), word_exponent(b)))

def expansion_product_word_checked(safe: Bool, a: F32, b: F32) -> Expansion:
  match safe:
    case False{}:
      Expansion{False{}, Nil{}}
    case True{}:
      expansion_real(R.mul(R.from_f32(a), R.from_f32(b)))

def expansion_product_word(+a: F32, +b: F32) -> Expansion:
  expansion_product_word_checked(product_safe(a, b), a, b)

def expansion_scale_words(words: List<&2, F32>, +b: F32) -> Expansion:
  match words:
    case Nil{}:
      Expansion{True{}, Nil{}}
    case head <> tail:
      expansion_add(expansion_product_word(head, b), expansion_scale_words(tail, b))

def expansion_mul_words(a: List<&2, F32>, +b: List<&2, F32>) -> Expansion:
  match a:
    case Nil{}:
      Expansion{True{}, Nil{}}
    case head <> tail:
      expansion_add(expansion_scale_words(b, head), expansion_mul_words(tail, b))

def expansion_safe(safe: Bool, value: Expansion) -> Expansion:
  Expansion{safe_value, words} = value
  Expansion{Bool.and(safe, safe_value), words}

def expansion_mul(a: Expansion, b: Expansion) -> Expansion:
  Expansion{safe_a, words_a} = a
  Expansion{safe_b, words_b} = b
  expansion_safe(Bool.and(safe_a, safe_b), expansion_mul_words(words_a, words_b))

def expansion_empty(words: List<&2, F32>) -> Bool:
  match words:
    case Nil{}:
      True{}
    case _:
      False{}

def expansion_zero(value: Expansion) -> Bool:
  Expansion{safe, words} = value
  Bool.and(safe, expansion_empty(words))

def exact_product(a: R.Real, b: R.Real) -> Expansion:
  expansion_mul(expansion_real(a), expansion_real(b))

def exact_product_difference(a: R.Real, b: R.Real, c: R.Real, d: R.Real) -> Bool:
  expansion_zero(expansion_add(exact_product(a, b), expansion_neg(exact_product(c, d))))

def exact_parallel(a: G.Vec3, b: G.Vec3) -> Bool:
  G.V3{+ax, +ay, +az} = a
  G.V3{+bx, +by, +bz} = b
  Bool.and(exact_product_difference(ay, bz, az, by), Bool.and(exact_product_difference(az, bx, ax, bz), exact_product_difference(ax, by, ay, bx)))

def parallel_certificate(candidate: Bool, a: G.Vec3, b: G.Vec3) -> Bool:
  match candidate:
    case False{}:
      False{}
    case True{}:
      exact_parallel(a, b)

def exact_dot(a: G.Vec3, b: G.Vec3) -> Expansion:
  G.V3{ax, ay, az} = a
  G.V3{bx, by, bz} = b
  expansion_add(exact_product(ax, bx), expansion_add(exact_product(ay, by), exact_product(az, bz)))

def perpendicular_certificate(candidate: Bool, a: G.Vec3, b: G.Vec3) -> Bool:
  match candidate:
    case False{}:
      False{}
    case True{}:
      expansion_zero(exact_dot(a, b))

def exact_dot_delta(+normal: G.Vec3, a: G.Vec3, b: G.Vec3) -> Expansion:
  expansion_add(exact_dot(normal, a), expansion_neg(exact_dot(normal, b)))

def coincidence_certificate(candidate: Bool, normal: G.Vec3, a: G.Vec3, b: G.Vec3) -> Bool:
  match candidate:
    case False{}:
      False{}
    case True{}:
      expansion_zero(exact_dot_delta(normal, a, b))

def tangency_certificate(candidate: Bool, +normal: G.Vec3, a: G.Vec3, b: G.Vec3, +radius: R.Real) -> Bool:
  match candidate:
    case False{}:
      False{}
    case True{}:
      +dot = exact_dot_delta(normal, a, b)
      radius_squared = exact_product(radius, radius)
      norm_squared = exact_dot(normal, normal)
      expansion_zero(expansion_add(expansion_mul(dot, dot), expansion_neg(expansion_mul(radius_squared, norm_squared))))

def finish_budget(within: Bool, relation: Relation, curves: List<&2, A.Curve>, resolution: R.Real) -> IntersectionResult:
  match within:
    case True{}:
      resolved(relation, curves, resolution)
    case False{}:
      unresolved(LinearBudget{}, resolution)

def finish(within: Bool, relation: Relation, curves: List<&2, A.Curve>, +resolution: R.Real, tolerance: Tolerance) -> IntersectionResult:
  match within:
    case False{}:
      Rejected{OutputRange{}}
    case True{}:
      linear = tolerance_linear(tolerance)
      finish_budget(at_most(resolution, linear), relation, curves, resolution)

def plane_parallel_clear(clear: Bool, resolution: R.Real) -> IntersectionResult:
  match clear:
    case True{}:
      resolved(ParallelPlanes{}, Nil{}, resolution)
    case False{}:
      unresolved(NearCoincidentPlanes{}, resolution)

def plane_parallel_separation(coincident: Bool, +distance: R.Real, +resolution: R.Real, tolerance: Tolerance) -> IntersectionResult:
  match coincident:
    case True{}:
      resolved(CoincidentPlanes{}, Nil{}, resolution)
    case False{}:
      linear = tolerance_linear(tolerance)
      plane_parallel_clear(R.less(R.add(linear, resolution), R.abs(distance)), resolution)

def plane_line(+a0: G.Vec3, +an: G.Vec3, b0: G.Vec3, bn: G.Vec3, +scale: R.Real, +sine: R.Real, +cross: G.Vec3, tolerance: Tolerance) -> IntersectionResult:
  +direction = G.scale(cross, R.div(R.from_f32(1.0), sine))
  shift = R.div(signed_distance(G.sub(b0, a0), bn), sine)
  +origin = G.add(a0, G.scale(G.cross(direction, an), shift))
  resolution = R.div(guard(R.max(scale, magnitude(origin))), sine)
  finish(vec_valid(origin), CrossingPlanes{}, [A.Line{origin, direction}], resolution, tolerance)

def plane_nonparallel(near: Bool, a0: G.Vec3, an: G.Vec3, b0: G.Vec3, bn: G.Vec3, +scale: R.Real, sine: R.Real, cross: G.Vec3, tolerance: Tolerance) -> IntersectionResult:
  match near:
    case True{}:
      unresolved(NearParallelPlanes{}, guard(scale))
    case False{}:
      plane_line(a0, an, b0, bn, scale, sine, cross, tolerance)

def plane_plane_classify(parallel: Bool, +a0: G.Vec3, +an: G.Vec3, +b0: G.Vec3, +bn: G.Vec3, +scale: R.Real, +tolerance: Tolerance) -> IntersectionResult:
  match parallel:
    case True{}:
      +distance = signed_distance(G.sub(b0, a0), an)
      coincident = coincidence_certificate(R.equal(distance, R.from_f32(0.0)), an, b0, a0)
      plane_parallel_separation(coincident, distance, guard(scale), tolerance)
    case False{}:
      +unit_a = G.normalize(an)
      +cross = G.cross(unit_a, G.normalize(bn))
      +sine = length(cross)
      angular = tolerance_angular(tolerance)
      plane_nonparallel(at_most(sine, R.add(angular, angular_guard())), a0, unit_a, b0, bn, scale, sine, cross, tolerance)

def plane_plane_budget(ok: Bool, +a0: G.Vec3, +an: G.Vec3, +b0: G.Vec3, +bn: G.Vec3, +scale: R.Real, tolerance: Tolerance) -> IntersectionResult:
  match ok:
    case False{}:
      unresolved(LinearBudget{}, guard(scale))
    case True{}:
      parallel = parallel_certificate(zero_vec(G.cross(an, bn)), an, bn)
      plane_plane_classify(parallel, a0, an, b0, bn, scale, tolerance)

def plane_plane_directions(ok: Bool, +a0: G.Vec3, an: G.Vec3, +b0: G.Vec3, bn: G.Vec3, +tolerance: Tolerance) -> IntersectionResult:
  match ok:
    case False{}:
      Rejected{InvalidDirection{}}
    case True{}:
      +scale = input_scale(a0, b0, R.from_f32(0.0))
      linear = tolerance_linear(tolerance)
      plane_plane_budget(at_most(guard(scale), linear), a0, an, b0, bn, scale, tolerance)

def plane_plane_input(ok: Bool, a0: G.Vec3, +an: G.Vec3, b0: G.Vec3, +bn: G.Vec3, tolerance: Tolerance) -> IntersectionResult:
  match ok:
    case False{}:
      Rejected{InvalidGeometry{}}
    case True{}:
      plane_plane_directions(Bool.and(direction_valid(an), direction_valid(bn)), a0, an, b0, bn, tolerance)

def plane_plane_geometry(+a0: G.Vec3, +an: G.Vec3, +b0: G.Vec3, +bn: G.Vec3, tolerance: Tolerance) -> IntersectionResult:
  plane_plane_input(Bool.and(Bool.and(vec_valid(a0), vec_valid(an)), Bool.and(vec_valid(b0), vec_valid(bn))), a0, an, b0, bn, tolerance)

def generator_pair(+base: G.Vec3, +normal: G.Vec3, +axis: G.Vec3, +radius: R.Real, +distance: R.Real, +scale: R.Real, tolerance: Tolerance) -> IntersectionResult:
  +height = R.sqrt(R.mul(R.sub(radius, R.abs(distance)), R.add(radius, R.abs(distance))))
  +offset = G.scale(G.normalize(G.cross(axis, normal)), height)
  +a = G.add(base, offset)
  +b = G.sub(base, offset)
  resolution = R.mul(guard(R.max(scale, R.max(magnitude(a), magnitude(b)))), R.max(R.from_f32(1.0), R.div(radius, height)))
  finish(Bool.and(vec_valid(a), vec_valid(b)), TwoGenerators{}, [A.Line{a, axis}, A.Line{b, axis}], resolution, tolerance)

def generator_disjoint(disjoint: Bool, base: G.Vec3, normal: G.Vec3, axis: G.Vec3, radius: R.Real, distance: R.Real, +scale: R.Real, tolerance: Tolerance) -> IntersectionResult:
  match disjoint:
    case True{}:
      resolved(EmptySection{}, Nil{}, guard(scale))
    case False{}:
      generator_pair(base, normal, axis, radius, distance, scale, tolerance)

def generator_separation(near: Bool, gap: R.Real, base: G.Vec3, normal: G.Vec3, axis: G.Vec3, radius: R.Real, distance: R.Real, +scale: R.Real, tolerance: Tolerance) -> IntersectionResult:
  match near:
    case True{}:
      unresolved(NearTangency{}, guard(scale))
    case False{}:
      generator_disjoint(R.less(gap, R.from_f32(0.0)), base, normal, axis, radius, distance, scale, tolerance)

def generators_tangent(tangent: Bool, +base: G.Vec3, normal: G.Vec3, +axis: G.Vec3, radius: R.Real, distance: R.Real, +gap: R.Real, +scale: R.Real, +tolerance: Tolerance) -> IntersectionResult:
  match tangent:
    case True{}:
      resolution = guard(R.max(scale, magnitude(base)))
      finish(vec_valid(base), TangentGenerator{}, [A.Line{base, axis}], resolution, tolerance)
    case False{}:
      linear = tolerance_linear(tolerance)
      generator_separation(at_most(R.abs(gap), R.add(linear, guard(scale))), gap, base, normal, axis, radius, distance, scale, tolerance)

def generators(+po: G.Vec3, +normal: G.Vec3, +co: G.Vec3, axis: G.Vec3, +radius: R.Real, scale: R.Real, tolerance: Tolerance) -> IntersectionResult:
  +distance = signed_distance(G.sub(po, co), normal)
  +unit_n = G.normalize(normal)
  base = G.add(co, G.scale(unit_n, distance))
  +gap = R.sub(radius, R.abs(distance))
  tangent = tangency_certificate(R.equal(gap, R.from_f32(0.0)), normal, po, co, radius)
  generators_tangent(tangent, base, unit_n, G.normalize(axis), radius, distance, gap, scale, tolerance)

def section_circle(+center: G.Vec3, +normal: G.Vec3, radius: R.Real, +scale: R.Real, tolerance: Tolerance) -> IntersectionResult:
  finish(vec_valid(center), CircleSection{}, [A.Circle{center, normal, A.axis_x(normal), radius}], guard(R.max(scale, magnitude(center))), tolerance)

def section_ellipse(near_circle: Bool, +center: G.Vec3, +normal: G.Vec3, axis: G.Vec3, +radius: R.Real, +cosine: R.Real, +sine: R.Real, +scale: R.Real, tolerance: Tolerance) -> IntersectionResult:
  match near_circle:
    case True{}:
      unresolved(NearCircleSection{}, guard(scale))
    case False{}:
      x = G.normalize(G.cross(G.cross(normal, axis), normal))
      +major = R.div(radius, R.abs(cosine))
      resolution = R.div(guard(R.max(scale, R.max(magnitude(center), major))), R.min(R.abs(cosine), sine))
      finish(Bool.and(vec_valid(center), scalar_valid(major)), EllipseSection{}, [A.Ellipse{center, normal, x, major, radius}], resolution, tolerance)

def section_choice(circle: Bool, center: G.Vec3, +n: G.Vec3, +a: G.Vec3, radius: R.Real, cosine: R.Real, scale: R.Real, +tolerance: Tolerance) -> IntersectionResult:
  match circle:
    case True{}:
      section_circle(center, n, radius, scale, tolerance)
    case False{}:
      +sine = length(G.cross(n, a))
      angular = tolerance_angular(tolerance)
      section_ellipse(at_most(sine, R.add(angular, angular_guard())), center, n, a, radius, cosine, sine, scale, tolerance)

def section_transverse(circle: Bool, po: G.Vec3, +normal: G.Vec3, +co: G.Vec3, +axis: G.Vec3, radius: R.Real, +cosine: R.Real, scale: R.Real, tolerance: Tolerance) -> IntersectionResult:
  n = G.normalize(normal)
  +a = G.normalize(axis)
  center = G.add(co, G.scale(a, R.div(signed_distance(G.sub(po, co), normal), cosine)))
  section_choice(circle, center, n, a, radius, cosine, scale, tolerance)

def section_oblique(near_parallel: Bool, po: G.Vec3, +normal: G.Vec3, co: G.Vec3, +axis: G.Vec3, radius: R.Real, cosine: R.Real, +scale: R.Real, tolerance: Tolerance) -> IntersectionResult:
  match near_parallel:
    case True{}:
      unresolved(NearAxisParallelPlane{}, guard(scale))
    case False{}:
      circle = parallel_certificate(zero_vec(G.cross(normal, axis)), normal, axis)
      section_transverse(circle, po, normal, co, axis, radius, cosine, scale, tolerance)

def plane_cylinder_classify(parallel: Bool, po: G.Vec3, +normal: G.Vec3, co: G.Vec3, +axis: G.Vec3, radius: R.Real, scale: R.Real, +tolerance: Tolerance) -> IntersectionResult:
  match parallel:
    case True{}:
      generators(po, normal, co, axis, radius, scale, tolerance)
    case False{}:
      +cosine = R.div(G.dot(normal, axis), R.mul(length(normal), length(axis)))
      angular = tolerance_angular(tolerance)
      section_oblique(at_most(R.abs(cosine), R.add(angular, angular_guard())), po, normal, co, axis, radius, cosine, scale, tolerance)

def plane_cylinder_size(ok: Bool, po: G.Vec3, +normal: G.Vec3, co: G.Vec3, +axis: G.Vec3, radius: R.Real, +scale: R.Real, tolerance: Tolerance) -> IntersectionResult:
  match ok:
    case False{}:
      unresolved(RadiusBelowTolerance{}, guard(scale))
    case True{}:
      parallel = perpendicular_certificate(R.equal(G.dot(normal, axis), R.from_f32(0.0)), normal, axis)
      plane_cylinder_classify(parallel, po, normal, co, axis, radius, scale, tolerance)

def plane_cylinder_budget(ok: Bool, po: G.Vec3, normal: G.Vec3, co: G.Vec3, axis: G.Vec3, +radius: R.Real, +scale: R.Real, +tolerance: Tolerance) -> IntersectionResult:
  match ok:
    case False{}:
      unresolved(LinearBudget{}, guard(scale))
    case True{}:
      linear = tolerance_linear(tolerance)
      plane_cylinder_size(R.less(linear, radius), po, normal, co, axis, radius, scale, tolerance)

def plane_cylinder_radius(ok: Bool, +po: G.Vec3, normal: G.Vec3, +co: G.Vec3, axis: G.Vec3, +radius: R.Real, +tolerance: Tolerance) -> IntersectionResult:
  match ok:
    case False{}:
      Rejected{InvalidRadius{}}
    case True{}:
      +scale = input_scale(po, co, radius)
      linear = tolerance_linear(tolerance)
      plane_cylinder_budget(at_most(guard(scale), linear), po, normal, co, axis, radius, scale, tolerance)

def plane_cylinder_directions(ok: Bool, po: G.Vec3, normal: G.Vec3, co: G.Vec3, axis: G.Vec3, +radius: R.Real, tolerance: Tolerance) -> IntersectionResult:
  match ok:
    case False{}:
      Rejected{InvalidDirection{}}
    case True{}:
      plane_cylinder_radius(R.less(R.from_f32(0.0), radius), po, normal, co, axis, radius, tolerance)

def plane_cylinder_input(ok: Bool, po: G.Vec3, +normal: G.Vec3, co: G.Vec3, +axis: G.Vec3, radius: R.Real, tolerance: Tolerance) -> IntersectionResult:
  match ok:
    case False{}:
      Rejected{InvalidGeometry{}}
    case True{}:
      plane_cylinder_directions(Bool.and(direction_valid(normal), direction_valid(axis)), po, normal, co, axis, radius, tolerance)

def plane_cylinder_geometry(+po: G.Vec3, +normal: G.Vec3, +co: G.Vec3, +axis: G.Vec3, +radius: R.Real, tolerance: Tolerance) -> IntersectionResult:
  plane_cylinder_input(Bool.and(Bool.and(vec_valid(po), vec_valid(normal)), Bool.and(Bool.and(vec_valid(co), vec_valid(axis)), scalar_valid(radius))), po, normal, co, axis, radius, tolerance)

def dispatch(a: A.Surface, +b: A.Surface, +tolerance: Tolerance) -> IntersectionResult:
  match a:
    case A.Plane{origin, normal, _}:
      match b:
        case A.Plane{other, direction, _}:
          plane_plane_geometry(origin, normal, other, direction, tolerance)
        case A.Cylinder{other, axis, _, radius}:
          plane_cylinder_geometry(origin, normal, other, axis, radius, tolerance)
        case _:
          Rejected{UnsupportedSurfacePair{}}
    case A.Cylinder{origin, axis, _, radius}:
      match b:
        case A.Plane{other, normal, _}:
          plane_cylinder_geometry(other, normal, origin, axis, radius, tolerance)
        case _:
          Rejected{UnsupportedSurfacePair{}}
    case _:
      Rejected{UnsupportedSurfacePair{}}

def angular_budget(ok: Bool, a: A.Surface, b: A.Surface, tolerance: Tolerance) -> IntersectionResult:
  match ok:
    case True{}:
      dispatch(a, b, tolerance)
    case False{}:
      unresolved(AngularBudget{}, R.from_f32(0.0))

def checked_tolerance(ok: Bool, a: A.Surface, b: A.Surface, +tolerance: Tolerance) -> IntersectionResult:
  match ok:
    case False{}:
      Rejected{InvalidTolerance{}}
    case True{}:
      angular = tolerance_angular(tolerance)
      angular_budget(at_most(angular_guard(), angular), a, b, tolerance)

def intersect(a: A.Surface, b: A.Surface, +tolerance: Tolerance) -> IntersectionResult:
  checked_tolerance(tolerance_valid(tolerance), a, b, tolerance)

# Safe primitive entrypoints share the public tolerance checks. Surface x axes
# do not affect their supporting sets and are intentionally not used.
def plane_plane(a0: G.Vec3, an: G.Vec3, b0: G.Vec3, bn: G.Vec3, tolerance: Tolerance) -> IntersectionResult:
  intersect(A.Plane{a0, an, G.v3(1.0, 0.0, 0.0)}, A.Plane{b0, bn, G.v3(1.0, 0.0, 0.0)}, tolerance)

def plane_cylinder(po: G.Vec3, normal: G.Vec3, co: G.Vec3, axis: G.Vec3, radius: R.Real, tolerance: Tolerance) -> IntersectionResult:
  intersect(A.Plane{po, normal, G.v3(1.0, 0.0, 0.0)}, A.Cylinder{co, axis, G.v3(1.0, 0.0, 0.0), radius}, tolerance)
