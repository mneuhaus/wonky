import Base
import ./field.bend as F

# Sparse octree of the "sdf" prototype: interval/tape pruning down to a fixed
# fine level, with Manifold-Dual-Contouring cells (one vertex per surface
# component of a cell, Schaefer/Ju/Warren 2007) whose vertex lies on EVERY
# analytic face crossing that component (feature-exact, so the triangle tags
# of dual contouring are right by construction).
#
# Cell kinds:
#   OHom     the tape's interval excludes 0 over the closed cell, or the cell
#            has no sign change at its corners: no vertex, and no sign change
#            on any edge of its boundary.
#   OCoarse  the pruned tape is ONE plane: the surface in the closed cell is
#            exactly that plane. One vertex: the projection of the cell centre
#            (kept only if it lies in the cell). Any size.
#   OFine    finest level. Corner signs, one crossing per sign-changing edge
#            (regula falsi + Illinois on the pruned tape), the active leaf of
#            the min/max tree at the crossing (its tag), face-pairings that
#            split the MC polygon into cycles (checkerboard faces: the inside
#            corners are kept apart, a rule both neighbours evaluate alike),
#            and per cycle a Newton solve onto all its distinct carriers.
#   ONode    8 children; st sums the subtree.
#
# Corner c = x + 2y + 4z (bits); edge e = 4 * axis + p + 2 q with (p, q) the
# cell position along the two other axes in increasing order:
#   e0 (0,1) e1 (2,3) e2 (4,5) e3 (6,7)    along x
#   e4 (0,2) e5 (1,3) e6 (4,6) e7 (5,7)    along y
#   e8 (0,4) e9 (1,5) e10 (2,6) e11 (3,7)  along z
#
# Bend 2.0.25 has no mutual recursion and matches only on parameters, so the
# build carries each child's classification (computed by the non-recursive
# `classify`) as an argument and spends two fuel units per level.

type Grid is Data:
  Grid{ox: F32, oy: F32, oz: F32, h: F32, eps: F32, margin: F32, tol: F32}

type X is Data:
  XNo{}
  XYes{x: F32, y: F32, z: F32, leaf: F.Leaf}

type EI is Data:
  ENo{}
  EYes{comp: U32, leaf: F.Leaf}

type VP is Data:
  VP{x: F32, y: F32, z: F32}

# verts: vertices; fails: components whose vertex could not be placed on all
# of its carriers inside the (margin-expanded) cell, or with more than three
# carriers; contacts: components where two carriers meet with opposite
# oriented normals (a zero-thickness wall or gap: non-manifold contact).
type St is Data:
  St{verts: U32, fails: U32, contacts: U32, fine: U32, coarse: U32, why: U32, first: VP, fcode: U32, approx: U32}

type Oct is Data:
  OHom{}
  OCoarse{depth: U32, mask: U32, base: U32, v: VP, leaf: F.Leaf}
  OFine{mask: U32, base: U32, edges: List<&2, EI>, verts: List<&2, VP>, st: St, cmask: U32, alias: List<&2, U32>}
  ONode{st: St, c0: Oct, c1: Oct, c2: Oct, c3: Oct, c4: Oct, c5: Oct, c6: Oct, c7: Oct}

type Acc is Data:
  Acc{sx: F32, sy: F32, sz: F32, n: F32, s: List<&2, F.Leaf>}

type Sol is Data:
  Sol{v: F.V, ok: Bool}

# why: reason bits of a failed vertex: 1 more than three carriers, 2 residual
# above tol, 4 outside the margin-expanded cell, 8 CSG field not ~0 there.
type VR is Data:
  VR{v: VP, ok: Bool, contact: Bool, why: U32, ns: U32}

type Box is Data:
  Box{x0: F32, y0: F32, z0: F32, x1: F32, y1: F32, z1: F32}

# --- classification and build ---------------------------------------------------

type Cls is Data:
  CRaw{lvl: U32, i: U32, j: U32, k: U32, s: F32, t: F.Tape}
  CSplit{lvl: U32, i: U32, j: U32, k: U32, s: F32, t: F.Tape}
  CDone{o: Oct}

# Carrier discovery: a vertex solved on the cycle's crossing carriers can land
# where another face of the CSG is the boundary (the cycle's edges never
# crossed it: a corner of three faces seen through two). The leaf attaining the
# field there is added to the carriers and the vertex is solved again (two
# rounds at most). Only a field failure (reason bit 8) triggers it.
type VS is Data:
  VS{vr: VR, s: List<&2, F.Leaf>}

# --- near-singular fallback -----------------------------------------------------
#
# Where three carriers meet in a double root (a face that pinches to zero
# width, e.g. a chamfer cone whose top circle is tangent to a hex side) the
# three carriers have no common point near the cycle and the three-carrier
# solve does not converge. Then seven candidates are tried from the mass point:
# each pair of the three, and the incentre and excentres of the small triangle
# the three carriers cut off across the pinch (`newton_eq`).
# The best candidate inside the margin box is kept if its distance to all
# three carriers and the CSG field magnitude stay below 50 tol (half the case
# deviation; tol is 1 % of it). A two-carrier cycle whose only failure is its
# residual is accepted under the same bound. Such vertices are counted as
# approximate (reason bit 16 on an accepted vertex) and reported; the verdict
# in main.bend still requires every triangle corner within the deviation of
# its tagged carrier.

type Cand is Data:
  Cand{v: VP, score: F32, inbox: Bool}

def pick_vp(c: Bool, a: VP, b: VP) -> VP:
  match c:
    case True{}:
      a
    case False{}:
      b

def M_count(s: List<&2, F.Leaf>) -> U32:
  match s:
    case Nil{}:
      0
    case _ <> t:
      (1 + M_count(t) : U32)

def st_zero() -> St:
  St{0, 0, 0, 0, 0, 0, VP{0.0, 0.0, 0.0}, 0, 0}

def st_add(a: St, b: St) -> St:
  St{av, af, ac, afi, aco, aw, ap, +acode, aa} = a
  St{bv, bf, bc, bfi, bco, bw, bp, +bcode, ba} = b
  +first = U32.is_eq(acode, 0)
  St{(av + bv : U32), (af + bf : U32), (ac + bc : U32), (afi + bfi : U32), (aco + bco : U32), U32.or(aw, bw), pick_vp(first, bp, ap), F.pickw(first, bcode, acode), (aa + ba : U32)}

