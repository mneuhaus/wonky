//! Complete finite chart regions and occupied-face extrema. The domain stays
//! rational/analytic: Bernstein hulls only enclose the retained trim curves.
//! Exact winding classifies connected boxes that miss every trim. Unclassified
//! boxes are retained, never dropped; exhausted proof budgets are refusals.
use super::*;
use std::sync::Arc;
use wonky_curve::{bspline::BSpline, Cycle, ExactPoint, Trimmed};

#[derive(Clone, Debug)]
pub struct FaceChartDomain {
    cycles: Vec<Cycle>,
    boundary: Vec<HomogeneousSpan>,
    bounds: [[Q; 2]; 2],
}

#[derive(Clone, Debug)]
pub struct FaceExtents {
    pub source_face: u32,
    pub precision_mm: Q,
    pub coordinates: [CoordinateExtrema; 3],
}

fn curve_error(e: wonky_curve::Refusal) -> Error {
    Error::new(&format!("import/trim-domain:{}", e.name()))
}

impl FaceChartDomain {
    /// A finite bounded domain in a single non-singular carrier chart. The
    /// first cycle is the outer boundary, subsequent cycles are holes. This
    /// constructor is independent of STEP observations: source correspondence
    /// and periodic atlas selection must be proved by the importing caller.
    /// No endpoint snapping or approximate polygon decides the domain.
    pub fn new(loops: Vec<Vec<HomogeneousSpan>>) -> Result<Self> {
        if loops.is_empty() || loops.iter().any(Vec::is_empty) {
            return fail("import/trim-domain-empty");
        }
        let boundary = loops.iter().flatten().cloned().collect();
        let mut cycles = Vec::new();
        for spans in loops {
            let mut pieces = Vec::new();
            for span in spans {
                if span.coordinates.len() != 3 || !span.chart_error_mm.is_zero() {
                    return fail("import/trim-domain-inexact-chart");
                }
                let degree = span
                    .coordinates
                    .iter()
                    .filter_map(Poly::degree)
                    .max()
                    .unwrap_or(0);
                if degree == 0 {
                    return fail("import/trim-domain-degenerate");
                }
                let controls = span
                    .coordinates
                    .iter()
                    .map(|p| p.to_bernstein(degree).unwrap())
                    .collect::<Vec<_>>();
                if controls[2].iter().any(|w| w <= &q(0)) {
                    return fail("import/trim-domain-weight-unproved");
                }
                let poles = (0..=degree)
                    .map(|k| {
                        [
                            &controls[0][k] / &controls[2][k],
                            &controls[1][k] / &controls[2][k],
                        ]
                    })
                    .collect();
                let spline = BSpline::new(
                    degree,
                    (0..=degree)
                        .map(|_| q(0))
                        .chain((0..=degree).map(|_| q(1)))
                        .collect(),
                    poles,
                    Some(controls[2].clone()),
                )
                .map_err(curve_error)?;
                pieces.push(Trimmed::spline(Arc::new(spline), q(0), q(1)).map_err(curve_error)?);
            }
            let n = pieces.len();
            for i in 0..n {
                if pieces[i].ends()[1] != pieces[(i + 1) % n].ends()[0] {
                    return fail("import/trim-domain-disconnected");
                }
                for j in i + 1..n {
                    if j != i + 1
                        && !(i == 0 && j == n - 1)
                        && pieces[i]
                            .ends()
                            .iter()
                            .any(|a| pieces[j].ends().contains(a))
                    {
                        return fail("import/trim-domain-nonsimple");
                    }
                    pieces[i].admit(&pieces[j]).map_err(curve_error)?;
                }
            }
            let cycle = Cycle::new(pieces);
            // Verify nonzero orientation, then canonicalize by domain role.
            let ccw = cycle.orientation().map_err(curve_error)?;
            cycles.push(if ccw == cycles.is_empty() {
                cycle
            } else {
                cycle.reversed()
            });
        }
        for i in 0..cycles.len() {
            for j in i + 1..cycles.len() {
                for a in cycles[i].pieces() {
                    for b in cycles[j].pieces() {
                        // Holes must be strictly separate, including endpoints.
                        if !a.contact_report(b).map_err(curve_error)?.is_empty() {
                            return fail("import/trim-domain-boundary-contact");
                        }
                    }
                }
            }
        }
        for i in 1..cycles.len() {
            let witness = &cycles[i].pieces()[0].ends()[0];
            if cycles[0].winding(witness).map_err(curve_error)? == 0 {
                return fail("import/trim-domain-hole-outside");
            }
            for j in 1..cycles.len() {
                if i != j && cycles[j].winding(witness).map_err(curve_error)? != 0 {
                    return fail("import/trim-domain-nested-hole");
                }
            }
        }
        let b = cycles[0].bounds().map_err(curve_error)?;
        let bounds = [
            [binary64(b[0][0])?, binary64(b[0][1])?],
            [binary64(b[1][0])?, binary64(b[1][1])?],
        ];
        Ok(Self {
            cycles,
            boundary,
            bounds,
        })
    }

