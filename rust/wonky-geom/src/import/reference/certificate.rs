//! Whole-domain rational certificates. Bernstein ranges include every point;
//! endpoints and samples are never used to establish containment. A finite
//! budget exhaustion refuses. Positive weights are proved on every subdomain.
use super::*;
use num_traits::Signed;
use wonky_alg::Polynomial as Poly;
mod sample;
pub use sample::{EdgePolyline, EdgeSample};
mod extents;
pub use extents::{CoordinateExtrema, EdgeExtents};
mod face_extents;
mod periodic_band;
mod circular_domain;
pub use face_extents::{FaceChartDomain, FaceExtents};
mod trim_enclosure;
pub use trim_enclosure::TrimEnclosure;
mod face_bounds;
pub use face_bounds::{BodySupportBounds, FaceSupportBounds};
mod curved_lift;
mod spline_lift;
pub(super) use curved_lift::check_cone_angle;
#[derive(Clone, Debug)]
pub struct HomogeneousSpan {
    pub a: Q,
    pub b: Q,
    /// Ascending power polynomials in local [0,1], X,Y[,Z],W.
    pub coordinates: Vec<Poly>,
    /// Certified distance from this rational chart enclosure centre to the
    /// semantic source curve. It consumes the source allowance explicitly.
    pub chart_error_mm: Q,
}
#[derive(Clone, Debug)]
pub struct ResidualBound {
    pub lower_mm: Q,
    pub upper_mm: Q,
    pub method: &'static str,
}
fn poly(v: Vec<Q>) -> Poly {
    Poly::new(v).expect("finite exact rational coefficients")
}
fn constant(x: &Q) -> Poly {
    poly(vec![x.clone()])
}
fn scale(p: &Poly, s: &Q) -> Poly {
    p.scale(s).expect("finite exact rational scale")
}
fn square(p: &Poly) -> Poly {
    p.mul(p)
}
fn range(p: &Poly) -> (Q, Q) {
    let b = p
        .to_bernstein(p.degree().unwrap_or(0))
        .expect("polynomial degree");
    (
        b.iter().min().unwrap().clone(),
        b.iter().max().unwrap().clone(),
    )
}
fn restrict(p: &Poly, a: &Q, b: &Q) -> Poly {
    p.compose(&poly(vec![a.clone(), b - a]))
}
fn filter_nonpositive(p: &Poly) -> bool {
    use wonky_num::Iv;
    let degree = p.degree().unwrap_or(0);
    if degree > 32 {
        return false;
    }
    let choose = |n: usize, k: usize| -> u64 {
        (0..k).fold(1u64, |v, i| v * (n - i) as u64 / (i + 1) as u64)
    };
    for i in 0..=degree {
        let mut sum = Iv::point(0.);
        for k in 0..=i {
            let Ok(c) = wonky_curve::numeric::enclose(&p.coefficients()[k]) else {
                return false;
            };
            let ratio = Q::new(choose(i, k).into(), choose(degree, k).into());
            let Ok(r) = wonky_curve::numeric::enclose(&ratio) else {
                return false;
            };
            sum = sum + c * r;
        }
        if sum.is_nan() || sum.hi() > 0. {
            return false;
        }
    }
    true
}
fn nonpositive(p: &Poly, budget: &mut usize, depth: usize) -> Result<()> {
    if p.is_zero() || filter_nonpositive(p) {
        return Ok(());
    }
    let controls = p
        .to_bernstein(p.degree().unwrap_or(0))
        .expect("exact polynomial degree");
    nonpositive_controls(&controls, budget, depth)
}
fn nonpositive_controls(controls: &[Q], budget: &mut usize, depth: usize) -> Result<()> {
    if *budget == 0 || depth > 24 {
        return fail("import/residual-proof-budget");
    }
    *budget -= 1;
    if controls.iter().all(|x| x <= &q(0)) {
        return Ok(());
    }
    if controls.iter().all(|x| x > &q(0)) {
        return fail("import/curve-off-surface");
    }
    // de Casteljau restricts the same exact Bernstein polynomial. This avoids
    // repeatedly converting growing power coefficients during subdivision.
    let mut row = controls.to_vec();
    let mut left = vec![row[0].clone()];
    let mut right = vec![row.last().unwrap().clone()];
    while row.len() > 1 {
        row = row.windows(2).map(|w| (&w[0] + &w[1]) / q(2)).collect();
        left.push(row[0].clone());
        right.push(row.last().unwrap().clone());
    }
    if row[0] > q(0) {
        return fail("import/curve-off-surface");
    }
    right.reverse();
    nonpositive_controls(&left, budget, depth + 1)?;
    nonpositive_controls(&right, budget, depth + 1)
}
fn bounded(p: &Poly, allowance: &Poly, budget: &mut usize) -> Result<()> {
    nonpositive(&p.sub(allowance), budget, 0)?;
    nonpositive(&p.neg().sub(allowance), budget, 0)
}
impl Curve {
    /// The existing planar BSpline owns clamped extraction. For un-clamped
    /// periodic STEP splines, Cox-de Boor polynomials are evaluated over each
    /// nonempty active knot span; no change to the user curve or knot vector.
    pub fn homogeneous_spans(&self) -> Result<Vec<HomogeneousSpan>> {
        if let Self::Circle {
            axis,
            radius,
            dimension,
        } = self
        {
            let (frame, frame_error) = axis.enclosed_frame()?;
            let circle = crate::model::Circle3::new(frame.clone(), radius * radius)?;
            let mut result = Vec::new();
            for patch in [
                crate::model::curved::Patch::First,
                crate::model::curved::Patch::Second,
            ] {
                for (a, b) in [(q(-1), q(0)), (q(0), q(1))] {
                    let mid = circle.point(patch, &((a.clone() + &b) / q(2)))?;
                    let sign = if patch == crate::model::curved::Patch::First {
                        q(1)
                    } else {
                        q(-1)
                    };
                    let w = poly(vec![q(1), q(0), q(1)]);
                    let c = poly(vec![q(1), q(0), q(-1)]);
                    let sn = poly(vec![q(0), q(2)]);
                    let mut coordinates = (0..*dimension)
                        .map(|i| {
                            scale(&w, &axis.origin[i])
                                .add(&scale(&c, &(&frame.columns()[0][i] * radius * &sign)))
                                .add(&scale(&sn, &(&frame.columns()[1][i] * radius * &sign)))
                        })
                        .collect::<Vec<_>>();
                    coordinates.push(w);
                    let coordinates = coordinates
                        .iter()
                        .map(|p| restrict(p, &a, &b))
                        .collect::<Vec<_>>();
                    // Keep the shared G8 point construction as the authority;
                    // the polynomial form must agree before it is consumed.
                    for i in 0..*dimension {
                        if coordinates[i].evaluate(&(q(1) / q(2))).unwrap()
                            / coordinates[*dimension].evaluate(&(q(1) / q(2))).unwrap()
                            != mid[i]
                        {
                            return fail("import/circle-chart-mismatch");
                        }
                    }
                    result.push(HomogeneousSpan {
                        a,
                        b,
                        coordinates,
                        chart_error_mm: radius * &frame_error,
                    });
                }
            }
            return Ok(result);
        }
        let Self::Spline {
            degree,
            points,
            weights,
            knots,
        } = self
        else {
            return fail("import/curve-span-kind");
        };
        if *degree == 0
            || *degree > wonky_curve::bspline::MAX_DEGREE
            || points.len() <= *degree
            || points.len() > 4096
            || weights.len() != points.len()
            || weights.iter().any(|w| w <= &q(0))
            || knots.len() != points.len() + degree + 1
            || knots.windows(2).any(|p| p[0] > p[1])
            || knots[*degree] >= knots[points.len()]
            || points.iter().any(|p| p.len() != points[0].len())
            || !matches!(points[0].len(), 2 | 3)
        {
            return fail("import/spline-span-invalid");
        }
        let dim = points[0].len();
        let clamped = knots[..=*degree].iter().all(|k| k == &knots[0])
            && knots[knots.len() - degree - 1..]
                .iter()
                .all(|k| k == knots.last().unwrap());
        // The shared curve library requires continuous internal knots. Retain
        // discontinuous STEP observations through the direct Cox-de Boor path
        // so the consuming correspondence/display check can diagnose them.
        let internal_continuous = !knots.windows(degree + 1).any(|ks| {
            ks[0] > knots[*degree] && ks[0] < knots[points.len()] && ks.iter().all(|k| k == &ks[0])
        });
        if clamped && internal_continuous {
            let mut projections = Vec::new();
            for j in 0..dim {
                let spline = wonky_curve::bspline::BSpline::new(
                    *degree,
                    knots.clone(),
                    points.iter().map(|p| [p[j].clone(), q(0)]).collect(),
                    Some(weights.clone()),
                )
                .map_err(|_| Error::new("import/spline-span-invalid"))?;
                projections.push(spline);
            }
            let mut result = Vec::new();
            for (i, span) in projections[0].spans().iter().enumerate() {
                let mut coordinates = projections
                    .iter()
                    .map(|p| p.spans()[i].pw[0].clone())
                    .collect::<Vec<_>>();
                coordinates.push(span.pw[2].clone());
                result.push(HomogeneousSpan {
                    a: span.a.clone(),
                    b: span.b.clone(),
                    coordinates,
                    chart_error_mm: q(0),
                });
            }
            return Ok(result);
        }
        let mut result = Vec::new();
        for j in *degree..points.len() {
            let (a, b) = (&knots[j], &knots[j + 1]);
            if a == b {
                continue;
            }
            let mut basis = (0..knots.len() - 1)
                .map(|i| if i == j { Poly::one() } else { Poly::zero() })
                .collect::<Vec<_>>();
            let t = poly(vec![a.clone(), b - a]);
            for p in 1..=*degree {
                let mut next = Vec::new();
                for i in 0..basis.len() - 1 {
                    let mut n = Poly::zero();
                    let den = &knots[i + p] - &knots[i];
                    if !den.is_zero() {
                        n = n.add(&scale(
                            &t.sub(&constant(&knots[i])).mul(&basis[i]),
                            &(q(1) / den),
                        ));
                    }
                    let den = &knots[i + p + 1] - &knots[i + 1];
                    if !den.is_zero() {
                        n = n.add(&scale(
                            &constant(&knots[i + p + 1]).sub(&t).mul(&basis[i + 1]),
                            &(q(1) / den),
                        ));
                    }
                    next.push(n);
                }
                basis = next;
            }
            let coordinates = (0..=dim)
                .map(|k| {
                    points.iter().enumerate().fold(Poly::zero(), |sum, (i, p)| {
                        sum.add(&scale(
                            &basis[i],
                            &(&weights[i] * if k == dim { q(1) } else { p[k].clone() }),
                        ))
                    })
                })
                .collect();
            result.push(HomogeneousSpan {
                a: a.clone(),
                b: b.clone(),
                coordinates,
                chart_error_mm: q(0),
            });
        }
        Ok(result)
    }
}
impl Carrier {
    pub fn axis(&self) -> &Axis {
        match self {
            Self::Spline(a, _)
            | Self::Plane(a)
            | Self::Cylinder(a, _)
            | Self::Cone(a, _, _)
            | Self::Sphere(a, _)
            | Self::Torus(a, _, _) => a,
        }
    }
    pub fn certify_spans(&self, spans: &[HomogeneousSpan], tolerance: &Q) -> Result<ResidualBound> {
        if tolerance < &q(0) {
            return fail("import/uncertainty-invalid");
        }
        // One retained carrier angle serves the entire batch; recomputing its
        // exact trigonometric enclosure for each display vertex was dominant.
        let cone_tangent = if let Self::Cone(_, _, angle) = self { Some(tan_enclosure(angle)?) } else { None };
        let mut budget = 65_536;
        for span in spans {
            let effective_tolerance = tolerance - &span.chart_error_mm;
            if effective_tolerance < q(0) {
                return fail("import/semantic-chart-proof-budget");
            }
            let tolerance = &effective_tolerance;
            if span.coordinates.len() != 4 {
                return fail("import/dimension-unsupported");
            }
            if filter_carrier_span(self, span, tolerance) {
                continue;
            }
            let w = &span.coordinates[3];
            let (wl, _) = range(w);
            if wl <= q(0) {
                return fail("import/spline-weight-unproved");
            }
            let a = self.axis();
            let d = (0..3)
                .map(|i| span.coordinates[i].sub(&scale(w, &a.origin[i])))
                .collect::<Vec<_>>();
            let norm = d.iter().fold(Poly::zero(), |s, p| s.add(&square(p)));
            let axial = (0..3).fold(Poly::zero(), |s, i| s.add(&scale(&d[i], &a.axis[i])));
            let n2 = dot(&a.axis, &a.axis);
            let w2 = square(w);
            match self {
                Self::Spline(..) => return fail("import/surface-spline-incidence-unavailable"),
                Self::Plane(_) => bounded(
                    &square(&axial),
                    &scale(&w2, &(tolerance * tolerance * &n2)),
                    &mut budget,
                )?,
                Self::Cylinder(_, r) => {
                    if tolerance >= r {
                        return fail("import/uncertainty-exceeds-radius");
                    }
                    let radial = scale(&norm, &n2).sub(&square(&axial));
                    let low = r - tolerance;
                    let high = r + tolerance;
                    nonpositive(
                        &radial.sub(&scale(&w2, &(&high * &high * &n2))),
                        &mut budget,
                        0,
                    )?;
                    nonpositive(
                        &scale(&w2, &(&low * &low * &n2)).sub(&radial),
                        &mut budget,
                        0,
                    )?;
                }
                Self::Sphere(_, r) => {
                    if tolerance >= r {
                        return fail("import/uncertainty-exceeds-radius");
                    }
                    let low = r - tolerance;
                    let high = r + tolerance;
                    nonpositive(&norm.sub(&scale(&w2, &(&high * &high))), &mut budget, 0)?;
                    nonpositive(&scale(&w2, &(&low * &low)).sub(&norm), &mut budget, 0)?;
                }
                Self::Torus(_, major, minor) => {
                    if tolerance >= minor || minor + tolerance >= *major {
                        return fail("import/uncertainty-exceeds-radius");
                    }
                    let radial = scale(&norm, &n2).sub(&square(&axial));
                    let implicit = |r: &Q| {
                        let c = norm.add(&scale(&w2, &(major * major - r * r)));
                        scale(&square(&c), &n2)
                            .sub(&scale(&radial.mul(&w2), &(q(4) * major * major)))
                    };
                    nonpositive(&implicit(&(minor + tolerance)), &mut budget, 0)?;
                    nonpositive(&implicit(&(minor - tolerance)).neg(), &mut budget, 0)?;
                }
                Self::Cone(_, radius, _) => {
                    let norm_n = wonky_curve::numeric::exact_root(&n2).ok_or_else(|| {
                        Error::new("import/cone-axis-algebraic-proof-unavailable")
                    })?;
                    let z = scale(&axial, &(q(1) / norm_n));
                    let (zl, zh) = range(&z);
                    let (wl, _) = range(w);
                    let zmax = zl.abs().max(zh.abs()) / wl;
                    let (tl, th) = cone_tangent.as_ref().unwrap();
                    let mid = (tl + th) / q(2);
                    let error = (th - tl) / q(2) * zmax;
                    let allowance = tolerance - error;
                    if allowance < q(0) {
                        return fail("import/cone-angle-proof-budget");
                    }
                    let r = scale(w, radius).add(&scale(&z, &mid));
                    let low = r.sub(&scale(w, &allowance));
                    let high = r.add(&scale(w, &allowance));
                    if range(&low).0 <= q(0) {
                        return fail("import/cone-apex-domain-unproved");
                    }
                    let radial = norm.sub(&square(&z));
                    nonpositive(&radial.sub(&square(&high)), &mut budget, 0)?;
                    nonpositive(&square(&low).sub(&radial), &mut budget, 0)?;
                }
            }
        }
        Ok(ResidualBound {
            lower_mm: q(0),
            upper_mm: tolerance.clone(),
            method: "exact-rational-bernstein/whole-domain",
        })
    }
}
impl ReferenceDraft {
    /// Whole-domain spline/carrier incidences. Source uncertainty is never
    /// inferred from display deviation, and this partial check does not publish
    /// a Reference Model: pcurve correspondence and non-spline trims remain.
    pub fn check_spline_surfaces(&self) -> Result<Vec<(u32, u32, ResidualBound)>> {
        let mut result = Vec::new();
        for body in &self.bodies {
            let tolerance = match &body.uncertainty {
                Uncertainty::Declared { mm } => mm,
                Uncertainty::Unknown => return fail("import/source-tolerance-missing"),
            };
            for face in &body.faces {
                for lp in &face.loops {
                    for (eid, _) in &lp.uses {
                        let edge = &body.edges[eid];
                        if matches!(&edge.curve, Curve::Spline { .. }) {
                            let spans = edge.curve.homogeneous_spans()?;
                            result.push((
                                *eid,
                                face.id,
                                body.surfaces[&face.surface].certify_spans(&spans, tolerance)?,
                            ));
                        }
                    }
                }
            }
        }
        Ok(result)
    }
}
fn tan_enclosure(angle: &Q) -> Result<(Q, Q)> {
    let series = |sine: bool| {
        let mut term = if sine { angle.clone() } else { q(1) };
        let mut sum = q(0);
        for k in 0..40 {
            sum += if k % 2 == 0 { term.clone() } else { -&term };
            let n = if sine { 2 * k + 2 } else { 2 * k + 1 };
            term = term * angle * angle / q((n * (n + 1)) as i64);
        }
        // Forty terms end with a subtraction. The alternating tail is in
        // [0,next_term], established for |angle| < pi/2 < 2.
        (sum.clone(), sum + term)
    };
    let (sl, sh) = series(true);
    let (cl, ch) = series(false);
    if cl <= q(0) {
        return fail("import/cone-angle-domain-unproved");
    }
    let lower = sl / ch;
    let upper = sh / cl;
    // Exact outward dyadic enclosure keeps subsequent proof arithmetic small.
    // Source angle and analytic carrier remain unchanged.
    let denominator: wonky_alg::BigInt = wonky_alg::BigInt::from(1) << 96_usize;
    let l = lower * Q::from_integer(denominator.clone());
    let h = upper * Q::from_integer(denominator.clone());
    let lo = l.numer() / l.denom();
    let hi = (h.numer() + h.denom() - 1) / h.denom();
    Ok((Q::new(lo, denominator.clone()), Q::new(hi, denominator)))
}
impl Edge {
    fn source_spans(
        &self,
        vertices: &BTreeMap<u32, Point>,
        tolerance: &Q,
    ) -> Result<Vec<HomogeneousSpan>> {
        if let Curve::Line { origin, direction } = &self.curve {
            let origin: Point = origin
                .clone()
                .try_into()
                .map_err(|_| Error::new("import/dimension-unsupported"))?;
            let direction: Point = direction
                .clone()
                .try_into()
                .map_err(|_| Error::new("import/dimension-unsupported"))?;
            let n2 = dot(&direction, &direction);
            if n2.is_zero() {
                return fail("import/curve-direction-invalid");
            }
            let mut ends = Vec::new();
            for id in self.vertices {
                let delta = sub(&vertices[&id], &origin);
                let t = dot(&delta, &direction) / &n2;
                let p: Point = std::array::from_fn(|i| &origin[i] + &t * &direction[i]);
                let error = sub(&p, &vertices[&id]);
                if dot(&error, &error) > tolerance * tolerance {
                    return fail("import/vertex-off-curve");
                }
                ends.push(p);
            }
            return Ok(vec![HomogeneousSpan {
                a: q(0),
                b: q(1),
                coordinates: (0..3)
                    .map(|i| poly(vec![ends[0][i].clone(), &ends[1][i] - &ends[0][i]]))
                    .chain(std::iter::once(Poly::one()))
                    .collect(),
                chart_error_mm: q(0),
            }]);
        }
        self.curve.homogeneous_spans()
    }
}
impl ReferenceDraft {
    pub fn check_boundary_surfaces(&self) -> Result<Vec<(u32, u32, ResidualBound)>> {
        self.check_topology()?;
        let mut result = Vec::new();
        for body in &self.bodies {
            let tolerance = match &body.uncertainty {
                Uncertainty::Declared { mm } => mm,
                Uncertainty::Unknown => return fail("import/source-tolerance-missing"),
            };
            let mut span_cache = BTreeMap::new();
            for f in &body.faces {
                for lp in &f.loops {
                    for (eid, _) in &lp.uses {
                        if !span_cache.contains_key(eid) {
                            span_cache.insert(
                                *eid,
                                body.edges[eid].source_spans(&body.vertices, tolerance)?,
                            );
                        }
                        let spans = &span_cache[eid];
                        result.push((
                            *eid,
                            f.id,
                            body.surfaces[&f.surface].certify_spans(&spans, tolerance)?,
                        ));
                    }
                }
            }
        }
        Ok(result)
    }
}
fn lift_plane_pcurve(
    pc: &Pcurve,
    axis: &Axis,
    scale_mm: &Q,
    vertices: &BTreeMap<u32, Point>,
    ends: [u32; 2],
) -> Result<Vec<HomogeneousSpan>> {
    let (frame, frame_error) = axis.enclosed_frame()?;
    let mut spans = if let Curve::Line { origin, direction } = &pc.curve {
        let o: Point = frame.point(&[&origin[0] * scale_mm, &origin[1] * scale_mm, q(0)]);
        let d = frame.vector(&[&direction[0] * scale_mm, &direction[1] * scale_mm, q(0)]);
        let d2 = dot(&d, &d);
        let parameters = ends.map(|id| dot(&sub(&vertices[&id], &o), &d) / &d2);
        let a: Vec<Q> = (0..2)
            .map(|i| &origin[i] + &parameters[0] * &direction[i])
            .collect();
        let b: Vec<Q> = (0..2)
            .map(|i| &origin[i] + &parameters[1] * &direction[i])
            .collect();
        vec![HomogeneousSpan {
            a: q(0),
            b: q(1),
            coordinates: (0..2)
                .map(|i| poly(vec![a[i].clone(), &b[i] - &a[i]]))
                .chain(std::iter::once(Poly::one()))
                .collect(),
            chart_error_mm: q(0),
        }]
    } else {
        pc.curve.homogeneous_spans()?
    };
    for span in &mut spans {
        if span.coordinates.len() != 3 {
            return fail("import/pcurve-dimension-invalid");
        }
        let w = &span.coordinates[2];
        let (wl, _) = range(w);
        if wl <= q(0) {
            return fail("import/pcurve-weight-unproved");
        }
        let radius = (0..2)
            .map(|i| {
                let (lo, hi) = range(&span.coordinates[i]);
                lo.abs().max(hi.abs()) / &wl
            })
            .max()
            .unwrap();
        let error = (frame_error.clone() * radius + &span.chart_error_mm) * scale_mm;
        let coordinates = (0..3)
            .map(|i| {
                scale(w, &axis.origin[i])
                    .add(&scale(
                        &span.coordinates[0],
                        &(&frame.columns()[0][i] * scale_mm),
                    ))
                    .add(&scale(
                        &span.coordinates[1],
                        &(&frame.columns()[1][i] * scale_mm),
                    ))
            })
            .chain(std::iter::once(w.clone()))
            .collect();
        span.coordinates = coordinates;
        span.chart_error_mm = error;
    }
    Ok(spans)
}
fn certify_line(
    spans: &[HomogeneousSpan],
    origin: &[Q],
    direction: &[Q],
    tolerance: &Q,
) -> Result<()> {
    if origin.len() != 3 || direction.len() != 3 {
        return fail("import/dimension-unsupported");
    }
    let n2: Q = direction.iter().map(|v| v * v).sum();
    let mut budget = 65_536;
    for sp in spans {
        let tol = tolerance - &sp.chart_error_mm;
        if tol < q(0) {
            return fail("import/semantic-chart-proof-budget");
        }
        let w = &sp.coordinates[3];
        let d = (0..3)
            .map(|i| sp.coordinates[i].sub(&scale(w, &origin[i])))
            .collect::<Vec<_>>();
        let norm = d.iter().fold(Poly::zero(), |s, p| s.add(&square(p)));
        let axial = (0..3).fold(Poly::zero(), |s, i| s.add(&scale(&d[i], &direction[i])));
        let residual = scale(&norm, &n2).sub(&square(&axial));
        nonpositive(
            &residual.sub(&scale(&square(w), &(&tol * &tol * &n2))),
            &mut budget,
            0,
        )
        .map_err(|e| {
            if e.name == "import/curve-off-surface" {
                Error::new("import/pcurve-lift-mismatch")
            } else {
                e
            }
        })?;
    }
    Ok(())
}
fn certify_correspondence(source: &Curve, lifted: &[HomogeneousSpan], tolerance: &Q) -> Result<()> {
    match source {
        Curve::Line { origin, direction } => certify_line(lifted, origin, direction, tolerance),
        Curve::Circle {
            axis,
            radius,
            dimension,
        } => {
            if *dimension != 3 {
                return fail("import/dimension-unsupported");
            }
            let allowance = tolerance / q(2);
            let r =
                Carrier::Cylinder(axis.clone(), radius.clone()).certify_spans(lifted, &allowance);
            let p = Carrier::Plane(axis.clone()).certify_spans(lifted, &allowance);
            r.and(p).map(|_| ()).map_err(|e| {
                if e.name == "import/curve-off-surface" {
                    Error::new("import/pcurve-lift-mismatch")
                } else {
                    e
                }
            })
        }
        Curve::Spline { .. } => {
            let source = source.homogeneous_spans()?;
            let s0 = &source[0].a;
            let s1 = &source.last().unwrap().b;
            let p0 = &lifted[0].a;
            let p1 = &lifted.last().unwrap().b;
            let mut budget = 65_536;
            for sp in &source {
                for pc in lifted {
                    let sa = (&sp.a - s0) / (s1 - s0);
                    let sb = (&sp.b - s0) / (s1 - s0);
                    let pa = (&pc.a - p0) / (p1 - p0);
                    let pb = (&pc.b - p0) / (p1 - p0);
                    let lo = sa.clone().max(pa.clone());
                    let hi = sb.clone().min(pb.clone());
                    if lo >= hi {
                        continue;
                    }
                    let s = sp
                        .coordinates
                        .iter()
                        .map(|p| {
                            restrict(
                                p,
                                &((&lo - &sa) / (&sb - &sa)),
                                &((&hi - &sa) / (&sb - &sa)),
                            )
                        })
                        .collect::<Vec<_>>();
                    let c = pc
                        .coordinates
                        .iter()
                        .map(|p| {
                            restrict(
                                p,
                                &((&lo - &pa) / (&pb - &pa)),
                                &((&hi - &pa) / (&pb - &pa)),
                            )
                        })
                        .collect::<Vec<_>>();
                    let tol = tolerance - &pc.chart_error_mm - &sp.chart_error_mm;
                    if tol < q(0) {
                        return fail("import/semantic-chart-proof-budget");
                    }
                    let difference = (0..3)
                        .map(|i| s[i].mul(&c[3]).sub(&c[i].mul(&s[3])))
                        .collect::<Vec<_>>();
                    let denominator = s[3].mul(&c[3]);
                    // A sufficient L1 certificate avoids squaring high-degree
                    // rational differences. It is stricter than the Euclidean
                    // budget; inconclusive controls fall through to that proof.
                    if range(&denominator).0 > q(0) {
                        let component_allowance = scale(&denominator, &(&tol / q(3)));
                        if difference.iter().all(|d| {
                            [
                                d.sub(&component_allowance),
                                d.neg().sub(&component_allowance),
                            ]
                            .iter()
                            .all(|p| {
                                p.is_zero()
                                    || filter_nonpositive(p)
                                    || p.to_bernstein(p.degree().unwrap_or(0))
                                        .unwrap()
                                        .iter()
                                        .all(|c| c <= &q(0))
                            })
                        }) {
                            continue;
                        }
                    }
                    let residual = difference
                        .iter()
                        .fold(Poly::zero(), |sum, d| sum.add(&square(d)));
                    let allowance = scale(&square(&denominator), &(&tol * &tol));
                    nonpositive(&residual.sub(&allowance), &mut budget, 0).map_err(|e| {
                        if e.name == "import/curve-off-surface" {
                            Error::new("import/pcurve-lift-mismatch")
                        } else {
                            e
                        }
                    })?;
                }
            }
            Ok(())
        }
    }
}
impl ReferenceDraft {
    /// Pcurve-to-edge residuals over complete bounded source domains.
    /// Curved spline lifts use rational Taylor enclosures; supported LINE
    /// domains are inverted from retained endpoints. This does not prove
    /// bidirectional trim coverage, winding or admit a Reference Model.
    pub fn check_pcurves(&self) -> Result<Vec<(u32, ResidualBound)>> {
        let mut proofs = Vec::new();
        for b in &self.bodies {
            if matches!(b.uncertainty, Uncertainty::Unknown) {
                return fail("import/source-tolerance-missing");
            }
            for edge in b.edges.values() {
                for pc in &edge.pcurves {
                    proofs.push((pc.id, b.check_pcurve(edge.id, pc.id)?));
                }
            }
        }
        Ok(proofs)
    }

