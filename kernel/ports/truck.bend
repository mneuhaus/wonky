import Base
import ../real.bend as R
import ../precise.bend as G
import ../analytic.bend as A
import ../topology.bend as T
import ../intersections.bend as I
import ../face-classification.bend as F
import ./types.bend as P
import ./truck-topology.bend as L

# Native Bend specialization of Truck 8d03d8f transversal corefinement.
# See docs/port-truck.md for Apache-2.0 attribution, routine mapping and limits.
# A plane/line intersection has a closed form; there is no mesh or Newton seed.
# Topological identity is shared before splitting faces, never welded afterward.
type Sides is Data:
  Sides{clear: Bool, negative: Bool, positive: Bool, values: List<&2, R.Real>}
type Part is Data:
  Part{retained: Maybe<&2, L.Arc>, crossing: Maybe<&2, U32>}
type EdgeSplit is Data:
  EdgeSplit{vertices: List<&2, G.Vec3>, part: Part}
type Split is Data:
  Split{vertices: List<&2, G.Vec3>, parts: List<&2, Part>}
type Pieces is Data:
  Pieces{arcs: List<&2, L.Arc>, roots: List<&2, U32>}
type Cuts is Data:
  Cuts{valid: Bool, arcs: List<&2, L.Arc>}
type Polygons is Data:
  Polygons{valid: Bool, values: List<&2, L.Polygon>}
type Faces is Data:
  Faces{valid: Bool, polygons: List<&2, L.Polygon>, cap: List<&2, L.Arc>}

def zero() -> R.Real:
  R.from_f32(0.0)

def scalar( +found: Maybe<&2, R.Real>) -> R.Real:
  match found:
    case Some{value}:
      value
    case None{}:
      zero()

def distance( +values: List<&2, R.Real>, +index: U32) -> R.Real:
  scalar(List.get(&2, R.Real, values, U32.to_nat(index)))

def side_add( +rest: Sides, +value: R.Real, +margin: R.Real) -> Sides:
  Sides{clear, negative, positive, values} = rest
  Sides{Bool.and(clear, R.less(margin, R.abs(value))), Bool.or(negative, R.less(value, zero())), Bool.or(positive, R.less(zero(), value)), value <> values}

def sides( +vertices: List<&2, G.Vec3>, +origin: G.Vec3, +normal: G.Vec3, +margin: R.Real) -> Sides:
  match vertices:
    case Nil{}:
      Sides{True{}, False{}, False{}, Nil{}}
    case point <> tail:
      side_add(sides(tail, origin, normal, margin), I.signed_distance(G.sub(point, origin), normal), margin)

def split_choice( +crosses: Bool, +inside: Bool, +a: U32, +b: U32, +index: U32, +vertices: List<&2, G.Vec3>, +da: R.Real, +db: R.Real) -> EdgeSplit:
  match crosses:
    case False{}:
      EdgeSplit{vertices, Part{Bool.pick(Maybe<&2, L.Arc>, inside, Some{L.Arc{a, b, P.SourceEdge{index}}}, None{}), None{}}}
    case True{}:
      +id = U32.from_nat(List.length(&2, G.Vec3, vertices))
      +start = L.vertex(vertices, a)
      +point = G.add(start, G.scale(G.sub(L.vertex(vertices, b), start), R.div(da, R.sub(da, db))))
      +arc = {L.Arc{Bool.pick(U32, inside, a, id), Bool.pick(U32, inside, id, b), P.SourceEdge{index}} : L.Arc}
      EdgeSplit{List.append(&2, G.Vec3, vertices, [point]), Part{Some{arc}, Some{id}}}

def split_edge( +edge: A.Edge, +index: U32, +vertices: List<&2, G.Vec3>, +values: List<&2, R.Real>) -> EdgeSplit:
  A.Edge{+a, +b, _, _} = edge
  +da = distance(values, a)
  +db = distance(values, b)
  +inside = R.less(da, zero())
  split_choice(Bool.pick(Bool, inside, Bool.not(R.less(db, zero())), R.less(db, zero())), inside, a, b, index, vertices, da, db)

