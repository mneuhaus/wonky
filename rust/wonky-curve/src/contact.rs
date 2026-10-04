//! Contacts of a spline piece with a line, circle or spline piece: the spline
//! arm of the arrangement, with rational vertices only (strand S6).
//!
//! A spline pair is decided in this order; every step is exact:
//! 1. cull: the caller's box cull (`Trimmed::bounds` encloses the piece);
//! 2. separation: a line that strictly separates the convex hulls of the two
//!    pieces' control points proves there is no contact. The spline's points
//!    are the Bernstein control points of its range, the line's its ends, an
//!    arc's the ends and the tangent intersection (sweeps below a half turn).
//!    Candidate normals come from every pair of points of either set, so two
//!    disjoint hulls are always separated (a separating axis is normal to an
//!    edge of one hull);
//! 3. substitution: the other carrier's implicit equation composed with each
//!    span of the spline piece, homogeneous in the span weight `W > 0`
//!    (degree p for a line, 2p for a circle);
//! 4. deflation: an end of the spline piece that lies on the other piece is a
//!    known rational root; it is divided out with its multiplicity
//!    (`Polynomial::deflate`) and reported as an `End` contact;
//! 5. counting: a half-open Sturm count per span (`[s0, s1)`, the last span
//!    closed) of what is left; zero proves there is no further contact;
//! 6. isolation: every remaining root is rational (its exact point is checked
//!    against the other trim and becomes an `Inner` contact) or irrational
//!    (its trim membership is decided by `sign_at`; on the trim, the contact
//!    needs an algebraic vertex and refuses `CrossingNeedsAlgebraicVertex`).
//!
//! The report keeps rational `Inner` contacts (with multiplicity) for
//! admission and diagnosis, but the arrangement (`intersect::contacts`) stores
//! vertices at the known ends only: an `Inner` contact, rational or not,
//! refuses `CrossingNeedsAlgebraicVertex` there. The other piece's end lying
//! inside the spline piece is such a contact too (it is not divided out).
//!
//! A substitution that vanishes identically on a span means the spline lies on
//! the other carrier: `CoincidentSplineCarriers`. Two different splines have no
//! implicit equation here; `bspline::regular::pair_contacts` decides them by
//! certificates (hull separation, a separating line through a shared end, a
//! Poincare-Miranda crossing), see there.
//!
//! The planted negative of S6 (cargo feature `plant_skip_deflation`) skips step
//! 4: a shared end is then found by isolation and reported as an `Inner`
//! contact, so the pieces of a simple chain no longer admit each other.
use crate::bspline::roots::{roots_open, Root};
use crate::bspline::{alg, peval, poly, Span};
use crate::carrier::{Carrier, Circle, SplineCarrier};
use crate::numeric::{cross, dot, sub, P, Q};
use crate::point::ExactPoint;
use crate::refusal::{Refusal, R};
use crate::trimmed::Trimmed;
use num_traits::{Signed, Zero};
use std::cmp::Ordering;
use wonky_alg::{AlgebraicReal, Limits, Polynomial, RationalInterval, Sign, SturmSequence};

/// The planted negative: shared ends are not divided out before counting.
const SKIP_DEFLATION: bool = cfg!(feature = "plant_skip_deflation");

/// How a contact was found.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ContactKind {
    /// An end of the spline piece that lies on the other piece: a root known
    /// before any counting, divided out with its `multiplicity` (1 transversal,
    /// 2 or more a tangential joint; `None` where no substitution exists, as for
    /// two splines). `shared` when the point is an end of both pieces. For a
    /// line/circle pair: a point that is an end of both pieces.
    End { shared: bool, multiplicity: Option<usize> },
    /// A contact found by counting and isolation away from the known ends: a
    /// crossing (odd multiplicity) or a touch (even). For a line/circle pair:
    /// every contact that is not an end of both pieces, without multiplicity.
    Inner { multiplicity: Option<usize> },
}

/// One contact point of two pieces and how it was found.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Contact {
    pub point: ExactPoint,
    pub kind: ContactKind,
}

