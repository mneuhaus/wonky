//! Production replay, analytic export, and shared Model admission for generator surgery.
use num_traits::ToPrimitive;
use wonky_contract::{Binary64, Body, BodyKey};
use wonky_ops::{
    affine::Affine,
    analytic::{self, Solid},
    cylinder, fillet, host, orthogonal,
    polyhedron::{audit, Audited},
};
fn key() -> BodyKey {
    BodyKey {
        id: [17, 23, 31, 47],
        revision: 0,
    }
}
fn box_body(lo: [f64; 3], hi: [f64; 3]) -> Audited {
    audit(&orthogonal::cuboid(key(), lo, hi).unwrap().check().unwrap()).unwrap()
}
fn select(a: &Audited, x: f64, z: f64) -> Vec<usize> {
    a.body
        .edges
        .iter()
        .enumerate()
        .filter_map(|(i, e)| {
            if e.vertices.len() != 2 {
                return None;
            }
            let p = e
                .vertices
                .iter()
                .map(|v| a.body.vertices[v.0 as usize].point.map(|v| v.get()))
                .collect::<Vec<_>>();
            (p[0][0] == x && p[1][0] == x && p[0][2] == z && p[1][2] == z).then_some(i)
        })
        .collect()
}
fn seam(frame: Affine, scale: f64) -> Body {
    let boxes = [
        box_body([0.; 3], [24. * scale, 16. * scale, 6. * scale]),
        box_body([0., 0., 6. * scale], [6. * scale, 16. * scale, 22. * scale]),
    ];
    let bodies = orthogonal::boolean(key(), 0, &boxes).unwrap();
    assert_eq!(bodies.len(), 1);
    let a = audit(&bodies[0].clone().check().unwrap()).unwrap();
    let edges = select(&a, 6. * scale, 6. * scale);
    assert_eq!(edges.len(), 1);
    let a = audit(&orthogonal::transform(&a, frame).unwrap().check().unwrap()).unwrap();
    let result = fillet::constant_radius(&a, &edges, 2. * scale).unwrap();
    assert_eq!(result.key.revision, a.body.key.revision + 1);
    result
}
#[test]
fn production_concave_surgery_replays_exports_and_admits_a_model_in_source_metric() {
    for scale in [1., 0.001] {
        for frame in [
            Affine::IDENTITY,
            Affine {
                origin: [65.53625, -32.7685, 16.384125],
                x: [0., 0., 1.],
                z: [0., -1., 0.],
            },
        ] {
            let body = seam(frame, scale);
            assert_eq!(body.key.revision, 2);
            let words = wonky_wire::v3::encode(&body).unwrap();
            let checked = wonky_wire::v3::decode(&words).unwrap();
            let s = analytic::audit(&checked).unwrap();
            let Solid::Planar(a) = &s else {
                panic!("extrusion expected");
            };
            let expected = (24. * 16. * 6. + 6. * 16. * 16. + (4. - std::f64::consts::PI) * 16.)
                * scale.powi(3)
                * 1e9;
            assert!((a.volume_mm3().unwrap() - expected).abs() < expected * 1e-12);
            let m = s.model().unwrap();
            let v = m.volume6_pi().unwrap().remove(0);
            let (lo, hi) = v.enclosure(24).unwrap();
            let estimate = (lo.to_f64().unwrap() + hi.to_f64().unwrap()) / 12.;
            assert!((estimate - expected / 1e9).abs() < expected / 1e9 * 1e-12);
            assert_eq!(
                m.membership(
                    &wonky_geom::point([1. * scale, 8. * scale, 1. * scale]).unwrap(),
                    false
                )
                .unwrap(),
                wonky_geom::model::Membership::Inside
            );

            assert_eq!(
                (
                    m.draft().vertices.len(),
                    m.draft().edges.len(),
                    m.draft().faces.len()
                ),
                (14, 21, 9)
            );
            assert!(analytic::step(&[("seam".into(), s)], "fillet-general")
                .unwrap()
                .contains("CYLINDRICAL_SURFACE"));
            let mut header = body.clone();
            header.constructions.last_mut().unwrap().parameters[1] = Binary64::new(1.5).unwrap();
            assert!(header.check().is_err());
            let mut bad = body.clone();
            bad.vertices[0].point[0] =
                Binary64::new(bad.vertices[0].point[0].get() + 1e-9).unwrap();
            assert!(analytic::audit(&bad.check().unwrap()).is_err());
        }
    }
}
fn host_fillet(body: &Body, edges: &[usize], radius: f64) -> Body {
    let words = wonky_wire::v3::encode(body).unwrap();
    let mut request = vec![
        host::MAGIC,
        host::VERSION,
        host::OP_FILLET,
        words.len() as u32,
    ];
    request.extend(words);
    let bits = radius.to_bits();
    request.extend([bits as u32, (bits >> 32) as u32, edges.len() as u32]);
    request.extend(edges.iter().map(|&i| i as u32));
    let result = host::host_op(&request);
    assert_eq!(
        result[0],
        host::STATUS_OK,
        "{}",
        result[1..]
            .iter()
            .filter_map(|&c| char::from_u32(c))
            .collect::<String>()
    );
    wonky_wire::v3::decode(&result[1..]).unwrap().into_body()
}
#[test]
fn production_generator_rounds_preserve_all_four_bores_and_replay_the_cut() {
    let base = box_body([0.; 3], [40., 30., 5.]);
    let mut operands = vec![Solid::Planar(base.clone())];
    for [x, y] in [[5., 5.], [35., 5.], [5., 25.], [35., 25.]] {
        let body = cylinder::create(
            key(),
            cylinder::Spec {
                bottom: [x, y, -1.],
                top: [x, y, 6.],
                radius: 2.025,
            },
        )
        .unwrap();
        operands.push(analytic::audit(&body.check().unwrap()).unwrap());
    }
    let cut = analytic::boolean(key(), 1, &operands).unwrap().remove(0);
    let edges = base
        .body
        .edges
        .iter()
        .enumerate()
        .filter_map(|(i, e)| {
            if e.vertices.len() != 2 {
                return None;
            }
            let p = e
                .vertices
                .iter()
                .map(|v| base.body.vertices[v.0 as usize].point.map(|v| v.get()))
                .collect::<Vec<_>>();
            (p[0][0] == p[1][0] && p[0][1] == p[1][1] && p[0][2] != p[1][2]).then_some(i)
        })
        .collect::<Vec<_>>();
    assert_eq!(edges.len(), 4);
    let result = host_fillet(&cut, &edges, 5.);
    assert_eq!(result.key.revision, cut.key.revision + 1);
    let s = analytic::audit(&result.check().unwrap()).unwrap();
    let m = s.model().unwrap();
    let v = m.volume6_pi().unwrap().remove(0);
    let (lo, hi) = v.enclosure(24).unwrap();
    let expected = 5. * (1200. - 100. + 25. * std::f64::consts::PI)
        - 4. * std::f64::consts::PI * 2.025f64.powi(2) * 5.;
    assert!(
        ((lo.to_f64().unwrap() + hi.to_f64().unwrap()) / 12. - expected).abs() < expected * 1e-12
    );
    assert!(matches!(
        m.membership(&wonky_geom::point([5., 5., 2.]).unwrap(), false)
            .unwrap(),
        wonky_geom::model::Membership::Outside
    ));
    assert!(matches!(
        m.membership(&wonky_geom::point([20., 15., 2.]).unwrap(), true)
            .unwrap(),
        wonky_geom::model::Membership::Inside
    ));

    assert_eq!(
        (
            m.draft().vertices.len(),
            m.draft().edges.len(),
            m.draft().faces.len()
        ),
        (16, 32, 14)
    );
    let step = analytic::step(&[("plate".into(), s)], "fillet-bores").unwrap();
    assert!(step.contains("CYLINDRICAL_SURFACE"));
}
#[test]
fn shared_extrusion_audit_rejects_bad_pcurves_and_orientation() {
    let s = analytic::audit(&seam(Affine::IDENTITY, 1.).check().unwrap()).unwrap();
    let m = s.model().unwrap();
    let mut d = m.clone().into_draft();
    let i = d
        .faces
        .iter()
        .position(|f| {
            matches!(
                d.surfaces[f.surface.index()].carrier,
                wonky_geom::model::Carrier3::Cylinder(_)
            )
        })
        .unwrap();
    d.faces[i].forward = !d.faces[i].forward;
    assert!(d.check().is_err());
    let mut d = m.clone().into_draft();
    let c = d.loops[d.faces[i].loops[0].index()].coedges[0];
    d.coedges[c.index()].pcurve = wonky_curve::Trimmed::line([0., 0.], [1., 0.]);
    assert!(d.check().is_err());
    let mut d = m.into_draft();
    let c = d.loops[d.faces[0].loops[0].index()]
        .coedges
        .iter()
        .copied()
        .find(|c| {
            matches!(
                d.curves[d.edges[d.coedges[c.index()].edge.index()].curve.index()].geometry,
                wonky_geom::model::Curve3::Circle(_)
            )
        })
        .unwrap();
    d.coedges[c.index()].pcurve = d.coedges[c.index()].pcurve.reversed();
    assert!(d.check().is_err());
}

