import Base
import ../../real.bend as R
import ../../precise.bend as G
import ./util.bend as U
import ./assemble.bend as A
import ./inter.bend as I

# corefine: exact welding of the output polygon mesh.
#
# Degenerate inputs (coplanar faces, edges through vertices or edges, shared
# vertices) make the symbolic perturbation produce distinct output vertices at
# exactly the same position, joined by zero-length edges, and faces that
# collapse to zero-width 2-gons. Positions are exact copies or deterministic
# computations, so equal positions are equal Real pairs. Welding them changes
# no coordinate:
#   1. every vertex is mapped to the smallest vertex index at its exact
#      position;
#   2. halfedges that became zero-length are dropped;
#   3. inside one face, a halfedge a->b and a halfedge b->a cancel (a 2-gon or a
#      spike of zero area);
#   4. the result must still pair every directed edge with exactly one
#      opposite directed edge; otherwise the weld is refused.
# This is the exact-position counterpart of Manifold's CollapseEdge /
# RemoveDegenerates for zero-length edges.

# Exact position keys: the IEEE bits of hi and lo of x, y, z (-0 is read as
# +0, the way a double comparison sees it). Reals are canonical, so equal
# positions have equal keys.
type WV is Data:
  WV{k0: U32, k1: U32, k2: U32, k3: U32, k4: U32, k5: U32, id: U32}

def kb(+x: F32) -> U32:
  F32.bits((x + 0.0 : F32))

def wv_of(+i: U32, v: G.Vec3) -> WV:
  G.V3{x, y, z} = v
  R.Real{xh, xl} = x
  R.Real{yh, yl} = y
  R.Real{zh, zl} = z
  WV{kb(xh), kb(xl), kb(yh), kb(yl), kb(zh), kb(zl), i}

def k_lt(+a: U32, +b: U32, +rest: Bool) -> Bool:
  Bool.or(U32.is_lt(a, b), Bool.and(U32.is_eq(a, b), rest))

def wv_le(a: WV, b: WV) -> Bool:
  WV{+a0, +a1, +a2, +a3, +a4, +a5, ai} = a
  WV{+b0, +b1, +b2, +b3, +b4, +b5, bi} = b
  k_lt(a0, b0, k_lt(a1, b1, k_lt(a2, b2, k_lt(a3, b3, k_lt(a4, b4, k_lt(a5, b5, U32.is_le(ai, bi)))))))

def same_k(a: WV, b: WV) -> Bool:
  WV{a0, a1, a2, a3, a4, a5, _} = a
  WV{b0, b1, b2, b3, b4, b5, _} = b
  Bool.and(Bool.and(U32.is_eq(a0, b0), Bool.and(U32.is_eq(a1, b1), U32.is_eq(a2, b2))), Bool.and(U32.is_eq(a3, b3), Bool.and(U32.is_eq(a4, b4), U32.is_eq(a5, b5))))

def wvs(vs: List<&2, G.Vec3>, +i: U32, acc: List<&2, WV>) -> List<&2, WV>:
  match vs:
    case Nil{}:
      acc
    case v <> t:
      wvs(t, (i + 1 : U32), wv_of(i, v) <> acc)

def wv_id(w: WV) -> U32:
  WV{_, _, _, _, _, _, i} = w
  i

# Canonical index of each vertex, in sorted order: (id, canonical id).
type CS is Data:
  CS{cid: U32, ck: WV, any: Bool, acc: List<&2, A.FH>}

def canon.step(+x: WV, st: CS) -> CS:
  CS{+cid, +ck, any, acc} = st
  +same = same_k(x, ck)
  +i = wv_id(x)
  +c = Bool.pick(U32, same, cid, i)
  CS{c, Bool.pick(WV, same, ck, x), Bool.or(any, same), A.FH{0, i, c} <> acc}

def canon.go(xs: List<&2, WV>, st: CS) -> CS:
  match xs:
    case Nil{}:
      st
    case x <> t:
      canon.go(t, canon.step(x, st))

def canon.fill(xs: List<&2, A.FH>, a: Array<U32>) -> Array<U32>:
  match xs:
    case Nil{}:
      a
    case A.FH{_, i, c} <> t:
      canon.fill(t, Array.set(U32, a, i, c))

type Canon is Data:
  Canon{any: Bool, t: U.Table<U32>}

def canon.fin(st: CS, +n: U32) -> Canon:
  CS{_, _, any, acc} = st
  Canon{any, U.table(U32, n, U.list_of(~U32, n, canon.fill(acc, Array.new(U32, U.depth(n), 0))))}

# canonical[i] = smallest index at the exact position of vertex i; any: some
# vertex was renamed.
def canonical(+vs: List<&2, G.Vec3>) -> Canon:
  +n = U.len(G.Vec3, vs)
  canon.fin(canon.go(U.sort(~WV, ~wv_le, wvs(vs, 0, Nil{})), CS{4294967295, WV{1, 1, 1, 1, 1, 1, 4294967295}, False{}, Nil{}}), n)

