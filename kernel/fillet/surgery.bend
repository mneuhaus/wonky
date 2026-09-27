import Base
import ../real.bend as R
import ../precise.bend as G
import ../analytic.bend as A
import ./job.bend as J
import ./geom.bend as K
import ./ladder.bend as L
import ./bounds.bend as B
import ./corners.bend as C
import ./notch.bend as N
import ./decide.bend as D
import ./frame.bend as Fr

# Stage 3 of prototype A "fillet-kpart": local B-rep surgery
# (docs/fillet/proto-kpart.md, "Stage A3"; fillet.md §5.1 step 5).
#
# Input: the admitted stripes (stage 1) and their corner network (stage 2).
# Every output face is written as loops of oriented curve pieces (Sg) with
# explicit end points; the edges and vertices are found afterwards:
#   unify      coplanar plane fragments (faces split by smooth edges, as a
#              planar union leaves them) are merged into one face first, so a
#              cap or mitre point that lies in a neighbouring fragment lands
#              in the face that holds it;
#   supports   each loop of a support face is rewritten use by use: a
#              selected edge becomes its spring on that face (between the
#              stripe's tip points), an unselected edge keeps its curve with
#              ends moved to the tip points on it; where the ends of two
#              pieces differ at a vertex, the cap curve of that vertex joins
#              them; pieces of zero length (an edge or a spring consumed at a
#              face boundary, the dome's spring at the axis) are dropped, and
#              consumed faces are dropped;
#   blends     one face per stripe: spring 2, the end tip's curve, spring 1
#              reversed, the start tip's curve; a closed stripe (rim) gets a
#              seam (the section arc at the edge's vertex); a full round is
#              one face (both loops joined where the consumed face was);
#   notches    (notch.bend) a notched side's consumed support drops out, its
#              cap edge collapses onto the notch point, the bound edge
#              becomes the notch line or circle and the neighbour's edges at
#              the bound edge's vertex move to the notch point;
#   corners    the sphere octant (three great arcs) or the chamfer triangle;
#   joins      two pieces of one line or circle that meet at a vertex of
#              valence 2 become one piece;
#   assembly   end points are merged within the coincidence band of
#              decide.bend (1e-9 mm, relative 2^-36 at large coordinates),
#              and every piece is paired with the one piece that runs back
#              over the same curve between the same vertices (two interior
#              sample points within 1e-7 mm, or the band when larger). Each
#              pair is one edge. The sliver net then refuses a result with
#              two vertices closer than the modelling tolerance.
# A piece without exactly one partner, a loop that does not close, or a face
# without its outer loop is a typed refusal (`not-implemented`), never an
# `ok` with a hole in it.

# ---------------------------------------------------------------------------
# Data

# An oriented piece of the curve c from a (parameter t0) to b (t1).
type Sg is Data:
  Sg{c: A.Curve, t0: R.Real, t1: R.Real, a: G.Vec3, b: G.Vec3}

type OLoop is Data:
  OLoop{outer: Bool, sgs: List<&2, Sg>}

# role: 0 support, 1 blend, 2 corner, 3 cap
type OFace is Data:
  OFace{same: Bool, s: A.Surface, role: U32, loops: List<&2, OLoop>}

type Iv is Data:
  Iv{s: R.Real, e: R.Real}

# A notch end (notch.bend): at the stripe's end vertex vk the consumed
# support's edge u collapses onto the notch point q; with grow (a face notch)
# every other edge at the bound edge's vertex w moves to q too (the
# neighbour face is trimmed back or grows to the notch curve). b is the bound
# edge (face notch) or the other stripe (meet).
type Ne is Data:
  Ne{b: U32, k: U32, vk: U32, u: U32, w: U32, q: G.Vec3, grow: Bool}

type Cx is Data:
  Cx{b: J.Body, ch: Bool, r: R.Real, ss: List<&2, L.Stripe>, ts: List<&2, C.Tip>, nes: List<&2, Ne>}

# The surgery's input from stages 1-2: the body, the stripes with their notch
# points, the notch records.
type Sin is Data:
  Sin{b: J.Body, ss: List<&2, L.Stripe>, nts: List<&2, N.Nt>, org: G.Vec3}

type Pr is Data:
  Pr{a: U32, b: U32}

type Srg is Data:
  SrgOk{text: String, nv: U32, ne: U32, nf: U32}
  SrgNo{cls: String, why: String}

# ---------------------------------------------------------------------------
# Scalars and curves

def tol_pair() -> R.Real:
  R.from_f32(0.0000001)

def floor_r(+x: R.Real) -> R.Real:
  +f = R.from_f32(F32.floor(R.approx(x)))
  +f1 = K.pick_r(R.less(x, f), R.sub(f, K.one()), f)
  K.pick_r(Bool.not(R.less(R.sub(x, f1), K.one())), R.add(f1, K.one()), f1)

# t shifted by a multiple of 2π into [base, base + 2π).
def wrap_from(+t: R.Real, +base: R.Real) -> R.Real:
  +d = R.sub(t, base)
  R.add(base, R.sub(d, R.mul(K.two_pi(), floor_r(R.div(d, K.two_pi())))))

# t shifted by a multiple of 2π to lie within π of ref.
def near_param(+t: R.Real, +ref: R.Real) -> R.Real:
  wrap_from(t, R.sub(ref, R.pi()))

def periodic(+c: A.Curve) -> Bool:
  U32.is_ne(K.curve_kind(c), 0)

def cpt(+c: A.Curve, +t: R.Real) -> G.Vec3:
  match c:
    case A.Line{o, d}:
      K.axpy(o, t, d)
    case A.Circle{o, n, x, r}:
      +y = G.cross(n, x)
      G.add(o, G.add(G.scale(x, R.mul(r, R.cos(t))), G.scale(y, R.mul(r, R.sin(t)))))
    case A.Ellipse{o, n, x, a, b}:
      +y = G.cross(n, x)
      G.add(o, G.add(G.scale(x, R.mul(a, R.cos(t))), G.scale(y, R.mul(b, R.sin(t)))))

def cparam(+c: A.Curve, +p: G.Vec3) -> R.Real:
  match c:
    case A.Line{o, d}:
      R.div(G.dot(G.sub(p, o), d), G.dot(d, d))
    case A.Circle{o, n, x, _}:
      +q = G.sub(p, o)
      R.atan2(G.dot(q, G.cross(n, x)), G.dot(q, x))
    case A.Ellipse{o, n, x, a, b}:
      +q = G.sub(p, o)
      R.atan2(R.div(G.dot(q, G.cross(n, x)), b), R.div(G.dot(q, x), a))

def cscale(+c: A.Curve) -> R.Real:
  match c:
    case A.Line{_, d}:
      K.len(d)
    case A.Circle{_, _, _, r}:
      R.abs(r)
    case A.Ellipse{_, _, _, a, b}:
      R.max(R.abs(a), R.abs(b))

def sg_len(+s: Sg) -> R.Real:
  Sg{c, t0, t1, _, _} = s
  R.mul(R.abs(R.sub(t1, t0)), cscale(c))

def sg_rev(+s: Sg) -> Sg:
  Sg{c, t0, t1, a, b} = s
  Sg{c, t1, t0, b, a}

def sg_a(+s: Sg) -> G.Vec3:
  Sg{_, _, _, a, _} = s
  a

def sg_b(+s: Sg) -> G.Vec3:
  Sg{_, _, _, _, b} = s
  b

# The point at fraction f of the piece.
def sg_at(+s: Sg, +f: R.Real) -> G.Vec3:
  Sg{c, t0, t1, _, _} = s
  cpt(c, R.add(t0, R.mul(f, R.sub(t1, t0))))

# One point: within the coincidence band of decide.bend (1e-9 mm, or 2^-36
# of the coordinates' magnitude when that is larger).
def same_pt(+p: G.Vec3, +q: G.Vec3) -> Bool:
  D.coincide(K.dist(p, q), R.max(D.mag(p), D.mag(q)))

def live(+xs: List<&2, Sg>, +acc: List<&2, Sg>) -> List<&2, Sg>:
  match xs:
    case Nil{}:
      List.reverse(&2, Sg, acc)
    case s <> t:
      live(t, Bool.pick(List<&2, Sg>, K.near_lin(sg_len(s)), acc, s <> acc))

def bad_sg() -> Sg:
  Sg{A.Line{K.zero_v(), G.v3(1.0, 0.0, 0.0)}, K.zero(), K.one(), K.zero_v(), G.v3(1.0, 0.0, 0.0)}

# ---------------------------------------------------------------------------
# Input edges as pieces

def iv.open(+per: Bool, +same: Bool, +a: R.Real, +b: R.Real) -> Iv:
  match per:
    case False{}:
      Iv{a, b}
    case True{}:
      +w = wrap_from(b, a)
      Iv{a, K.pick_r(same, w, R.sub(w, K.two_pi()))}

def iv.free(+closed: Bool, +c: A.Curve, +same: Bool, +ps: G.Vec3, +pe: G.Vec3) -> Iv:
  match closed:
    case True{}:
      +a = cparam(c, ps)
      Iv{a, K.pick_r(same, R.add(a, K.two_pi()), R.sub(a, K.two_pi()))}
    case False{}:
      iv.open(periodic(c), same, cparam(c, ps), cparam(c, pe))

def edge_iv.r(+ranged: Bool, +vs: List<&2, G.Vec3>, +s: U32, +e: U32, +c: A.Curve, +same: Bool, +t0: R.Real, +t1: R.Real) -> Iv:
  match ranged:
    case True{}:
      Bool.pick(Iv, same, Iv{t0, t1}, Iv{t1, t0})
    case False{}:
      iv.free(U32.is_eq(s, e), c, same, K.vtx(vs, s), K.vtx(vs, e))

# Parameters at the edge's start and end vertex, in the direction start ->
# end (scripts/fillet/geom.mjs edgeInterval).
def edge_iv(+vs: List<&2, G.Vec3>, +ed: J.Edge) -> Iv:
  J.Edge{s, e, c, same, ranged, t0, t1} = ed
  edge_iv.r(ranged, vs, s, e, c, same, t0, t1)

# The edge's curve from pa (its start, moved) to pb (its end, moved).
def edge_seg(+per: Bool, +c: A.Curve, +iv: Iv, +pa: G.Vec3, +pb: G.Vec3) -> Sg:
  match per:
    case False{}:
      Sg{c, cparam(c, pa), cparam(c, pb), pa, pb}
    case True{}:
      Iv{ts, te} = iv
      Sg{c, near_param(cparam(c, pa), ts), near_param(cparam(c, pb), te), pa, pb}

# The input edge e unchanged, start -> end.
def raw_seg(+b: J.Body, +e: U32) -> Sg:
  J.Body{vs, es, _} = b
  +ed = K.edge_at(es, e)
  +c = K.edge_curve(ed)
  edge_seg(periodic(c), c, edge_iv(vs, ed), K.edge_start(vs, ed), K.edge_end(vs, ed))

# ---------------------------------------------------------------------------
# Where an unselected edge ends after the blend

def at_is(+a: C.At, +e: U32) -> Bool:
  match a:
    case C.AtEdge{x}:
      U32.is_eq(x, e)
    case C.AtFace{_}:
      False{}

def none_v(+m: Maybe<&2, G.Vec3>) -> Bool:
  C.is_none(G.Vec3, m)

# A tip point at v attached to edge e.
def np.edge(+ts: List<&2, C.Tip>, +e: U32, +v: U32, +acc: Maybe<&2, G.Vec3>) -> Maybe<&2, G.Vec3>:
  match ts:
    case Nil{}:
      acc
    case C.Tip{_, tv, _, _, _, p1, a1, p2, a2, _, _} <> t:
      +here = Bool.and(none_v(acc), U32.is_eq(tv, v))
      +m1 = Bool.pick(Maybe<&2, G.Vec3>, Bool.and(here, at_is(a1, e)), Some{p1}, acc)
      +m2 = Bool.pick(Maybe<&2, G.Vec3>, Bool.and(Bool.and(here, none_v(m1)), at_is(a2, e)), Some{p2}, m1)
      np.edge(t, e, v, m2)
    case _ <> t:
      np.edge(t, e, v, acc)

# Is p on edge e next to its vertex v (inside it or at its far end)?
def on_e.if(+here: Bool, +b: J.Body, +e: U32, +v: U32, +p: G.Vec3) -> Bool:
  match here:
    case True{}:
      U32.is_lt(C.on_st(C.on_edge(b, e, v, p)), 2)
    case False{}:
      False{}

