import Base
import ./precise.bend as G
import ./real.bend as R
import ./analytic.bend as A
import ./topology.bend as T

# A round through hole in a planar body: the one operation that stands between
# this kernel and an ordinary part. A bolt hole, a cable gland, a screw boss
# clearance and a counterbore pilot are all this.
#
# It is deliberately not a general Boolean. The tool is a cylinder whose axis
# is perpendicular to exactly two of the target's faces, and whose circle
# clears every boundary edge of both by more than the tolerance. Inside that
# admission the result is exact and needs no surface intersection at all: the
# two pierced faces each gain an inner loop, and one cylindrical wall joins
# them. Outside it, `pierce` declines and the caller must refuse rather than
# approximate.
#
# The loop conventions are read off the coaxial bore this kernel already
# builds correctly, not re-derived: a hole loop runs against its face's outer
# loop, so it takes the circle forward on a face whose same_sense is false and
# backward on one whose same_sense is true; and the bore wall faces the axis,
# so its same_sense is false.
type Pierced is Data:
  Bored{solid: A.Solid}
  Declined{reason: U32}

# Decline codes.
#   1  the target is not an all-planar body with straight edges
#   2  the axis is not perpendicular to exactly two faces
#   3  the two faces lie at the same height, so nothing is pierced
#   4  the hole does not clear a boundary edge of a face it pierces
#   5  the radius is not positive
#   6  the tool does not reach through both pierced faces
#   7  the hole is not in material on a face it would pierce
#   8  the two pierced faces look the same way, so nothing lies between them
def zero() -> R.Real:
  R.from_f32(0.0)

def plane_normal(surface: A.Surface) -> G.Vec3:
  match surface:
    case A.Plane{_, normal, _}:
      normal
    case _:
      G.v3(0.0, 0.0, 0.0)

def plane_origin(surface: A.Surface) -> G.Vec3:
  match surface:
    case A.Plane{origin, _, _}:
      origin
    case _:
      G.v3(0.0, 0.0, 0.0)

def is_plane(surface: A.Surface) -> Bool:
  match surface:
    case A.Plane{_, _, _}:
      True{}
    case _:
      False{}

def is_line(curve: A.Curve) -> Bool:
  match curve:
    case A.Line{_, _}:
      True{}
    case _:
      False{}

def is_cylinder(surface: A.Surface) -> Bool:
  match surface:
    case A.Cylinder{_, _, _, _}:
      True{}
    case _:
      False{}

def is_circle(curve: A.Curve) -> Bool:
  match curve:
    case A.Circle{_, _, _, _}:
      True{}
    case _:
      False{}

# A target may already carry holes. Their walls are cylinders and their rims
# are circles, so demanding an all-planar body refused every second hole: a
# plate with four mounting holes, the ordinary case, could not be built. Only
# the faces the tool actually pierces still have to be planar, and
# perpendicular() already insists on that.
def admitted_faces(faces: List<&2, A.Face>) -> Bool:
  match faces:
    case Nil{}:
      True{}
    case A.Face{+surface, _, _} <> tail:
      Bool.and(Bool.or(is_plane(surface), is_cylinder(surface)), admitted_faces(tail))

def admitted_edges(edges: List<&2, A.Edge>) -> Bool:
  match edges:
    case Nil{}:
      True{}
    case A.Edge{_, _, +curve, _} <> tail:
      Bool.and(Bool.or(is_line(curve), is_circle(curve)), admitted_edges(tail))

# --- geometry ---------------------------------------------------------------

def length_of(+v: G.Vec3) -> R.Real:
  R.sqrt(G.dot(v, v))

# A face is pierced when its plane normal is parallel to the axis. Both are
# unit length here, so the cross product measures the sine of the angle
# between them directly.
def perpendicular(+surface: A.Surface, +axis: G.Vec3, +tolerance: R.Real) -> Bool:
  Bool.and(is_plane(surface), R.less(length_of(G.cross(plane_normal(surface), axis)), tolerance))

def clamp01(+t: R.Real) -> R.Real:
  Bool.pick(R.Real, R.less(t, zero()), zero(),
    Bool.pick(R.Real, R.less(R.from_f32(1.0), t), R.from_f32(1.0), t))

