import Base
import ./real.bend as R
import ./precise.bend as G
import ./analytic.bend as A
import ./curve-plane.bend as C
import ./face-classification.bend as F
import ./edge-plane.bend as E
import ./intersections.bend as I

# FS 0..1 is oriented distance along the finite edge, not carrier radians.
# Only lines and circles have a constant-speed carrier parameter here.
type TangentResult is Data:
  Tangent{origin: G.Vec3, direction: G.Vec3}
  EllipseArcLength{}
  Unprepared{preparation: E.EdgePreparation}

def at_parameter(+curve: A.Curve, +parameter: R.Real, sense: Bool) -> TangentResult:
  Tangent{A.curve_point(curve, parameter), G.scale(G.normalize(A.curve_tangent(curve, parameter)), Bool.pick(R.Real, sense, R.from_f32(1.0), R.from_f32(F32.neg(1.0))))}

def in_interval(+curve: A.Curve, +first: R.Real, last: R.Real, +sense: Bool, +fraction: R.Real) -> TangentResult:
  u = Bool.pick(R.Real, sense, fraction, R.sub(R.from_f32(1.0), fraction))
  at_parameter(curve, R.add(first, R.mul(R.sub(last, first), u)), sense)

def on_domain(domain: C.Domain, +curve: A.Curve, start: G.Vec3, +sense: Bool, fraction: R.Real) -> TangentResult:
  match domain:
    case C.Interval{first, last}:
      in_interval(curve, first, last, sense, fraction)
    case C.Untrimmed{}:
      +delta = R.mul(R.mul(R.pi(), R.from_f32(2.0)), fraction)
      angle = R.add(A.curve_parameter(curve, start), Bool.pick(R.Real, sense, delta, R.neg(delta)))
      at_parameter(curve, angle, sense)

def supported_curve(+curve: A.Curve, domain: C.Domain, start: G.Vec3, sense: Bool, fraction: R.Real) -> TangentResult:
  match curve:
    case A.Ellipse{_, _, _, _, _}:
      EllipseArcLength{}
    case _:
      on_domain(domain, curve, start, sense, fraction)

def tangent_prepared(+prepared: E.EdgePreparation, fraction: R.Real) -> TangentResult:
  match prepared:
    case E.Prepared{E.EdgeSource{_, A.Edge{_, _, curve, sense}, domain, start, _, _, _, _}}:
      supported_curve(curve, domain, start, sense, fraction)
    case _:
      Unprepared{prepared}

def edge_tangent(solid: A.Solid, +index: U32, domains: List<&2, F.DomainChoice>, fraction: R.Real, tolerance: I.Tolerance, budget: R.Real) -> TangentResult:
  A.Solid{vertices, edges, _} = solid
  choice = F.choose_domain(List.get(&2, F.DomainChoice, domains, U32.to_nat(index)))
  origin = {G.V3{R.from_f32(0.0), R.from_f32(0.0), R.from_f32(0.0)} : G.Vec3}
  prepared = E.prepare_edge(List.get(&2, A.Edge, edges, U32.to_nat(index)), index, vertices, choice, origin, tolerance, budget)
  tangent_prepared(prepared, fraction)

# A local box of a polyhedron is the extrema of its actual vertices, NOT the
# transformed corners of a world AABB. Vertices on analytic bodies use this too.
type Bounds is Data:
  EmptyBounds{}
  LocalBounds{minimum: G.Vec3, maximum: G.Vec3}

def local_point(point: G.Vec3, origin: G.Vec3, +x: G.Vec3, +z: G.Vec3) -> G.Vec3:
  +delta = G.sub(point, origin)
  G.V3{G.dot(delta, x), G.dot(delta, G.cross(z, x)), G.dot(delta, z)}

def vector_min(a: G.Vec3, b: G.Vec3) -> G.Vec3:
  G.V3{ax, ay, az} = a
  G.V3{bx, by, bz} = b
  G.V3{R.min(ax, bx), R.min(ay, by), R.min(az, bz)}

def vector_max(a: G.Vec3, b: G.Vec3) -> G.Vec3:
  G.V3{ax, ay, az} = a
  G.V3{bx, by, bz} = b
  G.V3{R.max(ax, bx), R.max(ay, by), R.max(az, bz)}

def include_point(bounds: Bounds, +point: G.Vec3) -> Bounds:
  match bounds:
    case EmptyBounds{}:
      LocalBounds{point, point}
    case LocalBounds{minimum, maximum}:
      LocalBounds{vector_min(minimum, point), vector_max(maximum, point)}

def local_bounds.go(points: List<&2, G.Vec3>, +origin: G.Vec3, +x: G.Vec3, +z: G.Vec3, bounds: Bounds) -> Bounds:
  match points:
    case []:
      bounds
    case head <> tail:
      local_bounds.go(tail, origin, x, z, include_point(bounds, local_point(head, origin, x, z)))

def local_bounds(points: List<&2, G.Vec3>, origin: G.Vec3, x: G.Vec3, z: G.Vec3) -> Bounds:
  local_bounds.go(points, origin, x, z, EmptyBounds{})
