import Base
import ../../real.bend as R
import ../../precise.bend as G
import ../mesh.bend as M
import ./big.bend as B
import ./geom.bend as E
import ./poly.bend as P
import ./setup.bend as S
import ./psort.bend as Z

# Output assembly: kept convex pieces become a watertight triangle mesh.
#
# Pieces meet edge to edge geometrically but not combinatorially: a cut that
# ends on a neighbour's edge leaves a T-junction. Every vertex that lies
# exactly on the open edge of a kept piece (exact plane-side tests: on the
# support plane and the edge plane, strictly inside both neighbouring edge
# planes) is inserted into that edge; each augmented convex polygon is then
# ear-clipped at strict corners only, so no triangle is degenerate in exact
# arithmetic. Vertices are rounded once, deterministically, to the 2^-36 mm
# grid (E.round_vertex); two different exact vertices that round to the
# same point are refused (never merged silently).

# A distinct output point: exact vertex, rounded position, approximate grid
# position (for the search tree).
type Pt is Data:
  Pt{v: E.Vtx, r: G.Vec3, x: F32, y: F32, z: F32, ok: Bool, id: U32, disp: F32}

def mk_pt.k(+v: E.Vtx, rv: E.RVX) -> Pt:
  E.RVX{r, ok, disp} = rv
  Pt{v, r, E.approx_u(v, 0), E.approx_u(v, 1), E.approx_u(v, 2), ok, 4294967295, disp}

def mk_pt(+v: E.Vtx) -> Pt:
  mk_pt.k(v, E.round_vertex(v))

# --- ordering and equality of rounded positions ---------------------------------

def rless(a: R.Real, b: R.Real) -> Bool:
  R.less(a, b)

def req(a: R.Real, b: R.Real) -> Bool:
  R.equal(a, b)

def v3_eq(a: G.Vec3, b: G.Vec3) -> Bool:
  G.V3{ax, ay, az} = a
  G.V3{bx, by, bz} = b
  Bool.and(req(ax, bx), Bool.and(req(ay, by), req(az, bz)))

def v3_le(a: G.Vec3, b: G.Vec3) -> Bool:
  G.V3{+ax, +ay, az} = a
  G.V3{+bx, +by, bz} = b
  Bool.or(rless(ax, bx), Bool.and(req(ax, bx), Bool.or(rless(ay, by), Bool.and(req(ay, by), Bool.not(rless(bz, az))))))

def pt_r(p: Pt) -> G.Vec3:
  Pt{_, r, _, _, _, _, _, _} = p
  r

def pt_v(p: Pt) -> E.Vtx:
  Pt{v, _, _, _, _, _, _, _} = p
  v

def pt_le(a: Pt, b: Pt) -> Bool:
  v3_le(pt_r(a), pt_r(b))

# Sorted points -> distinct points; `bad` counts rounding collisions.
type Uniq is Data:
  Uniq{ps: List<&2, Pt>, bad: U32}

def uniq.step(same_r: Bool, +p: Pt, +last: Pt, u: Uniq) -> Uniq:
  match same_r:
    case True{}:
      Uniq{ps, bad} = u
      Uniq{ps, (bad + Bool.to_u32(Bool.not(E.same(pt_v(p), pt_v(last)))) : U32)}
    case False{}:
      Uniq{ps, bad} = u
      Uniq{p <> ps, bad}

def uniq.go(xs: List<&2, Pt>, +last: Pt, u: Uniq) -> Uniq:
  match xs:
    case Nil{}:
      u
    case +p <> t:
      uniq.go(t, p, uniq.step(v3_eq(pt_r(p), pt_r(last)), p, last, u))

def pt_id(p: Pt) -> U32:
  Pt{_, _, _, _, _, _, id, _} = p
  id

def with_id(p: Pt, +id: U32) -> Pt:
  Pt{v, r, x, y, z, ok, _, d} = p
  Pt{v, r, x, y, z, ok, id, d}

# Points get ids 0, 1, ... in list order (the list order is kept).
def number(xs: List<&2, Pt>, +n: U32, acc: List<&2, Pt>) -> List<&2, Pt>:
  match xs:
    case Nil{}:
      List.reverse(&2, Pt, acc)
    case p <> t:
      number(t, (n + 1 : U32), with_id(p, n) <> acc)

def uniq(xs: List<&2, Pt>) -> Uniq:
  match xs:
    case Nil{}:
      Uniq{Nil{}, 0}
    case +p <> t:
      uniq.go(t, p, Uniq{[p], 0})

# --- a search tree over distinct points ------------------------------------------

type PB is Data:
  PL{box: S.Box, ps: List<&2, Pt>}
  PN{box: S.Box, l: PB, r: PB}

def pt_box(p: Pt) -> S.Box:
  Pt{_, _, x, y, z, _, _, _} = p
  S.box_pt(x, y, z)

def pts_box(ps: List<&2, Pt>, acc: S.Box) -> S.Box:
  match ps:
    case Nil{}:
      acc
    case p <> t:
      pts_box(t, S.box_union(acc, pt_box(p)))

def pt_center(p: Pt, k: U32) -> F32:
  Pt{_, _, x, y, z, _, _, _} = p
  S.sel3(k, x, y, z)

type PP is Data:
  PP{l: List<&2, Pt>, nl: U32, r: List<&2, Pt>, nr: U32}

def pp.put(left: Bool, p: Pt, acc: PP) -> PP:
  match left:
    case True{}:
      PP{l, nl, r, nr} = acc
      PP{p <> l, (nl + 1 : U32), r, nr}
    case False{}:
      PP{l, nl, r, nr} = acc
      PP{l, nl, p <> r, (nr + 1 : U32)}

type EI is Data:
  EI{i: U32, s: Bool, p: G.Vec3}

type DS is Type:
  DS{e: Array<EI>, q: Array<F32>, c: Array<U32>}

type BK is Data:
  BK{q: F32, k: U32}

def ds.e1(pr: Array<EI> & EI, q: Array<F32>, c: Array<U32>) -> DS & EI:
  (e, v) = pr
  (DS{e, q, c}, v)

def ds_e(ds: DS, +i: U32) -> DS & EI:
  DS{e, q, c} = ds
  ds.e1(Array.get(EI, e, i), q, c)

def ei_pos(x: EI) -> G.Vec3:
  EI{_, _, p} = x
  p

def rdiff(a: R.Real, b: R.Real) -> F32:
  R.approx(R.sub(a, b))

type D3 is Data:
  D3{x: F32, y: F32, z: F32}

