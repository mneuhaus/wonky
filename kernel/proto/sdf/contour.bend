import Base
import ../../real.bend as R
import ../../precise.bend as G
import ../mesh.bend as M
import ./field.bend as F
import ./octree.bend as O

# Dual contouring over the sparse octree (Ju, Losasso, Schaefer, Warren 2002,
# "Dual Contouring of Hermite Data": cellProc / faceProc / edgeProc), with the
# Manifold Dual Contouring rule that a cell contributes the vertex of the
# surface cycle containing the edge (Schaefer, Ju, Warren 2007).
#
# edge_proc(d, q0..q3): the four cells around an edge parallel to axis d,
# q[p + 2q] with (p, q) the cell's side of the edge along the two other axes
# (P, Q) in increasing order (0 = the cell lies below the edge). In cell k the
# edge is its edge 4 d + 3 - k. The deepest of the four cells owns the
# minimal edge; it gives the sign change, the orientation and the tag. A cell
# that is homogeneous ends the recursion: its closed box has no sign change.
#
# Every triangle carries the tag of the crossing on its dual edge; each of
# the (up to) four vertices lies on that crossing's carrier because each
# cell's vertex was solved onto every carrier of its cycle.

type Ax is Data:
  AX{}
  AY{}
  AZ{}

type Rope is Data:
  RNil{}
  ROne{t: M.Tri, c: F.V, n: F.V}
  RCat{a: Rope, b: Rope}

# n triangles; devc: largest distance of a triangle corner to its tagged
# carrier (the validator's check); devs: largest distance of the edge
# midpoints and centroid to it (chordal deviation, sampled); folds: triangles
# whose normal opposes the tagged face's oriented normal at their centroid;
# gaps: dual edges where a cell had no vertex for a sign-changing edge;
# vol6: six times the enclosed volume (divergence theorem about the world
# origin, each triple product in double-word precision). ROne keeps the
# centroid c and the area normal n (twice the area, outward) of its triangle
# for the FDM analyses (fdm.bend).
type Out is Data:
  Out{r: Rope, n: U32, devc: F32, devs: F32, folds: U32, gaps: U32, vol6: R.Real}

type EMode is Data:
  EStop{}
  EEmit{}
  EDown{}

type FMode is Data:
  FStop{}
  FDown{}

type EH is Data:
  EHNo{}
  EHYes{lowin: Bool, leaf: F.Leaf}

type VI is Data:
  VI{ok: Bool, idx: U32, p: O.VP}

# --- corner merging ------------------------------------------------------------
#
# A corner of three carriers is one point; every cell whose cycle sees the
# same three carriers solves to it (up to an F32 ulp). Those vertices are
# merged (see msweep for the rules, including crease points that snap onto a
# corner); a merged vertex takes its cluster head's index. Triangles
# that lose a corner that way collapse (see quad). This is vertex clustering
# restricted to exact corners (cf. the octree simplification of Manifold Dual
# Contouring); the validator checks the manifold outcome.

type CK is Data:
  CK{x: F32, y: F32, z: F32, idx: U32}

type RM is Data:
  RM{from: U32, to: U32}

# Corners merge within tol (an F32 ulp scale); crease points merge within
# tolc (a tenth of the fine cell) with crease points only, so an exact corner
# is never moved onto a crease.
# One sweep over all feature vertices, sorted by key: a corner has key
# x - tolc, so it is seen before any crease point within tolc of it. A corner
# merges only with an earlier corner within tol; a crease point snaps onto a
# live corner within tolc (it then lies on one of that corner's creases, so it
# stays on both of its carriers), else merges with a crease point within tolc,
# else becomes a head. Heads older than 2 tolc in x are dropped.
type EV is Data:
  EV{key: F32, k: CK, corner: Bool}

def out_nil() -> Out:
  Out{RNil{}, 0, 0.0, 0.0, 0, 0, R.from_f32(0.0)}

def out_gap() -> Out:
  Out{RNil{}, 0, 0.0, 0.0, 0, 1, R.from_f32(0.0)}

def cat(a: Out, b: Out) -> Out:
  Out{ra, na, ca, sa, fa, ga, va} = a
  Out{rb, nb, cb, sb, fb, gb, vb} = b
  Out{RCat{ra, rb}, (na + nb : U32), F32.max(ca, cb), F32.max(sa, sb), (fa + fb : U32), (ga + gb : U32), R.add(va, vb)}

def cat4(a: Out, b: Out, c: Out, d: Out) -> Out:
  cat(cat(a, b), cat(c, d))

# --- octree access -----------------------------------------------------------

def sel2.k(hi: Bool, a: O.Oct, b: O.Oct) -> O.Oct:
  match hi:
    case True{}:
      b
    case False{}:
      a

def sel2(+i: U32, a: O.Oct, b: O.Oct) -> O.Oct:
  sel2.k(O.has(i, 1), a, b)

def sel4.k(hi: Bool, +i: U32, a: O.Oct, b: O.Oct, c: O.Oct, d: O.Oct) -> O.Oct:
  match hi:
    case True{}:
      sel2(i, c, d)
    case False{}:
      sel2(i, a, b)

