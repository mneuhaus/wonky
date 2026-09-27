import Base
import ../../real.bend as R
import ../../precise.bend as G
import ../../robust-predicates.bend as RP
import ./util.bend as U
import ./assemble.bend as A
import ./inter.bend as I
import ./weld.bend as W
import ./earclip.bend as E

# corefine: cancellation of coplanar membranes (the regularization step that
# Manifold performs after Boolean3 by removing folded triangle pairs,
# edge_op.cpp RemoveIfFolded; docs/hybrid-robust.md F1, F1b).
#
# The symbolic perturbation (shadow.bend) gives every element its own tie
# direction: a vertex its vertex normal, an edge the sum of its two face
# normals, a face its own normal. For exactly (or unified) coplanar faces of
# P and Q these directions are not one geometric offset. The decisions stay
# consistent, so the output halfedges pair up, but they can place a P face on
# one side of one Q triangle and on the other side of the neighbouring Q
# triangle of the same plane. The output then keeps a region of a P face and
# the same region of a Q face with the opposite orientation: a zero-thickness
# sheet (or crack) that a regularized Boolean does not have. Probe 307:5
# (R20 freecut notch flush with the tilted plate side, face 8 / tool face 47):
# the P face and the flipped tool face keep the same quad, both ear clippers
# pick the same diagonal, and the result is refused as not 2-manifold.
#
# Rule: a P face and a Q face whose input tags are in one plane class
# (kernel/hybrid/unify.bend: unified, or identical exact carriers) and whose
# effective normals are opposite, and which share a pair of opposite
# halfedges, are one membrane. Such a pair is never a real edge: two
# coplanar faces meeting at an edge with opposite orientation fold the
# surface by 180 degrees. A membrane group (joined also through coplanar
# faces of equal orientation that share an edge) is relabelled to one face,
# its root, and opposite pairs cancel inside it (weld.bend cancel). What
# remains bounds the signed sum w of the member regions (+1 where a member
# runs like the root, -1 where it runs against it).
#
# The remainder is one face only when w has one sign (F1b). A face-contact
# union keeps P's top outside the contact (+1) and Q's bottom outside it (-1)
# in one plane, and a fold joins both into one group; the members also
# overlap without cutting each other, so the remaining halfedges can cross
# one another, and one halfedge can bound +1 on one part and -1 on another
# (verify-2: x-cross). No label per face or per halfedge describes such a
# remainder. So every remaining halfedge h = a -> b of a group gets its w on
# the left, exactly: the winding number of the group's other remaining
# halfedges around a point just left of h (a ray from h's midpoint along its
# left normal, signed crossings, half-open; points doubled so the midpoint
# a + b is exact; orient2d with an F32 filter and a big-integer fallback).
# w_left = 1 on every voting halfedge: the group is the root's face (+1);
# w_left = 0 on every one: the face of the root's opposite member (-1);
# nothing left: the membrane cancelled completely. The remainder is not yet
# repaired: a zero-width spike (u -> v -> u, with v near an edge's line) that
# the T-junction repair zips later overlaps an edge the other way, and w
# changes along that edge where the overlap ends. A halfedge that runs
# against another over more than eps (the repair's tolerance 2^-36 S, both
# ends within eps of its line; Reals) therefore does not vote. Any other
# remainder (both signs, |w| > 1, no vote, a halfedge doubled or met at its
# midpoint) is not cancelled: the group's members keep their halfedges as
# the corefine produced them, and the output gates judge them as without
# this step. Without a membrane pair the halfedges come back unchanged
# (same list, byte-identical results).

# eps: the short-edge / T-junction tolerance 2^-36 * S (weld.bend eps2_of).
type Ctx is Data:
  Ctx{pos: U.Table<G.Vec3>, ntP: U32, nf: U32, fnP: U.Table<U.N3>, fnQ: U.Table<U.N3>, tagP: U.Table<U32>, tagQ: U.Table<U32>, flipQ: Bool, pc: U.Table<U32>, eps: F32}

# any: some membrane group was cancelled; groups: how many.
type Out is Data:
  MbOk{any: Bool, groups: U32, fh: List<&2, A.FH>}
  MbBad{reason: String}

