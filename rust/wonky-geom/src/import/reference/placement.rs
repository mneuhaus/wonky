//! Enclosures of the semantic rigid placements, not rounded affine maps.
//! These are nominal source-point observations, not face or solid extents.
use super::*;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CoordinateBound {
    pub lower_mm: Q,
    pub upper_mm: Q,
}

fn sum(terms: impl Iterator<Item = Interval>) -> Interval {
    terms.fold(Interval::point(q(0)), |a, b| Interval(a.0 + b.0, a.1 + b.1))
}

impl Body {
    /// Apply every child-to-parent placement to one nominal source point.
    /// The rational intervals enclose normalization and every composition.
    /// Source uncertainty is retained on the body and is not manufacturing
    /// accuracy or part of these nominal coordinate enclosures.
    pub fn placed_point_bounds(&self, point: &Point) -> Result<[CoordinateBound; 3]> {
        self.placed_coordinate_bounds(&point.clone().map(|q| CoordinateBound {
            lower_mm: q.clone(),
            upper_mm: q,
        }))
    }

    /// Compose source-coordinate enclosures through semantic rigid placements.
    /// These are nominal geometry bounds, not source manufacturing uncertainty.
    pub fn placed_coordinate_bounds(
        &self,
        bounds: &[CoordinateBound; 3],
    ) -> Result<[CoordinateBound; 3]> {
        if bounds.iter().any(|b| b.lower_mm > b.upper_mm) {
            return fail("import/coordinate-bounds-invalid");
        }
        let mut p = bounds.clone().map(|b| Interval(b.lower_mm, b.upper_mm));
        for (from, to) in &self.placements {
            let source = from.semantic_columns()?;
            let target = to.semantic_columns()?;
            let d: [Interval; 3] =
                std::array::from_fn(|i| p[i].sub(&Interval::point(from.origin[i].clone())));
            // A semantic AXIS2 frame is orthonormal: its inverse is its
            // transpose. Inverting the enclosure-centre Frame would instead
            // invert a different, non-orthonormal affine transformation.
            let local: [Interval; 3] =
                std::array::from_fn(|j| sum((0..3).map(|i| source[j][i].mul(&d[i]))));
            p = std::array::from_fn(|i| {
                let v = sum((0..3).map(|j| target[j][i].mul(&local[j])));
                Interval(&to.origin[i] + v.0, &to.origin[i] + v.1)
            });
        }
        Ok(p.map(|v| CoordinateBound {
            lower_mm: v.0,
            upper_mm: v.1,
        }))
    }

    /// Source IDs are preserved. This is deliberately not named body bounds:
    /// a curved face can extend beyond every one of its source vertices.
    pub fn placed_vertex_bounds(&self) -> Result<BTreeMap<u32, [CoordinateBound; 3]>> {
        self.vertices
            .iter()
            .map(|(id, p)| Ok((*id, self.placed_point_bounds(p)?)))
            .collect()
    }
}
