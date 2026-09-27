import Base
import ../../real.bend as R
import ../../precise.bend as G
import ./job.bend as J
import ./geom.bend as S
import ./contact.bend as C
import ./obrep.bend as O

# Stage C2 of prototype C (docs/fillet/proto-rollingball.md): the output
# geometry of one blend, fitted to the certified stations of stage C1.
#
# Shared by both output variants:
#   - the springs (contact curves) are recognised as a point, a line or a
#     circle from all 65 stations; every station must lie within 1e-9 mm of
#     the fitted curve, otherwise the blend is refused (a spring off an exact
#     support needs a toleranced support face, not built here);
#   - the end sections are exact: the arc of radius r about the end ball
#     centre (fillet) or the segment between the contact points (chamfer).
#
# Variant "tori" (the task's C1): the spine (the ball centres) is replaced by
# one arc or line fitted to the stations: cylinder, torus or sphere (fillet),
# plane or cone (chamfer). Variant "spline" (the task's C2): a bicubic B-spline
# skinned from the station sections (fillet: 8 cubic Bezier spans per
# section arc; chamfer: linear), Hermite in v over the 33 even stations with
# tangents from 7-point differences, or, on a circular edge with coaxial
# supports (a rim: the true blend is a surface of revolution), the exact
# rotation derivative with the arm length of the best circular cubic,
# 4/3 tan(θ/4) per unit radius, whose analytic error bound is added to the
# certificate. Both keep the boundary of the spline within about 1e-8 mm of
# the exact springs and end sections (4 spans and difference tangents left
# up to 2e-5 mm on rims: more than the 1e-7 mm OpenCascade gives the edges
# of an imported STEP, so those exports failed the strict CurveOnSurface
# check). Both variants measure the distance of
# their surface from the true rolling-ball blend at all 65 stations (the odd
# ones are not used by the spline fit) and state a tolerance: the smallest of
# 1e-9, 1e-8, ..., 1e-2 mm at or above twice the measured deviation.

# ---------------------------------------------------------------------------
# Small helpers

def rl(x: F32) -> R.Real:
  R.from_f32(x)

def zero() -> R.Real:
  R.from_f32(0.0)

def one() -> R.Real:
  R.from_f32(1.0)

def eps() -> R.Real:
  R.div(one(), R.from_f32(1000000000.0))

def norm(+v: G.Vec3) -> R.Real:
  R.sqrt(G.dot(v, v))

def dist(+a: G.Vec3, +b: G.Vec3) -> R.Real:
  norm(G.sub(a, b))

def unit(+v: G.Vec3) -> G.Vec3:
  S.unit_or(v, G.v3(1.0, 0.0, 0.0))

def mid(+a: G.Vec3, +b: G.Vec3) -> G.Vec3:
  G.scale(G.add(a, b), rl(0.5))

def lin(+a: G.Vec3, +b: G.Vec3, +t: R.Real) -> G.Vec3:
  G.add(a, G.scale(G.sub(b, a), t))

def two_pi() -> R.Real:
  R.mul(R.pi(), rl(2.0))

# A unit vector orthogonal to the unit vector a.
def perp(+a: G.Vec3) -> G.Vec3:
  G.V3{+x, +y, +z} = a
  +useX = R.less(R.abs(x), rl(0.6))
  unit(G.cross(a, Bool.pick(G.Vec3, useX, G.v3(1.0, 0.0, 0.0), G.v3(0.0, 1.0, 0.0))))

def tol.go(n: Nat, +x: R.Real, +k: F32) -> R.Real:
  match n:
    case 0n:
      Bool.pick(R.Real, R.less(x, R.div(one(), R.from_f32(k))), R.div(one(), R.from_f32(k)), one())
    case 1n+p:
      +t = R.div(one(), R.from_f32(k))
      Bool.pick(R.Real, Bool.not(R.less(t, x)), t, tol.go(p, x, (k / 10.0 : F32)))

# Stated tolerance: the smallest 10^-k (k = 9..2) at or above twice the
# measured deviation; 1 when that is above 1e-2 (the caller refuses then).
def tol_of(+dev: R.Real) -> R.Real:
  tol.go(7n, R.mul(dev, rl(2.0)), 1000000000.0)

# ---------------------------------------------------------------------------
# Station accessors

def st_p(+s: C.St) -> G.Vec3:
  C.St{_, _, +p, _, _, _, _, _, _} = s
  p

def st_c(+s: C.St) -> G.Vec3:
  C.St{_, _, _, +c, _, _, _, _, _} = s
  c

def st_pa(+s: C.St) -> G.Vec3:
  C.St{_, _, _, _, +pa, _, _, _, _} = s
  pa

def st_pb(+s: C.St) -> G.Vec3:
  C.St{_, _, _, _, _, +pb, _, _, _} = s
  pb

def st_t(+s: C.St) -> R.Real:
  C.St{_, +t, _, _, _, _, _, _, _} = s
  t

# which: 0 centre, 1 contact A, 2 contact B, 3 edge point
def st_pick(+which: U32, +s: C.St) -> G.Vec3:
  match which:
    case 0:
      st_c(s)
    case 1:
      st_pa(s)
    case 2:
      st_pb(s)
    case _:
      st_p(s)

def points(+which: U32, sts: List<&2, C.St>) -> List<&2, G.Vec3>:
  match sts:
    case Nil{}:
      Nil{}
    case +h <> t:
      st_pick(which, h) <> points(which, t)

def nth_p(+ps: List<&2, G.Vec3>, +k: Nat) -> G.Vec3:
  S.or_zero(List.get(&2, G.Vec3, ps, k))

def st.or(m: Maybe<&2, C.St>) -> C.St:
  match m:
    case Some{s}:
      s
    case None{}:
      C.St{0, zero(), G.v3(0.0, 0.0, 0.0), G.v3(0.0, 0.0, 0.0), G.v3(0.0, 0.0, 0.0), G.v3(0.0, 0.0, 0.0), zero(), zero(), zero()}

def nth_st(+sts: List<&2, C.St>, +k: Nat) -> C.St:
  st.or(List.get(&2, C.St, sts, k))

def last_p(+ps: List<&2, G.Vec3>) -> G.Vec3:
  S.or_zero(List.last(&2, G.Vec3, ps))

# ---------------------------------------------------------------------------
# Curve recognition

type Fit is Data:
  FPoint{p: G.Vec3}
  FLine{o: G.Vec3, d: G.Vec3, dev: R.Real}
  FCirc{o: G.Vec3, n: G.Vec3, r: R.Real, dev: R.Real}
  FNone{dev: R.Real}

def far(ps: List<&2, G.Vec3>, +p0: G.Vec3, +acc: R.Real) -> R.Real:
  match ps:
    case Nil{}:
      acc
    case +h <> t:
      far(t, p0, R.max(acc, dist(h, p0)))

