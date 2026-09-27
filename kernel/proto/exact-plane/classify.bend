import Base
import ../../real.bend as R
import ../mesh.bend as M
import ./big.bend as B
import ./geom.bend as E
import ./poly.bend as P
import ./setup.bend as S
import ./arrange.bend as A

# Classification of a piece by an exact axis ray.
#
# A piece of triangle t (leaf i) is not crossed by any other leaf's surface,
# so the parity of every other leaf is constant just above (q+) and just
# below (q-) its interior. We pick a point q strictly inside the piece with
# dyadic in-plane coordinates (U / 2^s, V / 2^s) on t's plane, check that it
# is strictly inside with the exact predicate, and cast the ray q + l e_k
# (l > 0, k = dominant axis of t) against the triangles of every other leaf:
#   - projected point strictly inside the projected triangle (filtered 2D
#     orientation, exact fallback) and the triangle plane strictly ahead
#     (plane side of q vs. the sign of its normal's k component): the parity
#     of that leaf flips on both sides;
#   - q on a coplanar triangle of another leaf: it flips only on the side the
#     ray leaves through (q+ if n_k < 0, q- if n_k > 0), and a coplanar
#     triangle of a lower leaf marks the piece as a duplicate (the lower leaf
#     keeps the coincident face);
#   - any other touching configuration (q on a projected edge, on a
#     transversal plane, a ray inside a plane) is degenerate: the next
#     candidate point is tried. None left: Unresolved.
# The CSG tree is then evaluated with leaf i inside at q- and outside at q+.

# In-plane axes (u, v) for the ray axis k.
def axis_u(k: U32) -> U32:
  match k:
    case 0:
      1
    case 1:
      2
    case _:
      0

def axis_v(k: U32) -> U32:
  match k:
    case 0:
      2
    case 1:
      0
    case _:
      1

# Homogeneous point (U / 2^s, V / 2^s) lifted onto plane s along axis k.
def lift.put(k: U32, +xu: B.Big, +xv: B.Big, +xk: B.Big, +w: B.Big) -> E.Vtx:
  match k:
    case 0:
      E.vtx(xk, xu, xv, w)
    case 1:
      E.vtx(xv, xk, xu, w)
    case _:
      E.vtx(xu, xv, xk, w)

def lift.sign(neg: Bool, +k: U32, +xu: B.Big, +xv: B.Big, +xk: B.Big, +w: B.Big) -> E.Vtx:
  match neg:
    case True{}:
      lift.put(k, B.neg(xu), B.neg(xv), B.neg(xk), B.neg(w))
    case False{}:
      lift.put(k, xu, xv, xk, w)

def lift(+pl: E.Plane, +k: U32, +uu: B.Big, +vv: B.Big, +sb: U32) -> E.Vtx:
  +nk = E.normal_k(pl, k)
  +xk = B.neg(B.add(B.add(B.mul(E.normal_k(pl, axis_u(k)), uu), B.mul(E.normal_k(pl, axis_v(k)), vv)), B.shl(E.offset_of(pl), sb)))
  lift.sign(B.is_neg(nk), k, B.mul(uu, nk), B.mul(vv, nk), xk, B.shl(nk, sb))

# --- filtered 2D orientation of the projected point ------------------------------

def vbig(v: E.Vtx, k: U32) -> B.Big:
  E.Vtx{x, y, z, _, _, _, _, _, _, _, _} = v
  E.normal_k.pick(k, x, y, z)

def vreal(v: E.Vtx, k: U32) -> R.Real:
  E.Vtx{_, _, _, _, fx, fy, fz, _, _, _, _} = v
  E.coord_real.pick(k, fx, fy, fz)

def rabs(r: R.Real) -> F32:
  E.rabs_hi(r)

def orient.exact(+au: B.Big, +av: B.Big, +bu: B.Big, +bv: B.Big, +uu: B.Big, +vv: B.Big, +sb: U32) -> E.Side:
  +o = B.sub(B.mul(B.sub(bu, au), B.sub(vv, B.shl(av, sb))), B.mul(B.sub(bv, av), B.sub(uu, B.shl(au, sb))))
  E.exact_side.of(B.sign(o))

