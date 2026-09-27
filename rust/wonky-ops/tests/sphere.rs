//! Primary owner: observable analytic B-rep, exact admission and independent
//! closed forms. Transport is exercised through WC0, not internal helper calls.
use wonky_contract::*;
use wonky_num::Iv;
use wonky_ops::{
    affine::Affine,
    analytic,
    step::SolidRef,
    orthogonal, polyhedron, sphere, step,
};
fn key(n: u32) -> BodyKey {
    BodyKey {
        id: [n, 0, 0, 0],
        revision: 0,
    }
}
fn ball(center: [f64; 3], r: f64) -> sphere::Spherical {
    sphere::audit(&sphere::sphere(key(1), center, r).unwrap().check().unwrap()).unwrap()
}
fn half(axis: usize, sign: f64) -> sphere::Spherical {
    let a = ball([0.; 3], 0.008);
    let mut lo = [-0.016; 3];
    let mut hi = [0.016; 3];
    if sign > 0. {
        lo[axis] = 0.;
    } else {
        hi[axis] = 0.;
    }
    let bx =
        polyhedron::audit(&orthogonal::cuboid(key(2), lo, hi).unwrap().check().unwrap()).unwrap();
    let b = sphere::intersect_box(key(3), &a, &bx).unwrap();
    let words = wonky_wire::v3::encode(&b).unwrap();
    sphere::audit(&wonky_wire::v3::decode(&words).unwrap()).unwrap()
}
fn contains(v: Iv, x: f64) {
    assert!(
        v.lo() <= x && x <= v.hi(),
        "{x} not in [{},{}]",
        v.lo(),
        v.hi()
    );
    assert!(v.r < 1e-9 * x.abs().max(1.));
}
fn rational_enclosure(volume: Iv, area: Iv, half: bool) {
    use num_rational::BigRational;
    let q = |x| BigRational::from_float(x).unwrap();
    // Independent decimal enclosure of pi, tighter than binary64. Production
    // VA1 is deliberately not called by this oracle.
    let lower:BigRational="314159265358979323846264338327950288419716939937510/100000000000000000000000000000000000000000000000000".parse().unwrap();
    let upper:BigRational="314159265358979323846264338327950288419716939937511/100000000000000000000000000000000000000000000000000".parse().unwrap();
    let r = q(0.008) * q(1000.);
    let vscale = &r * &r * &r * q(if half { 2. } else { 4. }) / q(3.);
    let ascale = &r * &r * q(if half { 3. } else { 4. });
    assert!(q(volume.lo()) <= &lower * &vscale && q(volume.hi()) >= &upper * &vscale);
    assert!(q(area.lo()) <= &lower * &ascale && q(area.hi()) >= &upper * &ascale);
}
#[test]
fn closed_forms_and_all_six_equatorial_orientations() {
    let full = ball([0.; 3], 0.008);
    let (v, a, _) = full.measures_mm().unwrap();
    contains(v, 2144.660584850632);
    contains(a, 804.247719318987);
    rational_enclosure(v, a, false);
    assert_eq!(full.body().faces.len(), 1);
    assert_eq!(full.body().edges.len(), 0);
    for axis in 0..3 {
        for sign in [-1., 1.] {
            let s = half(axis, sign);
            let (v, a, faces) = s.measures_mm().unwrap();
            contains(v, 1072.330292425316);
            contains(a, 603.1857894892403);
            rational_enclosure(v, a, true);
            contains(faces[0], 402.1238596594935);
            contains(faces[1], 201.06192982974676);
            let (lo, hi) = s.bbox_mm(None).unwrap();
            for k in 0..3 {
                assert_eq!(lo[k], if k == axis && sign > 0. { 0. } else { -8. });
                assert_eq!(hi[k], if k == axis && sign < 0. { 0. } else { 8. });
            }
            let centroid = s.centroid_mm().unwrap();
            assert!((centroid[axis] - 3. * sign).abs() < 1e-14);
            let mut q = [0.; 3];
            q[axis] = 12. * sign;
            contains(s.probe_mm(q).unwrap().0, 4.);
            q[axis] = -4. * sign;
            contains(s.probe_mm(q).unwrap().0, 4.);
            q[axis] = 4. * sign;
            assert!(s.probe_mm(q).unwrap().1);
            let q = [0.; 3];
            assert!(s.probe_mm(q).unwrap().1);
            assert_eq!(s.body().faces.len(), 2);
            assert_eq!(s.body().edges.len(), 1);
        }
    }
}
#[test]
fn exact_membership_and_plane_admission_never_snap_adjacent_values() {
    let a = ball([0.; 3], 1.);
    assert!(a.probe_mm([1000., 0., 0.]).unwrap().1);
    assert!(!a.probe_mm([1000f64.next_up(), 0., 0.]).unwrap().1);
    let offset = ball([0., 0., 1.], 0.25);
    for z in [1f64.next_down(), 1f64.next_up(), 1.1] {
        let bx = polyhedron::audit(
            &orthogonal::cuboid(key(2), [-2., -2., z], [2., 2., 2.])
                .unwrap()
                .check()
                .unwrap(),
        )
        .unwrap();
        assert_eq!(
            sphere::intersect_box(key(3), &offset, &bx).unwrap_err().0,
            "sphere/non-equatorial-cut-needs-algebraic-circle"
        );
    }
    // Far-world magnitude is not an admission envelope.
    let frame = Affine {
        origin: [262.144, -131.072, 65.536],
        x: [0., 0., 1.],
        z: [0., -1., 0.],
    };
    let a = sphere::audit(
        &sphere::transform(&half(2, 1.), frame)
            .unwrap()
            .check()
            .unwrap(),
    )
    .unwrap();
    let (v, _, _) = a.measures_mm().unwrap();
    contains(v, 1072.330292425316);
    let (lo, hi) = a.bbox_mm(None).unwrap();
    assert!(lo[0] > 262000.);
    assert!(hi[1] < -131000.);
    use num_rational::BigRational;
    use num_traits::ToPrimitive;
    let q = |x| BigRational::from_float(x).unwrap();
    let expected = (q(frame.origin[1]) * q(1000.) - q(-131084.) - q(0.008) * q(1000.))
        .to_f64()
        .unwrap();
    contains(a.probe_mm([262144., -131084., 65536.]).unwrap().0, expected);
}
#[test]
fn affine_measurements_include_binary64_frame_defect() {
    let a = half(2, 1.);
    let frame = Affine {
        origin: [0.; 3],
        x: [1.00000000001, 0., 0.],
        z: [0., 0., 1.],
    };
    let s = sphere::audit(&sphere::transform(&a, frame).unwrap().check().unwrap()).unwrap();
    let (v, area, _) = s.measures_mm().unwrap();
    contains(v, 1072.330292425316 * frame.x[0] * frame.x[0]);
    assert!(area.r > 1e-9);
    assert!(s.tolerance_mm().unwrap() > 1e-10);
    // A determinant is not one merely because this frame passes the near-
    // isometry export gate. On the y axis the exact scale is scale squared.
    // The nearest equatorial point is therefore known without our pullback.
    use num_rational::BigRational;
    let q = |x| BigRational::from_float(x).unwrap();
    for scale in [1.0000000001, 0.9999999999] {
        let frame = Affine {
            origin: [0.; 3],
            x: [scale, 0., 0.],
            z: [0., 0., scale],
        };
        let s = sphere::audit(&sphere::transform(&a, frame).unwrap().check().unwrap()).unwrap();
        let exact = q(12.) - q(0.008) * q(1000.) * q(scale) * q(scale);
        let (distance, inside) = s.probe_mm([0., 12., 0.]).unwrap();
        assert!(!inside);
        assert!(q(distance.lo()) <= exact && exact <= q(distance.hi()));
        assert!(distance.r < 4e-9);
    }
    let frame = Affine {
        x: [2., 0., 0.],
        ..Affine::IDENTITY
    };
    let s = sphere::audit(&sphere::transform(&a, frame).unwrap().check().unwrap()).unwrap();
    assert_eq!(
        s.measures_mm().unwrap_err().0,
        "sphere/non-isometric-export-frame"
    );
}
#[test]
fn mutated_carriers_topology_and_provenance_fail_the_independent_audit() {
    let a = half(2, 1.);
    let original = a.body();
    // Every planted negative remains structurally valid WC0; rejection must be
    // the geometric audit, not a broken index or unrelated decoder failure.
    for change in 0..34 {
        let mut b = original.clone();
        match change {
            0 => {
                if let SurfaceGeometry::Sphere { radius, .. } = &mut b.surfaces[0].geometry {
                    *radius = Binary64::new(0.008f64.next_up()).unwrap();
                }
            }
            1 => b.faces[0].forward = false,
            2 => b.faces[1].forward = true,
            3 => b.vertices[0].point[0] = Binary64::new(0.008f64.next_up()).unwrap(),
            4 => {
                if let CurveGeometry::Circle { radius, .. } = &mut b.curves[0].geometry {
                    *radius = Binary64::new(0.009).unwrap();
                }
            }
            5 => b.coedges[0].forward = false,
            6 => b.loops[1].outer = false,
            7 => b.surfaces[0].provenance = Provenance::None {},
            8 => {
                if let PcurveGeometry::Circle { clockwise, .. } = &mut b.pcurves[1].geometry {
                    *clockwise = true;
                }
            }
            9 => {
                if let SurfaceGeometry::Plane { normal, .. } = &mut b.surfaces[1].geometry {
                    normal[2] = Binary64::new(-1.).unwrap();
                }
            }
            10 => b.frames.push(Frame::Source { source: [9; 4] }),
            11 => {
                if let SurfaceGeometry::Sphere { axis, .. } = &mut b.surfaces[0].geometry {
                    axis[2] = Binary64::new(-1.).unwrap();
                }
            }
            12 => b.constructions[0]
                .parameters
                .push(Binary64::new(0.).unwrap()),
            13 => {
                if let SurfaceGeometry::Plane { origin, .. } = &mut b.surfaces[1].geometry {
                    origin[2] = Binary64::new(1.).unwrap();
                }
            }
            14 => b.constructions[2]
                .parameters
                .push(Binary64::new(0.).unwrap()),
            15 => b.surfaces.push(b.surfaces[0].clone()),
            16 => b.faces.push(b.faces[0].clone()),
            17 => b.shells.push(b.shells[0].clone()),
            18 => b.solids.push(b.solids[0].clone()),
            19 => b.shells[0].faces.reverse(),
            20 => {
                if let SurfaceGeometry::Sphere { origin, .. } = &mut b.surfaces[0].geometry {
                    origin[0] = Binary64::new(1.).unwrap();
                }
            }
            21 => {
                if let SurfaceGeometry::Sphere { x, .. } = &mut b.surfaces[0].geometry {
                    x[0] = Binary64::new(-1.).unwrap();
                }
            }
            22 => b.vertices.push(b.vertices[0].clone()),
            23 => {
                let mut c = b.curves[0].clone();
                c.supports.clear();
                b.curves.push(c);
            }
            24 => {
                let pc = b.pcurves[0].clone();
                b.pcurves.push(pc);
                b.curves[0].supports.push(Support {
                    surface: SurfaceId(0),
                    pcurve: PcurveId(2),
                });
            }
            25 => b.edges.push(b.edges[0].clone()),
            26 => b.coedges.push(b.coedges[0].clone()),
            27 => b.loops.push(b.loops[0].clone()),
            28 => b.curves[0].provenance = Provenance::None {},
            29 => b.vertices[0].provenance = Provenance::None {},
            30 => {
                if let CurveGeometry::Circle { origin, .. } = &mut b.curves[0].geometry {
                    origin[2] = Binary64::new(1.).unwrap();
                }
            }
            31 => {
                if let CurveGeometry::Circle { normal, .. } = &mut b.curves[0].geometry {
                    normal[2] = Binary64::new(-1.).unwrap();
                }
            }
            32 => {
                if let CurveGeometry::Circle { x, .. } = &mut b.curves[0].geometry {
                    x[0] = Binary64::new(-1.).unwrap();
                }
            }
            33 => {
                // A structurally valid transport estimate is not an audited
                // spherical measurement budget, even when its magnitude is zero.
                let zero = Binary64::new(0.).unwrap();
                let estimate = Bound::Estimated { estimate: Estimate { magnitude: zero } };
                b.budgets.push(Budget {
                    quantity: Quantity::Length {},
                    approximation: estimate.clone(),
                    construction: estimate.clone(),
                    integration: estimate.clone(),
                    export: estimate.clone(),
                    total: estimate,
                    maximum: zero,
                    scale: Binary64::new(1.).unwrap(),
                    reference_width: zero,
                });
            }
            _ => unreachable!(),
        }
        let checked = b.check().unwrap_or_else(|e| panic!("plant {change} is not structurally valid: {e:?}"));
        assert!(sphere::audit(&checked).is_err(), "accepted plant {change}");
        assert!(
            analytic::audit(&checked).is_err(),
            "dispatch hid plant {change}"
        );
    }
}
#[test]
fn nonpositive_radius_and_unsupported_booleans_are_named() {
    for radius in [-1., 0.] {
        assert_eq!(
            sphere::sphere(key(1), [0.; 3], radius).unwrap_err().0,
            "sphere/nonpositive-radius"
        );
    }
    let a = analytic::audit(&ball([0.; 3], 0.008).body().clone().check().unwrap()).unwrap();
    let b =
        analytic::audit(&ball([0.008, 0.004, 0.], 0.008).body().clone().check().unwrap()).unwrap();
    assert_eq!(
        analytic::boolean(key(3), 2, &[a, b])
            .unwrap_err()
            .0,
        "lens/centers-need-one-source-axis"
    );
}
#[test]
fn every_sphere_export_chart_is_finite_and_analytic() {
    let mut cases = vec![ball([0.; 3], 0.008)];
    for axis in 0..3 {
        for sign in [-1., 1.] {
            cases.push(half(axis, sign));
        }
    }
    for (i, s) in cases.iter().enumerate() {
        let text = step::write_solids(&[("s".into(), SolidRef::Spherical(s))], "s").unwrap();
        // Real serialization contract: STEP REAL has no NaN or infinity. The
        // separate JS owner runs the full exact CurveOnSurface reader.
        assert!(
            !text.contains("NaN") && !text.contains("inf"),
            "nonfinite chart {i}"
        );
        assert!(text.contains("SPHERICAL_SURFACE("));
        assert!(!text.contains("POLYLINE("));
    }
}
#[test]
fn tangent_container_planes_and_inexact_chart_vertices_are_not_snapped() {
    let a = ball([0.; 3], 1.);
    for axis in 0..3 {
        let mut lo = [-1.; 3];
        lo[axis] = 0.;
        let bx = polyhedron::audit(
            &orthogonal::cuboid(key(2), lo, [1.; 3])
                .unwrap()
                .check()
                .unwrap(),
        )
        .unwrap();
        let s = sphere::intersect_box(key(3), &a, &bx).unwrap();
        assert_eq!(
            sphere::audit(&s.check().unwrap())
                .unwrap()
                .body()
                .faces
                .len(),
            2
        );
    }
    let a = ball([1., 0., 0.], 0.008);
    let bx = polyhedron::audit(
        &orthogonal::cuboid(key(2), [-2., -2., 0.], [2.; 3])
            .unwrap()
            .check()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        sphere::intersect_box(key(3), &a, &bx).unwrap_err().0,
        "sphere/chart-vertex-not-binary64"
    );
}
#[test]
fn full_sphere_rejects_unbound_extra_topology() {
    let a = ball([0.; 3], 0.008);
    let h = half(2, 1.);
    for kind in 0..3 {
        let mut b = a.body().clone();
        match kind {
            0 => {
                let mut v = h.body().vertices[0].clone();
                v.provenance = Provenance::Construction { node: NodeId(1) };
                b.vertices.push(v);
            }
            1 => {
                let mut c = h.body().curves[0].clone();
                c.provenance = Provenance::Construction { node: NodeId(1) };
                c.supports.clear();
                b.curves.push(c);
            }
            _ => b.faces[0].forward = false,
        }
        assert!(
            sphere::audit(&b.check().unwrap()).is_err(),
            "extra full sphere entity {kind}"
        );
    }
}