def st_of(o: Oct) -> St:
  match o:
    case OHom{}:
      st_zero()
    case OCoarse{_, _, _, _, _}:
      St{1, 0, 0, 0, 1, 0, VP{0.0, 0.0, 0.0}, 0, 0}
    case OFine{_, _, _, _, st, _, _}:
      st
    case ONode{st, _, _, _, _, _, _, _, _}:
      st

def st_verts(s: St) -> U32:
  St{v, _, _, _, _, _, _, _, _} = s
  v

def has(+mask: U32, +b: U32) -> Bool:
  Bool.not(U32.is_eq(U32.and(mask, b), 0))

def vx(v: F.V) -> F32:
  F.V{x, _, _} = v
  x

def vy(v: F.V) -> F32:
  F.V{_, y, _} = v
  y

def vz(v: F.V) -> F32:
  F.V{_, _, z} = v
  z

def dot(a: F.V, b: F.V) -> F32:
  F.V{ax, ay, az} = a
  F.V{bx, by, bz} = b
  (ax * bx + ay * by + az * bz : F32)

def cross3(a: F.V, b: F.V) -> F.V:
  F.V{+ax, +ay, +az} = a
  F.V{+bx, +by, +bz} = b
  F.V{(ay * bz - az * by : F32), (az * bx - ax * bz : F32), (ax * by - ay * bx : F32)}

def leaf_fn(l: F.Leaf) -> F.Fn:
  F.Leaf{_, _, _, f} = l
  f

def leaf_normal.k(+neg: Bool, n: F.V) -> F.V:
  F.V{+nx, +ny, +nz} = n
  F.V{F.fneg(neg, nx), F.fneg(neg, ny), F.fneg(neg, nz)}

# Oriented (result) normal of a leaf at p.
def leaf_normal(l: F.Leaf, +x: F32, +y: F32, +z: F32) -> F.V:
  F.Leaf{_, _, +neg, f} = l
  leaf_normal.k(neg, F.fn_grad(f, x, y, z))

# --- crossings ----------------------------------------------------------------

# Regula falsi with the Illinois modification on t in [0, 1] along a + t d;
# fa and fb have opposite signs (inside = negative).
def root.go(n: Nat, +tp: F.Tape, +ax: F32, +ay: F32, +az: F32, +dx: F32, +dy: F32, +dz: F32, +ta: F32, +fa: F32, +tb: F32, +fb: F32, +side: U32) -> F32:
  match n:
    case 0n:
      (ta - fa * (tb - ta) / (fb - fa) : F32)
    case 1n+m:
      +t = (ta - fa * (tb - ta) / (fb - fa) : F32)
      +ft = F.eval(tp, (ax + t * dx : F32), (ay + t * dy : F32), (az + t * dz : F32))
      +sa = Bool.not(Bool.xor((ft < 0.0 : F32), (fa < 0.0 : F32)))
      root.go(m, tp, ax, ay, az, dx, dy, dz, F.pick(sa, t, ta), F.pick(sa, ft, F.pick(U32.is_eq(side, 2), (fa * 0.5 : F32), fa)), F.pick(sa, tb, t), F.pick(sa, F.pick(U32.is_eq(side, 1), (fb * 0.5 : F32), fb), ft), F.pickw(sa, 1, 2))

def cross.hit(h: F.Hit, +x: F32, +y: F32, +z: F32) -> X:
  F.Hit{_, l} = h
  XYes{x, y, z, l}

def cross.k(on: Bool, +tp: F.Tape, pa: F.V, pb: F.V, +va: F32, +vb: F32) -> X:
  match on:
    case False{}:
      XNo{}
    case True{}:
      F.V{+ax, +ay, +az} = pa
      F.V{bx, by, bz} = pb
      +dx = (bx - ax : F32)
      +dy = (by - ay : F32)
      +dz = (bz - az : F32)
      +t = root.go(12n, tp, ax, ay, az, dx, dy, dz, 0.0, va, 1.0, vb, 0)
      +px = F.ftz((ax + t * dx : F32))
      +py = F.ftz((ay + t * dy : F32))
      +pz = F.ftz((az + t * dz : F32))
      cross.hit(F.hit(tp, px, py, pz), px, py, pz)

def cross(+tp: F.Tape, pa: F.V, pb: F.V, +va: F32, +vb: F32) -> X:
  cross.k(Bool.xor((va < 0.0 : F32), (vb < 0.0 : F32)), tp, pa, pb, va, vb)

# --- MC cycles of a cell ------------------------------------------------------

def face_pairs.k(any: Bool, all4: Bool, s00: Bool, +m2: U32, +ea: U32, +eb: U32, +ec: U32, +ed: U32, acc: List<&2, U32>) -> List<&2, U32>:
  match any:
    case False{}:
      acc
    case True{}:
      match all4:
        case False{}:
          m2 <> acc
        case True{}:
          match s00:
            case True{}:
              U32.or(ea, ed) <> U32.or(eb, ec) <> acc
            case False{}:
              U32.or(ea, eb) <> U32.or(ec, ed) <> acc

# One cube face: corners k00 k10 k11 k01 (bit masks, cyclic) and the edges
# between consecutive corners ea (k00-k10) eb (k10-k11) ec (k11-k01)
# ed (k01-k00) as edge bits. Emits the edge pairs its MC segments join.
def face_pairs(+mask: U32, +k00: U32, +k10: U32, +k11: U32, +k01: U32, +ea: U32, +eb: U32, +ec: U32, +ed: U32, acc: List<&2, U32>) -> List<&2, U32>:
  +s00 = has(mask, k00)
  +s10 = has(mask, k10)
  +s11 = has(mask, k11)
  +s01 = has(mask, k01)
  +ca = Bool.xor(s00, s10)
  +cb = Bool.xor(s10, s11)
  +cc = Bool.xor(s11, s01)
  +cd = Bool.xor(s01, s00)
  +m2 = U32.or(U32.or(F.pickw(ca, ea, 0), F.pickw(cb, eb, 0)), U32.or(F.pickw(cc, ec, 0), F.pickw(cd, ed, 0)))
  face_pairs.k(Bool.or(Bool.or(ca, cb), Bool.or(cc, cd)), Bool.and(ca, Bool.and(cb, cc)), s00, m2, ea, eb, ec, ed, acc)

