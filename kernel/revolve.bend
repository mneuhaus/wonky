import Base
import ./precise.bend as G
import ./real.bend as R
import ./analytic.bend as A
import ./topology.bend as T

# Exact solid of revolution from a closed polygonal profile, swept a full turn.
# Every segment of the profile becomes one analytic face: parallel to the axis
# gives a cylinder, oblique gives a cone, perpendicular gives a plane. No new
# surface kind is needed and nothing is facetted; this is frustum generalised
# from one band to many, and a single-band profile reproduces it exactly.
#
# The profile lives in the half plane spanned by the axis and x: `radius` is
# measured along x, `height` along the axis from origin. Points are given in
# order and the last closes back to the first. Traversal must be
# counterclockwise in (radius, height), which puts material inside the loop and
# is what fixes every face orientation below.
#
# `revolve` returns a Revolved, not a Solid, so admission cannot be skipped. An
# earlier shape exported the builder directly beside a `supported` predicate
# that nothing called, and a two-point profile duly built two coincident planes
# that validated as a closed manifold and exported to STEP. Refusing in the
# return type removes that path rather than documenting it.
type Ring is Data:
  Ring{radius: R.Real, height: R.Real}

# Refusal codes. 0 is never constructed: an admitted profile carries a solid.
#   1  fewer than three points, which bound no area
#   2  a radius is not positive, so the profile touches or crosses the axis
#   3  a segment is shorter than the tolerance
#   4  the profile is not counterclockwise, so the shell would be inside out
type Revolved is Data:
  Swept{solid: A.Solid}
  Refused{reason: U32}

def zero() -> R.Real:
  R.from_f32(0.0)

def height_of(ring: Ring) -> R.Real:
  Ring{_, height} = ring
  height

def center(ring: Ring, +origin: G.Vec3, +axis: G.Vec3) -> G.Vec3:
  Ring{_, height} = ring
  G.add(origin, G.scale(axis, height))

def seam_point(ring: Ring, +origin: G.Vec3, +axis: G.Vec3, +x: G.Vec3) -> G.Vec3:
  Ring{+radius, +height} = ring
  G.add(G.add(origin, G.scale(axis, height)), G.scale(x, radius))

# --- swept volume ----------------------------------------------------------

# Exact, by the divergence theorem on each band: a band contributes the swept
# area of the trapezoid between its two rings, and over a closed profile the
# open ends cancel. Defined before admission because the sign of this sum is
# what decides the winding, and Bend has no forward references.
def band_volume(a: Ring, b: Ring) -> R.Real:
  Ring{+ar, +ah} = a
  Ring{+br, +bh} = b
  R.mul(R.mul(R.pi(), R.sub(bh, ah)),
    R.add(R.add(R.mul(ar, ar), R.mul(ar, br)), R.mul(br, br)))

# The list leads every recursive signature here because Bend reads arguments
# left to right and needs the first one to shrink.
def volume_steps(points: List<&2, Ring>, a: Ring, +first: Ring) -> R.Real:
  match points:
    case Nil{}:
      band_volume(a, first)
    case +b <> rest:
      R.add(band_volume(a, b), volume_steps(rest, b, first))

def volume(profile: List<&2, Ring>) -> R.Real:
  match profile:
    case Nil{}:
      zero()
    case +head <> tail:
      R.div(volume_steps(tail, head, head), R.from_f32(3.0))

# --- admission -------------------------------------------------------------

def positive_radii(profile: List<&2, Ring>) -> Bool:
  match profile:
    case Nil{}:
      True{}
    case Ring{radius, _} <> tail:
      Bool.and(R.less(zero(), radius), positive_radii(tail))

# A segment must be longer than the tolerance, not merely different from its
# neighbour. Exact inequality admitted bands a couple of ulps tall, which build
# and validate here and are then rejected by BRepCheck_Analyzer downstream --
# the kernel certifying geometry its own acceptance oracle refuses.
def separated(a: Ring, b: Ring, +tolerance: R.Real) -> Bool:
  Ring{+ar, +ah} = a
  Ring{+br, +bh} = b
  +dr = R.sub(br, ar)
  +dh = R.sub(bh, ah)
  R.less(tolerance, R.sqrt(R.add(R.mul(dr, dr), R.mul(dh, dh))))

def separated_steps(points: List<&2, Ring>, a: Ring, +first: Ring, +tolerance: R.Real) -> Bool:
  match points:
    case Nil{}:
      separated(a, first, tolerance)
    case +b <> rest:
      Bool.and(separated(a, b, tolerance), separated_steps(rest, b, first, tolerance))

# Known gap, deliberately not claimed as handled: a profile that crosses itself
# but still encloses positive net area passes every test below. Detecting that
# needs pairwise segment intersection with the collinear-overlap case handled,
# and a half-correct version would reject legitimate profiles that merely have
# two disjoint collinear walls at the same radius.
def rejection(+profile: List<&2, Ring>, +tolerance: R.Real) -> U32:
  match profile:
    case Nil{}:
      1
    case +head <> +tail:
      +all = {head <> tail : List<&2, Ring>}
      +enough = U32.is_lt(2, U32.from_nat(List.length(&2, Ring, all)))
      +radii = positive_radii(all)
      +steps = separated_steps(tail, head, head, tolerance)
      +wound = R.less(zero(), volume(all))
      Bool.pick(U32, enough,
        Bool.pick(U32, radii,
          Bool.pick(U32, steps,
            Bool.pick(U32, wound, 0, 4), 3), 2), 1)

def supported(profile: List<&2, Ring>, tolerance: R.Real) -> Bool:
  U32.is_eq(rejection(profile, tolerance), 0)

# --- topology --------------------------------------------------------------

