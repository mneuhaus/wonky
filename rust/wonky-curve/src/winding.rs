//! Winding of one piece around a point: signed crossings of the positive
//! horizontal ray from the point, with ONE half-open convention for every
//! carrier: a crossing at the piece's lower end belongs to it, a crossing at
//! its upper end does not (lower-inclusive, upper-exclusive in y). Summed over a
//! closed cycle this counts every crossing exactly once, also at vertices and
//! at horizontal tangencies, and it is valid for circular digons where a
//! zero-area chord polygon is no authority.
//!
//! In state terms: a point of a piece is HIGH when it lies strictly above the
//! ray and LOW otherwise; the winding counts the piece's LOW -> HIGH changes
//! (+1) and HIGH -> LOW changes (-1) right of the point, and a piece starts
//! and ends in its end's own state. Lines and arcs decide this in closed form;
//! a spline piece (S6) at the exact roots of `Y - y W` with their
//! multiplicities: the sign just before and after a rational root comes from
//! exact deflation, around an irrational root from its isolating interval, and
//! `x > x0` at an irrational root from `sign_at`. An even-multiplicity root is
//! a touch and changes nothing.
//!
//! The planted negative of strand S3 flips the upper end to inclusive; it is
//! compiled in only with the cargo feature `plant_inclusive_upper`.
use crate::bspline::roots::{roots_open, Root};
use crate::bspline::{alg, peval, poly};
use crate::carrier::{Carrier, Circle, SplineCarrier};
use crate::contact::{nonpositive, one_signed, one_sided};
use crate::intersect::Candidate;
use crate::numeric::{q, P, Q};
use crate::point::ExactPoint;
use crate::refusal::{Refusal, R};
use crate::trimmed::Trimmed;
use num_traits::{Signed, Zero};
use std::cmp::Ordering::{self, Equal, Greater};
use wonky_alg::{Limits, Sign};

/// The planted negative: upper ends count as crossings.
const UPPER_INCLUSIVE: bool = cfg!(feature = "plant_inclusive_upper");

/// Winding of one piece (see the module doc for the spline arm).
pub(crate) fn of(s: &Trimmed, p: &ExactPoint) -> R<i32> {
    match s.carrier() {
        Carrier::Line => Ok(line(s, p)),
        Carrier::Circle(c) => arc(s, c, p),
        Carrier::BSpline(k) => spline(k, p.rat()?),
    }
}

/// The change a root of `y - y0` contributes, from the signs of `y - y0` just
/// below and just above its parameter (`left`, `right`), whether it lies
/// right of the point, and whether it is the lower or upper parameter end.
/// The traversal decides which side is before: the first end in traversal
/// has no "before" on this piece (its own LOW state), the last no "after".
fn change(k: &SplineCarrier, [left, right]: [Ordering; 2], right_of: bool, [lower, upper]: [bool; 2]) -> i32 {
    if !right_of {
        return 0;
    }
    let (mut before, mut after) = if k.increasing() { (left, right) } else { (right, left) };
    let (first, last) = if k.increasing() { (lower, upper) } else { (upper, lower) };
    if first {
        before = Equal;
    }
    if last {
        after = Equal;
    }
    i32::from(after == Greater) - i32::from(before == Greater)
}

