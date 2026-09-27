import Base
import ../../real.bend as R
import ../../precise.bend as G
import ./util.bend as U

# corefine: the symbolic-perturbation ("shadow") predicates of Manifold's
# Boolean3 (src/boolean3.cpp and src/shared.h, Apache-2.0, Emmett Lalish and
# the Manifold authors), ported to Bend over F32x2 Reals.
#
# Mesh P is the left operand, Q the right one. A vertex of P is compared with
# a vertex of Q coordinate by coordinate; an exact tie is broken by the sign
# of a perturbation direction built from vertex / face normals, so every
# comparison has a definite answer. All higher-dimensional decisions are sums
# of these answers:
#   shadow01  vertex vs edge   (x interval, then y above/below)
#   kernel11  edge vs edge     (projected crossing, then z above/below)
#   kernel02  vertex vs face   (projected containment, then z above/below)
#   kernel12  edge vs face     (crossing number x12 and the crossing point)
# Each decision is a pure function of its operands' records, so an edge / face
# pair that is evaluated from several places always gets the same answer; the
# Boolean's topology is derived only from these answers, never from the
# computed positions. Positions (y, z at x; crossing points) are Reals
# (~48-bit), computed as in Manifold with the better-conditioned endpoint.
#
# expandP is true for union (P expanded along its normals) and false for
# subtract / intersect (P contracted); Q is always expanded.
#
# Carrier unification (plan step 4, unify.bend): the z comparison of kernel02
# (vertex vs face) and kernel11 (edge vs edge) treats two values within tz =
# 2^-36*scale as an exact tie when the two elements touch a common unified
# plane class (VRec.k / FRec.k bit masks). Faces of different leaves whose
# plane carriers agree within 2^-44*scale are then decided as exactly
# coplanar, instead of by the ~1e-14 mm rounding of a rotated input, and a
# point constructed at such a tie takes the value it was compared with
# (tie_canon), so the tie is one point. The masks are 0 when a job has no
# unified class, and every predicate and construction is unchanged.

# A vertex: position, tie-break direction (vertex normal) and the bit mask of
# the unified plane classes of its triangles (unify.bend; 0 without any).
type VRec is Data:
  VRec{p: G.Vec3, n: U.N3, k: U32}

# An edge oriented from its lower to its higher vertex index; n is the sum of
# the normals of its two faces.
type ERec is Data:
  ERec{s: VRec, e: VRec, n: U.N3}

# A face edge: its oriented edge and whether the face runs along it.
type FEdge is Data:
  FEdge{e: ERec, fwd: Bool}

# k: the unified plane classes of the face's corners (OR of their VRec.k).
type FRec is Data:
  FRec{n: U.N3, e0: FEdge, e1: FEdge, e2: FEdge, k: U32}

type YZ is Data:
  YZ{y: R.Real, z: R.Real}

type Q4 is Data:
  Q4{x: R.Real, y: R.Real, za: R.Real, zb: R.Real}

# shadow01: None when the x intervals do not overlap (Manifold: NaN).
type Sh is Data:
  ShNone{}
  Sh{s: U32, y: R.Real, z: R.Real}

# One accepted term of a boundary sum with its two bracketing points.
type Ct is Data:
  Ct{s: U32, sh: Bool, a: G.Vec3, b: G.Vec3}
  CtBad{}

type Pk is Data:
  PkNone{}
  Pk{a0: G.Vec3, b0: G.Vec3, a1: G.Vec3, b1: G.Vec3}

type K11 is Data:
  K11None{}
  K11Bad{}
  K11{s: U32, v: Q4}

type K02 is Data:
  K02None{}
  K02Bad{}
  K02{s: U32, z: R.Real}

type K12 is Data:
  K12None{}
  K12Bad{}
  K12{x: U32, v: G.Vec3}

def vrec_p(v: VRec) -> G.Vec3:
  VRec{p, _, _} = v
  p

def vrec_k(v: VRec) -> U32:
  VRec{_, _, k} = v
  k

def erec_s(e: ERec) -> VRec:
  ERec{s, _, _} = e
  s

