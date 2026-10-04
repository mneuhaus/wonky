//! WC0 spline carriers: `CurveGeometry::BSpline`, `SurfaceGeometry::LinearExtrusion`,
//! `PcurveGeometry::BSpline` and their validate rules. The body is the AC100
//! writer-test fixture (hand-assembled, not an operation result).
mod support {
    pub mod ac100;
}
use support::ac100::*;
use wonky_contract::*;

fn spline(body: &mut Body, curve: usize) -> (&mut u32, &mut Vec<Binary64>, &mut Vec<Vector3>, &mut Vec<Binary64>) {
    match &mut body.curves[curve].geometry {
        CurveGeometry::BSpline { degree, knots, controls, weights, .. } => (degree, knots, controls, weights),
        _ => unreachable!("fixture curve {curve} is a spline"),
    }
}
/// A named mutation of the fixture and the refusal it must produce.
type Case = (&'static str, fn(&mut Body), &'static str);
type ErrorCase = (&'static str, fn(&mut Body), ContractError);
fn refused(body: Body) -> ContractError {
    body.check().expect_err("the mutated body must be refused")
}

#[test]
fn the_fixture_is_a_valid_body() {
    ac100().check().unwrap();
}

#[test]
fn a_decreasing_knot_is_refused() {
    let mut body = ac100();
    spline(&mut body, BASE_SPLINE).1[5] = b(0.5);
    assert_eq!(refused(body), ContractError::Invalid("bspline knots decrease"));
}

#[test]
fn knot_vector_rules() {
    // (mutation of the base spline, refusal)
    let cases: [Case; 5] = [
        ("unclamped start", |x| spline(x, BASE_SPLINE).1[3] = b(0.25), "bspline not clamped"),
        ("unclamped end", |x| spline(x, BASE_SPLINE).1[4] = b(0.75), "bspline not clamped"),
        ("empty interval", |x| spline(x, BASE_SPLINE).1.iter_mut().for_each(|k| *k = b(0.)), "bspline empty knot interval"),
        ("knot count", |x| { spline(x, BASE_SPLINE).1.pop(); }, "bspline knot count"),
        ("degree", |x| *spline(x, BASE_SPLINE).0 = 0, "bspline degree"),
    ];
    for (name, mutate, expected) in cases {
        let mut body = ac100();
        mutate(&mut body);
        assert_eq!(refused(body), ContractError::Invalid(expected), "{name}");
    }
}

/// A degree 3 spline with `n` controls on curve 4 and the given knots.
fn respline(body: &mut Body, knots: &[f64]) {
    let n = knots.len() - 4;
    let (_, k, c, _) = spline(body, BASE_SPLINE);
    *k = knots.iter().copied().map(b).collect();
    *c = (0..n).map(|i| v3([i as f64 * 1e-3, 0., 0.])).collect();
}

#[test]
fn interior_knot_rules() {
    let mut ok = ac100();
    respline(&mut ok, &[0., 0., 0., 0., 0.5, 0.5, 1., 1., 1., 1.]);
    // The rest of the fixture (vertices at the spline ends) is not this test's
    // concern; only the knot rule is: the double interior knot is accepted.
    assert_ne!(ok.check().err(), Some(ContractError::Invalid("bspline interior knot multiplicity")));
    let mut four = ac100();
    respline(&mut four, &[0., 0., 0., 0., 0.5, 0.5, 0.5, 0.5, 1., 1., 1., 1.]);
    assert_eq!(refused(four), ContractError::Invalid("bspline interior knot multiplicity"));
    let mut at_end = ac100();
    respline(&mut at_end, &[0., 0., 0., 0., 0., 1., 1., 1., 1.]);
    assert_eq!(refused(at_end), ContractError::Invalid("bspline interior knot at an end"));
    let mut at_last = ac100();
    respline(&mut at_last, &[0., 0., 0., 0., 1., 1., 1., 1., 1.]);
    assert_eq!(refused(at_last), ContractError::Invalid("bspline interior knot at an end"));
}

#[test]
fn weight_and_control_counts() {
    let cases: [ErrorCase; 4] = [
        ("weight count", |x| *spline(x, BASE_SPLINE).3 = vec![b(1.); 3], ContractError::Invalid("bspline weight count")),
        ("zero weight", |x| *spline(x, BASE_SPLINE).3 = vec![b(1.), b(0.), b(1.), b(1.)], ContractError::Invalid("positive scalar")),
        ("too few controls", |x| { spline(x, BASE_SPLINE).2.pop(); }, ContractError::Invalid("bspline knot count")),
        ("too many controls", |x| spline(x, BASE_SPLINE).2.push(v3([0., 0., 0.])), ContractError::Invalid("bspline knot count")),
    ];
    for (name, mutate, expected) in cases {
        let mut body = ac100();
        mutate(&mut body);
        assert_eq!(refused(body), expected, "{name}");
    }
}

#[test]
fn extrusion_rules() {
    // A second interpreter frame: a curve there is a different surface.
    let mut other_frame = ac100();
    other_frame.frames.push(Frame::Interpreter { parent: FrameId(0), origin: v3([0., 0., 0.]), x: v3([1., 0., 0.]), z: v3([0., 0., 1.]) });
    other_frame.surfaces[EXTRUSION_SURFACE].frame = FrameId(2);
    other_frame.surfaces[EXTRUSION_SURFACE].provenance = Provenance::None {};
    assert_eq!(refused(other_frame), ContractError::Invalid("extrusion curve frame"));

    let mut zero = ac100();
    zero.surfaces[EXTRUSION_SURFACE].geometry = SurfaceGeometry::LinearExtrusion { curve: CurveId(BASE_SPLINE as u32), direction: v3([0., 0., 0.]) };
    assert_eq!(refused(zero), ContractError::Invalid("zero direction"));

    let mut line = ac100();
    line.surfaces[EXTRUSION_SURFACE].geometry = SurfaceGeometry::LinearExtrusion { curve: CurveId(0), direction: v3([0., 0., 1.]) };
    assert_eq!(refused(line), ContractError::Invalid("extrusion of a non-spline curve"));

    let mut missing = ac100();
    missing.surfaces[EXTRUSION_SURFACE].geometry = SurfaceGeometry::LinearExtrusion { curve: CurveId(99), direction: v3([0., 0., 1.]) };
    assert!(matches!(refused(missing), ContractError::Reference("extrusion curve", 99)));
}

#[test]
fn sketch_rule_3_is_checked_on_the_node() {
    let mut body = ac100();
    // A decreasing knot inside the sketch's own spline entity is refused too.
    body.constructions[SKETCH_NODE].parameters = [0., 5., 2., 3., 0., 0., 0., 1., 0.5, 1., 0., 0., 1., 1., 2., 0.].map(b).to_vec();
    assert!(body.check().is_err());
    let mut two_parents = ac100();
    two_parents.constructions[SKETCH_NODE].parents.push(NodeId(1));
    assert!(two_parents.check().is_err(), "rule 3 has exactly one parent");
    let mut none = ac100();
    none.constructions[SKETCH_NODE].parameters = vec![b(0.)];
    assert!(none.check().is_err(), "an entity list is required");
}

#[test]
fn pcurve_spline_must_match_its_curve() {
    let mut body = ac100();
    let bottom = body.pcurves.iter().position(|p| matches!(p.geometry, PcurveGeometry::BSpline { .. })).unwrap();
    if let PcurveGeometry::BSpline { knots, .. } = &mut body.pcurves[bottom].geometry {
        knots[4] = b(0.5);
        knots[5] = b(0.25);
    }
    assert_eq!(refused(body), ContractError::Invalid("bspline knots decrease"));
}

// The InterpreterImage frame (second placement of an already placed body).
fn with_interpreter_image(base: u32, x: [f64; 3], z: [f64; 3]) -> Body {
    let mut body = ac100();
    body.frames.push(Frame::InterpreterImage { base: FrameId(base), origin: v3([0.001, 0., 0.]), x: v3(x), z: v3(z) });
    body
}

#[test]
fn an_interpreter_image_frame_validates_and_refuses_by_name() {
    with_interpreter_image(0, [0.6, 0., 0.8], [-0.8, 0., 0.6]).check().unwrap();
    let last = ac100().frames.len() as u32;
    assert_eq!(
        refused(with_interpreter_image(0, [1., 0., 0.], [2., 0., 0.])),
        ContractError::Invalid("interpreter image axes parallel"),
    );
    assert_eq!(
        refused(with_interpreter_image(last, [1., 0., 0.], [0., 0., 1.])),
        ContractError::Invalid("interpreter image cycle/forward reference"),
    );
}
