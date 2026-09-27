import Base
import ../../real.bend as R
import ../../precise.bend as G
import ./job.bend as J
import ./geom.bend as K

# Stage 1 of prototype A "fillet-kpart": the per-edge ladder
# (docs/fillet/proto-kpart.md). For every selected edge:
#   classify   faces F1 (coedge along the edge) and F2, convexity, normal angle;
#   family     translation (line edge, both supports invariant along it) or
#              rotation (circle edge, both supports coaxial with it);
#   2D solve   the ball (fillet) or the setback points (chamfer) in the
#              section plane (theory §4.2, §5.2-5.3);
#   stripe     the exact blend carrier (cylinder / torus / sphere / plane /
#              cone), spine, contact (spring) points and widths.
# Anything else is refused with a typed class. No B-rep is built here.

# ---------------------------------------------------------------------------
# Edge classification (theory §1.2)

type Cls is Data:
  Cls{edge: U32, f1: U32, f2: U32, p: G.Vec3, t: G.Vec3, n1: G.Vec3, n2: G.Vec3, sin: R.Real, cos: R.Real, convex: Bool}
  ClsNo{edge: U32, cls: String, why: String}

def classify.smooth(+smooth: Bool, +e: U32, +f1: U32, +f2: U32, +p: G.Vec3, +t: G.Vec3, +n1: G.Vec3, +n2: G.Vec3, +sin: R.Real, +cos: R.Real, +convex: Bool) -> Cls:
  match smooth:
    case True{}:
      ClsNo{e, "tangent-edge", "edge " ++ K.show_u32(e) ++ " joins tangent faces (smooth edge; Onshape FILLET_FAIL_SMOOTH)"}
    case False{}:
      Cls{e, f1, f2, p, t, n1, n2, sin, cos, convex}

def classify.geo(+vs: List<&2, G.Vec3>, +es: List<&2, J.Edge>, +fs: List<&2, J.Face>, +e: U32, +f1: U32, +f2: U32) -> Cls:
  +edge = K.edge_at(es, e)
  +p = K.edge_start(vs, edge)
  +t = K.edge_tangent(edge, p)
  +n1 = K.face_normal(K.face_at(fs, f1), p)
  +n2 = K.face_normal(K.face_at(fs, f2), p)
  +cr = G.cross(n1, n2)
  +sin = K.len(cr)
  classify.smooth(K.near_dir(sin), e, f1, f2, p, t, n1, n2, sin, G.dot(n1, n2), K.is_pos(G.dot(cr, t)))

def classify.inc(+ok: Bool, +seam: Bool, +vs: List<&2, G.Vec3>, +es: List<&2, J.Edge>, +fs: List<&2, J.Face>, +e: U32, +i: K.Inc) -> Cls:
  match ok:
    case False{}:
      ClsNo{e, "invalid-input", "edge " ++ K.show_u32(e) ++ " is not used exactly once forward and once reversed"}
    case True{}:
      match seam:
        case True{}:
          ClsNo{e, "seam", "edge " ++ K.show_u32(e) ++ " is a seam"}
        case False{}:
          K.Inc{_, _, ff, fr} = i
          classify.geo(vs, es, fs, e, ff, fr)

def classify.range(+inr: Bool, +vs: List<&2, G.Vec3>, +es: List<&2, J.Edge>, +fs: List<&2, J.Face>, +e: U32) -> Cls:
  match inr:
    case False{}:
      ClsNo{e, "invalid-input", "selected edge " ++ K.show_u32(e) ++ " does not exist"}
    case True{}:
      +i = K.incidence(fs, e)
      classify.inc(K.inc_ok(i), K.inc_seam(i), vs, es, fs, e, i)

def classify(+b: J.Body, +e: U32) -> Cls:
  J.Body{vs, es, fs} = b
  classify.range(U32.is_lt(e, K.count(J.Edge, es)), vs, es, fs, e)

def cls_ok(+c: Cls) -> Bool:
  match c:
    case Cls{_, _, _, _, _, _, _, _, _, _}:
      True{}
    case ClsNo{_, _, _}:
      False{}

def cls_class(+c: Cls) -> String:
  match c:
    case Cls{_, _, _, _, _, _, _, _, _, _}:
      "ok"
    case ClsNo{_, cls, _}:
      cls

def cls_convex(+c: Cls) -> Bool:
  match c:
    case Cls{_, _, _, _, _, _, _, _, _, convex}:
      convex
    case ClsNo{_, _, _}:
      False{}

def cls_is_seam(+c: Cls) -> Bool:
  String.eq(cls_class(c), "seam")

def cls_is_smooth(+c: Cls) -> Bool:
  String.eq(cls_class(c), "tangent-edge")