#[test]
fn two_separate_seams_use_the_same_surgery_and_do_not_discard_an_unselected_step() {
    let boxes = [
        box_body([0.; 3], [40., 10., 6.]),
        box_body([12., 0., 6.], [18., 10., 30.]),
    ];
    let source = orthogonal::boolean(key(), 0, &boxes).unwrap().remove(0);
    let a = audit(&source.check().unwrap()).unwrap();
    let mut edges = select(&a, 12., 6.);
    edges.extend(select(&a, 18., 6.));
    assert_eq!(edges.len(), 2);
    let body = fillet::constant_radius(&a, &edges, 2.).unwrap();
    let s = analytic::audit(&body.check().unwrap()).unwrap();
    let m = s.model().unwrap();
    assert_eq!(
        (
            m.draft().vertices.len(),
            m.draft().edges.len(),
            m.draft().faces.len()
        ),
        (20, 30, 12)
    );
    let Solid::Planar(a) = s else {
        panic!("analytic extrusion expected");
    };
    let expected = (40. * 10. * 6. + 6. * 10. * 24. + 2. * (4. - std::f64::consts::PI) * 10.) * 1e9;
    assert!((a.volume_mm3().unwrap() - expected).abs() < expected * 1e-12);
    let wing = box_body([40., 0., 0.], [50., 5., 6.]);
    let source = orthogonal::boolean(key(), 0, &[boxes[0].clone(), boxes[1].clone(), wing])
        .unwrap()
        .remove(0);
    let a = audit(&source.check().unwrap()).unwrap();
    let edges = select(&a, 12., 6.);
    assert_eq!(edges.len(), 1);
    let error = fillet::constant_radius(&a, &edges, 2.).unwrap_err();
    assert!(error.0.starts_with("fillet/extrusion-"), "{error:?}");
}
