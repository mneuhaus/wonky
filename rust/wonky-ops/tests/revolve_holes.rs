//! Revolve cuts into a prism along its extrusion axis: countersunk through
//! hole, counterbore with a flat floor, drill point with an apex. Expected
//! volumes, areas, genus and probe distances are closed forms of the meridian
//! polygons (Pappus frusta, pi (r0 + r1) s), independent of the builder; STL
//! and the OCCT oracle read the result independently. Planted negatives:
//! a tilted axis, a wall grazing the prism side and an enclosed cavity refuse.
//! Rational cap sections retain their source value and pass an independent oracle.
use wonky_contract::BodyKey;
use wonky_ops::{
    affine::Affine,
    analytic::{self, Solid},
    cylinder::{self, Spec},
    polyhedron,
    revolve_full::{audit, build},
};

const S: f64 = 1.0 / 1024.;
fn key() -> BodyKey {
    BodyKey { id: [7, 3, 1, 9], revision: 0 }
}
fn scaled(points: &[[f64; 2]]) -> Vec<[f64; 4]> {
    (0..points.len())
        .map(|i| {
            let (a, b) = (points[i], points[(i + 1) % points.len()]);
            [a[0] * S, a[1] * S, b[0] * S, b[1] * S]
        })
        .collect()
}
/// 16 x 16 x 4 plate (profile units), extruded along z from z = 0.
fn plate() -> Solid {
    let lines = [[0., 0., 16., 0.], [16., 0., 16., 16.], [16., 16., 0., 16.], [0., 16., 0., 0.]]
        .map(|l| l.map(|v| v * S));
    let segments = lines.map(|p| [wonky_num::p2(p[0], p[1]), wonky_num::p2(p[2], p[3])]);
    let region = wonky_sketch::region::lines_region(&segments).unwrap();
    let body = wonky_ops::extrude::blind_prism(&wonky_ops::extrude::Prism {
        key: key(),
        source: [0; 4],
        frame: Affine::IDENTITY,
        segments: &lines,
        region: &region.loops[0],
        depth: 4. * S,
        reverse: false,
    })
    .unwrap();
    Solid::Planar(polyhedron::audit(&body.check().unwrap()).unwrap())
}
/// Tool meridian (radius, height) in a frame whose revolution axis is the
/// plate's +z (`down` = false) or -z through `top` (`down` = true), built
/// in mode 2 (axis = frame z) or mode 0 (axis = frame x).
fn tool(centre: [f64; 2], points: &[[f64; 2]], mode: usize, down: bool) -> Solid {
    let z = if down { 4. * S } else { 0. };
    let s = if down { -1. } else { 1. };
    let frame = if mode == 0 {
        Affine { origin: [centre[0] * S, centre[1] * S, z], x: [0., 0., s], z: [1., 0., 0.] }
    } else {
        Affine { origin: [centre[0] * S, centre[1] * S, z], x: [1., 0., 0.], z: [0., 0., s] }
    };
    let body = build(key(), [0; 4], frame, mode, &scaled(points), TAU).unwrap();
    Solid::Revolved(audit(&body.check().unwrap()).unwrap())
}
// Countersunk through hole: r 1 bore, 45 degree sink to r 2 at the top face.
const SINK_UP: [[f64; 2]; 6] = [[0., -1.], [1., -1.], [1., 3.], [2., 4.], [2., 5.], [0., 5.]];
// The same hole measured downwards from the top face.
const SINK_DOWN: [[f64; 2]; 6] = [[0., -1.], [2., -1.], [2., 0.], [1., 1.], [1., 5.], [0., 5.]];
// Counterbore r 2 depth 1 from the bottom, then r 1 blind to 2.5 (flat floor).
const BORE: [[f64; 2]; 6] = [[0., -1.], [2., -1.], [2., 1.], [1., 1.], [1., 2.5], [0., 2.5]];
// Blind r 1 drill with a 90 degree point: apex at 3.
const DRILL: [[f64; 2]; 4] = [[0., -1.], [1., -1.], [1., 2.], [0., 3.]];

