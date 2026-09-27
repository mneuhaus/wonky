//! Owning boundary: reconstruction audit rejects transport corruption, and
//! non-semicircular/concave arcs preserve analytic geometry and exact membership.
use wonky_contract::{Binary64, BodyKey, CurveGeometry, SurfaceGeometry};
use wonky_ops::{
    affine::Affine,
    arc_profile,
    polyhedron::{audit, Audited, Probe},
    step,
};
fn build(lines: &[[f64; 4]], arcs: &[[f64; 6]]) -> Audited {
    let body = arc_profile::build(
        BodyKey {
            id: [9, 8, 7, 6],
            revision: 0,
        },
        Affine::IDENTITY,
        lines,
        arcs,
        2.,
        false,
    )
    .unwrap();
    audit(&body.check().unwrap()).unwrap()
}
fn near(a: f64, b: f64) {
    assert!((a - b).abs() < 1e-10 * b.abs().max(1.), "{a} != {b}");
}
fn inside(a: &Audited, p: [f64; 3]) -> bool {
    match a.distance_mm(p) {
        Probe::Measured { inside, .. } => inside,
        Probe::Refused(s) => panic!("{s}"),
    }
}
#[test]
fn arbitrary_quarter_and_major_arcs_have_correct_integrals_and_trim_side() {
    for (mid, area, included, excluded) in [
        (
            [3., 4.],
            25. * std::f64::consts::PI / 4.,
            [250., 250., 1000.],
            [-250., -250., 1000.],
        ),
        (
            [-5., 0.],
            25. * std::f64::consts::PI * 0.75,
            [-250., -250., 1000.],
            [250., 250., 1000.],
        ),
    ] {
        let a = build(
            &[[0., 5., 0., 0.], [0., 0., 5., 0.]],
            &[[5., 0., mid[0], mid[1], 0., 5.]],
        );
        near(a.volume_mm3().unwrap(), area * 2e9);
        assert!(inside(&a, included));
        assert!(!inside(&a, excluded));
        if mid[0] > 0. {
            // On the supporting circle but outside the trimmed quadrant.
            assert!(!inside(&a, [-5000., 0., 1000.]));
            let (lo, hi) = a.bbox_mm(None).unwrap();
            near(lo[0], 0.);
            near(lo[1], 0.);
            near(hi[0], 5000.);
            near(hi[1], 5000.);
        }
        assert_eq!(a.body.faces.len(), 5);
        assert!(step::write(&[("sector".into(), &a)], "sector")
            .unwrap()
            .contains("CYLINDRICAL_SURFACE("));
    }
}
#[test]
fn concave_semicircular_notch_and_next_ulp_boundary_keep_exact_membership() {
    let a = build(
        &[
            [0., 0., 4., 0.],
            [4., 0., 4., 4.],
            [4., 4., 3., 4.],
            [1., 4., 0., 4.],
            [0., 4., 0., 0.],
        ],
        &[[3., 4., 2., 3., 1., 4.]],
    );
    near(
        a.volume_mm3().unwrap(),
        (16. - std::f64::consts::PI / 2.) * 2e9,
    );
    assert!(inside(&a, [2000., 3000., 1000.]));
    assert!(inside(&a, [2000., 3000_f64.next_down(), 1000.]));
    assert!(!inside(&a, [2000., 3000_f64.next_up(), 1000.]));
    assert!(!inside(&a, [2000., 3500., 1000.]));
    assert!(!inside(&a, [2000., 4000., 1000.]));
    assert!(inside(&a, [500., 3500., 1000.]));
}
#[test]
fn reconstruction_audit_rejects_circle_chart_trim_and_orientation_corruption() {
    let a = build(
        &[[1., 0., 9., 0.], [9., 2., 1., 2.]],
        &[[9., 0., 10., 1., 9., 2.], [1., 2., 0., 1., 1., 0.]],
    );
    for mutation in 0..5 {
        let mut b = a.body.clone();
        match mutation {
            0 => {
                let c = b
                    .curves
                    .iter_mut()
                    .find(|c| matches!(c.geometry, CurveGeometry::Circle { .. }))
                    .unwrap();
                if let CurveGeometry::Circle { radius, .. } = &mut c.geometry {
                    *radius = Binary64::new(radius.get() * 1.001).unwrap();
                }
            }
            1 => {
                b.coedges[0].forward = !b.coedges[0].forward;
            }
            2 => {
                b.edges[0].vertices.swap(0, 1);
            }
            3 => {
                let s = b
                    .surfaces
                    .iter_mut()
                    .find(|s| matches!(s.geometry, SurfaceGeometry::Cylinder { .. }))
                    .unwrap();
                if let SurfaceGeometry::Cylinder { origin, .. } = &mut s.geometry {
                    origin[0] = Binary64::new(origin[0].get() + 0.01).unwrap();
                }
            }
            _ => b.pcurves[0].geometry = b.pcurves[1].geometry.clone(),
        }
        if let Ok(checked) = b.check() {
            assert!(audit(&checked).is_err(), "accepted mutation {mutation}");
        }
    }
}
#[test]
fn unresolved_intersections_do_not_authenticate_as_simple_regions() {
    let result = arc_profile::build(
        BodyKey {
            id: [0; 4],
            revision: 0,
        },
        Affine::IDENTITY,
        &[[0., 0., 4., 0.], [4., 0., 4., 4.], [4., 4., 0., 4.]],
        &[[0., 4., 3., 2., 0., 0.]],
        1.,
        false,
    );
    assert!(result.is_err(), "accepted an intersecting arc");
    let reason = result.err().unwrap().0;
    assert!(reason.contains("intersection"), "{reason}");
    for notch in [1.5, 2.] {
        // A nonincident line enters the disk, or touches the arc at a line
        // endpoint which is NOT an arc endpoint. Neither is a simple region.
        let result = arc_profile::build(
            BodyKey {
                id: [0; 4],
                revision: 0,
            },
            Affine::IDENTITY,
            &[
                [0., 0., 4., 0.],
                [4., 0., 4., 1.],
                [4., 1., notch, 2.],
                [notch, 2., 4., 3.],
                [4., 3., 4., 4.],
                [4., 4., 0., 4.],
            ],
            &[[0., 4., 2., 2., 0., 0.]],
            1.,
            false,
        );
        assert!(result.is_err(), "accepted nonincident contact at x={notch}");
        let reason = result.err().unwrap().0;
        assert!(reason.contains("intersection"), "{reason}");
    }
}

#[test]
fn rounded_side_plane_cache_is_not_used_as_an_exact_query_witness() {
    let a = build(
        &[[0., 0., 1., 3.], [3., 1., 0., 0.]],
        &[[1., 3., 4., 4., 3., 1.]],
    );
    let (index, origin, normal) = a
        .body
        .surfaces
        .iter()
        .enumerate()
        .skip(2)
        .find_map(|(index, s)| {
            if let SurfaceGeometry::Plane { origin, normal, .. } = &s.geometry {
                Some((index, origin.map(|x| x.get()), normal.map(|x| x.get())))
            } else {
                None
            }
        })
        .unwrap();
    let solid = wonky_ops::analytic::Solid::Planar(a);
    let selected = [wonky_ops::query::Entity {
        kind: wonky_ops::query::FACE,
        index: index as u32,
    }];
    let result = wonky_ops::query::coincides(&solid, &selected, origin, normal);
    assert!(result.is_err());
    assert!(result
        .err()
        .unwrap()
        .0
        .contains("arc-profile-side-plane-unimplemented"));
}