def orient.pick(ok: Bool, neg: Bool, +au: B.Big, +av: B.Big, +bu: B.Big, +bv: B.Big, +uu: B.Big, +vv: B.Big, +sb: U32) -> E.Side:
  match ok neg:
    case True{} True{}:
      E.FNeg{}
    case True{} False{}:
      E.FPos{}
    case False{} _:
      orient.exact(au, av, bu, bv, uu, vv, sb)

# Sign of (b - a) x (q - a) in the (u, v) projection; a, b grid points,
# q = (U, V) / 2^s with approximations (qu, qv).
def orient(+a: E.Vtx, +b: E.Vtx, +ku: U32, +kv: U32, +qu: R.Real, +qv: R.Real, +uu: B.Big, +vv: B.Big, +sb: U32) -> E.Side:
  +au = vreal(a, ku)
  +av = vreal(a, kv)
  +du = R.sub(vreal(b, ku), au)
  +dv = R.sub(vreal(b, kv), av)
  +o = R.approx(R.sub(R.mul(du, R.sub(qv, av)), R.mul(dv, R.sub(qu, au))))
  +m = (rabs(du) * (rabs(qv) + rabs(av)) + rabs(dv) * (rabs(qu) + rabs(au)) : F32)
  orient.pick((F32.abs(o) > (m * 0.0000000000009094947017729282 + 0.0000000000000000000000000001 : F32) : F32), (o < 0.0 : F32), vbig(a, ku), vbig(a, kv), vbig(b, ku), vbig(b, kv), uu, vv, sb)

# --- one ray against one triangle ----------------------------------------------------

type Hit is Data:
  HMiss{}
  HCross{}
  HCop{}
  HDegen{}

type HS is Data:
  HS{h: Hit, st: P.St}

def all3(+a: B.Sign, +b: B.Sign, +c: B.Sign) -> Bool:
  Bool.or(Bool.and(P.is_lt(a), Bool.and(P.is_lt(b), P.is_lt(c))), Bool.and(P.is_gt(a), Bool.and(P.is_gt(b), P.is_gt(c))))

def weak3(+a: B.Sign, +b: B.Sign, +c: B.Sign) -> Bool:
  +nonpos = Bool.and(Bool.not(P.is_gt(a)), Bool.and(Bool.not(P.is_gt(b)), Bool.not(P.is_gt(c))))
  +nonneg = Bool.and(Bool.not(P.is_lt(a)), Bool.and(Bool.not(P.is_lt(b)), Bool.not(P.is_lt(c))))
  Bool.or(nonpos, nonneg)

def hit.lt(sm: B.Sign) -> Hit:
  match sm:
    case B.Gt0{}:
      HCross{}
    case _:
      HMiss{}

def hit.gt(sm: B.Sign) -> Hit:
  match sm:
    case B.Lt0{}:
      HCross{}
    case _:
      HMiss{}

# The ray from q along +e_k meets plane tb ahead of q iff side(tb, q) and the
# k component of tb's normal have opposite signs; zero means q is on tb.
def hit.of(sg: B.Sign, sm: B.Sign, +ts: E.Plane, +tb: E.Plane) -> Hit:
  match sg:
    case B.Eq0{}:
      Bool.pick(Hit, E.coplanar(ts, tb), HCop{}, HDegen{})
    case B.Lt0{}:
      hit.lt(sm)
    case B.Gt0{}:
      hit.gt(sm)

# Query context of one ray: the start point q (exact and approximate), its
# dyadic in-plane coordinates, the axis, the piece's plane, leaf and whether
# its normal points to -e_k.
type Q is Data:
  Q{q: E.Vtx, ku: U32, kv: U32, qu: R.Real, qv: R.Real, uu: B.Big, vv: B.Big, sb: U32, k: U32, ts: E.Plane, li: U32, nneg: Bool}

def ray_tri.pick(inside: Bool, weak: Bool, +tb: S.TriI, +c: Q, st: P.St) -> HS:
  match inside weak:
    case True{} _:
      Q{+q, _, _, _, _, _, _, _, +k, +ts, _, _} = c
      +tp = A.tri_s(tb)
      +h = E.side(tp, q)
      HS{hit.of(P.sign_of(h), B.sign(E.normal_k(tp, k)), ts, tp), P.st_side(st, h)}
    case False{} True{}:
      HS{HDegen{}, st}
    case False{} False{}:
      HS{HMiss{}, st}

