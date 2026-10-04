//! Rational Taylor centres with proved whole-domain remainder bounds.
//! The source remains analytic. These internal centres are proof enclosures,
//! never exported replacement geometry or an unlabelled approximation mode.
use super::*;

const MAX_ORDER: usize = 12;

// Every rational in one span shares a power of the source weight polynomial.
// Keeping that denominator explicit avoids multiplying identical factors on
// every addition and permits general rational pcurves on all five carriers.
#[derive(Clone)]
struct Rat {
    n: Poly,
    power: usize,
}
fn pow(p: &Poly, n: usize) -> Poly {
    (0..n).fold(Poly::one(), |a, _| a.mul(p))
}
impl Rat {
    fn source(n: &Poly, w: &Poly) -> Result<Self> {
        let (wl, _) = range(w);
        if wl <= q(0) {
            return fail("import/pcurve-weight-unproved");
        }
        let c = n.evaluate(&q(0)).unwrap() / w.evaluate(&q(0)).unwrap();
        if *n == scale(w, &c) {
            Ok(Self::constant(&c))
        } else {
            Ok(Self {
                n: n.clone(),
                power: 1,
            })
        }
    }
    fn constant(x: &Q) -> Self {
        Self {
            n: constant(x),
            power: 0,
        }
    }
    fn add(&self, b: &Self, w: &Poly) -> Self {
        let power = self.power.max(b.power);
        Self {
            n: self
                .n
                .mul(&pow(w, power - self.power))
                .add(&b.n.mul(&pow(w, power - b.power))),
            power,
        }
    }
    fn mul(&self, b: &Self) -> Self {
        Self {
            n: self.n.mul(&b.n),
            power: self.power + b.power,
        }
    }
    fn scale(&self, x: &Q) -> Self {
        Self {
            n: scale(&self.n, x),
            power: self.power,
        }
    }
    fn enclosure(&self, w: &Poly) -> Result<(Q, Q)> {
        let (nl, nh) = range(&self.n);
        let (wl, wh) = range(w);
        if wl <= q(0) {
            return fail("import/pcurve-weight-unproved");
        }
        let (dl, dh) = (wl.pow(self.power as i32), wh.pow(self.power as i32));
        let values = [&nl / &dl, &nl / &dh, &nh / &dl, &nh / &dh];
        Ok((
            values.iter().min().unwrap().clone(),
            values.iter().max().unwrap().clone(),
        ))
    }
    fn magnitude(&self, w: &Poly) -> Result<Q> {
        let (lo, hi) = self.enclosure(w)?;
        Ok(lo.abs().max(hi.abs()))
    }
}
#[derive(Clone)]
struct Approx {
    centre: Rat,
    error: Q,
}
impl Approx {
    fn exact(x: Q) -> Self {
        Self {
            centre: Rat::constant(&x),
            error: q(0),
        }
    }
    fn add(&self, b: &Self, w: &Poly) -> Self {
        Self {
            centre: self.centre.add(&b.centre, w),
            error: &self.error + &b.error,
        }
    }
    fn mul(&self, b: &Self, w: &Poly) -> Result<Self> {
        Ok(Self {
            centre: self.centre.mul(&b.centre),
            error: self.centre.magnitude(w)? * &b.error
                + b.centre.magnitude(w)? * &self.error
                + &self.error * &b.error,
        })
    }
    fn scale(&self, x: &Q) -> Self {
        Self {
            centre: self.centre.scale(x),
            error: &self.error * x.abs(),
        }
    }
}

/// Lagrange's remainder uses |sin^(n)|, |cos^(n)| <= 1. All arithmetic,
/// including the stopping condition and outward dyadic rounding, is rational.
fn scalar_trig(x: &Q, sine: bool) -> Result<Approx> {
    if x.abs() > q(16) {
        return fail("import/pcurve-angular-proof-budget");
    }
    let grid = Q::new(1.into(), wonky_alg::BigInt::from(1) << 100_usize);
    let mut sum = q(0);
    let mut term = q(1);
    let mut absolute_term = q(1);
    for k in 0..=128 {
        if (sine && k % 2 == 1) || (!sine && k % 2 == 0) {
            sum += if k % 4 == 0 || k % 4 == 1 {
                term.clone()
            } else {
                -&term
            };
        }
        term = term * x / q((k + 1) as i64);
        absolute_term = absolute_term * x.abs() / q((k + 1) as i64);
        if k >= 12 && absolute_term <= grid {
            let lo = ((&sum - &absolute_term) / &grid).floor() * &grid;
            let hi = ((&sum + &absolute_term) / &grid).ceil() * &grid;
            return Ok(Approx {
                centre: Rat::constant(&((&lo + &hi) / q(2))),
                error: (&hi - &lo) / q(2),
            });
        }
    }
    fail("import/pcurve-angular-proof-budget")
}

fn trig(input: &Approx, w: &Poly, sine: bool, allowance: &Q) -> Result<Approx> {
    let (lo, hi) = input.centre.enclosure(w)?;
    let original_mid = (&lo + &hi) / q(2);
    let period = pi_bounds();
    let period = Interval(q(2) * period.0, q(2) * period.1);
    let turns = (&original_mid / period.mid()).round();
    let shift = &turns * period.mid();
    let phase_error = turns.abs() * period.radius();
    let mid = &original_mid - &shift;
    let radius = (&hi - &lo) / q(2);
    if radius > q(1) / q(4) {
        return fail("import/pcurve-chart-needs-subdivision");
    }
    let sin = scalar_trig(&mid, true)?;
    let cos = scalar_trig(&mid, false)?;
    if radius.is_zero() {
        let mut result = if sine { sin } else { cos };
        result.error += &input.error + &phase_error;
        return Ok(result);
    }
    let h = input.centre.add(&Rat::constant(&(-original_mid)), w);
    let mut hp = Rat::constant(&q(1));
    let mut factorial = q(1);
    let mut rp = q(1);
    let mut centre = Rat::constant(&q(0));
    let mut error = &input.error + phase_error; // sin/cos are globally 1-Lipschitz.
    for k in 0..=MAX_ORDER {
        let (coefficient, sign) = match (sine, k % 4) {
            (true, 0) | (false, 3) => (&sin, q(1)),
            (true, 1) | (false, 0) => (&cos, q(1)),
            (true, 2) | (false, 1) => (&sin, q(-1)),
            _ => (&cos, q(-1)),
        };
        centre = centre.add(&hp.mul(&coefficient.centre).scale(&(sign / &factorial)), w);
        error += &coefficient.error * &rp / &factorial;
        hp = hp.mul(&h);
        rp *= &radius;
        factorial *= q((k + 1) as i64);
        let remainder = &rp / &factorial;
        if &error + &remainder <= *allowance {
            return Ok(Approx {
                centre,
                error: error + remainder,
            });
        }
    }
    fail("import/pcurve-chart-needs-subdivision")
}

fn lift_span(
    span: &HomogeneousSpan,
    carrier: &Carrier,
    scale_mm: &Q,
    tolerance: &Q,
) -> Result<HomogeneousSpan> {
    if span.coordinates.len() != 3 {
        return fail("import/pcurve-dimension-invalid");
    }
    let w = &span.coordinates[2];
    let uv = (0..2)
        .map(|i| {
            Ok(Approx {
                centre: Rat::source(&span.coordinates[i], w)?,
                error: span.chart_error_mm.clone(),
            })
        })
        .collect::<Result<Vec<_>>>()?;
    // Choose degree from proved remainder bounds. The final composed distance
    // enclosure independently checks the unchanged source allowance below.
    let geometry_scale = match carrier {
        Carrier::Cylinder(_, r) | Carrier::Sphere(_, r) => r.abs() + q(1),
        Carrier::Cone(_, r, _) => r.abs() + uv[1].centre.magnitude(w)? * scale_mm.abs() + q(1),
        Carrier::Torus(_, major, minor) => major.abs() + minor.abs() + q(1),
        Carrier::Plane(_) | Carrier::Spline(..) => return fail("import/pcurve-lift-kind"),
    };
    let angular_allowance = tolerance / (q(4096) * geometry_scale);
    let cu = trig(&uv[0], w, false, &angular_allowance)?;
    let su = trig(&uv[0], w, true, &angular_allowance)?;
    let local = match carrier {
        Carrier::Cylinder(_, r) => [cu.scale(r), su.scale(r), uv[1].scale(scale_mm)],
        Carrier::Cone(_, r, angle) => {
            let sin = scalar_trig(angle, true)?;
            let cos = scalar_trig(angle, false)?;
            let slant = uv[1].scale(scale_mm);
            let radius = slant.mul(&sin, w)?.add(&Approx::exact(r.clone()), w);
            [
                radius.mul(&cu, w)?,
                radius.mul(&su, w)?,
                slant.mul(&cos, w)?,
            ]
        }
        Carrier::Sphere(_, r) => {
            let cv = trig(&uv[1], w, false, &angular_allowance)?;
            let sv = trig(&uv[1], w, true, &angular_allowance)?;
            [
                cv.mul(&cu, w)?.scale(r),
                cv.mul(&su, w)?.scale(r),
                sv.scale(r),
            ]
        }
        Carrier::Torus(_, major, minor) => {
            let cv = trig(&uv[1], w, false, &angular_allowance)?;
            let sv = trig(&uv[1], w, true, &angular_allowance)?;
            let radius = cv.scale(minor).add(&Approx::exact(major.clone()), w);
            [radius.mul(&cu, w)?, radius.mul(&su, w)?, sv.scale(minor)]
        }
        Carrier::Plane(_) | Carrier::Spline(..) => return fail("import/pcurve-lift-kind"),
    };
    let (frame, frame_error) = carrier.axis().enclosed_frame()?;
    let nominal_radius = local
        .iter()
        .map(|a| a.centre.magnitude(w))
        .collect::<Result<Vec<_>>>()?
        .into_iter()
        .max()
        .unwrap();
    // Semantic rotation preserves Euclidean error. L1 bounds Euclidean norm;
    // the centre-frame error is then bounded separately on the nominal vector.
    let chart_error_mm =
        local.iter().map(|a| a.error.clone()).sum::<Q>() + frame_error * nominal_radius;
    let xyz = (0..3)
        .map(|i| {
            local
                .iter()
                .enumerate()
                .fold(Rat::constant(&frame.origin()[i]), |s, (j, a)| {
                    s.add(&a.centre.scale(&frame.columns()[j][i]), w)
                })
        })
        .collect::<Vec<_>>();
    let power = xyz.iter().map(|a| a.power).max().unwrap();
    let coordinates = xyz
        .iter()
        .map(|a| a.n.mul(&pow(w, power - a.power)))
        .chain(std::iter::once(pow(w, power)))
        .collect();
    Ok(HomogeneousSpan {
        a: span.a.clone(),
        b: span.b.clone(),
        coordinates,
        chart_error_mm,
    })
}

