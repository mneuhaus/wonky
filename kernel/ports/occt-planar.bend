import Base
import ../real.bend as R
import ../precise.bend as G
import ../analytic.bend as A
import ../topology.bend as T
import ../intersections.bend as I
import ../face-classification.bend as F
import ../boundary.bend as B
import ../solid-classification.bend as S
import ../halfspace.bend as H

# Validation for the bounded planar subset. This module does not construct a
# clip. The source is required to be an embedded oriented shell; global 3-D
# face/face self-intersection detection is not a claim of this validator.
def zero() -> R.Real:
  R.from_f32(0.0)

def outward(surface: A.Surface, sense: Bool) -> G.Vec3:
  match surface:
    case A.Plane{_, +normal, _}:
      Bool.pick(G.Vec3, sense, G.normalize(normal), G.scale(G.normalize(normal), R.from_f32(F32.neg(1.0))))
    case _:
      G.v3(0.0, 0.0, 0.0)

def plane_faces(faces: List<&2, A.Face>) -> Bool:
  match faces:
    case Nil{}:
      True{}
    case A.Face{A.Plane{_, _, _}, _, _} <> tail:
      plane_faces(tail)
    case _:
      False{}

def line_edges(edges: List<&2, A.Edge>) -> Bool:
  match edges:
    case Nil{}:
      True{}
    case A.Edge{_, _, A.Line{_, _}, _} <> tail:
      line_edges(tail)
    case _:
      False{}

def single_faces(faces: List<&2, A.Face>) -> Bool:
  match faces:
    case Nil{}:
      True{}
    case A.Face{_, _, A.Loop{True{}, _} <> Nil{}} <> tail:
      single_faces(tail)
    case _:
      False{}

def use_end(use: T.Coedge, edges: List<&2, A.Edge>) -> U32:
  T.Use{index, forward} = use
  H.oriented_start(H.edge(List.get(&2, A.Edge, edges, U32.to_nat(index))), Bool.not(forward))

def near_segment(+point: G.Vec3, +a: G.Vec3, b: G.Vec3, +resolution: R.Real) -> Bool:
  +delta = G.sub(b, a)
  +length = I.length(delta)
  +unit = G.normalize(delta)
  +parameter = G.dot(G.sub(point, a), unit)
  Bool.and(I.at_most(I.length(G.cross(G.sub(point, a), unit)), resolution),
    Bool.and(I.at_most(R.neg(resolution), parameter), I.at_most(parameter, R.add(length, resolution))))

def opposite(+a: R.Real, +b: R.Real, +guard: R.Real) -> Bool:
  Bool.or(Bool.and(R.less(guard, a), R.less(b, R.neg(guard))), Bool.and(R.less(guard, b), R.less(a, R.neg(guard))))

def crossing(+a: G.Vec3, +b: G.Vec3, +c: G.Vec3, +d: G.Vec3, +normal: G.Vec3, +resolution: R.Real) -> Bool:
  +ab = G.normalize(G.sub(b, a))
  +cd = G.normalize(G.sub(d, c))
  transverse = Bool.and(opposite(G.dot(G.cross(ab, G.sub(c, a)), normal), G.dot(G.cross(ab, G.sub(d, a)), normal), resolution),
    opposite(G.dot(G.cross(cd, G.sub(a, c)), normal), G.dot(G.cross(cd, G.sub(b, c)), normal), resolution))
  touch = Bool.or(near_segment(a, c, d, resolution), Bool.or(near_segment(b, c, d, resolution),
    Bool.or(near_segment(c, a, b, resolution), near_segment(d, a, b, resolution))))
  Bool.or(transverse, touch)

def pair_clear(+a: U32, +b: U32, +c: U32, +d: U32, +vertices: List<&2, G.Vec3>, normal: G.Vec3, resolution: R.Real) -> Bool:
  adjacent = Bool.or(Bool.or(U32.is_eq(a, c), U32.is_eq(a, d)), Bool.or(U32.is_eq(b, c), U32.is_eq(b, d)))
  Bool.or(adjacent, Bool.not(crossing(H.vertex(vertices, a), H.vertex(vertices, b), H.vertex(vertices, c), H.vertex(vertices, d), normal, resolution)))