# Circle i is edge i and closes on its own single vertex i, the seam point.
def circle_edges(profile: List<&2, Ring>, +origin: G.Vec3, +axis: G.Vec3, +x: G.Vec3, +index: U32) -> List<&2, A.Edge>:
  match profile:
    case Nil{}:
      Nil{}
    case +ring <> tail:
      Ring{radius, _} = ring
      A.Edge{index, index, A.Circle{center(ring, origin, axis), axis, x, radius}, True{}}
        <> circle_edges(tail, origin, axis, x, (index + 1 : U32))

# Seam j is edge count+j and runs from vertex j to vertex j+1, the last
# wrapping to vertex 0. Each band borrows it twice, once in each direction,
# the way a periodic face is closed in frustum.
def seam_edge(a: Ring, b: Ring, start: U32, end: U32, +origin: G.Vec3, +axis: G.Vec3, +x: G.Vec3) -> A.Edge:
  +p = seam_point(a, origin, axis, x)
  +q = seam_point(b, origin, axis, x)
  A.Edge{start, end, A.Line{p, G.normalize(G.sub(q, p))}, True{}}

def seam_edges(points: List<&2, Ring>, a: Ring, +first: Ring, +origin: G.Vec3, +axis: G.Vec3, +x: G.Vec3, +index: U32) -> List<&2, A.Edge>:
  match points:
    case Nil{}:
      [seam_edge(a, first, index, 0, origin, axis, x)]
    case +b <> rest:
      seam_edge(a, b, index, (index + 1 : U32), origin, axis, x)
        <> seam_edges(rest, b, first, origin, axis, x, (index + 1 : U32))

def seam_points(profile: List<&2, Ring>, +origin: G.Vec3, +axis: G.Vec3, +x: G.Vec3) -> List<&2, G.Vec3>:
  match profile:
    case Nil{}:
      Nil{}
    case ring <> tail:
      seam_point(ring, origin, axis, x) <> seam_points(tail, origin, axis, x)

# --- one band --------------------------------------------------------------

# Surface for the band between two rings, always built from the lower ring
# upward so the cone cases match frustum exactly. Which way the profile
# actually traverses it is carried by same_sense, not by the surface.
def band_surface(low: Ring, high: Ring, +origin: G.Vec3, +axis: G.Vec3, +x: G.Vec3) -> A.Surface:
  Ring{+r0, +h0} = low
  Ring{+r1, +h1} = high
  +bottom = G.add(origin, G.scale(axis, h0))
  +top = G.add(origin, G.scale(axis, h1))
  +height = R.abs(R.sub(h1, h0))
  Bool.pick(A.Surface, R.equal(h0, h1), A.Plane{bottom, axis, x},
    Bool.pick(A.Surface, R.equal(r0, r1), A.Cylinder{bottom, axis, x, r0},
      Bool.pick(A.Surface, R.less(r0, r1),
        A.Cone{bottom, axis, x, r0, R.atan(R.div(R.sub(r1, r0), height))},
        A.Cone{top, G.scale(axis, R.from_f32(F32.neg(1.0))), x, r1, R.atan(R.div(R.sub(r0, r1), height))})))

# Outward orientation follows from the traversal direction. A band climbed in
# +axis has material to its left, so its outward normal points away from the
# axis and agrees with the cylinder or cone normal. A band descended is an
# inner wall and disagrees. A horizontal band faces -axis when the profile
# runs outward and +axis when it runs inward, which is exactly the pair of
# cap orientations frustum uses. This holds only for a counterclockwise
# profile, which is why rejection() refuses any other winding.
def band_sense(a: Ring, b: Ring) -> Bool:
  Ring{+ar, +ah} = a
  Ring{+br, +bh} = b
  Bool.pick(Bool, R.equal(ah, bh), R.less(br, ar), R.less(ah, bh))

# The loop runs in profile order, not in height order: the band's own start
# circle forward, along the seam, the end circle backward, back down the seam.
# That is frustum's lateral loop, and ordering it this way is what makes the
# shell orientable. Circle i ends one band and starts the next, so it is used
# backward by one and forward by the other, which is exactly the two opposite
# uses a closed two-manifold needs. Ordering by height instead gives two
# forward uses wherever the profile turns around.
def band_loop(start_circle: U32, end_circle: U32, +seam: U32) -> A.Loop:
  A.Loop{True{}, [T.Use{start_circle, True{}}, T.Use{seam, True{}}, T.Use{end_circle, False{}}, T.Use{seam, False{}}]}

def band(+a: Ring, +b: Ring, +ai: U32, +bi: U32, +seam: U32, +origin: G.Vec3, +axis: G.Vec3, +x: G.Vec3) -> A.Face:
  +rising = R.less(height_of(a), height_of(b))
  +low = Bool.pick(Ring, rising, a, b)
  +high = Bool.pick(Ring, rising, b, a)
  A.Face{band_surface(low, high, origin, axis, x), band_sense(a, b),
    [band_loop(ai, bi, seam)]}

def bands(points: List<&2, Ring>, a: Ring, +first: Ring, +index: U32, +seam: U32, +origin: G.Vec3, +axis: G.Vec3, +x: G.Vec3) -> List<&2, A.Face>:
  match points:
    case Nil{}:
      [band(a, first, index, 0, seam, origin, axis, x)]
    case +b <> rest:
      band(a, b, index, (index + 1 : U32), seam, origin, axis, x)
        <> bands(rest, b, first, (index + 1 : U32), (seam + 1 : U32), origin, axis, x)

# --- entry -----------------------------------------------------------------

def assemble(+head: Ring, +tail: List<&2, Ring>, +count: U32, +origin: G.Vec3, +axis: G.Vec3, +x: G.Vec3) -> A.Solid:
  +profile = {head <> tail : List<&2, Ring>}
  A.Solid{seam_points(profile, origin, axis, x),
    List.append(&2, A.Edge, circle_edges(profile, origin, axis, x, 0),
      seam_edges(tail, head, head, origin, axis, x, 0)),
    bands(tail, head, head, 0, count, origin, axis, x)}

