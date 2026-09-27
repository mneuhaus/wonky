import Base
import ./real.bend as R
import ./precise.bend as G
import ./analytic.bend as A
import ./intersections.bend as I
import ./curve-plane.bend as C
import ./face-classification.bend as F
import ./edge-plane.bend as E

# A junction associates retained points. It never chooses a replacement point,
# rewrites a curve, or promotes a tolerance relation to geometric coincidence.
type SourceVertex is Data:
  SourceVertex{body: U32, vertex: U32, point: G.Vec3, allowance: R.Real}

type CurveRef is Data:
  CurveRef{body: U32, edge: U32, curve: A.Curve, domain: C.Domain}

type PlaneRef is Data:
  PlaneRef{body: U32, face: U32, origin: G.Vec3, normal: G.Vec3}

type Policy is Data:
  Policy{contact_tolerance: R.Real}

type Certificate is Data:
  ExactZero{}
  NotCertified{}

type PlaneIncidence is Data:
  PlaneIncidence{signed_distance: R.Real, resolution: R.Real, certificate: Certificate}

type EventSpec is Data:
  Vertex{key: U32, source: SourceVertex}
  Sample{key: U32, reference: CurveRef, parameter: R.Real, allowance: R.Real}
  Projection{key: U32, reference: PlaneRef, seed: SourceVertex}
  Intersection{key: U32, curve: CurveRef, plane: PlaneRef, hit_index: U32, tolerance: I.Tolerance, allowance: R.Real}

type EndpointProposal is Data:
  Proposal{anchor: SourceVertex, specs: List<&2, EventSpec>}

type Witness is Data:
  VertexWitness{source: SourceVertex}
  CurveWitness{reference: CurveRef, parameter: R.Real}
  ProjectionWitness{reference: PlaneRef, seed: SourceVertex, displacement: R.Real, seed_incidence: PlaneIncidence, point_incidence: PlaneIncidence}
  IntersectionWitness{curve: CurveRef, plane: PlaneRef, parameter: R.Real, multiplicity: U32, position: C.Position, linear_resolution: R.Real, parameter_resolution: R.Real, point_incidence: PlaneIncidence, analytic_certificate: Certificate}

type JunctionEvent is Data:
  JunctionEvent{key: U32, point: G.Vec3, allowance: R.Real, resolution: R.Real, witness: Witness}

type Rejection is Data:
  InvalidPolicy{}
  InvalidSource{}
  InvalidCurve{}
  InvalidPlane{}
  InvalidParameter{}
  InvalidAllowance{}
  OutsideDomain{}
  OutputRange{}
  NoEvents{}
  DuplicateEvent{key: U32}
  ConflictingReference{}
  MissingIntersectionHit{key: U32}
  CurveRejected{key: U32, reason: C.Rejection}
  NoAnchors{}
  DuplicateAnchor{}

type NodeKey is Data:
  AnchorKey{body: U32, vertex: U32}
  EventKey{key: U32}

type GapRelation is Data:
  SameRepresentedPoint{}
  WithinTolerance{}
  OutsideTolerance{}
  ThresholdBand{}

type Gap is Data:
  Gap{first: NodeKey, last: NodeKey, delta: G.Vec3, distance: R.Real, resolution: R.Real, tolerance: R.Real, relation: GapRelation}

type Issue is Data:
  CurveUnresolved{key: U32, reason: C.ResolutionIssue}
  ConstructionBudget{key: U32, resolution: R.Real}
  ParameterConflict{first: U32, last: U32}
  Threshold{witness: Gap}
  CompetingAnchors{}
  IndeterminateAnchor{}

type Preparation is Data:
  Prepared{events: List<&2, JunctionEvent>}
  NotPrepared{reason: Issue}
  Invalid{reason: Rejection}

type PlaneCheck is Data:
  PlaneCheck{event: U32, reference: PlaneRef, incidence: PlaneIncidence}

type Mode is Data:
  ExactRepresentedPoints{}
  ToleratedConnection{}

