import Base

# Utilities of the hybrid Boolean's recovery stage ("recover") (docs/proto-recover.md).
#
# Bend 2.0.25 shapes this file: a destructuring let only opens a parameter, a
# match only inspects a parameter or a pattern-bound variable, and a def may
# not recurse through another def. So:
#   - read-only random access uses Tab, an immutable balanced tree that is
#     Data (duplicable) and needs no threading, instead of Array;
#   - every loop that consumes a computed pair receives the pair as a
#     parameter of its next iteration;
#   - decisions a loop must branch on are encoded as constructors (Link, Seen)
#     so they can be matched after a destructuring let.
# All loops are tail recursive or recurse at most log2(n) deep (the JS target
# has a bounded stack).

# ---------------------------------------------------------------------------
# Tab: read-only table indexed 0..n-1, depth d = ceil(log2 n).

type Tab<a, -A: Kind(a)> is Kind(a):
  TLeaf{v: A}
  TNode{l: Tab<a, A>, r: Tab<a, A>}

def tab.first(-A: Data, t: Tab<&2, A>) -> A:
  match t:
    case TLeaf{v}:
      v
    case TNode{l, _}:
      tab.first(A, l)

# Descent by the bits of i, most significant first; the remaining depth is
# the fuel, so no path list is allocated per lookup. The next branch bit rides
# as a parameter and the def only matches and recurses (it never returns a
# subtree), so the native compiler reads the shared table by borrowing
# (term_peek) instead of counting a reference on every node it passes.
def tab.bit(+i: U32, +d: Nat) -> Bool:
  U32.is_eq(U32.and((i >> Nat.sub(d, 1n) : U32), 1), 1)

def tab.at(-A: Data, +d: Nat, t: Tab<&2, A>, +i: U32, b: Bool) -> A:
  match d t b:
    case _ TLeaf{v} _:
      v
    case 0n TNode{l, _} _:
      tab.first(A, l)
    case 1n+e TNode{_, r} True{}:
      tab.at(A, e, r, i, tab.bit(i, e))
    case 1n+e TNode{l, _} False{}:
      tab.at(A, e, l, i, tab.bit(i, e))

# Index i of a table of depth d. Indexes past n land on a duplicate of the
# last entry (callers only pass i < n).
def tab.get(-A: Data, t: Tab<&2, A>, +d: Nat, +i: U32) -> A:
  tab.at(A, d, t, i, tab.bit(i, d))

def tab.pairs(-A: Data, xs: List<&2, Tab<&2, A>>, acc: List<&2, Tab<&2, A>>) -> List<&2, Tab<&2, A>>:
  match xs:
    case Nil{}:
      List.reverse(&2, Tab<&2, A>, acc)
    case +x <> Nil{}:
      List.reverse(&2, Tab<&2, A>, TNode{x, x} <> acc)
    case x <> y <> t:
      tab.pairs(A, t, TNode{x, y} <> acc)

def tab.levels(-A: Data, d: Nat, xs: List<&2, Tab<&2, A>>, dflt: A) -> Tab<&2, A>:
  match d xs:
    case _ Nil{}:
      TLeaf{dflt}
    case 0n x <> _:
      x
    case 1n+e ys:
      tab.levels(A, e, tab.pairs(A, ys, Nil{}), dflt)

def tab.leaves(-A: Data, xs: List<&2, A>, acc: List<&2, Tab<&2, A>>) -> List<&2, Tab<&2, A>>:
  match xs:
    case Nil{}:
      List.reverse(&2, Tab<&2, A>, acc)
    case x <> t:
      tab.leaves(A, t, TLeaf{x} <> acc)

# Smallest d with 2^d >= n (0 for n <= 1).
def depth.go(fuel: Nat, +n: U32, +d: Nat, +p: U32) -> Nat:
  match fuel:
    case 0n:
      d
    case 1n+f:
      Bool.pick(Nat, (p >= n : U32), d, depth.go(f, n, 1n+d, (p * 2 : U32)))

def depth(+n: U32) -> Nat:
  depth.go(32n, n, 0n, 1)

def tab.of(-A: Data, xs: List<&2, A>, +d: Nat, dflt: A) -> Tab<&2, A>:
  tab.levels(A, d, tab.leaves(A, xs, Nil{}), dflt)

# ---------------------------------------------------------------------------
# Q: the one sortable record (two U32 keys, two U32 payloads).

