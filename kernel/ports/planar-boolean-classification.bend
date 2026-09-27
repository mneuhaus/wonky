import Base
import ../real.bend as R
import ../precise.bend as G
import ../analytic.bend as A
import ../topology.bend as T
import ../intersections.bend as I
import ../curve-plane.bend as C
import ../ray.bend as Y
import ../face-classification.bend as F
import ../cylinder-classification.bend as CY
import ../solid-classification.bend as S
import ../lib/id-vec.bend as V

# Solid membership for the planar Boolean's cell selection, prepared once per
# operand (docs/collections.md, "Planar Boolean classification").
#
# classify(prepare(solid, domains, tolerance, budget), point) answers exactly
# S.classify(solid, domains, point, tolerance, budget). Every decision is the
# same predicate on the same values; only work that does not depend on the
# query point is moved into prepare:
#
# - nonempty/edges_closed of the solid, and the solid's edge scale (the
#   edges_scale fold, see Scale);
# - per face: the face lookup, normalize(normal), the input checks of origin
#   and normal, the whole loop preparation of F.prepare_loops except the two
#   budget comparisons (the budget depends on the point, see EdgeCheck), and
#   outer_count;
# - per face and face ray (the five in-plane directions of F.classify_rays
#   depend only on the face normal): the direction, the cut normal and its
#   checks, and per line edge the coefficient b, the exact parallel
#   certificate and the near-parallel test of curve-plane line_classify;
# - per face and solid ray (the five fixed directions of S.after_boundary):
#   the point-independent half of ray plane_intersection.
#
# A ray that is invalid for one edge is invalid, whatever the other edges say:
# F.add_agreement and S.add_vote ignore an invalid ray's flags and counts, so
# the scans below stop at the first invalid edge or face. Valid rays still see
# every edge and every face, and counts are U32 sums (order-free).

def zero() -> R.Real:
  R.from_f32(0.0)

# ---------------------------------------------------------------- edge scale

# F.edges_scale(edges, s) folds R.max(acc, curve_scale(e)) from acc = s.
# R.max(a, b) = b only if R.less(a, b), so the fold returns the first maximal
# element of (s, c1, .., cn) under R.less. On Reals without a NaN word R.less
# is a strict weak order (lexicographic on two F32 words), so that element is
# R.max(s, M) with M the first maximal of (c1, .., cn), i.e. the same fold
# started at c1. With a NaN word anywhere among the c the prepared form keeps
# the list and folds per query (Unfolded), as before.
type Scale is Data:
  Folded{top: R.Real}
  Unfolded{edges: List<&2, A.Edge>}

def ordered(value: R.Real) -> Bool:
  R.Real{+hi, +lo} = value
  Bool.and(F32.is_eq(hi, hi), F32.is_eq(lo, lo))

def scales_ordered(edges: List<&2, A.Edge>) -> Bool:
  match edges:
    case Nil{}:
      True{}
    case A.Edge{_, _, curve, _} <> tail:
      Bool.and(ordered(F.curve_scale(curve)), scales_ordered(tail))

def scale_fold(ok: Bool, first: A.Edge, tail: List<&2, A.Edge>) -> Scale:
  match ok:
    case True{}:
      A.Edge{_, _, curve, _} = first
      Folded{F.edges_scale(tail, F.curve_scale(curve))}
    case False{}:
      Unfolded{first <> tail}

def scale_pick(ok: Bool, edges: List<&2, A.Edge>) -> Scale:
  match edges:
    case Nil{}:
      Unfolded{Nil{}}
    case A.Edge{first, last, curve, sense} <> tail:
      scale_fold(ok, A.Edge{first, last, curve, sense}, tail)

def prepare_scale(+edges: List<&2, A.Edge>) -> Scale:
  scale_pick(scales_ordered(edges), edges)

# = F.edges_scale(edges, value)
def scale_of(scale: Scale, +value: R.Real) -> R.Real:
  match scale:
    case Folded{top}:
      R.max(value, top)
    case Unfolded{edges}:
      F.edges_scale(edges, value)

# ---------------------------------------------------------------- lookups

# Solid vertices, edges and domain choices by id (List.get semantics: None past
# the end), built once per operand instead of a List.get scan per edge use.
type Lookup is Type:
  Lookup{vertices: V.IdVec<G.Vec3>, edges: V.IdVec<A.Edge>, domains: V.IdVec<F.DomainChoice>}

def vec_vertices(r: V.IdVec<G.Vec3> & Bool) -> V.IdVec<G.Vec3>:
  (v, _) = r
  v

def vec_edges(r: V.IdVec<A.Edge> & Bool) -> V.IdVec<A.Edge>:
  (v, _) = r
  v

def vec_domains(r: V.IdVec<F.DomainChoice> & Bool) -> V.IdVec<F.DomainChoice>:
  (v, _) = r
  v

def lookup(vertices: List<&2, G.Vec3>, edges: List<&2, A.Edge>, domains: List<&2, F.DomainChoice>) -> Lookup:
  Lookup{vec_vertices(V.from_list(G.Vec3, vertices)), vec_edges(V.from_list(A.Edge, edges)), vec_domains(V.from_list(F.DomainChoice, domains))}

def vertex_done(r: V.IdVec<G.Vec3> & Maybe<&2, G.Vec3>, edges: V.IdVec<A.Edge>, domains: V.IdVec<F.DomainChoice>) -> Lookup & Maybe<&2, G.Vec3>:
  (vertices, found) = r
  (Lookup{vertices, edges, domains}, found)

def find_vertex(table: Lookup, id: U32) -> Lookup & Maybe<&2, G.Vec3>:
  Lookup{vertices, edges, domains} = table
  vertex_done(V.find(G.Vec3, vertices, id), edges, domains)

def edge_done(r: V.IdVec<A.Edge> & Maybe<&2, A.Edge>, vertices: V.IdVec<G.Vec3>, domains: V.IdVec<F.DomainChoice>) -> Lookup & Maybe<&2, A.Edge>:
  (edges, found) = r
  (Lookup{vertices, edges, domains}, found)

def find_edge(table: Lookup, id: U32) -> Lookup & Maybe<&2, A.Edge>:
  Lookup{vertices, edges, domains} = table
  edge_done(V.find(A.Edge, edges, id), vertices, domains)

def domain_done(r: V.IdVec<F.DomainChoice> & Maybe<&2, F.DomainChoice>, vertices: V.IdVec<G.Vec3>, edges: V.IdVec<A.Edge>) -> Lookup & Maybe<&2, F.DomainChoice>:
  (domains, found) = r
  (Lookup{vertices, edges, domains}, found)

def find_domain(table: Lookup, id: U32) -> Lookup & Maybe<&2, F.DomainChoice>:
  Lookup{vertices, edges, domains} = table
  domain_done(V.find(F.DomainChoice, domains, id), vertices, edges)

# ---------------------------------------------------------------- loop preparation

# F.prepare_uses per use, without the budget. The failures that do not depend
# on the budget are decided here in F's order (InvalidIndex, InvalidInput,
# InvalidIndex, InvalidInput, MissingTrim, InvalidTrim); the last test
# (F.edge_domain_valid: both errors at most the budget, else InputGap) keeps
# its two error values for the query, whose budget is source + resolution.
type EdgeCheck is Data:
  Fixed{reason: F.Reason}
  Gap{prepared: F.PreparedEdge, endpoints: R.Real, planar: R.Real}

