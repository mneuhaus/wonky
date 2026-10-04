//! boolean3d strand G4: the shadow harness (`WONKY_BOOLEAN_SHADOW=1`) on the
//! host's Boolean op, for the CAD-Acid box zones AC10-AC17 and G5 AC39-AC43/AC46 in V0-V3, built
//! through the host ops the interpreter uses (OP_CUBOID with corners
//! `fl(fl(L) * fl(0.001))` m, one OP_PLACEMENT with the variant frame read
//! from a frozen acid body, OP_BOOLEAN).
//!
//! 1. Every host reply is word-for-word the same with the shadow off and on.
//! 2. The shadow's report has one line per Boolean, and its verdict is
//!    `equal` on every cell, including the normalized coplanar AC11 union.
//!
//! Planted negatives: `plant_shadow_mutates` breaks 1; `plant_classify_side_flip`
//! (the local side test's sign flipped in wonky-bool) makes AC14 `differ`.
//!
//! The shadow reads process environment variables, so everything runs in
//! this one test, sequentially.
use wonky_contract::Frame;
use wonky_ops::host::{host_op, MAGIC, OP_BOOLEAN, OP_CUBOID, OP_PLACEMENT, STATUS_OK, VERSION};

fn floats(xs: &[f64]) -> Vec<u32> {
    xs.iter().flat_map(|x| {
        let b = x.to_bits();
        [b as u32, (b >> 32) as u32]
    }).collect()
}
fn request(op: u32, payload: Vec<u32>) -> Vec<u32> {
    [MAGIC, VERSION, op].into_iter().chain(payload).collect()
}
fn ok(reply: Vec<u32>) -> Vec<u32> {
    assert_eq!(reply[0], STATUS_OK, "host refused: {}", reply[1..].iter().filter_map(|&c| char::from_u32(c)).collect::<String>());
    reply[1..].to_vec()
}

/// The frame of a zone's frozen acid result body in a variant (AC10's for
/// the refusing zones; acid-boolean.fs moves only each zone's origin).
fn frame(zone: &str, variant: &str) -> [f64; 9] {
    let data = include_str!("data/acid-planar-wc0.txt");
    let line = |z: &str| data.lines().find(|l| !l.starts_with('#') && l.split_whitespace().take(2).eq([z, variant]));
    let line = line(zone).or_else(|| line("AC10")).expect("frozen cell");
    let hex = line.split_whitespace().nth(5).unwrap();
    let words: Vec<u32> = hex.as_bytes().chunks(8).map(|c| u32::from_str_radix(std::str::from_utf8(c).unwrap(), 16).unwrap()).collect();
    let body = wonky_wire::v3::decode(&words).unwrap();
    let Frame::Interpreter { origin, x, z, .. } = &body.body().frames[1] else { panic!("interpreter frame") };
    let g = |v: &[wonky_contract::Binary64; 3]| v.map(|c| c.get());
    let (o, x, z) = (g(origin), g(x), g(z));
    [o[0], o[1], o[2], x[0], x[1], x[2], z[0], z[1], z[2]]
}

fn operand(key: u32, lo: [f64; 3], hi: [f64; 3], frame: [f64; 9]) -> Vec<u32> {
    let mut payload = vec![key, 2, 3, 4];
    payload.extend(floats(&[lo, hi].concat().iter().map(|v| v * 0.001).collect::<Vec<_>>()));
    let local = ok(host_op(&request(OP_CUBOID, payload)));
    let mut payload = vec![local.len() as u32];
    payload.extend(local);
    payload.extend(floats(&frame));
    ok(host_op(&request(OP_PLACEMENT, payload)))
}