fn spline(k: &SplineCarrier, p: &P) -> R<i32> {
    let (lo, hi) = k.range();
    let pieces = k.spline.pieces(lo, hi)?;
    let spans = k.spline.spans();
    let height = |i: usize| {
        let sp = &spans[i];
        sp.pw[1].sub(&sp.pw[2].mul(&poly(vec![p[1].clone()])))
    };
    let across = |i: usize| {
        let sp = &spans[i];
        sp.pw[0].sub(&sp.pw[2].mul(&poly(vec![p[0].clone()])))
    };
    let g = pieces.iter().map(|(i, _, _)| height(*i)).collect::<Vec<_>>();
    let n = pieces.len();
    let mut w = 0;
    // Roots at the range ends and at the knots between span pieces: rational
    // parameters, one-sided signs from the span on each side.
    for j in 0..=n {
        let (i, at) = if j < n { (pieces[j].0, &pieces[j].1) } else { (pieces[n - 1].0, &pieces[n - 1].2) };
        let point = spans[i].point_at(at);
        if point[1] != p[1] {
            continue;
        }
        let left = if j == 0 { Equal } else { one_sided(&g[j - 1], &pieces[j - 1].2, false)? };
        let right = if j == n { Equal } else { one_sided(&g[j], &pieces[j].1, true)? };
        w += change(k, [left, right], point[0] > p[0], [j == 0, j == n]);
    }
    // Roots strictly inside a span piece. A span whose `y - y0` has one sign
    // (or is zero), or that lies left of the point, contributes none.
    for (j, (i, s0, s1)) in pieces.iter().enumerate() {
        if g[j].is_zero() || one_signed(&g[j], s0, s1)? || nonpositive(&across(*i), s0, s1)? {
            continue;
        }
        for root in roots_open(&g[j], s0, s1)? {
            let (sides, right_of) = match root {
                Root::Rat(t) => {
                    let sides = [one_sided(&g[j], &t, false)?, one_sided(&g[j], &t, true)?];
                    (sides, peval(&across(*i), &t).is_positive())
                }
                Root::Irr(alpha) => {
                    // The isolating interval holds no other root of g: its
                    // ends carry the signs on either side.
                    let iv = alpha.interval();
                    let sides = [peval(&g[j], iv.lower()).cmp(&Q::zero()), peval(&g[j], iv.upper()).cmp(&Q::zero())];
                    if sides.contains(&Equal) {
                        return Err(Refusal::SplineBudget);
                    }
                    let x = alpha.sign_at(&across(*i), Limits::default()).map_err(alg)?;
                    (sides, x == Sign::Positive)
                }
            };
            w += change(k, sides, right_of, [false, false]);
        }
    }
    Ok(w)
}

fn line(s: &Trimmed, p: &ExactPoint) -> i32 {
    let (a, b) = (s.ends()[0].coordinates(), s.ends()[1].coordinates());
    let p = p.coordinates();
    let side = crate::radical::cross(&crate::radical::sub(&b, &a), &crate::radical::sub(&p, &a));
    let mut w = 0;
    if a[1] <= p[1] && (if UPPER_INCLUSIVE { b[1] >= p[1] } else { b[1] > p[1] }) && side.is_positive() {
        w += 1;
    }
    if b[1] <= p[1] && (if UPPER_INCLUSIVE { a[1] >= p[1] } else { a[1] > p[1] }) && side.is_negative() {
        w -= 1;
    }
    w
}

fn arc(s: &Trimmed, c: &Circle, p: &ExactPoint) -> R<i32> {
    if c.full {
        let d = p.difference(&c.c);
        return Ok(if c.r2 > crate::radical::dot(&d, &d) { if c.ccw { 1 } else { -1 } } else { 0 });
    }
    let p = p.rat()?;
    let centre = c.c.rat()?;
    let y = &p[1] - &centre[1];
    let r = &c.r2 - &y * &y;
    if r.is_negative() {
        return Ok(0);
    }
    let ends = s.ends();
    if r.is_zero() {
        // An interior horizontal tangency does not cross. At a minimum-y
        // endpoint use the usual lower-inclusive / upper-exclusive convention.
        if y.is_negative() && centre[0] > p[0] {
            let contact = ExactPoint::from_rational([centre[0].clone(), p[1].clone()]);
            return Ok(i32::from(ends[0] == contact) - i32::from(ends[1] == contact));
        }
        return Ok(0);
    }
    let mut w = 0;
    for branch in [-1., 1.] {
        let root = Candidate {
            base: crate::radical::vector(&[centre[0].clone(), p[1].clone()]),
            offset: [q(branch), Q::zero()],
            radicand: r.clone(),
        };
        if (crate::radical::Radical::from(&centre[0] - &p[0]) + r.exact_sqrt()? * q(branch)).sign() != Greater || !root.on_arc(ends, c)? {
            continue;
        }
        let up = (branch > 0.) == c.ccw;
        let at_lower = root.equals(&ends[0])?;
        let at_upper = root.equals(&ends[1])?;
        // Along the piece the ray is crossed upward at its lower end and
        // downward at its upper end when the piece rises; mirrored otherwise.
        // A full turn has one seam that is both ends: the crossing there is an
        // interior crossing of the closed curve and counts once.
        if !c.full && ((at_lower && !up) || (at_upper && up && !UPPER_INCLUSIVE)) {
            continue;
        }
        w += if up { 1 } else { -1 };
    }
    Ok(w)
}

#[cfg(test)]
mod tests {
    use crate::trimmed::fixtures::*;
    use crate::point::ExactPoint;