# A tip point at v (attached to a face) that lies on edge e: chains, whose
# springs end on the smooth edge between two wall faces.
def np.face(+ts: List<&2, C.Tip>, +b: J.Body, +e: U32, +v: U32, +acc: Maybe<&2, G.Vec3>) -> Maybe<&2, G.Vec3>:
  match ts:
    case Nil{}:
      acc
    case C.Tip{_, tv, _, _, _, p1, _, p2, _, _, _} <> t:
      +here = Bool.and(none_v(acc), U32.is_eq(tv, v))
      +m1 = Bool.pick(Maybe<&2, G.Vec3>, on_e.if(here, b, e, v, p1), Some{p1}, acc)
      +m2 = Bool.pick(Maybe<&2, G.Vec3>, on_e.if(Bool.and(here, none_v(m1)), b, e, v, p2), Some{p2}, m1)
      np.face(t, b, e, v, m2)
    case _ <> t:
      np.face(t, b, e, v, acc)

def st_edge_s(+b: J.Body, +k: U32) -> U32:
  K.edge_s(K.edge_at(K.body_es(b), k))

def st_closed_at(+b: J.Body, +st: L.Stripe, +v: U32) -> Bool:
  match st:
    case L.St{k, _, _, _, _, _, sec, _, _, _, _, _, _, _}:
      Bool.and(C.sec_closed(sec), U32.is_eq(st_edge_s(b, k), v))
    case L.NoSt{_, _, _}:
      False{}

# The spring point of a closed stripe on side i at the edge's vertex.
def closed_pt(+st: L.Stripe, +i: U32, +vp: G.Vec3) -> G.Vec3:
  match st:
    case L.St{_, _, _, _, _, _, sec, _, s1, s2, _, _, _, _}:
      C.sp_at(sec, L.side_p(Bool.pick(L.Side, U32.is_eq(i, 1), s1, s2)), vp)
    case L.NoSt{_, _, _}:
      vp

def np.closed.st(+hit: Bool, +b: J.Body, +st: L.Stripe, +e: U32, +v: U32, +acc: Maybe<&2, G.Vec3>) -> Maybe<&2, G.Vec3>:
  match hit:
    case False{}:
      acc
    case True{}:
      +vp = K.vtx(K.body_vs(b), v)
      +p1 = closed_pt(st, 1, vp)
      +p2 = closed_pt(st, 2, vp)
      +m1 = Bool.pick(Maybe<&2, G.Vec3>, on_e.if(True{}, b, e, v, p1), Some{p1}, acc)
      Bool.pick(Maybe<&2, G.Vec3>, on_e.if(none_v(m1), b, e, v, p2), Some{p2}, m1)

# The seam point of a closed stripe at v that lies on e (a cylinder's seam
# line below a filleted rim).
def np.closed(+ss: List<&2, L.Stripe>, +b: J.Body, +e: U32, +v: U32, +acc: Maybe<&2, G.Vec3>) -> Maybe<&2, G.Vec3>:
  match ss:
    case Nil{}:
      acc
    case st <> t:
      np.closed(t, b, e, v, np.closed.st(Bool.and(none_v(acc), st_closed_at(b, st, v)), b, st, e, v, acc))

def np.or(+m: Maybe<&2, G.Vec3>, +d: G.Vec3) -> G.Vec3:
  match m:
    case Some{p}:
      p
    case None{}:
      d

def newpt.c(+m: Maybe<&2, G.Vec3>, +cx: Cx, +e: U32, +v: U32) -> G.Vec3:
  match m:
    case Some{p}:
      p
    case None{}:
      Cx{b, _, _, ss, _, _} = cx
      np.or(np.closed(ss, b, e, v, None{}), K.vtx(K.body_vs(b), v))

def newpt.f(+m: Maybe<&2, G.Vec3>, +cx: Cx, +e: U32, +v: U32) -> G.Vec3:
  match m:
    case Some{p}:
      p
    case None{}:
      Cx{b, _, _, _, ts, _} = cx
      newpt.c(np.face(ts, b, e, v, None{}), cx, e, v)

def np.notch(+nes: List<&2, Ne>, +e: U32, +v: U32, +acc: Maybe<&2, G.Vec3>) -> Maybe<&2, G.Vec3>:
  match nes:
    case Nil{}:
      acc
    case Ne{b, _, vk, u, w, q, grow} <> t:
      +hit = Bool.or(Bool.and(U32.is_eq(v, vk), U32.is_eq(e, u)), Bool.and(grow, Bool.and(U32.is_eq(v, w), U32.is_ne(e, b))))
      np.notch(t, e, v, Bool.pick(Maybe<&2, G.Vec3>, Bool.and(none_v(acc), hit), Some{q}, acc))

def newpt.n(+m: Maybe<&2, G.Vec3>, +cx: Cx, +e: U32, +v: U32) -> G.Vec3:
  match m:
    case Some{p}:
      p
    case None{}:
      Cx{_, _, _, _, ts, _} = cx
      newpt.f(np.edge(ts, e, v, None{}), cx, e, v)

# Where the unselected edge e ends at its vertex v after the blend: a notch
# point, a tip point attached to e, a tip point (or a closed stripe's seam
# point) lying on e, or v itself.
def newpt(+cx: Cx, +e: U32, +v: U32) -> G.Vec3:
  Cx{_, _, _, _, _, nes} = cx
  newpt.n(np.notch(nes, e, v, None{}), cx, e, v)

# The unselected edge e with both ends moved (start -> end).
def in_seg(+cx: Cx, +e: U32) -> Sg:
  Cx{b, _, _, _, _, _} = cx
  J.Body{vs, es, _} = b
  +ed = K.edge_at(es, e)
  +c = K.edge_curve(ed)
  edge_seg(periodic(c), c, edge_iv(vs, ed), newpt(cx, e, K.edge_s(ed)), newpt(cx, e, K.edge_e(ed)))

# ---------------------------------------------------------------------------
# Springs and tip curves

def tip_is(+x: C.Tip, +k: U32, +v: U32) -> Bool:
  match x:
    case C.Tip{e, tv, _, _, _, _, _, _, _, _, _}:
      Bool.and(U32.is_eq(e, k), U32.is_eq(tv, v))
    case _:
      False{}

def tip_at.go(+ts: List<&2, C.Tip>, +k: U32, +v: U32, +acc: Maybe<&2, C.Tip>) -> Maybe<&2, C.Tip>:
  match ts:
    case Nil{}:
      acc
    case x <> t:
      tip_at.go(t, k, v, Bool.pick(Maybe<&2, C.Tip>, Bool.and(C.is_none(C.Tip, acc), tip_is(x, k, v)), Some{x}, acc))

# The tip of stripe k at vertex v.
def tip_at(+ts: List<&2, C.Tip>, +k: U32, +v: U32) -> Maybe<&2, C.Tip>:
  tip_at.go(ts, k, v, None{})

def tip_pt(+m: Maybe<&2, C.Tip>, +i: U32) -> G.Vec3:
  match m:
    case Some{C.Tip{_, _, _, _, _, p1, _, p2, _, _, _}}:
      Bool.pick(G.Vec3, U32.is_eq(i, 1), p1, p2)
    case _:
      K.zero_v()

def arc_sg(+a: C.Arc, +p1: G.Vec3, +p2: G.Vec3) -> Sg:
  C.Arc{c, t0, t1} = a
  Sg{c, t0, t1, p1, p2}

# The tip curve p1 -> p2 (fwd) or p2 -> p1: one piece, or two for a setback
# mitre (the mitre curve and the trim curve, meeting at pm).
def tip_sgs.tr(+tr: C.Tr, +arc: C.Arc, +p1: G.Vec3, +p2: G.Vec3, +fwd: Bool) -> List<&2, Sg>:
  match tr:
    case C.TrNo{}:
      C.Arc{c, t0, t1} = arc
      [Bool.pick(Sg, fwd, Sg{c, t0, t1, p1, p2}, Sg{c, t1, t0, p2, p1})]
    case C.Tr{_, side, pm, _, tarc}:
      +two = U32.is_eq(side, 2)
      +s1 = arc_sg(Bool.pick(C.Arc, two, arc, tarc), p1, pm)
      +s2 = arc_sg(Bool.pick(C.Arc, two, tarc, arc), pm, p2)
      Bool.pick(List<&2, Sg>, fwd, [s1, s2], [sg_rev(s2), sg_rev(s1)])

def tip_sgs(+m: Maybe<&2, C.Tip>, +fwd: Bool) -> List<&2, Sg>:
  match m:
    case Some{C.Tip{_, _, _, _, _, p1, _, p2, _, arc, tr}}:
      tip_sgs.tr(tr, arc, p1, p2, fwd)
    case _:
      [bad_sg()]

# End point of the spring of st on side i at vertex v.
def spt.c(+closed: Bool, +cx: Cx, +st: L.Stripe, +i: U32, +v: U32) -> G.Vec3:
  match closed:
    case True{}:
      Cx{b, _, _, _, _, _} = cx
      closed_pt(st, i, K.vtx(K.body_vs(b), v))
    case False{}:
      Cx{_, _, _, _, ts, _} = cx
      tip_pt(tip_at(ts, C.st_edge(st), v), i)

# Rotation sense of the stripe edge (start -> end) about the unit axis a.
def edge_sense(+b: J.Body, +k: U32, +o: G.Vec3, +a: G.Vec3) -> Bool:
  J.Body{vs, es, _} = b
  +ed = K.edge_at(es, k)
  +ps = K.edge_start(vs, ed)
  K.is_pos(G.dot(a, G.cross(G.sub(ps, o), K.edge_tangent(ed, ps))))

# Angle from u to w about the unit normal n, in [0, 2π) (2π when full).
def ang_pos(+full: Bool, +n: G.Vec3, +u: G.Vec3, +w: G.Vec3) -> R.Real:
  match full:
    case True{}:
      K.two_pi()
    case False{}:
      +t = R.atan2(G.dot(n, G.cross(u, w)), G.dot(u, w))
      K.pick_r(R.less(t, K.zero()), R.add(t, K.two_pi()), t)

def spring.rot(+deg: Bool, +closed: Bool, +ctr: G.Vec3, +nn: G.Vec3, +rr: G.Vec3, +rho: R.Real, +pa: G.Vec3, +pb: G.Vec3) -> Sg:
  match deg:
    case True{}:
      Sg{A.Circle{ctr, nn, rr, rho}, K.zero(), K.zero(), pa, pb}
    case False{}:
      +u = G.sub(pa, ctr)
      Sg{A.Circle{ctr, nn, G.normalize(u), rho}, K.zero(), ang_pos(closed, nn, u, G.sub(pb, ctr)), pa, pb}

def spring.sec(+sec: K.Sec, +b: J.Body, +k: U32, +q: K.P2, +fwd: Bool, +pa: G.Vec3, +pb: G.Vec3) -> Sg:
  match sec:
    case K.Tra{_, _, _, _, _}:
      Sg{A.Line{pa, G.sub(pb, pa)}, K.zero(), K.one(), pa, pb}
    case K.Rot{o, a, rr, closed}:
      +sense = Bool.not(Bool.xor(edge_sense(b, k, o, a), fwd))
      spring.rot(K.near_lin(K.p2_x(q)), closed, K.axpy(o, K.p2_y(q), a), K.signed(sense, a), rr, K.p2_x(q), pa, pb)

# The spring of st on side i, run along the edge (fwd) or against it.
def spring(+st: L.Stripe, +cx: Cx, +i: U32, +fwd: Bool) -> Sg:
  match st:
    case L.St{k, _, _, _, _, _, sec, _, s1, s2, _, _, _, _}:
      Cx{b, _, _, _, _, _} = cx
      +ed = K.edge_at(K.body_es(b), k)
      +va = Bool.pick(U32, fwd, K.edge_s(ed), K.edge_e(ed))
      +vb = Bool.pick(U32, fwd, K.edge_e(ed), K.edge_s(ed))
      +cl = C.sec_closed(sec)
      spring.sec(sec, b, k, L.side_p(Bool.pick(L.Side, U32.is_eq(i, 1), s1, s2)), fwd, spt.c(cl, cx, st, i, va), spt.c(cl, cx, st, i, vb))
    case L.NoSt{_, _, _}:
      bad_sg()

# ---------------------------------------------------------------------------
# Blend faces

# Cylinder blends are re-framed with x pointing away from the edge, so the
# cylinder's parameter seam lies outside the blend (same point set).
def blend_surf(+sec: K.Sec, +e2: K.P2, +c2: K.P2, +surf: A.Surface) -> A.Surface:
  match sec:
    case K.Tra{_, _, _, _, _}:
      match surf:
        case A.Cylinder{o, a, _, r}:
          A.Cylinder{o, a, G.normalize(K.sec_lift_dir(sec, K.p2_sub(c2, e2))), r}
        case _:
          surf
    case K.Rot{_, _, _, _}:
      surf