def domain_checked(valid: Bool, index: U32, +edge: A.Edge, +domain: C.Domain, +start: G.Vec3, +end: G.Vec3, forward: Bool, origin: G.Vec3, normal: G.Vec3) -> EdgeCheck:
  match valid:
    case False{}:
      Fixed{F.InvalidTrim{}}
    case True{}:
      A.Edge{_, _, +curve, sense} = edge
      endpoints = F.endpoint_error(domain, curve, start, end, sense)
      planar = F.plane_error(C.curve_periodic(curve), domain, C.coefficients(curve, origin, normal))
      Gap{F.PreparedEdge{index, edge, domain, start, end, forward}, endpoints, planar}

def domain_found(domain: Maybe<&2, C.Domain>, index: U32, +edge: A.Edge, start: G.Vec3, end: G.Vec3, forward: Bool, origin: G.Vec3, normal: G.Vec3) -> EdgeCheck:
  match domain:
    case None{}:
      Fixed{F.MissingTrim{}}
    case Some{+value}:
      A.Edge{_, _, curve, _} = edge
      +periodic = C.curve_periodic(curve)
      domain_checked(Bool.and(C.domain_valid(value, periodic), F.finite_domain(value, periodic)), index, edge, value, start, end, forward, origin, normal)

def points_checked(valid: Bool, index: U32, +edge: A.Edge, choice: F.DomainChoice, +start: G.Vec3, +end: G.Vec3, forward: Bool, origin: G.Vec3, normal: G.Vec3) -> EdgeCheck:
  match valid:
    case False{}:
      Fixed{F.InvalidInput{}}
    case True{}:
      domain_found(F.resolve_domain(choice, edge, start, end), index, edge, start, end, forward, origin, normal)

def points_found(a: Maybe<&2, G.Vec3>, b: Maybe<&2, G.Vec3>, index: U32, edge: A.Edge, choice: F.DomainChoice, forward: Bool, origin: G.Vec3, normal: G.Vec3) -> EdgeCheck:
  match a b:
    case Some{+start} Some{+end}:
      points_checked(Bool.and(I.vec_valid(start), I.vec_valid(end)), index, edge, choice, start, end, forward, origin, normal)
    case _ _:
      Fixed{F.InvalidIndex{}}

def end_found(r: Lookup & Maybe<&2, G.Vec3>, start: Maybe<&2, G.Vec3>, index: U32, edge: A.Edge, choice: F.DomainChoice, forward: Bool, origin: G.Vec3, normal: G.Vec3) -> Lookup & EdgeCheck:
  (table, end) = r
  (table, points_found(start, end, index, edge, choice, forward, origin, normal))

def start_found(r: Lookup & Maybe<&2, G.Vec3>, last: U32, index: U32, edge: A.Edge, choice: F.DomainChoice, forward: Bool, origin: G.Vec3, normal: G.Vec3) -> Lookup & EdgeCheck:
  (table, start) = r
  end_found(find_vertex(table, last), start, index, edge, choice, forward, origin, normal)

def curve_checked(valid: Bool, table: Lookup, index: U32, +edge: A.Edge, choice: F.DomainChoice, forward: Bool, origin: G.Vec3, normal: G.Vec3) -> Lookup & EdgeCheck:
  match valid:
    case False{}:
      (table, Fixed{F.InvalidInput{}})
    case True{}:
      A.Edge{first, last, _, _} = edge
      start_found(find_vertex(table, first), last, index, edge, choice, forward, origin, normal)

def edge_found(r: Lookup & Maybe<&2, A.Edge>, index: U32, choice: F.DomainChoice, forward: Bool, origin: G.Vec3, normal: G.Vec3) -> Lookup & EdgeCheck:
  (table, found) = r
  match found:
    case None{}:
      (table, Fixed{F.InvalidIndex{}})
    case Some{+edge}:
      A.Edge{_, _, curve, _} = edge
      curve_checked(C.curve_valid(curve), table, index, edge, choice, forward, origin, normal)

def choice_found(r: Lookup & Maybe<&2, F.DomainChoice>, +index: U32, forward: Bool, origin: G.Vec3, normal: G.Vec3) -> Lookup & EdgeCheck:
  (table, found) = r
  edge_found(find_edge(table, index), index, F.choose_domain(found), forward, origin, normal)

def check_use(table: Lookup, +index: U32, forward: Bool, origin: G.Vec3, normal: G.Vec3) -> Lookup & EdgeCheck:
  choice_found(find_domain(table, index), index, forward, origin, normal)

def cons_check(r: Lookup & EdgeCheck, rest: List<&2, EdgeCheck>) -> Lookup & List<&2, EdgeCheck>:
  (table, check) = r
  (table, check <> rest)

# Checks of the uses in reverse order (consed onto acc); reversed by the caller.
def check_uses(uses: List<&2, T.Coedge>, r: Lookup & List<&2, EdgeCheck>, +origin: G.Vec3, +normal: G.Vec3) -> Lookup & List<&2, EdgeCheck>:
  match uses:
    case Nil{}:
      r
    case T.Use{+index, forward} <> tail:
      (table, acc) = r
      check_uses(tail, cons_check(check_use(table, index, forward, origin, normal), acc), origin, normal)

def gap_edges(checks: List<&2, EdgeCheck>) -> List<&2, F.PreparedEdge>:
  match checks:
    case Nil{}:
      Nil{}
    case Fixed{_} <> tail:
      gap_edges(tail)
    case Gap{prepared, _, _} <> tail:
      prepared <> gap_edges(tail)

# closed is F.loop_valid of the loop's edges. It is read only when every use
# of every loop passed (all Gap, all within the budget), when the edges are
# exactly the prepared edges F.prepare_uses would return.
type LoopCheck is Data:
  LoopCheck{checks: List<&2, EdgeCheck>, closed: Bool}

def loop_done(r: Lookup & List<&2, EdgeCheck>, outer: Bool) -> Lookup & (LoopCheck & F.PreparedLoop):
  (table, reversed) = r
  +checks = List.reverse(&2, EdgeCheck, reversed)
  +edges = gap_edges(checks)
  (table, (LoopCheck{checks, F.loop_valid(edges)}, F.PreparedLoop{outer, edges}))

type Loops is Data:
  Loops{checks: List<&2, LoopCheck>, prepared: List<&2, F.PreparedLoop>}

def cons_loop(r: Lookup & (LoopCheck & F.PreparedLoop), rest: Loops) -> Lookup & Loops:
  (table, pair) = r
  (check, prepared) = pair
  Loops{checks, loops} = rest
  (table, Loops{check <> checks, prepared <> loops})

def reverse_loops(loops: Loops, acc: Loops) -> Loops:
  Loops{checks, prepared} = loops
  Loops{done, kept} = acc
  Loops{List.reverse.go(&2, LoopCheck, checks, done), List.reverse.go(&2, F.PreparedLoop, prepared, kept)}

def check_loops(loops: List<&2, A.Loop>, r: Lookup & Loops, +origin: G.Vec3, +normal: G.Vec3) -> Lookup & Loops:
  match loops:
    case Nil{}:
      r
    case A.Loop{outer, uses} <> tail:
      (table, acc) = r
      check_loops(tail, cons_loop(loop_done(check_uses(uses, (table, Nil{}), origin, normal), outer), acc), origin, normal)

# First failure of F.prepare_loops at this budget, in F's order: the first
# failing use of the first failing loop, InvalidTopology for an open loop.
def check_fails(checks: List<&2, EdgeCheck>, +budget: R.Real, prior: Maybe<&2, F.Reason>) -> Maybe<&2, F.Reason>:
  match checks prior:
    case _ Some{reason}:
      Some{reason}
    case Nil{} None{}:
      None{}
    case Fixed{reason} <> _ None{}:
      Some{reason}
    case Gap{_, endpoints, planar} <> tail None{}:
      check_fails(tail, budget, Bool.pick(Maybe<&2, F.Reason>, Bool.and(I.at_most(endpoints, budget), I.at_most(planar, budget)), None{}, Some{F.InputGap{}}))

