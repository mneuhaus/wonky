//! Public Boolean boundary: independent closed forms, exact frame semantics,
//! shared-face contact, and construction replay. No production test seams.
use num_traits::ToPrimitive;
use wonky_contract::{Body, BodyKey};
use wonky_num::p2;
use wonky_ops::{
    affine::Affine,
    analytic::{self, Solid},
    extrude::{blind_prism, Prism},
    orthogonal,
    polyhedron::{audit, Audited},
};
use wonky_oracle::binary64 as exact;
use wonky_sketch::region::lines_region;

fn key() -> BodyKey {
    BodyKey {
        id: [7, 2, 9, 1],
        revision: 0,
    }
}
fn checked(body: Body) -> Audited {
    let words = wonky_wire::v3::encode(&body).unwrap();
    audit(&wonky_wire::v3::decode(&words).unwrap()).unwrap()
}
fn prism(frame: Affine, cap: &[[f64; 2]], height: f64) -> Audited {
    let segments: Vec<_> = (0..cap.len())
        .map(|i| {
            let a = cap[i];
            let b = cap[(i + 1) % cap.len()];
            [a[0], a[1], b[0], b[1]]
        })
        .collect();
    let regions = lines_region(
        &segments
            .iter()
            .map(|p| [p2(p[0], p[1]), p2(p[2], p[3])])
            .collect::<Vec<_>>(),
    )
    .unwrap();
    checked(
        blind_prism(&Prism {
            key: key(),
            source: [0; 4],
            frame,
            segments: &segments,
            region: &regions.loops[0],
            depth: height,
            reverse: false,
        })
        .unwrap(),
    )
}
fn cube(a: [f64; 3], b: [f64; 3]) -> Audited {
    checked(orthogonal::cuboid(key(), a, b).unwrap())
}
fn run(op: u8, a: &Audited, b: &Audited) -> Audited {
    let bodies = analytic::boolean(
        key(),
        op,
        &[Solid::Planar(a.clone()), Solid::Planar(b.clone())],
    )
    .unwrap();
    assert_eq!(bodies.len(), 1);
    checked(bodies.into_iter().next().unwrap())
}
fn near(actual: f64, expected: f64) {
    assert!(
        (actual - expected).abs() <= expected.abs() * 3e-14,
        "{actual} != {expected}"
    );
}
fn volume(a: &Audited, v: f64) {
    near(a.volume_mm3().unwrap(), v * 1e9);
}

#[test]
fn different_frame_rotated_prism_all_boolean_operations_and_reentry() {
    let a = cube([0.; 3], [2.; 3]);
    // The exact affine image of a square is |x|+|y| <= 2. The first-quadrant
    // intersection is a right triangle: V(A)=8, V(B)=16, V(A∩B)=4.
    let b = prism(
        Affine {
            origin: [0.; 3],
            x: [1., 1., 0.],
            z: [0., 0., 1.],
        },
        &[[-1., -1.], [1., -1.], [1., 1.], [-1., 1.]],
        2.,
    );
    for (op, v) in [(0, 20.), (1, 4.), (2, 4.)] {
        let out = run(op, &a, &b);
        volume(&out, v);
        assert_eq!(out.topology().genus, 0);
        assert!(out.bound_to_construction);
    }
    let union = run(0, &a, &b);
    // Replay the nonconvex Boolean result, not its rounded envelope or convex hull.
    volume(&run(1, &union, &a), 12.);
    let mut tampered = union.body.clone();
    tampered.vertices[0].point[0] =
        wonky_contract::Binary64::new(tampered.vertices[0].point[0].get().next_up()).unwrap();
    assert!(audit(&tampered.check().unwrap())
        .unwrap_err()
        .0
        .contains("boundary-not-construction"));
}