def erec_e(e: ERec) -> VRec:
  ERec{_, x, _} = e
  x

def yz_y(v: YZ) -> R.Real:
  YZ{y, _} = v
  y

def q4_za(v: Q4) -> R.Real:
  Q4{_, _, za, _} = v
  za

def q4_zb(v: Q4) -> R.Real:
  Q4{_, _, _, zb} = v
  zb

# A comparison decided as a tie under carrier unification (rel and
# |p - q| <= tz, U.near.if) is also constructed from one value: q is replaced
# by p (docs/hybrid-robust.md X2). Otherwise the x12 and x21 constructions of
# one symbolic point come out ~1e-14 mm apart (two roundings of one point, not
# joined by an edge, so the short-edge collapse misses them). With it they
# are bitwise identical, as for exactly coplanar input, and the exact weld
# joins them. No decision changes; a coordinate moves by |p - q| <= tz, in
# fact by the construction noise plus the class's carrier spread (the
# diagnostic entry fixtures/r20/relief-union/tools/tiegap.bend measures the
# largest |p - q| replaced per job: <= 2^-42 * S on the relief-union repros,
# up to 2^-38.3 * S on 388 jobs; docs/proto-corefine.md step 10).
def tie_canon(rel: Bool, +p: R.Real, +q: R.Real, +tz: F32) -> R.Real:
  U.rpick(U.near.if(rel, p, q, tz), p, q)

# --- Manifold shared.h Interpolate / Intersect ----------------------------------

def interp.if(zero: Bool, +useL: Bool, dxL: R.Real, dxR: R.Real, +aL: G.Vec3, +aR: G.Vec3, +d: G.Vec3) -> YZ:
  match zero:
    case True{}:
      YZ{U.vy(aL), U.vz(aL)}
    case False{}:
      +lambda = R.div(U.rpick(useL, dxL, dxR), U.vx(d))
      YZ{R.add(R.mul(lambda, U.vy(d)), U.rpick(useL, U.vy(aL), U.vy(aR))), R.add(R.mul(lambda, U.vz(d)), U.rpick(useL, U.vz(aL), U.vz(aR)))}

# (y, z) of segment aL-aR at x.
def interpolate(+aL: G.Vec3, +aR: G.Vec3, +x: R.Real) -> YZ:
  +dxL = R.sub(x, U.vx(aL))
  +dxR = R.sub(x, U.vx(aR))
  +d = G.sub(aR, aL)
  interp.if(U.ris_zero(U.vx(d)), U.rabs_lt(dxL, dxR), dxL, dxR, aL, aR, d)

# The crossing lies between the two bracketing points: lambda in [0, 1] from
# the left one, [-1, 0] from the right one. The y gaps have opposite signs
# only up to rounding (and exact ties decided symbolically, or ties within the
# unification tolerance): nearly parallel segments then give a quotient of
# rounding noise far outside the bracket (a rotated edge lying in a unified
# plane put its crossing 7 mm off its own ends). It is clamped to the bracket;
# a lambda inside it is unchanged.
def isect.clamp(+useL: Bool, +l: R.Real) -> R.Real:
  +lo = U.rpick(useL, U.rzero(), R.neg(R.from_f32(1.0)))
  +hi = U.rpick(useL, R.from_f32(1.0), U.rzero())
  U.rpick(R.less(l, lo), lo, U.rpick(R.less(hi, l), hi, l))

def isect.lambda(zero: Bool, +useL: Bool, dyL: R.Real, dyR: R.Real, den: R.Real) -> R.Real:
  match zero:
    case True{}:
      U.rzero()
    case False{}:
      isect.clamp(useL, R.div(U.rpick(useL, dyL, dyR), den))

