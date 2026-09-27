import Base
import ../../real.bend as R
import ../../precise.bend as G

# corefine: small shared helpers (signed words, Real/Vec3 accessors, F32
# normals, list and array utilities, a fuel-bounded step loop).
#
# Signed integers are U32 words read as two's complement (U32 arithmetic
# wraps), used for the small winding / crossing counts of the Boolean.

def ineg(x: U32) -> U32:
  (0 - x : U32)

def is_neg(x: U32) -> Bool:
  U32.is_ge(x, 2147483648)

def is_zero(x: U32) -> Bool:
  U32.is_eq(x, 0)

def nonzero(x: U32) -> Bool:
  U32.is_ne(x, 0)

def iabs(+x: U32) -> U32:
  Bool.pick(U32, is_neg(x), ineg(x), x)

# x or -x
def negate_if(neg: Bool, +x: U32) -> U32:
  Bool.pick(U32, neg, ineg(x), x)

def b2u(b: Bool) -> U32:
  Bool.pick(U32, b, 1, 0)

# --- Real / Vec3 ---------------------------------------------------------------

def rzero() -> R.Real:
  R.from_f32(0.0)

def vx(v: G.Vec3) -> R.Real:
  G.V3{x, _, _} = v
  x

def vy(v: G.Vec3) -> R.Real:
  G.V3{_, y, _} = v
  y

def vz(v: G.Vec3) -> R.Real:
  G.V3{_, _, z} = v
  z

def rpick(c: Bool, a: R.Real, b: R.Real) -> R.Real:
  match c:
    case True{}:
      a
    case False{}:
      b

def vpick(c: Bool, a: G.Vec3, b: G.Vec3) -> G.Vec3:
  match c:
    case True{}:
      a
    case False{}:
      b

def rabs_lt(+a: R.Real, +b: R.Real) -> Bool:
  R.less(R.abs(a), R.abs(b))

def ris_zero(a: R.Real) -> Bool:
  R.Real{hi, _} = a
  F32.is_eq(hi, 0.0)

# `p < q` with the symbolic tie-break `dir < 0` when p == q exactly
# (Manifold shared.h Shadows). Reals are canonical (hi = fl(hi + lo)), so the
# lexicographic comparison of (hi, lo) is exact.
def shadows.if(eq: Bool, lt: Bool, dir: F32) -> Bool:
  match eq:
    case True{}:
      (dir < 0.0 : F32)
    case False{}:
      lt

def shadows(+p: R.Real, +q: R.Real, dir: F32) -> Bool:
  shadows.if(R.equal(p, q), R.less(p, q), dir)

# Carrier unification (unify.bend, plan step 4): |p - q| <= tz, only asked
# when the two compared elements touch a common unified plane class.
def near.if(rel: Bool, +p: R.Real, +q: R.Real, +tz: F32) -> Bool:
  match rel:
    case True{}:
      (F32.abs(R.approx(R.sub(p, q))) <= tz : F32)
    case False{}:
      False{}

# shadows, where a comparison of two elements that touch a common unified
# plane class and differ by at most tz counts as an exact tie (the symbolic
# tie-break decides, as for exactly coplanar input). rel is False whenever the
# job has no unified class, and then this is shadows.
def shadows_u(+p: R.Real, +q: R.Real, dir: F32, rel: Bool, +tz: F32) -> Bool:
  shadows.if(Bool.or(R.equal(p, q), near.if(rel, p, q, tz)), R.less(p, q), dir)

def with_sign(pos: Bool, +v: F32) -> F32:
  Bool.pick(F32, pos, v, F32.neg(v))

# --- F32 directions (tie-break only) -------------------------------------------

type N3 is Data:
  N3{x: F32, y: F32, z: F32}

def n3zero() -> N3:
  N3{0.0, 0.0, 0.0}

def nx(n: N3) -> F32:
  N3{x, _, _} = n
  x

def ny(n: N3) -> F32:
  N3{_, y, _} = n
  y

def nz(n: N3) -> F32:
  N3{_, _, z} = n
  z

def nadd(a: N3, b: N3) -> N3:
  N3{ax, ay, az} = a
  N3{bx, by, bz} = b
  N3{(ax + bx : F32), (ay + by : F32), (az + bz : F32)}

