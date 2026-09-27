import Base

# Implicit field of the "sdf" bake-off prototype (docs/proto-sdf.md).
#
# Every analytic face of the job's face table becomes a 1-Lipschitz function
# g(p) on R^3 (F32, world coordinates) that is negative inside its leaf solid:
#   plane    n.p - d                                  (exact signed distance)
#   cylinder |radial(p)| - r                          (exact, infinite cylinder)
#   cone     (rho - r - h tan a) cos a                (distance to the generator
#                                                      line in the meridian plane)
#   sphere   |p - o| - r                              (exact)
#   torus    |p - core circle| - r                    (exact)
# A primitive is the max of its faces (convex primitives only), union = min,
# intersect = max, subtract = max(a, -b) with the negation pushed to the
# leaves. The resulting CSG field f is 1-Lipschitz (|f(p) - f(q)| <= |p - q|),
# which is what makes the interval bounds below conservative. It is NOT the
# Euclidean distance to the result (max of planes underestimates it outside
# edges); only its sign and zero set are used as geometry.
#
# Only F32 arithmetic with correctly rounded + - * / sqrt appears here, so the
# JS, native CPU and Metal targets compute identical bits.

type V is Data:
  V{x: F32, y: F32, z: F32}

type Fn is Data:
  FPlane{nx: F32, ny: F32, nz: F32, d: F32}
  FCyl{ox: F32, oy: F32, oz: F32, ax: F32, ay: F32, az: F32, r: F32}
  FCone{ox: F32, oy: F32, oz: F32, ax: F32, ay: F32, az: F32, r: F32, c: F32, s: F32}
  FSph{ox: F32, oy: F32, oz: F32, r: F32}
  FTor{ox: F32, oy: F32, oz: F32, ax: F32, ay: F32, az: F32, big: F32, r: F32}

# tag: row of the face table; canon: smallest tag with the same oriented
# carrier (coincident faces of different leaves); neg: the face enters the
# CSG field negated (it lies under an odd number of subtrahends).
type Leaf is Data:
  Leaf{tag: U32, canon: U32, neg: Bool, f: Fn}

# 2-D frame of a prism (origin o, axes u, v) and one polygon edge a -> b with
# its side-face leaf and the pseudo-normals at a and b (see poly_eval).
type PF is Data:
  PF{ox: F32, oy: F32, oz: F32, ux: F32, uy: F32, uz: F32, vx: F32, vy: F32, vz: F32}

type PE is Data:
  PE{leaf: Leaf, ax: F32, ay: F32, bx: F32, by: F32, nax: F32, nay: F32, nbx: F32, nby: F32}

# TPoly: signed distance to the polygon of a non-convex prism (its edges in
# order), negated when neg.
type Tape is Data:
  TLeaf{leaf: Leaf}
  TMin{a: Tape, b: Tape}
  TMax{a: Tape, b: Tape}
  TPoly{neg: Bool, fr: PF, es: List<&2, PE>}

# The value and the leaf attaining it (ties keep the left operand).
type Hit is Data:
  Hit{v: F32, leaf: Leaf}

# --- interval pruning (libfive-style tape pruning) --------------------------
#
# Over the closed cube with centre c and half size s every sub-expression's
# range is bounded by [lo, hi] (Lipschitz bound, exact for planes, widened by
# eps for F32 rounding). A min/max child whose range is dominated over the
# whole cube is dropped: the pruned tape equals f everywhere in the cube.

type PR is Data:
  PR{t: Tape, lo: F32, hi: F32}

# The single plane leaf of a pruned tape, if that is all it is.
type One is Data:
  OnePlane{leaf: Leaf}
  NotOne{}

# --- non-convex prisms: exact polygon distance -------------------------------
#
# A non-convex prism is max(poly, bottom, top) where poly is the signed
# distance to its polygon, in the prism's 2-D frame (origin o, axes u, v).
# Per edge a -> b: if the closest point is interior, the value is the side
# face's own plane function (the same F32 expression the plane leaf uses, so a
# cell whose pruned polygon keeps one edge can become that plane leaf with
# bit-identical values); at an endpoint it is +-|q - a| with the sign of the
# vertex pseudo-normal (the normalised sum of the adjacent edge normals;
# Baerentzen & Aanaes 2005, in 2-D). The nearest edge wins (ties: the first).
# The value is 1-Lipschitz, so the interval rules of the tape hold.

