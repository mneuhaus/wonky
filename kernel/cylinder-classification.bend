import Base
import ./real.bend as R
import ./precise.bend as G
import ./analytic.bend as A
import ./topology.bend as T
import ./intersections.bend as I
import ./curve-plane.bend as C
import ./face-classification.bend as F

# Bounded, valid trimmed-cylinder regions. All physical boundaries contribute
# parity along the query's axial meridian; opposite uses of a seam cancel.
# No angular chart, polygon approximation, or displaced query is introduced.
type Reason is Data:
  InvalidInput{}
  InvalidIndex{}
  InvalidTopology{}
  NonCylindricalFace{}
  MissingTrim{}
  InvalidTrim{}
  InputGap{}
  ResolutionLimit{}
  UnsupportedSeam{}
  NearCylinder{}
  NearBoundary{}
  AmbiguousMeridian{}
  UnbalancedMeridian{}

type Classification is Data:
  Inside{rays: U32}
  Outside{rays: U32}
  Boundary{edge: U32, parameter: R.Real}
  Unresolved{reason: Reason}

type EdgeCounts is Data:
  EdgeCounts{forward: U32, backward: U32}

type PhysicalEdges is Data:
  PhysicalEdges{edges: List<&2, F.PreparedEdge>}
  BadPhysicalEdges{reason: Reason}

type MeridianCount is Data:
  MeridianCount{valid: Bool, above: U32, below: U32}

def zero() -> R.Real:
  R.from_f32(0.0)

def radial(+delta: G.Vec3, +axis: G.Vec3) -> G.Vec3:
  G.sub(delta, G.scale(axis, G.dot(delta, axis)))

def project(point: G.Vec3, +origin: G.Vec3, +axis: G.Vec3, radius: R.Real) -> G.Vec3:
  +delta = G.sub(point, origin)
  G.add(origin, G.add(G.scale(axis, G.dot(delta, axis)), G.scale(G.normalize(radial(delta, axis)), radius)))

def radial_error(point: G.Vec3, origin: G.Vec3, axis: G.Vec3, radius: R.Real) -> R.Real:
  R.abs(R.sub(I.length(radial(G.sub(point, origin), axis)), radius))

# A finite line's radial vector stays on its radial endpoint segment. The
# endpoint error plus that segment's length bounds every intervening error.
def line_incidence(domain: C.Domain, +curve: A.Curve, +origin: G.Vec3, +axis: G.Vec3, +radius: R.Real) -> R.Real:
  match domain:
    case C.Untrimmed{}:
      I.limit()
    case C.Interval{first, last}:
      +a = radial(G.sub(A.curve_point(curve, first), origin), axis)
      +b = radial(G.sub(A.curve_point(curve, last), origin), axis)
      ends = R.max(R.abs(R.sub(I.length(a), radius)), R.abs(R.sub(I.length(b), radius)))
      R.add(ends, I.length(G.sub(a, b)))

# For c + u*cos(t) + v*sin(t), the squared cylinder residual is a degree-two
# trigonometric polynomial. Sum |coefficients| / radius bounds radial error
# over the entire supporting curve, including unsampled portions of an arc.
def round_incidence(+c: G.Vec3, +u: G.Vec3, +v: G.Vec3, +radius: R.Real) -> R.Real:
  +uu = G.dot(u, u)
  +vv = G.dot(v, v)
  constant = R.sub(R.add(G.dot(c, c), R.mul(R.add(uu, vv), R.from_f32(0.5))), R.mul(radius, radius))
  cosine = R.mul(G.dot(c, u), R.from_f32(2.0))
  sine = R.mul(G.dot(c, v), R.from_f32(2.0))
  double_cosine = R.mul(R.sub(uu, vv), R.from_f32(0.5))
  double_sine = G.dot(u, v)
  sum = R.add(R.add(R.abs(constant), R.abs(cosine)), R.add(R.abs(sine), R.add(R.abs(double_cosine), R.abs(double_sine))))
  R.div(sum, radius)

def round_on_cylinder(center: G.Vec3, normal: G.Vec3, +x: G.Vec3, major: R.Real, minor: R.Real, origin: G.Vec3, +axis: G.Vec3, radius: R.Real) -> R.Real:
  round_incidence(radial(G.sub(center, origin), axis), radial(G.scale(x, major), axis), radial(G.scale(G.cross(normal, x), minor), axis), radius)

