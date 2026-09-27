import Base
import ../../real.bend as R
import ../../precise.bend as G
import ../mesh.bend as M
import ./util.bend as U
import ./shadow.bend as S

# corefine: operand preparation. From an indexed triangle mesh (shared vertex
# indices, counter-clockwise from outside) build
#   - halfedge pairing (halfedge h = 3 t + i runs from corner i to i + 1);
#     the operand must be a closed, consistently oriented 2-manifold: every
#     undirected edge has exactly two halfedges of opposite direction,
#   - F32 face normals and area-weighted vertex normals (symbolic tie-break
#     directions only; they never move a vertex),
#   - the kernel records (S.VRec / S.ERec / S.FRec) and conservative F32
#     bounding boxes for the broad phase,
#   - read-only lookup tables for the result assembly.

# Conservative F32 box of Real points: every bound is widened by
# 1e-6 relative + 1e-6 mm, far beyond the F32 rounding of the Real values,
# so a box test never rejects a pair whose Reals could touch.
type Box is Data:
  Box{x0: F32, y0: F32, z0: F32, x1: F32, y1: F32, z1: F32}

def pad(+a: F32) -> F32:
  (F32.abs(a) * 0.000001 + 0.000001 : F32)

def box_pt(+p: G.Vec3) -> Box:
  +x = R.approx(U.vx(p))
  +y = R.approx(U.vy(p))
  +z = R.approx(U.vz(p))
  Box{(x - pad(x) : F32), (y - pad(y) : F32), (z - pad(z) : F32), (x + pad(x) : F32), (y + pad(y) : F32), (z + pad(z) : F32)}

def box_union(a: Box, b: Box) -> Box:
  Box{ax0, ay0, az0, ax1, ay1, az1} = a
  Box{bx0, by0, bz0, bx1, by1, bz1} = b
  Box{F32.min(ax0, bx0), F32.min(ay0, by0), F32.min(az0, bz0), F32.max(ax1, bx1), F32.max(ay1, by1), F32.max(az1, bz1)}

def box_overlap(a: Box, b: Box) -> Bool:
  Box{ax0, ay0, az0, ax1, ay1, az1} = a
  Box{bx0, by0, bz0, bx1, by1, bz1} = b
  Bool.and(Bool.and((ax0 <= bx1 : F32), (bx0 <= ax1 : F32)), Bool.and(Bool.and((ay0 <= by1 : F32), (by0 <= ay1 : F32)), Bool.and((az0 <= bz1 : F32), (bz0 <= az1 : F32))))

def box_overlap_xy(a: Box, b: Box) -> Bool:
  Box{ax0, ay0, _, ax1, ay1, _} = a
  Box{bx0, by0, _, bx1, by1, _} = b
  Bool.and(Bool.and((ax0 <= bx1 : F32), (bx0 <= ax1 : F32)), Bool.and((ay0 <= by1 : F32), (by0 <= ay1 : F32)))

def box_empty() -> Box:
  Box{3.0e38, 3.0e38, 3.0e38, F32.neg(3.0e38), F32.neg(3.0e38), F32.neg(3.0e38)}

# Strictly separated on some axis (the Real boxes then cannot touch).
def box_apart(a: Box, b: Box) -> Bool:
  Bool.not(box_overlap(a, b))

type EItem is Data:
  EItem{h: U32, e: S.ERec, box: Box}

type FItem is Data:
  FItem{t: U32, f: S.FRec, box: Box}

type VItem is Data:
  VItem{v: U32, r: S.VRec, box: Box}

type Prep is Data:
  Prep{nv: U32, nt: U32, pos: U.Table<G.Vec3>, tv: U.Table<U32>, pair: U.Table<U32>, tag: U.Table<U32>, fn: U.Table<U.N3>, verts: U.Table<S.VRec>, edges: List<&2, EItem>, faces: List<&2, FItem>, box: Box}

type PrepR is Data:
  PrepOk{p: Prep}
  PrepBad{reason: String}

def next3(+h: U32) -> U32:
  Bool.pick(U32, U32.is_eq(U32.mod(h, 3), 2), (h - 2 : U32), (h + 1 : U32))

# --- halfedge pairing ---------------------------------------------------------------

type HE is Data:
  HE{lo: U32, hi: U32, h: U32, fwd: Bool}

type HP is Data:
  HP{h: U32, p: U32}

def he_le(a: HE, b: HE) -> Bool:
  HE{+alo, +ahi, ah, _} = a
  HE{+blo, +bhi, bh, _} = b
  Bool.or(U32.is_lt(alo, blo), Bool.and(U32.is_eq(alo, blo), Bool.or(U32.is_lt(ahi, bhi), Bool.and(U32.is_eq(ahi, bhi), U32.is_le(ah, bh)))))

