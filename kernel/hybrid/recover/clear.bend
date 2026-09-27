import Base
import ../../real.bend as R
import ../../precise.bend as G
import ./util.bend as U
import ../mesh.bend as M3

# Clearance certificate of the "recover" prototype (docs/proto-recover.md,
# "Clearance").
#
# Recovery replaces every mesh patch by the exact face on its carrier. Each
# triangle carries h, a bound on how far the exact face may lie from it: the
# deviation on curved carriers, the measured vertex residual on planes (a
# planar triangle lies on its plane up to that residual). Two patches that
# share no mesh vertex but come closer than h + h' + 1e-6 mm (+ the F32
# rounding of the test) may turn into exact faces that touch or cross (a bore
# breaking a top face by less than the deviation, a wall thinner than the
# tolerance, two output bodies touching). The mesh cannot decide the topology
# there; recovery refuses.
#
# Method: every triangle becomes a work item that carries its own geometry
# (patch, vertex ids, exact positions, an F32 box inflated by half the
# clearance), items are sorted along a 30-bit Morton curve of their centroids
# and a balanced bounding-volume tree is built by halving (both halves forked).
# The tree is joined with itself (both subtrees forked; subtrees that lie in
# one patch are skipped, so the work concentrates at patch boundaries). A pair
# of triangles from different patches that share no mesh vertex is tested
# with the exact triangle/triangle distance (9 segment pairs, 6 vertex/face
# projections, 6 segment/triangle crossings) in F32 around a local origin
# taken from the F32x2 positions. Close pairs of patches that share a mesh
# vertex (adjacent faces, faces meeting at a corner) are expected and removed
# by a sort-join; any other close pair is a refusal.

def none() -> U32:
  4294967295

# ---------------------------------------------------------------------------
# F32 vectors (local coordinates only).

type F3 is Data:
  F3{x: F32, y: F32, z: F32}

def f3.of(+v: G.Vec3) -> F3:
  G.V3{x, y, z} = v
  F3{R.approx(x), R.approx(y), R.approx(z)}

# p - o, exact in F32x2, rounded to F32 afterwards (local coordinates).
def f3.rel(+p: G.Vec3, +o: G.Vec3) -> F3:
  f3.of(G.sub(p, o))

def f3.sub(+a: F3, +b: F3) -> F3:
  F3{ax, ay, az} = a
  F3{bx, by, bz} = b
  F3{(ax - bx : F32), (ay - by : F32), (az - bz : F32)}

def f3.add(+a: F3, +b: F3) -> F3:
  F3{ax, ay, az} = a
  F3{bx, by, bz} = b
  F3{(ax + bx : F32), (ay + by : F32), (az + bz : F32)}

def f3.scale(+a: F3, +s: F32) -> F3:
  F3{ax, ay, az} = a
  F3{(ax * s : F32), (ay * s : F32), (az * s : F32)}

def f3.dot(+a: F3, +b: F3) -> F32:
  F3{ax, ay, az} = a
  F3{bx, by, bz} = b
  (((ax * bx : F32) + (ay * by : F32) : F32) + (az * bz : F32) : F32)

def f3.cross(+a: F3, +b: F3) -> F3:
  F3{ax, ay, az} = a
  F3{bx, by, bz} = b
  F3{((ay * bz : F32) - (az * by : F32) : F32), ((az * bx : F32) - (ax * bz : F32) : F32), ((ax * by : F32) - (ay * bx : F32) : F32)}

def clamp01(+x: F32) -> F32:
  F32.max(0.0, F32.min(1.0, x))

def tiny() -> F32:
  0.000000000000000000000000000001

# ---------------------------------------------------------------------------
# Squared distances (Ericson, Real-Time Collision Detection, 5.1.9 for the
# segment pair; branches become selections, every division is guarded).

def seg_seg2(+p1: F3, +q1: F3, +p2: F3, +q2: F3) -> F32:
  +d1 = f3.sub(q1, p1)
  +d2 = f3.sub(q2, p2)
  +r = f3.sub(p1, p2)
  +a = f3.dot(d1, d1)
  +e = f3.dot(d2, d2)
  +f = f3.dot(d2, r)
  +c = f3.dot(d1, r)
  +b = f3.dot(d1, d2)
  +a1 = F32.max(a, tiny())
  +e1 = F32.max(e, tiny())
  +den = ((a * e : F32) - (b * b : F32) : F32)
  +s0 = Bool.pick(F32, (den > (0.000001 * (a * e : F32) : F32) : F32), clamp01((((b * f : F32) - (c * e : F32) : F32) / den : F32)), 0.0)
  +t0 = (((b * s0 : F32) + f : F32) / e1 : F32)
  +t = clamp01(t0)
  +s = Bool.pick(F32, (t0 < 0.0 : F32), clamp01((F32.neg(c) / a1 : F32)), Bool.pick(F32, (t0 > 1.0 : F32), clamp01(((b - c : F32) / a1 : F32)), s0))
  +w = f3.sub(f3.add(p1, f3.scale(d1, s)), f3.add(p2, f3.scale(d2, t)))
  f3.dot(w, w)

