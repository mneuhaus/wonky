import Base
import ./real.bend as R
import ./precise.bend as G
import ./analytic.bend as A
import ./intersections.bend as I
import ./curve-plane.bend as C
import ./face-classification.bend as F

# Finite B-rep edges retain their analytic support and represented vertices.
# Source allowances validate incidence; they never certify coincidence.
type EdgeSource is Data:
  EdgeSource{index: U32, edge: A.Edge, domain: C.Domain, start: G.Vec3, end: G.Vec3, source_budget: R.Real, endpoint_error: R.Real, resolution: R.Real}

type Location is Data:
  Interior{}
  StartVertex{index: U32, point: G.Vec3, gap: R.Real}
  EndVertex{index: U32, point: G.Vec3, gap: R.Real}
  SeamVertex{index: U32, point: G.Vec3, gap: R.Real}

type EdgeHit is Data:
  Hit{parameter: R.Real, point: G.Vec3, multiplicity: U32, location: Location}

type Rejection is Data:
  InvalidIndex{}
  InvalidGeometry{}
  InvalidTolerance{}
  InvalidSourceTolerance{}
  InvalidTrim{}
  InvalidTopology{}
  CurveRejected{reason: C.Rejection}

type Issue is Data:
  MissingTrim{}
  InputGap{gap: R.Real, allowance: R.Real}
  ResolutionLimit{resolution: R.Real}
  EndpointAmbiguity{}
  CurveUnresolved{reason: C.ResolutionIssue}

type EdgePlaneResult is Data:
  Resolved{relation: C.Relation, hits: List<&2, EdgeHit>, source: EdgeSource, linear_resolution: R.Real, parameter_resolution: R.Real}
  Unresolved{reason: Issue}
  Rejected{reason: Rejection}

type EdgePreparation is Data:
  Prepared{source: EdgeSource}
  NotPrepared{reason: Issue}
  BadInput{reason: Rejection}

type EndpointState is Data:
  ClearEnd{}
  CertifiedEnd{}
  UncertainEnd{}

type EndpointStates is Data:
  EndpointStates{first: EndpointState, last: EndpointState}

type HitSelection is Data:
  Selected{valid: Bool, hits: List<&2, EdgeHit>}

def zero() -> R.Real:
  R.from_f32(0.0)

def bool_equal(a: Bool, +b: Bool) -> Bool:
  Bool.pick(Bool, a, b, Bool.not(b))

def source_curve(source: EdgeSource) -> A.Curve:
  EdgeSource{_, A.Edge{_, _, curve, _}, _, _, _, _, _, _} = source
  curve

def source_domain(source: EdgeSource) -> C.Domain:
  EdgeSource{_, _, domain, _, _, _, _, _} = source
  domain

def source_resolution(source: EdgeSource) -> R.Real:
  EdgeSource{_, _, _, _, _, _, _, resolution} = source
  resolution

def source_margin(source: EdgeSource, tolerance: I.Tolerance) -> R.Real:
  EdgeSource{_, _, _, _, _, budget, _, resolution} = source
  R.add(I.tolerance_linear(tolerance), R.add(budget, resolution))

def source_vertex(source: EdgeSource, first: Bool) -> G.Vec3:
  EdgeSource{_, A.Edge{_, _, _, sense}, _, start, end, _, _, _} = source
  Bool.pick(G.Vec3, bool_equal(first, sense), start, end)

def domain_topology(domain: C.Domain, periodic: Bool, +first: U32, +last: U32) -> Bool:
  match domain:
    case C.Untrimmed{}:
      Bool.and(periodic, U32.is_eq(first, last))
    case C.Interval{_, _}:
      Bool.not(U32.is_eq(first, last))

def endpoint_values_valid(domain: C.Domain, +curve: A.Curve, start: G.Vec3) -> Bool:
  match domain:
    case C.Untrimmed{}:
      I.vec_valid(A.curve_point(curve, A.curve_parameter(curve, start)))
    case C.Interval{first, last}:
      Bool.and(I.vec_valid(A.curve_point(curve, first)), I.vec_valid(A.curve_point(curve, last)))

def domain_scale(curve: A.Curve, domain: C.Domain) -> R.Real:
  match curve:
    case A.Line{_, +direction}:
      match domain:
        case C.Interval{first, last}:
          R.max(I.magnitude(G.scale(direction, first)), I.magnitude(G.scale(direction, last)))
        case C.Untrimmed{}:
          I.limit()
    case _:
      C.max_radius(curve)

