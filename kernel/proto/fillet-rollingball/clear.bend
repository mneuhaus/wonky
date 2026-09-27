import Base
import ../../real.bend as R
import ../../precise.bend as G
import ./job.bend as J
import ./geom.bend as S

# Certified clearance tests for the overflow checks of brep.bend (stage C2).
#
# The blend of an edge removes a region from each support face (the strip:
# the points of the face within the contact width w of the edge, between the
# two end sections) and from each cap (the end triangle v, a, b). Every other
# edge of that face must stay out of it. Stage C2 first tested 17 samples per
# edge, which let a hole slip into the strip between two samples (a circle of
# R = 4 sampled every 22.5 deg, closest point at 281.25 deg). These tests are
# certified instead: an edge piece [t_m − δ, t_m + δ] is clear when a
# second-order Taylor bound of the region's defining functions over the piece
# proves every point of it out of the region; otherwise it is split, down to
# a fuel limit. A point found inside is a refusal; a piece that cannot be
# certified at the limit is refused too (never a wrong ok).
#
# Region functions, each a quadric in the point q,
#   f(q) = α |q − o|² − β ((q − o)·e)² + l·(q − o) + k,
# restricted to an edge piece q(u) = p0 + u·dv (u ∈ [0, 1]) or
# q(θ) = c + a cos θ + b sin θ (circle, ellipse), are polynomials in u or
# trigonometric polynomials in θ of degree ≤ 2 with exact coefficients; the
# circle strip needs one product of two of them (degree 4). For such an f,
# on [t_m − δ, t_m + δ]:  f ≥ f(t_m) − |f'(t_m)| δ − ½ M₂ δ² − e,  with M₂ a
# bound of |f''| from the coefficients and e a rounding allowance.
#
# Straight strip (edge from p_s along the unit t, length L):
#   σ_s = (q − p_s)·t,  σ_e = L − σ_s,  D = |q − p_s|² − σ_s²  (distance² to the line).
# Circular strip (centre o, unit normal n, radius R; open arcs from the unit
# in-plane direction x_0 over the angle Φ):
#   σ_s = (q − o)·(n × x_0),  σ_e = −(q − o)·(n × x_1)   (in the arc: σ_s > 0 and
#   σ_e > 0 for Φ ≤ π, σ_s > 0 or σ_e > 0 for Φ > π; no range when closed),
#   the distance d to the circle: d ≥ W  ⇔  X ≥ 0 and X² − 4R²ρ² ≥ 0 with
#   X = |q − o|² + R² − W², ρ² = |q − o|² − ((q − o)·n)².
# End triangle (p1, p2, p3): σ_i = distance of q from the line of side i,
#   positive inside; φ_k = (q − p_k)·u_k with u_k the outward bisector at
#   vertex k (the triangle lies in φ_k ≤ 0). Touch is the true in-plane
#   distance from the triangle below τ; a piece is clear when some σ_i ≤ −τ/2
#   or some φ_k ≥ τ/2 on all of it (every point at distance ≥ τ has one of
#   them ≥ 0.707 τ, so the splitting terminates).
#
# Point states (bands of the modelling tolerance τ = 1e-6 − 1e-9 mm: the
# STEP uncertainty of the harness less the 1e-9 certification floor, so a
# face exactly 1e-6 wide is still built and a 1e-9 sliver is not):
#   2 inside  (every range function > τ and d < w − τ),
#   1 touch   (every range function > −τ and d < w + τ): the face would
#             vanish or keep a sliver below the modelling tolerance,
#   0 clear.
# A piece is certified clear when a range function stays ≤ −τ/2 or the
# distance ≥ w + τ/2 on all of it; the τ/2 margin to the touch band makes
# the splitting terminate. So an edge closer than τ/2 is always refused, one
# between τ/2 and τ when a tested point lies there. State 3: not certified
# within the fuel (4096 pieces, depth 48).

def zero() -> R.Real:
  R.from_f32(0.0)

def one() -> R.Real:
  R.from_f32(1.0)

def rl(x: F32) -> R.Real:
  R.from_f32(x)

# The modelling tolerance band τ and its half.
def mtol() -> R.Real:
  R.sub(R.div(one(), R.from_f32(1000000.0)), R.div(one(), R.from_f32(1000000000.0)))

def half_mtol() -> R.Real:
  R.mul(mtol(), rl(0.5))

# Relative rounding allowance of the coefficients (48-bit Real: 3.6e-15).
def rnd() -> R.Real:
  R.div(one(), R.from_f32(1000000000000.0))

def norm(+v: G.Vec3) -> R.Real:
  R.sqrt(G.dot(v, v))

