use wonky_geom::import::{
    part21::{Document, Value},
    *,
};
use wonky_geom::{model::VertexKey, Q};
const SI: &[u8] = include_bytes!("../../../fixtures/step-import/tetra-si.step");
const INCH: &[u8] = include_bytes!("../../../fixtures/step-import/tetra-inch.step");
const CAPTURE: &[u8] = include_bytes!("../../../fixtures/step-import/tetra.capture.json");
fn source(bytes: &[u8]) -> Source {
    Source {
        digest: source_digest(bytes),
        revision: None,
        instance_path: vec!["assembly".into(), "tetrahedron".into()],
    }
}
fn step(bytes: &[u8]) -> Result<ImportedModel> {
    ImportDraft::step(bytes, source(bytes), Limits::default())?.check()
}
fn capture(bytes: &[u8]) -> Result<ImportedModel> {
    ImportDraft::capture(bytes, source(bytes), Limits::default())?.check()
}
fn replace(bytes: &[u8], from: &str, to: &str) -> Vec<u8> {
    let s = std::str::from_utf8(bytes).unwrap();
    assert!(s.contains(from));
    s.replacen(from, to, 1).into_bytes()
}
fn parse_data(data: &str, limits: Limits) -> Result<Document> {
    Document::parse(format!("ISO-10303-21;HEADER;FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));ENDSEC;DATA;{data}ENDSEC;END-ISO-10303-21;").as_bytes(),limits)
}
#[test]
fn one_checked_model_for_si_inch_and_capture() {
    let si = step(SI).unwrap();
    let inch = step(INCH).unwrap();
    let cap = capture(CAPTURE).unwrap();
    assert_eq!(si.model().canonical(), inch.model().canonical());
    assert_eq!(si.model().canonical(), cap.model().canonical());
    let side = Q::new(15875.into(), 8.into());
    assert_eq!(si.model().volume6().unwrap(), vec![&side * &side * &side]);
    let d = si.model().draft();
    assert_eq!(
        (
            d.vertices.len(),
            d.edges.len(),
            d.faces.len(),
            d.shells.len(),
            d.solids.len()
        ),
        (4, 6, 4, 1, 1)
    );
    assert_eq!(si.state().unit_to_mm, Q::from_integer(1.into()));
    assert_eq!(inch.state().unit_to_mm, Q::new(127.into(), 5.into()));
    assert_eq!(cap.state().unit_to_mm, Q::from_integer(1000.into()));
    for model in [&si, &inch, &cap] {
        assert_eq!(model.state().origin, "imported");
        assert_eq!(model.state().validation, Validation::Exact);
        assert_eq!(model.state().uncertainty, Uncertainty::Unknown);
        assert!(!model.state().numeric_observations.is_empty());
        assert!(!model.state().source_entity_ids.is_empty());
        assert_eq!(
            model
                .replay(if model.state().decoder == Decoder::OnshapeCapture {
                    CAPTURE
                } else if model.state().unit_to_mm == Q::from_integer(1.into()) {
                    SI
                } else {
                    INCH
                })
                .unwrap()
                .model()
                .canonical(),
            model.model().canonical()
        );
    }
    assert_eq!(
        cap.state().source_revision.as_deref(),
        Some("owned-planar-fixture-v1")
    );
    assert!(d
        .vertices
        .iter()
        .all(|v| matches!(v.def.key().unwrap(), VertexKey::Rational(_))));
}
#[test]
fn provenance_and_digest_binding() {
    let model = step(SI).unwrap();
    assert_eq!(
        model.replay(INCH).unwrap_err().name,
        "import/source-digest-mismatch"
    );
    let mut src = source(CAPTURE);
    src.digest[0] ^= 1;
    assert_eq!(
        ImportDraft::capture(CAPTURE, src, Limits::default())
            .unwrap_err()
            .name,
        "import/source-digest-mismatch"
    );
    let mut src = source(CAPTURE);
    src.revision = Some("other-revision".into());
    assert_eq!(
        ImportDraft::capture(CAPTURE, src, Limits::default())
            .unwrap_err()
            .name,
        "import/source-revision-mismatch"
    );
    assert_eq!(
        source_digest(b"abc"),
        [
            0xba, 0x78, 0x16, 0xbf, 0x8f, 0x01, 0xcf, 0xea, 0x41, 0x41, 0x40, 0xde, 0x5d, 0xae,
            0x22, 0x23, 0xb0, 0x03, 0x61, 0xa3, 0x96, 0x17, 0x7a, 0x9c, 0xb4, 0x10, 0xff, 0x61,
            0xf2, 0x00, 0x15, 0xad
        ]
    );
}
#[test]
fn syntax_comments_strings_typed_complex_forward_references() {
    let doc=parse_data("/* #4=FAKE(); */ #2=(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.));#1=EXAMPLE('it''s \\X2\\00E400DF\\X0\\',#2,$,*,(1.,-2.5E-3,+.5),LENGTH_MEASURE(25.4),.T.);",Limits::default()).unwrap();
    assert_eq!(doc.entities.len(), 2);
    let a = doc.component(1, "EXAMPLE").unwrap();
    assert_eq!(a[0], Value::String("it's äß".into()));
    assert_eq!(a[1], Value::Ref(2));
    assert_eq!(a[2], Value::Null);
    assert_eq!(a[3], Value::Derived);
    assert_eq!(doc.component(2, "SI_UNIT").unwrap().len(), 2);
    assert_eq!(
        parse_data("#1=X(#9);", Limits::default()).unwrap_err().name,
        "import/missing-id"
    );
    assert_eq!(
        parse_data("#1=X();#1=Y();", Limits::default())
            .unwrap_err()
            .name,
        "import/duplicate-id"
    );
    assert_eq!(
        parse_data("#1=X(1E999);", Limits::default())
            .unwrap_err()
            .name,
        "import/number-range"
    );
    assert_eq!(
        parse_data("#1=X(1E-999);", Limits::default())
            .unwrap_err()
            .name,
        "import/number-range"
    );
}
#[test]
fn required_named_negatives() {
    let duplicate = replace(
        SI,
        "ENDSEC;\nEND-ISO",
        "#1=CARTESIAN_POINT('',(0.,0.,0.));\nENDSEC;\nEND-ISO",
    );
    assert_eq!(step(&duplicate).unwrap_err().name, "import/duplicate-id");
    let missing = replace(SI, "GLOBAL_UNIT_ASSIGNED_CONTEXT", "NO_UNITS_CONTEXT");
    assert_eq!(step(&missing).unwrap_err().name, "import/missing-unit");
    let mut src = source(SI);
    src.digest[31] ^= 1;
    assert_eq!(
        ImportDraft::step(SI, src, Limits::default())
            .unwrap_err()
            .name,
        "import/source-digest-mismatch"
    );
    let limits = Limits {
        entities: 5,
        ..Limits::default()
    };
    assert_eq!(
        ImportDraft::step(SI, source(SI), limits).unwrap_err().name,
        "import/graph-limit"
    );
    let limits = Limits {
        bytes: SI.len() - 1,
        ..Limits::default()
    };
    assert_eq!(
        ImportDraft::step(SI, source(SI), limits).unwrap_err().name,
        "import/size-limit"
    );
    let limits = Limits {
        depth: 3,
        ..Limits::default()
    };
    assert_eq!(
        parse_data("#1=X((((((1.))))));", limits).unwrap_err().name,
        "import/depth-limit"
    );
    let limits = Limits {
        values: 3,
        ..Limits::default()
    };
    assert_eq!(
        parse_data("#1=X((1.,2.,3.,4.));", limits).unwrap_err().name,
        "import/graph-limit"
    );
}
#[test]
fn no_geometric_or_topological_healing() {
    let wrong = replace(SI, "PLANE('',", "CYLINDRICAL_SURFACE('',");
    assert_eq!(
        step(&wrong).unwrap_err().name,
        "import/entity-unsupported:CYLINDRICAL_SURFACE"
    );
    let wrong = replace(SI, "ORIENTED_EDGE('',*,*,", "ORIENTED_EDGE('',#2,*,");
    assert_eq!(
        step(&wrong).unwrap_err().name,
        "import/oriented-edge-invalid"
    );
    let wrong = replace(SI, ",1.)", ",0.)");
    assert_eq!(step(&wrong).unwrap_err().name, "import/vector-magnitude");
    let wrong = replace(CAPTURE, "\"type\": \"line\"", "\"type\": \"circle\"");
    assert_eq!(
        capture(&wrong).unwrap_err().name,
        "import/entity-unsupported:circle"
    );
    let wrong = replace(CAPTURE, "\"orientation\": true", "\"orientation\": false");
    assert!(capture(&wrong).unwrap_err().name.starts_with("model/"));
    // Duplicate input IDs remain an error even if their positions agree.
    let wrong = replace(CAPTURE, "\"id\": \"v1\"", "\"id\": \"v0\"");
    assert_eq!(capture(&wrong).unwrap_err().name, "import/duplicate-id");
}
#[test]
fn malformed_input_is_a_refusal_not_a_panic() {
    for bytes in [SI, CAPTURE] {
        for end in (0..bytes.len()).step_by(31) {
            let cut = &bytes[..end];
            let result = if bytes == SI {
                ImportDraft::step(cut, source(cut), Limits::default())
            } else {
                ImportDraft::capture(cut, source(cut), Limits::default())
            };
            assert!(result.is_err(), "truncation {end}");
        }
    }
    assert_eq!(
        capture(b"{\"bodies\":[],\"bodies\":[]}").unwrap_err().name,
        "import/json-duplicate-key"
    );
}