# A face: of P, its plane class (none() without one), its effective normal
# (a flipped Q face points the other way).
type FI is Data:
  FI{p: Bool, c: U32, n: U.N3}

# A link between two faces sharing an opposite halfedge pair: mem (P and Q,
# opposite orientation) or a coplanar neighbour of equal orientation.
type Lk is Data:
  Lk{a: U32, b: U32, mem: Bool}

def none() -> U32:
  4294967295

def ndot(+a: U.N3, +b: U.N3) -> F32:
  (U.nx(a) * U.nx(b) + U.ny(a) * U.ny(b) + U.nz(a) * U.nz(b) : F32)

def fi(+f: U32, cx: Ctx) -> FI:
  Ctx{_, +ntP, _, +fnP, +fnQ, +tagP, +tagQ, +flipQ, +pc, _} = cx
  +isP = U32.is_lt(f, ntP)
  +fq = (f - ntP : U32)
  +nq = U.tget(U.N3, fnQ, fq, U.n3zero())
  +n = Bool.pick(U.N3, isP, U.tget(U.N3, fnP, f, U.n3zero()), Bool.pick(U.N3, flipQ, U.nneg(nq), nq))
  +tag = Bool.pick(U32, isP, U.tget(U32, tagP, f, 0), U.tget(U32, tagQ, fq, 0))
  FI{isP, U.tget(U32, pc, tag, none()), n}

def fi_n(x: FI) -> U.N3:
  FI{_, _, n} = x
  n

def lk.of(x: FI, y: FI, +a: U32, +b: U32, acc: List<&2, Lk>) -> List<&2, Lk>:
  FI{+pa, +ca, +na} = x
  FI{+pb, +cb, +nb} = y
  +same = Bool.and(U32.is_eq(ca, cb), U32.is_ne(ca, none()))
  +d = ndot(na, nb)
  +mem = Bool.and(same, Bool.and(Bool.xor(pa, pb), (d < 0.0 : F32)))
  +cop = Bool.and(same, (d > 0.0 : F32))
  U.cons_if(Lk, Bool.or(mem, cop), Lk{a, b, mem}, acc)

def lk.pair(opp: Bool, +fa: U32, +fb: U32, +cx: Ctx, acc: List<&2, Lk>) -> List<&2, Lk>:
  match opp:
    case True{}:
      lk.of(fi(fa, cx), fi(fb, cx), fa, fb, acc)
    case False{}:
      acc

# Consecutive opposite halfedges of the list sorted by (lo, hi, start) are
# the two sides of one edge; a lone halfedge (unpaired) is skipped.
def links.go(fuel: Nat, xs: List<&2, A.FH>, +cx: Ctx, acc: List<&2, Lk>) -> List<&2, Lk>:
  match fuel xs:
    case 0n _:
      acc
    case _ Nil{}:
      acc
    case _ _ <> Nil{}:
      acc
    case 1n+k A.FH{+fa, +sa, +ea} <> A.FH{+fb, +sb, +eb} <> +t:
      +opp = Bool.and(U32.is_eq(sa, eb), U32.is_eq(ea, sb))
      links.go(k, Bool.pick(List<&2, A.FH>, opp, t, A.FH{fb, sb, eb} <> t), cx, lk.pair(opp, fa, fb, cx, acc))

def links(+fh: List<&2, A.FH>, +cx: Ctx) -> List<&2, Lk>:
  +ts = U.sort(~A.FH, ~W.gk_le, fh)
  links.go(U32.to_nat((U.len(A.FH, ts) + 1 : U32)), ts, cx, Nil{})

def any_mem(ls: List<&2, Lk>) -> Bool:
  match ls:
    case Nil{}:
      False{}
    case Lk{_, _, True{}} <> _:
      True{}
    case Lk{_, _, False{}} <> t:
      any_mem(t)


# --- groups --------------------------------------------------------------------------

