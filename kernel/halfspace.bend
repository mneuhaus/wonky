import Base
import ./real.bend as R
import ./precise.bend as G
import ./analytic.bend as A
import ./topology.bend as T
import ./intersections.bend as I
import ./curve-plane.bend as C
import ./face-classification.bend as F
import ./solid-classification.bend as S
import ./boundary.bend as B
import ./lib/id-vec.bend as V
import ./lib/id-set.bend as Q

# Regularized intersection of a validated convex, planar, straight-edge solid
# with a halfspace. All roots, shared vertices, caps and mass properties are
# constructed here. Tolerant imported geometry is deliberately not admitted.
type Reason is Data:
  InvalidInput{}
  InvalidTopology{}
  UnsupportedGeometry{}
  SourceTolerance{}
  NonConvexOrInconsistent{}
  ResolutionLimit{}
  AmbiguousContact{vertex: U32}
  BoundaryFailure{reason: B.Reason}
  InvalidCap{}
  InvalidClipResult{}

type ClipResult is Data:
  Empty{}
  Solid{solid: A.Solid, volume: R.Real, bounds: A.Bounds}
  Unresolved{reason: Reason}

type Polygon is Data:
  Polygon{surface: A.Surface, sense: Bool, vertices: List<&2, U32>}

type Side is Data:
  Side{kind: U32, distance: R.Real}

type Sides is Data:
  Sides{valid: Bool, bad_vertex: U32, negative: Bool, positive: Bool, values: List<&2, Side>}

type Cut is Data:
  Cut{a: U32, b: U32, vertex: U32}

type ClipState is Data:
  ClipState{vertices: List<&2, G.Vec3>, cuts: List<&2, Cut>}

type VertexCut is Data:
  VertexCut{vertex: U32, state: ClipState}

type RingCut is Data:
  RingCut{vertices: List<&2, U32>, state: ClipState}

type PolygonsCut is Data:
  PolygonsCut{polygons: List<&2, Polygon>, state: ClipState}

type BuildState is Data:
  BuildState{edges: List<&2, A.Edge>, faces: List<&2, A.Face>}

type EdgeUse is Data:
  EdgeUse{use: T.Coedge, edges: List<&2, A.Edge>}

type RingBuild is Data:
  RingBuild{uses: List<&2, T.Coedge>, edges: List<&2, A.Edge>}

type VertexMap is Data:
  VertexMap{before: U32, after: U32}

type Compact is Data:
  Compact{vertices: List<&2, G.Vec3>, map: List<&2, VertexMap>}

def zero() -> R.Real:
  R.from_f32(0.0)

def point(found: Maybe<&2, G.Vec3>) -> G.Vec3:
  match found:
    case Some{value}:
      value
    case None{}:
      G.v3(0.0, 0.0, 0.0)

def vertex(vertices: List<&2, G.Vec3>, index: U32) -> G.Vec3:
  point(List.get(&2, G.Vec3, vertices, U32.to_nat(index)))

def edge(found: Maybe<&2, A.Edge>) -> A.Edge:
  match found:
    case Some{value}:
      value
    case None{}:
      A.Edge{0, 0, A.Line{G.v3(0.0, 0.0, 0.0), G.v3(1.0, 0.0, 0.0)}, True{}}

def oriented_start(edge: A.Edge, forward: Bool) -> U32:
  A.Edge{a, b, _, _} = edge
  Bool.pick(U32, forward, a, b)

def use_start(use: T.Coedge, edges: List<&2, A.Edge>) -> U32:
  T.Use{index, forward} = use
  oriented_start(edge(List.get(&2, A.Edge, edges, U32.to_nat(index))), forward)

def ring_vertices(uses: List<&2, T.Coedge>, +edges: List<&2, A.Edge>) -> List<&2, U32>:
  match uses:
    case Nil{}:
      Nil{}
    case use <> tail:
      use_start(use, edges) <> ring_vertices(tail, edges)

def only_ring(loops: List<&2, A.Loop>, edges: List<&2, A.Edge>) -> List<&2, U32>:
  match loops:
    case A.Loop{True{}, uses} <> Nil{}:
      ring_vertices(uses, edges)
    case _:
      Nil{}

def polygons(faces: List<&2, A.Face>, +edges: List<&2, A.Edge>) -> List<&2, Polygon>:
  match faces:
    case Nil{}:
      Nil{}
    case A.Face{surface, sense, loops} <> tail:
      Polygon{surface, sense, only_ring(loops, edges)} <> polygons(tail, edges)

def vertices_valid(vertices: List<&2, G.Vec3>) -> Bool:
  match vertices:
    case Nil{}:
      True{}
    case head <> tail:
      Bool.and(I.vec_valid(head), vertices_valid(tail))

def vertex_scale(vertices: List<&2, G.Vec3>, +scale: R.Real) -> R.Real:
  match vertices:
    case Nil{}:
      scale
    case head <> tail:
      vertex_scale(tail, R.max(scale, I.magnitude(head)))

def line_valid(curve: A.Curve, +a: G.Vec3, +b: G.Vec3, +resolution: R.Real) -> Bool:
  match curve:
    case A.Line{+origin, +direction}:
      +unit = G.normalize(direction)
      valid = Bool.and(I.vec_valid(origin), Bool.and(I.vec_valid(direction), I.direction_valid(direction)))
      incidence = Bool.and(I.at_most(I.length(G.cross(G.sub(a, origin), unit)), resolution), I.at_most(I.length(G.cross(G.sub(b, origin), unit)), resolution))
      Bool.and(valid, Bool.and(incidence, R.less(resolution, I.length(G.sub(a, b)))))
    case _:
      False{}

def lines_valid(edges: List<&2, A.Edge>, +vertices: List<&2, G.Vec3>, +count: U32, +resolution: R.Real) -> Bool:
  match edges:
    case Nil{}:
      True{}
    case A.Edge{+a, +b, curve, _} <> tail:
      indices = Bool.and(U32.is_lt(a, count), Bool.and(U32.is_lt(b, count), Bool.not(U32.is_eq(a, b))))
      Bool.and(indices, Bool.and(line_valid(curve, vertex(vertices, a), vertex(vertices, b), resolution), lines_valid(tail, vertices, count, resolution)))

def prepared_valid(prepared: F.LoopPreparation) -> Bool:
  match prepared:
    case F.PreparedLoops{F.PreparedLoop{True{}, +edges} <> Nil{}}:
      Bool.and(F.loop_valid(edges), U32.is_lt(2, U32.from_nat(List.length(&2, F.PreparedEdge, edges))))
    case _:
      False{}

def one_ring(result: B.StitchResult) -> Bool:
  match result:
    case B.Stitched{_ <> Nil{}}:
      True{}
    case _:
      False{}