pub(super) fn subdivide(span: &HomogeneousSpan) -> [HomogeneousSpan; 2] {
    let mid = (&span.a + &span.b) / q(2);
    [
        (q(0), q(1) / q(2), span.a.clone(), mid.clone()),
        (q(1) / q(2), q(1), mid, span.b.clone()),
    ]
    .map(|(lo, hi, a, b)| HomogeneousSpan {
        a,
        b,
        coordinates: span
            .coordinates
            .iter()
            .map(|p| restrict(p, &lo, &hi))
            .collect(),
        chart_error_mm: span.chart_error_mm.clone(),
    })
}

pub(super) fn lift(
    pc: &Pcurve,
    carrier: &Carrier,
    scale_mm: &Q,
    tolerance: &Q,
) -> Result<Vec<HomogeneousSpan>> {
    // Unbounded STEP LINE parameters require certified trim inversion and
    // winding. Refuse until those domains exist; no guessed [0,1] segment.
    if !matches!(pc.curve, Curve::Spline { .. }) {
        return fail("import/pcurve-curved-lift-proof-unavailable");
    }
    if !matches!(carrier, Carrier::Spline(..)) && tolerance <= &q(0) {
        return fail("import/pcurve-transcendental-allowance-required");
    }
    lift_spans(pc.curve.homogeneous_spans()?, carrier, scale_mm, tolerance)
}

fn lift_spans(
    spans: Vec<HomogeneousSpan>,
    carrier: &Carrier,
    scale_mm: &Q,
    tolerance: &Q,
) -> Result<Vec<HomogeneousSpan>> {
    if let Carrier::Spline(_, surface) = carrier {
        return super::spline_lift::lift(spans, surface);
    }
    let mut pending = spans.into_iter().rev().map(|s| (s, 0)).collect::<Vec<_>>();
    let mut result = Vec::new();
    let mut budget = 4096_usize;
    while let Some((span, depth)) = pending.pop() {
        if budget == 0 {
            return fail("import/pcurve-lift-proof-budget");
        }
        budget -= 1;
        match lift_span(&span, carrier, scale_mm, tolerance) {
            Ok(lifted) => {
                if lifted.chart_error_mm >= tolerance / q(4) {
                    return fail("import/semantic-chart-proof-budget");
                }
                result.push(lifted);
            }
            Err(e) if e.name == "import/pcurve-chart-needs-subdivision" && depth < 16 => {
                let [left, right] = subdivide(&span);
                pending.push((right, depth + 1));
                pending.push((left, depth + 1));
            }
            Err(e) => return Err(e),
        }
    }
    Ok(result)
}

pub(in crate::import::reference) fn check_cone_angle(angle: &Q) -> Result<()> {
    let pi = pi_bounds();
    if angle <= &q(0) || angle >= &(&pi.1 / q(2)) {
        return fail("import/cone-angle-invalid");
    }
    if angle >= &(&pi.0 / q(2)) {
        return fail("import/cone-angle-domain-undecidable");
    }
    Ok(())
}

pub(super) fn pi_bounds() -> Interval {
    fn atan(x: Q) -> Interval {
        let mut sum = q(0);
        let mut power = x.clone();
        for k in 0..32 {
            let term = &power / q(2 * k + 1);
            sum += if k % 2 == 0 { term } else { -term };
            power *= &x * &x;
        }
        // The 32nd term is negative; alternating remainder is positive and
        // at most the next term. Machin's identity supplies the period.
        Interval(sum.clone(), sum + power / q(65))
    }
    let a = atan(q(1) / q(5));
    let b = atan(q(1) / q(239));
    let enclosure = Interval(q(16) * a.0 - q(4) * b.1, q(16) * a.1 - q(4) * b.0);
    // Keep the proof enclosure, but avoid carrying the Machin-series odd
    // denominators into every subsequent polynomial coefficient.
    let grid = Q::new(1.into(), wonky_alg::BigInt::from(1) << 100_usize);
    Interval(
        (&enclosure.0 / &grid).floor() * &grid,
        (&enclosure.1 / &grid).ceil() * &grid,
    )
}

fn interval_sum(a: &Interval, b: &Interval) -> Interval {
    Interval(&a.0 + &b.0, &a.1 + &b.1)
}
fn interval_neg(a: &Interval) -> Interval {
    Interval(-&a.1, -&a.0)
}
fn dyadic_enclosure(a: Interval) -> Interval {
    let grid = Q::new(1.into(), wonky_alg::BigInt::from(1) << 100_usize);
    Interval(
        (&a.0 / &grid).floor() * &grid,
        (&a.1 / &grid).ceil() * &grid,
    )
}

/// Monotonic atan with exact alternating remainders; range reduction makes
/// the series argument at most 1/2 without using floating-point angles.
fn atan_point(x: &Q) -> Result<Interval> {
    if x.is_negative() {
        return Ok(interval_neg(&atan_point(&(-x))?));
    }
    let pi = pi_bounds();
    if x > &q(1) {
        return Ok(Interval(&pi.0 / q(2), &pi.1 / q(2)).sub(&atan_point(&(q(1) / x))?));
    }
    if x > &(q(1) / q(2)) {
        return Ok(interval_sum(
            &Interval(&pi.0 / q(4), &pi.1 / q(4)),
            &atan_point(&((x - q(1)) / (x + q(1))))?,
        ));
    }
    let grid = Q::new(1.into(), wonky_alg::BigInt::from(1) << 110_usize);
    let mut sum = q(0);
    let mut power = x.clone();
    for k in 0..256 {
        let term = &power / q(2 * k + 1);
        sum += if k % 2 == 0 { term } else { -term };
        power *= x * x;
        let remainder = &power / q(2 * k + 3);
        if remainder <= grid {
            let enclosure = if k % 2 == 0 {
                Interval(&sum - &remainder, sum)
            } else {
                Interval(sum.clone(), sum + remainder)
            };
            return Ok(dyadic_enclosure(enclosure));
        }
    }
    fail("import/pcurve-angular-proof-budget")
}
fn atan_interval(x: &Interval) -> Result<Interval> {
    Ok(Interval(atan_point(&x.0)?.0, atan_point(&x.1)?.1))
}
/// A local continuous angular lift. Around negative Y it uses the lift
/// near -pi/2; across that seam the equivalent principal-branch angles can
/// differ by 2pi. Public principal-chart queries must detect that case.
fn angular_coordinate(x: &Interval, y: &Interval) -> Result<Interval> {
    if x.0 > q(0) {
        return atan_interval(&y.div(x)?);
    }
    let pi = pi_bounds();
    if x.1 < q(0) {
        return Ok(interval_sum(&pi, &atan_interval(&y.div(x)?)?));
    }
    if y.0 > q(0) {
        return Ok(Interval(&pi.0 / q(2), &pi.1 / q(2)).sub(&atan_interval(&x.div(y)?)?));
    }
    if y.1 < q(0) {
        return Ok(
            interval_neg(&Interval(&pi.0 / q(2), &pi.1 / q(2))).sub(&atan_interval(&x.div(y)?)?)
        );
    }
    fail("import/pcurve-angular-inversion-undecidable")
}

/// Project a source point into the semantic orthonormal carrier frame.
fn local_coordinate(point: &Point, axis: &Axis, coordinate: usize) -> Result<Interval> {
    let columns = axis.semantic_columns()?;
    let d = sub(point, &axis.origin);
    Ok((0..3).fold(Interval::point(q(0)), |sum, i| {
        let term = columns[coordinate][i].mul(&Interval::point(d[i].clone()));
        Interval(sum.0 + term.0, sum.1 + term.1)
    }))
}

fn check_trim_endpoints(spans: &[HomogeneousSpan], ends: [&Point; 2], tolerance: &Q) -> Result<()> {
    for (span, t, vertex) in [
        (&spans[0], q(0), ends[0]),
        (spans.last().unwrap(), q(1), ends[1]),
    ] {
        let w = span.coordinates[3].evaluate(&t).unwrap();
        let p: Point = std::array::from_fn(|i| span.coordinates[i].evaluate(&t).unwrap() / &w);
        let allowance = tolerance - &span.chart_error_mm;
        let difference = sub(&p, vertex);
        if allowance < q(0) || dot(&difference, &difference) > &allowance * &allowance {
            return fail("import/pcurve-trim-endpoint-mismatch");
        }
    }
    Ok(())
}

