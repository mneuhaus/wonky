import Base
import ../../real.bend as R
import ../../precise.bend as G
import ../mesh.bend as M
import ./field.bend as F

# From a parsed CSG job to the implicit field: face table -> F.Fn per tag,
# carrier canonicalisation, one convex max-tree per primitive leaf and the
# CSG tape; plus the conservative bounding box and the curvature bound that
# pick the grid. Only the wire's analytic data is used (no meshes).

# A face row after conversion: tag, leaf index, function.
type Row is Data:
  Row{tag: U32, leaf: U32, f: F.Fn}

# (leaf index, Leaf) per face, with canonical ids.
type LRow is Data:
  LRow{leaf: U32, l: F.Leaf}

type Turns is Data:
  Turns{pos: U32, neg: U32}

type Check is Data:
  Fine{}
  Refuse{reason: String}

# --- non-convex prisms ------------------------------------------------------
#
# max(polygon distance, bottom, top); the polygon edges are the side faces
# 2 + i of the face table (edge i from point i to point i + 1).

type Q2 is Data:
  Q2{x: F32, y: F32}

# --- bounding boxes ----------------------------------------------------------

type Box is Data:
  Box{x0: F32, y0: F32, z0: F32, x1: F32, y1: F32, z1: F32}
  NoBox{}

type P2 is Data:
  P2{x0: F32, y0: F32, x1: F32, y1: F32}

def ap(r: R.Real) -> F32:
  R.approx(r)

# n.o in double-word precision, then rounded once.
def plane_d(+n: G.Vec3, o: G.Vec3) -> F32:
  R.approx(G.dot(n, o))

def v_fn.plane(o: G.Vec3, +n: G.Vec3) -> F.Fn:
  G.V3{nx, ny, nz} = n
  F.FPlane{ap(nx), ap(ny), ap(nz), plane_d(n, o)}

def v_fn.cyl(o: G.Vec3, n: G.Vec3, r: R.Real) -> F.Fn:
  G.V3{ox, oy, oz} = o
  G.V3{nx, ny, nz} = n
  F.FCyl{ap(ox), ap(oy), ap(oz), ap(nx), ap(ny), ap(nz), ap(r)}

def v_fn.cone(o: G.Vec3, n: G.Vec3, r: R.Real, +a: R.Real) -> F.Fn:
  G.V3{ox, oy, oz} = o
  G.V3{nx, ny, nz} = n
  F.FCone{ap(ox), ap(oy), ap(oz), ap(nx), ap(ny), ap(nz), ap(r), ap(R.cos(a)), ap(R.sin(a))}

def v_fn.sph(o: G.Vec3, r: R.Real) -> F.Fn:
  G.V3{ox, oy, oz} = o
  F.FSph{ap(ox), ap(oy), ap(oz), ap(r)}

def v_fn.tor(o: G.Vec3, n: G.Vec3, big: R.Real, r: R.Real) -> F.Fn:
  G.V3{ox, oy, oz} = o
  G.V3{nx, ny, nz} = n
  F.FTor{ap(ox), ap(oy), ap(oz), ap(nx), ap(ny), ap(nz), ap(big), ap(r)}

def fn_of(s: M.Surface) -> F.Fn:
  match s:
    case M.SPlane{o, n, _}:
      v_fn.plane(o, n)
    case M.SCylinder{o, n, _, r}:
      v_fn.cyl(o, n, r)
    case M.SCone{o, n, _, r, a}:
      v_fn.cone(o, n, r, a)
    case M.SSphere{o, r}:
      v_fn.sph(o, r)
    case M.STorus{o, n, big, r}:
      v_fn.tor(o, n, big, r)

# --- carrier identity ----------------------------------------------------------
#
# Two faces are one carrier when their surfaces coincide (same oriented plane,
# same cylinder/sphere/torus, same cone). Tolerance: 1e-5 relative to the
# model scale `sc` on positions and radii, 1e-6 on directions. Coincident
# faces of different leaves (coplanar box tops, coaxial cylinders, A u A) are
# then one surface for the vertex solve.

