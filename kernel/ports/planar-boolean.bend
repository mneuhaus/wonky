import Base
import ../real.bend as R
import ../precise.bend as G
import ../analytic.bend as A
import ../intersections.bend as I
import ../face-classification.bend as F
import ../solid-classification.bend as S
import ../halfspace.bend as H
import ./types.bend as P
import ./occt-planar.bend as V
import ./truck-topology.bend as L
import ./curved-validate.bend as CV
import ./curved-contact-topology.bend as CT
import ./planar-boolean-arrangement.bend as D
import ./planar-boolean-selection.bend as Q
import ./planar-boolean-provenance.bend as O
import ./planar-boolean-types.bend as T

# Complete planar UNION or SUBTRACTION by a shared plane arrangement. The admitted source
# is an embedded oriented plane/line boundary with single outer-loop faces.
# Local validation is not a new proof of global source embeddedness.
def zero() -> R.Real:
  R.from_f32(0.0)

def indexed_faces(faces: List<&2, A.Face>, +index: U32) -> List<&2, P.FaceOrigin>:
  match faces:
    case Nil{}:
      Nil{}
    case _ <> tail:
      P.SourceFace{index} <> indexed_faces(tail, (index + 1 : U32))

def indexed_edges(edges: List<&2, A.Edge>, +index: U32) -> List<&2, P.EdgeOrigin>:
  match edges:
    case Nil{}:
      Nil{}
    case _ <> tail:
      P.SourceEdge{index} <> indexed_edges(tail, (index + 1 : U32))

def add_body(built: T.Result, rest: T.Result) -> T.Result:
  match built rest:
    case T.Unresolved{reason, stage, detail, budget, stats} _:
      T.Unresolved{reason, stage, detail, budget, stats}
    case _ T.Unresolved{reason, stage, detail, budget, stats}:
      T.Unresolved{reason, stage, detail, budget, stats}
    case T.Bodies{a, budget, stats} T.Bodies{b, _, _}:
      T.Bodies{List.append(&2, T.Body, a, b), budget, stats}

def mapped_edges(map: O.EdgeMap, solid: A.Solid, domains: List<&2, F.DomainChoice>, origins: List<&2, T.FaceOrigin>, stats: T.Stats) -> T.Result:
  match map:
    case O.EdgeMap{False{}, _}:
      T.rejected(P.ConstructionFailure{}, 9, 0, stats)
    case O.EdgeMap{True{}, edges}:
      T.Bodies{[T.Body{solid, domains, origins, edges}], zero(), stats}

def audited_component(valid: Bool, +solid: A.Solid, +domains: List<&2, F.DomainChoice>, +origins: List<&2, T.FaceOrigin>, context: O.Context, stats: T.Stats) -> T.Result:
  match valid:
    case False{}:
      T.rejected(P.ConstructionFailure{}, 8, 0, stats)
    case True{}:
      A.Solid{vertices, +edges, faces} = solid
      map = O.edges(edges, vertices, faces, origins, context, 0)
      mapped_edges(map, solid, domains, origins, stats)

def audit_component(+solid: A.Solid, +domains: List<&2, F.DomainChoice>, origins: List<&2, T.FaceOrigin>, +context: O.Context, stats: T.Stats) -> T.Result:
  O.Context{_, _, _, _, tolerance, resolution, _} = context
  audit = CV.valid(CV.audit(solid, domains, tolerance, zero()))
  valid = Bool.and(audit, Bool.and(V.valid(solid, domains, resolution), CT.valid(solid)))
  audited_component(valid, solid, domains, origins, context, stats)

def cavity_checked(cavity: Bool, solid: A.Solid, domains: List<&2, F.DomainChoice>, origins: List<&2, T.FaceOrigin>, context: O.Context, stats: T.Stats) -> T.Result:
  match cavity:
    case True{}:
      # Connected inner shells need explicit body nesting and STEP void roles.
      # Reject the entire result; never publish just the positive components.
      T.rejected(P.UnsupportedArrangement{}, 10, 0, stats)
    case False{}:
      audit_component(solid, domains, origins, context, stats)

def prepared_component(component: P.Component, all: List<&2, T.FaceOrigin>, +context: O.Context, stats: T.Stats) -> T.Result:
  P.Component{A.Solid{+vertices, +edges, faces}, _, sources, _} = component
  O.Context{_, _, _, _, _, _, subtraction} = context
  +origins = O.component_faces(sources, all)
  +solid = {A.Solid{vertices, edges, O.original_carriers(faces, origins, context)} : A.Solid}
  cavity = Bool.and(subtraction, R.less(V.volume(solid), zero()))
  cavity_checked(cavity, solid, O.domains(edges, vertices), origins, context, stats)

def components(values: List<&2, P.Component>, +all: List<&2, T.FaceOrigin>, +context: O.Context, +stats: T.Stats) -> T.Result:
  match values:
    case Nil{}:
      T.Bodies{Nil{}, zero(), stats}
    case value <> tail:
      add_body(prepared_component(value, all, context, stats), components(tail, all, context, stats))

