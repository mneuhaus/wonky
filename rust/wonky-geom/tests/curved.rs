use num_traits::{One, Zero};
use wonky_geom::{
    cross,
    frame::Frame,
    model::{
        curved::{revolution_transition, Patch},
        Carrier3, Circle3, Cone3, Curve3, Cylinder3, QuadraticPoint3, Sphere3, VertexDef,
        VertexKey,
    },
    point, Point, Q,
};
fn q(n: i64) -> Q {
    Q::from_integer(n.into())
}
fn ratio(n: i64, d: i64) -> Q {
    Q::new(n.into(), d.into())
}
fn frame() -> Frame {
    let a = point([0.1, 0.2, 0.3]).unwrap();
    let x = [a[1].clone(), -a[0].clone(), Q::zero()];
    Frame::new(
        point([0.25, -0.75, 2.]).unwrap(),
        [x.clone(), cross(&a, &x), a],
    )
    .unwrap()
}
fn carriers(f: Frame) -> [Carrier3; 3] {
    [
        Carrier3::Cylinder(Cylinder3::new(f.clone(), q(4)).unwrap()),
        Carrier3::Cone(Cone3::new(f.clone(), [(q(0), q(1)), (q(10), q(3))]).unwrap()),
        Carrier3::Sphere(Sphere3::new(f, q(4)).unwrap()),
    ]
}