    /// Certify every source vertex against its incident edge and carriers.
    /// This is an incidence check, not a claim about an occupied solid or an
    /// inversion of arbitrary spline trims. Spline endpoints must agree with
    /// the retained source endpoint/domain observations.
    pub fn check_vertices(&self) -> Result<Vec<(u32, u32, ResidualBound)>> {
        let mut proofs = Vec::new();
        for body in &self.bodies {
            let tolerance = match &body.uncertainty {
                Uncertainty::Declared { mm } => mm,
                Uncertainty::Unknown => return fail("import/source-tolerance-missing"),
            };
            for edge in body.edges.values() {
                let endpoints = if matches!(edge.curve, Curve::Spline { .. }) {
                    let spans = edge.curve.homogeneous_spans()?;
                    let mut endpoints = [
                        point_at(&spans[0], &q(0))?,
                        point_at(spans.last().unwrap(), &q(1))?,
                    ];
                    if !edge.same_sense {
                        endpoints.swap(0, 1);
                    }
                    Some(endpoints)
                } else {
                    None
                };
                for (index, id) in edge.vertices.iter().enumerate() {
                    let p = body
                        .vertices
                        .get(id)
                        .ok_or_else(|| Error::new("import/vertex-unaccounted"))?;
                    if let Some(endpoints) = &endpoints {
                        if dot(&sub(p, &endpoints[index]), &sub(p, &endpoints[index]))
                            > tolerance * tolerance
                        {
                            return fail("import/vertex-curve-mismatch");
                        }
                    } else {
                        certify_correspondence(&edge.curve, &[point_span(p)], tolerance).map_err(
                            |e| {
                                if e.name == "import/pcurve-lift-mismatch" {
                                    Error::new("import/vertex-curve-mismatch")
                                } else {
                                    e
                                }
                            },
                        )?;
                    }
                    proofs.push((
                        *id,
                        edge.id,
                        ResidualBound {
                            lower_mm: q(0),
                            upper_mm: tolerance.clone(),
                            method: "exact-rational/source-vertex-incidence",
                        },
                    ));
                }
            }
            let mut checked = BTreeSet::new();
            for face in &body.faces {
                let carrier = body
                    .surfaces
                    .get(&face.surface)
                    .ok_or_else(|| Error::new("import/face-surface-unaccounted"))?;
                for boundary in &face.loops {
                    for (edge, _) in &boundary.uses {
                        let edge = body
                            .edges
                            .get(edge)
                            .ok_or_else(|| Error::new("import/edge-unaccounted"))?;
                        for vertex in edge.vertices {
                            if checked.insert((vertex, face.surface)) {
                                let p = body
                                    .vertices
                                    .get(&vertex)
                                    .ok_or_else(|| Error::new("import/vertex-unaccounted"))?;
                                carrier.certify_spans(&[point_span(p)], tolerance).map_err(
                                    |e| {
                                        if e.name == "import/curve-off-surface" {
                                            Error::new("import/vertex-surface-mismatch")
                                        } else {
                                            e
                                        }
                                    },
                                )?;
                            }
                        }
                    }
                }
            }
        }
        Ok(proofs)
    }
}

