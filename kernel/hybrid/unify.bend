import Base
import ../real.bend as R
import ../precise.bend as G
import ../robust-predicates.bend as RP
import ./mesh.bend as M
import ./mesh-io.bend as MIO

# Carrier unification for rotated or tilted coplanar input
# (docs/hybrid-boolean-plan.md, section 8, step 4; docs/hybrid-robust.md X1),
# shared by corefine (which decides the topology with it) and recover (which
# states it in its output).
#
# A rigid transform rounded to F32x2 moves analytically coplanar faces of two
# leaves apart by ~1e-14 mm (a rotated block with a flush pocket, a rotated
# touching union). Carriers need not even differ: when two leaves share a
# bitwise identical carrier that is tilted, the carrier is exact but every
# leaf vertex on it is a rounded point, up to ~2^-48 * scale off the plane on
# either side (the relief union of probe 612:9 and kt1-rot: cap vertices
# 6.5e-14 mm above and below the identical cone-base carrier). A mesh Boolean
# then decides their overlap from that rounding: membranes, slivers,
# self-intersections, face loops pinched at one vertex.
#
# Decision (exact, on the face-table values only). Two plane tags are in one
# class when, with both normals oriented alike (the largest component, the
# first on ties, positive),
#   - every normal component differs by at most 2^-44, and
#   - the offsets n.o differ by at most tau = 2^-44 * scale,
# where scale is the smallest power of two >= the largest |coordinate| of the
# leaf meshes.
#
# Why 2^-44: the tolerance absorbs the rounding of one rigid transform and
# nothing more. The wire carries F32x2 values (48 significand bits, rounding
# <= 2^-49 relative per coordinate); a rotated point computed in doubles and
# then rounded to F32x2 is off by < 2^-48 * scale per coordinate, so two
# analytically coplanar carriers of equally transformed leaves differ in n.o
# by at most ~6 * 2^-49 * scale (~2^-46.4 * scale), and their normals, when
# computed separately, by ~2^-48 per component. Measured on every rotated
# coplanar job of the corpus and the adversarial suites: normals identical,
# offsets <= 2^-50.2 * scale (2.4e-14 mm at scale 32). 2^-44 keeps a factor
# >= 5 over the bound. The earlier 2^-40 was 1000 times the measured rounding
# and merged real skins of rotated or tilted input (a sealed void under a
# 1e-11 mm skin at scale 32: 2^-41.7 * scale; the hybrid gate verifier's
# advn2-rot-skin-1e-11 and advn2-prism-tilted-skin-1e-11). Both tests are
# exact: big integers of robust-predicates.bend (units of 2^-149 per word,
# 2^-298 per product), after an F32 prefilter that only skips pairs far
# outside the tolerance. Tags are swept in the order of their offsets; each
# joins the first class whose representative (its first tag) passes, so every
# member lies within the tolerance of its representative (no chain drift).
#
# Exact carriers (axis_exact: two normal components exactly 0, the third
# exactly +-1; a rounded length is a transform's, docs/hybrid-robust.md F2). No rotation
# rounded them: their offsets are the input coordinates as given, and so are
# the coordinates of the leaf vertices on them. Two identical exact carriers
# are one plane whose vertices lie exactly on it (MtSame: one class, nothing
# to unify, the exact predicates decide it); two different ones are two
# planes of the input (a sealed void under a 2e-11 mm skin) and never join,
# since unifying them would change the topology of exactly representable input.
#
# Every other pair within the tolerance is unified (MtNear), an identical
# pair too (24 September 2026): coplanarity is a property of the carriers'
# provenance, not of the rounded vertices. A class is unified when such a
# pair joins tags of different leaves. With identical tilted carriers the
# corpus has unified classes again (tilted-holes-17deg: 4, geometry unchanged,
# the recover statement is new).
#
# Unified classes get one bit each, in class order, at most 32. A class past
# the limit keeps the decisions without this step (rounding decides its
# coplanar overlaps); it is not dropped silently: Unified.over counts those
# classes, Unified.classes counts all unified classes, and the refusal suffix
# (note) of corefine and recover names them.