def unit(+v: G.Vec3) -> G.Vec3:
  S.unit_or(v, G.v3(1.0, 0.0, 0.0))

def sq(+x: R.Real) -> R.Real:
  R.mul(x, x)

def half() -> R.Real:
  rl(0.5)

def pd_p(pd: G.Vec3 & G.Vec3) -> G.Vec3:
  (p, _) = pd
  p

def point_at(+c: J.Curve, +t: R.Real) -> G.Vec3:
  pd_p(S.curve_pd(c, t))

# ---------------------------------------------------------------------------
# Edge pieces

type Crv is Data:
  CLin{p0: G.Vec3, dv: G.Vec3}
  CTri{c: G.Vec3, a: G.Vec3, b: G.Vec3}

def crv_at(+k: Crv, +t: R.Real) -> G.Vec3:
  match k:
    case CLin{p0, dv}:
      G.add(p0, G.scale(dv, t))
    case CTri{c, a, b}:
      G.add(c, G.add(G.scale(a, R.cos(t)), G.scale(b, R.sin(t))))

# A job curve over its parameter interval [t0, t1] (either order) as a piece
# and its domain (lo, hi): u ∈ [0, 1] for lines, θ ∈ [min, max] otherwise.
type Dom is Data:
  Dom{k: Crv, lo: R.Real, hi: R.Real}

def dom_of(+c: J.Curve, +t0: R.Real, +t1: R.Real) -> Dom:
  match c:
    case J.Line{o, d}:
      Dom{CLin{G.add(o, G.scale(d, t0)), G.scale(d, R.sub(t1, t0))}, zero(), one()}
    case J.Circle{o, +n, +x, +r}:
      Dom{CTri{o, G.scale(x, r), G.scale(G.cross(n, x), r)}, R.min(t0, t1), R.max(t0, t1)}
    case J.Ellipse{o, +n, +x, a, b}:
      Dom{CTri{o, G.scale(x, a), G.scale(G.cross(n, x), b)}, R.min(t0, t1), R.max(t0, t1)}
    case J.BadCurve{}:
      Dom{CLin{G.v3(0.0, 0.0, 0.0), G.v3(0.0, 0.0, 0.0)}, zero(), one()}

# ---------------------------------------------------------------------------
# Quadrics and their restriction to a piece

type Qd is Data:
  Qd{o: G.Vec3, alpha: R.Real, beta: R.Real, e: G.Vec3, l: G.Vec3, k: R.Real}

# Coefficients (a trigonometric polynomial: c0 + Σ ck cos kθ + sk sin kθ) and
# the rounding allowance e.
type Fn is Data:
  FPoly{c0: R.Real, c1: R.Real, c2: R.Real, c3: R.Real, c4: R.Real, e: R.Real}
  FTrig{c0: R.Real, c1: R.Real, s1: R.Real, c2: R.Real, s2: R.Real, c3: R.Real, s3: R.Real, c4: R.Real, s4: R.Real, e: R.Real}

def bil(+q: Qd, +u: G.Vec3, +v: G.Vec3) -> R.Real:
  Qd{_, +alpha, +beta, +e, _, _} = q
  R.sub(R.mul(alpha, G.dot(u, v)), R.mul(beta, R.mul(G.dot(u, e), G.dot(v, e))))

def q_l(+q: Qd) -> G.Vec3:
  Qd{_, _, _, _, +l, _} = q
  l

def q_k(+q: Qd) -> R.Real:
  Qd{_, _, _, _, _, +k} = q
  k

def q_o(+q: Qd) -> G.Vec3:
  Qd{+o, _, _, _, _, _} = q
  o

# Rounding allowance of a quadric over points within `ext` of o.
def q_err(+q: Qd, +ext: R.Real) -> R.Real:
  Qd{_, +alpha, +beta, _, +l, +k} = q
  +m = R.add(R.add(R.mul(R.add(R.abs(alpha), R.abs(beta)), sq(ext)), R.mul(norm(l), ext)), R.abs(k))
  R.mul(rnd(), R.add(m, one()))

