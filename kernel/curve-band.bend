import Base
import ./real.bend as R
import ./precise.bend as G
import ./analytic.bend as A
import ./intersections.bend as I
import ./curve-plane.bend as C
import ./face-classification.bend as F
import ./edge-plane.bend as E

# Whole-domain distance bounds only. No source projection, overlap event,
# topology association or implicit Boolean contact policy is introduced here.
type Source is Data:
  Source{curve: A.Curve, domain: C.Domain, plane_origin: G.Vec3, plane_normal: G.Vec3, source_allowance: R.Real, edge: Maybe<&2, E.EdgeSource>}

type Position is Data:
  FirstEndpoint{}
  LastEndpoint{}
  StationaryMinimum{}
  StationaryMaximum{}
  ConstantRepresentative{}

type Extremum is Data:
  Extremum{parameter: R.Real, point: G.Vec3, signed_distance: R.Real, position: Position}

type Certificate is Data:
  ExactZeroCoefficients{}
  NotCertified{}

type Evidence is Data:
  Evidence{source: Source, minimum: Extremum, maximum: Extremum, candidates: List<&2, Extremum>, max_absolute: R.Real, arithmetic_guard: R.Real, parameter_guard: R.Real, contact_tolerance: R.Real, certificate: Certificate}

type Relation is Data:
  ExactCurveInPlane{}
  ToleratedBand{}
  ExceedsBand{}

type Issue is Data:
  Threshold{evidence: Evidence}
  CoefficientConditioning{source: Source, arithmetic_guard: R.Real}
  EdgeUnresolved{reason: E.Issue}

type Rejection is Data:
  InvalidGeometry{}
  InvalidDomain{}
  InvalidContactTolerance{}
  InvalidSourceAllowance{}
  InvalidPreparationTolerance{}
  OutputRange{}
  EdgeRejected{reason: E.Rejection}

type BandResult is Data:
  Resolved{relation: Relation, evidence: Evidence}
  Unresolved{reason: Issue}
  Rejected{reason: Rejection}

type Candidates is Data:
  Candidates{values: List<&2, Extremum>, parameter_guard: R.Real, phase_distance_guard: R.Real}
  UnknownCandidates{}

def zero() -> R.Real:
  R.from_f32(0.0)

def source_curve(source: Source) -> A.Curve:
  Source{curve, _, _, _, _, _} = source
  curve

def source_domain(source: Source) -> C.Domain:
  Source{_, domain, _, _, _, _} = source
  domain

def source_coefficients(source: Source) -> C.Coefficients:
  Source{curve, _, origin, normal, _, _} = source
  C.coefficients(curve, origin, normal)

def source_exact(source: Source) -> C.ExactCoefficients:
  Source{curve, _, origin, normal, _, _} = source
  C.exact_coefficients(curve, origin, normal)

def source_certificate(source: Source) -> Certificate:
  +exact = source_exact(source)
  Bool.pick(Certificate, Bool.and(C.parallel_certificate(exact), C.coincident_certificate(exact)), ExactZeroCoefficients{}, NotCertified{})

def source_extra(source: Source) -> R.Real:
  Source{_, _, _, _, _, edge} = source
  match edge:
    case None{}:
      zero()
    case Some{source}:
      E.source_resolution(source)

def source_guard(+source: Source) -> R.Real:
  Source{+curve, domain, origin, _, _, _} = source
  +scale = R.max(I.input_scale(C.curve_origin(curve), origin, C.max_radius(curve)), E.domain_scale(curve, domain))
  R.add(R.mul(R.mul(I.angular_guard(), R.from_f32(4.0)), scale), source_extra(source))

def value(periodic: Bool, values: C.Coefficients, +parameter: R.Real) -> R.Real:
  match periodic:
    case False{}:
      C.Coefficients{_, b, c} = values
      R.add(R.mul(b, parameter), c)
    case True{}:
      C.Coefficients{a, b, c} = values
      R.add(R.add(R.mul(a, R.cos(parameter)), R.mul(b, R.sin(parameter))), c)

def witness(position: Position, +parameter: R.Real, curve: A.Curve, signed: R.Real) -> Extremum:
  Extremum{parameter, A.curve_point(curve, parameter), signed, position}

def endpoint(position: Position, +parameter: R.Real, +curve: A.Curve, values: C.Coefficients) -> Extremum:
  witness(position, parameter, curve, value(C.curve_periodic(curve), values, parameter))

