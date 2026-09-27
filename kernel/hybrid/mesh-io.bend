import Base
import ../real.bend as R
import ../precise.bend as G
import ./mesh.bend as M

# Parser and printer of the bake-off job/result text (docs/bakeoff.md), the wire
# format of the hybrid Boolean too (kernel/proto/mesh-io.bend is a symlink here;
# scripts/bakeoff/jobfmt.mjs is the JS twin and must stay byte-compatible).
#
# Tokens are separated by ASCII whitespace. A real is two decimal U32 words,
# the IEEE-754 bits of hi and lo; the value is R.Real{hi, lo}.
#
# Style forced by Bend 2.0.25: a destructuring let only opens a parameter and
# user code has no mutual recursion. So every reader returns `value & rest`
# and each step of a sequence is its own def taking the previous pair
# (`real` -> `real.hi` -> `real.lo`). Loops carry the pending pair of the item
# read last (`reals.go`) and scanners carry whether a token has started
# (`number.go`), so every loop is a single self-recursive, tail-recursive
# def over a shrinking Nat or String (the JS target has a bounded stack).
#
# Errors: a malformed token turns the rest of the input into the poison "!",
# which is again malformed, so an error propagates to the final `end` check and
# the whole parse answers Malformed. Nothing is guessed.

def poison() -> String:
  "!"

# ---------------------------------------------------------------------------
# Lexing
#
# Scanners dispatch on literal character patterns and only ever hand back a
# suffix they matched, never a re-prepended character: on the JS target a
# prepend builds a rope that the next slice has to flatten (quadratic), and a
# computed decision cannot be matched before the text without breaking the
# structural termination order.

def digit(acc: U32, d: U32) -> U32:
  ((acc * 10 : U32) + d : U32)

# One decimal U32: leading whitespace is skipped, the terminating whitespace
# consumed; any other character poisons. Values past 2^32 wrap (never
# written).
def number.go(s: String, +acc: U32, started: Bool) -> U32 & String:
  match s:
    case SNil{}:
      match started:
        case True{}:
          (acc, SNil{})
        case False{}:
          (0, poison())
    case SCon{Chr{32}, t}:
      match started:
        case True{}:
          (acc, t)
        case False{}:
          number.go(t, acc, False{})
    case SCon{Chr{10}, t}:
      match started:
        case True{}:
          (acc, t)
        case False{}:
          number.go(t, acc, False{})
    case SCon{Chr{13}, t}:
      match started:
        case True{}:
          (acc, t)
        case False{}:
          number.go(t, acc, False{})
    case SCon{Chr{9}, t}:
      match started:
        case True{}:
          (acc, t)
        case False{}:
          number.go(t, acc, False{})
    case SCon{Chr{48}, t}:
      number.go(t, digit(acc, 0), True{})
    case SCon{Chr{49}, t}:
      number.go(t, digit(acc, 1), True{})
    case SCon{Chr{50}, t}:
      number.go(t, digit(acc, 2), True{})
    case SCon{Chr{51}, t}:
      number.go(t, digit(acc, 3), True{})
    case SCon{Chr{52}, t}:
      number.go(t, digit(acc, 4), True{})
    case SCon{Chr{53}, t}:
      number.go(t, digit(acc, 5), True{})
    case SCon{Chr{54}, t}:
      number.go(t, digit(acc, 6), True{})
    case SCon{Chr{55}, t}:
      number.go(t, digit(acc, 7), True{})
    case SCon{Chr{56}, t}:
      number.go(t, digit(acc, 8), True{})
    case SCon{Chr{57}, t}:
      number.go(t, digit(acc, 9), True{})
    case SCon{_, _}:
      (0, poison())

def number(s: String) -> U32 & String:
  number.go(s, 0, False{})

# The next whitespace-delimited word (empty at end of input); leading
# whitespace is skipped and the single whitespace character after the word
# consumed.
def word.go(s: String, acc: String, started: Bool) -> String & String:
  match s:
    case SNil{}:
      (String.reverse(acc), SNil{})
    case SCon{Chr{32}, t}:
      match started:
        case True{}:
          (String.reverse(acc), t)
        case False{}:
          word.go(t, acc, False{})
    case SCon{Chr{10}, t}:
      match started:
        case True{}:
          (String.reverse(acc), t)
        case False{}:
          word.go(t, acc, False{})
    case SCon{Chr{13}, t}:
      match started:
        case True{}:
          (String.reverse(acc), t)
        case False{}:
          word.go(t, acc, False{})
    case SCon{Chr{9}, t}:
      match started:
        case True{}:
          (String.reverse(acc), t)
        case False{}:
          word.go(t, acc, False{})
    case SCon{c, t}:
      word.go(t, SCon{c, acc}, True{})