def fn_of(+q: Qd, +k: Crv) -> Fn:
  match k:
    case CLin{+p0, +dv}:
      +v0 = G.sub(p0, q_o(q))
      +l = q_l(q)
      +c0 = R.add(R.add(bil(q, v0, v0), G.dot(l, v0)), q_k(q))
      +c1 = R.add(R.mul(rl(2.0), bil(q, v0, dv)), G.dot(l, dv))
      FPoly{c0, c1, bil(q, dv, dv), zero(), zero(), q_err(q, R.add(norm(v0), norm(dv)))}
    case CTri{+c, +a, +b}:
      +v0 = G.sub(c, q_o(q))
      +l = q_l(q)
      +aa = bil(q, a, a)
      +bb = bil(q, b, b)
      +c0 = R.add(R.add(R.add(bil(q, v0, v0), R.mul(half(), R.add(aa, bb))), G.dot(l, v0)), q_k(q))
      +c1 = R.add(R.mul(rl(2.0), bil(q, v0, a)), G.dot(l, a))
      +s1 = R.add(R.mul(rl(2.0), bil(q, v0, b)), G.dot(l, b))
      FTrig{c0, c1, s1, R.mul(half(), R.sub(aa, bb)), bil(q, a, b), zero(), zero(), zero(), zero(), q_err(q, R.add(norm(v0), R.add(norm(a), norm(b))))}

def fn_err(+f: Fn) -> R.Real:
  match f:
    case FPoly{_, _, _, _, _, e}:
      e
    case FTrig{_, _, _, _, _, _, _, _, _, e}:
      e

def fn_mag(+f: Fn) -> R.Real:
  match f:
    case FPoly{c0, c1, c2, c3, c4, _}:
      R.add(R.add(R.add(R.abs(c0), R.abs(c1)), R.add(R.abs(c2), R.abs(c3))), R.abs(c4))
    case FTrig{c0, c1, s1, c2, s2, c3, s3, c4, s4, _}:
      R.add(R.add(R.add(R.abs(c0), R.add(R.abs(c1), R.abs(s1))), R.add(R.add(R.abs(c2), R.abs(s2)), R.add(R.abs(c3), R.abs(s3)))), R.add(R.abs(c4), R.abs(s4)))

# x² − m·y for x, y of degree ≤ 2 (same kind): the circle strip's G with
# m = 4R². The allowance covers the products (|x|² + m|y|) in magnitude.
def fn_g.poly(+x0: R.Real, +x1: R.Real, +x2: R.Real, +y: Fn, +m: R.Real, +e: R.Real) -> Fn:
  match y:
    case FPoly{+y0, +y1, +y2, _, _, _}:
      FPoly{R.sub(sq(x0), R.mul(m, y0)), R.sub(R.mul(rl(2.0), R.mul(x0, x1)), R.mul(m, y1)), R.sub(R.add(sq(x1), R.mul(rl(2.0), R.mul(x0, x2))), R.mul(m, y2)), R.mul(rl(2.0), R.mul(x1, x2)), sq(x2), e}
    case FTrig{_, _, _, _, _, _, _, _, _, _}:
      FPoly{zero(), zero(), zero(), zero(), zero(), S.huge()}

def fn_g.trig(+x0: R.Real, +p1: R.Real, +q1: R.Real, +p2: R.Real, +q2: R.Real, +y: Fn, +m: R.Real, +e: R.Real) -> Fn:
  match y:
    case FTrig{+y0, +yc1, +ys1, +yc2, +ys2, _, _, _, _, _}:
      +cc0 = R.add(R.add(sq(x0), R.mul(half(), R.add(sq(p1), sq(q1)))), R.mul(half(), R.add(sq(p2), sq(q2))))
      +cc1 = R.add(R.mul(rl(2.0), R.mul(x0, p1)), R.add(R.mul(p1, p2), R.mul(q1, q2)))
      +ss1 = R.add(R.mul(rl(2.0), R.mul(x0, q1)), R.sub(R.mul(p1, q2), R.mul(q1, p2)))
      +cc2 = R.add(R.mul(rl(2.0), R.mul(x0, p2)), R.mul(half(), R.sub(sq(p1), sq(q1))))
      +ss2 = R.add(R.mul(rl(2.0), R.mul(x0, q2)), R.mul(p1, q1))
      +cc3 = R.sub(R.mul(p1, p2), R.mul(q1, q2))
      +ss3 = R.add(R.mul(p1, q2), R.mul(q1, p2))
      +cc4 = R.mul(half(), R.sub(sq(p2), sq(q2)))
      +ss4 = R.mul(p2, q2)
      FTrig{R.sub(cc0, R.mul(m, y0)), R.sub(cc1, R.mul(m, yc1)), R.sub(ss1, R.mul(m, ys1)), R.sub(cc2, R.mul(m, yc2)), R.sub(ss2, R.mul(m, ys2)), cc3, ss3, cc4, ss4, e}
    case FPoly{_, _, _, _, _, _}:
      FPoly{zero(), zero(), zero(), zero(), zero(), S.huge()}

