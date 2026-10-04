//! Model blend rule ownership and exact replay: family caches cannot authorize
//! this construction and mutations are rejected even on replay cache hits.
use wonky_contract::{Binary64, Body, BodyKey};
use wonky_ops::{
    analytic::{self, Solid},
    model_boolean, orthogonal,
    polyhedron::{self, Audited},
};
fn key() -> BodyKey {
    BodyKey {
        id: [6, 3, 1, 4],
        revision: 0,
    }
}
fn box_body(hi: [f64; 3]) -> Audited {
    polyhedron::audit(
        &orthogonal::cuboid(key(), [0.; 3], hi)
            .unwrap()
            .check()
            .unwrap(),
    )
    .unwrap()
}
fn model(b: Body) -> Solid {
    analytic::audit(&b.check().unwrap()).unwrap()
}
fn corner(a: &Audited) -> Vec<usize> {
    a.body
        .edges
        .iter()
        .enumerate()
        .filter(|(_, e)| {
            e.vertices
                .iter()
                .any(|v| a.body.vertices[v.0 as usize].point.map(|x| x.get()) == [0.; 3])
        })
        .map(|(i, _)| i)
        .collect()
}
// In these integer box cases every old-path vertex is dyadic. Reconstruct
// its exact plane point sets from those vertices, never from normalized cache
// normals, and compare the complete canonical B-rep rather than volume alone.
fn family_model(a: &Audited) -> wonky_geom::model::Model {
    use num_traits::{One, Zero};
    use wonky_geom::model::{polyhedron, Label, Plane3, PolyFace, Provenance, VertexDef};
    use wonky_geom::{cross, sub, Point, Q};
    let mut faces = Vec::new();
    for (i, f) in a.body.faces.iter().enumerate() {
        let cycles: Vec<Vec<Point>> = f
            .loops
            .iter()
            .map(|l| {
                a.body.loops[l.0 as usize]
                    .coedges
                    .iter()
                    .map(|c| {
                        let co = &a.body.coedges[c.0 as usize];
                        let edge = &a.body.edges[co.edge.0 as usize];
                        wonky_geom::point(
                            a.body.vertices[edge.vertices[usize::from(!co.forward)].0 as usize]
                                .point
                                .map(|x| x.get()),
                        )
                        .unwrap()
                    })
                    .collect()
            })
            .collect();
        let lp = &cycles[0];
        let mut n: Point = std::array::from_fn(|_| Q::zero());
        for j in 1..lp.len() - 1 {
            let c = cross(&sub(&lp[j], &lp[0]), &sub(&lp[j + 1], &lp[0]));
            for k in 0..3 {
                n[k] += &c[k];
            }
        }
        let axis = if n[1].is_zero() && n[2].is_zero() {
            [Q::zero(), Q::one(), Q::zero()]
        } else {
            [Q::one(), Q::zero(), Q::zero()]
        };
        faces.push(PolyFace {
            carrier: Plane3 {
                o: lp[0].clone(),
                x: cross(&n, &axis),
                n,
            },
            forward: true,
            loops: cycles
                .into_iter()
                .map(|lp| lp.into_iter().map(VertexDef::Rational).collect())
                .collect(),
            provenance: Provenance {
                node: 0,
                slot: i as u32,
            },
        });
    }
    polyhedron(a.frame.exact_frame().unwrap(), Label::Exact, 0, faces)
        .unwrap()
        .check()
        .unwrap()
}
#[test]
fn model_chamfer_is_owned_by_rule_and_replay_rejects_cache_mutation() {
    let a = box_body([20.; 3]);
    let b = model_boolean::chamfer(&a, &corner(&a), 1.).unwrap();
    assert_eq!(b.constructions.last().unwrap().rule_version, 11);
    let Solid::Model(a, m) = model(b.clone()) else {
        panic!("Model rule lost ownership")
    };
    assert_eq!(m.draft().faces.len(), 10);
    assert!((a.volume_mm3().unwrap() - 7970.666666666667e9).abs() < 0.002);
    assert_eq!(model(b.clone()).model().unwrap().canonical(), m.canonical());
    let mut bad = b;
    bad.vertices[0].point[0] = Binary64::new(bad.vertices[0].point[0].get() + 0.00001).unwrap();
    assert!(analytic::audit(&bad.check().unwrap())
        .unwrap_err()
        .0
        .contains("observation-cache"));
}
#[test]
fn g7_model_can_be_chamfered_then_consumed_by_boolean() {
    let a = box_body([20.; 3]);
    let b = box_body([10.; 3]);
    let merged = model_boolean::boolean(
        key(),
        0,
        &[a, b],
        &mut model_boolean::ReplayCache::default(),
    )
    .unwrap();
    let Solid::Model(a, _) = model(merged) else {
        panic!("G7 did not emit Model")
    };
    let blend = model_boolean::chamfer(&a, &corner(&a)[..2], 1.).unwrap();
    let Solid::Model(a, m) = model(blend) else {
        panic!("blend did not emit Model")
    };
    assert_eq!(m.draft().faces.len(), 8);
    let b = box_body([5.; 3]);
    let merged = model_boolean::boolean(
        key(),
        0,
        &[a, b],
        &mut model_boolean::ReplayCache::default(),
    )
    .unwrap();
    assert!(matches!(model(merged), Solid::Model(..)));
}
#[test]
fn model_and_family_shadows_match_dyadic_box_selections() {
    let a = box_body([20.; 3]);
    let sets = vec![
        corner(&a)[..1].to_vec(),
        corner(&a)[..2].to_vec(),
        corner(&a),
        (0..a.body.edges.len()).collect(),
    ];
    for es in sets {
        let old = polyhedron::audit(
            &wonky_ops::chamfer::equal_offsets(&a, &es, 1.)
                .unwrap()
                .check()
                .unwrap(),
        )
        .unwrap();
        let Solid::Model(new, m) = model(model_boolean::chamfer(&a, &es, 1.).unwrap()) else {
            panic!("model")
        };
        assert_eq!(family_model(&old).canonical(), m.canonical());
        assert_eq!(old.topology(), new.topology());
        assert_eq!(old.volume_mm3().unwrap(), new.volume_mm3().unwrap());
        assert_eq!(m.draft().faces.len(), old.body.faces.len());
    }
}

