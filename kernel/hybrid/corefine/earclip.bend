import Base
import ../../real.bend as R
import ../../precise.bend as G
import ../../robust-predicates.bend as RP
import ./util.bend as U

# corefine: triangulation of one output face (a polygon with holes, as vertex
# loops, counter-clockwise for outer loops and clockwise for holes when seen
# along the face normal). Every loop vertex is kept, so the triangulation
# shares its boundary vertices with the neighbouring faces.
#
#   - projection: the axis-aligned plane closest to the face normal (Manifold
#     GetAxisAlignedProjection); coordinates are copied, never rounded;
#   - orientation: orient2d in Reals with an a-priori error bound, falling
#     back to exact big-integer evaluation of the Real inputs
#     (robust-predicates.bend) when the sign is not certified;
#   - holes: each hole is joined to another loop by a bridge from its
#     rightmost vertex to the nearest vertex that is exactly visible (no loop
#     edge touches the open bridge) and lies inside both vertex sectors;
#   - ears: a convex corner whose triangle contains no other loop vertex
#     (inclusive, vertices coincident with the corner excepted) is clipped;
#     flat corners (an angle below ~1e-7 rad, or within the derived
#     construction error delta = 2^-42 * S of their chord, S the job scale)
#     only when no other ear exists. Lengths and flatness are computed from
#     Real coordinate differences, so they are translation invariant.
# A face that cannot be triangulated this way is reported (bad), never
# patched. Flatness only chooses diagonals: every emitted triangle is checked
# counter-clockwise exactly, so a misjudged corner refuses, it cannot give a
# wrong boundary.

type V2 is Data:
  V2{id: U32, x: R.Real, y: R.Real, fx: F32, fy: F32}

type T3 is Data:
  T3{a: U32, b: U32, c: U32}

# A triangle with its projected corners (for the sliver flips).
type T3P is Data:
  T3P{a: V2, b: V2, c: V2}

def v2(+id: U32, +x: R.Real, +y: R.Real) -> V2:
  V2{id, x, y, R.approx(x), R.approx(y)}

def v2x(v: V2) -> R.Real:
  V2{_, x, _, _, _} = v
  x

def v2y(v: V2) -> R.Real:
  V2{_, _, y, _, _} = v
  y

def v2fx(v: V2) -> F32:
  V2{_, _, _, x, _} = v
  x

def v2fy(v: V2) -> F32:
  V2{_, _, _, _, y} = v
  y

# Coordinate differences are taken in Reals and only then rounded to F32
# (subtract, then round). v2fx(a) - v2fx(b) rounds the absolute coordinates
# first: at 800 mm the F32 ulp is 6.1e-5 mm, so the length of a shorter edge
# was quantisation noise and the tests below were not translation invariant
# (docs/hybrid-robust.md R2: kt1-far, kt2-rotfar).
def fdx(+a: V2, +b: V2) -> F32:
  R.approx(R.sub(v2x(a), v2x(b)))

def fdy(+a: V2, +b: V2) -> F32:
  R.approx(R.sub(v2y(a), v2y(b)))

def v2id(v: V2) -> U32:
  V2{i, _, _, _, _} = v
  i

# Projection selector (Manifold GetAxisAlignedProjection): 0: (x, y),
# 1: (z, x), 2: (y, z); flipped (first coordinate negated) when the
# dominant normal component is negative.
type Proj is Data:
  Proj{axis: U32, flip: Bool}

def proj_of(n: U.N3) -> Proj:
  U.N3{+x, +y, +z} = n
  +ax = F32.abs(x)
  +ay = F32.abs(y)
  +az = F32.abs(z)
  Bool.pick(Proj, Bool.and((az > ax : F32), (az > ay : F32)), Proj{0, (z < 0.0 : F32)}, Bool.pick(Proj, (ay > ax : F32), Proj{1, (y < 0.0 : F32)}, Proj{2, (x < 0.0 : F32)}))

def flipr(f: Bool, +r: R.Real) -> R.Real:
  U.rpick(f, R.neg(r), r)

def project(+p: Proj, +id: U32, +v: G.Vec3) -> V2:
  Proj{+ax, +f} = p
  Bool.pick(V2, U32.is_eq(ax, 0), v2(id, flipr(f, U.vx(v)), U.vy(v)), Bool.pick(V2, U32.is_eq(ax, 1), v2(id, flipr(f, U.vz(v)), U.vx(v)), v2(id, flipr(f, U.vy(v)), U.vz(v))))

# --- orientation --------------------------------------------------------------------

def sign_of(s: RP.Sign) -> U32:
  match s:
    case RP.Negative{}:
      4294967295
    case RP.Positive{}:
      1
    case _:
      0

def orient.exact(ax: R.Real, ay: R.Real, bx: R.Real, by: R.Real, cx: R.Real, cy: R.Real) -> U32:
  +pax = RP.from_real(ax)
  +pay = RP.from_real(ay)
  sign_of(RP.sign(RP.sub(RP.mul(RP.sub(RP.from_real(bx), pax), RP.sub(RP.from_real(cy), pay)), RP.mul(RP.sub(RP.from_real(by), pay), RP.sub(RP.from_real(cx), pax)))))

def orient.pick(sure: Bool, +d: F32, ax: R.Real, ay: R.Real, bx: R.Real, by: R.Real, cx: R.Real, cy: R.Real) -> U32:
  match sure:
    case True{}:
      Bool.pick(U32, (d > 0.0 : F32), 1, 4294967295)
    case False{}:
      orient.exact(ax, ay, bx, by, cx, cy)

def fmax3(+a: F32, +b: F32, +c: F32) -> F32:
  F32.max(F32.abs(a), F32.max(F32.abs(b), F32.abs(c)))

# Sign of (b - a) x (c - a): 1, 0 or -1 (two's complement). The Real
# evaluation is trusted when |det| exceeds 2^-36 m^2, m the largest
# coordinate magnitude (each Real difference errs by <= 2^-44 of its
# operands, products and the final difference add no more than that).
def orient(+a: V2, +b: V2, +c: V2) -> U32:
  V2{_, +ax, +ay, afx, afy} = a
  V2{_, +bx, +by, bfx, bfy} = b
  V2{_, +cx, +cy, cfx, cfy} = c
  +m = F32.max(fmax3(afx, bfx, cfx), fmax3(afy, bfy, cfy))
  +d = R.approx(R.sub(R.mul(R.sub(bx, ax), R.sub(cy, ay)), R.mul(R.sub(by, ay), R.sub(cx, ax))))
  orient.pick((F32.abs(d) > (m * m * 0.0000000000145519152 : F32) : F32), d, ax, ay, bx, by, cx, cy)

def same_pos(a: V2, b: V2) -> Bool:
  V2{_, ax, ay, _, _} = a
  V2{_, bx, by, _, _} = b
  Bool.and(R.equal(ax, bx), R.equal(ay, by))

def pos_o(+o: U32) -> Bool:
  U32.is_eq(o, 1)

def nonneg_o(+o: U32) -> Bool:
  Bool.not(U.is_neg(o))

# --- ear test ------------------------------------------------------------------------------

type FBox is Data:
  FBox{x0: F32, y0: F32, x1: F32, y1: F32}

def fpad(+a: F32) -> F32:
  (F32.abs(a) * 0.00001 + 0.000001 : F32)

def tri_box(+a: V2, +b: V2, +c: V2) -> FBox:
  +x0 = F32.min(v2fx(a), F32.min(v2fx(b), v2fx(c)))
  +y0 = F32.min(v2fy(a), F32.min(v2fy(b), v2fy(c)))
  +x1 = F32.max(v2fx(a), F32.max(v2fx(b), v2fx(c)))
  +y1 = F32.max(v2fy(a), F32.max(v2fy(b), v2fy(c)))
  FBox{(x0 - fpad(x0) : F32), (y0 - fpad(y0) : F32), (x1 + fpad(x1) : F32), (y1 + fpad(y1) : F32)}

