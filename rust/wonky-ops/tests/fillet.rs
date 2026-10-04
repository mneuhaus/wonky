//! Public operation contracts: exact rational segment-distance oracle (separate
//! arithmetic from production expansions) and no false overflow infeasibility.
use num_rational::BigRational as Q;
use num_traits::Zero;
use wonky_contract::BodyKey;
use wonky_ops::{
    affine::Affine,
    edge_query, fillet, orthogonal,
    polyhedron::{audit, Audited},
};
use wonky_oracle::binary64;

fn q(x: f64) -> Q {
    binary64(x).unwrap()
}
fn cube(frame: Affine) -> Audited {
    let body = orthogonal::cuboid(
        BodyKey {
            id: [1, 2, 3, 4],
            revision: 0,
        },
        [0.; 3],
        [1.; 3],
    )
    .unwrap();
    let body = audit(&body.check().unwrap()).unwrap();
    audit(
        &orthogonal::transform(&body, frame)
            .unwrap()
            .check()
            .unwrap(),
    )
    .unwrap()
}
fn world(body: &Audited, vertex: usize) -> [Q; 3] {
    let frame = body.frame.as_affine().unwrap();
    let p = body.body.vertices[vertex].point.map(|v| q(v.get()));
    let x = frame.x.map(q);
    let z = frame.z.map(q);
    let y: [Q; 3] = std::array::from_fn(|k| {
        &z[(k + 1) % 3] * &x[(k + 2) % 3] - &z[(k + 2) % 3] * &x[(k + 1) % 3]
    });
    std::array::from_fn(|k| q(frame.origin[k]) + &p[0] * &x[k] + &p[1] * &y[k] + &p[2] * &z[k])
}
fn squared(body: &Audited, edge: usize, point: [f64; 3]) -> Q {
    let [a, b] = [body.body.edges[edge].vertices[0], body.body.edges[edge].vertices[1]].map(|v| world(body, v.0 as usize));
    let d: [Q; 3] = std::array::from_fn(|k| &b[k] - &a[k]);
    let w: [Q; 3] = std::array::from_fn(|k| q(point[k]) - &a[k]);
    let dot = |a: &[Q; 3], b: &[Q; 3]| (0..3).map(|k| &a[k] * &b[k]).sum::<Q>();
    let dd = dot(&d, &d);
    let t = dot(&w, &d) / dd;
    let t = t.max(Q::zero()).min(q(1.));
    let r: [Q; 3] = std::array::from_fn(|k| &w[k] - &t * &d[k]);
    dot(&r, &r)
}
fn expected(ds: &[Q], tie: f64) -> Vec<usize> {
    let best = ds.iter().min().unwrap();
    let tt = q(tie) * q(tie);
    ds.iter()
        .enumerate()
        .filter_map(|(i, d)| {
            let l = d - best - &tt;
            (l <= Q::zero() || &l * &l <= q(4.) * &tt * best).then_some(i)
        })
        .collect()
}

#[test]
fn closest_edges_match_independent_rational_metric_in_world_space() {
    for frame in [
        Affine::IDENTITY,
        Affine {
            origin: [65.53625, -32.7685, 16.384125],
            x: [0., 0., 1.],
            z: [0., -1., 0.],
        },
        Affine {
            origin: [1., 2., 3.],
            x: [0.6, 0.8, 0.],
            z: [1e-14, 0., 1.],
        },
    ] {
        let body = cube(frame);
        let candidates: Vec<_> = (0..body.body.edges.len()).map(|i| (&body, i)).collect();
        for point in [
            [0., 0., 0.],
            [0.5, 0.5, 0.5],
            [0.125, -0.25, 0.75],
            [-2., 3., 4.],
            frame.origin,
        ] {
            let ds: Vec<_> = (0..candidates.len())
                .map(|e| squared(&body, e, point))
                .collect();
            for tie in [0., 1e-8, 0.125, 1.] {
                assert_eq!(
                    edge_query::closest(&candidates, point, tie).unwrap(),
                    expected(&ds, tie),
                    "frame={frame:?}, point={point:?}, tie={tie}"
                );
            }
        }
    }
}