type Junction is Data:
  Junction{anchor: SourceVertex, events: List<&2, JunctionEvent>, gaps: List<&2, Gap>, plane_checks: List<&2, PlaneCheck>, diameter: R.Real, policy: Policy, mode: Mode}

type Association is Data:
  Associated{junction: Junction}
  Separated{witness: Gap}
  Unresolved{reason: Issue}
  Rejected{reason: Rejection}

type GapAssessment is Data:
  AllWithin{exact: Bool, diameter: R.Real}
  TooFar{gap: Gap}
  UncertainGap{witness: Gap}

type Validation is Data:
  Valid{}
  Bad{reason: Rejection}
  Uncertain{reason: Issue}

type AnchorSelection is Data:
  Unique{junction: Junction}
  NoneFound{}
  UnresolvedSelection{reason: Issue}
  RejectedSelection{reason: Rejection}

def zero() -> R.Real:
  R.from_f32(0.0)

def certificate(exact: Bool) -> Certificate:
  Bool.pick(Certificate, exact, ExactZero{}, NotCertified{})

def vec_equal(a: G.Vec3, b: G.Vec3) -> Bool:
  G.V3{ax, ay, az} = a
  G.V3{bx, by, bz} = b
  Bool.and(R.equal(ax, bx), Bool.and(R.equal(ay, by), R.equal(az, bz)))

def resolution(a: G.Vec3, b: G.Vec3) -> R.Real:
  I.guard(R.mul(R.from_f32(10.0), I.input_scale(a, b, zero())))

def policy_valid(policy: Policy) -> Bool:
  Policy{tolerance} = policy
  F.valid_budget(tolerance)

def policy_tolerance(policy: Policy) -> R.Real:
  Policy{tolerance} = policy
  tolerance

def source_point(source: SourceVertex) -> G.Vec3:
  SourceVertex{_, _, point, _} = source
  point

# This helper consumes an already prepared finite edge. It proposes a native
# endpoint sample and a separate plane foot; neither is an intersection root.
def endpoint_parameter(domain: C.Domain, curve: A.Curve, point: G.Vec3, first: Bool) -> R.Real:
  match domain:
    case C.Untrimmed{}:
      A.curve_parameter(curve, point)
    case C.Interval{start, end}:
      Bool.pick(R.Real, first, start, end)

def endpoint_proposal(source: E.EdgeSource, +body: U32, plane: PlaneRef, +at_start: Bool, curve_key: U32, projection_key: U32) -> EndpointProposal:
  E.EdgeSource{edge_index, A.Edge{start_index, end_index, +curve, sense}, +domain, start, end, +allowance, _, _} = source
  +point = Bool.pick(G.Vec3, at_start, start, end)
  index = Bool.pick(U32, at_start, start_index, end_index)
  parameter = endpoint_parameter(domain, curve, point, E.bool_equal(at_start, sense))
  +anchor : SourceVertex = SourceVertex{body, index, point, allowance}
  reference : CurveRef = CurveRef{body, edge_index, curve, domain}
  Proposal{anchor, [Sample{curve_key, reference, parameter, allowance}, Projection{projection_key, plane, anchor}]}

def source_valid(source: SourceVertex) -> Bool:
  SourceVertex{_, _, point, allowance} = source
  Bool.and(I.vec_valid(point), F.valid_budget(allowance))

def plane_valid(plane: PlaneRef) -> Bool:
  PlaneRef{_, _, origin, +normal} = plane
  Bool.and(I.vec_valid(origin), Bool.and(I.vec_valid(normal), I.direction_valid(normal)))

def curve_valid(reference: CurveRef) -> Bool:
  CurveRef{_, _, +curve, domain} = reference
  Bool.and(C.curve_valid(curve), C.domain_valid(domain, C.curve_periodic(curve)))

def parameter_in(domain: C.Domain, +parameter: R.Real) -> Bool:
  match domain:
    case C.Untrimmed{}:
      True{}
    case C.Interval{first, last}:
      Bool.and(I.at_most(first, parameter), I.at_most(parameter, last))