def he_of(+h: U32, +s: U32, +e: U32) -> HE:
  HE{U32.min(s, e), U32.max(s, e), h, U32.is_lt(s, e)}

def hes.go(ts: List<&2, M.Tri>, +t: U32, acc: List<&2, HE>) -> List<&2, HE>:
  match ts:
    case Nil{}:
      acc
    case M.Tri{+a, +b, +c, _} <> rest:
      +h = (t * 3 : U32)
      hes.go(rest, (t + 1 : U32), he_of(h, a, b) <> he_of((h + 1 : U32), b, c) <> he_of((h + 2 : U32), c, a) <> acc)

# Run state over the sorted halfedges: the first two of the current run and
# its length.
type Run is Data:
  Run{a: HE, b: HE, n: U32, ok: Bool, acc: List<&2, HP>}

def same_key(a: HE, b: HE) -> Bool:
  HE{alo, ahi, _, _} = a
  HE{blo, bhi, _, _} = b
  Bool.and(U32.is_eq(alo, blo), U32.is_eq(ahi, bhi))

def push_hp(good: Bool, +ah: U32, +bh: U32, acc: List<&2, HP>) -> List<&2, HP>:
  match good:
    case True{}:
      HP{ah, bh} <> HP{bh, ah} <> acc
    case False{}:
      acc

def run.close(r: Run) -> Run:
  Run{+a, +b, +n, ok, acc} = r
  HE{+alo, ahi, +ah, +af} = a
  HE{_, _, +bh, +bf} = b
  +good = Bool.and(U32.is_eq(n, 2), Bool.and(Bool.xor(af, bf), U32.is_ne(alo, ahi)))
  Run{a, b, n, Bool.and(ok, good), push_hp(good, ah, bh, acc)}

def run.fresh(+x: HE, c: Run) -> Run:
  Run{_, _, _, ok, acc} = c
  Run{x, x, 1, ok, acc}

def run.step.if(same: Bool, +x: HE, r: Run) -> Run:
  match same:
    case True{}:
      Run{a, _, n, ok, acc} = r
      Run{a, x, (n + 1 : U32), ok, acc}
    case False{}:
      run.fresh(x, run.close(r))

def run.step(+x: HE, +r: Run) -> Run:
  Run{a, _, _, _, _} = r
  run.step.if(same_key(a, x), x, r)

def runs(xs: List<&2, HE>, r: Run) -> Run:
  match xs:
    case Nil{}:
      run.close(r)
    case x <> t:
      runs(t, run.step(x, r))

def fill_pairs(xs: List<&2, HP>, a: Array<U32>) -> Array<U32>:
  match xs:
    case Nil{}:
      a
    case HP{h, p} <> t:
      fill_pairs(t, Array.set(U32, a, h, p))

# --- normals --------------------------------------------------------------------------

type Corner is Data:
  Corner{a: U32, b: U32, c: U32, n: U.N3}

def corners(ts: List<&2, M.Tri>, +pos: U.Table<G.Vec3>, acc: List<&2, Corner>) -> List<&2, Corner>:
  match ts:
    case Nil{}:
      U.rev(Corner, acc)
    case M.Tri{+a, +b, +c, _} <> rest:
      +z = G.v3(0.0, 0.0, 0.0)
      +n = U.tri_cross(U.tget(G.Vec3, pos, a, z), U.tget(G.Vec3, pos, b, z), U.tget(G.Vec3, pos, c, z))
      corners(rest, pos, Corner{a, b, c, n} <> acc)

def upd.k(r: Array<U.N3> & U.N3, +i: U32, d: U.N3) -> Array<U.N3>:
  (a, old) = r
  Array.set(U.N3, a, i, U.nadd(old, d))

def upd(a: Array<U.N3>, +i: U32, d: U.N3) -> Array<U.N3>:
  upd.k(Array.get(U.N3, a, i), i, d)

def vn_step(c: Corner, a: Array<U.N3>) -> Array<U.N3>:
  Corner{x, y, z, +n} = c
  upd(upd(upd(a, x, n), y, n), z, n)

def vn_loop(cs: List<&2, Corner>, a: Array<U.N3>) -> Array<U.N3>:
  match cs:
    case Nil{}:
      a
    case c <> t:
      vn_loop(t, vn_step(c, a))

def face_normals(cs: List<&2, Corner>, acc: List<&2, U.N3>) -> List<&2, U.N3>:
  match cs:
    case Nil{}:
      U.rev(U.N3, acc)
    case Corner{_, _, _, n} <> t:
      face_normals(t, U.nnormalize(n) <> acc)