def simple_loop(loops: List<&2, A.Loop>, edges: List<&2, A.Edge>, count: U32) -> Bool:
  match loops:
    case A.Loop{True{}, uses} <> Nil{}:
      one_ring(B.stitch(edges, count, uses))
    case _:
      False{}

def in_halfspace(vertices: List<&2, G.Vec3>, +origin: G.Vec3, +normal: G.Vec3, +resolution: R.Real) -> Bool:
  match vertices:
    case Nil{}:
      True{}
    case head <> tail:
      Bool.and(I.at_most(G.dot(G.sub(head, origin), normal), resolution), in_halfspace(tail, origin, normal, resolution))

def left_of_edge(ids: List<&2, U32>, +vertices: List<&2, G.Vec3>, +a: G.Vec3, +b: G.Vec3, +normal: G.Vec3, +resolution: R.Real) -> Bool:
  match ids:
    case Nil{}:
      True{}
    case head <> tail:
      left = G.normalize(G.cross(normal, G.sub(b, a)))
      d = G.dot(G.sub(vertex(vertices, head), a), left)
      Bool.and(I.at_most(R.neg(resolution), d), left_of_edge(tail, vertices, a, b, normal, resolution))

def first_id(ids: List<&2, U32>, fallback: U32) -> U32:
  match ids:
    case Nil{}:
      fallback
    case head <> _:
      head

def convex_ring(left: List<&2, U32>, +all: List<&2, U32>, +vertices: List<&2, G.Vec3>, +first: U32, +normal: G.Vec3, +resolution: R.Real) -> Bool:
  match left:
    case Nil{}:
      True{}
    case head <> +tail:
      Bool.and(left_of_edge(all, vertices, vertex(vertices, head), vertex(vertices, first_id(tail, first)), normal, resolution),
        convex_ring(tail, all, vertices, first, normal, resolution))

def ring_area(ids: List<&2, U32>, +vertices: List<&2, G.Vec3>, +first: U32, +normal: G.Vec3) -> R.Real:
  match ids:
    case Nil{}:
      zero()
    case head <> +tail:
      +origin = vertex(vertices, first)
      here = G.dot(G.cross(G.sub(vertex(vertices, head), origin), G.sub(vertex(vertices, first_id(tail, first)), origin)), normal)
      R.add(here, ring_area(tail, vertices, first, normal))

def frame_checked(valid: Bool, normal: G.Vec3, x: G.Vec3) -> Bool:
  match valid:
    case False{}:
      False{}
    case True{}:
      C.frame_valid(G.normalize(normal), G.normalize(x))

def frame_valid(+normal: G.Vec3, +x: G.Vec3) -> Bool:
  words = Bool.and(I.vec_valid(normal), I.vec_valid(x))
  directions = Bool.and(I.direction_valid(normal), I.direction_valid(x))
  frame_checked(Bool.and(words, directions), normal, x)

def face_valid(face: A.Face, +vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>, +resolution: R.Real) -> Bool:
  A.Face{surface, sense, +loops} = face
  match surface:
    case A.Plane{+origin, +normal, +x}:
      +unit = G.normalize(normal)
      +outward = Bool.pick(G.Vec3, sense, unit, G.scale(unit, R.neg(R.from_f32(1.0))))
      +ids = only_ring(loops, edges)
      frame = Bool.and(I.vec_valid(origin), frame_valid(normal, x))
      boundary = Bool.and(simple_loop(loops, edges, U32.from_nat(List.length(&2, G.Vec3, vertices))),
        prepared_valid(F.prepare_loops(loops, vertices, edges, Nil{}, origin, unit, resolution)))
      area = ring_area(ids, vertices, first_id(ids, 0), outward)
      convex = Bool.and(R.less(R.mul(resolution, resolution), area), Bool.and(in_halfspace(vertices, origin, outward, resolution), convex_ring(ids, ids, vertices, first_id(ids, 0), outward, resolution)))
      Bool.and(frame, Bool.and(boundary, convex))
    case _:
      False{}

def faces_valid(faces: List<&2, A.Face>, +vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>, +resolution: R.Real) -> Bool:
  match faces:
    case Nil{}:
      True{}
    case head <> tail:
      Bool.and(face_valid(head, vertices, edges, resolution), faces_valid(tail, vertices, edges, resolution))

def vertex_used(edges: List<&2, A.Edge>, +index: U32) -> Bool:
  match edges:
    case Nil{}:
      False{}
    case A.Edge{a, b, _, _} <> tail:
      Bool.or(Bool.or(U32.is_eq(index, a), U32.is_eq(index, b)), vertex_used(tail, index))

def separated_vertices(vertices: List<&2, G.Vec3>, +point: G.Vec3, +resolution: R.Real) -> Bool:
  match vertices:
    case Nil{}:
      True{}
    case head <> tail:
      Bool.and(R.less(resolution, I.length(G.sub(head, point))), separated_vertices(tail, point, resolution))

def unique_vertices(vertices: List<&2, G.Vec3>, +resolution: R.Real) -> Bool:
  match vertices:
    case Nil{}:
      True{}
    case head <> +tail:
      Bool.and(separated_vertices(tail, head, resolution), unique_vertices(tail, resolution))

def different_edges(edges: List<&2, A.Edge>, +a: U32, +b: U32) -> Bool:
  match edges:
    case Nil{}:
      True{}
    case A.Edge{+x, +y, _, _} <> tail:
      same = Bool.or(Bool.and(U32.is_eq(a, x), U32.is_eq(b, y)), Bool.and(U32.is_eq(a, y), U32.is_eq(b, x)))
      Bool.and(Bool.not(same), different_edges(tail, a, b))

def unique_edges(edges: List<&2, A.Edge>) -> Bool:
  match edges:
    case Nil{}:
      True{}
    case A.Edge{a, b, _, _} <> +tail:
      Bool.and(different_edges(tail, a, b), unique_edges(tail))

def selected_faces(faces: List<&2, A.Face>, mask: List<&2, Bool>) -> List<&2, A.Face>:
  match faces mask:
    case head <> tail flag <> rest:
      +next = selected_faces(tail, rest)
      Bool.pick(List<&2, A.Face>, flag, head <> next, next)
    case _ _:
      Nil{}

# Face connectivity as a graph traversal (docs/collections.md).
# The former list definition repeated a Jacobi pass `fuel` times: a face
# joins the mask when one of its edge ids is used by a face already in the
# mask. After k passes the mask holds exactly the faces within k edge-sharing
# steps of a seed (O(fuel * faces * uses)). Here the adjacency is built
# once through the shared edge ids (IdVec: edge id -> faces using it), then a
# level-synchronous BFS runs at most `fuel` levels from the seeds, expanding
# every edge once: O(uses + faces + largest edge id) per call instead of
# O(fuel * faces * uses). The answer is the same flag list: one flag per face
# of the zipped prefix min(|faces|, |mask|), or the mask itself for fuel 0.
# Only equality of edge ids matters, so edge ids far beyond the use count
# (e.g. the faces left after splitting off a component keep their global ids)
# are first renamed to dense ranks 0 .. d-1 by one sort (sparse_steps below):
# O(uses * log uses), and the table size stays linear in the input.
type Walk is Type:
  Walk{faces: V.IdVec<List<&2, U32>>, edges: V.IdVec<List<&2, U32>>, reached: Q.IdSet, expanded: Q.IdSet}

