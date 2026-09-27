import Base
import ./real.bend as R
import ./precise.bend as G
import ./analytic.bend as A
import ./intersections.bend as I
import ./curve-plane.bend as C
import ./face-classification.bend as F
import ./cylinder-classification.bend as K
import ./step-pcurves.bend as P
import ./ports/truck-cylinder.bend as B

# Export-only geometry. STEP normalizes DIRECTION/AXIS2_PLACEMENT_3D; these
# effective frames are checked against the untouched input, never written back.
type Reason is Data:
  InvalidInput{}
  InvalidSource{}
  UnsupportedSurface{}
  UnsupportedLoops{}
  UnsupportedDomain{}
  IncidenceFailure{}
  ParameterMismatch{}
  ResolutionLimit{}
  SegmentLimit{}
  ChartClosure{}
  AmbiguousLift{}
  UnsupportedSeam{}
  AssociationLimit{}

type Trace is Data:
  Round{trace: P.Trace, last: R.Real}
  Generator{first: R.Real, last: R.Real, angle: R.Real, z0: R.Real, slope: R.Real}

type Preparation is Data:
  Ready{trace: Trace, support: R.Real, normalization: R.Real, guard: R.Real}
  Rejected{reason: Reason}

type Spline is Data:
  Spline{first: R.Real, last: R.Real, degree: U32,
    points: List<&2, P.UV>, knots: List<&2, R.Real>, multiplicities: List<&2, U32>,
    approximation_bound: R.Real, support_bound: R.Real, normalization_bound: R.Real,
    numeric_guard: R.Real, total_bound: R.Real}

type Construction is Data:
  Built{curve: Spline}
  Failed{reason: Reason}

def total(curve: Spline) -> R.Real:
  Spline{_, _, _, _, _, _, _, _, _, _, bound} = curve
  bound

def zero() -> R.Real:
  P.zero()

def first(trace: Trace) -> R.Real:
  match trace:
    case Round{P.Trace{value, _, _, _, _, _}, _}:
      value
    case Generator{value, _, _, _, _}:
      value

def last(trace: Trace) -> R.Real:
  match trace:
    case Round{_, value}:
      value
    case Generator{_, value, _, _, _}:
      value

def value(trace: Trace, +t: R.Real) -> P.UV:
  match trace:
    case Round{round, _}:
      P.value(round, t)
    case Generator{_, _, angle, z0, slope}:
      P.UV{angle, R.add(z0, R.mul(slope, t))}

def shift(trace: Trace, +turns: R.Real) -> Trace:
  match trace:
    case Round{P.Trace{a, u, sign, z0, zc, zs}, b}:
      Round{P.Trace{a, R.add(u, R.mul(turns, P.tau())), sign, z0, zc, zs}, b}
    case Generator{a, b, u, z0, slope}:
      Generator{a, b, R.add(u, R.mul(turns, P.tau())), z0, slope}

def endpoint(+trace: Trace, increasing: Bool, +start: Bool) -> P.UV:
  parameter = Bool.pick(R.Real, Bool.pick(Bool, increasing, start, Bool.not(start)), first(trace), last(trace))
  value(trace, parameter)

def distance(a: P.UV, b: P.UV, radius: R.Real) -> R.Real:
  P.UV{au, av} = a
  P.UV{bu, bv} = b
  +du = R.mul(R.sub(au, bu), radius)
  +dv = R.sub(av, bv)
  R.sqrt(R.add(R.mul(du, du), R.mul(dv, dv)))

def step_x(+axis: G.Vec3, x: G.Vec3) -> G.Vec3:
  G.normalize(K.radial(x, axis))

def effective(curve: A.Curve) -> A.Curve:
  match curve:
    case A.Line{origin, direction}:
      A.Line{origin, G.normalize(direction)}
    case A.Circle{origin, normal, x, radius}:
      +axis = G.normalize(normal)
      A.Circle{origin, axis, step_x(axis, x), radius}
    case A.Ellipse{origin, normal, x, major, minor}:
      +axis = G.normalize(normal)
      A.Ellipse{origin, axis, step_x(axis, x), major, minor}

def frame_error(+axis: G.Vec3, +x: G.Vec3, +normal: G.Vec3, +ex: G.Vec3, radius: R.Real, height: R.Real) -> R.Real:
  radial = R.mul(radius, R.add(I.length(G.sub(x, ex)), I.length(G.sub(G.cross(axis, x), G.cross(normal, ex)))))
  R.add(radial, R.mul(height, I.length(G.sub(axis, normal))))

