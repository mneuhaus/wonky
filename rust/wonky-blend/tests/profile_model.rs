//! General Model replacement, independently checked against exact supports.
use wonky_blend::profile_model;
use wonky_curve::{numeric::q, Carrier, ExactPoint, Trimmed};
use wonky_geom::{
    frame::Frame,
    model::{extrusion, Bounds, Carrier3, EdgeId, Label, Model, VertexKey},
};
fn p(x: f64, y: f64) -> ExactPoint {
    ExactPoint::from_f64([x, y])
}
fn model(pieces: &[Trimmed]) -> Model {
    extrusion::profile(Frame::identity(), Label::Exact, 0, pieces, [q(0.), q(4.)])
        .unwrap()
        .check()
        .unwrap()
}
fn edge(m: &Model, xy: [f64; 2]) -> EdgeId {
    m.draft()
        .edges
        .iter()
        .enumerate()
        .find_map(|(i, e)| {
            let Bounds::Segment(v) = e.bounds else {
                return None;
            };
            let [a, b] = v.map(|v| m.key(v).coordinates());
            (a[0] == q(xy[0]) && a[1] == q(xy[1]) && a[0] == b[0] && a[1] == b[1] && a[2] != b[2])
                .then_some(EdgeId(i as u32))
        })
        .unwrap()
}
fn lens() -> Vec<Trimmed> {
    vec![
        Trimmed::arc_through([0., -4.], [2., 0.], [0., 4.]).unwrap(),
        Trimmed::arc_through([0., 4.], [-2., 0.], [0., -4.]).unwrap(),
    ]
}
#[test]
fn parallel_cylinder_model_replacement_builds_and_trims_every_face() {
    let m = model(&lens());
    let r = profile_model::replace(
        &m,
        &[edge(&m, [0., 4.]), edge(&m, [0., -4.])],
        &q(1.25),
        true,
        1,
    )
    .unwrap();
    assert_eq!(r.model.draft().faces.len(), 6);
    assert_eq!(
        r.model
            .draft()
            .surfaces
            .iter()
            .filter(|s| matches!(s.carrier, Carrier3::Cylinder(_)))
            .count(),
        4
    );
    assert!(r
        .section
        .iter()
        .any(|s| &s.ends == &[p(1., 3.), p(-1., 3.)]));
    assert!(r
        .section
        .iter()
        .any(|s| &s.ends == &[p(-1., -3.), p(1., -3.)]));
    for s in &r.section {
        for a in &s.ends {
            assert!(s.legacy().unwrap().contains(a).unwrap());
        }
    }
    // The retained source cylinders and both caps must shrink, not merely gain stripes.
    assert!(r.section.len() > lens().len());
    assert_ne!(r.model.canonical(), m.canonical());
    let source = lens();
    let expected = vec![
        source[0].trim(p(1., -3.), p(1., 3.)).unwrap(),
        Trimmed::ring([q(0.), q(2.25)], q(1.25) * q(1.25), p(1., 3.), true)
            .unwrap()
            .trim(p(1., 3.), p(-1., 3.))
            .unwrap(),
        source[1].trim(p(-1., 3.), p(-1., -3.)).unwrap(),
        Trimmed::ring([q(0.), q(-2.25)], q(1.25) * q(1.25), p(-1., -3.), true)
            .unwrap()
            .trim(p(-1., -3.), p(1., -3.))
            .unwrap(),
    ];
    assert_eq!(r.model.canonical(), model(&expected).canonical());
}
#[test]
fn quadratic_chamfer_contacts_enter_the_shared_model_audit() {
    let m = model(&lens());
    let r = profile_model::replace(&m, &[edge(&m, [0., 4.])], &q(0.5), false, 1).unwrap();
    assert!(r
        .model
        .draft()
        .surfaces
        .iter()
        .any(|s| matches!(s.carrier, Carrier3::RadicalPlane(_))));
    assert!(r
        .model
        .draft()
        .vertices
        .iter()
        .any(|v| matches!(v.def.key().unwrap(), VertexKey::Quadratic(_))));
    let chord = r
        .section
        .iter()
        .find(|s| matches!(s.legacy().unwrap().carrier(), Carrier::Line))
        .unwrap();
    for a in &chord.ends {
        let gap = a.difference(&p(0., 4.));
        assert_eq!(wonky_curve::radical::dot(&gap, &gap), q(0.25));
    }
    let mut poisoned = r.model.clone().into_draft();
    poisoned.coedges[0].pcurve = Trimmed::line([0., 0.], [1., 0.]);
    assert!(poisoned.check().is_err());
}
#[test]
fn plane_model_blends_and_chamfers_share_the_same_replacement() {
    let source = vec![
        Trimmed::line([0., 0.], [6., 8.]),
        Trimmed::line([6., 8.], [2., 11.]),
        Trimmed::line([2., 11.], [-4., 3.]),
        Trimmed::line([-4., 3.], [0., 0.]),
    ];
    let m = model(&source);
    let edges = [[0., 0.], [6., 8.], [2., 11.], [-4., 3.]].map(|xy| edge(&m, xy));
    for fillet in [false, true] {
        let r = profile_model::replace(&m, &edges, &q(0.5), fillet, 1).unwrap();
        assert_eq!(r.model.draft().faces.len(), 10);
        let volume = r.model.volume6_pi().unwrap().remove(0);
        assert_eq!(volume.rational, q(if fillet { 1176. } else { 1188. }));
        assert_eq!(volume.pi, q(if fillet { 6. } else { 0. }));
        assert_eq!(
            r.model
                .draft()
                .surfaces
                .iter()
                .filter(|s| matches!(s.carrier, Carrier3::Cylinder(_)))
                .count(),
            if fillet { 4 } else { 0 }
        );
        assert!(profile_model::replace(&m, &edges, &q(3.), fillet, 1)
            .unwrap_err()
            .0
            .contains("adjacent-face-consumed"));
    }
}
#[test]
fn incomplete_selection_and_irrational_metric_are_named_refusals() {
    let m = model(&lens());
    assert!(profile_model::replace(&m, &[EdgeId(0)], &q(0.5), true, 1)
        .unwrap_err()
        .0
        .contains("line-generators"));
    let source = vec![
        Trimmed::line([0., 0.], [4., 0.]),
        Trimmed::line([4., 0.], [2., 3.]),
        Trimmed::line([2., 3.], [0., 0.]),
    ];
    let m = model(&source);
    assert_eq!(
        profile_model::replace(&m, &[edge(&m, [4., 0.])], &q(0.5), true, 1)
            .unwrap_err()
            .0,
        "profile-blend/tangent-length-not-rational"
    );
}