    fn unordered(loops: Vec<Vec<HomogeneousSpan>>) -> Result<Self> {
        let mut domains = loops
            .iter()
            .cloned()
            .map(|lp| Self::new(vec![lp]))
            .collect::<Result<Vec<_>>>()?;
        let mut outer = None;
        for i in 0..domains.len() {
            let mut contains_all = true;
            for j in 0..domains.len() {
                if i == j {
                    continue;
                }
                let p = &domains[j].cycles[0].pieces()[0].ends()[0];
                contains_all &= domains[i].cycles[0].winding(p).map_err(curve_error)? != 0;
            }
            if contains_all {
                if outer.replace(i).is_some() {
                    return fail("import/trim-domain-outer-ambiguous");
                }
            }
        }
        let i = outer.ok_or_else(|| Error::new("import/trim-domain-no-outer"))?;
        let mut loops = loops;
        loops.swap(0, i);
        domains.clear();
        Self::new(loops)
    }

    fn membership(&self, cell: &[[Q; 2]; 2]) -> Result<Option<bool>> {
        let mut todo = self
            .boundary
            .iter()
            .cloned()
            .map(|s| (s, 0))
            .collect::<Vec<_>>();
        let mut work = 0;
        while let Some((span, depth)) = todo.pop() {
            work += 1;
            if work > 8192 {
                return Ok(None);
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
                return fail("import/trim-domain-weight-unproved");
            }
            let bounds: [[Q; 2]; 2] = std::array::from_fn(|side| {
                std::array::from_fn(|i| {
                    let values = (0..=degree).map(|k| &controls[i][k] / &controls[2][k]);
                    if side == 0 {
                        values.min().unwrap()
                    } else {
                        values.max().unwrap()
                    }
                })
            });
            if (0..2).any(|i| bounds[1][i] < cell[0][i] || bounds[0][i] > cell[1][i]) {
                continue;
            }
            if depth >= 16
                || (0..2)
                    .all(|i| &bounds[1][i] - &bounds[0][i] <= (&cell[1][i] - &cell[0][i]) / q(4))
            {
                return Ok(None);
            }
            let [a, b] = curved_lift::subdivide(&span);
            todo.push((a, depth + 1));
            todo.push((b, depth + 1));
        }
        let mid = std::array::from_fn(|i| (&cell[0][i] + &cell[1][i]) / q(2));
        Ok(Some(self.contains(&mid)?))
    }

    fn contains(&self, uv: &[Q; 2]) -> Result<bool> {
        let p = ExactPoint::from_rational(uv.clone());
        for cycle in &self.cycles {
            for piece in cycle.pieces() {
                if piece.contains(&p).map_err(curve_error)? {
                    return Ok(true);
                }
            }
        }
        if self.cycles[0].winding(&p).map_err(curve_error)? == 0 {
            return Ok(false);
        }
        for hole in &self.cycles[1..] {
            if hole.winding(&p).map_err(curve_error)? != 0 {
                return Ok(false);
            }
        }
        Ok(true)
    }
}

