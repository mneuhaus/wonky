//! The P1 relation table on hand-made planes and boxes: the four classes, the
//! provenance route and its contract, and the frame relation.
use num_rational::BigRational as Q;
use wonky_bool::contract;
use wonky_bool::operand::WorkingPlane;
use wonky_bool::relation::{decide, mirror};
use wonky_bool::{intersect, Lineage, PlaneRelation, Proof};
use wonky_geom::frame::Frame;
use wonky_geom::model::{polyhedron, Label, Model, Plane3, PolyFace, Provenance, VertexDef};
use wonky_geom::{dot, Point};

fn q(n: i64) -> Q {
    Q::from_integer(n.into())
}
fn p(x: i64, y: i64, z: i64) -> Point {
    [q(x), q(y), q(z)]
}
fn plane(o: Point, n: Point) -> WorkingPlane {
    WorkingPlane { o, n }
}

#[test]
fn parallel_planes_are_identical_opposite_or_disjoint_with_the_exact_squared_gap() {
    let a = plane(p(0, 0, 3), p(0, 0, 2));
    assert_eq!(decide(&a, &plane(p(5, -1, 3), p(0, 0, 7))), PlaneRelation::Identical);
    assert_eq!(decide(&a, &plane(p(5, -1, 3), p(0, 0, -1))), PlaneRelation::Opposite);
    // A gap of 2^-30 above A, facing it.
    let tiny = Q::new(1.into(), (1u64 << 30).into());
    let b = plane([q(0), q(0), q(3) + &tiny], p(0, 0, -1));
    assert_eq!(
        decide(&a, &b),
        PlaneRelation::ParallelDisjoint { aligned: false, above: true, distance2: &tiny * &tiny }
    );
    assert_eq!(decide(&b, &a), mirror(&decide(&a, &b)));
    assert_eq!(decide(&b, &a), PlaneRelation::ParallelDisjoint { aligned: false, above: true, distance2: &tiny * &tiny });
    // An oblique normal: the plane x + y = 4 against x + y = 1, both along (1, 1, 0).
    let c = plane(p(4, 0, 0), p(1, 1, 0));
    let d = plane(p(0, 1, 9), p(3, 3, 0));
    assert_eq!(
        decide(&c, &d),
        PlaneRelation::ParallelDisjoint { aligned: true, above: false, distance2: Q::new(9.into(), 2.into()) }
    );
    assert_eq!(decide(&d, &c), mirror(&decide(&c, &d)));
}

#[test]
fn transverse_planes_meet_in_an_exact_line_on_both() {
    let a = plane(p(0, 0, 3), p(0, 0, 1));
    let b = plane(p(1, 0, 0), p(2, 1, 0));
    let PlaneRelation::Transverse { point, direction } = decide(&a, &b) else { panic!("transverse") };
    for w in [&a, &b] {
        assert_eq!(w.side(&point), q(0));
        assert_eq!(dot(&w.n, &direction), q(0));
    }
    assert_eq!(direction, p(-1, 2, 0));
    assert_eq!(decide(&b, &a), mirror(&decide(&a, &b)));
}

fn cube(lo: i64, hi: i64, frame: Frame, node: u32) -> Model {
    let (l, h) = (lo, hi);
    let faces: Vec<(Point, [Point; 4])> = vec![
        (p(0, 0, -1), [p(l, l, l), p(l, h, l), p(h, h, l), p(h, l, l)]),
        (p(0, 0, 1), [p(l, l, h), p(h, l, h), p(h, h, h), p(l, h, h)]),
        (p(0, -1, 0), [p(l, l, l), p(h, l, l), p(h, l, h), p(l, l, h)]),
        (p(0, 1, 0), [p(l, h, l), p(l, h, h), p(h, h, h), p(h, h, l)]),
        (p(-1, 0, 0), [p(l, l, l), p(l, l, h), p(l, h, h), p(l, h, l)]),
        (p(1, 0, 0), [p(h, l, l), p(h, h, l), p(h, h, h), p(h, l, h)]),
    ];
    let faces = faces
        .into_iter()
        .enumerate()
        .map(|(i, (n, c))| PolyFace {
            carrier: Plane3 { o: c[0].clone(), x: std::array::from_fn(|k| &c[1][k] - &c[0][k]), n },
            forward: true,
            loops: vec![c.into_iter().map(VertexDef::Rational).collect()],
            provenance: Provenance { node, slot: i as u32 },
        })
        .collect();
    polyhedron(frame, Label::Exact, node, faces).unwrap().check().unwrap()
}

