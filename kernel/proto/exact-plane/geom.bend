import Base
import ../../real.bend as R
import ../../precise.bend as G
import ./big.bend as B

# Plane-based exact geometry of the exact-plane prototype.
#
# Numeric model (docs/proto-exact-plane.md):
# - Input vertices are quantized once to the integer grid 2^-24 mm (G = 24);
#   every grid coordinate satisfies |x| < 2^34 (the box is +-1024 mm, B = 34).
# - Planes have integer coefficients a x + b y + c z + d. Input face planes
#   have |a|,|b|,|c| < 2^(2B+3) = 2^71 and |d| < 2^(3B+5) = 2^107; input edge
#   planes have |normal| < 2^(B+1) and |d| < 2^(2B+2); axis cell planes are
#   smaller still. Split planes are always input planes, never derived ones.
# - A vertex is the exact intersection point of three planes, stored as
#   homogeneous integers (X, Y, Z, W) with W > 0. It is never rounded while
#   the Boolean runs; rounding happens once, at export (round_vertex).
# - The one predicate is the sign of a plane at a vertex,
#   a X + b Y + c Z + d W. It is decided by a float filter on scaled F32x2
#   approximations and falls back to exact Big arithmetic when the filter
#   cannot certify the sign (always the case for a zero).

# id: a unique number of an input plane (4 t for the support plane of input
# triangle t, 4 t + 1..3 for its edge planes; kept by plane_neg) or NOID.
# A constructed vertex carries the ids of its three defining planes.
type Plane is Data:
  Plane{a: B.Big, b: B.Big, c: B.Big, d: B.Big, fa: R.Real, fb: R.Real, fc: R.Real, fd: R.Real, id: U32}

type Vtx is Data:
  Vtx{x: B.Big, y: B.Big, z: B.Big, w: B.Big, fx: R.Real, fy: R.Real, fz: R.Real, fw: R.Real, i1: U32, i2: U32, i3: U32}

# Outcome of one plane-side test. F*: certified by the float filter;
# X*: decided by exact arithmetic; SZero: zero by construction.
type Side is Data:
  FNeg{}
  FPos{}
  XNeg{}
  XZero{}
  XPos{}
  SZero{}

# --- scaled approximations -------------------------------------------------

def pow2neg.go(k: Nat) -> F32:
  match k:
    case 0n:
      1.0
    case 1n+p:
      (0.0000152587890625 * pow2neg.go(p) : F32)

def pow2neg(k: U32) -> F32:
  pow2neg.go(U32.to_nat(k))

def rscale(r: R.Real, +f: F32) -> R.Real:
  R.Real{hi, lo} = r
  R.Real{(hi * f : F32), (lo * f : F32)}

# Keep the top 4 limbs of the reference magnitude (L limbs), scale so the
# reference lies in [1, 2^16).
def approx(a: B.Big, +l: U32) -> R.Real:
  +drop = (l - U32.min(l, 4) : U32)
  rscale(B.to_real_drop(a, U32.to_nat(drop)), pow2neg((U32.min(l, 4) - U32.min(l, 1) : U32)))

def max3(+a: U32, +b: U32, +c: U32) -> U32:
  U32.max(a, U32.max(b, c))

def plane(+a: B.Big, +b: B.Big, +c: B.Big, +d: B.Big) -> Plane:
  +l = max3(B.nlimbs(a), B.nlimbs(b), B.nlimbs(c))
  Plane{a, b, c, d, approx(a, l), approx(b, l), approx(c, l), approx(d, l), 4294967295}

def vtx(+x: B.Big, +y: B.Big, +z: B.Big, +w: B.Big) -> Vtx:
  +l = B.nlimbs(w)
  Vtx{x, y, z, w, approx(x, l), approx(y, l), approx(z, l), approx(w, l), 4294967295, 4294967295, 4294967295}