def word(s: String) -> String & String:
  word.go(s, SNil{}, False{})

def line.go(s: String, acc: String) -> String & String:
  match s:
    case SNil{}:
      (String.reverse(acc), SNil{})
    case SCon{Chr{10}, t}:
      (String.reverse(acc), t)
    case SCon{c, t}:
      line.go(t, SCon{c, acc})

# The rest of the current line; the newline is consumed.
def line(s: String) -> String & String:
  line.go(s, SNil{})

def expect.if(rest: String, same: Bool) -> String:
  match same:
    case True{}:
      rest
    case False{}:
      poison()

def expect.k(p: String & String, kw: String) -> String:
  (w, rest) = p
  expect.if(rest, String.eq(w, kw))

# Consume the keyword `kw` or poison.
def expect(s: String, kw: String) -> String:
  expect.k(word(s), kw)

def f32_of(x: U32) -> F32:
  match x:
    case U32{w}:
      F32{w}

def real.lo(hi: U32, p: U32 & String) -> R.Real & String:
  (lo, s) = p
  (R.Real{f32_of(hi), f32_of(lo)}, s)

def real.hi(p: U32 & String) -> R.Real & String:
  (hi, s) = p
  real.lo(hi, number(s))

def real(s: String) -> R.Real & String:
  real.hi(number(s))

def vec3.z(x: R.Real, y: R.Real, p: R.Real & String) -> G.Vec3 & String:
  (z, s) = p
  (G.V3{x, y, z}, s)

def vec3.y(x: R.Real, p: R.Real & String) -> G.Vec3 & String:
  (y, s) = p
  vec3.z(x, y, real(s))

def vec3.x(p: R.Real & String) -> G.Vec3 & String:
  (x, s) = p
  vec3.y(x, real(s))

def vec3(s: String) -> G.Vec3 & String:
  vec3.x(real(s))

# `n` more after the pending pair `st`.
def reals.go(n: Nat, st: R.Real & String, acc: List<&2, R.Real>) -> List<&2, R.Real> & String:
  match n:
    case 0n:
      (x, s) = st
      (List.reverse(&2, R.Real, x <> acc), s)
    case 1n+p:
      (x, s) = st
      reals.go(p, real(s), x <> acc)

def reals(n: Nat, s: String) -> List<&2, R.Real> & String:
  match n:
    case 0n:
      (Nil{}, s)
    case 1n+p:
      reals.go(p, real(s), Nil{})

# ---------------------------------------------------------------------------
# Meshes

def vertices.go(n: Nat, st: G.Vec3 & String, acc: List<&2, G.Vec3>) -> List<&2, G.Vec3> & String:
  match n:
    case 0n:
      (v, s) = st
      (List.reverse(&2, G.Vec3, v <> acc), s)
    case 1n+p:
      (v, s) = st
      vertices.go(p, vec3(s), v <> acc)

def vertices(n: Nat, s: String) -> List<&2, G.Vec3> & String:
  match n:
    case 0n:
      (Nil{}, s)
    case 1n+p:
      vertices.go(p, vec3(s), Nil{})

def tri.d(a: U32, b: U32, c: U32, p: U32 & String) -> M.Tri & String:
  (tag, s) = p
  (M.Tri{a, b, c, tag}, s)

def tri.c(a: U32, b: U32, p: U32 & String) -> M.Tri & String:
  (c, s) = p
  tri.d(a, b, c, number(s))

def tri.b(a: U32, p: U32 & String) -> M.Tri & String:
  (b, s) = p
  tri.c(a, b, number(s))

def tri.a(p: U32 & String) -> M.Tri & String:
  (a, s) = p
  tri.b(a, number(s))

# "a b c tag"
def tri(s: String) -> M.Tri & String:
  tri.a(number(s))

def triangles.go(n: Nat, st: M.Tri & String, acc: List<&2, M.Tri>) -> List<&2, M.Tri> & String:
  match n:
    case 0n:
      (t, s) = st
      (List.reverse(&2, M.Tri, t <> acc), s)
    case 1n+p:
      (t, s) = st
      triangles.go(p, tri(s), t <> acc)

def triangles(n: Nat, s: String) -> List<&2, M.Tri> & String:
  match n:
    case 0n:
      (Nil{}, s)
    case 1n+p:
      triangles.go(p, tri(s), Nil{})

def mesh.ts(vs: List<&2, G.Vec3>, p: List<&2, M.Tri> & String) -> M.Mesh & String:
  (ts, s) = p
  (M.Mesh{vs, ts}, s)