#[test]
fn chamfered_prism_union_then_face_contact_preserves_sum_and_merges_caps() {
    let wall = prism(
        Affine::IDENTITY,
        &[[0., 0.], [8., 0.], [8., 6.], [6., 8.], [2., 8.], [0., 6.]],
        2.,
    );
    let middle = cube([2., 7., 0.], [6., 12., 2.]);
    // 60*2 + 4*5*2 - 4*1*2 = 152.
    let joined = run(0, &wall, &middle);
    volume(&joined, 152.);
    let column = cube([2., 12., 0.], [6., 14., 2.]);
    let contact = run(0, &joined, &column);
    volume(&contact, 168.);
    near(
        contact.volume_mm3().unwrap(),
        joined.volume_mm3().unwrap() + column.volume_mm3().unwrap(),
    );
    let cap_count=contact.body.surfaces.iter().filter(|s|matches!(&s.geometry,
        wonky_contract::SurfaceGeometry::Plane{normal,..} if normal[0].get()==0.&&normal[1].get()==0.)).count();
    assert_eq!(
        cap_count, 2,
        "coplanar tiles must merge, including a contact interface"
    );
    assert_eq!(contact.topology().shells, 1);
}

#[test]
fn random_rotated_prisms_match_independent_exact_volume_formulas() {
    let mut state = 0x1a98d239u64;
    for _ in 0..32 {
        state = state.wrapping_mul(6364136223846793005).wrapping_add(1);
        let r = 1. + ((state >> 32) % 8) as f64;
        let h = 1. + ((state >> 40) % 8) as f64;
        let angle = ((state >> 16) % 360) as f64 * std::f64::consts::PI / 180.;
        let (c, s) = (angle.cos(), angle.sin());
        let origin = [65536., -32., 16.];
        let frame = Affine {
            origin,
            x: [c, s, 0.],
            z: [0., 0., 1.],
        };
        let quarter = Affine {
            origin,
            x: [-s, c, 0.],
            z: [0., 0., 1.],
        };
        let a = prism(
            frame,
            &[[0., 0.], [2. * r, 0.], [2. * r, 2. * r], [0., 2. * r]],
            h,
        );
        // Rotation by a quarter turn leaves the diamond unchanged in A's
        // chart, although the two authoritative frames are different.
        let b = prism(
            quarter,
            &[[-2. * r, 0.], [0., -2. * r], [2. * r, 0.], [0., 2. * r]],
            h,
        );
        let determinant =
            exact(c).unwrap() * exact(c).unwrap() + exact(s).unwrap() * exact(s).unwrap();
        for (op, area) in [(0, 10. * r * r), (1, 2. * r * r), (2, 2. * r * r)] {
            let out = run(op, &a, &b);
            let expected =
                exact(area).unwrap() * exact(h).unwrap() * &determinant * exact(1e9).unwrap();
            near(out.volume_mm3().unwrap(), expected.to_f64().unwrap());
        }
    }
}

#[test]
fn non_dyadic_cut_survives_wire_replay_measurement_and_reentry() {
    let a = cube([0.; 3], [2.; 3]);
    let b = prism(Affine::IDENTITY, &[[0., 0.], [3., 0.], [0., 2.]], 2.);
    // Integrate y=2-2x/3 on 0<=x<=2. The vertex at (2,2/3) is
    // authoritative as a construction, not its binary64 observation cache.
    let cut = run(2, &a, &b);
    volume(&cut, 16. / 3.);
    let solid = Solid::Planar(cut.clone());
    let faces = wonky_ops::query::owned(&solid, wonky_ops::query::FACE).unwrap();
    let on_cut = wonky_ops::query::coincides(&solid, &faces, [0., 2., 0.], [2., 3., 0.]).unwrap();
    assert_eq!(
        on_cut.len(),
        1,
        "carrier query must use the exact plane, not its cache"
    );
    let (center, bound) = cut.centroid_with_bound_mm().unwrap();
    for (i, x) in [5. / 6., 13. / 18., 1.].into_iter().enumerate() {
        assert!((center[i] - x * 1000.).abs() <= bound[i] + 2e-13);
    }
    volume(&run(1, &b, &cut), 2. / 3.);
    assert_eq!(cut.topology().genus, 0);
}

