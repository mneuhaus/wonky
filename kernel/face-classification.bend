import Base
import ./real.bend as R
import ./precise.bend as G
import ./analytic.bend as A
import ./topology.bend as T
import ./intersections.bend as I
import ./curve-plane.bend as C

# Membership in a planar face with its actual analytic edge curves. No curve
# is polygonized. Face projection, tolerances, trims, and all ray decisions run
# in Bend. Ambiguous crossings never contribute forced parity.
type DomainChoice is Data:
  AutoDomain{}
  GivenDomain{domain: C.Domain}

type Reason is Data:
  InvalidInput{}
  InvalidIndex{}
  NonPlanarFace{}
  InvalidTopology{}
  MissingTrim{}
  InvalidTrim{}
  InputGap{}
  ResolutionLimit{}
  NearFacePlane{}
  NearBoundary{}
  AmbiguousRays{}
  ConflictingRays{}

type Classification is Data:
  Inside{rays: U32}
  Outside{rays: U32}
  Boundary{edge: U32, parameter: R.Real}
  Unresolved{reason: Reason}

type PreparedEdge is Data:
  PreparedEdge{index: U32, edge: A.Edge, domain: C.Domain, start: G.Vec3, end: G.Vec3, forward: Bool}

type PreparedLoop is Data:
  PreparedLoop{outer: Bool, edges: List<&2, PreparedEdge>}

type EdgePreparation is Data:
  PreparedEdges{edges: List<&2, PreparedEdge>}
  BadEdges{reason: Reason}

type LoopPreparation is Data:
  PreparedLoops{loops: List<&2, PreparedLoop>}
  BadLoops{reason: Reason}

type BoundaryState is Data:
  ClearBoundary{}
  OnBoundary{edge: U32, parameter: R.Real}
  UncertainBoundary{}

type RayCount is Data:
  RayCount{valid: Bool, count: U32}

type RayRegion is Data:
  RayRegion{valid: Bool, outer: Bool, hole: Bool}

def zero() -> R.Real:
  R.from_f32(0.0)

def distance(a: G.Vec3, b: G.Vec3) -> R.Real:
  I.length(G.sub(a, b))

def project(+point: G.Vec3, origin: G.Vec3, +normal: G.Vec3) -> G.Vec3:
  G.sub(point, G.scale(normal, G.dot(G.sub(point, origin), normal)))

def clamp(+value: R.Real, first: R.Real, last: R.Real) -> R.Real:
  R.max(first, R.min(last, value))

def valid_budget(+budget: R.Real) -> Bool:
  Bool.and(I.scalar_valid(budget), Bool.and(I.at_most(zero(), budget), I.at_most(budget, R.from_f32(0.1))))

def budget_join(+value: R.Real, +budget: R.Real) -> R.Real:
  Bool.pick(R.Real, Bool.and(valid_budget(value), valid_budget(budget)), R.max(value, budget), R.from_f32(F32.neg(1.0)))

def max_budget(values: List<&2, R.Real>, +budget: R.Real) -> R.Real:
  match values:
    case Nil{}:
      budget
    case value <> tail:
      budget_join(value, max_budget(tail, budget))

def linear_edge_points(a: Maybe<&2, G.Vec3>, b: Maybe<&2, G.Vec3>, first: U32, last: U32) -> Maybe<&2, A.Edge>:
  match a b:
    case Some{+start} Some{end}:
      Some{A.Edge{first, last, A.Line{start, G.sub(end, start)}, True{}}}
    case _ _:
      None{}

# The repository's F32 polyhedral bodies store endpoint indices without an
# explicit curve. Reconstruct that exact represented segment here in Bend.
def linear_edge(+vertices: List<&2, G.Vec3>, +first: U32, +last: U32) -> Maybe<&2, A.Edge>:
  linear_edge_points(List.get(&2, G.Vec3, vertices, U32.to_nat(first)), List.get(&2, G.Vec3, vertices, U32.to_nat(last)), first, last)

def choose_domain(choice: Maybe<&2, DomainChoice>) -> DomainChoice:
  match choice:
    case None{}:
      AutoDomain{}
    case Some{value}:
      value

def line_parameter(origin: G.Vec3, +direction: G.Vec3, point: G.Vec3) -> R.Real:
  R.div(G.dot(G.sub(point, origin), direction), G.dot(direction, direction))

def auto_round(closed: Bool) -> Maybe<&2, C.Domain>:
  match closed:
    case True{}:
      Some{C.Untrimmed{}}
    case False{}:
      None{}