# Inside test of x against triangle (b0, b1, b2) with normal n (not unit).
def inside(+x: F3, +b0: F3, +b1: F3, +b2: F3, +n: F3) -> Bool:
  +s0 = f3.dot(f3.cross(f3.sub(b1, b0), f3.sub(x, b0)), n)
  +s1 = f3.dot(f3.cross(f3.sub(b2, b1), f3.sub(x, b1)), n)
  +s2 = f3.dot(f3.cross(f3.sub(b0, b2), f3.sub(x, b2)), n)
  Bool.and(Bool.and((s0 >= 0.0 : F32), (s1 >= 0.0 : F32)), (s2 >= 0.0 : F32))

def big() -> F32:
  1000000000000000000000000000000.0

# Squared distance from p to the triangle when its projection falls inside
# (edge cases are covered by the segment pairs); big otherwise.
def pt_face2(+p: F3, +b0: F3, +b1: F3, +b2: F3) -> F32:
  +n = f3.cross(f3.sub(b1, b0), f3.sub(b2, b0))
  +nn = f3.dot(n, n)
  +h = f3.dot(f3.sub(p, b0), n)
  Bool.pick(F32, Bool.and((nn > tiny() : F32), inside(p, b0, b1, b2, n)), ((h * h : F32) / F32.max(nn, tiny()) : F32), big())

# 0 when segment pq crosses triangle (b0, b1, b2); big otherwise.
def seg_tri(+p: F3, +q: F3, +b0: F3, +b1: F3, +b2: F3) -> F32:
  +n = f3.cross(f3.sub(b1, b0), f3.sub(b2, b0))
  +dp = f3.dot(f3.sub(p, b0), n)
  +dq = f3.dot(f3.sub(q, b0), n)
  +den = (dp - dq : F32)
  +x = f3.add(p, f3.scale(f3.sub(q, p), (dp / Bool.pick(F32, (F32.abs(den) > tiny() : F32), den, 1.0) : F32)))
  +cross = Bool.and(Bool.and((F32.abs(den) > tiny() : F32), ((dp * dq : F32) <= 0.0 : F32)), inside(x, b0, b1, b2, n))
  Bool.pick(F32, cross, 0.0, big())

def min3(+a: F32, +b: F32, +c: F32) -> F32:
  F32.min(a, F32.min(b, c))

# Distance of two triangles that do not cross: segment pairs and vertex/face
# projections.
def tt.apart(crossed: Bool, +a0: F3, +a1: F3, +a2: F3, +b0: F3, +b1: F3, +b2: F3) -> F32:
  match crossed:
    case True{}:
      0.0
    case False{}:
      +ss = min3(min3(seg_seg2(a0, a1, b0, b1), seg_seg2(a0, a1, b1, b2), seg_seg2(a0, a1, b2, b0)),
        min3(seg_seg2(a1, a2, b0, b1), seg_seg2(a1, a2, b1, b2), seg_seg2(a1, a2, b2, b0)),
        min3(seg_seg2(a2, a0, b0, b1), seg_seg2(a2, a0, b1, b2), seg_seg2(a2, a0, b2, b0)))
      +pf = F32.min(min3(pt_face2(a0, b0, b1, b2), pt_face2(a1, b0, b1, b2), pt_face2(a2, b0, b1, b2)),
        min3(pt_face2(b0, a0, a1, a2), pt_face2(b1, a0, a1, a2), pt_face2(b2, a0, a1, a2)))
      F32.min(ss, pf)

# Exact (F32) squared distance of triangles (a0, a1, a2) and (b0, b1, b2):
# 0 when a segment of one crosses the other (the 6 crossings are tested
# first, and the other 15 terms only when there is none; the minimum is the
# same either way).
def tri_tri2(+a0: F3, +a1: F3, +a2: F3, +b0: F3, +b1: F3, +b2: F3) -> F32:
  +st = F32.min(min3(seg_tri(a0, a1, b0, b1, b2), seg_tri(a1, a2, b0, b1, b2), seg_tri(a2, a0, b0, b1, b2)),
    min3(seg_tri(b0, b1, a0, a1, a2), seg_tri(b1, b2, a0, a1, a2), seg_tri(b2, b0, a0, a1, a2)))
  tt.apart((st < 1.0 : F32), a0, a1, a2, b0, b1, b2)

# ---------------------------------------------------------------------------
# Work items and boxes.

type Box is Data:
  Box{x0: F32, y0: F32, z0: F32, x1: F32, y1: F32, z1: F32}