impl Contact {
    /// The contact is an end of both pieces (a vertex both chains already have).
    pub fn is_shared_end(&self) -> bool {
        matches!(self.kind, ContactKind::End { shared: true, .. })
    }
}

/// All contacts of two pieces with their provenance (see [`ContactKind`]).
pub(crate) fn of(a: &Trimmed, b: &Trimmed) -> R<Vec<Contact>> {
    match (a.carrier(), b.carrier()) {
        (Carrier::BSpline(k), Carrier::Line) => with_carrier(a, k, b, &LineEq::of(b)?),
        (Carrier::Line, Carrier::BSpline(k)) => with_carrier(b, k, a, &LineEq::of(a)?),
        (Carrier::BSpline(k), Carrier::Circle(c)) => with_carrier(a, k, b, &CircleEq::of(b, c)?),
        (Carrier::Circle(c), Carrier::BSpline(k)) => with_carrier(b, k, a, &CircleEq::of(a, c)?),
        (Carrier::BSpline(k), Carrier::BSpline(m)) => splines(a, k, b, m),
        (Carrier::Line | Carrier::Circle(_), Carrier::Line | Carrier::Circle(_)) => {
            Ok(crate::intersect::contacts(a, b)?
                .into_iter()
                .map(|point| {
                    let shared = a.ends().contains(&point) && b.ends().contains(&point);
                    let kind = if shared {
                        ContactKind::End { shared, multiplicity: None }
                    } else {
                        ContactKind::Inner { multiplicity: None }
                    };
                    Contact { point, kind }
                })
                .collect())
        }
    }
}

/// The other carrier of a spline pair as an implicit equation with an exact
/// trim test at algebraic roots.
trait Implicit {
    /// `F(X/W, Y/W) W^deg` on the span: the carrier's equation composed with
    /// the span, cleared of the positive weight.
    fn substitute(&self, sp: &Span) -> Polynomial;
    /// Closed trim membership of the span point at the algebraic root `alpha`
    /// of the substitution (the point is on the carrier). Undecided never
    /// answers "outside".
    fn holds_at(&self, sp: &Span, alpha: &AlgebraicReal) -> R<bool>;
    /// Points whose convex hull contains the other piece, when there is a cheap
    /// exact one.
    fn hull(&self) -> Option<Vec<P>>;
}

fn constant(c: &Q) -> Polynomial {
    poly(vec![c.clone()])
}
/// `X - x W` or `Y - y W` of a span: the coordinate relative to `x`, times W.
fn relative(sp: &Span, c: usize, x: &Q) -> Polynomial {
    sp.pw[c].sub(&sp.pw[2].mul(&constant(x)))
}
fn sign_at(alpha: &AlgebraicReal, p: &Polynomial) -> R<Sign> {
    alpha.sign_at(p, Limits::default()).map_err(alg)
}

/// The line through the ends `a`, `a + d` of a line piece.
struct LineEq {
    a: P,
    d: P,
    dd: Q,
    ends: [P; 2],
}
impl LineEq {
    fn of(line: &Trimmed) -> R<Self> {
        let a = line.ends()[0].rat()?.clone();
        let d = sub(line.ends()[1].rat()?, &a);
        let dd = dot(&d, &d);
        Ok(Self { ends: [a.clone(), line.ends()[1].rat()?.clone()], a, d, dd })
    }
    /// `(C - a) . d` times W.
    fn along(&self, sp: &Span) -> Polynomial {
        relative(sp, 0, &self.a[0]).mul(&constant(&self.d[0])).add(&relative(sp, 1, &self.a[1]).mul(&constant(&self.d[1])))
    }
}
impl Implicit for LineEq {
    fn substitute(&self, sp: &Span) -> Polynomial {
        // cross(d, C - a) W
        relative(sp, 1, &self.a[1]).mul(&constant(&self.d[0])).sub(&relative(sp, 0, &self.a[0]).mul(&constant(&self.d[1])))
    }
    fn holds_at(&self, sp: &Span, alpha: &AlgebraicReal) -> R<bool> {
        // 0 <= (C - a) . d <= d . d, both times W > 0.
        let along = self.along(sp);
        let beyond = along.sub(&sp.pw[2].mul(&constant(&self.dd)));
        Ok(sign_at(alpha, &along)? != Sign::Negative && sign_at(alpha, &beyond)? != Sign::Positive)
    }
    fn hull(&self) -> Option<Vec<P>> {
        Some(self.ends.to_vec())
    }
}