def uf.links(ls: List<&2, Lk>, a: Array<U32>, +fuel: Nat) -> Array<U32>:
  match ls:
    case Nil{}:
      a
    case Lk{+x, +y, _} <> t:
      uf.links(t, I.union(a, x, y, fuel), fuel)

def set.if(m: Bool, a: Array<U32>, +i: U32, +v: U32) -> Array<U32>:
  match m:
    case True{}:
      Array.set(U32, a, i, v)
    case False{}:
      a

# act[root] = 1 for the roots of membrane groups.
def mark.act(ls: List<&2, Lk>, +rt: U.Table<U32>, a: Array<U32>) -> Array<U32>:
  match ls:
    case Nil{}:
      a
    case Lk{+x, _, m} <> t:
      mark.act(t, rt, set.if(m, a, U.tget(U32, rt, x, 0), 1))

def table_of(+n: U32, a: Array<U32>) -> U.Table<U32>:
  U.table(U32, n, U.list_of(~U32, n, a))

def relabel(fs: List<&2, A.FH>, +m: U.Table<U32>, acc: List<&2, A.FH>) -> List<&2, A.FH>:
  match fs:
    case Nil{}:
      U.rev(A.FH, acc)
    case A.FH{+f, s, e} <> t:
      relabel(t, m, A.FH{U.tget(U32, m, f, f), s, e} <> acc)

# Face of every halfedge: its group root when the group is a membrane group.
def root_map.go(n: Nat, +i: U32, +rt: U.Table<U32>, +act: U.Table<U32>, acc: List<&2, U32>) -> List<&2, U32>:
  match n:
    case 0n:
      U.rev(U32, acc)
    case 1n+k:
      +r = U.tget(U32, rt, i, i)
      root_map.go(k, (i + 1 : U32), rt, act, Bool.pick(U32, U.nonzero(U.tget(U32, act, r, 0)), r, i) <> acc)

# up(f): face f runs like the root r of its group (its effective normal
# points the root's way; the members are faces of one plane class with
# non-zero normals).
def up(+f: U32, +r: U32, +cx: Ctx) -> Bool:
  Bool.or(U32.is_eq(r, f), (ndot(fi_n(fi(f, cx)), fi_n(fi(r, cx))) > 0.0 : F32))

# neg[root]: the member of the root's last membrane link that runs against
# the root (F1's choice: every membrane link has one). bad: a link whose
# faces do not run as the link says (a membrane pair alike, a coplanar
# neighbour opposite).
type NS is Type:
  NS{bad: Bool, neg: Array<U32>}

def neg.go(ls: List<&2, Lk>, +rt: U.Table<U32>, +cx: Ctx, st: NS) -> NS:
  match ls:
    case Nil{}:
      st
    case Lk{+x, +y, +mem} <> t:
      NS{bad, neg} = st
      +r = U.tget(U32, rt, x, x)
      +ux = up(x, r, cx)
      +odd = Bool.xor(ux, up(y, r, cx))
      +ok = Bool.or(Bool.and(mem, odd), Bool.and(Bool.not(mem), Bool.not(odd)))
      neg.go(t, rt, cx, NS{Bool.or(bad, Bool.not(ok)), set.if(mem, neg, r, Bool.pick(U32, ux, y, x))})

# --- exact winding of a group's remainder ------------------------------------------------

# A projected point, doubled: exact big-integer coordinates, F32 values and
# Reals (the tolerance tests).
type BP is Data:
  BP{x: RP.Big, y: RP.Big, fx: F32, fy: F32, rx: R.Real, ry: R.Real}

# A remaining halfedge: its ends and doubled midpoint.
type HE is Data:
  HE{a: BP, b: BP, m: BP}

def bp_of(+v: E.V2) -> BP:
  E.V2{_, +x, +y, +fx, +fy} = v
  +bx = RP.from_real(x)
  +by = RP.from_real(y)
  BP{RP.add(bx, bx), RP.add(by, by), (fx + fx : F32), (fy + fy : F32), R.add(x, x), R.add(y, y)}