type Q is Data:
  Q{k1: U32, k2: U32, p1: U32, p2: U32}

# Lexicographic on (k1, k2, p1, p2): a total order, so sorting is
# deterministic on every target.
def q.le(a: Q, b: Q) -> Bool:
  Q{+a1, +a2, +a3, a4} = a
  Q{+b1, +b2, +b3, b4} = b
  Bool.or((a1 < b1 : U32), Bool.and(U32.is_eq(a1, b1),
    Bool.or((a2 < b2 : U32), Bool.and(U32.is_eq(a2, b2),
      Bool.or((a3 < b3 : U32), Bool.and(U32.is_eq(a3, b3), (a4 <= b4 : U32)))))))

type Merge is Data:
  Merge{acc: List<&2, Q>, xs: List<&2, Q>, ys: List<&2, Q>}

def merge.step(acc: List<&2, Q>, x: Q, xt: List<&2, Q>, y: Q, yt: List<&2, Q>, le: Bool) -> Merge:
  match le:
    case True{}:
      Merge{x <> acc, xt, y <> yt}
    case False{}:
      Merge{y <> acc, x <> xt, yt}

def merge.go(fuel: Nat, st: Merge) -> List<&2, Q>:
  match fuel:
    case 0n:
      Merge{acc, xs, ys} = st
      List.reverse.go(&2, Q, acc, List.append(&2, Q, xs, ys))
    case 1n+f:
      Merge{acc, xs, ys} = st
      match xs ys:
        case Nil{} Nil{}:
          List.reverse(&2, Q, acc)
        case Nil{} y <> yt:
          List.reverse.go(&2, Q, acc, y <> yt)
        case x <> xt Nil{}:
          List.reverse.go(&2, Q, acc, x <> xt)
        case +x <> xt +y <> yt:
          merge.go(f, merge.step(acc, x, xt, y, yt, q.le(x, y)))

def merge(+n: Nat, xs: List<&2, Q>, ys: List<&2, Q>) -> List<&2, Q>:
  merge.go(n, Merge{Nil{}, xs, ys})

type Halves is Data:
  Halves{a: List<&2, Q>, b: List<&2, Q>, na: Nat, nb: Nat}

# Deal alternately into two halves (order inside a half does not matter).
def deal(xs: List<&2, Q>, a: List<&2, Q>, b: List<&2, Q>, +na: Nat, +nb: Nat) -> Halves:
  match xs:
    case Nil{}:
      Halves{a, b, na, nb}
    case x <> t:
      deal(t, b, x <> a, nb, 1n+na)

# Parallel merge sort: both halves are sorted by a simultaneous binding
# (balanced by construction), then merged tail-recursively.
def msort(+fuel: Nat, h: Halves) -> List<&2, Q>:
  match fuel:
    case 0n:
      Halves{a, b, na, nb} = h
      merge(Nat.add(na, nb), a, b)
    case 1n+f:
      Halves{a, b, +na, +nb} = h
      match a b:
        case Nil{} Nil{}:
          Nil{}
        case x <> Nil{} Nil{}:
          [x]
        case Nil{} y <> Nil{}:
          [y]
        case +x <> Nil{} +y <> Nil{}:
          Bool.pick(List<&2, Q>, q.le(x, y), [x, y], [y, x])
        case xs ys:
          sa sb = msort(f, deal(xs, Nil{}, Nil{}, 0n, 0n)) msort(f, deal(ys, Nil{}, Nil{}, 0n, 0n))
          merge(Nat.add(na, nb), sa, sb)

def sort(xs: List<&2, Q>) -> List<&2, Q>:
  msort(40n, deal(xs, Nil{}, Nil{}, 0n, 0n))

# ---------------------------------------------------------------------------
# Small list helpers.

def rev(-A: Data, xs: List<&2, A>) -> List<&2, A>:
  List.reverse(&2, A, xs)

def count(-A: Data, xs: List<&2, A>, acc: U32) -> U32:
  match xs:
    case Nil{}:
      acc
    case _ <> t:
      count(A, t, (acc + 1 : U32))

def f32max(+a: F32, +b: F32) -> F32:
  Bool.pick(F32, (a < b : F32), b, a)

# Union-find links (constructors so a read can be matched).
type Link is Data:
  Root{}
  Up{p: U32}

type Seen is Data:
  Fresh{}
  Visited{}