def fn_g.err(+x: Fn, +y: Fn, +m: R.Real) -> R.Real:
  +e = R.mul(rnd(), R.add(R.add(sq(fn_mag(x)), R.mul(m, fn_mag(y))), R.add(sq(fn_err(x)), R.mul(m, fn_err(y)))))
  R.add(e, R.mul(rl(3.0), R.add(R.mul(fn_mag(x), fn_err(x)), R.mul(m, fn_err(y)))))

def fn_g.k(+x: Fn, +y: Fn, +m: R.Real, +e2: R.Real) -> Fn:
  match x:
    case FPoly{+x0, +x1, +x2, _, _, _}:
      fn_g.poly(x0, x1, x2, y, m, e2)
    case FTrig{+x0, +p1, +q1, +p2, +q2, _, _, _, _, _}:
      fn_g.trig(x0, p1, q1, p2, q2, y, m, e2)

def fn_g(+x: Fn, +y: Fn, +m: R.Real) -> Fn:
  fn_g.k(x, y, m, fn_g.err(x, y, m))

# Value, first derivative and a bound of |f''| on the domain.
type V2 is Data:
  V2{f: R.Real, d: R.Real, m2: R.Real, e: R.Real}

# c cos kθ + s sin kθ and its derivative, from co = cos kθ, si = sin kθ.
def harm_v(+c: R.Real, +s: R.Real, +co: R.Real, +si: R.Real) -> R.Real:
  R.add(R.mul(c, co), R.mul(s, si))

def harm_d(+c: R.Real, +s: R.Real, +k: F32, +co: R.Real, +si: R.Real) -> R.Real:
  R.mul(R.from_f32(k), R.sub(R.mul(s, co), R.mul(c, si)))

# cos kθ, sin kθ for k = 1..4 by the angle-addition recurrence.
type Harm is Data:
  Harm{c1: R.Real, s1: R.Real, c2: R.Real, s2: R.Real, c3: R.Real, s3: R.Real, c4: R.Real, s4: R.Real}

def harms(+t: R.Real) -> Harm:
  +co = R.cos(t)
  +si = R.sin(t)
  +c2 = R.sub(sq(co), sq(si))
  +s2 = R.mul(rl(2.0), R.mul(si, co))
  +c3 = R.sub(R.mul(c2, co), R.mul(s2, si))
  +s3 = R.add(R.mul(s2, co), R.mul(c2, si))
  Harm{co, si, c2, s2, c3, s3, R.sub(R.mul(c3, co), R.mul(s3, si)), R.add(R.mul(s3, co), R.mul(c3, si))}

def v2.harm(+c0: R.Real, +c1: R.Real, +s1: R.Real, +c2: R.Real, +s2: R.Real, +c3: R.Real, +s3: R.Real, +c4: R.Real, +s4: R.Real, +hs: Harm, +m2: R.Real, +e: R.Real) -> V2:
  Harm{+h1, +g1, +h2, +g2, +h3, +g3, +h4, +g4} = hs
  +val = R.add(R.add(c0, R.add(harm_v(c1, s1, h1, g1), harm_v(c2, s2, h2, g2))), R.add(harm_v(c3, s3, h3, g3), harm_v(c4, s4, h4, g4)))
  +der = R.add(R.add(harm_d(c1, s1, 1.0, h1, g1), harm_d(c2, s2, 2.0, h2, g2)), R.add(harm_d(c3, s3, 3.0, h3, g3), harm_d(c4, s4, 4.0, h4, g4)))
  V2{val, der, m2, e}

def v2_at(+f: Fn, +t: R.Real) -> V2:
  match f:
    case FPoly{+c0, +c1, +c2, +c3, +c4, e}:
      +t2 = sq(t)
      +val = R.add(R.add(c0, R.mul(c1, t)), R.add(R.mul(c2, t2), R.add(R.mul(c3, R.mul(t2, t)), R.mul(c4, sq(t2)))))
      +der = R.add(R.add(c1, R.mul(rl(2.0), R.mul(c2, t))), R.add(R.mul(rl(3.0), R.mul(c3, t2)), R.mul(rl(4.0), R.mul(c4, R.mul(t2, t)))))
      +m2 = R.add(R.add(R.mul(rl(2.0), R.abs(c2)), R.mul(rl(6.0), R.abs(c3))), R.mul(rl(12.0), R.abs(c4)))
      V2{val, der, m2, e}
    case FTrig{c0, +c1, +s1, +c2, +s2, +c3, +s3, +c4, +s4, e}:
      +m2 = R.add(R.add(R.add(R.abs(c1), R.abs(s1)), R.mul(rl(4.0), R.add(R.abs(c2), R.abs(s2)))), R.add(R.mul(rl(9.0), R.add(R.abs(c3), R.abs(s3))), R.mul(rl(16.0), R.add(R.abs(c4), R.abs(s4)))))
      v2.harm(c0, c1, s1, c2, s2, c3, s3, c4, s4, harms(t), m2, e)