def loop_fails(first: Maybe<&2, F.Reason>, closed: Bool) -> Maybe<&2, F.Reason>:
  match first closed:
    case Some{reason} _:
      Some{reason}
    case None{} False{}:
      Some{F.InvalidTopology{}}
    case None{} True{}:
      None{}

def loops_fail(loops: List<&2, LoopCheck>, +budget: R.Real, prior: Maybe<&2, F.Reason>) -> Maybe<&2, F.Reason>:
  match loops prior:
    case _ Some{reason}:
      Some{reason}
    case Nil{} None{}:
      None{}
    case LoopCheck{checks, closed} <> tail None{}:
      loops_fail(tail, budget, loop_fails(check_fails(checks, budget, None{}), closed))

# ---------------------------------------------------------------- far-edge bounds

# The query scans below skip an edge only where the skipped step's answer is
# certain, and then use that answer: a face-ray edge whose curve-plane result
# is Resolved{Disjoint} (RayCount{True, 0} once linear_ok, which is still
# computed exactly), and a boundary edge that is ClearBoundary. The certainty
# comes from bounds in plain F32 on approximations (hi + lo) of the stored
# values, with a relative slack of 2^-14 of the magnitudes involved: F32
# rounding is 2^-24 per operation and the Real arithmetic of the skipped steps
# is accurate to about 2^-44, so the slack dominates both by orders of
# magnitude. The absolute distances demanded are several times the linear
# tolerance plus margin and budgets. The inputs are finite: vertices and line
# curves passed vec_valid/curve_valid in the loop preparation and the point
# passed vec_valid in the face query. A NaN or overflow of the bound
# arithmetic itself fails the comparison, i.e. "not certain", and the edge is
# then evaluated exactly.
type Axis is Data:
  Axis{x: F32, y: F32, z: F32}

def axis(v: G.Vec3) -> Axis:
  G.V3{x, y, z} = v
  Axis{R.approx(x), R.approx(y), R.approx(z)}

def axis_dot(a: Axis, b: Axis) -> F32:
  Axis{ax, ay, az} = a
  Axis{bx, by, bz} = b
  (ax * bx + ay * by + az * bz : F32)

def axis_mag(a: Axis) -> F32:
  Axis{x, y, z} = a
  F32.max(F32.abs(x), F32.max(F32.abs(y), F32.abs(z)))

def axis_min(a: Axis, b: Axis) -> Axis:
  Axis{ax, ay, az} = a
  Axis{bx, by, bz} = b
  Axis{F32.min(ax, bx), F32.min(ay, by), F32.min(az, bz)}

def axis_max(a: Axis, b: Axis) -> Axis:
  Axis{ax, ay, az} = a
  Axis{bx, by, bz} = b
  Axis{F32.max(ax, bx), F32.max(ay, by), F32.max(az, bz)}

def slack(+magnitude: F32) -> F32:
  (0.00006103515625 * (1.0 + magnitude) : F32)

# Line edge against one cut plane (unit normal n): n.start, n.end, n.origin,
# the magnitudes |start| + |end| + |origin|, |direction| (max norm), the length
# of direction and |b| = |n.direction|.
type LineBound is Data:
  LineBound{ds: F32, de: F32, dn: F32, mag: F32, dir: F32, len: F32, b: F32, origin: R.Real}

def line_bound(+start: G.Vec3, +end: G.Vec3, +origin: G.Vec3, +direction: G.Vec3, +normal: G.Vec3, b: R.Real) -> LineBound:
  +mag = (axis_mag(axis(start)) + axis_mag(axis(end)) + axis_mag(axis(origin)) : F32)
  LineBound{R.approx(G.dot(start, normal)), R.approx(G.dot(end, normal)), R.approx(G.dot(origin, normal)), mag, axis_mag(axis(direction)), R.approx(I.length(direction)), F32.abs(R.approx(b)), I.magnitude(origin)}

# Per face query: the projected point, its magnitude, the linear tolerance and
# the required clearances for rays (3 (linear + margin + budget)) and for
# boundary edges (2 (linear + resolution + source + budget)), budget being
# source + resolution as in the loop preparation.
type Site is Data:
  Site{point: Axis, mag: F32, linear: F32, ray: F32, box: F32, exact: R.Real}

def site_of(+point: G.Vec3, +linear: R.Real, +budget: R.Real, +resolution: R.Real, margin: R.Real) -> Site:
  +p = axis(point)
  +lin = R.approx(linear)
  +prepared = R.approx(R.add(budget, resolution))
  Site{p, axis_mag(p), lin, (3.0 * (lin + R.approx(margin) + prepared) : F32), (2.0 * (lin + R.approx(resolution) + R.approx(budget) + prepared) : F32), R.max(I.magnitude(point), zero())}

# Per face query and ray: n.point, and the rest of the site.
type Probe is Data:
  Probe{hn: F32, mag: F32, linear: F32, base: F32, exact: R.Real}

def probe_of(site: Site, normal: Axis) -> Probe:
  Site{point, mag, linear, ray, _, exact} = site
  Probe{axis_dot(point, normal), mag, linear, ray, exact}

# Non-parallel line: |t| of the root is at most T, so ray.bend's guard is at
# most G, and G (1 + len / |b|) bounds curve-plane line_root's linear
# resolution, which must stay within the tolerance; T also keeps t inside
# scalar_valid's range. With the endpoints both far on one side of the cut
# plane, the root lies outside the trimmed interval by more than the parameter
# resolution (G / |b|), so classify_parameter answers Outside.
def conditioned(dn: F32, hn: F32, a: F32, mag: F32, mh: F32, dir: F32, +len: F32, +b: F32, linear: F32) -> Bool:
  +t = ((F32.abs((dn - hn : F32)) + a) / b * 1.0001 : F32)
  +g = (0.0000000000001 * (1.0 + mag + mh + 2.0 * dir * t) * 1.0001 : F32)
  Bool.and(F32.is_le(t, 1000000000.0), F32.is_le((g * (1.0 + len / b) * 1.001 : F32), (0.5 * linear : F32)))

# Both vertices farther than the clearance on the same side of the cut plane:
# ray_avoids_vertices is True, and curve-plane answers Disjoint (parallel: the
# whole line is that far, beyond linear + guard; otherwise see conditioned).
def far_line(parallel: Bool, bound: LineBound, probe: Probe) -> Bool:
  LineBound{ds, de, dn, +mag, dir, len, b, _} = bound
  Probe{+hn, +mh, +linear, base, _} = probe
  +a = slack((mag + mh : F32))
  +w = (base + 4.0 * a : F32)
  +ss = (ds - hn : F32)
  +se = (de - hn : F32)
  same = Bool.or(Bool.and(F32.is_gt(ss, w), F32.is_gt(se, w)), Bool.and(F32.is_lt(ss, F32.neg(w)), F32.is_lt(se, F32.neg(w))))
  Bool.and(same, Bool.or(parallel, conditioned(dn, hn, a, mag, mh, dir, len, b, linear)))

type BoxEdge is Data:
  BoxEdge{prepared: F.PreparedEdge, line: Bool, lo: Axis, hi: Axis, mag: F32}

def is_line(curve: A.Curve) -> Bool:
  match curve:
    case A.Line{_, _}:
      True{}
    case _:
      False{}

