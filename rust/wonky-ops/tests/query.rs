//! Query behavior owner. Independent point-set/incidence expectations protect
//! carrier selection; JS owns interpreter transport and stale-reference life.
use wonky_contract::BodyKey;
use wonky_ops::{
    affine::Affine,
    analytic::{self, Solid},
    cylinder::{self, Spec},
    orthogonal,
    query::{self, Entity, EDGE, FACE, VERTEX},
};
fn key() -> BodyKey {
    BodyKey {
        id: [5, 7, 11, 13],
        revision: 0,
    }
}
fn plate(frame: Affine) -> Solid {
    let b = orthogonal::cuboid(key(), [0.; 3], [0.5, 0.25, 0.125]).unwrap();
    let b = analytic::audit(&b.check().unwrap()).unwrap();
    let c = cylinder::create(
        key(),
        Spec {
            bottom: [0.25, 0.125, -0.125],
            top: [0.25, 0.125, 0.25],
            radius: 0.03125,
        },
    )
    .unwrap();
    let c = analytic::audit(&c.check().unwrap()).unwrap();
    let mut out = analytic::boolean(key(), 1, &[b, c]).unwrap();
    let p = analytic::audit(&out.remove(0).check().unwrap()).unwrap();
    analytic::audit(&p.transform(frame).unwrap().check().unwrap()).unwrap()
}
#[test]
fn exact_query_chain_selects_top_lines_and_one_bore_rim_without_seams() {
    for frame in [
        Affine::IDENTITY,
        Affine {
            origin: [64., -32., 16.],
            x: [0., 0., 1.],
            z: [0., -1., 0.],
        },
        Affine {
            origin: [0.25, -0.5, 0.125],
            x: [0.6, 0.8, 0.],
            z: [0., 0., 1.],
        },
    ] {
        let p = plate(frame);
        let faces = query::owned(&p, FACE).unwrap();
        assert_eq!(faces.len(), 7);
        assert_eq!(query::owned(&p, EDGE).unwrap().len(), 14);
        assert_eq!(query::owned(&p, VERTEX).unwrap().len(), 8);
        let o = frame.apply([0., 0., 0.125], 1., true).unwrap();
        let top = query::coincides(&p, &faces, o, frame.z).unwrap();
        assert_eq!(top.len(), 1);
        let rim = query::adjacent(&p, &top, EDGE).unwrap();
        assert_eq!(rim.len(), 5);
        // A plane query selects whole line/circle loci, not just their vertices.
        let all_edges = query::owned(&p, EDGE).unwrap();
        let direct_rim = query::coincides(&p, &all_edges, o, frame.z).unwrap();
        assert_eq!(direct_rim, rim);
        let lines = query::geometry(&p, &rim, "LINE").unwrap();
        assert_eq!(lines.len(), 4);
        let selected = query::parallel_edges(&p, &lines, frame.x).unwrap();
        assert_eq!(selected.len(), 2);
        let circles = query::geometry(&p, &rim, "CIRCLE").unwrap();
        assert_eq!(circles.len(), 1);
        // Opposite cap offset is meaningful, not merely a normal-direction filter.
        let bottom = query::coincides(&p, &faces, frame.origin, frame.z).unwrap();
        assert_eq!(bottom.len(), 1);
        assert_ne!(bottom[0].index, top[0].index);
        let bottom_rim = query::adjacent(&p, &bottom, EDGE).unwrap();
        let bottom_circle = query::geometry(&p, &bottom_rim, "CIRCLE").unwrap();
        assert_eq!(bottom_circle.len(), 1);
        assert_ne!(bottom_circle[0].index, circles[0].index);
        let neighbors = query::adjacent(&p, &top, FACE).unwrap();
        assert_eq!(neighbors.len(), 5);
        assert!(!neighbors.contains(&top[0]));
        assert!(!neighbors.contains(&bottom[0]));
    }
}
#[test]
fn sub_ulp_offsets_and_angles_refuse_not_empty_or_tolerance_welded() {
    let p = plate(Affine::IDENTITY);
    let faces = query::owned(&p, FACE).unwrap();
    let top = query::coincides(&p, &faces, [0., 0., 0.125], [0., 0., 1.]).unwrap();
    let rim = query::adjacent(&p, &top, EDGE).unwrap();
    for height in [0.125f64.next_down(), 0.125f64.next_up()] {
        assert_eq!(
            query::coincides(&p, &faces, [0., 0., height], [0., 0., 1.])
                .unwrap_err()
                .0,
            "query/near-plane-unproved"
        );
    }
    assert_eq!(
        query::coincides(&p, &faces, [0., 0., 0.125], [1e-12, 0., 1.])
            .unwrap_err()
            .0,
        "query/near-parallel-unproved"
    );
    assert_eq!(
        query::parallel_edges(&p, &rim, [1., 1e-12, 0.])
            .unwrap_err()
            .0,
        "query/near-parallel-unproved"
    );
    assert!(query::parallel_edges(&p, &rim, [1., 1., 0.])
        .unwrap()
        .is_empty());
    assert!(query::coincides(&p, &faces, [0., 0., 0.5], [0., 0., 1.])
        .unwrap()
        .is_empty());
    assert_eq!(
        query::parallel_edges(&p, &rim, [0.; 3]).unwrap_err().0,
        "query/zero-direction"
    );
    assert_eq!(
        query::adjacent(
            &p,
            &[Entity {
                kind: FACE,
                index: 999
            }],
            EDGE
        )
        .unwrap_err()
        .0,
        "query/entity-index"
    );
}
#[test]
fn oblique_plane_requires_source_frame_not_a_rounded_normal() {
    let frame = Affine {
        origin: [0.5, -0.25, 0.125],
        x: [
            0.9953610106153096,
            0.08075849942674315,
            -0.05229266982293196,
        ],
        z: [
            0.05443374184663523,
            -0.024540530893688527,
            0.9982157733135806,
        ],
    };
    let p = plate(frame);
    let faces = query::owned(&p, FACE).unwrap();
    let o = frame.apply([0., 0., 0.125], 1., true).unwrap();
    assert_eq!(
        query::coincides(&p, &faces, o, frame.z).unwrap_err().0,
        "query/near-parallel-unproved"
    );
    let top = query::coincides_in_frame(&p, &faces, frame, [0., 0., 0.125], [0., 0., 1.]).unwrap();
    let bottom = query::coincides_in_frame(&p, &faces, frame, [0.; 3], [0., 0., 1.]).unwrap();
    assert_eq!(top.len(), 1);
    assert_eq!(bottom.len(), 1);
    assert_ne!(top[0].index, bottom[0].index);
    let top_rim = query::adjacent(&p, &top, EDGE).unwrap();
    let bottom_rim = query::adjacent(&p, &bottom, EDGE).unwrap();
    let top_ring = query::geometry(&p, &top_rim, "CIRCLE").unwrap();
    let bottom_ring = query::geometry(&p, &bottom_rim, "CIRCLE").unwrap();
    assert_eq!(top_ring.len(), 1);
    assert_eq!(bottom_ring.len(), 1);
    assert_ne!(top_ring[0].index, bottom_ring[0].index);
    assert_eq!(query::parallel_edges(&p, &top_rim, frame.x).unwrap().len(), 2);
    assert_eq!(query::coincides_in_frame(&p, &faces, frame, [0., 0., 0.125f64.next_up()], [0., 0., 1.]).unwrap_err().0,
        "query/near-plane-unproved");
    for other in [
        Affine { origin: [frame.origin[0].next_up(), frame.origin[1], frame.origin[2]], ..frame },
        Affine { x: [frame.x[0].next_up(), frame.x[1], frame.x[2]], ..frame },
    ] {
        assert_eq!(query::coincides_in_frame(&p, &faces, other, [0., 0., 0.125], [0., 0., 1.]).unwrap_err().0,
            "query/different-exact-frames");
    }
    // Direction x, unlike a normal, is a primal frame column and is exact.
    let edges = query::owned(&p, EDGE).unwrap();
    assert_eq!(query::parallel_edges(&p, &edges, frame.x).unwrap().len(), 4);
}

