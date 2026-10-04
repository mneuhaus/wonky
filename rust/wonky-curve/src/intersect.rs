//! Carrier-pair intersection. Candidates stay in Q(sqrt(r)) while they are
//! classified against both finite trims, then become exact rational or
//! quadratic point keys. No rounded root decides membership or topology.
//! Spline contacts that need a wider algebraic vertex still refuse (S15).
use crate::carrier::{Carrier, Circle};
use crate::numeric::{dot, q, sub, P};
#[cfg(test)]
use crate::numeric::Q;
use crate::point::ExactPoint;
use crate::refusal::{Refusal, R};
use crate::trimmed::Trimmed;
use num_traits::Zero;
#[cfg(test)]
use num_traits::Signed;
#[cfg(test)]
use std::cmp::Ordering::{self, Equal, Greater};

/// Sign of a + b*sqrt(r), for r >= 0. Squaring is valid ONLY after opposing
/// signs are established; square and dependent radicands need no factoring.
#[cfg(test)]
pub(crate) fn sign(a: &Q, b: &Q, r: &Q) -> Ordering {
    debug_assert!(!r.is_negative());
    let sa = a.cmp(&Q::zero());
    if r.is_zero() || b.is_zero() {
        return sa;
    }
    let sb = b.cmp(&Q::zero());
    if sa == Equal {
        return sb;
    }
    if sa == sb {
        return sa;
    }
    let squared = (a * a).cmp(&(b * b * r));
    if sa == Greater {
        squared
    } else {
        squared.reverse()
    }
}

/// A candidate point base + offset * sqrt(radicand) on a supporting curve.
pub(crate) struct Candidate {
    pub base: crate::radical::V,
    pub offset: P,
    pub radicand: crate::radical::Radical,
}

impl Candidate {
    pub(crate) fn point(&self) -> R<ExactPoint> {
        { let root = self.radicand.exact_sqrt()?;
        Ok(ExactPoint::from_radical(std::array::from_fn(|k| &self.base[k] + &root * &self.offset[k]))) }
    }
    pub(crate) fn equals(&self, p: &ExactPoint) -> R<bool> {
        Ok(self.point()? == *p)
    }
    pub(crate) fn on_arc(&self, ends: &[ExactPoint; 2], c: &Circle) -> R<bool> {
        Ok(c.angular_radical(ends, &self.point()?.difference(&c.c), false))
    }
    fn shared_endpoint(&self, a: &Trimmed, b: &Trimmed) -> R<bool> {
        for p in a.ends() {
            if b.ends().contains(p) && self.equals(p)? { return Ok(true); }
        }
        Ok(false)
    }
    /// The exact quadratic point; no rounded intersection is ever stored.
    fn extract(self) -> R<ExactPoint> { self.point() }
}

fn line_arc_candidates(line: &Trimmed, arc: &Trimmed, c: &Circle) -> R<Vec<Candidate>> {
    let mut out = vec![];
    let (start, d) = line.rational_line()?;
    let a = sub(&start, c.c.rat()?);
    let dd = dot(&d, &d); // Sources reject zero-length lines first.
    let ad = dot(&a, &d);
    let fa = dot(&a, &a) - &c.r2;
    let discriminant = crate::radical::Radical::from(&ad * &ad) - fa * &dd;
    if discriminant.is_negative() {
        return Ok(out);
    }
    // t = centre +/- sqrt(radicand), along start + t*d.
    let centre = -ad / &dd;
    let radicand = discriminant / (&dd * &dd);
    for branch in [-1., 1.] {
        let branch = q(branch);
        let p = Candidate {
            base: crate::radical::vector(&[&start[0] + &centre * &d[0], &start[1] + &centre * &d[1]]),
            offset: [&branch * &d[0], &branch * &d[1]],
            radicand: radicand.clone(),
        };
        if p.on_arc(arc.ends(), c)? && on_line(&p.point()?, line) {
            out.push(p);
        }
        if radicand.is_zero() {
            break;
        }
    }
    Ok(out)
}