def mesh.vs(nt: U32, p: List<&2, G.Vec3> & String) -> M.Mesh & String:
  (vs, s) = p
  mesh.ts(vs, triangles(U32.to_nat(nt), s))

def mesh.nt(nv: U32, p: U32 & String) -> M.Mesh & String:
  (nt, s) = p
  mesh.vs(nt, vertices(U32.to_nat(nv), s))

def mesh.nv(p: U32 & String) -> M.Mesh & String:
  (nv, s) = p
  mesh.nt(nv, number(s))

# "<V> <T>" followed by the vertex and triangle records.
def mesh_body(s: String) -> M.Mesh & String:
  mesh.nv(number(s))

def leaf_mesh.body(leaf: U32, p: M.Mesh & String) -> M.LeafMesh & String:
  (m, s) = p
  (M.LeafMesh{leaf, m}, s)

def leaf_mesh.leaf(p: U32 & String) -> M.LeafMesh & String:
  (leaf, s) = p
  leaf_mesh.body(leaf, mesh_body(s))

def leaf_mesh(s: String) -> M.LeafMesh & String:
  leaf_mesh.leaf(number(expect(s, "mesh")))

def leaf_meshes.go(n: Nat, st: M.LeafMesh & String, acc: List<&2, M.LeafMesh>) -> List<&2, M.LeafMesh> & String:
  match n:
    case 0n:
      (m, s) = st
      (List.reverse(&2, M.LeafMesh, m <> acc), s)
    case 1n+p:
      (m, s) = st
      leaf_meshes.go(p, leaf_mesh(s), m <> acc)

def leaf_meshes(n: Nat, s: String) -> List<&2, M.LeafMesh> & String:
  match n:
    case 0n:
      (Nil{}, s)
    case 1n+p:
      leaf_meshes.go(p, leaf_mesh(s), Nil{})

# ---------------------------------------------------------------------------
# Tree: read the declared number of prefix tokens, then fold them right to
# left with a stack (no recursion over the tree shape).

type NodeKind is Data:
  KLeaf{}
  KOp{op: M.Op}
  KBad{}

def node_kind(+w: String) -> NodeKind:
  Bool.pick(NodeKind, String.eq(w, "leaf"), KLeaf{},
    Bool.pick(NodeKind, String.eq(w, "union"), KOp{M.Union{}},
      Bool.pick(NodeKind, String.eq(w, "subtract"), KOp{M.Subtract{}},
        Bool.pick(NodeKind, String.eq(w, "intersect"), KOp{M.Intersect{}}, KBad{}))))

type NTok is Data:
  TLeaf{leaf: U32}
  TOp{op: M.Op}
  TBad{}

def ntok.leaf(p: U32 & String) -> NTok & String:
  (i, s) = p
  (TLeaf{i}, s)

def ntok.of(kind: NodeKind, s: String) -> NTok & String:
  match kind:
    case KLeaf{}:
      ntok.leaf(number(s))
    case KOp{op}:
      (TOp{op}, s)
    case KBad{}:
      (TBad{}, poison())

def ntok.w(p: String & String) -> NTok & String:
  (w, s) = p
  ntok.of(node_kind(w), s)

def ntok(s: String) -> NTok & String:
  ntok.w(word(s))

def ntoks.go(n: Nat, st: NTok & String, acc: List<&2, NTok>) -> List<&2, NTok> & String:
  match n:
    case 0n:
      (k, s) = st
      (k <> acc, s)
    case 1n+p:
      (k, s) = st
      ntoks.go(p, ntok(s), k <> acc)

# Tokens right to left (last token first).
def ntoks(n: Nat, s: String) -> List<&2, NTok> & String:
  match n:
    case 0n:
      (Nil{}, s)
    case 1n+p:
      ntoks.go(p, ntok(s), Nil{})

def bad_tree() -> M.Csg & String:
  (M.CLeaf{0}, poison())

# Right-to-left prefix evaluation: a leaf pushes, an operator pops its left
# (top) and right operand. Exactly one tree must remain.
def build(toks: List<&2, NTok>, stack: List<&2, M.Csg>, s: String) -> M.Csg & String:
  match toks:
    case Nil{}:
      match stack:
        case t <> Nil{}:
          (t, s)
        case _:
          bad_tree()
    case TLeaf{i} <> rest:
      build(rest, M.CLeaf{i} <> stack, s)
    case TOp{op} <> rest:
      match stack:
        case a <> b <> below:
          build(rest, M.CNode{op, a, b} <> below, s)
        case _:
          bad_tree()
    case TBad{} <> _:
      bad_tree()