def split_vertices( +result: EdgeSplit) -> List<&2, G.Vec3>:
  EdgeSplit{vertices, _} = result
  vertices

def prepend_part( +one: EdgeSplit, +rest: Split) -> Split:
  EdgeSplit{_, part} = one
  Split{vertices, parts} = rest
  Split{vertices, part <> parts}

def split_edges( +edges: List<&2, A.Edge>, +index: U32, +vertices: List<&2, G.Vec3>, +values: List<&2, R.Real>) -> Split:
  match edges:
    case Nil{}:
      Split{vertices, Nil{}}
    case edge <> tail:
      +one = split_edge(edge, index, vertices, values)
      prepend_part(one, split_edges(tail, (index + 1 : U32), split_vertices(one), values))

def retained_arc( +found: Maybe<&2, L.Arc>, +forward: Bool) -> List<&2, L.Arc>:
  match found:
    case None{}:
      Nil{}
    case Some{+arc}:
      [Bool.pick(L.Arc, forward, arc, L.reverse_arc(arc))]

def crossing_vertex( +found: Maybe<&2, U32>) -> List<&2, U32>:
  match found:
    case Some{value}:
      [value]
    case None{}:
      Nil{}

def piece( +found: Maybe<&2, Part>, +forward: Bool) -> Pieces:
  match found:
    case Some{Part{retained, crossing}}:
      Pieces{retained_arc(retained, forward), crossing_vertex(crossing)}
    case None{}:
      Pieces{Nil{}, Nil{}}

def join_pieces( +first: Pieces, +last: Pieces) -> Pieces:
  Pieces{a, b} = first
  Pieces{c, d} = last
  Pieces{List.append(&2, L.Arc, a, c), List.append(&2, U32, b, d)}

def face_pieces( +uses: List<&2, T.Coedge>, +parts: List<&2, Part>) -> Pieces:
  match uses:
    case Nil{}:
      Pieces{Nil{}, Nil{}}
    case T.Use{index, forward} <> tail:
      join_pieces(piece(List.get(&2, Part, parts, U32.to_nat(index)), forward), face_pieces(tail, parts))

def parameter( +index: U32, +vertices: List<&2, G.Vec3>, +origin: G.Vec3, +direction: G.Vec3) -> R.Real:
  G.dot(G.sub(L.vertex(vertices, index), origin), direction)

def insert( +ids: List<&2, U32>, +id: U32, +vertices: List<&2, G.Vec3>, +origin: G.Vec3, +direction: G.Vec3) -> List<&2, U32>:
  match ids:
    case Nil{}:
      [id]
    case +head <> +tail:
      +before = R.less(parameter(id, vertices, origin, direction), parameter(head, vertices, origin, direction))
      Bool.pick(List<&2, U32>, before, id <> head <> tail, head <> insert(tail, id, vertices, origin, direction))

def ordered( +ids: List<&2, U32>, +vertices: List<&2, G.Vec3>, +origin: G.Vec3, +direction: G.Vec3) -> List<&2, U32>:
  match ids:
    case Nil{}:
      Nil{}
    case head <> tail:
      insert(ordered(tail, vertices, origin, direction), head, vertices, origin, direction)

def root_gaps( +ids: List<&2, U32>, +vertices: List<&2, G.Vec3>, +origin: G.Vec3, +direction: G.Vec3, +resolution: R.Real) -> Bool:
  match ids:
    case a <> +b <> tail:
      +gap = R.sub(parameter(b, vertices, origin, direction), parameter(a, vertices, origin, direction))
      Bool.and(R.less(resolution, gap), root_gaps(b <> tail, vertices, origin, direction, resolution))
    case _:
      True{}

def pair_prepend( +result: Cuts, +arc: L.Arc) -> Cuts:
  Cuts{valid, arcs} = result
  Cuts{valid, arc <> arcs}

