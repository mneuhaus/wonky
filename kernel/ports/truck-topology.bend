import Base
import ../real.bend as R
import ../precise.bend as G
import ../analytic.bend as A
import ../topology.bend as T
import ../intersections.bend as I
import ../curve-plane.bend as C
import ../face-classification.bend as F
import ../solid-classification.bend as S
import ./types.bend as P

# Truck 8d03d8f: polyline_construction, divide_face and connected_components.
# Apache-2.0 upstream; see docs/port-truck.md. Adapted to immutable exact vertex
# identities: no coordinate hash, tolerance weld, triangulation or foreign code.
type Arc is Data:
  Arc{a: U32, b: U32, origin: P.EdgeOrigin}
type Polygon is Data:
  Polygon{surface: A.Surface, sense: Bool, arcs: List<&2, Arc>, origin: P.FaceOrigin}
type Rings is Data:
  Rings{valid: Bool, rings: List<&2, List<&2, Arc>>}
type Taken is Data:
  Missing{}
  Taken{arc: Arc, rest: List<&2, Arc>}
type Walk is Data:
  Walk{valid: Bool, ring: List<&2, Arc>, rest: List<&2, Arc>}
type Assembly is Data:
  Assembly{valid: Bool, edges: List<&2, A.Edge>, origins: List<&2, P.EdgeOrigin>, faces: List<&2, A.Face>, sources: List<&2, P.FaceOrigin>}
type UseResult is Data:
  UseResult{valid: Bool, use: T.Coedge, edges: List<&2, A.Edge>, origins: List<&2, P.EdgeOrigin>}
type UsesResult is Data:
  UsesResult{valid: Bool, uses: List<&2, T.Coedge>, edges: List<&2, A.Edge>, origins: List<&2, P.EdgeOrigin>}
type FaceRecord is Data:
  FaceRecord{face: A.Face, source: P.FaceOrigin}
type Partition is Data:
  Partition{members: List<&2, FaceRecord>, rest: List<&2, FaceRecord>}
type IndexMap is Data:
  IndexMap{old: U32, new: U32}
type EdgeSelection is Data:
  EdgeSelection{edges: List<&2, A.Edge>, origins: List<&2, P.EdgeOrigin>, map: List<&2, IndexMap>}
type VertexSelection is Data:
  VertexSelection{vertices: List<&2, G.Vec3>, map: List<&2, IndexMap>}

def zero() -> R.Real:
  R.from_f32(0.0)

def point( +found: Maybe<&2, G.Vec3>) -> G.Vec3:
  match found:
    case Some{value}:
      value
    case None{}:
      G.v3(0.0, 0.0, 0.0)

def vertex( +vertices: List<&2, G.Vec3>, +index: U32) -> G.Vec3:
  point(List.get(&2, G.Vec3, vertices, U32.to_nat(index)))

def edge( +found: Maybe<&2, A.Edge>) -> A.Edge:
  match found:
    case Some{value}:
      value
    case None{}:
      A.Edge{0, 0, A.Line{G.v3(0.0, 0.0, 0.0), G.v3(1.0, 0.0, 0.0)}, True{}}

def oriented_arc( +value: A.Edge, +index: U32, +forward: Bool) -> Arc:
  A.Edge{+a, +b, _, _} = value
  Arc{Bool.pick(U32, forward, a, b), Bool.pick(U32, forward, b, a), P.SourceEdge{index}}

def use_arc( +use: T.Coedge, +edges: List<&2, A.Edge>) -> Arc:
  T.Use{+index, forward} = use
  oriented_arc(edge(List.get(&2, A.Edge, edges, U32.to_nat(index))), index, forward)

def arcs( +uses: List<&2, T.Coedge>, +edges: List<&2, A.Edge>) -> List<&2, Arc>:
  match uses:
    case Nil{}:
      Nil{}
    case use <> tail:
      use_arc(use, edges) <> arcs(tail, edges)

def reverse_arc( +arc: Arc) -> Arc:
  Arc{a, b, origin} = arc
  Arc{b, a, origin}