def tree.k(p: List<&2, NTok> & String) -> M.Csg & String:
  (toks, s) = p
  build(toks, Nil{}, s)

def tree(nodes: U32, s: String) -> M.Csg & String:
  tree.k(ntoks(U32.to_nat(nodes), s))

# ---------------------------------------------------------------------------
# Primitives and faces

type PrimOrBad is Data:
  KPrim{kind: M.PrimKind}
  KNoPrim{}

def prim_kind(+w: String) -> PrimOrBad:
  Bool.pick(PrimOrBad, String.eq(w, "box"), KPrim{M.PBox{}},
    Bool.pick(PrimOrBad, String.eq(w, "cylinder"), KPrim{M.PCylinder{}},
      Bool.pick(PrimOrBad, String.eq(w, "cone"), KPrim{M.PCone{}},
        Bool.pick(PrimOrBad, String.eq(w, "sphere"), KPrim{M.PSphere{}},
          Bool.pick(PrimOrBad, String.eq(w, "torus"), KPrim{M.PTorus{}},
            Bool.pick(PrimOrBad, String.eq(w, "prism"), KPrim{M.PPrism{}},
              Bool.pick(PrimOrBad, String.eq(w, "brep"), KPrim{M.PBrep{}}, KNoPrim{})))))))

def affine.t2(r0: G.Vec3, t0: R.Real, r1: G.Vec3, t1: R.Real, r2: G.Vec3, p: R.Real & String) -> M.Affine & String:
  (t2, s) = p
  (M.Affine{r0, r1, r2, G.V3{t0, t1, t2}}, s)

def affine.r2(r0: G.Vec3, t0: R.Real, r1: G.Vec3, t1: R.Real, p: G.Vec3 & String) -> M.Affine & String:
  (r2, s) = p
  affine.t2(r0, t0, r1, t1, r2, real(s))

def affine.t1(r0: G.Vec3, t0: R.Real, r1: G.Vec3, p: R.Real & String) -> M.Affine & String:
  (t1, s) = p
  affine.r2(r0, t0, r1, t1, vec3(s))

def affine.r1(r0: G.Vec3, t0: R.Real, p: G.Vec3 & String) -> M.Affine & String:
  (r1, s) = p
  affine.t1(r0, t0, r1, real(s))

def affine.t0(r0: G.Vec3, p: R.Real & String) -> M.Affine & String:
  (t0, s) = p
  affine.r1(r0, t0, vec3(s))

def affine.r0(p: G.Vec3 & String) -> M.Affine & String:
  (r0, s) = p
  affine.t0(r0, real(s))

# Three rows "a b c t" of the placement matrix.
def affine(s: String) -> M.Affine & String:
  affine.r0(vec3(s))

def identity() -> M.Affine:
  M.Affine{G.v3(1.0, 0.0, 0.0), G.v3(0.0, 1.0, 0.0), G.v3(0.0, 0.0, 1.0), G.v3(0.0, 0.0, 0.0)}

def prim.placement(kind: M.PrimKind, params: List<&2, R.Real>, p: M.Affine & String) -> M.Prim & String:
  (placement, s) = p
  (M.Prim{kind, params, placement}, s)

def prim.params(kind: M.PrimKind, p: List<&2, R.Real> & String) -> M.Prim & String:
  (params, s) = p
  prim.placement(kind, params, affine(s))

def prim.count(kind: M.PrimKind, p: U32 & String) -> M.Prim & String:
  (n, s) = p
  prim.params(kind, reals(U32.to_nat(n), s))

def prim.body(k: PrimOrBad, s: String) -> M.Prim & String:
  match k:
    case KPrim{kind}:
      prim.count(kind, number(s))
    case KNoPrim{}:
      (M.Prim{M.PBox{}, Nil{}, identity()}, poison())

def prim.w(p: String & String) -> M.Prim & String:
  (w, s) = p
  prim.body(prim_kind(w), s)

# "prim <kind> <n> <params...> <matrix>"
def prim(s: String) -> M.Prim & String:
  prim.w(word(expect(s, "prim")))

def prims.go(n: Nat, st: M.Prim & String, acc: List<&2, M.Prim>) -> List<&2, M.Prim> & String:
  match n:
    case 0n:
      (x, s) = st
      (List.reverse(&2, M.Prim, x <> acc), s)
    case 1n+p:
      (x, s) = st
      prims.go(p, prim(s), x <> acc)

def prims(n: Nat, s: String) -> List<&2, M.Prim> & String:
  match n:
    case 0n:
      (Nil{}, s)
    case 1n+p:
      prims.go(p, prim(s), Nil{})

