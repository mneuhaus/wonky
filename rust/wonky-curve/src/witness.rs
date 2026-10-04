//! A strict interior witness of an arrangement cell: an exact point that
//! lies inside the cell and on none of its boundary pieces.
//!
//! Construction (rational proposals with exact certification): `m` is the interior point of the first
//! piece of the cell's outer cycle. The cell lies on the left of every
//! half-edge of its cycles, so a ray from `m` along the coordinate axis
//! direction that is strictly to the left of the piece's tangent at `m`
//! enters the cell. The probe is that ray up to an exact far point beyond
//! every piece. The witness is the midpoint of `m` and the nearest point
//! where the probe meets a piece of the cell or one of the caller's
//! obstacles (other than `m` itself). The open segment between them meets no
//! piece of the cell, so the midpoint lies strictly inside it: pieces on the
//! probe's own line count with their ends, and a run of such pieces is
//! entered through a non-collinear piece at the run's nearer end.
//!
//! The consumer re-checks the witness exactly (winding and containment);
//! this construction only has to find one.
use crate::arrangement::Arrangement;
use crate::carrier::Carrier;
use crate::numeric::{q, P, Q};
use crate::point::ExactPoint;
use crate::refusal::{Refusal, R};
use crate::trimmed::Trimmed;
use num_traits::Zero;
use wonky_num::Scalar;

/// An exact bound of `|x_k - from|` over every point of the piece. A spline
/// piece refuses like every other arrangement operation on it (S6).
fn reach(piece: &Trimmed, k: usize, from: &Q) -> R<Q> {
    let end = |p: &ExactPoint| -> R<Q> { Ok(q((p.coordinates()[k].clone() - from).enclosure()?.abs().hi())) };
    let ends = end(&piece.ends()[0])?.max(end(&piece.ends()[1])?);
    match piece.carrier() {
        Carrier::Line => Ok(ends),
        // |x_k - c_k| <= r <= r2 + 1 anywhere on the circle.
        Carrier::Circle(c) => Ok(ends.max(q((c.c.coordinates()[k].clone() - from).enclosure()?.abs().hi()) + q(c.r2.enclosure()?.hi()) + q(1.))),
        Carrier::BSpline(_) => Err(Refusal::SplineArrangement),
    }
}

/// A rational within `width` of an exact coordinate. Initial observation
/// enclosures only propose a bracket; all refinement and acceptance are exact.
fn rational_near(x: &crate::radical::Radical, width: &Q) -> R<Q> {
    if let Some(q) = x.rational() {return Ok(q);}
    let iv = x.enclosure()?;
    let (mut lo, mut hi) = (q(iv.lo()), q(iv.hi()));
    for _ in 0..2048 {
        let middle = (&lo + &hi) / q(2.);
        if &hi - &lo <= *width {return Ok(middle);}
        match x.cmp(&crate::radical::Radical::from(middle.clone())) {
            std::cmp::Ordering::Less => hi = middle,
            std::cmp::Ordering::Greater => lo = middle,
            std::cmp::Ordering::Equal => return Ok(middle),
        }
    }
    Err(Refusal::RadicalBudget)
}

