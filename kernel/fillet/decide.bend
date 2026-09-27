import Base
import ../real.bend as R
import ../precise.bend as G
import ../analytic.bend as A
import ../robust-predicates.bend as X
import ./job.bend as J
import ./geom.bend as K
import ./exact.bend as E

# Boundary decisions of the production fillet (docs/fillet-plan.md §8 step
# 3): filtered predicates that escalate to exact arithmetic, the modelling
# tolerance and the refusals `sliver` and `undecidable`.
#
# Filter. The ladder computes in F32x2 (about 44 good bits). A value x whose
# magnitude exceeds its rounding allowance eps = 2^-36 * scale (scale: the
# magnitude of the operands, in the job's local frame) has a certain sign.
# Inside the allowance the decision is taken again in exact arithmetic on
# the job's words (kernel/fillet/exact.bend) where an exact form exists;
# otherwise the case is refused as `undecidable`, naming the value and the
# allowance. The allowance is an engineering bound (4096 units in the last
# F32x2 place), not a proof; the exact forms carry the boundary cases.
#
# Modelling tolerance. tau = 1e-6 mm (its F32 word). The fillet never emits
# a face or an edge narrower than tau: a configuration exactly on a boundary
# is built with the boundary's topology (r = w: the face is consumed; r = rho:
# a sphere dome); one within tau of it is refused as `sliver` with the width
# it would have, which is the tolerance a merge would need.

# ---------------------------------------------------------------------------
# Tolerance, allowance, filter

def tau() -> R.Real:
  R.from_f32(0.000001)

def tau_d() -> E.D:
  E.d_real(tau())

# 2^-36
def rel_eps() -> R.Real:
  R.from_f32(0.000000000014551915228366852)

def eps_of(+scale: R.Real) -> R.Real:
  R.mul(R.abs(scale), rel_eps())

def mag(+v: G.Vec3) -> R.Real:
  G.V3{x, y, z} = v
  R.add(R.abs(x), R.add(R.abs(y), R.abs(z)))

# Positive / Negative when |x| > eps; Undefined (ask the exact form) inside.
def filt(+x: R.Real, +eps: R.Real) -> X.Sign:
  Bool.pick(X.Sign, R.less(eps, x), X.Positive{}, Bool.pick(X.Sign, R.less(x, R.neg(eps)), X.Negative{}, X.Undefined{}))

# The smaller of two signs (Negative < ExactlyZero < Positive); Undefined wins.
def s_min(+a: X.Sign, +b: X.Sign) -> X.Sign:
  +undef = Bool.or(E.s_undef(a), E.s_undef(b))
  +neg = Bool.or(E.s_neg(a), E.s_neg(b))
  +zero = Bool.or(E.s_zero(a), E.s_zero(b))
  Bool.pick(X.Sign, undef, X.Undefined{}, Bool.pick(X.Sign, neg, X.Negative{}, Bool.pick(X.Sign, zero, X.ExactlyZero{}, X.Positive{})))

# ---------------------------------------------------------------------------
# Exact forms: v - w = num / den with den > 0, in Q(sqrt ps).

type Ex is Data:
  Ex{ps: List<&2, E.D>, num: E.Q, den: E.Q}
  ExNo{}

# sign(num/den - s tau) for s in {-1, 0, +1} (as a D multiplier of tau).
def ex_sign(+x: Ex, +s: E.D) -> X.Sign:
  match x:
    case Ex{+ps, num, den}:
      E.q_sign(ps, E.q_sub(num, E.q_scale(den, E.d_mul(s, tau_d()))))
    case ExNo{}:
      X.Undefined{}

def ex_ok(+x: Ex) -> Bool:
  match x:
    case Ex{_, _, _}:
      True{}
    case ExNo{}:
      False{}

def d_one() -> E.D:
  E.d_f32(1.0)

def d_mone() -> E.D:
  E.d_neg(d_one())

# Signs of min over two exact forms (a segment obstacle: both end points).
def ex_sign2(+a: Ex, +b: Ex, +s: E.D) -> X.Sign:
  s_min(ex_sign(a, s), ex_sign(b, s))

# ---------------------------------------------------------------------------
# Words of the job

def face_n.s(+same: Bool, +s: A.Surface) -> Maybe<&2, G.Vec3>:
  match s:
    case A.Plane{_, n, _}:
      Some{K.signed(same, n)}
    case _:
      None{}

def face_n.f(+face: J.Face) -> Maybe<&2, G.Vec3>:
  J.Face{same, s, _} = face
  face_n.s(same, s)

def face_n(+fs: List<&2, J.Face>, +f: U32) -> Maybe<&2, G.Vec3>:
  face_n.f(K.face_at(fs, f))