# The seam of a closed stripe: its section at the edge's vertex, S1 -> S2.
def seam_arc(+ch: Bool, +sec: K.Sec, +c2: K.P2, +r: R.Real, +vp: G.Vec3, +p1: G.Vec3, +p2: G.Vec3) -> C.Arc:
  match ch:
    case True{}:
      C.seg_arc(p1, p2)
    case False{}:
      +ctr = C.sp_at(sec, c2, vp)
      C.circ_arc(ctr, G.normalize(G.cross(G.sub(p1, ctr), G.sub(p2, ctr))), r, p1, p2)

# The end tip's pieces p2 -> p1 (at the edge's end vertex) and the start
# tip's pieces p1 -> p2.
def tip_end(+cx: Cx, +k: U32) -> List<&2, Sg>:
  Cx{b, _, _, _, ts, _} = cx
  tip_sgs(tip_at(ts, k, K.edge_e(K.edge_at(K.body_es(b), k))), False{})

def tip_start(+cx: Cx, +k: U32) -> List<&2, Sg>:
  Cx{b, _, _, _, ts, _} = cx
  tip_sgs(tip_at(ts, k, K.edge_s(K.edge_at(K.body_es(b), k))), True{})

def blend.open(+cx: Cx, +st: L.Stripe, +k: U32) -> List<&2, Sg>:
  List.append(&2, Sg, spring(st, cx, 2, True{}) <> tip_end(cx, k), spring(st, cx, 1, False{}) <> tip_start(cx, k))

def blend.closed(+cx: Cx, +st: L.Stripe, +k: U32, +sec: K.Sec, +c2: K.P2) -> List<&2, Sg>:
  Cx{b, ch, r, _, _, _} = cx
  +vp = K.vtx(K.body_vs(b), st_edge_s(b, k))
  +p1 = closed_pt(st, 1, vp)
  +p2 = closed_pt(st, 2, vp)
  +seam = arc_sg(seam_arc(ch, sec, c2, r, vp, p1, p2), p1, p2)
  [spring(st, cx, 1, False{}), seam, spring(st, cx, 2, True{}), sg_rev(seam)]

def blend.sgs(+closed: Bool, +cx: Cx, +st: L.Stripe, +k: U32, +sec: K.Sec, +c2: K.P2) -> List<&2, Sg>:
  match closed:
    case True{}:
      blend.closed(cx, st, k, sec, c2)
    case False{}:
      blend.open(cx, st, k)

# Full rounds (network: consumed face f merges stripes k < j of one carrier).
type Mg is Data:
  Mg{k: U32, j: U32, f: U32}

def merges_of(+es: List<&2, C.Eat>, +acc: List<&2, Mg>) -> List<&2, Mg>:
  match es:
    case Nil{}:
      List.reverse(&2, Mg, acc)
    case C.Eat{f, k, kind, w} <> t:
      merges_of(t, Bool.pick(List<&2, Mg>, U32.is_eq(kind, 0), Mg{k, w, f} <> acc, acc))
    case _ <> t:
      merges_of(t, acc)

def mg_find(+ms: List<&2, Mg>, +k: U32) -> Maybe<&2, Mg>:
  match ms:
    case Nil{}:
      None{}
    case Mg{a, b, f} <> t:
      Bool.pick(Maybe<&2, Mg>, U32.is_eq(a, k), Some{Mg{a, b, f}}, mg_find(t, k))

def mg_partner(+ms: List<&2, Mg>, +j: U32) -> Bool:
  match ms:
    case Nil{}:
      False{}
    case Mg{_, b, _} <> t:
      Bool.or(U32.is_eq(b, j), mg_partner(t, j))

# The open blend loop of st without its spring on the consumed face f: a
# chain from that spring's end back to its start.
def fr_chain.k(+one: Bool, +st: L.Stripe, +cx: Cx, +k: U32) -> List<&2, Sg>:
  match one:
    case True{}:
      List.append(&2, Sg, tip_start(cx, k), spring(st, cx, 2, True{}) <> tip_end(cx, k))
    case False{}:
      List.append(&2, Sg, tip_end(cx, k), spring(st, cx, 1, False{}) <> tip_start(cx, k))

def fr_chain(+st: L.Stripe, +cx: Cx, +f: U32) -> List<&2, Sg>:
  match st:
    case L.St{k, f1, _, _, _, _, _, _, _, _, _, _, _, _}:
      fr_chain.k(U32.is_eq(f1, f), st, cx, k)
    case L.NoSt{_, _, _}:
      [bad_sg()]

def fr_other(+m: Maybe<&2, L.Stripe>, +cx: Cx, +f: U32) -> List<&2, Sg>:
  match m:
    case Some{sj}:
      fr_chain(sj, cx, f)
    case None{}:
      [bad_sg()]

def blend_face.m(+m: Maybe<&2, Mg>, +partner: Bool, +st: L.Stripe, +cx: Cx, +sgs: List<&2, Sg>, +surf: A.Surface, +same: Bool) -> List<&2, OFace>:
  match m:
    case Some{Mg{_, j, f}}:
      Cx{_, _, _, ss, _, _} = cx
      +loop = List.append(&2, Sg, fr_chain(st, cx, f), fr_other(C.stripe_of(ss, j), cx, f))
      [OFace{same, surf, 1, [OLoop{True{}, live(loop, Nil{})}]}]
    case None{}:
      Bool.pick(List<&2, OFace>, partner, Nil{}, [OFace{same, surf, 1, [OLoop{True{}, live(sgs, Nil{})}]}])

# The blend face of one stripe: spring 2 along the edge, the end tip's curve
# p2 -> p1, spring 1 back, the start tip's curve p1 -> p2 (the supports use
# spring 1 along and spring 2 against the edge, as they used the edge). A
# full round is one face: the two stripes' loops joined where the consumed
# face's springs were (Onshape FP02, FP04: one cylinder).
def blend_face(+cx: Cx, +ms: List<&2, Mg>, +st: L.Stripe) -> List<&2, OFace>:
  match st:
    case L.St{k, _, _, _, _, _, sec, e2, _, _, c2, _, surf, same}:
      +sgs = blend.sgs(C.sec_closed(sec), cx, st, k, sec, c2)
      blend_face.m(mg_find(ms, k), mg_partner(ms, k), st, cx, sgs, blend_surf(sec, e2, c2, surf), same)
    case L.NoSt{_, _, _}:
      Nil{}

def blend_faces(+ss: List<&2, L.Stripe>, +cx: Cx, +ms: List<&2, Mg>, +acc: List<&2, OFace>) -> List<&2, OFace>:
  match ss:
    case Nil{}:
      List.reverse(&2, OFace, acc)
    case st <> t:
      blend_faces(t, cx, ms, C.rev_onto(OFace, blend_face(cx, ms, st), acc))

# ---------------------------------------------------------------------------
# Corner faces

# The corner tips at v, as the corner face runs them (against the blends).
def corner_sgs(+ts: List<&2, C.Tip>, +b: J.Body, +v: U32, +acc: List<&2, Sg>) -> List<&2, Sg>:
  match ts:
    case Nil{}:
      List.reverse(&2, Sg, acc)
    case C.Tip{e, tv, kind, _, _, p1, _, p2, _, arc, _} <> t:
      C.Arc{c, t0, t1} = arc
      +hit = Bool.and(U32.is_eq(tv, v), U32.is_lt(2, kind))
      +atstart = U32.is_eq(st_edge_s(b, e), v)
      +s = Bool.pick(Sg, atstart, Sg{c, t1, t0, p2, p1}, Sg{c, t0, t1, p1, p2})
      corner_sgs(t, b, v, Bool.pick(List<&2, Sg>, hit, s <> acc, acc))
    case _ <> t:
      corner_sgs(t, b, v, acc)

def chain3(+xs: List<&2, Sg>) -> List<&2, Sg>:
  match xs:
    case s1 <> s2 <> s3 <> Nil{}:
      Bool.pick(List<&2, Sg>, same_pt(sg_b(s1), sg_a(s2)), [s1, s2, s3], [s1, s3, s2])
    case _:
      xs

def nth_v(+xs: List<&2, G.Vec3>, +i: Nat) -> G.Vec3:
  K.vtx.m(List.get(&2, G.Vec3, xs, i))

# The corner ball is framed on its bounding arcs, so that they are iso-lines
# of the sphere (as OCCT frames its corner balls; a STEP reader then finds
# their pcurves exactly): the axis is the line where two arc planes meet, so
# both arcs are meridians meeting at the pole, which is their common foot (a
# corner of the patch); the pair is the one that leaves the third arc closest
# to the equator. At an orthogonal corner (a box, a prism) the third arc is
# the equator and all three arcs are iso-lines; at an oblique corner no frame
# makes the third one an iso-line (its pcurve is a general curve). The axis is
# turned towards the patch and x points away from it, so the parameter seam
# lies on the far side of the ball.
# Each corner tip's cut plane is its arc's plane (the section of the blend
# through the ball centre).
def sph_ns(+ts: List<&2, C.Tip>, +v: U32, +acc: List<&2, G.Vec3>) -> List<&2, G.Vec3>:
  match ts:
    case Nil{}:
      List.reverse(&2, G.Vec3, acc)
    case C.Tip{_, tv, kind, _, cut, _, _, _, _, _, _} <> t:
      C.Pl{_, n} = cut
      +hit = Bool.and(U32.is_eq(tv, v), U32.is_eq(kind, 3))
      sph_ns(t, v, Bool.pick(List<&2, G.Vec3>, hit, G.normalize(n) <> acc, acc))
    case _ <> t:
      sph_ns(t, v, acc)

# The sum of the corner tips' end points about the ball centre (points into
# the patch).
def sph_mid(+ts: List<&2, C.Tip>, +v: U32, +ctr: G.Vec3, +acc: G.Vec3) -> G.Vec3:
  match ts:
    case Nil{}:
      acc
    case C.Tip{_, tv, kind, _, _, p1, _, p2, _, _, _} <> t:
      +hit = Bool.and(U32.is_eq(tv, v), U32.is_eq(kind, 3))
      +d = G.add(G.sub(p1, ctr), G.sub(p2, ctr))
      sph_mid(t, v, ctr, Bool.pick(G.Vec3, hit, G.add(acc, d), acc))
    case _ <> t:
      sph_mid(t, v, ctr, acc)

# How far a is from being perpendicular to both b and c.
def sph_off(+a: G.Vec3, +b: G.Vec3, +c: G.Vec3) -> R.Real:
  R.max(R.abs(G.dot(a, b)), R.abs(G.dot(a, c)))

# The axis that makes the arcs with normals b and c meridians.
def sph_pair(+b: G.Vec3, +c: G.Vec3) -> G.Vec3:
  G.normalize(G.cross(b, c))

# How close that axis leaves the third arc (normal a) to the equator (1 at an
# orthogonal corner).
def sph_eq(+a: G.Vec3, +b: G.Vec3, +c: G.Vec3) -> R.Real:
  R.abs(G.dot(a, G.normalize(G.cross(b, c))))

# An arc normal perpendicular to the other two (within the direction band) is
# the axis itself (its arc the equator, the other two meridians); otherwise
# the pair axis that leaves the third arc closest to the equator, the first on
# a tie (arcs 2-3, 1-3, 1-2).
def sph_axis3(+n1: G.Vec3, +n2: G.Vec3, +n3: G.Vec3) -> G.Vec3:
  +e1 = sph_eq(n1, n2, n3)
  +e2 = sph_eq(n2, n1, n3)
  +e3 = sph_eq(n3, n1, n2)
  +a12 = K.pick_v(R.less(e1, e2), sph_pair(n1, n3), sph_pair(n2, n3))
  +best = K.pick_v(R.less(R.max(e1, e2), e3), sph_pair(n1, n2), a12)
  K.pick_v(K.near_dir(sph_off(n1, n2, n3)), n1, K.pick_v(K.near_dir(sph_off(n2, n1, n3)), n2, K.pick_v(K.near_dir(sph_off(n3, n1, n2)), n3, best)))

def sph_axis(+ns: List<&2, G.Vec3>, +fallback: G.Vec3) -> G.Vec3:
  match ns:
    case n1 <> n2 <> n3 <> Nil{}:
      sph_axis3(n1, n2, n3)
    case _:
      fallback

def corner_sphere(+ctr: G.Vec3, +r: R.Real, +vp: G.Vec3, +ts: List<&2, C.Tip>, +v: U32) -> A.Surface:
  +w = G.normalize(G.sub(vp, ctr))
  +m = sph_mid(ts, v, ctr, K.zero_v())
  +a0 = sph_axis(sph_ns(ts, v, Nil{}), w)
  +a = K.signed(Bool.not(K.is_neg(G.dot(a0, m))), a0)
  +mp = G.sub(m, G.scale(a, G.dot(m, a)))
  A.Sphere{ctr, a, G.normalize(K.neg(mp)), r}