def all_pairs(+mask: U32) -> List<&2, U32>:
  +x0 = face_pairs(mask, 1, 4, 64, 16, 16, 1024, 64, 256, Nil{})
  +x1 = face_pairs(mask, 2, 8, 128, 32, 32, 2048, 128, 512, x0)
  +y0 = face_pairs(mask, 1, 2, 32, 16, 1, 512, 4, 256, x1)
  +y1 = face_pairs(mask, 4, 8, 128, 64, 2, 2048, 8, 1024, y0)
  +z0 = face_pairs(mask, 1, 2, 8, 4, 1, 32, 2, 16, y1)
  face_pairs(mask, 16, 32, 128, 64, 4, 128, 8, 64, z0)

def or_all(ps: List<&2, U32>, acc: U32) -> U32:
  match ps:
    case Nil{}:
      acc
    case p <> t:
      or_all(t, U32.or(acc, p))

def grow(ps: List<&2, U32>, +m: U32, acc: U32) -> U32:
  match ps:
    case Nil{}:
      acc
    case +p <> t:
      grow(t, m, U32.or(acc, F.pickw(has(p, m), p, 0)))

def closure(n: Nat, +ps: List<&2, U32>, +m: U32) -> U32:
  match n:
    case 0n:
      m
    case 1n+k:
      closure(k, ps, grow(ps, m, m))

# The cycles as edge masks, lowest edge first (at most 4 in a cube).
def comps(n: Nat, done: Bool, +ps: List<&2, U32>, +rem: U32) -> List<&2, U32>:
  match n:
    case 0n:
      Nil{}
    case 1n+k:
      match done:
        case True{}:
          Nil{}
        case False{}:
          +c = closure(6n, ps, U32.and(rem, (U32.not(rem) + 1 : U32)))
          +r2 = U32.and(rem, U32.not(c))
          c <> comps(k, U32.is_eq(r2, 0), ps, r2)

def comp_index(cs: List<&2, U32>, +bit: U32, +i: U32) -> U32:
  match cs:
    case Nil{}:
      i
    case +c <> t:
      F.pickw(has(c, bit), i, comp_index(t, bit, (i + 1 : U32)))

# --- vertex of one cycle --------------------------------------------------------

def same_face(a: F.Leaf, b: F.Leaf) -> Bool:
  F.Leaf{_, ca, na, _} = a
  F.Leaf{_, cb, nb, _} = b
  Bool.and(U32.is_eq(ca, cb), Bool.not(Bool.xor(na, nb)))

def member(s: List<&2, F.Leaf>, +l: F.Leaf) -> Bool:
  match s:
    case Nil{}:
      False{}
    case h <> t:
      Bool.or(same_face(h, l), member(t, l))

def insert.k(present: Bool, l: F.Leaf, s: List<&2, F.Leaf>) -> List<&2, F.Leaf>:
  match present:
    case True{}:
      s
    case False{}:
      l <> s

def insert(+l: F.Leaf, +s: List<&2, F.Leaf>) -> List<&2, F.Leaf>:
  insert.k(member(s, l), l, s)

def gather.one(sel: Bool, x: X, a: Acc) -> Acc:
  match sel:
    case False{}:
      a
    case True{}:
      match x:
        case XNo{}:
          a
        case XYes{px, py, pz, l}:
          Acc{sx, sy, sz, n, s} = a
          Acc{(sx + px : F32), (sy + py : F32), (sz + pz : F32), (n + 1.0 : F32), insert(l, s)}

def gather(xs: List<&2, X>, +bit: U32, +cm: U32, a: Acc) -> Acc:
  match xs:
    case Nil{}:
      a
    case x <> t:
      gather(t, (bit * 2 : U32), cm, gather.one(has(cm, bit), x, a))

def newton1(n: Nat, +f: F.Fn, +x: F32, +y: F32, +z: F32) -> F.V:
  match n:
    case 0n:
      F.V{x, y, z}
    case 1n+m:
      +g = F.fn_eval(f, x, y, z)
      +d = F.fn_grad(f, x, y, z)
      newton1(m, f, (x - g * vx(d) : F32), (y - g * vy(d) : F32), (z - g * vz(d) : F32))

# Damped Gauss-Newton (Levenberg-Marquardt, lambda = 1e-3) onto two or three
# carriers with unit gradients: x -= J^T (J J^T + lambda I)^-1 g. The damping
# keeps the step bounded where carriers meet nearly tangentially (singular
# J J^T) at the cost of linear convergence there; 16 steps.
def newton2(n: Nat, +f1: F.Fn, +f2: F.Fn, +x: F32, +y: F32, +z: F32) -> F.V:
  match n:
    case 0n:
      F.V{x, y, z}
    case 1n+m:
      +g1 = F.fn_eval(f1, x, y, z)
      +g2 = F.fn_eval(f2, x, y, z)
      +n1 = F.fn_grad(f1, x, y, z)
      +n2 = F.fn_grad(f2, x, y, z)
      +c = dot(n1, n2)
      +dg = {1.001 : F32}
      +det = (dg * dg - c * c : F32)
      +l1 = ((dg * g1 - c * g2) / det : F32)
      +l2 = ((dg * g2 - c * g1) / det : F32)
      newton2(m, f1, f2, (x - l1 * vx(n1) - l2 * vx(n2) : F32), (y - l1 * vy(n1) - l2 * vy(n2) : F32), (z - l1 * vz(n1) - l2 * vz(n2) : F32))

