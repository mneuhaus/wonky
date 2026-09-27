import Base
import ../real.bend as R
import ../precise.bend as G

# Shared data types of the hybrid Boolean (kernel/hybrid, docs/hybrid-boolean-plan.md)
# and of the Boolean bake-off prototypes (kernel/proto/<name>, which import this
# file through the symlink kernel/proto/mesh.bend).
#
# A job is a CSG tree over primitive leaves, the analytic face table and, for
# mesh-input prototypes, one tagged watertight mesh per leaf. Every real is a
# R.Real{hi, lo} exactly as it was written on the wire (see mesh-io.bend and
# docs/bakeoff.md), so no precision is lost between the fixture generator, the
# oracles and the prototypes.

type Op is Data:
  Union{}
  Subtract{}
  Intersect{}

# Prefix tree; a leaf names an index into Job.prims (and Job.meshes).
type Csg is Data:
  CLeaf{leaf: U32}
  CNode{op: Op, left: Csg, right: Csg}

type PrimKind is Data:
  PBox{}
  PCylinder{}
  PCone{}
  PSphere{}
  PTorus{}
  PPrism{}
  PBrep{}

# Rigid placement: world = rows * local + t (row-major 3x4 on the wire).
type Affine is Data:
  Affine{r0: G.Vec3, r1: G.Vec3, r2: G.Vec3, t: G.Vec3}

# params, local frame:
#   box      min.x min.y min.z max.x max.y max.z
#   cylinder radius height               (axis +z from z = 0)
#   cone     radius0 radius1 height      (radius0 at z = 0)
#   sphere   radius                      (centre at origin)
#   torus    major minor                 (axis +z, centre at origin)
#   prism    height x0 y0 x1 y1 ...      (xy polygon extruded from z = 0)
#   brep     (none)                      (frozen exact B-rep body; only its
#                                         face table and mesh are on the wire)
type Prim is Data:
  Prim{kind: PrimKind, params: List<&2, R.Real>, placement: Affine}

# World-space carrier surfaces. `n` is the unit axis or plane normal pointing
# out of the leaf solid for planes, `x` a unit reference direction.
# Cone: points at signed axial height h have radius r + h * tan(a).
type Surface is Data:
  SPlane{o: G.Vec3, n: G.Vec3, x: G.Vec3}
  SCylinder{o: G.Vec3, n: G.Vec3, x: G.Vec3, r: R.Real}
  SCone{o: G.Vec3, n: G.Vec3, x: G.Vec3, r: R.Real, a: R.Real}
  SSphere{o: G.Vec3, r: R.Real}
  STorus{o: G.Vec3, n: G.Vec3, major: R.Real, minor: R.Real}

# One row of the face table; its position in Job.faces is the tag.
type FaceTag is Data:
  FaceTag{leaf: U32, face: U32, surface: Surface}

# Counter-clockwise seen from outside; tag indexes Job.faces.
type Tri is Data:
  Tri{a: U32, b: U32, c: U32, tag: U32}

type Mesh is Data:
  Mesh{vertices: List<&2, G.Vec3>, triangles: List<&2, Tri>}

type LeafMesh is Data:
  LeafMesh{leaf: U32, mesh: Mesh}

type Job is Data:
  Job{id: String, deviation: R.Real, tree: Csg, prims: List<&2, Prim>, faces: List<&2, FaceTag>, meshes: List<&2, LeafMesh>}

# What a prototype answers. Unresolved is a refusal with a reason (one line,
# no newline); it is never a partial or approximate mesh.
type Outcome is Data:
  Solved{mesh: Mesh}
  Unresolved{reason: String}

type JobParse is Data:
  Parsed{job: Job}
  Malformed{reason: String}

def empty_mesh() -> Mesh:
  Mesh{Nil{}, Nil{}}

# Number of elements, tail-recursive (the JS target has a bounded stack).
def count.go(a, -A: Kind(a), xs: List<a, A>, acc: U32) -> U32:
  match xs:
    case Nil{}:
      acc
    case Con{_, t}:
      count.go(a, A, t, (acc + 1 : U32))

def count(a, -A: Kind(a), xs: List<a, A>) -> U32:
  count.go(a, A, xs, 0)

# Shift every triangle's vertex indices by `base`; accumulates reversed.
def shift_tris.go(xs: List<&2, Tri>, +base: U32, acc: List<&2, Tri>) -> List<&2, Tri>:
  match xs:
    case Nil{}:
      acc
    case Tri{a, b, c, tag} <> t:
      shift_tris.go(t, base, Tri{(a + base : U32), (b + base : U32), (c + base : U32), tag} <> acc)

def rev_onto(-A: Data, xs: List<&2, A>, acc: List<&2, A>) -> List<&2, A>:
  match xs:
    case Nil{}:
      acc
    case h <> t:
      rev_onto(A, t, h <> acc)

# Disjoint concatenation: the vertices of b follow those of a.
def concat(a: Mesh, b: Mesh) -> Mesh:
  Mesh{av, at} = a
  Mesh{bv, bt} = b
  +av2 = av
  +base = count(&2, G.Vec3, av2)
  vertices = rev_onto(G.Vec3, List.reverse(&2, G.Vec3, av2), bv)
  triangles = rev_onto(Tri, List.reverse(&2, Tri, at), List.reverse(&2, Tri, shift_tris.go(bt, base, Nil{})))
  Mesh{vertices, triangles}