def rewrite(fs: List<&2, A.FH>, +cn: U.Table<U32>, acc: List<&2, A.FH>) -> List<&2, A.FH>:
  match fs:
    case Nil{}:
      acc
    case A.FH{f, s, e} <> t:
      +s2 = U.tget(U32, cn, s, 0)
      +e2 = U.tget(U32, cn, e, 0)
      rewrite(t, cn, U.cons_if(A.FH, U32.is_ne(s2, e2), A.FH{f, s2, e2}, acc))

# Sort key (face, lo, hi, dir) to find opposite halfedges in one face.
def fk_le(a: A.FH, b: A.FH) -> Bool:
  A.FH{+af, +as, +ae} = a
  A.FH{+bf, +bs, +be} = b
  +alo = U32.min(as, ae)
  +ahi = U32.max(as, ae)
  +blo = U32.min(bs, be)
  +bhi = U32.max(bs, be)
  Bool.or(U32.is_lt(af, bf), Bool.and(U32.is_eq(af, bf), Bool.or(U32.is_lt(alo, blo), Bool.and(U32.is_eq(alo, blo), Bool.or(U32.is_lt(ahi, bhi), Bool.and(U32.is_eq(ahi, bhi), U32.is_le(as, bs)))))))

def opposite(a: A.FH, b: A.FH) -> Bool:
  A.FH{af, as, ae} = a
  A.FH{bf, bs, be} = b
  Bool.and(U32.is_eq(af, bf), Bool.and(U32.is_eq(as, be), U32.is_eq(ae, bs)))

def cancel.push(+x: A.FH, stack: List<&2, A.FH>) -> List<&2, A.FH>:
  match stack:
    case Nil{}:
      [x]
    case +y <> +rest:
      Bool.pick(List<&2, A.FH>, opposite(x, y), rest, x <> y <> rest)

# In a sorted run, drop adjacent opposite pairs (a stack keeps it linear).
def cancel(xs: List<&2, A.FH>, stack: List<&2, A.FH>) -> List<&2, A.FH>:
  match xs:
    case Nil{}:
      stack
    case +x <> t:
      cancel(t, cancel.push(x, stack))


# Global pairing check: sorted by (lo, hi, s), every undirected edge must be
# exactly one halfedge each way.
def gk_le(a: A.FH, b: A.FH) -> Bool:
  A.FH{_, +as, +ae} = a
  A.FH{_, +bs, +be} = b
  +alo = U32.min(as, ae)
  +ahi = U32.max(as, ae)
  +blo = U32.min(bs, be)
  +bhi = U32.max(bs, be)
  Bool.or(U32.is_lt(alo, blo), Bool.and(U32.is_eq(alo, blo), Bool.or(U32.is_lt(ahi, bhi), Bool.and(U32.is_eq(ahi, bhi), U32.is_le(as, bs)))))

def paired.go(xs: List<&2, A.FH>, ok: Bool) -> Bool:
  match xs ok:
    case _ False{}:
      False{}
    case Nil{} True{}:
      True{}
    case _ <> Nil{} True{}:
      False{}
    case A.FH{_, as, ae} <> A.FH{_, bs, be} <> t True{}:
      paired.go(t, Bool.and(U32.is_eq(as, be), U32.is_eq(ae, bs)))

def paired(xs: List<&2, A.FH>) -> Bool:
  paired.go(U.sort(~A.FH, ~gk_le, xs), True{})

type Welded is Data:
  Welded{changed: Bool, fh: List<&2, A.FH>}

# --- short-edge collapse (Manifold RemoveDegenerates / CollapseEdge) --------------
# Two constructions of one geometric point (an edge of P crossing an edge of
# Q is found once as P-edge x Q-face and once as Q-edge x P-face) round
# differently in the last bits and leave an edge of length ~1e-14 mm. Edges
# shorter than eps = 2^-36 * (largest coordinate) are collapsed into their
# lower-numbered endpoint (input vertices are numbered first, so they never
# move); every other vertex keeps its position. The collapse is again a
# rename of vertices followed by the checks of the exact weld.

def maxabs(vs: List<&2, G.Vec3>, acc: F32) -> F32:
  match vs:
    case Nil{}:
      acc
    case G.V3{x, y, z} <> t:
      maxabs(t, F32.max(acc, F32.max(F32.abs(R.approx(x)), F32.max(F32.abs(R.approx(y)), F32.abs(R.approx(z))))))