type SurfaceKind is Data:
  KPlane{}
  KCylinder{}
  KCone{}
  KSphere{}
  KTorus{}
  KNoSurface{}

def surface_kind(+w: String) -> SurfaceKind:
  Bool.pick(SurfaceKind, String.eq(w, "plane"), KPlane{},
    Bool.pick(SurfaceKind, String.eq(w, "cylinder"), KCylinder{},
      Bool.pick(SurfaceKind, String.eq(w, "cone"), KCone{},
        Bool.pick(SurfaceKind, String.eq(w, "sphere"), KSphere{},
          Bool.pick(SurfaceKind, String.eq(w, "torus"), KTorus{}, KNoSurface{})))))

# Number of reals on the wire per surface type.
def surface_arity(k: SurfaceKind) -> Nat:
  match k:
    case KPlane{}:
      9n
    case KCylinder{}:
      10n
    case KCone{}:
      11n
    case KSphere{}:
      4n
    case KTorus{}:
      8n
    case KNoSurface{}:
      0n

def bad_surface() -> M.Surface & String:
  (M.SSphere{G.v3(0.0, 0.0, 0.0), R.from_f32(0.0)}, poison())

def surface.of(k: SurfaceKind, p: List<&2, R.Real> & String) -> M.Surface & String:
  match k:
    case KPlane{}:
      (xs, s) = p
      match xs:
        case [ox, oy, oz, nx, ny, nz, xx, xy, xz]:
          (M.SPlane{G.V3{ox, oy, oz}, G.V3{nx, ny, nz}, G.V3{xx, xy, xz}}, s)
        case _:
          bad_surface()
    case KCylinder{}:
      (xs, s) = p
      match xs:
        case [ox, oy, oz, nx, ny, nz, xx, xy, xz, r]:
          (M.SCylinder{G.V3{ox, oy, oz}, G.V3{nx, ny, nz}, G.V3{xx, xy, xz}, r}, s)
        case _:
          bad_surface()
    case KCone{}:
      (xs, s) = p
      match xs:
        case [ox, oy, oz, nx, ny, nz, xx, xy, xz, r, a]:
          (M.SCone{G.V3{ox, oy, oz}, G.V3{nx, ny, nz}, G.V3{xx, xy, xz}, r, a}, s)
        case _:
          bad_surface()
    case KSphere{}:
      (xs, s) = p
      match xs:
        case [ox, oy, oz, r]:
          (M.SSphere{G.V3{ox, oy, oz}, r}, s)
        case _:
          bad_surface()
    case KTorus{}:
      (xs, s) = p
      match xs:
        case [ox, oy, oz, nx, ny, nz, major, minor]:
          (M.STorus{G.V3{ox, oy, oz}, G.V3{nx, ny, nz}, major, minor}, s)
        case _:
          bad_surface()
    case KNoSurface{}:
      bad_surface()

def surface(+k: SurfaceKind, s: String) -> M.Surface & String:
  surface.of(k, reals(surface_arity(k), s))

def face.surface(leaf: U32, face: U32, p: M.Surface & String) -> M.FaceTag & String:
  (surf, s) = p
  (M.FaceTag{leaf, face, surf}, s)

def face.type(leaf: U32, face: U32, p: String & String) -> M.FaceTag & String:
  (w, s) = p
  face.surface(leaf, face, surface(surface_kind(w), s))

def face.index(leaf: U32, p: U32 & String) -> M.FaceTag & String:
  (face, s) = p
  face.type(leaf, face, word(s))

def face.leaf(p: U32 & String) -> M.FaceTag & String:
  (leaf, s) = p
  face.index(leaf, number(s))

# "face <leaf> <faceIndex> <type> <reals...>"
def face(s: String) -> M.FaceTag & String:
  face.leaf(number(expect(s, "face")))

def faces.go(n: Nat, st: M.FaceTag & String, acc: List<&2, M.FaceTag>) -> List<&2, M.FaceTag> & String:
  match n:
    case 0n:
      (x, s) = st
      (List.reverse(&2, M.FaceTag, x <> acc), s)
    case 1n+p:
      (x, s) = st
      faces.go(p, face(s), x <> acc)

def faces(n: Nat, s: String) -> List<&2, M.FaceTag> & String:
  match n:
    case 0n:
      (Nil{}, s)
    case 1n+p:
      faces.go(p, face(s), Nil{})

# ---------------------------------------------------------------------------
# Job