def in_box(b: FBox, +p: V2) -> Bool:
  FBox{x0, y0, x1, y1} = b
  +x = v2fx(p)
  +y = v2fy(p)
  Bool.and(Bool.and((x0 <= x : F32), (x <= x1 : F32)), Bool.and((y0 <= y : F32), (y <= y1 : F32)))

# p inside or on the counter-clockwise triangle (a, b, c).
def in_tri(+a: V2, +b: V2, +c: V2, +p: V2) -> Bool:
  Bool.and(nonneg_o(orient(a, b, p)), Bool.and(nonneg_o(orient(b, c, p)), nonneg_o(orient(c, a, p))))

def blocks.if(near: Bool, +a: V2, +b: V2, +c: V2, +p: V2) -> Bool:
  match near:
    case False{}:
      False{}
    case True{}:
      Bool.and(Bool.not(Bool.or(same_pos(p, a), Bool.or(same_pos(p, b), same_pos(p, c)))), in_tri(a, b, c, p))

def ear_blocked(xs: List<&2, V2>, found: Bool, +a: V2, +b: V2, +c: V2, +bx: FBox) -> Bool:
  match xs found:
    case _ True{}:
      True{}
    case Nil{} False{}:
      False{}
    case +p <> t False{}:
      ear_blocked(t, blocks.if(in_box(bx, p), a, b, c, p), a, b, c, bx)

# --- ear clipping ---------------------------------------------------------------------------

def cross_o(+o: V2, +a: V2, +b: V2) -> R.Real:
  R.sub(R.mul(R.sub(v2x(a), v2x(o)), R.sub(v2y(b), v2y(o))), R.mul(R.sub(v2y(a), v2y(o)), R.sub(v2x(b), v2x(o))))

# --- flatness ----------------------------------------------------------------------------
# The job scale of a face's triangulation: s = S, the largest |coordinate| of
# the Boolean's output vertices (at least 1; the scale of the short-edge
# tolerance, weld.bend eps2_of), and dl = delta = 2^-42 * S.
#
# delta is the construction error of the corners, derived (docs/hybrid-robust.md
# X4): an input vertex is stored in F32x2 (<= 2^-49 S); an R add, sub or mul of
# coordinate-sized operands errs by <= 2^-46.8 of its operands, so a point
# interpolated on an edge (about 7 such operations on operands <= 2S) lies
# within ~2^-44 S of its analytic line and one built from two interpolations
# within 2^-43 S. A corner v between u and w is then off the line through the
# (displaced) u and w by at most 2 * 2^-43 S from rounding alone: delta =
# 2^-42 S (= eps / 64, eps the short-edge tolerance 2^-36 S). A job scale,
# not the local magnitude of the three points: a point constructed on a long
# edge carries the error of its far operands.
type Sc is Data:
  Sc{s: F32, dl: F32}

# A flatness decision: fl, and r = the distance of the corner from its chord
# in units of S when only the delta term made it flat, else 0 (reported by
# the corefine stats, stats.bend; by construction r <= dl / S).
type Fl is Data:
  Fl{fl: Bool, r: F32}

def fl.of(+ang: Bool, +d: F32, +l: F32, +sc: Sc) -> Fl:
  Sc{+s, +dl} = sc
  +near = (d <= (l * dl : F32) : F32)
  Fl{Bool.or(ang, near), Bool.pick(F32, Bool.and(near, Bool.not(ang)), (d / (l * s : F32) : F32), 0.0)}

# --- vertex grid for the ear test ------------------------------------------------------
# A static uniform grid over the polygon's vertices (F32 cells, about one
# vertex per cell): an ear only tests the vertices in the cells its box
# touches. Vertices already clipped stay in the grid; they lie outside the
# remaining polygon or on its boundary, so they can only make the test more
# conservative. The grid also carries the face's flatness scale (sc), which
# the ear clipper reads with it.

type Grid is Data:
  Grid{x0: F32, y0: F32, ix: F32, iy: F32, g: U32, cells: U.Table<List<&2, V2>>, sc: Sc}

def grid_sc(g: Grid) -> Sc:
  Grid{_, _, _, _, _, _, sc} = g
  sc

def cellc(+x: F32, +x0: F32, +inv: F32, +g: U32) -> U32:
  +t = F32.clamp(((x - x0) * inv : F32), 0.0, (U32.to_f32(g) - 1.0 : F32))
  F32.to_u32(F32.floor(t))

type CV is Data:
  CV{c: U32, v: V2}

def cv_le(a: CV, b: CV) -> Bool:
  CV{ca, _} = a
  CV{cb, _} = b
  U32.is_le(ca, cb)

def cvs(xs: List<&2, V2>, +x0: F32, +y0: F32, +ix: F32, +iy: F32, +g: U32, acc: List<&2, CV>) -> List<&2, CV>:
  match xs:
    case Nil{}:
      acc
    case +v <> t:
      cvs(t, x0, y0, ix, iy, g, CV{(cellc(v2fy(v), y0, iy, g) * g + cellc(v2fx(v), x0, ix, g) : U32), v} <> acc)

# Dense cell lists 0 .. g*g-1 from the cell-sorted records (a state loop).
type DC is Data:
  DC{i: U32, end: U32, rest: List<&2, CV>, cur: List<&2, V2>, out: List<&2, List<&2, V2>>}

def dc.fin(done: Bool, s: DC) -> U.Step<DC>:
  match done:
    case True{}:
      U.CfDone{s}
    case False{}:
      U.CfMore{s}

def dc.if(hit: Bool, +x: CV, +t: List<&2, CV>, s: DC) -> U.Step<DC>:
  match hit:
    case True{}:
      CV{_, v} = x
      DC{i, e, _, cur, out} = s
      U.CfMore{DC{i, e, t, v <> cur, out}}
    case False{}:
      DC{+i, +e, _, cur, out} = s
      +j = (i + 1 : U32)
      dc.fin(U32.is_ge(j, e), DC{j, e, x <> t, Nil{}, cur <> out})

def dc.step(s: DC) -> U.Step<DC>:
  match s:
    case DC{+i, +e, +x <> +t, +cur, +out}:
      CV{+c, _} = x
      dc.if(U32.is_eq(c, i), x, t, DC{i, e, x <> t, cur, out})
    case DC{+i, +e, Nil{}, cur, out}:
      +j = (i + 1 : U32)
      dc.fin(U32.is_ge(j, e), DC{j, e, Nil{}, Nil{}, cur <> out})

def dc.out(s: DC) -> List<&2, List<&2, V2>>:
  DC{_, _, _, _, out} = s
  U.rev(List<&2, V2>, out)

def fmin4(xs: List<&2, V2>, +x0: F32, +y0: F32, +x1: F32, +y1: F32) -> FBox:
  match xs:
    case Nil{}:
      FBox{x0, y0, x1, y1}
    case +v <> t:
      fmin4(t, F32.min(x0, v2fx(v)), F32.min(y0, v2fy(v)), F32.max(x1, v2fx(v)), F32.max(y1, v2fy(v)))

def isqrt.go(fuel: Nat, ok: Bool, +n: U32, +g: U32) -> U32:
  match fuel ok:
    case _ True{}:
      g
    case 0n _:
      g
    case 1n+p False{}:
      +h = (g + 1 : U32)
      isqrt.go(p, U32.is_ge((h * h : U32), n), n, h)