#[test]
fn source_translation_is_not_reseeded_from_rounded_caches() {
    use wonky_ops::query;
    let a = cube([0.; 3], [1.; 3]);
    let b = prism(
        Affine {
            origin: [0.1, 0., 0.],
            ..Affine::IDENTITY
        },
        &[[0.2, 0.], [0.5, 0.], [0.5, 1.], [0.2, 1.]],
        1.,
    );
    let cut = run(2, &a, &b);
    volume(&cut, 0.3);
    // A second cut leaves width (fl(0.1+0.2) - exact(0.1) - exact(0.2)).
    // Both endpoints round to the same cache coordinate, but the edge exists.
    let shift = |a: &Audited| {
        wonky_ops::pattern::copy(
            a,
            key(),
            [[1., 0., 0.], [0., 1., 0.], [0., 0., 1.]],
            [1048576., 0., 0.],
        )
        .unwrap()
    };
    let target = prism(
        Affine::IDENTITY,
        &[[0., 0.], [0.1 + 0.2, 0.], [0.1 + 0.2, 1.], [0., 1.]],
        1.,
    );
    let sliver = run(2, &shift(&target), &shift(&b));
    let width = exact(0.1 + 0.2).unwrap() - exact(0.1).unwrap() - exact(0.2).unwrap();
    near(
        sliver.volume_mm3().unwrap(),
        (width * exact(1e9).unwrap()).to_f64().unwrap(),
    );
    assert_eq!(
        (sliver.topology().vertices, sliver.topology().edges),
        (8, 12)
    );
    // Rounded endpoint distances would add the opposite face's edges to this
    // zero-tie query. Exactly three edges meet at the true nearest vertex.
    let edges: Vec<_> = (0..sliver.body.edges.len()).map(|i| (&sliver, i)).collect();
    let closest = wonky_ops::edge_query::closest(&edges, [1048576.3, 0., 0.], 0.).unwrap();
    assert_eq!(closest.len(), 3);
    let separated = prism(
        Affine {
            origin: [1048576., 0., 0.],
            ..Affine::IDENTITY
        },
        &[[0.4, 0.], [0.5, 0.], [0.5, 1.], [0.4, 1.]],
        1.,
    );
    let distance = wonky_ops::distance::between(&sliver, &separated).unwrap();
    let gap = (exact(0.4).unwrap() - exact(0.1 + 0.2).unwrap()) * exact(1000.).unwrap();
    assert!(exact(distance.lower_mm).unwrap() <= gap && gap <= exact(distance.upper_mm).unwrap());
    let error = wonky_ops::step::write(&[("sliver".into(), &sliver)], "sliver").unwrap_err();
    assert_eq!(
        error.0,
        "export/rational-boundary-below-binary64-resolution"
    );
    let mut invalid = sliver.body.clone();
    if let wonky_contract::CurveGeometry::ConstructionLine { edge } =
        &mut invalid.curves[0].geometry
    {
        edge.0 = u32::MAX;
    } else {
        panic!("exact line transport missing");
    }
    assert!(
        wonky_wire::v3::encode(&invalid).is_err(),
        "codec must check the replayed edge reference"
    );
    let cut = Solid::Planar(cut);
    let faces = query::owned(&cut, query::FACE).unwrap();
    // The exact image 0.1+0.2 is NOT the caller's rounded addition. Accepting
    // this plane would prove that the binary64 cache became topology authority.
    let error = query::coincides(&cut, &faces, [0.1 + 0.2, 0., 0.], [1., 0., 0.]).unwrap_err();
    assert!(error.0.contains("near-plane-unproved"), "{}", error.0);
}