# The halfedges shorter than eps (eps2 = eps^2): one per undirected edge
# (s < e), or with both every short halfedge (the repair rounds, whose
# halfedges may not be paired yet; the rename is the same either way).
def short_edges(fs: List<&2, A.FH>, +pos: U.Table<G.Vec3>, +eps2: F32, +both: Bool, acc: List<&2, A.FH>) -> List<&2, A.FH>:
  match fs:
    case Nil{}:
      acc
    case A.FH{f, +s, +e} <> t:
      +z = G.v3(0.0, 0.0, 0.0)
      +d = G.sub(U.tget(G.Vec3, pos, e, z), U.tget(G.Vec3, pos, s, z))
      short_edges(t, pos, eps2, both, U.cons_if(A.FH, Bool.and(Bool.or(both, U32.is_lt(s, e)), (R.approx(G.dot(d, d)) < eps2 : F32)), A.FH{f, s, e}, acc))

def unite(es: List<&2, A.FH>, a: Array<U32>, +fuel: Nat) -> Array<U32>:
  match es:
    case Nil{}:
      a
    case A.FH{_, s, e} <> t:
      unite(t, I.union(a, s, e, fuel), fuel)

def cmap.fin(st: I.RSt, +n: U32) -> U.Table<U32>:
  I.RSt{_, rrev} = st
  U.table(U32, n, U.rev(U32, rrev))

# Vertex rename: the smallest vertex of each short-edge cluster.
def short_map(+ss: List<&2, A.FH>, +vs: List<&2, G.Vec3>) -> U.Table<U32>:
  +n = U.len(G.Vec3, vs)
  +fuel = U32.to_nat((n + 1 : U32))
  cmap.fin(I.roots(I.iota(n), I.RSt{unite(ss, U.array_of(~U32, n, I.iota(n), 0), fuel), Nil{}}, fuel), n)

def renamed(+fs: List<&2, A.FH>, +cn: U.Table<U32>) -> List<&2, A.FH>:
  U.rev(A.FH, cancel(U.sort(~A.FH, ~fk_le, rewrite(fs, cn, Nil{})), Nil{}))

def weld.exact(c: Canon, +fs: List<&2, A.FH>) -> List<&2, A.FH>:
  Canon{any, +t} = c
  match any:
    case True{}:
      renamed(fs, t)
    case False{}:
      fs

# Welded{changed, fh}: changed says a vertex was renamed (the pairing must
# then be re-checked once the T-junctions are repaired).
def weld.short(none: Bool, +w1: List<&2, A.FH>, +ss: List<&2, A.FH>, +vs: List<&2, G.Vec3>, changed: Bool) -> Welded:
  match none:
    case True{}:
      Welded{changed, w1}
    case False{}:
      Welded{True{}, renamed(w1, short_map(ss, vs))}

def canon_any(c: Canon) -> Bool:
  Canon{a, _} = c
  a

# Exact weld, then short-edge collapse, each followed by in-face
# cancellation; both are skipped when there is nothing to rename (then the
# assembly's pairing is untouched and needs no re-check).
def weld2(+fs: List<&2, A.FH>, +vs: List<&2, G.Vec3>) -> Welded:
  +c = canonical(vs)
  +w1 = weld.exact(c, fs)
  +n = U.len(G.Vec3, vs)
  +eps = (maxabs(vs, 1.0) * 0.0000000000145519152 : F32)
  +ss = short_edges(w1, U.table(G.Vec3, n, vs), (eps * eps : F32), False{}, Nil{})
  weld.short(U.is_zero(U.len(A.FH, ss)), w1, ss, vs, canon_any(c))

# The short-edge collapse alone (the repair rounds of boolean.bend fin.clean:
# T-junction splits and zipping insert a vertex within eps of an edge's end,
# a second rounding of that end, after weld2 ran; docs/hybrid-robust.md R1).
# The halfedges' vertices are already exactly welded (splits and zips only
# insert vertices of the welded set), so the exact weld is not repeated. The
# halfedges need not be paired: an insertion near an edge's end on only one
# of its two halfedges leaves them unpaired until the collapse (kt6-rot-ab).
# changed: some halfedge was shorter than eps and has been collapsed.
def collapse(+fs: List<&2, A.FH>, +vs: List<&2, G.Vec3>, +pos: U.Table<G.Vec3>, +eps2: F32) -> Welded:
  +ss = short_edges(fs, pos, eps2, True{}, Nil{})
  weld.short(U.is_zero(U.len(A.FH, ss)), fs, ss, vs, False{})

# Is some halfedge shorter than eps (eps2 = eps^2)?
def has_short(+fs: List<&2, A.FH>, +pos: U.Table<G.Vec3>, +eps2: F32) -> Bool:
  U.nonzero(U.len(A.FH, short_edges(fs, pos, eps2, True{}, Nil{})))

# Squared short-edge tolerance (see short_map).
def eps2_of(vs: List<&2, G.Vec3>) -> F32:
  +eps = (maxabs(vs, 1.0) * 0.0000000000145519152 : F32)
  (eps * eps : F32)