type Boxes = Vec<([f64; 3], [f64; 3])>;
/// (zone, operation, boxes in mm) as in fixtures/cad-acid/zones.json.
fn zones() -> Vec<(&'static str, u32, Boxes)> {
    let b = |lo: [f64; 3], hi: [f64; 3]| (lo, hi);
    vec![
        ("AC10", 0, vec![b([0., 0., 0.], [8., 8., 8.]), b([4., 4., 4.], [12., 12., 12.])]),
        ("AC11", 0, vec![b([0., 0., 0.], [8., 8., 8.]), b([8., 0., 0.], [16., 8., 8.])]),
        ("AC12", 0, vec![b([0., 0., 0.], [8., 8., 8.]), b([8., 8., 0.], [16., 16., 8.]), b([8., -8., 8.], [16., 0., 16.])]),
        ("AC13", 2, vec![b([0., 0., 0.], [8., 8., 8.]), b([8., 0., 0.], [16., 8., 8.])]),
        ("AC14", 1, vec![b([0., 0., 0.], [16., 8., 8.]), b([4., 0., 4.], [12., 8., 8.])]),
        ("AC15", 1, vec![b([0., 0., 0.], [8., 8., 8.]), b([0., 0., 0.], [8., 8., 8.])]),
        ("AC16", 0, vec![b([0., 0., 0.], [8., 8., 8.]), b([0., 0., 0.], [8., 8., 8.])]),
        ("AC17", 1, vec![b([0., 0., 0.], [16., 16., 16.]), b([4., 4., 4.], [12., 12., 12.])]),
        // G5 precision cells, frozen FeatureScript operands in millimetres.
        ("AC39", 0, vec![b([0.,0.,0.], [8.,4.,4.]), b([8.+2f64.powi(-30),0.,0.], [16.,4.,4.])]),
        ("AC40", 0, vec![b([0.,0.,0.], [8.,4.,4.]), b([8.+2f64.powi(-10),0.,0.], [16.,4.,4.])]),
        ("AC41", 2, vec![b([0.,0.,0.], [8.,4.,4.]), b([8.-2f64.powi(-30),0.,0.], [16.,4.,4.])]),
        ("AC42", 0, vec![b([0.,0.,0.], [0.1+8.2,4.,4.]), b([8.3,0.,0.], [16.,4.,4.])]),
        ("AC43", 0, vec![b([0.,0.,0.], [1.68+10.1,4.,4.]), b([11.78,0.,0.], [16.,4.,4.])]),
        ("AC46", 1, vec![b([131072.,0.,0.], [131088.,16.,4.]), b([131080.-2f64.powi(-9),4.,-1.], [131080.+2f64.powi(-9),12.,5.])]),
    ]
}

#[test]
fn the_shadow_changes_no_reply_and_agrees_on_boolean_and_g5_precision_cells() {
    let report = std::env::temp_dir().join(format!("wonky-shadow-test-{}.jsonl", std::process::id()));
    let _ = std::fs::remove_file(&report);
    let mut cells = vec![];
    for (zone, op, boxes) in zones() {
        for variant in ["V0", "V1", "V2", "V3"] {
            let f = frame(zone, variant);
            let mut payload = vec![9, 9, 9, 9, op, boxes.len() as u32];
            for (k, (lo, hi)) in boxes.iter().enumerate() {
                let words = operand(k as u32 + 1, *lo, *hi, f);
                payload.push(words.len() as u32);
                payload.extend(words);
            }
            let req = request(OP_BOOLEAN, payload);
            std::env::remove_var("WONKY_BOOLEAN_SHADOW");
            let off = host_op(&req);
            std::env::set_var("WONKY_BOOLEAN_SHADOW", "1");
            std::env::set_var("WONKY_BOOLEAN_SHADOW_REPORT", &report);
            std::env::set_var("WONKY_BOOLEAN_SHADOW_CELL", format!("{zone}/{variant}"));
            let on = host_op(&req);
            std::env::remove_var("WONKY_BOOLEAN_SHADOW");
            assert_eq!(off, on, "{zone} {variant}: the shadow changed the host reply");
            cells.push(format!("{zone}/{variant}"));
        }
    }
    let text = std::fs::read_to_string(&report).expect("the shadow wrote its report");
    let _ = std::fs::remove_file(&report);
    let lines: Vec<&str> = text.lines().collect();
    assert_eq!(lines.len(), cells.len(), "one report line per Boolean");
    let mut failures = vec![];
    for (line, cell) in lines.iter().zip(&cells) {
        assert!(line.starts_with(&format!("{{\"cell\":\"{cell}\"")), "{line}");
        let expected = "\"verdict\":\"equal\",\"diff\":\"\"}";
        if !line.contains(expected) {
            failures.push(line.to_string());
        }
    }
    assert!(failures.is_empty(), "unexpected verdicts:\n{}", failures.join("\n"));
}

