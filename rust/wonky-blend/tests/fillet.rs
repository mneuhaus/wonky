//! Dark exact geometry tests; these do not claim live CAD-Acid flips or WC0
//! admission. Frozen source geometries are reconstructed from their inputs.
use num_traits::{One, Zero};
use wonky_blend::{
    fillet::{self, Boundary, Carrier},
    Request, Section,
};
use wonky_contract::{Body, BodyKey};
use wonky_curve::radical::Radical;
use wonky_geom::{cross, dot, frame::Frame, model::*, sub, Point, Q};
use wonky_ops::{analytic, orthogonal};
fn q(n: i64) -> Q {
    Q::from_integer(n.into())
}
fn rq(n: i64) -> Radical {
    Radical::from(q(n))
}
fn key() -> BodyKey {
    BodyKey {
        id: [1, 2, 3, 4],
        revision: 0,
    }
}
fn model(b: Body) -> Model {
    analytic::audit(&b.check().unwrap())
        .unwrap()
        .model()
        .unwrap()
}
fn cube(hi: [f64; 3]) -> Model {
    model(orthogonal::cuboid(key(), [0.; 3], hi).unwrap())
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
        .unwrap()
}
fn run(m: &Model, es: &[EdgeId], radius: Q) -> Boundary {
    fillet::plane_plane(
        m,
        es,
        Request {
            section: Section::Fillet { radius },
            tangent_propagation: true,
        },
        true,
    )
    .unwrap()
}
fn parallel(m: &Model, axis: usize) -> Vec<EdgeId> {
    m.draft()
        .edges
        .iter()
        .enumerate()
        .filter_map(|(i, e)| match e.bounds {
            Bounds::Segment([a, b]) => {
                let t = sub(m.key(b).rational().unwrap(), m.key(a).rational().unwrap());
                ((0..3).all(|k| k == axis || t[k].is_zero())).then_some(EdgeId(i as u32))
            }
            Bounds::Ring => None,
        })
        .collect()
}
fn polyface(lp: Vec<Point>, slot: u32) -> PolyFace {
    let mut n = [q(0), q(0), q(0)];
    for i in 0..lp.len() {
        let area = cross(&lp[i], &lp[(i + 1) % lp.len()]);
        for k in 0..3 {
            n[k] += &area[k];
        }
    }
    PolyFace {
        carrier: Plane3 {
            o: lp[0].clone(),
            x: sub(&lp[1], &lp[0]),
            n,
        },
        forward: true,
        loops: vec![lp.into_iter().map(VertexDef::Rational).collect()],
        provenance: Provenance { node: 0, slot },
    }
}
fn prism(poly: Vec<[Q; 2]>) -> Model {
    let lo: Vec<Point> = poly
        .iter()
        .map(|p| [p[0].clone(), p[1].clone(), q(0)])
        .collect();
    let hi: Vec<Point> = poly
        .iter()
        .map(|p| [p[0].clone(), p[1].clone(), q(20)])
        .collect();
    let mut bottom = lo.clone();
    bottom.reverse();
    let mut fs = vec![polyface(bottom, 0), polyface(hi.clone(), 1)];
    for i in 0..lo.len() {
        let j = (i + 1) % lo.len();
        fs.push(polyface(
            vec![lo[i].clone(), lo[j].clone(), hi[j].clone(), hi[i].clone()],
            (i + 2) as u32,
        ));
    }
    polyhedron(Frame::identity(), Label::Exact, 0, fs)
        .unwrap()
        .check()
        .unwrap()
}
#[test]
fn ac29_and_axis_permutations_have_single_unsplit_cylinder() {
    for axis in 0..3 {
        let m = cube([16., 12., 8.]);
        let mut a = [16., 12., 8.];
        let mut b = a;
        a[axis] = 0.;
        b[axis] = [16., 12., 8.][axis];
        let before = m.canonical();
        let e = edge(&m, a, b);
        let out = run(&m, &[e, e], q(2));
        assert_eq!(out.counts(), (10, 15, 7));
        assert_eq!(out.stripes.len(), 1);
        assert_eq!(
            out.faces
                .iter()
                .filter(|f| matches!(f.carrier, Carrier::Cylinder { .. }))
                .count(),
            1
        );
        assert_eq!(
            out.faces
                .iter()
                .flat_map(|f| &f.loops)
                .flatten()
                .filter(|p| p.arc.is_some())
                .count(),
            4
        );
        out.check().unwrap();
        assert_eq!(m.canonical(), before);
    }
}
#[test]
fn ac81_metre_inputs_keep_non_binary64_spring_coordinates() {
    let m = cube([0.06, 0.04, 0.03]);
    let e = edge(&m, [0.06, 0.04, 0.], [0.06, 0.04, 0.03]);
    let r = wonky_geom::binary64(0.004).unwrap();
    let out = run(&m, &[e], r.clone());
    let expected = wonky_geom::binary64(0.04).unwrap() - r;
    let rounded = wonky_geom::binary64(0.04 - 0.004).unwrap();
    assert_ne!(expected, rounded);
    assert!(out.stripes[0]
        .springs
        .iter()
        .flatten()
        .any(|p| p[1].rational() == Some(expected.clone())));
    assert_eq!(out.counts(), (10, 15, 7));
}
#[test]
fn ac30_critical_radius_consumes_faces_by_exact_equality() {
    let m = cube([16.; 3]);
    let es = parallel(&m, 2);
    let out = run(&m, &es, q(8));
    assert_eq!(out.counts(), (8, 12, 6));
    assert_eq!(
        out.faces
            .iter()
            .filter(|f| matches!(f.carrier, Carrier::Plane { .. }))
            .count(),
        2
    );
    assert_eq!(
        out.faces
            .iter()
            .filter(|f| matches!(f.carrier, Carrier::Cylinder { .. }))
            .count(),
        4
    );
    out.check().unwrap();
    let near = q(8) - Q::new(1.into(), 2_000_000_000i64.into());
    let exact = run(&m, &es, near);
    assert_eq!(exact.counts(), (16, 24, 10));
    // A weakened copy welds sub-nanometre spring endpoints. This must fail
    // the same incidence/sewing validation that the valid boundary passed.
    let mut weak = exact.clone();
    let old = weak
        .faces
        .iter()
        .flat_map(|f| &f.loops)
        .flatten()
        .find(|p| {
            p.arc.is_none() && p.start != p.end && {
                let d: [Radical; 3] = std::array::from_fn(|i| &p.start[i] - &p.end[i]);
                let d2 = (0..3).fold(Radical::default(), |s, i| s + &d[i] * &d[i]);
                d2 <= Radical::from(Q::new(1.into(), 1_000_000_000_000_000_000i64.into()))
            }
        })
        .unwrap()
        .clone();
    for p in weak.faces.iter_mut().flat_map(|f| &mut f.loops).flatten() {
        if p.start == old.end {
            p.start = old.start.clone();
        }
        if p.end == old.end {
            p.end = old.start.clone();
        }
    }
    assert!(weak.check().is_err());
}
#[test]
fn ac30_unequal_radii_shadow_existing_family_exactly() {
    let body = orthogonal::cuboid(key(), [0.; 3], [16.; 3]).unwrap();
    let m = model(body.clone());
    let first = edge(&m, [0., 0., 0.], [0., 0., 16.]);
    let second = edge(&m, [16., 0., 0.], [16., 0., 16.]);
    let out = fillet::plane_plane_radii(&m, &[(first, q(4)), (second, q(12))], true).unwrap();
    assert_eq!(out.counts(), (10, 15, 7));
    let (lo, hi) = out.delta_volume_enclosure().unwrap();
    let expected = -16. * (160. - 40. * std::f64::consts::PI);
    assert!(
        lo <= expected && expected <= hi,
        "{lo} <= {expected} <= {hi}"
    );
    assert!(hi - lo < 1e-10);
    let find = |b: &Body, x: f64| -> usize {
        b.edges
            .iter()
            .position(|e| {
                e.vertices.len() == 2
                    && e.vertices.iter().all(|v| {
                        let p = b.vertices[v.0 as usize].point;
                        p[0].get() == x && p[1].get() == 0.
                    })
            })
            .unwrap()
    };
    let a = wonky_ops::polyhedron::audit(&body.check().unwrap()).unwrap();
    let e = find(&a.body, 0.);
    let rounded = wonky_ops::fillet::constant_radius(&a, &[e], 4.).unwrap();
    let a = wonky_ops::polyhedron::audit(&rounded.check().unwrap()).unwrap();
    let e = find(&a.body, 16.);
    let legacy = wonky_ops::fillet::constant_radius(&a, &[e], 12.).unwrap();
    assert_eq!(
        out.counts(),
        (
            legacy.vertices.len(),
            legacy.edges.len(),
            legacy.faces.len()
        )
    );
    let exact_vertices = out
        .faces
        .iter()
        .flat_map(|f| &f.loops)
        .flatten()
        .map(|p| p.start.clone())
        .collect::<std::collections::BTreeSet<_>>();
    let legacy_vertices = legacy
        .vertices
        .iter()
        .map(|v| {
            v.point
                .map(|x| Radical::from(wonky_geom::binary64(x.get()).unwrap()))
        })
        .collect::<std::collections::BTreeSet<_>>();
    assert_eq!(exact_vertices, legacy_vertices);
    // AC30 near consumption: the first round's spring is an existing face
    // vertex for the second call. An epsilon weld of the new spring onto it
    // changes topology even though their separation is below 1e-9.
    let near = fillet::plane_plane_radii(
        &m,
        &[
            (first, q(4)),
            (second, q(12) - Q::new(1.into(), 2_000_000_000i64.into())),
        ],
        true,
    )
    .unwrap();
    assert_eq!(near.counts(), (12, 18, 8));
    let mut weak = near.clone();
    let p = [rq(4), rq(0), rq(0)];
    let new = [
        rq(4) + Radical::from(Q::new(1.into(), 2_000_000_000i64.into())),
        rq(0),
        rq(0),
    ];
    assert!(near
        .faces
        .iter()
        .flat_map(|f| &f.loops)
        .flatten()
        .any(|e| e.start == new));
    for e in weak.faces.iter_mut().flat_map(|f| &mut f.loops).flatten() {
        if e.start == new {
            e.start = p.clone();
        }
        if e.end == new {
            e.end = p.clone();
        }
    }
    assert!(weak.check().is_err());
}
#[test]
fn ac29_chart_seam_as_a_topology_split_changes_edge_count() {
    let m = cube([16., 12., 8.]);
    let e = edge(&m, [16., 12., 0.], [16., 12., 8.]);
    let exact = run(&m, &[e], q(4));
    assert_eq!(exact.counts(), (10, 15, 7));
    let mut weak = exact.clone();
    // Insert the positive 3-4-5 radial direction inside both cap arcs. A
    // real chart transition has no topological vertex; this mutant does.
    let stripe = &exact.stripes[0];
    let endpoints = stripe.springs[0].clone();
    let d0: [Radical; 3] = std::array::from_fn(|i| &endpoints[0][i] - &stripe.centers[0][i]);
    let d1: [Radical; 3] = std::array::from_fn(|i| &endpoints[1][i] - &stripe.centers[0][i]);
    let radial: [Radical; 3] = std::array::from_fn(|i| {
        &d0[i] * Radical::from(Q::new(3.into(), 5.into()))
            + &d1[i] * Radical::from(Q::new(4.into(), 5.into()))
    });
    for lp in weak.faces.iter_mut().flat_map(|f| &mut f.loops) {
        let old = lp.clone();
        lp.clear();
        for piece in old {
            if let Some(arc) = &piece.arc {
                let point: [Radical; 3] = std::array::from_fn(|i| &arc.center[i] + &radial[i]);
                let mut a = piece.clone();
                a.end = point.clone();
                let mut b = piece;
                b.start = point;
                lp.extend([a, b]);
            } else {
                lp.push(piece);
            }
        }
    }
    weak.check().unwrap();
    assert_eq!(weak.counts(), (12, 17, 7));
    assert_ne!(weak.counts(), exact.counts());
}
#[test]
fn overflow_names_the_exact_available_width_for_both_flags() {
    let m = cube([16.; 3]);
    let es = parallel(&m, 2);
    for allow in [false, true] {
        let err = fillet::plane_plane(
            &m,
            &es,
            Request {
                section: Section::Fillet { radius: q(9) },
                tangent_propagation: false,
            },
            allow,
        )
        .unwrap_err();
        assert!(err.0.starts_with("blend/overflow:"), "{err}");
        assert!(
            err.0.contains("needs=")
                && err.0.contains("has=")
                && err.0.contains(&format!("allowEdgeOverflow={allow}")),
            "{err}"
        );
        // Compare actual rational values, not merely that an error occurred.
        assert!(err.0.contains("18") && err.0.contains("16"), "{err}");
    }
}
#[test]
fn concave_boolean_seam_and_riser_caps_are_local() {
    let a = orthogonal::cuboid(key(), [0.; 3], [30., 20., 6.]).unwrap();
    let b = orthogonal::cuboid(
        BodyKey {
            id: [5, 6, 7, 8],
            revision: 0,
        },
        [0.; 3],
        [6., 20., 30.],
    )
    .unwrap();
    let s = analytic::boolean(
        key(),
        0,
        &[
            analytic::audit(&a.check().unwrap()).unwrap(),
            analytic::audit(&b.check().unwrap()).unwrap(),
        ],
    )
    .unwrap();
    assert_eq!(s.len(), 1);
    let m = model(s[0].clone());
    let e = edge(&m, [6., 0., 6.], [6., 20., 6.]);
    let out = run(&m, &[e], q(2));
    assert_eq!(out.stripes[0].convexity, wonky_blend::Convexity::Concave);
    assert_eq!(out.counts(), (14, 21, 9));
    out.check().unwrap();
    assert_eq!(
        out.stripes[0]
            .centers
            .iter()
            .map(|p| [p[0].rational().unwrap(), p[2].rational().unwrap()])
            .collect::<Vec<_>>(),
        vec![[q(8), q(8)]; 2]
    );
}
#[test]
fn irrational_normal_constructs_radical_cylinder_and_spring_lines() {
    let m = prism(vec![[q(0), q(0)], [q(20), q(0)], [q(0), q(20)]]);
    let e = edge(&m, [20., 0., 0.], [20., 0., 20.]);
    let out = run(&m, &[e], q(1));
    assert_eq!(out.counts(), (8, 12, 6));
    assert!(out.stripes[0].centers[0]
        .iter()
        .any(|p| p.rational().is_none()));
    out.check().unwrap();
    // Both support feet have exact squared radius 1. Arithmetic mutation of
    // a radical to its rounded cache is detected at cylinder incidence.
    let mut weak = out.clone();
    weak.stripes[0].centers[0][0] = rq(18);
    let cylinder = weak
        .faces
        .iter_mut()
        .find(|f| matches!(f.carrier, Carrier::Cylinder { .. }))
        .unwrap();
    if let Carrier::Cylinder { origin, .. } = &mut cylinder.carrier {
        origin[0] = rq(18);
    }
    assert!(weak.check().is_err());
}
#[test]
fn acute_obtuse_and_reflex_dihedrals_use_offset_plane_intersection() {
    for poly in [
        vec![[q(0), q(0)], [q(30), q(0)], [q(10), q(10)]],
        vec![[q(0), q(0)], [q(30), q(0)], [q(40), q(10)], [q(0), q(10)]],
        vec![
            [q(0), q(0)],
            [q(30), q(0)],
            [q(30), q(30)],
            [q(20), q(30)],
            [q(10), q(10)],
            [q(0), q(10)],
        ],
    ] {
        let m = prism(poly);
        let es = parallel(&m, 2);
        for e in es {
            run(&m, &[e], q(1)).check().unwrap();
        }
    }
}
#[test]
fn oblique_three_plane_corner_uses_projection_not_radius() {
    // Binding erratum: material x>=0,y>=0,z>=x. Centre (1,1,1+sqrt2).
    let center = fillet::offset_plane_center(
        [
            ([q(-1), q(0), q(0)], q(0)),
            ([q(0), q(-1), q(0)], q(0)),
            ([q(1), q(0), q(-1)], q(0)),
        ],
        &q(1),
    )
    .unwrap();
    let foot =
        fillet::project_on_stripe(&center, &[q(0), q(0), q(0)], &[q(0), q(0), q(1)]).unwrap();
    let sqrt2 = Radical::quadratic(q(0), q(1), q(2)).unwrap();
    assert_eq!(foot, [rq(0), rq(0), rq(1) + sqrt2]);
    let weak = [rq(0), rq(0), rq(1)];
    assert_ne!(weak, foot);
    // The error is exact, not a tolerance claim. Difference is nonzero and
    // displacement to the weakened foot has a nonzero axial component.
    let delta: [Radical; 3] = std::array::from_fn(|i| &center[i] - &weak[i]);
    assert!(!delta[2].is_zero());
    assert_eq!(dot(&[q(0), q(0), q(-1)], &[q(0), q(0), q(1)]), -Q::one());
}

