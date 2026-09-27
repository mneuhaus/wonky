import Base
import ../real.bend as R
import ../precise.bend as G
import ../analytic.bend as A
import ../intersections.bend as I
import ../halfspace.bend as H
import ../boundary.bend as B
import ./types.bend as P

# A shared convex-cell plane arrangement. Vertex IDs are global throughout
# every pass. Both children and all neighboring cells reuse one edge/root
# cache per plane. No coordinate comparison creates a topological identity.
type Cell is Data:
  Cell{polygons: List<&2, H.Polygon>}
type Arrangement is Data:
  Arrangement{vertices: List<&2, G.Vec3>, cells: List<&2, Cell>, planes: U32}
  Failed{reason: P.Reason, stage: U32}
type Pass is Data:
  Pass{valid: Bool, cells: List<&2, Cell>, state: H.ClipState}
  Overflow{}
type Capped is Data:
  Capped{valid: Bool, polygons: List<&2, H.Polygon>}
type Flags is Data:
  Flags{negative: Bool, positive: Bool}
type Sum is Data:
  Sum{value: G.Vec3, count: U32}

def zero() -> R.Real:
  R.from_f32(0.0)

def reverse(values: List<&2, U32>, acc: List<&2, U32>) -> List<&2, U32>:
  match values:
    case Nil{}:
      acc
    case head <> tail:
      reverse(tail, head <> acc)

def surface_origin(surface: A.Surface) -> G.Vec3:
  match surface:
    case A.Plane{origin, _, _}:
      origin
    case _:
      G.v3(0.0, 0.0, 0.0)

def surface_normal(surface: A.Surface) -> G.Vec3:
  match surface:
    case A.Plane{_, normal, _}:
      normal
    case _:
      G.v3(0.0, 0.0, 0.0)

# The F32x2 cross is only the filter; I.parallel_certificate decides exactly.
# R.mul is not commutative in its last bits, so the F32x2 cross of exactly
# parallel normals, even of one normal with itself, can miss zero by a few
# ulps (corpus W2: a polygon-prism side face was not equal to itself and the
# face ownership map refused, stage 6). The filter admits that rounding.
def parallel_candidate(+an: G.Vec3, +bn: G.Vec3) -> Bool:
  I.at_most(I.magnitude(G.cross(an, bn)), R.mul(I.angular_guard(), R.mul(I.magnitude(an), I.magnitude(bn))))

def plane_equal(+a: A.Surface, +b: A.Surface) -> Bool:
  +an = surface_normal(a)
  +bn = surface_normal(b)
  +ao = surface_origin(a)
  +bo = surface_origin(b)
  parallel = I.parallel_certificate(parallel_candidate(an, bn), an, bn)
  incident = I.coincidence_certificate(R.equal(G.dot(G.sub(bo, ao), an), zero()), an, bo, ao)
  Bool.and(parallel, incident)

def has_plane(planes: List<&2, A.Surface>, +surface: A.Surface) -> Bool:
  match planes:
    case Nil{}:
      False{}
    case head <> tail:
      Bool.or(plane_equal(head, surface), has_plane(tail, surface))

def unique_planes(faces: List<&2, A.Face>, +planes: List<&2, A.Surface>) -> List<&2, A.Surface>:
  match faces:
    case Nil{}:
      planes
    case A.Face{+surface, _, _} <> tail:
      next = Bool.pick(List<&2, A.Surface>, has_plane(planes, surface), planes, List.append(&2, A.Surface, planes, [surface]))
      unique_planes(tail, next)

def flip_sides(values: List<&2, H.Side>) -> List<&2, H.Side>:
  match values:
    case Nil{}:
      Nil{}
    case H.Side{+kind, distance} <> tail:
      H.Side{Bool.pick(U32, U32.is_eq(kind, 0), 0, (3 - kind : U32)), R.neg(distance)} <> flip_sides(tail)

def ring_flags(ids: List<&2, U32>, +values: List<&2, H.Side>, flags: Flags) -> Flags:
  match ids:
    case Nil{}:
      flags
    case index <> tail:
      Flags{negative, positive} = flags
      +kind = H.side_kind(H.side_at(values, index))
      ring_flags(tail, values, Flags{Bool.or(negative, U32.is_eq(kind, 1)), Bool.or(positive, U32.is_eq(kind, 2))})

def cell_flags(polygons: List<&2, H.Polygon>, +values: List<&2, H.Side>, flags: Flags) -> Flags:
  match polygons:
    case Nil{}:
      flags
    case H.Polygon{_, _, ids} <> tail:
      cell_flags(tail, values, ring_flags(ids, values, flags))