def plane_incidence(plane: PlaneRef, +point: G.Vec3) -> PlaneIncidence:
  PlaneRef{_, _, +origin, +normal} = plane
  signed = I.signed_distance(G.sub(point, origin), normal)
  exact = I.expansion_zero(I.exact_dot_delta(normal, point, origin))
  PlaneIncidence{signed, resolution(point, origin), certificate(exact)}

def sample_resolution(curve: A.Curve, parameter: R.Real, +point: G.Vec3) -> R.Real:
  match curve:
    case A.Line{origin, direction}:
      I.guard(R.mul(R.from_f32(10.0), R.max(I.input_scale(origin, point, zero()), I.magnitude(G.scale(direction, parameter)))))
    case A.Circle{origin, _, _, radius}:
      I.guard(R.mul(R.from_f32(10.0), I.input_scale(origin, point, radius)))
    case A.Ellipse{origin, _, _, major, minor}:
      I.guard(R.mul(R.from_f32(10.0), I.input_scale(origin, point, R.max(major, minor))))

def prepared_point(valid: Bool, key: U32, point: G.Vec3, allowance: R.Real, guard: R.Real, witness: Witness) -> Preparation:
  match valid:
    case False{}:
      Invalid{OutputRange{}}
    case True{}:
      Prepared{[JunctionEvent{key, point, allowance, guard, witness}]}

def prepare_vertex(valid: Bool, key: U32, +source: SourceVertex) -> Preparation:
  match valid:
    case False{}:
      Invalid{InvalidSource{}}
    case True{}:
      SourceVertex{_, _, point, allowance} = source
      Prepared{[JunctionEvent{key, point, allowance, zero(), VertexWitness{source}}]}

def sample_inside(inside: Bool, key: U32, +reference: CurveRef, +parameter: R.Real, allowance: R.Real) -> Preparation:
  match inside:
    case False{}:
      Invalid{OutsideDomain{}}
    case True{}:
      CurveRef{_, _, +curve, _} = reference
      +point = A.curve_point(curve, parameter)
      prepared_point(I.vec_valid(point), key, point, allowance, sample_resolution(curve, parameter, point), CurveWitness{reference, parameter})

def sample_parameter(valid: Bool, key: U32, +reference: CurveRef, +parameter: R.Real, allowance: R.Real) -> Preparation:
  match valid:
    case False{}:
      Invalid{InvalidParameter{}}
    case True{}:
      CurveRef{_, _, _, domain} = reference
      sample_inside(parameter_in(domain, parameter), key, reference, parameter, allowance)

def prepare_sample(curve_ok: Bool, allowance_ok: Bool, key: U32, +reference: CurveRef, +parameter: R.Real, allowance: R.Real) -> Preparation:
  match curve_ok allowance_ok:
    case False{} _:
      Invalid{InvalidCurve{}}
    case True{} False{}:
      Invalid{InvalidAllowance{}}
    case True{} True{}:
      CurveRef{_, _, curve, _} = reference
      sample_parameter(C.parameter_valid(C.curve_periodic(curve), parameter), key, reference, parameter, allowance)

def prepare_projection(plane_ok: Bool, source_ok: Bool, key: U32, +reference: PlaneRef, +seed: SourceVertex) -> Preparation:
  match plane_ok source_ok:
    case False{} _:
      Invalid{InvalidPlane{}}
    case True{} False{}:
      Invalid{InvalidSource{}}
    case True{} True{}:
      PlaneRef{_, _, +origin, normal} = reference
      SourceVertex{_, _, +original, allowance} = seed
      +point = F.project(original, origin, G.normalize(normal))
      witness : Witness = ProjectionWitness{reference, seed, F.distance(original, point), plane_incidence(reference, original), plane_incidence(reference, point)}
      prepared_point(I.vec_valid(point), key, point, allowance, resolution(original, origin), witness)

def analytic_certificate(curve: CurveRef, plane: PlaneRef, parameter: R.Real) -> Certificate:
  CurveRef{_, _, geometry, _} = curve
  PlaneRef{_, _, origin, normal} = plane
  certificate(C.endpoint_certificate(geometry, origin, normal, parameter))