def curve_incidence(+curve: A.Curve, domain: C.Domain, origin: G.Vec3, axis: G.Vec3, radius: R.Real) -> R.Real:
  match curve:
    case A.Line{_, _}:
      line_incidence(domain, curve, origin, axis, radius)
    case A.Circle{center, normal, x, +r}:
      round_on_cylinder(center, normal, x, r, r, origin, axis, radius)
    case A.Ellipse{center, normal, x, major, minor}:
      round_on_cylinder(center, normal, x, major, minor, origin, axis, radius)

def edge_checked(valid: Bool, index: U32, edge: A.Edge, domain: C.Domain, start: G.Vec3, end: G.Vec3, forward: Bool) -> F.EdgePreparation:
  match valid:
    case True{}:
      F.PreparedEdges{[F.PreparedEdge{index, edge, domain, start, end, forward}]}
    case False{}:
      F.BadEdges{F.InputGap{}}

def edge_domain_valid(valid: Bool, index: U32, +edge: A.Edge, +domain: C.Domain, +start: G.Vec3, +end: G.Vec3, forward: Bool, origin: G.Vec3, axis: G.Vec3, radius: R.Real, +budget: R.Real) -> F.EdgePreparation:
  match valid:
    case False{}:
      F.BadEdges{F.InvalidTrim{}}
    case True{}:
      A.Edge{_, _, +curve, sense} = edge
      endpoints = F.endpoint_error(domain, curve, start, end, sense)
      incidence = curve_incidence(curve, domain, origin, axis, radius)
      edge_checked(Bool.and(I.at_most(endpoints, budget), I.at_most(incidence, budget)), index, edge, domain, start, end, forward)

def edge_domain(domain: Maybe<&2, C.Domain>, index: U32, +edge: A.Edge, start: G.Vec3, end: G.Vec3, forward: Bool, origin: G.Vec3, axis: G.Vec3, radius: R.Real, budget: R.Real) -> F.EdgePreparation:
  match domain:
    case None{}:
      F.BadEdges{F.MissingTrim{}}
    case Some{+value}:
      A.Edge{_, _, curve, _} = edge
      +periodic = C.curve_periodic(curve)
      valid = Bool.and(C.domain_valid(value, periodic), F.finite_domain(value, periodic))
      edge_domain_valid(valid, index, edge, value, start, end, forward, origin, axis, radius, budget)

def edge_points_valid(valid: Bool, index: U32, +edge: A.Edge, choice: F.DomainChoice, +start: G.Vec3, +end: G.Vec3, forward: Bool, origin: G.Vec3, axis: G.Vec3, radius: R.Real, budget: R.Real) -> F.EdgePreparation:
  match valid:
    case False{}:
      F.BadEdges{F.InvalidInput{}}
    case True{}:
      edge_domain(F.resolve_domain(choice, edge, start, end), index, edge, start, end, forward, origin, axis, radius, budget)

def edge_points(a: Maybe<&2, G.Vec3>, b: Maybe<&2, G.Vec3>, index: U32, +edge: A.Edge, choice: F.DomainChoice, forward: Bool, origin: G.Vec3, axis: G.Vec3, radius: R.Real, budget: R.Real) -> F.EdgePreparation:
  match a b:
    case Some{+start} Some{+end}:
      A.Edge{_, _, curve, _} = edge
      valid = Bool.and(C.curve_valid(curve), Bool.and(I.vec_valid(start), I.vec_valid(end)))
      edge_points_valid(valid, index, edge, choice, start, end, forward, origin, axis, radius, budget)
    case _ _:
      F.BadEdges{F.InvalidIndex{}}

def edge_lookup(found: Maybe<&2, A.Edge>, index: U32, choice: F.DomainChoice, +vertices: List<&2, G.Vec3>, forward: Bool, origin: G.Vec3, axis: G.Vec3, radius: R.Real, budget: R.Real) -> F.EdgePreparation:
  match found:
    case None{}:
      F.BadEdges{F.InvalidIndex{}}
    case Some{+edge}:
      A.Edge{first, last, _, _} = edge
      edge_points(List.get(&2, G.Vec3, vertices, U32.to_nat(first)), List.get(&2, G.Vec3, vertices, U32.to_nat(last)), index, edge, choice, forward, origin, axis, radius, budget)

