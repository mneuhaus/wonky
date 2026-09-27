import Base
import ../../real.bend as R
import ../../precise.bend as G
import ./job.bend as J
import ./geom.bend as S
import ./contact.bend as C
import ./main.bend as P
import ./solve2.bend as V
import ./obrep.bend as O
import ./fit.bend as F
import ./clear.bend as K

# Stage C2 of prototype C (docs/fillet/proto-rollingball.md): the B-rep of
# the blended body, built from the certified stations of stage C1 and the
# fitted blend geometry of fit.bend. Shared by both output variants
# (variant 0 "tori", 1 "spline"; only the blend surface differs).
#
# Scope (stage C2): every selected edge must be
#   - an open edge whose two end vertices have degree 3, carry no other
#     selected edge, and whose third face there (the cap) is a plane
#     perpendicular to the edge, so the end section lies in the cap: the
#     section (in the edge's normal plane) may leave the cap plane by at most
#     1e-9 mm, max(|a − v|, |b − v|)·sin(tilt) ≤ 1e-9 (the cap stays exact);
#     or
#   - a closed edge (a rim) whose vertex carries only seam edges besides it.
# Anything else (mitres, G1 chains, corners, oblique or curved caps) is
# refused as `vertex-blend`, naming the vertex.
#
# Surgery, per blend of edge e between face A (runs e forward) and face B:
#   - end vertex v -> a (the contact point on A; the vertex index is kept) and
#     a new vertex b (the contact point on B); edges at v on face A keep v,
#     the ones on face B move to b; moved line edges are rebuilt from their
#     new end points, circles keep their curve and get new ranges;
#   - edge e becomes spring B (b_s -> b_e); spring A (a_s -> a_e), the start
#     section XS (b_s -> a_s) and the end section XE (a_e -> b_e) are new
#     edges; a rim gets one section X (a -> b), the seam of its blend face;
#   - face A uses spring A where it used e; face B uses spring B; a cap loop
#     that no longer chains at a moved vertex gets the section edge there;
#   - the blend face: [-SA, -XS, +SB, -XE], rim [-SA, +X, +SB, -X];
#   - fillet radius = post radius (the sphere cap): spring A is a point, and
#     face A must be a disc whose only loop is e; it is dropped and the blend
#     face is [+X, +SB, -X].
#
# Overflow (certified, clear.bend; docs/fillet/proto-rollingball.md, stage
# C2): the contact points must stay inside the edges they slide along by
# more than the modelling tolerance τ = 1e-6 − 1e-9 mm (face-consumed within
# τ of the far end: the face would vanish or keep a sliver below the
# tolerance; overflow beyond it); every other edge of a support face must
# stay out of the strip the blend removes from that face, other cap edges
# out of the end triangle (v, a, b), and the springs of blends sharing a
# face out of each other's strips (blend-overlap) -- each certified over the
# whole edge, not sampled (face-consumed when an edge comes within τ, or
# cannot be certified clear).

def zero() -> R.Real:
  R.from_f32(0.0)

def one() -> R.Real:
  R.from_f32(1.0)

def eps() -> R.Real:
  F.eps()

def none() -> U32:
  4294967295

# ---------------------------------------------------------------------------
# One blend

# BlendNil is never built. It makes Blend a recursive type, which the
# native backend keeps boxed (one word). Flattened (sum types such as J.Curve
# and O.OSurf flatten too), the record is about 200 words, and two of them in
# one continuation break the backend's 255-word limit per def or
# continuation.
type Blend is Data:
  BlendNil{next: Blend}
  Blend{e: U32, fa: U32, fb: U32, vs: U32, ve: U32, closed: U32, dega: U32, spa: F.Shape, spb: F.Shape, xs: F.Shape, xe: F.Shape, pas: G.Vec3, pbs: G.Vec3, pae: G.Vec3, pbe: G.Vec3, surf: O.OSurf, same: U32, tol: R.Real, curve: J.Curve, t0: R.Real, dt: R.Real, sts: List<&2, C.St>, wa: R.Real, wb: R.Real, kind: String}

def b_e(+b: Blend) -> U32:
  match b:
    case Blend{+x, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _}:
      x
    case BlendNil{_}:
      0

def b_fa(+b: Blend) -> U32:
  match b:
    case Blend{_, +x, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _}:
      x
    case BlendNil{_}:
      0

def b_fb(+b: Blend) -> U32:
  match b:
    case Blend{_, _, +x, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _}:
      x
    case BlendNil{_}:
      0

def b_vs(+b: Blend) -> U32:
  match b:
    case Blend{_, _, _, +x, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _}:
      x
    case BlendNil{_}:
      0

def b_ve(+b: Blend) -> U32:
  match b:
    case Blend{_, _, _, _, +x, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _}:
      x
    case BlendNil{_}:
      0

def b_closed(+b: Blend) -> Bool:
  match b:
    case Blend{_, _, _, _, _, +x, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _}:
      U32.is_eq(x, 1)
    case BlendNil{_}:
      False{}

