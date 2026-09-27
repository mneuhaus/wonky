import Base
import ../../real.bend as R
import ../../precise.bend as G
import ../mesh.bend as M
import ./big.bend as B
import ./geom.bend as E
import ./poly.bend as P

# Input of the exact-plane prototype: every leaf triangle quantized to the
# 2^-24 mm grid and turned into a plane-based triangle (support plane, three
# edge planes, exact grid corners), plus a bounding-volume hierarchy with one
# subtree per leaf (candidate pairs and axis rays query the other leaves).

# Axis-aligned box in grid units (F32, widened so it contains the exact box).
type Box is Data:
  Box{x0: F32, y0: F32, z0: F32, x1: F32, y1: F32, z1: F32}

# Per-leaf vertex indices of a triangle (seams share indices).
type VI is Data:
  VI{a: U32, b: U32, c: U32}

type TriI is Data:
  TriI{id: U32, leaf: U32, tag: U32, k: U32, s: E.Plane, e0: E.Plane, e1: E.Plane, e2: E.Plane, v0: E.Vtx, v1: E.Vtx, v2: E.Vtx, box: Box, vi: VI}

# --- boxes -------------------------------------------------------------------

def fmin(+a: F32, +b: F32) -> F32:
  F32.min(a, b)

def fmax(+a: F32, +b: F32) -> F32:
  F32.max(a, b)

def box_union(a: Box, b: Box) -> Box:
  Box{ax0, ay0, az0, ax1, ay1, az1} = a
  Box{bx0, by0, bz0, bx1, by1, bz1} = b
  Box{fmin(ax0, bx0), fmin(ay0, by0), fmin(az0, bz0), fmax(ax1, bx1), fmax(ay1, by1), fmax(az1, bz1)}

def overlap1(+a0: F32, +a1: F32, +b0: F32, +b1: F32) -> Bool:
  Bool.and((a0 <= b1 : F32), (b0 <= a1 : F32))

def overlaps(a: Box, b: Box) -> Bool:
  Box{ax0, ay0, az0, ax1, ay1, az1} = a
  Box{bx0, by0, bz0, bx1, by1, bz1} = b
  Bool.and(overlap1(ax0, ax1, bx0, bx1), Bool.and(overlap1(ay0, ay1, by0, by1), overlap1(az0, az1, bz0, bz1)))

def widen(+x: F32) -> F32:
  (F32.abs(x) * 0.000002 + 2.0 : F32)

# Box around approximate points (grid units); `pad` absorbs approximation.
def box_pt(+x: F32, +y: F32, +z: F32) -> Box:
  Box{(x - widen(x) : F32), (y - widen(y) : F32), (z - widen(z) : F32), (x + widen(x) : F32), (y + widen(y) : F32), (z + widen(z) : F32)}

def vtx_box(+v: E.Vtx) -> Box:
  box_pt(E.approx_u(v, 0), E.approx_u(v, 1), E.approx_u(v, 2))

def box_empty() -> Box:
  Box{300000000000000000000000000000000000000.0, 300000000000000000000000000000000000000.0, 300000000000000000000000000000000000000.0, F32.neg(300000000000000000000000000000000000000.0), F32.neg(300000000000000000000000000000000000000.0), F32.neg(300000000000000000000000000000000000000.0)}

def vtxs_box(vs: List<&2, E.Vtx>, acc: Box) -> Box:
  match vs:
    case Nil{}:
      acc
    case v <> t:
      vtxs_box(t, box_union(acc, vtx_box(v)))

def sel3(k: U32, a: F32, b: F32, c: F32) -> F32:
  match k:
    case 0:
      a
    case 1:
      b
    case _:
      c

def box_center(b: Box, k: U32) -> F32:
  Box{x0, y0, z0, x1, y1, z1} = b
  sel3(k, ((x0 + x1 : F32) * 0.5 : F32), ((y0 + y1 : F32) * 0.5 : F32), ((z0 + z1 : F32) * 0.5 : F32))

def box_extent(b: Box, k: U32) -> F32:
  Box{x0, y0, z0, x1, y1, z1} = b
  sel3(k, (x1 - x0 : F32), (y1 - y0 : F32), (z1 - z0 : F32))

def box_longest(+b: Box) -> U32:
  +ex = box_extent(b, 0)
  +ey = box_extent(b, 1)
  +ez = box_extent(b, 2)
  E.dominant.of((ex >= ey : F32), (ex >= ez : F32), (ey >= ez : F32))

# --- random access by index: a complete binary tree ---------------------------

