//! Geometry contract owner: independent rational binary64 oracles and planted
//! carrier corruption. JS tests separately own interpreter transport/lifecycle.
use num_traits::{Signed, ToPrimitive};
use wonky_contract::{Binary64, Body, BodyKey, SurfaceGeometry};
use wonky_ops::{
    affine::Affine,
    cylinder::{self, Cylinder, Spec},
    orthogonal, polyhedron,
};
use wonky_oracle::binary64;
fn key() -> BodyKey {
    BodyKey {
        id: [11, 22, 33, 44],
        revision: 0,
    }
}
fn spec(x: f64, y: f64, lo: f64, hi: f64) -> Spec {
    Spec {
        bottom: [x, y, lo],
        top: [x, y, hi],
        radius: 0.004,
    }
}
fn checked(b: Body) -> Cylinder {
    cylinder::audit(&b.check().unwrap()).unwrap()
}
fn cyl(s: Spec) -> Cylinder {
    checked(cylinder::create(key(), s).unwrap())
}
fn moved(c: &Cylinder, f: Affine) -> Cylinder {
    checked(cylinder::transform(c, f).unwrap())
}
fn frames() -> [Affine; 4] {
    [
        Affine {
            origin: [
                0.4995830860227657,
                0.49987329024944255,
                0.00022344449278308316,
            ],
            x: [
                0.9953610106153096,
                0.08075849942674315,
                -0.05229266982293196,
            ],
            z: [
                0.05443374184663523,
                -0.024540530893688527,
                0.9982157733135806,
            ],
        },
        Affine::IDENTITY,
        Affine {
            origin: [65.53625, -32.7685, 16.384125],
            x: [0., 0., 1.],
            z: [0., -1., 0.],
        },
        Affine {
            origin: [-0.031, 0.012, 0.007],
            x: [0.6, 0.8, 0.],
            z: [0., 0., 1.],
        },
    ]
}
#[test]
fn coaxial_shared_cap_union_removes_disc_and_keeps_exact_inputs() {
    for f in frames() {
        let a = moved(&cyl(spec(0., 0., 0., 0.008)), f);
        let b = moved(&cyl(spec(0., 0., 0.008, 0.016)), f);
        let out = cylinder::boolean(key(), 0, &a, &b).unwrap();
        assert_eq!(out.len(), 1);
        let c = checked(out.into_iter().next().unwrap());
        assert_eq!(c.body.faces.len(), 3);
        assert_eq!(c.body.edges.len(), 3);
        assert_eq!(c.body.vertices.len(), 2);
        assert_eq!(c.spec.top[2].to_bits(), 0.016f64.to_bits());
        let (v, area) = c.measures_mm().unwrap();
        // Independent high-precision closed forms, much tighter than acceptance.
        for (iv, expected) in [(v, 804.2477193189871), (area, 502.6548245743669)] {
            assert!(
                iv.lo() <= expected && expected <= iv.hi(),
                "{iv:?} excludes {expected}"
            );
            assert!(iv.r / iv.m < 1e-12);
        }
        let wire = wonky_wire::v3::encode(&c.body).unwrap();
        assert!(cylinder::audit(&wonky_wire::v3::decode(&wire).unwrap()).is_ok());
    }
    let c = cyl(spec(0., 0., 0., 0.016));
    for (p, expected) in [([0., 0., 20.], 4.), ([7., 0., 8.], 3.)] {
        let (d, inside, bound) = c.probe(p).unwrap();
        assert!(!inside);
        assert!((d - expected).abs() <= bound);
    }
}
#[test]
fn binary64_tangency_gap_and_overlap_are_not_tolerance_welded() {
    let a = cyl(spec(0., 0., 0., 0.016));
    for x in [0.008f64.next_down(), 0.008, 0.008f64.next_up()] {
        let b = cyl(spec(x, 0., 0., 0.016));
        let gap = binary64(x).unwrap() - binary64(0.004).unwrap() - binary64(0.004).unwrap();
        for f in frames() {
            let (a, b) = (moved(&a, f), moved(&b, f));
            let result = cylinder::boolean(key(), 0, &a, &b);
            if gap.is_negative() {
                assert_eq!(
                    result.unwrap_err().0,
                    "cylinder/parallel-overlap-arrangement"
                );
            } else {
                let out = result.unwrap();
                assert_eq!(out.len(), 2);
                for c in out {
                    assert_eq!(checked(c).body.faces.len(), 3);
                }
                let (d, bound) = cylinder::distance_mm(&a, &b).unwrap();
                let expected = gap.to_f64().unwrap() * 1000.;
                assert!(
                    (d - expected).abs() <= bound,
                    "gap {d} +/- {bound} != {expected}"
                );
                if gap.is_positive() {
                    assert!(d > bound);
                } else {
                    assert_eq!((d, bound), (0., 0.));
                }
            }
        }
    }
    let mut gap = spec(0., 0., 0.008f64.next_up(), 0.016);
    let a = cyl(spec(0., 0., 0., 0.008));
    assert_eq!(cylinder::boolean(key(), 0, &a, &cyl(gap)).unwrap().len(), 2);
    gap.bottom[2] = 0.008;
    assert_eq!(cylinder::boolean(key(), 0, &a, &cyl(gap)).unwrap().len(), 1);
}
#[test]
fn box_tangent_cutter_noop_requires_exact_separation_for_every_cell() {
    let target = polyhedron::audit(
        &orthogonal::cuboid(key(), [0.; 3], [0.016, 0.016, 0.008])
            .unwrap()
            .check()
            .unwrap(),
    )
    .unwrap();
    for y in [(-0.004f64).next_down(), -0.004, (-0.004f64).next_up()] {
        let cutter = cyl(spec(0.008, y, -0.002, 0.010));
        for f in frames() {
            let target =
                polyhedron::audit(&orthogonal::transform(&target, f).unwrap().check().unwrap())
                    .unwrap();
            let out = cylinder::tangent_box_noop(&target, &[moved(&cutter, f)]);
            if y > -0.004 {
                assert_eq!(out.unwrap_err().0, "cylinder/box-cylinder-cut-arrangement");
            } else {
                let a = polyhedron::audit(&out.unwrap().check().unwrap()).unwrap();
                assert_eq!(a.body.faces.len(), 6);
                assert!((a.volume_mm3().unwrap() - 2048.).abs() < 1e-10);
            }
        }
    }
}
#[test]
fn carriers_and_unsupported_ssi_refuse_instead_of_certifying_wrong_geometry() {
    let c = cyl(spec(0., 0., 0., 0.016));
    let mut corrupt = c.body.clone();
    if let SurfaceGeometry::Cylinder { radius, .. } = &mut corrupt.surfaces[2].geometry {
        *radius = Binary64::new(0.008).unwrap();
    }
    assert_eq!(
        cylinder::audit(&corrupt.check().unwrap()).unwrap_err().0,
        "cylinder/construction-carrier-mismatch"
    );
    let other = cyl(Spec {
        bottom: [-0.010, 0., 0.008],
        top: [0.010, 0., 0.008],
        radius: 0.004,
    });
    assert_eq!(
        cylinder::boolean(key(), 0, &c, &other).unwrap_err().0,
        "cylinder/general-quadric-ssi"
    );
    for s in [
        Spec {
            radius: 0.,
            ..c.spec
        },
        Spec {
            top: [1., 1., 1.],
            ..c.spec
        },
    ] {
        assert!(cylinder::create(key(), s).is_err());
    }
    // Binary64 0.004 metres is slightly larger than exactly 4 mm. The
    // exact query is inside; proximity no longer manufactures a refusal.
    assert!(c.probe([4., 0., 8.]).unwrap().1);
}