#[test]
fn endpoint_free_lens_ring_is_queryable_without_invented_vertices() {
    let ball = |c| wonky_ops::sphere::audit(
        &wonky_ops::sphere::sphere(key(), c, 0.5).unwrap().check().unwrap()
    ).unwrap();
    let lens = wonky_ops::lens::intersect(
        key(), &ball([0.; 3]), &ball([0.5, 0., 0.])
    ).unwrap();
    let lens = analytic::audit(&lens.check().unwrap()).unwrap();
    assert_eq!(query::owned(&lens, VERTEX).unwrap().len(), 0);
    let edges = query::owned(&lens, EDGE).unwrap();
    assert_eq!(edges.len(), 1);
    assert_eq!(query::geometry(&lens, &edges, "CIRCLE").unwrap().len(), 1);
    assert_eq!(query::geometry(&lens, &edges, "OTHER_CURVE").unwrap().len(), 0);
    let faces = query::owned(&lens, FACE).unwrap();
    assert_eq!(faces.len(), 2);
    assert_eq!(query::adjacent(&lens, &faces[..1], EDGE).unwrap().len(), 1);
    assert_eq!(query::adjacent(&lens, &faces[..1], FACE).unwrap().len(), 1);
}

#[test]
fn plane_selection_uses_the_whole_source_arc_not_its_chord_or_rounded_carrier() {
    for frame in [Affine::IDENTITY, Affine {
        origin: [64., -32., 16.],
        x: [0.9953610106153096, 0.08075849942674315, -0.05229266982293196],
        z: [0.05443374184663523, -0.024540530893688527, 0.9982157733135806],
    }] {
        // The left/right cap arcs both have chords parallel to Y. No arc lies
        // in the vertical plane through its chord, even though both ends do.
        let body = wonky_ops::arc_profile::build(key(), frame,
            &[[1., 0., 9., 0.], [9., 2., 1., 2.]],
            &[[9., 0., 10., 1., 9., 2.], [1., 2., 0., 1., 1., 0.]], 2., false).unwrap();
        let s = analytic::audit(&body.check().unwrap()).unwrap();
        let edges = query::owned(&s, EDGE).unwrap();
        let top = query::coincides_in_frame(&s, &edges, frame, [0., 0., 2.], [0., 0., 1.]).unwrap();
        assert_eq!(top.len(), 4);
        let arcs = query::geometry(&s, &top, "ARC").unwrap();
        assert_eq!(arcs.len(), 2);
        for x in [1., 9.] {
            assert!(query::coincides_in_frame(&s, &arcs, frame, [x, 0., 0.], [1., 0., 0.]).unwrap().is_empty());
        }
        assert_eq!(query::coincides_in_frame(&s, &edges, frame, [0., 0., 2_f64.next_up()], [0., 0., 1.]).unwrap_err().0,
            "query/near-plane-unproved");
    }
}

