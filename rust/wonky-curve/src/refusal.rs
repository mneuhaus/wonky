//! Typed refusals of the curve crate.
//!
//! The spellings returned by [`Refusal::name`] are the historical refusal names
//! of the arc-profile and prism-stack strands. They appear verbatim in the
//! CAD-Acid observation files, so they are frozen: a rename is a behaviour
//! change of the kernel, not a refactoring.
use std::fmt;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Refusal {
    RealBudget,
    RealUndecided,
    RealFieldTower,
    /// A rational coordinate does not fit a finite binary64 enclosure.
    NumericRange,
    CircleRadiusClass,
    CirclePointOffCurve,
    SymbolicGreenUnavailable,
    /// An enclosure left the finite range (or became NaN).
    ObservationRange,
    /// An angle enclosure left the range the certified arctangent covers.
    AngleRange,
    /// Root-enclosure refinement exhausted its exact-arithmetic budget.
    RadicalBudget,
    /// A new feature cannot survive the declared STEP/reader export floor.
    SubResolutionFeature,
    /// Feature-size certification exceeded its bounded pair workload.
    ResolutionBudget,
    /// A carrier crossing exists but its coordinates are irrational in Q(sqrt r).
    QuadraticSplitVertexStorage,
    OverlappingArcs,
    OverlappingLines,
    /// A line and an arc cross away from a shared endpoint (simple-chain admission).
    LineArcIntersection,
    /// Two arcs cross away from a shared endpoint (simple-chain admission).
    ArcArcIntersection,
    /// The chord-tangent witness of an arc piece did not land strictly inside it.
    ArcInteriorWitness,
    /// The enclosed area of a cycle contains zero and no shortcut decided it.
    UnresolvedCycleOrientation,
    DegeneratePolygon,
    /// The three source points of an arc lie on one line.
    CollinearThreePointArc,
    /// The three source points of an arc have a zero certified sweep.
    ZeroArc,
    /// A piece's chord enclosure contains zero: it has no certified direction.
    EdgeLengthRange,
    /// A circle's radius enclosure contains zero.
    RadiusRange,
    /// A B-spline source is malformed: degree outside 1..=7, a knot vector that
    /// is not clamped and non-decreasing, a wrong pole or weight count, a
    /// weight that is not positive, or a degree elevation past degree 7.
    SplineInvalid,
    DegenerateSpan,
    FitBudget,
    FitSingular,
    FitResidual,
    ClosedFitSpline,
    /// The curve crosses or touches itself (certified).
    SplineSelfIntersecting,
    /// The hodograph vanishes, or the tangent reverses at a knot (a cusp).
    /// Named like a self-intersection: a cusp is a singular carrier.
    SplineCusp,
    /// Neither a crossing nor separation could be certified inside the budget
    /// (a tangential self-touch, for instance).
    SplineRegularityUndecided,
    /// A rational-arithmetic budget (subdivision depth, series order, root
    /// isolation) ran out before a certified answer existed.
    SplineBudget,
    /// The operation has no spline arm yet: a cut at an irrational parameter
    /// (S15), a closed spline as one arrangement piece (its ends coincide), and
    /// the B-rep, frame and serialization of a spline piece (S7/S9).
    SplineArrangement,
    /// A spline piece meets another piece at a point that is no rational
    /// vertex: an irrational parameter on both trims, or a certified crossing
    /// of two splines. It needs an algebraic (`OnCurve`) vertex (S15).
    CrossingNeedsAlgebraicVertex,
    /// A spline piece lies on the other piece's carrier along a span, or two
    /// pieces of one spline overlap in more than an end.
    CoincidentSplineCarriers,
    /// Two different splines: neither separation nor a crossing certificate
    /// within the subdivision budget (a tangential contact or a touch).
    SplineContactUndecided,
    /// Simple-chain admission: a spline piece meets another piece away from a
    /// shared end.
    SplineIntersection,
    /// A piece that crosses a C0 knot has no certified uniform flatten bound.
    SplineFlattenUncertified,
    /// The point is not on the spline piece.
    SplinePointOffCurve,
    /// The arrangement was asked for more source pieces than its budget allows.
    ArrangementBudget,
    /// Splitting the sources produced more distinct pieces than the budget allows.
    ArrangementSplitBudget,
    /// An irrational line/arc crossing inside an arrangement (the arrangement's
    /// own spelling of a `QuadraticSplitVertexStorage` contact, with its hint).
    ArrangementQuadraticCrossing,
    /// One cycle owns the same split piece twice.
    LeafSelfOverlap,
    /// Three or more rays at a vertex share a direction: no exact branch order.
    TangentBranchOrder,
    /// The half-edge walk did not close into disjoint face cycles.
    FaceWalk,
    /// A connected component has more than one exterior (negative) cycle.
    ComponentExterior,
    /// A component's exterior cycle has no unique innermost containing cell.
    NestingOrder,
    /// The seam of a full-turn piece is not on its circle.
    RingSeamOffCircle,
    /// An affine map would change a circle into a different conic.
    NonIsometricCircleMap,
}