type VT is Data:
  VL{v: E.Vtx}
  VN{l: VT, r: VT}
  VE{}

def vt_pair(xs: List<&2, VT>, acc: List<&2, VT>) -> List<&2, VT>:
  match xs:
    case Nil{}:
      List.reverse(&2, VT, acc)
    case a <> Nil{}:
      List.reverse(&2, VT, VN{a, VE{}} <> acc)
    case a <> b <> t:
      vt_pair(t, VN{a, b} <> acc)

def vt_leaves(xs: List<&2, E.Vtx>, acc: List<&2, VT>) -> List<&2, VT>:
  match xs:
    case Nil{}:
      List.reverse(&2, VT, acc)
    case v <> t:
      vt_leaves(t, VL{v} <> acc)

def vt_up(d: Nat, xs: List<&2, VT>) -> List<&2, VT>:
  match d:
    case 0n:
      xs
    case 1n+p:
      vt_up(p, vt_pair(xs, Nil{}))

def vt_root(xs: List<&2, VT>) -> VT:
  match xs:
    case Nil{}:
      VE{}
    case h <> _:
      h

def bit(+i: U32, +b: U32) -> Bool:
  U32.is_ne(U32.and(i, b), 0)

# Element i of a tree of depth d (bit = 2^(d-1) selects the first branch).
def vt_get(t: VT, +i: U32, +b: U32, right: Bool) -> E.Vtx:
  match t:
    case VL{v}:
      v
    case VE{}:
      E.point(B.zero(), B.zero(), B.zero())
    case VN{l, r}:
      match right:
        case True{}:
          vt_get(r, i, (b >> 1n : U32), bit(i, (b >> 1n : U32)))
        case False{}:
          vt_get(l, i, (b >> 1n : U32), bit(i, (b >> 1n : U32)))

# ceil(log2 n): the depth of a complete tree with n leaves.
def depth_of(+n: U32) -> U32:
  Bool.pick(U32, U32.is_le(n, 1), 0, (U32.from_nat(U32.log2((n - 1 : U32))) + 1 : U32))

def lookup(+t: VT, +d: U32, +i: U32) -> E.Vtx:
  +b = Bool.pick(U32, U32.is_eq(d, 0), 0, U32.shln(1, U32.to_nat((d - 1 : U32))))
  vt_get(t, i, b, bit(i, b))

# --- leaf meshes -> plane-based triangles --------------------------------------

type QL is Data:
  QL{vs: List<&2, E.Vtx>, err: F32, ok: Bool}

def qmax(+a: F32, +b: F32) -> F32:
  F32.max(a, b)

def quant.step(ql: QL, +x: R.Real, +y: R.Real, +z: R.Real) -> QL:
  QL{vs, err, ok} = ql
  +qx = E.quantize(x)
  +qy = E.quantize(y)
  +qz = E.quantize(z)
  +e = qmax(E.quant_error(x, qx), qmax(E.quant_error(y, qy), E.quant_error(z, qz)))
  QL{E.point(qx, qy, qz) <> vs, qmax(err, e), Bool.and(ok, Bool.and(E.in_box(qx), Bool.and(E.in_box(qy), E.in_box(qz))))}

def quant(xs: List<&2, G.Vec3>, acc: QL) -> QL:
  match xs:
    case Nil{}:
      acc
    case G.V3{x, y, z} <> t:
      quant(t, quant.step(acc, x, y, z))

def mk_tri.k(+id: U32, +leaf: U32, +tag: U32, +k: U32, +s: E.Plane, +v0: E.Vtx, +v1: E.Vtx, +v2: E.Vtx, vi: VI) -> TriI:
  +q = (id * 4 : U32)
  TriI{id, leaf, tag, k, E.with_id(s, q), E.with_id(E.edge_plane(k, v0, v1, v2), (q + 1 : U32)), E.with_id(E.edge_plane(k, v1, v2, v0), (q + 2 : U32)), E.with_id(E.edge_plane(k, v2, v0, v1), (q + 3 : U32)), v0, v1, v2, vtxs_box([v0, v1, v2], box_empty()), vi}

def mk_tri(+id: U32, +leaf: U32, +tag: U32, +v0: E.Vtx, +v1: E.Vtx, +v2: E.Vtx, vi: VI) -> TriI:
  +s = E.plane3(v0, v1, v2)
  mk_tri.k(id, leaf, tag, E.dominant(s), s, v0, v1, v2, vi)

# A numbered input triangle: global id, tag, per-leaf corner indices.
type NT is Data:
  NT{id: U32, tag: U32, a: U32, b: U32, c: U32}

