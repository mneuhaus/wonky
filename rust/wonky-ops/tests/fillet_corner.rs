//! The public operation owns corner selection, analytic metrics and lineage.
//! STEP reimport is separately owned by the JS consumer test (not duplicated here).
use wonky_contract::{Binary64, BodyKey, CurveGeometry, SurfaceGeometry};
use wonky_ops::{
    affine::Affine,
    edge_query, fillet, orthogonal,
    polyhedron::{audit, Audited, Probe},
};

fn box_at(frame: Affine, hi: [f64; 3]) -> Audited {
    let b = orthogonal::cuboid(
        BodyKey {
            id: [7, 2, 9, 3],
            revision: 0,
        },
        [0.; 3],
        hi,
    )
    .unwrap();
    let a = audit(&b.check().unwrap()).unwrap();
    audit(&orthogonal::transform(&a, frame).unwrap().check().unwrap()).unwrap()
}
fn selection(a: &Audited, corner: [f64; 3]) -> Vec<usize> {
    let candidates: Vec<_> = (0..a.body.edges.len()).map(|i| (a, i)).collect();
    edge_query::closest(&candidates, a.frame.apply(corner, 1., true).unwrap(), 1e-10).unwrap()
}
fn near(a: f64, b: f64) {
    assert!((a - b).abs() < 1e-10 * b.abs().max(1.), "{a} != {b}");
}

#[test]
fn three_incident_edges_make_three_cylinders_and_one_sphere_at_every_box_corner() {
    for frame in [
        Affine::IDENTITY,
        Affine {
            origin: [65.53625, -32.7685, 16.384125],
            x: [0., 0., 1.],
            z: [0., -1., 0.],
        },
        Affine {
            origin: [17., 19., 23.],
            x: [0.6, 0.8, 0.],
            z: [0., 0., 1.],
        },
    ] {
        for mask in 0..8 {
            let a = box_at(frame, [0.016; 3]);
            let corner = std::array::from_fn(|k| if mask & (1 << k) == 0 { 0. } else { 0.016 });
            let edges = selection(&a, corner);
            assert_eq!(edges.len(), 3);
            let body = fillet::constant_radius(&a, &edges, 0.004).unwrap();
            let words = wonky_wire::v3::encode(&body).unwrap();
            let blend = audit(&wonky_wire::v3::decode(&words).unwrap()).unwrap();
            let t = blend.topology();
            assert_eq!((t.faces, t.edges, t.vertices, t.genus), (10, 21, 13, 0));
            assert_eq!(
                blend
                    .body
                    .surfaces
                    .iter()
                    .filter(|s| matches!(s.geometry, SurfaceGeometry::Cylinder { .. }))
                    .count(),
                3
            );
            assert_eq!(
                blend
                    .body
                    .surfaces
                    .iter()
                    .filter(|s| matches!(s.geometry, SurfaceGeometry::Sphere { .. }))
                    .count(),
                1
            );
            assert_eq!(
                blend
                    .body
                    .curves
                    .iter()
                    .filter(|c| matches!(c.geometry, CurveGeometry::Circle { .. }))
                    .count(),
                6
            );
            near(blend.volume_mm3().unwrap(), 3941.8996637552213542);
            near(
                blend.face_areas_mm2().unwrap().iter().sum(),
                1441.0265241302609779,
            );
            let outside =
                std::array::from_fn(|k| if mask & (1 << k) == 0 { -0.004 } else { 0.020 });
            let Probe::Measured {
                distance_mm,
                inside,
                bound_mm,
            } = blend.distance_mm(frame.apply(outside, 1000., true).unwrap())
            else {
                panic!("missing probe")
            };
            assert!(!inside);
            assert!(bound_mm < 1e-8);
            assert!((distance_mm - 9.8564064605510183).abs() <= bound_mm + 2e-11);
            let Probe::Measured {
                inside,
                distance_mm,
                ..
            } = blend.distance_mm(frame.apply([0.008; 3], 1000., true).unwrap())
            else {
                panic!("missing inside")
            };
            assert!(inside);
            assert_eq!(distance_mm, 0.);
            let (lo, hi) = blend.bbox_mm(None).unwrap();
            for p in blend.world_vertices_mm().unwrap() {
                for k in 0..3 {
                    assert!(lo[k] <= p[k] && p[k] <= hi[k]);
                }
            }
        }
    }
}