def sel8.k(hi: Bool, +i: U32, a: O.Oct, b: O.Oct, c: O.Oct, d: O.Oct, e: O.Oct, f: O.Oct, g: O.Oct, h: O.Oct) -> O.Oct:
  match hi:
    case True{}:
      sel4.k(O.has(i, 2), i, e, f, g, h)
    case False{}:
      sel4.k(O.has(i, 2), i, a, b, c, d)

# Child i of a node; a leaf stands for all of its children.
def sub(+q: O.Oct, +i: U32) -> O.Oct:
  match q:
    case O.ONode{_, c0, c1, c2, c3, c4, c5, c6, c7}:
      sel8.k(O.has(i, 4), i, c0, c1, c2, c3, c4, c5, c6, c7)
    case _:
      q

def is_hom(q: O.Oct) -> Bool:
  match q:
    case O.OHom{}:
      True{}
    case _:
      False{}

def is_node(q: O.Oct) -> Bool:
  match q:
    case O.ONode{_, _, _, _, _, _, _, _, _}:
      True{}
    case _:
      False{}

def emode.k(stop: Bool, down: Bool) -> EMode:
  match stop:
    case True{}:
      EStop{}
    case False{}:
      match down:
        case True{}:
          EDown{}
        case False{}:
          EEmit{}

def emode(+a: O.Oct, +b: O.Oct, +c: O.Oct, +d: O.Oct) -> EMode:
  emode.k(Bool.or(Bool.or(is_hom(a), is_hom(b)), Bool.or(is_hom(c), is_hom(d))), Bool.or(Bool.or(is_node(a), is_node(b)), Bool.or(is_node(c), is_node(d))))

def fmode.k(down: Bool) -> FMode:
  match down:
    case True{}:
      FDown{}
    case False{}:
      FStop{}

def fmode(+a: O.Oct, +b: O.Oct) -> FMode:
  fmode.k(Bool.and(Bool.not(Bool.or(is_hom(a), is_hom(b))), Bool.or(is_node(a), is_node(b))))

def bit_d(d: Ax) -> U32:
  match d:
    case AX{}:
      1
    case AY{}:
      2
    case AZ{}:
      4

def bit_p(d: Ax) -> U32:
  match d:
    case AX{}:
      2
    case AY{}:
      1
    case AZ{}:
      1

def bit_q(d: Ax) -> U32:
  match d:
    case AX{}:
      4
    case AY{}:
      4
    case AZ{}:
      2

def axis_n(d: Ax) -> U32:
  match d:
    case AX{}:
      0
    case AY{}:
      1
    case AZ{}:
      2

# Corner bits of edge (d, j = p + 2q): lower end a, upper end b.
def corner_a(d: Ax, +j: U32) -> U32:
  match d:
    case AX{}:
      F.pickw(U32.is_eq(j, 0), 1, F.pickw(U32.is_eq(j, 1), 4, F.pickw(U32.is_eq(j, 2), 16, 64)))
    case AY{}:
      F.pickw(U32.is_eq(j, 0), 1, F.pickw(U32.is_eq(j, 1), 2, F.pickw(U32.is_eq(j, 2), 16, 32)))
    case AZ{}:
      F.pickw(U32.is_eq(j, 0), 1, F.pickw(U32.is_eq(j, 1), 2, F.pickw(U32.is_eq(j, 2), 4, 8)))

def bit_shift(d: Ax) -> U32:
  match d:
    case AX{}:
      2
    case AY{}:
      4
    case AZ{}:
      16

def corner_b(+d: Ax, +j: U32) -> U32:
  (corner_a(d, j) * bit_shift(d) : U32)

def nth_ei.k(here: Bool, h: O.EI, r: O.EI) -> O.EI:
  match here:
    case True{}:
      h
    case False{}:
      r

def nth_ei(xs: List<&2, O.EI>, +i: U32) -> O.EI:
  match xs:
    case Nil{}:
      O.ENo{}
    case h <> t:
      nth_ei.k(U32.is_eq(i, 0), h, nth_ei(t, (i - 1 : U32)))

def nth_vp.k(here: Bool, h: O.VP, r: O.VP) -> O.VP:
  match here:
    case True{}:
      h
    case False{}:
      r

def nth_vp(xs: List<&2, O.VP>, +i: U32) -> O.VP:
  match xs:
    case Nil{}:
      O.VP{0.0, 0.0, 0.0}
    case h <> t:
      nth_vp.k(U32.is_eq(i, 0), h, nth_vp(t, (i - 1 : U32)))

# --- one minimal edge ------------------------------------------------------------

# 0 for a finest cell, else its level above the finest (bigger = coarser).
def rank(q: O.Oct) -> U32:
  match q:
    case O.OCoarse{lvl, _, _, _, _}:
      (lvl + 1 : U32)
    case _:
      0

def eh.fine(ei: O.EI, +mask: U32, +abit: U32) -> EH:
  match ei:
    case O.ENo{}:
      EHNo{}
    case O.EYes{_, l}:
      EHYes{O.has(mask, abit), l}