    fn w(s: &crate::Trimmed, x: f64, y: f64) -> i32 {
        s.winding(&ExactPoint::from_f64([x, y])).unwrap()
    }

    #[test]
    fn a_line_owns_its_lower_end_and_not_its_upper_end() {
        let up = line([0., 0.], [0., 4.]); // rises on x = 0
        // The ray from (-1, y) to +x meets the line for y in [0, 4).
        assert_eq!(w(&up, -1., 0.), 1, "lower end inclusive");
        assert_eq!(w(&up, -1., 2.), 1);
        assert_eq!(w(&up, -1., 4.), 0, "upper end exclusive");
        assert_eq!(w(&up, -1., 5.), 0);
        assert_eq!(w(&up, -1., -1.), 0);
        assert_eq!(w(&up, 1., 2.), 0, "point right of the line");
        // The reverse traversal contributes the opposite sign on the same y-range.
        let down = up.reversed();
        assert_eq!(w(&down, -1., 0.), -1);
        assert_eq!(w(&down, -1., 4.), 0);
        // A horizontal line never crosses.
        assert_eq!(w(&line([0., 1.], [4., 1.]), -1., 1.), 0);
    }
    #[test]
    fn two_lines_sharing_a_vertex_count_the_crossing_once() {
        // (0,0) -> (0,2) -> (0,4): the ray at y = 2 must count exactly once.
        let (a, b) = (line([0., 0.], [0., 2.]), line([0., 2.], [0., 4.]));
        assert_eq!(w(&a, -1., 2.) + w(&b, -1., 2.), 1);
        // A turning vertex (up then down) at y = 2: both or neither, and they cancel.
        let (a, b) = (line([0., 0.], [1., 2.]), line([1., 2.], [0., 4.]));
        assert_eq!(w(&a, -1., 2.) + w(&b, -1., 2.), 1);
        let (a, b) = (line([0., 0.], [1., 2.]), line([1., 2.], [0., 0.]));
        assert_eq!(w(&a, -1., 2.) + w(&b, -1., 2.), 0);
    }
    #[test]
    fn an_arc_owns_its_lower_end_and_not_its_upper_end() {
        // Counter-clockwise quarter from (0,-1) to (1,0): it rises, and the
        // root at y = 0 is its upper end, which it does not own.
        let right = arc([0., 0.], 1., [0., -1.], [1., 0.], true);
        assert_eq!(w(&right, -2., 0.), 0, "upper end exclusive");
        assert_eq!(w(&right, -2., -0.5), 1);
        // Quarter from (1,0) counter-clockwise to (0,1): rising from its lower end.
        let rising = arc([0., 0.], 1., [1., 0.], [0., 1.], true);
        assert_eq!(w(&rising, -2., 0.), 1, "lower end inclusive, upward");
        // Clockwise quarter from (0,1) down to (1,0): (1,0) is its lower end.
        let falling = arc([0., 0.], 1., [0., 1.], [1., 0.], false);
        assert_eq!(w(&falling, -2., 0.), -1, "lower end inclusive, downward");
        assert_eq!(w(&falling, -2., 1.), 0, "the top tangency crosses nothing");
        // Roots left of the point do not count.
        let half = arc([0., 0.], 1., [1., 0.], [-1., 0.], true);
        assert_eq!(w(&half, 0., 0.5), 1);
        assert_eq!(w(&half, 0.9, 0.5), 0);
        assert_eq!(w(&half, -2., 0.5), 0, "an outside point sees the arc twice, up and down");
        assert_eq!(w(&half, 0., 2.), 0, "above the circle");
    }
    #[test]
    fn an_arc_at_its_lowest_point_counts_only_as_an_end() {
        // Interior tangency at the minimum (0,-1) crosses nothing.
        let through = arc([0., 0.], 1., [-1., 0.], [1., 0.], true);
        assert_eq!(w(&through, -2., -1.), 0);
        // A piece starting at the minimum owns it, a piece ending there owns it
        // with the opposite sign: together (a full circle) they cancel.
        let from_bottom = arc([0., 0.], 1., [0., -1.], [0., 1.], true);
        let to_bottom = arc([0., 0.], 1., [0., 1.], [0., -1.], true);
        assert_eq!(w(&from_bottom, -2., -1.), 1);
        assert_eq!(w(&to_bottom, -2., -1.), -1);
        // A point right of the centre never sees the tangency.
        assert_eq!(w(&from_bottom, 0.5, -1.), 0);
    }
    #[test]
    fn a_closed_cycle_of_pieces_sums_to_the_topological_winding() {
        // Unit disc as two half arcs, counter-clockwise: inside 1, outside 0,
        // and the same through the vertices' heights.
        let over_top = arc([0., 0.], 1., [1., 0.], [-1., 0.], true);
        let under = arc([0., 0.], 1., [-1., 0.], [1., 0.], true);
        let total = |x: f64, y: f64| w(&over_top, x, y) + w(&under, x, y);
        assert_eq!(total(0., 0.), 1);
        assert_eq!(total(0., 0.5), 1);
        assert_eq!(total(-2., 0.), 0, "the ray runs through both vertices");
        assert_eq!(total(2., 0.), 0);
        assert_eq!(total(0., -0.5), 1);
        assert_eq!(total(0., 1.5), 0);
        assert_eq!(total(-2., -1.), 0, "the bottom tangency is an interior contact of the lower half");
    }
}