def plane_neg(p: Plane) -> Plane:
  Plane{a, b, c, d, fa, fb, fc, fd, id} = p
  Plane{B.neg(a), B.neg(b), B.neg(c), B.neg(d), R.neg(fa), R.neg(fb), R.neg(fc), R.neg(fd), id}

def with_id(p: Plane, +id: U32) -> Plane:
  Plane{a, b, c, d, fa, fb, fc, fd, _} = p
  Plane{a, b, c, d, fa, fb, fc, fd, id}

def plane_id(p: Plane) -> U32:
  Plane{_, _, _, _, _, _, _, _, id} = p
  id

def with_ids(v: Vtx, +i1: U32, +i2: U32, +i3: U32) -> Vtx:
  Vtx{x, y, z, w, fx, fy, fz, fw, _, _, _} = v
  Vtx{x, y, z, w, fx, fy, fz, fw, i1, i2, i3}

# p is one of the planes that define v (exact by construction: v was built
# as their intersection point).
def on_by_construction(p: Plane, v: Vtx) -> Bool:
  Plane{_, _, _, _, _, _, _, _, +id} = p
  Vtx{_, _, _, _, _, _, _, _, i1, i2, i3} = v
  Bool.and(U32.is_ne(id, 4294967295), Bool.or(U32.is_eq(id, i1), Bool.or(U32.is_eq(id, i2), U32.is_eq(id, i3))))

# --- the predicate -----------------------------------------------------------

def fabs(+x: F32) -> F32:
  F32.abs(x)

def rabs_hi(r: R.Real) -> F32:
  R.Real{hi, _} = r
  F32.abs(hi)

def exact_side.of(s: B.Sign) -> Side:
  match s:
    case B.Lt0{}:
      XNeg{}
    case B.Eq0{}:
      XZero{}
    case B.Gt0{}:
      XPos{}

def exact_side(p: Plane, v: Vtx) -> Side:
  Plane{a, b, c, d, _, _, _, _, _} = p
  Vtx{x, y, z, w, _, _, _, _, _, _, _} = v
  exact_side.of(B.sign(B.add(B.dot3(a, b, c, x, y, z), B.mul(d, w))))

def filter_pick(ok: Bool, neg: Bool, p: Plane, v: Vtx) -> Side:
  match ok neg:
    case True{} True{}:
      FNeg{}
    case True{} False{}:
      FPos{}
    case False{} _:
      exact_side(p, v)

# Error bound: the approximations carry an absolute error below 2^-47 in their
# scaled units and each F32x2 operation a relative error below 2^-44 of its
# operands; 2^-40 M + 2^-44 S bounds both with a wide margin.
def side.filtered(+p: Plane, +v: Vtx) -> Side:
  Plane{_, _, _, _, +fa, +fb, +fc, +fd, _} = p
  Vtx{_, _, _, _, +fx, +fy, +fz, +fw, _, _, _} = v
  +ta = R.mul(fa, fx)
  +tb = R.mul(fb, fy)
  +tc = R.mul(fc, fz)
  +td = R.mul(fd, fw)
  +f = R.approx(R.add(R.add(ta, tb), R.add(tc, td)))
  m = (rabs_hi(ta) + rabs_hi(tb) + rabs_hi(tc) + rabs_hi(td) : F32)
  s = (rabs_hi(fa) + rabs_hi(fb) + rabs_hi(fc) + rabs_hi(fd) + rabs_hi(fx) + rabs_hi(fy) + rabs_hi(fz) + rabs_hi(fw) : F32)
  e = (m * 0.0000000000009094947017729282 + s * 0.00000000000005684341886080802 + 0.0000000000000000000000000001 : F32)
  filter_pick((fabs(f) > e : F32), (f < 0.0 : F32), p, v)

def side.pick(sym: Bool, +p: Plane, +v: Vtx) -> Side:
  match sym:
    case True{}:
      SZero{}
    case False{}:
      side.filtered(p, v)