def prepare_uses(uses: List<&2, T.Coedge>, +vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>, +domains: List<&2, F.DomainChoice>, +origin: G.Vec3, +axis: G.Vec3, +radius: R.Real, +budget: R.Real) -> F.EdgePreparation:
  match uses:
    case Nil{}:
      F.PreparedEdges{Nil{}}
    case T.Use{+index, forward} <> tail:
      choice = F.choose_domain(List.get(&2, F.DomainChoice, domains, U32.to_nat(index)))
      one = edge_lookup(List.get(&2, A.Edge, edges, U32.to_nat(index)), index, choice, vertices, forward, origin, axis, radius, budget)
      F.join_edges(one, prepare_uses(tail, vertices, edges, domains, origin, axis, radius, budget))

def prepare_loops(loops: List<&2, A.Loop>, +vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>, +domains: List<&2, F.DomainChoice>, +origin: G.Vec3, +axis: G.Vec3, +radius: R.Real, +budget: R.Real) -> F.LoopPreparation:
  match loops:
    case Nil{}:
      F.PreparedLoops{Nil{}}
    case A.Loop{outer, uses} <> tail:
      one = F.prepared_loop(prepare_uses(uses, vertices, edges, domains, origin, axis, radius, budget), outer)
      F.join_loops(one, prepare_loops(tail, vertices, edges, domains, origin, axis, radius, budget))

def preparation_reason(reason: F.Reason) -> Reason:
  match reason:
    case F.InvalidIndex{}:
      InvalidIndex{}
    case F.InvalidTopology{}:
      InvalidTopology{}
    case F.MissingTrim{}:
      MissingTrim{}
    case F.InvalidTrim{}:
      InvalidTrim{}
    case F.InputGap{}:
      InputGap{}
    case _:
      InvalidInput{}

def flatten(loops: List<&2, F.PreparedLoop>) -> List<&2, F.PreparedEdge>:
  match loops:
    case Nil{}:
      Nil{}
    case F.PreparedLoop{_, edges} <> tail:
      List.append(&2, F.PreparedEdge, edges, flatten(tail))

def add_counts(counts: EdgeCounts, +same: Bool, +forward: Bool) -> EdgeCounts:
  EdgeCounts{a, b} = counts
  EdgeCounts{(a + Bool.pick(U32, Bool.and(same, forward), 1, 0) : U32), (b + Bool.pick(U32, Bool.and(same, Bool.not(forward)), 1, 0) : U32)}

def edge_counts(edges: List<&2, F.PreparedEdge>, +index: U32) -> EdgeCounts:
  match edges:
    case Nil{}:
      EdgeCounts{0, 0}
    case F.PreparedEdge{i, _, _, _, _, forward} <> tail:
      add_counts(edge_counts(tail, index), U32.is_eq(index, i), forward)

def physical_join(one: PhysicalEdges, rest: PhysicalEdges) -> PhysicalEdges:
  match one rest:
    case PhysicalEdges{a} PhysicalEdges{b}:
      PhysicalEdges{List.append(&2, F.PreparedEdge, a, b)}
    case BadPhysicalEdges{reason} _:
      BadPhysicalEdges{reason}
    case _ BadPhysicalEdges{reason}:
      BadPhysicalEdges{reason}

def seam_curve(curve: A.Curve) -> PhysicalEdges:
  match curve:
    case A.Line{_, _}:
      PhysicalEdges{Nil{}}
    case _:
      BadPhysicalEdges{UnsupportedSeam{}}

def physical_one(single: Bool, pair: Bool, +edge: F.PreparedEdge) -> PhysicalEdges:
  match single pair:
    case True{} _:
      PhysicalEdges{[edge]}
    case False{} True{}:
      F.PreparedEdge{_, A.Edge{_, _, curve, _}, _, _, _, _} = edge
      seam_curve(curve)
    case False{} False{}:
      BadPhysicalEdges{InvalidTopology{}}