impl Body {
    /// Nominal source carrier sample, with explicit enclosure precision.
    /// This does not select a trimmed face or change Reference admission.
    pub fn carrier_point_bounds(
        &self,
        surface: u32,
        parameters: [Q; 2],
        enclosure_budget_mm: &Q,
    ) -> Result<[CoordinateBound; 3]> {
        let carrier = self
            .surfaces
            .get(&surface)
            .ok_or_else(|| Error::new("import/surface-unaccounted"))?;
        let placed = self.placed_coordinate_bounds(&curved_lift::carrier_point(
            carrier,
            &self.unit_to_mm,
            &parameters,
            enclosure_budget_mm,
        )?)?;
        if placed
            .iter()
            .map(|b| (&b.upper_mm - &b.lower_mm) / q(2))
            .sum::<Q>()
            >= *enclosure_budget_mm
        {
            return fail("import/carrier-point-proof-budget");
        }
        Ok(placed)
    }
    /// Pull back a source-construction coordinate enclosure. Placements have
    /// not yet been applied. This is carrier projection, not face membership.
    pub fn carrier_parameter_bounds(
        &self,
        surface: u32,
        point: &[CoordinateBound; 3],
    ) -> Result<[ParameterBound; 2]> {
        let carrier = self
            .surfaces
            .get(&surface)
            .ok_or_else(|| Error::new("import/surface-unaccounted"))?;
        curved_lift::carrier_projection(carrier, &self.unit_to_mm, point)
    }
    /// A single source pcurve proof, useful for complete per-entity diagnostics.
    /// Success does not admit this body; every incidence, trim and winding
    /// check is still required before publication of a Reference Model.
    pub fn check_pcurve(&self, edge_id: u32, pcurve_id: u32) -> Result<ResidualBound> {
        let tolerance = match &self.uncertainty {
            Uncertainty::Declared { mm } => mm,
            Uncertainty::Unknown => return fail("import/source-tolerance-missing"),
        };
        let edge = self
            .edges
            .get(&edge_id)
            .ok_or_else(|| Error::new("import/edge-unaccounted"))?;
        let pc = edge
            .pcurves
            .iter()
            .find(|pc| pc.id == pcurve_id)
            .ok_or_else(|| Error::new("import/pcurve-unaccounted"))?;
        let surface = self
            .surfaces
            .get(&pc.surface)
            .ok_or_else(|| Error::new("import/pcurve-surface-unaccounted"))?;
        for vertex in edge.vertices {
            if !self.vertices.contains_key(&vertex) {
                return fail("import/vertex-unaccounted");
            }
        }
        if let Some(proof) =
            coaxial_circle_pcurve(&edge.curve, pc, surface, &self.unit_to_mm, tolerance)?
        {
            return Ok(proof);
        }
        let lifted = match surface {
            Carrier::Plane(axis) => {
                lift_plane_pcurve(pc, axis, &self.unit_to_mm, &self.vertices, edge.vertices)?
            }
            _ => curved_lift::lift_edge(
                pc,
                surface,
                &self.unit_to_mm,
                tolerance,
                edge,
                &self.vertices,
            )?,
        };
        certify_correspondence(&edge.curve, &lifted, tolerance)?;
        Ok(ResidualBound {
            lower_mm: q(0),
            upper_mm: tolerance.clone(),
            method: "exact-rational-bernstein/pcurve-correspondence",
        })
    }
}

