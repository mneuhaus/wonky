import Base
import ./real.bend as R
import ./precise.bend as G
import ./analytic.bend as A
import ./intersections.bend as I

# Native curve parameters are preserved. This module intersects curves with
# supporting planes; it does not classify trimmed faces or construct solids.
type Domain is Data:
  Untrimmed{}
  Interval{first: R.Real, last: R.Real}

type ParameterLocation is Data:
  Inside{parameter: R.Real}
  Outside{}
  AtFirst{parameter: R.Real}
  AtLast{parameter: R.Real}
  NearFirst{parameter: R.Real}
  NearLast{parameter: R.Real}
  InvalidDomain{}

type Position is Data:
  Interior{}
  FirstEndpoint{}
  LastEndpoint{}

type Hit is Data:
  Hit{parameter: R.Real, point: G.Vec3, multiplicity: U32, position: Position}

type Relation is Data:
  Disjoint{}
  Crossing{}
  Tangent{}
  Coincident{}

type ResolutionIssue is Data:
  AngularBudget{}
  LinearBudget{}
  NearParallel{}
  NearCoincidence{}
  NearTangency{}
  TrimBoundary{}
  RadiusBelowTolerance{}

type Rejection is Data:
  InvalidTolerance{}
  InvalidGeometry{}
  InvalidDirection{}
  InvalidFrame{}
  InvalidRadius{}
  InvalidInterval{}
  OutputRange{}

type CurvePlaneResult is Data:
  Resolved{relation: Relation, hits: List<&2, Hit>, linear_resolution: R.Real, parameter_resolution: R.Real}
  Unresolved{reason: ResolutionIssue, linear_resolution: R.Real, parameter_resolution: R.Real}
  Rejected{reason: Rejection}

type Coefficients is Data:
  Coefficients{a: R.Real, b: R.Real, c: R.Real}

type ExactCoefficients is Data:
  ExactCoefficients{a: I.Expansion, b: I.Expansion, c: I.Expansion}

type Selected is Data:
  Selected{ambiguous: Bool, hits: List<&2, Hit>}

def zero() -> R.Real:
  R.from_f32(0.0)

def one() -> R.Real:
  R.from_f32(1.0)

def tau() -> R.Real:
  R.mul(R.pi(), R.from_f32(2.0))

def curve_periodic(curve: A.Curve) -> Bool:
  match curve:
    case A.Line{_, _}:
      False{}
    case _:
      True{}

def frame_valid(+normal: G.Vec3, +x: G.Vec3) -> Bool:
  +budget = R.mul(I.angular_guard(), R.from_f32(10.0))
  Bool.and(I.at_most(R.abs(R.sub(G.dot(normal, normal), one())), budget),
    Bool.and(I.at_most(R.abs(R.sub(G.dot(x, x), one())), budget), I.at_most(R.abs(G.dot(normal, x)), budget)))

def geometry_valid(curve: A.Curve) -> Bool:
  match curve:
    case A.Line{origin, direction}:
      Bool.and(I.vec_valid(origin), I.vec_valid(direction))
    case A.Circle{origin, normal, x, radius}:
      Bool.and(Bool.and(I.vec_valid(origin), I.vec_valid(normal)), Bool.and(I.vec_valid(x), I.scalar_valid(radius)))
    case A.Ellipse{origin, normal, x, major, minor}:
      Bool.and(Bool.and(I.vec_valid(origin), I.vec_valid(normal)), Bool.and(I.vec_valid(x), Bool.and(I.scalar_valid(major), I.scalar_valid(minor))))

def directions_valid(curve: A.Curve) -> Bool:
  match curve:
    case A.Line{_, direction}:
      I.direction_valid(direction)
    case A.Circle{_, normal, x, _}:
      Bool.and(I.direction_valid(normal), I.direction_valid(x))
    case A.Ellipse{_, normal, x, _, _}:
      Bool.and(I.direction_valid(normal), I.direction_valid(x))

def curve_frame_valid(curve: A.Curve) -> Bool:
  match curve:
    case A.Line{_, _}:
      True{}
    case A.Circle{_, normal, x, _}:
      frame_valid(normal, x)
    case A.Ellipse{_, normal, x, _, _}:
      frame_valid(normal, x)

