import Base
import ../../real.bend as R
import ./geom.bend as E
import ./setup.bend as S

# The device kernel of the exact-plane prototype: a certified pair filter.
#
# For every candidate pair (t, b) of triangles of different leaves (boxes
# meet), the kernel evaluates the float filter of the plane-side predicate
# (the same F32x2 formula and error bound as geom.side.filtered) for
#   - the three corners of b against t's support plane, and
#   - the three corners of t against b's support plane.
# If either triple is certified strictly on one side, t and b are disjoint
# (closed sets): b cannot cut t and cannot touch it. Such pairs are dropped
# before the exact arrangement; every other pair keeps going through the
# exact path unchanged. The filter never certifies a zero, so a dropped pair
# is never a touching or coplanar one. Dropping is only a shortcut: the
# exact path would find the same pieces (a disjoint b never splits t), so the
# result is identical whether or not a pair is dropped.
#
# The data is flat F32 (hi, lo words of the F32x2 approximations that the
# host already carries): no Big integers, no lists of records inside a pair,
# so the kernel is fixed-size float arithmetic in flat loops (SHADERS.md).
# Corners are input grid points (W = 1, coordinates exact in F32x2).
#
# Codes per pair: 0 = keep (not certified), 1 = disjoint.

# A triangle for the device: support plane (a, b, c, d) and three corners.
type FT is Data:
  FT{ah: F32, al: F32, bh: F32, bl: F32, ch: F32, cl: F32, dh: F32, dl: F32, x0h: F32, x0l: F32, y0h: F32, y0l: F32, z0h: F32, z0l: F32, x1h: F32, x1l: F32, y1h: F32, y1l: F32, z1h: F32, z1l: F32, x2h: F32, x2l: F32, y2h: F32, y2l: F32, z2h: F32, z2l: F32}

# One triangle's job: the triangle and its candidates (in candidate order).
type DJ is Data:
  DJ{t: FT, cs: List<&2, FT>}

# Balanced trees of jobs and of their answers (same shape).
type DT is Data:
  DL{xs: List<&2, DJ>}
  DN{l: DT, r: DT}

type FR is Data:
  FL{xs: List<&2, List<&2, U32>>, np: U32, nd: U32}
  FN{l: FR, r: FR}

# --- device side ------------------------------------------------------------------

def word(c: Bool, +a: U32, +b: U32) -> U32:
  match c:
    case True{}:
      a
    case False{}:
      b

def habs(+x: F32) -> F32:
  F32.abs(x)

# Filtered sign of a x + b y + c z + d (W = 1): 1 negative, 2 positive,
# 0 not certified. Identical arithmetic and bound to geom.side.filtered.
def fside(+ah: F32, +al: F32, +bh: F32, +bl: F32, +ch: F32, +cl: F32, +dh: F32, +dl: F32, +xh: F32, +xl: F32, +yh: F32, +yl: F32, +zh: F32, +zl: F32) -> U32:
  +ta = R.mul(R.Real{ah, al}, R.Real{xh, xl})
  +tb = R.mul(R.Real{bh, bl}, R.Real{yh, yl})
  +tc = R.mul(R.Real{ch, cl}, R.Real{zh, zl})
  +td = R.mul(R.Real{dh, dl}, R.Real{1.0, 0.0})
  +f = R.approx(R.add(R.add(ta, tb), R.add(tc, td)))
  m = (E.rabs_hi(ta) + E.rabs_hi(tb) + E.rabs_hi(tc) + E.rabs_hi(td) : F32)
  s = (habs(ah) + habs(bh) + habs(ch) + habs(dh) + habs(xh) + habs(yh) + habs(zh) + 1.0 : F32)
  e = (m * 0.0000000000009094947017729282 + s * 0.00000000000005684341886080802 + 0.0000000000000000000000000001 : F32)
  word((F32.abs(f) > e : F32), word((f < 0.0 : F32), 1, 2), 0)

def one_side(+s0: U32, +s1: U32, +s2: U32) -> Bool:
  Bool.and(U32.is_ne(s0, 0), Bool.and(U32.is_eq(s0, s1), U32.is_eq(s1, s2)))

