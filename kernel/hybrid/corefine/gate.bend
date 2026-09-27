import Base
import ../../real.bend as R
import ../../precise.bend as G
import ../../robust-predicates.bend as RP
import ../mesh.bend as M
import ./util.bend as U
import ./prep.bend as P
import ./inter.bend as I
import ./earclip.bend as E

# corefine: the output gate (docs/hybrid-boolean-plan.md, section 8, step 1).
#
# The Boolean's result is closed and every directed edge is paired by
# construction, but two properties are not: vertex links and freedom from
# self-intersection. Decisions on constructed values closer than about 1e-13
# relative are consistent but may differ from exact arithmetic, and point
# contacts (two solids touching in one vertex) pass the edge pairing. Both
# used to come back as `ok` with an invalid mesh. The gate refuses them with
# a named reason instead:
#
#   - vertex links: the triangles around every vertex must form one fan, i.e.
#     the link edges x -> y of the corners (v, x, y) are one cycle; otherwise
#     "non-manifold contact (point)";
#   - no degenerate triangle (exactly collinear corners); otherwise
#     "result has a degenerate triangle";
#   - no self-intersection between triangles with different tags (cut from
#     different input faces), decided exactly with the closed test of the
#     harness validator (scripts/bakeoff/validate.mjs, pairIntersects;
#     touching counts): triangles sharing no vertex must not meet, triangles
#     sharing one vertex may meet only in it, triangles sharing an edge only
#     in it (no coplanar fold); otherwise
#     "result self-intersects (below 2^-36*scale)".
#
# What is not tested: two triangles with the same tag. They are cut from one
# input face (one analytic carrier, recover's patch), whose input triangles
# met only in shared edges and vertices, and every output triangle lies in
# one of them. This is the rule of recover's clear.bend (the plan asks to
# reuse its join); it skips most of the pairs (a sphere against itself), and
# all the verifier cases the judge found cross two tags.
#
# Candidate pairs come from a bounding-volume self-join over Morton-sorted
# triangles (the structure of kernel/hybrid/recover/clear.bend, rebuilt here
# on corefine's own boxes and Morton code; the two merge when the hybrid is
# promoted, plan step 5), run as one flat fork tree of tasks. Every decision
# is exact on the Real (F32x2) positions of the result, in three tiers:
#
#   1. F32 on local differences of the Real words (fl(fl(xh - ah) +
#      fl(xl - al)), error 3 * 2^-24 of itself plus 8 * 2^-48 M): plane
#      sides, projected orientations and separating axes with certified
#      bounds (see bound3, o2f, sep_axis, wsep); a certified answer is the
#      exact sign. Axis-aligned triangles (all corners share a coordinate word)
#      carry their plane exactly: sides against them are exact comparisons,
#      zeros included, and their projection and edge lines are precomputed;
#   2. structure: a triangle strictly on one side of the other's plane is
#      apart; one on a closed side with exact zeros meets the other only in
#      the hull of its zero corners (a point, a segment or itself), tested in
#      the other's projection; separating edge lines, disjoint vertex cones,
#      9 edge x edge axes, 10 planes through a shared vertex;
#   3. the validator's test itself: orient3d / orient2d as a Real filter, then
#      big integers of the F32 words scaled to their smallest exponent
#      (robust-predicates.bend arithmetic); an exactly zero coordinate
#      difference gives a zero product without either.
#
# The gate only reads the result; it never moves a vertex or changes a
# triangle, so an accepted result is byte-identical to the ungated one.

type GateR is Data:
  GOk{}
  GBad{reason: String}

def none() -> U32:
  4294967295

def mone() -> U32:
  4294967295

# --- vertex links -------------------------------------------------------------------
# Corner (v, x, y) of triangle (v, x, y): the link of v contains the edge
# x -> y. Walking x0 -> y0 -> ... through the corners of v must return to x0
# after exactly deg(v) steps.

type Cn is Data:
  Cn{v: U32, x: U32, y: U32}

def succ(g: List<&2, Cn>, +x: U32, +acc: U32) -> U32:
  match g:
    case Nil{}:
      acc
    case Cn{_, +cx, +cy} <> t:
      succ(t, x, Bool.pick(U32, U32.is_eq(cx, x), cy, acc))

# Steps until the walk returns to x0 (fuel: the degree; mone() on failure).
def walk(fuel: Nat, done: Bool, +g: List<&2, Cn>, +x0: U32, +cur: U32, +steps: U32) -> U32:
  match fuel done:
    case _ True{}:
      steps
    case 0n False{}:
      mone()
    case 1n+p False{}:
      +nx = succ(g, cur, none())
      walk(p, U32.is_eq(nx, x0), g, x0, nx, (steps + 1 : U32))

def fan.k(h: List<&2, Cn>, +g: List<&2, Cn>) -> U32:
  match h:
    case Nil{}:
      0
    case Cn{_, +x0, +y0} <> _:
      +n = U.len(Cn, g)
      U.b2u(U32.is_ne(walk(U32.to_nat(n), U32.is_eq(y0, x0), g, x0, y0, 1), n))

# 1 when the run of one vertex is not a single cycle.
def fan_bad(+g: List<&2, Cn>) -> U32:
  fan.k(g, g)

def lpush.k(r: Array<List<&2, Cn>> & List<&2, Cn>, +i: U32, c: Cn) -> Array<List<&2, Cn>>:
  (a, l) = r
  Array.set(List<&2, Cn>, a, i, c <> l)

def lpush(a: Array<List<&2, Cn>>, +i: U32, c: Cn) -> Array<List<&2, Cn>>:
  lpush.k(Array.get(List<&2, Cn>, a, i), i, c)

def lfill(ts: List<&2, M.Tri>, a: Array<List<&2, Cn>>) -> Array<List<&2, Cn>>:
  match ts:
    case Nil{}:
      a
    case M.Tri{+x, +y, +z, _} <> rest:
      lfill(rest, lpush(lpush(lpush(a, x, Cn{x, y, z}), y, Cn{y, z, x}), z, Cn{z, x, y}))

def fans.s(a: Array<List<&2, Cn>>) -> U32:
  match a:
    case ALeaf{xs}:
      fan_bad(xs)
    case ANode{l, r}:
      (fans.s(l) + fans.s(r) : U32)

def fans(+par: Nat, a: Array<List<&2, Cn>>) -> U32:
  match par:
    case 0n:
      fans.s(a)
    case 1n+p:
      match a:
        case ALeaf{xs}:
          fan_bad(xs)
        case ANode{l, r}:
          x y = fans(p, l) fans(p, r)
          (x + y : U32)

# Number of vertices whose triangles form more than one fan.
def bad_links(ts: List<&2, M.Tri>, +nv: U32) -> U32:
  +empty = {Nil{} : List<&2, Cn>}
  fans(6n, lfill(ts, Array.new(List<&2, Cn>, U.depth(nv), empty)))

# --- signs and orientations -------------------------------------------------------------
# Signs are U32 words: 1, 0, mone() (two's complement -1); 2 = not certified.

def is_pos(+s: U32) -> Bool:
  U32.is_eq(s, 1)

def is_neg(+s: U32) -> Bool:
  U32.is_eq(s, mone())

def ge0(+s: U32) -> Bool:
  Bool.or(U32.is_eq(s, 1), U32.is_eq(s, 0))

def le0(+s: U32) -> Bool:
  Bool.or(U32.is_eq(s, mone()), U32.is_eq(s, 0))

# All three strictly on one side (certified signs only).
def sep3(+a: U32, +b: U32, +c: U32) -> Bool:
  Bool.or(Bool.and(is_pos(a), Bool.and(is_pos(b), is_pos(c))), Bool.and(is_neg(a), Bool.and(is_neg(b), is_neg(c))))

def sep2(+a: U32, +b: U32) -> Bool:
  Bool.or(Bool.and(is_pos(a), is_pos(b)), Bool.and(is_neg(a), is_neg(b)))

def same3(+a: U32, +b: U32, +c: U32) -> Bool:
  Bool.or(Bool.and(ge0(a), Bool.and(ge0(b), ge0(c))), Bool.and(le0(a), Bool.and(le0(b), le0(c))))

def fmax3(v: G.Vec3) -> F32:
  G.V3{x, y, z} = v
  F32.max(F32.abs(R.approx(x)), F32.max(F32.abs(R.approx(y)), F32.abs(R.approx(z))))

# 2^-32, the Real filter of o3: each Real operation errs by at most about
# 2^-46 of its operands, so the determinant errs by less than
# 2^-38 m e (r + e) (m the largest coordinate, e the largest edge component,
# r the largest component of the tested offset); 64x margin.
def kfilter() -> F32:
  0.00000000023283064365

# --- exact signs from big integers ---------------------------------------------------------
# A Real is hi + lo, two F32 words, each an integer times a power of two. All
# words of one predicate are scaled by the same power of two (the smallest
# exponent among them), so the integers stay a few base-4096 digits long
# (robust-predicates.bend scales every word to 2^-149, about 13 digits).

def wexp(+w: F32) -> U32:
  Bool.pick(U32, F32.is_eq(w, 0.0), 255, U32.max(RP.exponent(w), 1))

def rexp(r: R.Real) -> U32:
  R.Real{+h, +l} = r
  U32.min(wexp(h), wexp(l))

def vexp(v: G.Vec3) -> U32:
  G.V3{x, y, z} = v
  U32.min(rexp(x), U32.min(rexp(y), rexp(z)))

def bword.k(zero: Bool, +w: F32, +emin: U32) -> RP.Big:
  match zero:
    case True{}:
      RP.zero()
    case False{}:
      +bits = F32.bits(w)
      +e = RP.exponent(w)
      +mant = U32.or(U32.and(bits, 8388607), Bool.pick(U32, U32.is_eq(e, 0), 0, 8388608))
      RP.make(U32.is_ne(U32.and(bits, 2147483648), 0), RP.shift(RP.digit(U32.and(mant, 4095), RP.digit(U32.shrn(mant, 12n), Nil{})), (U32.max(e, 1) - emin : U32)))

# w times one common power of two (emin <= the exponent of every nonzero word).
def bword(+w: F32, +emin: U32) -> RP.Big:
  bword.k(F32.is_eq(w, 0.0), w, emin)

def breal(r: R.Real, +emin: U32) -> RP.Big:
  R.Real{h, l} = r
  RP.add(bword(h, emin), bword(l, emin))

# Exact sign of ((b - a) x (c - a)) . (d - a).
def big_det.k(+em: U32, a: G.Vec3, b: G.Vec3, c: G.Vec3, d: G.Vec3) -> U32:
  G.V3{ax, ay, az} = a
  G.V3{bx, by, bz} = b
  G.V3{cx, cy, cz} = c
  G.V3{dx, dy, dz} = d
  +xa = breal(ax, em)
  +ya = breal(ay, em)
  +za = breal(az, em)
  +ux = RP.sub(breal(bx, em), xa)
  +uy = RP.sub(breal(by, em), ya)
  +uz = RP.sub(breal(bz, em), za)
  +wx = RP.sub(breal(cx, em), xa)
  +wy = RP.sub(breal(cy, em), ya)
  +wz = RP.sub(breal(cz, em), za)
  +rx = RP.sub(breal(dx, em), xa)
  +ry = RP.sub(breal(dy, em), ya)
  +rz = RP.sub(breal(dz, em), za)
  +nx = RP.sub(RP.mul(uy, wz), RP.mul(uz, wy))
  +ny = RP.sub(RP.mul(uz, wx), RP.mul(ux, wz))
  +nz = RP.sub(RP.mul(ux, wy), RP.mul(uy, wx))
  E.sign_of(RP.sign(RP.add(RP.add(RP.mul(nx, rx), RP.mul(ny, ry)), RP.mul(nz, rz))))

def big_det(+a: G.Vec3, +b: G.Vec3, +c: G.Vec3, +d: G.Vec3) -> U32:
  big_det.k(U32.min(U32.min(vexp(a), vexp(b)), U32.min(vexp(c), vexp(d))), a, b, c, d)

# Exact sign of (b - a) x (c - a) in the plane.
def big_o2(+a: E.V2, +b: E.V2, +c: E.V2) -> U32:
  +ax = E.v2x(a)
  +ay = E.v2y(a)
  +bx = E.v2x(b)
  +by = E.v2y(b)
  +cx = E.v2x(c)
  +cy = E.v2y(c)
  +em = U32.min(U32.min(U32.min(rexp(ax), rexp(ay)), U32.min(rexp(bx), rexp(by))), U32.min(rexp(cx), rexp(cy)))
  +pax = breal(ax, em)
  +pay = breal(ay, em)
  E.sign_of(RP.sign(RP.sub(RP.mul(RP.sub(breal(bx, em), pax), RP.sub(breal(cy, em), pay)), RP.mul(RP.sub(breal(by, em), pay), RP.sub(breal(cx, em), pax)))))

