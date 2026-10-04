//! Strand S9: the spline prism of the arc-profile path, built by the real
//! operation (`curve_profile::build`, and the host op `OP_CURVE_EXTRUDE`) from
//! sketch rule 3 data, then audited, measured, meshed and written to STEP.
//!
//! AC100 (fixtures/cad-acid/zones.json): the cubic Bezier arch (0,0) (8,6)
//! (18,6) (26,0) mm over its chord, extruded 4 mm (V0), and the same curve as
//! its exact degree-4 elevation (V5). The sketch data are what FeatureScript
//! delivers: binary64 metres `x * 0.001` (E9), about 1e-16 relative from the
//! decimal closed forms, so those hold to 1e-12. With integer source units the
//! same construction must reproduce the closed forms exactly.
//!
//! Planted negatives (each must make this file fail):
//! - `--features plant_curve_probe_endpoints_only`: the distance to a spline
//!   piece uses its two ends only; `probe_normal` (foot at t = 1/4) is wrong;
//! - `--features plant_mesh_skip_separation`: the mesher skips the separation
//!   constraint; the thin-feature profile then does not mesh.
//!
//! `ac100_step_artifacts` writes the STEP files and brep.json projections that
//! `test/rust-curve-profile-step.test.mjs` hands to OCCT and FreeCAD.
use wonky_contract::sketch3::{self, Entity};
use wonky_contract::{Binary64, BodyKey, CheckedBody, CurveGeometry, SurfaceGeometry};
use wonky_curve::bspline::BSpline;
use wonky_ops::{
    affine::Affine,
    curve_profile, curve_profile_mesh, host, mesh,
    polyhedron::{audit, Audited, Probe},
    step,
};

const MM: f64 = 0.001;
const V0: [[f64; 2]; 4] = [[0., 0.], [8., 6.], [18., 6.], [26., 0.]];
const V5: [[f64; 2]; 5] = [[0., 0.], [6., 4.5], [13., 6.], [20., 4.5], [26., 0.]];
const KEY: BodyKey = BodyKey { id: [9, 100, 0, 0], revision: 0 };

/// The AC100 sketch: the Bezier arch and the chord back to the start, in `unit`.
fn arch(controls: &[[f64; 2]], unit: f64) -> Vec<Entity> {
    vec![
        Entity::Bezier { controls: controls.iter().map(|p| [p[0] * unit, p[1] * unit]).collect() },
        Entity::Line { a: [26. * unit, 0.], b: [0., 0.] },
    ]
}
fn checked(entities: &[Entity], frame: Affine, depth: f64) -> CheckedBody {
    curve_profile::build(KEY, frame, entities, depth, false).expect("build").check().expect("CheckedBody")
}
fn prism(entities: &[Entity], frame: Affine, depth: f64) -> Audited {
    audit(&checked(entities, frame, depth)).expect("audit")
}
fn ac100(controls: &[[f64; 2]]) -> Audited {
    prism(&arch(controls, MM), Affine::IDENTITY, 4. * MM)
}
fn close(what: &str, got: f64, want: f64) {
    assert!((got - want).abs() <= 1e-12 * want.abs().max(1.), "{what}: {got} != {want}");
}
fn probe(a: &Audited, p: [f64; 3]) -> (f64, bool, f64) {
    match a.distance_mm(p) {
        Probe::Measured { distance_mm, inside, bound_mm } => (distance_mm, inside, bound_mm),
        Probe::Refused(r) => panic!("probe {p:?} refused: {r}"),
    }
}
fn number(json: &str, key: &str) -> f64 {
    let at = json.find(&format!("\"{key}\":")).unwrap_or_else(|| panic!("{key} missing")) + key.len() + 3;
    let rest = &json[at..];
    let end = rest.find([',', '}', ']']).unwrap();
    rest[..end].parse().unwrap()
}

/// Every closed form of AC100 on one audited variant.
fn assert_ac100(a: &Audited) {
    close("volume", a.volume_mm3().unwrap(), 1584. / 5.);
    let areas = a.face_areas_mm2().unwrap();
    // Faces: bottom cap, top cap, the chord side, the arch side (profile order).
    for (got, want) in areas.iter().zip([396. / 5., 396. / 5., 104., 112.]) {
        close("face area", *got, want);
    }
    close("area", areas.iter().sum(), 1872. / 5.);
    let (lo, hi) = a.bbox_mm(None).unwrap();
    for (got, want) in lo.into_iter().chain(hi).zip([0., 0., 0., 26., 4.5, 4.]) {
        close("bbox", got, want);
    }
    // probe_normal: 37/64 along the outward normal at t = 1/4 (its foot lies
    // inside the piece, not at an end); probe_apex: 1 above the apex;
    // probe_body: material.
    let (normal, inside, bound) = probe(a, [6.125, 3.921875, 2.]);
    assert!(!inside && bound <= 1e-12);
    close("probe_normal", normal, 37. / 64.);
    let (apex, inside, bound) = probe(a, [13., 5.5, 2.]);
    assert!(!inside && bound <= 1e-12);
    close("probe_apex", apex, 1.);
    let (body, inside, _) = probe(a, [13., 2., 2.]);
    assert!(inside && body == 0.);
    let t = a.topology();
    assert_eq!((t.bodies, t.shells, t.faces, t.edges, t.vertices, t.loops, t.genus), (1, 1, 4, 6, 4, 4, 0));
    let surfaces = &a.body.surfaces;
    assert_eq!(surfaces.iter().filter(|s| matches!(s.geometry, SurfaceGeometry::Plane { .. })).count(), 3);
    assert_eq!(surfaces.iter().filter(|s| matches!(s.geometry, SurfaceGeometry::LinearExtrusion { .. })).count(), 1);
    let splines = a.body.curves.iter().filter(|c| matches!(c.geometry, CurveGeometry::BSpline { .. })).count();
    assert_eq!(splines, 2, "one spline edge per cap, the arch is never polygonized");
    let json = host::measure_json(a, None, &[]).unwrap();
    assert!(json.contains("\"certificate\":\"CurveProfilePrism\""), "{json}");
    close("areaMm2", number(&json, "areaMm2"), 1872. / 5.);
    // The volume is the exact Green rational of the binary64 inputs, rounded once.
    assert!(number(&json, "volumeRelBound") <= 2. * f64::EPSILON, "{json}");
}

#[test]
fn ac100_v0_holds_every_closed_form() {
    assert_ac100(&ac100(&V0));
}

