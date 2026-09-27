import Base
import ../../real.bend as R
import ../../precise.bend as G
import ./util.bend as U
import ./shadow.bend as S
import ./prep.bend as P

# corefine: broad phase and the parallel intersection / winding phase
# (Manifold boolean3.cpp Intersect12 and Winding03).
#
# Broad phase: a bounding-volume tree over one operand's faces, built bottom
# up over the faces sorted by the Morton code of their box centres (a
# balanced tree), queried with the conservative F32 boxes of prep.bend.
# Every candidate edge / face pair is then decided by S.kernel12. The work is
# a balanced fork tree over chunks of edges (one parallel let per level).

type Bvh is Data:
  BvNil{}
  BvLeaf{box: P.Box, x: P.FItem}
  BvNode{box: P.Box, l: Bvh, r: Bvh}

def bv_box(t: Bvh) -> P.Box:
  match t:
    case BvNil{}:
      P.box_empty()
    case BvLeaf{b, _}:
      b
    case BvNode{b, _, _}:
      b

def spread10(+x: U32) -> U32:
  +a = U32.and(U32.or(x, U32.shln(x, 16n)), 50331903)
  +b = U32.and(U32.or(a, U32.shln(a, 8n)), 50393103)
  +c = U32.and(U32.or(b, U32.shln(b, 4n)), 51130563)
  U32.and(U32.or(c, U32.shln(c, 2n)), 153391689)

def quant(+c: F32, +lo: F32, +ext: F32) -> U32:
  +t = F32.clamp(((c - lo) / F32.max(ext, 0.000000001) * 1023.0 : F32), 0.0, 1023.0)
  F32.to_u32(F32.floor(t))

def morton(b: P.Box, g: P.Box) -> U32:
  P.Box{x0, y0, z0, x1, y1, z1} = b
  P.Box{+gx0, +gy0, +gz0, gx1, gy1, gz1} = g
  +qx = quant(((x0 + x1) * 0.5 : F32), gx0, (gx1 - gx0 : F32))
  +qy = quant(((y0 + y1) * 0.5 : F32), gy0, (gy1 - gy0 : F32))
  +qz = quant(((z0 + z1) * 0.5 : F32), gz0, (gz1 - gz0 : F32))
  U32.or(spread10(qx), U32.or(U32.shl(spread10(qy)), U32.shln(spread10(qz), 2n)))

type MItem is Data:
  MItem{code: U32, it: P.FItem}

def mitem_le(a: MItem, b: MItem) -> Bool:
  MItem{ca, _} = a
  MItem{cb, _} = b
  U32.is_le(ca, cb)

def fitem_box(f: P.FItem) -> P.Box:
  P.FItem{_, _, b} = f
  b

def mitems(fs: List<&2, P.FItem>, +g: P.Box, acc: List<&2, MItem>) -> List<&2, MItem>:
  match fs:
    case Nil{}:
      acc
    case +f <> t:
      mitems(t, g, MItem{morton(fitem_box(f), g), f} <> acc)

def bv.leaves(ms: List<&2, MItem>, acc: List<&2, Bvh>) -> List<&2, Bvh>:
  match ms:
    case Nil{}:
      U.rev(Bvh, acc)
    case MItem{_, +f} <> t:
      bv.leaves(t, BvLeaf{fitem_box(f), f} <> acc)

def bv.pairs(xs: List<&2, Bvh>, acc: List<&2, Bvh>) -> List<&2, Bvh>:
  match xs:
    case Nil{}:
      U.rev(Bvh, acc)
    case a <> Nil{}:
      U.rev(Bvh, a <> acc)
    case +a <> +b <> t:
      bv.pairs(t, BvNode{P.box_union(bv_box(a), bv_box(b)), a, b} <> acc)

def bv.levels(fuel: Nat, xs: List<&2, Bvh>) -> Bvh:
  match fuel xs:
    case _ Nil{}:
      BvNil{}
    case _ t <> Nil{}:
      t
    case 0n _:
      BvNil{}
    case 1n+p _:
      bv.levels(p, bv.pairs(xs, Nil{}))