/// A vertical cylinder/cone chart line has a unique slant/axial parameter.
/// Its finite domain comes from the retained source endpoints, never [0,1]
/// guessed on the unbounded STEP LINE.
fn chart_axial_line(
    pc: &Pcurve,
    carrier: &Carrier,
    scale_mm: &Q,
    tolerance: &Q,
    edge: &Edge,
    vertices: &BTreeMap<u32, Point>,
) -> Result<Option<Vec<HomogeneousSpan>>> {
    let Curve::Line { origin, direction } = &pc.curve else {
        return Ok(None);
    };
    if !matches!(edge.curve, Curve::Line { .. } | Curve::Spline { .. }) {
        return Ok(None);
    }
    if origin.len() != 2
        || direction.len() != 2
        || !direction[0].is_zero()
        || direction[1].is_zero()
    {
        return Ok(None);
    }
    let axial_scale = match carrier {
        Carrier::Cylinder(_, _) => Interval::point(scale_mm.clone()),
        Carrier::Cone(_, _, angle) => {
            let c = scalar_trig(angle, false)?;
            let value = c.centre.n.evaluate(&q(0)).unwrap();
            Interval(&value - &c.error, &value + &c.error).mul(&Interval::point(scale_mm.clone()))
        }
        _ => return Ok(None),
    };
    let ends = edge.vertices.map(|id| {
        vertices
            .get(&id)
            .ok_or_else(|| Error::new("import/vertex-unaccounted"))
    });
    let ends = [ends[0].clone()?, ends[1].clone()?];
    // Spline observations retain the geometric curve's parameter direction.
    // EDGE_CURVE.same_sense only orders its topological endpoint identities.
    let source = edge.source_spans(vertices, tolerance)?;
    let ends = if matches!(edge.curve, Curve::Spline { .. }) && !edge.same_sense {
        [ends[1], ends[0]]
    } else {
        ends
    };
    let column = &carrier.axis().semantic_columns()?[2];
    let column_error = column.iter().map(Interval::radius).sum::<Q>();
    let inverse = Interval::point(q(1)).div(&axial_scale)?;
    let inverse_max = inverse.0.abs().max(inverse.1.abs());
    let mut parameters = Vec::new();
    for span in source {
        if span.coordinates.len() != 4 {
            return fail("import/pcurve-dimension-invalid");
        }
        let w = &span.coordinates[3];
        let wl = range(w).0;
        if wl <= q(0) {
            return fail("import/pcurve-weight-unproved");
        }
        let relative = (0..3)
            .map(|i| span.coordinates[i].sub(&scale(w, &carrier.axis().origin[i])))
            .collect::<Vec<_>>();
        let point_radius = relative
            .iter()
            .map(|p| {
                let (lo, hi) = range(p);
                lo.abs().max(hi.abs()) / &wl
            })
            .max()
            .unwrap();
        let axial = (0..3).fold(Poly::zero(), |sum, i| {
            sum.add(&scale(&relative[i], &column[i].mid()))
        });
        let (lo, hi) = range(&axial);
        let axial_radius = lo.abs().max(hi.abs()) / &wl;
        // Unit semantic Z bounds source chart error by its Euclidean error.
        // Interval column and inverse-scale errors are charged separately.
        let error = (column_error.clone() * point_radius + span.chart_error_mm) * &inverse_max
            + axial_radius * inverse.radius();
        parameters.push(HomogeneousSpan {
            a: span.a,
            b: span.b,
            coordinates: vec![
                scale(w, &origin[0]),
                scale(&axial, &inverse.mid()),
                w.clone(),
            ],
            chart_error_mm: error,
        });
    }
    let _ = ends;
    Ok(Some(parameters))
}

/// Infer the finite angular trim of a horizontal LINE from source CIRCLE
/// endpoints and direction. Periodic branches are selected by exact signs;
/// uncertain branch separation refuses instead of selecting a short arc.
pub(super) fn lift_edge(
    pc: &Pcurve, carrier: &Carrier, scale_mm: &Q, tolerance: &Q,
    edge: &Edge, vertices: &BTreeMap<u32, Point>,
) -> Result<Vec<HomogeneousSpan>> {
    if matches!(pc.curve, Curve::Spline { .. }) { return lift(pc, carrier, scale_mm, tolerance); }
    let spans = chart_edge(pc, carrier, scale_mm, tolerance, edge, vertices)?;
    let lifted = lift_spans(spans, carrier, scale_mm, tolerance)?;
    // Preserve the source spline's parameter direction.
    let mut ends = [vertices.get(&edge.vertices[0]), vertices.get(&edge.vertices[1])];
    if matches!(edge.curve, Curve::Spline { .. }) && !edge.same_sense { ends.swap(0, 1); }
    let ends = [ends[0].ok_or_else(|| Error::new("import/vertex-unaccounted"))?,
                ends[1].ok_or_else(|| Error::new("import/vertex-unaccounted"))?];
    check_trim_endpoints(&lifted, ends, tolerance)?;
    Ok(lifted)
}

/// The cylindrical identity can avoid a costly whole-curve trigonometric
/// expansion, but its finite pcurve domain must still reach retained vertices.
pub(super) fn check_chart_endpoints(
    pc: &Pcurve, carrier: &Carrier, scale_mm: &Q, tolerance: &Q,
    edge: &Edge, vertices: &BTreeMap<u32, Point>,
) -> Result<()> {
    let spans = chart_edge(pc, carrier, scale_mm, tolerance, edge, vertices)?;
    let mut points = Vec::new();
    for (span, t) in [(&spans[0], q(0)), (spans.last().unwrap(), q(1))] {
        points.push(HomogeneousSpan {
            a: q(0), b: q(1),
            coordinates: span.coordinates.iter().map(|p| constant(&p.evaluate(&t).unwrap())).collect(),
            chart_error_mm: span.chart_error_mm.clone(),
        });
    }
    let lifted = lift_spans(points, carrier, scale_mm, tolerance)?;
    let mut ids = edge.vertices;
    if !edge.same_sense { ids.swap(0,1); }
    let ends = ids.map(|id| vertices.get(&id).ok_or_else(|| Error::new("import/vertex-unaccounted")));
    check_trim_endpoints(&lifted, [ends[0].clone()?, ends[1].clone()?], tolerance)
}

pub(super) fn chart_edge(
    pc: &Pcurve,
    carrier: &Carrier,
    scale_mm: &Q,
    tolerance: &Q,
    edge: &Edge,
    vertices: &BTreeMap<u32, Point>,
) -> Result<Vec<HomogeneousSpan>> {
    if matches!(pc.curve, Curve::Spline { .. }) {
        let spans = pc.curve.homogeneous_spans()?;
        if spans.iter().any(|s| s.coordinates.len() != 3) {
            return fail("import/pcurve-dimension-invalid");
        }
        // Endpoint and arc coverage use continuity, not just membership in
        // an infinite carrier. A repeated knot must not hide a chart jump.
        for pair in spans.windows(2) {
            let a = pair[0].coordinates.iter().map(|p| p.evaluate(&q(1)).unwrap()).collect::<Vec<_>>();
            let b = pair[1].coordinates.iter().map(|p| p.evaluate(&q(0)).unwrap()).collect::<Vec<_>>();
            if a[2] <= q(0) || b[2] <= q(0) { return fail("import/pcurve-weight-unproved"); }
            if pair[0].b != pair[1].a || (0..2).any(|i| &a[i]*&b[2] != &b[i]*&a[2]) {
                return fail("import/pcurve-chart-discontinuous");
            }
        }
        if let Some(trimmed) = axial_spline_trim(&spans, pc, carrier, scale_mm, tolerance, edge, vertices)? {
            return Ok(trimmed);
        }
        if let Some(trimmed) = circular_chart_line_trim(&spans, pc, carrier, scale_mm, tolerance, edge, vertices)? {
            return Ok(trimmed);
        }
        return Ok(spans);
    }
    if tolerance <= &q(0) {
        return fail("import/pcurve-transcendental-allowance-required");
    }
    if let Some(spans) = chart_axial_line(pc, carrier, scale_mm, tolerance, edge, vertices)? {
        return Ok(spans);
    }
    let (
        Curve::Line { origin, direction },
        Curve::Circle {
            axis, dimension: 3, ..
        },
    ) = (&pc.curve, &edge.curve)
    else {
        return fail("import/pcurve-curved-line-trim-inversion-unavailable");
    };
    if origin.len() != 2
        || direction.len() != 2
        || direction[0].is_zero()
        || !direction[1].is_zero()
    {
        return fail("import/pcurve-curved-line-trim-inversion-unavailable");
    }
    if cross(&axis.axis, &carrier.axis().axis) != [q(0), q(0), q(0)] {
        return fail("import/pcurve-angular-axis-incompatible");
    }
    let orientation = dot(&axis.axis, &carrier.axis().axis);
    if orientation.is_zero() {
        return fail("import/pcurve-orientation-undecidable");
    }
    let ends = edge.vertices.map(|id| {
        vertices
            .get(&id)
            .ok_or_else(|| Error::new("import/vertex-unaccounted"))
    });
    let ends = [ends[0].clone()?, ends[1].clone()?];
    let start = angular_coordinate(
        &local_coordinate(ends[0], carrier.axis(), 0)?,
        &local_coordinate(ends[0], carrier.axis(), 1)?,
    )?;
    let pi = pi_bounds();
    let period = Interval(q(2) * pi.0, q(2) * pi.1);
    let positive = orientation.is_positive() == edge.same_sense;
    let delta = if edge.vertices[0] == edge.vertices[1] {
        if positive {
            period
        } else {
            interval_neg(&period)
        }
    } else {
        let end = angular_coordinate(
            &local_coordinate(ends[1], carrier.axis(), 0)?,
            &local_coordinate(ends[1], carrier.axis(), 1)?,
        )?;
        let delta = end.sub(&start);
        if delta.0 <= q(0) && delta.1 >= q(0) {
            return fail("import/pcurve-angular-trim-branch-undecidable");
        }
        if positive && delta.1 < q(0) {
            interval_sum(&delta, &period)
        } else if !positive && delta.0 > q(0) {
            delta.sub(&period)
        } else {
            delta
        }
    };
    let end = interval_sum(&start, &delta);
    let span = HomogeneousSpan {
        a: q(0),
        b: q(1),
        coordinates: vec![
            poly(vec![start.mid(), delta.mid()]),
            constant(&origin[1]),
            Poly::one(),
        ],
        chart_error_mm: start.radius().max(end.radius()),
    };
    Ok(vec![span])
}