/// The circle of an arc piece and the arc's end vectors in counter-clockwise
/// order (as `Circle::angular` reads them).
struct CircleEq {
    c: P,
    r2: Q,
    full: bool,
    from: P,
    to: P,
    hull: Option<Vec<P>>,
}
impl CircleEq {
    fn of(arc: &Trimmed, k: &Circle) -> R<Self> {
        let r2 = k.r2.rational().ok_or(Refusal::CrossingNeedsAlgebraicVertex)?;
        let ends = [arc.ends()[0].rat()?.clone(), arc.ends()[1].rat()?.clone()];
        let c = k.c.rat()?;
        let (mut from, mut to) = (sub(arc.ends()[0].rat()?, c), sub(arc.ends()[1].rat()?, c));
        if !k.ccw {
            std::mem::swap(&mut from, &mut to);
        }
        // Below a half turn the arc lies in the triangle of its ends and the
        // intersection of the end tangents, c + (u + v) r2 / (r2 + u.v).
        let (u, v) = (&from, &to);
        let hull = cross(u, v).is_positive().then(|| {
            let s = &r2 / (&r2 + dot(u, v));
            let apex = [&c[0] + (&u[0] + &v[0]) * &s, &c[1] + (&u[1] + &v[1]) * &s];
            vec![ends[0].clone(), apex, ends[1].clone()]
        });
        Ok(Self { c: c.clone(), r2, full: k.full, from, to, hull })
    }
}
impl Implicit for CircleEq {
    fn substitute(&self, sp: &Span) -> Polynomial {
        let (x, y) = (relative(sp, 0, &self.c[0]), relative(sp, 1, &self.c[1]));
        x.mul(&x).add(&y.mul(&y)).sub(&sp.pw[2].mul(&sp.pw[2]).mul(&constant(&self.r2)))
    }
    fn holds_at(&self, sp: &Span, alpha: &AlgebraicReal) -> R<bool> {
        // A ring's seam is not an angular trim. Testing its equal end rays
        // would reject every irrational contact away from that seam.
        if self.full {
            return Ok(true);
        }
        // The closed angular test of `Circle::angular` with the signs of
        // cross(from, v) and cross(v, to) at the root (v = C - c, times W).
        let (x, y) = (relative(sp, 0, &self.c[0]), relative(sp, 1, &self.c[1]));
        let fv = y.mul(&constant(&self.from[0])).sub(&x.mul(&constant(&self.from[1])));
        let vt = x.mul(&constant(&self.to[1])).sub(&y.mul(&constant(&self.to[0])));
        let (fv, vt) = (sign_at(alpha, &fv)? != Sign::Negative, sign_at(alpha, &vt)? != Sign::Negative);
        Ok(if !cross(&self.from, &self.to).is_negative() { fv && vt } else { fv || vt })
    }
    fn hull(&self) -> Option<Vec<P>> {
        self.hull.clone()
    }
}

/// Bernstein coefficients of `g` over local `[s0, s1]`.
fn bernstein_over(g: &Polynomial, s0: &Q, s1: &Q) -> R<Vec<Q>> {
    let map = poly(vec![s0.clone(), s1 - s0]);
    g.compose(&map).to_bernstein(g.degree().unwrap_or(0)).map_err(alg)
}
/// A nonzero `g` has one strict sign on the closed `[s0, s1]`, certified by
/// its Bernstein coefficients there (a cheap filter before any Sturm count).
pub(crate) fn one_signed(g: &Polynomial, s0: &Q, s1: &Q) -> R<bool> {
    let b = bernstein_over(g, s0, s1)?;
    Ok(b.iter().all(Signed::is_positive) || b.iter().all(Signed::is_negative))
}
/// `g <= 0` on the closed `[s0, s1]`, certified by its Bernstein coefficients.
pub(crate) fn nonpositive(g: &Polynomial, s0: &Q, s1: &Q) -> R<bool> {
    Ok(bernstein_over(g, s0, s1)?.iter().all(|c| !c.is_positive()))
}