def endpoint_candidates(domain: C.Domain, +curve: A.Curve, +values: C.Coefficients) -> List<&2, Extremum>:
  match domain:
    case C.Untrimmed{}:
      Nil{}
    case C.Interval{first, last}:
      [endpoint(FirstEndpoint{}, first, curve, values), endpoint(LastEndpoint{}, last, curve, values)]

def amplitude_nonzero(nonzero: Bool, +a: R.Real, +b: R.Real, +scale: R.Real) -> R.Real:
  match nonzero:
    case False{}:
      zero()
    case True{}:
      +x = R.div(a, scale)
      +y = R.div(b, scale)
      R.mul(scale, R.sqrt(R.add(R.mul(x, x), R.mul(y, y))))

def amplitude(values: C.Coefficients) -> R.Real:
  C.Coefficients{+a, +b, _} = values
  +scale = R.max(R.abs(a), R.abs(b))
  amplitude_nonzero(R.less(zero(), scale), a, b, scale)

def stationary_inside(inside: Bool, position: Position, parameter: R.Real, curve: A.Curve, signed: R.Real) -> List<&2, Extremum>:
  match inside:
    case False{}:
      Nil{}
    case True{}:
      [witness(position, parameter, curve, signed)]

def stationary(domain: C.Domain, position: Position, parameter: R.Real, curve: A.Curve, signed: R.Real) -> List<&2, Extremum>:
  match domain:
    case C.Untrimmed{}:
      [witness(position, C.canonical(parameter), curve, signed)]
    case C.Interval{+first, +last}:
      +lifted = C.lift_parameter(True{}, parameter, first, last)
      inside = Bool.and(I.at_most(first, lifted), I.at_most(lifted, last))
      stationary_inside(inside, position, lifted, curve, signed)

def varying_round(+source: Source, +values: C.Coefficients, +size: R.Real, guard: R.Real) -> Candidates:
  +domain = source_domain(source)
  +curve = source_curve(source)
  +phase = R.atan2(F.coefficient_b(values), F.coefficient_a(values))
  +c = F.coefficient_c(values)
  first = stationary(domain, StationaryMaximum{}, phase, curve, R.add(c, size))
  last = stationary(domain, StationaryMinimum{}, R.add(phase, R.pi()), curve, R.sub(c, size))
  endpoints = endpoint_candidates(domain, curve, values)
  +uncertainty = R.min(R.pi(), R.div(R.mul(guard, R.from_f32(4.0)), size))
  # The sinusoid is size-Lipschitz in its parameter. Account for phase error
  # even when it changes whether a stationary point lies inside the trim.
  Candidates{List.append(&2, Extremum, endpoints, List.append(&2, Extremum, first, last)), uncertainty, R.mul(size, uncertainty)}

def constant_parameter(domain: C.Domain) -> R.Real:
  match domain:
    case C.Untrimmed{}:
      zero()
    case C.Interval{first, _}:
      first

def constant_round(certified: Bool, +source: Source, values: C.Coefficients) -> Candidates:
  match certified:
    case False{}:
      UnknownCandidates{}
    case True{}:
      parameter = constant_parameter(source_domain(source))
      Candidates{[witness(ConstantRepresentative{}, parameter, source_curve(source), F.coefficient_c(values))], zero(), zero()}

def round_candidates(varying: Bool, +source: Source, values: C.Coefficients, size: R.Real, guard: R.Real) -> Candidates:
  match varying:
    case False{}:
      constant_round(C.parallel_certificate(source_exact(source)), source, values)
    case True{}:
      varying_round(source, values, size, guard)

def candidates(periodic: Bool, +source: Source, +values: C.Coefficients, guard: R.Real) -> Candidates:
  match periodic:
    case False{}:
      Candidates{endpoint_candidates(source_domain(source), source_curve(source), values), zero(), zero()}
    case True{}:
      +size = amplitude(values)
      round_candidates(R.less(zero(), size), source, values, size, guard)

def extrema_value(extremum: Extremum) -> R.Real:
  Extremum{_, _, value, _} = extremum
  value

def extrema_valid(extremum: Extremum) -> Bool:
  Extremum{parameter, point, value, _} = extremum
  Bool.and(I.scalar_valid(parameter), Bool.and(I.vec_valid(point), I.scalar_valid(value)))

def candidates_valid(candidates: List<&2, Extremum>) -> Bool:
  match candidates:
    case Nil{}:
      True{}
    case first <> tail:
      Bool.and(extrema_valid(first), candidates_valid(tail))