def near(+a: F32, +b: F32, +tol: F32) -> Bool:
  (F.absf((a - b : F32)) < tol : F32)

def near3(+ax: F32, +ay: F32, +az: F32, +bx: F32, +by: F32, +bz: F32, +tol: F32) -> Bool:
  Bool.and(near(ax, bx, tol), Bool.and(near(ay, by, tol), near(az, bz, tol)))

# Axis equality up to sign.
def same_axis(+ax: F32, +ay: F32, +az: F32, +bx: F32, +by: F32, +bz: F32) -> Bool:
  Bool.or(near3(ax, ay, az, bx, by, bz, 0.000001), near3(ax, ay, az, F32.neg(bx), F32.neg(by), F32.neg(bz), 0.000001))

# The point of the line (o, a) closest to the world origin.
def foot(+ox: F32, +oy: F32, +oz: F32, +ax: F32, +ay: F32, +az: F32) -> F.V:
  +t = (ox * ax + oy * ay + oz * az : F32)
  F.V{(ox - t * ax : F32), (oy - t * ay : F32), (oz - t * az : F32)}

def same_foot(p: F.V, q: F.V, +tol: F32) -> Bool:
  F.V{px, py, pz} = p
  F.V{qx, qy, qz} = q
  near3(px, py, pz, qx, qy, qz, tol)

# Cone apex (radius r + h tan a vanishes at h = -r / tan a).
def apex(+ox: F32, +oy: F32, +oz: F32, +ax: F32, +ay: F32, +az: F32, +r: F32, +c: F32, +s: F32) -> F.V:
  +h = F32.neg((r * c / s : F32))
  F.V{(ox + h * ax : F32), (oy + h * ay : F32), (oz + h * az : F32)}

def same.cyl(a: F.Fn, +bx: F32, +by: F32, +bz: F32, +bax: F32, +bay: F32, +baz: F32, +br: F32, +tol: F32) -> Bool:
  match a:
    case F.FCyl{+ox, +oy, +oz, +ax, +ay, +az, r}:
      Bool.and(near(r, br, tol), Bool.and(same_axis(ax, ay, az, bax, bay, baz), same_foot(foot(ox, oy, oz, ax, ay, az), foot(bx, by, bz, bax, bay, baz), tol)))
    case _:
      False{}

def same.cone(a: F.Fn, +bx: F32, +by: F32, +bz: F32, +bax: F32, +bay: F32, +baz: F32, +br: F32, +bc: F32, +bs: F32, +tol: F32) -> Bool:
  match a:
    case F.FCone{+ox, +oy, +oz, +ax, +ay, +az, +r, +c, +s}:
      Bool.and(near3(ax, ay, az, bax, bay, baz, 0.000001), Bool.and(near(c, bc, 0.000001), Bool.and(near(s, bs, 0.000001), same_foot(apex(ox, oy, oz, ax, ay, az, r, c, s), apex(bx, by, bz, bax, bay, baz, br, bc, bs), tol))))
    case _:
      False{}

def same.tor(a: F.Fn, +bx: F32, +by: F32, +bz: F32, +bax: F32, +bay: F32, +baz: F32, +bbig: F32, +br: F32, +tol: F32) -> Bool:
  match a:
    case F.FTor{ox, oy, oz, ax, ay, az, big, r}:
      Bool.and(near3(ox, oy, oz, bx, by, bz, tol), Bool.and(same_axis(ax, ay, az, bax, bay, baz), Bool.and(near(big, bbig, tol), near(r, br, tol))))
    case _:
      False{}