def shell(profile: List<&2, Ring>, +origin: G.Vec3, +axis: G.Vec3, +x: G.Vec3) -> A.Solid:
  match profile:
    case Nil{}:
      A.Solid{Nil{}, Nil{}, Nil{}}
    case +head <> +tail:
      +all = {head <> tail : List<&2, Ring>}
      assemble(head, tail, U32.from_nat(List.length(&2, Ring, all)), origin, axis, x)

def admitted(ok: Bool, +reason: U32, profile: List<&2, Ring>, +origin: G.Vec3, +axis: G.Vec3, +x: G.Vec3) -> Revolved:
  match ok:
    case True{}:
      Swept{shell(profile, origin, axis, x)}
    case False{}:
      Refused{reason}

# `axis` and `x` must be unit length and perpendicular. `tolerance` is the
# caller's linear tolerance; it bounds the shortest admissible segment.
def revolve(+profile: List<&2, Ring>, +tolerance: R.Real, +origin: G.Vec3, +axis: G.Vec3, +x: G.Vec3) -> Revolved:
  +reason = rejection(profile, tolerance)
  admitted(U32.is_eq(reason, 0), reason, profile, origin, axis, x)

# ===========================================================================
# General sweep: line and arc profiles, a partial angle, vertices on the axis
# ===========================================================================
#
# `revolve` above stays exactly as it was (a full turn of a polygon off the
# axis, with seams on every face); its results are relied on. `sweep` is the
# general entry. docs/revolve.md states the construction and the refusals.
#
# The profile is a closed chain of nodes in the half plane (radius, height),
# counterclockwise, material inside. Node i carries the segment from its point
# to the point of node i+1, the last one closing back to node 0: a straight
# line, or an arc about `center`, counterclockwise in (radius, height) when
# `ccw`. A single node carrying an arc is a full circle (a torus profile).
#
# Coordinates are taken as exact. A radius within the tolerance of zero, or a
# straight segment within the tolerance of perpendicular or parallel to the
# axis, is refused rather than snapped (code 9): the caller knows which
# coordinates are meant to be equal and must deliver them equal.
type Segment is Data:
  Straight{}
  Arc{center: Ring, ccw: Bool}

type Node is Data:
  Node{point: Ring, segment: Segment}

# A full turn, or a partial sweep of `angle` radians from `x` about `axis`
# (right hand), 0 < angle < 2 pi.
type Turn is Data:
  Full{}
  Partial{angle: R.Real}

# Refusal codes of `sweep` (0 is never constructed):
#   1  the profile bounds no area (no node, or fewer than three without an arc)
#   2  a point lies across the axis, or an arc touches or crosses the axis
#      between its ends
#   3  a segment (chord), or an arc radius, is not longer than the tolerance
#   4  the profile is not counterclockwise (the swept volume is not positive)
#   5  an arc's end point is not on its circle within the tolerance
#   6  a partial angle outside (0, 2 pi), or within tolerance of either end
#   7  a full turn would pinch: the profile touches the axis at an isolated
#      vertex, so the solid is not a manifold there
#   8  an arc centre lies across the axis (the lemon half of a spindle torus)
#   9  a radius, arc centre radius, or straight segment is within the
#      tolerance of zero, perpendicular or parallel without being exactly so
type Sweep is Data:
  Built{solid: A.Solid, volume: R.Real}
  Declined{reason: U32}

type Shape is Data:
  OnAxis{}
  Flat{}
  Wall{}
  Round{center: Ring, radius: R.Real, ccw: Bool}

type Piece is Data:
  Piece{a: Ring, b: Ring, shape: Shape}

def radius_of(ring: Ring) -> R.Real:
  Ring{radius, _} = ring
  radius

def on_axis(ring: Ring) -> Bool:
  R.equal(radius_of(ring), zero())

def tau() -> R.Real:
  R.mul(R.pi(), R.from_f32(2.0))

# Exact along either coordinate direction, where most sketch arcs start.
def ring_distance(a: Ring, b: Ring) -> R.Real:
  Ring{ar, ah} = a
  Ring{br, bh} = b
  +dr = R.sub(br, ar)
  +dh = R.sub(bh, ah)
  Bool.pick(R.Real, R.equal(dr, zero()), R.abs(dh),
    Bool.pick(R.Real, R.equal(dh, zero()), R.abs(dr), R.sqrt(R.add(R.mul(dr, dr), R.mul(dh, dh)))))

# --- pieces ------------------------------------------------------------------

def classify(segment: Segment, +a: Ring, +b: Ring) -> Shape:
  match segment:
    case Straight{}:
      Bool.pick(Shape, Bool.and(on_axis(a), on_axis(b)), OnAxis{},
        Bool.pick(Shape, R.equal(height_of(a), height_of(b)), Flat{}, Wall{}))
    case Arc{+hub, ccw}:
      Round{hub, ring_distance(hub, a), ccw}

def next_point(rest: List<&2, Node>, first: Ring) -> Ring:
  match rest:
    case Nil{}:
      first
    case Node{point, _} <> _:
      point

def pieces_steps(nodes: List<&2, Node>, +first: Ring) -> List<&2, Piece>:
  match nodes:
    case Nil{}:
      Nil{}
    case Node{+a, segment} <> +rest:
      +b = next_point(rest, first)
      Piece{a, b, classify(segment, a, b)} <> pieces_steps(rest, first)

def first_point(nodes: List<&2, Node>) -> Ring:
  match nodes:
    case Nil{}:
      Ring{zero(), zero()}
    case Node{point, _} <> _:
      point