def reverse_arcs( +values: List<&2, Arc>) -> List<&2, Arc>:
  match values:
    case Nil{}:
      Nil{}
    case head <> tail:
      reverse_arc(head) <> reverse_arcs(tail)

def outward( +surface: A.Surface, +sense: Bool) -> G.Vec3:
  match surface:
    case A.Plane{_, normal, _}:
      G.scale(G.normalize(normal), Bool.pick(R.Real, sense, R.from_f32(1.0), R.neg(R.from_f32(1.0))))
    case _:
      G.v3(0.0, 0.0, 0.0)

def area( +arcs: List<&2, Arc>, +vertices: List<&2, G.Vec3>, +reference: G.Vec3, +normal: G.Vec3) -> R.Real:
  match arcs:
    case Nil{}:
      zero()
    case Arc{a, b, _} <> tail:
      +here = G.dot(G.cross(G.sub(vertex(vertices, a), reference), G.sub(vertex(vertices, b), reference)), normal)
      R.add(here, area(tail, vertices, reference, normal))

def count( +arcs: List<&2, Arc>, +id: U32, +start: Bool) -> U32:
  match arcs:
    case Nil{}:
      0
    case Arc{a, b, _} <> tail:
      (Bool.pick(U32, U32.is_eq(id, Bool.pick(U32, start, a, b)), 1, 0) + count(tail, id, start) : U32)

def degrees( +arcs: List<&2, Arc>, +all: List<&2, Arc>) -> Bool:
  match arcs:
    case Nil{}:
      True{}
    case Arc{+a, +b, _} <> tail:
      +here = Bool.and(Bool.not(U32.is_eq(a, b)), Bool.and(U32.is_eq(count(all, a, True{}), 1), U32.is_eq(count(all, b, False{}), 1)))
      Bool.and(here, degrees(tail, all))

def restore( +taken: Taken, +arc: Arc) -> Taken:
  match taken:
    case Missing{}:
      Missing{}
    case Taken{found, rest}:
      Taken{found, arc <> rest}

def take( +arcs: List<&2, Arc>, +id: U32) -> Taken:
  match arcs:
    case Nil{}:
      Missing{}
    case +head <> +tail:
      Arc{a, _, _} = head
      Bool.pick(Taken, U32.is_eq(a, id), Taken{head, tail}, restore(take(tail, id), head))

def prepend_walk( +result: Walk, +arc: Arc) -> Walk:
  Walk{valid, ring, rest} = result
  Walk{valid, arc <> ring, rest}

def taken_end(found: Taken) -> U32:
  match found:
    case Taken{Arc{_, end, _}, _}:
      end
    case _:
      0

def taken_rest(found: Taken) -> List<&2, Arc>:
  match found:
    case Taken{_, rest}:
      rest
    case _:
      Nil{}

def walk_taken( +found: Taken, result: Walk) -> Walk:
  match found:
    case Missing{}:
      Walk{False{}, Nil{}, Nil{}}
    case Taken{+arc, rest}:
      prepend_walk(result, arc)

def walk( +fuel: Nat, +arcs: List<&2, Arc>, +first: U32, +at: U32) -> Walk:
  match fuel:
    case 0n:
      Walk{U32.is_eq(first, at), Nil{}, arcs}
    case 1n+left:
      +found = take(arcs, at)
      +result = walk(left, taken_rest(found), first, taken_end(found))
      Bool.pick(Walk, U32.is_eq(first, at), Walk{True{}, Nil{}, arcs}, walk_taken(found, result))

def add_ring( +result: Rings, +ring: List<&2, Arc>) -> Rings:
  Rings{valid, rings} = result
  Rings{valid, ring <> rings}

def walk_rest(result: Walk) -> List<&2, Arc>:
  Walk{_, _, rest} = result
  rest

def add_walk( +walked: Walk, +first: Arc, next: Rings) -> Rings:
  match walked:
    case Walk{False{}, _, _}:
      Rings{False{}, Nil{}}
    case Walk{True{}, ring, rest}:
      add_ring(next, first <> ring)

