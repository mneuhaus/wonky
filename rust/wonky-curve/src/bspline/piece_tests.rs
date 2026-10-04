//! Spline pieces inside the operation table: validation, multi-span splines,
//! elevation, flatten certificates, `Trimmed::spline`, a cycle through the
//! S-edge, and the arrangement operations on a spline piece (S6).
use super::*;
use crate::carrier::{Carrier, PlaneMap};
use crate::cycle::Cycle;
use crate::numeric::{cross, dot, enclose, sub};
use crate::point::ExactPoint;
use crate::trimmed::Trimmed;
use std::sync::Arc;
use wonky_alg::BigInt;

fn r(n: i64, d: i64) -> Q {
    Q::new(BigInt::from(n), BigInt::from(d))
}
fn pt(x: i64, y: i64) -> P {
    [r(x, 1), r(y, 1)]
}
fn ac100() -> Arc<BSpline> {
    Arc::new(BSpline::bezier(vec![pt(0, 0), pt(8, 6), pt(18, 6), pt(26, 0)], None).unwrap())
}
fn s_edge() -> Arc<BSpline> {
    Arc::new(BSpline::bezier(vec![pt(24, 0), pt(34, 6), pt(20, 14), pt(24, 24)], None).unwrap())
}
fn dom(s: &BSpline) -> (Q, Q) {
    (s.domain().0.clone(), s.domain().1.clone())
}
fn on(s: &BSpline, t: Q) -> ExactPoint {
    ExactPoint::from_rational(s.eval(&t).unwrap())
}
fn line(a: (i64, i64), b: (i64, i64)) -> Trimmed {
    Trimmed::line([a.0 as f64, a.1 as f64], [b.0 as f64, b.1 as f64])
}
/// A degree-2 spline with two interior knots (three spans), non-uniform.
fn quadratic_chain() -> BSpline {
    let knots = [0, 0, 0, 1, 3, 4, 4, 4].iter().map(|k| r(*k, 1)).collect();
    let poles = vec![pt(0, 0), pt(2, 5), pt(5, 6), pt(8, 2), pt(11, 3)];
    BSpline::new(2, knots, poles, None).unwrap()
}

#[test]
fn validation_refuses_by_name() {
    let inv = |e: Refusal| {
        assert_eq!(e, Refusal::SplineInvalid);
        assert_eq!(e.name(), "curve2/invalid-spline");
    };
    let z = |k: &[i64]| -> Vec<Q> { k.iter().map(|x| r(*x, 1)).collect() };
    let two = vec![pt(0, 0), pt(1, 1)];
    // degree 0 and 8
    inv(BSpline::new(0, z(&[0, 1]), vec![pt(0, 0)], None).unwrap_err());
    let nine: Vec<P> = (0..9).map(|i| pt(i, i * i % 5)).collect();
    inv(BSpline::bezier(nine, None).unwrap_err());
    // unsorted, unclamped, wrong counts
    inv(BSpline::new(1, z(&[0, 1, 0, 1]), vec![pt(0, 0), pt(1, 1)], None).unwrap_err());
    inv(BSpline::new(2, z(&[0, 0, 1, 2, 3, 3]), vec![pt(0, 0), pt(1, 1), pt(2, 0)], None).unwrap_err());
    inv(BSpline::new(1, z(&[0, 0, 1]), two.clone(), None).unwrap_err());
    inv(BSpline::new(1, z(&[0, 0, 1, 1]), vec![pt(0, 0)], None).unwrap_err());
    // empty domain
    inv(BSpline::new(1, z(&[1, 1, 1, 1]), two.clone(), None).unwrap_err());
    // interior multiplicity above the degree
    let k = z(&[0, 0, 1, 1, 1, 2, 2]);
    inv(BSpline::new(1, k, (0..5).map(|i| pt(i, i)).collect(), None).unwrap_err());
    // weights: not positive, wrong count
    inv(BSpline::bezier(two.clone(), Some(vec![r(1, 1), r(0, 1)])).unwrap_err());
    inv(BSpline::bezier(two.clone(), Some(vec![r(1, 1), r(-2, 1)])).unwrap_err());
    inv(BSpline::bezier(two, Some(vec![r(1, 1)])).unwrap_err());
    // and a valid rational one is accepted
    BSpline::bezier(vec![pt(1, 0), pt(1, 1), pt(0, 1)], Some(vec![r(1, 1), r(1, 2), r(1, 1)])).unwrap();
}