def grid.mk(+xs: List<&2, V2>, b: FBox, +n: U32, +sc: Sc) -> Grid:
  FBox{+x0, +y0, x1, y1} = b
  +g = U32.min(1024, isqrt.go(1100n, U32.is_ge(1, n), n, 1))
  +gf = U32.to_f32(g)
  +ix = (gf / F32.max((x1 - x0 : F32), 0.000000001) : F32)
  +iy = (gf / F32.max((y1 - y0 : F32), 0.000000001) : F32)
  +e = (g * g : U32)
  +cells = dc.out(U.loop(~DC, ~dc.step, U32.to_nat((n + e + 2 : U32)), U.CfMore{DC{0, e, U.sort(~CV, ~cv_le, cvs(xs, x0, y0, ix, iy, g, Nil{})), Nil{}, Nil{}}}))
  Grid{x0, y0, ix, iy, g, U.table(List<&2, V2>, e, cells), sc}

def grid(+xs: List<&2, V2>, +sc: Sc) -> Grid:
  grid.mk(xs, fmin4(xs, 3.0e38, 3.0e38, F32.neg(3.0e38), F32.neg(3.0e38)), U.len(V2, xs), sc)

def cells.scan(fuel: Nat, found: Bool, +k: U32, +nx: U32, +cx0: U32, +cy0: U32, +gr: Grid, +a: V2, +b: V2, +c: V2, +bx: FBox) -> Bool:
  match fuel found:
    case _ True{}:
      True{}
    case 0n _:
      False{}
    case 1n+p False{}:
      Grid{_, _, _, _, +g, +cells, _} = gr
      +cell = U.tget(List<&2, V2>, cells, ((cy0 + U32.div(k, nx)) * g + cx0 + U32.mod(k, nx) : U32), Nil{})
      cells.scan(p, ear_blocked(cell, False{}, a, b, c, bx), (k + 1 : U32), nx, cx0, cy0, gr, a, b, c, bx)

# Is some polygon vertex (other than at a, b, c) inside or on the ear a b c?
def grid_blocked.k(+bx: FBox, +gr: Grid, +a: V2, +b: V2, +c: V2) -> Bool:
  FBox{bx0, by0, bx1, by1} = bx
  Grid{+x0, +y0, +ix, +iy, +g, _, _} = gr
  +cx0 = cellc(bx0, x0, ix, g)
  +cy0 = cellc(by0, y0, iy, g)
  +nx = (cellc(bx1, x0, ix, g) - cx0 + 1 : U32)
  +ny = (cellc(by1, y0, iy, g) - cy0 + 1 : U32)
  cells.scan(U32.to_nat((nx * ny : U32)), False{}, 0, nx, cx0, cy0, gr, a, b, c, bx)

def grid_blocked(+gr: Grid, +a: V2, +b: V2, +c: V2) -> Bool:
  grid_blocked.k(tri_box(a, b, c), gr, a, b, c)

# --- ear clipping ------------------------------------------------------------------------
# The polygon is a queue (front, reversed back) in cyclic order; the corner
# at the front is tried, and either clipped or rotated to the back.

# dm: the largest r of the flatness decisions taken (type Fl).
type EC is Data:
  EC{fr: List<&2, V2>, bk: List<&2, V2>, n: U32, stall: U32, lax: Bool, tris: List<&2, T3P>, bad: Bool, gr: Grid, dm: F32}

def ec.emit(+a: V2, +b: V2, +c: V2) -> T3P:
  T3P{a, b, c}

def flen(+a: V2, +b: V2) -> F32:
  +dx = fdx(a, b)
  +dy = fdy(a, b)
  F32.sqrt((dx * dx + dy * dy : F32))

# A corner turning by less than ~1e-7 rad: its ear would be a sliver whose
# plane is decided by rounding noise. Such ears are clipped only when no
# other ear exists (Manifold clips the sharpest ears first for the same
# reason). A corner within delta of the line through its neighbours,
# |(u - v) x (w - v)| <= |u - w| * delta, is flat too: its turn is below
# what the constructed points can be trusted with (a micrometre edge far
# from the origin turns by up to ~5.6e-7 rad from rounding alone; kt1-far).
def flat(+u: V2, +v: V2, +w: V2, +sc: Sc) -> Fl:
  +d = F32.abs(R.approx(cross_o(v, u, w)))
  fl.of((d <= (flen(u, v) * flen(w, v) * 0.0000001 : F32) : F32), d, flen(u, w), sc)

def ec.skip(stuck: Bool, +u: V2, +v: V2, +w: V2, +rest: List<&2, V2>, +bk: List<&2, V2>, +n: U32, +stall: U32, +lax: Bool, tris: List<&2, T3P>, bad: Bool, +gr: Grid, +dm: F32) -> U.Step<EC>:
  match stuck:
    case True{}:
      match lax:
        case True{}:
          U.CfDone{EC{Nil{}, Nil{}, 0, stall, lax, tris, True{}, gr, dm}}
        case False{}:
          U.CfMore{EC{u <> v <> w <> rest, bk, n, 0, True{}, tris, bad, gr, dm}}
    case False{}:
      U.CfMore{EC{v <> w <> rest, u <> bk, n, (stall + 1 : U32), lax, tris, bad, gr, dm}}

# The grid test runs only for convex, acceptable corners (Bend is strict).
def ear_ok(cheap: Bool, +gr: Grid, +u: V2, +v: V2, +w: V2) -> Bool:
  match cheap:
    case True{}:
      Bool.not(grid_blocked(gr, u, v, w))
    case False{}:
      False{}

# After a clip the corner before u may have become an ear: step back one
# corner (the last of the back list) so that ears are found where the
# polygon just changed, instead of after another pass around the ring.
def ec.clipped(bk: List<&2, V2>, +u: V2, +w: V2, +rest: List<&2, V2>, +n: U32, +lax: Bool, tris: List<&2, T3P>, bad: Bool, +gr: Grid, +dm: F32) -> U.Step<EC>:
  match bk:
    case Nil{}:
      U.CfMore{EC{u <> w <> rest, Nil{}, n, 0, lax, tris, bad, gr, dm}}
    case b <> bt:
      U.CfMore{EC{b <> u <> w <> rest, bt, n, 0, lax, tris, bad, gr, dm}}

def ec.try(ok: Bool, +u: V2, +v: V2, +w: V2, +rest: List<&2, V2>, +bk: List<&2, V2>, +n: U32, +stall: U32, +lax: Bool, tris: List<&2, T3P>, bad: Bool, +gr: Grid, +dm: F32) -> U.Step<EC>:
  match ok:
    case True{}:
      ec.clipped(bk, u, w, rest, (n - 1 : U32), lax, ec.emit(u, v, w) <> tris, bad, gr, dm)
    case False{}:
      ec.skip(U32.is_gt(stall, n), u, v, w, rest, bk, n, stall, lax, tris, bad, gr, dm)

# A convex corner judged flat is skipped in the strict pass (that decision
# is the one recorded in dm).
def ec.corner(+cvx: Bool, f: Fl, +u: V2, +v: V2, +w: V2, +rest: List<&2, V2>, +bk: List<&2, V2>, +n: U32, +stall: U32, +lax: Bool, tris: List<&2, T3P>, bad: Bool, +gr: Grid, +dm: F32) -> U.Step<EC>:
  Fl{+fl, +r} = f
  +ok = ear_ok(Bool.and(cvx, Bool.or(lax, Bool.not(fl))), gr, u, v, w)
  ec.try(ok, u, v, w, rest, bk, n, stall, lax, tris, bad, gr, F32.max(dm, Bool.pick(F32, Bool.and(cvx, Bool.not(lax)), r, 0.0)))