def box_of(prepared: F.PreparedEdge) -> BoxEdge:
  F.PreparedEdge{index, edge, domain, +start, +end, forward} = prepared
  A.Edge{first, last, +curve, sense} = edge
  +a = axis(start)
  +b = axis(end)
  BoxEdge{F.PreparedEdge{index, A.Edge{first, last, curve, sense}, domain, start, end, forward}, is_line(curve), axis_min(a, b), axis_max(a, b), (axis_mag(a) + axis_mag(b) : F32)}

def box_edges(edges: List<&2, F.PreparedEdge>) -> List<&2, BoxEdge>:
  match edges:
    case Nil{}:
      Nil{}
    case head <> tail:
      box_of(head) <> box_edges(tail)

def box_loops(loops: List<&2, F.PreparedLoop>) -> List<&2, List<&2, BoxEdge>>:
  match loops:
    case Nil{}:
      Nil{}
    case F.PreparedLoop{_, edges} <> tail:
      box_edges(edges) <> box_loops(tail)

def gap(+lo: F32, +hi: F32, +p: F32) -> F32:
  F32.max(F32.max((lo - p : F32), (p - hi : F32)), 0.0)

# A trimmed line edge lies within the loop budget of its vertex segment, so
# its points are at least (max-norm box distance - budget) from the point;
# far beyond linear + resolution + source that is ClearBoundary.
def box_far(line: Bool, lo: Axis, hi: Axis, mag: F32, site: Site) -> Bool:
  Axis{x0, y0, z0} = lo
  Axis{x1, y1, z1} = hi
  Site{Axis{px, py, pz}, mh, _, _, box, _} = site
  distance = F32.max(gap(x0, x1, px), F32.max(gap(y0, y1, py), gap(z0, z1, pz)))
  Bool.and(line, F32.is_gt(distance, (box + 4.0 * slack((mag + mh : F32)) : F32)))

def edge_state(far: Bool, prepared: F.PreparedEdge, point: G.Vec3, origin: G.Vec3, normal: G.Vec3, linear: R.Real, budget: R.Real, resolution: R.Real) -> F.BoundaryState:
  match far:
    case True{}:
      F.ClearBoundary{}
    case False{}:
      F.edge_boundary(prepared, point, origin, normal, linear, budget, resolution)

def box_state(box: BoxEdge, point: G.Vec3, origin: G.Vec3, normal: G.Vec3, linear: R.Real, budget: R.Real, resolution: R.Real, site: Site) -> F.BoundaryState:
  BoxEdge{prepared, line, lo, hi, mag} = box
  edge_state(box_far(line, lo, hi, mag, site), prepared, point, origin, normal, linear, budget, resolution)

# F.boundaries_edges/boundaries_loops: the first OnBoundary in edge order,
# else UncertainBoundary if any edge is, else ClearBoundary (F.boundary_join).
def boundary_edges(edges: List<&2, BoxEdge>, +point: G.Vec3, +origin: G.Vec3, +normal: G.Vec3, +linear: R.Real, +budget: R.Real, +resolution: R.Real, +site: Site, state: F.BoundaryState) -> F.BoundaryState:
  match edges state:
    case _ F.OnBoundary{edge, parameter}:
      F.OnBoundary{edge, parameter}
    case box <> tail F.ClearBoundary{}:
      boundary_edges(tail, point, origin, normal, linear, budget, resolution, site, F.boundary_join(F.ClearBoundary{}, box_state(box, point, origin, normal, linear, budget, resolution, site)))
    case box <> tail F.UncertainBoundary{}:
      boundary_edges(tail, point, origin, normal, linear, budget, resolution, site, F.boundary_join(F.UncertainBoundary{}, box_state(box, point, origin, normal, linear, budget, resolution, site)))
    case Nil{} F.ClearBoundary{}:
      F.ClearBoundary{}
    case Nil{} F.UncertainBoundary{}:
      F.UncertainBoundary{}

def boundaries(loops: List<&2, List<&2, BoxEdge>>, +point: G.Vec3, +origin: G.Vec3, +normal: G.Vec3, +linear: R.Real, +budget: R.Real, +resolution: R.Real, +site: Site, state: F.BoundaryState) -> F.BoundaryState:
  match loops state:
    case _ F.OnBoundary{edge, parameter}:
      F.OnBoundary{edge, parameter}
    case edges <> tail F.ClearBoundary{}:
      boundaries(tail, point, origin, normal, linear, budget, resolution, site, boundary_edges(edges, point, origin, normal, linear, budget, resolution, site, F.ClearBoundary{}))
    case edges <> tail F.UncertainBoundary{}:
      boundaries(tail, point, origin, normal, linear, budget, resolution, site, boundary_edges(edges, point, origin, normal, linear, budget, resolution, site, F.UncertainBoundary{}))
    case Nil{} F.ClearBoundary{}:
      F.ClearBoundary{}
    case Nil{} F.UncertainBoundary{}:
      F.UncertainBoundary{}

# ---------------------------------------------------------------- face rays

# One in-plane ray of F.classify_rays. Line edges carry the point-independent
# part of curve-plane classify for this cut plane (b, the exact parallel
# certificate, the near-parallel test); other curves take F.ray_edge whole.
type RayEdge is Data:
  LineRay{prepared: F.PreparedEdge, origin: G.Vec3, direction: G.Vec3, b: R.Real, parallel: Bool, near: Bool, bound: LineBound}
  OtherRay{prepared: F.PreparedEdge}

type RayLoop is Data:
  RayLoop{outer: Bool, edges: List<&2, RayEdge>}

# dead: some line edge is near-parallel and not parallel, so curve-plane
# answers Unresolved{NearParallel} (or an earlier Unresolved) for every point
# and the ray is invalid for every query.
type FaceRay is Data:
  FaceRay{unit: G.Vec3, cut: G.Vec3, normal: G.Vec3, ok: Bool, dead: Bool, loops: List<&2, RayLoop>, axis: Axis}

def ray_edge_of(prepared: F.PreparedEdge, +normal: G.Vec3, +cut: G.Vec3, +tolerance: I.Tolerance) -> RayEdge:
  F.PreparedEdge{index, edge, domain, +start, +end, forward} = prepared
  A.Edge{first, last, curve, sense} = edge
  match curve:
    case A.Line{+origin, +direction}:
      +b = G.dot(normal, direction)
      parallel = I.expansion_zero(I.exact_dot(cut, direction))
      near = I.at_most(R.div(R.abs(b), I.length(direction)), R.add(I.tolerance_angular(tolerance), I.angular_guard()))
      bound = line_bound(start, end, origin, direction, normal, b)
      LineRay{F.PreparedEdge{index, A.Edge{first, last, A.Line{origin, direction}, sense}, domain, start, end, forward}, origin, direction, b, parallel, near, bound}
    case other:
      OtherRay{F.PreparedEdge{index, A.Edge{first, last, other, sense}, domain, start, end, forward}}

def ray_edges_of(edges: List<&2, F.PreparedEdge>, +normal: G.Vec3, +cut: G.Vec3, +tolerance: I.Tolerance) -> List<&2, RayEdge>:
  match edges:
    case Nil{}:
      Nil{}
    case head <> tail:
      ray_edge_of(head, normal, cut, tolerance) <> ray_edges_of(tail, normal, cut, tolerance)

def ray_loops_of(loops: List<&2, F.PreparedLoop>, +normal: G.Vec3, +cut: G.Vec3, +tolerance: I.Tolerance) -> List<&2, RayLoop>:
  match loops:
    case Nil{}:
      Nil{}
    case F.PreparedLoop{outer, edges} <> tail:
      RayLoop{outer, ray_edges_of(edges, normal, cut, tolerance)} <> ray_loops_of(tail, normal, cut, tolerance)