def newton3(n: Nat, +f1: F.Fn, +f2: F.Fn, +f3: F.Fn, +x: F32, +y: F32, +z: F32) -> F.V:
  match n:
    case 0n:
      F.V{x, y, z}
    case 1n+m:
      +g1 = F.fn_eval(f1, x, y, z)
      +g2 = F.fn_eval(f2, x, y, z)
      +g3 = F.fn_eval(f3, x, y, z)
      +n1 = F.fn_grad(f1, x, y, z)
      +n2 = F.fn_grad(f2, x, y, z)
      +n3 = F.fn_grad(f3, x, y, z)
      +a = dot(n1, n2)
      +b = dot(n1, n3)
      +c = dot(n2, n3)
      +dg = {1.001 : F32}
      # symmetric M = [[dg a b] [a dg c] [b c dg]], cofactors
      +m11 = (dg * dg - c * c : F32)
      +m12 = (b * c - a * dg : F32)
      +m13 = (a * c - b * dg : F32)
      +m22 = (dg * dg - b * b : F32)
      +m23 = (a * b - c * dg : F32)
      +m33 = (dg * dg - a * a : F32)
      +det = (dg * m11 + a * m12 + b * m13 : F32)
      +l1 = ((m11 * g1 + m12 * g2 + m13 * g3) / det : F32)
      +l2 = ((m12 * g1 + m22 * g2 + m23 * g3) / det : F32)
      +l3 = ((m13 * g1 + m23 * g2 + m33 * g3) / det : F32)
      newton3(m, f1, f2, f3, (x - l1 * vx(n1) - l2 * vx(n2) - l3 * vx(n3) : F32), (y - l1 * vy(n1) - l2 * vy(n2) - l3 * vy(n3) : F32), (z - l1 * vz(n1) - l2 * vz(n2) - l3 * vz(n3) : F32))

def solve(s: List<&2, F.Leaf>, +x: F32, +y: F32, +z: F32) -> Sol:
  match s:
    case [a]:
      Sol{newton1(6n, leaf_fn(a), x, y, z), True{}}
    case [a, b]:
      Sol{newton2(16n, leaf_fn(a), leaf_fn(b), x, y, z), True{}}
    case [a, b, c]:
      Sol{newton3(16n, leaf_fn(a), leaf_fn(b), leaf_fn(c), x, y, z), True{}}
    case _:
      Sol{F.V{x, y, z}, False{}}

def resid(s: List<&2, F.Leaf>, +x: F32, +y: F32, +z: F32, acc: F32) -> F32:
  match s:
    case Nil{}:
      acc
    case l <> t:
      resid(t, x, y, z, F32.max(acc, F.absf(F.fn_eval(leaf_fn(l), x, y, z))))

# Some pair of carriers with (nearly) opposite oriented normals at p.
def opposed(+n: F.V, s: List<&2, F.Leaf>, +x: F32, +y: F32, +z: F32) -> Bool:
  match s:
    case Nil{}:
      False{}
    case l <> t:
      Bool.or((dot(n, leaf_normal(l, x, y, z)) < (0.0 - 0.95 : F32) : F32), opposed(n, t, x, y, z))

def contact(s: List<&2, F.Leaf>, +x: F32, +y: F32, +z: F32) -> Bool:
  match s:
    case Nil{}:
      False{}
    case l <> t:
      +tt = t
      Bool.or(opposed(leaf_normal(l, x, y, z), tt, x, y, z), contact(tt, x, y, z))

def within(+v: F32, +lo: F32, +hi: F32) -> Bool:
  Bool.and(Bool.not((v < lo : F32)), Bool.not((hi < v : F32)))

def field_at.k(inside: Bool, +tp: F.Tape, +full: F.Tape, +x: F32, +y: F32, +z: F32) -> F32:
  match inside:
    case True{}:
      F.eval(tp, x, y, z)
    case False{}:
      F.eval(full, x, y, z)

def in_box(b: Box, +m: F32, +x: F32, +y: F32, +z: F32) -> Bool:
  Box{x0, y0, z0, x1, y1, z1} = b
  Bool.and(within(x, (x0 - m : F32), (x1 + m : F32)), Bool.and(within(y, (y0 - m : F32), (y1 + m : F32)), within(z, (z0 - m : F32), (z1 + m : F32))))

def vertex.k(sol: Sol, +s: List<&2, F.Leaf>, +tp: F.Tape, +full: F.Tape, +box: Box, +margin: F32, +tol: F32) -> VR:
  Sol{v, solved} = sol
  F.V{+x0, +y0, +z0} = v
  +x = F.ftz(x0)
  +y = F.ftz(y0)
  +z = F.ftz(z0)
  +r = resid(s, x, y, z, 0.0)
  +inside = in_box(box, 0.0, x, y, z)
  +fv = F.absf(field_at.k(inside, tp, full, x, y, z))
  +w1 = F.pickw(solved, 0, 1)
  +w2 = F.pickw((r < tol : F32), 0, 2)
  +w4 = F.pickw(in_box(box, F.pick(U32.is_eq(M_count(s), 3), (margin * 2.0 : F32), margin), x, y, z), 0, 4)
  +w8 = F.pickw((fv < tol : F32), 0, 8)
  +why = (w1 + w2 + w4 + w8 : U32)
  VR{VP{x, y, z}, U32.is_eq(why, 0), contact(s, x, y, z), why, M_count(s)}

def hit_at.k(inside: Bool, +tp: F.Tape, +full: F.Tape, +x: F32, +y: F32, +z: F32) -> F.Hit:
  match inside:
    case True{}:
      F.hit(tp, x, y, z)
    case False{}:
      F.hit(full, x, y, z)

def hit_leaf(h: F.Hit) -> F.Leaf:
  F.Hit{_, l} = h
  l

def vr_x(v: VR) -> F32:
  VR{p, _, _, _, _} = v
  VP{x, _, _} = p
  x

def vr_y(v: VR) -> F32:
  VR{p, _, _, _, _} = v
  VP{_, y, _} = p
  y

def vr_z(v: VR) -> F32:
  VR{p, _, _, _, _} = v
  VP{_, _, z} = p
  z

def rediscover.k(retry: Bool, +vr: VR, +s: List<&2, F.Leaf>, +mx: F32, +my: F32, +mz: F32, +tp: F.Tape, +full: F.Tape, +box: Box, +margin: F32, +tol: F32) -> VS:
  match retry:
    case False{}:
      VS{vr, s}
    case True{}:
      +l = hit_leaf(hit_at.k(in_box(box, 0.0, vr_x(vr), vr_y(vr), vr_z(vr)), tp, full, vr_x(vr), vr_y(vr), vr_z(vr)))
      +s2 = insert(l, s)
      VS{vertex.k(solve(s2, mx, my, mz), s2, tp, full, box, margin, tol), s2}

