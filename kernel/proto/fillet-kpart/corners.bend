import Base
import ../../real.bend as R
import ../../precise.bend as G
import ../../robust-predicates.bend as X
import ./job.bend as J
import ./geom.bend as K
import ./ladder.bend as L
import ./bounds.bend as B

# Stage 2 of prototype A "fillet-kpart": the corner network
# (docs/fillet/proto-kpart.md, "Stage A2"; theory §6-7, fillet.md §5.1 step 4).
#
# Every stripe end is a planar cut of the stripe: a *tip*. The cut plane, the
# two spring end points and the exact end curve (carrier ∩ cut plane between
# the springs) are computed per end:
#   cap     the cap face's plane (a plane face; curved caps give space
#           quartics and are refused); circle ⟂ cut, ellipse oblique, segment
#           for chamfers; each spring must end on the cap edge next to it;
#   mitre   the bisector plane of the two blends (normal d_k − d_j): an
#           ellipse (equal-radius cylinders with meeting spines) or a segment
#           (two chamfer planes). Both outer springs must end at the same
#           point of the third edge, else a setback patch is needed (refused);
#   chain   the section plane at the vertex (⟂ tangent): both stripes must
#           give the same section;
#   corner  a sphere corner (three planes, one convexity: 3×3 solve with an
#           exact rank test on the face normals) cuts each stripe in the plane
#           through the ball centre ⟂ its spine: a great arc; a chamfer corner
#           (Onshape FP-b) cuts each chamfer at the segment between the points
#           where its springs meet the neighbouring chamfers' springs, and the
#           triangle through those three points closes the corner.
# Face consumption: a side whose spring reaches another spring of the same
# carrier merges the two stripes into one face (full round); one that reaches
# a boundary edge makes that edge the blend's boundary; the dome reaches the
# axis. The consumed face vanishes, which needs the springs to cover it
# exactly (a face pinched at a point is refused).
# The B-rep surgery (trimming the support faces, new loops) is stage 3.

# ---------------------------------------------------------------------------
# Data

type Pl is Data:
  Pl{o: G.Vec3, n: G.Vec3}

# Where a tip point sits: on an input edge (cap edge, mitre edge) or inside a
# support face.
type At is Data:
  AtEdge{e: U32}
  AtFace{f: U32}

# A curve piece from t0 to t1 (t0 < t1).
type Arc is Data:
  Arc{c: J.Curve, t0: R.Real, t1: R.Real}

# The second end piece of a setback mitre (fillets; see "Mitres"): the
# stripe's end runs over the mitre curve to pm, where the partner's outer
# spring leaves the mitre, and on over the trim curve (its carrier cut by the
# partner's outer face f, cut plane `cut`) to its own outer spring's end on
# the third edge, which is the tip's point on side `side`. Both pieces run in
# the tip's p1 -> p2 sense: side 2: arc p1 -> pm, trim pm -> p2; side 1: trim
# p1 -> pm, arc pm -> p2.
type Tr is Data:
  TrNo{}
  Tr{f: U32, side: U32, pm: G.Vec3, cut: Pl, arc: Arc}

# kind: 0 cap (with = cap face), 1 mitre (with = other edge), 2 chain
# (with = other edge), 3 sphere corner, 4 chamfer corner (with = vertex)
type Tip is Data:
  Tip{e: U32, v: U32, kind: U32, with: U32, cut: Pl, p1: G.Vec3, a1: At, p2: G.Vec3, a2: At, arc: Arc, tr: Tr}
  TipClosed{e: U32}
  TipNo{e: U32, v: U32, cls: String, why: String}

type Cor is Data:
  CorSph{v: U32, c: G.Vec3, r: R.Real, fs: List<&2, U32>, ts: List<&2, G.Vec3>}
  CorTri{v: U32, pl: Pl, fs: List<&2, U32>, qs: List<&2, G.Vec3>}
  CorNo{v: U32, cls: String, why: String}

# kind: 0 merge (full round, with = the other stripe), 1 edge (with = the
# boundary edge the spring reaches), 2 axis (dome)
type Eat is Data:
  Eat{f: U32, k: U32, kind: U32, with: U32}
  EatNo{f: U32, cls: String, why: String}

# What a tip needs of a stripe.
type Sx is Data:
  Sx{k: U32, f1: U32, f2: U32, convex: Bool, sec: K.Sec, q1: K.P2, q2: K.P2, c2: K.P2, surf: J.Surf}

def sx_of(+st: L.Stripe) -> Maybe<&2, Sx>:
  match st:
    case L.St{k, f1, f2, convex, _, _, sec, _, s1, s2, c2, _, surf, _}:
      Some{Sx{k, f1, f2, convex, sec, L.side_p(s1), L.side_p(s2), c2, surf}}
    case L.NoSt{_, _, _}:
      None{}

def st_edge(+st: L.Stripe) -> U32:
  match st:
    case L.St{k, _, _, _, _, _, _, _, _, _, _, _, _, _}:
      k
    case L.NoSt{k, _, _}:
      k

def is_none(-A: Data, +m: Maybe<&2, A>) -> Bool:
  match m:
    case None{}:
      True{}
    case Some{_}:
      False{}

# Searches are tail-recursive (a scan with the first hit carried along): the
# Metal target runs the whole solve as one device call with a small machine
# stack (the 50-stripe comb overflowed it with nested searches).
def find_sx.go(+ss: List<&2, L.Stripe>, +e: U32, +acc: Maybe<&2, Sx>) -> Maybe<&2, Sx>:
  match ss:
    case Nil{}:
      acc
    case s <> t:
      find_sx.go(t, e, Bool.pick(Maybe<&2, Sx>, Bool.and(is_none(Sx, acc), U32.is_eq(st_edge(s), e)), sx_of(s), acc))

def find_sx(+ss: List<&2, L.Stripe>, +e: U32) -> Maybe<&2, Sx>:
  find_sx.go(ss, e, None{})

def sx_k(+x: Sx) -> U32:
  Sx{k, _, _, _, _, _, _, _, _} = x
  k

def sx_convex(+x: Sx) -> Bool:
  Sx{_, _, _, convex, _, _, _, _, _} = x
  convex

def sec_d(+sec: K.Sec) -> G.Vec3:
  match sec:
    case K.Tra{_, d, _, _, _}:
      d
    case K.Rot{_, a, _, _}:
      a

def none_u32() -> U32:
  4294967295

def vtxt(+v: U32) -> String:
  " at vertex " ++ K.show_u32(v)

def etxt(+e: U32) -> String:
  "edge " ++ K.show_u32(e)

# ---------------------------------------------------------------------------
# Geometry

# Point of the line (p, d) in the plane (o, n); n·d ≠ 0.
def line_plane(+p: G.Vec3, +d: G.Vec3, +o: G.Vec3, +n: G.Vec3) -> G.Vec3:
  K.axpy(p, R.div(G.dot(n, G.sub(o, p)), G.dot(n, d)), d)

# Meeting point of two coplanar, non-parallel lines.
def meet2(+p1: G.Vec3, +d1: G.Vec3, +p2: G.Vec3, +d2: G.Vec3) -> G.Vec3:
  +c = G.cross(d1, d2)
  K.axpy(p1, R.div(G.dot(G.cross(G.sub(p2, p1), d2), c), G.dot(c, c)), d1)

def dist_line(+p: G.Vec3, +o: G.Vec3, +d: G.Vec3) -> R.Real:
  K.line_dist(o, G.normalize(d), p)

def wrap_pi(+a: R.Real) -> R.Real:
  +tp = K.two_pi()
  +hi = Bool.pick(R.Real, R.less(R.pi(), a), R.sub(a, tp), a)
  Bool.pick(R.Real, Bool.not(R.less(R.neg(R.pi()), hi)), R.add(hi, tp), hi)

# The point of the section at the vertex position vp: a spring (contact q),
# or the spine (centre q), of a translation or rotation stripe.
def sp_at(+sec: K.Sec, +q: K.P2, +vp: G.Vec3) -> G.Vec3:
  match sec:
    case K.Tra{_, d, _, _, _}:
      +p = K.sec_lift(sec, q)
      K.axpy(p, G.dot(d, G.sub(vp, p)), d)
    case K.Rot{o, a, _, _}:
      +rr = G.normalize(K.radial(o, a, vp))
      G.add(K.axpy(o, K.p2_y(q), a), G.scale(rr, K.p2_x(q)))

# ---------------------------------------------------------------------------
# End curves (oriented p1 -> p2 over [t0, t1])

def circ_arc.if(+neg: Bool, +o: G.Vec3, +n: G.Vec3, +x: G.Vec3, +r: R.Real, +phi: R.Real) -> Arc:
  match neg:
    case True{}:
      Arc{J.CCircle{o, K.neg(n), x, r}, K.zero(), R.neg(phi)}
    case False{}:
      Arc{J.CCircle{o, n, x, r}, K.zero(), phi}

# Short arc of the circle (centre o, unit normal ±n, radius r) from p1 to p2.
def circ_arc(+o: G.Vec3, +n: G.Vec3, +r: R.Real, +p1: G.Vec3, +p2: G.Vec3) -> Arc:
  +x = G.normalize(G.sub(p1, o))
  +q = G.sub(p2, o)
  +phi = R.atan2(G.dot(G.cross(n, x), q), G.dot(x, q))
  circ_arc.if(K.is_neg(phi), o, n, x, r, phi)

def ell_t(+o: G.Vec3, +x: G.Vec3, +y: G.Vec3, +a: R.Real, +b: R.Real, +p: G.Vec3) -> R.Real:
  +q = G.sub(p, o)
  R.atan2(R.div(G.dot(y, q), b), R.div(G.dot(x, q), a))

