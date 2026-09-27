import Base
import ../../real.bend as R
import ../../precise.bend as G
import ./job.bend as J
import ./geom.bend as S

# The contact-circle solve at ONE station of one edge (docs/fillet/proto-rollingball.md,
# stage 1). Every station is solved from scratch at its own fixed edge
# parameter; nothing is marched, so stations are independent and run in
# parallel (main.bend).
#
# Fillet (rolling ball of radius r): find the ball centre c with
#   sd_A(c) = σ r,  sd_B(c) = σ r,  T·(c − P) = 0
# where sd_* are the signed face distances (outward positive), σ = −1 on a
# convex edge (ball in the material) and +1 on a concave one (ball in the
# void), P the edge point and T the edge tangent. The Jacobian rows are the
# unit face normals at the feet and T, so every Newton step is the 3×3 solve
# of monstertruck's contact-circle solver: intersect the two offset TANGENT
# planes at the current feet with the normal plane of the edge. The first
# step uses the tangent planes at P (exact for plane/plane edges and for
# coaxial rims whose section is two lines); the following Gauss-Newton steps
# re-project the centre onto both surfaces (closed-form closest points, the
# limit of monstertruck's uv Newton step) and solve again.
#
# Chamfer (Onshape EQUAL_OFFSETS, probe FP-a 2026-09-24): the setback d is
# measured ALONG each support face, perpendicular to the edge:
#   p_i = P + d (n_i × T_i)          (T_i: the edge as face i's coedge runs it)
# This is the geodesic when n_i × T_i is a straight line in the face (planes,
# cylinder and cone generators at a rim); the certificate checks that p_i
# lies on the face, and anything else fails it.
#
# Certificate of a station (`res`): the maximum over
#   |d_A(c) − σ r|, |d_B(c) − σ r|, |T·(c − P)|,
#   |d_A(q_A)|, |d_B(q_B)|, ||q_A − c| − r|, ||q_B − c| − r|
# with the TRUE (unsigned-radial) distances of geom.bend, q_* the contact
# feet. For a chamfer: |d_A(p_A)|, |d_B(p_B)|, ||p_i − P| − d|, |T·(p_i − P)|.

# The per-edge constants shared by all stations. dsgn: +1 when the edge runs
# with its curve parameter; ga/gb: face senses; fa/fb: +1 when the face's
# coedge runs the edge forward; op 0 fillet, 1 chamfer; m: stations are
# t0 + dt·k/m, k = 0..m.
type Ctx is Data:
  Ctx{curve: J.Curve, t0: R.Real, dt: R.Real, dsgn: R.Real, sa: S.PSurf, ga: R.Real, fa: R.Real, sb: S.PSurf, gb: R.Real, fb: R.Real, op: U32, size: R.Real, m: U32}

# One solved station. c: ball centre (the edge point P for a chamfer);
# pa/pb: contact points on faces A and B; res: certificate; s: (n_A × n_B)·T_A
# (> 0 convex, < 0 concave, 0 tangent); kmin: smallest signed radial
# coordinate of the centre (< 0: the ball went through an axis).
type St is Data:
  St{k: U32, t: R.Real, p: G.Vec3, c: G.Vec3, pa: G.Vec3, pb: G.Vec3, res: R.Real, s: R.Real, kmin: R.Real}

# The Newton system of one station.
type Sys is Data:
  Sys{sa: S.PSurf, ga: R.Real, ra: S.Ref, sb: S.PSurf, gb: R.Real, rb: S.Ref, t: G.Vec3, p: G.Vec3, target: R.Real}

def zero() -> R.Real:
  R.from_f32(0.0)

# x with a·x = al, b·x = be, e·x = ga (Cramer).
def solve3(+a: G.Vec3, +b: G.Vec3, +e: G.Vec3, al: R.Real, be: R.Real, ga: R.Real) -> G.Vec3:
  +bxe = G.cross(b, e)
  +det = G.dot(a, bxe)
  num = G.add(G.add(G.scale(bxe, al), G.scale(G.cross(e, a), be)), G.scale(G.cross(a, b), ga))
  G.scale(num, R.div(R.from_f32(1.0), det))

def step.k(+t: G.Vec3, +p: G.Vec3, +target: R.Real, +c: G.Vec3, +da: S.Sd, +db: S.Sd) -> G.Vec3:
  +delta = solve3(S.sd_g(da), S.sd_g(db), t, R.sub(target, S.sd_d(da)), R.sub(target, S.sd_d(db)), R.neg(G.dot(t, G.sub(c, p))))
  G.add(c, delta)

def step(+sys: Sys, +c: G.Vec3) -> G.Vec3:
  Sys{+sa, +ga, +ra, +sb, +gb, +rb, +t, +p, +target} = sys
  step.k(t, p, target, c, S.fsd(sa, ga, ra, c), S.fsd(sb, gb, rb, c))

def newton(fuel: Nat, +sys: Sys, +c: G.Vec3) -> G.Vec3:
  match fuel:
    case 0n:
      c
    case 1n+f:
      newton(f, sys, step(sys, c))