def vr_why(v: VR) -> U32:
  VR{_, _, _, w, _} = v
  w

def rediscover(vs: VS, +mx: F32, +my: F32, +mz: F32, +tp: F.Tape, +full: F.Tape, +box: Box, +margin: F32, +tol: F32) -> VS:
  VS{+vr, +s} = vs
  rediscover.k(has(vr_why(vr), 8), vr, s, mx, my, mz, tp, full, box, margin, tol)

def vs_vr(vs: VS) -> VR:
  VS{vr, _} = vs
  vr

def cand(+v: F.V, +s3: List<&2, F.Leaf>, +tp: F.Tape, +full: F.Tape, +box: Box, +margin: F32) -> Cand:
  F.V{+x0, +y0, +z0} = v
  +x = F.ftz(x0)
  +y = F.ftz(y0)
  +z = F.ftz(z0)
  +r = resid(s3, x, y, z, 0.0)
  +fv = F.absf(field_at.k(in_box(box, 0.0, x, y, z), tp, full, x, y, z))
  Cand{VP{x, y, z}, F32.max(r, fv), in_box(box, margin, x, y, z)}

def cand_vr(c: Cand, +relax: F32, +ct: Bool, +ns: U32) -> VR:
  Cand{v, +sc, +ib} = c
  +ok = Bool.and(ib, (sc < relax : F32))
  VR{v, ok, ct, F.pickw(ok, 16, 6), ns}

def cand_pick(first: Bool, va: VP, sa: F32, ia: Bool, vb: VP, sb: F32, ib: Bool) -> Cand:
  match first:
    case True{}:
      Cand{va, sa, ia}
    case False{}:
      Cand{vb, sb, ib}

def cand_better(a: Cand, b: Cand) -> Cand:
  Cand{va, +sa, +ia} = a
  Cand{vb, +sb, +ib} = b
  cand_pick(Bool.or(Bool.and(ia, Bool.not(ib)), Bool.and(Bool.not(Bool.xor(ia, ib)), Bool.not((sb < sa : F32)))), va, sa, ia, vb, sb, ib)

# Oriented value of a leaf (negative inside the result near its face).
def leaf_val(l: F.Leaf, +x: F32, +y: F32, +z: F32) -> F32:
  F.Leaf{_, _, +neg, f} = l
  F.fneg(neg, F.fn_eval(f, x, y, z))

def vsub_s(a: F.V, +s: F32, b: F.V) -> F.V:
  F.V{ax, ay, az} = a
  F.V{bx, by, bz} = b
  F.V{(ax - s * bx : F32), (ay - s * by : F32), (az - s * bz : F32)}

# The "incentre" of a pinching face. Where a face pinches to zero width between
# two others (the hex-nut chamfer cone between the top face and a flat), the
# three carriers have no common point near the cycle; across the pinch they
# bound a small triangle (the cut-off corner) whose incentre is the point
# closest to all three carriers (distance = inradius, far below the distance of
# any pairwise solution to the third carrier). With the oriented values g_i,
# the incentre and the three excentres solve g1 = s2 g2 = s3 g3 for the four
# sign pairs (s2, s3); each is found nearest to the start by minimum-norm damped
# Gauss-Newton steps on h1 = g1 - s2 g2, h2 = g1 - s3 g3 (16 steps), and the
# caller keeps the candidate with the smallest distance to all carriers.
def newton_eq(n: Nat, +l1: F.Leaf, +l2: F.Leaf, +l3: F.Leaf, +s2: F32, +s3: F32, +x: F32, +y: F32, +z: F32) -> F.V:
  match n:
    case 0n:
      F.V{x, y, z}
    case 1n+m:
      +g1 = leaf_val(l1, x, y, z)
      +h1 = (g1 - s2 * leaf_val(l2, x, y, z) : F32)
      +h2 = (g1 - s3 * leaf_val(l3, x, y, z) : F32)
      +n1 = leaf_normal(l1, x, y, z)
      +a = vsub_s(n1, s2, leaf_normal(l2, x, y, z))
      +b = vsub_s(n1, s3, leaf_normal(l3, x, y, z))
      +aa = (dot(a, a) + 0.001 : F32)
      +ab = dot(a, b)
      +bb = (dot(b, b) + 0.001 : F32)
      +det = (aa * bb - ab * ab : F32)
      +u1 = ((bb * h1 - ab * h2) / det : F32)
      +u2 = ((aa * h2 - ab * h1) / det : F32)
      newton_eq(m, l1, l2, l3, s2, s3, (x - u1 * vx(a) - u2 * vx(b) : F32), (y - u1 * vy(a) - u2 * vy(b) : F32), (z - u1 * vz(a) - u2 * vz(b) : F32))

def pairs3(s: List<&2, F.Leaf>, +mx: F32, +my: F32, +mz: F32, +tp: F.Tape, +full: F.Tape, +box: Box, +margin: F32, +relax: F32, +ct: Bool) -> VR:
  match s:
    case [+a, +b, +c]:
      +s3 = {[a, b, c] : List<&2, F.Leaf>}
      +cab = cand(newton2(16n, leaf_fn(a), leaf_fn(b), mx, my, mz), s3, tp, full, box, margin)
      +cac = cand(newton2(16n, leaf_fn(a), leaf_fn(c), mx, my, mz), s3, tp, full, box, margin)
      +cbc = cand(newton2(16n, leaf_fn(b), leaf_fn(c), mx, my, mz), s3, tp, full, box, margin)
      +cpp = cand(newton_eq(16n, a, b, c, 1.0, 1.0, mx, my, mz), s3, tp, full, box, margin)
      +cpm = cand(newton_eq(16n, a, b, c, 1.0, F32.neg(1.0), mx, my, mz), s3, tp, full, box, margin)
      +cmp = cand(newton_eq(16n, a, b, c, F32.neg(1.0), 1.0, mx, my, mz), s3, tp, full, box, margin)
      +cmm = cand(newton_eq(16n, a, b, c, F32.neg(1.0), F32.neg(1.0), mx, my, mz), s3, tp, full, box, margin)
      +pairs = cand_better(cand_better(cab, cac), cbc)
      cand_vr(cand_better(pairs, cand_better(cand_better(cpp, cpm), cand_better(cmp, cmm))), relax, ct, 3)
    case _:
      VR{VP{mx, my, mz}, False{}, ct, 1, 4}

