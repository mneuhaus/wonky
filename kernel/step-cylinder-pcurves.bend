import Base
import ./real.bend as R
import ./precise.bend as G
import ./analytic.bend as A
import ./intersections.bend as I
import ./curve-plane.bend as C
import ./face-classification.bend as F
import ./cylinder-classification.bend as K
import ./step-pcurves.bend as P
import ./step-cylinder-pcurves-geometry.bend as E
import ./ports/curved-validate.bend as V

# Atomically plan every cylindrical face of an audited body. The host never
# chooses a domain, chart, seam, association order, or approximation.
type PCurve is Data:
  PCurve{edge_index: U32, loop_index: U32, use_index: U32,
    forward: Bool, increasing: Bool, period_lift: R.Real, linear: Bool, curve: E.Spline}

type FaceChart is Data:
  FaceChart{face_index: U32, pcurves: List<&2, PCurve>, closure_bound: R.Real}

type PCurveRef is Data:
  PCurveRef{face_index: U32, pcurve_index: U32}

type AssociationKind is Data:
  Ordinary{}
  Seam{}

type EdgeAssociations is Data:
  EdgeAssociations{edge_index: U32, kind: AssociationKind, associations: List<&2, PCurveRef>}

type CylinderResult is Data:
  Resolved{charts: List<&2, FaceChart>, edges: List<&2, EdgeAssociations>, max_total_bound: R.Real}
  Unresolved{reason: E.Reason, face_index: U32, loop_index: U32, use_index: U32, edge_index: U32}

type Lifted is Data:
  Lifted{edge_index: U32, use_index: U32, forward: Bool, increasing: Bool,
    period_lift: R.Real, trace: E.Trace, support: R.Real, normalization: R.Real, guard: R.Real}

type Walk is Data:
  Walked{uses: List<&2, Lifted>, joint: R.Real}
  BadWalk{reason: E.Reason, use_index: U32, edge_index: U32}

type CurveBuild is Data:
  Curves{curves: List<&2, PCurve>, maximum: R.Real}
  BadCurves{reason: E.Reason, use_index: U32, edge_index: U32}

type Located is Data:
  Located{reference: PCurveRef, pcurve: PCurve}

type Associations is Data:
  Associations{edges: List<&2, EdgeAssociations>}
  BadAssociations{edge_index: U32, reason: E.Reason}

def no_index() -> U32:
  4294967295

def failure(reason: E.Reason) -> CylinderResult:
  Unresolved{reason, no_index(), no_index(), no_index(), no_index()}

# Serialization helpers used by classificationInput; all arithmetic stays here.
def max_budget(values: List<&2, R.Real>, budget: R.Real) -> R.Real:
  F.max_budget(values, budget)

def linear_edge(vertices: List<&2, G.Vec3>, first: U32, last: U32) -> Maybe<&2, A.Edge>:
  F.linear_edge(vertices, first, last)

def increasing(+forward: Bool, sense: Bool) -> Bool:
  Bool.pick(Bool, sense, forward, Bool.not(forward))

def is_line(trace: E.Trace) -> Bool:
  match trace:
    case E.Generator{_, _, _, _, _}:
      True{}
    case _:
      False{}

def nearest_lift(previous: P.UV, start: P.UV) -> R.Real:
  P.UV{u, _} = previous
  P.UV{v, _} = start
  R.from_f32(F32.floor((R.approx(R.div(R.sub(u, v), P.tau())) + 0.5 : F32)))

def close_walk(valid: Bool, joint: R.Real) -> Walk:
  Bool.pick(Walk, valid, Walked{Nil{}, joint}, BadWalk{E.ChartClosure{}, no_index(), no_index()})

def prepend_walk(rest: Walk, one: Lifted) -> Walk:
  match rest:
    case Walked{uses, joint}:
      Walked{one <> uses, joint}
    case BadWalk{reason, use_index, edge_index}:
      BadWalk{reason, use_index, edge_index}

