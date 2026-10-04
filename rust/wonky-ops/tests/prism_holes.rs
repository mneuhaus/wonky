//! Boolean boundary tests: independent area integrals, exact void membership,
//! sewn topology and replay corruption. No private dispatch assertions.
use wonky_contract::{Binary64, BodyKey, SurfaceGeometry};
use wonky_ops::{
    affine::Affine,
    analytic::{self, Solid},
    arc_profile,
    cylinder::{self, Spec},
    polyhedron,
};
fn key() -> BodyKey {
    BodyKey {
        id: [41, 7, 9, 2],
        revision: 0,
    }
}
fn plate() -> Solid {
    // Quarter-disc of radius 5; dyadic points from the 3-4-5 triple.
    let body = arc_profile::build(
        key(),
        Affine::IDENTITY,
        &[[0., 5., 0., 0.], [0., 0., 5., 0.]],
        &[[5., 0., 3., 4., 0., 5.]],
        2.,
        false,
    )
    .unwrap();
    Solid::Planar(polyhedron::audit(&body.check().unwrap()).unwrap())
}
fn tool(center: [f64; 2], radius: f64, levels: [f64; 2], frame: Affine) -> Solid {
    let c = cylinder::audit(
        &cylinder::create(
            key(),
            Spec {
                bottom: [center[0], center[1], levels[0]],
                top: [center[0], center[1], levels[1]],
                radius,
            },
        )
        .unwrap()
        .check()
        .unwrap(),
    )
    .unwrap();
    Solid::Cylinder(
        cylinder::audit(&cylinder::transform(&c, frame).unwrap().check().unwrap()).unwrap(),
    )
}
#[test]
fn arc_prism_axial_hole_is_sewn_and_replayed_in_related_frames() {
    for (center, frame) in [
        ([1., 2.], Affine::IDENTITY),
        (
            [2., 1.],
            Affine {
                origin: [0.; 3],
                x: [0., 1., 0.],
                z: [0., 0., -1.],
            },
        ),
    ] {
        let mut result =
            analytic::boolean(key(), 1, &[plate(), tool(center, 0.5, [-3., 3.], frame)]).unwrap();
        assert_eq!(result.len(), 1);
        let body = result.pop().unwrap();
        assert_eq!(body.faces.len(), 6);
        for edge in 0..body.edges.len() {
            let uses = body
                .coedges
                .iter()
                .filter(|c| c.edge.0 as usize == edge)
                .collect::<Vec<_>>();
            assert_eq!(uses.len(), 2);
            assert_ne!(uses[0].forward, uses[1].forward);
        }
        let solid = analytic::audit(&body.clone().check().unwrap()).unwrap();
        let json = solid
            .measure(None, &[[1000., 2000., 1000.], [2000., 1000., 1000.]])
            .unwrap();
        let volume = json
            .split("\"volumeMm3\":")
            .nth(1)
            .unwrap()
            .split(',')
            .next()
            .unwrap()
            .parse::<f64>()
            .unwrap();
        let expected = 12. * std::f64::consts::PI * 1e9;
        assert!((volume - expected).abs() < expected * 1e-10);
        assert!(json.contains("\"inside\":false"));
        assert!(json.contains("\"inside\":true"));
        assert!(analytic::step(&[("drilled".into(), solid)], "drilled")
            .unwrap()
            .contains("MANIFOLD_SOLID_BREP"));
        let mut corrupt = body;
        if let SurfaceGeometry::Cylinder { radius, .. } =
            &mut corrupt.surfaces.last_mut().unwrap().geometry
        {
            *radius = Binary64::new(radius.get().next_up()).unwrap();
        } else {
            panic!("missing hole wall");
        }
        assert!(analytic::audit(&corrupt.check().unwrap()).is_err());
    }
}
#[test]
fn hole_crossing_the_trimmed_arc_keeps_a_manifold_wall() {
    let body = analytic::boolean(key(), 1,
        &[plate(), tool([3., 4.], 0.5, [-1., 3.], Affine::IDENTITY)])
        .unwrap().remove(0);
    let solid = analytic::audit(&wonky_wire::v3::decode(&wonky_wire::v3::encode(&body).unwrap()).unwrap()).unwrap();
    // Independent two-circle lens, R=5, r=0.5, centre distance=5.
    let lens = 25. * 0.995_f64.acos() + 0.25 * 0.05_f64.acos()
        - 0.5 * (0.5_f64 * 9.5 * 0.5 * 10.5).sqrt();
    let expected = (25. * std::f64::consts::PI / 4. - lens) * 2. * 1e9;
    let json = solid.measure(None, &[]).unwrap();
    let volume: f64 = json.split("\"volumeMm3\":").nth(1).unwrap().split(',').next().unwrap().parse().unwrap();
    assert!((volume - expected).abs() < expected * 1e-10);
    assert!(json.contains("\"genus\":0"));
    for e in 0..body.edges.len() {
        let uses = body.coedges.iter().filter(|c| c.edge.0 as usize == e).collect::<Vec<_>>();
        assert_eq!(uses.len(), 2);
        assert_ne!(uses[0].forward, uses[1].forward);
    }
    assert!(analytic::step(&[("crossing-hole".into(), solid)], "crossing-hole").unwrap().contains("CYLINDRICAL_SURFACE"));
}

