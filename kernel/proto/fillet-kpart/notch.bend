import Base
import ../../real.bend as R
import ../../precise.bend as G
import ./job.bend as J
import ./geom.bend as K
import ./ladder.bend as L
import ./bounds.bend as B
import ./corners.bend as C

# Overflow as notch (Marc's decision 2026-09-24: "Overflow: zuerst Notch";
# theory §10.3, Parasolid: "the blend surface remains the same, and the blend
# is trimmed using the faces in the notch"), stage 3 of prototype A
# (docs/fillet/proto-kpart.md, "Stage A3").
#
# A stripe side whose contact leaves its support face (stage-1 bound
# `overflow`) keeps its blend surface; the side is then bounded by the curve
# where the blend meets the neighbouring geometry instead of by a spring:
#   face notch   the contact passes the support's bound edge b into the
#                neighbouring face N (the other face of b). v1 admits it when
#                the blend meets N in an exact planar section curve:
#                translation blend, b a line along the spine, N a plane that
#                contains the spine direction (the notch curve is a line);
#                rotation blend of a full rim, b a coaxial circle, N a coaxial
#                cylinder (the notch curve is a circle).
#                The support is consumed (it must be the strip between the
#                blended edge and b); N is trimmed back (convex) or grows
#                (concave) to the notch curve.
#   meet         two blends overlap on the strip between them (the contact
#                of each passes the other's spring): both keep their
#                cylinder and are trimmed at their mutual intersection line
#                (equal radii, parallel spines). The strip is consumed.
# The notch point is where the section circle of the blend first crosses N
# (or the other blend) on the arc from the kept contact towards the
# overflowing one. Anything else stays refused with the stage-1 class and a
# reason; so does an overflow on both sides of one stripe and every chamfer
# overflow.

type Nt is Data:
  NtFace{k: U32, i: U32, s: U32, b: U32, n: U32, q: K.P2}
  NtMeet{k: U32, i: U32, s: U32, j: U32, q: K.P2}
  NtNo{k: U32, i: U32, cls: String, why: String}

def nt_k(+t: Nt) -> U32:
  match t:
    case NtFace{k, _, _, _, _, _}:
      k
    case NtMeet{k, _, _, _, _}:
      k
    case NtNo{k, _, _, _}:
      k

def nt_i(+t: Nt) -> U32:
  match t:
    case NtFace{_, i, _, _, _, _}:
      i
    case NtMeet{_, i, _, _, _}:
      i
    case NtNo{_, i, _, _}:
      i

def etxt(+k: U32) -> String:
  "edge " ++ K.show_u32(k)

# ---------------------------------------------------------------------------
# 2D helpers (section plane)

# Signed angle from u to w (both from the centre).
def ang2(+u: K.P2, +w: K.P2) -> R.Real:
  R.atan2(K.p2_cross(u, w), K.p2_dot(u, w))

# Is p on the arc from qo towards qn about c (sweep below π), and how far
# along (the angle from qo)? Returns the angle, or a negative value when off.
def along(+c: K.P2, +qo: K.P2, +qn: K.P2, +p: K.P2) -> R.Real:
  +u = K.p2_sub(qo, c)
  +an = ang2(u, K.p2_sub(qn, c))
  +ap = ang2(u, K.p2_sub(p, c))
  +same = K.is_pos(R.mul(an, ap))
  +within = R.less(R.abs(ap), R.add(R.abs(an), K.tol_dir()))
  K.pick_r(Bool.and(same, within), R.abs(ap), R.neg(K.one()))

