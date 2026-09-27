use wonky_n2::*;
fn p(x: f64, y: f64) -> Point {
    Point::cartesian([x, y]).unwrap()
}
fn circle() -> Circle {
    Circle {
        center: [0.0, 0.0],
        radius: 5.0,
    }
}
fn two(i: Intersections) -> [Point; 2] {
    match i {
        Intersections::Two(p) => p,
        _ => panic!("expected two intersections"),
    }
}

#[test]
fn radical_sign_cases_cancellation_and_arity_are_not_approximated() {
    let sqrt2 = 2.0_f64.sqrt();
    let cases = [
        ([0., 1., 2., 0., 0.], Sign::Positive),
        ([0., -1., 2., 0., 0.], Sign::Negative),
        ([-2., 1., 4., 0., 0.], Sign::Zero),
        ([2., -1., 4., 0., 0.], Sign::Zero),
        ([-3., -1., 4., 0., 0.], Sign::Negative),
        ([1., 1., 2., 0., 0.], Sign::Positive),
        ([0., 1., 2., -1., 2.], Sign::Zero),
        ([-3., 1., 2., 1., 3.], Sign::Positive),
        ([3., -1., 2., -1., 3.], Sign::Negative),
        ([0., 2., 2., -1., 8.], Sign::Zero),
        ([-sqrt2, 1., 2., 2.0_f64.powi(-54), 1.], Sign::Negative),
        ([sqrt2, -1., 2., -2.0_f64.powi(-54), 1.], Sign::Positive),
        ([1., 1e150, 1e-150, -1e75, 1.], Sign::Positive),
    ];
    for (v, expected) in cases {
        assert_eq!(
            sign_two(v[0], v[1], v[2], v[3], v[4]).unwrap(),
            expected,
            "{v:?}"
        );
    }
    assert_eq!(
        sign_sum(0., &[(1., 2.), (1., 3.), (1., 5.)]),
        Err(Refusal::TooManyRadicands {
            supplied: 3,
            maximum: 2
        })
    );
    assert_eq!(sign_one(1., 0., -1.), Err(Refusal::NegativeRadicand));
    // Finite in-range inputs can exhaust the expansion exponent window.
    // They must not turn overflow/underflow into a false zero certificate.
    for scale in [1e-140_f64, 1e140] {
        assert!(matches!(
            sign_two(0., scale, scale, -scale.next_up(), scale),
            Ok(Sign::Negative)
                | Err(Refusal::Numeric(wonky_num::Refusal {
                    kind: wonky_num::UndecidedKind::NotExact,
                    ..
                }))
        ));
    }
    for x in [
        f64::NAN,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::from_bits(1),
        1e151,
        1e-151,
    ] {
        for slot in 0..5 {
            let mut v = [1., 1., 2., 1., 3.];
            v[slot] = x;
            assert!(matches!(
                sign_two(v[0], v[1], v[2], v[3], v[4]),
                Err(Refusal::Numeric(wonky_num::Refusal {
                    kind: wonky_num::UndecidedKind::OutOfRange,
                    ..
                }))
            ));
        }
    }
}