def bvh(fs: List<&2, P.FItem>, g: P.Box) -> Bvh:
  bv.levels(40n, bv.leaves(U.sort(~MItem, ~mitem_le, mitems(fs, g, Nil{})), Nil{}))

# Faces whose box overlaps qb (3D).
def bv.q(t: Bvh, hit: Bool, +qb: P.Box, acc: List<&2, P.FItem>) -> List<&2, P.FItem>:
  match t hit:
    case _ False{}:
      acc
    case BvNil{} True{}:
      acc
    case BvLeaf{_, x} True{}:
      x <> acc
    case BvNode{_, +l, +r} True{}:
      bv.q(l, P.box_overlap(qb, bv_box(l)), qb, bv.q(r, P.box_overlap(qb, bv_box(r)), qb, acc))

# Faces whose box overlaps qb in x and y (vertical ray candidates).
def bv.qxy(t: Bvh, hit: Bool, +qb: P.Box, acc: List<&2, P.FItem>) -> List<&2, P.FItem>:
  match t hit:
    case _ False{}:
      acc
    case BvNil{} True{}:
      acc
    case BvLeaf{_, x} True{}:
      x <> acc
    case BvNode{_, +l, +r} True{}:
      bv.qxy(l, P.box_overlap_xy(qb, bv_box(l)), qb, bv.qxy(r, P.box_overlap_xy(qb, bv_box(r)), qb, acc))

def query(+t: Bvh, +qb: P.Box) -> List<&2, P.FItem>:
  bv.q(t, P.box_overlap(qb, bv_box(t)), qb, Nil{})

def query_xy(+t: Bvh, +qb: P.Box) -> List<&2, P.FItem>:
  bv.qxy(t, P.box_overlap_xy(qb, bv_box(t)), qb, Nil{})

# --- balanced chunk trees for fork-join ------------------------------------------

type CTree<-A: Data> is Data:
  CtNil{}
  CtLeaf{xs: List<&2, A>}
  CtNode{l: CTree<A>, r: CTree<A>}

def ct.chunks(-A: Data, xs: List<&2, A>, full: Bool, +k: U32, +n: U32, cur: List<&2, A>, acc: List<&2, CTree<A>>) -> List<&2, CTree<A>>:
  match xs full:
    case Nil{} _:
      U.rev(CTree<A>, CtLeaf{U.rev(A, cur)} <> acc)
    case h <> t True{}:
      ct.chunks(A, t, U32.is_ge(1, k), k, 1, [h], CtLeaf{U.rev(A, cur)} <> acc)
    case h <> t False{}:
      +m = (n + 1 : U32)
      ct.chunks(A, t, U32.is_ge(m, k), k, m, h <> cur, acc)

def ct.pairs(-A: Data, xs: List<&2, CTree<A>>, acc: List<&2, CTree<A>>) -> List<&2, CTree<A>>:
  match xs:
    case Nil{}:
      U.rev(CTree<A>, acc)
    case a <> Nil{}:
      U.rev(CTree<A>, a <> acc)
    case a <> b <> t:
      ct.pairs(A, t, CtNode{a, b} <> acc)

def ct.levels(-A: Data, fuel: Nat, xs: List<&2, CTree<A>>) -> CTree<A>:
  match fuel xs:
    case _ Nil{}:
      CtNil{}
    case _ t <> Nil{}:
      t
    case 0n _:
      CtNil{}
    case 1n+p _:
      ct.levels(A, p, ct.pairs(A, xs, Nil{}))

# About `leaves` chunks of equal length, as a balanced tree.
def ctree(-A: Data, +xs: List<&2, A>, +leaves: U32) -> CTree<A>:
  +n = U.len(A, xs)
  +k = U32.max(1, U32.div((n + leaves - 1 : U32), leaves))
  ct.levels(A, 40n, ct.chunks(A, xs, False{}, k, 0, Nil{}, Nil{}))

# --- intersections ------------------------------------------------------------------