def use_ids(uses: List<&2, T.Coedge>, rest: List<&2, U32>) -> List<&2, U32>:
  match uses:
    case Nil{}:
      rest
    case T.Use{index, _} <> tail:
      index <> use_ids(tail, rest)

def loop_ids(loops: List<&2, A.Loop>) -> List<&2, U32>:
  match loops:
    case Nil{}:
      Nil{}
    case A.Loop{_, uses} <> tail:
      use_ids(uses, loop_ids(tail))

# Edge ids of every face of the zipped prefix.
def face_ids(faces: List<&2, A.Face>, mask: List<&2, Bool>) -> List<&2, List<&2, U32>>:
  match faces mask:
    case A.Face{_, _, loops} <> tail _ <> rest:
      loop_ids(loops) <> face_ids(tail, rest)
    case _ _:
      Nil{}

def mask_prefix(faces: List<&2, A.Face>, mask: List<&2, Bool>) -> List<&2, Bool>:
  match faces mask:
    case _ <> tail flag <> rest:
      flag <> mask_prefix(tail, rest)
    case _ _:
      Nil{}

def ids_max(ids: List<&2, U32>, +best: U32) -> U32:
  match ids:
    case Nil{}:
      best
    case +id <> tail:
      ids_max(tail, Bool.pick(U32, U32.is_lt(best, id), id, best))

def all_max(faces: List<&2, List<&2, U32>>, +best: U32) -> U32:
  match faces:
    case Nil{}:
      best
    case ids <> tail:
      all_max(tail, ids_max(ids, best))

def all_count(faces: List<&2, List<&2, U32>>) -> U32:
  match faces:
    case Nil{}:
      0
    case ids <> tail:
      (U32.from_nat(List.length(&2, U32, ids)) + all_count(tail) : U32)

def ids_vec(r: V.IdVec<List<&2, U32>> & Bool) -> V.IdVec<List<&2, U32>>:
  (v, _) = r
  v

def ids_list(r: V.IdVec<List<&2, U32>> & List<&2, List<&2, U32>>) -> List<&2, List<&2, U32>>:
  (_, xs) = r
  xs

def set_of(r: Q.IdSet & Bool) -> Q.IdSet:
  (s, _) = r
  s

def prepend_face(r: V.IdVec<List<&2, U32>> & List<&2, U32>, edge: U32, face: U32) -> V.IdVec<List<&2, U32>>:
  (v, faces) = r
  ids_vec(V.set(List<&2, U32>, v, edge, face <> faces))

def table_face(ids: List<&2, U32>, +face: U32, table: V.IdVec<List<&2, U32>>) -> V.IdVec<List<&2, U32>>:
  match ids:
    case Nil{}:
      table
    case +edge <> tail:
      table_face(tail, face, prepend_face(V.get(List<&2, U32>, table, edge, Nil{}), edge, face))

# Edge id -> the faces using it, once per use.
def edge_table(faces: List<&2, List<&2, U32>>, +face: U32, table: V.IdVec<List<&2, U32>>) -> V.IdVec<List<&2, U32>>:
  match faces:
    case Nil{}:
      table
    case ids <> tail:
      edge_table(tail, (face + 1 : U32), table_face(ids, face, table))

def seed(flags: List<&2, Bool>, +index: U32, reached: Q.IdSet, frontier: List<&2, U32>) -> Q.IdSet & List<&2, U32>:
  match flags:
    case Nil{}:
      (reached, frontier)
    case True{} <> tail:
      seed(tail, (index + 1 : U32), set_of(Q.add(reached, index)), index <> frontier)
    case False{} <> tail:
      seed(tail, (index + 1 : U32), reached, frontier)

def mark_face(r: Q.IdSet & Bool, +face: U32, next: List<&2, U32>) -> Q.IdSet & List<&2, U32>:
  match r:
    case Tuple{s, True{}}:
      (s, next)
    case Tuple{s, False{}}:
      (set_of(Q.add(s, face)), face <> next)

def mark_faces(faces: List<&2, U32>, r: Q.IdSet & List<&2, U32>) -> Q.IdSet & List<&2, U32>:
  match faces r:
    case +face <> tail Tuple{s, next}:
      mark_faces(tail, mark_face(Q.has(s, face), face, next))
    case Nil{} Tuple{s, next}:
      (s, next)

def walk_marked(r: Q.IdSet & List<&2, U32>, fv: V.IdVec<List<&2, U32>>, ev: V.IdVec<List<&2, U32>>, x: Q.IdSet) -> Walk & List<&2, U32>:
  (reached, next) = r
  (Walk{fv, ev, reached, x}, next)

def edge_faces(r: V.IdVec<List<&2, U32>> & List<&2, U32>, fv: V.IdVec<List<&2, U32>>, reached: Q.IdSet, x: Q.IdSet, next: List<&2, U32>) -> Walk & List<&2, U32>:
  (ev, faces) = r
  walk_marked(mark_faces(faces, (reached, next)), fv, ev, x)

# An edge is expanded once: all its faces join at the level it is first met.
def edge_new(r: Q.IdSet & Bool, +edge: U32, fv: V.IdVec<List<&2, U32>>, ev: V.IdVec<List<&2, U32>>, reached: Q.IdSet, next: List<&2, U32>) -> Walk & List<&2, U32>:
  match r:
    case Tuple{x, True{}}:
      (Walk{fv, ev, reached, x}, next)
    case Tuple{x, False{}}:
      edge_faces(V.get(List<&2, U32>, ev, edge, Nil{}), fv, reached, set_of(Q.add(x, edge)), next)

def expand_edges(ids: List<&2, U32>, r: Walk & List<&2, U32>) -> Walk & List<&2, U32>:
  match ids r:
    case +edge <> tail Tuple{w, next}:
      Walk{fv, ev, reached, x} = w
      expand_edges(tail, edge_new(Q.has(x, edge), edge, fv, ev, reached, next))
    case Nil{} Tuple{w, next}:
      (w, next)

def face_edges(r: V.IdVec<List<&2, U32>> & List<&2, U32>, ev: V.IdVec<List<&2, U32>>, reached: Q.IdSet, x: Q.IdSet, next: List<&2, U32>) -> Walk & List<&2, U32>:
  (fv, ids) = r
  expand_edges(ids, (Walk{fv, ev, reached, x}, next))