def ell_arc.if(+neg: Bool, +o: G.Vec3, +n: G.Vec3, +x: G.Vec3, +a: R.Real, +b: R.Real, +t1: R.Real, +sw: R.Real) -> Arc:
  match neg:
    case True{}:
      Arc{J.CEllipse{o, K.neg(n), x, a, b}, R.neg(t1), R.sub(R.neg(t1), sw)}
    case False{}:
      Arc{J.CEllipse{o, n, x, a, b}, t1, R.add(t1, sw)}

# Short arc of the ellipse (centre o, unit normal ±n, major axis x of
# semi-axis a, minor semi-axis b) from p1 to p2.
def ell_arc(+o: G.Vec3, +n: G.Vec3, +x: G.Vec3, +a: R.Real, +b: R.Real, +p1: G.Vec3, +p2: G.Vec3) -> Arc:
  +y = G.cross(n, x)
  +t1 = ell_t(o, x, y, a, b, p1)
  +sw = wrap_pi(R.sub(ell_t(o, x, y, a, b, p2), t1))
  ell_arc.if(K.is_neg(sw), o, n, x, a, b, t1, sw)

def cyl_section.if(+perp: Bool, +c0: G.Vec3, +d: G.Vec3, +n: G.Vec3, +r: R.Real, +p1: G.Vec3, +p2: G.Vec3) -> Arc:
  match perp:
    case True{}:
      circ_arc(c0, n, r, p1, p2)
    case False{}:
      +m = G.normalize(G.cross(d, n))
      ell_arc(c0, n, G.cross(n, m), R.div(r, R.abs(G.dot(n, d))), r, p1, p2)

# The cylinder (spine point c0 in the plane, unit axis d, radius r) cut by
# the plane with unit normal n: a circle when n ∥ d, else an ellipse with
# minor semi-axis r along d × n and major semi-axis r/|n·d|.
def cyl_section(+c0: G.Vec3, +d: G.Vec3, +n: G.Vec3, +r: R.Real, +p1: G.Vec3, +p2: G.Vec3) -> Arc:
  cyl_section.if(K.parallel(n, d), c0, d, n, r, p1, p2)

def seg_arc(+p1: G.Vec3, +p2: G.Vec3) -> Arc:
  Arc{J.CLine{p1, G.sub(p2, p1)}, K.zero(), K.one()}

# ---------------------------------------------------------------------------
# A point on an edge next to the vertex v: 0 inside, 1 at the far end (the
# edge is consumed), 2 beyond the far end, 3 behind v, 4 off the edge's curve,
# 5 an edge curve without an exact test (ellipse).

type OnE is Data:
  OnE{st: U32, lam: R.Real, len: R.Real}

def one.st(+lam: R.Real, +len: R.Real, +tol: R.Real) -> U32:
  Bool.pick(U32, R.less(lam, R.neg(tol)), 3, Bool.pick(U32, R.less(R.add(len, tol), lam), 2, Bool.pick(U32, R.less(R.sub(len, tol), lam), 1, 0)))

def one.off(+off: Bool, +lam: R.Real, +len: R.Real, +tol: R.Real) -> OnE:
  match off:
    case True{}:
      OnE{4, lam, len}
    case False{}:
      OnE{one.st(lam, len, tol), lam, len}

# Angle from a to b about the unit normal n.
def ang_about(+n: G.Vec3, +a: G.Vec3, +b: G.Vec3) -> R.Real:
  R.atan2(G.dot(n, G.cross(a, b)), G.dot(a, b))

def one.far(+a: R.Real) -> R.Real:
  Bool.pick(R.Real, R.less(a, K.tol_dir()), R.add(a, K.two_pi()), a)

def one.curve(+c: J.Curve, +vp: G.Vec3, +fp: G.Vec3, +t: G.Vec3, +p: G.Vec3) -> OnE:
  match c:
    case J.CLine{_, _}:
      +q = G.sub(p, vp)
      +lam = G.dot(t, q)
      one.off(Bool.not(K.near_lin(K.len(G.sub(q, G.scale(t, lam))))), lam, K.dist(fp, vp), K.tol_lin())
    case J.CCircle{o, n, _, rad}:
      +nn = G.normalize(n)
      +v0 = G.sub(vp, o)
      +nt = K.signed(K.is_pos(G.dot(nn, G.cross(v0, t))), nn)
      +q = G.sub(p, o)
      +h = G.dot(nn, q)
      +off = K.len(G.sub(q, G.scale(nn, h)))
      +bad = Bool.not(K.near_lin(K.p2_len(K.p2(h, R.sub(off, rad)))))
      one.off(bad, R.mul(rad, ang_about(nt, v0, q)), R.mul(rad, one.far(ang_about(nt, v0, G.sub(fp, o)))), K.tol_lin())
    case J.CEllipse{_, _, _, _, _}:
      OnE{5, K.zero(), K.zero()}

# Where p lies on edge u (an end of u is the vertex v).
def on_edge(+b: J.Body, +u: U32, +v: U32, +p: G.Vec3) -> OnE:
  J.Body{vs, es, _} = b
  +ed = K.edge_at(es, u)
  +far = Bool.pick(U32, U32.is_eq(K.edge_s(ed), v), K.edge_e(ed), K.edge_s(ed))
  one.curve(K.edge_curve(ed), K.vtx(vs, v), K.vtx(vs, far), L.out_tangent(b, u, v), p)

# ---------------------------------------------------------------------------
# Edges and faces at a vertex

def faces_of(+fs: List<&2, J.Face>, +e: U32) -> List<&2, U32>:
  B.edge_faces(fs, e)

def has_face(+fs: List<&2, J.Face>, +e: U32, +f: U32) -> Bool:
  K.mem(faces_of(fs, e), f)

def other_face.l(+xs: List<&2, U32>, +f: U32) -> U32:
  match xs:
    case a <> b <> _:
      Bool.pick(U32, U32.is_eq(a, f), b, Bool.pick(U32, U32.is_eq(b, f), a, none_u32()))
    case _:
      none_u32()

def other_face(+fs: List<&2, J.Face>, +e: U32, +f: U32) -> U32:
  other_face.l(faces_of(fs, e), f)

# Real (non-smooth) edges at v other than k.
def real_at.go(+xs: List<&2, U32>, +b: J.Body, +k: U32, +acc: List<&2, U32>) -> List<&2, U32>:
  match xs:
    case Nil{}:
      List.reverse(&2, U32, acc)
    case x <> t:
      +xx = x
      +keep = Bool.and(U32.is_ne(xx, k), Bool.not(L.cls_is_smooth(L.classify(b, xx))))
      real_at.go(t, b, k, K.push_if(keep, xx, acc))

def real_at(+b: J.Body, +v: U32, +k: U32) -> List<&2, U32>:
  real_at.go(K.vertex_edges(K.body_es(b), v), b, k, Nil{})

# First edge of xs that bounds face f.
def edge_on_face.go(+xs: List<&2, U32>, +fs: List<&2, J.Face>, +f: U32, +acc: U32) -> U32:
  match xs:
    case Nil{}:
      acc
    case x <> t:
      edge_on_face.go(t, fs, f, Bool.pick(U32, Bool.and(U32.is_eq(acc, none_u32()), has_face(fs, x, f)), x, acc))

def edge_on_face(+xs: List<&2, U32>, +fs: List<&2, J.Face>, +f: U32) -> U32:
  edge_on_face.go(xs, fs, f, none_u32())

def face_plane.s(+s: J.Surf, +same: Bool) -> Pl:
  match s:
    case J.SPlane{o, n, _}:
      Pl{o, G.normalize(K.signed(same, n))}
    case _:
      Pl{K.zero_v(), G.v3(0.0, 0.0, 1.0)}

# Plane of a plane face, outward normal.
def face_plane.f(+face: J.Face) -> Pl:
  J.Face{same, s, _} = face
  face_plane.s(s, same)

def face_plane(+fs: List<&2, J.Face>, +f: U32) -> Pl:
  face_plane.f(K.face_at(fs, f))

def is_plane(+fs: List<&2, J.Face>, +f: U32) -> Bool:
  U32.is_eq(K.surf_kind(K.face_surf(K.face_at(fs, f))), 0)

# The same face, or two coplanar plane faces with one outward side (the
# fragments a planar union leaves behind, split by smooth edges).
def same_pf.pl(+a: Pl, +b: Pl) -> Bool:
  Pl{oa, na} = a
  Pl{ob, nb} = b
  Bool.and(K.near_dir(K.len(G.sub(na, nb))), K.near_lin(G.dot(na, G.sub(ob, oa))))

def same_pf(+fs: List<&2, J.Face>, +f: U32, +g: U32) -> Bool:
  +planes = Bool.and(is_plane(fs, f), is_plane(fs, g))
  Bool.or(U32.is_eq(f, g), Bool.and(planes, same_pf.pl(face_plane(fs, f), face_plane(fs, g))))

def pl_o(+p: Pl) -> G.Vec3:
  Pl{o, _} = p
  o

def pl_n(+p: Pl) -> G.Vec3:
  Pl{_, n} = p
  n

# ---------------------------------------------------------------------------
# Tip helpers

def on_word(+st: U32) -> String:
  match st:
    case 2:
      "overflow"
    case _:
      "vertex-blend"