/// The cylindrical-coordinate circle identity avoids expanding trigonometric
/// compositions when source axes and centres are proved coaxial. This is a
/// general carrier/curve identity, not a source-file or component-family path.
fn coaxial_circle_pcurve(
    source: &Curve,
    pc: &Pcurve,
    carrier: &Carrier,
    scale_mm: &Q,
    tolerance: &Q,
) -> Result<Option<ResidualBound>> {
    let (
        Curve::Circle {
            axis: circle,
            radius,
            dimension: 3,
        },
        Carrier::Cylinder(axis, r),
    ) = (source, carrier)
    else {
        return Ok(None);
    };
    if !matches!(pc.curve, Curve::Spline { .. }) {
        return Ok(None);
    }
    circle.enclosed_frame()?;
    axis.enclosed_frame()?;
    if radius <= &q(0) || r <= &q(0) {
        return fail("import/radius-invalid");
    }
    let d = sub(&circle.origin, &axis.origin);
    if cross(&circle.axis, &axis.axis) != [q(0), q(0), q(0)]
        || cross(&d, &axis.axis) != [q(0), q(0), q(0)]
    {
        return Ok(None);
    }
    let n = Interval::sqrt(&dot(&axis.axis, &axis.axis))?;
    let z = Interval::point(dot(&d, &axis.axis)).div(&n)?;
    let radial_squared = (radius - r) * (radius - r);
    let mut budget = 65_536;
    for span in pc.curve.homogeneous_spans()? {
        if span.coordinates.len() != 3 {
            return fail("import/pcurve-dimension-invalid");
        }
        let w = &span.coordinates[2];
        if range(w).0 <= q(0) {
            return fail("import/pcurve-weight-unproved");
        }
        let allowance = tolerance - z.radius() - &span.chart_error_mm * scale_mm;
        if allowance < q(0) {
            return Ok(None);
        }
        let height = scale(&span.coordinates[1], scale_mm).sub(&scale(w, &z.mid()));
        let residual = square(&height)
            .add(&scale(&square(w), &radial_squared))
            .sub(&scale(&square(w), &(&allowance * &allowance)));
        nonpositive(&residual, &mut budget, 0).map_err(|e| {
            if e.name == "import/curve-off-surface" {
                Error::new("import/pcurve-lift-mismatch")
            } else {
                e
            }
        })?;
    }
    Ok(Some(ResidualBound {
        lower_mm: q(0),
        upper_mm: tolerance.clone(),
        method: "exact-rational/cylindrical-coordinate-circle-identity",
    }))
}