#[test]
fn corner_edges_requery_as_arcs_and_keep_exact_shared_vertex_ties() {
    let a = box_at(Affine::IDENTITY, [16.; 3]);
    let body = fillet::constant_radius(&a, &selection(&a, [0.; 3]), 4.).unwrap();
    let blend = audit(&body.check().unwrap()).unwrap();
    let candidates: Vec<_> = (0..blend.body.edges.len()).map(|i| (&blend, i)).collect();

    // Two sphere/cylinder arcs and two tangent lines meet at this cardinal
    // point. They have the same exact zero distance, not merely close floats.
    let nearest = edge_query::closest(&candidates, [0., 4., 4.], 0.).unwrap();
    assert_eq!(nearest.len(), 4);
    assert_eq!(
        nearest
            .iter()
            .filter(|&&e| matches!(
                blend.body.curves[blend.body.edges[e].curve.0 as usize].geometry,
                CurveGeometry::Circle { .. }
            ))
            .count(),
        2
    );

    // The arc is sqrt(18)-4 away (< 0.25). Its chord is sqrt(2) away,
    // so substituting a chord would incorrectly select the competing box.
    let competitor = orthogonal::cuboid(
        BodyKey {
            id: [11, 12, 13, 14],
            revision: 0,
        },
        [1., 1., 4.5],
        [2., 2., 5.5],
    )
    .unwrap();
    let competitor = audit(&competitor.check().unwrap()).unwrap();
    let mut mixed = candidates;
    mixed.extend((0..competitor.body.edges.len()).map(|i| (&competitor, i)));
    let nearest = edge_query::closest(&mixed, [1., 1., 4.], 0.).unwrap();
    assert_eq!(nearest.len(), 1);
    assert!(
        nearest[0] < blend.body.edges.len(),
        "chord selected competing solid"
    );
    assert!(matches!(
        blend.body.curves[blend.body.edges[nearest[0]].curve.0 as usize].geometry,
        CurveGeometry::Circle { .. }
    ));
}