def physical_counts(counts: EdgeCounts, edge: F.PreparedEdge) -> PhysicalEdges:
  EdgeCounts{+a, +b} = counts
  physical_one(U32.is_eq((a + b : U32), 1), Bool.and(U32.is_eq(a, 1), U32.is_eq(b, 1)), edge)

def physical_edges(edges: List<&2, F.PreparedEdge>, +all: List<&2, F.PreparedEdge>) -> PhysicalEdges:
  match edges:
    case Nil{}:
      PhysicalEdges{Nil{}}
    case +edge <> tail:
      F.PreparedEdge{index, _, _, _, _, _} = edge
      one = physical_counts(edge_counts(all, index), edge)
      physical_join(one, physical_edges(tail, all))

def line_boundary(domain: C.Domain, index: U32, +curve: A.Curve, center: G.Vec3, direction: G.Vec3, +point: G.Vec3, origin: G.Vec3, axis: G.Vec3, radius: R.Real, linear: R.Real, source: R.Real, resolution: R.Real) -> F.BoundaryState:
  match domain:
    case C.Untrimmed{}:
      F.UncertainBoundary{}
    case C.Interval{first, last}:
      +parameter = F.clamp(F.line_parameter(center, direction, point), first, last)
      +candidate = A.curve_point(curve, parameter)
      lower = F.distance(point, candidate)
      upper = F.distance(point, project(candidate, origin, axis, radius))
      F.boundary_distance(index, parameter, upper, lower, linear, source, resolution)

def round_candidate(candidate: F.Candidate, index: U32, curve: A.Curve, +point: G.Vec3, origin: G.Vec3, axis: G.Vec3, radius: R.Real, +minimum: R.Real, +height: R.Real, linear: R.Real, source: R.Real, resolution: R.Real) -> F.BoundaryState:
  F.Candidate{+parameter, metric} = candidate
  lower = R.sqrt(R.add(R.mul(R.mul(minimum, minimum), metric), R.mul(height, height)))
  upper = F.distance(point, project(A.curve_point(curve, parameter), origin, axis, radius))
  F.boundary_distance(index, parameter, upper, lower, linear, source, resolution)

def round_boundary(index: U32, curve: A.Curve, domain: C.Domain, center: G.Vec3, normal: G.Vec3, +x: G.Vec3, major: R.Real, minor: R.Real, +point: G.Vec3, origin: G.Vec3, axis: G.Vec3, radius: R.Real, linear: R.Real, source: R.Real, resolution: R.Real) -> F.BoundaryState:
  +y = G.cross(normal, x)
  +a = R.mul(major, I.length(x))
  +b = R.mul(minor, I.length(y))
  +delta = G.sub(point, center)
  u = R.div(G.dot(delta, G.normalize(x)), a)
  v = R.div(G.dot(delta, G.normalize(y)), b)
  height = G.dot(delta, G.normalize(G.cross(x, y)))
  round_candidate(F.round_candidate(domain, u, v), index, curve, point, origin, axis, radius, R.min(a, b), height, linear, source, resolution)

def edge_boundary(edge: F.PreparedEdge, point: G.Vec3, origin: G.Vec3, axis: G.Vec3, radius: R.Real, linear: R.Real, source: R.Real, resolution: R.Real) -> F.BoundaryState:
  F.PreparedEdge{index, A.Edge{_, _, +curve, _}, domain, _, _, _} = edge
  match curve:
    case A.Line{center, direction}:
      line_boundary(domain, index, curve, center, direction, point, origin, axis, radius, linear, source, resolution)
    case A.Circle{center, normal, x, +r}:
      round_boundary(index, curve, domain, center, normal, x, r, r, point, origin, axis, radius, linear, source, resolution)
    case A.Ellipse{center, normal, x, major, minor}:
      round_boundary(index, curve, domain, center, normal, x, major, minor, point, origin, axis, radius, linear, source, resolution)

def boundaries(edges: List<&2, F.PreparedEdge>, +point: G.Vec3, +origin: G.Vec3, +axis: G.Vec3, +radius: R.Real, +linear: R.Real, +source: R.Real, +resolution: R.Real) -> F.BoundaryState:
  match edges:
    case Nil{}:
      F.ClearBoundary{}
    case head <> tail:
      F.boundary_join(edge_boundary(head, point, origin, axis, radius, linear, source, resolution), boundaries(tail, point, origin, axis, radius, linear, source, resolution))