def auto_domain(edge: A.Edge, start: G.Vec3, end: G.Vec3) -> Maybe<&2, C.Domain>:
  A.Edge{first, last, curve, _} = edge
  match curve:
    case A.Line{+origin, +direction}:
      +a = line_parameter(origin, direction, start)
      +b = line_parameter(origin, direction, end)
      Some{C.Interval{R.min(a, b), R.max(a, b)}}
    case _:
      auto_round(U32.is_eq(first, last))

def resolve_domain(choice: DomainChoice, edge: A.Edge, start: G.Vec3, end: G.Vec3) -> Maybe<&2, C.Domain>:
  match choice:
    case AutoDomain{}:
      auto_domain(edge, start, end)
    case GivenDomain{domain}:
      Some{domain}

def finite_domain(domain: C.Domain, periodic: Bool) -> Bool:
  match domain:
    case C.Untrimmed{}:
      periodic
    case C.Interval{_, _}:
      True{}

def endpoint_error(domain: C.Domain, +curve: A.Curve, +start: G.Vec3, end: G.Vec3, +sense: Bool) -> R.Real:
  match domain:
    case C.Untrimmed{}:
      distance(start, A.curve_point(curve, A.curve_parameter(curve, start)))
    case C.Interval{+first, +last}:
      a = A.curve_point(curve, Bool.pick(R.Real, sense, first, last))
      b = A.curve_point(curve, Bool.pick(R.Real, sense, last, first))
      R.max(distance(start, a), distance(end, b))

def coefficient_a(coefficients: C.Coefficients) -> R.Real:
  C.Coefficients{a, _, _} = coefficients
  a

def coefficient_b(coefficients: C.Coefficients) -> R.Real:
  C.Coefficients{_, b, _} = coefficients
  b

def coefficient_c(coefficients: C.Coefficients) -> R.Real:
  C.Coefficients{_, _, c} = coefficients
  c

def plane_error_line(domain: C.Domain, +b: R.Real, +c: R.Real) -> R.Real:
  match domain:
    case C.Untrimmed{}:
      I.limit()
    case C.Interval{first, last}:
      R.max(R.abs(R.add(R.mul(b, first), c)), R.abs(R.add(R.mul(b, last), c)))

def plane_error(periodic: Bool, domain: C.Domain, +coefficients: C.Coefficients) -> R.Real:
  match periodic:
    case False{}:
      plane_error_line(domain, coefficient_b(coefficients), coefficient_c(coefficients))
    case True{}:
      +a = coefficient_a(coefficients)
      +b = coefficient_b(coefficients)
      R.add(R.abs(coefficient_c(coefficients)), R.sqrt(R.add(R.mul(a, a), R.mul(b, b))))

def edge_incidence(valid: Bool, index: U32, edge: A.Edge, domain: C.Domain, start: G.Vec3, end: G.Vec3, forward: Bool) -> EdgePreparation:
  match valid:
    case True{}:
      PreparedEdges{[PreparedEdge{index, edge, domain, start, end, forward}]}
    case False{}:
      BadEdges{InputGap{}}

def edge_domain_valid(valid: Bool, index: U32, +edge: A.Edge, +domain: C.Domain, +start: G.Vec3, +end: G.Vec3, forward: Bool, origin: G.Vec3, normal: G.Vec3, +budget: R.Real) -> EdgePreparation:
  match valid:
    case False{}:
      BadEdges{InvalidTrim{}}
    case True{}:
      A.Edge{_, _, +curve, sense} = edge
      endpoints = endpoint_error(domain, curve, start, end, sense)
      planar = plane_error(C.curve_periodic(curve), domain, C.coefficients(curve, origin, normal))
      edge_incidence(Bool.and(I.at_most(endpoints, budget), I.at_most(planar, budget)), index, edge, domain, start, end, forward)

def edge_domain(domain: Maybe<&2, C.Domain>, index: U32, +edge: A.Edge, start: G.Vec3, end: G.Vec3, forward: Bool, origin: G.Vec3, normal: G.Vec3, budget: R.Real) -> EdgePreparation:
  match domain:
    case None{}:
      BadEdges{MissingTrim{}}
    case Some{+value}:
      A.Edge{_, _, curve, _} = edge
      +periodic = C.curve_periodic(curve)
      valid = Bool.and(C.domain_valid(value, periodic), finite_domain(value, periodic))
      edge_domain_valid(valid, index, edge, value, start, end, forward, origin, normal, budget)

def edge_points_valid(valid: Bool, index: U32, +edge: A.Edge, choice: DomainChoice, +start: G.Vec3, +end: G.Vec3, forward: Bool, origin: G.Vec3, normal: G.Vec3, budget: R.Real) -> EdgePreparation:
  match valid:
    case False{}:
      BadEdges{InvalidInput{}}
    case True{}:
      edge_domain(resolve_domain(choice, edge, start, end), index, edge, start, end, forward, origin, normal, budget)