def expand_faces(frontier: List<&2, U32>, r: Walk & List<&2, U32>) -> Walk & List<&2, U32>:
  match frontier r:
    case face <> tail Tuple{w, next}:
      Walk{fv, ev, reached, x} = w
      expand_faces(tail, face_edges(V.get(List<&2, U32>, fv, face, Nil{}), ev, reached, x, next))
    case Nil{} Tuple{w, next}:
      (w, next)

# At most fuel levels of (walk, frontier); stops early once a level adds no face.
def levels(fuel: Nat, r: Walk & List<&2, U32>) -> Walk:
  match fuel r:
    case _ Tuple{w, Nil{}}:
      w
    case 0n Tuple{w, _}:
      w
    case 1n+left Tuple{w, frontier}:
      levels(left, expand_faces(frontier, (w, Nil{})))

# One flag per face id 0 .. n-1 from the ascending member list.
def member_flags(n: Nat, +index: U32, +members: List<&2, U32>) -> List<&2, Bool>:
  match n members:
    case 0n _:
      Nil{}
    case 1n+left Nil{}:
      False{} <> member_flags(left, (index + 1 : U32), Nil{})
    case 1n+left head <> tail:
      +hit = U32.is_eq(head, index)
      hit <> member_flags(left, (index + 1 : U32), Bool.pick(List<&2, U32>, hit, tail, members))

def flags_of(r: Q.IdSet & List<&2, U32>, n: Nat) -> List<&2, Bool>:
  (_, members) = r
  member_flags(n, 0, members)

def walk_mask(w: Walk, n: Nat) -> List<&2, Bool>:
  Walk{_, _, reached, _} = w
  flags_of(Q.members(reached), n)

def seeded(r: Q.IdSet & List<&2, U32>, fuel: Nat, fv: V.IdVec<List<&2, U32>>, ev: V.IdVec<List<&2, U32>>, top: U32, n: Nat) -> List<&2, Bool>:
  (reached, frontier) = r
  walk_mask(levels(fuel, (Walk{fv, ev, reached, Q.new((top + 1 : U32))}, frontier)), n)

def graph_steps(fuel: Nat, +ids: List<&2, List<&2, U32>>, flags: List<&2, Bool>, +top: U32) -> List<&2, Bool>:
  +n = List.length(&2, List<&2, U32>, ids)
  fv = ids_vec(V.from_list(List<&2, U32>, ids))
  ev = edge_table(ids, 0, ids_vec(V.filled(List<&2, U32>, (top + 1 : U32), Nil{})))
  seeded(seed(flags, 0, Q.new(U32.from_nat(n)), Nil{}), fuel, fv, ev, top, n)

# One entry per edge use of the zipped prefix: (edge id, face index).
type IdUse is Data:
  IdUse{edge: U32, face: U32}

def id_use_le(a: IdUse, b: IdUse) -> Bool:
  match a b:
    case IdUse{x, _} IdUse{y, _}:
      U32.is_le(x, y)

def face_uses(ids: List<&2, U32>, +face: U32, rest: List<&2, IdUse>) -> List<&2, IdUse>:
  match ids:
    case Nil{}:
      rest
    case edge <> tail:
      IdUse{edge, face} <> face_uses(tail, face, rest)

def edge_uses(faces: List<&2, List<&2, U32>>, +face: U32) -> List<&2, IdUse>:
  match faces:
    case Nil{}:
      Nil{}
    case ids <> tail:
      face_uses(ids, face, edge_uses(tail, (face + 1 : U32)))

# Uses sorted by edge id: equal ids are adjacent, so each run gets the next
# rank, written into its face's dense id list. Answers the table and the top rank.
def rank_uses(uses: List<&2, IdUse>, +prev: U32, +rank: U32, table: V.IdVec<List<&2, U32>>) -> V.IdVec<List<&2, U32>> & U32:
  match uses:
    case Nil{}:
      (table, rank)
    case IdUse{+edge, +face} <> tail:
      +next = Bool.pick(U32, U32.is_eq(edge, prev), rank, (rank + 1 : U32))
      rank_uses(tail, edge, next, prepend_face(V.get(List<&2, U32>, table, face, Nil{}), face, next))

def rank_first(uses: List<&2, IdUse>, table: V.IdVec<List<&2, U32>>) -> V.IdVec<List<&2, U32>> & U32:
  match uses:
    case Nil{}:
      (table, 0)
    case IdUse{+edge, +face} <> tail:
      rank_uses(tail, edge, 0, prepend_face(V.get(List<&2, U32>, table, face, Nil{}), face, 0))

def ranked_steps(r: V.IdVec<List<&2, U32>> & U32, fuel: Nat, flags: List<&2, Bool>) -> List<&2, Bool>:
  (table, top) = r
  graph_steps(fuel, ids_list(V.to_list(List<&2, U32>, table)), flags, top)

# The same flags as graph_steps on the original ids: ranking is injective on
# edge ids, and the reached set does not depend on the order of a face's ids.
def sparse_steps(fuel: Nat, +ids: List<&2, List<&2, U32>>, flags: List<&2, Bool>) -> List<&2, Bool>:
  n = U32.from_nat(List.length(&2, List<&2, U32>, ids))
  uses = List.sort(~IdUse, ~id_use_le, edge_uses(ids, 0))
  ranked_steps(rank_first(uses, ids_vec(V.filled(List<&2, U32>, n, Nil{}))), fuel, flags)

def dense_steps(dense: Bool, fuel: Nat, faces: List<&2, A.Face>, +mask: List<&2, Bool>, ids: List<&2, List<&2, U32>>, top: U32) -> List<&2, Bool>:
  match dense:
    case True{}:
      graph_steps(fuel, ids, mask_prefix(faces, mask), top)
    case False{}:
      sparse_steps(fuel, ids, mask_prefix(faces, mask))

def connectivity_steps(+fuel: Nat, +faces: List<&2, A.Face>, +mask: List<&2, Bool>) -> List<&2, Bool>:
  match fuel:
    case 0n:
      mask
    case _:
      +ids = face_ids(faces, mask)
      +top = all_max(ids, 0)
      dense = U32.is_lt(top, ((all_count(ids) * 4 : U32) + 1024 : U32))
      dense_steps(dense, fuel, faces, mask, ids, top)

def all_reached(mask: List<&2, Bool>) -> Bool:
  match mask:
    case Nil{}:
      True{}
    case head <> tail:
      Bool.and(head, all_reached(tail))

def connected_seed(faces: List<&2, A.Face>, first: Bool) -> List<&2, Bool>:
  match faces:
    case Nil{}:
      Nil{}
    case _ <> tail:
      first <> connected_seed(tail, False{})

def connected(+faces: List<&2, A.Face>) -> Bool:
  all_reached(connectivity_steps(List.length(&2, A.Face, faces), faces, connected_seed(faces, True{})))