def radius_valid(curve: A.Curve) -> Bool:
  match curve:
    case A.Line{_, _}:
      True{}
    case A.Circle{_, _, _, radius}:
      R.less(zero(), radius)
    case A.Ellipse{_, _, _, major, minor}:
      Bool.and(R.less(zero(), major), R.less(zero(), minor))

def curve_valid(+curve: A.Curve) -> Bool:
  Bool.and(Bool.and(geometry_valid(curve), directions_valid(curve)), Bool.and(curve_frame_valid(curve), radius_valid(curve)))

def min_radius(curve: A.Curve) -> R.Real:
  match curve:
    case A.Line{_, _}:
      I.limit()
    case A.Circle{_, _, _, radius}:
      radius
    case A.Ellipse{_, _, _, major, minor}:
      R.min(major, minor)

def max_radius(curve: A.Curve) -> R.Real:
  match curve:
    case A.Line{_, _}:
      zero()
    case A.Circle{_, _, _, radius}:
      radius
    case A.Ellipse{_, _, _, major, minor}:
      R.max(major, minor)

def curve_origin(curve: A.Curve) -> G.Vec3:
  match curve:
    case A.Line{origin, _}:
      origin
    case A.Circle{origin, _, _, _}:
      origin
    case A.Ellipse{origin, _, _, _, _}:
      origin

def interval_periodic_valid(periodic: Bool, +first: R.Real, +last: R.Real) -> Bool:
  match periodic:
    case False{}:
      True{}
    case True{}:
      +limit = R.mul(R.pi(), R.from_f32(8.0))
      Bool.and(R.less(R.sub(last, first), tau()), Bool.and(I.at_most(R.abs(first), limit), I.at_most(R.abs(last), limit)))

def domain_valid(domain: Domain, periodic: Bool) -> Bool:
  match domain:
    case Untrimmed{}:
      True{}
    case Interval{+first, +last}:
      Bool.and(Bool.and(I.scalar_valid(first), I.scalar_valid(last)), Bool.and(R.less(first, last), interval_periodic_valid(periodic, first, last)))

def parameter_valid(periodic: Bool, +parameter: R.Real) -> Bool:
  Bool.and(I.scalar_valid(parameter), Bool.or(Bool.not(periodic), I.at_most(R.abs(parameter), R.mul(R.pi(), R.from_f32(8.0)))))

def wrap_positive(+angle: R.Real) -> R.Real:
  +positive = Bool.pick(R.Real, R.less(angle, zero()), R.add(angle, tau()), angle)
  Bool.pick(R.Real, I.at_most(tau(), positive), R.sub(positive, tau()), positive)

def canonical(parameter: R.Real) -> R.Real:
  wrap_positive(R.reduce_angle(parameter))

# Correct the one-turn boundary after the F32-assisted integer reduction.
def centered(+angle: R.Real) -> R.Real:
  +low = Bool.pick(R.Real, R.less(angle, R.neg(R.pi())), R.add(angle, tau()), angle)
  Bool.pick(R.Real, R.less(R.pi(), low), R.sub(low, tau()), low)

def lift_parameter(periodic: Bool, parameter: R.Real, first: R.Real, last: R.Real) -> R.Real:
  match periodic:
    case False{}:
      parameter
    case True{}:
      +middle = R.mul(R.add(first, last), R.from_f32(0.5))
      R.add(middle, centered(R.reduce_angle(R.sub(parameter, middle))))

def location_clear(outside: Bool, parameter: R.Real) -> ParameterLocation:
  match outside:
    case True{}:
      Outside{}
    case False{}:
      Inside{parameter}

def location_near(near_first: Bool, near_last: Bool, +parameter: R.Real, first: R.Real, last: R.Real) -> ParameterLocation:
  match near_first near_last:
    case True{} _:
      NearFirst{parameter}
    case False{} True{}:
      NearLast{parameter}
    case False{} False{}:
      location_clear(Bool.or(R.less(parameter, first), R.less(last, parameter)), parameter)