# The sign of plane p at vertex v: symbolic zero, float filter, exact.
def side(+p: Plane, +v: Vtx) -> Side:
  side.pick(on_by_construction(p, v), p, v)

# --- constructions -----------------------------------------------------------

type BV is Data:
  BV{x: B.Big, y: B.Big, z: B.Big}

def cross(u: BV, v: BV) -> BV:
  BV{+ux, +uy, +uz} = u
  BV{+vx, +vy, +vz} = v
  BV{B.sub(B.mul(uy, vz), B.mul(uz, vy)), B.sub(B.mul(uz, vx), B.mul(ux, vz)), B.sub(B.mul(ux, vy), B.mul(uy, vx))}

def bdot(u: BV, v: BV) -> B.Big:
  BV{ux, uy, uz} = u
  BV{vx, vy, vz} = v
  B.dot3(ux, uy, uz, vx, vy, vz)

def bscale(u: BV, +s: B.Big) -> BV:
  BV{ux, uy, uz} = u
  BV{B.mul(ux, s), B.mul(uy, s), B.mul(uz, s)}

def badd(u: BV, v: BV) -> BV:
  BV{ux, uy, uz} = u
  BV{vx, vy, vz} = v
  BV{B.add(ux, vx), B.add(uy, vy), B.add(uz, vz)}

def bneg(u: BV) -> BV:
  BV{ux, uy, uz} = u
  BV{B.neg(ux), B.neg(uy), B.neg(uz)}

def bsub(u: BV, v: BV) -> BV:
  badd(u, bneg(v))

def normal_of(p: Plane) -> BV:
  Plane{a, b, c, _, _, _, _, _, _} = p
  BV{a, b, c}

def offset_of(p: Plane) -> B.Big:
  Plane{_, _, _, d, _, _, _, _, _} = p
  d

def vtx_signed.of(xv: BV, +w: B.Big) -> Vtx:
  BV{x, y, z} = xv
  vtx(x, y, z, w)

def vtx_signed(neg: Bool, xv: BV, w: B.Big) -> Vtx:
  match neg:
    case False{}:
      vtx_signed.of(xv, w)
    case True{}:
      vtx_signed.of(bneg(xv), B.neg(w))

# The intersection point of three planes: with c23 = n2 x n3 (cyclic),
# W = n1 . c23 and W p = -(d1 c23 + d2 c31 + d3 c12). A zero W (planes
# without a unique common point) yields W = 0; callers check `degenerate`.
def meet(+p1: Plane, +p2: Plane, +p3: Plane) -> Vtx:
  +c23 = cross(normal_of(p2), normal_of(p3))
  +c31 = cross(normal_of(p3), normal_of(p1))
  +c12 = cross(normal_of(p1), normal_of(p2))
  +w = bdot(normal_of(p1), c23)
  +xv = bneg(badd(bscale(c23, offset_of(p1)), badd(bscale(c31, offset_of(p2)), bscale(c12, offset_of(p3)))))
  with_ids(vtx_signed(B.is_neg(w), xv, w), plane_id(p1), plane_id(p2), plane_id(p3))

def degenerate(v: Vtx) -> Bool:
  Vtx{_, _, _, w, _, _, _, _, _, _, _} = v
  B.is_zero(w)

# Exact equality of two vertices (X1 W2 = X2 W1 per coordinate).
def same.cross(+u: Vtx, +v: Vtx) -> Bool:
  Vtx{+x1, +y1, +z1, +w1, _, _, _, _, _, _, _} = u
  Vtx{+x2, +y2, +z2, +w2, _, _, _, _, _, _, _} = v
  Bool.and(B.eq(B.mul(x1, w2), B.mul(x2, w1)), Bool.and(B.eq(B.mul(y1, w2), B.mul(y2, w1)), B.eq(B.mul(z1, w2), B.mul(z2, w1))))

