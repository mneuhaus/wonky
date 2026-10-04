//! Spline carriers end to end: audit of the exact sketch replay, tamper refusals,
//! and the generic STEP writer, on the AC100 body.
//!
//! WRITER TEST. The body is hand-assembled in `wonky-contract/tests/support/ac100.rs`
//! (an extruded cubic Bezier arch over its chord), not the result of a kernel
//! operation: no operation produces spline carriers yet. The test proves that the
//! carriers pass CheckedBody, that a cache which differs by one bit from its sketch
//! is refused, and that the STEP export is exact and readable by OCCT and FreeCAD.
//! The STEP files for those readers are written by `ac100_artifacts` (see
//! `test/rust-curve-carrier-step.test.mjs`).
#[path = "../../wonky-contract/tests/support/ac100.rs"]
mod ac100;
use ac100::*;
use wonky_contract::sketch3::{self, Entity};
use wonky_contract::*;
use wonky_ops::curve_source::{audit, Sourced};
use wonky_ops::step_carrier;

fn sourced(body: Body) -> std::result::Result<Sourced, String> {
    audit(&body.check().map_err(|e| format!("contract: {e:?}"))?).map_err(|e| e.0)
}
fn refusal(body: Body) -> String {
    sourced(body).expect_err("the tampered body must be refused")
}
fn splines(body: &mut Body, mut each: impl FnMut(&mut Vec<Binary64>, &mut Vec<Vector3>, &mut Vec<Binary64>)) {
    for i in [BASE_SPLINE, TOP_SPLINE] {
        if let CurveGeometry::BSpline { knots, controls, weights, .. } = &mut body.curves[i].geometry {
            each(knots, controls, weights);
        }
    }
}
fn bump(x: Binary64) -> Binary64 {
    b(x.get().next_up())
}

#[test]
fn ac100_passes_checked_body_and_the_audit() {
    let body = ac100();
    body.clone().check().expect("CheckedBody");
    let s = sourced(body).expect("audit");
    assert_eq!(s.body().faces.len(), 4);
    assert_eq!(s.body().curves.len(), 6);
}

#[test]
fn a_cache_that_differs_by_one_bit_from_its_sketch_is_refused() {
    // The base spline replays against the sketch node, the top one against the
    // extrusion's sketch at the cap level. Every kind of edit is caught.
    for (name, tamper) in [
        ("control x", (|_: &mut Vec<Binary64>, c: &mut Vec<Vector3>, _: &mut Vec<Binary64>| c[1][0] = bump(c[1][0])) as fn(&mut _, &mut _, &mut _)),
        ("control y", |_, c, _| c[2][1] = bump(c[2][1])),
        ("last control", |_, c, _| c[3][0] = bump(c[3][0])),
        ("weights added", |_, _, w| *w = vec![b(1.), b(1.), b(1.), b(1.)]),
    ] {
        for which in [BASE_SPLINE, TOP_SPLINE] {
            let mut body = ac100();
            if let CurveGeometry::BSpline { knots, controls, weights, .. } = &mut body.curves[which].geometry {
                tamper(knots, controls, weights);
            }
            let message = refusal(body);
            assert!(message.contains("spline-cache-mismatch") || message.contains("vertex-off-curve-end") || message.contains("pcurve-chart-mismatch"), "{name} on curve {which}: {message}");
        }
    }
}

#[test]
fn the_cache_check_itself_names_the_mismatch() {
    // Bits that only the replay can see: the vertices, pcurves and caps are
    // consistent with the tampered base spline except for its own controls.
    let mut body = ac100();
    splines(&mut body, |_, c, _| c[1][1] = bump(c[1][1]));
    for p in &mut body.pcurves {
        if let PcurveGeometry::BSpline { controls, .. } = &mut p.geometry {
            controls[1][1] = bump(controls[1][1]);
        }
    }
    let message = refusal(body);
    assert!(message.contains("curve-source/spline-cache-mismatch"), "{message}");
}

#[test]
fn a_rescaled_knot_vector_is_refused() {
    // Same curve, different parameterisation: still not what the sketch says.
    let mut body = ac100();
    splines(&mut body, |k, _, _| k.iter_mut().for_each(|x| *x = b(x.get() * 0.5)));
    for i in [BASE_SPLINE, TOP_SPLINE] {
        body.curves[i].domain = domain(0., 0.5);
        body.edges[i].domain = domain(0., 0.5);
    }
    for p in &mut body.pcurves {
        if let PcurveGeometry::BSpline { knots, .. } = &mut p.geometry {
            knots.iter_mut().for_each(|x| *x = b(x.get() * 0.5));
        }
        if p.curve.0 as usize == BASE_SPLINE || p.curve.0 as usize == TOP_SPLINE {
            p.domain = domain(0., 0.5);
        }
    }
    let message = refusal(body);
    assert!(message.contains("spline-cache-mismatch") || message.contains("pcurve-chart-mismatch"), "{message}");
}