def edges_dead(edges: List<&2, RayEdge>) -> Bool:
  match edges:
    case Nil{}:
      False{}
    case LineRay{_, _, _, _, parallel, near, _} <> tail:
      Bool.or(Bool.and(near, Bool.not(parallel)), edges_dead(tail))
    case OtherRay{_} <> tail:
      edges_dead(tail)

def loops_dead(loops: List<&2, RayLoop>) -> Bool:
  match loops:
    case Nil{}:
      False{}
    case RayLoop{_, edges} <> tail:
      Bool.or(edges_dead(edges), loops_dead(tail))

def face_ray(direction: G.Vec3, +normal: G.Vec3, loops: List<&2, F.PreparedLoop>, tolerance: I.Tolerance) -> FaceRay:
  +unit = G.normalize(direction)
  +cut = G.normalize(G.cross(normal, unit))
  +cut_unit = G.normalize(cut)
  +rays = ray_loops_of(loops, cut_unit, cut, tolerance)
  FaceRay{unit, cut, cut_unit, Bool.and(I.vec_valid(cut), I.direction_valid(cut)), loops_dead(rays), rays, axis(cut_unit)}

def face_rays_of(directions: List<&2, G.Vec3>, +normal: G.Vec3, +loops: List<&2, F.PreparedLoop>, +tolerance: I.Tolerance) -> List<&2, FaceRay>:
  match directions:
    case Nil{}:
      Nil{}
    case direction <> tail:
      face_ray(direction, normal, loops, tolerance) <> face_rays_of(tail, normal, loops, tolerance)

# The five directions of F.classify_rays for this (unit) face normal.
def face_rays(+normal: G.Vec3, +loops: List<&2, F.PreparedLoop>, +tolerance: I.Tolerance) -> List<&2, FaceRay>:
  +u = A.axis_x(normal)
  +v = G.cross(normal, u)
  directions = {[u, G.add(u, G.scale(v, R.from_f32(0.375))), G.add(u, G.scale(v, R.from_f32(0.8125))), G.add(u, G.scale(v, R.from_f32(1.3125))), v] : List<&2, G.Vec3>}
  face_rays_of(directions, normal, loops, tolerance)

def line_scale(bound: LineBound, probe: Probe) -> R.Real:
  LineBound{_, _, _, _, _, _, _, origin} = bound
  Probe{_, _, _, _, exact} = probe
  R.max(R.from_f32(1.0), R.max(origin, exact))

def linear_certain(bound: LineBound, probe: Probe) -> Bool:
  LineBound{_, _, _, mag, _, _, _, _} = bound
  Probe{_, mh, linear, _, _} = probe
  F32.is_le((0.0000000000001 * (1.0 + mag + mh) * 1.0001 : F32), (0.5 * linear : F32))

def linear_known(certain: Bool, scale: R.Real, tolerance: I.Tolerance) -> Bool:
  match certain:
    case True{}:
      True{}
    case False{}:
      I.at_most(I.guard(scale), I.tolerance_linear(tolerance))

# F.ray_edge for a line edge, from the prepared b/parallel/near: the same
# ray_avoids_vertices, input budget and curve-plane classify steps.
def line_classified(parallel: Bool, curve: A.Curve, +point: G.Vec3, cut: G.Vec3, direction: G.Vec3, b: R.Real, c: R.Real, +scale: R.Real, domain: C.Domain, tolerance: I.Tolerance) -> C.CurvePlaneResult:
  match parallel:
    case True{}:
      C.parallel_curve(curve, point, cut, c, I.guard(scale), tolerance)
    case False{}:
      C.line_root(curve, point, cut, direction, b, c, scale, domain, tolerance)

def line_budget(linear_ok: Bool, parallel: Bool, +origin: G.Vec3, +direction: G.Vec3, b: R.Real, domain: C.Domain, +point: G.Vec3, cut: G.Vec3, normal: G.Vec3, unit: G.Vec3, tolerance: I.Tolerance, scale: R.Real, margin: R.Real) -> F.RayCount:
  match linear_ok:
    case False{}:
      F.RayCount{False{}, 0}
    case True{}:
      c = G.dot(normal, G.sub(origin, point))
      result = line_classified(parallel, A.Line{origin, direction}, point, cut, direction, b, c, scale, domain, tolerance)
      F.count_result(result, point, unit, margin)

def line_clear(clear: Bool, parallel: Bool, +origin: G.Vec3, direction: G.Vec3, b: R.Real, domain: C.Domain, +point: G.Vec3, cut: G.Vec3, normal: G.Vec3, unit: G.Vec3, +tolerance: I.Tolerance, margin: R.Real, +scale: R.Real) -> F.RayCount:
  match clear:
    case False{}:
      F.RayCount{False{}, 0}
    case True{}:
      linear_ok = I.at_most(I.guard(scale), I.tolerance_linear(tolerance))
      line_budget(linear_ok, parallel, origin, direction, b, domain, point, cut, normal, unit, tolerance, scale, margin)

def line_far(far: Bool, certain: Bool, +scale: R.Real, parallel: Bool, +origin: G.Vec3, direction: G.Vec3, b: R.Real, +domain: C.Domain, start: G.Vec3, end: G.Vec3, +point: G.Vec3, +cut: G.Vec3, normal: G.Vec3, unit: G.Vec3, +tolerance: I.Tolerance, +margin: R.Real) -> F.RayCount:
  match far:
    case True{}:
      F.RayCount{linear_known(certain, scale, tolerance), 0}
    case False{}:
      clear = F.ray_avoids_vertices(domain, start, end, point, cut, margin)
      line_clear(clear, parallel, origin, direction, b, domain, point, cut, normal, unit, tolerance, margin, scale)

def line_edge(dead: Bool, +parallel: Bool, +bound: LineBound, +probe: Probe, +origin: G.Vec3, direction: G.Vec3, b: R.Real, +domain: C.Domain, start: G.Vec3, end: G.Vec3, +point: G.Vec3, +cut: G.Vec3, normal: G.Vec3, unit: G.Vec3, +tolerance: I.Tolerance, +margin: R.Real) -> F.RayCount:
  match dead:
    case True{}:
      F.RayCount{False{}, 0}
    case False{}:
      line_far(far_line(parallel, bound, probe), linear_certain(bound, probe), line_scale(bound, probe), parallel, origin, direction, b, domain, start, end, point, cut, normal, unit, tolerance, margin)

def ray_edge(edge: RayEdge, +point: G.Vec3, +cut: G.Vec3, normal: G.Vec3, +unit: G.Vec3, +tolerance: I.Tolerance, +margin: R.Real, probe: Probe) -> F.RayCount:
  match edge:
    case LineRay{prepared, origin, direction, b, +parallel, near, bound}:
      F.PreparedEdge{_, _, domain, start, end, _} = prepared
      line_edge(Bool.and(near, Bool.not(parallel)), parallel, bound, probe, origin, direction, b, domain, start, end, point, cut, normal, unit, tolerance, margin)
    case OtherRay{prepared}:
      F.ray_edge(prepared, point, cut, unit, tolerance, margin)

def add_count(count: U32, one: F.RayCount) -> F.RayCount:
  F.RayCount{valid, n} = one
  F.RayCount{valid, (count + n : U32)}

