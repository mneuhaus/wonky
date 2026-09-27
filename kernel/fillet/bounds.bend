import Base
import ../real.bend as R
import ../precise.bend as G
import ../analytic.bend as A
import ./job.bend as J
import ./geom.bend as K
import ./ladder.bend as L

# Existence bounds and vertex census of the stage-1 ladder
# (docs/fillet/proto-kpart.md, theory §2.3, §6, §10.3-10.4).
#
# Width bound: a contact (spring) must stay on its support face. The spring
# lies at width w from the edge, measured in the face (along the section's
# in-face direction, or as arc length on a cylinder). The available width W
# is the smallest such distance, over the edge's extent (the slab of a line
# edge on a plane, the wedge of an arc), of an obstacle on the same face: a
# boundary edge of the face that does not share a vertex with the blended
# edge, or the spring of another stripe on the face.
#   w < W   inside;   w = W   consumed (the face shrinks to a curve: a full
#   round when both blends share the carrier, a dome at a sphere cap);
#   w > W   overflow (a boundary edge) or blend-overlap (another spring).
# Adjacent edges (sharing a vertex) are handled by the vertex census: cap,
# mitre, chain (G1 continuation), corner.
#
# An obstacle has its real extent: a segment its two end points, a circle
# its arc (a closed edge, or the spring of a closed stripe, is the whole
# circle). Two arcs of one circle (a disc crossed by a bar) are two
# obstacles, and the distance to each is measured to that arc alone, which
# may be to one of its end points. Where the edge's extent is not read, the
# bound is conservative, never short: TC counts a generator line at every
# height, RL a meridian distance over the whole turn. An ellipse is bounded
# over the whole ellipse (a lower bound for any arc of it, see lam_rl.ell).

# The extent of a circle obstacle: the whole circle, or the arc from a to b
# counter-clockwise about the obstacle's normal.
type Ext is Data:
  EFull{}
  EArc{a: G.Vec3, b: G.Vec3}

type Ob is Data:
  OSeg{a: G.Vec3, b: G.Vec3}
  OCirc{o: G.Vec3, n: G.Vec3, r: R.Real, ext: Ext}
  OEll{o: G.Vec3, n: G.Vec3, x: G.Vec3, ea: R.Real, eb: R.Real}
  OUnk{}

# by: 1 boundary edge of the face (id = edge), 2 spring of stripe (id = edge),
# 4 boundary ellipse edge of the face (id = edge; its λ is a lower bound, see
# lam_rl.ell, so it only admits a contact clearly inside: status)
type Obs is Data:
  Obs{ob: Ob, by: U32, id: U32}

# Metric of one stripe side.
#   TP translation, plane face: λ = tau·(X − e) over the slab 0 ≤ d·(X − e) ≤ len
#   TC translation, cylinder face: λ = ρ·angle from the edge around the axis
#   RP rotation, plane face ⟂ axis: λ = ±(distance from the axis − ρ_e) over
#      the edge's wedge (the sector from the axis through its end points)
#   RL rotation, cylinder or cone face: λ = tau·(meridian(X) − e2)
type Ctx is Data:
  CtxTP{e: G.Vec3, d: G.Vec3, tau: G.Vec3, len: R.Real, n: G.Vec3}
  CtxTC{e: G.Vec3, d: G.Vec3, q: G.Vec3, rho: R.Real, om: G.Vec3}
  CtxRP{f: G.Vec3, n: G.Vec3, rhoe: R.Real, out: Bool, w: Ext}
  CtxRL{o: G.Vec3, a: G.Vec3, e2: K.P2, tau: K.P2}
  CtxNo{}

type Lam is Data:
  LamNone{}
  LamVal{v: R.Real}
  LamUnk{}

type Lim is Data:
  Lim{has: Bool, v: R.Real, by: U32, id: U32, unk: Bool}

# st: 0 inside, 1 consumed, 2 overflow, 3 unknown
type Bnd is Data:
  Bnd{w: R.Real, lim: Lim, st: U32}

# ---------------------------------------------------------------------------
# λ of one obstacle

def lam_min(+a: R.Real, +b: R.Real) -> Lam:
  LamVal{R.min(a, b)}

# acc, lowered to v when the candidate is taken.
def lam_take.v(+acc: Lam, +v: R.Real) -> Lam:
  match acc:
    case LamVal{x}:
      LamVal{R.min(x, v)}
    case _:
      LamVal{v}

def lam_take(+ok: Bool, +acc: Lam, +v: R.Real) -> Lam:
  match ok:
    case True{}:
      lam_take.v(acc, v)
    case False{}:
      acc

# Angle of p on the circle (o, unit n) counter-clockwise from a, in
# [−tol, 2π − tol).
def arc_ang(+o: G.Vec3, +n: G.Vec3, +a: G.Vec3, +p: G.Vec3) -> R.Real:
  +va = G.sub(a, o)
  +vp = G.sub(p, o)
  +ang = R.atan2(G.dot(n, G.cross(va, vp)), G.dot(va, vp))
  K.pick_r(R.less(ang, R.neg(K.tol_dir())), R.add(ang, K.two_pi()), ang)

# Is the point p of the circle (o, unit n) on the obstacle's extent? Near an
# end point either answer is right: the end point is a candidate itself.
def in_arc(+x: Ext, +o: G.Vec3, +n: G.Vec3, +p: G.Vec3) -> Bool:
  match x:
    case EFull{}:
      True{}
    case EArc{a, b}:
      Bool.not(R.less(R.add(arc_ang(o, n, a, b), K.tol_dir()), arc_ang(o, n, a, p)))

def in_slab(+m: R.Real, +len: R.Real) -> Bool:
  +tol = K.tol_lin()
  Bool.and(Bool.not(R.less(m, R.neg(tol))), Bool.not(R.less(R.add(len, tol), m)))

def lam_tp.seg.in(+inr: Bool, +la: R.Real, +lb: R.Real) -> Lam:
  match inr:
    case True{}:
      lam_min(la, lb)
    case False{}:
      LamNone{}