# used_flags(edges, index, n)[k] = vertex_used(edges, index + k), for k < n, in
# one pass: an IdSet over slots (endpoint - index), wrapping like the index.
def add_endpoints(edges: List<&2, A.Edge>, +index: U32, s: Q.IdSet) -> Q.IdSet:
  match edges:
    case Nil{}:
      s
    case A.Edge{a, b, _, _} <> tail:
      add_endpoints(tail, index, set_of(Q.add(set_of(Q.add(s, (a - index : U32))), (b - index : U32))))

def used_flags(edges: List<&2, A.Edge>, +index: U32, +n: Nat) -> List<&2, Bool>:
  flags_of(Q.members(add_endpoints(edges, index, Q.new(U32.from_nat(n)))), n)

# Every vertex id index .. index + |vertices| - 1 is an edge endpoint.
def all_used(vertices: List<&2, G.Vec3>, edges: List<&2, A.Edge>, index: U32) -> Bool:
  all_reached(used_flags(edges, index, List.length(&2, G.Vec3, vertices)))

def volume_ring(ids: List<&2, U32>, +vertices: List<&2, G.Vec3>, +first: G.Vec3, +reference: G.Vec3) -> R.Real:
  match ids:
    case a <> +b <> +tail:
      triangle = G.dot(G.sub(first, reference), G.cross(G.sub(vertex(vertices, a), reference), G.sub(vertex(vertices, b), reference)))
      R.add(triangle, volume_ring(b <> tail, vertices, first, reference))
    case _:
      zero()

def volume(polys: List<&2, Polygon>, +vertices: List<&2, G.Vec3>, +reference: G.Vec3) -> R.Real:
  match polys:
    case Nil{}:
      zero()
    case Polygon{_, _, +ids} <> tail:
      one = volume_ring(ids, vertices, vertex(vertices, first_id(ids, 0)), reference)
      R.add(one, volume(tail, vertices, reference))

def valid(+solid: A.Solid, +resolution: R.Real) -> Bool:
  A.Solid{+vertices, +edges, +faces} = solid
  +nv = U32.from_nat(List.length(&2, G.Vec3, vertices))
  ne = U32.from_nat(List.length(&2, A.Edge, edges))
  nf = U32.from_nat(List.length(&2, A.Face, faces))
  topology = Bool.and(S.nonempty(solid), Bool.and(U32.is_eq((nv + nf : U32), (ne + 2 : U32)), Bool.and(S.edges_closed(edges, faces, 0),
    Bool.and(all_used(vertices, edges, 0), Bool.and(connected(faces), Bool.and(unique_vertices(vertices, resolution), unique_edges(edges)))))))
  measured_volume = R.div(volume(polygons(faces, edges), vertices, vertex(vertices, 0)), R.from_f32(6.0))
  positive = R.less(R.mul(resolution, R.mul(resolution, resolution)), measured_volume)
  Bool.and(positive, Bool.and(topology, Bool.and(vertices_valid(vertices), Bool.and(lines_valid(edges, vertices, nv, resolution), faces_valid(faces, vertices, edges, resolution)))))

def side(+point: G.Vec3, +origin: G.Vec3, +normal: G.Vec3, margin: R.Real) -> Side:
  +distance = G.dot(G.sub(point, origin), G.normalize(normal))
  exact = I.coincidence_certificate(R.equal(distance, zero()), normal, point, origin)
  clear = R.less(margin, R.abs(distance))
  Side{Bool.pick(U32, exact, 0, Bool.pick(U32, clear, Bool.pick(U32, R.less(distance, zero()), 1, 2), 3)), distance}

def side_add(one: Side, rest: Sides, index: U32) -> Sides:
  Side{+kind, _} = one
  Sides{valid, bad, negative, positive, values} = rest
  +ok = Bool.not(U32.is_eq(kind, 3))
  Sides{Bool.and(ok, valid), Bool.pick(U32, ok, bad, index), Bool.or(U32.is_eq(kind, 1), negative), Bool.or(U32.is_eq(kind, 2), positive), one <> values}

def sides(vertices: List<&2, G.Vec3>, +origin: G.Vec3, +normal: G.Vec3, +margin: R.Real, +index: U32) -> Sides:
  match vertices:
    case Nil{}:
      Sides{True{}, 0, False{}, False{}, Nil{}}
    case head <> tail:
      side_add(side(head, origin, normal, margin), sides(tail, origin, normal, margin, (index + 1 : U32)), index)

def side_or(found: Maybe<&2, Side>) -> Side:
  match found:
    case Some{value}:
      value
    case None{}:
      Side{3, zero()}

def side_at(values: List<&2, Side>, index: U32) -> Side:
  side_or(List.get(&2, Side, values, U32.to_nat(index)))

def side_kind(side: Side) -> U32:
  Side{kind, _} = side
  kind

def side_distance(side: Side) -> R.Real:
  Side{_, distance} = side
  distance

def find_cut(cuts: List<&2, Cut>, +a: U32, +b: U32) -> Maybe<&2, U32>:
  match cuts:
    case Nil{}:
      None{}
    case Cut{+x, +y, vertex} <> tail:
      found = Bool.or(Bool.and(U32.is_eq(a, x), U32.is_eq(b, y)), Bool.and(U32.is_eq(a, y), U32.is_eq(b, x)))
      Bool.pick(Maybe<&2, U32>, found, Some{vertex}, find_cut(tail, a, b))

def cut_vertex(found: Maybe<&2, U32>, +a: U32, +b: U32, +values: List<&2, Side>, state: ClipState) -> VertexCut:
  match found:
    case Some{index}:
      VertexCut{index, state}
    case None{}:
      ClipState{+vertices, cuts} = state
      +da = side_distance(side_at(values, a))
      db = side_distance(side_at(values, b))
      +start = vertex(vertices, a)
      t = R.div(da, R.sub(da, db))
      point = G.add(start, G.scale(G.sub(vertex(vertices, b), start), t))
      +index = U32.from_nat(List.length(&2, G.Vec3, vertices))
      VertexCut{index, ClipState{List.append(&2, G.Vec3, vertices, [point]), Cut{a, b, index} <> cuts}}

def add_cut(cut: VertexCut, prior: List<&2, U32>) -> RingCut:
  VertexCut{vertex, state} = cut
  RingCut{List.append(&2, U32, prior, [vertex]), state}

def state_cuts(state: ClipState) -> List<&2, Cut>:
  ClipState{_, cuts} = state
  cuts

def segment(crosses: Bool, keep: Bool, +a: U32, +b: U32, values: List<&2, Side>, +state: ClipState) -> RingCut:
  match crosses:
    case False{}:
      RingCut{Bool.pick(List<&2, U32>, keep, [a], Nil{}), state}
    case True{}:
      add_cut(cut_vertex(find_cut(state_cuts(state), a, b), a, b, values, state), Bool.pick(List<&2, U32>, keep, [a], Nil{}))

def ring_cut_vertices(result: RingCut) -> List<&2, U32>:
  RingCut{vertices, _} = result
  vertices