def dev(+a: R.Real) -> R.Real:
  R.abs(a)

def max4(+a: R.Real, +b: R.Real, +c: R.Real, +d: R.Real) -> R.Real:
  R.max(R.max(a, b), R.max(c, d))

# ---------------------------------------------------------------------------
# Fillet station

def fillet.feet(k: U32, +tp: R.Real, +sys: Sys, +c: G.Vec3, +da: S.Sd, +db: S.Sd, +s: R.Real, +size: R.Real) -> St:
  Sys{+sa, +ga, _, +sb, +gb, _, +t, +p, +target} = sys
  +qa = G.sub(c, G.scale(S.sd_g(da), S.sd_d(da)))
  +qb = G.sub(c, G.scale(S.sd_g(db), S.sd_d(db)))
  +centre = max4(dev(R.sub(S.true_d(sa, ga, c), target)), dev(R.sub(S.true_d(sb, gb, c), target)), dev(G.dot(t, G.sub(c, p))), zero())
  +feet = max4(dev(S.true_d(sa, ga, qa)), dev(S.true_d(sb, gb, qb)), dev(R.sub(S.norm(G.sub(qa, c)), size)), dev(R.sub(S.norm(G.sub(qb, c)), size)))
  St{k, tp, p, c, qa, qb, R.max(centre, feet), s, R.min(S.sd_k(da), S.sd_k(db))}

def fillet.done(k: U32, +tp: R.Real, +sys: Sys, +c: G.Vec3, +s: R.Real, +size: R.Real) -> St:
  Sys{+sa, +ga, +ra, +sb, +gb, +rb, _, _, _} = sys
  fillet.feet(k, tp, sys, c, S.fsd(sa, ga, ra, c), S.fsd(sb, gb, rb, c), s, size)

def fillet(k: U32, +tp: R.Real, +sys: Sys, +na: G.Vec3, +nb: G.Vec3, +s: R.Real, +size: R.Real) -> St:
  Sys{_, _, _, _, _, _, +t, +p, +target} = sys
  +c0 = G.add(p, solve3(na, nb, t, target, target, zero()))
  fillet.done(k, tp, sys, newton(8n, sys, c0), s, size)

# ---------------------------------------------------------------------------
# Chamfer station

def chamfer(k: U32, +tp: R.Real, +sys: Sys, +na: G.Vec3, +nb: G.Vec3, +ta: G.Vec3, +tb: G.Vec3, +s: R.Real, +size: R.Real) -> St:
  Sys{+sa, +ga, _, +sb, +gb, _, +t, +p, _} = sys
  +pa = G.add(p, G.scale(G.cross(na, ta), size))
  +pb = G.add(p, G.scale(G.cross(nb, tb), size))
  +on = max4(dev(S.true_d(sa, ga, pa)), dev(S.true_d(sb, gb, pb)), dev(G.dot(t, G.sub(pa, p))), dev(G.dot(t, G.sub(pb, p))))
  +len = max4(dev(R.sub(S.norm(G.sub(pa, p)), size)), dev(R.sub(S.norm(G.sub(pb, p)), size)), zero(), zero())
  St{k, tp, p, p, pa, pb, R.max(on, len), s, S.huge()}

# ---------------------------------------------------------------------------
# Station k of an edge

def station.op(+op: U32, k: U32, +tp: R.Real, +sys: Sys, +na: G.Vec3, +nb: G.Vec3, +ta: G.Vec3, +tb: G.Vec3, +s: R.Real, +size: R.Real) -> St:
  match op:
    case 0:
      fillet(k, tp, sys, na, nb, s, size)
    case _:
      chamfer(k, tp, sys, na, nb, ta, tb, s, size)

def station.at(k: U32, +tp: R.Real, +ctx: Ctx, pd: G.Vec3 & G.Vec3) -> St:
  Ctx{_, _, _, +dsgn, +sa, +ga, +fa, +sb, +gb, +fb, +op, +size, _} = ctx
  (+p, +d) = pd
  +t = G.scale(G.normalize(d), dsgn)
  +ra = S.ref_of(sa, p)
  +rb = S.ref_of(sb, p)
  +na = S.sd_g(S.fsd(sa, ga, ra, p))
  +nb = S.sd_g(S.fsd(sb, gb, rb, p))
  +ta = G.scale(t, fa)
  +tb = G.scale(t, fb)
  +s = G.dot(G.cross(na, nb), ta)
  +target = Bool.pick(R.Real, R.less(s, zero()), size, R.neg(size))
  station.op(op, k, tp, Sys{sa, ga, ra, sb, gb, rb, t, p, target}, na, nb, ta, tb, s, size)

def station(+ctx: Ctx, +k: U32) -> St:
  Ctx{+curve, +t0, +dt, _, _, _, _, _, _, _, _, _, +m} = ctx
  +frac = R.div(R.from_f32(U32.to_f32(k)), R.from_f32(U32.to_f32(m)))
  +tp = R.add(t0, R.mul(dt, frac))
  station.at(k, tp, ctx, S.curve_pd(curve, tp))