# Distance from a point to a segment, clamped at the ends so a hole near a
# corner is measured against the corner and not against the edge's infinite
# line, which would let it run off the face.
def segment_distance(+p: G.Vec3, +a: G.Vec3, +b: G.Vec3) -> R.Real:
  +d = G.sub(b, a)
  +dd = G.dot(d, d)
  +t = Bool.pick(R.Real, R.equal(dd, zero()), zero(), clamp01(R.div(G.dot(G.sub(p, a), d), dd)))
  length_of(G.sub(p, G.add(a, G.scale(d, t))))

# An existing hole's rim is a circle, and the new one has to clear the whole
# of it: centres farther apart than the two radii and the margin together.
def edge_clears(edge: A.Edge, +vertices: List<&2, G.Vec3>, +centre: G.Vec3, +reach: R.Real) -> Bool:
  A.Edge{start, end, curve, _} = edge
  match curve:
    case A.Line{_, _}:
      R.less(reach, segment_distance(centre, A.vertex_at(vertices, start), A.vertex_at(vertices, end)))
    case A.Circle{origin, _, _, radius}:
      R.less(R.add(reach, radius), length_of(G.sub(centre, origin)))
    case A.Ellipse{_, _, _, _, _}:
      False{}

def use_clears(use: T.Coedge, +vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>, +centre: G.Vec3, +reach: R.Real) -> Bool:
  T.Use{index, _} = use
  edge_clears(A.edge_at(edges, index), vertices, centre, reach)

def uses_clear(uses: List<&2, T.Coedge>, +vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>, +centre: G.Vec3, +reach: R.Real) -> Bool:
  match uses:
    case Nil{}:
      True{}
    case use <> tail:
      Bool.and(use_clears(use, vertices, edges, centre, reach), uses_clear(tail, vertices, edges, centre, reach))

def loops_clear(loops: List<&2, A.Loop>, +vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>, +centre: G.Vec3, +reach: R.Real) -> Bool:
  match loops:
    case Nil{}:
      True{}
    case A.Loop{_, uses} <> tail:
      Bool.and(uses_clear(uses, vertices, edges, centre, reach), loops_clear(tail, vertices, edges, centre, reach))

# Where the axis meets a face's plane, which is the hole's centre on it.
def puncture(+surface: A.Surface, +origin: G.Vec3, +axis: G.Vec3) -> G.Vec3:
  +normal = plane_normal(surface)
  +offset = G.dot(G.sub(plane_origin(surface), origin), normal)
  G.add(origin, G.scale(axis, R.div(offset, G.dot(axis, normal))))

# --- admission --------------------------------------------------------------

def pierced_count(faces: List<&2, A.Face>, +axis: G.Vec3, +tolerance: R.Real, +total: U32) -> U32:
  match faces:
    case Nil{}:
      total
    case A.Face{+surface, _, _} <> tail:
      pierced_count(tail, axis, tolerance, (total + Bool.pick(U32, perpendicular(surface, axis, tolerance), 1, 0) : U32))

def faces_clear(faces: List<&2, A.Face>, +vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>, +origin: G.Vec3, +axis: G.Vec3, +radius: R.Real, +tolerance: R.Real) -> Bool:
  match faces:
    case Nil{}:
      True{}
    case +face <> tail:
      A.Face{+surface, _, loops} = face
      +rest = faces_clear(tail, vertices, edges, origin, axis, radius, tolerance)
      Bool.pick(Bool, perpendicular(surface, axis, tolerance),
        Bool.and(loops_clear(loops, vertices, edges, puncture(surface, origin, axis), R.add(radius, tolerance)), rest),
        rest)

# The two pierced faces must sit at different heights along the axis, or the
# tool grazes a single face instead of passing through the body.
def separation(faces: List<&2, A.Face>, +axis: G.Vec3, +tolerance: R.Real, +low: R.Real, +high: R.Real, +seen: Bool) -> R.Real:
  match faces:
    case Nil{}:
      R.sub(high, low)
    case A.Face{+surface, _, _} <> tail:
      +here = G.dot(plane_origin(surface), axis)
      +hit = perpendicular(surface, axis, tolerance)
      +first = Bool.and(hit, Bool.not(seen))
      separation(tail, axis, tolerance,
        Bool.pick(R.Real, first, here, Bool.pick(R.Real, hit, R.min(low, here), low)),
        Bool.pick(R.Real, first, here, Bool.pick(R.Real, hit, R.max(high, here), high)),
        Bool.or(seen, hit))

