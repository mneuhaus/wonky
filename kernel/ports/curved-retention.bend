import Base
import ../real.bend as R
import ../precise.bend as G
import ../analytic.bend as A
import ../intersections.bend as I
import ../curve-plane.bend as C
import ../face-classification.bend as F
import ../face-plane.bend as FP
import ../face-bounds.bend as FB
import ../halfspace.bend as H
import ./types.bend as P

# Called only after the curved source audit and public query validation.
# Bounds include complete face interiors; stored vertices are not an enclosure.
type Disposition is Data:
  Retained{}
  Removed{}
  Undecided{}

def prepared_bounds(prepared: FP.FacePreparation, origin: G.Vec3, direction: G.Vec3) -> FB.Bounds:
  match prepared:
    case FP.Prepared{edges, source, _}:
      FB.directional(FP.source_surface(source), edges, origin, direction)
    case _:
      FB.UnknownBounds{}

def face_bounds(+face: A.Face, index: U32, vertices: List<&2, G.Vec3>, edges: List<&2, A.Edge>, domains: List<&2, F.DomainChoice>, +origin: G.Vec3, +direction: G.Vec3, tolerance: I.Tolerance, budget: R.Real) -> FB.Bounds:
  A.Face{surface, _, _} = face
  prepared = FP.prepare_valid(FP.surface_valid(surface), face, index, vertices, edges, domains, origin, direction, tolerance, budget)
  prepared_bounds(prepared, origin, direction)

def faces_bounds(faces: List<&2, A.Face>, +index: U32, +vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>, +domains: List<&2, F.DomainChoice>, +origin: G.Vec3, +direction: G.Vec3, +tolerance: I.Tolerance, +budget: R.Real) -> FB.Bounds:
  match faces:
    case Nil{}:
      FB.EmptyBounds{}
    case head <> tail:
      FB.join(face_bounds(head, index, vertices, edges, domains, origin, direction, tolerance, budget),
        faces_bounds(tail, (index + 1 : U32), vertices, edges, domains, origin, direction, tolerance, budget))

def separated(valid: Bool, bounds: FB.Bounds) -> Disposition:
  match valid bounds:
    case True{} FB.Finite{_, upper, _}:
      Bool.pick(Disposition, R.less(upper, R.from_f32(0.0)), Retained{}, Removed{})
    case _ _:
      Undecided{}

def classify(solid: A.Solid, domains: List<&2, F.DomainChoice>, origin: G.Vec3, normal: G.Vec3, +tolerance: I.Tolerance, +budget: R.Real, resolution: R.Real) -> Disposition:
  A.Solid{vertices, edges, faces} = solid
  +bounds = faces_bounds(faces, 0, vertices, edges, domains, origin, G.normalize(normal), tolerance, budget)
  # Reuse the existing source + query + arithmetic exclusion margin.
  separated(FB.separated(bounds, tolerance, budget, resolution), bounds)

def face_origins(faces: List<&2, A.Face>, +index: U32) -> List<&2, P.FaceOrigin>:
  match faces:
    case Nil{}:
      Nil{}
    case _ <> tail:
      P.SourceFace{index} <> face_origins(tail, (index + 1 : U32))

def edge_origins(edges: List<&2, A.Edge>, +index: U32) -> List<&2, P.EdgeOrigin>:
  match edges:
    case Nil{}:
      Nil{}
    case _ <> tail:
      P.SourceEdge{index} <> edge_origins(tail, (index + 1 : U32))

def prepend_domain(domain: Maybe<&2, C.Domain>, rest: Maybe<&2, List<&2, F.DomainChoice>>) -> Maybe<&2, List<&2, F.DomainChoice>>:
  match domain rest:
    case Some{value} Some{tail}:
      Some{F.GivenDomain{value} <> tail}
    case _ _:
      None{}

def resolved_domains(edges: List<&2, A.Edge>, +vertices: List<&2, G.Vec3>, +choices: List<&2, F.DomainChoice>, +index: U32) -> Maybe<&2, List<&2, F.DomainChoice>>:
  match edges:
    case Nil{}:
      Some{Nil{}}
    case +head <> tail:
      A.Edge{a, b, _, _} = head
      domain = F.resolve_domain(F.choose_domain(List.get(&2, F.DomainChoice, choices, U32.to_nat(index))), head, H.vertex(vertices, a), H.vertex(vertices, b))
      prepend_domain(domain, resolved_domains(tail, vertices, choices, (index + 1 : U32)))

def retained(domains: Maybe<&2, List<&2, F.DomainChoice>>, +solid: A.Solid) -> P.Result:
  match domains:
    case None{}:
      P.Unresolved{P.InvalidTopology{}}
    case Some{values}:
      A.Solid{_, edges, faces} = solid
      P.Clipped{solid, values, face_origins(faces, 0), edge_origins(edges, 0)}

# Preserve all represented geometry, indices, senses and supplied interval
# words. Only automatic domains are resolved to satisfy the result contract.
def keep(+solid: A.Solid, domains: List<&2, F.DomainChoice>) -> P.Result:
  A.Solid{vertices, edges, _} = solid
  retained(resolved_domains(edges, vertices, domains, 0), solid)
