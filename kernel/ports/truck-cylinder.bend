import Base
import ../real.bend as R
import ../precise.bend as G
import ../analytic.bend as A
import ../topology.bend as T
import ../intersections.bend as I
import ../curve-plane.bend as C
import ../face-classification.bend as F
import ../cylinder-classification.bend as K
import ../solid-classification.bend as S
import ./types.bend as P
import ./truck-topology.bend as L

# Truck transversal loop-store specialization for one full cylindrical band.
# The closed section is obtained analytically; upstream mesh/Newton leaders are
# not needed for plane/cylinder. Each result has explicit seam topology and is
# validated over whole curves, never merely at sampled points. Apache-2.0 source
# mapping and narrower failure domain: docs/port-truck.md.
type Entry is Data:
  Entry{index: U32, face: A.Face}
type Inventory is Data:
  Inventory{valid: Bool, caps: List<&2, Entry>, walls: List<&2, Entry>}
type Cap is Data:
  Cap{index: U32, face: A.Face, edge: U32, vertex: U32, point: G.Vec3, curve: A.Curve, sense: Bool, forward: Bool}
type Band is Data:
  Band{solid: A.Solid, first: Cap, second: Cap, wall: Entry, seam: U32}
type Preparation is Data:
  Prepared{band: Band}
  Rejected{}
type Range is Data:
  Range{low: R.Real, high: R.Real}

def zero() -> R.Real:
  R.from_f32(0.0)

def inventory_add( +result: Inventory, +index: U32, +face: A.Face) -> Inventory:
  Inventory{valid, caps, walls} = result
  A.Face{surface, _, _} = face
  match surface:
    case A.Plane{_, _, _}:
      Inventory{valid, Entry{index, face} <> caps, walls}
    case A.Cylinder{_, _, _, _}:
      Inventory{valid, caps, Entry{index, face} <> walls}
    case _:
      Inventory{False{}, caps, walls}

def inventory( +faces: List<&2, A.Face>, +index: U32) -> Inventory:
  match faces:
    case Nil{}:
      Inventory{True{}, Nil{}, Nil{}}
    case face <> tail:
      inventory_add(inventory(tail, (index + 1 : U32)), index, face)

def full_round( +curve: A.Curve) -> Bool:
  match curve:
    case A.Circle{_, _, _, _}:
      True{}
    case A.Ellipse{_, _, _, _, _}:
      True{}
    case _:
      False{}

def cap_edge( +edge: A.Edge, +entry: Entry, +edge_index: U32, +vertices: List<&2, G.Vec3>, +forward: Bool) -> Maybe<&2, Cap>:
  A.Edge{+a, b, +curve, sense} = edge
  Entry{index, face} = entry
  +valid = Bool.and(U32.is_eq(a, b), Bool.and(U32.is_lt(a, U32.from_nat(List.length(&2, G.Vec3, vertices))), full_round(curve)))
  Bool.pick(Maybe<&2, Cap>, valid, Some{Cap{index, face, edge_index, a, L.vertex(vertices, a), curve, sense, forward}}, None{})

def cap(+entry: Entry, +vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>) -> Maybe<&2, Cap>:
  Entry{_, face} = entry
  match face:
    case A.Face{A.Plane{_, _, _}, _, A.Loop{True{}, T.Use{+index, forward} <> Nil{}} <> Nil{}}:
      cap_edge(L.edge(List.get(&2, A.Edge, edges, U32.to_nat(index))), entry, index, vertices, forward)
    case _:
      None{}

def line_ids( +edges: List<&2, A.Edge>, +index: U32) -> List<&2, U32>:
  match edges:
    case Nil{}:
      Nil{}
    case A.Edge{_, _, A.Line{_, _}, _} <> tail:
      index <> line_ids(tail, (index + 1 : U32))
    case _ <> tail:
      line_ids(tail, (index + 1 : U32))

def combine( +first: Maybe<&2, Cap>, +second: Maybe<&2, Cap>, +seam: List<&2, U32>, +solid: A.Solid, +wall: Entry) -> Preparation:
  match first second seam:
    case Some{a} Some{b} index <> Nil{}:
      Prepared{Band{solid, a, b, wall, index}}
    case _ _ _:
      Rejected{}

def prepare_inventory( +result: Inventory, +solid: A.Solid) -> Preparation:
  match result solid:
    case Inventory{True{}, a <> b <> Nil{}, wall <> Nil{}} A.Solid{+vertices, +edges, _}:
      combine(cap(a, vertices, edges), cap(b, vertices, edges), line_ids(edges, 0), solid, wall)
    case _ _:
      Rejected{}