#[test]
fn ac100_v5_the_degree_four_elevation_holds_every_closed_form() {
    let a = ac100(&V5);
    assert_ac100(&a);
    let degrees: Vec<u32> = a
        .body
        .curves
        .iter()
        .filter_map(|c| match c.geometry {
            CurveGeometry::BSpline { degree, .. } => Some(degree),
            _ => None,
        })
        .collect();
    assert_eq!(degrees, [4, 4], "five control points are degree 4, not a cubic");
}

#[test]
fn v5_is_the_same_solid_as_v0() {
    let (a, b) = (ac100(&V0), ac100(&V5));
    close("volume", b.volume_mm3().unwrap(), a.volume_mm3().unwrap());
    for (x, y) in a.face_areas_mm2().unwrap().iter().zip(b.face_areas_mm2().unwrap()) {
        close("face area", y, *x);
    }
    for p in [[13., 5.5, 2.], [6.125, 3.921875, 2.], [2., 3., 1.], [25., 1., 3.], [13., 4.49, 5.]] {
        close("probe", probe(&b, p).0, probe(&a, p).0);
    }
}

#[test]
fn exact_inputs_give_the_exact_closed_forms() {
    // Integer source units: the Green area 396/5, the PH arc length 28 and the
    // apex 9/2 are exact rationals, so the observations are their roundings.
    for controls in [&V0[..], &V5[..]] {
        let a = prism(&arch(controls, 1.), Affine::IDENTITY, 4.);
        assert_eq!(a.volume_mm3().unwrap(), 316_800_000_000.);
        let areas = a.face_areas_mm2().unwrap();
        assert_eq!(areas[0], 79_200_000.);
        assert_eq!(areas[3], 112_000_000., "arc length exactly 28");
        let (_, hi) = a.bbox_mm(None).unwrap();
        assert_eq!(hi, [26000., 4500., 4000.]);
        assert_eq!(probe(&a, [13000., 5500., 2000.]).0, 1000.);
        assert_eq!(probe(&a, [6125., 3921.875, 2000.]).0, 578.125);
    }
}

#[test]
fn translated_and_permuted_frames_v1_and_v2() {
    let v1 = Affine { origin: [65536.25 * MM, -32768.5 * MM, 16384.125 * MM], x: [1., 0., 0.], z: [0., 0., 1.] };
    let a = prism(&arch(&V0, MM), v1, 4. * MM);
    let (lo, hi) = a.bbox_mm(None).unwrap();
    for (got, want) in lo.into_iter().chain(hi).zip([65536.25, -32768.5, 16384.125, 65562.25, -32764., 16388.125]) {
        assert!((got - want).abs() <= 1e-9, "V1 bbox {got} != {want}");
    }
    close("V1 volume", a.volume_mm3().unwrap(), 1584. / 5.);
    let v2 = Affine { origin: [0.; 3], x: [0., 0., 1.], z: [0., -1., 0.] };
    let a = prism(&arch(&V0, MM), v2, 4. * MM);
    let (lo, hi) = a.bbox_mm(None).unwrap();
    for (got, want) in lo.into_iter().chain(hi).zip([-4.5, -4., 0., 0., 0., 26.]) {
        assert!((got - want).abs() <= 1e-12, "V2 bbox {got} != {want}");
    }
    close("V2 probe_normal", probe(&a, [-3.921875, -2., 6.125]).0, 37. / 64.);
}

/// V3 of the catalog: the sketch frame rotated 0.1 rad about the line through
/// (3, -2, 5) mm along (1, 2, 3) (FeatureScript `rotationAround`), in binary64.
fn v3_frame() -> Affine {
    let n = (14f64).sqrt();
    let k = [1. / n, 2. / n, 3. / n];
    let (s, c) = (0.1f64.sin(), 0.1f64.cos());
    let rotate = |v: [f64; 3]| -> [f64; 3] {
        let kv = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
        let cross = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
        std::array::from_fn(|i| v[i] * c + cross[i] * s + k[i] * kv * (1. - c))
    };
    let p = [3. * MM, -2. * MM, 5. * MM];
    let rp = rotate(p);
    Affine { origin: std::array::from_fn(|i| p[i] - rp[i]), x: rotate([1., 0., 0.]), z: rotate([0., 0., 1.]) }
}

#[test]
fn a_binary64_rotated_frame_v3_measures_and_exports() {
    let frame = v3_frame();
    let a = prism(&arch(&V0, MM), frame, 4. * MM);
    close("V3 volume", a.volume_mm3().unwrap(), 1584. / 5.);
    close("V3 area", a.face_areas_mm2().unwrap().iter().sum(), 1872. / 5.);
    let (lo, hi) = a.bbox_mm(None).unwrap();
    let want = [-0.4169139772343202, -0.22487187413221832, -1.1361649226131483, 25.680207266150273, 5.473291406575676, 4.216307586037406];
    for (got, want) in lo.into_iter().chain(hi).zip(want) {
        assert!((got - want).abs() <= 1e-9, "V3 bbox {got} != {want}");
    }
    // probe_normal at the image of its local point.
    let local = [6.125, 3.921875, 2.];
    let y = [frame.z[1] * frame.x[2] - frame.z[2] * frame.x[1], frame.z[2] * frame.x[0] - frame.z[0] * frame.x[2], frame.z[0] * frame.x[1] - frame.z[1] * frame.x[0]];
    let world: [f64; 3] = std::array::from_fn(|i| frame.origin[i] * 1000. + frame.x[i] * local[0] + y[i] * local[1] + frame.z[i] * local[2]);
    assert!((probe(&a, world).0 - 37. / 64.).abs() <= 1e-9);
    let text = step::write(&[("AC100".into(), &a)], "AC100").expect("a near-rigid rotation is written exactly up to rounding");
    assert_eq!(count(&text, "SURFACE_OF_LINEAR_EXTRUSION"), 1);
    let m = mesh::tessellate(&checked(&arch(&V0, MM), frame, 4. * MM), 0.02).unwrap();
    mesh::check_watertight(&m).unwrap();
}

