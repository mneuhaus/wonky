import Base
import ./real.bend as R
import ./precise.bend as G
import ./analytic.bend as A
import ./topology.bend as T
import ./intersections.bend as I
import ./curve-plane.bend as C
import ./face-classification.bend as F
import ./cylinder-classification.bend as K
import ./ports/truck-cylinder.bend as B

# Export-only 2D parameter curves. Analytic 3D circles/ellipses stay unchanged.
# A full-cylinder chart is linear in angle and sinusoidal in axial height.
# Piecewise cubic Hermite interpolation has error <= amplitude*h^4/384.
# The arithmetic guard is operational F32x2 protection, not an interval proof.
type UV is Data:
  UV{u: R.Real, v: R.Real}

type Reason is Data:
  InvalidInput{}
  UnsupportedCurve{}
  UnsupportedSurface{}
  UnsupportedBand{}
  InvalidBand{}
  UnsupportedEdge{}
  UnsupportedDomain{}
  IncidenceFailure{}
  ResolutionLimit{}
  SegmentLimit{}

type PCurveResult is Data:
  Resolved{first: R.Real, last: R.Real, degree: U32,
    points: List<&2, UV>, knots: List<&2, R.Real>, multiplicities: List<&2, U32>,
    approximation_bound: R.Real, support_bound: R.Real, numeric_guard: R.Real, total_bound: R.Real}
  Unresolved{reason: Reason}

type Trace is Data:
  Trace{first: R.Real, u_start: R.Real, sign: R.Real, z0: R.Real, zc: R.Real, zs: R.Real}

type Resolution is Data:
  Chosen{count: U32, step: R.Real, bound: R.Real}
  TooFine{}

def zero() -> R.Real:
  R.from_f32(0.0)

def one() -> R.Real:
  R.from_f32(1.0)

def tau() -> R.Real:
  R.mul(R.pi(), R.from_f32(2.0))

def maximum_budget() -> R.Real:
  R.div(one(), R.from_f32(100000000.0))

def canonical( +value: R.Real) -> R.Real:
  +wrapped = Bool.pick(R.Real, R.less(value, zero()), R.add(value, tau()), value)
  # Avoid charts differing by a whole period for roundoff at a shared seam.
  Bool.pick(R.Real, Bool.or(I.at_most(R.abs(wrapped), I.angular_guard()), I.at_most(R.abs(R.sub(wrapped, tau())), I.angular_guard())), zero(), wrapped)

def value( +trace: Trace, +t: R.Real) -> UV:
  Trace{first, u_start, sign, z0, zc, zs} = trace
  UV{R.add(u_start, R.mul(sign, R.sub(t, first))), R.add(z0, R.add(R.mul(zc, R.cos(t)), R.mul(zs, R.sin(t))))}

def derivative( +trace: Trace, +t: R.Real) -> UV:
  Trace{_, _, sign, _, zc, zs} = trace
  UV{sign, R.add(R.mul(R.neg(zc), R.sin(t)), R.mul(zs, R.cos(t)))}

def shifted( +point: UV, +direction: UV, +amount: R.Real) -> UV:
  UV{u, v} = point
  UV{du, dv} = direction
  UV{R.add(u, R.mul(du, amount)), R.add(v, R.mul(dv, amount))}

def parameter( +first: R.Real, +step: R.Real, +index: U32) -> R.Real:
  R.add(first, R.mul(step, R.from_f32(U32.to_f32(index))))

def control_points( +left: Nat, +index: U32, +first: R.Real, +step: R.Real, +trace: Trace) -> List<&2, UV>:
  match left:
    case 0n:
      [value(trace, parameter(first, step, index))]
    case 1n+rest:
      +a = parameter(first, step, index)
      +b = parameter(first, step, (index + 1 : U32))
      +third = R.div(step, R.from_f32(3.0))
      value(trace, a) <>
        shifted(value(trace, a), derivative(trace, a), third) <>
        shifted(value(trace, b), derivative(trace, b), R.neg(third)) <>
        control_points(rest, (index + 1 : U32), first, step, trace)

def knots( +left: Nat, +index: U32, +first: R.Real, +step: R.Real) -> List<&2, R.Real>:
  match left:
    case 0n:
      [parameter(first, step, index)]
    case 1n+rest:
      parameter(first, step, index) <> knots(rest, (index + 1 : U32), first, step)

def tail_multiplicities( +left: Nat) -> List<&2, U32>:
  match left:
    case 0n:
      [4]
    case 1n+rest:
      3 <> tail_multiplicities(rest)

def choose( +left: Nat, +count: U32, +step: R.Real, +bound: R.Real, +available: R.Real) -> Resolution:
  match left:
    case 0n:
      Bool.pick(Resolution, I.at_most(bound, available), Chosen{count, step, bound}, TooFine{})
    case 1n+rest:
      Bool.pick(Resolution, I.at_most(bound, available), Chosen{count, step, bound}, choose(rest, (count * 2 : U32), R.div(step, R.from_f32(2.0)), R.div(bound, R.from_f32(16.0)), available))

def spline( +resolution: Resolution, +trace: Trace, +support: R.Real, +guard: R.Real) -> PCurveResult:
  match resolution:
    case TooFine{}:
      Unresolved{SegmentLimit{}}
    case Chosen{+count, +step, +bound}:
      Trace{+first, _, _, _, _, _} = trace
      Resolved{first, parameter(first, step, count), 3,
        control_points(U32.to_nat(count), 0, first, step, trace),
        knots(U32.to_nat(count), 0, first, step),
        4 <> tail_multiplicities(U32.to_nat((count - 1 : U32))),
        bound, support, guard, R.add(bound, R.add(support, guard))}

