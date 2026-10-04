//! boolean3d strand G4 on the CAD-Acid box zones AC10-AC17, V0-V3: the
//! general path (P0-P7) against the family (P1, `orthogonal::boolean`).
//!
//! The operands are rebuilt the way the interpreter builds them (fCuboid
//! corners `fl(fl(L) * fl(0.001))` m, one opTransform into the variant
//! frame read from a frozen acid body); the family results are the frozen
//! acid result bodies of wonky-ops/tests/data/acid-planar-wc0.txt
//! (byte-identical to an acid run), and the live family call must equal
//! them. Boxes and operations are those of fixtures/cad-acid/zones.json.
//!
//! Planted negatives: `plant_classify_side_flip` and
//! `plant_classify_cross_section` must make these tests fail with
//! `boolean/contract-violation:classify/*` (the second opinion).
use num_rational::BigRational as Q;
use std::collections::BTreeMap;
use wonky_bool::{fold, Class, Decided, Op};
use wonky_contract::{BodyKey, Frame};
use wonky_geom::model::Model;
use wonky_ops::{affine::Affine, analytic, orthogonal, polyhedron::audit, polyhedron::Audited};

struct Cell {
    zone: String,
    variant: String,
    words: Vec<u32>,
}

fn cells() -> Vec<Cell> {
    include_str!("../../wonky-ops/tests/data/acid-planar-wc0.txt")
        .lines()
        .filter(|l| !l.starts_with('#'))
        .map(|l| {
            let f: Vec<&str> = l.split_whitespace().collect();
            let words = f[5].as_bytes().chunks(8).map(|c| u32::from_str_radix(std::str::from_utf8(c).unwrap(), 16).unwrap()).collect();
            Cell { zone: f[0].into(), variant: f[1].into(), words }
        })
        .collect()
}

fn model_of(words: &[u32]) -> Model {
    let body = wonky_wire::v3::decode(words).expect("fixture body decodes");
    analytic::audit(&body).expect("fixture body audits").model().expect("a P1 body has a Model")
}

/// The zone's frame in a variant, read from its frozen result body. The
/// refusing zones (AC12, AC13, AC15) have none; they use AC10's, whose
/// linear part is theirs (acid-boolean.fs `acidFrame` only moves each
/// zone's cell origin), and the model frame and every exact decision are
/// independent of the origin.
fn variant_frame(zone: &str, variant: &str) -> Affine {
    let all = cells();
    let cell = all
        .iter()
        .find(|c| c.zone == zone && c.variant == variant)
        .or_else(|| all.iter().find(|c| c.zone == "AC10" && c.variant == variant))
        .expect("frozen cell");
    let body = wonky_wire::v3::decode(&cell.words).unwrap();
    let Frame::Interpreter { origin, x, z, .. } = &body.body().frames[1] else { panic!("interpreter frame") };
    let f = |v: &[wonky_contract::Binary64; 3]| v.map(|c| c.get());
    Affine { origin: f(origin), x: f(x), z: f(z) }
}

fn checked(body: wonky_contract::Body) -> Audited {
    audit(&wonky_wire::v3::decode(&wonky_wire::v3::encode(&body).unwrap()).unwrap()).unwrap()
}

/// An operand as the interpreter builds it (see the module documentation).
fn cuboid(frame: Affine, lo_mm: [f64; 3], hi_mm: [f64; 3]) -> Audited {
    let key = BodyKey { id: [3, 9, 4, 1], revision: 0 };
    let local = checked(orthogonal::cuboid(key, lo_mm.map(|v| v * 0.001), hi_mm.map(|v| v * 0.001)).unwrap());
    checked(orthogonal::transform(&local, frame).unwrap())
}

