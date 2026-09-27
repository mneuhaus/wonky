import Base
import ../../real.bend as R
import ./big.bend as B
import ./geom.bend as E
import ./poly.bend as P
import ./setup.bend as S
import ../mesh.bend as M

# Triangle-local arrangement (the "cell" of this prototype is one input
# triangle, see docs/proto-exact-plane.md). A triangle t of leaf i is split by
#   - the support plane of every triangle b of another leaf that strictly
#     straddles t's plane, applied to every current piece that the plane
#     strictly separates and whose box meets b's box (BSP-style restricted
#     cuts; extra cuts are harmless, missing ones are not possible), and
#   - the three edge planes of every coplanar triangle b of another leaf whose
#     region overlaps the piece (so coincident regions become identical
#     pieces).
# After this no surface of another leaf crosses the interior of a piece; a
# surface may only touch it, which the tangency check reports.

# KStr: b strictly straddles t's plane; KEdge: an edge of b lies in t's
# plane (b's surface may cross it there); KTouch: only a vertex of b lies in
# it; KCop: coplanar; KApart: strictly on one side. The points of KStr/KEdge
# are where b meets t's plane, each with the edge planes of b through it.
type XP is Data:
  XP{x: E.Vtx, es: List<&2, E.Plane>}

type PairKind is Data:
  KCop{}
  KStr{xs: List<&2, XP>}
  KEdge{xs: List<&2, XP>}
  KTouch{}
  KApart{}

type PS is Data:
  PS{ps: List<&2, P.Poly>, st: P.St}

type KS is Data:
  KS{k: PairKind, st: P.St}

def tri_s(t: S.TriI) -> E.Plane:
  S.TriI{_, _, _, _, s, _, _, _, _, _, _, _, _} = t
  s

def tri_leaf(t: S.TriI) -> U32:
  S.TriI{_, l, _, _, _, _, _, _, _, _, _, _, _} = t
  l

def tri_id(t: S.TriI) -> U32:
  S.TriI{i, _, _, _, _, _, _, _, _, _, _, _, _} = t
  i

def tri_tag(t: S.TriI) -> U32:
  S.TriI{_, _, g, _, _, _, _, _, _, _, _, _, _} = t
  g

def tri_k(t: S.TriI) -> U32:
  S.TriI{_, _, _, k, _, _, _, _, _, _, _, _, _} = t
  k

def tri_vs(t: S.TriI) -> List<&2, E.Vtx>:
  S.TriI{_, _, _, _, _, _, _, _, v0, v1, v2, _, _} = t
  [v0, v1, v2]

def tri_es(t: S.TriI) -> List<&2, E.Plane>:
  S.TriI{_, _, _, _, _, e0, e1, e2, _, _, _, _, _} = t
  [e0, e1, e2]

def tri_poly(t: S.TriI) -> P.Poly:
  S.TriI{_, _, _, _, s, e0, e1, e2, v0, v1, v2, _, _} = t
  P.Poly{s, [P.Edge{e0, v0}, P.Edge{e1, v1}, P.Edge{e2, v2}]}

def poly_box(p: P.Poly) -> S.Box:
  S.vtxs_box(P.vertices(p), S.box_empty())

def any_eq0(xs: List<&2, B.Sign>) -> Bool:
  match xs:
    case Nil{}:
      False{}
    case s <> t:
      Bool.or(P.is_eq0(s), any_eq0(t))

def count_eq0(xs: List<&2, B.Sign>, +n: U32) -> U32:
  match xs:
    case Nil{}:
      n
    case s <> t:
      count_eq0(t, (n + Bool.to_u32(P.is_eq0(s)) : U32))

def cross_pt(s: B.Sign, n: B.Sign, v: E.Vtx, +e: E.Plane, +ep: E.Plane, +ts: E.Plane, +sb: E.Plane, acc: List<&2, XP>) -> List<&2, XP>:
  match s n:
    case B.Eq0{} _:
      XP{v, [ep, e]} <> acc
    case B.Lt0{} B.Gt0{}:
      XP{E.meet(ts, sb, e), [e]} <> acc
    case B.Gt0{} B.Lt0{}:
      XP{E.meet(ts, sb, e), [e]} <> acc
    case _ _:
      acc