#[test]
fn multiple_polygon_holes_and_cylindrical_pockets_keep_floors_and_genus() {
    let lines = [
        [0., 0., 8., 0.],
        [8., 0., 6., 6.],
        [6., 6., 0., 6.],
        [0., 6., 0., 0.],
    ];
    let segments = lines.map(|p| [wonky_num::p2(p[0], p[1]), wonky_num::p2(p[2], p[3])]);
    let region = wonky_sketch::region::lines_region(&segments).unwrap();
    let polygon = wonky_ops::extrude::blind_prism(&wonky_ops::extrude::Prism {
        key: key(),
        source: [0; 4],
        frame: Affine::IDENTITY,
        segments: &lines,
        region: &region.loops[0],
        depth: 4.,
        reverse: false,
    })
    .unwrap();
    let polygon = Solid::Planar(polyhedron::audit(&polygon.check().unwrap()).unwrap());
    // Trapezoid area 42, depth 4; one through-hole and one top blind hole.
    let cases = [
        (
            polygon,
            vec![
                tool([2., 2.], 0.5, [-1., 5.], Affine::IDENTITY),
                tool([5., 2.], 0.5, [2., 5.], Affine::IDENTITY),
            ],
            (168. - 1.5 * std::f64::consts::PI) * 1e9,
            1,
            vec![
                ([5000., 2000., 3000.], false),
                ([5000., 2000., 2000.], true),
                ([5000., 2000., 1000.], true),
            ],
        ),
        (
            tool([0., 0.], 5., [0., 4.], Affine::IDENTITY),
            vec![tool([2., 0.], 1., [2., 5.], Affine::IDENTITY)],
            98. * std::f64::consts::PI * 1e9,
            0,
            vec![
                ([2000., 0., 3000.], false),
                ([2000., 0., 2000.], true),
                ([2000., 0., 2000_f64.next_up()], false),
            ],
        ),
    ];
    for (base, tools, expected, genus, points) in cases {
        let inputs = std::iter::once(base).chain(tools).collect::<Vec<_>>();
        let result = analytic::boolean(key(), 1, &inputs).unwrap();
        assert_eq!(result.len(), 1);
        let wire = wonky_wire::v3::encode(&result[0]).unwrap();
        let solid = analytic::audit(&wonky_wire::v3::decode(&wire).unwrap()).unwrap();
        let Solid::PrismHoles(p) = &solid else {
            panic!("missing hole boundary")
        };
        for (point, inside) in points {
            assert_eq!(p.probe(point).unwrap().1, inside, "{point:?}")
        }
        let json = solid.measure(None, &[]).unwrap();
        let volume = json
            .split("\"volumeMm3\":")
            .nth(1)
            .unwrap()
            .split(',')
            .next()
            .unwrap()
            .parse::<f64>()
            .unwrap();
        assert!((volume - expected).abs() < expected * 1e-10);
        assert!(json.contains(&format!("\"genus\":{genus}")));
        assert!(analytic::step(&[("pockets".into(), solid)], "pockets").is_ok());
    }
}

// The auditor, unlike the FS exporter test, must reject a forged rational
// carrier cache after wire decode. The same target also exercises exact trim
// contact classification rather than a polygon-count admission shortcut.
#[test]
fn rational_profile_holes_reject_changed_carriers_and_trim_contact() {
    let a = 3.0_f64.next_up();
    let lines = [
        [-4., -4., a, -4.],
        [a, -4., 4., 4.],
        [4., 4., -4., 4.],
        [-4., 4., -4., -4.],
    ];
    let body = arc_profile::build(key(), Affine::IDENTITY, &lines, &[], 2., false).unwrap();
    let target = analytic::audit(&body.check().unwrap()).unwrap();
    let mut result = analytic::boolean(
        key(),
        1,
        &[
            target.clone(),
            tool([0., 0.], 0.5, [-1., 3.], Affine::IDENTITY),
        ],
    )
    .unwrap()
    .remove(0);
    let decoded = wonky_wire::v3::decode(&wonky_wire::v3::encode(&result).unwrap()).unwrap();
    analytic::audit(&decoded).unwrap();
    if let SurfaceGeometry::Plane { origin, .. } = &mut result.surfaces[3].geometry {
        origin[0] = Binary64::new(origin[0].get().next_up()).unwrap();
    } else {
        panic!("missing polygon side");
    }
    assert_eq!(
        analytic::audit(&result.check().unwrap()).unwrap_err().0,
        "prism-holes/construction-carrier-mismatch"
    );
    // The shared arrangement resolves this half-disc opening exactly; the
    // legacy hole owner required a wholly interior circle. No trim is snapped.
    let opened = analytic::boolean(
            key(),
            1,
            &[target, tool([-4., 0.], 0.5, [-1., 3.], Affine::IDENTITY)]
        )
        .unwrap().remove(0);
    let solid = analytic::audit(&wonky_wire::v3::decode(&wonky_wire::v3::encode(&opened).unwrap()).unwrap()).unwrap();
    let json = solid.measure(None, &[]).unwrap();
    let volume: f64 = json.split("\"volumeMm3\":").nth(1).unwrap().split(',').next().unwrap().parse().unwrap();
    let expected = (8. * (a + 12.) - std::f64::consts::PI / 4.) * 1e9;
    assert!((volume - expected).abs() < expected * 1e-12);
    assert!(json.contains("\"genus\":0"));
    assert!(analytic::step(&[("half-disc-opening".into(), solid)], "half-disc-opening").is_ok());
}