def minimum(values: List<&2, Extremum>, +current: Extremum) -> Extremum:
  match values:
    case Nil{}:
      current
    case +head <> tail:
      minimum(tail, Bool.pick(Extremum, R.less(extrema_value(head), extrema_value(current)), head, current))

def maximum(values: List<&2, Extremum>, +current: Extremum) -> Extremum:
  match values:
    case Nil{}:
      current
    case +head <> tail:
      maximum(tail, Bool.pick(Extremum, R.less(extrema_value(current), extrema_value(head)), head, current))

def classify_threshold(within: Bool, exceeds: Bool, evidence: Evidence) -> BandResult:
  match within exceeds:
    case True{} _:
      Resolved{ToleratedBand{}, evidence}
    case False{} True{}:
      Resolved{ExceedsBand{}, evidence}
    case False{} False{}:
      Unresolved{Threshold{evidence}}

def classify_certificate(certificate: Certificate, +evidence: Evidence, +extent: R.Real, +guard: R.Real, +cap: R.Real) -> BandResult:
  match certificate:
    case ExactZeroCoefficients{}:
      Resolved{ExactCurveInPlane{}, evidence}
    case NotCertified{}:
      classify_threshold(I.at_most(R.add(extent, guard), cap), R.less(cap, R.sub(extent, guard)), evidence)

def finish_extrema(source: Source, +small: Extremum, +large: Extremum, values: List<&2, Extremum>, +guard: R.Real, parameter_guard: R.Real, +cap: R.Real, +certificate: Certificate) -> BandResult:
  +extent = R.max(R.abs(extrema_value(small)), R.abs(extrema_value(large)))
  evidence = {Evidence{source, small, large, values, extent, guard, parameter_guard, cap, certificate} : Evidence}
  classify_certificate(certificate, evidence, extent, guard, cap)

def finish_candidates(valid: Bool, source: Source, values: List<&2, Extremum>, guard: R.Real, parameter_guard: R.Real, cap: R.Real, certificate: Certificate) -> BandResult:
  match valid values:
    case False{} _:
      Rejected{OutputRange{}}
    case True{} Nil{}:
      Rejected{OutputRange{}}
    case True{} +head <> +tail:
      finish_extrema(source, minimum(tail, head), maximum(tail, head), head <> tail, guard, parameter_guard, cap, certificate)

def finish(result: Candidates, source: Source, guard: R.Real, cap: R.Real, certificate: Certificate) -> BandResult:
  match result:
    case UnknownCandidates{}:
      Unresolved{CoefficientConditioning{source, guard}}
    case Candidates{+values, +parameter_guard, phase_distance_guard}:
      +combined_guard = R.add(guard, phase_distance_guard)
      valid = Bool.and(candidates_valid(values), Bool.and(I.scalar_valid(parameter_guard), I.scalar_valid(combined_guard)))
      finish_candidates(valid, source, values, combined_guard, parameter_guard, cap, certificate)

def coefficients_valid(values: C.Coefficients) -> Bool:
  C.Coefficients{a, b, c} = values
  Bool.and(I.scalar_valid(a), Bool.and(I.scalar_valid(b), I.scalar_valid(c)))

def calculate_valid(valid: Bool, +source: Source, values: C.Coefficients, +guard: R.Real, cap: R.Real) -> BandResult:
  match valid:
    case False{}:
      Rejected{OutputRange{}}
    case True{}:
      result = candidates(C.curve_periodic(source_curve(source)), source, values, guard)
      finish(result, source, guard, cap, source_certificate(source))

def calculate(+source: Source, cap: R.Real) -> BandResult:
  +values = source_coefficients(source)
  +guard = source_guard(source)
  calculate_valid(Bool.and(coefficients_valid(values), I.scalar_valid(guard)), source, values, guard, cap)

def domain_points_valid(domain: C.Domain, +curve: A.Curve) -> Bool:
  match domain:
    case C.Untrimmed{}:
      I.vec_valid(A.curve_point(curve, zero()))
    case C.Interval{first, last}:
      Bool.and(I.vec_valid(A.curve_point(curve, first)), I.vec_valid(A.curve_point(curve, last)))

def bound_domain(valid: Bool, curve: A.Curve, domain: C.Domain, origin: G.Vec3, normal: G.Vec3, cap: R.Real, allowance: R.Real) -> BandResult:
  match valid:
    case False{}:
      Rejected{InvalidDomain{}}
    case True{}:
      calculate(Source{curve, domain, origin, normal, allowance, None{}}, cap)