def on_why(+st: U32, +k: U32, +i: U32, +u: U32, +v: U32, +o: OnE) -> String:
  match st:
    case 2:
      OnE{_, +lam, +len} = o
      "the spring " ++ K.show_u32(i) ++ " of " ++ etxt(k) ++ " ends " ++ K.show_sci(lam) ++ " along edge " ++ K.show_u32(u) ++ vtxt(v) ++ ", which is only " ++ K.show_sci(len) ++ " long (short by " ++ K.show_gap(R.sub(lam, len)) ++ ")"
    case 3:
      "the spring " ++ K.show_u32(i) ++ " of " ++ etxt(k) ++ " meets edge " ++ K.show_u32(u) ++ " behind vertex " ++ K.show_u32(v) ++ " (reflex face corner; setback patch needed)"
    case 4:
      "the spring " ++ K.show_u32(i) ++ " of " ++ etxt(k) ++ " does not end on edge " ++ K.show_u32(u) ++ vtxt(v) ++ " (setback patch needed)"
    case _:
      "edge " ++ K.show_u32(u) ++ " is an ellipse (no exact end test yet)"

def on_ok(+o: OnE) -> Bool:
  OnE{st, _, _} = o
  U32.is_lt(st, 2)

def on_st(+o: OnE) -> U32:
  OnE{st, _, _} = o
  st

def tip_on.two(+ok2: Bool, +t: Tip, +o2: OnE, +k: U32, +u2: U32, +v: U32) -> Tip:
  match ok2:
    case True{}:
      t
    case False{}:
      +st = on_st(o2)
      TipNo{k, v, Bool.pick(String, U32.is_eq(st, 5), "not-implemented", on_word(st)), on_why(st, k, 2, u2, v, o2)}

# The tip t, unless one of its spring ends is not on its edge.
def tip_on(+ok1: Bool, +t: Tip, +o1: OnE, +o2: OnE, +k: U32, +u1: U32, +u2: U32, +v: U32) -> Tip:
  match ok1:
    case True{}:
      tip_on.two(on_ok(o2), t, o2, k, u2, v)
    case False{}:
      +st = on_st(o1)
      TipNo{k, v, Bool.pick(String, U32.is_eq(st, 5), "not-implemented", on_word(st)), on_why(st, k, 1, u1, v, o1)}

# ---------------------------------------------------------------------------
# Caps

def cap_arc(+ch: Bool, +c0: G.Vec3, +d: G.Vec3, +n: G.Vec3, +r: R.Real, +p1: G.Vec3, +p2: G.Vec3) -> Arc:
  match ch:
    case True{}:
      seg_arc(p1, p2)
    case False{}:
      cyl_section(c0, d, n, r, p1, p2)

def rot_arc(+ch: Bool, +c0: G.Vec3, +n: G.Vec3, +r: R.Real, +p1: G.Vec3, +p2: G.Vec3) -> Arc:
  match ch:
    case True{}:
      seg_arc(p1, p2)
    case False{}:
      circ_arc(c0, n, r, p1, p2)

# Notched stripe sides (stage 3, notch.bend): kind 1 face notch, 2 meet.
type Nk is Data:
  Nk{k: U32, i: U32, kind: U32}

def nk_of(+xs: List<&2, Nk>, +k: U32, +i: U32) -> U32:
  match xs:
    case Nil{}:
      0
    case Nk{a, c, kind} <> t:
      Bool.pick(U32, Bool.and(U32.is_eq(a, k), U32.is_eq(c, i)), kind, nk_of(t, k, i))

def far_v(+b: J.Body, +u: U32, +v: U32) -> U32:
  +ed = K.edge_at(K.body_es(b), u)
  Bool.pick(U32, U32.is_eq(K.edge_s(ed), v), K.edge_e(ed), K.edge_s(ed))

# The cap face's edge at w that continues past the consumed support's cap
# edge u (a face notch ends there); none unless w has valence 3.
def notch_next(+b: J.Body, +u: U32, +w: U32, +f3: U32) -> U32:
  +xs = real_at(b, w, u)
  Bool.pick(U32, U32.is_eq(K.count(U32, xs), 2), edge_on_face(xs, K.body_fs(b), f3), none_u32())

def notch_st.if(+ok: Bool, +o: OnE) -> OnE:
  OnE{st, lam, len} = o
  Bool.pick(OnE, ok, OnE{0, lam, len}, OnE{Bool.pick(U32, U32.is_eq(st, 0), 4, st), lam, len})

# A notch point on the next edge: inside it for a convex blend (the
# neighbour is trimmed back), on its extension behind w for a concave one
# (the neighbour grows).
def notch_on.o(+o: OnE, +convex: Bool) -> OnE:
  notch_st.if(Bool.pick(Bool, convex, U32.is_eq(on_st(o), 0), U32.is_eq(on_st(o), 3)), o)

def notch_on.n(+none: Bool, +e: U32, +convex: Bool, +b: J.Body, +w: U32, +p: G.Vec3) -> OnE:
  match none:
    case True{}:
      OnE{4, K.zero(), K.zero()}
    case False{}:
      notch_on.o(on_edge(b, e, w, p), convex)

def notch_on.e(+e: U32, +convex: Bool, +b: J.Body, +w: U32, +p: G.Vec3) -> OnE:
  notch_on.n(U32.is_eq(e, none_u32()), e, convex, b, w, p)

def att_on(+n: U32, +convex: Bool, +b: J.Body, +u: U32, +v: U32, +f3: U32, +p: G.Vec3) -> OnE:
  match n:
    case 0:
      on_edge(b, u, v, p)
    case 1:
      +w = far_v(b, u, v)
      notch_on.e(notch_next(b, u, w, f3), convex, b, w, p)
    case _:
      OnE{0, K.zero(), K.zero()}

def att_at(+n: U32, +b: J.Body, +u: U32, +v: U32, +f3: U32) -> At:
  match n:
    case 0:
      AtEdge{u}
    case 1:
      AtEdge{notch_next(b, u, far_v(b, u, v), f3)}
    case _:
      AtFace{f3}

def cap.tra(+ok: Bool, +b: J.Body, +x: Sx, +ch: Bool, +r: R.Real, +v: U32, +f3: U32, +u1: U32, +u2: U32, +pl: Pl, +n1: U32, +n2: U32) -> Tip:
  match ok:
    case False{}:
      TipNo{sx_k(x), v, "invalid-input", "cap plane parallel to the edge" ++ vtxt(v)}
    case True{}:
      Sx{k, _, _, convex, sec, q1, q2, c2, _} = x
      Pl{o3, n3} = pl
      +d = sec_d(sec)
      +p1 = line_plane(K.sec_lift(sec, q1), d, o3, n3)
      +p2 = line_plane(K.sec_lift(sec, q2), d, o3, n3)
      +arc = cap_arc(ch, line_plane(K.sec_lift(sec, c2), d, o3, n3), d, n3, r, p1, p2)
      +o1 = att_on(n1, convex, b, u1, v, f3, p1)
      +o2 = att_on(n2, convex, b, u2, v, f3, p2)
      tip_on(on_ok(o1), Tip{k, v, 0, f3, pl, p1, att_at(n1, b, u1, v, f3), p2, att_at(n2, b, u2, v, f3), arc, TrNo{}}, o1, o2, k, u1, u2, v)

def cap.rot(+ok: Bool, +b: J.Body, +x: Sx, +ch: Bool, +r: R.Real, +v: U32, +f3: U32, +u1: U32, +u2: U32, +pl: Pl) -> Tip:
  match ok:
    case False{}:
      TipNo{sx_k(x), v, "not-implemented", "cap of a rotation blend by a plane that does not contain the axis" ++ vtxt(v) ++ " (a quartic)"}
    case True{}:
      Sx{k, _, _, _, sec, q1, q2, c2, _} = x
      +vp = K.vtx(K.body_vs(b), v)
      +p1 = sp_at(sec, q1, vp)
      +p2 = sp_at(sec, q2, vp)
      +arc = rot_arc(ch, sp_at(sec, c2, vp), pl_n(pl), r, p1, p2)
      +o1 = on_edge(b, u1, v, p1)
      +o2 = on_edge(b, u2, v, p2)
      tip_on(on_ok(o1), Tip{k, v, 0, f3, pl, p1, AtEdge{u1}, p2, AtEdge{u2}, arc, TrNo{}}, o1, o2, k, u1, u2, v)

def cap.fam(+b: J.Body, +x: Sx, +ch: Bool, +r: R.Real, +v: U32, +f3: U32, +u1: U32, +u2: U32, +pl: Pl, +n1: U32, +n2: U32) -> Tip:
  match x:
    case Sx{_, _, _, _, sec, _, _, _, _}:
      match sec:
        case K.Tra{_, d, _, _, _}:
          cap.tra(Bool.not(K.near_dir(G.dot(pl_n(pl), d))), b, x, ch, r, v, f3, u1, u2, pl, n1, n2)
        case K.Rot{o, a, _, _}:
          +inplane = Bool.and(K.near_dir(G.dot(pl_n(pl), a)), K.near_lin(G.dot(pl_n(pl), G.sub(o, pl_o(pl)))))
          cap.rot(inplane, b, x, ch, r, v, f3, u1, u2, pl)

def cap.plane(+plane: Bool, +b: J.Body, +x: Sx, +ch: Bool, +r: R.Real, +v: U32, +f3: U32, +u1: U32, +u2: U32, +n1: U32, +n2: U32) -> Tip:
  match plane:
    case False{}:
      TipNo{sx_k(x), v, "not-implemented", "the cap face " ++ K.show_u32(f3) ++ vtxt(v) ++ " is a " ++ K.surf_name(K.surf_kind(K.face_surf(K.face_at(K.body_fs(b), f3)))) ++ ": the blend meets it in a space curve (outside v1)"}
    case True{}:
      cap.fam(b, x, ch, r, v, f3, u1, u2, face_plane(K.body_fs(b), f3), n1, n2)