def d3(a: G.Vec3, b: G.Vec3) -> D3:
  G.V3{ax, ay, az} = a
  G.V3{bx, by, bz} = b
  D3{rdiff(bx, ax), rdiff(by, ay), rdiff(bz, az)}

def len2(d: D3) -> F32:
  D3{+x, +y, +z} = d
  (x * x + y * y + z * z : F32)

def cross_len2(u: D3, v: D3) -> F32:
  D3{+ux, +uy, +uz} = u
  D3{+vx, +vy, +vz} = v
  +cx = (uy * vz - uz * vy : F32)
  +cy = (uz * vx - ux * vz : F32)
  +cz = (ux * vy - uy * vx : F32)
  (cx * cx + cy * cy + cz * cz : F32)

type RD is Data:
  RD{x: R.Real, y: R.Real, z: R.Real}

def rd3(a: G.Vec3, b: G.Vec3) -> RD:
  G.V3{ax, ay, az} = a
  G.V3{bx, by, bz} = b
  RD{R.sub(bx, ax), R.sub(by, ay), R.sub(bz, az)}

def rd_len2(d: RD) -> F32:
  RD{x, y, z} = d
  +fx = R.approx(x)
  +fy = R.approx(y)
  +fz = R.approx(z)
  (fx * fx + fy * fy + fz * fz : F32)

# |u x v|^2 with the cross product formed in F32x2 (thin triangles keep their
# height to about 1e-13 mm instead of F32's 1e-7).
def rd_cross2(u: RD, v: RD) -> F32:
  RD{+ux, +uy, +uz} = u
  RD{+vx, +vy, +vz} = v
  +cx = R.approx(R.sub(R.mul(uy, vz), R.mul(uz, vy)))
  +cy = R.approx(R.sub(R.mul(uz, vx), R.mul(ux, vz)))
  +cz = R.approx(R.sub(R.mul(ux, vy), R.mul(uy, vx)))
  (cx * cx + cy * cy + cz * cz : F32)

# Smallest height of triangle (a, b, c): 2 area / longest edge (mm).
def height(+a: G.Vec3, +b: G.Vec3, +c: G.Vec3) -> F32:
  +u = rd3(a, b)
  +v = rd3(a, c)
  +l = F32.max(rd_len2(u), F32.max(rd_len2(v), rd_len2(rd3(b, c))))
  F32.sqrt((rd_cross2(u, v) / F32.max(l, 0.000000000000000000000000000000000001) : F32))

def ds.q1(e: Array<EI>, pr: Array<F32> & F32, c: Array<U32>) -> DS & F32:
  (q, v) = pr
  (DS{e, q, c}, v)

def ds_q(ds: DS, +i: U32) -> DS & F32:
  DS{e, q, c} = ds
  ds.q1(e, Array.get(F32, q, i), c)

# Candidate k for the interval (i, j): min(height(i, k, j), Q[i][k], Q[k][j]).
def cand.qkj(r: DS & F32, +h: F32, +qik: F32) -> DS & F32:
  (ds, qkj) = r
  (ds, F32.min(h, F32.min(qik, qkj)))

def cand.qik(r: DS & F32, +h: F32, +kj: U32) -> DS & F32:
  (ds, qik) = r
  cand.qkj(ds_q(ds, kj), h, qik)

def cand.pj(r: DS & EI, +pi: G.Vec3, +pk: G.Vec3, +ik: U32, +kj: U32) -> DS & F32:
  (ds, ej) = r
  cand.qik(ds_q(ds, ik), height(pi, pk, ei_pos(ej)), kj)

def cand.pk(r: DS & EI, +pi: G.Vec3, +j: U32, +ik: U32, +kj: U32) -> DS & F32:
  (ds, ek) = r
  cand.pj(ds_e(ds, j), pi, ei_pos(ek), ik, kj)

def cand.pi(r: DS & EI, +k: U32, +j: U32, +ik: U32, +kj: U32) -> DS & F32:
  (ds, ei) = r
  cand.pk(ds_e(ds, k), ei_pos(ei), j, ik, kj)

def cand(ds: DS, +i: U32, +k: U32, +j: U32, +w: U32) -> DS & F32:
  cand.pi(ds_e(ds, i), k, j, (i * w + k : U32), (k * w + j : U32))

def step.k(r: DS & F32, +k: U32, b: BK) -> DS & BK:
  (ds, +h) = r
  BK{+bq, +bk} = b
  (ds, Bool.pick(BK, (h > bq : F32), BK{h, k}, BK{bq, bk}))

def inner(fuel: Nat, st: DS & BK, +i: U32, +j: U32, +k: U32, +w: U32) -> DS & BK:
  match fuel:
    case 0n:
      st
    case 1n+f:
      (ds, b) = st
      inner(f, step.k(cand(ds, i, k, j, w), k, b), i, j, (k + 1 : U32), w)

def ds_set(ds: DS, +i: U32, +v: F32, +k: U32) -> DS:
  DS{e, q, c} = ds
  DS{e, Array.set(F32, q, i, v), Array.set(U32, c, i, k)}

def mid.fin(r: DS & BK, +idx: U32) -> DS:
  (ds, b) = r
  BK{q, k} = b
  ds_set(ds, idx, q, k)

def mid(fuel: Nat, ds: DS, +i: U32, +len: U32, +w: U32) -> DS:
  match fuel:
    case 0n:
      ds
    case 1n+f:
      +j = (i + len : U32)
      mid(f, mid.fin(inner(U32.to_nat((len - 1 : U32)), (ds, BK{F32.neg(1.0), 0}), i, j, (i + 1 : U32), w), (i * w + j : U32)), (i + 1 : U32), len, w)

def pp.go(ps: List<&2, Pt>, +k: U32, +mid: F32, acc: PP) -> PP:
  match ps:
    case Nil{}:
      acc
    case +p <> t:
      pp.go(t, k, mid, pp.put((pt_center(p, k) < mid : F32), p, acc))

def pp.halves(ps: List<&2, Pt>, k: Nat, acc: PP) -> PP:
  match ps k:
    case Nil{} _:
      acc
    case p <> +t 0n:
      PP{l, nl, _, _} = acc
      PP{l, nl, p <> t, (M.count(&2, Pt, t) + 1 : U32)}
    case p <> t 1n+q:
      PP{l, nl, r, nr} = acc
      pp.halves(t, q, PP{p <> l, (nl + 1 : U32), r, nr})

