//! Primary WC0 acceptance boundary: no geometry/solid completeness claim.
mod v3_cases;
use v3_cases::*;
use wonky_brep::{contract::*, Incidence, Rigid};
use wonky_num::v3;
use wonky_wire::{v3 as codec, *};

#[test]
fn transformed_source_incidence_survives_wire_and_json_export() {
    let mut body = source();
    let rigid = Rigid::around_axis(v3(3., -2., 5.), v3(1., 2., 3.), 0.1).unwrap();
    // Exact reported W0-GEOM repro, not an axis-aligned nearby substitute.
    move_both(&mut body, rigid);
    assert_eq!(
        body.frames[1],
        Frame::Rigid {
            parent: FrameId(0),
            translation: p(3., -2., 5.),
            axis: p(1., 2., 3.),
            angle: f(0.1),
        }
    );
    let words = codec::encode(&body).unwrap();
    let recovered = codec::decode(&words).unwrap();
    assert_eq!(
        recovered.contained(CurveId(0), SurfaceId(0)).unwrap(),
        Incidence::Contained
    );
    assert_eq!(recovered.body(), &body);
    assert_eq!(
        codec::to_json(recovered.body()).unwrap(),
        codec::to_json(&body).unwrap()
    );
}

#[test]
fn generated_all_variant_roundtrips_are_bit_exact() {
    let mut calls = 0;
    for seed in 0..128 {
        let body = generated(seed);
        let encoded = codec::encode(&body).unwrap();
        let decoded = codec::decode(&encoded).unwrap();
        calls += 1;
        // Binary64 equality compares bits, not f64 equality (-0 must survive).
        assert_eq!(decoded.body(), &body, "seed {seed}");
        assert_eq!(
            codec::encode(decoded.body()).unwrap(),
            encoded,
            "seed {seed}"
        );
        assert_eq!(
            decoded.contained(CurveId(0), SurfaceId(0)).unwrap(),
            Incidence::Contained
        );
    }
    assert_eq!(calls, 128); // successful real decoder invocations, not claims
    eprintln!("WC0: {calls}/128 generated all-variant messages decoded and re-encoded; 0 refusals");
}

#[test]
fn decoder_rejects_noncanonical_messages_and_unknown_versions() {
    let words = codec::encode(&source()).unwrap();
    assert_eq!(&words[..3], &[codec::MAGIC, 8, (words.len() - 3) as u32]);
    let mut changed = words.clone();
    changed[1] = 4;
    assert_eq!(
        codec::decode(&changed).unwrap_err(),
        codec::Error::UnknownVersion(4)
    );
    changed = words.clone();
    changed[0] = 0;
    assert!(
        matches!(codec::decode(&changed), Err(codec::Error::Wire(WireError::Malformed(s))) if s == "v3 magic")
    );
    // Decoder must reject all proper truncations, even if an attacker fixes length.
    for end in 0..words.len() {
        let mut prefix = words[..end].to_vec();
        if end >= 3 {
            prefix[2] = (end - 3) as u32;
        }
        assert!(codec::decode(&prefix).is_err(), "accepted truncation {end}");
    }
    changed = words.clone();
    changed.push(0);
    changed[2] += 1;
    assert!(
        matches!(codec::decode(&changed), Err(codec::Error::Wire(WireError::Malformed(s))) if s.contains("trailing"))
    );
    changed = words.clone();
    changed[8] = u32::MAX; // frames count after key
    assert!(
        matches!(codec::decode(&changed), Err(codec::Error::Wire(WireError::Malformed(s))) if s.contains("count"))
    );
    changed = words.clone();
    changed[9] = 99; // frame tag, never normalized to Source
    assert!(
        matches!(codec::decode(&changed), Err(codec::Error::Wire(WireError::Malformed(s))) if s.contains("Frame tag"))
    );
    // Independent protocol encoding of the sole closed [0,1] curve domain.
    let closed_unit_domain = [1, 0, 0, 1, 1, 0, 0x3ff00000, 1];
    let offsets: Vec<_> = words
        .windows(8)
        .enumerate()
        .filter_map(|(i, w)| (w == closed_unit_domain).then_some(i))
        .collect();
    assert_eq!(offsets.len(), 1);
    changed = words.clone();
    changed[offsets[0] + 3] = 2;
    assert!(
        matches!(codec::decode(&changed), Err(codec::Error::Wire(WireError::Malformed(s))) if s == "v3 bool 2")
    );
    changed = words.clone();
    let rule = changed.len() - 2;
    changed[rule] = 99;
    assert_eq!(
        codec::decode(&changed).unwrap_err(),
        codec::Error::Contract(ContractError::UnsupportedWitness(99))
    );
    for bits in [
        f64::NAN.to_bits(),
        f64::INFINITY.to_bits(),
        1,
        (1e151_f64).to_bits(),
        (1e-151_f64).to_bits(),
    ] {
        changed = words.clone();
        changed[19] = bits as u32;
        changed[20] = (bits >> 32) as u32;
        assert!(matches!(
            codec::decode(&changed),
            Err(codec::Error::Contract(ContractError::Numeric(_)))
        ));
    }
    changed = words.clone();
    changed[7] += 1; // body revision, fact still old
    assert_eq!(
        codec::decode(&changed).unwrap_err(),
        codec::Error::Contract(ContractError::Invalid("stale/foreign fact body"))
    );
    // Untrusted bit corruption must either refuse or preserve every accepted bit.
    // Both outcomes occur: source IDs can vary, but type tags cannot be repaired.
    let mut accepted = 0;
    let mut refused = 0;
    for index in 0..words.len() {
        changed = words.clone();
        changed[index] ^= 0x80000000;
        match codec::decode(&changed) {
            Ok(body) => {
                accepted += 1;
                assert_eq!(codec::encode(body.body()).unwrap(), changed);
            }
            Err(_) => refused += 1,
        }
    }
    assert!(accepted > 0 && refused > 0);
}