#[test]
fn intersection_parameters_and_circle_order_preserve_distinct_events() {
    let c = circle();
    let line = Line {
        origin: [0., 3.],
        direction: [2., 0.],
    };
    let [a, b] = two(circle_line(c, line).unwrap());
    assert_eq!(a.compare_coordinate(&p(-4., 3.), 0).unwrap(), Sign::Zero);
    assert_eq!(b.compare_coordinate(&p(4., 3.), 0).unwrap(), Sign::Zero);
    assert_eq!(compare_along_line(line, &a, &b).unwrap(), Sign::Negative);
    assert_eq!(
        compare_along_line(
            Line {
                direction: [-2., 0.],
                ..line
            },
            &a,
            &b
        )
        .unwrap(),
        Sign::Positive
    );
    assert_eq!(compare_along_circle(c, &a, &b).unwrap(), Sign::Positive);
    let [lo, hi] = two(circle_circle(
        c,
        Circle {
            center: [6., 0.],
            radius: 5.,
        },
    )
    .unwrap());
    assert_eq!(lo.compare_coordinate(&p(3., -4.), 1).unwrap(), Sign::Zero);
    assert_eq!(hi.compare_coordinate(&p(3., 4.), 1).unwrap(), Sign::Zero);
    assert_eq!(compare_along_circle(c, &lo, &hi).unwrap(), Sign::Positive);
    // Two independent irrational roots on parallel carriers (the
    // sqrt(c)*sqrt(e) coefficient cancels); each point stays on its carrier.
    let [_, u] = two(circle_line(
        c,
        Line {
            origin: [0., 1.],
            direction: [1., 0.],
        },
    )
    .unwrap());
    let [_, v] = two(circle_line(
        c,
        Line {
            origin: [0., 2.],
            direction: [1., 0.],
        },
    )
    .unwrap());
    assert_eq!(compare_along_circle(c, &u, &v).unwrap(), Sign::Negative);
    assert_eq!(compare_along_circle(c, &u, &u).unwrap(), Sign::Zero);
    let next_y = f64::from_bits(1.0_f64.to_bits() + 1);
    let [_, near] = two(circle_line(
        c,
        Line {
            origin: [0., next_y],
            direction: [1., 0.],
        },
    )
    .unwrap());
    assert_eq!(compare_along_circle(c, &u, &near).unwrap(), Sign::Negative);
    assert!(matches!(
        circle_line(
            c,
            Line {
                origin: [0., 5.],
                direction: [1., 0.]
            }
        )
        .unwrap(),
        Intersections::Tangent(_)
    ));
    assert!(matches!(
        circle_line(
            c,
            Line {
                origin: [0., 5.0_f64.next_up()],
                direction: [1., 0.]
            }
        )
        .unwrap(),
        Intersections::Empty
    ));
    assert!(matches!(
        circle_circle(
            c,
            Circle {
                center: [10., 0.],
                radius: 5.
            }
        )
        .unwrap(),
        Intersections::Tangent(_)
    ));
    assert!(matches!(
        circle_circle(
            c,
            Circle {
                center: [2., 0.],
                radius: 3.
            }
        )
        .unwrap(),
        Intersections::Tangent(_)
    ));
    assert!(matches!(
        circle_circle(c, c).unwrap(),
        Intersections::Coincident
    ));
    assert!(matches!(
        circle_circle(c, Circle { radius: 4., ..c }).unwrap(),
        Intersections::Empty
    ));
    assert!(matches!(
        circle_circle(
            c,
            Circle {
                center: [10.0_f64.next_up(), 0.],
                ..c
            }
        )
        .unwrap(),
        Intersections::Empty
    ));
    // Equal rays on another radius are not equal circle parameters.
    assert!(matches!(
        compare_along_circle(c, &p(10., 0.), &p(5., 0.)),
        Err(Refusal::InvalidGeometry(_))
    ));
    assert!(matches!(
        compare_along_line(line, &p(0., 4.), &a),
        Err(Refusal::InvalidGeometry(_))
    ));
    assert!(Point::quadratic([0.; 2], [1.; 2], 2., -1.).is_err());
    assert!(circle_line(
        c,
        Line {
            direction: [0.; 2],
            ..line
        }
    )
    .is_err());
}

#[test]
fn arc_opening_includes_major_wrapped_clockwise_and_full_domains() {
    let c = circle();
    let mut arc = Arc {
        circle: c,
        start: p(5., 0.),
        end: p(0., 5.),
        clockwise: false,
        full_turn: false,
    };
    let checks = [
        (p(3., 4.), ArcLocation::Interior),
        (p(-3., 4.), ArcLocation::Outside),
        (p(5., 0.), ArcLocation::Start),
        (p(0., 5.), ArcLocation::End),
    ];
    for (pt, expected) in checks {
        assert_eq!(point_against_arc(&arc, &pt).unwrap(), expected);
    }
    arc.clockwise = true;
    assert_eq!(
        point_against_arc(&arc, &p(-3., 4.)).unwrap(),
        ArcLocation::Interior
    );
    assert_eq!(
        point_against_arc(&arc, &p(3., 4.)).unwrap(),
        ArcLocation::Outside
    );
    arc.start = p(0., -5.);
    arc.end = p(0., 5.);
    arc.clockwise = false;
    assert_eq!(
        point_against_arc(&arc, &p(5., 0.)).unwrap(),
        ArcLocation::Interior
    );
    assert_eq!(
        point_against_arc(&arc, &p(-5., 0.)).unwrap(),
        ArcLocation::Outside
    );
    arc.end = arc.start.clone();
    assert_eq!(
        point_against_arc(&arc, &p(5., 0.)).unwrap(),
        ArcLocation::Outside
    );
    arc.full_turn = true;
    assert_eq!(
        point_against_arc(&arc, &p(5., 0.)).unwrap(),
        ArcLocation::Interior
    );
    arc.end = p(5., 0.);
    assert!(matches!(
        point_against_arc(&arc, &p(3., 4.)),
        Err(Refusal::InvalidGeometry(_))
    ));
}