def line_d(+p: G.Vec3, +o: G.Vec3, +d: G.Vec3) -> R.Real:
  +v = G.sub(p, o)
  norm(G.sub(v, G.scale(d, G.dot(v, d))))

def line_dev(ps: List<&2, G.Vec3>, +o: G.Vec3, +d: G.Vec3, +acc: R.Real) -> R.Real:
  match ps:
    case Nil{}:
      acc
    case +h <> t:
      line_dev(t, o, d, R.max(acc, line_d(h, o, d)))

def circ_d(+p: G.Vec3, +o: G.Vec3, +n: G.Vec3, +r: R.Real) -> R.Real:
  +v = G.sub(p, o)
  +h = G.dot(v, n)
  +rho = norm(G.sub(v, G.scale(n, h)))
  +dr = R.sub(rho, r)
  R.sqrt(R.add(R.mul(h, h), R.mul(dr, dr)))

def circ_dev(ps: List<&2, G.Vec3>, +o: G.Vec3, +n: G.Vec3, +r: R.Real, +acc: R.Real) -> R.Real:
  match ps:
    case Nil{}:
      acc
    case +h <> t:
      circ_dev(t, o, n, r, R.max(acc, circ_d(h, o, n, r)))

# Circle through three points: (centre, unit normal, radius); a unit normal
# of (0,0,0) marks collinear points.
type Circ3 is Data:
  Circ3{o: G.Vec3, n: G.Vec3, r: R.Real}

def circ3(+p0: G.Vec3, +p1: G.Vec3, +p2: G.Vec3) -> Circ3:
  +a = G.sub(p0, p2)
  +b = G.sub(p1, p2)
  +axb = G.cross(a, b)
  +den0 = R.mul(rl(2.0), G.dot(axb, axb))
  +bad = R.less(den0, R.mul(eps(), eps()))
  +den = Bool.pick(R.Real, bad, one(), den0)
  +num = G.cross(G.sub(G.scale(b, G.dot(a, a)), G.scale(a, G.dot(b, b))), axb)
  +o = G.add(p2, G.scale(num, R.div(one(), den)))
  Circ3{o, Bool.pick(G.Vec3, bad, G.v3(0.0, 0.0, 0.0), unit(axb)), dist(p0, o)}

def fit.circle(+ps: List<&2, G.Vec3>, +c: Circ3, +ldev: R.Real) -> Fit:
  Circ3{+o, +n, +r} = c
  +cdev = circ_dev(ps, o, n, r, zero())
  +flat = R.less(G.dot(n, n), rl(0.5))
  +cd = Bool.pick(R.Real, flat, S.huge(), cdev)
  Bool.pick(Fit, R.less(cd, eps()), FCirc{o, n, r, cd}, FNone{R.min(ldev, cd)})

# Recognise the curve through the station points (65 of them, in edge order).
def fit(+ps: List<&2, G.Vec3>, +closed: Bool) -> Fit:
  +p0 = nth_p(ps, 0n)
  +pn = last_p(ps)
  +spread = far(ps, p0, zero())
  +d = unit(G.sub(pn, p0))
  +ldev = Bool.pick(R.Real, closed, S.huge(), line_dev(ps, p0, d, zero()))
  +c3 = Bool.pick(Circ3, closed, circ3(p0, nth_p(ps, 21n), nth_p(ps, 43n)), circ3(p0, nth_p(ps, 32n), pn))
  +asLine = Bool.pick(Fit, R.less(ldev, eps()), FLine{p0, d, ldev}, fit.circle(ps, c3, ldev))
  Bool.pick(Fit, R.less(spread, eps()), FPoint{p0}, asLine)

def fit_dev(+f: Fit) -> R.Real:
  match f:
    case FPoint{_}:
      zero()
    case FLine{_, _, d}:
      d
    case FCirc{_, _, _, d}:
      d
    case FNone{d}:
      d

def fit_kind(+f: Fit) -> U32:
  match f:
    case FPoint{_}:
      0
    case FLine{_, _, _}:
      1
    case FCirc{_, _, _, _}:
      2
    case FNone{_}:
      3

# ---------------------------------------------------------------------------
# Edge shapes (an edge without its vertex indices)

type Shape is Data:
  Shape{curve: J.Curve, same: U32, ranged: U32, first: R.Real, last: R.Real}

def shape_edge(+s: U32, +e: U32, +sh: Shape) -> O.OEdge:
  Shape{+c, +same, +ranged, +first, +last} = sh
  O.OEdge{s, e, c, same, ranged, first, last}

def line_shape(+p: G.Vec3, +q: G.Vec3) -> Shape:
  Shape{J.Line{p, unit(G.sub(q, p))}, 1, 1, zero(), dist(p, q)}

# Angle in (0, 2π] from u to v about the unit normal n.
def angle_about(+u: G.Vec3, +v: G.Vec3, +n: G.Vec3) -> R.Real:
  +a = R.atan2(G.dot(G.cross(u, v), n), G.dot(u, v))
  Bool.pick(R.Real, R.less(zero(), a), a, R.add(a, two_pi()))

# The arc of radius r about c from pf to pt that passes through m. The
# plane normal is taken from the UNIT radii: |u × (m − c)|² = r⁴ sin²(·) falls
# below the 1e-20 floor of unit() for r below about 1e-5 mm (r = 1e-5 at a
# 90° section: 5e-21), and the fallback (1,0,0) turned the start section of
# such a blend into a 270° arc.
def arc_shape(+c: G.Vec3, +r: R.Real, +pf: G.Vec3, +pt: G.Vec3, +m: G.Vec3) -> Shape:
  +u = G.sub(pf, c)
  +n = unit(G.cross(unit(u), unit(G.sub(m, c))))
  Shape{J.Circle{c, n, unit(u), r}, 1, 1, zero(), angle_about(u, G.sub(pt, c), n)}

# A closed circle through p0 (vertex) running towards p1.
def ring_shape(+o: G.Vec3, +n: G.Vec3, +r: R.Real, +p0: G.Vec3, +p1: G.Vec3) -> Shape:
  +turn = G.dot(G.cross(G.sub(p0, o), G.sub(p1, o)), n)
  +nn = Bool.pick(G.Vec3, R.less(turn, zero()), S.vneg(n), n)
  Shape{J.Circle{o, nn, unit(G.sub(p0, o)), r}, 1, 1, zero(), two_pi()}

# The spring shape of a recognised contact curve (ps: all 65 stations).
def spring.k(+f: Fit, +p0: G.Vec3, +pn: G.Vec3, +p16: G.Vec3, +p32: G.Vec3, +closed: Bool) -> Shape:
  match f:
    case FLine{_, _, _}:
      line_shape(p0, pn)
    case FCirc{o, n, r, _}:
      Bool.pick(Shape, closed, ring_shape(o, n, r, p0, p16), arc_shape(o, r, p0, pn, p32))
    case _:
      line_shape(p0, pn)