# ---------------------------------------------------------------------------
# Order-preserving balanced split and fork-join map. Both halves of every
# fork have equal length (+-1), the balance the scheduler relies on; the
# leaves are flat tail-recursive loops. The JS target runs it sequentially.

type Two<a, -A: Kind(a)> is Kind(a):
  Two{l: List<a, A>, r: List<a, A>, nl: Nat, nr: Nat}

def two.go(-A: Data, h: Nat, xs: List<&2, A>, acc: List<&2, A>, +nl: Nat, +nr: Nat) -> Two<&2, A>:
  match h xs:
    case 0n rest:
      Two{List.reverse(&2, A, acc), rest, nl, nr}
    case _ Nil{}:
      Two{List.reverse(&2, A, acc), Nil{}, nl, nr}
    case 1n+m x <> t:
      two.go(A, m, t, x <> acc, nl, nr)

def two(-A: Data, xs: List<&2, A>, +n: Nat) -> Two<&2, A>:
  +h = Nat.div(n, 2n)
  two.go(A, h, xs, Nil{}, h, Nat.sub(n, h))

def map.seq(~C: Data, ~A: Data, ~B: Data, ~f: C -> A -> B, +c: C, xs: List<&2, A>, acc: List<&2, B>) -> List<&2, B>:
  match xs:
    case Nil{}:
      acc
    case x <> t:
      map.seq(~C, ~A, ~B, ~f, c, t, f(c, x) <> acc)

# f mapped over l ++ r, 2^k leaves; results in order.
def par.map(~C: Data, ~A: Data, ~B: Data, ~f: C -> A -> B, +c: C, +k: Nat, p: Two<&2, A>) -> List<&2, B>:
  match k:
    case 0n:
      Two{l, r, _, _} = p
      List.reverse(&2, B, map.seq(~C, ~A, ~B, ~f, c, r, map.seq(~C, ~A, ~B, ~f, c, l, Nil{})))
    case 1n+j:
      Two{l, r, +nl, +nr} = p
      xa xb = par.map(~C, ~A, ~B, ~f, c, j, two(A, l, nl)) par.map(~C, ~A, ~B, ~f, c, j, two(A, r, nr))
      List.reverse.go(&2, B, List.reverse(&2, B, xa), xb)

# Fork depth used by the recovery stages: 2^5 = 32 leaves (>= 18 cores).
def fork_depth() -> Nat:
  5n

# ---------------------------------------------------------------------------
# Bucket sort for records whose first key is a dense id (vertex, triangle or
# patch id < 2^d): one pass into Array buckets, then each (short) bucket is
# merge-sorted and the buckets are read out in order. O(n log d) work with
# array accesses, against O(n log n) comparisons of the general sort.

def q.k1(q: Q) -> U32:
  Q{k, _, _, _} = q
  k

# st is the read of the bucket of `pending`.
def bk.fill(xs: List<&2, Q>, st: Array<List<&2, Q>> & List<&2, Q>, +pending: Q) -> Array<List<&2, Q>>:
  match xs:
    case Nil{}:
      (arr, lst) = st
      Array.set(List<&2, Q>, arr, q.k1(pending), pending <> lst)
    case +x <> t:
      (arr, lst) = st
      arr2 = Array.set(List<&2, Q>, arr, q.k1(pending), pending <> lst)
      bk.fill(t, Array.get(List<&2, Q>, arr2, q.k1(x)), x)

def bk.bucket(xs: List<&2, Q>, acc: List<&2, Q>) -> List<&2, Q>:
  match xs:
    case Nil{}:
      acc
    case x <> Nil{}:
      x <> acc
    case _:
      List.reverse.go(&2, Q, List.reverse(&2, Q, sort(xs)), acc)

def bk.flat(a: Array<List<&2, Q>>, acc: List<&2, Q>) -> List<&2, Q>:
  match a:
    case ALeaf{xs}:
      bk.bucket(xs, acc)
    case ANode{l, r}:
      bk.flat(l, bk.flat(r, acc))

def bsort(xs: List<&2, Q>, +d: Nat) -> List<&2, Q>:
  match xs:
    case Nil{}:
      Nil{}
    case +x <> t:
      +empty = {Nil{} : List<&2, Q>}
      bk.flat(bk.fill(t, Array.get(List<&2, Q>, Array.new(List<&2, Q>, d, empty), q.k1(x)), x), Nil{})