/// Derive a finite meridian trim only after continuity and exact constant-U
/// identity prove the source chart covers the projected retained interval.
fn axial_spline_trim(
    spans: &[HomogeneousSpan], pc: &Pcurve, carrier: &Carrier,
    scale_mm: &Q, tolerance: &Q, edge: &Edge, vertices: &BTreeMap<u32, Point>,
) -> Result<Option<Vec<HomogeneousSpan>>> {
    if !matches!(edge.curve, Curve::Line { .. }) { return Ok(None); }
    let first=&spans[0]; let last=spans.last().unwrap();
    let w0=first.coordinates[2].evaluate(&q(0)).unwrap();
    let w1=last.coordinates[2].evaluate(&q(1)).unwrap();
    if w0 <= q(0) || w1 <= q(0) {return fail("import/pcurve-weight-unproved");}
    let u=first.coordinates[0].evaluate(&q(0)).unwrap()/&w0;
    if spans.iter().any(|s| s.coordinates[0] != scale(&s.coordinates[2],&u)) {return Ok(None);}
    let a=first.coordinates[1].evaluate(&q(0)).unwrap()/w0;
    let b=last.coordinates[1].evaluate(&q(1)).unwrap()/w1;
    let line=Pcurve {id:pc.id,surface:pc.surface,curve:Curve::Line {
        origin:vec![u,q(0)],direction:vec![q(0),q(1)]}};
    let Some(mut trimmed)=chart_axial_line(&line,carrier,scale_mm,tolerance,edge,vertices)? else {return Ok(None);};
    let lo=a.clone().min(b.clone()); let hi=a.max(b);
    for span in &trimmed {
        let (nl,nh)=range(&span.coordinates[1]);
        let (wl,wh)=range(&span.coordinates[2]);
        if wl <= q(0) {return fail("import/pcurve-weight-unproved");}
        let bound=Interval(nl,nh).div(&Interval(wl,wh))?;
        if bound.0-&span.chart_error_mm < lo
            || bound.1+&span.chart_error_mm > hi {return Ok(None);}
    }
    if !edge.same_sense {
        trimmed.reverse();
        for span in &mut trimmed {span.coordinates=span.coordinates.iter().map(|p| restrict(p,&q(1),&q(0))).collect();}
    }
    let lifted=lift_spans(trimmed.clone(),carrier,scale_mm,tolerance)?;
    certify_correspondence(&edge.curve,&lifted,tolerance)?;
    Ok(Some(trimmed))
}

/// A continuous rational chart spline with one constant coordinate has a
/// chart-line locus. Invert the retained circle endpoints, prove its finite
/// interval is covered, then independently certify the lifted trim and arc.
fn circular_chart_line_trim(
    spans: &[HomogeneousSpan], _pc: &Pcurve, carrier: &Carrier,
    scale_mm: &Q, tolerance: &Q, edge: &Edge, vertices: &BTreeMap<u32, Point>,
) -> Result<Option<Vec<HomogeneousSpan>>> {
    let Curve::Circle {radius, ..} = &edge.curve else {return Ok(None);};
    if matches!(carrier, Carrier::Plane(..) | Carrier::Spline(..)) {return Ok(None);}
    let first=&spans[0]; let last=spans.last().unwrap();
    let w0=first.coordinates[2].evaluate(&q(0)).unwrap();
    let w1=last.coordinates[2].evaluate(&q(1)).unwrap();
    if w0 <= q(0) || w1 <= q(0) {return fail("import/pcurve-weight-unproved");}
    let mut fixed=None;
    for i in 0..2 {
        let value=first.coordinates[i].evaluate(&q(0)).unwrap()/&w0;
        if spans.iter().all(|s| s.coordinates[i] == scale(&s.coordinates[2],&value)) {
            fixed=Some((i,value)); break;
        }
    }
    let Some((constant_index,value))=fixed else {return Ok(None);};
    let varying=1-constant_index;
    // Only angular coordinates are periodic. Other chart-line loci use the
    // axial projection proof above, or retain the original domain.
    if varying==1 && !matches!(carrier,Carrier::Sphere(..)|Carrier::Torus(..)) {return Ok(None);}
    let u0=first.coordinates[varying].evaluate(&q(0)).unwrap()/w0;
    let u1=last.coordinates[varying].evaluate(&q(1)).unwrap()/w1;
    if u0==u1 {return Ok(None);}
    let mut ids=edge.vertices;
    if !edge.same_sense {ids.swap(0,1);}
    let project=|id| -> Result<Interval> {
        let p=vertices.get(&id).ok_or_else(||Error::new("import/vertex-unaccounted"))?;
        let box_mm=p.clone().map(|x|CoordinateBound {lower_mm:x.clone(),upper_mm:x});
        let parameter=carrier_projection(carrier,scale_mm,&box_mm)?;
        Ok(Interval(parameter[varying].lower.clone(),parameter[varying].upper.clone()))
    };
    let start=project(ids[0])?; let endpoint=project(ids[1])?;
    let pi=pi_bounds(); let period=Interval(q(2)*pi.0,q(2)*pi.1);
    let positive=u1>u0;
    let delta=if ids[0]==ids[1] {
        if positive {period.clone()} else {interval_neg(&period)}
    } else {
        let delta=endpoint.sub(&start);
        if delta.0<=q(0) && delta.1>=q(0) {return Ok(None);}
        if positive && delta.1<q(0) {interval_sum(&delta,&period)}
        else if !positive && delta.0>q(0) {delta.sub(&period)} else {delta}
    };
    let end=interval_sum(&start,&delta);
    let turns=(((&u0+&u1)-(start.mid()+end.mid()))/(q(2)*period.mid())).round();
    let shift=&turns*period.mid(); let error=turns.abs()*period.radius();
    let lo=start.0.clone().min(end.0.clone())+&shift-&error;
    let hi=start.1.clone().max(end.1.clone())+&shift+&error;
    let raw_lo=u0.clone().min(u1.clone()); let raw_hi=u0.max(u1);
    let gap=(raw_lo-lo).max(q(0)).max((hi-raw_hi).max(q(0)));
    // Account for decimal endpoint truncation within existing source allowance.
    if radius <= &q(0) || &gap*(radius+tolerance) > tolerance/q(8) {return Ok(None);}
    let mut coordinates=vec![constant(&value),constant(&value),Poly::one()];
    coordinates[varying]=poly(vec![start.mid()+shift,delta.mid()]);
    let trimmed=vec![HomogeneousSpan {a:q(0),b:q(1),coordinates,
        chart_error_mm:start.radius().max(end.radius())+error+gap}];
    let lifted=lift_spans(trimmed.clone(),carrier,scale_mm,tolerance)?;
    certify_correspondence(&edge.curve,&lifted,tolerance)?;
    Ok(Some(trimmed))
}

/// Membership in an infinite circle is not coverage of its retained trim.
/// Closed rings must traverse a period; open spline observations must stay
/// on the oriented chord side occupied by the retained source arc.
pub(super) fn certify_circle_trim_chart(
    spans: &mut [HomogeneousSpan], pc: &Pcurve, carrier: &Carrier,
    scale_mm: &Q, tolerance: &Q, edge: &Edge, vertices: &BTreeMap<u32, Point>,
) -> Result<()> {
    let Curve::Circle {axis, radius, ..} = &edge.curve else { return Ok(()); };
    if edge.vertices[0] == edge.vertices[1] {
        let angular = match carrier {
            Carrier::Torus(..) => 2,
            Carrier::Spline(..) => 0,
            Carrier::Plane(..) | Carrier::Cylinder(..) | Carrier::Cone(..) | Carrier::Sphere(..) => 1,
        };
        let period = pi_bounds();
        let period = Interval(q(2)*period.0, q(2)*period.1);
        if radius <= &q(0) || tolerance >= &(radius/q(4)) {
            return fail("import/pcurve-circular-trim-coverage-undecidable");
        }
        let first = &spans[0]; let last = spans.last().unwrap();
        let start_w = first.coordinates[2].evaluate(&q(0)).unwrap();
        let end_w = last.coordinates[2].evaluate(&q(1)).unwrap();
        if start_w <= q(0) || end_w <= q(0) { return fail("import/pcurve-weight-unproved"); }
        let delta = (0..angular).map(|i| {
            (last.coordinates[i].evaluate(&q(1)).unwrap()/&end_w
                - first.coordinates[i].evaluate(&q(0)).unwrap()/&start_w).abs()
        }).max().unwrap_or(q(0));
        if &delta + tolerance/(q(4)*radius) < period.1 {
            return fail("import/pcurve-circular-trim-coverage-unproved");
        }
        // Decimal period observations can fall just below exact 2*pi. Expand
        // the chart hull by the proved deficit rather than silently snapping.
        let deficit = (period.1-delta).max(q(0));
        for span in spans { span.chart_error_mm += &deficit; }
        return Ok(());
    }
    // Analytic LINE chart domains were inverted from the retained vertices
    // and source direction by chart_edge, not taken from producer parameters.
    if matches!(pc.curve, Curve::Line {..}) { return Ok(()); }
    let a = &vertices[&edge.vertices[0]]; let b = &vertices[&edge.vertices[1]];
    let chord = sub(b,a);
    // If the complementary cap fits inside the source uncertainty strip,
    // its chord side cannot establish which arc was retained. A lower bound
    // on cap sagitta is chord^2/(8*radius); retain margin for endpoint error.
    if dot(&chord,&chord) <= q(16)*radius*tolerance + q(16)*tolerance*tolerance {
        return fail("import/pcurve-circular-trim-coverage-undecidable");
    }
    let normal = cross(&axis.axis,&chord);
    let length = Interval::sqrt(&dot(&normal,&normal))?;
    if length.0 <= q(0) { return fail("import/pcurve-circular-trim-coverage-undecidable"); }
    let lifted = lift_spans(spans.to_vec(), carrier, scale_mm, tolerance)?;
    let mut budget = 65_536;
    for span in lifted {
        let w = &span.coordinates[3];
        let residual = (0..3).fold(Poly::zero(), |sum,i| sum.add(
            &scale(&span.coordinates[i].sub(&scale(w,&a[i])),&normal[i])));
        let residual = if edge.same_sense { residual } else { scale(&residual,&q(-1)) };
        let allowance = tolerance - &span.chart_error_mm;
        if allowance < q(0) { return fail("import/semantic-chart-proof-budget"); }
        nonpositive(&residual.sub(&scale(w,&(allowance* &length.0))), &mut budget, 0)
            .map_err(|e| if e.name == "import/curve-off-surface" {
                Error::new("import/pcurve-circular-trim-mismatch")
            } else { e })?;
    }
    Ok(())
}

