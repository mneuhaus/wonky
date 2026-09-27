import Base
import ../../real.bend as R
import ../../precise.bend as G
import ../../analytic.bend as A
import ../mesh.bend as M
import ../../robust-predicates.bend as RP

# Analytic geometry of the "recover" prototype (docs/proto-recover.md):
# carrier surfaces, carrier equality, residuals and normals, exact
# surface/surface intersection curves, exact three-surface vertices (Newton
# from the mesh seed) and the distance bounds used by the certification.
#
# Numbers are F32x2 Reals (kernel/real.bend, ~48-bit significand). Decisions
# that only need a sign or a bound far above rounding (orientation, winding,
# certification distances against a 0.01 mm deviation) are taken on the F32
# approximation of Real differences.

def rf(x: F32) -> R.Real:
  R.from_f32(x)

def vlen(+v: G.Vec3) -> R.Real:
  R.sqrt(G.dot(v, v))

def vneg(v: G.Vec3) -> G.Vec3:
  G.scale(v, rf(F32.neg(1.0)))

# Linear tolerance for "same carrier" (mm) and angular tolerance (1 - |cos|).
def eps_l() -> R.Real:
  rf(0.0000001)

def eps_a() -> R.Real:
  rf(0.0000000001)

def near(+x: R.Real, +tol: R.Real) -> Bool:
  R.less(R.abs(x), tol)

# Tangency tolerance (mm): a plane parallel to a cylinder axis whose distance
# from the axis equals the radius within this bound touches it along one
# generator (a G1 edge, e.g. a slot end or a fillet).
def tangent_tol() -> R.Real:
  rf(0.000001)

# ---------------------------------------------------------------------------
# Carrier surfaces. Cones are canonical: `a` points to widening radius, the
# half-angle `ang` is positive; radius at signed height h = (p - o).a is
# r + h * tn.

type Surf is Data:
  SPlane{o: G.Vec3, n: G.Vec3, x: G.Vec3}
  SCyl{o: G.Vec3, a: G.Vec3, x: G.Vec3, r: R.Real}
  SCone{o: G.Vec3, a: G.Vec3, x: G.Vec3, r: R.Real, ang: R.Real, tn: R.Real, cs: R.Real, sn: R.Real}
  SSphere{o: G.Vec3, r: R.Real}
  STorus{o: G.Vec3, a: G.Vec3, big: R.Real, small: R.Real}

def cone_mk(o: G.Vec3, a: G.Vec3, x: G.Vec3, r: R.Real, +ang: R.Real) -> Surf:
  SCone{o, a, x, r, ang, R.div(R.sin(ang), R.cos(ang)), R.cos(ang), R.sin(ang)}

def cone_of(o: G.Vec3, a: G.Vec3, x: G.Vec3, r: R.Real, +ang: R.Real, flip: Bool) -> Surf:
  match flip:
    case True{}:
      cone_mk(o, vneg(a), x, r, R.neg(ang))
    case False{}:
      cone_mk(o, a, x, r, ang)

# Directions are renormalized in F32x2: sources such as FeatureScript bodies
# carry F32 unit vectors (|n|^2 = 1 - 6e-8), which would otherwise defeat the
# 1e-10 angular tolerance of carrier equality. The direction is unchanged.
def of_wire(s: M.Surface) -> Surf:
  match s:
    case M.SPlane{o, n, x}:
      SPlane{o, G.normalize(n), G.normalize(x)}
    case M.SCylinder{o, n, x, r}:
      SCyl{o, G.normalize(n), G.normalize(x), r}
    case M.SCone{o, n, x, r, +a}:
      cone_of(o, G.normalize(n), G.normalize(x), r, a, R.less(a, rf(0.0)))
    case M.SSphere{o, r}:
      SSphere{o, r}
    case M.STorus{o, n, major, minor}:
      STorus{o, G.normalize(n), major, minor}

# 0 plane, 1 cylinder, 2 cone, 3 sphere, 4 torus.
def kind(s: Surf) -> U32:
  match s:
    case SPlane{_, _, _}:
      0
    case SCyl{_, _, _, _}:
      1
    case SCone{_, _, _, _, _, _, _, _}:
      2
    case SSphere{_, _}:
      3
    case STorus{_, _, _, _}:
      4

def kind_name(+k: U32) -> String:
  Bool.pick(String, U32.is_eq(k, 0), "plane", Bool.pick(String, U32.is_eq(k, 1), "cylinder",
    Bool.pick(String, U32.is_eq(k, 2), "cone", Bool.pick(String, U32.is_eq(k, 3), "sphere", "torus"))))

def apex(o: G.Vec3, +a: G.Vec3, r: R.Real, tn: R.Real) -> G.Vec3:
  G.sub(o, G.scale(a, R.div(r, tn)))

def parallel(u: G.Vec3, v: G.Vec3) -> Bool:
  R.less(R.sub(rf(1.0), R.abs(G.dot(u, v))), eps_a())

# Exact equality and exact parallelism of the represented numbers (the
# integers of robust-predicates.bend, no tolerance). The pairs whose curve
# TYPE depends on parallel axes (parallel cylinders meet in straight lines,
# axes tilted by any angle in a space quartic) are only built on axes whose
# cross product vanishes exactly: an axis tilted by 1e-12 rad is not
# parallel, whatever `parallel` above says. Extrusions along one direction
# carry identical (or negated) axes, so real parallel carriers pass.
def big_zero(b: RP.Big) -> Bool:
  RP.Big{_, d} = b
  RP.empty(d)

def real_eq(a: R.Real, b: R.Real) -> Bool:
  big_zero(RP.sub(RP.from_real(a), RP.from_real(b)))

def cross_term(+a: R.Real, +b: R.Real, +c: R.Real, +d: R.Real) -> Bool:
  big_zero(RP.sub(RP.mul(RP.from_real(a), RP.from_real(b)), RP.mul(RP.from_real(c), RP.from_real(d))))

def parallel_exact(u: G.Vec3, v: G.Vec3) -> Bool:
  G.V3{+ux, +uy, +uz} = u
  G.V3{+vx, +vy, +vz} = v
  Bool.and(cross_term(uy, vz, uz, vy), Bool.and(cross_term(uz, vx, ux, vz), cross_term(ux, vy, uy, vx)))

# Two cones with exactly parallel axes and exactly equal half-angles (the
# wire angles, from which tn, cs and sn are computed alike).
def cone_same(a1: G.Vec3, ang1: R.Real, a2: G.Vec3, ang2: R.Real) -> Bool:
  Bool.and(parallel_exact(a1, a2), real_eq(ang1, ang2))

# Tangency on the wire values. A contact generator (one common line where two
# carriers touch) is built only for a pair whose carriers, taken as the exact
# F32x2 numbers of the face table, are tangent to the working precision of
# those numbers. Each contact condition is written as a polynomial in them
# (a gap: distance of the axes minus the sum or difference of the radii in
# one cross-section; for a plane and a cone the apex distance and the angle
# mismatch), evaluated exactly (RP, no rounding), and compared with
#   band = 2^-44 M,
# M the largest magnitude among the values entering it (coordinates, radii).
# R.* carries about 44 bits, so carriers built tangent upstream agree to a
# few units of 2^-48 M: at most 9 units (0.6 band) over the R20 return
# plate's chamfer cones and arcs, the KT1 core's arcs and the test ovals
# (local-development-evidence). A gap beyond the band cannot come
# from rounding and is decided by its exact sign: carriers that do not meet
# have no common line (no contact; an edge between them is refused) and
# parallel cylinders that cross meet in two lines. Within the band the
# contact generator lies within the band of both carriers, far below the
# 1e-7 mm vertex residual of the numeric model; the pair is then taken as
# the tangent pair it was built as, which is the only approximation here.
# The band covers cylinder/cylinder, cone/cone and plane/cone contact only.
# A plane and a cylinder are still taken as tangent when their radial gap is
# within tangent_tol (1e-6 mm, axial and plane_cyl_lines), not on the band.
def wire_band(+m: R.Real) -> R.Real:
  R.mul(rf(0.00000000000005684342), m)

def vmax(v: G.Vec3) -> R.Real:
  G.V3{+x, +y, +z} = v
  R.max(R.abs(x), R.max(R.abs(y), R.abs(z)))