def bounded( +valid: Bool, +trace: Trace, +support: R.Real, +guard: R.Real, +budget: R.Real) -> PCurveResult:
  match valid:
    case False{}:
      Unresolved{IncidenceFailure{}}
    case True{}:
      Trace{_, _, _, _, +zc, +zs} = trace
      +amplitude = R.sqrt(R.add(R.mul(zc, zc), R.mul(zs, zs)))
      +square = R.mul(tau(), tau())
      +bound = R.div(R.mul(amplitude, R.mul(square, square)), R.from_f32(384.0))
      spline(choose(10n, 1, tau(), bound, R.sub(budget, R.add(support, guard))), trace, support, guard)

def round_trace( +curve: A.Curve, +center: G.Vec3, +u: G.Vec3, +v: G.Vec3,
  +origin: G.Vec3, +axis: G.Vec3, +x: G.Vec3, +radius: R.Real,
  +start: G.Vec3, +seam: G.Vec3, +guard: R.Real, +budget: R.Real) -> PCurveResult:
  +y = G.cross(axis, x)
  +delta = G.sub(center, origin)
  +c_radial = K.radial(delta, axis)
  +u_radial = K.radial(u, axis)
  +v_radial = K.radial(v, axis)
  +seam_radial = K.radial(G.sub(seam, origin), axis)
  +first = canonical(A.curve_parameter(curve, start))
  +seam_angle = canonical(R.atan2(G.dot(seam_radial, y), G.dot(seam_radial, x)))
  +sign = Bool.pick(R.Real, R.less(zero(), G.dot(axis, G.cross(u_radial, v_radial))), one(), R.neg(one()))
  +phase = R.sub(seam_angle, R.mul(sign, first))
  +ideal_u = G.scale(G.add(G.scale(x, R.cos(phase)), G.scale(y, R.sin(phase))), radius)
  +ideal_v = G.scale(G.add(G.scale(x, R.neg(R.sin(phase))), G.scale(y, R.cos(phase))), R.mul(radius, sign))
  +coefficient_error = R.add(I.length(c_radial), R.add(I.length(G.sub(u_radial, ideal_u)), I.length(G.sub(v_radial, ideal_v))))
  +endpoint_error = I.length(G.sub(start, A.curve_point(curve, first)))
  +seam_error = R.abs(R.sub(I.length(seam_radial), radius))
  +support = R.add(coefficient_error, R.add(endpoint_error, seam_error))
  +u_start = R.add(seam_angle, Bool.pick(R.Real, R.less(sign, zero()), tau(), zero()))
  +trace = {Trace{first, u_start, sign, G.dot(delta, axis), G.dot(u, axis), G.dot(v, axis)} : Trace}
  bounded(R.less(R.add(support, guard), budget), trace, support, guard, budget)

def round_curve( +curve: A.Curve, +origin: G.Vec3, +axis: G.Vec3, +x: G.Vec3, +radius: R.Real, +start: G.Vec3, +seam: G.Vec3, +guard: R.Real, +budget: R.Real) -> PCurveResult:
  match curve:
    case A.Circle{center, normal, +cx, +r}:
      round_trace(curve, center, G.scale(cx, r), G.scale(G.cross(normal, cx), r), origin, axis, x, radius, start, seam, guard, budget)
    case A.Ellipse{center, normal, +cx, major, minor}:
      round_trace(curve, center, G.scale(cx, major), G.scale(G.cross(normal, cx), minor), origin, axis, x, radius, start, seam, guard, budget)
    case _:
      Unresolved{UnsupportedCurve{}}

def input_checked( +valid: Bool, +curve: A.Curve, +origin: G.Vec3, +axis: G.Vec3, +x: G.Vec3, +radius: R.Real, +start: G.Vec3, +seam: G.Vec3, +guard: R.Real, +budget: R.Real) -> PCurveResult:
  match valid:
    case False{}:
      Unresolved{InvalidInput{}}
    case True{}:
      Bool.pick(PCurveResult, I.at_most(guard, budget),
        round_curve(curve, origin, axis, x, radius, start, seam, guard, budget),
        Unresolved{ResolutionLimit{}})

def cylinder_round( +curve: A.Curve, +surface: A.Surface, +start: G.Vec3, +seam: G.Vec3, +budget: R.Real) -> PCurveResult:
  match surface:
    case A.Cylinder{+origin, +axis, +x, +radius}:
      +scale = R.max(one(), R.max(B.curve_scale(curve), R.max(R.add(I.magnitude(origin), R.abs(radius)), R.max(I.magnitude(start), I.magnitude(seam)))))
      +guard = R.mul(I.angular_guard(), scale)
      +valid = Bool.and(C.curve_valid(curve), Bool.and(I.vec_valid(origin), Bool.and(C.frame_valid(axis, x), Bool.and(I.scalar_valid(radius), Bool.and(R.less(guard, radius), Bool.and(I.vec_valid(start), Bool.and(I.vec_valid(seam), Bool.and(I.scalar_valid(budget), Bool.and(R.less(zero(), budget), I.at_most(budget, maximum_budget()))))))))))
      input_checked(valid, curve, origin, axis, x, radius, start, seam, guard, budget)
    case _:
      Unresolved{UnsupportedSurface{}}

def cap_edge( +cap: B.Cap) -> U32:
  B.Cap{_, _, index, _, _, _, _, _} = cap
  index

def cap_pcurve( +cap: B.Cap, +surface: A.Surface, +seam: G.Vec3, +budget: R.Real) -> PCurveResult:
  B.Cap{_, _, _, _, start, curve, _, _} = cap
  cylinder_round(curve, surface, start, seam, budget)

