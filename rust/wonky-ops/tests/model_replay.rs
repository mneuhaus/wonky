//! G6 library-only WC0 writer/replay and real consumer tests.
use wonky_contract::{Binary64, Body, BodyKey};
use wonky_ops::{
    analytic::{self, Solid},
    model_boolean::{self, ReplayCache},
    orthogonal,
    polyhedron::{self, Audited},
    query,
};
fn key() -> BodyKey {
    BodyKey {
        id: [6, 0, 0, 1],
        revision: 0,
    }
}
fn check(b: &Body) -> wonky_contract::CheckedBody {
    wonky_wire::v3::decode(&wonky_wire::v3::encode(b).unwrap()).unwrap()
}
fn cube(lo: [f64; 3], hi: [f64; 3]) -> Audited {
    polyhedron::audit(&check(&orthogonal::cuboid(key(), lo, hi).unwrap())).unwrap()
}
#[test]
fn twenty_step_chain_roundtrips_and_each_node_computes_once() {
    let a = cube([0.; 3], [1.; 3]);
    let tool = cube([0.5, 0., 0.], [1.5, 1., 1.]);
    let mut cache = ReplayCache::default();
    let mut current = a.clone();
    let mut last = None;
    for _ in 0..20 {
        let b = model_boolean::boolean(key(), 0, &[current, tool.clone()], &mut cache).unwrap();
        let (p, m) = cache.audit(&check(&b)).unwrap();
        assert_eq!(
            cache.audit(&check(&b)).unwrap().1.canonical(),
            m.canonical()
        );
        current = p;
        last = Some(b);
    }
    assert_eq!(cache.computed(), 22, "two leaves and twenty Boolean nodes");
    let b = last.unwrap();
    let decoded = check(&b);
    let solid = analytic::audit(&decoded).unwrap();
    assert!(
        matches!(solid, Solid::Model(_, _)),
        "dispatch must use rule, even for a box"
    );
    assert_eq!(
        solid.model().unwrap().canonical(),
        cache.audit(&decoded).unwrap().1.canonical()
    );
    assert!(solid.measure(None, &[]).unwrap().contains("volume"));
    assert_eq!(solid.extents().unwrap(), [1500., 1000., 1000.]);
    let mesh = wonky_ops::mesh::tessellate(&decoded, 1e-8).unwrap();
    wonky_ops::mesh::check_watertight(&mesh).unwrap();
    assert!(!wonky_ops::mesh::binary_stl(&[mesh], 1e-8)
        .unwrap()
        .is_empty());
    assert!(analytic::step(&[("model".into(), solid)], "G6")
        .unwrap()
        .contains("MANIFOLD_SOLID_BREP"));
}
#[test]
fn a_tampered_observation_refuses_even_on_a_warm_cache() {
    let mut cache = ReplayCache::default();
    let b = model_boolean::boolean(
        key(),
        0,
        &[cube([0.; 3], [1.; 3]), cube([0.5, 0., 0.], [1.5, 1., 1.])],
        &mut cache,
    )
    .unwrap();
    cache.audit(&check(&b)).unwrap();
    let mut bad = b;
    bad.vertices[0].point[0] = Binary64::new(bad.vertices[0].point[0].get() + 0.125).unwrap();
    let err = cache.audit(&check(&bad)).unwrap_err();
    assert_eq!(err.0, "boolean/contract-violation:observation-cache");
}
#[test]
fn acid_planar_bodies_owned_adjacent_and_geometry_queries_match() {
    let mut count = 0;
    let mut compared = std::collections::BTreeSet::new();
    for line in include_str!("data/acid-planar-wc0.txt")
        .lines()
        .filter(|l| !l.starts_with('#'))
    {
        let f: Vec<_> = line.split_whitespace().collect();
        if !["AC10", "AC11", "AC14", "AC16", "AC17"].contains(&f[0]) {
            continue;
        }
        let words: Vec<_> = f[5]
            .as_bytes()
            .chunks(8)
            .map(|c| u32::from_str_radix(std::str::from_utf8(c).unwrap(), 16).unwrap())
            .collect();
        let family = analytic::audit(&wonky_wire::v3::decode(&words).unwrap()).unwrap();
        let Solid::Planar(a) = &family else {
            panic!("planar fixture")
        };
        let mut cache = ReplayCache::default();
        let b = model_boolean::boolean(key(), 0, &[a.clone(), a.clone()], &mut cache).unwrap();
        let model = analytic::audit(&check(&b)).unwrap();
        for kind in [query::FACE, query::EDGE, query::VERTEX] {
            let old = query::owned(&family, kind).unwrap();
            let new = query::owned(&model, kind).unwrap();
            assert_eq!(old.len(), new.len(), "{} {} kind {kind}", f[0], f[1]);
            // Compare geometry-category and incidence multisets: transport ids
            // are deliberately reallocated by the general writer.
            for name in ["PLANE", "LINE", "CIRCLE"] {
                let old_geometry = query::geometry(&family, &old, name)
                    .map(|v| v.len())
                    .map_err(|e| e.0);
                let new_geometry = query::geometry(&model, &new, name)
                    .map(|v| v.len())
                    .map_err(|e| e.0);
                assert_eq!(old_geometry, new_geometry);
                if kind == query::VERTEX {
                    assert_eq!(old_geometry.unwrap_err(), "query/geometry-entity");
                } else {
                    assert!(old_geometry.is_ok());
                }
            }
            for target in [query::EDGE, query::FACE] {
                let degrees = |solid: &Solid, entities: &[query::Entity]| {
                    let mut result: Vec<_> = entities
                        .iter()
                        .map(|e| {
                            query::adjacent(solid, &[*e], target)
                                .map(|v| v.len())
                                .map_err(|e| e.0)
                        })
                        .collect();
                    result.sort();
                    result
                };
                let old_degree = degrees(&family, &old);
                let new_degree = degrees(&model, &new);
                assert_eq!(old_degree, new_degree);
                if kind == query::FACE {
                    assert!(old_degree.iter().all(Result::is_ok));
                } else {
                    assert!(old_degree
                        .iter()
                        .all(|v| v.as_ref().unwrap_err() == "query/adjacency-seed"));
                }
            }
        }
        compared.insert((f[0].to_owned(), f[1].to_owned()));
        count += 1;
    }
    for zone in ["AC10", "AC11", "AC14", "AC16", "AC17"] {
        for variant in ["V0", "V1", "V2", "V3"] {
            assert!(
                compared.contains(&(zone.into(), variant.into())),
                "missing {zone} {variant}"
            );
        }
    }
    assert!(count >= 20, "actual frozen acid bodies, got {count}");
    eprintln!("G6 queries: {count} frozen bodies compared; all five result zones in V0-V3 present");
}