def preparation(+solid: A.Solid) -> Preparation:
  A.Solid{_, _, faces} = solid
  prepare_inventory(inventory(faces, 0), solid)

def range_vectors( +center: G.Vec3, +u: G.Vec3, +v: G.Vec3, +origin: G.Vec3, +normal: G.Vec3) -> Range:
  +middle = G.dot(G.sub(center, origin), normal)
  +a = G.dot(u, normal)
  +b = G.dot(v, normal)
  +amplitude = R.sqrt(R.add(R.mul(a, a), R.mul(b, b)))
  Range{R.sub(middle, amplitude), R.add(middle, amplitude)}

def range( +curve: A.Curve, +origin: G.Vec3, +normal: G.Vec3) -> Range:
  match curve:
    case A.Circle{center, n, +x, +radius}:
      range_vectors(center, G.scale(x, radius), G.scale(G.cross(n, x), radius), origin, normal)
    case A.Ellipse{center, n, +x, major, minor}:
      range_vectors(center, G.scale(x, major), G.scale(G.cross(n, x), minor), origin, normal)
    case _:
      Range{zero(), zero()}

def cap_curve( +value: Cap) -> A.Curve:
  Cap{_, _, _, _, _, curve, _, _} = value
  curve

def cap_point( +value: Cap) -> G.Vec3:
  Cap{_, _, _, _, point, _, _, _} = value
  point

def cap_outward( +value: Cap) -> G.Vec3:
  Cap{_, A.Face{surface, sense, _}, _, _, _, _, _, _} = value
  L.outward(surface, sense)

def curve_normal( +curve: A.Curve) -> G.Vec3:
  match curve:
    case A.Circle{_, normal, _, _}:
      normal
    case A.Ellipse{_, normal, _, _, _}:
      normal
    case _:
      G.v3(0.0, 0.0, 0.0)

def prepared_loops( +result: F.LoopPreparation) -> Bool:
  match result:
    case F.PreparedLoops{F.PreparedLoop{True{}, edges} <> Nil{}}:
      F.loop_valid(edges)
    case _:
      False{}

def cap_valid(+value: Cap, +vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>, +resolution: R.Real) -> Bool:
  Cap{_, A.Face{+surface, sense, +loops}, _, _, _, +curve, +curve_sense, forward} = value
  match surface:
    case A.Plane{+origin, +normal, +x}:
      +traversal = Bool.pick(Bool, forward, curve_sense, Bool.not(curve_sense))
      +actual = G.scale(curve_normal(curve), Bool.pick(R.Real, traversal, R.from_f32(1.0), R.neg(R.from_f32(1.0))))
      +frame = Bool.and(I.vec_valid(origin), Bool.and(C.frame_valid(normal, x), C.curve_valid(curve)))
      +orientation = I.at_most(I.length(G.sub(actual, L.outward(surface, sense))), I.angular_guard())
      Bool.and(frame, Bool.and(orientation, prepared_loops(F.prepare_loops(loops, vertices, edges, Nil{}, origin, normal, resolution))))
    case _:
      False{}

def ordered_bounds( +a: Range, +b: Range, +outward_a: R.Real, +outward_b: R.Real, +margin: R.Real, +angular: R.Real) -> Bool:
  Range{+al, +ah} = a
  Range{+bl, +bh} = b
  +forward = Bool.and(R.less(R.add(ah, margin), bl), Bool.and(R.less(outward_a, R.neg(angular)), R.less(angular, outward_b)))
  +reverse = Bool.and(R.less(R.add(bh, margin), al), Bool.and(R.less(outward_b, R.neg(angular)), R.less(angular, outward_a)))
  Bool.or(forward, reverse)

def round_ids( +a: Cap, +b: Cap, +seam: U32) -> Bool:
  Cap{_, _, +ea, +va, _, _, _, _} = a
  Cap{_, _, +eb, +vb, _, _, _, _} = b
  Bool.and(Bool.not(U32.is_eq(ea, eb)), Bool.and(Bool.not(U32.is_eq(va, vb)), Bool.and(Bool.not(U32.is_eq(ea, seam)), Bool.not(U32.is_eq(eb, seam)))))