def ray_tri.k(+o1: E.Side, +o2: E.Side, +o3: E.Side, +tb: S.TriI, +c: Q, st: P.St) -> HS:
  +s1 = P.sign_of(o1)
  +s2 = P.sign_of(o2)
  +s3 = P.sign_of(o3)
  ray_tri.pick(all3(s1, s2, s3), weak3(s1, s2, s3), tb, c, P.st_side(P.st_side(P.st_side(st, o1), o2), o3))

def ray_tri(+tb: S.TriI, +c: Q, st: P.St) -> HS:
  S.TriI{_, _, _, _, _, _, _, _, +a, +b, +d, _, _} = tb
  Q{_, +ku, +kv, +qu, +qv, +uu, +vv, +sb, _, _, _, _} = c
  ray_tri.k(orient(a, b, ku, kv, qu, qv, uu, vv, sb), orient(b, d, ku, kv, qu, qv, uu, vv, sb), orient(d, a, ku, kv, qu, qv, uu, vv, sb), tb, c, st)

type Ray is Data:
  Ray{ok: Bool, pl: List<&2, U32>, mi: List<&2, U32>, dup: Bool, st: P.St}

def ray.hit(h: Hit, +lb: U32, +li: U32, +nneg: Bool, ok: Bool, pl: List<&2, U32>, mi: List<&2, U32>, dup: Bool, st: P.St) -> Ray:
  match h:
    case HMiss{}:
      Ray{ok, pl, mi, dup, st}
    case HCross{}:
      Ray{ok, lb <> pl, lb <> mi, dup, st}
    case HCop{}:
      match nneg:
        case True{}:
          Ray{ok, lb <> pl, mi, Bool.or(dup, U32.is_lt(lb, li)), st}
        case False{}:
          Ray{ok, pl, lb <> mi, Bool.or(dup, U32.is_lt(lb, li)), st}
    case HDegen{}:
      Ray{False{}, pl, mi, dup, st}

def ray.apply(r: HS, +lb: U32, +c: Q, acc: Ray) -> Ray:
  HS{h, st} = r
  Q{_, _, _, _, _, _, _, _, _, _, +li, +nneg} = c
  Ray{ok, pl, mi, dup, _} = acc
  ray.hit(h, lb, li, nneg, ok, pl, mi, dup, st)

def ray_st(r: Ray) -> P.St:
  Ray{_, _, _, _, st} = r
  st

def q_li(c: Q) -> U32:
  Q{_, _, _, _, _, _, _, _, _, _, li, _} = c
  li

def ray.step(same: Bool, +tb: S.TriI, +c: Q, +acc: Ray) -> Ray:
  match same:
    case True{}:
      acc
    case False{}:
      ray.apply(ray_tri(tb, c, ray_st(acc)), A.tri_leaf(tb), c, acc)

def ray.go(ts: List<&2, S.TriI>, +c: Q, acc: Ray) -> Ray:
  match ts:
    case Nil{}:
      acc
    case +tb <> rest:
      ray.go(rest, c, ray.step(U32.is_eq(A.tri_leaf(tb), q_li(c)), tb, c, acc))

# --- CSG evaluation ----------------------------------------------------------------

def count_of(xs: List<&2, U32>, +x: U32, acc: U32) -> U32:
  match xs:
    case Nil{}:
      acc
    case h <> t:
      count_of(t, x, (acc + Bool.to_u32(U32.is_eq(h, x)) : U32))

def leaf_in(+l: U32, +own: U32, own_in: Bool, +ins: List<&2, U32>) -> Bool:
  Bool.or(Bool.and(U32.is_eq(l, own), own_in), Bool.and(U32.is_ne(l, own), U32.is_eq(U32.and(count_of(ins, l, 0), 1), 1)))

def csg.op(op: M.Op, x: Bool, y: Bool) -> Bool:
  match op:
    case M.Union{}:
      Bool.or(x, y)
    case M.Subtract{}:
      Bool.and(x, Bool.not(y))
    case M.Intersect{}:
      Bool.and(x, y)