def ec.front(last: Bool, fr: List<&2, V2>, +bk: List<&2, V2>, +n: U32, +stall: U32, +lax: Bool, tris: List<&2, T3P>, bad: Bool, +gr: Grid, +dm: F32) -> U.Step<EC>:
  match last fr:
    case True{} u <> v <> w <> _:
      U.CfDone{EC{Nil{}, Nil{}, 0, 0, False{}, ec.emit(u, v, w) <> tris, bad, gr, dm}}
    case False{} +u <> +v <> +w <> +rest:
      ec.corner(pos_o(orient(u, v, w)), flat(u, v, w, grid_sc(gr)), u, v, w, rest, bk, n, stall, lax, tris, bad, gr, dm)
    case _ _:
      U.CfDone{EC{Nil{}, Nil{}, 0, 0, False{}, tris, True{}, gr, dm}}

def ec.norm(short: Bool, +fr: List<&2, V2>, +bk: List<&2, V2>) -> List<&2, V2>:
  match short:
    case True{}:
      U.cat(V2, fr, U.rev(V2, bk))
    case False{}:
      fr

def lt3(xs: List<&2, V2>) -> Bool:
  match xs:
    case _ <> _ <> _ <> _:
      False{}
    case _:
      True{}

def ec.step(s: EC) -> U.Step<EC>:
  EC{+fr, +bk, +n, stall, lax, tris, bad, gr, dm} = s
  +short = lt3(fr)
  ec.front(U32.is_le(n, 3), ec.norm(short, fr, bk), Bool.pick(List<&2, V2>, short, Nil{}, bk), n, stall, lax, tris, bad, gr, dm)

# Ear-clip one simple (possibly bridged) counter-clockwise polygon.
def clip(+xs: List<&2, V2>, +sc: Sc) -> EC:
  +n = U.len(V2, xs)
  U.loop(~EC, ~ec.step, U32.to_nat((3 * n * n + 16 : U32)), U.CfMore{EC{xs, Nil{}, n, 0, False{}, Nil{}, U32.is_lt(n, 3), grid(xs, sc), 0.0}})

# --- holes ------------------------------------------------------------------------------------

type Lp is Data:
  Lp{hole: Bool, vs: List<&2, V2>}

def area2.go(xs: List<&2, V2>, +o: V2, +first: V2, +prev: V2, acc: R.Real) -> R.Real:
  match xs:
    case Nil{}:
      R.add(acc, cross_o(o, prev, first))
    case +v <> t:
      area2.go(t, o, first, v, R.add(acc, cross_o(o, prev, v)))

# Twice the signed area (counter-clockwise positive).
def area2(xs: List<&2, V2>) -> R.Real:
  match xs:
    case Nil{}:
      U.rzero()
    case +v <> t:
      area2.go(t, v, v, v, U.rzero())

def rev_last(xs: List<&2, V2>, +d: V2) -> V2:
  match xs:
    case Nil{}:
      d
    case v <> t:
      rev_last(t, v)

# Region sector test at v (neighbours p -> v -> n, region on the left): is x
# strictly inside the sector?
def sector.if(convex: Bool, +l1: Bool, +l2: Bool) -> Bool:
  match convex:
    case True{}:
      Bool.and(l1, l2)
    case False{}:
      Bool.or(l1, l2)

def in_sector(+p: V2, +v: V2, +n: V2, +x: V2) -> Bool:
  sector.if(pos_o(orient(p, v, n)), pos_o(orient(v, n, x)), pos_o(orient(p, v, x)))

def between(+a: R.Real, +m: R.Real, +p: R.Real) -> Bool:
  Bool.and(Bool.not(R.less(a, R.min(m, p))), Bool.not(R.less(R.max(m, p), a)))

# a lies on the closed segment m-p (given collinear) and is not an endpoint.
def inner_on(+a: V2, +m: V2, +p: V2) -> Bool:
  Bool.and(Bool.and(between(v2x(a), v2x(m), v2x(p)), between(v2y(a), v2y(m), v2y(p))), Bool.not(Bool.or(same_pos(a, m), same_pos(a, p))))

type E2 is Data:
  E2{a: V2, b: V2}

# Does edge a-b touch the bridge m-p anywhere except at m or p?
def edge_blocks(+m: V2, +p: V2, +a: V2, +b: V2) -> Bool:
  +o1 = orient(m, p, a)
  +o2 = orient(m, p, b)
  +o3 = orient(a, b, m)
  +o4 = orient(a, b, p)
  +proper = Bool.and(U.is_neg((o1 * o2 : U32)), U.is_neg((o3 * o4 : U32)))
  +ta = Bool.and(U.is_zero(o1), inner_on(a, m, p))
  +tb = Bool.and(U.is_zero(o2), inner_on(b, m, p))
  +tm = Bool.and(U.is_zero(o3), inner_on(m, a, b))
  +tp = Bool.and(U.is_zero(o4), inner_on(p, a, b))
  Bool.or(proper, Bool.or(Bool.or(ta, tb), Bool.or(tm, tp)))

# Conservative F32 box overlap of segments m-p and a-b (a prefilter only).
def seg_near(+m: V2, +p: V2, +a: V2, +b: V2) -> Bool:
  +x0 = F32.min(v2fx(m), v2fx(p))
  +x1 = F32.max(v2fx(m), v2fx(p))
  +y0 = F32.min(v2fy(m), v2fy(p))
  +y1 = F32.max(v2fy(m), v2fy(p))
  +ax0 = F32.min(v2fx(a), v2fx(b))
  +ax1 = F32.max(v2fx(a), v2fx(b))
  +ay0 = F32.min(v2fy(a), v2fy(b))
  +ay1 = F32.max(v2fy(a), v2fy(b))
  Bool.and(Bool.and(((ax0 - fpad(ax0) : F32) <= (x1 + fpad(x1) : F32) : F32), ((x0 - fpad(x0) : F32) <= (ax1 + fpad(ax1) : F32) : F32)), Bool.and(((ay0 - fpad(ay0) : F32) <= (y1 + fpad(y1) : F32) : F32), ((y0 - fpad(y0) : F32) <= (ay1 + fpad(ay1) : F32) : F32)))

def edge_blocks.if(near: Bool, +m: V2, +p: V2, +a: V2, +b: V2) -> Bool:
  match near:
    case False{}:
      False{}
    case True{}:
      edge_blocks(m, p, a, b)

def visible.go(es: List<&2, E2>, blocked: Bool, +m: V2, +p: V2) -> Bool:
  match es blocked:
    case _ True{}:
      False{}
    case Nil{} False{}:
      True{}
    case E2{+a, +b} <> t False{}:
      visible.go(t, edge_blocks.if(seg_near(m, p, a, b), m, p, a, b), m, p)

def loop_edges.go(xs: List<&2, V2>, +first: V2, +prev: V2, acc: List<&2, E2>) -> List<&2, E2>:
  match xs:
    case Nil{}:
      E2{prev, first} <> acc
    case +v <> t:
      loop_edges.go(t, first, v, E2{prev, v} <> acc)

def loop_edges(xs: List<&2, V2>, acc: List<&2, E2>) -> List<&2, E2>:
  match xs:
    case Nil{}:
      acc
    case +v <> t:
      loop_edges.go(t, v, v, acc)

def all_edges(ls: List<&2, Lp>, acc: List<&2, E2>) -> List<&2, E2>:
  match ls:
    case Nil{}:
      acc
    case Lp{_, vs} <> t:
      all_edges(t, loop_edges(vs, acc))

# A bridge candidate: vertex j of loop k with its neighbours.
type Cand is Data:
  Cand{k: U32, j: U32, p: V2, prev: V2, next: V2, d: F32}

def cand_le(a: Cand, b: Cand) -> Bool:
  Cand{_, _, _, _, _, da} = a
  Cand{_, _, _, _, _, db} = b
  (da <= db : F32)