def finish.if(job: M.Job, after: String, ok: Bool) -> M.JobParse & String:
  match ok:
    case True{}:
      (M.Parsed{job}, after)
    case False{}:
      (M.Malformed{"job text does not match the declared counts or grammar"}, SNil{})

def finish.k(job: M.Job, p: String & String) -> M.JobParse & String:
  (w, after) = p
  finish.if(job, after, String.eq(w, "end"))

def finish(job: M.Job, rest: String) -> M.JobParse & String:
  finish.k(job, word(rest))

def job.meshes(id: String, dev: R.Real, csg: M.Csg, ps: List<&2, M.Prim>, fs: List<&2, M.FaceTag>, p: List<&2, M.LeafMesh> & String) -> M.JobParse & String:
  (ms, s) = p
  finish(M.Job{id, dev, csg, ps, fs, ms}, s)

def job.nm(id: String, dev: R.Real, csg: M.Csg, ps: List<&2, M.Prim>, fs: List<&2, M.FaceTag>, p: U32 & String) -> M.JobParse & String:
  (n, s) = p
  job.meshes(id, dev, csg, ps, fs, leaf_meshes(U32.to_nat(n), s))

def job.faces(id: String, dev: R.Real, csg: M.Csg, ps: List<&2, M.Prim>, p: List<&2, M.FaceTag> & String) -> M.JobParse & String:
  (fs, s) = p
  job.nm(id, dev, csg, ps, fs, number(expect(s, "meshes")))

def job.nf(id: String, dev: R.Real, csg: M.Csg, ps: List<&2, M.Prim>, p: U32 & String) -> M.JobParse & String:
  (n, s) = p
  job.faces(id, dev, csg, ps, faces(U32.to_nat(n), s))

def job.prims(id: String, dev: R.Real, csg: M.Csg, p: List<&2, M.Prim> & String) -> M.JobParse & String:
  (ps, s) = p
  job.nf(id, dev, csg, ps, number(expect(s, "faces")))

def job.np(id: String, dev: R.Real, csg: M.Csg, p: U32 & String) -> M.JobParse & String:
  (n, s) = p
  job.prims(id, dev, csg, prims(U32.to_nat(n), s))

def job.tree(id: String, dev: R.Real, p: M.Csg & String) -> M.JobParse & String:
  (csg, s) = p
  job.np(id, dev, csg, number(expect(s, "prims")))

def job.nodes(id: String, dev: R.Real, p: U32 & String) -> M.JobParse & String:
  (n, s) = p
  job.tree(id, dev, tree(n, s))

def job.deviation(id: String, p: R.Real & String) -> M.JobParse & String:
  (dev, s) = p
  job.nodes(id, dev, number(expect(s, "nodes")))

def job.id(p: String & String) -> M.JobParse & String:
  (id, s) = p
  job.deviation(id, real(expect(s, "deviation")))

# Parse one job and hand back the text after its `end` (the recover mode
# appends a result there).
def parse_job_prefix(s: String) -> M.JobParse & String:
  job.id(word(expect(expect(expect(s, "wonky-bakeoff-job"), "1"), "case")))

def parse_job.k(p: M.JobParse & String) -> M.JobParse:
  (r, _) = p
  r

def parse_job(s: String) -> M.JobParse:
  parse_job.k(parse_job_prefix(s))

# ---------------------------------------------------------------------------
# Result

def result_end.if(o: M.Outcome, ok: Bool) -> M.Outcome:
  match ok:
    case True{}:
      o
    case False{}:
      M.Unresolved{"malformed-result"}

def result_end.k(o: M.Outcome, p: String & String) -> M.Outcome:
  (w, _) = p
  result_end.if(o, String.eq(w, "end"))

def result_end(o: M.Outcome, rest: String) -> M.Outcome:
  result_end.k(o, word(rest))

def result_mesh(p: M.Mesh & String) -> M.Outcome:
  (m, s) = p
  result_end(M.Solved{m}, s)

def result_reason(p: String & String) -> M.Outcome:
  (reason, s) = p
  result_end(M.Unresolved{reason}, s)

def result_unresolved(unresolved: Bool, s: String) -> M.Outcome:
  match unresolved:
    case True{}:
      result_reason(line(s))
    case False{}:
      M.Unresolved{"malformed-result"}

def result_body(ok: Bool, unresolved: Bool, s: String) -> M.Outcome:
  match ok:
    case True{}:
      result_mesh(mesh_body(expect(s, "mesh")))
    case False{}:
      result_unresolved(unresolved, s)

def parse_result.of(+w: String, s: String) -> M.Outcome:
  result_body(String.eq(w, "ok"), String.eq(w, "unresolved"), s)

