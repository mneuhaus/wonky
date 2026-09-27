import Base
import ./LAWS.bend as Laws
import ./kernel/geometry.bend as G
import ./kernel/topology.bend as T
import ./kernel/analytic.bend as A
import ./kernel/precise.bend as P
import ./kernel/boolean.bend as B
import ./kernel/comparison.bend as C
import ./kernel/identity.bend as Identity
import ./kernel/intersections.bend as Intersections
import ./kernel/ray.bend as Ray
import ./kernel/curve-plane.bend as CurvePlane
import ./kernel/edge-plane.bend as EdgePlane
import ./kernel/evaluate.bend as Evaluate
import ./kernel/face-classification.bend as FaceClassification
import ./kernel/cylinder-classification.bend as CylinderClassification
import ./kernel/solid-classification.bend as SolidClassification
import ./kernel/display.bend as Display
import ./kernel/boundary.bend as Boundary
import ./kernel/halfspace.bend as Halfspace
import ./kernel/face-plane.bend as FacePlane
import ./kernel/face-bounds.bend as FaceBounds
import ./kernel/junction.bend as Junction
import ./kernel/curve-band.bend as CurveBand
import ./kernel/sketch-lines.bend as SketchLines
import ./kernel/sketch-arcs.bend as SketchArcs
import ./kernel/section.bend as Section
import ./kernel/revolve.bend as Revolve
import ./kernel/tessellate.bend as Tessellate
import ./kernel/pierce.bend as Pierce
import ./kernel/polygon-prism.bend as PolygonPrism
import ./kernel/robust-predicates.bend as RobustPredicates
import ./kernel/profile-ring.bend as ProfileRing
import ./kernel/ports/occt.bend as OcctPort
import ./kernel/ports/solvespace.bend as SolveSpacePort
import ./kernel/ports/truck.bend as TruckPort
import ./kernel/ports/hybrid.bend as HybridPort
import ./kernel/ports/solid-intersection.bend as SolidIntersection
import ./kernel/ports/curved.bend as CurvedPort
import ./kernel/ports/curved-intersection.bend as CurvedIntersection
import ./kernel/ports/planar-boolean.bend as PlanarBoolean
import ./kernel/step-pcurves.bend as StepPCurves
import ./kernel/step-cylinder-pcurves.bend as StepCylinderPCurves
import ./kernel/volume.bend as Volume

def Laws.coedge_flip_involution(use):
  match use:
    case T.Use{edge, True{}}:
      {==}
    case T.Use{edge, False{}}:
      {==}

def Laws.translation_preserves_vertex_count(points, delta):
  match points:
    case Nil{}:
      {==}
    case p <> tail:
      %Laws.translation_preserves_vertex_count(tail, delta) :
        {1n+List.length(&2, G.Vec3, G.translate(tail, delta)) == 1n+_ : Nat}
      {==}

def Laws.boolean_union_partition(a, b):
  match a:
    case True{}:
      match b:
        case True{}:
          {==}
        case False{}:
          {==}
    case False{}:
      match b:
        case True{}:
          {==}
        case False{}:
          {==}

def Laws.boolean_differences_disjoint(a, b):
  match a:
    case True{}:
      match b:
        case True{}:
          {==}
        case False{}:
          {==}
    case False{}:
      match b:
        case True{}:
          {==}
        case False{}:
          {==}

# Reachability, not a law: `bend PROOF.bend` checks only the definitions
# reachable from this file, so the general revolve and the sphere/torus
# carriers (kernel/revolve.bend `sweep`, kernel/analytic.bend) are named here.
def revolve_sweep_checked() -> Revolve.Sweep:
  Revolve.sweep(Nil{}, Revolve.Full{}, Revolve.zero(), P.v3(0.0, 0.0, 0.0), P.v3(0.0, 0.0, 1.0), P.v3(1.0, 0.0, 0.0))

def revolve_sweep_volume_checked() -> Revolve.Ring:
  Revolve.Ring{Revolve.sweep_volume(Nil{}, Revolve.Full{}), Revolve.zero()}

def analytic_surface_residual_checked(surface: A.Surface, point: P.Vec3) -> F32:
  A.surface_residual(surface, point)

# Reachability, not a law: the integrated volume (kernel/volume.bend) and its
# closed-form boundary integrals are checked with the rest of the kernel.
def volume_checked(faces: List<&2, Volume.VFace>) -> Volume.Volume:
  Volume.volume(faces, Volume.zero())