# The midpoint of a -> b in the doubled frame: a + b.
def mid(+a: E.V2, +b: E.V2) -> BP:
  E.V2{_, +ax, +ay, afx, afy} = a
  E.V2{_, +bx, +by, bfx, bfy} = b
  BP{RP.add(RP.from_real(ax), RP.from_real(bx)), RP.add(RP.from_real(ay), RP.from_real(by)), (afx + bfx : F32), (afy + bfy : F32), R.add(ax, bx), R.add(ay, by)}

def he_of(+a: E.V2, +b: E.V2) -> HE:
  HE{bp_of(a), bp_of(b), mid(a, b)}

def orient_x(+a: BP, +b: BP, +c: BP) -> U32:
  BP{+ax, +ay, _, _, _, _} = a
  BP{bx, by, _, _, _, _} = b
  BP{cx, cy, _, _, _, _} = c
  E.sign_of(RP.sign(RP.sub(RP.mul(RP.sub(bx, ax), RP.sub(cy, ay)), RP.mul(RP.sub(by, ay), RP.sub(cx, ax)))))

def orient.k(sure: Bool, +d: F32, +a: BP, +b: BP, +c: BP) -> U32:
  match sure:
    case True{}:
      Bool.pick(U32, (d > 0.0 : F32), 1, 4294967295)
    case False{}:
      orient_x(a, b, c)

# Sign of (b - a) x (c - a): 1, 0 or -1 (two's complement). The F32 values
# err by <= 2^-21 m (m their largest magnitude; a midpoint or a ray end is
# one or two more roundings), so u = b - a and v = c - a by <= 2^-19.5 m +
# 2^-24 |.|, and u x v by < 2^-18.5 m (|u|1 + |v|1) + 2^-21 |u|1 |v|1: the F32
# sign is trusted above 2^-18 m (|u|1 + |v|1) + 2^-20 |u|1 |v|1, else the
# big integers decide.
def orient(+a: BP, +b: BP, +c: BP) -> U32:
  BP{_, _, +afx, +afy, _, _} = a
  BP{_, _, bfx, bfy, _, _} = b
  BP{_, _, cfx, cfy, _, _} = c
  +ux = (bfx - afx : F32)
  +uy = (bfy - afy : F32)
  +vx = (cfx - afx : F32)
  +vy = (cfy - afy : F32)
  +m = F32.max(E.fmax3(afx, bfx, cfx), E.fmax3(afy, bfy, cfy))
  +nu = (F32.abs(ux) + F32.abs(uy) : F32)
  +nv = (F32.abs(vx) + F32.abs(vy) : F32)
  +d = (ux * vy - uy * vx : F32)
  orient.k((F32.abs(d) > (0.000003814697265625 * m * (nu + nv) + 0.00000095367431640625 * nu * nv : F32) : F32), d, a, b, c)

# r = m + the left normal of a -> b (all doubled).
def ray_end(+m: BP, +a: BP, +b: BP) -> BP:
  BP{mx, my, mfx, mfy, mrx, mry} = m
  BP{+ax, +ay, afx, afy, +arx, +ary} = a
  BP{bx, by, bfx, bfy, brx, bry} = b
  BP{RP.sub(mx, RP.sub(by, ay)), RP.add(my, RP.sub(bx, ax)), (mfx - (bfy - afy) : F32), (mfy + (bfx - afx) : F32), R.sub(mrx, R.sub(bry, ary)), R.add(mry, R.sub(brx, arx))}

# (b - a) . (d - c) < 0, for (nearly) collinear edges: |dot| = |u| |v|, so
# the Real value is far from 0.
def against(+a: BP, +b: BP, +c: BP, +d: BP) -> Bool:
  BP{_, _, _, _, +ax, +ay} = a
  BP{_, _, _, _, bx, by} = b
  BP{_, _, _, _, +cx, +cy} = c
  BP{_, _, _, _, dx, dy} = d
  (R.approx(R.add(R.mul(R.sub(bx, ax), R.sub(dx, cx)), R.mul(R.sub(by, ay), R.sub(dy, cy)))) < 0.0 : F32)

