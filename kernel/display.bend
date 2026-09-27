import Base
import ./real.bend as R
import ./precise.bend as G
import ./analytic.bend as A

# Cylinder display charts only. z retains the measured radial distance so
# callers can report/check projection error without changing the input point.
def cylinder_coordinates(point: G.Vec3, origin: G.Vec3, +axis: G.Vec3, +x: G.Vec3) -> G.Vec3:
  +d = G.sub(point, origin)
  +a = G.dot(d, x)
  +b = G.dot(d, G.cross(axis, x))
  G.V3{R.atan2(b, a), G.dot(d, axis), R.sqrt(R.add(R.mul(a, a), R.mul(b, b)))}

# A supported round trim lies in a plane. Its height on the cylinder is
# a + b*cos(u) + c*sin(u); callers reject a near-parallel plane before division.
def cylinder_trim_coefficients(origin: G.Vec3, +axis: G.Vec3, +x: G.Vec3, +radius: R.Real, plane_origin: G.Vec3, +normal: G.Vec3) -> G.Vec3:
  +denominator = G.dot(axis, normal)
  a = R.div(G.dot(G.sub(plane_origin, origin), normal), denominator)
  b = R.neg(R.div(R.mul(radius, G.dot(x, normal)), denominator))
  c = R.neg(R.div(R.mul(radius, G.dot(G.cross(axis, x), normal)), denominator))
  G.V3{a, b, c}

def trim_height(coefficients: G.Vec3, +angle: R.Real) -> R.Real:
  G.V3{a, b, c} = coefficients
  R.add(a, R.add(R.mul(b, R.cos(angle)), R.mul(c, R.sin(angle))))

# Evaluation for explicitly approximate viewer meshes. These points never
# replace the analytic modeling B-rep or participate in modeling Booleans.
def radial(+axis: G.Vec3, +x: G.Vec3, +angle: R.Real) -> G.Vec3:
  G.add(G.scale(x, R.cos(angle)), G.scale(G.cross(axis, x), R.sin(angle)))

def surface_point(surface: A.Surface, +u: R.Real, +v: R.Real) -> G.Vec3:
  match surface:
    case A.Plane{o, n, +x}:
      G.add(o, G.add(G.scale(x, u), G.scale(G.cross(n, x), v)))
    case A.Cylinder{o, +n, x, r}:
      G.add(G.add(o, G.scale(n, v)), G.scale(radial(n, x, u), r))
    case A.Cone{o, +n, x, r, +angle}:
      radius = R.add(r, R.mul(v, R.div(R.sin(angle), R.cos(angle))))
      G.add(G.add(o, G.scale(n, v)), G.scale(radial(n, x, u), radius))
    # u is the longitude from x about the axis, v the latitude (sphere) or the
    # tube angle measured from the outer equator toward the axis (torus).
    case A.Sphere{o, +n, x, +r}:
      G.add(o, G.add(G.scale(radial(n, x, u), R.mul(r, R.cos(v))), G.scale(n, R.mul(r, R.sin(v)))))
    case A.Torus{o, +n, x, major, +minor}:
      G.add(o, G.add(G.scale(radial(n, x, u), R.add(major, R.mul(minor, R.cos(v)))), G.scale(n, R.mul(minor, R.sin(v)))))

def surface_normal(surface: A.Surface, u: R.Real) -> G.Vec3:
  match surface:
    case A.Plane{_, n, _}:
      n
    case A.Cylinder{_, n, x, _}:
      radial(n, x, u)
    case A.Cone{_, +n, x, _, +angle}:
      G.normalize(G.sub(radial(n, x, u), G.scale(n, R.div(R.sin(angle), R.cos(angle)))))
    # The signature carries no v: this is the normal on the equator (v = 0)
    # only. Display callers mesh spheres and tori elsewhere and must not use it.
    case A.Sphere{_, n, x, _}:
      radial(n, x, u)
    case A.Torus{_, n, x, _, _}:
      radial(n, x, u)