def eh.coarse(on: Bool, lowin: Bool, l: F.Leaf) -> EH:
  match on:
    case True{}:
      EHYes{lowin, l}
    case False{}:
      EHNo{}

# The sign change of edge (d, j) as seen by cell q.
def edge_hit(q: O.Oct, +d: Ax, +j: U32) -> EH:
  match q:
    case O.OFine{+mask, _, edges, _, _, _, _}:
      eh.fine(nth_ei(edges, (4 * axis_n(d) + j : U32)), mask, corner_a(d, j))
    case O.OCoarse{_, +mask, _, _, l}:
      +sa = O.has(mask, corner_a(d, j))
      eh.coarse(Bool.xor(sa, O.has(mask, corner_b(d, j))), sa, l)
    case _:
      EHNo{}

# Index of cycle c after corner merging (alias is empty unless the cell has a
# merged corner).
def nth_alias(xs: List<&2, U32>, +c: U32, +own: U32) -> U32:
  match xs:
    case Nil{}:
      own
    case h <> t:
      F.pickw(U32.is_eq(c, 0), h, nth_alias(t, (c - 1 : U32), own))

def vi.fine(ei: O.EI, +base: U32, +verts: List<&2, O.VP>, +alias: List<&2, U32>) -> VI:
  match ei:
    case O.ENo{}:
      VI{False{}, 0, O.VP{0.0, 0.0, 0.0}}
    case O.EYes{+c, _}:
      VI{True{}, nth_alias(alias, c, (base + c : U32)), nth_vp(verts, c)}

# The vertex cell q contributes to edge (d, j).
def vert_of(q: O.Oct, +d: Ax, +j: U32) -> VI:
  match q:
    case O.OFine{_, base, edges, verts, _, _, alias}:
      vi.fine(nth_ei(edges, (4 * axis_n(d) + j : U32)), base, verts, alias)
    case O.OCoarse{_, _, base, p, _}:
      VI{True{}, base, p}
    case _:
      VI{False{}, 0, O.VP{0.0, 0.0, 0.0}}

def vp_v(p: O.VP) -> F.V:
  O.VP{x, y, z} = p
  F.V{x, y, z}

def mid(a: O.VP, b: O.VP) -> F.V:
  O.VP{ax, ay, az} = a
  O.VP{bx, by, bz} = b
  F.V{((ax + bx) * 0.5 : F32), ((ay + by) * 0.5 : F32), ((az + bz) * 0.5 : F32)}

def cen(a: O.VP, b: O.VP, c: O.VP) -> F.V:
  O.VP{ax, ay, az} = a
  O.VP{bx, by, bz} = b
  O.VP{cx, cy, cz} = c
  F.V{((ax + bx + cx) / 3.0 : F32), ((ay + by + cy) / 3.0 : F32), ((az + bz + cz) / 3.0 : F32)}

def gabs(+f: F.Fn, p: F.V) -> F32:
  F.V{x, y, z} = p
  F.absf(F.fn_eval(f, x, y, z))

def sub3(a: O.VP, b: O.VP) -> F.V:
  O.VP{ax, ay, az} = a
  O.VP{bx, by, bz} = b
  F.V{(ax - bx : F32), (ay - by : F32), (az - bz : F32)}

# A triangle is suspicious (counted in folds) when two corners coincide, or
# when it is not a sliver (twice its area above 2 % of its longest edge
# squared) and its normal points more than ~100 degrees away from the tagged
# face's oriented normal. Slivers whose corners all sit on one crease have no
# meaningful normal and are exempt; the validator judges them.
def fold_at(+l: F.Leaf, +nrm: F.V, c: F.V, +e2: F32) -> Bool:
  F.V{+nx, +ny, +nz} = nrm
  F.V{x, y, z} = c
  +len = F.len3(nx, ny, nz)
  +d = O.dot(F.V{nx, ny, nz}, O.leaf_normal(l, x, y, z))
  Bool.or(Bool.not((0.0 < len : F32)), Bool.and((0.02 * e2 < len : F32), (d < (0.0 - 0.2) * len : F32)))

# a . (b x c) with double-word products (exact for F32 inputs up to rounding
# of the final sums).
def rr(+x: F32) -> R.Real:
  R.from_f32(x)

def triple(a: O.VP, b: O.VP, c: O.VP) -> R.Real:
  O.VP{ax, ay, az} = a
  O.VP{+bx, +by, +bz} = b
  O.VP{+cx, +cy, +cz} = c
  +x = R.sub(R.mul(rr(by), rr(cz)), R.mul(rr(bz), rr(cy)))
  +y = R.sub(R.mul(rr(bz), rr(cx)), R.mul(rr(bx), rr(cz)))
  +z = R.sub(R.mul(rr(bx), rr(cy)), R.mul(rr(by), rr(cx)))
  R.add(R.add(R.mul(rr(ax), x), R.mul(rr(ay), y)), R.mul(rr(az), z))