impl Arrangement {
    /// Quadratic boundary points need not have a rational point on the
    /// boundary itself. Propose rational points in its inward neighbourhood,
    /// then certify strict cell winding and absence of every obstacle. The
    /// coordinate error shrinks quadratically with the inward step; nothing
    /// accepts a point merely because it is close to the boundary.
    fn quadratic_witness(&self, cell: usize, m: &ExactPoint, k: usize, sign: &Q,
        pieces: &[Trimmed], points: &[ExactPoint]) -> R<ExactPoint> {
        crate::radical::guard(|| {
            let cycles: Vec<_> = self.cells[cell].cycles.iter().map(|c|self.cycle_profile(c)).collect();
            let own: Vec<_> = self.cells[cell].cycles.iter().flatten().map(|&h|&self.pieces[h/2].seg).collect();
            // Preserve the obstacle capability contract before any proposal.
            for piece in pieces {match piece.carrier() {
                Carrier::Line|Carrier::Circle(_) => {},
                Carrier::BSpline(_) => return Err(Refusal::SplineArrangement),
            }}
            let coordinates = m.coordinates();
            let mut delta = q(1.);
            for _ in 0..512 {
                let accuracy = &delta * &delta / q(16.);
                let mut p = [rational_near(&coordinates[0], &accuracy)?, rational_near(&coordinates[1], &accuracy)?];
                p[k] += sign * &delta;
                let p = ExactPoint::from_rational(p);
                let mut on = points.contains(&p);
                for piece in own.iter().copied().chain(pieces) {
                    if piece.contains(&p)? {on=true;break;}
                }
                if !on {
                    let mut winding = 0;
                    for cycle in &cycles {winding += cycle.winding(&p)?;}
                    if winding == 1 {return Ok(p);}
                }
                delta /= q(2.);
            }
            Err(Refusal::RadicalBudget)
        })?
    }
    /// An exact point strictly inside bounded cell `cell`, also off the
    /// caller's `pieces` and `points` (features inside the cell that must be
    /// avoided, such as pieces that split nothing and isolated contacts).
    /// Quadratic crossings bound the exact open witness interval; a rational
    /// proposal is then checked against that interval without rounded order.
    pub fn witness(&self, cell: usize, pieces: &[Trimmed], points: &[ExactPoint]) -> R<ExactPoint> {
        self.witness_impl(cell, pieces, points, false)
    }
    /// Exact rational interior proposals also for cells bounded by quadratic
    /// lines. Dark arithmetic admission: existing callers retain `witness`;
    /// G10 uses this method without changing any public geometry route.
    pub fn witness_exact(&self, cell: usize, pieces: &[Trimmed], points: &[ExactPoint]) -> R<ExactPoint> {
        self.witness_impl(cell, pieces, points, true)
    }
    fn witness_impl(&self, cell: usize, pieces: &[Trimmed], points: &[ExactPoint], quadratic: bool) -> R<ExactPoint> {
        let cycles = &self.cells[cell].cycles;
        let first = self.oriented(cycles[0][0]);
        let m = if quadratic { first.exact_interior_point()? } else { first.interior_point()? };
        // Tangent at m along the half-edge, from the sub-piece that starts at m.
        let tangent = first.trim(m.clone(), first.ends()[1].clone())?.tangent(true).0;
        // The axis direction strictly to the left of the tangent: (k, sign).
        let (k, sign): (usize, Q) = if tangent[0].is_positive() {
            (1, q(1.))
        } else if tangent[0].is_negative() {
            (1, q(-1.))
        } else if tangent[1].is_positive() {
            (0, q(-1.))
        } else {
            (0, q(1.))
        };
        let mut unit: P = [Q::zero(), Q::zero()];
        unit[k] = sign.clone();
        debug_assert!(crate::radical::cross(&tangent, &crate::radical::vector(&unit)).is_positive());
        match &m {
            ExactPoint::Rational(_) => {},
            ExactPoint::Quadratic(_) | ExactPoint::Algebraic(_) | ExactPoint::Real(_) => return self.quadratic_witness(cell, &m, k, &sign, pieces, points),
        }
        let own = cycles.iter().flatten().map(|&h| &self.pieces[h / 2].seg).collect::<Vec<_>>();
        let from = &m.rat()?[k];
        let mut far = q(1.);
        for s in own.iter().copied().chain(pieces) {
            far = far.max(reach(s, k, from)? + q(1.));
        }
        for p in points {
            far = far.max(q((p.coordinates()[k].clone() - from).enclosure()?.abs().hi()) + q(1.));
        }
        let mut end = m.rat()?.clone();
        end[k] = &end[k] + &sign * &far;
        let probe = Trimmed::new([m.clone(), ExactPoint::from_rational(end)], Carrier::Line)?;
        let mut hits = vec![];
        for s in own.iter().copied().chain(pieces) {
            if s.coincident_with(&probe)? {
                for e in s.ends() { if probe.contains(e)? { hits.push(e.clone()); } }
            } else {
                hits.extend(s.contacts(&probe)?);
            }
        }
        for p in points { if probe.contains(p)? { hits.push(p.clone()); } }
        hits.retain(|p| *p != m);
        // A probe from inside the cell's outer cycle to beyond every piece
        // leaves that cycle again; no hit means the cycle is not closed.
        let nearest = probe.sorted_cuts(hits)?.into_iter().next().ok_or(Refusal::FaceWalk)?;
        let (a, b) = (m.coordinates(), nearest.coordinates());
        let middle = (&a[k] + &b[k]) / q(2.);
        let mut p = m.rat()?.clone();
        // Rational cells need no export-resolution admission here: a strict
        // witness may lie between adjacent binary64 values. Only a genuinely
        // irrational midpoint needs a rounded proposal and exact certification.
        p[k] = match middle.rational() {
            Some(value) => value,
            None => q(middle.enclosure()?.m),
        };
        let p = ExactPoint::from_rational(p);
        if p == m || p == nearest || !probe.trim(m.clone(), nearest.clone())?.contains(&p)? { return Err(Refusal::SubResolutionFeature); }
        Ok(p)
    }
}

