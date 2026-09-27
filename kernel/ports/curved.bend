import Base
import ../real.bend as R
import ../precise.bend as G
import ../analytic.bend as A
import ../intersections.bend as I
import ../curve-plane.bend as C
import ../face-classification.bend as F
import ../section.bend as Q
import ../face-plane.bend as FP
import ../halfspace.bend as H
import ./types.bend as P
import ./occt.bend as O
import ./curved-edges.bend as E
import ./curved-faces.bend as B
import ./curved-metrics.bend as M
import ./curved-validate.bend as V
import ./curved-retention.bend as RT

# Complete transverse clip of embedded planar/cylindrical bounded solids.
# The section module supplies shared analytic events, but this module splits
# source edges, rebuilds source face regions and caps, and validates solids.
type CanonicalEdges is Data:
  CanonicalEdges{edges: List<&2, A.Edge>, domains: List<&2, F.DomainChoice>}

type Pieces is Data:
  Pieces{valid: Bool, bodies: List<&2, P.Component>}

def zero() -> R.Real:
  R.from_f32(0.0)

def canonical_domain(domain: C.Domain, +scale: R.Real) -> C.Domain:
  match domain:
    case C.Interval{first, last}:
      C.Interval{R.mul(first, scale), R.mul(last, scale)}
    case C.Untrimmed{}:
      C.Untrimmed{}

def canonical_edge(edge: A.Edge, domain: C.Domain, rest: CanonicalEdges) -> CanonicalEdges:
  match edge rest:
    case A.Edge{a, b, A.Line{origin, +direction}, sense} CanonicalEdges{edges, domains}:
      CanonicalEdges{A.Edge{a, b, A.Line{origin, G.normalize(direction)}, sense} <> edges,
        F.GivenDomain{canonical_domain(domain, I.length(direction))} <> domains}
    case _ CanonicalEdges{edges, domains}:
      CanonicalEdges{edge <> edges, F.GivenDomain{domain} <> domains}

def canonical_edges(edges: List<&2, A.Edge>, domains: List<&2, F.DomainChoice>) -> CanonicalEdges:
  match edges domains:
    case head <> tail F.GivenDomain{domain} <> rest:
      canonical_edge(head, domain, canonical_edges(tail, rest))
    case _ _:
      CanonicalEdges{Nil{}, Nil{}}

def canonical_surface(surface: A.Surface) -> A.Surface:
  match surface:
    case A.Plane{origin, normal, _}:
      A.plane(origin, normal)
    case A.Cylinder{origin, axis, x, radius}:
      A.Cylinder{origin, G.normalize(axis), G.normalize(x), radius}
    case _:
      surface

def canonical_faces(faces: List<&2, A.Face>) -> List<&2, A.Face>:
  match faces:
    case Nil{}:
      Nil{}
    case A.Face{surface, sense, loops} <> tail:
      A.Face{canonical_surface(surface), sense, loops} <> canonical_faces(tail)

def canonical_component(canonical: CanonicalEdges, vertices: List<&2, G.Vec3>, faces: List<&2, A.Face>, face_origins: List<&2, P.FaceOrigin>, edge_origins: List<&2, P.EdgeOrigin>) -> P.Component:
  CanonicalEdges{edges, domains} = canonical
  P.Component{A.Solid{vertices, edges, canonical_faces(faces)}, domains, face_origins, edge_origins}

def compacted(compact: H.Compact, +edges: List<&2, A.Edge>, domains: List<&2, F.DomainChoice>, faces: List<&2, A.Face>, face_origins: List<&2, P.FaceOrigin>, edge_origins: List<&2, P.EdgeOrigin>) -> P.Component:
  H.Compact{vertices, map} = compact
  canonical_component(canonical_edges(H.remap_edges(edges, map), domains), vertices, faces, face_origins, edge_origins)