def location_equal(at_first: Bool, at_last: Bool, +parameter: R.Real, +first: R.Real, +last: R.Real, +resolution: R.Real) -> ParameterLocation:
  match at_first at_last:
    case True{} _:
      AtFirst{parameter}
    case False{} True{}:
      AtLast{parameter}
    case False{} False{}:
      location_near(I.at_most(R.abs(R.sub(parameter, first)), resolution), I.at_most(R.abs(R.sub(parameter, last)), resolution), parameter, first, last)

def classify_valid(valid: Bool, +parameter: R.Real, domain: Domain, periodic: Bool, resolution: R.Real) -> ParameterLocation:
  match valid:
    case False{}:
      InvalidDomain{}
    case True{}:
      match domain:
        case Untrimmed{}:
          Inside{Bool.pick(R.Real, periodic, canonical(parameter), parameter)}
        case Interval{+first, +last}:
          +lifted = lift_parameter(periodic, parameter, first, last)
          location_equal(R.equal(lifted, first), R.equal(lifted, last), lifted, first, last, resolution)

def classify_parameter(+parameter: R.Real, +domain: Domain, +periodic: Bool, +resolution: R.Real) -> ParameterLocation:
  valid = Bool.and(domain_valid(domain, periodic), Bool.and(parameter_valid(periodic, parameter), Bool.and(I.scalar_valid(resolution), I.at_most(zero(), resolution))))
  classify_valid(valid, parameter, domain, periodic, resolution)

def coefficients_round(origin: G.Vec3, normal: G.Vec3, +x: G.Vec3, major: R.Real, minor: R.Real, plane_origin: G.Vec3, +unit_normal: G.Vec3) -> Coefficients:
  Coefficients{R.mul(major, G.dot(unit_normal, x)), R.mul(minor, G.dot(unit_normal, G.cross(normal, x))), G.dot(unit_normal, G.sub(origin, plane_origin))}

def coefficients_unit(curve: A.Curve, plane_origin: G.Vec3, +unit: G.Vec3) -> Coefficients:
  match curve:
    case A.Line{origin, direction}:
      Coefficients{zero(), G.dot(unit, direction), G.dot(unit, G.sub(origin, plane_origin))}
    case A.Circle{origin, normal, x, +radius}:
      coefficients_round(origin, normal, x, radius, radius, plane_origin, unit)
    case A.Ellipse{origin, normal, x, major, minor}:
      coefficients_round(origin, normal, x, major, minor, plane_origin, unit)

def coefficients(curve: A.Curve, plane_origin: G.Vec3, plane_normal: G.Vec3) -> Coefficients:
  coefficients_unit(curve, plane_origin, G.normalize(plane_normal))

def exact_sub(a: I.Expansion, b: I.Expansion) -> I.Expansion:
  I.expansion_add(a, I.expansion_neg(b))

def exact_cross_dot(normal: G.Vec3, a: G.Vec3, b: G.Vec3) -> I.Expansion:
  G.V3{nx, ny, nz} = normal
  G.V3{+ax, +ay, +az} = a
  G.V3{+bx, +by, +bz} = b
  x = I.expansion_mul(I.expansion_real(nx), exact_sub(I.exact_product(ay, bz), I.exact_product(az, by)))
  y = I.expansion_mul(I.expansion_real(ny), exact_sub(I.exact_product(az, bx), I.exact_product(ax, bz)))
  z = I.expansion_mul(I.expansion_real(nz), exact_sub(I.exact_product(ax, by), I.exact_product(ay, bx)))
  I.expansion_add(x, I.expansion_add(y, z))

def exact_round(origin: G.Vec3, normal: G.Vec3, +x: G.Vec3, major: R.Real, minor: R.Real, plane_origin: G.Vec3, +plane_normal: G.Vec3) -> ExactCoefficients:
  ExactCoefficients{I.expansion_mul(I.expansion_real(major), I.exact_dot(plane_normal, x)),
    I.expansion_mul(I.expansion_real(minor), exact_cross_dot(plane_normal, normal, x)), I.exact_dot_delta(plane_normal, origin, plane_origin)}

def exact_coefficients(curve: A.Curve, plane_origin: G.Vec3, +plane_normal: G.Vec3) -> ExactCoefficients:
  match curve:
    case A.Line{origin, direction}:
      ExactCoefficients{I.expansion_real(zero()), I.exact_dot(plane_normal, direction), I.exact_dot_delta(plane_normal, origin, plane_origin)}
    case A.Circle{origin, normal, x, +radius}:
      exact_round(origin, normal, x, radius, radius, plane_origin, plane_normal)
    case A.Ellipse{origin, normal, x, major, minor}:
      exact_round(origin, normal, x, major, minor, plane_origin, plane_normal)

