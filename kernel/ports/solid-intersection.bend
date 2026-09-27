import Base
import ../real.bend as R
import ../precise.bend as G
import ../analytic.bend as A
import ../face-classification.bend as F
import ../intersections.bend as I
import ../halfspace.bend as H
import ./types.bend as P
import ./hybrid.bend as B
import ./truck-topology.bend as L
import ./occt-planar.bend as V

# Intersect a supported closed source with a validated convex planar tool.
# All geometry, operand selection and repeated clipping remain in Bend.
# A failed later plane discards the entire result, including earlier bodies.
# Face/edge references are composed at each step, never reset to intermediates.
type FaceRef is Data:
  FaceRef{operand: U32, index: U32}
type EdgeRef is Data:
  OriginalEdge{operand: U32, index: U32}
  FaceIntersection{first: FaceRef, second: FaceRef}
  SurfaceSeam{face: FaceRef}
type Body is Data:
  Body{solid: A.Solid, domains: List<&2, F.DomainChoice>, face_origins: List<&2, FaceRef>, edge_origins: List<&2, EdgeRef>}
type Bodies is Data:
  Bodies{bodies: List<&2, Body>}
  Unresolved{reason: P.Reason, tool: U32, face: U32}
type FaceMap is Data:
  FaceMap{valid: Bool, origins: List<&2, FaceRef>}
type EdgeMap is Data:
  EdgeMap{valid: Bool, origins: List<&2, EdgeRef>}
type PlanarMeasures is Data:
  PlanarMeasures{volume: R.Real, bounds: A.Bounds}

# This entrypoint is for successfully constructed planar components only.
def planar_measures(+solid: A.Solid) -> PlanarMeasures:
  A.Solid{+vertices, _, _} = solid
  +first = H.vertex(vertices, 0)
  PlanarMeasures{L.volume(solid), H.bounds(vertices, first, first)}

def original_faces(faces: List<&2, A.Face>, +operand: U32, +index: U32) -> List<&2, FaceRef>:
  match faces:
    case Nil{}:
      Nil{}
    case _ <> tail:
      FaceRef{operand, index} <> original_faces(tail, operand, (index + 1 : U32))

def original_edges(edges: List<&2, A.Edge>, +operand: U32, +index: U32) -> List<&2, EdgeRef>:
  match edges:
    case Nil{}:
      Nil{}
    case _ <> tail:
      OriginalEdge{operand, index} <> original_edges(tail, operand, (index + 1 : U32))

def initial(+solid: A.Solid, domains: List<&2, F.DomainChoice>, +operand: U32) -> Body:
  A.Solid{_, edges, faces} = solid
  Body{solid, domains, original_faces(faces, operand, 0), original_edges(edges, operand, 0)}

def face_origin(value: P.FaceOrigin, prior: List<&2, FaceRef>, cut: FaceRef) -> Maybe<&2, FaceRef>:
  match value:
    case P.SourceFace{index}:
      List.get(&2, FaceRef, prior, U32.to_nat(index))
    case P.CutFace{}:
      Some{cut}

def add_face(value: Maybe<&2, FaceRef>, rest: FaceMap) -> FaceMap:
  match value rest:
    case Some{origin} FaceMap{valid, origins}:
      FaceMap{valid, origin <> origins}
    case None{} FaceMap{_, origins}:
      FaceMap{False{}, origins}

def faces(values: List<&2, P.FaceOrigin>, +prior: List<&2, FaceRef>, +cut: FaceRef) -> FaceMap:
  match values:
    case Nil{}:
      FaceMap{True{}, Nil{}}
    case value <> tail:
      add_face(face_origin(value, prior, cut), faces(tail, prior, cut))

def intersection_origin(found: Maybe<&2, FaceRef>, cut: FaceRef) -> Maybe<&2, EdgeRef>:
  match found:
    case Some{face}:
      Some{FaceIntersection{face, cut}}
    case None{}:
      None{}

