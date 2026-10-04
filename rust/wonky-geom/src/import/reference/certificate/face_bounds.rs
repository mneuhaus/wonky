//! Conservative carrier supports, including carrier interiors.
//! These are NOT precision-certified trimmed extrema or reference admission.
//! A bounded planar patch has linear extrema on its boundary. Axial height on
//! cylinders has no interior extremum. Cones additionally include their apex;
//! sphere/torus interiors instead
//! use their complete compact carrier. This deliberately retains overbounds.
use super::*;

#[derive(Clone, Debug)]
pub struct FaceSupportBounds {
    pub source_face: u32,
    pub coordinates: [CoordinateBound; 3],
    pub method: &'static str,
    /// Compact carriers cover all trim choices. Finite supports on unbounded
    /// carriers require a separate proof of a bounded trim domain. This API
    /// does not provide that proof or an admitted occupied-set enclosure.
    pub requires_bounded_trim: bool,
}

#[derive(Clone, Debug)]
pub struct BodySupportBounds {
    pub coordinates: [CoordinateBound; 3],
    pub requires_bounded_trim: bool,
}

fn union(a: &mut [CoordinateBound; 3], b: &[CoordinateBound; 3]) {
    for i in 0..3 {
        a[i].lower_mm = a[i].lower_mm.clone().min(b[i].lower_mm.clone());
        a[i].upper_mm = a[i].upper_mm.clone().max(b[i].upper_mm.clone());
    }
}

