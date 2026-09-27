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
