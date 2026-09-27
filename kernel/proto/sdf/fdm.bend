import Base
import ../../real.bend as R
import ../../precise.bend as G
import ../mesh.bend as M
import ../mesh-io.bend as MIO
import ./field.bend as F
import ./setup.bend as S
import ./octree.bend as O
import ./contour.bend as C
import ./main.bend as P

# FDM analyses that the implicit representation makes cheap (docs/proto-sdf.md).
# All results are approximations with the stated tolerances of main.bend
# (meshes within the case deviation of their carriers).
#
#   offset r     f - r            face-wise (mitered) offset: every carrier
#                                 moves by r along its outward normal (planes
#                                 shift, radii grow); convex edges stay sharp,
#                                 as with an intersection-join offset in CAD.
#                                 r > 0 grows the part (clearance on a pin),
#                                 r < 0 shrinks it (clearance in a hole).
#                                 Exact identity: min/max commute with - r.
#   shell t      max(f, -(f + t)) the part minus its inward offset: a closed
#                                 hollow body with walls of normal thickness t.
#                                 Inner carriers get tags + F (F = faces).
#   interference max(fA, fB)      the two operands of the root node,
#                                 intersected; its mesh volume is the overlap.
#   thickness t  rays             from every triangle centroid of the part's
#                                 mesh, inward along the triangle normal, the
#                                 distance to the opposite surface (sphere
#                                 tracing: f is 1-Lipschitz, so a step of |f|
#                                 never crosses the surface); the minimum and
#                                 the area thinner than t. A sampled estimate
#                                 of the local wall thickness, not a certified
#                                 medial-axis minimum.

type Ctx is Data:
  Ctx{tape: F.Tape, a: F.Tape, b: F.Tape, box: S.Box, abox: S.Box, dev: F32, rcone: F32, nfaces: U32, split: Bool}
  NoCtx{reason: String}

type Ray is Data:
  Ray{c: F.V, n: F.V}

# Balanced tree of ray batches (the fork tree of the device kernel).
type RT is Data:
  RL{rays: List<&2, Ray>}
  RN{a: RT, b: RT}

type TH is Data:
  TH{tmin: F32, at: F.V, nlow: U32, alow: F32, nrays: U32, rejected: U32}

type MR is Data:
  MR{t: F32, s: F32}

type RR is Data:
  RR{t: F32, ok: Bool}

type Prep is Data:
  Prep{res: P.Res, rt: RT, tape: F.Tape}
  NoPrep{reason: String}

# --- tape transforms --------------------------------------------------------

# The same carrier moved outward by d (its function becomes g - d).
def shift_fn(f: F.Fn, +d: F32) -> F.Fn:
  match f:
    case F.FPlane{nx, ny, nz, dd}:
      F.FPlane{nx, ny, nz, (dd + d : F32)}
    case F.FCyl{ox, oy, oz, ax, ay, az, r}:
      F.FCyl{ox, oy, oz, ax, ay, az, (r + d : F32)}
    case F.FCone{ox, oy, oz, ax, ay, az, r, +c, s}:
      F.FCone{ox, oy, oz, ax, ay, az, (r + d / c : F32), c, s}
    case F.FSph{ox, oy, oz, r}:
      F.FSph{ox, oy, oz, (r + d : F32)}
    case F.FTor{ox, oy, oz, ax, ay, az, big, r}:
      F.FTor{ox, oy, oz, ax, ay, az, big, (r + d : F32)}

# f - r for the whole tape: a leaf entering negated moves the other way.
def shift_tape(t: F.Tape, +r: F32, +dt: U32) -> F.Tape:
  match t:
    case F.TLeaf{l}:
      F.Leaf{tag, canon, +neg, f} = l
      F.TLeaf{F.Leaf{(tag + dt : U32), (canon + dt : U32), neg, shift_fn(f, F.fneg(neg, r))}}
    case F.TMin{a, b}:
      F.TMin{shift_tape(a, r, dt), shift_tape(b, r, dt)}
    case F.TMax{a, b}:
      F.TMax{shift_tape(a, r, dt), shift_tape(b, r, dt)}
    case F.TPoly{neg, fr, es}:
      F.TPoly{neg, fr, es}

# Smallest positive curvature radius of the curved carriers of a tape.
def fn_r(f: F.Fn, +big: F32) -> F32:
  match f:
    case F.FCyl{_, _, _, _, _, _, +r}:
      F.pick((0.0 < r : F32), r, big)
    case F.FSph{_, _, _, +r}:
      F.pick((0.0 < r : F32), r, big)
    case F.FTor{_, _, _, _, _, _, _, +r}:
      F.pick((0.0 < r : F32), r, big)
    case _:
      big