def spring_shape(+f: Fit, +ps: List<&2, G.Vec3>, +closed: Bool) -> Shape:
  spring.k(f, nth_p(ps, 0n), last_p(ps), nth_p(ps, 16n), nth_p(ps, 32n), closed)

# ---------------------------------------------------------------------------
# Sections

# The mid point of the section arc of a fillet station: the ball point next
# to the edge. For a chamfer: the mid point of the contact segment.
def sec_mid(+op: U32, +size: R.Real, +s: C.St) -> G.Vec3:
  +c = st_c(s)
  Bool.pick(G.Vec3, U32.is_eq(op, 0), G.add(c, G.scale(unit(G.sub(st_p(s), c)), size)), mid(st_pa(s), st_pb(s)))

# Section at the start vertex, b_s -> a_s; at the end, a_e -> b_e; the rim
# seam a -> b.
def sec_shape(+op: U32, +size: R.Real, +s: C.St, +from_a: Bool) -> Shape:
  +pa = st_pa(s)
  +pb = st_pb(s)
  +pf = Bool.pick(G.Vec3, from_a, pa, pb)
  +pt = Bool.pick(G.Vec3, from_a, pb, pa)
  Bool.pick(Shape, U32.is_eq(op, 0), arc_shape(st_c(s), size, pf, pt, sec_mid(op, size, s)), line_shape(pf, pt))

# Outward reference normal of a blend (`nref`, from brep.bend): the sum of
# the two support faces' outward normals at the contact points of station 0.
# For a chamfer it is exactly the outward normal of the chamfer face
# ((p_B − p_A) × T ∝ n_A + n_B); for a fillet it points along the outward
# normal at the section mid point (convex: n_i = (q_i − c)/r, concave:
# (c − q_i)/r), so no convexity flag is needed. Its length is
# 2 cos(θ/2) for a normal angle θ, so it stays well defined next to tangency,
# where the edge point and the section mid point coincide to r(1/cos b − 1)
# (below 1e-10 mm at a normal angle of 1e-5 rad: that difference gave an
# arbitrary sense).

# Natural normal of an analytic surface at a point on it.
def an_normal(+s: J.Surf, +p: G.Vec3) -> G.Vec3:
  +ps = S.prep(s)
  S.sd_g(S.fsd(ps, one(), S.ref_of(ps, p), p))

def an_dist(+s: J.Surf, +p: G.Vec3) -> R.Real:
  R.abs(S.true_d(S.prep(s), one(), p))

def an_dev(+s: J.Surf, ps: List<&2, G.Vec3>, +acc: R.Real) -> R.Real:
  match ps:
    case Nil{}:
      acc
    case +h <> t:
      an_dev(s, t, R.max(acc, an_dist(s, h)))

# ---------------------------------------------------------------------------
# The fitted blend of one edge

# surf: the blend surface; same: its face sense; dev: measured distance from
# the true blend; tol: stated tolerance; kind: short text for refusals and the
# report ("cylinder", "torus", "sphere", "plane", "cone", "bspline 4x32").
type Surface is Data:
  SurfOk{surf: O.OSurf, same: U32, dev: R.Real, tol: R.Real, kind: String}
  SurfBad{cls: String, why: String}

# The decade a stated tolerance would need (2 x the measured deviation),
# as text for a refusal: no silent tolerance growth, the needed value is
# reported (the smallest listed decade above it).
type Lab is Data:
  Lab{t: F32, s: String}

def labels() -> List<&2, Lab>:
  Lab{0.000000001, "1e-9"} <> Lab{0.00000001, "1e-8"} <> Lab{0.0000001, "1e-7"} <> Lab{0.000001, "1e-6"} <> Lab{0.00001, "1e-5"} <> Lab{0.0001, "1e-4"} <> Lab{0.001, "1e-3"} <> Lab{0.01, "1e-2"} <> Lab{0.1, "0.1"} <> Lab{1.0, "1"} <> Lab{10.0, "10"} <> Lab{100.0, "100"} <> Nil{}

def need.pick(+hit: Bool, +lab: String, +rest: String) -> String:
  match hit:
    case True{}:
      lab
    case False{}:
      rest

def need.go(ls: List<&2, Lab>, +x: R.Real) -> String:
  match ls:
    case Nil{}:
      "more than 100"
    case +h <> t:
      Lab{+th, +lab} = h
      need.pick(R.less(x, R.from_f32(th)), lab, need.go(t, x))

def need_label(+dev: R.Real) -> String:
  need.go(labels(), R.mul(dev, rl(2.0)))

def surf_ok(+s: O.OSurf, +nat: G.Vec3, +nref: G.Vec3, +dev: R.Real, +kind: String) -> Surface:
  +tol = tol_of(dev)
  +same = Bool.to_u32(R.less(zero(), G.dot(nat, nref)))
  Bool.pick(Surface, R.less(rl(0.01), tol), SurfBad{"not-implemented", "the " ++ kind ++ " fit deviates more than 0.005 mm from the rolling-ball blend: a stated tolerance of " ++ need_label(dev) ++ " mm would be needed, above the 0.01 mm limit (not grown silently)"}, SurfOk{s, same, dev, tol, kind})

def sec_mids(+op: U32, +size: R.Real, sts: List<&2, C.St>) -> List<&2, G.Vec3>:
  match sts:
    case Nil{}:
      Nil{}
    case +h <> t:
      sec_mid(op, size, h) <> sec_mids(op, size, t)

# Variant "tori": fillet carrier from the spine.
def tori.fillet.an(+sf: J.Surf, +kind: String, +spinedev: R.Real, +op: U32, +size: R.Real, +nref: G.Vec3, +sts: List<&2, C.St>) -> Surface:
  +s0 = nth_st(sts, 0n)
  +m0 = sec_mid(op, size, s0)
  +mids = sec_mids(op, size, sts)
  +dev = an_dev(sf, points(1, sts), an_dev(sf, points(2, sts), an_dev(sf, mids, spinedev)))
  surf_ok(O.OAn{sf}, an_normal(sf, m0), nref, dev, kind)