def parse_result.k(p: String & String) -> M.Outcome:
  (w, s) = p
  parse_result.of(w, s)

# "ok" + mesh, or "unresolved <reason>"; a malformed text answers
# Unresolved{"malformed-result"}.
def parse_result(s: String) -> M.Outcome:
  parse_result.k(word(s))

# ---------------------------------------------------------------------------
# Printing. Output is built back to front by prepending, so every loop runs
# over a reversed list and stays tail-recursive.

# Prepend the decimal digits of n (least significant first, which prepending
# puts in order); `more` says whether n still has a digit to write.
def put_digits(f: Nat, +n: U32, acc: String, more: Bool) -> String:
  match f:
    case 0n:
      acc
    case 1n+g:
      match more:
        case True{}:
          put_digits(g, (n / 10 : U32), SCon{Chr{(48 + (n % 10 : U32) : U32)}, acc}, (n >= 10 : U32))
        case False{}:
          acc

def put_u32(n: U32, acc: String) -> String:
  put_digits(10n, n, acc, True{})

# Prepend a (short) literal.
def put(lit: String, acc: String) -> String:
  String.append(lit, acc)

def sp(acc: String) -> String:
  SCon{Chr{32}, acc}

def nl(acc: String) -> String:
  SCon{Chr{10}, acc}

def put_real(r: R.Real, acc: String) -> String:
  R.Real{hi, lo} = r
  put_u32(F32.bits(hi), sp(put_u32(F32.bits(lo), acc)))

def put_vec3(v: G.Vec3, acc: String) -> String:
  G.V3{x, y, z} = v
  put_real(x, sp(put_real(y, sp(put_real(z, acc)))))

def put_vertices(rev: List<&2, G.Vec3>, acc: String) -> String:
  match rev:
    case Nil{}:
      acc
    case v <> t:
      put_vertices(t, put_vec3(v, nl(acc)))

def put_triangles(rev: List<&2, M.Tri>, acc: String) -> String:
  match rev:
    case Nil{}:
      acc
    case M.Tri{a, b, c, tag} <> t:
      put_triangles(t, put_u32(a, sp(put_u32(b, sp(put_u32(c, sp(put_u32(tag, nl(acc)))))))))

# "<V> <T>\n" + records, prepended to acc.
def put_mesh_body(m: M.Mesh, acc: String) -> String:
  M.Mesh{vs, ts} = m
  +rv = List.reverse(&2, G.Vec3, vs)
  +rt = List.reverse(&2, M.Tri, ts)
  body = put_vertices(rv, put_triangles(rt, acc))
  put_u32(M.count(&2, G.Vec3, rv), sp(put_u32(M.count(&2, M.Tri, rt), nl(body))))

def show_mesh(m: M.Mesh) -> String:
  put("mesh ", put_mesh_body(m, "end\n"))

def show_outcome(o: M.Outcome) -> String:
  match o:
    case M.Solved{m}:
      put("ok\nmesh ", put_mesh_body(m, "end\n"))
    case M.Unresolved{reason}:
      put("unresolved ", put(reason, "\nend\n"))

# --- job printing (round trips with parse_job; used by tests and tools) ---

def op_name(op: M.Op) -> String:
  match op:
    case M.Union{}:
      "union"
    case M.Subtract{}:
      "subtract"
    case M.Intersect{}:
      "intersect"

# Prefix order; trees are shallow (bounded by the node count), so plain
# recursion is fine here.
def put_tree(t: M.Csg, acc: String) -> String:
  match t:
    case M.CLeaf{i}:
      put("leaf ", put_u32(i, nl(acc)))
    case M.CNode{op, a, b}:
      put(op_name(op), nl(put_tree(a, put_tree(b, acc))))

def count_nodes(t: M.Csg) -> U32:
  match t:
    case M.CLeaf{_}:
      1
    case M.CNode{_, a, b}:
      (1 + count_nodes(a) + count_nodes(b) : U32)

def put_reals(rev: List<&2, R.Real>, acc: String) -> String:
  match rev:
    case Nil{}:
      acc
    case r <> t:
      put_reals(t, sp(put_real(r, acc)))

def prim_name(k: M.PrimKind) -> String:
  match k:
    case M.PBox{}:
      "box"
    case M.PCylinder{}:
      "cylinder"
    case M.PCone{}:
      "cone"
    case M.PSphere{}:
      "sphere"
    case M.PTorus{}:
      "torus"
    case M.PPrism{}:
      "prism"
    case M.PBrep{}:
      "brep"