def edge_resolution(+curve: A.Curve, domain: C.Domain, start: G.Vec3, end: G.Vec3, plane_origin: G.Vec3) -> R.Real:
  +scale = I.input_scale(C.curve_origin(curve), plane_origin, C.max_radius(curve))
  I.guard(R.mul(R.from_f32(10.0), R.max(scale, R.max(domain_scale(curve, domain), R.max(I.magnitude(start), I.magnitude(end))))))

def prepare_gap(ok: Bool, index: U32, edge: A.Edge, domain: C.Domain, start: G.Vec3, end: G.Vec3, +budget: R.Real, +gap: R.Real, +resolution: R.Real) -> EdgePreparation:
  match ok:
    case False{}:
      NotPrepared{InputGap{gap, R.add(budget, resolution)}}
    case True{}:
      Prepared{EdgeSource{index, edge, domain, start, end, budget, gap, resolution}}

def prepare_resolution(ok: Bool, index: U32, +edge: A.Edge, +domain: C.Domain, +start: G.Vec3, +end: G.Vec3, +budget: R.Real, +resolution: R.Real) -> EdgePreparation:
  match ok:
    case False{}:
      NotPrepared{ResolutionLimit{resolution}}
    case True{}:
      A.Edge{_, _, curve, sense} = edge
      +gap = F.endpoint_error(domain, curve, start, end, sense)
      prepare_gap(I.at_most(gap, R.add(budget, resolution)), index, edge, domain, start, end, budget, gap, resolution)

def prepare_evaluation(valid: Bool, index: U32, +edge: A.Edge, +domain: C.Domain, +start: G.Vec3, +end: G.Vec3, plane_origin: G.Vec3, tolerance: I.Tolerance, budget: R.Real) -> EdgePreparation:
  match valid:
    case False{}:
      BadInput{InvalidTrim{}}
    case True{}:
      A.Edge{_, _, curve, _} = edge
      +resolution = edge_resolution(curve, domain, start, end, plane_origin)
      prepare_resolution(I.at_most(resolution, I.tolerance_linear(tolerance)), index, edge, domain, start, end, budget, resolution)

def prepare_domain_valid(valid: Bool, topology: Bool, index: U32, +edge: A.Edge, +domain: C.Domain, +start: G.Vec3, end: G.Vec3, plane_origin: G.Vec3, tolerance: I.Tolerance, budget: R.Real) -> EdgePreparation:
  match valid topology:
    case False{} _:
      BadInput{InvalidTrim{}}
    case True{} False{}:
      BadInput{InvalidTopology{}}
    case True{} True{}:
      A.Edge{_, _, curve, _} = edge
      prepare_evaluation(endpoint_values_valid(domain, curve, start), index, edge, domain, start, end, plane_origin, tolerance, budget)

def prepare_domain(domain: Maybe<&2, C.Domain>, index: U32, +edge: A.Edge, start: G.Vec3, end: G.Vec3, plane_origin: G.Vec3, tolerance: I.Tolerance, budget: R.Real) -> EdgePreparation:
  match domain:
    case None{}:
      NotPrepared{MissingTrim{}}
    case Some{+value}:
      A.Edge{+first, +last, +curve, _} = edge
      valid = Bool.and(C.domain_valid(value, C.curve_periodic(curve)), F.finite_domain(value, C.curve_periodic(curve)))
      topology = domain_topology(value, C.curve_periodic(curve), first, last)
      prepare_domain_valid(valid, topology, index, edge, value, start, end, plane_origin, tolerance, budget)

def prepare_points_valid(valid: Bool, index: U32, +edge: A.Edge, choice: F.DomainChoice, +start: G.Vec3, +end: G.Vec3, plane_origin: G.Vec3, tolerance: I.Tolerance, budget: R.Real) -> EdgePreparation:
  match valid:
    case False{}:
      BadInput{InvalidGeometry{}}
    case True{}:
      prepare_domain(F.resolve_domain(choice, edge, start, end), index, edge, start, end, plane_origin, tolerance, budget)