def isect.go(+lambda: R.Real, +useL: Bool, +aL: G.Vec3, +aR: G.Vec3, +bL: G.Vec3, +bR: G.Vec3) -> Q4:
  +aDy = R.sub(U.vy(aR), U.vy(aL))
  +bDy = R.sub(U.vy(bR), U.vy(bL))
  +useA = U.rabs_lt(aDy, bDy)
  x = R.add(R.mul(lambda, R.sub(U.vx(aR), U.vx(aL))), U.rpick(useL, U.vx(aL), U.vx(aR)))
  y = R.add(R.mul(lambda, U.rpick(useA, aDy, bDy)), U.rpick(useL, U.rpick(useA, U.vy(aL), U.vy(bL)), U.rpick(useA, U.vy(aR), U.vy(bR))))
  za = R.add(R.mul(lambda, R.sub(U.vz(aR), U.vz(aL))), U.rpick(useL, U.vz(aL), U.vz(aR)))
  zb = R.add(R.mul(lambda, R.sub(U.vz(bR), U.vz(bL))), U.rpick(useL, U.vz(bL), U.vz(bR)))
  Q4{x, y, za, zb}

# Crossing of the projected segments aL-aR and bL-bR (same x interval, y gaps
# of opposite sign): (x, y, a.z, b.z) there.
def intersect(+aL: G.Vec3, +aR: G.Vec3, +bL: G.Vec3, +bR: G.Vec3) -> Q4:
  +dyL = R.sub(U.vy(bL), U.vy(aL))
  +dyR = R.sub(U.vy(bR), U.vy(aR))
  +useL = U.rabs_lt(dyL, dyR)
  +den = R.sub(dyL, dyR)
  isect.go(isect.lambda(U.ris_zero(den), useL, dyL, dyR, den), useL, aL, aR, bL, bR)

# --- shadow01 -------------------------------------------------------------------

def shadow01.x(fwd: Bool, +eP: Bool, +a0x: R.Real, +an: U.N3, +bsx: R.Real, +bsn: U.N3, +bex: R.Real, +ben: U.N3) -> U32:
  match fwd:
    case True{}:
      +d = U.with_sign(eP, U.nx(an))
      (U.b2u(U.shadows(a0x, bex, (d - U.nx(ben) : F32))) - U.b2u(U.shadows(a0x, bsx, (d - U.nx(bsn) : F32))) : U32)
    case False{}:
      (U.b2u(U.shadows(bsx, a0x, (U.with_sign(eP, U.nx(bsn)) - U.nx(an) : F32))) - U.b2u(U.shadows(bex, a0x, (U.with_sign(eP, U.nx(ben)) - U.nx(an) : F32))) : U32)

def shadow01.keep(fwd: Bool, eP: Bool, +ay: R.Real, +y: R.Real, +dir: F32, rel: Bool, +tz: F32) -> Bool:
  match fwd:
    case True{}:
      U.shadows_u(ay, y, F32.neg(dir), rel, tz)
    case False{}:
      U.shadows_u(y, ay, U.with_sign(eP, dir), rel, tz)

def shadow01.fin(keep: Bool, +s: U32, yz: YZ, +ay: R.Real, rel: Bool, +tz: F32) -> Sh:
  YZ{+y, z} = yz
  Sh{Bool.pick(U32, keep, s, 0), tie_canon(rel, ay, y, tz), z}

def shadow01.y(hit: Bool, fwd: Bool, eP: Bool, +s: U32, +ap: G.Vec3, +bsp: G.Vec3, +bep: G.Vec3, +dir: F32, +rel: Bool, +tz: F32) -> Sh:
  match hit:
    case False{}:
      ShNone{}
    case True{}:
      +yz = interpolate(bsp, bep, U.vx(ap))
      shadow01.fin(shadow01.keep(fwd, eP, U.vy(ap), yz_y(yz), dir, rel, tz), s, yz, U.vy(ap), rel, tz)

# Do two class masks share a unified plane class?
def krel(+a: U32, +b: U32) -> Bool:
  U.nonzero(U32.and(a, b))

# Vertex a0 against edge b1. fwd: a0 is a vertex of P and b1 an edge of Q;
# otherwise a0 is a vertex of Q and b1 an edge of P.
def shadow01(+eP: Bool, +fwd: Bool, a0: VRec, b1: ERec, +tz: F32) -> Sh:
  VRec{+ap, +an, +ak} = a0
  ERec{bs, be, bn} = b1
  VRec{+bsp, +bsn, +bsk} = bs
  VRec{+bep, +ben, +bek} = be
  +s = shadow01.x(fwd, eP, U.vx(ap), an, U.vx(bsp), bsn, U.vx(bep), ben)
  shadow01.y(U.nonzero(s), fwd, eP, s, ap, bsp, bep, U.ny(bn), krel(ak, U32.or(bsk, bek)), tz)