def band_edge( +valid: Bool, +band: B.Band, +edge_index: U32, +face_index: U32, +budget: R.Real) -> PCurveResult:
  match valid:
    case False{}:
      Unresolved{InvalidBand{}}
    case True{}:
      B.Band{_, +first, +second, B.Entry{wall_index, A.Face{+surface, _, _}}, _} = band
      +same_wall = U32.is_eq(face_index, wall_index)
      +seam = B.cap_point(first)
      Bool.pick(PCurveResult, Bool.and(same_wall, U32.is_eq(edge_index, cap_edge(first))),
        cap_pcurve(first, surface, seam, budget),
        Bool.pick(PCurveResult, Bool.and(same_wall, U32.is_eq(edge_index, cap_edge(second))),
          cap_pcurve(second, surface, seam, budget), Unresolved{UnsupportedEdge{}}))

def prepared_band( +prepared: B.Preparation, +edge_index: U32, +face_index: U32, +guard: R.Real, +budget: R.Real) -> PCurveResult:
  match prepared:
    case B.Rejected{}:
      Unresolved{UnsupportedBand{}}
    case B.Prepared{+band}:
      band_edge(Bool.and(B.band_valid(band, guard), B.band_ordered(band, guard, I.angular_guard())), band, edge_index, face_index, budget)

# Production boundary: only the complete full-band topology is admitted.
# Indices identify an existing periodic rim and its shared cylindrical face.
def for_edge( +solid: A.Solid, +edge_index: U32, +face_index: U32, +budget: R.Real) -> PCurveResult:
  A.Solid{vertices, edges, faces} = solid
  +scale = B.face_scale(faces, B.edge_scale(edges, B.scale(vertices, one())))
  prepared_band(B.preparation(solid), edge_index, face_index, R.mul(I.angular_guard(), scale), budget)

def domains_checked( +valid: Bool, +solid: A.Solid, +edge_index: U32, +face_index: U32, +budget: R.Real) -> PCurveResult:
  match valid:
    case False{}:
      Unresolved{UnsupportedDomain{}}
    case True{}:
      for_edge(solid, edge_index, face_index, budget)

def for_edge_domains( +solid: A.Solid, +domains: List<&2, F.DomainChoice>, +edge_index: U32, +face_index: U32, +budget: R.Real) -> PCurveResult:
  +valid = Bool.and(B.auto_domains(domains), Bool.not(U32.is_lt(3, U32.from_nat(List.length(&2, F.DomainChoice, domains)))))
  domains_checked(valid, solid, edge_index, face_index, budget)

# --- Cylinder parameter lines (STEP export only) -----------------------------
# A generator (a line along the axis) and a coaxial circle (normal along the
# axis, centre on it, the cylinder's radius) are parameter lines of a
# cylinder: u or v is constant along them, and a reader builds their
# parameter curves exactly. When the whole-body cylinder planner
# (step-cylinder-pcurves.bend) is unresolved -- far from the origin its
# F32x2 guard exceeds the 1e-8 mm budget (fillet program, adv-far-1e7 and
# adv-rb-far-9e3) -- a body whose every cylinder boundary is such a line needs
# no explicit parameter curve. Directions within the angular guard (1e-12);
# centre and radius within 1e-6 mm (the fillet program's modelling tolerance;
# F32x2 resolution at the 1e10 mm coordinate limit is 3.6e-5 mm, so beyond
# about 3e8 mm this answers False and the planner's refusal stands). Anything
# else, an ellipse above all, needs the planner.

def parallel_to( +d: G.Vec3, +axis: G.Vec3) -> Bool:
  I.at_most(I.length(G.cross(G.normalize(d), axis)), I.angular_guard())

def close_to_line() -> R.Real:
  R.from_f32(0.000001)

def cylinder_parameter_line( +origin: G.Vec3, +axis: G.Vec3, +radius: R.Real, curve: A.Curve) -> Bool:
  match curve:
    case A.Line{_, +d}:
      parallel_to(d, axis)
    case A.Circle{+center, +normal, _, +r}:
      Bool.and(parallel_to(normal, axis), Bool.and(I.at_most(I.length(G.cross(G.sub(center, origin), axis)), close_to_line()),
        I.at_most(R.abs(R.sub(r, radius)), close_to_line())))
    case A.Ellipse{_, _, _, _, _}:
      False{}

def edge_parameter_line(edge: A.Edge, +origin: G.Vec3, +axis: G.Vec3, +radius: R.Real) -> Bool:
  A.Edge{_, _, curve, _} = edge
  cylinder_parameter_line(origin, axis, radius, curve)

def uses_parameter_lines(uses: List<&2, T.Coedge>, +edges: List<&2, A.Edge>, +origin: G.Vec3, +axis: G.Vec3, +radius: R.Real) -> Bool:
  match uses:
    case Nil{}:
      True{}
    case T.Use{+edge, _} <> rest:
      Bool.and(edge_parameter_line(A.edge_at(edges, edge), origin, axis, radius), uses_parameter_lines(rest, edges, origin, axis, radius))

def loops_parameter_lines(loops: List<&2, A.Loop>, +edges: List<&2, A.Edge>, +origin: G.Vec3, +axis: G.Vec3, +radius: R.Real) -> Bool:
  match loops:
    case Nil{}:
      True{}
    case A.Loop{_, uses} <> rest:
      Bool.and(uses_parameter_lines(uses, edges, origin, axis, radius), loops_parameter_lines(rest, edges, origin, axis, radius))

def face_parameter_lines(face: A.Face, +edges: List<&2, A.Edge>) -> Bool:
  A.Face{surface, _, loops} = face
  match surface:
    case A.Cylinder{+origin, axis, _, +radius}:
      loops_parameter_lines(loops, edges, origin, G.normalize(axis), radius)
    case _:
      True{}

def faces_parameter_lines(faces: List<&2, A.Face>, +edges: List<&2, A.Edge>) -> Bool:
  match faces:
    case Nil{}:
      True{}
    case face <> rest:
      Bool.and(face_parameter_lines(face, edges), faces_parameter_lines(rest, edges))

