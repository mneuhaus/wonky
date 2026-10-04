//! Native owner: exact width/trim predicates, carrier/source binding and
//! independently derived frustum integrals. JS owns query/STEP transport.
use wonky_contract::{Binary64, BodyKey, SurfaceGeometry};
use wonky_ops::{
    affine::Affine,
    chamfer_rim::{self, Conical},
    cylinder::{self, Cylinder, Spec},
};
fn cylinder(axis: usize) -> Cylinder {
    let bottom = [0.125, -0.25, 0.0625];
    let mut top = bottom;
    top[axis] += 0.5;
    cylinder::audit(
        &cylinder::create(
            BodyKey {
                id: [7, 8, 9, 10],
                revision: 0,
            },
            Spec {
                bottom,
                top,
                radius: 0.25,
            },
        )
        .unwrap()
        .check()
        .unwrap(),
    )
    .unwrap()
}
fn rim(c: &Cylinder, edges: &[usize]) -> Conical {
    chamfer_rim::audit(
        &chamfer_rim::equal_offsets(c, edges, 0.0625)
            .unwrap()
            .check()
            .unwrap(),
    )
    .unwrap()
}
#[test]
fn one_or_both_rims_have_exact_sewn_cones_and_independent_frustum_measures() {
    let r = 0.25_f64;
    let w = 0.0625_f64;
    let h = 0.5_f64;
    for axis in 0..3 {
        for edges in [&[0][..], &[1][..], &[0, 1][..]] {
            let c = cylinder(axis);
            let a = rim(&c, edges);
            let count = edges.len() as f64;
            let (volume, area) = a.measures_mm().unwrap();
            let expected =
                std::f64::consts::PI * (r * r * h - count * (r * w * w - w.powi(3) / 3.)) * 1e9;
            assert!((volume.m - expected).abs() <= volume.r + expected * 1e-15);
            let expected_area = std::f64::consts::PI
                * (2. * r * h - 2. * r * w * count
                    + (2. - count) * r * r
                    + count * (r - w).powi(2)
                    + count * (2. * r - w) * w * 2_f64.sqrt())
                * 1e6;
            assert!((area.m - expected_area).abs() <= area.r + expected_area * 1e-15);
            assert_eq!(a.body.faces.len(), 3 + edges.len());
            assert_eq!(
                a.body
                    .surfaces
                    .iter()
                    .filter(|s| matches!(s.geometry, SurfaceGeometry::ConeSlope { .. }))
                    .count(),
                edges.len()
            );
            let centroid = a.centroid_mm().unwrap();
            let removed = r * w * w - w.powi(3) / 3.;
            // Removed upper annulus: integrate z*(R²-(R+w-h+z)²).
            let removed_moment = (h - w) * removed + 2. * r * w.powi(3) / 3. - w.powi(4) / 4.;
            let moment = if edges == [1] {
                r * r * h * h / 2. - removed_moment
            } else if edges == [0] {
                r * r * h * h / 2. - (h * removed - removed_moment)
            } else {
                (r * r * h - 2. * removed) * h / 2.
            };
            let z = moment / (r * r * h - count * removed) + c.spec.bottom[axis];
            assert!((centroid[axis] - z * 1000.).abs() < 1e-10);
            for i in 0..3 {
                if i != axis {
                    assert!((centroid[i] - c.spec.bottom[i] * 1000.).abs() < 1e-10);
                }
            }
            let words = wonky_wire::v3::encode(&a.body).unwrap();
            assert!(chamfer_rim::audit(&wonky_wire::v3::decode(&words).unwrap()).is_ok());
        }
    }
}
#[test]
fn cone_membership_resolves_the_closed_boundary_and_neighboring_floats() {
    let c = cylinder(2);
    let a = rim(&c, &[1]);
    let z = (c.spec.top[2] - 0.03125) * 1000.;
    let radial = c.spec.bottom[0] * 1000. + 218.75;
    let at = |x| [x, c.spec.bottom[1] * 1000., z];
    assert!(a.probe(at(radial)).unwrap().1);
    assert!(a.probe(at(radial.next_down())).unwrap().1);
    let (d, inside, bound) = a.probe(at(radial.next_up())).unwrap();
    assert!(!inside);
    assert!(d >= 0. && bound.is_finite());
    let (d, inside, bound) = a.probe(at(radial + 1.)).unwrap();
    assert!(!inside);
    assert!((d - 1. / 2_f64.sqrt()).abs() <= bound + 1e-12);
    let (lo, hi) = a.bbox_mm(None).unwrap();
    assert_eq!(lo[2], c.spec.bottom[2] * 1000.);
    assert_eq!(hi[2], c.spec.top[2] * 1000.);
}
#[test]
fn invalid_offsets_and_corrupted_carriers_never_become_successful_solids() {
    let c = cylinder(2);
    for (edges, width, reason) in [
        (&[1][..], 0., "width"),
        (&[2][..], 0.0625, "circular-edges-required"),
        (&[][..], 0.0625, "circular-edges-required"),
        (&[1][..], 0.25, "cap-consumed"),
        (&[1][..], 0.1, "offset-not-representable"),
    ] {
        assert!(chamfer_rim::equal_offsets(&c, edges, width)
            .unwrap_err()
            .0
            .ends_with(reason));
    }
    let mut short = cylinder(2);
    short = cylinder::audit(
        &cylinder::create(
            short.body.key.clone(),
            Spec {
                top: [0.125, -0.25, 0.1875],
                ..short.spec
            },
        )
        .unwrap()
        .check()
        .unwrap(),
    )
    .unwrap();
    assert!(chamfer_rim::equal_offsets(&short, &[0, 1], 0.0625)
        .unwrap_err()
        .0
        .contains("bands-meet"));
    let a = rim(&c, &[1]);
    for mutation in 0..4 {
        let mut b = a.body.clone();
        match mutation {
            0 => {
                if let SurfaceGeometry::ConeSlope { ref mut slope, .. } =
                    b.surfaces.last_mut().unwrap().geometry
                {
                    *slope = Binary64::new(0.5).unwrap();
                }
            }
            1 => b.coedges[2].forward = !b.coedges[2].forward,
            2 => b.vertices[0].point[0] = Binary64::new(0.249).unwrap(),
            _ => {
                b.constructions.last_mut().unwrap().parameters[0] = Binary64::new(0.03125).unwrap()
            }
        }
        assert!(b
            .check()
            .map(|b| chamfer_rim::audit(&b).is_err())
            .unwrap_or(true));
    }
}
#[test]
fn source_metric_affine_images_preserve_exact_membership_and_report_export_bounds() {
    let c = cylinder(2);
    let a = rim(&c, &[0, 1]);
    let frame = Affine {
        origin: [65536.25, -32768.5, 16384.125],
        x: [1. + f64::EPSILON, 0., 0.],
        z: [0., 0., 1.],
    };
    let placed = chamfer_rim::audit(&a.transform(frame).unwrap().check().unwrap()).unwrap();
    let (volume, _) = placed.measures_mm().unwrap();
    let (base, _) = a.measures_mm().unwrap();
    let exact_image = base.m * (1. + f64::EPSILON);
    assert!((volume.m - exact_image).abs() < volume.r + base.r);
    assert!(placed.tolerance_mm().unwrap() > 0.);
    assert!(
        placed
            .probe([
                (frame.origin[0] + c.spec.bottom[0]) * 1000.,
                (frame.origin[1] + c.spec.bottom[1]) * 1000.,
                (frame.origin[2] + c.spec.bottom[2] + 0.25) * 1000.
            ])
            .unwrap()
            .1
    );
}
