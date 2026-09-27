import Base
import ../real.bend as R
import ../precise.bend as G
import ../analytic.bend as A
import ../robust-predicates.bend as X
import ./job.bend as J

# The fillet's local frame (docs/fillet-plan.md §8 step 3). The ladder,
# network and surgery compute in F32x2, whose rounding grows with the
# magnitude of the coordinates: a part at 1e7 mm would see errors near
# 1e-6 mm, the modelling tolerance. The job is therefore moved, per axis, by
# an F32 value T close to the part (T = round(c / p) p, c the bounding box
# centre, p the smallest power of two >= 4 x the extent E; T = 0 for a part
# whose centre lies within 16 E of the origin), the work is done there, and the result is moved back.
# The move is exact: for every point word of the job (vertices, curve and
# surface origins) the moved words must represent x - T exactly (checked in
# exact arithmetic); where one does not, that axis is not moved. So a part
# and an exact translate of it give the same local job up to a small exact
# translation, and the same decisions.

type Box is Data:
  Box{lo: F32, hi: F32}

def box_add(+b: Box, +x: F32) -> Box:
  Box{lo, hi} = b
  Box{Bool.pick(F32, (x < lo : F32), x, lo), Bool.pick(F32, (x > hi : F32), x, hi)}

def comp(+v: G.Vec3, +axis: U32) -> R.Real:
  G.V3{x, y, z} = v
  Bool.pick(R.Real, U32.is_eq(axis, 0), x, Bool.pick(R.Real, U32.is_eq(axis, 1), y, z))

def box_of(+vs: List<&2, G.Vec3>, +axis: U32, +acc: Box) -> Box:
  match vs:
    case Nil{}:
      acc
    case v <> t:
      box_of(t, axis, box_add(acc, R.approx(comp(v, axis))))

# The smallest power of two p >= y, from 2^-40 up (fuel bounds the doubling).
def pow2_up(+fuel: Nat, +p: F32, +y: F32) -> F32:
  match fuel:
    case 0n:
      p
    case 1n+f:
      Bool.pick(F32, (p >= y : F32), p, pow2_up(f, (p * 2.0 : F32), y))

def pow2_above(+y: F32) -> F32:
  pow2_up(200n, 0.0000000000009094947017729282, y)

def ext(+b: Box) -> F32:
  Box{lo, hi} = b
  (hi - lo : F32)

# A part whose centre lies within 16 extents of the origin stays (T = 0).
def origin_of(+b: Box, +e: F32) -> F32:
  Box{+lo, +hi} = b
  +c = ((lo + hi : F32) * 0.5 : F32)
  +p = pow2_above((e * 4.0 : F32))
  +far = (F32.abs(c) > (e * 16.0 : F32) : F32)
  Bool.pick(F32, far, (F32.round((c / p : F32)) * p : F32), 0.0)

def zero_sign(+s: X.Sign) -> Bool:
  match s:
    case X.ExactlyZero{}:
      True{}
    case _:
      False{}

# x - t represented exactly by its moved words?
def exact_sub(+x: R.Real, +t: F32) -> Bool:
  +m = R.sub(x, R.from_f32(t))
  zero_sign(X.sign(X.sub(X.from_real(m), X.sub(X.from_real(x), X.from_word(t)))))

def pts_exact(+ps: List<&2, G.Vec3>, +axis: U32, +t: F32) -> Bool:
  match ps:
    case Nil{}:
      True{}
    case p <> rest:
      Bool.and(exact_sub(comp(p, axis), t), pts_exact(rest, axis, t))

# Every point word of the body: vertices, curve origins, surface origins.
def curve_o(+c: A.Curve) -> G.Vec3:
  match c:
    case A.Line{o, _}:
      o
    case A.Circle{o, _, _, _}:
      o
    case A.Ellipse{o, _, _, _, _}:
      o

def surf_o(+s: A.Surface) -> G.Vec3:
  match s:
    case A.Plane{o, _, _}:
      o
    case A.Cylinder{o, _, _, _}:
      o
    case A.Cone{o, _, _, _, _}:
      o
    case A.Sphere{o, _, _, _}:
      o
    case A.Torus{o, _, _, _, _}:
      o

def edge_pts(+es: List<&2, J.Edge>, +acc: List<&2, G.Vec3>) -> List<&2, G.Vec3>:
  match es:
    case Nil{}:
      acc
    case J.Edge{_, _, c, _, _, _, _} <> t:
      edge_pts(t, curve_o(c) <> acc)