# Taylor slack over a half-width h: |f'| h + ½ M₂ h² + e.
def slack(+v: V2, +h: R.Real) -> R.Real:
  V2{_, +d, +m2, +e} = v
  R.add(R.add(R.mul(R.abs(d), h), R.mul(half(), R.mul(m2, sq(h)))), e)

def v_f(+v: V2) -> R.Real:
  V2{+f, _, _, _} = v
  f

# Lower and upper bounds of f on [t − h, t + h].
def lo(+f: Fn, +t: R.Real, +h: R.Real) -> R.Real:
  +v = v2_at(f, t)
  R.sub(v_f(v), slack(v, h))

def hi(+f: Fn, +t: R.Real, +h: R.Real) -> R.Real:
  +v = v2_at(f, t)
  R.add(v_f(v), slack(v, h))

# ---------------------------------------------------------------------------
# Regions

# SLine: straight strip (start p_s, unit direction t, length len, width w).
# SArc: circular strip (centre o, unit normal n, radius r, in-plane unit
# directions x0 (start) and x1 (end), sweep phi, closed, width w).
# STri: end triangle. SNone: a blend edge that is neither a line nor a circle
# (no certified strip: every test refuses, state 3).
type Region is Data:
  SNone{}
  SLine{ps: G.Vec3, t: G.Vec3, len: R.Real, w: R.Real}
  SArc{o: G.Vec3, n: G.Vec3, r: R.Real, x0: G.Vec3, x1: G.Vec3, phi: R.Real, closed: Bool, w: R.Real}
  STri{p1: G.Vec3, p2: G.Vec3, p3: G.Vec3}

# The strip of an edge curve over its parameter interval (t0 → t0 + dt).
def strip.line(+ps: G.Vec3, +pe: G.Vec3, +w: R.Real) -> Region:
  SLine{ps, unit(G.sub(pe, ps)), norm(G.sub(pe, ps)), w}

def strip.arc(+o: G.Vec3, +n: G.Vec3, +r: R.Real, +ps: G.Vec3, +pe: G.Vec3, +dt: R.Real, +closed: Bool, +w: R.Real) -> Region:
  +back = R.less(dt, zero())
  +x0 = unit(S.radial(o, n, Bool.pick(G.Vec3, back, pe, ps)))
  +x1 = unit(S.radial(o, n, Bool.pick(G.Vec3, back, ps, pe)))
  SArc{o, n, r, x0, x1, R.abs(dt), closed, w}

def strip_of(+c: J.Curve, +t0: R.Real, +dt: R.Real, +closed: Bool, +w: R.Real) -> Region:
  match c:
    case J.Circle{+o, +n0, _, +r}:
      strip.arc(o, unit(n0), r, point_at(c, t0), point_at(c, R.add(t0, dt)), dt, closed, w)
    case J.Line{_, _}:
      strip.line(point_at(c, t0), point_at(c, R.add(t0, dt)), w)
    case _:
      SNone{}

# Unit normal of the triangle (from unit sides: a triangle of 1e-5 mm sides
# has |(p2 − p1) × (p3 − p1)|² = 1e-20, the floor of unit()).
def tri_n(+p1: G.Vec3, +p2: G.Vec3, +p3: G.Vec3) -> G.Vec3:
  unit(G.cross(unit(G.sub(p2, p1)), unit(G.sub(p3, p1))))

# Inward unit normal of side (a, b) in the plane of the triangle.
def side_in(+a: G.Vec3, +b: G.Vec3, +nt: G.Vec3) -> G.Vec3:
  unit(G.cross(nt, unit(G.sub(b, a))))

# Distance of q from the line of side (a, b), positive towards the inside.
def side_d(+a: G.Vec3, +b: G.Vec3, +nt: G.Vec3, +q: G.Vec3) -> R.Real:
  G.dot(G.sub(q, a), side_in(a, b, nt))

def side_qd(+a: G.Vec3, +b: G.Vec3, +nt: G.Vec3) -> Qd:
  Qd{a, zero(), zero(), nt, side_in(a, b, nt), zero()}

# Outward bisector at vertex p (neighbours a, b): the triangle lies in
# (x − p)·u ≤ 0. Beyond an acute vertex the side bands (all σ_i > −τ/2)
# reach out to τ/sin(angle); this function certifies that needle.
def vert_qd(+p: G.Vec3, +a: G.Vec3, +b: G.Vec3) -> Qd:
  +u = unit(S.vneg(G.add(unit(G.sub(a, p)), unit(G.sub(b, p)))))
  Qd{p, zero(), zero(), u, u, zero()}