def component(pack: O.EdgePack, vertices: List<&2, G.Vec3>, faces: List<&2, A.Face>, origins: List<&2, P.FaceOrigin>) -> P.Component:
  O.EdgePack{+edges, domains, edge_origins, map} = pack
  compacted(H.compact(vertices, edges, 0, 0), edges, domains, O.remap_faces(faces, map), origins, edge_origins)

def prepend_component(+component: P.Component, tolerance: I.Tolerance, budget: R.Real, rest: Pieces) -> Pieces:
  P.Component{solid, domains, _, _} = component
  Pieces{valid, bodies} = rest
  Pieces{Bool.and(valid, V.valid(V.audit(solid, domains, tolerance, budget))), component <> bodies}

def components(fuel: Nat, +faces: List<&2, A.Face>, +origins: List<&2, P.FaceOrigin>, +graph: E.Graph, +tolerance: I.Tolerance, +budget: R.Real) -> Pieces:
  match fuel faces:
    case _ Nil{}:
      Pieces{True{}, Nil{}}
    case 0n _:
      Pieces{False{}, Nil{}}
    case 1n+left _:
      +mask = H.connectivity_steps(List.length(&2, A.Face, faces), faces, H.connected_seed(faces, True{}))
      +selected = H.selected_faces(faces, mask)
      pack = O.edge_pack(E.edges(graph), E.domains(graph), E.origins(graph), selected, 0, 0)
      body = component(pack, E.vertices(graph), selected, O.selected_origins(origins, mask))
      prepend_component(body, tolerance, budget, components(left, H.selected_faces(faces, O.inverse(mask)), O.selected_origins(origins, O.inverse(mask)), graph, tolerance, budget))

def finish(pieces: Pieces) -> P.Result:
  match pieces:
    case Pieces{False{}, _}:
      P.Unresolved{P.ConstructionFailure{}}
    case Pieces{True{}, Nil{}}:
      P.Empty{}
    case Pieces{True{}, P.Component{solid, domains, face_origins, edge_origins} <> Nil{}}:
      P.Clipped{solid, domains, face_origins, edge_origins}
    case Pieces{True{}, bodies}:
      P.Components{bodies}

def finish_build(build: B.FaceBuild, tolerance: I.Tolerance, budget: R.Real) -> P.Result:
  match build:
    case B.FaceBuild{True{}, E.Graph{True{}, vertices, edges, domains, origins, blocks, roots}, +faces, face_origins}:
      graph : E.Graph = E.Graph{True{}, vertices, edges, domains, origins, blocks, roots}
      finish(components(List.length(&2, A.Face, faces), faces, face_origins, graph, tolerance, budget))
    case _:
      P.Unresolved{P.UnsupportedArrangement{}}

def build_from_graph(+graph: E.Graph, solid: A.Solid, +pieces: List<&2, Q.Piece>, origin: G.Vec3, normal: G.Vec3, +tolerance: I.Tolerance, +budget: R.Real, +resolution: R.Real) -> P.Result:
  A.Solid{_, _, faces} = solid
  +offset = U32.from_nat(List.length(&2, A.Edge, E.edges(graph)))
  state : B.FaceBuild = B.FaceBuild{True{}, E.add_sections(pieces, graph), Nil{}, Nil{}}
  source = B.build_faces(faces, 0, pieces, offset, tolerance, budget, resolution, state)
  finish_build(B.cap(pieces, offset, origin, normal, tolerance, budget, resolution, source), tolerance, budget)

def section_failed(reason: Q.Failure) -> P.Result:
  match reason:
    case Q.FaceContact{_, _}:
      P.Unresolved{P.AmbiguousContact{}}
    case Q.FaceRejected{_, FP.UnsupportedSurface{}}:
      P.Unresolved{P.UnsupportedSurface{}}
    case Q.InvalidInput{}:
      P.Unresolved{P.InvalidInput{}}
    case _:
      P.Unresolved{P.UnsupportedArrangement{}}

