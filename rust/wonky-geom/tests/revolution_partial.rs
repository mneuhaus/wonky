use num_traits::Zero;
use wonky_geom::{
    frame::Frame,
    model::{self, Bounds, Carrier3, VertexDef},
    AngleWitness, Turn, Q,
};
fn q(n: i64) -> Q {
    Q::from_integer(n.into())
}
fn turn(deg: i64) -> Turn {
    Turn::new(
        deg as f64 * (std::f64::consts::PI / 180.),
        Some(AngleWitness::Turns(Q::new(deg.into(), 360.into()))),
    )
    .unwrap()
}
#[test]
fn witnessed_negative_radians_enclosures_reverse_interval_endpoints() {
    for degrees in [1, 45, 135, 359, 360] {
        let positive = turn(degrees).radians_enclosure(64).unwrap();
        let negative = turn(-degrees).radians_enclosure(64).unwrap();
        assert!(negative.0 <= negative.1);
        assert_eq!(negative, (-positive.1, -positive.0));
    }
    assert_eq!(turn(0).radians_enclosure(64).unwrap(), (q(0), q(0)));
}
fn kt3() -> Vec<[Q; 2]> {
    vec![[q(0), q(0)], [q(6), q(0)], [q(6), q(4)], [q(0), q(10)]]
}
fn build(p: &[[Q; 2]], deg: i64) -> model::Model {
    model::revolution_partial::polygon(Frame::identity(), p, turn(deg), 42)
        .unwrap()
        .check()
        .unwrap()
}
#[test]
fn kt3_exact_trim_topology_and_pappus() {
    let m = build(&kt3(), 135);
    let c = m.canonical();
    assert_eq!((c.faces.len(), c.edges.len(), c.vertices.len()), (5, 9, 6));
    assert_eq!(
        c.vertices.len() as i64 - c.edges.len() as i64 + c.faces.len() as i64,
        2
    );
    let v = m.volume6_pi().unwrap();
    assert_eq!(v[0].pi, q(486));
    assert!(v[0].rational.is_zero());
    let measure = model::revolution_partial::measures(&m).unwrap();
    assert_eq!(measure.area_rational, q(84));
    let expected = wonky_curve::radical::Radical::quadratic(
        Q::new(63.into(), 2.into()),
        Q::new(27.into(), 2.into()),
        q(2),
    )
    .unwrap();
    assert_eq!(measure.area_pi, expected);
    assert_eq!(measure.volume6.pi, q(486));
    let (lo, hi) = measure.area_enclosure().unwrap();
    assert!(lo > q(84));
    assert!(hi > lo);
    assert_eq!(
        m.draft()
            .vertices
            .iter()
            .filter(|v| matches!(v.def, VertexDef::OnCurve(_)))
            .count(),
        2
    );
    assert_eq!(
        m.draft()
            .edges
            .iter()
            .filter(|e| {
                let Bounds::Segment(v) = e.bounds else {
                    return false;
                };
                v.iter().all(|v| {
                    let p = m.draft().vertices[v.index()]
                        .def
                        .key()
                        .unwrap()
                        .coordinates();
                    p[0].is_zero() && p[1].is_zero()
                })
            })
            .count(),
        1
    );
}
#[test]
fn full_turn_shadow_is_the_existing_ring_model() {
    for p in [
        kt3(),
        vec![[q(2), q(-1)], [q(6), q(-1)], [q(6), q(7)], [q(2), q(7)]],
        vec![[q(0), q(0)], [q(8), q(0)], [q(0), q(6)]],
    ] {
        let old = model::revolution::revolution(Frame::identity(), Frame::identity(), &p, 0)
            .unwrap()
            .check()
            .unwrap();
        let new = build(&p, 360);
        assert_eq!(new.canonical(), old.canonical());
        assert_eq!(new.volume6_pi().unwrap(), old.volume6_pi().unwrap());
        assert!(new.draft().vertices.is_empty());
    }
}
#[test]
fn atlas_crosses_virtual_seams_without_topological_edges() {
    let p = vec![[q(2), q(0)], [q(6), q(0)], [q(6), q(4)], [q(2), q(4)]];
    for deg in [45, 90, 120, 135, 180, 225, 270, 315] {
        let m = build(&p, deg);
        let d = m.draft();
        assert_eq!((d.faces.len(), d.edges.len(), d.vertices.len()), (6, 12, 8));
        assert_eq!(
            m.volume6_pi().unwrap()[0].pi,
            Q::new((768 * deg).into(), 360.into())
        );
        for c in &d.coedges {
            if let Some(a) = &c.atlas {
                for part in &a.pieces {
                    for p in part.piece.ends() {
                        let t = &p.coordinates()[0];
                        assert!(t.abs() <= wonky_curve::radical::Radical::from(q(1)));
                    }
                }
            }
        }
        if deg == 180 {
            assert!(d
                .coedges
                .iter()
                .any(|c| c.atlas.as_ref().is_some_and(|a| a.pieces.len() == 2)));
        }
    }
}
#[test]
fn rounded_cap_vertex_is_a_nonvacuous_rejected_mutation() {
    let m = build(&kt3(), 135);
    let mut d = m.into_draft();
    let v = d
        .vertices
        .iter_mut()
        .find(|v| matches!(v.def, VertexDef::OnCurve(_)))
        .unwrap();
    let VertexDef::OnCurve(p) = &v.def else {
        unreachable!()
    };
    let rounded = p.rounded().unwrap();
    assert!(p.rational().is_err());
    v.def = VertexDef::Input(rounded);
    let e = d.check().unwrap_err();
    assert!(matches!(
        e.0,
        "model/g3-pcurve-ends" | "model/g4-vertex-off-curve"
    ));
}
#[test]
fn half_turn_one_patch_and_inward_face_are_rejected() {
    let p = vec![[q(2), q(0)], [q(6), q(0)], [q(6), q(4)], [q(2), q(4)]];
    let m = build(&p, 180);
    let mut d = m.clone().into_draft();
    let a = d
        .coedges
        .iter_mut()
        .find_map(|c| c.atlas.as_mut().filter(|a| a.pieces.len() == 2))
        .unwrap();
    a.pieces.pop();
    assert_eq!(
        d.check().unwrap_err().0,
        "model/g3-revolution-atlas-identity"
    );
    let mut d = m.into_draft();
    let f = d
        .faces
        .iter_mut()
        .find(|f| matches!(d.surfaces[f.surface.index()].carrier, Carrier3::Cylinder(_)))
        .unwrap();
    f.forward = !f.forward;
    assert_eq!(d.check().unwrap_err().0, "model/g8-inward-face");
}
#[test]
fn invalid_profiles_and_unavailable_coordinate_classes_refuse_by_name() {
    let p = vec![[q(-1), q(0)], [q(6), q(0)], [q(6), q(4)], [q(-1), q(4)]];
    assert_eq!(
        model::revolution_partial::polygon(Frame::identity(), &p, turn(135), 0)
            .unwrap_err()
            .0,
        "model/g1-meridian"
    );
    for deg in [0, -45, 405] {
        assert_eq!(
            model::revolution_partial::polygon(Frame::identity(), &kt3(), turn(deg), 0)
                .unwrap_err()
                .0,
            "revolve/turn-range"
        );
    }
    let t = Turn::new(
        360. / 7. * (std::f64::consts::PI / 180.),
        Some(AngleWitness::Turns(Q::new(1.into(), 7.into()))),
    )
    .unwrap();
    assert_eq!(t.quadratic_sin_cos().unwrap_err().0,"turn/coordinate-field-unavailable");
    let m=model::revolution_partial::polygon(Frame::identity(),&kt3(),t,0).unwrap().check().unwrap();
    assert_eq!((m.draft().faces.len(),m.draft().edges.len(),m.draft().vertices.len()),(5,9,6));
    assert_eq!(m.volume6_pi().unwrap()[0].pi,Q::new(1296.into(),7.into()));
}