# ---------------------------------------------------------------------------
# Tangent continuation at a vertex (theory §7)

# Unit tangent of edge x at its end vertex v, pointing away from v into x.
def out_tangent(+b: J.Body, +x: U32, +v: U32) -> G.Vec3:
  J.Body{vs, es, _} = b
  +edge = K.edge_at(es, x)
  K.signed(U32.is_eq(K.edge_s(edge), v), K.edge_tangent(edge, K.vtx(vs, v)))

# Do the non-closed edges x and y continue each other G1 at v?
def g1_at(+b: J.Body, +x: U32, +y: U32, +v: U32) -> Bool:
  J.Body{_, es, _} = b
  +open = Bool.and(Bool.not(K.edge_closed(K.edge_at(es, x))), Bool.not(K.edge_closed(K.edge_at(es, y))))
  Bool.and(open, K.near_dir(K.len(G.add(out_tangent(b, x, v), out_tangent(b, y, v)))))

def edge_verts(+b: J.Body, +x: U32) -> List<&2, U32>:
  J.Body{_, es, _} = b
  +edge = K.edge_at(es, x)
  [K.edge_s(edge), K.edge_e(edge)]

# Candidates y at v to extend the chain through x: G1 with x, not selected,
# a fillet-able edge (not seam, not smooth) of the same convexity.
def prop.cands(+ys: List<&2, U32>, +b: J.Body, +cur: List<&2, U32>, +x: U32, +cx: Bool, +v: U32, +acc: List<&2, U32>) -> List<&2, U32>:
  match ys:
    case Nil{}:
      acc
    case y <> t:
      +yy = y
      +cy = classify(b, yy)
      +take = Bool.and(Bool.and(Bool.not(K.mem(cur, yy)), g1_at(b, x, yy, v)), Bool.and(cls_ok(cy), Bool.not(Bool.xor(cls_convex(cy), cx))))
      prop.cands(t, b, cur, x, cx, v, K.push_if(take, yy, acc))

def prop.verts(+vs: List<&2, U32>, +b: J.Body, +cur: List<&2, U32>, +x: U32, +cx: Bool, +acc: List<&2, U32>) -> List<&2, U32>:
  match vs:
    case Nil{}:
      acc
    case v <> t:
      +vv = v
      prop.verts(t, b, cur, x, cx, prop.cands(K.vertex_edges(K.body_es(b), vv), b, cur, x, cx, vv, acc))

def prop.edges(+xs: List<&2, U32>, +b: J.Body, +cur: List<&2, U32>, +acc: List<&2, U32>) -> List<&2, U32>:
  match xs:
    case Nil{}:
      acc
    case x <> t:
      +xx = x
      +cx = cls_convex(classify(b, xx))
      prop.edges(t, b, cur, prop.verts(edge_verts(b, xx), b, cur, xx, cx, acc))

def prop.pass(+b: J.Body, +cur: List<&2, U32>) -> List<&2, U32>:
  K.sort_uniq(List.append(&2, U32, cur, prop.edges(cur, b, cur, Nil{})))

def prop.maybe(+done: Bool, +b: J.Body, +cur: List<&2, U32>) -> List<&2, U32>:
  match done:
    case True{}:
      cur
    case False{}:
      prop.pass(b, cur)

# The maximal G1 chains through the selected edges (sorted). Each pass adds
# the G1 continuations of the current set; once a pass adds nothing the
# remaining fuel only counts down.
def propagate.step(+fuel: Nat, +b: J.Body, +cur: List<&2, U32>, +done: Bool) -> List<&2, U32>:
  match fuel:
    case 0n:
      cur
    case 1n+f:
      +next = prop.maybe(done, b, cur)
      propagate.step(f, b, next, U32.is_eq(K.count(U32, next), K.count(U32, cur)))

def propagate(+b: J.Body, +sel: List<&2, U32>) -> List<&2, U32>:
  J.Body{_, es, _} = b
  propagate.step(U32.to_nat(K.count(J.Edge, es)), b, sel, False{})

# ---------------------------------------------------------------------------
# 2D primitives and the 2D solver (theory §4.2)

# A support in the section plane, through the corner point: a line with
# ball-side unit normal nu, or a circle (centre q, radius rho) with the ball
# outside it (sig) or inside it.
type Prim is Data:
  PLine{nu: K.P2}
  PCirc{q: K.P2, rho: R.Real, sig: Bool}
  PNone{}

type Sol is Data:
  Sol{c: K.P2, a: K.P2, b: K.P2}
  SolNo{cls: String, why: String}