# Production entry: is every boundary curve of every cylinder face of the body
# a parameter line of that cylinder?
def cylinder_lines_only(solid: A.Solid) -> Bool:
  A.Solid{_, +edges, faces} = solid
  faces_parameter_lines(faces, edges)

# --- Sphere faces (STEP export only) -----------------------------------------
# A sphere face's frame is free. Readers build latitude and meridian curves of
# the frame exactly, so the writer keeps the face's own frame when every
# boundary circle is one of them, and otherwise takes the axis of a boundary
# circle whose centre lies on the line through the sphere's centre along its
# normal (a latitude then; with the frame's origin wobble of recovered
# spheres, 1e-15, gone). Any other circle has no parameter curve in
# closed form: it is approximated here by piecewise cubic Hermite in
# (longitude, latitude), knots on the circle's own parameter. The bound is
# sampled, not proved: the 3D distance between the circle and the surface at
# the spline at 8 points of every span, doubled. Without it a reader builds
# its own approximation (OpenCascade: 1.7e-5 mm on KS06, edge tolerance
# 1e-7 mm). A circle that comes near a pole fails to meet the budget and is
# left to the reader (Unresolved).

type SphereFrame is Data:
  SphereFrame{origin: G.Vec3, axis: G.Vec3, x: G.Vec3, radius: R.Real}

type Knot is Data:
  Knot{t: R.Real, at: UV, slope: UV}

def knot_at_point(k: Knot) -> UV:
  Knot{_, p, _} = k
  p

def knot_t(k: Knot) -> R.Real:
  Knot{t, _, _} = k
  t

def knot_slope(k: Knot) -> UV:
  Knot{_, _, s} = k
  s

def uv_u(p: UV) -> R.Real:
  UV{u, _} = p
  u

def knots_of( +knots: List<&2, Knot>, acc: List<&2, R.Real>) -> List<&2, R.Real>:
  match knots:
    case k <> rest:
      knots_of(rest, knot_t(k) <> acc)
    case Nil{}:
      List.reverse(&2, R.Real, acc)

def inner_threes( +left: Nat, acc: List<&2, U32>) -> List<&2, U32>:
  match left:
    case 0n:
      acc
    case 1n+rest:
      inner_threes(rest, 3 <> acc)

def s_frame( +origin: G.Vec3, +axis: G.Vec3, +radius: R.Real) -> SphereFrame:
  SphereFrame{origin, axis, A.axis_x(axis), radius}

# A circle is a latitude of axis k through c when its normal is parallel to k
# and its centre lies on the line c + s k.
def latitude_of( +c: G.Vec3, +k: G.Vec3, curve: A.Curve, +tolerance: R.Real) -> Bool:
  match curve:
    case A.Circle{+center, +normal, _, _}:
      Bool.and(I.at_most(I.length(G.cross(normal, k)), R.from_f32(0.000000001)),
        I.at_most(I.length(G.cross(G.sub(center, c), k)), tolerance))
    case _:
      False{}

def circle_axis(curve: A.Curve) -> G.Vec3:
  match curve:
    case A.Circle{_, normal, _, _}:
      G.normalize(normal)
    case _:
      G.v3(0.0, 0.0, 1.0)

def first_latitude( +c: G.Vec3, curves: List<&2, A.Curve>, +tolerance: R.Real, +fallback: G.Vec3) -> G.Vec3:
  match curves:
    case Nil{}:
      fallback
    case +curve <> rest:
      Bool.pick(G.Vec3, latitude_of(c, circle_axis(curve), curve, tolerance), circle_axis(curve), first_latitude(c, rest, tolerance, fallback))

# The frame the writer uses for a sphere face bounded by `curves`.
# A circle fits axis k through c when it is a latitude or a meridian (its
# plane contains the axis line).
def fits( +c: G.Vec3, +k: G.Vec3, curve: A.Curve, +tolerance: R.Real) -> Bool:
  match curve:
    case A.Circle{+center, +normal, _, _}:
      Bool.or(latitude_of(c, k, curve, tolerance),
        Bool.and(I.at_most(R.abs(G.dot(G.normalize(normal), k)), R.from_f32(0.000000001)),
          I.at_most(R.abs(G.dot(G.sub(center, c), G.normalize(normal))), tolerance)))
    case _:
      False{}

def all_fit( +c: G.Vec3, +k: G.Vec3, curves: List<&2, A.Curve>, +tolerance: R.Real) -> Bool:
  match curves:
    case Nil{}:
      True{}
    case curve <> rest:
      Bool.and(fits(c, k, curve, tolerance), all_fit(c, k, rest, tolerance))

# Does the face keep its own frame (every boundary circle fits its axis)?
def sphere_frame_kept( +surface: A.Surface, curves: List<&2, A.Curve>) -> Bool:
  match surface:
    case A.Sphere{+origin, axis, _, +radius}:
      all_fit(origin, G.normalize(axis), curves, R.mul(radius, R.from_f32(0.000000001)))
    case _:
      False{}

# The frame the writer uses for a sphere face bounded by `curves`.
def sphere_frame( +surface: A.Surface, +curves: List<&2, A.Curve>) -> SphereFrame:
  match surface:
    case A.Sphere{+origin, +axis, +x, +radius}:
      +tolerance = R.mul(radius, R.from_f32(0.000000001))
      +own = G.normalize(axis)
      Bool.pick(SphereFrame, all_fit(origin, own, curves, tolerance),
        SphereFrame{origin, own, G.normalize(G.sub(x, G.scale(own, G.dot(x, own)))), radius},
        s_frame(origin, first_latitude(origin, curves, tolerance, own), radius))
    case _:
      s_frame(G.v3(0.0, 0.0, 0.0), G.v3(0.0, 0.0, 1.0), R.from_f32(1.0))