#[test]
fn wider_area_field_refuses_without_losing_exact_geometry_or_volume() {
    // 100 successive slopes give more than 64 distinct square classes.
    // Four generators are supported by this backend and are not a refusal.
    let mut p = vec![[q(1), q(0)]];
    let mut height = 0;
    for k in 1..=100 {
        height += k;
        p.push([q(1 + k), q(height)]);
    }
    p.push([q(1), q(height + 1)]);
    let m = build(&p, 135);
    assert!(m.volume6_pi().unwrap()[0].pi > q(0));
    assert_eq!(
        model::revolution_partial::measures(&m).unwrap_err().0,
        "revolve/metric-field-budget"
    );
}

#[test]
fn oncurve_vertices_do_not_force_other_operations_into_a_revolve_family() {
    let unit = |k: usize, n: i64| std::array::from_fn(|i| if i == k { q(n) } else { q(0) });
    let hi = [3., 4., 2.];
    let mut faces = vec![];
    for k in 0..3 {
        for max in [false, true] {
            let (u, w) = ((k + 1) % 3, (k + 2) % 3);
            let corner = |a: f64, b: f64| {
                let mut p = [0.; 3];
                p[k] = if max { hi[k] } else { 0. };
                p[u] = a;
                p[w] = b;
                VertexDef::Input(p)
            };
            let mut cycle = vec![
                corner(0., 0.),
                corner(hi[u], 0.),
                corner(hi[u], hi[w]),
                corner(0., hi[w]),
            ];
            if !max {
                cycle.reverse();
            }
            let mut o = wonky_geom::zero();
            o[k] = q(if max { hi[k] as i64 } else { 0 });
            faces.push(model::PolyFace {
                carrier: model::Plane3 {
                    o,
                    x: unit(u, 1),
                    n: unit(k, if max { 1 } else { -1 }),
                },
                forward: true,
                loops: vec![cycle],
                provenance: model::Provenance {
                    node: 0,
                    slot: faces.len() as u32,
                },
            });
        }
    }
    let mut d = model::polyhedron(Frame::identity(), model::Label::Exact, 0, faces).unwrap();
    d.clone().check().unwrap();
    let t = turn(135);
    for v in &mut d.vertices {
        let p = v.def.key().unwrap().rational().unwrap().clone();
        let radius2 = &p[0] * &p[0] + &p[1] * &p[1];
        if radius2.is_zero() {
            continue;
        }
        let r = wonky_curve::numeric::exact_root(&radius2).unwrap();
        let x = [&p[0] / &r, &p[1] / &r, q(0)];
        let y = [-x[1].clone(), x[0].clone(), q(0)];
        v.def = VertexDef::OnCurve(wonky_geom::rotation::OnCurve {
            circle: model::Circle3::new(
                Frame::new([q(0), q(0), p[2].clone()], [x, y, unit(2, 1)]).unwrap(),
                radius2,
            )
            .unwrap(),
            t: t.clone(),
        });
    }
    for e in &d.edges {
        let Bounds::Segment(v) = e.bounds else {
            unreachable!()
        };
        let p = d.vertices[v[0].index()].def.key().unwrap().coordinates();
        let end = d.vertices[v[1].index()].def.key().unwrap().coordinates();
        d.curves[e.curve.index()].geometry =
            model::algebraic::line(p.clone(), model::algebraic::sub(&end, &p));
    }
    for s in &mut d.surfaces {
        s.carrier = Carrier3::rotated(
            s.carrier.clone(),
            wonky_geom::rotation::Line3 {
                p: wonky_geom::zero(),
                d: unit(2, 1),
            },
            t.clone(),
        )
        .unwrap();
    }
    let m = d.check().unwrap();
    assert_eq!(m.volume6().unwrap(), vec![q(144)]);
    assert_eq!(
        (
            m.canonical().faces.len(),
            m.canonical().edges.len(),
            m.canonical().vertices.len()
        ),
        (6, 12, 8)
    );
}