def number(ts: List<&2, M.Tri>, +id: U32, acc: List<&2, NT>) -> List<&2, NT>:
  match ts:
    case Nil{}:
      acc
    case M.Tri{a, b, c, tag} <> t:
      number(t, (id + 1 : U32), NT{id, tag, a, b, c} <> acc)

def tris.go(ts: List<&2, NT>, +vt: VT, +d: U32, +leaf: U32, +off: U32, acc: List<&2, TriI>) -> List<&2, TriI>:
  match ts:
    case Nil{}:
      acc
    case NT{id, tag, +a, +b, +c} <> t:
      tris.go(t, vt, d, leaf, off, mk_tri(id, leaf, tag, lookup(vt, d, a), lookup(vt, d, b), lookup(vt, d, c), VI{(a + off : U32), (b + off : U32), (c + off : U32)}) <> acc)

type NH is Data:
  NH{a: List<&2, NT>, b: List<&2, NT>}

def nt_halve(xs: List<&2, NT>, a: List<&2, NT>, b: List<&2, NT>) -> NH:
  match xs:
    case Nil{}:
      NH{a, b}
    case x <> Nil{}:
      NH{x <> a, b}
    case x <> y <> t:
      nt_halve(t, x <> a, y <> b)

# Plane-based triangles are built in parallel (about 64 per leaf task).
def tris.par(fd: Nat, h: NH, +vt: VT, +d: U32, +leaf: U32, +off: U32) -> List<&2, TriI>:
  match fd:
    case 0n:
      NH{a, b} = h
      tris.go(b, vt, d, leaf, off, tris.go(a, vt, d, leaf, off, Nil{}))
    case 1n+(+e):
      NH{a, b} = h
      x y = tris.par(e, nt_halve(a, Nil{}, Nil{}), vt, d, leaf, off) tris.par(e, nt_halve(b, Nil{}, Nil{}), vt, d, leaf, off)
      M.rev_onto(TriI, x, y)

# nv: vertices of all leaves so far (global vertex ids are leaf-local ids
# plus the leaf's offset).
type Input is Data:
  Input{tris: List<&2, TriI>, n: U32, err: F32, ok: Bool, nv: U32}

def leaf_in.k(ql: QL, +ts: List<&2, M.Tri>, +leaf: U32, inp: Input) -> Input:
  QL{rvs, e, ok} = ql
  Input{acc, +n, err, ok0, +nv} = inp
  +vs = List.reverse(&2, E.Vtx, rvs)
  +cnt = M.count(&2, E.Vtx, vs)
  +d = depth_of(cnt)
  +nts = number(ts, n, Nil{})
  +m = M.count(&2, M.Tri, ts)
  Input{M.rev_onto(TriI, tris.par(U32.to_nat(U32.min(depth_of((m >> 6n : U32)), 10)), nt_halve(nts, Nil{}, Nil{}), vt_root(vt_up(U32.to_nat(d), vt_leaves(vs, Nil{}))), d, leaf, nv), acc), (n + m : U32), qmax(err, e), Bool.and(ok, ok0), (nv + cnt : U32)}

def leaves_in(ms: List<&2, M.LeafMesh>, inp: Input) -> Input:
  match ms:
    case Nil{}:
      inp
    case M.LeafMesh{leaf, M.Mesh{vs, +ts}} <> t:
      leaves_in(t, leaf_in.k(quant(vs, QL{Nil{}, 0.0, True{}}), ts, leaf, inp))

# All leaf triangles with ids 0.. in job order (list order unspecified).
def input(ms: List<&2, M.LeafMesh>) -> Input:
  leaves_in(ms, Input{Nil{}, 0, 0.0, True{}, 0})

def tri_nondegenerate(t: TriI) -> Bool:
  TriI{_, _, _, _, s, _, _, _, _, _, _, _, _} = t
  Bool.not(E.bzero(E.normal_of(s)))

# Tail-recursive (the JS target has a bounded stack).
def all_nondegenerate(ts: List<&2, TriI>, acc: Bool) -> Bool:
  match ts:
    case Nil{}:
      acc
    case t <> r:
      all_nondegenerate(r, Bool.and(acc, tri_nondegenerate(t)))

# --- bounding-volume hierarchy ----------------------------------------------

# BF marks the root of one leaf's subtree: queries for "other leaves" skip
# the subtree of their own leaf entirely.
type BVH is Data:
  BL{box: Box, items: List<&2, TriI>}
  BN{box: Box, l: BVH, r: BVH}
  BF{leaf: U32, box: Box, t: BVH}