def count_join(a: MeridianCount, b: MeridianCount) -> MeridianCount:
  MeridianCount{va, aa, ba} = a
  MeridianCount{vb, ab, bb} = b
  MeridianCount{Bool.and(va, vb), (aa + ab : U32), (ba + bb : U32)}

def hit_side(positive: Bool, negative: Bool, hit: C.Hit, point: G.Vec3, axis: G.Vec3, +margin: R.Real) -> MeridianCount:
  match positive negative:
    case True{} _:
      C.Hit{_, at, multiplicity, position} = hit
      +along = G.dot(G.sub(at, point), axis)
      valid = Bool.and(Bool.and(F.interior_position(position), U32.is_eq(multiplicity, 1)), R.less(margin, R.abs(along)))
      MeridianCount{valid, Bool.pick(U32, R.less(margin, along), 1, 0), Bool.pick(U32, R.less(along, R.neg(margin)), 1, 0)}
    case False{} True{}:
      MeridianCount{True{}, 0, 0}
    case False{} False{}:
      MeridianCount{False{}, 0, 0}

def count_hits(hits: List<&2, C.Hit>, +point: G.Vec3, +origin: G.Vec3, +axis: G.Vec3, +direction: G.Vec3, +margin: R.Real) -> MeridianCount:
  match hits:
    case Nil{}:
      MeridianCount{True{}, 0, 0}
    case +hit <> tail:
      C.Hit{_, at, _, _} = hit
      +side = G.dot(G.sub(at, origin), direction)
      one = hit_side(R.less(margin, side), R.less(side, R.neg(margin)), hit, point, axis, margin)
      count_join(one, count_hits(tail, point, origin, axis, direction, margin))

def count_relation(relation: C.Relation, hits: List<&2, C.Hit>, point: G.Vec3, origin: G.Vec3, axis: G.Vec3, direction: G.Vec3, margin: R.Real) -> MeridianCount:
  match relation:
    case C.Disjoint{}:
      MeridianCount{True{}, 0, 0}
    case C.Crossing{}:
      count_hits(hits, point, origin, axis, direction, margin)
    case _:
      MeridianCount{False{}, 0, 0}

def count_result(result: C.CurvePlaneResult, point: G.Vec3, origin: G.Vec3, axis: G.Vec3, direction: G.Vec3, margin: R.Real) -> MeridianCount:
  match result:
    case C.Resolved{relation, hits, _, _}:
      count_relation(relation, hits, point, origin, axis, direction, margin)
    case _:
      MeridianCount{False{}, 0, 0}

def vertex_clear(+vertex: G.Vec3, +origin: G.Vec3, cut: G.Vec3, direction: G.Vec3, +margin: R.Real) -> Bool:
  behind = R.less(G.dot(G.sub(vertex, origin), direction), R.neg(margin))
  Bool.or(behind, R.less(margin, R.abs(G.dot(G.sub(vertex, origin), cut))))

def endpoints_clear(domain: C.Domain, start: G.Vec3, end: G.Vec3, +origin: G.Vec3, +cut: G.Vec3, +direction: G.Vec3, +margin: R.Real) -> Bool:
  match domain:
    case C.Untrimmed{}:
      True{}
    case C.Interval{_, _}:
      Bool.and(vertex_clear(start, origin, cut, direction, margin), vertex_clear(end, origin, cut, direction, margin))

def line_disjoint(curve: A.Curve, start: G.Vec3, end: G.Vec3, +origin: G.Vec3, +cut: G.Vec3, +margin: R.Real) -> Bool:
  match curve:
    case A.Line{_, _}:
      +a = G.dot(G.sub(start, origin), cut)
      +b = G.dot(G.sub(end, origin), cut)
      Bool.or(Bool.and(R.less(margin, a), R.less(margin, b)), Bool.and(R.less(a, R.neg(margin)), R.less(b, R.neg(margin))))
    case _:
      False{}