#[test]
fn every_turn_class_builds_audited_exact_boundary_and_angular_measures() {
    use wonky_geom::TurnClass;
    let witnesses = [
        (15, TurnClass::Radical),
        (105, TurnClass::Radical),
        (195, TurnClass::Radical),
        (285, TurnClass::Radical),
        (360 / 9, TurnClass::Algebraic),
    ];
    let mut turns: Vec<(Turn, TurnClass)> = witnesses
        .into_iter()
        .map(|(deg, class)| (turn(deg), class))
        .collect();
    turns.push((
        Turn::new(
            360. / 7. * (std::f64::consts::PI / 180.),
            Some(AngleWitness::Turns(Q::new(1.into(), 7.into()))),
        )
        .unwrap(),
        TurnClass::Algebraic,
    ));
    for numerator in [2, 4, 6] {
        let f = Q::new(numerator.into(), 7.into());
        let degrees = 360. * (numerator as f64) / 7.;
        turns.push((
            Turn::new(
                degrees * (std::f64::consts::PI / 180.),
                Some(AngleWitness::Turns(f)),
            )
            .unwrap(),
            TurnClass::Algebraic,
        ));
    }
    turns.push((Turn::new(1., None).unwrap(), TurnClass::Transcendental));
    turns.push((Turn::new(4., None).unwrap(), TurnClass::Transcendental));
    turns.push((Turn::new(5., None).unwrap(), TurnClass::Transcendental));
    turns.push((
        Turn::new(
            f64::from_bits(0x3fddac670561bb4f),
            Some(AngleWitness::Tan(Q::new(1.into(), 2.into()))),
        )
        .unwrap(),
        TurnClass::Quadratic,
    ));
    turns.push((
        Turn::from_sin_cos(Q::new(3.into(), 5.into()), Q::new(4.into(), 5.into())).unwrap(),
        TurnClass::Rational,
    ));
    turns.push((
        Turn::from_sin_cos(Q::new(3.into(), 5.into()), Q::new((-4).into(), 5.into())).unwrap(),
        TurnClass::Rational,
    ));
    for (t, class) in turns {
        assert_eq!(t.class(), class);
        for p in [
            kt3(),
            vec![[q(2), q(0)], [q(6), q(0)], [q(6), q(4)], [q(2), q(4)]],
        ] {
            let m = model::revolution_partial::polygon(Frame::identity(), &p, t.clone(), 42)
                .unwrap()
                .check()
                .unwrap();
            let d = m.draft();
            let axis = p[0][0].is_zero();
            assert_eq!(
                (d.faces.len(), d.edges.len(), d.vertices.len()),
                if axis { (5, 9, 6) } else { (6, 12, 8) }
            );
            assert_eq!(
                m.canonical(),
                m.clone().into_draft().check().unwrap().canonical()
            );
            let measure = model::revolution_partial::angular_measures(&m).unwrap();
            assert_eq!(
                measure.volume6_per_radian,
                if axis { q(648) } else { q(384) }
            );
            assert_eq!(measure.cap_area, if axis { q(84) } else { q(32) });
            let (lo, hi) = measure.volume6_enclosure(64).unwrap();
            assert!(lo > q(0));
            assert!(hi >= lo);
            let (lo, hi) = measure.area_enclosure(64).unwrap();
            assert!(lo > measure.cap_area);
            assert!(hi >= lo);
            // This mutation changes real geometry, rather than a cache. Every
            // class must reject an incorrectly rounded endpoint or inward wall.
            let mut bad = m.clone().into_draft();
            let v = bad
                .vertices
                .iter_mut()
                .find(|v| matches!(v.def, VertexDef::OnCurve(_)))
                .unwrap();
            let VertexDef::OnCurve(p) = &v.def else {
                unreachable!()
            };
            v.def = VertexDef::Input(p.rounded().unwrap());
            assert!(bad.check().is_err());
            let mut bad = m.into_draft();
            let f = bad
                .faces
                .iter_mut()
                .find(|f| {
                    matches!(
                        bad.surfaces[f.surface.index()].carrier,
                        Carrier3::Cylinder(_)
                    )
                })
                .unwrap();
            f.forward = !f.forward;
            assert_eq!(bad.check().unwrap_err().0, "model/g8-inward-face");
        }
    }
}

