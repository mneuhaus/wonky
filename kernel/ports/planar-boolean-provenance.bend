import Base
import ../real.bend as R
import ../precise.bend as G
import ../analytic.bend as A
import ../topology.bend as Topology
import ../intersections.bend as I
import ../curve-plane.bend as C
import ../face-classification.bend as F
import ../solid-classification.bend as S
import ../halfspace.bend as H
import ./types.bend as P
import ./occt-planar.bend as V
import ./planar-boolean-arrangement.bend as D
import ./planar-boolean-types.bend as T

type Context is Data:
  Context{first: A.Solid, ad: List<&2, F.DomainChoice>, second: A.Solid, bd: List<&2, F.DomainChoice>, tolerance: I.Tolerance, resolution: R.Real, subtraction: Bool}
type Owners is Data:
  Owners{valid: Bool, refs: List<&2, T.FaceRef>}
type FaceMap is Data:
  FaceMap{valid: Bool, origins: List<&2, T.FaceOrigin>}
type EdgeMap is Data:
  EdgeMap{valid: Bool, origins: List<&2, T.EdgeOrigin>}
type SegmentRange is Data:
  SegmentRange{valid: Bool, first: R.Real, last: R.Real}

def on_face(solid: A.Solid, face: A.Face, domains: List<&2, F.DomainChoice>, point: G.Vec3, tolerance: I.Tolerance) -> F.Classification:
  A.Solid{vertices, edges, _} = solid
  F.face_surface(face, vertices, edges, domains, point, tolerance, R.from_f32(0.0))

def covered(result: F.Classification) -> Bool:
  match result:
    case F.Inside{_}:
      True{}
    case F.Boundary{_, _}:
      True{}
    case _:
      False{}

# A convex patch cannot be wholly owned by a trimmed source face if any
# source trim segment enters its relative interior. Vertex/centroid samples
# alone miss a concave notch crossing between those samples. This test uses
# the native construction rounding guard, never the query tolerance.
def range_step(a_inside: Bool, b_inside: Bool, +da: R.Real, db: R.Real, range: SegmentRange) -> SegmentRange:
  match a_inside b_inside range:
    case False{} False{} _:
      SegmentRange{False{}, R.from_f32(0.0), R.from_f32(0.0)}
    case True{} True{} SegmentRange{valid, first, last}:
      SegmentRange{valid, first, last}
    case True{} False{} SegmentRange{valid, first, last}:
      SegmentRange{valid, first, R.min(last, R.div(da, R.sub(da, db)))}
    case False{} True{} SegmentRange{valid, first, last}:
      SegmentRange{valid, R.max(first, R.div(da, R.sub(da, db))), last}

def clip_segment(ids: List<&2, U32>, range: SegmentRange, +first: U32, +vertices: List<&2, G.Vec3>, +normal: G.Vec3, +a: G.Vec3, +b: G.Vec3, +resolution: R.Real) -> SegmentRange:
  match ids range:
    case _ SegmentRange{False{}, x, y}:
      SegmentRange{False{}, x, y}
    case Nil{} SegmentRange{valid, x, y}:
      SegmentRange{valid, x, y}
    case index <> +tail prior:
      +p = H.vertex(vertices, index)
      +inward = G.normalize(G.cross(normal, G.sub(H.vertex(vertices, H.first_id(tail, first)), p)))
      +da = R.sub(G.dot(G.sub(a, p), inward), resolution)
      +db = R.sub(G.dot(G.sub(b, p), inward), resolution)
      next = range_step(R.less(R.from_f32(0.0), da), R.less(R.from_f32(0.0), db), da, db, prior)
      clip_segment(tail, next, first, vertices, normal, a, b, resolution)

def misses_interior(range: SegmentRange) -> Bool:
  SegmentRange{valid, first, last} = range
  Bool.not(Bool.and(valid, R.less(first, last)))