def tangent_certificate(coefficients: ExactCoefficients) -> Bool:
  ExactCoefficients{+a, +b, +c} = coefficients
  I.expansion_zero(exact_sub(I.expansion_add(I.expansion_mul(a, a), I.expansion_mul(b, b)), I.expansion_mul(c, c)))

def parallel_certificate(coefficients: ExactCoefficients) -> Bool:
  ExactCoefficients{a, b, _} = coefficients
  Bool.and(I.expansion_zero(a), I.expansion_zero(b))

def coincident_certificate(coefficients: ExactCoefficients) -> Bool:
  ExactCoefficients{_, _, c} = coefficients
  I.expansion_zero(c)

def endpoint_certificate_round(at_zero: Bool, coefficients: ExactCoefficients) -> Bool:
  match at_zero:
    case False{}:
      False{}
    case True{}:
      ExactCoefficients{a, _, c} = coefficients
      I.expansion_zero(I.expansion_add(a, c))

def endpoint_certificate_line(values: ExactCoefficients, parameter: R.Real) -> Bool:
  ExactCoefficients{_, b, c} = values
  I.expansion_zero(I.expansion_add(c, I.expansion_mul(I.expansion_real(parameter), b)))

def endpoint_certificate(+curve: A.Curve, plane_origin: G.Vec3, plane_normal: G.Vec3, +parameter: R.Real) -> Bool:
  match curve:
    case A.Line{origin, direction}:
      endpoint_certificate_line(exact_coefficients(A.Line{origin, direction}, plane_origin, plane_normal), parameter)
    case _:
      endpoint_certificate_round(R.equal(parameter, zero()), exact_coefficients(curve, plane_origin, plane_normal))

def selected_point(curve: A.Curve, +parameter: R.Real, multiplicity: U32, position: Position) -> Selected:
  Selected{False{}, [Hit{parameter, A.curve_point(curve, parameter), multiplicity, position}]}

def selected_endpoint(certified: Bool, curve: A.Curve, parameter: R.Real, multiplicity: U32, position: Position) -> Selected:
  match certified:
    case False{}:
      Selected{True{}, Nil{}}
    case True{}:
      selected_point(curve, parameter, multiplicity, position)

def selected_bound(+first_end: Bool, +curve: A.Curve, plane_origin: G.Vec3, plane_normal: G.Vec3, domain: Domain, multiplicity: U32) -> Selected:
  match domain:
    case Untrimmed{}:
      Selected{True{}, Nil{}}
    case Interval{first, last}:
      +parameter = Bool.pick(R.Real, first_end, first, last)
      position = Bool.pick(Position, first_end, FirstEndpoint{}, LastEndpoint{})
      selected_endpoint(endpoint_certificate(curve, plane_origin, plane_normal, parameter), curve, parameter, multiplicity, position)

def select_location(location: ParameterLocation, curve: A.Curve, plane_origin: G.Vec3, plane_normal: G.Vec3, domain: Domain, multiplicity: U32) -> Selected:
  match location:
    case Inside{parameter}:
      selected_point(curve, parameter, multiplicity, Interior{})
    case Outside{}:
      Selected{False{}, Nil{}}
    case AtFirst{_}:
      selected_bound(True{}, curve, plane_origin, plane_normal, domain, multiplicity)
    case NearFirst{_}:
      selected_bound(True{}, curve, plane_origin, plane_normal, domain, multiplicity)
    case AtLast{_}:
      selected_bound(False{}, curve, plane_origin, plane_normal, domain, multiplicity)
    case NearLast{_}:
      selected_bound(False{}, curve, plane_origin, plane_normal, domain, multiplicity)
    case InvalidDomain{}:
      Selected{True{}, Nil{}}

def append_hits(a: List<&2, Hit>, b: List<&2, Hit>) -> List<&2, Hit>:
  match a:
    case Nil{}:
      b
    case head <> tail:
      head <> append_hits(tail, b)