// Coincident supporting circles are handled by the caller's overlap test.
fn arc_arc_candidates(a: &Trimmed, c: &Circle, b: &Trimmed, d: &Circle) -> R<Vec<Candidate>> {
    let mut out = vec![];
    let (cc, dc) = (c.c.rat()?, d.c.rat()?);
    let delta = sub(dc, cc);
    let dd = dot(&delta, &delta);
    if dd.is_zero() {
        return Ok(out); // Distinct concentric circles.
    }
    // Subtract the circle equations: the common chord is perpendicular to
    // delta at c + t*delta. Its endpoints are base +/- perp(delta)*sqrt(r).
    let t = (crate::radical::Radical::from(dd.clone()) + &c.r2 - &d.r2) / (q(2.) * &dd);
    let radicand = &c.r2 / &dd - &t * &t;
    if radicand.is_negative() {
        return Ok(out);
    }
    let base = [crate::radical::Radical::from(cc[0].clone()) + &t * &delta[0], crate::radical::Radical::from(cc[1].clone()) + &t * &delta[1]];
    for branch in [-1., 1.] {
        let branch = q(branch);
        let p = Candidate {
            base: base.clone(),
            offset: [-&branch * &delta[1], &branch * &delta[0]],
            radicand: radicand.clone(),
        };
        if p.on_arc(a.ends(), c)? && p.on_arc(b.ends(), d)? {
            out.push(p);
        }
        if radicand.is_zero() {
            break;
        }
    }
    Ok(out)
}

fn on_line(p: &ExactPoint, s: &Trimmed) -> bool {
    use crate::radical::{cross, dot};
    let d = s.ends()[1].difference(&s.ends()[0]);
    let v = p.difference(&s.ends()[0]);
    cross(&d, &v).is_zero() && !dot(&v, &d).is_negative()
        && !dot(&p.difference(&s.ends()[1]), &d).is_positive()
}

/// A quadratic-ended line can have a genuinely quadratic supporting carrier,
/// as with a chamfer chord, and a rolling-ball arc a quadratic centre. Solve
/// the circle equation in the exact field. Known carrier endpoints deflate a
/// root before any square-root extension.
fn line_arc_points(line: &Trimmed, arc: &Trimmed, circle: &Circle) -> R<Vec<ExactPoint>> {
    match line.rational_line() {
        Ok(_) if circle.c.rat().is_ok() => {
            return line_arc_candidates(line, arc, circle)?.into_iter().map(Candidate::extract).collect()
        }
        Ok(_) | Err(Refusal::CrossingNeedsAlgebraicVertex) => {},
        Err(e) => return Err(e),
    }
    use crate::radical::{dot, Radical};
    let start = line.ends()[0].coordinates();
    let d = line.ends()[1].difference(&line.ends()[0]);
    let a = line.ends()[0].difference(&circle.c);
    let aa = dot(&d, &d);
    if aa.is_zero() { return Err(Refusal::EdgeLengthRange); }
    let ab = dot(&a, &d);
    let c = dot(&a, &a) - &circle.r2;
    let f1 = &aa + &ab * q(2.) + &c;
    let zero = Radical::from(q(0.));
    let one = Radical::from(q(1.));
    let vertex = -&ab / &aa;
    let disc = &ab * &ab - &aa * &c;
    // Prove no roots in the finite segment before extending a field.
    if (c.is_negative() && f1.is_negative())
        || (c.is_positive() && f1.is_positive()
            && (vertex <= zero || vertex >= one || disc.is_negative())) {
        return Ok(vec![]);
    }
    let parameters = if c.is_zero() {
        vec![zero, -&ab * q(2.) / &aa]
    } else if f1.is_zero() {
        vec![one.clone(), -&ab * q(2.) / &aa - one]
    } else if disc.is_negative() {
        vec![]
    } else {
        let root = disc.exact_sqrt()?;
        vec![(-&ab - &root) / &aa, (-&ab + &root) / &aa]
    };
    let mut out = vec![];
    for t in parameters {
        if t < Radical::from(q(0.)) || t > Radical::from(q(1.)) { continue; }
        let coordinates = std::array::from_fn(|k| &start[k] + &d[k] * &t);
        let radial = crate::radical::sub(&coordinates,&circle.c.coordinates());
        if circle.angular_radical(arc.ends(), &radial, false) {
            out.push(ExactPoint::from_exact_coordinates(coordinates)?);
        }
    }
    out.sort(); out.dedup();
    Ok(out)
}