def corner_face(+c: C.Cor, +cx: Cx) -> List<&2, OFace>:
  match c:
    case C.CorSph{v, ctr, r, fs, feet}:
      Cx{b, _, _, _, ts, _} = cx
      +fa = B.nth_u32(fs, 0n)
      +ta = C.pick_pt(fs, feet, fa)
      +convex = K.is_pos(G.dot(G.sub(ta, ctr), B.fnormal(K.body_fs(b), fa, ta)))
      [OFace{convex, corner_sphere(ctr, r, K.vtx(K.body_vs(b), v), ts, v), 2, [OLoop{True{}, chain3(corner_sgs(ts, b, v, Nil{}))}]}]
    case C.CorTri{v, pl, _, qs}:
      C.Pl{o, n} = pl
      Cx{b, _, _, _, ts, _} = cx
      +x = G.normalize(G.sub(nth_v(qs, 1n), nth_v(qs, 0n)))
      [OFace{True{}, A.Plane{o, n, x}, 2, [OLoop{True{}, chain3(corner_sgs(ts, b, v, Nil{}))}]}]
    case C.CorNo{_, _, _}:
      Nil{}

def corner_faces(+cs: List<&2, C.Cor>, +cx: Cx, +acc: List<&2, OFace>) -> List<&2, OFace>:
  match cs:
    case Nil{}:
      List.reverse(&2, OFace, acc)
    case c <> t:
      corner_faces(t, cx, C.rev_onto(OFace, corner_face(c, cx), acc))

# ---------------------------------------------------------------------------
# Unify: coplanar plane fragments joined by smooth edges become one face.

def cop_edge.i(+ok: Bool, +fs: List<&2, J.Face>, +ff: U32, +fr: U32) -> Bool:
  match ok:
    case True{}:
      Bool.and(U32.is_ne(ff, fr), C.same_pf(fs, ff, fr))
    case False{}:
      False{}

def cop_add(+i: K.Inc, +fs: List<&2, J.Face>, +acc: List<&2, Pr>) -> List<&2, Pr>:
  K.Inc{_, _, ff, fr} = i
  Bool.pick(List<&2, Pr>, cop_edge.i(K.inc_ok(i), fs, ff, fr), Pr{ff, fr} <> acc, acc)

def cop_pairs(+n: Nat, +fs: List<&2, J.Face>, +e: U32, +acc: List<&2, Pr>) -> List<&2, Pr>:
  match n:
    case 0n:
      List.reverse(&2, Pr, acc)
    case 1n+m:
      cop_pairs(m, fs, (e + 1 : U32), cop_add(K.incidence(fs, e), fs, acc))

def nbrs(+ps: List<&2, Pr>, +set: List<&2, U32>, +acc: List<&2, U32>) -> List<&2, U32>:
  match ps:
    case Nil{}:
      acc
    case Pr{a, b} <> t:
      nbrs(t, set, K.push_if(K.mem(set, b), a, K.push_if(K.mem(set, a), b, acc)))

def closure.step(+done: Bool, +ps: List<&2, Pr>, +set: List<&2, U32>) -> List<&2, U32>:
  match done:
    case True{}:
      set
    case False{}:
      K.sort_uniq(List.append(&2, U32, set, nbrs(ps, set, Nil{})))

# The faces reachable from set through the pairs (sorted).
def closure(+fuel: Nat, +ps: List<&2, Pr>, +set: List<&2, U32>, +done: Bool) -> List<&2, U32>:
  match fuel:
    case 0n:
      set
    case 1n+f:
      +next = closure.step(done, ps, set)
      closure(f, ps, next, U32.is_eq(K.count(U32, next), K.count(U32, set)))

# A support face after unify: its input faces and its loops (input uses).
type MF is Data:
  MF{same: Bool, s: A.Surface, members: List<&2, U32>, loops: List<&2, J.Loop>, bad: List<&2, String>}

def use_sv(+es: List<&2, J.Edge>, +u: J.Use) -> U32:
  J.Use{e, fwd} = u
  +ed = K.edge_at(es, e)
  Bool.pick(U32, fwd, K.edge_s(ed), K.edge_e(ed))

def use_ev(+es: List<&2, J.Edge>, +u: J.Use) -> U32:
  J.Use{e, fwd} = u
  +ed = K.edge_at(es, e)
  Bool.pick(U32, fwd, K.edge_e(ed), K.edge_s(ed))

def use_edge(+u: J.Use) -> U32:
  J.Use{e, _} = u
  e

# Uses of all member faces whose edge does not join two members.
def member_uses.us(+us: List<&2, J.Use>, +fs: List<&2, J.Face>, +mem: List<&2, U32>, +acc: List<&2, J.Use>) -> List<&2, J.Use>:
  match us:
    case Nil{}:
      acc
    case u <> t:
      +both = C.all_in(B.edge_faces(fs, use_edge(u)), mem)
      member_uses.us(t, fs, mem, Bool.pick(List<&2, J.Use>, both, acc, u <> acc))

def member_uses.ls(+ls: List<&2, J.Loop>, +fs: List<&2, J.Face>, +mem: List<&2, U32>, +acc: List<&2, J.Use>) -> List<&2, J.Use>:
  match ls:
    case Nil{}:
      acc
    case J.Loop{_, us} <> t:
      member_uses.ls(t, fs, mem, member_uses.us(us, fs, mem, acc))

def face_loops(+face: J.Face) -> List<&2, J.Loop>:
  J.Face{_, _, ls} = face
  ls

def member_uses(+xs: List<&2, U32>, +fs: List<&2, J.Face>, +mem: List<&2, U32>, +acc: List<&2, J.Use>) -> List<&2, J.Use>:
  match xs:
    case Nil{}:
      List.reverse(&2, J.Use, acc)
    case f <> t:
      member_uses(t, fs, mem, member_uses.ls(face_loops(K.face_at(fs, f)), fs, mem, acc))

# Chaining the uses of a merged face into loops.
type Pick is Data:
  Pick{n: U32, hit: J.Use, rest: List<&2, J.Use>}

def pick_from(+pool: List<&2, J.Use>, +es: List<&2, J.Edge>, +v: U32, +acc: Pick) -> Pick:
  match pool:
    case Nil{}:
      Pick{n, hit, rest} = acc
      Pick{n, hit, List.reverse(&2, J.Use, rest)}
    case u <> t:
      Pick{n, hit, rest} = acc
      +m = U32.is_eq(use_sv(es, u), v)
      +first = Bool.and(m, U32.is_eq(n, 0))
      pick_from(t, es, v, Pick{Bool.pick(U32, m, (n + 1 : U32), n), Bool.pick(J.Use, first, u, hit), Bool.pick(List<&2, J.Use>, first, rest, u <> rest)})


type Ch is Data:
  Ch{loops: List<&2, List<&2, J.Use>>, cur: List<&2, J.Use>, start: U32, end: U32, pool: List<&2, J.Use>, bad: Bool}

def chain.start(+pool: List<&2, J.Use>, +es: List<&2, J.Edge>, +ls: List<&2, List<&2, J.Use>>, +bad: Bool) -> Ch:
  match pool:
    case Nil{}:
      Ch{ls, Nil{}, 0, 0, Nil{}, bad}
    case u <> t:
      Ch{ls, [u], use_sv(es, u), use_ev(es, u), t, bad}

# The use that continues the open loop: exactly one candidate, else the
# chaining is ambiguous (two regions touching at a vertex) and refused.
def chain.pick(+p: Pick, +es: List<&2, J.Edge>, +st: Ch) -> Ch:
  Pick{n, hit, rest} = p
  Ch{ls, cur, s0, _, _, bad} = st
  Bool.pick(Ch, U32.is_eq(n, 1), Ch{ls, hit <> cur, s0, use_ev(es, hit), rest, bad}, Ch{ls, Nil{}, 0, 0, Nil{}, True{}})

def chain.more(+closed: Bool, +es: List<&2, J.Edge>, +st: Ch) -> Ch:
  match closed:
    case True{}:
      Ch{ls, cur, _, _, pool, bad} = st
      Ch{List.reverse(&2, J.Use, cur) <> ls, Nil{}, 0, 0, pool, bad}
    case False{}:
      Ch{_, _, _, e0, pool, _} = st
      chain.pick(pick_from(pool, es, e0, Pick{0, J.Use{0, True{}}, Nil{}}), es, st)

def chain.open(+cur: List<&2, J.Use>, +es: List<&2, J.Edge>, +st: Ch) -> Ch:
  match cur:
    case Nil{}:
      Ch{ls, _, _, _, pool, bad} = st
      chain.start(pool, es, ls, bad)
    case _ <> _:
      Ch{_, _, s0, e0, _, _} = st
      chain.more(U32.is_eq(s0, e0), es, st)

def chain.go(+fuel: Nat, +es: List<&2, J.Edge>, +st: Ch) -> Ch:
  match fuel:
    case 0n:
      st
    case 1n+f:
      Ch{_, cur, _, _, _, _} = st
      chain.go(f, es, chain.open(cur, es, st))

# Twice the signed area a piece adds to its loop, seen along the unit n:
# ∫ p × dp · n (exact for lines, circle and ellipse arcs).
def sg_area.c(+c: A.Curve, +t0: R.Real, +t1: R.Real, +a: G.Vec3, +b: G.Vec3, +n: G.Vec3) -> R.Real:
  match c:
    case A.Line{_, _}:
      G.dot(G.cross(a, b), n)
    case A.Circle{o, nc, _, r}:
      R.add(G.dot(G.cross(o, G.sub(b, a)), n), R.mul(R.mul(K.sq(r), R.sub(t1, t0)), G.dot(nc, n)))
    case A.Ellipse{o, nc, _, ea, eb}:
      R.add(G.dot(G.cross(o, G.sub(b, a)), n), R.mul(R.mul(R.mul(ea, eb), R.sub(t1, t0)), G.dot(nc, n)))

def sg_area(+s: Sg, +n: G.Vec3) -> R.Real:
  Sg{c, t0, t1, a, b} = s
  sg_area.c(c, t0, t1, a, b, n)

def use_area(+us: List<&2, J.Use>, +b: J.Body, +n: G.Vec3, +acc: R.Real) -> R.Real:
  match us:
    case Nil{}:
      acc
    case J.Use{e, fwd} <> t:
      +s = raw_seg(b, e)
      use_area(t, b, n, R.add(acc, sg_area(Bool.pick(Sg, fwd, s, sg_rev(s)), n)))

def outer_loops(+ls: List<&2, List<&2, J.Use>>, +b: J.Body, +n: G.Vec3, +acc: List<&2, J.Loop>) -> List<&2, J.Loop>:
  match ls:
    case Nil{}:
      List.reverse(&2, J.Loop, acc)
    case us <> t:
      outer_loops(t, b, n, J.Loop{K.is_pos(use_area(us, b, n, K.zero())), us} <> acc)

def count_outer(+ls: List<&2, J.Loop>) -> U32:
  match ls:
    case Nil{}:
      0
    case J.Loop{o, _} <> t:
      (Bool.pick(U32, o, 1, 0) + count_outer(t) : U32)

def ids_txt(+xs: List<&2, U32>) -> String:
  match xs:
    case Nil{}:
      ""
    case x <> t:
      " " ++ K.show_u32(x) ++ ids_txt(t)

def merged.ch(+st: Ch, +b: J.Body, +same: Bool, +s: A.Surface, +mem: List<&2, U32>) -> MF:
  Ch{ls, cur, _, _, pool, bad} = st
  +n = K.signed(same, C.surf_pn(s))
  +loops = outer_loops(List.reverse(&2, List<&2, J.Use>, ls), b, n, Nil{})
  +open = Bool.or(bad, Bool.or(Bool.not(List.is_empty(&2, J.Use, cur)), Bool.not(List.is_empty(&2, J.Use, pool))))
  +why = "the coplanar faces" ++ ids_txt(mem) ++ " do not merge into one face with one outer boundary"
  +nbad = Bool.or(open, U32.is_ne(count_outer(loops), 1))
  MF{same, s, mem, loops, Bool.pick(List<&2, String>, nbad, [why], Nil{})}

def merged.one(+one: Bool, +b: J.Body, +mem: List<&2, U32>, +same: Bool, +s: A.Surface, +ls: List<&2, J.Loop>) -> MF:
  match one:
    case True{}:
      MF{same, s, mem, ls, Nil{}}
    case False{}:
      J.Body{_, es, fs} = b
      +us = member_uses(mem, fs, mem, Nil{})
      +fuel = U32.to_nat((K.count(J.Use, us) * 2 + 2 : U32))
      merged.ch(chain.go(fuel, es, Ch{Nil{}, Nil{}, 0, 0, us, False{}}), b, same, s, mem)

# The merged face of a group (its smallest face first).
def merged.face(+face: J.Face, +b: J.Body, +mem: List<&2, U32>) -> MF:
  J.Face{same, s, ls} = face
  merged.one(U32.is_eq(K.count(U32, mem), 1), b, mem, same, s, ls)

