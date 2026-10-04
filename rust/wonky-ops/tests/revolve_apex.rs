//! Full-turn meridians that end on the axis: the exact cone apex. Closed forms
//! (pi r^2 h / 3, pi r s) are independent of the builder's Green integral; the
//! OCCT oracle reads the exported STEP independently; the STL is checked by its
//! own divergence volume. A pinch (two apexes meeting) and forged apex carriers
//! still refuse by name.
use num_rational::BigRational as Q;
use wonky_contract::*;
use wonky_ops::{
    affine::Affine,
    host::*,
    revolve_full::{audit, build},
};

fn q(x: f64) -> Q {
    Q::from_float(x).unwrap()
}
fn pi() -> (Q, Q) {
    let d = Q::from_integer(100000000000000000000i128.into());
    (
        Q::from_integer(314159265358979323846i128.into()) / &d,
        Q::from_integer(314159265358979323847i128.into()) / d,
    )
}
const SCALE: f64 = 1.0 / 1024.;
fn segments(points: &[[f64; 2]]) -> Vec<[f64; 4]> {
    (0..points.len())
        .map(|i| {
            let (a, b) = (points[i], points[(i + 1) % points.len()]);
            [a[0] * SCALE, a[1] * SCALE, b[0] * SCALE, b[1] * SCALE]
        })
        .collect()
}
fn key() -> BodyKey {
    BodyKey { id: [4, 2, 5, 0], revision: 0 }
}
struct Case {
    points: &'static [[f64; 2]],
    volume: f64, // multiple of pi, profile units cubed
    area: f64,   // multiple of pi, profile units squared
    faces: usize,
    rings: usize,
    apexes: usize,
}
// Every lateral slant is a Pythagorean length, so both closed forms are
// rational multiples of pi. Orientation varies: apex above or below its ring.
const CASES: [Case; 4] = [
    // Right cone, apex above: V = pi 36 8 / 3, A = pi 36 + pi 6 10.
    Case { points: &[[0., 0.], [6., 0.], [0., 8.]], volume: 96., area: 96., faces: 2, rings: 1, apexes: 1 },
    // Same cone upside down (apex is the segment's first point).
    Case { points: &[[0., 0.], [6., 8.], [0., 8.]], volume: 96., area: 96., faces: 2, rings: 1, apexes: 1 },
    // Bicone: two apexes on one axis interval, one ring.
    Case { points: &[[0., 0.], [3., 4.], [0., 8.]], volume: 24., area: 30., faces: 2, rings: 1, apexes: 2 },
    // Cylinder r 5 h 2 capped by a cone to (0,14): slant 13.
    Case { points: &[[0., 0.], [5., 0.], [5., 2.], [0., 14.]], volume: 150., area: 110., faces: 3, rings: 2, apexes: 1 },
];
fn frames() -> [Affine; 2] {
    [
        Affine::IDENTITY,
        Affine { origin: [64., -32., 16.], x: [1., 0., 0.], z: [0., 0.6, 0.8] },
    ]
}
fn field(json: &str, name: &str) -> String {
    let at = json.find(&format!("\"{name}\":")).unwrap() + name.len() + 3;
    json[at..].chars().take_while(|c| *c != ',' && *c != '}').collect()
}