/// Bernstein control points of a span restricted to local `[s0, s1]`: their
/// convex hull contains that part of the curve (positive weights).
pub(crate) fn controls(sp: &Span, s0: &Q, s1: &Q) -> R<Vec<P>> {
    let p = sp.bez[0].len() - 1;
    let map = poly(vec![s0.clone(), s1 - s0]);
    let h = (0..3)
        .map(|c| sp.pw[c].compose(&map).to_bernstein(p).map_err(alg))
        .collect::<R<Vec<_>>>()?;
    Ok((0..=p).map(|i| [&h[0][i] / &h[2][i], &h[1][i] / &h[2][i]]).collect())
}

/// Some line strictly separates the two point sets: the hull of `a` lies in
/// one open half-plane and the hull of `b` in the other. Candidate normals are
/// every pair direction of either set and its perpendicular.
pub(crate) fn hulls_separated(a: &[P], b: &[P]) -> bool {
    let range = |s: &[P], n: &P| {
        let v = s.iter().map(|p| dot(n, p));
        let (lo, hi) = v.fold((None::<Q>, None::<Q>), |(lo, hi), x| {
            (Some(lo.map_or(x.clone(), |l| l.min(x.clone()))), Some(hi.map_or(x.clone(), |h| h.max(x))))
        });
        (lo.expect("nonempty"), hi.expect("nonempty"))
    };
    for set in [a, b] {
        for i in 0..set.len() {
            for j in i + 1..set.len() {
                let d = sub(&set[j], &set[i]);
                if d.iter().all(Zero::is_zero) {
                    continue;
                }
                for n in [[-&d[1], d[0].clone()], d.clone()] {
                    let ((alo, ahi), (blo, bhi)) = (range(a, &n), range(b, &n));
                    if ahi < blo || bhi < alo {
                        return true;
                    }
                }
            }
        }
    }
    false
}

/// The ends of a spline piece at its lower and upper parameter.
fn range_ends<'a>(s: &'a Trimmed, k: &SplineCarrier) -> [&'a ExactPoint; 2] {
    if k.increasing() {
        [&s.ends()[0], &s.ends()[1]]
    } else {
        [&s.ends()[1], &s.ends()[0]]
    }
}

/// Contacts of the spline piece `s` (carrier `k`) with the line or arc piece
/// `other` whose carrier is `eq`.
fn with_carrier(s: &Trimmed, k: &SplineCarrier, other: &Trimmed, eq: &dyn Implicit) -> R<Vec<Contact>> {
    let (lo, hi) = k.range();
    let pieces = k.spline.pieces(lo, hi)?;
    let spans = k.spline.spans();
    let ends = range_ends(s, k);
    let on = [other.contains(ends[0])?, other.contains(ends[1])?];
    let hull = eq.hull();
    let mut out = vec![];
    let n = pieces.len();
    for (j, (i, s0, s1)) in pieces.iter().enumerate() {
        let sp = &spans[*i];
        let last = j + 1 == n;
        let known = [j == 0 && on[0], last && on[1]];
        // Step 2 per span: a span without a known contact whose control hull
        // is separated from the other piece's hull has no contact.
        if let (false, false, Some(hull)) = (known[0], known[1], &hull) {
            if hulls_separated(&controls(sp, s0, s1)?, hull) {
                continue;
            }
        }
        let mut g = eq.substitute(sp);
        if g.is_zero() {
            return Err(Refusal::CoincidentSplineCarriers);
        }
        for (known, at, end) in [(known[0], s0, ends[0]), (known[1], s1, ends[1])] {
            if known && !SKIP_DEFLATION {
                let d = g.deflate(at).map_err(alg)?;
                out.push(Contact {
                    point: end.clone(),
                    kind: ContactKind::End {
                        shared: other.ends().contains(end),
                        multiplicity: Some(d.multiplicity),
                    },
                });
                g = d.quotient;
            }
        }
        if g.degree().unwrap_or(0) == 0 || one_signed(&g, s0, s1)? {
            continue;
        }
        let sturm = SturmSequence::new(&g).map_err(alg)?;
        let span = RationalInterval::new(s0.clone(), s1.clone()).map_err(alg)?;
        let at_upper = last && peval(&g, s1).is_zero();
        if sturm.count_half_open(&span) + usize::from(at_upper) == 0 {
            continue;
        }
        let mut rational = vec![];
        if peval(&g, s0).is_zero() {
            rational.push(s0.clone());
        }
        for root in roots_open(&g, s0, s1)? {
            match root {
                Root::Rat(t) => rational.push(t),
                Root::Irr(alpha) => {
                    if eq.holds_at(sp, &alpha)? {
                        return Err(Refusal::CrossingNeedsAlgebraicVertex);
                    }
                }
            }
        }
        if at_upper {
            rational.push(s1.clone());
        }
        for t in rational {
            let point = ExactPoint::from_rational(sp.point_at(&t));
            if other.contains(&point)? {
                let multiplicity = g.deflate(&t).map_err(alg)?.multiplicity;
                out.push(Contact { point, kind: ContactKind::Inner { multiplicity: Some(multiplicity) } });
            }
        }
    }
    Ok(out)
}

