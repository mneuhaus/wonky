import Base
import ./real.bend as R
import ./precise.bend as G
import ./analytic.bend as A
import ./intersections.bend as I

# Infinite oriented line / supporting-surface intersections. Parameters are
# signed distances along the normalized direction. No face trims or forward-ray
# selection are performed. Kinds: 0 miss, 1 transverse roots, 2 certified double
# root (unsafe for parity), 3 coincident line, 4 unresolved, 5 invalid, 6 range.
type Roots is Data:
  Roots{kind: U32, values: List<&2, R.Real>}

def none(kind: U32) -> Roots:
  Roots{kind, Nil{}}

def zero() -> R.Real:
  R.from_f32(0.0)

def scalar_valid(+value: R.Real, limit: R.Real) -> Bool:
  R.Real{hi, lo} = value
  Bool.and(R.equal(value, R.renorm(hi, lo)), I.at_most(R.abs(value), limit))

def small(+value: R.Real, scale: R.Real) -> Bool:
  I.at_most(R.abs(value), R.mul(R.max(R.from_f32(1.0), R.abs(scale)), I.angular_guard()))

def linear_constant(+c: R.Real) -> Roots:
  Bool.pick(Roots, R.equal(c, zero()), none(3), Bool.pick(Roots, small(c, R.from_f32(1.0)), none(4), none(0)))

def linear_nonzero_pick(near: Bool, b: R.Real, c: R.Real) -> Roots:
  match near:
    case True{}:
      none(4)
    case False{}:
      Roots{1, [R.div(R.neg(c), b)]}

def linear_nonzero(+b: R.Real, c: R.Real) -> Roots:
  linear_nonzero_pick(small(b, R.from_f32(1.0)), b, c)

def linear_pick(z: Bool, b: R.Real, c: R.Real) -> Roots:
  match z:
    case True{}:
      linear_constant(c)
    case False{}:
      linear_nonzero(b, c)

def linear_unchecked(+b: R.Real, c: R.Real) -> Roots:
  linear_pick(R.equal(b, zero()), b, c)

def ordered(+a: R.Real, +b: R.Real) -> Roots:
  Roots{1, [R.min(a, b), R.max(a, b)]}

# q chooses the same sign as b, avoiding cancellation in the first root. The
# second root uses the product c/a. This branch has a resolved positive D.
def stable_roots(+a: R.Real, +b: R.Real, c: R.Real, disc: R.Real) -> Roots:
  +root = R.sqrt(disc)
  +q = R.mul(R.from_f32(F32.neg(0.5)), R.add(b, Bool.pick(R.Real, R.less(b, zero()), R.neg(root), root)))
  ordered(R.div(q, a), R.div(c, q))

def discriminant_pick(near: Bool, negative: Bool, computed_zero: Bool, certified: Bool, a: R.Real, b: R.Real, c: R.Real, disc: R.Real) -> Roots:
  match near negative computed_zero certified:
    case _ _ True{} True{}:
      Roots{2, [R.div(R.neg(b), R.mul(R.from_f32(2.0), a))]}
    case _ _ True{} False{}:
      none(4)
    case True{} _ False{} _:
      none(4)
    case False{} True{} False{} _:
      none(0)
    case False{} False{} False{} _:
      stable_roots(a, b, c, disc)

def quadratic_nonzero(+a: R.Real, +b: R.Real, +c: R.Real, certified: Bool) -> Roots:
  +bb = R.mul(b, b)
  +ac = R.mul(R.from_f32(4.0), R.mul(a, c))
  +disc = R.sub(bb, ac)
  discriminant_pick(small(disc, R.add(R.abs(bb), R.abs(ac))), R.less(disc, zero()), R.equal(disc, zero()), certified, a, b, c, disc)

def quadratic_pick(z: Bool, tiny: Bool, a: R.Real, b: R.Real, c: R.Real, certified: Bool) -> Roots:
  match z tiny:
    case True{} _:
      linear_unchecked(b, c)
    case False{} True{}:
      none(4)
    case False{} False{}:
      quadratic_nonzero(a, b, c, certified)