# masks: the class bits of every tag (the first min(classes, 32) unified
# classes have one); classes: all unified classes; over: those past the
# 32-bit limit (no bit, no ties); planes: the plane class of every tag
# (unified or not; tags in one class are one plane: identical exact
# carriers or a unified class), 4294967295 for a tag without a plane
# carrier (corefine's membrane cancellation, corefine/membrane.bend).
type Unified is Data:
  Unified{masks: List<&2, U32>, nf: U32, classes: U32, over: U32, scale: F32, tau: F32, planes: List<&2, U32>}

# A plane tag: normal oriented canonically, F32 offset key and F32 normal
# (prefilter and sweep order only).
type PT is Data:
  PT{t: U32, leaf: U32, n: G.Vec3, o: G.Vec3, key: F32, fx: F32, fy: F32, fz: F32}

type Rep is Data:
  Rep{c: U32, p: PT, nt: Bool}

type Asg is Data:
  Asg{t: U32, c: U32}

type Mt is Data:
  MtNo{}
  MtSame{}
  MtNear{}

type Sw is Data:
  Sw{act: List<&2, Rep>, done: List<&2, Rep>, asg: List<&2, Asg>, next: U32}

type Fd is Data:
  Fd{hit: Bool, c: U32, mt: Mt, reps: List<&2, Rep>}

type Pts is Data:
  Pts{ps: List<&2, PT>, nf: U32}

# --- small helpers ------------------------------------------------------------------

def f32_bits(x: U32) -> F32:
  match x:
    case U32{w}:
      F32{w}

# 2^(e - 127), 1 <= e <= 254.
def pow2(+e: U32) -> F32:
  f32_bits(U32.shln(e, 23n))

# The smallest power of two >= x (1 for x <= 0).
def pow2_ge(+x: F32) -> F32:
  +m = U32.and(F32.bits(x), 8388607)
  +e = U32.and(U32.shrn(F32.bits(x), 23n), 255)
  Bool.pick(F32, (x > 0.0 : F32), Bool.pick(F32, U32.is_eq(m, 0), x, pow2(U32.min((e + 1 : U32), 254))), 1.0)

def vx(v: G.Vec3) -> R.Real:
  G.V3{x, _, _} = v
  x

def vy(v: G.Vec3) -> R.Real:
  G.V3{_, y, _} = v
  y

def vz(v: G.Vec3) -> R.Real:
  G.V3{_, _, z} = v
  z

def rev_onto(-A: Data, xs: List<&2, A>, acc: List<&2, A>) -> List<&2, A>:
  match xs:
    case Nil{}:
      acc
    case h <> t:
      rev_onto(A, t, h <> acc)

def rev(-A: Data, xs: List<&2, A>) -> List<&2, A>:
  rev_onto(A, xs, Nil{})

def cons_if(-A: Data, c: Bool, x: A, acc: List<&2, A>) -> List<&2, A>:
  match c:
    case True{}:
      x <> acc
    case False{}:
      acc

def len.go(-A: Data, xs: List<&2, A>, acc: Nat) -> Nat:
  match xs:
    case Nil{}:
      acc
    case _ <> t:
      len.go(A, t, 1n+acc)

# Stack-safe bottom-up merge sort (every loop tail-recursive; the lists here
# are the plane tags of one job).
def msort.runs(-A: Data, xs: List<&2, A>, acc: List<&2, List<&2, A>>) -> List<&2, List<&2, A>>:
  match xs:
    case Nil{}:
      acc
    case h <> t:
      msort.runs(A, t, [h] <> acc)

def msort.pass(~A: Data, ~le: A -> A -> Bool, +n: Nat, runs: List<&2, List<&2, A>>, acc: List<&2, List<&2, A>>) -> List<&2, List<&2, A>>:
  match runs:
    case Nil{}:
      rev(List<&2, A>, acc)
    case r <> Nil{}:
      rev(List<&2, A>, r <> acc)
    case r1 <> r2 <> rest:
      msort.pass(~A, ~le, n, rest, List.merge.go(~A, ~le, n, (Nil{}, r1, r2)) <> acc)