def prepare_points(first: Maybe<&2, G.Vec3>, last: Maybe<&2, G.Vec3>, index: U32, +edge: A.Edge, choice: F.DomainChoice, plane_origin: G.Vec3, tolerance: I.Tolerance, budget: R.Real) -> EdgePreparation:
  match first last:
    case Some{+start} Some{+end}:
      A.Edge{_, _, curve, _} = edge
      valid = Bool.and(C.curve_valid(curve), Bool.and(I.vec_valid(start), I.vec_valid(end)))
      prepare_points_valid(valid, index, edge, choice, start, end, plane_origin, tolerance, budget)
    case _ _:
      BadInput{InvalidIndex{}}

def prepare_edge(found: Maybe<&2, A.Edge>, index: U32, +vertices: List<&2, G.Vec3>, choice: F.DomainChoice, plane_origin: G.Vec3, tolerance: I.Tolerance, budget: R.Real) -> EdgePreparation:
  match found:
    case None{}:
      BadInput{InvalidIndex{}}
    case Some{+edge}:
      A.Edge{first, last, _, _} = edge
      prepare_points(List.get(&2, G.Vec3, vertices, U32.to_nat(first)), List.get(&2, G.Vec3, vertices, U32.to_nat(last)), index, edge, choice, plane_origin, tolerance, budget)

def signed_point(point: G.Vec3, origin: G.Vec3, normal: G.Vec3) -> R.Real:
  I.signed_distance(G.sub(point, origin), normal)

def line_separated(domain: C.Domain, values: C.Coefficients, +margin: R.Real) -> Bool:
  match domain:
    case C.Untrimmed{}:
      False{}
    case C.Interval{first, last}:
      C.Coefficients{_, +b, +c} = values
      +a = R.add(R.mul(b, first), c)
      +z = R.add(R.mul(b, last), c)
      Bool.or(Bool.and(R.less(margin, a), R.less(margin, z)), Bool.and(R.less(a, R.neg(margin)), R.less(z, R.neg(margin))))

def curve_separated(periodic: Bool, domain: C.Domain, values: C.Coefficients, margin: R.Real) -> Bool:
  match periodic:
    case False{}:
      line_separated(domain, values, margin)
    case True{}:
      C.Coefficients{+a, +b, c} = values
      R.less(margin, R.sub(R.abs(c), R.sqrt(R.add(R.mul(a, a), R.mul(b, b)))))

def separated(+source: EdgeSource, +plane_origin: G.Vec3, +plane_normal: G.Vec3, tolerance: I.Tolerance) -> Bool:
  EdgeSource{_, _, domain, +start, +end, _, _, _} = source
  +margin = source_margin(source, tolerance)
  +curve = source_curve(source)
  bounds = curve_separated(C.curve_periodic(curve), domain, C.coefficients(curve, plane_origin, plane_normal), margin)
  vertices = Bool.and(R.less(margin, R.abs(signed_point(start, plane_origin, plane_normal))), R.less(margin, R.abs(signed_point(end, plane_origin, plane_normal))))
  Bool.and(bounds, vertices)

def vertex_certificate(point: G.Vec3, origin: G.Vec3, normal: G.Vec3) -> Bool:
  I.expansion_zero(I.exact_dot_delta(normal, point, origin))

def endpoint_classify(certified: Bool, clear: Bool) -> EndpointState:
  match certified clear:
    case True{} _:
      CertifiedEnd{}
    case False{} True{}:
      ClearEnd{}
    case False{} False{}:
      UncertainEnd{}

def endpoint_state(+curve: A.Curve, +parameter: R.Real, +vertex: G.Vec3, +plane_origin: G.Vec3, +plane_normal: G.Vec3, +margin: R.Real) -> EndpointState:
  certified = Bool.and(vertex_certificate(vertex, plane_origin, plane_normal), C.endpoint_certificate(curve, plane_origin, plane_normal, parameter))
  clear = Bool.and(R.less(margin, R.abs(signed_point(vertex, plane_origin, plane_normal))), R.less(margin, R.abs(signed_point(A.curve_point(curve, parameter), plane_origin, plane_normal))))
  endpoint_classify(certified, clear)