def trim_segments_clear(uses: List<&2, Topology.Coedge>, +edges: List<&2, A.Edge>, +source_vertices: List<&2, G.Vec3>, +ids: List<&2, U32>, +vertices: List<&2, G.Vec3>, +normal: G.Vec3, +resolution: R.Real) -> Bool:
  match uses:
    case Nil{}:
      True{}
    case +use <> tail:
      a = H.vertex(source_vertices, H.use_start(use, edges))
      b = H.vertex(source_vertices, V.use_end(use, edges))
      span = clip_segment(ids, SegmentRange{True{}, R.from_f32(0.0), R.from_f32(1.0)}, H.first_id(ids, 0), vertices, normal, a, b, resolution)
      Bool.and(misses_interior(span), trim_segments_clear(tail, edges, source_vertices, ids, vertices, normal, resolution))

def trim_clear(face: A.Face, solid: A.Solid, ids: List<&2, U32>, vertices: List<&2, G.Vec3>, resolution: R.Real, normal: G.Vec3) -> Bool:
  match face solid:
    case A.Face{_, _, A.Loop{True{}, uses} <> Nil{}} A.Solid{source_vertices, edges, _}:
      trim_segments_clear(uses, edges, source_vertices, ids, vertices, normal, resolution)
    case _ _:
      False{}

def vertices_covered(ids: List<&2, U32>, +vertices: List<&2, G.Vec3>, +face: A.Face, +solid: A.Solid, +domains: List<&2, F.DomainChoice>, +tolerance: I.Tolerance) -> Bool:
  match ids:
    case Nil{}:
      True{}
    case index <> tail:
      result = on_face(solid, face, domains, H.vertex(vertices, index), tolerance)
      Bool.and(covered(result), vertices_covered(tail, vertices, face, solid, domains, tolerance))

def candidate_result(result: F.Classification, +ids: List<&2, U32>, +vertices: List<&2, G.Vec3>, +face: A.Face, +solid: A.Solid, domains: List<&2, F.DomainChoice>, tolerance: I.Tolerance, resolution: R.Real, ref: T.FaceRef, normal: G.Vec3) -> Owners:
  match result:
    case F.Inside{_}:
      clear = trim_clear(face, solid, ids, vertices, resolution, normal)
      Owners{Bool.and(clear, vertices_covered(ids, vertices, face, solid, domains, tolerance)), [ref]}
    case F.Outside{_}:
      Owners{trim_clear(face, solid, ids, vertices, resolution, normal), Nil{}}
    case _:
      Owners{False{}, Nil{}}

def candidate(same: Bool, polygon: H.Polygon, +vertices: List<&2, G.Vec3>, +face: A.Face, +solid: A.Solid, +domains: List<&2, F.DomainChoice>, +tolerance: I.Tolerance, resolution: R.Real, ref: T.FaceRef) -> Owners:
  match same:
    case False{}:
      Owners{True{}, Nil{}}
    case True{}:
      H.Polygon{+surface, +sense, +ids} = polygon
      point = D.centroid([H.Polygon{surface, sense, ids}], vertices)
      result = on_face(solid, face, domains, point, tolerance)
      candidate_result(result, ids, vertices, face, solid, domains, tolerance, resolution, ref, V.outward(surface, sense))

def join(a: Owners, b: Owners) -> Owners:
  Owners{av, ar} = a
  Owners{bv, br} = b
  Owners{Bool.and(av, bv), List.append(&2, T.FaceRef, ar, br)}

def scan_faces(faces: List<&2, A.Face>, +polygon: H.Polygon, +vertices: List<&2, G.Vec3>, +solid: A.Solid, +domains: List<&2, F.DomainChoice>, +tolerance: I.Tolerance, +resolution: R.Real, +operand: U32, +index: U32, +subtraction: Bool) -> Owners:
  match faces:
    case Nil{}:
      Owners{True{}, Nil{}}
    case +face <> tail:
      A.Face{+surface, +sense, _} = face
      H.Polygon{+carrier, orientation, _} = polygon
      reversed = Bool.and(subtraction, U32.is_eq(operand, 1))
      source_sense = Bool.pick(Bool, reversed, Bool.not(sense), sense)
      aligned = R.less(R.from_f32(0.0), G.dot(V.outward(surface, source_sense), V.outward(carrier, orientation)))
      same = Bool.and(D.plane_equal(surface, carrier), aligned)
      one = candidate(same, polygon, vertices, face, solid, domains, tolerance, resolution, T.FaceRef{operand, index})
      join(one, scan_faces(tail, polygon, vertices, solid, domains, tolerance, resolution, operand, (index + 1 : U32), subtraction))