#[test]
fn exact_real_coordinates_preserve_circle_and_chart_identities() {
    use wonky_curve::{radical::Radical, ExactPoint};
    for t in [
        turn(15),
        turn(105),
        turn(195),
        turn(285),
        Turn::new(
            360. / 7. * (std::f64::consts::PI / 180.),
            Some(AngleWitness::Turns(Q::new(1.into(), 7.into()))),
        )
        .unwrap(),
        Turn::new(1., None).unwrap(),
        Turn::new(5., None).unwrap(),
    ] {
        let (s, c) = t.exact_sin_cos().unwrap();
        let one = Radical::from(q(1));
        assert_eq!(&s * &s + &c * &c, one);
        let u = &s / (&one + &c);
        assert_eq!(u.clone() * q(2) / (one.clone() + &u * &u), s);
        assert_eq!((one.clone() - &u * &u) / (one.clone() + &u * &u), c);
        assert!(ExactPoint::from_coordinates([s.clone(), c.clone()]).is_err());
        // Compare the new rational-function evaluator with T0's independent
        // cos/sin predicate, including exact algebraic field evaluation.
        for [a, b, k] in [[1, 0, 0], [0, 1, 0], [1, 1, -1], [2, -3, 1], [-5, 7, 2]] {
            let expected = match t.sign(&q(a), &q(b), &q(k)).unwrap() {
                wonky_alg::Sign::Negative => std::cmp::Ordering::Less,
                wonky_alg::Sign::Zero => std::cmp::Ordering::Equal,
                wonky_alg::Sign::Positive => std::cmp::Ordering::Greater,
            };
            assert_eq!(
                (&c * q(a) + &s * q(b) + Radical::from(q(k))).sign(),
                expected
            );
        }
        let p = ExactPoint::from_real_coordinates([s, c]).unwrap();
        assert!(p.enclosure().is_ok());
        assert!(p.rat().is_err());
    }
}