#[test]
fn a_nearly_related_frame_is_not_silently_snapped() {
    let skew = Affine {
        origin: [0.; 3],
        x: [1., 0., 0.],
        z: [0., 0., 1_f64.next_up()],
    };
    let result = analytic::boolean(key(), 1, &[plate(), tool([1., 2.], 0.5, [-3., 3.], skew)]);
    assert_eq!(result.err().unwrap().0, "prism-stack/non-isometric-frame-relation");
}

#[test]
fn overlapping_planar_pocket_and_cylinder_tools_remove_their_union_once() {
    let box_solid = |lo, hi| {
        let body = wonky_ops::orthogonal::cuboid(key(), lo, hi).unwrap();
        analytic::audit(&body.check().unwrap()).unwrap()
    };
    let base = box_solid([0., 0., 0.], [12., 14., 8.]);
    let pocket = box_solid([3., 8., -1.], [9., 15., 3.]);
    let bore = tool([6., 11.], 1.5, [-1., 9.], Affine::IDENTITY);
    for tools in [
        [pocket.clone(), bore.clone()],
        [bore.clone(), pocket.clone()],
    ] {
        let body = analytic::boolean(
            key(),
            1,
            &[base.clone(), tools[0].clone(), tools[1].clone()],
        )
        .unwrap()
        .remove(0);
        let decoded = wonky_wire::v3::decode(&wonky_wire::v3::encode(&body).unwrap()).unwrap();
        let solid = analytic::audit(&decoded).unwrap();
        let m = solid.measure(None, &[]).unwrap();
        let volume: f64 = m
            .split("\"volumeMm3\":")
            .nth(1)
            .unwrap()
            .split(',')
            .next()
            .unwrap()
            .parse()
            .unwrap();
        let expected = (1344. - 108. - 11.25 * std::f64::consts::PI) * 1e9;
        assert!((volume - expected).abs() < expected * 1e-10);
        assert!(analytic::step(&[("pocket-and-bore".into(), solid)], "pocket-and-bore").is_ok());
    }
    let crossing = tool([3., 11.], 1.5, [-1., 9.], Affine::IDENTITY);
    let body = analytic::boolean(key(), 1, &[base, pocket, crossing]).unwrap().remove(0);
    let solid = analytic::audit(&body.clone().check().unwrap()).unwrap();
    let json = solid.measure(None, &[]).unwrap();
    let volume: f64 = json.split("\"volumeMm3\":").nth(1).unwrap().split(',').next().unwrap().parse().unwrap();
    // Only half of this bore overlaps the pocket for its first three levels.
    let expected = (1344. - 108. - (8. - 1.5) * 2.25 * std::f64::consts::PI) * 1e9;
    assert!((volume - expected).abs() < expected * 1e-10);
    assert!(json.contains("\"genus\":1"));
    for e in 0..body.edges.len() {
        let uses = body.coedges.iter().filter(|c| c.edge.0 as usize == e).collect::<Vec<_>>();
        assert_eq!(uses.len(), 2);
        assert_ne!(uses[0].forward, uses[1].forward);
    }
    assert!(analytic::step(&[("crossing-pocket".into(), solid)], "crossing-pocket").is_ok());
}

fn polygon_solid(points: &[[f64; 2]], z: f64, depth: f64) -> Solid {
    let lines = (0..points.len())
        .map(|i| {
            let [a, b] = [points[i], points[(i + 1) % points.len()]];
            [a[0], a[1], b[0], b[1]]
        })
        .collect::<Vec<_>>();
    let body = arc_profile::build(
        key(),
        Affine {
            origin: [0., 0., z],
            ..Affine::IDENTITY
        },
        &lines,
        &[],
        depth,
        false,
    )
    .unwrap();
    analytic::audit(&body.check().unwrap()).unwrap()
}