def pieces(+nodes: List<&2, Node>) -> List<&2, Piece>:
  pieces_steps(nodes, first_point(nodes))

# --- exact volume ------------------------------------------------------------

# V = angle * (closed integral of r^2/2 dh over the profile), Green's theorem
# on the region integral of r dA; a full turn gives Pappus. A line contributes
# dh (ra^2 + ra rb + rb^2) / 6, which is band_volume / (6 pi).
def line_integral(a: Ring, b: Ring) -> R.Real:
  Ring{+ar, ah} = a
  Ring{+br, bh} = b
  R.div(R.mul(R.sub(bh, ah), R.add(R.add(R.mul(ar, ar), R.mul(ar, br)), R.mul(br, br))), R.from_f32(6.0))

# (-2 pi, 2 pi) -> [0, 2 pi)
def wrap(+angle: R.Real) -> R.Real:
  Bool.pick(R.Real, R.less(angle, zero()), R.add(angle, tau()), angle)

def polar(ring: Ring, hub: Ring) -> R.Real:
  Ring{ar, ah} = ring
  Ring{cr, ch} = hub
  R.atan2(R.sub(ah, ch), R.sub(ar, cr))

def same_point(a: Ring, b: Ring) -> Bool:
  Ring{ar, ah} = a
  Ring{br, bh} = b
  Bool.and(R.equal(ar, br), R.equal(ah, bh))

# Signed sweep of an arc about its centre, positive counterclockwise. An arc
# that ends where it starts is a full circle.
def arc_sweep(+a: Ring, +b: Ring, +hub: Ring, +ccw: Bool) -> R.Real:
  +d = wrap(R.sub(polar(b, hub), polar(a, hub)))
  +closed = same_point(a, b)
  Bool.pick(R.Real, ccw, Bool.pick(R.Real, closed, tau(), d),
    R.neg(Bool.pick(R.Real, closed, tau(), R.sub(tau(), d))))

# r = cr + rho cos(t), h = ch + rho sin(t):
#   integral of r^2/2 dh = rho/2 [cr^2 sin t + cr rho (t + sin t cos t)
#                                 + rho^2 (sin t - sin^3 t / 3)]
# between the ends; sin and cos come from the end points, only the linear
# term needs the sweep angle itself.
def arc_integral(a: Ring, b: Ring, hub: Ring, +rho: R.Real, +turned: R.Real) -> R.Real:
  Ring{ar, ah} = a
  Ring{br, bh} = b
  Ring{+cr, +ch} = hub
  +s0 = R.div(R.sub(ah, ch), rho)
  +c0 = R.div(R.sub(ar, cr), rho)
  +s1 = R.div(R.sub(bh, ch), rho)
  +c1 = R.div(R.sub(br, cr), rho)
  +ds = R.sub(s1, s0)
  +cubes = R.div(R.sub(R.mul(s1, R.mul(s1, s1)), R.mul(s0, R.mul(s0, s0))), R.from_f32(3.0))
  +t1 = R.mul(R.mul(cr, cr), ds)
  +t2 = R.mul(R.mul(cr, rho), R.add(turned, R.sub(R.mul(s1, c1), R.mul(s0, c0))))
  +t3 = R.mul(R.mul(rho, rho), R.sub(ds, cubes))
  R.mul(R.div(rho, R.from_f32(2.0)), R.add(t1, R.add(t2, t3)))

def shape_integral(shape: Shape, +a: Ring, +b: Ring) -> R.Real:
  match shape:
    case Round{+hub, rho, ccw}:
      arc_integral(a, b, hub, rho, arc_sweep(a, b, hub, ccw))
    case _:
      line_integral(a, b)

def piece_integral(piece: Piece) -> R.Real:
  Piece{+a, +b, shape} = piece
  shape_integral(shape, a, b)

def profile_integral(parts: List<&2, Piece>) -> R.Real:
  match parts:
    case Nil{}:
      zero()
    case head <> tail:
      R.add(piece_integral(head), profile_integral(tail))

def turn_angle(turn: Turn) -> R.Real:
  match turn:
    case Full{}:
      tau()
    case Partial{angle}:
      angle

def swept_volume(parts: List<&2, Piece>, turn: Turn) -> R.Real:
  R.mul(turn_angle(turn), profile_integral(parts))

# --- admission ---------------------------------------------------------------

def first_code(codes: List<&2, U32>) -> U32:
  match codes:
    case Nil{}:
      0
    case +code <> tail:
      Bool.pick(U32, U32.is_eq(code, 0), first_code(tail), code)

# 0 < |value| <= tolerance
def near_zero(+value: R.Real, +tolerance: R.Real) -> Bool:
  Bool.and(Bool.not(R.equal(value, zero())), Bool.not(R.less(tolerance, R.abs(value))))

def node_code(ring: Ring, +tolerance: R.Real) -> U32:
  +r = radius_of(ring)
  Bool.pick(U32, R.less(r, zero()), 2, Bool.pick(U32, near_zero(r, tolerance), 9, 0))

# The arc touches or crosses the axis between its ends when its circle
# reaches r <= tolerance and the point of the circle nearest the axis (polar
# angle pi) lies strictly inside the swept range, with an angular margin of
# tolerance / rho at either end.
def crossing(+a: Ring, +hub: Ring, +rho: R.Real, +sweep: R.Real, +ccw: Bool, +tolerance: R.Real) -> Bool:
  +lowest = R.sub(radius_of(hub), rho)
  +phi = polar(a, hub)
  +d = wrap(Bool.pick(R.Real, ccw, R.sub(R.pi(), phi), R.sub(phi, R.pi())))
  +margin = R.div(tolerance, rho)
  +inside = Bool.and(R.less(margin, d), R.less(d, R.sub(R.abs(sweep), margin)))
  Bool.and(Bool.not(R.less(tolerance, lowest)), inside)

