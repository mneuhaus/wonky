import Base
import ../../real.bend as R
import ../../precise.bend as G
import ./job.bend as J

# Curve and surface evaluation for the rolling-ball contact solver
# (docs/fillet/proto-rollingball.md, stage 1). Conventions are those of the
# job format (docs/fillet/harness.md) and scripts/fillet/geom.mjs:
#
#   line     p(t) = o + t d
#   circle   p(t) = o + r (cos t x + sin t (n × x))
#   ellipse  p(t) = o + a cos t x + b sin t (n × x)
#   plane    natural normal n
#   cylinder natural normal radial, away from the axis
#   cone     radius r + h tan(angle); natural normal (radial − tan(angle) axis)/|·|
#   sphere   natural normal (p − o)/r
#   torus    natural normal (p − tube centre)/minor
#
# A face's outward normal is the natural normal times its sense (±1).
#
# Signed distance with a reference direction. The solver works in the normal
# plane of an edge point P. For a support of revolution the ball centre may
# approach or cross the axis (sphere cap: fillet radius = post radius), where
# the radial direction of the centre itself is undefined. `sd` therefore takes
# the radial direction of P (`Ref`) and measures the radial coordinate of the
# centre SIGNED along it: on P's side it is the true distance, through the
# axis it continues smoothly (the distance to P's generator). The true,
# unsigned distance is `sd` with the reference taken at the point itself
# (`ref_of(s, c)`); the certificate uses only that one.

type PSurf is Data:
  PPlane{o: G.Vec3, n: G.Vec3}
  PCyl{o: G.Vec3, a: G.Vec3, x: G.Vec3, r: R.Real}
  PCone{o: G.Vec3, a: G.Vec3, x: G.Vec3, r: R.Real, co: R.Real, si: R.Real}
  PSphere{o: G.Vec3, a: G.Vec3, r: R.Real}
  PTorus{o: G.Vec3, a: G.Vec3, x: G.Vec3, big: R.Real, small: R.Real}
  PBad{}

# u: radial direction at the reference point; w: tube direction (torus).
type Ref is Data:
  Ref{u: G.Vec3, w: G.Vec3}

# d: natural signed distance; g: its unit gradient (natural normal at the
# foot); k: the smallest signed radial coordinate (negative = the centre went
# through an axis or a tube centre line; 1e30 for planes).
type Sd is Data:
  Sd{d: R.Real, g: G.Vec3, k: R.Real}

def rl(x: F32) -> R.Real:
  R.from_f32(x)

def tiny2() -> R.Real:
  R.from_f32(0.00000000000000000001)

def tiny() -> R.Real:
  R.from_f32(0.0000000001)

def huge() -> R.Real:
  R.from_f32(1.0e30)

def two_pi() -> R.Real:
  R.mul(R.pi(), R.from_f32(2.0))

def vneg(v: G.Vec3) -> G.Vec3:
  G.scale(v, R.from_f32(F32.neg(1.0)))

def norm(+v: G.Vec3) -> R.Real:
  R.sqrt(G.dot(v, v))

# v/|v|, or `fallback` when |v| is (numerically) zero.
def unit_or(+v: G.Vec3, fallback: G.Vec3) -> G.Vec3:
  +l2 = G.dot(v, v)
  Bool.pick(G.Vec3, R.less(l2, tiny2()), fallback, G.scale(v, R.div(R.from_f32(1.0), R.sqrt(l2))))

# |v| signed by the side of `u` it lies on; exactly 0 below 1e-10 (|v|² would
# be subnormal there, which Metal flushes to zero, so the CPU and GPU would
# round differently next to an axis).
def slen(+v: G.Vec3, +u: G.Vec3) -> R.Real:
  +l2 = G.dot(v, v)
  +l = Bool.pick(R.Real, R.less(l2, tiny2()), R.from_f32(0.0), R.sqrt(l2))
  Bool.pick(R.Real, R.less(G.dot(v, u), R.from_f32(0.0)), R.neg(l), l)

# v/l for a signed length l, or `u` when l is (numerically) zero.
def sunit(v: G.Vec3, +l: R.Real, +u: G.Vec3) -> G.Vec3:
  Bool.pick(G.Vec3, R.less(R.abs(l), tiny()), u, G.scale(v, R.div(R.from_f32(1.0), l)))

# Component of p − o orthogonal to the unit axis a.
def radial(o: G.Vec3, +a: G.Vec3, p: G.Vec3) -> G.Vec3:
  +dv = G.sub(p, o)
  G.sub(dv, G.scale(a, G.dot(dv, a)))

# ---------------------------------------------------------------------------
# Surfaces