def cap.faces(+ok: Bool, +b: J.Body, +x: Sx, +ch: Bool, +r: R.Real, +v: U32, +f3: U32, +u1: U32, +u2: U32, +n1: U32, +n2: U32) -> Tip:
  match ok:
    case False{}:
      TipNo{sx_k(x), v, "vertex-blend", "the cap" ++ vtxt(v) ++ " is not one face next to both supports"}
    case True{}:
      cap.plane(is_plane(K.body_fs(b), f3), b, x, ch, r, v, f3, u1, u2, n1, n2)

# A cap: the stripe ends on the face F3 at v that is neither support.
def tip_cap(+b: J.Body, +x: Sx, +ch: Bool, +r: R.Real, +v: U32, +nks: List<&2, Nk>) -> Tip:
  match x:
    case Sx{k, f1, f2, _, _, _, _, _, _}:
      +fs = K.body_fs(b)
      +xs = real_at(b, v, k)
      +u1 = edge_on_face(xs, fs, f1)
      +u2 = edge_on_face(xs, fs, f2)
      +f3 = other_face(fs, u1, f1)
      +ok = Bool.and(Bool.and(U32.is_ne(u1, none_u32()), U32.is_ne(u2, none_u32())), Bool.and(U32.is_ne(u1, u2), same_pf(fs, other_face(fs, u2, f2), f3)))
      cap.faces(ok, b, x, ch, r, v, f3, u1, u2, nk_of(nks, k, 1), nk_of(nks, k, 2))

# ---------------------------------------------------------------------------
# Mitres: two blends of one convexity meet at a vertex of valence 3.

def sx_side(+x: Sx, +f: U32) -> U32:
  Sx{_, f1, _, _, _, _, _, _, _} = x
  Bool.pick(U32, U32.is_eq(f1, f), 1, 2)

def sx_q(+x: Sx, +i: U32) -> K.P2:
  Sx{_, _, _, _, _, q1, q2, _, _} = x
  Bool.pick(K.P2, U32.is_eq(i, 1), q1, q2)

def sx_sec(+x: Sx) -> K.Sec:
  Sx{_, _, _, _, sec, _, _, _, _} = x
  sec

def sx_is_tra(+x: Sx) -> Bool:
  Sx{_, _, _, _, sec, _, _, _, _} = x
  match sec:
    case K.Tra{_, _, _, _, _}:
      True{}
    case K.Rot{_, _, _, _}:
      False{}

# Point and direction of the spring of x on face f (translation stripe).
def spring_pt(+x: Sx, +f: U32) -> G.Vec3:
  K.sec_lift(sx_sec(x), sx_q(x, sx_side(x, f)))

def spine_pt(+x: Sx) -> G.Vec3:
  Sx{_, _, _, _, sec, _, _, c2, _} = x
  K.sec_lift(sec, c2)

def surf_pn(+s: J.Surf) -> G.Vec3:
  match s:
    case J.SPlane{_, n, _}:
      G.normalize(n)
    case _:
      G.v3(0.0, 0.0, 1.0)

# The face of x that y shares (the same face or a coplanar fragment; none
# when they share none).
def shared_face(+fs: List<&2, J.Face>, +x: Sx, +y: Sx) -> U32:
  Sx{_, f1, f2, _, _, _, _, _, _} = x
  Sx{_, g1, g2, _, _, _, _, _, _} = y
  +a = Bool.or(same_pf(fs, f1, g1), same_pf(fs, f1, g2))
  +c = Bool.or(same_pf(fs, f2, g1), same_pf(fs, f2, g2))
  Bool.pick(U32, a, f1, Bool.pick(U32, c, f2, none_u32()))

def other_of(+x: Sx, +f: U32) -> U32:
  Sx{_, f1, f2, _, _, _, _, _, _} = x
  Bool.pick(U32, U32.is_eq(f1, f), f2, f1)

def drop_u32(+xs: List<&2, U32>, +y: U32, +acc: List<&2, U32>) -> List<&2, U32>:
  match xs:
    case Nil{}:
      List.reverse(&2, U32, acc)
    case x <> t:
      +xx = x
      drop_u32(t, y, K.push_if(U32.is_ne(xx, y), xx, acc))

def head_or_none(+xs: List<&2, U32>) -> U32:
  match xs:
    case Nil{}:
      none_u32()
    case h <> _:
      h

# The mitre cut plane: fillets, through the meeting point of both spines
# with normal d_k − d_j (the bisector of two equal-radius cylinders);
# chamfers, through the meeting point of the springs on the shared face,
# containing the line where both chamfer planes meet.
def mitre_plane(+ch: Bool, +x: Sx, +y: Sx, +m: G.Vec3, +psh: G.Vec3) -> Pl:
  match ch:
    case False{}:
      Pl{meet2(spine_pt(x), sec_d(sx_sec(x)), spine_pt(y), sec_d(sx_sec(y))), m}
    case True{}:
      Sx{_, _, _, _, _, _, _, _, sk} = x
      Sx{_, _, _, _, _, _, _, _, sj} = y
      +g = G.normalize(G.cross(surf_pn(sk), surf_pn(sj)))
      Pl{psh, G.normalize(G.sub(m, G.scale(g, G.dot(m, g))))}

def setback_no(+x: Sx, +j: U32, +v: U32, +u: U32, +gap: R.Real, +why: String) -> Tip:
  TipNo{sx_k(x), v, "vertex-blend", "mitre of edges " ++ K.show_u32(sx_k(x)) ++ " and " ++ K.show_u32(j) ++ vtxt(v) ++ " needs a setback patch: the outer springs end " ++ K.show_gap(gap) ++ " apart on edge " ++ K.show_u32(u) ++ why}

# Setback mitres (fillets, trimmed mitre: the third edge u has the blends'
# convexity). Both spines lie r from the shared face S, so a point of the
# mitre curve has the same arc angle from S on both carriers: the mitre ends
# where the blend with the smaller sweep (the short one) reaches its outer
# spring, at P (inside its outer face F). Beyond P the long blend meets F
# itself: its end continues over its carrier ∩ F's plane (a cap-type circle
# or ellipse) to Q, where its outer spring meets F on the third edge. This is
# the intersection of both blends' material sides, as for the plain mitre
# (then P = Q = X on the third edge); F gains the trim edge P-Q.
def sweep(+x: Sx, +s: U32) -> R.Real:
  +c = spine_pt(x)
  +a = G.sub(spring_pt(x, s), c)
  +o = G.sub(spring_pt(x, other_of(x, s)), c)
  R.atan2(K.len(G.cross(a, o)), G.dot(a, o))

# Is p strictly inside the face that lies beyond the plane of face f (on the
# material side of f's plane for a convex vertex, outside it for a concave
# one)? Signed distance beyond the linear band.
def beyond(+fs: List<&2, J.Face>, +f: U32, +convex: Bool, +p: G.Vec3) -> Bool:
  +pl = face_plane(fs, f)
  +sd = G.dot(pl_n(pl), G.sub(p, pl_o(pl)))
  Bool.pick(Bool, convex, R.less(sd, R.neg(K.tol_lin())), R.less(K.tol_lin(), sd))

# The short blend x: the mitre curve from the shared-face point to P = its
# outer spring in the mitre plane, P inside its outer face.
def setback.short(+ok: Bool, +b: J.Body, +x: Sx, +j: U32, +r: R.Real, +v: U32, +s: U32, +u: U32, +pl: Pl, +psh: G.Vec3, +pp: G.Vec3, +gap: R.Real) -> Tip:
  match ok:
    case False{}:
      setback_no(x, j, v, u, gap, " (the shorter blend leaves the mitre outside its outer face)")
    case True{}:
      +iS = sx_side(x, s)
      +fo = other_of(x, s)
      +d = sec_d(sx_sec(x))
      +p1 = Bool.pick(G.Vec3, U32.is_eq(iS, 1), psh, pp)
      +p2 = Bool.pick(G.Vec3, U32.is_eq(iS, 1), pp, psh)
      +a1 = Bool.pick(At, U32.is_eq(iS, 1), AtFace{s}, AtFace{fo})
      +a2 = Bool.pick(At, U32.is_eq(iS, 1), AtFace{fo}, AtFace{s})
      Tip{sx_k(x), v, 1, j, pl, p1, a1, p2, a2, cap_arc(False{}, pl_o(pl), d, pl_n(pl), r, p1, p2), TrNo{}}

# The long blend x: the mitre curve from the shared-face point to P (the
# partner's outer spring in the mitre plane), then the trim curve on the
# partner's outer face fy from P to Q on the third edge u.
def setback.long(+ok: Bool, +b: J.Body, +x: Sx, +j: U32, +r: R.Real, +v: U32, +s: U32, +fy: U32, +u: U32, +pl: Pl, +psh: G.Vec3, +pp: G.Vec3, +gap: R.Real) -> Tip:
  match ok:
    case False{}:
      setback_no(x, j, v, u, gap, " (the shorter blend leaves the mitre outside its outer face)")
    case True{}:
      +iS = sx_side(x, s)
      +d = sec_d(sx_sec(x))
      +pf = face_plane(K.body_fs(b), fy)
      +o3 = pl_o(pf)
      +n3 = pl_n(pf)
      +q = line_plane(spring_pt(x, other_of(x, s)), d, o3, n3)
      +c3 = line_plane(spine_pt(x), d, o3, n3)
      +one = U32.is_eq(iS, 1)
      +p1 = Bool.pick(G.Vec3, one, psh, q)
      +p2 = Bool.pick(G.Vec3, one, q, psh)
      +a1 = Bool.pick(At, one, AtFace{s}, AtEdge{u})
      +a2 = Bool.pick(At, one, AtEdge{u}, AtFace{s})
      +marc = Bool.pick(Arc, one, cap_arc(False{}, pl_o(pl), d, pl_n(pl), r, psh, pp), cap_arc(False{}, pl_o(pl), d, pl_n(pl), r, pp, psh))
      +tarc = Bool.pick(Arc, one, cap_arc(False{}, c3, d, n3, r, pp, q), cap_arc(False{}, c3, d, n3, r, q, pp))
      +o = on_edge(b, u, v, q)
      tip_on(on_ok(o), Tip{sx_k(x), v, 1, j, pl, p1, a1, p2, a2, marc, Tr{fy, Bool.pick(U32, one, 2, 1), pp, pf, tarc}}, o, o, sx_k(x), u, u, v)