#[test]
fn unit_context_and_source_uncertainty_are_not_admission_tolerances() {
    let add=replace(SI,"ENDSEC;\nEND-ISO", "#999=UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(0.001),#85,'producer assertion','');\nENDSEC;\nEND-ISO");
    let bytes = replace(
        &add,
        "GLOBAL_UNIT_ASSIGNED_CONTEXT((#85))",
        "GLOBAL_UNIT_ASSIGNED_CONTEXT((#85)) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#999))",
    );
    let model = step(&bytes).unwrap();
    assert_eq!(
        model.state().uncertainty,
        Uncertainty::Declared {
            mm: Q::from_float(0.001).unwrap()
        }
    );
    assert_eq!(
        model.model().canonical(),
        step(SI).unwrap().model().canonical()
    );
    let bad = replace(&bytes, "LENGTH_MEASURE(0.001)", "LENGTH_MEASURE(-0.001)");
    assert_eq!(step(&bad).unwrap_err().name, "import/uncertainty-invalid");
    let bad = replace(
        INCH,
        "LENGTH_MEASURE(25.4)",
        "LENGTH_MEASURE(25.40000000000001)",
    );
    assert_eq!(step(&bad).unwrap_err().name, "import/unit-conflict");
    let bad = replace(
        INCH,
        "DIMENSIONAL_EXPONENTS(1.,0.",
        "DIMENSIONAL_EXPONENTS(0.,1.",
    );
    assert_eq!(step(&bad).unwrap_err().name, "import/unit-dimension");
    let bad = replace(INCH, "LENGTH_MEASURE(25.4),#85", "LENGTH_MEASURE(25.4),#88");
    assert_eq!(step(&bad).unwrap_err().name, "import/unit-cycle");
    let bad = replace(
        INCH,
        "LENGTH_MEASURE(25.4)",
        "LENGTH_MEASURE(0E-2147483648)",
    );
    assert_eq!(step(&bad).unwrap_err().name, "import/unit-unsupported");
    // A large declared source allowance must not make an off-plane vertex exact.
    let bad = replace(
        &bytes,
        "CARTESIAN_POINT('',(0.0,0.0,0.0))",
        "CARTESIAN_POINT('',(0.0,0.0,0.125))",
    );
    assert!(step(&bad).is_err());
}