def o2v.pick(sure: Bool, +d: F32, +a: E.V2, +b: E.V2, +c: E.V2) -> U32:
  match sure:
    case True{}:
      Bool.pick(U32, (d > 0.0 : F32), 1, mone())
    case False{}:
      big_o2(a, b, c)

# Exact orientation of three projected points: the Real value (its error is
# below 2^-42 (m D + D^2), m the largest coordinate, D the largest
# difference) beyond 2^-36 (m D + D^2), else big integers.
def or2v(+a: E.V2, +b: E.V2, +c: E.V2) -> U32:
  +du1 = R.sub(E.v2x(b), E.v2x(a))
  +dw1 = R.sub(E.v2y(b), E.v2y(a))
  +du2 = R.sub(E.v2x(c), E.v2x(a))
  +dw2 = R.sub(E.v2y(c), E.v2y(a))
  +d = R.approx(R.sub(R.mul(du1, dw2), R.mul(dw1, du2)))
  +mm = F32.max(F32.max(F32.max(F32.abs(E.v2fx(a)), F32.abs(E.v2fy(a))), F32.max(F32.abs(E.v2fx(b)), F32.abs(E.v2fy(b)))), F32.max(F32.abs(E.v2fx(c)), F32.abs(E.v2fy(c))))
  +dd = (F32.max(F32.max(F32.abs(R.approx(du1)), F32.abs(R.approx(dw1))), F32.max(F32.abs(R.approx(du2)), F32.abs(R.approx(dw2)))) + (mm * 0.0000000000009094947017729282 : F32) : F32)
  +thr = (0.000000000014551915228366852 * ((mm * dd : F32) + (dd * dd : F32)) : F32)
  o2v.pick(Bool.and((thr > 0.000000000000000000000000000001 : F32), (F32.abs(d) > thr : F32)), d, a, b, c)

def o3.pick(sure: Bool, +d: F32, +a: G.Vec3, +b: G.Vec3, +c: G.Vec3, +x: G.Vec3) -> U32:
  match sure:
    case True{}:
      Bool.pick(U32, (d > 0.0 : F32), 1, mone())
    case False{}:
      big_det(a, b, c, x)

# Exact sign of ((b - a) x (c - a)) . (x - a) (the negated orient3d(a, b, c, x)
# of the validator; every test below only compares signs, so the global sign
# is irrelevant).
def o3(+a: G.Vec3, +b: G.Vec3, +c: G.Vec3, +x: G.Vec3) -> U32:
  +u = G.sub(b, a)
  +w = G.sub(c, a)
  +r = G.sub(x, a)
  +d = R.approx(G.dot(G.cross(u, w), r))
  +mm = F32.max(F32.max(fmax3(a), fmax3(b)), F32.max(fmax3(c), fmax3(x)))
  +lo = (mm * 0.0000000000009094947017729282 : F32)
  +e = (F32.max(fmax3(u), fmax3(w)) + lo : F32)
  +thr = (kfilter() * mm * e * ((fmax3(r) + lo : F32) + e) : F32)
  o3.pick(Bool.and((thr > 0.000000000000000000000000000001 : F32), (F32.abs(d) > thr : F32)), d, a, b, c, x)

# --- triangles ---------------------------------------------------------------------------
# Every test first runs in F32 (a certified bound, so a certified answer is
# exact), and only an uncertain one goes on to Reals and big integers: Reals
# are heap pairs, F32 words are inline, and the join tests about ten times
# more pairs than there are triangles. Differences are taken from the two F32
# words of the Reals, fl(fl(xh - ah) + fl(xl - al)), so they err by less than
# 3 * 2^-24 of themselves plus 8 * 2^-48 M (M the largest coordinate): the
# bounds scale with the local size, not with the distance to the origin.

type F3 is Data:
  F3{x: F32, y: F32, z: F32}

def f3.sub(a: F3, b: F3) -> F3:
  F3{ax, ay, az} = a
  F3{bx, by, bz} = b
  F3{(ax - bx : F32), (ay - by : F32), (az - bz : F32)}

def f3.dot(a: F3, b: F3) -> F32:
  F3{ax, ay, az} = a
  F3{bx, by, bz} = b
  (((ax * bx : F32) + (ay * by : F32) : F32) + (az * bz : F32) : F32)

def f3.cross(a: F3, b: F3) -> F3:
  F3{+ax, +ay, +az} = a
  F3{+bx, +by, +bz} = b
  F3{((ay * bz : F32) - (az * by : F32) : F32), ((az * bx : F32) - (ax * bz : F32) : F32), ((ax * by : F32) - (ay * bx : F32) : F32)}

def f3.max(a: F3) -> F32:
  F3{x, y, z} = a
  F32.max(F32.abs(x), F32.max(F32.abs(y), F32.abs(z)))

def rhi(r: R.Real) -> F32:
  R.Real{h, _} = r
  h

def rlo(r: R.Real) -> F32:
  R.Real{_, l} = r
  l

# A corner, flat: the hi and lo words of its coordinates (inline, so reading
# them costs no reference counting), the largest |hi|, and its Real position
# (for the exact paths only).
type Pt is Data:
  Pt{xh: F32, yh: F32, zh: F32, xl: F32, yl: F32, zl: F32, m: F32, r: G.Vec3}

def pt.mk(+xh: F32, +yh: F32, +zh: F32, +xl: F32, +yl: F32, +zl: F32, v: G.Vec3) -> Pt:
  Pt{xh, yh, zh, xl, yl, zl, F32.max(F32.abs(xh), F32.max(F32.abs(yh), F32.abs(zh))), v}

def pt.of(+v: G.Vec3) -> Pt:
  G.V3{+x, +y, +z} = v
  pt.mk(rhi(x), rhi(y), rhi(z), rlo(x), rlo(y), rlo(z), v)

def pt.m(+p: Pt) -> F32:
  Pt{_, _, _, _, _, _, m, _} = p
  m

def pt.r(+p: Pt) -> G.Vec3:
  Pt{_, _, _, _, _, _, _, r} = p
  r


def ld1(+xh: F32, +xl: F32, +ah: F32, +al: F32) -> F32:
  ((xh - ah : F32) + (xl - al : F32) : F32)

# x - a in F32 from the hi/lo words.
def ldiff(+x: Pt, +a: Pt) -> F3:
  Pt{xh, yh, zh, xl, yl, zl, _, _} = x
  Pt{ah, bh, ch, al, bl, cl, _, _} = a
  F3{ld1(xh, xl, ah, al), ld1(yh, yl, bh, bl), ld1(zh, zl, ch, cl)}

# Coordinate words u (w) of projection k: 0: (x, y), 1: (z, x), 2: (y, z).
def su(+k: U32, +x: F32, +y: F32, +z: F32) -> F32:
  Bool.pick(F32, U32.is_eq(k, 0), x, Bool.pick(F32, U32.is_eq(k, 1), z, y))

def sw(+k: U32, +x: F32, +y: F32, +z: F32) -> F32:
  Bool.pick(F32, U32.is_eq(k, 0), y, Bool.pick(F32, U32.is_eq(k, 1), x, z))

# The projected local difference x - a: (du, dw), and the largest projected
# |hi| of both points.
type D2 is Data:
  D2{du: F32, dw: F32, mm: F32}

def d2(+k: U32, +x: Pt, +a: Pt) -> D2:
  Pt{+xh, +yh, +zh, +xl, +yl, +zl, _, _} = x
  Pt{+ah, +bh, +ch, +al, +bl, +cl, _, _} = a
  +xu = su(k, xh, yh, zh)
  +xw = sw(k, xh, yh, zh)
  +au = su(k, ah, bh, ch)
  +aw = sw(k, ah, bh, ch)
  D2{ld1(xu, su(k, xl, yl, zl), au, su(k, al, bl, cl)), ld1(xw, sw(k, xl, yl, zl), aw, sw(k, al, bl, cl)), F32.max(F32.max(F32.abs(xu), F32.abs(xw)), F32.max(F32.abs(au), F32.abs(aw)))}

# Coordinate c (0: x, 1: y, 2: z) of a Real point.
def coord(+c: U32, v: G.Vec3) -> R.Real:
  G.V3{+x, +y, +z} = v
  Bool.pick(R.Real, U32.is_eq(c, 0), x, Bool.pick(R.Real, U32.is_eq(c, 1), y, z))

def eqc(+c: U32, +a: G.Vec3, +b: G.Vec3, +d: G.Vec3) -> Bool:
  +ac = coord(c, a)
  Bool.and(R.equal(ac, coord(c, b)), R.equal(ac, coord(c, d)))

# The coordinate all three corners share exactly (0, 1, 2), or 3.
def flat_axis(+a: G.Vec3, +b: G.Vec3, +d: G.Vec3) -> U32:
  Bool.pick(U32, eqc(0, a, b, d), 0, Bool.pick(U32, eqc(1, a, b, d), 1, Bool.pick(U32, eqc(2, a, b, d), 2, 3)))

# The projection that drops coordinate c (earclip's axis: z -> 0, y -> 1,
# x -> 2); the orientation there is the sign of the normal component c.
def drop(+c: U32) -> U32:
  (2 - c : U32)

# Edge vectors (u, w) of a flat triangle in its projection drop(ax).
type E2 is Data:
  E2{u0: F32, w0: F32, u1: F32, w1: F32, u2: F32, w2: F32}

# One result triangle: vertex ids, corners, the F32 normal of the local
# differences, the largest coordinate m, the largest edge component e, the
# shared coordinate ax of an axis-aligned triangle (3: none) with the exact
# sign sk of its normal component, and a conservative F32 box.
type Tg is Data:
  Tg{a: U32, b: U32, c: U32, pa: Pt, pb: Pt, pc: Pt, n: F3, m: F32, e: F32, ax: U32, sk: U32, bx: P.Box, ed: E2}

def gt.box(+t: Tg) -> P.Box:
  Tg{_, _, _, _, _, _, _, _, _, _, _, b, _} = t
  b

def gt.ed(+t: Tg) -> E2:
  Tg{_, _, _, _, _, _, _, _, _, _, _, _, ed} = t
  ed

def gt.ax(+t: Tg) -> U32:
  Tg{_, _, _, _, _, _, _, _, _, ax, _, _, _} = t
  ax

def gt.m(+t: Tg) -> F32:
  Tg{_, _, _, _, _, _, _, m, _, _, _, _, _} = t
  m

def gt.n(+t: Tg) -> F3:
  Tg{_, _, _, _, _, _, n, _, _, _, _, _, _} = t
  n

def gt.pa(+t: Tg) -> Pt:
  Tg{_, _, _, p, _, _, _, _, _, _, _, _, _} = t
  p

def gt.pb(+t: Tg) -> Pt:
  Tg{_, _, _, _, p, _, _, _, _, _, _, _, _} = t
  p

def gt.pc(+t: Tg) -> Pt:
  Tg{_, _, _, _, _, p, _, _, _, _, _, _, _} = t
  p

# Corner i (0, 1, 2; taken mod 3).
def gt.at(+t: Tg, +i: U32) -> Pt:
  Tg{_, _, _, +pa, +pb, +pc, _, _, _, _, _, _, _} = t
  +k = U32.mod(i, 3)
  Bool.pick(Pt, U32.is_eq(k, 0), pa, Bool.pick(Pt, U32.is_eq(k, 1), pb, pc))

def fpad(+a: F32) -> F32:
  (F32.abs(a) * 0.000001 + 0.000000000000000000000000000001 : F32)

def box3(+a: Pt, +b: Pt, +c: Pt) -> P.Box:
  Pt{+ax, +ay, +az, _, _, _, _, _} = a
  Pt{+bx, +by, +bz, _, _, _, _, _} = b
  Pt{+cx, +cy, +cz, _, _, _, _, _} = c
  +x0 = F32.min(ax, F32.min(bx, cx))
  +y0 = F32.min(ay, F32.min(by, cy))
  +z0 = F32.min(az, F32.min(bz, cz))
  +x1 = F32.max(ax, F32.max(bx, cx))
  +y1 = F32.max(ay, F32.max(by, cy))
  +z1 = F32.max(az, F32.max(bz, cz))
  P.Box{(x0 - fpad(x0) : F32), (y0 - fpad(y0) : F32), (z0 - fpad(z0) : F32), (x1 + fpad(x1) : F32), (y1 + fpad(y1) : F32), (z1 + fpad(z1) : F32)}
def tiny() -> F32:
  0.000000000000000000000000000001

# 2^-44 M: added to every rounded length in a bound.
def lo44(+m: F32) -> F32:
  (m * 0.00000000000005684341886080802 : F32)

# 2^-14 l1 l2 l3 + 2^-38 M l1 (l2 + l3): beyond the error of an F32 product
# of three local differences (derived: below 78 * 2^-24 l1 l2 l3 +
# 96 * 2^-48 M l1 (l2 + l3)).
def bound3(+mx: F32, +l1: F32, +l2: F32, +l3: F32) -> F32:
  +a = (l1 + lo44(mx) : F32)
  +b = (l2 + lo44(mx) : F32)
  +c = (l3 + lo44(mx) : F32)
  ((0.00006103515625 * a * b * c : F32) + (0.000000000003637978807091713 * mx * a * (b + c : F32) : F32) : F32)

