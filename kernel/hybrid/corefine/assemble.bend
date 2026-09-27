import Base
import ../../real.bend as R
import ../../precise.bend as G
import ../mesh.bend as M
import ./util.bend as U
import ./prep.bend as P
import ./inter.bend as I

# corefine: result assembly (Manifold boolean_result.cpp Boolean3::Result:
# AddNewEdgeVerts, AppendPartialEdges, AppendNewEdges, AppendWholeEdges).
#
# From the winding numbers w03 / w30 and the crossing numbers x12 / x21 the
# operation's inclusion numbers follow (Manifold's c1, c2, c3):
#   union      i03 = 1 - w03   i30 = 1 - w30   i12 = -x12   i21 = -x21
#   subtract   i03 = 1 - w03   i30 = -w30      i12 = -x12   i21 = -x21
#   intersect  i03 = w03       i30 = w30       i12 = x12    i21 = x21
# (a negative inclusion keeps the element reversed: the inside of Q in a
# subtraction). Every output halfedge is emitted together with its twin into
# the neighbouring output face, so the result is closed and manifold by
# construction; only the polygon triangulation afterwards looks at positions.
# This prototype supports |inclusion| <= 1 (inputs that are themselves
# closed 2-manifolds give exactly that) and refuses anything else.

type XH is Data:
  XH{e: U32, f: U32, i: U32, r: U32, cid: U32, v: G.Vec3}

# A point on an edge: sort key, output vertex, tie-break id, starts a segment.
type EP is Data:
  EP{pos: R.Real, vert: U32, cid: U32, st: Bool}

# An output halfedge in output face `face` (P faces first, then Q faces).
type FH is Data:
  FH{face: U32, s: U32, e: U32}

type NE is Data:
  NE{fp: U32, fq: U32, cid: U32, vert: U32, st: Bool, v: G.Vec3}

type Ops is Data:
  Ops{c1: U32, c2: U32, neg: Bool}

def ops(op: M.Op) -> Ops:
  match op:
    case M.Union{}:
      Ops{1, 1, True{}}
    case M.Subtract{}:
      Ops{1, 0, True{}}
    case M.Intersect{}:
      Ops{0, 0, False{}}

def incl(+c: U32, neg: Bool, +w: U32) -> U32:
  (c + U.negate_if(neg, w) : U32)

def big(+i: U32) -> Bool:
  U32.is_gt(U.iabs(i), 1)

# --- vertex numbering -------------------------------------------------------------

type Remap is Data:
  Remap{inc: List<&2, U32>, idx: List<&2, U32>, pos: List<&2, G.Vec3>, next: U32, bad: Bool}

def remap.go(n: Nat, +v: U32, +c: U32, +neg: Bool, +w: U.Table<U32>, +pos: U.Table<G.Vec3>, st: Remap) -> Remap:
  match n:
    case 0n:
      Remap{inc, idx, ps, next, bad} = st
      Remap{U.rev(U32, inc), U.rev(U32, idx), U.rev(G.Vec3, ps), next, bad}
    case 1n+p:
      Remap{inc, idx, ps, +next, bad} = st
      +i = incl(c, neg, U.tget(U32, w, v, 0))
      +keep = U.nonzero(i)
      remap.go(p, (v + 1 : U32), c, neg, w, pos, Remap{i <> inc, Bool.pick(U32, keep, next, 4294967295) <> idx, U.cons_if(G.Vec3, keep, U.tget(G.Vec3, pos, v, G.v3(0.0, 0.0, 0.0)), ps), (next + U.b2u(keep) : U32), Bool.or(bad, big(i))})

# Inclusion numbers and output indices of the n vertices of an operand;
# kept vertices are numbered from `base` on.
def remap(+n: U32, +base: U32, +c: U32, +neg: Bool, +w: U.Table<U32>, +pos: U.Table<G.Vec3>) -> Remap:
  remap.go(U32.to_nat(n), 0, c, neg, w, pos, Remap{Nil{}, Nil{}, Nil{}, base, False{}})

type XS is Data:
  XS{xs: List<&2, XH>, pos: List<&2, G.Vec3>, next: U32, bad: Bool}