def combine_selected(a: Selected, b: Selected) -> Selected:
  Selected{ambiguous_a, hits_a} = a
  Selected{ambiguous_b, hits_b} = b
  Selected{Bool.or(ambiguous_a, ambiguous_b), append_hits(hits_a, hits_b)}

def select_parameters(values: List<&2, R.Real>, +curve: A.Curve, +plane_origin: G.Vec3, +plane_normal: G.Vec3, +domain: Domain, +multiplicity: U32, +resolution: R.Real) -> Selected:
  match values:
    case Nil{}:
      Selected{False{}, Nil{}}
    case parameter <> tail:
      location = classify_parameter(parameter, domain, curve_periodic(curve), resolution)
      selected = select_location(location, curve, plane_origin, plane_normal, domain, multiplicity)
      combine_selected(selected, select_parameters(tail, curve, plane_origin, plane_normal, domain, multiplicity, resolution))

def hit_parameter(hit: Hit) -> R.Real:
  Hit{parameter, _, _, _} = hit
  parameter

def order_tail(+first: Hit, +tail: List<&2, Hit>) -> List<&2, Hit>:
  match tail:
    case second <> Nil{}:
      Bool.pick(List<&2, Hit>, R.less(hit_parameter(first), hit_parameter(second)), [first, second], [second, first])
    case _:
      first <> tail

def order_hits(hits: List<&2, Hit>) -> List<&2, Hit>:
  match hits:
    case Nil{}:
      Nil{}
    case first <> tail:
      order_tail(first, tail)

def hits_valid(hits: List<&2, Hit>) -> Bool:
  match hits:
    case Nil{}:
      True{}
    case Hit{parameter, point, _, _} <> tail:
      Bool.and(Bool.and(I.scalar_valid(parameter), I.vec_valid(point)), hits_valid(tail))

def resolved(relation: Relation, hits: List<&2, Hit>, linear: R.Real, parameter: R.Real) -> CurvePlaneResult:
  Resolved{relation, hits, linear, parameter}

def unresolved(reason: ResolutionIssue, linear: R.Real, parameter: R.Real) -> CurvePlaneResult:
  Unresolved{reason, linear, parameter}

def finish_selected(ambiguous: Bool, valid: Bool, relation: Relation, hits: List<&2, Hit>, linear: R.Real, parameter: R.Real) -> CurvePlaneResult:
  match ambiguous valid:
    case True{} _:
      unresolved(TrimBoundary{}, linear, parameter)
    case False{} False{}:
      Rejected{OutputRange{}}
    case False{} True{}:
      match hits:
        case Nil{}:
          resolved(Disjoint{}, Nil{}, linear, parameter)
        case head <> tail:
          resolved(relation, order_hits(head <> tail), linear, parameter)

def finish_selection(selected: Selected, relation: Relation, linear: R.Real, parameter: R.Real) -> CurvePlaneResult:
  Selected{ambiguous, +hits} = selected
  finish_selected(ambiguous, hits_valid(hits), relation, hits, linear, parameter)

def finish_budget(ok: Bool, values: List<&2, R.Real>, curve: A.Curve, plane_origin: G.Vec3, plane_normal: G.Vec3, domain: Domain, multiplicity: U32, relation: Relation, linear: R.Real, +parameter: R.Real) -> CurvePlaneResult:
  match ok:
    case False{}:
      unresolved(LinearBudget{}, linear, parameter)
    case True{}:
      finish_selection(select_parameters(values, curve, plane_origin, plane_normal, domain, multiplicity, parameter), relation, linear, parameter)

def parameters_valid(values: List<&2, R.Real>) -> Bool:
  match values:
    case Nil{}:
      True{}
    case head <> tail:
      Bool.and(I.scalar_valid(head), parameters_valid(tail))

def finish_range(valid: Bool, values: List<&2, R.Real>, curve: A.Curve, plane_origin: G.Vec3, plane_normal: G.Vec3, domain: Domain, multiplicity: U32, relation: Relation, +linear: R.Real, parameter: R.Real, tolerance: I.Tolerance) -> CurvePlaneResult:
  match valid:
    case False{}:
      Rejected{OutputRange{}}
    case True{}:
      finish_budget(I.at_most(linear, I.tolerance_linear(tolerance)), values, curve, plane_origin, plane_normal, domain, multiplicity, relation, linear, parameter)