#[test]
fn thousand_chart_points_per_carrier_satisfy_implicit_exactly() {
    for carrier in carriers(frame()) {
        for i in 0..1000 {
            let patch = if i % 2 == 0 {
                Patch::First
            } else {
                Patch::Second
            };
            let t = ratio((i % 101) as i64 - 50, 100);
            let v = match &carrier {
                Carrier3::Sphere(_) => ratio((i % 97) as i64 - 48, 100),
                Carrier3::Cylinder(_) | Carrier3::Cone(_) => ratio(i as i64, 100),
                Carrier3::Plane(_) | Carrier3::RadicalPlane(_) | Carrier3::TranslatedCylinder(_) | Carrier3::Rotated(_) | Carrier3::Torus(_) => unreachable!(),
            };
            let uv = [t, v];
            let p = carrier.chart_point(patch, &uv).unwrap();
            let local = frame().inverse().point(&p);
            let radial = &local[0] * &local[0] + &local[1] * &local[1];
            match &carrier {
                Carrier3::Cylinder(_) => assert_eq!(radial, q(4)),
                Carrier3::Cone(_) => {
                    let r = q(1) + &local[2] / q(5);
                    assert_eq!(radial, &r * &r);
                }
                Carrier3::Sphere(_) => assert_eq!(radial + &local[2] * &local[2], q(4)),
                Carrier3::Plane(_) | Carrier3::RadicalPlane(_) | Carrier3::TranslatedCylinder(_) | Carrier3::Rotated(_) | Carrier3::Torus(_) => unreachable!(),
            }
            assert_eq!(
                carrier.implicit().unwrap().evaluate(&p),
                Q::zero(),
                "{carrier:?} at {i}"
            );
            assert_eq!(carrier.chart_coordinates(patch, &p).unwrap(), uv);
        }
    }
}
#[test]
fn rounded_normalisation_is_not_an_exact_frame_relation() {
    let axis = [0.1_f64, 0.2, 0.3];
    let norm = axis.iter().map(|a| a * a).sum::<f64>().sqrt();
    let normalised = point(axis.map(|a| a / norm)).unwrap();
    assert_ne!(wonky_geom::dot(&normalised, &normalised), Q::one());
    let f = frame();
    let carrier = carriers(f.clone())[0].clone();
    let true_point = carrier
        .chart_point(Patch::First, &[ratio(1, 3), q(7)])
        .unwrap();
    let nx = [normalised[1].clone(), -normalised[0].clone(), Q::zero()];
    let columns = [nx.clone(), cross(&normalised, &nx), normalised];
    let false_frame = Frame::new(f.origin().clone(), columns).unwrap();
    assert!(!false_frame.is_isometry());
    let wrong = false_frame.point(&[q(2), q(0), q(7)]);
    assert!(!carrier.contains_point(&wrong).unwrap());
    // Reusing an f64-normalised chart's radial columns silently moves the
    // point off the original exact cylinder. One ulp is enough to reject it.
    let mut p = true_point.clone();
    p[0] = &p[0] + Q::from_float(f64::EPSILON).unwrap();
    assert!(!carrier.contains_point(&p).unwrap());
}
#[test]
fn virtual_seams_round_trip_without_vertices_or_edges() {
    for c in carriers(frame()) {
        for from in [Patch::First, Patch::Second] {
            let seams: Vec<[Q; 2]> = match &c {
                Carrier3::Sphere(_) => vec![[Q::one(), Q::zero()], [Q::zero(), Q::one()]],
                Carrier3::Cylinder(_) | Carrier3::Cone(_) => vec![[q(-1), q(2)], [q(1), q(2)]],
                Carrier3::Plane(_) | Carrier3::RadicalPlane(_) | Carrier3::TranslatedCylinder(_) | Carrier3::Rotated(_) | Carrier3::Torus(_) => unreachable!(),
            };
            for uv in seams {
                let a = c.transition(from, &uv).unwrap();
                assert_eq!(
                    c.chart_point(from, &uv).unwrap(),
                    c.chart_point(a.patch, &a.uv).unwrap()
                );
                let b = c.transition(a.patch, &a.uv).unwrap();
                assert_eq!(b.patch, from);
                assert_eq!(b.uv, uv);
                assert_eq!(a.winding_delta + b.winding_delta, 0);
            }
        }
    }
    assert!(revolution_transition(Patch::First, &[ratio(1, 2), q(0)]).is_err());
}
#[test]
fn whole_curve_identity_rejects_intersections_disguised_as_incidence() {
    let f = Frame::identity();
    let cylinder = carriers(f.clone())[0].clone();
    let circle = Curve3::Circle(Circle3::new(f.clone(), q(4)).unwrap());
    assert!(cylinder.contains_curve(&circle).unwrap());
    assert!(carriers(f.clone())[2].contains_curve(&circle).unwrap());
    let generator = Curve3::Line {
        p: [q(2), q(0), q(0)],
        d: [q(0), q(0), q(1)],
    };
    assert!(cylinder.contains_curve(&generator).unwrap());
    let secant = Curve3::Line {
        p: [q(2), q(0), q(0)],
        d: [q(1), q(0), q(0)],
    };
    assert!(cylinder.contains_point(&[q(2), q(0), q(0)]).unwrap());
    assert!(!cylinder.contains_curve(&secant).unwrap());
    let translated = Frame::new([q(1), q(0), q(0)], f.columns().clone()).unwrap();
    assert!(!cylinder.contains_curve(&Curve3::Circle(Circle3::new(translated, q(4)).unwrap())).unwrap());
    let cone = carriers(f.clone())[1].clone();
    let ring_frame = Frame::new([q(0), q(0), q(5)], f.columns().clone()).unwrap();
    assert!(cone.contains_curve(&Curve3::Circle(Circle3::new(ring_frame, q(4)).unwrap())).unwrap());
}
#[test]
fn curve_identity_is_preserved_under_exact_affine_placement() {
    let f = frame();
    let cylinder = carriers(f.clone())[0].clone();
    assert!(cylinder.contains_curve(&Curve3::Circle(Circle3::new(f.clone(), q(4)).unwrap())).unwrap());
    let p = f.point(&[q(2), q(0), q(0)]);
    let d = f.vector(&[q(0), q(0), q(1)]);
    assert!(cylinder.contains_curve(&Curve3::Line { p, d }).unwrap());
}
#[test]
fn quadratic_keys_merge_equivalent_roots_and_collapse_rational_points() {
    let p = QuadraticPoint3::new([q(1), q(2), q(3)], [q(2), q(0), q(1)], q(2)).unwrap();
    let same = QuadraticPoint3::new([q(1), q(2), q(3)], [q(1), q(0), ratio(1, 2)], q(8)).unwrap();
    assert_eq!(p.key(), same.key());
    assert_eq!(p.cmp(&same), std::cmp::Ordering::Equal);
    let rational = QuadraticPoint3::new([q(1), q(2), q(3)], [q(2), q(0), q(1)], q(4)).unwrap();
    assert_eq!(
        VertexDef::Quadratic(rational).key().unwrap(),
        VertexKey::Rational([q(5), q(2), q(5)])
    );
    assert!(QuadraticPoint3::new([q(0), q(0), q(0)], [q(1), q(1), q(1)], q(-1)).is_err());
}
#[test]
fn quadratic_incidence_uses_exact_polynomial_substitution() {
    let cylinder = carriers(Frame::identity())[0].clone();
    let p = QuadraticPoint3::new([q(0), q(1), q(5)], [q(1), q(0), q(0)], q(3)).unwrap();
    assert!(cylinder.contains_vertex(&p.key()).unwrap());
    let f = frame();
    let mapped = p.mapped(&f).unwrap();
    assert!(carriers(f)[0].contains_vertex(&mapped.key()).unwrap());
    let bad =
        QuadraticPoint3::new([ratio(1, 1 << 30), q(1), q(5)], [q(1), q(0), q(0)], q(3)).unwrap();
    assert!(!cylinder.contains_vertex(&bad.key()).unwrap());
}