# On a transverse line through a bounded simple polygon, crossings alternate
# outside/inside. Sorted consecutive pairs are the retained boundary intervals.
def pairs( +ids: List<&2, U32>, +face: U32) -> Cuts:
  match ids:
    case Nil{}:
      Cuts{True{}, Nil{}}
    case a <> b <> tail:
      pair_prepend(pairs(tail, face), L.Arc{a, b, P.CutEdge{face}})
    case _:
      Cuts{False{}, Nil{}}

def cuts_checked( +valid: Bool, +result: Cuts) -> Cuts:
  Cuts{ok, arcs} = result
  Cuts{Bool.and(valid, ok), arcs}

def line_cuts( +valid: Bool, +roots: List<&2, U32>, +face: U32, +vertices: List<&2, G.Vec3>, +origin: G.Vec3, +direction: G.Vec3, +resolution: R.Real) -> Cuts:
  match valid:
    case False{}:
      Cuts{False{}, Nil{}}
    case True{}:
      +unit = G.normalize(direction)
      +sorted = ordered(roots, vertices, origin, unit)
      cuts_checked(root_gaps(sorted, vertices, origin, unit, resolution), pairs(sorted, face))

def cut_arcs(+roots: List<&2, U32>, +face: U32, +vertices: List<&2, G.Vec3>, +origin: G.Vec3, +normal: G.Vec3, +surface: A.Surface, +sense: Bool, +resolution: R.Real, +angular: R.Real) -> Cuts:
  match roots:
    case Nil{}:
      Cuts{True{}, Nil{}}
    case _:
      +direction = G.cross(L.outward(surface, sense), G.normalize(normal))
      line_cuts(R.less(angular, I.length(direction)), roots, face, vertices, origin, direction, resolution)

def add_polygon( +result: Polygons, +valid: Bool, +polygon: L.Polygon) -> Polygons:
  Polygons{ok, values} = result
  Polygons{Bool.and(valid, ok), polygon <> values}

def ring_polygons( +rings: List<&2, List<&2, L.Arc>>, +vertices: List<&2, G.Vec3>, +surface: A.Surface, +sense: Bool, +source: P.FaceOrigin, +resolution: R.Real) -> Polygons:
  match rings:
    case Nil{}:
      Polygons{True{}, Nil{}}
    case +ring <> tail:
      +normal = L.outward(surface, sense)
      +enough = U32.is_lt(2, U32.from_nat(List.length(&2, L.Arc, ring)))
      +positive = R.less(R.mul(resolution, resolution), L.area(ring, vertices, L.first_point(ring, vertices, G.v3(0.0, 0.0, 0.0)), normal))
      +valid = Bool.and(enough, Bool.and(positive, L.simple(ring, vertices, normal, resolution)))
      add_polygon(ring_polygons(tail, vertices, surface, sense, source, resolution), valid, L.Polygon{surface, sense, ring, source})

def polygons( +result: L.Rings, +vertices: List<&2, G.Vec3>, +surface: A.Surface, +sense: Bool, +source: P.FaceOrigin, +resolution: R.Real) -> Polygons:
  match result:
    case L.Rings{True{}, rings}:
      ring_polygons(rings, vertices, surface, sense, source, resolution)
    case _:
      Polygons{False{}, Nil{}}

def face_result( +result: Polygons, +valid: Bool, +cap: List<&2, L.Arc>) -> Faces:
  Polygons{ok, values} = result
  Faces{Bool.and(valid, ok), values, cap}

def integrate_cuts( +result: Cuts, +arcs: List<&2, L.Arc>, +vertices: List<&2, G.Vec3>, +surface: A.Surface, +sense: Bool, +index: U32, +resolution: R.Real) -> Faces:
  Cuts{valid, +cuts} = result
  face_result(polygons(L.stitch(List.append(&2, L.Arc, arcs, cuts)), vertices, surface, sense, P.SourceFace{index}, resolution), valid, L.reverse_arcs(cuts))

def divide_face( +pieces: Pieces, +index: U32, +vertices: List<&2, G.Vec3>, +origin: G.Vec3, +normal: G.Vec3, +surface: A.Surface, +sense: Bool, +resolution: R.Real, +angular: R.Real) -> Faces:
  Pieces{arcs, roots} = pieces
  integrate_cuts(cut_arcs(roots, index, vertices, origin, normal, surface, sense, resolution, angular), arcs, vertices, surface, sense, index, resolution)