def line_line.if(+fold: Bool, +n1: K.P2, +n2: K.P2, +e: K.P2, +r: R.Real, +den: R.Real) -> Sol:
  match fold:
    case True{}:
      SolNo{"tangent-edge", "ball-side normals are opposed (knife edge)"}
    case False{}:
      +c = K.p2_add(e, K.p2_scale(K.p2_add(n1, n2), R.div(r, den)))
      Sol{c, K.p2_sub(c, K.p2_scale(n1, r)), K.p2_sub(c, K.p2_scale(n2, r))}

# c = e + r (m1 + m2)/(1 + m1·m2): m_i·(c − e) = r, no trigonometry.
def line_line(+n1: K.P2, +n2: K.P2, +e: K.P2, +r: R.Real) -> Sol:
  +den = R.add(K.one(), K.p2_dot(n1, n2))
  line_line.if(R.less(den, K.tol_dir()), n1, n2, e, r, den)

def circ_contact(+q: K.P2, +rho: R.Real, +c: K.P2) -> K.P2:
  +v = K.p2_sub(c, q)
  K.p2_add(q, K.p2_scale(v, R.div(rho, K.p2_len(v))))

def line_circ.pick(+swap: Bool, +c: K.P2, +pl: K.P2, +pc: K.P2) -> Sol:
  match swap:
    case False{}:
      Sol{c, pl, pc}
    case True{}:
      Sol{c, pc, pl}

def line_circ.root(+nl: K.P2, +q: K.P2, +rho: R.Real, +e: K.P2, +r: R.Real, +b: R.Real, +disc: R.Real, +swap: Bool) -> Sol:
  +sq = R.sqrt(disc)
  +s1 = R.add(R.neg(b), sq)
  +s2 = R.sub(R.neg(b), sq)
  +s = K.pick_r(R.less(R.abs(s2), R.abs(s1)), s2, s1)
  +c = K.p2_add(K.p2_add(e, K.p2_scale(nl, r)), K.p2_scale(K.p2_perp(nl), s))
  line_circ.pick(swap, c, K.p2_sub(c, K.p2_scale(nl, r)), circ_contact(q, rho, c))

def line_circ.disc(+miss: Bool, +nl: K.P2, +q: K.P2, +rho: R.Real, +e: K.P2, +r: R.Real, +b: R.Real, +disc: R.Real, +swap: Bool) -> Sol:
  match miss:
    case True{}:
      SolNo{"radius-too-large", "offset line and offset circle do not meet (no spine)"}
    case False{}:
      line_circ.root(nl, q, rho, e, r, b, K.pick_r(K.is_neg(disc), K.zero(), disc), swap)

def line_circ.off(+bad: Bool, +nl: K.P2, +q: K.P2, +rho: R.Real, +e: K.P2, +r: R.Real, +big: R.Real, +swap: Bool) -> Sol:
  match bad:
    case True{}:
      SolNo{"radius-too-large", "radius " ++ K.show_sci(r) ++ " reaches the support radius " ++ K.show_sci(rho) ++ " on the ball side (curvature bound r < rho; r - rho = " ++ K.show_gap(R.sub(r, rho)) ++ ")"}
    case False{}:
      +dq = K.p2_sub(K.p2_add(e, K.p2_scale(nl, r)), q)
      +b = K.p2_dot(K.p2_perp(nl), dq)
      +disc = R.sub(K.sq(b), R.sub(K.p2_dot(dq, dq), K.sq(big)))
      line_circ.disc(R.less(disc, R.neg(K.tol_lin())), nl, q, rho, e, r, b, disc, swap)

# Line primitive nl, circle (q, rho, sig); `swap` when the circle is support 1.
def line_circ(+nl: K.P2, +q: K.P2, +rho: R.Real, +sig: Bool, +e: K.P2, +r: R.Real, +swap: Bool) -> Sol:
  +big = K.pick_r(sig, R.add(rho, r), R.sub(rho, r))
  line_circ.off(R.less(big, K.tol_lin()), nl, q, rho, e, r, big, swap)

def circ_circ.h(+miss: Bool, +q1: K.P2, +rho1: R.Real, +q2: K.P2, +rho2: R.Real, +e: K.P2, +u: K.P2, +a: R.Real, +h2: R.Real) -> Sol:
  match miss:
    case True{}:
      SolNo{"radius-too-large", "offset circles do not meet (no spine)"}
    case False{}:
      +h = R.sqrt(K.pick_r(K.is_neg(h2), K.zero(), h2))
      +base = K.p2_add(q1, K.p2_scale(u, a))
      +ca = K.p2_add(base, K.p2_scale(K.p2_perp(u), h))
      +cb = K.p2_sub(base, K.p2_scale(K.p2_perp(u), h))
      +da = K.p2_len(K.p2_sub(ca, e))
      +db = K.p2_len(K.p2_sub(cb, e))
      +c = K.pick_p2(R.less(db, da), cb, ca)
      Sol{c, circ_contact(q1, rho1, c), circ_contact(q2, rho2, c)}