# Where b meets t's plane: its vertices on the plane (on the edge planes
# before and after them) and the crossing points of its edges with strictly
# opposite end signs (exactly two points when b straddles the plane or has an
# edge in it). Built in exact arithmetic. Edge i runs from vertex i to i + 1.
def cross_pts(vs: List<&2, E.Vtx>, ss: List<&2, B.Sign>, ns: List<&2, B.Sign>, es: List<&2, E.Plane>, eps: List<&2, E.Plane>, +ts: E.Plane, +sb: E.Plane, acc: List<&2, XP>) -> List<&2, XP>:
  match vs ss ns es eps:
    case v <> vt s <> st n <> nt e <> et ep <> pt:
      cross_pts(vt, st, nt, et, pt, ts, sb, cross_pt(s, n, v, e, ep, ts, sb, acc))
    case _ _ _ _ _:
      acc

def prev_es(t: S.TriI) -> List<&2, E.Plane>:
  S.TriI{_, _, _, _, _, e0, e1, e2, _, _, _, _, _} = t
  [e2, e0, e1]

def kind_of(lt: Bool, gt: Bool, zeros: U32, +ss: List<&2, B.Sign>, +ts: E.Plane, +b: S.TriI) -> PairKind:
  match lt gt:
    case True{} True{}:
      KStr{cross_pts(tri_vs(b), ss, P.rotate1(B.Sign, ss), tri_es(b), prev_es(b), ts, tri_s(b), Nil{})}
    case _ _:
      match zeros:
        case 0:
          KApart{}
        case 1:
          KTouch{}
        case _:
          KEdge{cross_pts(tri_vs(b), ss, P.rotate1(B.Sign, ss), tri_es(b), prev_es(b), ts, tri_s(b), Nil{})}

def kind.signs(+sd: List<&2, E.Side>, st: P.St, +ts: E.Plane, +b: S.TriI) -> KS:
  +ss = P.signs(sd)
  KS{kind_of(P.any_lt(ss), P.any_gt(ss), count_eq0(ss, 0), ss, ts, b), P.tally(sd, st)}

def kind.pick(cop: Bool, +ts: E.Plane, +b: S.TriI, st: P.St) -> KS:
  match cop:
    case True{}:
      KS{KCop{}, st}
    case False{}:
      kind.signs(P.sides(ts, tri_vs(b)), st, ts, b)

# How triangle b relates to the support plane ts of the triangle being cut.
def kind(+ts: E.Plane, +b: S.TriI, st: P.St) -> KS:
  kind.pick(E.coplanar(ts, tri_s(b)), ts, b, st)

# --- coplanar overlap (separating-axis test with exact edge planes) --------------

type BS is Data:
  BS{b: Bool, st: P.St}

# Some plane in `ps` has no vertex of vs strictly on its negative side.
def separated(ps: List<&2, E.Plane>, +vs: List<&2, E.Vtx>, acc: BS) -> BS:
  match ps:
    case Nil{}:
      acc
    case p <> rest:
      BS{hit, st} = acc
      +sd = P.sides(p, vs)
      separated(rest, vs, BS{Bool.or(hit, Bool.not(P.any_lt(P.signs(sd)))), P.tally(sd, st)})

def edge_planes.go(es: List<&2, P.Edge>, acc: List<&2, E.Plane>) -> List<&2, E.Plane>:
  match es:
    case Nil{}:
      acc
    case P.Edge{p, _} <> t:
      edge_planes.go(t, p <> acc)

def edge_planes(p: P.Poly) -> List<&2, E.Plane>:
  P.Poly{_, es} = p
  edge_planes.go(es, Nil{})

def cop_overlap.k2(r: BS) -> BS:
  BS{s2, st} = r
  BS{Bool.not(s2), st}