fn prism(cap: &[[f64; 2]]) -> Audited {
    use wonky_num::p2;
    use wonky_ops::{
        affine::Affine,
        extrude::{blind_prism, Prism},
    };
    let segments: Vec<_> = (0..cap.len())
        .map(|i| {
            let (a, b) = (cap[i], cap[(i + 1) % cap.len()]);
            [a[0], a[1], b[0], b[1]]
        })
        .collect();
    let region = wonky_sketch::region::lines_region(
        &segments
            .iter()
            .map(|s| [p2(s[0], s[1]), p2(s[2], s[3])])
            .collect::<Vec<_>>(),
    )
    .unwrap();
    polyhedron::audit(
        &blind_prism(&Prism {
            key: key(),
            source: [0; 4],
            frame: Affine::IDENTITY,
            segments: &segments,
            region: &region.loops[0],
            depth: 20.,
            reverse: false,
        })
        .unwrap()
        .check()
        .unwrap(),
    )
    .unwrap()
}
#[test]
fn radical_model_replay_authenticates_vertices_and_carriers_on_cache_hits() {
    let h = 5. * 3f64.sqrt();
    let a = prism(&[
        [10., 0.],
        [5., h],
        [-5., h],
        [-10., 0.],
        [-5., -h],
        [5., -h],
    ]);
    let edge = a
        .body
        .edges
        .iter()
        .position(|e| {
            e.vertices.iter().all(|v| {
                let p = a.body.vertices[v.0 as usize].point.map(|x| x.get());
                p[0] == 10. && p[1] == 0.
            })
        })
        .unwrap();
    let body = model_boolean::chamfer(&a, &[edge], 1.).unwrap();
    let Solid::Model(_, m) = model(body.clone()) else {
        panic!("missing radical Model")
    };
    assert_eq!(m.draft().faces.len(), 9);
    assert!(m
        .draft()
        .surfaces
        .iter()
        .any(|s| matches!(s.carrier, wonky_geom::model::Carrier3::RadicalPlane(_))));
    assert!(
        (m.volume6_radical().unwrap()[0].enclosure().unwrap().m / 6. - 5187.4921686687885).abs()
            < 1e-9
    );
    assert_eq!(
        model(body.clone()).model().unwrap().canonical(),
        m.canonical()
    );
    let mut bad = body.clone();
    bad.vertices[0].point[0] = Binary64::new(bad.vertices[0].point[0].get() + 0.00001).unwrap();
    assert!(analytic::audit(&bad.check().unwrap())
        .unwrap_err()
        .0
        .contains("observation-cache"));
    let mut bad = body;
    let wonky_contract::SurfaceGeometry::Plane { normal, .. } = &mut bad.surfaces[0].geometry
    else {
        panic!("plane")
    };
    normal[0] = Binary64::new(normal[0].get() + 0.00001).unwrap();
    assert!(analytic::audit(&bad.check().unwrap())
        .unwrap_err()
        .0
        .contains("observation-cache"));
}
#[test]
fn public_host_propagation_expands_leaf_chain_and_replays_the_flag() {
    use wonky_ops::host;
    let a = prism(&[[0., 0.], [20., 0.], [20., 10.], [20., 20.], [0., 20.]]);
    let edge = a
        .body
        .edges
        .iter()
        .position(|e| {
            e.vertices.iter().all(|v| {
                let p = a.body.vertices[v.0 as usize].point.map(|x| x.get());
                p[0] == 20. && p[2] == 0. && p[1] <= 10.
            })
        })
        .unwrap();
    let words = wonky_wire::v3::encode(&a.body).unwrap();
    let mut request = vec![
        host::MAGIC,
        host::VERSION,
        host::OP_CHAMFER,
        words.len() as u32,
    ];
    request.extend(words);
    let bits = 1f64.to_bits();
    request.extend([bits as u32, (bits >> 32) as u32, 1, edge as u32, 1]);
    let reply = host::host_op(&request);
    assert_eq!(reply[0], host::STATUS_OK, "{:?}", reply);
    let b = wonky_wire::v3::decode(&reply[1..]).unwrap().body().clone();
    assert_eq!(b.constructions.last().unwrap().rule_version, 12);
    assert_eq!(b.constructions.last().unwrap().parameters[1].get(), 1.);
    let Solid::Model(_, m) = model(b.clone()) else {
        panic!("Model")
    };
    assert_eq!(m.draft().faces.len(), 8);
    assert_eq!(
        m.volume6().unwrap()[0],
        wonky_geom::Q::from_integer(47940.into())
    );
    let mut bad = b;
    bad.constructions.last_mut().unwrap().parameters[1] = Binary64::new(0.).unwrap();
    assert!(analytic::audit(&bad.check().unwrap()).is_err());
}
