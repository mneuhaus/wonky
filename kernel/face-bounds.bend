import Base
import ./real.bend as R
import ./precise.bend as G
import ./analytic.bend as A
import ./intersections.bend as I
import ./curve-plane.bend as C
import ./face-classification.bend as F

# Conservative directional bounds for an already prepared bounded face.
# Full round-curve supports deliberately overestimate trimmed arcs. This is
# an exclusion filter, never a contact, intersection or topology constructor.
type Bounds is Data:
  EmptyBounds{}
  UnknownBounds{}
  Finite{lower: R.Real, upper: R.Real, scale: R.Real}

def zero() -> R.Real:
  R.from_f32(0.0)

def finite(valid: Bool, lower: R.Real, upper: R.Real, scale: R.Real) -> Bounds:
  match valid:
    case False{}:
      UnknownBounds{}
    case True{}:
      Finite{lower, upper, scale}

def checked(+lower: R.Real, +upper: R.Real, +scale: R.Real) -> Bounds:
  valid = Bool.and(I.scalar_valid(lower), Bool.and(I.scalar_valid(upper), I.scalar_valid(scale)))
  finite(valid, lower, upper, scale)

def join(a: Bounds, b: Bounds) -> Bounds:
  match a b:
    case UnknownBounds{} _:
      UnknownBounds{}
    case _ UnknownBounds{}:
      UnknownBounds{}
    case EmptyBounds{} _:
      b
    case _ EmptyBounds{}:
      a
    case Finite{al, au, scale_a} Finite{bl, bu, scale_b}:
      Finite{R.min(al, bl), R.max(au, bu), R.max(scale_a, scale_b)}

def point_distance(point: G.Vec3, origin: G.Vec3, normal: G.Vec3) -> R.Real:
  G.dot(G.sub(point, origin), normal)

def points(+a: G.Vec3, +b: G.Vec3, +origin: G.Vec3, +normal: G.Vec3) -> Bounds:
  +first = point_distance(a, origin, normal)
  +last = point_distance(b, origin, normal)
  scale = R.max(R.from_f32(1.0), R.max(I.magnitude(origin), R.max(I.magnitude(a), I.magnitude(b))))
  checked(R.min(first, last), R.max(first, last), scale)

def round(+center: G.Vec3, normal: G.Vec3, +x: G.Vec3, +major: R.Real, +minor: R.Real, +origin: G.Vec3, +direction: G.Vec3) -> Bounds:
  y = G.cross(normal, x)
  +offset = point_distance(center, origin, direction)
  # L1 of the two sinusoidal coefficients encloses their actual amplitude.
  # Avoid cancellation in squared projection norms near axial directions.
  +amplitude = R.add(R.abs(R.mul(major, G.dot(x, direction))), R.abs(R.mul(minor, G.dot(y, direction))))
  scale = R.max(R.from_f32(1.0), R.max(I.magnitude(origin), R.max(I.magnitude(center), R.max(major, minor))))
  checked(R.sub(offset, amplitude), R.add(offset, amplitude), scale)

def curve_bounds(curve: A.Curve, domain: C.Domain, origin: G.Vec3, direction: G.Vec3) -> Bounds:
  match curve:
    case A.Line{center, axis}:
      match domain:
        case C.Interval{first, last}:
          +line = {A.Line{center, axis} : A.Curve}
          points(A.curve_point(line, first), A.curve_point(line, last), origin, direction)
        case C.Untrimmed{}:
          UnknownBounds{}
    case A.Circle{center, normal, x, +radius}:
      round(center, normal, x, radius, radius, origin, direction)
    case A.Ellipse{center, normal, x, major, minor}:
      round(center, normal, x, major, minor, origin, direction)

def edge_bounds(edges: List<&2, F.PreparedEdge>, +origin: G.Vec3, +direction: G.Vec3) -> Bounds:
  match edges:
    case Nil{}:
      EmptyBounds{}
    case F.PreparedEdge{_, A.Edge{_, _, curve, _}, domain, _, _, _} <> tail:
      join(curve_bounds(curve, domain, origin, direction), edge_bounds(tail, origin, direction))

def cylinder_bounds(axial: Bounds, +center: G.Vec3, +axis: G.Vec3, +x: G.Vec3, +radius: R.Real, +origin: G.Vec3, +direction: G.Vec3) -> Bounds:
  match axial:
    case Finite{first, last, axial_scale}:
      +slope = G.dot(axis, direction)
      +a = R.mul(first, slope)
      +b = R.mul(last, slope)
      +offset = point_distance(center, origin, direction)
      +radial = R.mul(radius, R.add(R.abs(G.dot(x, direction)), R.abs(G.dot(G.cross(axis, x), direction))))
      low = R.sub(R.add(offset, R.min(a, b)), radial)
      high = R.add(R.add(offset, R.max(a, b)), radial)
      scale = R.max(axial_scale, R.max(I.magnitude(origin), R.max(I.magnitude(center), radius)))
      checked(low, high, scale)
    case _:
      UnknownBounds{}

# Precondition: valid finite plane/cylinder frame and a valid bounded embedded
# arrangement, prepared by face-plane. Height on a cylinder has no interior
# extremum, so its physical boundary encloses the full axial range. The entire
# angular cylinder is used, including interior extrema absent from trim edges.
def directional(surface: A.Surface, edges: List<&2, F.PreparedEdge>, origin: G.Vec3, direction: G.Vec3) -> Bounds:
  match surface:
    case A.Plane{_, _, _}:
      edge_bounds(edges, origin, direction)
    case A.Cylinder{+center, axis, x, radius}:
      +unit = G.normalize(axis)
      axial = edge_bounds(edges, center, unit)
      cylinder_bounds(axial, center, unit, G.normalize(x), radius, origin, direction)
    case _:
      UnknownBounds{}

def separated(bounds: Bounds, tolerance: I.Tolerance, budget: R.Real, resolution: R.Real) -> Bool:
  match bounds:
    case Finite{lower, upper, scale}:
      # Guard includes the bounded-curve arithmetic and the source incidence
      # allowance. It is an operational numerical guard, not interval proof.
      arithmetic = R.mul(R.max(resolution, I.guard(scale)), R.from_f32(16.0))
      +margin = R.add(I.tolerance_linear(tolerance), R.add(budget, arithmetic))
      Bool.or(R.less(margin, lower), R.less(upper, R.neg(margin)))
    case _:
      False{}

def excludes(surface: A.Surface, edges: List<&2, F.PreparedEdge>, origin: G.Vec3, normal: G.Vec3, tolerance: I.Tolerance, budget: R.Real, resolution: R.Real) -> Bool:
  separated(directional(surface, edges, origin, G.normalize(normal)), tolerance, budget, resolution)
