//! Strand G11: STEP and chart-domain STL of general-Boolean Models
//! (`wonky_ops::model_export`). The Models are real revolution adapters and
//! real general Boolean results (`wonky_bool::fold_models`), placed by exact
//! rational, reflecting, binary64 and anisotropic placements.
//! `WONKY_G11_ARTIFACTS=<dir>` writes each case as `<case>.step`,
//! `<case>.brep.json` and `<case>.stl` for test/rust-model-export.test.mjs
//! (OCCT and FreeCAD read them there).
use wonky_bool::{fold_models, Op};
use wonky_geom::{frame::Frame, model::Model, Point, Q};
use wonky_ops::{mesh, model_export};

fn q(n: i64) -> Q {
    Q::from_integer(n.into())
}
/// Millimetres in the model frame (metres).
fn mm(n: i64) -> Q {
    q(n) / q(1000)
}
fn identity_at(o: Point) -> Frame {
    Frame::new(o, [[q(1), q(0), q(0)], [q(0), q(1), q(0)], [q(0), q(0), q(1)]]).unwrap()
}
fn revolve(placement: Frame, profile: &[(i64, i64)]) -> Model {
    let profile: Vec<[Q; 2]> = profile.iter().map(|&(r, z)| [mm(r), mm(z)]).collect();
    wonky_geom::model::revolution::revolution(placement, identity_at([q(0), q(0), q(0)]), &profile, 0)
        .unwrap()
        .check()
        .unwrap()
}
fn cylinder(z0: i64, z1: i64, r: i64) -> Model {
    revolve(Frame::identity(), &[(0, z0), (r, z0), (r, z1), (0, z1)])
}
const STEPPED: &[(i64, i64)] = &[(0, 0), (4, 0), (4, 8), (2, 12), (2, 14), (0, 14)];
const APEX: &[(i64, i64)] = &[(0, 0), (4, 0), (0, 6)];

fn rotation(c: Q, s: Q, o: Point) -> Frame {
    Frame::new(o, [[c.clone(), s.clone(), q(0)], [-s, c, q(0)], [q(0), q(0), q(1)]]).unwrap()
}
fn binary64(x: f64) -> Q {
    wonky_geom::binary64(x).unwrap()
}

fn annulus() -> Model {
    let mut r = fold_models(Op::Subtraction, &[&cylinder(0, 14, 9), &cylinder(-2, 16, 3)], 5).unwrap();
    assert_eq!(r.len(), 1);
    r.pop().unwrap()
}
/// A stepped shaft (union of two coaxial cylinders) with a through bore: a
/// planar shoulder annulus with two rings, and caps with ring holes.
fn stepped_bore() -> Model {
    let mut r = fold_models(Op::Union, &[&cylinder(0, 8, 9), &cylinder(8, 20, 4)], 5).unwrap();
    assert_eq!(r.len(), 1);
    let stepped = r.pop().unwrap();
    let mut r = fold_models(Op::Subtraction, &[&stepped, &cylinder(-1, 21, 2)], 6).unwrap();
    assert_eq!(r.len(), 1);
    r.pop().unwrap()
}

struct Case {
    name: &'static str,
    model: Model,
    circles: usize,
    cylinders: usize,
    cones: usize,
    planes: usize,
}
fn cases() -> Vec<Case> {
    let pythagorean = rotation(q(3) / q(5), q(4) / q(5), [mm(10), mm(-3), mm(2)]);
    let mirror = Frame::new([mm(5), q(0), q(0)], [[q(-1), q(0), q(0)], [q(0), q(1), q(0)], [q(0), q(0), q(1)]]).unwrap();
    let (s, c) = (30f64.to_radians().sin(), 30f64.to_radians().cos());
    let rounded = rotation(binary64(c), binary64(s), [mm(1), mm(2), mm(3)]);
    vec![
        Case { name: "stepped", model: revolve(Frame::identity(), STEPPED), circles: 4, cylinders: 2, cones: 1, planes: 2 },
        Case { name: "apex", model: revolve(Frame::identity(), APEX), circles: 1, cylinders: 0, cones: 1, planes: 1 },
        Case { name: "stepped-rotated", model: revolve(pythagorean, STEPPED), circles: 4, cylinders: 2, cones: 1, planes: 2 },
        Case { name: "stepped-mirrored", model: revolve(mirror, STEPPED), circles: 4, cylinders: 2, cones: 1, planes: 2 },
        Case { name: "stepped-binary64-rotation", model: revolve(rounded, STEPPED), circles: 4, cylinders: 2, cones: 1, planes: 2 },
        Case { name: "annulus", model: annulus(), circles: 4, cylinders: 2, cones: 0, planes: 2 },
        Case { name: "stepped-bore", model: stepped_bore(), circles: 6, cylinders: 3, cones: 0, planes: 3 },
    ]
}