def tori.fillet.k(+spine: Fit, +op: U32, +size: R.Real, +nref: G.Vec3, +sts: List<&2, C.St>, +c0: G.Vec3, +a0: G.Vec3, +x0: G.Vec3) -> Surface:
  match spine:
    case FPoint{_}:
      # Sphere cap: the axis runs to the pole (the collapsed spring A) and x
      # to the contact point on B, so the section X is the parametrization
      # seam (u = 0) from the pole to the equator.
      +pb0 = G.sub(st_pb(nth_st(sts, 0n)), c0)
      tori.fillet.an(J.Sphere{c0, x0, unit(G.sub(pb0, G.scale(x0, G.dot(pb0, x0)))), size}, "sphere", zero(), op, size, nref, sts)
    case FLine{_, d, dv}:
      tori.fillet.an(J.Cyl{c0, d, unit(G.sub(x0, G.scale(d, G.dot(x0, d)))), size}, "cylinder", dv, op, size, nref, sts)
    case FCirc{o, n, r, dv}:
      tori.fillet.an(J.Torus{o, n, unit(G.sub(c0, o)), r, size}, "torus", dv, op, size, nref, sts)
    case FNone{dv}:
      SurfBad{"not-implemented", "the spine (ball centres) is not one arc or line within 1e-9 mm; a chain of several bi-arcs (several tori) is not built"}

def tori.fillet(+op: U32, +size: R.Real, +nref: G.Vec3, +sts: List<&2, C.St>, +spine: Fit) -> Surface:
  +s0 = nth_st(sts, 0n)
  +c0 = st_c(s0)
  tori.fillet.k(spine, op, size, nref, sts, c0, unit(G.sub(st_p(s0), c0)), unit(G.sub(st_pa(s0), c0)))

# Variant "tori": chamfer carrier from the two springs.
def tori.chamfer.cone(+oa: G.Vec3, +na: G.Vec3, +ra: R.Real, +ob: G.Vec3, +rb: R.Real, +op: U32, +size: R.Real, +nref: G.Vec3, +sts: List<&2, C.St>) -> Surface:
  +h = G.dot(G.sub(ob, oa), na)
  +s0 = nth_st(sts, 0n)
  +x = unit(G.sub(st_pa(s0), oa))
  +flat = R.less(R.abs(h), eps())
  +sf = Bool.pick(J.Surf, flat, J.Plane{oa, na, x}, J.Cone{oa, na, x, ra, R.atan(R.div(R.sub(rb, ra), Bool.pick(R.Real, flat, one(), h)))})
  +kind = Bool.pick(String, flat, "plane", "cone")
  tori.fillet.an(sf, kind, zero(), op, size, nref, sts)

def chamfer_bad() -> Surface:
  SurfBad{"unsupported-surface", "the chamfer contact curves are not two lines or two coaxial circles"}

def tori.chamfer.circ(+oa: G.Vec3, +na: G.Vec3, +ra: R.Real, +fb: Fit, +op: U32, +size: R.Real, +nref: G.Vec3, +sts: List<&2, C.St>) -> Surface:
  match fb:
    case FCirc{ob, nb, rb, _}:
      +coax = Bool.and(R.less(norm(G.cross(na, nb)), eps()), R.less(norm(G.cross(G.sub(ob, oa), na)), eps()))
      Bool.pick(Surface, coax, tori.chamfer.cone(oa, na, ra, ob, rb, op, size, nref, sts), chamfer_bad())
    case _:
      chamfer_bad()

def tori.chamfer.line(+da: G.Vec3, +fb: Fit, +op: U32, +size: R.Real, +nref: G.Vec3, +sts: List<&2, C.St>, +pa0: G.Vec3, +pb0: G.Vec3) -> Surface:
  match fb:
    case FLine{_, _, _}:
      tori.fillet.an(J.Plane{pa0, unit(G.cross(G.sub(pb0, pa0), da)), da}, "plane", zero(), op, size, nref, sts)
    case _:
      chamfer_bad()

def tori.chamfer.k(+fa: Fit, +fb: Fit, +op: U32, +size: R.Real, +nref: G.Vec3, +sts: List<&2, C.St>, +pa0: G.Vec3, +pb0: G.Vec3) -> Surface:
  match fa:
    case FLine{_, da, _}:
      tori.chamfer.line(da, fb, op, size, nref, sts, pa0, pb0)
    case FCirc{oa, na, ra, _}:
      tori.chamfer.circ(oa, na, ra, fb, op, size, nref, sts)
    case _:
      chamfer_bad()

def tori.chamfer(+op: U32, +size: R.Real, +nref: G.Vec3, +sts: List<&2, C.St>, +fa: Fit, +fb: Fit) -> Surface:
  +s0 = nth_st(sts, 0n)
  tori.chamfer.k(fa, fb, op, size, nref, sts, st_pa(s0), st_pb(s0))

def tori(+op: U32, +size: R.Real, +nref: G.Vec3, +closed: Bool, +sts: List<&2, C.St>, +fa: Fit, +fb: Fit) -> Surface:
  Bool.pick(Surface, U32.is_eq(op, 0), tori.fillet(op, size, nref, sts, fit(points(0, sts), closed)), tori.chamfer(op, size, nref, sts, fa, fb))

# ---------------------------------------------------------------------------
# Variant "spline": skinned bicubic (fillet) or bilinear-in-u (chamfer)
# B-spline. Rows are the u-control points of one section.

def vadd_rows(xs: List<&2, G.Vec3>, ys: List<&2, G.Vec3>) -> List<&2, G.Vec3>:
  match xs:
    case Nil{}:
      Nil{}
    case +x <> xt:
      match ys:
        case Nil{}:
          Nil{}
        case +y <> yt:
          G.add(x, y) <> vadd_rows(xt, yt)

def vscale_row(xs: List<&2, G.Vec3>, +s: R.Real) -> List<&2, G.Vec3>:
  match xs:
    case Nil{}:
      Nil{}
    case +x <> t:
      G.scale(x, s) <> vscale_row(t, s)

def comb7(+w0: F32, +w1: F32, +w2: F32, +w4: F32, +w5: F32, +w6: F32, +r0: List<&2, G.Vec3>, +r1: List<&2, G.Vec3>, +r2: List<&2, G.Vec3>, +r4: List<&2, G.Vec3>, +r5: List<&2, G.Vec3>, +r6: List<&2, G.Vec3>) -> List<&2, G.Vec3>:
  +a = vadd_rows(vscale_row(r0, R.div(R.from_f32(w0), rl(60.0))), vscale_row(r1, R.div(R.from_f32(w1), rl(60.0))))
  +b = vadd_rows(vscale_row(r2, R.div(R.from_f32(w2), rl(60.0))), vscale_row(r4, R.div(R.from_f32(w4), rl(60.0))))
  vadd_rows(vadd_rows(a, b), vadd_rows(vscale_row(r5, R.div(R.from_f32(w5), rl(60.0))), vscale_row(r6, R.div(R.from_f32(w6), rl(60.0)))))