# --- boundary sums ----------------------------------------------------------------

def ct_sum(cs: List<&2, Ct>, acc: U32) -> U32:
  match cs:
    case Nil{}:
      acc
    case Ct{s, _, _, _} <> t:
      ct_sum(t, (acc + s : U32))
    case CtBad{} <> t:
      ct_sum(t, acc)

def ct_bad(cs: List<&2, Ct>) -> Bool:
  match cs:
    case Nil{}:
      False{}
    case Ct{_, _, _, _} <> t:
      ct_bad(t)
    case CtBad{} <> t:
      True{}

def pick2.find(want: Bool, +a0: G.Vec3, +b0: G.Vec3, cs: List<&2, Ct>) -> Pk:
  match want cs:
    case _ Nil{}:
      PkNone{}
    case _ CtBad{} <> t:
      PkNone{}
    case True{} Ct{_, True{}, a, b} <> t:
      Pk{a0, b0, a, b}
    case True{} Ct{_, False{}, _, _} <> t:
      pick2.find(True{}, a0, b0, t)
    case False{} Ct{_, False{}, a, b} <> t:
      Pk{a0, b0, a, b}
    case False{} Ct{_, True{}, _, _} <> t:
      pick2.find(False{}, a0, b0, t)

# The first term, then the first later term whose "shadows" flag differs:
# the two points bracket the crossing (Manifold: k < 2 && (k == 0 || ...)).
def pick2(cs: List<&2, Ct>) -> Pk:
  match cs:
    case Nil{}:
      PkNone{}
    case Ct{_, sh, a, b} <> t:
      pick2.find(Bool.not(sh), a, b, t)
    case CtBad{} <> t:
      PkNone{}

# --- kernel11: edge p1 of P against edge q1 of Q ----------------------------------

# Push a shadow01 term. isP: the vertex belongs to P's edge (the P point is
# the vertex, the Q point is interpolated); otherwise the reverse.
def push_sh(sh: Sh, neg: Bool, +isP: Bool, +p: G.Vec3, rest: List<&2, Ct>) -> List<&2, Ct>:
  match sh:
    case ShNone{}:
      rest
    case Sh{+s, y, z}:
      +q = {G.V3{U.vx(p), y, z} : G.Vec3}
      Ct{U.negate_if(neg, s), U.nonzero(s), U.vpick(isP, p, q), U.vpick(isP, q, p)} <> rest

def k11.z(keep: Bool, +s: U32, v: Q4, rel: Bool, +tz: F32) -> K11:
  Q4{x, y, +za, +zb} = v
  K11{Bool.pick(U32, keep, s, 0), Q4{x, y, za, tie_canon(rel, za, zb, tz)}}

def k11.pick(pk: Pk, +s: U32, +dir: F32, +rel: Bool, +tz: F32) -> K11:
  match pk:
    case PkNone{}:
      K11Bad{}
    case Pk{a0, b0, a1, b1}:
      +v = intersect(a0, a1, b0, b1)
      k11.z(U.shadows_u(q4_za(v), q4_zb(v), dir, rel, tz), s, v, rel, tz)

def k11.hit(hit: Bool, +cs: List<&2, Ct>, +s: U32, +dir: F32, rel: Bool, +tz: F32) -> K11:
  match hit:
    case False{}:
      K11None{}
    case True{}:
      k11.pick(pick2(cs), s, dir, rel, tz)

def k11.fin(bad: Bool, +cs: List<&2, Ct>, +dir: F32, rel: Bool, +tz: F32) -> K11:
  match bad:
    case True{}:
      K11Bad{}
    case False{}:
      +s = ct_sum(cs, 0)
      k11.hit(U.nonzero(s), cs, s, dir, rel, tz)