#[test]
fn no_body_zones_have_exact_named_outcomes() {
    let a = cube([0.; 3], [1.; 3]);
    let mut cache = ReplayCache::default();
    for (b, op, code) in [
        (
            cube([1., 1., 0.], [2., 2., 1.]),
            0,
            "boolean/non-manifold-result",
        ),
        (cube([1.; 3], [2.; 3]), 0, "boolean/non-manifold-result"),
        (cube([1., 0., 0.], [2., 1., 1.]), 2, "boolean/empty-result"),
        (a.clone(), 1, "boolean/empty-result"),
    ] {
        let verdict = model_boolean::boolean(key(), op, &[a.clone(), b], &mut cache)
            .unwrap_err();
        assert_eq!(verdict.0, code);
        assert!(!verdict.is_capability(), "proved geometry must stop owner fallback");
    }
}

#[test]
fn rule6_step_and_mesh_artifacts_include_void_shells_and_face_holes() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../out/g6-model");
    std::fs::create_dir_all(&dir).unwrap();
    for (name, op, lo, hi) in [
        ("union", 0, [0.5, 0., 0.], [1.5, 1., 1.]),
        ("void", 1, [0.25; 3], [0.75; 3]),
        ("hole", 1, [0.25, 0.25, -0.25], [0.75, 0.75, 1.25]),
        ("disjoint", 0, [2., 0., 0.], [3., 1., 1.]),
    ] {
        let mut cache = ReplayCache::default();
        let b = model_boolean::boolean(
            key(),
            op,
            &[cube([0.; 3], [1.; 3]), cube(lo, hi)],
            &mut cache,
        )
        .unwrap();
        let checked = check(&b);
        let (a, model) = cache.audit(&checked).unwrap();
        assert_eq!(a.body.shells.len(), model.draft().shells.len());
        if name == "void" {
            assert_eq!(a.body.shells.len(), 2);
        }
        if name == "hole" {
            assert!(a.body.faces.iter().any(|f| f.loops.len() == 2));
        }
        if name == "disjoint" {
            assert_eq!(a.topology().bodies, 2);
            assert_eq!(
                query::owned(&Solid::Model(a.clone(), model.clone()), query::BODY)
                    .unwrap()
                    .len(),
                2
            );
        }
        let mesh = wonky_ops::mesh::tessellate(&checked, 1e-7).unwrap();
        wonky_ops::mesh::check_watertight(&mesh).unwrap();
        std::fs::write(
            dir.join(format!("{name}.stl")),
            wonky_ops::mesh::binary_stl(&[mesh], 1e-7).unwrap(),
        )
        .unwrap();
        let list = |v: &[f64]| {
            v.iter()
                .map(|x| format!("{x:?}"))
                .collect::<Vec<_>>()
                .join(",")
        };
        // The validator consumes one honest projection per actual solid.
        // These artifact cases use the identity construction placement.
        assert_eq!(
            model.draft().placement,
            wonky_geom::frame::Frame::identity()
        );
        let world = a.world_vertices_mm().unwrap();
        let areas = a.face_areas_mm2().unwrap();
        let perimeters = a.face_perimeters_mm().unwrap();
        let volumes = model.volume6().unwrap();
        let tolerance = a.export_tolerance_mm().unwrap();
        let mut projections = Vec::new();
        for (si, solid) in b.solids.iter().enumerate() {
            use num_traits::ToPrimitive;
            use std::collections::{BTreeMap, BTreeSet};
            let fids: Vec<_> = solid
                .shells
                .iter()
                .flat_map(|s| b.shells[s.0 as usize].faces.iter().map(|f| f.0 as usize))
                .collect();
            let eids: BTreeSet<_> = fids
                .iter()
                .flat_map(|&f| {
                    b.faces[f].loops.iter().flat_map(|l| {
                        b.loops[l.0 as usize]
                            .coedges
                            .iter()
                            .map(|c| b.coedges[c.0 as usize].edge.0 as usize)
                    })
                })
                .collect();
            let vids: BTreeSet<_> = eids
                .iter()
                .flat_map(|&e| b.edges[e].vertices.iter().map(|v| v.0 as usize))
                .collect();
            let vm: BTreeMap<_, _> = vids.iter().enumerate().map(|(i, &v)| (v, i)).collect();
            let em: BTreeMap<_, _> = eids.iter().enumerate().map(|(i, &e)| (e, i)).collect();
            let vertices = vids
                .iter()
                .map(|&v| format!("[{}]", list(&world[v])))
                .collect::<Vec<_>>()
                .join(",");
            let edges = eids
                .iter()
                .map(|&e| {
                    format!(
                        "{{\"start\":{},\"end\":{}}}",
                        vm[&(b.edges[e].vertices[0].0 as usize)],
                        vm[&(b.edges[e].vertices[1].0 as usize)]
                    )
                })
                .collect::<Vec<_>>()
                .join(",");
            let faces = fids
                .iter()
                .map(|&f| {
                    let loops = b.faces[f]
                        .loops
                        .iter()
                        .map(|l| {
                            let uses = b.loops[l.0 as usize]
                                .coedges
                                .iter()
                                .map(|c| {
                                    let co = &b.coedges[c.0 as usize];
                                    format!(
                                        "{{\"edge\":{},\"forward\":{}}}",
                                        em[&(co.edge.0 as usize)],
                                        co.forward
                                    )
                                })
                                .collect::<Vec<_>>()
                                .join(",");
                            format!("[{uses}]")
                        })
                        .collect::<Vec<_>>()
                        .join(",");
                    format!("{{\"loops\":[{loops}]}}")
                })
                .collect::<Vec<_>>()
                .join(",");
            let volume = volumes[si].to_f64().unwrap() / 6. * 1e9;
            let face_areas = fids.iter().map(|&f| areas[f]).collect::<Vec<_>>();
            let face_perimeters = fids.iter().map(|&f| perimeters[f]).collect::<Vec<_>>();
            projections.push(format!("{{\"validation\":{{\"toleranceMm\":{tolerance:?},\"volumeMm3\":{volume:?}}},\"vertices\":[{vertices}],\"edges\":[{edges}],\"faces\":[{faces}],\"referenceMeasurements\":{{\"faceAreasMm2\":[{}],\"facePerimetersMm\":[{}],\"faceTolerancesMm\":[{}]}}}}",list(&face_areas),list(&face_perimeters),list(&vec![tolerance;fids.len()])));
        }
        let json = format!("{{\"bodies\":[{}]}}", projections.join(","));
        std::fs::write(dir.join(format!("{name}.brep.json")), json).unwrap();
        std::fs::write(
            dir.join(format!("{name}.step")),
            analytic::step(&[(name.into(), Solid::Model(a, model))], "G6").unwrap(),
        )
        .unwrap();
    }
}

