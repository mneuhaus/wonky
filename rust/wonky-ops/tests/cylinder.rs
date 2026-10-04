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

#[test]
fn independent_construction_frames_keep_exact_separation_and_named_overlap() {
    use wonky_ops::analytic::{self, Solid};
    let a = cyl(Spec {
        bottom: [0., 0., -0.125],
        top: [0., 0., 0.125],
        radius: 0.125,
    });
    let source = cyl(Spec {
        bottom: [-0.125, 0., 0.],
        top: [0.125, 0., 0.],
        radius: 0.125,
    });
    for x in [0.25f64.next_up(), 0.25, 0.25f64.next_down()] {
        // Different local axes, exactly the same world axis; the native
        // dispatch must not mistakenly send this to perpendicular-cylinder SSI.
        let b = moved(
            &source,
            Affine {
                origin: [x, 0., 0.],
                x: [0., 0., 1.],
                z: [0., 1., 0.],
            },
        );
        let operands = [Solid::Cylinder(a.clone()), Solid::Cylinder(b.clone())];
        let result = analytic::boolean(key(), 0, &operands);
        if x < 0.25 {
            assert_eq!(
                result.unwrap_err().0,
                "curve2/sub-resolution-feature"
            );
        } else {
            let output = result.unwrap();
            assert_eq!(output.len(), 2);
            for body in output {
                assert_eq!(checked(body).body.faces.len(), 3);
            }
            let empty = analytic::boolean(key(), 2, &operands).unwrap_err();
            assert_eq!(empty.0, "cylinder/empty-result");
            assert_eq!(empty.1, polyhedron::RefusalKind::GeometricVerdict);
            let (distance, bound) = cylinder::distance_mm(&a, &b).unwrap();
            let expected = (x - 0.25) * 1000.;
            assert!((distance - expected).abs() <= bound);
            if x > 0.25 {
                assert!(distance > bound);
            }
        }
    }
    let target = polyhedron::audit(
        &orthogonal::cuboid(key(), [0.; 3], [0.5, 0.5, 0.25])
            .unwrap()
            .check()
            .unwrap(),
    )
    .unwrap();
    for y in [(-0.125f64).next_down(), -0.125, (-0.125f64).next_up()] {
        let tool = moved(
            &source,
            Affine {
                origin: [0.25, y, 0.125],
                x: [0., 0., 1.],
                z: [0., 1., 0.],
            },
        );
        let result = cylinder::tangent_box_noop(&target, &[tool]);
        if y > -0.125 {
            assert_eq!(
                result.unwrap_err().0,
                "cylinder/cross-frame-cut-arrangement"
            );
        } else {
            let unchanged = polyhedron::audit(&result.unwrap().check().unwrap()).unwrap();
            assert_eq!(unchanged.body.faces.len(), 6);
            assert_eq!(unchanged.volume_mm3().unwrap(), 62_500_000.);
        }
    }
    // Planted near-isometry: normalization defect is tiny, but an exact
    // circular-carrier relation is not proved. No tolerance may admit it.
    let nonisometric = moved(
        &a,
        Affine {
            origin: [0.5, 0., 0.],
            x: [1f64.next_up(), 0., 0.],
            z: [0., 0., 1.],
        },
    );
    assert_eq!(
        cylinder::boolean(key(), 0, &a, &nonisometric)
            .unwrap_err()
            .0,
        "frame/non-isometric-curved-image"
    );
}