#[test]
fn multi_span_evaluation_matches_the_basis_sum() {
    let s = quadratic_chain();
    assert_eq!(s.spans().len(), 3);
    for t in [r(0, 1), r(1, 3), r(1, 1), r(2, 1), r(3, 1), r(7, 2), r(4, 1)] {
        let n = basis(s.knots(), s.degree(), &t, true);
        let want = n.iter().zip(s.poles()).fold([r(0, 1), r(0, 1)], |a, (b, p)| {
            [&a[0] + b * &p[0], &a[1] + b * &p[1]]
        });
        assert_eq!(s.eval(&t).unwrap(), want, "t = {t}");
    }
    // C1 at the knots: equal one-sided tangent directions (degree 2, simple knots).
    for k in [r(1, 1), r(3, 1)] {
        let (l, rr) = (s.tangent_at(&k, false).unwrap(), s.tangent_at(&k, true).unwrap());
        assert!(cross(&l, &rr).is_zero() && dot(&l, &rr).is_positive());
    }
}

#[test]
fn elevation_keeps_the_curve_and_the_moments() {
    let s = quadratic_chain();
    let e = s.elevated().unwrap();
    assert_eq!(e.degree(), 3);
    let (a, b) = dom(&s);
    for t in [r(0, 1), r(1, 5), r(1, 1), r(9, 4), r(3, 1), r(15, 4), r(4, 1)] {
        assert_eq!(s.eval(&t).unwrap(), e.eval(&t).unwrap(), "t = {t}");
    }
    let (gs, ge) = (s.green(&a, &b).unwrap(), e.green(&a, &b).unwrap());
    assert_eq!((gs.area, gs.mx, gs.my), (ge.area, ge.mx, ge.my));
    // A degree-7 spline cannot be elevated any further.
    let seven: Vec<P> = (0..8).map(|i| pt(i, (i * i) % 7)).collect();
    let e7 = BSpline::bezier(seven, None).unwrap();
    assert_eq!(e7.elevated().unwrap_err(), Refusal::SplineInvalid);
    // A rational curve elevates exactly too.
    let circle = BSpline::bezier(vec![pt(1, 0), pt(1, 1), pt(0, 1)], Some(vec![r(1, 1), r(1, 2), r(1, 1)])).unwrap();
    let ce = circle.elevated().unwrap();
    for t in [r(0, 1), r(1, 3), r(1, 2), r(5, 6), r(1, 1)] {
        assert_eq!(circle.eval(&t).unwrap(), ce.eval(&t).unwrap());
    }
}

#[test]
fn constant_weights_change_nothing() {
    let poly = ac100();
    let w = BSpline::bezier(poly.poles().to_vec(), Some(vec![r(3, 2); 4])).unwrap();
    let (a, b) = dom(&poly);
    for t in [r(0, 1), r(1, 4), r(2, 3), r(1, 1)] {
        assert_eq!(poly.eval(&t).unwrap(), w.eval(&t).unwrap());
    }
    let (gp, gw) = (poly.green(&a, &b).unwrap(), w.green(&a, &b).unwrap());
    assert_eq!((gp.area, gp.mx, gp.my), (gw.area, gw.mx, gw.my));
    assert_eq!(poly.length(&a, &b).unwrap(), QBound::exact(r(28, 1)));
}