def merged(+b: J.Body, +mem: List<&2, U32>) -> MF:
  merged.face(K.face_at(K.body_fs(b), B.nth_u32(mem, 0n)), b, mem)

def group_of(+alone: Bool, +nf: U32, +ps: List<&2, Pr>, +f: U32) -> List<&2, U32>:
  match alone:
    case True{}:
      [f]
    case False{}:
      closure(U32.to_nat(nf), ps, [f], False{})

def in_pairs(+ps: List<&2, Pr>, +f: U32) -> Bool:
  match ps:
    case Nil{}:
      False{}
    case Pr{a, b} <> t:
      Bool.or(Bool.or(U32.is_eq(a, f), U32.is_eq(b, f)), in_pairs(t, f))

# The merge groups, each once (from its smallest face), in face order.
def groups(+n: Nat, +f: U32, +nf: U32, +ps: List<&2, Pr>, +acc: List<&2, List<&2, U32>>) -> List<&2, List<&2, U32>>:
  match n:
    case 0n:
      List.reverse(&2, List<&2, U32>, acc)
    case 1n+m:
      +grp = group_of(Bool.not(in_pairs(ps, f)), nf, ps, f)
      +keep = U32.is_eq(B.nth_u32(grp, 0n), f)
      groups(m, (f + 1 : U32), nf, ps, Bool.pick(List<&2, List<&2, U32>>, keep, grp <> acc, acc))

def merged_all(+gs: List<&2, List<&2, U32>>, +b: J.Body, +acc: List<&2, MF>) -> List<&2, MF>:
  match gs:
    case Nil{}:
      List.reverse(&2, MF, acc)
    case g <> t:
      merged_all(t, b, merged(b, g) <> acc)

# ---------------------------------------------------------------------------
# Support faces: each loop rewritten use by use

# A selected edge becomes its spring on this face (side 1 when the face uses
# the edge forward), an unselected edge keeps its curve between its moved
# ends.
def ne_bound(+nes: List<&2, Ne>, +e: U32) -> Bool:
  match nes:
    case Nil{}:
      False{}
    case Ne{b, _, _, _, _, _, grow} <> t:
      Bool.or(Bool.and(grow, U32.is_eq(b, e)), ne_bound(t, e))

def ne_q.go(+nes: List<&2, Ne>, +w: U32, +acc: Maybe<&2, G.Vec3>) -> Maybe<&2, G.Vec3>:
  match nes:
    case Nil{}:
      acc
    case Ne{_, _, _, _, x, q, grow} <> t:
      ne_q.go(t, w, Bool.pick(Maybe<&2, G.Vec3>, Bool.and(none_v(acc), Bool.and(grow, U32.is_eq(x, w))), Some{q}, acc))

def ne_q(+nes: List<&2, Ne>, +w: U32) -> G.Vec3:
  np.or(ne_q.go(nes, w, None{}), K.zero_v())

# The notch curve that replaces the bound edge e (start -> end): the line
# between the notch points at its two vertices, or the full circle through
# the notch point at its vertex (rim notch), in e's sense.
def notch_seg.c(+c: A.Curve, +b: J.Body, +e: U32, +pa: G.Vec3, +pb: G.Vec3) -> Sg:
  match c:
    case A.Circle{o, n, _, _}:
      +a = G.normalize(n)
      +ctr = K.axpy(o, G.dot(G.sub(pa, o), a), a)
      +u = G.sub(pa, ctr)
      Sg{A.Circle{ctr, K.signed(edge_sense(b, e, o, a), a), G.normalize(u), K.len(u)}, K.zero(), K.two_pi(), pa, pa}
    case _:
      Sg{A.Line{pa, G.sub(pb, pa)}, K.zero(), K.one(), pa, pb}

def notch_seg(+cx: Cx, +e: U32) -> Sg:
  Cx{b, _, _, _, _, nes} = cx
  +ed = K.edge_at(K.body_es(b), e)
  notch_seg.c(K.edge_curve(ed), b, e, ne_q(nes, K.edge_s(ed)), ne_q(nes, K.edge_e(ed)))

def rw_plain(+bound: Bool, +cx: Cx, +e: U32, +fwd: Bool) -> Sg:
  match bound:
    case True{}:
      +s = notch_seg(cx, e)
      Bool.pick(Sg, fwd, s, sg_rev(s))
    case False{}:
      +s = in_seg(cx, e)
      Bool.pick(Sg, fwd, s, sg_rev(s))

def rw_use.m(+m: Maybe<&2, L.Stripe>, +cx: Cx, +e: U32, +fwd: Bool) -> Sg:
  match m:
    case Some{st}:
      spring(st, cx, Bool.pick(U32, fwd, 1, 2), fwd)
    case None{}:
      Cx{_, _, _, _, _, nes} = cx
      rw_plain(ne_bound(nes, e), cx, e, fwd)

def rw_use(+cx: Cx, +u: J.Use) -> Sg:
  Cx{_, _, _, ss, _, _} = cx
  J.Use{e, fwd} = u
  rw_use.m(C.stripe_of(ss, e), cx, e, fwd)

def rw_uses(+us: List<&2, J.Use>, +cx: Cx, +acc: List<&2, Sg>) -> List<&2, Sg>:
  match us:
    case Nil{}:
      List.reverse(&2, Sg, acc)
    case u <> t:
      rw_uses(t, cx, rw_use(cx, u) <> acc)

def use_ends(+us: List<&2, J.Use>, +es: List<&2, J.Edge>, +acc: List<&2, U32>) -> List<&2, U32>:
  match us:
    case Nil{}:
      List.reverse(&2, U32, acc)
    case u <> t:
      use_ends(t, es, use_ev(es, u) <> acc)

def rot1(+xs: List<&2, Sg>) -> List<&2, Sg>:
  match xs:
    case Nil{}:
      Nil{}
    case h <> t:
      List.append(&2, Sg, t, [h])

# A piece, the next piece of the loop, and the vertex between them.
type Jn is Data:
  Jn{s: Sg, n: Sg, v: U32}

def jn_zip(+xs: List<&2, Sg>, +ys: List<&2, Sg>, +vs: List<&2, U32>, +acc: List<&2, Jn>) -> List<&2, Jn>:
  match xs:
    case Nil{}:
      List.reverse(&2, Jn, acc)
    case x <> xt:
      match ys:
        case Nil{}:
          List.reverse(&2, Jn, acc)
        case y <> yt:
          match vs:
            case Nil{}:
              List.reverse(&2, Jn, acc)
            case v <> vt:
              jn_zip(xt, yt, vt, Jn{x, y, v} <> acc)

# The curve c from a (t0) to b (t1), when it joins pa to pb either way round.
def conn.arc(+here: Bool, +arc: C.Arc, +a: G.Vec3, +b: G.Vec3, +pa: G.Vec3, +pb: G.Vec3, +acc: Maybe<&2, Sg>) -> Maybe<&2, Sg>:
  C.Arc{c, t0, t1} = arc
  +f = Bool.and(here, Bool.and(same_pt(a, pa), same_pt(b, pb)))
  +r = Bool.and(here, Bool.and(same_pt(b, pa), same_pt(a, pb)))
  Bool.pick(Maybe<&2, Sg>, f, Some{Sg{c, t0, t1, a, b}}, Bool.pick(Maybe<&2, Sg>, r, Some{Sg{c, t1, t0, b, a}}, acc))

# A setback mitre's trim curve (pm -> p2 on side 2, p1 -> pm on side 1): the
# edge it adds to the shorter blend's outer face.
def conn.tr(+here: Bool, +tr: C.Tr, +p1: G.Vec3, +p2: G.Vec3, +pa: G.Vec3, +pb: G.Vec3, +acc: Maybe<&2, Sg>) -> Maybe<&2, Sg>:
  match tr:
    case C.TrNo{}:
      acc
    case C.Tr{_, side, pm, _, tarc}:
      +two = U32.is_eq(side, 2)
      conn.arc(here, tarc, Bool.pick(G.Vec3, two, pm, p1), Bool.pick(G.Vec3, two, p2, pm), pa, pb, acc)

# The curve at v that joins pa to pb (either way round): a cap curve, or the
# trim curve of a setback mitre.
def conn(+ts: List<&2, C.Tip>, +v: U32, +pa: G.Vec3, +pb: G.Vec3, +acc: Maybe<&2, Sg>) -> Maybe<&2, Sg>:
  match ts:
    case Nil{}:
      acc
    case C.Tip{_, tv, kind, _, _, p1, _, p2, _, arc, tr} <> t:
      +here = Bool.and(C.is_none(Sg, acc), U32.is_eq(tv, v))
      +m = conn.arc(Bool.and(here, U32.is_eq(kind, 0)), arc, p1, p2, pa, pb, acc)
      conn(t, v, pa, pb, conn.tr(Bool.and(here, U32.is_eq(kind, 1)), tr, p1, p2, pa, pb, m))
    case _ <> t:
      conn(t, v, pa, pb, acc)

type Lb is Data:
  Lb{sgs: List<&2, Sg>, bad: List<&2, String>, cap: Bool}

def rw_gap.m(+m: Maybe<&2, Sg>, +v: U32, +acc: Lb) -> Lb:
  match m:
    case Some{s}:
      Lb{sgs, bad, _} = acc
      Lb{s <> sgs, bad, True{}}
    case None{}:
      Lb{sgs, bad, cap} = acc
      Lb{sgs, ("the trimmed boundary of a support face does not close at vertex " ++ K.show_u32(v) ++ " (no cap curve joins its ends)") <> bad, cap}

def rw_gap(+gap: Bool, +ts: List<&2, C.Tip>, +v: U32, +pa: G.Vec3, +pb: G.Vec3, +acc: Lb) -> Lb:
  match gap:
    case False{}:
      acc
    case True{}:
      rw_gap.m(conn(ts, v, pa, pb, None{}), v, acc)

def rw_join(+js: List<&2, Jn>, +ts: List<&2, C.Tip>, +acc: Lb) -> Lb:
  match js:
    case Nil{}:
      Lb{sgs, bad, cap} = acc
      Lb{List.reverse(&2, Sg, sgs), bad, cap}
    case Jn{s, n, v} <> t:
      Lb{sgs, bad, cap} = acc
      +pa = sg_b(s)
      +pb = sg_a(n)
      rw_join(t, ts, rw_gap(Bool.not(same_pt(pa, pb)), ts, v, pa, pb, Lb{s <> sgs, bad, cap}))

def rw_loop(+cx: Cx, +us: List<&2, J.Use>) -> Lb:
  Cx{b, _, _, _, ts, _} = cx
  +raws = rw_uses(us, cx, Nil{})
  rw_join(jn_zip(raws, rot1(raws), use_ends(us, K.body_es(b), Nil{}), Nil{}), ts, Lb{Nil{}, Nil{}, False{}})

type Rw is Data:
  Rw{ls: List<&2, OLoop>, bad: List<&2, String>, cap: Bool}

def rw_add(+lb: Lb, +outer: Bool, +acc: Rw) -> Rw:
  Lb{sgs, lbad, lcap} = lb
  Rw{os, bad, cap} = acc
  +lv = live(sgs, Nil{})
  +os2 = Bool.pick(List<&2, OLoop>, List.is_empty(&2, Sg, lv), os, OLoop{outer, lv} <> os)
  Rw{os2, List.append(&2, String, bad, lbad), Bool.or(cap, lcap)}

def rw_loops(+ls: List<&2, J.Loop>, +cx: Cx, +acc: Rw) -> Rw:
  match ls:
    case Nil{}:
      Rw{os, bad, cap} = acc
      Rw{List.reverse(&2, OLoop, os), bad, cap}
    case J.Loop{outer, us} <> t:
      rw_loops(t, cx, rw_add(rw_loop(cx, us), outer, acc))

def count_oouter(+ls: List<&2, OLoop>) -> U32:
  match ls:
    case Nil{}:
      0
    case OLoop{o, _} <> t:
      (Bool.pick(U32, o, 1, 0) + count_oouter(t) : U32)

type Fb is Data:
  Fb{fs: List<&2, OFace>, bad: List<&2, String>}

def support.rw(+rw: Rw, +same: Bool, +s: A.Surface, +mem: List<&2, U32>, +bad0: List<&2, String>) -> Fb:
  Rw{os, bad, cap} = rw
  +none = List.is_empty(&2, OLoop, os)
  +obad = Bool.and(Bool.not(none), U32.is_ne(count_oouter(os), 1))
  +why = "face" ++ ids_txt(mem) ++ " loses its outer boundary in the trim"
  +fs = Bool.pick(List<&2, OFace>, none, Nil{}, [OFace{same, s, Bool.pick(U32, cap, 3, 0), os}])
  Fb{fs, List.append(&2, String, bad0, List.append(&2, String, bad, Bool.pick(List<&2, String>, obad, [why], Nil{})))}