def round_code(+a: Ring, +b: Ring, +hub: Ring, +rho: R.Real, +ccw: Bool, +tolerance: R.Real, +single: Bool) -> U32:
  +cr = radius_of(hub)
  +chord = ring_distance(a, b)
  +off = R.abs(R.sub(ring_distance(hub, b), rho))
  +full_circle_low = Bool.and(single, Bool.not(R.less(tolerance, R.sub(cr, rho))))
  first_code([
    Bool.pick(U32, R.less(cr, zero()), 8, 0),
    Bool.pick(U32, near_zero(cr, tolerance), 9, 0),
    Bool.pick(U32, R.less(tolerance, rho), 0, 3),
    Bool.pick(U32, R.less(tolerance, off), 5, 0),
    Bool.pick(U32, Bool.and(Bool.not(single), Bool.not(R.less(tolerance, chord))), 3, 0),
    Bool.pick(U32, full_circle_low, 2, 0),
    Bool.pick(U32, Bool.and(Bool.not(single), crossing(a, hub, rho, arc_sweep(a, b, hub, ccw), ccw, tolerance)), 2, 0)])

def straight_code(+a: Ring, +b: Ring, +wall: Bool, +tolerance: R.Real) -> U32:
  +dr = R.sub(radius_of(b), radius_of(a))
  +dh = R.sub(height_of(b), height_of(a))
  +skew = Bool.and(wall, Bool.or(near_zero(dr, tolerance), near_zero(dh, tolerance)))
  first_code([
    Bool.pick(U32, R.less(tolerance, ring_distance(a, b)), 0, 3),
    Bool.pick(U32, skew, 9, 0)])

def shape_code(shape: Shape, +a: Ring, +b: Ring, +tolerance: R.Real, +single: Bool) -> U32:
  match shape:
    case Round{hub, rho, ccw}:
      round_code(a, b, hub, rho, ccw, tolerance, single)
    case Wall{}:
      straight_code(a, b, True{}, tolerance)
    case _:
      straight_code(a, b, False{}, tolerance)

def piece_code(piece: Piece, +tolerance: R.Real, +single: Bool) -> U32:
  Piece{+a, b, shape} = piece
  first_code([node_code(a, tolerance), shape_code(shape, a, b, tolerance, single)])

def pieces_code(parts: List<&2, Piece>, +tolerance: R.Real, +single: Bool) -> U32:
  match parts:
    case Nil{}:
      0
    case head <> tail:
      first_code([piece_code(head, tolerance, single), pieces_code(tail, tolerance, single)])

def is_round(shape: Shape) -> Bool:
  match shape:
    case Round{_, _, _}:
      True{}
    case _:
      False{}

def is_axis(shape: Shape) -> Bool:
  match shape:
    case OnAxis{}:
      True{}
    case _:
      False{}

def any_round(parts: List<&2, Piece>) -> Bool:
  match parts:
    case Nil{}:
      False{}
    case Piece{_, _, shape} <> tail:
      Bool.or(is_round(shape), any_round(tail))

def last_shape_steps(parts: List<&2, Piece>, current: Shape) -> Shape:
  match parts:
    case Nil{}:
      current
    case Piece{_, _, shape} <> tail:
      last_shape_steps(tail, shape)

def last_shape(parts: List<&2, Piece>) -> Shape:
  last_shape_steps(parts, OnAxis{})

# A node on the axis with no axis segment on either side is where a full turn
# pinches the solid to a point.
def pinch_steps(parts: List<&2, Piece>, +previous: Shape) -> U32:
  match parts:
    case Nil{}:
      0
    case Piece{a, _, +shape} <> tail:
      +pinched = Bool.and(on_axis(a), Bool.and(Bool.not(is_axis(previous)), Bool.not(is_axis(shape))))
      first_code([Bool.pick(U32, pinched, 7, 0), pinch_steps(tail, shape)])

def pinch_code(turn: Turn, +parts: List<&2, Piece>) -> U32:
  match turn:
    case Full{}:
      pinch_steps(parts, last_shape(parts))
    case Partial{_}:
      0

def shape_extent(shape: Shape) -> R.Real:
  match shape:
    case Round{hub, rho, _}:
      R.add(radius_of(hub), rho)
    case _:
      zero()

def piece_extent(piece: Piece) -> R.Real:
  Piece{a, b, shape} = piece
  R.max(R.max(radius_of(a), radius_of(b)), shape_extent(shape))

def max_extent(parts: List<&2, Piece>) -> R.Real:
  match parts:
    case Nil{}:
      zero()
    case head <> tail:
      R.max(piece_extent(head), max_extent(tail))

def angle_code(turn: Turn, +parts: List<&2, Piece>, +tolerance: R.Real) -> U32:
  match turn:
    case Full{}:
      0
    case Partial{+angle}:
      +extent = max_extent(parts)
      +ok = Bool.and(Bool.and(R.less(zero(), angle), R.less(angle, tau())),
        Bool.and(R.less(tolerance, R.mul(angle, extent)), R.less(tolerance, R.mul(R.sub(tau(), angle), extent))))
      Bool.pick(U32, ok, 0, 6)

def sweep_rejection(+profile: List<&2, Node>, +parts: List<&2, Piece>, +turn: Turn, +tolerance: R.Real) -> U32:
  +count = U32.from_nat(List.length(&2, Node, profile))
  +enough = Bool.or(U32.is_lt(2, count), Bool.and(U32.is_lt(0, count), any_round(parts)))
  first_code([
    Bool.pick(U32, enough, 0, 1),
    pieces_code(parts, tolerance, U32.is_eq(count, 1)),
    pinch_code(turn, parts),
    angle_code(turn, parts, tolerance),
    Bool.pick(U32, R.less(zero(), profile_integral(parts)), 0, 4)])