def kernel11(+eP: Bool, +p1: ERec, +q1: ERec, +tz: F32) -> K11:
  ERec{+ps, +pe, +pn} = p1
  ERec{+qs, +qe, +qn} = q1
  c3 = push_sh(shadow01(eP, False{}, qe, p1, tz), False{}, False{}, vrec_p(qe), Nil{})
  c2 = push_sh(shadow01(eP, False{}, qs, p1, tz), True{}, False{}, vrec_p(qs), c3)
  c1 = push_sh(shadow01(eP, True{}, pe, q1, tz), False{}, True{}, vrec_p(pe), c2)
  +cs = push_sh(shadow01(eP, True{}, ps, q1, tz), True{}, True{}, vrec_p(ps), c1)
  k11.fin(ct_bad(cs), cs, (U.with_sign(eP, U.nz(pn)) - U.nz(qn) : F32), krel(U32.or(vrec_k(ps), vrec_k(pe)), U32.or(vrec_k(qs), vrec_k(qe))), tz)

# --- kernel02: vertex a0 against face b2 --------------------------------------------

def yz_z(v: YZ) -> R.Real:
  YZ{_, z} = v
  z

def q4_x(v: Q4) -> R.Real:
  Q4{x, _, _, _} = v
  x

def q4_y(v: Q4) -> R.Real:
  Q4{_, y, _, _} = v
  y

def push02(sh: Sh, neg: Bool, rest: List<&2, Ct>) -> List<&2, Ct>:
  match sh:
    case ShNone{}:
      rest
    case Sh{+s, y, +z}:
      +v = {G.V3{y, z, z} : G.Vec3}
      Ct{U.negate_if(neg, s), U.nonzero(s), v, v} <> rest

def k02.keep(fwd: Bool, +eP: Bool, +az: R.Real, +z: R.Real, +fnz: F32, rel: Bool, +tz: F32) -> Bool:
  match fwd:
    case True{}:
      U.shadows_u(az, z, F32.neg(fnz), rel, tz)
    case False{}:
      U.shadows_u(z, az, U.with_sign(eP, fnz), rel, tz)

def k02.z(keep: Bool, +s: U32, z: R.Real) -> K02:
  K02{Bool.pick(U32, keep, s, 0), z}

def k02.pick(pk: Pk, +s: U32, fwd: Bool, +eP: Bool, +ap: G.Vec3, +fn: U.N3, +rel: Bool, +tz: F32) -> K02:
  match pk:
    case PkNone{}:
      K02Bad{}
    case Pk{l, _, r, _}:
      +z = yz_z(interpolate(l, r, U.vy(ap)))
      k02.z(k02.keep(fwd, eP, U.vz(ap), z, U.nz(fn), rel, tz), s, tie_canon(rel, U.vz(ap), z, tz))

def k02.hit(hit: Bool, +cs: List<&2, Ct>, +s: U32, fwd: Bool, +eP: Bool, +ap: G.Vec3, +fn: U.N3, rel: Bool, +tz: F32) -> K02:
  match hit:
    case False{}:
      K02None{}
    case True{}:
      k02.pick(pick2(cs), s, fwd, eP, ap, fn, rel, tz)

def k02.fin(bad: Bool, +cs: List<&2, Ct>, fwd: Bool, +eP: Bool, +ap: G.Vec3, +fn: U.N3, rel: Bool, +tz: F32) -> K02:
  match bad:
    case True{}:
      K02Bad{}
    case False{}:
      +s = ct_sum(cs, 0)
      k02.hit(U.nonzero(s), cs, s, fwd, eP, ap, fn, rel, tz)

# fwd: a0 is a vertex of P and b2 a face of Q; otherwise the reverse. The sum
# counts b2 as a projected (xy) polygon around a0; the z test says whether
# a0 lies below it.
def kernel02(+eP: Bool, +fwd: Bool, +a0: VRec, b2: FRec, +tz: F32) -> K02:
  FRec{+fn, e0, e1, e2, +fk} = b2
  FEdge{x0, f0} = e0
  FEdge{x1, f1} = e1
  FEdge{x2, f2} = e2
  c2 = push02(shadow01(eP, fwd, a0, x2, tz), Bool.not(Bool.xor(fwd, f2)), Nil{})
  c1 = push02(shadow01(eP, fwd, a0, x1, tz), Bool.not(Bool.xor(fwd, f1)), c2)
  +cs = push02(shadow01(eP, fwd, a0, x0, tz), Bool.not(Bool.xor(fwd, f0)), c1)
  k02.fin(ct_bad(cs), cs, fwd, eP, vrec_p(a0), fn, krel(vrec_k(a0), fk), tz)