# u x (p - c) and u . (p - c) in Reals (u = d - c), rounded to F32: an error
# of ~2^-44 of the coordinates, far below the tolerance they are compared to.
def rcross(+ux: R.Real, +uy: R.Real, +c: BP, +p: BP) -> F32:
  BP{_, _, _, _, +cx, +cy} = c
  BP{_, _, _, _, px, py} = p
  R.approx(R.sub(R.mul(ux, R.sub(py, cy)), R.mul(uy, R.sub(px, cx))))

def rdot(+ux: R.Real, +uy: R.Real, +c: BP, +p: BP) -> F32:
  BP{_, _, _, _, +cx, +cy} = c
  BP{_, _, _, _, px, py} = p
  R.approx(R.add(R.mul(ux, R.sub(px, cx)), R.mul(uy, R.sub(py, cy))))

# h = a -> b runs along c -> d over more than e (both ends within e of its
# line, the two spans overlapping by more than e): 1 against it (part of a
# zero-width spike or of an edge a spike folds back over, before the
# T-junction repair zips it; eps is that repair's tolerance), 2 along it (a
# doubled halfedge), else 0. Such an h does not vote: w changes along it
# where the overlap ends.
def near.real(+h: HE, +c: BP, +d: BP, +e: F32) -> U32:
  HE{+a, +b, _} = h
  BP{_, _, _, _, +crx, +cry} = c
  BP{_, _, _, _, drx, dry} = d
  +ux = R.sub(drx, crx)
  +uy = R.sub(dry, cry)
  +l2 = R.approx(R.add(R.mul(ux, ux), R.mul(uy, uy)))
  +ca = rcross(ux, uy, c, a)
  +cb = rcross(ux, uy, c, b)
  +ta = rdot(ux, uy, c, a)
  +tb = rdot(ux, uy, c, b)
  +ov = (F32.min(F32.max(ta, tb), l2) - F32.max(F32.min(ta, tb), 0.0) : F32)
  +lim = (e * e * l2 : F32)
  +on = Bool.and(Bool.and((ca * ca <= lim : F32), (cb * cb <= lim : F32)), Bool.and((ov > 0.0 : F32), (ov * ov > lim : F32)))
  Bool.pick(U32, on, Bool.pick(U32, against(a, b, c, d), 1, 2), 0)

def near.k(pre: Bool, +h: HE, +c: BP, +d: BP, +e: F32) -> U32:
  match pre:
    case False{}:
      0
    case True{}:
      near.real(h, c, d, e)

# F32 prefilter: the boxes of a -> b and c -> d overlap, padded by e and the
# F32 rounding (2^-20 of the largest magnitude).
def fbox(+a: BP, +b: BP, +c: BP, +d: BP, +e: F32) -> Bool:
  BP{_, _, +ax, +ay, _, _} = a
  BP{_, _, +bx, +by, _, _} = b
  BP{_, _, +cx, +cy, _, _} = c
  BP{_, _, +dx, +dy, _, _} = d
  +mag = F32.max(F32.max(E.fmax3(ax, bx, cx), E.fmax3(ay, by, cy)), F32.max(F32.abs(dx), F32.abs(dy)))
  +pad = (e + mag * 0.00000095367431640625 : F32)
  +ox = Bool.and(((F32.min(ax, bx) - pad : F32) <= F32.max(cx, dx) : F32), ((F32.min(cx, dx) - pad : F32) <= F32.max(ax, bx) : F32))
  +oy = Bool.and(((F32.min(ay, by) - pad : F32) <= F32.max(cy, dy) : F32), ((F32.min(cy, dy) - pad : F32) <= F32.max(ay, by) : F32))
  Bool.and(ox, oy)

# Ray state: the winding so far; spike: h lies on a collinear halfedge of
# the opposite direction at its midpoint; odd: the ray met a halfedge at the
# midpoint otherwise.
type RY is Data:
  RY{w: U32, spike: Bool, odd: Bool}

def ray.at(+col: Bool, +opp: Bool, r: RY) -> RY:
  RY{w, spike, odd} = r
  RY{w, Bool.or(spike, Bool.and(col, opp)), Bool.or(odd, Bool.not(Bool.and(col, opp)))}