#[test]
fn three_plane_intersections_form_a_tetrahedron_not_an_axis_prism() {
    let target = cube([0.; 3], [2.; 3]);
    // The finite cutter contains the cube's entire x+y+z >= 1 half. Its
    // cap meets three target carriers at (1,0,0), (0,1,0), (0,0,1).
    let cutter = prism(
        Affine {
            origin: [0., 0., 1.],
            x: [1., -1., 0.],
            z: [1., 1., 1.],
        },
        &[[-8., -8.], [8., -8.], [8., 8.], [-8., 8.]],
        8.,
    );
    let tetrahedron = run(1, &target, &cutter);
    volume(&tetrahedron, 1. / 6.);
    let t = tetrahedron.topology();
    assert_eq!((t.faces, t.edges, t.vertices), (4, 6, 4));
    let center = tetrahedron.centroid_mm().unwrap();
    for coordinate in center {
        near(coordinate, 250.);
    }
}

#[test]
fn edge_contact_is_refused_instead_of_publishing_a_pinched_union() {
    let diamond = prism(
        Affine::IDENTITY,
        &[[-2., 0.], [0., -2.], [2., 0.], [0., 2.]],
        2.,
    );
    let touching = cube([2., 0., 0.], [4., 2., 2.]);
    let error = analytic::boolean(key(), 0, &[Solid::Planar(diamond), Solid::Planar(touching)])
        .unwrap_err();
    assert_eq!(error.0, "planar-boolean/non-manifold-result");
}

#[test]
fn through_hole_and_bridge_keep_signed_loops_and_face_observations() {
    use wonky_ops::query;
    let block = cube([-4., -4., 0.], [4., 4., 2.]);
    let tool = prism(
        Affine::IDENTITY,
        &[[-1., 0.], [0., -1.], [1., 0.], [0., 1.]],
        2.,
    );
    let ring = run(1, &block, &tool);
    volume(&ring, 124.);
    assert_eq!(ring.topology().genus, 1);
    let crossbar = cube([-1., -0.25, 0.], [1., 0.25, 2.]);
    let bridged = run(0, &ring, &crossbar);
    // The strip fills integral[-1/4,1/4] 2(1-|y|) dy = 7/8 of
    // the diamond. The remaining two triangular holes are not extra faces.
    volume(&bridged, 125.75);
    assert_eq!(bridged.topology().genus, 2);
    for (body, area, perimeter, hole_count) in [
        (&ring, 62., 32. + 4. * 2f64.sqrt(), 1),
        (&bridged, 62.875, 35. + 3. * 2f64.sqrt(), 2),
    ] {
        let solid = Solid::Planar(body.clone());
        let faces = query::owned(&solid, query::FACE).unwrap();
        let areas = body.face_areas_mm2().unwrap();
        let perimeters = body.face_perimeters_mm().unwrap();
        assert_eq!(areas.len(), body.body.faces.len());
        assert_eq!(perimeters.len(), body.body.faces.len());
        for z in [0., 2.] {
            let cap = query::coincides(&solid, &faces, [0., 0., z], [0., 0., 1.]).unwrap();
            assert_eq!(cap.len(), 1);
            let i = cap[0].index as usize;
            assert_eq!(body.body.faces[i].loops.len(), 1 + hole_count);
            near(areas[i], area * 1e6);
            near(perimeters[i], perimeter * 1000.);
        }
        let center = body.centroid_mm().unwrap();
        assert!(center[0].abs() < 1e-12 && center[1].abs() < 1e-12);
        near(center[2], 1000.);
        // A multiply-connected result must remain a Boolean operand after WC0
        // replay, without turning a hole into a filled polygon or convex hull.
        let filled = run(0, body, &tool);
        volume(&filled, 128.);
        assert_eq!(filled.topology().genus, 0);
        assert_eq!(filled.topology().faces, 6);
    }
}