def comb5(+w0: F32, +w1: F32, +w2: F32, +w3: F32, +w4: F32, +r0: List<&2, G.Vec3>, +r1: List<&2, G.Vec3>, +r2: List<&2, G.Vec3>, +r3: List<&2, G.Vec3>, +r4: List<&2, G.Vec3>) -> List<&2, G.Vec3>:
  +a = vadd_rows(vscale_row(r0, R.div(R.from_f32(w0), rl(12.0))), vscale_row(r1, R.div(R.from_f32(w1), rl(12.0))))
  +b = vadd_rows(vscale_row(r2, R.div(R.from_f32(w2), rl(12.0))), vscale_row(r3, R.div(R.from_f32(w3), rl(12.0))))
  vadd_rows(vadd_rows(a, b), vscale_row(r4, R.div(R.from_f32(w4), rl(12.0))))

# Section arc of a fillet station as 8 cubic Bezier spans (25 poles), from
# the contact point on A to the one on B through the ball point next to the
# edge. Chamfer: the two contact points.
def arc_pole(+c: G.Vec3, +r: R.Real, +u: G.Vec3, +w: G.Vec3, +phi: R.Real, +off: R.Real) -> G.Vec3:
  +co = R.cos(phi)
  +si = R.sin(phi)
  +e = G.add(G.scale(u, co), G.scale(w, si))
  +t = G.sub(G.scale(w, co), G.scale(u, si))
  G.add(c, G.add(G.scale(e, r), G.scale(t, R.mul(r, off))))

# The poles after the first of spans i .. i + n − 1 (angle dl each).
def arc_spans(+n: Nat, +c: G.Vec3, +r: R.Real, +u: G.Vec3, +w: G.Vec3, +dl: R.Real, +k: R.Real, +i: F32) -> List<&2, G.Vec3>:
  match n:
    case 0n:
      Nil{}
    case 1n+p:
      +i1 = (i + 1.0 : F32)
      +a0 = R.mul(dl, R.from_f32(i))
      +a1 = R.mul(dl, R.from_f32(i1))
      arc_pole(c, r, u, w, a0, k) <> arc_pole(c, r, u, w, a1, R.neg(k)) <> arc_pole(c, r, u, w, a1, zero()) <> arc_spans(p, c, r, u, w, dl, k, i1)

def arc_row(+c: G.Vec3, +r: R.Real, +u: G.Vec3, +w: G.Vec3, +dl: R.Real, +k: R.Real) -> List<&2, G.Vec3>:
  arc_pole(c, r, u, w, zero(), zero()) <> arc_spans(8n, c, r, u, w, dl, k, 0.0)

def section_row(+op: U32, +size: R.Real, +s: C.St) -> List<&2, G.Vec3>:
  +c = st_c(s)
  +pa = st_pa(s)
  +pb = st_pb(s)
  +u = unit(G.sub(pa, c))
  +w0 = unit(G.sub(sec_mid(op, size, s), c))
  +w = unit(G.sub(w0, G.scale(u, G.dot(w0, u))))
  +vb = G.sub(pb, c)
  +th0 = R.atan2(G.dot(vb, w), G.dot(vb, u))
  +th = Bool.pick(R.Real, R.less(zero(), th0), th0, R.add(th0, two_pi()))
  +dl = R.div(th, rl(8.0))
  +q = R.div(dl, rl(4.0))
  +k = R.div(R.mul(rl(4.0), R.sin(q)), R.mul(rl(3.0), R.cos(q)))
  Bool.pick(List<&2, G.Vec3>, U32.is_eq(op, 0), arc_row(c, size, u, w, dl, k), pa <> pb <> Nil{})

# Rows of the even stations (k = 0, 2, .., 64).
def even_rows(+op: U32, +size: R.Real, sts: List<&2, C.St>) -> List<&2, List<&2, G.Vec3>>:
  match sts:
    case Nil{}:
      Nil{}
    case +a <> rest:
      match rest:
        case Nil{}:
          section_row(op, size, a) <> Nil{}
        case _ <> rest2:
          section_row(op, size, a) <> even_rows(op, size, rest2)

def row.or(m: Maybe<&2, List<&2, G.Vec3>>) -> List<&2, G.Vec3>:
  match m:
    case Some{r}:
      r
    case None{}:
      Nil{}

def row_at(+rows: List<&2, List<&2, G.Vec3>>, +k: Nat) -> List<&2, G.Vec3>:
  row.or(List.get(&2, List<&2, G.Vec3>, rows, k))

# Row index j + d wrapped into [0, n) (closed spines; n = 32).
def wrap_i(+j: Nat, +d: Nat, +back: Bool, +n: Nat) -> Nat:
  +up = Nat.mod(Nat.add(j, d), n)
  +down = Nat.mod(Nat.sub(Nat.add(j, n), d), n)
  Bool.pick(Nat, back, down, up)

# Tangent row at even-station row j (per unit of the v-span parameter).
# Central 7-point first derivative (error O(h^6)) at row j of a closed ring
# of n rows, or of an open strip when 3 <= j <= n - 3.
def d7(+rows: List<&2, List<&2, G.Vec3>>, +jm3: Nat, +jm2: Nat, +jm1: Nat, +jp1: Nat, +jp2: Nat, +jp3: Nat) -> List<&2, G.Vec3>:
  comb7(F32.neg(1.0), 9.0, F32.neg(45.0), 45.0, F32.neg(9.0), 1.0, row_at(rows, jm3), row_at(rows, jm2), row_at(rows, jm1), row_at(rows, jp1), row_at(rows, jp2), row_at(rows, jp3))

def drow_closed(+rows: List<&2, List<&2, G.Vec3>>, +j: Nat) -> List<&2, G.Vec3>:
  +n = {32n : Nat}
  d7(rows, wrap_i(j, 3n, True{}, n), wrap_i(j, 2n, True{}, n), wrap_i(j, 1n, True{}, n), wrap_i(j, 1n, False{}, n), wrap_i(j, 2n, False{}, n), wrap_i(j, 3n, False{}, n))

def drow_open(+rows: List<&2, List<&2, G.Vec3>>, +j: Nat) -> List<&2, G.Vec3>:
  +r0 = row_at(rows, 0n)
  +r1 = row_at(rows, 1n)
  +r2 = row_at(rows, 2n)
  +r3 = row_at(rows, 3n)
  +r4 = row_at(rows, 4n)
  +e0 = row_at(rows, 28n)
  +e1 = row_at(rows, 29n)
  +e2 = row_at(rows, 30n)
  +e3 = row_at(rows, 31n)
  +e4 = row_at(rows, 32n)
  +d0 = comb5(F32.neg(25.0), 48.0, F32.neg(36.0), 16.0, F32.neg(3.0), r0, r1, r2, r3, r4)
  +d1 = comb5(F32.neg(3.0), F32.neg(10.0), 18.0, F32.neg(6.0), 1.0, r0, r1, r2, r3, r4)
  +d31 = comb5(F32.neg(1.0), 6.0, F32.neg(18.0), 10.0, 3.0, e0, e1, e2, e3, e4)
  +d32 = comb5(3.0, F32.neg(16.0), 36.0, F32.neg(48.0), 25.0, e0, e1, e2, e3, e4)
  +jm = Bool.pick(Nat, Nat.is_lt(j, 2n), 2n, Bool.pick(Nat, Nat.is_gt(j, 30n), 30n, j))
  +dc = comb5(1.0, F32.neg(8.0), 0.0, 8.0, F32.neg(1.0), row_at(rows, Nat.sub(jm, 2n)), row_at(rows, Nat.sub(jm, 1n)), row_at(rows, jm), row_at(rows, Nat.add(jm, 1n)), row_at(rows, Nat.add(jm, 2n)))
  Bool.pick(List<&2, G.Vec3>, Nat.is_eq(j, 0n), d0, Bool.pick(List<&2, G.Vec3>, Nat.is_eq(j, 1n), d1, Bool.pick(List<&2, G.Vec3>, Nat.is_eq(j, 31n), d31, Bool.pick(List<&2, G.Vec3>, Nat.is_eq(j, 32n), d32, dc))))