# Intersection vertices, numbered from `base`; collision ids from `cbase`.
def xhs.go(hs: List<&2, I.Hit>, +neg: Bool, +r: U32, +cid: U32, st: XS) -> XS:
  match hs:
    case Nil{}:
      XS{xs, ps, _, bad} = st
      XS{U.rev(XH, xs), U.rev(G.Vec3, ps), r, bad}
    case I.Hit{e, f, x, +v} <> t:
      XS{xs, ps, n, bad} = st
      +i = U.negate_if(neg, x)
      xhs.go(t, neg, (r + 1 : U32), (cid + 1 : U32), XS{XH{e, f, i, r, cid, v} <> xs, v <> ps, n, Bool.or(bad, U32.is_ne(U.iabs(i), 1))})

def xhs(hs: List<&2, I.Hit>, +neg: Bool, +base: U32, +cbase: U32) -> XS:
  xhs.go(hs, neg, base, cbase, XS{Nil{}, Nil{}, base, False{}})

# --- pairing points along a line (Manifold PairUp) ----------------------------------

def ep_le(a: EP, b: EP) -> Bool:
  EP{+ap, ac, _, _} = a
  EP{+bp, bc, _, _} = b
  Bool.or(R.less(ap, bp), Bool.and(R.equal(ap, bp), U32.is_le(ac, bc)))

def ep_split(xs: List<&2, EP>, ss: List<&2, U32>, es: List<&2, U32>) -> List<&2, U32> & List<&2, U32>:
  match xs:
    case Nil{}:
      (U.rev(U32, ss), U.rev(U32, es))
    case EP{_, v, _, True{}} <> t:
      ep_split(t, v <> ss, es)
    case EP{_, v, _, False{}} <> t:
      ep_split(t, ss, v <> es)

type Pairs is Data:
  Pairs{bad: Bool, fh: List<&2, FH>}

def zip_fh(ss: List<&2, U32>, es: List<&2, U32>, +fl: U32, +fr: U32, acc: Pairs) -> Pairs:
  match ss es:
    case Nil{} Nil{}:
      acc
    case +s <> st +e <> et:
      Pairs{b, fh} = acc
      zip_fh(st, et, fl, fr, Pairs{b, FH{fl, s, e} <> FH{fr, e, s} <> fh})
    case _ _:
      Pairs{_, fh} = acc
      Pairs{True{}, fh}

def pairup.k(p: List<&2, U32> & List<&2, U32>, +fl: U32, +fr: U32, acc: Pairs) -> Pairs:
  (ss, es) = p
  zip_fh(ss, es, fl, fr, acc)

# Sort the points, pair the i-th start with the i-th end; each segment goes
# into face fl as s -> e and into face fr as e -> s.
def pairup(eps: List<&2, EP>, +fl: U32, +fr: U32, acc: Pairs) -> Pairs:
  pairup.k(ep_split(U.sort(~EP, ~ep_le, eps), Nil{}, Nil{}), fl, fr, acc)

# --- partial edges (Manifold AppendPartialEdges) -------------------------------------

# Operand tables used by the assembly of one side.
type Side is Data:
  Side{pos: U.Table<G.Vec3>, tv: U.Table<U32>, pair: U.Table<U32>, inc: U.Table<U32>, idx: U.Table<U32>, off: U32}

def xh_eps(xs: List<&2, XH>, +ev: G.Vec3, acc: List<&2, EP>) -> List<&2, EP>:
  match xs:
    case Nil{}:
      acc
    case XH{_, _, i, r, cid, v} <> t:
      xh_eps(t, ev, EP{G.dot(v, ev), r, cid, U.is_neg(i)} <> acc)

# A kept endpoint of the edge; at the start it starts a segment when kept
# forward, at the end when kept reversed.
def end_ep(+i: U32, +idx: U32, +p: G.Vec3, +ev: G.Vec3, atStart: Bool, acc: List<&2, EP>) -> List<&2, EP>:
  U.cons_if(EP, U.nonzero(i), EP{G.dot(p, ev), idx, 4294967295, Bool.pick(Bool, atStart, Bool.not(U.is_neg(i)), U.is_neg(i))}, acc)

