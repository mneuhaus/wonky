//! F2 rim blends on the Models of real family bodies (metre inputs as the
//! interpreter writes them), against the fillet catalogue's closed forms
//! (fixtures/fillet/cases.json pc-* rows), the `fillet_rim` family's Pappus
//! measures on the same point set (shadow), Model STEP and the chart mesh.
//! With WONKY_F2A_STEP_DIR set, each result's STEP is written there for the
//! independent OCCT validation (scripts/validate-step.py).
use wonky_contract::{Body, BodyKey, CurveGeometry};
use wonky_geom::model::{Carrier3, Model};
use wonky_ops::{
    affine::Affine,
    analytic::{self, Solid},
    arc_profile, chamfer_rim, cylinder, fillet, model_export, model_rim, orthogonal,
    polyhedron::audit,
};

fn key() -> BodyKey {
    BodyKey { id: [41, 43, 47, 53], revision: 0 }
}
fn solid(body: &Body) -> Solid {
    analytic::audit(&body.clone().check().unwrap()).unwrap()
}
fn cyl(bottom: [f64; 3], top: [f64; 3], radius: f64) -> Body {
    cylinder::create(key(), cylinder::Spec { bottom, top, radius }).unwrap()
}
/// Wire ring edges of `body` at height `z` (m) with radius `r` (m).
fn rings(body: &Body, z: f64, r: f64) -> Vec<usize> {
    body.edges
        .iter()
        .enumerate()
        .filter(|(_, e)| {
            matches!(&body.curves[e.curve.0 as usize].geometry,
                CurveGeometry::Circle { origin, radius, .. } if origin[2].get() == z && radius.get() == r)
        })
        .map(|(i, _)| i)
        .collect()
}
fn volume(m: &Model) -> f64 {
    model_export::volumes_mm3(m).unwrap().iter().sum()
}
fn carriers(m: &Model) -> Vec<&'static str> {
    let mut k: Vec<_> = m
        .draft()
        .faces
        .iter()
        .map(|f| match &m.draft().surfaces[f.surface.index()].carrier {
            Carrier3::Plane(_) | Carrier3::RadicalPlane(_) => "plane",
            Carrier3::Cylinder(_) | Carrier3::TranslatedCylinder(_) => "cylinder",
            Carrier3::Cone(_) => "cone",
            Carrier3::Sphere(_) => "sphere",
            Carrier3::Torus(_) => "torus",
            Carrier3::Rotated(_) => "rotated",
        })
        .collect();
    k.sort();
    k
}
fn near(a: f64, b: f64, what: &str) {
    assert!((a - b).abs() <= 1e-9 * b.abs().max(1.), "{what}: {a} vs {b}");
}
/// STEP and mesh of a result: analytic carriers, watertight chart mesh whose
/// enclosed volume is within the mesh deviation of the exact volume.
fn outputs(name: &str, m: &Model, expect: &str) {
    let step = model_export::step(&[(name.into(), m)], name).unwrap();
    assert!(step.contains(expect), "{name}: {expect} missing");
    assert!(!step.contains("B_SPLINE"), "{name}: approximation written");
    if let Some(dir) = std::env::var_os("WONKY_F2A_STEP_DIR") {
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(std::path::Path::new(&dir).join(format!("{name}.step")), &step).unwrap();
        let summary = model_export::summary_json(&[(name.into(), m)]).unwrap();
        std::fs::write(std::path::Path::new(&dir).join(format!("{name}.brep.json")), summary).unwrap();
    }
    let mesh = model_export::tessellate(m, 0.01).unwrap();
    let mut v6 = 0.;
    for t in &mesh.triangles {
        let [a, b, c] = t.map(|i| mesh.vertices[i]);
        v6 += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
    }
    let exact = volume(m);
    assert!((v6 / 6. - exact).abs() < 0.02 * exact.abs().max(1.) , "{name}: mesh {} vs {exact}", v6 / 6.);
}

const POST: f64 = std::f64::consts::PI * 250.; // r 5, h 10 (mm³)

/// ch-cone-rim-0.42 (fixtures/fillet/cases.json) on the exact revolution
/// Model of the frustum R 8 → 5 over 10 mm: the cone spring and the chamfer
/// cone are in Q(√109). Catalogue closed form ΔV = −2.601067091480044 mm³;
/// Model STEP (CONICAL_SURFACE, no spline) and the watertight chart mesh.
#[test]
fn frustum_rim_chamfer_in_q_sqrt_109_exports() {
    use wonky_geom::model::{revolution::revolution, Bounds, Curve3, EdgeId};
    use wonky_geom::{frame::Frame, Q};
    let mm = |n: i64| Q::new(n.into(), 1000.into());
    let profile = [[mm(0), mm(0)], [mm(8), mm(0)], [mm(5), mm(10)], [mm(0), mm(10)]];
    let m = revolution(Frame::identity(), Frame::identity(), &profile, 0).unwrap().check().unwrap();
    let d = m.draft();
    let top = (0..d.edges.len())
        .find(|&i| {
            matches!(d.edges[i].bounds, Bounds::Ring)
                && matches!(&d.curves[d.edges[i].curve.index()].geometry, Curve3::Circle(c)
                    if c.radius2() == &mm(5) * &mm(5) && c.frame().is_ok_and(|f| f.origin()[2] == mm(10)))
        })
        .unwrap();
    let w = Q::new(42.into(), 100_000.into());
    let (f, rim) = wonky_blend::rim::ring_chamfer(&m, EdgeId(top as u32), &w, 3).unwrap();
    assert!(rim.convex);
    assert_eq!(carriers(&f), ["cone", "cone", "plane", "plane"]);
    let frustum = std::f64::consts::PI * 430.; // π·10/3·(64 + 40 + 25) mm³
    near(volume(&f) - frustum, -2.601067091480044, "ch-cone-rim-0.42");
    outputs("ch-cone-rim-0.42", &f, "CONICAL_SURFACE");
    // pc-cone-rim-r1: fillet r 1 mm, torus major (53 − √109)/10 mm, tube band
    // to the cone normal's angle; catalogue ΔV = −3.2038500816319346 mm³.
    let (f, rim) = wonky_blend::rim::ring_fillet(&m, EdgeId(top as u32), &mm(1), 3).unwrap();
    assert!(rim.convex);
    assert_eq!(carriers(&f), ["cone", "plane", "plane", "torus"]);
    near(volume(&f) - frustum, -3.2038500816319346, "pc-cone-rim-r1");
    // The frozen OCCT result of the same job (fixtures/fillet/reference.json).
    near(volume(&f), 1347.6809909619801, "pc-cone-rim-r1 OCCT reference");
    outputs("pc-cone-rim-r1", &f, "TOROIDAL_SURFACE");
}