def seam_origin(found: Maybe<&2, FaceRef>) -> Maybe<&2, EdgeRef>:
  match found:
    case Some{face}:
      Some{SurfaceSeam{face}}
    case None{}:
      None{}

def edge_origin(value: P.EdgeOrigin, prior_faces: List<&2, FaceRef>, prior_edges: List<&2, EdgeRef>, cut: FaceRef) -> Maybe<&2, EdgeRef>:
  match value:
    case P.SourceEdge{index}:
      List.get(&2, EdgeRef, prior_edges, U32.to_nat(index))
    case P.CutEdge{face}:
      intersection_origin(List.get(&2, FaceRef, prior_faces, U32.to_nat(face)), cut)
    case P.SurfaceSeam{face}:
      seam_origin(List.get(&2, FaceRef, prior_faces, U32.to_nat(face)))

def add_edge(value: Maybe<&2, EdgeRef>, rest: EdgeMap) -> EdgeMap:
  match value rest:
    case Some{origin} EdgeMap{valid, origins}:
      EdgeMap{valid, origin <> origins}
    case None{} EdgeMap{_, origins}:
      EdgeMap{False{}, origins}

def edges(values: List<&2, P.EdgeOrigin>, +prior_faces: List<&2, FaceRef>, +prior_edges: List<&2, EdgeRef>, +cut: FaceRef) -> EdgeMap:
  match values:
    case Nil{}:
      EdgeMap{True{}, Nil{}}
    case value <> tail:
      add_edge(edge_origin(value, prior_faces, prior_edges, cut), edges(tail, prior_faces, prior_edges, cut))

def converted(solid: A.Solid, domains: List<&2, F.DomainChoice>, fm: FaceMap, em: EdgeMap, cut: FaceRef) -> Bodies:
  FaceMap{a, fs} = fm
  EdgeMap{b, es} = em
  FaceRef{tool, face} = cut
  Bool.pick(Bodies, Bool.and(a, b), Bodies{[Body{solid, domains, fs, es}]}, Unresolved{P.ConstructionFailure{}, tool, face})

def component(value: P.Component, prior: Body, +cut: FaceRef) -> Bodies:
  P.Component{solid, domains, fs, es} = value
  Body{_, _, +pf, pe} = prior
  converted(solid, domains, faces(fs, pf, cut), edges(es, pf, pe, cut), cut)

def joined(first: Bodies, second: Bodies) -> Bodies:
  match first second:
    case Unresolved{reason, tool, face} _:
      Unresolved{reason, tool, face}
    case _ Unresolved{reason, tool, face}:
      Unresolved{reason, tool, face}
    case Bodies{a} Bodies{b}:
      Bodies{List.append(&2, Body, a, b)}

def components(values: List<&2, P.Component>, +prior: Body, +cut: FaceRef) -> Bodies:
  match values:
    case Nil{}:
      Bodies{Nil{}}
    case value <> tail:
      joined(component(value, prior, cut), components(tail, prior, cut))

def converted_result(value: P.Result, prior: Body, +cut: FaceRef) -> Bodies:
  match value:
    case P.Empty{}:
      Bodies{Nil{}}
    case P.Clipped{solid, domains, fs, es}:
      component(P.Component{solid, domains, fs, es}, prior, cut)
    case P.Components{values}:
      components(values, prior, cut)
    case P.Unresolved{reason}:
      FaceRef{tool, face} = cut
      Unresolved{reason, tool, face}

def clipped(+body: Body, plane: A.Face, +cut: FaceRef, tolerance: I.Tolerance, source_budget: R.Real) -> Bodies:
  match body plane:
    case Body{solid, domains, _, _} A.Face{A.Plane{origin, normal, _}, sense, _}:
      outward = G.scale(normal, Bool.pick(R.Real, sense, R.from_f32(1.0), R.neg(R.from_f32(1.0))))
      converted_result(B.clip(solid, domains, origin, outward, tolerance, source_budget), body, cut)
    case _ _:
      FaceRef{tool, face} = cut
      Unresolved{P.UnsupportedSurface{}, tool, face}