#[test]
fn polygon_end_pocket_and_bore_share_floor_without_duplicate_void_volume() {
    let hex = [
        [2., 0.],
        [1., 2.],
        [-1., 2.],
        [-2., 0.],
        [-1., -2.],
        [1., -2.],
    ];
    let outline = [
        [-5., -5.],
        [5., -5.],
        [5., 3.],
        [4., 3.],
        [4., 5.],
        [-5., 5.],
    ];
    for (target, area) in [
        (
            tool([0., 0.], 5., [0., 8.], Affine::IDENTITY),
            25. * std::f64::consts::PI,
        ),
        (polygon_solid(&outline, 0., 8.), 98.),
    ] {
        for z in [-1., 6.] {
            let result = analytic::boolean(
                key(),
                1,
                &[
                    target.clone(),
                    tool([0., 0.], 0.5, [-1., 9.], Affine::IDENTITY),
                    polygon_solid(&hex, z, 3.),
                ],
            )
            .unwrap()
            .remove(0);
            for e in 0..result.edges.len() {
                let uses = result
                    .coedges
                    .iter()
                    .filter(|u| u.edge.0 as usize == e)
                    .collect::<Vec<_>>();
                assert_eq!(uses.len(), 2);
                assert_ne!(uses[0].forward, uses[1].forward);
            }
            let decoded =
                wonky_wire::v3::decode(&wonky_wire::v3::encode(&result).unwrap()).unwrap();
            let solid = analytic::audit(&decoded).unwrap();
            let Solid::PrismHoles(p) = &solid else {
                panic!("missing exact pocket")
            };
            let entry_z = if z < 0. { 1. } else { 7. };
            assert!(!p.probe([1000., 0., entry_z * 1000.]).unwrap().1);
            assert!(p.probe([1000., 0., 4000.]).unwrap().1);
            assert!(!p.probe([0., 0., 4000.]).unwrap().1);
            let json = solid.measure(None, &[]).unwrap();
            let volume = json
                .split("\"volumeMm3\":")
                .nth(1)
                .unwrap()
                .split(',')
                .next()
                .unwrap()
                .parse::<f64>()
                .unwrap();
            let expected = (area * 8. - 24. - 1.5 * std::f64::consts::PI) * 1e9;
            assert!(
                (volume - expected).abs() < expected * 1e-10,
                "{volume} != {expected}"
            );
            assert!(json.contains("\"genus\":1"));
            assert!(analytic::step(&[("pocket".into(), solid)], "pocket").is_ok());
        }
    }
}

#[test]
fn polygon_pocket_crossing_outer_wall_or_bore_wall_refuses_by_name() {
    let hex = [
        [2., 0.],
        [1., 2.],
        [-1., 2.],
        [-2., 0.],
        [-1., -2.],
        [1., -2.],
    ];
    for (radius, bore, expected) in [
        (2., 0.5, "prism-stack/tangent-branch-order"),
        (5., 2., "prism-stack/tangent-branch-order"),
    ] {
        assert_eq!(
            analytic::boolean(
                key(),
                1,
                &[
                    tool([0., 0.], radius, [0., 8.], Affine::IDENTITY),
                    tool([0., 0.], bore, [-1., 9.], Affine::IDENTITY),
                    polygon_solid(&hex, -1., 3.),
                ]
            )
            .unwrap_err()
            .0,
            expected
        );
    }
}

#[test]
fn polygon_floor_predicate_uses_source_sum_not_rounded_height() {
    let hex = [
        [2., 0.],
        [1., 2.],
        [-1., 2.],
        [-2., 0.],
        [-1., -2.],
        [1., -2.],
    ];
    let mut body = analytic::boolean(
        key(),
        1,
        &[
            tool([0., 0.], 5., [0., 2.], Affine::IDENTITY),
            polygon_solid(&hex, -0.03, 0.4),
        ],
    )
    .unwrap()
    .remove(0);
    let solid = analytic::audit(&body.clone().check().unwrap()).unwrap();
    let Solid::PrismHoles(p) = solid else {
        panic!("missing pocket")
    };
    // Exact -binary64(0.03)+binary64(0.4) is just above 370/1000,
    // while binary64(0.37) is below it. Snapping would fill this point.
    assert!(!p.probe([1000., 0., 370.]).unwrap().1);
    assert!(p.probe([1000., 0., 370.0_f64.next_up()]).unwrap().1);
    if let SurfaceGeometry::Plane { origin, .. } = &mut body.surfaces[3].geometry {
        origin[2] = Binary64::new(origin[2].get().next_up()).unwrap();
    } else {
        panic!("missing floor")
    }
    assert_eq!(
        analytic::audit(&body.check().unwrap()).unwrap_err().0,
        "prism-holes/construction-carrier-mismatch"
    );
}

fn volume_mm3(solid: &Solid) -> f64 {
    let json = solid.measure(None, &[]).unwrap();
    assert!(json.contains("\"genus\":1"), "{json}");
    json.split("\"volumeMm3\":")
        .nth(1)
        .unwrap()
        .split(',')
        .next()
        .unwrap()
        .parse::<f64>()
        .unwrap()
}
fn shoelace(points: &[[f64; 2]]) -> f64 {
    (0..points.len())
        .map(|i| {
            let [a, b] = [points[i], points[(i + 1) % points.len()]];
            a[0] * b[1] - a[1] * b[0]
        })
        .sum::<f64>()
        / 2.
}
/// Boundary result, re-read through the wire exactly as the host does.
fn reaudit(mut bodies: Vec<wonky_contract::Body>) -> Solid {
    assert_eq!(bodies.len(), 1);
    let body = bodies.remove(0);
    for e in 0..body.edges.len() {
        let uses = body
            .coedges
            .iter()
            .filter(|u| u.edge.0 as usize == e)
            .collect::<Vec<_>>();
        assert_eq!(uses.len(), 2);
        assert_ne!(uses[0].forward, uses[1].forward);
    }
    analytic::audit(&wonky_wire::v3::decode(&wonky_wire::v3::encode(&body).unwrap()).unwrap())
        .unwrap()
}

