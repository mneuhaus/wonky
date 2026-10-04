//! Public geometry contract: exact incidence, section multiplicity and chart
//! pullback. Expected equations are independent implicit support equations.
use num_traits::{One, Zero};
use std::cmp::Ordering;
use wonky_geom::{
    binary64, dot,
    frame::{Frame, RelationClass},
    point,
    ssi::*,
    Real, Q,
};
fn q(n: i64) -> Q {
    Q::from_integer(n.into())
}
fn p(a: [i64; 3]) -> [Q; 3] {
    a.map(q)
}
fn plane(normal: [i64; 3], offset: i64) -> Plane {
    Plane::new(Frame::identity(), p(normal), q(offset)).unwrap()
}
fn kind(c: &Curve) -> Conic {
    match c {
        Curve::Harmonic { kind, .. } | Curve::RationalHarmonic { kind, .. } => *kind,
        _ => panic!("expected conic"),
    }
}
#[test]
fn frame_relations_preserve_exact_roundtrips_but_reject_nonisometric_curves() {
    let id = Frame::identity();
    let rotation = Frame::new(
        p([7, -3, 2]),
        [
            [q(3) / q(5), q(4) / q(5), q(0)],
            [-q(4) / q(5), q(3) / q(5), q(0)],
            p([0, 0, 1]),
        ],
    )
    .unwrap();
    let perm = Frame::new(p([1, 2, 3]), [p([0, 0, 1]), p([1, 0, 0]), p([0, 1, 0])]).unwrap();
    let shear = Frame::new(p([2, 3, 4]), [p([1, 0, 0]), p([1, 1, 0]), p([0, 0, 1])]).unwrap();
    for (f, expected) in [
        (&id, RelationClass::R0Identical),
        (&perm, RelationClass::R1PermutationTranslation),
        (&rotation, RelationClass::R2RationalRotation),
        (&shear, RelationClass::R3Affine),
    ] {
        let r = id.relation_from(f);
        assert_eq!(r.class, expected);
        let input = [q(7) / q(11), q(-5) / q(13), q(17) / q(19)];
        let result = f.inverse().point(&r.map.point(&input));
        for i in 0..3 {
            assert_eq!(result[i], input[i]);
        }
    }
    // 0.6/0.8 interpreted as binary64 is NOT the exact rational 3/5,4/5.
    let rounded = Frame::new(
        p([0, 0, 0]),
        [
            point([0.6, 0.8, 0.]).unwrap(),
            point([-0.8, 0.6, 0.]).unwrap(),
            p([0, 0, 1]),
        ],
    )
    .unwrap();
    let relation = id.relation_from(&rounded);
    assert_eq!(relation.class, RelationClass::R3Affine);
    assert_eq!(
        relation.require_isometry().unwrap_err().0,
        "frame/non-isometric-curved-image"
    );
    assert!(id.relation_from(&rotation).require_isometry().is_ok());
    assert_eq!(
        Frame::new(p([0, 0, 0]), [p([1, 0, 0]), p([1, 0, 0]), p([0, 0, 1])])
            .unwrap_err()
            .0,
        "frame/singular"
    );
}
#[test]
fn rule_p_cylinder_sections_obey_both_exact_supports_and_plane_pcurves() {
    // Deliberate R3 shear: transporting the cylinder into the plane frame as a
    // circle would be wrong; pull the plane into the cylinder frame instead.
    let frame = Frame::new(p([1, 2, 3]), [p([2, 0, 0]), p([1, 1, 0]), p([0, 0, 1])]).unwrap();
    let cylinder = Cylinder::new(frame.clone(), q(2)).unwrap();
    let plane = plane([1, 2, 3], 11);
    let section = plane_cylinder(&plane, &cylinder).unwrap();
    assert_eq!(kind(&section.curve), Conic::Ellipse);
    let ts = [None, Some(q(0)), Some(q(1)), Some(q(-1)), Some(q(3) / q(7))];
    for t in &ts {
        let point = section.point(t.as_ref()).unwrap();
        assert_eq!(&point[0] * &point[0] + &point[1] * &point[1], q(4));
        let world = frame.point(&point);
        assert_eq!(dot(&p([1, 2, 3]), &world), q(11));
        let pc = section.plane_pcurve(t.as_ref()).unwrap();
        assert_eq!(pc[0], world[1]);
        assert_eq!(pc[1], world[2]);
    }
    let horizontal = Plane::new(Frame::identity(), p([0, 0, 1]), q(5)).unwrap();
    let circle = plane_cylinder(&horizontal, &cylinder).unwrap();
    assert_eq!(kind(&circle.curve), Conic::Circle);
    assert_eq!(circle.point(None).unwrap()[2], q(2));
}