#[test]
fn closest_does_not_round_away_sub_ulp_placement_or_tie_boundary() {
    // At 2^53 both endpoints of each unit edge can round to one point.
    // The exact query must still distinguish the near edge from its neighbour.
    let body = cube(Affine {
        origin: [9007199254740992., 0., 0.],
        ..Affine::IDENTITY
    });
    let candidates: Vec<_> = (0..body.body.edges.len()).map(|i| (&body, i)).collect();
    let point = [9007199254740992., 0.5, 0.5];
    let ds: Vec<_> = (0..candidates.len())
        .map(|i| squared(&body, i, point))
        .collect();
    assert_eq!(
        edge_query::closest(&candidates, point, 0.).unwrap(),
        expected(&ds, 0.)
    );
    let near = cube(Affine::IDENTITY);
    let far = cube(Affine {
        origin: [0., 2., 0.],
        ..Affine::IDENTITY
    });
    let edge = near
        .body
        .edges
        .iter()
        .position(|e| {
            e.vertices.iter().all(|v| {
                let p = near.body.vertices[v.0 as usize].point;
                p[1].get() == 0. && p[2].get() == 0.
            })
        })
        .unwrap();
    let candidates = [(&near, edge), (&far, edge)];
    for (tie, count) in [
        (f64::from_bits(2f64.to_bits() - 1), 1),
        (2., 2),
        (f64::from_bits(2f64.to_bits() + 1), 2),
    ] {
        assert_eq!(
            edge_query::closest(&candidates, [0.5, 0., 0.], tie)
                .unwrap()
                .len(),
            count
        );
    }
    assert_eq!(
        edge_query::closest(&[(&far, edge), (&near, edge)], [0.5, 0., 0.], 0.).unwrap(),
        [1]
    );
}

#[test]
fn invalid_edge_query_inputs_refuse_instead_of_dropping_candidates() {
    let body = cube(Affine::IDENTITY);
    assert!(edge_query::closest(&[], [0.; 3], 0.).unwrap().is_empty());
    assert_eq!(
        edge_query::closest(&[(&body, usize::MAX)], [0.; 3], 0.)
            .unwrap_err()
            .0,
        "edge-query/edge-index"
    );
    for tie in [-1., f64::NAN, f64::INFINITY] {
        assert_eq!(
            edge_query::closest(&[(&body, 0)], [0.; 3], tie)
                .unwrap_err()
                .0,
            "edge-query/invalid-input"
        );
    }
    assert_eq!(
        edge_query::closest(&[(&body, 0)], [f64::NAN, 0., 0.], 0.)
            .unwrap_err()
            .0,
        "edge-query/invalid-input"
    );
}

#[test]
fn default_fillet_overflow_is_not_geometric_infeasibility() {
    let body = cube(Affine::IDENTITY);
    assert_eq!(
        fillet::constant_radius(&body, &[0], 2.).unwrap_err().0,
        "fillet/edge-overflow-unimplemented"
    );
    // Equality is a topology event, not an excessive-radius failure.
    let rounded = fillet::constant_radius(&body, &[0], 1.).unwrap();
    assert_eq!(
        audit(&rounded.check().unwrap()).unwrap().topology().faces,
        5
    );
}

// These legal binary64 inputs force expansion range fallback without a test
// switch. Tiny tie lengths exercise exact subnormal conversion; huge query
// coordinates exercise overflow and positive binary exponent reconstruction.
#[test]
fn closest_full_binary64_range_retains_exact_segment_distances() {
    for frame in [
        Affine::IDENTITY,
        Affine {
            origin: [1., -2., 3.],
            x: [0.8, 0.6, 0.],
            z: [2f64.powi(-44), 0., 1.],
        },
    ] {
        let body = cube(frame);
        let candidates: Vec<_> = (0..body.body.edges.len()).map(|i| (&body, i)).collect();
        for point in [
            [0.25, -0.5, 0.75],
            [1.5, 0.25, 0.75],
            [-1.5, 1.5, 0.75],
            [2f64.powi(700), -2f64.powi(600), 2f64.powi(500)],
            [-2f64.powi(700), 2f64.powi(600), -2f64.powi(500)],
            [f64::from_bits(1), 0.25, 0.5],
        ] {
            let ds: Vec<_> = (0..candidates.len())
                .map(|i| squared(&body, i, point))
                .collect();
            for tie in [f64::from_bits(1), 1e-8, 0., f64::MAX] {
                assert_eq!(
                    edge_query::closest(&candidates, point, tie).unwrap(),
                    expected(&ds, tie),
                    "point={point:?} tie={tie} frame={frame:?}"
                );
            }
        }
    }
}