/// Arcs and splines in one chain: the chord of AC100 replaced by a three-point
/// arc through (13, -4). It builds, measures and meshes; its STEP export refuses
/// by name until the carrier writer takes circles.
#[test]
fn an_arc_and_spline_profile_measures_and_meshes_but_does_not_export_step_yet() {
    let s = |p: [f64; 2]| [p[0] * MM, p[1] * MM];
    let mut entities = arch(&V0, MM);
    entities[1] = Entity::Arc3 { start: s([26., 0.]), mid: s([13., -4.]), end: [0., 0.] };
    let a = prism(&entities, Affine::IDENTITY, 4. * MM);
    // Circular segment of chord 26 and height 4: r = 185/8, half angle asin(13/r).
    let r = 185. / 8.;
    let theta = (13f64 / r).asin();
    let segment = r * r * (2. * theta - (2. * theta).sin()) / 2.;
    assert!((a.volume_mm3().unwrap() - (396. / 5. + segment) * 4.).abs() <= 1e-9 * 500., "{}", a.volume_mm3().unwrap());
    let t = a.topology();
    assert_eq!((t.faces, t.edges, t.vertices), (4, 6, 4));
    assert_eq!(a.body.surfaces.iter().filter(|s| matches!(s.geometry, SurfaceGeometry::Cylinder { .. })).count(), 1);
    let (lo, _) = a.bbox_mm(None).unwrap();
    close("arc depth", lo[1], -4.);
    let m = mesh::tessellate(&checked(&entities, Affine::IDENTITY, 4. * MM), 0.02).unwrap();
    mesh::check_watertight(&m).unwrap();
    assert!(a.export_tolerance_mm().unwrap() > 0.);
    let refused = step::write(&[("mixed".into(), &a)], "mixed").unwrap_err();
    assert_eq!(refused.0, "curve-source/curve-kind-unsupported");
}

/// AC100's arch lies above its chord, so the counter-clockwise profile runs
/// AGAINST the spline parameter (the edge is stored reversed). Mirrored below
/// the chord it runs ALONG the parameter; the lens of both arches has one side
/// of each kind and two spline pieces sharing both ends. Both replay through
/// S7's audit, hold their exact measures and write STEP (OCCT reads the mirror
/// in test/rust-curve-profile-step.test.mjs).
fn mirrored(controls: &[[f64; 2]]) -> Vec<[f64; 2]> {
    controls.iter().map(|p| [p[0], -p[1]]).collect()
}
#[test]
fn a_profile_along_the_spline_parameter_builds_the_mirror_image() {
    let s = |c: &[[f64; 2]]| Entity::Bezier { controls: c.iter().map(|p| [p[0] * MM, p[1] * MM]).collect() };
    let mirror = arch(&mirrored(&V0), MM);
    let lens = vec![s(&V0), s(&mirrored(&V0))];
    // (entities, volume, bbox y range, extrusion faces)
    for (entities, volume, y, extrusions) in [(&mirror, 1584. / 5., [-4.5, 0.], 1), (&lens, 3168. / 5., [-4.5, 4.5], 2)] {
        let a = prism(entities, Affine::IDENTITY, 4. * MM);
        wonky_ops::curve_source::audit(&a.body.clone().check().unwrap()).expect("S7 replays the forward spline edge");
        close("volume", a.volume_mm3().unwrap(), volume);
        let (lo, hi) = a.bbox_mm(None).unwrap();
        close("bbox y", lo[1], y[0]);
        close("bbox y", hi[1], y[1]);
        let (below, inside, _) = probe(&a, [6.125, -3.921875, 2.]);
        assert!(!inside);
        close("probe_normal below", below, 37. / 64.);
        close("probe_apex below", probe(&a, [13., -5.5, 2.]).0, 1.);
        // An extrusion face is outward exactly when the counter-clockwise
        // profile runs along its spline parameter: the mirror's arch does.
        let sides: Vec<bool> = a
            .body
            .faces
            .iter()
            .filter(|f| matches!(a.body.surfaces[f.surface.0 as usize].geometry, SurfaceGeometry::LinearExtrusion { .. }))
            .map(|f| f.forward)
            .collect();
        assert_eq!(sides.len(), extrusions);
        assert_eq!(sides.iter().filter(|&&forward| forward).count(), 1, "one side runs along its parameter: {sides:?}");
        let text = step::write(&[("AC100".into(), &a)], "AC100").unwrap();
        assert_eq!(count(&text, "SURFACE_OF_LINEAR_EXTRUSION"), extrusions);
        assert_eq!(count(&text, "B_SPLINE_CURVE_WITH_KNOTS"), 2 * extrusions);
        let m = mesh::tessellate(&checked(entities, Affine::IDENTITY, 4. * MM), 0.02).unwrap();
        mesh::check_watertight(&m).unwrap();
    }
}

/// S7's carrier writer takes a plane chart only when its unit vectors are
/// exact in binary64, i.e. line sides parallel to a sketch axis. A slanted line
/// (AC100 closed by two chords through (13, -4)) builds, measures and meshes,
/// but its STEP export refuses by name until the writer takes rounded charts.
#[test]
fn a_slanted_line_side_measures_but_does_not_export_step_yet() {
    let s = |p: [f64; 2]| [p[0] * MM, p[1] * MM];
    let mut entities = arch(&V0, MM);
    entities[1] = Entity::Line { a: s([26., 0.]), b: s([13., -4.]) };
    entities.push(Entity::Line { a: s([13., -4.]), b: [0., 0.] });
    let a = prism(&entities, Affine::IDENTITY, 4. * MM);
    close("volume", a.volume_mm3().unwrap(), (396. / 5. + 52.) * 4.);
    let m = mesh::tessellate(&checked(&entities, Affine::IDENTITY, 4. * MM), 0.02).unwrap();
    mesh::check_watertight(&m).unwrap();
    let refused = step::write(&[("slanted".into(), &a)], "slanted").unwrap_err();
    assert_eq!(refused.0, "curve-source/plane-chart-not-exact");
}

#[test]
fn the_audit_replays_the_sketch_and_refuses_a_tampered_cache() {
    let body = curve_profile::build(KEY, Affine::IDENTITY, &arch(&V0, MM), 4. * MM, false).unwrap();
    // S7's spline-carrier audit accepts the operation's body as it is.
    wonky_ops::curve_source::audit(&body.clone().check().unwrap()).expect("curve_source replay");
    let mut tampered = body.clone();
    let spline = tampered.curves.iter_mut().find(|c| matches!(c.geometry, CurveGeometry::BSpline { .. })).unwrap();
    if let CurveGeometry::BSpline { controls, .. } = &mut spline.geometry {
        controls[1][1] = Binary64::new(controls[1][1].get().next_up()).unwrap();
    }
    let refused = audit(&tampered.check().unwrap()).unwrap_err();
    assert_eq!(refused.0, "curve-profile/construction-mismatch");
    // The reversed extrusion is the same solid below the sketch plane.
    let below = audit(&curve_profile::build(KEY, Affine::IDENTITY, &arch(&V0, MM), 4. * MM, true).unwrap().check().unwrap()).unwrap();
    close("reverse volume", below.volume_mm3().unwrap(), 1584. / 5.);
    let (lo, hi) = below.bbox_mm(None).unwrap();
    close("reverse bbox", lo[2], -4.);
    close("reverse bbox", hi[2], 0.);
    wonky_ops::curve_source::audit(&below.body.clone().check().unwrap()).expect("replay of the reversed prism");
}