def pierced_low(faces: List<&2, A.Face>, +axis: G.Vec3, +tolerance: R.Real, +low: R.Real, +seen: Bool) -> R.Real:
  match faces:
    case Nil{}:
      low
    case A.Face{+surface, _, _} <> tail:
      +here = G.dot(plane_origin(surface), axis)
      +hit = perpendicular(surface, axis, tolerance)
      +first = Bool.and(hit, Bool.not(seen))
      pierced_low(tail, axis, tolerance,
        Bool.pick(R.Real, first, here, Bool.pick(R.Real, hit, R.min(low, here), low)), Bool.or(seen, hit))


def pierced_high(faces: List<&2, A.Face>, +axis: G.Vec3, +tolerance: R.Real, +high: R.Real, +seen: Bool) -> R.Real:
  match faces:
    case Nil{}:
      high
    case A.Face{+surface, _, _} <> tail:
      +here = G.dot(plane_origin(surface), axis)
      +hit = perpendicular(surface, axis, tolerance)
      +first = Bool.and(hit, Bool.not(seen))
      pierced_high(tail, axis, tolerance,
        Bool.pick(R.Real, first, here, Bool.pick(R.Real, hit, R.max(high, here), high)), Bool.or(seen, hit))

# A hole loop must run clockwise seen from outside the material, so it takes
# its circle forward exactly when the face looks the other way down the axis.
# The test is against the face's OUTWARD direction and not against same_sense:
# the two representations this kernel produces disagree on the flag while
# agreeing on the geometry. A coaxial bore stores both caps with the same plane
# normal and separates them by same_sense, whereas a planar body stores each
# cap with its own normal and leaves same_sense true on both. Keying on the
# flag happens to suit the first and silently gives a doubled edge use on the
# second.

# A tool that stops inside the body leaves a blind pocket with a floor this
# operation does not build, so it is declined rather than cut as if it went
# through. Without this a tool reaching one millimetre into a five millimetre
# plate still produced a full through hole.
def spans(+faces: List<&2, A.Face>, +axis: G.Vec3, +tolerance: R.Real, +tool_low: R.Real, +tool_high: R.Real) -> Bool:
  +low = pierced_low(faces, axis, tolerance, zero(), False{})
  +high = pierced_high(faces, axis, tolerance, zero(), False{})
  Bool.and(Bool.not(R.less(R.add(low, tolerance), tool_low)),
    Bool.not(R.less(tool_high, R.sub(high, tolerance))))

def differs(a: Bool, +b: Bool) -> Bool:
  Bool.pick(Bool, a, Bool.not(b), b)

def plane_x(surface: A.Surface) -> G.Vec3:
  match surface:
    case A.Plane{_, _, x}:
      x
    case _:
      G.v3(1.0, 0.0, 0.0)

# Is the puncture point in material on this face? Clearance alone never asked:
# being farther than the radius from every boundary segment is just as true far
# OUTSIDE the outline as inside it, so a tool anywhere off the plate was
# admitted and a cylindrical wall invented where there was nothing. A sweep
# across a 40 mm plate declined only the narrow band where the circle straddled
# an edge and admitted everything beyond, up to a tool a kilometre away that
# still reported 251 mm3 removed.
#
# Even-odd crossings of a ray in the face's own x direction. Counting across
# ALL loops settles inner loops for free: a point inside an existing hole
# crosses that hole's boundary once more and comes out even.
def crosses(+a: G.Vec3, +b: G.Vec3, +p: G.Vec3, +ex: G.Vec3, +ey: G.Vec3) -> Bool:
  +ay = G.dot(G.sub(a, p), ey)
  +by = G.dot(G.sub(b, p), ey)
  +straddles = differs(R.less(ay, zero()), R.less(by, zero()))
  +ax = G.dot(G.sub(a, p), ex)
  +bx = G.dot(G.sub(b, p), ex)
  +t = R.div(R.neg(ay), R.sub(by, ay))
  Bool.and(straddles, R.less(zero(), R.add(ax, R.mul(t, R.sub(bx, ax)))))