#[test]
fn incircle_orientation_boundary_and_scale() {
    for k in [-50, 0, 50] {
        let s = 2.0_f64.powi(k);
        let (a, b, c) = ([s, 0.], [0., s], [-s, 0.]);
        for (d, expected) in [
            ([0., 0.], Sign::Positive),
            ([0., -s], Sign::Zero),
            ([0., -s.next_up()], Sign::Negative),
        ] {
            assert_eq!(incircle(a, b, c, d).unwrap(), expected);
            assert_eq!(incircle(c, b, a, d).unwrap(), expected.flip());
        }
    }
}

fn s(i: i32) -> Sign {
    match i {
        1 => Sign::Positive,
        -1 => Sign::Negative,
        _ => Sign::Zero,
    }
}

/// Near-coincident points from NON-parallel carriers: the sqrt(c)*sqrt(e)
/// coefficient of the cross product is nonzero and the filter cannot decide.
#[test]
fn cross_term_of_independent_roots_decides_near_coincident_points() {
    let c = Circle {
        center: [0., 0.],
        radius: 5.,
    };
    let [_, p1] = two(circle_line(
        c,
        Line {
            origin: [0., 1.],
            direction: [1., 0.],
        },
    )
    .unwrap()); // (sqrt 24, 1)
    let x = 24.0_f64.sqrt();
    // (origin x, direction, root index, circle sign, axis0 sign, axis1 sign)
    let cases = [
        (x, [1., 1.], 1, -1, 1, -1),
        (x, [1., -1.], 1, 1, -1, 1),
        (x, [3., 1.], 1, -1, 1, -1),
        (x, [-2., 5.], 0, 1, -1, 1),
        (x.next_up(), [1., 1.], 1, 1, -1, 1),
        (x.next_up(), [1., -1.], 1, -1, 1, -1),
        (x.next_up(), [3., 1.], 1, 1, -1, 1),
        (x.next_up(), [-2., 5.], 0, -1, 1, -1),
        (x.next_down(), [1., 1.], 1, -1, 1, -1),
        (x.next_down(), [1., -1.], 1, 1, -1, 1),
        (x.next_down(), [3., 1.], 1, -1, 1, -1),
        (x.next_down(), [-2., 5.], 0, 1, -1, 1),
    ];
    for (ox, direction, root, circle_sign, ax0, ax1) in cases {
        let pts = two(circle_line(
            c,
            Line {
                origin: [ox, 1.],
                direction,
            },
        )
        .unwrap());
        let p2 = &pts[root];
        let tag = format!("ox={ox:?} d={direction:?}");
        assert_eq!(
            compare_along_circle(c, &p1, p2).unwrap(),
            s(circle_sign),
            "{tag}"
        );
        assert_eq!(
            compare_along_circle(c, p2, &p1).unwrap(),
            s(-circle_sign),
            "{tag} rev"
        );
        assert_eq!(p1.compare_coordinate(p2, 0).unwrap(), s(ax0), "{tag} x");
        assert_eq!(p1.compare_coordinate(p2, 1).unwrap(), s(ax1), "{tag} y");
        assert_eq!(
            p2.compare_coordinate(&p1, 1).unwrap(),
            s(-ax1),
            "{tag} y rev"
        );
    }
}

/// Seam of the circle parameter is the positive x ray: angle 0 is first.
#[test]
fn circle_parameter_seam_is_positive_x_ray() {
    let c = Circle {
        center: [0., 0.],
        radius: 5.,
    };
    let p = |x, y| Point::cartesian([x, y]).unwrap();
    assert_eq!(
        compare_along_circle(c, &p(5., 0.), &p(0., 5.)).unwrap(),
        Sign::Negative
    );
    assert_eq!(
        compare_along_circle(c, &p(5., 0.), &p(-5., 0.)).unwrap(),
        Sign::Negative
    );
    assert_eq!(
        compare_along_circle(c, &p(-5., 0.), &p(0., -5.)).unwrap(),
        Sign::Negative
    );
    assert_eq!(
        compare_along_circle(c, &p(0., -5.), &p(5., 0.)).unwrap(),
        Sign::Positive
    );
    assert_eq!(
        compare_along_circle(c, &p(5., 0.), &p(5., 0.)).unwrap(),
        Sign::Zero
    );
    // The seam point as an intersection with irrational representation of 0:
    // circle_line(y=0 line) gives (+-5, 0) with root 25*4... exact zero y.
    let [l, r] = two(circle_line(
        c,
        Line {
            origin: [0., 0.],
            direction: [2., 0.],
        },
    )
    .unwrap());
    assert_eq!(
        compare_along_circle(c, &r, &p(0., 5.)).unwrap(),
        Sign::Negative
    );
    assert_eq!(
        compare_along_circle(c, &l, &p(0., -5.)).unwrap(),
        Sign::Negative
    );
    assert_eq!(compare_along_circle(c, &r, &l).unwrap(), Sign::Negative);
}