#[test]
fn refusals_name_what_the_path_cannot_take() {
    let build = |entities: &[Entity]| curve_profile::build(KEY, Affine::IDENTITY, entities, 4. * MM, false).unwrap_err().0;
    // The S-arch crosses its chord at C(1/2) = (13, 0). The spline arm of the
    // arrangement stores the ends of spline pieces only (S6), so a crossing
    // anywhere else needs an algebraic vertex (S15).
    let s_arch = arch(&[[0., 0.], [8., -6.], [18., 6.], [26., 0.]], MM);
    assert_eq!(build(&s_arch), "curve2/crossing-needs-algebraic-vertex");
    // A bow-tie under the arch: two lines cross at (13, -2), which splits them.
    let s = |p: [f64; 2]| [p[0] * MM, p[1] * MM];
    let mut bow_tie = arch(&V0, MM);
    bow_tie[1] = Entity::Line { a: s([26., 0.]), b: s([0., -4.]) };
    bow_tie.push(Entity::Line { a: s([0., -4.]), b: s([26., -4.]) });
    bow_tie.push(Entity::Line { a: s([26., -4.]), b: [0., 0.] });
    assert_eq!(build(&bow_tie), "curve-profile/non-simple-chain");
    let lines = [Entity::Line { a: [0., 0.], b: [1., 0.] }, Entity::Line { a: [1., 0.], b: [0., 1.] }, Entity::Line { a: [0., 1.], b: [0., 0.] }];
    assert_eq!(build(&lines), "curve-profile/spline-required");
    let mut rational = arch(&V0, MM);
    rational[0] = Entity::BSpline {
        degree: 3,
        knots: vec![0., 0., 0., 0., 1., 1., 1., 1.],
        controls: V0.iter().map(|p| [p[0] * MM, p[1] * MM]).collect(),
        weights: Some(vec![1.; 4]),
    };
    assert_eq!(build(&rational), "curve-profile/rational-spline-unsupported");
    let mut fit = arch(&V0, MM);
    fit[0] = Entity::Fit {
        points: vec![[0., 0.], [13. * MM, 4.5 * MM], [26. * MM, 0.]],
        parameters: None,
        start: sketch3::Derivative::Free,
        end: sketch3::Derivative::Free,
        closed: false,
        end_rule: 0,
    };
    assert_eq!(build(&fit), "curve-profile/fit-spline-unsupported");
    let mut open = arch(&V0, MM);
    open[1] = Entity::Line { a: [26. * MM, 0.], b: [1. * MM, 0.] };
    assert_eq!(build(&open), "arc-profile/open-or-branching-chain");
    // A cubic with a loop is not a regular carrier.
    let looped = [Entity::Bezier { controls: vec![[0., 0.], [0.01, 0.01], [0., 0.01], [0.01, 0.]] }, Entity::Line { a: [0.01, 0.], b: [0., 0.] }];
    assert_eq!(build(&looped), "curve2/self-intersecting-spline");
}

/// Nonrational multi-span B-spline: the arch as a clamped quadratic with one
/// interior knot. Measures come from the exact spans; the mesh cuts at the knot.
#[test]
fn a_multi_span_bspline_profile_is_exact_too() {
    let controls = vec![[0., 0.], [5. * MM, 8. * MM], [15. * MM, 8. * MM], [20. * MM, 0.]];
    let knots = vec![0., 0., 0., 0.5, 1., 1., 1.];
    let entities = [
        Entity::BSpline { degree: 2, knots: knots.clone(), controls: controls.clone(), weights: None },
        Entity::Line { a: [20. * MM, 0.], b: [0., 0.] },
    ];
    let a = prism(&entities, Affine::IDENTITY, 2. * MM);
    // Independent route: the Green area of the exact spline (wonky-curve).
    let exact = BSpline::new(2, knots.iter().map(|&k| wonky_curve::numeric::q(k)).collect(), controls.iter().map(|&p| wonky_curve::numeric::pt(p)).collect(), None).unwrap();
    let (lo, hi) = exact.domain();
    let area = exact.area(lo, hi).unwrap();
    assert!(area.is_exact());
    use num_traits::ToPrimitive;
    let area_mm2 = (-area.lo.to_f64().unwrap()) * 1e6;
    close("volume", a.volume_mm3().unwrap(), area_mm2 * 2.);
    let m = mesh::tessellate(&checked(&entities, Affine::IDENTITY, 2. * MM), 0.02).unwrap();
    mesh::check_watertight(&m).unwrap();
}

/// Independent oracle: 2^16 points of the arch (de Casteljau in binary64, mm).
/// The least distance from `p` to them bounds the distance to the curve from
/// above (up to binary64 evaluation, far below 1e-9 mm), so a bound checked on
/// it holds for the curve.
fn dense_arch(controls: &[[f64; 2]]) -> Vec<[f64; 2]> {
    (0..=1 << 16)
        .map(|k| {
            let t = k as f64 / (1 << 16) as f64;
            let mut p: Vec<[f64; 2]> = controls.to_vec();
            while p.len() > 1 {
                p = p.windows(2).map(|w| [w[0][0] + t * (w[1][0] - w[0][0]), w[0][1] + t * (w[1][1] - w[0][1])]).collect();
            }
            p[0]
        })
        .collect()
}
fn arch_distance(dense: &[[f64; 2]], p: [f64; 3]) -> f64 {
    dense.iter().map(|c| (c[0] - p[0]).hypot(c[1] - p[1])).fold(f64::INFINITY, f64::min) + 1e-9
}

