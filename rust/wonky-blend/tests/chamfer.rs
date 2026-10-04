use num_traits::Zero;
use wonky_blend::{chamfer, Request, Section};
use wonky_contract::{Body, BodyKey};
use wonky_curve::radical::Radical;
use wonky_geom::frame::Frame;
use wonky_geom::model::*;
use wonky_geom::{cross, sub, Point, Q};
use wonky_ops::{analytic, orthogonal};
fn q(n: i64) -> Q {
    Q::from_integer(n.into())
}
fn request() -> Request {
    Request {
        section: Section::EqualOffsets { width: q(1) },
        tangent_propagation: true,
    }
}
fn solid(b: Body) -> Model {
    analytic::audit(&b.check().unwrap())
        .unwrap()
        .model()
        .unwrap()
}
fn cube() -> Model {
    solid(
        orthogonal::cuboid(
            BodyKey {
                id: [1, 2, 3, 4],
                revision: 0,
            },
            [0.; 3],
            [20.; 3],
        )
        .unwrap(),
    )
}
fn selected(m: &Model, p: Point) -> Vec<EdgeId> {
    m.draft()
        .edges
        .iter()
        .enumerate()
        .filter_map(|(i, e)| match e.bounds {
            Bounds::Segment(v) if v.iter().any(|v| m.key(*v).rational().unwrap() == &p) => {
                Some(EdgeId(i as u32))
            }
            _ => None,
        })
        .collect()
}
fn face(lp: Vec<Point>, slot: u32) -> PolyFace {
    let n = cross(&sub(&lp[1], &lp[0]), &sub(&lp[2], &lp[0]));
    let x = sub(&lp[1], &lp[0]);
    PolyFace {
        carrier: Plane3 {
            o: lp[0].clone(),
            n,
            x,
        },
        forward: true,
        loops: vec![lp.into_iter().map(VertexDef::Rational).collect()],
        provenance: Provenance { node: 0, slot },
    }
}
fn prism(poly: Vec<[Q; 2]>, cap_slope: Q) -> Model {
    let lo: Vec<Point> = poly
        .iter()
        .map(|p| [p[0].clone(), p[1].clone(), Q::zero()])
        .collect();
    let hi: Vec<Point> = lo
        .iter()
        .map(|p| [p[0].clone(), p[1].clone(), q(20) + &cap_slope * &p[0]])
        .collect();
    let mut bottom = lo.clone();
    bottom.reverse();
    let mut faces = vec![face(bottom, 0), face(hi.clone(), 1)];
    for i in 0..lo.len() {
        let j = (i + 1) % lo.len();
        faces.push(face(
            vec![lo[i].clone(), lo[j].clone(), hi[j].clone(), hi[i].clone()],
            (i + 2) as u32,
        ));
    }
    polyhedron(Frame::identity(), Label::Exact, 0, faces)
        .unwrap()
        .check()
        .unwrap()
}
#[test]
fn fp16_corner_triangle_matches_frozen_onshape_volume_and_faces() {
    let m = cube();
    let es = selected(&m, [q(0), q(0), q(0)]);
    let b = chamfer::equal_offsets(&m, &es, request(), 1).unwrap();
    assert_eq!(b.faces.len(), 10);
    assert_eq!(b.volume6().rational().unwrap(), q(47824)); // 7970 2/3 * 6; FP16 reference.json
    let model = b.rational_model(&m, 1).unwrap();
    assert_eq!(model.volume6().unwrap(), vec![q(47824)]);
}
#[test]
fn fp15_along_face_semantics_survives_obtuse_dihedral_and_radical_sewing() {
    // Frozen FP15: regular hexagon radius 10, height 20, one vertical edge.
    // FeatureScript evaluates sqrt(3) in binary64; that input is interpreted as Q.
    let h = Q::from_float(5. * 3f64.sqrt()).unwrap();
    let poly = vec![
        [q(10), q(0)],
        [q(5), h.clone()],
        [-q(5), h.clone()],
        [-q(10), q(0)],
        [-q(5), -h.clone()],
        [q(5), -h],
    ];
    let m = prism(poly, q(0));
    let es: Vec<_> = selected(&m, [q(10), q(0), q(0)])
        .into_iter()
        .filter(|e| match m.draft().edges[e.index()].bounds {
            Bounds::Segment([a, b]) => {
                m.key(a).rational().unwrap()[2] != m.key(b).rational().unwrap()[2]
            }
            Bounds::Ring => false,
        })
        .collect();
    let b = chamfer::equal_offsets(&m, &es, request(), 1).unwrap();
    assert_eq!(b.faces.len(), 9);
    b.check().unwrap();
    assert!(b
        .vertices()
        .unwrap()
        .iter()
        .all(|v| matches!(v, VertexDef::Radical(_))));
    let model = b.rational_model(&m, 1).unwrap();
    assert_eq!(model.draft().faces.len(), 9);
    assert_eq!(model.volume6_radical().unwrap(), vec![b.volume6()]);
    let volume = b.volume6().enclosure().unwrap().m / 6.;
    assert!(
        (volume - 5187.4921686687885).abs() < 1e-9,
        "FP15 volume {volume}"
    );
    assert!(b
        .faces
        .iter()
        .flat_map(|f| f.loops.iter().flatten())
        .any(|p| p.iter().any(|x| x.rational().is_none())));
    let mut rounded = b.clone();
    for f in &mut rounded.faces {
        for p in f.loops.iter_mut().flatten() {
            for x in p {
                *x = Radical::from(Q::from_float(x.enclosure().unwrap().m).unwrap());
            }
        }
    }
    assert_eq!(
        rounded.check().unwrap_err().0,
        "chamfer/contract-violation:exact-incidence"
    );
}
#[test]
fn oblique_cap_and_line_mitre_are_exact() {
    let m = prism(
        vec![[q(0), q(0)], [q(20), q(0)], [q(20), q(20)], [q(0), q(20)]],
        q(1) / q(2),
    );
    let all = selected(&m, [q(0), q(0), q(0)]);
    for es in [&all[..1], &all[..2], &all[..3]] {
        let b = chamfer::equal_offsets(&m, es, request(), 1).unwrap();
        b.check().unwrap();
        assert!(b.volume6() < Radical::from(m.volume6().unwrap()[0].clone()));
    }
}
#[test]
fn two_offsets_refuses_before_geometry() {
    let m = cube();
    let es = selected(&m, [q(0), q(0), q(0)]);
    let r = Request {
        section: Section::TwoOffsets {
            first: q(1),
            second: q(2),
            opposite_direction: false,
        },
        tangent_propagation: true,
    };
    assert_eq!(
        chamfer::equal_offsets(&m, &es, r, 1).unwrap_err().0,
        "chamfer/two-offsets-side-order-unprobed"
    );
}