def owners(+polygon: H.Polygon, +vertices: List<&2, G.Vec3>, context: Context) -> Owners:
  Context{+a, ad, +b, bd, +tolerance, +resolution, +subtraction} = context
  A.Solid{_, _, af} = a
  A.Solid{_, _, bf} = b
  join(scan_faces(af, polygon, vertices, a, ad, tolerance, resolution, 0, 0, subtraction), scan_faces(bf, polygon, vertices, b, bd, tolerance, resolution, 1, 0, subtraction))

def prepend_owner(owners: Owners, rest: FaceMap) -> FaceMap:
  match owners rest:
    case Owners{True{}, +owner <> +contributors} FaceMap{valid, origins}:
      FaceMap{valid, T.FaceOrigin{owner, owner <> contributors} <> origins}
    case _ _:
      FaceMap{False{}, Nil{}}

def faces(polygons: List<&2, H.Polygon>, +vertices: List<&2, G.Vec3>, +context: Context) -> FaceMap:
  match polygons:
    case Nil{}:
      FaceMap{True{}, Nil{}}
    case polygon <> tail:
      prepend_owner(owners(polygon, vertices, context), faces(tail, vertices, context))

def face_or(found: Maybe<&2, A.Face>) -> A.Face:
  match found:
    case Some{face}:
      face
    case None{}:
      A.Face{A.plane(G.v3(0.0, 0.0, 0.0), G.v3(0.0, 0.0, 1.0)), True{}, Nil{}}

def source_face(ref: T.FaceRef, context: Context) -> A.Face:
  T.FaceRef{operand, index} = ref
  Context{A.Solid{_, _, a}, _, A.Solid{_, _, b}, _, _, _, _} = context
  selected = Bool.pick(List<&2, A.Face>, U32.is_eq(operand, 0), a, b)
  face_or(List.get(&2, A.Face, selected, U32.to_nat(index)))

def owner_or(found: Maybe<&2, T.FaceOrigin>) -> T.FaceOrigin:
  match found:
    case Some{origin}:
      origin
    case None{}:
      T.FaceOrigin{T.FaceRef{4294967295, 4294967295}, Nil{}}

def component_faces(origins: List<&2, P.FaceOrigin>, +all: List<&2, T.FaceOrigin>) -> List<&2, T.FaceOrigin>:
  match origins:
    case Nil{}:
      Nil{}
    case P.SourceFace{index} <> tail:
      owner_or(List.get(&2, T.FaceOrigin, all, U32.to_nat(index))) <> component_faces(tail, all)
    case _:
      Nil{}

def reversed(ref: T.FaceRef, context: Context) -> Bool:
  T.FaceRef{operand, _} = ref
  Context{_, _, _, _, _, _, subtraction} = context
  Bool.and(subtraction, U32.is_eq(operand, 1))

def with_loops(face: A.Face, loops: List<&2, A.Loop>, reversed: Bool) -> A.Face:
  A.Face{surface, +sense, _} = face
  A.Face{surface, Bool.pick(Bool, reversed, Bool.not(sense), sense), loops}

def carrier(face: A.Face) -> A.Surface:
  A.Face{surface, _, _} = face
  surface

def original_carriers(faces: List<&2, A.Face>, origins: List<&2, T.FaceOrigin>, +context: Context) -> List<&2, A.Face>:
  match faces origins:
    case A.Face{_, _, loops} <> tail T.FaceOrigin{+owner, _} <> rest:
      with_loops(source_face(owner, context), loops, reversed(owner, context)) <> original_carriers(tail, rest, context)
    case _ _:
      Nil{}