# F.ray_edges, stopping at the first invalid edge (its count is then unused).
def ray_edges(edges: List<&2, RayEdge>, +point: G.Vec3, +cut: G.Vec3, +normal: G.Vec3, +unit: G.Vec3, +tolerance: I.Tolerance, +margin: R.Real, +probe: Probe, acc: F.RayCount) -> F.RayCount:
  match edges acc:
    case _ F.RayCount{False{}, _}:
      F.RayCount{False{}, 0}
    case head <> tail F.RayCount{True{}, count}:
      ray_edges(tail, point, cut, normal, unit, tolerance, margin, probe, add_count(count, ray_edge(head, point, cut, normal, unit, tolerance, margin, probe)))
    case Nil{} F.RayCount{True{}, count}:
      F.RayCount{True{}, count}

def add_loop(+outer_loop: Bool, count: F.RayCount, outer: Bool, hole: Bool) -> F.RayRegion:
  F.RayCount{valid, n} = count
  +inside = U32.is_eq(U32.and(n, 1), 1)
  F.RayRegion{valid, Bool.or(outer, Bool.and(outer_loop, inside)), Bool.or(hole, Bool.and(Bool.not(outer_loop), inside))}

# F.ray_loops (add_region ORs are order-free), stopping at an invalid loop.
def ray_loops(loops: List<&2, RayLoop>, +point: G.Vec3, +cut: G.Vec3, +normal: G.Vec3, +unit: G.Vec3, +tolerance: I.Tolerance, +margin: R.Real, +probe: Probe, acc: F.RayRegion) -> F.RayRegion:
  match loops acc:
    case _ F.RayRegion{False{}, _, _}:
      F.RayRegion{False{}, False{}, False{}}
    case RayLoop{outer_loop, edges} <> tail F.RayRegion{True{}, outer, hole}:
      ray_loops(tail, point, cut, normal, unit, tolerance, margin, probe, add_loop(outer_loop, ray_edges(edges, point, cut, normal, unit, tolerance, margin, probe, F.RayCount{True{}, 0}), outer, hole))
    case Nil{} F.RayRegion{True{}, outer, hole}:
      F.RayRegion{True{}, outer, hole}

def ray_region(valid: Bool, dead: Bool, loops: List<&2, RayLoop>, point: G.Vec3, cut: G.Vec3, normal: G.Vec3, unit: G.Vec3, tolerance: I.Tolerance, margin: R.Real, probe: Probe) -> F.RayRegion:
  match valid dead:
    case True{} False{}:
      ray_loops(loops, point, cut, normal, unit, tolerance, margin, probe, F.RayRegion{True{}, False{}, False{}})
    case _ _:
      F.RayRegion{False{}, False{}, False{}}

# F.ray_directions over the prepared rays, same order and agreement fold.
def ray_directions(rays: List<&2, FaceRay>, +point: G.Vec3, +valid: Bool, +tolerance: I.Tolerance, +margin: R.Real, +site: Site, agreement: F.Agreement) -> F.Agreement:
  match rays:
    case Nil{}:
      agreement
    case FaceRay{unit, cut, normal, ok, dead, loops, axis} <> tail:
      result = ray_region(Bool.and(valid, ok), dead, loops, point, cut, normal, unit, tolerance, margin, probe_of(site, axis))
      ray_directions(tail, point, valid, tolerance, margin, site, F.add_agreement(result, agreement))

def classify_rays(rays: List<&2, FaceRay>, +point: G.Vec3, +tolerance: I.Tolerance, margin: R.Real, site: Site) -> F.Classification:
  valid = Bool.and(I.vec_valid(point), Bool.and(I.tolerance_valid(tolerance), I.at_most(I.angular_guard(), I.tolerance_angular(tolerance))))
  F.agreement_result(ray_directions(rays, point, valid, tolerance, margin, site, F.Agreement{0, False{}, False{}}))

# ---------------------------------------------------------------- faces

# Solid ray k against face j: the point-independent half of ray.bend
# plane_intersection (ok = direction_valid(direction) and surface_valid).
type SolidRay is Data:
  PlaneLine{ok: Bool, center: G.Vec3, normal: G.Vec3, length: R.Real, b: R.Real, cert: Bool}
  SurfaceLine{direction: G.Vec3, surface: A.Surface}

type SolidLine is Data:
  SolidLine{unit: G.Vec3, rays: List<&2, SolidRay>}

type PFace is Data:
  PlaneFace{origin: G.Vec3, input_ok: Bool, normal: G.Vec3, checks: List<&2, LoopCheck>, loops: List<&2, F.PreparedLoop>, single: Bool, rays: List<&2, FaceRay>, boxes: List<&2, List<&2, BoxEdge>>}
  CylinderFace{}
  OtherFace{}

def after_face_boundary(boundary: F.BoundaryState, rays: List<&2, FaceRay>, point: G.Vec3, tolerance: I.Tolerance, margin: R.Real, site: Site) -> F.Classification:
  match boundary:
    case F.OnBoundary{edge, parameter}:
      F.Boundary{edge, parameter}
    case F.UncertainBoundary{}:
      F.Unresolved{F.NearBoundary{}}
    case F.ClearBoundary{}:
      classify_rays(rays, point, tolerance, margin, site)

def point_in_plane(near: Bool, outside: Bool, boxes: List<&2, List<&2, BoxEdge>>, rays: List<&2, FaceRay>, +point: G.Vec3, +origin: G.Vec3, +normal: G.Vec3, +tolerance: I.Tolerance, +budget: R.Real, +resolution: R.Real) -> F.Classification:
  match near outside:
    case True{} _:
      F.Unresolved{F.NearFacePlane{}}
    case False{} True{}:
      F.Outside{0}
    case False{} False{}:
      +projected = F.project(point, origin, normal)
      +linear = I.tolerance_linear(tolerance)
      +margin = R.add(R.add(linear, budget), resolution)
      +site = site_of(projected, linear, budget, resolution, margin)
      boundary = boundaries(boxes, projected, origin, normal, linear, budget, resolution, site, F.ClearBoundary{})
      after_face_boundary(boundary, rays, projected, tolerance, margin, site)

def face_valid(valid: Bool, boxes: List<&2, List<&2, BoxEdge>>, rays: List<&2, FaceRay>, +point: G.Vec3, +origin: G.Vec3, +normal: G.Vec3, +tolerance: I.Tolerance, budget: R.Real, +resolution: R.Real) -> F.Classification:
  match valid:
    case False{}:
      F.Unresolved{F.InvalidTopology{}}
    case True{}:
      +offset = R.abs(G.dot(G.sub(point, origin), normal))
      +linear = I.tolerance_linear(tolerance)
      near = I.at_most(R.abs(R.sub(offset, linear)), resolution)
      point_in_plane(near, R.less(R.add(linear, resolution), offset), boxes, rays, point, origin, normal, tolerance, budget, resolution)

def loops_ready(failed: Maybe<&2, F.Reason>, single: Bool, boxes: List<&2, List<&2, BoxEdge>>, rays: List<&2, FaceRay>, point: G.Vec3, origin: G.Vec3, normal: G.Vec3, tolerance: I.Tolerance, budget: R.Real, resolution: R.Real) -> F.Classification:
  match failed:
    case Some{reason}:
      F.Unresolved{reason}
    case None{}:
      face_valid(single, boxes, rays, point, origin, normal, tolerance, budget, resolution)

def resolution_ok(valid: Bool, checks: List<&2, LoopCheck>, single: Bool, boxes: List<&2, List<&2, BoxEdge>>, rays: List<&2, FaceRay>, point: G.Vec3, origin: G.Vec3, normal: G.Vec3, tolerance: I.Tolerance, +budget: R.Real, +resolution: R.Real) -> F.Classification:
  match valid:
    case False{}:
      F.Unresolved{F.ResolutionLimit{}}
    case True{}:
      failed = loops_fail(checks, R.add(budget, resolution), None{})
      loops_ready(failed, single, boxes, rays, point, origin, normal, tolerance, budget, resolution)