# d: distance to the edge; s: signed value.
type ED is Data:
  ED{d: F32, s: F32}

type PB is Data:
  PB{d: F32, s: F32, leaf: Leaf}

def pick(c: Bool, a: F32, b: F32) -> F32:
  match c:
    case True{}:
      a
    case False{}:
      b

def pickb(c: Bool, a: Bool, b: Bool) -> Bool:
  match c:
    case True{}:
      a
    case False{}:
      b

def pickw(c: Bool, a: U32, b: U32) -> U32:
  match c:
    case True{}:
      a
    case False{}:
      b

def fneg(+b: Bool, +v: F32) -> F32:
  pick(b, F32.neg(v), v)

def absf(+v: F32) -> F32:
  pick((v < 0.0 : F32), F32.neg(v), v)

def sqrt0(+v: F32) -> F32:
  F32.sqrt(pick((v < 0.0 : F32), 0.0, v))

# Tiny values flushed to zero: the Metal GPU flushes subnormal intermediates,
# the CPU and JS do not, so a value that cancels to ~0 can come out as 0 on one
# target and as a tiny normal (seen: 1.6e-38) on another. Flushing everything
# below 1e-30 (far below any coordinate or field ulp of a model) at the few
# places where a value near zero is stored or compared keeps the targets
# bit-identical.
def ftz(+v: F32) -> F32:
  pick((absf(v) < 0.000000000000000000000000000001 : F32), 0.0, v)

def len3(+x: F32, +y: F32, +z: F32) -> F32:
  F32.sqrt((x * x + y * y + z * z : F32))

# --- values -------------------------------------------------------------

def radial_len(+dx: F32, +dy: F32, +dz: F32, +ax: F32, +ay: F32, +az: F32) -> F32:
  +h = (dx * ax + dy * ay + dz * az : F32)
  len3((dx - h * ax : F32), (dy - h * ay : F32), (dz - h * az : F32))

def fn_eval(f: Fn, +x: F32, +y: F32, +z: F32) -> F32:
  match f:
    case FPlane{nx, ny, nz, d}:
      (nx * x + ny * y + nz * z - d : F32)
    case FCyl{ox, oy, oz, ax, ay, az, r}:
      (radial_len((x - ox : F32), (y - oy : F32), (z - oz : F32), ax, ay, az) - r : F32)
    case FCone{ox, oy, oz, +ax, +ay, +az, r, +c, s}:
      +dx = (x - ox : F32)
      +dy = (y - oy : F32)
      +dz = (z - oz : F32)
      +h = (dx * ax + dy * ay + dz * az : F32)
      (radial_len(dx, dy, dz, ax, ay, az) * c - r * c - h * s : F32)
    case FSph{ox, oy, oz, r}:
      (len3((x - ox : F32), (y - oy : F32), (z - oz : F32)) - r : F32)
    case FTor{ox, oy, oz, +ax, +ay, +az, big, r}:
      +dx = (x - ox : F32)
      +dy = (y - oy : F32)
      +dz = (z - oz : F32)
      +h = (dx * ax + dy * ay + dz * az : F32)
      +rho = radial_len(dx, dy, dz, ax, ay, az)
      +q = (rho - big : F32)
      (F32.sqrt((q * q + h * h : F32)) - r : F32)

# Unit gradient of g (the outward normal of the leaf face at p). On an axis
# (rho = 0) the radial direction is undefined; any unit vector normal to the
# axis is returned (such points are never vertices of a valid result).
def unit_or.k(small: Bool, +l: F32, x: F32, y: F32, z: F32, fx: F32, fy: F32, fz: F32) -> V:
  match small:
    case True{}:
      V{fx, fy, fz}
    case False{}:
      V{(x / l : F32), (y / l : F32), (z / l : F32)}