def b_dega(+b: Blend) -> Bool:
  match b:
    case Blend{_, _, _, _, _, _, +x, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _}:
      U32.is_eq(x, 1)
    case BlendNil{_}:
      False{}

def b_spa(+b: Blend) -> F.Shape:
  match b:
    case Blend{_, _, _, _, _, _, _, +x, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _}:
      x
    case BlendNil{_}:
      F.line_shape(G.v3(0.0, 0.0, 0.0), G.v3(1.0, 0.0, 0.0))

def b_spb(+b: Blend) -> F.Shape:
  match b:
    case Blend{_, _, _, _, _, _, _, _, +x, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _}:
      x
    case BlendNil{_}:
      F.line_shape(G.v3(0.0, 0.0, 0.0), G.v3(1.0, 0.0, 0.0))

def b_xs(+b: Blend) -> F.Shape:
  match b:
    case Blend{_, _, _, _, _, _, _, _, _, +x, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _}:
      x
    case BlendNil{_}:
      F.line_shape(G.v3(0.0, 0.0, 0.0), G.v3(1.0, 0.0, 0.0))

def b_xe(+b: Blend) -> F.Shape:
  match b:
    case Blend{_, _, _, _, _, _, _, _, _, _, +x, _, _, _, _, _, _, _, _, _, _, _, _, _, _}:
      x
    case BlendNil{_}:
      F.line_shape(G.v3(0.0, 0.0, 0.0), G.v3(1.0, 0.0, 0.0))

def b_pas(+b: Blend) -> G.Vec3:
  match b:
    case Blend{_, _, _, _, _, _, _, _, _, _, _, +x, _, _, _, _, _, _, _, _, _, _, _, _, _}:
      x
    case BlendNil{_}:
      G.v3(0.0, 0.0, 0.0)

def b_pbs(+b: Blend) -> G.Vec3:
  match b:
    case Blend{_, _, _, _, _, _, _, _, _, _, _, _, +x, _, _, _, _, _, _, _, _, _, _, _, _}:
      x
    case BlendNil{_}:
      G.v3(0.0, 0.0, 0.0)

def b_pae(+b: Blend) -> G.Vec3:
  match b:
    case Blend{_, _, _, _, _, _, _, _, _, _, _, _, _, +x, _, _, _, _, _, _, _, _, _, _, _}:
      x
    case BlendNil{_}:
      G.v3(0.0, 0.0, 0.0)

def b_pbe(+b: Blend) -> G.Vec3:
  match b:
    case Blend{_, _, _, _, _, _, _, _, _, _, _, _, _, _, +x, _, _, _, _, _, _, _, _, _, _}:
      x
    case BlendNil{_}:
      G.v3(0.0, 0.0, 0.0)

def b_surf(+b: Blend) -> O.OSurf:
  match b:
    case Blend{_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, +x, _, _, _, _, _, _, _, _, _}:
      x
    case BlendNil{_}:
      O.OAn{J.BadSurf{}}

def b_same(+b: Blend) -> U32:
  match b:
    case Blend{_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, +x, _, _, _, _, _, _, _, _}:
      x
    case BlendNil{_}:
      0

def b_tol(+b: Blend) -> R.Real:
  match b:
    case Blend{_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, +x, _, _, _, _, _, _, _}:
      x
    case BlendNil{_}:
      zero()

def b_curve(+b: Blend) -> J.Curve:
  match b:
    case Blend{_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, +x, _, _, _, _, _, _}:
      x
    case BlendNil{_}:
      J.BadCurve{}

def b_t0(+b: Blend) -> R.Real:
  match b:
    case Blend{_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, +x, _, _, _, _, _}:
      x
    case BlendNil{_}:
      zero()

def b_dt(+b: Blend) -> R.Real:
  match b:
    case Blend{_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, +x, _, _, _, _}:
      x
    case BlendNil{_}:
      zero()

def b_sts(+b: Blend) -> List<&2, C.St>:
  match b:
    case Blend{_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, +x, _, _, _}:
      x
    case BlendNil{_}:
      Nil{}

def b_wa(+b: Blend) -> R.Real:
  match b:
    case Blend{_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, +x, _, _}:
      x
    case BlendNil{_}:
      zero()

def b_wb(+b: Blend) -> R.Real:
  match b:
    case Blend{_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, +x, _}:
      x
    case BlendNil{_}:
      zero()

def b_kind(+b: Blend) -> String:
  match b:
    case Blend{_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, +x}:
      x
    case BlendNil{_}:
      ""

type Built is Data:
  BOk{b: Blend}
  BRef{e: U32, cls: String, why: String}
  BSeam{e: U32}

# ---------------------------------------------------------------------------
# Job lookups

def job_op(+job: J.Job) -> U32:
  J.Job{_, +op, _, _, _, _, _} = job
  op

def job_size(+job: J.Job) -> R.Real:
  J.Job{_, _, +size, _, _, _, _} = job
  size