def dist2(+a: V2, +b: V2) -> F32:
  +dx = fdx(a, b)
  +dy = fdy(a, b)
  (dx * dx + dy * dy : F32)

def init(xs: List<&2, V2>, acc: List<&2, V2>) -> List<&2, V2>:
  match xs:
    case Nil{}:
      U.rev(V2, acc)
    case _ <> Nil{}:
      U.rev(V2, acc)
    case v <> t:
      init(t, v <> acc)

def tail_of(xs: List<&2, V2>) -> List<&2, V2>:
  match xs:
    case Nil{}:
      Nil{}
    case _ <> t:
      t

def cands.zip(cs: List<&2, V2>, ps: List<&2, V2>, ns: List<&2, V2>, +k: U32, +j: U32, +m: V2, acc: List<&2, Cand>) -> List<&2, Cand>:
  match cs ps ns:
    case +c <> ct p <> pt n <> nt:
      cands.zip(ct, pt, nt, k, (j + 1 : U32), m, Cand{k, j, c, p, n, dist2(c, m)} <> acc)
    case _ _ _:
      acc

def cands.first(+vs: List<&2, V2>, +k: U32, +m: V2, acc: List<&2, Cand>) -> List<&2, Cand>:
  match vs:
    case Nil{}:
      acc
    case +v <> _:
      cands.zip(vs, rev_last(vs, v) <> init(vs, Nil{}), U.cat(V2, tail_of(vs), [v]), k, 0, m, acc)

def cands(ls: List<&2, Lp>, +k: U32, +m: V2, acc: List<&2, Cand>) -> List<&2, Cand>:
  match ls:
    case Nil{}:
      acc
    case Lp{_, +vs} <> t:
      cands(t, (k + 1 : U32), m, cands.first(vs, k, m, acc))

def better(+a: V2, +b: V2) -> Bool:
  Bool.or(R.less(v2x(b), v2x(a)), Bool.and(R.equal(v2x(a), v2x(b)), R.less(v2y(b), v2y(a))))

def rightmost.go(xs: List<&2, V2>, +best: V2, +bi: U32, +i: U32) -> U32:
  match xs:
    case Nil{}:
      bi
    case +v <> t:
      +b = better(v, best)
      rightmost.go(t, Bool.pick(V2, b, v, best), Bool.pick(U32, b, i, bi), (i + 1 : U32))

def rightmost(xs: List<&2, V2>) -> U32:
  match xs:
    case Nil{}:
      0
    case +v <> t:
      rightmost.go(t, v, 0, 1)

def rot.k(p: List<&2, V2> & List<&2, V2>) -> List<&2, V2>:
  (f, b) = p
  U.cat(V2, b, f)

def rotate(xs: List<&2, V2>, +j: U32) -> List<&2, V2>:
  rot.k(U.split(V2, U32.to_nat(j), xs))

def head2(xs: List<&2, V2>, +d: V2) -> V2:
  match xs:
    case Nil{}:
      d
    case _ <> Nil{}:
      d
    case _ <> v <> _:
      v

def head1(xs: List<&2, V2>, +d: V2) -> V2:
  match xs:
    case Nil{}:
      d
    case v <> _:
      v

type BR is Data:
  BrNone{}
  Br{k: U32, j: U32}

def bridge_ok.vis(sect: Bool, +k: U32, +j: U32, +m: V2, +p: V2, +es: List<&2, E2>) -> BR:
  match sect:
    case False{}:
      BrNone{}
    case True{}:
      Bool.pick(BR, visible.go(es, False{}, m, p), Br{k, j}, BrNone{})

def bridge_ok(+c: Cand, +m: V2, +mp: V2, +mn: V2, +es: List<&2, E2>) -> BR:
  Cand{+k, +j, +p, +pp, +pn, _} = c
  bridge_ok.vis(Bool.and(in_sector(pp, p, pn, m), in_sector(mp, m, mn, p)), k, j, m, p, es)

def find_bridge(cs: List<&2, Cand>, r: BR, +m: V2, +mp: V2, +mn: V2, +es: List<&2, E2>) -> BR:
  match cs r:
    case _ Br{k, j}:
      Br{k, j}
    case Nil{} BrNone{}:
      BrNone{}
    case c <> t BrNone{}:
      find_bridge(t, bridge_ok(c, m, mp, mn, es), m, mp, mn, es)

def splice(+hole: Bool, vs: List<&2, V2>, +j: U32, +hv: List<&2, V2>, +m: V2) -> Lp:
  +rv = rotate(vs, j)
  +p = head1(rv, m)
  Lp{hole, p <> U.cat(V2, hv, m <> p <> tail_of(rv))}

def merge(ls: List<&2, Lp>, +i: U32, +k: U32, +j: U32, +hv: List<&2, V2>, +m: V2, acc: List<&2, Lp>) -> List<&2, Lp>:
  match ls:
    case Nil{}:
      U.rev(Lp, acc)
    case Lp{+h, +vs} <> t:
      merge(t, (i + 1 : U32), k, j, hv, m, Bool.pick(Lp, U32.is_eq(i, k), splice(h, vs, j, hv, m), Lp{h, vs}) <> acc)

# Holes are joined one by one, rightmost first (Eberly), and only to outer
# loops (or holes already joined to them): the bridge starts at an original
# vertex of the hole, whose region sector is the whole outside of the hole.
type HK is Data:
  HK{x: R.Real, y: R.Real, vs: List<&2, V2>}

def hk_le(a: HK, b: HK) -> Bool:
  HK{+ax, +ay, _} = a
  HK{+bx, +by, _} = b
  Bool.or(R.less(bx, ax), Bool.and(R.equal(ax, bx), Bool.not(R.less(ay, by))))

def hk_of(+vs: List<&2, V2>) -> HK:
  +m = head1(rotate(vs, rightmost(vs)), v2(0, U.rzero(), U.rzero()))
  HK{v2x(m), v2y(m), vs}

type HS is Data:
  HS{outers: List<&2, Lp>, holes: List<&2, HK>, bad: Bool}

def hs.br(br: BR, +outers: List<&2, Lp>, holes: List<&2, HK>, +hv: List<&2, V2>, +m: V2) -> U.Step<HS>:
  match br:
    case BrNone{}:
      U.CfDone{HS{outers, holes, True{}}}
    case Br{k, j}:
      U.CfMore{HS{merge(outers, 0, k, j, hv, m, Nil{}), holes, False{}}}

def hs.hole(+h: List<&2, V2>, +outers: List<&2, Lp>, holes: List<&2, HK>) -> U.Step<HS>:
  +hv = rotate(h, rightmost(h))
  +m = head1(hv, v2(0, U.rzero(), U.rzero()))
  +es = all_edges(outers, loop_edges(hv, Nil{}))
  hs.br(find_bridge(U.sort(~Cand, ~cand_le, cands(outers, 0, m, Nil{})), BrNone{}, m, rev_last(hv, m), head2(hv, m), es), outers, holes, hv, m)

def hs.step(s: HS) -> U.Step<HS>:
  match s:
    case HS{outers, Nil{}, bad}:
      U.CfDone{HS{outers, Nil{}, bad}}
    case HS{outers, HK{_, _, h} <> rest, _}:
      hs.hole(h, outers, rest)

def split_lps(ls: List<&2, Lp>, os: List<&2, Lp>, hs: List<&2, HK>) -> HS:
  match ls:
    case Nil{}:
      HS{U.rev(Lp, os), U.sort(~HK, ~hk_le, hs), False{}}
    case Lp{True{}, +vs} <> t:
      split_lps(t, os, hk_of(vs) <> hs)
    case Lp{False{}, vs} <> t:
      split_lps(t, Lp{False{}, vs} <> os, hs)