def seg_d(+q: G.Vec3, +a: G.Vec3, +b: G.Vec3) -> R.Real:
  +ab = G.sub(b, a)
  +t = R.div(G.dot(G.sub(q, a), ab), G.dot(ab, ab))
  +tc = R.max(zero(), R.min(one(), t))
  norm(G.sub(q, G.add(a, G.scale(ab, tc))))

# In-plane distance of q from the triangle (0 inside).
def tri_dist(+q: G.Vec3, +p1: G.Vec3, +p2: G.Vec3, +p3: G.Vec3, +d1: R.Real, +d2: R.Real, +d3: R.Real) -> R.Real:
  +inside = Bool.and(Bool.not(R.less(d1, zero())), Bool.and(Bool.not(R.less(d2, zero())), Bool.not(R.less(d3, zero()))))
  Bool.pick(R.Real, inside, zero(), R.min(seg_d(q, p1, p2), R.min(seg_d(q, p2, p3), seg_d(q, p3, p1))))

def band(+x: R.Real, +deep: Bool) -> Bool:
  Bool.pick(Bool, deep, R.less(mtol(), x), R.less(R.neg(mtol()), x))

# Range test of the circular strip at q (σ_s, σ_e, with deep or touch band).
def arc_range(+phi: R.Real, +closed: Bool, +ss: R.Real, +se: R.Real, +deep: Bool) -> Bool:
  +both = Bool.and(band(ss, deep), band(se, deep))
  +either = Bool.or(band(ss, deep), band(se, deep))
  Bool.pick(Bool, closed, True{}, Bool.pick(Bool, R.less(R.pi(), phi), either, both))

def arc_sig(+o: G.Vec3, +n: G.Vec3, +x: G.Vec3, +q: G.Vec3) -> R.Real:
  G.dot(G.sub(q, o), G.cross(n, x))

def state_k(+inside: Bool, +touch: Bool) -> U32:
  Bool.pick(U32, inside, 2, Bool.pick(U32, touch, 1, 0))

# Point state of q (0 clear, 1 touch, 2 inside; see the header).
def state(+g: Region, +q: G.Vec3) -> U32:
  match g:
    case SNone{}:
      3
    case SLine{+ps, +t, +len, +w}:
      +s = G.dot(G.sub(q, ps), t)
      +d = norm(G.sub(G.sub(q, ps), G.scale(t, s)))
      +se = R.sub(len, s)
      +inside = Bool.and(Bool.and(band(s, True{}), band(se, True{})), R.less(d, R.sub(w, mtol())))
      +touch = Bool.and(Bool.and(band(s, False{}), band(se, False{})), R.less(d, R.add(w, mtol())))
      state_k(inside, touch)
    case SArc{+o, +n, +r, +x0, +x1, +phi, +closed, +w}:
      +v = G.sub(q, o)
      +h = G.dot(v, n)
      +rho = norm(G.sub(v, G.scale(n, h)))
      +d = R.sqrt(R.add(sq(R.sub(rho, r)), sq(h)))
      +ss = arc_sig(o, n, x0, q)
      +se = R.neg(arc_sig(o, n, x1, q))
      +inside = Bool.and(arc_range(phi, closed, ss, se, True{}), R.less(d, R.sub(w, mtol())))
      +touch = Bool.and(arc_range(phi, closed, ss, se, False{}), R.less(d, R.add(w, mtol())))
      state_k(inside, touch)
    case STri{+p1, +p2, +p3}:
      +nt = tri_n(p1, p2, p3)
      +d1 = side_d(p1, p2, nt, q)
      +d2 = side_d(p2, p3, nt, q)
      +d3 = side_d(p3, p1, nt, q)
      +inside = Bool.and(band(d1, True{}), Bool.and(band(d2, True{}), band(d3, True{})))
      +touch = R.less(tri_dist(q, p1, p2, p3, d1, d2, d3), mtol())
      state_k(inside, touch)

# The region's functions on one edge piece.
type Test is Data:
  TNone{}
  TLine{ss: Fn, se: Fn, dd: Fn}
  TArc{ss: Fn, se: Fn, xx: Fn, gg: Fn, phi: R.Real, closed: Bool}
  TTri{d1: Fn, d2: Fn, d3: Fn, u1: Fn, u2: Fn, u3: Fn}