def seam_state(+source: EdgeSource, +plane_origin: G.Vec3, +plane_normal: G.Vec3, tolerance: I.Tolerance) -> EndpointState:
  EdgeSource{_, _, _, +start, _, _, _, +resolution} = source
  +curve = source_curve(source)
  zero_seam = I.at_most(F.distance(start, A.curve_point(curve, zero())), resolution)
  certified = Bool.and(zero_seam, Bool.and(vertex_certificate(start, plane_origin, plane_normal), C.endpoint_certificate(curve, plane_origin, plane_normal, zero())))
  clear = R.less(source_margin(source, tolerance), R.abs(signed_point(start, plane_origin, plane_normal)))
  endpoint_classify(certified, clear)

def endpoint_states_domain(domain: C.Domain, +source: EdgeSource, +plane_origin: G.Vec3, +plane_normal: G.Vec3, +tolerance: I.Tolerance) -> EndpointStates:
  match domain:
    case C.Untrimmed{}:
      +state = seam_state(source, plane_origin, plane_normal, tolerance)
      EndpointStates{state, state}
    case C.Interval{first, last}:
      +curve = source_curve(source)
      +margin = source_margin(source, tolerance)
      a = endpoint_state(curve, first, source_vertex(source, True{}), plane_origin, plane_normal, margin)
      b = endpoint_state(curve, last, source_vertex(source, False{}), plane_origin, plane_normal, margin)
      EndpointStates{a, b}

def same_position(first: Bool, position: C.Position) -> Bool:
  match position:
    case C.FirstEndpoint{}:
      first
    case C.LastEndpoint{}:
      Bool.not(first)
    case C.Interior{}:
      False{}

def zero_parameter(+parameter: R.Real, resolution: R.Real) -> Bool:
  I.at_most(R.min(R.abs(parameter), R.abs(R.sub(C.tau(), parameter))), resolution)

def has_endpoint(hits: List<&2, C.Hit>, +first: Bool, +periodic_full: Bool, +resolution: R.Real) -> Bool:
  match hits:
    case Nil{}:
      False{}
    case C.Hit{parameter, _, _, position} <> tail:
      matches = Bool.pick(Bool, periodic_full, zero_parameter(parameter, resolution), same_position(first, position))
      Bool.or(matches, has_endpoint(tail, first, periodic_full, resolution))

def state_supported(state: EndpointState, hits: List<&2, C.Hit>, first: Bool, periodic_full: Bool, resolution: R.Real) -> Bool:
  match state:
    case ClearEnd{}:
      True{}
    case UncertainEnd{}:
      False{}
    case CertifiedEnd{}:
      has_endpoint(hits, first, periodic_full, resolution)

def untrimmed(domain: C.Domain) -> Bool:
  match domain:
    case C.Untrimmed{}:
      True{}
    case C.Interval{_, _}:
      False{}

def states_supported(states: EndpointStates, +hits: List<&2, C.Hit>, +full: Bool, +resolution: R.Real) -> Bool:
  EndpointStates{first, last} = states
  Bool.and(state_supported(first, hits, True{}, full, resolution), state_supported(last, hits, False{}, full, resolution))

def vertex_location(first: Bool, source: EdgeSource, +point: G.Vec3) -> Location:
  EdgeSource{_, A.Edge{+start_index, +end_index, _, +sense}, _, +start, +end, _, _, _} = source
  +is_start = bool_equal(first, sense)
  +gap = F.distance(point, Bool.pick(G.Vec3, is_start, start, end))
  Bool.pick(Location, is_start, StartVertex{start_index, start, gap}, EndVertex{end_index, end, gap})

def interior_selected(clear: Bool, parameter: R.Real, point: G.Vec3, multiplicity: U32) -> HitSelection:
  match clear:
    case False{}:
      Selected{False{}, Nil{}}
    case True{}:
      Selected{True{}, [Hit{parameter, point, multiplicity, Interior{}}]}

def interior_clear(domain: C.Domain, +curve: A.Curve, +point: G.Vec3, start: G.Vec3, end: G.Vec3, +margin: R.Real) -> Bool:
  match domain:
    case C.Untrimmed{}:
      R.less(margin, F.distance(point, start))
    case C.Interval{first, last}:
      +vertices = R.min(F.distance(point, start), F.distance(point, end))
      +geometry = R.min(F.distance(point, A.curve_point(curve, first)), F.distance(point, A.curve_point(curve, last)))
      R.less(margin, R.min(vertices, geometry))