#[cfg(test)]
mod spline_tests {
    use crate::bspline::BSpline;
    use crate::numeric::{q, Q};
    use crate::point::ExactPoint;
    use crate::trimmed::Trimmed;
    use std::sync::Arc;

    fn r(n: i64, d: i64) -> Q {
        Q::new(n.into(), d.into())
    }
    fn spline(poles: &[[f64; 2]]) -> Arc<BSpline> {
        Arc::new(BSpline::bezier(poles.iter().map(|x| [q(x[0]), q(x[1])]).collect(), None).unwrap())
    }
    fn w(s: &Trimmed, x: Q, y: Q) -> i32 {
        s.winding(&ExactPoint::from_rational([x, y])).unwrap()
    }

    #[test]
    fn a_spline_piece_counts_its_ray_roots_with_multiplicity() {
        // The arch rises from (0,0) to the apex (13, 9/2) and falls to (26,0).
        let s = spline(&[[0., 0.], [8., 6.], [18., 6.], [26., 0.]]);
        let fwd = Trimmed::spline(Arc::clone(&s), r(0, 1), r(1, 1)).unwrap();
        let back = fwd.reversed();
        // Inside: the ray meets the falling half right of the point.
        assert_eq!(w(&fwd, r(13, 1), r(1, 1)), -1);
        assert_eq!(w(&back, r(13, 1), r(1, 1)), 1);
        // Left of both halves: up then down, they cancel.
        assert_eq!(w(&fwd, r(-1, 1), r(1, 1)), 0);
        // The apex is a double root: a touch counts nothing, from either side.
        assert_eq!(w(&fwd, r(0, 1), r(9, 2)), 0);
        assert_eq!(w(&back, r(0, 1), r(9, 2)), 0);
        // At the ends' height: the lower end owns its crossing, the upper end
        // does not (the half-open rule of lines and arcs).
        assert_eq!(w(&fwd, r(-1, 1), r(0, 1)), 0, "rises from (0,0): +1; falls to (26,0): -1");
        assert_eq!(w(&fwd, r(13, 1), r(0, 1)), -1, "only the upper end (26,0) is right of the point");
        assert_eq!(w(&back, r(13, 1), r(0, 1)), 1);
        // A line piece with the same ends and sense agrees at the end heights.
        let l = Trimmed::line([26., 0.], [26., 4.]);
        assert_eq!(w(&l, r(13, 1), r(0, 1)), 1);
    }

    #[test]
    fn rays_through_knots_count_once() {
        // A C1 quadratic chain of three spans; its knot points at t = 1 and
        // t = 3 carry the rays exactly. Every winding equals the windings of the
        // rays just above and below (the three probes lie in one face).
        let knots = [0, 0, 0, 1, 3, 4, 4, 4].iter().map(|k| r(*k, 1)).collect();
        let poles = [[0., 0.], [2., 5.], [5., 6.], [8., 2.], [11., 3.]].iter().map(|x| [q(x[0]), q(x[1])]).collect();
        let s = Arc::new(BSpline::new(2, knots, poles, None).unwrap());
        let chain = Trimmed::spline(Arc::clone(&s), r(0, 1), r(4, 1)).unwrap();
        let close = [
            Trimmed::line([11., 3.], [11., -2.]),
            Trimmed::line([11., -2.], [0., -2.]),
            Trimmed::line([0., -2.], [0., 0.]),
        ];
        let cycle = crate::cycle::Cycle::new(std::iter::once(chain.clone()).chain(close).collect());
        let eps = Q::new(1.into(), num_bigint::BigInt::from(1) << 40);
        for t in [r(1, 1), r(3, 1)] {
            let k = s.eval(&t).unwrap();
            for dx in [r(1, 2), r(3, 1), r(-1, 4)] {
                let x = &k[0] - dx;
                let at = |y: Q| cycle.winding(&ExactPoint::from_rational([x.clone(), y])).unwrap();
                let (on, up, down) = (at(k[1].clone()), at(&k[1] + &eps), at(&k[1] - &eps));
                assert!(on == up && up == down && (on == 0 || on == -1), "knot {t}: {on} {up} {down}");
            }
        }
        // The chain runs clockwise here: its inside winds -1.
        assert_eq!(cycle.winding(&ExactPoint::from_f64([5., 0.])).unwrap(), -1);
        assert_eq!(cycle.winding(&ExactPoint::from_f64([5., 10.])).unwrap(), 0);
    }