def support.gone(+gone: Bool, +m: MF, +cx: Cx) -> Fb:
  match gone:
    case True{}:
      MF{_, _, mem, _, bad0} = m
      +frag = U32.is_ne(K.count(U32, mem), 1)
      Fb{Nil{}, List.append(&2, String, bad0, Bool.pick(List<&2, String>, frag, [("the consumed face is one of the coplanar fragments" ++ ids_txt(mem))], Nil{}))}
    case False{}:
      MF{same, s, mem, loops, bad0} = m
      support.rw(rw_loops(loops, cx, Rw{Nil{}, Nil{}, False{}}), same, s, mem, bad0)

def any_in(+xs: List<&2, U32>, +ys: List<&2, U32>) -> Bool:
  match xs:
    case Nil{}:
      False{}
    case x <> t:
      Bool.or(K.mem(ys, x), any_in(t, ys))

def mf_mem(+m: MF) -> List<&2, U32>:
  MF{_, _, mem, _, _} = m
  mem

def fb_add(+r: Fb, +acc: Fb) -> Fb:
  Fb{fs1, bad1} = r
  Fb{fs, bad} = acc
  Fb{C.rev_onto(OFace, fs1, fs), List.append(&2, String, bad, bad1)}

def support_faces(+ms: List<&2, MF>, +cx: Cx, +eaten: List<&2, U32>, +acc: Fb) -> Fb:
  match ms:
    case Nil{}:
      Fb{fs, bad} = acc
      Fb{List.reverse(&2, OFace, fs), bad}
    case m <> t:
      support_faces(t, cx, eaten, fb_add(support.gone(any_in(mf_mem(m), eaten), m, cx), acc))

def eaten_ids(+es: List<&2, C.Eat>, +acc: List<&2, U32>) -> List<&2, U32>:
  match es:
    case Nil{}:
      acc
    case C.Eat{f, _, _, _} <> t:
      eaten_ids(t, f <> acc)
    case _ <> t:
      eaten_ids(t, acc)

# ---------------------------------------------------------------------------
# Assembly: vertices by position, edges by pairing

# Lines are written with a unit direction and arc-length parameters (the
# STEP serializer writes LINE directions as unit vectors of magnitude 1).
def unit_line.c(+c: A.Curve, +t0: R.Real, +t1: R.Real, +a: G.Vec3, +b: G.Vec3) -> Sg:
  match c:
    case A.Line{o, d}:
      +l = K.len(d)
      Sg{A.Line{o, G.scale(d, R.div(K.one(), l))}, R.mul(t0, l), R.mul(t1, l), a, b}
    case _:
      Sg{c, t0, t1, a, b}

def unit_line(+s: Sg) -> Sg:
  Sg{c, t0, t1, a, b} = s
  unit_line.c(c, t0, t1, a, b)

def flat.sgs(+xs: List<&2, Sg>, +acc: List<&2, Sg>) -> List<&2, Sg>:
  match xs:
    case Nil{}:
      acc
    case x <> t:
      flat.sgs(t, unit_line(x) <> acc)

def flat.loops(+ls: List<&2, OLoop>, +acc: List<&2, Sg>) -> List<&2, Sg>:
  match ls:
    case Nil{}:
      acc
    case OLoop{_, sgs} <> t:
      flat.loops(t, flat.sgs(sgs, acc))

# Every piece, in face / loop / piece order.
def flat(+fs: List<&2, OFace>, +acc: List<&2, Sg>) -> List<&2, Sg>:
  match fs:
    case Nil{}:
      List.reverse(&2, Sg, acc)
    case OFace{_, _, _, ls} <> t:
      flat(t, flat.loops(ls, acc))

type Pk is Data:
  Pk{i: U32, p: G.Vec3}

def pks(+xs: List<&2, Sg>, +i: U32, +acc: List<&2, Pk>) -> List<&2, Pk>:
  match xs:
    case Nil{}:
      acc
    case s <> t:
      pks(t, (i + 1 : U32), Pk{(i * 2 + 1 : U32), sg_b(s)} <> Pk{(i * 2 : U32), sg_a(s)} <> acc)

def pk_le(a: Pk, b: Pk) -> Bool:
  Pk{ia, pa} = a
  G.V3{+xa, _, _} = pa
  Pk{ib, pb} = b
  G.V3{+xb, _, _} = pb
  Bool.or(R.less(xa, xb), Bool.and(R.equal(xa, xb), U32.is_le(ia, ib)))

def pr_le(a: Pr, b: Pr) -> Bool:
  Pr{x, _} = a
  Pr{y, _} = b
  U32.is_le(x, y)

type Win is Data:
  Win{id: U32, p: G.Vec3}

type Sw is Data:
  Sw{win: List<&2, Win>, next: U32, asg: List<&2, Pr>, verts: List<&2, G.Vec3>}

def px(+p: G.Vec3) -> R.Real:
  G.V3{x, _, _} = p
  x

# Window entries whose x is still within the band of x.
def win_keep(+ws: List<&2, Win>, +x: R.Real, +band: R.Real, +acc: List<&2, Win>) -> List<&2, Win>:
  match ws:
    case Nil{}:
      List.reverse(&2, Win, acc)
    case Win{id, p} <> t:
      +keep = Bool.not(R.less(px(p), R.sub(x, band)))
      win_keep(t, x, band, Bool.pick(List<&2, Win>, keep, Win{id, p} <> acc, acc))

def win_find(+ws: List<&2, Win>, +p: G.Vec3, +acc: U32) -> U32:
  match ws:
    case Nil{}:
      acc
    case Win{id, q} <> t:
      win_find(t, p, Bool.pick(U32, Bool.and(U32.is_eq(acc, C.none_u32()), same_pt(p, q)), id, acc))

def sweep.add(+new: Bool, +i: U32, +p: G.Vec3, +id: U32, +st: Sw) -> Sw:
  match new:
    case True{}:
      Sw{win, next, asg, verts} = st
      Sw{Win{next, p} <> win, (next + 1 : U32), Pr{i, next} <> asg, p <> verts}
    case False{}:
      Sw{win, next, asg, verts} = st
      Sw{win, next, Pr{i, id} <> asg, verts}

# End points in x order; each is merged with an earlier one within the
# coincidence band (same_pt; only points whose x lies within twice the band
# can be).
def sweep(+ps: List<&2, Pk>, +st: Sw) -> Sw:
  match ps:
    case Nil{}:
      st
    case Pk{i, p} <> t:
      Sw{win, next, asg, verts} = st
      +w2 = win_keep(win, px(p), R.mul(R.from_f32(2.0), D.ceps(D.mag(p))), Nil{})
      +id = win_find(w2, p, C.none_u32())
      sweep(t, sweep.add(U32.is_eq(id, C.none_u32()), i, p, id, Sw{w2, next, asg, verts}))

def pr_bs(+xs: List<&2, Pr>, +acc: List<&2, U32>) -> List<&2, U32>:
  match xs:
    case Nil{}:
      List.reverse(&2, U32, acc)
    case Pr{_, b} <> t:
      pr_bs(t, b <> acc)

type Sk is Data:
  Sk{key: U32, i: U32, va: U32, vb: U32, q1: G.Vec3, q3: G.Vec3, s: Sg}

def quarter() -> R.Real:
  R.from_f32(0.25)

def three_q() -> R.Real:
  R.from_f32(0.75)

def sks(+xs: List<&2, Sg>, +vids: List<&2, U32>, +i: U32, +acc: List<&2, Sk>) -> List<&2, Sk>:
  match xs:
    case Nil{}:
      List.reverse(&2, Sk, acc)
    case s <> t:
      match vids:
        case va <> vb <> vt:
          +lo = Bool.pick(U32, U32.is_le(va, vb), va, vb)
          +hi = Bool.pick(U32, U32.is_le(va, vb), vb, va)
          sks(t, vt, (i + 1 : U32), Sk{(lo * 65536 + hi : U32), i, va, vb, sg_at(s, quarter()), sg_at(s, three_q()), s} <> acc)
        case _:
          List.reverse(&2, Sk, acc)

def sk_le(a: Sk, b: Sk) -> Bool:
  Sk{+ka, ia, _, _, _, _, _} = a
  Sk{+kb, ib, _, _, _, _, _} = b
  Bool.or(U32.is_lt(ka, kb), Bool.and(U32.is_eq(ka, kb), U32.is_le(ia, ib)))

def sk_key(+x: Sk) -> U32:
  Sk{k, _, _, _, _, _, _} = x
  k

def near_q(+p: G.Vec3, +q: G.Vec3) -> Bool:
  R.less(K.dist(p, q), R.max(tol_pair(), D.ceps(R.max(D.mag(p), D.mag(q)))))

# y runs back over x: reversed vertices, the same curve (quarter points).
def sk_match(+x: Sk, +y: Sk) -> Bool:
  Sk{_, _, xa, xb, x1, x3, _} = x
  Sk{_, _, ya, yb, y1, y3, _} = y
  Bool.and(Bool.and(U32.is_eq(xa, yb), U32.is_eq(xb, ya)), Bool.and(near_q(x1, y3), near_q(x3, y1)))

type SkPick is Data:
  SkPick{hit: Maybe<&2, Sk>, rest: List<&2, Sk>}

def sk_pick(+ys: List<&2, Sk>, +x: Sk, +acc: SkPick) -> SkPick:
  match ys:
    case Nil{}:
      SkPick{hit, rest} = acc
      SkPick{hit, List.reverse(&2, Sk, rest)}
    case y <> t:
      SkPick{hit, rest} = acc
      +take = Bool.and(C.is_none(Sk, hit), sk_match(x, y))
      sk_pick(t, x, SkPick{Bool.pick(Maybe<&2, Sk>, take, Some{y}, hit), Bool.pick(List<&2, Sk>, take, rest, y <> rest)})

# A paired edge: its first piece (index i, vertices, curve) and the second.
type Pe is Data:
  Pe{i: U32, j: U32, va: U32, vb: U32, s: Sg}

type Gp is Data:
  Gp{pairs: List<&2, Pe>, bad: List<&2, String>}

type Gs is Data:
  Gs{rest: List<&2, Sk>, acc: Gp}

def w_pt(+p: G.Vec3) -> String:
  G.V3{x, y, z} = p
  "(" ++ K.show_dec(x) ++ ", " ++ K.show_dec(y) ++ ", " ++ K.show_dec(z) ++ ")"

def grp.m(+hit: Maybe<&2, Sk>, +rest: List<&2, Sk>, +x: Sk, +acc: Gp) -> Gs:
  match hit:
    case Some{y}:
      Sk{_, j, _, _, _, _, _} = y
      Sk{_, i, va, vb, _, _, s} = x
      Gp{ps, bad} = acc
      Gs{rest, Gp{Pe{i, j, va, vb, s} <> ps, bad}}
    case None{}:
      Sk{_, _, _, _, _, _, s} = x
      Gp{ps, bad} = acc
      Gs{rest, Gp{ps, ("an edge piece from " ++ w_pt(sg_a(s)) ++ " to " ++ w_pt(sg_b(s)) ++ " has no partner (the shell would be open)") <> bad}}

def grp.step.p(+p: SkPick, +x: Sk, +acc: Gp) -> Gs:
  SkPick{hit, rest} = p
  grp.m(hit, rest, x, acc)

def grp.step(+xs: List<&2, Sk>, +acc: Gp) -> Gs:
  match xs:
    case Nil{}:
      Gs{Nil{}, acc}
    case x <> t:
      grp.step.p(sk_pick(t, x, SkPick{None{}, Nil{}}), x, acc)

def grp.pair(+fuel: Nat, +g: Gs) -> Gp:
  match fuel:
    case 0n:
      Gs{_, acc} = g
      acc
    case 1n+f:
      Gs{rest, acc} = g
      grp.pair(f, grp.step(rest, acc))

def flush(+cur: List<&2, Sk>, +acc: Gp) -> Gp:
  grp.pair(List.length(&2, Sk, cur), Gs{List.reverse(&2, Sk, cur), acc})

type Sc is Data:
  Sc{cur: List<&2, Sk>, key: U32, acc: Gp}

def scan.s(+same: Bool, +x: Sk, +k: U32, +cur: List<&2, Sk>, +acc: Gp) -> Sc:
  match same:
    case True{}:
      Sc{x <> cur, k, acc}
    case False{}:
      Sc{[x], k, flush(cur, acc)}

def scan.next(+x: Sk, +st: Sc) -> Sc:
  Sc{cur, key, acc} = st
  +k = sk_key(x)
  scan.s(U32.is_eq(k, key), x, k, cur, acc)

# Pieces sorted by vertex pair: each group of equal pairs is matched.
def scan(+xs: List<&2, Sk>, +st: Sc) -> Gp:
  match xs:
    case Nil{}:
      Sc{cur, _, acc} = st
      flush(cur, acc)
    case x <> t:
      scan(t, scan.next(x, st))

