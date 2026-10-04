//! Display-only source edge polylines. Positive homogeneous Bernstein controls
//! enclose every point; capsule convexity and continuous chord projection give
//! the two-sided chord deviation. Neither samples nor this explicit display
//! approximation decide source incidence, signs, or Reference admission.
use super::*;

#[derive(Clone, Debug)]
pub struct EdgeSample {
    /// Normalized topological edge direction, from its first source vertex.
    pub parameter: Q,
    /// Source vertex observation at endpoints, otherwise the retained curve
    /// enclosure centre; before semantic item placements.
    pub source_point_mm: Point,
    /// Enclosures after every semantic item placement.
    pub world: [CoordinateBound; 3],
}
#[derive(Clone, Debug)]
pub struct EdgePolyline {
    pub source_edge: u32,
    pub closed: bool,
    /// Explicit display budget; source uncertainty remains separate on Body.
    pub deviation_mm: Q,
    pub samples: Vec<EdgeSample>,
}
fn span_point(span: &HomogeneousSpan, t: &Q) -> Result<Point> {
    let w = span.coordinates[3].evaluate(t).unwrap();
    if w <= q(0) {
        return fail("import/display-weight-unproved");
    }
    Ok(std::array::from_fn(|i| {
        span.coordinates[i].evaluate(t).unwrap() / &w
    }))
}
fn capsule_proved(span: &HomogeneousSpan, allowance: &Q) -> bool {
    if allowance <= &q(0) {
        return false;
    }
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
        return false;
    }
    let point = |k: usize| std::array::from_fn::<_, 3, _>(|i| &controls[i][k] / &controls[3][k]);
    let a = point(0);
    let b = point(degree);
    let direction = sub(&b, &a);
    let n2 = dot(&direction, &direction);
    (0..=degree).all(|k| {
        let p = point(k);
        let lambda = if n2.is_zero() {
            q(0)
        } else {
            (dot(&sub(&p, &a), &direction) / &n2).max(q(0)).min(q(1))
        };
        let closest = std::array::from_fn(|i| &a[i] + &lambda * &direction[i]);
        let d = sub(&p, &closest);
        dot(&d, &d) <= allowance * allowance
    })
}
impl Body {
    /// General display approximation of the retained 3D LINE/CIRCLE/spline.
    /// Source endpoint identity owns connectivity. The analytic curves remain
    /// stored, and this result has no conversion to the checked exact Model.
    pub fn edge_polyline(&self, id: u32, deviation_mm: &Q) -> Result<EdgePolyline> {
        let edge = self
            .edges
            .get(&id)
            .ok_or_else(|| Error::new("import/edge-unaccounted"))?;
        for vertex in edge.vertices {
            if !self.vertices.contains_key(&vertex) {
                return fail("import/vertex-unaccounted");
            }
        }
        let source_allowance = match &self.uncertainty {
            Uncertainty::Declared { mm } => mm,
            Uncertainty::Unknown => return fail("import/source-tolerance-missing"),
        };
        if deviation_mm <= &(q(8) * source_allowance) || deviation_mm <= &q(0) {
            return fail("import/display-budget-below-source-uncertainty");
        }
        let mut spans = match edge.curve {
            Curve::Circle { .. } => {
                curved_lift::circle_edge_spans(edge, &self.vertices, source_allowance)?
            }
            _ => edge.source_spans(&self.vertices, source_allowance)?,
        };
        if spans.is_empty() {
            return fail("import/display-domain-invalid");
        }
        if spans.iter().any(|s| s.coordinates.len() != 4) {
            return fail("import/dimension-unsupported");
        }
        if matches!(edge.curve, Curve::Spline { .. }) {
            for pair in spans.windows(2) {
                if pair[0].b != pair[1].a
                    || span_point(&pair[0], &q(1))? != span_point(&pair[1], &q(0))?
                {
                    return fail("import/display-curve-discontinuous");
                }
            }
        }
        let start = spans[0].a.clone();
        let end = spans.last().unwrap().b.clone();
        if end <= start {
            return fail("import/display-domain-invalid");
        }
        for span in &mut spans {
            span.a = (&span.a - &start) / (&end - &start);
            span.b = (&span.b - &start) / (&end - &start);
        }
        if matches!(edge.curve, Curve::Spline { .. }) && !edge.same_sense {
            spans.reverse();
            for span in &mut spans {
                let a = q(1) - &span.b;
                let b = q(1) - &span.a;
                span.a = a;
                span.b = b;
                span.coordinates = span
                    .coordinates
                    .iter()
                    .map(|p| restrict(p, &q(1), &q(0)))
                    .collect();
            }
        }
        let observed = [
            &self.vertices[&edge.vertices[0]],
            &self.vertices[&edge.vertices[1]],
        ];
        for (span, t, vertex) in [
            (&spans[0], q(0), observed[0]),
            (spans.last().unwrap(), q(1), observed[1]),
        ] {
            let difference = sub(&span_point(span, &t)?, vertex);
            let allowance = source_allowance - &span.chart_error_mm;
            if allowance < q(0) || dot(&difference, &difference) > &allowance * &allowance {
                return fail("import/display-source-endpoint-mismatch");
            }
        }
        let mut pending = spans.into_iter().rev().map(|s| (s, 0)).collect::<Vec<_>>();
        let mut accepted = Vec::new();
        let mut budget = 65_536usize;
        while let Some((span, depth)) = pending.pop() {
            if budget == 0 {
                return fail("import/display-subdivision-budget");
            }
            budget -= 1;
            // Reserve for source endpoint observations, chart enclosure and
            // export/placement rounding; use a stricter inner chord budget.
            let allowance = deviation_mm / q(4) - &span.chart_error_mm - source_allowance;
            if capsule_proved(&span, &allowance) {
                accepted.push(span);
            } else if depth < 24 {
                let [left, right] = curved_lift::subdivide(&span);
                pending.push((right, depth + 1));
                pending.push((left, depth + 1));
            } else {
                return fail("import/display-chord-proof-budget");
            }
        }
        let mut samples = Vec::new();
        for (index, span) in accepted.iter().enumerate() {
            if index == 0 {
                samples.push((
                    span.a.clone(),
                    span_point(span, &q(0))?,
                    span.chart_error_mm.clone(),
                ));
            }
            samples.push((
                span.b.clone(),
                span_point(span, &q(1))?,
                span.chart_error_mm.clone(),
            ));
        }
        samples.first_mut().unwrap().1 = observed[0].clone();
        samples.last_mut().unwrap().1 = observed[1].clone();
        let mut result = Vec::new();
        for (parameter, point, error) in samples {
            let mut world = self.placed_point_bounds(&point)?;
            for b in &mut world {
                b.lower_mm -= &error;
                b.upper_mm += &error;
            }
            if world
                .iter()
                .map(|b| (&b.upper_mm - &b.lower_mm) / q(2))
                .sum::<Q>()
                >= deviation_mm / q(4)
            {
                return fail("import/display-placement-proof-budget");
            }
            result.push(EdgeSample {
                parameter,
                source_point_mm: point,
                world,
            });
        }
        Ok(EdgePolyline {
            source_edge: id,
            closed: edge.vertices[0] == edge.vertices[1],
            deviation_mm: deviation_mm.clone(),
            samples: result,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn span(points: Vec<Vec<Q>>, weights: Vec<Q>) -> HomogeneousSpan {
        let degree = points.len() - 1;
        let mut knots = vec![q(0); degree + 1];
        knots.extend(vec![q(1); degree + 1]);
        Curve::Spline {
            degree,
            points,
            weights,
            knots,
        }
        .homogeneous_spans()
        .unwrap()
        .remove(0)
    }
    #[test]
    fn rational_control_capsule_bounds_the_entire_curve_not_samples() {
        let straight = span(
            vec![
                vec![q(0), q(0), q(0)],
                vec![q(1), q(0), q(0)],
                vec![q(2), q(0), q(0)],
            ],
            vec![q(1), q(2), q(1)],
        );
        assert!(capsule_proved(&straight, &(q(1) / q(1000))));
        let bowed = span(
            vec![
                vec![q(0), q(0), q(0)],
                vec![q(1), q(2), q(0)],
                vec![q(2), q(0), q(0)],
            ],
            vec![q(1), q(2), q(1)],
        );
        assert!(!capsule_proved(&bowed, &(q(1) / q(1000))));
        assert!(capsule_proved(&bowed, &q(2)));
    }
    #[test]
    fn controls_past_an_endpoint_are_not_inside_the_finite_chord_capsule() {
        let beyond = span(
            vec![
                vec![q(0), q(0), q(0)],
                vec![q(4), q(0), q(0)],
                vec![q(2), q(0), q(0)],
            ],
            vec![q(1), q(1), q(1)],
        );
        assert!(!capsule_proved(&beyond, &(q(1) / q(1000))));
        assert!(capsule_proved(&beyond, &q(2)));
    }
}