def ident(+u: Vtx, +v: Vtx) -> Bool:
  Vtx{x1, y1, z1, w1, _, _, _, _, _, _, _} = u
  Vtx{x2, y2, z2, w2, _, _, _, _, _, _, _} = v
  Bool.and(B.eq(w1, w2), Bool.and(B.eq(x1, x2), Bool.and(B.eq(y1, y2), B.eq(z1, z2))))

def same.pick(id: Bool, +u: Vtx, +v: Vtx) -> Bool:
  match id:
    case True{}:
      True{}
    case False{}:
      same.cross(u, v)

# Identical representations first (the common case: one construction shared
# by neighbouring pieces), cross-multiplication otherwise.
def same(+u: Vtx, +v: Vtx) -> Bool:
  same.pick(ident(u, v), u, v)

# --- input points ------------------------------------------------------------

# An input grid point (integers, W = 1).
def point(+x: B.Big, +y: B.Big, +z: B.Big) -> Vtx:
  vtx(x, y, z, B.one())

def coords(v: Vtx) -> BV:
  Vtx{x, y, z, _, _, _, _, _, _, _, _} = v
  BV{x, y, z}

def plane.of(n: BV, +d: B.Big) -> Plane:
  BV{x, y, z} = n
  plane(x, y, z, d)

# Plane through three grid points, oriented by the right-hand rule
# (counter-clockwise seen from the side the normal points to).
def plane3(+p: Vtx, +q: Vtx, +r: Vtx) -> Plane:
  +n = cross(bsub(coords(q), coords(p)), bsub(coords(r), coords(p)))
  plane.of(n, B.neg(bdot(n, coords(p))))

# Axis with the largest |normal component| (0 = x, 1 = y, 2 = z), from the
# approximations; the chosen component is nonzero for a nondegenerate plane.
def dominant.of(xy: Bool, xz: Bool, yz: Bool) -> U32:
  match xy xz yz:
    case True{} True{} _:
      0
    case True{} False{} _:
      2
    case False{} _ True{}:
      1
    case False{} _ False{}:
      2

def dominant(p: Plane) -> U32:
  Plane{_, _, _, _, fa, fb, fc, _, _} = p
  +ax = rabs_hi(fa)
  +ay = rabs_hi(fb)
  +az = rabs_hi(fc)
  dominant.of((ax >= ay : F32), (ax >= az : F32), (ay >= az : F32))

# (q - p) x e_k for the axis k.
def edge_normal(k: U32, u: BV) -> BV:
  match k:
    case 0:
      BV{ux, uy, uz} = u
      BV{B.zero(), uz, B.neg(uy)}
    case 1:
      BV{ux, uy, uz} = u
      BV{B.neg(uz), B.zero(), ux}
    case _:
      BV{ux, uy, uz} = u
      BV{uy, B.neg(ux), B.zero()}

def edge_fix(s: Side, pl: Plane) -> Plane:
  match s:
    case FPos{}:
      plane_neg(pl)
    case XPos{}:
      plane_neg(pl)
    case _:
      pl

# Edge plane through p and q containing the axis direction e_k, oriented so
# that the third vertex r of the triangle lies on its negative side.
def edge_plane(+k: U32, +p: Vtx, +q: Vtx, +r: Vtx) -> Plane:
  +pl = plane.of(edge_normal(k, bsub(coords(q), coords(p))), B.zero())
  +pl2 = plane.of(normal_of(pl), B.neg(bdot(normal_of(pl), coords(p))))
  edge_fix(side(pl2, r), pl2)

# Exact identity of two planes up to a positive factor (same = True) or a
# negative factor (opposite).
def bzero(c: BV) -> Bool:
  BV{cx, cy, cz} = c
  Bool.and(B.is_zero(cx), Bool.and(B.is_zero(cy), B.is_zero(cz)))