def intersection_hit(found: Maybe<&2, C.Hit>, key: U32, +curve: CurveRef, +plane: PlaneRef, allowance: R.Real, +linear: R.Real, parameter_resolution: R.Real) -> Preparation:
  match found:
    case None{}:
      Invalid{MissingIntersectionHit{key}}
    case Some{C.Hit{+parameter, +point, multiplicity, position}}:
      witness : Witness = IntersectionWitness{curve, plane, parameter, multiplicity, position, linear, parameter_resolution, plane_incidence(plane, point), analytic_certificate(curve, plane, parameter)}
      Prepared{[JunctionEvent{key, point, allowance, linear, witness}]}

def intersection_result(result: C.CurvePlaneResult, key: U32, curve: CurveRef, plane: PlaneRef, index: U32, allowance: R.Real) -> Preparation:
  match result:
    case C.Rejected{reason}:
      Invalid{CurveRejected{key, reason}}
    case C.Unresolved{reason, _, _}:
      NotPrepared{CurveUnresolved{key, reason}}
    case C.Resolved{_, hits, linear, parameter}:
      intersection_hit(List.get(&2, C.Hit, hits, U32.to_nat(index)), key, curve, plane, allowance, linear, parameter)

def prepare_intersection(curve_ok: Bool, plane_ok: Bool, allowance_ok: Bool, key: U32, +curve: CurveRef, +plane: PlaneRef, index: U32, tolerance: I.Tolerance, allowance: R.Real) -> Preparation:
  match curve_ok plane_ok allowance_ok:
    case False{} _ _:
      Invalid{InvalidCurve{}}
    case True{} False{} _:
      Invalid{InvalidPlane{}}
    case True{} True{} False{}:
      Invalid{InvalidAllowance{}}
    case True{} True{} True{}:
      CurveRef{_, _, geometry, domain} = curve
      PlaneRef{_, _, origin, normal} = plane
      intersection_result(C.intersect(geometry, origin, normal, domain, tolerance), key, curve, plane, index, allowance)

def prepare_event(spec: EventSpec) -> Preparation:
  match spec:
    case Vertex{key, +source}:
      prepare_vertex(source_valid(source), key, source)
    case Sample{key, +reference, parameter, +allowance}:
      prepare_sample(curve_valid(reference), F.valid_budget(allowance), key, reference, parameter, allowance)
    case Projection{key, +reference, +seed}:
      prepare_projection(plane_valid(reference), source_valid(seed), key, reference, seed)
    case Intersection{key, +curve, +plane, index, tolerance, +allowance}:
      prepare_intersection(curve_valid(curve), plane_valid(plane), F.valid_budget(allowance), key, curve, plane, index, tolerance, allowance)

def join_preparation(a: Preparation, b: Preparation) -> Preparation:
  match a b:
    case Invalid{reason} _:
      Invalid{reason}
    case _ Invalid{reason}:
      Invalid{reason}
    case NotPrepared{reason} _:
      NotPrepared{reason}
    case _ NotPrepared{reason}:
      NotPrepared{reason}
    case Prepared{first} Prepared{last}:
      Prepared{List.append(&2, JunctionEvent, first, last)}

def prepare_events(specs: List<&2, EventSpec>) -> Preparation:
  match specs:
    case Nil{}:
      Prepared{Nil{}}
    case head <> tail:
      join_preparation(prepare_event(head), prepare_events(tail))

def domain_equal(a: C.Domain, b: C.Domain) -> Bool:
  match a b:
    case C.Untrimmed{} C.Untrimmed{}:
      True{}
    case C.Interval{af, al} C.Interval{bf, bl}:
      Bool.and(R.equal(af, bf), R.equal(al, bl))
    case _ _:
      False{}