#[test]
fn oblique_native_observations_preserve_mapped_supports_and_rim_distances() {
    use std::io::Write;
    use std::process::{Command, Stdio};
    let frame = Affine {
        origin: [0.125, -0.25, 0.5],
        x: [0.6, 0.8, 0.],
        z: [0., 0., 1.],
    };
    let placed = |axis| {
        sphere::audit(&sphere::transform(&half(axis, 1.), frame).unwrap().check().unwrap()).unwrap()
    };
    let upper = placed(2);
    let side = placed(0);
    let map = [[2., 3., 4., 5.], [1., 1., 1., 2.], [3., 4., -12., 7.]];
    let probes = [[132.2, -240.4, 496.], [125., -250., 496.], [125., -250., 500.], [125., -250., 512.]];
    let records = [
        ball([0.; 3], 0.008).measure_json(None, &[]).unwrap(),
        upper.measure_json(Some(map), &probes).unwrap(),
        side.measure_json(None, &[]).unwrap(),
    ];
    let mut child = Command::new("node")
        .args(["--input-type=module", "-e", include_str!("data/sphere-observations.mjs")])
        .env("NODE_OPTIONS", "--max-old-space-size=8192")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn().expect("native host JSON consumer requires node");
    child.stdin.take().unwrap().write_all(format!("[{}]", records.join(",")).as_bytes()).unwrap();
    let result = child.wait_with_output().unwrap();
    assert!(result.status.success(), "{}", String::from_utf8_lossy(&result.stderr));
}