def circ_circ.d(+conc: Bool, +q1: K.P2, +rho1: R.Real, +big1: R.Real, +q2: K.P2, +rho2: R.Real, +big2: R.Real, +e: K.P2, +d: R.Real) -> Sol:
  match conc:
    case True{}:
      SolNo{"invalid-input", "concentric circle supports share no edge"}
    case False{}:
      +a = R.div(R.add(K.sq(d), R.sub(K.sq(big1), K.sq(big2))), R.mul(d, R.from_f32(2.0)))
      +h2 = R.sub(K.sq(big1), K.sq(a))
      circ_circ.h(R.less(h2, R.neg(K.tol_lin())), q1, rho1, q2, rho2, e, K.p2_scale(K.p2_sub(q2, q1), R.div(K.one(), d)), a, h2)

def circ_circ.off(+bad: Bool, +q1: K.P2, +rho1: R.Real, +big1: R.Real, +q2: K.P2, +rho2: R.Real, +big2: R.Real, +e: K.P2, +r: R.Real) -> Sol:
  match bad:
    case True{}:
      SolNo{"radius-too-large", "radius " ++ K.show_sci(r) ++ " reaches a support radius on the ball side (curvature bound; offset radii " ++ K.show_sci(big1) ++ " and " ++ K.show_sci(big2) ++ ")"}
    case False{}:
      +d = K.p2_len(K.p2_sub(q2, q1))
      circ_circ.d(R.less(d, K.tol_lin()), q1, rho1, big1, q2, rho2, big2, e, d)

def circ_circ(+q1: K.P2, +rho1: R.Real, +sig1: Bool, +q2: K.P2, +rho2: R.Real, +sig2: Bool, +e: K.P2, +r: R.Real) -> Sol:
  +big1 = K.pick_r(sig1, R.add(rho1, r), R.sub(rho1, r))
  +big2 = K.pick_r(sig2, R.add(rho2, r), R.sub(rho2, r))
  circ_circ.off(Bool.or(R.less(big1, K.tol_lin()), R.less(big2, K.tol_lin())), q1, rho1, big1, q2, rho2, big2, e, r)

# The ball of radius r tangent to both primitives, in the wedge at e.
def fillet2d(+p1: Prim, +p2: Prim, +e: K.P2, +r: R.Real) -> Sol:
  match p1:
    case PLine{n1}:
      match p2:
        case PLine{n2}:
          line_line(n1, n2, e, r)
        case PCirc{q, rho, sig}:
          line_circ(n1, q, rho, sig, e, r, False{})
        case PNone{}:
          SolNo{"unsupported-surface", "support 2 has no section primitive"}
    case PCirc{q, rho, sig}:
      match p2:
        case PLine{n2}:
          line_circ(n2, q, rho, sig, e, r, True{})
        case PCirc{q2, rho2, sig2}:
          circ_circ(q, rho, sig, q2, rho2, sig2, e, r)
        case PNone{}:
          SolNo{"unsupported-surface", "support 2 has no section primitive"}
    case PNone{}:
      SolNo{"unsupported-surface", "support 1 has no section primitive"}

def prim_is_line(+p: Prim) -> Bool:
  match p:
    case PLine{_}:
      True{}
    case PCirc{_, _, _}:
      False{}
    case PNone{}:
      False{}

# Chamfer, Onshape EQUAL_OFFSETS (probe FP-a): setback d along each support
# face, measured in the section from the edge (both supports must be lines).
def chamfer2d.if(+lines: Bool, +e: K.P2, +t1: K.P2, +t2: K.P2, +d: R.Real) -> Sol:
  match lines:
    case True{}:
      Sol{e, K.p2_add(e, K.p2_scale(t1, d)), K.p2_add(e, K.p2_scale(t2, d))}
    case False{}:
      SolNo{"not-implemented", "chamfer setback along a curved section (cylinder support of a line edge)"}

def chamfer2d(+p1: Prim, +p2: Prim, +e: K.P2, +t1: K.P2, +t2: K.P2, +d: R.Real) -> Sol:
  chamfer2d.if(Bool.and(prim_is_line(p1), prim_is_line(p2)), e, t1, t2, d)

# ---------------------------------------------------------------------------
# Families and sides