def meridian_edge_checked(clear: Bool, disjoint: Bool, curve: A.Curve, domain: C.Domain, point: G.Vec3, +origin: G.Vec3, axis: G.Vec3, cut: G.Vec3, direction: G.Vec3, tolerance: I.Tolerance, margin: R.Real) -> MeridianCount:
  match clear disjoint:
    case _ True{}:
      MeridianCount{True{}, 0, 0}
    case False{} False{}:
      MeridianCount{False{}, 0, 0}
    case True{} False{}:
      count_result(C.intersect(curve, origin, cut, domain, tolerance), point, origin, axis, direction, margin)

def meridian_edge(edge: F.PreparedEdge, point: G.Vec3, +origin: G.Vec3, axis: G.Vec3, +cut: G.Vec3, +direction: G.Vec3, tolerance: I.Tolerance, +margin: R.Real) -> MeridianCount:
  F.PreparedEdge{_, A.Edge{_, _, +curve, _}, +domain, +start, +end, _} = edge
  clear = endpoints_clear(domain, start, end, origin, cut, direction, margin)
  disjoint = line_disjoint(curve, start, end, origin, cut, margin)
  meridian_edge_checked(clear, disjoint, curve, domain, point, origin, axis, cut, direction, tolerance, margin)

def meridian_edges(edges: List<&2, F.PreparedEdge>, +point: G.Vec3, +origin: G.Vec3, +axis: G.Vec3, +cut: G.Vec3, +direction: G.Vec3, +tolerance: I.Tolerance, +margin: R.Real) -> MeridianCount:
  match edges:
    case Nil{}:
      MeridianCount{True{}, 0, 0}
    case head <> tail:
      count_join(meridian_edge(head, point, origin, axis, cut, direction, tolerance, margin), meridian_edges(tail, point, origin, axis, cut, direction, tolerance, margin))

def meridian_result(count: MeridianCount) -> Classification:
  MeridianCount{valid, above, below} = count
  +inside = U32.is_eq(U32.and(above, 1), 1)
  agree = U32.is_eq(U32.and(below, 1), Bool.pick(U32, inside, 1, 0))
  Bool.pick(Classification, valid,
    Bool.pick(Classification, agree, Bool.pick(Classification, inside, Inside{2}, Outside{2}), Unresolved{UnbalancedMeridian{}}),
    Unresolved{AmbiguousMeridian{}})

def after_boundary(boundary: F.BoundaryState, edges: List<&2, F.PreparedEdge>, +point: G.Vec3, +origin: G.Vec3, +axis: G.Vec3, tolerance: I.Tolerance, margin: R.Real) -> Classification:
  match boundary:
    case F.OnBoundary{edge, parameter}:
      Boundary{edge, parameter}
    case F.UncertainBoundary{}:
      Unresolved{NearBoundary{}}
    case F.ClearBoundary{}:
      +direction = G.normalize(radial(G.sub(point, origin), axis))
      cut = G.normalize(G.cross(axis, direction))
      meridian_result(meridian_edges(edges, point, origin, axis, cut, direction, tolerance, margin))

def query_location(near: Bool, outside: Bool, +edges: List<&2, F.PreparedEdge>, point: G.Vec3, +origin: G.Vec3, +axis: G.Vec3, +radius: R.Real, +tolerance: I.Tolerance, +source: R.Real, +resolution: R.Real) -> Classification:
  match near outside:
    case True{} _:
      Unresolved{NearCylinder{}}
    case False{} True{}:
      Outside{0}
    case False{} False{}:
      +projected = project(point, origin, axis, radius)
      +linear = I.tolerance_linear(tolerance)
      boundary = boundaries(edges, projected, origin, axis, radius, linear, source, resolution)
      after_boundary(boundary, edges, projected, origin, axis, tolerance, R.add(R.add(linear, source), resolution))

def physical_face(physical: PhysicalEdges, +point: G.Vec3, +origin: G.Vec3, +axis: G.Vec3, +radius: R.Real, +tolerance: I.Tolerance, source: R.Real, +resolution: R.Real) -> Classification:
  match physical:
    case BadPhysicalEdges{reason}:
      Unresolved{reason}
    case PhysicalEdges{Nil{}}:
      Unresolved{InvalidTopology{}}
    case PhysicalEdges{edges}:
      +offset = radial_error(point, origin, axis, radius)
      +linear = I.tolerance_linear(tolerance)
      near = I.at_most(R.abs(R.sub(offset, linear)), resolution)
      query_location(near, R.less(R.add(linear, resolution), offset), edges, point, origin, axis, radius, tolerance, source, resolution)