#[test]
fn remote_cap_notch_contact_refuses_even_when_adjacent_widths_fit() {
    let m = prism(vec![
        [q(0), q(0)],
        [q(20), q(0)],
        [q(20), q(20)],
        [q(5), q(20)],
        [q(5), q(1)],
        [q(1), q(1)],
        [q(1), q(20)],
        [q(0), q(20)],
    ]);
    let e = edge(&m, [0., 0., 0.], [0., 0., 20.]);
    for allow in [true, false] {
        let err = fillet::plane_plane(
            &m,
            &[e],
            Request {
                section: Section::Fillet { radius: q(4) },
                tangent_propagation: false,
            },
            allow,
        )
        .unwrap_err();
        assert!(err.0.starts_with("blend/overflow:face-"), "{err}");
        assert!(err.0.ends_with("/boundary-contact"), "{err}");
    }
    // Radius 1/4 avoids that same obstacle; the negative is non-vacuous.
    run(&m, &[e], Q::new(1.into(), 4.into())).check().unwrap();
}

#[test]
fn affine_source_metric_is_used_for_radius_and_caps() {
    let mut draft = cube([20.; 3]).into_draft();
    draft.placement = Frame::new(
        [q(17), q(23), q(5)],
        [[q(2), q(0), q(0)], [q(1), q(1), q(0)], [q(0), q(0), q(3)]],
    )
    .unwrap();
    let m = draft.check().unwrap();
    let e = edge(&m, [0., 0., 0.], [0., 0., 20.]);
    let out = run(&m, &[e], q(1));
    assert_eq!(out.counts(), (10, 15, 7));
    let stripe = &out.stripes[0];
    // The source edge's directed bounds run from the upper to lower cap.
    assert_eq!(stripe.axis, [q(0), q(0), q(-60)]);
    for p in &stripe.centers {
        assert!(p[0] >= rq(17) && p[1] >= rq(23));
    }
    assert!(stripe.centers[0].iter().any(|x| x.rational().is_none()));
    let (lo, hi) = out.delta_volume_enclosure().unwrap();
    assert!(lo < hi && hi < 0.);
    out.check().unwrap();
}
#[test]
fn mitres_oblique_caps_and_non_fillet_sections_refuse_without_geometry() {
    let m = cube([20.; 3]);
    let es = parallel(&m, 2);
    let invalid = fillet::plane_plane(
        &m,
        &es,
        Request {
            section: Section::EqualOffsets { width: q(1) },
            tangent_propagation: true,
        },
        true,
    )
    .unwrap_err();
    assert_eq!(invalid.0, "blend/fillet-section-required");
    let mut adjacent = vec![es[0]];
    let v = match m.draft().edges[es[0].index()].bounds {
        Bounds::Segment(v) => v[0],
        Bounds::Ring => unreachable!(),
    };
    adjacent.push(
        m.draft()
            .edges
            .iter()
            .enumerate()
            .find_map(|(i, e)| match e.bounds {
                Bounds::Segment(vs) if vs.contains(&v) && EdgeId(i as u32) != es[0] => {
                    Some(EdgeId(i as u32))
                }
                _ => None,
            })
            .unwrap(),
    );
    let err = fillet::plane_plane(
        &m,
        &adjacent,
        Request {
            section: Section::Fillet { radius: q(1) },
            tangent_propagation: false,
        },
        true,
    )
    .unwrap_err();
    assert_eq!(err.0, "blend/vertex-network-unsupported:EqualFilletMitre");
}