def msort.go(~A: Data, ~le: A -> A -> Bool, fuel: Nat, +n: Nat, runs: List<&2, List<&2, A>>) -> List<&2, A>:
  match fuel runs:
    case _ Nil{}:
      Nil{}
    case _ r <> Nil{}:
      r
    case 0n _:
      List.concat(&2, A, runs)
    case 1n+f _:
      msort.go(~A, ~le, f, n, msort.pass(~A, ~le, n, runs, Nil{}))

def sort(~A: Data, ~le: A -> A -> Bool, +xs: List<&2, A>) -> List<&2, A>:
  msort.go(~A, ~le, 64n, len.go(A, xs, 0n), msort.runs(A, xs, Nil{}))

# --- leaf mesh scale -------------------------------------------------------------------
# An upper bound of the largest |coordinate| of the leaf meshes
# (|hi| (1 + 2^-20)); the meshes come back unchanged.

def rabs_up(+x: R.Real) -> F32:
  (F32.abs(R.approx(x)) * 1.00000095367431640625 : F32)

def v_maxabs(+v: G.Vec3) -> F32:
  F32.max(rabs_up(vx(v)), F32.max(rabs_up(vy(v)), rabs_up(vz(v))))

type Mx is Data:
  Mx{vs: List<&2, G.Vec3>, m: F32}

def mx.vs(vs: List<&2, G.Vec3>, +acc: F32, out: List<&2, G.Vec3>) -> Mx:
  match vs:
    case Nil{}:
      Mx{rev(G.Vec3, out), acc}
    case +v <> t:
      mx.vs(t, F32.max(acc, v_maxabs(v)), v <> out)

type MxL is Data:
  MxL{ms: List<&2, M.LeafMesh>, m: F32}

def mx.push(x: Mx, +l: U32, ts: List<&2, M.Tri>, st: MxL) -> MxL:
  Mx{vs, +a} = x
  MxL{ms, +b} = st
  MxL{M.LeafMesh{l, M.Mesh{vs, ts}} <> ms, F32.max(a, b)}

def mx.list(ms: List<&2, M.LeafMesh>, st: MxL) -> MxL:
  match ms:
    case Nil{}:
      MxL{out, a} = st
      MxL{rev(M.LeafMesh, out), a}
    case M.LeafMesh{+l, M.Mesh{vs, ts}} <> t:
      mx.list(t, mx.push(mx.vs(vs, 0.0, Nil{}), l, ts, st))

# The leaf meshes (unchanged) and their largest |coordinate| (upper bound).
def scan(ms: List<&2, M.LeafMesh>) -> MxL:
  mx.list(ms, MxL{Nil{}, 0.0})

# --- plane tags -------------------------------------------------------------------

def canon.neg(neg: Bool, n: G.Vec3) -> G.Vec3:
  match neg:
    case True{}:
      G.V3{x, y, z} = n
      G.V3{R.neg(x), R.neg(y), R.neg(z)}
    case False{}:
      n

# The normal with its largest component (the first on ties) positive.
def canon(+n: G.Vec3) -> G.Vec3:
  +ax = F32.abs(R.approx(vx(n)))
  +ay = F32.abs(R.approx(vy(n)))
  +az = F32.abs(R.approx(vz(n)))
  +bx = Bool.and((ax >= ay : F32), (ax >= az : F32))
  +by = (ay >= az : F32)
  +m = Bool.pick(F32, bx, R.approx(vx(n)), Bool.pick(F32, by, R.approx(vy(n)), R.approx(vz(n))))
  canon.neg((m < 0.0 : F32), n)

def pt.mk(+t: U32, +leaf: U32, +nc: G.Vec3, +o: G.Vec3) -> PT:
  PT{t, leaf, nc, o, R.approx(G.dot(nc, o)), R.approx(vx(nc)), R.approx(vy(nc)), R.approx(vz(nc))}