def drows(+n: Nat, +closed: Bool, +rows: List<&2, List<&2, G.Vec3>>, +j: Nat) -> List<&2, List<&2, G.Vec3>>:
  match n:
    case 0n:
      Nil{}
    case 1n+p:
      Bool.pick(List<&2, G.Vec3>, closed, drow_closed(rows, j), drow_open(rows, j)) <> drows(p, closed, rows, Nat.add(j, 1n))

# v-control rows of the 32-span net: Q_s, Q_s + D_s/3, Q_{s+1} − D_{s+1}/3, ..., Q_32.
def vrows(+n: Nat, +qs: List<&2, List<&2, G.Vec3>>, +ds: List<&2, List<&2, G.Vec3>>, +s: Nat) -> List<&2, List<&2, G.Vec3>>:
  match n:
    case 0n:
      row_at(qs, s) <> Nil{}
    case 1n+p:
      +third = R.div(one(), rl(3.0))
      +q0 = row_at(qs, s)
      +q1 = row_at(qs, Nat.add(s, 1n))
      q0 <> vadd_rows(q0, vscale_row(row_at(ds, s), third)) <> vadd_rows(q1, vscale_row(row_at(ds, Nat.add(s, 1n)), R.neg(third))) <> vrows(p, qs, ds, Nat.add(s, 1n))

# The straight net (one v-span): Q_0 .. Q_32 linear.
def vrows_line(+q0: List<&2, G.Vec3>, +q1: List<&2, G.Vec3>) -> List<&2, List<&2, G.Vec3>>:
  +d = vadd_rows(q1, vscale_row(q0, R.neg(one())))
  q0 <> vadd_rows(q0, vscale_row(d, R.div(one(), rl(3.0)))) <> vadd_rows(q0, vscale_row(d, R.div(rl(2.0), rl(3.0)))) <> q1 <> Nil{}

# Transpose the v-rows (list over v of lists over u) into u-major poles.
def column(+rows: List<&2, List<&2, G.Vec3>>, +i: Nat) -> List<&2, G.Vec3>:
  match rows:
    case Nil{}:
      Nil{}
    case +r <> t:
      nth_p(r, i) <> column(t, i)

def u_major(+n: Nat, +rows: List<&2, List<&2, G.Vec3>>, +i: Nat) -> List<&2, G.Vec3>:
  match n:
    case 0n:
      Nil{}
    case 1n+p:
      List.append(&2, G.Vec3, column(rows, i), u_major(p, rows, Nat.add(i, 1n)))

# Clamped knots for `spans` Bezier spans of degree `deg` (interior knots of
# multiplicity deg).
def knots.inner(+n: Nat, +deg: Nat, +k: Nat) -> List<&2, R.Real>:
  match n:
    case 0n:
      Nil{}
    case 1n+p:
      List.append(&2, R.Real, List.replicate(R.Real, deg, R.from_f32(F32.from_nat(k))), knots.inner(p, deg, Nat.add(k, 1n)))

def knots(+deg: Nat, +spans: Nat) -> List<&2, R.Real>:
  List.append(&2, R.Real, List.replicate(R.Real, 1n+deg, zero()), List.append(&2, R.Real, knots.inner(Nat.sub(spans, 1n), deg, 1n), List.replicate(R.Real, 1n+deg, R.from_f32(F32.from_nat(spans)))))

# ---------------------------------------------------------------------------
# Spline certificate: sample the u-curve of a row against the true section
# of a station.

def bez3(+p0: G.Vec3, +p1: G.Vec3, +p2: G.Vec3, +p3: G.Vec3, +s: R.Real) -> G.Vec3:
  +t = R.sub(one(), s)
  +b0 = R.mul(t, R.mul(t, t))
  +b1 = R.mul(rl(3.0), R.mul(s, R.mul(t, t)))
  +b2 = R.mul(rl(3.0), R.mul(s, R.mul(s, t)))
  +b3 = R.mul(s, R.mul(s, s))
  G.add(G.add(G.scale(p0, b0), G.scale(p1, b1)), G.add(G.scale(p2, b2), G.scale(p3, b3)))

# Deviation of point q from the true section of station s.
def sec_dev(+op: U32, +size: R.Real, +tan: G.Vec3, +s: C.St, +q: G.Vec3) -> R.Real:
  +off = R.abs(G.dot(tan, G.sub(q, st_p(s))))
  +pa = st_pa(s)
  +radial = R.abs(R.sub(dist(q, st_c(s)), size))
  +chord = line_d(q, pa, unit(G.sub(st_pb(s), pa)))
  R.add(Bool.pick(R.Real, U32.is_eq(op, 0), radial, chord), off)

def span_dev(+n: Nat, +op: U32, +size: R.Real, +tan: G.Vec3, +s: C.St, +p0: G.Vec3, +p1: G.Vec3, +p2: G.Vec3, +p3: G.Vec3, +acc: R.Real) -> R.Real:
  match n:
    case 0n:
      acc
    case 1n+p:
      +x = R.div(R.from_f32(F32.from_nat(p)), rl(8.0))
      span_dev(p, op, size, tan, s, p0, p1, p2, p3, R.max(acc, sec_dev(op, size, tan, s, bez3(p0, p1, p2, p3, x))))

# Spans of a row: 3i..3i+3 (cubic, 25 poles) or the one linear span (2 poles).
def row_dev.go(+n: Nat, +op: U32, +size: R.Real, +tan: G.Vec3, +s: C.St, +row: List<&2, G.Vec3>, +i: Nat, +acc: R.Real) -> R.Real:
  match n:
    case 0n:
      acc
    case 1n+p:
      +b = Nat.mul(3n, i)
      row_dev.go(p, op, size, tan, s, row, Nat.add(i, 1n), span_dev(9n, op, size, tan, s, nth_p(row, b), nth_p(row, Nat.add(b, 1n)), nth_p(row, Nat.add(b, 2n)), nth_p(row, Nat.add(b, 3n)), acc))