fn number(json: &str, name: &str) -> f64 {
    let at = json.find(&format!("\"{name}\":")).unwrap() + name.len() + 3;
    json[at..].chars().take_while(|c| *c != ',' && *c != '}').collect::<String>().parse().unwrap()
}
const TAU: f64 = std::f64::consts::TAU;
fn holed(mode: usize, down: bool) -> Vec<Solid> {
    let sink = if down { SINK_DOWN } else { SINK_UP };
    vec![
        plate(),
        tool([4., 4.], &sink, mode, down),
        tool([12., 4.], &BORE, mode, false),
        tool([8., 12.], &DRILL, mode, false),
    ]
}

#[test]
fn countersink_counterbore_and_drill_point_match_closed_forms() {
    let pi = std::f64::consts::PI;
    let r2 = std::f64::consts::SQRT_2;
    for (mode, down) in [(2, false), (0, false), (2, true), (0, true)] {
        let mut out = analytic::boolean(key(), 1, &holed(mode, down)).unwrap();
        assert_eq!(out.len(), 1);
        let body = out.pop().unwrap();
        // Manifold: every edge used twice with opposite senses.
        for e in 0..body.edges.len() {
            let uses = body.coedges.iter().filter(|c| c.edge.0 as usize == e).collect::<Vec<_>>();
            assert_eq!(uses.len(), 2);
            assert_ne!(uses[0].forward, uses[1].forward);
        }
        let solid = analytic::audit(&body.clone().check().unwrap()).unwrap();
        let mm = S * 1000.;
        let at = |x: f64, y: f64, z: f64| [x * mm, y * mm, z * mm];
        let json = solid
            .measure(None, &[at(4., 4., 1.5), at(8., 12., 2.5), at(1., 1., 1.), at(13.5, 4., 0.5)])
            .unwrap();
        // Holes: 16 pi / 3 (bore 3 pi + frustum 7 pi / 3), 11 pi / 2, 7 pi / 3.
        let volume = (1024. - pi * (16. / 3. + 5.5 + 7. / 3.)) * mm.powi(3);
        assert!((number(&json, "volumeMm3") - volume).abs() <= volume * 1e-12, "{json}");
        // Plate 768; openings -10 pi; walls 21 pi + 4 sqrt2 pi.
        let area = (768. + 11. * pi + 4. * r2 * pi) * mm.powi(2);
        assert!((number(&json, "areaMm2") - area).abs() <= area * 1e-12, "{json}");
        assert_eq!(number(&json, "faces"), 14.);
        assert_eq!(number(&json, "genus"), 1.);
        assert_eq!(number(&json, "singularPoints"), 1.);
        // Void probes: 1 from the bore wall; 1/(2 sqrt 2) from the drill
        // cone; material probe inside; 1/2 from the counterbore step.
        let p = json.split("\"probes\":[").nth(1).unwrap();
        let entries = p.split("},{").collect::<Vec<_>>();
        let expect = [(false, 1.), (false, 0.5 / r2), (true, 0.), (false, 0.5)];
        for (entry, (inside, d)) in entries.iter().zip(expect) {
            assert!(entry.contains(&format!("\"inside\":{inside}")), "{entry}");
            let got = number(&format!("{{{entry}}}"), "distanceMm");
            assert!((got - d * mm).abs() <= 1e-12 * mm, "{entry} vs {d}");
        }
        // Mesh divergence volume within the deviation budget.
        let deviation = 0.01;
        let mesh = wonky_ops::mesh::tessellate(&body.clone().check().unwrap(), deviation).unwrap();
        let mut v = 0.;
        for t in &mesh.triangles {
            let [a, b, c] = t.map(|i| mesh.vertices[i]);
            v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0])
                + a[2] * (b[0] * c[1] - b[1] * c[0]))
                / 6.;
        }
        assert!((v - volume).abs() <= area * deviation, "mesh {v} vs {volume}");
        let step = analytic::step(&[("holes".into(), solid)], "holes").unwrap();
        assert!(step.contains("CONICAL_SURFACE") && step.contains("SEAM_CURVE"));
    }
}