#[test]
fn apex_cones_match_closed_forms_topology_and_transport() {
    let (pi_lo, pi_hi) = pi();
    for frame in frames() {
        // Volume scales by det; area is enclosed with the metric defect.
        let det = q(frame.z[1]) * q(frame.z[1]) + q(frame.z[2]) * q(frame.z[2]);
        for mode in 0..3 {
            for case in &CASES {
                let body = build(key(), [0; 4], frame, mode, &segments(case.points), std::f64::consts::TAU).unwrap();
                let words = wonky_wire::v3::encode(&body).unwrap();
                let checked = wonky_wire::v3::decode(&words).unwrap();
                let solid = audit(&checked).unwrap();
                let (volume, area, faces, _) = solid.measures().unwrap();
                let v = q(case.volume) * q(SCALE).pow(3) * q(1e9) * &det;
                assert!(q(volume.lo()) <= &v * &pi_lo && q(volume.hi()) >= &v * &pi_hi, "volume {:?}", case.points);
                let a = q(case.area) * q(SCALE).pow(2) * q(1e6);
                assert!(q(area.lo()) <= &a * &pi_lo && q(area.hi()) >= &a * &pi_hi, "area {:?}", case.points);
                assert_eq!(faces.len(), case.faces);
                // Canonical counts: rings carry no vertices, the apex is a
                // singular point, and no axial edge or zero-radius face exists.
                let json = solid.measure_json(None, &[]).unwrap();
                assert_eq!(field(&json, "faces"), case.faces.to_string());
                assert_eq!(field(&json, "vertices"), "0");
                assert_eq!(field(&json, "singularPoints"), case.apexes.to_string());
                assert_eq!(field(&json, "genus"), "0");
                assert_eq!(body.edges.len(), case.rings);
                assert_eq!(body.vertices.len(), body.edges.len());
                // Every apex face has exactly one (outer) ring loop.
                let one_loop = body
                    .faces
                    .iter()
                    .filter(|f| f.loops.len() == 1 && !matches!(body.surfaces[f.surface.0 as usize].geometry, SurfaceGeometry::Plane { .. }))
                    .collect::<Vec<_>>();
                assert_eq!(one_loop.len(), case.apexes);
                assert!(one_loop.iter().all(|f| body.loops[f.loops[0].0 as usize].outer));
            }
        }
    }
}

#[test]
fn apex_pinch_and_forged_apex_carriers_refuse_by_name() {
    // Planted negative: an axis vertex between two off-axis segments is a
    // pinch where two apexes touch, not a manifold apex.
    let diamond = [[3., 0.], [6., 4.], [3., 8.], [0., 4.]];
    assert_eq!(
        build(key(), [0; 4], Affine::IDENTITY, 2, &segments(&diamond), std::f64::consts::TAU).unwrap_err().0,
        "revolve/full/isolated-axis-contact"
    );
    let body = build(key(), [0; 4], Affine::IDENTITY, 2, &segments(CASES[0].points), std::f64::consts::TAU).unwrap();
    let cone = body.surfaces.iter().position(|s| matches!(s.geometry, SurfaceGeometry::ConeMeridian { .. })).unwrap();
    let mut forged = vec![];
    // Apex radius moved off the axis by 2^-50 of the profile: still a valid
    // contract carrier, but no longer the audited meridian.
    let mut b = body.clone();
    if let SurfaceGeometry::ConeMeridian { end, .. } = &mut b.surfaces[cone].geometry {
        assert_eq!(end[0].get(), 0.);
        end[0] = Binary64::new(SCALE * 2f64.powi(-50)).unwrap();
    }
    forged.push(b);
    let mut b = body.clone();
    let apex_face = b.faces.iter().position(|f| f.surface.0 as usize == cone).unwrap();
    let l = b.faces[apex_face].loops[0].0 as usize;
    b.loops[l].outer = false;
    forged.push(b);
    for b in forged {
        assert_eq!(audit(&b.check().unwrap()).unwrap_err().0, "revolve/full/construction-body-mismatch");
    }
    // Both meridian radii on the axis is no carrier at all.
    let mut b = body.clone();
    if let SurfaceGeometry::ConeMeridian { start, .. } = &mut b.surfaces[cone].geometry {
        start[0] = Binary64::new(0.).unwrap();
    }
    assert!(b.check().is_err());
    // The mesher binds a ring to an exact meridian point, independent of the
    // family audit: a ring radius one ulp off refuses by name.
    let mut b = body.clone();
    let ring = b.curves.iter_mut().find(|c| matches!(c.geometry, CurveGeometry::Circle { .. })).unwrap();
    if let CurveGeometry::Circle { radius, .. } = &mut ring.geometry {
        *radius = Binary64::new(radius.get().next_up()).unwrap();
    }
    assert_eq!(wonky_ops::mesh::tessellate(&b.check().unwrap(), 0.01).unwrap_err().0, "mesh/curved/cone-ring-meridian");
}