# A ray from p crosses a FULL circle exactly once when p lies inside it, and
# either twice or not at all otherwise -- so for a parity count the circle
# contributes precisely the point-in-circle test, with no sampling. Without
# this an existing hole's rim contributed nothing (its edge has start == end,
# so the segment test never straddles) and a point inside an old hole read as
# in material, which is where a second bore would have been allowed to open
# into the first.
def edge_crosses(edge: A.Edge, +vertices: List<&2, G.Vec3>, +p: G.Vec3, +ex: G.Vec3, +ey: G.Vec3) -> Bool:
  A.Edge{start, end, curve, _} = edge
  match curve:
    case A.Line{_, _}:
      crosses(A.vertex_at(vertices, start), A.vertex_at(vertices, end), p, ex, ey)
    case A.Circle{origin, _, _, radius}:
      R.less(length_of(G.sub(p, origin)), radius)
    case A.Ellipse{_, _, _, _, _}:
      False{}

def use_crosses(use: T.Coedge, +vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>, +p: G.Vec3, +ex: G.Vec3, +ey: G.Vec3) -> Bool:
  T.Use{index, _} = use
  edge_crosses(A.edge_at(edges, index), vertices, p, ex, ey)

def uses_parity(uses: List<&2, T.Coedge>, +vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>, +p: G.Vec3, +ex: G.Vec3, +ey: G.Vec3, +state: Bool) -> Bool:
  match uses:
    case Nil{}:
      state
    case use <> tail:
      uses_parity(tail, vertices, edges, p, ex, ey, differs(state, use_crosses(use, vertices, edges, p, ex, ey)))

def loops_parity(loops: List<&2, A.Loop>, +vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>, +p: G.Vec3, +ex: G.Vec3, +ey: G.Vec3, +state: Bool) -> Bool:
  match loops:
    case Nil{}:
      state
    case A.Loop{_, uses} <> tail:
      loops_parity(tail, vertices, edges, p, ex, ey, uses_parity(uses, vertices, edges, p, ex, ey, state))

def faces_contain(faces: List<&2, A.Face>, +vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>, +origin: G.Vec3, +axis: G.Vec3, +tolerance: R.Real) -> Bool:
  match faces:
    case Nil{}:
      True{}
    case +face <> tail:
      A.Face{+surface, _, loops} = face
      +rest = faces_contain(tail, vertices, edges, origin, axis, tolerance)
      +ex = plane_x(surface)
      +ey = G.cross(plane_normal(surface), ex)
      Bool.pick(Bool, perpendicular(surface, axis, tolerance),
        Bool.and(loops_parity(loops, vertices, edges, puncture(surface, origin, axis), ex, ey, False{}), rest),
        rest)

# The two pierced faces must look opposite ways along the axis. Nothing said
# so, and bored_face derives a hole's direction from the face's outward alone:
# two caps facing the SAME way both take their circle backward, leaving the
# entry circle with two backward uses and no forward one. A prism with a
# slanted underside and a stepped top has exactly two Z-perpendicular faces
# both pointing up, and asking for a hole between them is meaningless anyway --
# there is no material on one side of either.
def facing_up(faces: List<&2, A.Face>, +axis: G.Vec3, +tolerance: R.Real, +total: U32) -> U32:
  match faces:
    case Nil{}:
      total
    case A.Face{+surface, sense, _} <> tail:
      +along = G.dot(plane_normal(surface), axis)
      +outward = Bool.pick(R.Real, sense, along, R.neg(along))
      +up = Bool.and(perpendicular(surface, axis, tolerance), R.less(zero(), outward))
      facing_up(tail, axis, tolerance, (total + Bool.pick(U32, up, 1, 0) : U32))

def decline(+target: A.Solid, +origin: G.Vec3, +axis: G.Vec3, +radius: R.Real, +tool_low: R.Real, +tool_high: R.Real, +tolerance: R.Real) -> U32:
  A.Solid{+vertices, +edges, +faces} = target
  +shape = Bool.and(admitted_faces(faces), admitted_edges(edges))
  +count = pierced_count(faces, axis, tolerance, 0)
  +apart = R.less(tolerance, separation(faces, axis, tolerance, zero(), zero(), False{}))
  +clear = faces_clear(faces, vertices, edges, origin, axis, radius, tolerance)
  +through = spans(faces, axis, tolerance, tool_low, tool_high)
  +within = faces_contain(faces, vertices, edges, origin, axis, tolerance)
  +opposed = U32.is_eq(facing_up(faces, axis, tolerance, 0), 1)
  Bool.pick(U32, R.less(zero(), radius),
    Bool.pick(U32, shape,
      Bool.pick(U32, U32.is_eq(count, 2), Bool.pick(U32, opposed,
        Bool.pick(U32, apart,
          Bool.pick(U32, within, Bool.pick(U32, clear, Bool.pick(U32, through, 0, 6), 4), 7), 3), 8), 2), 1), 5)