#[test]
fn oblique_cylinder_mapped_bbox_handles_near_zero_radial_norm() {
    let frame = frames()[0];
    let c = moved(&cyl(spec(0., 0., 0., 0.016)), frame);
    let cols = frame.columns().unwrap();
    let mut map = [[0.; 4]; 3];
    for i in 0..3 {
        for j in 0..3 {
            map[i][j] = cols[i][j];
            map[i][3] -= cols[i][j] * frame.origin[j] * 1000.;
        }
    }
    let (lo, hi) = c.bbox_mm(Some(map)).unwrap();
    for i in 0..3 {
        assert!((lo[i] - [-4., -4., 0.][i]).abs() < 1e-9);
        assert!((hi[i] - [4., 4., 16.][i]).abs() < 1e-9);
    }
}

#[test]
fn partial_shared_caps_cannot_be_reported_as_two_disjoint_solids() {
    let a = cyl(spec(0., 0., 0., 0.008));
    let b = cyl(Spec {
        radius: 0.002,
        ..spec(0., 0., 0.008, 0.016)
    });
    assert_eq!(
        cylinder::boolean(key(), 0, &a, &b).unwrap_err().0,
        "cylinder/cap-contact-arrangement"
    );
    assert_eq!(cylinder::boolean(key(), 1, &a, &b).unwrap().len(), 1);
    assert_eq!(
        cylinder::boolean(key(), 2, &a, &b).unwrap_err().0,
        "cylinder/empty-result"
    );
}

#[test]
fn axial_separation_cap_point_contact_and_tangent_distance_have_distinct_contracts() {
    let a = cyl(spec(0., 0., 0., 0.008));
    let point_contact = cyl(spec(0.008, 0., 0.008, 0.016));
    assert_eq!(
        cylinder::boolean(key(), 0, &a, &point_contact)
            .unwrap()
            .len(),
        2
    );
    for b in [
        cyl(spec(0.012, 0., 0.008, 0.016)),
        cyl(spec(0.012, 0., -0.008, 0.)),
    ] {
        for (a, b) in [(&a, &b), (&b, &a)] {
            let (d, e) = cylinder::distance_mm(a, b).unwrap();
            assert!((d - 4.).abs() <= e);
        }
    }
    for b in [
        cyl(spec(0., 0., 0.009, 0.016)),
        cyl(spec(0., 0., -0.008, -0.001)),
    ] {
        for (a, b) in [(&a, &b), (&b, &a)] {
            assert_eq!(
                cylinder::distance_mm(a, b).unwrap_err().0,
                "cylinder/distance-disjoint-axial-intervals"
            );
        }
    }
    let target = polyhedron::audit(
        &orthogonal::cuboid(key(), [0.; 3], [0.016, 0.016, 0.008])
            .unwrap()
            .check()
            .unwrap(),
    )
    .unwrap();
    for (lo, hi) in [(-0.010, -0.001), (0.009, 0.010)] {
        let b = cyl(spec(0.008, 0.008, lo, hi));
        let out = cylinder::tangent_box_noop(&target, &[b]).unwrap();
        assert_eq!(out.faces.len(), 6);
        let a = polyhedron::audit(&out.check().unwrap()).unwrap();
        assert!((a.volume_mm3().unwrap() - 2048.).abs() < 1e-10);
    }
}