#[test]
fn stl_is_watertight_and_within_the_stated_deviation() {
    const D: f64 = 0.02;
    for controls in [&V0[..], &V5[..]] {
        let body = checked(&arch(controls, MM), Affine::IDENTITY, 4. * MM);
        let m = mesh::tessellate(&body, D).unwrap();
        mesh::check_watertight(&m).unwrap();
        // The STL writer quantizes to float32 within the other half of D and
        // rechecks watertightness and orientation on the written mesh.
        let stl = mesh::binary_stl(&[m.clone()], D).unwrap();
        assert_eq!(u32::from_le_bytes(stl[80..84].try_into().unwrap()) as usize, m.triangles.len());
        let certified = curve_profile_mesh::tessellate(&audit(&body).unwrap(), D / 2.).unwrap();
        assert_eq!(certified.mesh.vertices, m.vertices, "the STL mesh is the certified one");
        assert!(certified.deviation_mm <= D / 2.);
        // Independent check: every vertex off the chord (y > 0) lies on the arch
        // within the stated deviation, every vertex sits on a cap level, and the
        // midpoint of every arch chord is within D / 2 of the exact arch.
        let dense = dense_arch(controls);
        let mut arch_vertices = 0;
        for v in &m.vertices {
            assert!(v[2] == 0. || v[2] == 4., "cap level {v:?}");
            if v[1] > 0. {
                arch_vertices += 1;
                assert!(arch_distance(&dense, *v) <= D / 2., "vertex {v:?}");
            }
        }
        assert!(arch_vertices > 8, "the arch is sampled, not a chord");
        // The lower cap contour in cycle order: the lower profile pieces are the
        // first WC0 edges; piece i starts at WC0 vertex i, and an edge stored
        // against the profile direction is sampled from its other end.
        let pieces = m.edges.len() / 3;
        let bottom: Vec<[f64; 3]> = m.edges[..pieces]
            .iter()
            .enumerate()
            .flat_map(|(i, e)| {
                let mut ids = e.vertices.clone();
                if ids[0] != i {
                    ids.reverse();
                }
                ids.pop();
                ids.into_iter().map(|id| m.vertices[id])
            })
            .collect();
        assert_eq!(bottom.len(), m.vertices.iter().filter(|v| v[2] == 0.).count(), "every lower sample lies on the contour");
        for k in 0..bottom.len() {
            let (p, q) = (bottom[k], bottom[(k + 1) % bottom.len()]);
            if p[1] > 0. || q[1] > 0. {
                let mid = [(p[0] + q[0]) / 2., (p[1] + q[1]) / 2., 0.];
                assert!(arch_distance(&dense, mid) <= D / 2., "chord {p:?} {q:?}");
            }
        }
        // Side facets that share no vertex are far apart (the separation constraint).
        assert!(certified.separation_mm >= curve_profile_mesh::SEPARATION * (certified.deviation_mm + certified.quantization_mm));
    }
}

/// The display mesh of a spline prism (what the viewer draws): every triangle
/// is attributed to its WC0 face, the first mesh vertices are the WC0 vertices,
/// and every WC0 edge is a sampled polyline from its first to its second vertex
/// (the spline edges along the arch, the line edges straight), each segment of
/// which is a triangle edge of every face that uses the WC0 edge. V0 and V5 have
/// their spline edges stored against the profile direction, the mirror along it.
#[test]
fn a_spline_prism_displays_with_face_mapped_triangles_and_edge_samples() {
    const D: f64 = 0.02;
    let mirror = mirrored(&V0);
    for controls in [&V0[..], &V5[..], &mirror[..]] {
        let checked_body = checked(&arch(controls, MM), Affine::IDENTITY, 4. * MM);
        let b = checked_body.body();
        let m = mesh::tessellate(&checked_body, D).unwrap();
        mesh::check_watertight(&m).unwrap();
        let dense = dense_arch(controls);
        let mm = |p: [Binary64; 3]| p.map(|x| x.get() * 1000.);
        let near = |p: [f64; 3], q: [f64; 3]| p.iter().zip(&q).all(|(x, y)| (x - y).abs() <= 1e-9);

        // Vertices: the WC0 vertices come first, in order.
        assert_eq!((b.vertices.len(), b.edges.len(), b.faces.len()), (4, 6, 4));
        assert_eq!(m.brep_vertices, b.vertices.len());
        for (i, v) in b.vertices.iter().enumerate() {
            assert!(near(m.vertices[i], mm(v.point)), "WC0 vertex {i}: {:?} vs {:?}", m.vertices[i], mm(v.point));
        }

        // Faces: one id per triangle, every WC0 face present, each triangle on
        // its face's surface and facing outward.
        assert_eq!(m.faces.len(), m.triangles.len());
        let mut area = vec![0.; b.faces.len()];
        for (t, &face) in m.triangles.iter().zip(&m.faces) {
            let f = &b.faces[face as usize];
            let p = t.map(|i| m.vertices[i]);
            let u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
            let w = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
            let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
            let len = n.iter().map(|x| x * x).sum::<f64>().sqrt();
            area[face as usize] += len / 2.;
            match &b.surfaces[f.surface.0 as usize].geometry {
                SurfaceGeometry::Plane { origin, normal, .. } => {
                    let (o, nn) = (mm(*origin), normal.map(|x| x.get()));
                    for q in p {
                        let off: f64 = (0..3).map(|k| (q[k] - o[k]) * nn[k]).sum();
                        assert!(off.abs() <= 1e-9, "face {face}: {q:?} is {off} mm off its plane");
                    }
                    let facing: f64 = (0..3).map(|k| n[k] / len * nn[k]).sum::<f64>() * if f.forward { 1. } else { -1. };
                    assert!(facing > 0.999, "face {face}: triangle {p:?} does not face outward ({facing})");
                }
                SurfaceGeometry::LinearExtrusion { .. } => {
                    for q in p {
                        assert!(q[2] == 0. || q[2] == 4.);
                        assert!(arch_distance(&dense, q) <= D / 2., "face {face}: {q:?} is off the arch");
                    }
                }
                other => panic!("unexpected surface {other:?}"),
            }
        }
        for (face, a) in area.iter().enumerate() {
            assert!(*a > 1., "face {face} has no triangles ({a} mm2)");
        }
        // Each face's mesh area is its exact area within the chord deviation.
        let exact = prism(&arch(controls, MM), Affine::IDENTITY, 4. * MM).face_areas_mm2().unwrap();
        for (got, want) in area.iter().zip(exact) {
            assert!((got - want).abs() <= D * 26., "face area {got} vs {want}");
        }

        // Edges: one polyline per WC0 edge, ends on its vertices.
        assert_eq!(m.edges.len(), b.edges.len());
        for (k, (sample, edge)) in m.edges.iter().zip(&b.edges).enumerate() {
            assert!(!sample.closed);
            assert_eq!(sample.vertices.first().copied(), Some(edge.vertices[0].0 as usize), "edge {k} start");
            assert_eq!(sample.vertices.last().copied(), Some(edge.vertices[1].0 as usize), "edge {k} end");
            let points: Vec<[f64; 3]> = sample.vertices.iter().map(|&i| m.vertices[i]).collect();
            match &b.curves[edge.curve.0 as usize].geometry {
                CurveGeometry::BSpline { .. } => {
                    assert!(points.len() > 8, "spline edge {k} is sampled, not a chord ({} samples)", points.len());
                    for q in &points {
                        assert!(arch_distance(&dense, *q) <= D / 2., "edge {k}: {q:?} is off the arch");
                    }
                    let xs: Vec<f64> = points.iter().map(|q| q[0]).collect();
                    assert!(xs.windows(2).all(|w| w[0] < w[1]) || xs.windows(2).all(|w| w[0] > w[1]), "edge {k} runs along the arch");
                }
                CurveGeometry::Line { a, b } => {
                    let (a, b) = (mm(*a), mm(*b));
                    let along = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
                    for q in &points {
                        let r = [q[0] - a[0], q[1] - a[1], q[2] - a[2]];
                        let cross = [along[1] * r[2] - along[2] * r[1], along[2] * r[0] - along[0] * r[2], along[0] * r[1] - along[1] * r[0]];
                        assert!(cross.iter().all(|c| c.abs() <= 1e-9 * 26.), "edge {k}: {q:?} is off its line");
                    }
                }
                other => panic!("unexpected curve {other:?}"),
            }
            // Every segment is a triangle edge of each face that uses the edge.
            for (face, f) in b.faces.iter().enumerate() {
                let uses = f.loops.iter().any(|l| b.loops[l.0 as usize].coedges.iter().any(|c| b.coedges[c.0 as usize].edge.0 as usize == k));
                if !uses {
                    continue;
                }
                for pair in sample.vertices.windows(2) {
                    let found = m.triangles.iter().zip(&m.faces).any(|(t, &fid)| {
                        fid as usize == face && (0..3).any(|j| (t[j], t[(j + 1) % 3]) == (pair[0], pair[1]) || (t[j], t[(j + 1) % 3]) == (pair[1], pair[0]))
                    });
                    assert!(found, "edge {k}: segment {pair:?} is no triangle edge of face {face}");
                }
            }
        }
    }
}

