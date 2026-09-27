import Base
import ../../real.bend as R
import ../../precise.bend as G
import ../mesh.bend as M
import ../mesh-io.bend as MIO

# Bake-off baseline prototype "null": the harness floor, not a Boolean.
#
# It answers exactly the jobs whose result needs no surface-surface work:
#   - a single leaf: its tessellated mesh, unchanged;
#   - a union of subtrees it can answer whose bounding boxes are strictly
#     separated on some axis (exact R.less on the wire reals): the meshes are
#     concatenated, since closed disjoint solids share no point.
# Everything else, and every malformed job, is an explicit Unresolved with a
# reason. It never returns an approximate or partial mesh.
#
# Contract (docs/bakeoff.md): run(job) -> result text. parse/solve/show are
# exposed separately so the JS runner can time the phases.

type Box is Data:
  Box{lo: G.Vec3, hi: G.Vec3}

# The mesh of `leaf`; `hit` says whether `cur` (the entry read last) is it.
def leaf_mesh.go(rest: List<&2, M.LeafMesh>, hit: Bool, cur: M.Mesh, +leaf: U32) -> M.Outcome:
  match rest:
    case Nil{}:
      match hit:
        case True{}:
          M.Solved{cur}
        case False{}:
          M.Unresolved{"no-leaf-mesh (null needs a mesh-input job)"}
    case M.LeafMesh{l, m} <> t:
      match hit:
        case True{}:
          M.Solved{cur}
        case False{}:
          leaf_mesh.go(t, U32.is_eq(l, leaf), m, leaf)

def leaf_mesh(meshes: List<&2, M.LeafMesh>, leaf: U32) -> M.Outcome:
  leaf_mesh.go(meshes, False{}, M.empty_mesh(), leaf)

def vmin(a: G.Vec3, b: G.Vec3) -> G.Vec3:
  G.V3{ax, ay, az} = a
  G.V3{bx, by, bz} = b
  G.V3{R.min(ax, bx), R.min(ay, by), R.min(az, bz)}

def vmax(a: G.Vec3, b: G.Vec3) -> G.Vec3:
  G.V3{ax, ay, az} = a
  G.V3{bx, by, bz} = b
  G.V3{R.max(ax, bx), R.max(ay, by), R.max(az, bz)}

def bbox.go(vs: List<&2, G.Vec3>, lo: G.Vec3, hi: G.Vec3) -> Box:
  match vs:
    case Nil{}:
      Box{lo, hi}
    case v <> t:
      +w = v
      bbox.go(t, vmin(lo, w), vmax(hi, w))

# Callers only pass meshes with at least one vertex.
def bbox(vs: List<&2, G.Vec3>) -> Box:
  match vs:
    case Nil{}:
      Box{G.V3{R.from_f32(0.0), R.from_f32(0.0), R.from_f32(0.0)}, G.V3{R.from_f32(0.0), R.from_f32(0.0), R.from_f32(0.0)}}
    case v <> t:
      +w = v
      bbox.go(t, w, w)

# hi of a strictly below lo of b on some axis.
def below(hi: G.Vec3, lo: G.Vec3) -> Bool:
  G.V3{hx, hy, hz} = hi
  G.V3{lx, ly, lz} = lo
  Bool.or(R.less(hx, lx), Bool.or(R.less(hy, ly), R.less(hz, lz)))

def separated(a: Box, b: Box) -> Bool:
  Box{alo, ahi} = a
  Box{blo, bhi} = b
  Bool.or(below(ahi, blo), below(bhi, alo))

def mesh_box(m: M.Mesh) -> Box:
  M.Mesh{vs, _} = m
  bbox(vs)

def disjoint_union.if(apart: Bool, a: M.Mesh, b: M.Mesh) -> M.Outcome:
  match apart:
    case True{}:
      M.Solved{M.concat(a, b)}
    case False{}:
      M.Unresolved{"union operands overlap or touch (null only concatenates separated operands)"}

def disjoint_union(+a: M.Mesh, +b: M.Mesh) -> M.Outcome:
  disjoint_union.if(separated(mesh_box(a), mesh_box(b)), a, b)

def union_of(a: M.Outcome, b: M.Outcome) -> M.Outcome:
  match a:
    case M.Unresolved{reason}:
      M.Unresolved{reason}
    case M.Solved{ma}:
      match b:
        case M.Unresolved{reason}:
          M.Unresolved{reason}
        case M.Solved{mb}:
          disjoint_union(ma, mb)

def solve_tree(tree: M.Csg, +meshes: List<&2, M.LeafMesh>) -> M.Outcome:
  match tree:
    case M.CLeaf{leaf}:
      leaf_mesh(meshes, leaf)
    case M.CNode{op, left, right}:
      match op:
        case M.Union{}:
          union_of(solve_tree(left, meshes), solve_tree(right, meshes))
        case M.Subtract{}:
          M.Unresolved{"subtract not implemented by null"}
        case M.Intersect{}:
          M.Unresolved{"intersect not implemented by null"}

def parse(job: String) -> M.JobParse:
  MIO.parse_job(job)

def solve(p: M.JobParse) -> M.Outcome:
  match p:
    case M.Malformed{reason}:
      M.Unresolved{"malformed-job " ++ reason}
    case M.Parsed{job}:
      M.Job{_, _, tree, _, _, meshes} = job
      solve_tree(tree, meshes)

def show(o: M.Outcome) -> String:
  MIO.show_outcome(o)

def run(job: String) -> String:
  show(solve(parse(job)))