#[test]
fn fp03_fp04_consumption_is_exact_and_never_welded() {
    // FP03: r = both face widths; the two supports vanish (Onshape: 5 faces).
    let m = cube([10.; 3]);
    let ridge = edge(&m, [10., 10., 0.], [10., 10., 10.]);
    let out = run(&m, &[ridge], q(10));
    assert_eq!(out.faces.len(), 5);
    out.check().unwrap();
    // FP04: two r = 5 rounds meet on the consumed top face. The boundary keeps
    // two cylinders on one carrier; the extrusion merges them (Onshape: 6).
    let top = [
        edge(&m, [0., 0., 10.], [10., 0., 10.]),
        edge(&m, [0., 10., 10.], [10., 10., 10.]),
    ];
    let out = run(&m, &top, q(5));
    assert_eq!(out.faces.len(), 7);
    assert_eq!(
        out.faces
            .iter()
            .filter(|f| matches!(f.carrier, Carrier::Plane { .. }))
            .count(),
        5
    );
    // 1e-10 short of the width the spring stays a separate vertex 1e-10 from
    // the source corner: both supports survive as slivers. A weld of spring
    // vertices within 1e-9 would drop them and fail this count.
    let short = q(10) - Q::new(1.into(), 10_000_000_000i64.into());
    let out = run(&m, &[ridge], short);
    assert_eq!(out.faces.len(), 7);
    out.check().unwrap();
    let short = q(5) - Q::new(1.into(), 10_000_000_000i64.into());
    assert_eq!(run(&m, &top, short).faces.len(), 8);
}
