//! Wire v3 (schema 8) tags of the spline carriers, on the AC100 writer-test
//! fixture (a hand-assembled body, not an operation result).
#[path = "../../wonky-contract/tests/support/ac100.rs"]
mod ac100;
use ac100::*;
use wonky_contract::*;
use wonky_wire::v3 as codec;

#[test]
fn schema_version_is_8() {
    assert_eq!(codec::SCHEMA_VERSION, 8);
    let words = codec::encode(&ac100()).unwrap();
    assert_eq!(words[1], 8);
    assert!(codec::to_json(&ac100()).unwrap().contains("\"schemaVersion\":8"));
    assert!(codec::json_schema().contains("\"schemaVersion\":{\"const\":8}"));
    // Revision 7 without the new frame remains losslessly readable.
    // Revision 6 is still refused, never reinterpreted.
    let mut previous = words;
    previous[1] = 7;
    assert_eq!(codec::decode(&previous).unwrap().body().frames, ac100().frames);
    previous[1] = 6;
    assert_eq!(codec::decode(&previous).unwrap_err(), codec::Error::UnknownVersion(6));
}

#[test]
fn spline_carriers_round_trip_bit_exactly() {
    let body = ac100();
    let words = codec::encode(&body).unwrap();
    let decoded = codec::decode(&words).unwrap();
    assert_eq!(decoded.body(), &body);
    assert_eq!(codec::encode(decoded.body()).unwrap(), words, "canonical");
    assert!(codec::checked_json(&words).is_ok());
}

#[test]
fn json_names_the_new_variants() {
    let json = codec::to_json(&ac100()).unwrap();
    for name in ["\"kind\":\"BSpline\"", "\"kind\":\"LinearExtrusion\""] {
        assert!(json.contains(name), "{name}");
    }
}

/// Word positions of `pattern` in the stream.
fn positions(words: &[u32], pattern: &[u32]) -> Vec<usize> {
    (0..=words.len() - pattern.len()).filter(|&i| words[i..i + pattern.len()] == *pattern).collect()
}
/// binary64 1.0 as its two words (low, high).
const ONE: [u32; 2] = [0, 0x3ff0_0000];
/// The head of an AC100 spline carrier under `tag`: degree 3, 8 knots, the
/// first four 0.0 (two zero words each) and the fifth 1.0.
fn spline_head(tag: u32) -> Vec<u32> {
    let mut head = vec![tag, 3, 8];
    head.extend([0; 8]);
    head.extend(ONE);
    head
}

#[test]
fn frozen_tags() {
    // Frozen: curve BSpline 10, surface LinearExtrusion 7, pcurve BSpline 8. The
    // schema lists the kinds and the word stream carries the tags in field order.
    let schema = codec::json_schema();
    for kind in ["BSpline", "LinearExtrusion"] {
        assert!(schema.contains(&format!("\"const\":\"{kind}\"")), "{kind}");
    }
    let words = codec::encode(&ac100()).unwrap();
    // tag then its first field: extrusion (curve id), curve and pcurve spline (degree 3).
    for (what, pair) in [("LinearExtrusion 7", [7, BASE_SPLINE as u32]), ("curve BSpline 10", [10, 3]), ("pcurve BSpline 8", [8, 3])] {
        assert!(words.windows(2).any(|w| w == pair), "{what}");
    }
    // The pairs above also occur by coincidence (a pcurve id 8 next to a 3), so
    // pin the full heads: the two spline curves, the two spline pcurves on the
    // cap planes, and the extrusion of curve 4 along (0, 0, 1).
    let mut extrusion = vec![7, BASE_SPLINE as u32, 0, 0, 0, 0];
    extrusion.extend(ONE);
    assert_eq!(positions(&words, &spline_head(10)).len(), 2, "curve BSpline 10");
    assert_eq!(positions(&words, &spline_head(8)).len(), 2, "pcurve BSpline 8");
    assert_eq!(positions(&words, &extrusion).len(), 1, "LinearExtrusion 7");
}

#[test]
fn a_decreasing_knot_never_reaches_the_wire() {
    let mut body = ac100();
    if let CurveGeometry::BSpline { knots, .. } = &mut body.curves[BASE_SPLINE].geometry {
        knots[5] = b(0.5);
    }
    assert!(matches!(codec::encode(&body), Err(codec::Error::Contract(ContractError::Invalid("bspline knots decrease")))));
}

#[test]
fn truncated_and_unknown_tags_are_malformed() {
    let words = codec::encode(&ac100()).unwrap();
    for cut in [3, words.len() / 2, words.len() - 1] {
        assert!(codec::decode(&words[..cut]).is_err(), "cut at {cut}");
    }
    // A spline curve or pcurve whose tag is replaced by an unused one (11) is
    // malformed, never read as another carrier.
    let tags = [positions(&words, &spline_head(10)), positions(&words, &spline_head(8))].concat();
    assert_eq!(tags.len(), 4, "two spline curves and two spline pcurves");
    for i in tags {
        let mut changed = words.clone();
        changed[i] = 11;
        let decoded = codec::decode(&changed);
        assert!(matches!(decoded, Err(codec::Error::Wire(_))), "tag at word {i}: {decoded:?}");
    }
}

#[test]
fn interpreter_image_frames_round_trip_bit_exactly() {
    let mut body = ac100();
    body.frames.push(Frame::InterpreterImage {
        base: FrameId(0),
        origin: v3([0.0021, -0.0134, 0.0005]),
        x: v3([0.6, 0., 0.8]),
        z: v3([-0.8, 0., 0.6]),
    });
    let words = codec::encode(&body).unwrap();
    let decoded = codec::decode(&words).unwrap();
    assert_eq!(decoded.body(), &body);
    assert_eq!(codec::encode(decoded.body()).unwrap(), words, "canonical");
    assert!(codec::to_json(&body).unwrap().contains("\"kind\":\"InterpreterImage\""));
}

#[test]
fn rational_image_transport_preserves_numerators_and_rejects_bad_denominators() {
    let mut body = ac100();
    body.frames.push(Frame::RationalImage {
        base: FrameId(0), rows: [v3([4.,-3.,0.]),v3([3.,4.,0.]),v3([0.,0.,5.])], denominator: b(5.),
    });
    let words = codec::encode(&body).unwrap();
    let decoded = codec::decode(&words).unwrap();
    assert_eq!(decoded.body().frames.last(),body.frames.last());
    assert_eq!(codec::encode(decoded.body()).unwrap(),words);
    assert!(codec::to_json(&body).unwrap().contains("\"kind\":\"RationalImage\""));
    let mut old_envelope = words; old_envelope[1] = 7;
    assert_eq!(codec::decode(&old_envelope).unwrap_err(), codec::Error::UnknownVersion(7));
    for d in [0.,-1.] {
        if let Some(Frame::RationalImage { denominator, .. })=body.frames.last_mut() { *denominator=b(d); }
        assert!(matches!(codec::encode(&body),Err(codec::Error::Contract(_))));
    }
}