def lam_tp.seg.clip(+ok: Bool, +la: R.Real, +lb: R.Real, +lo: R.Real, +hi: R.Real) -> Lam:
  match ok:
    case True{}:
      +dl = R.sub(lb, la)
      lam_min(R.add(la, R.mul(lo, dl)), R.add(la, R.mul(hi, dl)))
    case False{}:
      LamNone{}

def lam_tp.seg.par(+par: Bool, +ma: R.Real, +mb: R.Real, +la: R.Real, +lb: R.Real, +len: R.Real) -> Lam:
  match par:
    case True{}:
      lam_tp.seg.in(in_slab(ma, len), la, lb)
    case False{}:
      +dm = R.sub(mb, ma)
      +s0 = R.div(R.neg(ma), dm)
      +s1 = R.div(R.sub(len, ma), dm)
      +lo = R.max(K.zero(), R.min(s0, s1))
      +hi = R.min(K.one(), R.max(s0, s1))
      lam_tp.seg.clip(Bool.not(R.less(hi, lo)), la, lb, lo, hi)

# A circle (arc) in the face plane, centre at (mq, lq) in the (d, τ) frame:
# λ is linear, so its smallest value over the arc inside the slab is at one
# of: the circle's lowest point o − rτ, a crossing of the circle with a slab
# side m = 0 or m = len, or an end point of the arc.
def lam_tp.side(+ext: Ext, +acc: Lam, +o: G.Vec3, +cn: G.Vec3, +d: G.Vec3, +tau: G.Vec3, +mq: R.Real, +lq: R.Real, +r: R.Real, +mb: R.Real) -> Lam:
  +dm = R.sub(mb, mq)
  +t2 = R.sub(K.sq(r), K.sq(dm))
  +hit = Bool.not(K.is_neg(t2))
  +s = R.sqrt(R.max(t2, K.zero()))
  +c = K.axpy(o, dm, d)
  +a1 = lam_take(Bool.and(hit, in_arc(ext, o, cn, K.axpy(c, s, tau))), acc, R.add(lq, s))
  lam_take(Bool.and(hit, in_arc(ext, o, cn, K.axpy(c, R.neg(s), tau))), a1, R.sub(lq, s))

def lam_tp.ends(+ext: Ext, +acc: Lam, +e: G.Vec3, +d: G.Vec3, +tau: G.Vec3, +len: R.Real) -> Lam:
  match ext:
    case EFull{}:
      acc
    case EArc{a, b}:
      +a1 = lam_take(in_slab(G.dot(d, G.sub(a, e)), len), acc, G.dot(tau, G.sub(a, e)))
      lam_take(in_slab(G.dot(d, G.sub(b, e)), len), a1, G.dot(tau, G.sub(b, e)))

def lam_tp.circ(+e: G.Vec3, +d: G.Vec3, +tau: G.Vec3, +len: R.Real, +o: G.Vec3, +cn: G.Vec3, +r: R.Real, +ext: Ext) -> Lam:
  +mq = G.dot(d, G.sub(o, e))
  +lq = G.dot(tau, G.sub(o, e))
  +a0 = lam_take(Bool.and(in_slab(mq, len), in_arc(ext, o, cn, K.axpy(o, R.neg(r), tau))), LamNone{}, R.sub(lq, r))
  +a1 = lam_tp.side(ext, a0, o, cn, d, tau, mq, lq, r, K.zero())
  +a2 = lam_tp.side(ext, a1, o, cn, d, tau, mq, lq, r, len)
  lam_tp.ends(ext, a2, e, d, tau, len)

def lam_tp.circ.plane(+inplane: Bool, +e: G.Vec3, +d: G.Vec3, +tau: G.Vec3, +len: R.Real, +o: G.Vec3, +cn: G.Vec3, +r: R.Real, +ext: Ext) -> Lam:
  match inplane:
    case False{}:
      LamUnk{}
    case True{}:
      lam_tp.circ(e, d, tau, len, o, cn, r, ext)

def lam_tp(+e: G.Vec3, +d: G.Vec3, +tau: G.Vec3, +len: R.Real, +n: G.Vec3, +ob: Ob) -> Lam:
  match ob:
    case OSeg{a, b}:
      +ma = G.dot(d, G.sub(a, e))
      +mb = G.dot(d, G.sub(b, e))
      lam_tp.seg.par(K.near_lin(R.sub(mb, ma)), ma, mb, G.dot(tau, G.sub(a, e)), G.dot(tau, G.sub(b, e)), len)
    case OCirc{o, cn, r, ext}:
      lam_tp.circ.plane(K.parallel(cn, n), e, d, tau, len, o, cn, r, ext)
    case OEll{_, _, _, _, _}:
      LamUnk{}
    case OUnk{}:
      LamUnk{}

def angle_from(+e: G.Vec3, +d: G.Vec3, +q: G.Vec3, +om: G.Vec3, +x: G.Vec3) -> R.Real:
  +v0 = K.radial(q, d, e)
  +vx = K.radial(q, d, x)
  +ang = R.atan2(G.dot(om, G.cross(v0, vx)), G.dot(v0, vx))
  K.pick_r(R.less(ang, R.neg(K.tol_dir())), R.add(ang, K.two_pi()), ang)

def lam_tc.seg(+gen: Bool, +e: G.Vec3, +d: G.Vec3, +q: G.Vec3, +rho: R.Real, +om: G.Vec3, +a: G.Vec3) -> Lam:
  match gen:
    case True{}:
      LamVal{R.mul(rho, angle_from(e, d, q, om, a))}
    case False{}:
      LamNone{}

def lam_tc(+e: G.Vec3, +d: G.Vec3, +q: G.Vec3, +rho: R.Real, +om: G.Vec3, +ob: Ob) -> Lam:
  match ob:
    case OSeg{a, b}:
      lam_tc.seg(K.parallel(G.normalize(G.sub(b, a)), d), e, d, q, rho, om, a)
    case OCirc{_, _, _, _}:
      LamNone{}
    case OEll{_, _, _, _, _}:
      LamUnk{}
    case OUnk{}:
      LamUnk{}