#[test]
fn closest_analytic_edges_respect_translated_charts_different_bodies_and_exact_ties() {
    use wonky_ops::edge_query::closest_solids;
    let cylinder = cylinder::create(key(), Spec {
        bottom: [3., 5., 0.], top: [3., 5., 2.], radius: 1.,
    }).unwrap();
    let a = analytic::audit(&cylinder.check().unwrap()).unwrap();
    // The seam is in a translated chart, unlike either circle. All three
    // candidates remain meaningful at this API (owned() hides the seam in FS).
    let candidates = [(&a, 0), (&a, 1), (&a, 2)];
    assert_eq!(closest_solids(&candidates, [4., 5., 1.], 0.).unwrap(), vec![2]);
    assert_eq!(closest_solids(&candidates, [4., 5., 2.], 0.).unwrap(), vec![1, 2]);
    let b = analytic::audit(&a.transform(Affine { origin: [2., 2., 0.], ..Affine::IDENTITY }).unwrap().check().unwrap()).unwrap();
    // Both distances are sqrt(2)-1, in distinct construction frames. Keeping
    // the complete radical expression certifies this zero-tolerance tie.
    let circles = [(&a, 0), (&b, 0)];
    assert_eq!(closest_solids(&circles, [4., 6., 0.], 0.).unwrap(), vec![0, 1]);
    assert_eq!(closest_solids(&circles, [6., 7., 0.], 0.).unwrap(), vec![1]);
    // Combine a line from a planar body and a circle; their exact zero-distance
    // tie is not allowed to inherit either body's local coordinate system.
    let box_body = orthogonal::cuboid(key(), [4., 5., 0.], [6., 7., 2.]).unwrap();
    let line = box_body.edges.iter().position(|edge| edge.vertices.iter().all(|id| {
        let p = box_body.vertices[id.0 as usize].point;
        p[0].get() == 4. && p[1].get() == 5.
    })).unwrap();
    let box_solid = analytic::audit(&box_body.check().unwrap()).unwrap();
    assert_eq!(closest_solids(&[(&a, 0), (&box_solid, line)], [4., 5., 0.], 0.).unwrap(), vec![0, 1]);
    // A quarter-metre tolerance is inclusive, including at the exact frontier.
    let rings = [(&a, 0), (&a, 1)];
    for (tie, expected) in [(0.25_f64.next_down(), vec![1]), (0.25, vec![0, 1]), (0.25_f64.next_up(), vec![0, 1])] {
        assert_eq!(closest_solids(&rings, [4., 5., 1.125], tie).unwrap(), expected);
    }
}

