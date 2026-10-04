//! Owning boundary: reconstruction audit rejects transport corruption, and
//! non-semicircular/concave arcs preserve analytic geometry and exact membership.
use wonky_contract::{Binary64, BodyKey, CurveGeometry, SurfaceGeometry};
use wonky_ops::{
    affine::Affine,
    arc_profile,
    polyhedron::{audit, Audited, Probe},
    step,
};
fn build(lines: &[[f64; 4]], arcs: &[[f64; 6]]) -> Audited {
    let body = arc_profile::build(
        BodyKey {
            id: [9, 8, 7, 6],
            revision: 0,
        },
        Affine::IDENTITY,
        lines,
        arcs,
        2.,
        false,
    )
    .unwrap();
    audit(&body.check().unwrap()).unwrap()
}
fn near(a: f64, b: f64) {
    assert!((a - b).abs() < 1e-10 * b.abs().max(1.), "{a} != {b}");
}
fn inside(a: &Audited, p: [f64; 3]) -> bool {
    match a.distance_mm(p) {
        Probe::Measured { inside, .. } => inside,
        Probe::Refused(s) => panic!("{s}"),
    }
}
#[test]
fn arbitrary_quarter_and_major_arcs_have_correct_integrals_and_trim_side() {
    for (mid, area, included, excluded) in [
        (
            [3., 4.],
            25. * std::f64::consts::PI / 4.,
            [250., 250., 1000.],
            [-250., -250., 1000.],
        ),
        (
            [-5., 0.],
            25. * std::f64::consts::PI * 0.75,
            [-250., -250., 1000.],
            [250., 250., 1000.],
        ),
    ] {
        let a = build(
            &[[0., 5., 0., 0.], [0., 0., 5., 0.]],
            &[[5., 0., mid[0], mid[1], 0., 5.]],
        );
        near(a.volume_mm3().unwrap(), area * 2e9);
        assert!(inside(&a, included));
        assert!(!inside(&a, excluded));
        if mid[0] > 0. {
            // On the supporting circle but outside the trimmed quadrant.
            assert!(!inside(&a, [-5000., 0., 1000.]));
            let (lo, hi) = a.bbox_mm(None).unwrap();
            near(lo[0], 0.);
            near(lo[1], 0.);
            near(hi[0], 5000.);
            near(hi[1], 5000.);
        }
        assert_eq!(a.body.faces.len(), 5);
        assert!(step::write(&[("sector".into(), &a)], "sector")
            .unwrap()
            .contains("CYLINDRICAL_SURFACE("));
    }
}
// These source chains are simple even though their supporting circles cross.
// The build/audit boundary must classify quadratic intersection points against
// the actual trims; no existing sector/notch test needs that classification.
#[test]
fn untrimmed_line_circle_roots_do_not_block_major_arc_extrusion() {
    let a = build(
        &[
            [0., 5., 4., 4.],
            [4., 4., 4., 2.],
            [4., 2., 5., 2.], // Supporting circle meets this at (sqrt(21), 2).
            [5., 2., 5., 0.],
        ],
        &[[5., 0., -5., 0., 0., 5.]],
    );
    near(
        a.volume_mm3().unwrap(),
        (75. * std::f64::consts::PI / 4. + 20.) * 2e9,
    );
    assert!(inside(&a, [-4000., 0., 1000.]));
    assert!(inside(&a, [4500., 1000., 1000.]));
    assert!(!inside(&a, [4500., 3000., 1000.]));
    assert_eq!(a.body.faces.len(), 7);
    assert!(step::write(&[("major".into(), &a)], "major")
        .unwrap()
        .contains("CYLINDRICAL_SURFACE("));
}
#[test]
fn untrimmed_circle_crossings_and_tangency_keep_analytic_capsules() {
    // A capsule rotated 45 degrees without rounded trigonometry. Bounding
    // boxes overlap, and the support circles intersect (d=1) or touch (d=4),
    // but their outward semicircles are disjoint. The rotation scales area 2x.
    for d in [1., 4., 5.] {
        let a = build(
            &[[2., -2., d + 2., d - 2.], [d - 2., d + 2., -2., 2.]],
            &[
                [-2., 2., -2., -2., 2., -2.],
                [d + 2., d - 2., d + 2., d + 2., d - 2., d + 2.],
            ],
        );
        near(
            a.volume_mm3().unwrap(),
            (8. * d + 8. * std::f64::consts::PI) * 2e9,
        );
        assert!(inside(&a, [500. * d, 500. * d, 1000.]));
        assert!(!inside(&a, [-4000., -4000., 1000.]));
        assert_eq!(a.body.faces.len(), 6);
        assert_eq!(
            step::write(&[("capsule".into(), &a)], "capsule")
                .unwrap()
                .matches("CYLINDRICAL_SURFACE(")
                .count(),
            2
        );
    }
}
#[test]
fn concave_semicircular_notch_and_next_ulp_boundary_keep_exact_membership() {
    let a = build(
        &[
            [0., 0., 4., 0.],
            [4., 0., 4., 4.],
            [4., 4., 3., 4.],
            [1., 4., 0., 4.],
            [0., 4., 0., 0.],
        ],
        &[[3., 4., 2., 3., 1., 4.]],
    );
    near(
        a.volume_mm3().unwrap(),
        (16. - std::f64::consts::PI / 2.) * 2e9,
    );
    assert!(inside(&a, [2000., 3000., 1000.]));
    assert!(inside(&a, [2000., 3000_f64.next_down(), 1000.]));
    assert!(!inside(&a, [2000., 3000_f64.next_up(), 1000.]));
    assert!(!inside(&a, [2000., 3500., 1000.]));
    assert!(!inside(&a, [2000., 4000., 1000.]));
    assert!(inside(&a, [500., 3500., 1000.]));
}
#[test]
fn reconstruction_audit_rejects_circle_chart_trim_and_orientation_corruption() {
    let a = build(
        &[[1., 0., 9., 0.], [9., 2., 1., 2.]],
        &[[9., 0., 10., 1., 9., 2.], [1., 2., 0., 1., 1., 0.]],
    );
    for mutation in 0..5 {
        let mut b = a.body.clone();
        match mutation {
            0 => {
                let c = b
                    .curves
                    .iter_mut()
                    .find(|c| matches!(c.geometry, CurveGeometry::Circle { .. }))
                    .unwrap();
                if let CurveGeometry::Circle { radius, .. } = &mut c.geometry {
                    *radius = Binary64::new(radius.get() * 1.001).unwrap();
                }
            }
            1 => {
                b.coedges[0].forward = !b.coedges[0].forward;
            }
            2 => {
                b.edges[0].vertices.swap(0, 1);
            }
            3 => {
                let s = b
                    .surfaces
                    .iter_mut()
                    .find(|s| matches!(s.geometry, SurfaceGeometry::Cylinder { .. }))
                    .unwrap();
                if let SurfaceGeometry::Cylinder { origin, .. } = &mut s.geometry {
                    origin[0] = Binary64::new(origin[0].get() + 0.01).unwrap();
                }
            }
            _ => b.pcurves[0].geometry = b.pcurves[1].geometry.clone(),
        }
        if let Ok(checked) = b.check() {
            assert!(audit(&checked).is_err(), "accepted mutation {mutation}");
        }
    }
}
#[test]
fn unresolved_intersections_do_not_authenticate_as_simple_regions() {
    let result = arc_profile::build(
        BodyKey {
            id: [0; 4],
            revision: 0,
        },
        Affine::IDENTITY,
        &[[0., 0., 4., 0.], [4., 0., 4., 4.], [4., 4., 0., 4.]],
        &[[0., 4., 3., 2., 0., 0.]],
        1.,
        false,
    );
    assert!(result.is_err(), "accepted an intersecting arc");
    let reason = result.err().unwrap().0;
    assert!(reason.contains("intersection"), "{reason}");
    for notch in [1.5, 2.] {
        // A nonincident line enters the disk, or touches the arc at a line
        // endpoint which is NOT an arc endpoint. Neither is a simple region.
        let result = arc_profile::build(
            BodyKey {
                id: [0; 4],
                revision: 0,
            },
            Affine::IDENTITY,
            &[
                [0., 0., 4., 0.],
                [4., 0., 4., 1.],
                [4., 1., notch, 2.],
                [notch, 2., 4., 3.],
                [4., 3., 4., 4.],
                [4., 4., 0., 4.],
            ],
            &[[0., 4., 2., 2., 0., 0.]],
            1.,
            false,
        );
        assert!(result.is_err(), "accepted nonincident contact at x={notch}");
        let reason = result.err().unwrap().0;
        assert!(reason.contains("intersection"), "{reason}");
    }
}