def closed(valid: Bool, vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>, +faces: List<&2, A.Face>, origins: List<&2, T.FaceOrigin>, context: O.Context, stats: T.Stats) -> T.Result:
  match valid:
    case False{}:
      T.rejected(P.ConstructionFailure{}, 7, 0, stats)
    case True{}:
      records = L.records(faces, indexed_faces(faces, 0))
      parts = L.components(List.length(&2, A.Face, faces), records, vertices, edges, indexed_edges(edges, 0))
      components(parts, origins, context, stats)

def built(result: H.BuildState, vertices: List<&2, G.Vec3>, origins: List<&2, T.FaceOrigin>, context: O.Context, stats: T.Stats) -> T.Result:
  H.BuildState{+edges, +faces} = result
  # Pairing is by global vertex IDs only. A mismatched subdivision/T-junction
  # cannot be repaired here; an unpaired edge rejects the whole operation.
  closed(S.edges_closed(edges, faces, 0), vertices, edges, faces, origins, context, stats)

def owned(map: O.FaceMap, polygons: List<&2, H.Polygon>, +vertices: List<&2, G.Vec3>, context: O.Context, stats: T.Stats) -> T.Result:
  match map:
    case O.FaceMap{False{}, _}:
      T.rejected(P.UnsupportedArrangement{}, 6, 0, stats)
    case O.FaceMap{True{}, origins}:
      built(H.build_polygons(polygons, vertices, H.BuildState{Nil{}, Nil{}}), vertices, origins, context, stats)

def boundary(result: Q.Boundary, +vertices: List<&2, G.Vec3>, +context: O.Context, stats: T.Stats) -> T.Result:
  match result stats:
    case Q.Boundary{False{}, _, _} _:
      T.rejected(P.ConstructionFailure{}, 5, 0, stats)
    case Q.Boundary{True{}, +polygons, internal} T.Stats{planes, cells, selected, shared, _, _}:
      count = U32.from_nat(List.length(&2, H.Polygon, polygons))
      next_stats = {T.Stats{planes, cells, selected, shared, count, internal} : T.Stats}
      owned(O.faces(polygons, vertices, context), polygons, vertices, context, next_stats)

def selected(result: Q.Selection, vertices: List<&2, G.Vec3>, context: O.Context, stats: T.Stats) -> T.Result:
  match result stats:
    case Q.Failed{reason, stage, index} _:
      T.rejected(reason, stage, index, stats)
    case Q.Selection{+polygons, count} T.Stats{planes, cells, _, shared, _, _}:
      result = Q.boundary(List.length(&2, H.Polygon, polygons), Q.Boundary{True{}, Nil{}, 0}, Q.Pairing{0, True{}, polygons}, None{})
      boundary(result, vertices, context, T.Stats{planes, cells, count, shared, 0, 0})

def arranged(result: D.Arrangement, +context: O.Context) -> T.Result:
  match result:
    case D.Failed{reason, stage}:
      T.rejected(reason, 2, stage, T.empty_stats())
    case D.Arrangement{+vertices, +cells, planes}:
      O.Context{first, ad, second, bd, tolerance, resolution, subtraction} = context
      +count = List.length(&2, D.Cell, cells)
      stats = {T.Stats{planes, U32.from_nat(count), 0, U32.from_nat(List.length(&2, G.Vec3, vertices)), 0, 0} : T.Stats}
      result = Q.select(count, cells, count, vertices, first, ad, second, bd, tolerance, resolution, 0, subtraction)
      selected(result, vertices, context, stats)

def plane_limit(within: Bool, planes: List<&2, A.Surface>, +vertices: List<&2, G.Vec3>, +resolution: R.Real, context: O.Context) -> T.Result:
  match within:
    case False{}:
      T.rejected(P.ResolutionLimit{}, 1, 32, T.empty_stats())
    case True{}:
      arranged(D.arrange(planes, D.initial(vertices, resolution), resolution, 0), context)

def construct(+first: A.Solid, ad: List<&2, F.DomainChoice>, +second: A.Solid, bd: List<&2, F.DomainChoice>, tolerance: I.Tolerance, +resolution: R.Real, subtraction: Bool) -> T.Result:
  A.Solid{av, _, af} = first
  A.Solid{bv, _, bf} = second
  vertices = List.append(&2, G.Vec3, av, bv)
  +planes = D.unique_planes(List.append(&2, A.Face, af, bf), Nil{})
  context = {O.Context{first, ad, second, bd, tolerance, resolution, subtraction} : O.Context}
  plane_limit(U32.is_lt(U32.from_nat(List.length(&2, A.Surface, planes)), 33), planes, vertices, resolution, context)