def pts.go(fs: List<&2, M.FaceTag>, +t: U32, acc: List<&2, PT>) -> Pts:
  match fs:
    case Nil{}:
      Pts{acc, t}
    case M.FaceTag{leaf, _, M.SPlane{o, n, _}} <> rest:
      pts.go(rest, (t + 1 : U32), pt.mk(t, leaf, canon(n), o) <> acc)
    case _ <> rest:
      pts.go(rest, (t + 1 : U32), acc)

def pt_le(a: PT, b: PT) -> Bool:
  PT{+ta, _, _, _, +ka, _, _, _} = a
  PT{+tb, _, _, _, +kb, _, _, _} = b
  Bool.or((ka < kb : F32), Bool.and(F32.is_eq(ka, kb), U32.is_le(ta, tb)))

def pt_key(p: PT) -> F32:
  PT{_, _, _, _, k, _, _, _} = p
  k

def pt_leaf(p: PT) -> U32:
  PT{_, l, _, _, _, _, _, _} = p
  l

def pt_t(p: PT) -> U32:
  PT{t, _, _, _, _, _, _, _} = p
  t

def pt_n(p: PT) -> G.Vec3:
  PT{_, _, n, _, _, _, _, _} = p
  n

def pt_o(p: PT) -> G.Vec3:
  PT{_, _, _, o, _, _, _, _} = p
  o

# --- the exact test ---------------------------------------------------------------

def big_abs(x: RP.Big) -> RP.Big:
  RP.Big{_, ds} = x
  RP.make(False{}, ds)

def not_neg(s: RP.Sign) -> Bool:
  match s:
    case RP.Negative{}:
      False{}
    case _:
      True{}

def is_zero(s: RP.Sign) -> Bool:
  match s:
    case RP.ExactlyZero{}:
      True{}
    case _:
      False{}

def big_within(+x: RP.Big, +lim: RP.Big) -> Bool:
  not_neg(RP.sign(RP.sub(lim, big_abs(x))))

def big_zero(x: RP.Big) -> Bool:
  is_zero(RP.sign(x))

def rdiff(a: R.Real, b: R.Real) -> RP.Big:
  RP.sub(RP.from_real(a), RP.from_real(b))

# A pair within the tolerance. Both carriers exact (axis_exact): identical,
# they are one plane with its vertices exactly on it (MtSame); different, two
# planes of the input (MtNo). Otherwise the pair is unified (MtNear), an
# identical pair too: a tilted carrier is exact, the rounded leaf vertices on
# it are not.
def mt.fin(ok: Bool, ident: Bool, exact: Bool) -> Mt:
  match ok:
    case False{}:
      MtNo{}
    case True{}:
      Bool.pick(Mt, exact, Bool.pick(Mt, ident, MtSame{}, MtNo{}), MtNear{})

def r_zero(+x: R.Real) -> Bool:
  big_zero(RP.from_real(x))

# Exactly two normal components are exactly zero and the third is exactly
# +-1: an axis-aligned plane carrier. No rotation rounded it; its offset is
# the leaf's own coordinate, so two such carriers that differ are distinct
# planes of the input as given (a 2e-11 mm skin over a sealed void is real),
# and the exact predicates decide them without unification. A normal like
# (0, -1.0000000000000053, 0) is not one: its length is the rounding of a
# transform (probe tilted by 52 degrees: the tool face flush with the plate
# side, offsets 1.2e-12 mm apart, was kept apart from the exact plate face
# and left a pillow; docs/hybrid-robust.md F2).
def unit_r(+x: R.Real) -> Bool:
  big_zero(RP.sub(big_abs(RP.from_real(x)), RP.from_real(R.from_f32(1.0))))

def axis_exact(+n: G.Vec3) -> Bool:
  +zx = r_zero(vx(n))
  +zy = r_zero(vy(n))
  +zz = r_zero(vz(n))
  Bool.or(Bool.and(Bool.and(zx, zy), unit_r(vz(n))), Bool.or(Bool.and(Bool.and(zx, zz), unit_r(vy(n))), Bool.and(Bool.and(zy, zz), unit_r(vx(n)))))