def vrecs(ps: List<&2, G.Vec3>, ns: List<&2, U.N3>, acc: List<&2, S.VRec>) -> List<&2, S.VRec>:
  match ps ns:
    case p <> pt n <> nt:
      vrecs(pt, nt, S.VRec{p, U.nnormalize(n), 0} <> acc)
    case _ _:
      U.rev(S.VRec, acc)

# --- unified plane classes (unify.bend) ------------------------------------------------
# Each vertex gets the OR of the class bits of its triangles' tags.

def vk.set(r: Array<U32> & U32, +i: U32, +k: U32) -> Array<U32>:
  (a, old) = r
  Array.set(U32, a, i, U32.or(old, k))

def vk.upd(a: Array<U32>, +i: U32, +k: U32) -> Array<U32>:
  vk.set(Array.get(U32, a, i), i, k)

def vk.loop(ts: List<&2, M.Tri>, +cm: U.Table<U32>, a: Array<U32>) -> Array<U32>:
  match ts:
    case Nil{}:
      a
    case M.Tri{+x, +y, +z, g} <> t:
      +k = U.tget(U32, cm, g, 0)
      vk.loop(t, cm, vk.upd(vk.upd(vk.upd(a, x, k), y, k), z, k))

def vrecs_k(ps: List<&2, G.Vec3>, ns: List<&2, U.N3>, ks: List<&2, U32>, acc: List<&2, S.VRec>) -> List<&2, S.VRec>:
  match ps ns ks:
    case p <> pt n <> nt k <> kt:
      vrecs_k(pt, nt, kt, S.VRec{p, U.nnormalize(n), k} <> acc)
    case _ _ _:
      U.rev(S.VRec, acc)

# Vertex records; without a unified class every mask is 0 (no extra pass).
def vrecs_of(on: Bool, +nv: U32, vs: List<&2, G.Vec3>, vn: List<&2, U.N3>, +ts: List<&2, M.Tri>, +cm: U.Table<U32>) -> List<&2, S.VRec>:
  match on:
    case False{}:
      vrecs(vs, vn, Nil{})
    case True{}:
      vrecs_k(vs, vn, U.list_of(~U32, nv, vk.loop(ts, cm, Array.new(U32, U.depth(nv), 0))), Nil{})

# --- records ------------------------------------------------------------------------------

type Tabs is Data:
  Tabs{vr: U.Table<S.VRec>, fn: U.Table<U.N3>, pair: U.Table<U32>}

def zvrec() -> S.VRec:
  S.VRec{G.v3(0.0, 0.0, 0.0), U.n3zero(), 0}

def ek(+e: S.ERec) -> U32:
  U32.or(S.vrec_k(S.erec_s(e)), S.vrec_k(S.erec_e(e)))

# The kernel record of the edge carrying halfedge h (from s to e).
def erec(+tb: Tabs, +h: U32, +s: U32, +e: U32) -> S.ERec:
  Tabs{+vr, +fn, +pair} = tb
  +z = zvrec()
  +zn = U.n3zero()
  +ph = U.tget(U32, pair, h, 0)
  S.ERec{U.tget(S.VRec, vr, U32.min(s, e), z), U.tget(S.VRec, vr, U32.max(s, e), z), U.nadd(U.tget(U.N3, fn, U32.div(h, 3), zn), U.tget(U.N3, fn, U32.div(ph, 3), zn))}

def ebox(+e: S.ERec) -> Box:
  box_union(box_pt(S.vrec_p(S.erec_s(e))), box_pt(S.vrec_p(S.erec_e(e))))

def push_edge(fwd: Bool, +h: U32, +e: S.ERec, acc: List<&2, EItem>) -> List<&2, EItem>:
  match fwd:
    case True{}:
      EItem{h, e, ebox(e)} <> acc
    case False{}:
      acc

type Built is Data:
  Built{es: List<&2, EItem>, fs: List<&2, FItem>}

def build.go(ts: List<&2, M.Tri>, +tb: Tabs, +t: U32, +fn: U.Table<U.N3>, es: List<&2, EItem>, fs: List<&2, FItem>) -> Built:
  match ts:
    case Nil{}:
      Built{U.rev(EItem, es), U.rev(FItem, fs)}
    case M.Tri{+a, +b, +c, _} <> rest:
      +h = (t * 3 : U32)
      +e0 = erec(tb, h, a, b)
      +e1 = erec(tb, (h + 1 : U32), b, c)
      +e2 = erec(tb, (h + 2 : U32), c, a)
      +fr = {S.FRec{U.tget(U.N3, fn, t, U.n3zero()), S.FEdge{e0, U32.is_lt(a, b)}, S.FEdge{e1, U32.is_lt(b, c)}, S.FEdge{e2, U32.is_lt(c, a)}, U32.or(ek(e0), ek(e1))} : S.FRec}
      +fb = box_union(box_union(box_pt(S.vrec_p(S.erec_s(e0))), box_pt(S.vrec_p(S.erec_e(e0)))), box_pt(S.vrec_p(S.erec_s(e1))))
      es2 = push_edge(U32.is_lt(a, b), h, e0, push_edge(U32.is_lt(b, c), (h + 1 : U32), e1, push_edge(U32.is_lt(c, a), (h + 2 : U32), e2, es)))
      build.go(rest, tb, (t + 1 : U32), fn, es2, FItem{t, fr, box_union(fb, box_pt(S.vrec_p(S.erec_e(e1))))} <> fs)