#[test]
fn fillet_preflight_validates_radius_and_all_box_edge_reaches() {
    let body = cube(Affine::IDENTITY);
    for radius in [0., -1., f64::INFINITY, f64::NAN] {
        assert_eq!(
            fillet::constant_radius(&body, &[0], radius).unwrap_err().0,
            "fillet/invalid-radius"
        );
    }
    assert_eq!(
        fillet::constant_radius(&body, &[], 1.).unwrap_err().0,
        "fillet/empty-selection"
    );
    assert_eq!(
        fillet::constant_radius(&body, &[usize::MAX], 1.)
            .unwrap_err()
            .0,
        "fillet/edge-index"
    );
    for edge in 0..body.body.edges.len() {
        for radius in [f64::from_bits(1f64.to_bits() - 1), 1.] {
            let rounded = fillet::constant_radius(&body, &[edge], radius).unwrap();
            let rounded = audit(&rounded.check().unwrap()).unwrap();
            assert_eq!(rounded.topology().faces, if radius == 1. { 5 } else { 7 });
        }
        assert_eq!(
            fillet::constant_radius(&body, &[edge], f64::from_bits(1f64.to_bits() + 1))
                .unwrap_err()
                .0,
            "fillet/edge-overflow-unimplemented"
        );
    }
}

fn box_body(frame: Affine, hi: [f64; 3]) -> Audited {
    let b = orthogonal::cuboid(
        BodyKey {
            id: [8, 7, 6, 5],
            revision: 0,
        },
        [0.; 3],
        hi,
    )
    .unwrap();
    let a = audit(&b.check().unwrap()).unwrap();
    audit(&orthogonal::transform(&a, frame).unwrap().check().unwrap()).unwrap()
}
fn blend_at(a: &Audited, p: [f64; 3], r: f64) -> wonky_contract::Body {
    let candidates: Vec<_> = (0..a.body.edges.len()).map(|i| (a, i)).collect();
    let world = a.frame.apply(p, 1., true).unwrap();
    let selected = edge_query::closest(&candidates, world, 1e-8).unwrap();
    assert_eq!(selected.len(), 1);
    fillet::constant_radius(a, &selected, r).unwrap()
}
fn near(a: f64, b: f64) {
    assert!((a - b).abs() < 1e-11 * b.abs().max(1.), "{a} != {b}");
}