# The normal components compare in word units (2^-149; the limit is 2^-44),
# the offsets in product units (2^-298): tau is multiplied by 1 there.
def mt.exact(+pn: G.Vec3, +po: G.Vec3, +rn: G.Vec3, +ro: G.Vec3, +tau: F32) -> Mt:
  +lim = RP.from_word(pow2(83))
  +dx = rdiff(vx(pn), vx(rn))
  +dy = rdiff(vy(pn), vy(rn))
  +dz = rdiff(vz(pn), vz(rn))
  +d = RP.sub(RP.dot(pn, po), RP.dot(rn, ro))
  +nok = Bool.and(big_within(dx, lim), Bool.and(big_within(dy, lim), big_within(dz, lim)))
  mt.fin(Bool.and(nok, big_within(d, RP.mul(RP.from_word(tau), RP.from_word(1.0)))), Bool.and(Bool.and(big_zero(dx), big_zero(dy)), Bool.and(big_zero(dz), big_zero(d))), Bool.and(axis_exact(pn), axis_exact(rn)))

def mt.if(pre: Bool, +pn: G.Vec3, +po: G.Vec3, +rn: G.Vec3, +ro: G.Vec3, +tau: F32) -> Mt:
  match pre:
    case False{}:
      MtNo{}
    case True{}:
      mt.exact(pn, po, rn, ro, tau)

def close(+a: F32, +b: F32, +lim: F32) -> Bool:
  (F32.abs((a - b : F32)) <= lim : F32)

def close_n(+p: PT, +r: PT, +lim: F32) -> Bool:
  PT{_, _, _, _, _, +px, +py, +pz} = p
  PT{_, _, _, _, _, +rx, +ry, +rz} = r
  Bool.and(close(px, rx, lim), Bool.and(close(py, ry, lim), close(pz, rz, lim)))

# F32 prefilter (normals within 2^-20, offset keys within the slack), then
# the exact test.
def mt(+p: PT, +r: PT, +tau: F32, +slack: F32) -> Mt:
  +pre = Bool.and(close(pt_key(p), pt_key(r), slack), close_n(p, r, pow2(107)))
  mt.if(pre, pt_n(p), pt_o(p), pt_n(r), pt_o(r), tau)

# --- the sweep ----------------------------------------------------------------------

def rep_p(r: Rep) -> PT:
  Rep{_, p, _} = r
  p

# Representatives whose key is below lim can match no later tag (keys
# ascend); they move to done, the rest stays in creation order.
def prune(act: List<&2, Rep>, +lim: F32, keep: List<&2, Rep>, done: List<&2, Rep>) -> List<&2, Rep> & List<&2, Rep>:
  match act:
    case Nil{}:
      (rev(Rep, keep), done)
    case +r <> t:
      +old = (pt_key(rep_p(r)) < lim : F32)
      prune(t, lim, cons_if(Rep, Bool.not(old), r, keep), cons_if(Rep, old, r, done))

def find.test(m: Mt, r: Rep, +pl: U32, acc: List<&2, Rep>) -> Fd:
  match m:
    case MtNo{}:
      Fd{False{}, 0, MtNo{}, r <> acc}
    case MtSame{}:
      Rep{+c, rp, nt} = r
      Fd{True{}, c, MtSame{}, Rep{c, rp, nt} <> acc}
    case MtNear{}:
      Rep{+c, +rp, nt} = r
      Fd{True{}, c, MtNear{}, Rep{c, rp, Bool.or(nt, U32.is_ne(pl, pt_leaf(rp)))} <> acc}

# Once a representative matched, the rest is only carried along.
def find.step(+r: Rep, +p: PT, +tau: F32, +slack: F32, st: Fd) -> Fd:
  Fd{hit, +c, m, acc} = st
  match hit:
    case True{}:
      Fd{True{}, c, m, r <> acc}
    case False{}:
      find.test(mt(p, rep_p(r), tau, slack), r, pt_leaf(p), acc)