def construct_rings( +fuel: Nat, +arcs: List<&2, Arc>) -> Rings:
  match fuel arcs:
    case _ Nil{}:
      Rings{True{}, Nil{}}
    case 0n _:
      Rings{False{}, Nil{}}
    case 1n+ +left +head <> tail:
      Arc{a, b, _} = head
      +result = walk(left, tail, a, b)
      add_walk(result, head, construct_rings(left, walk_rest(result)))

def stitch_checked( +valid: Bool, +arcs: List<&2, Arc>) -> Rings:
  match valid:
    case False{}:
      Rings{False{}, Nil{}}
    case True{}:
      construct_rings(List.length(&2, Arc, arcs), arcs)

def stitch(+arcs: List<&2, Arc>) -> Rings:
  stitch_checked(degrees(arcs, arcs), arcs)

def one_ring( +result: Rings) -> Bool:
  match result:
    case Rings{True{}, _ <> Nil{}}:
      True{}
    case _:
      False{}

def same_side(+a: R.Real, +b: R.Real, +margin: R.Real) -> Bool:
  Bool.or(Bool.and(R.less(margin, a), R.less(margin, b)), Bool.and(R.less(a, R.neg(margin)), R.less(b, R.neg(margin))))

def separate(+a: G.Vec3, +b: G.Vec3, +c: G.Vec3, +d: G.Vec3, +normal: G.Vec3, +margin: R.Real) -> Bool:
  +ab = G.normalize(G.sub(b, a))
  +left = G.cross(normal, ab)
  +ca = G.sub(c, a)
  +da = G.sub(d, a)
  +first = same_side(G.dot(ca, left), G.dot(da, left), margin)
  +second = same_side(G.dot(G.sub(a, c), G.cross(normal, G.normalize(G.sub(d, c)))), G.dot(G.sub(b, c), G.cross(normal, G.normalize(G.sub(d, c)))), margin)
  +x = G.dot(ca, ab)
  +y = G.dot(da, ab)
  +disjoint = Bool.or(R.less(R.max(x, y), R.neg(margin)), R.less(R.add(I.length(G.sub(b, a)), margin), R.min(x, y)))
  Bool.or(first, Bool.or(second, disjoint))

def clear_pairs( +arc: Arc, +others: List<&2, Arc>, +vertices: List<&2, G.Vec3>, +normal: G.Vec3, +margin: R.Real) -> Bool:
  Arc{+a, +b, +origin} = arc
  match others:
    case Nil{}:
      True{}
    case Arc{+c, +d, _} <> tail:
      +adjacent = Bool.or(U32.is_eq(a, d), U32.is_eq(b, c))
      +safe = Bool.or(adjacent, separate(vertex(vertices, a), vertex(vertices, b), vertex(vertices, c), vertex(vertices, d), normal, margin))
      Bool.and(safe, clear_pairs(Arc{a, b, origin}, tail, vertices, normal, margin))

def simple( +arcs: List<&2, Arc>, +vertices: List<&2, G.Vec3>, +normal: G.Vec3, +margin: R.Real) -> Bool:
  match arcs:
    case Nil{}:
      True{}
    case +head <> +tail:
      Bool.and(clear_pairs(head, tail, vertices, normal, margin), simple(tail, vertices, normal, margin))

def prepared_ok( +result: F.LoopPreparation) -> Bool:
  match result:
    case F.PreparedLoops{F.PreparedLoop{True{}, +edges} <> Nil{}}:
      Bool.and(F.loop_valid(edges), U32.is_lt(2, U32.from_nat(List.length(&2, F.PreparedEdge, edges))))
    case _:
      False{}

