//! Hand derivations below refer to frozen CAD-Acid input constructions, before
//! blending. These are construction tests, not claims of new blend geometry.
use wonky_blend::*;
use wonky_contract::{Body, BodyKey};
use wonky_geom::frame::Frame;
use wonky_geom::model::*;
use wonky_geom::{cross, sub, Q};
use wonky_ops::{
    analytic::{self, Solid},
    orthogonal,
};
fn q(n: i64) -> Q {
    Q::from_integer(n.into())
}
fn request() -> Request {
    Request {
        section: Section::Fillet { radius: q(4) },
        tangent_propagation: true,
    }
}
fn key() -> BodyKey {
    BodyKey {
        id: [1, 2, 3, 4],
        revision: 0,
    }
}
fn solid(body: Body) -> Solid {
    let words = wonky_wire::v3::encode(&body).unwrap();
    analytic::audit(&wonky_wire::v3::decode(&words).unwrap()).unwrap()
}
fn cube(hi: [f64; 3]) -> Model {
    solid(orthogonal::cuboid(key(), [0.; 3], hi).unwrap())
        .model()
        .unwrap()
}
fn edge(m: &Model, a: [f64; 3], b: [f64; 3]) -> EdgeId {
    let a = VertexDef::Input(a).key().unwrap();
    let b = VertexDef::Input(b).key().unwrap();
    m.draft()
        .edges
        .iter()
        .enumerate()
        .find_map(|(i, e)| match e.bounds {
            Bounds::Segment([x, y])
                if (m.key(x) == &a && m.key(y) == &b) || (m.key(x) == &b && m.key(y) == &a) =>
            {
                Some(EdgeId(i as u32))
            }
            _ => None,
        })
        .expect("hand-derived edge exists")
}
fn summary(g: &Graph) -> Vec<(usize, usize, EndCondition)> {
    let mut out: Vec<_> = g
        .vertices
        .iter()
        .map(|v| (v.selected_degree, v.body_degree, v.end.condition))
        .collect();
    out.sort_by_key(|x| (x.0, x.1));
    out
}
#[test]
fn ac29_and_ac30_initial_stripes_from_existing_adapter() {
    // AC29: box 16x12x8, selected (16,12,z). One convex right stripe;
    // two cap vertices, each with s=1 and b=3, cap normals parallel to z.
    // AC30 first: box 16^3, selected (0,0,z), same graph. Its second
    // input already has a cylinder: unavailable until the G8 Model adapter.
    for (hi, a, b) in [
        ([16., 12., 8.], [16., 12., 0.], [16., 12., 8.]),
        ([16.; 3], [0., 0., 0.], [0., 0., 16.]),
    ] {
        let m = cube(hi);
        let e = edge(&m, a, b);
        let before = m.canonical();
        let g = stripes(&m, &[e, e], request()).unwrap();
        assert_eq!(g.edges.len(), 1);
        assert_eq!(
            g.stripes,
            vec![Stripe {
                edges: vec![e],
                closed: false
            }]
        );
        assert_eq!(g.edges[0].convexity, Convexity::Convex);
        assert_eq!(g.edges[0].dihedral, Dihedral::Right);
        assert_eq!(summary(&g), vec![(1, 3, EndCondition::PerpendicularCap); 2]);
        assert_eq!(before, m.canonical(), "admission changes no geometry");
    }
}
#[test]
fn ac34_three_corner_stripes_from_existing_adapter() {
    // Three coordinate edges at the origin of the 16^3 box share one
    // (s,b)=(3,3) vertex. Other endpoints are three (1,3) caps. None of
    // the coordinate directions are tangent: three separate stripes.
    let m = cube([16.; 3]);
    let es = [
        edge(&m, [0.; 3], [16., 0., 0.]),
        edge(&m, [0.; 3], [0., 16., 0.]),
        edge(&m, [0.; 3], [0., 0., 16.]),
    ];
    let g = stripes(&m, &es, request()).unwrap();
    assert_eq!(g.stripes.len(), 3);
    assert_eq!(
        summary(&g),
        vec![
            (1, 3, EndCondition::PerpendicularCap),
            (1, 3, EndCondition::PerpendicularCap),
            (1, 3, EndCondition::PerpendicularCap),
            (3, 3, EndCondition::SphereCorner)
        ]
    );
    assert!(g
        .edges
        .iter()
        .all(|e| e.convexity == Convexity::Convex && e.dihedral == Dihedral::Right));
    let corner = g.vertices.iter().find(|v| v.selected_degree == 3).unwrap();
    assert_eq!(corner.end.setback, Setback::Radius(q(4)));
}
#[test]
fn ac77_union_seam_from_existing_adapter() {
    // AC77 union: foot [0,24]x[0,16]x[0,6], upright
    // [0,6]x[0,16]x[6,22]. Their merged L has six outline corners;
    // selected reentrant (6,y,6) is one concave reflex stripe. Ends
    // are on y caps and have (1,3), despite being the concave dual.
    let a = solid(orthogonal::cuboid(key(), [0.; 3], [24., 16., 6.]).unwrap());
    let b = solid(orthogonal::cuboid(key(), [0., 0., 6.], [6., 16., 22.]).unwrap());
    let bodies = analytic::boolean(key(), 0, &[a, b]).unwrap();
    assert_eq!(bodies.len(), 1);
    let m = solid(bodies.into_iter().next().unwrap()).model().unwrap();
    let e = edge(&m, [6., 0., 6.], [6., 16., 6.]);
    let g = stripes(&m, &[e], request()).unwrap();
    assert_eq!(g.edges[0].convexity, Convexity::Concave);
    assert_eq!(g.edges[0].dihedral, Dihedral::Reflex);
    assert_eq!(
        g.stripes,
        vec![Stripe {
            edges: vec![e],
            closed: false
        }]
    );
    assert_eq!(summary(&g), vec![(1, 3, EndCondition::PerpendicularCap); 2]);
}
// Generic polygon extrusion directly into exact construction data. Keeping
// collinear vertices gives a real G1 seam and a real tangent edge chain;
// it does not bypass Model auditing or inject a caller-supplied tangency.
fn prism(poly: &[[f64; 2]]) -> Model {
    let mut faces = Vec::new();
    let vertex = |p: [f64; 2], z: f64| VertexDef::Input([p[0], p[1], z]);
    let point = |v: &VertexDef| v.key().unwrap().rational().unwrap().clone();
    let mut add = |cycle: Vec<VertexDef>| {
        let o = point(&cycle[0]);
        let x = sub(&point(&cycle[1]), &o);
        let mut n = None;
        for v in cycle.iter().skip(2) {
            let c = cross(&x, &sub(&point(v), &o));
            if c.iter().any(|x| x != &q(0)) {
                n = Some(c);
                break;
            }
        }
        faces.push(PolyFace {
            carrier: Plane3 {
                o,
                x,
                n: n.unwrap(),
            },
            forward: true,
            loops: vec![cycle],
            provenance: Provenance {
                node: 1,
                slot: faces.len() as u32,
            },
        });
    };
    add(poly.iter().rev().map(|p| vertex(*p, 0.)).collect());
    add(poly.iter().map(|p| vertex(*p, 2.)).collect());
    for i in 0..poly.len() {
        let (a, b) = (poly[i], poly[(i + 1) % poly.len()]);
        add(vec![
            vertex(a, 0.),
            vertex(b, 0.),
            vertex(b, 2.),
            vertex(a, 2.),
        ]);
    }
    polyhedron(Frame::identity(), Label::Exact, 2, faces)
        .unwrap()
        .check()
        .unwrap()
}
fn split_prism() -> Model {
    prism(&[[0., 0.], [1., 0.], [2., 0.], [2., 2.], [0., 2.]])
}
#[test]
fn selected_g1_seam_refuses_and_carries_source_facts() {
    let m = split_prism();
    let e = edge(&m, [1., 0., 0.], [1., 0., 2.]);
    let fact = m.face_tangency(e).unwrap().unwrap();
    assert_eq!(fact.edge, e);
    assert_eq!(
        fact.provenance,
        fact.supports.map(|f| m.draft().faces[f.index()].provenance)
    );
    assert_eq!(
        stripes(&m, &[e], request()).unwrap_err().0,
        "blend/tangent-edge"
    );
}
#[test]
fn propagation_adds_unselected_tangent_partners_and_stops_at_sharp_corners() {
    let m = split_prism();
    let a = edge(&m, [0., 0., 2.], [1., 0., 2.]);
    let b = edge(&m, [1., 0., 2.], [2., 0., 2.]);
    let before = m.canonical();
    let g = stripes(&m, &[a], request()).unwrap();
    assert_eq!(g.added_edges, vec![b]);
    let explicit = stripes(&m, &[b, a, a], request()).unwrap();
    assert!(explicit.added_edges.is_empty());
    assert_eq!(g.edges, explicit.edges);
    assert_eq!(g.stripes, explicit.stripes);
    assert_eq!(g.vertices, explicit.vertices);
    assert_eq!(before, m.canonical());
    let mut es = vec![a, b];
    es.sort();
    assert_eq!(
        g.stripes,
        vec![Stripe {
            edges: es,
            closed: false
        }]
    );
    assert_eq!(
        summary(&g),
        vec![
            (1, 3, EndCondition::PerpendicularCap),
            (1, 3, EndCondition::PerpendicularCap),
            (2, 3, EndCondition::TangentJunction)
        ]
    );
    let mut r = request();
    r.tangent_propagation = false;
    let single = stripes(&m, &[a], r).unwrap();
    assert_eq!(single.edges.len(), 1);
    assert_eq!(single.stripes[0].edges, vec![a]);
    assert!(single.added_edges.is_empty());
    // At the split point only a is selected: (s,b)=(1,3). The third
    // support is the continuation's side plane, whose normal is not
    // parallel to a. The ordinary end-table row therefore gives an oblique
    // cap, not the two-selected-edge tangent junction used above.
    let split = single.vertices.iter().find(|v| {
        m.key(v.vertex) == &VertexDef::Input([1., 0., 2.]).key().unwrap()
    }).unwrap();
    assert_eq!((split.selected_degree, split.body_degree), (1, 3));
    assert_eq!(split.end.condition, EndCondition::ObliqueCap);
    assert_eq!(split.end.setback, Setback::Zero);
}
#[test]
fn tiny_kink_is_not_tangency() {
    let m = prism(&[
        [0., 0.],
        [1., -f64::from_bits(0x3cb0000000000000)],
        [2., 0.],
        [2., 2.],
        [0., 2.],
    ]);
    let a = edge(
        &m,
        [0., 0., 2.],
        [1., -f64::from_bits(0x3cb0000000000000), 2.],
    );
    let g = stripes(&m, &[a], request()).unwrap();
    assert_eq!(
        g.edges.len(),
        1,
        "exact nonzero kink must not add a chain partner"
    );
}
#[test]
fn propagation_is_transitive_and_deterministic() {
    let m = prism(&[[0., 0.], [1., 0.], [2., 0.], [3., 0.], [3., 2.], [0., 2.]]);
    let es: Vec<_> = (0..3)
        .map(|i| edge(&m, [i as f64, 0., 2.], [(i + 1) as f64, 0., 2.]))
        .collect();
    let mut expected = es.clone();
    expected.sort();
    for &seed in &es {
        let g = stripes(&m, &[seed, seed], request()).unwrap();
        assert_eq!(g.stripes[0].edges, expected);
        assert_eq!(
            g.added_edges,
            expected
                .iter()
                .copied()
                .filter(|e| *e != seed)
                .collect::<Vec<_>>()
        );
    }
}
#[test]
fn one_ulp_direction_difference_is_not_propagated() {
    let next = f64::from_bits(1.0f64.to_bits() + 1);
    // Adjacent directions (1,1) and (1,next) differ in one component by one ulp.
    let m = prism(&[[0., -1.], [1., 0.], [2., next], [2., 3.], [0., 3.]]);
    let a = edge(&m, [0., -1., 2.], [1., 0., 2.]);
    let b = edge(&m, [1., 0., 2.], [2., next, 2.]);
    let v = match m.draft().edges[a.index()].bounds {
        Bounds::Segment(vs) => *vs
            .iter()
            .find(|&&v| m.key(v) == &VertexDef::Input([1., 0., 2.]).key().unwrap())
            .unwrap(),
        _ => unreachable!(),
    };
    assert!(m.edge_tangency(v, [a, b]).unwrap().is_none());
    let g = stripes(&m, &[a], request()).unwrap();
    assert_eq!(g.stripes[0].edges, vec![a]);
    assert!(g.added_edges.is_empty());
}
#[test]
fn source_metric_controls_dihedral_and_cap_under_affine_placement() {
    let m = cube([2.; 3]);
    let e = edge(&m, [2., 2., 0.], [2., 2., 2.]);
    let mut d = m.into_draft();
    d.placement = Frame::new(
        [q(0), q(0), q(0)],
        [[q(1), q(0), q(0)], [q(1), q(1), q(0)], [q(0), q(0), q(1)]],
    )
    .unwrap();
    let m = d.check().unwrap();
    let g = stripes(&m, &[e], request()).unwrap();
    assert_eq!(g.edges[0].convexity, Convexity::Convex);
    assert_eq!(g.edges[0].dihedral, Dihedral::Acute);
    let mut d = m.into_draft();
    d.placement = Frame::new(
        [q(0), q(0), q(0)],
        [[q(1), q(0), q(0)], [q(0), q(1), q(0)], [q(1), q(0), q(1)]],
    )
    .unwrap();
    let g = stripes(&d.check().unwrap(), &[e], request()).unwrap();
    assert_eq!(summary(&g), vec![(1, 3, EndCondition::ObliqueCap); 2]);
}
#[test]
fn split_ring_requires_a_closed_carrier_and_cannot_be_faked_with_lines() {
    // A split closed carrier is not representable in the current Model:
    // only lines exist, and every ring-on-line is rejected at G4. A
    // two-edge circle seam negative requires G8 (not a polygon substitute).
    let mut d = cube([2.; 3]).into_draft();
    d.edges[0].bounds = Bounds::Ring;
    d.edges[1].bounds = Bounds::Ring;
    // Give the planted rings closed pcurve bounds so G3 does not mask
    // the intended G4 closed-carrier assertion.
    for co in &mut d.coedges {
        if co.edge == EdgeId(0) || co.edge == EdgeId(1) {
            let p = co.pcurve.ends()[0].clone();
            co.pcurve =
                wonky_curve::Trimmed::new([p.clone(), p], wonky_curve::Carrier::Line).unwrap();
        }
    }
    assert_eq!(d.check().unwrap_err().0, "model/g4-ring-on-open-curve");
}
#[test]
fn end_table_and_setbacks() {
    let f = Section::Fillet { radius: q(2) };
    let c = Section::EqualOffsets { width: q(3) };
    let classify = |s, b, cap, junction, conv: Vec<Convexity>, sections: Vec<Section>| {
        end_condition(s, b, cap, junction, &conv, &sections)
    };
    assert_eq!(
        classify(
            2,
            3,
            Cap::Perpendicular,
            Junction::Ordinary,
            vec![Convexity::Convex; 2],
            vec![c.clone(); 2]
        )
        .unwrap(),
        End {
            condition: EndCondition::ChamferMitre,
            setback: Setback::Zero
        }
    );
    assert_eq!(
        classify(
            2,
            3,
            Cap::Perpendicular,
            Junction::Ordinary,
            vec![Convexity::Convex; 2],
            vec![f.clone(); 2]
        )
        .unwrap()
        .condition,
        EndCondition::EqualFilletMitre
    );
    assert_eq!(
        classify(
            2,
            3,
            Cap::Perpendicular,
            Junction::Ordinary,
            vec![Convexity::Convex; 2],
            vec![f.clone(), Section::Fillet { radius: q(3) }]
        )
        .unwrap_err()
        .0,
        "blend/setback-mitre-unprobed"
    );
    assert_eq!(
        classify(
            3,
            3,
            Cap::Perpendicular,
            Junction::Ordinary,
            vec![Convexity::Convex; 3],
            vec![c.clone(); 3]
        )
        .unwrap()
        .setback,
        Setback::ChamferPoints(vec![[q(3), q(3)]; 3])
    );
    assert_eq!(
        classify(
            3,
            3,
            Cap::Perpendicular,
            Junction::Ordinary,
            vec![Convexity::Convex, Convexity::Convex, Convexity::Concave],
            vec![f.clone(); 3]
        )
        .unwrap()
        .condition,
        EndCondition::MixedConvexityCorner
    );
    assert_eq!(
        classify(
            4,
            4,
            Cap::Perpendicular,
            Junction::Ordinary,
            vec![Convexity::Convex; 4],
            vec![f.clone(); 4]
        )
        .unwrap_err()
        .0,
        "blend/vertex-network-unsupported:degree"
    );
    for (cap, expected) in [
        (Cap::Oblique, EndCondition::ObliqueCap),
        (Cap::Curved, EndCondition::CurvedCap),
    ] {
        assert_eq!(
            classify(
                1,
                3,
                cap,
                Junction::Ordinary,
                vec![Convexity::Concave],
                vec![f.clone()]
            )
            .unwrap()
            .condition,
            expected
        );
    }
    assert_eq!(
        classify(
            2,
            3,
            Cap::Perpendicular,
            Junction::ChamferCone,
            vec![Convexity::Convex; 2],
            vec![c.clone(); 2]
        )
        .unwrap()
        .condition,
        EndCondition::ChamferConeMitre
    );
    assert_eq!(
        classify(
            1,
            3,
            Cap::Perpendicular,
            Junction::Consumed,
            vec![Convexity::Convex],
            vec![f.clone()]
        )
        .unwrap()
        .condition,
        EndCondition::ConsumedEdge
    );
    assert_eq!(
        classify(
            2,
            3,
            Cap::Perpendicular,
            Junction::Extended,
            vec![Convexity::Convex; 2],
            vec![f; 2]
        )
        .unwrap_err()
        .0,
        "blend/extended-mitre-not-implemented"
    );
    let two = Section::TwoOffsets {
        first: q(2),
        second: q(5),
        opposite_direction: true,
    };
    assert_eq!(two.support_distances(), [q(5), q(2)]);
    assert_eq!(
        Unsupported::VariableRadius.refusal().0,
        "blend/variable-radius-unsupported"
    );
    assert_eq!(
        Unsupported::OffsetAngle.refusal().0,
        "chamfer/offset-angle-transcendental"
    );
}
#[test]
fn bad_selection_and_size_are_named_refusals() {
    let m = cube([2.; 3]);
    assert_eq!(
        stripes(&m, &[], request()).unwrap_err().0,
        "blend/empty-selection"
    );
    assert_eq!(
        stripes(&m, &[EdgeId(u32::MAX)], request()).unwrap_err().0,
        "model/edge-reference"
    );
    let r = Request {
        section: Section::Fillet { radius: q(0) },
        tangent_propagation: true,
    };
    assert_eq!(
        stripes(&m, &[EdgeId(0)], r).unwrap_err().0,
        "blend/invalid-size"
    );
}

// Main introduced audited curved Models; F0 planar admission must refuse
// them rather than interpret a circular edge as a straight chord.
#[test]
fn curved_model_supports_are_named_refusals() {
    let m = revolution::revolution(
        Frame::identity(), Frame::identity(),
        &[[q(0), q(0)], [q(2), q(0)], [q(2), q(10)], [q(0), q(10)]], 1,
    ).unwrap().check().unwrap();
    let curved = m.draft().faces.iter().position(|f|
        matches!(m.draft().surfaces[f.surface.index()].carrier, Carrier3::Cylinder(_))
    ).unwrap();
    assert_eq!(m.outward_normal(FaceId(curved as u32)).unwrap_err().0,
        "boolean/ssi-row-unavailable:curved/planar-consumer");
    assert_eq!(stripes(&m, &[EdgeId(0)], request()).unwrap_err().0,
        "boolean/ssi-row-unavailable:curved/planar-consumer");
}