def same_carrier(b: F.Fn, a: F.Fn, +tol: F32) -> Bool:
  match b:
    case F.FPlane{nx, ny, nz, d}:
      match a:
        case F.FPlane{ax, ay, az, ad}:
          Bool.and(near3(ax, ay, az, nx, ny, nz, 0.000001), near(ad, d, tol))
        case _:
          False{}
    case F.FCyl{ox, oy, oz, ax, ay, az, r}:
      same.cyl(a, ox, oy, oz, ax, ay, az, r, tol)
    case F.FCone{ox, oy, oz, ax, ay, az, r, c, s}:
      same.cone(a, ox, oy, oz, ax, ay, az, r, c, s, tol)
    case F.FSph{ox, oy, oz, r}:
      match a:
        case F.FSph{px, py, pz, pr}:
          Bool.and(near3(px, py, pz, ox, oy, oz, tol), near(pr, r, tol))
        case _:
          False{}
    case F.FTor{ox, oy, oz, ax, ay, az, big, r}:
      same.tor(a, ox, oy, oz, ax, ay, az, big, r, tol)

def rows.go(fs: List<&2, M.FaceTag>, +tag: U32, acc: List<&2, Row>) -> List<&2, Row>:
  match fs:
    case Nil{}:
      List.reverse(&2, Row, acc)
    case M.FaceTag{leaf, _, s} <> t:
      rows.go(t, (tag + 1 : U32), Row{tag, leaf, fn_of(s)} <> acc)

def rows(fs: List<&2, M.FaceTag>) -> List<&2, Row>:
  rows.go(fs, 0, Nil{})

# Smallest tag of `all` whose carrier equals f (all is in tag order, so the
# first hit is the smallest; f itself is in the list).
def canon_of(all: List<&2, Row>, +f: F.Fn, +self: U32, +tol: F32) -> U32:
  match all:
    case Nil{}:
      self
    case Row{t, _, g} <> rest:
      F.pickw(same_carrier(g, f, tol), t, canon_of(rest, f, self, tol))

def canon_rows(rs: List<&2, Row>, +all: List<&2, Row>, +tol: F32) -> List<&2, LRow>:
  match rs:
    case Nil{}:
      Nil{}
    case Row{+tag, leaf, +f} <> t:
      LRow{leaf, F.Leaf{tag, canon_of(all, f, tag, tol), False{}, f}} <> canon_rows(t, all, tol)

def faces_of.add(mine: Bool, l: F.Leaf, acc: List<&2, F.Tape>) -> List<&2, F.Tape>:
  match mine:
    case True{}:
      F.TLeaf{l} <> acc
    case False{}:
      acc

# The faces of leaf i, as a balanced max-tree (convex primitive).
def faces_of(rs: List<&2, LRow>, +i: U32, acc: List<&2, F.Tape>) -> List<&2, F.Tape>:
  match rs:
    case Nil{}:
      List.reverse(&2, F.Tape, acc)
    case LRow{leaf, l} <> t:
      faces_of(t, i, faces_of.add(U32.is_eq(leaf, i), l, acc))

# Pairwise max of neighbours, repeated: a balanced tree of depth log2(n).
def max_pairs(xs: List<&2, F.Tape>) -> List<&2, F.Tape>:
  match xs:
    case a <> b <> t:
      F.TMax{a, b} <> max_pairs(t)
    case _:
      xs

def max_tree(fuel: Nat, xs: List<&2, F.Tape>) -> Maybe<&2, F.Tape>:
  match fuel:
    case 0n:
      None{}
    case 1n+f:
      match xs:
        case Nil{}:
          None{}
        case a <> Nil{}:
          Some{a}
        case _:
          max_tree(f, max_pairs(xs))

def min_pairs(xs: List<&2, F.Tape>) -> List<&2, F.Tape>:
  match xs:
    case a <> b <> t:
      F.TMin{a, b} <> min_pairs(t)
    case _:
      xs

def min_tree(fuel: Nat, xs: List<&2, F.Tape>) -> Maybe<&2, F.Tape>:
  match fuel:
    case 0n:
      None{}
    case 1n+f:
      match xs:
        case Nil{}:
          None{}
        case a <> Nil{}:
          Some{a}
        case _:
          min_tree(f, min_pairs(xs))

# --- primitive checks --------------------------------------------------------