def quadratic_unchecked(+a: R.Real, b: R.Real, c: R.Real, certified: Bool) -> Roots:
  quadratic_pick(R.equal(a, zero()), small(a, R.from_f32(1.0)), a, b, c, certified)

type ExactPolynomial is Data:
  ExactPolynomial{a: I.Expansion, b: I.Expansion, c: I.Expansion}

def exact_discriminant(polynomial: ExactPolynomial) -> I.Expansion:
  ExactPolynomial{a, +b, c} = polynomial
  I.expansion_add(I.expansion_mul(b, b), I.expansion_neg(I.expansion_mul(I.expansion_real(R.from_f32(4.0)), I.expansion_mul(a, c))))

def roots_bounded(values: List<&2, R.Real>, +limit: R.Real) -> Bool:
  match values:
    case Nil{}:
      True{}
    case t <> tail:
      Bool.and(scalar_valid(t, limit), roots_bounded(tail, limit))

def range_check(result: Roots, limit: R.Real) -> Roots:
  Roots{kind, +values} = result
  Bool.pick(Roots, roots_bounded(values, limit), Roots{kind, values}, none(6))

# Generic polynomial API: its coefficients are the exact represented input
# words. This certificate says nothing about geometry that produced them.
def quadratic_input(valid: Bool, +a: R.Real, +b: R.Real, +c: R.Real) -> Roots:
  match valid:
    case False{}:
      none(5)
    case True{}:
      exact = {ExactPolynomial{I.expansion_real(a), I.expansion_real(b), I.expansion_real(c)} : ExactPolynomial}
      range_check(quadratic_unchecked(a, b, c, I.expansion_zero(exact_discriminant(exact))), R.from_f32(100000000000000000000.0))

def coefficient_valid(value: R.Real) -> Bool:
  scalar_valid(value, R.Real{100000000000000.0, F32.neg(376832.0)})

def quadratic(+a: R.Real, +b: R.Real, +c: R.Real) -> Roots:
  quadratic_input(Bool.and(coefficient_valid(a), Bool.and(coefficient_valid(b), coefficient_valid(c))), a, b, c)

def linear(b: R.Real, c: R.Real) -> Roots:
  quadratic(zero(), b, c)

def max_coord(v: G.Vec3) -> R.Real:
  I.magnitude(v)

def bounded(+v: G.Vec3) -> Bool:
  Bool.and(I.vec_valid(v), I.at_most(max_coord(v), R.from_f32(10000.0)))

def direction_valid(+v: G.Vec3) -> Bool:
  Bool.and(bounded(v), I.direction_valid(v))

def positive_radius(+r: R.Real) -> Bool:
  Bool.and(scalar_valid(r, R.from_f32(10000.0)), R.less(zero(), r))

def cone_angle_valid(+angle: R.Real) -> Bool:
  Bool.and(I.scalar_valid(angle), R.less(R.abs(angle), R.from_f32(1.4)))

def surface_valid(surface: A.Surface) -> Bool:
  match surface:
    case A.Plane{o, n, _}:
      Bool.and(bounded(o), direction_valid(n))
    case A.Cylinder{o, n, _, r}:
      Bool.and(Bool.and(bounded(o), direction_valid(n)), positive_radius(r))
    case A.Cone{o, n, _, r, angle}:
      Bool.and(Bool.and(bounded(o), direction_valid(n)), Bool.and(positive_radius(r), cone_angle_valid(angle)))
    case A.Sphere{o, n, _, r}:
      Bool.and(Bool.and(bounded(o), direction_valid(n)), positive_radius(r))
    case A.Torus{o, n, _, major, minor}:
      Bool.and(Bool.and(bounded(o), direction_valid(n)), Bool.and(positive_radius(major), positive_radius(minor)))