type CT is Data:
  CT{p: U32, a: U32, b: U32, c: U32, pa: G.Vec3, pb: G.Vec3, pc: G.Vec3, h: F32, bx: Box}

def lo3(+a: F32, +b: F32, +c: F32) -> F32:
  F32.min(a, F32.min(b, c))

def hi3(+a: F32, +b: F32, +c: F32) -> F32:
  F32.max(a, F32.max(b, c))

# Half the clearance plus the F32 rounding of the coordinates (relative
# 2^-23, taken generously as 1e-6).
def pad(+lo: F32, +hi: F32, +h: F32) -> F32:
  (h + ((F32.abs(lo) + F32.abs(hi) : F32) * 0.000001 : F32) : F32)

def box.of3(a: F3, b: F3, c: F3, +h: F32) -> Box:
  F3{+ax, +ay, +az} = a
  F3{+bx, +by, +bz} = b
  F3{+cx, +cy, +cz} = c
  +x0 = lo3(ax, bx, cx)
  +x1 = hi3(ax, bx, cx)
  +y0 = lo3(ay, by, cy)
  +y1 = hi3(ay, by, cy)
  +z0 = lo3(az, bz, cz)
  +z1 = hi3(az, bz, cz)
  +px = pad(x0, x1, h)
  +py = pad(y0, y1, h)
  +pz = pad(z0, z1, h)
  Box{(x0 - px : F32), (y0 - py : F32), (z0 - pz : F32), (x1 + px : F32), (y1 + py : F32), (z1 + pz : F32)}

def box.of(+pa: G.Vec3, +pb: G.Vec3, +pc: G.Vec3, +h: F32) -> Box:
  box.of3(f3.of(pa), f3.of(pb), f3.of(pc), h)

# Absolute part of the clearance margin (mm).
def margin() -> F32:
  0.000001

def ct.of(+p: U32, +a: U32, +b: U32, +c: U32, +pa: G.Vec3, +pb: G.Vec3, +pc: G.Vec3, +h: F32) -> CT:
  CT{p, a, b, c, pa, pb, pc, h, box.of(pa, pb, pc, (h + margin() : F32))}

def box.union(+a: Box, +b: Box) -> Box:
  Box{ax0, ay0, az0, ax1, ay1, az1} = a
  Box{bx0, by0, bz0, bx1, by1, bz1} = b
  Box{F32.min(ax0, bx0), F32.min(ay0, by0), F32.min(az0, bz0), F32.max(ax1, bx1), F32.max(ay1, by1), F32.max(az1, bz1)}

def box.meets(+a: Box, +b: Box) -> Bool:
  Box{ax0, ay0, az0, ax1, ay1, az1} = a
  Box{bx0, by0, bz0, bx1, by1, bz1} = b
  Bool.and(Bool.and(Bool.and((ax0 <= bx1 : F32), (bx0 <= ax1 : F32)), Bool.and((ay0 <= by1 : F32), (by0 <= ay1 : F32))),
    Bool.and((az0 <= bz1 : F32), (bz0 <= az1 : F32)))

def ct.box(+t: CT) -> Box:
  CT{_, _, _, _, _, _, _, _, b} = t
  b

def ct.p(+t: CT) -> U32:
  CT{p, _, _, _, _, _, _, _, _} = t
  p

def ct.h(+t: CT) -> F32:
  CT{_, _, _, _, _, _, _, h, _} = t
  h

def box.empty() -> Box:
  Box{big(), big(), big(), F32.neg(big()), F32.neg(big()), F32.neg(big())}

# ---------------------------------------------------------------------------
# Morton order of the centroids (10 bits per axis).

def spread(+v: U32) -> U32:
  +a = U32.and(U32.or(v, U32.shln(v, 16n)), 50331903)
  +b = U32.and(U32.or(a, U32.shln(a, 8n)), 50393103)
  +c = U32.and(U32.or(b, U32.shln(b, 4n)), 51130563)
  U32.and(U32.or(c, U32.shln(c, 2n)), 153391689)

def cell(+x: F32, +lo: F32, +scale: F32) -> U32:
  F32.to_u32(F32.max(0.0, F32.min(1023.0, F32.floor(((x - lo : F32) * scale : F32)))))

def centre(+b: Box) -> F3:
  Box{x0, y0, z0, x1, y1, z1} = b
  F3{((x0 + x1 : F32) * 0.5 : F32), ((y0 + y1 : F32) * 0.5 : F32), ((z0 + z1 : F32) * 0.5 : F32)}

def box.point(c: F3) -> Box:
  F3{+x, +y, +z} = c
  Box{x, y, z, x, y, z}

def cbox.go(xs: List<&2, CT>, acc: Box) -> Box:
  match xs:
    case Nil{}:
      acc
    case +t <> rest:
      cbox.go(rest, box.union(acc, box.point(centre(ct.box(t)))))

