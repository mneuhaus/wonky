//! Owner-boundary checks for the new analytic op. Independent rational closed
//! forms protect measurements, corruption checks protect construction binding,
//! and adjacent binary64 inputs protect exact contact/angle decisions.
use num_rational::BigRational as Q;
use num_traits::{Signed, ToPrimitive};
use wonky_contract::*;
use wonky_ops::{
    affine::Affine,
    revolve::{audit, circle_revolve, CircleRevolve},
};
use wonky_oracle::binary64;
use wonky_sketch::circle_region::{circle_region, Disk};

fn q(x: f64) -> Q {
    binary64(x).unwrap()
}
fn input(major: f64, minor: f64) -> CircleRevolve {
    CircleRevolve {
        key: BodyKey {
            id: [1, 2, 3, 4],
            revision: 0,
        },
        source: [4, 3, 2, 1],
        sketch: Affine {
            origin: [0.; 3],
            x: [1., 0., 0.],
            z: [0., -1., 0.],
        },
        axis_origin: [0.; 3],
        axis: [0., 0., 1.],
        disk: Disk {
            center: [major, 0.],
            radius: minor,
        },
        angle: std::f64::consts::TAU,
    }
}
fn torus(i: &CircleRevolve) -> wonky_ops::revolve::Torus {
    let body = circle_revolve(i).unwrap();
    let words = wonky_wire::v3::encode(&body).unwrap();
    audit(&wonky_wire::v3::decode(&words).unwrap()).unwrap()
}
fn reason(i: &CircleRevolve) -> String {
    circle_revolve(i).unwrap_err().0
}

#[test]
fn random_tori_enclose_independent_rational_closed_forms() {
    // Decimal π bracket with 50 fractional digits, independent of VA1.
    let den = Q::from_integer(
        "100000000000000000000000000000000000000000000000000"
            .parse()
            .unwrap(),
    );
    let pi_lo = Q::from_integer(
        "314159265358979323846264338327950288419716939937510"
            .parse()
            .unwrap(),
    ) / &den;
    let pi_hi = &pi_lo + Q::from_integer(1.into()) / &den;
    let mut seed = 9147u64;
    for k in 0..120 {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
        let minor = (1 + (seed >> 20) % 5000) as f64 / 1048576.;
        let major = minor + (1 + (seed >> 39) % 7000) as f64 / 1048576.;
        let mut i = input(if k % 2 == 0 { major } else { -major }, minor);
        i.disk.center[1] = (k as f64 - 70.) / 2048.;
        i.sketch.origin = [(k as f64 - 20.) * 3.125, k as f64 / 16., -1.2345];
        i.axis_origin = i.sketch.origin;
        if k % 3 == 0 {
            i.sketch.x = [0., 0., 1.];
            i.sketch.z = [1., 0., 0.];
            i.axis = [0., -1., 0.];
        }
        if k % 5 == 0 {
            i.axis = i.axis.map(|x| -x);
        }
        // The emitted carrier is the geometry, not the constructor's receipt.
        // This independently checks its meridian, including a constructor bug
        // that a replay-based audit would reproduce and therefore accept.
        let body = circle_revolve(&i).unwrap();
        let SurfaceGeometry::Torus {
            origin,
            major: carrier_major,
            minor: carrier_minor,
            ..
        } = &body.surfaces[0].geometry
        else {
            panic!("missing toroidal carrier")
        };
        assert_eq!(
            q(carrier_major.get()),
            q(i.disk.center[0]).abs(),
            "emitted major radius"
        );
        assert_eq!(
            q(carrier_minor.get()),
            q(i.disk.radius),
            "emitted minor radius"
        );
        assert_eq!(
            q(origin[2].get()),
            q(i.disk.center[1]),
            "emitted meridian height"
        );
        let words = wonky_wire::v3::encode(&body).unwrap();
        let t = audit(&wonky_wire::v3::decode(&words).unwrap()).unwrap();
        let (v, a) = t.measures_mm().unwrap();
        let r = q(minor) * q(1000.);
        let major = q(major) * q(1000.);
        for (ball, factor) in [(v, q(2.) * &major * &r * &r), (a, q(4.) * &major * &r)] {
            assert!(q(ball.lo()) <= &factor * &pi_lo * &pi_lo);
            assert!(q(ball.hi()) >= &factor * &pi_hi * &pi_hi);
            assert!(ball.r / ball.m < 1e-12);
        }
        let center = t.center_mm().unwrap();
        let (distance, inside) = t.probe_mm(center).unwrap();
        assert!(!inside);
        assert!((distance.m - (major - r).to_f64().unwrap()).abs() < distance.r + 1e-10);
        let bound = t.tolerance_mm().unwrap();
        let scale = center.iter().copied().map(f64::abs).fold(0.0, f64::max);
        assert!(
            bound > 0.
                && bound < 64. * f64::EPSILON * (scale + 1000. * (i.disk.center[0].abs() + minor))
        );
        let seam = t.seam_vertex_mm().unwrap();
        let x = i.sketch.x;
        for axis in 0..3 {
            let exact = (q(i.sketch.origin[axis])
                + q(i.disk.center[1]) * q(i.sketch.columns().unwrap()[1][axis])
                + (q(i.disk.center[0].abs()) + q(minor)) * q(x[axis]))
                * q(1000.);
            assert!((q(seam[axis]) - exact).abs() <= q(bound));
        }
    }
}