type Hit is Data:
  Hit{e: U32, f: U32, x: U32, v: G.Vec3}

type Hits is Data:
  Hits{bad: Bool, hs: List<&2, Hit>}

def hits_merge(a: Hits, b: Hits) -> Hits:
  Hits{ab, ah} = a
  Hits{bb, bh} = b
  Hits{Bool.or(ab, bb), U.cat(Hit, ah, bh)}

def hit_le(a: Hit, b: Hit) -> Bool:
  Hit{+ae, af, _, _} = a
  Hit{+be, bf, _, _} = b
  Bool.or(U32.is_lt(ae, be), Bool.and(U32.is_eq(ae, be), U32.is_le(af, bf)))

def push_k12(k: S.K12, +h: U32, +t: U32, acc: Hits) -> Hits:
  match k:
    case S.K12None{}:
      acc
    case S.K12Bad{}:
      Hits{_, hs} = acc
      Hits{True{}, hs}
    case S.K12{x, v}:
      Hits{b, hs} = acc
      Hits{b, Hit{h, t, x, v} <> hs}

def sort_hits(h: Hits) -> Hits:
  Hits{b, hs} = h
  Hits{b, U.sort(~Hit, ~hit_le, hs)}

# --- candidates, then decisions -------------------------------------------------------
# The broad phase (tree walks, divergent) runs on the CPU and produces the
# candidate edge / face pairs; deciding them (kernel12: fixed-size Real
# arithmetic, no data structures) is a separate balanced fork tree over
# chunks of pairs. That tree is the prototype's device kernel: it is called
# with ! (Metal when the binary runs with --gpu; the CPU pool with --gpu off;
# sequentially on the JS target).

type PairC is Data:
  PairC{h: U32, e: S.ERec, t: U32, f: S.FRec}

def pairs_of(fs: List<&2, P.FItem>, +h: U32, +e: S.ERec, acc: List<&2, PairC>) -> List<&2, PairC>:
  match fs:
    case Nil{}:
      acc
    case P.FItem{t, f, _} <> rest:
      pairs_of(rest, h, e, PairC{h, e, t, f} <> acc)

def cands_seq(es: List<&2, P.EItem>, +t: Bvh, acc: List<&2, PairC>) -> List<&2, PairC>:
  match es:
    case Nil{}:
      acc
    case P.EItem{+h, +e, +b} <> rest:
      cands_seq(rest, t, pairs_of(query(t, b), h, e, acc))

def cands_par(c: CTree<P.EItem>, +t: Bvh) -> List<&2, PairC>:
  match c:
    case CtNil{}:
      Nil{}
    case CtLeaf{xs}:
      cands_seq(xs, t, Nil{})
    case CtNode{l, r}:
      a b = cands_par(l, t) cands_par(r, t)
      U.rev_onto(PairC, a, b)

def eval_seq(ps: List<&2, PairC>, +eP: Bool, +fwd: Bool, +tz: F32, acc: Hits) -> Hits:
  match ps:
    case Nil{}:
      acc
    case PairC{+h, e, +t, f} <> rest:
      eval_seq(rest, eP, fwd, tz, push_k12(S.kernel12(eP, fwd, e, f, tz), h, t, acc))

def eval_par(c: CTree<PairC>, +eP: Bool, +fwd: Bool, +tz: F32) -> Hits:
  match c:
    case CtNil{}:
      Hits{False{}, Nil{}}
    case CtLeaf{xs}:
      eval_seq(xs, eP, fwd, tz, Hits{False{}, Nil{}})
    case CtNode{l, r}:
      a b = eval_par(l, eP, fwd, tz) eval_par(r, eP, fwd, tz)
      hits_merge(a, b)

# Number of chunks of the decision tree (4^6: fills most of a GPU dispatch,
# cheap on the CPU pool).
def eval_leaves() -> U32:
  4096

# The device call: decide all candidate pairs. tz: the tie tolerance of
# carrier unification (unify.bend; unused when no class is unified).
def decide(+ps: List<&2, PairC>, +eP: Bool, +fwd: Bool, +tz: F32) -> Hits:
  eval_par!(ctree(PairC, ps, eval_leaves()), eP, fwd, tz)