def prepare_one(preparation: E.Preparation, edge: F.PreparedEdge, +use_index: U32, rest: Walk) -> Walk:
  match preparation edge:
    case E.Rejected{reason} F.PreparedEdge{edge_index, _, _, _, _, _}:
      BadWalk{reason, use_index, edge_index}
    case E.Ready{trace, support, normalization, guard} F.PreparedEdge{edge_index, A.Edge{_, _, _, sense}, _, _, _, +forward}:
      one = {Lifted{edge_index, use_index, forward, increasing(forward, sense), P.zero(), trace, support, normalization, guard} : Lifted}
      prepend_walk(rest, one)

def prepare_edges(edges: List<&2, F.PreparedEdge>, +index: U32, +surface: A.Surface, +budget: R.Real) -> Walk:
  match edges:
    case Nil{}:
      Walked{Nil{}, P.zero()}
    case +head <> tail:
      prepare_one(E.prepare(head, surface, budget), head, index, prepare_edges(tail, (index + 1 : U32), surface, budget))

def walk(uses: List<&2, Lifted>, +initial: Bool, +seed: P.UV, +previous: P.UV,
  +joint: R.Real, +radius: R.Real, +budget: R.Real) -> Walk:
  match uses:
    case Nil{}:
      +closure = E.distance(previous, seed, radius)
      close_walk(Bool.and(Bool.not(initial), I.at_most(closure, budget)), R.max(joint, closure))
    case Lifted{+edge_index, +use_index, forward, +direction, _, +trace, support, normalization, guard} <> tail:
      +turns = Bool.pick(R.Real, initial, P.zero(), nearest_lift(previous, E.endpoint(trace, direction, True{})))
      +lifted = E.shift(trace, turns)
      +start = E.endpoint(lifted, direction, True{})
      +gap = Bool.pick(R.Real, initial, P.zero(), E.distance(previous, start, radius))
      next_seed = Bool.pick(P.UV, initial, start, seed)
      one = {Lifted{edge_index, use_index, forward, direction, turns, lifted, support, normalization, guard} : Lifted}
      rest = walk(tail, False{}, next_seed, E.endpoint(lifted, direction, False{}), R.max(joint, gap), radius, budget)
      valid = Bool.and(I.at_most(R.abs(turns), R.from_f32(16.0)), I.at_most(gap, budget))
      Bool.pick(Walk, valid, prepend_walk(rest, one), BadWalk{E.AmbiguousLift{}, use_index, edge_index})

def walk_ready(prepared: Walk, radius: R.Real, budget: R.Real) -> Walk:
  match prepared:
    case BadWalk{reason, ui, ei}:
      BadWalk{reason, ui, ei}
    case Walked{uses, _}:
      walk(uses, True{}, P.UV{P.zero(), P.zero()}, P.UV{P.zero(), P.zero()}, P.zero(), radius, budget)

def prepend_curves(built: E.Construction, rest: CurveBuild, edge_index: U32, use_index: U32,
  forward: Bool, direction: Bool, turns: R.Real, linear: Bool) -> CurveBuild:
  match built rest:
    case E.Failed{reason} _:
      BadCurves{reason, use_index, edge_index}
    case _ BadCurves{reason, ui, ei}:
      BadCurves{reason, ui, ei}
    case E.Built{+curve} Curves{curves, maximum}:
      Curves{PCurve{edge_index, 0, use_index, forward, direction, turns, linear, curve} <> curves, R.max(E.total(curve), maximum)}

def build_curves(uses: List<&2, Lifted>, +joint: R.Real, +budget: R.Real) -> CurveBuild:
  match uses:
    case Nil{}:
      Curves{Nil{}, P.zero()}
    case Lifted{ei, ui, forward, direction, turns, +trace, support, normalization, guard} <> tail:
      prepend_curves(E.construct(trace, R.add(support, joint), normalization, guard, budget), build_curves(tail, joint, budget),
        ei, ui, forward, direction, turns, is_line(trace))

