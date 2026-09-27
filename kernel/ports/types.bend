import Base
import ../real.bend as R
import ../precise.bend as G
import ../analytic.bend as A
import ../face-classification.bend as F
import ../intersections.bend as I

# Common comparison contract. A successful result is a complete regularized
# closed B-rep for dot(point-origin, normal) <= 0, never a section or mesh.
# Each port owns construction and documents its supported domain. Production
# dispatch is separate. Source inputs are immutable; no tolerance welding is
# implied by this interface.
type Reason is Data:
  InvalidInput{}
  InvalidTopology{}
  UnsupportedSurface{}
  UnsupportedCurve{}
  UnsupportedDomain{}
  SourceTolerance{}
  AmbiguousContact{}
  UnsupportedArrangement{}
  ResolutionLimit{}
  ConstructionFailure{}

type FaceOrigin is Data:
  SourceFace{index: U32}
  CutFace{}

type EdgeOrigin is Data:
  SourceEdge{index: U32}
  CutEdge{face: U32}
  SurfaceSeam{face: U32}

type Component is Data:
  Component{solid: A.Solid, domains: List<&2, F.DomainChoice>, face_origins: List<&2, FaceOrigin>, edge_origins: List<&2, EdgeOrigin>}

type Result is Data:
  Empty{}
  Clipped{solid: A.Solid, domains: List<&2, F.DomainChoice>, face_origins: List<&2, FaceOrigin>, edge_origins: List<&2, EdgeOrigin>}
  Components{bodies: List<&2, Component>}
  Unresolved{reason: Reason}

# Entrypoint required in every implementation:
# clip(solid: A.Solid, domains: List<&2, F.DomainChoice>, origin: G.Vec3,
#      normal: G.Vec3, tolerance: I.Tolerance, source_budget: R.Real) -> Result
