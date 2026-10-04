//! Polynomial prism leaves through the real Boolean/audit/export boundary.
//! Closed forms are Green integrals of the cubic, not output-derived goldens.
use wonky_contract::{sketch3::Entity, Body, BodyKey, CurveGeometry, Limit, SurfaceGeometry};
use wonky_ops::{affine::Affine, analytic::{self, Solid}, curve_profile, cylinder, mesh, orthogonal};

const KEY: BodyKey = BodyKey { id: [11, 1, 0, 0], revision: 0 };
fn solid(body: Body) -> Solid {
    analytic::audit(&body.check().unwrap()).unwrap()
}
fn profile(frame: Affine, controls: &[[f64; 2]], depth: f64) -> Solid {
    let entities = [
        Entity::Bezier { controls: controls.to_vec() },
        Entity::Line { a: *controls.last().unwrap(), b: controls[0] },
    ];
    solid(curve_profile::build(KEY, frame, &entities, depth, false).unwrap())
}
fn arch() -> Solid {
    profile(Affine::IDENTITY, &[[0., 0.], [8., 6.], [18., 6.], [26., 0.]], 4.)
}
fn boolean(op: u8, operands: &[Solid]) -> Body {
    let mut bodies = analytic::boolean(KEY, op, operands).unwrap();
    assert_eq!(bodies.len(), 1);
    bodies.remove(0)
}
fn number(json: &str, field: &str) -> f64 {
    let start = json.find(&format!("\"{field}\":")).unwrap() + field.len() + 3;
    let rest = &json[start..];
    rest[..rest.find([',', '}']).unwrap()].parse().unwrap()
}
fn volume(body: &Body) -> f64 {
    number(&solid(body.clone()).measure(None, &[]).unwrap(), "volumeMm3") / 1e9
}
fn near(got: f64, want: f64) {
    assert!((got - want).abs() <= want.abs() * 1e-12, "{got} != {want}");
}

#[test]
fn spline_side_merges_across_pocket_slabs_and_replay_rejects_changed_controls() {
    // Interior blind pocket: it changes the cap at z=2, not the spline carrier.
    // Area 396/5 times depth 4, minus a 6 x 1 x 2 pocket: 1524/5.
    let tool = solid(orthogonal::cuboid(KEY, [10., 1., 2.], [16., 2., 6.]).unwrap());
    let body = boolean(1, &[arch(), tool]);
    near(volume(&body), 1524. / 5.);
    let observed = solid(body.clone()).measure(None, &[]).unwrap();
    for (field, want) in [("faces", 9.), ("edges", 18.), ("vertices", 12.), ("genus", 0.)] {
        assert_eq!(number(&observed[observed.find("\"topology\"").unwrap()..], field), want, "{observed}");
    }
    assert_eq!(body.surfaces.iter().filter(|s| matches!(s.geometry, SurfaceGeometry::LinearExtrusion { .. })).count(), 1);
    let spline_edges: Vec<_> = body.edges.iter().filter(|e| matches!(body.curves[e.curve.0 as usize].geometry, CurveGeometry::BSpline { .. })).collect();
    assert_eq!(spline_edges.len(), 2, "the spline side crosses both axial slabs without a seam edge");
    for e in spline_edges {
        assert!(matches!(e.domain.lower, Limit::Finite { value, .. } if value.get() == 0.));
        assert!(matches!(e.domain.upper, Limit::Finite { value, .. } if value.get() == 1.));
    }
    // S6's existing new-vertex refusal remains explicit even at rational t=1/2.
    let crossing = solid(orthogonal::cuboid(KEY, [13., -1., 2.], [30., 10., 6.]).unwrap());
    assert_eq!(analytic::boolean(KEY, 1, &[arch(), crossing]).unwrap_err().0, "curve2/crossing-needs-algebraic-vertex");
    let step = analytic::step(&[("trimmed".into(), solid(body.clone()))], "trimmed").unwrap();
    assert_eq!(step.matches("SURFACE_OF_LINEAR_EXTRUSION(").count(), 1);
    // The mesh is explicitly tessellated output; carrier topology remains smooth.
    let triangles = mesh::tessellate(&body.clone().check().unwrap(), 1.).unwrap();
    mesh::check_watertight(&triangles).unwrap();
    // Boolean replay, not the rounded spline controls, owns exact geometry.
    let mut tampered = body;
    let spline = tampered.curves.iter_mut().find(|c| matches!(c.geometry, CurveGeometry::BSpline { .. })).unwrap();
    if let CurveGeometry::BSpline { controls, .. } = &mut spline.geometry {
        controls[1][1] = wonky_contract::Binary64::new(99.).unwrap();
    }
    assert!(analytic::audit(&tampered.check().unwrap()).is_err());
}