def parallel.exact(+p: Plane, +q: Plane) -> Bool:
  bzero(cross(normal_of(p), normal_of(q)))

# Float filter: a cross-product component of the approximate normals that is
# larger than its error bound proves the normals are not parallel. The
# approximations carry absolute errors below 2^-47 (+ 2^-48 relative) in their
# scaled units and each F32x2 product a relative error below 2^-44; the bound
# 2^-40 (|u1 v2| + |u2 v1| + |u1| + |v2| + |u2| + |v1|) covers both with margin.
def cross_clear(+u1: R.Real, +v2: R.Real, +u2: R.Real, +v1: R.Real) -> Bool:
  +a = rabs_hi(u1)
  +b = rabs_hi(v2)
  +c = rabs_hi(u2)
  +d = rabs_hi(v1)
  +x = R.approx(R.sub(R.mul(u1, v2), R.mul(u2, v1)))
  (F32.abs(x) > ((a * b + c * d + a + b + c + d : F32) * 0.0000000000009094947017729282 + 0.0000000000000000000000000001 : F32) : F32)

def parallel.pick(clear: Bool, +p: Plane, +q: Plane) -> Bool:
  match clear:
    case True{}:
      False{}
    case False{}:
      parallel.exact(p, q)

def parallel.f(+p: Plane, +q: Plane) -> Bool:
  Plane{_, _, _, _, +a1, +b1, +c1, _, _} = p
  Plane{_, _, _, _, +a2, +b2, +c2, _, _} = q
  parallel.pick(Bool.or(cross_clear(b1, c2, c1, b2), Bool.or(cross_clear(c1, a2, a1, c2), cross_clear(a1, b2, b1, a2))), p, q)

def parallel(+p: Plane, +q: Plane) -> Bool:
  parallel.f(p, q)

def coplanar.d2(+a1: B.Big, +b1: B.Big, +c1: B.Big, +d1: B.Big, +a2: B.Big, +b2: B.Big, +c2: B.Big, +d2: B.Big) -> Bool:
  Bool.and(B.eq(B.mul(d1, a2), B.mul(d2, a1)), Bool.and(B.eq(B.mul(d1, b2), B.mul(d2, b1)), B.eq(B.mul(d1, c2), B.mul(d2, c1))))

def coplanar.d(p: Plane, q: Plane) -> Bool:
  Plane{a1, b1, c1, d1, _, _, _, _, _} = p
  Plane{a2, b2, c2, d2, _, _, _, _, _} = q
  coplanar.d2(a1, b1, c1, d1, a2, b2, c2, d2)

# Coplanar (either orientation): parallel normals and d1 n2 = d2 n1.
def coplanar(+p: Plane, +q: Plane) -> Bool:
  Bool.and(parallel(p, q), coplanar.d(p, q))

# --- quantization of input reals ----------------------------------------------

# An integer-valued F32 as a Big (any magnitude): mantissa times 2^(e - 150).
def f32_int.k(zero: Bool, up: Bool, neg: Bool, +m: U32, +e: U32) -> B.Big:
  match zero up:
    case True{} _:
      B.zero()
    case False{} True{}:
      B.make(neg, B.mag_shl(B.mag_scale([U32.and(m, 65535), (m >> 16n : U32)], 1, 0), (e - 150 : U32)))
    case False{} False{}:
      B.from_i32(neg, U32.shrn(m, U32.to_nat((150 - e : U32))))

def f32_int(+x: F32) -> B.Big:
  +bits = F32.bits(x)
  +e = U32.and((bits >> 23n : U32), 255)
  +m = U32.or(U32.and(bits, 8388607), 8388608)
  f32_int.k(U32.is_eq(e, 0), U32.is_le(150, e), U32.is_ne(U32.and(bits, 2147483648), 0), m, e)

