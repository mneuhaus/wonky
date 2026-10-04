//! Owner boundary for a convex tangent rim: analytic metrics, probes, topology
//! and reconstruction binding. Existing prism/corner tests never create tori.
use wonky_contract::{Binary64, BodyKey, SurfaceGeometry};
use wonky_ops::{
    affine::Affine,
    arc_profile, fillet,
    polyhedron::{audit, Audited, Probe},
};
fn prism(scale: f64) -> Audited {
    let lines = [[4., 0., 12., 0.], [12., 8., 4., 8.]].map(|p| p.map(|x| x * scale));
    let arcs =
        [[12., 0., 16., 4., 12., 8.], [4., 8., 0., 4., 4., 0.]].map(|p| p.map(|x| x * scale));
    audit(
        &arc_profile::build(
            BodyKey {
                id: [3; 4],
                revision: 0,
            },
            Affine::IDENTITY,
            &lines,
            &arcs,
            6. * scale,
            false,
        )
        .unwrap()
        .check()
        .unwrap(),
    )
    .unwrap()
}
fn near(a: f64, b: f64) {
    assert!((a - b).abs() < 1e-10 * b.abs().max(1.), "{a} != {b}");
}
#[test]
fn tangent_rim_has_sewn_tori_and_cylinders_with_analytic_observations() {
    for scale in [1., 0.001, 0.125] {
        let input = prism(scale);
        let output = fillet::constant_radius(&input, &[4, 5, 6, 7], scale).unwrap();
        let a = audit(&output.check().unwrap()).unwrap();
        let pi = std::f64::consts::PI;
        let unit = scale * 1000.;
        near(
            a.volume_mm3().unwrap(),
            (6. * (64. + 16. * pi) - (16. * (1. - pi / 4.) + 6. * pi * (1. - pi / 4.) + pi / 3.))
                * unit.powi(3),
        );
        near(
            a.face_areas_mm2().unwrap().iter().sum(),
            (48. + 9. * pi
                + 64.
                + 16. * pi
                + (16. + 8. * pi) * 5.
                + 8. * pi
                + 3. * pi * pi
                + 2. * pi)
                * unit.powi(2),
        );
        let t = a.topology();
        assert_eq!((t.faces, t.edges, t.vertices, t.genus), (10, 20, 12, 0));
        assert_eq!(
            a.body
                .surfaces
                .iter()
                .filter(|s| matches!(s.geometry, SurfaceGeometry::Torus { .. }))
                .count(),
            2
        );
        for (point, want) in [
            ([8., -2., 8.], 3. * 2f64.sqrt() - 1.),
            ([19., 4., 9.], 4. * 2f64.sqrt() - 1.),
        ] {
            match a.distance_mm(point.map(|x| x * unit)) {
                Probe::Measured {
                    distance_mm,
                    inside,
                    bound_mm,
                } => {
                    assert!(!inside);
                    near(distance_mm, want * unit);
                    assert!(bound_mm < 1e-8 * unit);
                }
                Probe::Refused(r) => panic!("{r}"),
            }
        }
        let (lo, hi) = a.bbox_mm(None).unwrap();
        for k in 0..3 {
            near(lo[k], 0.);
            near(hi[k], [16., 8., 6.][k] * unit);
        }
        let (c, bound) = a.centroid_with_bound_mm().unwrap();
        near(c[0], 8. * unit);
        near(c[1], 4. * unit);
        assert!(c[2] < 3. * unit);
        assert!(bound.iter().all(|x| *x < 1e-8 * unit));
        for mutation in 0..3 {
            let mut b = a.body.clone();
            match mutation {
                0 => {
                    let s = b
                        .surfaces
                        .iter_mut()
                        .find(|s| matches!(s.geometry, SurfaceGeometry::Torus { .. }))
                        .unwrap();
                    if let SurfaceGeometry::Torus { minor, .. } = &mut s.geometry {
                        *minor = Binary64::new(minor.get() * 1.01).unwrap();
                    }
                }
                1 => b.pcurves[0].geometry = b.pcurves[1].geometry.clone(),
                _ => b.coedges[0].forward = !b.coedges[0].forward,
            }
            if let Ok(b) = b.check() {
                assert!(audit(&b).is_err(), "accepted corrupt rim {mutation}");
            }
        }
    }
}
#[test]
fn rim_queries_use_each_new_ring_and_the_quarter_circle_joint() {
    let base = prism(1.);
    let a = audit(
        &fillet::constant_radius(&base, &[4, 5, 6, 7], 1.)
            .unwrap()
            .check()
            .unwrap(),
    )
    .unwrap();
    let candidates = (0..a.body.edges.len()).map(|k| (&a, k)).collect::<Vec<_>>();
    for (point, edge) in [([16., 4., 5.], 5), ([15., 4., 6.], 9), ([12., 0., 6.], 17)] {
        let result = wonky_ops::edge_query::closest(&candidates, point, 0.).unwrap();
        assert_eq!(result, vec![edge]);
    }
}
#[test]
fn four_quadrant_rims_are_not_an_obround_shape_shortcut() {
    let lines = [
        [5., 0., 15., 0.],
        [20., 5., 20., 9.],
        [15., 14., 5., 14.],
        [0., 9., 0., 5.],
    ];
    let arcs = [
        [15., 0., 18., 1., 20., 5.],
        [20., 9., 19., 12., 15., 14.],
        [5., 14., 2., 13., 0., 9.],
        [0., 5., 1., 2., 5., 0.],
    ];
    for reverse in [false, true] {
        let base = audit(
            &arc_profile::build(
                BodyKey {
                    id: [7; 4],
                    revision: 0,
                },
                Affine::IDENTITY,
                &lines,
                &arcs,
                4.,
                reverse,
            )
            .unwrap()
            .check()
            .unwrap(),
        )
        .unwrap();
        let a = audit(
            &fillet::constant_radius(&base, &(8..16).collect::<Vec<_>>(), 1.)
                .unwrap()
                .check()
                .unwrap(),
        )
        .unwrap();
        let pi = std::f64::consts::PI;
        near(
            a.volume_mm3().unwrap(),
            ((152. + 16. * pi) * 4. + (28. + 8. * pi) * (3. + pi / 4.) + pi * (3. + 2. / 3.)) * 1e9,
        );
        assert_eq!(
            a.body
                .surfaces
                .iter()
                .filter(|s| matches!(s.geometry, SurfaceGeometry::Torus { .. }))
                .count(),
            4
        );
        let centroid = a.centroid_mm().unwrap();
        near(centroid[0], 10000.);
        near(centroid[1], 7000.);
        assert!(centroid[2] < if reverse { -2000. } else { 2000. });
    }
}
#[test]
fn incomplete_chains_and_consumed_offsets_refuse_without_modifying_the_input() {
    let a = prism(1.);
    for (edges, radius, reason) in [
        (&[4, 5][..], 1., "whole-cap-required"),
        (&[4, 5, 6, 7][..], 4., "offset-curvature"),
        (&[4, 5, 6, 7][..], 6., "height-consumed"),
        (&[4, 5, 6, 7][..], 0.1, "torus-radius-not-binary64"),
    ] {
        let e = fillet::constant_radius(&a, edges, radius).unwrap_err();
        assert_eq!(e.0, format!("fillet/rim-{reason}"));
    }
    near(
        a.volume_mm3().unwrap(),
        6. * (64. + 16. * std::f64::consts::PI) * 1e9,
    );
    let kinked = audit(
        &arc_profile::build(
            BodyKey {
                id: [8; 4],
                revision: 0,
            },
            Affine::IDENTITY,
            &[[0., 5., 0., 0.], [0., 0., 5., 0.]],
            &[[5., 0., 3., 4., 0., 5.]],
            2.,
            false,
        )
        .unwrap()
        .check()
        .unwrap(),
    )
    .unwrap();
    let refused = fillet::constant_radius(&kinked, &[3, 4, 5], 1.).unwrap_err();
    assert!(refused.0.contains("non-tangent-chain"), "{}", refused.0);
}