def pp.fix(lz: Bool, rz: Bool, p: PP) -> PP:
  match lz rz:
    case True{} _:
      PP{_, _, r, +nr} = p
      pp.halves(r, U32.to_nat((nr >> 1n : U32)), PP{Nil{}, 0, Nil{}, 0})
    case False{} True{}:
      PP{l, +nl, _, _} = p
      pp.halves(l, U32.to_nat((nl >> 1n : U32)), PP{Nil{}, 0, Nil{}, 0})
    case False{} False{}:
      p

def pp.k(+p: PP) -> PP:
  PP{_, +nl, _, +nr} = p
  pp.fix(U32.is_eq(nl, 0), U32.is_eq(nr, 0), p)

def pts_centers(ps: List<&2, Pt>, acc: S.Box) -> S.Box:
  match ps:
    case Nil{}:
      acc
    case Pt{_, _, x, y, z, _, _, _} <> t:
      pts_centers(t, S.box_union(acc, S.box_at(x, y, z)))

def pp_part(+ps: List<&2, Pt>) -> PP:
  +cb = pts_centers(ps, S.box_empty())
  +k = S.box_longest(cb)
  pp.k(pp.go(ps, k, S.box_center(cb, k), PP{Nil{}, 0, Nil{}, 0}))

def pb_box(t: PB) -> S.Box:
  match t:
    case PL{b, _}:
      b
    case PN{b, _, _}:
      b

def mk_pn(+a: PB, +b: PB) -> PB:
  PN{S.box_union(pb_box(a), pb_box(b)), a, b}

def pb_leaf(p: PP) -> PB:
  PP{l, _, r, _} = p
  +all = List.append(&2, Pt, l, r)
  PL{pts_box(all, S.box_empty()), all}

def pb_build(t: Nat, leaf: Bool, p: PP) -> PB:
  match t:
    case 0n:
      pb_leaf(p)
    case 1n+(+f):
      match leaf:
        case True{}:
          pb_leaf(p)
        case False{}:
          PP{+l, +nl, +r, +nr} = p
          a b = pb_build(f, U32.is_le(nl, 8), pp_part(l)) pb_build(f, U32.is_le(nr, 8), pp_part(r))
          mk_pn(a, b)

def pb(+ps: List<&2, Pt>) -> PB:
  +n = M.count(&2, Pt, ps)
  pb_build(48n, U32.is_le(n, 8), PP{ps, n, Nil{}, 0})

# --- segment queries (F32 slab test, padded) --------------------------------------

type Seg is Data:
  Seg{ax: F32, ay: F32, az: F32, bx: F32, by: F32, bz: F32}

def slab.k(+lo: F32, +hi: F32, +a: F32, +d: F32, +t0: F32, +t1: F32) -> F32 & F32:
  +u = ((lo - a : F32) / d : F32)
  +v = ((hi - a : F32) / d : F32)
  (F32.max(t0, F32.min(u, v)), F32.min(t1, F32.max(u, v)))

def slab.flat(inside: Bool, +t0: F32, +t1: F32) -> F32 & F32:
  match inside:
    case True{}:
      (t0, t1)
    case False{}:
      (1.0, 0.0)

def slab.pick(moving: Bool, +lo: F32, +hi: F32, +a: F32, +d: F32, +t0: F32, +t1: F32) -> F32 & F32:
  match moving:
    case True{}:
      slab.k(lo, hi, a, d, t0, t1)
    case False{}:
      slab.flat(Bool.and((lo <= a : F32), (a <= hi : F32)), t0, t1)

def slab(+lo: F32, +hi: F32, +a: F32, +b: F32, +t0: F32, +t1: F32) -> F32 & F32:
  +d = (b - a : F32)
  slab.pick((F32.abs(d) > 0.000001 : F32), lo, hi, a, d, t0, t1)

def seg_hit.fin(p: F32 & F32) -> Bool:
  (t0, t1) = p
  (t0 <= t1 : F32)

def seg_hit.z(+z0: F32, +z1: F32, +az: F32, +bz: F32, p: F32 & F32) -> Bool:
  (t0, t1) = p
  seg_hit.fin(slab(z0, z1, az, bz, t0, t1))

def seg_hit.y(+y0: F32, +y1: F32, +ay: F32, +by: F32, +z0: F32, +z1: F32, +az: F32, +bz: F32, p: F32 & F32) -> Bool:
  (t0, t1) = p
  seg_hit.z(z0, z1, az, bz, slab(y0, y1, ay, by, t0, t1))

def seg_hit(sg: Seg, b: S.Box) -> Bool:
  Seg{+ax, +ay, +az, +bx, +by, +bz} = sg
  S.Box{x0, y0, z0, x1, y1, z1} = b
  seg_hit.y(y0, y1, ay, by, z0, z1, az, bz, slab(x0, x1, ax, bx, 0.0, 1.0))

def put_pt(keep: Bool, p: Pt, acc: List<&2, Pt>) -> List<&2, Pt>:
  match keep:
    case True{}:
      p <> acc
    case False{}:
      acc

def pq_items(ps: List<&2, Pt>, +sg: Seg, acc: List<&2, Pt>) -> List<&2, Pt>:
  match ps:
    case Nil{}:
      acc
    case +p <> t:
      pq_items(t, sg, put_pt(seg_hit(sg, pt_box(p)), p, acc))

def pq(t: PB, hit: Bool, +sg: Seg, acc: List<&2, Pt>) -> List<&2, Pt>:
  match t:
    case PL{_, ps}:
      match hit:
        case True{}:
          pq_items(ps, sg, acc)
        case False{}:
          acc
    case PN{_, +l, +r}:
      match hit:
        case True{}:
          pq(r, seg_hit(sg, pb_box(r)), sg, pq(l, seg_hit(sg, pb_box(l)), sg, acc))
        case False{}:
          acc

def pt_seg(a: Pt, b: Pt) -> Seg:
  Pt{_, _, ax, ay, az, _, _, _} = a
  Pt{_, _, bx, by, bz, _, _, _} = b
  Seg{ax, ay, az, bx, by, bz}

def seg_query(+t: PB, +a: Pt, +b: Pt) -> List<&2, Pt>:
  +sg = pt_seg(a, b)
  pq(t, seg_hit(sg, pb_box(t)), sg, Nil{})

# --- exact on-edge test ----------------------------------------------------------

type BS2 is Data:
  BS2{b: Bool, st: P.St}

def is_zero_side(s: E.Side) -> Bool:
  match s:
    case E.XZero{}:
      True{}
    case E.SZero{}:
      True{}
    case _:
      False{}

def is_neg_side(s: E.Side) -> Bool:
  P.is_lt(P.sign_of(s))

