import Base
import ../../real.bend as R
import ../../precise.bend as G
import ../mesh.bend as M
import ./util.bend as U
import ./geom.bend as S
import ./clear.bend as C
import ./topo.bend as P

# Pre-certificate of the "recover" prototype (docs/proto-recover.md,
# "Near-tangent leaves"; docs/hybrid-boolean-plan.md step 2): no silent
# topology below the deviation.
#
# A mesh Boolean decides topology at the tessellation deviation. Where two
# faces of different leaves come within the deviation of each other (a tool
# face grazing a cylinder, crossed rods, a plane shaving a torus or a cone, a
# boss 0.005 mm wider than its bar), the inscribed tessellations may miss a
# crossing the exact faces have, or invent one they do not have. The mesh
# result is then a valid solid of the wrong topology, or an empty one where a
# sliver of material exists, and recovery would make it exact.
#
# Test, for every pair of carriers (carrier classes, topo.bend) of faces from
# different leaves; faces of different leaves on one carrier are coincident
# and resolved exactly by the mesh Boolean:
#   - The leaf tessellations go through the clear.bend distance join (every
#     leaf triangle is an item; triangles of one leaf, or of one carrier,
#     are never compared). A pair is close when its tessellations come within
#     h1 + h2 + 1e-6 mm, h = deviation on curved carriers and 0 on planes.
#   - A close pair whose tessellations touch or cross somewhere has a
#     crossing the mesh Boolean decided; it is kept even when a third operand
#     removed it from the result (a bore through a counterbore floor), unless
#     the removal is itself undecided (below).
#   - A close pair whose tessellations never touch or cross is undecided
#     unless the result has an edge between their two carrier classes. It is
#     refused (the first in class order, with the distances), naming the
#     situation:
#       - the result is empty although the pair comes that close;
#       - a face of the pair contributes no triangle to the result (a tool
#         face grazing the other operand);
#       - both faces are in the result but share no edge (crossed rods).
#   - A touching close pair on at least one curved carrier (h + h' > 0)
#     whose result has no edge between the two classes: the crossings the
#     mesh Boolean decided are all gone (a face of the pair contributes no
#     triangle, or a third operand removed every crossing). That is decided
#     only when what remains is clear of the other face: the result's
#     triangles on each class go through a second join against the other
#     class's leaf triangles (of other leaves). A pair whose result triangles
#     come within h1 + h2 + 1e-6 mm of the other's leaf triangles but never
#     touch or cross them is refused, naming the pair (crossing ones are a
#     transversal crossing through the result's interior, where a third
#     operand swallowed the other face: a tee's branch bore through the main
#     pipe's wall). Example: a plane
#     tilted along a rod, 0.005-0.015 mm inside its surface, crosses the rod's
#     facets only where z < 12, and a third operand removes z < 12; the exact
#     result keeps a 0.45-0.6 mm flat strip on z in [12, 20], the mesh a
#     plain facetted cylinder whose facets lie 0.005 mm from the plane's
#     tessellation (the hybrid gate verifier's advn2-graze-crossing-removed).
#     Transversal crossings removed by a third operand (a bore through a
#     counterbore floor) leave the remaining faces far from the other face.
# Exactly tangent faces whose tangent contact line is an edge of the result
# (a slot end, a stadium) touch or have that result edge; exactly tangent
# faces that only touch (a rod resting on a face) are left to the clearance
# certificate of topo.bend.

def curved(s: S.Surf) -> Bool:
  match s:
    case S.SPlane{_, _, _}:
      False{}
    case _:
      True{}

def dummy_surf() -> S.Surf:
  S.SSphere{S.zero3(), S.rf(1.0)}

# --- face table ---------------------------------------------------------------

def h.go(ss: List<&2, S.Surf>, +dev: F32, acc: List<&2, F32>) -> List<&2, F32>:
  match ss:
    case Nil{}:
      U.rev(F32, acc)
    case s <> t:
      h.go(t, dev, Bool.pick(F32, curved(s), dev, 0.0) <> acc)

# --- leaf triangles as clearance items ------------------------------------------