# Distance from f to the segment a b.
def seg_dist(+f: G.Vec3, +a: G.Vec3, +b: G.Vec3) -> R.Real:
  +ab = G.sub(b, a)
  +t = R.div(G.dot(G.sub(f, a), ab), G.dot(ab, ab))
  +tc = R.max(K.zero(), R.min(K.one(), t))
  K.dist(K.axpy(a, tc, ab), f)

def lam_rp.pick(+out: Bool, +rhoe: R.Real, +dmin: R.Real, +dmax: R.Real) -> Lam:
  match out:
    case True{}:
      LamVal{R.sub(dmin, rhoe)}
    case False{}:
      LamVal{R.sub(rhoe, dmax)}

# RP over the edge's extent: an obstacle counts where it lies in the edge's
# wedge w, the sector from the axis foot f (normal n) through the edge's end
# points. Its nearest and farthest distance from f there are at candidate
# points: its end points, the nearest (segment foot, circle point towards f)
# and farthest (circle point away from f) point, and its crossings with the
# wedge's two rays. A closed edge's wedge is the whole plane.
type Dd is Data:
  DdNone{}
  DdVal{lo: R.Real, hi: R.Real}

def dd_take.v(+acc: Dd, +v: R.Real) -> Dd:
  match acc:
    case DdVal{lo, hi}:
      DdVal{R.min(lo, v), R.max(hi, v)}
    case DdNone{}:
      DdVal{v, v}

def dd_take(+ok: Bool, +acc: Dd, +v: R.Real) -> Dd:
  match ok:
    case True{}:
      dd_take.v(acc, v)
    case False{}:
      acc

# The point p of the obstacle, taken when ok and in the wedge.
def dd_pt(+ok: Bool, +acc: Dd, +w: Ext, +f: G.Vec3, +n: G.Vec3, +p: G.Vec3) -> Dd:
  dd_take(Bool.and(ok, in_arc(w, f, n, p)), acc, K.dist(p, f))

def lam_rp.dd(+dd: Dd, +out: Bool, +rhoe: R.Real) -> Lam:
  match dd:
    case DdNone{}:
      LamNone{}
    case DdVal{lo, hi}:
      lam_rp.pick(out, rhoe, lo, hi)

# Crossing of the ray from f through w0 with the segment a b.
def rp_ray_seg(+acc: Dd, +f: G.Vec3, +n: G.Vec3, +w0: G.Vec3, +a: G.Vec3, +b: G.Vec3) -> Dd:
  +u = G.normalize(G.sub(w0, f))
  +dn = G.normalize(G.sub(b, a))
  +den = G.dot(n, G.cross(dn, u))
  +par = K.near_dir(den)
  +t = R.div(G.dot(n, G.cross(G.sub(f, a), u)), K.pick_r(par, K.one(), den))
  +x = K.axpy(a, t, dn)
  +front = Bool.not(R.less(G.dot(G.sub(x, f), u), R.neg(K.tol_lin())))
  dd_take(Bool.and(Bool.and(Bool.not(par), in_slab(t, K.dist(a, b))), front), acc, K.dist(x, f))

# Crossings of the ray from f through w0 with the circle (o, cn, r), taken
# when on the obstacle's extent.
def rp_ray_circ(+ext: Ext, +acc: Dd, +f: G.Vec3, +w0: G.Vec3, +o: G.Vec3, +cn: G.Vec3, +r: R.Real) -> Dd:
  +u = G.normalize(G.sub(w0, f))
  +fo = G.sub(f, o)
  +bb = G.dot(u, fo)
  +disc = R.sub(K.sq(bb), R.sub(G.dot(fo, fo), K.sq(r)))
  +hit = Bool.not(K.is_neg(disc))
  +sd = R.sqrt(R.max(disc, K.zero()))
  +tol = K.tol_lin()
  +s1 = R.sub(R.neg(bb), sd)
  +s2 = R.add(R.neg(bb), sd)
  +x1 = K.axpy(f, s1, u)
  +x2 = K.axpy(f, s2, u)
  +a1 = dd_take(Bool.and(Bool.and(hit, Bool.not(R.less(s1, R.neg(tol)))), in_arc(ext, o, cn, x1)), acc, K.dist(x1, f))
  dd_take(Bool.and(Bool.and(hit, Bool.not(R.less(s2, R.neg(tol)))), in_arc(ext, o, cn, x2)), a1, K.dist(x2, f))

def lam_rp.seg(+w: Ext, +f: G.Vec3, +n: G.Vec3, +rhoe: R.Real, +out: Bool, +a: G.Vec3, +b: G.Vec3) -> Lam:
  match w:
    case EFull{}:
      lam_rp.pick(out, rhoe, seg_dist(f, a, b), R.max(K.dist(a, f), K.dist(b, f)))
    case EArc{wa, wb}:
      +x = {EArc{wa, wb} : Ext}
      +ab = G.sub(b, a)
      +t = R.div(G.dot(G.sub(f, a), ab), G.dot(ab, ab))
      +d0 = dd_pt(True{}, DdNone{}, x, f, n, a)
      +d1 = dd_pt(True{}, d0, x, f, n, b)
      +d2 = dd_pt(in_slab(t, K.one()), d1, x, f, n, K.axpy(a, t, ab))
      +d3 = rp_ray_seg(d2, f, n, wa, a, b)
      lam_rp.dd(rp_ray_seg(d3, f, n, wb, a, b), out, rhoe)

def rp_ends(+ext: Ext, +acc: Dd, +w: Ext, +f: G.Vec3, +n: G.Vec3) -> Dd:
  match ext:
    case EFull{}:
      acc
    case EArc{a, b}:
      dd_pt(True{}, dd_pt(True{}, acc, w, f, n, a), w, f, n, b)