def edge_points(a: Maybe<&2, G.Vec3>, b: Maybe<&2, G.Vec3>, index: U32, edge: A.Edge, choice: DomainChoice, forward: Bool, origin: G.Vec3, normal: G.Vec3, budget: R.Real) -> EdgePreparation:
  match a b:
    case Some{+start} Some{+end}:
      edge_points_valid(Bool.and(I.vec_valid(start), I.vec_valid(end)), index, edge, choice, start, end, forward, origin, normal, budget)
    case _ _:
      BadEdges{InvalidIndex{}}

def edge_curve_valid(valid: Bool, index: U32, +edge: A.Edge, choice: DomainChoice, +vertices: List<&2, G.Vec3>, forward: Bool, origin: G.Vec3, normal: G.Vec3, budget: R.Real) -> EdgePreparation:
  match valid:
    case False{}:
      BadEdges{InvalidInput{}}
    case True{}:
      A.Edge{start, end, _, _} = edge
      edge_points(List.get(&2, G.Vec3, vertices, U32.to_nat(start)), List.get(&2, G.Vec3, vertices, U32.to_nat(end)), index, edge, choice, forward, origin, normal, budget)

def edge_lookup(found: Maybe<&2, A.Edge>, index: U32, choice: DomainChoice, vertices: List<&2, G.Vec3>, forward: Bool, origin: G.Vec3, normal: G.Vec3, budget: R.Real) -> EdgePreparation:
  match found:
    case None{}:
      BadEdges{InvalidIndex{}}
    case Some{+edge}:
      A.Edge{_, _, curve, _} = edge
      edge_curve_valid(C.curve_valid(curve), index, edge, choice, vertices, forward, origin, normal, budget)

def join_edges(a: EdgePreparation, b: EdgePreparation) -> EdgePreparation:
  match a b:
    case PreparedEdges{first} PreparedEdges{last}:
      PreparedEdges{List.append(&2, PreparedEdge, first, last)}
    case BadEdges{reason} _:
      BadEdges{reason}
    case _ BadEdges{reason}:
      BadEdges{reason}

def prepare_uses(uses: List<&2, T.Coedge>, +vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>, +domains: List<&2, DomainChoice>, +origin: G.Vec3, +normal: G.Vec3, +budget: R.Real) -> EdgePreparation:
  match uses:
    case Nil{}:
      PreparedEdges{Nil{}}
    case T.Use{+index, forward} <> tail:
      choice = choose_domain(List.get(&2, DomainChoice, domains, U32.to_nat(index)))
      one = edge_lookup(List.get(&2, A.Edge, edges, U32.to_nat(index)), index, choice, vertices, forward, origin, normal, budget)
      join_edges(one, prepare_uses(tail, vertices, edges, domains, origin, normal, budget))

def use_start(edge: PreparedEdge) -> U32:
  PreparedEdge{_, A.Edge{start, end, _, _}, _, _, _, forward} = edge
  Bool.pick(U32, forward, start, end)

def use_end(edge: PreparedEdge) -> U32:
  PreparedEdge{_, A.Edge{start, end, _, _}, _, _, _, forward} = edge
  Bool.pick(U32, forward, end, start)

def closed_edges(edges: List<&2, PreparedEdge>, +first: U32, expected: U32) -> Bool:
  match edges:
    case Nil{}:
      U32.is_eq(expected, first)
    case +head <> tail:
      Bool.and(U32.is_eq(use_start(head), expected), closed_edges(tail, first, use_end(head)))

def loop_valid(edges: List<&2, PreparedEdge>) -> Bool:
  match edges:
    case Nil{}:
      False{}
    case +head <> tail:
      closed_edges(tail, use_start(head), use_end(head))

def loop_checked(valid: Bool, outer: Bool, edges: List<&2, PreparedEdge>) -> LoopPreparation:
  match valid:
    case True{}:
      PreparedLoops{[PreparedLoop{outer, edges}]}
    case False{}:
      BadLoops{InvalidTopology{}}

def prepared_loop(result: EdgePreparation, outer: Bool) -> LoopPreparation:
  match result:
    case BadEdges{reason}:
      BadLoops{reason}
    case PreparedEdges{+edges}:
      loop_checked(loop_valid(edges), outer, edges)

def join_loops(a: LoopPreparation, b: LoopPreparation) -> LoopPreparation:
  match a b:
    case PreparedLoops{first} PreparedLoops{last}:
      PreparedLoops{List.append(&2, PreparedLoop, first, last)}
    case BadLoops{reason} _:
      BadLoops{reason}
    case _ BadLoops{reason}:
      BadLoops{reason}