def nneg(a: N3) -> N3:
  N3{x, y, z} = a
  N3{F32.neg(x), F32.neg(y), F32.neg(z)}

def nscale.len(+x: F32, +y: F32, +z: F32, +l: F32) -> N3:
  Bool.pick(N3, (l > 0.0 : F32), N3{(x / l : F32), (y / l : F32), (z / l : F32)}, N3{0.0, 0.0, 0.0})

def nnormalize(a: N3) -> N3:
  N3{+x, +y, +z} = a
  nscale.len(x, y, z, F32.sqrt((x * x + y * y + z * z : F32)))

# Unnormalized (area-weighted) normal of a triangle, from the Real positions.
def tri_cross(+a: G.Vec3, b: G.Vec3, c: G.Vec3) -> N3:
  +c = G.cross(G.sub(b, a), G.sub(c, a))
  N3{R.approx(vx(c)), R.approx(vy(c)), R.approx(vz(c))}

# --- lists ----------------------------------------------------------------------

def len.go(-A: Data, xs: List<&2, A>, acc: U32) -> U32:
  match xs:
    case Nil{}:
      acc
    case _ <> t:
      len.go(A, t, (acc + 1 : U32))

def len(-A: Data, xs: List<&2, A>) -> U32:
  len.go(A, xs, 0)

def rev_onto(-A: Data, xs: List<&2, A>, acc: List<&2, A>) -> List<&2, A>:
  match xs:
    case Nil{}:
      acc
    case h <> t:
      rev_onto(A, t, h <> acc)

def rev(-A: Data, xs: List<&2, A>) -> List<&2, A>:
  rev_onto(A, xs, Nil{})

# xs ++ ys without stack growth (xs reversed twice).
def cat(-A: Data, xs: List<&2, A>, ys: List<&2, A>) -> List<&2, A>:
  rev_onto(A, rev(A, xs), ys)

# First n elements (in order) and the rest.
def split.go(-A: Data, n: Nat, xs: List<&2, A>, acc: List<&2, A>) -> List<&2, A> & List<&2, A>:
  match n xs:
    case 0n _:
      (rev(A, acc), xs)
    case 1n+p Nil{}:
      (rev(A, acc), Nil{})
    case 1n+p h <> t:
      split.go(A, p, t, h <> acc)

def split(-A: Data, n: Nat, xs: List<&2, A>) -> List<&2, A> & List<&2, A>:
  split.go(A, n, xs, Nil{})

# Smallest d with 2^d >= n (arrays hold 2^d slots).
def depth.go(fuel: Nat, ge: Bool, +n: U32, d: Nat, +cap: U32) -> Nat:
  match fuel ge:
    case 0n _:
      d
    case _ True{}:
      d
    case 1n+p False{}:
      +c2 = U32.shl(cap)
      depth.go(p, U32.is_ge(c2, n), n, 1n+d, c2)

def depth(+n: U32) -> Nat:
  depth.go(32n, U32.is_ge(1, n), n, 0n, 1)

# Array of the list elements at 0.. (2^depth slots, filler `z`).
def array_of.go(~A: Data, xs: List<&2, A>, a: Array<A>, +i: U32) -> Array<A>:
  match xs:
    case Nil{}:
      a
    case h <> t:
      array_of.go(~A, t, Array.set(A, a, i, h), (i + 1 : U32))

def array_of(~A: Data, +n: U32, xs: List<&2, A>, +z: A) -> Array<A>:
  array_of.go(~A, xs, Array.new(A, depth(n), z), 0)

# The list [a[0], ..., a[n-1]]: walks down from the pair (a, a[i]).
def list_of.go(~A: Data, n: Nat, r: Array<A> & A, +i: U32, acc: List<&2, A>) -> List<&2, A>:
  match n:
    case 0n:
      (_, x) = r
      x <> acc
    case 1n+p:
      (a, x) = r
      +j = (i - 1 : U32)
      list_of.go(~A, p, Array.get(A, a, j), j, x <> acc)

def list_of.if(~A: Data, empty: Bool, +n: U32, a: Array<A>) -> List<&2, A>:
  match empty:
    case True{}:
      Nil{}
    case False{}:
      +last = (n - 1 : U32)
      list_of.go(~A, U32.to_nat(last), Array.get(A, a, last), last, Nil{})

def list_of(~A: Data, +n: U32, a: Array<A>) -> List<&2, A>:
  list_of.if(~A, U32.is_eq(n, 0), n, a)

