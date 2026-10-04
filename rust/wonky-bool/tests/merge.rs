//! G5: exact normalization, operand-order invariance and C9 admission.
use wonky_bool::{fold, Op};
use wonky_geom::frame::Frame;
use wonky_geom::model::{polyhedron, Label, Model, Plane3, PolyFace, Provenance, VertexDef};
use wonky_geom::{cross, dot, point, sub, Point, Q};

/// A convex polyhedron from integer vertices and its face cycles (any
/// orientation: each face is turned to face away from the vertex centroid).
fn convex(vertices: &[Point], faces: &[&[usize]], node: u32) -> Model {
    let p: Vec<Point> = vertices.to_vec();
    let n = Q::from_integer((p.len() as i64).into());
    let centroid: Point = std::array::from_fn(|k| p.iter().map(|q| q[k].clone()).sum::<Q>() / &n);
    let polys = faces
        .iter()
        .enumerate()
        .map(|(i, f)| {
            let mut cycle: Vec<usize> = f.to_vec();
            let x = sub(&p[cycle[1]], &p[cycle[0]]);
            let mut normal = cross(&x, &sub(&p[cycle[2]], &p[cycle[0]]));
            if dot(&normal, &sub(&p[cycle[0]], &centroid)) < Q::from_integer(0.into()) {
                cycle.reverse();
                normal = normal.map(|c| -c);
            }
            let x = sub(&p[cycle[1]], &p[cycle[0]]);
            PolyFace {
                carrier: Plane3 {
                    o: p[cycle[0]].clone(),
                    x,
                    n: normal,
                },
                forward: true,
                loops: vec![cycle
                    .iter()
                    .map(|&v| VertexDef::Rational(p[v].clone()))
                    .collect()],
                provenance: Provenance {
                    node,
                    slot: i as u32,
                },
            }
        })
        .collect();
    polyhedron(Frame::identity(), Label::Exact, node, polys)
        .unwrap()
        .check()
        .unwrap_or_else(|e| panic!("{}", e.0))
}

fn cube(lo: Point, hi: Point, node: u32) -> Model {
    let v: Vec<Point> = (0..8)
        .map(|i| {
            [0, 1, 2].map(|k| {
                if i >> k & 1 == 1 {
                    hi[k].clone()
                } else {
                    lo[k].clone()
                }
            })
        })
        .collect();
    convex(
        &v,
        &[
            &[0, 2, 3, 1],
            &[4, 5, 7, 6],
            &[0, 1, 5, 4],
            &[2, 6, 7, 3],
            &[0, 4, 6, 2],
            &[1, 3, 7, 5],
        ],
        node,
    )
}

/// A square pyramid: base square `[c-2, c+2]^2` at height `base`, apex at `(c, c, apex)`.

#[test]
fn identical_operands_are_idempotent_and_opposite_boundary_contacts_do_not_merge() {
    let a = cube(
        point([0., 0., 0.]).unwrap(),
        point([8., 8., 8.]).unwrap(),
        1,
    );
    for op in [Op::Union, Op::Intersection] {
        let out = fold(op, &[&a, &a], 2).unwrap();
        assert_eq!(out.model.canonical(), a.canonical());
        assert_eq!(
            fold(op, &[&out.model, &a], 3).unwrap().model.canonical(),
            a.canonical()
        );
    }
    let b = cube(
        point([8., 0., 0.]).unwrap(),
        point([16., 8., 8.]).unwrap(),
        4,
    );
    let combined = cube(
        point([0., 0., 0.]).unwrap(),
        point([16., 8., 8.]).unwrap(),
        5,
    );
    for operands in [[&a, &b], [&b, &a]] {
        let out = fold(Op::Union, &operands, 6).unwrap().model;
        assert_eq!(out.canonical(), combined.canonical());
        assert_eq!(
            out.draft().vertices.len(),
            8,
            "all degree-two seam vertices removed"
        );
    }
    assert_eq!(
        fold(Op::Subtraction, &[&a, &b], 7)
            .unwrap()
            .model
            .canonical(),
        a.canonical()
    );
}

#[test]
fn an_exact_constructed_sliver_below_source_binary64_resolution_refuses() {
    let delta = Q::new(1.into(), (1u64 << 60).into());
    let a = cube(
        point([0., 0., 0.]).unwrap(),
        point([1., 1., 1.]).unwrap(),
        1,
    );
    let mut lo = point([1., 0., 0.]).unwrap();
    lo[0] -= &delta;
    let b = cube(lo, point([2., 1., 1.]).unwrap(), 2);
    let err = fold(Op::Intersection, &[&a, &b], 3).unwrap_err();
    assert_eq!(err.0, "boolean/sub-resolution-feature");
    // The operand itself passes exact B-rep audit. Admission refuses the real
    // output sliver, rather than rounding the input or reporting empty-result.
    assert_eq!(a.volume6().unwrap()[0], Q::from_integer(6.into()));
}

#[test]
fn a_representable_ulp_and_a_two_to_minus_30_sliver_are_not_an_epsilon_gap() {
    for delta in [
        Q::new(1.into(), (1u64 << 30).into()),
        Q::new(1.into(), (1u64 << 52).into()),
    ] {
        let a = cube(
            point([0., 0., 0.]).unwrap(),
            point([1., 1., 1.]).unwrap(),
            1,
        );
        let mut lo = point([1., 0., 0.]).unwrap();
        lo[0] -= &delta;
        let b = cube(lo, point([2., 1., 1.]).unwrap(), 2);
        for operands in [[&a, &b], [&b, &a]] {
            let out = fold(Op::Intersection, &operands, 3).unwrap().model;
            let cert = wonky_bool::resolution::certify(&out).unwrap();
            assert_eq!(cert.minimum_distance2, &delta * &delta);
            assert_eq!(
                out.volume6().unwrap()[0],
                &delta * Q::from_integer(6.into())
            );
            assert_eq!(out.draft().vertices.len(), 8);
        }
    }
}

#[test]
fn a_thin_wall_is_measured_to_the_face_interior_not_only_to_its_vertices() {
    // Offset cavity vertices project strictly inside the outer face; no
    // outer vertex is close, and the two parallel edges do not overlap.
    let outer = cube(
        point([0., 0., 0.]).unwrap(),
        point([4., 4., 4.]).unwrap(),
        1,
    );
    let delta = Q::new(1.into(), (1u64 << 30).into());
    let mut hi = point([3., 3., 4.]).unwrap();
    hi[2] -= &delta;
    let inner = cube(point([1., 1., 1.]).unwrap(), hi, 2);
    let out = fold(Op::Subtraction, &[&outer, &inner], 3).unwrap().model;
    assert_eq!(
        wonky_bool::resolution::certify(&out)
            .unwrap()
            .minimum_distance2,
        &delta * &delta
    );
    assert_eq!(out.draft().shells.len(), 2);
    let tiny = Q::new(1.into(), (1u64 << 60).into());
    let mut hi = point([3., 3., 4.]).unwrap();
    hi[2] -= tiny;
    let inner = cube(point([1., 1., 1.]).unwrap(), hi, 4);
    assert_eq!(
        fold(Op::Subtraction, &[&outer, &inner], 5).unwrap_err().0,
        "boolean/sub-resolution-feature"
    );
}
