//! boolean3d strand G2 on CAD-Acid: the relation table reproduces the E9
//! symbols of AC39-AC43 in V0-V3 through the G1 adapters.
//!
//! The E9 symbols are read from fixtures/cad-acid/zones.json (`e9[0]`: the
//! relation and, where it is not a contact, the exact gap in mm). The model
//! frame of these bodies is the zone's construction frame in metres, so the
//! facing planes (A's +x face, B's -x face) must be
//!
//! * AC39, AC40, AC42 (UNION with a real gap): parallel-disjoint, opposite
//!   normals, B beyond A, squared distance `(symbol / 1000)^2`;
//! * AC41 (INTERSECTION with a real overlap): parallel-disjoint, B's face
//!   behind A's, the same squared distance;
//! * AC43 (the rounded sum equals the shared boundary): opposite, i.e. contact.
//!
//! Operands: AC39, AC40 and AC42 leave both operands unchanged, so their
//! frozen acid result bodies (tests/data/acid-planar-wc0.txt of wonky-ops,
//! byte-identical to an acid run) are used as they are. AC41 and AC43 merge
//! their operands, so the operands are rebuilt the way the interpreter builds
//! them (fCuboid corners `fl(fl(L) * fl(0.001))` m, one opTransform with the
//! variant frame read from the frozen body); the rebuild is bound to the acid
//! run by equality with the frozen bodies of AC39/AC40/AC42 and by the result
//! planes of AC41/AC43.
//!
//! Strand G3: AC41's 2^-30 mm overlap splits every side face of both
//! operands into a body part and a sliver, each with a strict witness.
//!
//! Planted negative `plant_relation_world_cache`: the table decides on world
//! caches; AC42's 1.7e-15 mm gap then merges into a contact and this fails.
use num_rational::BigRational as Q;
use num_traits::Zero;
use std::str::FromStr;
use wonky_bool::{intersect, Intersection, Lineage, PlaneRelation, Proof};
use wonky_contract::{BodyKey, Frame};
use wonky_geom::model::{Carrier3, CarrierKey, Model, SurfaceId};
use wonky_ops::{affine::Affine, analytic, orthogonal, polyhedron::audit};

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

fn zone_cells(zone: &str, variant: &str) -> Vec<Cell> {
    cells().into_iter().filter(|c| c.zone == zone && c.variant == variant).collect()
}

/// The zone's first E9 entry: its relation and, if given, the symbol in mm.
fn e9(zone: &str) -> (String, Option<Q>) {
    let zones = include_str!("../../../fixtures/cad-acid/zones.json");
    let start = zones.find(&format!("\"id\": \"{zone}\"")).expect("zone in zones.json");
    let block = &zones[start..];
    let block = &block[block.find("\"e9\": [").expect("e9 entry")..];
    let block = &block[..block.find(']').unwrap()];
    let field = |name: &str| {
        block.find(&format!("\"{name}\": \"")).map(|i| {
            let rest = &block[i + name.len() + 5..];
            rest[..rest.find('"').unwrap()].to_string()
        })
    };
    (field("relation").expect("e9 relation"), field("symbolValueMm").map(|s| Q::from_str(&s).unwrap()))
}

fn model_of(words: &[u32]) -> Model {
    let body = wonky_wire::v3::decode(words).expect("fixture body decodes");
    analytic::audit(&body).expect("fixture body audits").model().expect("a P1 body has a Model")
}

fn variant_frame(zone: &str, variant: &str) -> Affine {
    let cell = &zone_cells(zone, variant)[0];
    let body = wonky_wire::v3::decode(&cell.words).unwrap();
    let Frame::Interpreter { origin, x, z, .. } = &body.body().frames[1] else { panic!("interpreter frame") };
    let f = |v: &[wonky_contract::Binary64; 3]| v.map(|c| c.get());
    Affine { origin: f(origin), x: f(x), z: f(z) }
}