# Item = triangle of a leaf mesh, patch = the carrier class of its tag (the
# first tag with that carrier), so faces of different leaves on one carrier
# (coplanar tops, a self-union's twin faces) are never compared and whole
# subtrees on one carrier are skipped. All three vertex ids are the leaf
# index: triangles of one leaf "share a vertex" and are skipped, and
# triangles of different leaves never do.
def items.go(ts: List<&2, M.Tri>, +vt: U.Tab<&2, G.Vec3>, +dv: Nat, +leaf: U32, +clsT: U.Tab<&2, U32>, +hT: U.Tab<&2, F32>, +df: Nat, acc: List<&2, C.CT>) -> List<&2, C.CT>:
  match ts:
    case Nil{}:
      acc
    case M.Tri{a, b, c, +t} <> rest:
      items.go(rest, vt, dv, leaf, clsT, hT, df, C.ct.of(U.tab.get(U32, clsT, df, t), leaf, leaf, leaf, U.tab.get(G.Vec3, vt, dv, a), U.tab.get(G.Vec3, vt, dv, b), U.tab.get(G.Vec3, vt, dv, c), U.tab.get(F32, hT, df, t)) <> acc)

def items.mesh(+l: U32, m: M.Mesh, +clsT: U.Tab<&2, U32>, +hT: U.Tab<&2, F32>, +df: Nat, acc: List<&2, C.CT>) -> List<&2, C.CT>:
  M.Mesh{+vs, ts} = m
  +dv = U.depth(U.count(G.Vec3, vs, 0))
  items.go(ts, U.tab.of(G.Vec3, vs, dv, S.zero3()), dv, l, clsT, hT, df, acc)

def items.all(ms: List<&2, M.LeafMesh>, +clsT: U.Tab<&2, U32>, +hT: U.Tab<&2, F32>, +df: Nat, acc: List<&2, C.CT>) -> List<&2, C.CT>:
  match ms:
    case Nil{}:
      acc
    case M.LeafMesh{+l, m} <> rest:
      items.all(rest, clsT, hT, df, items.mesh(l, m, clsT, hT, df, acc))

# --- close pairs: Q{k1, k2, d, 1|2} per triangle pair -> one record per carrier pair

type PR is Data:
  PR{p: U32, q: U32, d: F32, touched: Bool}

def agg.go(xs: List<&2, U.Q>, +cp: U32, +cq: U32, +cd: F32, +ct: Bool, acc: List<&2, PR>) -> List<&2, PR>:
  match xs:
    case Nil{}:
      U.rev(PR, PR{cp, cq, cd, ct} <> acc)
    case U.Q{+p, +q, +d, +k} <> t:
      +same = Bool.and(U32.is_eq(p, cp), U32.is_eq(q, cq))
      +tk = U32.is_eq(k, 2)
      +acc2 = acc
      agg.go(t, p, q, Bool.pick(F32, same, F32.min(cd, C.f32_of(d)), C.f32_of(d)), Bool.pick(Bool, same, Bool.or(ct, tk), tk),
        Bool.pick(List<&2, PR>, same, acc2, PR{cp, cq, cd, ct} <> acc2))

def agg(xs: List<&2, U.Q>) -> List<&2, PR>:
  match xs:
    case Nil{}:
      Nil{}
    case U.Q{+p, +q, +d, +k} <> t:
      agg.go(t, p, q, C.f32_of(d), U32.is_eq(k, 2), Nil{})

# --- the result mesh: carrier classes present, class pairs sharing an edge ----

def he(+x: U32, +y: U32, +k: U32) -> U.Q:
  U.Q{U32.min(x, y), U32.max(x, y), k, 0}

def hes.if(inc: Bool, +a: U32, +b: U32, +c: U32, +k: U32, acc: List<&2, U.Q>) -> List<&2, U.Q>:
  match inc:
    case False{}:
      acc
    case True{}:
      he(c, a, k) <> he(b, c, k) <> he(a, b, k) <> acc

# Half-edges of the result triangles whose class is marked in inT (the
# classes of the pairs in question: an edge between two of them only needs
# their own triangles).
def res.hes(ts: List<&2, M.Tri>, +clsT: U.Tab<&2, U32>, +inT: U.Tab<&2, U32>, +df: Nat, acc: List<&2, U.Q>) -> List<&2, U.Q>:
  match ts:
    case Nil{}:
      acc
    case M.Tri{+a, +b, +c, +t} <> rest:
      +k = U.tab.get(U32, clsT, df, t)
      res.hes(rest, clsT, inT, df, hes.if(U32.is_ne(U.tab.get(U32, inT, df, k), 0), a, b, c, k, acc))