#[test]
fn interpreter_affine_volume_and_inverse_use_exact_source_geometry() {
    // Independent rational determinant, not a rigid-frame replay. A small
    // nonrigidity is intentional: dropping det(A) gives an un-enclosed volume.
    let frame = Affine { origin: [1.25, -0.5, 0.], x: [1. + 2f64.powi(-40), 0., 0.], z: [0., 0., 1. - 2f64.powi(-42)] };
    let i = input(0.008, 0.002);
    let body = wonky_ops::revolve::circle_revolve_in_frame(i.key.clone(), i.source, frame, i.disk, i.angle).unwrap();
    let t = audit(&body.clone().check().unwrap()).unwrap();
    let (v, _) = t.measures_mm().unwrap();
    let det = q(frame.x[0]) * q(frame.x[0]) * q(frame.z[2]) * q(frame.z[2]);
    let pi = q(std::f64::consts::PI);
    let exact = q(2.) * &pi * &pi * q(i.disk.center[0]) * q(i.disk.radius) * q(i.disk.radius) * q(1e9) * det;
    assert!(q(v.lo()) <= exact && exact <= q(v.hi()));
    let c = t.center_mm().unwrap();
    assert!(!t.probe_mm(c).unwrap().1);
    let in_ring = frame.apply([0.008, 0., 0.], 1000., true).unwrap();
    assert!(t.probe_mm(in_ring).unwrap().1);
    let outside = frame.apply([0.02, 0., 0.], 1000., true).unwrap();
    let distance = t.probe_mm(outside).unwrap();
    assert!(!distance.1);
    // All axes are diagonal here: the nearest point is on +X and its distance
    // follows an independent rational expression on the binary64 inputs.
    let exact_distance = q(outside[0]) - q(c[0]) - (q(i.disk.center[0]) + q(i.disk.radius)) * q(1000.) * q(frame.x[0]);
    assert!(q(distance.0.lo()) <= exact_distance && exact_distance <= q(distance.0.hi()));
    for (x, expected) in [(2., "revolve/frame-metric-range"), (1. + 1e-8, "revolve/measurement-width")] {
        let f = Affine { x: [x, 0., 0.], ..Affine::IDENTITY };
        let b = wonky_ops::revolve::circle_revolve_in_frame(i.key.clone(), i.source, f, i.disk, i.angle).unwrap();
        assert_eq!(audit(&b.check().unwrap()).unwrap().measures_mm().unwrap_err().0, expected);
    }
    let mut tampered = body;
    tampered.constructions[0].parameters[22] = Binary64::new(1.).unwrap();
    assert!(audit(&tampered.check().unwrap()).is_err());
}

#[test]
fn affine_probe_signs_match_independent_rational_inverse() {
    let theta = 0.17f64;
    let frame = Affine { origin: [1.25, -0.5, 0.75], x: [theta.cos(), theta.sin(), 0.], z: [0., 0., 1.] };
    let i = input(0.008, 0.002);
    let body = wonky_ops::revolve::circle_revolve_in_frame(i.key.clone(), i.source, frame, i.disk, i.angle).unwrap();
    let t = audit(&body.check().unwrap()).unwrap();
    let xx = q(frame.x[0]); let xy = q(frame.x[1]);
    let den = &xx * &xx + &xy * &xy;
    let r = q(i.disk.radius) * q(1000.); let major = q(i.disk.center[0]) * q(1000.);
    for a in [-11., -9.5, -8., -6.5, -5., -1., 0., 1., 5., 6.5, 8., 9.5, 11.] {
        for b in [-8., -2., 0., 2., 8.] {
            for c in [-2.5, -1.5, 0., 1.5, 2.5] {
                let world = [1250. + a, -500. + b, 750. + c];
                let dx = q(world[0]) - q(1250.); let dy = q(world[1]) - q(-500.);
                let x = (&xx * &dx + &xy * &dy) / &den;
                let y = (-&xy * dx + &xx * dy) / &den;
                let z = q(world[2]) - q(750.);
                let rho2 = &x * &x + &y * &y;
                let sum = &rho2 + &z * &z + &major * &major - &r * &r;
                let implicit = &sum * &sum - q(4.) * &major * &major * rho2;
                assert_eq!(t.probe_mm(world).unwrap().1, implicit <= q(0.), "{world:?}");
            }
        }
    }
}