# --- read-only lookup tables -------------------------------------------------------
# A complete binary tree over 2^d slots, built once, read many times without
# threading ownership (Arrays are affine). Missing slots are TNil.

type Tab<-A: Data> is Data:
  TNil{}
  TLeaf{x: A}
  TNode{l: Tab<A>, r: Tab<A>}

def tab.leaves(-A: Data, xs: List<&2, A>, acc: List<&2, Tab<A>>) -> List<&2, Tab<A>>:
  match xs:
    case Nil{}:
      rev(Tab<A>, acc)
    case h <> t:
      tab.leaves(A, t, TLeaf{h} <> acc)

def tab.pairs(-A: Data, xs: List<&2, Tab<A>>, acc: List<&2, Tab<A>>) -> List<&2, Tab<A>>:
  match xs:
    case Nil{}:
      rev(Tab<A>, acc)
    case a <> Nil{}:
      rev(Tab<A>, TNode{a, TNil{}} <> acc)
    case a <> b <> t:
      tab.pairs(A, t, TNode{a, b} <> acc)

def tab.levels(-A: Data, d: Nat, xs: List<&2, Tab<A>>) -> Tab<A>:
  match d xs:
    case _ Nil{}:
      TNil{}
    case 0n t <> _:
      t
    case 1n+p _:
      tab.levels(A, p, tab.pairs(A, xs, Nil{}))

type Table<-A: Data> is Data:
  Table{d: Nat, t: Tab<A>}

def table(-A: Data, +n: U32, xs: List<&2, A>) -> Table<A>:
  +d = depth(n)
  Table{d, tab.levels(A, d, tab.leaves(A, xs, Nil{}))}

def tget.go(-A: Data, t: Tab<A>, right: Bool, +i: U32, +mask: U32, +z: A) -> A:
  match t right:
    case TNil{} _:
      z
    case TLeaf{x} _:
      x
    case TNode{_, r} True{}:
      +m = U32.shr(mask)
      tget.go(A, r, nonzero(U32.and(i, m)), i, m, z)
    case TNode{l, _} False{}:
      +m = U32.shr(mask)
      tget.go(A, l, nonzero(U32.and(i, m)), i, m, z)

def tget(-A: Data, tb: Table<A>, +i: U32, +z: A) -> A:
  Table{d, t} = tb
  +mask = U32.shln(1, Nat.sub(d, 1n))
  tget.go(A, t, nonzero(U32.and(i, mask)), i, mask, z)

# --- fuel-bounded state loop -----------------------------------------------------------

type Step<-S: Type> is Type:
  CfMore{s: S}
  CfDone{s: S}

def loop(~S: Type, ~step: S -> Step<S>, fuel: Nat, st: Step<S>) -> S:
  match fuel st:
    case _ CfDone{s}:
      s
    case 0n CfMore{s}:
      s
    case 1n+p CfMore{s}:
      loop(~S, ~step, p, step(s))

def cons_if(-A: Data, c: Bool, x: A, acc: List<&2, A>) -> List<&2, A>:
  match c:
    case True{}:
      x <> acc
    case False{}:
      acc

# --- double-representable Reals ---------------------------------------------------
# A computed Real (hi, lo) may carry bits of lo below the last bit a double
# can hold next to hi (2^(e - 52), e the exponent of hi); the wire reader and
# the oracles add hi + lo in double precision. snap rounds lo to that grid by
# a Veltkamp split (c = 2^s + 1, t = c lo, lo' = t - (t - lo), exact IEEE
# operations, identical on every target), then renormalizes, so hi + lo is a
# double and equal Reals are equal doubles. The change is below 2^-52
# relative, far below the arithmetic error of the construction.
def f32_bits(x: U32) -> F32:
  match x:
    case U32{w}:
      F32{w}

def bexp(+x: F32) -> U32:
  U32.and(U32.shrn(F32.bits(x), 23n), 255)

def snap.split(+hi: F32, +lo: F32, +s: U32) -> R.Real:
  +c = (f32_bits(U32.shln((s + 127 : U32), 23n)) + 1.0 : F32)
  +t = (c * lo : F32)
  R.renorm(hi, (t - (t - lo) : F32))