def prepare_loops(loops: List<&2, A.Loop>, +vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>, +domains: List<&2, DomainChoice>, +origin: G.Vec3, +normal: G.Vec3, +budget: R.Real) -> LoopPreparation:
  match loops:
    case Nil{}:
      PreparedLoops{Nil{}}
    case A.Loop{outer, uses} <> tail:
      one = prepared_loop(prepare_uses(uses, vertices, edges, domains, origin, normal, budget), outer)
      join_loops(one, prepare_loops(tail, vertices, edges, domains, origin, normal, budget))

def outer_count(loops: List<&2, PreparedLoop>) -> U32:
  match loops:
    case Nil{}:
      0
    case PreparedLoop{outer, _} <> tail:
      (Bool.pick(U32, outer, 1, 0) + outer_count(tail) : U32)

type Candidate is Data:
  Candidate{parameter: R.Real, metric: R.Real}

def normalized_candidate(+parameter: R.Real, u: R.Real, v: R.Real) -> Candidate:
  +x = R.sub(u, R.cos(parameter))
  +y = R.sub(v, R.sin(parameter))
  Candidate{parameter, R.add(R.mul(x, x), R.mul(y, y))}

def closest(a: Candidate, b: Candidate) -> Candidate:
  Candidate{at, +am} = a
  Candidate{bt, +bm} = b
  Bool.pick(Candidate, R.less(am, bm), Candidate{at, am}, Candidate{bt, bm})

def lift_steps(left: Nat, +parameter: R.Real, +first: R.Real, last: R.Real, +tau: R.Real) -> R.Real:
  match left:
    case 0n:
      clamp(parameter, first, last)
    case 1n+rest:
      shift = Bool.pick(R.Real, R.less(parameter, first), tau,
        Bool.pick(R.Real, I.at_most(R.add(first, tau), parameter), R.neg(tau), zero()))
      lift_steps(rest, R.add(parameter, shift), first, last, tau)

def lifted_parameter(theta: R.Real, first: R.Real, last: R.Real) -> R.Real:
  # Domain bounds are at most +/-8*pi. Real comparisons avoid Float32 turn
  # rounding that can otherwise discard a radial candidate near the seam.
  lift_steps(10n, theta, first, last, R.mul(R.pi(), R.from_f32(2.0)))

def round_candidate(domain: C.Domain, +u: R.Real, +v: R.Real) -> Candidate:
  match domain:
    case C.Untrimmed{}:
      normalized_candidate(R.atan2(v, u), u, v)
    case C.Interval{+first, +last}:
      middle = normalized_candidate(lifted_parameter(R.atan2(v, u), first, last), u, v)
      closest(middle, closest(normalized_candidate(first, u, v), normalized_candidate(last, u, v)))

def boundary_bounds(boundary: Bool, clear: Bool, edge: U32, parameter: R.Real) -> BoundaryState:
  match boundary clear:
    case True{} _:
      OnBoundary{edge, parameter}
    case False{} True{}:
      ClearBoundary{}
    case False{} False{}:
      UncertainBoundary{}

def boundary_distance(edge: U32, parameter: R.Real, upper: R.Real, lower: R.Real, +linear: R.Real, source_budget: R.Real, +resolution: R.Real) -> BoundaryState:
  boundary = I.at_most(upper, R.sub(linear, resolution))
  clear = R.less(R.add(linear, resolution), R.max(zero(), R.sub(lower, source_budget)))
  boundary_bounds(boundary, clear, edge, parameter)

def line_boundary_domain(domain: C.Domain, index: U32, +curve: A.Curve, +origin: G.Vec3, +direction: G.Vec3, +point: G.Vec3, face_origin: G.Vec3, normal: G.Vec3, linear: R.Real, source_budget: R.Real, resolution: R.Real) -> BoundaryState:
  match domain:
    case C.Untrimmed{}:
      UncertainBoundary{}
    case C.Interval{first, last}:
      +parameter = clamp(line_parameter(origin, direction, point), first, last)
      +candidate = A.curve_point(curve, parameter)
      lower = distance(point, candidate)
      upper = distance(point, project(candidate, face_origin, normal))
      boundary_distance(index, parameter, upper, lower, linear, source_budget, resolution)

def round_boundary_candidate(candidate: Candidate, index: U32, curve: A.Curve, point: G.Vec3, face_origin: G.Vec3, normal: G.Vec3, min_radius: R.Real, linear: R.Real, source_budget: R.Real, resolution: R.Real) -> BoundaryState:
  Candidate{+parameter, metric} = candidate
  lower = R.mul(min_radius, R.sqrt(metric))
  upper = distance(point, project(A.curve_point(curve, parameter), face_origin, normal))
  boundary_distance(index, parameter, upper, lower, linear, source_budget, resolution)