def join_faces( +first: Faces, +last: Faces) -> Faces:
  Faces{a, b, c} = first
  Faces{d, e, f} = last
  Faces{Bool.and(a, d), List.append(&2, L.Polygon, b, e), List.append(&2, L.Arc, c, f)}

def divide_faces( +faces: List<&2, A.Face>, +index: U32, +parts: List<&2, Part>, +vertices: List<&2, G.Vec3>, +origin: G.Vec3, +normal: G.Vec3, +resolution: R.Real, +angular: R.Real) -> Faces:
  match faces:
    case Nil{}:
      Faces{True{}, Nil{}, Nil{}}
    case A.Face{surface, sense, A.Loop{True{}, uses} <> Nil{}} <> tail:
      +one = divide_face(face_pieces(uses, parts), index, vertices, origin, normal, surface, sense, resolution, angular)
      join_faces(one, divide_faces(tail, (index + 1 : U32), parts, vertices, origin, normal, resolution, angular))
    case _:
      Faces{False{}, Nil{}, Nil{}}

def close_shell( +cap: Polygons, +valid: Bool, +source: List<&2, L.Polygon>, +vertices: List<&2, G.Vec3>, +resolution: R.Real) -> P.Result:
  match cap valid:
    case Polygons{True{}, polygons} True{}:
      +state = L.assemble(List.append(&2, L.Polygon, source, polygons), vertices, L.Assembly{True{}, Nil{}, Nil{}, Nil{}, Nil{}})
      L.finish(vertices, state, resolution)
    case _ _:
      P.Unresolved{P.UnsupportedArrangement{}}

def cap_faces( +result: Faces, +vertices: List<&2, G.Vec3>, +origin: G.Vec3, +normal: G.Vec3, +resolution: R.Real) -> P.Result:
  Faces{valid, source, cap} = result
  close_shell(polygons(L.stitch(cap), vertices, A.plane(origin, normal), True{}, P.CutFace{}, resolution), valid, source, vertices, resolution)

def construct( +split: Split, +faces: List<&2, A.Face>, +origin: G.Vec3, +normal: G.Vec3, +resolution: R.Real, +angular: R.Real) -> P.Result:
  Split{+vertices, parts} = split
  cap_faces(divide_faces(faces, 0, parts, vertices, origin, normal, resolution, angular), vertices, origin, normal, resolution)

def selected( +sides: Sides, +solid: A.Solid, +origin: G.Vec3, +normal: G.Vec3, +resolution: R.Real, +angular: R.Real) -> P.Result:
  match sides solid:
    case Sides{False{}, _, _, _} _:
      P.Unresolved{P.AmbiguousContact{}}
    case Sides{True{}, False{}, _, _} _:
      P.Empty{}
    case Sides{True{}, True{}, False{}, _} A.Solid{vertices, +edges, +faces}:
      L.finish(vertices, L.Assembly{True{}, edges, L.source_edges(edges, 0), faces, L.source_faces(faces, 0)}, resolution)
    case Sides{True{}, True{}, True{}, values} A.Solid{vertices, edges, faces}:
      construct(split_edges(edges, 0, vertices, values), faces, origin, normal, resolution, angular)

def scale( +vertices: List<&2, G.Vec3>, +value: R.Real) -> R.Real:
  match vertices:
    case Nil{}:
      value
    case head <> tail:
      scale(tail, R.max(value, I.magnitude(head)))

def planar( +faces: List<&2, A.Face>) -> Bool:
  match faces:
    case Nil{}:
      True{}
    case A.Face{A.Plane{_, _, _}, _, _} <> tail:
      planar(tail)
    case _:
      False{}

def straight( +edges: List<&2, A.Edge>) -> Bool:
  match edges:
    case Nil{}:
      True{}
    case A.Edge{_, _, A.Line{_, _}, _} <> tail:
      straight(tail)
    case _:
      False{}