def partial_edge(+h: U32, xs: List<&2, XH>, +sd: Side, acc: Pairs) -> Pairs:
  Side{+pos, +tv, +pair, +inc, +idx, +off} = sd
  +vs = U.tget(U32, tv, h, 0)
  +ve = U.tget(U32, tv, P.next3(h), 0)
  +z = G.v3(0.0, 0.0, 0.0)
  +ps = U.tget(G.Vec3, pos, vs, z)
  +pe = U.tget(G.Vec3, pos, ve, z)
  +ev = G.sub(pe, ps)
  eps0 = xh_eps(xs, ev, Nil{})
  eps1 = end_ep(U.tget(U32, inc, ve, 0), U.tget(U32, idx, ve, 0), pe, ev, False{}, eps0)
  eps2 = end_ep(U.tget(U32, inc, vs, 0), U.tget(U32, idx, vs, 0), ps, ev, True{}, eps1)
  pairup(eps2, (off + U32.div(h, 3) : U32), (off + U32.div(U.tget(U32, pair, h, 0), 3) : U32), acc)

# Group consecutive intersections of the same edge.
type EG is Data:
  EG{e: U32, xs: List<&2, XH>}

type Grp is Data:
  Grp{e: U32, cur: List<&2, XH>, acc: List<&2, EG>}

def grp.step.if(same: Bool, +e: U32, +x: XH, g: Grp) -> Grp:
  match same:
    case True{}:
      Grp{ce, cur, acc} = g
      Grp{ce, x <> cur, acc}
    case False{}:
      Grp{+ce, +cur, acc} = g
      Grp{e, [x], U.cons_if(EG, U.nonzero(U.len(XH, cur)), EG{ce, U.rev(XH, cur)}, acc)}

def xh_e(x: XH) -> U32:
  XH{e, _, _, _, _, _} = x
  e

def grp.step(+x: XH, +g: Grp) -> Grp:
  Grp{ce, _, _} = g
  +e = xh_e(x)
  grp.step.if(U32.is_eq(e, ce), e, x, g)

def grp.go(xs: List<&2, XH>, g: Grp) -> Grp:
  match xs:
    case Nil{}:
      g
    case x <> t:
      grp.go(t, grp.step(x, g))

def grp.fin(g: Grp) -> List<&2, EG>:
  Grp{+ce, +cur, acc} = g
  U.rev(EG, U.cons_if(EG, U.nonzero(U.len(XH, cur)), EG{ce, U.rev(XH, cur)}, acc))

def groups(xs: List<&2, XH>) -> List<&2, EG>:
  grp.fin(grp.go(xs, Grp{4294967295, Nil{}, Nil{}}))

def partial_edges(gs: List<&2, EG>, +sd: Side, acc: Pairs) -> Pairs:
  match gs:
    case Nil{}:
      acc
    case EG{h, xs} <> t:
      partial_edges(t, sd, partial_edge(h, xs, sd, acc))

# --- whole edges (Manifold AppendWholeEdges) -------------------------------------------

type WSt is Type:
  WSt{brk: Array<U32>, acc: List<&2, FH>}

def whole.emit(broken: Bool, +h: U32, +sd: Side, acc: List<&2, FH>) -> List<&2, FH>:
  match broken:
    case True{}:
      acc
    case False{}:
      Side{_, +tv, +pair, +inc, +idx, +off} = sd
      +vs = U.tget(U32, tv, h, 0)
      +ve = U.tget(U32, tv, P.next3(h), 0)
      +i = U.tget(U32, inc, vs, 0)
      +s = U.tget(U32, idx, vs, 0)
      +e = U.tget(U32, idx, ve, 0)
      +fl = (off + U32.div(h, 3) : U32)
      +fr = (off + U32.div(U.tget(U32, pair, h, 0), 3) : U32)
      +rev = U.is_neg(i)
      U.cons_if(FH, U.nonzero(i), FH{fl, Bool.pick(U32, rev, e, s), Bool.pick(U32, rev, s, e)}, U.cons_if(FH, U.nonzero(i), FH{fr, Bool.pick(U32, rev, s, e), Bool.pick(U32, rev, e, s)}, acc))

def whole.k(r: Array<U32> & U32, +h: U32, +sd: Side, acc: List<&2, FH>) -> WSt:
  (brk, b) = r
  WSt{brk, whole.emit(U.nonzero(b), h, sd, acc)}

def whole.step(it: P.EItem, st: WSt, +sd: Side) -> WSt:
  P.EItem{+h, _, _} = it
  WSt{brk, acc} = st
  whole.k(Array.get(U32, brk, h), h, sd, acc)

