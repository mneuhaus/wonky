//! Owns radical-circle construction binding, cap enclosures and admission.
//! Host tests separately own Boolean lifecycle and unhealed STEP round trips.
use wonky_contract::*;
use wonky_ops::{affine::Affine, analytic, lens, sphere};
fn key(n: u32) -> BodyKey {
    BodyKey {
        id: [n, 0, 0, 0],
        revision: 0,
    }
}
fn ball(c: [f64; 3], r: f64) -> sphere::Spherical {
    sphere::audit(&sphere::sphere(key(1), c, r).unwrap().check().unwrap()).unwrap()
}
fn body(k: usize) -> Body {
    let mut a = [0.25, -0.5, 0.125];
    let mut b = a;
    a[k] -= 0.25;
    b[k] += 0.25;
    lens::intersect(key(3), &ball(a, 0.5), &ball(b, 0.5)).unwrap()
}
#[test]
fn radical_ring_and_cap_enclosures_survive_codec_and_affine_placement() {
    use num_rational::BigRational;
    let q = |x| BigRational::from_float(x).unwrap();
    let pi_lo:BigRational="314159265358979323846264338327950288419716939937510/100000000000000000000000000000000000000000000000000".parse().unwrap();
    let pi_hi:BigRational="314159265358979323846264338327950288419716939937511/100000000000000000000000000000000000000000000000000".parse().unwrap();
    for k in 0..3 {
        let wire = wonky_wire::v3::encode(&body(k)).unwrap();
        let a = lens::audit(&wonky_wire::v3::decode(&wire).unwrap()).unwrap();
        assert_eq!(a.body().vertices.len(), 0);
        assert_eq!(a.body().edges[0].vertices.len(), 0);
        assert_eq!(a.body().surfaces.len(), 2);
        for f in [
            Affine::IDENTITY,
            Affine {
                origin: [64., -32., 16.],
                x: [1.00000000001, 0., 0.],
                z: [0., 0., 1.],
            },
        ] {
            let placed = lens::audit(&a.transform(f).unwrap().check().unwrap()).unwrap();
            let (v, area, faces) = placed.measures_mm().unwrap();
            let det = q(f.x[0]) * q(f.x[0]);
            let volume_scale = q(2.) * q(250.) * q(250.) * q(1250.) / q(3.) * det;
            assert!(q(v.lo()) <= &pi_lo * &volume_scale && q(v.hi()) >= &pi_hi * &volume_scale);
            assert!(v.r / v.m < 1e-12);
            assert_eq!(faces.len(), 2);
            let area_scale = q(500000.);
            assert!(q(area.lo()) <= &pi_lo * &area_scale && q(area.hi()) >= &pi_hi * &area_scale);
        }
        let center = [250., -500., 125.];
        let (lo, hi) = a.bbox_mm(None).unwrap();
        for j in 0..3 {
            let h = if j == k { 250. } else { 250. * 3_f64.sqrt() };
            assert!((lo[j] - (center[j] - h)).abs() < 1e-9);
            assert!((hi[j] - (center[j] + h)).abs() < 1e-9);
        }
        assert!(a.probe_mm(center).unwrap().1);
        let mut pole = center;
        pole[k] += 250.;
        assert!(a.probe_mm(pole).unwrap().1);
        pole[k] = pole[k].next_up();
        assert!(!a.probe_mm(pole).unwrap().1);
        let mut q = center;
        q[k] += 500.;
        let d = a.probe_mm(q).unwrap().0;
        assert!(d.lo() <= 250. && d.hi() >= 250.);
        let mut q = center;
        q[(k + 1) % 3] += 500.;
        let d = a.probe_mm(q).unwrap().0;
        let expected = 500. - 250. * 3_f64.sqrt();
        assert!(d.lo() <= expected && d.hi() >= expected);
    }
}
#[test]
fn exact_admission_never_snaps_tangency_or_unequal_spheres() {
    let a = ball([0.; 3], 0.5);
    for (center, radius, reason) in [
        ([1., 0., 0.], 0.5, "non-transverse-spheres"),
        ([1_f64.next_up(), 0., 0.], 0.5, "non-transverse-spheres"),
        ([0.5, 0., 0.], 0.5_f64.next_up(), "unequal-radii"),
        ([0.5, 0.125, 0.], 0.5, "centers-need-one-source-axis"),
        ([0.; 3], 0.5, "centers-need-one-source-axis"),
    ] {
        assert_eq!(
            lens::intersect(key(3), &a, &ball(center, radius))
                .unwrap_err()
                .0,
            format!("lens/{reason}")
        );
    }
    let thin = lens::intersect(key(3), &a, &ball([1_f64.next_down(), 0., 0.], 0.5)).unwrap();
    let thin = lens::audit(&thin.check().unwrap()).unwrap();
    assert!(thin.measures_mm().unwrap().0.lo() > 0.);
    let moved = sphere::transform(
        &a,
        Affine {
            origin: [1., 0., 0.],
            ..Affine::IDENTITY
        },
    )
    .unwrap();
    let moved = sphere::audit(&moved.check().unwrap()).unwrap();
    assert_eq!(
        lens::intersect(key(3), &a, &moved).unwrap_err().0,
        "lens/different-exact-frames"
    );
}
#[test]
fn audit_rejects_changed_radical_inputs_supports_and_winding() {
    for plant in 0..8 {
        let mut b = body(0);
        match plant {
            0 => {
                if let CurveGeometry::SphereCircle { height, .. } = &mut b.curves[0].geometry {
                    *height = Binary64::new(0.25_f64.next_up()).unwrap();
                }
            }
            1 => {
                if let CurveGeometry::SphereCircle { sphere_radius, .. } = &mut b.curves[0].geometry
                {
                    *sphere_radius = Binary64::new(0.5_f64.next_up()).unwrap();
                }
            }
            2 => {
                if let CurveGeometry::SphereCircle { origin, .. } = &mut b.curves[0].geometry {
                    origin[0] = Binary64::new(0.25_f64.next_up()).unwrap();
                }
            }
            3 => {
                b.coedges[1].forward = true;
            }
            4 => {
                b.faces[1].forward = false;
            }
            5 => {
                b.constructions[4].parents.swap(0, 1);
            }
            6 => {
                if let PcurveGeometry::SphereLatitude { height } = &mut b.pcurves[1].geometry {
                    *height = Binary64::new(0.25).unwrap();
                }
            }
            7 => {
                if let SurfaceGeometry::Sphere { radius, .. } = &mut b.surfaces[1].geometry {
                    *radius = Binary64::new(0.5_f64.next_up()).unwrap();
                }
            }
            _ => unreachable!(),
        }
        let checked = b.check().unwrap();
        assert!(lens::audit(&checked).is_err(), "plant {plant}");
        assert!(
            analytic::audit(&checked).is_err(),
            "dispatch hid plant {plant}"
        );
    }
    let mut b = body(0);
    b.curves[0].geometry = CurveGeometry::Circle {
        origin: [Binary64::new(0.).unwrap(); 3],
        normal: [
            Binary64::new(1.).unwrap(),
            Binary64::new(0.).unwrap(),
            Binary64::new(0.).unwrap(),
        ],
        x: [
            Binary64::new(0.).unwrap(),
            Binary64::new(1.).unwrap(),
            Binary64::new(0.).unwrap(),
        ],
        radius: Binary64::new(0.4330127018922193).unwrap(),
        arc: ArcKind::Full {},
    };
    assert!(
        b.check().is_err(),
        "rounded replacement cannot retain endpoint-free exact ring"
    );
}