def row_dev(+op: U32, +size: R.Real, +tan: G.Vec3, +s: C.St, +row: List<&2, G.Vec3>, +acc: R.Real) -> R.Real:
  +p0 = nth_p(row, 0n)
  +p1 = nth_p(row, 1n)
  +lin_dev = span_dev(9n, op, size, tan, s, p0, lin(p0, p1, R.div(one(), rl(3.0))), lin(p0, p1, R.div(rl(2.0), rl(3.0))), p1, acc)
  Bool.pick(R.Real, U32.is_eq(op, 0), row_dev.go(8n, op, size, tan, s, row, 0n, acc), lin_dev)

# The row of the spline at station k (0..64): even stations are the fitted
# rows; odd ones the Hermite mid point (Q_j + Q_{j+1})/2 + (D_j − D_{j+1})/8.
def row_at_station(+straight: Bool, +qs: List<&2, List<&2, G.Vec3>>, +ds: List<&2, List<&2, G.Vec3>>, +k: Nat) -> List<&2, G.Vec3>:
  +j = Nat.div(k, 2n)
  +odd = U32.is_eq(U32.from_nat(Nat.mod(k, 2n)), 1)
  +half = rl(0.5)
  +eighth = R.div(one(), rl(8.0))
  +h = vadd_rows(vscale_row(vadd_rows(row_at(qs, j), row_at(qs, Nat.add(j, 1n))), half), vscale_row(vadd_rows(row_at(ds, j), vscale_row(row_at(ds, Nat.add(j, 1n)), R.neg(one()))), eighth))
  +q0 = row_at(qs, 0n)
  +frac = R.div(R.from_f32(F32.from_nat(k)), rl(64.0))
  +line = vadd_rows(q0, vscale_row(vadd_rows(row_at(qs, 32n), vscale_row(q0, R.neg(one()))), frac))
  Bool.pick(List<&2, G.Vec3>, straight, line, Bool.pick(List<&2, G.Vec3>, odd, h, row_at(qs, j)))

type Ctx2 is Data:
  Ctx2{op: U32, size: R.Real, curve: J.Curve, dsgn: R.Real, coax: Bool}

def cx_op(+cx: Ctx2) -> U32:
  Ctx2{+op, _, _, _, _} = cx
  op

def cx_size(+cx: Ctx2) -> R.Real:
  Ctx2{_, +size, _, _, _} = cx
  size

def cx_curve(+cx: Ctx2) -> J.Curve:
  Ctx2{_, _, +curve, _, _} = cx
  curve

def pd_d(pd: G.Vec3 & G.Vec3) -> G.Vec3:
  (_, d) = pd
  d

def tangent_at(+cx: Ctx2, +s: C.St) -> G.Vec3:
  Ctx2{_, _, +curve, +dsgn, _} = cx
  G.scale(unit(pd_d(S.curve_pd(curve, st_t(s)))), dsgn)

def spline_dev(+cx: Ctx2, +straight: Bool, +qs: List<&2, List<&2, G.Vec3>>, +ds: List<&2, List<&2, G.Vec3>>, sts: List<&2, C.St>, +k: Nat, +acc: R.Real) -> R.Real:
  match sts:
    case Nil{}:
      acc
    case +s <> t:
      spline_dev(cx, straight, qs, ds, t, Nat.add(k, 1n), row_dev(cx_op(cx), cx_size(cx), tangent_at(cx, s), s, row_at_station(straight, qs, ds, k), acc))

# Tangent rows of a circular edge (centre o, normal n) whose supports are
# coaxial with it: the true blend is a surface of revolution and its
# sections are rotations of one another, dQ/dv = θ_v n × (Q − o) for the
# parameter step θ_v per v-span. Scaled to the best circular cubic's arm,
# the row derivative is 4 tan(θ_v/4) n × (Q − o) (arms Q ± that/3): every
# pole column is then that cubic, whose radial error δ(θ) = (2/27)
# sin⁶(θ/4)/cos²(θ/4) is ~θ⁶ (difference tangents: ~θ⁴, 1.5e-5 mm on a
# rim of 5 mm). Its maximum sits near v = 0.21 and 0.79 of a span, not at
# the odd stations the certificate samples, so `rot_extra` adds the bound.
def rot_row(+row: List<&2, G.Vec3>, +o: G.Vec3, +n: G.Vec3, +sc: R.Real) -> List<&2, G.Vec3>:
  match row:
    case Nil{}:
      Nil{}
    case +q <> t:
      G.scale(G.cross(n, G.sub(q, o)), sc) <> rot_row(t, o, n, sc)

def rot_rows(+qs: List<&2, List<&2, G.Vec3>>, +o: G.Vec3, +n: G.Vec3, +sc: R.Real) -> List<&2, List<&2, G.Vec3>>:
  match qs:
    case Nil{}:
      Nil{}
    case +r <> t:
      rot_row(r, o, n, sc) <> rot_rows(t, o, n, sc)

# The parameter step θ_v per v-span (signed).
def step_v(+sts: List<&2, C.St>) -> R.Real:
  R.sub(st_t(nth_st(sts, 2n)), st_t(nth_st(sts, 0n)))

def drows.coax(+coax: Bool, +o: G.Vec3, +n: G.Vec3, +closed: Bool, +qs: List<&2, List<&2, G.Vec3>>, +sts: List<&2, C.St>) -> List<&2, List<&2, G.Vec3>>:
  match coax:
    case True{}:
      +q = R.div(step_v(sts), rl(4.0))
      rot_rows(qs, o, G.normalize(n), R.div(R.mul(rl(4.0), R.sin(q)), R.cos(q)))
    case False{}:
      drows(33n, closed, qs, 0n)

def drows_of(+curve: J.Curve, +coax: Bool, +closed: Bool, +qs: List<&2, List<&2, G.Vec3>>, +sts: List<&2, C.St>) -> List<&2, List<&2, G.Vec3>>:
  match curve:
    case J.Circle{+o, +n, _, _}:
      drows.coax(coax, o, n, closed, qs, sts)
    case _:
      drows(33n, closed, qs, 0n)

# The rotation of p about the axis (o, unit n) by the angle whose cosine and
# sine are co, si.
def rotate(+p: G.Vec3, +o: G.Vec3, +n: G.Vec3, +co: R.Real, +si: R.Real) -> G.Vec3:
  +v = G.sub(p, o)
  +h = G.scale(n, G.dot(v, n))
  +w = G.sub(v, h)
  G.add(o, G.add(h, G.add(G.scale(w, co), G.scale(G.cross(n, w), si))))