def cap_ring(result: B.StitchResult, edges: List<&2, A.Edge>, polygons: List<&2, H.Polygon>, surface: A.Surface, sense: Bool) -> Capped:
  match result:
    case B.Stitched{B.Ring{uses} <> Nil{}}:
      Capped{True{}, List.append(&2, H.Polygon, polygons, [H.Polygon{surface, sense, H.ring_vertices(uses, edges)}])}
    case _:
      Capped{False{}, polygons}

def cap_built(built: H.BuildState, polygons: List<&2, H.Polygon>, vertices: List<&2, G.Vec3>, surface: A.Surface, sense: Bool) -> Capped:
  H.BuildState{+edges, +faces} = built
  rings = B.stitch(edges, U32.from_nat(List.length(&2, G.Vec3, vertices)), H.open_uses(edges, faces, 0))
  cap_ring(rings, edges, polygons, surface, sense)

def cap(+polygons: List<&2, H.Polygon>, +vertices: List<&2, G.Vec3>, surface: A.Surface, sense: Bool) -> Capped:
  cap_built(H.build_polygons(polygons, vertices, H.BuildState{Nil{}, Nil{}}), polygons, vertices, surface, sense)

def children(a: Capped, b: Capped, state: H.ClipState) -> Pass:
  Capped{av, ap} = a
  Capped{bv, bp} = b
  Pass{Bool.and(av, bv), [Cell{ap}, Cell{bp}], state}

def positive_cut(negative: List<&2, H.Polygon>, result: H.PolygonsCut, +surface: A.Surface) -> Pass:
  H.PolygonsCut{positive, +state} = result
  H.ClipState{+vertices, _} = state
  children(cap(negative, vertices, surface, True{}), cap(positive, vertices, surface, False{}), state)

def negative_cut(result: H.PolygonsCut, polygons: List<&2, H.Polygon>, values: List<&2, H.Side>, surface: A.Surface) -> Pass:
  H.PolygonsCut{negative, state} = result
  positive_cut(negative, H.clip_polygons(polygons, flip_sides(values), state), surface)

def split_flags(flags: Flags, +polygons: List<&2, H.Polygon>, +values: List<&2, H.Side>, surface: A.Surface, state: H.ClipState) -> Pass:
  match flags:
    case Flags{True{}, True{}}:
      negative_cut(H.clip_polygons(polygons, values, state), polygons, values, surface)
    case _:
      Pass{True{}, [Cell{polygons}], state}

def limited(pass: Pass, done: List<&2, Cell>) -> Pass:
  match pass:
    case Pass{valid, +cells, state}:
      count = (U32.from_nat(List.length(&2, Cell, cells)) + U32.from_nat(List.length(&2, Cell, done)) : U32)
      Bool.pick(Pass, U32.is_lt(count, 513), Pass{valid, cells, state}, Overflow{})
    case Overflow{}:
      Overflow{}

def split_cells(pending: List<&2, Cell>, pass: Pass, +values: List<&2, H.Side>, +surface: A.Surface, done: List<&2, Cell>) -> Pass:
  match pending pass:
    case _ Overflow{}:
      Overflow{}
    case _ Pass{False{}, _, state}:
      Pass{False{}, Nil{}, state}
    case Nil{} Pass{True{}, children, state}:
      Pass{True{}, List.append(&2, Cell, done, children), state}
    case Cell{+polygons} <> tail Pass{True{}, children, state}:
      one = split_flags(cell_flags(polygons, values, Flags{False{}, False{}}), polygons, values, surface, state)
      +next_done = List.append(&2, Cell, done, children)
      split_cells(tail, limited(one, next_done), values, surface, next_done)

def finish_pass(pass: Pass, +index: U32) -> Arrangement:
  match pass:
    case Overflow{}:
      Failed{P.ResolutionLimit{}, index}
    case Pass{False{}, _, _}:
      Failed{P.ConstructionFailure{}, index}
    case Pass{True{}, +cells, H.ClipState{vertices, _}}:
      within = U32.is_lt(U32.from_nat(List.length(&2, Cell, cells)), 513)
      Bool.pick(Arrangement, within, Arrangement{vertices, cells, index}, Failed{P.ResolutionLimit{}, index})

def sides_ready(sides: H.Sides, cells: List<&2, Cell>, surface: A.Surface, vertices: List<&2, G.Vec3>, index: U32) -> Arrangement:
  match sides:
    case H.Sides{False{}, _, _, _, _}:
      Failed{P.AmbiguousContact{}, index}
    case H.Sides{True{}, _, _, _, values}:
      finish_pass(split_cells(cells, Pass{True{}, Nil{}, H.ClipState{vertices, Nil{}}}, values, surface, Nil{}), index)