#[test]
fn apex_stl_encloses_the_closed_form_volume() {
    for frame in frames() {
        let det = frame.z[1] * frame.z[1] + frame.z[2] * frame.z[2];
        for case in &CASES {
            let body = build(key(), [0; 4], frame, 1, &segments(case.points), std::f64::consts::TAU).unwrap();
            let deviation = 0.001;
            let mesh = wonky_ops::mesh::tessellate(&body.clone().check().unwrap(), deviation).unwrap();
            // Divergence volume of the closed triangle mesh (world mm).
            let mut volume = 0.;
            for t in &mesh.triangles {
                let [a, b, c] = t.map(|i| mesh.vertices[i]);
                volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0])
                    + a[2] * (b[0] * c[1] - b[1] * c[0]))
                    / 6.;
            }
            let exact = case.volume * std::f64::consts::PI * (SCALE * 1000.).powi(3) * det;
            let area = case.area * std::f64::consts::PI * (SCALE * 1000.).powi(2) * 1.01;
            assert!((volume - exact).abs() <= area * deviation, "{volume} vs {exact}");
            // The apex is one mesh vertex, shared by the whole fan.
            let apex_uses = mesh
                .vertices
                .iter()
                .enumerate()
                .map(|(i, _)| mesh.triangles.iter().filter(|t| t.contains(&i)).count())
                .max()
                .unwrap();
            assert!(apex_uses >= 16);
        }
    }
}