def setback.side(+lt: Bool, +b: J.Body, +x: Sx, +y: Sx, +r: R.Real, +v: U32, +s: U32, +sj: U32, +u: U32, +pl: Pl, +psh: G.Vec3, +xk: G.Vec3, +xj: G.Vec3, +gap: R.Real) -> Tip:
  match lt:
    case True{}:
      setback.short(beyond(K.body_fs(b), other_of(y, sj), sx_convex(x), xk), b, x, sx_k(y), r, v, s, u, pl, psh, xk, gap)
    case False{}:
      setback.long(beyond(K.body_fs(b), other_of(x, s), sx_convex(x), xj), b, x, sx_k(y), r, v, s, other_of(y, sj), u, pl, psh, xj, gap)

def setback.eq(+eq: Bool, +lt: Bool, +b: J.Body, +x: Sx, +y: Sx, +r: R.Real, +v: U32, +s: U32, +sj: U32, +u: U32, +pl: Pl, +psh: G.Vec3, +xk: G.Vec3, +xj: G.Vec3, +gap: R.Real) -> Tip:
  match eq:
    case True{}:
      setback_no(x, sx_k(y), v, u, gap, " (equal sweeps)")
    case False{}:
      setback.side(lt, b, x, y, r, v, s, sj, u, pl, psh, xk, xj, gap)

def setback.go(+b: J.Body, +x: Sx, +y: Sx, +r: R.Real, +v: U32, +s: U32, +sj: U32, +u: U32, +pl: Pl, +psh: G.Vec3, +xk: G.Vec3, +xj: G.Vec3, +gap: R.Real) -> Tip:
  +ax = sweep(x, s)
  +ay = sweep(y, sj)
  setback.eq(K.near_dir(R.sub(ax, ay)), R.less(ax, ay), b, x, y, r, v, s, sj, u, pl, psh, xk, xj, gap)

# A mitre whose outer springs do not meet: a setback mitre for fillets with a
# trimmed mitre; chamfers (Onshape's setback chamfer mitre is not probed) and
# extended mitres (the trim would lie behind the vertex) stay refused.
def setback(+ok: Bool, +b: J.Body, +x: Sx, +y: Sx, +r: R.Real, +v: U32, +s: U32, +sj: U32, +u: U32, +pl: Pl, +psh: G.Vec3, +xk: G.Vec3, +xj: G.Vec3, +gap: R.Real) -> Tip:
  match ok:
    case False{}:
      setback_no(x, sx_k(y), v, u, gap, "")
    case True{}:
      setback.go(b, x, y, r, v, s, sj, u, pl, psh, xk, xj, gap)

def mitre.close(+closes: Bool, +b: J.Body, +x: Sx, +y: Sx, +ch: Bool, +ext: Bool, +r: R.Real, +v: U32, +s: U32, +sj: U32, +u: U32, +pl: Pl, +psh: G.Vec3, +xk: G.Vec3, +xj: G.Vec3, +gap: R.Real) -> Tip:
  match closes:
    case False{}:
      setback(Bool.not(Bool.or(ch, ext)), b, x, y, r, v, s, sj, u, pl, psh, xk, xj, gap)
    case True{}:
      +j = sx_k(y)
      +iS = sx_side(x, s)
      +d = sec_d(sx_sec(x))
      +p1 = Bool.pick(G.Vec3, U32.is_eq(iS, 1), psh, xk)
      +p2 = Bool.pick(G.Vec3, U32.is_eq(iS, 1), xk, psh)
      +a1 = Bool.pick(At, U32.is_eq(iS, 1), AtFace{s}, AtEdge{u})
      +a2 = Bool.pick(At, U32.is_eq(iS, 1), AtEdge{u}, AtFace{s})
      +arc = cap_arc(ch, pl_o(pl), d, pl_n(pl), r, p1, p2)
      +o = on_edge(b, u, v, xk)
      tip_on(on_ok(o), Tip{sx_k(x), v, 1, j, pl, p1, a1, p2, a2, arc, TrNo{}}, o, o, sx_k(x), u, u, v)

def mitre.go(+b: J.Body, +x: Sx, +y: Sx, +ch: Bool, +ext: Bool, +r: R.Real, +v: U32, +s: U32, +sj: U32) -> Tip:
  +k = sx_k(x)
  +j = sx_k(y)
  +dk = L.out_tangent(b, k, v)
  +dj = L.out_tangent(b, j, v)
  +ak = sec_d(sx_sec(x))
  +aj = sec_d(sx_sec(y))
  +psh = meet2(spring_pt(x, s), ak, spring_pt(y, sj), aj)
  +pl = mitre_plane(ch, x, y, G.normalize(G.sub(dk, dj)), psh)
  +xk = line_plane(spring_pt(x, other_of(x, s)), ak, pl_o(pl), pl_n(pl))
  +xj = line_plane(spring_pt(y, other_of(y, sj)), aj, pl_o(pl), pl_n(pl))
  +u = head_or_none(drop_u32(real_at(b, v, k), j, Nil{}))
  +gap = K.dist(xk, xj)
  mitre.close(K.near_lin(gap), b, x, y, ch, ext, r, v, s, sj, u, pl, psh, xk, xj, gap)

def mitre.plane(+ok: Bool, +b: J.Body, +x: Sx, +y: Sx, +ch: Bool, +ext: Bool, +r: R.Real, +v: U32, +s: U32, +sj: U32) -> Tip:
  match ok:
    case False{}:
      TipNo{sx_k(x), v, "not-implemented", "mitre of edges " ++ K.show_u32(sx_k(x)) ++ " and " ++ K.show_u32(sx_k(y)) ++ vtxt(v) ++ " on a curved shared face or a rotation blend (the mitre curve is not a planar conic)"}
    case True{}:
      mitre.go(b, x, y, ch, ext, r, v, s, sj)

def tip_mitre(+b: J.Body, +x: Sx, +my: Maybe<&2, Sx>, +ch: Bool, +ext: Bool, +r: R.Real, +v: U32) -> Tip:
  match my:
    case None{}:
      TipNo{sx_k(x), v, "invalid-input", "mitre partner has no stripe"}
    case Some{y}:
      +s = shared_face(K.body_fs(b), x, y)
      +sj = shared_face(K.body_fs(b), y, x)
      +ok = Bool.and(Bool.and(U32.is_ne(s, none_u32()), Bool.and(sx_is_tra(x), sx_is_tra(y))), Bool.and(U32.is_ne(s, none_u32()), is_plane(K.body_fs(b), s)))
      mitre.plane(ok, b, x, y, ch, ext, r, v, s, sj)

# ---------------------------------------------------------------------------
# Chains: a G1 continuation; both stripes end in the section plane at v.

def chain.ok(+ok: Bool, +x: Sx, +j: U32, +ch: Bool, +r: R.Real, +v: U32, +vp: G.Vec3, +t: G.Vec3, +p1: G.Vec3, +p2: G.Vec3, +gap: R.Real) -> Tip:
  match ok:
    case False{}:
      TipNo{sx_k(x), v, "vertex-blend", "the sections of the G1 chain of edges " ++ K.show_u32(sx_k(x)) ++ " and " ++ K.show_u32(j) ++ vtxt(v) ++ " differ by " ++ K.show_gap(gap)}
    case True{}:
      Sx{k, f1, f2, _, sec, _, _, c2, _} = x
      Tip{k, v, 2, j, Pl{vp, t}, p1, AtFace{f1}, p2, AtFace{f2}, rot_arc(ch, sp_at(sec, c2, vp), t, r, p1, p2), TrNo{}}

def chain.go(+b: J.Body, +x: Sx, +y: Sx, +ch: Bool, +r: R.Real, +v: U32) -> Tip:
  Sx{k, f1, f2, _, sec, q1, q2, _, _} = x
  Sx{j, g1, g2, _, secj, r1, r2, _, _} = y
  +vp = K.vtx(K.body_vs(b), v)
  +p1 = sp_at(sec, q1, vp)
  +p2 = sp_at(sec, q2, vp)
  +y1 = sp_at(secj, r1, vp)
  +y2 = sp_at(secj, r2, vp)
  +straight = Bool.or(U32.is_eq(f1, g1), U32.is_eq(f2, g2))
  +swap = Bool.and(Bool.not(straight), Bool.or(U32.is_eq(f1, g2), U32.is_eq(f2, g1)))
  +gap = R.max(K.dist(p1, Bool.pick(G.Vec3, swap, y2, y1)), K.dist(p2, Bool.pick(G.Vec3, swap, y1, y2)))
  chain.ok(K.near_lin(gap), x, j, ch, r, v, vp, G.normalize(L.out_tangent(b, k, v)), p1, p2, gap)

def tip_chain(+b: J.Body, +x: Sx, +my: Maybe<&2, Sx>, +ch: Bool, +r: R.Real, +v: U32) -> Tip:
  match my:
    case None{}:
      TipNo{sx_k(x), v, "invalid-input", "chain partner has no stripe"}
    case Some{y}:
      chain.go(b, x, y, ch, r, v)

# ---------------------------------------------------------------------------
# Corners: three selected edges of one convexity at a vertex of valence 3,
# three plane faces.

def big(+a: R.Real) -> X.Big:
  X.from_real(a)