def tape_r(t: F.Tape, +big: F32) -> F32:
  match t:
    case F.TLeaf{l}:
      F.Leaf{_, _, _, f} = l
      fn_r(f, big)
    case F.TMin{a, b}:
      F32.min(tape_r(a, big), tape_r(b, big))
    case F.TMax{a, b}:
      F32.min(tape_r(a, big), tape_r(b, big))
    case F.TPoly{_, _, _}:
      big

def grow(b: S.Box, +g: F32) -> S.Box:
  match b:
    case S.NoBox{}:
      S.NoBox{}
    case S.Box{x0, y0, z0, x1, y1, z1}:
      S.Box{(x0 - g : F32), (y0 - g : F32), (z0 - g : F32), (x1 + g : F32), (y1 + g : F32), (z1 + g : F32)}

def first2(t: M.Csg) -> Bool:
  match t:
    case M.CNode{_, _, _}:
      True{}
    case M.CLeaf{_}:
      False{}

def left(t: M.Csg) -> M.Csg:
  match t:
    case M.CNode{_, a, _}:
      a
    case M.CLeaf{i}:
      M.CLeaf{i}

def right(t: M.Csg) -> M.Csg:
  match t:
    case M.CNode{_, _, b}:
      b
    case M.CLeaf{i}:
      M.CLeaf{i}

def ctx.t(mt: Maybe<&2, F.Tape>, ma: Maybe<&2, F.Tape>, mb: Maybe<&2, F.Tape>, +box: S.Box, +abox: S.Box, +dev: F32, +rcone: F32, +nf: U32, +split: Bool) -> Ctx:
  match mt:
    case None{}:
      NoCtx{"malformed CSG"}
    case Some{t}:
      match ma:
        case None{}:
          NoCtx{"malformed CSG"}
        case Some{a}:
          match mb:
            case None{}:
              NoCtx{"malformed CSG"}
            case Some{b}:
              Ctx{t, a, b, box, abox, dev, rcone, nf, split}

def ctx.go(+dev: F32, +tree: M.Csg, +ps: List<&2, M.Prim>, +faces: List<&2, M.FaceTag>) -> Ctx:
  +box = S.csg_box(tree, ps)
  +tol = (P.box_scale(box) * 0.00001 + 0.000001 : F32)
  +rs = S.rows(faces)
  +lrs = S.canon_rows(rs, rs, tol)
  +leaves = S.leaf_tapes(ps, 0, lrs)
  +big = {1000000000.0 : F32}
  +l = left(tree)
  +r = right(tree)
  ctx.t(S.csg_tape(tree, leaves), S.csg_tape(l, leaves), S.csg_tape(r, leaves), box, S.box_meet(S.csg_box(l, ps), S.csg_box(r, ps)), dev, S.min_cone_radius(ps, big), M.count(&2, M.FaceTag, faces), first2(tree))

def ctx.c(c: S.Check, +dev: F32, +tree: M.Csg, +ps: List<&2, M.Prim>, +faces: List<&2, M.FaceTag>) -> Ctx:
  match c:
    case S.Refuse{r}:
      NoCtx{r}
    case S.Fine{}:
      ctx.go(dev, tree, ps, faces)

def ctx(p: M.JobParse) -> Ctx:
  match p:
    case M.Malformed{r}:
      NoCtx{"malformed-job " ++ r}
    case M.Parsed{job}:
      M.Job{_, dev, +tree, +ps, +faces, _} = job
      ctx.c(S.check_all(ps), R.approx(dev), tree, ps, faces)

def mesh_box(b: S.Box, t: F.Tape, +dev: F32, +rmin: F32) -> P.Res:
  match b:
    case S.NoBox{}:
      P.empty_res("(empty bounding box)")
    case S.Box{x0, y0, z0, x1, y1, z1}:
      +tt = t
      P.run_env(P.Env{tt, x0, y0, z0, x1, y1, z1, dev, F.size(tt)}, rmin)

# --- the operations -----------------------------------------------------------

# Offsets move carriers; the exact 2-D polygon distance of a non-convex prism
# would offset with rounded corners instead, so such tapes are refused.
def poly_refusal() -> String:
  "offset/shell of a non-convex prism (its exact polygon distance would round the convex corners; the face-wise offset is not implemented for it)"

