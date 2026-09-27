import Base
import ../real.bend as R
import ../analytic.bend as A
import ../face-classification.bend as F
import ./types.bend as P

type FaceRef is Data:
  FaceRef{operand: U32, index: U32}
type FaceOrigin is Data:
  FaceOrigin{owner: FaceRef, contributors: List<&2, FaceRef>}
type EdgeOrigin is Data:
  OriginalEdge{operand: U32, index: U32}
  FaceIntersection{first: FaceRef, second: FaceRef}
  FaceSubdivision{faces: List<&2, FaceRef>}
type Body is Data:
  Body{solid: A.Solid, domains: List<&2, F.DomainChoice>, face_origins: List<&2, FaceOrigin>, edge_origins: List<&2, EdgeOrigin>}
type Stats is Data:
  Stats{planes: U32, cells: U32, selected_cells: U32, shared_vertices: U32, boundary_faces: U32, internal_interfaces: U32}
type Result is Data:
  Bodies{bodies: List<&2, Body>, source_budget: R.Real, stats: Stats}
  Unresolved{reason: P.Reason, stage: U32, detail: U32, source_budget: R.Real, stats: Stats}

def empty_stats() -> Stats:
  Stats{0, 0, 0, 0, 0, 0}

def rejected(reason: P.Reason, stage: U32, detail: U32, stats: Stats) -> Result:
  Unresolved{reason, stage, detail, R.from_f32(0.0), stats}

def face_equal(a: FaceRef, b: FaceRef) -> Bool:
  FaceRef{ao, ai} = a
  FaceRef{bo, bi} = b
  Bool.and(U32.is_eq(ao, bo), U32.is_eq(ai, bi))