#[test]
fn post_rims_on_the_cylinder_model_match_the_catalogue() {
    let body = cyl([0., 0., 0.], [0., 0., 0.01], 0.005);
    let s = solid(&body);
    let top = rings(&body, 0.01, 0.005);
    let bottom = rings(&body, 0., 0.005);
    assert_eq!((top.len(), bottom.len()), (1, 1));
    // pc-post-top-rim-r1, -spindle-r3.5, -r4.99, -sphere-r5.
    for (name, r, delta, kinds) in [
        ("pc-post-top-rim-r1", 0.001, -6.440729977736223, ["cylinder", "plane", "plane", "torus"].as_slice()),
        ("pc-post-top-rim-spindle-r3.5", 0.0035, -69.67513459197049, ["cylinder", "plane", "plane", "torus"].as_slice()),
        ("pc-post-top-rim-r4.99", 0.00499, -130.45161422724163, ["cylinder", "plane", "plane", "torus"].as_slice()),
        ("pc-post-top-rim-sphere-r5", 0.005, -130.89969389957463, ["cylinder", "plane", "sphere"].as_slice()),
    ] {
        let m = model_rim::rim_fillet(&s, &body, &top, r, 9).unwrap();
        assert_eq!(carriers(&m), kinds, "{name}");
        near(volume(&m) - POST, delta, name);
        outputs(name, &m, if kinds.contains(&"torus") { "TOROIDAL_SURFACE" } else { "SPHERICAL_SURFACE" });
    }
    // pc-post-both-rims-r1: both closed loops in one call.
    let m = model_rim::rim_fillet(&s, &body, &[top[0], bottom[0]], 0.001, 9).unwrap();
    near(volume(&m) - POST, -12.881459955472446, "pc-post-both-rims-r1");
    outputs("pc-post-both-rims-r1", &m, "TOROIDAL_SURFACE");
    // pc-post-top-rim-too-large-r6: refuses by name, never a clamp.
    let e = model_rim::rim_fillet(&s, &body, &top, 0.006, 9).unwrap_err();
    assert!(e.0.starts_with("blend/radius-exceeds-rim("), "{e:?}");
}

#[test]
fn hole_rims_on_the_prism_holes_model_match_the_catalogue() {
    let plate = Solid::Planar(audit(&orthogonal::cuboid(key(), [0.; 3], [0.03, 0.03, 0.006]).unwrap().check().unwrap()).unwrap());
    let tool = solid(&cyl([0.015, 0.015, -0.001], [0.015, 0.015, 0.007], 0.004));
    let body = analytic::boolean(key(), 1, &[plate, tool]).unwrap().remove(0);
    let s = solid(&body);
    assert!(matches!(s, Solid::Perforated(_)), "hole plate family");
    let v0 = volume(&s.model().unwrap());
    let top = rings(&body, 0.006, 0.004);
    let bottom = rings(&body, 0., 0.004);
    assert_eq!((top.len(), bottom.len()), (1, 1));
    let m = model_rim::rim_fillet(&s, &body, &top, 0.001, 9).unwrap();
    near(volume(&m) - v0, -5.6947179819779254, "pc-hole-rim-r1");
    outputs("pc-hole-rim-r1", &m, "TOROIDAL_SURFACE");
    let m = model_rim::rim_fillet(&s, &body, &[top[0], bottom[0]], 0.001, 9).unwrap();
    near(volume(&m) - v0, -11.389435963955851, "pc-hole-both-rims-r1");
    outputs("pc-hole-both-rims-r1", &m, "TOROIDAL_SURFACE");
}

#[test]
fn boss_root_on_the_coaxial_union_adds_material() {
    let disk = solid(&cyl([0., 0., 0.], [0., 0., 0.003], 0.01));
    let post = solid(&cyl([0., 0., 0.003], [0., 0., 0.013], 0.004));
    let body = analytic::boolean(key(), 0, &[disk, post]).unwrap().remove(0);
    let s = solid(&body);
    let v0 = volume(&s.model().unwrap());
    let root = rings(&body, 0.003, 0.004);
    assert_eq!(root.len(), 1);
    let m = model_rim::rim_fillet(&s, &body, &root, 0.001, 9).unwrap();
    near(volume(&m) - v0, 5.6947179819779254, "pc-post-base-concave-r1");
    outputs("pc-post-base-concave-r1", &m, "TOROIDAL_SURFACE");
}

/// Shadow identity with the `fillet_rim` family on one point set: a post
/// written as four quarter arcs (the family's arc prism) against the
/// cylinder Model path. The family measures by Pappus (fillet_rim_observe);
/// the Model path by exact Green flux. The family needs every offset to be
/// an exact binary64 word, so this shadow uses the dyadic unit 2^-8 m (at
/// millimetre metre inputs the family refuses
/// `fillet/rim-offset-not-representable`, the number-class limit the general
/// path removes). Rows the family cannot build are asserted as its refusal.
#[test]
fn rim_family_shadow_on_a_four_arc_post() {
    let u = 1. / 256.;
    let arcs = [
        [5., 0., 4., 3., 0., 5.],
        [0., 5., -3., 4., -5., 0.],
        [-5., 0., -4., -3., 0., -5.],
        [0., -5., 3., -4., 5., 0.],
    ]
    .map(|a| a.map(|x| x * u));
    let prism = audit(&arc_profile::build(key(), Affine::IDENTITY, &[], &arcs, 10. * u, false).unwrap().check().unwrap()).unwrap();
    let body = cyl([0., 0., 0.], [0., 0., 10. * u], 5. * u);
    let s = solid(&body);
    let top = rings(&body, 10. * u, 5. * u);
    for r in [1., 3.5, 639. / 128.] {
        let family = fillet::constant_radius(&prism, &[4, 5, 6, 7], r * u).unwrap();
        let family = audit(&family.check().unwrap()).unwrap();
        let general = model_rim::rim_fillet(&s, &body, &top, r * u, 9).unwrap();
        near(volume(&general), family.volume_mm3().unwrap(), &format!("shadow volume r={r}"));
        let area: f64 = family.face_areas_mm2().unwrap().iter().sum();
        let exact = general.area_pi().unwrap().remove(0);
        let (lo, hi) = exact.enclosure(64).unwrap();
        use num_traits::ToPrimitive;
        let mm2 = (lo.to_f64().unwrap() + hi.to_f64().unwrap()) / 2. * 1e6;
        near(mm2, area, &format!("shadow area r={r}"));
    }
    // r = rho: the family has no sphere cap and refuses by name; the
    // general path emits the sphere (post_rims_on_the_cylinder_model_...).
    let e = fillet::constant_radius(&prism, &[4, 5, 6, 7], 5. * u).unwrap_err();
    assert!(e.0.starts_with("fillet/rim-"), "{e:?}");
    // The family cannot add a second rim; the general path can (both rims).
    let once = fillet::constant_radius(&prism, &[4, 5, 6, 7], u).unwrap();
    let once = audit(&once.check().unwrap()).unwrap();
    let e = fillet::constant_radius(&once, &[0, 1, 2, 3], u).unwrap_err();
    assert!(e.0.starts_with("fillet/") || e.0.starts_with("arc-profile/"), "{e:?}");
}