def face_valid( +face: A.Face, +vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>, +resolution: R.Real) -> Bool:
  match face:
    case A.Face{+surface, +sense, +loops}:
      match surface loops:
        case A.Plane{+origin, +normal, +x} A.Loop{True{}, uses} <> Nil{}:
          +boundary = arcs(uses, edges)
          +frame = Bool.and(I.vec_valid(origin), Bool.and(I.vec_valid(normal), Bool.and(I.vec_valid(x), Bool.and(I.direction_valid(normal), I.direction_valid(x)))))
          +geometric = Bool.and(C.frame_valid(normal, x), prepared_ok(F.prepare_loops(loops, vertices, edges, Nil{}, origin, G.normalize(normal), resolution)))
          +ring = Bool.and(one_ring(stitch(boundary)), Bool.and(simple(boundary, vertices, outward(surface, sense), resolution), R.less(R.mul(resolution, resolution), area(boundary, vertices, origin, outward(surface, sense)))))
          Bool.and(frame, Bool.and(geometric, ring))
        case _ _:
          False{}

def faces_valid( +faces: List<&2, A.Face>, +vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>, +resolution: R.Real) -> Bool:
  match faces:
    case Nil{}:
      True{}
    case head <> tail:
      Bool.and(face_valid(head, vertices, edges, resolution), faces_valid(tail, vertices, edges, resolution))

def vertices_valid( +vertices: List<&2, G.Vec3>) -> Bool:
  match vertices:
    case Nil{}:
      True{}
    case head <> tail:
      Bool.and(I.vec_valid(head), vertices_valid(tail))

def source_lines( +edges: List<&2, A.Edge>, +vertices: List<&2, G.Vec3>, +resolution: R.Real) -> Bool:
  match edges:
    case Nil{}:
      True{}
    case A.Edge{+a, +b, A.Line{_, _}, _} <> tail:
      +count = U32.from_nat(List.length(&2, G.Vec3, vertices))
      +good = Bool.and(U32.is_lt(a, count), Bool.and(U32.is_lt(b, count), Bool.and(Bool.not(U32.is_eq(a, b)), R.less(resolution, I.length(G.sub(vertex(vertices, a), vertex(vertices, b)))))))
      Bool.and(good, source_lines(tail, vertices, resolution))
    case _:
      False{}

def separated(vertices: List<&2, G.Vec3>, +point: G.Vec3, +resolution: R.Real) -> Bool:
  match vertices:
    case Nil{}:
      True{}
    case head <> tail:
      Bool.and(R.less(resolution, I.length(G.sub(head, point))), separated(tail, point, resolution))

def unique_points(vertices: List<&2, G.Vec3>, +resolution: R.Real) -> Bool:
  match vertices:
    case Nil{}:
      True{}
    case head <> +tail:
      Bool.and(separated(tail, head, resolution), unique_points(tail, resolution))

def contains_vertex(edges: List<&2, A.Edge>, +index: U32) -> Bool:
  match edges:
    case Nil{}:
      False{}
    case A.Edge{a, b, _, _} <> tail:
      Bool.or(Bool.or(U32.is_eq(a, index), U32.is_eq(b, index)), contains_vertex(tail, index))

def all_used(vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>, +index: U32) -> Bool:
  match vertices:
    case Nil{}:
      True{}
    case _ <> tail:
      Bool.and(contains_vertex(edges, index), all_used(tail, edges, (index + 1 : U32)))

def different_edges(edges: List<&2, A.Edge>, +a: U32, +b: U32) -> Bool:
  match edges:
    case Nil{}:
      True{}
    case A.Edge{+c, +d, _, _} <> tail:
      same = Bool.or(Bool.and(U32.is_eq(a, c), U32.is_eq(b, d)), Bool.and(U32.is_eq(a, d), U32.is_eq(b, c)))
      Bool.and(Bool.not(same), different_edges(tail, a, b))

def unique_edges(edges: List<&2, A.Edge>) -> Bool:
  match edges:
    case Nil{}:
      True{}
    case A.Edge{a, b, _, _} <> +tail:
      Bool.and(different_edges(tail, a, b), unique_edges(tail))