# The first crossing of the arc (c, r) from qo towards qn with the line
# through p0 of unit normal nn: Some point, or None.
def cross_first.pick(+ok: Bool, +c: K.P2, +qo: K.P2, +qn: K.P2, +pa: K.P2, +pb: K.P2) -> Maybe<&2, K.P2>:
  match ok:
    case False{}:
      None{}
    case True{}:
      +aa = along(c, qo, qn, pa)
      +ab = along(c, qo, qn, pb)
      +oka = Bool.not(K.is_neg(aa))
      +okb = Bool.not(K.is_neg(ab))
      +first = Bool.pick(K.P2, Bool.and(oka, Bool.or(Bool.not(okb), R.less(aa, ab))), pa, pb)
      Bool.pick(Maybe<&2, K.P2>, Bool.or(oka, okb), Some{first}, None{})

def cross_first(+c: K.P2, +r: R.Real, +qo: K.P2, +qn: K.P2, +p0: K.P2, +nn: K.P2) -> Maybe<&2, K.P2>:
  +h = K.p2_dot(nn, K.p2_sub(c, p0))
  +d2 = R.sub(K.sq(r), K.sq(h))
  +foot = K.p2_sub(c, K.p2_scale(nn, h))
  +t = R.sqrt(K.pick_r(K.is_neg(d2), K.zero(), d2))
  +tt = K.p2_perp(nn)
  cross_first.pick(K.is_pos(d2), c, qo, qn, K.p2_add(foot, K.p2_scale(tt, t)), K.p2_sub(foot, K.p2_scale(tt, t)))

# ---------------------------------------------------------------------------
# Topology helpers

def other_face(+fs: List<&2, J.Face>, +e: U32, +f: U32) -> U32:
  C.other_face(fs, e, f)

def fedges(+b: J.Body, +f: U32) -> List<&2, U32>:
  K.sort_uniq(K.face_edges(K.face_at(K.body_fs(b), f)))

# The face is exactly the strip (or annulus) bounded by these edges plus
# `extra` more.
def strip_of(+b: J.Body, +f: U32, +x: U32, +y: U32, +extra: U32) -> Bool:
  +es = fedges(b, f)
  Bool.and(Bool.and(K.mem(es, x), K.mem(es, y)), U32.is_eq(K.count(U32, es), (2 + extra : U32)))

def side_q(+st: L.Stripe, +i: U32) -> K.P2:
  match st:
    case L.St{_, _, _, _, _, _, _, _, s1, s2, _, _, _, _}:
      L.side_p(Bool.pick(L.Side, U32.is_eq(i, 1), s1, s2))
    case L.NoSt{_, _, _}:
      K.p2(K.zero(), K.zero())

def side_face(+st: L.Stripe, +i: U32) -> U32:
  match st:
    case L.St{_, f1, f2, _, _, _, _, _, _, _, _, _, _, _}:
      Bool.pick(U32, U32.is_eq(i, 1), f1, f2)
    case L.NoSt{_, _, _}:
      C.none_u32()

def plane_of(+f: J.Face) -> C.Pl:
  C.face_plane.f(f)

# ---------------------------------------------------------------------------
# Face notch

def face_no(+k: U32, +i: U32, +why: String) -> Nt:
  NtNo{k, i, "overflow", "the contact of " ++ etxt(k) ++ " leaves its face and " ++ why}

def nt_found(+m: Maybe<&2, K.P2>, +k: U32, +i: U32, +s: U32, +bd: U32, +n: U32, +why: String) -> Nt:
  match m:
    case Some{q}:
      NtFace{k, i, s, bd, n, q}
    case None{}:
      face_no(k, i, why)

