import Base
import ../mesh.bend as M
import ./geom.bend as E
import ./poly.bend as P
import ./setup.bend as S
import ./arrange.bend as A
import ./classify.bend as C
import ./assemble.bend as X

# Free triangles and their components.
#
# A triangle is "free" when no triangle of another leaf touches it: either
# its (padded) box meets none, or every one that it meets lies strictly on
# one side of its plane (exact test). Its closure is then at positive distance
# from every other leaf's surface, so the parity of every other leaf is
# constant on a neighbourhood of it, and it stays one uncut piece.
#
# Two free triangles of one leaf that share a vertex (the leaf meshes share
# vertex indices along seams) lie in one connected set at positive distance
# from all other surfaces, hence have the same keep/flip decision. So the
# free triangles are grouped by union-find over triangle and vertex nodes
# (no sorting), and one exact ray from each component's representative
# (its smallest triangle id) classifies all its members. This is the
# "classify once per patch, propagate" step of mesh Booleans, restricted to
# the provably safe case: propagation never passes a point that another
# surface touches, so no degenerate contact can be skipped.

# --- kept faces ---------------------------------------------------------------

def pts_of(vs: List<&2, E.Vtx>, acc: List<&2, X.Pt>) -> List<&2, X.Pt>:
  match vs:
    case Nil{}:
      List.reverse(&2, X.Pt, acc)
    case v <> t:
      pts_of(t, X.mk_pt(v) <> acc)

def kf_of(+tag: U32, +flip: Bool, p: P.Poly) -> X.KF:
  P.Poly{s, +es} = p
  X.KF{tag, flip, s, es, pts_of(P.vertices.go(es, Nil{}), Nil{})}

def keep_put(keep: Bool, +tag: U32, +flip: Bool, +p: P.Poly, fs: List<&2, X.KF>) -> List<&2, X.KF>:
  match keep:
    case True{}:
      kf_of(tag, flip, p) <> fs
    case False{}:
      fs

# --- union-find (path halving; the smaller id becomes the root) -----------------

# The loop state of a find: done (root r) or at x whose parent p was read.
type UF is Type:
  UDone{arr: Array<U32>, r: U32}
  UMore{arr: Array<U32>, x: U32, p: U32}

def uf.c(pr: Array<U32> & U32, +gp: U32) -> UF:
  (arr, gpp) = pr
  UMore{arr, gp, gpp}

def uf.b(pr: Array<U32> & U32, +x: U32) -> UF:
  (arr, +gp) = pr
  uf.c(Array.get(U32, Array.set(U32, arr, x, gp), gp), gp)

# One path-halving step: x -> grandparent.
def uf.step(root: Bool, arr: Array<U32>, +x: U32, +p: U32) -> UF:
  match root:
    case True{}:
      UDone{arr, x}
    case False{}:
      uf.b(Array.get(U32, arr, p), x)

def uf.loop(fuel: Nat, s: UF) -> Array<U32> & U32:
  match fuel s:
    case _ UDone{arr, r}:
      (arr, r)
    case 0n UMore{arr, x, _}:
      (arr, x)
    case 1n+f UMore{arr, +x, +p}:
      uf.loop(f, uf.step(U32.is_eq(p, x), arr, x, p))

def uf.start(fuel: Nat, pr: Array<U32> & U32, +x: U32) -> Array<U32> & U32:
  (arr, p) = pr
  uf.loop(fuel, UMore{arr, x, p})

def uf_find(fuel: Nat, arr: Array<U32>, +x: U32) -> Array<U32> & U32:
  uf.start(fuel, Array.get(U32, arr, x), x)

def uf_link(same: Bool, arr: Array<U32>, +ra: U32, +rb: U32) -> Array<U32>:
  match same:
    case True{}:
      arr
    case False{}:
      Array.set(U32, arr, U32.max(ra, rb), U32.min(ra, rb))

def uf_union.b(pr: Array<U32> & U32, +ra: U32) -> Array<U32>:
  (arr, +rb) = pr
  uf_link(U32.is_eq(ra, rb), arr, ra, rb)

def uf_union.a(+fuel: Nat, pr: Array<U32> & U32, +b: U32) -> Array<U32>:
  (arr, ra) = pr
  uf_union.b(uf_find(fuel, arr, b), ra)

def uf_union(+fuel: Nat, arr: Array<U32>, +a: U32, +b: U32) -> Array<U32>:
  uf_union.a(fuel, uf_find(fuel, arr, a), b)

# Nodes: triangle ids (< n) and vertex nodes n + global vertex id.
type N4 is Data:
  N4{i: U32, a: U32, b: U32, c: U32}