def bound_geometry(valid: Bool, +curve: A.Curve, +domain: C.Domain, origin: G.Vec3, normal: G.Vec3, cap: R.Real, allowance: R.Real) -> BandResult:
  match valid:
    case False{}:
      Rejected{InvalidGeometry{}}
    case True{}:
      periodic = C.curve_periodic(curve)
      finite = F.finite_domain(domain, periodic)
      valid = Bool.and(C.domain_valid(domain, C.curve_periodic(curve)), Bool.and(finite, domain_points_valid(domain, curve)))
      bound_domain(valid, curve, domain, origin, normal, cap, allowance)

def bound_budgets(contact_ok: Bool, source_ok: Bool, +curve: A.Curve, domain: C.Domain, +origin: G.Vec3, +normal: G.Vec3, cap: R.Real, allowance: R.Real) -> BandResult:
  match contact_ok source_ok:
    case False{} _:
      Rejected{InvalidContactTolerance{}}
    case True{} False{}:
      Rejected{InvalidSourceAllowance{}}
    case True{} True{}:
      valid = Bool.and(C.curve_valid(curve), Bool.and(I.vec_valid(origin), Bool.and(I.vec_valid(normal), I.direction_valid(normal))))
      bound_geometry(valid, curve, domain, origin, normal, cap, allowance)

def bound(curve: A.Curve, domain: C.Domain, plane_origin: G.Vec3, plane_normal: G.Vec3, +contact_tolerance: R.Real, +source_allowance: R.Real) -> BandResult:
  bound_budgets(F.valid_budget(contact_tolerance), F.valid_budget(source_allowance), curve, domain, plane_origin, plane_normal, contact_tolerance, source_allowance)

def edge_prepared(preparation: E.EdgePreparation, origin: G.Vec3, normal: G.Vec3, cap: R.Real, allowance: R.Real) -> BandResult:
  match preparation:
    case E.BadInput{reason}:
      Rejected{EdgeRejected{reason}}
    case E.NotPrepared{reason}:
      Unresolved{EdgeUnresolved{reason}}
    case E.Prepared{+source}:
      calculate(Source{E.source_curve(source), E.source_domain(source), origin, normal, allowance, Some{source}}, cap)

def edge_geometry(valid: Bool, solid: A.Solid, +index: U32, domains: List<&2, F.DomainChoice>, +origin: G.Vec3, normal: G.Vec3, tolerance: I.Tolerance, cap: R.Real, +allowance: R.Real) -> BandResult:
  match valid:
    case False{}:
      Rejected{InvalidGeometry{}}
    case True{}:
      A.Solid{vertices, edges, _} = solid
      choice = F.choose_domain(List.get(&2, F.DomainChoice, domains, U32.to_nat(index)))
      prepared = E.prepare_edge(List.get(&2, A.Edge, edges, U32.to_nat(index)), index, vertices, choice, origin, tolerance, allowance)
      edge_prepared(prepared, origin, normal, cap, allowance)

def edge_budgets(contact_ok: Bool, source_ok: Bool, tolerance_ok: Bool, solid: A.Solid, index: U32, domains: List<&2, F.DomainChoice>, +origin: G.Vec3, +normal: G.Vec3, tolerance: I.Tolerance, cap: R.Real, allowance: R.Real) -> BandResult:
  match contact_ok source_ok tolerance_ok:
    case False{} _ _:
      Rejected{InvalidContactTolerance{}}
    case True{} False{} _:
      Rejected{InvalidSourceAllowance{}}
    case True{} True{} False{}:
      Rejected{InvalidPreparationTolerance{}}
    case True{} True{} True{}:
      valid = Bool.and(I.vec_valid(origin), Bool.and(I.vec_valid(normal), I.direction_valid(normal)))
      edge_geometry(valid, solid, index, domains, origin, normal, tolerance, cap, allowance)

def bound_edge(solid: A.Solid, index: U32, domains: List<&2, F.DomainChoice>, plane_origin: G.Vec3, plane_normal: G.Vec3, +preparation_tolerance: I.Tolerance, +contact_tolerance: R.Real, +source_allowance: R.Real) -> BandResult:
  tolerance_ok = Bool.and(I.tolerance_valid(preparation_tolerance), I.at_most(I.angular_guard(), I.tolerance_angular(preparation_tolerance)))
  edge_budgets(F.valid_budget(contact_tolerance), F.valid_budget(source_allowance), tolerance_ok, solid, index, domains, plane_origin, plane_normal, preparation_tolerance, contact_tolerance, source_allowance)