type BV is Data:
  BV{x: RP.Big, y: RP.Big, z: RP.Big}

def bv(v: G.Vec3) -> BV:
  G.V3{x, y, z} = v
  BV{RP.from_real(x), RP.from_real(y), RP.from_real(z)}

def bv.sub(a: BV, b: BV) -> BV:
  BV{ax, ay, az} = a
  BV{bx, by, bz} = b
  BV{RP.sub(ax, bx), RP.sub(ay, by), RP.sub(az, bz)}

def bv.dot(a: BV, b: BV) -> RP.Big:
  BV{ax, ay, az} = a
  BV{bx, by, bz} = b
  RP.add(RP.mul(ax, bx), RP.add(RP.mul(ay, by), RP.mul(az, bz)))

def bv.cross(a: BV, b: BV) -> BV:
  BV{+ax, +ay, +az} = a
  BV{+bx, +by, +bz} = b
  BV{RP.sub(RP.mul(ay, bz), RP.mul(az, by)), RP.sub(RP.mul(az, bx), RP.mul(ax, bz)), RP.sub(RP.mul(ax, by), RP.mul(ay, bx))}

def sign_pos(s: RP.Sign) -> Bool:
  match s:
    case RP.Positive{}:
      True{}
    case _:
      False{}

def sign_neg(s: RP.Sign) -> Bool:
  match s:
    case RP.Negative{}:
      True{}
    case _:
      False{}

# RP.from_real scales a value by 2^149, so a product of k wire values carries
# 2^(149 k) (degree k). lift(k, b) multiplies b by 1.0 k times (k degrees up)
# so that terms of different degree add and compare correctly.
def lift(k: Nat, b: RP.Big) -> RP.Big:
  match k:
    case 0n:
      b
    case 1n+p:
      lift(p, RP.mul(b, RP.from_real(rf(1.0))))

# 1.0 of degree k + 1.
def big_one(k: Nat) -> RP.Big:
  lift(k, RP.from_real(rf(1.0)))

# |g| <= b exactly, g of degree k + 1 (b is a bound; its own rounding is
# immaterial).
def big_within(g: RP.Big, b: R.Real, k: Nat) -> Bool:
  RP.Big{_, d} = g
  Bool.not(sign_pos(RP.sign(RP.sub(RP.make(False{}, d), lift(k, RP.from_real(b))))))

def big_sq(+b: RP.Big) -> RP.Big:
  RP.mul(b, b)

# Where a pair of circles in one cross-section stands: `touch` within the
# band of tangency, else `miss` when they are exactly apart (no common point).
type Tangency is Data:
  Tangency{touch: Bool, miss: Bool}

# Two circles whose centres are sqrt(h / aa) apart, h = |v x a|^2, aa = |a|^2
# (degree 4 and 2), with radii summed s1 (outside) and subtracted s2 (inside),
# both of degree m + 1: the squared gaps d^2 - s^2 times aa are
# go = h - s1^2 aa and gi = h - s2^2 aa, with h lifted to degree 2 m + 4.
# |d - |s|| <= band  <=>  |d^2 - s^2| <= band (d + |s|).
def circles(m: Nat, +h: RP.Big, +aa: RP.Big, s1: RP.Big, s2: RP.Big, +d: R.Real, +s1r: R.Real, +s2r: R.Real, +ar: R.Real, +band: R.Real) -> Tangency:
  +k = (2n * m : Nat)
  +go = RP.sub(lift(k, h), RP.mul(big_sq(s1), aa))
  +gi = RP.sub(lift(k, h), RP.mul(big_sq(s2), aa))
  +touch = Bool.or(big_within(go, R.mul(R.mul(band, R.add(d, R.abs(s1r))), ar), (k + 3n : Nat)), big_within(gi, R.mul(R.mul(band, R.add(d, R.abs(s2r))), ar), (k + 3n : Nat)))
  Tangency{touch, Bool.or(sign_pos(RP.sign(go)), sign_neg(RP.sign(gi)))}

def tangency.touch(t: Tangency) -> Bool:
  Tangency{touch, _} = t
  touch

# Parallel cylinders (axes exactly parallel, parallel_exact): cross-section
# circles of radius r1 and r2 whose centres are |v x a| / |a| apart.
def cyl_tangency(+c1: G.Vec3, +a: G.Vec3, +r1: R.Real, +c2: G.Vec3, +r2: R.Real) -> Tangency:
  +ab = bv(a)
  +vx = bv.cross(bv.sub(bv(c2), bv(c1)), ab)
  +b1 = RP.from_real(r1)
  +b2 = RP.from_real(r2)
  +band = wire_band(R.max(R.max(vmax(c1), vmax(c2)), R.max(R.abs(r1), R.abs(r2))))
  circles(0n, bv.dot(vx, vx), bv.dot(ab, ab), RP.add(b1, b2), RP.sub(b1, b2), vlen(A.radial(c2, c1, a)), R.add(r1, r2), R.sub(r1, r2), G.dot(a, a), band)

# Two cones with exactly parallel axes and equal half-angles (cone_same), in
# the cross-section through o1: radius r1 and b2 = r2 - sigma tn t, t the
# axial offset (o2 - o1).a1, sigma = -1 for opposite axes. Taking t so needs
# a unit axis: |a1|^2 = 1 exactly (axes along a coordinate direction) or t
# exactly 0 (both reference circles in one cross-section); any other pair is
# not decided (no contact). Opposite axes (one cone widening, the other
# narrowing) touch outside (r1 + b2 = d), codirected ones inside
# (|r1 - b2| = d). Degrees: t 2, tn t 3, so r1, r2 are lifted by 2.
def cone_touch(+o1: G.Vec3, +a1: G.Vec3, +r1: R.Real, +tn: R.Real, +o2: G.Vec3, +r2: R.Real, +opp: Bool, +d: R.Real) -> Bool:
  +ab = bv(a1)
  +v = bv.sub(bv(o2), bv(o1))
  +vx = bv.cross(v, ab)
  +aa = bv.dot(ab, ab)
  +t = bv.dot(v, ab)
  +unit_ok = Bool.or(big_zero(t), big_zero(RP.sub(aa, big_one(1n))))
  +mt = RP.mul(RP.from_real(tn), t)
  +w2 = lift(2n, RP.from_real(r2))
  +w1 = lift(2n, RP.from_real(r1))
  +b2 = Bool.pick(RP.Big, opp, RP.add(w2, mt), RP.sub(w2, mt))
  +s = Bool.pick(RP.Big, opp, RP.add(w1, b2), RP.sub(w1, b2))
  +tr = R.mul(tn, G.dot(G.sub(o2, o1), a1))
  +b2r = Bool.pick(R.Real, opp, R.add(r2, tr), R.sub(r2, tr))
  +sr = Bool.pick(R.Real, opp, R.add(r1, b2r), R.sub(r1, b2r))
  +band = wire_band(R.max(R.max(R.max(vmax(o1), vmax(o2)), R.max(R.abs(r1), R.abs(r2))), R.abs(tr)))
  Bool.and(unit_ok, tangency.touch(circles(2n, bv.dot(vx, vx), aa, s, s, d, sr, sr, G.dot(a1, a1), band)))