def dist2(a: O.VP, b: O.VP) -> F32:
  O.VP{ax, ay, az} = a
  O.VP{bx, by, bz} = b
  +dx = (ax - bx : F32)
  +dy = (ay - by : F32)
  +dz = (az - bz : F32)
  (dx * dx + dy * dy + dz * dz : F32)

def tri(+ia: U32, +pa: O.VP, +ib: U32, +pb: O.VP, +ic: U32, +pc: O.VP, +l: F.Leaf) -> Out:
  F.Leaf{tag, _, _, +f} = l
  +devc = F32.max(gabs(f, vp_v(pa)), F32.max(gabs(f, vp_v(pb)), gabs(f, vp_v(pc))))
  +devs = F32.max(F32.max(gabs(f, mid(pa, pb)), gabs(f, mid(pb, pc))), F32.max(gabs(f, mid(pc, pa)), gabs(f, cen(pa, pb, pc))))
  +nrm = O.cross3(sub3(pb, pa), sub3(pc, pa))
  +e2 = F32.max(dist2(pa, pb), F32.max(dist2(pb, pc), dist2(pc, pa)))
  Out{ROne{M.Tri{ia, ib, ic, tag}, cen(pa, pb, pc), nrm}, 1, devc, devs, F.pickw(fold_at(l, nrm, cen(pa, pb, pc), e2), 1, 0), 0, triple(pa, pb, pc)}

# Cosine between a triangle's normal and the tagged face's oriented normal at
# its centroid (1 = aligned); picks the quad diagonal that avoids slivers
# lying along a crease.
def quality.k(nrm: F.V, +l: F.Leaf, c: F.V) -> F32:
  F.V{+nx, +ny, +nz} = nrm
  F.V{x, y, z} = c
  +len = F.len3(nx, ny, nz)
  +d = O.dot(F.V{nx, ny, nz}, O.leaf_normal(l, x, y, z))
  F.pick((0.0 < len : F32), (d / len : F32), (0.0 - 1.0 : F32))

def quality(+a: O.VP, +b: O.VP, +c: O.VP, +l: F.Leaf) -> F32:
  quality.k(O.cross3(sub3(b, a), sub3(c, a)), l, cen(a, b, c))

def quad.split(ac: Bool, +ia: U32, +pa: O.VP, +ib: U32, +pb: O.VP, +ic: U32, +pc: O.VP, +id: U32, +pd: O.VP, +l: F.Leaf) -> Out:
  match ac:
    case True{}:
      cat(tri(ia, pa, ib, pb, ic, pc, l), tri(ia, pa, ic, pc, id, pd, l))
    case False{}:
      cat(tri(ia, pa, ib, pb, id, pd, l), tri(ib, pb, ic, pc, id, pd, l))

def quad.k(ab: Bool, bc: Bool, cd: Bool, da: Bool, +ia: U32, +pa: O.VP, +ib: U32, +pb: O.VP, +ic: U32, +pc: O.VP, +id: U32, +pd: O.VP, +l: F.Leaf) -> Out:
  match ab:
    case True{}:
      tri(ia, pa, ic, pc, id, pd, l)
    case False{}:
      match bc:
        case True{}:
          tri(ia, pa, ib, pb, id, pd, l)
        case False{}:
          match cd:
            case True{}:
              tri(ia, pa, ib, pb, ic, pc, l)
            case False{}:
              match da:
                case True{}:
                  tri(ia, pa, ib, pb, ic, pc, l)
                case False{}:
                  quad.split(Bool.not((F32.min(quality(pa, pb, pc, l), quality(pa, pc, pd, l)) < F32.min(quality(pa, pb, pd, l), quality(pb, pc, pd, l)) : F32)), ia, pa, ib, pb, ic, pc, id, pd, l)

# Diagonal corners merged, or two opposite sides collapsed: nothing is left.
def quad.d(diag: Bool, two: Bool, +ia: U32, +pa: O.VP, +ib: U32, +pb: O.VP, +ic: U32, +pc: O.VP, +id: U32, +pd: O.VP, +l: F.Leaf) -> Out:
  match diag:
    case True{}:
      out_nil()
    case False{}:
      match two:
        case True{}:
          out_nil()
        case False{}:
          quad.k(U32.is_eq(ia, ib), U32.is_eq(ib, ic), U32.is_eq(ic, id), U32.is_eq(id, ia), ia, pa, ib, pb, ic, pc, id, pd, l)

# Counter-clockwise quad a b c d (seen from outside); a coarse cell occupying
# two consecutive places makes it a triangle.
def quad(+ia: U32, +pa: O.VP, +ib: U32, +pb: O.VP, +ic: U32, +pc: O.VP, +id: U32, +pd: O.VP, +l: F.Leaf) -> Out:
  quad.d(Bool.or(U32.is_eq(ia, ic), U32.is_eq(ib, id)), Bool.or(Bool.and(U32.is_eq(ia, ib), U32.is_eq(ic, id)), Bool.and(U32.is_eq(ib, ic), U32.is_eq(id, ia))), ia, pa, ib, pb, ic, pc, id, pd, l)