# Prism polygon (params after the height): convex iff every turn has the same
# sign. max-of-faces is only the solid for a convex polygon; a non-convex prism
# (the gear) gets the exact polygon distance instead (`poly_tape`).
def turn(+ax: F32, +ay: F32, +bx: F32, +by: F32, +cx: F32, +cy: F32) -> F32:
  ((bx - ax) * (cy - by) - (by - ay) * (cx - bx) : F32)

def turns.go(ps: List<&2, R.Real>, +ax: F32, +ay: F32, +bx: F32, +by: F32, +fx: F32, +fy: F32, +sx: F32, +sy: F32, +p: U32, +n: U32) -> Turns:
  match ps:
    case rx <> ry <> t:
      +cx = ap(rx)
      +cy = ap(ry)
      +t0 = turn(ax, ay, bx, by, cx, cy)
      turns.go(t, bx, by, cx, cy, fx, fy, sx, sy, F.pickw((0.0 < t0 : F32), (p + 1 : U32), p), F.pickw((t0 < 0.0 : F32), (n + 1 : U32), n))
    case _:
      +t1 = turn(ax, ay, bx, by, fx, fy)
      +t2 = turn(bx, by, fx, fy, sx, sy)
      Turns{(p + F.pickw((0.0 < t1 : F32), 1, 0) + F.pickw((0.0 < t2 : F32), 1, 0) : U32), (n + F.pickw((t1 < 0.0 : F32), 1, 0) + F.pickw((t2 < 0.0 : F32), 1, 0) : U32)}

def convex_polygon.k(t: Turns) -> Bool:
  Turns{+p, +n} = t
  Bool.or(U32.is_eq(p, 0), U32.is_eq(n, 0))

def convex_polygon(ps: List<&2, R.Real>) -> Bool:
  match ps:
    case ax <> ay <> bx <> by <> t:
      +fx = ap(ax)
      +fy = ap(ay)
      +sx = ap(bx)
      +sy = ap(by)
      convex_polygon.k(turns.go(t, fx, fy, sx, sy, fx, fy, sx, sy, 0, 0))
    case _:
      False{}

def prim_check.prism(simple: Bool) -> Check:
  match simple:
    case True{}:
      Fine{}
    case False{}:
      Refuse{"prism with fewer than three points"}

def prim_check(p: M.Prim) -> Check:
  M.Prim{kind, params, _} = p
  match kind:
    case M.PBrep{}:
      Refuse{"brep leaf has no analytic CSG form on the csg wire (sdf evaluates analytic primitives only)"}
    case M.PPrism{}:
      match params:
        case _ <> pts:
          prim_check.prism(Bool.not(U32.is_lt(M.count(&2, R.Real, pts), 6)))
        case _:
          Refuse{"prism without parameters"}
    case _:
      Fine{}

def check_all.k(c: Check, rest: Check) -> Check:
  match c:
    case Fine{}:
      rest
    case Refuse{r}:
      Refuse{r}

def check_all(ps: List<&2, M.Prim>) -> Check:
  match ps:
    case Nil{}:
      Fine{}
    case p <> t:
      check_all.k(prim_check(p), check_all(t))

def pts2(ps: List<&2, R.Real>) -> List<&2, Q2>:
  match ps:
    case x <> y <> t:
      Q2{ap(x), ap(y)} <> pts2(t)
    case _:
      Nil{}

def p2_first(ps: List<&2, Q2>) -> Q2:
  match ps:
    case h <> _:
      h
    case Nil{}:
      Q2{0.0, 0.0}

def p2_last(ps: List<&2, Q2>) -> Q2:
  Maybe.default(&2, Q2, List.last(&2, Q2, ps), Q2{0.0, 0.0})

# The points shifted by one: next(i) = p(i + 1) cyclically.
def rot_left(+ps: List<&2, Q2>) -> List<&2, Q2>:
  List.append(&2, Q2, List.tail(&2, Q2, ps), [p2_first(ps)])

