import Base
import ../real.bend as R
import ../precise.bend as G
import ../analytic.bend as A
import ../robust-predicates.bend as X
import ./job.bend as J
import ./geom.bend as K
import ./exact.bend as E
import ./decide.bend as D
import ./ladder.bend as L
import ./bounds.bend as B
import ./corners.bend as C

# The width bounds of stage 1 decided again (docs/fillet-plan.md §8 step 3).
# bounds.bend compares the width w a contact needs with the width v the face
# leaves in F32x2. Here the comparison goes through the filter of
# decide.bend: outside the rounding allowance the F32x2 sign stands; inside
# it the sign of v - w, v - w - tau and v - w + tau is taken exactly on the
# job's words where an exact form exists:
#   translation stripe between two planes, obstacle a boundary line of the
#     face (both end points; the smaller lambda counts) or the spring of
#     another plane/plane stripe (all words unit vectors, both edges
#     perpendicular to the face normal);
#   rim (a plane perpendicular to the axis and a coaxial cylinder), plane
#     side, obstacle the axis or a circle exactly coaxial with the
#     cylinder (on the words). A circle off the axis has no exact form here
#     (the bound may come from any point of its arc, or an end point).
# The refined status: 0 inside (gap >= tau), 1 consumed (v = w exactly or by
# the filter), 2 overflow (by at least tau), 4 sliver (inside by less than
# tau, or overflowing by less than tau), 5 undecidable (inside the allowance
# with no exact form). 3 (an obstacle without a bound) is left as it is.

# ---------------------------------------------------------------------------
# Plane/plane translation stripes

def vtx_of(+b: J.Body, +i: U32) -> G.Vec3:
  K.vtx(K.body_vs(b), i)

def some_v(+m: Maybe<&2, G.Vec3>) -> G.Vec3:
  match m:
    case Some{v}:
      v
    case None{}:
      K.zero_v()

def is_some_v(+m: Maybe<&2, G.Vec3>) -> Bool:
  match m:
    case Some{_}:
      True{}
    case None{}:
      False{}

def is_line(+c: A.Curve) -> Bool:
  U32.is_eq(K.curve_kind(c), 0)

# Both end points of the obstacle line id as exact forms.
type Ex2 is Data:
  Ex2{a: D.Ex, b: D.Ex}

def ex2_no() -> Ex2:
  Ex2{D.ExNo{}, D.ExNo{}}

def tp_edge.ok(+ok: Bool, +ch: Bool, +side1: Bool, +convex: Bool, +size: R.Real, +ni: G.Vec3, +nj: G.Vec3, +t: G.Vec3, +e: G.Vec3, +xa: G.Vec3, +xb: G.Vec3) -> Ex2:
  match ok:
    case False{}:
      ex2_no()
    case True{}:
      Ex2{D.ex_tp(ch, side1, convex, size, ni, nj, t, e, xa), D.ex_tp(ch, side1, convex, size, ni, nj, t, e, xb)}

# The obstacle must be a line parallel to the edge (then the smaller of its
# end points' lambda is the bound, as in bounds.bend lam_tp).
def tp_edge(+b: J.Body, +ch: Bool, +side1: Bool, +convex: Bool, +size: R.Real, +k: U32, +fi: U32, +fj: U32, +id: U32) -> Ex2:
  +fs = K.body_fs(b)
  +es = K.body_es(b)
  +mi = D.face_n(fs, fi)
  +mj = D.face_n(fs, fj)
  +mt = D.edge_t(es, k)
  +ob = K.edge_at(es, id)
  +line = is_line(K.edge_curve(ob))
  +xa = vtx_of(b, K.edge_s(ob))
  +xb = vtx_of(b, K.edge_e(ob))
  +t = some_v(mt)
  +par = K.parallel(G.normalize(G.sub(xb, xa)), G.normalize(t))
  +ok = Bool.and(Bool.and(Bool.and(is_some_v(mi), is_some_v(mj)), Bool.and(is_some_v(mt), line)), par)
  tp_edge.ok(ok, ch, side1, convex, size, some_v(mi), some_v(mj), t, vtx_of(b, K.edge_s(K.edge_at(es, k))), xa, xb)

# The other stripe j's spring on the same face f, all words unit vectors:
#   v - w_k = tau_k.(e_j - e_k) + w_j (tau_k.tau_j) - w_k
# with w = r sig det / (1 + n1.n2) (chamfer: d) and tau as in ex_tp.
type Pp is Data:
  Pp{nf: G.Vec3, no: G.Vec3, t: G.Vec3, e: G.Vec3, side1: Bool, convex: Bool}
  PpNo{}