# Translation blend: N a plane containing the spine direction, b a line
# along the spine, the support the strip between the edge and b.
def face.tra(+ok: Bool, +st: L.Stripe, +i: U32, +b: J.Body, +bd: U32, +s: U32, +n: U32, +r: R.Real) -> Nt:
  match ok:
    case False{}:
      face_no(C.st_edge(st), i, "the neighbouring face " ++ K.show_u32(n) ++ " is not a plane along the blend, or the support is not the strip up to " ++ etxt(bd) ++ " (no exact notch curve in v1)")
    case True{}:
      match st:
        case L.St{k, _, _, _, _, _, sec, _, _, _, c2, _, _, _}:
          +pl = plane_of(K.face_at(K.body_fs(b), n))
          +m = cross_first(c2, r, side_q(st, Bool.pick(U32, U32.is_eq(i, 1), 2, 1)), side_q(st, i), K.sec_pt(sec, C.pl_o(pl)), K.p2_unit(K.sec_dir(sec, C.pl_n(pl))))
          nt_found(m, k, i, s, bd, n, "the blend does not reach face " ++ K.show_u32(n) ++ " between its contacts")
        case L.NoSt{k, _, _}:
          face_no(k, i, "no stripe")

def coax_cyl(+s: J.Surf, +o: G.Vec3, +a: G.Vec3) -> Bool:
  match s:
    case J.SCyl{so, sa, _, _}:
      Bool.and(K.parallel(sa, a), K.near_lin(K.line_dist(o, a, so)))
    case _:
      False{}

def cyl_r(+s: J.Surf) -> R.Real:
  match s:
    case J.SCyl{_, _, _, r}:
      r
    case _:
      K.zero()

def coax_circle(+c: J.Curve, +o: G.Vec3, +a: G.Vec3) -> Bool:
  match c:
    case J.CCircle{co, cn, _, _}:
      Bool.and(K.parallel(G.normalize(cn), a), K.near_lin(K.line_dist(o, a, co)))
    case _:
      False{}

# The two vertices lie on one meridian half-plane of the axis (the rim's
# seam and the neighbour's seam line up).
def same_meridian(+o: G.Vec3, +a: G.Vec3, +p: G.Vec3, +q: G.Vec3) -> Bool:
  K.near_dir(K.len(G.sub(G.normalize(K.radial(o, a, p)), G.normalize(K.radial(o, a, q)))))

# Rotation blend of a full rim: N a coaxial cylinder, b a coaxial circle,
# the support the annulus between the rim and b, both seams on one meridian.
def face.rot(+ok: Bool, +st: L.Stripe, +i: U32, +b: J.Body, +bd: U32, +s: U32, +n: U32, +r: R.Real) -> Nt:
  match ok:
    case False{}:
      face_no(C.st_edge(st), i, "the neighbouring face " ++ K.show_u32(n) ++ " is not a coaxial cylinder, or the support is not the annulus up to " ++ etxt(bd) ++ " (no exact notch curve in v1)")
    case True{}:
      match st:
        case L.St{k, _, _, _, _, _, _, _, _, _, c2, _, _, _}:
          +rn = cyl_r(K.face_surf(K.face_at(K.body_fs(b), n)))
          +m = cross_first(c2, r, side_q(st, Bool.pick(U32, U32.is_eq(i, 1), 2, 1)), side_q(st, i), K.p2(rn, K.zero()), K.p2(K.one(), K.zero()))
          nt_found(m, k, i, s, bd, n, "the blend does not reach the cylinder face " ++ K.show_u32(n) ++ " between its contacts")
        case L.NoSt{k, _, _}:
          face_no(k, i, "no stripe")

def face.sec(+sec: K.Sec, +st: L.Stripe, +i: U32, +b: J.Body, +bd: U32, +r: R.Real, +k: U32) -> Nt:
  match sec:
    case K.Tra{_, d, _, _, _}:
      J.Body{vs, es, fs} = b
      +s = side_face(st, i)
      +n = other_face(fs, bd, s)
      +edb = K.edge_at(es, bd)
      +line = Bool.and(U32.is_eq(K.curve_kind(K.edge_curve(edb)), 0), K.parallel(G.normalize(K.edge_tangent(edb, K.edge_start(vs, edb))), d))
      +plane = Bool.and(C.is_plane(fs, n), K.near_dir(G.dot(C.pl_n(C.face_plane(fs, n)), d)))
      face.tra(Bool.and(Bool.and(line, plane), strip_of(b, s, k, bd, 2)), st, i, b, bd, s, n, r)
    case K.Rot{o, a, _, closed}:
      J.Body{vs, es, fs} = b
      +s = side_face(st, i)
      +n = other_face(fs, bd, s)
      +edb = K.edge_at(es, bd)
      +edk = K.edge_at(es, k)
      +coax = Bool.and(coax_circle(K.edge_curve(edb), o, a), coax_cyl(K.face_surf(K.face_at(fs, n)), o, a))
      +seams = same_meridian(o, a, K.edge_start(vs, edb), K.edge_start(vs, edk))
      face.rot(Bool.and(Bool.and(closed, coax), Bool.and(seams, strip_of(b, s, k, bd, 0))), st, i, b, bd, s, n, r)

