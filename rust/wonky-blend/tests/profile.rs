//! Independent exact section checks; no production-admission claim.
use wonky_blend::profile::{construct, Carrier};
use wonky_curve::{
    numeric::{q, Q},
    radical::{self, Radical},
    Carrier as Curve, ExactPoint, Trimmed,
};
use wonky_geom::model::VertexDef;
fn p(x: f64, y: f64) -> ExactPoint {
    ExactPoint::from_f64([x, y])
}
fn source() -> (Trimmed, Trimmed) {
    let arc = Trimmed::arc_through([-3., 4.], [0., -5.], [3., 4.]).unwrap();
    let line = Trimmed::new([p(3., 4.), p(-3., 4.)], Curve::Line).unwrap();
    (arc, line)
}
#[test]
fn quadratic_spine_and_springs_are_incident_without_rounding() {
    let (arc, line) = source();
    for (prev, next) in [(&arc, &line), (&line, &arc)] {
        let joint = construct(prev, next, &q(0.5), true).unwrap();
        let Carrier::Cylinder {
            center, radius2, ..
        } = &joint.carrier
        else {
            panic!("cylinder")
        };
        // Independent solution: x² + 3.5² = 4.5², hence x = +/-sqrt8.
        let expected = ExactPoint::from_quadratic(
            [q(0.), q(3.5)],
            [
                q(if matches!(prev.chart(), wonky_curve::Chart::Circle(_)) {
                    1.
                } else {
                    -1.
                }),
                q(0.),
            ],
            q(8.),
        )
        .unwrap();
        assert_eq!(center, &expected);
        assert_eq!(radius2, &q(0.25));
        assert!(matches!(center, ExactPoint::Quadratic(_)));
        let vertex = joint.spine_vertex(q(7.)).unwrap();
        assert!(matches!(vertex, VertexDef::Quadratic(_)));
        let key = vertex.key().unwrap();
        let xyz = key.coordinates();
        assert_eq!(xyz[0], center.coordinates()[0]);
        assert_eq!(xyz[1], Radical::from(q(3.5)));
        assert_eq!(xyz[2], Radical::from(q(7.)));
        for (support, spring) in [prev, next].into_iter().zip(&joint.springs) {
            assert!(support.contains(spring).unwrap());
            let d = spring.difference(center);
            assert_eq!(radical::dot(&d, &d), Radical::from(q(0.25)));
        }
        assert_eq!(
            joint.trimmed().unwrap_err().0,
            "curve2/crossing-needs-algebraic-vertex"
        );
    }
}
#[test]
fn rational_contacts_preserve_the_historical_profile_section() {
    let (arc, line) = source();
    let joint = construct(&arc, &line, &q(2.5), true).unwrap();
    assert_eq!(joint.springs, [p(4., 3.), p(2., 4.)]);
    let Carrier::Cylinder {
        center, radius2, ..
    } = &joint.carrier
    else {
        panic!("cylinder")
    };
    assert_eq!(center, &p(2., 1.5));
    assert_eq!(radius2, &q(6.25));
    let trim = joint.trimmed().unwrap();
    for spring in &joint.springs {
        assert!(trim.contains(spring).unwrap());
    }
}
#[test]
fn parallel_cylinder_sections_use_the_same_offset_intersection() {
    let a = Trimmed::arc_through([0., -4.], [2., 0.], [0., 4.]).unwrap();
    let b = Trimmed::arc_through([0., 4.], [-2., 0.], [0., -4.]).unwrap();
    let joint = construct(&a, &b, &q(1.25), true).unwrap();
    joint.validate(&a, &b).unwrap();
    assert_eq!(joint.springs, [p(1., 3.), p(-1., 3.)]);
    let reverse = construct(&b.reversed(), &a.reversed(), &q(1.25), true).unwrap();
    assert_eq!(reverse.springs, [p(-1., 3.), p(1., 3.)]);
}
#[test]
fn chamfer_plane_retains_quadratic_setback_contacts() {
    let (arc, line) = source();
    let joint = construct(&arc, &line, &q(0.5), false).unwrap();
    assert!(matches!(joint.carrier, Carrier::Plane));
    assert!(joint.springs.iter().any(|p| p.rat().is_err()));
    let corner = p(3., 4.);
    for spring in &joint.springs {
        let d = spring.difference(&corner);
        assert_eq!(radical::dot(&d, &d), Radical::from(q(0.25)));
    }
    let chord = joint.trimmed().unwrap();
    assert_eq!(chord.ends(), &joint.springs);
}
#[test]
fn rounded_tangent_length_breaks_exact_v3_incidence() {
    use num_traits::ToPrimitive;
    let zero = q(0.);
    let third = Q::new(1.into(), 3.into());
    let len = &third * q(5.);
    let exact = Trimmed::new(
        [
            ExactPoint::from_rational([zero.clone(), zero.clone()]),
            ExactPoint::from_rational([third.clone() * q(3.), third.clone() * q(4.)]),
        ],
        Curve::Line,
    )
    .unwrap();
    let normal = [-q(4.) / q(5.), q(3.) / q(5.)];
    let offset = construct_offset(&exact, &normal);
    let rounded = q(len.to_f64().unwrap());
    assert_ne!(rounded, len);
    let bad_normal = [-(&third * q(4.)) / &rounded, (&third * q(3.)) / rounded];
    let mutant = construct_offset(&exact, &bad_normal);
    // Offset points must be exactly at unit normal distance, not near it.
    for (curve, valid) in [(&offset, true), (&mutant, false)] {
        let d = curve.ends()[0].difference(&exact.ends()[0]);
        assert_eq!(radical::dot(&d, &d) == Radical::from(q(1.)), valid);
    }
    let next = Trimmed::new(
        [
            exact.ends()[1].clone(),
            ExactPoint::from_rational([q(1.), q(4.) / q(3.) + q(2.)]),
        ],
        Curve::Line,
    )
    .unwrap();
    // The planted feature changes the production tangent length before offset.
    let joint = construct(&exact, &next, &q(0.1), true).unwrap();
    let Carrier::Cylinder { center, .. } = &joint.carrier else {
        panic!("cylinder")
    };
    let wrong_normal = [
        -(&third * q(4.)) / &q(len.to_f64().unwrap()),
        (&third * q(3.)) / q(len.to_f64().unwrap()),
    ];
    let mut mutant = joint.clone();
    mutant.springs[0] = ExactPoint::from_coordinates(std::array::from_fn(|k| {
        center.coordinates()[k].clone() - &wrong_normal[k] * q(0.1)
    }))
    .unwrap();
    assert_eq!(
        mutant.validate(&exact, &next).unwrap_err().0,
        "profile-blend/contract-violation:V3/contact-incidence"
    );
}
fn construct_offset(line: &Trimmed, normal: &[Q; 2]) -> Trimmed {
    Trimmed::new(
        line.ends().clone().map(|p| {
            let r = p.rat().unwrap();
            ExactPoint::from_rational([&r[0] + &normal[0], &r[1] + &normal[1]])
        }),
        Curve::Line,
    )
    .unwrap()
}
#[test]
fn irrational_length_normal_has_a_named_refusal() {
    let a = Trimmed::line([0., 0.], [1., 1.]);
    let b = Trimmed::line([1., 1.], [1., 3.]);
    assert_eq!(
        construct(&a, &b, &q(0.1), true).unwrap_err().0,
        "profile-blend/tangent-length-not-rational"
    );
}