def rp_rays(+w: Ext, +acc: Dd, +ext: Ext, +f: G.Vec3, +o: G.Vec3, +cn: G.Vec3, +r: R.Real) -> Dd:
  match w:
    case EFull{}:
      acc
    case EArc{wa, wb}:
      rp_ray_circ(ext, rp_ray_circ(ext, acc, f, wa, o, cn, r), f, wb, o, cn, r)

# The distance along a circle from f has one minimum (towards f) and one
# maximum (away from f); f at the centre: every point is at distance r (the
# ends and ray crossings carry it).
def lam_rp.circ.gen(+ext: Ext, +w: Ext, +f: G.Vec3, +n: G.Vec3, +rhoe: R.Real, +out: Bool, +o: G.Vec3, +cn: G.Vec3, +r: R.Real) -> Lam:
  +dq = K.dist(o, f)
  +far = Bool.not(K.near_lin(dq))
  +u = G.scale(G.sub(f, o), R.div(r, R.max(dq, K.tol_lin())))
  +pn = G.add(o, u)
  +pf = G.sub(o, u)
  +d0 = dd_pt(Bool.and(far, in_arc(ext, o, cn, pn)), DdNone{}, w, f, n, pn)
  +d1 = dd_pt(Bool.and(far, in_arc(ext, o, cn, pf)), d0, w, f, n, pf)
  lam_rp.dd(rp_rays(w, rp_ends(ext, d1, w, f, n), ext, f, o, cn, r), out, rhoe)

def lam_rp.circ.full(+w: Ext, +f: G.Vec3, +n: G.Vec3, +rhoe: R.Real, +out: Bool, +o: G.Vec3, +cn: G.Vec3, +r: R.Real) -> Lam:
  match w:
    case EFull{}:
      +dq = K.dist(o, f)
      lam_rp.pick(out, rhoe, R.abs(R.sub(dq, r)), R.add(dq, r))
    case EArc{wa, wb}:
      lam_rp.circ.gen(EFull{}, EArc{wa, wb}, f, n, rhoe, out, o, cn, r)

def lam_rp.circ(+ext: Ext, +w: Ext, +f: G.Vec3, +n: G.Vec3, +rhoe: R.Real, +out: Bool, +o: G.Vec3, +cn: G.Vec3, +r: R.Real) -> Lam:
  match ext:
    case EFull{}:
      lam_rp.circ.full(w, f, n, rhoe, out, o, cn, r)
    case EArc{a, b}:
      lam_rp.circ.gen(EArc{a, b}, w, f, n, rhoe, out, o, cn, r)

def lam_rp(+f: G.Vec3, +n: G.Vec3, +rhoe: R.Real, +out: Bool, +w: Ext, +ob: Ob) -> Lam:
  match ob:
    case OSeg{a, b}:
      lam_rp.seg(w, f, n, rhoe, out, a, b)
    case OCirc{o, cn, r, ext}:
      lam_rp.circ(ext, w, f, n, rhoe, out, o, cn, r)
    case OEll{_, _, _, _, _}:
      LamUnk{}
    case OUnk{}:
      LamUnk{}

# A coaxial circle has one meridian point, so λ is the same on every arc of it.
def lam_rl.circ(+coax: Bool, +o: G.Vec3, +a: G.Vec3, +e2: K.P2, +tau: K.P2, +oc: G.Vec3, +r: R.Real) -> Lam:
  match coax:
    case True{}:
      LamVal{K.p2_dot(tau, K.p2_sub(K.p2(r, G.dot(a, G.sub(oc, o))), e2))}
    case False{}:
      LamUnk{}

# An ellipse on the side face (a boundary edge of the cylinder or cone the
# spring moves on, coaxial with the rotation): every point X of the face has
# its meridian on the generator through e2, so λ(X) = (a·(X − o) − e2_y)/τ_y.
# Over the whole ellipse X(t) = c + ea cos t x + eb sin t (n × x) the axial
# height is a·(c − o) ± H, H = |(ea a·x, eb a·(n × x))|, so
#   λ ≥ (a·(c − o) − e2_y)/τ_y − H/|τ_y|
# on the edge (an arc of it) too. The bound is used only when it is not
# behind the edge (the arc's own range is not read) and τ is not nearly
# radial (|τ_y| ≥ 1/2); otherwise the obstacle stays unknown.
def lam_rl.ell.ok(+ok: Bool, +lo: R.Real) -> Lam:
  match ok:
    case True{}:
      LamVal{lo}
    case False{}:
      LamUnk{}

def lam_rl.ell.ty(+steep: Bool, +o: G.Vec3, +a: G.Vec3, +e2: K.P2, +ty: R.Real, +c: G.Vec3, +n: G.Vec3, +x: G.Vec3, +ea: R.Real, +eb: R.Real) -> Lam:
  match steep:
    case False{}:
      LamUnk{}
    case True{}:
      +hx = R.mul(ea, G.dot(a, x))
      +hy = R.mul(eb, G.dot(a, G.cross(n, x)))
      +big = R.sqrt(R.add(K.sq(hx), K.sq(hy)))
      +lo = R.sub(R.div(R.sub(G.dot(a, G.sub(c, o)), K.p2_y(e2)), ty), R.div(big, R.abs(ty)))
      lam_rl.ell.ok(Bool.not(R.less(lo, R.neg(K.tol_lin()))), lo)

def lam_rl.ell(+o: G.Vec3, +a: G.Vec3, +e2: K.P2, +tau: K.P2, +c: G.Vec3, +n: G.Vec3, +x: G.Vec3, +ea: R.Real, +eb: R.Real) -> Lam:
  +ty = K.p2_y(tau)
  lam_rl.ell.ty(Bool.not(R.less(R.abs(ty), R.from_f32(0.5))), o, a, e2, ty, c, n, x, ea, eb)

