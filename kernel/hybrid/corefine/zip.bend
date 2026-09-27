import Base
import ../../real.bend as R
import ../../precise.bend as G
import ./util.bend as U
import ./assemble.bend as A
import ./inter.bend as I
import ./weld.bend as W

# corefine: zipping of zero-width faces.
#
# Coincidences in the input (coplanar faces, edge-on-edge contacts, identical
# tessellations) make the symbolic perturbation create faces of zero width: all
# their vertices lie on one line (exactly, or within the rounding of the
# constructed points). Triangulating such a face can only produce slivers
# whose plane is noise. Instead the face is removed and its two long sides are
# zipped together: every halfedge of a neighbouring face that runs along the
# removed faces gets the removed faces' vertices lying strictly inside its span
# inserted, in order. No vertex moves; a face is "flat" when every vertex is
# within eps (the short-edge tolerance) of the line through its two farthest
# vertices. Adjacent flat faces (all on one line) are zipped together as one
# cluster. The result is checked like a weld (every directed edge paired once).

type FV is Data:
  FV{face: U32, vs: List<&2, U32>}

# Faces of a (face, s, e)-sorted halfedge list with their start vertices.
type FG is Data:
  FG{face: U32, cur: List<&2, U32>, acc: List<&2, FV>}

def fg.close(+f: U32, +cur: List<&2, U32>, acc: List<&2, FV>) -> List<&2, FV>:
  U.cons_if(FV, U.nonzero(U.len(U32, cur)), FV{f, cur}, acc)

def fg.if(same: Bool, +f: U32, +s: U32, g: FG) -> FG:
  match same:
    case True{}:
      FG{c, cur, acc} = g
      FG{c, s <> cur, acc}
    case False{}:
      FG{c, cur, acc} = g
      FG{f, [s], fg.close(c, cur, acc)}

def fg.step(h: A.FH, +g: FG) -> FG:
  A.FH{+f, +s, _} = h
  FG{+c, _, _} = g
  fg.if(U32.is_eq(f, c), f, s, g)

def fg.go(hs: List<&2, A.FH>, g: FG) -> FG:
  match hs:
    case Nil{}:
      g
    case h <> t:
      fg.go(t, fg.step(h, g))

def fg.fin(g: FG) -> List<&2, FV>:
  FG{c, cur, acc} = g
  U.rev(FV, fg.close(c, cur, acc))

def face_verts(+hs: List<&2, A.FH>) -> List<&2, FV>:
  fg.fin(fg.go(U.sort(~A.FH, ~A.fh_le, hs), FG{4294967295, Nil{}, Nil{}}))

# --- flatness ---------------------------------------------------------------------

def d2(+a: G.Vec3, +b: G.Vec3) -> F32:
  +d = G.sub(a, b)
  R.approx(G.dot(d, d))

type Far is Data:
  Far{v: U32, d: F32}

def farthest(vs: List<&2, U32>, +pos: U.Table<G.Vec3>, +p: G.Vec3, best: Far) -> Far:
  match vs:
    case Nil{}:
      best
    case +v <> t:
      Far{+bv, +bd} = best
      +dv = d2(U.tget(G.Vec3, pos, v, G.v3(0.0, 0.0, 0.0)), p)
      farthest(t, pos, p, Bool.pick(Far, (dv > bd : F32), Far{v, dv}, Far{bv, bd}))

def far_v(f: Far) -> U32:
  Far{v, _} = f
  v

# Squared distance of p from the line through a and b, times |b - a|^2.
def off_line(+a: G.Vec3, +b: G.Vec3, +p: G.Vec3) -> F32:
  +c = G.cross(G.sub(b, a), G.sub(p, a))
  R.approx(G.dot(c, c))

def all_near(vs: List<&2, U32>, +pos: U.Table<G.Vec3>, +a: G.Vec3, +b: G.Vec3, +lim: F32, ok: Bool) -> Bool:
  match vs ok:
    case _ False{}:
      False{}
    case Nil{} True{}:
      True{}
    case v <> t True{}:
      all_near(t, pos, a, b, lim, (off_line(a, b, U.tget(G.Vec3, pos, v, G.v3(0.0, 0.0, 0.0))) <= lim : F32))

