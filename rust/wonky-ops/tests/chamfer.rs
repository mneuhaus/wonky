//! Operation-boundary proofs. Closed forms are independent of clipping/replay;
//! the wire negative ensures rounded witnesses cannot authenticate themselves.
use wonky_contract::{Binary64, Body, BodyKey};
use wonky_ops::{
    affine::Affine,
    chamfer, orthogonal,
    polyhedron::{audit, Audited},
};
fn key() -> BodyKey {
    BodyKey {
        id: [7, 3, 2, 1],
        revision: 0,
    }
}
fn checked(b: Body) -> Audited {
    audit(&b.check().unwrap()).unwrap()
}
fn box_at(lo: [f64; 3], hi: [f64; 3]) -> Audited {
    checked(orthogonal::cuboid(key(), lo, hi).unwrap())
}
fn bottom(a: &Audited) -> Vec<usize> {
    a.body
        .edges
        .iter()
        .enumerate()
        .filter(|(_, e)| {
            e.vertices
                .iter()
                .all(|i| a.body.vertices[i.0 as usize].point[2].get() == 0.)
        })
        .map(|(i, _)| i)
        .collect()
}
fn close(got: f64, want: f64) {
    assert!(
        (got - want).abs() <= want.abs() * 2e-15,
        "got {got}, want {want}"
    );
}
#[test]
fn single_edge_and_meeting_bottom_ring_match_closed_forms() {
    for (dims, w) in [
        ([0.016, 0.012, 0.008], 0.001),
        ([0.160, 0.045, 0.045], 0.00042),
        ([1., 1., 1.], 0.125),
    ] {
        let a = box_at([0.; 3], dims);
        let edges = bottom(&a);
        let edge = &a.body.edges[edges[0]];
        let length = (0..3)
            .map(|k| {
                (a.body.vertices[edge.vertices[0].0 as usize].point[k].get()
                    - a.body.vertices[edge.vertices[1].0 as usize].point[k].get())
                .abs()
            })
            .sum::<f64>();
        let one = checked(chamfer::equal_offsets(&a, &edges[..1], w).unwrap());
        close(
            one.volume_mm3().unwrap(),
            (dims.iter().product::<f64>() - length * w * w / 2.) * 1e9,
        );
        let ring = checked(chamfer::equal_offsets(&a, &edges, w).unwrap());
        let removed = (dims[0] + dims[1]) * w * w - 4. * w * w * w / 3.;
        close(
            ring.volume_mm3().unwrap(),
            (dims.iter().product::<f64>() - removed) * 1e9,
        );
        assert_eq!(ring.topology().faces, 10);
        assert_eq!(ring.topology().genus, 0);
        assert_eq!(ring.face_areas_mm2().unwrap().len(), 10);
        let c = ring.centroid_mm().unwrap();
        close(c[0], dims[0] * 500.);
        close(c[1], dims[1] * 500.);
    }
}
#[test]
fn three_edge_corners_close_with_planar_vertex_faces() {
    for (dims, w) in [([1.; 3], 0.125), ([0.016, 0.012, 0.008], 0.00042)] {
        let a = box_at([0.; 3], dims);
        for all in [false, true] {
            let edges: Vec<_> =
                a.body
                    .edges
                    .iter()
                    .enumerate()
                    .filter(|(_, e)| {
                        all || e.vertices.iter().any(|v| {
                            a.body.vertices[v.0 as usize].point.map(|x| x.get()) == [0.; 3]
                        })
                    })
                    .map(|(i, _)| i)
                    .collect();
            let result = checked(chamfer::equal_offsets(&a, &edges, w).unwrap());
            // Integrate triangular prisms, subtract their common corner regions.
            // Closing each corner with a triangle leaves 2/3 w^3 less removed
            // than the sum of the three independent edge prisms.
            let corners = if all { 8 } else { 1 };
            let edge_length = dims.iter().sum::<f64>() * if all { 4. } else { 1. };
            let removed = edge_length * w * w / 2. - corners as f64 * 2. * w.powi(3) / 3.;
            close(
                result.volume_mm3().unwrap(),
                (dims.iter().product::<f64>() - removed) * 1e9,
            );
            assert_eq!(result.topology().faces, if all { 26 } else { 10 });
            assert_eq!(result.topology().genus, 0);
            let areas = result.face_areas_mm2().unwrap();
            let triangles: Vec<_> = result
                .body
                .faces
                .iter()
                .enumerate()
                .filter(|(_, face)| {
                    face.loops.len() == 1
                        && result.body.loops[face.loops[0].0 as usize].coedges.len() == 3
                })
                .map(|(i, _)| i)
                .collect();
            assert_eq!(triangles.len(), corners);
            for i in triangles {
                close(areas[i], 3_f64.sqrt() * w * w * 1e6 / 2.);
            }
            if all {
                for (got, d) in result.centroid_mm().unwrap().iter().zip(dims) {
                    close(*got, d * 500.);
                }
            }
        }
    }
}
#[test]
fn hollow_boolean_box_keeps_pocket_and_exact_nonrepresentable_setbacks() {
    let a = box_at([0.; 3], [0.160, 0.045, 0.045]);
    let pocket = box_at([0.002; 3], [0.158, 0.043, 0.045]);
    let source = checked(
        orthogonal::boolean(key(), 1, &[a, pocket])
            .unwrap()
            .remove(0),
    );
    let result = checked(chamfer::equal_offsets(&source, &bottom(&source), 0.00042).unwrap());
    let w = 0.00042;
    let want = (0.160 * 0.045 * 0.045 - 0.156 * 0.041 * 0.043 - (0.160 + 0.045) * w * w
        + 4. * w * w * w / 3.)
        * 1e9;
    close(result.volume_mm3().unwrap(), want);
    assert_eq!(result.topology().genus, 0);
    assert_eq!(result.topology().faces, 15);
    let text = wonky_ops::step::write(&[("box".into(), &result)], "foot").unwrap();
    assert!(text.contains("MANIFOLD_SOLID_BREP"));
    assert!(result.export_tolerance_mm().unwrap() < 1e-9);
}
#[test]
fn consuming_offsets_refuse_by_name() {
    let a = box_at([0.; 3], [1.; 3]);
    for edges in [bottom(&a), (0..a.body.edges.len()).collect()] {
        for w in [0.5, 0.75, 1., 2.] {
            let e = chamfer::equal_offsets(&a, &edges, w).unwrap_err();
            assert!(
                matches!(
                    e.0.as_str(),
                    "chamfer/face-consumed-or-overlap" | "chamfer/empty-or-overlapping-cut"
                ),
                "{}",
                e.0
            );
        }
    }
}
#[test]
fn replay_rejects_planted_vertex_mutation_and_does_not_promote_display_geometry() {
    let a = box_at([0.; 3], [0.160, 0.045, 0.045]);
    let edges: Vec<_> = (0..a.body.edges.len()).collect();
    let result = chamfer::equal_offsets(&a, &edges, 0.00042).unwrap();
    let words = wonky_wire::v3::encode(&result).unwrap();
    let good = audit(&wonky_wire::v3::decode(&words).unwrap()).unwrap();
    assert_eq!(
        wonky_ops::mesh::tessellate(&wonky_wire::v3::decode(&words).unwrap(), 0.01)
            .unwrap_err()
            .0,
        "export/stl/chamfer-witness-metric-unimplemented"
    );
    let mut forged = result;
    let p = forged.vertices[0].point[0].get();
    forged.vertices[0].point[0] = Binary64::new(p + 0.0001).unwrap();
    assert_eq!(
        audit(&forged.check().unwrap()).unwrap_err().0,
        "chamfer/construction-binding"
    );
    assert_eq!(
        wonky_ops::edge_query::closest(&[(&good, 0)], [0.; 3], 0.)
            .unwrap_err()
            .0,
        "edge-query/chamfer-metric-unimplemented"
    );
    assert_eq!(
        wonky_ops::pattern::copy(
            &good,
            key(),
            [[1., 0., 0.], [0., 1., 0.], [0., 0., 1.]],
            [1.; 3]
        )
        .unwrap_err()
        .0,
        "pattern/chamfer-placement-unimplemented"
    );
    // Rational chamfer witnesses must not become authoritative Boolean leaves.
    assert_eq!(
        orthogonal::boolean(key(), 1, &[good.clone(), a]).unwrap_err().0,
        "planar-boolean/chamfer-operand-unsupported"
    );
    // Placement is still symbolic, and supported axis permutations preserve volume.
    let placed = checked(
        orthogonal::transform(
            &good,
            Affine {
                origin: [65.53625, -32.7685, 16.384125],
                x: [0., 0., 1.],
                z: [0., -1., 0.],
            },
        )
        .unwrap(),
    );
    close(placed.volume_mm3().unwrap(), good.volume_mm3().unwrap());
}

/// Exact probes on the chamfered bottom ring: a point below the chamfered
/// edge is nearest to the chamfer face, not to the removed box corner edge.
#[test]
fn chamfer_probes_measure_the_chamfer_face() {
    use wonky_ops::polyhedron::Probe;
    let a = box_at([0.; 3], [1., 1., 1.]);
    let ring = checked(chamfer::equal_offsets(&a, &bottom(&a), 0.125).unwrap());
    for (point, expected) in [
        ([500., -100., -100.], Some(325. / 2f64.sqrt())),
        ([500., 500., 1500.], Some(500.)),
        ([500., 500., -250.], Some(250.)),
        ([500., 500., 500.], None),
        ([500., 0., 500.], None),
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