# Nearest angle on the corresponding unit-circle arc gives a valid lower
# distance bound under the ellipse's minimum singular radius. Its actual curve
# point gives an upper bound. The gap is kept unresolved, not approximated by
# chords or an unproved ellipse closest-point iteration.
def round_boundary(index: U32, curve: A.Curve, domain: C.Domain, origin: G.Vec3, curve_normal: G.Vec3, +x: G.Vec3, major: R.Real, minor: R.Real, +point: G.Vec3, face_origin: G.Vec3, normal: G.Vec3, linear: R.Real, source_budget: R.Real, resolution: R.Real) -> BoundaryState:
  +y = G.cross(curve_normal, x)
  +a = R.mul(major, I.length(x))
  +b = R.mul(minor, I.length(y))
  +delta = G.sub(point, origin)
  u = R.div(G.dot(delta, G.normalize(x)), a)
  v = R.div(G.dot(delta, G.normalize(y)), b)
  round_boundary_candidate(round_candidate(domain, u, v), index, curve, point, face_origin, normal, R.min(a, b), linear, source_budget, resolution)

def edge_boundary(prepared: PreparedEdge, point: G.Vec3, face_origin: G.Vec3, normal: G.Vec3, linear: R.Real, source_budget: R.Real, resolution: R.Real) -> BoundaryState:
  PreparedEdge{index, A.Edge{_, _, +curve, _}, domain, _, _, _} = prepared
  match curve:
    case A.Line{origin, direction}:
      line_boundary_domain(domain, index, curve, origin, direction, point, face_origin, normal, linear, source_budget, resolution)
    case A.Circle{origin, curve_normal, x, +radius}:
      round_boundary(index, curve, domain, origin, curve_normal, x, radius, radius, point, face_origin, normal, linear, source_budget, resolution)
    case A.Ellipse{origin, curve_normal, x, major, minor}:
      round_boundary(index, curve, domain, origin, curve_normal, x, major, minor, point, face_origin, normal, linear, source_budget, resolution)

def boundary_join(a: BoundaryState, b: BoundaryState) -> BoundaryState:
  match a b:
    case OnBoundary{edge, parameter} _:
      OnBoundary{edge, parameter}
    case _ OnBoundary{edge, parameter}:
      OnBoundary{edge, parameter}
    case UncertainBoundary{} _:
      UncertainBoundary{}
    case _ UncertainBoundary{}:
      UncertainBoundary{}
    case ClearBoundary{} ClearBoundary{}:
      ClearBoundary{}

def boundaries_edges(edges: List<&2, PreparedEdge>, +point: G.Vec3, +origin: G.Vec3, +normal: G.Vec3, +linear: R.Real, +source_budget: R.Real, +resolution: R.Real) -> BoundaryState:
  match edges:
    case Nil{}:
      ClearBoundary{}
    case edge <> tail:
      boundary_join(edge_boundary(edge, point, origin, normal, linear, source_budget, resolution), boundaries_edges(tail, point, origin, normal, linear, source_budget, resolution))

def boundaries_loops(loops: List<&2, PreparedLoop>, +point: G.Vec3, +origin: G.Vec3, +normal: G.Vec3, +linear: R.Real, +source_budget: R.Real, +resolution: R.Real) -> BoundaryState:
  match loops:
    case Nil{}:
      ClearBoundary{}
    case PreparedLoop{_, edges} <> tail:
      boundary_join(boundaries_edges(edges, point, origin, normal, linear, source_budget, resolution), boundaries_loops(tail, point, origin, normal, linear, source_budget, resolution))

def vertex_clear(vertex: G.Vec3, point: G.Vec3, cut_normal: G.Vec3, margin: R.Real) -> Bool:
  R.less(margin, R.abs(G.dot(G.sub(vertex, point), cut_normal)))

def ray_avoids_vertices(domain: C.Domain, start: G.Vec3, end: G.Vec3, +point: G.Vec3, +cut_normal: G.Vec3, +margin: R.Real) -> Bool:
  match domain:
    case C.Untrimmed{}:
      True{}
    case C.Interval{_, _}:
      Bool.and(vertex_clear(start, point, cut_normal, margin), vertex_clear(end, point, cut_normal, margin))

def interior_position(position: C.Position) -> Bool:
  match position:
    case C.Interior{}:
      True{}
    case _:
      False{}