#[test]
fn quarter_polygon_caps_are_exact_and_radial_moment_is_independent() {
    use wonky_ops::revolve_polygon::quarter_polygon;
    let quarter = std::f64::consts::FRAC_PI_2;
    // Decimal-independent dyadic inputs; vary offset and dimensions, with no
    // dependency on the catalog. Reverse input segments to exercise the region.
    for (r, width, height) in [(0.00390625, 0.00390625, 0.005859375), (2., 1.5, 3.)] {
        let points = [[r, 0.], [r + width, 0.], [r + width, height], [r, height]];
        let segments: Vec<_> = (0..4).rev().map(|i| { let a = points[i]; let b = points[(i + 1) % 4]; [b[0], b[1], a[0], a[1]] }).collect();
        let frame = Affine { origin: [65536.25, -32768.5, 16384.125], x: [1.25, 0.5, 0.], z: [0., 0., 1.] };
        let p = quarter_polygon(frame, &segments, quarter).unwrap();
        assert_eq!(p.caps.len(), 2); assert_eq!(p.sides.len(), 4);
        let mut cylinders = vec![];
        for side in &p.sides {
            if let SurfaceGeometry::Plane { origin, normal, .. } = side.surface {
                assert_eq!(normal[2].get(), if origin[2].get() == 0. { -1. } else { 1. });
                assert!(side.forward);
            }
            if let SurfaceGeometry::Cylinder { radius, .. } = side.surface { cylinders.push((radius.get(), side.forward)); }
        }
        assert!(cylinders.contains(&(r, false)) && cylinders.contains(&(r + width, true)));
        for (k, cap) in p.caps.iter().enumerate() {
            let SurfaceGeometry::Plane { origin, normal, .. } = cap.plane else { panic!("nonplanar cap") };
            let n = normal.map(|v| q(v.get())); let o = origin.map(|v| q(v.get()));
            let mut oriented = q(0.);
            for (i, a) in cap.points.iter().enumerate() {
                let b = cap.points[(i + 1) % cap.points.len()];
                let incidence: Q = (0..3).map(|j| (&q(a[j]) - &o[j]) * &n[j]).sum();
                assert_eq!(incidence, q(0.));
                let source = if k == 0 { [a[0], a[2]] } else { [a[1], a[2]] };
                assert!(points.contains(&source));
                for j in 0..3 { oriented += (q(a[(j + 1) % 3]) * q(b[(j + 2) % 3]) - q(a[(j + 2) % 3]) * q(b[(j + 1) % 3])) * &n[j]; }
            }
            assert!(oriented > q(0.));
        }
        let vol = p.volume_m3().unwrap();
        let det = q(frame.x[0]) * q(frame.x[0]) + q(frame.x[1]) * q(frame.x[1]);
        let closed = q(std::f64::consts::PI) / q(4.) * (q(r + width) * q(r + width) - q(r) * q(r)) * q(height) * det;
        assert!(q(vol.lo()) <= closed && closed <= q(vol.hi()));
        for angle in [quarter.next_down(), quarter.next_up(), 0., std::f64::consts::TAU] {
            assert!(matches!(quarter_polygon(frame, &segments, angle), Err(e) if e.0 == "revolve/polygon/partial-angle-not-quarter-turn"));
        }
        let mut open = segments.clone(); open.push([100., 100., 101., 100.]);
        assert!(matches!(quarter_polygon(frame, &open, quarter), Err(e) if e.0 == "revolve/polygon/one-closed-region-required"));
        let mut tilted = segments.clone(); tilted[0][0] += width / 4.;
        assert!(quarter_polygon(frame, &tilted, quarter).is_err());
    }
}

#[test]
fn exact_contact_and_one_ulp_gaps_never_snap() {
    for radius in [0.000001, 0.004, 3., 50.] {
        let touch = input(radius, radius);
        assert!(reason(&touch).starts_with("revolve/singular-geometry:"));
        let ring = input(radius.next_up(), radius);
        let t = torus(&ring);
        let (d, inside) = t.probe_mm([0.; 3]).unwrap();
        assert!(
            !inside,
            "an exact gap is not contact even if its distance enclosure straddles zero"
        );
        assert!(d.hi() > 0.);
        assert_eq!(
            reason(&input(radius.next_down(), radius)),
            "revolve/axis-crossing-circle"
        );
        let mut shifted = touch.clone();
        shifted.disk.center[1] = 0.1;
        assert!(reason(&shifted).starts_with("revolve/singular-geometry:"));
    }
    // Non-coordinate-axis sketch chart: contact at its origin still has an
    // exact affine construction witness; no rounded world coordinates needed.
    let mut diagonal = input(3., 5.);
    diagonal.disk.center[1] = 4.;
    diagonal.axis = [-4., 0., 3.];
    assert!(reason(&diagonal).starts_with("revolve/singular-geometry:"));
    let mut crossing = input(0.004, 0.004);
    crossing.axis = [1., 0., 0.];
    assert_eq!(reason(&crossing), "revolve/axis-crossing-circle");
    let mut skew = input(0.004, 0.004);
    skew.sketch.x = [0.9, 0.1, 0.2];
    skew.sketch.z = [-0.1, -0.9, 0.05];
    skew.axis = [0.2, -0.1, 0.95];
    skew.sketch.origin = [65536.25, -32768.5, 16384.125];
    skew.axis_origin = skew.sketch.origin;
    assert!(reason(&skew).starts_with("revolve/singular-geometry:"));
    skew.disk.center[0] = 0.008;
    assert_eq!(reason(&skew), "revolve/axis-frame-proof-unavailable");
}

#[test]
fn unsupported_and_invalid_inputs_are_named() {
    let base = input(0.01, 0.002);
    let mut cases = vec![];
    let mut push = |i, reason| cases.push((i, reason));
    for angle in [
        std::f64::consts::TAU.next_down(),
        std::f64::consts::TAU.next_up(),
        std::f64::consts::FRAC_PI_2,
        0.,
        -1.,
    ] {
        let mut i = base.clone();
        i.angle = angle;
        push(i, "revolve/partial-circle-angle");
    }
    let mut i = base.clone();
    i.axis = [0.; 3];
    push(i, "revolve/zero-axis");
    let mut i = base.clone();
    i.axis_origin[0] = f64::MIN_POSITIVE;
    push(i, "revolve/numeric-range");
    let mut i = base.clone();
    i.axis_origin[0] = 1e-20;
    push(i, "revolve/axis-origin-pullback");
    let mut i = base.clone();
    i.sketch.z = i.sketch.x;
    push(i, "revolve/degenerate-sketch-frame");
    let mut i = base.clone();
    i.sketch.x = [2., 0., 0.];
    push(i, "revolve/axis-frame-proof-unavailable");
    let mut i = base.clone();
    i.sketch.x = [1., 0.25, 0.];
    i.axis = [0., 0., 1.];
    push(i, "revolve/axis-frame-proof-unavailable");
    let mut i = base.clone();
    i.axis = [0., 1., 0.];
    push(i, "revolve/axis-not-sketch-y");
    for r in [0., -1., f64::NAN, f64::INFINITY, 1e-151] {
        let mut i = base.clone();
        i.disk.radius = r;
        push(i, "revolve/invalid-circle");
    }
    let mut i = base.clone();
    i.disk.center[0] = f64::NAN;
    push(i, "revolve/invalid-circle");
    let mut i = base;
    i.angle = f64::INFINITY;
    push(i, "revolve/numeric-range");
    for (i, expected) in cases {
        assert_eq!(reason(&i), expected);
    }
    assert!(circle_region([f64::INFINITY, 0.], 1.).is_err());
    assert!(circle_region([0., f64::NAN], 1.).is_err());
    assert!(circle_region([0., 0.], 1e-151).is_err());
}