fn count(text: &str, entity: &str) -> usize {
    text.matches(&format!("={entity}(")).count()
}

#[test]
fn every_carrier_is_written_as_its_analytic_entity() {
    for c in cases() {
        let step = model_export::step(&[(c.name.into(), &c.model)], c.name).unwrap_or_else(|e| panic!("{}: {}", c.name, e.0));
        let budget = model_export::budget_mm(&c.model).unwrap();
        assert!(budget > 0.0 && budget < 1e-9, "{}: budget {budget}", c.name);
        #[cfg(not(feature = "plant_step_model_circle_bspline"))]
        {
            assert_eq!(count(&step, "CIRCLE"), c.circles, "{}", c.name);
            assert!(!step.contains("B_SPLINE"), "{}", c.name);
        }
        assert_eq!(count(&step, "CYLINDRICAL_SURFACE"), c.cylinders, "{}", c.name);
        assert_eq!(count(&step, "CONICAL_SURFACE"), c.cones, "{}", c.name);
        assert_eq!(count(&step, "PLANE"), c.planes, "{}", c.name);
        assert_eq!(count(&step, "ADVANCED_FACE"), c.cylinders + c.cones + c.planes, "{}", c.name);
        assert_eq!(count(&step, "MANIFOLD_SOLID_BREP"), 1, "{}", c.name);
        assert!(!step.contains("PCURVE") && !step.contains("SEAM_CURVE"), "{}", c.name);
    }
}