# --- construction -----------------------------------------------------------

def face_surface(face: A.Face) -> A.Surface:
  A.Face{surface, _, _} = face
  surface

def bored_face(+face: A.Face, +entry_edge: U32, +exit_edge: U32, +entry_height: R.Real, +axis: G.Vec3, +tolerance: R.Real) -> A.Face:
  A.Face{+surface, +sense, loops} = face
  +here = G.dot(plane_origin(surface), axis)
  +at_entry = R.less(R.abs(R.sub(here, entry_height)), tolerance)
  +along = G.dot(plane_normal(surface), axis)
  +outward = Bool.pick(R.Real, sense, along, R.neg(along))
  +hole = {A.Loop{False{},
    [T.Use{Bool.pick(U32, at_entry, entry_edge, exit_edge), R.less(outward, zero())}]} : A.Loop}
  A.Face{surface, sense, List.append(&2, A.Loop, loops, [hole])}

def bored_faces(faces: List<&2, A.Face>, +entry_edge: U32, +exit_edge: U32, +entry_height: R.Real, +axis: G.Vec3, +tolerance: R.Real) -> List<&2, A.Face>:
  match faces:
    case Nil{}:
      Nil{}
    case +face <> tail:
      Bool.pick(A.Face, perpendicular(face_surface(face), axis, tolerance),
        bored_face(face, entry_edge, exit_edge, entry_height, axis, tolerance), face)
        <> bored_faces(tail, entry_edge, exit_edge, entry_height, axis, tolerance)

# The planar classification input stores an edge's raw span as its line
# direction, which the planar Boolean never reads. An analytic body requires
# unit directions, so they are normalised here rather than left for a validator
# to reject after the hole is already cut.
def unit_curve(curve: A.Curve) -> A.Curve:
  match curve:
    case A.Line{origin, direction}:
      A.Line{origin, G.normalize(direction)}
    case A.Circle{origin, normal, x, radius}:
      A.Circle{origin, normal, x, radius}
    case A.Ellipse{origin, normal, x, major, minor}:
      A.Ellipse{origin, normal, x, major, minor}

def unit_edges(edges: List<&2, A.Edge>) -> List<&2, A.Edge>:
  match edges:
    case Nil{}:
      Nil{}
    case A.Edge{start, end, curve, sense} <> tail:
      A.Edge{start, end, unit_curve(curve), sense} <> unit_edges(tail)

# The exact point where the axis meets a pierced cap, and that cap's own
# normal. bore() used to place the circle centres from the axis height alone,
# which satisfies dot(p, AXIS) = height but NOT dot(p, NORMAL) = plane height:
# perpendicular() admits a small angle between them, so on a tilted plate the
# circles landed 6.3e-7 mm off their own cap planes and curved-validate refused
# the body at five orders of magnitude over budget. puncture() was already in
# this file and already used by admission; construction simply did not use it.
#
# Taking the axis from the cap as well removes the mismatch entirely rather
# than shrinking it: circles, wall and caps then share one direction, and the
# tool's own axis only has to be parallel to it within the admission.
def cap_puncture(faces: List<&2, A.Face>, +axis: G.Vec3, +ray: G.Vec3, +tolerance: R.Real, +height: R.Real, +origin: G.Vec3) -> G.Vec3:
  match faces:
    case Nil{}:
      origin
    case +face <> tail:
      A.Face{+surface, _, _} = face
      +here = G.dot(plane_origin(surface), axis)
      +hit = Bool.and(perpendicular(surface, axis, tolerance), R.less(R.abs(R.sub(here, height)), tolerance))
      Bool.pick(G.Vec3, hit, puncture(surface, origin, ray),
        cap_puncture(tail, axis, ray, tolerance, height, origin))