# --- projections ------------------------------------------------------------------------

type PJ is Data:
  PJ{pj: E.Proj, o: U32}

def px(+pj: E.Proj, +v: G.Vec3) -> E.V2:
  E.project(pj, 0, v)

def orient_in(+pj: E.Proj, +a: G.Vec3, +b: G.Vec3, +c: G.Vec3) -> U32:
  or2v(px(pj, a), px(pj, b), px(pj, c))

def pj.k1(nz: Bool, +o: U32, +a: G.Vec3, +b: G.Vec3, +c: G.Vec3) -> PJ:
  match nz:
    case True{}:
      PJ{E.Proj{1, False{}}, o}
    case False{}:
      PJ{E.Proj{2, False{}}, orient_in(E.Proj{2, False{}}, a, b, c)}

def pj.k0(nz: Bool, +o: U32, +a: G.Vec3, +b: G.Vec3, +c: G.Vec3) -> PJ:
  match nz:
    case True{}:
      PJ{E.Proj{0, False{}}, o}
    case False{}:
      +o1 = orient_in(E.Proj{1, False{}}, a, b, c)
      pj.k1(U.nonzero(o1), o1, a, b, c)

def pj.dom(nz: Bool, +pj: E.Proj, +o: U32, +a: G.Vec3, +b: G.Vec3, +c: G.Vec3) -> PJ:
  match nz:
    case True{}:
      PJ{pj, o}
    case False{}:
      +o0 = orient_in(E.Proj{0, False{}}, a, b, c)
      pj.k0(U.nonzero(o0), o0, a, b, c)

def unflip(p: E.Proj) -> E.Proj:
  E.Proj{k, _} = p
  E.Proj{k, False{}}

# An axis-aligned projection in which triangle (a, b, c) keeps a nonzero
# exact orientation o (the one closest to its normal first); o = 0 only for a
# degenerate triangle.
def proj3(+a: G.Vec3, +b: G.Vec3, +c: G.Vec3) -> PJ:
  +pj = unflip(E.proj_of(U.tri_cross(a, b, c)))
  +o = orient_in(pj, a, b, c)
  pj.dom(U.nonzero(o), pj, o, a, b, c)

def times(+s: U32, +o: U32) -> U32:
  (s * o : U32)

# --- F32-filtered orientation in an axis-aligned projection ---------------------------------
# Axis k as in earclip.project without flip: 0: (x, y), 1: (z, x), 2: (y, z).

def pu(+k: U32, v: F3) -> F32:
  F3{+x, +y, +z} = v
  Bool.pick(F32, U32.is_eq(k, 0), x, Bool.pick(F32, U32.is_eq(k, 1), z, y))

def pw(+k: U32, v: F3) -> F32:
  F3{+x, +y, +z} = v
  Bool.pick(F32, U32.is_eq(k, 0), y, Bool.pick(F32, U32.is_eq(k, 1), x, z))

def rsign(+a: R.Real, +b: R.Real) -> U32:
  Bool.pick(U32, R.less(a, b), 1, Bool.pick(U32, R.equal(a, b), 0, mone()))


def o2.zk(p1z: Bool, p2z: Bool, +a: E.V2, +b: E.V2, +c: E.V2) -> U32:
  match p1z p2z:
    case True{} True{}:
      0
    case True{} False{}:
      times(mone(), times(rsign(E.v2y(a), E.v2y(b)), rsign(E.v2x(a), E.v2x(c))))
    case False{} True{}:
      times(rsign(E.v2x(a), E.v2x(b)), rsign(E.v2y(a), E.v2y(c)))
    case False{} False{}:
      Bool.pick(U32, E.same_pos(b, c), 0, or2v(a, b, c))

# Exact orientation when F32 is not enough. d = du1 dw2 - dw1 du2: a product
# with an exactly zero difference (equal coordinate words, frequent for
# axis-aligned edges and collinear split points) is exactly zero, and the
# other product's sign is the product of two exact coordinate comparisons;
# otherwise the Real filter and big integers decide.
def o2.z(+a: E.V2, +b: E.V2, +c: E.V2) -> U32:
  +zu1 = R.equal(E.v2x(b), E.v2x(a))
  +zw1 = R.equal(E.v2y(b), E.v2y(a))
  +zu2 = R.equal(E.v2x(c), E.v2x(a))
  +zw2 = R.equal(E.v2y(c), E.v2y(a))
  o2.zk(Bool.or(zu1, zw2), Bool.or(zw1, zu2), a, b, c)

def o2.pick(sure: Bool, +f: U32, +k: U32, +a: Pt, +b: Pt, +c: Pt) -> U32:
  match sure:
    case True{}:
      f
    case False{}:
      +pj = {E.Proj{k, False{}} : E.Proj}
      o2.z(px(pj, pt.r(a)), px(pj, pt.r(b)), px(pj, pt.r(c)))

def amax4(+a: F32, +b: F32, +c: F32, +d: F32) -> F32:
  F32.max(F32.max(F32.abs(a), F32.abs(b)), F32.max(F32.abs(c), F32.abs(d)))

# Orientation of (a, b, c) in projection k in F32: 1 or mone() when
# certified, else 2 (o2 then decides exactly). The F32
# value of the local differences errs by less than 18 * 2^-24 D^2 +
# 32 * 2^-48 m D (D the largest difference, m the largest coordinate), so
# beyond 2^-14 D^2 + 2^-38 m D it is certified; otherwise o2.z decides.
def o2f.k(p: D2, q: D2) -> U32:
  D2{+du1, +dw1, +m1} = p
  D2{+du2, +dw2, +m2} = q
  +d = ((du1 * dw2 : F32) - (dw1 * du2 : F32) : F32)
  +mm = F32.max(m1, m2)
  +dd = (amax4(du1, dw1, du2, dw2) + lo44(mm) : F32)
  +thr = ((0.00006103515625 * dd * dd : F32) + (0.000000000003637978807091713 * mm * dd : F32) : F32)
  Bool.pick(U32, Bool.and((thr > tiny() : F32), (F32.abs(d) > thr : F32)), Bool.pick(U32, (d > 0.0 : F32), 1, mone()), 2)

def o2f(+k: U32, +a: Pt, +b: Pt, +c: Pt) -> U32:
  o2f.k(d2(k, b, a), d2(k, c, a))
# The exact sign from an F32 answer (2: not certified).
def o2.fin(+f: U32, +k: U32, +a: Pt, +b: Pt, +c: Pt) -> U32:
  o2.pick(U32.is_ne(f, 2), f, k, a, b, c)

def o2(+k: U32, +a: Pt, +b: Pt, +c: Pt) -> U32:
  o2.fin(o2f(k, a, b, c), k, a, b, c)

type PK is Data:
  PK{k: U32, o: U32}

def pk.k1(nz: Bool, +o: U32, +a: Pt, +b: Pt, +c: Pt) -> PK:
  match nz:
    case True{}:
      PK{1, o}
    case False{}:
      PK{2, o2(2, a, b, c)}

def pk.k0(nz: Bool, +o: U32, +a: Pt, +b: Pt, +c: Pt) -> PK:
  match nz:
    case True{}:
      PK{0, o}
    case False{}:
      +o1 = o2(1, a, b, c)
      pk.k1(U.nonzero(o1), o1, a, b, c)

def pk.dom(nz: Bool, +k: U32, +o: U32, +a: Pt, +b: Pt, +c: Pt) -> PK:
  match nz:
    case True{}:
      PK{k, o}
    case False{}:
      +o0 = o2(0, a, b, c)
      pk.k0(U.nonzero(o0), o0, a, b, c)

def axis_of(n: F3) -> U32:
  F3{x, y, z} = n
  +ax = F32.abs(x)
  +ay = F32.abs(y)
  +az = F32.abs(z)
  Bool.pick(U32, Bool.and((az > ax : F32), (az > ay : F32)), 0, Bool.pick(U32, (ay > ax : F32), 1, 2))

# A projection in which (a, b, c) keeps a nonzero exact orientation o (the
# one closest to the normal n first); o = 0 only for a degenerate triangle.
def projk(+n: F3, +a: Pt, +b: Pt, +c: Pt) -> PK:
  +k = axis_of(n)
  +o = o2(k, a, b, c)
  pk.dom(U.nonzero(o), k, o, a, b, c)

def gt.proj.k(flat: Bool, +t: Tg) -> PK:
  match flat:
    case True{}:
      Tg{_, _, _, _, _, _, _, _, _, +ax, +sk, _, _} = t
      PK{drop(ax), sk}
    case False{}:
      projk(gt.n(t), gt.pa(t), gt.pb(t), gt.pc(t))

# A projection in which t keeps a nonzero exact orientation (a flat
# triangle: its own, known exactly).
def gt.proj(+t: Tg) -> PK:
  gt.proj.k(U32.is_ne(gt.ax(t), 3), t)

# t's own projection is k (t flat).
def gt.fast(+t: Tg, +k: U32) -> Bool:
  +ax = gt.ax(t)
  Bool.and(U32.is_ne(ax, 3), U32.is_eq(k, drop(ax)))

def gt.ok.k(fast: Bool, +t: Tg, +k: U32) -> U32:
  match fast:
    case True{}:
      Tg{_, _, _, _, _, _, _, _, _, _, +sk, _, _} = t
      sk
    case False{}:
      o2(k, gt.pa(t), gt.pb(t), gt.pc(t))

# The exact orientation of t in projection k.
def gt.ok(+t: Tg, +k: U32) -> U32:
  gt.ok.k(gt.fast(t, k), t, k)

# --- triangle construction and the plane-side test -----------------------------------------

def gt.sk(flat: Bool, +ax: U32, +pa: Pt, +pb: Pt, +pc: Pt) -> U32:
  match flat:
    case True{}:
      o2(drop(ax), pa, pb, pc)
    case False{}:
      0

def e2.of(+k: U32, +e0: F3, +e1: F3, +e2: F3) -> E2:
  E2{pu(k, e0), pw(k, e0), pu(k, e1), pw(k, e1), pu(k, e2), pw(k, e2)}

def gt.edges(flat: Bool, +k: U32, +pa: Pt, +pb: Pt, +pc: Pt) -> E2:
  match flat:
    case True{}:
      e2.of(k, ldiff(pb, pa), ldiff(pc, pb), ldiff(pa, pc))
    case False{}:
      E2{0.0, 0.0, 0.0, 0.0, 0.0, 0.0}

def gt.of(+a: U32, +b: U32, +c: U32, +pa: Pt, +pb: Pt, +pc: Pt) -> Tg:
  +u = ldiff(pb, pa)
  +w = ldiff(pc, pa)
  +ax = flat_axis(pt.r(pa), pt.r(pb), pt.r(pc))
  +flat = U32.is_ne(ax, 3)
  Tg{a, b, c, pa, pb, pc, f3.cross(u, w), F32.max(pt.m(pa), F32.max(pt.m(pb), pt.m(pc))), F32.max(f3.max(u), f3.max(w)), ax, gt.sk(flat, ax, pa, pb, pc), box3(pa, pb, pc), gt.edges(flat, drop(ax), pa, pb, pc)}

# F32 side of x against the plane through a with normal n (no allocation).
def side.f(+n: F3, x: Pt, a: Pt, +m: F32, +e: F32) -> U32:
  F3{+nx, +ny, +nz} = n
  Pt{+xh, +yh, +zh, xl, yl, zl, +xm, _} = x
  Pt{ah, bh, ch, al, bl, cl, _, _} = a
  +rx = ld1(xh, xl, ah, al)
  +ry = ld1(yh, yl, bh, bl)
  +rz = ld1(zh, zl, ch, cl)
  +d = (((nx * rx : F32) + (ny * ry : F32) : F32) + (nz * rz : F32) : F32)
  +thr = bound3(F32.max(m, xm), e, e, F32.max(F32.abs(rx), F32.max(F32.abs(ry), F32.abs(rz))))
  Bool.pick(U32, Bool.and((thr > tiny() : F32), (F32.abs(d) > thr : F32)), Bool.pick(U32, (d > 0.0 : F32), 1, mone()), 2)
def side.k(flat: Bool, +pa: Pt, +n: F3, +m: F32, +e: F32, +ax: U32, +sk: U32, +x: Pt) -> U32:
  match flat:
    case True{}:
      times(rsign(coord(ax, pt.r(pa)), coord(ax, pt.r(x))), sk)
    case False{}:
      side.f(n, x, pa, m, e)

# Side of x against the plane of t: 1 or mone() (certified), 0 (exact, only
# known for an axis-aligned t), or 2 (not certified).
def side(+t: Tg, +x: Pt) -> U32:
  Tg{_, _, _, +pa, _, _, +n, +m, +e, +ax, +sk, _, _} = t
  side.k(U32.is_ne(ax, 3), pa, n, m, e, ax, sk, x)

