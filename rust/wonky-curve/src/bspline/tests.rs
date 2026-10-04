//! Exact-value tests of the spline math. The independent oracle (sympy/mpmath)
//! lives in `tests/oracle` and is compared by `tests/bspline_oracle.rs`.
use super::*;
use wonky_alg::BigInt;

fn r(n: i64, d: i64) -> Q {
    Q::new(BigInt::from(n), BigInt::from(d))
}
fn pt(x: i64, y: i64) -> P {
    [r(x, 1), r(y, 1)]
}
fn ac100() -> BSpline {
    BSpline::bezier(vec![pt(0, 0), pt(8, 6), pt(18, 6), pt(26, 0)], None).unwrap()
}
fn dom(s: &BSpline) -> (Q, Q) {
    (s.domain().0.clone(), s.domain().1.clone())
}

#[test]
fn ac100_exact_moments_length_and_apex() {
    let c = ac100();
    let (a, b) = dom(&c);
    let g = c.green(&a, &b).unwrap();
    // The curve runs left to right over the chord, i.e. clockwise: signed area -396/5.
    assert_eq!(g.area, QBound::exact(r(-396, 5)));
    assert_eq!(g.area.neg(), QBound::exact(r(396, 5)));
    let len = c.length(&a, &b).unwrap();
    assert_eq!(len, QBound::exact(r(28, 1)), "the PH cubic has exact length");
    let vals = c.form_values(&a, &b, &r(0, 1), &r(1, 1)).unwrap();
    assert!(vals.iter().any(|v| v == &QBound::exact(r(9, 2))), "apex y = 9/2: {vals:?}");
}

#[test]
fn ac100_point_tangent_and_closest() {
    let c = ac100();
    let t = r(1, 4);
    assert_eq!(c.eval(&t).unwrap(), [r(101, 16), r(27, 8)]);
    let tan = c.tangent_at(&t, true).unwrap();
    // unit normal (-12/37, 35/37): the tangent is proportional to (35, 12)
    assert_eq!(&tan[0] * r(12, 1), &tan[1] * r(35, 1));
    let (a, b) = dom(&c);
    let probe = [r(49, 8), r(251, 64)];
    let cl = c.closest(&a, &b, &probe).unwrap();
    assert_eq!(cl.t, Some(t));
    assert_eq!(cl.dist2, QBound::exact(r(1369, 4096)));
}

#[test]
fn pairwise_green_form_matches_the_polynomial_wedge() {
    let c = ac100();
    let (a, b) = dom(&c);
    let sub = (r(1, 7), r(5, 6));
    for (t0, t1) in [(a.clone(), b.clone()), sub] {
        let g = c.green(&t0, &t1).unwrap();
        assert_eq!(g.area, QBound::exact(c.area_wedge(&t0, &t1).unwrap()));
    }
}

#[test]
fn cusp_cubic_and_true_loop_both_refuse_by_name() {
    let cusp = BSpline::bezier(vec![pt(0, 0), pt(10, 10), pt(0, 10), pt(10, 0)], None).unwrap();
    let e = cusp.regular().unwrap_err();
    assert_eq!(e.name(), "curve2/self-intersecting-spline");
    let looped = BSpline::bezier(vec![pt(0, 0), pt(20, 15), pt(-10, 15), pt(10, 0)], None).unwrap();
    let e = looped.regular().unwrap_err();
    assert_eq!(e, Refusal::SplineSelfIntersecting);
    assert_eq!(e.name(), "curve2/self-intersecting-spline");
}

#[test]
fn simple_curves_are_regular() {
    ac100().regular().unwrap();
    let s = BSpline::bezier(vec![pt(24, 0), pt(34, 6), pt(20, 14), pt(24, 24)], None).unwrap();
    s.regular().unwrap();
}