def is_flat(+vs: List<&2, U32>, +pos: U.Table<G.Vec3>, +eps2: F32) -> Bool:
  +z = G.v3(0.0, 0.0, 0.0)
  +p0 = U.tget(G.Vec3, pos, U.tget(U32, U.table(U32, 1, vs), 0, 0), z)
  +a = far_v(farthest(vs, pos, p0, Far{0, F32.neg(1.0)}))
  +pa = U.tget(G.Vec3, pos, a, z)
  +pb = U.tget(G.Vec3, pos, far_v(farthest(vs, pos, pa, Far{a, F32.neg(1.0)})), z)
  all_near(vs, pos, pa, pb, (eps2 * d2(pb, pa) : F32), True{})

def flat_faces(fs: List<&2, FV>, +pos: U.Table<G.Vec3>, +eps2: F32, acc: List<&2, FV>) -> List<&2, FV>:
  match fs:
    case Nil{}:
      U.rev(FV, acc)
    case FV{+f, +vs} <> t:
      flat_faces(t, pos, eps2, U.cons_if(FV, is_flat(vs, pos, eps2), FV{f, vs}, acc))

# --- twins ------------------------------------------------------------------------

# A halfedge with the face of its twin.
type HT is Data:
  HT{h: A.FH, tf: U32}

def fh_face(h: A.FH) -> U32:
  A.FH{f, _, _} = h
  f

def twins.go(xs: List<&2, A.FH>, acc: List<&2, HT>) -> List<&2, HT>:
  match xs:
    case +x <> +y <> t:
      twins.go(t, HT{x, fh_face(y)} <> HT{y, fh_face(x)} <> acc)
    case _:
      acc

# Every halfedge with its twin's face (the halfedges are paired: see W.paired).
def twins(xs: List<&2, A.FH>) -> List<&2, HT>:
  twins.go(U.sort(~A.FH, ~W.gk_le, xs), Nil{})

def mark_faces(fs: List<&2, FV>, a: Array<U32>) -> Array<U32>:
  match fs:
    case Nil{}:
      a
    case FV{f, _} <> t:
      mark_faces(t, Array.set(U32, a, f, 1))

type Tw is Data:
  Tw{keep: List<&2, A.FH>, ins: List<&2, A.FH>}

# Classify each halfedge: kept as is, needing an insertion (its twin is in a
# flat face), or dropped (it is in a flat face).
def classify(hs: List<&2, HT>, +flat: U.Table<U32>, acc: Tw) -> Tw:
  match hs:
    case Nil{}:
      acc
    case HT{+h, +tf} <> t:
      Tw{keep, ins} = acc
      +f = fh_face(h)
      +hf = U.nonzero(U.tget(U32, flat, f, 0))
      +tfl = U.nonzero(U.tget(U32, flat, tf, 0))
      classify(t, flat, Tw{U.cons_if(A.FH, Bool.and(Bool.not(hf), Bool.not(tfl)), h, keep), U.cons_if(A.FH, Bool.and(Bool.not(hf), tfl), h, ins)})

# --- insertion ------------------------------------------------------------------------

type TV is Data:
  TV{t: R.Real, v: U32}

def tv_le(a: TV, b: TV) -> Bool:
  TV{ta, _} = a
  TV{tb, _} = b
  Bool.not(R.less(tb, ta))

# Vertices of flat faces strictly inside segment b -> a and within eps of its
# line, with their parameter (unnormalized: dot(v - b, a - b)).
def inside(fv: List<&2, U32>, +a: U32, +b: U32, +pa: G.Vec3, +pb: G.Vec3, +len2: R.Real, +lim: F32, +pos: U.Table<G.Vec3>, acc: List<&2, TV>) -> List<&2, TV>:
  match fv:
    case Nil{}:
      acc
    case +v <> t:
      +p = U.tget(G.Vec3, pos, v, G.v3(0.0, 0.0, 0.0))
      +tt = G.dot(G.sub(p, pb), G.sub(pa, pb))
      +ok = Bool.and(Bool.and(U32.is_ne(v, a), U32.is_ne(v, b)), Bool.and(Bool.and(R.less(U.rzero(), tt), R.less(tt, len2)), (off_line(pb, pa, p) <= lim : F32)))
      inside(t, a, b, pa, pb, len2, lim, pos, U.cons_if(TV, ok, TV{tt, v}, acc))