/// No-Claim (G20): a Boolean on a torus-faced result refuses by name.
#[test]
fn a_boolean_on_a_torus_faced_model_refuses_until_g20() {
    let body = cyl([0., 0., 0.], [0., 0., 0.01], 0.005);
    let s = solid(&body);
    let m = model_rim::rim_fillet(&s, &body, &rings(&body, 0.01, 0.005), 0.001, 9).unwrap();
    let other = solid(&cyl([0.002, 0., -0.001], [0.002, 0., 0.011], 0.001)).model().unwrap();
    for op in [wonky_bool::Op::Union, wonky_bool::Op::Subtraction, wonky_bool::Op::Intersection] {
        let e = wonky_bool::fold_models(op, &[&m, &other], 1).unwrap_err();
        assert_eq!(e.0, "boolean/ssi-row-unavailable:torus×cylinder");
    }
}

/// Wire edges of `body` whose both vertices lie at height `z` (m).
fn loop_at(body: &Body, z: f64) -> Vec<usize> {
    body.edges
        .iter()
        .enumerate()
        .filter(|(_, e)| e.vertices.len() == 2 && e.vertices.iter().all(|v| body.vertices[v.0 as usize].point[2].get() == z))
        .map(|(i, _)| i)
        .collect()
}
fn pi_value(m: &Model, area: bool) -> [wonky_geom::Q; 3] {
    let v = if area { m.area_pi() } else { m.volume6_pi() }.unwrap().remove(0);
    [v.rational, v.pi, v.pi2]
}
fn scaled(k: [i64; 3], unit: &wonky_geom::Q) -> [wonky_geom::Q; 3] {
    k.map(|x| wonky_geom::Q::from_integer(x.into()) * unit)
}

/// AC32's obround (caps r 4 at (4,4), (12,4), height 6) as an arc prism in
/// the dyadic unit 2^-8 m, whose `fillet_rim` family route is the shadow.
fn obround() -> (Body, wonky_ops::polyhedron::Audited, f64) {
    let u = 1. / 256.;
    let lines = [[4., 0., 12., 0.], [12., 8., 4., 8.]].map(|a| a.map(|x| x * u));
    let arcs = [[12., 0., 16., 4., 12., 8.], [4., 8., 0., 4., 4., 0.]].map(|a| a.map(|x| x * u));
    let body = arc_profile::build(key(), Affine::IDENTITY, &lines, &arcs, 6. * u, false).unwrap();
    let prism = audit(&body.clone().check().unwrap()).unwrap();
    (body, prism, u)
}

/// AC32 (fixtures/cad-acid/zones.json): the obround's top rim is a G1
/// chain of two lines and two half arcs. On the arc prism's Model it becomes
/// two cylinder and two partial torus patches sharing exact meridian circles:
/// the zone's closed form exactly (6V = 2208 + 562π + 9π², A = 192 + 75π +
/// 3π², in units u), its topology F10 E20 V12, the family's measures, STEP
/// and the chart mesh.
#[test]
fn ac32_obround_rim_chain_on_the_arc_prism_model() {
    let (body, prism, u) = obround();
    let s = Solid::Planar(prism.clone());
    let top = loop_at(&body, 6. * u);
    assert_eq!(top.len(), 4);
    let m = model_rim::chain_fillet(&s, &body, &top, u, 9).unwrap();
    let uq = wonky_geom::Q::from_float(u).unwrap();
    assert_eq!(pi_value(&m, false), scaled([2208, 562, 9], &(&uq * &uq * &uq)), "AC32 6V");
    assert_eq!(pi_value(&m, true), scaled([192, 75, 3], &(&uq * &uq)), "AC32 area");
    let d = m.draft();
    assert_eq!((d.faces.len(), d.edges.len(), d.vertices.len()), (10, 20, 12), "AC32 F E V");
    assert_eq!(carriers(&m), ["cylinder", "cylinder", "cylinder", "cylinder", "plane", "plane", "plane", "plane", "torus", "torus"]);
    // Shadow: the fillet_rim family on the same point set.
    let family = audit(&fillet::constant_radius(&prism, &top, u).unwrap().check().unwrap()).unwrap();
    near(volume(&m), family.volume_mm3().unwrap(), "AC32 shadow volume");
    let area: f64 = family.face_areas_mm2().unwrap().iter().sum();
    let (lo, hi) = m.area_pi().unwrap().remove(0).enclosure(64).unwrap();
    use num_traits::ToPrimitive;
    near((lo.to_f64().unwrap() + hi.to_f64().unwrap()) / 2. * 1e6, area, "AC32 shadow area");
    outputs("ac32-obround-rim-r1", &m, "TOROIDAL_SURFACE");
    // Both rims: the bottom loop of the result (untouched edges keep ids).
    let bottom = loop_at(&body, 0.);
    let ids: Vec<_> = bottom.iter().map(|&i| model_rim::segment_edge(&m, &body, i).unwrap()).collect();
    let both = wonky_blend::chain::chain_fillet(&m, &ids, &uq, 10).unwrap();
    assert_eq!(pi_value(&both, false), scaled([2112, 548, 18], &(&uq * &uq * &uq)), "both rims 6V");
    outputs("ac32-obround-both-rims-r1", &both, "TOROIDAL_SURFACE");
}