#[test]
fn captured_bounds_and_geometry_observations_are_exact_or_refused() {
    let bad = replace(
        CAPTURE,
        "\"quarterPoint\": [\n              0.49609375",
        "\"quarterPoint\": [\n              0.5",
    );
    assert_eq!(
        capture(&bad).unwrap_err().name,
        "import/line-observation-inconsistent"
    );
    let bad = replace(
        CAPTURE,
        "\"startPoint\": [\n              0.0",
        "\"startPoint\": [\n              0.125",
    );
    assert_eq!(
        capture(&bad).unwrap_err().name,
        "import/endpoint-inconsistent"
    );
    let bad = replace(CAPTURE, "\"edgeId\": \"e02\"", "\"edgeId\": \"missing\"");
    assert_eq!(capture(&bad).unwrap_err().name, "import/missing-id");
    let bad = replace(
        CAPTURE,
        "\"origin\": [\n              0.0,\n              0.0,\n              0.0",
        "\"origin\": [\n              0.0,\n              0.0,\n              0.125",
    );
    assert!(capture(&bad).unwrap_err().name.starts_with("model/"));
    let bad = replace(
        CAPTURE,
        "\"normal\": [\n              0,\n              0,\n              -7",
        "\"normal\": [\n              0,\n              0,\n              0",
    );
    assert_eq!(capture(&bad).unwrap_err().name, "import/direction-zero");
    let bad = replace(CAPTURE, "\"type\": \"outer\"", "\"type\": \"inner\"");
    assert_eq!(capture(&bad).unwrap_err().name, "import/outer-bound");
    let limits = Limits {
        entities: 5,
        ..Limits::default()
    };
    assert_eq!(
        ImportDraft::capture(CAPTURE, source(CAPTURE), limits)
            .unwrap_err()
            .name,
        "import/graph-limit"
    );
    let limits = Limits {
        depth: 3,
        ..Limits::default()
    };
    assert_eq!(
        ImportDraft::capture(CAPTURE, source(CAPTURE), limits)
            .unwrap_err()
            .name,
        "import/depth-limit"
    );
    let limits = Limits {
        depth: 65,
        ..Limits::default()
    };
    assert_eq!(
        ImportDraft::capture(CAPTURE, source(CAPTURE), limits)
            .unwrap_err()
            .name,
        "import/limits-invalid"
    );
}

