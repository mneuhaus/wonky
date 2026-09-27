import Base
import ../real.bend as R
import ../precise.bend as G
import ../analytic.bend as A
import ../face-classification.bend as F
import ../intersections.bend as I
import ../halfspace.bend as H
import ../robust-predicates.bend as Exact
import ./types.bend as P
import ./occt.bend as O
import ./truck.bend as K
import ./truck-cylinder.bend as C
import ./solvespace.bend as S
import ./solvespace-bsp.bend as U

# Evidence-based first combination of the bounded reference adaptations.
# Transverse planar inputs use Truck's measured faster graph reconstruction;
# represented vertex contacts use OCCT's contact-capable event arrangement.
# SolveSpace's UV BSP independently checks the midpoint of each new cut edge
# against its source trimmed face. This is an extra check, not a proof for an
# arbitrary curved edge, a tolerant contact policy, or a global embedding test.
# Full cylindrical bands use the independently checked analytic Truck subset;
# its own whole-curve/periodic-topology checks replace the planar BSP audit.
# Licensing of the imported source-derived modules applies; see port docs.
type Route is Data:
  TransversePlanar{}
  ContactPlanar{}
  CylindricalCandidate{}
  InvalidRoute{}

type ContactState is Data:
  ContactState{valid: Bool, contact: Bool}

def planar(faces: List<&2, A.Face>) -> Bool:
  match faces:
    case Nil{}:
      True{}
    case A.Face{surface, _, _} <> tail:
      match surface:
        case A.Plane{_, _, _}:
          planar(tail)
        case _:
          False{}

def contact_sign(kind: Exact.Sign, rest: ContactState) -> ContactState:
  match kind rest:
    case Exact.Undefined{} ContactState{_, contact}:
      ContactState{False{}, contact}
    case Exact.ExactlyZero{} ContactState{valid, _}:
      ContactState{valid, True{}}
    case _ ContactState{valid, contact}:
      ContactState{valid, contact}

def contact_add(decision: Exact.Decision, rest: ContactState) -> ContactState:
  Exact.Decision{kind, _} = decision
  contact_sign(kind, rest)

def contacts(vertices: List<&2, G.Vec3>, +origin: G.Vec3, +normal: G.Vec3) -> ContactState:
  match vertices:
    case Nil{}:
      ContactState{True{}, False{}}
    case point <> tail:
      contact_add(Exact.point_plane(normal, point, origin), contacts(tail, origin, normal))

def choose_route(is_planar: Bool, state: ContactState) -> Route:
  ContactState{valid, contact} = state
  Bool.pick(Route, valid,
    Bool.pick(Route, is_planar, Bool.pick(Route, contact, ContactPlanar{}, TransversePlanar{}), CylindricalCandidate{}), InvalidRoute{})

def route(solid: A.Solid, origin: G.Vec3, normal: G.Vec3) -> Route:
  A.Solid{vertices, _, faces} = solid
  choose_route(planar(faces), contacts(vertices, origin, normal))

def source_midpoint(found: Maybe<&2, A.Face>, source: A.Solid, +point: G.Vec3, +resolution: R.Real) -> Bool:
  match found source:
    case None{} _:
      False{}
    case Some{+face} A.Solid{vertices, edges, _}:
      +normal = S.outward(face)
      tree = U.from_segments(S.original_segments(S.face_uses(face), vertices, edges), normal, resolution)
      +kind = U.classify(tree, point, normal, resolution)
      # Boundary is an allowed extra-audit outcome; the constructor separately
      # owns contact orientation and must already return a valid closed body.
      Bool.or(U32.is_eq(kind, 1), U32.is_eq(kind, 2))