/// Contacts of two spline pieces. On one spline value the pieces overlap
/// (refused) or share ends; on two different splines the certificates of
/// `pair_contacts` must prove that the shared ends are the only contacts.
fn splines(a: &Trimmed, k: &SplineCarrier, b: &Trimmed, m: &SplineCarrier) -> R<Vec<Contact>> {
    let shared = a.ends().iter().filter(|e| b.ends().contains(e)).cloned().collect::<Vec<_>>();
    if k.spline == m.spline {
        let ((a0, a1), (b0, b1)) = (k.range(), m.range());
        if a0.max(b0) < a1.min(b1) {
            return Err(Refusal::CoincidentSplineCarriers);
        }
    } else {
        let at = shared.iter().map(|e| e.rat().cloned()).collect::<R<Vec<_>>>()?;
        crate::bspline::regular::pair_contacts(&k.spline, k.range(), &m.spline, m.range(), &at)?;
    }
    let mut shared = shared;
    shared.dedup();
    Ok(shared
        .into_iter()
        .map(|point| Contact { point, kind: ContactKind::End { shared: true, multiplicity: None } })
        .collect())
}

/// Sign of a polynomial just to the right (`right`) or left of a rational
/// root-or-not `at`: the sign of the deflated quotient, flipped on the left
/// by an odd multiplicity. The zero polynomial answers `Equal`.
pub(crate) fn one_sided(g: &Polynomial, at: &Q, right: bool) -> R<Ordering> {
    if g.is_zero() {
        return Ok(Ordering::Equal);
    }
    let d = g.deflate(at).map_err(alg)?;
    let s = peval(&d.quotient, at).cmp(&Q::zero());
    Ok(if right || d.multiplicity % 2 == 0 { s } else { s.reverse() })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bspline::BSpline;
    use crate::numeric::q;
    use crate::trimmed::fixtures::{arc, line, p};
    use std::sync::Arc;

    fn r(n: i64, d: i64) -> Q {
        Q::new(n.into(), d.into())
    }
    fn bezier(poles: &[[f64; 2]], weights: Option<Vec<Q>>) -> Arc<BSpline> {
        Arc::new(BSpline::bezier(poles.iter().map(|x| [q(x[0]), q(x[1])]).collect(), weights).unwrap())
    }
    /// AC100's arch from (0,0) to (26,0) over the apex (13, 9/2).
    fn arch() -> Arc<BSpline> {
        bezier(&[[0., 0.], [8., 6.], [18., 6.], [26., 0.]], None)
    }
    fn piece(s: &Arc<BSpline>, a: Q, b: Q) -> Trimmed {
        Trimmed::spline(Arc::clone(s), a, b).unwrap()
    }
    fn whole(s: &Arc<BSpline>) -> Trimmed {
        piece(s, r(0, 1), r(1, 1))
    }
    fn end(shared: bool, m: Option<usize>) -> ContactKind {
        ContactKind::End { shared, multiplicity: m }
    }

    #[test]
    fn shared_ends_are_deflated_with_their_multiplicity() {
        let a = whole(&arch());
        // The chord: two simple roots at the ends.
        let chord = a.contact_report(&line([26., 0.], [0., 0.])).unwrap();
        assert_eq!(chord, vec![
            Contact { point: p(0., 0.), kind: end(true, Some(1)) },
            Contact { point: p(26., 0.), kind: end(true, Some(1)) },
        ]);
        // The end tangent (8, 6): a double root, the quotient 6 (15 - 2t) has
        // its root t = 15/2 outside the piece.
        let tangent = line([0., 0.], [4., 3.]).contact_report(&a).unwrap();
        assert_eq!(tangent, vec![Contact { point: p(0., 0.), kind: end(true, Some(2)) }]);
        // A circle through the end on the far side: x >= 26 there.
        let c = arc([30., 0.], 16., [26., 0.], [34., 0.], false);
        assert_eq!(a.contact_report(&c).unwrap(), vec![Contact { point: p(26., 0.), kind: end(true, Some(1)) }]);
        // A spline end inside a line (a T junction) is an end, not shared.
        let t = line([-5., 0.], [5., 0.]).contact_report(&a).unwrap();
        assert_eq!(t, vec![Contact { point: p(0., 0.), kind: end(false, Some(1)) }]);
        assert_eq!(a.contacts(&line([-5., 0.], [5., 0.])).unwrap(), vec![p(0., 0.)]);
    }

    #[test]
    fn contacts_away_from_the_known_ends_are_counted_isolated_and_refused() {
        let a = whole(&arch());
        // y = 4 meets the arch at t = 1/3 and 2/3: rational crossings.
        let cut = line([0., 4.], [26., 4.]);
        let report = a.contact_report(&cut).unwrap();
        let inner = ContactKind::Inner { multiplicity: Some(1) };
        assert_eq!(report, vec![
            Contact { point: ExactPoint::from_rational([r(230, 27), r(4, 1)]), kind: inner.clone() },
            Contact { point: ExactPoint::from_rational([r(472, 27), r(4, 1)]), kind: inner },
        ]);
        assert_eq!(a.contacts(&cut).unwrap_err(), Refusal::CrossingNeedsAlgebraicVertex);
        assert_eq!(a.admit(&cut).unwrap_err(), Refusal::SplineIntersection);
        // y = 9/2 touches the apex: a double root, still a contact away from the ends.
        let top = line([0., 4.5], [26., 4.5]);
        assert_eq!(a.contact_report(&top).unwrap(), vec![Contact {
            point: ExactPoint::from_rational([r(13, 1), r(9, 2)]),
            kind: ContactKind::Inner { multiplicity: Some(2) },
        }]);
        assert_eq!(a.contacts(&top).unwrap_err(), Refusal::CrossingNeedsAlgebraicVertex);
        // y = 3 at irrational parameters: on the trim it refuses, off the
        // trim (x in [12, 14], the roots are at x ~ 5.3 and 20.7) sign_at
        // proves there is no contact.
        assert_eq!(a.contact_report(&line([0., 3.], [26., 3.])).unwrap_err(), Refusal::CrossingNeedsAlgebraicVertex);
        assert_eq!(a.contact_report(&line([12., 3.], [14., 3.])).unwrap(), vec![]);
        // The unit-radius arc about (13, 1) crosses the arch at irrational points.
        let ring = arc([13., 0.], 25., [18., 0.], [8., 0.], true);
        assert_eq!(a.contacts(&ring).unwrap_err(), Refusal::CrossingNeedsAlgebraicVertex);
    }

    #[test]
    fn separated_hulls_decide_before_any_substitution() {
        let a = whole(&arch());
        // Inside the arch's box, above its hull edge (0,0)-(8,6).
        assert!(hulls_separated(&controls(&arch().spans()[0], &r(0, 1), &r(1, 1)).unwrap(), &[pt(0., 3.), pt(2., 3.)]));
        assert_eq!(a.contact_report(&line([0., 3.], [2., 3.])).unwrap(), vec![]);
        // A restriction keeps the hull tight: the first quarter of the arch
        // lies below y = 3, the whole arch does not.
        let quarter = controls(&arch().spans()[0], &r(0, 1), &r(1, 8)).unwrap();
        assert!(hulls_separated(&quarter, &[pt(0., 3.), pt(10., 3.)]));
        assert!(!hulls_separated(&controls(&arch().spans()[0], &r(0, 1), &r(1, 1)).unwrap(), &[pt(0., 3.), pt(10., 3.)]));
        // Collinear sets are separated along their line.
        assert!(hulls_separated(&[pt(0., 0.), pt(1., 0.)], &[pt(2., 0.), pt(3., 0.)]));
        assert!(!hulls_separated(&[pt(0., 0.), pt(2., 0.)], &[pt(2., 0.), pt(3., 0.)]));
    }
    fn pt(x: f64, y: f64) -> P {
        [q(x), q(y)]
    }

    #[test]
    fn a_spline_on_the_other_carrier_refuses_as_coincident() {
        // A degree-1 spline on the x axis against an overlapping line.
        let flat = whole(&bezier(&[[0., 0.], [4., 0.]], None));
        assert_eq!(flat.contacts(&line([1., 0.], [6., 0.])).unwrap_err(), Refusal::CoincidentSplineCarriers);
        // The rational quadratic (1,0), (1,1), (0,1) with weights 1, 1, 2 is the
        // quarter of the unit circle (x, y) = ((1 - t^2), 2t) / (1 + t^2).
        let quarter = whole(&bezier(&[[1., 0.], [1., 1.], [0., 1.]], Some(vec![r(1, 1), r(1, 1), r(2, 1)])));
        let ring = arc([0., 0.], 1., [0., -1.], [0., 1.], true);
        assert_eq!(quarter.contacts(&ring).unwrap_err(), Refusal::CoincidentSplineCarriers);
        assert_eq!(Refusal::CoincidentSplineCarriers.name(), "curve2/coincident-spline-carriers");
    }

    #[test]
    fn two_splines_meet_at_shared_ends_or_refuse_by_name() {
        let s = arch();
        // One spline value: touching ranges share an end, overlapping ones refuse.
        let (left, right) = (piece(&s, r(0, 1), r(1, 2)), piece(&s, r(1, 1), r(1, 2)));
        let apex = ExactPoint::from_rational([r(13, 1), r(9, 2)]);
        assert_eq!(left.contact_report(&right).unwrap(), vec![Contact { point: apex, kind: end(true, None) }]);
        assert_eq!(piece(&s, r(0, 1), r(3, 4)).contacts(&piece(&s, r(1, 4), r(1, 1))).unwrap_err(), Refusal::CoincidentSplineCarriers);
        // The arch and its mirror image share both ends and nothing else: the
        // whole pieces are not separable (both ends lie on y = 0), their
        // sub-pieces are, through each end.
        let a = whole(&s);
        let mirror = whole(&bezier(&[[0., 0.], [8., -6.], [18., -6.], [26., 0.]], None));
        let report = a.contact_report(&mirror).unwrap();
        assert_eq!(report.iter().map(|c| c.point.clone()).collect::<Vec<_>>(), vec![p(0., 0.), p(26., 0.)]);
        assert!(report.iter().all(Contact::is_shared_end));
        a.admit(&mirror).unwrap();
        // A straight cubic across the arch at y = 3: a certified crossing.
        let across = whole(&bezier(&[[0., 3.], [8., 3.], [18., 3.], [26., 3.]], None));
        assert_eq!(a.contacts(&across).unwrap_err(), Refusal::CrossingNeedsAlgebraicVertex);
        // A straight cubic along the arch's end tangent: tangent at the shared
        // end, no separating line through it at any depth.
        let along = whole(&bezier(&[[0., 0.], [4., 3.], [8., 6.], [12., 9.]], None));
        assert_eq!(a.contacts(&along).unwrap_err(), Refusal::SplineContactUndecided);
        assert_eq!(Refusal::SplineContactUndecided.name(), "curve2/spline-contact-undecided");
    }
}