def job_verts(+job: J.Job) -> List<&2, G.Vec3>:
  J.Job{_, _, _, +vs, _, _, _} = job
  vs

def job_edges(+job: J.Job) -> List<&2, J.Edge>:
  J.Job{_, _, _, _, +es, _, _} = job
  es

def job_faces(+job: J.Job) -> List<&2, J.Face>:
  J.Job{_, _, _, _, _, +fs, _} = job
  fs

def edge.or(m: Maybe<&2, J.Edge>) -> J.Edge:
  match m:
    case Some{e}:
      e
    case None{}:
      J.Edge{0, 0, J.BadCurve{}, 0, 0, zero(), zero()}

def edge_at(+job: J.Job, +i: U32) -> J.Edge:
  edge.or(List.get(&2, J.Edge, job_edges(job), U32.to_nat(i)))

def face.or(m: Maybe<&2, J.Face>) -> J.Face:
  match m:
    case Some{f}:
      f
    case None{}:
      J.Face{0, J.BadSurf{}, Nil{}, Nil{}}

def face_at(+job: J.Job, +i: U32) -> J.Face:
  face.or(List.get(&2, J.Face, job_faces(job), U32.to_nat(i)))

def vert_at(+job: J.Job, +i: U32) -> G.Vec3:
  S.nth_v(job_verts(job), i)

def ed_start(+e: J.Edge) -> U32:
  J.Edge{+s, _, _, _, _, _, _} = e
  s

def ed_end(+e: J.Edge) -> U32:
  J.Edge{_, +x, _, _, _, _, _} = e
  x

def ed_curve(+e: J.Edge) -> J.Curve:
  J.Edge{_, _, +c, _, _, _, _} = e
  c

def face_surf(+f: J.Face) -> J.Surf:
  J.Face{_, +s, _, _} = f
  s

def face_uses(+f: J.Face) -> List<&2, J.Use>:
  J.Face{_, _, +us, _} = f
  us

def face_loops(+f: J.Face) -> List<&2, J.Loop>:
  J.Face{_, _, _, +ls} = f
  ls

def use_edge(+u: J.Use) -> U32:
  J.Use{+e, _} = u
  e

def use_fwd(+u: J.Use) -> U32:
  J.Use{_, +f} = u
  f

# Faces of every edge: the first two faces using it (none() when missing).
type FP is Data:
  FP{a: U32, b: U32}

def fp.of(us: List<&2, P.Use3>) -> FP:
  match us:
    case Nil{}:
      FP{none(), none()}
    case +x <> t:
      match t:
        case Nil{}:
          FP{P.use_face(x), none()}
        case +y <> _:
          FP{P.use_face(x), P.use_face(y)}

def efaces.go(+n: Nat, +fs: List<&2, J.Face>, +i: U32) -> List<&2, FP>:
  match n:
    case 0n:
      Nil{}
    case 1n+p:
      fp.of(P.uses_of(fs, i, 0, Nil{})) <> efaces.go(p, fs, (i + 1 : U32))

def efaces(+job: J.Job) -> List<&2, FP>:
  efaces.go(List.length(&2, J.Edge, job_edges(job)), job_faces(job), 0)

def fp.or(m: Maybe<&2, FP>) -> FP:
  match m:
    case Some{x}:
      x
    case None{}:
      FP{none(), none()}

def fp_at(+ef: List<&2, FP>, +i: U32) -> FP:
  fp.or(List.get(&2, FP, ef, U32.to_nat(i)))

def fp_has(+p: FP, +f: U32) -> Bool:
  FP{+a, +b} = p
  Bool.or(U32.is_eq(a, f), U32.is_eq(b, f))

def fp_other(+p: FP, +f: U32) -> U32:
  FP{+a, +b} = p
  Bool.pick(U32, U32.is_eq(a, f), b, a)

def fp_seam(+p: FP) -> Bool:
  FP{+a, +b} = p
  U32.is_eq(a, b)

def on_face(+ef: List<&2, FP>, +g: U32, +f: U32) -> Bool:
  fp_has(fp_at(ef, g), f)

# Keep x in front of rest when b holds. The walks below compute their
# recursive call once and select with this (a Bool.pick over two recursive
# calls evaluates both: exponential).
def cons_if(+b: Bool, +x: U32, +rest: List<&2, U32>) -> List<&2, U32>:
  match b:
    case True{}:
      x <> rest
    case False{}:
      rest

def inc_if(+b: Bool, +n: Nat) -> Nat:
  match b:
    case True{}:
      1n+n
    case False{}:
      n

# Edges incident to vertex v.
def incident.go(es: List<&2, J.Edge>, +v: U32, +i: U32) -> List<&2, U32>:
  match es:
    case Nil{}:
      Nil{}
    case +h <> +t:
      +hit = Bool.or(U32.is_eq(ed_start(h), v), U32.is_eq(ed_end(h), v))
      cons_if(hit, i, incident.go(t, v, (i + 1 : U32)))