def frame_axis(frame: SphereFrame) -> G.Vec3:
  SphereFrame{_, axis, _, _} = frame
  axis

def frame_x(frame: SphereFrame) -> G.Vec3:
  SphereFrame{_, _, x, _} = frame
  x

# Is the circle a latitude of the writer's frame (no parameter curve needed)?
# Does the circle need a parameter curve on the writer's frame (neither a
# latitude nor a meridian of it)?
def sphere_needs_pcurve( +frame: SphereFrame, curve: A.Curve) -> Bool:
  SphereFrame{+origin, +axis, _, +radius} = frame
  Bool.not(fits(origin, axis, curve, R.mul(radius, R.from_f32(0.000000001))))

def s_point( +frame: SphereFrame, +uv: UV) -> G.Vec3:
  SphereFrame{origin, +axis, +x, radius} = frame
  UV{+u, +v} = uv
  +y = G.cross(axis, x)
  +around = G.add(G.scale(x, R.cos(u)), G.scale(y, R.sin(u)))
  G.add(origin, G.scale(G.add(G.scale(around, R.cos(v)), G.scale(axis, R.sin(v))), radius))

def c_point( +center: G.Vec3, +cx: G.Vec3, +cy: G.Vec3, +r: R.Real, +t: R.Real) -> G.Vec3:
  G.add(center, G.scale(G.add(G.scale(cx, R.cos(t)), G.scale(cy, R.sin(t))), r))

def c_tangent( +cx: G.Vec3, +cy: G.Vec3, +r: R.Real, +t: R.Real) -> G.Vec3:
  G.scale(G.add(G.scale(cx, R.neg(R.sin(t))), G.scale(cy, R.cos(t))), r)

# Frames whose poles avoid the boundary (fillet program, docs/fillet-plan.md
# §8 step 1). A pole of the writer's frame inside a boundary arc (not at its
# ends) makes a reader split that edge there and add a degenerate edge (A's
# corner spheres on a sheared box: their first latitude frame puts a pole on
# a meridian arc of the same face). Such a face gets a cap frame instead:
#   m, the mean direction of the arcs' ends and midpoints from the centre;
#   certified, in closed form per arc, that every boundary point q has
#   (q - c).m >= 1e-6 rho, so the whole boundary lies in the open hemisphere
#   around m;
#   the axis k perpendicular to m (and to the first great circle of the
#   boundary, which then is a meridian of the frame), x = m x k, so y = m.
# Both poles are then 90 degrees from m, off every arc, and every boundary
# point has longitude in (0, pi): no pole on the boundary and no seam through
# it. A face whose own frame (sphere_frame_kept) or first latitude frame
# (sphere_frame) has no pole inside an arc keeps exactly that frame, and so
# does a face whose cap frame cannot be certified (the reader then splits as
# before, and strict STEP validation says so).

# A boundary arc: its circle and range; `whole` is a closed circle (no range).
type Arc is Data:
  Arc{curve: A.Curve, whole: Bool, first: R.Real, last: R.Real}

type FaceFrame is Data:
  FaceFrame{frame: SphereFrame, kept: Bool}

def arc_curve(arc: Arc) -> A.Curve:
  Arc{curve, _, _, _} = arc
  curve

def arc_curves( +arcs: List<&2, Arc>) -> List<&2, A.Curve>:
  match arcs:
    case Nil{}:
      Nil{}
    case arc <> rest:
      arc_curve(arc) <> arc_curves(rest)

# u reduced into [0, 2 pi) by whole turns.
def turns_off( +u: R.Real) -> R.Real:
  R.sub(u, R.mul(tau(), R.from_f32(F32.floor(R.approx(R.div(u, tau()))))))

# Does the point lie on the arc's circle (within `tolerance`) strictly between
# its ends (by more than 1e-9 rad)? A whole circle has no ends.
def point_in_arc( +p: G.Vec3, arc: Arc, +tolerance: R.Real) -> Bool:
  Arc{curve, +whole, +first, +last} = arc
  match curve:
    case A.Circle{+center, +normal, +cx, +r}:
      +n = G.normalize(normal)
      +x = G.normalize(cx)
      +y = G.cross(n, x)
      +d = G.sub(p, center)
      +on = Bool.and(I.at_most(R.abs(G.dot(d, n)), tolerance), I.at_most(R.abs(R.sub(I.length(d), r)), tolerance))
      +u = turns_off(R.sub(R.atan2(G.dot(d, y), G.dot(d, x)), first))
      +margin = R.from_f32(0.000000001)
      +inner = Bool.and(R.less(margin, u), R.less(u, R.sub(R.sub(last, first), margin)))
      Bool.and(on, Bool.or(whole, inner))
    case _:
      False{}

def pole_in_arcs( +p: G.Vec3, arcs: List<&2, Arc>, +tolerance: R.Real) -> Bool:
  match arcs:
    case Nil{}:
      False{}
    case arc <> rest:
      Bool.or(point_in_arc(p, arc, tolerance), pole_in_arcs(p, rest, tolerance))

# Neither pole of axis k through c (radius rho) lies inside a boundary arc.
def poles_clear( +c: G.Vec3, +k: G.Vec3, +rho: R.Real, +arcs: List<&2, Arc>, +tolerance: R.Real) -> Bool:
  Bool.not(Bool.or(pole_in_arcs(G.add(c, G.scale(k, rho)), arcs, tolerance), pole_in_arcs(G.sub(c, G.scale(k, rho)), arcs, tolerance)))

# The unit direction from c of the arc's point at t.
def arc_direction( +c: G.Vec3, +center: G.Vec3, +x: G.Vec3, +y: G.Vec3, +r: R.Real, +t: R.Real) -> G.Vec3:
  G.normalize(G.sub(c_point(center, x, y, r, t), c))