# --- the validator's closed tests (exact) ------------------------------------------------

def rle(+a: R.Real, +b: R.Real) -> Bool:
  Bool.not(R.less(b, a))

def between(+p: R.Real, +a: R.Real, +b: R.Real) -> Bool:
  Bool.and(rle(R.min(a, b), p), rle(p, R.max(a, b)))

def on_seg2(+p: E.V2, +a: E.V2, +b: E.V2) -> Bool:
  Bool.and(between(E.v2x(p), E.v2x(a), E.v2x(b)), between(E.v2y(p), E.v2y(a), E.v2y(b)))

def seg_seg2(+p: E.V2, +q: E.V2, +a: E.V2, +b: E.V2) -> Bool:
  +d1 = or2v(a, b, p)
  +d2 = or2v(a, b, q)
  +d3 = or2v(p, q, a)
  +d4 = or2v(p, q, b)
  +cross = Bool.and(U32.is_eq(times(d1, d2), mone()), U32.is_eq(times(d3, d4), mone()))
  +t1 = Bool.and(U32.is_eq(d1, 0), on_seg2(p, a, b))
  +t2 = Bool.and(U32.is_eq(d2, 0), on_seg2(q, a, b))
  +t3 = Bool.and(U32.is_eq(d3, 0), on_seg2(a, p, q))
  +t4 = Bool.and(U32.is_eq(d4, 0), on_seg2(b, p, q))
  Bool.or(Bool.or(cross, t1), Bool.or(Bool.or(t2, t3), t4))

def in_tri2(+p: E.V2, +a: E.V2, +b: E.V2, +c: E.V2) -> Bool:
  same3(or2v(a, b, p), or2v(b, c, p), or2v(c, a, p))

def seg_tri2(+p: E.V2, +q: E.V2, +a: E.V2, +b: E.V2, +c: E.V2) -> Bool:
  Bool.or(Bool.or(in_tri2(p, a, b, c), in_tri2(q, a, b, c)), Bool.or(seg_seg2(p, q, a, b), Bool.or(seg_seg2(p, q, b, c), seg_seg2(p, q, c, a))))

def tri_tri2(+p0: E.V2, +p1: E.V2, +p2: E.V2, +q0: E.V2, +q1: E.V2, +q2: E.V2) -> Bool:
  +e0 = Bool.or(seg_seg2(p0, p1, q0, q1), Bool.or(seg_seg2(p0, p1, q1, q2), seg_seg2(p0, p1, q2, q0)))
  +e1 = Bool.or(seg_seg2(p1, p2, q0, q1), Bool.or(seg_seg2(p1, p2, q1, q2), seg_seg2(p1, p2, q2, q0)))
  +e2 = Bool.or(seg_seg2(p2, p0, q0, q1), Bool.or(seg_seg2(p2, p0, q1, q2), seg_seg2(p2, p0, q2, q0)))
  Bool.or(Bool.or(e0, e1), Bool.or(e2, Bool.or(in_tri2(p0, q0, q1, q2), in_tri2(q0, p0, p1, p2))))

def seg_tri.cop(k: PJ, +p: G.Vec3, +q: G.Vec3, +a: G.Vec3, +b: G.Vec3, +c: G.Vec3) -> Bool:
  PJ{+pj, +o} = k
  Bool.or(U.is_zero(o), seg_tri2(px(pj, p), px(pj, q), px(pj, a), px(pj, b), px(pj, c)))

def seg_tri.gen(+p: G.Vec3, +q: G.Vec3, +a: G.Vec3, +b: G.Vec3, +c: G.Vec3) -> Bool:
  same3(o3(p, q, a, b), o3(p, q, b, c), o3(p, q, c, a))

def seg_tri.k(both0: Bool, +p: G.Vec3, +q: G.Vec3, +a: G.Vec3, +b: G.Vec3, +c: G.Vec3) -> Bool:
  match both0:
    case True{}:
      seg_tri.cop(proj3(a, b, c), p, q, a, b, c)
    case False{}:
      seg_tri.gen(p, q, a, b, c)

def seg_tri.x(apart: Bool, +op: U32, +oq: U32, +p: G.Vec3, +q: G.Vec3, +a: G.Vec3, +b: G.Vec3, +c: G.Vec3) -> Bool:
  match apart:
    case True{}:
      False{}
    case False{}:
      seg_tri.k(Bool.and(U32.is_eq(op, 0), U32.is_eq(oq, 0)), p, q, a, b, c)

# Closed segment pq against closed triangle abc; op, oq = sides of p, q.
# A degenerate triangle in the coplanar case counts as a contact.
def seg_tri(+p: G.Vec3, +q: G.Vec3, +op: U32, +oq: U32, +a: G.Vec3, +b: G.Vec3, +c: G.Vec3) -> Bool:
  seg_tri.x(U32.is_eq(times(op, oq), 1), op, oq, p, q, a, b, c)

def tri_tri.cop(k: PJ, +p0: G.Vec3, +p1: G.Vec3, +p2: G.Vec3, +q0: G.Vec3, +q1: G.Vec3, +q2: G.Vec3) -> Bool:
  PJ{+pj, +o} = k
  Bool.or(U.is_zero(o), tri_tri2(px(pj, p0), px(pj, p1), px(pj, p2), px(pj, q0), px(pj, q1), px(pj, q2)))

def tri_tri.gen(+p0: G.Vec3, +p1: G.Vec3, +p2: G.Vec3, +q0: G.Vec3, +q1: G.Vec3, +q2: G.Vec3, +s0: U32, +s1: U32, +s2: U32, +t0: U32, +t1: U32, +t2: U32) -> Bool:
  +a = Bool.or(seg_tri(p0, p1, s0, s1, q0, q1, q2), seg_tri(q0, q1, t0, t1, p0, p1, p2))
  +b = Bool.or(seg_tri(p1, p2, s1, s2, q0, q1, q2), seg_tri(q1, q2, t1, t2, p0, p1, p2))
  +c = Bool.or(seg_tri(p2, p0, s2, s0, q0, q1, q2), seg_tri(q2, q0, t2, t0, p0, p1, p2))
  Bool.or(a, Bool.or(b, c))

def tri_tri.k3(cop: Bool, +p0: G.Vec3, +p1: G.Vec3, +p2: G.Vec3, +q0: G.Vec3, +q1: G.Vec3, +q2: G.Vec3, +s0: U32, +s1: U32, +s2: U32, +t0: U32, +t1: U32, +t2: U32) -> Bool:
  match cop:
    case True{}:
      tri_tri.cop(proj3(q0, q1, q2), p0, p1, p2, q0, q1, q2)
    case False{}:
      tri_tri.gen(p0, p1, p2, q0, q1, q2, s0, s1, s2, t0, t1, t2)

def tri_tri.k2(apart: Bool, +p0: G.Vec3, +p1: G.Vec3, +p2: G.Vec3, +q0: G.Vec3, +q1: G.Vec3, +q2: G.Vec3, +s0: U32, +s1: U32, +s2: U32, +t0: U32, +t1: U32, +t2: U32) -> Bool:
  match apart:
    case True{}:
      False{}
    case False{}:
      tri_tri.k3(Bool.and(U32.is_eq(s0, 0), Bool.and(U32.is_eq(s1, 0), U32.is_eq(s2, 0))), p0, p1, p2, q0, q1, q2, s0, s1, s2, t0, t1, t2)

def tri_tri.k1(apart: Bool, +p0: G.Vec3, +p1: G.Vec3, +p2: G.Vec3, +q0: G.Vec3, +q1: G.Vec3, +q2: G.Vec3, +s0: U32, +s1: U32, +s2: U32) -> Bool:
  match apart:
    case True{}:
      False{}
    case False{}:
      +t0 = o3(p0, p1, p2, q0)
      +t1 = o3(p0, p1, p2, q1)
      +t2 = o3(p0, p1, p2, q2)
      tri_tri.k2(sep3(t0, t1, t2), p0, p1, p2, q0, q1, q2, s0, s1, s2, t0, t1, t2)

# Closed triangle/triangle test (validator triTri), exact.
def tri_tri(+p0: G.Vec3, +p1: G.Vec3, +p2: G.Vec3, +q0: G.Vec3, +q1: G.Vec3, +q2: G.Vec3) -> Bool:
  +s0 = o3(q0, q1, q2, p0)
  +s1 = o3(q0, q1, q2, p1)
  +s2 = o3(q0, q1, q2, p2)
  tri_tri.k1(sep3(s0, s1, s2), p0, p1, p2, q0, q1, q2, s0, s1, s2)

# --- pair tests ---------------------------------------------------------------------------

def is_zero(+s: U32) -> Bool:
  U32.is_eq(s, 0)

# No uncertain sign and all on one closed side (touching when not strictly
# separated).
def onesided3(+a: U32, +b: U32, +c: U32) -> Bool:
  Bool.and(Bool.and(U32.is_ne(a, 2), Bool.and(U32.is_ne(b, 2), U32.is_ne(c, 2))), same3(a, b, c))

def onesided2(+a: U32, +b: U32) -> Bool:
  Bool.and(Bool.and(U32.is_ne(a, 2), U32.is_ne(b, 2)), Bool.or(Bool.and(ge0(a), ge0(b)), Bool.and(le0(a), le0(b))))

# Strictly outside the edge line p -> q of a triangle with orientation o.
def outside(+k: U32, +p: Pt, +q: Pt, +o: U32, +x: Pt) -> Bool:
  U32.is_eq(times(o2(k, p, q, x), o), mone())

# --- edge lines of a triangle ------------------------------------------------------------
# A flat triangle carries its edge vectors in its own projection drop(ax)
# (local differences, as in o2), so an edge-line test there costs one local
# difference and two products; the bound is o2's. Any other projection, or an
# uncertain value, goes through o2.

def pr2(+eu: F32, +ew: F32, +m: F32, q: D2) -> U32:
  D2{+du, +dw, +m2} = q
  +d = ((eu * dw : F32) - (ew * du : F32) : F32)
  +mm = F32.max(m, m2)
  +dd = (amax4(eu, ew, du, dw) + lo44(mm) : F32)
  +thr = ((0.00006103515625 * dd * dd : F32) + (0.000000000003637978807091713 * mm * dd : F32) : F32)
  Bool.pick(U32, Bool.and((thr > tiny() : F32), (F32.abs(d) > thr : F32)), Bool.pick(U32, (d > 0.0 : F32), 1, mone()), 2)
def pr1(+eu: F32, +ew: F32, +k: U32, +m: F32, +p: Pt, +x: Pt) -> U32:
  pr2(eu, ew, m, d2(k, x, p))
def eu(+e: E2, +i: U32) -> F32:
  E2{+u0, _, +u1, _, +u2, _} = e
  Bool.pick(F32, U32.is_eq(i, 0), u0, Bool.pick(F32, U32.is_eq(i, 1), u1, u2))

def ew(+e: E2, +i: U32) -> F32:
  E2{_, +w0, _, +w1, _, +w2} = e
  Bool.pick(F32, U32.is_eq(i, 0), w0, Bool.pick(F32, U32.is_eq(i, 1), w1, w2))

def yo.s(unsure: Bool, +sg: U32, +y: Tg, +k: U32, +i: U32, +o: U32, +x: Pt) -> Bool:
  match unsure:
    case True{}:
      outside(k, gt.at(y, i), gt.at(y, (i + 1 : U32)), o, x)
    case False{}:
      U32.is_eq(times(sg, o), mone())

def yo.k(fast: Bool, +y: Tg, +k: U32, +i: U32, +o: U32, +x: Pt) -> Bool:
  match fast:
    case True{}:
      +ed = gt.ed(y)
      +sg = pr1(eu(ed, i), ew(ed, i), k, gt.m(y), gt.at(y, i), x)
      yo.s(U32.is_eq(sg, 2), sg, y, k, i, o, x)
    case False{}:
      outside(k, gt.at(y, i), gt.at(y, (i + 1 : U32)), o, x)

# Strictly outside the edge line from corner i to corner i + 1 of y (y's
# orientation in projection k is o).
def yo(+y: Tg, +k: U32, +i: U32, +o: U32, +x: Pt) -> Bool:
  yo.k(gt.fast(y, k), y, k, i, o, x)

def out3.b(x: Bool, +y: Tg, +k: U32, +i: U32, +o: U32, +b2: Pt) -> Bool:
  match x:
    case True{}:
      yo(y, k, i, o, b2)
    case False{}:
      False{}

def out3.a(x: Bool, +y: Tg, +k: U32, +i: U32, +o: U32, +b1: Pt, +b2: Pt) -> Bool:
  match x:
    case True{}:
      out3.b(yo(y, k, i, o, b1), y, k, i, o, b2)
    case False{}:
      False{}

# Edge i of y separates the three points strictly.
def out3(+y: Tg, +k: U32, +i: U32, +o: U32, +b0: Pt, +b1: Pt, +b2: Pt) -> Bool:
  out3.a(yo(y, k, i, o, b0), y, k, i, o, b1, b2)