impl Body {
    /// Enclose every point of a bounded retained face, including its
    /// interior. Source uncertainty is explicitly included. The result may
    /// be loose: it must not be advertised as a measured min/max interval
    /// of width equal to the producer uncertainty.
    pub fn face_support_bounds(&self, id: u32) -> Result<FaceSupportBounds> {
        let tolerance = match &self.uncertainty {
            Uncertainty::Declared { mm } if mm >= &q(0) => mm,
            Uncertainty::Declared { .. } => return fail("import/source-tolerance-invalid"),
            Uncertainty::Unknown => return fail("import/source-tolerance-missing"),
        };
        let face = self
            .faces
            .iter()
            .find(|f| f.id == id)
            .ok_or_else(|| Error::new("import/face-unaccounted"))?;
        if face.loops.is_empty() || face.loops.iter().any(|lp| lp.uses.is_empty()) {
            return fail("import/face-unbounded");
        }
        let carrier = self
            .surfaces
            .get(&face.surface)
            .ok_or_else(|| Error::new("import/surface-unaccounted"))?;
        let mut source = self.clone();
        source.placements.clear();
        let mut boundary: Option<[CoordinateBound; 3]> = None;
        for lp in &face.loops {
            for &(edge_id, _) in &lp.uses {
                let edge = self
                    .edges
                    .get(&edge_id)
                    .ok_or_else(|| Error::new("import/edge-unaccounted"))?;
                if edge.vertices.iter().any(|v| !self.vertices.contains_key(v)) {
                    return fail("import/vertex-unaccounted");
                }
                carrier.certify_spans(&edge.source_spans(&self.vertices, tolerance)?, tolerance)?;
                let spans = match &edge.curve {
                    Curve::Circle { .. } => {
                        curved_lift::circle_edge_spans(edge, &self.vertices, tolerance)?
                    }
                    _ => edge.source_spans(&self.vertices, tolerance)?,
                };
                if spans.is_empty() || spans.iter().any(|s| s.coordinates.len() != 4) {
                    return fail("import/extents-domain-invalid");
                }
                for span in spans {
                    let bounds = extents::hull_bounds(&source, &span)?;
                    match &mut boundary {
                        Some(b) => union(b, &bounds),
                        None => boundary = Some(bounds),
                    }
                }
            }
        }
        let mut boundary = boundary.ok_or_else(|| Error::new("import/face-unbounded"))?;
        // Source edge/carrier disagreement is bounded by the declared
        // uncertainty. This is distinct from chart-enclosure error, already
        // included by hull_bounds, and from placement interval widths.
        for b in &mut boundary {
            b.lower_mm -= tolerance;
            b.upper_mm += tolerance;
        }
        let (bounds, method) = match carrier {
            Carrier::Spline(..) => return fail("import/surface-spline-source-trim-required"),
            Carrier::Plane(_) => {
                // STEP permits FACE_BOUND without an explicit
                // FACE_OUTER_BOUND designation. A conservative union of all
                // boundary hulls needs no choice of outer contour. This is
                // not an admission or winding proof.
                if face.loops.iter().filter(|lp| lp.outer).count() > 1 {
                    return fail("import/face-outer-loop-count");
                }
                (boundary.clone(), "boundary-linear-support/carrier-support")
            }
            Carrier::Sphere(axis, r) | Carrier::Torus(axis, r, _) => {
                let radius = match carrier {
                    Carrier::Torus(_, major, minor) => major + minor,
                    _ => r.clone(),
                };
                if r <= &q(0) || radius <= q(0) {
                    return fail("import/radius-invalid");
                }
                if let Carrier::Torus(_, _, minor) = carrier {
                    if minor <= &q(0) {
                        return fail("import/radius-invalid");
                    }
                }
                axis.semantic_columns()?;
                let radius = radius + tolerance;
                (
                    std::array::from_fn(|i| CoordinateBound {
                        lower_mm: &axis.origin[i] - &radius,
                        upper_mm: &axis.origin[i] + &radius,
                    }),
                    "compact-carrier/carrier-support",
                )
            }
            Carrier::Cylinder(axis, radius) | Carrier::Cone(axis, radius, _) => {
                if radius < &q(0) {
                    return fail("import/radius-invalid");
                }
                let [x, y, z] = axis.semantic_columns()?;
                let mut height = (0..3).fold(Interval::point(q(0)), |sum, i| {
                    let d = Interval(
                        &boundary[i].lower_mm - &axis.origin[i],
                        &boundary[i].upper_mm - &axis.origin[i],
                    );
                    let t = z[i].mul(&d);
                    Interval(sum.0 + t.0, sum.1 + t.1)
                });
                let radial = if let Carrier::Cone(_, _, angle) = carrier {
                    curved_lift::check_cone_angle(angle)?;
                    let (lo, hi) = tan_enclosure(angle)?;
                    // Axial height can have a constrained interior extremum
                    // at the singular apex. Including it also covers a cone
                    // cap whose only boundary is a constant-height circle.
                    let apex = Interval::point(-radius).div(&Interval(lo.clone(), hi.clone()))?;
                    height.0 = height.0.min(apex.0);
                    height.1 = height.1.max(apex.1);
                    let r = height.mul(&Interval(lo, hi));
                    (&r.0 + radius).abs().max((&r.1 + radius).abs())
                } else {
                    if radius.is_zero() {
                        return fail("import/radius-invalid");
                    }
                    radius.clone()
                } + tolerance;
                let local = std::array::from_fn(|i| {
                    // Full angular range. No boundary-only assumption for
                    // the radial directions of a curved face.
                    let xi = x[i].0.abs().max(x[i].1.abs());
                    let yi = y[i].0.abs().max(y[i].1.abs());
                    let radial_support = Interval::sqrt(&(&xi * &xi + &yi * &yi))
                        .expect("sum of squares is nonnegative")
                        .1
                        * &radial;
                    let axial = z[i].mul(&height);
                    CoordinateBound {
                        lower_mm: &axis.origin[i] + axial.0 - &radial_support,
                        upper_mm: &axis.origin[i] + axial.1 + &radial_support,
                    }
                });
                (local, "axial-boundary/full-angle/carrier-support")
            }
        };
        let mut coordinates = self.placed_coordinate_bounds(&bounds)?;
        // Retain source edge observations too, without assuming nominal
        // carrier projection leaves all rounded input points inside its box.
        union(&mut coordinates, &self.placed_coordinate_bounds(&boundary)?);
        Ok(FaceSupportBounds {
            source_face: id,
            coordinates,
            method,
            requires_bounded_trim: !matches!(carrier, Carrier::Sphere(..) | Carrier::Torus(..)),
        })
    }

    pub fn body_support_bounds(&self) -> Result<BodySupportBounds> {
        let mut result: Option<[CoordinateBound; 3]> = None;
        let mut requires_bounded_trim = false;
        for face in &self.faces {
            let support = self.face_support_bounds(face.id)?;
            requires_bounded_trim |= support.requires_bounded_trim;
            let bounds = support.coordinates;
            match &mut result {
                Some(a) => union(a, &bounds),
                None => result = Some(bounds),
            }
        }
        Ok(BodySupportBounds {
            coordinates: result.ok_or_else(|| Error::new("import/body-empty"))?,
            requires_bounded_trim,
        })
    }
}