/// Planted negatives of the chain: a corner is not a G1 junction (F4), an
/// arc radius equal to r would need a partial sphere cap, beyond it the rim
/// refuses by name; nothing is clamped or welded.
#[test]
fn chain_refusals_are_named() {
    let (body, prism, u) = obround();
    let s = Solid::Planar(prism);
    let top = loop_at(&body, 6. * u);
    let e = model_rim::chain_fillet(&s, &body, &top, 4. * u, 9).unwrap_err();
    assert_eq!(e.0, "blend/partial-sphere-cap-unavailable");
    let e = model_rim::chain_fillet(&s, &body, &top, 5. * u, 9).unwrap_err();
    assert!(e.0.starts_with("blend/radius-exceeds-rim("), "{e:?}");
    let e = model_rim::chain_fillet(&s, &body, &top[..2], u, 9).unwrap_err();
    assert_eq!(e.0, "blend/chain-not-a-face-loop");
    let box_body = orthogonal::cuboid(key(), [0.; 3], [0.03, 0.02, 0.01]).unwrap();
    let cuboid = Solid::Planar(audit(&box_body.clone().check().unwrap()).unwrap());
    let e = model_rim::chain_fillet(&cuboid, &box_body, &loop_at(&box_body, 0.01), 0.001, 9).unwrap_err();
    assert_eq!(e.0, "blend/chain-junction-not-tangent");
}

/// AC33 at the interpreter's metre inputs (R 8, h 8, chamfer 2 mm): one cone
/// band, the catalogue's closed form, CONICAL_SURFACE STEP and a closed mesh.
#[test]
fn ac33_rim_chamfer_on_the_cylinder_model_matches_the_catalogue() {
    let body = cyl([0., 0., 0.], [0., 0., 0.008], 0.008);
    let s = solid(&body);
    let top = rings(&body, 0.008, 0.008);
    assert_eq!(top.len(), 1);
    let m = model_rim::rim_chamfer(&s, &body, &top, 0.002, 9).unwrap();
    assert_eq!(carriers(&m), ["cone", "cylinder", "plane", "plane"]);
    near(volume(&m), 1516.34205413267353643130253966, "AC33");
    outputs("ac33-rim-chamfer", &m, "CONICAL_SURFACE");
    let e = model_rim::rim_chamfer(&s, &body, &top, 0.009, 9).unwrap_err();
    assert!(e.0.starts_with("blend/width-exceeds-rim("), "{e:?}");
}

/// Shadow identity with the `chamfer_rim` family on one point set: the
/// family's conical body (Pappus moments) against the cylinder Model path
/// (exact Green flux), top, bottom and both rims. The family needs exact
/// binary64 ring offsets, so the shadow uses the dyadic unit 2^-8 m.
#[test]
fn rim_chamfer_family_shadow_on_ac33() {
    let u = 1. / 256.;
    let body = cyl([0., 0., 0.], [0., 0., 8. * u], 8. * u);
    let s = solid(&body);
    let Solid::Cylinder(c) = &s else { panic!("cylinder family") };
    let top = rings(&body, 8. * u, 8. * u);
    let bottom = rings(&body, 0., 8. * u);
    for w in [2., 0.5, 7.] {
        for (family_edges, general_edges) in [(vec![1], top.clone()), (vec![0], bottom.clone()), (vec![0, 1], [bottom[0], top[0]].to_vec())] {
            if w * family_edges.len() as f64 >= 8. {
                continue;
            }
            let family = chamfer_rim::equal_offsets(c, &family_edges, w * u).unwrap();
            let family = analytic::audit(&family.check().unwrap()).unwrap();
            let Solid::Conical(family) = family else { panic!("conical family") };
            let (fv, _) = family.measures_mm().unwrap();
            let general = model_rim::rim_chamfer(&s, &body, &general_edges, w * u, 9).unwrap();
            let gv = volume(&general);
            let what = format!("shadow volume w={w} edges={family_edges:?}");
            near(gv, fv.m, &what);
            assert!(fv.lo() <= gv * (1. + 1e-12) && gv * (1. - 1e-12) <= fv.hi(), "{what}: {gv} outside {fv:?}");
        }
    }
    // The family refuses the full-width cone apex by name; the general path
    // builds it (wonky-blend tests/rim.rs: 500π/3 at R 5).
    // At AC33 itself w = R = h also consumes the band: a named overflow.
    let e = model_rim::rim_chamfer(&s, &body, &top, 8. * u, 9).unwrap_err();
    assert!(e.0.starts_with("blend/overflow:band-consumed("), "{e:?}");
    let tall = cyl([0., 0., 0.], [0., 0., 16. * u], 8. * u);
    let t = solid(&tall);
    let Solid::Cylinder(c) = &t else { panic!("cylinder family") };
    let e = chamfer_rim::equal_offsets(c, &[1], 8. * u).unwrap_err();
    assert_eq!(e.0, "chamfer/rim-cap-consumed");
    let apex = model_rim::rim_chamfer(&t, &tall, &rings(&tall, 16. * u, 8. * u), 8. * u, 9).unwrap();
    assert_eq!(carriers(&apex), ["cone", "cylinder", "plane"]);
    // 1024π u³ − 2π(8 − 8/3)·32 u³ = 2048π/3 u³.
    near(volume(&apex), 2048. * std::f64::consts::PI / 3. * u * u * u * 1e9, "apex volume");
}