def incident(+job: J.Job, +v: U32) -> List<&2, U32>:
  incident.go(job_edges(job), v, 0)

def u32_in(xs: List<&2, U32>, +x: U32) -> Bool:
  match xs:
    case Nil{}:
      False{}
    case +h <> +t:
      Bool.or(U32.is_eq(h, x), u32_in(t, x))

def without(xs: List<&2, U32>, +x: U32) -> List<&2, U32>:
  match xs:
    case Nil{}:
      Nil{}
    case +h <> +t:
      cons_if(Bool.not(U32.is_eq(h, x)), h, without(t, x))

def count_in(xs: List<&2, U32>, +set: List<&2, U32>) -> Nat:
  match xs:
    case Nil{}:
      0n
    case +h <> +t:
      inc_if(u32_in(set, h), count_in(t, set))

def uses_edges(us: List<&2, J.Use>) -> List<&2, U32>:
  match us:
    case Nil{}:
      Nil{}
    case +h <> +t:
      use_edge(h) <> uses_edges(t)

# ---------------------------------------------------------------------------
# Building one blend from its stations

def sign_of_dt(+dt: R.Real) -> R.Real:
  Bool.pick(R.Real, R.less(dt, zero()), R.neg(one()), one())

def width(+which: U32, sts: List<&2, C.St>, +acc: R.Real) -> R.Real:
  match sts:
    case Nil{}:
      acc
    case +h <> +t:
      width(which, t, R.max(acc, F.dist(F.st_pick(which, h), F.st_p(h))))

def surf.of(+variant: U32, +op: U32, +size: R.Real, +curve: J.Curve, +dsgn: R.Real, +nref: G.Vec3, +closed: Bool, +coax: Bool, +sts: List<&2, C.St>, +fa: F.Fit, +fb: F.Fit) -> F.Surface:
  match variant:
    case 0:
      F.tori(op, size, nref, closed, sts, fa, fb)
    case _:
      F.spline(op, size, curve, dsgn, nref, closed, coax, sts)

# nref: the outward reference normal of the blend face (fit.bend): the sum of
# the support faces' outward normals at the contact points of station 0.
# coax: the edge is a circle and both supports are symmetric about its axis
# (the true blend is a surface of revolution; fit.bend `spline`).
type Geo is Data:
  Geo{e: U32, fa: U32, fb: U32, vs: U32, ve: U32, closed: Bool, curve: J.Curve, t0: R.Real, dt: R.Real, op: U32, size: R.Real, sts: List<&2, C.St>, nref: G.Vec3, coax: Bool}

def geo_closed(+g: Geo) -> Bool:
  Geo{_, _, _, _, _, +x, _, _, _, _, _, _, _, _} = g
  x

def geo_e(+g: Geo) -> U32:
  Geo{+e, _, _, _, _, _, _, _, _, _, _, _, _, _} = g
  e

def blend.ok(+g: Geo, +fa: F.Fit, +fb: F.Fit, +surf: O.OSurf, +same: U32, +tol: R.Real, +kind: String) -> Built:
  Geo{+e, +ia, +ib, +vs, +ve, +closed, +curve, +t0, +dt, +op, +size, +sts, _, _} = g
  +s0 = F.nth_st(sts, 0n)
  +sn = F.nth_st(sts, 64n)
  +pa = F.points(1, sts)
  +pb = F.points(2, sts)
  +dega = U32.is_eq(F.fit_kind(fa), 0)
  +spa = F.spring_shape(fa, pa, closed)
  +spb = F.spring_shape(fb, pb, closed)
  +xs = Bool.pick(F.Shape, closed, F.sec_shape(op, size, s0, True{}), F.sec_shape(op, size, s0, False{}))
  +xe = F.sec_shape(op, size, sn, True{})
  BOk{Blend{e, ia, ib, vs, ve, Bool.to_u32(closed), Bool.to_u32(dega), spa, spb, xs, xe, F.st_pa(s0), F.st_pb(s0), F.st_pa(sn), F.st_pb(sn), surf, same, tol, curve, t0, dt, sts, width(1, sts, zero()), width(2, sts, zero()), kind}}

def blend.surf(+s: F.Surface, +g: Geo, +fa: F.Fit, +fb: F.Fit) -> Built:
  match s:
    case F.SurfOk{+surf, +same, _, +tol, +kind}:
      blend.ok(g, fa, fb, surf, same, tol, kind)
    case F.SurfBad{+cls, +why}:
      BRef{geo_e(g), cls, why}