# det(a, b, c) = a · (b × c), exact on the F32x2 words (robust-predicates).
def det3(+a: G.Vec3, +b: G.Vec3, +c: G.Vec3) -> X.Big:
  G.V3{ax, ay, az} = a
  G.V3{+bx, +by, +bz} = b
  G.V3{+cx, +cy, +cz} = c
  +m1 = X.sub(X.mul(big(by), big(cz)), X.mul(big(bz), big(cy)))
  +m2 = X.sub(X.mul(big(bx), big(cz)), X.mul(big(bz), big(cx)))
  +m3 = X.sub(X.mul(big(bx), big(cy)), X.mul(big(by), big(cx)))
  X.add(X.sub(X.mul(big(ax), m1), X.mul(big(ay), m2)), X.mul(big(az), m3))

def sign_zero(+s: X.Sign) -> Bool:
  match s:
    case X.ExactlyZero{}:
      True{}
    case _:
      False{}

def surf_raw_n(+s: J.Surf) -> G.Vec3:
  match s:
    case J.SPlane{_, n, _}:
      n
    case _:
      K.zero_v()

# The face's plane normal as stored in the job (exact words).
def raw_n(+fs: List<&2, J.Face>, +f: U32) -> G.Vec3:
  surf_raw_n(K.face_surf(K.face_at(fs, f)))

def pick_pt(+fs: List<&2, U32>, +ts: List<&2, G.Vec3>, +f: U32) -> G.Vec3:
  match fs:
    case Nil{}:
      K.zero_v()
    case h <> t:
      match ts:
        case Nil{}:
          K.zero_v()
        case p <> pt:
          Bool.pick(G.Vec3, U32.is_eq(h, f), p, pick_pt(t, pt, f))

# The ball touching three planes: C from the 3×3 solve, feet T = C ∓ r·n.
def cor.sph.rank(+zero: Bool, +fs: List<&2, J.Face>, +faces: List<&2, U32>, +v: U32, +vp: G.Vec3, +r: R.Real, +convex: Bool) -> Cor:
  match zero:
    case True{}:
      CorNo{v, "vertex-blend", "the three faces" ++ vtxt(v) ++ " have linearly dependent normals (exact rank test: rank < 3); no unique corner ball"}
    case False{}:
      +fa = B.nth_u32(faces, 0n)
      +fb = B.nth_u32(faces, 1n)
      +fc = B.nth_u32(faces, 2n)
      +na = G.normalize(B.fnormal(fs, fa, vp))
      +nb = G.normalize(B.fnormal(fs, fb, vp))
      +nc = G.normalize(B.fnormal(fs, fc, vp))
      +c = B.sphere_centre(na, nb, nc, vp, r, convex)
      +s = K.pick_r(convex, r, R.neg(r))
      CorSph{v, c, r, faces, [K.axpy(c, s, na), K.axpy(c, s, nb), K.axpy(c, s, nc)]}

def cor.sph(+b: J.Body, +faces: List<&2, U32>, +v: U32, +r: R.Real, +convex: Bool) -> Cor:
  +fs = K.body_fs(b)
  +d = det3(raw_n(fs, B.nth_u32(faces, 0n)), raw_n(fs, B.nth_u32(faces, 1n)), raw_n(fs, B.nth_u32(faces, 2n)))
  cor.sph.rank(sign_zero(X.sign(d)), fs, faces, v, K.vtx(K.body_vs(b), v), r, convex)

# The two selected edges of es3 on face f.
def on_face(+es3: List<&2, U32>, +fs: List<&2, J.Face>, +f: U32, +acc: List<&2, U32>) -> List<&2, U32>:
  match es3:
    case Nil{}:
      List.reverse(&2, U32, acc)
    case e <> t:
      +ee = e
      on_face(t, fs, f, K.push_if(has_face(fs, ee, f), ee, acc))

def q_meet.y(+x: Sx, +my: Maybe<&2, Sx>, +f: U32) -> Maybe<&2, G.Vec3>:
  match my:
    case None{}:
      None{}
    case Some{y}:
      Some{meet2(spring_pt(x, f), sec_d(sx_sec(x)), spring_pt(y, f), sec_d(sx_sec(y)))}

def q_meet(+mx: Maybe<&2, Sx>, +my: Maybe<&2, Sx>, +f: U32) -> Maybe<&2, G.Vec3>:
  match mx:
    case None{}:
      None{}
    case Some{x}:
      q_meet.y(x, my, f)

# Where the springs of the two chamfers on face f meet.
def q_of(+ss: List<&2, L.Stripe>, +es3: List<&2, U32>, +fs: List<&2, J.Face>, +f: U32) -> Maybe<&2, G.Vec3>:
  +two = on_face(es3, fs, f, Nil{})
  q_meet(find_sx(ss, B.nth_u32(two, 0n)), find_sx(ss, B.nth_u32(two, 1n)), f)

def some_or_zero(+m: Maybe<&2, G.Vec3>) -> G.Vec3:
  match m:
    case None{}:
      K.zero_v()
    case Some{p}:
      p

def is_some(+m: Maybe<&2, G.Vec3>) -> Bool:
  match m:
    case None{}:
      False{}
    case Some{_}:
      True{}

def cor.tri.ok(+ok: Bool, +faces: List<&2, U32>, +v: U32, +vp: G.Vec3, +convex: Bool, +qa: G.Vec3, +qb: G.Vec3, +qc: G.Vec3) -> Cor:
  match ok:
    case False{}:
      CorNo{v, "vertex-blend", "the chamfer corner" ++ vtxt(v) ++ " degenerates (its springs do not meet in a triangle)"}
    case True{}:
      +n = G.normalize(G.cross(G.sub(qb, qa), G.sub(qc, qa)))
      +towards = K.is_pos(G.dot(n, G.sub(vp, qa)))
      CorTri{v, Pl{qa, K.signed(Bool.not(Bool.xor(towards, convex)), n)}, faces, [qa, qb, qc]}

# Onshape's chamfer corner (probe FP-b): the triangle through the points
# where the springs on each face meet.
def cor.tri(+b: J.Body, +ss: List<&2, L.Stripe>, +es3: List<&2, U32>, +faces: List<&2, U32>, +v: U32, +convex: Bool) -> Cor:
  +fs = K.body_fs(b)
  +ma = q_of(ss, es3, fs, B.nth_u32(faces, 0n))
  +mb = q_of(ss, es3, fs, B.nth_u32(faces, 1n))
  +mc = q_of(ss, es3, fs, B.nth_u32(faces, 2n))
  +qa = some_or_zero(ma)
  +qb = some_or_zero(mb)
  +qc = some_or_zero(mc)
  +area = K.len(G.cross(G.sub(qb, qa), G.sub(qc, qa)))
  +ok = Bool.and(Bool.and(is_some(ma), Bool.and(is_some(mb), is_some(mc))), K.is_pos(R.sub(area, K.tol_lin())))
  cor.tri.ok(ok, faces, v, K.vtx(K.body_vs(b), v), convex, qa, qb, qc)

def cor.kind(+ok: Bool, +chamfer: Bool, +b: J.Body, +ss: List<&2, L.Stripe>, +es3: List<&2, U32>, +faces: List<&2, U32>, +v: U32, +r: R.Real, +convex: Bool) -> Cor:
  match ok:
    case False{}:
      CorNo{v, "vertex-blend", "corner" ++ vtxt(v) ++ " is not three plane faces (curved corner patch, later stage)"}
    case True{}:
      match chamfer:
        case True{}:
          cor.tri(b, ss, es3, faces, v, convex)
        case False{}:
          cor.sph(b, faces, v, r, convex)

def corner_at(+b: J.Body, +ss: List<&2, L.Stripe>, +sel: List<&2, U32>, +chamfer: Bool, +r: R.Real, +v: U32) -> Cor:
  +fs = K.body_fs(b)
  +es3 = B.sel_at(K.vertex_edges(K.body_es(b), v), sel, Nil{})
  +faces = K.sort_uniq(List.append(&2, U32, faces_of(fs, B.nth_u32(es3, 0n)), List.append(&2, U32, faces_of(fs, B.nth_u32(es3, 1n)), faces_of(fs, B.nth_u32(es3, 2n)))))
  +ok = Bool.and(Bool.and(U32.is_eq(K.count(U32, es3), 3), U32.is_eq(K.count(U32, faces), 3)), B.all_planes(faces, fs))
  cor.kind(ok, chamfer, b, ss, es3, faces, v, r, L.cls_convex(L.classify(b, B.nth_u32(es3, 0n))))

def cor_v(+c: Cor) -> U32:
  match c:
    case CorSph{v, _, _, _, _}:
      v
    case CorTri{v, _, _, _}:
      v
    case CorNo{v, _, _}:
      v

def find_cor.go(+cs: List<&2, Cor>, +v: U32, +acc: Maybe<&2, Cor>) -> Maybe<&2, Cor>:
  match cs:
    case Nil{}:
      acc
    case c <> t:
      find_cor.go(t, v, Bool.pick(Maybe<&2, Cor>, Bool.and(is_none(Cor, acc), U32.is_eq(cor_v(c), v)), Some{c}, acc))

def find_cor(+cs: List<&2, Cor>, +v: U32) -> Maybe<&2, Cor>:
  find_cor.go(cs, v, None{})