impl Refusal {
    pub const fn name(self) -> &'static str {
        match self {
            Refusal::RealBudget => "exact-real/budget",
            Refusal::RealUndecided => "exact-real/predicate-undecided",
            Refusal::RealFieldTower => "exact-real/field-tower",
            Refusal::NumericRange => "arc-profile/numeric-range",
            Refusal::ObservationRange => "arc-profile/observation-range",
            Refusal::AngleRange => "arc-profile/angle-range",
            Refusal::RadicalBudget => "curve2/radical-budget",
            Refusal::SubResolutionFeature => "curve2/sub-resolution-feature",
            Refusal::ResolutionBudget => "curve2/resolution-budget",
            Refusal::QuadraticSplitVertexStorage => "arc-profile/quadratic-split-vertex-storage",
            Refusal::OverlappingArcs => "arc-profile/overlapping-arcs",
            Refusal::OverlappingLines => "arc-profile/overlapping-lines",
            Refusal::LineArcIntersection => "arc-profile/line-arc-intersection",
            Refusal::ArcArcIntersection => "arc-profile/arc-arc-intersection",
            Refusal::ArcInteriorWitness => "prism-stack/arc-interior-witness",
            Refusal::UnresolvedCycleOrientation => "prism-stack/unresolved-cycle-orientation",
            Refusal::DegeneratePolygon => "prism-stack/degenerate-polygon",
            Refusal::CollinearThreePointArc => "arc-profile/collinear-three-point-arc",
            Refusal::ZeroArc => "arc-profile/zero-arc",
            Refusal::EdgeLengthRange => "arc-profile/edge-length-range",
            Refusal::RadiusRange => "arc-profile/radius-range",
            Refusal::DegenerateSpan => "curve2/degenerate-span",
            Refusal::FitBudget => "curve2/fit-budget",
            Refusal::FitSingular => "curve2/fit-singular",
            Refusal::FitResidual => "curve2/fit-residual",
            Refusal::ClosedFitSpline => "curve2/closed-fit-spline",
            Refusal::SplineInvalid => "curve2/invalid-spline",
            Refusal::SplineSelfIntersecting | Refusal::SplineCusp => "curve2/self-intersecting-spline",
            Refusal::SplineRegularityUndecided => "curve2/spline-regularity-undecided",
            Refusal::SplineBudget => "curve2/spline-budget",
            Refusal::SplineArrangement => "curve2/spline-arrangement-unsupported",
            Refusal::CrossingNeedsAlgebraicVertex => "curve2/crossing-needs-algebraic-vertex",
            Refusal::CoincidentSplineCarriers => "curve2/coincident-spline-carriers",
            Refusal::SplineContactUndecided => "curve2/spline-contact-undecided",
            Refusal::SplineIntersection => "curve2/spline-intersection",
            Refusal::SplineFlattenUncertified => "curve2/spline-flatten-uncertified",
            Refusal::SplinePointOffCurve => "curve2/spline-point-off-curve",
            Refusal::ArrangementBudget => "prism-stack/arrangement-budget",
            Refusal::ArrangementSplitBudget => "prism-stack/arrangement-split-budget",
            Refusal::ArrangementQuadraticCrossing => "prism-stack/quadratic-crossing: an irrational line/arc crossing needs exact radical vertex storage",
            Refusal::LeafSelfOverlap => "prism-stack/leaf-self-overlap",
            Refusal::TangentBranchOrder => "prism-stack/tangent-branch-order",
            Refusal::FaceWalk => "prism-stack/face-walk",
            Refusal::ComponentExterior => "prism-stack/component-exterior",
            Refusal::NestingOrder => "prism-stack/nesting-order",
            Refusal::NonIsometricCircleMap => "curve2/non-isometric-circle-map",
            Refusal::CirclePointOffCurve => "curve2/circle-point-off-curve",
            Refusal::CircleRadiusClass => "curve2/circle-radius-class",
            Refusal::SymbolicGreenUnavailable => "curve2/symbolic-green-unavailable",
            Refusal::RingSeamOffCircle => "prism-stack/ring-seam-off-circle",
        }
    }
}

impl fmt::Display for Refusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.name())
    }
}

pub type R<T> = Result<T, Refusal>;