def surf_of(+fs: List<&2, J.Face>, +f: U32) -> A.Surface:
  K.face_surf(K.face_at(fs, f))

# The edge's line direction word, start -> end.
def edge_t.c(+c: A.Curve, +same: Bool) -> Maybe<&2, G.Vec3>:
  match c:
    case A.Line{_, d}:
      Some{K.signed(same, d)}
    case _:
      None{}

def edge_t.e(+ed: J.Edge) -> Maybe<&2, G.Vec3>:
  J.Edge{_, _, c, same, _, _, _} = ed
  edge_t.c(c, same)

def edge_t(+es: List<&2, J.Edge>, +k: U32) -> Maybe<&2, G.Vec3>:
  edge_t.e(K.edge_at(es, k))

# ---------------------------------------------------------------------------
# Translation stripe between two planes: the spring on side i.
#   w = r sig det(n1, t, n2) / (|t| (|n1||n2| + n1.n2)),  sig = -1 convex, +1 concave
#   (chamfer: w = d),  lambda(x) = tau_i . (x - e) / (|n_i| |t|),
#   tau_1 = n1 x t,  tau_2 = t x n2  (the ladder's in-face directions).
# ps = [|n_i|^2, |n_j|^2, |t|^2].

def ex_tp.q(+ch: Bool, +ps: List<&2, E.D>, +p: E.D, +dt: E.D, +nn: E.D, +rs: E.D, +d: E.D) -> Ex:
  +ri = E.q_root(0n)
  +rj = E.q_root(1n)
  +rt = E.q_root(2n)
  +a = E.q_add(E.q_mul(ps, ri, rj), E.q_d(nn))
  +fnum = E.q_sub(E.q_mul(ps, E.q_d(p), a), E.q_scale(ri, E.d_mul(rs, dt)))
  +fden = E.q_mul(ps, rt, E.q_mul(ps, ri, a))
  +cnum = E.q_sub(E.q_d(p), E.q_scale(E.q_mul(ps, ri, rt), d))
  +cden = E.q_mul(ps, ri, rt)
  Bool.pick(Ex, ch, Ex{ps, cnum, cden}, Ex{ps, fnum, fden})

# ni: side i's normal, nj: the other's; n1/n2 order for det by `side1`.
def ex_tp(+ch: Bool, +side1: Bool, +convex: Bool, +size: R.Real, +ni: G.Vec3, +nj: G.Vec3, +t: G.Vec3, +e: G.Vec3, +x: G.Vec3) -> Ex:
  +vi = E.dv(ni)
  +vj = E.dv(nj)
  +vt = E.dv(t)
  +taui = Bool.pick(E.DV, side1, E.dv_cross(vi, vt), E.dv_cross(vt, vi))
  +p = E.dv_dot(taui, E.dv_sub(E.dv(x), E.dv(e)))
  +det = Bool.pick(E.D, side1, E.dv_det(vi, vt, vj), E.dv_det(vj, vt, vi))
  +r = E.d_real(size)
  +rs = Bool.pick(E.D, convex, E.d_neg(r), r)
  ex_tp.q(ch, {[E.dv_norm2(vi), E.dv_norm2(vj), E.dv_norm2(vt)] : List<&2, E.D>}, p, det, E.dv_dot(vi, vj), rs, r)

# ---------------------------------------------------------------------------
# Width status (bounds.bend Bnd.st): 0 inside, 1 consumed, 2 overflow,
# 3 unknown obstacle, 4 sliver, 5 undecidable.

type Wst is Data:
  Wst{st: U32, exact: Bool}

def wst_of(+s0: X.Sign, +sm: X.Sign, +sp: X.Sign, +exact: Bool) -> Wst:
  +undef = Bool.or(E.s_undef(s0), Bool.or(Bool.and(E.s_pos(s0), E.s_undef(sm)), Bool.and(E.s_neg(s0), E.s_undef(sp))))
  +inside = Bool.pick(U32, E.s_neg(sm), 4, 0)
  +over = Bool.pick(U32, E.s_pos(sp), 4, 2)
  +st = Bool.pick(U32, E.s_zero(s0), 1, Bool.pick(U32, E.s_pos(s0), inside, over))
  Wst{Bool.pick(U32, undef, 5, st), exact}

# Needed filter signs undecided?
def wst_need(+s0: X.Sign, +sm: X.Sign, +sp: X.Sign) -> Bool:
  Bool.or(E.s_undef(s0), Bool.or(Bool.and(E.s_pos(s0), E.s_undef(sm)), Bool.and(E.s_neg(s0), E.s_undef(sp))))