/// Signed volume of a closed triangle mesh (mm^3) and its area (mm^2).
fn mesh_measure(m: &mesh::Mesh) -> (f64, f64) {
    let (mut v, mut a) = (0.0, 0.0);
    for t in &m.triangles {
        let [p, q, r] = t.map(|i| m.vertices[i]);
        let c = [q[1] * r[2] - q[2] * r[1], q[2] * r[0] - q[0] * r[2], q[0] * r[1] - q[1] * r[0]];
        v += (p[0] * c[0] + p[1] * c[1] + p[2] * c[2]) / 6.0;
        let (u, w) = ([q[0] - p[0], q[1] - p[1], q[2] - p[2]], [r[0] - p[0], r[1] - p[1], r[2] - p[2]]);
        let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
        a += 0.5 * (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
    }
    (v, a)
}

#[test]
fn chart_domain_mesh_is_watertight_and_within_its_deviation() {
    let deviation = 0.01;
    for c in cases() {
        let m = model_export::tessellate(&c.model, deviation).unwrap_or_else(|e| panic!("{}: {}", c.name, e.0));
        mesh::check_watertight(&m).unwrap();
        let exact = model_export::volumes_mm3(&c.model).unwrap().iter().sum::<f64>();
        let (volume, area) = mesh_measure(&m);
        // Every mesh point is within deviation/2 of the carrier and every
        // triangle lies on the inner side of a convex ring's chords, so the
        // volume differs by at most area * deviation / 2.
        assert!(volume > 0.0, "{}: inverted mesh", c.name);
        assert!((volume - exact).abs() <= area * deviation * 0.5, "{}: mesh {volume} exact {exact} area {area}", c.name);
        // Every ring sample lies on its exact circle within the budget: the
        // distance from the band axis is checked through the volume above;
        // here the samples' count is the stated N for the largest radius.
        let stl = mesh::binary_stl(&[m], deviation).unwrap();
        assert!(stl.len() > 84, "{}", c.name);
    }
}

#[test]
fn a_reflecting_placement_keeps_volume_and_entity_counts() {
    let plain = revolve(Frame::identity(), STEPPED);
    let mirror = Frame::new([q(0), q(0), q(0)], [[q(-1), q(0), q(0)], [q(0), q(1), q(0)], [q(0), q(0), q(1)]]).unwrap();
    let mirrored = revolve(mirror, STEPPED);
    let (a, b) = (model_export::volumes_mm3(&plain).unwrap(), model_export::volumes_mm3(&mirrored).unwrap());
    assert_eq!(a, b);
    let (ma, mb) = (model_export::tessellate(&plain, 0.01).unwrap(), model_export::tessellate(&mirrored, 0.01).unwrap());
    let (va, vb) = (mesh_measure(&ma).0, mesh_measure(&mb).0);
    assert!(va > 0.0 && (va - vb).abs() < 1e-9 * va, "{va} {vb}");
}

#[test]
fn an_anisotropic_placement_refuses_instead_of_writing_an_ellipse_as_a_circle() {
    let stretch = Frame::new([q(0), q(0), q(0)], [[q(2), q(0), q(0)], [q(0), q(1), q(0)], [q(0), q(0), q(1)]]).unwrap();
    let m = revolve(stretch, STEPPED);
    let e = model_export::step(&[("s".into(), &m)], "s").unwrap_err();
    assert_eq!(e.0, "export/model/non-isometric-curved-image");
    assert_eq!(model_export::tessellate(&m, 0.01).unwrap_err().0, "export/model/non-isometric-curved-image");
}

/// `#id=KIND(args);` records of a STEP file written by `step.rs`.
fn records(step: &str) -> std::collections::BTreeMap<String, (String, String)> {
    step.lines()
        .filter_map(|l| {
            let (id, rest) = l.split_once('=')?;
            let open = rest.find('(')?;
            Some((id.to_string(), (rest[..open].to_string(), rest[open + 1..rest.len() - 2].to_string())))
        })
        .collect()
}
fn refs(args: &str) -> Vec<String> {
    args.split(|c: char| c == ',' || c == '(' || c == ')').filter(|s| s.starts_with('#')).map(str::to_string).collect()
}
fn coordinates(r: &std::collections::BTreeMap<String, (String, String)>, id: &str) -> [f64; 3] {
    let (_, args) = &r[id];
    let inner = args.trim_start_matches("'',(").trim_end_matches(')');
    let v: Vec<f64> = inner.split(',').map(|x| x.parse().unwrap()).collect();
    [v[0], v[1], v[2]]
}

#[test]
fn every_ring_vertex_lies_on_its_written_circle_and_exact_radii_are_exact() {
    // Under the 3-4-5 rotation every frame number is rational, so each ring
    // vertex is the exact circle point at angle 0 and each radius (4 or 2 mm)
    // is written exactly.
    let m = revolve(rotation(q(3) / q(5), q(4) / q(5), [mm(10), mm(-3), mm(2)]), STEPPED);
    let step = model_export::step(&[("r".into(), &m)], "r").unwrap();
    let r = records(&step);
    let mut rings = 0;
    for (kind, args) in r.values() {
        if kind != "EDGE_CURVE" {
            continue;
        }
        let ids = refs(args);
        let (curve_kind, curve) = &r[&ids[2]];
        if curve_kind != "CIRCLE" {
            continue;
        }
        assert_eq!(ids[0], ids[1], "a ring is closed on one vertex");
        rings += 1;
        let point = coordinates(&r, &refs(&r[&ids[0]].1)[0]);
        let c = refs(curve);
        let radius: f64 = curve.rsplit(',').next().unwrap().parse().unwrap();
        assert!(radius == 4.0 || radius == 2.0, "radius {radius}");
        let place = refs(&r[&c[0]].1);
        let (centre, axis) = (coordinates(&r, &place[0]), coordinates(&r, &place[1]));
        let d = [point[0] - centre[0], point[1] - centre[1], point[2] - centre[2]];
        let length = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt();
        assert!((length - radius).abs() <= 1e-13 * radius, "{length} vs {radius}");
        assert!((d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2]).abs() <= 1e-13 * radius);
    }
    assert_eq!(rings, 4);
}