#[test]
fn nested_coplanar_island_attaches_holes_to_the_containing_face_only() {
    use wonky_ops::query;
    let block = cube([-4., -4., 0.], [4., 4., 2.]);
    let tool = prism(
        Affine {
            origin: [0., 0., 1.],
            ..Affine::IDENTITY
        },
        &[[-2., 0.], [0., -2.], [2., 0.], [0., 2.]],
        2.,
    );
    let pocket = run(1, &block, &tool);
    let post = cube([-0.5, -0.5, 1.], [0.5, 0.5, 2.]);
    let island = run(0, &pocket, &post);
    // The post joins the pocket floor by a shared face, adding its entire
    // volume. Its top is an island nested inside the larger top face's hole.
    volume(&island, 121.);
    near(
        island.volume_mm3().unwrap(),
        pocket.volume_mm3().unwrap() + post.volume_mm3().unwrap(),
    );
    assert_eq!(island.topology().genus, 0);
    let solid = Solid::Planar(island.clone());
    let faces = query::owned(&solid, query::FACE).unwrap();
    let top = query::coincides(&solid, &faces, [0., 0., 2.], [0., 0., 1.]).unwrap();
    assert_eq!(top.len(), 2);
    let areas = island.face_areas_mm2().unwrap();
    let mut caps: Vec<_> = top.iter().map(|e| e.index as usize).collect();
    caps.sort_by(|&i, &j| areas[i].total_cmp(&areas[j]));
    near(areas[caps[0]], 1e6);
    near(areas[caps[1]], 56e6);
    assert_eq!(island.body.faces[caps[0]].loops.len(), 1);
    assert_eq!(island.body.faces[caps[1]].loops.len(), 2);
}

#[test]
fn random_rotated_box_holes_match_exact_removed_volume() {
    let mut seed = 0x349271abu64;
    for i in 0..12 {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
        let r = 1. + ((seed >> 32) % 5) as f64 / 4.;
        let h = 1. + ((seed >> 40) % 8) as f64;
        let angle = (1. + ((seed >> 16) % 88) as f64).to_radians();
        let (s, c) = angle.sin_cos();
        // Cycle all three drilling axes: loop containment cannot assume XY.
        let axis = i % 3;
        let permute = |p: [f64; 3]| std::array::from_fn(|k| p[(k + 5 - axis) % 3]);
        let block = cube(permute([-8., -8., 0.]), permute([8., 8., h]));
        let cutter = prism(
            Affine {
                origin: permute([0.5, -0.25, -1.]),
                x: permute([c, s, 0.]),
                z: permute([0., 0., 1.]),
            },
            &[[-r, -r], [r, -r], [r, r], [-r, r]],
            h + 2.,
        );
        let result = run(1, &block, &cutter);
        let determinant =
            exact(c).unwrap() * exact(c).unwrap() + exact(s).unwrap() * exact(s).unwrap();
        let removed_area = exact(4.).unwrap() * exact(r).unwrap() * exact(r).unwrap() * determinant;
        let expected =
            (exact(256.).unwrap() - removed_area) * exact(h).unwrap() * exact(1e9).unwrap();
        near(result.volume_mm3().unwrap(), expected.to_f64().unwrap());
        assert_eq!(result.topology().genus, 1);
        assert_eq!(result.topology().faces, 10);
        assert_eq!(result.topology().loops, 12);
    }
}