# --- winding numbers (Manifold Winding03) ------------------------------------------
# Vertices joined by an edge that crosses no face of the other operand have
# the same winding number; union-find over those edges, then one vertical
# ray (kernel02 sums over the faces above) per component.

type FSt is Type:
  FSt{a: Array<U32>, x: U32}

def fstep.k2(r: Array<U32> & U32, +x: U32) -> U.Step<FSt>:
  (a, +pp) = r
  U.CfMore{FSt{Array.set(U32, a, x, pp), pp}}

def fstep.if(root: Bool, a: Array<U32>, +x: U32, +px: U32) -> U.Step<FSt>:
  match root:
    case True{}:
      U.CfDone{FSt{a, x}}
    case False{}:
      fstep.k2(Array.get(U32, a, px), x)

def fstep.k1(r: Array<U32> & U32, +x: U32) -> U.Step<FSt>:
  (a, +px) = r
  fstep.if(U32.is_eq(px, x), a, x, px)

def fstep(s: FSt) -> U.Step<FSt>:
  FSt{a, +x} = s
  fstep.k1(Array.get(U32, a, x), x)

# Root of x with path halving (fuel: the vertex count bounds any path).
def find(a: Array<U32>, +x: U32, fuel: Nat) -> FSt:
  U.loop(~FSt, ~fstep, fuel, U.CfMore{FSt{a, x}})

def union.link(same: Bool, a: Array<U32>, +rs: U32, +re: U32) -> Array<U32>:
  match same:
    case True{}:
      a
    case False{}:
      Array.set(U32, a, U32.max(rs, re), U32.min(rs, re))

def union.k2(f: FSt, +rs: U32) -> Array<U32>:
  FSt{a, +re} = f
  union.link(U32.is_eq(rs, re), a, rs, re)

def union.k1(f: FSt, +e: U32, +fuel: Nat) -> Array<U32>:
  FSt{a, +rs} = f
  union.k2(find(a, e, fuel), rs)

def union(a: Array<U32>, +s: U32, +e: U32, +fuel: Nat) -> Array<U32>:
  union.k1(find(a, s, fuel), e, fuel)

type UF is Type:
  UF{par: Array<U32>, brk: Array<U32>}

def uf_edge.if(whole: Bool, par: Array<U32>, +s: U32, +e: U32, +fuel: Nat) -> Array<U32>:
  match whole:
    case True{}:
      union(par, s, e, fuel)
    case False{}:
      par

def uf_edge.k(r: Array<U32> & U32, par: Array<U32>, +s: U32, +e: U32, +fuel: Nat) -> UF:
  (brk, b) = r
  UF{uf_edge.if(U32.is_eq(b, 0), par, s, e, fuel), brk}

def uf_edge(it: P.EItem, st: UF, +tv: U.Table<U32>, +fuel: Nat) -> UF:
  P.EItem{+h, _, _} = it
  UF{par, brk} = st
  uf_edge.k(Array.get(U32, brk, h), par, U.tget(U32, tv, h, 0), U.tget(U32, tv, P.next3(h), 0), fuel)

def uf_edges(es: List<&2, P.EItem>, st: UF, +tv: U.Table<U32>, +fuel: Nat) -> UF:
  match es:
    case Nil{}:
      st
    case e <> t:
      uf_edges(t, uf_edge(e, st, tv, fuel), tv, fuel)

def mark(hs: List<&2, Hit>, a: Array<U32>) -> Array<U32>:
  match hs:
    case Nil{}:
      a
    case Hit{e, _, _, _} <> t:
      mark(t, Array.set(U32, a, e, 1))

def iota.go(n: Nat, +i: U32, acc: List<&2, U32>) -> List<&2, U32>:
  match n:
    case 0n:
      acc
    case 1n+p:
      iota.go(p, (i - 1 : U32), i <> acc)