def cop_overlap.k1(s1: Bool, +b: S.TriI, +piece: P.Poly, st: P.St) -> BS:
  match s1:
    case True{}:
      BS{False{}, st}
    case False{}:
      cop_overlap.k2(separated(edge_planes(piece), tri_vs(b), BS{False{}, st}))

def cop_overlap.k(r: BS, +b: S.TriI, +piece: P.Poly) -> BS:
  BS{s1, st} = r
  cop_overlap.k1(s1, b, piece, st)

def cop_overlap(+b: S.TriI, +piece: P.Poly, st: P.St) -> BS:
  cop_overlap.k(separated(tri_es(b), P.vertices(piece), BS{False{}, st}), b, piece)

# Clip a piece by the edge planes of an overlapping coplanar triangle: every
# part outside one of them is final; the part inside all three is the overlap.
def clip.go(ps: List<&2, E.Plane>, r: P.Split, out: List<&2, P.Poly>) -> PS:
  match ps:
    case Nil{}:
      match r:
        case P.AllNeg{cur, st}:
          PS{cur <> out, st}
        case P.Both{n, p, st}:
          PS{n <> (p <> out), st}
        case P.AllPos{cur, st}:
          PS{cur <> out, st}
    case +e <> rest:
      match r:
        case P.AllNeg{cur, st}:
          clip.go(rest, P.split(cur, e, st), out)
        case P.Both{n, p, st}:
          clip.go(rest, P.split(n, e, st), p <> out)
        case P.AllPos{cur, st}:
          PS{cur <> out, st}

def clip.start(es: List<&2, E.Plane>, piece: P.Poly, out: List<&2, P.Poly>, st: P.St) -> PS:
  match es:
    case Nil{}:
      PS{piece <> out, st}
    case e <> rest:
      clip.go(rest, P.split(piece, e, st), out)

def clip_cop.k1(hit: Bool, +b: S.TriI, piece: P.Poly, out: List<&2, P.Poly>, st: P.St) -> PS:
  match hit:
    case True{}:
      clip.start(tri_es(b), piece, out, st)
    case False{}:
      PS{piece <> out, st}

def clip_cop.k(ov: BS, +b: S.TriI, piece: P.Poly, out: List<&2, P.Poly>) -> PS:
  BS{hit, st} = ov
  clip_cop.k1(hit, b, piece, out, st)

def clip_cop(+b: S.TriI, +piece: P.Poly, out: List<&2, P.Poly>, st: P.St) -> PS:
  clip_cop.k(cop_overlap(b, piece, st), b, piece, out)

# --- cutting every piece by one candidate triangle ------------------------------

def push_split(r: P.Split, out: List<&2, P.Poly>) -> PS:
  match r:
    case P.AllNeg{p, st}:
      PS{p <> out, st}
    case P.AllPos{p, st}:
      PS{p <> out, st}
    case P.Both{n, p, st}:
      PS{n <> (p <> out), st}

def xp_pts(xs: List<&2, XP>, acc: List<&2, E.Vtx>) -> List<&2, E.Vtx>:
  match xs:
    case Nil{}:
      acc
    case XP{x, _} <> t:
      xp_pts(t, x <> acc)

# Pre-cut (see docs/proto-exact-plane.md, "segment-bounded cuts"): an end of
# b's segment strictly inside the piece means b's plane must not cut the
# whole piece (that extension is what leaves hair-thin wedges between the
# nearly parallel cuts of two almost coplanar neighbours of b). The piece is
# split first by the edge planes of b through that end; the part outside b
# (positive side) is final, only the part inside goes on.
def all_neg(xs: List<&2, B.Sign>) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case s <> t:
      Bool.and(P.is_lt(s), all_neg(t))

# Sides of every plane of ps at one point q.
def planes_at(ps: List<&2, E.Plane>, +q: E.Vtx, acc: List<&2, E.Side>) -> List<&2, E.Side>:
  match ps:
    case Nil{}:
      acc
    case p <> t:
      planes_at(t, q, E.side(p, q) <> acc)