def csg(t: M.Csg, +own: U32, +own_in: Bool, +ins: List<&2, U32>) -> Bool:
  match t:
    case M.CLeaf{l}:
      leaf_in(l, own, own_in, ins)
    case M.CNode{op, a, b}:
      csg.op(op, csg(a, own, own_in, ins), csg(b, own, own_in, ins))

# --- interior points and the attempt loop ---------------------------------------

type Cand is Data:
  Cand{u: R.Real, v: R.Real, f: F32, sb: U32}

type Cls is Data:
  Cls{ok: Bool, keep: Bool, flip: Bool, st: P.St}

type UV is Data:
  UV{u: R.Real, v: R.Real}

def uv_of(+ku: U32, +kv: U32, +v: E.Vtx) -> UV:
  UV{E.coord_real(v, ku), E.coord_real(v, kv)}

def uvs(vs: List<&2, E.Vtx>, +ku: U32, +kv: U32, acc: List<&2, UV>) -> List<&2, UV>:
  match vs:
    case Nil{}:
      List.reverse(&2, UV, acc)
    case v <> t:
      uvs(t, ku, kv, uv_of(ku, kv, v) <> acc)

def uv_sum(xs: List<&2, UV>, su: R.Real, sv: R.Real, +n: F32) -> UV:
  match xs:
    case Nil{}:
      UV{R.div(su, R.from_f32(n)), R.div(sv, R.from_f32(n))}
    case UV{u, v} <> t:
      uv_sum(t, R.add(su, u), R.add(sv, v), (n + 1.0 : F32))

def uv_centroid(xs: List<&2, UV>) -> UV:
  uv_sum(xs, R.from_f32(0.0), R.from_f32(0.0), 0.0)

# (2 c + p) / 3: a point between the centroid and a vertex.
def uv_mix(+c: UV, p: UV) -> UV:
  UV{cu, cv} = c
  UV{pu, pv} = p
  +third = R.div(R.from_f32(1.0), R.from_f32(3.0))
  UV{R.mul(R.add(R.add(cu, cu), pu), third), R.mul(R.add(R.add(cv, cv), pv), third)}

def mixes(xs: List<&2, UV>, +c: UV, acc: List<&2, UV>) -> List<&2, UV>:
  match xs:
    case Nil{}:
      List.reverse(&2, UV, acc)
    case p <> t:
      mixes(t, c, uv_mix(c, p) <> acc)

def at_scale(pts: List<&2, UV>, +f: F32, +sb: U32, acc: List<&2, Cand>) -> List<&2, Cand>:
  match pts:
    case Nil{}:
      acc
    case UV{u, v} <> t:
      at_scale(t, f, sb, Cand{u, v, f, sb} <> acc)

def cand_pts(+c: UV, xs: List<&2, UV>) -> List<&2, UV>:
  c <> List.take(&2, UV, mixes(xs, c, Nil{}), 4n)

# Candidate interior points: the centroid and the points between it and
# each vertex, at 2^-8, 2^-24 and 2^-40 grid units (coarse first: smaller
# integers).
def candidates(+vs: List<&2, E.Vtx>, +ku: U32, +kv: U32) -> List<&2, Cand>:
  +xs = uvs(vs, ku, kv, Nil{})
  +c = uv_centroid(xs)
  +pts = cand_pts(c, xs)
  List.reverse(&2, Cand, at_scale(pts, 1099511627776.0, 40, at_scale(pts, 16777216.0, 24, at_scale(pts, 256.0, 8, Nil{}))))

def cls_ok(c: Cls) -> Bool:
  Cls{ok, _, _, _} = c
  ok

def cls_st(c: Cls) -> P.St:
  Cls{_, _, _, st} = c
  st

def all_lt(xs: List<&2, B.Sign>) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case s <> t:
      Bool.and(P.is_lt(s), all_lt(t))

def plane_sides(ps: List<&2, E.Plane>, +q: E.Vtx, acc: List<&2, E.Side>) -> List<&2, E.Side>:
  match ps:
    case Nil{}:
      acc
    case p <> t:
      plane_sides(t, q, E.side(p, q) <> acc)

def big_f32(+x: F32) -> F32:
  F32.max(x, 0.0)