type Boxes = Vec<([f64; 3], [f64; 3])>;
/// (zone, operation, boxes in mm; subtraction: target first).
fn zones() -> Vec<(&'static str, Op, Boxes)> {
    let b = |lo: [f64; 3], hi: [f64; 3]| (lo, hi);
    vec![
        ("AC10", Op::Union, vec![b([0., 0., 0.], [8., 8., 8.]), b([4., 4., 4.], [12., 12., 12.])]),
        ("AC11", Op::Union, vec![b([0., 0., 0.], [8., 8., 8.]), b([8., 0., 0.], [16., 8., 8.])]),
        ("AC12", Op::Union, vec![b([0., 0., 0.], [8., 8., 8.]), b([8., 8., 0.], [16., 16., 8.]), b([8., -8., 8.], [16., 0., 16.])]),
        ("AC13", Op::Intersection, vec![b([0., 0., 0.], [8., 8., 8.]), b([8., 0., 0.], [16., 8., 8.])]),
        ("AC14", Op::Subtraction, vec![b([0., 0., 0.], [16., 8., 8.]), b([4., 0., 4.], [12., 8., 8.])]),
        ("AC15", Op::Subtraction, vec![b([0., 0., 0.], [8., 8., 8.]), b([0., 0., 0.], [8., 8., 8.])]),
        ("AC16", Op::Union, vec![b([0., 0., 0.], [8., 8., 8.]), b([0., 0., 0.], [8., 8., 8.])]),
        ("AC17", Op::Subtraction, vec![b([0., 0., 0.], [16., 16., 16.]), b([4., 4., 4.], [12., 12., 12.])]),
    ]
}

fn op_code(op: Op) -> u8 {
    match op {
        Op::Union => 0,
        Op::Subtraction => 1,
        Op::Intersection => 2,
    }
}

/// The FeatureScript category of a refusal code (`<family>/<category>`).
fn category(code: &str) -> &str {
    code.rsplit('/').next().unwrap()
}

/// Sorted canonical forms, one per body.
fn canonical(models: &[Model]) -> Vec<String> {
    let mut v: Vec<String> = models.iter().map(|m| m.canonical().to_string()).collect();
    v.sort();
    v
}

const VARIANTS: [&str; 4] = ["V0", "V1", "V2", "V3"];

/// One zone cell: (family outcome, general outcome), each canonical forms or
/// a FeatureScript category.
fn run(zone: &str, op: Op, boxes: &Boxes, variant: &str) -> (Result<Vec<String>, String>, Result<Vec<String>, String>, Option<wonky_bool::Output>) {
    let frame = variant_frame(zone, variant);
    let operands: Vec<Audited> = boxes.iter().map(|(lo, hi)| cuboid(frame, *lo, *hi)).collect();
    let key = BodyKey { id: [7, 7, 7, 7], revision: 0 };
    let family = match orthogonal::boolean(key, op_code(op), &operands) {
        Ok(bodies) => {
            let models: Vec<Model> = bodies.into_iter().map(|b| checked(b).model().unwrap()).collect();
            let frozen: Vec<Model> = cells().iter().filter(|c| c.zone == zone && c.variant == variant).map(|c| model_of(&c.words)).collect();
            assert_eq!(canonical(&models), canonical(&frozen), "{zone} {variant}: the live family call is the frozen acid body");
            Ok(canonical(&models))
        }
        Err(e) => Err(category(&e.0).to_string()),
    };
    let models: Vec<Model> = operands.iter().map(|a| a.model().unwrap()).collect();
    let refs: Vec<&Model> = models.iter().collect();
    let out = fold(op, &refs, 0);
    let general = match &out {
        Ok(o) => Ok(canonical(&o.solids().unwrap())),
        Err(e) => Err(category(e.0).to_string()),
    };
    (family, general, out.ok())
}