type PC is Data:
  PCGo{p: P.Poly, out: List<&2, P.Poly>, st: P.St}
  PCDone{out: List<&2, P.Poly>, st: P.St}

def pc.split(r: P.Split, out: List<&2, P.Poly>) -> PC:
  match r:
    case P.AllNeg{p, st}:
      PCGo{p, out, st}
    case P.AllPos{p, st}:
      PCDone{p <> out, st}
    case P.Both{n, p, st}:
      PCGo{n, p <> out, st}

def pc.planes(es: List<&2, E.Plane>, c: PC) -> PC:
  match es c:
    case e <> t PCGo{p, out, st}:
      pc.planes(t, pc.split(P.split(p, e, st), out))
    case _ _:
      c

def pc.pick(inside: Bool, +es: List<&2, E.Plane>, p: P.Poly, out: List<&2, P.Poly>, st: P.St) -> PC:
  match inside:
    case True{}:
      pc.planes(es, PCGo{p, out, st})
    case False{}:
      PCGo{p, out, st}

def pc.inside(+sd: List<&2, E.Side>, +es: List<&2, E.Plane>, p: P.Poly, out: List<&2, P.Poly>, st: P.St) -> PC:
  pc.pick(all_neg(P.signs(sd)), es, p, out, P.tally(sd, st))

def pc.go(xs: List<&2, XP>, c: PC) -> PC:
  match xs c:
    case XP{x, es} <> t PCGo{+p, out, st}:
      pc.go(t, pc.inside(planes_at(edge_planes(p), x, Nil{}), es, p, out, st))
    case _ _:
      c

def cut_fin(c: PC, +b: S.TriI) -> PS:
  match c:
    case PCGo{p, out, st}:
      push_split(P.split(p, tri_s(b), st), out)
    case PCDone{out, st}:
      PS{out, st}

def cut_str(hit: Bool, +xs: List<&2, XP>, +b: S.TriI, piece: P.Poly, out: List<&2, P.Poly>, st: P.St) -> PS:
  match hit:
    case True{}:
      cut_fin(pc.go(xs, PCGo{piece, out, st}), b)
    case False{}:
      PS{piece <> out, st}

# The segment where b meets t's plane reaches the interior of the piece: no
# edge plane of the piece has all segment points on its closed positive
# side. (Called only when b's plane strictly separates the piece, so the
# segment's line crosses the piece.)
def seg_meets(es: List<&2, E.Plane>, +xs: List<&2, E.Vtx>, acc: BS) -> BS:
  match es:
    case Nil{}:
      acc
    case e <> rest:
      BS{hit, st} = acc
      +sd = P.sides.go(xs, e, Nil{})
      seg_meets(rest, xs, BS{Bool.and(hit, P.any_lt(P.signs(sd))), P.tally(sd, st)})

def cut_seg.k(r: BS, +xs: List<&2, XP>, +b: S.TriI, piece: P.Poly, out: List<&2, P.Poly>) -> PS:
  BS{hit, st} = r
  cut_str(hit, xs, b, piece, out, st)

def cut_seg(near: Bool, +xs: List<&2, XP>, +b: S.TriI, +piece: P.Poly, out: List<&2, P.Poly>, st: P.St) -> PS:
  match near:
    case False{}:
      PS{piece <> out, st}
    case True{}:
      cut_seg.k(seg_meets(edge_planes(piece), xp_pts(xs, Nil{}), BS{True{}, st}), xs, b, piece, out)

def cut_one(k: PairKind, +b: S.TriI, +piece: P.Poly, out: List<&2, P.Poly>, st: P.St) -> PS:
  match k:
    case KCop{}:
      clip_cop(b, piece, out, st)
    case KStr{xs}:
      cut_seg(S.overlaps(poly_box(piece), S.tri_box(b)), xs, b, piece, out, st)
    case KEdge{xs}:
      cut_seg(S.overlaps(poly_box(piece), S.tri_box(b)), xs, b, piece, out, st)
    case KTouch{}:
      PS{piece <> out, st}
    case KApart{}:
      PS{piece <> out, st}