# round(x * 2^24) for an input real x (|x| < 1024 mm): the integer part of
# hi * 2^16 is exact in F32; the rest (fraction of hi plus lo) is rounded to
# nearest. Deterministic IEEE arithmetic on every target; the error is below
# 0.5 grid units plus the F32 rounding of that small sum.
def quantize(r: R.Real) -> B.Big:
  R.Real{hi, lo} = r
  +h = (hi * 16777216.0 : F32)
  +fh = F32.floor(h)
  +t = ((h - fh) + (lo * 16777216.0 : F32) : F32)
  B.add(f32_int(fh), f32_int(F32.floor((t + 0.5 : F32))))

# Quantization displacement of one coordinate in mm (approximate, for the
# report): |x - q 2^-24|.
def quant_error(r: R.Real, q: B.Big) -> F32:
  F32.abs(R.approx(R.sub(r, rscale(B.to_real(q), 0.000000059604644775390625))))

def in_box(q: B.Big) -> Bool:
  Cmp.is_lt(B.cmp(B.abs(q), B.shl(B.one(), 34)))

# --- helpers for interior points --------------------------------------------------

# round(r * 2^s) as a Big for a real r (s <= 60): the scaled hi part split
# into its integer part (exact) and fraction, plus the scaled lo part.
def scaled_int(r: R.Real, +f: F32) -> B.Big:
  R.Real{hi, lo} = r
  +h = (hi * f : F32)
  +fh = F32.floor(h)
  B.add(f32_int(fh), f32_int(F32.floor(((h - fh) + (lo * f : F32) + 0.5 : F32))))

# --- export rounding -------------------------------------------------------

# floor(X 2^12 / W) 2^-36 mm: the vertex rounded down onto the 2^-36 mm grid
# (2^-12 grid units). |X / W| < 2^35 grid units keeps the quotient below 2^47,
# so the F32x2 result is exact. Displacement per coordinate < 2^-36 mm.
# Reference version (binary long division); round_vertex below is the fast one.
def round_coord_slow(x: B.Big, +w: B.Big) -> R.Real:
  rscale(B.to_real(B.floor_div(B.shl(x, 12), w, 47)), 0.000000000014551915228366852)

# frac: the remainder r / w in [0, 1) (the displacement in 2^-36 mm units,
# approximate, for the report); 1 when the correction did not converge.
type RC is Data:
  RC{q: B.Big, ok: Bool, frac: F32}

# LT: remainder negative, GT: remainder >= w, EQ: 0 <= r < w.
def rstate.k(neg: Bool, below: Bool) -> Cmp:
  match neg below:
    case True{} _:
      LT{}
    case False{} True{}:
      EQ{}
    case False{} False{}:
      GT{}

def rstate(+r: B.Big, +w: B.Big) -> Cmp:
  rstate.k(B.is_neg(r), Cmp.is_lt(B.cmp(r, w)))

# Correct a quotient estimate q (remainder r = n - q w) to floor(n / w).
def rfix(fuel: Nat, c: Cmp, +q: B.Big, +r: B.Big, +w: B.Big) -> RC:
  match fuel:
    case 0n:
      RC{q, Cmp.is_eq(c), 1.0}
    case 1n+f:
      match c:
        case EQ{}:
          RC{q, True{}, F32.min(R.approx(R.div(B.to_real(r), B.to_real(w))), 1.0)}
        case LT{}:
          +r2 = B.add(r, w)
          rfix(f, rstate(r2, w), B.sub(q, B.one()), r2, w)
        case GT{}:
          +r2 = B.sub(r, w)
          rfix(f, rstate(r2, w), B.add(q, B.one()), r2, w)

# The same floor, from a float estimate of the quotient plus exact correction.
def round_coord(x: B.Big, +w: B.Big, fx: R.Real, fw: R.Real) -> RC:
  +q0 = scaled_int(R.div(fx, fw), 4096.0)
  +r0 = B.sub(B.shl(x, 12), B.mul(q0, w))
  rfix(16n, rstate(r0, w), q0, r0, w)