def snap.go(keep: Bool, drop: Bool, +hi: F32, +lo: F32, +s: U32) -> R.Real:
  match keep:
    case True{}:
      R.Real{hi, lo}
    case False{}:
      match drop:
        case True{}:
          R.Real{hi, 0.0}
        case False{}:
          snap.split(hi, lo, s)

def snap(r: R.Real) -> R.Real:
  R.Real{+hi, +lo} = r
  +e = bexp(hi)
  +f = bexp(lo)
  snap.go(Bool.or(F32.is_eq(lo, 0.0), U32.is_le(e, (f + 29 : U32))), U32.is_ge(e, (f + 53 : U32)), hi, lo, (e - f - 29 : U32))

def vsnap(v: G.Vec3) -> G.Vec3:
  G.V3{x, y, z} = v
  G.V3{snap(x), snap(y), snap(z)}

# --- stack-safe merge sort -----------------------------------------------------------
# Base's List.sort recurses non-tail over the list (too deep for the JS
# target on 10^5 elements). Bottom-up merge sort, every loop tail-recursive.

def msort.runs(-A: Data, xs: List<&2, A>, acc: List<&2, List<&2, A>>) -> List<&2, List<&2, A>>:
  match xs:
    case Nil{}:
      acc
    case h <> t:
      msort.runs(A, t, [h] <> acc)

def msort.pass(~A: Data, ~le: A -> A -> Bool, +n: Nat, runs: List<&2, List<&2, A>>, acc: List<&2, List<&2, A>>) -> List<&2, List<&2, A>>:
  match runs:
    case Nil{}:
      rev(List<&2, A>, acc)
    case r <> Nil{}:
      rev(List<&2, A>, r <> acc)
    case r1 <> r2 <> rest:
      msort.pass(~A, ~le, n, rest, List.merge.go(~A, ~le, n, (Nil{}, r1, r2)) <> acc)

def msort.go(~A: Data, ~le: A -> A -> Bool, fuel: Nat, +n: Nat, runs: List<&2, List<&2, A>>) -> List<&2, A>:
  match fuel runs:
    case _ Nil{}:
      Nil{}
    case _ r <> Nil{}:
      r
    case 0n _:
      List.concat(&2, A, runs)
    case 1n+f _:
      msort.go(~A, ~le, f, n, msort.pass(~A, ~le, n, runs, Nil{}))

def sort_seq(~A: Data, ~le: A -> A -> Bool, +xs: List<&2, A>) -> List<&2, A>:
  +n = U32.to_nat(len(A, xs))
  msort.go(~A, ~le, 64n, n, msort.runs(A, xs, Nil{}))

# Parallel stable merge sort: lists of 4096 or more are split in halves that
# are sorted in a parallel let (up to 2^6 leaves) and merged. A stable sort's
# output is unique for a total preorder, so the result is the same as
# sort_seq's on every target.
type Halves<-A: Data> is Data:
  Halves{l: List<&2, A>, r: List<&2, A>}

def halves(-A: Data, p: List<&2, A> & List<&2, A>) -> Halves<A>:
  (l, r) = p
  Halves{l, r}

def halves_l(-A: Data, h: Halves<A>) -> List<&2, A>:
  Halves{l, _} = h
  l

def halves_r(-A: Data, h: Halves<A>) -> List<&2, A>:
  Halves{_, r} = h
  r

def psort.go(~A: Data, ~le: A -> A -> Bool, d: Nat, big: Bool, +n: U32, xs: List<&2, A>) -> List<&2, A>:
  match d big:
    case _ False{}:
      sort_seq(~A, ~le, xs)
    case 0n _:
      sort_seq(~A, ~le, xs)
    case 1n+p True{}:
      +q = p
      +h = U32.div(n, 2)
      +m = (n - h : U32)
      +hs = halves(A, split(A, U32.to_nat(h), xs))
      a b = psort.go(~A, ~le, q, U32.is_ge(h, 4096), h, halves_l(A, hs)) psort.go(~A, ~le, q, U32.is_ge(m, 4096), m, halves_r(A, hs))
      List.merge.go(~A, ~le, U32.to_nat(n), (Nil{}, a, b))

def sort(~A: Data, ~le: A -> A -> Bool, +xs: List<&2, A>) -> List<&2, A>:
  +n = len(A, xs)
  psort.go(~A, ~le, 6n, U32.is_ge(n, 4096), n, xs)