def unit_or(+x: F32, +y: F32, +z: F32, fx: F32, fy: F32, fz: F32) -> V:
  +l = len3(x, y, z)
  unit_or.k((l < 0.0000001 : F32), l, x, y, z, fx, fy, fz)

def pick_v(c: Bool, a: V, b: V) -> V:
  match c:
    case True{}:
      a
    case False{}:
      b

def perp_of(+ax: F32, +ay: F32, +az: F32) -> V:
  pick_v((absf(ax) < 0.9 : F32), V{0.0, F32.neg(az), ay}, V{az, 0.0, F32.neg(ax)})

def radial_dir.k(fb: V, +x: F32, +y: F32, +z: F32) -> V:
  V{fx, fy, fz} = fb
  unit_or(x, y, z, fx, fy, fz)

def radial_dir(+dx: F32, +dy: F32, +dz: F32, +ax: F32, +ay: F32, +az: F32) -> V:
  +h = (dx * ax + dy * ay + dz * az : F32)
  radial_dir.k(perp_of(ax, ay, az), (dx - h * ax : F32), (dy - h * ay : F32), (dz - h * az : F32))

def cone_grad(u: V, +ax: F32, +ay: F32, +az: F32, +c: F32, +s: F32) -> V:
  V{ux, uy, uz} = u
  V{(ux * c - ax * s : F32), (uy * c - ay * s : F32), (uz * c - az * s : F32)}

def tor_grad(u: V, +dx: F32, +dy: F32, +dz: F32, +big: F32) -> V:
  V{ux, uy, uz} = u
  unit_or((dx - big * ux : F32), (dy - big * uy : F32), (dz - big * uz : F32), 0.0, 0.0, 1.0)

def fn_grad(f: Fn, +x: F32, +y: F32, +z: F32) -> V:
  match f:
    case FPlane{nx, ny, nz, _}:
      V{nx, ny, nz}
    case FCyl{ox, oy, oz, ax, ay, az, _}:
      radial_dir((x - ox : F32), (y - oy : F32), (z - oz : F32), ax, ay, az)
    case FCone{ox, oy, oz, +ax, +ay, +az, _, c, s}:
      cone_grad(radial_dir((x - ox : F32), (y - oy : F32), (z - oz : F32), ax, ay, az), ax, ay, az, c, s)
    case FSph{ox, oy, oz, _}:
      unit_or((x - ox : F32), (y - oy : F32), (z - oz : F32), 0.0, 0.0, 1.0)
    case FTor{ox, oy, oz, +ax, +ay, +az, big, _}:
      +dx = (x - ox : F32)
      +dy = (y - oy : F32)
      +dz = (z - oz : F32)
      tor_grad(radial_dir(dx, dy, dz, ax, ay, az), dx, dy, dz, big)

def is_plane(f: Fn) -> Bool:
  match f:
    case FPlane{_, _, _, _}:
      True{}
    case _:
      False{}

# Half-width of the exact range of a plane over a cube of half size s, or the
# Lipschitz bound s * sqrt(3) for the curved faces.
def fn_spread(f: Fn, +s: F32, +rad: F32) -> F32:
  match f:
    case FPlane{nx, ny, nz, _}:
      (s * (absf(nx) + absf(ny) + absf(nz)) : F32)
    case _:
      rad

def ed_vertex(+qx: F32, +qy: F32, +px: F32, +py: F32, +nx: F32, +ny: F32) -> ED:
  +wx = (qx - px : F32)
  +wy = (qy - py : F32)
  +d = F32.sqrt((wx * wx + wy * wy : F32))
  ED{d, pick((wx * nx + wy * ny < 0.0 : F32), F32.neg(d), d)}

def pe_eval.r(atA: Bool, atB: Bool, +qx: F32, +qy: F32, +ax: F32, +ay: F32, +bx: F32, +by: F32, +nax: F32, +nay: F32, +nbx: F32, +nby: F32, f: Fn, +x: F32, +y: F32, +z: F32) -> ED:
  match atA:
    case True{}:
      ed_vertex(qx, qy, ax, ay, nax, nay)
    case False{}:
      match atB:
        case True{}:
          ed_vertex(qx, qy, bx, by, nbx, nby)
        case False{}:
          +s = fn_eval(f, x, y, z)
          ED{absf(s), s}

