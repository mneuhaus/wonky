import Base
import ../real.bend as R
import ../precise.bend as G
import ../analytic.bend as A
import ../topology.bend as T
import ../intersections.bend as I
import ../curve-plane.bend as C
import ../edge-plane.bend as E
import ../face-classification.bend as F
import ../cylinder-classification.bend as K
import ../face-plane.bend as FP
import ../solid-classification.bend as S
import ../halfspace.bend as H
import ./curved-metrics.bend as M

type Audit is Data:
  Audit{valid: Bool, allowance: R.Real, required: R.Real, resolution: R.Real, volume: R.Real}

def zero() -> R.Real:
  R.from_f32(0.0)

def face_scale(faces: List<&2, A.Face>, +scale: R.Real) -> R.Real:
  match faces:
    case Nil{}:
      scale
    case A.Face{+surface, _, _} <> tail:
      face_scale(tail, R.max(scale, R.max(I.magnitude(FP.surface_origin(surface)), FP.surface_size(surface))))

def resolution(solid: A.Solid) -> R.Real:
  A.Solid{vertices, edges, faces} = solid
  R.mul(I.angular_guard(), face_scale(faces, F.edges_scale(edges, H.vertex_scale(vertices, R.from_f32(1.0)))))

def prepared_valid(prepared: E.EdgePreparation) -> Bool:
  match prepared:
    case E.Prepared{_}:
      True{}
    case _:
      False{}

def edge_required(prepared: E.EdgePreparation) -> R.Real:
  match prepared:
    case E.Prepared{E.EdgeSource{_, _, _, _, _, _, gap, _}}:
      gap
    case _:
      I.limit()

def next_domain(domains: List<&2, F.DomainChoice>) -> Maybe<&2, F.DomainChoice>:
  match domains:
    case Nil{}:
      None{}
    case domain <> _:
      Some{domain}

def rest_domains(domains: List<&2, F.DomainChoice>) -> List<&2, F.DomainChoice>:
  match domains:
    case Nil{}:
      Nil{}
    case _ <> rest:
      rest

# Edges and their domains in lockstep, tail recursive (linear, and bounded
# stack on the JS target); required is the running maximum.
def edges_required(edges: List<&2, A.Edge>, +domains: List<&2, F.DomainChoice>, +vertices: List<&2, G.Vec3>, +index: U32, +tolerance: I.Tolerance, +budget: R.Real, +required: R.Real) -> R.Real:
  match edges:
    case Nil{}:
      required
    case edge <> tail:
      prepared = E.prepare_edge(Some{edge}, index, vertices, F.choose_domain(next_domain(domains)), H.vertex(vertices, 0), tolerance, budget)
      edges_required(tail, rest_domains(domains), vertices, (index + 1 : U32), tolerance, budget, R.max(edge_required(prepared), required))

def carrier_error(surface: A.Surface, +curve: A.Curve, +domain: C.Domain) -> R.Real:
  match surface:
    case A.Plane{origin, normal, _}:
      F.plane_error(C.curve_periodic(curve), domain, C.coefficients(curve, origin, normal))
    case A.Cylinder{origin, axis, _, radius}:
      K.curve_incidence(curve, domain, origin, G.normalize(axis), radius)
    case _:
      I.limit()

def edge_carrier(+edge: A.Edge, index: U32, surface: A.Surface, domains: List<&2, F.DomainChoice>, vertices: List<&2, G.Vec3>) -> R.Real:
  A.Edge{_, _, curve, _} = edge
  carrier_error(surface, curve, M.edge_domain(edge, index, domains, vertices))

def use_required(use: T.Coedge, surface: A.Surface, edges: List<&2, A.Edge>, domains: List<&2, F.DomainChoice>, vertices: List<&2, G.Vec3>) -> R.Real:
  T.Use{+index, _} = use
  edge = H.edge(List.get(&2, A.Edge, edges, U32.to_nat(index)))
  edge_carrier(edge, index, surface, domains, vertices)

def uses_required(uses: List<&2, T.Coedge>, +surface: A.Surface, +edges: List<&2, A.Edge>, +domains: List<&2, F.DomainChoice>, +vertices: List<&2, G.Vec3>) -> R.Real:
  match uses:
    case Nil{}:
      zero()
    case head <> tail:
      R.max(use_required(head, surface, edges, domains, vertices), uses_required(tail, surface, edges, domains, vertices))

def loops_required(loops: List<&2, A.Loop>, +surface: A.Surface, +edges: List<&2, A.Edge>, +domains: List<&2, F.DomainChoice>, +vertices: List<&2, G.Vec3>) -> R.Real:
  match loops:
    case Nil{}:
      zero()
    case A.Loop{_, uses} <> tail:
      R.max(uses_required(uses, surface, edges, domains, vertices), loops_required(tail, surface, edges, domains, vertices))

