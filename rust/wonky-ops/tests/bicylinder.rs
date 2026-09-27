//! Geometry owner: independent closed forms, cap admission at adjacent binary64
//! inputs, and replay binding. JS separately owns interpreter record lifetimes.
use wonky_contract::{Binary64, BodyKey, CurveGeometry, PcurveGeometry};
use wonky_ops::{
    affine::Affine,
    analytic::{self, Solid},
    bicylinder::{self, Bicylinder},
    cylinder::{self, Spec},
};
fn key() -> BodyKey {
    BodyKey {
        id: [19, 8, 3, 7],
        revision: 0,
    }
}
fn tool(axis: usize, center: [f64; 3], r: f64, extent: f64, frame: Affine) -> cylinder::Cylinder {
    let mut bottom = center;
    let mut top = center;
    bottom[axis] -= extent;
    top[axis] += extent;
    let c = cylinder::audit(
        &cylinder::create(
            key(),
            Spec {
                bottom,
                top,
                radius: r,
            },
        )
        .unwrap()
        .check()
        .unwrap(),
    )
    .unwrap();
    cylinder::audit(&cylinder::transform(&c, frame).unwrap().check().unwrap()).unwrap()
}
fn cut(a: &cylinder::Cylinder, b: &cylinder::Cylinder) -> Bicylinder {
    let mut out = analytic::boolean(
        key(),
        2,
        &[Solid::Cylinder(a.clone()), Solid::Cylinder(b.clone())],
    )
    .unwrap();
    assert_eq!(out.len(), 1);
    let words = wonky_wire::v3::encode(&out.pop().unwrap()).unwrap();
    match analytic::audit(&wonky_wire::v3::decode(&words).unwrap()).unwrap() {
        Solid::Bicylinder(p) => p,
        _ => panic!("wrong carrier"),
    }
}
#[test]
fn perpendicular_intersection_keeps_vector_conics_and_independent_measures() {
    for k in 0..3 {
        for r in [0.003, 0.011, 0.032] {
            for frame in [
                Affine::IDENTITY,
                Affine {
                    origin: [65.53625, -32.7685, 16.384125],
                    x: [0.6, 0.8, 0.],
                    z: [0., 0., 1.],
                },
            ] {
                let center = [0.03125, -0.0625, 0.125];
                let (a, b) = ((k + 1) % 3, (k + 2) % 3);
                let p = cut(
                    &tool(a, center, r, 0.25, frame),
                    &tool(b, center, r, 0.25, frame),
                );
                assert_eq!(p.body.faces.len(), 4);
                assert_eq!(p.body.edges.len(), 4);
                assert_eq!(p.body.vertices.len(), 2);
                for c in &p.body.curves {
                    assert!(matches!(c.geometry, CurveGeometry::VectorEllipse { .. }));
                    assert_eq!(c.supports.len(), 2);
                }
                for pc in &p.body.pcurves {
                    assert!(matches!(pc.geometry, PcurveGeometry::Harmonic { .. }));
                }
                for i in 0..4 {
                    let uses = p
                        .body
                        .coedges
                        .iter()
                        .filter(|u| u.edge.0 == i)
                        .collect::<Vec<_>>();
                    assert_eq!(uses.len(), 2);
                    assert_ne!(uses[0].forward, uses[1].forward);
                }
                let (v, s) = p.measures_mm().unwrap();
                let rr = r * 1000.;
                let volume = 16. * rr.powi(3) / 3.;
                let area = 16. * rr * rr;
                assert!((v.m - volume).abs() <= v.r + volume * 1e-15);
                assert!((s.m - area).abs() <= s.r + area * 1e-15);
                for (qa, qb, qk, d, inside) in [
                    (0., 0., 1.5, 0.5, false),
                    (1.25, 1.25, 0., 0.25 * 2_f64.sqrt(), false),
                    (1.5, 0.25, 0., 0.5, false),
                    (0.1, 0.2, 0.3, 0., true),
                ] {
                    let mut q = center;
                    q[a] += qa * r;
                    q[b] += qb * r;
                    q[k] += qk * r;
                    let (distance, is_inside, bound) =
                        p.probe(frame.apply(q, 1000., true).unwrap()).unwrap();
                    assert_eq!(is_inside, inside);
                    assert!(
                        (distance - d * rr).abs() <= bound + 2e-11,
                        "{distance} vs {} bound {bound}",
                        d * rr
                    );
                }
            }
        }
    }
}
#[test]
fn exact_caps_radius_and_frame_admission_never_weld_nearby_inputs() {
    let a = tool(0, [0.; 3], 0.125, 0.25, Affine::IDENTITY);
    for extent in [0.125, 0.125_f64.next_down()] {
        let b = tool(1, [0.; 3], 0.125, extent, Affine::IDENTITY);
        assert_eq!(
            bicylinder::intersect(key(), &a, &b).unwrap_err().0,
            "bicylinder/end-cap-arrangement"
        );
    }
    let b = tool(1, [0.; 3], 0.125, 0.125_f64.next_up(), Affine::IDENTITY);
    cut(&a, &b);
    let b = tool(1, [0.; 3], 0.125_f64.next_up(), 0.25, Affine::IDENTITY);
    assert_eq!(
        bicylinder::intersect(key(), &a, &b).unwrap_err().0,
        "bicylinder/requires-perpendicular-equal-radii"
    );
    let b = tool(1, [0., 0., f64::EPSILON], 0.125, 0.25, Affine::IDENTITY);
    assert_eq!(
        bicylinder::intersect(key(), &a, &b).unwrap_err().0,
        "bicylinder/skew-axes"
    );
    let b = tool(
        1,
        [0.; 3],
        0.125,
        0.25,
        Affine {
            origin: [f64::EPSILON, 0., 0.],
            ..Affine::IDENTITY
        },
    );
    assert_eq!(
        bicylinder::intersect(key(), &a, &b).unwrap_err().0,
        "bicylinder/different-exact-frames"
    );
}
#[test]
fn replay_rejects_edited_conics_charts_and_open_boundaries() {
    let a = tool(0, [0.; 3], 0.125, 0.25, Affine::IDENTITY);
    let b = tool(1, [0.; 3], 0.125, 0.25, Affine::IDENTITY);
    let p = cut(&a, &b);
    for kind in 0..3 {
        let mut body = p.body.clone();
        match kind {
            0 => {
                if let CurveGeometry::VectorEllipse { sine, .. } = &mut body.curves[0].geometry {
                    sine[0] = Binary64::new(0.25).unwrap();
                }
            }
            1 => {
                if let PcurveGeometry::Harmonic { sine, .. } = &mut body.pcurves[0].geometry {
                    sine[1] = Binary64::new(0.25).unwrap();
                }
            }
            _ => {
                body.coedges[0].forward = !body.coedges[0].forward;
            }
        }
        let checked = body.check().unwrap();
        assert_eq!(
            bicylinder::audit(&checked).unwrap_err().0,
            "bicylinder/construction-carrier-mismatch"
        );
    }
}