def pe_eval.k(+t: F32, +qx: F32, +qy: F32, e: PE, +x: F32, +y: F32, +z: F32) -> ED:
  PE{l, ax, ay, bx, by, nax, nay, nbx, nby} = e
  Leaf{_, _, _, f} = l
  pe_eval.r(Bool.not((0.0 < t : F32)), Bool.not((t < 1.0 : F32)), qx, qy, ax, ay, bx, by, nax, nay, nbx, nby, f, x, y, z)

def pe_t(e: PE, +qx: F32, +qy: F32) -> F32:
  PE{_, +ax, +ay, bx, by, _, _, _, _} = e
  +dx = (bx - ax : F32)
  +dy = (by - ay : F32)
  (((qx - ax) * dx + (qy - ay) * dy) / (dx * dx + dy * dy) : F32)

def pe_eval(+e: PE, +qx: F32, +qy: F32, +x: F32, +y: F32, +z: F32) -> ED:
  pe_eval.k(pe_t(e, qx, qy), qx, qy, e, x, y, z)

def pe_leaf(e: PE) -> Leaf:
  PE{l, _, _, _, _, _, _, _, _} = e
  l

def q2(fr: PF, +x: F32, +y: F32, +z: F32) -> V:
  PF{ox, oy, oz, ux, uy, uz, vx, vy, vz} = fr
  +dx = (x - ox : F32)
  +dy = (y - oy : F32)
  +dz = (z - oz : F32)
  V{(dx * ux + dy * uy + dz * uz : F32), (dx * vx + dy * vy + dz * vz : F32), 0.0}

def pb_pick(better: Bool, d: F32, s: F32, l: Leaf, bd: F32, bs: F32, bl: Leaf) -> PB:
  match better:
    case True{}:
      PB{d, s, l}
    case False{}:
      PB{bd, bs, bl}

def pb_step(ed: ED, l: Leaf, b: PB) -> PB:
  ED{+d, s} = ed
  PB{+bd, bs, bl} = b
  pb_pick((d < bd : F32), d, s, l, bd, bs, bl)

def poly_best(es: List<&2, PE>, +qx: F32, +qy: F32, +x: F32, +y: F32, +z: F32, b: PB) -> PB:
  match es:
    case Nil{}:
      b
    case +e <> t:
      poly_best(t, qx, qy, x, y, z, pb_step(pe_eval(e, qx, qy, x, y, z), pe_leaf(e), b))

def vec_x(v: V) -> F32:
  V{x, _, _} = v
  x

def vec_y(v: V) -> F32:
  V{_, y, _} = v
  y

def poly_eval(fr: PF, es: List<&2, PE>, +x: F32, +y: F32, +z: F32) -> PB:
  +q = q2(fr, x, y, z)
  poly_best(es, vec_x(q), vec_y(q), x, y, z, PB{1000000000.0, 1000000000.0, Leaf{0, 0, False{}, FPlane{0.0, 0.0, 1.0, 0.0}}})

def pb_s(b: PB) -> F32:
  PB{_, s, _} = b
  s

def pb_hit(b: PB, +neg: Bool) -> Hit:
  PB{_, s, l} = b
  Leaf{tag, canon, _, f} = l
  Hit{fneg(neg, s), Leaf{tag, canon, neg, f}}

def poly_keep.k(keep: Bool, e: PE, t: List<&2, PE>) -> List<&2, PE>:
  match keep:
    case True{}:
      e <> t
    case False{}:
      t

def pe_rev(es: List<&2, PE>, acc: List<&2, PE>) -> List<&2, PE>:
  match es:
    case Nil{}:
      acc
    case e <> t:
      pe_rev(t, e <> acc)

def ed_d(e: ED) -> F32:
  ED{d, _} = e
  d