# One support side of a stripe: face, surface kind, section primitive,
# in-face direction tau (unit, away from the edge), contact point, width
# (distance of the contact from the edge measured in the face).
type Side is Data:
  Side{face: U32, sk: U32, prim: Prim, tau: K.P2, p: K.P2, w: R.Real}

type Stripe is Data:
  St{edge: U32, f1: U32, f2: U32, convex: Bool, sin: R.Real, cos: R.Real, sec: K.Sec, e2: K.P2, s1: Side, s2: Side, c2: K.P2, kind: U32, surf: J.Surf, same: Bool}
  NoSt{edge: U32, cls: String, why: String}

# kind: 0 cylinder, 1 torus, 2 sphere, 3 plane, 4 cone, 5 cylinder (chamfer)
def kind_name(+k: U32) -> String:
  match k:
    case 0:
      "cylinder"
    case 1:
      "torus"
    case 2:
      "sphere"
    case 3:
      "plane"
    case 4:
      "cone"
    case _:
      "cylinder"

# Support invariant along the unit line direction d (translation family).
def trans_ok(+s: J.Surf, +d: G.Vec3) -> Bool:
  match s:
    case J.SPlane{_, n, _}:
      K.near_dir(G.dot(n, d))
    case J.SCyl{_, a, _, _}:
      K.parallel(a, d)
    case J.SCone{_, _, _, _, _}:
      False{}
    case J.SSphere{_, _, _, _}:
      False{}
    case J.STorus{_, _, _, _, _}:
      False{}

# Support invariant about the axis line (o, unit a) (rotation family).
def rot_ok(+s: J.Surf, +o: G.Vec3, +a: G.Vec3) -> Bool:
  match s:
    case J.SPlane{_, n, _}:
      K.parallel(n, a)
    case J.SCyl{so, sa, _, _}:
      Bool.and(K.parallel(sa, a), K.near_lin(K.line_dist(o, a, so)))
    case J.SCone{so, sa, _, _, _}:
      Bool.and(K.parallel(sa, a), K.near_lin(K.line_dist(o, a, so)))
    case J.SSphere{so, _, _, _}:
      K.near_lin(K.line_dist(o, a, so))
    case J.STorus{so, sa, _, _, _}:
      Bool.and(K.parallel(sa, a), K.near_lin(K.line_dist(o, a, so)))

# Section primitive of a support (ball-side normal m at the corner p).
def prim_of(+sec: K.Sec, +s: J.Surf, +m: G.Vec3, +p: G.Vec3) -> Prim:
  match sec:
    case K.Tra{_, d, _, _, _}:
      match s:
        case J.SPlane{_, _, _}:
          PLine{K.sec_dir(sec, m)}
        case J.SCyl{o, a, _, r}:
          PCirc{K.sec_pt(sec, o), r, K.is_pos(G.dot(m, K.radial(o, a, p)))}
        case _:
          PNone{}
    case K.Rot{ro, ra, _, _}:
      match s:
        case J.SSphere{o, _, _, r}:
          +q3 = o
          PCirc{K.sec_pt(sec, q3), r, K.is_pos(G.dot(m, G.sub(p, q3)))}
        case J.STorus{o, _, _, big, small}:
          +h = G.dot(ra, G.sub(o, ro))
          +q = K.p2(big, h)
          +q3 = K.sec_lift(sec, q)
          PCirc{q, small, K.is_pos(G.dot(m, G.sub(p, q3)))}
        case _:
          PLine{K.sec_dir(sec, m)}

def mk_side(+sec: K.Sec, +fs: List<&2, J.Face>, +f: U32, +m: G.Vec3, +tau3: G.Vec3, +p: G.Vec3) -> Side:
  +s = K.face_surf(K.face_at(fs, f))
  Side{f, K.surf_kind(s), prim_of(sec, s, m, p), K.p2_unit(K.sec_dir(sec, tau3)), K.sec_pt(sec, p), K.zero()}

# Width of a contact: along tau for line sections, arc length on a circle.
def side_width(+prim: Prim, +tau: K.P2, +e2: K.P2, +pc: K.P2) -> R.Real:
  match prim:
    case PCirc{q, rho, _}:
      +a = K.p2_sub(e2, q)
      +b = K.p2_sub(pc, q)
      R.mul(rho, R.atan2(R.abs(K.p2_cross(a, b)), K.p2_dot(a, b)))
    case _:
      K.p2_dot(tau, K.p2_sub(pc, e2))

def side_set(+sd: Side, +e2: K.P2, +pc: K.P2) -> Side:
  Side{f, k, prim, tau, _, _} = sd
  Side{f, k, prim, tau, pc, side_width(prim, tau, e2, pc)}

def side_prim(+sd: Side) -> Prim:
  Side{_, _, prim, _, _, _} = sd
  prim

