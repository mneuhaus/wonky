import Base
import ../mesh.bend as M
import ../unify.bend as UN
import ./util.bend as U

# corefine: carrier unification for rotated coplanar input
# (docs/hybrid-boolean-plan.md, section 8, step 4). The decision is
# kernel/hybrid/unify.bend (exact, on the face-table values; shared with
# recover, which states it in its output): plane tags of different leaves
# whose normals agree within 2^-44 and offsets within 2^-44*scale form a
# unified class, one bit each (at most 32).
#
# Here every tag gets its class bit mask (cm), read once per Boolean when the
# operand records are built (prep.bend: VRec.k, FRec.k). The predicates
# (shadow.bend) then treat a comparison between two elements that touch a
# common unified class as an exact tie when the two values differ by at most
# tz = 2^-36*scale (the scale of corefine's short-edge collapse): the z
# comparisons of kernel02 / kernel11 (the faces become exactly coplanar) and
# the y comparison of shadow01 (vertices on edges inside the unified plane).
# The symbolic perturbation then decides them as for exactly coplanar input.
# Without a unified class every mask is 0 and nothing changes.

# pc: the plane class of every tag (unify.bend Unified.planes), read by the
# membrane cancellation (membrane.bend).
type Uc is Data:
  Uc{on: Bool, cm: U.Table<U32>, tz: F32, classes: U32, pc: U.Table<U32>}

def uc.of(u: UN.Unified) -> Uc:
  UN.Unified{ms, +nf, +n, _, +scale, _, pcs} = u
  Uc{U.nonzero(n), U.table(U32, nf, ms), (scale * UN.pow2(91) : F32), n, U.table(U32, nf, pcs)}

# The unified classes of a job's face table. maxabs: an upper bound of the
# largest |coordinate| of its leaf meshes.
def classes(faces: List<&2, M.FaceTag>, +maxabs: F32) -> Uc:
  uc.of(UN.decide(faces, maxabs))

# No unified class (malformed jobs).
def none() -> Uc:
  Uc{False{}, U.table(U32, 0, Nil{}), 0.0, 0, U.table(U32, 0, Nil{})}