#[test]
fn non_pi_measures_retain_the_exact_angle_instead_of_a_fabricated_fraction() {
    let cases = [
        (Turn::new(1., None).unwrap(), q(1), q(1)),
        // Certified decimal brackets for atan(1/2) and atan2(3/5,4/5).
        (
            Turn::new(
                f64::from_bits(0x3fddac670561bb4f),
                Some(AngleWitness::Tan(Q::new(1.into(), 2.into()))),
            )
            .unwrap(),
            Q::new(463647609000806i64.into(), 1000000000000000i64.into()),
            Q::new(463647609000807i64.into(), 1000000000000000i64.into()),
        ),
        (
            Turn::from_sin_cos(Q::new(3.into(), 5.into()), Q::new(4.into(), 5.into())).unwrap(),
            Q::new(643501108793284i64.into(), 1000000000000000i64.into()),
            Q::new(643501108793285i64.into(), 1000000000000000i64.into()),
        ),
    ];
    for (t, lo, hi) in cases {
        let m = model::revolution_partial::polygon(Frame::identity(), &kt3(), t, 0)
            .unwrap()
            .check()
            .unwrap();
        let metrics = model::revolution_partial::angular_measures(&m).unwrap();
        let (vmin, vmax) = metrics.volume6_enclosure(64).unwrap();
        assert!(vmin >= q(648) * lo && vmax <= q(648) * hi);
        assert_eq!(
            m.volume6_pi().unwrap_err().0,
            "revolve/angle-not-rational-pi-measure"
        );
    }
}

#[test]
fn circle_half_turn_and_unwitnessed_angle_range_are_exact() {
    let half = Turn::from_sin_cos(q(0), q(-1)).unwrap();
    let m = model::revolution_partial::polygon(Frame::identity(), &kt3(), half, 0)
        .unwrap()
        .check()
        .unwrap();
    let a = model::revolution_partial::angular_measures(&m).unwrap();
    let (lo, hi) = a.volume6_enclosure(64).unwrap();
    assert!(lo > q(648) * q(3));
    assert!(hi < q(648) * Q::new(22.into(), 7.into()));
    for word in [0., -1., 7.] {
        assert_eq!(
            model::revolution_partial::polygon(
                Frame::identity(),
                &kt3(),
                Turn::new(word, None).unwrap(),
                0
            )
            .unwrap_err()
            .0,
            "revolve/turn-range"
        );
    }
    let zero = Turn::from_sin_cos(q(0), q(1)).unwrap();
    assert_eq!(
        model::revolution_partial::polygon(Frame::identity(), &kt3(), zero, 0)
            .unwrap_err()
            .0,
        "revolve/turn-range"
    );
}

#[test]
fn degree_48_turn_has_real_model_geometry_not_only_an_operation_graph() {
    for degrees in [1, 179, 181, 359] {
        let t = turn(degrees);
        assert_eq!(t.degree(), Some(48));
        let m = model::revolution_partial::polygon(Frame::identity(), &kt3(), t, 0)
            .unwrap()
            .check()
            .unwrap();
        assert_eq!(
            (
                m.draft().faces.len(),
                m.draft().edges.len(),
                m.draft().vertices.len()
            ),
            (5, 9, 6)
        );
        assert_eq!(
            m.volume6_pi().unwrap()[0].pi,
            Q::new((18 * degrees).into(), 5.into())
        );
        assert!(m
            .draft()
            .vertices
            .iter()
            .any(|v| matches!(v.def, VertexDef::OnCurve(_))));
    }
}

#[test]
fn real_vertex_key_order_is_geometric_across_storage_classes() {
    use model::{QuadraticPoint3, VertexKey};
    use wonky_curve::radical::Radical;
    let root = Radical::quadratic(q(0), q(1), q(2)).unwrap();
    let low = QuadraticPoint3::from_coordinates([Radical::from(q(1)), root, Radical::default()])
        .unwrap()
        .key();
    let mid = Turn::new(1., None).unwrap().exact_sin_cos().unwrap().0;
    let middle = VertexDef::Real([Radical::from(q(2)), mid, Radical::default()])
        .key()
        .unwrap();
    let high = VertexKey::Rational([q(3), q(0), q(0)]);
    assert!(low < middle && middle < high && low < high);
    let normalized = VertexDef::Real([Radical::from(q(3)), Radical::default(), Radical::default()])
        .key()
        .unwrap();
    assert_eq!(normalized, high);
}