def pe_le(a: Pe, b: Pe) -> Bool:
  Pe{x, _, _, _, _} = a
  Pe{y, _, _, _, _} = b
  U32.is_le(x, y)

# Every piece's edge and direction, in piece order.
type Eu is Data:
  Eu{i: U32, e: U32, fwd: Bool}

def eu_le(a: Eu, b: Eu) -> Bool:
  Eu{x, _, _} = a
  Eu{y, _, _} = b
  U32.is_le(x, y)

def eus(+ps: List<&2, Pe>, +e: U32, +acc: List<&2, Eu>) -> List<&2, Eu>:
  match ps:
    case Nil{}:
      acc
    case Pe{i, j, _, _, _} <> t:
      eus(t, (e + 1 : U32), Eu{j, e, False{}} <> Eu{i, e, True{}} <> acc)

# ---------------------------------------------------------------------------
# Result text (reals as F32x2 words)

def w_real(+r: R.Real) -> String:
  R.Real{hi, lo} = r
  K.show_u32(F32.bits(hi)) ++ " " ++ K.show_u32(F32.bits(lo))

def w_vec(+v: G.Vec3) -> String:
  G.V3{x, y, z} = v
  w_real(x) ++ " " ++ w_real(y) ++ " " ++ w_real(z)

def w_curve(+c: A.Curve) -> String:
  match c:
    case A.Line{o, d}:
      "line " ++ w_vec(o) ++ " " ++ w_vec(d)
    case A.Circle{o, n, x, r}:
      "circle " ++ w_vec(o) ++ " " ++ w_vec(n) ++ " " ++ w_vec(x) ++ " " ++ w_real(r)
    case A.Ellipse{o, n, x, a, b}:
      "ellipse " ++ w_vec(o) ++ " " ++ w_vec(n) ++ " " ++ w_vec(x) ++ " " ++ w_real(a) ++ " " ++ w_real(b)

def w_surf(+s: A.Surface) -> String:
  match s:
    case A.Plane{o, n, x}:
      "plane " ++ w_vec(o) ++ " " ++ w_vec(n) ++ " " ++ w_vec(x)
    case A.Cylinder{o, a, x, r}:
      "cylinder " ++ w_vec(o) ++ " " ++ w_vec(a) ++ " " ++ w_vec(x) ++ " " ++ w_real(r)
    case A.Cone{o, a, x, r, ang}:
      "cone " ++ w_vec(o) ++ " " ++ w_vec(a) ++ " " ++ w_vec(x) ++ " " ++ w_real(r) ++ " " ++ w_real(ang)
    case A.Sphere{o, a, x, r}:
      "sphere " ++ w_vec(o) ++ " " ++ w_vec(a) ++ " " ++ w_vec(x) ++ " " ++ w_real(r)
    case A.Torus{o, a, x, big, small}:
      "torus " ++ w_vec(o) ++ " " ++ w_vec(a) ++ " " ++ w_vec(x) ++ " " ++ w_real(big) ++ " " ++ w_real(small)

def w_bool(+b: Bool) -> String:
  Bool.pick(String, b, "1", "0")

def role_word(+r: U32) -> String:
  match r:
    case 0:
      "support"
    case 1:
      "blend"
    case 2:
      "corner"
    case _:
      "cap"

# Text pieces are collected last-first and joined from the back, so each
# character is copied once.
def cat(+xs: List<&2, String>, +acc: String) -> String:
  match xs:
    case Nil{}:
      acc
    case x <> t:
      cat(t, x ++ acc)

def w_verts(+vs: List<&2, G.Vec3>, +org: G.Vec3, +acc: List<&2, String>) -> List<&2, String>:
  match vs:
    case Nil{}:
      acc
    case v <> t:
      w_verts(t, org, ("v " ++ w_vec(Fr.mv(v, org)) ++ "\n") <> acc)

def w_edges(+ps: List<&2, Pe>, +org: G.Vec3, +acc: List<&2, String>) -> List<&2, String>:
  match ps:
    case Nil{}:
      acc
    case Pe{_, _, va, vb, s} <> t:
      Sg{c, t0, t1, _, _} = s
      +up = R.less(t0, t1)
      +line = "e " ++ K.show_u32(va) ++ " " ++ K.show_u32(vb) ++ " " ++ w_curve(Fr.mv_curve(c, org)) ++ " " ++ w_bool(up) ++ " 1 " ++ w_real(K.pick_r(up, t0, t1)) ++ " " ++ w_real(K.pick_r(up, t1, t0)) ++ "\n"
      w_edges(t, org, line <> acc)

type Wl is Data:
  Wl{text: String, rest: List<&2, Eu>}

def w_uses(+n: Nat, +us: List<&2, Eu>, +acc: String) -> Wl:
  match n:
    case 0n:
      Wl{acc, us}
    case 1n+m:
      match us:
        case Nil{}:
          Wl{acc, Nil{}}
        case Eu{_, e, fwd} <> t:
          w_uses(m, t, acc ++ " " ++ K.show_u32(e) ++ " " ++ w_bool(fwd))

def w_loop(+outer: Bool, +sgs: List<&2, Sg>, +st: Wl) -> Wl:
  Wl{acc, us} = st
  +n = List.length(&2, Sg, sgs)
  w_uses(n, us, acc ++ " l " ++ w_bool(outer) ++ " " ++ K.show_u32(U32.from_nat(n)))

def w_loops(+ls: List<&2, OLoop>, +st: Wl) -> Wl:
  match ls:
    case Nil{}:
      st
    case OLoop{outer, sgs} <> t:
      w_loops(t, w_loop(outer, sgs, st))

type Wf is Data:
  Wf{us: List<&2, Eu>, acc: List<&2, String>}

def w_face.l(+w: Wl, +same: Bool, +s: A.Surface, +role: U32, +nl: U32, +org: G.Vec3, +acc: List<&2, String>) -> Wf:
  Wl{txt, rest} = w
  Wf{rest, ("f " ++ w_bool(same) ++ " " ++ w_surf(Fr.mv_surf(s, org)) ++ " " ++ role_word(role) ++ " 0 0 " ++ K.show_u32(nl) ++ txt ++ "\n") <> acc}

def w_face(+f: OFace, +org: G.Vec3, +st: Wf) -> Wf:
  OFace{same, s, role, ls} = f
  Wf{us, acc} = st
  w_face.l(w_loops(ls, Wl{"", us}), same, s, role, K.count(OLoop, ls), org, acc)

def w_faces(+fs: List<&2, OFace>, +org: G.Vec3, +st: Wf) -> Wf:
  match fs:
    case Nil{}:
      st
    case f <> t:
      w_faces(t, org, w_face(f, org, st))

def wf_acc(+w: Wf) -> List<&2, String>:
  Wf{_, acc} = w
  acc

# ---------------------------------------------------------------------------
# The surgery

def head_str(+xs: List<&2, String>) -> String:
  match xs:
    case Nil{}:
      "?"
    case x <> _:
      x

# The sliver net (docs/fillet-plan.md §8 step 3): no two vertices of the
# result closer than the modelling tolerance. Vertices sorted by x; each is
# compared with the following ones while their x lies within tau.
def win(+qs: List<&2, G.Vec3>, +p: G.Vec3, +acc: R.Real, +done: Bool) -> R.Real:
  match qs:
    case Nil{}:
      acc
    case q <> t:
      match done:
        case True{}:
          acc
        case False{}:
          +dx = R.sub(px(q), px(p))
          +d2 = G.dot(G.sub(q, p), G.sub(q, p))
          win(t, p, R.min(acc, d2), Bool.not(R.less(dx, D.tau())))

def gaps(+ps: List<&2, G.Vec3>, +acc: R.Real) -> R.Real:
  match ps:
    case Nil{}:
      acc
    case p <> t:
      gaps(t, win(t, p, acc, False{}))

def v_le(a: G.Vec3, b: G.Vec3) -> Bool:
  R.less(px(a), R.add(px(b), K.zero()))

def maxmag(+ps: List<&2, G.Vec3>, +acc: R.Real) -> R.Real:
  match ps:
    case Nil{}:
      acc
    case p <> t:
      maxmag(t, R.max(acc, D.mag(p)))

def assemble.w(+ok: Bool, +org: G.Vec3, +fs: List<&2, OFace>, +verts: List<&2, G.Vec3>, +ps: List<&2, Pe>, +bad: List<&2, String>) -> Srg:
  match ok:
    case False{}:
      SrgNo{"not-implemented", "stage-3 surgery: " ++ head_str(bad)}
    case True{}:
      +sorted = List.sort(~Pe, ~pe_le, ps)
      +us = List.sort(~Eu, ~eu_le, eus(sorted, 0, Nil{}))
      +nv = K.count(G.Vec3, verts)
      +ne = K.count(Pe, sorted)
      +nf = K.count(OFace, fs)
      +head = "ok\nbrep " ++ K.show_u32(nv) ++ " " ++ K.show_u32(ne) ++ " " ++ K.show_u32(nf) ++ "\n"
      +body = wf_acc(w_faces(fs, org, Wf{us, w_edges(sorted, org, w_verts(verts, org, Nil{}))}))
      SrgOk{head ++ cat(body, "end\n"), nv, ne, nf}

def spacing.ok(+thin: Bool, +d: R.Real, +ok: Bool, +org: G.Vec3, +fs: List<&2, OFace>, +verts: List<&2, G.Vec3>, +ps: List<&2, Pe>, +bad: List<&2, String>) -> Srg:
  match thin:
    case True{}:
      SrgNo{"sliver", D.sliver_why("the gap between two vertices of the result", d, False{})}
    case False{}:
      assemble.w(ok, org, fs, verts, ps, bad)

def assemble.ok(+ok: Bool, +org: G.Vec3, +fs: List<&2, OFace>, +verts: List<&2, G.Vec3>, +ps: List<&2, Pe>, +bad: List<&2, String>) -> Srg:
  +d = R.sqrt(gaps(List.sort(~G.Vec3, ~v_le, verts), R.from_f32(1.0)))
  +lim = R.sub(D.tau(), D.eps_of(maxmag(verts, K.zero())))
  spacing.ok(Bool.and(ok, R.less(d, lim)), d, ok, org, fs, verts, ps, bad)


def assemble.g(+g: Gp, +org: G.Vec3, +fs: List<&2, OFace>, +verts: List<&2, G.Vec3>) -> Srg:
  Gp{ps, bad} = g
  assemble.ok(List.is_empty(&2, String, bad), org, fs, verts, ps, List.reverse(&2, String, bad))

def assemble.sw(+sw: Sw, +org: G.Vec3, +sgs: List<&2, Sg>, +fs: List<&2, OFace>) -> Srg:
  Sw{_, _, asg, verts} = sw
  +vids = pr_bs(List.sort(~Pr, ~pr_le, asg), Nil{})
  assemble.g(scan(List.sort(~Sk, ~sk_le, sks(sgs, vids, 0, Nil{})), Sc{Nil{}, C.none_u32(), Gp{Nil{}, Nil{}}}), org, fs, List.reverse(&2, G.Vec3, verts))

def assemble.go(+org: G.Vec3, +fs: List<&2, OFace>) -> Srg:
  +sgs = flat(fs, Nil{})
  assemble.sw(sweep(List.sort(~Pk, ~pk_le, pks(sgs, 0, Nil{})), Sw{Nil{}, 0, Nil{}, Nil{}}), org, sgs, fs)

# ---------------------------------------------------------------------------
# Clean-up before the edges are paired: two pieces of one line or one circle
# that meet at a vertex of valence 2 (only these two edges end there) become
# one piece. Such vertices are left where coplanar fragments were merged
# (collinear boundary edges) and where the two cap arcs of a full round meet.

# Starts per vertex: the vertex ids of all piece starts, sorted, and the ids
# that occur exactly twice (valence 2).
def evens(+xs: List<&2, U32>, +acc: List<&2, U32>) -> List<&2, U32>:
  match xs:
    case a <> _ <> t:
      evens(t, a <> acc)
    case _:
      acc

def twice.go(+xs: List<&2, U32>, +cur: U32, +n: U32, +acc: List<&2, U32>) -> List<&2, U32>:
  match xs:
    case Nil{}:
      List.reverse(&2, U32, K.push_if(U32.is_eq(n, 2), cur, acc))
    case x <> t:
      +same = U32.is_eq(x, cur)
      twice.go(t, x, Bool.pick(U32, same, (n + 1 : U32), 1), Bool.pick(List<&2, U32>, Bool.and(Bool.not(same), U32.is_eq(n, 2)), cur <> acc, acc))

def twice(+xs: List<&2, U32>) -> List<&2, U32>:
  twice.go(List.sort(~U32, ~K.le_u32, xs), C.none_u32(), 0, Nil{})