def morton(+c: F3, +b: Box) -> U32:
  F3{x, y, z} = c
  Box{x0, y0, z0, x1, y1, z1} = b
  +ext = F32.max(F32.max((x1 - x0 : F32), (y1 - y0 : F32)), F32.max((z1 - z0 : F32), 0.000000001))
  +scale = (1023.0 / ext : F32)
  U32.or(U32.or(U32.shln(spread(cell(x, x0, scale)), 2n), U32.shln(spread(cell(y, y0, scale)), 1n)), spread(cell(z, z0, scale)))

# Bucket sort of the items by the top d bits of their Morton code (2^d >= n
# buckets, one pass into an Array, read out in order): O(n), no comparisons.
# Order inside a bucket does not matter to the tree.
def bucket(+t: CT, +b: Box, +d: Nat) -> U32:
  U32.shrn(morton(centre(ct.box(t)), b), Nat.sub(30n, d))

def fill.go(xs: List<&2, CT>, +b: Box, +d: Nat, st: Array<List<&2, CT>> & List<&2, CT>, +pending: CT) -> Array<List<&2, CT>>:
  match xs:
    case Nil{}:
      (arr, lst) = st
      Array.set(List<&2, CT>, arr, bucket(pending, b, d), pending <> lst)
    case +x <> rest:
      (arr, lst) = st
      arr2 = Array.set(List<&2, CT>, arr, bucket(pending, b, d), pending <> lst)
      fill.go(rest, b, d, Array.get(List<&2, CT>, arr2, bucket(x, b, d)), x)

def flat.go(a: Array<List<&2, CT>>, acc: List<&2, CT>) -> List<&2, CT>:
  match a:
    case ALeaf{xs}:
      M3.rev_onto(CT, xs, acc)
    case ANode{l, r}:
      flat.go(l, flat.go(r, acc))

def morton_sort(xs: List<&2, CT>, +b: Box, +d: Nat) -> List<&2, CT>:
  match xs:
    case Nil{}:
      Nil{}
    case +x <> rest:
      +empty = {Nil{} : List<&2, CT>}
      flat.go(fill.go(rest, b, d, Array.get(List<&2, CT>, Array.new(List<&2, CT>, d, empty), bucket(x, b, d)), x), Nil{})

# ---------------------------------------------------------------------------
# Bounding-volume tree (leaves of at most 4 items; u = the patch of every
# item below, or none()).

type BV is Data:
  BLeaf{bx: Box, u: U32, xs: List<&2, CT>}
  BNode{bx: Box, u: U32, l: BV, r: BV}

def bv.box(+n: BV) -> Box:
  match n:
    case BLeaf{b, _, _}:
      b
    case BNode{b, _, _, _}:
      b

def bv.u(+n: BV) -> U32:
  match n:
    case BLeaf{_, u, _}:
      u
    case BNode{_, u, _, _}:
      u

def uni(+a: U32, +b: U32) -> U32:
  Bool.pick(U32, U32.is_eq(a, b), a, none())

# 4294967294 marks "no item yet".
def leaf.go(xs: List<&2, CT>, bx: Box, +u: U32, acc: List<&2, CT>) -> BV:
  match xs:
    case Nil{}:
      BLeaf{bx, u, acc}
    case +t <> rest:
      leaf.go(rest, box.union(bx, ct.box(t)), Bool.pick(U32, U32.is_eq(u, 4294967294), ct.p(t), uni(u, ct.p(t))), t <> acc)

def bv.leaf(xs: List<&2, CT>) -> BV:
  leaf.go(xs, box.empty(), 4294967294, Nil{})

def bv.join(+a: BV, +b: BV) -> BV:
  BNode{box.union(bv.box(a), bv.box(b)), uni(bv.u(a), bv.u(b)), a, b}

def few(+n: Nat) -> Bool:
  Nat.is_le(n, 4n)

def bv.flat(p: U.Two<&2, CT>) -> BV:
  U.Two{l, r, _, _} = p
  bv.leaf(List.append(&2, CT, l, r))

# p is the halving of the current item list; leafy: at most 4 items.
def bv.build(+fuel: Nat, leafy: Bool, p: U.Two<&2, CT>) -> BV:
  match fuel leafy:
    case 0n _:
      bv.flat(p)
    case _ True{}:
      bv.flat(p)
    case 1n+f False{}:
      U.Two{l, r, +nl, +nr} = p
      a b = bv.build(f, few(nl), U.two(CT, l, nl)) bv.build(f, few(nr), U.two(CT, r, nr))
      bv.join(a, b)


# ---------------------------------------------------------------------------
# Related (vertex-sharing) patch pairs as a read-only hash table: 2^k buckets
# of short lists, so a triangle pair of adjacent faces is skipped before any
# distance is computed.

