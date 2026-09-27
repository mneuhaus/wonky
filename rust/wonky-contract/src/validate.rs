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
                Frame::AffineImage { base, rows, .. } => {
                    require((base.0 as usize) < i, "affine image cycle/forward reference")?;
                    let [a, b, c] = rows.map(point);
                    let determinant = wonky_num::orient3d(a, b, c, wonky_num::v3(0., 0., 0.), "affine image determinant")
                        .map_err(|e| ContractError::Numeric(e.into_refusal()))?;
                    require(determinant != wonky_num::Sign::Zero, "singular affine image")?;
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
            if n.rule_version != 1 && !planar_chamfer {
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
                    require(matches!(&self.frames[n.frame.0 as usize], Frame::AffineImage { base, .. } if *base == input.frame), "affine frame chain")?;
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
                SurfaceGeometry::Cylinder {
                    axis, x, radius, ..
                }
                | SurfaceGeometry::Sphere {
                    axis, x, radius, ..
                } => {
                    axes(axis, x)?;
                    positive(radius)?;
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
            }
        }
        for (i, c) in self.curves.iter().enumerate() {
            self.origin(c.frame, &c.provenance)?;
            domain(&c.domain)?;
            match &c.geometry {
                CurveGeometry::ConstructionLine { edge } => {
                    let e = at(&self.edges, edge.0, "construction line edge")?;
                    require(e.curve.0 as usize == i, "construction line backreference")?;
                    require(e.vertices.len() == 2 && e.vertices[0] != e.vertices[1], "construction line endpoints")?;
                    let Provenance::Construction { node } = &c.provenance else {
                        return Err(ContractError::Invalid("construction line provenance"));
                    };
                    let n = at(&self.constructions, node.0, "construction line node")?;
                    require(n.operation == (Operation::Boolean {}) && n.rule_version == 1
                        && n.parameters.len() == 2 && n.parameters[1].get() == 2., "construction line rule")?;
                    for v in &e.vertices {
                        let v = at(&self.vertices, v.0, "construction line vertex")?;
                        require(v.frame == c.frame && v.provenance == c.provenance, "construction line binding")?;
                    }
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
                && matches!(c.geometry, CurveGeometry::SphereCircle { .. })
                && e.domain == c.domain), "edge endpoints")?;
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
            if !matches!(n.operation, Operation::RigidTransform {}) {
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