#[test]
fn rational_conic_is_exact_and_regular() {
    // Weights 1, 1/2, 1 over (1,0), (1,1), (0,1): an elliptic arc.
    let c = BSpline::bezier(vec![pt(1, 0), pt(1, 1), pt(0, 1)], Some(vec![r(1, 1), r(1, 2), r(1, 1)])).unwrap();
    c.regular().unwrap();
    // At s = 1/2 the homogeneous weights are 1/4 each: P = (2/3, 2/3).
    assert_eq!(c.eval(&r(1, 2)).unwrap(), [r(2, 3), r(2, 3)]);
    let (a, b) = dom(&c);
    let g = c.green(&a, &b).unwrap();
    assert!(g.area.lo <= g.area.hi && g.area.width() < r(1, 1_000_000_000_000));
}

#[test]
fn flatten_bound_is_certified_and_a_power_of_two() {
    for s in [ac100(), s_edge(), Arc::new(quadratic_chain())] {
        let (a, b) = dom(&s);
        let dev = r(1, 100);
        let n = s.flatten_count(&a, &b, &dev).unwrap();
        assert!(n.is_power_of_two());
        assert!(s.flatten_bound(&a, &b, n).unwrap() <= dev);
        if n > 1 {
            assert!(s.flatten_bound(&a, &b, n / 2).unwrap() > dev, "minimal power of two");
        }
        // The bound dominates the true chord deviation, sampled exactly.
        for m in [1usize, 2, 4, n] {
            let bound = s.flatten_bound(&a, &b, m).unwrap();
            for (i, s0, s1) in s.pieces(&a, &b).unwrap() {
                let _ = i;
                for part in 0..m {
                    let h = (&s1 - &s0) / r(m as i64, 1);
                    let (u0, u1) = (&s0 + &h * r(part as i64, 1), &s0 + &h * r(part as i64 + 1, 1));
                    let (p0, p1) = (s.eval(&u0).unwrap(), s.eval(&u1).unwrap());
                    let chord = sub(&p1, &p0);
                    let len2 = dot(&chord, &chord);
                    for k in 1..8 {
                        let u = &u0 + (&u1 - &u0) * r(k, 8);
                        let d = cross(&chord, &sub(&s.eval(&u).unwrap(), &p0));
                        // dist^2 = d^2 / len2 must stay within bound^2
                        assert!(&d * &d <= &bound * &bound * &len2, "bound violated: m={m} part={part}");
                    }
                }
            }
        }
    }
    // Refuses instead of guessing when the budget cannot be met.
    let s = ac100();
    let (a, b) = dom(&s);
    let tiny = Q::new(BigInt::from(1), BigInt::from(1) << 200);
    assert_eq!(s.flatten_count(&a, &b, &tiny).unwrap_err(), Refusal::SplineBudget);
}

#[test]
fn reversed_and_affine_images() {
    let s = ac100();
    let (a, b) = dom(&s);
    let rev = s.reversed().unwrap();
    for t in [r(0, 1), r(1, 4), r(2, 3), r(1, 1)] {
        assert_eq!(rev.eval(&t).unwrap(), s.eval(&(&a + &b - &t)).unwrap());
    }
    assert_eq!(rev.green(&a, &b).unwrap().area, s.green(&a, &b).unwrap().area.neg());
    assert_eq!(rev.length(&a, &b).unwrap(), QBound::exact(r(28, 1)));
    // x -> 2x + y, y -> 3y about the origin: determinant 6.
    let (o, ax, ay) = ([r(0, 1), r(0, 1)], [r(2, 1), r(0, 1)], [r(1, 1), r(3, 1)]);
    let img = s.affine_by(&o, &ax, &ay).unwrap();
    for t in [r(1, 4), r(3, 4)] {
        let p = s.eval(&t).unwrap();
        let want = [&ax[0] * &p[0] + &ay[0] * &p[1], &ax[1] * &p[0] + &ay[1] * &p[1]];
        assert_eq!(img.eval(&t).unwrap(), want);
    }
    assert_eq!(img.green(&a, &b).unwrap().area, s.green(&a, &b).unwrap().area.scale(&r(6, 1)));
    // A regular curve stays regular under an invertible affine map.
    img.regular().unwrap();
}