#[cfg(test)]
mod tests {
    use crate::arrangement::{arrange, arrange_pieces, Arrangement, Budget};
    use crate::cycle::Cycle;
    use crate::point::ExactPoint;
    use crate::refusal::Refusal;
    use crate::trimmed::fixtures::*;
    use crate::trimmed::Trimmed;

    const BUDGET: Budget = Budget { segments: 64, pieces: 256 };

    fn rect(x0: f64, y0: f64, x1: f64, y1: f64) -> Cycle {
        Cycle::polygon(&[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]).unwrap()
    }
    /// The witness is strictly inside its cell: on no piece, and the cell's
    /// cycles wind once around it.
    fn strictly_inside(arr: &Arrangement, k: usize, w: &ExactPoint) -> bool {
        let on = arr.pieces.iter().any(|pc| pc.seg.contains(w).unwrap());
        let winding: i32 = arr.cells[k].cycles.iter().map(|c| arr.cycle_profile(c).winding(w).unwrap()).sum();
        !on && winding == 1
    }

    #[test]
    fn rational_cells_between_adjacent_floats_keep_exact_witnesses() {
        for y in [1_f64, 1e12_f64] {
            let top = y.next_up();
            let arr = arrange(&[&rect(0., y, 1., top)], BUDGET).unwrap();
            assert_eq!(arr.cells.len(), 1);
            let w = arr.witness(0, &[], &[]).unwrap();
            let p = w.rat().unwrap();
            assert!(crate::numeric::q(y) < p[1] && p[1] < crate::numeric::q(top));
            assert!(strictly_inside(&arr, 0, &w));
        }
    }

    #[test]
    fn every_cell_of_nested_squares_gets_a_strict_witness() {
        let cycles = [rect(0., 0., 12., 12.), rect(2., 2., 10., 10.), rect(4., 4., 8., 8.)];
        let arr = arrange(&cycles.iter().collect::<Vec<_>>(), BUDGET).unwrap();
        assert_eq!(arr.cells.len(), 3);
        for k in 0..arr.cells.len() {
            let w = arr.witness(k, &[], &[]).unwrap();
            assert!(strictly_inside(&arr, k, &w), "cell {k}: {w:?}");
        }
    }

    #[test]
    fn a_probe_along_a_collinear_run_stops_at_the_runs_nearer_end() {
        // A notch: the probe from the bottom edge's midpoint (2, 0) goes up
        // x = 2, where the notch's left wall x = 2 runs from y = 1 to y = 3.
        let notch = Cycle::polygon(&[[0., 0.], [4., 0.], [4., 4.], [3., 4.], [3., 1.], [2., 1.], [2., 3.], [0., 3.]]).unwrap();
        let arr = arrange(&[&notch], BUDGET).unwrap();
        assert_eq!(arr.cells.len(), 1);
        let w = arr.witness(0, &[], &[]).unwrap();
        assert!(strictly_inside(&arr, 0, &w), "{w:?}");
    }

    #[test]
    fn obstacles_inside_the_cell_are_avoided() {
        // Whichever edge midpoint the probe starts from, it crosses the square
        // to the opposite midpoint, so the plain witness is the centre (2, 2).
        // The diagonal slit and the point obstacle both sit on it.
        let square = rect(0., 0., 4., 4.);
        let arr = arrange(&[&square], BUDGET).unwrap();
        let plain = arr.witness(0, &[], &[]).unwrap();
        assert_eq!(plain, p(2., 2.));
        let slit = [line([1., 1.], [3., 3.])];
        assert!(slit[0].contains(&plain).unwrap());
        for (pieces, points) in [(&slit[..], &[][..]), (&[][..], &[plain.clone()][..])] {
            let w = arr.witness(0, pieces, points).unwrap();
            assert!(strictly_inside(&arr, 0, &w), "{w:?}");
            assert!(w != plain && !slit[0].contains(&w).unwrap(), "{w:?}");
        }
    }

    #[test]
    fn a_slit_on_the_probes_line_stops_the_probe_at_its_nearer_end() {
        // A plus of two slits through the centre: every axis probe from an
        // edge midpoint runs along one slit and crosses the other at (2, 2).
        // Only the collinear slit's nearer end keeps the witness off it.
        let arr = arrange(&[&rect(0., 0., 4., 4.)], BUDGET).unwrap();
        let plus = [line([2., 1.], [2., 3.]), line([1., 2.], [3., 2.])];
        let w = arr.witness(0, &plus, &[]).unwrap();
        assert!(strictly_inside(&arr, 0, &w), "{w:?}");
        assert!(plus.iter().all(|s| !s.contains(&w).unwrap()), "{w:?}");
    }