# code: 0 build, 1 a contact curve is neither a line nor a circle, 2 a
# contact curve collapses to a point (face consumed).
def blend.pick(+code: U32, +g: Geo, +variant: U32, +fa: F.Fit, +fb: F.Fit) -> Built:
  match code:
    case 0:
      Geo{_, _, _, _, _, +closed, +curve, _, +dt, +op, +size, +sts, +nref, +coax} = g
      blend.surf(surf.of(variant, op, size, curve, sign_of_dt(dt), nref, closed, coax, sts, fa, fb), g, fa, fb)
    case 1:
      Geo{+e, +ia, +ib, _, _, _, _, _, _, _, _, _, _, _} = g
      BRef{e, "not-implemented", "a contact curve of edge " ++ U32.show(e) ++ " is not a line or circle within 1e-9 mm (faces " ++ U32.show(ia) ++ " and " ++ U32.show(ib) ++ "); a spring off an exact support needs a toleranced support face, not built in stage C2"}
    case _:
      Geo{+e, +ia, +ib, _, _, _, _, _, _, _, _, _, _, _} = g
      BRef{e, "face-consumed", "the contact curve on face " ++ U32.show(Bool.pick(U32, U32.is_eq(F.fit_kind(fb), 0), ib, ia)) ++ " collapses to a point"}

def blend.fits(+g: Geo, +variant: U32, +fa: F.Fit, +fb: F.Fit) -> Built:
  +ka = F.fit_kind(fa)
  +kb = F.fit_kind(fb)
  +curved = Bool.or(U32.is_eq(ka, 3), U32.is_eq(kb, 3))
  +point = Bool.or(U32.is_eq(kb, 0), Bool.and(U32.is_eq(ka, 0), Bool.not(geo_closed(g))))
  blend.pick(Bool.pick(U32, curved, 1, Bool.pick(U32, point, 2, 0)), g, variant, fa, fb)

# Outward normal of face f (its sense applied) at a point p on it.
def face_normal(+f: J.Face, +p: G.Vec3) -> G.Vec3:
  J.Face{+same, +sf, _, _} = f
  +n = F.an_normal(sf, p)
  Bool.pick(G.Vec3, U32.is_eq(same, 1), n, S.vneg(n))

# The blend's outward reference normal (see Geo).
def ref_normal(+job: J.Job, +ia: U32, +ib: U32, +s0: C.St) -> G.Vec3:
  G.add(face_normal(face_at(job, ia), F.st_pa(s0)), face_normal(face_at(job, ib), F.st_pb(s0)))

# Support surface s symmetric about the axis (o, unit n): a plane normal to
# it (1e-12 rad), or a surface of revolution whose axis is it (1e-12 rad,
# 1e-9 mm).
def par(+a: G.Vec3, +n: G.Vec3) -> Bool:
  R.less(F.norm(G.cross(F.unit(a), n)), R.div(one(), R.from_f32(1000000000000.0)))

def on_axis(+p: G.Vec3, +o: G.Vec3, +n: G.Vec3) -> Bool:
  R.less(F.norm(G.cross(G.sub(p, o), n)), eps())

def surf_coax(+s: J.Surf, +o: G.Vec3, +n: G.Vec3) -> Bool:
  match s:
    case J.Plane{_, np, _}:
      par(np, n)
    case J.Cyl{os, a, _, _}:
      Bool.and(par(a, n), on_axis(os, o, n))
    case J.Cone{os, a, _, _, _}:
      Bool.and(par(a, n), on_axis(os, o, n))
    case J.Sphere{os, _, _, _}:
      on_axis(os, o, n)
    case J.Torus{os, a, _, _, _}:
      Bool.and(par(a, n), on_axis(os, o, n))
    case J.BadSurf{}:
      False{}

def coax_of(+c: J.Curve, +sa: J.Surf, +sb: J.Surf) -> Bool:
  match c:
    case J.Circle{+o, +n, _, _}:
      Bool.and(surf_coax(sa, o, F.unit(n)), surf_coax(sb, o, F.unit(n)))
    case _:
      False{}

def blend.iv(+job: J.Job, +variant: U32, +e: U32, +ia: U32, +ib: U32, +sts: List<&2, C.St>, +ed: J.Edge, iv: R.Real & R.Real) -> Built:
  (+t0, +t1) = iv
  +vs = ed_start(ed)
  +ve = ed_end(ed)
  +closed = U32.is_eq(vs, ve)
  +dt = R.sub(t1, t0)
  +nref = ref_normal(job, ia, ib, F.nth_st(sts, 0n))
  +coax = coax_of(ed_curve(ed), face_surf(face_at(job, ia)), face_surf(face_at(job, ib)))
  +g = {Geo{e, ia, ib, vs, ve, closed, ed_curve(ed), t0, dt, job_op(job), job_size(job), sts, nref, coax} : Geo}
  blend.fits(g, variant, F.fit(F.points(1, sts), closed), F.fit(F.points(2, sts), closed))

def blend.make(+job: J.Job, +variant: U32, +e: U32, +ia: U32, +ib: U32, +sts: List<&2, C.St>) -> Built:
  +ed = edge_at(job, e)
  blend.iv(job, variant, e, ia, ib, sts, ed, S.interval(ed, job_verts(job)))