# prev(i) = p(i - 1) cyclically.
def rot_right(+ps: List<&2, Q2>) -> List<&2, Q2>:
  p2_last(ps) <> List.reverse(&2, Q2, List.tail(&2, Q2, List.reverse(&2, Q2, ps)))

def cross2(a: Q2, b: Q2) -> F32:
  Q2{ax, ay} = a
  Q2{bx, by} = b
  (ax * by - ay * bx : F32)

def area2(ps: List<&2, Q2>, ns: List<&2, Q2>, acc: F32) -> F32:
  match ps:
    case p <> t:
      match ns:
        case n <> u:
          area2(t, u, (acc + cross2(p, n) : F32))
        case Nil{}:
          acc
    case Nil{}:
      acc

def unit2(+x: F32, +y: F32) -> Q2:
  +l = F32.sqrt((x * x + y * y : F32))
  Q2{(x / l : F32), (y / l : F32)}

# Outward unit normal of edge a -> b (ccw: the polygon has positive area).
def edge_n(a: Q2, b: Q2, +ccw: Bool) -> Q2:
  Q2{ax, ay} = a
  Q2{bx, by} = b
  +dx = (bx - ax : F32)
  +dy = (by - ay : F32)
  unit2(F.pick(ccw, dy, F32.neg(dy)), F.pick(ccw, F32.neg(dx), dx))

def edge_ns(ps: List<&2, Q2>, ns: List<&2, Q2>, +ccw: Bool) -> List<&2, Q2>:
  match ps:
    case p <> t:
      match ns:
        case n <> u:
          edge_n(p, n, ccw) <> edge_ns(t, u, ccw)
        case Nil{}:
          Nil{}
    case Nil{}:
      Nil{}

def sum2(a: Q2, b: Q2) -> Q2:
  Q2{ax, ay} = a
  Q2{bx, by} = b
  unit2((ax + bx : F32), (ay + by : F32))

# Pseudo-normal at vertex i: the sum of the normals of edges i - 1 and i.
def vertex_ns(prev: List<&2, Q2>, cur: List<&2, Q2>) -> List<&2, Q2>:
  match prev:
    case p <> t:
      match cur:
        case c <> u:
          sum2(p, c) <> vertex_ns(t, u)
        case Nil{}:
          Nil{}
    case Nil{}:
      Nil{}

def tleaf(t: F.Tape) -> F.Leaf:
  match t:
    case F.TLeaf{l}:
      l
    case _:
      F.Leaf{0, 0, False{}, F.FPlane{0.0, 0.0, 1.0, 0.0}}

def pe_of(s: F.Tape, a: Q2, b: Q2, na: Q2, nb: Q2) -> F.PE:
  Q2{ax, ay} = a
  Q2{bx, by} = b
  Q2{nax, nay} = na
  Q2{nbx, nby} = nb
  F.PE{tleaf(s), ax, ay, bx, by, nax, nay, nbx, nby}

def pes(ss: List<&2, F.Tape>, as: List<&2, Q2>, bs: List<&2, Q2>, nas: List<&2, Q2>, nbs: List<&2, Q2>) -> List<&2, F.PE>:
  match ss:
    case s <> t1:
      match as:
        case a <> t2:
          match bs:
            case b <> t3:
              match nas:
                case na <> t4:
                  match nbs:
                    case nb <> t5:
                      pe_of(s, a, b, na, nb) <> pes(t1, t2, t3, t4, t5)
                    case Nil{}:
                      Nil{}
                case Nil{}:
                  Nil{}
            case Nil{}:
              Nil{}
        case Nil{}:
          Nil{}
    case Nil{}:
      Nil{}

def frame_of(+a: M.Affine) -> F.PF:
  M.Affine{r0, r1, r2, t} = a
  G.V3{a00, a01, _} = r0
  G.V3{a10, a11, _} = r1
  G.V3{a20, a21, _} = r2
  G.V3{tx, ty, tz} = t
  F.PF{ap(tx), ap(ty), ap(tz), ap(a00), ap(a10), ap(a20), ap(a01), ap(a11), ap(a21)}