# Corners of q against the plane of p, certified on one side.
def apart(p: FT, q: FT) -> Bool:
  FT{+ah, +al, +bh, +bl, +ch, +cl, +dh, +dl, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _} = p
  FT{_, _, _, _, _, _, _, _, x0h, x0l, y0h, y0l, z0h, z0l, x1h, x1l, y1h, y1l, z1h, z1l, x2h, x2l, y2h, y2l, z2h, z2l} = q
  one_side(fside(ah, al, bh, bl, ch, cl, dh, dl, x0h, x0l, y0h, y0l, z0h, z0l), fside(ah, al, bh, bl, ch, cl, dh, dl, x1h, x1l, y1h, y1l, z1h, z1l), fside(ah, al, bh, bl, ch, cl, dh, dl, x2h, x2l, y2h, y2l, z2h, z2l))

def code(+t: FT, +b: FT) -> U32:
  word(Bool.or(apart(t, b), apart(b, t)), 1, 0)

# Codes of one job in candidate order, with the pair and disjoint counts.
type CS is Data:
  CS{xs: List<&2, U32>, np: U32, nd: U32}

def codes(+t: FT, cs: List<&2, FT>, acc: List<&2, U32>, +np: U32, +nd: U32) -> CS:
  match cs:
    case Nil{}:
      CS{List.reverse(&2, U32, acc), np, nd}
    case +b <> rest:
      +c = code(t, b)
      codes(t, rest, c <> acc, (np + 1 : U32), (nd + c : U32))

# Per job, reversed.
def jobs(xs: List<&2, DJ>, acc: List<&2, CS>) -> List<&2, CS>:
  match xs:
    case Nil{}:
      acc
    case DJ{+t, cs} <> rest:
      jobs(rest, codes(t, cs, Nil{}, 0, 0) <> acc)

# Back into job order, summing the counters.
def leaf(js: List<&2, CS>, acc: List<&2, List<&2, U32>>, +np: U32, +nd: U32) -> FR:
  match js:
    case Nil{}:
      FL{acc, np, nd}
    case CS{ys, +a, +b} <> rest:
      leaf(rest, ys <> acc, (np + a : U32), (nd + b : U32))

# The fork tree: the Metal build runs it as one device pass (main.dev).
def dmap(t: DT) -> FR:
  match t:
    case DL{xs}:
      leaf(jobs(xs, Nil{}), Nil{}, 0, 0)
    case DN{l, r}:
      a b = dmap(l) dmap(r)
      FN{a, b}

# --- host side: flat records from plane-based triangles ------------------------------

def rh(r: R.Real) -> F32:
  R.Real{h, _} = r
  h

def rl(r: R.Real) -> F32:
  R.Real{_, l} = r
  l

def ft_of.k(p: E.Plane, v0: E.Vtx, v1: E.Vtx, v2: E.Vtx) -> FT:
  E.Plane{_, _, _, _, +a, +b, +c, +d, _} = p
  E.Vtx{_, _, _, _, +x0, +y0, +z0, _, _, _, _} = v0
  E.Vtx{_, _, _, _, +x1, +y1, +z1, _, _, _, _} = v1
  E.Vtx{_, _, _, _, +x2, +y2, +z2, _, _, _, _} = v2
  FT{rh(a), rl(a), rh(b), rl(b), rh(c), rl(c), rh(d), rl(d), rh(x0), rl(x0), rh(y0), rl(y0), rh(z0), rl(z0), rh(x1), rl(x1), rh(y1), rl(y1), rh(z1), rl(z1), rh(x2), rl(x2), rh(y2), rl(y2), rh(z2), rl(z2)}

def ft_of(t: S.TriI) -> FT:
  S.TriI{_, _, _, _, s, _, _, _, v0, v1, v2, _, _} = t
  ft_of.k(s, v0, v1, v2)

def fts_of(cs: List<&2, S.TriI>, acc: List<&2, FT>) -> List<&2, FT>:
  match cs:
    case Nil{}:
      List.reverse(&2, FT, acc)
    case +c <> rest:
      fts_of(rest, ft_of(c) <> acc)

def dj_of(+t: S.TriI, +cs: List<&2, S.TriI>) -> DJ:
  DJ{ft_of(t), fts_of(cs, Nil{})}