def whole.go(es: List<&2, P.EItem>, st: WSt, +sd: Side) -> WSt:
  match es:
    case Nil{}:
      st
    case e <> t:
      whole.go(t, whole.step(e, st, sd), sd)

def whole.fin(st: WSt) -> List<&2, FH>:
  WSt{_, acc} = st
  acc

# Unbroken edges with kept endpoints, both halfedges.
def whole(es: List<&2, P.EItem>, hs: List<&2, I.Hit>, +n3: U32, +sd: Side) -> List<&2, FH>:
  whole.fin(whole.go(es, WSt{I.mark(hs, Array.new(U32, U.depth(n3), 0)), Nil{}}, sd))

# --- new edges (Manifold AddNewEdgeVerts / AppendNewEdges) -------------------------------

def ne_le(a: NE, b: NE) -> Bool:
  NE{+ap, +aq, ac, _, _, _} = a
  NE{+bp, +bq, bc, _, _, _} = b
  Bool.or(U32.is_lt(ap, bp), Bool.and(U32.is_eq(ap, bp), Bool.or(U32.is_lt(aq, bq), Bool.and(U32.is_eq(aq, bq), U32.is_le(ac, bc)))))


def ne_of.two(fwd: Bool, +d: Bool, +right: U32, +left: U32, +f: U32, +r: U32, +cid: U32, +v: G.Vec3, acc: List<&2, NE>) -> List<&2, NE>:
  match fwd:
    case True{}:
      NE{right, f, cid, r, d, v} <> NE{left, f, cid, r, Bool.not(d), v} <> acc
    case False{}:
      NE{f, right, cid, r, Bool.not(d), v} <> NE{f, left, cid, r, d, v} <> acc

# fwd: x is an edge of P crossing a face of Q; otherwise an edge of Q
# crossing a face of P. `pair` is the edge operand's pairing.
def ne_of(xs: List<&2, XH>, +fwd: Bool, +pair: U.Table<U32>, acc: List<&2, NE>) -> List<&2, NE>:
  match xs:
    case Nil{}:
      acc
    case XH{+e, +f, i, +r, +cid, +v} <> t:
      +d = U.is_neg(i)
      +right = U32.div(U.tget(U32, pair, e, 0), 3)
      +left = U32.div(e, 3)
      ne_of(t, fwd, pair, ne_of.two(fwd, d, right, left, f, r, cid, v, acc))

type NG is Data:
  NG{fp: U32, fq: U32, xs: List<&2, NE>}

type NGrp is Data:
  NGrp{fp: U32, fq: U32, cur: List<&2, NE>, acc: List<&2, NG>}

def ngrp.close(+fp: U32, +fq: U32, +cur: List<&2, NE>, acc: List<&2, NG>) -> List<&2, NG>:
  U.cons_if(NG, U.nonzero(U.len(NE, cur)), NG{fp, fq, U.rev(NE, cur)}, acc)

def ngrp.step.if(same: Bool, +x: NE, +fp: U32, +fq: U32, g: NGrp) -> NGrp:
  match same:
    case True{}:
      NGrp{a, b, cur, acc} = g
      NGrp{a, b, x <> cur, acc}
    case False{}:
      NGrp{a, b, cur, acc} = g
      NGrp{fp, fq, [x], ngrp.close(a, b, cur, acc)}

def ngrp.step(+x: NE, +g: NGrp) -> NGrp:
  NE{+fp, +fq, _, _, _, _} = x
  NGrp{+a, +b, _, _} = g
  ngrp.step.if(Bool.and(U32.is_eq(fp, a), U32.is_eq(fq, b)), x, fp, fq, g)

def ngrp.go(xs: List<&2, NE>, g: NGrp) -> NGrp:
  match xs:
    case Nil{}:
      g
    case x <> t:
      ngrp.go(t, ngrp.step(x, g))

def ngrp.fin(g: NGrp) -> List<&2, NG>:
  NGrp{a, b, cur, acc} = g
  U.rev(NG, ngrp.close(a, b, cur, acc))

type RB is Data:
  RB{lo: G.Vec3, hi: G.Vec3}

def rb_add(b: RB, +v: G.Vec3) -> RB:
  RB{lo, hi} = b
  G.V3{lx, ly, lz} = lo
  G.V3{hx, hy, hz} = hi
  RB{G.V3{R.min(lx, U.vx(v)), R.min(ly, U.vy(v)), R.min(lz, U.vz(v))}, G.V3{R.max(hx, U.vx(v)), R.max(hy, U.vy(v)), R.max(hz, U.vz(v))}}