def poly_edges(+sides: List<&2, F.Tape>, +pts: List<&2, Q2>) -> List<&2, F.PE>:
  +nxt = rot_left(pts)
  +ccw = (0.0 < area2(pts, nxt, 0.0) : F32)
  +ens = edge_ns(pts, nxt, ccw)
  +vns = vertex_ns(rot_right(ens), ens)
  pes(sides, pts, nxt, vns, rot_left(vns))

def poly_tape(faces: List<&2, F.Tape>, +params: List<&2, R.Real>, +a: M.Affine) -> Maybe<&2, F.Tape>:
  match faces:
    case bot <> top <> sides:
      match params:
        case _ <> pts:
          Some{F.TMax{F.TPoly{False{}, frame_of(a), poly_edges(sides, pts2(pts))}, F.TMax{bot, top}}}
        case Nil{}:
          None{}
    case _:
      None{}

# --- per-leaf tapes and the CSG tape -----------------------------------------

# The tape of one primitive: the max of its faces, or for a non-convex prism
# max(polygon distance, bottom, top).
def leaf_tape.k(poly: Bool, +fs: List<&2, F.Tape>, +params: List<&2, R.Real>, +a: M.Affine) -> Maybe<&2, F.Tape>:
  match poly:
    case True{}:
      poly_tape(fs, params, a)
    case False{}:
      max_tree(64n, fs)

def leaf_tape(p: M.Prim, +fs: List<&2, F.Tape>) -> Maybe<&2, F.Tape>:
  M.Prim{kind, +params, +a} = p
  match kind:
    case M.PPrism{}:
      leaf_tape.k(Bool.not(convex_polygon(List.tail(&2, R.Real, params))), fs, params, a)
    case _:
      max_tree(64n, fs)

def leaf_tapes(ps: List<&2, M.Prim>, +i: U32, +rs: List<&2, LRow>) -> List<&2, Maybe<&2, F.Tape>>:
  match ps:
    case Nil{}:
      Nil{}
    case p <> t:
      leaf_tape(p, faces_of(rs, i, Nil{})) <> leaf_tapes(t, (i + 1 : U32), rs)

def nth_tape.k(here: Bool, h: Maybe<&2, F.Tape>, r: Maybe<&2, F.Tape>) -> Maybe<&2, F.Tape>:
  match here:
    case True{}:
      h
    case False{}:
      r

def nth_tape(xs: List<&2, Maybe<&2, F.Tape>>, +i: U32) -> Maybe<&2, F.Tape>:
  match xs:
    case Nil{}:
      None{}
    case h <> t:
      nth_tape.k(U32.is_eq(i, 0), h, nth_tape(t, (i - 1 : U32)))

def node2(a: Maybe<&2, F.Tape>, b: Maybe<&2, F.Tape>, op: M.Op) -> Maybe<&2, F.Tape>:
  match a:
    case None{}:
      None{}
    case Some{ta}:
      match b:
        case None{}:
          None{}
        case Some{tb}:
          match op:
            case M.Union{}:
              Some{F.TMin{ta, tb}}
            case M.Intersect{}:
              Some{F.TMax{ta, tb}}
            case M.Subtract{}:
              Some{F.TMax{ta, F.negate(tb)}}

# Left-deep chains (pin-array) stay as written: the tape is pruned per cell.
def csg_tape(t: M.Csg, +leaves: List<&2, Maybe<&2, F.Tape>>) -> Maybe<&2, F.Tape>:
  match t:
    case M.CLeaf{i}:
      nth_tape(leaves, i)
    case M.CNode{op, a, b}:
      node2(csg_tape(a, leaves), csg_tape(b, leaves), op)