# Edges that can be nearest somewhere in the cube (distance at the centre
# within 2 rad + eps of the smallest), in reverse order; tail-recursive (the
# Metal device stack overflows on a 240-edge polygon otherwise).
def poly_keep_rev(es: List<&2, PE>, +qx: F32, +qy: F32, +x: F32, +y: F32, +z: F32, +lim: F32, acc: List<&2, PE>) -> List<&2, PE>:
  match es:
    case Nil{}:
      acc
    case +e <> t:
      poly_keep_rev(t, qx, qy, x, y, z, lim, poly_keep.k(Bool.not((lim < ed_d(pe_eval(e, qx, qy, x, y, z)) : F32)), e, acc))

# The kept edges in their polygon order (ties in poly_best keep the first).
def poly_keep(es: List<&2, PE>, +qx: F32, +qy: F32, +x: F32, +y: F32, +z: F32, +lim: F32) -> List<&2, PE>:
  pe_rev(poly_keep_rev(es, qx, qy, x, y, z, lim, Nil{}), Nil{})

def pb_d(b: PB) -> F32:
  PB{d, _, _} = b
  d

# --- the CSG tape -----------------------------------------------------------

def leaf_eval(l: Leaf, +x: F32, +y: F32, +z: F32) -> F32:
  Leaf{_, _, +neg, f} = l
  ftz(fneg(neg, fn_eval(f, x, y, z)))

def eval(t: Tape, +x: F32, +y: F32, +z: F32) -> F32:
  match t:
    case TLeaf{l}:
      leaf_eval(l, x, y, z)
    case TMin{a, b}:
      F32.min(eval(a, x, y, z), eval(b, x, y, z))
    case TMax{a, b}:
      F32.max(eval(a, x, y, z), eval(b, x, y, z))
    case TPoly{+neg, fr, es}:
      ftz(fneg(neg, pb_s(poly_eval(fr, es, x, y, z))))

def hit_pick(second: Bool, vb: F32, lb: Leaf, va: F32, la: Leaf) -> Hit:
  match second:
    case True{}:
      Hit{vb, lb}
    case False{}:
      Hit{va, la}

def hit_min(a: Hit, b: Hit) -> Hit:
  Hit{+va, la} = a
  Hit{+vb, lb} = b
  hit_pick((vb < va : F32), vb, lb, va, la)

def hit_max(a: Hit, b: Hit) -> Hit:
  Hit{+va, la} = a
  Hit{+vb, lb} = b
  hit_pick((va < vb : F32), vb, lb, va, la)

def hit(t: Tape, +x: F32, +y: F32, +z: F32) -> Hit:
  match t:
    case TLeaf{+l}:
      Hit{leaf_eval(l, x, y, z), l}
    case TMin{a, b}:
      hit_min(hit(a, x, y, z), hit(b, x, y, z))
    case TMax{a, b}:
      hit_max(hit(a, x, y, z), hit(b, x, y, z))
    case TPoly{+neg, fr, es}:
      pb_hit(poly_eval(fr, es, x, y, z), neg)

def negate(t: Tape) -> Tape:
  match t:
    case TLeaf{l}:
      Leaf{tag, canon, neg, f} = l
      TLeaf{Leaf{tag, canon, Bool.not(neg), f}}
    case TMin{a, b}:
      TMax{negate(a), negate(b)}
    case TMax{a, b}:
      TMin{negate(a), negate(b)}
    case TPoly{neg, fr, es}:
      TPoly{Bool.not(neg), fr, es}

def pe_count(es: List<&2, PE>, +acc: U32) -> U32:
  match es:
    case Nil{}:
      acc
    case _ <> t:
      pe_count(t, (acc + 1 : U32))

# A polygon pruned to one edge is that side face's plane over the whole cube
# (the nearest point is interior there, see poly_keep): the plane leaf, with
# bit-identical values.
def pe_plane.l(l: Leaf, +neg: Bool) -> Tape:
  Leaf{tag, canon, _, f} = l
  TLeaf{Leaf{tag, canon, neg, f}}

def pe_plane(e: PE, +neg: Bool) -> Tape:
  PE{l, _, _, _, _, _, _, _, _} = e
  pe_plane.l(l, neg)

def poly_or_leaf(es: List<&2, PE>, +neg: Bool, fr: PF) -> Tape:
  match es:
    case [e]:
      pe_plane(e, neg)
    case _:
      TPoly{neg, fr, es}