def op_offset.k(poly: Bool, +t: F.Tape, +box: S.Box, +dev: F32, +rc: F32, +r: F32) -> P.Res:
  match poly:
    case True{}:
      P.RUnresolved{poly_refusal()}
    case False{}:
      +big = {1000000000.0 : F32}
      +st = shift_tape(t, r, 0)
      mesh_box(grow(box, (4.0 * F.absf(r) : F32)), st, dev, F32.max(0.05, F32.min(tape_r(st, big), (rc + r : F32))))

def op_offset(c: Ctx, +r: F32) -> P.Res:
  match c:
    case NoCtx{why}:
      P.RUnresolved{why}
    case Ctx{+t, _, _, box, _, dev, +rc, _, _}:
      op_offset.k(F.has_poly(t), t, box, dev, rc, r)

def op_shell.k(poly: Bool, +t: F.Tape, +box: S.Box, +dev: F32, +rc: F32, +nf: U32, +th: F32) -> P.Res:
  match poly:
    case True{}:
      P.RUnresolved{poly_refusal()}
    case False{}:
      +big = {1000000000.0 : F32}
      +inner = shift_tape(t, F32.neg(th), nf)
      mesh_box(box, F.TMax{t, F.negate(inner)}, dev, F32.max(0.05, F32.min(F32.min(tape_r(t, big), tape_r(inner, big)), (rc - th : F32))))

def op_shell(c: Ctx, +th: F32) -> P.Res:
  match c:
    case NoCtx{why}:
      P.RUnresolved{why}
    case Ctx{+t, _, _, box, _, dev, +rc, nf, _}:
      op_shell.k(F.has_poly(t), t, box, dev, rc, nf, th)

def op_interf(c: Ctx) -> P.Res:
  match c:
    case NoCtx{why}:
      P.RUnresolved{why}
    case Ctx{t, a, b, _, abox, dev, +rc, _, split}:
      match split:
        case False{}:
          P.RUnresolved{"interference needs a root node with two operands"}
        case True{}:
          +big = {1000000000.0 : F32}
          +ab = {F.TMax{a, b} : F.Tape}
          mesh_box(abox, ab, dev, F32.min(tape_r(ab, big), rc))

def rays(r: C.Rope, acc: List<&2, Ray>) -> List<&2, Ray>:
  match r:
    case C.RNil{}:
      acc
    case C.ROne{_, c, n}:
      Ray{c, n} <> acc
    case C.RCat{a, b}:
      rays(a, rays(b, acc))

# The first n rays (reversed) and the rest; tail-recursive (the JS target has
# a bounded stack).
def split_at(n: Nat, xs: List<&2, Ray>, acc: List<&2, Ray>) -> List<&2, Ray> & List<&2, Ray>:
  match n:
    case 0n:
      (acc, xs)
    case 1n+k:
      match xs:
        case Nil{}:
          (acc, Nil{})
        case x <> t:
          split_at(k, t, x <> acc)

def fst_rays(p: List<&2, Ray> & List<&2, Ray>) -> List<&2, Ray>:
  (a, _) = p
  a

def snd_rays(p: List<&2, Ray> & List<&2, Ray>) -> List<&2, Ray>:
  (_, b) = p
  b

def rt_build(+n: Nat, small: Bool, xs: List<&2, Ray>, +len: U32) -> RT:
  match n:
    case 0n:
      RL{xs}
    case 1n+k:
      match small:
        case True{}:
          RL{xs}
        case False{}:
          +h = U32.shr(len)
          +r = (len - h : U32)
          +xx = xs
          RN{rt_build(k, (h < 65 : U32), fst_rays(split_at(U32.to_nat(h), xx, Nil{})), h), rt_build(k, (r < 65 : U32), snd_rays(split_at(U32.to_nat(h), xx, Nil{})), r)}

# Two-phase sphere tracing along d from p: first inward to the entry (the
# chord centroid of a concave face lies up to the deviation outside the
# material), then to the exit. Steps are max(|f|, 1e-4): f is 1-Lipschitz, so
# a step of |f| never crosses the surface. Returns exit - entry (the local
# thickness along d), or at least cap.
def march(n: Nat, done: Bool, +inside: Bool, +sin: F32, +tape: F.Tape, +px: F32, +py: F32, +pz: F32, +dx: F32, +dy: F32, +dz: F32, +s: F32, +cap: F32) -> MR:
  match n:
    case 0n:
      MR{(s - sin : F32), s}
    case 1n+k:
      match done:
        case True{}:
          MR{(s - sin : F32), s}
        case False{}:
          +v = F.eval(tape, (px + s * dx : F32), (py + s * dy : F32), (pz + s * dz : F32))
          +isin = (v < (0.0 - 0.0001) : F32)
          +enter = Bool.and(Bool.not(inside), isin)
          +exit = Bool.and(inside, Bool.not(isin))
          +sin2 = F.pick(enter, s, sin)
          +s2 = (s + F32.max(F.absf(v), 0.0001) : F32)
          +snext = F.pick(exit, s, s2)
          march(k, Bool.or(exit, (cap < (snext - sin2 : F32) : F32)), Bool.or(inside, isin), sin2, tape, px, py, pz, dx, dy, dz, snext, cap)