def finish(+values: List<&2, R.Real>, curve: A.Curve, plane_origin: G.Vec3, plane_normal: G.Vec3, domain: Domain, multiplicity: U32, relation: Relation, linear: R.Real, parameter: R.Real, tolerance: I.Tolerance) -> CurvePlaneResult:
  finish_range(parameters_valid(values), values, curve, plane_origin, plane_normal, domain, multiplicity, relation, linear, parameter, tolerance)

def parallel_separation(coincident: Bool, clear: Bool, resolution: R.Real) -> CurvePlaneResult:
  match coincident clear:
    case True{} _:
      resolved(Coincident{}, Nil{}, resolution, zero())
    case False{} True{}:
      resolved(Disjoint{}, Nil{}, resolution, zero())
    case False{} False{}:
      unresolved(NearCoincidence{}, resolution, zero())

def parallel_curve(curve: A.Curve, plane_origin: G.Vec3, plane_normal: G.Vec3, c: R.Real, +resolution: R.Real, tolerance: I.Tolerance) -> CurvePlaneResult:
  coincident = coincident_certificate(exact_coefficients(curve, plane_origin, plane_normal))
  clear = R.less(R.add(I.tolerance_linear(tolerance), resolution), R.abs(c))
  parallel_separation(coincident, clear, resolution)

def line_root(+curve: A.Curve, plane_origin: G.Vec3, plane_normal: G.Vec3, +direction: G.Vec3, +b: R.Real, c: R.Real, +scale: R.Real, domain: Domain, tolerance: I.Tolerance) -> CurvePlaneResult:
  +parameter = R.div(R.neg(c), b)
  +guard = I.guard(R.max(scale, R.max(I.magnitude(A.curve_point(curve, parameter)), I.magnitude(G.scale(direction, parameter)))))
  +parameter_resolution = R.div(guard, R.abs(b))
  linear_resolution = R.add(guard, R.mul(I.length(direction), parameter_resolution))
  finish([parameter], curve, plane_origin, plane_normal, domain, 1, Crossing{}, linear_resolution, parameter_resolution, tolerance)

def line_nonparallel(near: Bool, curve: A.Curve, plane_origin: G.Vec3, plane_normal: G.Vec3, direction: G.Vec3, b: R.Real, c: R.Real, +scale: R.Real, domain: Domain, tolerance: I.Tolerance) -> CurvePlaneResult:
  match near:
    case True{}:
      unresolved(NearParallel{}, I.guard(scale), I.angular_guard())
    case False{}:
      line_root(curve, plane_origin, plane_normal, direction, b, c, scale, domain, tolerance)

def line_classify(parallel: Bool, curve: A.Curve, plane_origin: G.Vec3, plane_normal: G.Vec3, +direction: G.Vec3, +b: R.Real, c: R.Real, +scale: R.Real, domain: Domain, +tolerance: I.Tolerance) -> CurvePlaneResult:
  match parallel:
    case True{}:
      parallel_curve(curve, plane_origin, plane_normal, c, I.guard(scale), tolerance)
    case False{}:
      near = I.at_most(R.div(R.abs(b), I.length(direction)), R.add(I.tolerance_angular(tolerance), I.angular_guard()))
      line_nonparallel(near, curve, plane_origin, plane_normal, direction, b, c, scale, domain, tolerance)

def round_roots(+curve: A.Curve, plane_origin: G.Vec3, plane_normal: G.Vec3, +a: R.Real, +b: R.Real, +c: R.Real, +amplitude: R.Real, +scale: R.Real, domain: Domain, tolerance: I.Tolerance) -> CurvePlaneResult:
  +height = R.sqrt(R.mul(R.sub(amplitude, R.abs(c)), R.add(amplitude, R.abs(c))))
  +phase = R.atan2(b, a)
  +delta = R.atan2(height, R.neg(c))
  parameters : List<&2, R.Real> = [canonical(R.sub(phase, delta)), canonical(R.add(phase, delta))]
  +parameter_resolution = R.add(I.angular_guard(), R.div(I.guard(scale), height))
  linear_resolution = R.add(I.guard(scale), R.mul(max_radius(curve), parameter_resolution))
  finish(parameters, curve, plane_origin, plane_normal, domain, 1, Crossing{}, linear_resolution, parameter_resolution, tolerance)