#[test]
fn sequential_bore_and_hex_pocket_subtractions_equal_one_difference() {
    // Hex from its flat distance a (non-dyadic h = a/sqrt(3)); a trig-point
    // toothed target stands in for a gear. Floor at -0.02+3.1 is not binary64.
    let a = 1.7_f64;
    let h = a / 3f64.sqrt();
    let hex = [[2. * h, 0.], [h, a], [-h, a], [-2. * h, 0.], [-h, -a], [h, -a]];
    let teeth = (0..36)
        .map(|i| {
            let (r, t) = (if i % 2 == 0 { 6.5 } else { 5.75 }, i as f64 * 10f64.to_radians());
            [r * t.cos(), r * t.sin()]
        })
        .collect::<Vec<_>>();
    let bore = || tool([0., 0.], 0.8, [-1., 10.], Affine::IDENTITY);
    let pocket = || polygon_solid(&hex, -0.02, 3.1);
    for (target, area) in [
        (tool([0., 0.], 6., [0., 9.], Affine::IDENTITY), 36. * std::f64::consts::PI),
        (polygon_solid(&teeth, 0., 9.), shoelace(&teeth)),
    ] {
        let one = reaudit(analytic::boolean(key(), 1, &[target.clone(), bore(), pocket()]).unwrap());
        let floor = -0.02 + 3.1;
        let disc = 0.64 * std::f64::consts::PI;
        let expected = (area * 9. - shoelace(&hex) * floor - disc * (9. - floor)) * 1e9;
        let single = volume_mm3(&one);
        assert!((single - expected).abs() < expected * 1e-9, "{single} != {expected}");
        for (first, second) in [(bore(), pocket()), (pocket(), bore())] {
            let stage = reaudit(analytic::boolean(key(), 1, &[target.clone(), first]).unwrap());
            let done = reaudit(analytic::boolean(key(), 1, &[stage, second]).unwrap());
            let Solid::PrismHoles(p) = &done else {
                panic!("sequential difference is not one exact arrangement")
            };
            assert_eq!(volume_mm3(&done), single);
            // Pocket void beside the bore, material just below the floor,
            // bore void below the pocket floor, material outside the hex.
            assert!(!p.probe([1200., 0., 1000.]).unwrap().1);
            assert!(p.probe([1200., 0., 3200.]).unwrap().1);
            assert!(!p.probe([0., 0., 5000.]).unwrap().1);
            assert!(p.probe([2500., 0., 1000.]).unwrap().1);
            assert!(analytic::step(&[("seq".into(), done)], "seq")
                .unwrap()
                .contains("MANIFOLD_SOLID_BREP"));
        }
    }
}

#[test]
fn sequential_subtraction_keeps_named_refusals_for_crossing_or_union_sources() {
    let hex = [[2., 0.], [1., 2.], [-1., 2.], [-2., 0.], [-1., -2.], [1., -2.]];
    // The hex corners reach radius 2.24 > 2: the second stage crosses the wall.
    let tube = reaudit(
        analytic::boolean(
            key(),
            1,
            &[
                tool([0., 0.], 2., [0., 8.], Affine::IDENTITY),
                tool([0., 0.], 0.5, [-1., 9.], Affine::IDENTITY),
            ],
        )
        .unwrap(),
    );
    assert_eq!(
        analytic::boolean(key(), 1, &[tube, polygon_solid(&hex, -1., 3.)])
            .unwrap_err()
            .0,
        "prism-stack/tangent-branch-order"
    );
    // A coaxial union is not a difference; nothing is re-arranged from it.
    let union = reaudit(
        analytic::boolean(
            key(),
            0,
            &[
                tool([0., 0.], 5., [0., 8.], Affine::IDENTITY),
                tool([0., 0.], 3., [7., 12.], Affine::IDENTITY),
            ],
        )
        .unwrap(),
    );
    assert!(matches!(union, Solid::Coaxial(_)));
    // The family's `cylinder/mixed-boolean-arrangement` routes to the general
    // Boolean (boolean3d G12), which has no coaxial-union operand adapter yet.
    assert_eq!(
        analytic::boolean(key(), 1, &[union, polygon_solid(&hex, -1., 3.)])
            .unwrap_err()
            .0,
        "boolean/ssi-row-unavailable:operand/coaxial"
    );
}