// Guard the OTHER outcome of the quadratic trim classifier: a true crossing
// or double-root contact must not become a simple region. Adjacent binary64
// inputs straddle tangency, so neither an epsilon nor a rounded root can decide.
#[test]
fn trimmed_contacts_and_one_ulp_clearance_are_distinguished_exactly() {
    for circle_pair in [false, true] {
        let tangent = if circle_pair { 4_f64 } else { 2_f64 };
        for offset in [tangent.next_down(), tangent, tangent.next_up()] {
            let (lines, arcs) = if circle_pair {
                (
                    vec![[0., 0., offset, 0.], [offset, 4., 0., 4.]],
                    vec![
                        [0., 4., 2., 2., 0., 0.],
                        [offset, 0., offset - 2., 2., offset, 4.],
                    ],
                )
            } else {
                (
                    vec![
                        [0., 0., 4., 0.],
                        [4., 0., 4., 1.],
                        [4., 1., offset, 1.],
                        [offset, 1., offset, 3.],
                        [offset, 3., 4., 3.],
                        [4., 3., 4., 4.],
                        [4., 4., 0., 4.],
                    ],
                    vec![[0., 4., 2., 2., 0., 0.]],
                )
            };
            let result = arc_profile::build(
                BodyKey {
                    id: [0; 4],
                    revision: 0,
                },
                Affine::IDENTITY,
                &lines,
                &arcs,
                2.,
                false,
            );
            if offset > tangent {
                let a = audit(&result.unwrap().check().unwrap()).unwrap();
                let area = if circle_pair {
                    4. * offset - 4. * std::f64::consts::PI
                } else {
                    8. + 2. * offset - 2. * std::f64::consts::PI
                };
                near(a.volume_mm3().unwrap(), area * 2e9);
            } else {
                let reason = result.err().expect("accepted a trimmed contact").0;
                assert!(
                    reason.contains(if circle_pair {
                        "arc-arc-intersection"
                    } else {
                        "line-arc-intersection"
                    }),
                    "{reason}"
                );
            }
        }
    }
}