def ray.on(on: Bool, +h: HE, +c: BP, +d: BP, r: RY) -> RY:
  match on:
    case False{}:
      r
    case True{}:
      HE{+a, +b, _} = h
      ray.at(Bool.and(U.is_zero(orient(c, d, a)), U.is_zero(orient(c, d, b))), against(a, b, c, d), r)

def ray.cross(st: Bool, +up: Bool, +h: HE, +c: BP, +d: BP, r: RY) -> RY:
  match st:
    case False{}:
      r
    case True{}:
      HE{_, _, +m} = h
      RY{+w, spike, odd} = r
      +o = orient(c, d, m)
      +hit = Bool.pick(Bool, up, U32.is_eq(o, 1), U32.is_eq(o, 4294967295))
      ray.on(U.is_zero(o), h, c, d, RY{(w + Bool.pick(U32, hit, Bool.pick(U32, up, 1, 4294967295), 0) : U32), spike, odd})

# A halfedge c -> d on the ray's line through m (perpendicular to h) that
# contains m crosses h at its midpoint.
def ray.flat(both0: Bool, +m: BP, +c: BP, +d: BP, r: RY) -> RY:
  match both0:
    case False{}:
      r
    case True{}:
      BP{+mx, +my, _, _, _, _} = m
      BP{cx, cy, _, _, _, _} = c
      BP{dx, dy, _, _, _, _} = d
      RY{w, spike, odd} = r
      RY{w, spike, Bool.or(odd, Bool.not(U32.is_eq(E.sign_of(RP.sign(RP.add(RP.mul(RP.sub(cx, mx), RP.sub(dx, mx)), RP.mul(RP.sub(cy, my), RP.sub(dy, my))))), 1)))}

def ray.near(+k: U32, r: RY) -> RY:
  RY{w, spike, odd} = r
  RY{w, Bool.or(spike, U32.is_eq(k, 1)), Bool.or(odd, U32.is_eq(k, 2))}

def ray.edge(+h: HE, +r2: BP, +e: F32, x: HE, r: RY) -> RY:
  HE{+a, +b, +m} = h
  HE{+c, +d, _} = x
  +sc = orient(m, r2, c)
  +sd = orient(m, r2, d)
  +pd = U32.is_eq(sd, 1)
  ray.near(near.k(fbox(a, b, c, d, e), HE{a, b, m}, c, d, e), ray.flat(Bool.and(U.is_zero(sc), U.is_zero(sd)), m, c, d, ray.cross(Bool.xor(U32.is_eq(sc, 1), pd), pd, HE{a, b, m}, c, d, r)))

def ray.one(self: Bool, +h: HE, +r2: BP, +e: F32, x: HE, r: RY) -> RY:
  match self:
    case True{}:
      r
    case False{}:
      ray.edge(h, r2, e, x, r)

def ray.go(xs: List<&2, HE>, +i: U32, +k: U32, +h: HE, +r2: BP, +e: F32, r: RY) -> RY:
  match xs:
    case Nil{}:
      r
    case +x <> t:
      ray.go(t, i, (k + 1 : U32), h, r2, e, ray.one(U32.is_eq(i, k), h, r2, e, x, r))

# Votes of a group: halfedges with w_left = 1 and = 0; bad: any other.
type VS is Data:
  VS{np: U32, nm: U32, bad: Bool}

def vs.add(r: RY, st: VS) -> VS:
  RY{+w, +spike, +odd} = r
  VS{np, nm, bad} = st
  +vote = Bool.not(Bool.or(spike, odd))
  +isp = Bool.and(vote, U32.is_eq(w, 1))
  +ism = Bool.and(vote, U.is_zero(w))
  VS{(np + U.b2u(isp) : U32), (nm + U.b2u(ism) : U32), Bool.or(bad, Bool.or(Bool.and(odd, Bool.not(spike)), Bool.and(vote, Bool.not(Bool.or(isp, ism)))))}

def vs.go(xs: List<&2, HE>, +all: List<&2, HE>, +i: U32, +e: F32, st: VS) -> VS:
  match xs:
    case Nil{}:
      st
    case +h <> t:
      HE{+a, +b, +m} = h
      vs.go(t, all, (i + 1 : U32), e, vs.add(ray.go(all, i, 0, HE{a, b, m}, ray_end(m, a, b), e, RY{0, False{}, False{}}), st))