def face_built(built: CurveBuild, face_index: U32, joint: R.Real) -> CylinderResult:
  match built:
    case BadCurves{reason, use_index, edge_index}:
      Unresolved{reason, face_index, 0, use_index, edge_index}
    case Curves{curves, maximum}:
      Resolved{[FaceChart{face_index, curves, joint}], Nil{}, maximum}

def face_walk(walked: Walk, face_index: U32, budget: R.Real) -> CylinderResult:
  match walked:
    case BadWalk{reason, use_index, edge_index}:
      Unresolved{reason, face_index, 0, use_index, edge_index}
    case Walked{uses, +joint}:
      face_built(build_curves(uses, joint, budget), face_index, joint)

def preparation_reason(reason: F.Reason) -> E.Reason:
  match reason:
    case F.InputGap{}:
      E.IncidenceFailure{}
    case F.InvalidInput{}:
      E.InvalidInput{}
    case F.InvalidIndex{}:
      E.InvalidSource{}
    case _:
      E.UnsupportedDomain{}

def face_prepared(preparation: F.EdgePreparation, face_index: U32, surface: A.Surface, radius: R.Real, +budget: R.Real) -> CylinderResult:
  match preparation:
    case F.BadEdges{reason}:
      Unresolved{preparation_reason(reason), face_index, 0, no_index(), no_index()}
    case F.PreparedEdges{edges}:
      face_walk(walk_ready(prepare_edges(edges, 0, surface, budget), radius, budget), face_index, budget)

def face_loops(loops: List<&2, A.Loop>, face_index: U32, vertices: List<&2, G.Vec3>, edges: List<&2, A.Edge>,
  domains: List<&2, F.DomainChoice>, +surface: A.Surface, origin: G.Vec3, axis: G.Vec3, +radius: R.Real, +budget: R.Real) -> CylinderResult:
  match loops:
    case A.Loop{True{}, uses} <> Nil{}:
      face_prepared(K.prepare_uses(uses, vertices, edges, domains, origin, axis, radius, budget), face_index, surface, radius, budget)
    case _:
      Unresolved{E.UnsupportedLoops{}, face_index, no_index(), no_index(), no_index()}

def face_surface(+surface: A.Surface, loops: List<&2, A.Loop>, +face_index: U32, vertices: List<&2, G.Vec3>, edges: List<&2, A.Edge>,
  domains: List<&2, F.DomainChoice>, +budget: R.Real) -> CylinderResult:
  match surface:
    case A.Plane{_, _, _}:
      Resolved{Nil{}, Nil{}, P.zero()}
    case A.Cylinder{+origin, +axis, x, +radius}:
      valid = Bool.and(C.frame_valid(axis, x), R.less(R.mul(budget, R.from_f32(4.0)), radius))
      Bool.pick(CylinderResult, valid, face_loops(loops, face_index, vertices, edges, domains, surface, origin, axis, radius, budget),
        Unresolved{E.ResolutionLimit{}, face_index, no_index(), no_index(), no_index()})
    case _:
      Unresolved{E.UnsupportedSurface{}, face_index, no_index(), no_index(), no_index()}

def face_chart(face: A.Face, face_index: U32, vertices: List<&2, G.Vec3>, edges: List<&2, A.Edge>,
  domains: List<&2, F.DomainChoice>, budget: R.Real) -> CylinderResult:
  A.Face{surface, _, loops} = face
  face_surface(surface, loops, face_index, vertices, edges, domains, budget)

def join_faces(one: CylinderResult, rest: CylinderResult) -> CylinderResult:
  match one rest:
    case Unresolved{reason, fi, li, ui, ei} _:
      Unresolved{reason, fi, li, ui, ei}
    case _ Unresolved{reason, fi, li, ui, ei}:
      Unresolved{reason, fi, li, ui, ei}
    case Resolved{a, _, am} Resolved{b, _, bm}:
      Resolved{List.append(&2, FaceChart, a, b), Nil{}, R.max(am, bm)}