def ne_box(xs: List<&2, NE>, b: RB) -> RB:
  match xs:
    case Nil{}:
      b
    case NE{_, _, _, _, _, v} <> t:
      ne_box(t, rb_add(b, v))

def ne_first(xs: List<&2, NE>) -> G.Vec3:
  match xs:
    case Nil{}:
      G.v3(0.0, 0.0, 0.0)
    case NE{_, _, _, _, _, v} <> _:
      v

# Longest box dimension: 0 x, 1 y, 2 z (Manifold AppendNewEdges).
def rb_axis(b: RB) -> U32:
  RB{lo, hi} = b
  +d = G.sub(hi, lo)
  +sx = U.vx(d)
  +sy = U.vy(d)
  +sz = U.vz(d)
  Bool.pick(U32, Bool.and(R.less(sy, sx), R.less(sz, sx)), 0, Bool.pick(U32, R.less(sz, sy), 1, 2))

def coord(+ax: U32, +v: G.Vec3) -> R.Real:
  U.rpick(U32.is_eq(ax, 0), U.vx(v), U.rpick(U32.is_eq(ax, 1), U.vy(v), U.vz(v)))

def ne_eps(xs: List<&2, NE>, +ax: U32, acc: List<&2, EP>) -> List<&2, EP>:
  match xs:
    case Nil{}:
      acc
    case NE{_, _, cid, vert, st, v} <> t:
      ne_eps(t, ax, EP{coord(ax, v), vert, cid, st} <> acc)

def new_edges(gs: List<&2, NG>, +ntP: U32, acc: Pairs) -> Pairs:
  match gs:
    case Nil{}:
      acc
    case NG{fp, fq, +xs} <> t:
      +v0 = ne_first(xs)
      new_edges(t, ntP, pairup(ne_eps(xs, rb_axis(ne_box(xs, RB{v0, v0})), Nil{}), fp, (ntP + fq : U32), acc))

def new_groups(ns: List<&2, NE>) -> List<&2, NG>:
  ngrp.fin(ngrp.go(U.sort(~NE, ~ne_le, ns), NGrp{4294967295, 4294967295, Nil{}, Nil{}}))

# --- face loops (Manifold AssembleHalfedges) ----------------------------------------------
# Halfedges sorted by (face, start) are the targets; the same halfedges sorted
# by (face, end) are the queries. In a face whose halfedges close up, every
# vertex is as often a start as an end, so the i-th query is followed by the
# i-th target: next = zip of the two orders (a vertex met twice is paired in
# order, like Manifold's multimap).

def fh_le(a: FH, b: FH) -> Bool:
  FH{+af, +as, ae} = a
  FH{+bf, +bs, be} = b
  Bool.or(U32.is_lt(af, bf), Bool.and(U32.is_eq(af, bf), Bool.or(U32.is_lt(as, bs), Bool.and(U32.is_eq(as, bs), U32.is_le(ae, be)))))

# (face, end, rank)
type QK is Data:
  QK{f: U32, e: U32, i: U32}

def qk_le(a: QK, b: QK) -> Bool:
  QK{+af, +ae, ai} = a
  QK{+bf, +be, bi} = b
  Bool.or(U32.is_lt(af, bf), Bool.and(U32.is_eq(af, bf), Bool.or(U32.is_lt(ae, be), Bool.and(U32.is_eq(ae, be), U32.is_le(ai, bi)))))

def queries(ts: List<&2, FH>, +i: U32, acc: List<&2, QK>) -> List<&2, QK>:
  match ts:
    case Nil{}:
      acc
    case FH{f, _, e} <> t:
      queries(t, (i + 1 : U32), QK{f, e, i} <> acc)

type NX is Type:
  NX{bad: Bool, next: Array<U32>}

def link(qs: List<&2, QK>, ts: List<&2, FH>, +j: U32, st: NX) -> NX:
  match qs ts:
    case QK{+qf, +qe, qi} <> qt FH{+tf, +ts, _} <> tt:
      NX{bad, nx} = st
      link(qt, tt, (j + 1 : U32), NX{Bool.or(bad, Bool.not(Bool.and(U32.is_eq(qf, tf), U32.is_eq(qe, ts)))), Array.set(U32, nx, qi, j)})
    case _ _:
      st