/// An arch over a roof: the roof apex R lies 1/128 mm below the arch at the
/// parameter 11/32, i.e. midway between two samples of the first sampling.
/// Without the separation constraint the chord there passes below R and the
/// cap contour crosses itself; with it the mesher refines until side facets
/// without a common vertex are 5 deviations apart.
fn thin_feature() -> Vec<Entity> {
    let s = |p: [f64; 2]| [p[0] * MM, p[1] * MM];
    let apex = s([7.156982421875, 4.060546875 - 1. / 128.]);
    vec![
        Entity::Bezier { controls: [[0., 0.], [8., 6.], [12., 6.], [20., 0.]].map(s).to_vec() },
        Entity::Line { a: s([20., 0.]), b: apex },
        Entity::Line { a: apex, b: [0., 0.] },
    ]
}

#[test]
fn the_separation_constraint_refines_a_thin_feature() {
    const D: f64 = 0.2;
    let body = checked(&thin_feature(), Affine::IDENTITY, 1. * MM);
    let a = audit(&body).unwrap();
    let certified = curve_profile_mesh::tessellate(&a, D / 2.).expect("the thin feature meshes after refinement");
    assert!(certified.chord_budget_mm < D / 2., "the constraint refined the sampling ({})", certified.chord_budget_mm);
    assert!(certified.separation_mm >= curve_profile_mesh::SEPARATION * (certified.deviation_mm + certified.quantization_mm));
    // The exact gap between R and the arch bounds the deviation (design rule
    // deviation <= separation / 3), computed here by the spline's closest point.
    let apex = match &thin_feature()[1] { Entity::Line { b, .. } => *b, _ => unreachable!() };
    let spline = BSpline::bezier_f64(&[[0., 0.], [8. * MM, 6. * MM], [12. * MM, 6. * MM], [20. * MM, 0.]]).unwrap();
    let (lo, hi) = spline.domain();
    let gap_mm = spline.closest(lo, hi, &wonky_curve::numeric::pt(apex)).unwrap().dist2.sqrt_iv().unwrap().lo() * 1000.;
    assert!(gap_mm > 0.005 && certified.deviation_mm <= gap_mm / 3., "gap {gap_mm}, deviation {}", certified.deviation_mm);
    let m = mesh::tessellate(&body, D).expect("the host mesh path refines the same way");
    mesh::check_watertight(&m).unwrap();
    mesh::binary_stl(&[m], D).unwrap();
}

/// A slit 1e-6 mm wide below a nearly flat arch. The slit walls are side
/// facets without a common vertex, and 1e-6 mm stays below 5 (deviation +
/// quantization) at every chord budget: quantization alone is 2^-23 * 26 mm.
/// Halving the budget never moves a line, and the flat arch keeps its samples
/// far below the contour limit through all refinements. So the mesher must
/// refuse by name instead of emitting facets that can touch after float32
/// rounding. The exact solid itself still measures.
fn sub_resolution_slit() -> Vec<Entity> {
    let s = |p: [f64; 2]| [p[0] * MM, p[1] * MM];
    let (l, r) = (13. - 5e-7, 13. + 5e-7);
    vec![
        Entity::Bezier { controls: [[0., 0.], [26. / 3., 0.01], [52. / 3., 0.01], [26., 0.]].map(s).to_vec() },
        Entity::Line { a: s([26., 0.]), b: s([26., -5.]) },
        Entity::Line { a: s([26., -5.]), b: s([r, -5.]) },
        Entity::Line { a: s([r, -5.]), b: s([r, -1.]) },
        Entity::Line { a: s([r, -1.]), b: s([l, -1.]) },
        Entity::Line { a: s([l, -1.]), b: s([l, -5.]) },
        Entity::Line { a: s([l, -5.]), b: s([0., -5.]) },
        Entity::Line { a: s([0., -5.]), b: [0., 0.] },
    ]
}

#[test]
fn a_sub_resolution_slit_refuses_instead_of_touching() {
    let body = checked(&sub_resolution_slit(), Affine::IDENTITY, 1. * MM);
    let a = audit(&body).unwrap();
    // Arch: y = 3h t(1-t) over x = 26t, area 13h = 0.13; the 26 x 5 block
    // minus the 1e-6 x 4 slit; depth 1.
    close("volume", a.volume_mm3().unwrap(), 0.13 + 130. - 4e-6);
    assert_eq!(curve_profile_mesh::tessellate(&a, 0.1).unwrap_err().0, "export/stl/sub-resolution-separation");
    assert_eq!(mesh::tessellate(&body, 0.2).unwrap_err().0, "export/stl/sub-resolution-separation");
}

fn count(text: &str, entity: &str) -> usize {
    text.lines().filter(|l| l.split_once('=').is_some_and(|(_, rest)| rest.trim_start().starts_with(&format!("{entity}(")))).count()
}