def edge_clear(uses: List<&2, T.Coedge>, +a: U32, +b: U32, +vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>, +normal: G.Vec3, +resolution: R.Real) -> Bool:
  match uses:
    case Nil{}:
      True{}
    case +head <> tail:
      Bool.and(pair_clear(a, b, H.use_start(head, edges), use_end(head, edges), vertices, normal, resolution), edge_clear(tail, a, b, vertices, edges, normal, resolution))

def ring_clear(uses: List<&2, T.Coedge>, +vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>, +normal: G.Vec3, +resolution: R.Real) -> Bool:
  match uses:
    case Nil{}:
      True{}
    case +head <> +tail:
      Bool.and(edge_clear(tail, H.use_start(head, edges), use_end(head, edges), vertices, edges, normal, resolution), ring_clear(tail, vertices, edges, normal, resolution))

def face_valid(face: A.Face, +vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>, domains: List<&2, F.DomainChoice>, +resolution: R.Real) -> Bool:
  match face:
    case A.Face{A.Plane{+origin, +normal, +x}, +sense, A.Loop{True{}, +uses} <> Nil{}}:
      +unit = G.normalize(normal)
      +out = Bool.pick(G.Vec3, sense, unit, G.scale(unit, R.from_f32(F32.neg(1.0))))
      +ids = H.ring_vertices(uses, edges)
      area = H.ring_area(ids, vertices, H.first_id(ids, 0), out)
      frame = Bool.and(I.vec_valid(origin), H.frame_valid(normal, x))
      boundary = Bool.and(H.one_ring(B.stitch(edges, U32.from_nat(List.length(&2, G.Vec3, vertices)), uses)),
        H.prepared_valid(F.prepare_loops([A.Loop{True{}, uses}], vertices, edges, domains, origin, unit, resolution)))
      Bool.and(frame, Bool.and(boundary, Bool.and(R.less(R.mul(resolution, resolution), area), ring_clear(uses, vertices, edges, out, resolution))))
    case _:
      False{}

def faces_valid(faces: List<&2, A.Face>, +vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>, +domains: List<&2, F.DomainChoice>, +resolution: R.Real) -> Bool:
  match faces:
    case Nil{}:
      True{}
    case head <> tail:
      Bool.and(face_valid(head, vertices, edges, domains, resolution), faces_valid(tail, vertices, edges, domains, resolution))

def volume(+solid: A.Solid) -> R.Real:
  A.Solid{+vertices, edges, faces} = solid
  R.div(H.volume(H.polygons(faces, edges), vertices, H.vertex(vertices, 0)), R.from_f32(6.0))

def valid(+solid: A.Solid, +domains: List<&2, F.DomainChoice>, +resolution: R.Real) -> Bool:
  A.Solid{+vertices, +edges, +faces} = solid
  +nv = U32.from_nat(List.length(&2, G.Vec3, vertices))
  +nd = U32.from_nat(List.length(&2, F.DomainChoice, domains))
  ne = U32.from_nat(List.length(&2, A.Edge, edges))
  topology = Bool.and(S.nonempty(solid), Bool.and(S.edges_closed(edges, faces, 0), Bool.and(H.all_used(vertices, edges, 0),
    Bool.and(H.unique_vertices(vertices, resolution), H.unique_edges(edges)))))
  geometry = Bool.and(H.vertices_valid(vertices), Bool.and(H.lines_valid(edges, vertices, nv, resolution), faces_valid(faces, vertices, edges, domains, resolution)))
  Bool.and(Bool.or(U32.is_eq(nd, 0), U32.is_eq(nd, ne)), Bool.and(topology, Bool.and(geometry, R.less(R.mul(resolution, R.mul(resolution, resolution)), volume(solid)))))