#[test]
fn critical_corner_radius_consumes_faces_without_zero_edges_or_lost_sphere() {
    // Independent decomposition into a rectangular core, rectangular slabs,
    // quarter-cylinder sectors and a sphere octant. Equality removes the
    // appropriate faces, not the solid; no geometric tolerance decides this.
    for (lengths, topology, cylinders) in [
        ([1., 2., 4.], (7, 14, 9), 2),
        ([1., 1., 4.], (5, 9, 6), 1),
        ([1.; 3], (4, 6, 4), 0),
    ] {
        for axis in 0..3 {
            let lengths = std::array::from_fn(|k| lengths[(k + axis) % 3]);
            for mask in 0..8 {
                let a = box_at(Affine::IDENTITY, lengths);
                let corner =
                    std::array::from_fn(|k| if mask & (1 << k) == 0 { 0. } else { lengths[k] });
                let body = fillet::constant_radius(&a, &selection(&a, corner), 1.).unwrap();
                let words = wonky_wire::v3::encode(&body).unwrap();
                let blend = audit(&wonky_wire::v3::decode(&words).unwrap()).unwrap();
                let t = blend.topology();
                assert_eq!((t.faces, t.edges, t.vertices), topology);
                assert_eq!((t.bodies, t.shells, t.genus), (1, 1, 0));
                assert_eq!(
                    blend
                        .body
                        .surfaces
                        .iter()
                        .filter(|s| matches!(s.geometry, SurfaceGeometry::Cylinder { .. }))
                        .count(),
                    cylinders
                );
                assert_eq!(
                    blend
                        .body
                        .surfaces
                        .iter()
                        .filter(|s| matches!(s.geometry, SurfaceGeometry::Sphere { .. }))
                        .count(),
                    1
                );
                let d = lengths.map(|l| l - 1.);
                let sum = d.iter().sum::<f64>();
                let pairs = d[0] * d[1] + d[1] * d[2] + d[2] * d[0];
                let pi = std::f64::consts::PI;
                near(
                    blend.volume_mm3().unwrap(),
                    (d.iter().product::<f64>() + pairs + pi * sum / 4. + pi / 6.) * 1e9,
                );
                let areas = blend.face_areas_mm2().unwrap();
                assert_eq!(areas.len(), t.faces);
                assert!(areas.iter().all(|&area| area > 0.));
                near(
                    areas.iter().sum(),
                    (2. * pairs + 2. * sum + pi * sum / 2. + 5. * pi / 4.) * 1e6,
                );
                let perimeters = blend.face_perimeters_mm().unwrap();
                assert_eq!(perimeters.len(), t.faces);
                assert!(perimeters.iter().all(|&p| p > 0.));
                if cylinders == 0 {
                    let (center, bound) = blend.centroid_with_bound_mm().unwrap();
                    for k in 0..3 {
                        let expected = if mask & (1 << k) == 0 { 625. } else { 375. };
                        assert!((center[k] - expected).abs() <= bound[k]);
                        assert!(bound[k] < 1e-8);
                    }
                }
            }
        }
    }
    // One ulp below the critical value retains the narrow faces. One ulp above
    // still needs overflow construction, rather than snapping back to equality.
    let a = box_at(Affine::IDENTITY, [1.; 3]);
    let edges = selection(&a, [0.; 3]);
    let below = fillet::constant_radius(&a, &edges, 1f64.next_down()).unwrap();
    assert_eq!(audit(&below.check().unwrap()).unwrap().topology().faces, 10);
    assert_eq!(
        fillet::constant_radius(&a, &edges, 1f64.next_up())
            .unwrap_err()
            .0,
        "fillet/edge-overflow-unimplemented"
    );
}

#[test]
fn corner_rejects_planted_sphere_trim_and_lineage_corruption() {
    let a = box_at(Affine::IDENTITY, [16.; 3]);
    let body = fillet::constant_radius(&a, &selection(&a, [0.; 3]), 4.).unwrap();
    for plant in 0..6 {
        let mut bad = body.clone();
        match plant {
            0 => {
                if let SurfaceGeometry::Sphere { radius, .. } =
                    &mut bad.surfaces.last_mut().unwrap().geometry
                {
                    *radius = Binary64::new(3.).unwrap();
                }
            }
            1 => bad.vertices[0].point[0] = Binary64::new(0.125).unwrap(),
            2 => bad.coedges[0].forward = !bad.coedges[0].forward,
            3 => bad.faces.last_mut().unwrap().forward = false,
            4 => bad.constructions.last_mut().unwrap().parameters[0] = Binary64::new(3.).unwrap(),
            _ => {
                if let wonky_contract::PcurveGeometry::Line { a, .. } =
                    &mut bad.pcurves.last_mut().unwrap().geometry
                {
                    a[1] = Binary64::new(0.125).unwrap();
                }
            }
        }
        assert!(
            audit(&bad.check().unwrap()).is_err(),
            "accepted plant {plant}"
        );
    }
}