def edge_check(origin: P.EdgeOrigin, edge: A.Edge, +vertices: List<&2, G.Vec3>, +source: A.Solid, resolution: R.Real) -> Bool:
  match origin:
    case P.SourceEdge{_}:
      True{}
    case P.SurfaceSeam{_}:
      # This extra audit only admits planar construction results.
      False{}
    case P.CutEdge{index}:
      A.Edge{a, b, curve, _} = edge
      match curve:
        case A.Line{_, _}:
          A.Solid{_, _, faces} = source
          point = G.scale(G.add(H.vertex(vertices, a), H.vertex(vertices, b)), R.from_f32(0.5))
          source_midpoint(List.get(&2, A.Face, faces, U32.to_nat(index)), source, point, resolution)
        case _:
          False{}

def edges_check(edges: List<&2, A.Edge>, origins: List<&2, P.EdgeOrigin>, +vertices: List<&2, G.Vec3>, +source: A.Solid, +resolution: R.Real) -> Bool:
  match edges origins:
    case Nil{} Nil{}:
      True{}
    case edge <> tail origin <> rest:
      Bool.and(edge_check(origin, edge, vertices, source, resolution), edges_check(tail, rest, vertices, source, resolution))
    case _ _:
      False{}

def component_check(body: P.Component, source: A.Solid, resolution: R.Real) -> Bool:
  P.Component{solid, _, _, origins} = body
  A.Solid{vertices, edges, _} = solid
  edges_check(edges, origins, vertices, source, resolution)

def components_check(bodies: List<&2, P.Component>, +source: A.Solid, +resolution: R.Real) -> Bool:
  match bodies:
    case Nil{}:
      True{}
    case body <> tail:
      Bool.and(component_check(body, source, resolution), components_check(tail, source, resolution))

def checked(ok: Bool, result: P.Result) -> P.Result:
  Bool.pick(P.Result, ok, result, P.Unresolved{P.ConstructionFailure{}})

def audit(+result: P.Result, source: A.Solid, resolution: R.Real) -> P.Result:
  match result:
    case P.Clipped{solid, _, _, origins}:
      A.Solid{vertices, edges, _} = solid
      checked(edges_check(edges, origins, vertices, source, resolution), result)
    case P.Components{bodies}:
      checked(components_check(bodies, source, resolution), result)
    case _:
      result

def resolution(solid: A.Solid) -> R.Real:
  A.Solid{vertices, _, _} = solid
  I.guard(H.vertex_scale(vertices, R.from_f32(1.0)))

def implicit_domains(domains: List<&2, F.DomainChoice>) -> Bool:
  match domains:
    case Nil{}:
      True{}
    case F.AutoDomain{} <> tail:
      implicit_domains(tail)
    case _:
      False{}

# OCCT-generated explicit line intervals must be validated and consumed by a
# compatible constructor at the next plane, never discarded to satisfy Truck.
def transverse(implicit: Bool, +solid: A.Solid, domains: List<&2, F.DomainChoice>, origin: G.Vec3, normal: G.Vec3, tolerance: I.Tolerance, source_budget: R.Real) -> P.Result:
  match implicit:
    case True{}:
      audit(K.clip(solid, domains, origin, normal, tolerance, source_budget), solid, resolution(solid))
    case False{}:
      audit(O.clip(solid, domains, origin, normal, tolerance, source_budget), solid, resolution(solid))

def selected(route: Route, +solid: A.Solid, +domains: List<&2, F.DomainChoice>, origin: G.Vec3, normal: G.Vec3, +tolerance: I.Tolerance, source_budget: R.Real) -> P.Result:
  match route:
    case TransversePlanar{}:
      transverse(implicit_domains(domains), solid, domains, origin, normal, tolerance, source_budget)
    case ContactPlanar{}:
      audit(O.clip(solid, domains, origin, normal, tolerance, source_budget), solid, resolution(solid))
    case CylindricalCandidate{}:
      C.clip(solid, domains, origin, normal, tolerance, source_budget)
    case InvalidRoute{}:
      P.Unresolved{P.InvalidInput{}}

def clip(+solid: A.Solid, domains: List<&2, F.DomainChoice>, +origin: G.Vec3, +normal: G.Vec3, tolerance: I.Tolerance, source_budget: R.Real) -> P.Result:
  selected(route(solid, origin, normal), solid, domains, origin, normal, tolerance, source_budget)