fn assert_iv_near(v: wonky_num::Iv, want: f64) {
    assert!(v.lo() <= want && want <= v.hi(), "{want} not in [{}, {}]", v.lo(), v.hi());
    assert!(v.hi() - v.lo() < 1e-9, "enclosure too wide: [{}, {}]", v.lo(), v.hi());
}

#[test]
fn trimmed_spline_operations() {
    let s = ac100();
    let (a, b) = dom(&s);
    let whole = Trimmed::spline(Arc::clone(&s), a.clone(), b.clone()).unwrap();
    assert_eq!(whole.ends()[0], on(&s, a.clone()));
    assert_eq!(whole.ends()[1], on(&s, b.clone()));
    assert_iv_near(whole.length().unwrap(), 28.);
    // Tangents leave the first end and point back into the piece at the last:
    // C'(0) = 3 (P1 - P0) = (24, 18) and -C'(1) = -3 (P3 - P2) = (-24, 18).
    let (t0, t1) = (whole.tangent(true), whole.tangent(false));
    assert_eq!(t0.0, pt(24, 18));
    assert_eq!(t1.0, pt(-24, 18));

    // Reversal swaps the ends and the sense; twice is the identity.
    let back = whole.reversed();
    assert_eq!(back.ends()[0], whole.ends()[1]);
    assert_eq!((back.tangent(true).0, back.tangent(false).0), (t1.0.clone(), t0.0.clone()));
    assert_iv_near(back.length().unwrap(), 28.);
    assert_eq!(back.reversed().key(), whole.key());
    assert_eq!(back.canonical().0.key(), whole.key());
    assert_ne!(back.key(), whole.key());

    // A trim to interior points, in both orders.
    let (p, q) = (on(&s, r(1, 4)), on(&s, r(3, 4)));
    let mid = whole.trim(p.clone(), q.clone()).unwrap();
    assert_eq!(mid.ends()[0], p);
    let mid_back = whole.trim(q.clone(), p.clone()).unwrap();
    assert_eq!(mid_back.ends()[0], q);
    assert!(mid.contains(&mid.interior_point().unwrap()).unwrap());
    assert!(mid.contains(&p).unwrap() && mid.contains(&q).unwrap());
    assert!(!mid.contains(&on(&s, r(1, 8))).unwrap());
    // A point off the curve is not on the piece.
    assert!(!mid.contains(&ExactPoint::from_f64([1., 1.])).unwrap());

    // Cuts sort along the traversal, whichever way it runs.
    let cuts = vec![on(&s, r(1, 2)), on(&s, r(1, 8)), on(&s, r(7, 8))];
    let fwd = whole.sorted_cuts(cuts.clone()).unwrap();
    assert_eq!(fwd, vec![on(&s, r(1, 8)), on(&s, r(1, 2)), on(&s, r(7, 8))]);
    let bwd = back.sorted_cuts(cuts).unwrap();
    assert_eq!(bwd, vec![on(&s, r(7, 8)), on(&s, r(1, 2)), on(&s, r(1, 8))]);

    // Extremes of y: the interior apex 9/2 (the ends are handled as points).
    let ex = whole.extrema(&r(0, 1), [&r(0, 1), &r(1, 1)]).unwrap();
    assert!(ex.hi.unwrap() >= 4.5 && ex.hi.unwrap() < 4.5 + 1e-9);
    let bb = whole.bounds().unwrap();
    assert!(bb[0][0] <= 0. && bb[1][0] >= 26. && bb[1][1] >= 4.5 && bb[1][1] < 4.5 + 1e-9, "{bb:?}");

    // The exact plane isometry (a mirror) maps the piece and reverses the sense.
    let mirror = PlaneMap::isometry([r(0, 1), r(0, 1)], [r(-1, 1), r(0, 1)], [r(0, 1), r(1, 1)]).unwrap();
    let m = whole.mapped(&mirror).unwrap();
    assert_eq!(m.ends()[0], ExactPoint::from_f64([0., 0.]));
    assert_eq!(m.ends()[1], ExactPoint::from_f64([-26., 0.]));
    assert_iv_near(m.length().unwrap(), 28.);
}