#[test]
fn a_shared_lineage_proves_identical_carriers_by_provenance() {
    let a = cube(0, 1, Frame::identity(), 1);
    let ix = intersect(&a, &a, Lineage::Shared).unwrap();
    for (sa, sb, r) in ix.relations.iter() {
        if sa == sb {
            assert_eq!((&r.kind, r.proof), (&PlaneRelation::Identical, Proof::Provenance));
        } else {
            assert_eq!(r.proof, Proof::ExactData);
        }
    }
    // Separate lineages: the same carriers are identical by their exact data.
    let ix = intersect(&a, &a, Lineage::Separate).unwrap();
    assert!(ix.relations.iter().all(|(_, _, r)| r.proof == Proof::ExactData));
    assert!(ix.relations.iter().filter(|(_, _, r)| r.kind == PlaneRelation::Identical).count() == 6);
}

#[test]
fn provenance_that_the_exact_data_contradict_is_a_contract_violation() {
    // Same construction slots, different boxes: provenance claims identity
    // for the +x faces at x = 1 and x = 2.
    let a = cube(0, 1, Frame::identity(), 1);
    let b = cube(0, 2, Frame::identity(), 1);
    assert_eq!(intersect(&a, &b, Lineage::Shared).unwrap_err().0, contract::RELATION_PROVENANCE);
    assert!(intersect(&a, &b, Lineage::Separate).is_ok());
}

#[test]
fn provenance_proves_nothing_across_different_placements() {
    // A pattern copy: one construction, moved by 1 along x. Its carriers keep
    // their provenance but are other planes; nothing is proved by provenance.
    let a = cube(0, 1, Frame::identity(), 1);
    let moved = Frame::new(p(1, 0, 0), [p(1, 0, 0), p(0, 1, 0), p(0, 0, 1)]).unwrap();
    let b = cube(0, 1, moved, 1);
    let ix = intersect(&a, &b, Lineage::Shared).unwrap();
    assert!(ix.relations.iter().all(|(_, _, r)| r.proof == Proof::ExactData));
    // A's +x face (x = 1) and B's -x face (B's x = 0, placed at 1) touch.
    assert_eq!(ix.relations.get(wonky_geom::model::SurfaceId(5), wonky_geom::model::SurfaceId(4)).kind, PlaneRelation::Opposite);
    assert_eq!(ix.paves.vv.len(), 4);
}