# --- per-group decision ------------------------------------------------------------------

def proj.he(+pj: E.Proj, +pos: U.Table<G.Vec3>, +s: U32, +e: U32) -> HE:
  +z = G.v3(0.0, 0.0, 0.0)
  he_of(E.project(pj, s, U.tget(G.Vec3, pos, s, z)), E.project(pj, e, U.tget(G.Vec3, pos, e, z)))

def proj.hes(fs: List<&2, A.FH>, +pj: E.Proj, +pos: U.Table<G.Vec3>, acc: List<&2, HE>) -> List<&2, HE>:
  match fs:
    case Nil{}:
      U.rev(HE, acc)
    case A.FH{_, +s, +e} <> t:
      proj.hes(t, pj, pos, proj.he(pj, pos, s, e) <> acc)

# 0: the root's face (+1, or nothing left); 1: the opposite member's (-1);
# 2: not cancelled (both signs, a bad vote, or halfedges left but none votes).
def verdict(v: VS, +n: U32) -> U32:
  VS{+np, +nm, bad} = v
  +none = Bool.and(U.nonzero(n), U.is_zero((np + nm : U32)))
  Bool.pick(U32, Bool.or(Bool.or(bad, none), Bool.and(U.nonzero(np), U.nonzero(nm))), 2, Bool.pick(U32, U.nonzero(nm), 1, 0))

def decide(+run: List<&2, A.FH>, +r: U32, +cx: Ctx) -> U32:
  Ctx{+pos, _, _, _, _, _, _, _, _, +eps} = cx
  +hs = proj.hes(run, E.proj_of(fi_n(fi(r, cx))), pos, Nil{})
  verdict(vs.go(hs, hs, 0, (eps + eps : F32), VS{0, 0, False{}}), U.len(HE, hs))

# The runs of the cancelled list (sorted by face): dec[root] for every
# membrane root with a remainder (roots without one keep 0).
type DS is Type:
  DS{cur: U32, run: List<&2, A.FH>, dec: Array<U32>}

def ds.close(act: Bool, +cur: U32, +run: List<&2, A.FH>, +cx: Ctx, dec: Array<U32>) -> Array<U32>:
  match act:
    case False{}:
      dec
    case True{}:
      Array.set(U32, dec, cur, decide(run, cur, cx))

def ds.act(+cur: U32, +act: U.Table<U32>) -> Bool:
  Bool.and(U32.is_ne(cur, none()), U.nonzero(U.tget(U32, act, cur, 0)))

def ds.step(+x: A.FH, +act: U.Table<U32>, +cx: Ctx, st: DS) -> DS:
  A.FH{+f, _, _} = x
  DS{+cur, +run, dec} = st
  +same = U32.is_eq(f, cur)
  DS{f, Bool.pick(List<&2, A.FH>, same, x <> run, [x]), ds.close(Bool.and(Bool.not(same), ds.act(cur, act)), cur, run, cx, dec)}

def ds.go(xs: List<&2, A.FH>, +act: U.Table<U32>, +cx: Ctx, st: DS) -> Array<U32>:
  match xs:
    case Nil{}:
      DS{+cur, run, dec} = st
      ds.close(ds.act(cur, act), cur, run, cx, dec)
    case +x <> t:
      ds.go(t, act, cx, ds.step(x, act, cx, st))

# The cancelled list with every decided group labelled (root or its
# opposite member), the halfedges of groups that are not cancelled dropped.
def out.cs(fs: List<&2, A.FH>, +dec: U.Table<U32>, +neg: U.Table<U32>, acc: List<&2, A.FH>) -> List<&2, A.FH>:
  match fs:
    case Nil{}:
      U.rev(A.FH, acc)
    case A.FH{+f, s, e} <> t:
      +d = U.tget(U32, dec, f, 0)
      out.cs(t, dec, neg, U.cons_if(A.FH, U32.is_ne(d, 2), A.FH{Bool.pick(U32, U32.is_eq(d, 1), U.tget(U32, neg, f, f), f), s, e}, acc))