    #[test]
    fn the_probe_reaches_past_an_arcs_bulge() {
        // A half disc of radius 5 listed chord first: the probe starts at the
        // chord's midpoint (0, 0) and goes up. The piece ends all lie on y = 0;
        // only the circle's radius bounds the reach to the top (0, 5).
        let chord = line([-5., 0.], [5., 0.]);
        let half = Cycle::new(vec![chord, arc([0., 0.], 25., [5., 0.], [-5., 0.], true)]);
        let arr = arrange(&[&half], BUDGET).unwrap();
        assert_eq!(arr.cells[0].cycles[0][0], 0, "the walk starts on the chord");
        let w = arr.witness(0, &[], &[]).unwrap();
        assert_eq!(w, ExactPoint::from_f64([0., 2.5]));
        assert!(strictly_inside(&arr, 0, &w));
    }

    #[test]
    fn open_section_pieces_split_a_square_into_cells_with_witnesses() {
        // A square cut by a chord from (0, 1) to (4, 3), given as an open
        // piece set next to the closed boundary cut at the chord's ends.
        let boundary = [
            line([0., 0.], [4., 0.]),
            line([4., 0.], [4., 3.]),
            line([4., 3.], [4., 4.]),
            line([4., 4.], [0., 4.]),
            line([0., 4.], [0., 1.]),
            line([0., 1.], [0., 0.]),
        ];
        let chord = [line([0., 1.], [4., 3.])];
        let arr = arrange_pieces(&[&boundary, &chord], BUDGET).unwrap();
        assert_eq!((arr.points.len(), arr.pieces.len(), arr.cells.len()), (6, 7, 2));
        for k in 0..2 {
            let w = arr.witness(k, &[], &[]).unwrap();
            assert!(strictly_inside(&arr, k, &w), "cell {k}: {w:?}");
        }
        // The chord is one piece owned by set 1 alone.
        let owners: Vec<_> = arr.pieces.iter().map(|pc| pc.owners.iter().map(|o| o.0).collect::<Vec<_>>()).collect();
        assert_eq!(owners.iter().filter(|o| **o == vec![1]).count(), 1);
    }

    #[test]
    fn arc_cells_get_rational_witnesses_even_when_the_probe_meets_another_circle() {
        let circle = |r: f64| {
            let pts = [[r, 0.], [0., r], [-r, 0.], [0., -r]];
            Cycle::new((0..4).map(|i| arc([0., 0.], r * r, pts[i], pts[(i + 1) % 4], true)).collect::<Vec<Trimmed>>())
        };
        // The interior point of a quarter arc of radius 5 is a 3-4-5 point, and
        // the axis probe from it meets the same circle again at its mirror
        // image: rational. With a square hole every cell has a witness.
        let disc = circle(5.);
        let arr = arrange(&[&disc, &rect(-1., -1., 1., 1.)], BUDGET).unwrap();
        assert_eq!(arr.cells.len(), 2);
        for k in 0..2 {
            let w = arr.witness(k, &[], &[]).unwrap();
            assert!(strictly_inside(&arr, k, &w), "cell {k}: {w:?}");
        }
        // A circular hole of radius 4: the probe x = +-3 or y = +-3 from the
        // outer arc meets it at +-sqrt(7). Both cells still get rational
        // witnesses, certified off every boundary by exact winding.
        let arr = arrange(&[&disc, &circle(4.)], BUDGET).unwrap();
        let ring = arr.cells.iter().position(|c| c.cycles.len() == 2).unwrap();
        let w = arr.witness(ring, &[], &[]).unwrap();
        assert!(w.rat().is_ok());
        assert!(strictly_inside(&arr, ring, &w), "{w:?}");
        assert!(disc.contains(&w).unwrap());
        assert!(!circle(4.).contains(&w).unwrap());
        let w = arr.witness(1 - ring, &[], &[]).unwrap();
        assert!(strictly_inside(&arr, 1 - ring, &w), "{w:?}");
    }

    #[test]
    fn a_spline_obstacle_refuses_by_name() {
        // The arrangement refuses spline sources up front (S6); a spline
        // among the caller's obstacles refuses the same way.
        let arr = arrange(&[&rect(0., 0., 4., 4.)], BUDGET).unwrap();
        let spline = crate::bspline::BSpline::bezier_f64(&[[1., 1.], [2., 3.], [3., 1.]]).unwrap();
        let (a, b) = (spline.domain().0.clone(), spline.domain().1.clone());
        let piece = Trimmed::spline(std::sync::Arc::new(spline), a, b).unwrap();
        assert_eq!(arr.witness(0, &[piece], &[]).unwrap_err(), Refusal::SplineArrangement);
    }
}