impl Body {
    /// Bind a finite planar trim domain to the retained source curves. This
    /// path uses an exact rational affine plane chart; rounded inconsistent
    /// observations are refused rather than snapped to manufacture closure.
    /// FACE_BOUND without FACE_OUTER_BOUND is resolved by exact nesting.
    fn planar_trim_domain(&self, id: u32) -> Result<FaceChartDomain> {
        let face = self
            .faces
            .iter()
            .find(|f| f.id == id)
            .ok_or_else(|| Error::new("import/face-unaccounted"))?;
        let carrier = self
            .surfaces
            .get(&face.surface)
            .ok_or_else(|| Error::new("import/surface-unaccounted"))?;
        let Carrier::Plane(axis) = carrier else {
            return fail("import/trim-domain-planar-carrier-required");
        };
        axis.semantic_columns()?;
        // Exact affine plane coordinates need no normalization square roots.
        let n2 = dot(&axis.axis, &axis.axis);
        let projection = dot(&axis.reference, &axis.axis) / &n2;
        let x: Point = std::array::from_fn(|i| &axis.reference[i] - &projection * &axis.axis[i]);
        let y = cross(&axis.axis, &x);
        let basis = [x, y, axis.axis.clone()];
        let tolerance = match &self.uncertainty {
            Uncertainty::Declared { mm } => mm,
            Uncertainty::Unknown => return fail("import/source-tolerance-missing"),
        };
        let mut loops = Vec::new();
        for lp in &face.loops {
            let mut projected = Vec::new();
            for &(id, forward) in &lp.uses {
                let edge = self
                    .edges
                    .get(&id)
                    .ok_or_else(|| Error::new("import/edge-unaccounted"))?;
                let mut spans = match edge.curve {
                    Curve::Circle { .. } => {
                        curved_lift::circle_edge_spans(edge, &self.vertices, tolerance)?
                    }
                    _ => edge.source_spans(&self.vertices, tolerance)?,
                };
                let reverse =
                    !forward ^ (matches!(edge.curve, Curve::Spline { .. }) && !edge.same_sense);
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
                for span in spans {
                    if span.coordinates.len() != 4 || !span.chart_error_mm.is_zero() {
                        return fail("import/trim-domain-inexact-chart");
                    }
                    let w = &span.coordinates[3];
                    let relative: Vec<Poly> = (0..3)
                        .map(|i| span.coordinates[i].sub(&scale(w, &axis.origin[i])))
                        .collect();
                    let local: Vec<Poly> = (0..3)
                        .map(|j| {
                            (0..3).fold(Poly::zero(), |a, i| {
                                a.add(&scale(&relative[i], &basis[j][i]))
                            })
                        })
                        .collect();
                    if !local[2].is_zero() {
                        return fail("import/trim-domain-inexact-plane-incidence");
                    }
                    projected.push(HomogeneousSpan {
                        a: span.a,
                        b: span.b,
                        coordinates: vec![
                            scale(&local[0], &(q(1) / dot(&basis[0], &basis[0]))),
                            scale(&local[1], &(q(1) / dot(&basis[1], &basis[1]))),
                            w.clone(),
                        ],
                        chart_error_mm: q(0),
                    });
                }
            }
            loops.push(projected);
        }
        if face.loops.iter().filter(|lp| lp.outer).count() > 1 {
            return fail("import/face-outer-loop-count");
        }
        let domain = if let Some(i) = face.loops.iter().position(|lp| lp.outer) {
            loops.swap(0, i);
            FaceChartDomain::new(loops)?
        } else {
            FaceChartDomain::unordered(loops)?
        };
        Ok(domain)
    }

    /// A source-bound planar face measurement. The domain is audited from its
    /// actual retained trim curves, not supplied independently by the caller.
    pub fn planar_face_extents(&self, id: u32, precision_mm: &Q) -> Result<FaceExtents> {
        if precision_mm <= &q(0) {
            return fail("import/enclosure-budget-required");
        }
        self.planar_trim_domain(id)?;
        let face = self
            .faces
            .iter()
            .find(|f| f.id == id)
            .ok_or_else(|| Error::new("import/face-unaccounted"))?;
        let mut coordinates: Option<[CoordinateExtrema; 3]> = None;
        let mut checked = BTreeSet::new();
        // A linear world-coordinate extremum of a finite planar region is
        // attained on its actual trim boundary, including regions with holes.
        // The domain audit establishes finiteness and simplicity first.
        for lp in &face.loops {
            for &(edge, _) in &lp.uses {
                if !checked.insert(edge) {
                    continue;
                }
                let extents = self.edge_extents(edge, precision_mm)?;
                match &mut coordinates {
                    None => coordinates = Some(extents.coordinates),
                    Some(a) => {
                        for (i, b) in extents.coordinates.iter().enumerate() {
                            a[i].minimum.lower_mm = a[i]
                                .minimum
                                .lower_mm
                                .clone()
                                .min(b.minimum.lower_mm.clone());
                            a[i].minimum.upper_mm = a[i]
                                .minimum
                                .upper_mm
                                .clone()
                                .min(b.minimum.upper_mm.clone());
                            a[i].maximum.lower_mm = a[i]
                                .maximum
                                .lower_mm
                                .clone()
                                .max(b.maximum.lower_mm.clone());
                            a[i].maximum.upper_mm = a[i]
                                .maximum
                                .upper_mm
                                .clone()
                                .max(b.maximum.upper_mm.clone());
                        }
                    }
                }
            }
        }
        Ok(FaceExtents {
            source_face: id,
            precision_mm: precision_mm.clone(),
            coordinates: coordinates.ok_or_else(|| Error::new("import/face-unbounded"))?,
        })
    }