#[test]
fn distinct_spline_carriers_with_identical_ends_survive_boolean_identity() {
    // The mirror shares both endpoints but NOT the arch's carrier. An
    // endpoint-only identity erases a face/cell or refuses this valid solid.
    let lower = profile(Affine::IDENTITY, &[[0., 0.], [8., -6.], [18., -6.], [26., 0.]], 4.);
    let body = boolean(0, &[arch(), lower]);
    near(volume(&body), 3168. / 5.);
    assert_eq!(body.faces.len(), 4);
    assert_eq!(body.surfaces.iter().filter(|s| matches!(s.geometry, SurfaceGeometry::LinearExtrusion { .. })).count(), 2);
    assert_eq!(body.curves.iter().filter(|c| matches!(c.geometry, CurveGeometry::BSpline { .. })).count(), 4);
}

#[test]
fn polynomial_leaves_pull_back_through_r0_r1_r2_and_r3_frames() {
    // Two near-unit dyadic frames with the same norm have an EXACT R2
    // relation, without pretending binary64 0.6/0.8 is a unit rotation.
    let eps = 2f64.powi(-17);
    let delta = eps * eps;
    let base_frame = Affine { origin: [0.; 3], x: [1., eps, 0.], z: [0., 0., 1.] };
    let base = profile(base_frame, &[[0., 0.], [8., 6.], [18., 6.], [26., 0.]], 4.);
    let small = [[-1., 0.], [-0.5, 1.], [0.5, 1.], [1., 0.]];
    let center = [13. - 2. * eps, 2. + 13. * eps, 0.];
    // Small-profile area 21/20, all cutters overrun or match the base height.
    let base_volume = 1584. / 5. * (1. + delta);
    for (name, frame, offset, removed) in [
        ("R0", base_frame, [13., 2.], 4.2 * (1. + delta)),
        ("R1", Affine { origin: center, x: [-eps, 1., 0.], z: [0., 0., 1.] }, [0.; 2], 4.2 * (1. + delta)),
        ("R2", Affine { origin: center, x: [1., -eps, 0.], z: [0., 0., 1.] }, [0.; 2], 4.2 * (1. + delta)),
        ("R3", Affine { origin: center, x: [1. + delta, eps, 0.], z: [0., 0., 1. + delta] }, [0.; 2],
            4.2 * (1. + delta) * ((1. + delta).powi(2) + delta)),
    ] {
        let controls = small.map(|p| [p[0] + offset[0], p[1] + offset[1]]);
        let body = boolean(1, &[base.clone(), profile(frame, &controls, 4.)]);
        near(volume(&body), base_volume - removed);
        assert_eq!(body.surfaces.iter().filter(|s| matches!(s.geometry, SurfaceGeometry::LinearExtrusion { .. })).count(), 2, "{name}");
    }
}

#[test]
fn polynomial_stack_probe_encloses_world_frame_stretch() {
    // Measurement accepts world millimetres, while the arrangement lives in
    // its source chart. A point one local metre below the chord is s metres
    // away in world space; arithmetic rounding alone cannot enclose that.
    for s in [1. - 2f64.powi(-32), 1. + 2f64.powi(-32)] {
        let frame = Affine { origin: [0.; 3], x: [s, 0., 0.], z: [0., 0., 1.] };
        let leaf = profile(frame, &[[0., 0.], [8., 6.], [18., 6.], [26., 0.]], 4.);
        let body = boolean(0, &[leaf.clone(), leaf]);
        let observed = solid(body).measure(None, &[[13000. * s, -1000. * s, 2000.]]).unwrap();
        let distance = number(&observed, "distanceMm");
        let bound = number(&observed, "boundMm");
        assert!((distance - 1000. * s).abs() <= bound,
            "world distance {} is outside {} +/- {}", 1000. * s, distance, bound);
    }
}