def sat.c(x: Bool, +y: Tg, +k: U32, +o: U32, +b0: Pt, +b1: Pt, +b2: Pt) -> Bool:
  match x:
    case True{}:
      True{}
    case False{}:
      out3(y, k, 2, o, b0, b1, b2)

def sat.b(x: Bool, +y: Tg, +k: U32, +o: U32, +b0: Pt, +b1: Pt, +b2: Pt) -> Bool:
  match x:
    case True{}:
      True{}
    case False{}:
      sat.c(out3(y, k, 1, o, b0, b1, b2), y, k, o, b0, b1, b2)

def sat.a(ok: Bool, +y: Tg, +k: U32, +o: U32, +b0: Pt, +b1: Pt, +b2: Pt) -> Bool:
  match ok:
    case True{}:
      sat.b(out3(y, k, 0, o, b0, b1, b2), y, k, o, b0, b1, b2)
    case False{}:
      False{}

# An edge line of y (orientation o != 0 in projection k) separates the points.
def sat(+y: Tg, +k: U32, +o: U32, +b0: Pt, +b1: Pt, +b2: Pt) -> Bool:
  sat.a(U.nonzero(o), y, k, o, b0, b1, b2)

def exact0(+t: Tg, +s: Tg) -> Bool:
  tri_tri(pt.r(gt.pa(t)), pt.r(gt.pb(t)), pt.r(gt.pc(t)), pt.r(gt.pa(s)), pt.r(gt.pb(s)), pt.r(gt.pc(s)))

def exact0.if(apart: Bool, +t: Tg, +s: Tg) -> Bool:
  match apart:
    case True{}:
      False{}
    case False{}:
      exact0(t, s)

# Separating axes in space: the 9 cross products of an edge of t and an edge
# of s, in F32 on local differences from t's first corner. A projected value
# errs by less than 132 * 2^-24 R^2 (E + F) + 192 * 2^-48 M R (E + F) (R the
# largest local coordinate, E, F the edge lengths per component, each plus
# 2^-20 R + 2^-44 M), so a gap beyond twice that is certified.
def sep_axis(+ax: F3, +ef: F32, +rm: F32, +mx: F32, +a1: F3, +a2: F3, +b0: F3, +b1: F3, +b2: F3) -> Bool:
  +p1 = f3.dot(ax, a1)
  +p2 = f3.dot(ax, a2)
  +q0 = f3.dot(ax, b0)
  +q1 = f3.dot(ax, b1)
  +q2 = f3.dot(ax, b2)
  +tlo = F32.min(0.0, F32.min(p1, p2))
  +thi = F32.max(0.0, F32.max(p1, p2))
  +slo = F32.min(q0, F32.min(q1, q2))
  +shi = F32.max(q0, F32.max(q1, q2))
  +thr = ((0.000244140625 * rm * rm * ef : F32) + (0.000000000014551915228366852 * mx * rm * ef : F32) : F32)
  Bool.or(((thi + thr : F32) < slo : F32), ((shi + thr : F32) < tlo : F32))

def elen(+e: F3, +pad: F32) -> F32:
  (f3.max(e) + pad : F32)

def sat3.k(+rm: F32, +mx: F32, +a1: F3, +a2: F3, +b0: F3, +b1: F3, +b2: F3) -> Bool:
  +pad = ((rm * 0.00000095367431640625 : F32) + lo44(mx) : F32)
  +ta = a1
  +tb = f3.sub(a2, a1)
  +tc = a2
  +sa = f3.sub(b1, b0)
  +sb = f3.sub(b2, b1)
  +sc = f3.sub(b2, b0)
  +la = elen(ta, pad)
  +lb = elen(tb, pad)
  +lc = elen(tc, pad)
  +ma = elen(sa, pad)
  +mb = elen(sb, pad)
  +mc = elen(sc, pad)
  +x1 = Bool.or(sep_axis(f3.cross(ta, sa), (la + ma : F32), rm, mx, a1, a2, b0, b1, b2), Bool.or(sep_axis(f3.cross(ta, sb), (la + mb : F32), rm, mx, a1, a2, b0, b1, b2), sep_axis(f3.cross(ta, sc), (la + mc : F32), rm, mx, a1, a2, b0, b1, b2)))
  +x2 = Bool.or(sep_axis(f3.cross(tb, sa), (lb + ma : F32), rm, mx, a1, a2, b0, b1, b2), Bool.or(sep_axis(f3.cross(tb, sb), (lb + mb : F32), rm, mx, a1, a2, b0, b1, b2), sep_axis(f3.cross(tb, sc), (lb + mc : F32), rm, mx, a1, a2, b0, b1, b2)))
  +x3 = Bool.or(sep_axis(f3.cross(tc, sa), (lc + ma : F32), rm, mx, a1, a2, b0, b1, b2), Bool.or(sep_axis(f3.cross(tc, sb), (lc + mb : F32), rm, mx, a1, a2, b0, b1, b2), sep_axis(f3.cross(tc, sc), (lc + mc : F32), rm, mx, a1, a2, b0, b1, b2)))
  Bool.or(x1, Bool.or(x2, x3))

# t and s (sharing no vertex) are certainly disjoint by an edge x edge axis.
def sat3(+t: Tg, +s: Tg) -> Bool:
  +o = gt.pa(t)
  +a1 = ldiff(gt.pb(t), o)
  +a2 = ldiff(gt.pc(t), o)
  +b0 = ldiff(gt.pa(s), o)
  +b1 = ldiff(gt.pb(s), o)
  +b2 = ldiff(gt.pc(s), o)
  +mx = F32.max(gt.m(t), gt.m(s))
  +rm = (F32.max(F32.max(f3.max(a1), f3.max(a2)), F32.max(f3.max(b0), F32.max(f3.max(b1), f3.max(b2)))) + lo44(mx) : F32)
  sat3.k(rm, mx, a1, a2, b0, b1, b2)

def sat3.if(apart: Bool, +t: Tg, +s: Tg) -> Bool:
  match apart:
    case True{}:
      False{}
    case False{}:
      exact0.if(sat3(t, s), t, s)

# No shared vertex, general position: separating edge lines in t's
# projection, else the exact test.
def hit0.q(x: Bool, +k: U32, +t: Tg, +s: Tg) -> Bool:
  match x:
    case True{}:
      False{}
    case False{}:
      sat3.if(sat(s, k, gt.ok(s, k), gt.pa(t), gt.pb(t), gt.pc(t)), t, s)

def hit0.g(pk: PK, +t: Tg, +s: Tg) -> Bool:
  PK{+k, +oa} = pk
  hit0.q(sat(t, k, oa, gt.pa(s), gt.pb(s), gt.pc(s)), k, t, s)

# x lies on one closed side of the plane of y with the corners of zero sign
# exactly on it, so x meets y only in the hull of those corners, a set in
# the plane of y: a point, a segment or all of x, tested in y's projection
# (injective on that plane). The line through a segment is a separating axis
# too.
def line_sep(+k: U32, +z1: Pt, +z2: Pt, +y0: Pt, +y1: Pt, +y2: Pt) -> Bool:
  sep3(o2(k, z1, z2, y0), o2(k, z1, z2, y1), o2(k, z1, z2, y2))

def pt_apart.b(x: Bool, +k: U32, +o: U32, +z: Pt, +y: Tg) -> Bool:
  match x:
    case True{}:
      True{}
    case False{}:
      yo(y, k, 2, o, z)

def pt_apart.a(x: Bool, +k: U32, +o: U32, +z: Pt, +y: Tg) -> Bool:
  match x:
    case True{}:
      True{}
    case False{}:
      pt_apart.b(yo(y, k, 1, o, z), k, o, z, y)

def pt_apart(+k: U32, +o: U32, +z: Pt, +y: Tg) -> Bool:
  pt_apart.a(yo(y, k, 0, o, z), k, o, z, y)

# Both points strictly outside edge i of y.
def out2.a(x: Bool, +y: Tg, +k: U32, +i: U32, +o: U32, +z2: Pt) -> Bool:
  match x:
    case True{}:
      yo(y, k, i, o, z2)
    case False{}:
      False{}

def out2(+y: Tg, +k: U32, +i: U32, +o: U32, +z1: Pt, +z2: Pt) -> Bool:
  out2.a(yo(y, k, i, o, z1), y, k, i, o, z2)

def seg_apart.c(x: Bool, +k: U32, +o: U32, +z1: Pt, +z2: Pt, +y: Tg) -> Bool:
  match x:
    case True{}:
      True{}
    case False{}:
      line_sep(k, z1, z2, gt.pa(y), gt.pb(y), gt.pc(y))

def seg_apart.b(x: Bool, +k: U32, +o: U32, +z1: Pt, +z2: Pt, +y: Tg) -> Bool:
  match x:
    case True{}:
      True{}
    case False{}:
      seg_apart.c(out2(y, k, 2, o, z1, z2), k, o, z1, z2, y)

def seg_apart.a(x: Bool, +k: U32, +o: U32, +z1: Pt, +z2: Pt, +y: Tg) -> Bool:
  match x:
    case True{}:
      True{}
    case False{}:
      seg_apart.b(out2(y, k, 1, o, z1, z2), k, o, z1, z2, y)

def seg_apart(+k: U32, +o: U32, +z1: Pt, +z2: Pt, +y: Tg) -> Bool:
  seg_apart.a(out2(y, k, 0, o, z1, z2), k, o, z1, z2, y)

def tri_apart.a(sep: Bool, +k: U32, +x: Tg, +y: Tg) -> Bool:
  match sep:
    case True{}:
      True{}
    case False{}:
      sat(x, k, gt.ok(x, k), gt.pa(y), gt.pb(y), gt.pc(y))

def tri_apart(+k: U32, +o: U32, +x: Tg, +y: Tg) -> Bool:
  tri_apart.a(sat(y, k, o, gt.pa(x), gt.pb(x), gt.pc(x)), k, x, y)

# n3 / n2: three / two zero corners of x; i: the nonzero corner (two zeros)
# or the zero corner (one zero).
def touch.n(n3: Bool, n2: Bool, +i: U32, +k: U32, +o: U32, +x: Tg, +y: Tg) -> Bool:
  match n3 n2:
    case True{} _:
      tri_apart(k, o, x, y)
    case False{} True{}:
      seg_apart(k, o, gt.at(x, (i + 1 : U32)), gt.at(x, (i + 2 : U32)), y)
    case False{} False{}:
      pt_apart(k, o, gt.at(x, i), y)

def touch.k(pk: PK, +x: Tg, +y: Tg, +za: U32, +zb: U32, +zc: U32) -> Bool:
  PK{+k, +o} = pk
  +nz = (U.b2u(is_zero(za)) + U.b2u(is_zero(zb)) + U.b2u(is_zero(zc)) : U32)
  +i2 = Bool.pick(U32, Bool.not(is_zero(za)), 0, Bool.pick(U32, Bool.not(is_zero(zb)), 1, 2))
  +i1 = Bool.pick(U32, is_zero(za), 0, Bool.pick(U32, is_zero(zb), 1, 2))
  sat3.if(Bool.and(U.nonzero(o), touch.n(U32.is_eq(nz, 3), U32.is_eq(nz, 2), Bool.pick(U32, U32.is_eq(nz, 2), i2, i1), k, o, x, y)), x, y)

def touch(+x: Tg, +y: Tg, +za: U32, +zb: U32, +zc: U32) -> Bool:
  touch.k(gt.proj(y), x, y, za, zb, zc)

def hit0.c(o1: Bool, o2b: Bool, +t: Tg, +s: Tg, +sa: U32, +sb: U32, +sc: U32, +ta: U32, +tb: U32, +tc: U32) -> Bool:
  match o1 o2b:
    case True{} _:
      touch(t, s, sa, sb, sc)
    case False{} True{}:
      touch(s, t, ta, tb, tc)
    case False{} False{}:
      hit0.g(gt.proj(t), t, s)

def hit0.b(sep: Bool, +t: Tg, +s: Tg, +sa: U32, +sb: U32, +sc: U32, +ta: U32, +tb: U32, +tc: U32) -> Bool:
  match sep:
    case True{}:
      False{}
    case False{}:
      hit0.c(onesided3(sa, sb, sc), onesided3(ta, tb, tc), t, s, sa, sb, sc, ta, tb, tc)

def hit0.a(sep: Bool, +t: Tg, +s: Tg, +sa: U32, +sb: U32, +sc: U32) -> Bool:
  match sep:
    case True{}:
      False{}
    case False{}:
      +ta = side(t, gt.pa(s))
      +tb = side(t, gt.pb(s))
      +tc = side(t, gt.pc(s))
      hit0.b(sep3(ta, tb, tc), t, s, sa, sb, sc, ta, tb, tc)

def hit0.z(+t: Tg, +s: Tg) -> Bool:
  +sa = side(s, gt.pa(t))
  +sb = side(s, gt.pb(t))
  +sc = side(s, gt.pc(t))
  hit0.a(sep3(sa, sb, sc), t, s, sa, sb, sc)