#[test]
fn disjoint_collinear_spans_with_overlapping_control_boxes_are_not_a_crossing() {
    // Three C0 cubic spans: A runs along y = 0 from x = 0 to 19/10 with control
    // x 0, 2, 17/10, 19/10 (x' has Bernstein differences 2, -3/10, 1/5; their
    // degree-6 elevation, the hodograph cone test, is all positive, so A is one
    // cone piece whose control box reaches x = 2); B arches above y = 0 from
    // (19/10, 0) to (39/20, 0); C runs along y = 0 from x = 39/20 to 3. A and C
    // lie on one line and never meet, but their control boxes overlap on
    // [39/20, 2]. With parallel mean tangents the two Miranda functionals are one,
    // so the sign test passes for the disjoint pair: it must not certify a
    // crossing (the pair is split until the boxes separate).
    let knots = [0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 3].iter().map(|k| r(*k, 1)).collect();
    let poles = vec![
        pt(0, 0),
        pt(2, 0),
        [r(17, 10), r(0, 1)],
        [r(19, 10), r(0, 1)],
        [r(19, 10), r(1, 1)],
        [r(39, 20), r(1, 1)],
        [r(39, 20), r(0, 1)],
        [r(5, 2), r(0, 1)],
        [r(27, 10), r(0, 1)],
        pt(3, 0),
    ];
    let s = BSpline::new(3, knots, poles, None).unwrap();
    assert_eq!(s.spans().len(), 3);
    s.regular().unwrap();
}

#[test]
fn a_singular_affine_image_does_not_inherit_regularity() {
    // AC100 is regular; its projection onto the y axis runs up to the apex and
    // back down the same segment (the hodograph vanishes at t = 1/2).
    let c = ac100();
    c.regular().unwrap();
    let zero = [r(0, 1), r(0, 1)];
    let onto_y = c.affine_by(&zero, &zero, &[r(0, 1), r(1, 1)]).unwrap();
    assert_eq!(onto_y.regular().unwrap_err(), Refusal::SplineCusp);
    // An invertible image keeps the verdict (and recomputing agrees).
    let sheared = c.affine_by(&zero, &[r(1, 1), r(0, 1)], &[r(1, 1), r(1, 1)]).unwrap();
    sheared.regular().unwrap();
}

#[test]
fn round_out_widens_outward_to_a_dyadic_grid_below_the_width() {
    let cases = [
        QBound { lo: r(1, 3), hi: r(1, 3) + r(1, 7_000_000) },
        QBound { lo: r(-22, 7), hi: r(-22, 7) + r(1, 1_000_003) },
        QBound { lo: r(-5, 3), hi: r(7, 11) },
        // Width above 2^64: the grid step is coarser than 1 (negative exponent).
        QBound { lo: Q::from_integer(BigInt::from(-3) << 80u32) / r(7, 1), hi: Q::from_integer(BigInt::from(5) << 80u32) / r(3, 1) },
    ];
    for b in cases {
        let o = b.round_out();
        assert!(o.lo <= b.lo && b.hi <= o.hi, "outward: {b:?} -> {o:?}");
        // At most 2^-63 of the width wider in total.
        let grown = o.width() - b.width();
        assert!(grown * Q::from_integer(BigInt::one() << 63u32) <= b.width(), "{b:?} -> {o:?}");
        for v in [&o.lo, &o.hi] {
            let d = v.denom();
            assert_eq!(d & (d - BigInt::one()), BigInt::zero(), "dyadic: {v}");
        }
    }
    let exact = QBound::exact(r(1, 3));
    assert_eq!(exact.round_out(), exact, "an exact bound is not rounded");
}

#[test]
fn a_certified_length_sum_stays_small_rational() {
    // Non-PH cubic with binary64-style payload controls (as the AC102 flanks):
    // every quadrature piece is an enclosure with a several-thousand-bit
    // denominator. Summed exactly they grew to ~95k bits after 59 pieces and
    // the gcd of each addition dominated AC102 (156 s); the outward-rounded sum
    // stays a short dyadic and still encloses the integral to 1e-12.
    let f = |v: f64| Q::from_float(v).unwrap();
    // Varying weights keep the general rational-series path in this test:
    // constant weights alone are already dyadic before piece accumulation and
    // cannot detect removal of pieces()'s round_out (reviewer mutant).
    for weights in [None, Some(vec![r(1, 1), r(2, 1), r(3, 1), r(1, 1)])] {
        let s = BSpline::bezier(
            vec![[f(0.0), f(0.0)], [f(0.1234567890123), f(1.9876543210987)], [f(3.3), f(-0.70000000000001)], [f(4.1), f(0.2)]],
            weights,
        )
        .unwrap();
        let (a, b) = dom(&s);
        let len = s.length(&a, &b).unwrap();
        assert!(!len.is_exact());
        for v in [&len.lo, &len.hi] {
            assert!(v.denom().bits() < 512 && v.numer().bits() < 512, "length bound grew: {} / {} bits", v.numer().bits(), v.denom().bits());
        }
        assert!(len.width() * Q::from_integer(BigInt::from(10).pow(12)) <= len.lo, "{len:?}");
    }
}