def pp_of.st(+b: J.Body, +f: U32, +k: U32, +f1: U32, +f2: U32, +convex: Bool) -> Pp:
  +fs = K.body_fs(b)
  +es = K.body_es(b)
  +side1 = U32.is_eq(f1, f)
  +mo = D.face_n(fs, Bool.pick(U32, side1, f2, f1))
  +mf = D.face_n(fs, f)
  +mt = D.edge_t(es, k)
  +ok = Bool.and(is_some_v(mf), Bool.and(is_some_v(mo), is_some_v(mt)))
  Bool.pick(Pp, ok, Pp{some_v(mf), some_v(mo), some_v(mt), vtx_of(b, K.edge_s(K.edge_at(es, k))), side1, convex}, PpNo{})

def pp_of(+b: J.Body, +f: U32, +m: Maybe<&2, L.Stripe>) -> Pp:
  match m:
    case Some{L.St{k, f1, f2, convex, _, _, _, _, _, _, _, _, _, _}}:
      pp_of.st(b, f, k, f1, f2, convex)
    case _:
      PpNo{}

def pp_tau(+side1: Bool, +nf: E.DV, +t: E.DV) -> E.DV:
  Bool.pick(E.DV, side1, E.dv_cross(nf, t), E.dv_cross(t, nf))

def pp_det(+side1: Bool, +nf: E.DV, +no: E.DV, +t: E.DV) -> E.D:
  Bool.pick(E.D, side1, E.dv_det(nf, t, no), E.dv_det(no, t, nf))

def zero_d(+d: E.D) -> Bool:
  E.s_zero(E.d_sign(d))

# Unit words, both normals perpendicular to the edge.
def pp_unit(+nf: E.DV, +no: E.DV, +t: E.DV) -> Bool:
  Bool.and(Bool.and(E.dv_unit(nf), E.dv_unit(no)), Bool.and(E.dv_unit(t), Bool.and(zero_d(E.dv_dot(nf, t)), zero_d(E.dv_dot(no, t)))))

def pp_sig(+convex: Bool, +r: E.D) -> E.D:
  Bool.pick(E.D, convex, E.d_neg(r), r)

def spring.ex(+ch: Bool, +size: R.Real, +k: Pp, +j: Pp) -> D.Ex:
  match k:
    case Pp{nfk, nok, tk, ek, s1k, cvk}:
      match j:
        case Pp{_, noj, tj, ej, s1j, cvj}:
          +nf = E.dv(nfk)
          +vok = E.dv(nok)
          +voj = E.dv(noj)
          +vtk = E.dv(tk)
          +vtj = E.dv(tj)
          +ok = Bool.and(pp_unit(nf, vok, vtk), pp_unit(nf, voj, vtj))
          +tauk = pp_tau(s1k, nf, vtk)
          +tauj = pp_tau(s1j, nf, vtj)
          +a = E.dv_dot(tauk, E.dv_sub(E.dv(ej), E.dv(ek)))
          +c = E.dv_dot(tauk, tauj)
          +r = E.d_real(size)
          +bk = E.d_add(D.d_one(), E.dv_dot(nf, vok))
          +bj = E.d_add(D.d_one(), E.dv_dot(nf, voj))
          +wkn = E.d_mul(pp_sig(cvk, r), pp_det(s1k, nf, vok, vtk))
          +wjn = E.d_mul(pp_sig(cvj, r), pp_det(s1j, nf, voj, vtj))
          +fnum = E.d_add(E.d_mul(a, E.d_mul(bk, bj)), E.d_sub(E.d_mul(wjn, E.d_mul(c, bk)), E.d_mul(wkn, bj)))
          +cnum = E.d_add(a, E.d_sub(E.d_mul(r, c), r))
          +num = Bool.pick(E.D, ch, cnum, fnum)
          +den = Bool.pick(E.D, ch, D.d_one(), E.d_mul(bk, bj))
          Bool.pick(D.Ex, ok, D.Ex{Nil{}, E.q_d(num), E.q_d(den)}, D.ExNo{})
        case PpNo{}:
          D.ExNo{}
    case PpNo{}:
      D.ExNo{}