# The first representative (in creation order) that p matches; reps come
# back in the same order.
def find(reps: List<&2, Rep>, +p: PT, +tau: F32, +slack: F32, st: Fd) -> Fd:
  match reps:
    case Nil{}:
      Fd{h, c, m, acc} = st
      Fd{h, c, m, rev(Rep, acc)}
    case +r <> t:
      find(t, p, tau, slack, find.step(r, p, tau, slack, st))

def sw.fin(f: Fd, +p: PT, done: List<&2, Rep>, asg: List<&2, Asg>, +next: U32) -> Sw:
  Fd{hit, +c, _, reps} = f
  match hit:
    case False{}:
      Sw{rev_onto(Rep, rev(Rep, reps), [Rep{next, p, False{}}]), done, Asg{pt_t(p), next} <> asg, (next + 1 : U32)}
    case True{}:
      Sw{reps, done, Asg{pt_t(p), c} <> asg, next}

def sw.pruned(kd: List<&2, Rep> & List<&2, Rep>, +p: PT, asg: List<&2, Asg>, +next: U32, +tau: F32, +slack: F32) -> Sw:
  (keep, done) = kd
  sw.fin(find(keep, p, tau, slack, Fd{False{}, 0, MtNo{}, Nil{}}), p, done, asg, next)

def sw.step(+p: PT, st: Sw, +tau: F32, +slack: F32) -> Sw:
  Sw{act, done, asg, next} = st
  sw.pruned(prune(act, (pt_key(p) - slack : F32), Nil{}, done), p, asg, next, tau, slack)

def sweep(ps: List<&2, PT>, st: Sw, +tau: F32, +slack: F32) -> Sw:
  match ps:
    case Nil{}:
      st
    case p <> t:
      sweep(t, sw.step(p, st, tau, slack), tau, slack)

# --- class bits and the per-tag masks ----------------------------------------------------

type CB is Data:
  CB{c: U32, bit: U32}

# bs: the class bits given so far; n: their number; over: unified classes
# past the 32-bit limit.
type Bits is Data:
  Bits{bs: List<&2, CB>, n: U32, over: U32}

def rep_le(a: Rep, b: Rep) -> Bool:
  Rep{ca, _, _} = a
  Rep{cb, _, _} = b
  U32.is_le(ca, cb)

def bits.take(free: Bool, +c: U32, bs: List<&2, CB>, +n: U32, +over: U32) -> Bits:
  match free:
    case True{}:
      Bits{CB{c, U32.shln(1, U32.to_nat(n))} <> bs, (n + 1 : U32), over}
    case False{}:
      Bits{bs, n, (over + 1 : U32)}

# A unified class gets the next bit while one is left; past the limit it is
# counted in over.
def bits.put(nt: Bool, +c: U32, st: Bits) -> Bits:
  match nt:
    case True{}:
      Bits{bs, +n, +over} = st
      bits.take(U32.is_lt(n, 32), c, bs, n, over)
    case False{}:
      st

# Unified classes in class order get bits 0..31.
def bits.go(rs: List<&2, Rep>, st: Bits) -> Bits:
  match rs:
    case Nil{}:
      st
    case Rep{+c, _, nt} <> t:
      bits.go(t, bits.put(nt, c, st))

def bit_of(bs: List<&2, CB>, +c: U32, acc: U32) -> U32:
  match bs:
    case Nil{}:
      acc
    case CB{+x, +b} <> t:
      bit_of(t, c, Bool.pick(U32, U32.is_eq(x, c), b, acc))

def asg_le(a: Asg, b: Asg) -> Bool:
  Asg{ta, _} = a
  Asg{tb, _} = b
  U32.is_le(ta, tb)

type Mk is Data:
  Mk{asg: List<&2, Asg>, out: List<&2, U32>}

def mk.take(hit: Bool, +ta: U32, +c: U32, rest: List<&2, Asg>, +bs: List<&2, CB>, out: List<&2, U32>) -> Mk:
  match hit:
    case True{}:
      Mk{rest, bit_of(bs, c, 0) <> out}
    case False{}:
      Mk{Asg{ta, c} <> rest, 0 <> out}