# --- placement ---------------------------------------------------------------

# x_end is the radial direction of the end half plane; a full turn ends at x.
type Place is Data:
  Place{origin: G.Vec3, axis: G.Vec3, x: G.Vec3, x_end: G.Vec3, full: Bool}

def make_place(turn: Turn, +origin: G.Vec3, +axis: G.Vec3, +x: G.Vec3) -> Place:
  match turn:
    case Full{}:
      Place{origin, axis, x, x, True{}}
    case Partial{+angle}:
      Place{origin, axis, x, G.add(G.scale(x, R.cos(angle)), G.scale(G.cross(axis, x), R.sin(angle))), False{}}

def place_full(place: Place) -> Bool:
  Place{_, _, _, _, full} = place
  full

def place_axis(place: Place) -> G.Vec3:
  Place{_, axis, _, _, _} = place
  axis

def place_x(place: Place) -> G.Vec3:
  Place{_, _, x, _, _} = place
  x

def direction_at(place: Place, at_end: Bool) -> G.Vec3:
  Place{_, _, x, x_end, _} = place
  Bool.pick(G.Vec3, at_end, x_end, x)

# The point of a ring in the half plane at the start (x) or the end (x_end).
def place_origin(place: Place) -> G.Vec3:
  Place{origin, _, _, _, _} = place
  origin

def lift(ring: Ring, +place: Place, +at_end: Bool) -> G.Vec3:
  Ring{radius, height} = ring
  G.add(G.add(place_origin(place), G.scale(place_axis(place), height)), G.scale(direction_at(place, at_end), radius))

def axis_point(ring: Ring, +place: Place) -> G.Vec3:
  Place{origin, axis, _, _, _} = place
  G.add(origin, G.scale(axis, height_of(ring)))

# --- topology ----------------------------------------------------------------

# Indices of a profile node: its vertex at the start half plane (v0), at the
# end half plane (v1, equal to v0 on the axis and in a full turn) and its
# circle or arc edge (unused on the axis).
type Slot is Data:
  Slot{axial: Bool, v0: U32, v1: U32, circle: U32}

type Parts is Data:
  Parts{vertices: List<&2, G.Vec3>, edges: List<&2, A.Edge>, faces: List<&2, A.Face>,
    starts: List<&2, T.Coedge>, ends: List<&2, T.Coedge>}

def needs_pole(shape: Shape) -> Bool:
  match shape:
    case Wall{}:
      True{}
    case Round{_, _, _}:
      True{}
    case _:
      False{}

# A full turn keeps one vertex per node off the axis (the seam point) and a
# pole or apex on the axis only where a seam ends there; a partial sweep
# keeps two per node off the axis and one on it.
def vertex_count(+axial: Bool, +full: Bool, previous: Shape, next: Shape) -> U32:
  Bool.pick(U32, axial,
    Bool.pick(U32, full, Bool.pick(U32, Bool.or(needs_pole(previous), needs_pole(next)), 1, 0), 1),
    Bool.pick(U32, full, 1, 2))

# Profile edges of a piece: a seam in a full turn (none on planes or the
# axis), the edges at both half planes in a partial sweep (one shared line
# for an axis segment).
def piece_edge_count(shape: Shape, +full: Bool) -> U32:
  match shape:
    case OnAxis{}:
      Bool.pick(U32, full, 0, 1)
    case Flat{}:
      Bool.pick(U32, full, 0, 2)
    case _:
      Bool.pick(U32, full, 1, 2)

def next_slot(rest: List<&2, Piece>, +first: Slot, +axial: Bool, +full: Bool, +vertex: U32, +edge: U32) -> Slot:
  match rest:
    case Nil{}:
      first
    case _:
      Slot{axial, vertex, (vertex + Bool.pick(U32, Bool.or(full, axial), 0, 1) : U32), edge}

def node_vertices(+a: Ring, +count: U32, +place: Place) -> List<&2, G.Vec3>:
  Bool.pick(List<&2, G.Vec3>, U32.is_eq(count, 0), Nil{},
    Bool.pick(List<&2, G.Vec3>, U32.is_eq(count, 1), [lift(a, place, False{})],
      [lift(a, place, False{}), lift(a, place, True{})]))

# The circle of a node about the axis, starting on x: closed at v0 in a full
# turn, the arc from v0 to v1 in a partial sweep.
def node_edges(+slot: Slot, +a: Ring, +place: Place) -> List<&2, A.Edge>:
  Slot{axial, v0, v1, _} = slot
  Bool.pick(List<&2, A.Edge>, axial, Nil{},
    [A.Edge{v0, v1, A.Circle{axis_point(a, place), place_axis(place), place_x(place), radius_of(a)}, True{}}])

def line_edge(+a: Ring, +b: Ring, start: U32, end: U32, +place: Place, +at_end: Bool) -> A.Edge:
  +p = lift(a, place, at_end)
  +q = lift(b, place, at_end)
  A.Edge{start, end, A.Line{p, G.normalize(G.sub(q, p))}, True{}}

# The profile arc in its half plane. With normal = direction x axis the
# circle's parameter is the polar angle in (radius, height), so the edge runs
# counterclockwise in the profile exactly when same_sense.
def arc_edge(+hub: Ring, +rho: R.Real, +ccw: Bool, start: U32, end: U32, +place: Place, +at_end: Bool) -> A.Edge:
  +direction = direction_at(place, at_end)
  A.Edge{start, end, A.Circle{lift(hub, place, at_end), G.cross(direction, place_axis(place)), direction, rho}, ccw}