#[test]
fn exact_inside_and_support_bounds_are_not_mesh_samples() {
    let mut i = input(0.008, 0.002);
    i.disk.center[1] = 0.003;
    i.sketch.origin = [100., -20., 3.];
    i.axis_origin = i.sketch.origin;
    let t = torus(&i);
    let c = t.center_mm().unwrap();
    // Independent distances in world mm, safely off the boundary.
    for (p, inside, expected) in [
        ([0., 0., 0.], false, 6.),
        ([8., 0., 0.], true, 0.),
        ([0., 0., 5.], false, 89f64.sqrt() - 2.),
        ([20., 0., 0.], false, 10.),
    ] {
        let (d, actual) = t.probe_mm(std::array::from_fn(|k| c[k] + p[k])).unwrap();
        assert_eq!(actual, inside);
        assert!((d.m - expected).abs() <= d.r + 1e-10);
    }
    let (lo, hi) = t.bbox_mm(None).unwrap();
    for k in 0..3 {
        let e = if k == 2 { 2. } else { 10. };
        assert!((lo[k] - (c[k] - e)).abs() < 1e-10);
        assert!((hi[k] - (c[k] + e)).abs() < 1e-10);
    }
    let map = [[0., 2., 0., 4.], [0., 0., -3., -5.], [1., 1., 1., 6.]];
    let (lo, hi) = t.bbox_mm(Some(map)).unwrap();
    let center = [2. * c[1] + 4., -3. * c[2] - 5., c[0] + c[1] + c[2] + 6.];
    let extent = [20., 6., 8. * 2f64.sqrt() + 2. * 3f64.sqrt()];
    for k in 0..3 {
        assert!((lo[k] - (center[k] - extent[k])).abs() < 1e-9);
        assert!((hi[k] - (center[k] + extent[k])).abs() < 1e-9);
    }
    assert_eq!(
        t.probe_mm([f64::NAN, 0., 0.]).unwrap_err().0,
        "revolve/probe-range"
    );
    assert!(t.bbox_mm(Some([[f64::MAX; 4]; 3])).is_err());
}

#[test]
fn audited_transport_rejects_forged_geometry_and_ulp_angle_mutant() {
    let body = circle_revolve(&input(0.008, 0.002)).unwrap();
    let mut altered = vec![];
    let mut b = body.clone();
    b.faces[0].forward = false;
    altered.push(b);
    let mut b = body.clone();
    b.solids.clear();
    altered.push(b);
    let mut b = body.clone();
    if let SurfaceGeometry::Torus { major, .. } = &mut b.surfaces[0].geometry {
        *major = Binary64::new(0.009).unwrap();
    }
    altered.push(b);
    for field in 0..4 {
        let mut b = body.clone();
        let SurfaceGeometry::Torus {
            origin,
            axis,
            x,
            minor,
            ..
        } = &mut b.surfaces[0].geometry
        else {
            unreachable!()
        };
        match field {
            0 => origin[2] = Binary64::new(0.001).unwrap(),
            1 => *minor = Binary64::new(0.001).unwrap(),
            2 => axis[2] = Binary64::new(-1.).unwrap(),
            _ => x[0] = Binary64::new(-1.).unwrap(),
        }
        altered.push(b);
    }
    let mut b = body.clone();
    b.constructions[1].operation = Operation::Extrude {};
    altered.push(b);
    let mut b = body.clone();
    b.constructions[1]
        .parameters
        .push(Binary64::new(1.).unwrap());
    altered.push(b);
    let mut b = body.clone();
    b.constructions[0].parameters[18] = Binary64::new(std::f64::consts::TAU.next_up()).unwrap();
    altered.push(b);
    let mut b = body.clone();
    b.constructions[0].parameters.pop();
    altered.push(b);
    let mut b = body.clone();
    b.frames[1] = Frame::Interpreter {
        parent: FrameId(0),
        origin: [Binary64::new(1.).unwrap(); 3],
        x: [
            Binary64::new(1.).unwrap(),
            Binary64::new(0.).unwrap(),
            Binary64::new(0.).unwrap(),
        ],
        z: [
            Binary64::new(0.).unwrap(),
            Binary64::new(0.).unwrap(),
            Binary64::new(1.).unwrap(),
        ],
    };
    altered.push(b);
    for b in altered {
        assert!(audit(&b.check().unwrap()).is_err());
    }
    let t = torus(&input(1e100, 1e99));
    assert!(t.measures_mm().is_err());
    let tiny = torus(&input(2e-110, 1e-110));
    assert_eq!(
        tiny.measures_mm().unwrap_err().0,
        "revolve/measurement-width"
    );
}

