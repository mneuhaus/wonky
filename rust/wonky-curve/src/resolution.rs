//! Sufficient feature-size certificate for quadratic line/circle contacts before
//! exporting a solid. The floor is supplied by the solid's source, STEP and
//! reader budgets, in the same units as its chart. This never merges geometry:
//! an unresolved clearance or a feature below the floor refuses by name.
use crate::numeric::{dot, q, sub};
use crate::radical::{self as rad, Radical};
use crate::{Arrangement, Carrier, Cycle, ExactPoint, Refusal, Trimmed, R};
use num_traits::Zero;
use wonky_num::Scalar;

fn above(value: wonky_num::Iv, floor: f64) -> R<()> {
    if value.lo() > floor {
        Ok(())
    } else {
        Err(Refusal::SubResolutionFeature)
    }
}
fn separated(a: &ExactPoint, b: &ExactPoint, floor: f64) -> R<()> {
    above(rad::norm(&a.difference(b))?, floor)
}
fn stationary(a: &Trimmed, b: &Trimmed, p: ExactPoint, t: ExactPoint, floor: f64) -> R<()> {
    if a.contains(&p)? && b.contains(&t)? && p != t {
        separated(&p, &t, floor)?;
    }
    Ok(())
}
fn line_circle(line: &Trimmed, arc: &Trimmed, c: &crate::Circle, floor: f64) -> R<()> {
    let (o, d) = match line.rational_line() {
        Ok(carrier) => carrier,
        Err(Refusal::CrossingNeedsAlgebraicVertex) => return quadratic_line_circle(line,arc,c,floor),
        Err(e) => return Err(e),
    };
    // A centre in a quadratic field: the radical form decides the same gap.
    let Ok(centre) = c.c.rat() else { return quadratic_line_circle(line, arc, c, floor) };
    let d2 = dot(&d, &d);
    let t = dot(&sub(centre, &o), &d) / &d2;
    let foot = ExactPoint::from_rational([&o[0] + &t * &d[0], &o[1] + &t * &d[1]]);
    let normal = [-&d[1], d[0].clone()];
    for sign in [q(-1.), q(1.)] {
        let root = (&c.r2 / &d2).exact_sqrt()?;
        let p = ExactPoint::from_coordinates(std::array::from_fn(|k| Radical::from(centre[k].clone()) + &root * &normal[k] * &sign))?;
        stationary(line, arc, foot.clone(), p, floor)?;
    }
    Ok(())
}
fn quadratic_line_circle(line: &Trimmed, arc: &Trimmed, c: &crate::Circle, floor: f64) -> R<()> {
    let d = line.ends()[1].difference(&line.ends()[0]);
    let rel = line.ends()[0].difference(&c.c);
    let t = -rad::dot(&rel,&d) / rad::dot(&d,&d);
    if t.is_negative() || t > Radical::from(q(1.)) { return Ok(()); }
    let foot = std::array::from_fn(|k| &rel[k] + &t * &d[k]);
    let normal = [-&d[1],d[0].clone()];
    for sign in [q(-1.),q(1.)] {
        let direction = normal.clone().map(|v| v * &sign);
        if c.angular_radical(arc.ends(),&direction,false) {
            // Membership is an exact direction predicate. The certified gap
            // does not need a stored stationary vertex in a wider field.
            let distance = rad::norm(&foot)?;
            let projection = rad::dot(&foot,&direction);
            if projection.is_positive() && line.ends().iter().any(|p|
                arc.ends().contains(p) && p.difference(&c.c) == foot
            ) { continue; }
            let gap = if projection.is_negative() {
                distance + c.radius()?
            } else {
                (distance - c.radius()?).abs()
            };
            above(gap,floor)?;
        }
    }
    Ok(())
}
fn circle_circle(a: &Trimmed, b: &Trimmed, c: &crate::Circle, k: &crate::Circle, floor: f64) -> R<()> {
    let (cc, kc) = (c.c.rat()?, k.c.rat()?);
    let d = sub(kc, cc);
    let d2 = dot(&d, &d);
    if d2.is_zero() {
        // Equal carriers were merged/split by the arrangement; adjacent pieces
        // on one carrier do not impose a fictitious zero-thickness feature.
        if c.r2 == k.r2 {
            return Ok(());
        }
        let directions = a
            .ends()
            .iter()
            .map(|p| p.difference(&c.c))
            .chain(b.ends().iter().map(|p| p.difference(&k.c)));
        if directions
            .into_iter()
            .any(|v| c.angular_radical(a.ends(), &v, false) && k.angular_radical(b.ends(), &v, false))
        {
            let ra = c.r2.exact_sqrt()?;
            let rb = k.r2.exact_sqrt()?;
            above((ra - rb).abs().enclosure()?, floor)?;
        }
        return Ok(());
    }
    for s in [q(-1.), q(1.)] {
        let root=(&c.r2 / &d2).exact_sqrt()?;
        let p=ExactPoint::from_coordinates(std::array::from_fn(|i| Radical::from(cc[i].clone()) + &root * &d[i] * &s))?;
        for t in [q(-1.), q(1.)] {
            let root=(&k.r2 / &d2).exact_sqrt()?;
            let v=ExactPoint::from_coordinates(std::array::from_fn(|i| Radical::from(kc[i].clone()) + &root * &d[i] * &t))?;
            stationary(a, b, p.clone(), v, floor)?;
        }
    }
    Ok(())
}