def ring_cut_state(result: RingCut) -> ClipState:
  RingCut{_, state} = result
  state

def ring_prepend(prior: List<&2, U32>, result: RingCut) -> RingCut:
  RingCut{vertices, state} = result
  RingCut{List.append(&2, U32, prior, vertices), state}

def clip_ring(ids: List<&2, U32>, +first: U32, +values: List<&2, Side>, state: ClipState) -> RingCut:
  match ids:
    case Nil{}:
      RingCut{Nil{}, state}
    case +a <> +tail:
      +b = first_id(tail, first)
      +ka = side_kind(side_at(values, a))
      +kb = side_kind(side_at(values, b))
      cross = Bool.or(Bool.and(U32.is_eq(ka, 1), U32.is_eq(kb, 2)), Bool.and(U32.is_eq(ka, 2), U32.is_eq(kb, 1)))
      +one = segment(cross, Bool.not(U32.is_eq(ka, 2)), a, b, values, state)
      ring_prepend(ring_cut_vertices(one), clip_ring(tail, first, values, ring_cut_state(one)))

def has_inside(ids: List<&2, U32>, +values: List<&2, Side>) -> Bool:
  match ids:
    case Nil{}:
      False{}
    case head <> tail:
      Bool.or(U32.is_eq(side_kind(side_at(values, head)), 1), has_inside(tail, values))

def polygons_prepend(has_inside: Bool, surface: A.Surface, sense: Bool, +ids: List<&2, U32>, result: PolygonsCut) -> PolygonsCut:
  PolygonsCut{+polygons, state} = result
  # In a transverse cut of a convex solid, a face without a strictly retained
  # source vertex has no retained area. Its on-plane vertices can still include
  # several collinear IDs; counting them must not create a zero-area face.
  keep = Bool.and(has_inside, U32.is_lt(2, U32.from_nat(List.length(&2, U32, ids))))
  PolygonsCut{Bool.pick(List<&2, Polygon>, keep, Polygon{surface, sense, ids} <> polygons, polygons), state}

def clip_polygons(polys: List<&2, Polygon>, +values: List<&2, Side>, state: ClipState) -> PolygonsCut:
  match polys:
    case Nil{}:
      PolygonsCut{Nil{}, state}
    case Polygon{surface, sense, +ids} <> tail:
      +one = clip_ring(ids, first_id(ids, 0), values, state)
      polygons_prepend(has_inside(ids, values), surface, sense, ring_cut_vertices(one), clip_polygons(tail, values, ring_cut_state(one)))

def find_edge(edges: List<&2, A.Edge>, +a: U32, +b: U32, +index: U32) -> Maybe<&2, T.Coedge>:
  match edges:
    case Nil{}:
      None{}
    case A.Edge{+x, +y, _, _} <> tail:
      +forward = Bool.and(U32.is_eq(a, x), U32.is_eq(b, y))
      reverse = Bool.and(U32.is_eq(a, y), U32.is_eq(b, x))
      Bool.pick(Maybe<&2, T.Coedge>, Bool.or(forward, reverse), Some{T.Use{index, forward}}, find_edge(tail, a, b, (index + 1 : U32)))

def ensure_edge(found: Maybe<&2, T.Coedge>, +a: U32, +b: U32, +vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>) -> EdgeUse:
  match found:
    case Some{use}:
      EdgeUse{use, edges}
    case None{}:
      +start = vertex(vertices, a)
      direction = G.normalize(G.sub(vertex(vertices, b), start))
      index = U32.from_nat(List.length(&2, A.Edge, edges))
      EdgeUse{T.Use{index, True{}}, List.append(&2, A.Edge, edges, [A.Edge{a, b, A.Line{start, direction}, True{}}])}

def use_edges(use: EdgeUse) -> List<&2, A.Edge>:
  EdgeUse{_, edges} = use
  edges

def use_value(use: EdgeUse) -> T.Coedge:
  EdgeUse{value, _} = use
  value

def use_prepend(use: T.Coedge, result: RingBuild) -> RingBuild:
  RingBuild{uses, edges} = result
  RingBuild{use <> uses, edges}

def build_ring(ids: List<&2, U32>, +first: U32, +vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>) -> RingBuild:
  match ids:
    case Nil{}:
      RingBuild{Nil{}, edges}
    case +a <> +tail:
      +b = first_id(tail, first)
      +one = ensure_edge(find_edge(edges, a, b, 0), a, b, vertices, edges)
      use_prepend(use_value(one), build_ring(tail, first, vertices, use_edges(one)))

def build_face(result: RingBuild, surface: A.Surface, sense: Bool, faces: List<&2, A.Face>) -> BuildState:
  RingBuild{uses, edges} = result
  BuildState{edges, List.append(&2, A.Face, faces, [A.Face{surface, sense, [A.Loop{True{}, uses}]}])}

def build_polygons(polys: List<&2, Polygon>, +vertices: List<&2, G.Vec3>, state: BuildState) -> BuildState:
  match polys:
    case Nil{}:
      state
    case Polygon{surface, sense, +ids} <> tail:
      BuildState{edges, faces} = state
      one = build_face(build_ring(ids, first_id(ids, 0), vertices, edges), surface, sense, faces)
      build_polygons(tail, vertices, one)

def open_use(count: S.UseCount, index: U32, +rest: List<&2, T.Coedge>) -> List<&2, T.Coedge>:
  S.UseCount{+forward, +backward} = count
  single = U32.is_eq((forward + backward : U32), 1)
  Bool.pick(List<&2, T.Coedge>, single, T.Use{index, U32.is_eq(backward, 1)} <> rest, rest)

def open_list(counts: List<&2, S.UseCount>, +index: U32) -> List<&2, T.Coedge>:
  match counts:
    case Nil{}:
      Nil{}
    case count <> tail:
      open_use(count, index, open_list(tail, (index + 1 : U32)))

# The uses of edges with exactly one use, in edge order. One pass over the
# uses (S.edge_counts) instead of a count_faces scan per edge.
def open_uses(edges: List<&2, A.Edge>, faces: List<&2, A.Face>, +index: U32) -> List<&2, T.Coedge>:
  open_list(S.edge_counts(faces, index, U32.from_nat(List.length(&2, A.Edge, edges))), index)

def compact_prepend(used: Bool, vertex: G.Vec3, before: U32, after: U32, result: Compact) -> Compact:
  Compact{+vertices, +map} = result
  Bool.pick(Compact, used, Compact{vertex <> vertices, VertexMap{before, after} <> map}, Compact{vertices, map})

def compact_flags(vertices: List<&2, G.Vec3>, flags: List<&2, Bool>, +before: U32, +after: U32) -> Compact:
  match vertices flags:
    case head <> tail +used <> rest:
      compact_prepend(used, head, before, after, compact_flags(tail, rest, (before + 1 : U32), (after + Bool.pick(U32, used, 1, 0) : U32)))
    case _ _:
      Compact{Nil{}, Nil{}}