def pad(+x: F32) -> F32:
  (F32.abs(x) * 0.00001 + 4.0 : F32)

def ray_box.pick(k: U32, +x: F32, +y: F32, +z: F32) -> S.Box:
  match k:
    case 0:
      S.Box{(x - pad(x) : F32), (y - pad(y) : F32), (z - pad(z) : F32), 300000000000000000000000000000000000000.0, (y + pad(y) : F32), (z + pad(z) : F32)}
    case 1:
      S.Box{(x - pad(x) : F32), (y - pad(y) : F32), (z - pad(z) : F32), (x + pad(x) : F32), 300000000000000000000000000000000000000.0, (z + pad(z) : F32)}
    case _:
      S.Box{(x - pad(x) : F32), (y - pad(y) : F32), (z - pad(z) : F32), (x + pad(x) : F32), (y + pad(y) : F32), 300000000000000000000000000000000000000.0}

def ray_box(+q: E.Vtx, +k: U32) -> S.Box:
  ray_box.pick(k, E.approx_u(q, 0), E.approx_u(q, 1), E.approx_u(q, 2))

def finish(r: Ray, +tree: M.Csg, +li: U32) -> Cls:
  Ray{ok, +pl, +mi, dup, st} = r
  +rp = csg(tree, li, False{}, pl)
  +rm = csg(tree, li, True{}, mi)
  Cls{ok, Bool.and(Bool.not(dup), Bool.xor(rp, rm)), rp, st}

def attempt.k(inside: Bool, +c: Q, +bvh: S.BVH, +tree: M.Csg, st: P.St) -> Cls:
  match inside:
    case False{}:
      Cls{False{}, False{}, False{}, st}
    case True{}:
      Q{+q, _, _, _, _, _, _, _, +k, _, +li, _} = c
      finish(ray.go(S.find_other(bvh, ray_box(q, k), li), c, Ray{True{}, Nil{}, Nil{}, False{}, st}), tree, li)

def mk_q(q: E.Vtx, ku: U32, kv: U32, qu: R.Real, qv: R.Real, uu: B.Big, vv: B.Big, sb: U32, k: U32, ts: E.Plane, li: U32, nneg: Bool) -> Q:
  Q{q, ku, kv, qu, qv, uu, vv, sb, k, ts, li, nneg}

def attempt(c: Cand, +piece: P.Poly, +t: S.TriI, +bvh: S.BVH, +tree: M.Csg, st: P.St) -> Cls:
  Cand{cu, cv, +f, +sb} = c
  +k = A.tri_k(t)
  +ts = A.tri_s(t)
  +uu = E.scaled_int(cu, f)
  +vv = E.scaled_int(cv, f)
  +q = lift(ts, k, uu, vv, sb)
  +sd = plane_sides(A.edge_planes(piece), q, Nil{})
  +inv = (1.0 / f : F32)
  attempt.k(all_lt(P.signs(sd)), mk_q(q, axis_u(k), axis_v(k), E.rscale(B.to_real(uu), inv), E.rscale(B.to_real(vv), inv), uu, vv, sb, k, ts, A.tri_leaf(t), B.is_neg(E.normal_k(ts, k))), bvh, tree, P.tally(sd, st))

def cls.go(cs: List<&2, Cand>, done: Bool, +prev: Cls, +piece: P.Poly, +t: S.TriI, +bvh: S.BVH, +tree: M.Csg) -> Cls:
  match cs:
    case Nil{}:
      prev
    case c <> rest:
      match done:
        case True{}:
          prev
        case False{}:
          +r = attempt(c, piece, t, bvh, tree, cls_st(prev))
          cls.go(rest, cls_ok(r), r, piece, t, bvh, tree)

# Keep / flip decision for one piece of triangle t. ok = False: no usable
# interior point (the caller reports the job as unresolved).
def classify(+piece: P.Poly, +t: S.TriI, +bvh: S.BVH, +tree: M.Csg, st: P.St) -> Cls:
  +k = A.tri_k(t)
  cls.go(candidates(P.vertices(piece), axis_u(k), axis_v(k)), False{}, Cls{False{}, False{}, False{}, st}, piece, t, bvh, tree)