def section_result(result: Q.SectionResult, +solid: A.Solid, +domains: List<&2, F.DomainChoice>, +origin: G.Vec3, +normal: G.Vec3, +tolerance: I.Tolerance, +budget: R.Real, +resolution: R.Real) -> P.Result:
  match result:
    case Q.Failed{reason, _}:
      section_failed(reason)
    case Q.Resolved{_, +roots, _, pieces, _, _, _}:
      A.Solid{_, edges, faces} = solid
      +margin = R.add(R.add(budget, I.tolerance_linear(tolerance)), resolution)
      graph = E.split_all(edges, faces, 0, solid, domains, origin, normal, tolerance, budget, roots, margin, E.init(roots, solid, origin, normal, margin))
      build_from_graph(graph, solid, pieces, origin, normal, tolerance, budget, resolution)

def retention_result(disposition: RT.Disposition, +solid: A.Solid, +domains: List<&2, F.DomainChoice>, +origin: G.Vec3, +normal: G.Vec3, +tolerance: I.Tolerance, +budget: R.Real, resolution: R.Real) -> P.Result:
  match disposition:
    case RT.Retained{}:
      RT.keep(solid, domains)
    case RT.Removed{}:
      P.Empty{}
    case RT.Undecided{}:
      section_result(Q.section(solid, domains, origin, normal, tolerance, budget), solid, domains, origin, normal, tolerance, budget, resolution)

def source_checked(valid: Bool, +solid: A.Solid, +domains: List<&2, F.DomainChoice>, +origin: G.Vec3, +normal: G.Vec3, +tolerance: I.Tolerance, +budget: R.Real, +resolution: R.Real) -> P.Result:
  match valid:
    case False{}:
      P.Unresolved{P.InvalidTopology{}}
    case True{}:
      retention_result(RT.classify(solid, domains, origin, normal, tolerance, budget, resolution), solid, domains, origin, normal, tolerance, budget, resolution)

def inputs_checked(valid: Bool, budget_valid: Bool, +solid: A.Solid, +domains: List<&2, F.DomainChoice>, origin: G.Vec3, normal: G.Vec3, +tolerance: I.Tolerance, +budget: R.Real) -> P.Result:
  match valid budget_valid:
    case False{} _:
      P.Unresolved{P.InvalidInput{}}
    case _ False{}:
      P.Unresolved{P.SourceTolerance{}}
    case True{} True{}:
      source_checked(V.valid(V.audit(solid, domains, tolerance, budget)), solid, domains, origin, normal, tolerance, budget, V.resolution(solid))

def clip(+solid: A.Solid, domains: List<&2, F.DomainChoice>, +origin: G.Vec3, +normal: G.Vec3, +tolerance: I.Tolerance, +source_budget: R.Real) -> P.Result:
  valid = Bool.and(I.vec_valid(origin), Bool.and(I.vec_valid(normal), Bool.and(I.direction_valid(normal),
    Bool.and(I.tolerance_valid(tolerance), I.at_most(I.angular_guard(), I.tolerance_angular(tolerance))))))
  inputs_checked(valid, F.valid_budget(source_budget), solid, domains, origin, normal, tolerance, source_budget)

# Companion native contract for exporters: required is the measured maximum
# endpoint/carrier error; allowance is the supplied source budget + guard.
# Query linear tolerance is never added to the construction allowance.
def checked_audit(valid: Bool, audit: V.Audit) -> V.Audit:
  V.Audit{geometry_valid, allowance, required, resolution, volume} = audit
  V.Audit{Bool.and(valid, geometry_valid), allowance, required, resolution, volume}

def audit(solid: A.Solid, domains: List<&2, F.DomainChoice>, +tolerance: I.Tolerance, +source_budget: R.Real) -> V.Audit:
  valid = Bool.and(F.valid_budget(source_budget), Bool.and(I.tolerance_valid(tolerance), I.at_most(I.angular_guard(), I.tolerance_angular(tolerance))))
  checked_audit(valid, V.audit(solid, domains, tolerance, source_budget))

def volume(solid: A.Solid, domains: List<&2, F.DomainChoice>) -> R.Real:
  M.volume(solid, domains)