# --- sliver flips -------------------------------------------------------------------------
# Ear clipping can end with a triangle whose corners lie on one straight
# boundary chain (a sliver whose plane is rounding noise). Inside one face such
# a sliver is removed by flipping its longest edge with the face triangle on
# the other side (a Lawson flip; the face is planar, so two valid 2D
# triangles are valid in 3D). A flip is taken only when both new triangles
# are counter-clockwise and not flat.

def d2f(+a: V2, +b: V2) -> F32:
  +dx = fdx(a, b)
  +dy = fdy(a, b)
  (dx * dx + dy * dy : F32)

# Flat like `flat`, measured against the longest edge (l its squared length):
# an angle below ~1e-7 rad, or the opposite corner within delta of it.
def flat3(+a: V2, +b: V2, +c: V2, +sc: Sc) -> Fl:
  +l = F32.max(d2f(a, b), F32.max(d2f(b, c), d2f(c, a)))
  +d = F32.abs(R.approx(cross_o(a, b, c)))
  fl.of((d <= (l * 0.0000001 : F32) : F32), d, F32.sqrt(l), sc)

def tflat(t: T3P, +sc: Sc) -> Fl:
  T3P{a, b, c} = t
  flat3(a, b, c, sc)

# Rotate so that the longest edge is c -> a (b the middle corner).
def rot_long(t: T3P) -> T3P:
  T3P{+a, +b, +c} = t
  +lab = d2f(a, b)
  +lbc = d2f(b, c)
  +lca = d2f(c, a)
  Bool.pick(T3P, Bool.and((lca >= lab : F32), (lca >= lbc : F32)), T3P{a, b, c}, Bool.pick(T3P, (lab >= lbc : F32), T3P{b, c, a}, T3P{c, a, b}))

def has_edge(t: T3P, +x: U32, +y: U32) -> Bool:
  T3P{a, b, c} = t
  +ia = v2id(a)
  +ib = v2id(b)
  +ic = v2id(c)
  Bool.or(Bool.and(U32.is_eq(ia, x), U32.is_eq(ib, y)), Bool.or(Bool.and(U32.is_eq(ib, x), U32.is_eq(ic, y)), Bool.and(U32.is_eq(ic, x), U32.is_eq(ia, y))))

# The corner opposite the directed edge x -> y.
def opposite_of(t: T3P, +x: U32) -> V2:
  T3P{+a, +b, +c} = t
  Bool.pick(V2, U32.is_eq(v2id(a), x), c, Bool.pick(V2, U32.is_eq(v2id(b), x), a, b))

type NB is Data:
  NbNone{}
  Nb{d: V2, rest: List<&2, T3P>}

def nb_of.if(hit: Bool, +t: T3P, +x: U32, r: List<&2, T3P>, acc: List<&2, T3P>) -> NB:
  match hit:
    case True{}:
      Nb{opposite_of(t, x), U.rev_onto(T3P, acc, r)}
    case False{}:
      NbNone{}

# The triangle of ts with directed edge x -> y: its third corner and the
# other triangles.
def find_nb(ts: List<&2, T3P>, res: NB, +x: U32, +y: U32, +acc: List<&2, T3P>) -> NB:
  match ts res:
    case _ Nb{d, rest}:
      Nb{d, rest}
    case Nil{} NbNone{}:
      NbNone{}
    case +t <> +r NbNone{}:
      find_nb(r, nb_of.if(has_edge(t, x, y), t, x, r, acc), x, y, t <> acc)

# A flip result with the largest r of the flatness decisions it took.
type FL3 is Data:
  FlNo{r: F32}
  FlYes{ts: List<&2, T3P>, r: F32}

def flip.new(ok: Bool, +a: V2, +b: V2, +c: V2, +d: V2, rest: List<&2, T3P>, +r: F32) -> FL3:
  match ok:
    case True{}:
      FlYes{T3P{b, c, d} <> T3P{b, d, a} <> rest, r}
    case False{}:
      FlNo{r}

def flip.flat(+ccw: Bool, f1: Fl, f2: Fl, +a: V2, +b: V2, +c: V2, +d: V2, rest: List<&2, T3P>) -> FL3:
  Fl{+x1, +r1} = f1
  Fl{+x2, +r2} = f2
  flip.new(Bool.and(ccw, Bool.not(Bool.or(x1, x2))), a, b, c, d, rest, Bool.pick(F32, ccw, F32.max(r1, r2), 0.0))

def flip.nb(nb: NB, +a: V2, +b: V2, +c: V2, +sc: Sc) -> FL3:
  match nb:
    case NbNone{}:
      FlNo{0.0}
    case Nb{+d, rest}:
      flip.flat(Bool.and(pos_o(orient(b, c, d)), pos_o(orient(b, d, a))), flat3(b, c, d, sc), flat3(b, d, a, sc), a, b, c, d, rest)

# Try to flip the flat triangle t (its long edge c -> a) against the rest.
def flip.rot(r: T3P, others: List<&2, T3P>, +sc: Sc) -> FL3:
  T3P{+a, +b, +c} = r
  flip.nb(find_nb(others, NbNone{}, v2id(a), v2id(c), Nil{}), a, b, c, sc)

def flip.try(+t: T3P, others: List<&2, T3P>, +sc: Sc) -> FL3:
  flip.rot(rot_long(t), others, sc)

def fl3.max(x: FL3, +m: F32) -> FL3:
  match x:
    case FlNo{r}:
      FlNo{F32.max(r, m)}
    case FlYes{ts, r}:
      FlYes{ts, F32.max(r, m)}

def flip.if(f: Fl, +t: T3P, +others: List<&2, T3P>, +sc: Sc) -> FL3:
  Fl{isflat, +r} = f
  match isflat:
    case True{}:
      fl3.max(flip.try(t, others, sc), r)
    case False{}:
      FlNo{0.0}

# First flat triangle that can be flipped away (done: triangles already seen).
def flip.scan(ts: List<&2, T3P>, res: FL3, +done: List<&2, T3P>, +sc: Sc) -> FL3:
  match ts res:
    case _ FlYes{xs, m}:
      FlYes{xs, m}
    case Nil{} FlNo{m}:
      FlNo{m}
    case +t <> +r FlNo{m}:
      flip.scan(r, fl3.max(flip.if(tflat(t, sc), t, U.rev_onto(T3P, done, r), sc), m), t <> done, sc)

# The flip loop's state: the triangles, the face's scale and the largest r.
type FS is Data:
  FS{ts: List<&2, T3P>, sc: Sc, dm: F32}

def flip.fin(r: FL3, ts: List<&2, T3P>, +sc: Sc, +dm: F32) -> U.Step<FS>:
  match r:
    case FlNo{m}:
      U.CfDone{FS{ts, sc, F32.max(dm, m)}}
    case FlYes{xs, m}:
      U.CfMore{FS{xs, sc, F32.max(dm, m)}}

def flip.step2(+ts: List<&2, T3P>, +sc: Sc, +dm: F32) -> U.Step<FS>:
  flip.fin(flip.scan(ts, FlNo{0.0}, Nil{}, sc), ts, sc, dm)

def flip.step(s: FS) -> U.Step<FS>:
  FS{ts, sc, dm} = s
  flip.step2(ts, sc, dm)

def flips(+ts: List<&2, T3P>, +sc: Sc) -> FS:
  U.loop(~FS, ~flip.step, U32.to_nat((U.len(T3P, ts) + 1 : U32)), U.CfMore{FS{ts, sc, 0.0}})

def to_t3(ts: List<&2, T3P>, acc: List<&2, T3>) -> List<&2, T3>:
  match ts:
    case Nil{}:
      acc
    case T3P{a, b, c} <> t:
      to_t3(t, T3{v2id(a), v2id(b), v2id(c)} <> acc)