#[test]
fn source_corner_retains_affine_volume_and_exact_boundary_without_snapping() {
    // The dyadic stretch changes volume by more than its rounding error and
    // makes a transpose-as-inverse misclassify the upper planar boundary.
    let s = 1. + 2f64.powi(-42);
    let frame = Affine { origin: [0.; 3], x: [s, 0., 0.], z: [0., 0., 1.] };
    let a = box_at(frame, [1.; 3]);
    let body = fillet::constant_radius(&a, &selection(&a, [0.; 3]), 0.25).unwrap();
    let blend = audit(&body.check().unwrap()).unwrap();
    assert_eq!(blend.frame, a.frame);
    let pi = std::f64::consts::PI;
    // Core + three slabs + three quarter-cylinder sectors + sphere octant.
    let volume = (0.75f64.powi(3) + 3. * 0.75f64.powi(2) * 0.25
        + 3. * 0.75 * 0.25f64.powi(2) * pi / 4. + 0.25f64.powi(3) * pi / 6.) * s * s * 1e9;
    assert!((blend.volume_mm3().unwrap() - volume).abs() < volume * 2e-15);
    let boundary = 1000. * s;
    for (x, expected) in [(boundary.next_down(), true), (boundary, true), (boundary.next_up(), false)] {
        let Probe::Measured { inside, distance_mm, bound_mm } = blend.distance_mm([x, 500. * s, 500.]) else { panic!("missing world probe") };
        assert_eq!(inside, expected);
        if expected { assert_eq!(distance_mm, 0.); }
        else { assert!((distance_mm - (x - boundary)).abs() <= bound_mm); }
    }
    // An exact mapped spherical cardinal point preserves all four incident
    // edge identities, even though nonzero source-distance ties may not survive.
    let candidates: Vec<_> = (0..blend.body.edges.len()).map(|e| (&blend, e)).collect();
    assert_eq!(edge_query::closest(&candidates, [0., 0.25 * s, 0.25], 0.).unwrap().len(), 4);
    let budget = blend.export_tolerance_mm().unwrap();
    assert!(budget > (s - 1.) * 1000. && budget < 1e-6);

    let mut large = box_at(Affine::IDENTITY, [1.; 3]).body;
    if let wonky_contract::Frame::Interpreter { x, .. } = &mut large.frames[1] {
        x[0] = Binary64::new(2.).unwrap();
    }
    let large = audit(&large.check().unwrap()).unwrap();
    assert_eq!(fillet::constant_radius(&large, &selection(&large, [0.; 3]), 0.25).unwrap_err().0,
        "source-frame/world-metric-distortion");
}

#[test]
fn asymmetric_corner_moments_and_oblique_extents_enclose_independent_integrals() {
    // Independent high-precision integration of box minus three circular-notch
    // prisms and one sphere-octant complement. Anisotropy catches axis mixups.
    let a = box_at(Affine::IDENTITY, [12., 16., 20.]);
    let b = fillet::constant_radius(&a, &selection(&a, [0.; 3]), 4.).unwrap();
    let blend = audit(&b.check().unwrap()).unwrap();
    let (centroid, bounds) = blend.centroid_with_bound_mm().unwrap();
    for k in 0..3 {
        let expected = [
            6155.9254914098084987,
            8190.7036574184452697,
            10210.576895137666282,
        ][k];
        assert!(
            (centroid[k] - expected).abs() <= bounds[k] + 2e-12,
            "axis {k}: {} +/- {}",
            centroid[k],
            bounds[k]
        );
        assert!(bounds[k] < 1e-8);
    }
    let (lo, hi) = blend
        .bbox_mm(Some([
            [1., 1., 1., 5.],
            [-1., -1., -1., -5.],
            [1., -1., 0., 7.],
        ]))
        .unwrap();
    for (actual, expected) in [
        (lo[0], 5076.7967697244908259),
        (hi[0], 48005.),
        (lo[1], -48005.),
        (hi[1], -5076.7967697244908259),
        (lo[2], -15993.),
        (hi[2], 12007.),
    ] {
        near(actual, expected);
    }
    // Membership at, below and above the spherical cardinal point, plus a
    // simultaneous upper-face/lower-cylinder projection (not the sphere).
    for (p, inside, distance) in [
        ([0., 4000., 4000.], true, 0.),
        ([-1., 4000., 4000.], false, 1.),
        ([1., 4000., 4000.], true, 0.),
        ([13000., 0., 0.], false, 1935.2431382286206),
    ] {
        let Probe::Measured {
            distance_mm,
            inside: actual,
            bound_mm,
        } = blend.distance_mm(p)
        else {
            panic!("missing probe")
        };
        assert_eq!(actual, inside);
        assert!((distance_mm - distance).abs() <= bound_mm + 2e-10);
    }
}