def band_valid( +band: Band, +resolution: R.Real) -> Bool:
  Band{A.Solid{+vertices, +edges, +faces}, +a, +b, Entry{_, wall}, seam} = band
  match wall:
    case A.Face{A.Cylinder{+origin, +axis, +x, +radius}, True{}, +loops}:
      +size = Bool.and(U32.is_eq(U32.from_nat(List.length(&2, G.Vec3, vertices)), 2), Bool.and(U32.is_eq(U32.from_nat(List.length(&2, A.Edge, edges)), 3), U32.is_eq(U32.from_nat(List.length(&2, A.Face, faces)), 3)))
      +shape = Bool.and(I.vec_valid(origin), Bool.and(C.frame_valid(axis, x), Bool.and(I.scalar_valid(radius), R.less(resolution, radius))))
      +caps = Bool.and(cap_valid(a, vertices, edges, resolution), cap_valid(b, vertices, edges, resolution))
      +wall_valid = prepared_loops(K.prepare_loops(loops, vertices, edges, Nil{}, origin, axis, radius, resolution))
      Bool.and(size, Bool.and(shape, Bool.and(L.vertices_valid(vertices), Bool.and(round_ids(a, b, seam), Bool.and(S.edges_closed(edges, faces, 0), Bool.and(caps, wall_valid))))))
    case _:
      False{}

def band_ordered( +band: Band, +resolution: R.Real, +angular: R.Real) -> Bool:
  Band{_, +a, +b, Entry{_, A.Face{surface, _, _}}, _} = band
  match surface:
    case A.Cylinder{+origin, +axis, _, _}:
      ordered_bounds(range(cap_curve(a), origin, axis), range(cap_curve(b), origin, axis), G.dot(cap_outward(a), axis), G.dot(cap_outward(b), axis), resolution, angular)
    case _:
      False{}

def side( +range: Range, +margin: R.Real) -> U32:
  Range{low, high} = range
  Bool.pick(U32, R.less(high, R.neg(margin)), 1, Bool.pick(U32, R.less(margin, low), 2, 0))

def near_limit( +range: Range, +margin: R.Real) -> Bool:
  Range{low, high} = range
  Bool.or(I.at_most(R.abs(low), margin), I.at_most(R.abs(high), margin))

def normalize_edges( +edges: List<&2, A.Edge>) -> List<&2, A.Edge>:
  match edges:
    case Nil{}:
      Nil{}
    case A.Edge{a, b, curve, sense} <> tail:
      A.Edge{a, b, L.normalized_curve(curve), sense} <> normalize_edges(tail)

def unchanged( +solid: A.Solid) -> P.Result:
  A.Solid{vertices, +edges, +faces} = solid
  P.Clipped{A.Solid{vertices, normalize_edges(edges), faces}, L.auto_domains(edges), L.source_faces(faces, 0), L.source_edges(edges, 0)}

def final_checked( +valid: Bool, +solid: A.Solid, +faces: List<&2, P.FaceOrigin>, +edges: List<&2, P.EdgeOrigin>) -> P.Result:
  match valid:
    case True{}:
      P.Clipped{solid, [F.AutoDomain{}, F.AutoDomain{}, F.AutoDomain{}], faces, edges}
    case False{}:
      P.Unresolved{P.ConstructionFailure{}}

def final_prepared( +prepared: Preparation, +solid: A.Solid, +faces: List<&2, P.FaceOrigin>, +edges: List<&2, P.EdgeOrigin>, +resolution: R.Real, +angular: R.Real) -> P.Result:
  match prepared:
    case Prepared{band}:
      final_checked(Bool.and(band_valid(band, resolution), band_ordered(band, resolution, angular)), solid, faces, edges)
    case Rejected{}:
      P.Unresolved{P.ConstructionFailure{}}