def valid(+solid: A.Solid, +resolution: R.Real) -> Bool:
  A.Solid{+vertices, +edges, +faces} = solid
  +identity = Bool.and(unique_points(vertices, resolution), Bool.and(unique_edges(edges), all_used(vertices, edges, 0)))
  Bool.and(identity, Bool.and(S.nonempty(solid), Bool.and(vertices_valid(vertices), Bool.and(source_lines(edges, vertices, resolution), Bool.and(S.edges_closed(edges, faces, 0), faces_valid(faces, vertices, edges, resolution))))))

def source_faces( +faces: List<&2, A.Face>, +index: U32) -> List<&2, P.FaceOrigin>:
  match faces:
    case Nil{}:
      Nil{}
    case _ <> tail:
      P.SourceFace{index} <> source_faces(tail, (index + 1 : U32))

def source_edges( +edges: List<&2, A.Edge>, +index: U32) -> List<&2, P.EdgeOrigin>:
  match edges:
    case Nil{}:
      Nil{}
    case _ <> tail:
      P.SourceEdge{index} <> source_edges(tail, (index + 1 : U32))

def auto_domains( +edges: List<&2, A.Edge>) -> List<&2, F.DomainChoice>:
  match edges:
    case Nil{}:
      Nil{}
    case _ <> tail:
      F.AutoDomain{} <> auto_domains(tail)

def origin_equal( +a: P.EdgeOrigin, +b: P.EdgeOrigin) -> Bool:
  match a b:
    case P.SourceEdge{x} P.SourceEdge{y}:
      U32.is_eq(x, y)
    case P.CutEdge{x} P.CutEdge{y}:
      U32.is_eq(x, y)
    case P.SurfaceSeam{x} P.SurfaceSeam{y}:
      U32.is_eq(x, y)
    case _ _:
      False{}

def found_origin( +found: Maybe<&2, P.EdgeOrigin>, +origin: P.EdgeOrigin) -> Bool:
  match found:
    case Some{value}:
      origin_equal(value, origin)
    case None{}:
      False{}

def find_edge( +edges: List<&2, A.Edge>, +a: U32, +b: U32, +index: U32) -> Maybe<&2, T.Coedge>:
  match edges:
    case Nil{}:
      None{}
    case A.Edge{+x, +y, _, _} <> tail:
      +forward = Bool.and(U32.is_eq(a, x), U32.is_eq(b, y))
      +reverse = Bool.and(U32.is_eq(a, y), U32.is_eq(b, x))
      Bool.pick(Maybe<&2, T.Coedge>, Bool.or(forward, reverse), Some{T.Use{index, forward}}, find_edge(tail, a, b, (index + 1 : U32)))

def ensure( +arc: Arc, +found: Maybe<&2, T.Coedge>, +vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>, +origins: List<&2, P.EdgeOrigin>) -> UseResult:
  Arc{+a, +b, +origin} = arc
  match found:
    case Some{+use}:
      T.Use{index, _} = use
      UseResult{found_origin(List.get(&2, P.EdgeOrigin, origins, U32.to_nat(index)), origin), use, edges, origins}
    case None{}:
      +start = vertex(vertices, a)
      +curve = {A.Line{start, G.normalize(G.sub(vertex(vertices, b), start))} : A.Curve}
      UseResult{True{}, T.Use{U32.from_nat(List.length(&2, A.Edge, edges)), True{}}, List.append(&2, A.Edge, edges, [A.Edge{a, b, curve, True{}}]), List.append(&2, P.EdgeOrigin, origins, [origin])}

def use_prepend( +result: UsesResult, +valid: Bool, +use: T.Coedge) -> UsesResult:
  UsesResult{rest_valid, rest, all_edges, all_origins} = result
  UsesResult{Bool.and(valid, rest_valid), use <> rest, all_edges, all_origins}

def uses_next( +one: UseResult, result: UsesResult) -> UsesResult:
  UseResult{valid, use, next_edges, next_origins} = one
  use_prepend(result, valid, use)

def use_edges(result: UseResult) -> List<&2, A.Edge>:
  UseResult{_, _, edges, _} = result
  edges