def vr_ct(v: VR) -> Bool:
  VR{_, _, ct, _, _} = v
  ct

def vr_p(v: VR) -> VP:
  VR{p, _, _, _, _} = v
  p

def fallback.k(failed: Bool, three: Bool, resid_only: Bool, +vr: VR, +s: List<&2, F.Leaf>, +mx: F32, +my: F32, +mz: F32, +tp: F.Tape, +full: F.Tape, +box: Box, +margin: F32, +tol: F32) -> VR:
  match failed:
    case False{}:
      vr
    case True{}:
      match three:
        case True{}:
          pairs3(s, mx, my, mz, tp, full, box, margin, (tol * 50.0 : F32), vr_ct(vr))
        case False{}:
          match resid_only:
            case True{}:
              +ok = (resid(s, vr_x(vr), vr_y(vr), vr_z(vr), 0.0) < (tol * 50.0 : F32) : F32)
              VR{vr_p(vr), ok, vr_ct(vr), F.pickw(ok, 16, 2), M_count(s)}
            case False{}:
              vr

def vr_ok(v: VR) -> Bool:
  VR{_, ok, _, _, _} = v
  ok

def fallback(vs: VS, +mx: F32, +my: F32, +mz: F32, +tp: F.Tape, +full: F.Tape, +box: Box, +margin: F32, +tol: F32) -> VR:
  VS{+vr, +s} = vs
  fallback.k(Bool.not(vr_ok(vr)), U32.is_eq(M_count(s), 3), U32.is_eq(vr_why(vr), 2), vr, s, mx, my, mz, tp, full, box, margin, tol)

def vertex(a: Acc, +tp: F.Tape, +full: F.Tape, +box: Box, +margin: F32, +tol: F32) -> VR:
  Acc{sx, sy, sz, +n, +s} = a
  +mx = (sx / n : F32)
  +my = (sy / n : F32)
  +mz = (sz / n : F32)
  +v0 = {VS{vertex.k(solve(s, mx, my, mz), s, tp, full, box, margin, tol), s} : VS}
  fallback(rediscover(rediscover(v0, mx, my, mz, tp, full, box, margin, tol), mx, my, mz, tp, full, box, margin, tol), mx, my, mz, tp, full, box, margin, tol)

def cycle_vertices(cs: List<&2, U32>, +xs: List<&2, X>, +tp: F.Tape, +full: F.Tape, +box: Box, +margin: F32, +tol: F32) -> List<&2, VR>:
  match cs:
    case Nil{}:
      Nil{}
    case c <> t:
      vertex(gather(xs, 1, c, Acc{0.0, 0.0, 0.0, 0.0, Nil{}}), tp, full, box, margin, tol) <> cycle_vertices(t, xs, tp, full, box, margin, tol)

def edge_info(x: X, +bit: U32, +cs: List<&2, U32>) -> EI:
  match x:
    case XNo{}:
      ENo{}
    case XYes{_, _, _, l}:
      EYes{comp_index(cs, bit, 0), l}

def edge_infos(xs: List<&2, X>, +bit: U32, +cs: List<&2, U32>) -> List<&2, EI>:
  match xs:
    case Nil{}:
      Nil{}
    case x <> t:
      edge_info(x, bit, cs) <> edge_infos(t, (bit * 2 : U32), cs)

# Feature bits of the cycles: bit c when the vertex of cycle c is a corner
# (three carriers, one point), bit c + 8 when it is a crease point (two).
def vr_cmask(vs: List<&2, VR>, +bit: U32, acc: U32) -> U32:
  match vs:
    case Nil{}:
      acc
    case VR{_, _, _, _, +ns} <> t:
      vr_cmask(t, (bit * 2 : U32), U32.or(acc, U32.or(F.pickw(U32.is_eq(ns, 3), bit, 0), F.pickw(U32.is_eq(ns, 2), (bit * 256 : U32), 0))))

def vr_points(vs: List<&2, VR>) -> List<&2, VP>:
  match vs:
    case Nil{}:
      Nil{}
    case VR{p, _, _, _, _} <> t:
      p <> vr_points(t)

def vr_st(vs: List<&2, VR>, acc: St) -> St:
  match vs:
    case Nil{}:
      acc
    case VR{+p, +ok, ct, +w, ns} <> t:
      St{v, f, c, fi, co, ow, op, +oc, oa} = acc
      +take = Bool.and(U32.is_eq(oc, 0), Bool.not(ok))
      vr_st(t, St{(v + 1 : U32), (f + F.pickw(ok, 0, 1) : U32), (c + F.pickw(ct, 1, 0) : U32), fi, co, U32.or(ow, F.pickw(ok, 0, w)), pick_vp(take, p, op), F.pickw(take, (ns * 16 + w : U32), oc), (oa + F.pickw(Bool.and(ok, has(w, 16)), 1, 0) : U32)})

def fine_done(+mask: U32, +xs: List<&2, X>, +cs: List<&2, U32>, +vrs: List<&2, VR>) -> Oct:
  OFine{mask, 0, edge_infos(xs, 1, cs), vr_points(vrs), vr_st(vrs, St{0, 0, 0, 1, 0, 0, VP{0.0, 0.0, 0.0}, 0, 0}), vr_cmask(vrs, 1, 0), Nil{}}

def fine_cells(+mask: U32, +xs: List<&2, X>, +tp: F.Tape, +full: F.Tape, +box: Box, +margin: F32, +tol: F32) -> Oct:
  +ps = all_pairs(mask)
  +cm = or_all(ps, 0)
  +cs = comps(4n, U32.is_eq(cm, 0), ps, cm)
  fine_done(mask, xs, cs, cycle_vertices(cs, xs, tp, full, box, margin, tol))

def fine.k(hom: Bool, +mask: U32, +xs: List<&2, X>, +tp: F.Tape, +full: F.Tape, +box: Box, +margin: F32, +tol: F32) -> Oct:
  match hom:
    case True{}:
      OHom{}
    case False{}:
      fine_cells(mask, xs, tp, full, box, margin, tol)