def dedup_tv(xs: List<&2, TV>, +last: U32, acc: List<&2, U32>) -> List<&2, U32>:
  match xs:
    case Nil{}:
      U.rev(U32, acc)
    case TV{_, +v} <> t:
      dedup_tv(t, v, U.cons_if(U32, U32.is_ne(v, last), v, acc))

def chain(vs: List<&2, U32>, +f: U32, +s: U32, +e: U32, acc: List<&2, A.FH>) -> List<&2, A.FH>:
  match vs:
    case Nil{}:
      A.FH{f, s, e} <> acc
    case +v <> t:
      chain(t, f, v, e, A.FH{f, s, v} <> acc)

def insert(hs: List<&2, A.FH>, +fv: List<&2, U32>, +pos: U.Table<G.Vec3>, +eps2: F32, acc: List<&2, A.FH>) -> List<&2, A.FH>:
  match hs:
    case Nil{}:
      acc
    case A.FH{+f, +b, +a} <> t:
      +z = G.v3(0.0, 0.0, 0.0)
      +pa = U.tget(G.Vec3, pos, a, z)
      +pb = U.tget(G.Vec3, pos, b, z)
      +d = G.sub(pa, pb)
      +len2 = G.dot(d, d)
      +mid = dedup_tv(U.sort(~TV, ~tv_le, inside(fv, a, b, pa, pb, len2, (16.0 * eps2 * R.approx(len2) : F32), pos, Nil{})), 4294967295, Nil{})
      insert(t, fv, pos, eps2, chain(mid, f, b, a, acc))

def all_vs(fs: List<&2, FV>, acc: List<&2, U32>) -> List<&2, U32>:
  match fs:
    case Nil{}:
      acc
    case FV{_, vs} <> t:
      all_vs(t, U.cat(U32, vs, acc))

def zip.go(tw: Tw, +fv: List<&2, U32>, +pos: U.Table<G.Vec3>, +eps2: F32) -> List<&2, A.FH>:
  Tw{keep, ins} = tw
  insert(ins, fv, pos, eps2, keep)

def zip.flat(+flats: List<&2, FV>, +hs: List<&2, A.FH>, +pos: U.Table<G.Vec3>, +eps2: F32, +nf: U32) -> List<&2, A.FH>:
  +flat = U.table(U32, nf, U.list_of(~U32, nf, mark_faces(flats, Array.new(U32, U.depth(nf), 0))))
  zip.go(classify(twins(hs), flat, Tw{Nil{}, Nil{}}), all_vs(flats, Nil{}), pos, eps2)

def zip.if(none: Bool, +flats: List<&2, FV>, +hs: List<&2, A.FH>, +pos: U.Table<G.Vec3>, +eps2: F32, +nf: U32) -> List<&2, A.FH>:
  match none:
    case True{}:
      hs
    case False{}:
      zip.flat(flats, hs, pos, eps2, nf)

# Remove the flat faces of a paired halfedge set and zip their sides.
# nf bounds the face ids; eps2 is the squared short-edge tolerance.
def zip(+hs: List<&2, A.FH>, +pos: U.Table<G.Vec3>, +eps2: F32, +nf: U32) -> List<&2, A.FH>:
  +flats = flat_faces(face_verts(hs), pos, eps2, Nil{})
  zip.if(U.is_zero(U.len(FV, flats)), flats, hs, pos, eps2, nf)

# --- T-junctions inside a face --------------------------------------------------------
# A face may run through one of its own vertices: vertex v lies (within eps)
# strictly inside the face's edge a -> b (a coplanar contact seen from the
# perturbation, or an X crossing of intersection curves resolved into two
# coincident vertices). The edge is split at v on both of its sides (the
# edge's twin gets the same vertices), which turns the contact into a proper
# pinch or a spike a -> v -> a; spikes cancel like 2-gons, pinches are split
# into separate loops before triangulation. No vertex moves.

# Split records: undirected edge (lo, hi) gets vertex v.
def sp_of(tvs: List<&2, TV>, +lo: U32, +hi: U32, acc: List<&2, A.FH>) -> List<&2, A.FH>:
  match tvs:
    case Nil{}:
      acc
    case TV{_, v} <> t:
      sp_of(t, lo, hi, A.FH{lo, hi, v} <> acc)

# Vertices of a face with F32 copies of their coordinates (prefilter).
type VP is Data:
  VP{v: U32, p: G.Vec3, x: F32, y: F32, z: F32}