def join_counts(a: RayCount, b: RayCount) -> RayCount:
  RayCount{valid_a, count_a} = a
  RayCount{valid_b, count_b} = b
  RayCount{Bool.and(valid_a, valid_b), (count_a + count_b : U32)}

def count_hits(hits: List<&2, C.Hit>, +point: G.Vec3, +direction: G.Vec3, +margin: R.Real) -> RayCount:
  match hits:
    case Nil{}:
      RayCount{True{}, 0}
    case C.Hit{_, hit_point, multiplicity, position} <> tail:
      +along = G.dot(G.sub(hit_point, point), direction)
      valid = Bool.and(Bool.and(interior_position(position), U32.is_eq(multiplicity, 1)), R.less(margin, R.abs(along)))
      one = {RayCount{valid, Bool.pick(U32, R.less(margin, along), 1, 0)} : RayCount}
      join_counts(one, count_hits(tail, point, direction, margin))

def count_relation(relation: C.Relation, hits: List<&2, C.Hit>, point: G.Vec3, direction: G.Vec3, margin: R.Real) -> RayCount:
  match relation:
    case C.Disjoint{}:
      RayCount{True{}, 0}
    case C.Crossing{}:
      count_hits(hits, point, direction, margin)
    case _:
      RayCount{False{}, 0}

def count_result(result: C.CurvePlaneResult, point: G.Vec3, direction: G.Vec3, margin: R.Real) -> RayCount:
  match result:
    case C.Resolved{relation, hits, _, _}:
      count_relation(relation, hits, point, direction, margin)
    case _:
      RayCount{False{}, 0}

# prepare_loops has already validated each immutable curve and finite domain.
# ray_directions checks the common query geometry once per ray. Keep the
# point-dependent input budget, radius gate and complete intersection/trim
# construction unchanged; only the repeated immutable input checks are hoisted.
def ray_edge_checked(valid: Bool, +curve: A.Curve, domain: C.Domain, +point: G.Vec3, cut_normal: G.Vec3, direction: G.Vec3, +tolerance: I.Tolerance, margin: R.Real) -> RayCount:
  match valid:
    case False{}:
      RayCount{False{}, 0}
    case True{}:
      +linear = I.tolerance_linear(tolerance)
      linear_ok = I.at_most(I.guard(I.input_scale(C.curve_origin(curve), point, C.max_radius(curve))), linear)
      result = C.input_budget(linear_ok, C.radius_resolved(curve, linear), curve, point, cut_normal, domain, tolerance)
      count_result(result, point, direction, margin)

def ray_edge(prepared: PreparedEdge, +point: G.Vec3, +cut_normal: G.Vec3, direction: G.Vec3, tolerance: I.Tolerance, +margin: R.Real) -> RayCount:
  PreparedEdge{_, A.Edge{_, _, curve, _}, +domain, start, end, _} = prepared
  clear = ray_avoids_vertices(domain, start, end, point, cut_normal, margin)
  ray_edge_checked(clear, curve, domain, point, cut_normal, direction, tolerance, margin)

def ray_edges(edges: List<&2, PreparedEdge>, +point: G.Vec3, +cut_normal: G.Vec3, +direction: G.Vec3, +tolerance: I.Tolerance, +margin: R.Real) -> RayCount:
  match edges:
    case Nil{}:
      RayCount{True{}, 0}
    case head <> tail:
      join_counts(ray_edge(head, point, cut_normal, direction, tolerance, margin), ray_edges(tail, point, cut_normal, direction, tolerance, margin))

def add_region(+outer_loop: Bool, count: RayCount, rest: RayRegion) -> RayRegion:
  RayCount{valid_a, count_a} = count
  RayRegion{valid_b, outer, hole} = rest
  +inside = U32.is_eq(U32.and(count_a, 1), 1)
  RayRegion{Bool.and(valid_a, valid_b), Bool.or(outer, Bool.and(outer_loop, inside)), Bool.or(hole, Bool.and(Bool.not(outer_loop), inside))}

def ray_loops(loops: List<&2, PreparedLoop>, +point: G.Vec3, +cut_normal: G.Vec3, +direction: G.Vec3, +tolerance: I.Tolerance, +margin: R.Real) -> RayRegion:
  match loops:
    case Nil{}:
      RayRegion{True{}, False{}, False{}}
    case PreparedLoop{outer, edges} <> tail:
      add_region(outer, ray_edges(edges, point, cut_normal, direction, tolerance, margin), ray_loops(tail, point, cut_normal, direction, tolerance, margin))

type Agreement is Data:
  Agreement{count: U32, inside: Bool, conflict: Bool}