#[test]
fn rounded_side_plane_cache_is_not_used_as_an_exact_query_witness() {
    let a = build(
        &[[0., 0., 1., 3.], [3., 1., 0., 0.]],
        &[[1., 3., 4., 4., 3., 1.]],
    );
    let (index, origin, normal) = a
        .body
        .surfaces
        .iter()
        .enumerate()
        .skip(2)
        .find_map(|(index, s)| {
            if let SurfaceGeometry::Plane { origin, normal, .. } = &s.geometry {
                Some((index, origin.map(|x| x.get()), normal.map(|x| x.get())))
            } else {
                None
            }
        })
        .unwrap();
    let solid = wonky_ops::analytic::Solid::Planar(a);
    let selected = [wonky_ops::query::Entity {
        kind: wonky_ops::query::FACE,
        index: index as u32,
    }];
    let result = wonky_ops::query::coincides(&solid, &selected, origin, normal);
    assert!(result.is_err());
    assert!(result
        .err()
        .unwrap()
        .0
        .contains("arc-profile-side-plane-unimplemented"));
}

// Public host helpers, also exercising transport of the selected bounded face.
fn arc_request(op: u32, lines: &[[f64; 4]], arcs: &[[f64; 6]], region: Option<u32>) -> Vec<u32> {
    use wonky_ops::host::{MAGIC, OP_ARC_EXTRUDE, VERSION};
    let push = |out: &mut Vec<u32>, x: f64| {
        let bits = x.to_bits();
        out.extend([bits as u32, (bits >> 32) as u32]);
    };
    let mut request = vec![MAGIC, VERSION, op];
    if op == OP_ARC_EXTRUDE {
        request.extend([1, 2, 3, 4, 0]);
        for x in [0., 0., 0., 1., 0., 0., 0., 0., 1., 2.] {
            push(&mut request, x);
        }
        request.push(0);
    }
    request.push(lines.len() as u32);
    for &x in lines.iter().flatten() {
        push(&mut request, x);
    }
    request.push(arcs.len() as u32);
    for &x in arcs.iter().flatten() {
        push(&mut request, x);
    }
    if let Some(index) = region {
        request.push(index);
    }
    request
}
fn arc_host(op: u32, lines: &[[f64; 4]], arcs: &[[f64; 6]], region: Option<u32>) -> Vec<u32> {
    wonky_ops::host::host_op(&arc_request(op, lines, arcs, region))
}
fn host_region(lines: &[[f64; 4]], arcs: &[[f64; 6]], region: u32) -> Audited {
    use wonky_ops::host::{OP_ARC_EXTRUDE, STATUS_OK};
    let reply = arc_host(OP_ARC_EXTRUDE, lines, arcs, Some(region));
    assert_eq!(reply[0], STATUS_OK, "extrusion refusal: {:?}", reply);
    let checked = wonky_wire::v3::decode(&reply[1..]).unwrap();
    audit(&checked).unwrap()
}
// A source line overshoots the arc. The bounded faces use its exact contact
// (-25/13, 60/13), not a snapped endpoint or a fitted replacement circle.
#[test]
fn split_arc_regions_replay_rational_vertices_through_the_host() {
    use wonky_ops::host::{OP_ARC_EXTRUDE, OP_ARC_REGION, STATUS_OK, STATUS_REFUSED};
    let arcs = [[5., 0., 0., 5., -5., 0.]];
    let lines = [[-5., 0., 5., 0.], [5., 0., -4., 6.]];
    assert_eq!(arc_host(OP_ARC_REGION, &lines, &arcs, None)[0], STATUS_OK);
    let mut volumes = vec![];
    let mut membership = [0; 4];
    for region in 0..2 {
        let solid = host_region(&lines, &arcs, region);
        volumes.push(solid.volume_mm3().unwrap());
        // Picked-geometry predicates must not authenticate the rounded split
        // cache as exact. Topology-only queries remain available.
        let as_solid = wonky_ops::analytic::Solid::Planar(solid.clone());
        let vertices = wonky_ops::query::owned(&as_solid, wonky_ops::query::VERTEX).unwrap();
        assert!(!vertices.is_empty());
        assert!(
            wonky_ops::query::coincides(&as_solid, &vertices, [0.; 3], [1., 0., 0.])
                .unwrap_err()
                .0
                .contains("arc-profile-split-geometry-unimplemented")
        );
        // The source-chart metric now admits split edges without treating their
        // rounded endpoints as geometry. At (2,2,0) this exact sloped edge and
        // an independent horizontal edge have distance zero. A cache-derived
        // slope would lose the tie, because (-25/13,60/13) is not binary64.
        let edge = solid.body.edges.iter().position(|e| {
            if !matches!(solid.body.curves[e.curve.0 as usize].geometry, CurveGeometry::Line { .. }) {
                return false;
            }
            let ends = e.vertices.iter().map(|v| solid.body.vertices[v.0 as usize].point.map(|x| x.get())).collect::<Vec<_>>();
            ends.contains(&[5., 0., 0.]) && ends.iter().any(|p| p[1] > 0. && p[2] == 0.)
        }).unwrap();
        let witness = build(
            &[[0., 2., 4., 2.], [4., 4., 0., 4.], [0., 4., 0., 2.]],
            &[[4., 2., 5., 3., 4., 4.]],
        );
        let witness_edge = witness.body.edges.iter().position(|e| {
            let ends = e.vertices.iter().map(|v| witness.body.vertices[v.0 as usize].point.map(|x| x.get())).collect::<Vec<_>>();
            ends.contains(&[0., 2., 0.]) && ends.contains(&[4., 2., 0.])
        }).unwrap();
        assert_eq!(
            wonky_ops::edge_query::closest(&[(&solid, edge), (&witness, witness_edge)], [2., 2., 0.], 0.).unwrap(),
            vec![0, 1],
        );
        let all_edges = (0..solid.body.edges.len()).map(|i| (&solid, i)).collect::<Vec<_>>();
        assert_eq!(wonky_ops::edge_query::closest(&all_edges, [2., 2., 0.], 0.).unwrap(), vec![edge]);
        for (n, p) in [
            [0., 1000., 1000.],
            [0., 4500., 1000.],
            [0., 5000., 1000.],
            [6000., 0., 1000.],
        ]
        .into_iter()
        .enumerate()
        {
            membership[n] += usize::from(inside(&solid, p));
        }
        let step = step::write(&[(format!("region{region}"), &solid)], "split").unwrap();
        assert!(step.contains("CYLINDRICAL_SURFACE("));
        let mut corrupt = solid.body.clone();
        corrupt.vertices[0].point[0] =
            Binary64::new(corrupt.vertices[0].point[0].get().next_up()).unwrap();
        assert!(audit(&corrupt.check().unwrap()).is_err());
        if let Ok(dir) = std::env::var("WONKY_ARC_STEP_OUT") {
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(format!("{dir}/split-{region}.step"), step).unwrap();
        }
    }
    assert_eq!(membership, [1, 1, 1, 0]);
    assert_eq!(
        arc_host(OP_ARC_EXTRUDE, &lines, &arcs, Some(2))[0],
        STATUS_REFUSED
    );
    near(volumes.iter().sum(), 25. * std::f64::consts::PI * 1e9);
    // Circle segment subtending 2 atan(3/2); independent analytic area.
    let theta = 2. * (3_f64 / 2.).atan();
    let segment_volume = 25. * (theta - theta.sin()) * 1e9;
    assert!(volumes
        .iter()
        .any(|&v| (v - segment_volume).abs() < 1e-9 * segment_volume));
}
// Distinct regression: the area and centroid of a tiny admitted face must not
// disappear when sector and triangle terms cancel in binary64 arithmetic.
#[test]
fn tiny_rational_circle_segment_has_enclosed_nonzero_volume_and_centroid() {
    let epsilon = 2_f64.powi(-30);
    let arcs = [[5., 0., 0., 5., -5., 0.]];
    let lines = [[-5., 0., 5., 0.], [5., 0., 5. - epsilon, 1.]];
    let solids = [host_region(&lines, &arcs, 0), host_region(&lines, &arcs, 1)];
    let small = solids
        .iter()
        .min_by(|a, b| a.volume_mm3().unwrap().total_cmp(&b.volume_mm3().unwrap()))
        .unwrap();
    let volume = small.volume_mm3().unwrap();
    // theta = 2 atan(epsilon), theta-sin(theta) = 4/3 epsilon^3 + O(epsilon^5).
    // At 2^-30 the omitted relative term is < 2^-58, below this asserted band.
    let expected = (100. / 3.) * epsilon.powi(3) * 1e9;
    assert!(
        (volume / expected - 1.).abs() < 1e-10,
        "{volume} vs {expected}"
    );
    let (centroid, bound) = small.centroid_with_bound_mm().unwrap();
    assert!((centroid[0] - 5000.).abs() <= bound[0] + 1e-10);
    assert!(centroid[1] > 0. && centroid[1] < 1e-4 && bound[1] < 1e-10);
    assert!((centroid[2] - 1000.).abs() <= bound[2]);
}
// Circle-circle rational roots and a line through existing arc endpoints share
// one arrangement graph. No two filled faces may overlap in their interiors.
#[test]
fn circle_circle_crossings_partition_bounded_regions_without_overlap() {
    let arcs = [[-8., 0., -3., 5., 2., 0.], [-2., 0., 3., 5., 8., 0.]];
    let lines = [[-8., 0., 8., 0.]];
    let mut volume = 0.;
    let mut memberships = [0; 3];
    for region in 0..3 {
        let a = host_region(&lines, &arcs, region);
        volume += a.volume_mm3().unwrap();
        for (i, p) in [
            [-5000., 1000., 1000.],
            [0., 1000., 1000.],
            [5000., 1000., 1000.],
        ]
        .into_iter()
        .enumerate()
        {
            memberships[i] += usize::from(inside(&a, p));
        }
    }
    assert_eq!(memberships, [1; 3]);
    let half_lens = 25. * 0.6_f64.acos() - 12.;
    near(volume, (25. * std::f64::consts::PI - half_lens) * 2e9);
}
#[test]
fn split_arrangement_admits_quadratic_regions_and_keeps_tangency_limits_named() {
    use wonky_ops::host::{OP_ARC_EXTRUDE, OP_ARC_REGION, STATUS_OK, STATUS_REFUSED};
    let lines = [[-5., 0., 5., 0.], [1., -1., 1., 6.]];
    let arcs = [[5., 0., 0., 5., -5., 0.]];
    assert_eq!(arc_host(OP_ARC_REGION, &lines, &arcs, None)[0], STATUS_OK);
    let mut volumes = (0..2).map(|i| host_region(&lines, &arcs, i).volume_mm3().unwrap()).collect::<Vec<_>>();
    volumes.sort_by(f64::total_cmp);
    // Integrate the semicircular cap to the right of x=1, then extrude 2m.
    near(volumes[0], (25. * 0.2_f64.acos() - 24_f64.sqrt()) * 1e9);
    near(volumes.iter().sum(), 25. * std::f64::consts::PI * 1e9);
    // A newly supported quadratic selected region below the STEP reader floor
    // refuses through the same host boundary before any WC0 body is returned.
    let thin_lines = [[-5., 0., 5., 0.], [-6., 5. - 2_f64.powi(-40), 6., 5. - 2_f64.powi(-40)]];
    let mut refusals = 0;
    for region in 0..2 {
        let reply = arc_host(OP_ARC_EXTRUDE, &thin_lines, &arcs, Some(region));
        if reply[0] == STATUS_REFUSED {
            let reason: String = reply[1..].iter().map(|&x| char::from_u32(x).unwrap()).collect();
            assert!(reason.contains("sub-resolution-feature"), "{reason}");
            refusals += 1;
        } else { assert_eq!(reply[0], STATUS_OK); }
    }
    assert_eq!(refusals, 1, "only the sub-reader circular cap is inadmissible");
    for (lines, arcs, expected) in [
        (
            vec![[-10., 0., 10., 0.]],
            vec![[-10., 0., -5., 5., 0., 0.], [0., 0., 5., 5., 10., 0.]],
            "tangent-branch-order",
        ),
        (
            vec![[0., 0., 2., 0.], [1., 0., 3., 0.]],
            vec![[3., 0., 2., 1., 0., 0.]],
            "overlapping-lines",
        ),
    ] {
        let reply = arc_host(OP_ARC_REGION, &lines, &arcs, None);
        assert_eq!(reply[0], STATUS_REFUSED);
        let reason: String = reply[1..]
            .iter()
            .map(|&x| char::from_u32(x).unwrap())
            .collect();
        assert!(reason.contains(expected), "{reason}");
    }
}