#[test]
fn circle_point_identity_and_canonical_form_ignore_irrelevant_frame_axes() {
    let f = Frame::identity();
    let circle = Circle3::new(f.clone(), q(4)).unwrap();
    let alternate = Frame::new(
        [q(0), q(0), q(0)],
        [[q(0), q(1), q(0)], [q(-1), q(0), q(0)], [q(3), q(4), q(7)]],
    )
    .unwrap();
    assert_eq!(
        circle.canonical_data(),
        Circle3::new(alternate, q(4)).unwrap().canonical_data()
    );
    let reflected = Frame::new(
        [q(0), q(0), q(0)],
        [[q(1), q(0), q(0)], [q(0), q(-1), q(0)], [q(0), q(0), q(1)]],
    )
    .unwrap();
    let reflected = Circle3::new(reflected, q(4)).unwrap().canonical_data().unwrap();
    let original = circle.canonical_data().unwrap();
    assert_eq!(original.0, reflected.0);
    assert_eq!(original.1, reflected.1);
    assert_ne!(original.2, reflected.2);
    let p = QuadraticPoint3::new([q(0), q(1), q(0)], [q(1), q(0), q(0)], q(3)).unwrap();
    assert!(circle.contains_vertex(&p.key()).unwrap());
    let off_plane =
        QuadraticPoint3::new([q(0), q(1), ratio(1, 1 << 30)], [q(1), q(0), q(0)], q(3)).unwrap();
    assert!(!circle.contains_vertex(&off_plane.key()).unwrap());
    assert_ne!(
        original.1,
        Circle3::new(f, q(9)).unwrap().canonical_data().unwrap().1
    );
}
#[test]
fn singularities_and_unsupported_radius_classes_are_named() {
    assert_eq!(
        Cylinder3::new(Frame::identity(), q(12)).unwrap_err().0,
        "boolean/ssi-row-unavailable:chart/quadratic-radius"
    );
    assert!(Sphere3::new(Frame::identity(), q(0)).is_err());
    let cone = Carrier3::Cone(Cone3::new(Frame::identity(), [(q(0), q(0)), (q(2), q(2))]).unwrap());
    assert_eq!(
        cone.chart_point(Patch::First, &[q(0), q(0)]).unwrap_err().0,
        "boolean/chart-singularity:apex"
    );
    assert_eq!(
        carriers(Frame::identity())[2]
            .chart_coordinates(Patch::First, &[q(0), q(0), q(-2)])
            .unwrap_err()
            .0,
        "boolean/chart-singularity:pole"
    );
}
#[test]
fn world_polynomial_coefficients_equal_direct_evaluation() {
    for c in carriers(frame()) {
        let f = c.implicit().unwrap();
        let a = f.coefficients();
        for i in 0..20 {
            let p: Point = [ratio(i, 17), ratio(7 - i, 13), ratio(i + 1, 3)];
            let [x, y, z] = p.clone();
            assert_eq!(
                f.evaluate(&p),
                &a[0]
                    + &a[1] * &x
                    + &a[2] * &y
                    + &a[3] * &z
                    + &a[4] * &x * &x
                    + &a[5] * &x * &y
                    + &a[6] * &x * &z
                    + &a[7] * &y * &y
                    + &a[8] * &y * &z
                    + &a[9] * &z * &z
            );
        }
    }
}