def on_edge.nb(+h3: E.Side, +h4: E.Side, st: P.St) -> BS2:
  BS2{Bool.and(is_neg_side(h3), is_neg_side(h4)), P.st_side(P.st_side(st, h3), h4)}

def on_edge.line(zero2: Bool, +h2: E.Side, +v: E.Vtx, +ep: E.Plane, +en: E.Plane, st: P.St) -> BS2:
  match zero2:
    case True{}:
      on_edge.nb(E.side(ep, v), E.side(en, v), P.st_side(st, h2))
    case False{}:
      BS2{False{}, P.st_side(st, h2)}

def on_edge.plane(zero1: Bool, +h1: E.Side, +v: E.Vtx, +ep: E.Plane, +ei: E.Plane, +en: E.Plane, st: P.St) -> BS2:
  match zero1:
    case True{}:
      +h2 = E.side(ei, v)
      on_edge.line(is_zero_side(h2), h2, v, ep, en, P.st_side(st, h1))
    case False{}:
      BS2{False{}, P.st_side(st, h1)}

def on_edge.pick(endpoint: Bool, +v: E.Vtx, +s: E.Plane, +ep: E.Plane, +ei: E.Plane, +en: E.Plane, st: P.St) -> BS2:
  match endpoint:
    case True{}:
      BS2{False{}, st}
    case False{}:
      +h1 = E.side(s, v)
      on_edge.plane(is_zero_side(h1), h1, v, ep, ei, en, st)

# w lies on the open edge (from a to b) on plane s with edge plane ei and
# neighbouring edge planes ep, en.
def on_edge(+w: Pt, +s: E.Plane, +ep: E.Plane, +ei: E.Plane, +en: E.Plane, +a: Pt, +b: Pt, st: P.St) -> BS2:
  on_edge.pick(Bool.or(v3_eq(pt_r(w), pt_r(a)), v3_eq(pt_r(w), pt_r(b))), pt_v(w), s, ep, ei, en, st)

type Ins is Data:
  Ins{ps: List<&2, Pt>, st: P.St}

def ins.put(r: BS2, p: Pt, acc: List<&2, Pt>) -> Ins:
  BS2{keep, st} = r
  Ins{put_pt(keep, p, acc), st}

def ins.go(cs: List<&2, Pt>, +s: E.Plane, +ep: E.Plane, +ei: E.Plane, +en: E.Plane, +a: Pt, +b: Pt, acc: Ins) -> Ins:
  match cs:
    case Nil{}:
      acc
    case +w <> t:
      Ins{ps, st} = acc
      ins.go(t, s, ep, ei, en, a, b, ins.put(on_edge(w, s, ep, ei, en, a, b, st), w, ps))

# --- ordering inserted points along an edge -------------------------------------

def v3_k(v: G.Vec3, k: U32) -> R.Real:
  G.V3{x, y, z} = v
  E.coord_real.pick(k, x, y, z)

def key_of(+ka: U32, desc: Bool, p: Pt) -> R.Real:
  match desc:
    case True{}:
      R.neg(v3_k(pt_r(p), ka))
    case False{}:
      v3_k(pt_r(p), ka)

# Exact order of two vertices on an edge line by coordinate k (X/W).
def vcmp(a: E.Vtx, b: E.Vtx, +k: U32) -> Cmp:
  E.Vtx{ax, ay, az, aw, _, _, _, _, _, _, _} = a
  E.Vtx{bx, by, bz, bw, _, _, _, _, _, _, _} = b
  B.cmp(B.mul(E.normal_k.pick(k, ax, ay, az), bw), B.mul(E.normal_k.pick(k, bx, by, bz), aw))

def exact_before(+x: Pt, +h: Pt, +ka: U32, desc: Bool) -> Bool:
  match desc:
    case False{}:
      Cmp.is_lt(vcmp(pt_v(x), pt_v(h), ka))
    case True{}:
      Cmp.is_gt(vcmp(pt_v(x), pt_v(h), ka))

def before.tie(tie: Bool, +x: Pt, +h: Pt, +ka: U32, +desc: Bool) -> Bool:
  match tie:
    case False{}:
      False{}
    case True{}:
      exact_before(x, h, ka, desc)

def before.k(+kx: R.Real, +kh: R.Real, +x: Pt, +h: Pt, +ka: U32, +desc: Bool) -> Bool:
  Bool.or(R.less(kx, kh), before.tie(R.equal(kx, kh), x, h, ka, desc))

# x goes before the head of t: rounded keys first, exact order on a tie.
def lt_head(+x: Pt, +kx: R.Real, t: List<&2, Pt>, +ka: U32, +desc: Bool) -> Bool:
  match t:
    case Nil{}:
      True{}
    case +h <> _:
      before.k(kx, key_of(ka, desc, h), x, h, ka, desc)

def ins_sorted(xs: List<&2, Pt>, +x: Pt, +kx: R.Real, +ka: U32, +desc: Bool, before: Bool) -> List<&2, Pt>:
  match xs:
    case Nil{}:
      [x]
    case h <> +t:
      match before:
        case True{}:
          x <> (h <> t)
        case False{}:
          h <> ins_sorted(t, x, kx, ka, desc, lt_head(x, kx, t, ka, desc))

def sort_pts(xs: List<&2, Pt>, +ka: U32, +desc: Bool, +acc: List<&2, Pt>) -> List<&2, Pt>:
  match xs:
    case Nil{}:
      acc
    case +x <> t:
      +kx = key_of(ka, desc, x)
      sort_pts(t, ka, desc, ins_sorted(acc, x, kx, ka, desc, lt_head(x, kx, acc, ka, desc)))

def tie.k(eq: Bool, +x: Pt, +p: Pt, +ka: U32) -> Bool:
  match eq:
    case False{}:
      False{}
    case True{}:
      Cmp.is_eq(vcmp(pt_v(x), pt_v(p), ka))

# Adjacent inserted points at exactly the same position along the edge (their
# order is undefined): counted as bad. Rounded keys filter the exact test.
def ties(xs: List<&2, Pt>, +ka: U32, +desc: Bool, +prev: Pt, acc: U32) -> U32:
  match xs:
    case Nil{}:
      acc
    case +x <> t:
      ties(t, ka, desc, x, (acc + Bool.to_u32(tie.k(R.equal(key_of(ka, desc, x), key_of(ka, desc, prev)), x, prev, ka)) : U32))