def cap_normal(faces: List<&2, A.Face>, +axis: G.Vec3, +tolerance: R.Real, +height: R.Real) -> G.Vec3:
  match faces:
    case Nil{}:
      axis
    case +face <> tail:
      A.Face{+surface, _, _} = face
      +here = G.dot(plane_origin(surface), axis)
      +hit = Bool.and(perpendicular(surface, axis, tolerance), R.less(R.abs(R.sub(here, height)), tolerance))
      +n = plane_normal(surface)
      Bool.pick(G.Vec3, hit,
        Bool.pick(G.Vec3, R.less(G.dot(n, axis), zero()), G.scale(n, R.from_f32(F32.neg(1.0))), n),
        cap_normal(tail, axis, tolerance, height))

def bore(+target: A.Solid, +origin: G.Vec3, +axis: G.Vec3, +radius: R.Real, +tolerance: R.Real) -> A.Solid:
  A.Solid{+vertices, +edges, +faces} = target
  +nv = U32.from_nat(List.length(&2, G.Vec3, vertices))
  +ne = U32.from_nat(List.length(&2, A.Edge, edges))
  +low = pierced_low(faces, axis, tolerance, zero(), False{})
  +high = pierced_high(faces, axis, tolerance, zero(), False{})
  # Everything is built on the cap's own direction, not the tool's. The tool
  # only has to be parallel to it within the admission, and then the circles
  # lie exactly in the planes they bound instead of near them.
  +normal = cap_normal(faces, axis, tolerance, low)
  +x = A.axis_x(normal)
  +entry = cap_puncture(faces, axis, normal, tolerance, low, origin)
  +exit = cap_puncture(faces, axis, normal, tolerance, high, origin)
  +p = G.add(entry, G.scale(x, radius))
  +q = G.add(exit, G.scale(x, radius))
  +wall = {A.Face{A.Cylinder{entry, normal, x, radius}, False{},
    [A.Loop{True{}, [T.Use{ne, False{}}, T.Use{(ne + 2 : U32), True{}},
      T.Use{(ne + 1 : U32), True{}}, T.Use{(ne + 2 : U32), False{}}]}]} : A.Face}
  A.Solid{List.append(&2, G.Vec3, vertices, [p, q]),
    List.append(&2, A.Edge, unit_edges(edges),
      [A.Edge{nv, nv, A.Circle{entry, normal, x, radius}, True{}},
       A.Edge{(nv + 1 : U32), (nv + 1 : U32), A.Circle{exit, normal, x, radius}, True{}},
       A.Edge{nv, (nv + 1 : U32), A.Line{p, G.normalize(G.sub(q, p))}, True{}}]),
    List.append(&2, A.Face, bored_faces(faces, ne, (ne + 1 : U32), low, axis, tolerance), [wall])}

def admitted(ok: Bool, +reason: U32, target: A.Solid, +origin: G.Vec3, +axis: G.Vec3, +radius: R.Real, +tolerance: R.Real) -> Pierced:
  match ok:
    case True{}:
      Bored{bore(target, origin, axis, radius, tolerance)}
    case False{}:
      Declined{reason}

# `axis` must be unit length. The hole runs the full depth of the body.
def pierce(+target: A.Solid, +origin: G.Vec3, +axis: G.Vec3, +radius: R.Real, +tool_low: R.Real, +tool_high: R.Real, +tolerance: R.Real) -> Pierced:
  +reason = decline(target, origin, axis, radius, tool_low, tool_high, tolerance)
  admitted(U32.is_eq(reason, 0), reason, target, origin, axis, radius, tolerance)

# Measures, in Bend because they are the part's properties and not the host's
# opinion of them. The hole is a full-depth cylinder, so what it removes is
# exact and no integration is needed.
def bore_depth(+target: A.Solid, +axis: G.Vec3, +tolerance: R.Real) -> R.Real:
  A.Solid{_, _, +faces} = target
  R.sub(pierced_high(faces, axis, tolerance, zero(), False{}),
    pierced_low(faces, axis, tolerance, zero(), False{}))

def pierced_volume(+target_volume: R.Real, +radius: R.Real, +depth: R.Real) -> R.Real:
  R.sub(target_volume, R.mul(R.mul(R.pi(), R.mul(radius, radius)), depth))