def tri_box(t: TriI) -> Box:
  TriI{_, _, _, _, _, _, _, _, _, _, _, b, _} = t
  b

def items_box(ts: List<&2, TriI>, acc: Box) -> Box:
  match ts:
    case Nil{}:
      acc
    case t <> r:
      items_box(r, box_union(acc, tri_box(t)))

def box_at(+x: F32, +y: F32, +z: F32) -> Box:
  Box{x, y, z, x, y, z}

def centers_box(ts: List<&2, TriI>, acc: Box) -> Box:
  match ts:
    case Nil{}:
      acc
    case +t <> r:
      +b = tri_box(t)
      centers_box(r, box_union(acc, box_at(box_center(b, 0), box_center(b, 1), box_center(b, 2))))

type Part is Data:
  Part{l: List<&2, TriI>, nl: U32, r: List<&2, TriI>, nr: U32}

def part.put(left: Bool, t: TriI, acc: Part) -> Part:
  match left:
    case True{}:
      Part{l, nl, r, nr} = acc
      Part{t <> l, (nl + 1 : U32), r, nr}
    case False{}:
      Part{l, nl, r, nr} = acc
      Part{l, nl, t <> r, (nr + 1 : U32)}

def part(ts: List<&2, TriI>, +k: U32, +mid: F32, acc: Part) -> Part:
  match ts:
    case Nil{}:
      acc
    case +t <> rest:
      part(rest, k, mid, part.put((box_center(tri_box(t), k) < mid : F32), t, acc))

def halves(ts: List<&2, TriI>, k: Nat, acc: Part) -> Part:
  match ts k:
    case Nil{} _:
      acc
    case t <> +r 0n:
      Part{l, nl, rr, nr} = acc
      Part{l, nl, t <> r, (nr + M.count(&2, TriI, r) + 1 : U32)}
    case t <> r 1n+p:
      Part{l, nl, rr, nr} = acc
      halves(r, p, Part{t <> l, (nl + 1 : U32), rr, nr})

def partition.fix(lz: Bool, rz: Bool, p: Part) -> Part:
  match lz rz:
    case True{} _:
      Part{_, _, r, +nr} = p
      halves(r, U32.to_nat((nr >> 1n : U32)), Part{Nil{}, 0, Nil{}, 0})
    case False{} True{}:
      Part{l, +nl, _, _} = p
      halves(l, U32.to_nat((nl >> 1n : U32)), Part{Nil{}, 0, Nil{}, 0})
    case False{} False{}:
      p

def partition.k(+p: Part) -> Part:
  Part{_, +nl, _, +nr} = p
  partition.fix(U32.is_eq(nl, 0), U32.is_eq(nr, 0), p)

# Split at the midpoint of the centroid box along its longest axis; halves by
# count when that leaves one side empty.
def partition(+ts: List<&2, TriI>) -> Part:
  +cb = centers_box(ts, box_empty())
  +k = box_longest(cb)
  partition.k(part(ts, k, box_center(cb, k), Part{Nil{}, 0, Nil{}, 0}))

def bvh_box(t: BVH) -> Box:
  match t:
    case BL{b, _}:
      b
    case BN{b, _, _}:
      b
    case BF{_, b, _}:
      b

def mk_bn(+a: BVH, +b: BVH) -> BVH:
  BN{box_union(bvh_box(a), bvh_box(b)), a, b}

def build.leaf(p: Part) -> BVH:
  Part{l, _, r, _} = p
  +all = List.append(&2, TriI, l, r)
  BL{items_box(all, box_empty()), all}

def build(t: Nat, leaf: Bool, p: Part) -> BVH:
  match t:
    case 0n:
      build.leaf(p)
    case 1n+(+f):
      match leaf:
        case True{}:
          build.leaf(p)
        case False{}:
          Part{+l, +nl, +r, +nr} = p
          a b = build(f, U32.is_le(nl, 4), partition(l)) build(f, U32.is_le(nr, 4), partition(r))
          mk_bn(a, b)

def bvh_one(+ts: List<&2, TriI>) -> BVH:
  +n = M.count(&2, TriI, ts)
  build(48n, U32.is_le(n, 4), Part{ts, n, Nil{}, 0})

# --- one subtree per leaf ---------------------------------------------------------
#
# Input.tris holds each leaf's triangles contiguously; the runs of equal leaf
# become BF subtrees, built in parallel and joined by a balanced tree.

type Run is Data:
  Run{leaf: U32, ts: List<&2, TriI>}

type RS is Data:
  RS{leaf: U32, cur: List<&2, TriI>, acc: List<&2, Run>}