#[test]
fn rolling_ball_prism_has_analytic_volume_area_probe_and_step_at_placements() {
    use wonky_ops::polyhedron::Probe;
    for frame in [
        Affine::IDENTITY,
        Affine {
            origin: [65.53625, -32.7685, 16.384125],
            ..Affine::IDENTITY
        },
        Affine {
            origin: [2., 3., 4.],
            x: [0., 0., 1.],
            z: [0., -1., 0.],
        },
        Affine { origin: [2., 3., 4.], x: [0.6, 0.8, 0.], z: [0., 0., 1.] },
    ] {
        let a = box_body(frame, [0.016, 0.012, 0.008]);
        let b = blend_at(&a, [0.016, 0.012, 0.004], 0.004);
        let words = wonky_wire::v3::encode(&b).unwrap();
        let rounded = audit(&wonky_wire::v3::decode(&words).unwrap()).unwrap();
        let t = rounded.topology();
        assert_eq!((t.faces, t.edges, t.vertices, t.genus), (7, 15, 10, 0));
        near(rounded.volume_mm3().unwrap(), 1508.5309649148733836);
        near(
            rounded.face_areas_mm2().unwrap().iter().sum(),
            811.3982236861550377,
        );
        let query = frame.apply([0.018, 0.014, 0.004], 1000., true).unwrap();
        let Probe::Measured {
            distance_mm,
            inside,
            bound_mm,
        } = rounded.distance_mm(query)
        else {
            panic!("missing distance")
        };
        assert!(!inside);
        assert!((distance_mm - 4.4852813742385703).abs() <= bound_mm + 2e-11);
        assert!(bound_mm < 1e-8);
        let Probe::Measured {
            inside,
            distance_mm,
            ..
        } = rounded.distance_mm(frame.apply([0.008, 0.006, 0.004], 1000., true).unwrap())
        else {
            panic!("missing inside")
        };
        assert!(inside);
        assert_eq!(distance_mm, 0.);
        let step = wonky_ops::step::write(&[("rounded".into(), &rounded)], "rolling-ball").unwrap();
        assert_eq!(step.matches("CYLINDRICAL_SURFACE").count(), 1);
        assert_eq!(step.matches("CIRCLE(").count(), 2);
    }
}

#[test]
fn paired_fillets_consume_face_exactly_and_requery_curves_without_chords() {
    let a = box_body(Affine::IDENTITY, [16.; 3]);
    let first = blend_at(&a, [0., 0., 8.], 4.);
    let first = audit(&first.check().unwrap()).unwrap();
    for (r, faces) in [(12f64.next_down(), 8), (12., 7)] {
        let second = blend_at(&first, [16., 0., 8.], r);
        let a = audit(&second.check().unwrap()).unwrap();
        assert_eq!(a.topology().faces, faces);
        near(a.volume_mm3().unwrap() / 1e9, 3546.6192982974676726);
        near(
            a.face_areas_mm2().unwrap().iter().sum::<f64>() / 1e6,
            1357.4512719466769936,
        );
        let wonky_ops::polyhedron::Probe::Measured {
            distance_mm,
            inside,
            ..
        } = a.distance_mm([4000., -4000., 8000.])
        else {
            panic!("probe")
        };
        assert!(!inside);
        near(distance_mm, 4000.);
    }
    let candidates: Vec<_> = (0..first.body.edges.len()).map(|e| (&first, e)).collect();
    let e = edge_query::closest(&candidates, [16., 0., 8.], 0.).unwrap();
    assert_eq!(
        fillet::constant_radius(&first, &e, 12f64.next_up())
            .unwrap_err()
            .0,
        "fillet/edge-overflow-unimplemented"
    );
    let e = edge_query::closest(&candidates, [-2., -2., 0.], 0.).unwrap();
    assert_eq!(e.len(), 1);
    assert!(matches!(
        first.body.curves[first.body.edges[e[0]].curve.0 as usize].geometry,
        wonky_contract::CurveGeometry::Circle { .. }
    ));
}

#[test]
fn construction_audit_rejects_planted_trim_radius_orientation_and_lineage_changes() {
    use wonky_contract::*;
    let a = box_body(Affine::IDENTITY, [16., 12., 8.]);
    let b = blend_at(&a, [16., 12., 4.], 4.);
    for plant in 0..5 {
        let mut wrong = b.clone();
        match plant {
            0 => {
                wrong.vertices[0].point[0] =
                    Binary64::new(wrong.vertices[0].point[0].get() + 0.25).unwrap();
            }
            1 => {
                let s = wrong
                    .surfaces
                    .iter_mut()
                    .find(|s| matches!(s.geometry, SurfaceGeometry::Cylinder { .. }))
                    .unwrap();
                if let SurfaceGeometry::Cylinder { radius, .. } = &mut s.geometry {
                    *radius = Binary64::new(3.).unwrap();
                }
            }
            2 => wrong.faces[0].forward = false,
            3 => {
                let node = wrong.constructions.last_mut().unwrap();
                node.parameters[0] = Binary64::new(2.).unwrap();
            }
            _ => {
                let pc = wrong
                    .pcurves
                    .iter_mut()
                    .find(|p| matches!(p.geometry, PcurveGeometry::CircularArc { .. }))
                    .unwrap();
                if let PcurveGeometry::CircularArc { clockwise, .. } = &mut pc.geometry {
                    *clockwise = !*clockwise;
                }
            }
        }
        let checked = wrong.check().unwrap();
        assert!(audit(&checked).is_err(), "accepted plant {plant}");
    }

}