# The stripe's tip at a corner: the great arc of the corner ball in the
# plane through its centre ⟂ the spine, or the chamfer's end segment.
def corner.sph(+ok: Bool, +x: Sx, +v: U32, +c: G.Vec3, +r: R.Real, +p1: G.Vec3, +p2: G.Vec3, +gap: R.Real) -> Tip:
  match ok:
    case False{}:
      TipNo{sx_k(x), v, "vertex-blend", "the corner ball" ++ vtxt(v) ++ " misses the springs of " ++ etxt(sx_k(x)) ++ " by " ++ K.show_gap(gap) ++ " (setback corner)"}
    case True{}:
      Sx{k, f1, f2, _, sec, _, _, _, _} = x
      +d = G.normalize(sec_d(sec))
      Tip{k, v, 3, v, Pl{c, d}, p1, AtFace{f1}, p2, AtFace{f2}, circ_arc(c, d, r, p1, p2), TrNo{}}

def corner.cor(+cor: Cor, +x: Sx, +v: U32) -> Tip:
  match cor:
    case CorSph{_, c, r, fs, ts}:
      Sx{_, f1, f2, _, sec, q1, q2, _, _} = x
      +p1 = pick_pt(fs, ts, f1)
      +p2 = pick_pt(fs, ts, f2)
      +d = sec_d(sec)
      +gap = R.max(dist_line(p1, K.sec_lift(sec, q1), d), dist_line(p2, K.sec_lift(sec, q2), d))
      corner.sph(K.near_lin(gap), x, v, c, r, p1, p2, gap)
    case CorTri{_, _, fs, qs}:
      Sx{k, f1, f2, _, sec, _, _, _, _} = x
      +p1 = pick_pt(fs, qs, f1)
      +p2 = pick_pt(fs, qs, f2)
      +g = G.normalize(G.sub(p2, p1))
      +d = sec_d(sec)
      Tip{k, v, 4, v, Pl{p1, G.normalize(G.sub(d, G.scale(g, G.dot(d, g))))}, p1, AtFace{f1}, p2, AtFace{f2}, seg_arc(p1, p2), TrNo{}}
    case CorNo{_, cls, why}:
      TipNo{sx_k(x), v, cls, why}

def tip_corner(+x: Sx, +mc: Maybe<&2, Cor>, +v: U32) -> Tip:
  match mc:
    case None{}:
      TipNo{sx_k(x), v, "invalid-input", "no corner record"}
    case Some{c}:
      corner.cor(c, x, v)

# ---------------------------------------------------------------------------
# Tips of all stripes (stripe order, start end then end end)

def tip_of_end(+e: B.End, +b: J.Body, +ss: List<&2, L.Stripe>, +cs: List<&2, Cor>, +x: Sx, +ch: Bool, +r: R.Real, +nks: List<&2, Nk>) -> Tip:
  match e:
    case B.EClosed{}:
      TipClosed{sx_k(x)}
    case B.ECap{v}:
      tip_cap(b, x, ch, r, v, nks)
    case B.EMitre{v, o, ext}:
      tip_mitre(b, x, find_sx(ss, o), ch, ext, r, v)
    case B.EChain{v, o}:
      tip_chain(b, x, find_sx(ss, o), ch, r, v)
    case B.ECorner{v}:
      tip_corner(x, find_cor(cs, v), v)
    case B.ENo{v, cls, why}:
      TipNo{sx_k(x), v, cls, why}

def tips_ends(+es: List<&2, B.End>, +b: J.Body, +ss: List<&2, L.Stripe>, +cs: List<&2, Cor>, +x: Sx, +ch: Bool, +r: R.Real, +nks: List<&2, Nk>, +acc: List<&2, Tip>) -> List<&2, Tip>:
  match es:
    case Nil{}:
      List.reverse(&2, Tip, acc)
    case e <> t:
      tips_ends(t, b, ss, cs, x, ch, r, nks, tip_of_end(e, b, ss, cs, x, ch, r, nks) <> acc)

def tips_post(+p: B.Post, +b: J.Body, +ss: List<&2, L.Stripe>, +cs: List<&2, Cor>, +mx: Maybe<&2, Sx>, +ch: Bool, +r: R.Real, +nks: List<&2, Nk>) -> List<&2, Tip>:
  match p:
    case B.Post{_, _, ends}:
      match mx:
        case Some{x}:
          tips_ends(ends, b, ss, cs, x, ch, r, nks, Nil{})
        case None{}:
          Nil{}
    case B.PostNo{}:
      Nil{}

# xs reversed onto acc.
def rev_onto(-A: Data, +xs: List<&2, A>, +acc: List<&2, A>) -> List<&2, A>:
  match xs:
    case Nil{}:
      acc
    case x <> t:
      rev_onto(A, t, x <> acc)

def tips.go(+xs: List<&2, L.Stripe>, +ps: List<&2, B.Post>, +b: J.Body, +ss: List<&2, L.Stripe>, +cs: List<&2, Cor>, +ch: Bool, +r: R.Real, +nks: List<&2, Nk>, +acc: List<&2, Tip>) -> List<&2, Tip>:
  match xs:
    case Nil{}:
      List.reverse(&2, Tip, acc)
    case s <> t:
      match ps:
        case p <> pt:
          tips.go(t, pt, b, ss, cs, ch, r, nks, rev_onto(Tip, tips_post(p, b, ss, cs, sx_of(s), ch, r, nks), acc))
        case Nil{}:
          List.reverse(&2, Tip, acc)

def tips(+xs: List<&2, L.Stripe>, +ps: List<&2, B.Post>, +b: J.Body, +ss: List<&2, L.Stripe>, +cs: List<&2, Cor>, +ch: Bool, +r: R.Real, +nks: List<&2, Nk>) -> List<&2, Tip>:
  tips.go(xs, ps, b, ss, cs, ch, r, nks, Nil{})

# ---------------------------------------------------------------------------
# Face consumption

# Two blend carriers are the same surface (a full round).
def same_surf(+s1: J.Surf, +s2: J.Surf) -> Bool:
  match s1:
    case J.SCyl{o1, a1, _, r1}:
      match s2:
        case J.SCyl{o2, a2, _, r2}:
          Bool.and(K.near_lin(R.sub(r1, r2)), Bool.and(K.parallel(a1, a2), K.near_lin(K.line_dist(o1, a1, o2))))
        case _:
          False{}
    case J.STorus{o1, a1, _, m1, r1}:
      match s2:
        case J.STorus{o2, a2, _, m2, r2}:
          Bool.and(Bool.and(K.near_lin(R.sub(r1, r2)), K.near_lin(R.sub(m1, m2))), Bool.and(K.parallel(a1, a2), K.near_lin(K.dist(o1, o2))))
        case _:
          False{}
    case _:
      False{}

# The tip points of stripe k on its side i, and the edges they sit on.
def side_pts(+ts: List<&2, Tip>, +k: U32, +i: U32, +acc: List<&2, G.Vec3>) -> List<&2, G.Vec3>:
  match ts:
    case Nil{}:
      List.reverse(&2, G.Vec3, acc)
    case Tip{e, _, _, _, _, p1, _, p2, _, _, _} <> t:
      +hit = U32.is_eq(e, k)
      side_pts(t, k, i, Bool.pick(List<&2, G.Vec3>, hit, Bool.pick(G.Vec3, U32.is_eq(i, 1), p1, p2) <> acc, acc))
    case _ <> t:
      side_pts(t, k, i, acc)

def at_edge(+a: At, +acc: List<&2, U32>) -> List<&2, U32>:
  match a:
    case AtEdge{u}:
      u <> acc
    case AtFace{_}:
      acc

def side_edges(+ts: List<&2, Tip>, +k: U32, +i: U32, +acc: List<&2, U32>) -> List<&2, U32>:
  match ts:
    case Nil{}:
      acc
    case Tip{e, _, _, _, _, _, a1, _, a2, _, _} <> t:
      +hit = U32.is_eq(e, k)
      side_edges(t, k, i, Bool.pick(List<&2, U32>, hit, at_edge(Bool.pick(At, U32.is_eq(i, 1), a1, a2), acc), acc))
    case _ <> t:
      side_edges(t, k, i, acc)

def near_any(+ps: List<&2, G.Vec3>, +p: G.Vec3, +acc: Bool) -> Bool:
  match ps:
    case Nil{}:
      acc
    case q <> t:
      near_any(t, p, Bool.or(acc, K.near_lin(K.dist(q, p))))

# Every point of ps is (within the tolerance) one of qs.
def covered.go(+ps: List<&2, G.Vec3>, +qs: List<&2, G.Vec3>, +acc: Bool) -> Bool:
  match ps:
    case Nil{}:
      acc
    case p <> t:
      covered.go(t, qs, Bool.and(acc, near_any(qs, p, False{})))

def covered(+ps: List<&2, G.Vec3>, +qs: List<&2, G.Vec3>) -> Bool:
  covered.go(ps, qs, True{})

def all_in.go(+xs: List<&2, U32>, +ys: List<&2, U32>, +acc: Bool) -> Bool:
  match xs:
    case Nil{}:
      acc
    case x <> t:
      all_in.go(t, ys, Bool.and(acc, K.mem(ys, x)))

def all_in(+xs: List<&2, U32>, +ys: List<&2, U32>) -> Bool:
  all_in.go(xs, ys, True{})

def stripe_of.go(+ss: List<&2, L.Stripe>, +e: U32, +acc: Maybe<&2, L.Stripe>) -> Maybe<&2, L.Stripe>:
  match ss:
    case Nil{}:
      acc
    case s <> t:
      stripe_of.go(t, e, Bool.pick(Maybe<&2, L.Stripe>, Bool.and(is_none(L.Stripe, acc), U32.is_eq(st_edge(s), e)), Some{s}, acc))

def stripe_of(+ss: List<&2, L.Stripe>, +e: U32) -> Maybe<&2, L.Stripe>:
  stripe_of.go(ss, e, None{})

def surf_of(+m: Maybe<&2, L.Stripe>) -> Maybe<&2, J.Surf>:
  match m:
    case Some{L.St{_, _, _, _, _, _, _, _, _, _, _, _, surf, _}}:
      Some{surf}
    case _:
      None{}