#[test]
fn coaxial_through_bore_has_exact_annular_caps_and_is_audited() {
    let a = cyl(Spec {
        bottom: [0., 0., 0.],
        top: [0., 0., 0.016],
        radius: 0.006,
    });
    let tool = cyl(Spec {
        bottom: [0., 0., -0.004],
        top: [0., 0., 0.020],
        radius: 0.002,
    });
    let body = wonky_ops::coaxial::boolean(key(), 1, &a, &[tool]).unwrap();
    let result = wonky_ops::coaxial::audit(&body.clone().check().unwrap()).unwrap();
    assert_eq!(result.body.faces.len(), 4);
    assert_eq!(
        result
            .body
            .faces
            .iter()
            .filter(|f| f.loops.len() == 2
                && matches!(
                    result.body.surfaces[f.surface.0 as usize].geometry,
                    SurfaceGeometry::Plane { .. }
                ))
            .count(),
        2
    );
    let measure = result.measure_json(None, &[]).unwrap();
    assert!(measure.contains("\"genus\":1"));
    assert!(measure.contains("\"certificate\":\"CoaxialProfile\""));
    let checked = wonky_wire::v3::decode(&wonky_wire::v3::encode(&body).unwrap()).unwrap();
    assert!(wonky_ops::coaxial::audit(&checked).is_ok());
    let mesh = wonky_ops::mesh::tessellate(&checked, 0.1).unwrap();
    assert!(!mesh.triangles.is_empty());
    let step = wonky_ops::analytic::step(
        &[("tube".into(), wonky_ops::analytic::Solid::Coaxial(result))],
        "tube",
    )
    .unwrap();
    assert!(step.contains("FACE_BOUND("));
}

#[test]
fn coaxial_blind_bore_and_stepped_union_preserve_radius_breaks() {
    let a = cyl(Spec {
        bottom: [0., 0., 0.],
        top: [0., 0., 0.016],
        radius: 0.006,
    });
    let bore = cyl(Spec {
        bottom: [0., 0., 0.004],
        top: [0., 0., 0.020],
        radius: 0.002,
    });
    let blind = wonky_ops::coaxial::boolean(key(), 1, &a, &[bore]).unwrap();
    let audit = wonky_ops::coaxial::audit(&blind.check().unwrap()).unwrap();
    assert_eq!(audit.body.faces.len(), 5);
    assert_eq!(
        audit
            .body
            .faces
            .iter()
            .filter(|f| f.loops.len() == 2
                && matches!(
                    audit.body.surfaces[f.surface.0 as usize].geometry,
                    SurfaceGeometry::Plane { .. }
                ))
            .count(),
        1
    );
    let boss = cyl(Spec {
        bottom: [0., 0., 0.016],
        top: [0., 0., 0.024],
        radius: 0.003,
    });
    let stepped = wonky_ops::coaxial::boolean(key(), 0, &a, &[boss]).unwrap();
    let audit = wonky_ops::coaxial::audit(&stepped.check().unwrap()).unwrap();
    assert_eq!(audit.body.faces.len(), 5);
    let step = wonky_ops::analytic::step(
        &[("shaft".into(), wonky_ops::analytic::Solid::Coaxial(audit))],
        "shaft",
    )
    .unwrap();
    assert!(step.contains("CYLINDRICAL_SURFACE("));
}

#[test]
fn coaxial_off_axis_planted_negative_refuses_by_name() {
    let a = cyl(Spec {
        bottom: [0., 0., 0.],
        top: [0., 0., 0.016],
        radius: 0.006,
    });
    let b = cyl(Spec {
        bottom: [0.001, 0., 0.],
        top: [0.001, 0., 0.016],
        radius: 0.002,
    });
    assert_eq!(
        wonky_ops::coaxial::boolean(key(), 1, &a, &[b])
            .unwrap_err()
            .0,
        "coaxial/non-coaxial-operand"
    );
}