def slot_v0(slot: Slot) -> U32:
  Slot{_, v0, _, _} = slot
  v0

def slot_v1(slot: Slot) -> U32:
  Slot{_, _, v1, _} = slot
  v1

def piece_edges(shape: Shape, +a: Ring, +b: Ring, +sa: Slot, +sb: Slot, +place: Place) -> List<&2, A.Edge>:
  match shape:
    case Round{+hub, +rho, +ccw}:
      +start = arc_edge(hub, rho, ccw, slot_v0(sa), slot_v0(sb), place, False{})
      Bool.pick(List<&2, A.Edge>, place_full(place), [start],
        [start, arc_edge(hub, rho, ccw, slot_v1(sa), slot_v1(sb), place, True{})])
    case OnAxis{}:
      Bool.pick(List<&2, A.Edge>, place_full(place), Nil{}, [line_edge(a, b, slot_v0(sa), slot_v0(sb), place, False{})])
    case Flat{}:
      Bool.pick(List<&2, A.Edge>, place_full(place), Nil{},
        [line_edge(a, b, slot_v0(sa), slot_v0(sb), place, False{}), line_edge(a, b, slot_v1(sa), slot_v1(sb), place, True{})])
    case Wall{}:
      +start = line_edge(a, b, slot_v0(sa), slot_v0(sb), place, False{})
      Bool.pick(List<&2, A.Edge>, place_full(place), [start],
        [start, line_edge(a, b, slot_v1(sa), slot_v1(sb), place, True{})])

# --- faces -------------------------------------------------------------------

# Cylinder or cone through two rings, built from the lower ring upward as
# band_surface does, except that a cone is never anchored at its apex (a
# zero reference radius): it is then anchored at the other ring.
def wall_surface(+a: Ring, +b: Ring, +place: Place) -> A.Surface:
  +rising = R.less(height_of(a), height_of(b))
  +low = Bool.pick(Ring, rising, a, b)
  +high = Bool.pick(Ring, rising, b, a)
  +r0 = radius_of(low)
  +r1 = radius_of(high)
  +bottom = axis_point(low, place)
  +top = axis_point(high, place)
  +height = R.sub(height_of(high), height_of(low))
  +axis = place_axis(place)
  +down = G.scale(axis, R.from_f32(F32.neg(1.0)))
  +x = place_x(place)
  +widening = R.atan(R.div(R.sub(r1, r0), height))
  +narrowing = R.atan(R.div(R.sub(r0, r1), height))
  Bool.pick(A.Surface, R.equal(r0, r1), A.Cylinder{bottom, axis, x, r0},
    Bool.pick(A.Surface, R.less(r0, r1),
      Bool.pick(A.Surface, R.equal(r0, zero()), A.Cone{top, axis, x, r1, widening}, A.Cone{bottom, axis, x, r0, widening}),
      Bool.pick(A.Surface, R.equal(r1, zero()), A.Cone{bottom, down, x, r0, narrowing}, A.Cone{top, down, x, r1, narrowing})))

# An arc centred on the axis sweeps a sphere, any other a torus whose tube
# centre circle is the arc centre swept about the axis.
def round_surface(+hub: Ring, +rho: R.Real, +place: Place) -> A.Surface:
  +cr = radius_of(hub)
  +origin = axis_point(hub, place)
  Bool.pick(A.Surface, R.equal(cr, zero()),
    A.Sphere{origin, place_axis(place), place_x(place), rho},
    A.Torus{origin, place_axis(place), place_x(place), cr, rho})

# The lateral loop of legacy `band_loop`, generalised: the start node's
# circle or arc forward (absent on the axis), the profile edge at the end half
# plane forward, the end node's circle backward (absent on the axis), the
# profile edge at the start half plane backward. In a full turn both profile
# edges are the one seam.
def band_loop_uses(+sa: Slot, +sb: Slot, +e0: U32, +e1: U32) -> A.Loop:
  Slot{axial_a, _, _, ca} = sa
  Slot{axial_b, _, _, cb} = sb
  +front = Bool.pick(List<&2, T.Coedge>, axial_a, [T.Use{e1, True{}}], [T.Use{ca, True{}}, T.Use{e1, True{}}])
  +back = Bool.pick(List<&2, T.Coedge>, axial_b, [T.Use{e0, False{}}], [T.Use{cb, False{}}, T.Use{e0, False{}}])
  A.Loop{True{}, List.append(&2, T.Coedge, front, back)}

# A plane perpendicular to the axis in a full turn is an annulus or a disc
# bounded by circles alone, with no seam: the outer circle is the outer loop.
def flat_loops(+a: Ring, +b: Ring, +sa: Slot, +sb: Slot) -> List<&2, A.Loop>:
  Slot{+axial_a, _, _, +ca} = sa
  Slot{+axial_b, _, _, +cb} = sb
  +a_outer = R.less(radius_of(b), radius_of(a))
  Bool.pick(List<&2, A.Loop>, axial_a, [A.Loop{True{}, [T.Use{cb, False{}}]}],
    Bool.pick(List<&2, A.Loop>, axial_b, [A.Loop{True{}, [T.Use{ca, True{}}]}],
      Bool.pick(List<&2, A.Loop>, a_outer,
        [A.Loop{True{}, [T.Use{ca, True{}}]}, A.Loop{False{}, [T.Use{cb, False{}}]}],
        [A.Loop{True{}, [T.Use{cb, False{}}]}, A.Loop{False{}, [T.Use{ca, True{}}]}])))