def rebuild( +keep: Cap, +other: Cap, +wall: Entry, +seam: U32, +curve: A.Curve, +origin: G.Vec3, +normal: G.Vec3, +resolution: R.Real, +angular: R.Real) -> P.Result:
  Cap{cap_id, A.Face{surface, cap_sense, _}, edge_id, _, +start, rim, rim_sense, +forward} = keep
  Entry{+wall_id, A.Face{wall_surface, wall_sense, _}} = wall
  +last = cap_point(other)
  +da = I.signed_distance(G.sub(start, origin), normal)
  +db = I.signed_distance(G.sub(last, origin), normal)
  +point = G.add(start, G.scale(G.sub(last, start), R.div(da, R.sub(da, db))))
  +solid = {A.Solid{[start, point],
    [A.Edge{0, 0, rim, rim_sense}, A.Edge{1, 1, curve, True{}}, A.Edge{0, 1, A.Line{start, G.normalize(G.sub(point, start))}, True{}}],
    [A.Face{surface, cap_sense, [A.Loop{True{}, [T.Use{0, forward}]}]},
     A.Face{A.plane(origin, normal), True{}, [A.Loop{True{}, [T.Use{1, True{}}]}]},
     A.Face{wall_surface, wall_sense, [A.Loop{True{}, [T.Use{0, Bool.not(forward)}, T.Use{2, True{}}, T.Use{1, False{}}, T.Use{2, False{}}]}]}]} : A.Solid}
  final_prepared(preparation(solid), solid, [P.SourceFace{cap_id}, P.CutFace{}, P.SourceFace{wall_id}], [P.SourceEdge{edge_id}, P.CutEdge{wall_id}, P.SourceEdge{seam}], resolution, angular)

def section( +result: I.IntersectionResult, +keep: Cap, +other: Cap, +wall: Entry, +seam: U32, +origin: G.Vec3, +normal: G.Vec3, +resolution: R.Real, +angular: R.Real) -> P.Result:
  match result:
    case I.Resolved{I.CircleSection{}, curve <> Nil{}, _, _}:
      rebuild(keep, other, wall, seam, curve, origin, normal, resolution, angular)
    case I.Resolved{I.EllipseSection{}, curve <> Nil{}, _, _}:
      rebuild(keep, other, wall, seam, curve, origin, normal, resolution, angular)
    case I.Resolved{I.TangentGenerator{}, _, _, _}:
      P.Unresolved{P.AmbiguousContact{}}
    case _:
      P.Unresolved{P.UnsupportedArrangement{}}

def section_band( +keep: Cap, +other: Cap, +wall: Entry, +seam: U32, +origin: G.Vec3, +normal: G.Vec3, +tolerance: I.Tolerance, +resolution: R.Real) -> P.Result:
  Entry{_, A.Face{surface, _, _}} = wall
  section(I.intersect(A.plane(origin, normal), surface, tolerance), keep, other, wall, seam, origin, normal, resolution, I.tolerance_angular(tolerance))

def selected( +band: Band, +a: U32, +b: U32, +touching: Bool, +origin: G.Vec3, +normal: G.Vec3, +tolerance: I.Tolerance, +resolution: R.Real) -> P.Result:
  Band{solid, first, second, wall, seam} = band
  match a b:
    case 1 1:
      unchanged(solid)
    case 2 2:
      P.Empty{}
    case 1 2:
      section_band(first, second, wall, seam, origin, normal, tolerance, resolution)
    case 2 1:
      section_band(second, first, wall, seam, origin, normal, tolerance, resolution)
    case _ _:
      P.Unresolved{Bool.pick(P.Reason, touching, P.AmbiguousContact{}, P.UnsupportedArrangement{})}

def classify_ranges( +a: Range, +b: Range, +band: Band, +origin: G.Vec3, +normal: G.Vec3, +tolerance: I.Tolerance, +resolution: R.Real) -> P.Result:
  +margin = R.add(I.tolerance_linear(tolerance), resolution)
  selected(band, side(a, margin), side(b, margin), Bool.or(near_limit(a, margin), near_limit(b, margin)), origin, normal, tolerance, resolution)

def supported( +valid: Bool, +band: Band, +origin: G.Vec3, +normal: G.Vec3, +tolerance: I.Tolerance, +resolution: R.Real) -> P.Result:
  match valid:
    case False{}:
      P.Unresolved{P.UnsupportedArrangement{}}
    case True{}:
      Band{_, first, second, _, _} = band
      classify_ranges(range(cap_curve(first), origin, G.normalize(normal)), range(cap_curve(second), origin, G.normalize(normal)), band, origin, normal, tolerance, resolution)

def validated( +valid: Bool, +band: Band, +origin: G.Vec3, +normal: G.Vec3, +tolerance: I.Tolerance, +resolution: R.Real) -> P.Result:
  match valid:
    case False{}:
      P.Unresolved{P.InvalidTopology{}}
    case True{}:
      supported(band_ordered(band, resolution, I.tolerance_angular(tolerance)), band, origin, normal, tolerance, resolution)