# A plane (o, n) and a cone (c, a, r, tn) with |a|^2 = 1 exactly: tangent
# along a generator when the apex c - a r / tn lies on the plane,
#   ga = tn n.(c - o) - (n.a) r = tn |n| (apex distance)          (degree 3),
# and n makes the cone's half-angle with the tangent plane, sin^2 = tn^2 /
# (1 + tn^2):
#   gs = (n.a)^2 (1 + tn^2) - tn^2 |n|^2 = 2 sn delta (1 + tn^2) |n|^2
#                                                                  (degree 6),
# delta the angle mismatch |cos(n, a)| - sn to first order. The apex must be
# within the band of the plane, and the generator from the apex to the
# reference circle (length r / sn) within the band at its far end:
# delta r / sn <= band, i.e. |gs| r <= 2 band tn^2 |n|^2.
def plane_cone_touch(+o: G.Vec3, +n: G.Vec3, +c: G.Vec3, +a: G.Vec3, +r: R.Real, +tn: R.Real) -> Bool:
  +nb = bv(n)
  +ab = bv(a)
  +na = bv.dot(nb, ab)
  +tb = RP.from_real(tn)
  +rb = RP.from_real(r)
  +unit_ok = big_zero(RP.sub(bv.dot(ab, ab), big_one(1n)))
  +ga = RP.sub(RP.mul(tb, bv.dot(nb, bv.sub(bv(c), bv(o)))), RP.mul(na, rb))
  +gs = RP.sub(RP.mul(big_sq(na), RP.add(big_one(1n), big_sq(tb))), lift(2n, RP.mul(big_sq(tb), bv.dot(nb, nb))))
  +band = wire_band(R.max(R.max(vmax(o), vmax(c)), R.max(R.abs(r), R.abs(R.div(r, tn)))))
  +nr = G.dot(n, n)
  +apex_ok = big_within(ga, R.mul(R.mul(band, tn), R.sqrt(nr)), 2n)
  +angle_ok = big_within(RP.mul(gs, rb), R.mul(R.mul(rf(2.0), band), R.mul(R.mul(tn, tn), nr)), 6n)
  Bool.and(unit_ok, Bool.and(apex_ok, angle_ok))

def codirected(u: G.Vec3, v: G.Vec3) -> Bool:
  R.less(R.sub(rf(1.0), G.dot(u, v)), eps_a())

def on_axis(p: G.Vec3, o: G.Vec3, +a: G.Vec3) -> Bool:
  near(vlen(A.radial(p, o, a)), eps_l())

# Same unoriented carrier within eps_l / eps_a (faces of different leaves that
# the Boolean made coincident).
def same(s1: Surf, s2: Surf) -> Bool:
  match s1 s2:
    case SPlane{+o1, +n1, _} SPlane{o2, n2, _}:
      Bool.and(parallel(n1, n2), near(G.dot(G.sub(o2, o1), n1), eps_l()))
    case SCyl{+o1, +a1, _, r1} SCyl{o2, a2, _, r2}:
      Bool.and(parallel(a1, a2), Bool.and(near(R.sub(r1, r2), eps_l()), on_axis(o2, o1, a1)))
    case SCone{o1, +a1, _, r1, ang1, tn1, _, _} SCone{o2, +a2, _, r2, ang2, tn2, _, _}:
      +d = G.sub(apex(o1, a1, r1, tn1), apex(o2, a2, r2, tn2))
      Bool.and(codirected(a1, a2), Bool.and(near(R.sub(ang1, ang2), eps_a()), near(vlen(d), eps_l())))
    case SSphere{o1, r1} SSphere{o2, r2}:
      Bool.and(near(vlen(G.sub(o1, o2)), eps_l()), near(R.sub(r1, r2), eps_l()))
    case STorus{+o1, +a1, b1, m1} STorus{o2, a2, b2, m2}:
      Bool.and(Bool.and(parallel(a1, a2), near(vlen(G.sub(o1, o2)), eps_l())),
        Bool.and(near(R.sub(b1, b2), eps_l()), near(R.sub(m1, m2), eps_l())))
    case _ _:
      False{}

# Unsigned distance to the carrier (exact for plane, cylinder, sphere, torus;
# for a cone the distance to its full double-napped surface away from the
# apex).
def residual(s: Surf, p: G.Vec3) -> R.Real:
  match s:
    case SPlane{o, n, _}:
      R.abs(G.dot(G.sub(p, o), n))
    case SCyl{o, a, _, r}:
      R.abs(R.sub(vlen(A.radial(p, o, a)), r))
    case SCone{o, +a, _, r, _, tn, cs, _}:
      +d = G.sub(p, o)
      +h = G.dot(d, a)
      rho = vlen(G.sub(d, G.scale(a, h)))
      R.mul(R.abs(R.sub(R.sub(rho, r), R.mul(h, tn))), cs)
    case SSphere{o, r}:
      R.abs(R.sub(vlen(G.sub(p, o)), r))
    case STorus{o, +a, big, small}:
      +d = G.sub(p, o)
      +h = G.dot(d, a)
      +rho = R.sub(vlen(G.sub(d, G.scale(a, h))), big)
      R.abs(R.sub(R.sqrt(R.add(R.mul(rho, rho), R.mul(h, h))), small))

# Implicit value (signed distance to first order) and unit gradient.
type FG is Data:
  FG{f: R.Real, g: G.Vec3}

def unit(+v: G.Vec3) -> G.Vec3:
  G.normalize(v)

def fg(s: Surf, p: G.Vec3) -> FG:
  match s:
    case SPlane{o, +n, _}:
      FG{G.dot(G.sub(p, o), n), n}
    case SCyl{o, a, _, r}:
      +rad = A.radial(p, o, a)
      FG{R.sub(vlen(rad), r), unit(rad)}
    case SCone{o, +a, _, r, _, tn, +cs, sn}:
      +d = G.sub(p, o)
      +h = G.dot(d, a)
      +rad = G.sub(d, G.scale(a, h))
      FG{R.mul(R.sub(R.sub(vlen(rad), r), R.mul(h, tn)), cs), G.sub(G.scale(unit(rad), cs), G.scale(a, sn))}
    case SSphere{o, r}:
      +d = G.sub(p, o)
      FG{R.sub(vlen(d), r), unit(d)}
    case STorus{o, +a, big, small}:
      +d = G.sub(p, o)
      +h = G.dot(d, a)
      +rad = G.sub(d, G.scale(a, h))
      +w = G.add(G.scale(unit(rad), R.sub(vlen(rad), big)), G.scale(a, h))
      FG{R.sub(vlen(w), small), unit(w)}

# Carrier normal at p, independent of which leaf the face came from: plane
# normal of the class representative, outward from the axis / centre for
# curved carriers.
def fg_g(q: FG) -> G.Vec3:
  FG{_, g} = q
  g

def normal_at(s: Surf, p: G.Vec3) -> G.Vec3:
  fg_g(fg(s, p))

# ---------------------------------------------------------------------------
# Exact vertices: Newton on three implicit carriers from the mesh seed.

def det3(+g1: G.Vec3, +g2: G.Vec3, g3: G.Vec3) -> R.Real:
  G.dot(g1, G.cross(g2, g3))

def newton.step(q1: FG, q2: FG, q3: FG, p: G.Vec3) -> G.Vec3:
  FG{f1, +g1} = q1
  FG{f2, +g2} = q2
  FG{f3, +g3} = q3
  +det = det3(g1, g2, g3)
  +num = G.add(G.add(G.scale(G.cross(g2, g3), f1), G.scale(G.cross(g3, g1), f2)), G.scale(G.cross(g1, g2), f3))
  G.sub(p, G.scale(num, R.div(rf(1.0), det)))

def newton(fuel: Nat, +s1: Surf, +s2: Surf, +s3: Surf, +p: G.Vec3) -> G.Vec3:
  match fuel:
    case 0n:
      p
    case 1n+f:
      newton(f, s1, s2, s3, newton.step(fg(s1, p), fg(s2, p), fg(s3, p), p))

def grad_det(s1: Surf, s2: Surf, s3: Surf, +p: G.Vec3) -> R.Real:
  det3(normal_at(s1, p), normal_at(s2, p), normal_at(s3, p))

type Triple is Data:
  Triple{s1: Surf, s2: Surf, s3: Surf, det: R.Real}

def better(a: Triple, b: Triple) -> Triple:
  Triple{+a1, +a2, +a3, +ad} = a
  Triple{+b1, +b2, +b3, +bd} = b
  Bool.pick(Triple, R.less(R.abs(ad), R.abs(bd)), Triple{b1, b2, b3, bd}, Triple{a1, a2, a3, ad})

def triples.k(ks: List<&2, Surf>, +s1: Surf, +s2: Surf, +p: G.Vec3, best: Triple) -> Triple:
  match ks:
    case Nil{}:
      best
    case +s3 <> t:
      triples.k(t, s1, s2, p, better(best, Triple{s1, s2, s3, grad_det(s1, s2, s3, p)}))

def triples.j(+js: List<&2, Surf>, +s1: Surf, +p: G.Vec3, best: Triple) -> Triple:
  match js:
    case Nil{}:
      best
    case +s2 <> t:
      triples.j(t, s1, p, triples.k(t, s1, s2, p, best))