def test_of(+g: Region, +k: Crv) -> Test:
  match g:
    case SNone{}:
      TNone{}
    case SLine{+ps, +t, +len, +w}:
      +wc = R.add(w, half_mtol())
      +ss = fn_of(Qd{ps, zero(), zero(), t, t, zero()}, k)
      +se = fn_of(Qd{ps, zero(), zero(), t, G.scale(t, R.neg(one())), len}, k)
      +dd = fn_of(Qd{ps, one(), one(), t, G.v3(0.0, 0.0, 0.0), R.neg(sq(wc))}, k)
      TLine{ss, se, dd}
    case SArc{+o, +n, +r, +x0, +x1, +phi, +closed, +w}:
      +wc = R.add(w, half_mtol())
      +ss = fn_of(Qd{o, zero(), zero(), n, G.cross(n, x0), zero()}, k)
      +se = fn_of(Qd{o, zero(), zero(), n, G.scale(G.cross(n, x1), R.neg(one())), zero()}, k)
      +xx = fn_of(Qd{o, one(), zero(), n, G.v3(0.0, 0.0, 0.0), R.sub(sq(r), sq(wc))}, k)
      +rr = fn_of(Qd{o, one(), one(), n, G.v3(0.0, 0.0, 0.0), zero()}, k)
      TArc{ss, se, xx, fn_g(xx, rr, R.mul(rl(4.0), sq(r))), phi, closed}
    case STri{+p1, +p2, +p3}:
      +nt = tri_n(p1, p2, p3)
      TTri{fn_of(side_qd(p1, p2, nt), k), fn_of(side_qd(p2, p3, nt), k), fn_of(side_qd(p3, p1, nt), k), fn_of(vert_qd(p1, p2, p3), k), fn_of(vert_qd(p2, p3, p1), k), fn_of(vert_qd(p3, p1, p2), k)}

# f ≤ −τ/2 on the piece (the point is certainly out of that range/side).
def out(+f: Fn, +t: R.Real, +h: R.Real) -> Bool:
  Bool.not(R.less(R.neg(half_mtol()), hi(f, t, h)))

# f ≥ τ/2 on the piece.
def beyond(+f: Fn, +t: R.Real, +h: R.Real) -> Bool:
  Bool.not(R.less(lo(f, t, h), half_mtol()))

def nonneg(+f: Fn, +t: R.Real, +h: R.Real) -> Bool:
  Bool.not(R.less(lo(f, t, h), zero()))

def clear_range(+ss: Fn, +se: Fn, +phi: R.Real, +closed: Bool, +t: R.Real, +h: R.Real) -> Bool:
  match closed:
    case True{}:
      False{}
    case False{}:
      +os = out(ss, t, h)
      +oe = out(se, t, h)
      Bool.pick(Bool, R.less(R.pi(), phi), Bool.and(os, oe), Bool.or(os, oe))

# Lazy and/or: the second test runs only when the first does not decide.
def and_then.arc_g(+ok: Bool, +gg: Fn, +t: R.Real, +h: R.Real) -> Bool:
  match ok:
    case True{}:
      nonneg(gg, t, h)
    case False{}:
      False{}

def or_else.arc_range(+ok: Bool, +ss: Fn, +se: Fn, +phi: R.Real, +closed: Bool, +t: R.Real, +h: R.Real) -> Bool:
  match ok:
    case True{}:
      True{}
    case False{}:
      clear_range(ss, se, phi, closed, t, h)

def clear_arc(+ss: Fn, +se: Fn, +xx: Fn, +gg: Fn, +phi: R.Real, +closed: Bool, +t: R.Real, +h: R.Real) -> Bool:
  or_else.arc_range(and_then.arc_g(nonneg(xx, t, h), gg, t, h), ss, se, phi, closed, t, h)

# Every point of the piece [t − h, t + h] is certainly clear.
def clear(+x: Test, +t: R.Real, +h: R.Real) -> Bool:
  match x:
    case TNone{}:
      False{}
    case TLine{+ss, +se, +dd}:
      Bool.or(Bool.or(out(ss, t, h), out(se, t, h)), nonneg(dd, t, h))
    case TArc{+ss, +se, +xx, +gg, +phi, +closed}:
      clear_arc(ss, se, xx, gg, phi, closed, t, h)
    case TTri{+d1, +d2, +d3, +u1, +u2, +u3}:
      +sides = Bool.or(Bool.or(out(d1, t, h), out(d2, t, h)), out(d3, t, h))
      Bool.or(sides, Bool.or(Bool.or(beyond(u1, t, h), beyond(u2, t, h)), beyond(u3, t, h)))

# One edge piece, decided when it is made: clear, refused with a state
# (1 touch, 2 inside, 3 not certified: the depth limit), or to be split.
type Node is Data:
  NClear{}
  NRefuse{s: U32}
  NSplit{a: R.Real, m: R.Real, b: R.Real, depth: U32}