def vps(vs: List<&2, U32>, +pos: U.Table<G.Vec3>, acc: List<&2, VP>) -> List<&2, VP>:
  match vs:
    case Nil{}:
      acc
    case +v <> t:
      +p = U.tget(G.Vec3, pos, v, G.v3(0.0, 0.0, 0.0))
      vps(t, pos, VP{v, p, R.approx(U.vx(p)), R.approx(U.vy(p)), R.approx(U.vz(p))} <> acc)

# F32 prefilter for "p near segment b -> a": parameter within the segment
# (with margin) and distance to the line below tol (tol far above the F32
# rounding of the coordinates, far below any real feature). Only survivors
# get the Real test of inside(). The differences p - b and a - b are taken in
# Reals and then rounded (as in earclip.bend): with differences of F32
# absolute coordinates a segment shorter than one F32 ulp far from the origin
# (6.1e-5 mm at 800 mm) had l2 = 0 and its T-junction was never split.
# b: the segment start (Real); bx, by, bz: its F32 copy (the sorted scan's
# key range).
type SegF is Data:
  SegF{b: G.Vec3, bx: F32, by: F32, bz: F32, dx: F32, dy: F32, dz: F32, l2: F32, tol: F32}

def near_seg(s: SegF, +p: G.Vec3) -> Bool:
  SegF{+b, _, _, _, +dx, +dy, +dz, +l2, +tol} = s
  +wx = R.approx(R.sub(U.vx(p), U.vx(b)))
  +wy = R.approx(R.sub(U.vy(p), U.vy(b)))
  +wz = R.approx(R.sub(U.vz(p), U.vz(b)))
  +t = (wx * dx + wy * dy + wz * dz : F32)
  +cx = (wy * dz - wz * dy : F32)
  +cy = (wz * dx - wx * dz : F32)
  +cz = (wx * dy - wy * dx : F32)
  +m = (tol * F32.sqrt(l2) : F32)
  Bool.and(Bool.and((t > F32.neg(m) : F32), (t < (l2 + m : F32) : F32)), ((cx * cx + cy * cy + cz * cz : F32) <= (tol * tol * l2 : F32) : F32))

def near_vs(xs: List<&2, VP>, +s: SegF, acc: List<&2, U32>) -> List<&2, U32>:
  match xs:
    case Nil{}:
      acc
    case VP{+v, p, _, _, _} <> t:
      near_vs(t, s, U.cons_if(U32, near_seg(s, p), v, acc))

# --- sorted prefilter for large faces --------------------------------------------
# A face with many vertices (a plate face with dozens of holes) would make the
# all-pairs test quadratic. Its vertices are sorted along the axis of the
# face's largest extent; an edge then scans only the vertices whose key lies
# in the edge's range widened by 2 tol (a vertex that passes near_seg lies
# within ~1.5 tol of the segment, so it is never skipped).

type SV is Data:
  SV{k: F32, vp: VP}

def sv_le(a: SV, b: SV) -> Bool:
  SV{ka, _} = a
  SV{kb, _} = b
  (ka <= kb : F32)

type Ext is Data:
  Ext{x0: F32, y0: F32, z0: F32, x1: F32, y1: F32, z1: F32}

def ext_of(xs: List<&2, VP>, e: Ext) -> Ext:
  match xs:
    case Nil{}:
      e
    case VP{_, _, +x, +y, +z} <> t:
      Ext{x0, y0, z0, x1, y1, z1} = e
      ext_of(t, Ext{F32.min(x0, x), F32.min(y0, y), F32.min(z0, z), F32.max(x1, x), F32.max(y1, y), F32.max(z1, z)})

# 0: x, 1: y, 2: z (the largest extent).
def axis_of(e: Ext) -> U32:
  Ext{x0, y0, z0, x1, y1, z1} = e
  +dx = (x1 - x0 : F32)
  +dy = (y1 - y0 : F32)
  +dz = (z1 - z0 : F32)
  Bool.pick(U32, Bool.and((dx >= dy : F32), (dx >= dz : F32)), 0, Bool.pick(U32, (dy >= dz : F32), 1, 2))

def pick3(+ax: U32, +x: F32, +y: F32, +z: F32) -> F32:
  Bool.pick(F32, U32.is_eq(ax, 0), x, Bool.pick(F32, U32.is_eq(ax, 1), y, z))