def coefficient_zero_ok(value: R.Real, certificate: Bool) -> Bool:
  Bool.or(Bool.not(R.equal(value, zero())), certificate)

type Certificates is Data:
  Certificates{a: Bool, b: Bool, c: Bool, discriminant: Bool}

def solve_certified_pick(ok: Bool, a: R.Real, b: R.Real, c: R.Real, certified_disc: Bool) -> Roots:
  match ok:
    case False{}:
      none(4)
    case True{}:
      quadratic_unchecked(a, b, c, certified_disc)

def solve_certified(+a: R.Real, +b: R.Real, +c: R.Real, certificates: Certificates) -> Roots:
  Certificates{cert_a, cert_b, cert_c, cert_disc} = certificates
  ok = Bool.and(coefficient_zero_ok(a, cert_a), Bool.and(coefficient_zero_ok(b, cert_b), coefficient_zero_ok(c, cert_c)))
  solve_certified_pick(ok, a, b, c, cert_disc)

def plane_intersection(+origin: G.Vec3, +direction: G.Vec3, +center: G.Vec3, +normal: G.Vec3) -> Roots:
  +normal_length = I.length(normal)
  +b = R.div(G.dot(normal, direction), R.mul(normal_length, I.length(direction)))
  +c = R.div(G.dot(normal, G.sub(origin, center)), normal_length)
  cert_b = I.perpendicular_certificate(R.equal(b, zero()), normal, direction)
  cert_c = I.coincidence_certificate(R.equal(c, zero()), normal, origin, center)
  solve_certified(zero(), b, c, Certificates{True{}, cert_b, cert_c, False{}})

# Keep original-coordinate differences as expansions. Certifying a rounded
# offset, projection, or normalized vector would certify the wrong polynomial.
type ExactVector is Data:
  ExactVector{x: I.Expansion, y: I.Expansion, z: I.Expansion}

def exact_vector(v: G.Vec3) -> ExactVector:
  G.V3{x, y, z} = v
  ExactVector{I.expansion_real(x), I.expansion_real(y), I.expansion_real(z)}

def exact_difference(a: R.Real, b: R.Real) -> I.Expansion:
  I.expansion_add(I.expansion_real(a), I.expansion_neg(I.expansion_real(b)))

def exact_offset(a: G.Vec3, b: G.Vec3) -> ExactVector:
  G.V3{ax, ay, az} = a
  G.V3{bx, by, bz} = b
  ExactVector{exact_difference(ax, bx), exact_difference(ay, by), exact_difference(az, bz)}

def exact_vector_dot(a: ExactVector, b: ExactVector) -> I.Expansion:
  ExactVector{ax, ay, az} = a
  ExactVector{bx, by, bz} = b
  I.expansion_add(I.expansion_mul(ax, bx), I.expansion_add(I.expansion_mul(ay, by), I.expansion_mul(az, bz)))

def exact_sub(a: I.Expansion, b: I.Expansion) -> I.Expansion:
  I.expansion_add(a, I.expansion_neg(b))

# Multiplying the unit-direction cylinder coefficients by positive powers of
# |axis| and |direction| removes their square roots without changing zeros:
# A = nn*dd - dn^2; B = 2*(nn*od - on*dn);
# C = nn*(oo-r^2) - on^2; D = B^2 - 4*A*C.
def cylinder_polynomial(origin: G.Vec3, +direction: G.Vec3, center: G.Vec3, +axis: G.Vec3, +radius: R.Real) -> ExactPolynomial:
  +offset = exact_offset(origin, center)
  +nn = I.exact_dot(axis, axis)
  dd = I.exact_dot(direction, direction)
  +dn = I.exact_dot(direction, axis)
  +on = exact_vector_dot(offset, exact_vector(axis))
  od = exact_vector_dot(offset, exact_vector(direction))
  oo = exact_vector_dot(offset, offset)
  a = exact_sub(I.expansion_mul(nn, dd), I.expansion_mul(dn, dn))
  b = I.expansion_mul(I.expansion_real(R.from_f32(2.0)), exact_sub(I.expansion_mul(nn, od), I.expansion_mul(on, dn)))
  c = exact_sub(I.expansion_mul(nn, exact_sub(oo, I.exact_product(radius, radius))), I.expansion_mul(on, on))
  ExactPolynomial{a, b, c}