#[test]
fn source_binding_agrees_with_independently_frozen_sha256() {
    for (bytes, hex) in [
        (
            SI,
            "6ab96b3253d27920c1250f3343b58b022d94a53d6843acbe7d5c52e05681a7c8",
        ),
        (
            INCH,
            "a4d4924bc1d3d39201a42350cc1ea988f0f76d897f31046ad7387aa3e96047bf",
        ),
        (
            CAPTURE,
            "74ff5699ddefb6ee7ef30c58bf996190d54a51ad7ac43d18f3396da791cf5d98",
        ),
    ] {
        let expected: Vec<u8> = hex
            .as_bytes()
            .chunks_exact(2)
            .map(|v| u8::from_str_radix(std::str::from_utf8(v).unwrap(), 16).unwrap())
            .collect();
        assert_eq!(source_digest(bytes).as_slice(), expected.as_slice());
        let mut src = source(bytes);
        src.digest.copy_from_slice(&expected);
        let draft = if bytes == CAPTURE {
            ImportDraft::capture(bytes, src, Limits::default())
        } else {
            ImportDraft::step(bytes, src, Limits::default())
        };
        assert!(draft.unwrap().check().is_ok());
    }
}

#[test]
fn escaped_strings_and_json_grammar_remain_checked() {
    let encoded = replace(
        CAPTURE,
        "owned-planar-fixture-v1",
        "\\u006fwned-planar-fixture-v1",
    );
    let model = capture(&encoded).unwrap();
    assert_eq!(
        model.state().source_revision.as_deref(),
        Some("owned-planar-fixture-v1")
    );
    assert_eq!(
        model.model().canonical(),
        capture(CAPTURE).unwrap().model().canonical()
    );
    for malformed in [
        b"{\"a\":1.e2}".as_slice(),
        b"{\"a\":01}".as_slice(),
        b"{\"a\":\"\\uD800\"}".as_slice(),
        b"{\"a\":\"\\q\"}".as_slice(),
    ] {
        assert_eq!(capture(malformed).unwrap_err().name, "import/json-syntax");
    }
    let doc = parse_data(
        "#1=X('\\X4\\0001F600\\X0\\','\\X2\\D83DDE00\\X0\\');",
        Limits::default(),
    )
    .unwrap();
    assert_eq!(
        doc.component(1, "X").unwrap(),
        &[Value::String("😀".into()), Value::String("😀".into())]
    );
    assert_eq!(
        parse_data("#1=X('\\X2\\D800\\X0\\');", Limits::default())
            .unwrap_err()
            .name,
        "import/string-escape"
    );
    assert_eq!(
        parse_data("#1=(X() X());", Limits::default())
            .unwrap_err()
            .name,
        "import/entity-invalid"
    );
}