def triples.i(+xs: List<&2, Surf>, +p: G.Vec3, best: Triple) -> Triple:
  match xs:
    case Nil{}:
      best
    case +s1 <> t:
      triples.i(t, p, triples.j(t, s1, p, best))

def max_residual(ss: List<&2, Surf>, +p: G.Vec3, acc: R.Real) -> R.Real:
  match ss:
    case Nil{}:
      acc
    case s <> t:
      max_residual(t, p, R.max(acc, residual(s, p)))

# A refined corner: exact point, distance moved from the seed, |det| of the
# unit gradients of the chosen triple, largest residual over ALL carriers
# meeting there, whether a contact helper (axial) decided it, and the least
# transversality of any two of those carriers at p (min_trans).
type Corner is Data:
  Corner{p: G.Vec3, drift: R.Real, det: R.Real, res: R.Real, aided: Bool, trans: R.Real}

def zero3() -> G.Vec3:
  G.v3(0.0, 0.0, 0.0)

# sin of half the angle between two tangent planes, sqrt((1 - |cos|) / 2): a
# point within dev of both carriers lies within dev / that of their
# intersection curve (the rhombus where the two dev slabs overlap; the same
# measure as edge.checked's tau in topo.bend). min_trans is its least value
# over all pairs of carriers at p (1 for fewer than two).
def trans.j(ts: List<&2, Surf>, +n: G.Vec3, +p: G.Vec3, acc: R.Real) -> R.Real:
  match ts:
    case Nil{}:
      acc
    case t <> rest:
      +c = R.abs(G.dot(n, unit(normal_at(t, p))))
      trans.j(rest, n, p, R.min(acc, R.sqrt(R.max(rf(0.0), R.div(R.sub(rf(1.0), c), rf(2.0))))))

def min_trans(ss: List<&2, Surf>, +p: G.Vec3, acc: R.Real) -> R.Real:
  match ss:
    case Nil{}:
      acc
    case s <> +t:
      min_trans(t, p, trans.j(t, unit(normal_at(s, p)), p, acc))

def refine.of(t: Triple, +ss: List<&2, Surf>, +seed: G.Vec3, aided: Bool) -> Corner:
  Triple{s1, s2, s3, det} = t
  +p = newton(8n, s1, s2, s3, seed)
  Corner{p, vlen(G.sub(p, seed)), R.abs(det), max_residual(ss, p, rf(0.0)), aided, min_trans(ss, p, rf(1.0))}

# Where two parallel cylinders meet (cyl_cyl_lines): u the unit offset of the
# second axis, t the distance along u from the first axis to the chord of the
# two circles.
def cyl_cyl_t(+dd: R.Real, +r1: R.Real, +r2: R.Real) -> R.Real:
  R.div(R.add(dd, R.sub(R.mul(r1, r1), R.mul(r2, r2))), R.mul(rf(2.0), R.max(R.sqrt(dd), rf(0.000000001))))

# Two cones on parallel axes, not coaxial, with radii r_i(t) = b_i + m_i t
# along a1 from o1 (cone 2 expressed as in cone_cone), that stay tangent for
# every t: externally (m1 + m2 = 0 and b1 + b2 = d) or internally (m1 = m2
# and |b1 - b2| = d), d the distance of the axes. Then they touch along one
# common generator, a straight line through the contact points of the two
# circles at t = 0 and t = 1 (cyl_cyl_t). Example: 45 degree chamfers along
# both sides of a tangent arc joint of an extruded profile (the R20 return
# plate: r 12 and r 2 arcs, axes 14 mm apart, one cone widening, the other
# narrowing along x). ok is False for any other pair; `same` (cone_same)
# requires exactly parallel axes and exactly equal half-angles, as for
# parallel cylinders.
type CL is Data:
  CL{ok: Bool, p: G.Vec3, d: G.Vec3}

def cone_contact(+o1: G.Vec3, +a1: G.Vec3, +r1: R.Real, +tn1: R.Real, +o2: G.Vec3, +a2: G.Vec3, +r2: R.Real, +tn2: R.Real, same: Bool) -> CL:
  +opp = R.less(G.dot(a1, a2), rf(0.0))
  +sigma = Bool.pick(R.Real, opp, rf(F32.neg(1.0)), rf(1.0))
  +m2 = R.mul(sigma, tn2)
  +b2 = R.sub(r2, R.mul(G.dot(a1, G.sub(o2, o1)), m2))
  +dv = A.radial(o2, o1, a1)
  +dd = G.dot(dv, dv)
  +d = R.sqrt(dd)
  +u = G.scale(dv, R.div(rf(1.0), R.max(d, rf(0.000000001))))
  +ok = Bool.and(same, Bool.and(Bool.not(R.less(d, eps_l())), cone_touch(o1, a1, r1, tn1, o2, r2, opp, d)))
  +p0 = G.add(o1, G.scale(u, cyl_cyl_t(dd, r1, b2)))
  +p1 = G.add(G.add(o1, a1), G.scale(u, cyl_cyl_t(dd, R.add(r1, tn1), R.add(b2, m2))))
  CL{ok, p0, G.normalize(G.sub(p1, p0))}

# A plane (o, n) through the cone's apex whose normal makes the cone's
# half-angle with the tangent plane (|n.a| = sin ang) touches the cone along
# one generator: from the apex along g = a cos ang + u sin ang, u = the unit
# of a - n / (n.a) (the radial direction whose cone normal is parallel to n);
# p is its point on the reference circle (radius r), off the apex.
# A 45 degree chamfer along a straight edge meets the chamfer cone of a
# tangent arc so (the R20 return plate). ok is False for any other plane.
def plane_cone_contact(+o: G.Vec3, +n: G.Vec3, +c: G.Vec3, +a: G.Vec3, +r: R.Real, +tn: R.Real, +cs: R.Real, +sn: R.Real) -> CL:
  +na = G.dot(n, a)
  +top = apex(c, a, r, tn)
  +ok = plane_cone_touch(o, n, c, a, r, tn)
  +u = unit(G.sub(a, G.scale(n, R.div(rf(1.0), Bool.pick(R.Real, R.less(R.abs(na), rf(0.000000001)), rf(1.0), na)))))
  +g = unit(G.add(G.scale(a, cs), G.scale(u, sn)))
  CL{ok, G.add(top, G.scale(g, R.div(r, sn))), g}

def cone_helper(c: CL, +o1: G.Vec3, +a1: G.Vec3, +cs: R.Real, +sn: R.Real) -> List<&2, Surf>:
  CL{ok, +p, +d} = c
  +n = G.sub(G.scale(unit(A.radial(p, o1, a1)), cs), G.scale(a1, sn))
  +q = unit(G.cross(d, n))
  Bool.pick(List<&2, Surf>, ok, [SPlane{p, q, A.axis_x(q)}], Nil{})

# At a tangent plane/cylinder pair the three gradients are dependent. The
# contact generator is then the intersection of the tangent plane with the
# axial plane through it (normal a x n), which is added as a helper carrier;
# the residual check still runs over the original carriers only. Two tangent
# cylinders with parallel axes (cyl_cyl_lines) touch along the generator in
# the plane through both axes (normal a x u, u the offset between the axes),
# the helper carrier of that pair. Two cones tangent along a common generator
# (cone_contact) have one normal along it (a cone is developable); the helper
# is the plane through that generator whose normal is the generator direction
# times that normal.
def axial(p: Surf, c: Surf) -> List<&2, Surf>:
  match p c:
    case SPlane{o, +n, _} SCyl{+co, +a, _, +r} :
      +dist = G.dot(n, G.sub(co, o))
      +ok = Bool.and(near(G.dot(n, a), rf(0.000000001)), near(R.sub(R.abs(dist), r), tangent_tol()))
      +q = unit(G.cross(a, n))
      Bool.pick(List<&2, Surf>, ok, [SPlane{co, q, A.axis_x(q)}], Nil{})
    case SCyl{+c1, +a1, _, +r1} SCyl{+c2, a2, _, +r2}:
      +dv = A.radial(c2, c1, a1)
      +d = vlen(dv)
      +ok = Bool.and(parallel_exact(a1, a2), Bool.and(Bool.not(R.less(d, eps_l())), tangency.touch(cyl_tangency(c1, a1, r1, c2, r2))))
      +q = unit(G.cross(a1, dv))
      Bool.pick(List<&2, Surf>, ok, [SPlane{c1, q, A.axis_x(q)}], Nil{})
    case SCone{+o1, +a1, _, r1, ang1, +tn1, cs, sn} SCone{o2, +a2, _, r2, ang2, tn2, _, _}:
      cone_helper(cone_contact(o1, a1, r1, tn1, o2, a2, r2, tn2, cone_same(a1, ang1, a2, ang2)), o1, a1, cs, sn)
    case SPlane{o, +n, _} SCone{+c, +a, _, r, _, tn, +cs, +sn}:
      cone_helper(plane_cone_contact(o, n, c, a, r, tn, cs, sn), c, a, cs, sn)
    case _ _:
      Nil{}