// Coaxial probes and mapped boxes. Lengths are multiples of U = 2^-9 m
// (1.953125 mm), so every source coordinate is an exact binary64 and every
// expected value below follows from the meridian rectangles by hand.
const U: f64 = 0.001953125;
const UMM: f64 = 1.953125;
fn z_cyl(radius: f64, lo: f64, hi: f64) -> Cylinder {
    cyl(Spec {
        bottom: [0., 0., lo * U],
        top: [0., 0., hi * U],
        radius: radius * U,
    })
}
/// Outer R = 4U over 0..8U; bore r = U, through (tool -2U..10U) or blind.
fn tube(f: Affine, bore_from: f64) -> wonky_ops::coaxial::Coaxial {
    let body = wonky_ops::coaxial::boolean(
        key(),
        1,
        &moved(&z_cyl(4., 0., 8.), f),
        &[moved(&z_cyl(1., bore_from, 10.), f)],
    )
    .unwrap();
    wonky_ops::coaxial::audit(&body.check().unwrap()).unwrap()
}
/// Base R1 = 4U over 0..8U united with boss R2 = 2U over 8U..12U.
fn stepped_shaft(f: Affine) -> wonky_ops::coaxial::Coaxial {
    let body = wonky_ops::coaxial::boolean(
        key(),
        0,
        &moved(&z_cyl(4., 0., 8.), f),
        &[moved(&z_cyl(2., 8., 12.), f)],
    )
    .unwrap();
    wonky_ops::coaxial::audit(&body.check().unwrap()).unwrap()
}
/// Identity and a dyadic axis permutation + translation map every U-grid
/// point exactly (no rounding anywhere); the two rotations of frames() do not.
fn coaxial_frames() -> [Affine; 4] {
    let [rotated, _, _, skew] = frames();
    [
        Affine::IDENTITY,
        Affine {
            origin: [65.5, -32.75, 16.375],
            x: [0., 0., 1.],
            z: [0., -1., 0.],
        },
        rotated,
        skew,
    ]
}
/// World mm of a local point given in U. Exact for exact frames.
fn world(f: Affine, p: [f64; 3]) -> [f64; 3] {
    f.apply(p.map(|x| x * U), 1000., true).unwrap()
}
/// World mm -> local mm, as scripts/acid/native-observation.mjs passes it.
fn inverse_map(f: Affine) -> [[f64; 4]; 3] {
    let y = [
        f.z[1] * f.x[2] - f.z[2] * f.x[1],
        f.z[2] * f.x[0] - f.z[0] * f.x[2],
        f.z[0] * f.x[1] - f.z[1] * f.x[0],
    ];
    let t = f.origin.map(|x| x * 1000.);
    [f.x, y, f.z].map(|c| [c[0], c[1], c[2], -(c[0] * t[0] + c[1] * t[1] + c[2] * t[2])])
}
fn assert_probe(c: &wonky_ops::coaxial::Coaxial, f: Affine, exact: bool, p: [f64; 3], expected_u: Option<f64>) {
    let (d, inside, bound) = c.probe(world(f, p)).unwrap();
    let slack = if exact { 1e-12 } else { 1e-9 };
    match expected_u {
        // Boundary and interior points belong to the closed solid.
        None if exact => assert!(inside && d == 0., "{p:?}: {d} inside={inside}"),
        None => assert!(inside || d <= slack, "{p:?}: {d} inside={inside}"),
        Some(e) => {
            assert!(!inside, "{p:?} reported inside");
            assert!((d - e * UMM).abs() <= bound + slack, "{p:?}: {d} +/- {bound} != {}", e * UMM);
        }
    }
}