def tri_nodes(t: S.TriI, +n: U32) -> N4:
  S.TriI{+id, _, _, _, _, _, _, _, _, _, _, _, vi} = t
  S.VI{a, b, c} = vi
  N4{id, (n + a : U32), (n + b : U32), (n + c : U32)}

def init.k(q: N4, arr: Array<U32>) -> Array<U32>:
  N4{+i, +a, +b, +c} = q
  Array.set(U32, Array.set(U32, Array.set(U32, Array.set(U32, arr, i, i), a, a), b, b), c, c)

def uf_init(ts: List<&2, S.TriI>, +n: U32, arr: Array<U32>) -> Array<U32>:
  match ts:
    case Nil{}:
      arr
    case t <> r:
      uf_init(r, n, init.k(tri_nodes(t, n), arr))

def join.k(+fuel: Nat, q: N4, arr: Array<U32>) -> Array<U32>:
  N4{+i, +a, +b, +c} = q
  uf_union(fuel, uf_union(fuel, uf_union(fuel, arr, i, a), i, b), i, c)

def uf_join(ts: List<&2, S.TriI>, +n: U32, +fuel: Nat, arr: Array<U32>) -> Array<U32>:
  match ts:
    case Nil{}:
      arr
    case t <> r:
      uf_join(r, n, fuel, join.k(fuel, tri_nodes(t, n), arr))

# --- roots -------------------------------------------------------------------------

type RT is Data:
  RT{rep: U32, t: S.TriI}

# Every free triangle with its component root (a triangle id); the roots
# themselves are the representatives.
type RS is Data:
  RS{all: List<&2, RT>, reps: List<&2, S.TriI>}

def rs_put(is_rep: Bool, +r: U32, +t: S.TriI, rs: RS) -> RS:
  match is_rep:
    case True{}:
      RS{all, reps} = rs
      RS{RT{r, t} <> all, t <> reps}
    case False{}:
      RS{all, reps} = rs
      RS{RT{r, t} <> all, reps}

def roots.k(pr: Array<U32> & U32, +t: S.TriI, rs: RS) -> Array<U32> & RS:
  (arr, +r) = pr
  (arr, rs_put(U32.is_eq(r, A.tri_id(t)), r, t, rs))

def roots(ts: List<&2, S.TriI>, +fuel: Nat, st: Array<U32> & RS) -> RS:
  match ts:
    case Nil{}:
      (_, rs) = st
      rs
    case +t <> r:
      (arr, rs) = st
      roots(r, fuel, roots.k(uf_find(fuel, arr, A.tri_id(t)), t, rs))

# --- classification of the representatives (parallel) --------------------------------

# Decision of one component: its root, keep, flip, classified, counters.
type CD is Data:
  CD{r: U32, keep: Bool, flip: Bool, ok: Bool, st: P.St}

def cd_of(c: C.Cls, +r: U32) -> CD:
  C.Cls{ok, keep, flip, st} = c
  CD{r, keep, flip, ok, st}

def cls_go(ts: List<&2, S.TriI>, +bvh: S.BVH, +tree: M.Csg, acc: List<&2, CD>) -> List<&2, CD>:
  match ts:
    case Nil{}:
      acc
    case +t <> r:
      cls_go(r, bvh, tree, cd_of(C.classify(A.tri_poly(t), t, bvh, tree, P.st0()), A.tri_id(t)) <> acc)

type TH is Data:
  TH{a: List<&2, S.TriI>, b: List<&2, S.TriI>}

def t_halve(xs: List<&2, S.TriI>, a: List<&2, S.TriI>, b: List<&2, S.TriI>) -> TH:
  match xs:
    case Nil{}:
      TH{a, b}
    case x <> Nil{}:
      TH{x <> a, b}
    case x <> y <> t:
      t_halve(t, x <> a, y <> b)

def cls_par(d: Nat, h: TH, +bvh: S.BVH, +tree: M.Csg) -> List<&2, CD>:
  match d:
    case 0n:
      TH{a, b} = h
      cls_go(b, bvh, tree, cls_go(a, bvh, tree, Nil{}))
    case 1n+(+e):
      TH{a, b} = h
      x y = cls_par(e, t_halve(a, Nil{}, Nil{}), bvh, tree) cls_par(e, t_halve(b, Nil{}, Nil{}), bvh, tree)
      M.rev_onto(CD, x, y)

# The decision code per root: 1 drop, 2 keep, 3 keep flipped (0 unset).
def code(+keep: Bool, +flip: Bool) -> U32:
  Bool.pick(U32, keep, Bool.pick(U32, flip, 3, 2), 1)