#[test]
fn independent_random_rotations_match_exact_half_plane_integrals() {
    // Unlike the shared-frame property above, these independent operand frames
    // create genuinely non-dyadic intersections and non-dyadic plane normals.
    let mut seed = 0x77a617bcu64;
    for i in 0..24 {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
        let r = 1. + ((seed >> 32) % 8) as f64;
        let h = 1. + ((seed >> 40) % 8) as f64;
        let theta = (1. + ((seed >> 16) % 43) as f64).to_radians();
        let (s, c) = theta.sin_cos();
        let cap = if i % 2 == 0 {
            vec![[0., 0.], [8. * r, 0.], [8. * r, 8. * r], [0., 8. * r]]
        } else {
            vec![[0., 0.], [8. * r, 0.], [0., 8. * r]]
        };
        let a = cube([0.; 3], [r, r, h]);
        let b = prism(
            Affine {
                origin: [0.; 3],
                x: [c, s, 0.],
                z: [0., 0., 1.],
            },
            &cap,
            h,
        );
        let (c, s, r, h) = (
            exact(c).unwrap(),
            exact(s).unwrap(),
            exact(r).unwrap(),
            exact(h).unwrap(),
        );
        let va = &r * &r * &h;
        let vb = &va * exact(if i % 2 == 0 { 64. } else { 32. }).unwrap() * (&c * &c + &s * &s);
        // Only B's local y>=0 clips A: y >= (s/c)x. Other cutter faces
        // are beyond A. Integrate the remaining trapezoid, no kernel oracle.
        let removed = &va * &s / (exact(2.).unwrap() * &c);
        for (op, expected) in [
            (0, &vb + &removed),
            (1, removed.clone()),
            (2, &va - &removed),
        ] {
            let result = run(op, &a, &b);
            near(
                result.volume_mm3().unwrap(),
                (expected * exact(1e9).unwrap()).to_f64().unwrap(),
            );
            assert_eq!(result.topology().genus, 0);
        }
    }
}

/// Exact probes on a nonconvex arrangement with a through hole: the void
/// centre is nearest to the sloped hole walls, a point over the hole to the
/// hole's top rim; a convex hull or filled hole would read 0 or 1000 there.
#[test]
fn arrangement_probes_decide_membership_and_distance_exactly() {
    use wonky_ops::polyhedron::Probe;
    let block = cube([-4., -4., 0.], [4., 4., 2.]);
    let tool = prism(Affine::IDENTITY, &[[-1., 0.], [0., -1.], [1., 0.], [0., 1.]], 2.);
    let ring = run(1, &block, &tool);
    for (point, expected) in [
        ([0., 0., 1000.], Some(1000. / 2f64.sqrt())),
        ([0., 0., 3000.], Some(1000. * 1.5f64.sqrt())),
        ([200., 100., 1000.], Some(700. / 2f64.sqrt())),
        ([5000., 0., 1000.], Some(1000.)),
        ([5000., 5000., 3000.], Some(1000. * 3f64.sqrt())),
        ([3000., 3000., 1000.], None),
        ([4000., 0., 1000.], None),
    ] {
        match (ring.distance_mm(point), expected) {
            (Probe::Measured { distance_mm, inside, bound_mm }, Some(d)) => {
                assert!(!inside, "{point:?}");
                assert!((distance_mm - d).abs() <= bound_mm + d * 4. * f64::EPSILON, "{point:?}: {distance_mm} != {d}");
            }
            (Probe::Measured { distance_mm, inside, .. }, None) => assert!(inside && distance_mm == 0., "{point:?}"),
            (Probe::Refused(r), _) => panic!("{point:?}: {r}"),
        }
    }
}

#[test]
fn equal_composed_frames_reenter_every_boolean_without_rounding() {
    use wonky_ops::{pattern, placement::Post};
    let a = cube([0.; 3], [2.; 3]);
    let b = cube([1.; 3], [3.; 3]);
    for post in [
        Post::Rational { rows: [[12., -5., 0.], [5., 12., 0.], [0., 0., 13.]], denominator: 13. },
        Post::Rows { rows: [[1., 0., 0.], [0., 1., 0.], [0., 0., 1.]], translation: [65536.25, -32768.5, 16384.125] },
    ] {
        let a = pattern::place(&a, key(), &post).unwrap();
        let b = pattern::place(&b, key(), &post).unwrap();
        assert_eq!(a.frame, b.frame);
        assert!(a.frame.as_affine().is_err());
        for (op, expected) in [(0, 15.), (1, 7.), (2, 1.)] {
            let result = run(op, &a, &b);
            volume(&result, expected);
            let wonky_contract::Provenance::Construction { node } = result.body.vertices[0].provenance else { panic!("missing Boolean lineage") };
            let root = &result.body.constructions[node.0 as usize];
            assert_eq!(root.operation, wonky_contract::Operation::Boolean {});
            assert_eq!(root.parameters.len(), 2, "general plane-arrangement replay");
            assert!(result.bound_to_construction);
            assert_eq!(result.topology().genus, 0);
        }
    }
}

