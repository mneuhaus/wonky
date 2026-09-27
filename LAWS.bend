import Base
import ./kernel/geometry.bend as G
import ./kernel/topology.bend as T
import ./kernel/boolean.bend as B

# Discrete invariants only. These laws do not prove floating-point robustness,
# manifoldness, or that a FeatureScript program matches Onshape's evaluator.
law coedge_flip_involution:
  for +use: T.Coedge
  {T.flip(T.flip(use)) == use : T.Coedge}

law translation_preserves_vertex_count:
  for +points: List<&2, G.Vec3>
  for +delta: G.Vec3
  {List.length(&2, G.Vec3, G.translate(points, delta)) == List.length(&2, G.Vec3, points) : Nat}

# These laws cover the membership truth table used by the cell arrangement,
# not whether a geometric classifier assigns a point to the right input solid.
law boolean_union_partition:
  for +a: Bool
  for +b: Bool
  {B.selected(0, a, b) == Bool.or(B.selected(1, a, b), Bool.or(B.selected(2, a, b), B.selected(2, b, a))) : Bool}

law boolean_differences_disjoint:
  for +a: Bool
  for +b: Bool
  {Bool.and(B.selected(2, a, b), B.selected(2, b, a)) == False{} : Bool}