/// Simple-chain admission of two pieces that are neighbours or disjoint: they
/// may touch only at a shared end. Every candidate is tested against BOTH
/// finite trims. Two lines are checked elsewhere (exact segment intersection).
pub(crate) fn admit(a: &Trimmed, b: &Trimmed) -> R<()> {
    match (a.carrier(), b.carrier()) {
        (Carrier::Line, Carrier::Line) => Ok(()),
        (Carrier::BSpline(_), Carrier::Line | Carrier::Circle(_) | Carrier::BSpline(_))
        | (Carrier::Line | Carrier::Circle(_), Carrier::BSpline(_)) => {
            if crate::contact::of(a, b)?.iter().all(crate::contact::Contact::is_shared_end) {
                Ok(())
            } else {
                Err(Refusal::SplineIntersection)
            }
        }
        (Carrier::Line, Carrier::Circle(c)) => admit_line_arc(a, b, c),
        (Carrier::Circle(c), Carrier::Line) => admit_line_arc(b, a, c),
        (Carrier::Circle(c), Carrier::Circle(d)) => {
            if c.c == d.c && c.r2 == d.r2 {
                if overlaps(a, c, b, d)? {
                    return Err(Refusal::OverlappingArcs);
                }
            } else {
                for p in arc_arc_candidates(a, c, b, d)? {
                    if !p.shared_endpoint(a, b)? { return Err(Refusal::ArcArcIntersection); }
                }
            }
            Ok(())
        }
    }
}
fn admit_line_arc(line: &Trimmed, arc: &Trimmed, c: &Circle) -> R<()> {
    for p in line_arc_points(line, arc, c)? {
        if !line.ends().contains(&p) || !arc.ends().contains(&p) { return Err(Refusal::LineArcIntersection); }
    }
    Ok(())
}

/// Two pieces on one circle share more than end points.
fn overlaps(a: &Trimmed, c: &Circle, b: &Trimmed, d: &Circle) -> R<bool> {
    // The anchor belongs to the carrier, not every trim. Strict endpoint
    // membership detects partial overlap; coincident endpoint pairs then
    // distinguish equal arcs from the two complementary arcs exactly.
    Ok(c.full || d.full
        || a.ends().iter().any(|p| d.angular_radical(b.ends(), &p.difference(&d.c), true))
        || b.ends().iter().any(|p| c.angular_radical(a.ends(), &p.difference(&c.c), true))
        || if c.ccw == d.ccw { a.ends() == b.ends() }
           else { a.ends()[0] == b.ends()[1] && a.ends()[1] == b.ends()[0] })
}