#[test]
fn an_edge_over_part_of_a_spline_is_refused() {
    // Both spline edges run over [0, 1/2] of the clamped knot interval [0, 1],
    // while the vertices stay on the end controls (the points at 0 and 1). The
    // body is valid WC0 (a domain inside the knot span), but the vertices are
    // not the ends of these edges, and the STEP writer would export the whole
    // curve between them.
    let mut body = ac100();
    for i in [BASE_SPLINE, TOP_SPLINE] {
        body.curves[i].domain = domain(0., 0.5);
        body.edges[i].domain = domain(0., 0.5);
    }
    for p in &mut body.pcurves {
        if p.curve.0 as usize == BASE_SPLINE || p.curve.0 as usize == TOP_SPLINE {
            p.domain = domain(0., 0.5);
        }
    }
    let message = refusal(body);
    assert!(message.contains("curve-source/edge-domain-unsupported"), "{message}");
}

#[test]
fn a_decreasing_knot_is_refused_before_any_audit() {
    let mut body = ac100();
    splines(&mut body, |k, _, _| k[5] = b(0.5));
    assert_eq!(sourced(body).err().unwrap(), "contract: Invalid(\"bspline knots decrease\")");
    // and inside the sketch entity list
    let mut params = vec![0., sketch3::BSPLINE as f64, 3., 4., 0.];
    params.extend([0., 0., 0., 0., 1., 0.5, 1., 1.]);
    params.extend([0., 0., 8e-3, 6e-3, 18e-3, 6e-3, 26e-3, 0.]);
    assert!(sketch3::parse(&params).is_err());
}

#[test]
fn a_fit_spline_is_not_replayable_yet() {
    let mut body = ac100();
    let fit = Entity::Fit {
        points: vec![[0., 0.], [8e-3, 6e-3], [26e-3, 0.]],
        parameters: None,
        start: sketch3::Derivative::Free,
        end: sketch3::Derivative::Free,
        closed: false,
        end_rule: 0,
    };
    body.constructions[SKETCH_NODE].parameters =
        sketch3::encode(0, &[Entity::Bezier { controls: ARCH.to_vec() }, fit]).into_iter().map(b).collect();
    let message = refusal(body);
    assert!(message.contains("spline-fit-replay-unsupported"), "{message}");
}

#[test]
fn a_cap_that_is_not_the_swept_curve_is_refused() {
    let mut body = ac100();
    // The top spline moved 1 ulp in z: no longer base + d along the direction.
    if let CurveGeometry::BSpline { controls, .. } = &mut body.curves[TOP_SPLINE].geometry {
        controls[1][2] = bump(controls[1][2]);
    }
    assert!(refusal(body).contains("curve-source/"));
}

/// Sets the chart line of every pcurve of `edge` on the extrusion surface.
fn extrusion_chart(body: &mut Body, edge: usize, a: [f64; 2], b: [f64; 2]) {
    for p in &mut body.pcurves {
        if p.curve.0 as usize == edge && p.surface.0 as usize == EXTRUSION_SURFACE {
            p.geometry = PcurveGeometry::Line { a: v2(a), b: v2(b) };
        }
    }
}

#[test]
fn the_extrusion_chart_is_checked() {
    // The top spline replays against the sketch at its cap level, but its chart
    // line on the extrusion says v = d/2: not the swept curve at that v.
    let mut cap = ac100();
    extrusion_chart(&mut cap, TOP_SPLINE, [0., DEPTH / 2.], [1., DEPTH / 2.]);
    let message = refusal(cap);
    assert!(message.contains("curve-source/cap-not-swept-curve"), "{message}");
    // A generator whose chart ends at v = d/2 while its line ends at the top vertex.
    let mut generator = ac100();
    extrusion_chart(&mut generator, 2, [0., 0.], [0., DEPTH / 2.]);
    let message = refusal(generator);
    assert!(message.contains("curve-source/generator-not-on-surface"), "{message}");
    // A generator placed at an interior parameter of the swept curve.
    let mut interior = ac100();
    extrusion_chart(&mut interior, 2, [0.5, 0.], [0.5, DEPTH]);
    let message = refusal(interior);
    assert!(message.contains("curve-source/generator-off-curve-end"), "{message}");
}

#[test]
fn a_vertex_off_its_curve_end_is_refused() {
    let mut body = ac100();
    body.vertices[3].point[0] = bump(body.vertices[3].point[0]);
    let message = refusal(body);
    assert!(message.contains("vertex-off-curve-end"), "{message}");
}

fn ac100_step() -> String {
    let s = sourced(ac100()).unwrap();
    step_carrier::write(&[("AC100".into(), &s)], "AC100").unwrap()
}
fn count(text: &str, entity: &str) -> usize {
    text.lines().filter(|l| l.split_once('=').is_some_and(|(_, rest)| rest.trim_start().starts_with(&format!("{entity}(")))).count()
}