fn point_span(p: &Point) -> HomogeneousSpan {
    HomogeneousSpan {
        a: q(0),
        b: q(1),
        coordinates: p
            .iter()
            .map(constant)
            .chain(std::iter::once(Poly::one()))
            .collect(),
        chart_error_mm: q(0),
    }
}
fn point_at(span: &HomogeneousSpan, parameter: &Q) -> Result<Point> {
    if span.coordinates.len() != 4 || !span.chart_error_mm.is_zero() {
        return fail("import/vertex-curve-domain-unproved");
    }
    let w = span.coordinates[3].evaluate(parameter).unwrap();
    if w <= q(0) {
        return fail("import/spline-weight-unproved");
    }
    Ok(std::array::from_fn(|i| {
        span.coordinates[i].evaluate(parameter).unwrap() / &w
    }))
}
/// Sound floating-point filter of the same implicit inequalities as the exact
/// path. Every input coefficient is outward enclosed from its rational value;
/// success requires every Bernstein coefficient enclosure to be nonpositive.
/// A failed filter changes no result: the exact path above remains mandatory.
#[derive(Clone)]
struct Ipoly(Vec<wonky_num::Iv>);
impl Ipoly {
    fn from(p: &Poly) -> Option<Self> {
        Some(Self(
            p.coefficients()
                .iter()
                .map(|q| wonky_curve::numeric::enclose(q).ok())
                .collect::<Option<Vec<_>>>()?,
        ))
    }
    fn zero() -> Self {
        Self(vec![wonky_num::Iv::point(0.)])
    }
    fn scalar(q: &Q) -> Option<wonky_num::Iv> {
        wonky_curve::numeric::enclose(q).ok()
    }
    fn add(&self, b: &Self) -> Self {
        Self(
            (0..self.0.len().max(b.0.len()))
                .map(|i| {
                    self.0.get(i).copied().unwrap_or(wonky_num::Iv::point(0.))
                        + b.0.get(i).copied().unwrap_or(wonky_num::Iv::point(0.))
                })
                .collect(),
        )
    }
    fn neg(&self) -> Self {
        self.scale(wonky_num::Iv::point(-1.))
    }
    fn sub(&self, b: &Self) -> Self {
        self.add(&b.neg())
    }
    fn scale(&self, s: wonky_num::Iv) -> Self {
        Self(self.0.iter().map(|c| *c * s).collect())
    }
    fn mul(&self, b: &Self) -> Self {
        let mut c = vec![wonky_num::Iv::point(0.); self.0.len() + b.0.len() - 1];
        for i in 0..self.0.len() {
            for j in 0..b.0.len() {
                c[i + j] = c[i + j] + self.0[i] * b.0[j];
            }
        }
        Self(c)
    }
    fn square(&self) -> Self {
        self.mul(self)
    }
    fn nonpositive(&self) -> bool {
        let n = self.0.len() - 1;
        if n > 32 {
            return false;
        }
        let choose = |n: usize, k: usize| -> u64 {
            (0..k).fold(1, |v, i| v * (n - i) as u64 / (i + 1) as u64)
        };
        for i in 0..=n {
            let mut sum = wonky_num::Iv::point(0.);
            for k in 0..=i {
                let r = Q::new(choose(i, k).into(), choose(n, k).into());
                let Some(r) = Self::scalar(&r) else {
                    return false;
                };
                sum = sum + self.0[k] * r;
            }
            if sum.is_nan() || sum.hi() > 0. {
                return false;
            }
        }
        true
    }
}
fn filter_carrier_span(carrier: &Carrier, span: &HomogeneousSpan, tolerance: &Q) -> bool {
    fn filter(carrier: &Carrier, span: &HomogeneousSpan, tolerance: &Q) -> Option<bool> {
        let c = span
            .coordinates
            .iter()
            .map(Ipoly::from)
            .collect::<Option<Vec<_>>>()?;
        let w = &c[3];
        let axis = carrier.axis();
        let d = (0..3)
            .map(|i| Some(c[i].sub(&w.scale(Ipoly::scalar(&axis.origin[i])?))))
            .collect::<Option<Vec<_>>>()?;
        let norm = d.iter().fold(Ipoly::zero(), |sum, d| sum.add(&d.square()));
        let mut axial = Ipoly::zero();
        for i in 0..3 {
            axial = axial.add(&d[i].scale(Ipoly::scalar(&axis.axis[i])?));
        }
        let n2 = dot(&axis.axis, &axis.axis);
        let n2iv = Ipoly::scalar(&n2)?;
        let w2 = w.square();
        let radial = norm.scale(n2iv).sub(&axial.square());
        match carrier {
            Carrier::Plane(_) => Some(
                axial
                    .square()
                    .sub(&w2.scale(Ipoly::scalar(&(tolerance * tolerance * &n2))?))
                    .nonpositive(),
            ),
            Carrier::Cylinder(_, r) | Carrier::Sphere(_, r) => {
                if tolerance >= r {
                    return Some(false);
                }
                let (expression, factor) = if matches!(carrier, Carrier::Cylinder(..)) {
                    (radial, n2)
                } else {
                    (norm, q(1))
                };
                let low = r - tolerance;
                let high = r + tolerance;
                Some(
                    expression
                        .sub(&w2.scale(Ipoly::scalar(&(&high * &high * &factor))?))
                        .nonpositive()
                        && w2
                            .scale(Ipoly::scalar(&(&low * &low * &factor))?)
                            .sub(&expression)
                            .nonpositive(),
                )
            }
            Carrier::Torus(_, major, minor) => {
                if tolerance >= minor || minor + tolerance >= *major {
                    return Some(false);
                }
                let implicit = |r: Q| -> Option<Ipoly> {
                    let a = norm.add(&w2.scale(Ipoly::scalar(&(major * major - &r * &r))?));
                    Some(
                        a.square().scale(n2iv).sub(
                            &radial
                                .mul(&w2)
                                .scale(Ipoly::scalar(&(q(4) * major * major))?),
                        ),
                    )
                };
                Some(
                    implicit(minor + tolerance)?.nonpositive()
                        && implicit(minor - tolerance)?.neg().nonpositive(),
                )
            }
            Carrier::Cone(..) | Carrier::Spline(..) => Some(false),
        }
    }
    filter(carrier, span, tolerance).unwrap_or(false)
}

#[cfg(test)]
mod correspondence_tests {
    use super::*;
    #[test]
    fn component_certificate_falls_back_without_changing_the_euclidean_budget() {
        let source = Curve::Spline {
            degree: 1,
            points: vec![vec![q(0), q(0), q(0)], vec![q(1), q(0), q(0)]],
            weights: vec![q(1), q(1)],
            knots: vec![q(0), q(0), q(1), q(1)],
        };
        let spans = source.homogeneous_spans().unwrap();
        for (offsets, accepted) in [
            ([q(1) / q(10), q(1) / q(10), q(1) / q(10)], true),
            ([q(7) / q(10), q(0), q(0)], true),
            ([q(7) / q(10), q(7) / q(10), q(7) / q(10)], false),
        ] {
            let mut lifted = spans.clone();
            for i in 0..3 {
                lifted[0].coordinates[i] = lifted[0].coordinates[i].add(&constant(&offsets[i]));
            }
            let result = certify_correspondence(&source, &lifted, &q(1));
            if accepted {
                result.unwrap();
            } else {
                assert_eq!(result.unwrap_err().name, "import/pcurve-lift-mismatch");
            }
        }
    }
}