def scale( +vertices: List<&2, G.Vec3>, +value: R.Real) -> R.Real:
  match vertices:
    case Nil{}:
      value
    case point <> tail:
      scale(tail, R.max(value, I.magnitude(point)))

def curve_scale( +curve: A.Curve) -> R.Real:
  match curve:
    case A.Line{origin, _}:
      I.magnitude(origin)
    case A.Circle{center, _, _, radius}:
      R.add(I.magnitude(center), R.abs(radius))
    case A.Ellipse{center, _, _, major, minor}:
      R.add(I.magnitude(center), R.max(R.abs(major), R.abs(minor)))

def edge_scale( +edges: List<&2, A.Edge>, +value: R.Real) -> R.Real:
  match edges:
    case Nil{}:
      value
    case A.Edge{_, _, curve, _} <> tail:
      edge_scale(tail, R.max(value, curve_scale(curve)))

def surface_scale( +surface: A.Surface) -> R.Real:
  match surface:
    case A.Plane{origin, _, _}:
      I.magnitude(origin)
    case A.Cylinder{origin, _, _, radius}:
      R.add(I.magnitude(origin), R.abs(radius))
    case A.Cone{origin, _, _, radius, _}:
      R.add(I.magnitude(origin), R.abs(radius))
    case A.Sphere{origin, _, _, radius}:
      R.add(I.magnitude(origin), R.abs(radius))
    case A.Torus{origin, _, _, major, minor}:
      R.add(I.magnitude(origin), R.add(R.abs(major), R.abs(minor)))

def face_scale( +faces: List<&2, A.Face>, +value: R.Real) -> R.Real:
  match faces:
    case Nil{}:
      value
    case A.Face{surface, _, _} <> tail:
      face_scale(tail, R.max(value, surface_scale(surface)))

def prepared( +result: Preparation, +origin: G.Vec3, +normal: G.Vec3, +tolerance: I.Tolerance, +resolution: R.Real) -> P.Result:
  match result:
    case Rejected{}:
      P.Unresolved{P.UnsupportedArrangement{}}
    case Prepared{+band}:
      validated(band_valid(band, resolution), band, origin, normal, tolerance, resolution)

def resolve( +valid: Bool, +solid: A.Solid, +origin: G.Vec3, +normal: G.Vec3, +tolerance: I.Tolerance, +resolution: R.Real) -> P.Result:
  match valid:
    case False{}:
      P.Unresolved{P.ResolutionLimit{}}
    case True{}:
      prepared(preparation(solid), origin, normal, tolerance, resolution)

def auto_domains( +domains: List<&2, F.DomainChoice>) -> Bool:
  match domains:
    case Nil{}:
      True{}
    case F.AutoDomain{} <> tail:
      auto_domains(tail)
    case _:
      False{}

def checked( +valid: Bool, +source_ok: Bool, +domains_ok: Bool, +solid: A.Solid, +origin: G.Vec3, +normal: G.Vec3, +tolerance: I.Tolerance) -> P.Result:
  match valid source_ok domains_ok:
    case False{} _ _:
      P.Unresolved{P.InvalidInput{}}
    case _ False{} _:
      P.Unresolved{P.SourceTolerance{}}
    case _ _ False{}:
      P.Unresolved{P.UnsupportedDomain{}}
    case True{} True{} True{}:
      A.Solid{vertices, edges, faces} = solid
      +resolution = R.mul(I.angular_guard(), face_scale(faces, edge_scale(edges, scale(vertices, R.max(R.from_f32(1.0), I.magnitude(origin))))))
      resolve(R.less(resolution, I.tolerance_linear(tolerance)), solid, origin, normal, tolerance, resolution)

def clip( +solid: A.Solid, +domains: List<&2, F.DomainChoice>, +origin: G.Vec3, +normal: G.Vec3, +tolerance: I.Tolerance, +source_budget: R.Real) -> P.Result:
  +valid = Bool.and(I.vec_valid(origin), Bool.and(I.vec_valid(normal), Bool.and(I.direction_valid(normal), Bool.and(I.tolerance_valid(tolerance), I.at_most(I.angular_guard(), I.tolerance_angular(tolerance))))))
  +source_ok = Bool.and(I.scalar_valid(source_budget), R.equal(source_budget, zero()))
  +domain_ok = Bool.and(auto_domains(domains), Bool.not(U32.is_lt(3, U32.from_nat(List.length(&2, F.DomainChoice, domains)))))
  checked(valid, source_ok, domain_ok, solid, origin, normal, tolerance)