# A piece with its end vertex ids.
type Vs is Data:
  Vs{s: Sg, va: U32, vb: U32}

# Two traversal directions (end minus start) along one line, same sense.
def co_line(+d1: G.Vec3, +d2: G.Vec3) -> Bool:
  Bool.and(K.near_dir(K.len(G.cross(G.normalize(d1), G.normalize(d2)))), K.is_pos(G.dot(d1, d2)))

def sgn(+t0: R.Real, +t1: R.Real) -> R.Real:
  K.pick_r(R.less(t0, t1), K.one(), R.neg(K.one()))

# s2 continues s1 on the same line or circle (same sense), or None.
def join2.c(+c1: A.Curve, +c2: A.Curve, +s1: Sg, +s2: Sg) -> Maybe<&2, Sg>:
  match c1:
    case A.Line{_, _}:
      match c2:
        case A.Line{_, _}:
          Sg{_, _, _, a1, b1} = s1
          Sg{_, _, _, a2, b2} = s2
          Bool.pick(Maybe<&2, Sg>, co_line(G.sub(b1, a1), G.sub(b2, a2)), Some{Sg{A.Line{a1, G.sub(b2, a1)}, K.zero(), K.one(), a1, b2}}, None{})
        case _:
          None{}
    case A.Circle{o1, n1, x1, r1}:
      match c2:
        case A.Circle{o2, n2, _, r2}:
          Sg{_, u0, u1, a1, _} = s1
          Sg{_, w0, w1, _, b2} = s2
          +same = Bool.and(Bool.and(K.near_lin(K.dist(o1, o2)), K.near_lin(R.sub(r1, r2))), K.parallel(n1, n2))
          +sense = K.is_pos(R.mul(G.dot(n1, n2), R.mul(sgn(u0, u1), sgn(w0, w1))))
          +t1 = R.add(u1, R.mul(sgn(u0, u1), R.abs(R.sub(w1, w0))))
          Bool.pick(Maybe<&2, Sg>, Bool.and(same, sense), Some{Sg{A.Circle{o1, n1, x1, r1}, u0, t1, a1, b2}}, None{})
        case _:
          None{}
    case _:
      None{}

def join2.s(+m: Maybe<&2, Sg>, +va: U32, +wb: U32) -> Maybe<&2, Vs>:
  match m:
    case Some{s}:
      Some{Vs{s, va, wb}}
    case None{}:
      None{}

def join2.v(+ok: Bool, +c1: A.Curve, +c2: A.Curve, +s1: Sg, +s2: Sg, +va: U32, +wb: U32) -> Maybe<&2, Vs>:
  match ok:
    case False{}:
      None{}
    case True{}:
      join2.s(join2.c(c1, c2, s1, s2), va, wb)

def join2(+x: Vs, +y: Vs, +v2: List<&2, U32>) -> Maybe<&2, Vs>:
  Vs{s1, va, vb} = x
  Sg{c1, _, _, _, _} = s1
  Vs{s2, wa, wb} = y
  Sg{c2, _, _, _, _} = s2
  join2.v(Bool.and(U32.is_eq(vb, wa), K.mem(v2, vb)), c1, c2, s1, s2, va, wb)

def push_join(+m: Maybe<&2, Vs>, +h: Vs, +x: Vs, +rest: List<&2, Vs>) -> List<&2, Vs>:
  match m:
    case Some{j}:
      j <> rest
    case None{}:
      x <> h <> rest

# One pass along the loop (acc reversed), then the last piece with the first.
def join_run(+xs: List<&2, Vs>, +v2: List<&2, U32>, +acc: List<&2, Vs>) -> List<&2, Vs>:
  match xs:
    case Nil{}:
      List.reverse(&2, Vs, acc)
    case x <> t:
      match acc:
        case Nil{}:
          join_run(t, v2, [x])
        case h <> at:
          join_run(t, v2, push_join(join2(h, x, v2), h, x, at))

def join_wrap.m(+m: Maybe<&2, Vs>, +xs: List<&2, Vs>) -> List<&2, Vs>:
  match m:
    case Some{j}:
      j <> List.drop(&2, Vs, List.take(&2, Vs, xs, Nat.sub(List.length(&2, Vs, xs), 1n)), 1n)
    case None{}:
      xs

def vs_or(+m: Maybe<&2, Vs>, +d: Vs) -> Vs:
  match m:
    case Some{x}:
      x
    case None{}:
      d

def join_wrap(+xs: List<&2, Vs>, +v2: List<&2, U32>) -> List<&2, Vs>:
  match xs:
    case a <> _ <> _:
      join_wrap.m(join2(vs_or(List.last(&2, Vs, xs), a), a, v2), xs)
    case _:
      xs

def vs_sgs(+xs: List<&2, Vs>, +acc: List<&2, Sg>) -> List<&2, Sg>:
  match xs:
    case Nil{}:
      List.reverse(&2, Sg, acc)
    case Vs{s, _, _} <> t:
      vs_sgs(t, s <> acc)

# The pieces of a loop with their vertex ids (two ids per piece, in order).
type Vl is Data:
  Vl{xs: List<&2, Vs>, rest: List<&2, U32>}

def tag_sgs(+sgs: List<&2, Sg>, +ids: List<&2, U32>, +acc: List<&2, Vs>) -> Vl:
  match sgs:
    case Nil{}:
      Vl{List.reverse(&2, Vs, acc), ids}
    case s <> t:
      match ids:
        case a <> b <> it:
          tag_sgs(t, it, Vs{s, a, b} <> acc)
        case _:
          Vl{List.reverse(&2, Vs, acc), Nil{}}

type Jf is Data:
  Jf{ids: List<&2, U32>, acc: List<&2, OLoop>}

def join_loop.v(+vl: Vl, +outer: Bool, +v2: List<&2, U32>, +acc: List<&2, OLoop>) -> Jf:
  Vl{xs, rest} = vl
  Jf{rest, OLoop{outer, vs_sgs(join_wrap(join_run(xs, v2, Nil{}), v2), Nil{})} <> acc}

def join_loops(+ls: List<&2, OLoop>, +v2: List<&2, U32>, +st: Jf) -> Jf:
  match ls:
    case Nil{}:
      Jf{ids, acc} = st
      Jf{ids, List.reverse(&2, OLoop, acc)}
    case OLoop{outer, sgs} <> t:
      Jf{ids, acc} = st
      join_loops(t, v2, join_loop.v(tag_sgs(sgs, ids, Nil{}), outer, v2, acc))

type Jg is Data:
  Jg{ids: List<&2, U32>, fs: List<&2, OFace>}

def join_face.f(+jf: Jf, +same: Bool, +s: A.Surface, +role: U32, +fs: List<&2, OFace>) -> Jg:
  Jf{rest, ls} = jf
  Jg{rest, OFace{same, s, role, ls} <> fs}

def join_faces(+fs: List<&2, OFace>, +v2: List<&2, U32>, +st: Jg) -> Jg:
  match fs:
    case Nil{}:
      Jg{ids, acc} = st
      Jg{ids, List.reverse(&2, OFace, acc)}
    case OFace{same, s, role, ls} <> t:
      Jg{ids, acc} = st
      join_faces(t, v2, join_face.f(join_loops(ls, v2, Jf{ids, Nil{}}), same, s, role, acc))

def jg_fs(+g: Jg) -> List<&2, OFace>:
  Jg{_, fs} = g
  fs

def join.sw(+sw: Sw, +fs: List<&2, OFace>) -> List<&2, OFace>:
  Sw{_, _, asg, _} = sw
  +vids = pr_bs(List.sort(~Pr, ~pr_le, asg), Nil{})
  jg_fs(join_faces(fs, twice(evens(vids, Nil{})), Jg{vids, Nil{}}))

def join_all(+fs: List<&2, OFace>) -> List<&2, OFace>:
  +sgs = flat(fs, Nil{})
  join.sw(sweep(List.sort(~Pk, ~pk_le, pks(sgs, 0, Nil{})), Sw{Nil{}, 0, Nil{}, Nil{}}), fs)

def assemble(+bad: List<&2, String>, +org: G.Vec3, +fs: List<&2, OFace>) -> Srg:
  match bad:
    case Nil{}:
      assemble.go(org, join_all(fs))
    case w <> _:
      SrgNo{"not-implemented", "stage-3 surgery: " ++ w}

# The result B-rep of an admitted case (stripes ss, network net).
def surgery.sup(+sup: Fb, +ss: List<&2, L.Stripe>, +cs: List<&2, C.Cor>, +cx: Cx, +ms: List<&2, Mg>, +org: G.Vec3) -> Srg:
  Fb{sfs, sbad} = sup
  assemble(sbad, org, List.append(&2, OFace, sfs, List.append(&2, OFace, blend_faces(ss, cx, ms, Nil{}), corner_faces(cs, cx, Nil{}))))

# ---------------------------------------------------------------------------
# Notch ends

# The consumed support s's edge at vk other than the stripe edge k (and x).
def s_edge_at(+b: J.Body, +s: U32, +vk: U32, +k: U32, +x: U32) -> U32:
  +fe = K.face_edges(K.face_at(K.body_fs(b), s))
  C.head_or_none(C.drop_u32(C.drop_u32(B.sel_at(K.vertex_edges(K.body_es(b), vk), fe, Nil{}), k, Nil{}), x, Nil{}))

def ne_end(+b: J.Body, +ts: List<&2, C.Tip>, +k: U32, +i: U32, +s: U32, +x: U32, +vk: U32, +grow: Bool) -> Ne:
  +u = s_edge_at(b, s, vk, k, x)
  Ne{x, k, vk, u, C.far_v(b, u, vk), tip_pt(tip_at(ts, k, vk), i), grow}

def ne_open(+b: J.Body, +ts: List<&2, C.Tip>, +k: U32, +i: U32, +s: U32, +x: U32, +grow: Bool) -> List<&2, Ne>:
  +ed = K.edge_at(K.body_es(b), k)
  [ne_end(b, ts, k, i, s, x, K.edge_s(ed), grow), ne_end(b, ts, k, i, s, x, K.edge_e(ed), grow)]

def ne_face.c(+closed: Bool, +b: J.Body, +ts: List<&2, C.Tip>, +st: L.Stripe, +k: U32, +i: U32, +s: U32, +bd: U32) -> List<&2, Ne>:
  match closed:
    case True{}:
      +vk = st_edge_s(b, k)
      [Ne{bd, k, vk, C.none_u32(), st_edge_s(b, bd), closed_pt(st, i, K.vtx(K.body_vs(b), vk)), True{}}]
    case False{}:
      ne_open(b, ts, k, i, s, bd, True{})

def ne_face(+m: Maybe<&2, L.Stripe>, +b: J.Body, +ts: List<&2, C.Tip>, +k: U32, +i: U32, +s: U32, +bd: U32) -> List<&2, Ne>:
  match m:
    case Some{st}:
      match st:
        case L.St{_, _, _, _, _, _, sec, _, _, _, _, _, _, _}:
          ne_face.c(C.sec_closed(sec), b, ts, st, k, i, s, bd)
        case L.NoSt{_, _, _}:
          Nil{}
    case None{}:
      Nil{}

def nes_of(+nts: List<&2, N.Nt>, +b: J.Body, +ss: List<&2, L.Stripe>, +ts: List<&2, C.Tip>, +acc: List<&2, Ne>) -> List<&2, Ne>:
  match nts:
    case Nil{}:
      acc
    case N.NtFace{k, i, s, bd, _, _} <> t:
      nes_of(t, b, ss, ts, List.append(&2, Ne, acc, ne_face(C.stripe_of(ss, k), b, ts, k, i, s, bd)))
    case N.NtMeet{k, i, s, j, _} <> t:
      nes_of(t, b, ss, ts, List.append(&2, Ne, acc, ne_open(b, ts, k, i, s, j, False{})))
    case _ <> t:
      nes_of(t, b, ss, ts, acc)

def surgery(+sin: Sin, +ch: Bool, +r: R.Real, +net: C.Net) -> Srg:
  Sin{b, ss, nts, +org} = sin
  C.Net{ts, cs, es} = net
  +cx = {Cx{b, ch, r, ss, ts, nes_of(nts, b, ss, ts, Nil{})} : Cx}
  +fs = K.body_fs(b)
  +nf = K.count(J.Face, fs)
  +ps = cop_pairs(U32.to_nat(K.count(J.Edge, K.body_es(b))), fs, 0, Nil{})
  +mfs = merged_all(groups(U32.to_nat(nf), 0, nf, ps, Nil{}), b, Nil{})
  surgery.sup(support_faces(mfs, cx, eaten_ids(es, Nil{}), Fb{Nil{}, Nil{}}), ss, cs, cx, merges_of(es, Nil{}), org)