/// An operand as the interpreter builds it: fCuboid corners in mm times
/// `millimeter` (fl(0.001)), then one opTransform into the variant frame.
fn cuboid(frame: Affine, lo_mm: [f64; 3], hi_mm: [f64; 3]) -> Model {
    let key = BodyKey { id: [3, 9, 4, 1], revision: 0 };
    let checked = |body| audit(&wonky_wire::v3::decode(&wonky_wire::v3::encode(&body).unwrap()).unwrap()).unwrap();
    let local = checked(orthogonal::cuboid(key, lo_mm.map(|v| v * 0.001), hi_mm.map(|v| v * 0.001)).unwrap());
    checked(orthogonal::transform(&local, frame).unwrap()).model().unwrap()
}

/// The zone's operands (A, B) in one variant.
fn operands(zone: &str, variant: &str) -> (Model, Model) {
    let f = variant_frame(zone, variant);
    let (a_hi, b_lo) = match zone {
        "AC39" => (8.0, 8.0 + 0.000000000931322574615478515625),
        "AC40" => (8.0, 8.0 + 0.0009765625),
        "AC41" => (8.0, 8.0 - 0.000000000931322574615478515625),
        "AC42" => (0.1 + 8.2, 8.3),
        "AC43" => (1.68 + 10.1, 11.78),
        other => panic!("{other}"),
    };
    (cuboid(f, [0., 0., 0.], [a_hi, 4., 4.]), cuboid(f, [b_lo, 0., 0.], [16., 4., 4.]))
}

/// The surface whose carrier normal is `sign * e_x`.
fn x_face(m: &Model, sign: i64) -> SurfaceId {
    let want = [Q::from_integer(sign.into()), Q::from_integer(0.into()), Q::from_integer(0.into())];
    let found: Vec<_> = m
        .draft()
        .surfaces
        .iter()
        .enumerate()
        .filter(|(_, s)| match &s.carrier {
            Carrier3::Plane(p) => p.n == want,

        Carrier3::Rotated(_) | Carrier3::RadicalPlane(_) | Carrier3::TranslatedCylinder(_) | Carrier3::Cylinder(_) | Carrier3::Cone(_) | Carrier3::Sphere(_) | Carrier3::Torus(_) => panic!("expected rational planar test carrier"),
    })
        .map(|(i, _)| SurfaceId(i as u32))
        .collect();
    assert_eq!(found.len(), 1, "one face with normal {sign} e_x");
    found[0]
}

/// The relation of A's +x face to B's -x face.
fn facing(ix: &Intersection, a: &Model, b: &Model) -> PlaneRelation {
    let r = ix.relations.get(x_face(a, 1), x_face(b, -1));
    assert_eq!(r.proof, Proof::ExactData);
    r.kind.clone()
}

/// The planes of a model as canonical keys.
fn carriers(m: &Model) -> Vec<CarrierKey> {
    m.canonical().faces.into_iter().map(|f| f.carrier).collect()
}

const VARIANTS: [&str; 4] = ["V0", "V1", "V2", "V3"];

#[test]
fn the_rebuilt_operands_are_the_acid_operands() {
    for zone in ["AC39", "AC40", "AC42"] {
        for variant in VARIANTS {
            let (a, b) = operands(zone, variant);
            let frozen: Vec<Model> = zone_cells(zone, variant).iter().map(|c| model_of(&c.words)).collect();
            assert_eq!(frozen.len(), 2, "{zone} {variant}: two result bodies");
            for rebuilt in [&a, &b] {
                assert!(
                    frozen.iter().any(|m| m.canonical() == rebuilt.canonical() && m.draft().placement == rebuilt.draft().placement),
                    "{zone} {variant}: a rebuilt operand is not a frozen acid body"
                );
            }
        }
    }
    // AC41's sliver lies between A's +x plane and B's -x plane; AC43's merged
    // box between A's -x plane and B's +x plane.
    for (zone, planes) in [("AC41", [(0usize, 1i64), (1, -1)]), ("AC43", [(0, -1), (1, 1)])] {
        for variant in VARIANTS {
            let (a, b) = operands(zone, variant);
            let frozen = zone_cells(zone, variant);
            assert_eq!(frozen.len(), 1, "{zone} {variant}: one result body");
            let result = carriers(&model_of(&frozen[0].words));
            for (operand, sign) in planes {
                let m = [&a, &b][operand];
                let offset = match &m.draft().surfaces[x_face(m, sign).index()].carrier {
                    Carrier3::Plane(p) => p.o[0].clone(),

        Carrier3::Rotated(_) | Carrier3::RadicalPlane(_) | Carrier3::TranslatedCylinder(_) | Carrier3::Cylinder(_) | Carrier3::Cone(_) | Carrier3::Sphere(_) | Carrier3::Torus(_) => panic!("expected rational planar test carrier"),
    };
                let unit_x = [Q::from_integer(1.into()), Q::from_integer(0.into()), Q::from_integer(0.into())];
                assert!(
                    result.contains(&CarrierKey::Plane { normal: unit_x, offset: offset.clone() }),
                    "{zone} {variant}: the result has no face on the operand plane x = {offset}"
                );
            }
        }
    }
}