def tri_list(ts: List<&2, M.Tri>, acc: List<&2, U32>) -> List<&2, U32>:
  match ts:
    case Nil{}:
      U.rev(U32, acc)
    case M.Tri{a, b, c, _} <> t:
      tri_list(t, c <> b <> a <> acc)

def tag_list(ts: List<&2, M.Tri>, acc: List<&2, U32>) -> List<&2, U32>:
  match ts:
    case Nil{}:
      U.rev(U32, acc)
    case M.Tri{_, _, _, g} <> t:
      tag_list(t, g <> acc)

def mesh_box(vs: List<&2, G.Vec3>, acc: Box) -> Box:
  match vs:
    case Nil{}:
      acc
    case v <> t:
      mesh_box(t, box_union(acc, box_pt(v)))

def prep.done(b: Built, nv: U32, nt: U32, pos: U.Table<G.Vec3>, tv: U.Table<U32>, pair: U.Table<U32>, tag: U.Table<U32>, fn: U.Table<U.N3>, vr: U.Table<S.VRec>, bx: Box) -> Prep:
  Built{es, fs} = b
  Prep{nv, nt, pos, tv, pair, tag, fn, vr, es, fs, bx}

def prep.ok(+nv: U32, +nt: U32, +vs: List<&2, G.Vec3>, +ts: List<&2, M.Tri>, pairs: Array<U32>, +on: Bool, +cm: U.Table<U32>) -> Prep:
  +pos = U.table(G.Vec3, nv, vs)
  +cs = corners(ts, pos, Nil{})
  +fn = U.table(U.N3, nt, face_normals(cs, Nil{}))
  +vn = U.list_of(~U.N3, nv, vn_loop(cs, Array.new(U.N3, U.depth(nv), U.n3zero())))
  +vr = U.table(S.VRec, nv, vrecs_of(on, nv, vs, vn, ts, cm))
  +n3 = (nt * 3 : U32)
  +pair = U.table(U32, n3, U.list_of(~U32, n3, pairs))
  prep.done(build.go(ts, Tabs{vr, fn, pair}, 0, fn, Nil{}, Nil{}), nv, nt, pos, U.table(U32, n3, tri_list(ts, Nil{})), pair, U.table(U32, nt, tag_list(ts, Nil{})), fn, vr, mesh_box(vs, box_empty()))

def prep.fin(r: Run, +nv: U32, +nt: U32, +vs: List<&2, G.Vec3>, +ts: List<&2, M.Tri>, +on: Bool, +cm: U.Table<U32>) -> PrepR:
  Run{_, _, _, ok, acc} = r
  match ok:
    case False{}:
      PrepBad{"operand is not a closed consistently oriented 2-manifold (unpaired, repeated or degenerate edge)"}
    case True{}:
      PrepOk{prep.ok(nv, nt, vs, ts, fill_pairs(acc, Array.new(U32, U.depth((nt * 3 : U32)), 0)), on, cm)}

def prep.sorted(hs: List<&2, HE>, +nv: U32, +nt: U32, +vs: List<&2, G.Vec3>, +ts: List<&2, M.Tri>, +on: Bool, +cm: U.Table<U32>) -> PrepR:
  match hs:
    case Nil{}:
      PrepBad{"empty operand"}
    case h <> t:
      +h0 = h
      prep.fin(runs(t, Run{h0, h0, 1, True{}, Nil{}}), nv, nt, vs, ts, on, cm)

# on / cm: whether the job has unified plane classes, and the class bit mask
# of every tag (unify.bend).
def prep(m: M.Mesh, +on: Bool, +cm: U.Table<U32>) -> PrepR:
  M.Mesh{+vs, +ts} = m
  +nv = U.len(G.Vec3, vs)
  +nt = U.len(M.Tri, ts)
  prep.sorted(U.sort(~HE, ~he_le, hes.go(ts, 0, Nil{})), nv, nt, vs, ts, on, cm)