def emit.q(ok: Bool, ccw: Bool, +i0: U32, +p0: O.VP, +i1: U32, +p1: O.VP, +i2: U32, +p2: O.VP, +i3: U32, +p3: O.VP, +l: F.Leaf) -> Out:
  match ok:
    case False{}:
      out_gap()
    case True{}:
      match ccw:
        case True{}:
          quad(i0, p0, i1, p1, i3, p3, i2, p2, l)
        case False{}:
          quad(i2, p2, i3, p3, i1, p1, i0, p0, l)

def emit.o(ccw: Bool, v0: VI, v1: VI, v2: VI, v3: VI, +l: F.Leaf) -> Out:
  VI{ok0, +i0, +p0} = v0
  VI{ok1, +i1, +p1} = v1
  VI{ok2, +i2, +p2} = v2
  VI{ok3, +i3, +p3} = v3
  emit.q(Bool.and(Bool.and(ok0, ok1), Bool.and(ok2, ok3)), ccw, i0, p0, i1, p1, i2, p2, i3, p3, l)

def is_y(d: Ax) -> Bool:
  match d:
    case AY{}:
      True{}
    case _:
      False{}

def emit.h(eh: EH, +d: Ax, v0: VI, v1: VI, v2: VI, v3: VI) -> Out:
  match eh:
    case EHNo{}:
      out_nil()
    case EHYes{lowin, l}:
      # q0 q1 q3 q2 is counter-clockwise seen from +d when (P, Q, d) is
      # right-handed (x and z); for y it is clockwise.
      emit.o(Bool.xor(lowin, is_y(d)), v0, v1, v2, v3, l)

def owner.k(+r0: U32, +r1: U32, +r2: U32, +r3: U32) -> U32:
  +m01 = U32.min(r0, r1)
  +m23 = U32.min(r2, r3)
  +m = U32.min(m01, m23)
  F.pickw(U32.is_eq(r0, m), 0, F.pickw(U32.is_eq(r1, m), 1, F.pickw(U32.is_eq(r2, m), 2, 3)))

def owner_hit.k(k0: Bool, k1: Bool, k2: Bool, +d: Ax, +q0: O.Oct, +q1: O.Oct, +q2: O.Oct, +q3: O.Oct) -> EH:
  match k0:
    case True{}:
      edge_hit(q0, d, 3)
    case False{}:
      match k1:
        case True{}:
          edge_hit(q1, d, 2)
        case False{}:
          match k2:
            case True{}:
              edge_hit(q2, d, 1)
            case False{}:
              edge_hit(q3, d, 0)

def owner_hit(+k: U32, +d: Ax, +q0: O.Oct, +q1: O.Oct, +q2: O.Oct, +q3: O.Oct) -> EH:
  owner_hit.k(U32.is_eq(k, 0), U32.is_eq(k, 1), U32.is_eq(k, 2), d, q0, q1, q2, q3)

def process_edge(+d: Ax, +q0: O.Oct, +q1: O.Oct, +q2: O.Oct, +q3: O.Oct) -> Out:
  +k = owner.k(rank(q0), rank(q1), rank(q2), rank(q3))
  emit.h(owner_hit(k, d, q0, q1, q2, q3), d, vert_of(q0, d, 3), vert_of(q1, d, 2), vert_of(q2, d, 1), vert_of(q3, d, 0))

# --- the recursion -------------------------------------------------------------------

def edge_proc(+fuel: Nat, mode: EMode, +d: Ax, +q0: O.Oct, +q1: O.Oct, +q2: O.Oct, +q3: O.Oct) -> Out:
  match fuel:
    case 0n:
      out_nil()
    case 1n+f:
      match mode:
        case EStop{}:
          out_nil()
        case EEmit{}:
          process_edge(d, q0, q1, q2, q3)
        case EDown{}:
          +bp = bit_p(d)
          +bq = bit_q(d)
          +bd = bit_d(d)
          +s0 = sub(q0, (bp + bq : U32))
          +s1 = sub(q1, bq)
          +s2 = sub(q2, bp)
          +s3 = sub(q3, 0)
          +t0 = sub(q0, (bp + bq + bd : U32))
          +t1 = sub(q1, (bq + bd : U32))
          +t2 = sub(q2, (bp + bd : U32))
          +t3 = sub(q3, bd)
          a b = edge_proc(f, emode(s0, s1, s2, s3), d, s0, s1, s2, s3) edge_proc(f, emode(t0, t1, t2, t3), d, t0, t1, t2, t3)
          cat(a, b)

def ep(+fuel: Nat, +d: Ax, +q0: O.Oct, +q1: O.Oct, +q2: O.Oct, +q3: O.Oct) -> Out:
  edge_proc(fuel, emode(q0, q1, q2, q3), d, q0, q1, q2, q3)