#[test]
fn host_transport_and_step_roundtrip_against_occt_closed_forms() {
    use std::fs;
    use std::process::Command;
    use wonky_ops::host::*;
    fn number(w: &mut Vec<u32>, x: f64) {
        w.push(x.to_bits() as u32);
        w.push((x.to_bits() >> 32) as u32);
    }
    fn text(w: &mut Vec<u32>, s: &str) {
        w.push(s.chars().count() as u32);
        w.extend(s.chars().map(|c| c as u32));
    }
    fn reply(w: &[u32]) -> Vec<u32> {
        let r = host_op(w);
        assert_eq!(r[0], STATUS_OK, "{:?}", r);
        r[1..].to_vec()
    }
    fn string(w: &[u32]) -> String {
        w.iter().map(|&c| char::from_u32(c).unwrap()).collect()
    }
    let dir = std::env::temp_dir().join(format!("wonky-revolve-oracle-{}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    for (k, (major, minor, height, origin, x, n, axis)) in [
        (
            0.011,
            0.003,
            0.007,
            [65.53625, -32.7685, 16.384125],
            [1., 0., 0.],
            [0., -1., 0.],
            [0., 0., 1.],
        ),
        (
            -0.027,
            0.004,
            -0.009,
            [-1.5, 2., 0.],
            [0., 0., 1.],
            [1., 0., 0.],
            [0., -1., 0.],
        ),
        (
            0.031,
            0.006,
            0.001,
            [0., 0., 0.],
            [-1., 0., 0.],
            [0., 1., 0.],
            [0., 0., 1.],
        ),
    ]
    .into_iter()
    .enumerate()
    {
        let i = CircleRevolve {
            sketch: Affine { origin, x, z: n },
            axis_origin: origin,
            axis,
            disk: Disk {
                center: [major, height],
                radius: minor,
            },
            ..input(major, minor)
        };
        let mut circle = vec![MAGIC, VERSION, OP_CIRCLE_REGION];
        for v in [major, height, minor] {
            number(&mut circle, v);
        }
        assert_eq!(
            string(&reply(&circle)),
            "{\"loops\":[{\"circle\":0}],\"openWires\":0}"
        );
        circle.push(0);
        assert_eq!(host_op(&circle)[0], STATUS_MALFORMED);
        let mut request = vec![MAGIC, VERSION, OP_CIRCLE_REVOLVE];
        request.extend(i.key.id);
        request.push(i.key.revision);
        request.extend(i.source);
        for v in origin
            .into_iter()
            .chain(x)
            .chain(n)
            .chain(origin)
            .chain(axis)
            .chain([major, height, minor, i.angle])
        {
            number(&mut request, v);
        }
        let body = reply(&request);
        let checked = wonky_wire::v3::decode(&body).unwrap();
        assert_eq!(*checked.body(), circle_revolve(&i).unwrap());
        request.pop();
        assert_eq!(host_op(&request)[0], STATUS_MALFORMED);
        let mut measure = vec![MAGIC, VERSION, OP_MEASURE, body.len() as u32];
        measure.extend(&body);
        measure.push(1);
        for v in [1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1., 0.] {
            number(&mut measure, v);
        }
        let center = origin.map(|v| v * 1000.);
        let y = i.sketch.columns().unwrap()[1];
        let center: [f64; 3] = std::array::from_fn(|j| center[j] + y[j] * height * 1000.);
        let core: [f64; 3] = std::array::from_fn(|j| center[j] + x[j] * major.abs() * 1000.);
        let vertex: [f64; 3] = std::array::from_fn(|j| core[j] + x[j] * minor * 1000.);
        measure.push(2);
        for p in [center, core] {
            for v in p {
                number(&mut measure, v);
            }
        }
        fs::write(dir.join(format!("{k}.json")), string(&reply(&measure))).unwrap();
        measure.push(0);
        assert_eq!(host_op(&measure)[0], STATUS_MALFORMED);
        let mut step = vec![MAGIC, VERSION, OP_STEP];
        text(&mut step, "ring 'quote' ö\n");
        step.push(1);
        text(&mut step, "ring 'id'");
        step.push(body.len() as u32);
        step.extend(&body);
        fs::write(dir.join(format!("{k}.step")), string(&reply(&step))).unwrap();
        let axis_index = y.iter().position(|v| v.abs() == 1.).unwrap();
        fs::write(dir.join(format!("{k}.expected")),format!("{{\"major\":{},\"minor\":{},\"center\":{:?},\"vertex\":{:?},\"axis\":{axis_index}}}",major.abs()*1000.,minor*1000.,center,vertex)).unwrap();
    }
    let script =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/data/revolve-oracle.py");
    let output = Command::new("uv")
        .args(["run", "--offline"])
        .arg(script)
        .arg(&dir)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "oracle failed: {}\n{} (artifacts {})",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr),
        dir.display()
    );
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn export_budget_encloses_rounding_near_the_axis_and_far_from_origin() {
    for (major, minor) in [
        (0.009813971493, 0.003719734409),
        (0.002f64.next_up(), 0.002),
    ] {
        let t = torus(&input(major, minor));
        let budget = t.tolerance_mm().unwrap();
        assert!(budget <= 64. * f64::EPSILON * 1000. * (major + minor));
        let p = t.seam_vertex_mm().unwrap();
        let exact = (q(major) + q(minor)) * q(1000.);
        assert!((q(p[0]) - exact).abs() <= q(budget));
    }
}

