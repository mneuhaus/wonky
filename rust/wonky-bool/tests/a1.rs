use num_traits::{One, Zero};
use std::cmp::Ordering;
use std::str::FromStr;
use wonky_alg::{Limits, Polynomial};
use wonky_bool::a1::{self, Branch, EdgeContact, Intersection, Parameter};
use wonky_geom::{
    frame::Frame,
    model::{Carrier3, Circle3, Cone3, Curve3, Cylinder3, Plane3},
    Q,
};
fn q(n: i64) -> Q {
    Q::from_integer(n.into())
}
fn p(x: i64, y: i64, z: i64) -> [Q; 3] {
    [q(x), q(y), q(z)]
}
fn cylinder(r: Q, origin: [Q; 3]) -> Carrier3 {
    Carrier3::Cylinder(
        Cylinder3::new(
            Frame::new(origin, [p(1, 0, 0), p(0, 1, 0), p(0, 0, 1)]).unwrap(),
            &r * &r,
        )
        .unwrap(),
    )
}
fn cone(b: Q, k: Q) -> Carrier3 {
    // Nonnegative construction rings; the SSI supports remain double cones.
    let h = if b.is_zero() { Q::zero() } else { -&b / &k };
    Carrier3::Cone(
        Cone3::new(
            Frame::identity(),
            [(h.clone(), Q::zero()), (h + Q::one() / &k, Q::one())],
        )
        .unwrap(),
    )
}
fn plane(origin: [Q; 3], n: [Q; 3], x: [Q; 3]) -> Carrier3 {
    Carrier3::Plane(Plane3 { o: origin, n, x })
}
fn section(a: &Carrier3, b: &Carrier3) -> (Vec<a1::SectionBranch>, Polynomial) {
    match a1::intersect(a, b, Limits::default()).unwrap() {
        Intersection::Section { branches, equation } => (branches, equation),
        Intersection::Coincident => panic!("unexpected coincidence"),
    }
}
#[test]
fn frozen_sympy_a1_configurations() {
    let mut count = 0;
    for row in include_str!("data/a1-fixtures.txt")
        .lines()
        .filter(|l| !l.starts_with('#'))
    {
        let mut fields = row.split_whitespace();
        let kind = fields.next().unwrap();
        let f: Vec<Q> = fields.map(|s| Q::from_str(s).unwrap()).collect();
        if kind == "CI" || kind == "KI" {
            let (a, b) = if kind == "CI" {
                (
                    cylinder(f[0].clone(), p(0, 0, 0)),
                    cylinder(f[0].clone(), [q(0), q(0), f[1].clone()]),
                )
            } else {
                (cone(f[0].clone(), f[1].clone()), cone(-&f[0], -&f[1]))
            };
            assert!(
                matches!(
                    a1::intersect(&a, &b, Limits::default()).unwrap(),
                    Intersection::Coincident
                ),
                "{row}"
            );
            count += 1;
            continue;
        }
        let (a, b, n) = match kind {
            "PC" => (
                plane([f[1].clone(), q(0), q(0)], p(1, 0, 0), p(0, 1, 0)),
                cylinder(f[0].clone(), p(0, 0, 0)),
                2,
            ),
            "CC" => (
                cylinder(f[0].clone(), p(0, 0, 0)),
                cylinder(f[1].clone(), [f[2].clone(), q(0), q(0)]),
                3,
            ),
            "CK" => (
                cylinder(f[0].clone(), p(0, 0, 0)),
                cone(f[1].clone(), f[2].clone()),
                3,
            ),
            "PK" => (
                plane(p(0, 0, 0), p(1, 0, 0), p(0, 1, 0)),
                cone(f[0].clone(), f[1].clone()),
                2,
            ),
            "KK" => (
                cone(f[0].clone(), f[1].clone()),
                cone(f[2].clone(), f[3].clone()),
                4,
            ),
            _ => panic!("fixture kind"),
        };
        let (branches, equation) = section(&a, &b);
        let oracle = Polynomial::new(f[n..n + 3].to_vec()).unwrap();
        // Parallel-cylinder producer uses scaled radial-axis parameter u=y/(2d).
        let oracle = if kind == "CC" {
            let mut c = oracle.coefficients().to_vec();
            c.resize(3, q(0));
            c[2] *= q(4) * &f[2] * &f[2];
            Polynomial::new(c).unwrap()
        } else {
            oracle
        };
        assert_eq!(
            equation.square_free_part().unwrap(),
            oracle.square_free_part().unwrap(),
            "{row}"
        );
        assert_eq!(q(branches.len() as i64), f[n + 3], "{row}");
        let mut observed: Vec<_> = branches.iter().map(|b| b.multiplicity).collect();
        observed.sort();
        let mut expected: Vec<_> = f[n + 4..]
            .iter()
            .map(|v| v.to_integer().try_into().unwrap())
            .collect::<Vec<usize>>();
        expected.sort();
        assert_eq!(observed, expected, "{row}");
        for branch in branches {
            assert!(branch.curve.lies_on(&a).unwrap());
            assert!(branch.curve.lies_on(&b).unwrap());
            for t in [-3, 0, 1, 2] {
                branch.curve.point(&q(t)).unwrap();
            }
        }
        count += 1;
    }
    assert_eq!(count, 112);
}
#[test]
fn tangency_is_one_double_generator_not_two_crossings() {
    let a = cylinder(q(3), p(0, 0, 0));
    let b = cylinder(q(2), p(5, 0, 0));
    let (branches, _) = section(&a, &b);
    assert_eq!(branches.len(), 1);
    assert_eq!(branches[0].multiplicity, 2);
    assert!(matches!(branches[0].curve, Branch::Line { .. }));
    let edge = Curve3::Line {
        p: p(-4, 3, 0),
        d: p(1, 0, 0),
    };
    let EdgeContact::Paves {
        finite,
        seam_multiplicity,
    } = a1::edge_carrier(&edge, &a, Limits::default()).unwrap()
    else {
        panic!()
    };
    assert_eq!(finite.len(), 1);
    assert!(finite[0].is_touch());
    assert_eq!(seam_multiplicity, None);
}
#[test]
fn oblique_and_offset_rows_refuse() {
    let c = cylinder(q(3), p(0, 0, 0));
    assert_eq!(
        a1::intersect(
            &plane(p(0, 0, 0), p(1, 0, 1), p(0, 1, 0)),
            &c,
            Limits::default()
        )
        .unwrap_err()
        .0,
        "boolean/ssi-row-unavailable:plane×cylinder/oblique"
    );
    assert_eq!(
        a1::intersect(
            &plane(p(1, 0, 0), p(1, 0, 0), p(0, 1, 0)),
            &cone(q(2), q(1)),
            Limits::default()
        )
        .unwrap_err()
        .0,
        "boolean/ssi-row-unavailable:plane×cone/parallel-offset"
    );
    // G14: sphere rows exist; an identical sphere is coincident, an oblique
    // plane and an offset cylinder (G16) refuse by name.
    let sphere =
        Carrier3::Sphere(wonky_geom::model::Sphere3::new(Frame::identity(), q(4)).unwrap());
    assert!(matches!(
        a1::intersect(&sphere, &sphere, Limits::default()).unwrap(),
        Intersection::Coincident
    ));
    assert_eq!(
        a1::intersect(&plane(p(0, 0, 0), p(1, 0, 1), p(0, 1, 0)), &sphere, Limits::default()).unwrap_err().0,
        "boolean/ssi-row-unavailable:plane×sphere/oblique"
    );
    assert_eq!(
        a1::intersect(&sphere, &cylinder(q(1), p(1, 0, 0)), Limits::default()).unwrap_err().0,
        "boolean/ssi-row-unavailable:sphere×cylinder/offset"
    );
}
#[test]
fn coincidence_rims_seams_and_no_epsilon_welding() {
    let c = cylinder(q(3), p(0, 0, 0));
    assert!(matches!(
        a1::intersect(&c, &c, Limits::default()).unwrap(),
        Intersection::Coincident
    ));
    let rim = Curve3::Circle(Circle3::new(Frame::identity(), q(9)).unwrap());
    assert!(matches!(
        a1::edge_carrier(&rim, &c, Limits::default()).unwrap(),
        EdgeContact::OnCarrier
    ));
    let tangent = plane(p(-3, 0, 0), p(1, 0, 0), p(0, 1, 0));
    let EdgeContact::Paves {
        finite,
        seam_multiplicity,
    } = a1::edge_carrier(&rim, &tangent, Limits::default()).unwrap()
    else {
        panic!()
    };
    assert!(finite.is_empty());
    assert_eq!(seam_multiplicity, Some(2));
    let gap = Q::new(1.into(), (1_i64 << 30).into());
    assert!(section(&c, &cylinder(q(3), [q(6) + &gap, q(0), q(0)]))
        .0
        .is_empty());
    assert_eq!(
        section(&c, &cylinder(q(3), [q(6) - gap, q(0), q(0)]))
            .0
            .len(),
        2
    );
}
#[test]
fn rational_heights_apex_and_frame_covariance() {
    let cone = cone(q(2), q(1));
    let (b, _) = section(&plane(p(0, 0, -2), p(0, 0, 1), p(1, 0, 0)), &cone);
    assert!(matches!(b[0].curve, Branch::Point(_)));
    let (b, _) = section(&plane(p(0, 0, 3), p(0, 0, 1), p(1, 0, 0)), &cone);
    assert!(matches!(b[0].curve, Branch::Circle { .. }));
    // Rational nonorthonormal common construction frame (axis .1,.2,.3).
    let frame = Frame::new(
        p(100, 200, 300),
        [
            p(3, 0, -1),
            p(-2, 5, -6),
            [q(1) / q(10), q(2) / q(10), q(3) / q(10)],
        ],
    )
    .unwrap();
    let a = Carrier3::Cylinder(Cylinder3::new(frame.clone(), q(9)).unwrap());
    let bframe = Frame::new(frame.point(&p(5, 0, 0)), frame.columns().clone()).unwrap();
    let b = Carrier3::Cylinder(Cylinder3::new(bframe, q(4)).unwrap());
    let (bs, _) = section(&a, &b);
    assert_eq!(bs.len(), 1);
    assert_eq!(bs[0].multiplicity, 2);
    let world_plane = plane(
        frame.point(&p(0, 0, 2)),
        wonky_geom::cross(&frame.columns()[0], &frame.columns()[1]),
        frame.columns()[0].clone(),
    );
    assert_eq!(section(&world_plane, &a).0.len(), 1);
}
#[test]
fn quadratic_paves_and_algebraic_fallback_compare_exactly() {
    let sqrt2 = a1::roots(&Polynomial::from_integers(&[-2, 0, 1]), Limits::default()).unwrap();
    assert!(matches!(sqrt2[1].parameter, Parameter::Quadratic(_)));
    // Same positive root represented by a different polynomial: gcd equality.
    let quartic = a1::roots(
        &Polynomial::from_integers(&[-6, 0, 1, 0, 1]),
        Limits::default(),
    )
    .unwrap();
    assert!(matches!(quartic[1].parameter, Parameter::Algebraic(_)));
    assert_eq!(
        sqrt2[1].cmp(&quartic[1], Limits::default()).unwrap(),
        Ordering::Equal
    );
    assert!(a1::roots(
        &Polynomial::from_integers(&[-2, 0, 0, 0, 1]),
        Limits { max_bisections: 0 }
    )
    .is_err());
    // Actual circle x cylinder substitution is quartic in the incident circle.
    let circle = Curve3::Circle(Circle3::new(Frame::identity(), q(4)).unwrap());
    let axis = Frame::new(p(1, 0, 0), [p(1, 0, 0), p(0, 0, 1), p(0, 1, 0)]).unwrap();
    let cylinder = Carrier3::Cylinder(Cylinder3::new(axis, q(1)).unwrap());
    let EdgeContact::Paves { finite, .. } =
        a1::edge_carrier(&circle, &cylinder, Limits::default()).unwrap()
    else {
        panic!()
    };
    assert!(!finite.is_empty());
    assert!(finite
        .iter()
        .all(|p| matches!(p.parameter, Parameter::Algebraic(_))));
}
#[test]
fn quadratic_heights_and_radii_from_exact_affine_metric() {
    let a = cone(q(0), q(1));
    // Rational frame columns, radial metric scale sqrt(2). Carrier coefficients
    // stay rational; intersection height AND radius leave Q. No tag-based assumption.
    let f = Frame::new(p(0, 0, 0), [p(1, 1, 0), p(-1, 1, 0), p(0, 0, 1)]).unwrap();
    let b = Carrier3::Cylinder(Cylinder3::new(f, q(1)).unwrap());
    let (bs, _) = section(&a, &b);
    assert_eq!(bs.len(), 2);
    for branch in bs {
        let Branch::Circle { height, radius, .. } = branch.curve else {
            panic!()
        };
        assert!(height.rational().is_none());
        assert!(radius.rational().is_none());
        assert_eq!((&height * &height).rational(), Some(q(2)));
    }
    let pc = plane(p(0, 0, 0), p(3, 4, 0), p(0, 0, 1));
    assert_eq!(section(&pc, &cylinder(q(3), p(0, 0, 0))).0.len(), 2);
}
#[test]
fn higher_order_edge_contact_refuses_instead_of_reporting_a_touch() {
    let edge = Curve3::Circle(Circle3::new(Frame::identity(), q(4)).unwrap());
    // Affine cylinder (2x+3)^2+y^2=1. On x^2+y^2=4 its
    // restriction is 3(x+2)^2: fourth-order contact at the seam x=-2.
    let f = Frame::new(
        [q(-3) / q(2), q(0), q(0)],
        [[q(1) / q(2), q(0), q(0)], p(0, 1, 0), p(0, 0, 1)],
    )
    .unwrap();
    let c = Carrier3::Cylinder(Cylinder3::new(f, q(1)).unwrap());
    assert_eq!(
        a1::edge_carrier(&edge, &c, Limits::default())
            .unwrap_err()
            .0,
        "boolean/higher-order-contact"
    );
    let roots = a1::roots(
        &Polynomial::from_integers(&[0, 0, 0, 0, 1]),
        Limits::default(),
    )
    .unwrap();
    assert_eq!(roots.len(), 1);
    assert_eq!(roots[0].multiplicity, 4);
}