pub(super) fn circle_edge_spans(
    edge: &Edge,
    vertices: &BTreeMap<u32, Point>,
    tolerance: &Q,
) -> Result<Vec<HomogeneousSpan>> {
    // Prove a retained arc in its source curve direction. Reversing topology
    // then changes only traversal, not the Taylor centre or enclosure slack.
    if !edge.same_sense {
        let mut canonical = edge.clone();
        canonical.vertices.swap(0,1);
        canonical.same_sense = true;
        let mut spans = circle_edge_spans(&canonical, vertices, tolerance)?;
        let sum = &spans[0].a + &spans.last().unwrap().b;
        spans.reverse();
        for span in &mut spans {
            let a = &sum - &span.b;
            let b = &sum - &span.a;
            span.a = a; span.b = b;
            span.coordinates = span.coordinates.iter().map(|p| restrict(p,&q(1),&q(0))).collect();
        }
        return Ok(spans);
    }
    let Curve::Circle {
        axis,
        radius,
        dimension: 3,
    } = &edge.curve
    else {
        return fail("import/circle-3d-required");
    };
    if let Some(spans) = rational_circle_trim(axis, radius, edge, vertices)? {
        return Ok(spans);
    }
    let pc = Pcurve {
        id: 0,
        surface: 0,
        curve: Curve::Line {
            origin: vec![q(0), q(0)],
            direction: vec![q(1), q(0)],
        },
    };
    lift_edge(
        &pc,
        &Carrier::Cylinder(axis.clone(), radius.clone()),
        &q(1),
        tolerance,
        edge,
        vertices,
    )
}

/// When semantic normalization and source endpoints are rational and exact,
/// keep a trimmed circle as exact rational stereographic charts. No angle
/// inversion, Taylor error or tolerance is needed. Otherwise the existing
/// certified transcendental route retains the producer's source allowance.
fn rational_circle_trim(
    axis: &Axis,
    radius: &Q,
    edge: &Edge,
    vertices: &BTreeMap<u32, Point>,
) -> Result<Option<Vec<HomogeneousSpan>>> {
    if radius <= &q(0) {
        return fail("import/radius-invalid");
    }
    axis.semantic_columns()?;
    let frame = match axis.rational_frame() {
        Ok(f) => f,
        Err(e) if e.name == "import/placement-algebraic-frame-unavailable" => return Ok(None),
        Err(e) => return Err(e),
    };
    let columns = frame.columns();
    let local = |id: u32| -> Result<Option<[Q; 2]>> {
        let p = vertices
            .get(&id)
            .ok_or_else(|| Error::new("import/vertex-unaccounted"))?;
        let d = sub(p, &axis.origin);
        let xyz: [Q; 3] = std::array::from_fn(|i| dot(&d, &columns[i]));
        if !xyz[2].is_zero() || &xyz[0] * &xyz[0] + &xyz[1] * &xyz[1] != radius * radius {
            return Ok(None);
        }
        Ok(Some([xyz[0].clone(), xyz[1].clone()]))
    };
    let (Some(a), Some(b)) = (local(edge.vertices[0])?, local(edge.vertices[1])?) else {
        return Ok(None);
    };
    if a == b && edge.vertices[0] != edge.vertices[1] {
        return Ok(None);
    }
    let chart = |p: &[Q; 2]| -> (usize, Q) {
        let (x, y) = (&p[0], &p[1]);
        let (k, xx, yy) = if x > &q(0) && y >= &q(0) {
            (0, x.clone(), y.clone())
        } else if y > &q(0) && x <= &q(0) {
            (1, y.clone(), -x)
        } else if x < &q(0) && y <= &q(0) {
            (2, -x, -y)
        } else {
            (3, -y, x.clone())
        };
        (k, yy / (radius + xx))
    };
    let (start, end) = if edge.same_sense { (&a, &b) } else { (&b, &a) };
    let (first, t0) = chart(start);
    let (last, t1) = chart(end);
    let count = if first == last && t1 > t0 {
        0
    } else {
        (last + 4 - first) % 4 + usize::from(first == last) * 4
    };
    let mut result = Vec::new();
    for step in 0..=count {
        let k = (first + step) % 4;
        let lo = if step == 0 { t0.clone() } else { q(0) };
        let hi = if step == count { t1.clone() } else { q(1) };
        if lo == hi {
            continue;
        }
        let c = poly(vec![q(1), q(0), q(-1)]);
        let s = poly(vec![q(0), q(2)]);
        let w = poly(vec![q(1), q(0), q(1)]);
        let (x, y) = match k {
            0 => (c, s),
            1 => (scale(&s, &q(-1)), c),
            2 => (scale(&c, &q(-1)), scale(&s, &q(-1))),
            _ => (s, scale(&c, &q(-1))),
        };
        let coords = (0..3)
            .map(|i| {
                scale(&w, &axis.origin[i])
                    .add(&scale(&x, &(&columns[0][i] * radius)))
                    .add(&scale(&y, &(&columns[1][i] * radius)))
            })
            .chain(std::iter::once(w.clone()))
            .map(|p| restrict(&p, &lo, &hi))
            .collect();
        result.push(HomogeneousSpan {
            a: q(0),
            b: q(1),
            coordinates: coords,
            chart_error_mm: q(0),
        });
    }
    if !edge.same_sense {
        result.reverse();
        for span in &mut result {
            span.coordinates = span
                .coordinates
                .iter()
                .map(|p| restrict(p, &q(1), &q(0)))
                .collect();
        }
    }
    for (i, span) in result.iter_mut().enumerate() {
        span.a = q(i as i64);
        span.b = q(i as i64 + 1);
    }
    Ok(Some(result))
}
/// Enclose an analytic carrier sample without replacing the retained carrier.
/// The explicit budget controls proof precision; it is not source uncertainty.
pub(super) fn carrier_point(
    carrier: &Carrier,
    scale_mm: &Q,
    uv: &[Q; 2],
    budget_mm: &Q,
) -> Result<[CoordinateBound; 3]> {
    if budget_mm <= &q(0) {
        return fail("import/enclosure-budget-required");
    }
    if let Carrier::Plane(axis) = carrier {
        let (frame, error) = axis.enclosed_frame()?;
        let local = [&uv[0] * scale_mm, &uv[1] * scale_mm, q(0)];
        let error = error * local.iter().map(Q::abs).max().unwrap();
        if &error >= budget_mm {
            return fail("import/carrier-point-proof-budget");
        }
        let point = frame.point(&local);
        return Ok(point.map(|v| CoordinateBound {
            lower_mm: &v - &error,
            upper_mm: v + &error,
        }));
    }
    let span = HomogeneousSpan {
        a: q(0),
        b: q(1),
        coordinates: vec![constant(&uv[0]), constant(&uv[1]), Poly::one()],
        chart_error_mm: q(0),
    };
    let lifted = if let Carrier::Spline(_, surface) = carrier {
        let mut patches = super::spline_lift::lift(vec![span], surface)?;
        if patches.len() != 1 { return fail("import/carrier-point-spline-domain-undecidable"); }
        patches.remove(0)
    } else { lift_span(&span, carrier, scale_mm, budget_mm)? };
    if &lifted.chart_error_mm >= budget_mm {
        return fail("import/carrier-point-proof-budget");
    }
    let w = lifted.coordinates[3].evaluate(&q(0)).unwrap();
    Ok(std::array::from_fn(|i| {
        let value = lifted.coordinates[i].evaluate(&q(0)).unwrap() / &w;
        CoordinateBound {
            lower_mm: &value - &lifted.chart_error_mm,
            upper_mm: value + &lifted.chart_error_mm,
        }
    }))
}

// A bounded per-measurement cache of unchanged exact scalar enclosures.
// Profiling the occupied-face search found repeated scalar Taylor/gcd work.
#[derive(Default)]
pub(super) struct TrigCache(std::cell::RefCell<BTreeMap<(Q, bool), Interval>>);
impl TrigCache {
    fn get(&self, x: &Q, sine: bool) -> Result<Interval> {
        let key = (x.clone(), sine);
        if let Some(v) = self.0.borrow().get(&key) {
            return Ok(v.clone());
        }
        let value = scalar_trig(x, sine)?;
        let centre = value.centre.n.evaluate(&q(0)).unwrap();
        let enclosure = Interval(
            (&centre - &value.error).max(q(-1)),
            (centre + value.error).min(q(1)),
        );
        let mut cache = self.0.borrow_mut();
        if cache.len() >= 4096 {
            cache.clear();
        }
        cache.insert(key, enclosure.clone());
        Ok(enclosure)
    }
}