def seam_selected(certified: Bool, source: EdgeSource, parameter: R.Real, +point: G.Vec3, multiplicity: U32) -> HitSelection:
  match certified:
    case False{}:
      Selected{False{}, Nil{}}
    case True{}:
      EdgeSource{_, A.Edge{index, _, _, _}, _, +start, _, _, _, _} = source
      Selected{True{}, [Hit{parameter, point, multiplicity, SeamVertex{index, start, F.distance(point, start)}}]}

def seam_certified(state: EndpointState, parameter: R.Real, resolution: R.Real) -> Bool:
  match state:
    case CertifiedEnd{}:
      zero_parameter(parameter, resolution)
    case _:
      False{}

def interior_hit(clear: Bool, +source: EdgeSource, +parameter: R.Real, point: G.Vec3, multiplicity: U32, states: EndpointStates, resolution: R.Real) -> HitSelection:
  match clear:
    case True{}:
      interior_selected(True{}, parameter, point, multiplicity)
    case False{}:
      EndpointStates{first, _} = states
      certified = Bool.and(untrimmed(source_domain(source)), seam_certified(first, parameter, resolution))
      seam_selected(certified, source, parameter, point, multiplicity)

def select_hit(hit: C.Hit, +source: EdgeSource, states: EndpointStates, tolerance: I.Tolerance, resolution: R.Real) -> HitSelection:
  C.Hit{+parameter, +point, multiplicity, position} = hit
  match position:
    case C.FirstEndpoint{}:
      Selected{True{}, [Hit{parameter, point, multiplicity, vertex_location(True{}, source, point)}]}
    case C.LastEndpoint{}:
      Selected{True{}, [Hit{parameter, point, multiplicity, vertex_location(False{}, source, point)}]}
    case C.Interior{}:
      EdgeSource{_, _, domain, start, end, _, _, _} = source
      clear = interior_clear(domain, source_curve(source), point, start, end, source_margin(source, tolerance))
      interior_hit(clear, source, parameter, point, multiplicity, states, resolution)

def join_selected(a: HitSelection, b: HitSelection) -> HitSelection:
  Selected{valid_a, hits_a} = a
  Selected{valid_b, hits_b} = b
  Selected{Bool.and(valid_a, valid_b), List.append(&2, EdgeHit, hits_a, hits_b)}

def select_hits(hits: List<&2, C.Hit>, +source: EdgeSource, +states: EndpointStates, +tolerance: I.Tolerance, +resolution: R.Real) -> HitSelection:
  match hits:
    case Nil{}:
      Selected{True{}, Nil{}}
    case head <> tail:
      join_selected(select_hit(head, source, states, tolerance, resolution), select_hits(tail, source, states, tolerance, resolution))

def finish_selection(selection: HitSelection, relation: C.Relation, +source: EdgeSource, linear: R.Real, parameter: R.Real) -> EdgePlaneResult:
  match selection:
    case Selected{True{}, hits}:
      Resolved{relation, hits, source, R.max(linear, source_resolution(source)), parameter}
    case Selected{False{}, _}:
      Unresolved{EndpointAmbiguity{}}

def finish_states(valid: Bool, states: EndpointStates, relation: C.Relation, hits: List<&2, C.Hit>, +source: EdgeSource, tolerance: I.Tolerance, linear: R.Real, +parameter: R.Real) -> EdgePlaneResult:
  match valid:
    case False{}:
      Unresolved{EndpointAmbiguity{}}
    case True{}:
      finish_selection(select_hits(hits, source, states, tolerance, parameter), relation, source, linear, parameter)

def finish_endpoints(+states: EndpointStates, relation: C.Relation, +hits: List<&2, C.Hit>, +source: EdgeSource, tolerance: I.Tolerance, linear: R.Real, +parameter: R.Real) -> EdgePlaneResult:
  valid = states_supported(states, hits, untrimmed(source_domain(source)), parameter)
  finish_states(valid, states, relation, hits, source, tolerance, linear, parameter)

def finish_coincident(certified: Bool, +source: EdgeSource, linear: R.Real, parameter: R.Real) -> EdgePlaneResult:
  match certified:
    case False{}:
      Unresolved{EndpointAmbiguity{}}
    case True{}:
      Resolved{C.Coincident{}, Nil{}, source, R.max(linear, source_resolution(source)), parameter}