#[test]
fn replay_owned_curve_tags_roundtrip_and_cannot_replace_a_cache() {
    let mut cache = ReplayCache::default();
    let mut b = model_boolean::boolean(
        key(),
        0,
        &[cube([0.; 3], [1.; 3]), cube([0.5, 0., 0.], [1.5, 1., 1.])],
        &mut cache,
    )
    .unwrap();
    b.curves[0].geometry = wonky_contract::CurveGeometry::ConstructionCurve {
        slot: 0,
        closed: false,
    };
    let checked = check(&b); // structural rule/slot transport is admitted
    assert_eq!(checked.body().curves[0].geometry, b.curves[0].geometry);
    let words = wonky_wire::v3::encode(&b).unwrap();
    let decoded = wonky_wire::v3::decode(&words).unwrap();
    assert_eq!(decoded.body(), checked.body());
    assert_eq!(wonky_wire::v3::encode(decoded.body()).unwrap(), words);
    assert_eq!(
        cache.audit(&checked).unwrap_err().0,
        "boolean/contract-violation:observation-cache"
    );
}

#[test]
fn support_frames_are_reemitted_in_one_exact_result_frame() {
    use wonky_ops::affine::Affine;
    let a = cube([0.; 3], [1.; 3]);
    let source = cube([0.; 3], [1.; 3]);
    let tool = wonky_ops::pattern::place(
        &source,
        key(),
        &wonky_ops::placement::Post::Interpreter(Affine {
            origin: [0.25, 0.25, 0.],
            x: [0.6, 0.8, 0.],
            z: [0., 0., 1.],
        }),
    )
    .unwrap();
    assert_eq!(
        a.frame
            .exact_frame()
            .unwrap()
            .relation_from(&tool.frame.exact_frame().unwrap())
            .class,
        wonky_geom::frame::RelationClass::R3Affine
    );
    let mut cache = ReplayCache::default();
    let b = model_boolean::boolean(key(), 2, &[a, tool], &mut cache).unwrap();
    let checked = check(&b);
    let (view, model) = cache.audit(&checked).unwrap();
    let result_frame = b.vertices[0].frame;
    assert!(b.surfaces.iter().all(|s| s.frame == result_frame));
    assert!(b.curves.iter().all(|c| c.frame == result_frame));
    assert!(b
        .pcurves
        .iter()
        .all(|c| b.surfaces[c.surface.0 as usize].frame == result_frame));
    assert_eq!(model.draft().placement, view.frame.exact_frame().unwrap());
    wonky_ops::mesh::tessellate(&checked, 1e-7).unwrap();
    for p in model.draft().surfaces.iter().map(|s| s.provenance.node) {
        assert!((p as usize) < b.constructions.len());
    }
}