#[test]
fn step_carries_the_exact_carrier_types() {
    let text = ac100_step();
    assert_eq!(count(&text, "B_SPLINE_CURVE_WITH_KNOTS"), 2, "base and top spline");
    assert_eq!(count(&text, "SURFACE_OF_LINEAR_EXTRUSION"), 1);
    assert_eq!(count(&text, "PLANE"), 3);
    assert_eq!(count(&text, "MANIFOLD_SOLID_BREP"), 1);
    assert_eq!(count(&text, "ADVANCED_FACE"), 4);
    assert_eq!(count(&text, "EDGE_CURVE"), 6);
    assert_eq!(count(&text, "VERTEX_POINT"), 4);
    assert_eq!(text.matches("B_SPLINE_SURFACE_WITH_KNOTS").count(), 0, "an extrusion is never written as a spline surface");
    // Clamped cubic on [0, 1]: multiplicities (4,4), knots (0.,1.).
    assert!(text.contains(",.UNSPECIFIED.,.F.,.F.,(4,4),(0.0,1.0),.UNSPECIFIED.)"), "multiplicities and knot values");
    // Points are millimetres of the exact metre values.
    assert!(text.contains("CARTESIAN_POINT('',(8.0,6.0,0.0))"));
    assert!(text.contains("partition-of-unity"));
}

#[test]
fn the_step_export_budget_is_stated_and_small() {
    let text = ac100_step();
    let budget = declared_budget_mm(&text);
    assert!(budget > 0. && budget < 1e-9, "budget {budget}");
}

fn declared_budget_mm(text: &str) -> f64 {
    let (_, rest) = text.split_once("export budget ").expect("the description states the budget");
    rest.split_once(" mm").unwrap().0.parse().unwrap()
}

#[test]
fn rational_splines_are_not_written() {
    // The same arch as a rational B-spline with unit weights: a valid carrier the
    // audit accepts, which the writer refuses rather than guess a weighted bound.
    let mut body = ac100();
    let entity = Entity::BSpline { degree: 3, knots: KNOTS.to_vec(), controls: ARCH.to_vec(), weights: Some(vec![1.; 4]) };
    body.constructions[SKETCH_NODE].parameters =
        sketch3::encode(0, &[entity, Entity::Line { a: [WIDTH, 0.], b: [0., 0.] }]).into_iter().map(b).collect();
    splines(&mut body, |_, _, w| *w = vec![b(1.); 4]);
    for p in &mut body.pcurves {
        if let PcurveGeometry::BSpline { weights, .. } = &mut p.geometry {
            *weights = vec![b(1.); 4];
        }
    }
    let s = sourced(body).expect("a rational carrier is auditable");
    let refused = step_carrier::write(&[("AC100".into(), &s)], "AC100").unwrap_err();
    assert_eq!(refused.0, "step-carrier/rational-spline-unsupported");
}

/// Writes ac100.step and ac100.brep.json for the STEP readers (validate-step.py,
/// FreeCAD). `WONKY_S7_ARTIFACTS` names the directory; without it a temporary one
/// is used, so the test still proves the files can be written.
#[test]
fn ac100_artifacts() {
    let dir = std::env::var_os("WONKY_S7_ARTIFACTS").map(std::path::PathBuf::from).unwrap_or_else(|| std::env::temp_dir().join("wonky-s7-ac100"));
    std::fs::create_dir_all(&dir).unwrap();
    let text = ac100_step();
    let s = sourced(ac100()).unwrap();
    let body = s.body();
    let uses: Vec<String> = body
        .faces
        .iter()
        .map(|f| {
            let loops: Vec<String> = f
                .loops
                .iter()
                .map(|l| {
                    let coedges: Vec<String> = body.loops[l.0 as usize]
                        .coedges
                        .iter()
                        .map(|c| {
                            let c = &body.coedges[c.0 as usize];
                            format!("{{\"edge\":{},\"forward\":{}}}", c.edge.0, c.forward)
                        })
                        .collect();
                    format!("[{}]", coedges.join(","))
                })
                .collect();
            format!("{{\"loops\":[{}]}}", loops.join(","))
        })
        .collect();
    let list = |n: usize| (0..n).map(|i| format!("{{\"id\":{i}}}")).collect::<Vec<_>>().join(",");
    // 316.8 mm3: the arch area 79.2 mm2 (exact: integral of the Bezier) times 4 mm.
    let json = format!(
        "{{\"label\":\"AC100 hand-assembled writer test, not an operation result\",\"bodies\":[{{\"validation\":{{\"toleranceMm\":{},\"volumeMm3\":316.8}},\"faces\":[{}],\"edges\":[{}],\"vertices\":[{}]}}]}}",
        declared_budget_mm(&text),
        uses.join(","),
        list(body.edges.len()),
        list(body.vertices.len())
    );
    std::fs::write(dir.join("ac100.step"), &text).unwrap();
    std::fs::write(dir.join("ac100.brep.json"), json).unwrap();
    assert!(dir.join("ac100.step").is_file() && dir.join("ac100.brep.json").is_file());
}