def input_ok(valid: Bool, scale: Scale, checks: List<&2, LoopCheck>, single: Bool, boxes: List<&2, List<&2, BoxEdge>>, rays: List<&2, FaceRay>, +point: G.Vec3, +origin: G.Vec3, normal: G.Vec3, +tolerance: I.Tolerance, budget: R.Real) -> F.Classification:
  match valid:
    case False{}:
      F.Unresolved{F.InvalidInput{}}
    case True{}:
      +resolution = R.mul(I.angular_guard(), scale_of(scale, I.input_scale(point, origin, R.from_f32(1.0))))
      resolution_ok(R.less(resolution, I.tolerance_linear(tolerance)), checks, single, boxes, rays, point, origin, normal, tolerance, budget, resolution)

# = F.classify(solid, index, domains, point, tolerance, budget) for a plane face.
def plane_classify(face: PFace, scale: Scale, +point: G.Vec3, +tolerance: I.Tolerance, +budget: R.Real) -> F.Classification:
  match face:
    case PlaneFace{origin, normal_ok, normal, checks, _, single, rays, boxes}:
      geometry_ok = Bool.and(I.vec_valid(point), normal_ok)
      tolerance_ok = Bool.and(I.tolerance_valid(tolerance), I.at_most(I.angular_guard(), I.tolerance_angular(tolerance)))
      source_ok = Bool.and(I.scalar_valid(budget), Bool.and(I.at_most(zero(), budget), I.at_most(budget, R.from_f32(0.1))))
      input_ok(Bool.and(geometry_ok, Bool.and(tolerance_ok, source_ok)), scale, checks, single, boxes, rays, point, origin, normal, tolerance, budget)
    case _:
      F.Unresolved{F.NonPlanarFace{}}

type Context is Data:
  Context{solid: A.Solid, domains: List<&2, F.DomainChoice>, scale: Scale, tolerance: I.Tolerance, budget: R.Real}

# = S.membership(solid, index, domains, point, tolerance, budget).
def face_membership(face: PFace, +index: U32, context: Context, +point: G.Vec3) -> S.Membership:
  match face:
    case PlaneFace{origin, normal_ok, normal, checks, loops, single, rays, boxes}:
      Context{_, _, scale, tolerance, budget} = context
      S.planar_membership(plane_classify(PlaneFace{origin, normal_ok, normal, checks, loops, single, rays, boxes}, scale, point, tolerance, budget))
    case CylinderFace{}:
      Context{solid, domains, _, tolerance, budget} = context
      S.cylinder_membership(CY.classify(solid, index, domains, point, tolerance, budget))
    case OtherFace{}:
      S.FaceUnknown{}

# ---------------------------------------------------------------- solid rays

# = Y.line_surface(point, direction, surface); bounded = Y.bounded(point).
def plane_roots(valid: Bool, +center: G.Vec3, +normal: G.Vec3, length: R.Real, b: R.Real, cert: Bool, +point: G.Vec3) -> Y.Roots:
  match valid:
    case False{}:
      Y.none(5)
    case True{}:
      +c = R.div(G.dot(normal, G.sub(point, center)), length)
      cert_c = I.coincidence_certificate(R.equal(c, zero()), normal, point, center)
      Y.solve_certified(zero(), b, c, Y.Certificates{True{}, cert, cert_c, False{}})

def solid_roots(ray: SolidRay, +point: G.Vec3, bounded: Bool) -> Y.Roots:
  match ray:
    case PlaneLine{ok, center, normal, length, b, cert}:
      Y.range_check(plane_roots(Bool.and(bounded, ok), center, normal, length, b, cert, point), R.from_f32(100000.0))
    case SurfaceLine{direction, surface}:
      Y.line_surface(point, direction, surface)

# S.count_roots with the prepared face; stops at the first invalid root.
def count_roots(roots: List<&2, R.Real>, +face: PFace, +index: U32, +context: Context, +point: G.Vec3, +unit: G.Vec3, +margin: R.Real, acc: S.LineCount) -> S.LineCount:
  match roots acc:
    case _ S.LineCount{False{}, _, _}:
      S.LineCount{False{}, 0, 0}
    case +parameter <> tail S.LineCount{True{}, forward, backward}:
      one = S.count_member(face_membership(face, index, context, G.add(point, G.scale(unit, parameter))), parameter, margin)
      count_roots(tail, face, index, context, point, unit, margin, S.plus_counts(S.LineCount{True{}, forward, backward}, one))
    case Nil{} S.LineCount{True{}, forward, backward}:
      S.LineCount{True{}, forward, backward}

def count_surface(result: Y.Roots, face: PFace, index: U32, context: Context, point: G.Vec3, unit: G.Vec3, margin: R.Real, acc: S.LineCount) -> S.LineCount:
  Y.Roots{kind, roots} = result
  match kind:
    case 0:
      acc
    case 1:
      count_roots(roots, face, index, context, point, unit, margin, acc)
    case _:
      S.LineCount{False{}, 0, 0}

# S.line_faces for one solid ray: the same faces in order, stopping at the
# first invalid face (an invalid LineCount's counts are unused by S.add_vote).
def line_faces(rays: List<&2, SolidRay>, faces: List<&2, PFace>, +index: U32, +context: Context, +point: G.Vec3, +bounded: Bool, +unit: G.Vec3, +margin: R.Real, acc: S.LineCount) -> S.LineCount:
  match rays faces acc:
    case _ _ S.LineCount{False{}, _, _}:
      S.LineCount{False{}, 0, 0}
    case ray <> rest face <> tail S.LineCount{True{}, forward, backward}:
      line_faces(rest, tail, (index + 1 : U32), context, point, bounded, unit, margin, count_surface(solid_roots(ray, point, bounded), face, index, context, point, unit, margin, S.LineCount{True{}, forward, backward}))
    case _ _ S.LineCount{True{}, forward, backward}:
      S.LineCount{True{}, forward, backward}

def cast_lines(lines: List<&2, SolidLine>, +faces: List<&2, PFace>, +context: Context, +point: G.Vec3, +bounded: Bool, +margin: R.Real) -> S.Votes:
  match lines:
    case Nil{}:
      S.Votes{0, False{}, False{}}
    case SolidLine{unit, rays} <> tail:
      vote = S.line_vote(line_faces(rays, faces, 0, context, point, bounded, unit, margin, S.LineCount{True{}, 0, 0}))
      S.add_vote(vote, cast_lines(tail, faces, context, point, bounded, margin))

# ---------------------------------------------------------------- solid

type Prepared is Data:
  Prepared{context: Context, closed: Bool, faces: List<&2, PFace>, lines: List<&2, SolidLine>}

def face_check(face: PFace, +index: U32, context: Context, point: G.Vec3) -> S.Classification:
  match face:
    case OtherFace{}:
      S.Unresolved{S.UnsupportedSurface{index}}
    case supported:
      S.face_boundary(face_membership(supported, index, context, point), index)

def keep_first(prior: S.Classification, face: U32) -> S.Classification:
  match prior:
    case S.Outside{_}:
      S.Boundary{face}
    case S.Boundary{first}:
      S.Boundary{first}
    case S.Inside{rays}:
      S.Inside{rays}
    case S.Unresolved{reason}:
      S.Unresolved{reason}