def rot_mis_row(+a: List<&2, G.Vec3>, +b: List<&2, G.Vec3>, +o: G.Vec3, +n: G.Vec3, +co: R.Real, +si: R.Real, +acc: R.Real) -> R.Real:
  match a:
    case Nil{}:
      acc
    case +p <> t:
      match b:
        case Nil{}:
          acc
        case +q <> u:
          rot_mis_row(t, u, o, n, co, si, R.max(acc, dist(q, rotate(p, o, n, co, si))))

# max over rows j and poles i of |Q_{j+1,i} − R(θ_v) Q_{j,i}| (how far the
# rows are from exact rotations of each other) and of the poles' distance
# from the axis.
def rot_mis_rows(+qs: List<&2, List<&2, G.Vec3>>, +o: G.Vec3, +n: G.Vec3, +co: R.Real, +si: R.Real, +acc: R.Real) -> R.Real:
  match qs:
    case Nil{}:
      acc
    case +r <> t:
      rot_mis_rows(t, o, n, co, si, rot_mis_row(r, row_at(t, 0n), o, n, co, si, acc))

def rho_max(+row: List<&2, G.Vec3>, +o: G.Vec3, +n: G.Vec3, +acc: R.Real) -> R.Real:
  match row:
    case Nil{}:
      acc
    case +p <> t:
      rho_max(t, o, n, R.max(acc, norm(S.radial(o, n, p))))

# Deviation bound added to the certificate for rotation tangents: each pole
# column is the circular cubic of its row's rotation, radially off by at most
# δ(θ)·ρ (taken as 2δ); rows that are not exact rotations move the poles
# by at most (1 + 4 tan(θ/4)/3)|ΔQ| ≤ 2|ΔQ|.
def rot_extra.k(+o: G.Vec3, +n: G.Vec3, +qs: List<&2, List<&2, G.Vec3>>, +th: R.Real) -> R.Real:
  +q = R.div(R.abs(th), rl(4.0))
  +s = R.sin(q)
  +c = R.cos(q)
  +s3 = R.mul(s, R.mul(s, s))
  +delta = R.div(R.mul(rl(4.0), R.mul(s3, s3)), R.mul(rl(27.0), R.mul(c, c)))
  +mis = rot_mis_rows(qs, o, n, R.cos(th), R.sin(th), zero())
  R.add(R.mul(delta, rho_max(row_at(qs, 0n), o, n, zero())), R.mul(rl(2.0), mis))

def rot_extra.c(+coax: Bool, +o: G.Vec3, +n: G.Vec3, +qs: List<&2, List<&2, G.Vec3>>, +sts: List<&2, C.St>) -> R.Real:
  match coax:
    case True{}:
      rot_extra.k(o, G.normalize(n), qs, step_v(sts))
    case False{}:
      zero()

def rot_extra(+curve: J.Curve, +coax: Bool, +qs: List<&2, List<&2, G.Vec3>>, +sts: List<&2, C.St>) -> R.Real:
  match curve:
    case J.Circle{+o, +n, _, _}:
      rot_extra.c(coax, o, n, qs, sts)
    case _:
      zero()

def spline.build(+cx: Ctx2, +nref: G.Vec3, +closed: Bool, +straight: Bool, +sts: List<&2, C.St>, +qs: List<&2, List<&2, G.Vec3>>) -> Surface:
  Ctx2{+op, +size, _, _, +coax} = cx
  +ds = drows_of(cx_curve(cx), coax, closed, qs, sts)
  +vr = Bool.pick(List<&2, List<&2, G.Vec3>>, straight, vrows_line(row_at(qs, 0n), row_at(qs, 32n)), vrows(32n, qs, ds, 0n))
  +nu = List.length(&2, G.Vec3, row_at(qs, 0n))
  +nv = List.length(&2, List<&2, G.Vec3>, vr)
  +du = Bool.pick(Nat, U32.is_eq(op, 0), 3n, 1n)
  +spans_u = Bool.pick(Nat, U32.is_eq(op, 0), 8n, 1n)
  +spans_v = Bool.pick(Nat, straight, 1n, 32n)
  +poles = u_major(nu, vr, 0n)
  +dev = R.add(spline_dev(cx, straight, qs, ds, sts, 0n, zero()), rot_extra(cx_curve(cx), coax, qs, sts))
  +s0 = nth_st(sts, 0n)
  +r0 = row_at(vr, 0n)
  +r1 = row_at(vr, 1n)
  +iu = Bool.pick(Nat, U32.is_eq(op, 0), 12n, 0n)
  +su = G.sub(nth_p(r0, Nat.add(iu, 1n)), nth_p(r0, iu))
  +sv = G.sub(nth_p(r1, iu), nth_p(r0, iu))
  +kind = "bspline " ++ Nat.show(spans_u) ++ "x" ++ Nat.show(spans_v)
  surf_ok(O.OSpline{U32.from_nat(du), 3, U32.from_nat(nu), U32.from_nat(nv), knots(du, spans_u), knots(3n, spans_v), poles}, G.cross(su, sv), nref, dev, kind)

def spline.straight_ok(+s: Surface) -> Bool:
  match s:
    case SurfOk{_, _, +dev, _, _}:
      R.less(dev, eps())
    case SurfBad{_, _}:
      False{}

# A straight edge whose sections are translates: try the one-span net first
# and keep it when it certifies to 1e-9 mm at all 65 stations.
def spline.pick(+cx: Ctx2, +nref: G.Vec3, +closed: Bool, +line: Bool, +sts: List<&2, C.St>, +qs: List<&2, List<&2, G.Vec3>>) -> Surface:
  +one_span = spline.build(cx, nref, closed, True{}, sts, qs)
  Bool.pick(Surface, Bool.and(line, spline.straight_ok(one_span)), one_span, spline.build(cx, nref, closed, False{}, sts, qs))

# Closed spines: the last row is the first one, exactly.
def close_rows(+closed: Bool, +qs: List<&2, List<&2, G.Vec3>>) -> List<&2, List<&2, G.Vec3>>:
  Bool.pick(List<&2, List<&2, G.Vec3>>, closed, List.append(&2, List<&2, G.Vec3>, List.take(&2, List<&2, G.Vec3>, qs, 32n), row_at(qs, 0n) <> Nil{}), qs)

# coax: the edge is a circle and both supports are planes perpendicular to
# its axis or surfaces of revolution about it (brep.bend), so the true blend
# is a surface of revolution.
def spline(+op: U32, +size: R.Real, +curve: J.Curve, +dsgn: R.Real, +nref: G.Vec3, +closed: Bool, +coax: Bool, +sts: List<&2, C.St>) -> Surface:
  +cx = {Ctx2{op, size, curve, dsgn, coax} : Ctx2}
  spline.pick(cx, nref, closed, Bool.and(S.is_line(curve), Bool.not(closed)), sts, close_rows(closed, even_rows(op, size, sts)))
