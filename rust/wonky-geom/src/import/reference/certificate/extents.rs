//! Whole-edge extrema of retained curves, not vertex or display-mesh bounds.
//! Bernstein control hulls provide outer bounds; evaluated curve points provide
//! inner witnesses. Branches retire only when all six extrema are enclosed to
//! the requested precision. Semantic placements and chart errors are charged.
use super::*;

#[derive(Clone, Debug)]
pub struct CoordinateExtrema {
    pub minimum: CoordinateBound,
    pub maximum: CoordinateBound,
}
#[derive(Clone, Debug)]
pub struct EdgeExtents {
    pub source_edge: u32,
    pub precision_mm: Q,
    pub coordinates: [CoordinateExtrema; 3],
}

fn point_bounds(body: &Body, span: &HomogeneousSpan, t: &Q) -> Result<[CoordinateBound; 3]> {
    let w = span.coordinates[3].evaluate(t).unwrap();
    if w <= q(0) {
        return fail("import/extents-weight-unproved");
    }
    let point = std::array::from_fn(|i| span.coordinates[i].evaluate(t).unwrap() / &w);
    let mut bounds = body.placed_point_bounds(&point)?;
    // chart_error_mm is a Euclidean distance; semantic rigid placements
    // preserve it, so each world-coordinate error is at most this distance.
    for b in &mut bounds {
        b.lower_mm -= &span.chart_error_mm;
        b.upper_mm += &span.chart_error_mm;
    }
    Ok(bounds)
}
pub(super) fn hull_bounds(body: &Body, span: &HomogeneousSpan) -> Result<[CoordinateBound; 3]> {
    let degree = span
        .coordinates
        .iter()
        .filter_map(Poly::degree)
        .max()
        .unwrap_or(0);
    let controls = span
        .coordinates
        .iter()
        .map(|p| p.to_bernstein(degree).unwrap())
        .collect::<Vec<_>>();
    if controls[3].iter().any(|w| w <= &q(0)) {
        return fail("import/extents-weight-unproved");
    }
    // Transform each control point separately. Transforming a source-space
    // axis-aligned box instead would retain dependency overestimation even
    // after subdivision and needlessly lose tight rotated line extents.
    let mut result: Option<[CoordinateBound; 3]> = None;
    for k in 0..=degree {
        let p = std::array::from_fn(|i| &controls[i][k] / &controls[3][k]);
        let world = body.placed_point_bounds(&p)?;
        match &mut result {
            None => result = Some(world),
            Some(a) => {
                for i in 0..3 {
                    a[i].lower_mm = a[i].lower_mm.clone().min(world[i].lower_mm.clone());
                    a[i].upper_mm = a[i].upper_mm.clone().max(world[i].upper_mm.clone());
                }
            }
        }
    }
    let mut result = result.unwrap();
    for b in &mut result {
        b.lower_mm -= &span.chart_error_mm;
        b.upper_mm += &span.chart_error_mm;
    }
    Ok(result)
}
impl Body {
    /// Each minimum/maximum is independently enclosed with width at most
    /// precision_mm. This measures the nominal retained source edge, including
    /// finite trims, rather than asserting source accuracy or face extents.
    pub fn edge_extents(&self, id: u32, precision_mm: &Q) -> Result<EdgeExtents> {
        if precision_mm <= &q(0) {
            return fail("import/enclosure-budget-required");
        }
        let edge = self
            .edges
            .get(&id)
            .ok_or_else(|| Error::new("import/edge-unaccounted"))?;
        if edge.vertices.iter().any(|v| !self.vertices.contains_key(v)) {
            return fail("import/vertex-unaccounted");
        }
        let tolerance = match &self.uncertainty {
            Uncertainty::Declared { mm } => mm,
            Uncertainty::Unknown => return fail("import/source-tolerance-missing"),
        };
        let spans = match &edge.curve {
            Curve::Circle { .. } => {
                curved_lift::circle_edge_spans(edge, &self.vertices, tolerance)?
            }
            _ => edge.source_spans(&self.vertices, tolerance)?,
        };
        if spans.is_empty() || spans.iter().any(|s| s.coordinates.len() != 4) {
            return fail("import/extents-domain-invalid");
        }
        let reverse = matches!(edge.curve, Curve::Spline { .. }) && !edge.same_sense;
        for (span, t, index) in [
            (&spans[0], q(0), usize::from(reverse)),
            (spans.last().unwrap(), q(1), usize::from(!reverse)),
        ] {
            let w = span.coordinates[3].evaluate(&t).unwrap();
            if w <= q(0) {
                return fail("import/extents-weight-unproved");
            }
            let point = std::array::from_fn(|i| span.coordinates[i].evaluate(&t).unwrap() / &w);
            let difference = sub(&point, &self.vertices[&edge.vertices[index]]);
            let allowance = tolerance - &span.chart_error_mm;
            if allowance < q(0) || dot(&difference, &difference) > &allowance * &allowance {
                return fail("import/extents-source-endpoint-mismatch");
            }
        }
        let first = point_bounds(self, &spans[0], &q(0))?;
        let mut minima = first.clone().map(|b| b.upper_mm);
        let mut maxima = first.map(|b| b.lower_mm);
        let mut pending = spans.into_iter().map(|s| (s, 0)).collect::<Vec<_>>();
        let mut retired = Vec::<[CoordinateBound; 3]>::new();
        let mut budget = 65_536usize;
        while let Some((span, depth)) = pending.pop() {
            if budget == 0 {
                return fail("import/extents-subdivision-budget");
            }
            budget -= 1;
            for t in [q(0), q(1) / q(2), q(1)] {
                let witness = point_bounds(self, &span, &t)?;
                for i in 0..3 {
                    minima[i] = minima[i].clone().min(witness[i].upper_mm.clone());
                    maxima[i] = maxima[i].clone().max(witness[i].lower_mm.clone());
                }
            }
            let hull = hull_bounds(self, &span)?;
            if (0..3).all(|i| {
                &minima[i] - &hull[i].lower_mm <= *precision_mm
                    && &hull[i].upper_mm - &maxima[i] <= *precision_mm
            }) {
                retired.push(hull);
            } else if depth < 32 {
                let [left, right] = curved_lift::subdivide(&span);
                pending.push((right, depth + 1));
                pending.push((left, depth + 1));
            } else {
                return fail("import/extents-precision-unproved");
            }
        }
        let coordinates = std::array::from_fn(|i| CoordinateExtrema {
            minimum: CoordinateBound {
                lower_mm: retired.iter().map(|b| b[i].lower_mm.clone()).min().unwrap(),
                upper_mm: minima[i].clone(),
            },
            maximum: CoordinateBound {
                lower_mm: maxima[i].clone(),
                upper_mm: retired.iter().map(|b| b[i].upper_mm.clone()).max().unwrap(),
            },
        });
        Ok(EdgeExtents {
            source_edge: id,
            precision_mm: precision_mm.clone(),
            coordinates,
        })
    }
}