def lam_rl(+o: G.Vec3, +a: G.Vec3, +e2: K.P2, +tau: K.P2, +ob: Ob) -> Lam:
  match ob:
    case OSeg{p, q}:
      lam_min(K.p2_dot(tau, K.p2_sub(K.meridian(o, a, p), e2)), K.p2_dot(tau, K.p2_sub(K.meridian(o, a, q), e2)))
    case OCirc{oc, n, r, _}:
      lam_rl.circ(Bool.and(K.parallel(n, a), K.near_lin(K.line_dist(o, a, oc))), o, a, e2, tau, oc, r)
    case OEll{c, n, x, ea, eb}:
      lam_rl.ell(o, a, e2, tau, c, n, x, ea, eb)
    case OUnk{}:
      LamUnk{}

def lam(+c: Ctx, +ob: Ob) -> Lam:
  match c:
    case CtxTP{e, d, tau, len, n}:
      lam_tp(e, d, tau, len, n, ob)
    case CtxTC{e, d, q, rho, om}:
      lam_tc(e, d, q, rho, om, ob)
    case CtxRP{f, n, rhoe, out, w}:
      lam_rp(f, n, rhoe, out, w, ob)
    case CtxRL{o, a, e2, tau}:
      lam_rl(o, a, e2, tau, ob)
    case CtxNo{}:
      LamUnk{}

# ---------------------------------------------------------------------------
# The limit: smallest λ ≥ 0 (λ in [−tol, 0) counts as 0; λ < −tol lies behind
# the edge and is not in the way).

def lim_none() -> Lim:
  Lim{False{}, K.zero(), 0, 0, False{}}

def lim_min(+lt: Bool, +v: R.Real, +b0: U32, +i0: U32, +unk: Bool, +x: R.Real, +by: U32, +id: U32) -> Lim:
  match lt:
    case True{}:
      Lim{True{}, x, by, id, unk}
    case False{}:
      Lim{True{}, v, b0, i0, unk}

def lim_val(+has: Bool, +v: R.Real, +b0: U32, +i0: U32, +unk: Bool, +x: R.Real, +by: U32, +id: U32) -> Lim:
  match has:
    case False{}:
      Lim{True{}, x, by, id, unk}
    case True{}:
      lim_min(R.less(x, v), v, b0, i0, unk, x, by, id)

def lim_behind(+behind: Bool, +has: Bool, +v: R.Real, +b0: U32, +i0: U32, +unk: Bool, +x: R.Real, +by: U32, +id: U32) -> Lim:
  match behind:
    case True{}:
      Lim{has, v, b0, i0, unk}
    case False{}:
      lim_val(has, v, b0, i0, unk, R.max(x, K.zero()), by, id)

def lim_add(+acc: Lim, +l: Lam, +by: U32, +id: U32) -> Lim:
  match acc:
    case Lim{has, v, b0, i0, unk}:
      match l:
        case LamNone{}:
          Lim{has, v, b0, i0, unk}
        case LamUnk{}:
          Lim{has, v, b0, i0, True{}}
        case LamVal{x}:
          lim_behind(R.less(x, R.neg(K.tol_lin())), has, v, b0, i0, unk, x, by, id)

def lim_fold(+c: Ctx, +obs: List<&2, Obs>, +acc: Lim) -> Lim:
  match obs:
    case Nil{}:
      acc
    case Obs{ob, by, id} <> t:
      lim_fold(c, t, lim_add(acc, lam(c, ob), by, id))

# ---------------------------------------------------------------------------
# Obstacles of a face for stripe k

# The arc of an edge from its start a to its end b: counter-clockwise about
# the curve normal when `same` (increasing parameter), else from b to a.
def arc_ext(+closed: Bool, +same: Bool, +a: G.Vec3, +b: G.Vec3) -> Ext:
  match closed:
    case True{}:
      EFull{}
    case False{}:
      Bool.pick(Ext, same, EArc{a, b}, EArc{b, a})

def ob_of_curve(+cv: A.Curve, +a: G.Vec3, +b: G.Vec3, +closed: Bool, +same: Bool) -> Ob:
  match cv:
    case A.Line{_, _}:
      OSeg{a, b}
    case A.Circle{o, n, _, r}:
      OCirc{o, G.normalize(n), r, arc_ext(closed, same, a, b)}
    case A.Ellipse{o, n, x, ea, eb}:
      OEll{o, G.normalize(n), G.normalize(x), ea, eb}

def count_eq(+xs: List<&2, U32>, +x: U32, +acc: U32) -> U32:
  match xs:
    case Nil{}:
      acc
    case h <> t:
      count_eq(t, x, (acc + Bool.to_u32(U32.is_eq(h, x)) : U32))

def push_ob(+keep: Bool, +o: Obs, +acc: List<&2, Obs>) -> List<&2, Obs>:
  match keep:
    case True{}:
      o <> acc
    case False{}:
      acc

def obs_edges(+xs: List<&2, U32>, +fe: List<&2, U32>, +b: J.Body, +k: U32, +acc: List<&2, Obs>) -> List<&2, Obs>:
  match xs:
    case Nil{}:
      acc
    case x <> t:
      +xx = x
      +es = K.body_es(b)
      +ex = K.edge_at(es, xx)
      +keep = Bool.and(Bool.and(U32.is_ne(xx, k), U32.is_lt(count_eq(fe, xx, 0), 2)), Bool.not(K.adjacent(ex, K.edge_at(es, k))))
      +vs = K.body_vs(b)
      +o = {Obs{ob_of_curve(K.edge_curve(ex), K.edge_start(vs, ex), K.edge_end(vs, ex), K.edge_closed(ex), K.edge_same(ex)), Bool.pick(U32, U32.is_eq(K.curve_kind(K.edge_curve(ex)), 2), 4, 1), xx} : Obs}
      obs_edges(t, fe, b, k, push_ob(keep, o, acc))

# The point of the spring circle (centre c, unit axis a, radius rs) at the
# angle of p about the axis.
def spring_pt(+c: G.Vec3, +a: G.Vec3, +rs: R.Real, +p: G.Vec3) -> G.Vec3:
  K.axpy(c, rs, G.normalize(K.radial(c, a, p)))