def use_origins(result: UseResult) -> List<&2, P.EdgeOrigin>:
  UseResult{_, _, _, origins} = result
  origins

def uses( +arcs: List<&2, Arc>, +vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>, +origins: List<&2, P.EdgeOrigin>) -> UsesResult:
  match arcs:
    case Nil{}:
      UsesResult{True{}, Nil{}, edges, origins}
    case +arc <> tail:
      Arc{a, b, _} = arc
      +one = ensure(arc, find_edge(edges, a, b, 0), vertices, edges, origins)
      uses_next(one, uses(tail, vertices, use_edges(one), use_origins(one)))

def assembled_face( +result: UsesResult, +valid: Bool, +surface: A.Surface, +sense: Bool, +source: P.FaceOrigin, +faces: List<&2, A.Face>, +sources: List<&2, P.FaceOrigin>) -> Assembly:
  UsesResult{next_valid, uses, next_edges, next_origins} = result
  +face = {A.Face{surface, sense, [A.Loop{True{}, uses}]} : A.Face}
  Assembly{Bool.and(valid, next_valid), next_edges, next_origins, List.append(&2, A.Face, faces, [face]), List.append(&2, P.FaceOrigin, sources, [source])}

def assemble( +polygons: List<&2, Polygon>, +vertices: List<&2, G.Vec3>, +state: Assembly) -> Assembly:
  match polygons:
    case Nil{}:
      state
    case Polygon{surface, sense, arcs, source} <> tail:
      Assembly{valid, edges, origins, faces, sources} = state
      assemble(tail, vertices, assembled_face(uses(arcs, vertices, edges, origins), valid, surface, sense, source, faces, sources))

def records( +faces: List<&2, A.Face>, +sources: List<&2, P.FaceOrigin>) -> List<&2, FaceRecord>:
  match faces sources:
    case face <> tail source <> rest:
      FaceRecord{face, source} <> records(tail, rest)
    case _ _:
      Nil{}

def record_faces( +records: List<&2, FaceRecord>) -> List<&2, A.Face>:
  match records:
    case Nil{}:
      Nil{}
    case FaceRecord{face, _} <> tail:
      face <> record_faces(tail)

def record_sources( +records: List<&2, FaceRecord>) -> List<&2, P.FaceOrigin>:
  match records:
    case Nil{}:
      Nil{}
    case FaceRecord{_, source} <> tail:
      source <> record_sources(tail)

def count_used( +count: S.UseCount) -> Bool:
  S.UseCount{a, b} = count
  Bool.not(U32.is_eq((a + b : U32), 0))

def used( +faces: List<&2, A.Face>, +index: U32) -> Bool:
  count_used(S.count_faces(faces, index))

def touches_uses( +uses: List<&2, T.Coedge>, +faces: List<&2, A.Face>) -> Bool:
  match uses:
    case Nil{}:
      False{}
    case T.Use{index, _} <> tail:
      Bool.or(used(faces, index), touches_uses(tail, faces))

def touches( +face: A.Face, +records: List<&2, FaceRecord>) -> Bool:
  match face:
    case A.Face{_, _, A.Loop{_, uses} <> Nil{}}:
      touches_uses(uses, record_faces(records))
    case _:
      False{}

def partition_next( +result: Partition, +related: Bool, +head: FaceRecord) -> Partition:
  Partition{+members, +rest} = result
  Bool.pick(Partition, related, Partition{head <> members, rest}, Partition{members, head <> rest})

def partition( +records: List<&2, FaceRecord>, +known: List<&2, FaceRecord>) -> Partition:
  match records:
    case Nil{}:
      Partition{Nil{}, Nil{}}
    case +head <> tail:
      FaceRecord{face, _} = head
      partition_next(partition(tail, known), touches(face, known), head)

def partition_members(result: Partition) -> List<&2, FaceRecord>:
  Partition{members, _} = result
  members

def partition_rest(result: Partition) -> List<&2, FaceRecord>:
  Partition{_, rest} = result
  rest