def faces(remaining: List<&2, A.Face>, +index: U32, +vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>,
  +domains: List<&2, F.DomainChoice>, +budget: R.Real) -> CylinderResult:
  match remaining:
    case Nil{}:
      Resolved{Nil{}, Nil{}, P.zero()}
    case head <> tail:
      join_faces(face_chart(head, index, vertices, edges, domains, budget), faces(tail, (index + 1 : U32), vertices, edges, domains, budget))

def locate_curves(curves: List<&2, PCurve>, +face_index: U32, +index: U32, +edge_index: U32) -> List<&2, Located>:
  match curves:
    case Nil{}:
      Nil{}
    case +head <> tail:
      PCurve{ei, _, _, _, _, _, _, _} = head
      +rest = locate_curves(tail, face_index, (index + 1 : U32), edge_index)
      Bool.pick(List<&2, Located>, U32.is_eq(ei, edge_index), Located{PCurveRef{face_index, index}, head} <> rest, rest)

def locate(charts: List<&2, FaceChart>, +edge_index: U32) -> List<&2, Located>:
  match charts:
    case Nil{}:
      Nil{}
    case FaceChart{face_index, curves, _} <> tail:
      List.append(&2, Located, locate_curves(curves, face_index, 0, edge_index), locate(tail, edge_index))

def seam_valid(a: PCurve, b: PCurve) -> Bool:
  PCurve{_, _, _, af, ad, at, al, _} = a
  PCurve{_, _, _, bf, bd, bt, bl, _} = b
  opposite = Bool.and(increasing(af, Bool.not(bf)), increasing(ad, Bool.not(bd)))
  period = I.at_most(R.abs(R.sub(R.abs(R.sub(at, bt)), P.one())), P.zero())
  Bool.and(Bool.and(al, bl), Bool.and(opposite, period))

def curve_turns(curve: PCurve) -> R.Real:
  PCurve{_, _, _, _, _, turns, _, _} = curve
  turns

def located_face(value: Located) -> U32:
  Located{PCurveRef{face_index, _}, _} = value
  face_index

def pair_association(same_face: Bool, +edge_index: U32, a: Located, b: Located) -> Associations:
  Located{+ar, +ap} = a
  Located{+br, +bp} = b
  +refs = Bool.pick(List<&2, PCurveRef>, R.less(curve_turns(ap), curve_turns(bp)), [ar, br], [br, ar])
  Bool.pick(Associations, same_face,
    Bool.pick(Associations, seam_valid(ap, bp), Associations{[EdgeAssociations{edge_index, Seam{}, refs}]}, BadAssociations{edge_index, E.UnsupportedSeam{}}),
    Associations{[EdgeAssociations{edge_index, Ordinary{}, [ar, br]}]})

def association(found: List<&2, Located>, +edge_index: U32) -> Associations:
  match found:
    case Nil{}:
      Associations{Nil{}}
    case Located{reference, _} <> Nil{}:
      Associations{[EdgeAssociations{edge_index, Ordinary{}, [reference]}]}
    case +a <> +b <> Nil{}:
      pair_association(U32.is_eq(located_face(a), located_face(b)), edge_index, a, b)
    case _:
      BadAssociations{edge_index, E.AssociationLimit{}}

def join_associations(a: Associations, b: Associations) -> Associations:
  match a b:
    case BadAssociations{index, reason} _:
      BadAssociations{index, reason}
    case _ BadAssociations{index, reason}:
      BadAssociations{index, reason}
    case Associations{x} Associations{y}:
      Associations{List.append(&2, EdgeAssociations, x, y)}

def edge_associations(edges: List<&2, A.Edge>, +index: U32, +charts: List<&2, FaceChart>) -> Associations:
  match edges:
    case Nil{}:
      Associations{Nil{}}
    case _ <> tail:
      join_associations(association(locate(charts, index), index), edge_associations(tail, (index + 1 : U32), charts))

def assembled(associations: Associations, charts: List<&2, FaceChart>, maximum: R.Real) -> CylinderResult:
  match associations:
    case BadAssociations{index, reason}:
      Unresolved{reason, no_index(), no_index(), no_index(), index}
    case Associations{edges}:
      Resolved{charts, edges, maximum}