# Keeps the vertices some edge uses, renumbered densely, with the map.
def compact(+vertices: List<&2, G.Vec3>, edges: List<&2, A.Edge>, +before: U32, +after: U32) -> Compact:
  compact_flags(vertices, used_flags(edges, before, List.length(&2, G.Vec3, vertices)), before, after)

def mapped(map: List<&2, VertexMap>, +index: U32) -> U32:
  match map:
    case Nil{}:
      4294967295
    case VertexMap{before, after} <> tail:
      Bool.pick(U32, U32.is_eq(before, index), after, mapped(tail, index))

def remap_list(edges: List<&2, A.Edge>, +map: List<&2, VertexMap>) -> List<&2, A.Edge>:
  match edges:
    case Nil{}:
      Nil{}
    case A.Edge{a, b, curve, sense} <> tail:
      A.Edge{mapped(map, a), mapped(map, b), curve, sense} <> remap_list(tail, map)

# The same lookups through a table before -> after, built once: the map is
# written back to front, so the first entry for an id wins as in mapped, and
# absent ids answer 4294967295 (the fill value and the fallback of V.get).
def map_top(map: List<&2, VertexMap>, +best: U32) -> U32:
  match map:
    case Nil{}:
      best
    case VertexMap{+before, _} <> tail:
      map_top(tail, Bool.pick(U32, U32.is_lt(best, before), before, best))

def u32_vec(r: V.IdVec<U32> & Bool) -> V.IdVec<U32>:
  (v, _) = r
  v

def map_fill(map: List<&2, VertexMap>, table: V.IdVec<U32>) -> V.IdVec<U32>:
  match map:
    case Nil{}:
      table
    case VertexMap{before, after} <> tail:
      u32_vec(V.set(U32, map_fill(tail, table), before, after))

# The looked-up values of ids, in order; r is the previous lookup.
def lookup_go(ids: List<&2, U32>, r: V.IdVec<U32> & U32) -> List<&2, U32>:
  match ids r:
    case id <> tail Tuple{table, x}:
      x <> lookup_go(tail, V.get(U32, table, id, 4294967295))
    case Nil{} Tuple{_, x}:
      [x]

def lookups(ids: List<&2, U32>, table: V.IdVec<U32>) -> List<&2, U32>:
  match ids:
    case Nil{}:
      Nil{}
    case id <> tail:
      lookup_go(tail, V.get(U32, table, id, 4294967295))

def endpoints(edges: List<&2, A.Edge>) -> List<&2, U32>:
  match edges:
    case Nil{}:
      Nil{}
    case A.Edge{a, b, _, _} <> tail:
      a <> b <> endpoints(tail)

def rebuild(edges: List<&2, A.Edge>, ids: List<&2, U32>) -> List<&2, A.Edge>:
  match edges ids:
    case A.Edge{_, _, curve, sense} <> tail a <> b <> rest:
      A.Edge{a, b, curve, sense} <> rebuild(tail, rest)
    case _ _:
      Nil{}

def remap_table(+edges: List<&2, A.Edge>, table: V.IdVec<U32>) -> List<&2, A.Edge>:
  rebuild(edges, lookups(endpoints(edges), table))

def remap_dense(dense: Bool, edges: List<&2, A.Edge>, map: List<&2, VertexMap>, top: U32) -> List<&2, A.Edge>:
  match dense:
    case True{}:
      remap_table(edges, map_fill(map, u32_vec(V.filled(U32, (top + 1 : U32), 4294967295))))
    case False{}:
      remap_list(edges, map)

# Every edge endpoint replaced by mapped(map, endpoint). Maps whose ids are
# far beyond their length (never produced here) take the list path.
def remap_edges(edges: List<&2, A.Edge>, +map: List<&2, VertexMap>) -> List<&2, A.Edge>:
  +top = map_top(map, 0)
  dense = U32.is_lt(top, ((U32.from_nat(List.length(&2, VertexMap, map)) * 4 : U32) + 1024 : U32))
  remap_dense(dense, edges, map, top)

def compact_solid(result: Compact, edges: List<&2, A.Edge>, faces: List<&2, A.Face>) -> A.Solid:
  Compact{vertices, map} = result
  A.Solid{vertices, remap_edges(edges, map), faces}

def bounds(vertices: List<&2, G.Vec3>, low: G.Vec3, high: G.Vec3) -> A.Bounds:
  match vertices:
    case Nil{}:
      A.Bounds{low, high}
    case G.V3{+x, +y, +z} <> tail:
      G.V3{lx, ly, lz} = low
      G.V3{hx, hy, hz} = high
      bounds(tail, G.V3{R.min(x, lx), R.min(y, ly), R.min(z, lz)}, G.V3{R.max(x, hx), R.max(y, hy), R.max(z, hz)})

def measured(valid: Bool, solid: A.Solid, volume: R.Real, bounds: A.Bounds) -> ClipResult:
  match valid:
    case False{}:
      Unresolved{InvalidClipResult{}}
    case True{}:
      Solid{solid, volume, bounds}

def canonical_curve(curve: A.Curve) -> A.Curve:
  match curve:
    case A.Line{origin, direction}:
      A.Line{origin, G.normalize(direction)}
    case _:
      curve

def canonical_edges(edges: List<&2, A.Edge>) -> List<&2, A.Edge>:
  match edges:
    case Nil{}:
      Nil{}
    case A.Edge{a, b, curve, sense} <> tail:
      A.Edge{a, b, canonical_curve(curve), sense} <> canonical_edges(tail)

def canonical_surface(surface: A.Surface) -> A.Surface:
  match surface:
    case A.Plane{origin, normal, _}:
      A.plane(origin, normal)
    case _:
      surface

def canonical_faces(faces: List<&2, A.Face>) -> List<&2, A.Face>:
  match faces:
    case Nil{}:
      Nil{}
    case A.Face{surface, sense, loops} <> tail:
      A.Face{canonical_surface(surface), sense, loops} <> canonical_faces(tail)

def canonical(solid: A.Solid) -> A.Solid:
  A.Solid{vertices, edges, faces} = solid
  A.Solid{vertices, canonical_edges(edges), canonical_faces(faces)}

def result(+solid: A.Solid, +resolution: R.Real) -> ClipResult:
  A.Solid{+vertices, edges, faces} = solid
  +reference = vertex(vertices, 0)
  +v = R.div(volume(polygons(faces, edges), vertices, reference), R.from_f32(6.0))
  measured(Bool.and(valid(solid, resolution), R.less(R.mul(resolution, R.mul(resolution, resolution)), v)), canonical(solid), v, bounds(vertices, reference, reference))