# a below b along d.
def face_proc(+fuel: Nat, mode: FMode, +d: Ax, +a: O.Oct, +b: O.Oct) -> Out:
  match fuel:
    case 0n:
      out_nil()
    case 1n+f:
      match mode:
        case FStop{}:
          out_nil()
        case FDown{}:
          match d:
            case AX{}:
              +a1 = sub(a, 1)
              +a3 = sub(a, 3)
              +a5 = sub(a, 5)
              +a7 = sub(a, 7)
              +b0 = sub(b, 0)
              +b2 = sub(b, 2)
              +b4 = sub(b, 4)
              +b6 = sub(b, 6)
              f0 f1 f2 f3 e0 e1 e2 e3 = face_proc(f, fmode(a1, b0), AX{}, a1, b0) face_proc(f, fmode(a3, b2), AX{}, a3, b2) face_proc(f, fmode(a5, b4), AX{}, a5, b4) face_proc(f, fmode(a7, b6), AX{}, a7, b6) ep(f, AY{}, a1, b0, a5, b4) ep(f, AY{}, a3, b2, a7, b6) ep(f, AZ{}, a1, b0, a3, b2) ep(f, AZ{}, a5, b4, a7, b6)
              cat(cat4(f0, f1, f2, f3), cat4(e0, e1, e2, e3))
            case AY{}:
              +a2 = sub(a, 2)
              +a3 = sub(a, 3)
              +a6 = sub(a, 6)
              +a7 = sub(a, 7)
              +b0 = sub(b, 0)
              +b1 = sub(b, 1)
              +b4 = sub(b, 4)
              +b5 = sub(b, 5)
              f0 f1 f2 f3 e0 e1 e2 e3 = face_proc(f, fmode(a2, b0), AY{}, a2, b0) face_proc(f, fmode(a3, b1), AY{}, a3, b1) face_proc(f, fmode(a6, b4), AY{}, a6, b4) face_proc(f, fmode(a7, b5), AY{}, a7, b5) ep(f, AX{}, a2, b0, a6, b4) ep(f, AX{}, a3, b1, a7, b5) ep(f, AZ{}, a2, a3, b0, b1) ep(f, AZ{}, a6, a7, b4, b5)
              cat(cat4(f0, f1, f2, f3), cat4(e0, e1, e2, e3))
            case AZ{}:
              +a4 = sub(a, 4)
              +a5 = sub(a, 5)
              +a6 = sub(a, 6)
              +a7 = sub(a, 7)
              +b0 = sub(b, 0)
              +b1 = sub(b, 1)
              +b2 = sub(b, 2)
              +b3 = sub(b, 3)
              f0 f1 f2 f3 e0 e1 e2 e3 = face_proc(f, fmode(a4, b0), AZ{}, a4, b0) face_proc(f, fmode(a5, b1), AZ{}, a5, b1) face_proc(f, fmode(a6, b2), AZ{}, a6, b2) face_proc(f, fmode(a7, b3), AZ{}, a7, b3) ep(f, AX{}, a4, a6, b0, b2) ep(f, AX{}, a5, a7, b1, b3) ep(f, AY{}, a4, a5, b0, b1) ep(f, AY{}, a6, a7, b2, b3)
              cat(cat4(f0, f1, f2, f3), cat4(e0, e1, e2, e3))

def fp(+fuel: Nat, +d: Ax, +a: O.Oct, +b: O.Oct) -> Out:
  face_proc(fuel, fmode(a, b), d, a, b)

def cell_proc(+fuel: Nat, +n: O.Oct) -> Out:
  match fuel:
    case 0n:
      out_nil()
    case 1n+f:
      match n:
        case O.ONode{_, c0, c1, c2, c3, c4, c5, c6, c7}:
          k0 k1 k2 k3 k4 k5 k6 k7 = cell_proc(f, c0) cell_proc(f, c1) cell_proc(f, c2) cell_proc(f, c3) cell_proc(f, c4) cell_proc(f, c5) cell_proc(f, c6) cell_proc(f, c7)
          +fx = cat4(fp(f, AX{}, c0, c1), fp(f, AX{}, c2, c3), fp(f, AX{}, c4, c5), fp(f, AX{}, c6, c7))
          +fy = cat4(fp(f, AY{}, c0, c2), fp(f, AY{}, c1, c3), fp(f, AY{}, c4, c6), fp(f, AY{}, c5, c7))
          +fz = cat4(fp(f, AZ{}, c0, c4), fp(f, AZ{}, c1, c5), fp(f, AZ{}, c2, c6), fp(f, AZ{}, c3, c7))
          +ex = cat(ep(f, AX{}, c0, c2, c4, c6), ep(f, AX{}, c1, c3, c5, c7))
          +ey = cat(ep(f, AY{}, c0, c1, c4, c5), ep(f, AY{}, c2, c3, c6, c7))
          +ez = cat(ep(f, AZ{}, c0, c1, c2, c3), ep(f, AZ{}, c4, c5, c6, c7))
          cat(cat(cat4(k0, k1, k2, k3), cat4(k4, k5, k6, k7)), cat(cat(fx, cat(fy, fz)), cat(ex, cat(ey, ez))))
        case _:
          out_nil()

# --- vertex numbering and output lists ------------------------------------------