#[test]
fn coaxial_tube_probes_and_mapped_box_follow_the_meridian_rectangle() {
    for (i, f) in coaxial_frames().into_iter().enumerate() {
        let exact = i < 2;
        let t = tube(f, -2.);
        for (p, e) in [
            ([4., 0., 4.], None),                 // outer wall
            ([1., 0., 4.], None),                 // bore wall
            ([0., 3., 0.], None),                 // bottom annulus
            ([0., 0., 4.], Some(1.)),             // axis, inside the bore
            ([0., 0., 0.], Some(1.)),             // open bottom end: through bore
            ([5., 0., 4.], Some(1.)),             // radially outside
            ([0., 3., 10.], Some(2.)),            // above the annulus
            ([0., 0., 10.], Some(5f64.sqrt())),   // above the bore: inner top rim
            ([6., 0., 10.], Some(8f64.sqrt())),   // beyond the outer top rim
        ] {
            assert_probe(&t, f, exact, p, e);
        }
        let map = inverse_map(f);
        let (lo, hi) = t.bbox_in(Some(map)).unwrap();
        for (got, want) in lo.into_iter().zip([-4., -4., 0.]).chain(hi.into_iter().zip([4., 4., 8.])) {
            assert!((got - want * UMM).abs() <= if exact { 1e-12 } else { 1e-9 }, "{lo:?} {hi:?}");
        }
        assert_eq!(t.extents_mm().unwrap(), [8. * UMM, 8. * UMM, 8. * UMM]);
        let json = t.measure_json(Some(map), &[world(f, [0., 0., 4.])]).unwrap();
        assert!(json.contains("\"mappedBboxMm\":{\"min\":"), "{json}");
        assert!(json.contains("\"inside\":false"), "{json}");
    }
    // Exact membership, no epsilon: one ulp into the bore leaves the solid.
    let t = tube(Affine::IDENTITY, -2.);
    let (d, inside, _) = t.probe([UMM.next_down(), 0., 4. * UMM]).unwrap();
    assert!(!inside && d > 0. && d < 1e-12);
    assert!(t.probe([UMM.next_up(), 0., 4. * UMM]).unwrap().1);
}

#[test]
fn coaxial_stepped_shaft_probes_take_the_nearest_slab() {
    for (i, f) in coaxial_frames().into_iter().enumerate() {
        let exact = i < 2;
        let s = stepped_shaft(f);
        for (p, e) in [
            ([4., 0., 8.], None),                 // shoulder outer corner
            ([2., 0., 12.], None),                // boss top rim
            ([0., 0., 12.], None),                // boss top centre
            ([3., 0., 8.], None),                 // exposed shoulder annulus
            ([3., 0., 10.], Some(1.)),            // beside the boss
            ([4., 0., 9.], Some(1.)),             // above the shoulder
            ([6., 0., 12.], Some(4.)),            // boss slab (4) beats base (sqrt 20)
            ([0., 0., 13.], Some(1.)),            // above the boss
            ([0., 0., -1.], Some(1.)),            // below the base
        ] {
            assert_probe(&s, f, exact, p, e);
        }
        let (lo, hi) = s.bbox_in(Some(inverse_map(f))).unwrap();
        for (got, want) in lo.into_iter().zip([-4., -4., 0.]).chain(hi.into_iter().zip([4., 4., 12.])) {
            assert!((got - want * UMM).abs() <= if exact { 1e-12 } else { 1e-9 }, "{lo:?} {hi:?}");
        }
        assert_eq!(s.extents_mm().unwrap(), [8. * UMM, 8. * UMM, 12. * UMM]);
    }
}

#[test]
fn coaxial_probe_planted_negatives_blind_bore_and_lying_carrier() {
    // The through-tube's open end is empty; a blind bore (2U..10U) keeps
    // material there. A probe must tell the two apart (AC61 silent wrong).
    let blind = tube(Affine::IDENTITY, 2.);
    assert!(blind.probe([0., 0., 0.]).unwrap().1);
    assert!(blind.probe([0., 0., 2. * UMM]).unwrap().1);
    assert!(!tube(Affine::IDENTITY, -2.).probe([0., 0., 0.]).unwrap().1);
    // A carrier whose recorded bore disagrees with its geometry is refused
    // before any probe can be answered from it.
    let mut body = wonky_ops::coaxial::boolean(
        key(),
        1,
        &z_cyl(4., 0., 8.),
        &[z_cyl(1., -2., 10.)],
    )
    .unwrap();
    let bore = body
        .constructions
        .iter_mut()
        .filter(|n| n.parameters.len() == 7 && n.parameters[6].get() == U)
        .collect::<Vec<_>>();
    assert_eq!(bore.len(), 1);
    bore.into_iter().next().unwrap().parameters[6] = Binary64::new(1.5 * U).unwrap();
    assert_eq!(
        wonky_ops::coaxial::audit(&body.check().unwrap()).unwrap_err().0,
        "coaxial/construction-carrier-mismatch"
    );
}