#[test]
fn trimmed_spline_rejects_bad_ranges_and_irregular_curves() {
    let s = ac100();
    assert_eq!(Trimmed::spline(Arc::clone(&s), r(1, 3), r(1, 3)).unwrap_err(), Refusal::SplineInvalid);
    assert_eq!(Trimmed::spline(Arc::clone(&s), r(-1, 3), r(1, 3)).unwrap_err(), Refusal::SplineInvalid);
    assert_eq!(Trimmed::spline(Arc::clone(&s), r(0, 1), r(4, 3)).unwrap_err(), Refusal::SplineInvalid);
    let cusp = Arc::new(BSpline::bezier(vec![pt(0, 0), pt(10, 10), pt(0, 10), pt(10, 0)], None).unwrap());
    let e = Trimmed::spline(cusp, r(0, 1), r(1, 1)).unwrap_err();
    assert_eq!(e.name(), "curve2/self-intersecting-spline");
}

#[test]
fn spline_cycle_measures() {
    let s = ac100();
    let (a, b) = dom(&s);
    // The curve left to right, closed by its chord: clockwise, area -396/5.
    let cw = Cycle::new(vec![Trimmed::spline(Arc::clone(&s), a, b).unwrap(), line((26, 0), (0, 0))]);
    assert_iv_near(cw.area().unwrap(), -79.2);
    assert!(!cw.orientation().unwrap());
    let ccw = cw.reversed();
    assert_iv_near(ccw.area().unwrap(), 79.2);
    assert!(ccw.orientation().unwrap());
    let (m, n) = (cw.moments().unwrap(), ccw.moments().unwrap());
    for k in 0..2 {
        assert!((m[k].mid() + n[k].mid()).abs() < 1e-9, "moments flip sign with the sense");
    }
    // The centroid of the cap: x = 13 by symmetry, y = 2/5 * 9/2... computed
    // by the oracle; here only the symmetry is asserted.
    assert!((n[0].mid() / 79.2 - 13.).abs() < 1e-9);
    let bb = ccw.bounds().unwrap();
    assert!(bb[0][0] <= 0. && bb[1][0] >= 26. && bb[0][1] <= 0. && bb[1][1] >= 4.5);

    // The S-edge block: three lines close the cubic; cap area 3039/5.
    let e = s_edge();
    let (a, b) = dom(&e);
    let block = Cycle::new(vec![
        line((0, 0), (24, 0)),
        Trimmed::spline(Arc::clone(&e), a, b).unwrap(),
        line((24, 24), (0, 24)),
        line((0, 24), (0, 0)),
    ]);
    assert_iv_near(block.area().unwrap(), 607.8);
    assert!(block.orientation().unwrap());
    let bb = block.bounds().unwrap();
    assert!(bb[0][0] <= 0. && bb[1][0] >= 27.6785026933 && bb[1][0] < 27.6785026934, "{bb:?}");
    assert!(bb[0][1] <= 0. && bb[1][1] >= 24.);
    // Mapping the whole cycle through a mirror keeps it counter-clockwise.
    let mirror = PlaneMap::isometry([r(0, 1), r(0, 1)], [r(-1, 1), r(0, 1)], [r(0, 1), r(1, 1)]).unwrap();
    let mapped = block.mapped(&mirror).unwrap();
    assert_iv_near(mapped.area().unwrap(), 607.8);
    assert!(mapped.orientation().unwrap());
}