#[test]
fn blend_metric_and_trim_decisions_do_not_snap_nearly_exact_inputs() {
    // Near-axis interpreter coefficients stay unchanged: source-frame blends
    // must not normalize either placement column to gain exact isometry.
    for (x, z) in [
        ([1., 2f64.powi(-48), 0.], [0., 0., 1.]),
        ([1., 0., 0.], [0., 2f64.powi(-48), 1.]),
    ] {
        let a = box_body(
            Affine {
                origin: [0.; 3],
                x,
                z,
            },
            [1.; 3],
        );
        let b = fillet::constant_radius(&a, &[0], 0.25).unwrap();
        let b = audit(&b.check().unwrap()).unwrap();
        assert_eq!(b.frame, a.frame);
        assert_eq!(b.topology().faces, 7);
    }
    let a = box_body(Affine::IDENTITY, [1.; 3]);
    let candidates: Vec<_> = (0..a.body.edges.len()).map(|i| (&a, i)).collect();
    let edges = edge_query::closest(&candidates, [1., 1., 0.5], 0.).unwrap();
    // 1 - binary64(0.1) is not representable. The source circle and its
    // contacts remain rational; WC0 caches are authenticated by replay.
    let body = fillet::constant_radius(&a, &edges, 0.1).unwrap();
    let rounded = audit(&body.clone().check().unwrap()).unwrap();
    assert_eq!((rounded.topology().faces,rounded.topology().edges,rounded.topology().vertices),(7,15,10));
    let expected = (1. - 0.1*0.1*(1.-std::f64::consts::PI/4.))*1e9;
    assert!((rounded.volume_mm3().unwrap()-expected).abs() < expected*1e-14);
    assert!(wonky_ops::step::write(&[("offset".into(),&rounded)],"offset").unwrap().contains("CYLINDRICAL_SURFACE"));
    let mut bad = body.clone();
    let coordinate = bad.vertices.iter_mut().flat_map(|v| &mut v.point).find(|c| c.get() != 0.).unwrap();
    *coordinate = wonky_contract::Binary64::new(coordinate.get().next_up()).unwrap();
    assert!(audit(&bad.check().unwrap()).is_err());
    let mut bad = body;
    bad.constructions.last_mut().unwrap().parameters[0] = wonky_contract::Binary64::new(0.1f64.next_up()).unwrap();
    assert!(audit(&bad.check().unwrap()).is_err());
    let shifted = orthogonal::cuboid(
        wonky_contract::BodyKey {
            id: [2, 4, 6, 8],
            revision: 0,
        },
        [10., 20., 0.],
        [26., 36., 16.],
    )
    .unwrap();
    let a = audit(&shifted.check().unwrap()).unwrap();
    let candidates: Vec<_> = (0..a.body.edges.len()).map(|i| (&a, i)).collect();
    let edges = edge_query::closest(&candidates, [26., 36., 8.], 0.).unwrap();
    assert_eq!(
        fillet::constant_radius(&a, &edges, 20.).unwrap_err().0,
        "fillet/edge-overflow-unimplemented"
    );
}

// Integrating curved Audited bodies must not feed their chords to the planar
// distance owner. Existing planar-distance tests could not construct a blend.
#[test]
fn solid_distance_refuses_curved_faces_instead_of_measuring_chords() {
    let source = cube(Affine::IDENTITY);
    let candidates: Vec<_> = (0..source.body.edges.len()).map(|i| (&source, i)).collect();
    let edges = edge_query::closest(&candidates, [1., 1., 0.5], 0.).unwrap();
    let rounded = audit(&fillet::constant_radius(&source, &edges, 0.25).unwrap().check().unwrap()).unwrap();
    let other = audit(&orthogonal::cuboid(BodyKey { id: [9, 8, 7, 6], revision: 0 },
        [2., 2., 0.25], [3., 3., 0.75]).unwrap().check().unwrap()).unwrap();
    for (a, b) in [(&rounded, &other), (&other, &rounded)] {
        match wonky_ops::distance::between(a, b) {
            Err(e) => assert_eq!(e.0, "distance/curved-carrier-unimplemented"),
            Ok(d) => panic!("curved solid silently measured as polygon chords: {} mm", d.distance_mm),
        }
    }
}