# Sum of the directions of an arc's ends and midpoint (a whole circle: four
# quarter points).
def arc_directions( +c: G.Vec3, arc: Arc) -> G.Vec3:
  Arc{curve, +whole, +first, +last} = arc
  match curve:
    case A.Circle{+center, +normal, +cx, +r}:
      +x = G.normalize(cx)
      +y = G.cross(G.normalize(normal), x)
      +quarter = R.div(R.pi(), R.from_f32(2.0))
      +a = Bool.pick(R.Real, whole, zero(), first)
      +b = Bool.pick(R.Real, whole, R.pi(), R.div(R.add(first, last), R.from_f32(2.0)))
      +e = Bool.pick(R.Real, whole, R.mul(R.from_f32(3.0), quarter), last)
      +four = Bool.pick(G.Vec3, whole, arc_direction(c, center, x, y, r, quarter), G.v3(0.0, 0.0, 0.0))
      G.add(G.add(arc_direction(c, center, x, y, r, a), arc_direction(c, center, x, y, r, b)), G.add(arc_direction(c, center, x, y, r, e), four))
    case _:
      G.v3(0.0, 0.0, 0.0)

def arcs_directions( +c: G.Vec3, arcs: List<&2, Arc>) -> G.Vec3:
  match arcs:
    case Nil{}:
      G.v3(0.0, 0.0, 0.0)
    case arc <> rest:
      G.add(arc_directions(c, arc), arcs_directions(c, rest))

# min over the arc of (q - c).m, in closed form: (q - c).m = a0 + bx cos t +
# by sin t is smallest at t = atan2(by, bx) + pi, else at an end.
def arc_min_along( +c: G.Vec3, +m: G.Vec3, arc: Arc) -> R.Real:
  Arc{curve, +whole, +first, +last} = arc
  match curve:
    case A.Circle{+center, +normal, +cx, +r}:
      +x = G.normalize(cx)
      +y = G.cross(G.normalize(normal), x)
      +a0 = G.dot(G.sub(center, c), m)
      +bx = R.mul(r, G.dot(x, m))
      +by = R.mul(r, G.dot(y, m))
      +lowest = R.sub(a0, R.sqrt(R.add(R.mul(bx, bx), R.mul(by, by))))
      +at = turns_off(R.sub(R.add(R.atan2(by, bx), R.pi()), first))
      +ends = R.min(R.add(a0, R.add(R.mul(bx, R.cos(first)), R.mul(by, R.sin(first)))), R.add(a0, R.add(R.mul(bx, R.cos(last)), R.mul(by, R.sin(last)))))
      Bool.pick(R.Real, Bool.or(whole, R.less(at, R.sub(last, first))), lowest, ends)
    case _:
      R.neg(one())

def arcs_min_along( +c: G.Vec3, +m: G.Vec3, arcs: List<&2, Arc>, +acc: R.Real) -> R.Real:
  match arcs:
    case Nil{}:
      acc
    case arc <> rest:
      arcs_min_along(c, m, rest, R.min(acc, arc_min_along(c, m, arc)))

def circle_center(curve: A.Curve) -> G.Vec3:
  match curve:
    case A.Circle{center, _, _, _}:
      center
    case _:
      G.v3(0.0, 0.0, 0.0)

# The normal of the first great circle of the boundary (centre at c), else
# a direction perpendicular to m.
def great_normal( +c: G.Vec3, +m: G.Vec3, curves: List<&2, A.Curve>, +tolerance: R.Real) -> G.Vec3:
  match curves:
    case Nil{}:
      A.axis_x(m)
    case +curve <> rest:
      +k = circle_axis(curve)
      Bool.pick(G.Vec3, Bool.and(latitude_of(c, k, curve, tolerance), I.at_most(I.length(G.sub(circle_center(curve), c)), tolerance)), k, great_normal(c, m, rest, tolerance))

def cap_frame_checked(ok: Bool, frame: SphereFrame, fallback: FaceFrame) -> FaceFrame:
  match ok:
    case True{}:
      FaceFrame{frame, False{}}
    case False{}:
      fallback

# The cap frame of the face (see above), or `fallback` if it is not certified.
def cap_frame( +c: G.Vec3, +rho: R.Real, +arcs: List<&2, Arc>, +tolerance: R.Real, fallback: FaceFrame) -> FaceFrame:
  +sum = arcs_directions(c, arcs)
  +m = G.normalize(sum)
  +n = great_normal(c, m, arc_curves(arcs), tolerance)
  +k0 = G.cross(m, n)
  +k = G.normalize(Bool.pick(G.Vec3, R.less(I.length(k0), R.from_f32(0.000001)), A.axis_x(m), k0))
  +within = R.less(R.mul(rho, R.from_f32(0.000001)), arcs_min_along(c, m, arcs, rho))
  +ok = Bool.and(R.less(R.from_f32(0.001), I.length(sum)), Bool.and(within, poles_clear(c, k, rho, arcs, tolerance)))
  cap_frame_checked(ok, SphereFrame{c, k, G.cross(m, k), rho}, fallback)

def face_frame_first(clear: Bool, +origin: G.Vec3, +k: G.Vec3, +radius: R.Real, +arcs: List<&2, Arc>, +tolerance: R.Real) -> FaceFrame:
  match clear:
    case True{}:
      FaceFrame{s_frame(origin, k, radius), False{}}
    case False{}:
      cap_frame(origin, radius, arcs, tolerance, FaceFrame{s_frame(origin, k, radius), False{}})