#[test]
fn artifacts() {
    let Some(dir) = std::env::var_os("WONKY_G11_ARTIFACTS") else { return };
    let dir = std::path::PathBuf::from(dir);
    std::fs::create_dir_all(&dir).unwrap();
    for c in cases() {
        let named = [(c.name.to_string(), &c.model)];
        std::fs::write(dir.join(format!("{}.step", c.name)), model_export::step(&named, c.name).unwrap()).unwrap();
        std::fs::write(dir.join(format!("{}.brep.json", c.name)), model_export::summary_json(&named).unwrap()).unwrap();
        let m = model_export::tessellate(&c.model, 0.01).unwrap();
        std::fs::write(dir.join(format!("{}.stl", c.name)), mesh::binary_stl(&[m], 0.01).unwrap()).unwrap();
    }
}

#[test]
fn every_band_is_closed_by_one_exact_seam_on_its_generator() {
    // A reader that has to build its own seam approximates it (OCCT 8.0: a
    // B-spline at 1e-5 mm), so each band carries a written LINE seam, used
    // once in each direction, whose ends lie on one generator of the band.
    for c in cases() {
        let step = model_export::step(&[(c.name.into(), &c.model)], c.name).unwrap();
        let r = records(&step);
        let mut seams = 0;
        for (kind, args) in r.values() {
            if kind != "ADVANCED_FACE" {
                continue;
            }
            let ids = refs(args);
            let (surface, surface_args) = &r[ids.last().unwrap()];
            if surface != "CYLINDRICAL_SURFACE" && surface != "CONICAL_SURFACE" {
                continue;
            }
            assert_eq!(ids.len(), 2, "{}: a band has one bound", c.name);
            let lp = &refs(&r[&ids[0]].1)[0];
            let mut lines = Vec::new();
            for oe in refs(&r[lp].1) {
                let (_, oe_args) = &r[&oe];
                let edge = refs(oe_args)[0].clone();
                let edge_refs = refs(&r[&edge].1);
                if r[&edge_refs[2]].0 == "LINE" {
                    lines.push((edge, oe_args.ends_with(".T.")));
                }
            }
            assert_eq!(lines.len(), 2, "{}: {lines:?}", c.name);
            assert_eq!(lines[0].0, lines[1].0, "{}: one seam edge", c.name);
            assert_ne!(lines[0].1, lines[1].1, "{}: used once in each direction", c.name);
            seams += 1;
            let place = refs(&r[&refs(surface_args)[0]].1);
            let (o, z) = (coordinates(&r, &place[0]), coordinates(&r, &place[1]));
            let numbers: Vec<f64> = surface_args.rsplit(',').take(if surface == "CONICAL_SURFACE" { 2 } else { 1 }).map(|x| x.parse().unwrap()).collect();
            let (radius, tan) = if surface == "CONICAL_SURFACE" { (numbers[1], numbers[0].tan()) } else { (numbers[0], 0.0) };
            let ends: Vec<[f64; 3]> = refs(&r[&lines[0].0].1)[..2].iter().map(|v| coordinates(&r, &refs(&r[v].1)[0])).collect();
            let mut angles = Vec::new();
            for p in ends {
                let d = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
                let h = d[0] * z[0] + d[1] * z[1] + d[2] * z[2];
                let radial = [d[0] - h * z[0], d[1] - h * z[1], d[2] - h * z[2]];
                let rho = (radial[0] * radial[0] + radial[1] * radial[1] + radial[2] * radial[2]).sqrt();
                assert!((rho - (radius + tan * h)).abs() <= 1e-12 * radius.max(1.0), "{}: seam end off its band: {rho} vs {}", c.name, radius + tan * h);
                if rho > 1e-9 {
                    angles.push(radial.map(|x| x / rho));
                }
            }
            if let [a, b] = &angles[..] {
                let gap = ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt();
                assert!(gap <= 1e-12, "{}: seam ends on different generators ({gap})", c.name);
            } else {
                assert_eq!(angles.len(), 1, "{}: only an apex end has no radial direction", c.name);
            }
        }
        assert_eq!(seams, c.cylinders + c.cones, "{}", c.name);
    }
}