def has_poly(t: Tape) -> Bool:
  match t:
    case TLeaf{_}:
      False{}
    case TMin{a, b}:
      Bool.or(has_poly(a), has_poly(b))
    case TMax{a, b}:
      Bool.or(has_poly(a), has_poly(b))
    case TPoly{_, _, _}:
      True{}

def size(t: Tape) -> U32:
  match t:
    case TLeaf{_}:
      1
    case TMin{a, b}:
      (size(a) + size(b) : U32)
    case TMax{a, b}:
      (size(a) + size(b) : U32)
    case TPoly{_, _, es}:
      pe_count(es, 0)

def prune_leaf(l: Leaf, +cx: F32, +cy: F32, +cz: F32, +s: F32, +rad: F32, +eps: F32) -> PR:
  Leaf{tag, canon, +neg, +f} = l
  +v = fneg(neg, fn_eval(f, cx, cy, cz))
  +w = (fn_spread(f, s, rad) + eps : F32)
  PR{TLeaf{Leaf{tag, canon, neg, f}}, (v - w : F32), (v + w : F32)}

def prune_min.k(a_only: Bool, b_only: Bool, ta: Tape, tb: Tape, +la: F32, +ha: F32, +lb: F32, +hb: F32) -> PR:
  match a_only:
    case True{}:
      PR{ta, la, ha}
    case False{}:
      match b_only:
        case True{}:
          PR{tb, lb, hb}
        case False{}:
          PR{TMin{ta, tb}, F32.min(la, lb), F32.min(ha, hb)}

def prune_min(pa: PR, pb: PR) -> PR:
  PR{ta, +la, +ha} = pa
  PR{tb, +lb, +hb} = pb
  prune_min.k((ha < lb : F32), (hb < la : F32), ta, tb, la, ha, lb, hb)

def prune_max.k(a_only: Bool, b_only: Bool, ta: Tape, tb: Tape, +la: F32, +ha: F32, +lb: F32, +hb: F32) -> PR:
  match a_only:
    case True{}:
      PR{ta, la, ha}
    case False{}:
      match b_only:
        case True{}:
          PR{tb, lb, hb}
        case False{}:
          PR{TMax{ta, tb}, F32.max(la, lb), F32.max(ha, hb)}

def prune_max(pa: PR, pb: PR) -> PR:
  PR{ta, +la, +ha} = pa
  PR{tb, +lb, +hb} = pb
  prune_max.k((hb < la : F32), (ha < lb : F32), ta, tb, la, ha, lb, hb)

def prune(t: Tape, +cx: F32, +cy: F32, +cz: F32, +s: F32, +rad: F32, +eps: F32) -> PR:
  match t:
    case TLeaf{l}:
      prune_leaf(l, cx, cy, cz, s, rad, eps)
    case TMin{a, b}:
      prune_min(prune(a, cx, cy, cz, s, rad, eps), prune(b, cx, cy, cz, s, rad, eps))
    case TMax{a, b}:
      prune_max(prune(a, cx, cy, cz, s, rad, eps), prune(b, cx, cy, cz, s, rad, eps))
    case TPoly{+neg, +fr, +es}:
      +q = q2(fr, cx, cy, cz)
      +best = poly_eval(fr, es, cx, cy, cz)
      +v = ftz(fneg(neg, pb_s(best)))
      +w = (rad + eps : F32)
      PR{poly_or_leaf(poly_keep(es, vec_x(q), vec_y(q), cx, cy, cz, (pb_d(best) + 2.0 * rad + eps : F32)), neg, fr), (v - w : F32), (v + w : F32)}

def pr_tape(p: PR) -> Tape:
  PR{t, _, _} = p
  t

def one_plane.k(yes: Bool, l: Leaf) -> One:
  match yes:
    case True{}:
      OnePlane{l}
    case False{}:
      NotOne{}

def one_plane.leaf(l: Leaf) -> One:
  Leaf{tag, canon, neg, +f} = l
  one_plane.k(is_plane(f), Leaf{tag, canon, neg, f})

def one_plane(t: Tape) -> One:
  match t:
    case TLeaf{l}:
      one_plane.leaf(l)
    case _:
      NotOne{}