def fabs3(+x: F32, +y: F32, +z: F32) -> U32:
  E.dominant.of((F32.abs(x) >= F32.abs(y) : F32), (F32.abs(x) >= F32.abs(z) : F32), (F32.abs(y) >= F32.abs(z) : F32))

# Axis of the largest coordinate difference, from the rounded positions (the
# F32 grid approximations are too coarse for very short edges).
def edge_axis.v(a: G.Vec3, b: G.Vec3) -> U32:
  G.V3{ax, ay, az} = a
  G.V3{bx, by, bz} = b
  fabs3(R.approx(R.sub(bx, ax)), R.approx(R.sub(by, ay)), R.approx(R.sub(bz, az)))

def edge_axis(a: Pt, b: Pt) -> U32:
  edge_axis.v(pt_r(a), pt_r(b))

def edge_desc(+ka: U32, a: Pt, b: Pt) -> Bool:
  R.less(v3_k(pt_r(b), ka), v3_k(pt_r(a), ka))

# --- the augmented polygon ---------------------------------------------------------

type Aug is Data:
  Aug{p: Pt, s: Bool}

type AugAcc is Data:
  AugAcc{items: List<&2, Aug>, st: P.St, bad: U32, tj: U32}

def flat_onto(xs: List<&2, Pt>, acc: List<&2, Aug>, +n: U32) -> List<&2, Aug> & U32:
  match xs:
    case Nil{}:
      (acc, n)
    case x <> t:
      flat_onto(t, Aug{x, False{}} <> acc, (n + 1 : U32))

def aug.fin(r: List<&2, Aug> & U32, st: P.St, +bad: U32, +tj: U32, +tie: U32) -> AugAcc:
  (items, n) = r
  AugAcc{items, st, (bad + tie : U32), (tj + n : U32)}

def aug.k(r: Ins, +a: Pt, +b: Pt, items: List<&2, Aug>, +bad: U32, +tj: U32) -> AugAcc:
  Ins{ps, st} = r
  +ka = edge_axis(a, b)
  +desc = edge_desc(ka, a, b)
  +sorted = sort_pts(ps, ka, desc, Nil{})
  aug.fin(flat_onto(sorted, Aug{a, True{}} <> items, 0), st, bad, tj, ties(sorted, ka, desc, a, 0))

def aug.step(+a: Pt, +b: Pt, +s: E.Plane, +ep: E.Plane, +ei: E.Plane, +en: E.Plane, +t: PB, acc: AugAcc) -> AugAcc:
  AugAcc{items, st, bad, tj} = acc
  aug.k(ins.go(seg_query(t, a, b), s, ep, ei, en, a, b, Ins{Nil{}, st}), a, b, items, bad, tj)

def aug.go(es: List<&2, E.Plane>, eps: List<&2, E.Plane>, ens: List<&2, E.Plane>, as: List<&2, Pt>, bs: List<&2, Pt>, +s: E.Plane, +t: PB, acc: AugAcc) -> AugAcc:
  match es eps ens as bs:
    case ei <> er ep <> pr en <> nr a <> ar b <> br:
      aug.go(er, pr, nr, ar, br, s, t, aug.step(a, b, s, ep, ei, en, t, acc))
    case _ _ _ _ _:
      acc

def rot_right(-A: Data, +xs: List<&2, A>) -> List<&2, A>:
  List.reverse(&2, A, P.rotate1(A, List.reverse(&2, A, xs)))

# --- ear clipping at strict corners ---------------------------------------------------

def ei_list(xs: List<&2, Aug>, acc: List<&2, EI>) -> List<&2, EI>:
  match xs:
    case Nil{}:
      List.reverse(&2, EI, acc)
    case Aug{+p, s} <> t:
      ei_list(t, EI{pt_id(p), s, pt_r(p)} <> acc)

def aug_pos(xs: List<&2, Aug>, acc: List<&2, G.Vec3>) -> List<&2, G.Vec3>:
  match xs:
    case Nil{}:
      List.reverse(&2, G.Vec3, acc)
    case Aug{p, _} <> t:
      aug_pos(t, pt_r(p) <> acc)

def aug_ok(xs: List<&2, Aug>, acc: Bool) -> Bool:
  match xs:
    case Nil{}:
      acc
    case Aug{Pt{_, _, _, _, _, ok, _, _}, _} <> t:
      aug_ok(t, Bool.and(acc, ok))

# An output triangle on global point ids, with the projection axis k of its
# piece's plane, whether its projected orientation must be positive, and
# whether it is (exact orientation test on the rounded coordinates).
type TT is Data:
  TT{a: U32, b: U32, c: U32, tag: U32, k: U32, pos: Bool, good: Bool}

def tri_of(flip: Bool, +a: U32, +b: U32, +c: U32, +tag: U32, +k: U32, +pos: Bool) -> TT:
  match flip:
    case True{}:
      TT{a, c, b, tag, k, Bool.not(pos), True{}}
    case False{}:
      TT{a, b, c, tag, k, pos, True{}}

def missing_ids(xs: List<&2, Aug>, +n: U32) -> U32:
  match xs:
    case Nil{}:
      n
    case Aug{p, _} <> t:
      missing_ids(t, (n + Bool.to_u32(U32.is_eq(pt_id(p), 4294967295)) : U32))

def strict_count(xs: List<&2, EI>, +n: U32) -> U32:
  match xs:
    case Nil{}:
      n
    case EI{_, st, _} <> t:
      strict_count(t, (n + Bool.to_u32(st) : U32))

# Shape quality of triangle (a, b, c): (2 area)^2 / (longest edge)^4, in
# [0, 3/4]; slivers score near 0 (approximate, on the rounded positions).
def quality(+a: G.Vec3, +b: G.Vec3, +c: G.Vec3) -> F32:
  +u = d3(a, b)
  +v = d3(a, c)
  +l = F32.max(len2(u), F32.max(len2(v), len2(d3(b, c))))
  +l2 = F32.max((l * l : F32), 0.000000000000000000000000000000000001)
  (cross_len2(u, v) / l2 : F32)

type Best is Data:
  Best{q: F32, j: U32}

type CR is Data:
  CR{ts: List<&2, TT>, bad: U32}

def cr_bad(c: CR) -> U32:
  CR{_, b} = c
  b

def better(+g: CR, +d: CR) -> CR:
  Bool.pick(CR, U32.is_lt(cr_bad(d), cr_bad(g)), d, g)

def best.pick(better: Bool, +q: F32, +j: U32, acc: Best) -> Best:
  match better:
    case True{}:
      Best{q, j}
    case False{}:
      acc

def b_q.id(q: F32) -> F32:
  q