/// All contact points of two pieces, each on both finite trims. Refuses when a
/// spline contact needs a wider algebraic vertex or the pieces overlap.
pub(crate) fn contacts(a: &Trimmed, b: &Trimmed) -> R<Vec<ExactPoint>> {
    match (a.carrier(), b.carrier()) {
        (Carrier::BSpline(_), Carrier::Line | Carrier::Circle(_) | Carrier::BSpline(_))
        | (Carrier::Line | Carrier::Circle(_), Carrier::BSpline(_)) => {
            // Rational vertices only: a spline pair meets at the known ends
            // (deflated); any contact found by isolation needs a vertex this
            // arrangement does not store yet, rational or not.
            let report = crate::contact::of(a, b)?;
            if report.iter().any(|c| matches!(c.kind, crate::contact::ContactKind::Inner { .. })) {
                return Err(Refusal::CrossingNeedsAlgebraicVertex);
            }
            Ok(report.into_iter().map(|c| c.point).collect())
        }
        (Carrier::Line, Carrier::Circle(c)) => line_arc_points(a, b, c),
        (Carrier::Circle(c), Carrier::Line) => line_arc_points(b, a, c),
        (Carrier::Circle(c), Carrier::Circle(d)) if c.c != d.c || c.r2 != d.r2 => {
            arc_arc_candidates(a, c, b, d)?
                .into_iter()
                .map(Candidate::extract)
                .collect()
        }
        (Carrier::Circle(c), Carrier::Circle(d)) => {
            if overlaps(a, c, b, d)? {
                return Err(Refusal::OverlappingArcs);
            }
            Ok(a.ends()
                .iter()
                .filter(|p| b.ends().contains(p))
                .cloned()
                .collect())
        }
        (Carrier::Line, Carrier::Line) => {
            let (ae, be) = (a.ends(), b.ends());
            use crate::radical::{cross, sub};
            let p0 = ae[0].coordinates();
            let p1 = be[0].coordinates();
            let u = ae[1].difference(&ae[0]);
            let v = be[1].difference(&be[0]);
            let d = sub(&p1, &p0);
            let den = cross(&u, &v);
            if den.is_zero() {
                let mut common = ae.iter().chain(be)
                    .filter(|p| on_line(p, a) && on_line(p, b)).cloned().collect::<Vec<_>>();
                common.sort(); common.dedup();
                if common.len() > 1 { return Err(Refusal::OverlappingLines); }
                return Ok(common);
            }
            let t = cross(&d, &v) / &den;
            // Membership is decided in the field before vertex admission.
            // Out-of-trim intersections need no wider stored vertex.
            let s = cross(&d, &u) / &den;
            if t.is_negative() || t > crate::radical::Radical::from(q(1.))
                || s.is_negative() || s > crate::radical::Radical::from(q(1.)) { return Ok(vec![]); }
            let p = ExactPoint::from_exact_coordinates(std::array::from_fn(|k| &p0[k] + &t * &u[k]))?;
            Ok(if on_line(&p, a) && on_line(&p, b) { vec![p] } else { vec![] })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cmp::Ordering::Less;
    use crate::point::ExactPoint;

    /// The rolling-ball section between irrational-length normals: centre
    /// (0, sqrt 2), radius 1, the upper half from (1, sqrt 2) to (-1, sqrt 2).
    fn radical_centre_arc() -> Trimmed {
        let at = |x: f64| ExactPoint::from_quadratic([q(x), q(0.)], [q(0.), q(1.)], q(2.)).unwrap();
        let centre = at(0.);
        Trimmed::ring_about(centre, q(1.), at(1.), true).unwrap().trim(at(1.), at(-1.)).unwrap()
    }

    #[test]
    fn radical_centre_arcs_meet_rational_lines_in_the_centre_field() {
        let arc = radical_centre_arc();
        let Carrier::Circle(c) = arc.carrier() else { panic!("circle required") };
        assert!(c.c.rat().is_err() && c.mid.rat().is_err());
        assert!((c.angle.m - std::f64::consts::PI).abs() < 1e-12);
        // Interior witness: exact, on the circle and strictly inside the trim.
        let w = arc.interior_point().unwrap();
        let v = w.difference(&c.c);
        assert_eq!(crate::radical::dot(&v, &v), crate::radical::Radical::from(q(1.)));
        assert!(c.angular_radical(arc.ends(), &v, true));
        // The axis x = 0 meets the full circle at (0, sqrt 2 +- 1); only the
        // upper point is on the trim, and it is decided exactly.
        let axis = Trimmed::new([ExactPoint::from_f64([0., 0.]), ExactPoint::from_f64([0., 3.])], Carrier::Line).unwrap();
        let top = ExactPoint::from_quadratic([q(0.), q(1.)], [q(0.), q(1.)], q(2.)).unwrap();
        assert_eq!(axis.contacts(&arc).unwrap(), vec![top.clone()]);
        assert_eq!(arc.contacts(&axis).unwrap(), vec![top]);
        assert_eq!(axis.admit(&arc), Err(Refusal::LineArcIntersection));
        // A rational line above the arc (y = 5/2 > 1 + sqrt 2) misses it.
        let above = Trimmed::new([ExactPoint::from_f64([-2., 2.5]), ExactPoint::from_f64([2., 2.5])], Carrier::Line).unwrap();
        assert!(above.contacts(&arc).unwrap().is_empty());
        assert_eq!(above.admit(&arc), Ok(()));
        // y = 2.4 < 1 + sqrt 2 = 2.41421...: two crossings in a nested field
        // (x = +-sqrt(1 - (y - sqrt 2)^2)), kept exact in a bounded quadratic
        // tower (K1), never rounded.
        let close = Trimmed::new([ExactPoint::from_f64([-2., 2.4]), ExactPoint::from_f64([2., 2.4])], Carrier::Line).unwrap();
        let crossings = close.contacts(&arc).unwrap();
        assert_eq!(crossings.len(), 2);
        for p in &crossings {
            let v = p.difference(&c.c);
            assert!(p.rat().is_err());
            assert_eq!(crate::radical::dot(&v, &v), crate::radical::Radical::from(q(1.)));
            assert_eq!(p.coordinates()[1], close.ends()[0].coordinates()[1]);
            assert!(c.angular_radical(arc.ends(), &v, false));
        }
        // Disc clearance in the field: the disc of radius 1/2 about the origin
        // is clear of the arc, the one of radius 3 is not.
        assert!(arc.clears_disc(&[q(0.), q(0.)], &q(0.25)).unwrap());
        assert!(!arc.clears_disc(&[q(0.), q(0.)], &q(9.)).unwrap());
    }

    #[test]
    fn quadratic_supporting_lines_deflate_exact_circle_contacts() {
        let ring = Trimmed::ring([q(0.),q(0.)],q(1.),ExactPoint::from_f64([1.,0.]),true).unwrap();
        let on = ExactPoint::from_quadratic([q(0.),q(0.)],[q(0.5),q(0.5)],q(2.)).unwrap();
        let outside = ExactPoint::from_f64([2.,0.]);
        let line = Trimmed::new([on.clone(),outside],Carrier::Line).unwrap();
        assert!(line.rational_line().is_err());
        assert_eq!(line.contacts(&ring).unwrap(),vec![on.clone()]);
        assert_eq!(line.reversed().contacts(&ring).unwrap(),vec![on.clone()]);
        let inside = Trimmed::new([on.clone(),ExactPoint::from_f64([0.,0.])],Carrier::Line).unwrap();
        assert_eq!(inside.contacts(&ring).unwrap(),vec![on.clone()]);
        let crossing = Trimmed::new([on.clone(),ExactPoint::from_f64([-2.,0.])],Carrier::Line).unwrap();
        let points = crossing.contacts(&ring).unwrap();
        assert_eq!(points.len(),2);
        assert!(points.contains(&on));
        for point in points { assert!(crossing.contains(&point).unwrap()); assert!(ring.contains(&point).unwrap()); }
        let far = Trimmed::new([
            ExactPoint::from_quadratic([q(3.),q(0.)],[q(0.5),q(0.5)],q(2.)).unwrap(),
            ExactPoint::from_f64([3.,0.]),
        ],Carrier::Line).unwrap();
        assert!(far.contacts(&ring).unwrap().is_empty());
    }

    #[test]
    fn sign_of_a_plus_b_root_r_covers_every_sign_pattern() {
        let r = q(2.);
        assert_eq!(sign(&q(1.), &q(1.), &r), Greater);
        assert_eq!(sign(&q(-1.), &q(-1.), &r), Less);
        assert_eq!(sign(&q(0.), &q(-3.), &r), Less);
        assert_eq!(sign(&q(3.), &q(0.), &r), Greater);
        assert_eq!(sign(&q(-3.), &q(2.), &r), Less); // -3 + 2.828
        assert_eq!(sign(&q(-2.), &q(2.), &r), Greater); // -2 + 2.828
        assert_eq!(sign(&q(3.), &q(-2.), &r), Greater); // 3 - 2.828
        assert_eq!(sign(&q(2.), &q(-2.), &r), Less); // 2 - 2.828
        assert_eq!(sign(&q(-2.), &q(1.), &q(4.)), Equal); // -2 + 2
        assert_eq!(sign(&q(0.), &q(5.), &q(0.)), Equal);
    }
    #[test]
    fn candidate_equality_uses_the_radical_exactly() {
        let c = Candidate { base: crate::radical::vector(&[q(1.), q(0.)]), offset: [q(1.), q(0.)], radicand: q(4.).into() };
        assert!(c.equals(&ExactPoint::from_f64([3., 0.])).unwrap());
        assert!(!c.equals(&ExactPoint::from_f64([3., 1.])).unwrap());
    }
    #[test]
    fn coincident_circle_contacts_ignore_traversal_sense() {
        let a = Trimmed::arc_through([5., 0.], [3., 4.], [0., 5.]).unwrap();
        let disjoint = Trimmed::arc_through([0., -5.], [-3., -4.], [-5., 0.]).unwrap();
        let touching = Trimmed::arc_through([-5., 0.], [-3., 4.], [0., 5.]).unwrap();
        let overlapping = Trimmed::arc_through([0., 5.], [4., 3.], [5., 0.]).unwrap();
        for a in [a.clone(), a.reversed()] {
            for reverse in [false, true] {
                let orient = |b: &Trimmed| if reverse { b.reversed() } else { b.clone() };
                assert_eq!(a.contacts(&orient(&disjoint)).unwrap().len(), 0);
                let contacts = a.contacts(&orient(&touching)).unwrap();
                assert_eq!(contacts.len(), 1);
                assert_eq!(contacts[0], ExactPoint::from_f64([0., 5.]));
                assert_eq!(a.contacts(&orient(&overlapping)).unwrap_err(), Refusal::OverlappingArcs);
            }
        }
    }

    #[test]
    fn disjoint_trims_do_not_reuse_the_parent_witness() {
        let upper = Trimmed::arc_through([5.,0.], [0.,5.], [-5.,0.]).unwrap();
        let lower = Trimmed::arc_through([5.,0.],[0.,-5.],[-5.,0.]).unwrap();
        assert_eq!(upper.contacts(&lower).unwrap().len(),2);
        assert_eq!(upper.contacts(&upper.reversed()).unwrap_err(),Refusal::OverlappingArcs);
        let a = upper.trim(ExactPoint::from_f64([5.,0.]), ExactPoint::from_f64([4.,3.])).unwrap();
        let b = upper.trim(ExactPoint::from_f64([3.,4.]), ExactPoint::from_f64([-3.,4.])).unwrap();
        for a in [a.clone(), a.reversed()] {
            for b in [b.clone(), b.reversed()] {
                assert!(a.contacts(&b).unwrap().is_empty());
                a.admit(&b).unwrap();
                let at = &a.ends()[0];
                let refit = a.refitted(at, &a.normal_at(at).unwrap()).unwrap().unwrap();
                assert!(refit.coincident_with(&a).unwrap());
                assert!(refit.contains(&a.interior_point().unwrap()).unwrap());
            }
        }
    }

    #[test]
    fn candidate_budget_failure_is_a_refusal_not_a_lost_contact() {
        let eps = Q::new(1.into(), q(2.).numer().pow(9000));
        let line = Trimmed::new([ExactPoint::from_f64([0.,0.]),
            ExactPoint::from_rational([q(1.) + eps, q(0.)])], Carrier::Line).unwrap();
        let arc = Trimmed::arc_through([1.,0.], [0.,1.], [-1.,0.]).unwrap();
        assert_eq!(line.contacts(&arc).unwrap_err(), Refusal::RadicalBudget);
        assert_eq!(arc.contacts(&line).unwrap_err(), Refusal::RadicalBudget);
        assert_eq!(line.admit(&arc).unwrap_err(), Refusal::RadicalBudget);
        assert_eq!(arc.winding(&ExactPoint::from_rational([q(0.),
            Q::new(1.into(), q(2.).numer().pow(9000))])).unwrap_err(), Refusal::RadicalBudget);
        assert_eq!(line.contains(&ExactPoint::from_f64([0.5,0.])).unwrap_err(), Refusal::RadicalBudget);
        assert_eq!(line.ends()[1].linear_form(&q(0.),[&line.ends()[1].rat().unwrap()[0],&q(0.)]).unwrap_err(), Refusal::RadicalBudget);
        let candidate = Candidate { base: crate::radical::vector(&[q(0.),q(0.)]), offset: [q(1.),q(0.)],
            radicand: Q::new(1.into(),q(2.).numer().pow(17000)).into() };
        assert_eq!(candidate.equals(&ExactPoint::from_f64([0.,0.])).unwrap_err(), Refusal::RadicalBudget);
    }

    #[test]
    fn arc_arc_candidate_budget_is_propagated() {
        let eps = Q::new(1.into(), q(2.).numer().pow(9000));
        let a = Trimmed::ring(crate::numeric::pt([0.,0.]),q(1.),ExactPoint::from_f64([1.,0.]),true).unwrap();
        let b = Trimmed::ring([eps.clone(),q(0.)],q(1.),
            ExactPoint::from_rational([q(1.)+eps,q(0.)]),true).unwrap();
        assert_eq!(a.contacts(&b).unwrap_err(),Refusal::RadicalBudget);
        assert_eq!(b.contacts(&a).unwrap_err(),Refusal::RadicalBudget);
        assert_eq!(a.admit(&b).unwrap_err(),Refusal::RadicalBudget);
    }

    #[test]
    fn near_vertical_quadratic_trim_has_a_certified_interior_witness() {
        for swapped in [false, true] {
            let swap = |p: [f64;2]| if swapped { [p[1], p[0]] } else { p };
            let line = Trimmed::line(swap([1.,0.]), swap([1. + 2f64.powi(-52),256.]));
            let ring = Trimmed::ring(crate::numeric::pt([0.,0.]),q(4.),ExactPoint::from_f64([2.,0.]),true).unwrap();
            let hit = line.contacts(&ring).unwrap().remove(0);
            let piece = line.trim(ExactPoint::from_f64(swap([1.,0.])),hit).unwrap();
            assert!(piece.length().unwrap().lo() > 1.7);
            for piece in [piece.clone(), piece.reversed()] {
                let witness = piece.interior_point().unwrap();
                assert!(witness.rat().is_ok());
                assert!(piece.contains(&witness).unwrap());
                assert!(!piece.ends().contains(&witness));
            }
        }
    }

    #[test]
    fn extraction_stores_an_irrational_root_exactly() {
        let c = Candidate { base: crate::radical::vector(&[q(0.), q(0.)]), offset: [q(1.), q(0.)], radicand: q(2.).into() };
        let point = c.extract().unwrap();
        assert!(point.rat().is_err());
        assert_eq!(point, ExactPoint::from_quadratic([q(0.), q(0.)], [q(1.), q(0.)], q(2.)).unwrap());
        let c = Candidate { base: crate::radical::vector(&[q(1.), q(1.)]), offset: [q(1.), q(-1.)], radicand: q(9.).into() };
        assert_eq!(c.extract().unwrap(), ExactPoint::from_f64([4., -2.]));
    }
}