def blend.of(+job: J.Job, +variant: U32, +o: V.Edge2) -> Built:
  match o:
    case V.EOk{+e, _, +ia, +ib, +sts, _}:
      blend.make(job, variant, e, ia, ib, sts)
    case V.ERef{+e, +cls, +why}:
      BRef{e, cls, why}
    case V.ESeam{+e}:
      BSeam{e}

# ---------------------------------------------------------------------------
# Admission (stage C2 scope) and overflow checks

type Chk is Data:
  COk{}
  CRef{cls: String, why: String}

def chk_then(+a: Chk, +b: Chk) -> Chk:
  match a:
    case COk{}:
      b
    case CRef{+c, +w}:
      CRef{c, w}

def u32_or(m: Maybe<&2, U32>) -> U32:
  match m:
    case Some{x}:
      x
    case None{}:
      none()

def nth_u(+xs: List<&2, U32>, +k: Nat) -> U32:
  u32_or(List.get(&2, U32, xs, k))

# Unit tangent of the blend's edge at fraction 0 (start) or 1 (end), in the
# start -> end direction.
def tangent_end(+b: Blend, +at_end: Bool) -> G.Vec3:
  +dt = b_dt(b)
  +t = Bool.pick(R.Real, at_end, R.add(b_t0(b), dt), b_t0(b))
  G.scale(F.unit(F.pd_d(S.curve_pd(b_curve(b), t))), sign_of_dt(dt))

# How far the end section (in the edge's normal plane at v, within reach of
# v) leaves the plane of the cap: reach·sin(tilt), with sin(tilt) = |n × t|
# (not 1 − |n·t|, which loses the tilt below 1e-8 rad). A curved cap: huge.
def cap_off(+s: J.Surf, +tan: G.Vec3, +reach: R.Real) -> R.Real:
  match s:
    case J.Plane{_, n, _}:
      R.mul(reach, F.norm(G.cross(F.unit(n), tan)))
    case _:
      S.huge()

# The edge at v on face f (other than the blend edge), or none().
def at_on.go(xs: List<&2, U32>, +ef: List<&2, FP>, +f: U32) -> U32:
  match xs:
    case Nil{}:
      none()
    case +h <> +t:
      Bool.pick(U32, on_face(ef, h, f), h, at_on.go(t, ef, f))

def edge_at_on(+job: J.Job, +ef: List<&2, FP>, +b: Blend, +v: U32, +f: U32) -> U32:
  at_on.go(without(incident(job, v), b_e(b)), ef, f)

def cap_face(+job: J.Job, +ef: List<&2, FP>, +b: Blend, +v: U32) -> U32:
  fp_other(fp_at(ef, edge_at_on(job, ef, b, v, b_fa(b))), b_fa(b))

def admit.open(+job: J.Job, +ef: List<&2, FP>, +built: List<&2, U32>, +b: Blend, +v: U32, +tan: G.Vec3, +pa: G.Vec3, +pb: G.Vec3) -> Chk:
  +others = without(incident(job, v), b_e(b))
  +nsel = count_in(others, built)
  +n = List.length(&2, U32, others)
  +fa = b_fa(b)
  +fb = b_fb(b)
  +ga = edge_at_on(job, ef, b, v, fa)
  +gb = edge_at_on(job, ef, b, v, fb)
  +ca = fp_other(fp_at(ef, ga), fa)
  +cb = fp_other(fp_at(ef, gb), fb)
  +split = Bool.and(Bool.not(U32.is_eq(ga, gb)), Bool.and(Bool.not(on_face(ef, ga, fb)), Bool.not(on_face(ef, gb, fa))))
  +same_cap = Bool.and(U32.is_eq(ca, cb), Bool.not(U32.is_eq(ca, none())))
  +pv = vert_at(job, v)
  +off = cap_off(face_surf(face_at(job, ca)), tan, R.max(F.dist(pa, pv), F.dist(pb, pv)))
  +plane = R.less(off, S.huge())
  +perp = Bool.not(R.less(eps(), off))
  +vt = "vertex " ++ U32.show(v)
  +r_sel = {CRef{"vertex-blend", vt ++ " joins " ++ Nat.show(1n+nsel) ++ " selected edges (mitres, G1 chains and corners are not built in stage C2)"} : Chk}
  +r_deg = {CRef{"vertex-blend", vt ++ " has degree " ++ Nat.show(1n+n) ++ " (stage C2 builds ends at degree-3 vertices)"} : Chk}
  +r_cap = {CRef{"vertex-blend", "the third face at " ++ vt ++ " is not one plane perpendicular to the edge (oblique and curved caps are not built in stage C2)"} : Chk}
  +r_tilt = {CRef{"vertex-blend", "the cap plane at " ++ vt ++ " is tilted against the edge's normal plane: the end section would leave the exact cap by up to " ++ F.need_label(R.mul(off, R.from_f32(0.5))) ++ " mm, above 1e-9 mm (oblique caps are not built in stage C2; the tolerance is not grown silently)"} : Chk}
  +capped = Bool.and(split, Bool.and(same_cap, plane))
  Bool.pick(Chk, Nat.is_gt(nsel, 0n), r_sel, Bool.pick(Chk, Bool.not(Nat.is_eq(n, 2n)), r_deg, Bool.pick(Chk, Bool.not(capped), r_cap, Bool.pick(Chk, Bool.not(perp), r_tilt, COk{}))))