// Expand a polynomial of a+b sqrt(d) independently of the SSI evaluator.
fn square(value: &Real) -> (Q, Q) {
    let (a, b, d) = value.coefficients();
    (a * a + b * b * d, q(2) * a * b)
}
#[test]
fn generator_multiplicity_and_subulp_ellipses_are_exact() {
    let cylinder = Cylinder::new(Frame::identity(), q(2)).unwrap();
    for (offset, expected) in [(2f64.next_down(), 2), (2., 1), (2f64.next_up(), 0)] {
        let p = Plane::new(Frame::identity(), p([1, 0, 0]), binary64(offset).unwrap()).unwrap();
        let section = plane_cylinder(&p, &cylinder).unwrap();
        let lines = match &section.curve {
            Curve::Empty => {
                assert_eq!(expected, 0);
                continue;
            }
            Curve::Lines(lines) => lines,
            _ => panic!("expected generators"),
        };
        assert_eq!(lines.len(), expected);
        for (i, line) in lines.iter().enumerate() {
            let point = line.point(&q(3)).unwrap();
            let (a, b) = square(&point[0]);
            let (c, d) = square(&point[1]);
            assert_eq!(a + c, q(4));
            assert!((b + d).is_zero());
            assert_eq!(point[0].coefficients().0, &binary64(offset).unwrap());
            assert!(point[0].coefficients().1.is_zero());
            let pc = section.line_plane_pcurve(i, &q(3)).unwrap();
            // Plane chart is (y,z), so a discarded generator branch is visible.
            assert_eq!(pc[0].sign(), point[1].sign());
            assert_eq!(pc[1].coefficients().0, &q(3));
        }
    }
    let tiny = binary64(f64::from_bits(1)).unwrap();
    let plane = Plane::new(Frame::identity(), [tiny.clone(), q(0), q(1)], q(1)).unwrap();
    let section = plane_cylinder(&plane, &cylinder).unwrap();
    assert_eq!(kind(&section.curve), Conic::Ellipse);
    assert_eq!(section.point(Some(&q(0))).unwrap()[2], q(1) - q(2) * tiny);
}
#[test]
fn two_ring_cone_conics_have_exact_incidence_and_named_poles() {
    let cone = ConeRings::new(Frame::identity(), [(q(0), q(2)), (q(4), q(4))]).unwrap();
    // Radius is 2+z/2, not tan(an approximately represented semi-angle).
    for (n, d, expected) in [
        ([0, 0, 1], 2, Conic::Circle),
        ([1, 0, 1], 2, Conic::Ellipse),
        ([2, 0, 1], 2, Conic::Parabola),
        ([3, 0, 1], 2, Conic::Hyperbola),
    ] {
        let section = plane_cone(&plane(n, d), &cone).unwrap();
        assert_eq!(kind(&section.curve), expected);
        for t in [None, Some(q(0)), Some(q(1)), Some(q(-1)), Some(q(2) / q(3))] {
            let result = section.point(t.as_ref());
            if expected == Conic::Parabola && t.is_none() {
                assert_eq!(result.unwrap_err().0, "ssi/cone/parameter-pole");
                continue;
            }
            let v = result.unwrap();
            assert_eq!(dot(&p(n), &v), q(d));
            let radius = q(2) + &v[2] / q(2);
            assert_eq!(&v[0] * &v[0] + &v[1] * &v[1], &radius * &radius);
        }
    }
    assert_eq!(
        ConeRings::new(Frame::identity(), [(q(1), q(2)), (q(1), q(3))])
            .unwrap_err()
            .0,
        "carrier/coincident-ring-heights"
    );
    assert_eq!(
        Cylinder::new(Frame::identity(), q(0)).unwrap_err().0,
        "carrier/non-positive-radius"
    );
}
#[test]
fn cone_apex_sections_keep_zero_one_or_two_generators() {
    let cone = ConeRings::new(Frame::identity(), [(q(0), q(0)), (q(3), q(3))]).unwrap();
    for (n, count) in [([0, 0, 1], 0), ([1, 0, 1], 1), ([2, 0, 1], 2)] {
        let section = plane_cone(&plane(n, 0), &cone).unwrap();
        let Curve::Lines(lines) = section.curve else {
            assert_eq!(count, 0);
            assert!(matches!(section.curve, Curve::Point(_)));
            continue;
        };
        assert_eq!(lines.len(), count);
        for line in lines {
            let v = line.point(&q(7)).unwrap();
            let (a, b) = square(&v[0]);
            let (c, d) = square(&v[1]);
            let (e, f) = square(&v[2]);
            assert!((a + c - e).is_zero());
            assert!((b + d - f).is_zero());
            let rational: Q = (0..3).map(|i| q(n[i]) * v[i].coefficients().0).sum();
            let root: Q = (0..3).map(|i| q(n[i]) * v[i].coefficients().1).sum();
            assert!(rational.is_zero());
            assert!(root.is_zero());
        }
    }
}
#[test]
fn rational_root_sign_retains_cancellation_and_refuses_a_second_root_field() {
    // This difference rounds to zero in binary64, but its sign is positive.
    let large = q(1_000_000_000);
    let root = Real::new(-large.clone(), Q::one(), &large * &large + q(1)).unwrap();
    assert_eq!(root.sign(), Ordering::Greater);
    assert_eq!(
        root.shifted_scaled(&Q::zero(), &q(-1)).sign(),
        Ordering::Less
    );
    let zero = Real::new(q(-3) / q(7), q(1) / q(7), q(9)).unwrap();
    assert_eq!(zero.sign(), Ordering::Equal);
    let second = Real::new(q(0), q(1), q(2)).unwrap();
    assert!(root.plus(&second).is_none());
    assert!(Real::new(q(0), q(1), q(-1)).is_none());
}