def face.fam(+st: L.Stripe, +i: U32, +b: J.Body, +bd: U32, +r: R.Real) -> Nt:
  match st:
    case L.St{k, _, _, _, _, _, sec, _, _, _, _, _, _, _}:
      face.sec(sec, st, i, b, bd, r, k)
    case L.NoSt{k, _, _}:
      face_no(k, i, "no stripe")

# ---------------------------------------------------------------------------
# Meet: two equal blends with parallel spines overlap on the strip between.

def meet_no(+k: U32, +i: U32, +j: U32, +why: String) -> Nt:
  NtNo{k, i, "blend-overlap", "the blends of " ++ etxt(k) ++ " and " ++ etxt(j) ++ " overlap and " ++ why}

def sec_tra(+sec: K.Sec) -> Bool:
  match sec:
    case K.Tra{_, _, _, _, _}:
      True{}
    case K.Rot{_, _, _, _}:
      False{}

# The two section circles cross at mid ± h·perp; the crossing nearer to the
# consumed face's trace is the meeting line.
def meet.pts(+ok: Bool, +k: U32, +i: U32, +j: U32, +s: U32, +c: K.P2, +cj: K.P2, +r: R.Real, +p0: K.P2, +nn: K.P2, +qo: K.P2, +qn: K.P2) -> Nt:
  match ok:
    case False{}:
      meet_no(k, i, j, "their section circles do not cross")
    case True{}:
      +dv = K.p2_sub(cj, c)
      +dd = K.p2_len(dv)
      +mid = K.p2_scale(K.p2_add(c, cj), K.half(K.one()))
      +h = R.sqrt(R.sub(K.sq(r), K.sq(K.half(dd))))
      +pp = K.p2_perp(K.p2_scale(dv, R.div(K.one(), dd)))
      +pa = K.p2_add(mid, K.p2_scale(pp, h))
      +pb = K.p2_sub(mid, K.p2_scale(pp, h))
      +da = R.abs(K.p2_dot(nn, K.p2_sub(pa, p0)))
      +db = R.abs(K.p2_dot(nn, K.p2_sub(pb, p0)))
      +q = Bool.pick(K.P2, R.less(da, db), pa, pb)
      Bool.pick(Nt, K.is_neg(along(c, qo, qn, q)), meet_no(k, i, j, "their intersection lies off the blend"), NtMeet{k, i, s, j, q})

def meet.sj(+sj: L.Stripe, +st: L.Stripe, +i: U32, +b: J.Body, +r: R.Real, +ch: Bool, +k: U32, +sec: K.Sec, +c2: K.P2) -> Nt:
  match sj:
    case L.St{j, _, _, _, _, _, secj, _, _, _, c2j, _, _, _}:
      +s = side_face(st, i)
      +ok = Bool.and(Bool.and(Bool.not(ch), Bool.and(sec_tra(sec), sec_tra(secj))), Bool.and(K.parallel(C.sec_d(sec), C.sec_d(secj)), strip_of(b, s, k, j, 2)))
      +pl = C.face_plane(K.body_fs(b), s)
      +cj = K.sec_pt(sec, K.sec_lift(secj, c2j))
      +dd = K.p2_len(K.p2_sub(cj, c2))
      +cross = Bool.and(ok, Bool.and(K.is_pos(dd), R.less(dd, R.mul(r, R.from_f32(2.0)))))
      +qo = side_q(st, Bool.pick(U32, U32.is_eq(i, 1), 2, 1))
      meet.pts(cross, k, i, j, s, c2, cj, r, K.sec_pt(sec, C.pl_o(pl)), K.p2_unit(K.sec_dir(sec, C.pl_n(pl))), qo, side_q(st, i))
    case L.NoSt{j, _, _}:
      meet_no(k, i, j, "the other blend has no stripe")