// A zero-opening-angle tip can be a single boundary vertex rather than a
// self-intersection. The source circle and reversal use rational coordinates.
#[test]
fn tangent_reversal_horn_is_audited_and_exported_without_welding() {
    let lines = [
        [0., -5., 0., 0.], [-5., -5., -5., -10.],
        [-5., -10., 5., -10.], [5., -10., 5., -5.],
        [5., -5., 0., -5.], [0., -10., 0., -5.],
    ];
    // Centre (-5,0), radius 5. At (0,0) the incoming line points +Y,
    // while the outgoing arc's exact tangent points -Y.
    let arcs = [[0., 0., -2., -4., -5., -5.]];
    let a = host_region(&lines, &arcs, u32::MAX);
    near(a.volume_mm3().unwrap(), (75. - 25. * std::f64::consts::PI / 4.) * 2e9);
    assert!(inside(&a, [-500., -2500., 1000.]));
    assert!(!inside(&a, [-4000., -2500., 1000.]));
    assert!(step::write(&[("cusp".into(), &a)], "cusp")
        .unwrap().contains("CYLINDRICAL_SURFACE("));
}

#[test]
fn crossing_pinch_must_refuse_named_exterior_boundary() {
    use wonky_ops::host::{OP_ARC_EXTRUDE, STATUS_REFUSED};
    // Two bounded squares meet at exactly one vertex, but their interiors
    // occupy opposite quadrants: this is no zero-width cusp of one region.
    let lines = [
        [-2., -2., 0., -2.], [0., -2., 0., 0.], [0., 0., -2., 0.], [-2., 0., -2., -2.],
        [0., 0., 2., 0.], [2., 0., 2., 2.], [2., 2., 0., 2.], [0., 2., 0., 0.],
    ];
    let reply = arc_host(OP_ARC_EXTRUDE, &lines, &[], Some(u32::MAX));
    assert_eq!(reply[0], STATUS_REFUSED);
    let reason: String = reply[1..].iter().map(|&x| char::from_u32(x).unwrap()).collect();
    assert!(reason.contains("non-simple-exterior-walk"), "{reason}");
}