#[test]
fn the_general_path_equals_the_family_on_ac10_to_ac17_in_v0_to_v3() {
    let mut failures = vec![];
    let mut decided: BTreeMap<String, usize> = BTreeMap::new();
    for (zone, op, boxes) in zones() {
        for variant in VARIANTS {
            let (family, general, stats) = run(zone, op, &boxes, variant);
            for f in stats.iter().flat_map(|o| &o.fragments) {
                *decided.entry(format!("{:?}", f.decided)).or_default() += 1;
            }
            let expected = match zone {
                "AC12" => Err("non-manifold-result".to_string()),
                "AC13" | "AC15" => Err("empty-result".to_string()),
                _ => family.clone(),
            };
            assert_eq!(family, expected, "{zone} {variant}: the family outcome is the accepted one");
            if general != family {
                failures.push(format!("{zone} {variant}:\n family {family:#?}\n general {general:#?}"));
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
    // Every classification step is reached on these zones.
    for step in ["Coplanar", "Local", "Propagated", "Ray"] {
        assert!(decided.get(step).is_some_and(|&n| n > 0), "no fragment decided by {step}: {decided:?}");
    }
}

#[test]
fn ac11_merges_the_coplanar_halves_into_the_exact_family_brep() {
    // The general normalization must produce the same whole B-rep, not just
    // equal volume and plane sets. No AC11 exception in the corpus gate.
    for variant in VARIANTS {
        let (zone, op, boxes) = zones().into_iter().find(|z| z.0 == "AC11").unwrap();
        let (family, general, out) = run(zone, op, &boxes, variant);
        let out = out.unwrap_or_else(|| panic!("AC11 {variant}: {general:?}"));
        let family = family.unwrap();
        let general = general.unwrap();
        assert_eq!(family, general, "{variant}");
        let m = out.model.canonical();
        assert_eq!((m.faces.len(), m.edges.len(), m.vertices.len()), (6, 12, 8), "{variant}");
        // The same six planes, and the same exact volume.
        let family_model = model_of(&cells().iter().find(|c| c.zone == "AC11" && c.variant == variant).unwrap().words);
        let planes = |c: &wonky_geom::model::Canonical| {
            let mut p: Vec<_> = c.faces.iter().map(|f| (f.carrier.clone(), f.outward)).collect();
            p.dedup();
            p
        };
        assert_eq!(planes(&m), planes(&family_model.canonical()), "{variant}");
        assert_eq!(out.model.volume6().unwrap(), family_model.volume6().unwrap(), "{variant}");
    }
}

#[test]
fn identical_operands_follow_the_on_rules() {
    // A u A = A (AC16), A - A is empty (AC15), A n A = A: every fragment of
    // both operands is ON-same, and only A's copy is kept where kept at all.
    for variant in VARIANTS {
        let frame = variant_frame("AC16", variant);
        let a = cuboid(frame, [0., 0., 0.], [8., 8., 8.]).model().unwrap();
        for op in [Op::Union, Op::Intersection] {
            let out = fold(op, &[&a, &a], 0).unwrap_or_else(|e| panic!("{op:?} {variant}: {}", e.0));
            assert!(out.fragments.iter().all(|f| f.class == Class::OnSame), "{op:?} {variant}");
            assert_eq!(out.model.canonical(), a.canonical(), "{op:?} {variant}");
        }
        assert_eq!(fold(Op::Subtraction, &[&a, &a], 0).err().map(|e| e.0), Some("boolean/empty-result"), "{variant}");
    }
}

#[test]
fn a_cavity_is_a_second_shell_of_the_same_solid() {
    for variant in VARIANTS {
        let (zone, op, boxes) = zones().into_iter().find(|z| z.0 == "AC17").unwrap();
        let out = run(zone, op, &boxes, variant).2.unwrap();
        assert_eq!(out.assembly.solids.len(), 1, "{variant}");
        assert_eq!(out.assembly.solids[0].len(), 2, "{variant}");
        // Untouched components: A by one ray, B by one ray.
        assert!(out.fragments.iter().all(|f| f.decided == Decided::Ray || f.decided == Decided::Propagated), "{variant}");
    }
}

#[test]
fn a_sliver_left_by_two_tools_and_removed_by_the_third_is_order_independent_in_volume() {
    // Plan §6.3 item 5: A u B leaves a 1/1024 mm slot between the boxes; C
    // covers it. Every fold order gives one solid of the same exact volume
    // with exact normalization after each fold.
    let frame = variant_frame("AC10", "V0");
    let a = cuboid(frame, [0., 0., 0.], [8., 8., 8.]).model().unwrap();
    let b = cuboid(frame, [8. + 1. / 1024., 0., 0.], [16., 8., 8.]).model().unwrap();
    let c = cuboid(frame, [4., 2., 2.], [12., 6., 6.]).model().unwrap();
    let orders = [[&a, &b, &c], [&a, &c, &b], [&b, &a, &c], [&b, &c, &a], [&c, &a, &b], [&c, &b, &a]];
    let mut volumes = vec![];
    for order in orders {
        let out = fold(Op::Union, &order, 0).unwrap_or_else(|e| panic!("{}", e.0));
        assert_eq!(out.assembly.solids.len(), 1);
        volumes.push(out.model.volume6().unwrap());
    }
    assert!(volumes.windows(2).all(|w| w[0] == w[1]), "{volumes:?}");
    let two = fold(Op::Union, &[&a, &b], 0).unwrap();
    assert_eq!(two.assembly.solids.len(), 2, "A u B leaves the slot open");
    let v6 = |m: &Model| m.volume6().unwrap().into_iter().sum::<Q>();
    assert!(v6(&two.model) < v6(&fold(Op::Union, &[&a, &b, &c], 0).unwrap().model));
}