def kept_frame( +origin: G.Vec3, +own: G.Vec3, +x: G.Vec3, +radius: R.Real) -> FaceFrame:
  FaceFrame{SphereFrame{origin, own, G.normalize(G.sub(x, G.scale(own, G.dot(x, own)))), radius}, True{}}

def face_frame_own(fits_own: Bool, +origin: G.Vec3, +own: G.Vec3, +x: G.Vec3, +radius: R.Real, +curves: List<&2, A.Curve>, +arcs: List<&2, Arc>, +tolerance: R.Real) -> FaceFrame:
  match fits_own:
    case True{}:
      Bool.pick(FaceFrame, poles_clear(origin, own, radius, arcs, tolerance), kept_frame(origin, own, x, radius),
        cap_frame(origin, radius, arcs, tolerance, kept_frame(origin, own, x, radius)))
    case False{}:
      +k = first_latitude(origin, curves, tolerance, own)
      face_frame_first(poles_clear(origin, k, radius, arcs, tolerance), origin, k, radius, arcs, tolerance)

# Production entry: the frame the writer uses for a sphere face bounded by
# `arcs`, and whether it is the face's own (then no parameter curve and no
# new placement are needed).
def sphere_face_frame( +surface: A.Surface, +arcs: List<&2, Arc>) -> FaceFrame:
  match surface:
    case A.Sphere{+origin, +axis, +x, +radius}:
      +tolerance = R.mul(radius, R.from_f32(0.000000001))
      +own = G.normalize(axis)
      +curves = arc_curves(arcs)
      face_frame_own(all_fit(origin, own, curves, tolerance), origin, own, x, radius, curves, arcs, tolerance)
    case _:
      FaceFrame{s_frame(G.v3(0.0, 0.0, 0.0), G.v3(0.0, 0.0, 1.0), R.from_f32(1.0)), False{}}

# Longitude near `near` (unwrapped by whole turns), latitude, and their
# derivatives along the circle.
def unwrap( +u: R.Real, +near: R.Real) -> R.Real:
  +turn = tau()
  +half = R.pi()
  +up = Bool.pick(R.Real, R.less(R.sub(u, near), R.neg(half)), R.add(u, turn), u)
  Bool.pick(R.Real, R.less(half, R.sub(up, near)), R.sub(up, turn), up)

def knot_at( +frame: SphereFrame, +center: G.Vec3, +cx: G.Vec3, +cy: G.Vec3, +r: R.Real, +t: R.Real, +near: R.Real) -> Knot:
  SphereFrame{+origin, +axis, +x, _} = frame
  +y = G.cross(axis, x)
  +d = G.sub(c_point(center, cx, cy, r, t), origin)
  +dp = c_tangent(cx, cy, r, t)
  +px = G.dot(d, x)
  +py = G.dot(d, y)
  +pz = G.dot(d, axis)
  +qx = G.dot(dp, x)
  +qy = G.dot(dp, y)
  +qz = G.dot(dp, axis)
  +rho2 = R.add(R.mul(px, px), R.mul(py, py))
  +rho = R.sqrt(rho2)
  +drho = R.div(R.add(R.mul(px, qx), R.mul(py, qy)), rho)
  +du = R.div(R.sub(R.mul(px, qy), R.mul(py, qx)), rho2)
  +dv = R.div(R.sub(R.mul(rho, qz), R.mul(pz, drho)), R.add(rho2, R.mul(pz, pz)))
  Knot{t, UV{unwrap(R.atan2(py, px), near), R.atan2(pz, rho)}, UV{du, dv}}

def knot_u(k: Knot) -> R.Real:
  uv_u(knot_at_point(k))

# Tail-recursive (acc holds the knots in reverse): thousands of knots stay
# off the JS stack.
def knot_list( +left: Nat, +index: U32, +first: R.Real, +step: R.Real, +near: R.Real,
  +frame: SphereFrame, +center: G.Vec3, +cx: G.Vec3, +cy: G.Vec3, +r: R.Real, acc: List<&2, Knot>) -> List<&2, Knot>:
  match left:
    case 0n:
      List.reverse(&2, Knot, knot_at(frame, center, cx, cy, r, parameter(first, step, index), near) <> acc)
    case 1n+rest:
      +k = knot_at(frame, center, cx, cy, r, parameter(first, step, index), near)
      knot_list(rest, (index + 1 : U32), first, step, knot_u(k), frame, center, cx, cy, r, k <> acc)

def bezier( +p0: UV, +p1: UV, +p2: UV, +p3: UV, +s: R.Real) -> UV:
  UV{+a0, +b0} = p0
  UV{+a1, +b1} = p1
  UV{+a2, +b2} = p2
  UV{+a3, +b3} = p3
  +w = R.sub(one(), s)
  +c0 = R.mul(w, R.mul(w, w))
  +c1 = R.mul(R.from_f32(3.0), R.mul(w, R.mul(w, s)))
  +c2 = R.mul(R.from_f32(3.0), R.mul(w, R.mul(s, s)))
  +c3 = R.mul(s, R.mul(s, s))
  UV{R.add(R.add(R.mul(c0, a0), R.mul(c1, a1)), R.add(R.mul(c2, a2), R.mul(c3, a3))),
    R.add(R.add(R.mul(c0, b0), R.mul(c1, b1)), R.add(R.mul(c2, b2), R.mul(c3, b3)))}