def number(o: O.Oct, +base: U32) -> O.Oct:
  match o:
    case O.OHom{}:
      O.OHom{}
    case O.OCoarse{lvl, m, _, p, l}:
      O.OCoarse{lvl, m, base, p, l}
    case O.OFine{m, _, es, vs, st, cm, al}:
      O.OFine{m, base, es, vs, st, cm, al}
    case O.ONode{st, +c0, +c1, +c2, +c3, +c4, +c5, +c6, +c7}:
      +b1 = (base + O.st_verts(O.st_of(c0)) : U32)
      +b2 = (b1 + O.st_verts(O.st_of(c1)) : U32)
      +b3 = (b2 + O.st_verts(O.st_of(c2)) : U32)
      +b4 = (b3 + O.st_verts(O.st_of(c3)) : U32)
      +b5 = (b4 + O.st_verts(O.st_of(c4)) : U32)
      +b6 = (b5 + O.st_verts(O.st_of(c5)) : U32)
      +b7 = (b6 + O.st_verts(O.st_of(c6)) : U32)
      n0 n1 n2 n3 n4 n5 n6 n7 = number(c0, base) number(c1, b1) number(c2, b2) number(c3, b3) number(c4, b4) number(c5, b5) number(c6, b6) number(c7, b7)
      O.ONode{st, n0, n1, n2, n3, n4, n5, n6, n7}

def corners_of.add(yes: Bool, k: CK, acc: List<&2, CK>) -> List<&2, CK>:
  match yes:
    case True{}:
      k <> acc
    case False{}:
      acc

def corners_of(vs: List<&2, O.VP>, +cm: U32, +bit: U32, +c: U32, +base: U32, acc: List<&2, CK>) -> List<&2, CK>:
  match vs:
    case Nil{}:
      acc
    case O.VP{x, y, z} <> t:
      corners_of(t, cm, (bit * 2 : U32), (c + 1 : U32), base, corners_of.add(O.has(cm, bit), CK{x, y, z, (base + c : U32)}, acc))

def app(a: List<&2, CK>, b: List<&2, CK>) -> List<&2, CK>:
  List.append(&2, CK, a, b)

# Feature vertices of one kind: sh = 0 corners, sh = 8 crease points (an
# 8-way fork per node; the lists are short, so appending is cheap).
def corners(o: O.Oct, +sh: Nat) -> List<&2, CK>:
  match o:
    case O.OFine{_, base, _, vs, _, cm, _}:
      corners_of(vs, U32.and(U32.shrn(cm, sh), 15), 1, 0, base, Nil{})
    case O.ONode{_, c0, c1, c2, c3, c4, c5, c6, c7}:
      a b c d e f g h = corners(c0, sh) corners(c1, sh) corners(c2, sh) corners(c3, sh) corners(c4, sh) corners(c5, sh) corners(c6, sh) corners(c7, sh)
      app(app(app(a, b), app(c, d)), app(app(e, f), app(g, h)))
    case _:
      Nil{}

def near_ck(a: CK, b: CK, +tol: F32) -> Bool:
  CK{ax, ay, az, _} = a
  CK{bx, by, bz, _} = b
  Bool.and((F.absf((ax - bx : F32)) < tol : F32), Bool.and((F.absf((ay - by : F32)) < tol : F32), (F.absf((az - bz : F32)) < tol : F32)))

def ck_idx(k: CK) -> U32:
  CK{_, _, _, i} = k
  i

def ck_x(k: CK) -> F32:
  CK{x, _, _, _} = k
  x

def sweep.acc(own: Bool, r: RM, acc: List<&2, RM>) -> List<&2, RM>:
  match own:
    case True{}:
      acc
    case False{}:
      r <> acc

def remap_of(rs: List<&2, RM>, +i: U32) -> U32:
  match rs:
    case Nil{}:
      i
    case RM{f, t} <> rest:
      F.pickw(U32.is_eq(f, i), t, remap_of(rest, i))

def alias_of(n: Nat, +rs: List<&2, RM>, +base: U32, +c: U32) -> List<&2, U32>:
  match n:
    case 0n:
      Nil{}
    case 1n+k:
      remap_of(rs, (base + c : U32)) <> alias_of(k, rs, base, (c + 1 : U32))

def vcount(vs: List<&2, O.VP>) -> U32:
  match vs:
    case Nil{}:
      0
    case _ <> t:
      (1 + vcount(t) : U32)

def alias.k(any: Bool, +rs: List<&2, RM>, +base: U32, +n: U32) -> List<&2, U32>:
  match any:
    case False{}:
      Nil{}
    case True{}:
      alias_of(U32.to_nat(n), rs, base, 0)

def annotate(o: O.Oct, +rs: List<&2, RM>) -> O.Oct:
  match o:
    case O.OFine{m, +base, es, +vs, st, +cm, _}:
      O.OFine{m, base, es, vs, st, cm, alias.k(Bool.not(U32.is_eq(cm, 0)), rs, base, vcount(vs))}
    case O.ONode{st, c0, c1, c2, c3, c4, c5, c6, c7}:
      O.ONode{st, annotate(c0, rs), annotate(c1, rs), annotate(c2, rs), annotate(c3, rs), annotate(c4, rs), annotate(c5, rs), annotate(c6, rs), annotate(c7, rs)}
    case _:
      o