type DA is Type:
  DA{arr: Array<U32>, ok: Bool, st: P.St}

def decide(cs: List<&2, CD>, d: DA) -> DA:
  match cs:
    case Nil{}:
      d
    case CD{r, +keep, +flip, ok, st} <> t:
      DA{arr, aok, ast} = d
      decide(t, DA{Array.set(U32, arr, r, code(keep, flip)), Bool.and(aok, ok), P.st_add(ast, st)})

# --- members -------------------------------------------------------------------------

# A kept free triangle with its orientation.
type KT is Data:
  KT{t: S.TriI, flip: Bool}

def kt_put(c: U32, +t: S.TriI, acc: List<&2, KT>) -> List<&2, KT>:
  match c:
    case 2:
      KT{t, False{}} <> acc
    case 3:
      KT{t, True{}} <> acc
    case _:
      acc

def kt.k(pr: Array<U32> & U32, +t: S.TriI, acc: List<&2, KT>) -> Array<U32> & List<&2, KT>:
  (arr, c) = pr
  (arr, kt_put(c, t, acc))

def kts(xs: List<&2, RT>, st: Array<U32> & List<&2, KT>) -> List<&2, KT>:
  match xs:
    case Nil{}:
      (_, acc) = st
      acc
    case RT{r, t} <> rest:
      (arr, acc) = st
      kts(rest, kt.k(Array.get(U32, arr, r), t, acc))

type KH is Data:
  KH{a: List<&2, KT>, b: List<&2, KT>}

def k_halve(xs: List<&2, KT>, a: List<&2, KT>, b: List<&2, KT>) -> KH:
  match xs:
    case Nil{}:
      KH{a, b}
    case x <> Nil{}:
      KH{x <> a, b}
    case x <> y <> t:
      k_halve(t, x <> a, y <> b)

def faces.go(xs: List<&2, KT>, acc: List<&2, X.KF>) -> List<&2, X.KF>:
  match xs:
    case Nil{}:
      acc
    case KT{+t, flip} <> r:
      faces.go(r, kf_of(A.tri_tag(t), flip, A.tri_poly(t)) <> acc)

def faces.par(d: Nat, h: KH) -> List<&2, X.KF>:
  match d:
    case 0n:
      KH{a, b} = h
      faces.go(b, faces.go(a, Nil{}))
    case 1n+(+e):
      KH{a, b} = h
      x y = faces.par(e, k_halve(a, Nil{}, Nil{})) faces.par(e, k_halve(b, Nil{}, Nil{}))
      M.rev_onto(X.KF, x, y)

# --- entry -------------------------------------------------------------------------

type FR is Data:
  FR{fs: List<&2, X.KF>, st: P.St, ok: Bool}

type GS is Data:
  GS{fr: FR, groups: U32, members: U32}

def depth_by(+n: U32, +shift: U32, +cap: U32) -> Nat:
  U32.to_nat(U32.min(S.depth_of(U32.shrn(n, U32.to_nat(shift))), cap))

def free.fin(d: DA, +all: List<&2, RT>, +ng: U32, +nm: U32) -> GS:
  DA{arr, ok, st} = d
  +ks = kts(all, (arr, Nil{}))
  GS{FR{faces.par(depth_by(M.count(&2, KT, ks), 6, 8), k_halve(ks, Nil{}, Nil{})), st, ok}, ng, nm}

def free.k(rs: RS, +n: U32, +bvh: S.BVH, +tree: M.Csg) -> GS:
  RS{+all, +reps} = rs
  +ng = M.count(&2, S.TriI, reps)
  +cds = cls_par(depth_by(ng, 0, 8), t_halve(reps, Nil{}, Nil{}), bvh, tree)
  free.fin(decide(cds, DA{Array.new(U32, U32.to_nat(S.depth_of(n)), 0), True{}, P.st0()}), all, ng, M.count(&2, RT, all))

# Kept faces of all free triangles (n input triangles with ids below n, nv
# input vertices with global ids below nv).
def free_faces(+ts: List<&2, S.TriI>, +n: U32, +nv: U32, +bvh: S.BVH, +tree: M.Csg) -> GS:
  +fuel = U32.to_nat((n + nv + 1 : U32))
  arr = uf_join(ts, n, fuel, uf_init(ts, n, Array.new(U32, U32.to_nat(S.depth_of((n + nv : U32))), 0)))
  free.k(roots(ts, fuel, (arr, RS{Nil{}, Nil{}})), n, bvh, tree)