def curve_normalization(original: A.Curve, emitted: A.Curve, +a: R.Real, +b: R.Real) -> R.Real:
  match original emitted:
    case A.Line{_, d} A.Line{_, e}:
      R.mul(R.max(R.abs(a), R.abs(b)), I.length(G.sub(d, e)))
    case A.Circle{_, n, x, +r} A.Circle{_, en, ex, _}:
      frame_error(n, x, en, ex, r, zero())
    case A.Ellipse{_, +n, +x, major, minor} A.Ellipse{_, +en, +ex, _, _}:
      R.add(R.mul(major, I.length(G.sub(x, ex))), R.mul(minor, I.length(G.sub(G.cross(n, x), G.cross(en, ex)))))
    case _ _:
      I.limit()

def maximum_height(trace: Trace) -> R.Real:
  match trace:
    case Round{P.Trace{_, _, _, z0, +zc, +zs}, _}:
      R.add(R.abs(z0), R.sqrt(R.add(R.mul(zc, zc), R.mul(zs, zs))))
    case Generator{a, b, _, +z0, +slope}:
      R.max(R.abs(R.add(z0, R.mul(slope, a))), R.abs(R.add(z0, R.mul(slope, b))))

def checked_trace(+trace: Trace, +support: R.Real, +normalization: R.Real, +guard: R.Real, +budget: R.Real) -> Preparation:
  Bool.pick(Preparation, R.less(normalization, budget),
    Bool.pick(Preparation, R.less(R.add(support, R.add(normalization, guard)), budget),
      Ready{trace, support, normalization, guard}, Rejected{IncidenceFailure{}}), Rejected{ParameterMismatch{}})

def finish_trace(+trace: Trace, +original: A.Curve, +emitted: A.Curve, +domain: C.Domain,
  start: G.Vec3, end: G.Vec3, sense: Bool,
  axis: G.Vec3, x: G.Vec3, normal: G.Vec3, ex: G.Vec3, radius: R.Real,
  support: R.Real, guard: R.Real, +budget: R.Real) -> Preparation:
  endpoint_error = F.endpoint_error(domain, emitted, start, end, sense)
  normalization = R.add(curve_normalization(original, emitted, first(trace), last(trace)),
    frame_error(axis, x, normal, ex, radius, R.add(maximum_height(trace), budget)))
  checked_trace(trace, R.add(support, endpoint_error), normalization, guard, budget)

def round_trace(+center: G.Vec3, +u: G.Vec3, +v: G.Vec3, +a: R.Real, b: R.Real,
  origin: G.Vec3, +axis: G.Vec3, +x: G.Vec3, +radius: R.Real) -> Trace:
  +ru = K.radial(u, axis)
  rv = K.radial(v, axis)
  +sigma = Bool.pick(R.Real, R.less(zero(), G.dot(axis, G.cross(ru, rv))), P.one(), R.neg(P.one()))
  phase = R.atan2(G.dot(ru, G.cross(axis, x)), G.dot(ru, x))
  Round{P.Trace{a, R.add(phase, R.mul(sigma, a)), sigma, G.dot(G.sub(center, origin), axis), G.dot(u, axis), G.dot(v, axis)}, b}

def round_support(trace: Trace, center: G.Vec3, u: G.Vec3, v: G.Vec3,
  origin: G.Vec3, +axis: G.Vec3, +x: G.Vec3, +radius: R.Real) -> R.Real:
  match trace:
    case Round{P.Trace{a, ua, +sigma, _, _, _}, _}:
      +phase = R.sub(ua, R.mul(sigma, a))
      +y = G.cross(axis, x)
      ideal_u = G.scale(G.add(G.scale(x, R.cos(phase)), G.scale(y, R.sin(phase))), radius)
      ideal_v = G.scale(G.add(G.scale(x, R.neg(R.sin(phase))), G.scale(y, R.cos(phase))), R.mul(radius, sigma))
      R.add(I.length(K.radial(G.sub(center, origin), axis)),
        R.add(I.length(G.sub(K.radial(u, axis), ideal_u)), I.length(G.sub(K.radial(v, axis), ideal_v))))
    case _:
      I.limit()