def axial.all.j(ts: List<&2, Surf>, +s: Surf, acc: List<&2, Surf>) -> List<&2, Surf>:
  match ts:
    case Nil{}:
      acc
    case +t <> rest:
      axial.all.j(rest, s, List.append(&2, Surf, axial(s, t), List.append(&2, Surf, axial(t, s), acc)))

def axial.all(+xs: List<&2, Surf>, acc: List<&2, Surf>) -> List<&2, Surf>:
  match xs:
    case Nil{}:
      acc
    case +s <> t:
      axial.all(t, axial.all.j(t, s, acc))

def refine.pick(t: Triple, +ss: List<&2, Surf>, +seed: G.Vec3) -> Corner:
  Triple{+s1, +s2, +s3, +det} = t
  +none = {SSphere{zero3(), rf(1.0)} : Surf}
  +helpers = axial.all(ss, Nil{})
  Bool.pick(Corner, R.less(R.abs(det), rf(0.000001)),
    refine.of(triples.i(List.append(&2, Surf, ss, helpers), seed, Triple{none, none, none, rf(0.0)}), ss, seed, True{}),
    refine.of(Triple{s1, s2, s3, det}, ss, seed, False{}))

def refine(+ss: List<&2, Surf>, +seed: G.Vec3) -> Corner:
  +none = {SSphere{zero3(), rf(1.0)} : Surf}
  refine.pick(triples.i(ss, seed, Triple{none, none, none, rf(0.0)}), ss, seed)

# ---------------------------------------------------------------------------
# Exact intersection curves. `seam` is the canonical vertex of a closed curve:
# the point on the generator of the periodic carrier at A.axis_x(axis), so
# both rims of a band share one generator (the seam line of the band).

type Cv is Data:
  CvOk{c: A.Curve, seam: G.Vec3, tangent: Bool}
  CvNo{why: String}

def one() -> R.Real:
  rf(1.0)

def circle_cv(center: G.Vec3, +axis: G.Vec3, +radius: R.Real) -> Cv:
  +x = A.axis_x(axis)
  +c = center
  CvOk{A.Circle{c, axis, x, radius}, G.add(c, G.scale(x, radius)), False{}}

def plane_plane(n1: G.Vec3, n2: G.Vec3, +seed: G.Vec3) -> Cv:
  +d = G.cross(n1, n2)
  Bool.pick(Cv, R.less(G.dot(d, d), rf(0.0000000000000001)), CvNo{"parallel planes are adjacent"},
    CvOk{A.Line{seed, G.normalize(d)}, seed, False{}})

# Plane (o, n) parallel to the axis of the cylinder (c, a, r): half the
# distance between its two generator lines, sqrt(r^2 - dist^2).
def plane_cyl_off(+o: G.Vec3, n: G.Vec3, c: G.Vec3, +r: R.Real) -> R.Real:
  +dist = G.dot(n, G.sub(c, o))
  R.sqrt(R.max(rf(0.0), R.sub(R.mul(r, r), R.mul(dist, dist))))

# The generator lines foot +- h w (direction a) of a pair whose carriers meet
# in parallel lines; the seed (a mesh point of the edge) picks the nearer one.
# A pair that touches (`touch`: the radial gap within tangent_tol for a plane
# and a cylinder, within the wire band for two cylinders, cyl_tangency) meets in
# the contact generator at the foot, unless the seed lies on one of the two
# lines, nearer to it than h / 2 (a quarter of their distance). The radial
# gap is second order in the crossing angle, so carriers that cross at a
# grazing angle pass the tangency test although their edge is not the
# contact generator: two three-point arcs of a profile share an end point,
# which lies exactly on both carriers, and are tangent only to a few 1e-5 rad
# (the R20 tray profile: radial gaps 3e-8..2e-5 mm, lines 0.013..17 mm
# apart). Their edge is the line through the shared point, h from the foot.
# An exactly tangent pair (h at rounding level) has its seed near the foot,
# about h from both lines, and stays a contact generator. `miss`: the
# carriers do not meet (for two cylinders: exactly, beyond the band).
def two_lines(+foot: G.Vec3, +w: G.Vec3, +h: R.Real, +a: G.Vec3, +touch: Bool, +miss: Bool, +seed: G.Vec3, why: String) -> Cv:
  +l1 = G.add(foot, G.scale(w, h))
  +l2 = G.sub(foot, G.scale(w, h))
  +d1 = vlen(A.radial(seed, l1, a))
  +d2 = vlen(A.radial(seed, l2, a))
  +l = Bool.pick(G.Vec3, R.less(d1, d2), l1, l2)
  +pinned = R.less(R.mul(rf(2.0), R.min(d1, d2)), h)
  Bool.pick(Cv, Bool.and(touch, Bool.not(pinned)), CvOk{A.Line{foot, a}, foot, True{}},
    Bool.pick(Cv, miss, CvNo{why}, CvOk{A.Line{l, a}, l, False{}}))

# Plane parallel to the cylinder axis: one of two generator lines, or the
# contact generator when tangent (two_lines).
def plane_cyl_lines(+o: G.Vec3, +n: G.Vec3, +c: G.Vec3, +a: G.Vec3, +r: R.Real, +seed: G.Vec3) -> Cv:
  +dist = G.dot(n, G.sub(c, o))
  +foot = G.sub(c, G.scale(n, dist))
  +gap = R.sub(r, R.abs(dist))
  two_lines(foot, G.normalize(G.cross(a, n)), plane_cyl_off(o, n, c, r), a, near(gap, tangent_tol()), R.less(gap, rf(0.0)), seed,
    "plane parallel to a cylinder it does not meet")

def plane_cyl_ellipse(+o: G.Vec3, +n: G.Vec3, +c: G.Vec3, +a: G.Vec3, +r: R.Real) -> Cv:
  +x = A.axis_x(a)
  +g0 = G.add(c, G.scale(x, r))
  +seam = G.add(g0, G.scale(a, R.div(G.dot(n, G.sub(o, g0)), G.dot(n, a))))
  CvOk{A.plane_cylinder(o, n, c, a, r), seam, False{}}

def plane_cyl(+o: G.Vec3, +n: G.Vec3, +c: G.Vec3, +a: G.Vec3, +r: R.Real, +seed: G.Vec3) -> Cv:
  +ca = G.dot(n, a)
  +perp = R.less(R.sub(one(), R.abs(ca)), rf(0.000000000001))
  +par = R.less(R.abs(ca), rf(0.000000000001))
  +center = G.add(c, G.scale(a, R.div(G.dot(n, G.sub(o, c)), ca)))
  Bool.pick(Cv, perp, circle_cv(center, a, r),
    Bool.pick(Cv, par, plane_cyl_lines(o, n, c, a, r, seed), plane_cyl_ellipse(o, n, c, a, r)))

def plane_cone.sect(+o: G.Vec3, +n: G.Vec3, +c: G.Vec3, +a: G.Vec3, +r: R.Real, +tn: R.Real, +sn: R.Real) -> Cv:
  +ca = G.dot(n, a)
  +perp = R.less(R.sub(one(), R.abs(ca)), rf(0.000000000001))
  +t = R.div(G.dot(n, G.sub(o, c)), ca)
  +radius = R.add(r, R.mul(t, tn))
  +s = R.abs(ca)
  +hyper = R.less(s, R.sub(sn, rf(0.000000001)))
  +para = R.less(R.abs(R.sub(s, sn)), rf(0.000000001))
  Bool.pick(Cv, perp,
    Bool.pick(Cv, R.less(radius, rf(0.000001)), CvNo{"plane through the cone apex"}, circle_cv(G.add(c, G.scale(a, t)), a, radius)),
    Bool.pick(Cv, hyper, CvNo{"plane/cone section is a hyperbola (curve type missing in the body format)"},
      Bool.pick(Cv, para, CvNo{"plane/cone section is a parabola (curve type missing in the body format)"},
        CvNo{"oblique plane/cone ellipse not implemented"})))