def leaf_of(t: TriI) -> U32:
  TriI{_, l, _, _, _, _, _, _, _, _, _, _, _} = t
  l

def rs_leaf(s: RS) -> U32:
  RS{l, _, _} = s
  l

def rs_close(+l: U32, cur: List<&2, TriI>, acc: List<&2, Run>) -> List<&2, Run>:
  match cur:
    case Nil{}:
      acc
    case h <> t:
      Run{l, h <> t} <> acc

def rs_step(same: Bool, +t: TriI, s: RS) -> RS:
  match same:
    case True{}:
      RS{l, cur, acc} = s
      RS{l, t <> cur, acc}
    case False{}:
      RS{l, cur, acc} = s
      RS{leaf_of(t), [t], rs_close(l, cur, acc)}

def runs(ts: List<&2, TriI>, +s: RS) -> List<&2, Run>:
  match ts:
    case Nil{}:
      RS{l, cur, acc} = s
      rs_close(l, cur, acc)
    case +t <> r:
      runs(r, rs_step(U32.is_eq(leaf_of(t), rs_leaf(s)), t, s))

def run_tree.k(+leaf: U32, +t: BVH) -> BVH:
  BF{leaf, bvh_box(t), t}

def run_tree(r: Run) -> BVH:
  Run{+leaf, ts} = r
  run_tree.k(leaf, bvh_one(ts))

type RH is Data:
  RH{a: List<&2, Run>, b: List<&2, Run>}

def r_halve(xs: List<&2, Run>, a: List<&2, Run>, b: List<&2, Run>) -> RH:
  match xs:
    case Nil{}:
      RH{a, b}
    case x <> Nil{}:
      RH{x <> a, b}
    case x <> y <> t:
      r_halve(t, x <> a, y <> b)

def join(+x: BVH, y: BVH) -> BVH:
  match y:
    case BL{_, Nil{}}:
      x
    case _:
      mk_bn(x, y)

def runs_tris(rs: List<&2, Run>, acc: List<&2, TriI>) -> List<&2, TriI>:
  match rs:
    case Nil{}:
      acc
    case Run{_, ts} <> t:
      runs_tris(t, M.rev_onto(TriI, ts, acc))

# A list of at most one run, else a fork over its interleaved halves.
def forest(fuel: Nat, h: RH) -> BVH:
  match fuel:
    case 0n:
      RH{a, b} = h
      bvh_one(runs_tris(M.rev_onto(Run, a, b), Nil{}))
    case 1n+(+f):
      RH{a, b} = h
      match a b:
        case Nil{} Nil{}:
          BL{box_empty(), Nil{}}
        case r <> Nil{} Nil{}:
          run_tree(r)
        case x <> xt ys:
          p q = forest(f, r_halve(x <> xt, Nil{}, Nil{})) forest(f, r_halve(ys, Nil{}, Nil{}))
          join(p, q)
        case Nil{} y <> yt:
          forest(f, RH{y <> yt, Nil{}})

def bvh(+ts: List<&2, TriI>) -> BVH:
  forest(32n, RH{runs(ts, RS{4294967295, Nil{}, Nil{}}), Nil{}})

def put_if(keep: Bool, t: TriI, acc: List<&2, TriI>) -> List<&2, TriI>:
  match keep:
    case True{}:
      t <> acc
    case False{}:
      acc

def filter_items(ts: List<&2, TriI>, +q: Box, acc: List<&2, TriI>) -> List<&2, TriI>:
  match ts:
    case Nil{}:
      acc
    case +t <> r:
      filter_items(r, q, put_if(overlaps(tri_box(t), q), t, acc))

# All triangles of leaves other than `leaf` whose box meets q (appended to
# acc, unordered); the subtree of that leaf is skipped at its root.
def query_o(t: BVH, hit: Bool, +q: Box, +leaf: U32, acc: List<&2, TriI>) -> List<&2, TriI>:
  match t:
    case BL{_, items}:
      match hit:
        case True{}:
          filter_items(items, q, acc)
        case False{}:
          acc
    case BN{_, +l, +r}:
      match hit:
        case True{}:
          query_o(r, overlaps(bvh_box(r), q), q, leaf, query_o(l, overlaps(bvh_box(l), q), q, leaf, acc))
        case False{}:
          acc
    case BF{+lf, _, +s}:
      query_o(s, Bool.and(hit, U32.is_ne(lf, leaf)), q, leaf, acc)

def find_other(+t: BVH, +q: Box, +leaf: U32) -> List<&2, TriI>:
  query_o(t, overlaps(bvh_box(t), q), q, leaf, Nil{})