def grow( +fuel: Nat, +known: List<&2, FaceRecord>, +rest: List<&2, FaceRecord>) -> Partition:
  match fuel:
    case 0n:
      Partition{known, rest}
    case 1n+left:
      +parts = partition(rest, known)
      grow(left, List.append(&2, FaceRecord, known, partition_members(parts)), partition_rest(parts))

def lookup( +map: List<&2, IndexMap>, +index: U32) -> U32:
  match map:
    case Nil{}:
      4294967295
    case IndexMap{old, new} <> tail:
      Bool.pick(U32, U32.is_eq(old, index), new, lookup(tail, index))

def select_edge_next( +result: EdgeSelection, +keep: Bool, +edge: A.Edge, +origin: P.EdgeOrigin, +old: U32, +next: U32) -> EdgeSelection:
  EdgeSelection{+values, +sources, +map} = result
  Bool.pick(EdgeSelection, keep, EdgeSelection{edge <> values, origin <> sources, IndexMap{old, next} <> map}, EdgeSelection{values, sources, map})

def select_edges( +edges: List<&2, A.Edge>, +origins: List<&2, P.EdgeOrigin>, +faces: List<&2, A.Face>, +old: U32, +next: U32) -> EdgeSelection:
  match edges origins:
    case edge <> tail origin <> rest:
      +keep = used(faces, old)
      select_edge_next(select_edges(tail, rest, faces, (old + 1 : U32), (next + Bool.pick(U32, keep, 1, 0) : U32)), keep, edge, origin, old, next)
    case _ _:
      EdgeSelection{Nil{}, Nil{}, Nil{}}

def vertex_used( +edges: List<&2, A.Edge>, +index: U32) -> Bool:
  match edges:
    case Nil{}:
      False{}
    case A.Edge{a, b, _, _} <> tail:
      Bool.or(Bool.or(U32.is_eq(a, index), U32.is_eq(b, index)), vertex_used(tail, index))

def select_vertex_next( +result: VertexSelection, +keep: Bool, +point: G.Vec3, +old: U32, +next: U32) -> VertexSelection:
  VertexSelection{+values, +map} = result
  Bool.pick(VertexSelection, keep, VertexSelection{point <> values, IndexMap{old, next} <> map}, VertexSelection{values, map})

def select_vertices( +vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>, +old: U32, +next: U32) -> VertexSelection:
  match vertices:
    case Nil{}:
      VertexSelection{Nil{}, Nil{}}
    case point <> tail:
      +keep = vertex_used(edges, old)
      select_vertex_next(select_vertices(tail, edges, (old + 1 : U32), (next + Bool.pick(U32, keep, 1, 0) : U32)), keep, point, old, next)

def normalized_curve(curve: A.Curve) -> A.Curve:
  match curve:
    case A.Line{origin, direction}:
      A.Line{origin, G.normalize(direction)}
    case _:
      curve

def remap_edges( +edges: List<&2, A.Edge>, +map: List<&2, IndexMap>) -> List<&2, A.Edge>:
  match edges:
    case Nil{}:
      Nil{}
    case A.Edge{a, b, curve, sense} <> tail:
      A.Edge{lookup(map, a), lookup(map, b), normalized_curve(curve), sense} <> remap_edges(tail, map)

def remap_uses( +uses: List<&2, T.Coedge>, +map: List<&2, IndexMap>) -> List<&2, T.Coedge>:
  match uses:
    case Nil{}:
      Nil{}
    case T.Use{index, forward} <> tail:
      T.Use{lookup(map, index), forward} <> remap_uses(tail, map)

def remap_faces( +faces: List<&2, A.Face>, +map: List<&2, IndexMap>) -> List<&2, A.Face>:
  match faces:
    case A.Face{surface, sense, A.Loop{outer, uses} <> Nil{}} <> tail:
      A.Face{surface, sense, [A.Loop{outer, remap_uses(uses, map)}]} <> remap_faces(tail, map)
    case _:
      Nil{}