def round_tangent(certified: Bool, +curve: A.Curve, plane_origin: G.Vec3, plane_normal: G.Vec3, a: R.Real, b: R.Real, c: R.Real, amplitude: R.Real, +scale: R.Real, domain: Domain, tolerance: I.Tolerance) -> CurvePlaneResult:
  match certified:
    case False{}:
      unresolved(NearTangency{}, I.guard(scale), I.angular_guard())
    case True{}:
      parameter = canonical(R.add(R.atan2(b, a), Bool.pick(R.Real, R.less(c, zero()), zero(), R.pi())))
      +parameter_resolution = R.add(I.angular_guard(), R.div(I.guard(scale), amplitude))
      linear_resolution = R.add(I.guard(scale), R.mul(max_radius(curve), parameter_resolution))
      finish([parameter], curve, plane_origin, plane_normal, domain, 2, Tangent{}, linear_resolution, parameter_resolution, tolerance)

def round_gap(near: Bool, outside: Bool, +curve: A.Curve, +plane_origin: G.Vec3, +plane_normal: G.Vec3, a: R.Real, b: R.Real, c: R.Real, amplitude: R.Real, +scale: R.Real, domain: Domain, tolerance: I.Tolerance) -> CurvePlaneResult:
  match near outside:
    case True{} _:
      certified = tangent_certificate(exact_coefficients(curve, plane_origin, plane_normal))
      round_tangent(certified, curve, plane_origin, plane_normal, a, b, c, amplitude, scale, domain, tolerance)
    case False{} True{}:
      resolved(Disjoint{}, Nil{}, I.guard(scale), I.angular_guard())
    case False{} False{}:
      round_roots(curve, plane_origin, plane_normal, a, b, c, amplitude, scale, domain, tolerance)

def round_nonparallel(near_parallel: Bool, curve: A.Curve, plane_origin: G.Vec3, plane_normal: G.Vec3, a: R.Real, b: R.Real, +c: R.Real, +amplitude: R.Real, +scale: R.Real, domain: Domain, +tolerance: I.Tolerance) -> CurvePlaneResult:
  match near_parallel:
    case True{}:
      unresolved(NearParallel{}, I.guard(scale), I.angular_guard())
    case False{}:
      +gap = R.sub(amplitude, R.abs(c))
      near = I.at_most(R.abs(gap), R.add(I.tolerance_linear(tolerance), I.guard(scale)))
      round_gap(near, R.less(gap, zero()), curve, plane_origin, plane_normal, a, b, c, amplitude, scale, domain, tolerance)

def round_classify(parallel: Bool, +curve: A.Curve, plane_origin: G.Vec3, plane_normal: G.Vec3, +a: R.Real, +b: R.Real, c: R.Real, +scale: R.Real, domain: Domain, +tolerance: I.Tolerance) -> CurvePlaneResult:
  match parallel:
    case True{}:
      parallel_curve(curve, plane_origin, plane_normal, c, I.guard(scale), tolerance)
    case False{}:
      +amplitude = R.sqrt(R.add(R.mul(a, a), R.mul(b, b)))
      near = I.at_most(R.div(amplitude, max_radius(curve)), R.add(I.tolerance_angular(tolerance), I.angular_guard()))
      round_nonparallel(near, curve, plane_origin, plane_normal, a, b, c, amplitude, scale, domain, tolerance)

def classify_coefficients(+curve: A.Curve, +plane_origin: G.Vec3, +plane_normal: G.Vec3, domain: Domain, tolerance: I.Tolerance, values: Coefficients, scale: R.Real) -> CurvePlaneResult:
  match curve:
    case A.Line{origin, +direction}:
      Coefficients{_, b, c} = values
      parallel = I.expansion_zero(I.exact_dot(plane_normal, direction))
      line_classify(parallel, A.Line{origin, direction}, plane_origin, plane_normal, direction, b, c, scale, domain, tolerance)
    case _:
      Coefficients{a, b, c} = values
      parallel = parallel_certificate(exact_coefficients(curve, plane_origin, plane_normal))
      round_classify(parallel, curve, plane_origin, plane_normal, a, b, c, scale, domain, tolerance)