// The wire/audit boundary owns the cap proof: JS reports cannot authorize
// changed geometry. A forged smaller cap or a stripped policy must not replay.
#[test]
fn regularized_carrier_replay_rejects_cap_and_policy_tampering() {
    use wonky_ops::host::{host_op, OP_ARC_EXTRUDE, STATUS_OK};
    let lines = [[0., -0.005, 0.02, -0.005], [0.02, 0.005, 0., 0.005]];
    let arcs = [[0., 0.005, -0.005, 0., 0., -0.005],
        [0.02, -0.005, 0.0250000000000001, 0., 0.02, 0.005]];
    let mut request = arc_request(OP_ARC_EXTRUDE, &lines, &arcs, Some(0));
    let cap = 1e-9_f64.to_bits(); request.extend([cap as u32, (cap >> 32) as u32]);
    let reply = host_op(&request);
    assert_eq!(reply[0], STATUS_OK);
    let checked = wonky_wire::v3::decode(&reply[1..]).unwrap();
    let a = audit(&checked).unwrap();
    assert_eq!(a.body.faces.len(), 6);
    for stripped in [false, true] {
        let mut corrupt = a.body.clone();
        let node = &mut corrupt.constructions[1];
        if stripped { node.rule_version = 1; node.parameters.truncate(1); }
        else { node.parameters[1] = Binary64::new(0.).unwrap(); }
        assert!(audit(&corrupt.check().unwrap()).is_err());
    }
}