/// Outside the target, the nearest retained point can be a hole rim, a blind
/// floor, a pocket wall or a slot edge rather than the target's own nearest
/// point. Every expected value is the closed form of the named nearest piece;
/// the target-only distance (which ignores the cuts) differs in each rim,
/// floor, mouth and pocket case.
#[test]
fn outside_probes_measure_the_nearest_retained_boundary() {
    let box_solid = |lo, hi| {
        let body = wonky_ops::orthogonal::cuboid(key(), lo, hi).unwrap();
        analytic::audit(&body.check().unwrap()).unwrap()
    };
    let trapezoid = [[0., 0.], [8., 0.], [6., 6.], [0., 6.]];
    let square = [[0., 0.], [10., 0.], [10., 10.], [0., 10.]];
    let hex = [[2., 0.], [1., 2.], [-1., 2.], [-2., 0.], [-1., -2.], [1., -2.]];
    let outline = [[-5., -5.], [5., -5.], [5., 3.], [4., 3.], [4., 5.], [-5., 5.]];
    let cases: Vec<(&str, Vec<Solid>, Vec<([f64; 3], f64)>)> = vec![
        (
            "polygon with through and blind holes",
            vec![
                polygon_solid(&trapezoid, 0., 4.),
                tool([2., 2.], 0.5, [-1., 5.], Affine::IDENTITY),
                tool([5., 2.], 0.5, [2., 5.], Affine::IDENTITY),
            ],
            vec![
                ([-1., 3., 2.], 1.),                  // side wall x = 0
                ([2., 2., 5.], 1.25_f64.sqrt()),      // through-hole top rim
                ([2., 2., -0.5], 0.5_f64.sqrt()),     // through-hole bottom rim
                ([5., 2., 4.25], 0.3125_f64.sqrt()),  // blind-hole rim, floor 2.25
                ([5., 2., -1.], 1.),                  // bottom cap is whole there
            ],
        ),
        (
            "wide shallow blind hole",
            vec![
                polygon_solid(&square, 0., 4.),
                tool([5., 5.], 4., [3., 5.], Affine::IDENTITY),
            ],
            // The floor (z = 3) beats the rim (sqrt(16.25)) and the target (0.5).
            vec![([5., 5., 4.5], 1.5), ([5., 5., -0.5], 0.5), ([12., 5., 3.5], 2.)],
        ),
        (
            "cylinder with an off-axis blind hole",
            vec![
                tool([0., 0.], 5., [0., 4.], Affine::IDENTITY),
                tool([2., 0.], 1., [2., 5.], Affine::IDENTITY),
            ],
            vec![
                ([7., 0., 2.], 2.),
                ([2., 0., 4.5], 1.25_f64.sqrt()),
                ([-7., 0., 6.], 8_f64.sqrt()),
            ],
        ),
        (
            "cell block with a side-open slot crossed by a bore",
            vec![
                box_solid([0., 0., 0.], [20., 12., 10.]),
                box_solid([6., -1., 4.], [14., 8., 7.]),
                tool([10., 5.], 1.5, [-1., 11.], Affine::IDENTITY),
            ],
            vec![
                ([10., -1., 5.5], 3.25_f64.sqrt()), // mouth edges, not the open front
                ([9., 2., 4.5], 0.5),               // slot floor
                ([10., 5., 6.8], 2.29_f64.sqrt()),  // bore rim on the slot ceiling
                ([10., 5., 11.], 3.25_f64.sqrt()),  // bore rim on the top
                ([-3., -4., 5.], 5.),               // front-left edge
            ],
        ),
        (
            "polygon with an end pocket over a bore",
            vec![
                polygon_solid(&outline, 0., 8.),
                tool([0., 0.], 0.5, [-1., 9.], Affine::IDENTITY),
                polygon_solid(&hex, 6., 3.),
            ],
            vec![
                ([0., 0., 9.], 4.2_f64.sqrt()), // pocket mouth edge 4/sqrt(5) away
                ([4.5, 4., 4.], 0.5),           // in the outline's notch
                ([0., 0., -1.], 1.25_f64.sqrt()), // bore rim on the bottom
            ],
        ),
        (
            "quarter-disc arc prism with a hole",
            vec![plate(), tool([1., 2.], 0.5, [-3., 3.], Affine::IDENTITY)],
            vec![([6., 8., 1.], 5.), ([1., 2., 3.], 1.25_f64.sqrt())],
        ),
    ];
    for (name, inputs, probes) in cases {
        let solid = reaudit(analytic::boolean(key(), 1, &inputs).unwrap());
        let Solid::PrismHoles(p) = &solid else {
            panic!("{name}: not a holed profile")
        };
        for (point, expected) in probes {
            let (d, inside, bound) = p.probe(point.map(|x| x * 1000.)).unwrap();
            let expected = expected * 1000.;
            assert!(!inside, "{name} {point:?}");
            assert!(
                (d - expected).abs() <= bound + expected * 4. * f64::EPSILON && bound < 1e-9 * expected,
                "{name} {point:?}: {d} (+-{bound}) != {expected}"
            );
        }
        let json = solid.measure(None, &[[-1000., -1000., -1000.]]).unwrap();
        assert!(!json.contains("refused"), "{name}: {json}");
    }
}

/// Construction extents are the target's (cuts lie strictly inside it),
/// from exact source data; a curved profile refuses by name.
#[test]
fn holed_profiles_report_exact_target_extents() {
    let box_solid = |lo, hi| {
        let body = wonky_ops::orthogonal::cuboid(key(), lo, hi).unwrap();
        analytic::audit(&body.check().unwrap()).unwrap()
    };
    let hole = |c: [f64; 2], r| tool(c, r, [-1., 12.], Affine::IDENTITY);
    for (inputs, expected) in [
        (vec![polygon_solid(&[[0., 0.], [8., 0.], [6., 6.], [0., 6.]], 0., 4.), hole([2., 2.], 0.5)], Ok([8000., 6000., 4000.])),
        (vec![tool([0., 0.], 5., [0., 4.], Affine::IDENTITY), hole([2., 0.], 1.)], Ok([10000., 10000., 4000.])),
        (
            vec![box_solid([0., 0., 0.], [20., 12., 10.]), box_solid([6., -1., 4.], [14., 8., 7.]), hole([10., 5.], 1.5)],
            Ok([20000., 12000., 10000.]),
        ),
        (vec![plate(), hole([1., 2.], 0.5)], Err("bbox/arc-profile-source-extents")),
    ] {
        let solid = reaudit(analytic::boolean(key(), 1, &inputs).unwrap());
        assert!(matches!(solid, Solid::PrismHoles(_)));
        assert_eq!(solid.extents().map_err(|e| e.0), expected.map_err(String::from));
    }
}