def prep(s: J.Surf) -> PSurf:
  match s:
    case J.Plane{o, n, _}:
      PPlane{o, G.normalize(n)}
    case J.Cyl{o, a, x, r}:
      PCyl{o, G.normalize(a), G.normalize(x), r}
    case J.Cone{o, a, x, r, +ang}:
      PCone{o, G.normalize(a), G.normalize(x), r, R.cos(ang), R.sin(ang)}
    case J.Sphere{o, a, _, r}:
      PSphere{o, G.normalize(a), r}
    case J.Torus{o, a, x, big, small}:
      PTorus{o, G.normalize(a), G.normalize(x), big, small}
    case J.BadSurf{}:
      PBad{}

def ref_torus(+o: G.Vec3, +a: G.Vec3, x: G.Vec3, big: R.Real, +p: G.Vec3) -> Ref:
  +u = unit_or(radial(o, a, p), x)
  +m = G.add(o, G.scale(u, big))
  Ref{u, unit_or(G.sub(p, m), a)}

def ref_axial(+o: G.Vec3, +a: G.Vec3, x: G.Vec3, +p: G.Vec3) -> Ref:
  +u = unit_or(radial(o, a, p), x)
  Ref{u, u}

# The reference directions of the point p (true radial and tube directions).
def ref_of(+s: PSurf, +p: G.Vec3) -> Ref:
  match s:
    case PPlane{_, n}:
      Ref{n, n}
    case PCyl{o, a, x, _}:
      ref_axial(o, a, x, p)
    case PCone{o, a, x, _, _, _}:
      ref_axial(o, a, x, p)
    case PSphere{o, a, _}:
      +u = unit_or(G.sub(p, o), a)
      Ref{u, u}
    case PTorus{o, a, x, big, _}:
      ref_torus(o, a, x, big, p)
    case PBad{}:
      Ref{G.v3(0.0, 0.0, 1.0), G.v3(0.0, 0.0, 1.0)}

def sd_cyl(+rho: R.Real, rad: G.Vec3, u: G.Vec3, r: R.Real) -> Sd:
  Sd{R.sub(rho, r), sunit(rad, rho, u), rho}

def sd_cone(+rho: R.Real, +h: R.Real, rad: G.Vec3, u: G.Vec3, a: G.Vec3, r: R.Real, +co: R.Real, +si: R.Real) -> Sd:
  +ta = R.div(si, co)
  d = R.mul(R.sub(R.sub(rho, r), R.mul(h, ta)), co)
  g = G.sub(G.scale(sunit(rad, rho, u), co), G.scale(a, si))
  Sd{d, g, rho}

def sd_torus.m(+c: G.Vec3, +m: G.Vec3, +w: G.Vec3, small: R.Real, +rho: R.Real) -> Sd:
  +v = G.sub(c, m)
  +dist = slen(v, w)
  Sd{R.sub(dist, small), sunit(v, dist, w), R.min(rho, dist)}

def sd_torus(+o: G.Vec3, +a: G.Vec3, big: R.Real, small: R.Real, +ref: Ref, +c: G.Vec3) -> Sd:
  Ref{+u, w} = ref
  +rad = radial(o, a, c)
  +rho = slen(rad, u)
  +m = G.add(o, G.scale(sunit(rad, rho, u), big))
  sd_torus.m(c, m, w, small, rho)

def sd_axial(+o: G.Vec3, +a: G.Vec3, +c: G.Vec3) -> G.Vec3 & R.Real:
  +dv = G.sub(c, o)
  +h = G.dot(dv, a)
  (G.sub(dv, G.scale(a, h)), h)

def sd_cone.k(p: G.Vec3 & R.Real, +u: G.Vec3, +a: G.Vec3, r: R.Real, co: R.Real, si: R.Real) -> Sd:
  (+rad, h) = p
  sd_cone(slen(rad, u), h, rad, u, a, r, co, si)

# Natural signed distance of c with the reference `ref` (see the header).
def sd(+s: PSurf, +ref: Ref, +c: G.Vec3) -> Sd:
  match s:
    case PPlane{o, n}:
      Sd{G.dot(G.sub(c, o), n), n, huge()}
    case PCyl{o, a, _, r}:
      Ref{+u, _} = ref
      +rad = radial(o, a, c)
      sd_cyl(slen(rad, u), rad, u, r)
    case PCone{o, a, _, r, co, si}:
      Ref{+u, _} = ref
      sd_cone.k(sd_axial(o, a, c), u, a, r, co, si)
    case PSphere{o, _, r}:
      Ref{+u, _} = ref
      +dv = G.sub(c, o)
      sd_cyl(slen(dv, u), dv, u, r)
    case PTorus{o, a, _, big, small}:
      sd_torus(o, a, big, small, ref, c)
    case PBad{}:
      Sd{huge(), G.v3(0.0, 0.0, 1.0), huge()}