def best_q(b: Best) -> F32:
  Best{q, _} = b
  b_q.id(q)

# The valid ear (strict corner whose removal keeps a proper polygon) with the
# best shape; j indexes b.
def best.go(xs: List<&2, EI>, ps: List<&2, EI>, ns: List<&2, EI>, +total: U32, +m: U32, +j: U32, +acc: Best) -> Best:
  match xs ps ns:
    case EI{_, +bs, +bp} <> xt EI{_, +as, +ap} <> pt EI{_, +cs, +cp} <> nt:
      +q = quality(ap, bp, cp)
      +valid = Bool.and(bs, Bool.or(U32.is_eq(m, 3), U32.is_lt((Bool.to_u32(as) + Bool.to_u32(bs) + Bool.to_u32(cs) : U32), total)))
      best.go(xt, pt, nt, total, m, (j + 1 : U32), best.pick(Bool.and(valid, (q > best_q(acc) : F32)), q, j, acc))
    case _ _ _:
      acc

def rot_by(-A: Data, +xs: List<&2, A>, +k: Nat) -> List<&2, A>:
  List.append(&2, A, List.drop(&2, A, xs, k), List.take(&2, A, xs, k))

def best_j(b: Best) -> U32:
  Best{_, j} = b
  j

# Rotate so that the best ear's corner is the second element.
def choose(+xs: List<&2, EI>) -> List<&2, EI>:
  +m = M.count(&2, EI, xs)
  +j = best_j(best.go(xs, rot_right(EI, xs), P.rotate1(EI, xs), strict_count(xs, 0), m, 0, Best{F32.neg(1.0), 1}))
  rot_by(EI, xs, U32.to_nat(U32.mod((j + m - 1 : U32), U32.max(m, 1))))

def axis_u(k: U32) -> U32:
  match k:
    case 0:
      1
    case 1:
      2
    case _:
      0

def axis_v(k: U32) -> U32:
  match k:
    case 0:
      2
    case 1:
      0
    case _:
      1

def ibig(v: G.Vec3, +k: U32) -> B.Big:
  E.scaled_int(v3_k(v, k), 68719476736.0)

# Exact orientation of the rounded triangle in the projection along axis k.
def orient_sign(+k: U32, +a: G.Vec3, +b: G.Vec3, +c: G.Vec3) -> B.Sign:
  +u = axis_u(k)
  +v = axis_v(k)
  +au = ibig(a, u)
  +av = ibig(a, v)
  B.sign(B.sub(B.mul(B.sub(ibig(b, u), au), B.sub(ibig(c, v), av)), B.mul(B.sub(ibig(b, v), av), B.sub(ibig(c, u), au))))

# Append a triangle; count it as bad when its exact orientation on the
# rounded coordinates (original order a b c) is not the expected one.
def tt_good(t: TT, +g: Bool) -> TT:
  TT{a, b, c, tag, k, pos, _} = t
  TT{a, b, c, tag, k, pos, g}

def cr_add(acc: CR, t: TT, +s: B.Sign, +pos: Bool) -> CR:
  CR{ts, bad} = acc
  +good = Bool.or(Bool.and(pos, P.is_gt(s)), Bool.and(Bool.not(pos), P.is_lt(s)))
  CR{tt_good(t, good) <> ts, (bad + Bool.to_u32(Bool.not(good)) : U32)}

def clip(fuel: Nat, items: List<&2, EI>, +flip: Bool, +tag: U32, +k: U32, +pos: Bool, acc: CR) -> CR:
  match fuel:
    case 0n:
      CR{ts, bad} = acc
      CR{ts, (bad + 1 : U32)}
    case 1n+f:
      match items:
        case EI{ai, _, +ap} <> EI{bi, _, +bp} <> EI{ci, _, +cp} <> Nil{}:
          cr_add(acc, tri_of(flip, ai, bi, ci, tag, k, pos), orient_sign(k, ap, bp, cp), pos)
        case EI{+ai, _, +ap} <> EI{+bi, _, +bp} <> EI{+ci, _, +cp} <> r1 <> r2:
          +next = {EI{ai, True{}, ap} <> (EI{ci, True{}, cp} <> (r1 <> r2)) : List<&2, EI>}
          clip(f, choose(next), flip, tag, k, pos, cr_add(acc, tri_of(flip, ai, bi, ci, tag, k, pos), orient_sign(k, ap, bp, cp), pos))
        case _:
          acc

def clip.start(fuel: Nat, +items: List<&2, EI>, +flip: Bool, +tag: U32, +k: U32, +pos: Bool) -> CR:
  clip(fuel, choose(items), flip, tag, k, pos, CR{Nil{}, 0})

# --- ids of corner points ------------------------------------------------------

def id_among(cs: List<&2, Pt>, +r: G.Vec3, +found: U32) -> U32:
  match cs:
    case Nil{}:
      found
    case +c <> t:
      id_among(t, r, Bool.pick(U32, v3_eq(pt_r(c), r), pt_id(c), found))

def find_id(+t: PB, +p: Pt) -> Pt:
  with_id(p, id_among(seg_query(t, p, p), pt_r(p), 4294967295))

def with_ids(ps: List<&2, Pt>, +t: PB, acc: List<&2, Pt>) -> List<&2, Pt>:
  match ps:
    case Nil{}:
      List.reverse(&2, Pt, acc)
    case p <> r:
      with_ids(r, t, find_id(t, p) <> acc)

# --- one kept piece -> triangles on global vertex ids ------------------------------

# A kept piece: source tag, orientation flip, support plane, edges (with their
# start vertices) and the rounded start vertices in the same order.
type KF is Data:
  KF{tag: U32, flip: Bool, s: E.Plane, es: List<&2, P.Edge>, pts: List<&2, Pt>}

type FM is Data:
  FM{ts: List<&2, TT>, st: P.St, bad: U32, tj: U32, ok: Bool, inv: U32}

def fm_merge(a: FM, b: FM) -> FM:
  FM{at, ast, abad, atj, aok, ainv} = a
  FM{bt, bst, bbad, btj, bok, binv} = b
  FM{M.rev_onto(TT, List.reverse(&2, TT, at), bt), P.st_add(ast, bst), (abad + bbad : U32), (atj + btj : U32), Bool.and(aok, bok), (ainv + binv : U32)}

def edge_list(es: List<&2, P.Edge>, acc: List<&2, E.Plane>) -> List<&2, E.Plane>:
  match es:
    case Nil{}:
      List.reverse(&2, E.Plane, acc)
    case P.Edge{p, _} <> t:
      edge_list(t, p <> acc)