#[test]
fn nested_placements_replay_sources_and_bind_bore_chart_to_target() {
    use wonky_ops::{orthogonal, pattern, placement::Post};
    use wonky_contract::{Frame, FrameId};
    let common = Affine { origin: [16., -32., 8.], x: [0., 1., 0.], z: [1., 0., 0.] };
    for interpreter_move in [false, true] {
        let initial = orthogonal::cuboid(key(), [0.; 3], [3., 2., 1.]).unwrap();
        let a = polyhedron::audit(&initial.check().unwrap()).unwrap();
        let move_map = Affine { origin: [5., 1., 0.], ..Affine::IDENTITY };
        let moved = if interpreter_move {
            orthogonal::transform(&a, move_map).unwrap()
        } else {
            pattern::copy(&a, key(), [[1.,0.,0.],[0.,1.,0.],[0.,0.,1.]], move_map.origin).unwrap().body
        };
        let a = polyhedron::audit(&moved.check().unwrap()).unwrap();
        let placed = pattern::place(&a, key(), &Post::Interpreter(common)).unwrap();
        let cutter = tool([6.5, 2.], 0.25, [-1., 2.], common);
        let body = analytic::boolean(key(), 1, &[Solid::Planar(placed), cutter]).unwrap().pop().unwrap();
        let solid = analytic::audit(&body.clone().check().unwrap()).unwrap();
        let volume = volume_mm3(&solid);
        let expected = (6. - std::f64::consts::PI * 0.0625) * 1e9;
        assert!((volume - expected).abs() < expected * 1e-10);
        let Solid::PrismHoles(holes) = &solid else { panic!("not drilled geometry") };
        for (p, inside, distance) in [
            ([16500., -25500., 10000.], false, 250.),
            ([16500., -26750., 9250.], true, 0.),
            ([16500., -27250., 9250.], false, 250.),
        ] {
            let (got, membership, bound) = holes.probe(p).unwrap();
            assert_eq!(membership, inside);
            assert!((got - distance).abs() <= bound, "{got} != {distance}, bound {bound}");
        }
        assert!(analytic::step(&[("nested".into(), solid)], "nested").unwrap().contains("MANIFOLD_SOLID_BREP"));
        let chart = body.frames.len() - 1;
        let Frame::Rigid { parent, .. } = body.frames[chart] else { panic!("missing bore chart") };
        assert_ne!(parent, FrameId(1));
        let mut corrupt = body.clone();
        if let Frame::Rigid { parent, .. } = &mut corrupt.frames[chart] { *parent = FrameId(1); }
        assert!(matches!(corrupt.check(), Err(wonky_contract::ContractError::Invalid("support binding"))));
        let mut corrupt = body;
        let input = corrupt.constructions.iter_mut().find(|n| n.operation == (wonky_contract::Operation::Interpreter {}) && n.parameters.len() == 6).unwrap();
        input.parameters[0] = Binary64::new(0.125).unwrap();
        assert!(analytic::audit(&corrupt.check().unwrap()).is_err());
    }
}

// Exercise the five-node polygon source emitted by the frontend, including
// its preserved plane inputs and the exact image chain of later placements.
fn source_polygon(points: &[[f64; 2]], origin: [f64; 3]) -> Solid {
    let lines = (0..points.len()).map(|i| {
        let (a, b) = (points[i], points[(i + 1) % points.len()]);
        [a[0], a[1], b[0], b[1]]
    }).collect::<Vec<_>>();
    let segments = lines.iter().map(|s| [wonky_num::p2(s[0], s[1]), wonky_num::p2(s[2], s[3])]).collect::<Vec<_>>();
    let regions = wonky_sketch::region::lines_region(&segments).unwrap();
    let body = wonky_ops::extrude::blind_prism(&wonky_ops::extrude::Prism {
        key: key(), source: [8, 3, 2, 1],
        frame: Affine { origin, ..Affine::IDENTITY },
        segments: &lines, region: &regions.loops[0], depth: 5., reverse: false,
    }).unwrap();
    analytic::audit(&body.check().unwrap()).unwrap()
}

#[test]
fn polygon_source_first_placement_preserves_plane_inputs_and_provenance() {
    let plate = source_polygon(&[[0., 0.], [16., 0.], [16., 12.], [0., 12.]], [0.; 3]);
    let frame = Affine { origin: [32., 8., 4.], x: [0., 1., 0.], z: [0., 0., -1.] };
    let moved = analytic::audit(&plate.transform(frame).unwrap().check().unwrap()).unwrap();
    let body = analytic::boolean(key(), 1, &[moved, tool([8., 6.], 1., [-1., 6.], frame)]).unwrap().remove(0);
    let decoded = wonky_wire::v3::decode(&wonky_wire::v3::encode(&body).unwrap()).unwrap();
    let solid = analytic::audit(&decoded).unwrap();
    let volume = solid.measure(None, &[]).unwrap();
    assert!(volume.contains("\"genus\":1"));
    let observed: f64 = volume.split("\"volumeMm3\":").nth(1).unwrap().split(',').next().unwrap().parse().unwrap();
    let expected = (960. - 5. * std::f64::consts::PI) * 1e9;
    assert!((observed - expected).abs() < expected * 1e-10);
    let mut planted = body;
    planted.constructions[0].parameters[0] = Binary64::new(1.).unwrap();
    assert!(analytic::audit(&planted.check().unwrap()).is_err(), "changed original plane must not be accepted");
}