type TSt is Type:
  TSt{nx: Array<U32>, vis: Array<U32>, j: U32, st: U32, vs: List<&2, U32>, stab: U.Table<U32>}

def tstep.if(done: Bool, s: TSt) -> U.Step<TSt>:
  match done:
    case True{}:
      U.CfDone{s}
    case False{}:
      U.CfMore{s}

def tstep.k(r: Array<U32> & U32, vis: Array<U32>, +st: U32, vs: List<&2, U32>, stab: U.Table<U32>) -> U.Step<TSt>:
  (nx, +j2) = r
  tstep.if(U32.is_eq(j2, st), TSt{nx, vis, j2, st, vs, stab})

def tstep(s: TSt) -> U.Step<TSt>:
  TSt{nx, vis, +j, st, vs, +stab} = s
  tstep.k(Array.get(U32, nx, j), Array.set(U32, vis, j, 1), st, U.tget(U32, stab, j, 0) <> vs, stab)

type Loop is Data:
  Loop{face: U32, vs: List<&2, U32>}

type SSt is Type:
  SSt{nx: Array<U32>, vis: Array<U32>, loops: List<&2, Loop>}

def scan.traced(t: TSt, +face: U32, loops: List<&2, Loop>) -> SSt:
  TSt{nx, vis, _, _, vs, _} = t
  SSt{nx, vis, Loop{face, U.rev(U32, vs)} <> loops}

def scan.if(seen: Bool, nx: Array<U32>, vis: Array<U32>, +i: U32, +face: U32, +stab: U.Table<U32>, +fuel: Nat, loops: List<&2, Loop>) -> SSt:
  match seen:
    case True{}:
      SSt{nx, vis, loops}
    case False{}:
      scan.traced(U.loop(~TSt, ~tstep, fuel, U.CfMore{TSt{nx, vis, i, i, Nil{}, stab}}), face, loops)

def scan.k(r: Array<U32> & U32, nx: Array<U32>, +i: U32, +face: U32, +stab: U.Table<U32>, +fuel: Nat, loops: List<&2, Loop>) -> SSt:
  (vis, v) = r
  scan.if(U.nonzero(v), nx, vis, i, face, stab, fuel, loops)

def scan(ts: List<&2, FH>, +i: U32, st: SSt, +stab: U.Table<U32>, +fuel: Nat) -> SSt:
  match ts:
    case Nil{}:
      st
    case FH{face, _, _} <> t:
      SSt{nx, vis, loops} = st
      scan(t, (i + 1 : U32), scan.k(Array.get(U32, vis, i), nx, i, face, stab, fuel, loops), stab, fuel)

def fh_starts(ts: List<&2, FH>, acc: List<&2, U32>) -> List<&2, U32>:
  match ts:
    case Nil{}:
      U.rev(U32, acc)
    case FH{_, s, _} <> t:
      fh_starts(t, s <> acc)

type Loops is Data:
  Loops{bad: Bool, loops: List<&2, Loop>}

def loops.fin(st: SSt, bad: Bool) -> Loops:
  SSt{_, _, loops} = st
  Loops{bad, U.rev(Loop, loops)}

def loops.k(nx: NX, +ts: List<&2, FH>, +n: U32) -> Loops:
  NX{bad, next} = nx
  +fuel = U32.to_nat((n + 1 : U32))
  loops.fin(scan(ts, 0, SSt{next, Array.new(U32, U.depth(n), 0), Nil{}}, U.table(U32, n, fh_starts(ts, Nil{})), fuel), bad)

# All halfedges of all output faces -> the vertex loops of every face, in face
# order. bad: some face's halfedges do not close up.
def loops(fhs: List<&2, FH>) -> Loops:
  +ts = U.sort(~FH, ~fh_le, fhs)
  +n = U.len(FH, ts)
  loops.k(link(U.sort(~QK, ~qk_le, queries(ts, 0, Nil{})), ts, 0, NX{False{}, Array.new(U32, U.depth(n), 0)}), ts, n)

def remap_next(r: Remap) -> U32:
  Remap{_, _, _, n, _} = r
  n

def xs_next(x: XS) -> U32:
  XS{_, _, n, _} = x
  n