#[test]
fn radical_model_inputs_refuse_before_rational_a1_dispatch() {
    use wonky_geom::model::{algebraic::lift, RadicalPlane3};
    let root = wonky_curve::radical::Radical::quadratic(q(0), q(1), q(2)).unwrap();
    let radical = Carrier3::RadicalPlane(RadicalPlane3 {
        o: [root.clone(), q(0).into(), q(0).into()],
        n: lift(&p(1, 0, 0)), x: lift(&p(0, 1, 0)),
    });
    let rational = cylinder(q(2), p(0, 0, 0));
    for (a, b) in [(&radical, &rational), (&rational, &radical)] {
        assert_eq!(a1::intersect(a, b, Limits::default()).unwrap_err().0,
            "model/radical-plane/rational-implicit");
    }
    let edge = Curve3::RadicalLine {
        p: [root, q(0).into(), q(0).into()], d: lift(&p(0, 0, 1)),
    };
    assert_eq!(a1::edge_carrier(&edge, &rational, Limits::default()).unwrap_err().0,
        "boolean/ssi-row-unavailable:radical-line/A1");
    let branch = Branch::Line { p: lift(&p(0, 0, 0)), d: lift(&p(0, 0, 1)) };
    assert_eq!(branch.lies_on(&radical).unwrap_err().0,
        "model/radical-plane/rational-implicit");
}
#[test]
fn zero_normal_plane_is_refused_not_an_identically_satisfied_carrier() {
    // Predicate audit 2026-10-02: Plane3 has public fields, and n = 0 makes the
    // implicit identically zero. edge_carrier then proved every edge OnCarrier,
    // Branch::lies_on held for any branch and intersect panicked in normalized().
    let degenerate = plane(p(0, 0, 0), p(0, 0, 0), p(1, 0, 0));
    let edge = Curve3::Line {
        p: p(5, 7, 11),
        d: p(1, 2, 3),
    };
    assert!(a1::edge_carrier(&edge, &degenerate, Limits::default()).is_err());
    let Carrier3::Plane(pl) = &degenerate else { unreachable!() };
    let radical = Carrier3::RadicalPlane(pl.into());
    for carrier in [&degenerate, &radical] {
        assert_eq!(carrier.exact_plane().unwrap_err().0, "model/degenerate-carrier");
        assert_eq!(carrier.contains_point(&p(5, 7, 11)).unwrap_err().0,
            "model/degenerate-carrier");
        assert_eq!(carrier.contains_curve(&edge).unwrap_err().0,
            "model/degenerate-carrier");
    }
    let branch = Branch::Line {
        p: p(5, 7, 11).map(Into::into),
        d: p(1, 2, 3).map(Into::into),
    };
    assert!(branch.lies_on(&degenerate).is_err());
    let c = cylinder(q(3), p(0, 0, 0));
    for (a, b) in [(&degenerate, &c), (&c, &degenerate)] {
        assert!(a1::intersect(a, b, Limits::default()).is_err());
    }
}