def source_size(solid: A.Solid) -> Bool:
  A.Solid{vertices, edges, faces} = solid
  Bool.and(U32.is_lt(U32.from_nat(List.length(&2, G.Vec3, vertices)), 257),
    Bool.and(U32.is_lt(U32.from_nat(List.length(&2, A.Edge, edges)), 513), U32.is_lt(U32.from_nat(List.length(&2, A.Face, faces)), 257)))

def family(solid: A.Solid) -> Bool:
  A.Solid{_, edges, +faces} = solid
  Bool.and(V.line_edges(edges), Bool.and(V.plane_faces(faces), V.single_faces(faces)))

def source_valid(+solid: A.Solid, +domains: List<&2, F.DomainChoice>, tolerance: I.Tolerance, resolution: R.Real) -> Bool:
  Bool.and(V.valid(solid, domains, resolution), Bool.and(CT.valid(solid), CV.valid(CV.audit(solid, domains, tolerance, zero()))))

def sources_checked(valid: Bool, first: A.Solid, ad: List<&2, F.DomainChoice>, second: A.Solid, bd: List<&2, F.DomainChoice>, tolerance: I.Tolerance, resolution: R.Real, subtraction: Bool) -> T.Result:
  match valid:
    case False{}:
      T.rejected(P.InvalidTopology{}, 1, 0, T.empty_stats())
    case True{}:
      construct(first, ad, second, bd, tolerance, resolution, subtraction)

def resolution_checked(valid: Bool, +first: A.Solid, +ad: List<&2, F.DomainChoice>, +second: A.Solid, +bd: List<&2, F.DomainChoice>, +tolerance: I.Tolerance, +resolution: R.Real, subtraction: Bool) -> T.Result:
  match valid:
    case False{}:
      T.rejected(P.ResolutionLimit{}, 1, 0, T.empty_stats())
    case True{}:
      sources_checked(Bool.and(source_valid(first, ad, tolerance, resolution), source_valid(second, bd, tolerance, resolution)), first, ad, second, bd, tolerance, resolution, subtraction)

def family_checked(valid: Bool, +first: A.Solid, ad: List<&2, F.DomainChoice>, +second: A.Solid, bd: List<&2, F.DomainChoice>, +tolerance: I.Tolerance, subtraction: Bool) -> T.Result:
  match valid:
    case False{}:
      T.rejected(P.UnsupportedArrangement{}, 1, 0, T.empty_stats())
    case True{}:
      +resolution = R.max(CV.resolution(first), CV.resolution(second))
      enough = R.less(resolution, I.tolerance_linear(tolerance))
      resolution_checked(enough, first, ad, second, bd, tolerance, resolution, subtraction)

def budget_checked(zero_budgets: Bool, +first: A.Solid, ad: List<&2, F.DomainChoice>, +second: A.Solid, bd: List<&2, F.DomainChoice>, tolerance: I.Tolerance, subtraction: Bool) -> T.Result:
  match zero_budgets:
    case False{}:
      T.rejected(P.SourceTolerance{}, 0, 0, T.empty_stats())
    case True{}:
      allowed = Bool.and(Bool.and(family(first), family(second)), Bool.and(source_size(first), source_size(second)))
      family_checked(allowed, first, ad, second, bd, tolerance, subtraction)

def input_checked(valid: Bool, first: A.Solid, ad: List<&2, F.DomainChoice>, ab: R.Real, second: A.Solid, bd: List<&2, F.DomainChoice>, bb: R.Real, tolerance: I.Tolerance, subtraction: Bool) -> T.Result:
  match valid:
    case False{}:
      T.rejected(P.InvalidInput{}, 0, 0, T.empty_stats())
    case True{}:
      budget_checked(Bool.and(R.equal(ab, zero()), R.equal(bb, zero())), first, ad, second, bd, tolerance, subtraction)

def operate(first: A.Solid, ad: List<&2, F.DomainChoice>, +ab: R.Real, second: A.Solid, bd: List<&2, F.DomainChoice>, +bb: R.Real, +tolerance: I.Tolerance, subtraction: Bool) -> T.Result:
  valid = Bool.and(Bool.and(F.valid_budget(ab), F.valid_budget(bb)), Bool.and(I.tolerance_valid(tolerance), I.at_most(I.angular_guard(), I.tolerance_angular(tolerance))))
  input_checked(valid, first, ad, ab, second, bd, bb, tolerance, subtraction)

def union(first: A.Solid, ad: List<&2, F.DomainChoice>, ab: R.Real, second: A.Solid, bd: List<&2, F.DomainChoice>, bb: R.Real, tolerance: I.Tolerance) -> T.Result:
  operate(first, ad, ab, second, bd, bb, tolerance, False{})

def subtract(first: A.Solid, ad: List<&2, F.DomainChoice>, ab: R.Real, second: A.Solid, bd: List<&2, F.DomainChoice>, bb: R.Real, tolerance: I.Tolerance) -> T.Result:
  operate(first, ad, ab, second, bd, bb, tolerance, True{})