def svs(xs: List<&2, VP>, +ax: U32, acc: List<&2, SV>) -> List<&2, SV>:
  match xs:
    case Nil{}:
      acc
    case VP{v, p, +x, +y, +z} <> t:
      svs(t, ax, SV{pick3(ax, x, y, z), VP{v, p, x, y, z}} <> acc)

type Srt is Data:
  Srt{n: U32, ax: U32, t: U.Table<SV>}

def srt_of(+xs: List<&2, VP>) -> Srt:
  +n = U.len(VP, xs)
  +ax = axis_of(ext_of(xs, Ext{3.0e38, 3.0e38, 3.0e38, F32.neg(3.0e38), F32.neg(3.0e38), F32.neg(3.0e38)}))
  Srt{n, ax, U.table(SV, n, U.sort(~SV, ~sv_le, svs(xs, ax, Nil{})))}

def zsv() -> SV:
  SV{0.0, VP{0, G.v3(0.0, 0.0, 0.0), 0.0, 0.0, 0.0}}

def sv_k(s: SV) -> F32:
  SV{k, _} = s
  k

# First index whose key is >= x (keys ascending; go: lo < hi).
def lower.go(fuel: Nat, go: Bool, +lo: U32, +hi: U32, +x: F32, +t: U.Table<SV>) -> U32:
  match fuel go:
    case _ False{}:
      lo
    case 0n _:
      lo
    case 1n+p True{}:
      +mid = U32.div((lo + hi : U32), 2)
      +less = (sv_k(U.tget(SV, t, mid, zsv())) < x : F32)
      +lo2 = Bool.pick(U32, less, (mid + 1 : U32), lo)
      +hi2 = Bool.pick(U32, less, hi, mid)
      lower.go(p, U32.is_lt(lo2, hi2), lo2, hi2, x, t)

# Walk up from index i while the key is <= hi (cur is the element at i).
def scan.go(fuel: Nat, go: Bool, +i: U32, +n: U32, +hi: F32, +t: U.Table<SV>, +s: SegF, cur: SV, acc: List<&2, U32>) -> List<&2, U32>:
  match fuel go:
    case _ False{}:
      acc
    case 0n _:
      acc
    case 1n+p True{}:
      SV{_, vp} = cur
      VP{v, q, _, _, _} = vp
      +j = (i + 1 : U32)
      +nx = U.tget(SV, t, j, zsv())
      scan.go(p, Bool.and(U32.is_lt(j, n), (sv_k(nx) <= hi : F32)), j, n, hi, t, s, nx, U.cons_if(U32, near_seg(s, q), v, acc))

def seg_rng(s: SegF, +ax: U32) -> Ext:
  SegF{_, bx, by, bz, dx, dy, dz, _, +tol} = s
  +b = pick3(ax, bx, by, bz)
  +e = (b + pick3(ax, dx, dy, dz) : F32)
  +m = (2.0 * tol + (F32.abs(b) + F32.abs(e)) * 0.000001 : F32)
  Ext{(F32.min(b, e) - m : F32), 0.0, 0.0, (F32.max(b, e) + m : F32), 0.0, 0.0}

def near_sorted.k(r: Ext, +st: Srt, +s: SegF) -> List<&2, U32>:
  Ext{lo, _, _, +hi, _, _} = r
  Srt{+n, _, +t} = st
  +i = lower.go(40n, U32.is_lt(0, n), 0, n, lo, t)
  +c = U.tget(SV, t, i, zsv())
  scan.go(U32.to_nat((n + 1 : U32)), Bool.and(U32.is_lt(i, n), (sv_k(c) <= hi : F32)), i, n, hi, t, s, c, Nil{})

def near_sorted(+st: Srt, +s: SegF) -> List<&2, U32>:
  Srt{_, +ax, _} = st
  near_sorted.k(seg_rng(s, ax), st, s)

# The candidates of face_splits: all vertices (small face) or the sorted scan.
type Near is Data:
  NearAll{xs: List<&2, VP>}
  NearSorted{s: Srt}

def near_of(+xs: List<&2, VP>) -> Near:
  Bool.pick(Near, U32.is_gt(U.len(VP, xs), 48), NearSorted{srt_of(xs)}, NearAll{xs})

def near_query(nr: Near, +s: SegF) -> List<&2, U32>:
  match nr:
    case NearAll{xs}:
      near_vs(xs, s, Nil{})
    case NearSorted{st}:
      near_sorted(st, s)