# The spring of a rotation stripe spans the angle of its edge ed: the arc
# between the edge's end points turned onto the spring circle, oriented by the
# edge's circle normal (± the axis).
def spring_arc(+cv: A.Curve, +ed: J.Edge, +vs: List<&2, G.Vec3>, +c: G.Vec3, +a: G.Vec3, +rs: R.Real) -> Ob:
  match cv:
    case A.Circle{_, n, _, _}:
      +ext = arc_ext(K.edge_closed(ed), K.edge_same(ed), spring_pt(c, a, rs, K.edge_start(vs, ed)), spring_pt(c, a, rs, K.edge_end(vs, ed)))
      OCirc{c, G.normalize(n), rs, ext}
    case _:
      OCirc{c, a, rs, EFull{}}

def spring_ob(+sec: K.Sec, +p: K.P2, +ed: J.Edge, +vs: List<&2, G.Vec3>) -> Ob:
  match sec:
    case K.Tra{_, d, _, _, len}:
      +a = K.sec_lift(sec, p)
      OSeg{a, K.axpy(a, len, d)}
    case K.Rot{o, a, _, _}:
      spring_arc(K.edge_curve(ed), ed, vs, K.axpy(o, K.p2_y(p), a), a, K.p2_x(p))

def obs_springs(+ss: List<&2, L.Stripe>, +f: U32, +b: J.Body, +k: U32, +acc: List<&2, Obs>) -> List<&2, Obs>:
  match ss:
    case Nil{}:
      acc
    case L.NoSt{_, _, _} <> t:
      obs_springs(t, f, b, k, acc)
    case L.St{j, _, _, _, _, _, sec, _, s1, s2, _, _, _, _} <> t:
      +es = K.body_es(b)
      +ej = K.edge_at(es, j)
      +vs = K.body_vs(b)
      +apart = Bool.and(U32.is_ne(j, k), Bool.not(K.adjacent(ej, K.edge_at(es, k))))
      +a1 = push_ob(Bool.and(apart, U32.is_eq(L.side_face(s1), f)), Obs{spring_ob(sec, L.side_p(s1), ej, vs), 2, j}, acc)
      +a2 = push_ob(Bool.and(apart, U32.is_eq(L.side_face(s2), f)), Obs{spring_ob(sec, L.side_p(s2), ej, vs), 2, j}, a1)
      obs_springs(t, f, b, k, a2)

# ---------------------------------------------------------------------------
# Side contexts

def ctx_tc(+surf: A.Surface, +e: G.Vec3, +d: G.Vec3, +tau3: G.Vec3) -> Ctx:
  match surf:
    case A.Cylinder{o, _, _, rho}:
      +v0 = K.radial(o, d, e)
      CtxTC{e, d, o, rho, K.signed(K.is_pos(G.dot(d, G.cross(v0, tau3))), d)}
    case _:
      CtxNo{}

def ctx_of.tra(+sec: K.Sec, +sk: U32, +surf: A.Surface, +tau: K.P2) -> Ctx:
  match sec:
    case K.Tra{e, d, _, _, len}:
      match sk:
        case 0:
          +tau3 = K.sec_lift_dir(sec, tau)
          CtxTP{e, d, tau3, len, G.cross(d, tau3)}
        case 1:
          ctx_tc(surf, e, d, K.sec_lift_dir(sec, tau))
        case _:
          CtxNo{}
    case K.Rot{_, _, _, _}:
      CtxNo{}

# The RP context of edge ed (a circle about the axis, centre f): its wedge is
# its arc from f, oriented by its circle normal.
def ctx_rp(+cv: A.Curve, +ed: J.Edge, +vs: List<&2, G.Vec3>, +f: G.Vec3, +a: G.Vec3, +rhoe: R.Real, +out: Bool) -> Ctx:
  match cv:
    case A.Circle{_, n, _, _}:
      CtxRP{f, G.normalize(n), rhoe, out, arc_ext(K.edge_closed(ed), K.edge_same(ed), K.edge_start(vs, ed), K.edge_end(vs, ed))}
    case _:
      CtxRP{f, a, rhoe, out, EFull{}}

def ctx_of.rot(+sec: K.Sec, +sk: U32, +e2: K.P2, +tau: K.P2, +ed: J.Edge, +vs: List<&2, G.Vec3>) -> Ctx:
  match sec:
    case K.Rot{o, a, _, _}:
      match sk:
        case 0:
          +e3 = K.sec_lift(sec, e2)
          ctx_rp(K.edge_curve(ed), ed, vs, K.axpy(o, G.dot(a, G.sub(e3, o)), a), a, K.p2_x(e2), K.is_pos(K.p2_x(tau)))
        case 1:
          CtxRL{o, a, e2, tau}
        case 2:
          CtxRL{o, a, e2, tau}
        case _:
          CtxNo{}
    case K.Tra{_, _, _, _, _}:
      CtxNo{}

def ctx_of(+sec: K.Sec, +sd: L.Side, +e2: K.P2, +surf: A.Surface, +ed: J.Edge, +vs: List<&2, G.Vec3>) -> Ctx:
  match sec:
    case K.Tra{_, _, _, _, _}:
      ctx_of.tra(sec, L.side_kind(sd), surf, L.side_tau(sd))
    case K.Rot{_, _, _, _}:
      ctx_of.rot(sec, L.side_kind(sd), e2, L.side_tau(sd), ed, vs)

# The axis is an obstacle for a spring moving inwards on a plane ⟂ axis.
def axis_lim(+c: Ctx, +acc: Lim) -> Lim:
  match c:
    case CtxRP{_, _, rhoe, out, _}:
      match out:
        case True{}:
          acc
        case False{}:
          lim_add(acc, LamVal{rhoe}, 3, 0)
    case _:
      acc

def status.cmp(+w: R.Real, +v: R.Real) -> U32:
  +tol = K.tol_lin()
  Bool.pick(U32, R.less(w, R.sub(v, tol)), 0, Bool.pick(U32, R.less(R.add(v, tol), w), 2, 1))