    /// Tight extrema of the COMPLETE occupied analytic patch selected by an
    /// audited finite chart domain, with semantic item placements. Every
    /// coordinate min/max has an outer enclosure and a point witness; neither
    /// control polygons nor boundary-only extrema become measured bounds.
    /// The importing caller must establish this domain's correspondence to the
    /// retained STEP face before using this as that source face's measurement.
    pub fn face_chart_extents(
        &self,
        id: u32,
        domain: &FaceChartDomain,
        precision_mm: &Q,
    ) -> Result<FaceExtents> {
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
        let cache = curved_lift::TrigCache::default();
        let point = |uv: [Q; 2]| -> Result<[CoordinateBound; 3]> {
            let source =
                curved_lift::carrier_box(carrier, &self.unit_to_mm, &[uv.clone(), uv], &cache)?;
            let p = self.placed_coordinate_bounds(&source)?;
            if p.iter()
                .map(|b| (&b.upper_mm - &b.lower_mm) / q(2))
                .sum::<Q>()
                >= precision_mm / q(64)
            {
                return fail("import/carrier-point-proof-budget");
            }
            Ok(p)
        };
        let mut minima: Option<[Q; 3]> = None;
        let mut maxima: Option<[Q; 3]> = None;
        // These point witnesses accelerate the proof but cannot establish an
        // outer bound. Removing every one only makes the proof take longer.
        for a in 0..=4 {
            for b in 0..=4 {
                let uv = std::array::from_fn(|i| {
                    &domain.bounds[0][i]
                        + (&domain.bounds[1][i] - &domain.bounds[0][i])
                            * q(if i == 0 { a } else { b })
                            / q(4)
                });
                if !domain.contains(&uv)? {
                    continue;
                }
                let p = point(uv)?;
                match (&mut minima, &mut maxima) {
                    (Some(lo), Some(hi)) => {
                        for i in 0..3 {
                            lo[i] = lo[i].clone().min(p[i].upper_mm.clone());
                            hi[i] = hi[i].clone().max(p[i].lower_mm.clone());
                        }
                    }
                    _ => {
                        minima = Some(p.clone().map(|v| v.upper_mm));
                        maxima = Some(p.map(|v| v.lower_mm));
                    }
                }
            }
        }
        let mut todo = vec![(domain.bounds.clone(), 0usize)];
        let mut retired = Vec::<[CoordinateBound; 3]>::new();
        let mut work = 0;
        while let Some((cell, depth)) = todo.pop() {
            work += 1;
            if work > 262_144 {
                return fail("import/face-extents-work-budget");
            }
            let source = curved_lift::carrier_box(carrier, &self.unit_to_mm, &cell, &cache)?;
            let bounds = self.placed_coordinate_bounds(&source)?;
            if let (Some(a), Some(b)) = (&minima, &maxima) {
                if (0..3).all(|i| {
                    &a[i] - &bounds[i].lower_mm <= *precision_mm
                        && &bounds[i].upper_mm - &b[i] <= *precision_mm
                }) {
                    retired.push(bounds);
                    continue;
                }
            }
            if domain.membership(&cell)? == Some(false) {
                continue;
            }
            let mid: [Q; 2] = std::array::from_fn(|i| (&cell[0][i] + &cell[1][i]) / q(2));
            // A proved point witness suffices even when the whole rectangle
            // crosses a trim. Closed trim points belong to the occupied face.
            if domain.contains(&mid)? {
                let p = point(mid.clone())?;
                match (&mut minima, &mut maxima) {
                    (Some(a), Some(b)) => {
                        for i in 0..3 {
                            a[i] = a[i].clone().min(p[i].upper_mm.clone());
                            b[i] = b[i].clone().max(p[i].lower_mm.clone());
                        }
                    }
                    _ => {
                        minima = Some(p.clone().map(|v| v.upper_mm));
                        maxima = Some(p.map(|v| v.lower_mm));
                    }
                }
            }
            if let (Some(a), Some(b)) = (&minima, &maxima) {
                if (0..3).all(|i| {
                    &a[i] - &bounds[i].lower_mm <= *precision_mm
                        && &bounds[i].upper_mm - &b[i] <= *precision_mm
                }) {
                    retired.push(bounds);
                    continue;
                }
            }
            if depth >= 48 {
                return fail("import/face-extents-precision-unproved");
            }
            let k = usize::from(&cell[1][1] - &cell[0][1] > &cell[1][0] - &cell[0][0]);
            let mut lo = cell.clone();
            let mut hi = cell;
            lo[1][k] = mid[k].clone();
            hi[0][k] = mid[k].clone();
            todo.push((hi, depth + 1));
            todo.push((lo, depth + 1));
        }
        let (a, b) = minima
            .zip(maxima)
            .ok_or_else(|| Error::new("import/face-extents-no-interior-witness"))?;
        if retired.is_empty() {
            return fail("import/trim-domain-empty");
        }
        Ok(FaceExtents {
            source_face: id,
            precision_mm: precision_mm.clone(),
            coordinates: std::array::from_fn(|i| CoordinateExtrema {
                minimum: CoordinateBound {
                    lower_mm: retired.iter().map(|p| p[i].lower_mm.clone()).min().unwrap(),
                    upper_mm: a[i].clone(),
                },
                maximum: CoordinateBound {
                    lower_mm: b[i].clone(),
                    upper_mm: retired.iter().map(|p| p[i].upper_mm.clone()).max().unwrap(),
                },
            }),
        })
    }
}