type RT is Data:
  RT{tab: U.Tab<&2, List<&2, U.Q>>, k: Nat}

def hash(+p: U32, +q: U32, +k: Nat) -> U32:
  U32.shrn((((p * 2654435761 : U32) + (q * 40503 : U32)) : U32), Nat.sub(32n, k))

def rt.put(st: Array<List<&2, U.Q>> & List<&2, U.Q>, +h: U32, x: U.Q) -> Array<List<&2, U.Q>>:
  (arr, lst) = st
  Array.set(List<&2, U.Q>, arr, h, x <> lst)

def rt.fill(xs: List<&2, U.Q>, +k: Nat, arr: Array<List<&2, U.Q>>) -> Array<List<&2, U.Q>>:
  match xs:
    case Nil{}:
      arr
    case U.Q{+p, +q, _, _} <> t:
      +h = hash(p, q, k)
      rt.fill(t, k, rt.put(Array.get(List<&2, U.Q>, arr, h), h, U.Q{p, q, 0, 0}))

def rt.flat(a: Array<List<&2, U.Q>>, acc: List<&2, List<&2, U.Q>>) -> List<&2, List<&2, U.Q>>:
  match a:
    case ALeaf{xs}:
      xs <> acc
    case ANode{l, r}:
      rt.flat(l, rt.flat(r, acc))

def rt.of(xs: List<&2, U.Q>, +n: U32) -> RT:
  +k = Nat.min(Nat.add(U.depth(n), 1n), 24n)
  +empty = {Nil{} : List<&2, U.Q>}
  RT{U.tab.of(List<&2, U.Q>, rt.flat(rt.fill(xs, k, Array.new(List<&2, U.Q>, k, empty)), Nil{}), k, empty), k}

def rt.scan(xs: List<&2, U.Q>, +p: U32, +q: U32) -> Bool:
  match xs:
    case Nil{}:
      False{}
    case U.Q{a, b, _, _} <> t:
      Bool.or(Bool.and(U32.is_eq(a, p), U32.is_eq(b, q)), rt.scan(t, p, q))

def rt.has(+r: RT, +p: U32, +q: U32) -> Bool:
  RT{tab, +k} = r
  rt.scan(U.tab.get(List<&2, U.Q>, tab, k, hash(p, q, k)), p, q)

# ---------------------------------------------------------------------------
# Self-join. Hits are Q{min patch, max patch, F32 bits of the distance, 1}.

def shares(+t: CT, +s: CT) -> Bool:
  CT{_, +a, +b, +c, _, _, _, _, _} = t
  CT{_, +x, +y, +z, _, _, _, _, _} = s
  +ha = Bool.or(U32.is_eq(a, x), Bool.or(U32.is_eq(a, y), U32.is_eq(a, z)))
  +hb = Bool.or(U32.is_eq(b, x), Bool.or(U32.is_eq(b, y), U32.is_eq(b, z)))
  +hc = Bool.or(U32.is_eq(c, x), Bool.or(U32.is_eq(c, y), U32.is_eq(c, z)))
  Bool.or(ha, Bool.or(hb, hc))

def f3.norm1(+a: F3) -> F32:
  F3{x, y, z} = a
  F32.max(F32.abs(x), F32.max(F32.abs(y), F32.abs(z)))

# Squared distance and the F32 rounding allowance of the local frame
# (1e-6 x the largest local coordinate, about 8 ulps).
type DE is Data:
  DE{d2: F32, err: F32}

# Quick reject: all three vertices of one triangle lie on one side of the
# other's plane, farther than thr (a separating plane, so the distance is
# larger). Returns thr^2 (a miss) when separated, else the exact distance.
def side(+p: F3, +o: F3, +n: F3, +nl: F32) -> F32:
  (f3.dot(f3.sub(p, o), n) / nl : F32)

def apart(+a0: F3, +a1: F3, +a2: F3, +b0: F3, +b1: F3, +b2: F3, +thr: F32) -> Bool:
  +n = f3.cross(f3.sub(b1, b0), f3.sub(b2, b0))
  +nl = F32.max(F32.sqrt(f3.dot(n, n)), tiny())
  +d0 = side(a0, b0, n, nl)
  +d1 = side(a1, b0, n, nl)
  +d2 = side(a2, b0, n, nl)
  Bool.or(Bool.and(Bool.and((d0 > thr : F32), (d1 > thr : F32)), (d2 > thr : F32)),
    Bool.and(Bool.and((d0 < F32.neg(thr) : F32), (d1 < F32.neg(thr) : F32)), (d2 < F32.neg(thr) : F32)))

def dist.k(far: Bool, +a1: F3, +a2: F3, +b0: F3, +b1: F3, +b2: F3, +thr: F32) -> F32:
  match far:
    case True{}:
      (thr * thr : F32)
    case False{}:
      tri_tri2(F3{0.0, 0.0, 0.0}, a1, a2, b0, b1, b2)