#[test]
fn extruded_quadratic_sections_build_analytic_faces() {
    use wonky_blend::profile::StripeFace;
    use wonky_geom::model::Provenance;
    let (arc, line) = source();
    for fillet in [true, false] {
        let joint = construct(&arc, &line, &q(0.5), fillet).unwrap();
        let face = joint
            .extrude([q(2.), q(7.)], Provenance { node: 3, slot: 0 })
            .unwrap();
        match face {
            StripeFace::Cylinder(face) => {
                let wonky_blend::fillet::Carrier::Cylinder {
                    origin, radius2, ..
                } = face.carrier
                else {
                    panic!("cylinder")
                };
                assert_eq!(&origin[0] * &origin[0], Radical::from(q(8.)));
                assert_eq!(radius2, q(0.25));
                assert_eq!(face.loops[0].len(), 4);
                for piece in &face.loops[0] {
                    if let Some(arc) = &piece.arc {
                        for p in [&piece.start, &piece.end] {
                            let d = radical::sub(
                                &[p[0].clone(), p[1].clone()],
                                &[arc.center[0].clone(), arc.center[1].clone()],
                            );
                            assert_eq!(radical::dot(&d, &d), Radical::from(q(0.25)));
                        }
                    }
                }
            }
            StripeFace::Plane(face) => {
                assert_eq!(face.loops[0].len(), 4);
                assert!(face.loops[0]
                    .iter()
                    .all(|p| face.plane.side(p) == Radical::default()));
                assert_eq!(face.provenance, Provenance { node: 3, slot: 0 });
            }
        }
    }
}

#[test]
fn parallel_cylinder_quadratic_spine_stays_in_one_field() {
    let a = Trimmed::arc_through([0., -4.], [2., 0.], [0., 4.]).unwrap();
    let b = Trimmed::arc_through([0., 4.], [-2., 0.], [0., -4.]).unwrap();
    let joint = construct(&a, &b, &q(0.5), true).unwrap();
    let Carrier::Cylinder { center, .. } = &joint.carrier else {
        panic!("cylinder")
    };
    let expected = ExactPoint::from_quadratic([q(0.), q(0.)], [q(0.), q(1.)], q(11.25)).unwrap();
    assert_eq!(center, &expected);
    assert!(matches!(
        joint.spine_vertex(q(0.)).unwrap(),
        VertexDef::Quadratic(_)
    ));
    joint.validate(&a, &b).unwrap();
}