def curve_equal(a: A.Curve, b: A.Curve) -> Bool:
  match a b:
    case A.Line{ao, ad} A.Line{bo, bd}:
      Bool.and(vec_equal(ao, bo), vec_equal(ad, bd))
    case A.Circle{ao, an, ax, ar} A.Circle{bo, bn, bx, br}:
      Bool.and(Bool.and(vec_equal(ao, bo), vec_equal(an, bn)), Bool.and(vec_equal(ax, bx), R.equal(ar, br)))
    case A.Ellipse{ao, an, ax, aa, ab} A.Ellipse{bo, bn, bx, ba, bb}:
      Bool.and(Bool.and(vec_equal(ao, bo), vec_equal(an, bn)), Bool.and(vec_equal(ax, bx), Bool.and(R.equal(aa, ba), R.equal(ab, bb))))
    case _ _:
      False{}

def event_curve(event: JunctionEvent) -> Maybe<&2, CurveRef>:
  JunctionEvent{_, _, _, _, witness} = event
  match witness:
    case CurveWitness{reference, _}:
      Some{reference}
    case IntersectionWitness{curve, _, _, _, _, _, _, _, _}:
      Some{curve}
    case _:
      None{}

def event_parameter(event: JunctionEvent) -> R.Real:
  JunctionEvent{_, _, _, _, witness} = event
  match witness:
    case CurveWitness{_, parameter}:
      parameter
    case IntersectionWitness{_, _, parameter, _, _, _, _, _, _}:
      parameter
    case _:
      zero()

def event_plane(event: JunctionEvent) -> Maybe<&2, PlaneRef>:
  JunctionEvent{_, _, _, _, witness} = event
  match witness:
    case ProjectionWitness{reference, _, _, _, _}:
      Some{reference}
    case IntersectionWitness{_, plane, _, _, _, _, _, _, _}:
      Some{plane}
    case _:
      None{}

def event_source(event: JunctionEvent) -> Maybe<&2, SourceVertex>:
  JunctionEvent{_, _, _, _, witness} = event
  match witness:
    case VertexWitness{source}:
      Some{source}
    case ProjectionWitness{_, seed, _, _, _}:
      Some{seed}
    case _:
      None{}

def event_key(event: JunctionEvent) -> U32:
  JunctionEvent{key, _, _, _, _} = event
  key

def join_validation(a: Validation, b: Validation) -> Validation:
  match a b:
    case Bad{reason} _:
      Bad{reason}
    case _ Bad{reason}:
      Bad{reason}
    case Uncertain{reason} _:
      Uncertain{reason}
    case _ Uncertain{reason}:
      Uncertain{reason}
    case Valid{} Valid{}:
      Valid{}

def reference_decision(same_id: Bool, same_geometry: Bool) -> Validation:
  Bool.pick(Validation, Bool.and(same_id, Bool.not(same_geometry)), Bad{ConflictingReference{}}, Valid{})

def source_compatibility(a: SourceVertex, b: SourceVertex) -> Validation:
  SourceVertex{ab, av, ap, aa} = a
  SourceVertex{bb, bv, bp, ba} = b
  reference_decision(Bool.and(U32.is_eq(ab, bb), U32.is_eq(av, bv)), Bool.and(vec_equal(ap, bp), R.equal(aa, ba)))

def source_pair(a: Maybe<&2, SourceVertex>, b: Maybe<&2, SourceVertex>) -> Validation:
  match a b:
    case Some{first} Some{last}:
      source_compatibility(first, last)
    case _ _:
      Valid{}

def curve_pair_decision(same: Bool, geometry: Bool, parameters: Bool, first: U32, last: U32) -> Validation:
  match same geometry parameters:
    case False{} _ _:
      Valid{}
    case True{} False{} _:
      Bad{ConflictingReference{}}
    case True{} True{} False{}:
      Uncertain{ParameterConflict{first, last}}
    case True{} True{} True{}:
      Valid{}

def curve_pair(a: Maybe<&2, CurveRef>, b: Maybe<&2, CurveRef>, parameter_a: R.Real, parameter_b: R.Real, first: U32, last: U32) -> Validation:
  match a b:
    case Some{CurveRef{ab, ae, ac, ad}} Some{CurveRef{bb, be, bc, bd}}:
      curve_pair_decision(Bool.and(U32.is_eq(ab, bb), U32.is_eq(ae, be)), Bool.and(curve_equal(ac, bc), domain_equal(ad, bd)), R.equal(parameter_a, parameter_b), first, last)
    case _ _:
      Valid{}