def rc_real(c: RC) -> R.Real:
  RC{q, _, _} = c
  rscale(B.to_real(q), 0.000000000014551915228366852)

def rc_ok(c: RC) -> Bool:
  RC{_, ok, _} = c
  ok

def rc_frac(c: RC) -> F32:
  RC{_, _, f} = c
  f

# disp: the largest per-coordinate rounding displacement (mm, approximate).
type RVX is Data:
  RVX{r: G.Vec3, ok: Bool, disp: F32}

def round_vertex.k(+cx: RC, +cy: RC, +cz: RC) -> RVX:
  RVX{G.V3{rc_real(cx), rc_real(cy), rc_real(cz)}, Bool.and(rc_ok(cx), Bool.and(rc_ok(cy), rc_ok(cz))), (F32.max(rc_frac(cx), F32.max(rc_frac(cy), rc_frac(cz))) * 0.000000000014551915228366852 : F32)}

def round_vertex.slow(v: Vtx) -> RVX:
  Vtx{x, y, z, +w, fx, fy, fz, +fw, _, _, _} = v
  round_vertex.k(round_coord(x, w, fx, fw), round_coord(y, w, fy, fw), round_coord(z, w, fz, fw))

# A grid point (W = 1): X 2^-24 mm is exact in F32x2 (|X| < 2^35) and equals
# floor(X 2^12 / 1) 2^-36, so the result is bit-identical to the general path.
def round_vertex.grid(v: Vtx) -> RVX:
  Vtx{x, y, z, _, _, _, _, _, _, _, _} = v
  RVX{G.V3{rscale(B.to_real(x), 0.000000059604644775390625), rscale(B.to_real(y), 0.000000059604644775390625), rscale(B.to_real(z), 0.000000059604644775390625)}, True{}, 0.0}

def round_vertex.pick(grid: Bool, +v: Vtx) -> RVX:
  match grid:
    case True{}:
      round_vertex.grid(v)
    case False{}:
      round_vertex.slow(v)

def w_is_one(v: Vtx) -> Bool:
  Vtx{_, _, _, w, _, _, _, _, _, _, _} = v
  B.eq(w, B.one())

def round_vertex(+v: Vtx) -> RVX:
  round_vertex.pick(w_is_one(v), v)

# Approximate grid coordinates (F32, relative error ~1e-7) for bounding boxes.
def hi_of(r: R.Real) -> F32:
  R.Real{hi, _} = r
  hi

def approx_u.pick(k: U32, fx: R.Real, fy: R.Real, fz: R.Real, +w: F32) -> F32:
  match k:
    case 0:
      (hi_of(fx) / w : F32)
    case 1:
      (hi_of(fy) / w : F32)
    case _:
      (hi_of(fz) / w : F32)

def approx_u(v: Vtx, +k: U32) -> F32:
  Vtx{_, _, _, _, fx, fy, fz, fw, _, _, _} = v
  approx_u.pick(k, fx, fy, fz, hi_of(fw))

# Component k of a plane normal.
def normal_k.pick(k: U32, a: B.Big, b: B.Big, c: B.Big) -> B.Big:
  match k:
    case 0:
      a
    case 1:
      b
    case _:
      c

def normal_k(p: Plane, k: U32) -> B.Big:
  Plane{a, b, c, _, _, _, _, _, _} = p
  normal_k.pick(k, a, b, c)

# Real grid coordinate k of a vertex (X_k / W).
def coord_real.pick(k: U32, fx: R.Real, fy: R.Real, fz: R.Real) -> R.Real:
  match k:
    case 0:
      fx
    case 1:
      fy
    case _:
      fz

def coord_real(v: Vtx, k: U32) -> R.Real:
  Vtx{_, _, _, _, fx, fy, fz, fw, _, _, _} = v
  R.div(coord_real.pick(k, fx, fy, fz), fw)