# --- kernel12: edge a1 against face b2 ------------------------------------------------

def push12v(k: K02, neg: Bool, +p: G.Vec3, rest: List<&2, Ct>) -> List<&2, Ct>:
  match k:
    case K02None{}:
      rest
    case K02Bad{}:
      CtBad{} <> rest
    case K02{+s, z}:
      a = {G.V3{U.vx(p), U.vz(p), U.vy(p)} : G.Vec3}
      b = {G.V3{U.vx(p), z, U.vy(p)} : G.Vec3}
      Ct{U.negate_if(neg, s), U.nonzero(s), a, b} <> rest

def push12e.ab(+fwd: Bool, +q: Q4, +s: U32, neg: Bool) -> Ct:
  +za = {G.V3{q4_x(q), q4_za(q), q4_y(q)} : G.Vec3}
  +zb = {G.V3{q4_x(q), q4_zb(q), q4_y(q)} : G.Vec3}
  Ct{U.negate_if(neg, s), U.nonzero(s), U.vpick(fwd, za, zb), U.vpick(fwd, zb, za)}

def push12e(k: K11, neg: Bool, fwd: Bool, rest: List<&2, Ct>) -> List<&2, Ct>:
  match k:
    case K11None{}:
      rest
    case K11Bad{}:
      CtBad{} <> rest
    case K11{s, q}:
      push12e.ab(fwd, q, s, neg) <> rest

def k11_of(fwd: Bool, +eP: Bool, a1: ERec, b1: ERec, +tz: F32) -> K11:
  match fwd:
    case True{}:
      kernel11(eP, a1, b1, tz)
    case False{}:
      kernel11(eP, b1, a1, tz)

def k12.pick(pk: Pk, +x: U32) -> K12:
  match pk:
    case PkNone{}:
      K12Bad{}
    case Pk{a0, b0, a1, b1}:
      +q = intersect(a0, a1, b0, b1)
      K12{x, U.vsnap({G.V3{q4_x(q), q4_za(q), q4_y(q)} : G.Vec3})}

def k12.hit(hit: Bool, +cs: List<&2, Ct>, +x: U32) -> K12:
  match hit:
    case False{}:
      K12None{}
    case True{}:
      k12.pick(pick2(cs), x)

def k12.fin(bad: Bool, +cs: List<&2, Ct>) -> K12:
  match bad:
    case True{}:
      K12Bad{}
    case False{}:
      +x = ct_sum(cs, 0)
      k12.hit(U.nonzero(x), cs, x)

# fwd: a1 is an edge of P and b2 a face of Q (x12); otherwise an edge of Q
# against a face of P (x21). K12None when they do not cross.
def kernel12(+eP: Bool, +fwd: Bool, +a1: ERec, +b2: FRec, +tz: F32) -> K12:
  ERec{+as, +ae, _} = a1
  FRec{_, e0, e1, e2, _} = b2
  FEdge{+x0, +f0} = e0
  FEdge{+x1, +f1} = e1
  FEdge{+x2, +f2} = e2
  c4 = push12e(k11_of(fwd, eP, a1, x2, tz), f2, fwd, Nil{})
  c3 = push12e(k11_of(fwd, eP, a1, x1, tz), f1, fwd, c4)
  c2 = push12e(k11_of(fwd, eP, a1, x0, tz), f0, fwd, c3)
  c1 = push12v(kernel02(eP, fwd, ae, b2, tz), fwd, vrec_p(ae), c2)
  +cs = push12v(kernel02(eP, fwd, as, b2, tz), Bool.not(fwd), vrec_p(as), c1)
  k12.fin(ct_bad(cs), cs)