/// Whole two-dimensional carrier chart enclosure. Endpoint and analytic
/// critical-angle enclosures retain every value in the trim rectangle. Analytic
/// carriers remain analytic; these boxes are proof objects, not replacement
/// geometry. Normalization and later rigid placements stay outward enclosed.
pub(super) fn carrier_box(
    carrier: &Carrier,
    scale_mm: &Q,
    cell: &[[Q; 2]; 2],
    cache: &TrigCache,
) -> Result<[CoordinateBound; 3]> {
    if scale_mm <= &q(0) || (0..2).any(|i| cell[0][i] > cell[1][i]) {
        return fail("import/carrier-chart-box-invalid");
    }
    if let Carrier::Spline(_, spline) = carrier { return spline.trimmed_hull(cell); }
    match carrier {
        Carrier::Cylinder(_, r) | Carrier::Sphere(_, r) if r <= &q(0) => {
            return fail("import/radius-invalid")
        }
        Carrier::Cone(_, r, _) if r < &q(0) => return fail("import/radius-invalid"),
        Carrier::Torus(_, major, minor) if minor <= &q(0) || major <= minor => {
            return fail("import/torus-domain-unsupported")
        }
        _ => {}
    }
    let uv: [Interval; 2] =
        std::array::from_fn(|i| Interval(cell[0][i].clone(), cell[1][i].clone()));
    let tr = |a: &Interval, sine: bool| -> Result<Interval> {
        let lo = cache.get(&a.0, sine)?;
        let hi = cache.get(&a.1, sine)?;
        let mut result = Interval(lo.0.min(hi.0), lo.1.max(hi.1));
        // Analytic extrema, restricted to the retained trim's parameter box.
        // Endpoint evaluations and critical-angle separation are outward
        // rational enclosures; an undecidable separation retains the extremum.
        // scalar_trig's named |angle| <= 16 proof budget bounds this census.
        let pi = pi_bounds();
        for k in -6..=6 {
            let coefficient = if sine { q(k) + q(1)/q(2) } else { q(k) };
            let (l,h) = if coefficient < q(0) { (&coefficient*&pi.1,&coefficient*&pi.0) }
                        else { (&coefficient*&pi.0,&coefficient*&pi.1) };
            if l <= a.1 && h >= a.0 {
                if k % 2 == 0 { result.1 = q(1); } else { result.0 = q(-1); }
            }
        }
        Ok(result)
    };
    let local = if matches!(carrier, Carrier::Plane(_)) {
        [
            uv[0].mul(&Interval::point(scale_mm.clone())),
            uv[1].mul(&Interval::point(scale_mm.clone())),
            Interval::point(q(0)),
        ]
    } else {
        let cu = tr(&uv[0], false)?;
        let su = tr(&uv[0], true)?;
        match carrier {
            Carrier::Cylinder(_, radius) => [
                cu.mul(&Interval::point(radius.clone())),
                su.mul(&Interval::point(radius.clone())),
                uv[1].mul(&Interval::point(scale_mm.clone())),
            ],
            Carrier::Cone(_, radius, angle) => {
                check_cone_angle(angle)?;
                let slant = uv[1].mul(&Interval::point(scale_mm.clone()));
                let radial = interval_sum(
                    &Interval::point(radius.clone()),
                    &slant.mul(&tr(&Interval::point(angle.clone()), true)?),
                );
                [
                    radial.mul(&cu),
                    radial.mul(&su),
                    slant.mul(&tr(&Interval::point(angle.clone()), false)?),
                ]
            }
            Carrier::Sphere(_, radius) => {
                let r = Interval::point(radius.clone());
                let cv = tr(&uv[1], false)?;
                let sv = tr(&uv[1], true)?;
                [r.mul(&cv).mul(&cu), r.mul(&cv).mul(&su), r.mul(&sv)]
            }
            Carrier::Torus(_, major, minor) => {
                let r = Interval::point(minor.clone());
                let radial =
                    interval_sum(&Interval::point(major.clone()), &r.mul(&tr(&uv[1], false)?));
                [radial.mul(&cu), radial.mul(&su), r.mul(&tr(&uv[1], true)?)]
            }
            Carrier::Spline(..) => return fail("import/surface-spline-chart-inversion-unavailable"),
            Carrier::Plane(_) => unreachable!(),
        }
    };
    let columns = carrier.axis().semantic_columns()?;
    Ok(std::array::from_fn(|i| {
        let value = (0..3).fold(Interval::point(carrier.axis().origin[i].clone()), |a, j| {
            interval_sum(&a, &columns[j][i].mul(&local[j]))
        });
        CoordinateBound {
            lower_mm: value.0,
            upper_mm: value.1,
        }
    }))
}
fn interval_square(a: &Interval) -> Interval {
    let lo = if a.0 <= q(0) && a.1 >= q(0) {
        q(0)
    } else {
        (&a.0 * &a.0).min(&a.1 * &a.1)
    };
    Interval(lo, (&a.0 * &a.0).max(&a.1 * &a.1))
}
fn interval_sqrt(a: &Interval) -> Result<Interval> {
    Ok(Interval(Interval::sqrt(&a.0)?.0, Interval::sqrt(&a.1)?.1))
}
fn principal_angle(x: &Interval, y: &Interval) -> Result<Interval> {
    if x.0 <= q(0) && x.1 >= q(0) && y.1 < q(0) {
        return fail("import/carrier-chart-seam-crossing");
    }
    angular_coordinate(x, y)
}
/// Bounded analytic pullback of a point enclosure. This charts the nominal
/// radial/slant projection, not a proof that the point belongs to a trimmed
/// face. Angular seams remain explicit; an unseparated pole refuses.
pub(super) fn carrier_projection(
    carrier: &Carrier,
    scale_mm: &Q,
    point: &[CoordinateBound; 3],
) -> Result<[ParameterBound; 2]> {
    if scale_mm <= &q(0) {
        return fail("import/unit-invalid");
    }
    if point.iter().any(|p| p.lower_mm > p.upper_mm) {
        return fail("import/coordinate-bounds-invalid");
    }
    let columns = carrier.axis().semantic_columns()?;
    let d = std::array::from_fn::<_, 3, _>(|i| {
        Interval(point[i].lower_mm.clone(), point[i].upper_mm.clone())
            .sub(&Interval::point(carrier.axis().origin[i].clone()))
    });
    let local = std::array::from_fn::<_, 3, _>(|j| {
        (0..3).fold(Interval::point(q(0)), |sum, i| {
            interval_sum(&sum, &columns[j][i].mul(&d[i]))
        })
    });
    let scale = Interval::point(scale_mm.clone());
    let parameters = if matches!(carrier, Carrier::Plane(_)) {
        [local[0].div(&scale)?, local[1].div(&scale)?]
    } else {
        let u = principal_angle(&local[0], &local[1])?;
        let v = match carrier {
            Carrier::Cylinder(_, _) => local[2].div(&scale)?,
            Carrier::Cone(_, _, angle) => {
                let c = scalar_trig(angle, false)?;
                let value = c.centre.n.evaluate(&q(0)).unwrap();
                local[2].div(&Interval(&value - &c.error, &value + &c.error).mul(&scale))?
            }
            Carrier::Sphere(_, _) | Carrier::Torus(_, _, _) => {
                let mut radial = interval_sqrt(&interval_sum(
                    &interval_square(&local[0]),
                    &interval_square(&local[1]),
                ))?;
                if let Carrier::Torus(_, major, _) = carrier {
                    radial = radial.sub(&Interval::point(major.clone()));
                }
                principal_angle(&radial, &local[2])?
            }
            Carrier::Spline(..) => return fail("import/surface-spline-chart-inversion-unavailable"),
            Carrier::Plane(_) => unreachable!(),
        };
        [u, v]
    };
    Ok(parameters.map(|v| ParameterBound {
        lower: v.0,
        upper: v.1,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn axis() -> Axis {
        Axis {
            origin: [q(0), q(0), q(0)],
            axis: [q(0), q(0), q(1)],
            reference: [q(1), q(0), q(0)],
        }
    }
    fn pc(points: Vec<Vec<Q>>) -> Pcurve {
        Pcurve {
            id: 1,
            surface: 2,
            curve: Curve::Spline {
                degree: 1,
                points,
                weights: vec![q(1), q(2)],
                knots: vec![q(0), q(0), q(1), q(1)],
            },
        }
    }
    fn circle(a: Axis, r: Q) -> Curve {
        Curve::Circle {
            axis: a,
            radius: r,
            dimension: 3,
        }
    }
    fn allowance() -> Q {
        q(1) / q(1_000_000)
    }

    #[test]
    fn spline_carrier_point_is_the_exact_tensor_product_not_a_control_hull() {
        let surface=SplineSurface{degrees:[1,1],knots:[vec![q(0),q(0),q(1),q(1)],vec![q(0),q(0),q(1),q(1)]],
            points:vec![vec![[q(0),q(0),q(0)],[q(0),q(1),q(0)]],vec![[q(1),q(0),q(0)],[q(1),q(1),q(1)]]],weights:vec![vec![q(1),q(1)],vec![q(1),q(1)]]};
        let c=Carrier::Spline(axis(),surface);
        let bounds=carrier_point(&c,&q(1),&[q(1)/q(4),q(3)/q(4)],&allowance()).unwrap();
        let expected=[q(1)/q(4),q(3)/q(4),q(3)/q(16)];
        for i in 0..3 {assert_eq!(bounds[i].lower_mm,expected[i]);assert_eq!(bounds[i].upper_mm,expected[i]);}
    }

    #[test]
    fn every_analytic_carrier_has_a_bounded_forward_and_inverse_chart() {
        for carrier in [
            Carrier::Plane(axis()),
            Carrier::Cylinder(axis(), q(2)),
            Carrier::Cone(axis(), q(2), q(1) / q(2)),
            Carrier::Sphere(axis(), q(2)),
            Carrier::Torus(axis(), q(3), q(1)),
        ] {
            let uv = [q(1) / q(5), q(1) / q(3)];
            let point = carrier_point(&carrier, &q(2), &uv, &allowance()).unwrap();
            let parameters = carrier_projection(&carrier, &q(2), &point).unwrap();
            for i in 0..2 {
                assert!(
                    parameters[i].lower <= uv[i] && parameters[i].upper >= uv[i],
                    "{carrier:?} coordinate {i}"
                );
                assert!(&parameters[i].upper - &parameters[i].lower < allowance() / q(1_000));
            }
            assert!(point
                .iter()
                .all(|b| b.lower_mm <= b.upper_mm && &b.upper_mm - &b.lower_mm < allowance()));
        }
    }
    #[test]
    fn principal_projection_never_discards_a_periodic_alias_across_a_seam() {
        let box_point = |x: (Q, Q), y: (Q, Q), z: (Q, Q)| {
            [
                CoordinateBound {
                    lower_mm: x.0,
                    upper_mm: x.1,
                },
                CoordinateBound {
                    lower_mm: y.0,
                    upper_mm: y.1,
                },
                CoordinateBound {
                    lower_mm: z.0,
                    upper_mm: z.1,
                },
            ]
        };
        let crossing_u = box_point((q(-1), q(1)), (q(-10), q(-10)), (q(0), q(0)));
        assert_eq!(
            carrier_projection(&Carrier::Cylinder(axis(), q(10)), &q(1), &crossing_u)
                .unwrap_err()
                .name,
            "import/carrier-chart-seam-crossing"
        );
        let crossing_v = box_point((q(2), q(4)), (q(0), q(0)), (q(-1), q(-1)));
        assert_eq!(
            carrier_projection(&Carrier::Torus(axis(), q(3), q(1)), &q(1), &crossing_v)
                .unwrap_err()
                .name,
            "import/carrier-chart-seam-crossing"
        );
        let negative_x = box_point((q(-1), q(-1)), (q(-10), q(-10)), (q(0), q(0)));
        let positive_x = box_point((q(1), q(1)), (q(-10), q(-10)), (q(0), q(0)));
        let negative =
            carrier_projection(&Carrier::Cylinder(axis(), q(10)), &q(1), &negative_x).unwrap();
        let positive =
            carrier_projection(&Carrier::Cylinder(axis(), q(10)), &q(1), &positive_x).unwrap();
        assert!(negative[0].lower > q(4));
        assert!(positive[0].upper < q(-1));
    }
    #[test]
    fn chart_projection_refuses_invalid_boxes_and_nonunique_angular_poles() {
        let at_axis = [
            CoordinateBound {
                lower_mm: q(0),
                upper_mm: q(0),
            },
            CoordinateBound {
                lower_mm: q(0),
                upper_mm: q(0),
            },
            CoordinateBound {
                lower_mm: q(2),
                upper_mm: q(2),
            },
        ];
        assert_eq!(
            carrier_projection(&Carrier::Sphere(axis(), q(2)), &q(1), &at_axis)
                .unwrap_err()
                .name,
            "import/pcurve-angular-inversion-undecidable"
        );
        let mut invalid = at_axis.clone();
        invalid[0].lower_mm = q(1);
        assert_eq!(
            carrier_projection(&Carrier::Plane(axis()), &q(1), &invalid)
                .unwrap_err()
                .name,
            "import/coordinate-bounds-invalid"
        );
        assert_eq!(
            carrier_point(
                &Carrier::Cylinder(axis(), q(2)),
                &q(1),
                &[q(0), q(0)],
                &q(0)
            )
            .unwrap_err()
            .name,
            "import/enclosure-budget-required"
        );
    }
    #[test]
    fn scalar_trig_enclosures_respect_independent_alternating_bounds_and_symmetry() {
        for sine in [true, false] {
            let x = q(1) / q(2);
            // Independent alternating-series bounds: successive partial sums
            // bracket the value because magnitudes decrease for |x| < 1.
            let mut term = if sine { x.clone() } else { q(1) };
            let mut sum = q(0);
            let mut bounds = [q(0), q(0)];
            for k in 0..10 {
                sum += &term;
                if k >= 8 {
                    bounds[k - 8] = sum.clone();
                }
                let n = if sine { 2 * k + 2 } else { 2 * k + 1 };
                term = -term * &x * &x / q((n * (n + 1)) as i64);
            }
            let lower = bounds[0].clone().min(bounds[1].clone());
            let upper = bounds[0].clone().max(bounds[1].clone());
            let value = scalar_trig(&x, sine).unwrap();
            let (centre, _) = value.centre.enclosure(&Poly::one()).unwrap();
            assert!(&centre - &value.error >= lower);
            assert!(&centre + &value.error <= upper);
            let reflected = scalar_trig(&(-x), sine).unwrap();
            let (other, _) = reflected.centre.enclosure(&Poly::one()).unwrap();
            assert_eq!(other, if sine { -centre } else { centre });
            assert_eq!(reflected.error, value.error);
        }
    }

    #[test]
    fn rational_angular_pcurves_certify_on_every_curved_carrier() {
        let p = pc(vec![vec![q(0), q(0)], vec![q(1) / q(4), q(0)]]);
        for (carrier, radius) in [
            (Carrier::Cylinder(axis(), q(2)), q(2)),
            (Carrier::Sphere(axis(), q(2)), q(2)),
            (Carrier::Cone(axis(), q(2), q(1) / q(2)), q(2)),
            (Carrier::Torus(axis(), q(3), q(1)), q(4)),
        ] {
            let lifted = lift(&p, &carrier, &q(1), &allowance()).unwrap();
            assert!(lifted
                .iter()
                .all(|s| s.chart_error_mm > q(0) && s.chart_error_mm < allowance() / q(4)));
            certify_correspondence(&circle(axis(), radius), &lifted, &allowance()).unwrap();
        }
    }
    #[test]
    fn small_high_degree_parameter_span_uses_a_proved_lower_order() {
        let mut points = vec![vec![q(0), q(0)]; 8];
        points[7][0] = q(1) / q(1000);
        let p = Pcurve {
            id: 1,
            surface: 2,
            curve: Curve::Spline {
                degree: 7,
                points,
                weights: vec![q(1); 8],
                knots: [vec![q(0); 8], vec![q(1); 8]].concat(),
            },
        };
        let source_spans = p.curve.homogeneous_spans().unwrap();
        assert_eq!(source_spans[0].coordinates[0].degree(), Some(7));
        let lifted = lift(&p, &Carrier::Cylinder(axis(), q(2)), &q(1), &allowance()).unwrap();
        assert!(lifted
            .iter()
            .all(|s| s.coordinates.iter().all(|p| p.degree().unwrap_or(0) <= 21)));
        assert!(lifted
            .iter()
            .all(|s| s.chart_error_mm > q(0) && s.chart_error_mm < allowance() / q(4)));
        certify_correspondence(&circle(axis(), q(2)), &lifted, &allowance()).unwrap();
    }
    #[test]
    fn axial_lines_use_finite_source_endpoints_and_reject_a_wrong_meridian() {
        let mut pc = Pcurve {
            id: 1,
            surface: 2,
            curve: Curve::Line {
                origin: vec![q(0), q(99)],
                direction: vec![q(0), q(-3)],
            },
        };
        let edge = Edge {
            id: 3,
            vertices: [7, 8],
            same_sense: false,
            curve: Curve::Line {
                origin: vec![q(2), q(0), q(0)],
                direction: vec![q(0), q(0), q(-1)],
            },
            pcurves: vec![],
        };
        let vertices = BTreeMap::from([(7, [q(2), q(0), q(-4)]), (8, [q(2), q(0), q(5)])]);
        let carrier = Carrier::Cylinder(axis(), q(2));
        let spans = lift_edge(&pc, &carrier, &q(1), &allowance(), &edge, &vertices).unwrap();
        assert_eq!(spans[0].coordinates[2].evaluate(&q(0)).unwrap(), q(-4));
        assert_eq!(
            spans.last().unwrap().coordinates[2]
                .evaluate(&q(1))
                .unwrap(),
            q(5)
        );
        certify_correspondence(&edge.curve, &spans, &allowance()).unwrap();
        if let Curve::Line { origin, .. } = &mut pc.curve {
            origin[0] = q(1);
        }
        assert_eq!(
            lift_edge(&pc, &carrier, &q(1), &allowance(), &edge, &vertices)
                .unwrap_err()
                .name,
            "import/pcurve-trim-endpoint-mismatch"
        );
    }
    #[test]
    fn broader_axial_spline_domain_is_trimmed_without_increasing_uncertainty() {
        let edge=Edge {id:3,vertices:[7,8],same_sense:false,
            curve:Curve::Line {origin:vec![q(2),q(0),q(0)],direction:vec![q(0),q(0),q(-1)]},pcurves:vec![]};
        let vertices=BTreeMap::from([(7,[q(2),q(0),q(-4)]),(8,[q(2),q(0),q(5)])]);
        let mut pc=Pcurve {id:1,surface:2,curve:Curve::Spline {degree:1,
            points:vec![vec![q(0),q(6)],vec![q(0),q(-5)]],weights:vec![q(1);2],knots:vec![q(0),q(0),q(1),q(1)]}};
        let carrier=Carrier::Cylinder(axis(),q(2));
        check_chart_endpoints(&pc,&carrier,&q(1),&allowance(),&edge,&vertices).unwrap();
        let spans=chart_edge(&pc,&carrier,&q(1),&allowance(),&edge,&vertices).unwrap();
        assert_eq!(spans[0].coordinates[1].evaluate(&q(0)).unwrap(),q(5));
        assert_eq!(spans[0].coordinates[1].evaluate(&q(1)).unwrap(),q(-4));
        if let Curve::Spline {points,..}=&mut pc.curve {points[0][1]=q(4);}
        assert_eq!(check_chart_endpoints(&pc,&carrier,&q(1),&allowance(),&edge,&vertices).unwrap_err().name,
            "import/pcurve-trim-endpoint-mismatch");
    }
    #[test]
    fn axial_pcurve_projection_preserves_rational_spline_parameters_and_same_sense() {
        let pc = Pcurve {
            id: 1,
            surface: 2,
            curve: Curve::Line {
                origin: vec![q(0), q(99)],
                direction: vec![q(0), q(7)],
            },
        };
        let mut source = Curve::Spline {
            degree: 2,
            points: vec![
                vec![q(2), q(0), q(-4)],
                vec![q(2), q(0), q(3)],
                vec![q(2), q(0), q(5)],
            ],
            weights: vec![q(1), q(2), q(1)],
            knots: vec![q(0), q(0), q(0), q(1), q(1), q(1)],
        };
        let vertices = BTreeMap::from([(7, [q(2), q(0), q(-4)]), (8, [q(2), q(0), q(5)])]);
        for sense in [true, false] {
            let edge = Edge {
                id: 3,
                vertices: if sense { [7, 8] } else { [8, 7] },
                same_sense: sense,
                curve: source.clone(),
                pcurves: vec![pc.clone()],
            };
            let spans = lift_edge(
                &pc,
                &Carrier::Cylinder(axis(), q(2)),
                &q(1),
                &allowance(),
                &edge,
                &vertices,
            )
            .unwrap();
            certify_correspondence(&source, &spans, &allowance()).unwrap();
            let mid = q(1) / q(2);
            let s = &spans[0];
            assert_eq!(
                s.coordinates[2].evaluate(&mid).unwrap() / s.coordinates[3].evaluate(&mid).unwrap(),
                q(13) / q(6)
            );
            assert_ne!(
                s.coordinates[2].evaluate(&mid).unwrap() / s.coordinates[3].evaluate(&mid).unwrap(),
                q(1) / q(2)
            );
        }
        if let Curve::Spline { points, .. } = &mut source {
            points[1][0] = q(3);
        }
        let edge = Edge {
            id: 3,
            vertices: [7, 8],
            same_sense: true,
            curve: source.clone(),
            pcurves: vec![],
        };
        let spans = lift_edge(
            &pc,
            &Carrier::Cylinder(axis(), q(2)),
            &q(1),
            &allowance(),
            &edge,
            &vertices,
        )
        .unwrap();
        assert_eq!(
            certify_correspondence(&source, &spans, &allowance())
                .unwrap_err()
                .name,
            "import/pcurve-lift-mismatch"
        );
    }
    #[test]
    fn open_angular_line_selects_the_source_short_or_long_arc() {
        let pc = Pcurve {
            id: 1,
            surface: 2,
            curve: Curve::Line {
                origin: vec![q(99), q(3)],
                direction: vec![q(-7), q(0)],
            },
        };
        let vertices = BTreeMap::from([(7, [q(2), q(0), q(3)]), (8, [q(0), q(2), q(3)])]);
        for sense in [true, false] {
            let edge = Edge {
                id: 3,
                vertices: [7, 8],
                same_sense: sense,
                curve: circle(
                    Axis {
                        origin: [q(0), q(0), q(3)],
                        ..axis()
                    },
                    q(2),
                ),
                pcurves: vec![],
            };
            let spans = lift_edge(
                &pc,
                &Carrier::Cylinder(axis(), q(2)),
                &q(1),
                &allowance(),
                &edge,
                &vertices,
            )
            .unwrap();
            check_trim_endpoints(&spans, [&vertices[&7], &vertices[&8]], &allowance()).unwrap();
            certify_correspondence(&edge.curve, &spans, &allowance()).unwrap();
            let at = q(1) / q(2);
            let span = spans.iter().find(|s| s.a <= at && at <= s.b).unwrap();
            let t = (&at - &span.a) / (&span.b - &span.a);
            for i in 0..2 {
                let v = span.coordinates[i].evaluate(&t).unwrap()
                    / span.coordinates[3].evaluate(&t).unwrap();
                if sense {
                    assert!(v - &span.chart_error_mm > q(1));
                } else {
                    assert!(v + &span.chart_error_mm < q(-1));
                }
            }
        }
    }
    #[test]
    fn angular_inversion_proves_quadrants_and_refuses_an_unseparated_pole() {
        let pi = pi_bounds();
        let zero = Interval::point(q(0));
        let one = Interval::point(q(1));
        let minus = Interval::point(q(-1));
        for (x, y, lo, hi) in [
            (&one, &one, &pi.0 / q(4), &pi.1 / q(4)),
            (&minus, &one, q(3) * &pi.0 / q(4), q(3) * &pi.1 / q(4)),
            (&minus, &minus, q(5) * &pi.0 / q(4), q(5) * &pi.1 / q(4)),
            (&zero, &minus, -&pi.1 / q(2), -&pi.0 / q(2)),
        ] {
            let angle = angular_coordinate(x, y).unwrap();
            assert!(angle.0 <= lo && angle.1 >= hi);
            assert!(angle.radius() < allowance() / q(1_000_000));
        }
        assert_eq!(
            angular_coordinate(&Interval(q(-1), q(1)), &zero)
                .unwrap_err()
                .name,
            "import/pcurve-angular-inversion-undecidable"
        );
    }
    #[test]
    fn period_enclosure_has_a_bounded_dyadic_width() {
        let p = pi_bounds();
        assert!(p.0 > q(3) && p.1 < q(22) / q(7));
        assert!(p.1 - p.0 < Q::new(1.into(), wonky_alg::BigInt::from(1) << 98_usize));
    }
    #[test]
    fn closed_angular_line_has_one_certified_period_and_edge_direction() {
        let pc = Pcurve {
            id: 1,
            surface: 2,
            curve: Curve::Line {
                origin: vec![q(0), q(3)],
                direction: vec![q(1), q(0)],
            },
        };
        let vertices = BTreeMap::from([(7, [q(2), q(0), q(3)])]);
        let carrier = Carrier::Cylinder(axis(), q(2));
        for sense in [true, false] {
            let edge = Edge {
                id: 3,
                vertices: [7, 7],
                same_sense: sense,
                curve: circle(
                    Axis {
                        origin: [q(0), q(0), q(3)],
                        ..axis()
                    },
                    q(2),
                ),
                pcurves: vec![pc.clone()],
            };
            let spans = lift_edge(&pc, &carrier, &q(1), &allowance(), &edge, &vertices).unwrap();
            assert_eq!(spans.first().unwrap().a, q(0));
            assert_eq!(spans.last().unwrap().b, q(1));
            assert!(spans.windows(2).all(|s| s[0].b == s[1].a));
            certify_correspondence(&edge.curve, &spans, &allowance()).unwrap();
            let at = q(1) / q(4);
            let span = spans.iter().find(|s| s.a <= at && at <= s.b).unwrap();
            let t = (&at - &span.a) / (&span.b - &span.a);
            let y = span.coordinates[1].evaluate(&t).unwrap()
                / span.coordinates[3].evaluate(&t).unwrap();
            if sense {
                assert!(y - &span.chart_error_mm > q(19) / q(10));
            } else {
                assert!(y + &span.chart_error_mm < q(-19) / q(10));
            }
        }
    }
    #[test]
    fn angular_lines_reject_incompatible_endpoint_elevations() {
        let pc = Pcurve {
            id: 1,
            surface: 2,
            curve: Curve::Line {
                origin: vec![q(1) / q(10), q(0)],
                direction: vec![q(1), q(0)],
            },
        };
        let vertices = BTreeMap::from([(7, [q(2), q(0), q(1)]), (8, [q(0), q(2), q(1)])]);
        let mut edge = Edge {
            id: 3,
            vertices: [7, 7],
            same_sense: true,
            curve: circle(axis(), q(2)),
            pcurves: vec![pc.clone()],
        };
        let c = Carrier::Cylinder(axis(), q(2));
        assert_eq!(
            lift_edge(&pc, &c, &q(1), &allowance(), &edge, &vertices)
                .unwrap_err()
                .name,
            "import/pcurve-trim-endpoint-mismatch"
        );
        edge.vertices[1] = 8;
        assert_eq!(
            lift_edge(&pc, &c, &q(1), &allowance(), &edge, &vertices)
                .unwrap_err()
                .name,
            "import/pcurve-trim-endpoint-mismatch"
        );
    }
    #[test]
    fn torus_meridian_keeps_its_displaced_circle_and_plane() {
        let p = pc(vec![vec![q(0), q(0)], vec![q(0), q(1) / q(4)]]);
        let lifted = lift(&p, &Carrier::Torus(axis(), q(3), q(1)), &q(1), &allowance()).unwrap();
        let meridian = Axis {
            origin: [q(3), q(0), q(0)],
            axis: [q(0), q(-1), q(0)],
            reference: [q(1), q(0), q(0)],
        };
        certify_correspondence(&circle(meridian, q(1)), &lifted, &allowance()).unwrap();
        assert_eq!(
            certify_correspondence(&circle(axis(), q(1)), &lifted, &allowance())
                .unwrap_err()
                .name,
            "import/pcurve-lift-mismatch"
        );
    }
    #[test]
    fn cone_uses_slant_distance_and_body_units_in_its_lift() {
        let p = pc(vec![
            vec![q(0), q(1) / q(2)],
            vec![q(1) / q(4), q(1) / q(2)],
        ]);
        let lifted = lift(
            &p,
            &Carrier::Cone(axis(), q(2), q(1) / q(2)),
            &q(2),
            &allowance(),
        )
        .unwrap();
        let source = circle(
            Axis {
                origin: [q(0), q(0), Q::from_float(0.5_f64.cos()).unwrap()],
                ..axis()
            },
            Q::from_float(2.0 + 0.5_f64.sin()).unwrap(),
        );
        certify_correspondence(&source, &lifted, &allowance()).unwrap();
        let wrong = circle(
            Axis {
                origin: [q(0), q(0), q(1)],
                ..axis()
            },
            q(2),
        );
        assert_eq!(
            certify_correspondence(&wrong, &lifted, &allowance())
                .unwrap_err()
                .name,
            "import/pcurve-lift-mismatch"
        );
    }
    #[test]
    fn cylinder_pcurve_returns_to_edge_at_samples_but_departs_interior() {
        let p = Pcurve {
            id: 1,
            surface: 2,
            curve: Curve::Spline {
                degree: 3,
                points: vec![
                    vec![q(0), q(0)],
                    vec![q(1) / q(12), q(1)],
                    vec![q(1) / q(6), q(-1)],
                    vec![q(1) / q(4), q(0)],
                ],
                weights: vec![q(1); 4],
                knots: vec![q(0), q(0), q(0), q(0), q(1), q(1), q(1), q(1)],
            },
        };
        let spans = p.curve.homogeneous_spans().unwrap();
        for parameter in [q(0), q(1) / q(2), q(1)] {
            assert_eq!(spans[0].coordinates[1].evaluate(&parameter).unwrap(), q(0));
        }
        let lifted = lift(&p, &Carrier::Cylinder(axis(), q(2)), &q(1), &allowance()).unwrap();
        assert_eq!(
            certify_correspondence(&circle(axis(), q(2)), &lifted, &allowance())
                .unwrap_err()
                .name,
            "import/pcurve-lift-mismatch"
        );
    }
    #[test]
    fn angular_ranges_are_subdivided_without_losing_source_domain() {
        let p = pc(vec![vec![q(0), q(0)], vec![q(1), q(0)]]);
        let lifted = lift(&p, &Carrier::Cylinder(axis(), q(2)), &q(1), &allowance()).unwrap();
        assert!(lifted.len() > 1);
        assert_eq!(lifted.first().unwrap().a, q(0));
        assert_eq!(lifted.last().unwrap().b, q(1));
        assert!(lifted.windows(2).all(|s| s[0].b == s[1].a));
        certify_correspondence(&circle(axis(), q(2)), &lifted, &allowance()).unwrap();
    }
}