#[test]
fn rectangular_sector_audit_measures_and_exact_boundary_decisions() {
    // Owner contract: quarter-sector shape, orientation, construction binding,
    // and exact membership. Existing torus/cap-only tests cannot exercise sewn
    // B-reps. Independent rational formulas and physical probes, no new seam.
    use wonky_ops::revolve_sector::{build, audit as audit_sector};
    let input=input(0.008,0.002);
    for k in 1..24 {
        let r=k as f64/1024.;let outer=r+3./1024.;let low=-2./1024.;let high=5./1024.;
        let segments=[[r,low,outer,low],[outer,low,outer,high],[outer,high,r,high],[r,high,r,low]];
        let body=build(input.key.clone(),input.source,Affine::IDENTITY,&segments,std::f64::consts::FRAC_PI_2).unwrap();
        assert_eq!(body.vertices.len(),8);assert_eq!(body.edges.len(),12);assert_eq!(body.faces.len(),6);
        let words=wonky_wire::v3::encode(&body).unwrap();
        let s=audit_sector(&wonky_wire::v3::decode(&words).unwrap()).unwrap();
        let(vol,area)=s.measures().unwrap();let pi=q(std::f64::consts::PI);
        let r=q(r)*q(1000.);let outer=q(outer)*q(1000.);let h=(q(high)-q(low))*q(1000.);
        let annulus=&outer*&outer-&r*&r;
        let expected_volume=&pi/q(4.)*&annulus*&h;
        let expected_area=&pi/q(2.)*(&annulus+(&r+&outer)*&h)+q(2.)*(&outer-&r)*&h;
        assert!(q(vol.lo())<=expected_volume && expected_volume<=q(vol.hi()));
        assert!(q(area.lo())<=expected_area && expected_area<=q(area.hi()));
        let(lo,hi)=s.bbox(None).unwrap();
        for(j,e)in [0.,0.,low*1000.].into_iter().enumerate(){assert!((lo[j]-e).abs()<1e-10);}
        for(j,e)in [segments[0][2]*1000.,segments[0][2]*1000.,high*1000.].into_iter().enumerate(){assert!((hi[j]-e).abs()<1e-10);}
        let(d,inside)=s.probe([0.;3]).unwrap();assert!(!inside);assert!(q(d.lo())<=r && r<=q(d.hi()));
        // Dyadic mm points and inputs make these exact boundary assertions, not
        // tolerance comparisons at an inexact world-space image.
        let point=segments[0][0]*1000.;
        assert!(s.probe([point,0.,0.]).unwrap().1);
        assert!(!s.probe([point.next_down(),0.,0.]).unwrap().1);
        assert!(s.probe([point.next_up(),0.,0.]).unwrap().1);
        assert!(!s.probe([-point,0.,0.]).unwrap().1);
        let(d,_)=s.probe([-point,0.,0.]).unwrap();let squared=q(d.m)*q(d.m);
        assert!((squared-q(2.)*&r*&r).abs()<q(1e-10));
        for angle in [std::f64::consts::FRAC_PI_2.next_down(),std::f64::consts::TAU]{assert!(build(input.key.clone(),input.source,Affine::IDENTITY,&segments,angle).is_err());}
        if k==1 {
            for field in 0..6 {
                let mut altered=body.clone();match field {
                    0=>altered.vertices[0].point[0]=Binary64::new(segments[0][0].next_up()).unwrap(),
                    1=>altered.faces[5].forward=true,
                    2=>altered.coedges[0].forward=false,
                    3=>if let CurveGeometry::Circle{radius,..}=&mut altered.curves[8].geometry {*radius=Binary64::new(segments[0][0].next_up()).unwrap();},
                    4=>altered.constructions[0].parameters[10]=Binary64::new(segments[0][0].next_up()).unwrap(),
                    _=>if let PcurveGeometry::Samples{points,..}=&mut altered.pcurves[8].geometry {points[0][0]=Binary64::new(100.).unwrap();},
                }
                let checked=altered.check();assert!(checked.is_err() || audit_sector(&checked.unwrap()).is_err(),"accepted corruption {field}");
            }
        }
    }
}