#[test]
fn step_uses_the_spline_carrier_writer() {
    for controls in [&V0[..], &V5[..]] {
        let a = ac100(controls);
        let text = step::write(&[("AC100".into(), &a)], "AC100").unwrap();
        assert_eq!(count(&text, "B_SPLINE_CURVE_WITH_KNOTS"), 2);
        assert_eq!(count(&text, "SURFACE_OF_LINEAR_EXTRUSION"), 1);
        assert_eq!(count(&text, "PLANE"), 3);
        assert_eq!(count(&text, "ADVANCED_FACE"), 4);
        assert_eq!(count(&text, "EDGE_CURVE"), 6);
        assert_eq!(count(&text, "VERTEX_POINT"), 4);
        assert_eq!(text.matches("B_SPLINE_SURFACE_WITH_KNOTS").count(), 0);
        assert!(text.contains("partition-of-unity"));
        let budget: f64 = text.split_once("export budget ").unwrap().1.split_once(" mm").unwrap().0.parse().unwrap();
        assert!(budget > 0. && budget <= a.export_tolerance_mm().unwrap() && budget < 1e-9, "budget {budget}");
    }
}

// Host transport: the words S10's frontend will send.
fn words(x: f64) -> [u32; 2] {
    let bits = x.to_bits();
    [bits as u32, (bits >> 32) as u32]
}
fn extrude_request(entities: &[Entity]) -> Vec<u32> {
    let mut r = vec![host::MAGIC, host::VERSION, host::OP_CURVE_EXTRUDE, 9, 100, 0, 0, 0];
    for x in [0., 0., 0., 1., 0., 0., 0., 0., 1., 4. * MM] {
        r.extend(words(x));
    }
    r.push(0);
    let parameters = sketch3::encode(0, entities);
    r.push(parameters.len() as u32);
    for x in parameters {
        r.extend(words(x));
    }
    r
}
fn text(reply: &[u32]) -> String {
    reply[1..].iter().map(|&c| char::from_u32(c).unwrap()).collect()
}

#[test]
fn the_host_builds_measures_meshes_and_exports_a_curve_prism() {
    let reply = host::host_op(&extrude_request(&arch(&V0, MM)));
    assert_eq!(reply[0], host::STATUS_OK, "{}", text(&reply));
    let body = &reply[1..];
    let mut measure = vec![host::MAGIC, host::VERSION, host::OP_MEASURE, body.len() as u32];
    measure.extend(body);
    measure.push(0); // no map
    measure.push(1);
    for x in [6.125, 3.921875, 2.] {
        measure.extend(words(x));
    }
    let reply = host::host_op(&measure);
    assert_eq!(reply[0], host::STATUS_OK, "{}", text(&reply));
    let json = text(&reply);
    assert!(json.contains("\"certificate\":\"CurveProfilePrism\""), "{json}");
    close("volume", number(&json, "volumeMm3"), 316.8);
    close("probe_normal", number(&json, "distanceMm"), 0.578125);
    let mut stl = vec![host::MAGIC, host::VERSION, host::OP_STL];
    stl.extend(words(0.02));
    stl.extend([1, body.len() as u32]);
    stl.extend(body);
    assert_eq!(host::host_op(&stl)[0], host::STATUS_OK);
    // The viewer's mesh op: one face id per triangle, six sampled edges, four WC0 vertices.
    let mut display = vec![host::MAGIC, host::VERSION, host::OP_MESH];
    display.extend(words(0.02));
    display.extend([1, body.len() as u32]);
    display.extend(body);
    let reply = host::host_op(&display);
    assert_eq!(reply[0], host::STATUS_OK, "{}", text(&reply));
    let json = text(&reply);
    let items = |key: &str| {
        let list = json.split_once(&format!("\"{key}\":[")).unwrap().1.split_once(']').unwrap().0;
        list.split(',').filter(|s| !s.is_empty()).count()
    };
    assert!(items("faces") > 0 && items("triangles") == 3 * items("faces"), "{json}");
    assert_eq!(json.matches("\"closed\":false").count(), 6, "{json}");
    assert_eq!(number(&json, "brepVertices"), 4.);
    let mut export = vec![host::MAGIC, host::VERSION, host::OP_STEP];
    let push_text = |out: &mut Vec<u32>, s: &str| {
        out.push(s.len() as u32);
        out.extend(s.chars().map(|c| c as u32));
    };
    push_text(&mut export, "AC100");
    export.push(1);
    push_text(&mut export, "AC100");
    export.push(body.len() as u32);
    export.extend(body);
    let reply = host::host_op(&export);
    assert_eq!(reply[0], host::STATUS_OK, "{}", text(&reply));
    assert_eq!(count(&text(&reply), "SURFACE_OF_LINEAR_EXTRUSION"), 1);
    // A spline region other than 0 is not a single chain.
    let mut other = extrude_request(&arch(&V0, MM));
    let at = other.len() - 2 * sketch3::encode(0, &arch(&V0, MM)).len();
    other[at..at + 2].copy_from_slice(&words(1.));
    let reply = host::host_op(&other);
    assert_eq!((reply[0], text(&reply)), (host::STATUS_REFUSED, "curve-profile/region-unsupported".into()));
}

// The region request `skSolve` sends (strand S10): the same rule 3 parameters,
// decided by the same admission as the extrusion.
fn region_request(entities: &[Entity]) -> Vec<u32> {
    let parameters = sketch3::encode(0, entities);
    let mut r = vec![host::MAGIC, host::VERSION, host::OP_CURVE_REGION, parameters.len() as u32];
    for x in parameters {
        r.extend(words(x));
    }
    r
}

#[test]
fn the_host_region_request_admits_one_closed_chain_and_names_the_rest() {
    let reply = host::host_op(&region_request(&arch(&V0, MM)));
    assert_eq!((reply[0], text(&reply)), (host::STATUS_OK, "{\"loops\":[{}],\"openWires\":0}".into()));
    let reply = host::host_op(&region_request(&arch(&V5, MM)));
    assert_eq!(reply[0], host::STATUS_OK, "{}", text(&reply));
    // The S-arch crosses its chord at C(1/2) = (13, 0): no algebraic vertex storage (S15).
    let s_arch = arch(&[[0., 0.], [8., -6.], [18., 6.], [26., 0.]], MM);
    let reply = host::host_op(&region_request(&s_arch));
    assert_eq!((reply[0], text(&reply)), (host::STATUS_REFUSED, "curve2/crossing-needs-algebraic-vertex".into()));
    // An arch without its chord is open.
    let reply = host::host_op(&region_request(&arch(&V0, MM)[..1]));
    assert_eq!(reply[0], host::STATUS_REFUSED, "{}", text(&reply));
    // Lines alone keep the rule 1 region requests.
    let triangle = [Entity::Line { a: [0., 0.], b: [MM, 0.] }, Entity::Line { a: [MM, 0.], b: [0., MM] }, Entity::Line { a: [0., MM], b: [0., 0.] }];
    let reply = host::host_op(&region_request(&triangle));
    assert_eq!((reply[0], text(&reply)), (host::STATUS_REFUSED, "curve-profile/spline-required".into()));
    // Region 1 and a truncated entity list are not a single chain / not a request.
    let mut other = region_request(&arch(&V0, MM));
    other[4..6].copy_from_slice(&words(1.));
    let reply = host::host_op(&other);
    assert_eq!((reply[0], text(&reply)), (host::STATUS_REFUSED, "curve-profile/region-unsupported".into()));
    let mut truncated = region_request(&arch(&V0, MM));
    truncated.truncate(truncated.len() - 2);
    truncated[3] -= 1;
    assert_eq!(host::host_op(&truncated)[0], host::STATUS_MALFORMED);
}