def plane_pair(a: Maybe<&2, PlaneRef>, b: Maybe<&2, PlaneRef>) -> Validation:
  match a b:
    case Some{PlaneRef{ab, af, ao, an}} Some{PlaneRef{bb, bf, bo, bn}}:
      reference_decision(Bool.and(U32.is_eq(ab, bb), U32.is_eq(af, bf)), Bool.and(vec_equal(ao, bo), vec_equal(an, bn)))
    case _ _:
      Valid{}

def events_compatible(duplicate: Bool, +a: JunctionEvent, +b: JunctionEvent) -> Validation:
  match duplicate:
    case True{}:
      Bad{DuplicateEvent{event_key(a)}}
    case False{}:
      curves = curve_pair(event_curve(a), event_curve(b), event_parameter(a), event_parameter(b), event_key(a), event_key(b))
      planes = plane_pair(event_plane(a), event_plane(b))
      sources = source_pair(event_source(a), event_source(b))
      join_validation(curves, join_validation(planes, sources))

def validate_against(+head: JunctionEvent, tail: List<&2, JunctionEvent>) -> Validation:
  match tail:
    case Nil{}:
      Valid{}
    case +other <> rest:
      join_validation(events_compatible(U32.is_eq(event_key(head), event_key(other)), head, other), validate_against(head, rest))

def validate_event_budget(ok: Bool, key: U32, guard: R.Real) -> Validation:
  Bool.pick(Validation, ok, Valid{}, Uncertain{ConstructionBudget{key, guard}})

def validate_events(events: List<&2, JunctionEvent>, +anchor: SourceVertex, +policy: Policy) -> Validation:
  match events:
    case Nil{}:
      Valid{}
    case +head <> +tail:
      JunctionEvent{key, _, _, +guard, _} = head
      budget = validate_event_budget(I.at_most(guard, policy_tolerance(policy)), key, guard)
      source = source_pair(Some{anchor}, event_source(head))
      join_validation(budget, join_validation(source, join_validation(validate_against(head, tail), validate_events(tail, anchor, policy))))

def gap_relation(exact: Bool, inside: Bool, outside: Bool) -> GapRelation:
  match exact inside outside:
    case True{} _ _:
      SameRepresentedPoint{}
    case False{} True{} _:
      WithinTolerance{}
    case False{} False{} True{}:
      OutsideTolerance{}
    case False{} False{} False{}:
      ThresholdBand{}

def make_gap(first: NodeKey, last: NodeKey, +a: G.Vec3, +b: G.Vec3, error_a: R.Real, error_b: R.Real, policy: Policy) -> Gap:
  +delta = G.sub(b, a)
  +distance = I.length(delta)
  +guard = R.add(resolution(a, b), R.add(error_a, error_b))
  +tolerance = policy_tolerance(policy)
  relation = gap_relation(vec_equal(a, b), I.at_most(R.add(distance, guard), tolerance), R.less(tolerance, R.sub(distance, guard)))
  Gap{first, last, delta, distance, guard, tolerance, relation}

def event_gap_pair(a: JunctionEvent, b: JunctionEvent, policy: Policy) -> Gap:
  JunctionEvent{first, point_a, _, error_a, _} = a
  JunctionEvent{last, point_b, _, error_b, _} = b
  make_gap(EventKey{first}, EventKey{last}, point_a, point_b, error_a, error_b, policy)

def event_gaps(+head: JunctionEvent, tail: List<&2, JunctionEvent>, +policy: Policy) -> List<&2, Gap>:
  match tail:
    case Nil{}:
      Nil{}
    case other <> rest:
      event_gap_pair(head, other, policy) <> event_gaps(head, rest, policy)

