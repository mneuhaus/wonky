use super::*;
use std::collections::BTreeSet;
use wonky_num::expansion as ex;
use wonky_num::Sign;

fn require(yes: bool, what: &'static str) -> Result<()> {
    if yes {
        Ok(())
    } else {
        Err(ContractError::Invalid(what))
    }
}
fn at<'a, T>(items: &'a [T], index: u32, what: &'static str) -> Result<&'a T> {
    items
        .get(index as usize)
        .ok_or(ContractError::Reference(what, index))
}
fn compare(a: Binary64, b: Binary64) -> Result<Sign> {
    numeric::compare(a.get(), b.get()).map_err(ContractError::Numeric)
}
fn positive(x: Binary64) -> Result<()> {
    require(Sign::of_exact(x.get()) == Sign::Positive, "positive scalar")
}
fn nonnegative(x: Binary64) -> Result<()> {
    require(Sign::of_exact(x.get()) != Sign::Negative, "negative bound")
}
fn direction(p: Vector3) -> Result<()> {
    require(
        numeric::nonzero(point(p)).map_err(ContractError::Numeric)?,
        "zero direction",
    )
}
fn axes(n: Vector3, x: Vector3) -> Result<()> {
    direction(n)?;
    direction(x)?;
    require(
        numeric::plane_side(point(n), point(x), v3(0., 0., 0.)).map_err(ContractError::Numeric)?
            == Sign::Zero,
        "nonorthogonal carrier axes",
    )
}
fn domain(d: &Domain) -> Result<()> {
    match (&d.lower, &d.upper) {
        (Limit::NegativeInfinity {}, Limit::Finite { .. } | Limit::PositiveInfinity {})
        | (Limit::Finite { .. }, Limit::PositiveInfinity {}) => Ok(()),
        (Limit::Finite { value: a, .. }, Limit::Finite { value: b, .. }) => {
            require(compare(*a, *b)? == Sign::Negative, "empty/reversed domain")
        }
        _ => Err(ContractError::Invalid("domain infinities")),
    }
}
fn arc_domain(arc: &ArcKind, d: &Domain) -> Result<()> {
    if matches!(arc, ArcKind::Full {}) {
        let (
            Limit::Finite {
                value: a,
                closed: true,
            },
            Limit::Finite {
                value: b,
                closed: true,
            },
        ) = (&d.lower, &d.upper)
        else {
            return Err(ContractError::Invalid("full arc domain"));
        };
        require(
            compare(*a, Binary64::new(0.)?)? == Sign::Zero
                && compare(*b, Binary64::new(1.)?)? == Sign::Zero,
            "full arc domain",
        )?;
    } else {
        require(
            matches!(d.lower, Limit::Finite { .. }) && matches!(d.upper, Limit::Finite { .. }),
            "trimmed arc domain",
        )?;
    }
    Ok(())
}
/// Shared B-spline structure of a curve or pcurve carrier: degree 1..=7, a
/// clamped non-decreasing knot vector of length controls + degree + 1 (every
/// interior knot of multiplicity at most degree), and no weights or one positive
/// weight per control. Returns the closed knot interval, the carrier's domain.
fn bspline(degree: u32, knots: &[Binary64], controls: usize, weights: &[Binary64]) -> Result<Domain> {
    let p = degree as usize;
    require((1..=sketch3::MAX_DEGREE).contains(&p), "bspline degree")?;
    require(controls > p && knots.len() == controls + p + 1, "bspline knot count")?;
    for pair in knots.windows(2) {
        require(compare(pair[0], pair[1])? != Sign::Positive, "bspline knots decrease")?;
    }
    let (first, last) = (knots[0], knots[knots.len() - 1]);
    require(compare(first, last)? == Sign::Negative, "bspline empty knot interval")?;
    // Clamped ends (multiplicity degree + 1, so never more) and interior
    // multiplicity at most degree: the curve is defined, continuous and starts
    // and ends on its first and last control.
    for (i, k) in knots.iter().enumerate() {
        let end = if i <= p { first } else if i >= knots.len() - p - 1 { last } else { continue };
        require(compare(*k, end)? == Sign::Zero, "bspline not clamped")?;
    }
    let interior = &knots[p + 1..knots.len() - p - 1];
    let mut run = 0;
    for i in 0..interior.len() {
        // An interior knot equal to an end knot would raise that end's multiplicity above degree + 1.
        require(
            compare(interior[i], first)? == Sign::Positive && compare(interior[i], last)? == Sign::Negative,
            "bspline interior knot at an end",
        )?;
        run = if i > 0 && compare(interior[i], interior[i - 1])? == Sign::Zero { run + 1 } else { 1 };
        require(run <= p, "bspline interior knot multiplicity")?;
    }
    require(weights.is_empty() || weights.len() == controls, "bspline weight count")?;
    for w in weights {
        positive(*w)?;
    }
    Ok(Domain { lower: Limit::Finite { value: first, closed: true }, upper: Limit::Finite { value: last, closed: true } })
}
fn endpoint(l: &Limit) -> Option<Binary64> {
    match l {
        Limit::Finite { value, .. } => Some(*value),
        _ => None,
    }
}
fn in_domain(inner: &Domain, outer: &Domain) -> Result<()> {
    domain(inner)?;
    for (i, o, sign) in [
        (&inner.lower, &outer.lower, Sign::Negative),
        (&inner.upper, &outer.upper, Sign::Positive),
    ] {
        match (i, o) {
            (_, Limit::NegativeInfinity {} | Limit::PositiveInfinity {}) => {}
            (
                Limit::Finite {
                    value: a,
                    closed: ac,
                },
                Limit::Finite {
                    value: b,
                    closed: bc,
                },
            ) => {
                let cmp = compare(*a, *b)?;
                require(
                    cmp != sign && !(cmp == Sign::Zero && *ac && !*bc),
                    "domain outside carrier",
                )?;
            }
            _ => return Err(ContractError::Invalid("domain outside carrier")),
        }
    }
    Ok(())
}
fn magnitude(b: &Bound) -> Binary64 {
    match b {
        Bound::Estimated { estimate } => estimate.magnitude,
        Bound::Enclosed { claim } => claim.magnitude,
    }
}
fn bound(b: &Bound, nodes: &[Construction]) -> Result<()> {
    nonnegative(magnitude(b))?;
    if let Bound::Enclosed { claim } = b {
        // An opaque producer claim is NOT promoted into a verified certificate.
        // Its inputs are still bound and cannot dangle or refer to another body.
        require(claim.witness.rule != 0, "zero enclosure claim rule")?;
        require(!claim.witness.nodes.is_empty(), "unbound enclosure claim")?;
        let mut seen = BTreeSet::new();
        for n in &claim.witness.nodes {
            at(nodes, n.0, "bound node")?;
            require(seen.insert(n.0), "duplicate bound node")?;
        }
    }
    Ok(())
}
fn budget(b: &Budget, nodes: &[Construction]) -> Result<()> {
    let stages = [&b.approximation, &b.construction, &b.integration, &b.export];
    for stage in stages.into_iter().chain([&b.total]) {
        bound(stage, nodes)?;
    }
    nonnegative(b.maximum)?;
    positive(b.scale)?;
    nonnegative(b.reference_width)?;
    if matches!(b.total, Bound::Enclosed { .. }) {
        require(
            stages.iter().all(|b| matches!(b, Bound::Enclosed { .. })),
            "estimate promoted by total",
        )?;
    }
    let mut g = ex::Guard::new();
    let mut remaining = vec![magnitude(&b.total).get()];
    for s in stages {
        remaining = ex::sum(&remaining, &[-magnitude(s).get()], &mut g);
    }
    require(
        numeric::finish(&remaining, &g).map_err(ContractError::Numeric)? != Sign::Negative,
        "understated composite budget",
    )?;
    if compare(magnitude(&b.total), b.maximum)? == Sign::Positive {
        return Err(ContractError::WidthExceeded);
    }
    let relative = match b.quantity {
        Quantity::VolumeClosed {} => Some(1e-9),
        Quantity::VolumeQuadrature {} => Some(1e-7),
        _ => None,
    };
    if let Some(relative) = relative {
        positive(b.reference_width)?;
        // Compare exactly; a rounded product is never a policy certificate.
        let cap = ex::product(b.scale.get(), relative, &mut g);
        let diff = ex::sum(&cap, &[-b.maximum.get()], &mut g);
        if numeric::finish(&diff, &g).map_err(ContractError::Numeric)? == Sign::Negative {
            return Err(ContractError::WidthExceeded);
        }
        let ten = ex::product(b.maximum.get(), 10., &mut g);
        let diff = ex::sum(&[b.reference_width.get()], &ex::neg(&ten), &mut g);
        if numeric::finish(&diff, &g).map_err(ContractError::Numeric)? == Sign::Negative {
            return Err(ContractError::WidthExceeded);
        }
    }
    Ok(())
}