def prepared_face(prepared: F.LoopPreparation, point: G.Vec3, origin: G.Vec3, axis: G.Vec3, radius: R.Real, tolerance: I.Tolerance, source: R.Real, resolution: R.Real) -> Classification:
  match prepared:
    case F.BadLoops{reason}:
      Unresolved{preparation_reason(reason)}
    case F.PreparedLoops{loops}:
      # A periodic band can legitimately have two noncontractible loops both
      # labelled inner. Physical boundary parity is anchored at axial infinity
      # and does not require a planar-style privileged outer loop.
      +edges = flatten(loops)
      physical_face(physical_edges(edges, edges), point, origin, axis, radius, tolerance, source, resolution)

def resolution_valid(valid: Bool, loops: List<&2, A.Loop>, vertices: List<&2, G.Vec3>, edges: List<&2, A.Edge>, domains: List<&2, F.DomainChoice>, point: G.Vec3, +origin: G.Vec3, axis: G.Vec3, +radius: R.Real, tolerance: I.Tolerance, +source: R.Real, +resolution: R.Real) -> Classification:
  match valid:
    case False{}:
      Unresolved{ResolutionLimit{}}
    case True{}:
      +unit = G.normalize(axis)
      prepared = prepare_loops(loops, vertices, edges, domains, origin, unit, radius, R.add(source, resolution))
      prepared_face(prepared, point, origin, unit, radius, tolerance, source, resolution)

def cylinder_valid(valid: Bool, loops: List<&2, A.Loop>, vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>, domains: List<&2, F.DomainChoice>, +point: G.Vec3, +origin: G.Vec3, axis: G.Vec3, +radius: R.Real, +tolerance: I.Tolerance, +source: R.Real) -> Classification:
  match valid:
    case False{}:
      Unresolved{InvalidInput{}}
    case True{}:
      scale = F.edges_scale(edges, I.input_scale(point, origin, R.max(R.from_f32(1.0), radius)))
      +resolution = R.mul(I.angular_guard(), scale)
      +linear = I.tolerance_linear(tolerance)
      enough = Bool.and(R.less(resolution, linear), R.less(R.add(R.add(source, linear), resolution), radius))
      resolution_valid(enough, loops, vertices, edges, domains, point, origin, axis, radius, tolerance, source, resolution)

def face_surface(face: A.Face, vertices: List<&2, G.Vec3>, edges: List<&2, A.Edge>, domains: List<&2, F.DomainChoice>, +point: G.Vec3, +tolerance: I.Tolerance, +source: R.Real) -> Classification:
  A.Face{surface, _, loops} = face
  match surface:
    case A.Cylinder{+origin, +axis, _, +radius}:
      geometry = Bool.and(Bool.and(I.vec_valid(point), I.vec_valid(origin)), Bool.and(I.vec_valid(axis), I.direction_valid(axis)))
      size = Bool.and(I.scalar_valid(radius), R.less(zero(), radius))
      budgets = Bool.and(F.valid_budget(source), Bool.and(I.tolerance_valid(tolerance), I.at_most(I.angular_guard(), I.tolerance_angular(tolerance))))
      cylinder_valid(Bool.and(geometry, Bool.and(size, budgets)), loops, vertices, edges, domains, point, origin, axis, radius, tolerance, source)
    case _:
      Unresolved{NonCylindricalFace{}}

def face_lookup(found: Maybe<&2, A.Face>, vertices: List<&2, G.Vec3>, edges: List<&2, A.Edge>, domains: List<&2, F.DomainChoice>, point: G.Vec3, tolerance: I.Tolerance, source: R.Real) -> Classification:
  match found:
    case None{}:
      Unresolved{InvalidIndex{}}
    case Some{face}:
      face_surface(face, vertices, edges, domains, point, tolerance, source)

def classify(solid: A.Solid, face_index: U32, domains: List<&2, F.DomainChoice>, point: G.Vec3, tolerance: I.Tolerance, source_budget: R.Real) -> Classification:
  A.Solid{vertices, edges, faces} = solid
  face_lookup(List.get(&2, A.Face, faces, U32.to_nat(face_index)), vertices, edges, domains, point, tolerance, source_budget)