def all_seams(xs: List<&2, U32>, +ef: List<&2, FP>, +fa: U32, +fb: U32) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case +h <> +t:
      +p = fp_at(ef, h)
      Bool.and(Bool.and(fp_seam(p), Bool.or(fp_has(p, fa), fp_has(p, fb))), all_seams(t, ef, fa, fb))

# Face A of a sphere cap must be a disc bounded by the blend edge alone.
def disc_only(+f: J.Face, +e: U32) -> Bool:
  +us = face_uses(f)
  Bool.and(Nat.is_eq(List.length(&2, J.Use, us), 1n), U32.is_eq(nth_u(uses_edges(us), 0n), e))

def admit.closed(+job: J.Job, +ef: List<&2, FP>, +b: Blend) -> Chk:
  +v = b_vs(b)
  +others = without(incident(job, v), b_e(b))
  +seams = all_seams(others, ef, b_fa(b), b_fb(b))
  +disc = disc_only(face_at(job, b_fa(b)), b_e(b))
  +r_v = {CRef{"vertex-blend", "vertex " ++ U32.show(v) ++ " of the closed edge carries edges other than seams"} : Chk}
  +r_d = {CRef{"face-consumed", "the spring on face " ++ U32.show(b_fa(b)) ++ " collapses to a point but the face has other boundaries"} : Chk}
  Bool.pick(Chk, Bool.not(seams), r_v, Bool.pick(Chk, Bool.and(b_dega(b), Bool.not(disc)), r_d, COk{}))

def admit(+job: J.Job, +ef: List<&2, FP>, +built: List<&2, U32>, +b: Blend) -> Chk:
  Bool.pick(Chk, b_closed(b), admit.closed(job, ef, b), chk_then(admit.open(job, ef, built, b, b_vs(b), tangent_end(b, False{}), b_pas(b), b_pbs(b)), admit.open(job, ef, built, b, b_ve(b), tangent_end(b, True{}), b_pae(b), b_pbe(b))))

# The strip the blend removes from its face A (side 1) or B (side 2).
def strip(+b: Blend, +side: U32) -> K.Region:
  K.strip_of(b_curve(b), b_t0(b), b_dt(b), b_closed(b), Bool.pick(R.Real, U32.is_eq(side, 1), b_wa(b), b_wb(b)))

# State of job edge g against a region (clear.bend: 0 clear, 1 touch,
# 2 inside, 3 not certified).
def edge_state.iv(+c: J.Curve, +reg: K.Region, iv: R.Real & R.Real) -> U32:
  (+t0, +t1) = iv
  K.curve_state(reg, c, t0, t1)

def edge_state(+job: J.Job, +g: U32, +reg: K.Region) -> U32:
  +ed = edge_at(job, g)
  edge_state.iv(ed_curve(ed), reg, S.interval(ed, job_verts(job)))

def state_chk(+s: U32, +over_cls: String, +what: String) -> Chk:
  match s:
    case 0:
      COk{}
    case 1:
      CRef{"face-consumed", what ++ " (touching or within the 1e-6 mm modelling tolerance: the face would vanish or keep a sliver below it)"}
    case 2:
      CRef{over_cls, what}
    case _:
      CRef{over_cls, what ++ " (not certified clear to the 1e-6 mm modelling tolerance)"}

def over.edges(gs: List<&2, U32>, +job: J.Job, +b: Blend, +reg: K.Region, +f: U32) -> Chk:
  match gs:
    case Nil{}:
      COk{}
    case +g <> +t:
      +s = edge_state(job, g, reg)
      chk_then(state_chk(s, "overflow", "the blend of edge " ++ U32.show(b_e(b)) ++ " reaches edge " ++ U32.show(g) ++ " of face " ++ U32.show(f)), over.edges(t, job, b, reg, f))

def drop_at(xs: List<&2, U32>, +bad: List<&2, U32>) -> List<&2, U32>:
  match xs:
    case Nil{}:
      Nil{}
    case +h <> +t:
      cons_if(Bool.not(u32_in(bad, h)), h, drop_at(t, bad))

def over.face(+job: J.Job, +b: Blend, +side: U32, +f: U32) -> Chk:
  +near = List.append(&2, U32, incident(job, b_vs(b)), incident(job, b_ve(b)))
  over.edges(drop_at(uses_edges(face_uses(face_at(job, f))), b_e(b) <> near), job, b, strip(b, side), f)

def ed_other(+ed: J.Edge, +v: U32) -> U32:
  Bool.pick(U32, U32.is_eq(ed_start(ed), v), ed_end(ed), ed_start(ed))