# The filter signs of gap = v - w (F32x2) against 0, +tau and -tau. The
# caller builds the exact forms of v - w only when wf_need says the filter
# cannot decide (they cost Big-integer products), then asks wst_exact.
type Wf is Data:
  Wf{s0: X.Sign, sm: X.Sign, sp: X.Sign}

def width_filter(+gap: R.Real, +scale: R.Real) -> Wf:
  +eps = eps_of(scale)
  Wf{filt(gap, eps), filt(R.sub(gap, tau()), eps), filt(R.add(gap, tau()), eps)}

def wf_need(+f: Wf) -> Bool:
  Wf{s0, sm, sp} = f
  wst_need(s0, sm, sp)

def wf_status(+f: Wf) -> Wst:
  Wf{s0, sm, sp} = f
  wst_of(s0, sm, sp, False{})

# a, b: exact forms of v - w (b = a for one point).
def wst_exact(+a: Ex, +b: Ex) -> Wst:
  wst_of(ex_sign2(a, b, E.d_zero()), ex_sign2(a, b, d_one()), ex_sign2(a, b, d_mone()), True{})

# ---------------------------------------------------------------------------
# Rim stripes (rotation family): a plane perpendicular to the axis and a
# coaxial cylinder of radius R. The ball centre lies at radius R + s r
# (s = +1 when it is outside the cylinder surface); the spring on the plane
# lies there too, at width r from the edge (radius R). Values are exact in
# the words R, r and an obstacle circle's radius.

type Rim is Data:
  Rim{big: R.Real, out: Bool}
  RimNo{}

def rim_of.s(+s1: A.Surface, +s2: A.Surface) -> Rim:
  match s1:
    case A.Plane{_, _, _}:
      match s2:
        case A.Cylinder{_, _, _, rr}:
          Rim{rr, False{}}
        case _:
          RimNo{}
    case A.Cylinder{_, _, _, rr}:
      match s2:
        case A.Plane{_, _, _}:
          Rim{rr, False{}}
        case _:
          RimNo{}
    case _:
      RimNo{}

def rim_of(+fs: List<&2, J.Face>, +f1: U32, +f2: U32) -> Rim:
  rim_of.s(surf_of(fs, f1), surf_of(fs, f2))

# rho_c = R + s r exactly, as an Ex (den 1).
def ex_rho(+rr: R.Real, +out: Bool, +size: R.Real) -> Ex:
  +r = E.d_real(size)
  Ex{Nil{}, E.q_d(E.d_add(E.d_real(rr), Bool.pick(E.D, out, r, E.d_neg(r)))), E.q_d(d_one())}

# v - w for the plane side of a rim against the axis (spring moving in):
# R - r; against a coaxial circle of radius rc: rc - R - r (out) or
# R - rc - r (in).
def ex_rim_axis(+rr: R.Real, +size: R.Real) -> Ex:
  Ex{Nil{}, E.q_d(E.d_sub(E.d_real(rr), E.d_real(size))), E.q_d(d_one())}

def ex_rim_circ(+rr: R.Real, +rc: R.Real, +out: Bool, +size: R.Real) -> Ex:
  +a = E.d_real(rr)
  +c = E.d_real(rc)
  +gap = Bool.pick(E.D, out, E.d_sub(c, a), E.d_sub(a, c))
  Ex{Nil{}, E.q_d(E.d_sub(gap, E.d_real(size))), E.q_d(d_one())}

# Sign of the torus major rho_c against 0 and tau: Rho{sign, below tau}.
type Rho is Data:
  Rho{s: X.Sign, thin: X.Sign}

# rho: the F32x2 centre radius; x: its exact form (ExNo: none).
def rho_sign.x(+need: Bool, +s0: X.Sign, +sm: X.Sign, +x: Ex) -> Rho:
  match need:
    case False{}:
      Rho{s0, sm}
    case True{}:
      Rho{ex_sign(x, E.d_zero()), ex_sign(x, d_one())}

def rho_sign(+rho: R.Real, +scale: R.Real, +x: Ex) -> Rho:
  +eps = eps_of(scale)
  +s0 = filt(rho, eps)
  +sm = filt(R.sub(rho, tau()), eps)
  rho_sign.x(Bool.or(E.s_undef(s0), Bool.and(E.s_pos(s0), E.s_undef(sm))), s0, sm, x)

# ---------------------------------------------------------------------------
# Blend width (the chord between the two contacts) of a translation stripe
# between two planes, against tau:
#   fillet  chord^2 = 2 r^2 (|n1||n2| - n1.n2) / (|n1||n2|)
#   chamfer chord^2 = 2 d^2 (|n1||n2| + n1.n2) / (|n1||n2|)
# sign(chord - tau) = sign(chord^2 - tau^2).