def build_round(+center: G.Vec3, +u: G.Vec3, +v: G.Vec3, a: R.Real, b: R.Real,
  +original: A.Curve, +emitted: A.Curve, domain: C.Domain, start: G.Vec3, end: G.Vec3, sense: Bool,
  +origin: G.Vec3, axis: G.Vec3, x: G.Vec3, +normal: G.Vec3, +ex: G.Vec3, +radius: R.Real,
  guard: R.Real, budget: R.Real) -> Preparation:
  +trace = round_trace(center, u, v, a, b, origin, normal, ex, radius)
  support = round_support(trace, center, u, v, origin, normal, ex, radius)
  finish_trace(trace, original, emitted, domain, start, end, sense, axis, x, normal, ex, radius, support, guard, budget)

def build_line(+center: G.Vec3, +direction: G.Vec3, +a: R.Real, +b: R.Real,
  original: A.Curve, +emitted: A.Curve, domain: C.Domain, start: G.Vec3, end: G.Vec3, sense: Bool,
  +origin: G.Vec3, axis: G.Vec3, x: G.Vec3, +normal: G.Vec3, +ex: G.Vec3, +radius: R.Real,
  guard: R.Real, budget: R.Real) -> Preparation:
  +pa = K.radial(G.sub(A.curve_point(emitted, a), origin), normal)
  pb = K.radial(G.sub(A.curve_point(emitted, b), origin), normal)
  +angle = R.atan2(G.dot(pa, G.cross(normal, ex)), G.dot(pa, ex))
  +ideal = G.scale(G.add(G.scale(ex, R.cos(angle)), G.scale(G.cross(normal, ex), R.sin(angle))), radius)
  support = R.max(I.length(G.sub(pa, ideal)), I.length(G.sub(pb, ideal)))
  trace = {Generator{a, b, angle, G.dot(G.sub(center, origin), normal), G.dot(direction, normal)} : Trace}
  finish_trace(trace, original, emitted, domain, start, end, sense, axis, x, normal, ex, radius, support, guard, budget)

def build_curve_frame(+emitted: A.Curve, original: A.Curve, domain: C.Domain, start: G.Vec3, end: G.Vec3,
  sense: Bool, a: R.Real, b: R.Real, origin: G.Vec3, axis: G.Vec3, x: G.Vec3, normal: G.Vec3, ex: G.Vec3, radius: R.Real,
  guard: R.Real, budget: R.Real) -> Preparation:
  match emitted:
    case A.Line{center, direction}:
      build_line(center, direction, a, b, original, emitted, domain, start, end, sense, origin, axis, x, normal, ex, radius, guard, budget)
    case A.Circle{center, n, +cx, +r}:
      build_round(center, G.scale(cx, r), G.scale(G.cross(n, cx), r), a, b, original, emitted, domain, start, end, sense, origin, axis, x, normal, ex, radius, guard, budget)
    case A.Ellipse{center, n, +cx, major, minor}:
      build_round(center, G.scale(cx, major), G.scale(G.cross(n, cx), minor), a, b, original, emitted, domain, start, end, sense, origin, axis, x, normal, ex, radius, guard, budget)

def build_curve(emitted: A.Curve, original: A.Curve, domain: C.Domain, start: G.Vec3, end: G.Vec3,
  sense: Bool, a: R.Real, b: R.Real, origin: G.Vec3, +axis: G.Vec3, +x: G.Vec3, radius: R.Real,
  guard: R.Real, budget: R.Real) -> Preparation:
  +normal = G.normalize(axis)
  build_curve_frame(emitted, original, domain, start, end, sense, a, b, origin, axis, x, normal, step_x(normal, x), radius, guard, budget)

def checked_domain(valid: Bool, +emitted: A.Curve, original: A.Curve, domain: C.Domain,
  +start: G.Vec3, end: G.Vec3, sense: Bool, a: R.Real, b: R.Real,
  origin: G.Vec3, axis: G.Vec3, x: G.Vec3, radius: R.Real, guard: R.Real, budget: R.Real) -> Preparation:
  match valid:
    case False{}:
      Rejected{UnsupportedDomain{}}
    case True{}:
      build_curve(emitted, original, domain, start, end, sense, a, b, origin, axis, x, radius, guard, budget)

def prepare_domain(+domain: C.Domain, ei: U32, ej: U32, +emitted: A.Curve, +curve: A.Curve,
  +start: G.Vec3, end: G.Vec3, sense: Bool, origin: G.Vec3, axis: G.Vec3, x: G.Vec3,
  radius: R.Real, guard: R.Real, budget: R.Real) -> Preparation:
  match domain:
    case C.Interval{+a, +b}:
      checked_domain(C.domain_valid(domain, C.curve_periodic(curve)), emitted, curve, domain, start, end, sense, a, b, origin, axis, x, radius, guard, budget)
    case C.Untrimmed{}:
      +a = C.canonical(A.curve_parameter(emitted, start))
      checked_domain(Bool.and(C.curve_periodic(curve), U32.is_eq(ei, ej)), emitted, curve, domain, start, end, sense, a, R.add(a, P.tau()), origin, axis, x, radius, guard, budget)