def add_agreement(result: RayRegion, agreement: Agreement) -> Agreement:
  RayRegion{+valid, outer, hole} = result
  Agreement{+count, +inside, conflict} = agreement
  +next_inside = Bool.and(outer, Bool.not(hole))
  different = Bool.or(Bool.and(inside, Bool.not(next_inside)), Bool.and(Bool.not(inside), next_inside))
  disagree = Bool.and(valid, Bool.and(Bool.not(U32.is_eq(count, 0)), different))
  Agreement{(count + Bool.pick(U32, valid, 1, 0) : U32), Bool.pick(Bool, valid, next_inside, inside), Bool.or(conflict, disagree)}

def ray_query_valid(valid: Bool, loops: List<&2, PreparedLoop>, point: G.Vec3, cut: G.Vec3, unit: G.Vec3, tolerance: I.Tolerance, margin: R.Real) -> RayRegion:
  match valid:
    case False{}:
      RayRegion{False{}, False{}, False{}}
    case True{}:
      ray_loops(loops, point, cut, unit, tolerance, margin)

def ray_directions(directions: List<&2, G.Vec3>, +loops: List<&2, PreparedLoop>, +point: G.Vec3, +normal: G.Vec3, +tolerance: I.Tolerance, +margin: R.Real, agreement: Agreement) -> Agreement:
  match directions:
    case Nil{}:
      agreement
    case direction <> tail:
      +unit = G.normalize(direction)
      +cut = G.normalize(G.cross(normal, unit))
      geometry_ok = Bool.and(I.vec_valid(point), Bool.and(I.vec_valid(cut), I.direction_valid(cut)))
      tolerance_ok = Bool.and(I.tolerance_valid(tolerance), I.at_most(I.angular_guard(), I.tolerance_angular(tolerance)))
      result = ray_query_valid(Bool.and(geometry_ok, tolerance_ok), loops, point, cut, unit, tolerance, margin)
      ray_directions(tail, loops, point, normal, tolerance, margin, add_agreement(result, agreement))

def agreement_result(agreement: Agreement) -> Classification:
  Agreement{+count, inside, conflict} = agreement
  Bool.pick(Classification, conflict, Unresolved{ConflictingRays{}},
    Bool.pick(Classification, U32.is_lt(count, 2), Unresolved{AmbiguousRays{}}, Bool.pick(Classification, inside, Inside{count}, Outside{count})))

def classify_rays(loops: List<&2, PreparedLoop>, point: G.Vec3, +normal: G.Vec3, tolerance: I.Tolerance, margin: R.Real) -> Classification:
  +u = A.axis_x(normal)
  +v = G.cross(normal, u)
  directions = {[u, G.add(u, G.scale(v, R.from_f32(0.375))), G.add(u, G.scale(v, R.from_f32(0.8125))), G.add(u, G.scale(v, R.from_f32(1.3125))), v] : List<&2, G.Vec3>}
  agreement_result(ray_directions(directions, loops, point, normal, tolerance, margin, Agreement{0, False{}, False{}}))

def after_boundary(boundary: BoundaryState, loops: List<&2, PreparedLoop>, point: G.Vec3, normal: G.Vec3, tolerance: I.Tolerance, margin: R.Real) -> Classification:
  match boundary:
    case OnBoundary{edge, parameter}:
      Boundary{edge, parameter}
    case UncertainBoundary{}:
      Unresolved{NearBoundary{}}
    case ClearBoundary{}:
      classify_rays(loops, point, normal, tolerance, margin)

def point_in_plane(near: Bool, outside: Bool, +loops: List<&2, PreparedLoop>, +point: G.Vec3, +origin: G.Vec3, +normal: G.Vec3, +tolerance: I.Tolerance, +source_budget: R.Real, +resolution: R.Real) -> Classification:
  match near outside:
    case True{} _:
      Unresolved{NearFacePlane{}}
    case False{} True{}:
      Outside{0}
    case False{} False{}:
      +projected = project(point, origin, normal)
      +linear = I.tolerance_linear(tolerance)
      boundary = boundaries_loops(loops, projected, origin, normal, linear, source_budget, resolution)
      after_boundary(boundary, loops, projected, normal, tolerance, R.add(R.add(linear, source_budget), resolution))

def prepared_face_valid(valid: Bool, loops: List<&2, PreparedLoop>, +point: G.Vec3, +origin: G.Vec3, +normal: G.Vec3, +tolerance: I.Tolerance, source_budget: R.Real, +resolution: R.Real) -> Classification:
  match valid:
    case False{}:
      Unresolved{InvalidTopology{}}
    case True{}:
      +offset = R.abs(G.dot(G.sub(point, origin), normal))
      +linear = I.tolerance_linear(tolerance)
      near = I.at_most(R.abs(R.sub(offset, linear)), resolution)
      point_in_plane(near, R.less(R.add(linear, resolution), offset), loops, point, origin, normal, tolerance, source_budget, resolution)