def frag.fin(c: CR, st: P.St, +bad: U32, +tj: U32, ok: Bool) -> FM:
  CR{ts, inv} = c
  FM{ts, st, bad, tj, ok, inv}

def ei0() -> EI:
  EI{4294967295, False{}, G.V3{R.from_f32(0.0), R.from_f32(0.0), R.from_f32(0.0)}}

def ds_fill(xs: List<&2, EI>, +i: U32, arr: Array<EI>) -> Array<EI>:
  match xs:
    case Nil{}:
      arr
    case x <> t:
      ds_fill(t, (i + 1 : U32), Array.set(EI, arr, i, x))

def outer(fuel: Nat, ds: DS, +len: U32, +m: U32, +w: U32) -> DS:
  match fuel:
    case 0n:
      ds
    case 1n+f:
      outer(f, mid(U32.to_nat((m - len : U32)), ds, 0, len, w), (len + 1 : U32), m, w)

type IJ is Data:
  IJ{i: U32, j: U32}

type RS is Type:
  RS{ds: DS, st: List<&2, IJ>, cr: CR}

def ds.c1(e: Array<EI>, q: Array<F32>, pr: Array<U32> & U32) -> DS & U32:
  (c, v) = pr
  (DS{e, q, c}, v)

def ds_c(ds: DS, +i: U32) -> DS & U32:
  DS{e, q, c} = ds
  ds.c1(e, q, Array.get(U32, c, i))

def rec.pj(r: DS & EI, +ai: U32, +ap: G.Vec3, +bi: U32, +bp: G.Vec3, +i: U32, +k: U32, +j: U32, rest: List<&2, IJ>, cr: CR, +flip: Bool, +tag: U32, +kk: U32, +pos: Bool) -> RS:
  (ds, ej) = r
  EI{ci, _, +cp} = ej
  RS{ds, IJ{i, k} <> (IJ{k, j} <> rest), cr_add(cr, tri_of(flip, ai, bi, ci, tag, kk, pos), orient_sign(kk, ap, bp, cp), pos)}

def rec.pk(r: DS & EI, +ai: U32, +ap: G.Vec3, +i: U32, +k: U32, +j: U32, rest: List<&2, IJ>, cr: CR, +flip: Bool, +tag: U32, +kk: U32, +pos: Bool) -> RS:
  (ds, ek) = r
  EI{bi, _, bp} = ek
  rec.pj(ds_e(ds, j), ai, ap, bi, bp, i, k, j, rest, cr, flip, tag, kk, pos)

def rec.pi(r: DS & EI, +i: U32, +k: U32, +j: U32, rest: List<&2, IJ>, cr: CR, +flip: Bool, +tag: U32, +kk: U32, +pos: Bool) -> RS:
  (ds, ei) = r
  EI{ai, _, ap} = ei
  rec.pk(ds_e(ds, k), ai, ap, i, k, j, rest, cr, flip, tag, kk, pos)

def rec.k(r: DS & U32, +i: U32, +j: U32, rest: List<&2, IJ>, cr: CR, +flip: Bool, +tag: U32, +kk: U32, +pos: Bool) -> RS:
  (ds, +k) = r
  rec.pi(ds_e(ds, i), i, k, j, rest, cr, flip, tag, kk, pos)

def rec.step(big: Bool, ds: DS, +i: U32, +j: U32, rest: List<&2, IJ>, cr: CR, +flip: Bool, +tag: U32, +kk: U32, +pos: Bool, +w: U32) -> RS:
  match big:
    case False{}:
      RS{ds, rest, cr}
    case True{}:
      rec.k(ds_c(ds, (i * w + j : U32)), i, j, rest, cr, flip, tag, kk, pos)

def rec.pop(st: List<&2, IJ>, ds: DS, cr: CR, +flip: Bool, +tag: U32, +kk: U32, +pos: Bool, +w: U32) -> RS:
  match st:
    case Nil{}:
      RS{ds, Nil{}, cr}
    case IJ{+i, +j} <> rest:
      rec.step(U32.is_le((i + 2 : U32), j), ds, i, j, rest, cr, flip, tag, kk, pos, w)

def rec(fuel: Nat, rs: RS, +flip: Bool, +tag: U32, +kk: U32, +pos: Bool, +w: U32) -> CR:
  match fuel:
    case 0n:
      RS{_, _, cr} = rs
      cr
    case 1n+f:
      RS{ds, st, cr} = rs
      rec(f, rec.pop(st, ds, cr, flip, tag, kk, pos, w), flip, tag, kk, pos, w)

# Triangulate a convex piece (m >= 3 vertices, in order) maximizing the
# smallest triangle height.
def dp_tri(+items: List<&2, EI>, +m: U32, +flip: Bool, +tag: U32, +k: U32, +pos: Bool) -> CR:
  +d = S.depth_of(m)
  +w = U32.shln(1, U32.to_nat(d))
  +dd = U32.to_nat((d + d : U32))
  rec(U32.to_nat((m * 4 : U32)), RS{outer(U32.to_nat((m - 2 : U32)), DS{ds_fill(items, 0, Array.new(EI, U32.to_nat(d), ei0())), Array.new(F32, dd, 300000000000000000000000000000000000000.0), Array.new(U32, dd, 0)}, 2, m, w), [IJ{0, (m - 1 : U32)}], CR{Nil{}, 0}}, flip, tag, k, pos, w)

def frag.tri.k(use: Bool, +g: CR, +eis: List<&2, EI>, +m: U32, +flip: Bool, +tag: U32, +k: U32, +pos: Bool) -> CR:
  match use:
    case False{}:
      g
    case True{}:
      better(g, dp_tri(eis, m, flip, tag, k, pos))

# Greedy ear clipping first; the optimal (DP) triangulation when a greedy
# triangle would flip and the piece has at most 48 vertices.
def frag.tri(+g: CR, +eis: List<&2, EI>, +m: U32, +flip: Bool, +tag: U32, +k: U32, +pos: Bool) -> CR:
  frag.tri.k(Bool.and(U32.is_lt(0, cr_bad(g)), U32.is_le(m, 48)), g, eis, m, flip, tag, k, pos)

def frag.k(a: AugAcc, +flip: Bool, +tag: U32, +k: U32, +pos: Bool) -> FM:
  AugAcc{ritems, st, bad, tj} = a
  +items = List.reverse(&2, Aug, ritems)
  +m = M.count(&2, Aug, items)
  +eis = ei_list(items, Nil{})
  frag.fin(frag.tri(clip.start(U32.to_nat((m + 3 : U32)), eis, flip, tag, k, pos), eis, m, flip, tag, k, pos), st, (bad + (missing_ids(items, 0) * 65536 : U32) : U32), tj, aug_ok(items, True{}))