def arrange(planes: List<&2, A.Surface>, state: Arrangement, +resolution: R.Real, +index: U32) -> Arrangement:
  match planes state:
    case _ Failed{reason, stage}:
      Failed{reason, stage}
    case Nil{} Arrangement{vertices, cells, _}:
      Arrangement{vertices, cells, index}
    case +surface <> tail Arrangement{+vertices, cells, _}:
      sides = H.sides(vertices, surface_origin(surface), surface_normal(surface), resolution, 0)
      next = sides_ready(sides, cells, surface, vertices, index)
      arrange(tail, next, resolution, (index + 1 : U32))

def box_bounds(bounds: A.Bounds, +margin: R.Real) -> Arrangement:
  A.Bounds{G.V3{ax, ay, az}, G.V3{bx, by, bz}} = bounds
  +lx = R.sub(ax, margin)
  +ly = R.sub(ay, margin)
  +lz = R.sub(az, margin)
  +hx = R.add(bx, margin)
  +hy = R.add(by, margin)
  +hz = R.add(bz, margin)
  +lo = {G.V3{lx, ly, lz} : G.Vec3}
  +hi = {G.V3{hx, hy, hz} : G.Vec3}
  vertices = {[lo, G.V3{hx, ly, lz}, G.V3{hx, hy, lz}, G.V3{lx, hy, lz},
    G.V3{lx, ly, hz}, G.V3{hx, ly, hz}, hi, G.V3{lx, hy, hz}] : List<&2, G.Vec3>}
  polygons = {[H.Polygon{A.plane(lo, G.v3(0.0, 0.0, F32.neg(1.0))), True{}, [0, 3, 2, 1]},
    H.Polygon{A.plane(hi, G.v3(0.0, 0.0, 1.0)), True{}, [4, 5, 6, 7]},
    H.Polygon{A.plane(lo, G.v3(0.0, F32.neg(1.0), 0.0)), True{}, [0, 1, 5, 4]},
    H.Polygon{A.plane(hi, G.v3(1.0, 0.0, 0.0)), True{}, [1, 2, 6, 5]},
    H.Polygon{A.plane(hi, G.v3(0.0, 1.0, 0.0)), True{}, [2, 3, 7, 6]},
    H.Polygon{A.plane(lo, G.v3(F32.neg(1.0), 0.0, 0.0)), True{}, [3, 0, 4, 7]}] : List<&2, H.Polygon>}
  Bool.pick(Arrangement, Bool.and(I.vec_valid(lo), I.vec_valid(hi)), Arrangement{vertices, [Cell{polygons}], 0}, Failed{P.ResolutionLimit{}, 0})

def initial(+vertices: List<&2, G.Vec3>, +resolution: R.Real) -> Arrangement:
  +first = H.vertex(vertices, 0)
  margin = R.max(R.from_f32(1.0), R.mul(resolution, R.from_f32(1024.0)))
  box_bounds(H.bounds(vertices, first, first), margin)

def sum_ids(ids: List<&2, U32>, +vertices: List<&2, G.Vec3>, sum: Sum) -> Sum:
  match ids:
    case Nil{}:
      sum
    case index <> tail:
      Sum{value, count} = sum
      sum_ids(tail, vertices, Sum{G.add(value, H.vertex(vertices, index)), (count + 1 : U32)})

def sum_polygons(polygons: List<&2, H.Polygon>, +vertices: List<&2, G.Vec3>, sum: Sum) -> Sum:
  match polygons:
    case Nil{}:
      sum
    case H.Polygon{_, _, ids} <> tail:
      sum_polygons(tail, vertices, sum_ids(ids, vertices, sum))

def average(sum: Sum) -> G.Vec3:
  Sum{value, count} = sum
  G.scale(value, R.div(R.from_f32(1.0), R.from_f32(U32.to_f32(count))))

def centroid(polygons: List<&2, H.Polygon>, vertices: List<&2, G.Vec3>) -> G.Vec3:
  average(sum_polygons(polygons, vertices, Sum{G.v3(0.0, 0.0, 0.0), 0}))

def interior(polygons: List<&2, H.Polygon>, +point: G.Vec3, +resolution: R.Real) -> Bool:
  match polygons:
    case Nil{}:
      True{}
    case H.Polygon{+surface, sense, _} <> tail:
      outward = G.scale(G.normalize(surface_normal(surface)), Bool.pick(R.Real, sense, R.from_f32(1.0), R.from_f32(F32.neg(1.0))))
      distance = G.dot(G.sub(point, surface_origin(surface)), outward)
      Bool.and(R.less(distance, R.neg(resolution)), interior(tail, point, resolution))

def cell_volume(+polygons: List<&2, H.Polygon>, +vertices: List<&2, G.Vec3>) -> R.Real:
  R.div(H.volume(polygons, vertices, centroid(polygons, vertices)), R.from_f32(6.0))