/// Spline source regularity and rational contacts retain their existing
/// consumer-owned admission. New quadratic pieces must additionally be
/// isolated from every spline by outward curve bounds. This is a sufficient
/// exact separation certificate, never a polygonal replacement; overlapping
/// bounds remain a named refusal.
fn spline_quadratic_separation(a: &Trimmed, b: &Trimmed, floor: f64) -> R<()> {
    let rational = |p: &Trimmed| p.ends().iter().all(|e| e.rat().is_ok());
    if rational(a) && rational(b) {
        return Ok(());
    }
    let (aa, bb) = (a.bounds()?, b.bounds()?);
    let gap = (0..2).map(|k| {
        let forward = wonky_num::Iv::point(bb[0][k]) - wonky_num::Iv::point(aa[1][k]);
        let backward = wonky_num::Iv::point(aa[0][k]) - wonky_num::Iv::point(bb[1][k]);
        forward.lo().max(backward.lo())
    }).fold(f64::NEG_INFINITY, f64::max);
    if gap > floor { Ok(()) } else { Err(Refusal::SplineArrangement) }
}

// Bound the quadratic certificate workload separately from source splitting.
// One pair permits at most four endpoint and four stationary clearance checks.
const PAIR_BUDGET: usize = 1 << 20;
fn certify(points: &[ExactPoint], pieces: &[&Trimmed], floor: f64) -> R<()> {
    if !floor.is_finite() || floor <= 0. {
        return Err(Refusal::NumericRange);
    }
    let pairs = |n: usize| n.checked_mul(n.saturating_sub(1)).map(|p| p / 2);
    if pairs(points.len())
        .and_then(|n| pairs(pieces.len()).and_then(|m| n.checked_add(m)))
        .is_none_or(|n| n > PAIR_BUDGET)
    {
        return Err(Refusal::ResolutionBudget);
    }
    for (i, p) in points.iter().enumerate() {
        for other in &points[i + 1..] {
            if p != other {
                separated(p, other, floor)?;
            }
        }
    }
    for (i, a) in pieces.iter().enumerate() {
        above(a.length()?, floor)?;
        if let Carrier::Circle(c) = a.carrier() {
            above(c.radius()?, floor)?;
        }
        for b in &pieces[i + 1..] {
            if matches!(a.carrier(), Carrier::BSpline(_)) || matches!(b.carrier(), Carrier::BSpline(_)) {
                spline_quadratic_separation(a, b, floor)?;
                continue;
            }
            for (from, to) in [(a, b), (b, a)] {
                for p in from.ends() {
                    if !to.ends().contains(p) {
                        above(to.distance(p)?, floor)?;
                    }
                }
            }
            match (a.carrier(), b.carrier()) {
                (Carrier::Line, Carrier::Line) => {}
                (Carrier::Line, Carrier::Circle(c)) => line_circle(a, b, c, floor)?,
                (Carrier::Circle(c), Carrier::Line) => line_circle(b, a, c, floor)?,
                (Carrier::Circle(c), Carrier::Circle(k)) => circle_circle(a, b, c, k, floor)?,
                (Carrier::BSpline(_), _) | (_, Carrier::BSpline(_)) => unreachable!("spline pairs certified above"),
            }
        }
    }
    Ok(())
}
impl Arrangement {
    /// Check distinct vertex separation, edge extent, endpoint-to-piece gaps,
    /// and all interior stationary clearances. A shortest gap between two
    /// trimmed lines/circles is at an endpoint or at one of these stationary
    /// pairs. Shared endpoints are exact contacts, not thin features. This is
    /// conservative over the whole arrangement (including unused cells).
    pub fn certify_resolution(&self, floor: f64) -> R<()> {
        rad::guard(|| certify(&self.points, &self.pieces.iter().map(|p| &p.seg).collect::<Vec<_>>(), floor))?
    }
}
impl Cycle {
    /// The same pre-export admission contract for an extruded selected cycle.
    pub fn certify_resolution(&self, floor: f64) -> R<()> {
        let points = self.pieces().iter().map(|p| p.ends()[0].clone()).collect::<Vec<_>>();
        rad::guard(|| certify(&points, &self.pieces().iter().collect::<Vec<_>>(), floor))?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn quadratic_tangent_support_keeps_shared_contact_and_checks_other_clearances() {
        let source = Trimmed::arc_through([1.,-1.],[1.,1.],[-1.,1.]).unwrap();
        let shared = ExactPoint::from_quadratic([q(0.),q(0.)],[q(0.),q(1.)],q(2.)).unwrap();
        let other = ExactPoint::from_quadratic([q(-1.),q(0.)],[q(0.),q(1.)],q(2.)).unwrap();
        let arc = source.trim(ExactPoint::from_f64([1.,1.]),shared.clone()).unwrap();
        let line = Trimmed::new([shared,other],Carrier::Line).unwrap();
        let Carrier::Circle(c) = arc.carrier() else { panic!("not a circle") };
        assert!(line.rational_line().is_err());
        assert_eq!(line_circle(&line,&arc,c,1e-10),Ok(()));
    }
    #[test]
    fn quadratic_pieces_need_certified_separation_from_owned_spline_sources() {
        let spline = std::sync::Arc::new(crate::bspline::BSpline::bezier_f64(&[[0., 4.], [2., 6.], [4., 4.]]).unwrap());
        let spline = Trimmed::spline(spline, q(0.), q(1.)).unwrap();
        let line = |y: f64| Trimmed::new([
            ExactPoint::from_quadratic([q(0.), q(y)], [q(1.), q(0.)], q(2.)).unwrap(),
            ExactPoint::from_quadratic([q(1.), q(y)], [q(1.), q(0.)], q(2.)).unwrap(),
        ], Carrier::Line).unwrap();
        assert_eq!(spline_quadratic_separation(&spline, &line(0.), 1.), Ok(()));
        assert_eq!(spline_quadratic_separation(&spline, &line(0.), 4.), Err(Refusal::SplineArrangement));
        assert_eq!(spline_quadratic_separation(&spline, &line(4.), 1e-10), Err(Refusal::SplineArrangement));
        assert_eq!(spline_quadratic_separation(&line(4.), &spline, 1e-10), Err(Refusal::SplineArrangement));
    }
    #[test]
    fn large_valid_cycle_refuses_before_quadratic_clearance_work() {
        let points = (0..2048)
            .map(|i| {
                let x = i as f64;
                [x, x * x]
            })
            .collect::<Vec<_>>();
        let cycle = Cycle::polygon(&points).unwrap();
        assert_eq!(cycle.certify_resolution(1e-10), Err(Refusal::ResolutionBudget));
    }
}