#[test]
fn radical_vertex_identity_is_independent_of_definition_class() {
    let p = QuadraticPoint3::new([q(1), q(2), q(3)], [q(0), q(1), q(-1)], q(3)).unwrap();
    assert_eq!(
        VertexDef::Quadratic(p.clone()).key().unwrap(),
        VertexDef::Radical(p.coordinates().clone()).key().unwrap()
    );
}
#[test]
fn large_setback_cannot_swallow_an_unselected_edge() {
    let m = cube();
    let es = selected(&m, [q(0), q(0), q(0)]);
    let r = Request {
        section: Section::EqualOffsets { width: q(21) },
        tangent_propagation: false,
    };
    assert!(chamfer::equal_offsets(&m, &es[..1], r, 1)
        .unwrap_err()
        .0
        .starts_with("blend/overflow:"));
}

#[test]
fn concave_planar_attachment_adds_exact_material_with_oblique_caps() {
    for slope in [q(0), q(1) / q(2)] {
        let m = prism(
            vec![
                [q(0), q(0)],
                [q(20), q(0)],
                [q(20), q(10)],
                [q(10), q(10)],
                [q(10), q(20)],
                [q(0), q(20)],
            ],
            slope.clone(),
        );
        let es = selected(&m, [q(10), q(10), q(0)])
            .into_iter()
            .filter(|e| match m.draft().edges[e.index()].bounds {
                Bounds::Segment([a, b]) => {
                    m.key(a).rational().unwrap()[2] != m.key(b).rational().unwrap()[2]
                }
                Bounds::Ring => false,
            })
            .collect::<Vec<_>>();
        assert_eq!(es.len(), 1);
        let b = chamfer::equal_offsets(&m, &es, request(), 1).unwrap();
        let model = b.rational_model(&m, 1).unwrap();
        assert_eq!(model.draft().faces.len(), 9);
        assert!(b.volume6() > Radical::from(m.volume6().unwrap()[0].clone()));
        if slope.is_zero() {
            assert_eq!(b.volume6().rational().unwrap(), q(36060));
        }
    }
}
#[test]
fn exact_tangent_chain_expands_one_selected_edge_before_surgery() {
    let m = prism(
        vec![
            [q(0), q(0)],
            [q(20), q(0)],
            [q(20), q(10)],
            [q(20), q(20)],
            [q(0), q(20)],
        ],
        q(0),
    );
    let es = m
        .draft()
        .edges
        .iter()
        .enumerate()
        .filter_map(|(i, e)| match e.bounds {
            Bounds::Segment([a, b])
                if m.key(a).rational().unwrap()[0] == q(20)
                    && m.key(b).rational().unwrap()[0] == q(20)
                    && m.key(a).rational().unwrap()[2] == q(0)
                    && m.key(b).rational().unwrap()[2] == q(0) =>
            {
                Some(EdgeId(i as u32))
            }
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(es.len(), 2);
    let graph = wonky_blend::stripes(&m, &es[..1], request()).unwrap();
    assert_eq!(graph.added_edges.len(), 1);
    let b = chamfer::equal_offsets(&m, &es[..1], request(), 1).unwrap();
    let full = chamfer::equal_offsets(&m, &es, request(), 1).unwrap();
    assert_eq!(
        b.rational_model(&m, 1).unwrap().canonical(),
        full.rational_model(&m, 1).unwrap().canonical()
    );
    assert_eq!(b.volume6().rational().unwrap(), q(47940));
}