    #[test]
    fn touches_at_piece_ends_corner_knots_and_irrational_roots_count_nothing() {
        // A ray that only touches the curve winds like the rays just above and
        // just below it (the three probes lie in one face).
        let eps = Q::new(1.into(), num_bigint::BigInt::from(1) << 40);
        let line = |a: [f64; 2], b: [f64; 2]| Trimmed::line(a, b);
        let touch = |c: &crate::cycle::Cycle, x: Q, y: Q| {
            let at = |y: Q| c.winding(&ExactPoint::from_rational([x.clone(), y])).unwrap();
            let w = [at(y.clone()), at(&y + &eps), at(&y - &eps)];
            assert!(w[0] == w[1] && w[1] == w[2], "({x}, {y}): {w:?}");
            w[0]
        };
        // The arch split at its apex (13, 9/2): both halves END there with a
        // horizontal tangent (one-sided signs at the range ends).
        let s = spline(&[[0., 0.], [8., 6.], [18., 6.], [26., 0.]]);
        let halves = crate::cycle::Cycle::new(vec![
            line([0., 0.], [26., 0.]),
            Trimmed::spline(Arc::clone(&s), r(1, 1), r(1, 2)).unwrap(),
            Trimmed::spline(s, r(1, 2), r(0, 1)).unwrap(),
        ]);
        for x in [r(-1, 1), r(12, 1), r(14, 1)] {
            assert_eq!(touch(&halves, x, r(9, 2)), 0);
        }
        // A C0 corner at the double knot t = 1, (2, 1), where y has a local
        // minimum (degree 2, knots 0,0,0,1,1,2,2,2), closed clockwise below.
        let knots = [0, 0, 0, 1, 1, 2, 2, 2].iter().map(|k| r(*k, 1)).collect();
        let poles = [[0., 0.], [1., 2.], [2., 1.], [3., 2.], [4., 0.]].iter().map(|x| [q(x[0]), q(x[1])]).collect();
        let corner = Arc::new(BSpline::new(2, knots, poles, None).unwrap());
        let cup = crate::cycle::Cycle::new(vec![
            Trimmed::spline(corner, r(0, 1), r(2, 1)).unwrap(),
            line([4., 0.], [4., -1.]),
            line([4., -1.], [0., -1.]),
            line([0., -1.], [0., 0.]),
        ]);
        assert_eq!(touch(&cup, r(7, 4), r(1, 1)), -1, "inside, the ray grazes the corner");
        assert_eq!(touch(&cup, r(-1, 1), r(1, 1)), 0);
        // y = 16 (t^2 - 1/2)^2 over x = t touches y = 0 at the irrational t = 1/sqrt 2:
        // a double root, decided on its isolating interval.
        let quartic = [[r(0, 1), r(4, 1)], [r(1, 4), r(4, 1)], [r(1, 2), r(4, 3)], [r(3, 4), r(-4, 1)], [r(1, 1), r(4, 1)]];
        let dip = Arc::new(BSpline::bezier(quartic.to_vec(), None).unwrap());
        let bowl = crate::cycle::Cycle::new(vec![Trimmed::spline(dip, r(0, 1), r(1, 1)).unwrap(), line([1., 4.], [0., 4.])]);
        assert_eq!(touch(&bowl, r(1, 2), r(0, 1)), 0);
        assert_eq!(touch(&bowl, r(-1, 1), r(0, 1)), 0);
        assert_eq!(bowl.winding(&ExactPoint::from_rational([r(7, 10), r(1, 2)])).unwrap(), 1);
    }
}