def polynomial_b(polynomial: ExactPolynomial) -> I.Expansion:
  ExactPolynomial{_, b, _} = polynomial
  b

def polynomial_c(polynomial: ExactPolynomial) -> I.Expansion:
  ExactPolynomial{_, _, c} = polynomial
  c

def cylinder_certificates(+parallel: Bool, +polynomial: ExactPolynomial) -> Certificates:
  Certificates{parallel, Bool.or(parallel, I.expansion_zero(polynomial_b(polynomial))),
    I.expansion_zero(polynomial_c(polynomial)), I.expansion_zero(exact_discriminant(polynomial))}

# tan(angle) is computed in finite precision. For nonzero cone angles, an exact
# zero of that approximate polynomial is not an exact geometric certificate.
# Only the structural base-plane circle reductions below certify degeneracies.
def cone_certificates(+base_plane: Bool, +perpendicular: Bool, offset_perpendicular: Bool, +polynomial: ExactPolynomial) -> Certificates:
  Certificates{False{}, Bool.and(perpendicular, offset_perpendicular),
    Bool.and(base_plane, I.expansion_zero(polynomial_c(polynomial))),
    Bool.and(Bool.and(base_plane, perpendicular), I.expansion_zero(exact_discriminant(polynomial)))}

# Squared cone roots may lie on the other nappe. Reject that nappe only when
# signed radius is clearly negative. Any apex-near root makes the set unresolved.
def cone_filter_join(+radius: R.Real, guard: R.Real, t: R.Real, rest: Roots) -> Roots:
  Roots{+kind, +values} = rest
  ambiguous = Bool.or(U32.is_eq(kind, 4), I.at_most(R.abs(radius), guard))
  Bool.pick(Roots, ambiguous, none(4),
    Bool.pick(Roots, R.less(radius, zero()), Roots{kind, values}, Roots{1, t <> values}))

def cone_filter_values(values: List<&2, R.Real>, +radius: R.Real, +z: R.Real, +dz: R.Real, +slope: R.Real) -> Roots:
  match values:
    case Nil{}:
      none(0)
    case +t <> tail:
      +r = R.add(radius, R.mul(slope, R.add(z, R.mul(dz, t))))
      scale = R.add(R.abs(radius), R.mul(R.abs(slope), R.add(R.abs(z), R.abs(R.mul(dz, t)))))
      guard = R.max(R.from_f32(0.0000001), R.mul(I.angular_guard(), scale))
      cone_filter_join(r, guard, t, cone_filter_values(tail, radius, z, dz, slope))

def cone_filter_kind(old_kind: U32, filtered: Roots) -> Roots:
  Roots{+kind, values} = filtered
  Roots{Bool.pick(U32, U32.is_eq(kind, 1), old_kind, kind), values}

def cone_filter_pick(finite: Bool, +kind: U32, values: List<&2, R.Real>, radius: R.Real, z: R.Real, dz: R.Real, +slope: R.Real) -> Roots:
  match finite:
    case False{}:
      Bool.pick(Roots, Bool.and(U32.is_eq(kind, 3), Bool.not(R.equal(slope, zero()))), none(4), Roots{kind, values})
    case True{}:
      cone_filter_kind(kind, cone_filter_values(values, radius, z, dz, slope))

def cone_filter(roots: Roots, radius: R.Real, z: R.Real, dz: R.Real, slope: R.Real) -> Roots:
  Roots{+kind, values} = roots
  cone_filter_pick(Bool.or(U32.is_eq(kind, 1), U32.is_eq(kind, 2)), kind, values, radius, z, dz, slope)