def compact_component( +points: VertexSelection, +selected: List<&2, A.Edge>, +sources: List<&2, P.EdgeOrigin>, +map: List<&2, IndexMap>, +records: List<&2, FaceRecord>) -> P.Component:
  VertexSelection{vertices, vertex_map} = points
  +new_edges = remap_edges(selected, vertex_map)
  P.Component{A.Solid{vertices, new_edges, remap_faces(record_faces(records), map)}, auto_domains(new_edges), record_sources(records), sources}

def component_edges( +selection: EdgeSelection, +vertices: List<&2, G.Vec3>, +records: List<&2, FaceRecord>) -> P.Component:
  EdgeSelection{+selected, sources, map} = selection
  compact_component(select_vertices(vertices, selected, 0, 0), selected, sources, map, records)

def component(+records: List<&2, FaceRecord>, +vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>, +origins: List<&2, P.EdgeOrigin>) -> P.Component:
  component_edges(select_edges(edges, origins, record_faces(records), 0, 0), vertices, records)

def components( +fuel: Nat, +records: List<&2, FaceRecord>, +vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>, +origins: List<&2, P.EdgeOrigin>) -> List<&2, P.Component>:
  match fuel records:
    case 1n+ +left head <> tail:
      +parts = grow(left, [head], tail)
      component(partition_members(parts), vertices, edges, origins) <> components(left, partition_rest(parts), vertices, edges, origins)
    case _ _:
      Nil{}

def volume_arcs( +arcs: List<&2, Arc>, +vertices: List<&2, G.Vec3>, +first: G.Vec3, +reference: G.Vec3) -> R.Real:
  match arcs:
    case Nil{}:
      zero()
    case Arc{a, b, _} <> tail:
      +here = G.dot(G.sub(first, reference), G.cross(G.sub(vertex(vertices, a), reference), G.sub(vertex(vertices, b), reference)))
      R.add(here, volume_arcs(tail, vertices, first, reference))

def first_point( +arcs: List<&2, Arc>, +vertices: List<&2, G.Vec3>, +fallback: G.Vec3) -> G.Vec3:
  match arcs:
    case Arc{a, _, _} <> _:
      vertex(vertices, a)
    case _:
      fallback

def volume_faces( +faces: List<&2, A.Face>, +vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>, +reference: G.Vec3) -> R.Real:
  match faces:
    case A.Face{_, _, A.Loop{_, +uses} <> Nil{}} <> tail:
      +boundary = arcs(uses, edges)
      R.add(volume_arcs(boundary, vertices, first_point(boundary, vertices, reference), reference), volume_faces(tail, vertices, edges, reference))
    case _:
      zero()

def volume(+solid: A.Solid) -> R.Real:
  A.Solid{+vertices, edges, faces} = solid
  R.div(volume_faces(faces, vertices, edges, vertex(vertices, 0)), R.from_f32(6.0))

def components_valid( +bodies: List<&2, P.Component>, +resolution: R.Real) -> Bool:
  match bodies:
    case Nil{}:
      True{}
    case P.Component{+solid, _, _, _} <> tail:
      Bool.and(valid(solid, resolution), Bool.and(R.less(R.mul(resolution, R.mul(resolution, resolution)), volume(solid)), components_valid(tail, resolution)))

def result_checked( +valid: Bool, +bodies: List<&2, P.Component>) -> P.Result:
  match valid bodies:
    case False{} _:
      P.Unresolved{P.ConstructionFailure{}}
    case True{} Nil{}:
      P.Empty{}
    case True{} P.Component{solid, domains, faces, edges} <> Nil{}:
      P.Clipped{solid, domains, faces, edges}
    case True{} values:
      P.Components{values}

def finish( +vertices: List<&2, G.Vec3>, +state: Assembly, +resolution: R.Real) -> P.Result:
  Assembly{valid, +edges, origins, +faces, sources} = state
  +bodies = components(List.length(&2, A.Face, faces), records(faces, sources), vertices, edges, origins)
  result_checked(Bool.and(valid, components_valid(bodies, resolution)), bodies)