// A dyadic stretch makes the world metric discrepancy larger than the native
// rounding bound, without changing exact source incidence. This independently
// catches transpose-as-inverse classification and an unscaled volume receipt.
#[test]
fn source_radius_keeps_affine_volume_boundary_and_query_uncertainty_honest() {
    use wonky_ops::polyhedron::Probe;
    let s = 1. + 2f64.powi(-42);
    let frame = Affine { origin: [0.; 3], x: [s, 0., 0.], z: [0., 0., 1.] };
    let a = box_body(frame, [1.; 3]);
    let body = blend_at(&a, [1., 1., 0.5], 0.25);
    let blend = audit(&body.check().unwrap()).unwrap();
    let expected_volume = (1. - (1. - std::f64::consts::PI / 4.) / 16.) * s * s * 1e9;
    assert!((blend.volume_mm3().unwrap() - expected_volume).abs() < expected_volume * 2e-15);
    let edge_x = 1000. * s;
    for (x, expected_inside) in [(edge_x.next_down(), true), (edge_x, true), (edge_x.next_up(), false)] {
        let Probe::Measured { inside, distance_mm, bound_mm } = blend.distance_mm([x, 500. * s, 500.]) else { panic!("missing probe") };
        assert_eq!(inside, expected_inside);
        if expected_inside { assert_eq!(distance_mm, 0.); }
        else { assert!((distance_mm - (x - edge_x)).abs() <= bound_mm); }
    }
    let candidates: Vec<_> = (0..blend.body.edges.len()).map(|e| (&blend, e)).collect();
    assert_eq!(edge_query::closest(&candidates, [0.5 * s, 0.5 * s, 0.5], 0.).unwrap_err().0,
        "edge-query/query-world-metric-unresolved");
    // Public wire input can carry a stronger affine map than opTransform's
    // observation admission. The blend must still reject that map by name.
    let mut large = box_body(Affine::IDENTITY, [1.; 3]).body;
    if let wonky_contract::Frame::Interpreter { x, .. } = &mut large.frames[1] {
        x[0] = wonky_contract::Binary64::new(2.).unwrap();
    }
    let large = audit(&large.check().unwrap()).unwrap();
    assert_eq!(fillet::constant_radius(&large, &[0], 0.25).unwrap_err().0,
        "source-frame/world-metric-distortion");
}

#[test]
fn composed_placement_preserves_rational_blend_carrier_dispatch() {
    let body = orthogonal::cuboid(BodyKey { id: [1,2,3,4], revision: 0 },
        [0.;3], [0.04,0.03,0.02]).unwrap();
    let source = audit(&body.check().unwrap()).unwrap();
    let edge = source.body.edges.iter().position(|e| e.vertices.iter().all(|v| {
        let p = source.body.vertices[v.0 as usize].point;
        p[0].get() == 0.04 && p[1].get() == 0.03
    })).unwrap();
    let rows = [[1.,0.,0.],[0.,1.,0.],[0.,0.,1.]];
    let first = wonky_ops::pattern::copy(&source, source.body.key.clone(), rows, [0.017,0.019,0.023]).unwrap();
    let second = wonky_ops::pattern::copy(&first, source.body.key.clone(),
        [[0.,-1.,0.],[0.,0.,-1.],[1.,0.,0.]], [0.1,0.2,0.3]).unwrap();
    let blend = fillet::constant_radius(&second, &[edge], 0.004).unwrap();
    let wonky_ops::analytic::Solid::Planar(result) = wonky_ops::analytic::audit(&blend.check().unwrap()).unwrap() else {
        panic!("placed blend must retain its profile carrier")
    };
    let want = (40.*30.-16.*(1.-std::f64::consts::PI/4.))*20.;
    assert!((result.volume_mm3().unwrap()-want).abs()<1e-8);
    assert!(wonky_ops::step::write(&[("placed blend".into(), &result)], "placed blend").unwrap().contains("CIRCLE"));
}

