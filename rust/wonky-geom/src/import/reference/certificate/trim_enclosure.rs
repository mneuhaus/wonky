//! Source-bound chart hulls. These enclose retained patches, never the whole
//! untrimmed carrier. Slack is explicit; no hull is promoted to exact extrema.
use super::*;

#[derive(Clone, Debug)]
pub struct TrimEnclosure {
    pub source_face: u32,
    pub coordinates: [CoordinateBound; 3],
    pub method: &'static str,
    /// Upper bound on coordinate slack relative to attained boundary witnesses.
    pub slack_mm: [Q; 3],
}

impl Body {
    pub fn trimmed_face_enclosure(&self, id: u32, precision: &Q) -> Result<TrimEnclosure> {
        if precision <= &q(0) {
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
        let tolerance = match &self.uncertainty {
            Uncertainty::Declared { mm } if mm >= &q(0) => mm,
            Uncertainty::Declared { .. } => return fail("import/source-tolerance-invalid"),
            Uncertainty::Unknown => return fail("import/source-tolerance-missing"),
        };
        if face.loops.is_empty() || face.loops.iter().any(|lp| lp.uses.is_empty()) {
            return fail("import/face-unbounded");
        }
        // A spherical chart is singular at its poles. Until a general winding
        // proof exists, only the oriented single-latitude cap below is admitted;
        // splitting that ring must not silently turn a cap into an empty band.
        if matches!(carrier, Carrier::Sphere(..))
            && (face.loops.len() != 1 || face.loops[0].uses.len() != 1)
        {
            return fail("import/sphere-polar-trim-undecidable");
        }
        // Boundary extrema are attained witnesses for the enclosure's slack.
        let mut boundary: Option<[CoordinateExtrema; 3]> = None;
        for lp in &face.loops {
            for &(edge, _) in &lp.uses {
                if matches!(carrier, Carrier::Plane(_)) {
                    carrier.certify_spans(
                        &self.edges[&edge].source_spans(&self.vertices, tolerance)?,
                        tolerance,
                    )?;
                }
                let e = self.edge_extents(edge, precision)?.coordinates;
                if let Some(a) = &mut boundary {
                    for i in 0..3 {
                        a[i].minimum.lower_mm = a[i]
                            .minimum
                            .lower_mm
                            .clone()
                            .min(e[i].minimum.lower_mm.clone());
                        a[i].minimum.upper_mm = a[i]
                            .minimum
                            .upper_mm
                            .clone()
                            .min(e[i].minimum.upper_mm.clone());
                        a[i].maximum.lower_mm = a[i]
                            .maximum
                            .lower_mm
                            .clone()
                            .max(e[i].maximum.lower_mm.clone());
                        a[i].maximum.upper_mm = a[i]
                            .maximum
                            .upper_mm
                            .clone()
                            .max(e[i].maximum.upper_mm.clone());
                    }
                } else {
                    boundary = Some(e);
                }
            }
        }
        let boundary = boundary.ok_or_else(|| Error::new("import/face-unbounded"))?;
        let (coordinates, method) = if matches!(carrier, Carrier::Plane(_)) {
            // A finite planar region attains every linear extremum on its
            // boundary. Reference topology is audited at admission.
            (
                std::array::from_fn(|i| CoordinateBound {
                    lower_mm: &boundary[i].minimum.lower_mm - tolerance,
                    upper_mm: &boundary[i].maximum.upper_mm + tolerance,
                }),
                "trim-boundary/planar-enclosure",
            )
        } else {
            let mut hull: Option<[[Q; 2]; 2]> = None;
            for lp in &face.loops {
                let mut previous: Option<[Q; 2]> = None;
                for &(id, forward) in &lp.uses {
                    let edge = self
                        .edges
                        .get(&id)
                        .ok_or_else(|| Error::new("import/edge-unaccounted"))?;
                    let pcs = edge
                        .pcurves
                        .iter()
                        .filter(|pc| pc.surface == face.surface)
                        .collect::<Vec<_>>();
                    if pcs.is_empty() {
                        return fail("import/trim-pcurve-missing");
                    }
                    // Keep both definitions of a seam; dropping either can
                    // erase a complete periodic interval.
                    let mut next = None;
                    for pc in pcs {
                        // A chart hull is evidence only after the complete retained
                        // pcurve domain is proved to agree with its 3D source trim.
                        if matches!(pc.curve, Curve::Spline { .. }) {
                            curved_lift::check_chart_endpoints(
                                pc, carrier, &self.unit_to_mm, tolerance, edge, &self.vertices,
                            )?;
                        }
                        self.check_pcurve(id, pc.id)?;
                        let mut spans = curved_lift::chart_edge(
                            pc,
                            carrier,
                            &self.unit_to_mm,
                            tolerance,
                            edge,
                            &self.vertices,
                        )?;
                        curved_lift::certify_circle_trim_chart(
                            &mut spans, pc, carrier, &self.unit_to_mm, tolerance, edge, &self.vertices,
                        )?;
                        let reverse = !forward
                            ^ (!edge.same_sense && (matches!(edge.curve, Curve::Spline { .. })
                                || matches!(pc.curve, Curve::Spline { .. })));
                        if reverse {
                            spans.reverse();
                            for span in &mut spans {
                                span.coordinates = span
                                    .coordinates
                                    .iter()
                                    .map(|p| restrict(p, &q(1), &q(0)))
                                    .collect();
                            }
                        }
                        let mut end = previous.clone();
                        for mut span in spans {
                            if span.coordinates.len() != 3 {
                                return fail("import/pcurve-dimension-invalid");
                            }
                            // Adjacent observations may use different lifts of
                            // the same periodic chart. Glue their phases before
                            // taking a hull, retaining an interval for exact pi.
                            // This is a chart transition, not a geometry snap.
                            if let Some(target) = end
                                .as_ref()
                                .filter(|_| !matches!(carrier, Carrier::Spline(..)))
                            {
                                let w = span.coordinates[2].evaluate(&q(0)).unwrap();
                                if w <= q(0) {
                                    return fail("import/pcurve-weight-unproved");
                                }
                                let pi = curved_lift::pi_bounds();
                                let period = Interval(q(2) * pi.0, q(2) * pi.1);
                                for i in 0..if matches!(carrier, Carrier::Torus(..)) {
                                    2
                                } else {
                                    1
                                } {
                                    let start = span.coordinates[i].evaluate(&q(0)).unwrap() / &w;
                                    let turns = ((&target[i] - &start) / period.mid()
                                        + q(1) / q(2))
                                    .floor()
                                    .to_integer()
                                    .to_i64()
                                    .ok_or_else(|| {
                                        Error::new("import/trim-periodic-proof-budget")
                                    })?;
                                    let shift = q(turns) * period.mid();
                                    let error = q(turns).abs() * period.radius();
                                    if (&start + &shift - &target[i]).abs()
                                        + &error
                                        + &span.chart_error_mm
                                        >= &period.0 / q(2)
                                    {
                                        return fail("import/trim-periodic-branch-undecidable");
                                    }
                                    span.coordinates[i] = span.coordinates[i]
                                        .add(&scale(&span.coordinates[2], &shift));
                                    span.chart_error_mm += error;
                                }
                            }
                            let w = span.coordinates[2].evaluate(&q(1)).unwrap();
                            if w <= q(0) {
                                return fail("import/pcurve-weight-unproved");
                            }
                            end = Some(std::array::from_fn(|i| {
                                span.coordinates[i].evaluate(&q(1)).unwrap() / &w
                            }));
                            if span.coordinates.len() != 3 {
                                return fail("import/pcurve-dimension-invalid");
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
                            if controls[2].iter().any(|w| w <= &q(0)) {
                                return fail("import/pcurve-weight-unproved");
                            }
                            let b: [[Q; 2]; 2] = std::array::from_fn(|side| {
                                std::array::from_fn(|i| {
                                    let values =
                                        (0..=degree).map(|k| &controls[i][k] / &controls[2][k]);
                                    if side == 0 {
                                        values.min().unwrap() - &span.chart_error_mm
                                    } else {
                                        values.max().unwrap() + &span.chart_error_mm
                                    }
                                })
                            });
                            if let Some(a) = &mut hull {
                                for i in 0..2 {
                                    a[0][i] = a[0][i].clone().min(b[0][i].clone());
                                    a[1][i] = a[1][i].clone().max(b[1][i].clone());
                                }
                            } else {
                                hull = Some(b);
                            }
                        }
                        if next.is_none() {
                            next = end;
                        }
                    }
                    previous = next;
                }
            }
            let mut cell = hull.ok_or_else(|| Error::new("import/trim-chart-empty"))?;
            // Periodic lifts can accumulate large phases around a source loop.
            // Recenter the proof box through an exact chart transition. If its
            // projection covers a period, one canonical period encloses it.
            // The scalar trigonometric proof budget remains unchanged.
            let pi = curved_lift::pi_bounds();
            let period = Interval(q(2) * &pi.0, q(2) * &pi.1);
            for i in 0..if matches!(carrier, Carrier::Spline(..)) {
                0
            } else if matches!(carrier, Carrier::Torus(..)) {
                2
            } else {
                1
            } {
                if &cell[1][i] - &cell[0][i] >= period.0 {
                    cell[0][i] = -&pi.1;
                    cell[1][i] = pi.1.clone();
                } else {
                    let centre = (&cell[0][i] + &cell[1][i]) / q(2);
                    let turns = (centre / period.mid() + q(1) / q(2))
                        .floor()
                        .to_integer()
                        .to_i64()
                        .ok_or_else(|| Error::new("import/trim-periodic-proof-budget"))?;
                    let shift = q(turns) * period.mid();
                    let error = q(turns).abs() * period.radius();
                    cell[0][i] -= &shift + &error;
                    cell[1][i] = &cell[1][i] - &shift + &error;
                }
            }
            // A full latitude bounds a polar cap, not a zero-width rectangle.
            // Select the pole using the oriented source loop. This retains the
            // singular chart boundary even though STEP has no edge at a pole.
            if let Carrier::Sphere(axis, _) = carrier {
                if face.loops.len() == 1 && face.loops[0].uses.len() == 1 {
                    let (id, forward) = face.loops[0].uses[0];
                    let edge = &self.edges[&id];
                    let Curve::Circle { axis: ring, .. } = &edge.curve else {
                        return fail("import/sphere-polar-trim-undecidable");
                    };
                    if edge.vertices[0] != edge.vertices[1]
                        || cross(&axis.axis, &ring.axis) != [q(0), q(0), q(0)]
                    {
                        return fail("import/sphere-polar-trim-undecidable");
                    }
                    let north = ((forward == edge.same_sense)
                        == (dot(&axis.axis, &ring.axis) > q(0)))
                        == face.same_sense;
                    let pi = curved_lift::pi_bounds();
                    if north {
                        cell[1][1] = pi.1 / q(2);
                    } else {
                        cell[0][1] = -pi.1 / q(2);
                    }
                }
            }
            // A finite chart patch lies in its outer boundary's convex hull.
            // All cells are retained. Subdivision reduces interval dependency
            // without sampling, dropping points or replacing analytic geometry.
            let cache = curved_lift::TrigCache::default();
            let mut result: Option<[CoordinateBound; 3]> = None;
            let n = 16;
            for u in 0..n {
                for v in 0..n {
                    let a: [[Q; 2]; 2] = std::array::from_fn(|side| {
                        std::array::from_fn(|i| {
                            &cell[0][i]
                                + (&cell[1][i] - &cell[0][i])
                                    * q(if i == 0 {
                                        u + side as i64
                                    } else {
                                        v + side as i64
                                    })
                                    / q(n)
                        })
                    });
                    let b = self.placed_coordinate_bounds(&curved_lift::carrier_box(
                        carrier,
                        &self.unit_to_mm,
                        &a,
                        &cache,
                    )?)?;
                    if let Some(a) = &mut result {
                        for i in 0..3 {
                            a[i].lower_mm = a[i].lower_mm.clone().min(b[i].lower_mm.clone());
                            a[i].upper_mm = a[i].upper_mm.clone().max(b[i].upper_mm.clone());
                        }
                    } else {
                        result = Some(b);
                    }
                }
            }
            let mut b = result.unwrap();
            for i in 0..3 {
                // Include retained source trims explicitly. Producer rounding
                // is not exact incidence and is never silently healed.
                b[i].lower_mm = b[i]
                    .lower_mm
                    .clone()
                    .min(boundary[i].minimum.lower_mm.clone())
                    - tolerance;
                b[i].upper_mm = b[i]
                    .upper_mm
                    .clone()
                    .max(boundary[i].maximum.upper_mm.clone())
                    + tolerance;
            }
            (
                b,
                if matches!(carrier, Carrier::Spline(..)) {
                    "active-trim/control-net-enclosure"
                } else {
                    "trim-chart/analytic-extrema-enclosure"
                },
            )
        };
        let slack_mm = std::array::from_fn(|i| {
            (&boundary[i].minimum.upper_mm - &coordinates[i].lower_mm)
                .max(&coordinates[i].upper_mm - &boundary[i].maximum.lower_mm)
        });
        Ok(TrimEnclosure {
            source_face: id,
            coordinates,
            method,
            slack_mm,
        })
    }
}