def prepared_face(result: LoopPreparation, point: G.Vec3, origin: G.Vec3, normal: G.Vec3, tolerance: I.Tolerance, source_budget: R.Real, resolution: R.Real) -> Classification:
  match result:
    case BadLoops{reason}:
      Unresolved{reason}
    case PreparedLoops{+loops}:
      prepared_face_valid(U32.is_eq(outer_count(loops), 1), loops, point, origin, normal, tolerance, source_budget, resolution)

def curve_scale(curve: A.Curve) -> R.Real:
  match curve:
    case A.Line{origin, _}:
      I.magnitude(origin)
    case A.Circle{origin, _, _, radius}:
      R.max(I.magnitude(origin), radius)
    case A.Ellipse{origin, _, _, major, minor}:
      R.max(I.magnitude(origin), R.max(major, minor))

def edges_scale(edges: List<&2, A.Edge>, +scale: R.Real) -> R.Real:
  match edges:
    case Nil{}:
      scale
    case A.Edge{_, _, curve, _} <> tail:
      edges_scale(tail, R.max(scale, curve_scale(curve)))

def resolution_valid(valid: Bool, loops: List<&2, A.Loop>, vertices: List<&2, G.Vec3>, edges: List<&2, A.Edge>, domains: List<&2, DomainChoice>, point: G.Vec3, +origin: G.Vec3, +normal: G.Vec3, tolerance: I.Tolerance, +source_budget: R.Real, +resolution: R.Real) -> Classification:
  match valid:
    case False{}:
      Unresolved{ResolutionLimit{}}
    case True{}:
      +unit = G.normalize(normal)
      prepared = prepare_loops(loops, vertices, edges, domains, origin, unit, R.add(source_budget, resolution))
      prepared_face(prepared, point, origin, unit, tolerance, source_budget, resolution)

def plane_valid(valid: Bool, loops: List<&2, A.Loop>, vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>, domains: List<&2, DomainChoice>, +point: G.Vec3, +origin: G.Vec3, normal: G.Vec3, +tolerance: I.Tolerance, source_budget: R.Real) -> Classification:
  match valid:
    case False{}:
      Unresolved{InvalidInput{}}
    case True{}:
      scale = edges_scale(edges, I.input_scale(point, origin, R.from_f32(1.0)))
      +resolution = R.mul(I.angular_guard(), scale)
      resolution_valid(R.less(resolution, I.tolerance_linear(tolerance)), loops, vertices, edges, domains, point, origin, normal, tolerance, source_budget, resolution)

def face_surface(face: A.Face, vertices: List<&2, G.Vec3>, edges: List<&2, A.Edge>, domains: List<&2, DomainChoice>, +point: G.Vec3, +tolerance: I.Tolerance, +source_budget: R.Real) -> Classification:
  A.Face{surface, _, loops} = face
  match surface:
    case A.Plane{+origin, +normal, _}:
      geometry_ok = Bool.and(Bool.and(I.vec_valid(point), I.vec_valid(origin)), Bool.and(I.vec_valid(normal), I.direction_valid(normal)))
      tolerance_ok = Bool.and(I.tolerance_valid(tolerance), I.at_most(I.angular_guard(), I.tolerance_angular(tolerance)))
      source_ok = Bool.and(I.scalar_valid(source_budget), Bool.and(I.at_most(zero(), source_budget), I.at_most(source_budget, R.from_f32(0.1))))
      plane_valid(Bool.and(geometry_ok, Bool.and(tolerance_ok, source_ok)), loops, vertices, edges, domains, point, origin, normal, tolerance, source_budget)
    case _:
      Unresolved{NonPlanarFace{}}

def face_lookup(found: Maybe<&2, A.Face>, vertices: List<&2, G.Vec3>, edges: List<&2, A.Edge>, domains: List<&2, DomainChoice>, point: G.Vec3, tolerance: I.Tolerance, source_budget: R.Real) -> Classification:
  match found:
    case None{}:
      Unresolved{InvalidIndex{}}
    case Some{face}:
      face_surface(face, vertices, edges, domains, point, tolerance, source_budget)

def classify(solid: A.Solid, face_index: U32, domains: List<&2, DomainChoice>, point: G.Vec3, tolerance: I.Tolerance, source_budget: R.Real) -> Classification:
  A.Solid{vertices, edges, faces} = solid
  face_lookup(List.get(&2, A.Face, faces, U32.to_nat(face_index)), vertices, edges, domains, point, tolerance, source_budget)