# The original halfedges of the members of groups that are not cancelled.
def out.kept(fs: List<&2, A.FH>, +m: U.Table<U32>, +dec: U.Table<U32>, acc: List<&2, A.FH>) -> List<&2, A.FH>:
  match fs:
    case Nil{}:
      acc
    case A.FH{+f, +s, +e} <> t:
      out.kept(t, m, dec, U.cons_if(A.FH, U32.is_eq(U.tget(U32, dec, U.tget(U32, m, f, f), 0), 2), A.FH{f, s, e}, acc))

def count_dec(n: Nat, +i: U32, +act: U.Table<U32>, +dec: U.Table<U32>, acc: U32) -> U32:
  match n:
    case 0n:
      acc
    case 1n+k:
      count_dec(k, (i + 1 : U32), act, dec, (acc + U.b2u(Bool.and(U.nonzero(U.tget(U32, act, i, 0)), U32.is_ne(U.tget(U32, dec, i, 0), 2))) : U32))

def fin.k(any: Bool, +groups: U32, +cs: List<&2, A.FH>, +fh: List<&2, A.FH>, +m: U.Table<U32>, +dec: U.Table<U32>, +neg: U.Table<U32>) -> Out:
  match any:
    case False{}:
      MbOk{False{}, 0, fh}
    case True{}:
      MbOk{True{}, groups, U.cat(A.FH, out.cs(cs, dec, neg, Nil{}), U.rev(A.FH, out.kept(fh, m, dec, Nil{})))}

def fin(st: NS, +cs: List<&2, A.FH>, +fh: List<&2, A.FH>, +m: U.Table<U32>, +act: U.Table<U32>, +cx: Ctx) -> Out:
  NS{bad, neg} = st
  match bad:
    case True{}:
      MbBad{"a coplanar membrane group links faces against their orientation"}
    case False{}:
      Ctx{_, _, +nf, _, _, _, _, _, _, _} = cx
      +dec = table_of(nf, ds.go(cs, act, cx, DS{none(), Nil{}, Array.new(U32, U.depth(nf), 0)}))
      +groups = count_dec(U32.to_nat(nf), 0, act, dec, 0)
      fin.k(U.nonzero(groups), groups, cs, fh, m, dec, table_of(nf, neg))

# The membrane groups (ls has a membrane link): relabel to the group root,
# cancel opposite pairs inside it, decide each group on its remainder.
def cancel_groups(+ls: List<&2, Lk>, +fh: List<&2, A.FH>, +cx: Ctx) -> Out:
  Ctx{_, _, +nf, _, _, _, _, _, _, _} = cx
  +fuel = U32.to_nat((nf + 1 : U32))
  +rt = W.cmap.fin(I.roots(I.iota(nf), I.RSt{uf.links(ls, U.array_of(~U32, nf, I.iota(nf), 0), fuel), Nil{}}, fuel), nf)
  +act = table_of(nf, mark.act(ls, rt, Array.new(U32, U.depth(nf), 0)))
  +m = U.table(U32, nf, root_map.go(U32.to_nat(nf), 0, rt, act, Nil{}))
  +cs = U.rev(A.FH, W.cancel(U.sort(~A.FH, ~W.fk_le, relabel(fh, m, Nil{})), Nil{}))
  fin(neg.go(ls, rt, cx, NS{False{}, Array.new(U32, U.depth(nf), none())}), cs, fh, m, act, cx)

def cancel.if(mem: Bool, +ls: List<&2, Lk>, +fh: List<&2, A.FH>, +cx: Ctx) -> Out:
  match mem:
    case False{}:
      MbOk{False{}, 0, fh}
    case True{}:
      cancel_groups(ls, fh, cx)

# The output halfedges with every coplanar membrane cancelled (unchanged
# without one).
def cancel(+fh: List<&2, A.FH>, +cx: Ctx) -> Out:
  +ls = links(fh, cx)
  cancel.if(any_mem(ls), ls, fh, cx)