def plane_cone_line(t: CL, +whole: Cv) -> Cv:
  CL{ok, +p, d} = t
  Bool.pick(Cv, ok, CvOk{A.Line{p, d}, p, True{}}, whole)

def plane_cone(+o: G.Vec3, +n: G.Vec3, +c: G.Vec3, +a: G.Vec3, +r: R.Real, +tn: R.Real, +cs: R.Real, +sn: R.Real) -> Cv:
  plane_cone_line(plane_cone_contact(o, n, c, a, r, tn, cs, sn), plane_cone.sect(o, n, c, a, r, tn, sn))

def coaxial(+o1: G.Vec3, +a1: G.Vec3, o2: G.Vec3, a2: G.Vec3) -> Bool:
  Bool.and(parallel(a1, a2), on_axis(o2, o1, a1))

# Coaxial radius functions r_i(t) = b_i + m_i t along axis a from o.
def coaxial_circle(+o: G.Vec3, +a: G.Vec3, +b1: R.Real, +m1: R.Real, +b2: R.Real, +m2: R.Real) -> Cv:
  +dm = R.sub(m1, m2)
  +t = R.div(R.sub(b2, b1), dm)
  +radius = R.add(b1, R.mul(m1, t))
  Bool.pick(Cv, R.less(R.abs(dm), rf(0.000000000001)), CvNo{"coaxial carriers with parallel profiles do not meet in a circle"},
    Bool.pick(Cv, R.less(radius, rf(0.000001)), CvNo{"coaxial carriers meet at the axis"}, circle_cv(G.add(o, G.scale(a, t)), a, radius)))

# Cylinders with exactly parallel axes (parallel_exact; nearly parallel axes
# meet in a space quartic and are refused as such) that are not coaxial: in the plane perpendicular to a1 the
# carriers are circles of radius r1 and r2 whose centres lie d apart, so the
# carriers meet in the generator lines through the circle/circle points: none
# (d > r1 + r2 or d < |r1 - r2|), one contact generator when tangent (d =
# r1 + r2 outside, d = |r1 - r2| inside, within the wire band, cyl_tangency) or two lines at
# c1 + t u +- h w, t = (d^2 + r1^2 - r2^2) / 2d, h = sqrt(r1^2 - t^2), u the
# unit offset of c2 from the axis of c1, w = a1 x u (two_lines picks one).
# The edge certificate then measures every mesh point against it and the
# refined end vertices must lie on it.
# Half the distance between the two lines (h above; 0 when they do not meet).
def cyl_cyl_h(+c1: G.Vec3, +a: G.Vec3, +r1: R.Real, c2: G.Vec3, +r2: R.Real) -> R.Real:
  +dv = A.radial(c2, c1, a)
  +t = cyl_cyl_t(G.dot(dv, dv), r1, r2)
  R.sqrt(R.max(rf(0.0), R.sub(R.mul(r1, r1), R.mul(t, t))))

# `t` (cyl_tangency) decides contact and miss on the wire values.
def cyl_cyl_lines.k(t: Tangency, +c1: G.Vec3, +a: G.Vec3, +r1: R.Real, +c2: G.Vec3, +r2: R.Real, +seed: G.Vec3) -> Cv:
  Tangency{touch, miss} = t
  +dv = A.radial(c2, c1, a)
  +dd = G.dot(dv, dv)
  +d = R.sqrt(dd)
  +u = G.scale(dv, R.div(one(), R.max(d, rf(0.000000001))))
  +foot = G.add(c1, G.scale(u, cyl_cyl_t(dd, r1, r2)))
  two_lines(foot, G.normalize(G.cross(a, u)), cyl_cyl_h(c1, a, r1, c2, r2), a, touch, miss, seed,
    "parallel cylinders that do not meet are adjacent")

def cyl_cyl_lines(+c1: G.Vec3, +a: G.Vec3, +r1: R.Real, +c2: G.Vec3, +r2: R.Real, +seed: G.Vec3) -> Cv:
  cyl_cyl_lines.k(cyl_tangency(c1, a, r1, c2, r2), c1, a, r1, c2, r2, seed)

def cyl_cyl(+c1: G.Vec3, +a1: G.Vec3, +r1: R.Real, +c2: G.Vec3, +a2: G.Vec3, +r2: R.Real, +seed: G.Vec3) -> Cv:
  Bool.pick(Cv, coaxial(c1, a1, c2, a2), CvNo{"coaxial cylinders of different radius are adjacent"},
    Bool.pick(Cv, parallel_exact(a1, a2), cyl_cyl_lines(c1, a1, r1, c2, r2, seed),
      CvNo{"cylinder/cylinder intersection off a common axis is a space quartic (curve type missing)"}))

# Distance between the two candidate generator lines of a pair whose carriers
# meet in parallel lines (a plane parallel to a cylinder axis, parallel
# cylinders off a common axis); 0 for every other pair. An edge on a nearly
# tangent such pair is decided by which of the two lines its mesh boundary
# follows (topo.bend edge.checked).
def line_gap(s1: Surf, s2: Surf) -> R.Real:
  match s1 s2:
    case SPlane{o, +n, _} SCyl{c, a, _, r}:
      Bool.pick(R.Real, R.less(R.abs(G.dot(n, a)), rf(0.000000000001)), R.mul(rf(2.0), plane_cyl_off(o, n, c, r)), rf(0.0))
    case SCyl{c, a, _, r} SPlane{o, +n, _}:
      Bool.pick(R.Real, R.less(R.abs(G.dot(n, a)), rf(0.000000000001)), R.mul(rf(2.0), plane_cyl_off(o, n, c, r)), rf(0.0))
    case SCyl{+c1, +a1, _, r1} SCyl{+c2, +a2, _, r2}:
      Bool.pick(R.Real, Bool.and(parallel_exact(a1, a2), Bool.not(coaxial(c1, a1, c2, a2))), R.mul(rf(2.0), cyl_cyl_h(c1, a1, r1, c2, r2)), rf(0.0))
    case _ _:
      rf(0.0)

def cyl_cone(+c: G.Vec3, +ca: G.Vec3, +r: R.Real, +o: G.Vec3, +a: G.Vec3, +r2: R.Real, +tn: R.Real) -> Cv:
  Bool.pick(Cv, coaxial(o, a, c, ca), coaxial_circle(o, a, r2, tn, r, rf(0.0)),
    CvNo{"cylinder/cone intersection off a common axis is a space quartic (curve type missing)"})

def cone_contact_cv(c: CL, +o1: G.Vec3, +a1: G.Vec3, +r1: R.Real, +tn1: R.Real, +o2: G.Vec3, +a2: G.Vec3, +r2: R.Real, +tn2: R.Real) -> Cv:
  CL{ok, +p, d} = c
  +sigma = Bool.pick(R.Real, R.less(G.dot(a1, a2), rf(0.0)), rf(F32.neg(1.0)), rf(1.0))
  +t2 = G.dot(a1, G.sub(o2, o1))
  # r2(t) = r2 + sigma (t - t2) tn2 = (r2 - sigma t2 tn2) + (sigma tn2) t
  +m2 = R.mul(sigma, tn2)
  Bool.pick(Cv, coaxial(o1, a1, o2, a2), coaxial_circle(o1, a1, r1, tn1, R.sub(r2, R.mul(t2, m2)), m2),
    Bool.pick(Cv, ok, CvOk{A.Line{p, d}, p, True{}},
      CvNo{"cone/cone intersection off a common axis is a space quartic (curve type missing)"}))

def cone_cone(+o1: G.Vec3, +a1: G.Vec3, +r1: R.Real, +tn1: R.Real, +o2: G.Vec3, +a2: G.Vec3, +r2: R.Real, +tn2: R.Real, same: Bool) -> Cv:
  cone_contact_cv(cone_contact(o1, a1, r1, tn1, o2, a2, r2, tn2, same), o1, a1, r1, tn1, o2, a2, r2, tn2)