#[test]
fn chained_revolve_cuts_rearrange_from_sources() {
    // (plate - sink) - drill must equal plate - (sink u drill).
    let first = analytic::boolean(key(), 1, &[plate(), tool([4., 4.], &SINK_UP, 2, false)]).unwrap();
    let first = analytic::audit(&first[0].clone().check().unwrap()).unwrap();
    let chained = analytic::boolean(key(), 1, &[first, tool([8., 12.], &DRILL, 2, false)]).unwrap();
    let once = analytic::boolean(
        key(),
        1,
        &[plate(), tool([4., 4.], &SINK_UP, 2, false), tool([8., 12.], &DRILL, 2, false)],
    )
    .unwrap();
    assert_eq!(chained, once);
}

#[test]
fn revolve_cuts_that_are_not_clean_axial_holes_refuse_by_name() {
    let refuse = |tools: Vec<Solid>| {
        let mut operands = vec![plate()];
        operands.extend(tools);
        analytic::boolean(key(), 1, &operands).unwrap_err().0
    };
    // Axis along the plate's x: not the extrusion axis.
    let sideways = {
        let frame = Affine { origin: [4. * S, 4. * S, 2. * S], x: [1., 0., 0.], z: [0., 1., 0.] };
        let body = build(key(), [0; 4], frame, 0, &scaled(&[[0., -1.], [1., -1.], [1., 1.], [0., 1.]]), TAU).unwrap();
        Solid::Revolved(audit(&body.check().unwrap()).unwrap())
    };
    // Routed to the general Boolean (boolean3d G12): the sideways cylinder lies
    // strictly inside the plate, and an enclosed void is not emitted yet.
    assert_eq!(refuse(vec![sideways]), "boolean/void-shell-unsupported");
    // Countersink whose r 2 rim touches the side face x = 0 exactly.
    assert_eq!(refuse(vec![tool([2., 8.], &SINK_UP, 2, false)]), "prism-stack/tool-crosses-boundary");
    // A tool entirely inside the slab would leave a sealed cavity.
    assert_eq!(refuse(vec![tool([8., 8.], &[[0., 1.], [1., 1.], [1., 2.], [0., 2.]], 2, false)]), "prism-stack/enclosed-tool-void");
    // The shared stack retains the rational 5/3 section circle. Its removed
    // volume is a radius-1 cylinder of height 2 plus a height-2 frustum.
    let rational = analytic::boolean(key(), 1, &[plate(), tool([8., 8.],
        &[[0., -1.], [1., -1.], [1., 2.], [2., 5.], [0., 5.]], 2, false)]).unwrap().remove(0);
    let decoded = wonky_wire::v3::decode(&wonky_wire::v3::encode(&rational).unwrap()).unwrap();
    let rational = analytic::audit(&decoded).unwrap();
    let json = rational.measure(None, &[]).unwrap();
    let expected = (1024. - 152. * std::f64::consts::PI / 27.) * (S * 1000.).powi(3);
    assert!((number(&json, "volumeMm3") - expected).abs() <= expected * 1e-12);
    assert_eq!(number(&json, "genus"), 1.);
    assert!(analytic::step(&[("rational-section".into(), rational)], "rational-section").unwrap().contains("CONICAL_SURFACE"));
    // Two countersinks whose rims touch.
    assert_eq!(
        refuse(vec![tool([4., 8.], &SINK_UP, 2, false), tool([8., 8.], &SINK_UP, 2, false)]),
        "prism-stack/tool-overlap"
    );
}