#[test]
fn sector_affine_support_probes_and_refusals_cover_nonidentity_observation() {
    use wonky_ops::revolve_sector::{build, audit as audit_sector};
    let i=input(0.008,0.002);
    let (r,outer,low,high)=(4./1024.,8./1024.,-2./1024.,6./1024.);
    let segments=[[r,low,outer,low],[outer,low,outer,high],[outer,high,r,high],[r,high,r,low]];
    let make=|frame,segments:&[[f64;4]]|build(i.key.clone(),i.source,frame,segments,std::f64::consts::FRAC_PI_2);
    let s=audit_sector(&make(Affine::IDENTITY,&segments).unwrap().check().unwrap()).unwrap();
    // 3-4-5 supports independently expose interior angular extrema and both
    // mixed-sign cases. A vertex-only box or a reversed sign gives wrong bounds.
    for (a,b,min,max) in [(3.,4.,3.*r,5.*outer),(-3.,-4.,-5.*outer,-3.*r),(-3.,4.,-3.*outer,4.*outer),(3.,-4.,-4.*outer,3.*outer)] {
        let map=[[a,b,1.,123.],[0.,0.,1.,0.],[1.,0.,0.,0.]];
        let (lo,hi)=s.bbox(Some(map)).unwrap();
        assert!((lo[0]-(123.+1000.*(min+low))).abs()<1e-10);
        assert!((hi[0]-(123.+1000.*(max+high))).abs()<1e-10);
    }
    // Each independent squared distance uses a known closest feature, not the
    // implementation's clamp/radial helper. This covers all quadrant branches.
    for (p,d2,inside) in [([3.,4.,0.],0.,true),([0.,0.,10.],(r*1000.).powi(2)+(10.-high*1000.).powi(2),false),
        ([0.,0.,-10.],(r*1000.).powi(2)+(-10.-low*1000.).powi(2),false),([-5.,-12.,0.],144.+(-5.-r*1000.).powi(2),false),
        ([-12.,-5.,0.],144.+(-5.-r*1000.).powi(2),false),([6.,-8.,0.],64.,false),([-8.,6.,0.],64.,false),
        ([30.,40.,0.],(50.-outer*1000.).powi(2),false)] {
        let(d,got)=s.probe(p).unwrap();assert_eq!(got,inside,"{p:?}");
        let ball=d*d;assert!(ball.lo()<=d2 && d2<=ball.hi(),"{p:?}: {d2} not in {ball:?}");
    }
    let frame=Affine{origin:[65.125,-32.0625,16.25],x:[1.+2f64.powi(-40),0.,0.],z:[0.,0.,1.-2f64.powi(-42)]};
    let a=audit_sector(&make(frame,&segments).unwrap().check().unwrap()).unwrap();
    let(vol,_)=a.measures().unwrap();let det=q(frame.x[0]).pow(2)*q(frame.z[2]).pow(2);
    let expected=q(std::f64::consts::PI)/q(4.)*(q(outer).pow(2)-q(r).pow(2))*(q(high)-q(low))*q(1e9)*det;
    assert!(q(vol.lo())<=expected && expected<=q(vol.hi()));
    let world=frame.apply([0.02,0.,0.],1000.,true).unwrap();let(d,inside)=a.probe(world).unwrap();assert!(!inside);
    let exact=q(world[0])-q(frame.origin[0])*q(1000.)-q(outer)*q(1000.)*q(frame.x[0]);
    assert!(q(d.lo())<=exact && exact<=q(d.hi()));
    for (x,reason) in [(2.,"revolve/sector/frame-metric-range"),(1.+1e-8,"revolve/sector/measurement-width")] {
        let b=make(Affine{x:[x,0.,0.],..Affine::IDENTITY},&segments).unwrap();
        assert_eq!(audit_sector(&b.check().unwrap()).unwrap().measures().unwrap_err().0,reason);
    }
    let mut open=segments.to_vec();open.push([100.,100.,101.,100.]);assert!(make(Affine::IDENTITY,&open).is_err());
    let triangle=[[r,low,outer,low],[outer,low,r,high],[r,high,r,low]];assert!(make(Affine::IDENTITY,&triangle).is_err());
    let skew=[[r,low,outer,low],[outer,low,outer+1.,high],[outer+1.,high,r,high],[r,high,r,low]];assert!(make(Affine::IDENTITY,&skew).is_err());
    let diamond=[[r,0.,2.*r,r],[2.*r,r,r,2.*r],[r,2.*r,r/2.,r],[r/2.,r,r,0.]];assert!(make(Affine::IDENTITY,&diamond).is_err());
}

// Full-profile geometry owner. Rational washer/frustum decompositions are
// independent of the builder's Green integral. Corruptions exercise re-audit,
// a risk the frontend transport test cannot produce through valid FS input.
#[test]
fn full_polygon_rational_measures_frames_and_corrupted_carriers() {
    use wonky_ops::revolve_full::{build, audit};
    let scale=1.0/1024.;
    let pi_lo=Q::new(314159265358979323846i128.into(),100000000000000000000i128.into());
    let pi_hi=Q::new(314159265358979323847i128.into(),100000000000000000000i128.into());
    for mode in 0..3 {
        for hole in [false,true] {
            let inner=if hole{1.}else{0.};
            let points=[[inner,-2.],[5.,-2.],[5.,0.],[2.,4.],[2.,10.],[inner,10.]];
            let segments=(0..6).map(|i|{let(a,b)=(points[i],points[(i+1)%6]);[a[0]*scale,a[1]*scale,b[0]*scale,b[1]*scale]}).collect::<Vec<_>>();
            let frame=Affine{origin:[64.,-32.,16.],x:[1.,0.,0.],z:[0.,0.6,0.8]};
            let body=build(BodyKey{id:[9,8,7,6],revision:0},[0;4],frame,mode,&segments,std::f64::consts::TAU).unwrap();
            let checked=wonky_wire::v3::decode(&wonky_wire::v3::encode(&body).unwrap()).unwrap();
            let solid=audit(&checked).unwrap();
            let (volume,area,faces,height)=solid.measures().unwrap();
            let metric=q(0.6)*q(0.6)+q(0.8)*q(0.8);
            let factor=q(if hole{114.}else{126.})*q(scale).pow(3)*q(1e9)*metric;
            assert!(q(volume.lo())<=&factor*&pi_lo && q(volume.hi())>=&factor*&pi_hi);
            let area_factor=q(if hole{130.}else{108.})*q(scale).pow(2)*q(1e6);
            assert!(q(area.lo())<=&area_factor*&pi_lo && q(area.hi())>=&area_factor*&pi_hi);
            assert_eq!(faces.len(),if hole{6}else{5});
            // First axial moment: bottom cylinder -50, taper 76, upper cylinder 168.
            // Taper integral: integral_0^4 z*(5-3*z/4)^2 dz = 200-160+36.
            let expected=q(if hole{146.}else{194.})/q(if hole{114.}else{126.})*q(scale)*q(1000.);
            assert!(q(height.lo())<=expected && q(height.hi())>=expected);
            let mut altered=vec![];
            let mut b=body.clone();b.faces[0].forward=!b.faces[0].forward;altered.push(b);
            let mut b=body.clone();b.coedges[0].forward=!b.coedges[0].forward;altered.push(b);
            let mut b=body.clone();b.loops[0].outer=!b.loops[0].outer;altered.push(b);
            let mut b=body.clone();
            let cone=b.surfaces.iter_mut().find(|s|matches!(s.geometry,SurfaceGeometry::ConeMeridian{..})).unwrap();
            if let SurfaceGeometry::ConeMeridian{end,..}=&mut cone.geometry {end[0]=Binary64::new(end[0].get().next_up()).unwrap();}
            altered.push(b);
            let mut b=body.clone();
            if let CurveGeometry::Circle{radius,..}=&mut b.curves[0].geometry {*radius=Binary64::new(radius.get().next_up()).unwrap();}
            altered.push(b);
            for b in altered {assert!(audit(&b.check().unwrap()).is_err());}
        }
    }
}