def cut_all(pieces: List<&2, P.Poly>, +k: PairKind, +b: S.TriI, acc: PS) -> PS:
  match pieces:
    case Nil{}:
      acc
    case p <> rest:
      PS{out, st} = acc
      cut_all(rest, k, b, cut_one(k, b, p, out, st))

# A candidate with its (precomputed) relation to t's plane.
type CK is Data:
  CK{b: S.TriI, k: PairKind}

def ck_box(c: CK) -> S.Box:
  CK{b, _} = c
  S.tri_box(b)

def arr.go(cands: List<&2, CK>, acc: PS) -> PS:
  match cands:
    case Nil{}:
      acc
    case CK{+b, +k} <> rest:
      PS{ps, st} = acc
      arr.go(rest, cut_all(ps, k, b, PS{Nil{}, st}))

# --- relations, computed once per triangle ---------------------------------------
#
# KApart and KTouch never cut (cut_one keeps the piece), so they are dropped
# here; a triangle whose candidates are all KApart touches no other surface
# (every candidate lies strictly on one side of its plane) and is free.

type KL is Data:
  KL{cks: List<&2, CK>, apart: Bool, st: P.St}

def kl_add(k: PairKind, +b: S.TriI, cks: List<&2, CK>, apart: Bool, st: P.St) -> KL:
  match k:
    case KApart{}:
      KL{cks, apart, st}
    case KTouch{}:
      KL{cks, False{}, st}
    case _:
      KL{CK{b, k} <> cks, False{}, st}

def kl_put(ks: KS, +b: S.TriI, acc: KL) -> KL:
  KS{k, st} = ks
  KL{cks, apart, _} = acc
  kl_add(k, b, cks, apart, st)

def kinds(cs: List<&2, S.TriI>, +ts: E.Plane, acc: KL) -> KL:
  match cs:
    case Nil{}:
      acc
    case +b <> rest:
      KL{cks, apart, st} = acc
      kinds(rest, ts, kl_put(kind(ts, b, st), b, KL{cks, apart, P.st0()}))

# --- local cells (EMBER-style adaptive subdivision, per triangle) ------------------
#
# A triangle with many candidate triangles is subdivided by axis-aligned grid
# planes (bisecting the longest side of its cell box) until a cell sees at
# most 16 candidates; pieces are split exactly by those planes and each cell
# is arranged independently (and in parallel). Cell planes only add cuts.

def ck_put(keep: Bool, c: CK, acc: List<&2, CK>) -> List<&2, CK>:
  match keep:
    case True{}:
      c <> acc
    case False{}:
      acc

def cands_in(cs: List<&2, CK>, +b: S.Box, acc: List<&2, CK>) -> List<&2, CK>:
  match cs:
    case Nil{}:
      acc
    case +c <> t:
      cands_in(t, b, ck_put(S.overlaps(ck_box(c), b), c, acc))

def axis_plane(k: U32, +c: B.Big) -> E.Plane:
  match k:
    case 0:
      E.plane(B.one(), B.zero(), B.zero(), B.neg(c))
    case 1:
      E.plane(B.zero(), B.one(), B.zero(), B.neg(c))
    case _:
      E.plane(B.zero(), B.zero(), B.one(), B.neg(c))

type LR is Data:
  LR{l: List<&2, P.Poly>, r: List<&2, P.Poly>, st: P.St}

def lr_put(sp: P.Split, l: List<&2, P.Poly>, r: List<&2, P.Poly>) -> LR:
  match sp:
    case P.AllNeg{p, st}:
      LR{p <> l, r, st}
    case P.AllPos{p, st}:
      LR{l, p <> r, st}
    case P.Both{n, p, st}:
      LR{n <> l, p <> r, st}