#[test]
fn revolution_ring_models_pass_the_generic_audit_with_no_real_seams() {
    use wonky_geom::model::revolution::revolution;
    for (profile, volume, edges, faces) in [
        (
            vec![[q(0), q(0)], [q(2), q(0)], [q(2), q(10)], [q(0), q(10)]],
            q(240),
            2,
            3,
        ),
        (
            vec![[q(0), q(0)], [q(1), q(0)], [q(3), q(10)], [q(0), q(10)]],
            q(260),
            2,
            3,
        ),
        (
            vec![[q(0), q(0)], [q(3), q(10)], [q(0), q(10)]],
            q(180),
            1,
            2,
        ),
        (
            vec![[q(0), q(0)], [q(3), q(0)], [q(0), q(10)]],
            q(180),
            1,
            2,
        ),
        (
            vec![[q(1), q(0)], [q(3), q(0)], [q(3), q(10)], [q(1), q(10)]],
            q(480),
            4,
            4,
        ),
    ] {
        let model = revolution(Frame::identity(), Frame::identity(), &profile, 1)
            .unwrap()
            .check()
            .unwrap();
        let d = model.draft();
        assert_eq!(
            (d.vertices.len(), d.edges.len(), d.faces.len()),
            (0, edges, faces)
        );
        let v = model.volume6_pi().unwrap();
        assert_eq!(v[0].rational, q(0));
        assert_eq!(v[0].pi, volume);
        let mut bad = model.clone().into_draft();
        let co = bad.coedges.iter_mut().find(|c| c.atlas.is_some()).unwrap();
        co.atlas.as_mut().unwrap().pieces[1].winding_delta += 1;
        assert_eq!(bad.check().unwrap_err().0, "model/g3-atlas-transition");
    }
}

fn cube() -> wonky_geom::model::Model {
    use wonky_geom::model::{polyhedron, Plane3, PolyFace, Provenance};
    let mut faces = vec![];
    for axis in 0..3 {
        for upper in [false, true] {
            let a = (axis + 1) % 3;
            let b = (axis + 2) % 3;
            let mut o = [q(0), q(0), q(0)];
            o[axis] = if upper { q(10) } else { q(0) };
            let mut n = [q(0), q(0), q(0)];
            n[axis] = if upper { q(1) } else { q(-1) };
            let mut x = [q(0), q(0), q(0)];
            x[a] = q(1);
            let mut points = vec![];
            for (u, v) in [(0, 0), (10, 0), (10, 10), (0, 10)] {
                let mut p = o.clone();
                p[a] = q(u);
                p[b] = q(v);
                points.push(VertexDef::Rational(p));
            }
            if !upper {
                points.reverse();
            }
            faces.push(PolyFace {
                carrier: Plane3 { o, x, n },
                forward: true,
                loops: vec![points],
                provenance: Provenance {
                    node: 1,
                    slot: (axis * 2 + upper as usize) as u32,
                },
            });
        }
    }
    polyhedron(Frame::identity(), wonky_geom::model::Label::Exact, 1, faces)
        .unwrap()
        .check()
        .unwrap()
}

#[test]
fn round_trims_cover_through_blind_and_void_shells_with_exact_pi_volumes() {
    use wonky_geom::model::revolution::{bore_trims, Bore};
    for (extent, coefficient, shells, faces) in [
        ([q(-1), q(11)], q(-60), 1, 7),
        ([q(-1), q(5)], q(-30), 1, 8),
        ([q(2), q(8)], q(-36), 2, 9),
    ] {
        let carrier = Cylinder3::new(
            Frame::new([q(5), q(5), q(0)], Frame::identity().columns().clone()).unwrap(),
            q(1),
        )
        .unwrap();
        let model = bore_trims(&cube(), &[Bore { carrier, extent }], 2)
            .unwrap()
            .check()
            .unwrap();
        let v = model.volume6_pi().unwrap();
        assert_eq!(v[0].rational, q(6000));
        assert_eq!(v[0].pi, coefficient);
        assert_eq!(
            (
                model.draft().vertices.len(),
                model.draft().edges.len(),
                model.draft().shells.len(),
                model.draft().faces.len()
            ),
            (8, 14, shells, faces)
        );
    }
}