def mk.head(xs: List<&2, Asg>, +t: U32, +bs: List<&2, CB>, out: List<&2, U32>) -> Mk:
  match xs:
    case Nil{}:
      Mk{Nil{}, 0 <> out}
    case Asg{+ta, +c} <> rest:
      mk.take(U32.is_eq(ta, t), ta, c, rest, bs, out)

# The mask of every tag 0 .. nf-1 (asg sorted by tag; tags without a plane
# get 0).
def mk.go(n: Nat, +t: U32, +bs: List<&2, CB>, st: Mk) -> List<&2, U32>:
  match n:
    case 0n:
      Mk{_, out} = st
      rev(U32, out)
    case 1n+p:
      Mk{asg, out} = st
      mk.go(p, (t + 1 : U32), bs, mk.head(asg, t, bs, out))

# The plane class of every tag 0 .. nf-1 (asg sorted by tag).
def pc.take(hit: Bool, +ta: U32, +c: U32, rest: List<&2, Asg>, out: List<&2, U32>) -> Mk:
  match hit:
    case True{}:
      Mk{rest, c <> out}
    case False{}:
      Mk{Asg{ta, c} <> rest, 4294967295 <> out}

def pc.head(xs: List<&2, Asg>, +t: U32, out: List<&2, U32>) -> Mk:
  match xs:
    case Nil{}:
      Mk{Nil{}, 4294967295 <> out}
    case Asg{+ta, +c} <> rest:
      pc.take(U32.is_eq(ta, t), ta, c, rest, out)

def pc.go(n: Nat, +t: U32, st: Mk) -> List<&2, U32>:
  match n:
    case 0n:
      Mk{_, out} = st
      rev(U32, out)
    case 1n+p:
      Mk{asg, out} = st
      pc.go(p, (t + 1 : U32), pc.head(asg, t, out))

def un.fin(b: Bits, +asg: List<&2, Asg>, +nf: U32, +scale: F32, +tau: F32) -> Unified:
  Bits{+bs, +n, +over} = b
  +sa = sort(~Asg, ~asg_le, asg)
  Unified{mk.go(U32.to_nat(nf), 0, bs, Mk{sa, Nil{}}), nf, (n + over : U32), over, scale, tau, pc.go(U32.to_nat(nf), 0, Mk{sa, Nil{}})}

def un.sw(s: Sw, +nf: U32, +scale: F32, +tau: F32) -> Unified:
  Sw{act, done, asg, _} = s
  un.fin(bits.go(sort(~Rep, ~rep_le, rev_onto(Rep, done, act)), Bits{Nil{}, 0, 0}), asg, nf, scale, tau)

def un.pts(p: Pts, +scale: F32) -> Unified:
  Pts{ps, +nf} = p
  +tau = (scale * pow2(83) : F32)
  un.sw(sweep(sort(~PT, ~pt_le, ps), Sw{Nil{}, Nil{}, Nil{}, 0}, tau, (tau + scale * pow2(109) : F32)), nf, scale, tau)

# The unified plane classes of a job's face table. maxabs: an upper bound of
# the largest |coordinate| of its leaf meshes (scan).
def decide(faces: List<&2, M.FaceTag>, +maxabs: F32) -> Unified:
  un.pts(pts.go(faces, 0, Nil{}), pow2_ge(maxabs))

# Classes past the 32-bit limit, named (empty below it).
def note.over(past: Bool, +n: U32) -> String:
  match past:
    case True{}:
      "; " ++ MIO.put_u32((n - 32 : U32), " past the 32-bit class limit, decided without unification")
    case False{}:
      ""

# The refusal suffix of a job with unified classes (empty without). n: all
# unified classes (Unified.classes), digits: n in decimal.
def note(+n: U32, +digits: String) -> String:
  Bool.pick(String, U32.is_ne(n, 0), "; coplanar plane carriers unified within 2^-44*scale (" ++ digits ++ " classes" ++ note.over(U32.is_lt(32, n), n) ++ ")", "")