# [0, 1, ..., n-1]
def iota(+n: U32) -> List<&2, U32>:
  iota.go(U32.to_nat(n), (n - 1 : U32), Nil{})

type RSt is Type:
  RSt{a: Array<U32>, roots: List<&2, U32>}

def roots.k(f: FSt, rs: List<&2, U32>) -> RSt:
  FSt{a, r} = f
  RSt{a, r <> rs}

def roots(vs: List<&2, U32>, st: RSt, +fuel: Nat) -> RSt:
  match vs:
    case Nil{}:
      st
    case v <> t:
      RSt{a, rs} = st
      roots(t, roots.k(find(a, v, fuel), rs), fuel)

# Signed count of faces above vertex r along +z (kernel02 sums).
type WAcc is Data:
  WAcc{bad: Bool, w: U32}

def push_k02(k: S.K02, acc: WAcc) -> WAcc:
  match k:
    case S.K02None{}:
      acc
    case S.K02Bad{}:
      WAcc{_, w} = acc
      WAcc{True{}, w}
    case S.K02{s, _}:
      WAcc{b, w} = acc
      WAcc{b, (w + s : U32)}

def vert_vs(fs: List<&2, P.FItem>, +eP: Bool, +fwd: Bool, +vr: S.VRec, +tz: F32, acc: WAcc) -> WAcc:
  match fs:
    case Nil{}:
      acc
    case P.FItem{_, f, _} <> rest:
      vert_vs(rest, eP, fwd, vr, tz, push_k02(S.kernel02(eP, fwd, vr, f, tz), acc))

type Wind is Data:
  Wind{v: U32, bad: Bool, w: U32}

def wind.fin(+v: U32, fwd: Bool, acc: WAcc) -> Wind:
  WAcc{bad, w} = acc
  Wind{v, bad, U.negate_if(Bool.not(fwd), w)}

def wind_of(+eP: Bool, +fwd: Bool, +v: U32, +vr: S.VRec, +t: Bvh, +tz: F32) -> Wind:
  wind.fin(v, fwd, vert_vs(query_xy(t, P.box_pt(S.vrec_p(vr))), eP, fwd, vr, tz, WAcc{False{}, 0}))

type Winds is Data:
  Winds{bad: Bool, ws: List<&2, Wind>}

def winds_merge(a: Winds, b: Winds) -> Winds:
  Winds{ab, aw} = a
  Winds{bb, bw} = b
  Winds{Bool.or(ab, bb), U.cat(Wind, aw, bw)}

def push_wind(w: Wind, acc: Winds) -> Winds:
  Wind{+v, +wb, +x} = w
  Winds{b, ws} = acc
  Winds{Bool.or(b, wb), Wind{v, wb, x} <> ws}

def winds_seq(vs: List<&2, U32>, +eP: Bool, +fwd: Bool, +vr: U.Table<S.VRec>, +t: Bvh, +tz: F32, acc: Winds) -> Winds:
  match vs:
    case Nil{}:
      acc
    case +v <> rest:
      winds_seq(rest, eP, fwd, vr, t, tz, push_wind(wind_of(eP, fwd, v, U.tget(S.VRec, vr, v, P.zvrec()), t, tz), acc))

def winds_par(c: CTree<U32>, +eP: Bool, +fwd: Bool, +vr: U.Table<S.VRec>, +t: Bvh, +tz: F32) -> Winds:
  match c:
    case CtNil{}:
      Winds{False{}, Nil{}}
    case CtLeaf{xs}:
      winds_seq(xs, eP, fwd, vr, t, tz, Winds{False{}, Nil{}})
    case CtNode{l, r}:
      a b = winds_par(l, eP, fwd, vr, t, tz) winds_par(r, eP, fwd, vr, t, tz)
      winds_merge(a, b)

# Vertices that are their own root.
def unique_roots(vs: List<&2, U32>, rs: List<&2, U32>, acc: List<&2, U32>) -> List<&2, U32>:
  match vs rs:
    case +v <> vt r <> rt:
      unique_roots(vt, rt, U.cons_if(U32, U32.is_eq(v, r), v, acc))
    case _ _:
      U.rev(U32, acc)