def res.here(ts: List<&2, M.Tri>, +clsT: U.Tab<&2, U32>, +df: Nat, arr: Array<U32>) -> Array<U32>:
  match ts:
    case Nil{}:
      arr
    case M.Tri{_, _, _, +t} <> rest:
      res.here(rest, clsT, df, Array.set(U32, arr, U.tab.get(U32, clsT, df, t), 1))

# Class pairs Q{lo, hi, 0, 0} of every result edge between two classes
# (half-edges sorted by undirected edge; neighbours in the sorted list).
def ce.go(xs: List<&2, U.Q>, acc: List<&2, U.Q>) -> List<&2, U.Q>:
  match xs:
    case U.Q{+l1, +h1, +k1, _} <> U.Q{+l2, +h2, +k2, +x} <> t:
      +pair = Bool.and(Bool.and(U32.is_eq(l1, l2), U32.is_eq(h1, h2)), U32.is_ne(k1, k2))
      +acc2 = acc
      ce.go(U.Q{l2, h2, k2, x} <> t, Bool.pick(List<&2, U.Q>, pair, U.Q{U32.min(k1, k2), U32.max(k1, k2), 0, 0} <> acc2, acc2))
    case _:
      acc

# --- decision --------------------------------------------------------------------

type TX is Data:
  TX{surf: U.Tab<&2, S.Surf>, h: U.Tab<&2, F32>, df: Nat, edges: C.RT, here: U.Tab<&2, U32>, empty: Bool}

def f32s(+x: F32) -> String:
  F32.show(x)

def kname(+x: TX, +t: U32) -> String:
  TX{s, _, df, _, _, _} = x
  S.kind_name(S.kind(U.tab.get(S.Surf, s, df, t)))

def pr.msg(hit: Bool, +code: U32, +p: U32, +q: U32, +d: F32, +tol: F32, +x: TX) -> String:
  match hit:
    case False{}:
      ""
    case True{}:
      +near = "leaf faces on a " ++ kname(x, p) ++ " carrier and a " ++ kname(x, q) ++ " carrier (the carriers of tags " ++ U32.show(p) ++ " and " ++ U32.show(q) ++ ") come within " ++ f32s(d) ++ " mm (clearance " ++ f32s(tol) ++ " mm)"
      +tail = {": the mesh Boolean cannot decide their topology at this deviation" : String}
      Bool.pick(String, U32.is_eq(code, 3), "the result is empty although " ++ near ++ " without touching: the mesh Boolean cannot decide at this deviation whether material remains between them",
        Bool.pick(String, U32.is_eq(code, 2), near ++ " without touching, and one of them contributes no triangle to the result" ++ tail,
          near ++ " without touching, and the result has no edge between them" ++ tail))

# A close pair whose tessellations never touch or cross is refused with
# code 3 (empty result), 2 (a face of the pair contributes no triangle) or
# 1 (no result edge between their classes); touching pairs pass.
def pr.why(pr: PR, +x: TX) -> String:
  PR{+p, +q, +d, +touched} = pr
  TX{_, hT, +df, +edges, +hereT, +empty} = x
  +c1 = p
  +c2 = q
  +tol = ((U.tab.get(F32, hT, df, p) + U.tab.get(F32, hT, df, q) : F32) + 0.000001 : F32)
  +edge = C.rt.has(edges, U32.min(c1, c2), U32.max(c1, c2))
  +absent = Bool.or(U32.is_eq(U.tab.get(U32, hereT, df, c1), 0), U32.is_eq(U.tab.get(U32, hereT, df, c2), 0))
  +code = Bool.pick(U32, empty, 3, Bool.pick(U32, absent, 2, Bool.pick(U32, Bool.not(edge), 1, 0)))
  pr.msg(Bool.and(Bool.not(touched), U32.is_ne(code, 0)), code, p, q, d, tol, x)

def first(acc: String, +pr: PR, +x: TX) -> String:
  match acc:
    case SNil{}:
      pr.why(pr, x)
    case SCon{h, t}:
      SCon{h, t}

def prs.why(ps: List<&2, PR>, +x: TX, acc: String) -> String:
  match ps:
    case Nil{}:
      acc
    case +pr <> t:
      prs.why(t, x, first(acc, pr, x))

# Only close pairs whose tessellations never touch are undecided;
# the result mesh is read only when there is one or a touching pair on a
# curved carrier (the second rule).
def open.go(ps: List<&2, PR>, acc: List<&2, PR>) -> List<&2, PR>:
  match ps:
    case Nil{}:
      U.rev(PR, acc)
    case PR{p, q, d, +touched} <> t:
      +acc2 = acc
      open.go(t, Bool.pick(List<&2, PR>, touched, acc2, PR{p, q, d, touched} <> acc2))