def side_tau(+sd: Side) -> K.P2:
  Side{_, _, _, tau, _, _} = sd
  tau

def side_w(+sd: Side) -> R.Real:
  Side{_, _, _, _, _, w} = sd
  w

def side_face(+sd: Side) -> U32:
  Side{f, _, _, _, _, _} = sd
  f

def side_kind(+sd: Side) -> U32:
  Side{_, k, _, _, _, _} = sd
  k

def side_p(+sd: Side) -> K.P2:
  Side{_, _, _, _, p, _} = sd
  p

# ---------------------------------------------------------------------------
# Blend carriers

type Car is Data:
  Car{kind: U32, surf: J.Surf, same: Bool}
  CarNo{cls: String, why: String}

# Is the direction (−1, 0) from the ball centre on the short arc a -> b?
def arc_hits_axis(+c: K.P2, +pa: K.P2, +pb: K.P2) -> Bool:
  +a = K.p2_sub(pa, c)
  +b = K.p2_sub(pb, c)
  +dir = K.p2(R.neg(K.one()), K.zero())
  +ab = K.p2_cross(a, b)
  Bool.and(Bool.not(K.is_neg(R.mul(K.p2_cross(a, dir), ab))), Bool.not(K.is_neg(R.mul(K.p2_cross(dir, b), ab))))

def car.torus.if(+sphere: Bool, +cross: Bool, +dips: Bool, +ctr: G.Vec3, +a: G.Vec3, +rr: G.Vec3, +rho: R.Real, +r: R.Real, +convex: Bool) -> Car:
  match sphere:
    case True{}:
      Car{2, J.SSphere{ctr, a, rr, r}, convex}
    case False{}:
      match cross:
        case True{}:
          CarNo{"radius-too-large", "ball centre crosses the axis (torus major " ++ K.show_sci(rho) ++ " < 0: the radius exceeds the largest feasible by " ++ K.show_gap(R.neg(rho)) ++ ")"}
        case False{}:
          match dips:
            case True{}:
              CarNo{"self-intersection", "used arc of the spindle torus crosses the axis"}
            case False{}:
              Car{1, J.STorus{ctr, a, rr, rho, r}, convex}

def car.torus(+sec: K.Sec, +c: K.P2, +pa: K.P2, +pb: K.P2, +r: R.Real, +convex: Bool) -> Car:
  match sec:
    case K.Rot{o, a, rr, _}:
      +rho = K.p2_x(c)
      +ctr = K.axpy(o, K.p2_y(c), a)
      +dips = Bool.and(arc_hits_axis(c, pa, pb), R.less(R.sub(rho, r), R.neg(K.tol_lin())))
      car.torus.if(K.near_lin(rho), R.less(rho, K.zero()), dips, ctr, a, rr, rho, r, convex)
    case K.Tra{_, _, _, _, _}:
      CarNo{"invalid-input", "rotation carrier on a translation section"}

# Chamfer carrier through the two contacts; `same` orients the face away
# from the material (towards the corner for a convex edge).
def car.plane_t(+sec: K.Sec, +e2: K.P2, +pa: K.P2, +pb: K.P2, +convex: Bool) -> Car:
  match sec:
    case K.Tra{_, d, _, _, _}:
      +a3 = K.sec_lift(sec, pa)
      +n = G.normalize(G.cross(d, G.sub(K.sec_lift(sec, pb), a3)))
      +towards = K.is_pos(G.dot(n, G.sub(K.sec_lift(sec, e2), a3)))
      Car{3, J.SPlane{a3, K.signed(Bool.not(Bool.xor(towards, convex)), n), d}, True{}}
    case K.Rot{_, _, _, _}:
      CarNo{"invalid-input", "translation carrier on a rotation section"}

def car.rev.cone(+straight: Bool, +s0: J.Surf, +base: G.Vec3, +a: G.Vec3, +rr: G.Vec3, +r1: R.Real, +h1: R.Real, +pb: K.P2, +a3: G.Vec3, +corner: G.Vec3, +convex: Bool) -> Car:
  match straight:
    case True{}:
      +s = {J.SCyl{base, a, rr, r1} : J.Surf}
      +towards = K.is_pos(G.dot(K.surf_normal(s, a3), G.sub(corner, a3)))
      Car{5, s, Bool.not(Bool.xor(towards, convex))}
    case False{}:
      +ang = R.atan(R.div(R.sub(K.p2_x(pb), r1), R.sub(K.p2_y(pb), h1)))
      +s = {J.SCone{base, a, rr, r1, ang} : J.Surf}
      +towards = K.is_pos(G.dot(K.surf_normal(s, a3), G.sub(corner, a3)))
      Car{4, s, Bool.not(Bool.xor(towards, convex))}