def set_winds(ws: List<&2, Wind>, a: Array<U32>) -> Array<U32>:
  match ws:
    case Nil{}:
      a
    case Wind{v, _, w} <> t:
      set_winds(t, Array.set(U32, a, v, w))

def per_vertex(rs: List<&2, U32>, +wr: U.Table<U32>, acc: List<&2, U32>) -> List<&2, U32>:
  match rs:
    case Nil{}:
      U.rev(U32, acc)
    case r <> t:
      per_vertex(t, wr, U.tget(U32, wr, r, 0) <> acc)

type Side is Data:
  Side{bad: Bool, hits: List<&2, Hit>, w: U.Table<U32>}

def side.w(ws: Winds, +nv: U32, +rs: List<&2, U32>, hbad: Bool, hs: List<&2, Hit>) -> Side:
  Winds{wbad, wl} = ws
  +wr = U.table(U32, nv, U.list_of(~U32, nv, set_winds(wl, Array.new(U32, U.depth(nv), 0))))
  Side{Bool.or(hbad, wbad), hs, U.table(U32, nv, per_vertex(rs, wr, Nil{}))}

def side.r(st: RSt, +nv: U32, +eP: Bool, +fwd: Bool, +vr: U.Table<S.VRec>, +t: Bvh, +leaves: U32, +tz: F32, hbad: Bool, hs: List<&2, Hit>) -> Side:
  RSt{_, rrev} = st
  +rs = U.rev(U32, rrev)
  +uniq = unique_roots(iota(nv), rs, Nil{})
  side.w(winds_par(ctree(U32, uniq, leaves), eP, fwd, vr, t, tz), nv, rs, hbad, hs)

def side.u(st: UF, +nv: U32, +eP: Bool, +fwd: Bool, +vr: U.Table<S.VRec>, +t: Bvh, +leaves: U32, +tz: F32, hbad: Bool, hs: List<&2, Hit>) -> Side:
  UF{par, _} = st
  +fuel = U32.to_nat((nv + 1 : U32))
  side.r(roots(iota(nv), RSt{par, Nil{}}, fuel), nv, eP, fwd, vr, t, leaves, tz, hbad, hs)

def side.h(h: Hits, +a: P.Prep, +eP: Bool, +fwd: Bool, +t: Bvh, +leaves: U32, +tz: F32) -> Side:
  Hits{hbad, +hs} = h
  P.Prep{+nv, +nt, _, +tv, _, _, _, +vr, +es, _, _} = a
  +fuel = U32.to_nat((nv + 1 : U32))
  +n3 = (nt * 3 : U32)
  side.u(uf_edges(es, UF{U.array_of(~U32, nv, iota(nv), 0), mark(hs, Array.new(U32, U.depth(n3), 0))}, tv, fuel), nv, eP, fwd, vr, t, leaves, tz, hbad, hs)

# Edges of `a` against faces of `b` (hits sorted by edge, face) and the
# winding number of every vertex of `a` with respect to `b` (fwd: a = P).
# Before the decisions: the tree over b's faces and the candidate pairs.
type SPre is Data:
  SPre{t: Bvh, pairs: List<&2, PairC>}

def side_pre(a: P.Prep, b: P.Prep, +leaves: U32) -> SPre:
  P.Prep{_, _, _, _, _, _, _, _, es, _, _} = a
  P.Prep{_, _, _, _, _, _, _, _, _, fs, g} = b
  +t = bvh(fs, g)
  SPre{t, cands_par(ctree(P.EItem, es, leaves), t)}

def spre_pairs(s: SPre) -> List<&2, PairC>:
  SPre{_, ps} = s
  ps

# After the decisions: sorted crossings and winding numbers.
def side_post(h: Hits, +pre: SPre, +a: P.Prep, +eP: Bool, +fwd: Bool, +leaves: U32, +tz: F32) -> Side:
  SPre{+t, _} = pre
  side.h(sort_hits(h), a, eP, fwd, t, leaves, tz)