# Face distance: natural distance and gradient times the face sense (±1).
def fsd.k(sg: Sd, +sense: R.Real) -> Sd:
  Sd{d, g, k} = sg
  Sd{R.mul(d, sense), G.scale(g, sense), k}

def fsd(+s: PSurf, +sense: R.Real, +ref: Ref, +c: G.Vec3) -> Sd:
  fsd.k(sd(s, ref, c), sense)

# True (unsigned-radial) face distance of c.
def sd_d(sg: Sd) -> R.Real:
  Sd{d, _, _} = sg
  d

def sd_g(sg: Sd) -> G.Vec3:
  Sd{_, g, _} = sg
  g

def sd_k(sg: Sd) -> R.Real:
  Sd{_, _, k} = sg
  k

def true_d(+s: PSurf, +sense: R.Real, +c: G.Vec3) -> R.Real:
  sd_d(fsd(s, sense, ref_of(s, c), c))

# ---------------------------------------------------------------------------
# Curves

# Point and first derivative at t.
def curve_pd(+c: J.Curve, +t: R.Real) -> G.Vec3 & G.Vec3:
  match c:
    case J.Line{o, d}:
      (G.add(o, G.scale(d, t)), d)
    case J.Circle{o, n, x, r}:
      +co = R.cos(t)
      +si = R.sin(t)
      +y = G.cross(n, x)
      (G.add(o, G.add(G.scale(x, R.mul(r, co)), G.scale(y, R.mul(r, si)))), G.add(G.scale(x, R.neg(R.mul(r, si))), G.scale(y, R.mul(r, co))))
    case J.Ellipse{o, n, x, a, b}:
      +co = R.cos(t)
      +si = R.sin(t)
      +y = G.cross(n, x)
      (G.add(o, G.add(G.scale(x, R.mul(a, co)), G.scale(y, R.mul(b, si)))), G.add(G.scale(x, R.neg(R.mul(a, si))), G.scale(y, R.mul(b, co))))
    case J.BadCurve{}:
      (G.v3(0.0, 0.0, 0.0), G.v3(1.0, 0.0, 0.0))

# Parameter of a point that lies on the curve.
def curve_param(+c: J.Curve, +p: G.Vec3) -> R.Real:
  match c:
    case J.Line{o, d}:
      R.div(G.dot(G.sub(p, o), d), G.dot(d, d))
    case J.Circle{o, n, x, _}:
      +dv = G.sub(p, o)
      R.atan2(G.dot(dv, G.cross(n, x)), G.dot(dv, x))
    case J.Ellipse{o, n, x, a, b}:
      +dv = G.sub(p, o)
      R.atan2(R.div(G.dot(dv, G.cross(n, x)), b), R.div(G.dot(dv, x), a))
    case J.BadCurve{}:
      R.from_f32(0.0)

def is_line(+c: J.Curve) -> Bool:
  match c:
    case J.Line{_, _}:
      True{}
    case _:
      False{}

def or_zero(m: Maybe<&2, G.Vec3>) -> G.Vec3:
  match m:
    case Some{v}:
      v
    case None{}:
      G.v3(0.0, 0.0, 0.0)

def nth_v(vs: List<&2, G.Vec3>, i: U32) -> G.Vec3:
  or_zero(List.get(&2, G.Vec3, vs, U32.to_nat(i)))

# d wrapped from (−2π, 2π) into [0, 2π).
def wrap_up(+d: R.Real) -> R.Real:
  Bool.pick(R.Real, R.less(d, R.from_f32(0.0)), R.add(d, two_pi()), d)

def periodic_end(+c: J.Curve, +a: R.Real, +closed: Bool, +same: Bool, +pe: G.Vec3) -> R.Real:
  +w = Bool.pick(R.Real, closed, two_pi(), wrap_up(R.sub(curve_param(c, pe), a)))
  Bool.pick(R.Real, same, R.add(a, w), R.sub(R.add(a, w), two_pi()))

def free_interval(+c: J.Curve, +ps: G.Vec3, +pe: G.Vec3, +closed: Bool, +same: Bool) -> R.Real & R.Real:
  +a = curve_param(c, ps)
  Bool.pick(R.Real & R.Real, is_line(c), (a, curve_param(c, pe)), (a, periodic_end(c, a, closed, same, pe)))

# Parameter interval of an edge in the direction start -> end: (t0, t1),
# t1 < t0 when the edge runs against the curve parameter.
def interval(e: J.Edge, +vs: List<&2, G.Vec3>) -> R.Real & R.Real:
  J.Edge{+s, +en, +c, +same, ranged, +first, +last} = e
  +sm = U32.is_eq(same, 1)
  Bool.pick(R.Real & R.Real, U32.is_eq(ranged, 1), Bool.pick(R.Real & R.Real, sm, (first, last), (last, first)), free_interval(c, nth_v(vs, s), nth_v(vs, en), U32.is_eq(s, en), sm))
