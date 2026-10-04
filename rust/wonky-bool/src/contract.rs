//! The in-run contracts of stages P0-P5 (plan §2.1: `boolean/contract-violation:<stage>/<check>`).
//! Each is checked on every run and fails closed. A violation is a kernel
//! defect (or an operand that passed the model audit although it is
//! invalid); it scores REFUSED, never WRONG, and is never an expected outcome.
//!
//! P4 has no check of its own: a piece end is a P3 pave filtered by both
//! plane equations, and the line it lies on passed `relation/line-identity`.

/// P0: a planar operand has a vertex-free ring edge (the model audit admits
/// rings only on closed curves, and a line is not closed).
pub const RING_ON_LINE: &str = "boolean/contract-violation:admission/ring-on-line";
/// P1: the relation decided for (b, a) is not the mirror of the one for (a, b).
pub const RELATION_SYMMETRIC: &str = "boolean/contract-violation:relation/symmetric";
/// P1: provenance proves two carriers identical, but their exact data are not.
pub const RELATION_PROVENANCE: &str = "boolean/contract-violation:relation/provenance";
/// P1: a transverse section line does not satisfy both plane equations.
pub const RELATION_LINE: &str = "boolean/contract-violation:relation/line-identity";
/// P2: an exact point lies outside the certified box built around it.
pub const BOX_CONTAINS: &str = "boolean/contract-violation:candidates/box-contains";
/// P3: a point located in a face does not lie on the face's carrier.
pub const OFF_PLANE: &str = "boolean/contract-violation:interference/off-plane";
/// P3: a vertex lies on a face boundary that V-V and V-E did not record.
pub const VERTEX_FACE_BOUNDARY: &str = "boolean/contract-violation:interference/vertex-face-boundary";
/// P3: an edge meets a face boundary at a point that V-E and E-E did not record.
pub const EDGE_FACE_BOUNDARY: &str = "boolean/contract-violation:interference/edge-face-boundary";
/// P3: a new edge-face point equals a known point that is not on the edge.
pub const POINT_IDENTITY: &str = "boolean/contract-violation:interference/point-identity";
/// P3: a pave is not on its edge, or two paves share a parameter.
pub const PAVE_ON_EDGE: &str = "boolean/contract-violation:interference/pave-on-edge";

/// P5: two P3 points share a chart point of one face, or a pcurve end or a
/// section piece end is not the chart point of its P3 point.
pub const SPLIT_CHART_IDENTITY: &str = "boolean/contract-violation:split/chart-identity";
/// P5: the arrangement cut a source piece at a contact P3/P4 did not record.
pub const SPLIT_UNRECORDED: &str = "boolean/contract-violation:split/unrecorded-contact";
/// P5: two pieces of a face (slits included) meet away from a shared end.
pub const SPLIT_CONTACT: &str = "boolean/contract-violation:split/contact";
/// P5: a half-edge lies in no cycle or in two, its cycle's cell is not the
/// cell on its left, or the unbounded side is not the outer loop's exterior.
pub const SPLIT_HALF_EDGE: &str = "boolean/contract-violation:split/half-edge-cycles";
/// P5: a cell's outer cycle is not counter-clockwise or a hole cycle not clockwise.
pub const SPLIT_ORIENTATION: &str = "boolean/contract-violation:split/orientation";
/// P5: a cell's witness is not strictly inside it, or lies in another cell too.
pub const SPLIT_WITNESS: &str = "boolean/contract-violation:split/witness";
/// P5: the fragments are not the cells the face winds around, or a cell outside
/// the face has a boundary piece that no hole loop owns.
pub const SPLIT_MEMBERSHIP: &str = "boolean/contract-violation:split/membership";
/// P5: `V - E + F - R != 1` in a face chart.
pub const SPLIT_EULER: &str = "boolean/contract-violation:split/euler";

/// P6: two coplanar faces of the other operand give a fragment opposite
/// ON orientations.
pub const CLASSIFY_ON: &str = "boolean/contract-violation:classify/on-orientation";
/// P6: the local side tests of one fragment disagree, or one is zero at a
/// transverse section piece.
pub const CLASSIFY_LOCAL: &str = "boolean/contract-violation:classify/local";
/// P6: an old edge sub-range is not used by exactly two fragments.
pub const CLASSIFY_EDGE_USES: &str = "boolean/contract-violation:classify/edge-uses";
/// P6: propagation reaches a fragment whose class another seed decided otherwise.
pub const CLASSIFY_PROPAGATION: &str = "boolean/contract-violation:classify/propagation";
/// P6: the direct ray membership of a fragment's witness (the second opinion)
/// disagrees with its propagated classification.
pub const CLASSIFY_SECOND_OPINION: &str = "boolean/contract-violation:classify/second-opinion";

/// P7: a sewn edge has an odd number of uses, or two uses in one direction.
pub const ASSEMBLE_EDGE: &str = "boolean/contract-violation:assemble/edge-use";
/// P7: the kept cells of one face, re-joined, touch themselves at a vertex
/// (a pinched region). Exact planar normalization cannot emit a simple
/// face loop for this region, so it still refuses by this name.
pub const MERGE_PINCH: &str = "boolean/merge-unavailable:pinched-face";
/// P7: a shell has exactly zero signed volume.
pub const ASSEMBLE_VOLUME: &str = "boolean/contract-violation:assemble/shell-volume";
/// P7: a void shell lies in no outer shell.
pub const ASSEMBLE_NESTING: &str = "boolean/contract-violation:assemble/nesting";
/// P7: the model audit G1-G8 refuses the assembled result.
pub const ASSEMBLE_AUDIT: &str = "boolean/contract-violation:assemble/audit";
/// P6: the membership ray of a component without a local seed starts on the
/// other operand's boundary although the coplanar test found no face there.
pub const CLASSIFY_RAY: &str = "boolean/contract-violation:classify/ray-start";

/// P6: no ray of the fixed direction list avoids every edge and face plane
/// of the other operand (rule X5: a budget ends in a named refusal).
pub const CLASSIFICATION_UNDECIDED: &str = "boolean/classification-undecided";

/// FeatureScript semantics (AC13, AC15): the regularized result is empty.
pub const EMPTY_RESULT: &str = "boolean/empty-result";
/// FeatureScript semantics (AC12): the regularized result is not a manifold
/// solid (an edge with four uses, a vertex whose link is not one cycle, or a
/// point or line contact inside a face).
pub const NON_MANIFOLD_RESULT: &str = "boolean/non-manifold-result";