fn concave_l() -> Audited {
    use wonky_ops::{affine::Affine, extrude::{blind_prism, Prism}};
    use wonky_num::p2;
    let cap = [[0.,0.],[24.,0.],[24.,6.],[6.,6.],[6.,20.],[0.,20.]];
    let segments: Vec<_> = (0..cap.len()).map(|i| {
        let (a,b)=(cap[i],cap[(i+1)%cap.len()]); [a[0],a[1],b[0],b[1]]
    }).collect();
    let region = wonky_sketch::region::lines_region(&segments.iter()
        .map(|s| [p2(s[0],s[1]),p2(s[2],s[3])]).collect::<Vec<_>>()).unwrap();
    polyhedron::audit(&check(&blind_prism(&Prism {
        key:key(), source:[0;4], frame:Affine::IDENTITY, segments:&segments,
        region:&region.loops[0], depth:6., reverse:false,
    }).unwrap())).unwrap()
}
#[test]
fn live_concave_cut_uses_rule_six_normalizes_and_reenters() {
    let a=Solid::Planar(concave_l());
    let tool=Solid::Planar(cube([2.,8.,-1.],[4.,10.,7.]));
    let bodies=analytic::boolean(key(),1,&[a,tool]).unwrap();
    assert_eq!(bodies.len(),1);
    let b=&bodies[0];
    assert_eq!((b.faces.len(),b.edges.len(),b.vertices.len()),(12,30,20),
        "AC79 canonical boundary; an unmerged split must fail");
    let solid=analytic::audit(&check(b)).unwrap();
    assert!(matches!(&solid,Solid::Model(_, _)));
    let Solid::Model(p,_) = &solid else { unreachable!() };
    assert_eq!(p.topology().genus,1);
    assert_eq!(p.volume_mm3().unwrap(),1344e9);
    let mesh=wonky_ops::mesh::tessellate(&check(b),1e-8).unwrap();
    wonky_ops::mesh::check_watertight(&mesh).unwrap();
    let again=analytic::boolean(key(),1,&[solid,Solid::Planar(cube([2.,12.,-1.],[4.,14.,7.]))]).unwrap();
    let next=polyhedron::audit(&check(&again[0])).unwrap();
    assert_eq!(next.volume_mm3().unwrap(),1320e9);
    assert_eq!(next.topology().genus,2);
}
#[test]
fn live_disjoint_outputs_are_replay_owned_and_tampered_selection_refuses() {
    use wonky_ops::{affine::Affine, extrude::{blind_prism, Prism}};
    use wonky_num::p2;
    let segments=[[-2.,0.,0.,-2.],[0.,-2.,2.,0.],[2.,0.,0.,2.],[0.,2.,-2.,0.]];
    let region=wonky_sketch::region::lines_region(&segments.iter().map(|s|[p2(s[0],s[1]),p2(s[2],s[3])]).collect::<Vec<_>>()).unwrap();
    let diamond=polyhedron::audit(&check(&blind_prism(&Prism {key:key(),source:[0;4],frame:Affine::IDENTITY,
        segments:&segments,region:&region.loops[0],depth:2.,reverse:false}).unwrap())).unwrap();
    let operands=[Solid::Planar(diamond),Solid::Planar(cube([3.,0.,0.],[5.,2.,2.]))];
    let bodies=analytic::boolean(key(),0,&operands).unwrap();
    assert_eq!(bodies.len(),2);
    let volumes: Vec<_> = bodies.iter().map(|b|polyhedron::audit(&check(b)).unwrap().volume_mm3().unwrap()).collect();
    assert_eq!(volumes, vec![16e9,8e9]);
    for b in &bodies {
        assert_eq!(b.solids.len(),1);
        assert!(matches!(analytic::audit(&check(b)).unwrap(),Solid::Model(_, _)));
        let mut changed=b.clone();
        let root=changed.constructions.iter().position(|n|n.parameters.len()==3 && n.parameters[1].get()==-6.).unwrap();
        changed.constructions[root].parameters[2]=Binary64::new(99.).unwrap();
        assert_eq!(analytic::audit(&check(&changed)).unwrap_err().0,"boolean/contract-violation:solid-selection");
    }
}