def box_union(a: Box, b: Box) -> Box:
  match a:
    case NoBox{}:
      b
    case Box{ax0, ay0, az0, ax1, ay1, az1}:
      match b:
        case NoBox{}:
          Box{ax0, ay0, az0, ax1, ay1, az1}
        case Box{bx0, by0, bz0, bx1, by1, bz1}:
          Box{F32.min(ax0, bx0), F32.min(ay0, by0), F32.min(az0, bz0), F32.max(ax1, bx1), F32.max(ay1, by1), F32.max(az1, bz1)}

def box_meet.k(empty: Bool, x0: F32, y0: F32, z0: F32, x1: F32, y1: F32, z1: F32) -> Box:
  match empty:
    case True{}:
      NoBox{}
    case False{}:
      Box{x0, y0, z0, x1, y1, z1}

def box_meet(a: Box, b: Box) -> Box:
  match a:
    case NoBox{}:
      NoBox{}
    case Box{ax0, ay0, az0, ax1, ay1, az1}:
      match b:
        case NoBox{}:
          NoBox{}
        case Box{bx0, by0, bz0, bx1, by1, bz1}:
          +x0 = F32.max(ax0, bx0)
          +y0 = F32.max(ay0, by0)
          +z0 = F32.max(az0, bz0)
          +x1 = F32.min(ax1, bx1)
          +y1 = F32.min(ay1, by1)
          +z1 = F32.min(az1, bz1)
          box_meet.k(Bool.or((x1 < x0 : F32), Bool.or((y1 < y0 : F32), (z1 < z0 : F32))), x0, y0, z0, x1, y1, z1)

def mapp(+a: M.Affine, +x: F32, +y: F32, +z: F32) -> F.V:
  M.Affine{r0, r1, r2, t} = a
  G.V3{a00, a01, a02} = r0
  G.V3{a10, a11, a12} = r1
  G.V3{a20, a21, a22} = r2
  G.V3{tx, ty, tz} = t
  F.V{(ap(a00) * x + ap(a01) * y + ap(a02) * z + ap(tx) : F32), (ap(a10) * x + ap(a11) * y + ap(a12) * z + ap(ty) : F32), (ap(a20) * x + ap(a21) * y + ap(a22) * z + ap(tz) : F32)}

def pbox(p: F.V) -> Box:
  F.V{+x, +y, +z} = p
  Box{x, y, z, x, y, z}

# World box of the 8 transformed corners of a local box (conservative: the
# placement is rigid, so the world box of the local box contains the solid).
def world_box(+a: M.Affine, +x0: F32, +y0: F32, +z0: F32, +x1: F32, +y1: F32, +z1: F32) -> Box:
  +b0 = box_union(pbox(mapp(a, x0, y0, z0)), pbox(mapp(a, x1, y0, z0)))
  +b1 = box_union(pbox(mapp(a, x0, y1, z0)), pbox(mapp(a, x1, y1, z0)))
  +b2 = box_union(pbox(mapp(a, x0, y0, z1)), pbox(mapp(a, x1, y0, z1)))
  +b3 = box_union(pbox(mapp(a, x0, y1, z1)), pbox(mapp(a, x1, y1, z1)))
  box_union(box_union(b0, b1), box_union(b2, b3))

def poly_box(ps: List<&2, R.Real>, +b: P2) -> P2:
  match ps:
    case x <> y <> t:
      P2{bx0, by0, bx1, by1} = b
      +fx = ap(x)
      +fy = ap(y)
      poly_box(t, P2{F32.min(bx0, fx), F32.min(by0, fy), F32.max(bx1, fx), F32.max(by1, fy)})
    case _:
      b

def prism_box(+a: M.Affine, +h: F32, b: P2) -> Box:
  P2{x0, y0, x1, y1} = b
  world_box(a, x0, y0, 0.0, x1, y1, h)