#[test]
fn frozen_context_composite_flag_is_boolean() {
    let plain = replace(
        CAPTURE,
        "\"consumedByComposite\": null",
        "\"consumedByComposite\": false",
    );
    assert_eq!(
        capture(&plain).unwrap().model().canonical(),
        capture(CAPTURE).unwrap().model().canonical()
    );
    let consumed = replace(
        &plain,
        "\"consumedByComposite\": false",
        "\"consumedByComposite\": true",
    );
    assert_eq!(
        capture(&consumed).unwrap_err().name,
        "import/composite-unavailable"
    );
}

#[test]
fn si_prefixes_apply_exact_ratios_and_scaled_range_checks() {
    let expected = step(SI).unwrap().model().canonical();
    for (prefix, coordinate) in [
        ("$", "1.984375"),
        (".CENTI.", "198.4375"),
        (".DECI.", "19.84375"),
        (".MICRO.", "1984375."),
    ] {
        let bytes = replace(SI, ".MILLI.", prefix);
        let bytes = std::str::from_utf8(&bytes)
            .unwrap()
            .replace("1984.375", coordinate)
            .into_bytes();
        assert_eq!(step(&bytes).unwrap().model().canonical(), expected);
    }
    let bytes = replace(SI, ".MILLI.", "$");
    let bytes = replace(&bytes, "1984.375", "1.7976931348623157E308");
    assert_eq!(step(&bytes).unwrap_err().name, "import/coordinate-range");
    let bytes = replace(CAPTURE, "1.984375", "1.7976931348623157E308");
    assert_eq!(capture(&bytes).unwrap_err().name, "import/coordinate-range");
}

#[test]
fn unicode_inside_step_hex_escape_refuses_without_panicking() {
    assert_eq!(
        parse_data("#1=X('\\X2\\€€ab\\X0\\');", Limits::default())
            .unwrap_err()
            .name,
        "import/string-escape"
    );
}

#[test]
fn review_nested_references_and_independent_parser_budgets() {
    for data in ["#1=X((TYPED((#2))));", "#1=(X() Y((#2)));"] {
        assert_eq!(
            parse_data(data, Limits::default()).unwrap_err().name,
            "import/missing-id"
        );
    }
    let wide = format!(
        "#1=({});",
        (0..100).map(|i| format!("C{i}() ")).collect::<String>()
    );
    assert_eq!(
        parse_data(
            &wide,
            Limits {
                values: 30,
                ..Limits::default()
            }
        )
        .unwrap_err()
        .name,
        "import/graph-limit"
    );
    let deep = format!("#1=X({}1.{});", "(".repeat(65), ")".repeat(65));
    assert_eq!(
        parse_data(&deep, Limits::default()).unwrap_err().name,
        "import/depth-limit"
    );
}

#[test]
fn review_step_orientation_and_direction_reparameterization() {
    let original = step(SI).unwrap();
    // Reverse the loop's stored order/senses and its FACE_BOUND sense together.
    let reversed = String::from_utf8(SI.to_vec())
        .unwrap()
        .replace("#18,.T.)", "#18,.F.)")
        .replace("#28,.F.)", "#28,.T.)")
        .replace("#13,.F.)", "#13,.T.)")
        .replace("(#44,#45,#46)", "(#46,#45,#44)")
        .replace("#47,.T.)", "#47,.F.)");
    assert_eq!(
        step(reversed.as_bytes()).unwrap().model().canonical(),
        original.model().canonical()
    );
    // A positive direction rescaling and a non-unit VECTOR magnitude leave a
    // LINE carrier unchanged; this must not depend on floating normalization.
    let scaled = replace(SI, "(-1.,1.,0.)", "(-17.,17.,0.)");
    let scaled = replace(&scaled, "#24,1.)", "#24,123.)");
    assert_eq!(
        step(&scaled).unwrap().model().canonical(),
        original.model().canonical()
    );
}