def put_affine(a: M.Affine, acc: String) -> String:
  M.Affine{r0, r1, r2, t} = a
  G.V3{t0, t1, t2} = t
  put_vec3(r0, sp(put_real(t0, sp(put_vec3(r1, sp(put_real(t1, sp(put_vec3(r2, sp(put_real(t2, acc)))))))))))

# "prim <kind> <n> <params...> <matrix>"; params are written each with a
# leading space, so the count is followed directly by them.
def put_prim(p: M.Prim, acc: String) -> String:
  M.Prim{kind, params, placement} = p
  +ps = params
  put("prim ", put(prim_name(kind), sp(put_u32(M.count(&2, R.Real, ps), put_reals(List.reverse(&2, R.Real, ps), sp(put_affine(placement, nl(acc))))))))

def put_prims(rev: List<&2, M.Prim>, acc: String) -> String:
  match rev:
    case Nil{}:
      acc
    case p <> t:
      put_prims(t, put_prim(p, acc))

def put_surface(s: M.Surface, acc: String) -> String:
  match s:
    case M.SPlane{o, n, x}:
      put("plane ", put_vec3(o, sp(put_vec3(n, sp(put_vec3(x, acc))))))
    case M.SCylinder{o, n, x, r}:
      put("cylinder ", put_vec3(o, sp(put_vec3(n, sp(put_vec3(x, sp(put_real(r, acc))))))))
    case M.SCone{o, n, x, r, a}:
      put("cone ", put_vec3(o, sp(put_vec3(n, sp(put_vec3(x, sp(put_real(r, sp(put_real(a, acc))))))))))
    case M.SSphere{o, r}:
      put("sphere ", put_vec3(o, sp(put_real(r, acc))))
    case M.STorus{o, n, major, minor}:
      put("torus ", put_vec3(o, sp(put_vec3(n, sp(put_real(major, sp(put_real(minor, acc))))))))

def put_faces(rev: List<&2, M.FaceTag>, acc: String) -> String:
  match rev:
    case Nil{}:
      acc
    case M.FaceTag{leaf, face, surface} <> t:
      put_faces(t, put("face ", put_u32(leaf, sp(put_u32(face, sp(put_surface(surface, nl(acc))))))))

def put_leaf_meshes(rev: List<&2, M.LeafMesh>, acc: String) -> String:
  match rev:
    case Nil{}:
      acc
    case M.LeafMesh{leaf, m} <> t:
      put_leaf_meshes(t, put("mesh ", put_u32(leaf, sp(put_mesh_body(m, acc)))))

def show_job(job: M.Job) -> String:
  M.Job{id, deviation, csg, ps, fs, ms} = job
  +tree = csg
  +ps2 = ps
  +fs2 = fs
  +ms2 = ms
  tail = put("meshes ", put_u32(M.count(&2, M.LeafMesh, ms2), nl(put_leaf_meshes(List.reverse(&2, M.LeafMesh, ms2), "end\n"))))
  faces = put("faces ", put_u32(M.count(&2, M.FaceTag, fs2), nl(put_faces(List.reverse(&2, M.FaceTag, fs2), tail))))
  prims = put("prims ", put_u32(M.count(&2, M.Prim, ps2), nl(put_prims(List.reverse(&2, M.Prim, ps2), faces))))
  nodes = put("nodes ", put_u32(count_nodes(tree), nl(put_tree(tree, prims))))
  put("wonky-bakeoff-job 1\ncase ", put(id, nl(put("deviation ", put_real(deviation, nl(nodes))))))

# Parse and print again; the identity on well-formed canonical text.
def round_trip_job.of(p: M.JobParse) -> String:
  match p:
    case M.Parsed{job}:
      show_job(job)
    case M.Malformed{reason}:
      put("malformed ", reason)

def round_trip_job(s: String) -> String:
  round_trip_job.of(parse_job(s))

def round_trip_result(s: String) -> String:
  show_outcome(parse_result(s))

# --- recover mode -------------------------------------------------------------
# A recover input is a job immediately followed by a tagged Boolean result
# (docs/bakeoff.md, "Recover mode"). The result is Unresolved{..} when the job
# part is malformed.

def parse_recover.k(p: M.JobParse & String) -> M.JobParse & M.Outcome:
  (job, rest) = p
  (job, parse_result(rest))

def parse_recover(s: String) -> M.JobParse & M.Outcome:
  parse_recover.k(parse_job_prefix(s))

# Parse and print again (tests): the job text followed by the result text.
def round_trip_recover.of(p: M.JobParse & M.Outcome) -> String:
  (job, o) = p
  String.append(round_trip_job.of(job), show_outcome(o))

def round_trip_recover(s: String) -> String:
  round_trip_recover.of(parse_recover(s))