def rm_count(rs: List<&2, RM>) -> U32:
  match rs:
    case Nil{}:
      0
    case _ <> t:
      (1 + rm_count(t) : U32)

def merge_corners.k(none: Bool, +o: O.Oct, +rs: List<&2, RM>) -> O.Oct & U32:
  match none:
    case True{}:
      (o, 0)
    case False{}:
      (annotate(o, rs), rm_count(rs))

def ev_le(a: EV, b: EV) -> Bool:
  EV{ka, _, _} = a
  EV{kb, _, _} = b
  Bool.not((kb < ka : F32))

def evs(ks: List<&2, CK>, +corner: Bool, +d: F32, acc: List<&2, EV>) -> List<&2, EV>:
  match ks:
    case Nil{}:
      acc
    case +k <> t:
      evs(t, corner, d, EV{(ck_x(k) - d : F32), k, corner} <> acc)

def ev_k(e: EV) -> CK:
  EV{_, k, _} = e
  k

def ev_corner(e: EV) -> Bool:
  EV{_, _, c} = e
  c

# Index of the first head of the wanted kind within tol of k, or none (k's own).
def head_kind(hs: List<&2, EV>, +k: CK, +tol: F32, +corner: Bool) -> U32:
  match hs:
    case Nil{}:
      ck_idx(k)
    case +h <> t:
      F.pickw(Bool.and(Bool.not(Bool.xor(ev_corner(h), corner)), near_ck(ev_k(h), k, tol)), ck_idx(ev_k(h)), head_kind(t, k, tol, corner))

def live_ev.k(keep: Bool, h: EV, t: List<&2, EV>) -> List<&2, EV>:
  match keep:
    case True{}:
      h <> t
    case False{}:
      t

def live_ev(hs: List<&2, EV>, +x: F32, +w: F32) -> List<&2, EV>:
  match hs:
    case Nil{}:
      Nil{}
    case +h <> t:
      live_ev.k(Bool.not(((ck_x(ev_k(h)) + w : F32) < x : F32)), h, live_ev(t, x, w))

def target(+corner: Bool, +hs: List<&2, EV>, +k: CK, +tol: F32, +tolc: F32) -> U32:
  +own = ck_idx(k)
  +toc = head_kind(hs, k, F.pick(corner, tol, tolc), True{})
  F.pickw(Bool.or(corner, Bool.not(U32.is_eq(toc, own))), toc, head_kind(hs, k, tolc, False{}))

def msweep.heads(own: Bool, e: EV, hs: List<&2, EV>) -> List<&2, EV>:
  match own:
    case True{}:
      e <> hs
    case False{}:
      hs

def msweep(es: List<&2, EV>, heads: List<&2, EV>, +tol: F32, +tolc: F32, acc: List<&2, RM>) -> List<&2, RM>:
  match es:
    case Nil{}:
      acc
    case +e <> t:
      +k = ev_k(e)
      +hs = live_ev(heads, ck_x(k), (2.0 * tolc : F32))
      +to = target(ev_corner(e), hs, k, tol, tolc)
      +own = U32.is_eq(to, ck_idx(k))
      msweep(t, msweep.heads(own, e, hs), tol, tolc, sweep.acc(own, RM{ck_idx(k), to}, acc))

def merge_corners(+o: O.Oct, +tol: F32, +tolc: F32) -> O.Oct & U32:
  +rs = msweep(List.sort(~EV, ~ev_le, evs(corners(o, 0n), True{}, tolc, evs(corners(o, 8n), False{}, 0.0, Nil{}))), Nil{}, tol, tolc, Nil{})
  merge_corners.k(U32.is_eq(rm_count(rs), 0), o, rs)

def vp_g(p: O.VP) -> G.Vec3:
  O.VP{x, y, z} = p
  G.V3{R.from_f32(x), R.from_f32(y), R.from_f32(z)}

def verts_onto(vs: List<&2, O.VP>, acc: List<&2, G.Vec3>) -> List<&2, G.Vec3>:
  match vs:
    case Nil{}:
      acc
    case p <> t:
      vp_g(p) <> verts_onto(t, acc)

# Vertices in index order, prepended to acc.
def collect(o: O.Oct, acc: List<&2, G.Vec3>) -> List<&2, G.Vec3>:
  match o:
    case O.OHom{}:
      acc
    case O.OCoarse{_, _, _, p, _}:
      vp_g(p) <> acc
    case O.OFine{_, _, _, vs, _, _, _}:
      verts_onto(vs, acc)
    case O.ONode{_, c0, c1, c2, c3, c4, c5, c6, c7}:
      collect(c0, collect(c1, collect(c2, collect(c3, collect(c4, collect(c5, collect(c6, collect(c7, acc))))))))

def flatten(r: Rope, acc: List<&2, M.Tri>) -> List<&2, M.Tri>:
  match r:
    case RNil{}:
      acc
    case ROne{t, _, _}:
      t <> acc
    case RCat{a, b}:
      flatten(a, flatten(b, acc))