def classify(+curve: A.Curve, +plane_origin: G.Vec3, +plane_normal: G.Vec3, domain: Domain, tolerance: I.Tolerance) -> CurvePlaneResult:
  classify_coefficients(curve, plane_origin, plane_normal, domain, tolerance, coefficients(curve, plane_origin, plane_normal), I.input_scale(curve_origin(curve), plane_origin, max_radius(curve)))

def input_budget(linear_ok: Bool, radius_ok: Bool, +curve: A.Curve, +plane_origin: G.Vec3, plane_normal: G.Vec3, domain: Domain, tolerance: I.Tolerance) -> CurvePlaneResult:
  match linear_ok radius_ok:
    case False{} _:
      unresolved(LinearBudget{}, I.guard(I.input_scale(curve_origin(curve), plane_origin, max_radius(curve))), I.angular_guard())
    case True{} False{}:
      unresolved(RadiusBelowTolerance{}, I.guard(I.input_scale(curve_origin(curve), plane_origin, max_radius(curve))), I.angular_guard())
    case True{} True{}:
      classify(curve, plane_origin, plane_normal, domain, tolerance)

def radius_resolved(curve: A.Curve, linear: R.Real) -> Bool:
  match curve:
    case A.Line{_, _}:
      True{}
    case A.Circle{_, _, _, radius}:
      R.less(linear, radius)
    case A.Ellipse{_, _, _, major, minor}:
      R.less(linear, R.min(major, minor))

def input_shape(direction_ok: Bool, frame_ok: Bool, radius_ok: Bool, domain_ok: Bool, +curve: A.Curve, +plane_origin: G.Vec3, plane_normal: G.Vec3, domain: Domain, +tolerance: I.Tolerance) -> CurvePlaneResult:
  match direction_ok frame_ok radius_ok domain_ok:
    case False{} _ _ _:
      Rejected{InvalidDirection{}}
    case True{} False{} _ _:
      Rejected{InvalidFrame{}}
    case True{} True{} False{} _:
      Rejected{InvalidRadius{}}
    case True{} True{} True{} False{}:
      Rejected{InvalidInterval{}}
    case True{} True{} True{} True{}:
      +linear = I.tolerance_linear(tolerance)
      linear_ok = I.at_most(I.guard(I.input_scale(curve_origin(curve), plane_origin, max_radius(curve))), linear)
      radius_ok = radius_resolved(curve, linear)
      input_budget(linear_ok, radius_ok, curve, plane_origin, plane_normal, domain, tolerance)

def input_geometry(ok: Bool, +curve: A.Curve, plane_origin: G.Vec3, +plane_normal: G.Vec3, +domain: Domain, tolerance: I.Tolerance) -> CurvePlaneResult:
  match ok:
    case False{}:
      Rejected{InvalidGeometry{}}
    case True{}:
      input_shape(Bool.and(directions_valid(curve), I.direction_valid(plane_normal)), curve_frame_valid(curve), radius_valid(curve), domain_valid(domain, curve_periodic(curve)), curve, plane_origin, plane_normal, domain, tolerance)

def checked_tolerance(valid: Bool, angular_ok: Bool, +curve: A.Curve, +plane_origin: G.Vec3, +plane_normal: G.Vec3, domain: Domain, tolerance: I.Tolerance) -> CurvePlaneResult:
  match valid angular_ok:
    case False{} _:
      Rejected{InvalidTolerance{}}
    case True{} False{}:
      unresolved(AngularBudget{}, zero(), I.angular_guard())
    case True{} True{}:
      input_geometry(Bool.and(geometry_valid(curve), Bool.and(I.vec_valid(plane_origin), I.vec_valid(plane_normal))), curve, plane_origin, plane_normal, domain, tolerance)

def intersect(curve: A.Curve, plane_origin: G.Vec3, plane_normal: G.Vec3, domain: Domain, +tolerance: I.Tolerance) -> CurvePlaneResult:
  checked_tolerance(I.tolerance_valid(tolerance), I.at_most(I.angular_guard(), I.tolerance_angular(tolerance)), curve, plane_origin, plane_normal, domain, tolerance)