#[test]
fn revolve_holes_step_roundtrips_through_the_occt_oracle() {
    use std::{fs, process::Command};
    let dir = std::env::temp_dir().join(format!("wonky-revolve-holes-{}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    let pi = std::f64::consts::PI;
    let mm = S * 1000.;
    for (k, (mode, down)) in [(2, false), (0, true)].into_iter().enumerate() {
        let body = analytic::boolean(key(), 1, &holed(mode, down)).unwrap().pop().unwrap();
        let solid = analytic::audit(&body.check().unwrap()).unwrap();
        fs::write(dir.join(format!("{k}.step")), analytic::step(&[("holes".into(), solid)], "holes").unwrap()).unwrap();
        let volume = (1024. - pi * (16. / 3. + 5.5 + 7. / 3.)) * mm.powi(3);
        fs::write(dir.join(format!("{k}.expected")), format!("{{\"volume\":{volume},\"faces\":14,\"apexes\":1}}")).unwrap();
    }
    let rational = analytic::boolean(key(), 1, &[plate(), tool([8., 8.],
        &[[0., -1.], [1., -1.], [1., 2.], [2., 5.], [0., 5.]], 2, false)]).unwrap().remove(0);
    let rational = analytic::audit(&rational.check().unwrap()).unwrap();
    let step = analytic::step(&[("rational".into(), rational)], "rational").unwrap();
    // Six box planes plus two half-turn patches for each periodic wall band.
    assert_eq!(step.matches("CYLINDRICAL_SURFACE(").count(), 2);
    assert_eq!(step.matches("CONICAL_SURFACE(").count(), 2);
    fs::write(dir.join("rational.step"), step).unwrap();
    let volume = (1024. - 152. * pi / 27.) * mm.powi(3);
    fs::write(dir.join("rational.expected"), format!("{{\"volume\":{volume},\"faces\":10,\"apexes\":0}}")).unwrap();
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

#[test]
fn round_disc_with_off_axis_countersinks_matches_closed_forms() {
    // Disc r 10, height 4; two countersinks at x = +-5 (revolve cut off the
    // disc axis, which the coaxial revolve family refuses as non-coaxial).
    let pi = std::f64::consts::PI;
    let c = cylinder::create(key(), Spec { bottom: [0.; 3], top: [0., 0., 4. * S], radius: 10. * S }).unwrap();
    let disc = Solid::Cylinder(cylinder::audit(&c.check().unwrap()).unwrap());
    let body = analytic::boolean(
        key(),
        1,
        &[disc, tool([5., 0.], &SINK_UP, 2, false), tool([-5., 0.], &SINK_DOWN, 0, true)],
    )
    .unwrap()
    .pop()
    .unwrap();
    let solid = analytic::audit(&body.check().unwrap()).unwrap();
    let json = solid.measure(None, &[]).unwrap();
    let mm = S * 1000.;
    let volume = (400. - 32. / 3.) * pi * mm.powi(3);
    assert!((number(&json, "volumeMm3") - volume).abs() <= volume * 1e-12, "{json}");
    let area = (282. + 6. * std::f64::consts::SQRT_2) * pi * mm.powi(2);
    assert!((number(&json, "areaMm2") - area).abs() <= area * 1e-12, "{json}");
    assert_eq!(number(&json, "faces"), 7.);
    assert_eq!(number(&json, "genus"), 2.);
    // A countersink reaching the disc rim refuses by name.
    let c = cylinder::create(key(), Spec { bottom: [0.; 3], top: [0., 0., 4. * S], radius: 10. * S }).unwrap();
    let disc = Solid::Cylinder(cylinder::audit(&c.check().unwrap()).unwrap());
    assert_eq!(
        analytic::boolean(key(), 1, &[disc, tool([8., 0.], &SINK_UP, 2, false)]).unwrap_err().0,
        "prism-stack/tool-crosses-boundary"
    );
}

fn cylindrical_tool(x: f64, radius: f64, lo: f64, hi: f64) -> Solid {
    let body = cylinder::create(key(), Spec {
        bottom: [x * S, 8. * S, lo * S],
        top: [x * S, 8. * S, hi * S], radius: radius * S,
    }).unwrap();
    Solid::Cylinder(cylinder::audit(&body.check().unwrap()).unwrap())
}

#[test]
fn coaxial_cylinder_union_has_one_exact_stepped_boundary() {
    // Overlap, touching floors, redundant tools and both operand orders.
    for (bore_end, sink_start, sink_radius) in [(5., 3., 2.), (3., 3., 2.), (5., 3., 1.)] {
        for reverse in [false, true] {
            let mut tools = vec![cylindrical_tool(8., 1., -1., bore_end),
                cylindrical_tool(8., sink_radius, sink_start, 5.)];
            if reverse { tools.reverse(); }
            let mut operands = vec![plate()];
            operands.extend(tools);
            let body = analytic::boolean(key(), 1, &operands).unwrap().remove(0);
            let solid = analytic::audit(&body.clone().check().unwrap()).unwrap();
            let mm = S * 1000.;
            let json = solid.measure(None, &[[8. * mm, 8. * mm, 3.5 * mm],
                [9.5 * mm, 8. * mm, 2. * mm]]).unwrap();
            let removed = 3. + sink_radius.powi(2);
            let expected = (1024. - std::f64::consts::PI * removed) * mm.powi(3);
            assert!((number(&json, "volumeMm3") - expected).abs() < expected * 1e-12, "{json}");
            let area = (768. + std::f64::consts::PI * (6. + 2. * sink_radius - 2.)) * mm.powi(2);
            assert!((number(&json, "areaMm2") - area).abs() < area * 1e-12, "{json}");
            let probes = json.split("\"probes\":[").nth(1).unwrap();
            let entries = probes.split("},{").collect::<Vec<_>>();
            assert!(entries[0].contains("\"inside\":false"), "{json}");
            assert!(entries[1].contains("\"inside\":true"), "{json}");
            assert_eq!(number(&json, "genus"), 1.);
            assert_eq!(number(&json, "faces"), if sink_radius == 1. { 7. } else { 9. });
            // A fabricated/unmerged carrier cannot pass replay audit.
            let mut planted = body.clone();
            let at = planted.surfaces.iter().position(|s| matches!(s.geometry,
                wonky_contract::SurfaceGeometry::Cylinder { .. })).unwrap();
            if let wonky_contract::SurfaceGeometry::Cylinder { radius, .. } = &mut planted.surfaces[at].geometry {
                *radius = wonky_contract::Binary64::new(1.25 * S).unwrap();
            }
            assert!(analytic::audit(&planted.check().unwrap()).is_err());
            for e in 0..body.edges.len() {
                let uses = body.coedges.iter().filter(|c| c.edge.0 as usize == e).collect::<Vec<_>>();
                assert_eq!(uses.len(), 2);
                assert_ne!(uses[0].forward, uses[1].forward);
            }
        }
    }
}

#[test]
fn almost_coaxial_overlap_is_not_snapped_or_merged() {
    for x in [f64::from_bits(8.0_f64.to_bits() + 1), 8. + 1. / 1024.] {
        let body = analytic::boolean(key(), 1, &[plate(),
            cylindrical_tool(8., 1., -1., 5.), cylindrical_tool(x, 2., 3., 5.)])
            .unwrap().remove(0);
        let solid = analytic::audit(&body.clone().check().unwrap()).unwrap();
        let json = solid.measure(None, &[]).unwrap();
        let expected = (1024. - 7. * std::f64::consts::PI) * (S * 1000.).powi(3);
        assert!((number(&json, "volumeMm3") - expected).abs() < expected * 1e-12, "{json}");
        assert_eq!(number(&json, "genus"), 1.);
        assert_eq!(number(&json, "faces"), 9.);
        // The distinct source centre survives in the boundary's tool chart;
        // snapping it to the bore axis cannot pass replay audit.
        let at = body.frames.iter().position(|f| matches!(f,
            wonky_contract::Frame::Rigid { translation, .. } if translation[0].get() == x * S)).unwrap();
        let mut planted = body.clone();
        if let wonky_contract::Frame::Rigid { translation, .. } = &mut planted.frames[at] {
            translation[0] = wonky_contract::Binary64::new(8. * S).unwrap();
        }
        assert!(analytic::audit(&planted.check().unwrap()).is_err());
        for e in 0..body.edges.len() {
            let uses = body.coedges.iter().filter(|c| c.edge.0 as usize == e).collect::<Vec<_>>();
            assert_eq!(uses.len(), 2);
            assert_ne!(uses[0].forward, uses[1].forward);
        }
        assert!(analytic::step(&[("offset-counterbore".into(), solid)], "offset-counterbore").is_ok());
    }
    assert_eq!(analytic::boolean(key(), 1, &[plate(),
        cylindrical_tool(8., 1., -1., 5.), cylindrical_tool(9., 2., 3., 5.)])
        .unwrap_err().0, "prism-stack/tangent-branch-order");
    assert_eq!(analytic::boolean(key(), 1, &[plate(),
        cylindrical_tool(8., 1., -1., 5.), cylindrical_tool(8., 8., 3., 5.)])
        .unwrap_err().0, "prism-stack/tangent-branch-order");
}