def meet.m(+mj: Maybe<&2, L.Stripe>, +st: L.Stripe, +i: U32, +b: J.Body, +r: R.Real, +ch: Bool, +k: U32, +sec: K.Sec, +c2: K.P2) -> Nt:
  match mj:
    case None{}:
      meet_no(k, i, 0, "the other blend has no stripe")
    case Some{sj}:
      meet.sj(sj, st, i, b, r, ch, k, sec, c2)

def meet.j(+st: L.Stripe, +mj: Maybe<&2, L.Stripe>, +i: U32, +b: J.Body, +r: R.Real, +ch: Bool) -> Nt:
  match st:
    case L.St{k, _, _, _, _, _, sec, _, _, _, c2, _, _, _}:
      meet.m(mj, st, i, b, r, ch, k, sec, c2)
    case L.NoSt{k, _, _}:
      meet_no(k, i, 0, "no stripe")

# ---------------------------------------------------------------------------
# Per side

def side_nt(+st2: U32, +by: U32, +id: U32, +other: U32, +st: L.Stripe, +i: U32, +b: J.Body, +ss: List<&2, L.Stripe>, +r: R.Real, +ch: Bool) -> List<&2, Nt>:
  match st2:
    case 2:
      +k = C.st_edge(st)
      +both = U32.is_eq(other, 2)
      +nt = Bool.pick(Nt, U32.is_eq(by, 2), meet.j(st, C.stripe_of(ss, id), i, b, r, ch), Bool.pick(Nt, ch, face_no(k, i, "chamfer overflow is not a notch in v1"), face.fam(st, i, b, id, r)))
      +lead = Bool.pick(String, U32.is_eq(by, 2), "blend-overlap", "overflow")
      [Bool.pick(Nt, both, NtNo{k, i, lead, "both contacts of " ++ etxt(k) ++ " leave their faces (no notch)"}, nt)]
    case _:
      Nil{}

def bnd_st(+bd: B.Bnd) -> U32:
  B.Bnd{_, _, st} = bd
  st

def bnd_by(+bd: B.Bnd) -> U32:
  B.Bnd{_, lim, _} = bd
  B.Lim{_, _, by, _, _} = lim
  by

def bnd_id(+bd: B.Bnd) -> U32:
  B.Bnd{_, lim, _} = bd
  B.Lim{_, _, _, id, _} = lim
  id

# v1 notches stripes whose ends are caps (or that are closed rims): the
# notch point then ends each stripe in its cap plane.
def plain_ends(+es: List<&2, B.End>) -> Bool:
  match es:
    case Nil{}:
      True{}
    case B.ECap{_} <> t:
      plain_ends(t)
    case B.EClosed{} <> t:
      plain_ends(t)
    case _ <> _:
      False{}

def ends_no(+ns: List<&2, Nt>, +acc: List<&2, Nt>) -> List<&2, Nt>:
  match ns:
    case Nil{}:
      List.reverse(&2, Nt, acc)
    case NtFace{k, i, _, _, _, _} <> t:
      ends_no(t, face_no(k, i, "the stripe ends in a mitre, chain or corner (a notch there is not in v1)") <> acc)
    case NtMeet{k, i, _, j, _} <> t:
      ends_no(t, meet_no(k, i, j, "a stripe ends in a mitre, chain or corner (a notch there is not in v1)") <> acc)
    case x <> t:
      ends_no(t, x <> acc)