# Face senses follow legacy band_sense for lines; an arc has material toward
# its centre exactly when it runs counterclockwise, which is where the sphere
# and torus normals (away from the centre) point outward.
def piece_faces(shape: Shape, +a: Ring, +b: Ring, +sa: Slot, +sb: Slot, +e0: U32, +e1: U32, +place: Place) -> List<&2, A.Face>:
  match shape:
    case OnAxis{}:
      Nil{}
    case Flat{}:
      +loops = Bool.pick(List<&2, A.Loop>, place_full(place), flat_loops(a, b, sa, sb), [band_loop_uses(sa, sb, e0, e1)])
      [A.Face{A.Plane{axis_point(a, place), place_axis(place), place_x(place)}, R.less(radius_of(b), radius_of(a)), loops}]
    case Wall{}:
      [A.Face{wall_surface(a, b, place), R.less(height_of(a), height_of(b)), [band_loop_uses(sa, sb, e0, e1)]}]
    case Round{hub, rho, ccw}:
      [A.Face{round_surface(hub, rho, place), ccw, [band_loop_uses(sa, sb, e0, e1)]}]

def join(here: Parts, rest: Parts) -> Parts:
  Parts{v, e, f, s, n} = here
  Parts{rv, re, rf, rs, rn} = rest
  Parts{List.append(&2, G.Vec3, v, rv), List.append(&2, A.Edge, e, re), List.append(&2, A.Face, f, rf),
    List.append(&2, T.Coedge, s, rs), List.append(&2, T.Coedge, n, rn)}

# One node (vertices and circle of the piece's start) and one piece (its
# profile edges and face) per step. `previous` is the shape of the piece that
# ends at this node, which decides whether a node on the axis needs a pole.
def build(parts: List<&2, Piece>, +previous: Shape, +first: Slot, +nv: U32, +ne: U32, +place: Place) -> Parts:
  match parts:
    case Nil{}:
      Parts{Nil{}, Nil{}, Nil{}, Nil{}, Nil{}}
    case Piece{+a, +b, +shape} <> +rest:
      +full = place_full(place)
      +axial = on_axis(a)
      +count = vertex_count(axial, full, previous, shape)
      +sa = {Slot{axial, nv, (nv + Bool.pick(U32, U32.is_eq(count, 2), 1, 0) : U32), ne} : Slot}
      +e0 = (ne + Bool.pick(U32, axial, 0, 1) : U32)
      +edges = piece_edge_count(shape, full)
      +e1 = (e0 + Bool.pick(U32, U32.is_eq(edges, 2), 1, 0) : U32)
      +nv1 = (nv + count : U32)
      +ne1 = (e0 + edges : U32)
      +sb = next_slot(rest, first, on_axis(b), full, nv1, ne1)
      +here = {Parts{node_vertices(a, count, place),
        List.append(&2, A.Edge, node_edges(sa, a, place), piece_edges(shape, a, b, sa, sb, place)),
        piece_faces(shape, a, b, sa, sb, e0, e1, place),
        [T.Use{e0, True{}}], [T.Use{e1, False{}}]} : Parts}
      join(here, build(rest, shape, first, nv1, ne1, place))

def first_slot(parts: List<&2, Piece>, +full: Bool) -> Slot:
  match parts:
    case Nil{}:
      Slot{True{}, 0, 0, 0}
    case Piece{a, _, _} <> _:
      +axial = on_axis(a)
      Slot{axial, 0, Bool.pick(U32, Bool.or(full, axial), 0, 1), 0}

# The two half planes of a partial sweep. Material lies at angles between 0
# and the sweep, so the start plane faces -(axis x x) and the end plane
# +(axis x x_end). The start loop is the profile in order (counterclockwise
# about the outward normal), the end loop the profile reversed.
def side_faces(+full: Bool, starts: List<&2, T.Coedge>, ends: List<&2, T.Coedge>, +place: Place) -> List<&2, A.Face>:
  Place{+origin, +axis, +x, +x_end, _} = place
  Bool.pick(List<&2, A.Face>, full, Nil{},
    [A.Face{A.Plane{origin, G.cross(axis, x), x}, False{}, [A.Loop{True{}, starts}]},
     A.Face{A.Plane{origin, G.cross(axis, x_end), x_end}, True{}, [A.Loop{True{}, List.reverse(&2, T.Coedge, ends)}]}])

def close_solid(result: Parts, +full: Bool, +spot: Place) -> A.Solid:
  Parts{vertices, edges, faces, starts, ends} = result
  A.Solid{vertices, edges, List.append(&2, A.Face, faces, side_faces(full, starts, ends, spot))}

def sweep_solid(+parts: List<&2, Piece>, turn: Turn, +origin: G.Vec3, +axis: G.Vec3, +x: G.Vec3) -> A.Solid:
  +spot = make_place(turn, origin, axis, x)
  +full = place_full(spot)
  close_solid(build(parts, last_shape(parts), first_slot(parts, full), 0, 0, spot), full, spot)

def sweep_admitted(ok: Bool, +reason: U32, +parts: List<&2, Piece>, +turn: Turn, +origin: G.Vec3, +axis: G.Vec3, +x: G.Vec3) -> Sweep:
  match ok:
    case True{}:
      Built{sweep_solid(parts, turn, origin, axis, x), swept_volume(parts, turn)}
    case False{}:
      Declined{reason}

# `axis` and `x` must be unit length and perpendicular; `tolerance` is the
# caller's linear tolerance.
def sweep(+profile: List<&2, Node>, +turn: Turn, +tolerance: R.Real, +origin: G.Vec3, +axis: G.Vec3, +x: G.Vec3) -> Sweep:
  +parts = pieces(profile)
  +reason = sweep_rejection(profile, parts, turn, tolerance)
  sweep_admitted(U32.is_eq(reason, 0), reason, parts, turn, origin, axis, x)

# The exact volume alone (the same number `Built` carries), for callers that
# measure without building.
def sweep_volume(+profile: List<&2, Node>, turn: Turn) -> R.Real:
  swept_volume(pieces(profile), turn)