def tp_spring(+b: J.Body, +ss: List<&2, L.Stripe>, +ch: Bool, +size: R.Real, +k: U32, +f: U32, +j: U32) -> Ex2:
  +x = spring.ex(ch, size, pp_of(b, f, C.stripe_of(ss, k)), pp_of(b, f, C.stripe_of(ss, j)))
  +y = x
  Ex2{x, y}

# ---------------------------------------------------------------------------
# Rims

def rim_big(+rim: D.Rim) -> R.Real:
  match rim:
    case D.Rim{big, _}:
      big
    case D.RimNo{}:
      K.zero()

def rim_ok(+rim: D.Rim) -> Bool:
  match rim:
    case D.Rim{_, _}:
      True{}
    case D.RimNo{}:
      False{}

def circ_r(+c: A.Curve) -> Maybe<&2, R.Real>:
  match c:
    case A.Circle{_, _, _, rc}:
      Some{rc}
    case _:
      None{}

def rim_circ.m(+m: Maybe<&2, R.Real>, +rr: R.Real, +out: Bool, +size: R.Real) -> Ex2:
  match m:
    case Some{rc}:
      +x = D.ex_rim_circ(rr, rc, out, size)
      +y = x
      Ex2{x, y}
    case None{}:
      ex2_no()

# Is the circle cv exactly coaxial with the cylinder cy (on the words: its
# normal and the offset of its centre from the axis origin both parallel to
# the axis)? Only then is every point of it at its radius from the axis, so
# v = |R - rc| whatever part of the circle (arc, end point) set the bound.
def coax_circ(+cy: A.Surface, +cv: A.Curve) -> Bool:
  match cy:
    case A.Cylinder{o, a, _, _}:
      match cv:
        case A.Circle{oc, n, _, _}:
          +da = E.dv(a)
          Bool.and(E.dv_is_zero(E.dv_cross(da, E.dv(n))), E.dv_is_zero(E.dv_cross(da, E.dv_sub(E.dv(oc), E.dv(o)))))
        case _:
          False{}
    case _:
      False{}

def rim_circ(+coax: Bool, +cv: A.Curve, +rr: R.Real, +out: Bool, +size: R.Real) -> Ex2:
  match coax:
    case True{}:
      rim_circ.m(circ_r(cv), rr, out, size)
    case False{}:
      ex2_no()

# The plane side of a rim: obstacle the axis (by 3) or a circle edge
# exactly coaxial with the rim (by 1). Any other obstacle (a circle off the
# axis, an arc end point, a line) has no exact form here: a tie inside the
# rounding allowance stays undecidable.
def rim_ex.ok(+ok: Bool, +b: J.Body, +cy: A.Surface, +by: U32, +id: U32, +rr: R.Real, +out: Bool, +size: R.Real) -> Ex2:
  match ok:
    case False{}:
      ex2_no()
    case True{}:
      match by:
        case 3:
          +x = D.ex_rim_axis(rr, size)
          +y = x
          Ex2{x, y}
        case 1:
          +cv = K.edge_curve(K.edge_at(K.body_es(b), id))
          rim_circ(coax_circ(cy, cv), cv, rr, out, size)
        case _:
          ex2_no()

def rim_ex(+b: J.Body, +fi: U32, +fj: U32, +by: U32, +id: U32, +out: Bool, +size: R.Real) -> Ex2:
  +fs = K.body_fs(b)
  +rim = D.rim_of(fs, fi, fj)
  +plane = U32.is_eq(K.surf_kind(D.surf_of(fs, fi)), 0)
  rim_ex.ok(Bool.and(plane, rim_ok(rim)), b, D.surf_of(fs, fj), by, id, rim_big(rim), out, size)

# ---------------------------------------------------------------------------
# One side

type Sd is Data:
  Sd{b: J.Body, ss: List<&2, L.Stripe>, ch: Bool, size: R.Real}

def forms.tra(+x: Sd, +by: U32, +side1: Bool, +convex: Bool, +k: U32, +fi: U32, +fj: U32, +id: U32) -> Ex2:
  Sd{b, ss, ch, size} = x
  match by:
    case 1:
      tp_edge(b, ch, side1, convex, size, k, fi, fj, id)
    case 2:
      tp_spring(b, ss, ch, size, k, fi, id)
    case _:
      ex2_no()