# --- sphere and torus sections (all circles; anything else is refused) ------

def tiny2() -> R.Real:
  rf(0.000000000001)

# The circle through the seed side of two candidates at axial offsets t1, t2
# (along a from o), for pairs that meet in two coaxial circles.
def nearer(+seed_t: R.Real, +t1: R.Real, +t2: R.Real) -> R.Real:
  Bool.pick(R.Real, R.less(R.abs(R.sub(seed_t, t1)), R.abs(R.sub(seed_t, t2))), t1, t2)

def tangent_circle(center: G.Vec3, +axis: G.Vec3, +radius: R.Real) -> Cv:
  +x = A.axis_x(axis)
  +c = center
  CvOk{A.Circle{c, axis, x, radius}, G.add(c, G.scale(x, radius)), True{}}

# Plane with normal n through o and sphere (c, rs): circle in the plane.
def plane_sphere(+o: G.Vec3, +n: G.Vec3, +c: G.Vec3, +rs: R.Real) -> Cv:
  +d = G.dot(n, G.sub(c, o))
  +rho2 = R.sub(R.mul(rs, rs), R.mul(d, d))
  Bool.pick(Cv, R.less(rho2, tiny2()), CvNo{"plane tangent to or missing its sphere"},
    circle_cv(G.sub(c, G.scale(n, d)), n, R.sqrt(rho2)))

# Two spheres meet in a circle in their radical plane.
def sphere_sphere(+c1: G.Vec3, +r1: R.Real, +c2: G.Vec3, +r2: R.Real) -> Cv:
  +dv = G.sub(c2, c1)
  +dd = G.dot(dv, dv)
  +dist = R.sqrt(dd)
  +u = G.scale(dv, R.div(one(), R.max(dist, rf(0.000000001))))
  +t = R.div(R.add(dd, R.sub(R.mul(r1, r1), R.mul(r2, r2))), R.mul(rf(2.0), R.max(dist, rf(0.000000001))))
  +rho2 = R.sub(R.mul(r1, r1), R.mul(t, t))
  Bool.pick(Cv, R.less(dist, eps_l()), CvNo{"concentric spheres are adjacent"},
    Bool.pick(Cv, R.less(rho2, tiny2()), CvNo{"spheres touch or miss (no transversal circle)"},
      circle_cv(G.add(c1, G.scale(u, t)), u, R.sqrt(rho2))))

# Sphere (cs, rs) and cylinder (o, a, rc) sharing the axis: two circles of
# radius rc at axial offsets t0 +- sqrt(rs^2 - rc^2); the seed picks one.
def sphere_cyl(+cs: G.Vec3, +rs: R.Real, +o: G.Vec3, +a: G.Vec3, +rc: R.Real, +seed: G.Vec3) -> Cv:
  +t0 = G.dot(G.sub(cs, o), a)
  +h2 = R.sub(R.mul(rs, rs), R.mul(rc, rc))
  +h = R.sqrt(R.max(rf(0.0), h2))
  +t = nearer(G.dot(G.sub(seed, o), a), R.add(t0, h), R.sub(t0, h))
  Bool.pick(Cv, Bool.not(on_axis(cs, o, a)), CvNo{"sphere/cylinder intersection off the axis is a space quartic (curve type missing)"},
    Bool.pick(Cv, R.less(h2, tiny2()), CvNo{"cylinder tangent to or missing its sphere (no transversal circle)"},
      circle_cv(G.add(o, G.scale(a, t)), a, rc)))

# Sphere (cs, rs) and coaxial cone: (r + t tn)^2 + (t - ts)^2 = rs^2.
def sphere_cone(+cs: G.Vec3, +rs: R.Real, +o: G.Vec3, +a: G.Vec3, +r: R.Real, +tn: R.Real, +seed: G.Vec3) -> Cv:
  +ts = G.dot(G.sub(cs, o), a)
  +qa = R.add(R.mul(tn, tn), one())
  +qb = R.mul(rf(2.0), R.sub(R.mul(r, tn), ts))
  +qc = R.sub(R.add(R.mul(r, r), R.mul(ts, ts)), R.mul(rs, rs))
  +disc = R.sub(R.mul(qb, qb), R.mul(rf(4.0), R.mul(qa, qc)))
  +sq = R.sqrt(R.max(rf(0.0), disc))
  +den = R.mul(rf(2.0), qa)
  +t = nearer(G.dot(G.sub(seed, o), a), R.div(R.sub(sq, qb), den), R.div(R.sub(R.neg(qb), sq), den))
  +radius = R.add(r, R.mul(t, tn))
  Bool.pick(Cv, Bool.not(on_axis(cs, o, a)), CvNo{"sphere/cone intersection off the axis is a space quartic (curve type missing)"},
    Bool.pick(Cv, R.less(disc, tiny2()), CvNo{"cone tangent to or missing its sphere (no transversal circle)"},
      Bool.pick(Cv, R.less(radius, rf(0.000001)), CvNo{"sphere/cone circle at the cone apex"}, circle_cv(G.add(o, G.scale(a, t)), a, radius))))

# Plane containing the torus axis: one of the two meridian circles.
# The circle's reference direction is radial (away from the torus axis), so
# its seam vertex lies on the outer equator: a band between two meridians
# then shares one latitude seam through both rim vertices.
def torus_meridian(+ot: G.Vec3, +a: G.Vec3, +big: R.Real, +small: R.Real, +n: G.Vec3, +seed: G.Vec3) -> Cv:
  +w = G.normalize(G.cross(a, n))
  +c1 = G.add(ot, G.scale(w, big))
  +c2 = G.sub(ot, G.scale(w, big))
  +near1 = R.less(vlen(G.sub(seed, c1)), vlen(G.sub(seed, c2)))
  +c = Bool.pick(G.Vec3, near1, c1, c2)
  +x = Bool.pick(G.Vec3, near1, w, vneg(w))
  CvOk{A.Circle{c, n, x, small}, G.add(c, G.scale(x, small)), False{}}

# Plane and torus (ot, a, big, small): a plane perpendicular to the axis at
# height h cuts the circles of radius big +- sqrt(small^2 - h^2) (one tangent
# circle when |h| = small); a plane through the axis cuts two meridian
# circles. Other planes cut spiric sections (quartics): refused.
def plane_torus(+o: G.Vec3, +n: G.Vec3, +ot: G.Vec3, +a: G.Vec3, +big: R.Real, +small: R.Real, +seed: G.Vec3) -> Cv:
  +ca = G.dot(n, a)
  +perp = R.less(R.sub(one(), R.abs(ca)), tiny2())
  +through = Bool.and(R.less(R.abs(ca), tiny2()), near(G.dot(n, G.sub(ot, o)), eps_l()))
  +h = G.dot(G.sub(o, ot), a)
  +q2 = R.sub(R.mul(small, small), R.mul(h, h))
  +q = R.sqrt(R.max(rf(0.0), q2))
  +center = G.add(ot, G.scale(a, h))
  +rs = vlen(A.radial(seed, ot, a))
  +radius = nearer(rs, R.add(big, q), R.sub(big, q))
  +touch = R.less(R.abs(q2), rf(0.0000000001))
  Bool.pick(Cv, perp,
    Bool.pick(Cv, touch, tangent_circle(center, a, big),
      Bool.pick(Cv, R.less(q2, rf(0.0)), CvNo{"plane perpendicular to a torus axis misses the torus"}, circle_cv(center, a, radius))),
    Bool.pick(Cv, through, torus_meridian(ot, a, big, small, n, seed),
      CvNo{"plane/torus section is a spiric curve (quartic; curve type missing)"}))