#[test]
fn provenance_facts_are_reproved_not_trusted_or_repaired() {
    let body = source();
    let mut b = body.clone();
    b.curves[0].provenance = Provenance::None {};
    assert_eq!(
        codec::encode(&b).unwrap_err(),
        codec::Error::Contract(ContractError::NoProvenance)
    );
    let mut b = body.clone();
    b.curves[0].geometry = CurveGeometry::Line {
        a: p(0., 0., 1.),
        b: p(1., 0., 1.),
    };
    assert_eq!(
        codec::encode(&b).unwrap_err(),
        codec::Error::Contract(ContractError::Invalid("incidence parameters changed"))
    );
    // Keep the input binding valid but claim an actual off-plane line is contained.
    b.constructions[0].parameters = p(0., 0., 1.).into_iter().chain(p(1., 0., 1.)).collect();
    assert_eq!(
        codec::encode(&b).unwrap_err(),
        codec::Error::Contract(ContractError::FalseWitness)
    );
    let mut b = body.clone();
    b.facts.push(b.facts[0].clone());
    assert_eq!(
        codec::encode(&b).unwrap_err(),
        codec::Error::Contract(ContractError::NonCanonical("duplicate fact"))
    );
    let mut b = generated(7);
    b.surfaces[0].frame = FrameId(2);
    b.surfaces[0].provenance = Provenance::Construction { node: NodeId(7) };
    // Use only the proof-bearing entities to isolate cross-frame refusal.
    b.facts.truncate(1);
    b.curves.truncate(1);
    b.curves[0].supports.clear();
    b.surfaces.truncate(1);
    b.vertices.clear();
    b.edges.clear();
    b.coedges.clear();
    b.loops.clear();
    b.faces.clear();
    b.shells.clear();
    b.solids.clear();
    b.pcurves.clear();
    assert_eq!(
        codec::encode(&b).unwrap_err(),
        codec::Error::Contract(ContractError::CrossFrameUnproved)
    );
    let mut b = body.clone();
    b.constructions[1].parents = vec![NodeId(1)];
    assert_eq!(
        codec::encode(&b).unwrap_err(),
        codec::Error::Contract(ContractError::Invalid(
            "construction cycle/forward reference"
        ))
    );
    let mut b = generated(0);
    let Fact::VertexOnEdge { parameter, .. } = &mut b.facts[1] else {
        unreachable!()
    };
    *parameter = f(0.5);
    assert_eq!(
        codec::encode(&b).unwrap_err(),
        codec::Error::Contract(ContractError::FalseWitness)
    );
    let mut b = generated(0);
    let Fact::TangentAlong { face_b, .. } = &mut b.facts[4] else {
        unreachable!()
    };
    *face_b = FaceId(0);
    assert_eq!(
        codec::encode(&b).unwrap_err(),
        codec::Error::Contract(ContractError::Invalid("noncanonical tangent face order"))
    );
    let mut b = generated(0);
    let Frame::Rigid { parent, .. } = &mut b.frames[1] else {
        unreachable!()
    };
    *parent = FrameId(1);
    assert_eq!(
        codec::encode(&b).unwrap_err(),
        codec::Error::Contract(ContractError::Invalid("frame cycle/forward reference"))
    );
}