def dist.local(+a1: F3, +a2: F3, +b0: F3, +b1: F3, +b2: F3, +thr: F32) -> DE:
  +ext = F32.max(F32.max(f3.norm1(a1), f3.norm1(a2)), F32.max(f3.norm1(b0), F32.max(f3.norm1(b1), f3.norm1(b2))))
  +err = (ext * 0.000001 : F32)
  +t2 = (thr + err : F32)
  +z = {F3{0.0, 0.0, 0.0} : F3}
  +far = Bool.or(apart(z, a1, a2, b0, b1, b2, t2), apart(b0, b1, b2, z, a1, a2, t2))
  DE{dist.k(far, a1, a2, b0, b1, b2, t2), err}

def dist2(+t: CT, +s: CT) -> DE:
  CT{_, _, _, _, +pa, +pb, +pc, +h1, _} = t
  CT{_, _, _, _, +qa, +qb, +qc, +h2, _} = s
  dist.local(f3.rel(pb, pa), f3.rel(pc, pa), f3.rel(qa, pa), f3.rel(qb, pa), f3.rel(qc, pa), ((h1 + h2 : F32) + margin() : F32))

# The last field is 2 when the triangles touch or cross (distance within the
# rounding allowance of the local frame), 1 otherwise; check() treats both
# alike, close() reports the difference.
def hit.of(de: DE, +t: CT, +s: CT, acc: List<&2, U.Q>) -> List<&2, U.Q>:
  DE{+d2, +err} = de
  +thr = ((((ct.h(t) + ct.h(s) : F32) + margin() : F32) + err : F32))
  +p = ct.p(t)
  +q = ct.p(s)
  +acc2 = acc
  +k = Bool.pick(U32, (d2 <= (err * err : F32) : F32), 2, 1)
  Bool.pick(List<&2, U.Q>, (d2 < (thr * thr : F32) : F32), U.Q{U32.min(p, q), U32.max(p, q), F32.bits(F32.sqrt(d2)), k} <> acc2, acc2)

def hit.k(test: Bool, +t: CT, +s: CT, acc: List<&2, U.Q>) -> List<&2, U.Q>:
  match test:
    case False{}:
      acc
    case True{}:
      hit.of(dist2(t, s), t, s, acc)

def pair.rel(test: Bool, +t: CT, +s: CT, +rel: RT, acc: List<&2, U.Q>) -> List<&2, U.Q>:
  match test:
    case False{}:
      acc
    case True{}:
      +p = ct.p(t)
      +q = ct.p(s)
      hit.k(Bool.not(rt.has(rel, U32.min(p, q), U32.max(p, q))), t, s, acc)

def pair(+t: CT, +s: CT, +rel: RT, acc: List<&2, U.Q>) -> List<&2, U.Q>:
  +test = Bool.and(Bool.and(U32.is_ne(ct.p(t), ct.p(s)), box.meets(ct.box(t), ct.box(s))), Bool.not(shares(t, s)))
  pair.rel(test, t, s, rel, acc)

def one_many(+t: CT, ys: List<&2, CT>, +rel: RT, acc: List<&2, U.Q>) -> List<&2, U.Q>:
  match ys:
    case Nil{}:
      acc
    case +s <> rest:
      one_many(t, rest, rel, pair(t, s, rel, acc))

def many_many(xs: List<&2, CT>, +ys: List<&2, CT>, +rel: RT, acc: List<&2, U.Q>) -> List<&2, U.Q>:
  match xs:
    case Nil{}:
      acc
    case +t <> rest:
      many_many(rest, ys, rel, one_many(t, ys, rel, acc))

def within(xs: List<&2, CT>, +rel: RT, acc: List<&2, U.Q>) -> List<&2, U.Q>:
  match xs:
    case Nil{}:
      acc
    case +t <> +rest:
      within(rest, rel, one_many(t, rest, rel, acc))

# Tail-recursive concatenation (the JS target has a bounded stack).
def cat(xs: List<&2, U.Q>, ys: List<&2, U.Q>) -> List<&2, U.Q>:
  List.reverse.go(&2, U.Q, List.reverse(&2, U.Q, xs), ys)

# A pair of subtrees needs work unless both lie in one patch or their boxes
# (already inflated by half the clearance) are apart.
def cgo(+a: BV, +b: BV) -> Bool:
  +u = bv.u(a)
  Bool.and(Bool.not(Bool.and(U32.is_ne(u, none()), U32.is_eq(u, bv.u(b)))), box.meets(bv.box(a), bv.box(b)))