def faces_required(faces: List<&2, A.Face>, +edges: List<&2, A.Edge>, +domains: List<&2, F.DomainChoice>, +vertices: List<&2, G.Vec3>) -> R.Real:
  match faces:
    case Nil{}:
      zero()
    case A.Face{surface, _, loops} <> tail:
      R.max(loops_required(loops, surface, edges, domains, vertices), faces_required(tail, edges, domains, vertices))

def loops_area(loops: List<&2, A.Loop>, +surface: A.Surface, +sense: Bool, +edges: List<&2, A.Edge>, +domains: List<&2, F.DomainChoice>, +vertices: List<&2, G.Vec3>) -> R.Real:
  match loops:
    case Nil{}:
      zero()
    case A.Loop{_, uses} <> tail:
      R.add(M.ring_area(surface, sense, uses, edges, domains, vertices), loops_area(tail, surface, sense, edges, domains, vertices))

def face_prepared(prepared: FP.FacePreparation) -> Bool:
  match prepared:
    case FP.Prepared{_, _, _}:
      True{}
    case _:
      False{}

def plane_loops_oriented(+surface: A.Surface, +sense: Bool, loops: List<&2, A.Loop>, +edges: List<&2, A.Edge>, +domains: List<&2, F.DomainChoice>, +vertices: List<&2, G.Vec3>, +resolution: R.Real) -> Bool:
  match loops:
    case Nil{}:
      True{}
    case A.Loop{outer, uses} <> tail:
      +area = M.ring_area(surface, sense, uses, edges, domains, vertices)
      +minimum = R.mul(resolution, resolution)
      oriented = Bool.pick(Bool, outer, R.less(minimum, area), R.less(area, R.neg(minimum)))
      Bool.and(oriented, plane_loops_oriented(surface, sense, tail, edges, domains, vertices, resolution))

def planar_orientations(+surface: A.Surface, sense: Bool, loops: List<&2, A.Loop>, edges: List<&2, A.Edge>, domains: List<&2, F.DomainChoice>, vertices: List<&2, G.Vec3>, resolution: R.Real) -> Bool:
  match surface:
    case A.Plane{_, _, _}:
      plane_loops_oriented(surface, sense, loops, edges, domains, vertices, resolution)
    case _:
      True{}

def face_valid(+face: A.Face, index: U32, +vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>, +domains: List<&2, F.DomainChoice>, tolerance: I.Tolerance, budget: R.Real, +resolution: R.Real) -> Bool:
  A.Face{+surface, +sense, +loops} = face
  prepared = FP.prepare_valid(FP.surface_valid(surface), face, index, vertices, edges, domains, FP.surface_origin(surface), G.v3(0.0, 0.0, 1.0), tolerance, budget)
  positive = R.less(R.mul(resolution, resolution), loops_area(loops, surface, sense, edges, domains, vertices))
  Bool.and(face_prepared(prepared), Bool.and(positive, planar_orientations(surface, sense, loops, edges, domains, vertices, resolution)))

def faces_valid(faces: List<&2, A.Face>, +index: U32, +vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>, +domains: List<&2, F.DomainChoice>, +tolerance: I.Tolerance, +budget: R.Real, +resolution: R.Real) -> Bool:
  match faces:
    case Nil{}:
      True{}
    case head <> tail:
      Bool.and(face_valid(head, index, vertices, edges, domains, tolerance, budget, resolution), faces_valid(tail, (index + 1 : U32), vertices, edges, domains, tolerance, budget, resolution))

def audit(+solid: A.Solid, +domains: List<&2, F.DomainChoice>, +tolerance: I.Tolerance, +source_budget: R.Real) -> Audit:
  A.Solid{+vertices, +edges, +faces} = solid
  +res = resolution(solid)
  +allowance = R.add(source_budget, res)
  +required = R.max(edges_required(edges, domains, vertices, 0, tolerance, source_budget, zero()), faces_required(faces, edges, domains, vertices))
  +volume = M.volume(solid, domains)
  +nd = U32.from_nat(List.length(&2, F.DomainChoice, domains))
  domain_count = Bool.or(U32.is_eq(nd, 0), U32.is_eq(nd, U32.from_nat(List.length(&2, A.Edge, edges))))
  topology = Bool.and(domain_count, Bool.and(S.nonempty(solid), Bool.and(S.edges_closed(edges, faces, 0), Bool.and(H.all_used(vertices, edges, 0), H.connected(faces)))))
  geometry = Bool.and(H.vertices_valid(vertices), Bool.and(I.at_most(required, allowance), faces_valid(faces, 0, vertices, edges, domains, tolerance, source_budget, res)))
  positive = Bool.and(I.scalar_valid(volume), R.less(R.mul(res, R.mul(res, res)), volume))
  Audit{Bool.and(topology, Bool.and(geometry, positive)), allowance, required, res, volume}

def valid(audit: Audit) -> Bool:
  Audit{valid, _, _, _, _} = audit
  valid