# --- touching pairs whose crossings the result does not keep ------------------

def nonempty(-A: Data, xs: List<&2, A>) -> Bool:
  match xs:
    case Nil{}:
      False{}
    case _ <> _:
      True{}

# Touching close pairs with a curved carrier (h + h' > 0).
def cand.go(ps: List<&2, PR>, +hT: U.Tab<&2, F32>, +df: Nat, acc: List<&2, PR>) -> List<&2, PR>:
  match ps:
    case Nil{}:
      U.rev(PR, acc)
    case PR{+p, +q, d, +touched} <> t:
      +keep = Bool.and(touched, ((U.tab.get(F32, hT, df, p) + U.tab.get(F32, hT, df, q) : F32) > 0.0 : F32))
      +acc2 = acc
      cand.go(t, hT, df, Bool.pick(List<&2, PR>, keep, PR{p, q, d, touched} <> acc2, acc2))

# ... whose classes share no edge of the result.
def noedge.go(ps: List<&2, PR>, +edges: C.RT, acc: List<&2, PR>) -> List<&2, PR>:
  match ps:
    case Nil{}:
      U.rev(PR, acc)
    case PR{+p, +q, d, touched} <> t:
      +keep = Bool.not(C.rt.has(edges, U32.min(p, q), U32.max(p, q)))
      +acc2 = acc
      noedge.go(t, edges, Bool.pick(List<&2, PR>, keep, PR{p, q, d, touched} <> acc2, acc2))

# Candidates whose two classes both have result triangles (only those can
# share a result edge; the others have none, and their classes need no
# half-edge sort).
def both.go(ps: List<&2, PR>, +hereT: U.Tab<&2, U32>, +df: Nat, acc: List<&2, PR>) -> List<&2, PR>:
  match ps:
    case Nil{}:
      acc
    case PR{+p, +q, d, touched} <> t:
      +keep = Bool.and(U32.is_ne(U.tab.get(U32, hereT, df, p), 0), U32.is_ne(U.tab.get(U32, hereT, df, q), 0))
      +acc2 = acc
      both.go(t, hereT, df, Bool.pick(List<&2, PR>, keep, PR{p, q, d, touched} <> acc2, acc2))

def mark.go(ps: List<&2, PR>, arr: Array<U32>) -> Array<U32>:
  match ps:
    case Nil{}:
      arr
    case PR{+p, +q, _, _} <> t:
      mark.go(t, Array.set(U32, Array.set(U32, arr, p, 1), q, 1))

def pq.go(ps: List<&2, PR>, acc: List<&2, U.Q>) -> List<&2, U.Q>:
  match ps:
    case Nil{}:
      acc
    case PR{+p, +q, _, _} <> t:
      pq.go(t, U.Q{U32.min(p, q), U32.max(p, q), 0, 0} <> acc)

def leaves.go(fs: List<&2, M.FaceTag>, acc: List<&2, U32>) -> List<&2, U32>:
  match fs:
    case Nil{}:
      U.rev(U32, acc)
    case M.FaceTag{l, _, _} <> rest:
      leaves.go(rest, l <> acc)

# Vertex ids of the second join: a result triangle is (its leaf, R, R), a leaf
# triangle (its leaf, L, L). Result triangles never meet each other (R), leaf
# triangles never meet each other (L), and a result triangle meets the leaf
# triangles of its own leaf's faces only through its own class (skipped).
def rid() -> U32:
  4294967280

def lid() -> U32:
  4294967281

def item.k(inc: Bool, +k: U32, +a: U32, +b: U32, +pa: G.Vec3, +pb: G.Vec3, +pc: G.Vec3, +h: F32, acc: List<&2, C.CT>) -> List<&2, C.CT>:
  match inc:
    case False{}:
      acc
    case True{}:
      C.ct.of(k, a, b, b, pa, pb, pc, h) <> acc

def in.cls(+inT: U.Tab<&2, U32>, +df: Nat, +k: U32) -> Bool:
  U32.is_ne(U.tab.get(U32, inT, df, k), 0)