def ends_ok(+ok: Bool, +ns: List<&2, Nt>) -> List<&2, Nt>:
  match ok:
    case True{}:
      ns
    case False{}:
      ends_no(ns, Nil{})

def post_nts(+p: B.Post, +st: L.Stripe, +b: J.Body, +ss: List<&2, L.Stripe>, +r: R.Real, +ch: Bool) -> List<&2, Nt>:
  match p:
    case B.Post{b1, b2, ends}:
      +n1 = side_nt(bnd_st(b1), bnd_by(b1), bnd_id(b1), bnd_st(b2), st, 1, b, ss, r, ch)
      +n2 = side_nt(bnd_st(b2), bnd_by(b2), bnd_id(b2), bnd_st(b1), st, 2, b, ss, r, ch)
      ends_ok(plain_ends(ends), List.append(&2, Nt, n1, n2))
    case B.PostNo{}:
      Nil{}

# The notch records of every overflowing side (stripe order).
def notches(+xs: List<&2, L.Stripe>, +ps: List<&2, B.Post>, +b: J.Body, +ss: List<&2, L.Stripe>, +r: R.Real, +ch: Bool, +acc: List<&2, Nt>) -> List<&2, Nt>:
  match xs:
    case Nil{}:
      acc
    case st <> t:
      match ps:
        case p <> pt:
          notches(t, pt, b, ss, r, ch, List.append(&2, Nt, acc, post_nts(p, st, b, ss, r, ch)))
        case Nil{}:
          acc

def find.go(+ts: List<&2, Nt>, +k: U32, +i: U32, +acc: Maybe<&2, Nt>) -> Maybe<&2, Nt>:
  match ts:
    case Nil{}:
      acc
    case t <> r:
      find.go(r, k, i, Bool.pick(Maybe<&2, Nt>, Bool.and(C.is_none(Nt, acc), Bool.and(U32.is_eq(nt_k(t), k), U32.is_eq(nt_i(t), i))), Some{t}, acc))

# The record of side i of stripe k.
def find(+ts: List<&2, Nt>, +k: U32, +i: U32) -> Maybe<&2, Nt>:
  find.go(ts, k, i, None{})

# ---------------------------------------------------------------------------
# Stripes with the notch point in place of the overflowing contact (the
# network and the surgery work on these; the ladder text keeps the contacts).

def set_side(+sd: L.Side, +q: K.P2) -> L.Side:
  L.Side{f, kk, prim, tau, _, w} = sd
  L.Side{f, kk, prim, tau, q, w}

def nt_q(+m: Maybe<&2, Nt>, +d: K.P2) -> K.P2:
  match m:
    case Some{NtFace{_, _, _, _, _, q}}:
      q
    case Some{NtMeet{_, _, _, _, q}}:
      q
    case _:
      d

def apply1(+st: L.Stripe, +ts: List<&2, Nt>) -> L.Stripe:
  match st:
    case L.St{k, f1, f2, convex, sin, cos, sec, e2, s1, s2, c2, kind, surf, same}:
      +q1 = nt_q(find(ts, k, 1), L.side_p(s1))
      +q2 = nt_q(find(ts, k, 2), L.side_p(s2))
      L.St{k, f1, f2, convex, sin, cos, sec, e2, set_side(s1, q1), set_side(s2, q2), c2, kind, surf, same}
    case L.NoSt{k, cls, why}:
      L.NoSt{k, cls, why}

def apply(+xs: List<&2, L.Stripe>, +ts: List<&2, Nt>, +acc: List<&2, L.Stripe>) -> List<&2, L.Stripe>:
  match xs:
    case Nil{}:
      List.reverse(&2, L.Stripe, acc)
    case st <> t:
      apply(t, ts, apply1(st, ts) <> acc)