# Both flat on the same axis: the same plane (a 2D test in it), or parallel
# planes (apart).
def hit0.pp(same: Bool, +t: Tg, +s: Tg) -> Bool:
  match same:
    case True{}:
      +k = drop(gt.ax(s))
      sat3.if(tri_apart(k, gt.ok(s, k), t, s), t, s)
    case False{}:
      False{}

def hit0.ff(ff: Bool, +t: Tg, +s: Tg) -> Bool:
  match ff:
    case True{}:
      +c = gt.ax(t)
      hit0.pp(R.equal(coord(c, pt.r(gt.pa(t))), coord(c, pt.r(gt.pa(s)))), t, s)
    case False{}:
      hit0.z(t, s)

# No shared vertex.
def hit0(+t: Tg, +s: Tg) -> Bool:
  +c = gt.ax(t)
  hit0.ff(Bool.and(U32.is_ne(c, 3), U32.is_eq(c, gt.ax(s))), t, s)

# One shared vertex v; t = (v, p1, p2), s = (v, q1, q2) after rotation.
# x lies in the closed cone of (v, a, b) with orientation o.
def cneg(+f: U32, +o: U32) -> Bool:
  Bool.and(U32.is_ne(f, 2), U32.is_eq(times(f, o), mone()))

def in_sector.k(out: Bool, +fa: U32, +fb: U32, +k: U32, +x: Pt, +v: Pt, +a: Pt, +b: Pt, +o: U32) -> Bool:
  match out:
    case True{}:
      False{}
    case False{}:
      Bool.and(ge0(times(o2.fin(fa, k, v, a, x), o)), ge0(times(o2.fin(fb, k, v, x, b), o)))

# x lies in the closed cone of (v, a, b) with orientation o. Both half-plane
# signs are tried in F32 first; a certified negative one decides without the
# exact evaluation of the other (which is often exactly zero: rays through
# the centre of a fan).
def in_sector(+k: U32, +x: Pt, +v: Pt, +a: Pt, +b: Pt, +o: U32) -> Bool:
  +fa = o2f(k, v, a, x)
  +fb = o2f(k, v, x, b)
  in_sector.k(Bool.or(cneg(fa, o), cneg(fb, o)), fa, fb, k, x, v, a, b, o)

def hit1.exact(+t: Tg, +s: Tg, +p1: G.Vec3, +p2: G.Vec3, +q1: G.Vec3, +q2: G.Vec3) -> Bool:
  +sa = pt.r(gt.pa(s))
  +sb = pt.r(gt.pb(s))
  +sc = pt.r(gt.pc(s))
  +ta = pt.r(gt.pa(t))
  +tb = pt.r(gt.pb(t))
  +tc = pt.r(gt.pc(t))
  Bool.or(seg_tri(p1, p2, o3(sa, sb, sc, p1), o3(sa, sb, sc, p2), sa, sb, sc), seg_tri(q1, q2, o3(ta, tb, tc, q1), o3(ta, tb, tc, q2), ta, tb, tc))

def hit1.x(meet: Bool, +t: Tg, +s: Tg, +p1: Pt, +p2: Pt, +q1: Pt, +q2: Pt) -> Bool:
  match meet:
    case True{}:
      hit1.exact(t, s, pt.r(p1), pt.r(p2), pt.r(q1), pt.r(q2))
    case False{}:
      False{}

# The two closed cones at v (convex, below a half turn) meet outside v iff a
# boundary ray of one lies in the other; checked ray by ray, lazily.
def sect.d(x: Bool, +k: U32, +v: Pt, +p1: Pt, +p2: Pt, +q1: Pt, +q2: Pt, +op: U32, +oq: U32) -> Bool:
  match x:
    case True{}:
      True{}
    case False{}:
      in_sector(k, p2, v, q1, q2, oq)

def sect.c(x: Bool, +k: U32, +v: Pt, +p1: Pt, +p2: Pt, +q1: Pt, +q2: Pt, +op: U32, +oq: U32) -> Bool:
  match x:
    case True{}:
      True{}
    case False{}:
      sect.d(in_sector(k, p1, v, q1, q2, oq), k, v, p1, p2, q1, q2, op, oq)

def sect.b(x: Bool, +k: U32, +v: Pt, +p1: Pt, +p2: Pt, +q1: Pt, +q2: Pt, +op: U32, +oq: U32) -> Bool:
  match x:
    case True{}:
      True{}
    case False{}:
      sect.c(in_sector(k, q2, v, p1, p2, op), k, v, p1, p2, q1, q2, op, oq)

# True unless the projected cones are certainly disjoint.
def sect.a(ok: Bool, +k: U32, +v: Pt, +p1: Pt, +p2: Pt, +q1: Pt, +q2: Pt, +op: U32, +oq: U32) -> Bool:
  match ok:
    case True{}:
      sect.b(in_sector(k, q1, v, p1, p2, op), k, v, p1, p2, q1, q2, op, oq)
    case False{}:
      True{}

# Separating planes through the shared vertex v in space, in F32 on local
# differences from v (v itself projects to exactly 0): t = (v, p1, p2) and
# s = (v, q1, q2) meet only in v when some axis puts p1, p2 strictly on one
# side and q1, q2 strictly on the other. Axes: both normals, the 4 products of
# an edge of t and an edge of s, and the 4 in-plane edge normals. A projected
# value errs by less than 72 * 2^-24 R^3 + 144 * 2^-48 M R^2 on a single
# product axis and 216 * 2^-24 R^4 + 384 * 2^-48 M R^3 on a double one (R the
# largest local coordinate plus 2^-44 M).
def wsep(+ax: F3, +thr: F32, +p1: F3, +p2: F3, +q1: F3, +q2: F3) -> Bool:
  +a1 = f3.dot(ax, p1)
  +a2 = f3.dot(ax, p2)
  +b1 = f3.dot(ax, q1)
  +b2 = f3.dot(ax, q2)
  +nt = F32.neg(thr)
  Bool.or(Bool.and(Bool.and((a1 > thr : F32), (a2 > thr : F32)), Bool.and((b1 < nt : F32), (b2 < nt : F32))),
    Bool.and(Bool.and((a1 < nt : F32), (a2 < nt : F32)), Bool.and((b1 > thr : F32), (b2 > thr : F32))))

def wedge.k(+r: F32, +mx: F32, +p1: F3, +p2: F3, +q1: F3, +q2: F3) -> Bool:
  +t1 = ((0.000244140625 * r * r * r : F32) + (0.000000000014551915228366852 * mx * r * r : F32) : F32)
  +t2 = ((0.00048828125 * r * r * r * r : F32) + (0.00000000005820766091346741 * mx * r * r * r : F32) : F32)
  +np = f3.cross(p1, p2)
  +nq = f3.cross(q1, q2)
  +x1 = Bool.or(wsep(np, t1, p1, p2, q1, q2), wsep(nq, t1, p1, p2, q1, q2))
  +x2 = Bool.or(Bool.or(wsep(f3.cross(p1, q1), t1, p1, p2, q1, q2), wsep(f3.cross(p1, q2), t1, p1, p2, q1, q2)), Bool.or(wsep(f3.cross(p2, q1), t1, p1, p2, q1, q2), wsep(f3.cross(p2, q2), t1, p1, p2, q1, q2)))
  +x3 = Bool.or(Bool.or(wsep(f3.cross(np, p1), t2, p1, p2, q1, q2), wsep(f3.cross(np, p2), t2, p1, p2, q1, q2)), Bool.or(wsep(f3.cross(nq, q1), t2, p1, p2, q1, q2), wsep(f3.cross(nq, q2), t2, p1, p2, q1, q2)))
  Bool.or(x1, Bool.or(x2, x3))

def wedge(+t: Tg, +s: Tg, +v: Pt, +p1: Pt, +p2: Pt, +q1: Pt, +q2: Pt) -> Bool:
  +a1 = ldiff(p1, v)
  +a2 = ldiff(p2, v)
  +b1 = ldiff(q1, v)
  +b2 = ldiff(q2, v)
  +mx = F32.max(gt.m(t), gt.m(s))
  wedge.k((F32.max(F32.max(f3.max(a1), f3.max(a2)), F32.max(f3.max(b1), f3.max(b2))) + lo44(mx) : F32), mx, a1, a2, b1, b2)

def wedge.if(meet: Bool, +t: Tg, +s: Tg, +v: Pt, +p1: Pt, +p2: Pt, +q1: Pt, +q2: Pt) -> Bool:
  match meet:
    case True{}:
      hit1.x(Bool.not(wedge(t, s, v, p1, p2, q1, q2)), t, s, p1, p2, q1, q2)
    case False{}:
      False{}

# General position: the cones in t's projection, then separating planes
# through v, else the exact test.
def hit1.g(pk: PK, +t: Tg, +s: Tg, +v: Pt, +p1: Pt, +p2: Pt, +q1: Pt, +q2: Pt) -> Bool:
  PK{+k, +op} = pk
  +oq = o2(k, v, q1, q2)
  wedge.if(sect.a(Bool.and(U.nonzero(op), U.nonzero(oq)), k, v, p1, p2, q1, q2, op, oq), t, s, v, p1, p2, q1, q2)

def cone.s3(both: Bool, +k: U32, +v: Pt, +a1: Pt, +a2: Pt, +b1: Pt, +b2: Pt) -> Bool:
  match both:
    case True{}:
      +oa = o2(k, v, a1, a2)
      Bool.or(in_sector(k, b1, v, a1, a2, oa), in_sector(k, b2, v, a1, a2, oa))
    case False{}:
      False{}

def cone.c(hit: Bool, +both: Bool, +k: U32, +v: Pt, +a1: Pt, +a2: Pt, +b1: Pt, +b2: Pt) -> Bool:
  match hit:
    case True{}:
      True{}
    case False{}:
      cone.s3(both, k, v, a1, a2, b1, b2)

def cone.b(z2: Bool, +both: Bool, +k: U32, +ob: U32, +v: Pt, +a1: Pt, +a2: Pt, +b1: Pt, +b2: Pt) -> Bool:
  match z2:
    case True{}:
      cone.c(in_sector(k, a2, v, b1, b2, ob), both, k, v, a1, a2, b1, b2)
    case False{}:
      False{}

def cone.a1(hit: Bool, +z2: Bool, +k: U32, +ob: U32, +v: Pt, +a1: Pt, +a2: Pt, +b1: Pt, +b2: Pt) -> Bool:
  match hit:
    case True{}:
      True{}
    case False{}:
      cone.b(z2, z2, k, ob, v, a1, a2, b1, b2)

def cone.a(z1: Bool, +z2: Bool, +k: U32, +ob: U32, +v: Pt, +a1: Pt, +a2: Pt, +b1: Pt, +b2: Pt) -> Bool:
  match z1:
    case True{}:
      cone.a1(in_sector(k, a1, v, b1, b2, ob), z2, k, ob, v, a1, a2, b1, b2)
    case False{}:
      cone.b(z2, False{}, k, ob, v, a1, a2, b1, b2)

# x = (v, a1, a2) lies on one closed side of the plane of y = (v, b1, b2),
# z1, z2 the (exact) signs of a1, a2; x meets that plane in v and its zero
# corners. Beyond v they meet iff a zero corner's ray lies in y's cone, or
# (x coplanar) a ray of y lies in x's cone. Decided exactly in y's projection,
# lazily.
def cone.k(pk: PK, +v: Pt, +a1: Pt, +a2: Pt, +b1: Pt, +b2: Pt, +z1: U32, +z2: U32) -> Bool:
  PK{+k, +ob} = pk
  Bool.or(U.is_zero(ob), cone.a(is_zero(z1), is_zero(z2), k, ob, v, a1, a2, b1, b2))

def cone(+y: Tg, +v: Pt, +a1: Pt, +a2: Pt, +b1: Pt, +b2: Pt, +z1: U32, +z2: U32) -> Bool:
  cone.k(gt.proj(y), v, a1, a2, b1, b2, z1, z2)

def hit1.c(o1: Bool, o2b: Bool, +t: Tg, +s: Tg, +v: Pt, +p1: Pt, +p2: Pt, +q1: Pt, +q2: Pt, +s1: U32, +s2: U32, +r1: U32, +r2: U32) -> Bool:
  match o1 o2b:
    case True{} _:
      cone(s, v, p1, p2, q1, q2, s1, s2)
    case False{} True{}:
      cone(t, v, q1, q2, p1, p2, r1, r2)
    case False{} False{}:
      hit1.g(gt.proj(t), t, s, v, p1, p2, q1, q2)

def hit1.b(sep: Bool, +t: Tg, +s: Tg, +v: Pt, +p1: Pt, +p2: Pt, +q1: Pt, +q2: Pt, +s1: U32, +s2: U32, +r1: U32, +r2: U32) -> Bool:
  match sep:
    case True{}:
      False{}
    case False{}:
      hit1.c(onesided2(s1, s2), onesided2(r1, r2), t, s, v, p1, p2, q1, q2, s1, s2, r1, r2)