def ritems.go(ts: List<&2, M.Tri>, +vt: U.Tab<&2, G.Vec3>, +dv: Nat, +clsT: U.Tab<&2, U32>, +leafT: U.Tab<&2, U32>, +inT: U.Tab<&2, U32>, +hT: U.Tab<&2, F32>, +df: Nat, acc: List<&2, C.CT>) -> List<&2, C.CT>:
  match ts:
    case Nil{}:
      acc
    case M.Tri{a, b, c, +t} <> rest:
      +k = U.tab.get(U32, clsT, df, t)
      ritems.go(rest, vt, dv, clsT, leafT, inT, hT, df, item.k(in.cls(inT, df, k), k, U.tab.get(U32, leafT, df, t), rid(), U.tab.get(G.Vec3, vt, dv, a), U.tab.get(G.Vec3, vt, dv, b), U.tab.get(G.Vec3, vt, dv, c), U.tab.get(F32, hT, df, t), acc))

def litems.go(ts: List<&2, M.Tri>, +vt: U.Tab<&2, G.Vec3>, +dv: Nat, +leaf: U32, +clsT: U.Tab<&2, U32>, +inT: U.Tab<&2, U32>, +hT: U.Tab<&2, F32>, +df: Nat, acc: List<&2, C.CT>) -> List<&2, C.CT>:
  match ts:
    case Nil{}:
      acc
    case M.Tri{a, b, c, +t} <> rest:
      +k = U.tab.get(U32, clsT, df, t)
      litems.go(rest, vt, dv, leaf, clsT, inT, hT, df, item.k(in.cls(inT, df, k), k, leaf, lid(), U.tab.get(G.Vec3, vt, dv, a), U.tab.get(G.Vec3, vt, dv, b), U.tab.get(G.Vec3, vt, dv, c), U.tab.get(F32, hT, df, t), acc))

def litems.all(ms: List<&2, M.LeafMesh>, +clsT: U.Tab<&2, U32>, +inT: U.Tab<&2, U32>, +hT: U.Tab<&2, F32>, +df: Nat, acc: List<&2, C.CT>) -> List<&2, C.CT>:
  match ms:
    case Nil{}:
      acc
    case M.LeafMesh{+l, M.Mesh{+vs, ts}} <> rest:
      +dv = U.depth(U.count(G.Vec3, vs, 0))
      litems.all(rest, clsT, inT, hT, df, litems.go(ts, U.tab.of(G.Vec3, vs, dv, S.zero3()), dv, l, clsT, inT, hT, df, acc))

def r4.msg(hit: Bool, +p: U32, +q: U32, +d: F32, +x: TX) -> String:
  match hit:
    case False{}:
      ""
    case True{}:
      TX{_, hT, +df, _, _, _} = x
      +tol = ((U.tab.get(F32, hT, df, p) + U.tab.get(F32, hT, df, q) : F32) + 0.000001 : F32)
      "leaf faces on a " ++ kname(x, p) ++ " carrier and a " ++ kname(x, q) ++ " carrier (the carriers of tags " ++ U32.show(p) ++ " and " ++ U32.show(q) ++ ") cross only where the result does not keep them, and the result's faces on one of them come within " ++ f32s(d) ++ " mm of the other's leaf faces (clearance " ++ f32s(tol) ++ " mm) without touching them or an edge between them: the mesh Boolean cannot decide their topology at this deviation"

def r4.first(acc: String, +rt: C.RT, +pr: PR, +x: TX) -> String:
  match acc:
    case SNil{}:
      PR{+p, +q, +d, +touched} = pr
      r4.msg(Bool.and(C.rt.has(rt, p, q), Bool.not(touched)), p, q, d, x)
    case SCon{h, t}:
      SCon{h, t}

# The first candidate pair (in class order) whose result faces come close to
# the other class's leaf faces without touching or crossing them anywhere. A
# result face that crosses the other leaf's faces is a transversal crossing
# through the result's interior, where a third operand swallowed the other
# face (a tee's branch bore through the main pipe's outer wall, inside the
# branch): decided, as for the leaf pairs above.
def r4.scan(ps: List<&2, PR>, +rt: C.RT, +x: TX, acc: String) -> String:
  match ps:
    case Nil{}:
      acc
    case +pr <> t:
      r4.scan(t, rt, x, r4.first(acc, rt, pr, x))