def single_loops( +faces: List<&2, A.Face>) -> Bool:
  match faces:
    case Nil{}:
      True{}
    case A.Face{_, _, A.Loop{True{}, _} <> Nil{}} <> tail:
      single_loops(tail)
    case _:
      False{}

def domains_ok( +domains: List<&2, F.DomainChoice>) -> Bool:
  match domains:
    case Nil{}:
      True{}
    case F.AutoDomain{} <> tail:
      domains_ok(tail)
    case _:
      False{}

def geometry_checked( +valid: Bool, +solid: A.Solid, +origin: G.Vec3, +normal: G.Vec3, +tolerance: I.Tolerance, +resolution: R.Real) -> P.Result:
  match valid:
    case False{}:
      P.Unresolved{P.InvalidTopology{}}
    case True{}:
      A.Solid{vertices, _, _} = solid
      selected(sides(vertices, origin, normal, R.add(I.tolerance_linear(tolerance), resolution)), solid, origin, normal, resolution, I.tolerance_angular(tolerance))

def resolution_checked( +valid: Bool, +solid: A.Solid, +origin: G.Vec3, +normal: G.Vec3, +tolerance: I.Tolerance, +resolution: R.Real) -> P.Result:
  match valid:
    case False{}:
      P.Unresolved{P.ResolutionLimit{}}
    case True{}:
      positive = R.less(R.mul(resolution, R.mul(resolution, resolution)), L.volume(solid))
      geometry_checked(Bool.and(L.valid(solid, resolution), positive), solid, origin, normal, tolerance, resolution)

def scope_checked( +planes: Bool, +lines: Bool, +domains: Bool, +loops: Bool, +solid: A.Solid, +origin: G.Vec3, +normal: G.Vec3, +tolerance: I.Tolerance) -> P.Result:
  match planes lines domains loops:
    case False{} _ _ _:
      P.Unresolved{P.UnsupportedSurface{}}
    case _ False{} _ _:
      P.Unresolved{P.UnsupportedCurve{}}
    case _ _ False{} _:
      P.Unresolved{P.UnsupportedDomain{}}
    case _ _ _ False{}:
      P.Unresolved{P.UnsupportedArrangement{}}
    case True{} True{} True{} True{}:
      A.Solid{vertices, _, _} = solid
      +resolution = R.mul(I.angular_guard(), scale(vertices, R.max(R.from_f32(1.0), I.magnitude(origin))))
      resolution_checked(R.less(resolution, I.tolerance_linear(tolerance)), solid, origin, normal, tolerance, resolution)

def input_checked( +valid: Bool, +budget: Bool, +solid: A.Solid, +domains: List<&2, F.DomainChoice>, +origin: G.Vec3, +normal: G.Vec3, +tolerance: I.Tolerance) -> P.Result:
  match valid budget:
    case False{} _:
      P.Unresolved{P.InvalidInput{}}
    case _ False{}:
      P.Unresolved{P.SourceTolerance{}}
    case True{} True{}:
      A.Solid{_, +edges, +faces} = solid
      +domain_count = Bool.not(U32.is_lt(U32.from_nat(List.length(&2, A.Edge, edges)), U32.from_nat(List.length(&2, F.DomainChoice, domains))))
      scope_checked(planar(faces), straight(edges), Bool.and(domain_count, domains_ok(domains)), single_loops(faces), solid, origin, normal, tolerance)

def clip( +solid: A.Solid, +domains: List<&2, F.DomainChoice>, +origin: G.Vec3, +normal: G.Vec3, +tolerance: I.Tolerance, +source_budget: R.Real) -> P.Result:
  +valid = Bool.and(I.vec_valid(origin), Bool.and(I.vec_valid(normal), Bool.and(I.direction_valid(normal), Bool.and(I.tolerance_valid(tolerance), I.at_most(I.angular_guard(), I.tolerance_angular(tolerance))))))
  +budget = Bool.and(I.scalar_valid(source_budget), R.equal(source_budget, zero()))
  input_checked(valid, budget, solid, domains, origin, normal, tolerance)