def all_event_gaps(events: List<&2, JunctionEvent>, +policy: Policy) -> List<&2, Gap>:
  match events:
    case Nil{}:
      Nil{}
    case head <> +tail:
      List.append(&2, Gap, event_gaps(head, tail, policy), all_event_gaps(tail, policy))

def anchor_gap_pair(anchor: SourceVertex, event: JunctionEvent, policy: Policy) -> Gap:
  SourceVertex{body, vertex, original, _} = anchor
  JunctionEvent{key, point, _, guard, _} = event
  make_gap(AnchorKey{body, vertex}, EventKey{key}, original, point, zero(), guard, policy)

def anchor_gaps(+anchor: SourceVertex, events: List<&2, JunctionEvent>, +policy: Policy) -> List<&2, Gap>:
  match events:
    case Nil{}:
      Nil{}
    case head <> tail:
      anchor_gap_pair(anchor, head, policy) <> anchor_gaps(anchor, tail, policy)

def assess_gap(+gap: Gap) -> GapAssessment:
  Gap{_, _, _, distance, _, _, relation} = gap
  match relation:
    case SameRepresentedPoint{}:
      AllWithin{True{}, distance}
    case WithinTolerance{}:
      AllWithin{False{}, distance}
    case OutsideTolerance{}:
      TooFar{gap}
    case ThresholdBand{}:
      UncertainGap{gap}

def join_assessment(a: GapAssessment, b: GapAssessment) -> GapAssessment:
  match a b:
    case TooFar{gap} _:
      TooFar{gap}
    case _ TooFar{gap}:
      TooFar{gap}
    case UncertainGap{gap} _:
      UncertainGap{gap}
    case _ UncertainGap{gap}:
      UncertainGap{gap}
    case AllWithin{exact_a, diameter_a} AllWithin{exact_b, diameter_b}:
      AllWithin{Bool.and(exact_a, exact_b), R.max(diameter_a, diameter_b)}

def assess_gaps(gaps: List<&2, Gap>) -> GapAssessment:
  match gaps:
    case Nil{}:
      AllWithin{True{}, zero()}
    case head <> tail:
      join_assessment(assess_gap(head), assess_gaps(tail))

def plane_check(found: Maybe<&2, PlaneRef>, key: U32, anchor: SourceVertex) -> List<&2, PlaneCheck>:
  match found:
    case None{}:
      Nil{}
    case Some{+plane}:
      [PlaneCheck{key, plane, plane_incidence(plane, source_point(anchor))}]

def plane_checks(+anchor: SourceVertex, events: List<&2, JunctionEvent>) -> List<&2, PlaneCheck>:
  match events:
    case Nil{}:
      Nil{}
    case +head <> tail:
      List.append(&2, PlaneCheck, plane_check(event_plane(head), event_key(head), anchor), plane_checks(anchor, tail))

def finish_assessment(assessment: GapAssessment, +anchor: SourceVertex, +events: List<&2, JunctionEvent>, gaps: List<&2, Gap>, policy: Policy) -> Association:
  match assessment:
    case TooFar{gap}:
      Separated{gap}
    case UncertainGap{gap}:
      Unresolved{Threshold{gap}}
    case AllWithin{exact, diameter}:
      Associated{Junction{anchor, events, gaps, plane_checks(anchor, events), diameter, policy, Bool.pick(Mode, exact, ExactRepresentedPoints{}, ToleratedConnection{})}}

def associate_validated(validation: Validation, +anchor: SourceVertex, +events: List<&2, JunctionEvent>, +policy: Policy) -> Association:
  match validation:
    case Bad{reason}:
      Rejected{reason}
    case Uncertain{reason}:
      Unresolved{reason}
    case Valid{}:
      +gaps = List.append(&2, Gap, anchor_gaps(anchor, events, policy), all_event_gaps(events, policy))
      finish_assessment(assess_gaps(gaps), anchor, events, gaps, policy)

def associate_events(events: List<&2, JunctionEvent>, +anchor: SourceVertex, +policy: Policy) -> Association:
  match events:
    case Nil{}:
      Rejected{NoEvents{}}
    case +head <> +tail:
      associate_validated(validate_events(head <> tail, anchor, policy), anchor, head <> tail, policy)