/// The tea box rounded rectangle written as lines and three-point quarter
/// arcs (mid points at 3-4-5 angles, fixtures/blend-extrusions-2/rrc.fs), at
/// unit `u` m: corner radius 5u, 160u × 45u, extruded 10u.
fn three_point_box(u: f64) -> Body {
    let (w, d, r) = (160. * u, 45. * u, 5. * u);
    let lines = [[r, 0., w - r, 0.], [w, r, w, d - r], [w - r, d, r, d], [0., d - r, 0., r]];
    let arcs = [
        [w - r, 0., w - 0.4 * r, 0.2 * r, w, r],
        [w, d - r, w - 0.4 * r, d - 0.2 * r, w - r, d],
        [r, d, 0.4 * r, d - 0.2 * r, 0., d - r],
        [0., r, 0.4 * r, 0.2 * r, r, 0.],
    ];
    arc_profile::build(key(), Affine::IDENTITY, &lines, &arcs, 10. * u, false).unwrap()
}
/// The same box with its first corner written as an exact three-point arc
/// of rational radius 5 whose centre (w − 4, 4) is off the tangent position
/// (w − 7, 7): the arc meets both lines at a visible angle.
fn kinked_box(u: f64) -> Body {
    let (w, d, r) = (160. * u, 45. * u, 5. * u);
    let k = 7. * u;
    let lines = [[r, 0., w - k, 0.], [w, k, w, d - r], [w - r, d, r, d], [0., d - r, 0., r]];
    let arcs = [
        [w - k, 0., w + u, 4. * u, w, k],
        [w, d - r, w - 0.4 * r, d - 0.2 * r, w - r, d],
        [r, d, 0.4 * r, d - 0.2 * r, 0., d - r],
        [0., r, 0.4 * r, 0.2 * r, r, 0.],
    ];
    arc_profile::build(key(), Affine::IDENTITY, &lines, &arcs, 10. * u, false).unwrap()
}
fn top_edges(body: &Body, z: f64) -> Vec<usize> {
    (0..body.edges.len())
        .filter(|&i| {
            let vs = &body.edges[i].vertices;
            !vs.is_empty() && vs.iter().all(|v| body.vertices[v.0 as usize].point[2].get() == z)
        })
        .collect()
}

/// Planted negative (fillets3d F2): a three-point arc whose junction with a
/// line is not exactly tangent must refuse, never weld into a G1 chain.
///
/// * Exact, visible kink (dyadic grid 2^-8 m, rational radius): the Model
///   chain decides the junction exactly and refuses
///   `blend/chain-junction-not-tangent` (a corner: the F4 mitre); the
///   exactly tangent control on the same grid builds on the Model and on the
///   family route, so the refusal is the junction test, not the input.
/// * The tea box idiom at millimetre metre inputs (circumcentre off the
///   tangent position; mitre gap r·sinθ ≈ 1.8e-18 m at r = u, below one
///   binary64 ulp of the 0.064 m profile, 1.4e-17 m): the Model chain refuses
///   `blend/sub-resolution-feature(min=…)` for fillet and chamfer before any
///   number class; the families still refuse by class
///   (`fillet/rim-radius-not-representable`). Nothing welds.
#[test]
fn a_non_tangent_three_point_arc_junction_never_welds() {
    let u = 1. / 256.;
    let tangent = three_point_box(u);
    let prism = audit(&tangent.clone().check().unwrap()).unwrap();
    let s = Solid::Planar(prism);
    let top = top_edges(&tangent, 10. * u);
    assert_eq!(top.len(), 8, "four lines and four arcs on the top cap");
    model_rim::chain_fillet(&s, &tangent, &top, u, 9).expect("exactly tangent chain builds");
    let Solid::Planar(family) = &s else { unreachable!() };
    fillet::constant_radius(family, &top, u).expect("exactly tangent chain builds on the family route");
    let kinked = kinked_box(u);
    let prism = audit(&kinked.clone().check().unwrap()).unwrap();
    let k = Solid::Planar(prism.clone());
    let top = top_edges(&kinked, 10. * u);
    assert_eq!(top.len(), 8);
    let e = model_rim::chain_fillet(&k, &kinked, &top, u, 9).unwrap_err();
    assert_eq!(e.0, "blend/chain-junction-not-tangent");
    // The family route of the same selection must not weld either.
    let e = fillet::constant_radius(&prism, &top, u).expect_err("family welded a kinked chain");
    eprintln!("kinked family refusal: {}", e.0);

    let u = 1e-3 / 5. * 2.;
    let body = three_point_box(u);
    let prism = audit(&body.clone().check().unwrap()).unwrap();
    let top = top_edges(&body, 10. * u);
    assert_eq!(top.len(), 8);
    let e = fillet::constant_radius(&prism, &top, u).unwrap_err();
    assert_eq!(e.0, "fillet/rim-radius-not-representable");
    let e = wonky_ops::chamfer::equal_offsets(&prism, &top, u).unwrap_err();
    assert_eq!(e.0, "fillet/rim-radius-not-representable");
    let s = Solid::Planar(prism);
    for e in [
        model_rim::chain_fillet(&s, &body, &top, u, 9).expect_err("near-tangent chain welded"),
        model_rim::chain_chamfer(&s, &body, &top, u, 9).expect_err("near-tangent chain welded"),
    ] {
        assert!(e.0.starts_with("blend/sub-resolution-feature(min="), "{e:?}");
        eprintln!("near-tangent Model chain refusal: {}", e.0);
    }
}

/// AC32's obround with an equal-offset chamfer on its top rim chain (F2,
/// §3 row 5): two chamfer planes and two partial cone patches sharing exact
/// straight generators. Closed form (unit u = 2^-8 m, w = u): the straights
/// lose 2·8·w²/2 = 8, the two half arcs one full Pappus turn of the triangle
/// (area 1/2, centroid radius 4 − 1/3): 11π/3, so 6V = 2304 + 576π − 48 − 22π
/// = 2256 + 554π. Topology F10 E20 V12 as the fillet. Shadow: the arc-prism
/// chamfer family (`fillet_rim::apply_band`) on the same selection; STEP
/// CONICAL_SURFACE and the closed chart mesh. Both rims: 6V = 2208 + 532π.
#[test]
fn ac32_obround_rim_chain_chamfer_on_the_arc_prism_model() {
    let (body, prism, u) = obround();
    let s = Solid::Planar(prism.clone());
    let top = loop_at(&body, 6. * u);
    let m = model_rim::chain_chamfer(&s, &body, &top, u, 9).unwrap();
    let uq = wonky_geom::Q::from_float(u).unwrap();
    let u3 = &uq * &uq * &uq;
    assert_eq!(pi_value(&m, false), scaled([2256, 554, 0], &u3), "chain chamfer 6V");
    let d = m.draft();
    assert_eq!((d.faces.len(), d.edges.len(), d.vertices.len()), (10, 20, 12), "F E V");
    assert_eq!(carriers(&m), ["cone", "cone", "cylinder", "cylinder", "plane", "plane", "plane", "plane", "plane", "plane"]);
    let family = audit(&wonky_ops::chamfer::equal_offsets(&prism, &top, u).unwrap().check().unwrap()).unwrap();
    near(volume(&m), family.volume_mm3().unwrap(), "chain chamfer shadow volume");
    outputs("ac32-obround-rim-chamfer-w1", &m, "CONICAL_SURFACE");
    let bottom = loop_at(&body, 0.);
    let ids: Vec<_> = bottom.iter().map(|&i| model_rim::segment_edge(&m, &body, i).unwrap()).collect();
    let both = wonky_blend::chain::chain_chamfer(&m, &ids, &uq, 10).unwrap();
    assert_eq!(pi_value(&both, false), scaled([2208, 532, 0], &u3), "both rims 6V");
    outputs("ac32-obround-both-rims-chamfer-w1", &both, "CONICAL_SURFACE");
    // Mixed sections on one body: fillet the top, chamfer the bottom.
    let filleted = model_rim::chain_fillet(&s, &body, &top, u, 9).unwrap();
    let ids: Vec<_> = bottom.iter().map(|&i| model_rim::segment_edge(&filleted, &body, i).unwrap()).collect();
    let mixed = wonky_blend::chain::chain_chamfer(&filleted, &ids, &uq, 10).unwrap();
    // 2208 + 562π + 9π² (fillet) less the chamfer's 48 + 22π.
    assert_eq!(pi_value(&mixed, false), scaled([2160, 540, 9], &u3), "fillet top, chamfer bottom 6V");
}