# --- collinear boundary runs ---------------------------------------------------------------
# Output faces carry many boundary vertices that lie on a straight side (a
# split point on a chord of a tessellated circle, an intersection vertex on an
# input edge). As ear corners they only give slivers. Before clipping, every
# loop drops each vertex that continues its side forward (corner flat by
# `flat`, i.e. within ~1e-7 rad or within delta of its chord, and turning
# back not at all); the dropped
# vertices of one side form a run on the directed edge u -> w between the
# kept neighbours. After clipping, each run is put back by fanning the
# triangle that owns u -> w from its opposite corner (Lawson-free: all fan
# triangles are checked counter-clockwise exactly, else the face is refused).
# No vertex moves and the boundary is exactly the original one.

type RunE is Data:
  RunE{a: U32, b: U32, pts: List<&2, V2>}

# dm: the largest r of the runs' flatness decisions (0 when the loop is kept
# unsimplified).
type SLp is Data:
  SLp{vs: List<&2, V2>, runs: List<&2, RunE>, dm: F32}

def fdot(+u: V2, +v: V2, +w: V2) -> F32:
  (fdx(v, u) * fdx(w, v) + fdy(v, u) * fdy(w, v) : F32)

# v lies on the straight continuation of u -> w (r as in `flat`, for a drop).
def straight.of(f: Fl, +fwd: Bool) -> Fl:
  Fl{fl, +r} = f
  +ok = Bool.and(fl, fwd)
  Fl{ok, Bool.pick(F32, ok, r, 0.0)}

def straight(+u: V2, +v: V2, +w: V2, +sc: Sc) -> Fl:
  straight.of(flat(u, v, w, sc), Bool.and((fdot(u, v, w) > 0.0 : F32), Bool.not(Bool.or(same_pos(u, v), same_pos(v, w)))))

type SW is Data:
  SW{last: V2, pend: List<&2, V2>, kept: List<&2, V2>, runs: List<&2, RunE>, dm: F32}

def sw.close(+last: V2, +v: V2, pend: List<&2, V2>, runs: List<&2, RunE>) -> List<&2, RunE>:
  match pend:
    case Nil{}:
      runs
    case +p <> t:
      RunE{v2id(last), v2id(v), U.rev(V2, p <> t)} <> runs

def sw.step(drop: Bool, +v: V2, s: SW) -> SW:
  match drop:
    case True{}:
      SW{last, pend, kept, runs, dm} = s
      SW{last, v <> pend, kept, runs, dm}
    case False{}:
      SW{+last, pend, kept, runs, dm} = s
      SW{v, Nil{}, v <> kept, sw.close(last, v, pend, runs), dm}

def sw.dec(f: Fl, +v: V2, s: SW) -> SW:
  Fl{drop, +r} = f
  SW{last, pend, kept, runs, +dm} = s
  sw.step(drop, v, SW{last, pend, kept, runs, F32.max(dm, r)})

# vs: the vertices after the first, ns: their successors (ending with first).
def sw.go(vs: List<&2, V2>, ns: List<&2, V2>, s: SW, +sc: Sc) -> SW:
  match vs ns:
    case +v <> vt +n <> nt:
      SW{+last, _, _, _, _} = s
      sw.go(vt, nt, sw.dec(straight(last, v, n, sc), v, s), sc)
    case _ _:
      s

def sw.fin.if(ok: Bool, +last: V2, +first: V2, pend: List<&2, V2>, kept: List<&2, V2>, runs: List<&2, RunE>, +orig: List<&2, V2>, +dm: F32) -> SLp:
  match ok:
    case True{}:
      SLp{U.rev(V2, kept), sw.close(last, first, pend, runs), dm}
    case False{}:
      SLp{orig, Nil{}, 0.0}

def sw.fin(s: SW, +first: V2, +orig: List<&2, V2>) -> SLp:
  SW{+last, pend, +kept, runs, dm} = s
  sw.fin.if(U32.is_ge(U.len(V2, kept), 3), last, first, pend, kept, runs, orig, dm)

def simp.go(+rv: List<&2, V2>, +orig: List<&2, V2>, +sc: Sc) -> SLp:
  match rv:
    case Nil{}:
      SLp{orig, Nil{}, 0.0}
    case +f <> t:
      sw.fin(sw.go(t, U.cat(V2, tail_of(t), [f]), SW{f, Nil{}, [f], Nil{}, 0.0}, sc), f, orig)

# Start at the rightmost vertex (a strictly convex corner, never dropped).
def simplify(+xs: List<&2, V2>, +sc: Sc) -> SLp:
  simp.go(rotate(xs, rightmost(xs)), xs, sc)

def runk_lt(+a: U32, +b: U32, +c: U32, +d: U32) -> Bool:
  Bool.or(U32.is_lt(a, c), Bool.and(U32.is_eq(a, c), U32.is_lt(b, d)))

def run_le(x: RunE, y: RunE) -> Bool:
  RunE{+a, +b, _} = x
  RunE{+c, +d, _} = y
  Bool.not(runk_lt(c, d, a, b))

def zrun() -> RunE:
  RunE{4294967295, 4294967295, Nil{}}

def run_key_lt(r: RunE, +a: U32, +b: U32) -> Bool:
  RunE{+x, +y, _} = r
  runk_lt(x, y, a, b)

def rlower.go(fuel: Nat, go: Bool, +lo: U32, +hi: U32, +a: U32, +b: U32, +t: U.Table<RunE>) -> U32:
  match fuel go:
    case _ False{}:
      lo
    case 0n _:
      lo
    case 1n+p True{}:
      +mid = U32.div((lo + hi : U32), 2)
      +less = run_key_lt(U.tget(RunE, t, mid, zrun()), a, b)
      +lo2 = Bool.pick(U32, less, (mid + 1 : U32), lo)
      +hi2 = Bool.pick(U32, less, hi, mid)
      rlower.go(p, U32.is_lt(lo2, hi2), lo2, hi2, a, b, t)

def run_pts.if(hit: Bool, pts: List<&2, V2>) -> List<&2, V2>:
  match hit:
    case True{}:
      pts
    case False{}:
      Nil{}

def run_pts(r: RunE, +a: U32, +b: U32) -> List<&2, V2>:
  RunE{x, y, pts} = r
  run_pts.if(Bool.and(U32.is_eq(x, a), U32.is_eq(y, b)), pts)

type RTab is Data:
  RTab{n: U32, t: U.Table<RunE>}

# The run on directed edge a -> b (empty when there is none).
def run_of(+rt: RTab, +a: U32, +b: U32) -> List<&2, V2>:
  RTab{+n, +t} = rt
  run_pts(U.tget(RunE, t, rlower.go(40n, U32.is_lt(0, n), 0, n, a, b, t), zrun()), a, b)

# Triangles (x, p1, apex), (p1, p2, apex), ..., (pm, y, apex).
def fan1.go(pts: List<&2, V2>, +prev: V2, +y: V2, +apex: V2, acc: List<&2, T3P>) -> List<&2, T3P>:
  match pts:
    case Nil{}:
      T3P{prev, y, apex} <> acc
    case +p <> t:
      fan1.go(t, p, y, apex, T3P{prev, p, apex} <> acc)

def fan1(+x: V2, +y: V2, +apex: V2, pts: List<&2, V2>, acc: List<&2, T3P>) -> List<&2, T3P>:
  fan1.go(pts, x, y, apex, acc)

def lastv(xs: List<&2, V2>, +d: V2) -> V2:
  match xs:
    case Nil{}:
      d
    case v <> t:
      lastv(t, v)

def mid_of(xs: List<&2, V2>) -> List<&2, V2>:
  init(tail_of(xs), Nil{})