#[test]
fn full_polygon_exact_axis_rebase_and_adjacent_refusals() {
    use wonky_ops::revolve_full::{build,in_sketch};
    let f=Affine{origin:[4.,8.,16.],x:[0.,0.6,0.8],z:[0.,0.8,-0.6]};
    let segments=[[0.,0.,2.,0.],[2.,0.,2.,1.],[2.,1.,0.,1.],[0.,1.,0.,0.]];
    let key=BodyKey{id:[1,0,0,0],revision:0};
    assert!(in_sketch(key.clone(),[0;4],f,f.origin,f.x,&segments,std::f64::consts::TAU).is_ok());
    let mut origin=f.origin;origin[1]=origin[1].next_up();
    let mut axis=f.x;axis[1]=axis[1].next_up();
    for (o,z) in [(origin,f.x),(f.origin,axis)] {
        assert_eq!(in_sketch(key.clone(),[0;4],f,o,z,&segments,std::f64::consts::TAU).unwrap_err().0,"revolve/full/axis-frame-proof-unavailable");
    }
    for a in [std::f64::consts::TAU.next_down(),std::f64::consts::TAU.next_up()] {
        assert_eq!(build(key.clone(),[0;4],Affine::IDENTITY,2,&segments,a).unwrap_err().0,"revolve/full/angle-not-full-turn");
    }
    // A displaced axis is not a near-coincident axis: admit its exact source
    // coordinates and independently check the annular washer and centroid.
    // Existing origin-only cases cannot catch a rounded inverse/subtraction.
    for frame in [Affine::IDENTITY, Affine { z: [0.,0.6,0.8], ..Affine::IDENTITY }] {
        for mode in 0..2 {
            let mut points=[[2.,5.],[4.,5.],[4.,6.],[2.,6.]];
            let mut offset=[1.,4.,0.];
            if mode==1 { for p in &mut points { p.swap(0,1); } offset.swap(0,1); }
            let segments=std::array::from_fn::<_,4,_>(|i| {let(a,b)=(points[i],points[(i+1)%4]);[a[0],a[1],b[0],b[1]]});
            let origin=frame.apply(offset,1.,true).unwrap();
            let axis=frame.columns().unwrap()[mode];
            let body=in_sketch(key.clone(),[0;4],frame,origin,axis,&segments,std::f64::consts::TAU).unwrap();
            let solid=wonky_ops::revolve_full::audit(&body.check().unwrap()).unwrap();
            let volume=solid.measures().unwrap().0;
            let determinant=q(frame.z[1]).pow(2)+q(frame.z[2]).pow(2);
            let expected=q(6.)*q(std::f64::consts::PI)*q(1e9)*determinant;
            assert!(q(volume.lo())<=expected && expected<=q(volume.hi()));
            let (lo,hi)=solid.bbox(None).unwrap();
            let center=frame.apply(if mode==0 {[3.,4.,0.]} else {[4.,3.,0.]},1000.,true).unwrap();
            for k in 0..3 { assert!(((lo[k]+hi[k])/2.-center[k]).abs()<1e-9); }
        }
    }
    let annulus=[[0.,1.,1.,1.],[1.,1.,1.,2.],[1.,2.,0.,2.],[0.,2.,0.,1.]];
    for (origin,reason) in [
        ([0.,2f64.powi(-54),0.],"axis-coordinate-not-representable"),
        ([0.,0.,2f64.powi(-52)],"axis-frame-proof-unavailable"),
        ([0.,1.5,0.],"axis-crossing-profile"),
    ] {
        assert_eq!(in_sketch(key.clone(),[0;4],Affine::IDENTITY,origin,[1.,0.,0.],&annulus,std::f64::consts::TAU).unwrap_err().0,format!("revolve/full/{reason}"));
    }
    let crossed=[[-1.,0.,2.,0.],[2.,0.,2.,1.],[2.,1.,-1.,1.],[-1.,1.,-1.,0.]];
    assert_eq!(build(key,[0;4],Affine::IDENTITY,2,&crossed,std::f64::consts::TAU).unwrap_err().0,"revolve/full/axis-crossing-profile");
}
