//! Exact tensor-product composition on proved knot cells. Crossing a knot
//! consumes a subdivision budget; no sampled surface replaces the source.
use super::*;

fn basis(knots: &[Q], degree: usize, n: &Poly, w: &Poly, cell: usize) -> Vec<Poly> {
    let mut values = (0..knots.len() - 1)
        .map(|i| if i == cell { Poly::one() } else { Poly::zero() })
        .collect::<Vec<_>>();
    for d in 1..=degree {
        values = (0..values.len() - 1).map(|i| {
            let mut result = Poly::zero();
            let left = &knots[i + d] - &knots[i];
            if !left.is_zero() {
                result = scale(&n.sub(&scale(w, &knots[i])).mul(&values[i]), &(q(1) / left));
            }
            let right = &knots[i + d + 1] - &knots[i + 1];
            if !right.is_zero() {
                result = result.add(&scale(&scale(w, &knots[i + d + 1]).sub(n)
                    .mul(&values[i + 1]), &(q(1) / right)));
            }
            result
        }).collect();
    }
    values
}

pub(super) fn lift(spans: Vec<HomogeneousSpan>, surface: &SplineSurface) -> Result<Vec<HomogeneousSpan>> {
    surface.validate()?;
    let counts = [surface.points.len(), surface.points[0].len()];
    let mut pending = spans.into_iter().rev().map(|s| (s, 0)).collect::<Vec<_>>();
    let mut result = Vec::new();
    let mut budget = 4096;
    while let Some((span, depth)) = pending.pop() {
        if budget == 0 { return fail("import/pcurve-spline-knot-proof-budget"); }
        budget -= 1;
        if span.coordinates.len() != 3 { return fail("import/pcurve-dimension-invalid"); }
        if !span.chart_error_mm.is_zero() { return fail("import/pcurve-spline-chart-error-unproved"); }
        let w = &span.coordinates[2];
        let degree = span.coordinates.iter().filter_map(Poly::degree).max().unwrap_or(0);
        let controls = span.coordinates.iter().map(|p| p.to_bernstein(degree).unwrap()).collect::<Vec<_>>();
        if controls[2].iter().any(|w| w <= &q(0)) { return fail("import/pcurve-weight-unproved"); }
        let mut cells = Vec::new();
        for i in 0..2 {
            let lo = (0..=degree).map(|k| &controls[i][k] / &controls[2][k]).min().unwrap();
            let hi = (0..=degree).map(|k| &controls[i][k] / &controls[2][k]).max().unwrap();
            let knots = &surface.knots[i];
            if lo < knots[surface.degrees[i]] || hi > knots[counts[i]] {
                return fail("import/surface-spline-trim-outside-domain");
            }
            // A degree+1 internal multiplicity can disconnect the surface.
            // A closed cell's left limit is then not the knot's right-hand
            // value. Until both one-sided restrictions are proved equal,
            // touching that knot must not certify either observation.
            for knot in &knots[surface.degrees[i]+1..counts[i]] {
                if knots[surface.degrees[i]] < *knot && *knot < knots[counts[i]]
                    && lo <= *knot && *knot <= hi
                    && knots.iter().filter(|k| *k == knot).count() > surface.degrees[i]
                {
                    return fail("import/pcurve-spline-discontinuous-knot-unproved");
                }
            }
            cells.push((surface.degrees[i]..counts[i]).find(|&j|
                knots[j] < knots[j + 1] && knots[j] <= lo && hi <= knots[j + 1]));
        }
        let (Some(u), Some(v)) = (cells[0], cells[1]) else {
            if depth == 16 { return fail("import/pcurve-spline-knot-proof-budget"); }
            let [left, right] = curved_lift::subdivide(&span);
            pending.push((right, depth + 1)); pending.push((left, depth + 1));
            continue;
        };
        let ub = basis(&surface.knots[0], surface.degrees[0], &span.coordinates[0], w, u);
        let vb = basis(&surface.knots[1], surface.degrees[1], &span.coordinates[1], w, v);
        let mut coordinates = vec![Poly::zero(); 4];
        for i in 0..counts[0] {
            for j in 0..counts[1] {
                let weight = scale(&ub[i].mul(&vb[j]), &surface.weights[i][j]);
                for k in 0..3 {
                    coordinates[k] = coordinates[k].add(&scale(&weight, &surface.points[i][j][k]));
                }
                coordinates[3] = coordinates[3].add(&weight);
            }
        }
        if range(&coordinates[3]).0 <= q(0) { return fail("import/pcurve-weight-unproved"); }
        result.push(HomogeneousSpan { coordinates, ..span });
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rational_tensor_lift_preserves_weights_and_both_sides_of_a_knot() {
        let surface = SplineSurface {
            degrees: [1, 1],
            knots: [vec![q(0),q(0),q(1),q(2),q(2)], vec![q(0),q(0),q(1),q(1)]],
            points: [0,1,3].map(|x| vec![[q(x),q(0),q(0)],[q(x),q(1),q(x)]]).to_vec(),
            weights: vec![vec![q(1);2],vec![q(2);2],vec![q(1);2]],
        };
        let spans = lift(vec![HomogeneousSpan {
            a:q(0), b:q(1), coordinates:vec![poly(vec![q(0),q(2)]),poly(vec![q(0),q(1)]),Poly::one()],
            chart_error_mm:q(0),
        }], &surface).unwrap();
        assert_eq!(spans.len(),2);
        // At u=1/2 and u=3/2 the weighted x values are 2/3 and 5/3.
        // The tensor product independently interpolates y=v and z=x*v.
        for (span,x,y) in [(&spans[0],q(2)/q(3),q(1)/q(4)),(&spans[1],q(5)/q(3),q(3)/q(4))] {
            let t=q(1)/q(2);
            let w=span.coordinates[3].evaluate(&t).unwrap();
            let actual=(0..3).map(|i| span.coordinates[i].evaluate(&t).unwrap()/&w).collect::<Vec<_>>();
            assert_eq!(actual,vec![x.clone(),y.clone(),x*y]);
        }
    }
    #[test]
    fn discontinuous_surface_knot_cannot_certify_the_wrong_one_sided_value() {
        let surface=SplineSurface {
            degrees:[1,1],
            knots:[vec![q(0),q(0),q(1),q(1),q(2),q(2)],vec![q(0),q(0),q(1),q(1)]],
            points:[0,1,10,11].map(|x|vec![[q(x),q(0),q(0)],[q(x),q(1),q(0)]]).to_vec(),
            weights:vec![vec![q(1);2];4],
        };
        let span=HomogeneousSpan {a:q(0),b:q(1),
            coordinates:vec![constant(&q(1)),poly(vec![q(0),q(1)]),Poly::one()],chart_error_mm:q(0)};
        assert_eq!(lift(vec![span.clone()],&surface).unwrap_err().name,
            "import/pcurve-spline-discontinuous-knot-unproved");
        // Cells away from the disconnected knot remain exactly supported.
        let mut away=span;
        away.coordinates[0]=poly(vec![q(0),q(1)/q(2)]);
        let lifted=lift(vec![away],&surface).unwrap();
        assert_eq!(lifted[0].coordinates[0].evaluate(&(q(1)/q(2))).unwrap(),q(1)/q(4));
    }

}
