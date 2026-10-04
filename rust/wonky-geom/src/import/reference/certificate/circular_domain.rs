//! Exact closed-circle domain audit in an affine plane. Squared distances
//! decide nesting and separation without normalized frames, sampled polygons,
//! or approximate endpoint closure. Enclosure arithmetic is used only after
//! the retained analytic domain is established.
use super::*;

impl Body {
    pub(super) fn circular_planar_face_extents(
        &self,
        face: &Face,
        plane: &Axis,
        precision: &Q,
    ) -> Result<FaceExtents> {
        plane.semantic_columns()?;
        let tolerance = match &self.uncertainty {
            Uncertainty::Declared { mm } if mm >= &q(0) => mm,
            Uncertainty::Declared { .. } => return fail("import/source-tolerance-invalid"),
            Uncertainty::Unknown => return fail("import/source-tolerance-missing"),
        };
        let mut rings = Vec::new();
        for lp in &face.loops {
            if lp.uses.len() != 1 {
                return fail("import/trim-domain-circular-loop-required");
            }
            let (id, forward) = lp.uses[0];
            let edge = self
                .edges
                .get(&id)
                .ok_or_else(|| Error::new("import/edge-unaccounted"))?;
            let Curve::Circle {
                axis,
                radius,
                dimension: 3,
            } = &edge.curve
            else {
                return fail("import/trim-domain-circular-loop-required");
            };
            axis.semantic_columns()?;
            if radius <= &q(0) {
                return fail("import/radius-invalid");
            }
            if edge.vertices[0] != edge.vertices[1] {
                return fail("import/trim-domain-period-incomplete");
            }
            if !self.vertices.contains_key(&edge.vertices[0]) {
                return fail("import/vertex-unaccounted");
            }
            if cross(&axis.axis, &plane.axis) != [q(0), q(0), q(0)]
                || !dot(&sub(&axis.origin, &plane.origin), &plane.axis).is_zero()
            {
                return fail("import/trim-domain-circle-plane-mismatch");
            }
            // The source ring is one entire analytic circle. Validate its
            // actual source endpoint and every supplied pcurve separately.
            curved_lift::circle_edge_spans(edge, &self.vertices, tolerance)?;
            if !edge.pcurves.is_empty() {
                let pcs = edge
                    .pcurves
                    .iter()
                    .filter(|pc| pc.surface == face.surface)
                    .collect::<Vec<_>>();
                if pcs.is_empty() {
                    return fail("import/pcurve-surface-missing");
                }
                for pc in pcs {
                    self.check_pcurve(id, pc.id)?;
                }
            }
            let positive = (forward == edge.same_sense) == (dot(&axis.axis, &plane.axis) > q(0));
            rings.push((id, axis.origin.clone(), radius.clone(), positive, lp.outer));
        }
        if rings.is_empty() {
            return fail("import/trim-domain-empty");
        }
        let distance2 = |i: usize, j: usize| {
            let d = sub(&rings[i].1, &rings[j].1);
            dot(&d, &d)
        };
        let contains = |i: usize, j: usize| {
            rings[i].2 > rings[j].2 && distance2(i, j) < (&rings[i].2 - &rings[j].2).pow(2)
        };
        let outer = (0..rings.len())
            .filter(|&i| (0..rings.len()).all(|j| i == j || contains(i, j)))
            .collect::<Vec<_>>();
        if outer.len() != 1 {
            return fail("import/trim-domain-no-unique-outer-circle");
        }
        let outer = outer[0];
        if rings.iter().filter(|r| r.4).count() > 1
            || rings.iter().enumerate().any(|(i, r)| r.4 && i != outer)
        {
            return fail("import/face-outer-loop-count");
        }
        for i in 0..rings.len() {
            if rings[i].3 != (face.same_sense == (i == outer)) {
                return fail("import/trim-domain-circle-unbounded-orientation");
            }
            if i == outer {
                continue;
            }
            for j in i + 1..rings.len() {
                if j != outer && distance2(i, j) <= (&rings[i].2 + &rings[j].2).pow(2) {
                    return fail("import/trim-domain-circle-holes-not-disjoint");
                }
            }
        }
        // Every linear coordinate extreme of this finite planar region is
        // attained on its outer circle. Strictly internal disjoint holes do
        // not remove any of those boundary witnesses.
        let coordinates = self.edge_extents(rings[outer].0, precision)?.coordinates;
        Ok(FaceExtents {
            source_face: face.id,
            precision_mm: precision.clone(),
            coordinates,
        })
    }
}