def max_depth() -> U32:
  48

def node.piece(+piece_clear: Bool, +a: R.Real, +m: R.Real, +b: R.Real, +depth: U32) -> Node:
  Bool.pick(Node, piece_clear, NClear{}, Bool.pick(Node, U32.is_lt(depth, max_depth()), NSplit{a, m, b, depth}, NRefuse{3}))

# A ball around the region: SLine: the segment's mid point, len/2 + w;
# SArc: the centre, r + w; STri: p1 and its farthest vertex.
def region_ball(+g: Region) -> G.Vec3 & R.Real:
  match g:
    case SNone{}:
      (G.v3(0.0, 0.0, 0.0), S.huge())
    case SLine{ps, t, +len, w}:
      (G.add(ps, G.scale(t, R.mul(half(), len))), R.add(R.mul(half(), len), w))
    case SArc{o, _, r, _, _, _, _, w}:
      (o, R.add(r, w))
    case STri{+p1, p2, p3}:
      (p1, R.max(norm(G.sub(p2, p1)), norm(G.sub(p3, p1))))

# Radius of a ball around the piece's mid point holding the whole piece of
# parameter half-width h (lines: |dv| h; arcs: max(|a|, |b|)·min(h, 2), the
# arc length and the diameter).
def piece_reach(+k: Crv, +h: R.Real) -> R.Real:
  match k:
    case CLin{_, dv}:
      R.mul(norm(dv), h)
    case CTri{_, a, b}:
      R.mul(R.max(norm(a), norm(b)), R.min(h, rl(2.0)))

def far.k(+q: G.Vec3, +reach: R.Real, ball: G.Vec3 & R.Real) -> Bool:
  (+c, +rad) = ball
  R.less(R.add(R.add(rad, half_mtol()), reach), norm(G.sub(q, c)))

# The whole piece lies outside the region's ball by more than τ/2: clear
# without the Taylor bounds (most edges of a face are far from a blend).
def far(+g: Region, +k: Crv, +q: G.Vec3, +h: R.Real) -> Bool:
  far.k(q, piece_reach(k, h), region_ball(g))

def node.near(+is_far: Bool, +x: Test, +a: R.Real, +m: R.Real, +b: R.Real, +depth: U32) -> Node:
  match is_far:
    case True{}:
      NClear{}
    case False{}:
      node.piece(clear(x, m, R.mul(half(), R.sub(b, a))), a, m, b, depth)

def node.k(+point_clear: Bool, +s: U32, +is_far: Bool, +x: Test, +a: R.Real, +m: R.Real, +b: R.Real, +depth: U32) -> Node:
  match point_clear:
    case False{}:
      NRefuse{s}
    case True{}:
      node.near(is_far, x, a, m, b, depth)

def node_of(+g: Region, +x: Test, +k: Crv, +a: R.Real, +b: R.Real, +depth: U32) -> Node:
  +m = R.mul(half(), R.add(a, b))
  +q = crv_at(k, m)
  +s = state(g, q)
  node.k(U32.is_eq(s, 0), s, far(g, k, q, R.mul(half(), R.sub(b, a))), x, a, m, b, depth)

# 0 clear, 1 touch, 2 inside, 3 not certified: the first refusing piece in
# parameter order decides (a point state is exact; splitting stops there).
# fuel bounds the number of pieces looked at (3 when exhausted).
def cert(fuel: Nat, +g: Region, +x: Test, +k: Crv, stack: List<&2, Node>) -> U32:
  match fuel:
    case 0n:
      Bool.pick(U32, List.is_empty(&2, Node, stack), 0, 3)
    case 1n+f:
      match stack:
        case Nil{}:
          0
        case h <> t:
          match h:
            case NClear{}:
              cert(f, g, x, k, t)
            case NRefuse{s}:
              s
            case NSplit{+a, +m, +b, +depth}:
              +d1 = (depth + 1 : U32)
              cert(f, g, x, k, node_of(g, x, k, a, m, d1) <> node_of(g, x, k, m, b, d1) <> t)

# State of the job curve c over its parameter interval [t0, t1] against the
# region g.
def curve_state.k(+g: Region, +d: Dom) -> U32:
  Dom{+k, +a, +b} = d
  +x = test_of(g, k)
  cert(4096n, g, x, k, node_of(g, x, k, a, b, 0) <> Nil{})

def curve_state(+g: Region, +c: J.Curve, +t0: R.Real, +t1: R.Real) -> U32:
  curve_state.k(g, dom_of(c, t0, t1))