/// Chain chamfer refusals: an arc radius equal to w would end the cone patch
/// in its apex, beyond it the rim refuses by name; a corner is no G1 chain.
#[test]
fn chain_chamfer_refusals_are_named() {
    let (body, prism, u) = obround();
    let s = Solid::Planar(prism);
    let top = loop_at(&body, 6. * u);
    let e = model_rim::chain_chamfer(&s, &body, &top, 4. * u, 9).unwrap_err();
    assert_eq!(e.0, "blend/partial-cone-apex-unavailable");
    let e = model_rim::chain_chamfer(&s, &body, &top, 4.5 * u, 9).unwrap_err();
    assert!(e.0.starts_with("blend/width-exceeds-rim("), "{e:?}");
    let e = model_rim::chain_chamfer(&s, &body, &top, 6. * u, 9).unwrap_err();
    assert!(e.0.starts_with("blend/"), "{e:?}");
    let box_body = orthogonal::cuboid(key(), [0.; 3], [0.03, 0.02, 0.01]).unwrap();
    let cuboid = Solid::Planar(audit(&box_body.clone().check().unwrap()).unwrap());
    let e = model_rim::chain_chamfer(&cuboid, &box_body, &loop_at(&box_body, 0.01), 0.001, 9).unwrap_err();
    assert_eq!(e.0, "blend/chain-junction-not-tangent");
}

fn host_blend(source: &Body, edges: &[u32], chamfer: bool, width: f64) -> Body {
    use wonky_ops::host;
    let words = wonky_wire::v3::encode(source).unwrap();
    let bits = width.to_bits();
    let mut request = vec![host::MAGIC, host::VERSION, if chamfer { host::OP_CHAMFER } else { host::OP_FILLET }, words.len() as u32];
    request.extend(words);
    request.extend([bits as u32, (bits >> 32) as u32, edges.len() as u32]);
    request.extend(edges);
    let result = host::host_op(&request);
    assert_eq!(result[0], 0, "{}", result.iter().skip(1).filter_map(|&c| char::from_u32(c)).collect::<String>());
    wonky_wire::v3::decode(&result[1..]).unwrap().body().clone()
}
fn measured_volume(s: &Solid) -> f64 {
    let m = s.measure(None, &[]).unwrap();
    m.split("\"volumeMm3\":").nth(1).unwrap().split(',').next().unwrap().parse().unwrap()
}

/// Shadow identity with the `stack_blend` family (whole tangent cap loops of
/// a stacked prism, F2 "adopt stack_blend"): the obround (metre units) with
/// a cuboid pocket from z = 2 is a prism stack; the host chamfers and fillets
/// its bottom rim chain there. The Model chain on the plain obround removes
/// the same material (the pocket stays clear of the bottom band), so the
/// removed volumes must agree: chamfer w = 1/2 removes 2 + 23π/24 m³ exactly,
/// the fillet r = 1/2 the family's own measure.
#[test]
fn chain_blends_shadow_the_stack_blend_family() {
    let key = BodyKey { id: [91; 4], revision: 0 };
    let lines = [[4., 0., 12., 0.], [12., 8., 4., 8.]];
    let arcs = [[12., 0., 16., 4., 12., 8.], [4., 8., 0., 4., 4., 0.]];
    let plain = arc_profile::build(key.clone(), Affine::IDENTITY, &lines, &arcs, 6., false).unwrap();
    let outer = solid(&plain);
    let pocket = solid(&orthogonal::cuboid(key.clone(), [5., 2., 2.], [11., 6., 8.]).unwrap());
    let pocketed = analytic::boolean(key, 1, &[outer.clone(), pocket]).unwrap().remove(0);
    let ps = solid(&pocketed);
    assert!(matches!(ps, Solid::PrismStack(_)));
    let foot: Vec<u32> = (0..pocketed.edges.len())
        .filter(|&i| pocketed.edges[i].vertices.iter().all(|v| pocketed.vertices[v.0 as usize].point[2].get() == 0.))
        .map(|i| i as u32)
        .collect();
    assert_eq!(foot.len(), 4);
    let bottom = loop_at(&plain, 0.);
    let v0 = measured_volume(&ps);
    let m0 = volume(&outer.model().unwrap());
    let pi = std::f64::consts::PI;
    for chamfer in [true, false] {
        let family = solid(&host_blend(&pocketed, &foot, chamfer, 0.5));
        let removed_family = v0 - measured_volume(&family);
        let general = if chamfer {
            model_rim::chain_chamfer(&outer, &plain, &bottom, 0.5, 9).unwrap()
        } else {
            model_rim::chain_fillet(&outer, &plain, &bottom, 0.5, 9).unwrap()
        };
        let removed_general = m0 - volume(&general);
        near(removed_general, removed_family, &format!("stack_blend shadow chamfer={chamfer}"));
        if chamfer {
            near(removed_general, (2. + 23. * pi / 24.) * 1e9, "chamfer closed form");
        }
    }
}