# Sequential join below the fork levels (plain lets: no simultaneous
# binding, so deep subtrees stay on one worker and shared upper nodes are not
# touched by every lane).
def cross.s(+fuel: Nat, go: Bool, +x: BV, +y: BV, +rel: RT) -> List<&2, U.Q>:
  match fuel go:
    case 0n _:
      Nil{}
    case _ False{}:
      Nil{}
    case 1n+f True{}:
      match x y:
        case BLeaf{_, _, xs} BLeaf{_, _, ys}:
          many_many(xs, ys, rel, Nil{})
        case BNode{_, _, xl, xr} BLeaf{_, _, _}:
          cat(cross.s(f, cgo(xl, y), xl, y, rel), cross.s(f, cgo(xr, y), xr, y, rel))
        case BLeaf{_, _, _} BNode{_, _, yl, yr}:
          cat(cross.s(f, cgo(x, yl), x, yl, rel), cross.s(f, cgo(x, yr), x, yr, rel))
        case BNode{_, _, xl, xr} BNode{_, _, yl, yr}:
          cat(cat(cross.s(f, cgo(xl, yl), xl, yl, rel), cross.s(f, cgo(xr, yr), xr, yr, rel)),
            cat(cross.s(f, cgo(xl, yr), xl, yr, rel), cross.s(f, cgo(xr, yl), xr, yl, rel)))

# Forked join: par more fork levels (2 or 4 lanes each), then cross.s.
def cross(+par: Nat, +fuel: Nat, go: Bool, +x: BV, +y: BV, +rel: RT) -> List<&2, U.Q>:
  match par fuel go:
    case _ 0n _:
      Nil{}
    case _ _ False{}:
      Nil{}
    case 0n _ True{}:
      cross.s(fuel, True{}, x, y, rel)
    case 1n+q 1n+f True{}:
      match x y:
        case BLeaf{_, _, xs} BLeaf{_, _, ys}:
          many_many(xs, ys, rel, Nil{})
        case BNode{_, _, xl, xr} BLeaf{_, _, _}:
          a b = cross(q, f, cgo(xl, y), xl, y, rel) cross(q, f, cgo(xr, y), xr, y, rel)
          cat(a, b)
        case BLeaf{_, _, _} BNode{_, _, yl, yr}:
          a b = cross(q, f, cgo(x, yl), x, yl, rel) cross(q, f, cgo(x, yr), x, yr, rel)
          cat(a, b)
        case BNode{_, _, xl, xr} BNode{_, _, yl, yr}:
          a b = cross(q, f, cgo(xl, yl), xl, yl, rel) cross(q, f, cgo(xr, yr), xr, yr, rel)
          c d = cross(q, f, cgo(xl, yr), xl, yr, rel) cross(q, f, cgo(xr, yl), xr, yl, rel)
          cat(cat(a, b), cat(c, d))

def sgo(+n: BV) -> Bool:
  U32.is_eq(bv.u(n), none())

def self.s(+fuel: Nat, go: Bool, +n: BV, +rel: RT) -> List<&2, U.Q>:
  match fuel go:
    case 0n _:
      Nil{}
    case _ False{}:
      Nil{}
    case 1n+f True{}:
      match n:
        case BLeaf{_, _, xs}:
          within(xs, rel, Nil{})
        case BNode{_, _, l, r}:
          cat(cat(self.s(f, sgo(l), l, rel), self.s(f, sgo(r), r, rel)), cross.s(Nat.add(f, f), cgo(l, r), l, r, rel))

def self(+par: Nat, +fuel: Nat, go: Bool, +n: BV, +rel: RT) -> List<&2, U.Q>:
  match par fuel go:
    case _ 0n _:
      Nil{}
    case _ _ False{}:
      Nil{}
    case 0n _ True{}:
      self.s(fuel, True{}, n, rel)
    case 1n+q 1n+f True{}:
      match n:
        case BLeaf{_, _, xs}:
          within(xs, rel, Nil{})
        case BNode{_, _, l, r}:
          a b = self(q, f, sgo(l), l, rel) self(q, f, sgo(r), r, rel)
          cat(cat(a, b), cross(q, Nat.add(f, f), cgo(l, r), l, r, rel))

# Fork levels of the self-join (2^5 = 32 lanes at the top, >= 18 cores).
def par_depth() -> Nat:
  5n

# ---------------------------------------------------------------------------
# Verdict: the closest pair of patches that share no mesh vertex.

type Clr is Data:
  Clr{hit: Bool, p: U32, q: U32, d: F32, pairs: U32}

def f32_of(x: U32) -> F32:
  match x:
    case U32{w}:
      F32{w}

def b2u(b: Bool) -> U32:
  Bool.pick(U32, b, 1, 0)