def bitf(+v: F32, +b: U32) -> U32:
  F.pickw((v < 0.0 : F32), b, 0)

# A finest-level cell [x0, x1] x [y0, y1] x [z0, z1].
def fine_leaf(+tp: F.Tape, +full: F.Tape, +x0: F32, +x1: F32, +y0: F32, +y1: F32, +z0: F32, +z1: F32, +margin: F32, +tol: F32) -> Oct:
  +p0 = {F.V{x0, y0, z0} : F.V}
  +p1 = {F.V{x1, y0, z0} : F.V}
  +p2 = {F.V{x0, y1, z0} : F.V}
  +p3 = {F.V{x1, y1, z0} : F.V}
  +p4 = {F.V{x0, y0, z1} : F.V}
  +p5 = {F.V{x1, y0, z1} : F.V}
  +p6 = {F.V{x0, y1, z1} : F.V}
  +p7 = {F.V{x1, y1, z1} : F.V}
  +v0 = F.eval(tp, x0, y0, z0)
  +v1 = F.eval(tp, x1, y0, z0)
  +v2 = F.eval(tp, x0, y1, z0)
  +v3 = F.eval(tp, x1, y1, z0)
  +v4 = F.eval(tp, x0, y0, z1)
  +v5 = F.eval(tp, x1, y0, z1)
  +v6 = F.eval(tp, x0, y1, z1)
  +v7 = F.eval(tp, x1, y1, z1)
  +mask = (bitf(v0, 1) + bitf(v1, 2) + bitf(v2, 4) + bitf(v3, 8) + bitf(v4, 16) + bitf(v5, 32) + bitf(v6, 64) + bitf(v7, 128) : U32)
  +xs = {[cross(tp, p0, p1, v0, v1), cross(tp, p2, p3, v2, v3), cross(tp, p4, p5, v4, v5), cross(tp, p6, p7, v6, v7), cross(tp, p0, p2, v0, v2), cross(tp, p1, p3, v1, v3), cross(tp, p4, p6, v4, v6), cross(tp, p5, p7, v5, v7), cross(tp, p0, p4, v0, v4), cross(tp, p1, p5, v1, v5), cross(tp, p2, p6, v2, v6), cross(tp, p3, p7, v3, v7)] : List<&2, X>}
  fine.k(Bool.or(U32.is_eq(mask, 0), U32.is_eq(mask, 255)), mask, xs, tp, full, Box{x0, y0, z0, x1, y1, z1}, margin, tol)

def plane_val(+nx: F32, +ny: F32, +nz: F32, +d: F32, +neg: Bool, +x: F32, +y: F32, +z: F32) -> F32:
  F.fneg(neg, (nx * x + ny * y + nz * z - d : F32))

def coarse.k(inside: Bool, +mask: U32, +lvl: U32, +depth: U32, +i: U32, +j: U32, +k: U32, +s: F32, +px: F32, +py: F32, +pz: F32, l: F.Leaf) -> Cls:
  match inside:
    case True{}:
      CDone{OCoarse{depth, mask, 0, VP{px, py, pz}, l}}
    case False{}:
      CSplit{lvl, i, j, k, s, F.TLeaf{l}}

def coarse.m(hom: Bool, inside: Bool, +mask: U32, +lvl: U32, +depth: U32, +i: U32, +j: U32, +k: U32, +s: F32, +px: F32, +py: F32, +pz: F32, l: F.Leaf) -> Cls:
  match hom:
    case True{}:
      CDone{OHom{}}
    case False{}:
      coarse.k(inside, mask, lvl, depth, i, j, k, s, px, py, pz, l)

def coarse.p(f: F.Fn, l: F.Leaf, +neg: Bool, +lvl: U32, +depth: U32, +i: U32, +j: U32, +k: U32, +s: F32, +x0: F32, +x1: F32, +y0: F32, +y1: F32, +z0: F32, +z1: F32) -> Cls:
  match f:
    case F.FPlane{+nx, +ny, +nz, +d}:
      +m = (bitf(plane_val(nx, ny, nz, d, neg, x0, y0, z0), 1) + bitf(plane_val(nx, ny, nz, d, neg, x1, y0, z0), 2) + bitf(plane_val(nx, ny, nz, d, neg, x0, y1, z0), 4) + bitf(plane_val(nx, ny, nz, d, neg, x1, y1, z0), 8) + bitf(plane_val(nx, ny, nz, d, neg, x0, y0, z1), 16) + bitf(plane_val(nx, ny, nz, d, neg, x1, y0, z1), 32) + bitf(plane_val(nx, ny, nz, d, neg, x0, y1, z1), 64) + bitf(plane_val(nx, ny, nz, d, neg, x1, y1, z1), 128) : U32)
      +cx = ((x0 + x1) * 0.5 : F32)
      +cy = ((y0 + y1) * 0.5 : F32)
      +cz = ((z0 + z1) * 0.5 : F32)
      +g = (nx * cx + ny * cy + nz * cz - d : F32)
      +px = F.ftz((cx - g * nx : F32))
      +py = F.ftz((cy - g * ny : F32))
      +pz = F.ftz((cz - g * nz : F32))
      coarse.m(Bool.or(U32.is_eq(m, 0), U32.is_eq(m, 255)), in_box(Box{x0, y0, z0, x1, y1, z1}, 0.0, px, py, pz), m, lvl, depth, i, j, k, s, px, py, pz, l)
    case _:
      CSplit{lvl, i, j, k, s, F.TLeaf{l}}

# The pruned tape is one plane: the surface in the closed cell is that plane.
def coarse(l: F.Leaf, +lvl: U32, +depth: U32, +i: U32, +j: U32, +k: U32, +s: F32, +x0: F32, +x1: F32, +y0: F32, +y1: F32, +z0: F32, +z1: F32) -> Cls:
  F.Leaf{tag, canon, +neg, +f} = l
  coarse.p(f, F.Leaf{tag, canon, neg, f}, neg, lvl, depth, i, j, k, s, x0, x1, y0, y1, z0, z1)