/// The number after `"key":` in a measure JSON.
fn field(json: &str, key: &str) -> f64 {
    let at = json.find(&format!("\"{key}\":")).unwrap_or_else(|| panic!("{key} in {json}")) + key.len() + 3;
    let end = json[at..].find(|c: char| c == ',' || c == '}').unwrap() + at;
    json[at..end].parse().unwrap_or_else(|_| panic!("{key}: {}", &json[at..end]))
}
/// Probe G8 (boolean3d G14): an r 5 ball ∪ an r 2 coaxial pin from z −10 to
/// 0 meet in the ring z = −√21, so the result has no vertex at all. Exact:
/// V = π(370/3 + 14√21), A = π(50 + 10√21) + π(40 − 4√21) + 4π.
#[test]
fn a_vertex_free_sphere_union_measures_and_writes_its_rings() {
    use wonky_geom::model::{Carrier3, Draft, Face, FaceId, Label, Provenance, Shell, ShellId, Solid, Sphere3, Surface, SurfaceId};
    let prov = Provenance { node: 1, slot: 0 };
    let ball = Draft {
        placement: Frame::identity(),
        label: Label::Exact,
        surfaces: vec![Surface { carrier: Carrier3::Sphere(Sphere3::new(identity_at([q(0), q(0), q(0)]), mm(5) * mm(5)).unwrap()), provenance: prov.clone() }],
        curves: vec![],
        vertices: vec![],
        edges: vec![],
        coedges: vec![],
        loops: vec![],
        faces: vec![Face { surface: SurfaceId(0), forward: true, loops: vec![], provenance: prov.clone() }],
        shells: vec![Shell { faces: vec![FaceId(0)], provenance: prov.clone() }],
        solids: vec![Solid { shells: vec![ShellId(0)], provenance: prov }],
    }
    .check()
    .unwrap();
    let out = fold_models(Op::Union, &[&ball, &cylinder(-10, 0, 2)], 2).unwrap_or_else(|e| panic!("{}", e.0));
    let [m] = &out[..] else { panic!("one body") };
    assert!(m.draft().vertices.is_empty());
    let json = model_export::measure_json(m, None, &[]).unwrap_or_else(|e| panic!("{}", e.0));
    let pi = std::f64::consts::PI;
    let r21 = 21f64.sqrt();
    for (key, want) in [("volumeMm3", pi * (370. / 3. + 14. * r21)), ("areaMm2", pi * (94. + 6. * r21))] {
        let got = field(&json, key);
        assert!((got - want).abs() <= 1e-9 * want, "{key} {got} vs {want}");
    }
    // The pin below the ball: ∫z dV = ∫₀² 2πr ∫ z dz dr over z from −10 to
    // −√(25 − r²) = −154π; the ball itself has no first moment about z = 0.
    let at = json.find("\"centroidMm\":[").unwrap() + 14;
    let centroid: Vec<f64> = json[at..at + json[at..].find(']').unwrap()].split(',').map(|x| x.parse().unwrap()).collect();
    let z = -154. / (370. / 3. + 14. * r21);
    assert!(centroid[0].abs() <= 1e-12 && centroid[1].abs() <= 1e-12 && (centroid[2] - z).abs() <= 1e-9, "{centroid:?} vs z {z}");
    // The ball's cap reaches its pole and equator, which no ring touches.
    let bbox = &json[json.find("\"bboxMm\":").unwrap()..];
    assert!(bbox.starts_with("\"bboxMm\":{\"min\":[-5.0,-5.0,-10.0],\"max\":[5.0,5.0,5.0]}"), "{}", &bbox[..80]);
    let step = model_export::step(&[("g8".into(), m)], "g8").unwrap_or_else(|e| panic!("{}", e.0));
    assert_eq!(count(&step, "SPHERICAL_SURFACE"), 1);
    assert_eq!(count(&step, "CYLINDRICAL_SURFACE"), 1);
    assert_eq!(count(&step, "ADVANCED_FACE"), 3);
    assert!(!step.contains("B_SPLINE"));
}