def car.rev.flat(+flat: Bool, +straight: Bool, +base: G.Vec3, +a: G.Vec3, +rr: G.Vec3, +r1: R.Real, +h1: R.Real, +pb: K.P2, +a3: G.Vec3, +corner: G.Vec3, +convex: Bool) -> Car:
  match flat:
    case True{}:
      +towards = K.is_pos(G.dot(a, G.sub(corner, a3)))
      Car{3, J.SPlane{base, K.signed(Bool.not(Bool.xor(towards, convex)), a), rr}, True{}}
    case False{}:
      car.rev.cone(straight, J.SPlane{base, a, rr}, base, a, rr, r1, h1, pb, a3, corner, convex)

def car.rev.if(+sec: K.Sec, +flat: Bool, +straight: Bool, +e2: K.P2, +pa: K.P2, +pb: K.P2, +convex: Bool) -> Car:
  match sec:
    case K.Rot{o, a, rr, _}:
      +h1 = K.p2_y(pa)
      car.rev.flat(flat, straight, K.axpy(o, h1, a), a, rr, K.p2_x(pa), h1, pb, K.sec_lift(sec, pa), K.sec_lift(sec, e2), convex)
    case K.Tra{_, _, _, _, _}:
      CarNo{"invalid-input", "rotation carrier on a translation section"}

def car.rev(+sec: K.Sec, +e2: K.P2, +pa: K.P2, +pb: K.P2, +convex: Bool) -> Car:
  car.rev.if(sec, K.near_lin(R.sub(K.p2_y(pb), K.p2_y(pa))), K.near_lin(R.sub(K.p2_x(pb), K.p2_x(pa))), e2, pa, pb, convex)

def carrier(+chamfer: Bool, +sec: K.Sec, +e2: K.P2, +c: K.P2, +pa: K.P2, +pb: K.P2, +r: R.Real, +convex: Bool) -> Car:
  match chamfer:
    case False{}:
      match sec:
        case K.Tra{_, d, u, _, _}:
          Car{0, J.SCyl{K.sec_lift(sec, c), d, u, r}, convex}
        case K.Rot{_, _, _, _}:
          car.torus(sec, c, pa, pb, r, convex)
    case True{}:
      match sec:
        case K.Tra{_, _, _, _, _}:
          car.plane_t(sec, e2, pa, pb, convex)
        case K.Rot{_, _, _, _}:
          car.rev(sec, e2, pa, pb, convex)

# ---------------------------------------------------------------------------
# One stripe

type Task is Data:
  Task{body: J.Body, chamfer: Bool, size: R.Real}

def stripe.car(+car: Car, +edge: U32, +c: Cls, +sec: K.Sec, +e2: K.P2, +s1: Side, +s2: Side, +cc: K.P2) -> Stripe:
  match car:
    case CarNo{cls, why}:
      NoSt{edge, cls, why}
    case Car{kind, surf, same}:
      match c:
        case Cls{_, f1, f2, _, _, _, _, sin, cos, convex}:
          St{edge, f1, f2, convex, sin, cos, sec, e2, s1, s2, cc, kind, surf, same}
        case ClsNo{_, cls, why}:
          NoSt{edge, cls, why}

def stripe.wok(+inside: Bool, +t: Task, +edge: U32, +c: Cls, +sec: K.Sec, +e2: K.P2, +s1: Side, +s2: Side, +cc: K.P2) -> Stripe:
  match inside:
    case False{}:
      NoSt{edge, "radius-too-large", "a contact lies behind the edge (the ball does not sit in the wedge)"}
    case True{}:
      Task{_, ch, size} = t
      stripe.car(carrier(ch, sec, e2, cc, side_p(s1), side_p(s2), size, cls_convex(c)), edge, c, sec, e2, s1, s2, cc)

def stripe.sol(+sol: Sol, +t: Task, +edge: U32, +c: Cls, +sec: K.Sec, +e2: K.P2, +s1: Side, +s2: Side) -> Stripe:
  match sol:
    case SolNo{cls, why}:
      NoSt{edge, cls, why}
    case Sol{cc, pa, pb}:
      +n1 = side_set(s1, e2, pa)
      +n2 = side_set(s2, e2, pb)
      +ok = Bool.and(Bool.not(R.less(side_w(n1), R.neg(K.tol_lin()))), Bool.not(R.less(side_w(n2), R.neg(K.tol_lin()))))
      stripe.wok(ok, t, edge, c, sec, e2, n1, n2, cc)