def face_splits_n(hs: List<&2, A.FH>, +nr: Near, +pos: U.Table<G.Vec3>, +eps2: F32, +tol: F32, acc: List<&2, A.FH>) -> List<&2, A.FH>:
  match hs:
    case Nil{}:
      acc
    case A.FH{_, +b, +a} <> t:
      +z = G.v3(0.0, 0.0, 0.0)
      +pa = U.tget(G.Vec3, pos, a, z)
      +pb = U.tget(G.Vec3, pos, b, z)
      +d = G.sub(pa, pb)
      +len2 = G.dot(d, d)
      +bx = R.approx(U.vx(pb))
      +by = R.approx(U.vy(pb))
      +bz = R.approx(U.vz(pb))
      +dx = R.approx(U.vx(d))
      +dy = R.approx(U.vy(d))
      +dz = R.approx(U.vz(d))
      +sf = {SegF{pb, bx, by, bz, dx, dy, dz, (dx * dx + dy * dy + dz * dz : F32), tol} : SegF}
      face_splits_n(t, nr, pos, eps2, tol, sp_of(inside(near_query(nr, sf), a, b, pa, pb, len2, (16.0 * eps2 * R.approx(len2) : F32), pos, Nil{}), U32.min(a, b), U32.max(a, b), acc))

def sp_le(a: A.FH, b: A.FH) -> Bool:
  A.FH{+al, +ah, av} = a
  A.FH{+bl, +bh, bv} = b
  Bool.or(U32.is_lt(al, bl), Bool.and(U32.is_eq(al, bl), Bool.or(U32.is_lt(ah, bh), Bool.and(U32.is_eq(ah, bh), U32.is_le(av, bv)))))

# Split groups: undirected edge (lo, hi) with its (distinct) split vertices.
type SG is Data:
  SG{lo: U32, hi: U32, vs: List<&2, U32>}

type SGG is Data:
  SGG{lo: U32, hi: U32, last: U32, vs: List<&2, U32>, acc: List<&2, SG>}

def sgg.close(+lo: U32, +hi: U32, +vs: List<&2, U32>, acc: List<&2, SG>) -> List<&2, SG>:
  U.cons_if(SG, U.nonzero(U.len(U32, vs)), SG{lo, hi, vs}, acc)

def sgg.if(same: Bool, +l: U32, +h: U32, +v: U32, g: SGG) -> SGG:
  match same:
    case True{}:
      SGG{a, b, last, vs, acc} = g
      SGG{a, b, v, U.cons_if(U32, U32.is_ne(v, last), v, vs), acc}
    case False{}:
      SGG{a, b, _, vs, acc} = g
      SGG{l, h, v, [v], sgg.close(a, b, vs, acc)}

def sgg.step(+x: A.FH, +g: SGG) -> SGG:
  A.FH{+l, +h, +v} = x
  SGG{+a, +b, _, _, _} = g
  sgg.if(Bool.and(U32.is_eq(l, a), U32.is_eq(h, b)), l, h, v, g)

def sgg.go(xs: List<&2, A.FH>, g: SGG) -> SGG:
  match xs:
    case Nil{}:
      g
    case x <> t:
      sgg.go(t, sgg.step(x, g))

def sgg.fin(g: SGG) -> List<&2, SG>:
  SGG{a, b, _, vs, acc} = g
  U.rev(SG, sgg.close(a, b, vs, acc))

def split_groups(sps: List<&2, A.FH>) -> List<&2, SG>:
  sgg.fin(sgg.go(U.sort(~A.FH, ~sp_le, sps), SGG{4294967295, 4294967295, 4294967295, Nil{}, Nil{}}))

def key_lt(+al: U32, +ah: U32, +bl: U32, +bh: U32) -> Bool:
  Bool.or(U32.is_lt(al, bl), Bool.and(U32.is_eq(al, bl), U32.is_lt(ah, bh)))

def head_lt(gs: List<&2, SG>, +lo: U32, +hi: U32) -> Bool:
  match gs:
    case Nil{}:
      False{}
    case SG{l, h, _} <> _:
      key_lt(l, h, lo, hi)

def skip(gs: List<&2, SG>, drop: Bool, +lo: U32, +hi: U32) -> List<&2, SG>:
  match gs drop:
    case _ <> +t True{}:
      skip(t, head_lt(t, lo, hi), lo, hi)
    case _ _:
      gs