# Cylinder (o, ac, rc) coaxial with the torus: circles of radius rc at axial
# heights +- sqrt(small^2 - (rc - big)^2) (tangent when that is 0).
def torus_cyl(+ot: G.Vec3, +a: G.Vec3, +big: R.Real, +small: R.Real, +o: G.Vec3, +ac: G.Vec3, +rc: R.Real, +seed: G.Vec3) -> Cv:
  +g = R.sub(rc, big)
  +h2 = R.sub(R.mul(small, small), R.mul(g, g))
  +h = R.sqrt(R.max(rf(0.0), h2))
  +t = nearer(G.dot(G.sub(seed, ot), a), h, R.neg(h))
  +center = G.add(ot, G.scale(a, t))
  Bool.pick(Cv, Bool.not(coaxial(ot, a, o, ac)), CvNo{"torus/cylinder intersection off a common axis is a space curve (curve type missing)"},
    Bool.pick(Cv, R.less(R.abs(h2), rf(0.0000000001)), tangent_circle(center, a, rc),
      Bool.pick(Cv, R.less(h2, rf(0.0)), CvNo{"coaxial cylinder misses the torus"}, circle_cv(center, a, rc))))

def curve.quadric(s1: Surf, s2: Surf, +seed: G.Vec3) -> Cv:
  match s1 s2:
    case SPlane{_, n1, _} SPlane{_, n2, _}:
      plane_plane(n1, n2, seed)
    case SPlane{o, n, _} SCyl{c, a, _, r}:
      plane_cyl(o, n, c, a, r, seed)
    case SCyl{c, a, _, r} SPlane{o, n, _}:
      plane_cyl(o, n, c, a, r, seed)
    case SPlane{o, n, _} SCone{c, a, _, r, _, tn, cs, sn}:
      plane_cone(o, n, c, a, r, tn, cs, sn)
    case SCone{c, a, _, r, _, tn, cs, sn} SPlane{o, n, _}:
      plane_cone(o, n, c, a, r, tn, cs, sn)
    case SCyl{c1, a1, _, r1} SCyl{c2, a2, _, r2}:
      cyl_cyl(c1, a1, r1, c2, a2, r2, seed)
    case SCyl{c, ca, _, r} SCone{o, a, _, r2, _, tn, _, _}:
      cyl_cone(c, ca, r, o, a, r2, tn)
    case SCone{o, a, _, r2, _, tn, _, _} SCyl{c, ca, _, r}:
      cyl_cone(c, ca, r, o, a, r2, tn)
    case SCone{o1, +a1, _, r1, ang1, tn1, _, _} SCone{o2, +a2, _, r2, ang2, tn2, _, _}:
      cone_cone(o1, a1, r1, tn1, o2, a2, r2, tn2, cone_same(a1, ang1, a2, ang2))
    case _ _:
      CvNo{"no analytic curve implemented for this surface pair"}

def curve(s1: Surf, s2: Surf, +seed: G.Vec3) -> Cv:
  match s1 s2:
    case SPlane{o, n, _} SSphere{c, r}:
      plane_sphere(o, n, c, r)
    case SSphere{c, r} SPlane{o, n, _}:
      plane_sphere(o, n, c, r)
    case SSphere{c1, r1} SSphere{c2, r2}:
      sphere_sphere(c1, r1, c2, r2)
    case SSphere{cs, rs} SCyl{o, a, _, rc}:
      sphere_cyl(cs, rs, o, a, rc, seed)
    case SCyl{o, a, _, rc} SSphere{cs, rs}:
      sphere_cyl(cs, rs, o, a, rc, seed)
    case SSphere{cs, rs} SCone{o, a, _, r, _, tn, _, _}:
      sphere_cone(cs, rs, o, a, r, tn, seed)
    case SCone{o, a, _, r, _, tn, _, _} SSphere{cs, rs}:
      sphere_cone(cs, rs, o, a, r, tn, seed)
    case SPlane{o, n, _} STorus{ot, a, big, small}:
      plane_torus(o, n, ot, a, big, small, seed)
    case STorus{ot, a, big, small} SPlane{o, n, _}:
      plane_torus(o, n, ot, a, big, small, seed)
    case STorus{ot, a, big, small} SCyl{o, ac, _, rc}:
      torus_cyl(ot, a, big, small, o, ac, rc, seed)
    case SCyl{o, ac, _, rc} STorus{ot, a, big, small}:
      torus_cyl(ot, a, big, small, o, ac, rc, seed)
    case _ _:
      curve.quadric(s1, s2, seed)

# ---------------------------------------------------------------------------
# Certification helpers.

# Upper bound on the distance from p to the curve (exact for lines and
# circles; for an ellipse the radial scaling bound, at most major/minor times
# the true distance).
def cdist(c: A.Curve, p: G.Vec3) -> R.Real:
  match c:
    case A.Line{o, +d}:
      vlen(G.cross(G.sub(p, o), d))
    case A.Circle{o, +n, _, r}:
      +d = G.sub(p, o)
      +h = G.dot(d, n)
      +rho = R.sub(vlen(G.sub(d, G.scale(n, h))), r)
      R.sqrt(R.add(R.mul(h, h), R.mul(rho, rho)))
    case A.Ellipse{o, +n, +x, +major, minor}:
      +d = G.sub(p, o)
      +h = G.dot(d, n)
      +u = R.div(G.dot(d, x), major)
      +v = R.div(G.dot(d, G.cross(n, x)), minor)
      +e = R.mul(R.sub(R.sqrt(R.add(R.mul(u, u), R.mul(v, v))), one()), major)
      R.sqrt(R.add(R.mul(h, h), R.mul(e, e)))

# How much larger than the true distance cdist can be (ellipse: major/minor).
def cdist_factor(c: A.Curve) -> F32:
  match c:
    case A.Ellipse{_, _, _, major, minor}:
      R.approx(R.div(major, minor))
    case _:
      1.0

# Parametric angle of p on a circle or ellipse (F32; used for sweeps only).
def angle(c: A.Curve, p: G.Vec3) -> F32:
  match c:
    case A.Circle{o, +n, +x, _}:
      +d = G.sub(p, o)
      F32.atan2(R.approx(G.dot(d, G.cross(n, x))), R.approx(G.dot(d, x)))
    case A.Ellipse{o, +n, +x, major, minor}:
      +d = G.sub(p, o)
      F32.atan2(R.approx(R.div(G.dot(d, G.cross(n, x)), minor)), R.approx(R.div(G.dot(d, x), major)))
    case A.Line{o, d}:
      R.approx(G.dot(G.sub(p, o), d))

def wrap(+d: F32) -> F32:
  +tau = (2.0 * F32.pi() : F32)
  Bool.pick(F32, (d > F32.pi() : F32), (d - tau : F32), Bool.pick(F32, (d < F32.neg(F32.pi()) : F32), (d + tau : F32), d))

def flip_curve(c: A.Curve) -> A.Curve:
  match c:
    case A.Line{o, d}:
      A.Line{o, vneg(d)}
    case A.Circle{o, n, x, r}:
      A.Circle{o, vneg(n), x, r}
    case A.Ellipse{o, n, x, major, minor}:
      A.Ellipse{o, vneg(n), x, major, minor}

def is_line(c: A.Curve) -> Bool:
  match c:
    case A.Line{_, _}:
      True{}
    case _:
      False{}

# Projection of the curve's own normal (plane curves) used to orient it.
def curve_normal(c: A.Curve) -> G.Vec3:
  match c:
    case A.Line{_, d}:
      d
    case A.Circle{_, n, _, _}:
      n
    case A.Ellipse{_, n, _, _, _}:
      n

def curve_center(c: A.Curve) -> G.Vec3:
  match c:
    case A.Line{o, _}:
      o
    case A.Circle{o, _, _, _}:
      o
    case A.Ellipse{o, _, _, _, _}:
      o


def curve_x(c: A.Curve) -> G.Vec3:
  match c:
    case A.Line{_, d}:
      d
    case A.Circle{_, _, x, _}:
      x
    case A.Ellipse{_, _, x, _, _}:
      x

def is_circle(c: A.Curve) -> Bool:
  match c:
    case A.Circle{_, _, _, _}:
      True{}
    case _:
      False{}

# Meridian circle of a surface of revolution through the generator at x:
# centre and radius (sphere: its great circle; torus: the tube circle at x).
type Mer is Data:
  Mer{m: G.Vec3, r: R.Real}

def meridian(s: Surf, +x: G.Vec3) -> Mer:
  match s:
    case SSphere{o, r}:
      Mer{o, r}
    case STorus{o, _, big, small}:
      Mer{G.add(o, G.scale(x, big)), small}
    case _:
      Mer{zero3(), rf(0.0)}