# A limit set by an ellipse (by 4) is a lower bound: it admits a contact
# clearly inside it, and anything else stays unknown (3).
def status.ell(+ell: Bool, +st: U32) -> U32:
  Bool.pick(U32, Bool.and(ell, U32.is_ne(st, 0)), 3, st)

def status(+w: R.Real, +l: Lim) -> U32:
  match l:
    case Lim{has, v, by, _, unk}:
      match has:
        case False{}:
          Bool.pick(U32, unk, 3, 0)
        case True{}:
          Bool.pick(U32, unk, 3, status.ell(U32.is_eq(by, 4), status.cmp(w, v)))

def side_bound(+b: J.Body, +ss: List<&2, L.Stripe>, +k: U32, +sec: K.Sec, +e2: K.P2, +sd: L.Side) -> Bnd:
  +f = L.side_face(sd)
  +face = K.face_at(K.body_fs(b), f)
  +fe = K.face_edges(face)
  +c = ctx_of(sec, sd, e2, K.face_surf(face), K.edge_at(K.body_es(b), k), K.body_vs(b))
  +obs = obs_springs(ss, f, b, k, obs_edges(fe, fe, b, k, Nil{}))
  +lim = axis_lim(c, lim_fold(c, obs, lim_none()))
  +w = L.side_w(sd)
  Bnd{w, lim, status(w, lim)}

# ---------------------------------------------------------------------------
# Vertex census (theory §6-7)

type End is Data:
  EClosed{}
  ECap{v: U32}
  EMitre{v: U32, other: U32, ext: Bool}
  EChain{v: U32, other: U32}
  ECorner{v: U32}
  ENo{v: U32, cls: String, why: String}

# Selected and unselected edges at a vertex, other than k. Unselected smooth
# edges (tangent faces, e.g. the coplanar fragments a planar union leaves)
# are no vertex edges for blending: they are left out, so the valence counts
# only real edges.
def split_sel(+xs: List<&2, U32>, +b: J.Body, +sel: List<&2, U32>, +k: U32, +ins: List<&2, U32>, +outs: List<&2, U32>) -> List<&2, U32> & List<&2, U32>:
  match xs:
    case Nil{}:
      (List.reverse(&2, U32, ins), List.reverse(&2, U32, outs))
    case x <> t:
      +xx = x
      +other = U32.is_ne(xx, k)
      +isel = K.mem(sel, xx)
      +real = Bool.not(L.cls_is_smooth(L.classify(b, xx)))
      split_sel(t, b, sel, k, K.push_if(Bool.and(other, isel), xx, ins), K.push_if(Bool.and(Bool.and(other, real), Bool.not(isel)), xx, outs))

def any_g1_unsel(+us: List<&2, U32>, +b: J.Body, +k: U32, +v: U32) -> U32:
  match us:
    case Nil{}:
      4294967295
    case u <> t:
      +uu = u
      +hit = Bool.and(L.g1_at(b, k, uu, v), L.cls_ok(L.classify(b, uu)))
      Bool.pick(U32, hit, uu, any_g1_unsel(t, b, k, v))

def head_u32(+xs: List<&2, U32>) -> U32:
  match xs:
    case Nil{}:
      4294967295
    case h <> _:
      h

def second_u32(+xs: List<&2, U32>) -> U32:
  match xs:
    case Nil{}:
      4294967295
    case _ <> t:
      head_u32(t)

def vtxt(+v: U32) -> String:
  " at vertex " ++ K.show_u32(v)

def none_u32() -> U32:
  4294967295

def end.terminal.val(+three: Bool, +k: U32, +v: U32, +val: U32) -> End:
  match three:
    case True{}:
      ECap{v}
    case False{}:
      ENo{v, "vertex-blend", "edge " ++ K.show_u32(k) ++ " ends" ++ vtxt(v) ++ " of valence " ++ K.show_u32(val) ++ " (setback patch, later stage)"}

def end.terminal(+has_g1: Bool, +g1: U32, +val: U32, +k: U32, +v: U32) -> End:
  match has_g1:
    case True{}:
      ENo{v, "vertex-blend", "edge " ++ K.show_u32(k) ++ " stops" ++ vtxt(v) ++ " where its G1 continuation " ++ K.show_u32(g1) ++ " is not selected (tangentPropagation false or a convexity change)"}
    case False{}:
      end.terminal.val(U32.is_eq(val, 3), k, v, val)

# A mitre: both blends are cut along their mutual intersection. When the
# third (unselected) edge has the opposite convexity the blends are extended
# past the vertex until they meet (Onshape probe FP08: 4 cylinders, no horn
# torus, plate footprint 40·r + 4·r²); otherwise they are trimmed.
def end.mitre3(+ext: Bool, +k: U32, +s: U32, +u: U32, +v: U32) -> End:
  EMitre{v, s, ext}

def end.mitre(+three: Bool, +b: J.Body, +k: U32, +ck: Bool, +s: U32, +u: U32, +v: U32, +val: U32) -> End:
  match three:
    case True{}:
      +cu = L.classify(b, u)
      end.mitre3(Bool.and(L.cls_ok(cu), Bool.xor(L.cls_convex(cu), ck)), k, s, u, v)
    case False{}:
      ENo{v, "vertex-blend", "mitre of edges " ++ K.show_u32(k) ++ " and " ++ K.show_u32(s) ++ vtxt(v) ++ " of valence " ++ K.show_u32(val)}

def end.one.g1(+g1: Bool, +b: J.Body, +k: U32, +ck: Bool, +s: U32, +u: U32, +v: U32, +val: U32) -> End:
  match g1:
    case True{}:
      EChain{v, s}
    case False{}:
      end.mitre(U32.is_eq(val, 3), b, k, ck, s, u, v, val)

def end.one(+same: Bool, +b: J.Body, +k: U32, +ck: Bool, +s: U32, +u: U32, +v: U32, +val: U32) -> End:
  match same:
    case False{}:
      ENo{v, "mixed-convexity", "edges " ++ K.show_u32(k) ++ " and " ++ K.show_u32(s) ++ " of opposite convexity meet" ++ vtxt(v) ++ " (not unique; sequence the fillets)"}
    case True{}:
      end.one.g1(L.g1_at(b, k, s, v), b, k, ck, s, u, v, val)