/// Vertical wire edges of a box body (both vertices share x and y).
fn vertical_edges(body: &Body) -> Vec<u32> {
    (0..body.edges.len())
        .filter(|&i| {
            let [a, b] = body.edges[i].vertices[..] else { return false };
            let (a, b) = (body.vertices[a.0 as usize].point, body.vertices[b.0 as usize].point);
            a[0] == b[0] && a[1] == b[1] && a[2] != b[2]
        })
        .map(|i| i as u32)
        .collect()
}

/// The foot loop of a Model: its planar face loop whose vertices all lie at
/// world z = 0. (A fillet's spring vertices such as 0.16 − 0.002 are exact
/// rationals whose binary64 caches differ, so wire caches cannot name the
/// Model edges.)
fn foot_loop(m: &Model) -> Vec<wonky_geom::model::EdgeId> {
    use num_traits::Zero;
    let d = m.draft();
    let world_z = |v: wonky_geom::model::VertexId| {
        d.placement.point(d.vertices[v.index()].def.key().unwrap().rational().unwrap())[2].clone()
    };
    let loops: Vec<Vec<wonky_geom::model::EdgeId>> = d
        .faces
        .iter()
        .filter(|f| matches!(d.surfaces[f.surface.index()].carrier, Carrier3::Plane(_)))
        .flat_map(|f| f.loops.iter())
        .map(|l| d.loops[l.index()].coedges.iter().map(|c| d.coedges[c.index()].edge).collect::<Vec<_>>())
        .filter(|edges| {
            edges.iter().all(|e| match d.edges[e.index()].bounds {
                wonky_geom::model::Bounds::Segment(vs) => vs.iter().all(|&v| world_z(v).is_zero()),
                wonky_geom::model::Bounds::Ring => false,
            })
        })
        .collect();
    let [foot] = &loops[..] else { panic!("one foot loop, found {}", loops.len()) };
    foot.clone()
}

/// The D5 tea box (fixtures/teabox-fillet/rrc-fillet.fs: 160 × 45 × 45 mm,
/// wall 2, opFillet r 2 on the vertical edges of the outer box and of the
/// pocket tool, 0.42 equal-offset foot chamfer) at the interpreter's metre
/// inputs. Closed form in Q + Qπ of the same binary64 inputs: A = WD −
/// (4 − π)r² per rounded rectangle; the chamfer removes L·w²/2 along the
/// straights (L = 2(W − 2r) + 2(D − 2r)) and π(r − w/3)·w² along the four
/// quarter arcs (Pappus).
///
/// * Exact Model route: the rounded outer box's Model with the chain chamfer
///   on its foot loop (planes and four partial cone patches; STEP and chart
///   mesh), less the rounded pocket's Model clipped to the box (z from t to
///   h). Its Green-flux 6V must equal the closed form exactly.
/// * The host route builds the subtraction as one prism stack (both rounded
///   boxes are `profile_blend` operands; its measure is the closed form
///   without the chamfer). Its `stack_blend` foot chamfer refuses
///   `fillet/rim-offset-not-representable` (binary64 carriers; 0.002 −
///   0.00042 m is not one), so the host chamfers the stack's general Model
///   (F2c: rule 6 over the same source leaves, then the rule-11 chain
///   chamfer). Its 6V must equal the closed form exactly, too.
#[test]
fn tea_box_by_the_exact_model_route() {
    use num_traits::{ToPrimitive, Zero};
    use wonky_geom::Q;
    let (w, d, h, t, r, c) = (160. * 0.001, 45. * 0.001, 45. * 0.001, 2. * 0.001, 2. * 0.001, 0.42 * 0.001);
    let filleted = |lo: [f64; 3], hi: [f64; 3]| -> Body {
        let b = orthogonal::cuboid(key(), lo, hi).unwrap();
        let edges = vertical_edges(&b);
        assert_eq!(edges.len(), 4);
        host_blend(&b, &edges, false, r)
    };
    let q = |x: f64| Q::from_float(x).unwrap();
    let (wq, dq, hq, tq, rq, cq) = (q(w), q(d), q(h), q(t), q(r), q(c));
    let (wi, di) = (q(w - t) - &tq, q(d - t) - &tq);
    let r2 = &rq * &rq;
    let [two, three, four, six] = [2, 3, 4, 6].map(|k| Q::from_integer(k.into()));
    let length = &two * (&wq - &two * &rq) + &two * (&dq - &two * &rq);
    let rational = &wq * &dq * &hq - &four * &r2 * &hq - (&wi * &di - &four * &r2) * (&hq - &tq) - &length * &cq * &cq / &two;
    let pi = &r2 * &hq - &r2 * (&hq - &tq) - (&rq - &cq / &three) * &cq * &cq;
    let closed = [&six * rational, &six * pi, Q::zero()];

    let outer = filleted([0.; 3], [w, d, h]);
    let os = solid(&outer);
    assert_eq!(loop_at(&outer, 0.).len(), 8, "four lines and four quarter arcs");
    let tool = filleted([t, t, t], [w - t, d - t, h + t]);
    let ts = solid(&tool);

    let om = os.model().unwrap();
    let foot = foot_loop(&om);
    assert_eq!(foot.len(), 8);
    let chamfered = wonky_blend::chain::chain_chamfer(&om, &foot, &cq, 9).unwrap();
    assert_eq!(carriers(&chamfered).iter().filter(|k| **k == "cone").count(), 4);
    outputs("teabox-outer-foot-chamfer", &chamfered, "CONICAL_SURFACE");
    let pocket = solid(&filleted([t, t, t], [w - t, d - t, h])).model().unwrap();
    let [a, p] = [pi_value(&chamfered, false), pi_value(&pocket, false)];
    assert_eq!([&a[0] - &p[0], &a[1] - &p[1], &a[2] - &p[2]], closed, "tea box 6V, Model route = closed form");
    let mm3 = (closed[0].to_f64().unwrap() + closed[1].to_f64().unwrap() * std::f64::consts::PI) / 6. * 1e9;
    eprintln!("tea box exact volume: {mm3} mm³ (6V = {} + {}π m³)", closed[0], closed[1]);
    near(mm3, 48905.2492 + 7.671896 * std::f64::consts::PI, "tea box nominal mm³");

    // The host route: the subtraction builds as a prism stack; the family
    // foot chamfer refuses by name (binary64 carriers).
    let open = analytic::boolean(key(), 1, &[os, ts]).map_err(|e| e.0).expect("rounded boxes subtract").remove(0);
    let stack = solid(&open);
    assert!(matches!(stack, Solid::PrismStack(_)), "prism stack");
    let empty = (&wq * &dq - &four * &r2) * &hq - (&wi * &di - &four * &r2) * (&hq - &tq);
    let empty_pi = &r2 * &tq;
    let expected = (empty.to_f64().unwrap() + empty_pi.to_f64().unwrap() * std::f64::consts::PI) * 1e9;
    near(measured_volume(&stack), expected, "open box, host route");
    let feet: Vec<u32> = (0..open.edges.len())
        .filter(|&i| open.edges[i].vertices.iter().all(|v| open.vertices[v.0 as usize].point[2].get() == 0.))
        .map(|i| i as u32)
        .collect();
    assert_eq!(feet.len(), 8);
    use wonky_ops::host;
    let words = wonky_wire::v3::encode(&open).unwrap();
    let bits = c.to_bits();
    let mut request = vec![host::MAGIC, host::VERSION, host::OP_CHAMFER, words.len() as u32];
    request.extend(words);
    request.extend([bits as u32, (bits >> 32) as u32, feet.len() as u32]);
    request.extend(feet);
    let reply = host::host_op(&request);
    let reason: String = reply.iter().skip(1).filter_map(|&x| char::from_u32(x)).collect();
    assert_eq!(reply[0], host::STATUS_OK, "host chamfer: {reason}");
    let built = wonky_wire::v3::decode(&reply[1..]).unwrap();
    let Solid::Model(_, host_model) = analytic::audit(&built).unwrap() else { panic!("host chamfer is a Model body") };
    assert_eq!(carriers(&host_model).iter().filter(|k| **k == "cone").count(), 4);
    assert_eq!(pi_value(&host_model, false), closed, "tea box 6V, host route = closed form");
    outputs("teabox-host-foot-chamfer", &host_model, "CONICAL_SURFACE");
    let cones = (0..host_model.draft().faces.len() as u32)
        .filter_map(|f| host_model.rev_patch(wonky_geom::model::FaceId(f)).unwrap())
        .filter(|p| matches!(p.profile, wonky_geom::model::Profile::Cone { .. }))
        .inspect(cone_moments_by_quadrature)
        .count();
    assert_eq!(cones, 4, "every cone corner's exact first moments checked");
}