#[test]
fn arrangement_operations_answer_on_a_spline_piece() {
    // S6 answers what S5 refused by name: winding, contacts, admission,
    // coincidence and the arrangement. The arch runs left to right over the
    // top, so the arch closed by its chord is clockwise.
    let s = ac100();
    let (a, b) = dom(&s);
    let piece = Trimmed::spline(Arc::clone(&s), a, b).unwrap();
    let l = line((0, 0), (26, 0));
    let probe = ExactPoint::from_f64([3., 1.]);
    assert_eq!(piece.winding(&probe).unwrap(), -1);
    let ends = vec![ExactPoint::from_f64([0., 0.]), ExactPoint::from_f64([26., 0.])];
    assert_eq!(piece.contacts(&l).unwrap(), ends);
    assert_eq!(l.contacts(&piece).unwrap(), ends);
    piece.admit(&l).unwrap();
    assert!(!piece.coincident_with(&l).unwrap());
    assert!(piece.coincident_with(&piece.reversed()).unwrap());
    let cyc = Cycle::new(vec![piece.clone(), line((26, 0), (0, 0))]);
    assert_eq!(cyc.winding(&probe).unwrap(), -1);
    assert!(cyc.contains(&probe).unwrap());
    let budget = crate::arrangement::Budget { segments: 100, pieces: 100 };
    assert_eq!(crate::arrangement::arrange(&[&cyc], budget).unwrap().cells.len(), 1);
    // A cut at a point that is not on the piece still refuses by name.
    let name = "curve2/spline-arrangement-unsupported";
    assert_eq!(piece.trim(on(&s, r(1, 4)), ExactPoint::from_f64([1., 1.])).unwrap_err().name(), name);
}

#[test]
fn certified_flatten_drives_subdivisions_and_samples() {
    let s = ac100();
    let (a, b) = dom(&s);
    let piece = Trimmed::spline(Arc::clone(&s), a, b).unwrap();
    let n = piece.subdivisions(wonky_num::Iv::point(1.), 0.01).unwrap();
    assert!(n >= 2. && (n as usize).is_power_of_two());
    let n = n as usize;
    let none = |_: wonky_num::Iv| -> Result<(wonky_num::Iv, wonky_num::Iv), Refusal> {
        Err(Refusal::SplineFlattenUncertified)
    };
    let first = piece.sample(0, n, none).unwrap();
    let last = piece.sample(n, n, none).unwrap();
    assert!((first[0] - 0.).abs() < 1e-12 && (first[1] - 0.).abs() < 1e-12);
    assert!((last[0] - 26.).abs() < 1e-12 && last[1].abs() < 1e-12);
    // Every sample lies on the curve to within binary64 rounding.
    for i in 0..=n {
        let p = piece.sample(i, n, none).unwrap();
        let on_curve = (0..=2000).any(|k| {
            let q = s.eval(&r(k, 2000)).unwrap();
            let (x, y) = (enclose(&q[0]).unwrap().mid(), enclose(&q[1]).unwrap().mid());
            (x - p[0]).hypot(y - p[1]) < 0.05
        });
        assert!(on_curve, "sample {i}");
    }
    // Uncertifiable requests refuse instead of guessing.
    assert!(piece.subdivisions(wonky_num::Iv::point(1.), 0.).is_err());
    assert!(piece.sample(1, 0, none).is_err());
    // Carrier enum stays closed: the piece is a BSpline carrier.
    assert!(matches!(piece.carrier(), Carrier::BSpline(_)));
}

