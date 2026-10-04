//! Source-bound full-period cylindrical trims. A cylinder cut by two disjoint
//! transverse circles has one finite connected band. Its oriented boundary
//! selects that band rather than the unbounded complement. A repeated seam is
//! audited as a chart cut, never treated as a hole or discarded source edge.
use super::*;

impl Body {
    /// Measure a complete retained face. Planes use the rational trim-domain
    /// audit; cylindrical full-period bands use their exact quotient topology.
    /// Other trim classes still refuse, rather than accepting carrier supports
    /// or caller-supplied chart domains as source-bound measurements.
    pub fn face_extents(&self, id: u32, precision_mm: &Q) -> Result<FaceExtents> {
        if precision_mm <= &q(0) {
            return fail("import/enclosure-budget-required");
        }
        let face = self
            .faces
            .iter()
            .find(|f| f.id == id)
            .ok_or_else(|| Error::new("import/face-unaccounted"))?;
        let carrier = self
            .surfaces
            .get(&face.surface)
            .ok_or_else(|| Error::new("import/surface-unaccounted"))?;
        match carrier {
            Carrier::Plane(axis) => {
                if face.loops.iter().all(|lp| {
                    lp.uses.len() == 1
                        && self
                            .edges
                            .get(&lp.uses[0].0)
                            .is_some_and(|e| matches!(e.curve, Curve::Circle { dimension: 3, .. }))
                }) {
                    self.circular_planar_face_extents(face, axis, precision_mm)
                } else {
                    self.planar_face_extents(id, precision_mm)
                }
            }
            Carrier::Cylinder(axis, radius) => {
                let rings = self.cylindrical_band_rings(face, axis, radius)?;
                let mut bounds = self.edge_extents(rings[0], precision_mm)?.coordinates;
                let other = self.edge_extents(rings[1], precision_mm)?.coordinates;
                // At each angular coordinate every point of the band is an
                // affine interpolation between the two source circles. A
                // semantic rigid placement preserves this identity, so every
                // linear world-coordinate extremum occurs on those circles.
                for i in 0..3 {
                    bounds[i].minimum.lower_mm = bounds[i]
                        .minimum
                        .lower_mm
                        .clone()
                        .min(other[i].minimum.lower_mm.clone());
                    bounds[i].minimum.upper_mm = bounds[i]
                        .minimum
                        .upper_mm
                        .clone()
                        .min(other[i].minimum.upper_mm.clone());
                    bounds[i].maximum.lower_mm = bounds[i]
                        .maximum
                        .lower_mm
                        .clone()
                        .max(other[i].maximum.lower_mm.clone());
                    bounds[i].maximum.upper_mm = bounds[i]
                        .maximum
                        .upper_mm
                        .clone()
                        .max(other[i].maximum.upper_mm.clone());
                }
                Ok(FaceExtents {
                    source_face: id,
                    precision_mm: precision_mm.clone(),
                    coordinates: bounds,
                })
            }
            _ => fail("import/trim-domain-source-carrier-unsupported"),
        }
    }

    fn cylindrical_band_rings(&self, face: &Face, axis: &Axis, radius: &Q) -> Result<[u32; 2]> {
        axis.semantic_columns()?;
        let tolerance = match &self.uncertainty {
            Uncertainty::Declared { mm } if mm >= &q(0) => mm,
            Uncertainty::Declared { .. } => return fail("import/source-tolerance-invalid"),
            Uncertainty::Unknown => return fail("import/source-tolerance-missing"),
        };
        if radius <= &q(0) {
            return fail("import/carrier-radius-invalid");
        }
        let mut rings = Vec::new();
        let mut cuts = BTreeMap::<u32, Vec<bool>>::new();
        if face.loops.is_empty() {
            return fail("import/face-unbounded");
        }
        for lp in &face.loops {
            if lp.uses.is_empty() {
                return fail("import/loop-empty");
            }
            for (i, &(id, forward)) in lp.uses.iter().enumerate() {
                let edge = self
                    .edges
                    .get(&id)
                    .ok_or_else(|| Error::new("import/edge-unaccounted"))?;
                let (next, nf) = lp.uses[(i + 1) % lp.uses.len()];
                let next = self
                    .edges
                    .get(&next)
                    .ok_or_else(|| Error::new("import/edge-unaccounted"))?;
                if edge.vertices[usize::from(forward)] != next.vertices[usize::from(!nf)] {
                    return fail("import/coedge-disconnected");
                }
                if edge
                    .vertices
                    .iter()
                    .any(|id| !self.vertices.contains_key(id))
                {
                    return fail("import/vertex-unaccounted");
                }
                match &edge.curve {
                    Curve::Circle {
                        axis: circle,
                        radius: r,
                        dimension: 3,
                    } => {
                        circle.semantic_columns()?;
                        if edge.vertices[0] != edge.vertices[1] {
                            return fail("import/trim-domain-period-incomplete");
                        }
                        if r != radius
                            || cross(&circle.axis, &axis.axis) != [q(0), q(0), q(0)]
                            || cross(&sub(&circle.origin, &axis.origin), &axis.axis)
                                != [q(0), q(0), q(0)]
                        {
                            return fail("import/trim-domain-band-carrier-mismatch");
                        }
                        let height = dot(&sub(&circle.origin, &axis.origin), &axis.axis);
                        let positive = forward == edge.same_sense;
                        let positive = positive == (dot(&circle.axis, &axis.axis) > q(0));
                        rings.push((id, height, positive));
                    }
                    Curve::Line { direction, .. } => {
                        if direction.len() != 3 {
                            return fail("import/dimension-unsupported");
                        }
                        let d: Point = std::array::from_fn(|i| direction[i].clone());
                        if dot(&d, &d).is_zero() || cross(&d, &axis.axis) != [q(0), q(0), q(0)] {
                            return fail("import/trim-domain-band-cut-nonaxial");
                        }
                        cuts.entry(id).or_default().push(forward);
                    }
                    _ => return fail("import/trim-domain-band-boundary-unsupported"),
                }
                let spans = edge.source_spans(&self.vertices, tolerance)?;
                self.surfaces[&face.surface].certify_spans(&spans, tolerance)?;
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
            }
        }
        if rings.len() != 2 || rings[0].0 == rings[1].0 {
            return fail("import/trim-domain-band-ring-count");
        }
        rings.sort_by(|a, b| a.1.cmp(&b.1));
        if rings[0].1 == rings[1].1 {
            return fail("import/trim-domain-band-zero-height");
        }
        // Positive chart orientation is (angle, axial distance). Its finite
        // strip runs forward around the lower ring and back around the upper.
        if rings[0].2 != face.same_sense || rings[1].2 == face.same_sense {
            return fail("import/trim-domain-band-unbounded-orientation");
        }
        match (face.loops.len(), cuts.len()) {
            (2, 0) if face.loops.iter().all(|lp| lp.uses.len() == 1) => {}
            (1, 1) if face.loops[0].uses.len() == 4 => {
                let (&cut, uses) = cuts.iter().next().unwrap();
                if uses.len() != 2 || uses[0] == uses[1] {
                    return fail("import/trim-domain-band-cut-incidence");
                }
                let mut ends = self.edges[&cut].vertices;
                let mut expected = [
                    self.edges[&rings[0].0].vertices[0],
                    self.edges[&rings[1].0].vertices[0],
                ];
                ends.sort();
                expected.sort();
                if ends != expected {
                    return fail("import/trim-domain-band-cut-disconnected");
                }
            }
            _ => return fail("import/trim-domain-band-topology-unsupported"),
        }
        Ok([rings[0].0, rings[1].0])
    }
}