def domains(edges: List<&2, A.Edge>, +vertices: List<&2, G.Vec3>) -> List<&2, F.DomainChoice>:
  match edges:
    case Nil{}:
      Nil{}
    case A.Edge{a, b, _, _} <> tail:
      length = I.length(G.sub(H.vertex(vertices, b), H.vertex(vertices, a)))
      F.GivenDomain{C.Interval{R.from_f32(0.0), length}} <> domains(tail, vertices)

def original_edge(edges: List<&2, A.Edge>, +vertices: List<&2, G.Vec3>, +first: G.Vec3, +last: G.Vec3, +resolution: R.Real, +operand: U32, +index: U32) -> Maybe<&2, T.EdgeOrigin>:
  match edges:
    case Nil{}:
      None{}
    case A.Edge{a, b, _, _} <> tail:
      +p = H.vertex(vertices, a)
      +q = H.vertex(vertices, b)
      contains = Bool.and(V.near_segment(first, p, q, resolution), V.near_segment(last, p, q, resolution))
      Bool.pick(Maybe<&2, T.EdgeOrigin>, contains, Some{T.OriginalEdge{operand, index}}, original_edge(tail, vertices, first, last, resolution, operand, (index + 1 : U32)))

def first_original(first: Maybe<&2, T.EdgeOrigin>, second: Maybe<&2, T.EdgeOrigin>) -> Maybe<&2, T.EdgeOrigin>:
  match first:
    case Some{origin}:
      Some{origin}
    case None{}:
      second

def source_edge(+first: G.Vec3, +last: G.Vec3, context: Context) -> Maybe<&2, T.EdgeOrigin>:
  Context{A.Solid{av, ae, _}, _, A.Solid{bv, be, _}, _, _, +resolution, _} = context
  first_original(original_edge(ae, av, first, last, resolution, 0, 0), original_edge(be, bv, first, last, resolution, 1, 0))

def used(count: S.UseCount) -> Bool:
  S.UseCount{a, b} = count
  U32.is_ne((a + b : U32), 0)

def edge_faces(faces: List<&2, A.Face>, origins: List<&2, T.FaceOrigin>, +index: U32) -> List<&2, T.FaceRef>:
  match faces origins:
    case A.Face{_, _, loops} <> tail T.FaceOrigin{owner, _} <> rest:
      +refs = edge_faces(tail, rest, index)
      Bool.pick(List<&2, T.FaceRef>, used(S.count_loops(loops, index)), owner <> refs, refs)
    case _ _:
      Nil{}

def artificial(refs: List<&2, T.FaceRef>, +context: Context) -> Maybe<&2, T.EdgeOrigin>:
  match refs:
    case +a <> +b <> Nil{}:
      first = carrier(source_face(a, context))
      second = carrier(source_face(b, context))
      +same = T.face_equal(a, b)
      subdivision = Bool.or(same, D.plane_equal(first, second))
      refs = Bool.pick(List<&2, T.FaceRef>, same, [a], [a, b])
      Some{Bool.pick(T.EdgeOrigin, subdivision, T.FaceSubdivision{refs}, T.FaceIntersection{a, b})}
    case _:
      None{}

def prepend_edge(origin: Maybe<&2, T.EdgeOrigin>, rest: EdgeMap) -> EdgeMap:
  match origin rest:
    case Some{value} EdgeMap{valid, values}:
      EdgeMap{valid, value <> values}
    case _ _:
      EdgeMap{False{}, Nil{}}

def edges(remaining: List<&2, A.Edge>, +vertices: List<&2, G.Vec3>, +faces: List<&2, A.Face>, +origins: List<&2, T.FaceOrigin>, +context: Context, +index: U32) -> EdgeMap:
  match remaining:
    case Nil{}:
      EdgeMap{True{}, Nil{}}
    case A.Edge{a, b, _, _} <> tail:
      original = source_edge(H.vertex(vertices, a), H.vertex(vertices, b), context)
      derived = artificial(edge_faces(faces, origins, index), context)
      prepend_edge(first_original(original, derived), edges(tail, vertices, faces, origins, context, (index + 1 : U32)))