/// The line/circle operations of the arc-profile, hole and fillet strands
/// (S4) name a spline piece instead of guessing an answer for it. (`distance`
/// left this list in S9: `spline_distance_takes_the_interior_foot`.)
#[test]
fn line_and_circle_only_operations_refuse_a_spline_by_name() {
    let s = ac100();
    let (a, b) = dom(&s);
    let piece = Trimmed::spline(Arc::clone(&s), a, b).unwrap();
    let l = line((0, 0), (26, 0));
    let name = "curve2/spline-arrangement-unsupported";
    let start = piece.ends()[0].clone();
    let east = crate::star::Direction(crate::radical::vector(&pt(1, 0)));
    assert!(piece.is_curved());
    assert_eq!(piece.normal_at(&start).unwrap_err().name(), name);
    assert_eq!(piece.refitted(&start, &east).unwrap_err().name(), name);
    assert_eq!(piece.centre_l1_distance(&l), None);
    assert_eq!(l.centre_l1_distance(&piece), None);
    assert_eq!(piece.centre_l1_distance(&piece), None);
    // Ends that are not swapped decide "no retrace" without naming a curve;
    // swapped ends on a pair with a spline are refused.
    assert!(!piece.retraces(&l).unwrap());
    assert_eq!(piece.retraces(&piece.reversed()).unwrap_err().name(), name);
    assert_eq!(l.reversed().retraces(&piece).unwrap_err().name(), name);
    assert_eq!(piece.reversed().retraces(&l).unwrap_err().name(), name);
    let centre = pt(3, 1);
    assert_eq!(piece.misses_disc(&centre, &r(1, 1)).unwrap_err().name(), name);
    assert_eq!(piece.clears_disc(&centre, &r(1, 1)).unwrap_err().name(), name);
    // An end inside the disc decides "not clear" for any carrier.
    assert!(!piece.clears_disc(&pt(0, 0), &r(1, 1)).unwrap());
    assert_eq!(piece.frame().unwrap_err().name(), name);
    assert_eq!(piece.support_fold([&r(1, 1), &r(0, 1)], None).unwrap_err().name(), name);
    assert_eq!(piece.reach().unwrap_err().name(), name);
    assert_eq!(piece.inset(&r(1, 1)).unwrap_err(), crate::trimmed::InsetRefusal::Spline);
}

/// S9: the distance from a point to a spline piece minimizes over the piece's
/// ends AND the interior roots of (C - p) . C' (AC100's probes, exact: the arch
/// is a Pythagorean-hodograph cubic, so every foot and distance is rational).
/// `--features plant_probe_endpoints_only` must fail here.
#[test]
fn spline_distance_takes_the_interior_foot() {
    let s = ac100();
    let (a, b) = dom(&s);
    for piece in [Trimmed::spline(Arc::clone(&s), a.clone(), b.clone()).unwrap(), Trimmed::spline(Arc::clone(&s), b, a).unwrap()] {
        let exact = |x: &ExactPoint, want: Q| {
            let d = piece.distance(x).unwrap();
            let want = num_traits::ToPrimitive::to_f64(&want).unwrap();
            assert!(d.lo() <= want && want <= d.hi() && d.hi() - d.lo() <= 1e-15, "{d:?} vs {want}");
        };
        // An end is at distance 0; probe_normal (49/8, 251/64) has its foot at
        // t = 1/4 (C = (101/16, 27/8), unit normal (-12/37, 35/37)): 37/64.
        exact(&piece.ends()[0].clone(), r(0, 1));
        exact(&ExactPoint::from_rational([r(49, 8), r(251, 64)]), r(37, 64));
        // probe_apex (13, 11/2): foot at the apex (13, 9/2).
        exact(&ExactPoint::from_rational([r(13, 1), r(11, 2)]), r(1, 1));
    }
}

#[test]
fn quadratic_membership_refuses_instead_of_claiming_off_curve() {
    let spline = Arc::new(BSpline::bezier(vec![pt(0, 0), pt(2, 0)], None).unwrap());
    let (lo, hi) = dom(&spline);
    let piece = Trimmed::spline(spline.clone(), lo.clone(), hi.clone()).unwrap();
    assert!(piece.contains(&ExactPoint::from_f64([1., 0.])).unwrap());
    assert!(!piece.contains(&ExactPoint::from_f64([1., 1.])).unwrap());
    let p = ExactPoint::from_quadratic(pt(0, 0), pt(1, 0), r(2, 1)).unwrap();
    assert_eq!(piece.contains(&p), Err(Refusal::CrossingNeedsAlgebraicVertex));
    assert_eq!(Cycle::new(vec![piece]).contains(&p), Err(Refusal::CrossingNeedsAlgebraicVertex));
    // Malformed ranges are not an off-curve verdict either.
    assert!(spline.has_point(&hi, &lo, &pt(1, 0)).is_err());
}