/// The exact first-moment fluxes of one cone chart patch (`moment_flux`, the
/// centroid's face row) against direct Gauss-Legendre quadrature of their
/// definition ∬ P_i (P·N) dφ dz and ∬ P·N dφ dz in the model frame, the
/// normal oriented radially outward times the face sense. Each tea box corner
/// is checked on its own, so no symmetry of the part can cancel an error.
fn cone_moments_by_quadrature(p: &wonky_geom::model::RevPatch) {
    use num_traits::ToPrimitive;
    let f = |x: &wonky_geom::Q| x.to_f64().unwrap();
    let wonky_geom::model::Profile::Cone { radius, slope } = &p.profile else { unreachable!() };
    let (r0, k) = (f(radius), f(slope));
    let cols = p.frame.columns().clone().map(|c| c.map(|x| f(&x)));
    let origin = p.frame.origin().clone().map(|x| f(&x));
    let map = |l: [f64; 3]| -> [f64; 3] { std::array::from_fn(|i| (0..3).map(|j| l[j] * cols[j][i]).sum::<f64>()) };
    let shift = if p.pu == wonky_geom::model::curved::Patch::Second { std::f64::consts::PI } else { 0. };
    let [phi0, phi1] = p.u.clone().map(|t| 2. * f(&t).atan() + shift);
    let [z0, z1] = p.v.clone().map(|z| f(&z));
    // 16-point Gauss-Legendre nodes on [-1, 1] by Newton on P_16.
    let nodes: Vec<(f64, f64)> = (1..=16)
        .map(|i| {
            let n = 16usize;
            let mut x = (std::f64::consts::PI * (i as f64 - 0.25) / (n as f64 + 0.5)).cos();
            let mut dp = 0.;
            for _ in 0..100 {
                let (mut p0, mut p1) = (1., x);
                for m in 2..=n {
                    let p2 = ((2 * m - 1) as f64 * x * p1 - (m - 1) as f64 * p0) / m as f64;
                    p0 = p1;
                    p1 = p2;
                }
                dp = n as f64 * (x * p1 - p0) / (x * x - 1.);
                x -= p1 / dp;
            }
            (x, 2. / ((1. - x * x) * dp * dp))
        })
        .collect();
    let (mut flux, mut volume) = ([0.; 3], 0.);
    for &(a, wa) in &nodes {
        let phi = 0.5 * (phi0 + phi1) + 0.5 * (phi1 - phi0) * a;
        for &(b, wb) in &nodes {
            let z = 0.5 * (z0 + z1) + 0.5 * (z1 - z0) * b;
            let w = 0.25 * (phi1 - phi0) * (z1 - z0) * wa * wb;
            let rho = r0 + k * z;
            let (c, s) = (phi.cos(), phi.sin());
            let at = map([rho * c, rho * s, z]);
            let point: [f64; 3] = std::array::from_fn(|i| origin[i] + at[i]);
            let (dphi, dz, radial) = (map([-rho * s, rho * c, 0.]), map([k * c, k * s, 1.]), map([c, s, 0.]));
            let mut n = [dphi[1] * dz[2] - dphi[2] * dz[1], dphi[2] * dz[0] - dphi[0] * dz[2], dphi[0] * dz[1] - dphi[1] * dz[0]];
            let dot = |a: [f64; 3], b: [f64; 3]| a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
            let sense = if (dot(n, radial) > 0.) == p.forward { 1. } else { -1. };
            n = n.map(|x| x * sense);
            let pn = dot(point, n);
            volume += w * pn;
            for i in 0..3 {
                flux[i] += w * point[i] * pn;
            }
        }
    }
    let (exact, exact_volume) = p.moment_flux().unwrap();
    let value = |v: &wonky_geom::model::PiValue| f(&v.rational) + f(&v.pi) * std::f64::consts::PI;
    let scale = flux.iter().fold(volume.abs(), |s, x| s.max(x.abs()));
    for i in 0..3 {
        assert!((value(&exact[i]) - flux[i]).abs() <= 1e-9 * scale, "moment {i}: exact {} quadrature {}", value(&exact[i]), flux[i]);
    }
    assert!((value(&exact_volume) - volume).abs() <= 1e-9 * scale, "volume: exact {} quadrature {volume}", value(&exact_volume));
}