#[test]
fn polygon_pocket_source_replays_image_chain_and_rejects_lineage_corruption() {
    let hex = [[2., 0.], [1., 2.], [-1., 2.], [-2., 0.], [-1., -2.], [1., -2.]];
    let pocket = source_polygon(&hex, [0., 0., 8.]);
    let frame = Affine { origin: [64., 16., 0.], x: [0., 1., 0.], z: [0., 0., 1.] };
    let moved = analytic::audit(&pocket.transform(frame).unwrap().check().unwrap()).unwrap();
    let body = analytic::boolean(key(), 1, &[
        tool([0., 0.], 5., [0., 12.], frame),
        tool([0., 0.], 0.5, [-1., 13.], frame), moved,
    ]).unwrap().remove(0);
    let decoded = wonky_wire::v3::decode(&wonky_wire::v3::encode(&body).unwrap()).unwrap();
    let solid = analytic::audit(&decoded).unwrap();
    let json = solid.measure(None, &[]).unwrap();
    let observed: f64 = json.split("\"volumeMm3\":").nth(1).unwrap().split(',').next().unwrap().parse().unwrap();
    let expected = (297. * std::f64::consts::PI - (12. - 0.25 * std::f64::consts::PI) * 4.) * 1e9;
    assert!((observed - expected).abs() < expected * 1e-10);
    let mut planted = body;
    let node = planted.constructions.iter_mut().find(|n| n.operation == wonky_contract::Operation::AffineTransform {}).unwrap();
    node.parents[0].0 -= 1;
    assert!(analytic::audit(&planted.check().unwrap()).is_err(), "changed wrapper parent must not be accepted");
}

#[test]
fn selected_arc_region_is_replayed_without_substituting_the_whole_sketch() {
    let arcs = [[1., 0., 0., 1., -1., 0.], [-1., 0., 0., -1., 1., 0.]];
    let source = arc_profile::build_region(key(), Affine::IDENTITY, &[], &arcs, 5., false, 0).unwrap();
    let target = analytic::audit(&source.check().unwrap()).unwrap();
    let body = analytic::boolean(key(), 1, &[target, tool([0., 0.], 0.5, [-1., 6.], Affine::IDENTITY)]).unwrap().remove(0);
    assert!(analytic::audit(&body.clone().check().unwrap()).unwrap().measure(None, &[]).unwrap().contains("\"genus\":1"));
    let mut planted = body;
    planted.constructions[1].parameters[0] = Binary64::new(1.).unwrap();
    assert!(analytic::audit(&planted.check().unwrap()).is_err(), "nonexistent region must refuse");
}

#[test]
fn composed_polygon_placement_keeps_bore_carriers_in_the_target_chart() {
    let first = Affine { origin:[32.,8.,4.], x:[0.,1.,0.], z:[0.,0.,-1.] };
    let second = Affine { origin:[17.,19.,23.], x:[0.,0.,1.], z:[0.,-1.,0.] };
    let pose = |solid: Solid| {
        let a = analytic::audit(&solid.transform(first).unwrap().check().unwrap()).unwrap();
        analytic::audit(&a.transform(second).unwrap().check().unwrap()).unwrap()
    };
    let base = pose(source_polygon(&[[0.,0.],[16.,0.],[16.,12.],[0.,12.]], [0.;3]));
    let cutter = pose(tool([8.,6.],1.,[-1.,6.],Affine::IDENTITY));
    let body = analytic::boolean(key(),1,&[base,cutter]).unwrap().remove(0);
    let carrier = body.surfaces[0].frame;
    assert_ne!(carrier, wonky_contract::FrameId(1));
    assert!(body.surfaces.iter().filter(|s| matches!(s.geometry, SurfaceGeometry::Cylinder {..}))
        .all(|s| s.frame == carrier));
    assert_eq!(body.constructions.last().unwrap().frame, carrier);
    let decoded = wonky_wire::v3::decode(&wonky_wire::v3::encode(&body).unwrap()).unwrap();
    let result = analytic::audit(&decoded).unwrap();
    let expected = (960.-5.*std::f64::consts::PI)*1e9;
    assert!((volume_mm3(&result)-expected).abs()<expected*1e-10);
    for (probe, inside) in [([1000.,17000.,61000.], false), ([7000.,17000.,61000.], true)] {
        let observation = result.measure(None, &[probe]).unwrap();
        assert!(observation.contains(&format!("\"inside\":{inside}")), "{observation}");
    }
    assert!(analytic::step(&[("placed bore".into(),result)],"placed bore").unwrap().contains("CYLINDRICAL_SURFACE"));
    let mut planted = body;
    planted.constructions.last_mut().unwrap().frame = wonky_contract::FrameId(1);
    assert!(planted.check().is_err(), "a different construction chart cannot certify these entities");
}