def boundary_step(prior: S.Classification, one: S.Classification) -> S.Classification:
  match one:
    case S.Unresolved{reason}:
      S.Unresolved{reason}
    case S.Boundary{face}:
      keep_first(prior, face)
    case S.Outside{_}:
      prior
    case S.Inside{_}:
      prior

# S.boundary_faces: the leftmost Unresolved, else the leftmost Boundary, else
# Outside{0}. found holds Outside{0} or the first Boundary seen.
def boundary_faces(faces: List<&2, PFace>, +index: U32, +context: Context, +point: G.Vec3, found: S.Classification) -> S.Classification:
  match faces found:
    case _ S.Unresolved{reason}:
      S.Unresolved{reason}
    case face <> tail S.Outside{rays}:
      boundary_faces(tail, (index + 1 : U32), context, point, boundary_step(S.Outside{rays}, face_check(face, index, context, point)))
    case face <> tail S.Boundary{hit}:
      boundary_faces(tail, (index + 1 : U32), context, point, boundary_step(S.Boundary{hit}, face_check(face, index, context, point)))
    case face <> tail S.Inside{rays}:
      boundary_faces(tail, (index + 1 : U32), context, point, boundary_step(S.Inside{rays}, face_check(face, index, context, point)))
    case Nil{} S.Outside{rays}:
      S.Outside{rays}
    case Nil{} S.Boundary{hit}:
      S.Boundary{hit}
    case Nil{} S.Inside{rays}:
      S.Inside{rays}

def after_boundary(result: S.Classification, faces: List<&2, PFace>, lines: List<&2, SolidLine>, +context: Context, +point: G.Vec3) -> S.Classification:
  match result:
    case S.Outside{_}:
      Context{_, _, scale, tolerance, budget} = context
      scaled = scale_of(scale, R.max(R.from_f32(1.0), I.magnitude(point)))
      margin = R.add(R.add(I.tolerance_linear(tolerance), budget), R.mul(I.angular_guard(), scaled))
      S.finish_votes(cast_lines(lines, faces, context, point, Y.bounded(point), margin))
    case other:
      other

def topology(closed: Bool, +faces: List<&2, PFace>, lines: List<&2, SolidLine>, +context: Context, +point: G.Vec3) -> S.Classification:
  match closed:
    case False{}:
      S.Unresolved{S.InvalidTopology{}}
    case True{}:
      after_boundary(boundary_faces(faces, 0, context, point, S.Outside{0}), faces, lines, context, point)

def checked(valid: Bool, closed: Bool, faces: List<&2, PFace>, lines: List<&2, SolidLine>, context: Context, point: G.Vec3) -> S.Classification:
  match valid:
    case False{}:
      S.Unresolved{S.InvalidInput{}}
    case True{}:
      topology(closed, faces, lines, context, point)

# = S.classify(solid, domains, point, tolerance, budget) for the prepared operand.
def classify(prepared: Prepared, +point: G.Vec3) -> S.Classification:
  Prepared{+context, closed, faces, lines} = prepared
  Context{_, _, _, +tolerance, +budget} = context
  valid = Bool.and(I.vec_valid(point), Bool.and(I.tolerance_valid(tolerance), Bool.and(I.at_most(I.angular_guard(), I.tolerance_angular(tolerance)), F.valid_budget(budget))))
  checked(valid, closed, faces, lines, context, point)

# ---------------------------------------------------------------- prepare

def solid_ray(+direction: G.Vec3, surface: A.Surface) -> SolidRay:
  match surface:
    case A.Plane{+center, +normal, x}:
      ok = Bool.and(Y.direction_valid(direction), Y.surface_valid(A.Plane{center, normal, x}))
      +length = I.length(normal)
      +b = R.div(G.dot(normal, direction), R.mul(length, I.length(direction)))
      cert = I.perpendicular_certificate(R.equal(b, zero()), normal, direction)
      PlaneLine{ok, center, normal, length, b, cert}
    case other:
      SurfaceLine{direction, other}

def solid_rays(faces: List<&2, A.Face>, +direction: G.Vec3) -> List<&2, SolidRay>:
  match faces:
    case Nil{}:
      Nil{}
    case A.Face{surface, _, _} <> tail:
      solid_ray(direction, surface) <> solid_rays(tail, direction)

def solid_lines(directions: List<&2, G.Vec3>, +faces: List<&2, A.Face>) -> List<&2, SolidLine>:
  match directions:
    case Nil{}:
      Nil{}
    case +direction <> tail:
      SolidLine{G.normalize(direction), solid_rays(faces, direction)} <> solid_lines(tail, faces)

def plane_face(loops: Loops, +normal: G.Vec3, origin: G.Vec3, input_ok: Bool, tolerance: I.Tolerance) -> PFace:
  Loops{checks, +prepared} = loops
  PlaneFace{origin, input_ok, normal, checks, prepared, U32.is_eq(F.outer_count(prepared), 1), face_rays(normal, prepared, tolerance), box_loops(prepared)}

def loops_done(r: Lookup & Loops, normal: G.Vec3, origin: G.Vec3, input_ok: Bool, tolerance: I.Tolerance) -> Lookup & PFace:
  (table, reversed) = r
  (table, plane_face(reverse_loops(reversed, Loops{Nil{}, Nil{}}), normal, origin, input_ok, tolerance))

def prepare_face(table: Lookup, surface: A.Surface, loops: List<&2, A.Loop>, +tolerance: I.Tolerance) -> Lookup & PFace:
  match surface:
    case A.Plane{+origin, +normal, _}:
      +unit = G.normalize(normal)
      input_ok = Bool.and(I.vec_valid(origin), Bool.and(I.vec_valid(normal), I.direction_valid(normal)))
      loops_done(check_loops(loops, (table, Loops{Nil{}, Nil{}}), origin, unit), unit, origin, input_ok, tolerance)
    case A.Cylinder{_, _, _, _}:
      (table, CylinderFace{})
    case _:
      (table, OtherFace{})

def cons_face(r: Lookup & PFace, rest: List<&2, PFace>) -> Lookup & List<&2, PFace>:
  (table, face) = r
  (table, face <> rest)

def faces_of(r: Lookup & List<&2, PFace>) -> List<&2, PFace>:
  (_, acc) = r
  List.reverse(&2, PFace, acc)

def prepare_faces(faces: List<&2, A.Face>, r: Lookup & List<&2, PFace>, +tolerance: I.Tolerance) -> List<&2, PFace>:
  match faces:
    case Nil{}:
      faces_of(r)
    case A.Face{surface, _, loops} <> tail:
      (table, acc) = r
      prepare_faces(tail, cons_face(prepare_face(table, surface, loops, tolerance), acc), tolerance)

def solid_directions() -> List<&2, G.Vec3>:
  {[G.v3(1.0, 0.3125, 0.6875), G.v3(0.4375, 1.0, 0.8125), G.v3(0.625, 0.1875, 1.0), G.v3(1.0, F32.neg(0.5625), 0.25), G.v3(F32.neg(0.375), 1.0, 0.5625)] : List<&2, G.Vec3>}

def prepare(+solid: A.Solid, +domains: List<&2, F.DomainChoice>, +tolerance: I.Tolerance, budget: R.Real) -> Prepared:
  A.Solid{+vertices, +edges, +faces} = solid
  closed = Bool.and(S.nonempty(solid), S.edges_closed(edges, faces, 0))
  prepared = prepare_faces(faces, (lookup(vertices, edges, domains), Nil{}), tolerance)
  Prepared{Context{solid, domains, prepare_scale(edges), tolerance, budget}, closed, prepared, solid_lines(solid_directions(), faces)}