def finish_relation(relation: C.Relation, hits: List<&2, C.Hit>, +source: EdgeSource, +plane_origin: G.Vec3, +plane_normal: G.Vec3, +tolerance: I.Tolerance, linear: R.Real, parameter: R.Real) -> EdgePlaneResult:
  match relation:
    case C.Coincident{}:
      EdgeSource{_, _, _, start, end, _, _, _} = source
      certified = Bool.and(vertex_certificate(start, plane_origin, plane_normal), vertex_certificate(end, plane_origin, plane_normal))
      finish_coincident(certified, source, linear, parameter)
    case _:
      states = endpoint_states_domain(source_domain(source), source, plane_origin, plane_normal, tolerance)
      finish_endpoints(states, relation, hits, source, tolerance, linear, parameter)

def finish_curve(result: C.CurvePlaneResult, source: EdgeSource, plane_origin: G.Vec3, plane_normal: G.Vec3, tolerance: I.Tolerance) -> EdgePlaneResult:
  match result:
    case C.Resolved{relation, hits, linear, parameter}:
      finish_relation(relation, hits, source, plane_origin, plane_normal, tolerance, linear, parameter)
    case C.Unresolved{reason, _, _}:
      Unresolved{CurveUnresolved{reason}}
    case C.Rejected{reason}:
      Rejected{CurveRejected{reason}}

def intersect_separated(clear: Bool, +source: EdgeSource, +plane_origin: G.Vec3, +plane_normal: G.Vec3, +tolerance: I.Tolerance) -> EdgePlaneResult:
  match clear:
    case True{}:
      Resolved{C.Disjoint{}, Nil{}, source, source_resolution(source), zero()}
    case False{}:
      result = C.intersect(source_curve(source), plane_origin, plane_normal, source_domain(source), tolerance)
      finish_curve(result, source, plane_origin, plane_normal, tolerance)

def intersect_prepared(prepared: EdgePreparation, +plane_origin: G.Vec3, +plane_normal: G.Vec3, +tolerance: I.Tolerance) -> EdgePlaneResult:
  match prepared:
    case BadInput{reason}:
      Rejected{reason}
    case NotPrepared{reason}:
      Unresolved{reason}
    case Prepared{+source}:
      intersect_separated(separated(source, plane_origin, plane_normal, tolerance), source, plane_origin, plane_normal, tolerance)

def intersect_inputs(valid: Bool, solid: A.Solid, +index: U32, domains: List<&2, F.DomainChoice>, +plane_origin: G.Vec3, plane_normal: G.Vec3, +tolerance: I.Tolerance, budget: R.Real) -> EdgePlaneResult:
  match valid:
    case False{}:
      Rejected{InvalidGeometry{}}
    case True{}:
      A.Solid{vertices, edges, _} = solid
      choice = F.choose_domain(List.get(&2, F.DomainChoice, domains, U32.to_nat(index)))
      prepared = prepare_edge(List.get(&2, A.Edge, edges, U32.to_nat(index)), index, vertices, choice, plane_origin, tolerance, budget)
      intersect_prepared(prepared, plane_origin, plane_normal, tolerance)

def intersect_budgets(tolerance_valid: Bool, source_valid: Bool, angular_ok: Bool, solid: A.Solid, index: U32, domains: List<&2, F.DomainChoice>, +plane_origin: G.Vec3, +plane_normal: G.Vec3, tolerance: I.Tolerance, budget: R.Real) -> EdgePlaneResult:
  match tolerance_valid source_valid angular_ok:
    case False{} _ _:
      Rejected{InvalidTolerance{}}
    case True{} False{} _:
      Rejected{InvalidSourceTolerance{}}
    case True{} True{} False{}:
      Unresolved{CurveUnresolved{C.AngularBudget{}}}
    case True{} True{} True{}:
      valid = Bool.and(I.vec_valid(plane_origin), Bool.and(I.vec_valid(plane_normal), I.direction_valid(plane_normal)))
      intersect_inputs(valid, solid, index, domains, plane_origin, plane_normal, tolerance, budget)

def intersect(solid: A.Solid, index: U32, domains: List<&2, F.DomainChoice>, plane_origin: G.Vec3, plane_normal: G.Vec3, +tolerance: I.Tolerance, +source_budget: R.Real) -> EdgePlaneResult:
  intersect_budgets(I.tolerance_valid(tolerance), F.valid_budget(source_budget), I.at_most(I.angular_guard(), I.tolerance_angular(tolerance)), solid, index, domains, plane_origin, plane_normal, tolerance, source_budget)