def prepare(edge: F.PreparedEdge, surface: A.Surface, +budget: R.Real) -> Preparation:
  F.PreparedEdge{_, A.Edge{ei, ej, +curve, sense}, +domain, +start, +end, _} = edge
  match surface:
    case A.Cylinder{+origin, +axis, +x, +radius}:
      +emitted = effective(curve)
      +scale = R.max(P.one(), R.max(B.curve_scale(curve), R.max(R.add(I.magnitude(origin), R.abs(radius)), R.max(I.magnitude(start), I.magnitude(end)))))
      +guard = R.mul(R.mul(I.angular_guard(), R.from_f32(8.0)), scale)
      Bool.pick(Preparation, I.at_most(guard, budget),
        prepare_domain(domain, ei, ej, emitted, curve, start, end, sense, origin, axis, x, radius, guard, budget), Rejected{ResolutionLimit{}})
    case _:
      Rejected{UnsupportedSurface{}}

# End knots and poles use the admitted endpoints directly. Explicit interval
# values are not independently canonicalized or recomputed from the vertices.
def knot_values(left: Nat, +index: U32, +a: R.Real, +b: R.Real, +step: R.Real) -> List<&2, R.Real>:
  match left:
    case 0n:
      [b]
    case 1n+rest:
      P.parameter(a, step, index) <> knot_values(rest, (index + 1 : U32), a, b, step)

def control_values(left: Nat, +index: U32, +count: U32, +a: R.Real, +b: R.Real, +step: R.Real, +trace: P.Trace) -> List<&2, P.UV>:
  match left:
    case 0n:
      [P.value(trace, b)]
    case 1n+rest:
      +ta = P.parameter(a, step, index)
      +tb = Bool.pick(R.Real, U32.is_eq((index + 1 : U32), count), b, P.parameter(a, step, (index + 1 : U32)))
      +third = R.div(R.sub(tb, ta), R.from_f32(3.0))
      P.value(trace, ta) <>
        P.shifted(P.value(trace, ta), P.derivative(trace, ta), third) <>
        P.shifted(P.value(trace, tb), P.derivative(trace, tb), R.neg(third)) <>
        control_values(rest, (index + 1 : U32), count, a, b, step, trace)

def round_spline(resolution: P.Resolution, +trace: P.Trace, +b: R.Real,
  +support: R.Real, +normalization: R.Real, +guard: R.Real) -> Construction:
  match resolution:
    case P.TooFine{}:
      Failed{SegmentLimit{}}
    case P.Chosen{+count, +step, +bound}:
      P.Trace{+a, _, _, _, _, _} = trace
      Built{Spline{a, b, 3, control_values(U32.to_nat(count), 0, count, a, b, step, trace),
        knot_values(U32.to_nat(count), 0, a, b, step), 4 <> P.tail_multiplicities(U32.to_nat((count - 1 : U32))),
        bound, support, normalization, guard, R.add(bound, R.add(support, R.add(normalization, guard)))}}

def construct_checked(valid: Bool, +trace: Trace, +support: R.Real, +normalization: R.Real, +guard: R.Real, +budget: R.Real) -> Construction:
  match valid:
    case False{}:
      Failed{IncidenceFailure{}}
    case True{}:
      match trace:
        case Round{+round, +b}:
          P.Trace{a, _, _, _, +zc, +zs} = round
          +step = R.sub(b, a)
          +square = R.mul(step, step)
          amplitude = R.sqrt(R.add(R.mul(zc, zc), R.mul(zs, zs)))
          bound = R.div(R.mul(amplitude, R.mul(square, square)), R.from_f32(384.0))
          round_spline(P.choose(10n, 1, step, bound, R.sub(budget, R.add(support, R.add(normalization, guard)))), round, b, support, normalization, guard)
        case Generator{+a, +b, _, _, _}:
          Built{Spline{a, b, 1, [value(trace, a), value(trace, b)], [a, b], [2, 2],
            zero(), support, normalization, guard, R.add(support, R.add(normalization, guard))}}

def construct(trace: Trace, +support: R.Real, +normalization: R.Real, +guard: R.Real, +budget: R.Real) -> Construction:
  construct_checked(R.less(R.add(support, R.add(normalization, guard)), budget), trace, support, normalization, guard, budget)