#[test]
fn domains_references_and_composite_budget_cannot_silently_shrink() {
    let body = generated(17);
    let mut b = body.clone();
    b.budgets[0].total = estimate(3e-12);
    assert_eq!(
        codec::encode(&b).unwrap_err(),
        codec::Error::Contract(ContractError::Invalid("understated composite budget"))
    );
    let mut b = body.clone();
    b.budgets[0].maximum = f(1e-12);
    assert_eq!(
        codec::encode(&b).unwrap_err(),
        codec::Error::Contract(ContractError::WidthExceeded)
    );
    let mut b = body.clone();
    b.budgets[2].maximum = f(1e-8);
    assert_eq!(
        codec::encode(&b).unwrap_err(),
        codec::Error::Contract(ContractError::WidthExceeded)
    );
    let mut b = body.clone();
    b.budgets[3].reference_width = f(1e-12);
    assert_eq!(
        codec::encode(&b).unwrap_err(),
        codec::Error::Contract(ContractError::WidthExceeded)
    );
    let mut b = body.clone();
    b.budgets[1].construction = estimate(1e-12);
    assert_eq!(
        codec::encode(&b).unwrap_err(),
        codec::Error::Contract(ContractError::Invalid("estimate promoted by total"))
    );
    let mut b = body.clone();
    let CurveGeometry::Trace { tube, .. } = &mut b.curves.last_mut().unwrap().geometry else {
        unreachable!()
    };
    tube.segments.last_mut().unwrap().domain.upper = Limit::Finite {
        value: f(0.75),
        closed: true,
    };
    assert_eq!(
        codec::encode(&b).unwrap_err(),
        codec::Error::Contract(ContractError::Invalid("tube domain coverage"))
    );
    let mut b = body.clone();
    b.pcurves[0].surface = SurfaceId(99);
    assert!(codec::encode(&b).is_err());
    let mut b = body.clone();
    b.curves[0].domain = range(1., 0.);
    assert_eq!(
        codec::encode(&b).unwrap_err(),
        codec::Error::Contract(ContractError::Invalid("empty/reversed domain"))
    );
    let periodic: [fn(&CurveGeometry) -> bool; 2] = [
        |geometry: &CurveGeometry| {
            matches!(
                geometry,
                CurveGeometry::Circle {
                    arc: ArcKind::Trimmed {},
                    ..
                }
            )
        },
        |geometry: &CurveGeometry| {
            matches!(
                geometry,
                CurveGeometry::Ellipse {
                    arc: ArcKind::Trimmed {},
                    ..
                }
            )
        },
    ];
    for is_trimmed in periodic {
        let mut b = body.clone();
        let curve = b
            .curves
            .iter_mut()
            .find(|curve| is_trimmed(&curve.geometry))
            .unwrap();
        curve.domain = Domain {
            lower: Limit::NegativeInfinity {},
            upper: Limit::PositiveInfinity {},
        };
        assert_eq!(
            codec::encode(&b).unwrap_err(),
            codec::Error::Contract(ContractError::Invalid("trimmed arc domain"))
        );
    }
    let mut b = body.clone();
    b.constructions[0].rule_version = 9;
    assert_eq!(
        codec::encode(&b).unwrap_err(),
        codec::Error::Contract(ContractError::UnsupportedWitness(9))
    );
    // No unchecked finite endpoint can be constructed from NaN or infinity.
    for value in [
        f64::NAN,
        f64::NEG_INFINITY,
        f64::INFINITY,
        f64::from_bits(1),
    ] {
        assert!(Binary64::new(value).is_err());
    }
}