def frag_mesh(kf: KF, +t: PB) -> FM:
  KF{+tag, +flip, +s, es, ps} = kf
  +pl = edge_list(es, Nil{})
  +pts = with_ids(ps, t, Nil{})
  +k = E.dominant(s)
  frag.k(aug.go(pl, rot_right(E.Plane, pl), P.rotate1(E.Plane, pl), pts, P.rotate1(Pt, pts), s, t, AugAcc{Nil{}, P.st0(), 0, 0}), flip, tag, k, P.is_gt(B.sign(E.normal_k(s, k))))

def kf_pts(ks: List<&2, KF>, acc: List<&2, Pt>) -> List<&2, Pt>:
  match ks:
    case Nil{}:
      acc
    case KF{_, _, _, _, ps} <> t:
      kf_pts(t, M.rev_onto(Pt, ps, acc))

# --- parallel assembly -------------------------------------------------------------

type KH is Data:
  KH{a: List<&2, KF>, b: List<&2, KF>}

def kf_halve(xs: List<&2, KF>, a: List<&2, KF>, b: List<&2, KF>) -> KH:
  match xs:
    case Nil{}:
      KH{a, b}
    case x <> Nil{}:
      KH{x <> a, b}
    case x <> y <> t:
      kf_halve(t, x <> a, y <> b)

def fm_add(f: FM, acc: FM) -> FM:
  FM{ts, st, bad, tj, ok, inv} = f
  FM{at, ast, abad, atj, aok, ainv} = acc
  FM{M.rev_onto(TT, ts, at), P.st_add(ast, st), (abad + bad : U32), (atj + tj : U32), Bool.and(aok, ok), (ainv + inv : U32)}

def frags.go(xs: List<&2, KF>, +t: PB, acc: FM) -> FM:
  match xs:
    case Nil{}:
      acc
    case k <> r:
      frags.go(r, t, fm_add(frag_mesh(k, t), acc))

def frags.par(d: Nat, h: KH, +t: PB) -> FM:
  match d:
    case 0n:
      KH{a, b} = h
      frags.go(b, t, frags.go(a, t, FM{Nil{}, P.st0(), 0, 0, True{}, 0}))
    case 1n+(+e):
      KH{a, b} = h
      x y = frags.par(e, kf_halve(a, Nil{}, Nil{}), t) frags.par(e, kf_halve(b, Nil{}, Nil{}), t)
      fm_merge(x, y)

# --- self-check of the output --------------------------------------------------------
#
# Every directed edge must occur exactly once and its reverse exactly once
# (closed, consistently oriented, edge-manifold), and no triangle may repeat
# a vertex. This catches non-manifold results such as tangent contact (the
# regularized result touches itself along a line), which are refused.

type EK is Data:
  EK{a: U32, b: U32}

def ek_le(x: EK, y: EK) -> Bool:
  EK{+xa, xb} = x
  EK{+ya, yb} = y
  Bool.or(U32.is_lt(xa, ya), Bool.and(U32.is_eq(xa, ya), U32.is_le(xb, yb)))

def keys(ts: List<&2, M.Tri>, fwd: List<&2, EK>, rev: List<&2, EK>, +bad: U32) -> List<&2, EK> & List<&2, EK> & U32:
  match ts:
    case Nil{}:
      (fwd, (rev, bad))
    case M.Tri{+a, +b, +c, _} <> t:
      keys(t, EK{a, b} <> (EK{b, c} <> (EK{c, a} <> fwd)), EK{b, a} <> (EK{c, b} <> (EK{a, c} <> rev)), (bad + Bool.to_u32(Bool.or(U32.is_eq(a, b), Bool.or(U32.is_eq(b, c), U32.is_eq(c, a)))) : U32))

def ek_eq(x: EK, y: EK) -> Bool:
  EK{xa, xb} = x
  EK{ya, yb} = y
  Bool.and(U32.is_eq(xa, ya), U32.is_eq(xb, yb))

# Sorted forward keys have no duplicate and equal the sorted reversed keys.
def same_seq(xs: List<&2, EK>, ys: List<&2, EK>, +ok: Bool) -> Bool:
  match xs ys:
    case Nil{} Nil{}:
      ok
    case x <> xt y <> yt:
      same_seq(xt, yt, Bool.and(ok, ek_eq(x, y)))
    case _ _:
      False{}

def no_dup(xs: List<&2, EK>, +prev: EK, +ok: Bool) -> Bool:
  match xs:
    case Nil{}:
      ok
    case +x <> t:
      no_dup(t, x, Bool.and(ok, Bool.not(ek_eq(x, prev))))

def self_check.k(+fwd: List<&2, EK>, rev: List<&2, EK>, +bad: U32) -> Bool:
  Bool.and(U32.is_eq(bad, 0), Bool.and(no_dup(fwd, EK{4294967295, 4294967295}, True{}), same_seq(fwd, rev, True{})))

# The two key sorts run in parallel.
def self_check.p(r: List<&2, EK> & List<&2, EK> & U32) -> Bool:
  (fwd, rb) = r
  (rev, bad) = rb
  x y = Z.psort(~EK, ~ek_le, fwd) Z.psort(~EK, ~ek_le, rev)
  self_check.k(x, y, bad)

def self_check(ts: List<&2, M.Tri>) -> Bool:
  self_check.p(keys(ts, Nil{}, Nil{}, 0))

# The largest export rounding displacement over the points (mm).
def max_disp(ps: List<&2, Pt>, +acc: F32) -> F32:
  match ps:
    case Nil{}:
      acc
    case Pt{_, _, _, _, _, _, _, d} <> t:
      max_disp(t, F32.max(acc, d))

def positions(ps: List<&2, Pt>, acc: List<&2, G.Vec3>) -> List<&2, G.Vec3>:
  match ps:
    case Nil{}:
      List.reverse(&2, G.Vec3, acc)
    case p <> t:
      positions(t, pt_r(p) <> acc)


# --- optimal triangulation of small pieces (fallback) -------------------------------
#
# When greedy ear clipping leaves a triangle that rounding would flip, the
# piece is re-triangulated by dynamic programming over its (convex) vertex
# cycle, maximizing the smallest triangle height (2 area / longest edge on
# the rounded positions). Pieces with more than 48 vertices keep the greedy
# result. O(m^3) in the vertex count m.