# If p1, p2 lie strictly on one side of s's plane, t meets that plane only
# in v (and so s at most in v); likewise for q1, q2 and t's plane.
def hit1.a(sep: Bool, +t: Tg, +s: Tg, +v: Pt, +p1: Pt, +p2: Pt, +q1: Pt, +q2: Pt, +s1: U32, +s2: U32) -> Bool:
  match sep:
    case True{}:
      False{}
    case False{}:
      +r1 = side(t, q1)
      +r2 = side(t, q2)
      hit1.b(sep2(r1, r2), t, s, v, p1, p2, q1, q2, s1, s2, r1, r2)

# i: the shared corner of t, j: the same vertex's corner in s.
def hit1(+t: Tg, +s: Tg, +i: U32, +j: U32) -> Bool:
  +p1 = gt.at(t, (i + 1 : U32))
  +p2 = gt.at(t, (i + 2 : U32))
  +s1 = side(s, p1)
  +s2 = side(s, p2)
  hit1.a(sep2(s1, s2), t, s, gt.at(t, i), p1, p2, gt.at(s, (j + 1 : U32)), gt.at(s, (j + 2 : U32)), s1, s2)

# One shared edge a-b; c1 the third corner of t, c2 of s. They meet outside
# the edge only when coplanar and folded onto the same side of it.
def hit2.x(same: Bool, known: Bool, +a: Pt, +b: Pt, +c1: Pt, +c2: Pt) -> Bool:
  match same known:
    case True{} True{}:
      True{}
    case True{} False{}:
      U32.is_eq(o3(pt.r(a), pt.r(b), pt.r(c1), pt.r(c2)), 0)
    case False{} _:
      False{}

# known: c2 is exactly on t's plane.
def hit2.p(pk: PK, known: Bool, +a: Pt, +b: Pt, +c1: Pt, +c2: Pt) -> Bool:
  PK{+k, +o} = pk
  Bool.or(U.is_zero(o), hit2.x(U32.is_eq(times(o2(k, a, b, c1), o2(k, a, b, c2)), 1), known, a, b, c1, c2))

def hit2.a(sep: Bool, known: Bool, +t: Tg, +a: Pt, +b: Pt, +c1: Pt, +c2: Pt) -> Bool:
  match sep:
    case True{}:
      False{}
    case False{}:
      hit2.p(gt.proj(t), known, a, b, c1, c2)

# k: the unshared corner of t; jq: the unshared corner of s.
def hit2(+t: Tg, +s: Tg, +k: U32, +jq: U32) -> Bool:
  +c2 = gt.at(s, jq)
  +sd = side(t, c2)
  hit2.a(Bool.or(is_pos(sd), is_neg(sd)), is_zero(sd), t, gt.at(t, (k + 1 : U32)), gt.at(t, (k + 2 : U32)), gt.at(t, k), c2)

# Corner of x in (a, b, c): 0, 1, 2, or 3 when absent.
def corner_of(+x: U32, +a: U32, +b: U32, +c: U32) -> U32:
  Bool.pick(U32, U32.is_eq(x, a), 0, Bool.pick(U32, U32.is_eq(x, b), 1, Bool.pick(U32, U32.is_eq(x, c), 2, 3)))

def has(+m: U32) -> Bool:
  U32.is_ne(m, 3)

def pick3(+i: U32, +a: U32, +b: U32, +c: U32) -> U32:
  Bool.pick(U32, U32.is_eq(i, 0), a, Bool.pick(U32, U32.is_eq(i, 1), b, c))

def hit.k(k0: Bool, k1: Bool, k2: Bool, +t: Tg, +s: Tg, +ma: U32, +mb: U32, +mc: U32) -> Bool:
  match k0 k1 k2:
    case True{} _ _:
      hit0(t, s)
    case False{} True{} _:
      +i = Bool.pick(U32, has(ma), 0, Bool.pick(U32, has(mb), 1, 2))
      hit1(t, s, i, pick3(i, ma, mb, mc))
    case False{} False{} True{}:
      +k = Bool.pick(U32, has(ma), Bool.pick(U32, has(mb), 2, 1), 0)
      hit2(t, s, k, (3 - pick3(U32.mod((k + 1 : U32), 3), ma, mb, mc) - pick3(U32.mod((k + 2 : U32), 3), ma, mb, mc) : U32))
    case False{} False{} False{}:
      True{}

# Do the triangles meet outside their shared vertices / edge?
def pair_hit(+t: Tg, +s: Tg) -> Bool:
  Tg{+a, +b, +c, _, _, _, _, _, _, _, _, _, _} = t
  Tg{+x, +y, +z, _, _, _, _, _, _, _, _, _, _} = s
  +ma = corner_of(a, x, y, z)
  +mb = corner_of(b, x, y, z)
  +mc = corner_of(c, x, y, z)
  +k = (U.b2u(has(ma)) + U.b2u(has(mb)) + U.b2u(has(mc)) : U32)
  hit.k(U32.is_eq(k, 0), U32.is_eq(k, 1), U32.is_eq(k, 2), t, s, ma, mb, mc)

# A leaf entry: the triangle's box (flat, next to the triangle, so the box
# test of a pair does not open the triangle record) and its tag.
type LI is Data:
  LI{x0: F32, y0: F32, z0: F32, x1: F32, y1: F32, z1: F32, tag: U32, t: Tg}

def li.mk(b: P.Box, +tag: U32, t: Tg) -> LI:
  P.Box{x0, y0, z0, x1, y1, z1} = b
  LI{x0, y0, z0, x1, y1, z1, tag, t}

def li.of(+t: Tg, +tag: U32) -> LI:
  li.mk(gt.box(t), tag, t)

def li.box(+a: LI) -> P.Box:
  LI{x0, y0, z0, x1, y1, z1, _, _} = a
  P.Box{x0, y0, z0, x1, y1, z1}

def li.tag(+a: LI) -> U32:
  LI{_, _, _, _, _, _, g, _} = a
  g

def li.t(+a: LI) -> Tg:
  LI{_, _, _, _, _, _, _, t} = a
  t

# Different tags and meeting boxes.
def li.meet(+a: LI, +b: LI) -> Bool:
  LI{ax0, ay0, az0, ax1, ay1, az1, ag, _} = a
  LI{bx0, by0, bz0, bx1, by1, bz1, bg, _} = b
  Bool.and(Bool.and(U32.is_ne(ag, bg), Bool.and(Bool.and((ax0 <= bx1 : F32), (bx0 <= ax1 : F32)), Bool.and((ay0 <= by1 : F32), (by0 <= ay1 : F32)))), Bool.and((az0 <= bz1 : F32), (bz0 <= az1 : F32)))

def pair.k(meet: Bool, +a: LI, +b: LI) -> U32:
  match meet:
    case True{}:
      U.b2u(pair_hit(li.t(a), li.t(b)))
    case False{}:
      0

def pair(+a: LI, +b: LI) -> U32:
  pair.k(li.meet(a, b), a, b)

# --- bounding-volume self-join ----------------------------------------------------------
# Pairs of triangles with the same tag (cut from the same input face, which is
# recover's patch) are not tested, as in recover's clear.bend: every node
# records the tag all its triangles share (u, or none()), and a subtree, or a
# pair of subtrees, of one tag is skipped whole.

type GB is Data:
  GNil{}
  GLeaf{bx: P.Box, u: U32, xs: List<&2, LI>}
  GNode{bx: P.Box, u: U32, l: GB, r: GB}

def gb.box(+n: GB) -> P.Box:
  match n:
    case GNil{}:
      P.box_empty()
    case GLeaf{b, _, _}:
      b
    case GNode{b, _, _, _}:
      b

def gb.u(+n: GB) -> U32:
  match n:
    case GNil{}:
      none()
    case GLeaf{_, u, _}:
      u
    case GNode{_, u, _, _}:
      u

def uni(+a: U32, +b: U32) -> U32:
  Bool.pick(U32, U32.is_eq(a, b), a, none())

type MG is Data:
  MG{code: U32, t: LI}

# 4294967294 marks "no triangle yet".
def leaf.of(xs: List<&2, LI>, bx: P.Box, +u: U32, acc: List<&2, LI>) -> GB:
  match xs:
    case Nil{}:
      GLeaf{bx, u, acc}
    case +t <> rest:
      +g = li.tag(t)
      leaf.of(rest, P.box_union(bx, li.box(t)), Bool.pick(U32, U32.is_eq(u, 4294967294), g, uni(u, g)), t <> acc)

# Leaves of at most 4 consecutive (Morton-ordered) triangles.
def leaves.go(ms: List<&2, LI>, acc: List<&2, GB>) -> List<&2, GB>:
  match ms:
    case a <> b <> c <> d <> rest:
      leaves.go(rest, leaf.of([a, b, c, d], P.box_empty(), 4294967294, Nil{}) <> acc)
    case Nil{}:
      U.rev(GB, acc)
    case xs:
      U.rev(GB, leaf.of(xs, P.box_empty(), 4294967294, Nil{}) <> acc)

# Bucket sort by the top d bits of the Morton code (2^d >= n buckets, one
# pass into an Array, read out in order): O(n), no comparisons. The order
# inside a bucket does not matter to the tree (the join only counts).
def mbucket(+code: U32, +d: Nat) -> U32:
  U32.shrn(code, Nat.sub(30n, d))

def mfill.go(xs: List<&2, MG>, +d: Nat, st: Array<List<&2, LI>> & List<&2, LI>, +pb: U32, +pending: LI) -> Array<List<&2, LI>>:
  match xs:
    case Nil{}:
      (arr, lst) = st
      Array.set(List<&2, LI>, arr, pb, pending <> lst)
    case MG{+c, +x} <> rest:
      (arr, lst) = st
      +b = mbucket(c, d)
      mfill.go(rest, d, Array.get(List<&2, LI>, Array.set(List<&2, LI>, arr, pb, pending <> lst), b), b, x)

def mflat.go(a: Array<List<&2, LI>>, acc: List<&2, LI>) -> List<&2, LI>:
  match a:
    case ALeaf{xs}:
      U.rev_onto(LI, xs, acc)
    case ANode{l, r}:
      mflat.go(l, mflat.go(r, acc))

def msort(xs: List<&2, MG>, +d: Nat) -> List<&2, LI>:
  match xs:
    case Nil{}:
      Nil{}
    case MG{+c, +x} <> rest:
      +empty = {Nil{} : List<&2, LI>}
      +b = mbucket(c, d)
      mflat.go(mfill.go(rest, d, Array.get(List<&2, LI>, Array.new(List<&2, LI>, d, empty), b), b, x), Nil{})

def gb.pairs(xs: List<&2, GB>, acc: List<&2, GB>) -> List<&2, GB>:
  match xs:
    case Nil{}:
      U.rev(GB, acc)
    case a <> Nil{}:
      U.rev(GB, a <> acc)
    case +a <> +b <> t:
      gb.pairs(t, GNode{P.box_union(gb.box(a), gb.box(b)), uni(gb.u(a), gb.u(b)), a, b} <> acc)

def gb.levels(fuel: Nat, xs: List<&2, GB>) -> GB:
  match fuel xs:
    case _ Nil{}:
      GNil{}
    case _ t <> Nil{}:
      t
    case 0n _:
      GNil{}
    case 1n+p _:
      gb.levels(p, gb.pairs(xs, Nil{}))

def one_many(+t: LI, ys: List<&2, LI>, +acc: U32) -> U32:
  match ys:
    case Nil{}:
      acc
    case +s <> rest:
      one_many(t, rest, (acc + pair(t, s) : U32))

def many_many(xs: List<&2, LI>, +ys: List<&2, LI>, +acc: U32) -> U32:
  match xs:
    case Nil{}:
      acc
    case +t <> rest:
      many_many(rest, ys, one_many(t, ys, acc))

def within(xs: List<&2, LI>, +acc: U32) -> U32:
  match xs:
    case Nil{}:
      acc
    case +t <> +rest:
      within(rest, one_many(t, rest, acc))

# A pair of subtrees needs work unless both lie in one tag or their boxes
# are apart.
def cgo(+a: GB, +b: GB) -> Bool:
  +u = gb.u(a)
  Bool.and(Bool.not(Bool.and(U32.is_ne(u, none()), U32.is_eq(u, gb.u(b)))), P.box_overlap(gb.box(a), gb.box(b)))

# A subtree needs a self-join unless it lies in one tag.
def sgo(+n: GB) -> Bool:
  U32.is_eq(gb.u(n), none())