# The exit is accepted when the face active there faces along the ray (its
# oriented normal within 60 degrees of d): an opposite wall. A ray that grazes
# a neighbouring face (it starts next to a rim) is rejected.
def ray_exit(m: MR, +tape: F.Tape, +px: F32, +py: F32, +pz: F32, +dx: F32, +dy: F32, +dz: F32, +cap: F32) -> RR:
  MR{+t, +s} = m
  +qx = (px + s * dx : F32)
  +qy = (py + s * dy : F32)
  +qz = (pz + s * dz : F32)
  +facing = (0.5 < O.dot(O.leaf_normal(O.hit_leaf(F.hit(tape, qx, qy, qz)), qx, qy, qz), F.V{dx, dy, dz}) : F32)
  RR{t, Bool.or(Bool.not((t < cap : F32)), facing)}

def ray_th(r: Ray, +tape: F.Tape, +cap: F32, +back: F32) -> RR:
  Ray{c, n} = r
  F.V{cx, cy, cz} = c
  F.V{+nx, +ny, +nz} = n
  +l = F.len3(nx, ny, nz)
  +dx = F32.neg((nx / l : F32))
  +dy = F32.neg((ny / l : F32))
  +dz = F32.neg((nz / l : F32))
  +px = (cx - back * dx : F32)
  +py = (cy - back * dy : F32)
  +pz = (cz - back * dz : F32)
  ray_exit(march(512n, False{}, False{}, 0.0, tape, px, py, pz, dx, dy, dz, 0.0, cap), tape, px, py, pz, dx, dy, dz, cap)

def ray_area(r: Ray) -> F32:
  Ray{_, n} = r
  F.V{nx, ny, nz} = n
  (F.len3(nx, ny, nz) * 0.5 : F32)

def ray_c(r: Ray) -> F.V:
  Ray{c, _} = r
  c

def rr_t(r: RR) -> F32:
  RR{t, _} = r
  t

def rr_ok(r: RR) -> Bool:
  RR{_, ok} = r
  ok

def th_one(+r: Ray, +tape: F.Tape, +tmin: F32, +cap: F32) -> TH:
  +rr = ray_th(r, tape, cap, 0.02)
  +ok = rr_ok(rr)
  +t = F.pick(ok, rr_t(rr), cap)
  +low = (t < tmin : F32)
  TH{t, ray_c(r), F.pickw(low, 1, 0), F.pick(low, ray_area(r), 0.0), 1, F.pickw(ok, 0, 1)}

def th_cat.k(second: Bool, ta: F32, pa: F.V, tb: F32, pb: F.V, +n: U32, +a: F32, +r: U32, +j: U32) -> TH:
  match second:
    case True{}:
      TH{tb, pb, n, a, r, j}
    case False{}:
      TH{ta, pa, n, a, r, j}

def th_cat(a: TH, b: TH) -> TH:
  TH{+ta, pa, na, aa, ra, ja} = a
  TH{+tb, pb, nb, ab, rb, jb} = b
  th_cat.k((tb < ta : F32), ta, pa, tb, pb, (na + nb : U32), (aa + ab : F32), (ra + rb : U32), (ja + jb : U32))

def th_list(rs: List<&2, Ray>, +tape: F.Tape, +tmin: F32, +cap: F32, acc: TH) -> TH:
  match rs:
    case Nil{}:
      acc
    case +r <> t:
      th_list(t, tape, tmin, cap, th_cat(acc, th_one(r, tape, tmin, cap)))

def th_zero(+cap: F32) -> TH:
  TH{cap, F.V{0.0, 0.0, 0.0}, 0, 0.0, 0, 0}

# The device kernel: a balanced fork over ray batches, flat loops at the
# leaves; the tape is only read.
def trace(t: RT, +tape: F.Tape, +tmin: F32, +cap: F32) -> TH:
  match t:
    case RL{rs}:
      th_list(rs, tape, tmin, cap, th_zero(cap))
    case RN{a, b}:
      x y = trace(a, tape, tmin, cap) trace(b, tape, tmin, cap)
      th_cat(x, y)