#[test]
fn the_shadow_detects_a_misplaced_result_and_accepts_rebased_world_geometry() {
    use wonky_contract::BodyKey;
    use wonky_ops::{affine::Affine, analytic, orthogonal, shadow};
    let checked = |b: &wonky_contract::Body| analytic::audit(&wonky_wire::v3::decode(&wonky_wire::v3::encode(b).unwrap()).unwrap()).unwrap();
    let key = BodyKey { id: [1, 2, 3, 4], revision: 0 };
    let body = orthogonal::cuboid(key.clone(), [0., 0., 0.], [1., 2., 3.]).unwrap();
    let inputs = vec![checked(&body), checked(&body)];
    let good = analytic::boolean(key, 0, &inputs).unwrap();
    assert!(shadow::line(0, &inputs, &Ok(good.clone())).contains("\"verdict\":\"equal\""));
    let shift = Affine { origin: [10., 0., 0.], x: [1., 0., 0.], z: [0., 0., 1.] };
    let wrong = good.iter().map(|b| checked(b).transform(shift).unwrap()).collect();
    let line = shadow::line(0, &inputs, &Ok(wrong));
    assert!(line.contains("\"verdict\":\"differ\""), "{line}");
    assert!(line.contains("\"same_planes\":false"), "{line}");
    let rotation = Affine { origin: [0.; 3], x: [0., 1., 0.], z: [0., 0., 1.] };
    let wrong = good.iter().map(|b| checked(b).transform(rotation).unwrap()).collect();
    let line = shadow::line(0, &inputs, &Ok(wrong));
    assert!(line.contains("\"verdict\":\"differ\""), "{line}");
    // Shift the local box back before placing it: same world geometry,
    // genuinely different local canonical geometry and placement.
    let rebased = orthogonal::cuboid(BodyKey { id: [7, 2, 3, 4], revision: 0 }, [-10., 0., 0.], [-9., 2., 3.]).unwrap();
    let rebased = checked(&rebased).transform(shift).unwrap();
    let line = shadow::line(0, &inputs, &Ok(vec![rebased]));
    assert!(line.contains("\"verdict\":\"equal\""), "{line}");
}

#[test]
fn commutative_results_have_the_same_common_frame_canonical_form_in_either_order() {
    use wonky_contract::BodyKey;
    use wonky_ops::{affine::Affine, analytic, orthogonal, shadow};
    let key = BodyKey { id: [8, 2, 3, 4], revision: 0 };
    let checked = |b: &wonky_contract::Body| analytic::audit(&wonky_wire::v3::decode(&wonky_wire::v3::encode(b).unwrap()).unwrap()).unwrap();
    let box_body = orthogonal::cuboid(key.clone(), [0.; 3], [2.; 3]).unwrap();
    let a = checked(&box_body);
    // Same world cube, two different exact construction placements. The
    // general pipeline works in its first operand's frame; the existing
    // canonical shadow comparison rebakes BOTH outputs in a common frame.
    for frame in [
        Affine { origin: [1.; 3], x: [1.,0.,0.], z: [0.,0.,1.] },
        Affine { origin: [3.,3.,1.], x: [-1.,0.,0.], z: [0.,0.,1.] },
    ] {
        let b = checked(&checked(&box_body).transform(frame).unwrap());
        for op in [0,2] {
            let reference = analytic::boolean(key.clone(), op, &[a.clone(),b.clone()]).unwrap();
            for inputs in [vec![a.clone(),b.clone()],vec![b.clone(),a.clone()]] {
                let line = shadow::line(op, &inputs, &Ok(reference.clone()));
                assert!(line.contains("\"verdict\":\"equal\""), "{line}");
            }
        }
    }
}