#[test]
fn apex_step_roundtrips_through_the_occt_oracle() {
    use std::fs;
    use std::process::Command;
    fn text(w: &mut Vec<u32>, s: &str) {
        w.push(s.chars().count() as u32);
        w.extend(s.chars().map(|c| c as u32));
    }
    let dir = std::env::temp_dir().join(format!("wonky-apex-oracle-{}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    let mut k = 0;
    for frame in frames() {
        let det = frame.z[1] * frame.z[1] + frame.z[2] * frame.z[2];
        for mode in [0, 2] {
            for case in &CASES {
                let body = build(key(), [0; 4], frame, mode, &segments(case.points), std::f64::consts::TAU).unwrap();
                let words = wonky_wire::v3::encode(&body).unwrap();
                let mut step = vec![MAGIC, VERSION, OP_STEP];
                text(&mut step, "apex");
                step.push(1);
                text(&mut step, "apex");
                step.push(words.len() as u32);
                step.extend(&words);
                let reply = host_op(&step);
                assert_eq!(reply[0], STATUS_OK, "{reply:?}");
                let s: String = reply[1..].iter().map(|&c| char::from_u32(c).unwrap()).collect();
                fs::write(dir.join(format!("{k}.step")), s).unwrap();
                let m = (SCALE * 1000.).powi(3);
                fs::write(
                    dir.join(format!("{k}.expected")),
                    format!(
                        "{{\"volume\":{},\"faces\":{},\"apexes\":{}}}",
                        case.volume * std::f64::consts::PI * m * det,
                        case.faces,
                        case.apexes
                    ),
                )
                .unwrap();
                k += 1;
            }
        }
    }
    let script = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/data/apex-oracle.py");
    let output = Command::new("uv").args(["run", "--offline"]).arg(script).arg(&dir).output().unwrap();
    assert!(
        output.status.success(),
        "oracle failed: {}\n{} (artifacts {})",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr),
        dir.display()
    );
    fs::remove_dir_all(dir).unwrap();
}

// A blind hole with a drill point: cylinder minus a coaxial meridian tool
// whose tip is an apex. The coaxial Boolean keeps the tip as the result's
// (concave) apex. V = pi 16 6 - pi 4 3 - pi 4 2 / 3 = 244 pi / 3.
#[test]
fn coaxial_drill_point_keeps_an_exact_concave_apex() {
    use wonky_ops::{analytic::{self, Solid}, cylinder};
    let (pi_lo, pi_hi) = pi();
    let target = cylinder::create(key(), cylinder::Spec { bottom: [0.; 3], top: [0., 0., 6. * SCALE], radius: 4. * SCALE }).unwrap();
    let target = analytic::audit(&target.check().unwrap()).unwrap();
    let drill = build(key(), [0; 4], Affine::IDENTITY, 2, &segments(&[[0., 1.], [2., 3.], [2., 7.], [0., 7.]]), std::f64::consts::TAU).unwrap();
    let drill = analytic::audit(&drill.check().unwrap()).unwrap();
    let bodies = analytic::boolean(key(), 1, &[target, drill]).unwrap();
    assert_eq!(bodies.len(), 1);
    let checked = wonky_wire::v3::decode(&wonky_wire::v3::encode(&bodies[0]).unwrap()).unwrap();
    let Solid::Revolved(result) = analytic::audit(&checked).unwrap() else { panic!("not a revolution") };
    let (volume, _, faces, _) = result.measures().unwrap();
    let v = q(244.) / q(3.) * q(SCALE).pow(3) * q(1e9);
    assert!(q(volume.lo()) <= &v * &pi_lo && q(volume.hi()) >= &v * &pi_hi);
    assert_eq!(faces.len(), 5);
    let json = result.measure_json(None, &[]).unwrap();
    assert_eq!(field(&json, "singularPoints"), "1");
    assert_eq!(field(&json, "genus"), "0");
}

// AC25-style probes from first principles: the apex is 4 from (0,0,12); the
// foot of (6,0,8) on the generator is (2.16,5.12), distance 24/5. Points on
// the slant and the base are boundary (inside); one ulp outward is outside.
#[test]
fn apex_probes_have_exact_sides_and_closed_form_distances() {
    let k = SCALE * 1000.;
    for mode in [2usize] {
        let body = build(key(), [0; 4], Affine::IDENTITY, mode, &segments(CASES[0].points), std::f64::consts::TAU).unwrap();
        let solid = audit(&body.check().unwrap()).unwrap();
        for (point, distance, inside) in [
            ([0., 0., 12.], 4., false),
            ([6., 0., 8.], 4.8, false),
            ([0., 6., 8.], 4.8, false),
            ([1., 0., 1.], 0., true),
            ([3., 0., 4.], 0., true),
            ([3., 0., 0.], 0., true),
            ([0., 0., 8.], 0., true),
        ] {
            let (d, i) = solid.probe_mm(point.map(|v| v * k)).unwrap();
            assert_eq!(i, inside, "{point:?}");
            let expected = distance * k;
            assert!(d.lo() <= expected + 1e-12 && expected - 1e-12 <= d.hi(), "{point:?}: {d:?} vs {expected}");
            assert!(d.r <= 1e-9);
        }
        // One ulp outside the slant and below the base: exact side, tiny distance.
        for q in [[(3. * k).next_up(), 0., 4. * k], [3. * k, 0., -(2f64.powi(-40))]] {
            let (d, i) = solid.probe_mm(q).unwrap();
            assert!(!i, "{q:?}");
            assert!(d.hi() < 1e-12);
        }
    }
}

// Rotated source frames with tiny column components (cos 90 deg) keep exact
// probe sides: the rational pullback never leaves the binary64 range.
#[test]
fn apex_probes_survive_rotated_frames() {
    let (s, c) = (std::f64::consts::FRAC_PI_2.sin(), std::f64::consts::FRAC_PI_2.cos());
    let frame = Affine { origin: [1.5, 0.5, 0.], x: [c, s, 0.], z: [0., 0., 1.] };
    let body = build(key(), [0; 4], frame, 2, &segments(CASES[0].points), std::f64::consts::TAU).unwrap();
    let solid = audit(&body.check().unwrap()).unwrap();
    let k = SCALE * 1000.;
    let apex = frame.apply([0., 0., 12. * SCALE], 1000., true).unwrap();
    let (d, inside) = solid.probe_mm(apex).unwrap();
    assert!(!inside);
    assert!((d.m - 4. * k).abs() < 1e-6 * k, "{d:?}");
    let centre = frame.apply([SCALE, 0., SCALE], 1000., true).unwrap();
    assert!(solid.probe_mm(centre).unwrap().1);
}