def split_all(ps: List<&2, P.Poly>, +pl: E.Plane, acc: LR) -> LR:
  match ps:
    case Nil{}:
      acc
    case p <> t:
      LR{l, r, st} = acc
      split_all(t, pl, lr_put(P.split(p, pl, st), l, r))

def half_box.k(k: U32, left: Bool, x0: F32, y0: F32, z0: F32, x1: F32, y1: F32, z1: F32, lo: F32, hi: F32) -> S.Box:
  match k left:
    case 0 True{}:
      S.Box{x0, y0, z0, hi, y1, z1}
    case 0 False{}:
      S.Box{lo, y0, z0, x1, y1, z1}
    case 1 True{}:
      S.Box{x0, y0, z0, x1, hi, z1}
    case 1 False{}:
      S.Box{x0, lo, z0, x1, y1, z1}
    case _ True{}:
      S.Box{x0, y0, z0, x1, y1, hi}
    case _ False{}:
      S.Box{x0, y0, lo, x1, y1, z1}

# Child box: the half below (left) or above the cut, padded by 2 units.
def half_box(b: S.Box, k: U32, +m: F32, left: Bool) -> S.Box:
  S.Box{x0, y0, z0, x1, y1, z1} = b
  half_box.k(k, left, x0, y0, z0, x1, y1, z1, (m - 2.0 : F32), (m + 2.0 : F32))

type Node is Data:
  NLeaf{ps: List<&2, P.Poly>, st: P.St}
  NSplit{lr: LR, k: U32, m: F32}

def prep.k(big: Bool, +b: S.Box, ps: List<&2, P.Poly>, st: P.St) -> Node:
  match big:
    case False{}:
      NLeaf{ps, st}
    case True{}:
      +k = S.box_longest(b)
      +m = F32.floor(S.box_center(b, k))
      NSplit{split_all(ps, axis_plane(k, E.f32_int(m)), LR{Nil{}, Nil{}, st}), k, m}

# Split further when the cell has more than 16 candidates, fewer than its
# parent (candidates sharing a point cannot be separated by subdividing), and
# is wider than 4096 grid units (2^-12 mm) along its longest side.
def prep(+b: S.Box, +cs: List<&2, CK>, +parent: U32, ps: List<&2, P.Poly>, st: P.St) -> Node:
  +n = M.count(&2, CK, cs)
  prep.k(Bool.and(U32.is_lt(16, n), Bool.and(U32.is_lt(n, parent), (S.box_extent(b, S.box_longest(b)) > 4096.0 : F32))), b, ps, st)

def ps_merge(a: PS, b: PS) -> PS:
  PS{ap, ast} = a
  PS{bp, bst} = b
  PS{M.rev_onto(P.Poly, List.reverse(&2, P.Poly, ap), bp), P.st_add(ast, bst)}

def cell(fuel: Nat, n: Node, +b: S.Box, +cs: List<&2, CK>) -> PS:
  match fuel:
    case 0n:
      match n:
        case NLeaf{ps, st}:
          arr.go(cs, PS{ps, st})
        case NSplit{LR{l, r, st}, _, _}:
          arr.go(cs, PS{M.rev_onto(P.Poly, l, r), st})
    case 1n+(+f):
      match n:
        case NLeaf{ps, st}:
          arr.go(cs, PS{ps, st})
        case NSplit{LR{l, r, st}, +k, +m}:
          +bl = half_box(b, k, m, True{})
          +br = half_box(b, k, m, False{})
          +cl = cands_in(cs, bl, Nil{})
          +cr = cands_in(cs, br, Nil{})
          +n = M.count(&2, CK, cs)
          x y = cell(f, prep(bl, cl, n, l, st), bl, cl) cell(f, prep(br, cr, n, r, P.st0()), br, cr)
          ps_merge(x, y)

# The pieces of triangle t against its cutting candidates (other leaves).
def arrange_k(+t: S.TriI, +cs: List<&2, CK>, st: P.St) -> PS:
  +b = S.tri_box(t)
  cell(16n, prep(b, cs, 4294967295, [tri_poly(t)], st), b, cs)