def classify.wide(wide: F.One, l: F.Leaf, t: F.Tape, +lvl: U32, +depth: U32, +i: U32, +j: U32, +k: U32, +s: F32, +x0: F32, +x1: F32, +y0: F32, +y1: F32, +z0: F32, +z1: F32) -> Cls:
  match wide:
    case F.OnePlane{_}:
      coarse(l, lvl, depth, i, j, k, s, x0, x1, y0, y1, z0, z1)
    case F.NotOne{}:
      CSplit{lvl, i, j, k, s, t}

# A coarse single-plane leaf is only kept when the plane is also the only face
# of the full tape over the cube three times the cell (grading: cells next to
# a feature are at most about as large as their distance to it, which keeps
# the dual polygons of coarse and fine cells from folding over each other).
def classify.one(o: F.One, t: F.Tape, +full: F.Tape, +eps: F32, +lvl: U32, +depth: U32, +i: U32, +j: U32, +k: U32, +s: F32, +x0: F32, +x1: F32, +y0: F32, +y1: F32, +z0: F32, +z1: F32) -> Cls:
  match o:
    case F.OnePlane{l}:
      +wh = (s * 1.5 : F32)
      classify.wide(F.one_plane(F.pr_tape(F.prune(full, ((x0 + x1) * 0.5 : F32), ((y0 + y1) * 0.5 : F32), ((z0 + z1) * 0.5 : F32), wh, (wh * 1.7320512 : F32), eps))), l, t, lvl, depth, i, j, k, s, x0, x1, y0, y1, z0, z1)
    case F.NotOne{}:
      CSplit{lvl, i, j, k, s, t}

def classify.k(hom: Bool, fine: Bool, +tp: F.Tape, +full: F.Tape, +g: Grid, +lvl: U32, +depth: U32, +i: U32, +j: U32, +k: U32, +s: F32, +x0: F32, +x1: F32, +y0: F32, +y1: F32, +z0: F32, +z1: F32) -> Cls:
  match hom:
    case True{}:
      CDone{OHom{}}
    case False{}:
      match fine:
        case True{}:
          Grid{_, _, _, _, _, margin, tol} = g
          CDone{fine_leaf(tp, full, x0, x1, y0, y1, z0, z1, (margin * s : F32), tol)}
        case False{}:
          Grid{_, _, _, _, eps, _, _} = g
          classify.one(F.one_plane(tp), tp, full, eps, lvl, depth, i, j, k, s, x0, x1, y0, y1, z0, z1)

def classify.pr(pr: F.PR, +full: F.Tape, +g: Grid, +lvl: U32, +depth: U32, +i: U32, +j: U32, +k: U32, +s: F32, +x0: F32, +x1: F32, +y0: F32, +y1: F32, +z0: F32, +z1: F32) -> Cls:
  F.PR{tp, +lo, +hi} = pr
  classify.k(Bool.or((0.0 < lo : F32), (hi < 0.0 : F32)), U32.is_eq(lvl, 0), tp, full, g, lvl, depth, i, j, k, s, x0, x1, y0, y1, z0, z1)

# Cell (i, j, k) of size s, lvl levels above the finest. Corner coordinates
# come from integer indices (o + i * s), so neighbours of any size compute
# bit-identical shared corners.
def classify(+lvl: U32, +depth: U32, +i: U32, +j: U32, +k: U32, +s: F32, t: F.Tape, +full: F.Tape, +g: Grid) -> Cls:
  Grid{ox, oy, oz, _, eps, _, _} = g
  +x0 = (ox + U32.to_f32(i) * s : F32)
  +x1 = (ox + U32.to_f32((i + 1 : U32)) * s : F32)
  +y0 = (oy + U32.to_f32(j) * s : F32)
  +y1 = (oy + U32.to_f32((j + 1 : U32)) * s : F32)
  +z0 = (oz + U32.to_f32(k) * s : F32)
  +z1 = (oz + U32.to_f32((k + 1 : U32)) * s : F32)
  +half = (s * 0.5 : F32)
  classify.pr(F.prune(t, ((x0 + x1) * 0.5 : F32), ((y0 + y1) * 0.5 : F32), ((z0 + z1) * 0.5 : F32), half, (half * 1.7320512 : F32), eps), full, g, lvl, depth, i, j, k, s, x0, x1, y0, y1, z0, z1)

def node(a: Oct, b: Oct, c: Oct, d: Oct, e: Oct, f: Oct, g: Oct, h: Oct) -> Oct:
  +a1 = a
  +b1 = b
  +c1 = c
  +d1 = d
  +e1 = e
  +f1 = f
  +g1 = g
  +h1 = h
  ONode{st_add(st_add(st_add(st_of(a1), st_of(b1)), st_add(st_of(c1), st_of(d1))), st_add(st_add(st_of(e1), st_of(f1)), st_add(st_of(g1), st_of(h1)))), a1, b1, c1, d1, e1, f1, g1, h1}

def build(+fuel: Nat, c: Cls, +full: F.Tape, +g: Grid) -> Oct:
  match fuel:
    case 0n:
      OHom{}
    case 1n+f:
      match c:
        case CDone{o}:
          o
        case CRaw{+lvl, +i, +j, +k, +s, t}:
          build(f, classify(lvl, lvl, i, j, k, s, t, full, g), full, g)
        case CSplit{+lvl, +i, +j, +k, +s, +t}:
          +l = (lvl - 1 : U32)
          +h = (s * 0.5 : F32)
          +i0 = (i * 2 : U32)
          +j0 = (j * 2 : U32)
          +k0 = (k * 2 : U32)
          +i1 = (i0 + 1 : U32)
          +j1 = (j0 + 1 : U32)
          +k1 = (k0 + 1 : U32)
          a b cc d e ff gg hh = build(f, CRaw{l, i0, j0, k0, h, t}, full, g) build(f, CRaw{l, i1, j0, k0, h, t}, full, g) build(f, CRaw{l, i0, j1, k0, h, t}, full, g) build(f, CRaw{l, i1, j1, k0, h, t}, full, g) build(f, CRaw{l, i0, j0, k1, h, t}, full, g) build(f, CRaw{l, i1, j0, k1, h, t}, full, g) build(f, CRaw{l, i0, j1, k1, h, t}, full, g) build(f, CRaw{l, i1, j1, k1, h, t}, full, g)
          node(a, b, cc, d, e, ff, gg, hh)