def clip_bodies(bodies: List<&2, Body>, +plane: A.Face, +cut: FaceRef, +tolerance: I.Tolerance, +source_budget: R.Real) -> Bodies:
  match bodies:
    case Nil{}:
      Bodies{Nil{}}
    case body <> tail:
      joined(clipped(body, plane, cut, tolerance, source_budget), clip_bodies(tail, plane, cut, tolerance, source_budget))

def clip_faces(planes: List<&2, A.Face>, state: Bodies, +tool: U32, +index: U32, +tolerance: I.Tolerance, +source_budget: R.Real) -> Bodies:
  match planes state:
    case _ Unresolved{reason, operand, face}:
      Unresolved{reason, operand, face}
    case Nil{} Bodies{bodies}:
      Bodies{bodies}
    case plane <> tail Bodies{bodies}:
      clip_faces(tail, clip_bodies(bodies, plane, FaceRef{tool, index}, tolerance, source_budget), tool, (index + 1 : U32), tolerance, source_budget)

def tool_valid(+solid: A.Solid, +domains: List<&2, F.DomainChoice>, budget: R.Real, tolerance: I.Tolerance) -> Bool:
  A.Solid{vertices, edges, _} = solid
  +resolution = R.mul(I.angular_guard(), H.vertex_scale(vertices, R.from_f32(1.0)))
  +nd = U32.from_nat(List.length(&2, F.DomainChoice, domains))
  +ne = U32.from_nat(List.length(&2, A.Edge, edges))
  domain_ok = Bool.and(Bool.or(U32.is_eq(nd, 0), U32.is_eq(nd, ne)), V.valid(solid, domains, resolution))
  Bool.and(domain_ok, Bool.and(R.equal(budget, R.from_f32(0.0)), Bool.and(R.less(resolution, I.tolerance_linear(tolerance)), H.valid(solid, resolution))))

def selected(a_tool: Bool, b_tool: Bool, +first: A.Solid, ad: List<&2, F.DomainChoice>, ab: R.Real, +second: A.Solid, bd: List<&2, F.DomainChoice>, bb: R.Real, tolerance: I.Tolerance) -> Bodies:
  match a_tool b_tool:
    case _ True{}:
      A.Solid{_, _, planes} = second
      clip_faces(planes, Bodies{[initial(first, ad, 0)]}, 1, 0, tolerance, ab)
    case True{} False{}:
      A.Solid{_, _, planes} = first
      clip_faces(planes, Bodies{[initial(second, bd, 1)]}, 0, 0, tolerance, bb)
    case False{} False{}:
      Unresolved{P.UnsupportedArrangement{}, 0, 0}

def checked(valid: Bool, +first: A.Solid, +ad: List<&2, F.DomainChoice>, +ab: R.Real, +second: A.Solid, +bd: List<&2, F.DomainChoice>, +bb: R.Real, +tolerance: I.Tolerance) -> Bodies:
  match valid:
    case False{}:
      Unresolved{P.InvalidInput{}, 0, 0}
    case True{}:
      selected(tool_valid(first, ad, ab, tolerance), tool_valid(second, bd, bb, tolerance), first, ad, ab, second, bd, bb, tolerance)

def intersect(first: A.Solid, ad: List<&2, F.DomainChoice>, +ab: R.Real, second: A.Solid, bd: List<&2, F.DomainChoice>, +bb: R.Real, +tolerance: I.Tolerance) -> Bodies:
  budgets = Bool.and(I.scalar_valid(ab), Bool.and(I.scalar_valid(bb), Bool.and(I.at_most(R.from_f32(0.0), ab), I.at_most(R.from_f32(0.0), bb))))
  valid = Bool.and(budgets, Bool.and(I.tolerance_valid(tolerance), I.at_most(I.angular_guard(), I.tolerance_angular(tolerance))))
  checked(valid, first, ad, ab, second, bd, bb, tolerance)