def revolution(+origin: G.Vec3, direction: G.Vec3, center: G.Vec3, axis: G.Vec3, +radius: R.Real, +slope: R.Real, certificates: Certificates) -> Roots:
  +n = G.normalize(axis)
  +d = G.normalize(direction)
  +offset = G.sub(origin, center)
  +z = G.dot(offset, n)
  +dz = G.dot(d, n)
  +o = G.sub(offset, G.scale(n, z))
  +v = G.sub(d, G.scale(n, dz))
  +at_origin = R.add(radius, R.mul(slope, z))
  +dr = R.mul(slope, dz)
  a = R.sub(G.dot(v, v), R.mul(dr, dr))
  b = R.mul(R.from_f32(2.0), R.sub(G.dot(o, v), R.mul(at_origin, dr)))
  c = R.sub(G.dot(o, o), R.mul(at_origin, at_origin))
  cone_filter(solve_certified(a, b, c, certificates), radius, z, dz, slope)

def cylinder_intersection(+origin: G.Vec3, +direction: G.Vec3, +center: G.Vec3, +axis: G.Vec3, +radius: R.Real) -> Roots:
  parallel = I.parallel_certificate(I.zero_vec(G.cross(direction, axis)), direction, axis)
  certificates = cylinder_certificates(parallel, cylinder_polynomial(origin, direction, center, axis, radius))
  revolution(origin, direction, center, axis, radius, zero(), certificates)

def cone_nonzero(+origin: G.Vec3, +direction: G.Vec3, +center: G.Vec3, +axis: G.Vec3, +radius: R.Real, +angle: R.Real) -> Roots:
  polynomial = cylinder_polynomial(origin, direction, center, axis, radius)
  base_plane = I.coincidence_certificate(True{}, axis, origin, center)
  perpendicular = I.perpendicular_certificate(True{}, axis, direction)
  offset_perpendicular = I.coincidence_certificate(True{}, direction, origin, center)
  certificates = cone_certificates(base_plane, perpendicular, offset_perpendicular, polynomial)
  revolution(origin, direction, center, axis, radius, R.div(R.sin(angle), R.cos(angle)), certificates)

def cone_intersection(is_cylinder: Bool, origin: G.Vec3, direction: G.Vec3, center: G.Vec3, axis: G.Vec3, radius: R.Real, angle: R.Real) -> Roots:
  match is_cylinder:
    case True{}:
      cylinder_intersection(origin, direction, center, axis, radius)
    case False{}:
      cone_nonzero(origin, direction, center, axis, radius, angle)

def intersect_valid(origin: G.Vec3, direction: G.Vec3, surface: A.Surface) -> Roots:
  match surface:
    case A.Plane{o, n, _}:
      plane_intersection(origin, direction, o, n)
    case A.Cylinder{o, axis, _, radius}:
      cylinder_intersection(origin, direction, o, axis, radius)
    case A.Cone{o, axis, _, radius, +angle}:
      cone_intersection(R.equal(angle, zero()), origin, direction, o, axis, radius, angle)
    # Line/sphere and line/torus roots are not certified yet: report them as
    # unresolved (4) so every caller refuses instead of counting a parity.
    case A.Sphere{_, _, _, _}:
      none(4)
    case A.Torus{_, _, _, _, _}:
      none(4)

def input_pick(valid: Bool, origin: G.Vec3, direction: G.Vec3, surface: A.Surface) -> Roots:
  match valid:
    case True{}:
      intersect_valid(origin, direction, surface)
    case False{}:
      none(5)

def line_surface(+origin: G.Vec3, +direction: G.Vec3, +surface: A.Surface) -> Roots:
  range_check(input_pick(Bool.and(Bool.and(bounded(origin), direction_valid(direction)), surface_valid(surface)), origin, direction, surface), R.from_f32(100000.0))

def point(origin: G.Vec3, direction: G.Vec3, t: R.Real) -> G.Vec3:
  G.add(origin, G.scale(G.normalize(direction), t))