#[test]
fn placed_construction_lines_keep_source_boolean_binding_and_replay() {
    use wonky_contract::{Binary64, CurveGeometry, FrameId, NodeId, Operation, Provenance};
    use wonky_ops::{pattern, placement::Post};
    let a = prism(Affine { origin: [0.; 3], x: [12./13., 5./13., 0.], z: [0., 0., 1.] },
        &[[0.,0.], [2.,0.], [2.,2.], [0.,2.]], 2.);
    let b = cube([1.,1.,0.], [3.,3.,2.]);
    let source = run(0, &a, &b);
    assert!(source.body.curves.iter().any(|c| matches!(c.geometry, CurveGeometry::ConstructionLine { .. })));
    let move_by = Post::Rows { rows: [[1.,0.,0.], [0.,1.,0.], [0.,0.,1.]], translation: [1.,0.,0.] };
    let rotate_by = Post::Rational { rows: [[4.,-3.,0.], [3.,4.,0.], [0.,0.,5.]], denominator: 5. };
    let first = pattern::place(&source, key(), &move_by).unwrap();
    let placed = pattern::place(&first, key(), &rotate_by).unwrap();
    let replayed = checked(placed.body.clone());
    let original = source.world_vertices_mm().unwrap();
    for (actual, point) in replayed.world_vertices_mm().unwrap().iter().zip(original) {
        let translated = [point[0] + 1000., point[1], point[2]];
        let expected = [(4. * translated[0] - 3. * translated[1]) / 5.,
            (3. * translated[0] + 4. * translated[1]) / 5., translated[2]];
        for k in 0..3 {
            assert!((actual[k] - expected[k]).abs() <= 1e-9, "placement vertex order: {actual:?} != {expected:?}");
        }
    }
    near(replayed.volume_mm3().unwrap(), source.volume_mm3().unwrap());
    assert!(replayed.bound_to_construction);
    // Positive admission must not turn source facts or the display cache into
    // authority. Every forged wrapper/binding is rejected at its owner.
    let mut forged = placed.body.clone();
    forged.constructions.last_mut().unwrap().parents = vec![NodeId(0)];
    assert!(forged.check().is_err(), "wrong affine base frame");
    let mut forged = placed.body.clone();
    forged.constructions.last_mut().unwrap().parameters.push(Binary64::new(1.).unwrap());
    assert!(forged.check().is_err(), "affine wrapper parameters");
    let mut forged = placed.body.clone();
    forged.vertices[0].frame = FrameId(0);
    assert!(forged.check().is_err(), "construction endpoint frame");
    let mut forged = placed.body.clone();
    let Provenance::Construction { mut node } = forged.curves[0].provenance else { panic!() };
    while forged.constructions[node.0 as usize].operation == (Operation::AffineTransform {}) {
        node = forged.constructions[node.0 as usize].parents[0];
    }
    forged.constructions[node.0 as usize].parameters[1] = Binary64::new(1.).unwrap();
    assert!(forged.check().is_err(), "source Boolean is not a construction-line rule");
    let mut forged = placed.body.clone();
    forged.vertices[0].point[0] = Binary64::new(forged.vertices[0].point[0].get().next_up()).unwrap();
    assert!(audit(&forged.check().unwrap()).is_err(), "rounded cache must still replay exactly");
}