# The largest sampled distance over one span (samples 1/9 .. 8/9).
def span_error( +left: Nat, +k: U32, +a: Knot, +b: Knot, +frame: SphereFrame,
  +center: G.Vec3, +cx: G.Vec3, +cy: G.Vec3, +r: R.Real, +worst: R.Real) -> R.Real:
  match left:
    case 0n:
      worst
    case 1n+rest:
      +ta = knot_t(a)
      +h = R.sub(knot_t(b), ta)
      +third = R.div(h, R.from_f32(3.0))
      +pa = knot_at_point(a)
      +pb = knot_at_point(b)
      +s = R.div(R.from_f32(U32.to_f32(k)), R.from_f32(9.0))
      +q = s_point(frame, bezier(pa, shifted(pa, knot_slope(a), third), shifted(pb, knot_slope(b), R.neg(third)), pb, s))
      +e = I.length(G.sub(q, c_point(center, cx, cy, r, R.add(ta, R.mul(h, s)))))
      span_error(rest, (k + 1 : U32), a, b, frame, center, cx, cy, r, R.max(worst, e))

def spans_from( +rest: List<&2, Knot>, +a: Knot, +frame: SphereFrame, +center: G.Vec3, +cx: G.Vec3, +cy: G.Vec3, +r: R.Real, +worst: R.Real) -> R.Real:
  match rest:
    case +b <> tail:
      spans_from(tail, b, frame, center, cx, cy, r, span_error(8n, 1, a, b, frame, center, cx, cy, r, worst))
    case Nil{}:
      worst

def spans_error( +knots: List<&2, Knot>, +frame: SphereFrame, +center: G.Vec3, +cx: G.Vec3, +cy: G.Vec3, +r: R.Real, +worst: R.Real) -> R.Real:
  match knots:
    case a <> rest:
      spans_from(rest, a, frame, center, cx, cy, r, worst)
    case Nil{}:
      worst

def points_from( +rest: List<&2, Knot>, +a: Knot, acc: List<&2, UV>) -> List<&2, UV>:
  match rest:
    case +b <> tail:
      +third = R.div(R.sub(knot_t(b), knot_t(a)), R.from_f32(3.0))
      +pa = knot_at_point(a)
      +pb = knot_at_point(b)
      points_from(tail, b, shifted(pb, knot_slope(b), R.neg(third)) <> shifted(pa, knot_slope(a), third) <> pa <> acc)
    case Nil{}:
      List.reverse(&2, UV, knot_at_point(a) <> acc)

def knot_points( +knots: List<&2, Knot>) -> List<&2, UV>:
  match knots:
    case a <> rest:
      points_from(rest, a, Nil{})
    case Nil{}:
      Nil{}

# Doubles count while factor > 1 (factor halves each time).
def grow( +left: Nat, +count: U32, +factor: R.Real) -> U32:
  match left:
    case 0n:
      count
    case 1n+rest:
      Bool.pick(U32, R.less(one(), factor), grow(rest, (count * 2 : U32), R.div(factor, R.from_f32(2.0))), count)

type Attempt is Data:
  Attempt{count: U32, knots: List<&2, Knot>, bound: R.Real}

def attempt( +count: U32, +first: R.Real, +last: R.Real,
  +frame: SphereFrame, +center: G.Vec3, +cx: G.Vec3, +cy: G.Vec3, +r: R.Real) -> Attempt:
  +step = R.div(R.sub(last, first), R.from_f32(U32.to_f32(count)))
  +start = knot_at(frame, center, cx, cy, r, first, zero())
  +knots = knot_list(U32.to_nat(count), 0, first, step, knot_u(start), frame, center, cx, cy, r, Nil{})
  Attempt{count, knots, R.mul(R.from_f32(2.0), spans_error(knots, frame, center, cx, cy, r, zero()))}

def attempt_ok(a: Attempt, +budget: R.Real) -> Bool:
  Attempt{_, _, bound} = a
  I.at_most(bound, budget)

# The next span count after a bound over the budget: the error falls as h^4,
# so the count grows by the fourth root of the excess (with 20% margin),
# rounded up to a power of two, at least doubling.
def next_count(a: Attempt, +budget: R.Real) -> U32:
  Attempt{count, _, bound} = a
  grow(12n, (count * 2 : U32), R.div(R.mul(R.from_f32(1.2), R.sqrt(R.sqrt(R.div(bound, budget)))), R.from_f32(2.0)))

def resolved(a: Attempt, +first: R.Real, +last: R.Real) -> PCurveResult:
  Attempt{count, +knots, +bound} = a
  Resolved{first, last, 3, knot_points(knots), knots_of(knots, Nil{}),
    4 <> inner_threes(U32.to_nat((count - 1 : U32)), [4]), bound, zero(), zero(), bound}

# Bool.pick evaluates both branches; a finer attempt must only run when this
# one misses the budget, so the choice is a match on `ok`.
def sphere_spline( +fuel: Nat, +ok: Bool, +a: Attempt, +first: R.Real, +last: R.Real, +budget: R.Real,
  +frame: SphereFrame, +center: G.Vec3, +cx: G.Vec3, +cy: G.Vec3, +r: R.Real) -> PCurveResult:
  match fuel:
    case 0n:
      Unresolved{SegmentLimit{}}
    case 1n+rest:
      match ok:
        case True{}:
          resolved(a, first, last)
        case False{}:
          +b = attempt(next_count(a, budget), first, last, frame, center, cx, cy, r)
          sphere_spline(rest, attempt_ok(b, budget), b, first, last, budget, frame, center, cx, cy, r)


# Production entry: the parameter curve of `curve` over [first, last] on the
# writer's frame of a sphere face, within `budget` mm (sampled, see above).
def sphere_circle( +frame: SphereFrame, curve: A.Curve, +first: R.Real, +last: R.Real, +budget: R.Real) -> PCurveResult:
  match curve:
    case A.Circle{+center, +normal, +cx, +r}:
      +ux = G.normalize(cx)
      +uy = G.cross(G.normalize(normal), ux)
      +a = attempt(8, first, last, frame, center, ux, uy, r)
      sphere_spline(6n, attempt_ok(a, budget), a, first, last, budget, frame, center, ux, uy, r)
    case _:
      Unresolved{UnsupportedCurve{}}