def forms(+sec: K.Sec, +x: Sd, +side1: Bool, +convex: Bool, +k: U32, +fi: U32, +fj: U32, +by: U32, +id: U32, +out: Bool) -> Ex2:
  match sec:
    case K.Tra{_, _, _, _, _}:
      forms.tra(x, by, side1, convex, k, fi, fj, id)
    case K.Rot{_, _, _, _}:
      Sd{b, _, _, size} = x
      rim_ex(b, fi, fj, by, id, out, size)

def sec_scale(+sec: K.Sec) -> R.Real:
  match sec:
    case K.Tra{e, _, _, _, len}:
      R.add(D.mag(e), len)
    case K.Rot{o, _, _, _}:
      D.mag(o)

def ex2_status(+e2: Ex2) -> D.Wst:
  Ex2{a, b} = e2
  D.wst_exact(a, b)

# The filter's status stands where it decides; only where it cannot are the
# exact forms built (a match, so the False arm never evaluates them).
def width_st(+need: Bool, +f: D.Wf, +sec: K.Sec, +x: Sd, +side1: Bool, +convex: Bool, +k: U32, +fi: U32, +fj: U32, +by: U32, +id: U32, +out: Bool) -> D.Wst:
  match need:
    case False{}:
      D.wf_status(f)
    case True{}:
      ex2_status(forms(sec, x, side1, convex, k, fi, fj, by, id, out))

# Sliver decided exactly: 6 (the text says so).
def wst_st(+w: D.Wst) -> U32:
  D.Wst{+st, exact} = w
  Bool.pick(U32, Bool.and(exact, U32.is_eq(st, 4)), 6, st)

def refine_bnd.go(+go: Bool, +bd: B.Bnd, +x: Sd, +sec: K.Sec, +side1: Bool, +convex: Bool, +k: U32, +fi: U32, +fj: U32, +out: Bool) -> B.Bnd:
  match go:
    case False{}:
      bd
    case True{}:
      B.Bnd{w, lim, _} = bd
      B.Lim{has, v, by, id, unk} = lim
      Sd{_, _, _, size} = x
      +scale = R.add(R.add(sec_scale(sec), size), R.add(R.abs(v), R.abs(w)))
      +f = D.width_filter(R.sub(v, w), scale)
      B.Bnd{w, B.Lim{has, v, by, id, unk}, wst_st(width_st(D.wf_need(f), f, sec, x, side1, convex, k, fi, fj, by, id, out))}

def bnd_go(+bd: B.Bnd) -> Bool:
  B.Bnd{_, lim, st} = bd
  B.Lim{has, _, _, _, unk} = lim
  Bool.and(Bool.and(has, Bool.not(unk)), U32.is_lt(st, 3))

# The spring moves away from the axis on a rim's plane side.
def side_out(+sec: K.Sec, +sd: L.Side) -> Bool:
  match sec:
    case K.Rot{_, _, _, _}:
      K.is_pos(K.p2_x(L.side_tau(sd)))
    case K.Tra{_, _, _, _, _}:
      False{}

def refine_bnd(+bd: B.Bnd, +x: Sd, +sec: K.Sec, +side1: Bool, +convex: Bool, +k: U32, +fi: U32, +fj: U32, +sd: L.Side) -> B.Bnd:
  +go = bnd_go(bd)
  refine_bnd.go(go, bd, x, sec, side1, convex, k, fi, fj, side_out(sec, sd))

def refine_post(+p: B.Post, +st: L.Stripe, +x: Sd) -> B.Post:
  match p:
    case B.Post{b1, b2, ends}:
      match st:
        case L.St{k, f1, f2, convex, _, _, sec, _, s1, s2, _, _, _, _}:
          +sc = sec
          B.Post{refine_bnd(b1, x, sc, True{}, convex, k, f1, f2, s1), refine_bnd(b2, x, sc, False{}, convex, k, f2, f1, s2), ends}
        case L.NoSt{_, _, _}:
          B.Post{b1, b2, ends}
    case B.PostNo{}:
      B.PostNo{}

# Every post, in stripe order.
def refine(+ps: List<&2, B.Post>, +xs: List<&2, L.Stripe>, +x: Sd, +acc: List<&2, B.Post>) -> List<&2, B.Post>:
  match ps:
    case Nil{}:
      List.reverse(&2, B.Post, acc)
    case p <> pt:
      match xs:
        case st <> xt:
          refine(pt, xt, x, refine_post(p, st, x) <> acc)
        case Nil{}:
          List.reverse(&2, B.Post, acc)