#[test]
fn the_relation_table_reproduces_the_e9_symbols_of_ac39_to_ac43_in_v0_to_v3() {
    let mut failures = vec![];
    for zone in ["AC39", "AC40", "AC41", "AC42", "AC43"] {
        let (relation, symbol) = e9(zone);
        let expected = match (zone, relation.as_str(), &symbol) {
            ("AC41", ">", Some(mm)) => {
                let m = mm / Q::from_integer(1000.into());
                PlaneRelation::ParallelDisjoint { aligned: false, above: false, distance2: &m * &m }
            }
            (_, ">", Some(mm)) => {
                let m = mm / Q::from_integer(1000.into());
                PlaneRelation::ParallelDisjoint { aligned: false, above: true, distance2: &m * &m }
            }
            (_, "==", None) => PlaneRelation::Opposite,
            other => panic!("unexpected E9 entry {other:?}"),
        };
        for variant in VARIANTS {
            let mut pairs = vec![operands(zone, variant)];
            if ["AC39", "AC40", "AC42"].contains(&zone) {
                // The frozen acid bodies themselves, ordered A (from x = 0) then B.
                let mut frozen: Vec<Model> = zone_cells(zone, variant).iter().map(|c| model_of(&c.words)).collect();
                frozen.sort_by_key(|m| m.canonical().vertices.first().cloned());
                let b = frozen.pop().unwrap();
                pairs.push((frozen.pop().unwrap(), b));
            }
            for (a, b) in &pairs {
                let ix = intersect(a, b, Lineage::Separate).expect("planar operands intersect");
                let got = facing(&ix, a, b);
                if got != expected {
                    failures.push(format!("{zone} {variant}: {got:?}, expected {expected:?}"));
                }
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn contact_and_gaps_leave_exactly_the_interference_they_prove() {
    for variant in VARIANTS {
        // AC43: the contact square is shared: its 4 corners are one point each.
        let (a, b) = operands("AC43", variant);
        let ix = intersect(&a, &b, Lineage::Separate).unwrap();
        assert_eq!(ix.paves.vv.len(), 4, "AC43 {variant}");
        // AC39 and AC42: a real gap, so no vertex, edge or face meets another.
        for zone in ["AC39", "AC42"] {
            let (a, b) = operands(zone, variant);
            let ix = intersect(&a, &b, Lineage::Separate).unwrap();
            let p = &ix.paves;
            assert!(p.vv.is_empty() && p.ve.is_empty() && p.ee.is_empty() && p.vf.is_empty() && p.ef.is_empty(), "{zone} {variant}");
            assert!(ix.sections.is_empty(), "{zone} {variant}");
        }
    }
}

#[test]
fn ac41s_overlap_splits_the_side_faces_into_slivers_with_strict_witnesses() {
    // AC41 (strand G3): B's -x plane lies 2^-30 mm (as binary64 metres) inside
    // A's +x plane. Each operand's four side faces (normals +-y, +-z) are split
    // across the other operand's facing plane into a body part and a sliver;
    // each witness lies strictly inside its part, the sliver's between the two
    // planes. The facing faces themselves split nothing.
    for variant in VARIANTS {
        let (a, b) = operands("AC41", variant);
        let offset = |m: &Model, sign: i64| match &m.draft().surfaces[x_face(m, sign).index()].carrier {
            Carrier3::Plane(p) => p.o[0].clone(),

        Carrier3::Rotated(_) | Carrier3::RadicalPlane(_) | Carrier3::TranslatedCylinder(_) | Carrier3::Cylinder(_) | Carrier3::Cone(_) | Carrier3::Sphere(_) | Carrier3::Torus(_) => panic!("expected rational planar test carrier"),
    };
        let (a_hi, b_lo) = (offset(&a, 1), offset(&b, -1));
        assert!(b_lo < a_hi, "{variant}: an overlap");
        let s = wonky_bool::split(&a, &b, Lineage::Separate).unwrap_or_else(|e| panic!("AC41 {variant}: {}", e.0));
        for (side, m, (lo, hi)) in [(0, &a, (Q::from_integer(0.into()), a_hi.clone())), (1, &b, (b_lo.clone(), offset(&b, 1)))] {
            for fs in &s.faces[side] {
                let face = &m.draft().faces[fs.face.index()];
                let plane = match &m.draft().surfaces[face.surface.index()].carrier {
                    Carrier3::Plane(p) => p,

        Carrier3::Rotated(_) | Carrier3::RadicalPlane(_) | Carrier3::TranslatedCylinder(_) | Carrier3::Cylinder(_) | Carrier3::Cone(_) | Carrier3::Sphere(_) | Carrier3::Torus(_) => panic!("expected rational planar test carrier"),
    };
                if !plane.n[0].is_zero() {
                    assert_eq!(fs.fragments.len(), 1, "AC41 {variant}: a facing face splits nothing");
                    continue;
                }
                let mut xs: Vec<Q> = fs
                    .fragments
                    .iter()
                    .map(|&k| plane.point(fs.witnesses[k].rat().expect("arrangement witnesses remain rational"))[0].clone())
                    .collect();
                xs.sort();
                assert_eq!(xs.len(), 2, "AC41 {variant} operand {side}: two fragments");
                let cut = if side == 0 { &b_lo } else { &a_hi };
                assert!(lo < xs[0] && &xs[0] < cut && cut < &xs[1] && xs[1] < hi, "AC41 {variant} operand {side}: {xs:?}");
            }
        }
    }
}


#[test]
fn g5_keeps_ac41s_exact_delta_after_merge_and_in_either_operand_order() {
    use wonky_bool::{fold, Op};
    for variant in VARIANTS {
        let (a,b) = operands("AC41", variant);
        let delta = a.draft().surfaces[x_face(&a,1).index()].carrier.clone();
        let da = match delta { Carrier3::Plane(p) => p.o[0].clone() ,
        Carrier3::Rotated(_) | Carrier3::RadicalPlane(_) | Carrier3::TranslatedCylinder(_) | Carrier3::Cylinder(_) | Carrier3::Cone(_) | Carrier3::Sphere(_) | Carrier3::Torus(_) => panic!("expected rational planar test carrier"),
    };
        let db = match &b.draft().surfaces[x_face(&b,-1).index()].carrier { Carrier3::Plane(p) => p.o[0].clone() ,
        Carrier3::Rotated(_) | Carrier3::RadicalPlane(_) | Carrier3::TranslatedCylinder(_) | Carrier3::Cylinder(_) | Carrier3::Cone(_) | Carrier3::Sphere(_) | Carrier3::Torus(_) => panic!("expected rational planar test carrier"),
    };
        let delta = da-db;
        let symbol = e9("AC41").1.unwrap() / Q::from_integer(1000.into());
        assert_eq!(delta, symbol);
        let frozen = model_of(&zone_cells("AC41", variant)[0].words);
        for operands in [[&a,&b],[&b,&a]] {
            let out = fold(Op::Intersection, &operands, 9).unwrap();
            assert_eq!(out.model.canonical(), frozen.canonical(), "AC41 {variant}");
            assert_eq!(wonky_bool::resolution::certify(&out.model).unwrap().minimum_distance2, &delta*&delta);
            assert_eq!(out.model.draft().faces.len(), 6);
            assert_eq!(out.model.draft().vertices.len(), 8);
        }
    }
}
