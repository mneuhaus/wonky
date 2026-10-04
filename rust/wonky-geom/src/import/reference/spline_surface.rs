//! Rational tensor-product source surfaces. Positive weights and knot domains
//! are mandatory; active basis supports give certified trimmed-patch hulls.
use super::*;
#[derive(Clone, Debug)]
pub struct SplineSurface {
    pub degrees: [usize; 2],
    pub knots: [Vec<Q>; 2],
    pub points: Vec<Vec<Point>>,
    pub weights: Vec<Vec<Q>>,
}
impl SplineSurface {
    pub fn validate(&self) -> Result<()> {
        let counts = [self.points.len(), self.points.first().map_or(0, Vec::len)];
        if self.weights.len() != counts[0]
            || counts.iter().any(|n| *n == 0)
            || self.points.iter().any(|r| r.len() != counts[1])
            || self
                .weights
                .iter()
                .any(|r| r.len() != counts[1] || r.iter().any(|w| w <= &q(0)))
        {
            return fail("import/surface-spline-control-net-invalid");
        }
        for i in 0..2 {
            let d = self.degrees[i];
            let k = &self.knots[i];
            if d == 0
                || d > wonky_curve::bspline::MAX_DEGREE
                || counts[i] <= d
                || k.len() != counts[i] + d + 1
                || k.windows(2).any(|w| w[0] > w[1])
                || k[d] >= k[counts[i]]
            {
                return fail("import/surface-spline-knots-invalid");
            }
        }
        Ok(())
    }
    pub fn trimmed_hull(&self, cell: &[[Q; 2]; 2]) -> Result<[CoordinateBound; 3]> {
        self.validate()?;
        let counts = [self.points.len(), self.points[0].len()];
        for i in 0..2 {
            if cell[0][i] < self.knots[i][self.degrees[i]]
                || cell[1][i] > self.knots[i][counts[i]]
                || cell[0][i] > cell[1][i]
            {
                return fail("import/surface-spline-trim-outside-domain");
            }
        }
        let mut points = Vec::new();
        for u in 0..counts[0] {
            for v in 0..counts[1] {
                if (0..2).all(|i| {
                    let j = if i == 0 { u } else { v };
                    self.knots[i][j] <= cell[1][i]
                        && self.knots[i][j + self.degrees[i] + 1] >= cell[0][i]
                }) {
                    points.push(&self.points[u][v]);
                }
            }
        }
        if points.is_empty() {
            return fail("import/surface-spline-trim-empty");
        }
        Ok(std::array::from_fn(|i| CoordinateBound {
            lower_mm: points.iter().map(|p| p[i].clone()).min().unwrap(),
            upper_mm: points.iter().map(|p| p[i].clone()).max().unwrap(),
        }))
    }
}
pub(super) fn decode(
    doc: &Document,
    id: u32,
    scale_mm: &Q,
    state: &mut ImportState,
) -> Result<Carrier> {
    let entity = &doc.entities[&id];
    let complex = entity.components.len() > 1;
    let base = if complex {
        doc.component(id, "B_SPLINE_SURFACE")?
    } else {
        doc.component(id, "B_SPLINE_SURFACE_WITH_KNOTS")?
    };
    let offset = usize::from(!complex);
    let degrees = [
        number_q(arg(base, offset)?, state)?,
        number_q(arg(base, offset + 1)?, state)?,
    ];
    if degrees.iter().any(|d| !d.is_integer()) {
        return fail("import/surface-spline-degree-invalid");
    }
    let degrees = [
        degrees[0]
            .to_usize()
            .ok_or_else(|| Error::new("import/surface-spline-degree-invalid"))?,
        degrees[1]
            .to_usize()
            .ok_or_else(|| Error::new("import/surface-spline-degree-invalid"))?,
    ];
    if degrees
        .iter()
        .any(|d| *d == 0 || *d > wonky_curve::bspline::MAX_DEGREE)
    {
        return fail("import/surface-spline-degree-unsupported");
    }
    let points = arg(base, offset + 2)?
        .list()?
        .iter()
        .map(|row| {
            refs(row)?
                .into_iter()
                .map(|p| {
                    vector(doc, p, "CARTESIAN_POINT", 3, scale_mm, state)
                        .map(|v| [v[0].clone(), v[1].clone(), v[2].clone()])
                })
                .collect::<Result<Vec<_>>>()
        })
        .collect::<Result<Vec<_>>>()?;
    let ka = doc.component(id, "B_SPLINE_SURFACE_WITH_KNOTS")?;
    let start = if complex { 0 } else { 8 };
    let mut knots = [vec![], vec![]];
    for i in 0..2 {
        let multiplicities = arg(ka, start + i)?.list()?;
        let values = arg(ka, start + 2 + i)?.list()?;
        if multiplicities.len() != values.len() {
            return fail("import/surface-spline-knots-invalid");
        }
        let mut previous = None;
        for (m, k) in multiplicities.iter().zip(values) {
            let mq = number_q(m, state)?;
            if !mq.is_integer() {
                return fail("import/surface-spline-knots-invalid");
            }
            let m = mq
                .to_usize()
                .ok_or_else(|| Error::new("import/surface-spline-knots-invalid"))?;
            let k = number_q(k, state)?;
            if m == 0 || m > degrees[i] + 1 || previous.as_ref().is_some_and(|p| p >= &k) {
                return fail("import/surface-spline-knots-invalid");
            }
            knots[i].extend(std::iter::repeat_n(k.clone(), m));
            previous = Some(k);
        }
    }
    let weights = if let Ok(a) = doc.component(id, "RATIONAL_B_SPLINE_SURFACE") {
        arg(a, 0)?
            .list()?
            .iter()
            .map(|r| {
                r.list()?
                    .iter()
                    .map(|w| number_q(w, state))
                    .collect::<Result<Vec<_>>>()
            })
            .collect::<Result<Vec<_>>>()?
    } else {
        points.iter().map(|r| vec![q(1); r.len()]).collect()
    };
    let spline = SplineSurface {
        degrees,
        knots,
        points,
        weights,
    };
    spline.validate()?;
    // STEP control points are already in the representation frame.
    Ok(Carrier::Spline(
        Axis {
            origin: [q(0), q(0), q(0)],
            axis: [q(0), q(0), q(1)],
            reference: [q(1), q(0), q(0)],
        },
        spline,
    ))
}