def associate_prepared(preparation: Preparation, anchor: SourceVertex, policy: Policy) -> Association:
  match preparation:
    case Invalid{reason}:
      Rejected{reason}
    case NotPrepared{reason}:
      Unresolved{reason}
    case Prepared{events}:
      associate_events(events, anchor, policy)

def associate_checked(policy_ok: Bool, source_ok: Bool, anchor: SourceVertex, specs: List<&2, EventSpec>, policy: Policy) -> Association:
  match policy_ok source_ok:
    case False{} _:
      Rejected{InvalidPolicy{}}
    case True{} False{}:
      Rejected{InvalidSource{}}
    case True{} True{}:
      associate_prepared(prepare_events(specs), anchor, policy)

def associate(+anchor: SourceVertex, specs: List<&2, EventSpec>, +policy: Policy) -> Association:
  associate_checked(policy_valid(policy), source_valid(anchor), anchor, specs, policy)

def same_anchor(a: SourceVertex, b: SourceVertex) -> Bool:
  SourceVertex{ab, av, _, _} = a
  SourceVertex{bb, bv, _, _} = b
  Bool.and(U32.is_eq(ab, bb), U32.is_eq(av, bv))

def duplicate_anchor(+anchor: SourceVertex, candidates: List<&2, SourceVertex>) -> Bool:
  match candidates:
    case Nil{}:
      False{}
    case head <> tail:
      Bool.or(same_anchor(anchor, head), duplicate_anchor(anchor, tail))

def selection_result(result: Association) -> AnchorSelection:
  match result:
    case Associated{junction}:
      Unique{junction}
    case Separated{_}:
      NoneFound{}
    case Unresolved{_}:
      UnresolvedSelection{IndeterminateAnchor{}}
    case Rejected{reason}:
      RejectedSelection{reason}

def join_selection(a: AnchorSelection, b: AnchorSelection) -> AnchorSelection:
  match a b:
    case RejectedSelection{reason} _:
      RejectedSelection{reason}
    case _ RejectedSelection{reason}:
      RejectedSelection{reason}
    case UnresolvedSelection{reason} _:
      UnresolvedSelection{reason}
    case _ UnresolvedSelection{reason}:
      UnresolvedSelection{reason}
    case Unique{_} Unique{_}:
      UnresolvedSelection{CompetingAnchors{}}
    case Unique{junction} NoneFound{}:
      Unique{junction}
    case NoneFound{} Unique{junction}:
      Unique{junction}
    case NoneFound{} NoneFound{}:
      NoneFound{}

def choose_step(duplicate: Bool, valid: Bool, anchor: SourceVertex, preparation: Preparation, policy: Policy) -> AnchorSelection:
  match duplicate valid:
    case True{} _:
      RejectedSelection{DuplicateAnchor{}}
    case False{} False{}:
      RejectedSelection{InvalidSource{}}
    case False{} True{}:
      selection_result(associate_prepared(preparation, anchor, policy))

def choose_prepared(anchors: List<&2, SourceVertex>, +preparation: Preparation, +policy: Policy) -> AnchorSelection:
  match anchors:
    case Nil{}:
      NoneFound{}
    case +head <> +tail:
      join_selection(choose_step(duplicate_anchor(head, tail), source_valid(head), head, preparation, policy), choose_prepared(tail, preparation, policy))

def choose_valid(valid: Bool, anchors: List<&2, SourceVertex>, specs: List<&2, EventSpec>, policy: Policy) -> AnchorSelection:
  match valid:
    case False{}:
      RejectedSelection{InvalidPolicy{}}
    case True{}:
      match anchors:
        case Nil{}:
          RejectedSelection{NoAnchors{}}
        case head <> tail:
          choose_prepared(head <> tail, prepare_events(specs), policy)

def choose_anchor(anchors: List<&2, SourceVertex>, specs: List<&2, EventSpec>, +policy: Policy) -> AnchorSelection:
  choose_valid(policy_valid(policy), anchors, specs, policy)