#[test]
fn closest_three_point_arcs_use_exact_source_circle_and_angular_trim() {
    use wonky_ops::edge_query::closest_solids;
    // All three arcs lie on the circle centred at (1.5,0.5), r^2=2.5. The
    // radius is not binary64-representable; its cache cannot certify zero.
    let body = wonky_ops::arc_profile::build(key(), Affine::IDENTITY, &[],
        &[[0., 0., 0., 1., 1., 2.], [1., 2., 3., 1., 3., 0.], [3., 0., 1., -1., 0., 0.]], 2., false).unwrap();
    let solid = analytic::audit(&body.check().unwrap()).unwrap();
    let edges = query::owned(&solid, EDGE).unwrap();
    let bottom = query::coincides(&solid, &edges, [0.; 3], [0., 0., 1.]).unwrap();
    assert_eq!(bottom.len(), 3);
    let candidates: Vec<_> = bottom.iter().map(|e| (&solid, e.index as usize)).collect();
    let upper = closest_solids(&candidates, [0., 1., 0.], 0.).unwrap();
    let lower = closest_solids(&candidates, [1., -1., 0.], 0.).unwrap();
    assert_eq!(upper.len(), 1);
    assert_eq!(lower.len(), 1);
    assert_ne!(upper[0], lower[0]);
    let shared = closest_solids(&candidates, [0.; 3], 0.).unwrap();
    assert_eq!(shared.len(), 2);
    assert!(shared.contains(&upper[0]) && shared.contains(&lower[0]));
}

#[test]
fn closest_native_request_audits_chart_binding_before_computing_a_distance() {
    use wonky_contract::{Binary64, Frame};
    use wonky_ops::host;
    let body = cylinder::create(key(), Spec {
        bottom: [3., 5., 0.], top: [3., 5., 2.], radius: 1.,
    }).unwrap();
    let request = |body: &wonky_contract::Body| {
        let words = wonky_wire::v3::encode(body).unwrap();
        let mut r = vec![host::MAGIC, host::VERSION, host::OP_CLOSEST_EDGES];
        for x in [4_f64, 5., 1., 0.] { let bits = x.to_bits(); r.extend([bits as u32, (bits >> 32) as u32]); }
        r.extend([1, words.len() as u32]); r.extend(words); r.push(2);
        host::host_op(&r)
    };
    assert_eq!(request(&body), vec![host::STATUS_OK, 0]);
    let mut corrupt = body;
    if let Frame::Rigid { translation, .. } = &mut corrupt.frames[2] {
        translation[0] = Binary64::new(3.5).unwrap();
    } else { panic!("cylinder must carry a translated seam chart"); }
    let reply = request(&corrupt);
    assert_eq!(reply[0], host::STATUS_REFUSED);
    let reason: String = reply[1..].iter().map(|&c| char::from_u32(c).unwrap()).collect();
    assert!(reason.starts_with("cylinder/"), "{reason}");
}