#[test]
fn spline_circle_crossing_and_affine_circle_images_refuse_by_name() {
    // A disc wholly inside the arch is supported; increasing its radius
    // through the cubic needs algebraic vertices, never a chord substitute.
    let round = |r| solid(cylinder::create(KEY, cylinder::Spec { bottom: [13., 2., 0.], top: [13., 2., 4.], radius: r }).unwrap());
    let supported = boolean(1, &[arch(), round(1.)]);
    near(volume(&supported), 1584. / 5. - 4. * std::f64::consts::PI);
    let crossing = solid(cylinder::create(KEY, cylinder::Spec { bottom: [13., 3., 0.], top: [13., 3., 4.], radius: 2. }).unwrap());
    let error = analytic::boolean(KEY, 1, &[arch(), crossing]).unwrap_err();
    assert_eq!(error.0, "curve2/crossing-needs-algebraic-vertex");
    let image = round(1.).transform(Affine { origin: [0.; 3], x: [1. + 2f64.powi(-44), 0., 0.], z: [0., 0., 1.] }).unwrap();
    let error = analytic::boolean(KEY, 1, &[arch(), solid(image)]).unwrap_err();
    assert_eq!(error.0, "prism-stack/non-isometric-frame-relation");
}

#[test]
fn stack_mesh_refuses_world_rounding_outside_its_deviation() {
    let frame = Affine { origin: [0., 0., 1e12], ..Affine::IDENTITY };
    let leaf = profile(frame, &[[0., 0.], [0.008, 0.006], [0.018, 0.006], [0.026, 0.]], 0.00103);
    let body = boolean(0, &[leaf.clone(), leaf]);
    // The top rounds from 1e15 + 1.03 to 1e15 + 1 mm, outside D=0.01.
    assert_eq!(mesh::tessellate(&body.check().unwrap(), 0.01).unwrap_err().0,
        "export/stl/vertex-precision-budget");
}

#[test]
fn stack_mesh_identity_preserves_thin_feature_refinement() {
    let apex = [0.007156982421875, (4.060546875 - 1. / 128.) * 0.001];
    let entities = [
        Entity::Bezier { controls: vec![[0., 0.], [0.008, 0.006], [0.012, 0.006], [0.020, 0.]] },
        Entity::Line { a: [0.020, 0.], b: apex },
        Entity::Line { a: apex, b: [0., 0.] },
    ];
    let leaf = curve_profile::build(KEY, Affine::IDENTITY, &entities, 0.001, false).unwrap();
    let stacked = boolean(0, &[solid(leaf.clone()), solid(leaf.clone())]);
    let refined = mesh::tessellate(&stacked.check().unwrap(), 0.2).expect("identity must retain thin features");
    let standalone = mesh::tessellate(&leaf.check().unwrap(), 0.2).unwrap();
    assert!(refined.vertices.len() >= standalone.vertices.len(), "thin feature must refine, not repair by a coarse chord");
    mesh::check_watertight(&refined).unwrap();
    mesh::binary_stl(&[refined], 0.2).unwrap();
}

#[test]
fn stack_mesh_refines_clearance_between_outer_boundary_and_hole() {
    // The cubic has its horizontal maximum at (13,4.5) mm. The flat top
    // of an interior pocket is 1/128 mm below it, close to the first chord.
    // This exercises separation across cap loops and across pocket slabs.
    let leaf = profile(Affine::IDENTITY, &[[0., 0.], [0.008, 0.006], [0.018, 0.006], [0.026, 0.]], 0.004);
    let tool = solid(orthogonal::cuboid(KEY,
        [0.01299, 0.003, 0.002], [0.01301, (4.5 - 1. / 128.) * 0.001, 0.006]).unwrap());
    let body = boolean(1, &[leaf, tool]);
    let m = mesh::tessellate(&body.check().unwrap(), 0.2).expect("hole clearance refines rather than triangulating intersecting loops");
    assert!(m.vertices.len() > 100);
    mesh::check_watertight(&m).unwrap();
    mesh::binary_stl(&[m], 0.2).unwrap();
}

#[test]
fn stack_mesh_keeps_float32_serialization_budget_separate() {
    // World binary64 resolves this frame comfortably, but a 100000.003 mm
    // translation rounds to 100000 mm in f32. The writer must still refuse.
    let frame = Affine { origin: [0., 0., 100.000003], ..Affine::IDENTITY };
    let leaf = profile(frame, &[[0., 0.], [0.008, 0.006], [0.018, 0.006], [0.026, 0.]], 0.001);
    let body = boolean(0, &[leaf.clone(), leaf]);
    let m = mesh::tessellate(&body.check().unwrap(), 0.2).unwrap();
    assert_eq!(mesh::binary_stl(&[m], 0.001).unwrap_err().0, "export/stl/float32-deviation-exceeded");
}