def face_pts(+fs: List<&2, J.Face>, +acc: List<&2, G.Vec3>) -> List<&2, G.Vec3>:
  match fs:
    case Nil{}:
      acc
    case J.Face{_, s, _} <> t:
      face_pts(t, surf_o(s) <> acc)

def all_pts(+b: J.Body) -> List<&2, G.Vec3>:
  J.Body{vs, es, fs} = b
  List.append(&2, G.Vec3, vs, edge_pts(es, face_pts(fs, Nil{})))

def box_ax(+b: J.Body, +axis: U32) -> Box:
  J.Body{vs, _, _} = b
  box_of(vs, axis, Box{3.0e38, F32.neg(3.0e38)})

def axis_t(+b: J.Body, +ps: List<&2, G.Vec3>, +axis: U32, +e: F32) -> F32:
  +t = origin_of(box_ax(b, axis), e)
  Bool.pick(F32, pts_exact(ps, axis, t), t, 0.0)

# The frame origin T of a body.
def origin(+b: J.Body) -> G.Vec3:
  +ps = all_pts(b)
  +e = F32.max(ext(box_ax(b, 0)), F32.max(ext(box_ax(b, 1)), ext(box_ax(b, 2))))
  G.V3{R.from_f32(axis_t(b, ps, 0, e)), R.from_f32(axis_t(b, ps, 1, e)), R.from_f32(axis_t(b, ps, 2, e))}

# ---------------------------------------------------------------------------
# Moving geometry (a zero component leaves the words untouched)

def mv_r(+x: R.Real, +t: R.Real) -> R.Real:
  R.Real{th, _} = t
  Bool.pick(R.Real, F32.is_eq(th, 0.0), x, R.add(x, t))

def mv(+p: G.Vec3, +t: G.Vec3) -> G.Vec3:
  G.V3{x, y, z} = p
  G.V3{tx, ty, tz} = t
  G.V3{mv_r(x, tx), mv_r(y, ty), mv_r(z, tz)}

def mv_curve(+c: A.Curve, +t: G.Vec3) -> A.Curve:
  match c:
    case A.Line{o, d}:
      A.Line{mv(o, t), d}
    case A.Circle{o, n, x, r}:
      A.Circle{mv(o, t), n, x, r}
    case A.Ellipse{o, n, x, a, b}:
      A.Ellipse{mv(o, t), n, x, a, b}

def mv_surf(+s: A.Surface, +t: G.Vec3) -> A.Surface:
  match s:
    case A.Plane{o, n, x}:
      A.Plane{mv(o, t), n, x}
    case A.Cylinder{o, a, x, r}:
      A.Cylinder{mv(o, t), a, x, r}
    case A.Cone{o, a, x, r, ang}:
      A.Cone{mv(o, t), a, x, r, ang}
    case A.Sphere{o, a, x, r}:
      A.Sphere{mv(o, t), a, x, r}
    case A.Torus{o, a, x, big, small}:
      A.Torus{mv(o, t), a, x, big, small}

def mv_vs(+vs: List<&2, G.Vec3>, +t: G.Vec3, +acc: List<&2, G.Vec3>) -> List<&2, G.Vec3>:
  match vs:
    case Nil{}:
      List.reverse(&2, G.Vec3, acc)
    case v <> r:
      mv_vs(r, t, mv(v, t) <> acc)

def mv_es(+es: List<&2, J.Edge>, +t: G.Vec3, +acc: List<&2, J.Edge>) -> List<&2, J.Edge>:
  match es:
    case Nil{}:
      List.reverse(&2, J.Edge, acc)
    case J.Edge{s, e, c, same, ranged, t0, t1} <> r:
      mv_es(r, t, J.Edge{s, e, mv_curve(c, t), same, ranged, t0, t1} <> acc)

def mv_fs(+fs: List<&2, J.Face>, +t: G.Vec3, +acc: List<&2, J.Face>) -> List<&2, J.Face>:
  match fs:
    case Nil{}:
      List.reverse(&2, J.Face, acc)
    case J.Face{same, s, ls} <> r:
      mv_fs(r, t, J.Face{same, mv_surf(s, t), ls} <> acc)

def neg(+t: G.Vec3) -> G.Vec3:
  G.V3{x, y, z} = t
  G.V3{R.neg(x), R.neg(y), R.neg(z)}

# The body moved into its local frame (by -T).
def local(+b: J.Body, +t: G.Vec3) -> J.Body:
  J.Body{vs, es, fs} = b
  +m = neg(t)
  J.Body{mv_vs(vs, m, Nil{}), mv_es(es, m, Nil{}), mv_fs(fs, m, Nil{})}