#[test]
fn first_sketch_placement_keeps_recorded_plane_inputs_for_offset_replay() {
    let lines = [[0.,0.,0.04,0.],[0.04,0.,0.04,0.03],
        [0.04,0.03,0.,0.03],[0.,0.03,0.,0.]];
    let segments = lines.map(|p| [wonky_num::p2(p[0],p[1]),wonky_num::p2(p[2],p[3])]);
    let regions = wonky_sketch::region::lines_region(&segments).unwrap();
    let original = wonky_ops::extrude::blind_prism(&wonky_ops::extrude::Prism {
        key: BodyKey { id:[1,2,3,4], revision:0 }, source:[1,2,3,4],
        frame: Affine::IDENTITY, segments:&lines, region:&regions.loops[0], depth:0.02, reverse:false,
    }).unwrap();
    let source = audit(&original.clone().check().unwrap()).unwrap();
    let first = orthogonal::transform(&source, Affine {origin:[0.017,0.019,0.023],..Affine::IDENTITY}).unwrap();
    assert_eq!(&first.frames[..original.frames.len()], &original.frames);
    let first = audit(&first.check().unwrap()).unwrap();
    let second = orthogonal::transform(&first, Affine {
        origin:[0.1,0.2,0.3], x:[0.,0.,1.], z:[0.,-1.,0.],
    }).unwrap();
    let second = audit(&second.check().unwrap()).unwrap();
    let edge = second.body.edges.iter().position(|e| e.vertices.iter().all(|v| {
        let p=second.body.vertices[v.0 as usize].point;
        p[0].get()==0.04 && p[1].get()==0.03
    })).unwrap();
    for fillet in [true,false] {
        let output = if fillet { fillet::constant_radius(&second,&[edge],0.004) }
            else { wonky_ops::chamfer::equal_offsets(&second,&[edge],0.004) }.unwrap();
        let result = wonky_ops::analytic::audit(&output.check().unwrap()).unwrap();
        let wonky_ops::analytic::Solid::Planar(result) = result else {panic!("profile carrier required")};
        let removed = if fillet {16.*(1.-std::f64::consts::PI/4.)} else {8.};
        assert!((result.volume_mm3().unwrap()-(40.*30.-removed)*20.).abs()<1e-8);
    }
}

#[test]
fn placed_rational_fillet_mesh_rejects_changed_source_radius() {
    use wonky_contract::{Binary64, Operation};
    use wonky_ops::{mesh, pattern};
    let original = box_body(Affine::IDENTITY, [0.04, 0.03, 0.02]);
    let rounded = audit(&blend_at(&original, [0.04, 0.03, 0.01], 0.004).check().unwrap()).unwrap();
    let placed = pattern::copy(
        &rounded, rounded.body.key.clone(),
        [[1., 0., 0.], [0., 1., 0.], [0., 0., 1.]], [0.017, 0.019, 0.023],
    ).unwrap();
    let checked = placed.body.clone().check().unwrap();
    let output = mesh::tessellate(&checked, 0.005).unwrap();
    mesh::check_watertight(&output).unwrap();
    mesh::binary_stl(&[output], 0.005).unwrap();

    // Keep every display cache unchanged while altering the authoritative
    // radius. A sampler which only reads WC0 observations emits the old solid.
    let mut altered = placed.body;
    let source = altered.constructions.iter_mut()
        .find(|n| n.operation == (Operation::Fillet {})).unwrap();
    source.parameters[0] = Binary64::new(0.003).unwrap();
    let checked = altered.check().unwrap();
    assert!(mesh::tessellate(&checked, 0.005).is_err(),
        "placed rational profile caches cannot replace source replay");
}