def same_m(+m: Maybe<&2, J.Surf>, +s: J.Surf) -> Bool:
  match m:
    case None{}:
      False{}
    case Some{s2}:
      same_surf(s, s2)

def side_of_face(+m: Maybe<&2, L.Stripe>, +f: U32) -> U32:
  match m:
    case Some{L.St{_, f1, _, _, _, _, _, _, _, _, _, _, _, _}}:
      Bool.pick(U32, U32.is_eq(f1, f), 1, 2)
    case _:
      1

def eat.ok(+ok: Bool, +e: Eat, +f: U32, +why: String) -> Eat:
  match ok:
    case True{}:
      e
    case False{}:
      EatNo{f, "face-consumed", why}

def fedges(+b: J.Body, +f: U32) -> List<&2, U32>:
  K.face_edges(K.face_at(K.body_fs(b), f))

def edge_pts(+b: J.Body, +x: U32) -> List<&2, G.Vec3>:
  J.Body{vs, es, _} = b
  +ed = K.edge_at(es, x)
  [K.edge_start(vs, ed), K.edge_end(vs, ed)]

# A closed spring (rotation stripe, contact q) is the circle edge x itself:
# coaxial, same height, same radius (a tangent circle would pinch the face).
def ring_is.c(+c: J.Curve, +sec: K.Sec, +q: K.P2) -> Bool:
  match c:
    case J.CCircle{o2, n2, _, r2}:
      match sec:
        case K.Rot{o, a, _, _}:
          Bool.and(Bool.and(K.parallel(G.normalize(n2), a), K.near_lin(K.dist(o2, K.axpy(o, K.p2_y(q), a)))), K.near_lin(R.sub(r2, K.p2_x(q))))
        case K.Tra{_, _, _, _, _}:
          False{}
    case _:
      False{}

def ring_is(+b: J.Body, +x: U32, +sec: K.Sec, +q: K.P2) -> Bool:
  ring_is.c(K.edge_curve(K.edge_at(K.body_es(b), x)), sec, q)

# A consumed side of stripe k on face f (bound st = 1).
def eat_side(+by: U32, +b: J.Body, +ss: List<&2, L.Stripe>, +ts: List<&2, Tip>, +k: U32, +i: U32, +f: U32, +id: U32, +surf: J.Surf, +closed: Bool, +sec: K.Sec, +q: K.P2) -> List<&2, Eat>:
  match by:
    case 2:
      +mj = stripe_of(ss, id)
      +j = id
      +pk = side_pts(ts, k, i, Nil{})
      +pj = side_pts(ts, j, side_of_face(mj, f), Nil{})
      +allowed = {k <> j <> side_edges(ts, k, i, side_edges(ts, j, side_of_face(mj, f), Nil{})) : List<&2, U32>}
      +same = same_m(surf_of(mj), surf)
      +ok = Bool.and(same, Bool.and(Bool.and(covered(pk, pj), covered(pj, pk)), all_in(fedges(b, f), allowed)))
      +why = "face " ++ K.show_u32(f) ++ " between edges " ++ K.show_u32(k) ++ " and " ++ K.show_u32(j) ++ " is reached by both blends but not covered by one carrier (pinched, or two different blends)"
      Bool.pick(List<&2, Eat>, U32.is_lt(k, j), [eat.ok(ok, Eat{f, k, 0, j}, f, why)], Nil{})
    case 1:
      +pk = side_pts(ts, k, i, Nil{})
      +px = edge_pts(b, id)
      +allowed = {k <> id <> side_edges(ts, k, i, Nil{}) : List<&2, U32>}
      +ends = Bool.pick(Bool, closed, ring_is(b, id, sec, q), Bool.and(covered(pk, px), covered(px, pk)))
      +ok = Bool.and(ends, all_in(fedges(b, f), allowed))
      [eat.ok(ok, Eat{f, k, 1, id}, f, "the spring of edge " ++ K.show_u32(k) ++ " touches edge " ++ K.show_u32(id) ++ " of face " ++ K.show_u32(f) ++ " without covering it (face pinched at a point)")]
    case 3:
      +ok = Bool.and(closed, all_in(fedges(b, f), [k]))
      [eat.ok(ok, Eat{f, k, 2, 0}, f, "the blend of edge " ++ K.show_u32(k) ++ " reaches the axis on face " ++ K.show_u32(f) ++ " but does not close it (open dome)")]
    case _:
      [EatNo{f, "face-consumed", "face " ++ K.show_u32(f) ++ " is consumed by nothing known"}]

def eat_bnd(+bd: B.Bnd, +b: J.Body, +ss: List<&2, L.Stripe>, +ts: List<&2, Tip>, +k: U32, +i: U32, +f: U32, +surf: J.Surf, +closed: Bool, +sec: K.Sec, +q: K.P2) -> List<&2, Eat>:
  match bd:
    case B.Bnd{_, lim, st}:
      match lim:
        case B.Lim{_, _, by, id, _}:
          Bool.pick(List<&2, Eat>, U32.is_eq(st, 1), eat_side(by, b, ss, ts, k, i, f, id, surf, closed, sec, q), Nil{})

def sec_closed(+sec: K.Sec) -> Bool:
  match sec:
    case K.Rot{_, _, _, c}:
      c
    case K.Tra{_, _, _, _, _}:
      False{}

def eats.go(+xs: List<&2, L.Stripe>, +ps: List<&2, B.Post>, +b: J.Body, +ss: List<&2, L.Stripe>, +ts: List<&2, Tip>, +acc: List<&2, Eat>) -> List<&2, Eat>:
  match xs:
    case Nil{}:
      List.reverse(&2, Eat, acc)
    case L.St{k, _, _, _, _, _, sec, _, s1, s2, _, _, surf, _} <> t:
      match ps:
        case B.Post{b1, b2, _} <> pt:
          +cl = sec_closed(sec)
          +e1 = eat_bnd(b1, b, ss, ts, k, 1, L.side_face(s1), surf, cl, sec, L.side_p(s1))
          +e2 = eat_bnd(b2, b, ss, ts, k, 2, L.side_face(s2), surf, cl, sec, L.side_p(s2))
          eats.go(t, pt, b, ss, ts, rev_onto(Eat, e2, rev_onto(Eat, e1, acc)))
        case _ <> pt:
          eats.go(t, pt, b, ss, ts, acc)
        case Nil{}:
          List.reverse(&2, Eat, acc)
    case L.NoSt{_, _, _} <> t:
      match ps:
        case _ <> pt:
          eats.go(t, pt, b, ss, ts, acc)
        case Nil{}:
          List.reverse(&2, Eat, acc)

def eats(+xs: List<&2, L.Stripe>, +ps: List<&2, B.Post>, +b: J.Body, +ss: List<&2, L.Stripe>, +ts: List<&2, Tip>) -> List<&2, Eat>:
  eats.go(xs, ps, b, ss, ts, Nil{})

# ---------------------------------------------------------------------------
# The network

type Net is Data:
  Net{ts: List<&2, Tip>, cs: List<&2, Cor>, es: List<&2, Eat>}

def corner_list.go(+vs: List<&2, U32>, +b: J.Body, +ss: List<&2, L.Stripe>, +sel: List<&2, U32>, +ch: Bool, +r: R.Real, +acc: List<&2, Cor>) -> List<&2, Cor>:
  match vs:
    case Nil{}:
      List.reverse(&2, Cor, acc)
    case v <> t:
      corner_list.go(t, b, ss, sel, ch, r, corner_at(b, ss, sel, ch, r, v) <> acc)

def corner_list(+vs: List<&2, U32>, +b: J.Body, +ss: List<&2, L.Stripe>, +sel: List<&2, U32>, +ch: Bool, +r: R.Real) -> List<&2, Cor>:
  corner_list.go(vs, b, ss, sel, ch, r, Nil{})

# The corner network of admitted stripes ss with posts ps; cvs are the
# corner vertices (sorted).
def network(+b: J.Body, +sel: List<&2, U32>, +ch: Bool, +r: R.Real, +ss: List<&2, L.Stripe>, +ps: List<&2, B.Post>, +cvs: List<&2, U32>) -> Net:
  +cs = corner_list(cvs, b, ss, sel, ch, r)
  +ts = tips(ss, ps, b, ss, cs, ch, r, Nil{})
  Net{ts, cs, eats(ss, ps, b, ss, ts)}

type Nv is Data:
  NvOk{}
  NvNo{cls: String, why: String}

def nv_first(+a: Nv, +b: Nv) -> Nv:
  match a:
    case NvOk{}:
      b
    case NvNo{c, w}:
      NvNo{c, w}

def tips_nv(+ts: List<&2, Tip>) -> Nv:
  match ts:
    case Nil{}:
      NvOk{}
    case TipNo{_, _, cls, why} <> _:
      NvNo{cls, why}
    case _ <> t:
      tips_nv(t)

def cors_nv(+cs: List<&2, Cor>) -> Nv:
  match cs:
    case Nil{}:
      NvOk{}
    case CorNo{_, cls, why} <> _:
      NvNo{cls, why}
    case _ <> t:
      cors_nv(t)

def eats_nv(+es: List<&2, Eat>) -> Nv:
  match es:
    case Nil{}:
      NvOk{}
    case EatNo{_, cls, why} <> _:
      NvNo{cls, why}
    case _ <> t:
      eats_nv(t)

# First refusal: corners, then tips (stripe order), then consumption.
def net_nv(+n: Net) -> Nv:
  Net{ts, cs, es} = n
  nv_first(cors_nv(cs), nv_first(tips_nv(ts), eats_nv(es)))