# Counter-clockwise (a, b, c) with the run rab (non-empty) on a -> b, rbc on
# b -> c, rca on c -> a: fan the ab side from c, then the two end triangles
# (a, p1, c) and (pk, b, c) along their runs on c -> a and b -> c.
def fan3(+a: V2, +b: V2, +c: V2, +rab: List<&2, V2>, +rbc: List<&2, V2>, +rca: List<&2, V2>, acc: List<&2, T3P>) -> List<&2, T3P>:
  +p1 = head1(rab, a)
  +pk = lastv(rab, a)
  +first = fan1(c, a, p1, rca, acc)
  +mid = Bool.pick(List<&2, T3P>, U32.is_ge(U.len(V2, rab), 2), fan1(p1, pk, c, mid_of(rab), first), first)
  fan1(b, c, pk, rbc, mid)

def nonempty(xs: List<&2, V2>) -> Bool:
  match xs:
    case Nil{}:
      False{}
    case _:
      True{}

def put_runs.c(hc: Bool, +a: V2, +b: V2, +c: V2, +ra: List<&2, V2>, +rb: List<&2, V2>, +rc: List<&2, V2>, acc: List<&2, T3P>) -> List<&2, T3P>:
  match hc:
    case True{}:
      fan3(c, a, b, rc, ra, rb, acc)
    case False{}:
      T3P{a, b, c} <> acc

def put_runs.b(hb: Bool, +a: V2, +b: V2, +c: V2, +ra: List<&2, V2>, +rb: List<&2, V2>, +rc: List<&2, V2>, acc: List<&2, T3P>) -> List<&2, T3P>:
  match hb:
    case True{}:
      fan3(b, c, a, rb, rc, ra, acc)
    case False{}:
      put_runs.c(nonempty(rc), a, b, c, ra, rb, rc, acc)

def put_runs.a(ha: Bool, +a: V2, +b: V2, +c: V2, +ra: List<&2, V2>, +rb: List<&2, V2>, +rc: List<&2, V2>, acc: List<&2, T3P>) -> List<&2, T3P>:
  match ha:
    case True{}:
      fan3(a, b, c, ra, rb, rc, acc)
    case False{}:
      put_runs.b(nonempty(rb), a, b, c, ra, rb, rc, acc)

def put_runs(+a: V2, +b: V2, +c: V2, +ra: List<&2, V2>, +rb: List<&2, V2>, +rc: List<&2, V2>, acc: List<&2, T3P>) -> List<&2, T3P>:
  put_runs.a(nonempty(ra), a, b, c, ra, rb, rc, acc)

def reinsert(ts: List<&2, T3P>, +rt: RTab, acc: List<&2, T3P>) -> List<&2, T3P>:
  match ts:
    case Nil{}:
      acc
    case T3P{+a, +b, +c} <> t:
      +ia = v2id(a)
      +ib = v2id(b)
      +ic = v2id(c)
      reinsert(t, rt, put_runs(a, b, c, run_of(rt, ia, ib), run_of(rt, ib, ic), run_of(rt, ic, ia), acc))

def all_ccw(ts: List<&2, T3P>, ok: Bool) -> Bool:
  match ts ok:
    case _ False{}:
      False{}
    case Nil{} True{}:
      True{}
    case T3P{+a, +b, +c} <> t True{}:
      all_ccw(t, pos_o(orient(a, b, c)))

# --- face entry -----------------------------------------------------------------------------

# dm: the largest r of the face's flatness decisions (type Fl), in units of S.
type FT is Data:
  FT{bad: Bool, tris: List<&2, T3>, dm: F32}

def classify(ls: List<&2, List<&2, V2>>, acc: List<&2, Lp>) -> List<&2, Lp>:
  match ls:
    case Nil{}:
      U.rev(Lp, acc)
    case +vs <> t:
      classify(t, Lp{R.less(area2(vs), U.rzero()), vs} <> acc)

# Triangles with their corners, before the runs are put back.
type FTP is Data:
  FTP{bad: Bool, tris: List<&2, T3P>, dm: F32}

def ft_flips(f: FS, +eb: Bool, +m: F32, acc: FTP) -> FTP:
  FS{fts, _, fm} = f
  FTP{b, ts, dm} = acc
  FTP{Bool.or(b, eb), U.cat(T3P, fts, ts), F32.max(dm, F32.max(m, fm))}

def ft_add(e: EC, +sc: Sc, acc: FTP) -> FTP:
  EC{rest, bk, _, _, _, tris, eb, _, m} = e
  ft_flips(flips(tris, sc), Bool.or(eb, U.nonzero((U.len(V2, rest) + U.len(V2, bk) : U32))), m, acc)

def clip_all(ls: List<&2, Lp>, +sc: Sc, acc: FTP) -> FTP:
  match ls:
    case Nil{}:
      acc
    case Lp{_, vs} <> t:
      clip_all(t, sc, ft_add(clip(vs, sc), sc, acc))

def tri_face.hs(s: HS, +sc: Sc, +dm: F32) -> FTP:
  HS{ls, hs, bad} = s
  clip_all(ls, sc, FTP{Bool.or(bad, U.nonzero(U.len(HK, hs))), Nil{}, dm})

def with_runs(none: Bool, ts: List<&2, T3P>, +runs: List<&2, RunE>, +n: U32) -> List<&2, T3P>:
  match none:
    case True{}:
      ts
    case False{}:
      reinsert(ts, RTab{n, U.table(RunE, n, U.sort(~RunE, ~run_le, runs))}, Nil{})

def tri_face.fin(f: FTP, +runs: List<&2, RunE>) -> FT:
  FTP{bad, ts, dm} = f
  +n = U.len(RunE, runs)
  +out = with_runs(U.is_zero(n), ts, runs, n)
  FT{Bool.or(bad, Bool.not(all_ccw(out, True{}))), to_t3(out, Nil{}), dm}

type SLs is Data:
  SLs{ls: List<&2, List<&2, V2>>, runs: List<&2, RunE>, dm: F32}

def sls_add(p: SLp, acc: SLs) -> SLs:
  SLp{vs, rs, m} = p
  SLs{ls2, runs, dm} = acc
  SLs{vs <> ls2, U.cat(RunE, rs, runs), F32.max(dm, m)}

def simp_all(ls: List<&2, List<&2, V2>>, +sc: Sc, acc: SLs) -> SLs:
  match ls:
    case Nil{}:
      SLs{ls2, runs, dm} = acc
      SLs{U.rev(List<&2, V2>, ls2), runs, dm}
    case +l <> t:
      simp_all(t, sc, sls_add(simplify(l, sc), acc))

def tri_face.simp(s: SLs, +sc: Sc) -> FT:
  SLs{+ls, +runs, +dm} = s
  +n = U.len(List<&2, V2>, ls)
  tri_face.fin(tri_face.hs(U.loop(~HS, ~hs.step, U32.to_nat((n + 2 : U32)), U.CfMore{split_lps(classify(ls, Nil{}), Nil{}, Nil{})}), sc, dm), runs)

def tri_face.gen(ls: List<&2, List<&2, V2>>, +sc: Sc) -> FT:
  tri_face.simp(simp_all(ls, sc, SLs{Nil{}, Nil{}, 0.0}), sc)

# The flatness scale of a job: S (its largest |coordinate|, at least 1) and
# delta = dk * S (dk = 2^-42 in production; see Sc).
def scale(+s: F32, +dk: F32) -> Sc:
  Sc{s, (s * dk : F32)}

# Triangles of one face given its loops (projected); sc: the job's scale.
def tri_face(ls: List<&2, List<&2, V2>>, +sc: Sc) -> FT:
  match ls:
    case (a <> b <> c <> Nil{}) <> Nil{}:
      FT{False{}, [T3{v2id(a), v2id(b), v2id(c)}], 0.0}
    case +other:
      tri_face.gen(other, sc)