/// Structurally checked transport plus re-proved Contained facts. NOT an audited
/// manifold solid and NOT a verified tube/volume/error enclosure. Mutation yields
/// a raw Body and requires check() again. Local IDs are scoped to this snapshot.
#[derive(Clone, Debug)]
pub struct CheckedBody {
    body: Body,
}
impl CheckedBody {
    pub fn body(&self) -> &Body {
        &self.body
    }
    pub fn into_body(self) -> Body {
        self.body
    }
    pub fn contained(&self, curve: CurveId, surface: SurfaceId) -> Result<Incidence> {
        at(&self.body.curves, curve.0, "curve")?;
        at(&self.body.surfaces, surface.0, "surface")?;
        if self.body.facts.iter().any(|f| matches!(f, Fact::CurveOnSurface { claim } if claim.curve == curve && claim.surface == surface)) {
            Ok(Incidence::Contained)
        } else { Err(ContractError::NoProvenance) }
    }
}
impl Body {
    pub fn check(self) -> Result<CheckedBody> {
        require(!self.frames.is_empty(), "missing source frame")?;
        for (i, frame) in self.frames.iter().enumerate() {
            if let Frame::Rigid { parent, .. } | Frame::Interpreter { parent, .. } = frame {
                require((parent.0 as usize) < i, "frame cycle/forward reference")?;
            }
            match frame {
                Frame::RationalImage { base, rows, denominator } => {
                    require((base.0 as usize) < i, "rational image cycle/forward reference")?;
                    require(denominator.get() > 0., "rational image denominator")?;
                    let [a,b,c] = rows.map(point);
                    let determinant = wonky_num::orient3d(a,b,c,wonky_num::v3(0.,0.,0.),"rational image determinant").map_err(|e| ContractError::Numeric(e.into_refusal()))?;
                    require(determinant != wonky_num::Sign::Zero, "singular rational image")?;
                }
                Frame::AffineImage { base, rows, .. } => {
                    require((base.0 as usize) < i, "affine image cycle/forward reference")?;
                    let [a, b, c] = rows.map(point);
                    let determinant = wonky_num::orient3d(a, b, c, wonky_num::v3(0., 0., 0.), "affine image determinant")
                        .map_err(|e| ContractError::Numeric(e.into_refusal()))?;
                    require(determinant != wonky_num::Sign::Zero, "singular affine image")?;
                }
                Frame::InterpreterImage { base, x, z, .. } => {
                    require((base.0 as usize) < i, "interpreter image cycle/forward reference")?;
                    direction(*x)?;
                    direction(*z)?;
                    // Same exact non-degeneracy as an interpreter frame: the
                    // determinant is |z cross x|^2, so parallel axes are singular.
                    require(
                        !numeric::parallel(point(*x), point(*z)).map_err(ContractError::Numeric)?,
                        "interpreter image axes parallel",
                    )?;
                }
                Frame::Source { .. } => {}
                Frame::Rigid { axis, .. } => direction(*axis)?,
                Frame::Interpreter { parent, x, z, .. } => {
                    require(
                        matches!(self.frames[parent.0 as usize], Frame::Source { .. }),
                        "interpreter frame parent is not a source frame",
                    )?;
                    direction(*x)?;
                    direction(*z)?;
                    // Axes as passed, never orthogonalized; only a degenerate
                    // (parallel) pair is refused, exactly.
                    require(
                        !numeric::parallel(point(*x), point(*z)).map_err(ContractError::Numeric)?,
                        "interpreter frame axes parallel",
                    )?;
                }
            }
        }
        for (i, n) in self.constructions.iter().enumerate() {
            at(&self.frames, n.frame.0, "construction frame")?;
            // Intersection rule 2 records equal-offset planar clipping. The
            // operation audit replays the parent and validates every witness.
            let planar_chamfer = n.rule_version == 2
                && n.operation == (Operation::Intersection {})
                && n.parents.len() == 1 && n.parameters.len() >= 2;
            // Rule 3 clips circular cap rims with exact slope-cone bands.
            let circular_chamfer = n.rule_version == 3
                && n.operation == (Operation::Intersection {})
                && n.parents.len() == 1 && n.parameters.len() == 3;
            // Rule 4 chamfers a perforated box in one operation: planar setbacks
            // on straight edges and two-ring cones on hole rims. [width, edges...]
            let perforated_chamfer = n.rule_version == 4
                && n.operation == (Operation::Intersection {})
                && n.parents.len() == 1 && n.parameters.len() >= 2;
            // Perforated-box replay retains independent operand frame DAGs.
            // Each triple is (source kind, frame count, construction count);
            // the operation auditor authenticates and clips the exact sources.
            let perforated_sources = n.rule_version == 2 && n.operation == (Operation::Boolean {})
                && (2..=65).contains(&n.parents.len())
                && n.parameters.len() == 3 * n.parents.len();
            // Replayed axial hole arrangement: operation plus one source-layout
            // triple per operand. Geometric admission remains the op auditor's job.
            let axial_holes = n.rule_version == 3 && n.operation == (Operation::Boolean {})
                && (2..=65).contains(&n.parents.len())
                && n.parameters.len() == 1 + 3 * n.parents.len()
                && n.parameters[0].get() == 1.;
            // Sketch rule 2 declares bounded circular-carrier regularization:
            // [selected region, cap in mm]. The operation audit recomputes the
            // exact displacement proof from the unchanged interpreter inputs.
            let regularized_sketch = n.rule_version == 2 && n.operation == (Operation::Sketch {})
                && n.parents.len() == 1 && n.parameters.len() == 2
                && n.parameters[0].get() >= 0. && n.parameters[0].get() <= u32::MAX as f64
                && n.parameters[0].get().fract() == 0. && n.parameters[1].get() >= 0.;
            // Sketch rule 3: the tagged entity list (sketch3.rs). Structure only;
            // the operation that replays the sketch owns geometric admission.
            let tagged_sketch = n.rule_version == 3 && n.operation == (Operation::Sketch {})
                && n.parents.len() == 1
                && sketch3::parse(&n.parameters.iter().map(|p| p.get()).collect::<Vec<_>>()).is_ok();
            // Sketch rule 4: a cell of the shared exact arrangement. Its
            // parent interpreter retains lines, arcs and circles; audit replays
            // contacts and region selection, never rounded split vertices.
            let arranged_sketch = n.rule_version == 4 && n.operation == (Operation::Sketch {})
                && n.parents.len() == 1 && n.parameters.len() == 1
                && n.parameters[0].get() >= 0. && n.parameters[0].get() <= u32::MAX as f64
                && n.parameters[0].get().fract() == 0.;
            // Coaxial meridian Boolean: exact rational arrangement, with original
            // source DAGs retained and replayed by the revolution auditor.
            let meridian_boolean = n.rule_version == 4 && n.operation == (Operation::Boolean {})
                && (2..=32).contains(&n.parents.len())
                && n.parameters.len() == 1 + 3 * n.parents.len()
                && [0., 1., 2.].contains(&n.parameters[0].get());
            // Stacked-prism Boolean: same operand layout; the prism-stack audit
            // replays every source and rebuilds the rational arrangement.
            let stacked_boolean = n.rule_version == 5 && n.operation == (Operation::Boolean {})
                && (2..=64).contains(&n.parents.len())
                && n.parameters.len() == 1 + 3 * n.parents.len()
                && [0., 1., 2.].contains(&n.parameters[0].get());
            // General Model replay: [operation, -6, optional exact solid index].
            // The older axial-column rule 6 layout remains unchanged.
            let model_chamfer = [11,12].contains(&n.rule_version) && n.operation == (Operation::Intersection {})
                && n.parents.len() == 1 && n.parameters.len() >= if n.rule_version==12 {3} else {2}
                && n.parameters[0].get() > 0.
                && (n.rule_version!=12 || [0.,1.].contains(&n.parameters[1].get()))
                && n.parameters[if n.rule_version==12 {2} else {1}..].iter().all(|p| p.get() >= 0. && p.get() <= u32::MAX as f64 && p.get().fract() == 0.);
            // Source-replayed plane/plane generator surgery. Geometry admission
            // belongs to the shared Model audit; this only admits its DAG header.
            let model_fillet = n.rule_version == 13 && n.operation == (Operation::Fillet {})
                && n.parents.len() == 1 && n.parameters.len() >= 2
                && n.parameters[0].get() > 0.
                && n.parameters[1..].iter().all(|p| p.get() >= 0. && p.get() <= u32::MAX as f64 && p.get().fract() == 0.);
            let model_boolean = n.rule_version == 6 && n.operation == (Operation::Boolean {})
                && (2..=64).contains(&n.parents.len()) && (2..=3).contains(&n.parameters.len())
                && [0., 1., 2.].contains(&n.parameters[0].get()) && n.parameters[1].get() == -6.
                && (n.parameters.len() == 2 || (n.parameters[2].get() >= 0.
                    && n.parameters[2].get() <= u32::MAX as f64 && n.parameters[2].get().fract() == 0.));
            // Model placement (rule 6): one exact image of a replayed Model.
            // The affine arm below checks that its frame images the parent's.
            let model_placement = n.rule_version == 6 && n.operation == (Operation::AffineTransform {})
                && n.parents.len() == 1 && n.parameters.is_empty();
            // General Boolean source leaf (rule 7): [kind, first frame counted
            // back from the node's frame, frame count, node count] of one
            // operand's own source DAG, whose last
            // node is the single parent. Structural admission only: Model
            // replay rebuilds and audits the operand from that DAG alone.
            let model_source = n.rule_version == 7 && n.operation == (Operation::Boolean {})
                && n.parents.len() == 1 && n.parameters.len() == 4
                && n.parameters.iter().all(|p| p.get() >= 0. && p.get() <= u32::MAX as f64 && p.get().fract() == 0.);
            // Replayed axial column arrangement: one source-layout triple per
            // operand, then one operation (0 union, 1 difference) per tool.
            let axial_columns = n.rule_version == 6 && n.operation == (Operation::Boolean {})
                && (2..=65).contains(&n.parents.len())
                && n.parameters.len() == 4 * n.parents.len() - 1
                && n.parameters[3 * n.parents.len()..].iter().all(|p| [0., 1.].contains(&p.get()));
            // Profile-generator rule 8 retains a source extrusion and records
            // [size, corner indices...]. The profile-blend auditor replays the
            // rational offsets and authenticates the complete carrier cache.
            let profile_blend = n.rule_version == 8
                && matches!(n.operation, Operation::Fillet {} | Operation::Intersection {})
                && n.parents.len() == 1 && n.parameters.len() >= 2
                && n.parameters[0].get() > 0.
                && n.parameters[1..].iter().all(|p| {
                    let v = p.get();
                    v >= 0. && v <= u32::MAX as f64 && v.fract() == 0.
                });
            let stack_blend = n.rule_version == 9
                && matches!(n.operation, Operation::Fillet {} | Operation::Intersection {})
                && n.parents.len() == 1 && n.parameters.len() >= 2
                && n.parameters[0].get() > 0.
                && n.parameters[1..].iter().all(|p| {
                    let v = p.get(); v >= 0. && v <= u32::MAX as f64 && v.fract() == 0.
                });
            // Stacked generator rule 10 records [size, source edge indices...].
            // This is structural admission only: the stack auditor replays the
            // slab trims and compares every carrier and incidence to the cache.
            let stack_generator = n.rule_version == 10
                && matches!(n.operation, Operation::Fillet {} | Operation::Intersection {})
                && n.parents.len() == 1 && n.parameters.len() >= 2
                && n.parameters[0].get() > 0.
                && n.parameters[1..].iter().all(|p| {
                    let v = p.get(); v >= 0. && v <= u32::MAX as f64 && v.fract() == 0.
                });
            if n.rule_version != 1 && !stack_generator && !stack_blend && !regularized_sketch && !tagged_sketch && !arranged_sketch && !planar_chamfer && !circular_chamfer && !perforated_chamfer && !axial_holes && !perforated_sources && !meridian_boolean && !stacked_boolean && !axial_columns && !model_boolean && !model_placement && !model_source && !model_chamfer && !model_fillet && !profile_blend && !(n.rule_version == 2 && n.operation == (Operation::Revolve {})) {
                return Err(ContractError::UnsupportedWitness(n.rule_version));
            }
            for parent in &n.parents {
                require(
                    (parent.0 as usize) < i,
                    "construction cycle/forward reference",
                )?;
            }
            match n.operation {
                Operation::Interpreter {} => {
                    require(n.parents.is_empty(), "interpreter parents")?;
                    require(
                        matches!(self.frames[n.frame.0 as usize], Frame::Source { .. }),
                        "interpreter not in source frame",
                    )?;
                }
                Operation::LineThrough {} | Operation::Plane {} | Operation::Point {} => {
                    require(
                        n.parents.len() == 1 && n.parameters.is_empty(),
                        "source rule arity",
                    )?;
                    let input = &self.constructions[n.parents[0].0 as usize];
                    require(
                        matches!(input.operation, Operation::Interpreter {})
                            && input.frame == n.frame,
                        "source rule input",
                    )?;
                    let count = match n.operation {
                        Operation::LineThrough {} => 6,
                        Operation::Point {} => 3,
                        _ => 9,
                    };
                    require(input.parameters.len() == count, "source rule parameters")?;
                }
                Operation::AffineTransform {} => {
                    require(n.parents.len() == 1 && n.parameters.is_empty(), "affine rule arity")?;
                    let input = &self.constructions[n.parents[0].0 as usize];
                    require(matches!(&self.frames[n.frame.0 as usize], Frame::AffineImage { base, .. } | Frame::InterpreterImage { base, .. } | Frame::RationalImage { base, .. } | Frame::Rigid { parent: base, .. } if *base == input.frame), "affine frame chain")?;
                }
                Operation::RigidTransform {} => {
                    require(
                        n.parents.len() == 1 && n.parameters.is_empty(),
                        "rigid rule arity",
                    )?;
                    let input = &self.constructions[n.parents[0].0 as usize];
                    require(
                        matches!(&self.frames[n.frame.0 as usize], Frame::Rigid { parent, .. } if *parent == input.frame),
                        "rigid frame chain",
                    )?;
                }
                _ => require(!n.parents.is_empty(), "operation without inputs")?,
            }
        }
        for v in &self.vertices {
            self.origin(v.frame, &v.provenance)?;
        }
        for s in &self.surfaces {
            self.origin(s.frame, &s.provenance)?;
            match s.geometry {
                SurfaceGeometry::Plane { normal, x, .. } => axes(normal, x)?,
                SurfaceGeometry::ConeMeridian { axis, x, start, end, .. } => {
                    // One meridian point may lie on the axis: it is the apex.
                    // Distinct radii exclude a zero-radius (both-apex) carrier.
                    axes(axis,x)?; nonnegative(start[0])?; nonnegative(end[0])?;
                    require(start[0] != end[0] && start[1] != end[1], "degenerate cone meridian")?;
                },
                SurfaceGeometry::Cylinder {
                    axis, x, radius, ..
                }
                | SurfaceGeometry::Sphere {
                    axis, x, radius, ..
                } => {
                    axes(axis, x)?;
                    positive(radius)?;
                }
                SurfaceGeometry::ConeSlope { axis, x, radius, slope, .. } => {
                    axes(axis, x)?;
                    nonnegative(radius)?;
                    positive(slope)?;
                }
                SurfaceGeometry::Cone {
                    axis,
                    x,
                    radius,
                    angle,
                    ..
                } => {
                    axes(axis, x)?;
                    nonnegative(radius)?;
                    positive(angle)?;
                }
                SurfaceGeometry::Torus {
                    axis,
                    x,
                    major,
                    minor,
                    ..
                } => {
                    axes(axis, x)?;
                    positive(major)?;
                    positive(minor)?;
                }
                SurfaceGeometry::LinearExtrusion { curve, direction: d } => {
                    direction(d)?;
                    let swept = at(&self.curves, curve.0, "extrusion curve")?;
                    // The generator direction lives in the frame of the swept
                    // curve; a curve in another frame is a different surface.
                    require(swept.frame == s.frame, "extrusion curve frame")?;
                    // One representation per surface: a circle swept along its
                    // axis is a Cylinder, a line a Plane. Only a spline is swept.
                    let sweepable = match swept.geometry {
                        CurveGeometry::BSpline { .. } => true,
                        CurveGeometry::ConstructionLine { .. }
                        | CurveGeometry::ConstructionCurve { .. }
                        | CurveGeometry::CylinderIntersection { .. }
                        | CurveGeometry::VectorEllipse { .. }
                        | CurveGeometry::SphereCircle { .. }
                        | CurveGeometry::Line { .. }
                        | CurveGeometry::Circle { .. }
                        | CurveGeometry::Ellipse { .. }
                        | CurveGeometry::Parabola { .. }
                        | CurveGeometry::Hyperbola { .. }
                        | CurveGeometry::Trace { .. } => false,
                    };
                    require(sweepable, "extrusion of a non-spline curve")?;
                }
            }
        }
        for (i, c) in self.curves.iter().enumerate() {
            self.origin(c.frame, &c.provenance)?;
            domain(&c.domain)?;
            match &c.geometry {
                CurveGeometry::ConstructionCurve { .. } => {
                    let Provenance::Construction { node } = c.provenance else {
                        return Err(ContractError::Invalid("construction curve provenance"));
                    };
                    let n=at(&self.constructions,node.0,"construction curve node")?;
                    // A general Boolean Model, its exact placement (G13), or
                    // a replayed blend of either (F2c chain chamfer).
                    let blend = n.operation == (Operation::Intersection {}) && [11, 12].contains(&n.rule_version) && n.parents.len() == 1;
                    require(blend || n.rule_version == 6 && (n.operation == (Operation::AffineTransform {}) && n.parameters.is_empty()
                        || n.operation == (Operation::Boolean {}) && (2..=3).contains(&n.parameters.len()) && n.parameters[1].get() == -6.), "construction curve rule")?;
                }
                CurveGeometry::ConstructionLine { edge } => {
                    let e = at(&self.edges, edge.0, "construction line edge")?;
                    require(e.curve.0 as usize == i, "construction line backreference")?;
                    require(e.vertices.len() == 2 && e.vertices[0] != e.vertices[1], "construction line endpoints")?;
                    let Provenance::Construction { node } = &c.provenance else {
                        return Err(ContractError::Invalid("construction line provenance"));
                    };
                    // Affine wrappers preserve the exact replay-owned carrier.
                    let n = self.source(&Provenance::Construction { node: *node })?;
                    require(n.replayed_planar_boundary(), "construction line rule")?;
                    for v in &e.vertices {
                        let v = at(&self.vertices, v.0, "construction line vertex")?;
                        require(v.frame == c.frame && v.provenance == c.provenance, "construction line binding")?;
                    }
                }
                CurveGeometry::CylinderIntersection { large_axis, small_axis, large_radius, small_radius, .. } => {
                    axes(*large_axis, *small_axis)?;
                    positive(*small_radius)?;
                    require(compare(*large_radius, *small_radius)? == Sign::Positive, "cylinder intersection transverse radii")?;
                    arc_domain(&ArcKind::Full {}, &c.domain)?;
                }
                CurveGeometry::VectorEllipse { cosine, sine, arc, .. } => {
                    axes(*cosine, *sine)?;
                    arc_domain(arc, &c.domain)?;
                }
                CurveGeometry::SphereCircle { normal, x, sphere_radius, height, .. } => {
                    axes(*normal, *x)?;
                    positive(*sphere_radius)?;
                    require(height.get().abs() < sphere_radius.get(), "radical circle degeneracy")?;
                    arc_domain(&ArcKind::Full {}, &c.domain)?;
                }
                CurveGeometry::Line { a, b } => {
                    let mut distinct = false;
                    for i in 0..3 {
                        distinct |= compare(a[i], b[i])? != Sign::Zero;
                    }
                    require(distinct, "zero line")?;
                }
                CurveGeometry::Circle {
                    normal,
                    x,
                    radius,
                    arc,
                    ..
                } => {
                    axes(*normal, *x)?;
                    positive(*radius)?;
                    arc_domain(arc, &c.domain)?;
                }
                CurveGeometry::Ellipse {
                    normal,
                    x,
                    major,
                    minor,
                    arc,
                    ..
                } => {
                    axes(*normal, *x)?;
                    positive(*major)?;
                    positive(*minor)?;
                    arc_domain(arc, &c.domain)?;
                }
                CurveGeometry::Parabola {
                    axis,
                    x,
                    focal,
                    branch,
                    ..
                } => {
                    axes(*axis, *x)?;
                    positive(*focal)?;
                    match branch {
                        ParabolaBranch::Positive {} => require(
                            endpoint(&c.domain.lower)
                                .is_some_and(|v| Sign::of_exact(v.get()) != Sign::Negative),
                            "positive parabola domain",
                        )?,
                        ParabolaBranch::Negative {} => require(
                            endpoint(&c.domain.upper)
                                .is_some_and(|v| Sign::of_exact(v.get()) != Sign::Positive),
                            "negative parabola domain",
                        )?,
                        ParabolaBranch::Whole {} => {}
                    }
                }
                CurveGeometry::Hyperbola {
                    axis,
                    x,
                    major,
                    minor,
                    ..
                } => {
                    axes(*axis, *x)?;
                    positive(*major)?;
                    positive(*minor)?;
                }
                CurveGeometry::BSpline { degree, knots, controls, weights, periodic } => {
                    require(!periodic, "periodic bspline")?;
                    let span = bspline(*degree, knots, controls.len(), weights)?;
                    in_domain(&c.domain, &span)?;
                    require(
                        endpoint(&c.domain.lower).is_some() && endpoint(&c.domain.upper).is_some(),
                        "unbounded bspline domain",
                    )?;
                }
                CurveGeometry::Trace { surfaces, tube } => {
                    require(surfaces[0] != surfaces[1], "trace repeated carrier")?;
                    for s in surfaces {
                        require(
                            at(&self.surfaces, s.0, "trace surface")?.frame == c.frame,
                            "trace frame mismatch",
                        )?;
                        require(
                            c.supports.iter().any(|support| support.surface == *s),
                            "trace missing carrier support",
                        )?;
                    }
                    let b = at(&self.budgets, tube.budget, "tube budget")?;
                    require(
                        matches!(b.quantity, Quantity::Length {}),
                        "tube budget units",
                    )?;
                    require(!tube.segments.is_empty(), "empty tube")?;
                    require(
                        tube.segments[0].domain.lower == c.domain.lower
                            && tube.segments.last().unwrap().domain.upper == c.domain.upper,
                        "tube domain coverage",
                    )?;
                    for (j, segment) in tube.segments.iter().enumerate() {
                        require(
                            endpoint(&segment.domain.lower).is_some()
                                && endpoint(&segment.domain.upper).is_some(),
                            "unbounded tube segment",
                        )?;
                        in_domain(&segment.domain, &c.domain)?;
                        bound(&segment.radius, &self.constructions)?;
                        require(
                            compare(magnitude(&segment.radius), magnitude(&b.approximation))?
                                != Sign::Positive,
                            "tube over approximation budget",
                        )?;
                        if j > 0 {
                            // Radii bound approximation error, not a snapping
                            // tolerance. The centerline must share the exact
                            // source point; compare numerically to allow ±0.
                            for (end, start) in tube.segments[j - 1].end.iter().zip(segment.start) {
                                require(
                                    compare(*end, start)? == Sign::Zero,
                                    "tube spatial joint gap",
                                )?;
                            }
                            let previous = &tube.segments[j - 1].domain.upper;
                            require(
                                endpoint(previous).is_some()
                                    && endpoint(previous) == endpoint(&segment.domain.lower),
                                "tube domain gap",
                            )?;
                            require(
                                matches!(previous, Limit::Finite { closed: true, .. })
                                    || matches!(
                                        &segment.domain.lower,
                                        Limit::Finite { closed: true, .. }
                                    ),
                                "tube missing joint",
                            )?;
                        }
                    }
                }
            }
            let mut supports = BTreeSet::new();
            for s in &c.supports {
                let surface = at(&self.surfaces, s.surface.0, "support surface")?;
                let pc = at(&self.pcurves, s.pcurve.0, "support pcurve")?;
                require(supports.insert((s.surface, s.pcurve)), "duplicate support")?;
                require(
                    pc.curve.0 as usize == i && pc.surface == s.surface
                        && (surface.frame == c.frame
                            // A support pcurve can relate a line in an explicitly
                            // translated chart to its parent surface. This is
                            // transport structure, NOT a CurveOnSurface fact;
                            // exact operation audits must still prove incidence.
                            || self.translation_chart(c.frame, surface.frame)),
                    "support binding",
                )?;
            }
        }
        for (i, pc) in self.pcurves.iter().enumerate() {
            let curve = at(&self.curves, pc.curve.0, "pcurve curve")?;
            at(&self.surfaces, pc.surface.0, "pcurve surface")?;
            require(
                curve
                    .supports
                    .iter()
                    .any(|s| s.pcurve.0 as usize == i && s.surface == pc.surface),
                "pcurve missing backreference",
            )?;
            in_domain(&pc.domain, &curve.domain)?;
            match &pc.geometry {
                PcurveGeometry::CylinderIntersection {} => {
                    let CurveGeometry::CylinderIntersection { origin, large_axis, small_axis, large_radius, small_radius } = curve.geometry else {
                        return Err(ContractError::Invalid("intersection pcurve carrier"));
                    };
                    let SurfaceGeometry::Cylinder { origin: base, axis, radius, .. } = self.surfaces[pc.surface.0 as usize].geometry else {
                        return Err(ContractError::Invalid("intersection pcurve support"));
                    };
                    // The support is one of the two source cylinders: the same
                    // binary64 radius input and an exactly parallel axis through
                    // the ring origin. No rounded radius can stand in for it.
                    let source = if compare(radius, large_radius)? == Sign::Zero { large_axis } else { small_axis };
                    require(
                        (compare(radius, large_radius)? == Sign::Zero || compare(radius, small_radius)? == Sign::Zero)
                            && numeric::parallel(point(axis), point(source)).map_err(ContractError::Numeric)?
                            && numeric::on_axis(point(origin), point(base), point(axis)).map_err(ContractError::Numeric)?,
                        "intersection pcurve support",
                    )?;
                }
                PcurveGeometry::SphereLatitude { height } => {
                    let SurfaceGeometry::Sphere { radius, .. } = self.surfaces[pc.surface.0 as usize].geometry else {
                        return Err(ContractError::Invalid("latitude pcurve requires sphere"));
                    };
                    require(height.get().abs() < radius.get(), "latitude reaches pole")?;
                    arc_domain(&ArcKind::Full {}, &pc.domain)?;
                }
                PcurveGeometry::Circle { radius, .. } | PcurveGeometry::CircularArc { radius, .. } => positive(*radius)?,
                PcurveGeometry::Line { .. } | PcurveGeometry::Harmonic { .. } => {}
                PcurveGeometry::RationalBezier { controls, weights } => {
                    require(
                        endpoint(&pc.domain.lower).is_some()
                            && endpoint(&pc.domain.upper).is_some(),
                        "unbounded rational pcurve",
                    )?;
                    require(
                        controls.len() >= 2 && controls.len() == weights.len(),
                        "rational pcurve controls",
                    )?;
                    for w in weights {
                        positive(*w)?;
                    }
                }
                PcurveGeometry::BSpline { degree, knots, controls, weights } => {
                    let span = bspline(*degree, knots, controls.len(), weights)?;
                    in_domain(&pc.domain, &span)?;
                    require(
                        endpoint(&pc.domain.lower).is_some() && endpoint(&pc.domain.upper).is_some(),
                        "unbounded bspline pcurve",
                    )?;
                }
                PcurveGeometry::Samples {
                    parameters,
                    points,
                    error,
                } => {
                    bound(error, &self.constructions)?;
                    require(
                        parameters.len() >= 2 && parameters.len() == points.len(),
                        "sample pcurve controls",
                    )?;
                    require(
                        parameters.first().copied() == endpoint(&pc.domain.lower)
                            && parameters.last().copied() == endpoint(&pc.domain.upper),
                        "sample pcurve coverage",
                    )?;
                    for pair in parameters.windows(2) {
                        require(
                            compare(pair[0], pair[1])? == Sign::Negative,
                            "sample pcurve order",
                        )?;
                    }
                }
            }
        }
        for e in &self.edges {
            let c = at(&self.curves, e.curve.0, "edge curve")?;
            in_domain(&e.domain, &c.domain)?;
            require(e.vertices.len() == 2 || (e.vertices.is_empty()
                && e.domain == c.domain
                && self.endpoint_free(c)?), "edge endpoints")?;
            for v in &e.vertices {
                let frame = at(&self.vertices, v.0, "edge vertex")?.frame;
                require(
                    frame == c.frame || self.translation_chart(frame, c.frame),
                    "edge vertex frame",
                )?;
            }
        }
        for c in &self.coedges {
            let edge = at(&self.edges, c.edge.0, "coedge edge")?;
            let pc = at(&self.pcurves, c.pcurve.0, "coedge pcurve")?;
            require(pc.curve == edge.curve, "coedge pcurve binding")?;
            in_domain(&edge.domain, &pc.domain)?;
        }
        for lp in &self.loops {
            require(!lp.coedges.is_empty(), "empty loop")?;
            for c in &lp.coedges {
                at(&self.coedges, c.0, "loop coedge")?;
            }
        }
        for f in &self.faces {
            at(&self.surfaces, f.surface.0, "face surface")?;
            for lp in &f.loops {
                for c in &at(&self.loops, lp.0, "face loop")?.coedges {
                    let pc = &self.pcurves[self.coedges[c.0 as usize].pcurve.0 as usize];
                    require(pc.surface == f.surface, "face pcurve binding")?;
                }
            }
        }
        for s in &self.shells {
            require(!s.faces.is_empty(), "empty shell")?;
            for f in &s.faces {
                at(&self.faces, f.0, "shell face")?;
            }
        }
        for s in &self.solids {
            require(!s.shells.is_empty(), "empty solid")?;
            for shell in &s.shells {
                at(&self.shells, shell.0, "solid shell")?;
            }
        }
        let mut facts = BTreeSet::new();
        for fact in &self.facts {
            if !facts.insert(self.prove_fact(fact)?) {
                return Err(ContractError::NonCanonical("duplicate fact"));
            }
        }
        for b in &self.budgets {
            budget(b, &self.constructions)?;
        }
        Ok(CheckedBody { body: self })
    }
    /// A vertex-free closed edge needs a carrier that is an exact construction:
    /// the radical sphere ring, the quartic cylinder ring, or a full circle that
    /// IS a cross-section of one of its supporting cylinders (the same binary64
    /// radius input, an exactly parallel normal, its centre exactly on the axis,
    /// and a constant-height one-turn chart line). A free binary64 circle, e.g. a
    /// rounded radical radius replacing an exact ring, has no such support.
    fn endpoint_free(&self, c: &Curve) -> Result<bool> {
        if let CurveGeometry::ConstructionCurve { closed, .. } = c.geometry {
            // Structural admission only: Model replay must prove both this
            // closure claim and every slot/support/topology association.
            return Ok(closed);
        }
        let CurveGeometry::Circle { origin, normal, radius, arc: ArcKind::Full {}, .. } = c.geometry else {
            return Ok(matches!(
                c.geometry,
                CurveGeometry::SphereCircle { .. } | CurveGeometry::CylinderIntersection { .. }
            ));
        };
        for s in &c.supports {
            let SurfaceGeometry::Cylinder { origin: base, axis, radius: r, .. } =
                at(&self.surfaces, s.surface.0, "support surface")?.geometry
            else {
                continue;
            };
            let PcurveGeometry::Line { a, b } = at(&self.pcurves, s.pcurve.0, "support pcurve")?.geometry else {
                continue;
            };
            if compare(radius, r)? == Sign::Zero
                && compare(a[1], b[1])? == Sign::Zero
                && numeric::unit_span(a[0].get(), b[0].get()).map_err(ContractError::Numeric)?
                && numeric::parallel(point(normal), point(axis)).map_err(ContractError::Numeric)?
                && numeric::on_axis(point(origin), point(base), point(axis)).map_err(ContractError::Numeric)?
            {
                return Ok(true);
            }
        }
        Ok(false)
    }
    fn translation_chart(&self, child: FrameId, parent_frame: FrameId) -> bool {
        matches!(self.frames.get(child.0 as usize), Some(Frame::Rigid {parent, angle, ..})
            if *parent == parent_frame && angle.get() == 0.)
    }
    fn origin(&self, frame: FrameId, origin: &Provenance) -> Result<()> {
        at(&self.frames, frame.0, "entity frame")?;
        if let Provenance::Construction { node } = origin {
            require(
                at(&self.constructions, node.0, "entity construction")?.frame == frame,
                "entity construction frame",
            )?;
        }
        Ok(())
    }
    fn source(&self, origin: &Provenance) -> Result<&Construction> {
        let Provenance::Construction { mut node } = *origin else {
            return Err(ContractError::NoProvenance);
        };
        loop {
            let n = at(&self.constructions, node.0, "source node")?;
            if !matches!(n.operation, Operation::RigidTransform {} | Operation::AffineTransform {}) {
                return Ok(n);
            }
            node = n.parents[0]; // already checked decreasing DAG, hence bounded
        }
    }
    fn source_line(&self, curve: CurveId) -> Result<(Vector3, Vector3, FrameId)> {
        let c = at(&self.curves, curve.0, "fact curve")?;
        let CurveGeometry::Line { a, b } = c.geometry else {
            return Err(ContractError::UnsupportedWitness(1));
        };
        let n = self.source(&c.provenance)?;
        require(
            matches!(n.operation, Operation::LineThrough {}),
            "incidence construction binding",
        )?;
        let input = &self.constructions[n.parents[0].0 as usize].parameters;
        require(
            input.iter().copied().eq(a.into_iter().chain(b)),
            "incidence parameters changed",
        )?;
        Ok((a, b, n.frame))
    }
    fn source_plane(&self, surface: SurfaceId) -> Result<(Vector3, Vector3, FrameId)> {
        let s = at(&self.surfaces, surface.0, "fact surface")?;
        let SurfaceGeometry::Plane { origin, normal, x } = s.geometry else {
            return Err(ContractError::UnsupportedWitness(1));
        };
        let n = self.source(&s.provenance)?;
        require(
            matches!(n.operation, Operation::Plane {}),
            "incidence construction binding",
        )?;
        let input = &self.constructions[n.parents[0].0 as usize].parameters;
        require(
            input
                .iter()
                .copied()
                .eq(origin.into_iter().chain(normal).chain(x)),
            "incidence parameters changed",
        )?;
        Ok((origin, normal, n.frame))
    }
    fn source_point(&self, vertex: VertexId) -> Result<(Vector3, FrameId)> {
        let v = at(&self.vertices, vertex.0, "fact vertex")?;
        let n = self.source(&v.provenance)?;
        require(
            matches!(n.operation, Operation::Point {}),
            "point construction binding",
        )?;
        let input = &self.constructions[n.parents[0].0 as usize].parameters;
        require(input.as_slice() == v.point, "point parameters changed")?;
        Ok((v.point, n.frame))
    }
    fn same_frame(&self, a: FrameId, b: FrameId) -> Result<()> {
        if a != b {
            Err(ContractError::CrossFrameUnproved)
        } else {
            Ok(())
        }
    }
    fn prove(&self, fact: &ContainedClaim) -> Result<()> {
        self.fact_header(&fact.body, fact.rule, 1)?;
        let curve = at(&self.curves, fact.curve.0, "fact curve")?;
        let surface = at(&self.surfaces, fact.surface.0, "fact surface")?;
        self.same_frame(curve.frame, surface.frame)?;
        let (a, b, cf) = self.source_line(fact.curve)?;
        let (origin, normal, sf) = self.source_plane(fact.surface)?;
        self.same_frame(cf, sf)?;
        for p in [a, b] {
            if numeric::plane_side(point(normal), point(p), point(origin))
                .map_err(ContractError::Numeric)?
                != Sign::Zero
            {
                return Err(ContractError::FalseWitness);
            }
        }
        Ok(())
    }
    fn fact_header(&self, key: &BodyKey, rule: u32, expected: u32) -> Result<()> {
        require(*key == self.key, "stale/foreign fact body")?;
        if rule != expected {
            return Err(ContractError::UnsupportedWitness(rule));
        }
        Ok(())
    }
    fn prove_fact(&self, fact: &Fact) -> Result<(u32, u32, u32, u32)> {
        match fact {
            Fact::CurveOnSurface { claim } => {
                self.prove(claim)?;
                Ok((0, claim.curve.0, claim.surface.0, 0))
            }
            Fact::EdgeOnSurface {
                body,
                edge,
                surface,
                domain,
                rule,
            } => {
                self.fact_header(body, *rule, 1)?;
                let e = at(&self.edges, edge.0, "fact edge")?;
                in_domain(domain, &e.domain)?;
                self.prove(&ContainedClaim {
                    body: body.clone(),
                    curve: e.curve,
                    surface: *surface,
                    rule: 1,
                })?;
                Ok((1, edge.0, surface.0, 0))
            }
            Fact::VertexOnEdge {
                body,
                vertex,
                edge,
                parameter,
                rule,
            } => {
                self.fact_header(body, *rule, 2)?;
                let e = at(&self.edges, edge.0, "fact edge")?;
                let c = &self.curves[e.curve.0 as usize];
                let v = at(&self.vertices, vertex.0, "fact vertex")?;
                self.same_frame(v.frame, c.frame)?;
                let (p, vf) = self.source_point(*vertex)?;
                let (a, b, cf) = self.source_line(e.curve)?;
                self.same_frame(vf, cf)?;
                for (limit, outside) in [
                    (&e.domain.lower, Sign::Negative),
                    (&e.domain.upper, Sign::Positive),
                ] {
                    if let Limit::Finite { value, closed } = limit {
                        let side = compare(*parameter, *value)?;
                        if side == outside || (side == Sign::Zero && !closed) {
                            return Err(ContractError::FalseWitness);
                        }
                    }
                }
                if !numeric::on_line_at(point(p), point(a), point(b), parameter.get())
                    .map_err(ContractError::Numeric)?
                {
                    return Err(ContractError::FalseWitness);
                }
                Ok((2, vertex.0, edge.0, 0))
            }
            Fact::VertexOnSurface {
                body,
                vertex,
                surface,
                rule,
            } => {
                self.fact_header(body, *rule, 3)?;
                let v = at(&self.vertices, vertex.0, "fact vertex")?;
                let s = at(&self.surfaces, surface.0, "fact surface")?;
                self.same_frame(v.frame, s.frame)?;
                let (p, vf) = self.source_point(*vertex)?;
                let (origin, normal, sf) = self.source_plane(*surface)?;
                self.same_frame(vf, sf)?;
                if numeric::plane_side(point(normal), point(p), point(origin))
                    .map_err(ContractError::Numeric)?
                    != Sign::Zero
                {
                    return Err(ContractError::FalseWitness);
                }
                Ok((3, vertex.0, surface.0, 0))
            }
            Fact::TangentAlong {
                body,
                face_a,
                face_b,
                edge,
                domain,
                rule,
            } => {
                self.fact_header(body, *rule, 4)?;
                require(face_a < face_b, "noncanonical tangent face order")?;
                let e = at(&self.edges, edge.0, "tangent edge")?;
                in_domain(domain, &e.domain)?;
                let mut normals = Vec::new();
                for id in [face_a, face_b] {
                    let face = at(&self.faces, id.0, "tangent face")?;
                    require(
                        face.loops.iter().any(|lp| {
                            self.loops[lp.0 as usize]
                                .coedges
                                .iter()
                                .any(|c| self.coedges[c.0 as usize].edge == *edge)
                        }),
                        "tangent common edge",
                    )?;
                    self.prove(&ContainedClaim {
                        body: body.clone(),
                        curve: e.curve,
                        surface: face.surface,
                        rule: 1,
                    })?;
                    normals.push(self.source_plane(face.surface)?.1);
                }
                if !numeric::parallel(point(normals[0]), point(normals[1]))
                    .map_err(ContractError::Numeric)?
                {
                    return Err(ContractError::FalseWitness);
                }
                Ok((4, face_a.0, face_b.0, edge.0))
            }
        }
    }
}