# Related pairs are Q{p, q, 0, 0} and sort before every hit Q{p, q, d, 1} of
# the same pair; a hit counts unless its pair was just seen as related.
def scan(xs: List<&2, U.Q>, +rp: U32, +rq: U32, st: Clr) -> Clr:
  match xs:
    case Nil{}:
      st
    case U.Q{+p, +q, +d, +k} <> t:
      Clr{+hit, +bp, +bq, +bd, +n} = st
      +related = U32.is_eq(k, 0)
      +counts = Bool.and(Bool.not(related), Bool.not(Bool.and(U32.is_eq(p, rp), U32.is_eq(q, rq))))
      +dd = f32_of(d)
      +better = Bool.and(counts, Bool.or(Bool.not(hit), (dd < bd : F32)))
      scan(t, Bool.pick(U32, related, p, rp), Bool.pick(U32, related, q, rq),
        Clr{Bool.or(hit, counts), Bool.pick(U32, better, p, bp), Bool.pick(U32, better, q, bq), Bool.pick(F32, better, dd, bd), (n + b2u(counts) : U32)})

# Related (vertex-sharing) patch pairs from the patch lists of the boundary
# vertices.
def rel.one(+p: U32, qs: List<&2, U32>, acc: List<&2, U.Q>) -> List<&2, U.Q>:
  match qs:
    case Nil{}:
      acc
    case +q <> t:
      rel.one(p, t, U.Q{U32.min(p, q), U32.max(p, q), 0, 0} <> acc)

def rel.all(ps: List<&2, U32>, acc: List<&2, U.Q>) -> List<&2, U.Q>:
  match ps:
    case Nil{}:
      acc
    case +p <> +t:
      rel.all(t, rel.one(p, t, acc))

def fuel.of(+n: U32) -> Nat:
  Nat.add(Nat.add(U.depth(n), U.depth(n)), 8n)

# items: one CT per triangle; related: vertex-sharing patch pairs Q{p, q, 0, 0}
# (any order, duplicates allowed).
def check(items: List<&2, CT>, +n: U32, related: List<&2, U.Q>) -> Clr:
  +xs = items
  +cb = cbox.go(xs, box.empty())
  +d = U.depth(n)
  +sorted = morton_sort(xs, cb, Nat.min(d, 30n))
  +nn = U32.to_nat(n)
  +tree = bv.build(Nat.add(d, 2n), few(nn), U.two(CT, sorted, nn))
  +rels = related
  +rel = rt.of(rels, U.count(U.Q, rels, 0))
  scan(U.sort(cat(rels, self(par_depth(), fuel.of(n), sgo(tree), tree, rel))), none(), none(), Clr{False{}, 0, 0, 0.0, 0})

# Every close pair instead of the closest one: hits Q{min patch, max patch,
# F32 bits of the distance, 2 if the triangles touch or cross else 1}, sorted,
# one per close triangle pair; related patch pairs and vertex-sharing
# triangles are skipped as in check().
def close(items: List<&2, CT>, +n: U32, related: List<&2, U.Q>) -> List<&2, U.Q>:
  +xs = items
  +cb = cbox.go(xs, box.empty())
  +d = U.depth(n)
  +sorted = morton_sort(xs, cb, Nat.min(d, 30n))
  +nn = U32.to_nat(n)
  +tree = bv.build(Nat.add(d, 2n), few(nn), U.two(CT, sorted, nn))
  +rels = related
  +rel = rt.of(rels, U.count(U.Q, rels, 0))
  U.sort(self(par_depth(), fuel.of(n), sgo(tree), tree, rel))

# The balanced tree of an item list (as in check() and close()).
def tree.of(items: List<&2, CT>, +n: U32) -> BV:
  +xs = items
  +cb = cbox.go(xs, box.empty())
  +d = U.depth(n)
  +sorted = morton_sort(xs, cb, Nat.min(d, 30n))
  +nn = U32.to_nat(n)
  bv.build(Nat.add(d, 2n), few(nn), U.two(CT, sorted, nn))

def close2.go(any: Bool, +xs: List<&2, CT>, +nx: U32, +ys: List<&2, CT>, +ny: U32) -> List<&2, U.Q>:
  match any:
    case False{}:
      Nil{}
    case True{}:
      +a = tree.of(xs, nx)
      +b = tree.of(ys, ny)
      +rel = rt.of(Nil{}, 0)
      +par = Bool.pick(Nat, U32.is_lt((nx + ny : U32), 4096), 0n, par_depth())
      U.sort(cross(par, Nat.add(fuel.of(nx), fuel.of(ny)), cgo(a, b), a, b, rel))

# Two item sets (tangent.bend: result triangles against leaf triangles):
# every close pair of one item from each set, reported as close() does. No
# pair inside one set is visited, so the join costs only the traversal
# between the two trees. Below 4096 items it runs on one worker (forking
# small joins costs more than it saves).
def close2(xs: List<&2, CT>, +nx: U32, ys: List<&2, CT>, +ny: U32) -> List<&2, U.Q>:
  close2.go(Bool.and(U32.is_ne(nx, 0), U32.is_ne(ny, 0)), xs, nx, ys, ny)