def r4.go(any: Bool, +nc: List<&2, PR>, +x: TX, +clsT: U.Tab<&2, U32>, +leafT: U.Tab<&2, U32>, +hT: U.Tab<&2, F32>, +df: Nat, +meshes: List<&2, M.LeafMesh>, +vs: List<&2, G.Vec3>, +ts: List<&2, M.Tri>) -> String:
  match any:
    case False{}:
      ""
    case True{}:
      +inT = U.tab.of(U32, P.arr.u32s(mark.go(nc, Array.new(U32, df, 0)), Nil{}), df, 0)
      +dv = U.depth(U.count(G.Vec3, vs, 0))
      +ris = ritems.go(ts, U.tab.of(G.Vec3, vs, dv, S.zero3()), dv, clsT, leafT, inT, hT, df, Nil{})
      +lis = litems.all(meshes, clsT, inT, hT, df, Nil{})
      +pqs = pq.go(nc, Nil{})
      r4.scan(agg(C.close2(ris, U.count(C.CT, ris, 0), lis, U.count(C.CT, lis, 0))), C.rt.of(pqs, U.count(U.Q, pqs, 0)), x, "")

def tx.edges(+x: TX) -> C.RT:
  TX{_, _, _, e, _, _} = x
  e

def r4(+cs: List<&2, PR>, +x: TX, +clsT: U.Tab<&2, U32>, +leafT: U.Tab<&2, U32>, +hT: U.Tab<&2, F32>, +df: Nat, +meshes: List<&2, M.LeafMesh>, +vs: List<&2, G.Vec3>, +ts: List<&2, M.Tri>) -> String:
  +nc = noedge.go(cs, tx.edges(x), Nil{})
  r4.go(nonempty(PR, nc), nc, x, clsT, leafT, hT, df, meshes, vs, ts)

# The first rule's refusal wins; the second runs only when there is none.
def r4.after(acc: String, +cs: List<&2, PR>, +x: TX, +clsT: U.Tab<&2, U32>, +leafT: U.Tab<&2, U32>, +hT: U.Tab<&2, F32>, +df: Nat, +meshes: List<&2, M.LeafMesh>, +vs: List<&2, G.Vec3>, +ts: List<&2, M.Tri>) -> String:
  match acc:
    case SNil{}:
      r4(cs, x, clsT, leafT, hT, df, meshes, vs, ts)
    case SCon{h, t}:
      SCon{h, t}

def check.res(any: Bool, +ops: List<&2, PR>, +cs: List<&2, PR>, +surfs: List<&2, S.Surf>, +clsT: U.Tab<&2, U32>, +leafT: U.Tab<&2, U32>, +hT: U.Tab<&2, F32>, +df: Nat, +meshes: List<&2, M.LeafMesh>, mesh: M.Mesh) -> String:
  match any:
    case False{}:
      ""
    case True{}:
      M.Mesh{+vs, +ts} = mesh
      +here = U.tab.of(U32, P.arr.u32s(res.here(ts, clsT, df, Array.new(U32, df, 0)), Nil{}), df, 0)
      +inE = U.tab.of(U32, P.arr.u32s(mark.go(ops, mark.go(both.go(cs, here, df, Nil{}), Array.new(U32, df, 0))), Nil{}), df, 0)
      +edges = ce.go(U.bsort(res.hes(ts, clsT, inE, df, Nil{}), U.depth(U.count(G.Vec3, vs, 0))), Nil{})
      +x = {TX{U.tab.of(S.Surf, surfs, df, dummy_surf()), hT, df, C.rt.of(edges, U.count(U.Q, edges, 0)), here, U32.is_eq(U.count(M.Tri, ts, 0), 0)} : TX}
      r4.after(prs.why(ops, x, ""), cs, x, clsT, leafT, hT, df, meshes, vs, ts)

# Empty string: no undecided near contact; otherwise the refusal reason.
def check(+job: M.Job, mesh: M.Mesh) -> String:
  M.Job{_, +dev, _, _, +faces, +meshes} = job
  +surfs = P.surfs.go(faces, Nil{})
  +nf = U.count(S.Surf, surfs, 0)
  +df = U.depth(nf)
  +clsT = U.tab.of(U32, P.cls.go(surfs, nf), df, 0)
  +hT = U.tab.of(F32, h.go(surfs, R.approx(dev), Nil{}), df, 0.0)
  +items = items.all(meshes, clsT, hT, df, Nil{})
  +prs = agg(C.close(items, U.count(C.CT, items, 0), Nil{}))
  +ops = open.go(prs, Nil{})
  +cs = cand.go(prs, hT, df, Nil{})
  check.res(Bool.or(nonempty(PR, ops), nonempty(PR, cs)), ops, cs, surfs, clsT, U.tab.of(U32, leaves.go(faces, Nil{}), df, 0), hT, df, meshes, mesh)