def end.two(+ok3: Bool, +same: Bool, +k: U32, +v: U32, +val: U32) -> End:
  match ok3:
    case False{}:
      ENo{v, "vertex-blend", "three selected edges meet" ++ vtxt(v) ++ " of valence " ++ K.show_u32(val)}
    case True{}:
      match same:
        case True{}:
          ECorner{v}
        case False{}:
          ENo{v, "mixed-convexity", "corner of mixed convexity" ++ vtxt(v) ++ " (setback patch, later stage)"}

def same_cvx(+b: J.Body, +x: U32, +ck: Bool) -> Bool:
  Bool.not(Bool.xor(L.cls_convex(L.classify(b, x)), ck))

def end.n(+nsel: U32, +b: J.Body, +so: List<&2, U32>, +us: List<&2, U32>, +k: U32, +ck: Bool, +v: U32, +val: U32) -> End:
  match nsel:
    case 0:
      +g1 = any_g1_unsel(us, b, k, v)
      end.terminal(U32.is_ne(g1, none_u32()), g1, val, k, v)
    case 1:
      +s = head_u32(so)
      end.one(same_cvx(b, s, ck), b, k, ck, s, head_u32(us), v, val)
    case 2:
      end.two(U32.is_eq(val, 3), Bool.and(same_cvx(b, head_u32(so), ck), same_cvx(b, second_u32(so), ck)), k, v, val)
    case _:
      ENo{v, "vertex-blend", K.show_u32(nsel) ++ " further selected edges meet" ++ vtxt(v)}

def end_at.p(parts: List<&2, U32> & List<&2, U32>, +b: J.Body, +k: U32, +ck: Bool, +v: U32) -> End:
  (so0, us0) = parts
  +so = so0
  +us = us0
  +val = (1 + (K.count(U32, so) + K.count(U32, us) : U32) : U32)
  end.n(K.count(U32, so), b, so, us, k, ck, v, val)

def end_at(+b: J.Body, +sel: List<&2, U32>, +k: U32, +ck: Bool, +v: U32) -> End:
  end_at.p(split_sel(K.vertex_edges(K.body_es(b), v), b, sel, k, Nil{}, Nil{}), b, k, ck, v)

def ends_of.c(+closed: Bool, +b: J.Body, +sel: List<&2, U32>, +k: U32, +ck: Bool, +vs: U32, +ve: U32) -> List<&2, End>:
  match closed:
    case True{}:
      [EClosed{}]
    case False{}:
      [end_at(b, sel, k, ck, vs), end_at(b, sel, k, ck, ve)]

def ends_of(+b: J.Body, +sel: List<&2, U32>, +st: L.Stripe) -> List<&2, End>:
  match st:
    case L.NoSt{_, _, _}:
      Nil{}
    case L.St{k, _, _, convex, _, _, _, _, _, _, _, _, _, _}:
      +ed = K.edge_at(K.body_es(b), k)
      ends_of.c(K.edge_closed(ed), b, sel, k, convex, K.edge_s(ed), K.edge_e(ed))

# ---------------------------------------------------------------------------
# Corner helpers (the corners themselves are built by corners.bend)

def edge_faces.i(+i: K.Inc) -> List<&2, U32>:
  K.Inc{_, _, ff, fr} = i
  [ff, fr]

def edge_faces(+fs: List<&2, J.Face>, +e: U32) -> List<&2, U32>:
  edge_faces.i(K.incidence(fs, e))

def all_planes(+xs: List<&2, U32>, +fs: List<&2, J.Face>) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case x <> t:
      Bool.and(U32.is_eq(K.surf_kind(K.face_surf(K.face_at(fs, x))), 0), all_planes(t, fs))

def nth_u32.m(+m: Maybe<&2, U32>) -> U32:
  match m:
    case None{}:
      none_u32()
    case Some{x}:
      x

def nth_u32(+xs: List<&2, U32>, +i: Nat) -> U32:
  nth_u32.m(List.get(&2, U32, xs, i))

def fnormal(+fs: List<&2, J.Face>, +f: U32, +p: G.Vec3) -> G.Vec3:
  K.face_normal(K.face_at(fs, f), p)

# Ball centre touching the three planes: n_i·(c − v) = −r (convex) / +r.
def sphere_centre(+n1: G.Vec3, +n2: G.Vec3, +n3: G.Vec3, +v: G.Vec3, +r: R.Real, +convex: Bool) -> G.Vec3:
  +num = G.add(G.add(G.cross(n2, n3), G.cross(n3, n1)), G.cross(n1, n2))
  +det = G.dot(n1, G.cross(n2, n3))
  +s = K.pick_r(convex, R.neg(r), r)
  K.axpy(v, R.div(s, det), num)

def sel_at(+xs: List<&2, U32>, +sel: List<&2, U32>, +acc: List<&2, U32>) -> List<&2, U32>:
  match xs:
    case Nil{}:
      List.reverse(&2, U32, acc)
    case x <> t:
      +xx = x
      sel_at(t, sel, K.push_if(K.mem(sel, xx), xx, acc))

# ---------------------------------------------------------------------------
# Post-processing of one stripe: both width bounds and both ends.

type Post is Data:
  Post{b1: Bnd, b2: Bnd, ends: List<&2, End>}
  PostNo{}

def post(+b: J.Body, +ss: List<&2, L.Stripe>, +sel: List<&2, U32>, +st: L.Stripe) -> Post:
  match st:
    case L.NoSt{_, _, _}:
      PostNo{}
    case L.St{k, _, _, _, _, _, sec, e2, s1, s2, _, _, _, _}:
      Post{side_bound(b, ss, k, sec, e2, s1), side_bound(b, ss, k, sec, e2, s2), ends_of(b, sel, st)}
