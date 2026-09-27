//! Owner of analytic-to-mesh fidelity and shared *indexed* topology. Existing
//! analytic tests do not inspect facets; CLI tests own transport/metadata only.
//! Regressions: per-face seam copies, cap winding, affine budget loss, pole
//! duplication and torus chart closure. All fixtures use production builders;
//! no test-only production hooks or implementation-specific mesh counts.
use crate::{affine::Affine, axial, cylinder, lens, mesh, orthogonal, polyhedron, revolve, sphere};
use std::collections::BTreeMap;
use wonky_contract::*;
use wonky_sketch::circle_region::Disk;

fn key(n: u32) -> BodyKey {
    BodyKey {
        id: [n, 0, 0, 0],
        revision: 0,
    }
}
fn checked_mesh(body: Body, deviation: f64) -> mesh::Mesh {
    let m = mesh::tessellate(&body.check().unwrap(), deviation).unwrap();
    let mut edges = BTreeMap::<(usize, usize), (usize, i32)>::new();
    for t in &m.triangles {
        for i in 0..3 {
            let (a, b) = (t[i], t[(i + 1) % 3]);
            let e = edges.entry((a.min(b), a.max(b))).or_default();
            e.0 += 1;
            e.1 += if a < b { 1 } else { -1 };
        }
    }
    assert!(
        edges.values().all(|&e| e == (2, 0)),
        "mesh must share boundary indices, not just coordinates"
    );
    // Exercise quantization on curved triangles, not merely the f64 mesh.
    let bytes = mesh::binary_stl(std::slice::from_ref(&m), deviation).unwrap();
    let mut serialized_volume = 0.;
    for facet in bytes[84..].chunks_exact(50) {
        let p: [[f64; 3]; 3] = std::array::from_fn(|i| {
            std::array::from_fn(|k| {
                let start = 12 + 12 * i + 4 * k;
                f32::from_le_bytes(facet[start..start + 4].try_into().unwrap()) as f64
            })
        });
        let normal = cross(p[1], p[2]);
        serialized_volume += (0..3).map(|k| p[0][k] * normal[k]).sum::<f64>() / 6.;
    }
    assert!((serialized_volume - volume(&m)).abs() <= volume(&m).abs() * 1e-5);
    m
}
fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
fn volume(m: &mesh::Mesh) -> f64 {
    m.triangles
        .iter()
        .map(|t| {
            let [a, b, c] = t.map(|i| m.vertices[i]);
            let cross = cross(b, c);
            (0..3).map(|k| a[k] * cross[k]).sum::<f64>() / 6.
        })
        .sum()
}
fn probes(m: &mesh::Mesh, mut check: impl FnMut([f64; 3])) {
    for t in &m.triangles {
        let p = t.map(|i| m.vertices[i]);
        check([0, 1, 2].map(|k| (p[0][k] + p[1][k] + p[2][k]) / 3.));
        for j in 0..3 {
            check([0, 1, 2].map(|k| (p[j][k] + p[(j + 1) % 3][k]) / 2.));
        }
    }
}
fn ball(c: [f64; 3], r: f64) -> sphere::Spherical {
    sphere::audit(&sphere::sphere(key(1), c, r).unwrap().check().unwrap()).unwrap()
}
fn half(axis: usize, sign: f64) -> Body {
    let mut lo = [-0.02; 3];
    let mut hi = [0.02; 3];
    if sign > 0. {
        lo[axis] = 0.;
    } else {
        hi[axis] = 0.;
    }
    let bx =
        polyhedron::audit(&orthogonal::cuboid(key(2), lo, hi).unwrap().check().unwrap()).unwrap();
    sphere::intersect_box(key(3), &ball([0.; 3], 0.0083), &bx).unwrap()
}
#[test]
fn hemisphere_caps_all_axes_and_closed_sphere_are_outward_and_close() {
    for shape in std::iter::once(sphere::sphere(key(1), [0.; 3], 0.0083).unwrap())
        .chain((0..3).flat_map(|axis| [-1., 1.].map(move |sign| half(axis, sign))))
    {
        let capped = shape.faces.len() == 2;
        let m = checked_mesh(shape, 0.02);
        let exact = (if capped { 2. } else { 4. }) * std::f64::consts::PI * 8.3_f64.powi(3) / 3.;
        assert!(volume(&m) > exact * 0.995 && volume(&m) < exact);
        if !capped {
            probes(&m, |p| {
                let radius = p[0].hypot(p[1]).hypot(p[2]);
                assert!(
                    (radius - 8.3).abs() <= 0.02,
                    "sphere facet deviation {radius}"
                );
            });
        }
    }
}
#[test]
fn translated_cylinder_caps_and_shared_rings_have_analytic_accuracy() {
    // Off-axis translation exercises the cylinder's zero-angle rigid seam frame.
    let body = cylinder::create(
        key(2),
        cylinder::Spec {
            bottom: [0.002, -0.003, -0.004],
            top: [0.002, -0.003, 0.006],
            radius: 0.005,
        },
    )
    .unwrap();
    let m = checked_mesh(body, 0.02);
    let expected = std::f64::consts::PI * 25. * 10.;
    assert!(volume(&m) > expected * 0.995 && volume(&m) < expected);
    probes(&m, |p| {
        let radial = (p[0] - 2.).hypot(p[1] + 3.);
        let error = (radial - 5.)
            .abs()
            .min((p[2] + 4.).abs())
            .min((p[2] - 6.).abs());
        assert!(error <= 0.02, "cylinder surface deviation {error}");
    });
}
#[test]
fn napkin_ring_and_lens_share_analytic_intersection_boundaries() {
    // Dyadic 3:4:5 intersection keeps the production admission exactly proved.
    let r = 0.0048828125;
    let rr = 0.0029296875;
    let tool = axial::audit(
        &axial::cylinder(key(2), [0., 0., -0.01], [0., 0., 0.01], rr)
            .unwrap()
            .check()
            .unwrap(),
    )
    .unwrap();
    let body = axial::subtract(key(3), &ball([0.; 3], r), &tool).unwrap();
    let m = checked_mesh(body, 0.02);
    let height: f64 = 2. * 0.00390625 * 1000.;
    let expected = std::f64::consts::PI * height.powi(3) / 6.;
    assert!((volume(&m) / expected - 1.).abs() < 0.005);
    probes(&m, |p| {
        let sphere = (p[0].hypot(p[1]).hypot(p[2]) - r * 1000.).abs();
        let bore = (p[0].hypot(p[1]) - rr * 1000.).abs();
        assert!(sphere.min(bore) <= 0.02);
    });
    let r = 0.004;
    let a = ball([0., 0., -0.002], r);
    let b = ball([0., 0., 0.002], r);
    let m = checked_mesh(lens::intersect(key(4), &a, &b).unwrap(), 0.02);
    let expected = 2. * std::f64::consts::PI * 2_f64.powi(2) * (4. - 2. / 3.);
    assert!((volume(&m) / expected - 1.).abs() < 0.005);
}
#[test]
fn torus_periodic_seams_have_genus_one_and_bounded_deviation() {
    let body = revolve::circle_revolve(&revolve::CircleRevolve {
        key: key(7),
        source: [0; 4],
        sketch: Affine {
            origin: [0.; 3],
            x: [1., 0., 0.],
            z: [0., -1., 0.],
        },
        axis_origin: [0.; 3],
        axis: [0., 0., 1.],
        disk: Disk {
            center: [0.01, 0.],
            radius: 0.002,
        },
        angle: std::f64::consts::TAU,
    })
    .unwrap();
    let m = checked_mesh(body, 0.02);
    let expected = 2. * std::f64::consts::PI.powi(2) * 10. * 4.;
    assert!((volume(&m) / expected - 1.).abs() < 0.005);
    let mut edges = std::collections::BTreeSet::new();
    for t in &m.triangles {
        for i in 0..3 {
            let (a, b) = (t[i], t[(i + 1) % 3]);
            edges.insert((a.min(b), a.max(b)));
        }
    }
    assert_eq!(m.vertices.len() + m.triangles.len(), edges.len());
    probes(&m, |p| {
        assert!(((p[0].hypot(p[1]) - 10.).hypot(p[2]) - 2.).abs() <= 0.02)
    });
}
#[test]
fn affine_scale_and_shear_respect_the_world_deviation_budget() {
    let frame = Affine {
        origin: [0.01, -0.02, 0.03],
        x: [4., 0., 0.],
        z: [0.5, 0., 1.],
    };
    let body = sphere::transform(&ball([0.; 3], 0.003), frame).unwrap();
    let m = checked_mesh(body, 0.02);
    let exact = 4. * std::f64::consts::PI * 3_f64.powi(3) / 3. * 16.;
    assert!(volume(&m) > exact * 0.995 && volume(&m) < exact);
    probes(&m, |p| {
        let z = p[2] - 30.;
        let unit = [(p[0] - 10. - 0.5 * z) / 4., (p[1] + 20.) / 4., z];
        let length = unit[0].hypot(unit[1]).hypot(unit[2]);
        // Six bounds this map's operator norm independently of the mesher.
        assert!((length - 3.).abs() * 6. <= 0.02);
    });
}
#[test]
fn sector_rounded_patches_and_reflection_preserve_indexed_boundaries() {
    use crate::{fillet, revolve_sector};
    let segments = [
        [0.005, -0.004, 0.01, -0.004],
        [0.01, -0.004, 0.01, 0.008],
        [0.01, 0.008, 0.005, 0.008],
        [0.005, 0.008, 0.005, -0.004],
    ];
    let sector = revolve_sector::build(
        key(11),
        [0; 4],
        Affine::IDENTITY,
        &segments,
        std::f64::consts::FRAC_PI_2,
    )
    .unwrap();
    let mut cases = vec![(sector, std::f64::consts::PI / 4. * (100. - 25.) * 12.)];
    let cube = polyhedron::audit(
        &orthogonal::cuboid(key(12), [0.; 3], [0.016; 3])
            .unwrap()
            .check()
            .unwrap(),
    )
    .unwrap();
    let vertical: Vec<_> = cube
        .body
        .edges
        .iter()
        .enumerate()
        .filter_map(|(i, e)| {
            let [a, b] = [e.vertices[0], e.vertices[1]]
                .map(|v| cube.body.vertices[v.0 as usize].point.map(|v| v.get()));
            (a[0] == b[0] && a[1] == b[1] && a[2] != b[2]).then_some(i)
        })
        .collect();
    let rounded = fillet::constant_radius(&cube, &vertical, 0.004).unwrap();
    let rounded_volume = (256. - 4. * 16. * (1. - std::f64::consts::PI / 4.)) * 16.;
    // Reuse the blind-prism producer and exact input of pattern_distance.rs's
    // passing raw_step_faces_are_outward_after_odd_and_even_reflections case.
    // Neither orthogonal-cuboid nor curved-fillet lineage is supported by the
    // current pattern audit; the STL reflection contract still needs coverage.
    let profile = [[0.125, 0.], [0.625, 0.], [0.125, 0.375]];
    let segments: Vec<_> = profile
        .iter()
        .enumerate()
        .map(|(i, a)| {
            let b = profile[(i + 1) % profile.len()];
            [a[0], a[1], b[0], b[1]]
        })
        .collect();
    let pairs: Vec<_> = segments
        .iter()
        .map(|s| [wonky_num::p2(s[0], s[1]), wonky_num::p2(s[2], s[3])])
        .collect();
    let region = wonky_sketch::region::lines_region(&pairs).unwrap();
    let seed = crate::extrude::blind_prism(&crate::extrude::Prism {
        key: key(14),
        source: [0; 4],
        frame: Affine::IDENTITY,
        segments: &segments,
        region: &region.loops[0],
        depth: 0.25,
        reverse: false,
    })
    .unwrap();
    let seed = polyhedron::audit(&seed.check().unwrap()).unwrap();
    let reflected = crate::pattern::copy(
        &seed,
        key(13),
        [[-1., 0., 0.], [0., 1., 0.], [0., 0., 1.]],
        [0.5, -0.25, 0.125],
    )
    .unwrap();
    cases.push((rounded, rounded_volume));
    cases.push((reflected.body, 0.5 * 0.375 * 0.25 / 2. * 1e9));
    for corner in [[0.; 3], [0.016; 3]] {
        let incident: Vec<_> = cube
            .body
            .edges
            .iter()
            .enumerate()
            .filter_map(|(i, e)| {
                e.vertices
                    .iter()
                    .any(|v| cube.body.vertices[v.0 as usize].point.map(|v| v.get()) == corner)
                    .then_some(i)
            })
            .collect();
        let expected = 4096.
            - 3. * 16. * 12. * (1. - std::f64::consts::PI / 4.)
            - 64. * (1. - std::f64::consts::PI / 6.);
        cases.push((
            fillet::constant_radius(&cube, &incident, 0.004).unwrap(),
            expected,
        ));
    }
    for (body, expected) in cases {
        let m = checked_mesh(body, 0.02);
        assert!((volume(&m) / expected - 1.).abs() < 0.005);
    }
}
#[test]
fn unsupported_cones_and_unattainable_deviation_are_named_refusals() {
    let mut body = sphere::sphere(key(1), [0.; 3], 0.005).unwrap();
    assert!(mesh::tessellate(&body.clone().check().unwrap(), 1e-30)
        .unwrap_err()
        .0
        .contains("resource-limit"));
    let b = |v| Binary64::new(v).unwrap();
    body.surfaces[0].geometry = SurfaceGeometry::Cone {
        origin: [b(0.); 3],
        axis: [b(0.), b(0.), b(1.)],
        x: [b(1.), b(0.), b(0.)],
        radius: b(0.005),
        angle: b(0.5),
    };
    assert!(mesh::tessellate(&body.check().unwrap(), 0.02)
        .unwrap_err()
        .0
        .contains("cone-trims-unsupported"));
}