def associate(result: CylinderResult, edges: List<&2, A.Edge>) -> CylinderResult:
  match result:
    case Unresolved{reason, fi, li, ui, ei}:
      Unresolved{reason, fi, li, ui, ei}
    case Resolved{+charts, _, maximum}:
      assembled(edge_associations(edges, 0, charts), charts, maximum)

def source_ready(solid: A.Solid, domains: List<&2, F.DomainChoice>, budget: R.Real) -> CylinderResult:
  A.Solid{vertices, +edges, fs} = solid
  associate(faces(fs, 0, vertices, edges, domains, budget), edges)

def source_checked(valid: Bool, solid: A.Solid, domains: List<&2, F.DomainChoice>, budget: R.Real) -> CylinderResult:
  match valid:
    case False{}:
      failure(E.InvalidSource{})
    case True{}:
      source_ready(solid, domains, budget)

def domain_valid(choice: F.DomainChoice, edge: A.Edge) -> Bool:
  match choice edge:
    case F.AutoDomain{} _:
      True{}
    case F.GivenDomain{C.Untrimmed{}} A.Edge{ei, ej, curve, _}:
      Bool.and(C.curve_periodic(curve), U32.is_eq(ei, ej))
    case F.GivenDomain{C.Interval{+a, +b}} A.Edge{_, _, +curve, _}:
      Bool.and(C.domain_valid(C.Interval{a, b}, C.curve_periodic(curve)),
        Bool.or(Bool.not(C.curve_periodic(curve)), R.less(R.sub(b, a), R.sub(P.tau(), I.angular_guard()))))

def domains_valid(domains: List<&2, F.DomainChoice>, edges: List<&2, A.Edge>) -> Bool:
  match domains edges:
    case Nil{} Nil{}:
      True{}
    case a <> at b <> bt:
      Bool.and(domain_valid(a, b), domains_valid(at, bt))
    case _ _:
      False{}

def domains_checked(valid: Bool, +solid: A.Solid, +domains: List<&2, F.DomainChoice>, tolerance: I.Tolerance, source: R.Real, budget: R.Real) -> CylinderResult:
  match valid:
    case False{}:
      failure(E.UnsupportedDomain{})
    case True{}:
      source_checked(V.valid(V.audit(solid, domains, tolerance, source)), solid, domains, budget)

def solid_edges(solid: A.Solid) -> List<&2, A.Edge>:
  A.Solid{_, edges, _} = solid
  edges

def input_solid(+solid: A.Solid, +domains: List<&2, F.DomainChoice>, tolerance: I.Tolerance, source: R.Real, budget: R.Real) -> CylinderResult:
  valid_domains = Bool.or(U32.is_eq(U32.from_nat(List.length(&2, F.DomainChoice, domains)), 0), domains_valid(domains, solid_edges(solid)))
  domains_checked(valid_domains, solid, domains, tolerance, source, budget)

def input_checked(valid: Bool, solid: A.Solid, domains: List<&2, F.DomainChoice>, tolerance: I.Tolerance, source: R.Real, budget: R.Real) -> CylinderResult:
  match valid:
    case False{}:
      failure(E.InvalidInput{})
    case True{}:
      input_solid(solid, domains, tolerance, source, budget)

def for_cylinders_domains(+solid: A.Solid, +domains: List<&2, F.DomainChoice>, +tolerance: I.Tolerance, +source_budget: R.Real, +budget: R.Real) -> CylinderResult:
  valid = Bool.and(I.tolerance_valid(tolerance), Bool.and(I.at_most(I.angular_guard(), I.tolerance_angular(tolerance)),
    Bool.and(F.valid_budget(source_budget), Bool.and(I.scalar_valid(budget), Bool.and(R.less(P.zero(), budget), I.at_most(budget, P.maximum_budget()))))))
  input_checked(valid, solid, domains, tolerance, source_budget, budget)