def capped(rings: B.StitchResult, +vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>, faces: List<&2, A.Face>, origin: G.Vec3, normal: G.Vec3, resolution: R.Real) -> ClipResult:
  match rings:
    case B.Rejected{reason}:
      Unresolved{BoundaryFailure{reason}}
    case B.Stitched{B.Ring{uses} <> Nil{}}:
      cap = {A.Face{A.plane(origin, normal), True{}, [A.Loop{True{}, uses}]} : A.Face}
      solid = compact_solid(compact(vertices, edges, 0, 0), edges, List.append(&2, A.Face, faces, [cap]))
      result(solid, resolution)
    case _:
      Unresolved{InvalidCap{}}

def cap(state: BuildState, +vertices: List<&2, G.Vec3>, origin: G.Vec3, normal: G.Vec3, resolution: R.Real) -> ClipResult:
  BuildState{+edges, +faces} = state
  rings = B.stitch(edges, U32.from_nat(List.length(&2, G.Vec3, vertices)), open_uses(edges, faces, 0))
  capped(rings, vertices, edges, faces, origin, normal, resolution)

def constructed(cut: PolygonsCut, origin: G.Vec3, normal: G.Vec3, resolution: R.Real) -> ClipResult:
  PolygonsCut{polys, ClipState{+vertices, _}} = cut
  cap(build_polygons(polys, vertices, BuildState{Nil{}, Nil{}}), vertices, origin, normal, resolution)

def selected(sides: Sides, +solid: A.Solid, origin: G.Vec3, normal: G.Vec3, resolution: R.Real) -> ClipResult:
  match sides:
    case Sides{False{}, bad, _, _, _}:
      Unresolved{AmbiguousContact{bad}}
    case Sides{True{}, _, False{}, _, _}:
      Empty{}
    case Sides{True{}, _, True{}, False{}, _}:
      result(solid, resolution)
    case Sides{True{}, _, True{}, True{}, values}:
      A.Solid{vertices, edges, faces} = solid
      constructed(clip_polygons(polygons(faces, edges), values, ClipState{vertices, Nil{}}), origin, normal, resolution)

def checked(valid: Bool, +solid: A.Solid, +origin: G.Vec3, +normal: G.Vec3, linear: R.Real, +resolution: R.Real) -> ClipResult:
  match valid:
    case False{}:
      Unresolved{NonConvexOrInconsistent{}}
    case True{}:
      A.Solid{vertices, _, _} = solid
      selected(sides(vertices, origin, normal, R.add(linear, resolution), 0), solid, origin, normal, resolution)

def resolution_checked(ok: Bool, +solid: A.Solid, origin: G.Vec3, normal: G.Vec3, linear: R.Real, +resolution: R.Real) -> ClipResult:
  match ok:
    case False{}:
      Unresolved{ResolutionLimit{}}
    case True{}:
      checked(valid(solid, resolution), solid, origin, normal, linear, resolution)

def inputs_checked(ok: Bool, source_ok: Bool, +solid: A.Solid, +origin: G.Vec3, normal: G.Vec3, tolerance: I.Tolerance) -> ClipResult:
  match ok source_ok:
    case False{} _:
      Unresolved{InvalidInput{}}
    case _ False{}:
      Unresolved{SourceTolerance{}}
    case True{} True{}:
      A.Solid{vertices, _, _} = solid
      +resolution = R.mul(I.angular_guard(), vertex_scale(vertices, R.max(R.from_f32(1.0), I.magnitude(origin))))
      +linear = I.tolerance_linear(tolerance)
      resolution_checked(R.less(resolution, linear), solid, origin, normal, linear, resolution)

def clip(+solid: A.Solid, +origin: G.Vec3, +normal: G.Vec3, +tolerance: I.Tolerance, +source_budget: R.Real) -> ClipResult:
  inputs = Bool.and(I.vec_valid(origin), Bool.and(I.vec_valid(normal), Bool.and(I.direction_valid(normal), Bool.and(I.tolerance_valid(tolerance), I.at_most(I.angular_guard(), I.tolerance_angular(tolerance))))))
  inputs_checked(inputs, Bool.and(I.scalar_valid(source_budget), R.equal(source_budget, zero())), solid, origin, normal, tolerance)

def clip_surface(solid: A.Solid, surface: A.Surface, sense: Bool, tolerance: I.Tolerance) -> ClipResult:
  match surface:
    case A.Plane{origin, +normal, _}:
      outward = Bool.pick(G.Vec3, sense, normal, G.scale(normal, R.neg(R.from_f32(1.0))))
      clip(solid, origin, outward, tolerance, zero())
    case _:
      Unresolved{UnsupportedGeometry{}}

def clip_next(result: ClipResult, face: A.Face, tolerance: I.Tolerance) -> ClipResult:
  match result face:
    case Empty{} _:
      Empty{}
    case Unresolved{reason} _:
      Unresolved{reason}
    case Solid{solid, _, _} A.Face{surface, sense, _}:
      clip_surface(solid, surface, sense, tolerance)

def clip_faces(faces: List<&2, A.Face>, result: ClipResult, +tolerance: I.Tolerance) -> ClipResult:
  match faces:
    case Nil{}:
      result
    case face <> tail:
      clip_faces(tail, clip_next(result, face, tolerance), tolerance)

def intersect_checked(ok: Bool, first: A.Solid, second: A.Solid, tolerance: I.Tolerance, resolution: R.Real) -> ClipResult:
  match ok:
    case False{}:
      Unresolved{NonConvexOrInconsistent{}}
    case True{}:
      A.Solid{_, _, faces} = second
      clip_faces(faces, result(first, resolution), tolerance)

def intersect_inputs(ok: Bool, source_ok: Bool, +first: A.Solid, +second: A.Solid, +tolerance: I.Tolerance) -> ClipResult:
  match ok source_ok:
    case False{} _:
      Unresolved{InvalidInput{}}
    case _ False{}:
      Unresolved{SourceTolerance{}}
    case True{} True{}:
      A.Solid{av, _, _} = first
      A.Solid{bv, _, _} = second
      +resolution = R.mul(I.angular_guard(), R.max(vertex_scale(av, R.from_f32(1.0)), vertex_scale(bv, R.from_f32(1.0))))
      ok = Bool.and(R.less(resolution, I.tolerance_linear(tolerance)), Bool.and(valid(first, resolution), valid(second, resolution)))
      intersect_checked(ok, first, second, tolerance, resolution)

def intersect(first: A.Solid, second: A.Solid, +tolerance: I.Tolerance, +first_budget: R.Real, +second_budget: R.Real) -> ClipResult:
  inputs = Bool.and(I.tolerance_valid(tolerance), I.at_most(I.angular_guard(), I.tolerance_angular(tolerance)))
  budgets = Bool.and(Bool.and(I.scalar_valid(first_budget), R.equal(first_budget, zero())), Bool.and(I.scalar_valid(second_budget), R.equal(second_budget, zero())))
  intersect_inputs(inputs, budgets, first, second, tolerance)