#[test]
fn quadratic_rolling_centres_replace_complete_general_model_faces() {
    let arc = Trimmed::arc_through([-3., 4.], [0., -5.], [3., 4.]).unwrap();
    let line = Trimmed::line([3., 4.], [-3., 4.]);
    let m = model(&[arc.clone(), line.clone()]);
    let r = profile_model::replace(
        &m,
        &[edge(&m, [3., 4.]), edge(&m, [-3., 4.])],
        &q(0.5),
        true,
        1,
    )
    .unwrap();
    let stripes = r
        .model
        .draft()
        .surfaces
        .iter()
        .filter_map(|s| match &s.carrier {
            Carrier3::TranslatedCylinder(c) => Some(c),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(stripes.len(), 2);
    for c in &stripes {
        assert_eq!(c.offset[0].clone() * c.offset[0].clone(), q(8.));
        assert_eq!(c.offset[1], q(3.5));
        assert_eq!(c.base.radius2(), q(0.25));
        assert!(matches!(
            wonky_geom::model::QuadraticPoint3::from_coordinates(c.offset.clone())
                .unwrap()
                .key(),
            VertexKey::Quadratic(_)
        ));
    }
    assert_eq!(r.model.draft().vertices.len(), 8);
    assert_eq!(r.model.draft().edges.len(), 18);
    assert_eq!(r.model.draft().faces.len(), 12);
    assert_eq!(
        r.model.canonical(),
        r.model.clone().into_draft().check().unwrap().canonical()
    );
    // The compatibility wire profile remains a named refusal. The Model above
    // is complete and independently audited, rather than a success graph.
    assert_eq!(
        r.legacy_pieces().unwrap_err().0,
        "curve2/crossing-needs-algebraic-vertex"
    );
    let mut bad = r.model.clone().into_draft();
    let s = bad
        .surfaces
        .iter_mut()
        .find_map(|s| match &mut s.carrier {
            Carrier3::TranslatedCylinder(c) => Some(c),
            _ => None,
        })
        .unwrap();
    s.offset[0] = s.offset[0].clone() + q(1.);
    assert!(bad.check().is_err());
}

#[test]
fn quadratic_cap_partition_rejects_inward_and_missing_faces() {
    let m = model(&[
        Trimmed::arc_through([-3., 4.], [0., -5.], [3., 4.]).unwrap(),
        Trimmed::line([3., 4.], [-3., 4.]),
    ]);
    let r = profile_model::replace(
        &m,
        &[edge(&m, [3., 4.]), edge(&m, [-3., 4.])],
        &q(0.5),
        true,
        1,
    )
    .unwrap();
    let mut inward = r.model.clone().into_draft();
    let wall = inward
        .faces
        .iter_mut()
        .find(|f| {
            matches!(
                inward.surfaces[f.surface.index()].carrier,
                Carrier3::TranslatedCylinder(_)
            )
        })
        .unwrap();
    wall.forward = !wall.forward;
    assert_eq!(inward.check().unwrap_err().0, "model/g5-loop-orientation");
    let mut missing = r.model.clone().into_draft();
    missing.shells[0].faces.pop();
    assert!(missing.check().is_err());
    let mut chart = r.model.into_draft();
    let fi = chart
        .faces
        .iter()
        .position(|f| {
            matches!(
                chart.surfaces[f.surface.index()].carrier,
                Carrier3::TranslatedCylinder(_)
            )
        })
        .unwrap();
    let ci = chart.loops[chart.faces[fi].loops[0].index()].coedges[0];
    chart.coedges[ci.index()].pcurve = Trimmed::line([0., 0.], [1., 0.]);
    assert_eq!(chart.check().unwrap_err().0, "model/g3-pcurve-identity");
}

#[test]
fn rationally_rotated_major_arc_gets_exact_chart_subdivisions() {
    let x = q(21.) / q(29.);
    let y = q(20.) / q(29.);
    let map = wonky_curve::PlaneMap::affine(
        [q(0.), q(0.)],
        [x.clone(), y.clone()],
        [-y.clone(), x.clone()],
    )
    .unwrap();
    let source = [
        Trimmed::arc_through([-3., 4.], [0., -5.], [3., 4.])
            .unwrap()
            .mapped(&map)
            .unwrap(),
        Trimmed::line([3., 4.], [-3., 4.]).mapped(&map).unwrap(),
    ];
    let m = model(&source);
    let selected = m
        .draft()
        .edges
        .iter()
        .enumerate()
        .filter_map(|(i, e)| {
            let Bounds::Segment(v) = e.bounds else {
                return None;
            };
            let [a, b] = v.map(|v| m.key(v).coordinates());
            (a[0] == b[0]
                && a[1] == b[1]
                && a[2] != b[2]
                && source
                    .iter()
                    .any(|s| s.ends()[0].coordinates() == [a[0].clone(), a[1].clone()]))
            .then_some(EdgeId(i as u32))
        })
        .collect::<Vec<_>>();
    assert_eq!(selected.len(), 2);
    let r = profile_model::replace(&m, &selected, &q(0.5), true, 1).unwrap();
    assert_eq!(r.section.len(), 4);
    // Four cardinal contacts cut the major arc into five analytic segments.
    // Together with two fillets and one line: eight walls and seven cap segments.
    assert_eq!(r.model.draft().vertices.len(), 16);
    assert_eq!(r.model.draft().edges.len(), 38);
    assert_eq!(r.model.draft().faces.len(), 24);
    let stripes = r
        .model
        .draft()
        .surfaces
        .iter()
        .filter_map(|s| match &s.carrier {
            Carrier3::TranslatedCylinder(c) => Some(c),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(stripes.len(), 2);
    for c in stripes {
        let xx = &c.offset[0] * &x + &c.offset[1] * &y;
        let yy = -&c.offset[0] * &y + &c.offset[1] * &x;
        assert_eq!(&xx * &xx, q(8.));
        assert_eq!(yy, q(3.5));
        assert_eq!(c.base.radius2(), q(0.25));
    }
}

#[test]
fn non_square_source_circle_radius_chamfers_build_a_complete_model() {
    let arc = Trimmed::arc_through([-3., 4.], [0.1, -5.], [3., 4.]).unwrap();
    let Carrier::Circle(c) = arc.carrier() else {
        panic!("expected analytic circle")
    };
    let radius2 = c.r2.clone();
    assert!(wonky_curve::numeric::exact_root(&radius2).is_none());
    let m = model(&[arc, Trimmed::line([3., 4.], [-3., 4.])]);
    let r = profile_model::replace(
        &m,
        &[edge(&m, [3., 4.]), edge(&m, [-3., 4.])],
        &q(0.5),
        false,
        1,
    )
    .unwrap();
    assert_eq!(r.section.len(), 4);
    assert_eq!(r.legacy_pieces().unwrap().len(), 4);
    assert_ne!(r.model.canonical(), m.canonical());
    let walls = r
        .model
        .draft()
        .surfaces
        .iter()
        .filter_map(|s| match &s.carrier {
            Carrier3::Cylinder(c) => Some(c),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert!(!walls.is_empty());
    for wall in walls {
        let v = &wall.columns()[0];
        assert_eq!(wonky_geom::dot(v, v) * wall.radius2(), radius2);
        assert!(!wall.frame().unwrap().is_isometry());
    }
    let springs = r
        .section
        .iter()
        .filter(|p| p.circle.is_some())
        .flat_map(|p| p.ends.iter())
        .collect::<Vec<_>>();
    assert_eq!(springs.len(), 2);
    for spring in springs {
        let corner = if spring.coordinates()[0] > wonky_curve::radical::Radical::default() {
            p(3., 4.)
        } else {
            p(-3., 4.)
        };
        let d = spring.difference(&corner);
        assert_eq!(wonky_curve::radical::dot(&d, &d), q(0.25));
    }
}