/// A rolling-ball carrier between supports with irrational-length normals:
/// centre (1, sqrt 2, 0), radius 2, axis z. Its frame refuses by name and its
/// incidences are decided exactly in the field of the centre.
#[test]
fn radical_centre_carriers_are_exact_or_refuse_by_name() {
    use wonky_curve::radical::Radical;
    let root2 = || Radical::quadratic(Q::zero(), Q::one(), q(2)).unwrap();
    let origin = [Radical::from(q(1)), root2(), Radical::default()];
    let axes = [[q(1), q(0), q(0)], [q(0), q(1), q(0)], [q(0), q(0), q(1)]];
    let cylinder = Cylinder3::about(origin.clone(), axes.clone(), q(4)).unwrap();
    let circle = Circle3::about(origin.clone(), axes.clone(), q(4)).unwrap();
    assert!(cylinder.is_radical() && circle.is_radical());
    assert_eq!(cylinder.frame().unwrap_err().0, "model/radical-centre-carrier");
    assert_eq!(circle.canonical_data().unwrap_err().0, "model/radical-centre-carrier");
    let at = |x: i64, dy: i64, z: i64| {
        QuadraticPoint3::from_coordinates([
            Radical::from(q(x)),
            root2() + Radical::from(q(dy)),
            Radical::from(q(z)),
        ])
        .unwrap()
        .key()
    };
    let carrier = Carrier3::Cylinder(cylinder.clone());
    assert!(carrier.contains_vertex(&at(3, 0, 7)).unwrap());
    assert!(carrier.contains_vertex(&at(1, -2, 0)).unwrap());
    assert!(!carrier.contains_vertex(&at(1, -1, 0)).unwrap());
    assert!(circle.contains_vertex(&at(1, 2, 0)).unwrap());
    assert!(!circle.contains_vertex(&at(1, 2, 1)).unwrap());
    // A rational point is never on it: the radial offset keeps a sqrt 2 part.
    assert!(!carrier.contains_vertex(&VertexKey::Rational([q(3), q(1), q(0)])).unwrap());
    let generator = Curve3::RadicalLine {
        p: [Radical::from(q(3)), root2(), Radical::default()],
        d: [Radical::default(), Radical::default(), Radical::from(q(5))],
    };
    let skew = Curve3::RadicalLine {
        p: [Radical::from(q(3)), root2(), Radical::default()],
        d: [Radical::default(), Radical::from(q(1)), Radical::from(q(5))],
    };
    assert!(carrier.contains_curve(&generator).unwrap());
    assert!(!carrier.contains_curve(&skew).unwrap());
    let latitude = Circle3::about(
        [Radical::from(q(1)), root2(), Radical::from(q(3))],
        [[q(0), q(1), q(0)], [q(-1), q(0), q(0)], [q(0), q(0), q(1)]],
        q(4),
    )
    .unwrap();
    let smaller = Circle3::about(origin.clone(), axes.clone(), q(1)).unwrap();
    assert!(carrier.contains_curve(&Curve3::Circle(latitude.clone())).unwrap());
    assert!(!carrier.contains_curve(&Curve3::Circle(smaller)).unwrap());
    // Point-set identity: same circle under a rotated isometric frame.
    assert_eq!(circle.canonical_key().0, Circle3::about(origin.clone(), [[q(0), q(1), q(0)], [q(-1), q(0), q(0)], [q(0), q(0), q(1)]], q(4)).unwrap().canonical_key().0);
    assert_ne!(circle.canonical_key().0, latitude.canonical_key().0);
    // Rational data stay the ordinary rational carrier.
    let rational = Cylinder3::about([Radical::from(q(1)), Radical::from(q(2)), Radical::default()], axes.clone(), q(4)).unwrap();
    assert!(!rational.is_radical() && rational.frame().is_ok());
    // A radical carrier needs an isometric frame.
    let sheared = [[q(1), q(0), q(0)], [q(1), q(1), q(0)], [q(0), q(0), q(1)]];
    assert_eq!(
        Cylinder3::about(origin, sheared, q(4)).unwrap_err().0,
        "model/radical-centre-carrier/elliptic-frame"
    );
}
