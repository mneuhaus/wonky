//! Owner of axial construction incidence, enclosures and exact admission.
//! Credible failures: accepting a rounded intersection, swapping a band face,
//! losing the affine determinant, or translating the cylinder twice. Existing
//! sphere coverage has no cylinder/latitude boundary; no test-only seam needed.
use wonky_contract::*;
use wonky_num::Iv;
use wonky_ops::{affine::Affine, axial, sphere};

fn key(n: u32) -> BodyKey {
    BodyKey {
        id: [n, 0, 0, 0],
        revision: 0,
    }
}
fn cylinder(x: f64, bottom: f64, top: f64, radius: f64) -> axial::Axial {
    let body = axial::cylinder(key(2), [x, 0., bottom], [x, 0., top], radius).unwrap();
    axial::audit(&body.check().unwrap()).unwrap()
}
fn ball(center: [f64; 3], radius: f64) -> sphere::Spherical {
    sphere::audit(
        &sphere::sphere(key(1), center, radius)
            .unwrap()
            .check()
            .unwrap(),
    )
    .unwrap()
}
fn band() -> Body {
    axial::subtract(key(3), &ball([0.; 3], 0.625), &cylinder(0., -1., 1., 0.375)).unwrap()
}
fn contains(v: Iv, x: f64) {
    assert!(v.lo() <= x && v.hi() >= x, "{x} outside {v:?}");
    assert!(v.r < 1e-8 * x.abs().max(1.));
}
#[test]
fn axial_measures_enclose_independent_rational_pi_formulas() {
    use num_rational::BigRational;
    let q = |x| BigRational::from_float(x).unwrap();
    let lower: BigRational = "314159265358979323846264338327950288419716939937510/100000000000000000000000000000000000000000000000000".parse().unwrap();
    let upper: BigRational = "314159265358979323846264338327950288419716939937511/100000000000000000000000000000000000000000000000000".parse().unwrap();
    let a =
        axial::audit(&wonky_wire::v3::decode(&wonky_wire::v3::encode(&band()).unwrap()).unwrap())
            .unwrap();
    let c = cylinder(0.25, 0.5, 1.5, 0.375);
    for (solid, volume_scale, area_scale) in [
        (
            &a,
            q(1000.) * q(1000.) * q(1000.) / q(6.),
            q(2.) * q(1000.) * q(1000.),
        ),
        (&c, q(375.) * q(375.) * q(1000.), q(2.) * q(375.) * q(1375.)),
    ] {
        let (volume, area, faces) = solid.measures_mm().unwrap();
        for (value, scale) in [(volume, volume_scale), (area, area_scale)] {
            assert!(q(value.lo()) <= &lower * &scale);
            assert!(q(value.hi()) >= &upper * &scale);
            assert!(value.r / value.m < 1e-12);
        }
        assert_eq!(faces.len(), solid.body().faces.len());
    }
    let (lo, hi) = c.bbox_mm(None).unwrap();
    assert_eq!(lo, [-125., -375., 500.]);
    assert_eq!(hi, [625., 375., 1500.]);
    let (lo, hi) = a.bbox_mm(None).unwrap();
    for k in 0..3 {
        let extent = if k == 2 { 500. } else { 625. };
        assert!((lo[k] + extent).abs() < 1e-9);
        assert!((hi[k] - extent).abs() < 1e-9);
    }
    for (point, expected, inside) in [
        ([0., 0., 0.], 375., false),
        ([0., 0., 1000.], 625., false),
        ([700., 0., 0.], 75., false),
        ([500., 0., 0.], 0., true),
        ([375., 0., 500.], 0., true),
        ([375_f64.next_down(), 0., 500.], 0., false),
    ] {
        let (distance, actual_inside) = a.probe_mm(point).unwrap();
        assert_eq!(actual_inside, inside);
        if expected > 0. || inside {
            contains(distance, expected);
        }
    }
    // Translation is exact in source space, not counted twice in observations.
    let translated = axial::subtract(
        key(4),
        &ball([0., 0., 0.25], 0.625),
        &cylinder(0., -1., 1., 0.375),
    )
    .unwrap();
    let translated = axial::audit(&translated.check().unwrap()).unwrap();
    assert!(translated.probe_mm([375., 0., 750.]).unwrap().1);
    contains(translated.probe_mm([0., 0., 250.]).unwrap().0, 375.);
    let frame = Affine {
        origin: [262.144, -131.072, 65.536],
        x: [1.00000000001, 0., 0.],
        z: [0., 0., 1.],
    };
    let placed = axial::audit(&a.transform(frame).unwrap().check().unwrap()).unwrap();
    let (volume, area, _) = placed.measures_mm().unwrap();
    let det = q(frame.x[0]) * q(frame.x[0]);
    let scale = q(1000.) * q(1000.) * q(1000.) / q(6.) * det;
    assert!(q(volume.lo()) <= &lower * &scale && q(volume.hi()) >= &upper * &scale);
    assert!(area.r > a.measures_mm().unwrap().1.r);
}
#[test]
fn axial_admission_refuses_rounded_incidence_and_wrong_tool_coverage() {
    let s = ball([0.; 3], 0.625);
    for (tool, reason) in [
        (
            cylinder(0., -1., 1., 0.375_f64.next_up()),
            "height-needs-algebraic-coordinate",
        ),
        (
            cylinder(0., -1., 1., 0.375_f64.next_down()),
            "height-needs-algebraic-coordinate",
        ),
        (cylinder(0.125, -1., 1., 0.375), "non-coaxial-tool"),
        (
            cylinder(0., -0.625_f64.next_down(), 1., 0.375),
            "tool-does-not-cover-sphere",
        ),
        (
            cylinder(0., -1., 0.625_f64.next_down(), 0.375),
            "tool-does-not-cover-sphere",
        ),
        (cylinder(0., -1., 1., 0.625), "empty-or-degenerate-band"),
    ] {
        assert_eq!(
            axial::subtract(key(3), &s, &tool).unwrap_err().0,
            format!("axial/{reason}")
        );
    }
    assert!(axial::subtract(key(3), &s, &cylinder(0., -0.625, 0.625, 0.375)).is_ok());
    assert_eq!(
        axial::cylinder(key(2), [0.; 3], [1., 0., 1.], 0.375)
            .unwrap_err()
            .0,
        "axial/non-axial-cylinder"
    );
}
#[test]
fn axial_audit_rejects_corrupt_carriers_charts_roots_and_orientation() {
    let original = band();
    let corruptions: [fn(&mut Body); 5] = [
        |b| b.vertices[0].point[0] = Binary64::new(0.5).unwrap(),
        |b| {
            b.pcurves[1].geometry = PcurveGeometry::SphereLatitude {
                height: Binary64::new(-0.25).unwrap(),
            }
        },
        |b| b.constructions[2].parameters[6] = Binary64::new(0.25).unwrap(),
        |b| b.faces[0].forward = true,
        |b| b.curves[0].provenance = Provenance::Construction { node: NodeId(1) },
    ];
    for mutate in corruptions {
        let mut body = original.clone();
        mutate(&mut body);
        let checked = body.check().unwrap();
        assert!(axial::audit(&checked).is_err());
    }
}