def ex_chord(+ch: Bool, +size: R.Real, +n1: G.Vec3, +n2: G.Vec3) -> Ex:
  +v1 = E.dv(n1)
  +v2 = E.dv(n2)
  +ps = {[E.dv_norm2(v1), E.dv_norm2(v2)] : List<&2, E.D>}
  +rr = E.q_mul(ps, E.q_root(0n), E.q_root(1n))
  +nn = E.dv_dot(v1, v2)
  +d = E.d_real(size)
  +k = E.d_mul(E.d_f32(2.0), E.d_mul(d, d))
  +inner = Bool.pick(E.Q, ch, E.q_add(rr, E.q_d(nn)), E.q_sub(rr, E.q_d(nn)))
  +t = tau_d()
  Ex{ps, E.q_sub(E.q_scale(inner, k), E.q_scale(rr, E.d_mul(t, t))), E.q_d(d_one())}

# Chord status: 0 wide enough, 4 sliver (6: decided exactly), 5 undecidable.
# The filter sign of chord - tau decides unless chord_need; only then does
# the caller build the exact form and ask chord_exact.
def chord_filter(+chord: R.Real, +scale: R.Real) -> X.Sign:
  filt(R.sub(chord, tau()), eps_of(scale))

def chord_need(+s: X.Sign) -> Bool:
  E.s_undef(s)

def chord_filtered(+s: X.Sign) -> U32:
  Bool.pick(U32, E.s_neg(s), 4, 0)

def chord_exact(+x: Ex) -> U32:
  +e = ex_sign(x, E.d_zero())
  Bool.pick(U32, E.s_undef(e), 5, Bool.pick(U32, E.s_neg(e), 6, 0))

# ---------------------------------------------------------------------------
# Tangent edges: two plane normals exactly parallel (the cross product of
# the words is the zero vector).

def planes_parallel(+n1: G.Vec3, +n2: G.Vec3) -> Bool:
  E.dv_is_zero(E.dv_cross(E.dv(n1), E.dv(n2)))

# ---------------------------------------------------------------------------
# Reason texts

def show_exact(+exact: Bool) -> String:
  Bool.pick(String, exact, " (exact)", "")

def sliver_why(+what: String, +width: R.Real, +exact: Bool) -> String:
  what ++ " would be " ++ K.show_sci(R.abs(width)) ++ " mm wide" ++ show_exact(exact) ++ ", below the modelling tolerance " ++ K.show_sci(tau()) ++ " mm; merging it needs a tolerance of " ++ K.show_gap(R.abs(width)) ++ " mm"

def undecidable_why(+what: String, +x: R.Real, +scale: R.Real) -> String:
  what ++ " is " ++ K.show_gap(x) ++ ", within its rounding allowance " ++ K.show_gap(eps_of(scale)) ++ ", and has no exact form here"

# ---------------------------------------------------------------------------
# Coincidence of constructed points (mitre gap, spring on an edge end, G1
# chain sections, corner ball contacts, vertex merge, edge pairing). The
# points are constructions (radicals, trigonometry) with no exact form on the
# job's words, so the decision is three-way against the modelling tolerance:
#   coincident  |gap| < ceps = max(1e-9 mm, 2^-36 * scale): the same point
#               (rounding of one exact point computed along two paths);
#   sliver      ceps <= |gap| < tau: refused as `sliver` with the gap as the
#               needed tolerance;
#   distinct    |gap| >= tau.
# scale is the magnitude of the operands in the job's local frame, so the
# band follows the coordinates, not the absolute position of the part.

def ceps(+scale: R.Real) -> R.Real:
  R.max(K.tol_lin(), eps_of(scale))

def coincide(+gap: R.Real, +scale: R.Real) -> Bool:
  R.less(R.abs(gap), ceps(scale))

# 0 coincident, 1 sliver, 2 distinct.
def gap_st(+gap: R.Real, +scale: R.Real) -> U32:
  Bool.pick(U32, coincide(gap, scale), 0, Bool.pick(U32, R.less(R.abs(gap), tau()), 1, 2))

# The refusal class of a failed coincidence: a gap below tau is a sliver.
def gap_cls(+gap: R.Real, +cls: String) -> String:
  Bool.pick(String, R.less(R.abs(gap), tau()), "sliver", cls)

def gap_note(+gap: R.Real) -> String:
  Bool.pick(String, R.less(R.abs(gap), tau()), " (below the modelling tolerance " ++ K.show_sci(tau()) ++ " mm; merging needs a tolerance of " ++ K.show_gap(R.abs(gap)) ++ " mm)", "")