def cross.s(+fuel: Nat, go: Bool, +x: GB, +y: GB) -> U32:
  match fuel go:
    case 0n _:
      0
    case _ False{}:
      0
    case 1n+f True{}:
      match x y:
        case GLeaf{_, _, xs} GLeaf{_, _, ys}:
          many_many(xs, ys, 0)
        case GNode{_, _, xl, xr} GLeaf{_, _, _}:
          (cross.s(f, cgo(xl, y), xl, y) + cross.s(f, cgo(xr, y), xr, y) : U32)
        case GLeaf{_, _, _} GNode{_, _, yl, yr}:
          (cross.s(f, cgo(x, yl), x, yl) + cross.s(f, cgo(x, yr), x, yr) : U32)
        case GNode{_, _, xl, xr} GNode{_, _, yl, yr}:
          (cross.s(f, cgo(xl, yl), xl, yl) + cross.s(f, cgo(xr, yr), xr, yr) + cross.s(f, cgo(xl, yr), xl, yr) + cross.s(f, cgo(xr, yl), xr, yl) : U32)
        case _ _:
          0

def self.s(+fuel: Nat, go: Bool, +n: GB) -> U32:
  match fuel go:
    case 0n _:
      0
    case _ False{}:
      0
    case 1n+f True{}:
      match n:
        case GLeaf{_, _, xs}:
          within(xs, 0)
        case GNode{_, _, l, r}:
          (self.s(f, sgo(l), l) + self.s(f, sgo(r), r) + cross.s(Nat.add(f, f), cgo(l, r), l, r) : U32)
        case GNil{}:
          0

# The join as one flat fork tree: the pair (root, root) is split top-down
# into self tasks (one subtree) and cross tasks (two subtrees whose boxes
# meet) until there are at least 1024, and the tasks run in a balanced fork
# tree of 256 chunks, each task sequentially. (A self-join that forks and
# then calls the cross join in the same frame runs that cross join, the
# largest part, sequentially on Bend 2.0.25's CPU pool.)
type Task is Data:
  TkSelf{n: GB}
  TkCross{x: GB, y: GB}

def cross.push(go: Bool, +x: GB, +y: GB, acc: List<&2, Task>) -> List<&2, Task>:
  match go:
    case True{}:
      TkCross{x, y} <> acc
    case False{}:
      acc

def self.push(go: Bool, +n: GB, acc: List<&2, Task>) -> List<&2, Task>:
  match go:
    case True{}:
      TkSelf{n} <> acc
    case False{}:
      acc

def task.split(t: Task, acc: List<&2, Task>) -> List<&2, Task>:
  match t:
    case TkSelf{GNode{_, _, +l, +r}}:
      self.push(sgo(l), l, self.push(sgo(r), r, cross.push(cgo(l, r), l, r, acc)))
    case TkCross{GNode{_, _, +xl, +xr}, GNode{_, _, +yl, +yr}}:
      cross.push(cgo(xl, yl), xl, yl, cross.push(cgo(xr, yr), xr, yr, cross.push(cgo(xl, yr), xl, yr, cross.push(cgo(xr, yl), xr, yl, acc))))
    case TkCross{GNode{_, _, +xl, +xr}, +y}:
      cross.push(cgo(xl, y), xl, y, cross.push(cgo(xr, y), xr, y, acc))
    case TkCross{+x, GNode{_, _, +yl, +yr}}:
      cross.push(cgo(x, yl), x, yl, cross.push(cgo(x, yr), x, yr, acc))
    case other:
      other <> acc

def split.all(ts: List<&2, Task>, acc: List<&2, Task>) -> List<&2, Task>:
  match ts:
    case Nil{}:
      acc
    case t <> rest:
      split.all(rest, task.split(t, acc))

def expand(fuel: Nat, big: Bool, ts: List<&2, Task>) -> List<&2, Task>:
  match fuel big:
    case _ True{}:
      ts
    case 0n False{}:
      ts
    case 1n+p False{}:
      +ns = split.all(ts, Nil{})
      expand(p, U32.is_ge(U.len(Task, ns), 1024), ns)

def run_task(+fuel: Nat, t: Task) -> U32:
  match t:
    case TkSelf{+n}:
      self.s(fuel, sgo(n), n)
    case TkCross{x, y}:
      cross.s(fuel, True{}, x, y)

def run_seq(ts: List<&2, Task>, +fuel: Nat, +acc: U32) -> U32:
  match ts:
    case Nil{}:
      acc
    case t <> rest:
      run_seq(rest, fuel, (acc + run_task(fuel, t) : U32))

def run_par(c: I.CTree<Task>, +fuel: Nat) -> U32:
  match c:
    case I.CtNil{}:
      0
    case I.CtLeaf{xs}:
      run_seq(xs, fuel, 0)
    case I.CtNode{l, r}:
      a b = run_par(l, fuel) run_par(r, fuel)
      (a + b : U32)

# Number of intersecting triangle pairs.
def si_count(ms: List<&2, MG>, +n: U32) -> U32:
  +d = U.depth(n)
  +tree = gb.levels(Nat.add(d, 2n), leaves.go(msort(ms, Nat.min(d, 30n)), Nil{}))
  run_par(I.ctree(Task, expand(16n, False{}, [TkSelf{tree}]), 256), Nat.add(Nat.add(d, d), 8n))

# --- triangles of the result --------------------------------------------------------------

def deg.k(sure: Bool, +a: G.Vec3, +b: G.Vec3, +c: G.Vec3) -> U32:
  match sure:
    case True{}:
      0
    case False{}:
      U.b2u(Bool.and(U.is_zero(orient_in(E.Proj{0, False{}}, a, b, c)), Bool.and(U.is_zero(orient_in(E.Proj{1, False{}}, a, b, c)), U.is_zero(orient_in(E.Proj{2, False{}}, a, b, c)))))

# 1 for a triangle with exactly collinear corners. The F32 normal of the
# local differences errs by less than 16 * 2^-24 e^2 + 32 * 2^-48 m e, so a
# component beyond bound3(m, e, e, 1)-like 2^-14 e^2 + 2^-38 m e certifies a
# proper triangle; otherwise the three exact projected orientations decide.
def degenerate(+t: Tg) -> U32:
  Tg{_, _, _, +pa, +pb, +pc, +n, +m, +e, _, _, _, _} = t
  +ee = (e + lo44(m) : F32)
  deg.k((f3.max(n) > ((0.00006103515625 * ee * ee : F32) + (0.000000000003637978807091713 * m * ee : F32) : F32) : F32), pt.r(pa), pt.r(pb), pt.r(pc))

type Items is Data:
  Items{ms: List<&2, MG>, deg: U32}

# A triangle with its corners attached.
type TP is Data:
  TP{a: U32, b: U32, c: U32, tag: U32, pa: Pt, pb: Pt, pc: Pt}

# The Morton code of a box's centre in the global box (lower corner g,
# extent e), from scalars: no lane reads a shared box record.
def gmorton(b: P.Box, +gx: F32, +gy: F32, +gz: F32, +ex: F32, +ey: F32, +ez: F32) -> U32:
  P.Box{x0, y0, z0, x1, y1, z1} = b
  +qx = I.quant(((x0 + x1) * 0.5 : F32), gx, ex)
  +qy = I.quant(((y0 + y1) * 0.5 : F32), gy, ey)
  +qz = I.quant(((z0 + z1) * 0.5 : F32), gz, ez)
  U32.or(I.spread10(qx), U32.or(U32.shl(I.spread10(qy)), U32.shln(I.spread10(qz), 2n)))

def items(ts: List<&2, TP>, +gx: F32, +gy: F32, +gz: F32, +ex: F32, +ey: F32, +ez: F32, acc: Items) -> Items:
  match ts:
    case Nil{}:
      acc
    case TP{+a, +b, +c, +tg, +pa, +pb, +pc} <> rest:
      Items{xs, +dg} = acc
      +t = gt.of(a, b, c, pa, pb, pc)
      items(rest, gx, gy, gz, ex, ey, ez, Items{MG{gmorton(gt.box(t), gx, gy, gz, ex, ey, ez), li.of(t, tg)} <> xs, (dg + degenerate(t) : U32)})

def items.merge(a: Items, b: Items) -> Items:
  Items{xa, +da} = a
  Items{xb, +db} = b
  Items{U.cat(MG, xa, xb), (da + db : U32)}

# The triangles as Morton-keyed items, built over a balanced fork tree (no
# shared table is read: the corners are already attached).
def items.par(c: I.CTree<TP>, +gx: F32, +gy: F32, +gz: F32, +ex: F32, +ey: F32, +ez: F32) -> Items:
  match c:
    case I.CtNil{}:
      Items{Nil{}, 0}
    case I.CtLeaf{xs}:
      items(xs, gx, gy, gz, ex, ey, ez, Items{Nil{}, 0})
    case I.CtNode{l, r}:
      a b = items.par(l, gx, gy, gz, ex, ey, ez) items.par(r, gx, gy, gz, ex, ey, ez)
      items.merge(a, b)

def items.run(g: P.Box, c: I.CTree<TP>) -> Items:
  P.Box{+x0, +y0, +z0, x1, y1, z1} = g
  items.par(c, x0, y0, z0, (x1 - x0 : F32), (y1 - y0 : F32), (z1 - z0 : F32))

# --- corners attached in one owned pass ----------------------------------------------------
# The corner points live in an Array owned by one sequential pass (no
# reference counting on a shared lookup table, which every lane of a fork
# tree would contend on).

def parr(vs: List<&2, G.Vec3>, a: Array<Pt>, +i: U32) -> Array<Pt>:
  match vs:
    case Nil{}:
      a
    case +v <> t:
      parr(t, Array.set(Pt, a, i, pt.of(v)), (i + 1 : U32))

type G3 is Type:
  G3{arr: Array<Pt>, pa: Pt, pb: Pt, pc: Pt}

def get3.c(r: Array<Pt> & Pt, +pa: Pt, +pb: Pt) -> G3:
  (arr, pc) = r
  G3{arr, pa, pb, pc}

def get3.b(r: Array<Pt> & Pt, +pa: Pt, +c: U32) -> G3:
  (arr, pb) = r
  get3.c(Array.get(Pt, arr, c), pa, pb)

def get3.a(r: Array<Pt> & Pt, +b: U32, +c: U32) -> G3:
  (arr, pa) = r
  get3.b(Array.get(Pt, arr, b), pa, c)

def get3(arr: Array<Pt>, +a: U32, +b: U32, +c: U32) -> G3:
  get3.a(Array.get(Pt, arr, a), b, c)

type AS is Type:
  AS{ts: List<&2, M.Tri>, arr: Array<Pt>, acc: List<&2, TP>}

def att.g(r: G3, +a: U32, +b: U32, +c: U32, +tg: U32, rest: List<&2, M.Tri>, acc: List<&2, TP>) -> U.Step<AS>:
  G3{arr, pa, pb, pc} = r
  U.CfMore{AS{rest, arr, TP{a, b, c, tg, pa, pb, pc} <> acc}}

def att.k(ts: List<&2, M.Tri>, arr: Array<Pt>, acc: List<&2, TP>) -> U.Step<AS>:
  match ts:
    case Nil{}:
      U.CfDone{AS{Nil{}, arr, acc}}
    case M.Tri{+a, +b, +c, +tg} <> rest:
      att.g(get3(arr, a, b, c), a, b, c, tg, rest, acc)

def att.step(s: AS) -> U.Step<AS>:
  AS{ts, arr, acc} = s
  att.k(ts, arr, acc)

def att.out(s: AS) -> List<&2, TP>:
  AS{_, _, acc} = s
  acc

def attach(ts: List<&2, M.Tri>, +nt: U32, vs: List<&2, G.Vec3>, +nv: U32) -> List<&2, TP>:
  +z = pt.of(G.v3(0.0, 0.0, 0.0))
  att.out(U.loop(~AS, ~att.step, U32.to_nat((nt + 1 : U32)), U.CfMore{AS{ts, parr(vs, Array.new(Pt, U.depth(nv), z), 0), Nil{}}}))

def si.v(hit: Bool) -> GateR:
  match hit:
    case True{}:
      GBad{"result self-intersects (below 2^-36*scale)"}
    case False{}:
      GOk{}

def si.k(deg: Bool, xs: List<&2, MG>, +n: U32) -> GateR:
  match deg:
    case True{}:
      GBad{"result has a degenerate triangle"}
    case False{}:
      si.v(U.nonzero(si_count(xs, n)))

def si.fin(it: Items, +n: U32) -> GateR:
  Items{xs, +dg} = it
  si.k(U.nonzero(dg), xs, n)

def check.k(bad: Bool, +ts: List<&2, M.Tri>, +vs: List<&2, G.Vec3>) -> GateR:
  match bad:
    case True{}:
      GBad{"non-manifold contact (point)"}
    case False{}:
      +nt = U.len(M.Tri, ts)
      si.fin(items.run(P.mesh_box(vs, P.box_empty()), I.ctree(TP, attach(ts, nt, vs, U.len(G.Vec3, vs)), 64)), nt)

# The gate over a closed, edge-paired, compacted result mesh.
def check(+m: M.Mesh) -> GateR:
  M.Mesh{+vs, +ts} = m
  check.k(U.nonzero(bad_links(ts, U.len(G.Vec3, vs))), ts, vs)