#[test]
fn rebaked_pattern_carriers_do_not_collide_in_a_shared_lineage() {
    use wonky_bool::{boolean, Op};
    let a = cube(0, 1, Frame::identity(), 1);
    let moved = Frame::new(p(2, 0, 0), [p(1, 0, 0), p(0, 1, 0), p(0, 0, 1)]).unwrap();
    let b = cube(0, 1, moved, 1);
    let out = boolean(&a, &b, Op::Union, Lineage::Shared, 2).unwrap();
    assert_eq!(out.model.draft().solids.len(), 2);
    let ix = intersect(&out.model, &out.model, Lineage::Shared).unwrap();
    assert!(ix.relations.iter().any(|(_, _, r)| r.proof == Proof::Provenance));
    let shared = boolean(&out.model, &out.model, Op::Union, Lineage::Shared, 3).unwrap();
    let separate = boolean(&out.model, &out.model, Op::Union, Lineage::Separate, 3).unwrap();
    assert_eq!(shared.model.canonical(), out.model.canonical());
    assert_eq!(shared.model.canonical(), separate.model.canonical());
    let solids = out.solids().unwrap();
    assert_eq!(solids.len(), 2);
    macro_rules! check_slots {
        ($field:ident) => {{
            let combined: std::collections::BTreeSet<_> = out.model.draft().$field.iter().map(|e| e.provenance).collect();
            let extracted: Vec<_> = solids.iter().flat_map(|s| s.draft().$field.iter().map(|e| e.provenance)).collect();
            assert_eq!(extracted.len(), combined.len(), stringify!($field));
            assert_eq!(extracted.iter().copied().collect::<std::collections::BTreeSet<_>>(), combined, stringify!($field));
        }};
    }
    check_slots!(vertices); check_slots!(curves); check_slots!(edges);
    check_slots!(coedges); check_slots!(loops); check_slots!(faces);
    check_slots!(surfaces); check_slots!(shells); check_slots!(solids);
    // A set of slots alone cannot detect swapping provenance between entities.
    // Compare each entity's exact data and incidence through provenance, so
    // extraction-local topology indices do not obscure its identity.
    for solid in &solids {
        let combined = out.model.draft();
        let extracted = solid.draft();
        macro_rules! same_entity {
            ($field:ident, $data:expr) => {
                for entity in &extracted.$field {
                    let original = combined.$field.iter().find(|e| e.provenance == entity.provenance).unwrap();
                    assert_eq!(($data)(extracted, entity), ($data)(combined, original), stringify!($field));
                }
            };
        }
        use wonky_geom::model::*;
        same_entity!(vertices, |_: &Draft, v: &Vertex| match &v.def { VertexDef::Rational(p) => p.clone(), VertexDef::Input(p) => wonky_geom::point(*p).unwrap(), VertexDef::Quadratic(_) | VertexDef::Radical(_) | VertexDef::OnCurve(_) | VertexDef::Real(_) => panic!("expected rational test vertex") });
        same_entity!(curves, |_: &Draft, c: &Curve| c.geometry.clone());
        same_entity!(surfaces, |_: &Draft, s: &Surface| s.carrier.clone());
        same_entity!(edges, |d: &Draft, e: &Edge| {
            let ends = match e.bounds {
                Bounds::Segment(vs) => Some(vs.map(|v| d.vertices[v.index()].provenance)),
                Bounds::Ring => None,
            };
            (d.curves[e.curve.index()].provenance, ends)
        });
        same_entity!(coedges, |d: &Draft, c: &Coedge| (d.edges[c.edge.index()].provenance, c.forward, c.pcurve.key()));
        same_entity!(loops, |d: &Draft, l: &Loop| l.coedges.iter().map(|c| d.coedges[c.index()].provenance).collect::<Vec<_>>());
        same_entity!(faces, |d: &Draft, f: &Face| (d.surfaces[f.surface.index()].provenance, f.forward, f.loops.iter().map(|l| d.loops[l.index()].provenance).collect::<Vec<_>>()));
        same_entity!(shells, |d: &Draft, s: &Shell| s.faces.iter().map(|f| d.faces[f.index()].provenance).collect::<Vec<_>>());
        same_entity!(solids, |d: &Draft, s: &Solid| s.shells.iter().map(|s| d.shells[s.index()].provenance).collect::<Vec<_>>());
    }
    // Extracting a solid must retain the combined model's carrier slots:
    // separately extracted, disjoint solids must not claim shared planes.
    let ix = intersect(&solids[0], &solids[1], Lineage::Shared).unwrap();
    assert!(ix.relations.iter().all(|(_, _, r)| r.proof == Proof::ExactData));
    let rejoined = boolean(&solids[0], &solids[1], Op::Union, Lineage::Shared, 4).unwrap();
    assert_eq!(rejoined.model.canonical(), out.model.canonical());
    // Result and source may coexist in the same construction DAG.
    let with_source = boolean(&out.model, &a, Op::Union, Lineage::Shared, 5).unwrap();
    assert_eq!(with_source.model.canonical(), out.model.canonical());
}