def prep.r(res: P.Res, +tape: F.Tape) -> Prep:
  match res:
    case P.RUnresolved{why}:
      NoPrep{why}
    case P.RSolved{m, i, +rope, v6}:
      +rs = rays(rope, Nil{})
      Prep{P.RSolved{m, i, rope, v6}, rt_build(24n, (M.count(&2, Ray, rs) < 65 : U32), rs, M.count(&2, Ray, rs)), tape}

def prep(c: Ctx) -> Prep:
  match c:
    case NoCtx{why}:
      NoPrep{why}
    case Ctx{+t, _, _, box, _, dev, +rc, _, _}:
      +big = {1000000000.0 : F32}
      prep.r(mesh_box(box, t, dev, F32.min(tape_r(t, big), rc)), t)

def um_s(+x: F32) -> String:
  Bool.pick(String, (x < 0.0 : F32), "-", "") ++ U32.show(F32.to_u32((F.absf(x) * 1000.0 : F32)))

def th_line(th: TH, +tmin: F32) -> String:
  TH{t, at, n, a, r, j} = th
  F.V{x, y, z} = at
  "fdm thickness tmin_um " ++ um_s(tmin) ++ " min_um " ++ um_s(t) ++ " at_um " ++ um_s(x) ++ "," ++ um_s(y) ++ "," ++ um_s(z) ++ " thin_tris " ++ U32.show(n) ++ " thin_area_mm2 " ++ P.vol_s((a * 6.0 : F32)) ++ " rays " ++ U32.show(r) ++ " grazing_rejected " ++ U32.show(j)

# Phase 2 of the thickness check: the ray kernel (a bang: the GPU in the
# Metal build, the CPU pool with --gpu off, sequential on the JS target).
def trace_th(+p: Prep, +tmin: F32) -> TH:
  match p:
    case NoPrep{_}:
      th_zero(tmin)
    case Prep{_, rt, tape}:
      trace!(rt, tape, tmin, (tmin * 4.0 : F32))

def th_sum(+t: TH) -> U32:
  TH{_, _, n, _, r, j} = t
  (n + r + j : U32)

# Phase 3: the report line and the mesh.
def thick_out(p: Prep, +th: TH, +tmin: F32) -> String:
  match p:
    case NoPrep{why}:
      "fdm thickness unresolved " ++ why ++ "\n"
    case Prep{res, _, _}:
      th_line(th, tmin) ++ "\n" ++ P.show(res)

def trace_prep(+p: Prep, +tmin: F32) -> String:
  thick_out(p, trace_th(p, tmin), tmin)

# --- entry points -------------------------------------------------------------

def vol_line(r: P.Res, +op: String) -> String:
  match r:
    case P.RSolved{_, _, _, v6}:
      "fdm " ++ op ++ " vol_mm3 " ++ P.vol_s(R.approx(v6))
    case P.RUnresolved{_}:
      "fdm " ++ op ++ " unresolved"

def with_line(+r: P.Res, +op: String) -> String:
  vol_line(r, op) ++ "\n" ++ P.show(r)

def param.u(s: String) -> F32:
  (U32.to_f32(Maybe.default(&2, U32, U32.read(s), 0)) / 1000.0 : F32)

# Parameter in micrometres ("-200" = -0.2 mm).
def param(s: String) -> F32:
  match s:
    case SCon{Chr{45}, t}:
      F32.neg(param.u(t))
    case _:
      param.u(s)

def op_is(+a: String, b: String) -> Bool:
  String.eq(a, b)

def run.k(o: Bool, s: Bool, i: Bool, +pm: F32, +job: String) -> String:
  match o:
    case True{}:
      with_line(op_offset(ctx(MIO.parse_job(job)), pm), "offset")
    case False{}:
      match s:
        case True{}:
          with_line(op_shell(ctx(MIO.parse_job(job)), pm), "shell")
        case False{}:
          match i:
            case True{}:
              with_line(op_interf(ctx(MIO.parse_job(job))), "interference")
            case False{}:
              trace_prep(prep(ctx(MIO.parse_job(job))), pm)

# op: offset | shell | interference | thickness; p: micrometres.
def run(+op: String, p: String, +job: String) -> String:
  run.k(op_is(op, "offset"), op_is(op, "shell"), op_is(op, "interference"), param(p), job)

# --- phase checksums for the native driver (fdm-native.bend) -------------------

def rt_count(t: RT) -> U32:
  match t:
    case RL{rs}:
      M.count(&2, Ray, rs)
    case RN{a, b}:
      (rt_count(a) + rt_count(b) : U32)

def prep_sum(+p: Prep) -> U32:
  match p:
    case NoPrep{_}:
      1
    case Prep{_, rt, _}:
      rt_count(rt)