def stripe.solve(+ch: Bool, +s1: Side, +s2: Side, +e2: K.P2, +size: R.Real) -> Sol:
  match ch:
    case False{}:
      fillet2d(side_prim(s1), side_prim(s2), e2, size)
    case True{}:
      chamfer2d(side_prim(s1), side_prim(s2), e2, side_tau(s1), side_tau(s2), size)

def stripe.sides(+c: Cls, +t: Task, +edge: U32, +sec: K.Sec) -> Stripe:
  match c:
    case ClsNo{_, cls, why}:
      NoSt{edge, cls, why}
    case Cls{_, f1, f2, p, tt, n1, n2, _, _, convex}:
      Task{b, ch, size} = t
      +fs = K.body_fs(b)
      +m1 = K.signed(Bool.not(convex), n1)
      +m2 = K.signed(Bool.not(convex), n2)
      +s1 = mk_side(sec, fs, f1, m1, G.cross(n1, tt), p)
      +s2 = mk_side(sec, fs, f2, m2, G.cross(tt, n2), p)
      +e2 = K.sec_pt(sec, p)
      +sol = stripe.solve(ch, s1, s2, e2, size)
      stripe.sol(sol, t, edge, c, sec, e2, s1, s2)

def fam.trans(+ok: Bool, +t: Task, +edge: U32, +c: Cls, +len: R.Real) -> Stripe:
  match ok:
    case False{}:
      NoSt{edge, "unsupported-surface", "line edge whose supports are not both invariant along it (the blend is a pipe, not analytic)"}
    case True{}:
      match c:
        case Cls{_, _, _, p, tt, n1, _, _, _, _}:
          stripe.sides(c, t, edge, K.Tra{p, tt, G.cross(tt, n1), n1, len})
        case ClsNo{_, cls, why}:
          NoSt{edge, cls, why}

def fam.rot(+ok: Bool, +t: Task, +edge: U32, +c: Cls, +o: G.Vec3, +a: G.Vec3, +closed: Bool) -> Stripe:
  match ok:
    case False{}:
      NoSt{edge, "unsupported-surface", "circle edge whose supports are not both coaxial with it (the blend is a pipe, not analytic)"}
    case True{}:
      match c:
        case Cls{_, _, _, p, _, _, _, _, _, _}:
          stripe.sides(c, t, edge, K.Rot{o, a, G.normalize(K.radial(o, a, p)), closed})
        case ClsNo{_, cls, why}:
          NoSt{edge, cls, why}

def cls_f1(+c: Cls) -> U32:
  match c:
    case Cls{_, f1, _, _, _, _, _, _, _, _}:
      f1
    case ClsNo{_, _, _}:
      0

def cls_f2(+c: Cls) -> U32:
  match c:
    case Cls{_, _, f2, _, _, _, _, _, _, _}:
      f2
    case ClsNo{_, _, _}:
      0

def stripe.curve(+cv: J.Curve, +t: Task, +edge: U32, +c: Cls, +ed: J.Edge, +ff1: J.Surf, +ff2: J.Surf, +vs: List<&2, G.Vec3>) -> Stripe:
  match cv:
    case J.CLine{_, _}:
      +d = K.edge_tangent(ed, K.edge_start(vs, ed))
      fam.trans(Bool.and(trans_ok(ff1, d), trans_ok(ff2, d)), t, edge, c, K.dist(K.edge_end(vs, ed), K.edge_start(vs, ed)))
    case J.CCircle{o, n, _, _}:
      +a = G.normalize(n)
      fam.rot(Bool.and(rot_ok(ff1, o, a), rot_ok(ff2, o, a)), t, edge, c, o, a, K.edge_closed(ed))
    case J.CEllipse{_, _, _, _, _}:
      NoSt{edge, "unsupported-edge", "ellipse edge (oblique plane/cylinder: pipe blend, not analytic)"}

def stripe.fam(+t: Task, +edge: U32, +c: Cls) -> Stripe:
  Task{b, _, _} = t
  J.Body{vs, es, fs} = b
  +ed = K.edge_at(es, edge)
  stripe.curve(K.edge_curve(ed), t, edge, c, ed, K.face_surf(K.face_at(fs, cls_f1(c))), K.face_surf(K.face_at(fs, cls_f2(c))), vs)

def stripe.cls(+c: Cls, +t: Task, +edge: U32) -> Stripe:
  match c:
    case ClsNo{_, cls, why}:
      NoSt{edge, cls, why}
    case Cls{_, _, _, _, _, _, _, _, _, _}:
      stripe.fam(t, edge, c)

# The ladder rung of one selected edge.
def stripe(+t: Task, +edge: U32) -> Stripe:
  Task{b, _, _} = t
  stripe.cls(classify(b, edge), t, edge)