def params(vs: List<&2, U32>, +ps: G.Vec3, +d: G.Vec3, +pos: U.Table<G.Vec3>, acc: List<&2, TV>) -> List<&2, TV>:
  match vs:
    case Nil{}:
      acc
    case +v <> t:
      params(t, ps, d, pos, TV{G.dot(G.sub(U.tget(G.Vec3, pos, v, G.v3(0.0, 0.0, 0.0)), ps), d), v} <> acc)

def tv_ids(xs: List<&2, TV>, acc: List<&2, U32>) -> List<&2, U32>:
  match xs:
    case Nil{}:
      U.rev(U32, acc)
    case TV{_, v} <> t:
      tv_ids(t, v <> acc)

# Halfedge f: s -> e with split vertices vs, ordered from s to e.
def split_chain(+f: U32, +s: U32, +e: U32, vs: List<&2, U32>, +pos: U.Table<G.Vec3>, acc: List<&2, A.FH>) -> List<&2, A.FH>:
  +z = G.v3(0.0, 0.0, 0.0)
  +ps = U.tget(G.Vec3, pos, s, z)
  chain(tv_ids(U.sort(~TV, ~tv_le, params(vs, ps, G.sub(U.tget(G.Vec3, pos, e, z), ps), pos, Nil{})), Nil{}), f, s, e, acc)

def apply.if(same: Bool, vs: List<&2, U32>, +f: U32, +s: U32, +e: U32, +pos: U.Table<G.Vec3>, acc: List<&2, A.FH>) -> List<&2, A.FH>:
  match same:
    case True{}:
      split_chain(f, s, e, vs, pos, acc)
    case False{}:
      A.FH{f, s, e} <> acc

def apply.hit(gs: List<&2, SG>, +f: U32, +s: U32, +e: U32, +lo: U32, +hi: U32, +pos: U.Table<G.Vec3>, acc: List<&2, A.FH>) -> List<&2, A.FH>:
  match gs:
    case SG{l, h, vs} <> _:
      apply.if(Bool.and(U32.is_eq(l, lo), U32.is_eq(h, hi)), vs, f, s, e, pos, acc)
    case Nil{}:
      A.FH{f, s, e} <> acc

type AJ is Data:
  AJ{gs: List<&2, SG>, out: List<&2, A.FH>}

def apply.step(+h: A.FH, st: AJ, +pos: U.Table<G.Vec3>) -> AJ:
  A.FH{+f, +s, +e} = h
  AJ{+gs, out} = st
  +lo = U32.min(s, e)
  +hi = U32.max(s, e)
  +g2 = skip(gs, head_lt(gs, lo, hi), lo, hi)
  AJ{g2, apply.hit(g2, f, s, e, lo, hi, pos, out)}

def apply.go(hs: List<&2, A.FH>, st: AJ, +pos: U.Table<G.Vec3>) -> AJ:
  match hs:
    case Nil{}:
      st
    case h <> t:
      apply.go(t, apply.step(h, st, pos), pos)

def apply.fin(st: AJ) -> List<&2, A.FH>:
  AJ{_, out} = st
  out

# --- pinched loops ----------------------------------------------------------------------
# A face loop that visits a vertex twice (two wedges of a face touching at a
# point) is cut there into simple loops; 2-gons (spikes) are dropped.

def on_stack(xs: List<&2, U32>, +v: U32, found: Bool) -> Bool:
  match xs found:
    case _ True{}:
      True{}
    case Nil{} False{}:
      False{}
    case x <> t False{}:
      on_stack(t, v, U32.is_eq(x, v))

def head_is(xs: List<&2, U32>, +v: U32) -> Bool:
  match xs:
    case Nil{}:
      False{}
    case x <> _:
      U32.is_eq(x, v)

# Pop everything above v; returns the sub-loop (v first, in loop order) and
# the stack with v on top.
type PS is Data:
  PS{sub: List<&2, U32>, stack: List<&2, U32>}

def pop_to(xs: List<&2, U32>, hit: Bool, +v: U32, sub: List<&2, U32>) -> PS:
  match xs hit:
    case Nil{} _:
      PS{v <> sub, Nil{}}
    case x <> t True{}:
      PS{v <> sub, x <> t}
    case x <> +t False{}:
      pop_to(t, head_is(t, v), v, x <> sub)