#[test]
fn trace_requires_pcurve_bindings_for_both_carriers() {
    let mut body = generated(17);
    // Carrier lookup must not depend on the order of the support list.
    body.curves.last_mut().unwrap().supports.reverse();
    let words = codec::encode(&body).unwrap();
    assert_eq!(codec::decode(&words).unwrap().body(), &body);

    for missing in [
        vec![SurfaceId(0), SurfaceId(1)],
        vec![SurfaceId(0)],
        vec![SurfaceId(1)],
    ] {
        let mut b = body.clone();
        let trace_id = CurveId(b.curves.len() as u32 - 1);
        // Remove matching pcurves too: otherwise the generic backreference
        // guard would hide the missing Trace carrier check.
        let mut pcurves = Vec::new();
        let mut supports = Vec::new();
        for pc in b.pcurves {
            if pc.curve == trace_id {
                if missing.contains(&pc.surface) {
                    continue;
                }
                supports.push(Support {
                    surface: pc.surface,
                    pcurve: PcurveId(pcurves.len() as u32),
                });
            }
            pcurves.push(pc);
        }
        b.pcurves = pcurves;
        b.curves.last_mut().unwrap().supports = supports;
        assert_eq!(
            codec::encode(&b).err(),
            Some(codec::Error::Contract(ContractError::Invalid(
                "trace missing carrier support"
            ))),
            "missing {missing:?}"
        );
    }
    // Two valid pcurve backreferences are not sufficient if they name the
    // same carrier or an unrelated surface instead of the declared second one.
    for replacement in [SurfaceId(0), SurfaceId(2)] {
        let mut b = body.clone();
        let support = b
            .curves
            .last_mut()
            .unwrap()
            .supports
            .iter_mut()
            .find(|s| s.surface == SurfaceId(1))
            .unwrap();
        support.surface = replacement;
        b.pcurves[support.pcurve.0 as usize].surface = replacement;
        assert_eq!(
            codec::encode(&b).err(),
            Some(codec::Error::Contract(ContractError::Invalid(
                "trace missing carrier support"
            )))
        );
    }
}

#[test]
fn trace_tube_requires_spatially_shared_joints() {
    let mut body = generated(17);
    let CurveGeometry::Trace { tube, .. } = &mut body.curves.last_mut().unwrap().geometry else {
        unreachable!()
    };
    // Signed zeros are geometrically equal, but the codec must retain both bits.
    tube.segments[1].start = p(0.5, -0., -0.);
    let words = codec::encode(&body).unwrap();
    assert_eq!(codec::decode(&words).unwrap().body(), &body);

    for joint in [
        p(1e100, 0., 0.),
        p(0.5, 1e100, 0.),
        p(0.5, 0., 1e100),
        // Even a one-ULP jump inside the radius is not a shared endpoint.
        p(f64::from_bits(0.5_f64.to_bits() + 1), 0., 0.),
    ] {
        let mut b = body.clone();
        let CurveGeometry::Trace { tube, .. } = &mut b.curves.last_mut().unwrap().geometry else {
            unreachable!()
        };
        tube.segments[1].start = joint;
        assert_eq!(
            codec::encode(&b).err(),
            Some(codec::Error::Contract(ContractError::Invalid(
                "tube spatial joint gap"
            ))),
            "joint {joint:?}"
        );
    }
}

#[test]
fn v2_import_is_real_legacy_payload_without_invented_provenance() {
    let p = |x, y, z| precise_Vec3 {
        x: Real::new(x),
        y: Real::new(y),
        z: Real::new(z),
    };
    let legacy = analytic_Solid {
        vertices: vec![p(0., 0., 0.), p(1., 0., 0.)],
        edges: vec![analytic_Edge {
            start: 0,
            end: 1,
            curve: analytic_Curve::Line {
                origin: p(0., 0., 0.),
                direction: p(1., 0., 0.),
            },
            same_sense: true,
        }],
        faces: vec![analytic_Face {
            surface: analytic_Surface::Plane {
                origin: p(0., 0., 0.),
                normal: p(0., 0., 1.),
                x: p(1., 0., 0.),
            },
            same_sense: true,
            loops: vec![],
        }],
    };
    let mut words = vec![];
    legacy.enc(Version::V2, &mut words).unwrap();
    let imported = codec::import_v2(&words).unwrap();
    assert_eq!(imported.solid(), &legacy);
    assert_eq!(imported.provenance(), &Provenance::None {});
    assert_eq!(
        imported.contained(CurveId(0), SurfaceId(0)).unwrap_err(),
        codec::Error::Contract(ContractError::NoProvenance)
    );
}

#[test]
fn schema_matches_current_codec_layout() {
    // Public versioned interface, not a source snapshot: schema clients must see
    // precisely the same required fields/tags as the binary-to-JSON exporter.
    assert_eq!(
        codec::json_schema().trim(),
        include_str!("../wire-v3.schema.json").trim()
    );
}

// The host transport check: canonical words pass and read as JSON; a
// noncanonical spelling (a trailing word inside the declared payload) and a
// truncated body refuse.
#[test]
fn checked_json_accepts_only_canonical_words() {
    let body = v3_cases::generated(3);
    let words = v3::encode(&body).unwrap();
    let json = v3::checked_json(&words).unwrap();
    assert!(json.starts_with("{\"magic\":\"WKV3\""));
    assert_eq!(json, v3::to_json(&body).unwrap());
    let mut longer = words.clone();
    longer.push(0);
    longer[2] += 1;
    assert!(v3::checked_json(&longer).is_err());
    assert!(v3::checked_json(&words[..words.len() - 1]).is_err());
}