/// STEP and brep.json projections of the operation-built AC100 V0, V5, V3 and
/// the mirrored arch for scripts/validate-step.py and FreeCAD.
/// `WONKY_S9_ARTIFACTS` names the directory; without it a temporary one is used.
#[test]
fn ac100_step_artifacts() {
    let dir = std::env::var_os("WONKY_S9_ARTIFACTS").map(std::path::PathBuf::from).unwrap_or_else(|| std::env::temp_dir().join("wonky-s9-ac100"));
    std::fs::create_dir_all(&dir).unwrap();
    let mirror = mirrored(&V0);
    for (name, controls, frame) in [
        ("ac100-v0", &V0[..], Affine::IDENTITY),
        ("ac100-v5", &V5[..], Affine::IDENTITY),
        ("ac100-v3", &V0[..], v3_frame()),
        // The profile along the spline parameter (forward edge and side face).
        ("ac100-mirror", &mirror[..], Affine::IDENTITY),
    ] {
        let a = prism(&arch(controls, MM), frame, 4. * MM);
        let text = step::write(&[("AC100".into(), &a)], "AC100").unwrap();
        let b = &a.body;
        let list = |v: &[f64]| v.iter().map(|x| format!("{x:?}")).collect::<Vec<_>>().join(",");
        let faces: Vec<String> = b
            .faces
            .iter()
            .map(|f| {
                let loops: Vec<String> = f
                    .loops
                    .iter()
                    .map(|l| {
                        let uses: Vec<String> = b.loops[l.0 as usize]
                            .coedges
                            .iter()
                            .map(|c| {
                                let c = &b.coedges[c.0 as usize];
                                format!("{{\"edge\":{},\"forward\":{}}}", c.edge.0, c.forward)
                            })
                            .collect();
                        format!("[{}]", uses.join(","))
                    })
                    .collect();
                format!("{{\"loops\":[{}]}}", loops.join(","))
            })
            .collect();
        let vertices: Vec<String> = a.world_vertices_mm().unwrap().iter().map(|v| format!("[{}]", list(v))).collect();
        let edges: Vec<String> = b.edges.iter().map(|e| format!("{{\"start\":{},\"end\":{}}}", e.vertices[0].0, e.vertices[1].0)).collect();
        let tolerance = a.export_tolerance_mm().unwrap();
        let json = format!(
            "{{\"label\":\"AC100 {name} built by curve_profile::build (strand S9)\",\"bodies\":[{{\"validation\":{{\"toleranceMm\":{tolerance:?},\"volumeMm3\":{:?}}},\"vertices\":[{}],\"edges\":[{}],\"faces\":[{}],\"referenceMeasurements\":{{\"faceAreasMm2\":[{}],\"facePerimetersMm\":[{}],\"faceTolerancesMm\":[{}]}}}}]}}",
            a.volume_mm3().unwrap(),
            vertices.join(","),
            edges.join(","),
            faces.join(","),
            list(&a.face_areas_mm2().unwrap()),
            list(&a.face_perimeters_mm().unwrap()),
            list(&vec![tolerance; b.faces.len()]),
        );
        std::fs::write(dir.join(format!("{name}.step")), &text).unwrap();
        std::fs::write(dir.join(format!("{name}.brep.json")), json).unwrap();
    }
    assert!(dir.join("ac100-mirror.step").is_file());
}

#[test]
fn placed_spline_profile_with_boss_and_bore_keeps_carrier_dispatch() {
    use wonky_ops::{analytic::{self, Solid}, cylinder::{self, Spec}};
    let audited = |body: wonky_contract::Body| analytic::audit(&body.check().unwrap()).unwrap();
    let cylinder = |radius, bottom, top| audited(cylinder::create(KEY, Spec { radius, bottom, top }).unwrap());
    let base = Solid::Planar(ac100(&V0));
    let hub = cylinder(0.0005, [0.013, 0.002, 0.004], [0.013, 0.002, 0.008]);
    let bore = cylinder(0.00025, [0.013, 0.002, 0.], [0.013, 0.002, 0.008]);
    for placements in [
        vec![],
        vec![Affine { origin: [0.017, 0.019, 0.023], ..Affine::IDENTITY }],
        vec![Affine { origin: [0.017, 0.019, 0.023], ..Affine::IDENTITY },
             Affine { origin: [0.1, 0.2, 0.3], x: [0., 0., 1.], z: [0., -1., 0.] }],
    ] {
        let mut sources = [base.clone(), hub.clone(), bore.clone()];
        for frame in placements {
            for source in &mut sources { *source = audited(source.transform(frame).unwrap()); }
        }
        let mut union = analytic::boolean(KEY, 0, &sources[..2]).unwrap();
        assert_eq!(union.len(), 1);
        let joined = audited(union.remove(0));
        let mut cut = analytic::boolean(KEY, 1, &[joined, sources[2].clone()]).unwrap();
        assert_eq!(cut.len(), 1);
        let body = cut.remove(0);
        assert!(body.curves.iter().any(|c| matches!(c.geometry, CurveGeometry::BSpline { .. })));
        let result = audited(body);
        let Solid::PrismStack(stack) = &result else { panic!("spline carriers require the shared arrangement") };
        let json = stack.measure_json(None, &[]).unwrap();
        let volume: f64 = json.split("\"volumeMm3\":").nth(1).unwrap().split([',', '}']).next().unwrap().parse().unwrap();
        close("placed spline boss and bore", volume, 316.8 + std::f64::consts::PI * (0.5f64.powi(2)*4. - 0.25f64.powi(2)*8.));
        assert!(analytic::step(&[("placed spline".into(), result)], "placed spline").unwrap().contains("SURFACE_OF_LINEAR_EXTRUSION"));
    }
}