type SL is Data:
  SL{stack: List<&2, U32>, out: List<&2, List<&2, U32>>}

def keep_loop(+l: List<&2, U32>, out: List<&2, List<&2, U32>>) -> List<&2, List<&2, U32>>:
  U.cons_if(List<&2, U32>, U32.is_ge(U.len(U32, l), 3), l, out)

def sl.pop(p: PS, out: List<&2, List<&2, U32>>) -> SL:
  PS{sub, stack} = p
  SL{stack, keep_loop(sub, out)}

def sl.if(seen: Bool, +v: U32, s: SL) -> SL:
  match seen:
    case True{}:
      SL{+st, out} = s
      sl.pop(pop_to(st, head_is(st, v), v, Nil{}), out)
    case False{}:
      SL{st, out} = s
      SL{v <> st, out}

def sl.step(+v: U32, +s: SL) -> SL:
  SL{st, _} = s
  sl.if(on_stack(st, v, False{}), v, s)

def sl.go(vs: List<&2, U32>, s: SL) -> SL:
  match vs:
    case Nil{}:
      s
    case v <> t:
      sl.go(t, sl.step(v, s))

def sl.fin(s: SL) -> List<&2, List<&2, U32>>:
  SL{st, out} = s
  keep_loop(U.rev(U32, st), out)

# The simple loops of one (possibly pinched) loop.
def split_loop(vs: List<&2, U32>) -> List<&2, List<&2, U32>>:
  sl.fin(sl.go(vs, SL{Nil{}, Nil{}}))

def split_loops(ls: List<&2, List<&2, U32>>, acc: List<&2, List<&2, U32>>) -> List<&2, List<&2, U32>>:
  match ls:
    case Nil{}:
      acc
    case l <> t:
      split_loops(t, U.cat(List<&2, U32>, split_loop(l), acc))

# --- detection from face loops (fast path) -----------------------------------------------
# The loops of every face are assembled anyway; T-junctions and flat faces
# are detected on them without another sort of all halfedges. Only when one
# is found are the halfedges repaired (tjunctions / zip) and the loops rebuilt.

def apply_splits(+hs: List<&2, A.FH>, sps: List<&2, A.FH>, +pos: U.Table<G.Vec3>) -> List<&2, A.FH>:
  +split = apply.fin(apply.go(U.sort(~A.FH, ~W.gk_le, hs), AJ{split_groups(sps), Nil{}}, pos))
  U.rev(A.FH, W.cancel(U.sort(~A.FH, ~W.fk_le, split), Nil{}))

def loop_fh.go(vs: List<&2, U32>, +f: U32, +first: U32, +prev: U32, acc: List<&2, A.FH>) -> List<&2, A.FH>:
  match vs:
    case Nil{}:
      A.FH{f, prev, first} <> acc
    case +v <> t:
      loop_fh.go(t, f, first, v, A.FH{f, prev, v} <> acc)

def loop_fh(vs: List<&2, U32>, +f: U32, acc: List<&2, A.FH>) -> List<&2, A.FH>:
  match vs:
    case Nil{}:
      acc
    case +v <> t:
      loop_fh.go(t, f, v, v, acc)

def loops_fh(ls: List<&2, List<&2, U32>>, +f: U32, acc: List<&2, A.FH>) -> List<&2, A.FH>:
  match ls:
    case Nil{}:
      acc
    case l <> t:
      loops_fh(t, f, loop_fh(l, f, acc))

def loops_vs(ls: List<&2, List<&2, U32>>, acc: List<&2, U32>) -> List<&2, U32>:
  match ls:
    case Nil{}:
      acc
    case l <> t:
      loops_vs(t, U.cat(U32, l, acc))

type Defects is Data:
  Defects{splits: List<&2, A.FH>, flats: U32}

def defects.face(+f: U32, +ls: List<&2, List<&2, U32>>, +pos: U.Table<G.Vec3>, +eps2: F32, +tol: F32, acc: Defects) -> Defects:
  Defects{sp, nf} = acc
  +vs = loops_vs(ls, Nil{})
  Defects{face_splits_n(loops_fh(ls, f, Nil{}), near_of(vps(vs, pos, Nil{})), pos, eps2, tol, sp), (nf + U.b2u(is_flat(vs, pos, eps2)) : U32)}