def prim_box(p: M.Prim) -> Box:
  M.Prim{kind, params, +a} = p
  match kind:
    case M.PBox{}:
      match params:
        case [x0, y0, z0, x1, y1, z1]:
          world_box(a, ap(x0), ap(y0), ap(z0), ap(x1), ap(y1), ap(z1))
        case _:
          NoBox{}
    case M.PCylinder{}:
      match params:
        case [r, h]:
          +fr = ap(r)
          world_box(a, F32.neg(fr), F32.neg(fr), 0.0, fr, fr, ap(h))
        case _:
          NoBox{}
    case M.PCone{}:
      match params:
        case [r1, r2, h]:
          +fr = F32.max(ap(r1), ap(r2))
          world_box(a, F32.neg(fr), F32.neg(fr), 0.0, fr, fr, ap(h))
        case _:
          NoBox{}
    case M.PSphere{}:
      match params:
        case [r]:
          +fr = ap(r)
          world_box(a, F32.neg(fr), F32.neg(fr), F32.neg(fr), fr, fr, fr)
        case _:
          NoBox{}
    case M.PTorus{}:
      match params:
        case [big, r]:
          +fr = ap(r)
          +fo = (ap(big) + fr : F32)
          world_box(a, F32.neg(fo), F32.neg(fo), F32.neg(fr), fo, fo, fr)
        case _:
          NoBox{}
    case M.PPrism{}:
      match params:
        case h <> x <> y <> pts:
          +fx = ap(x)
          +fy = ap(y)
          prism_box(a, ap(h), poly_box(pts, P2{fx, fy, fx, fy}))
        case _:
          NoBox{}
    case M.PBrep{}:
      NoBox{}

def nth_prim_box.k(here: Bool, p: M.Prim, r: Box) -> Box:
  match here:
    case True{}:
      prim_box(p)
    case False{}:
      r

def nth_prim_box(ps: List<&2, M.Prim>, +i: U32) -> Box:
  match ps:
    case Nil{}:
      NoBox{}
    case p <> t:
      nth_prim_box.k(U32.is_eq(i, 0), p, nth_prim_box(t, (i - 1 : U32)))

def csg_box(t: M.Csg, +ps: List<&2, M.Prim>) -> Box:
  match t:
    case M.CLeaf{i}:
      nth_prim_box(ps, i)
    case M.CNode{op, a, b}:
      match op:
        case M.Union{}:
          box_union(csg_box(a, ps), csg_box(b, ps))
        case M.Intersect{}:
          box_meet(csg_box(a, ps), csg_box(b, ps))
        case M.Subtract{}:
          csg_box(a, ps)

# --- curvature bound -----------------------------------------------------------
#
# Smallest principal curvature radius over the curved faces (cylinder r,
# sphere r, torus minor r, cone min(r1, r2) / cos a taken from the primitive).
# Faces of a leaf are all listed; the smallest bounds the whole model.

def fn_radius(f: F.Fn, +big: F32) -> F32:
  match f:
    case F.FPlane{_, _, _, _}:
      big
    case F.FCyl{_, _, _, _, _, _, r}:
      r
    case F.FCone{_, _, _, _, _, _, _, _, _}:
      big
    case F.FSph{_, _, _, r}:
      r
    case F.FTor{_, _, _, _, _, _, _, r}:
      r

def min_radius(rs: List<&2, Row>, +acc: F32) -> F32:
  match rs:
    case Nil{}:
      acc
    case Row{_, _, f} <> t:
      min_radius(t, F32.min(acc, fn_radius(f, acc)))

# Cone primitives: min(r1, r2) / cos(a) with cos a = h / slant.
def cone_radius(p: M.Prim, +big: F32) -> F32:
  M.Prim{kind, params, _} = p
  match kind:
    case M.PCone{}:
      match params:
        case [r1, r2, h]:
          +a = ap(r1)
          +b = ap(r2)
          +fh = ap(h)
          +d = (a - b : F32)
          +slant = F32.sqrt((d * d + fh * fh : F32))
          (F32.min(a, b) * slant / fh : F32)
        case _:
          big
    case _:
      big

def min_cone_radius(ps: List<&2, M.Prim>, +acc: F32) -> F32:
  match ps:
    case Nil{}:
      acc
    case p <> t:
      min_cone_radius(t, F32.min(acc, cone_radius(p, acc)))