# The contact point p slides along edge g from v: it must stay strictly
# inside g.
def over.slide(+job: J.Job, +ef: List<&2, FP>, +b: Blend, +v: U32, +p: G.Vec3, +f: U32) -> Chk:
  +g = edge_at_on(job, ef, b, v, f)
  +pv = vert_at(job, v)
  +dp = F.dist(p, pv)
  +dw = F.dist(vert_at(job, ed_other(edge_at(job, g), v)), pv)
  +what = "the contact point of edge " ++ U32.show(b_e(b)) ++ " on face " ++ U32.show(f) ++ " runs past edge " ++ U32.show(g)
  +s = Bool.pick(U32, R.less(dp, R.sub(dw, K.mtol())), 0, Bool.pick(U32, R.less(dp, R.add(dw, K.mtol())), 1, 2))
  Bool.pick(Chk, U32.is_eq(g, none()), COk{}, state_chk(s, "overflow", what))

def over.cap.edges(gs: List<&2, U32>, +job: J.Job, +b: Blend, +tri: K.Region, +f: U32) -> Chk:
  match gs:
    case Nil{}:
      COk{}
    case +g <> +t:
      +s = edge_state(job, g, tri)
      chk_then(state_chk(s, "overflow", "the end section of edge " ++ U32.show(b_e(b)) ++ " cuts edge " ++ U32.show(g) ++ " of cap face " ++ U32.show(f)), over.cap.edges(t, job, b, tri, f))

def over.cap(+job: J.Job, +ef: List<&2, FP>, +b: Blend, +v: U32, +pa: G.Vec3, +pb: G.Vec3) -> Chk:
  +f = cap_face(job, ef, b, v)
  over.cap.edges(drop_at(uses_edges(face_uses(face_at(job, f))), incident(job, v)), job, b, K.STri{vert_at(job, v), pa, pb}, f)

# Blends sharing a support face: the spring of one on that face must stay
# out of the other's strip.
def side_face(+b: Blend, +side: U32) -> U32:
  Bool.pick(U32, U32.is_eq(side, 1), b_fa(b), b_fb(b))

def spring_state(+sp: F.Shape, +reg: K.Region) -> U32:
  F.Shape{+c, _, _, +first, +last} = sp
  K.curve_state(reg, c, first, last)

# Only blends on the same face are checked (a match, not a Bool.pick: the
# latter would run the certification for every pair).
def over.pair.k(+shared: Bool, +b1: Blend, +s1: U32, +b2: Blend, +s2: U32, +f: U32) -> Chk:
  match shared:
    case True{}:
      state_chk(spring_state(Bool.pick(F.Shape, U32.is_eq(s1, 1), b_spa(b1), b_spb(b1)), strip(b2, s2)), "blend-overlap", "the blends of edges " ++ U32.show(b_e(b1)) ++ " and " ++ U32.show(b_e(b2)) ++ " overlap on face " ++ U32.show(f))
    case False{}:
      COk{}

def over.pair.side(+b1: Blend, +s1: U32, +b2: Blend, +s2: U32) -> Chk:
  +f = side_face(b1, s1)
  over.pair.k(U32.is_eq(f, side_face(b2, s2)), b1, s1, b2, s2, f)

def over.pair(+b1: Blend, +b2: Blend) -> Chk:
  +skip = U32.is_eq(b_e(b1), b_e(b2))
  +c = chk_then(chk_then(over.pair.side(b1, 1, b2, 1), over.pair.side(b1, 1, b2, 2)), chk_then(over.pair.side(b1, 2, b2, 1), over.pair.side(b1, 2, b2, 2)))
  Bool.pick(Chk, skip, COk{}, c)

def over.pairs(bs: List<&2, Blend>, +b: Blend) -> Chk:
  match bs:
    case Nil{}:
      COk{}
    case +h <> +t:
      chk_then(over.pair(b, h), over.pairs(t, b))

def overflow(+job: J.Job, +ef: List<&2, FP>, +bs: List<&2, Blend>, +b: Blend) -> Chk:
  +fa = b_fa(b)
  +fb = b_fb(b)
  +vs = b_vs(b)
  +ve = b_ve(b)
  +dega = b_dega(b)
  +slide_a = Bool.pick(Chk, dega, COk{}, chk_then(over.slide(job, ef, b, vs, b_pas(b), fa), over.slide(job, ef, b, ve, b_pae(b), fa)))
  +slide_b = chk_then(over.slide(job, ef, b, vs, b_pbs(b), fb), over.slide(job, ef, b, ve, b_pbe(b), fb))
  +faces = chk_then(Bool.pick(Chk, dega, COk{}, over.face(job, b, 1, fa)), over.face(job, b, 2, fb))
  +caps = Bool.pick(Chk, b_closed(b), COk{}, chk_then(over.cap(job, ef, b, vs, b_pas(b), b_pbs(b)), over.cap(job, ef, b, ve, b_pae(b), b_pbe(b))))
  chk_then(chk_then(slide_a, slide_b), chk_then(chk_then(faces, caps), over.pairs(bs, b)))
