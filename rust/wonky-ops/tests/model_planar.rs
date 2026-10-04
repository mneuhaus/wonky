//! boolean3d strand G1 on the real CAD-Acid bodies: every body of the planar
//! families P1 (orthogonal cells) and P2 (planar Boolean) in a CORRECT zone
//! converts to a `wonky_geom::model::Model` that passes G1-G8, and its canonical
//! exact form is identical across V0-V3. The bodies are the WC0 words in
//! tests/data/acid-planar-wc0.txt (frozen by freeze-planar-acid.mjs,
//! byte-identical to an acid run; see its header). The acid catalog has no
//! body of P2 today, so P2 is exercised on constructed bodies in the acid
//! variant frames. The Model is dark: nothing here is reachable from FS.
use num_rational::BigRational as Q;
use std::collections::{BTreeMap, BTreeSet};
use wonky_contract::{Body, BodyKey, Frame};
use wonky_geom::model::{Canonical, Carrier3, Draft, EdgeId, Model, VertexDef, VertexKey};
use wonky_num::p2;
use wonky_ops::{
    affine::Affine,
    analytic::{self, Solid},
    extrude::{blind_prism, Prism},
    orthogonal,
    polyhedron::{audit, Audited},
};
use wonky_sketch::region::lines_region;

struct Cell {
    zone: String,
    variant: String,
    index: usize,
    words: Vec<u32>,
}

fn cells() -> Vec<Cell> {
    include_str!("data/acid-planar-wc0.txt")
        .lines()
        .filter(|l| !l.starts_with('#'))
        .map(|l| {
            let f: Vec<&str> = l.split_whitespace().collect();
            assert_eq!(f.len(), 6, "fixture line: {}", &l[..l.len().min(80)]);
            let hex = f[5].as_bytes();
            assert_eq!(hex.len() % 8, 0);
            let words = hex
                .chunks(8)
                .map(|c| u32::from_str_radix(std::str::from_utf8(c).unwrap(), 16).unwrap())
                .collect();
            Cell { zone: f[0].into(), variant: f[1].into(), index: f[2].parse().unwrap(), words }
        })
        .collect()
}

fn audited(words: &[u32]) -> Solid {
    analytic::audit(&wonky_wire::v3::decode(words).expect("fixture body decodes and checks")).expect("fixture body audits")
}
fn q(x: f64) -> Q {
    Q::from_float(x).unwrap()
}
/// First differing line of two canonical forms, for failure messages.
fn diff(a: &Canonical, b: &Canonical) -> String {
    let (a, b) = (a.to_string(), b.to_string());
    let (la, lb): (Vec<_>, Vec<_>) = (a.lines().collect(), b.lines().collect());
    match (0..la.len().max(lb.len())).find(|&i| la.get(i) != lb.get(i)) {
        Some(i) => format!("line {i}:\n  {}\n  {}", la.get(i).unwrap_or(&"<none>"), lb.get(i).unwrap_or(&"<none>")),
        None => "identical".into(),
    }
}

const P1: [&str; 13] = ["AC10", "AC11", "AC14", "AC16", "AC17", "AC23", "AC37", "AC39", "AC40", "AC41", "AC42", "AC43", "AC46"];
/// Planar bodies of CORRECT zones that belong to other families (straight
/// prisms, a loft, an affine copy): no Model adapter in G1.
const OTHER: [&str; 4] = ["AC01", "AC05", "AC09", "AC99"];

#[test]
fn every_correct_acid_body_of_p1_and_p2_converts_passes_g1_g8_and_is_identical_across_v0_v3() {
    let mut forms: BTreeMap<(String, usize), Vec<(String, Canonical)>> = BTreeMap::new();
    let mut other = BTreeSet::new();
    let mut p2 = 0;
    for cell in cells() {
        let solid = audited(&cell.words);
        let model = match solid.model() {
            Ok(m) => m,
            Err(e) => {
                assert_eq!(e.0, "model/family-unsupported", "{} {}", cell.zone, cell.variant);
                other.insert(cell.zone.clone());
                continue;
            }
        };
        // The Model is the audited body: same counts, and (P1: every WC0
        // coordinate is an exact interpreter input) the same vertex points.
        let (body, form) = (wonky_wire::v3::decode(&cell.words).unwrap().body().clone(), model.canonical());
        assert_eq!(
            (form.vertices.len(), form.edges.len(), form.faces.len(), form.shells.len()),
            (body.vertices.len(), body.edges.len(), body.faces.len(), body.shells.len()),
            "{} {}: model V/E/F/S vs WC0",
            cell.zone,
            cell.variant
        );
        // P1 vertices are interpreter inputs, P2 vertices replayed rationals.
        match model.draft().vertices[0].def {
            VertexDef::Input(_) => {
                let wc0: BTreeSet<[Q; 3]> = body.vertices.iter().map(|v| v.point.map(|x| q(x.get()))).collect();
                let keys: BTreeSet<[Q; 3]> = form.vertices.iter().map(|k| match k {
                    VertexKey::Rational(p) => p.clone(),

        VertexKey::Quadratic(_) | VertexKey::Real(_) => panic!("expected rational test vertex"),
    }).collect();
                assert!(wc0 == keys, "{} {}: model vertices differ from the WC0 points", cell.zone, cell.variant);
                // The Model's exact volume equals the family's own exact volume (P1 only:
                // P2's family volume is rational, not an expansion).
                if let Solid::Planar(a) = &solid {
                    let v = a.volume6_source().expect("a P1 body has an exact expansion volume");
                    assert_eq!(model.volume6().unwrap().iter().sum::<Q>(), v.iter().map(|&x| q(x)).sum::<Q>(), "{} {}", cell.zone, cell.variant);
                }
            }
            VertexDef::Rational(_) => p2 += 1,

        VertexDef::Quadratic(_) | VertexDef::Radical(_) | VertexDef::OnCurve(_) | VertexDef::Real(_) => panic!("expected rational test vertex"),
    }
        forms.entry((cell.zone, cell.index)).or_default().push((cell.variant, form));
    }
    let zones: BTreeSet<&str> = forms.keys().map(|(z, _)| z.as_str()).collect();
    assert_eq!(zones, P1.into_iter().collect(), "zones whose planar bodies are P1/P2");
    assert_eq!(p2, 0, "no CORRECT acid body is a P2 body today");
    assert_eq!(other, OTHER.into_iter().map(String::from).collect());
    let mut differing = vec![];
    for ((zone, index), variants) in &forms {
        let names: Vec<&str> = variants.iter().map(|(v, _)| v.as_str()).collect();
        assert_eq!(names, ["V0", "V1", "V2", "V3"], "{zone} body {index}");
        for (variant, form) in &variants[1..] {
            if form != &variants[0].1 {
                differing.push(format!("{zone} body {index}: {variant} differs from V0 at {}", diff(&variants[0].1, form)));
            }
        }
    }
    assert!(differing.is_empty(), "{} of {} cells differ from V0:\n{}", differing.len(), 3 * forms.len(), differing.join("\n"));
    assert_eq!(forms.values().map(Vec::len).sum::<usize>(), 4 * (P1.len() + 3), "52 + 12 bodies (AC39, AC40, AC42 have two)");
}

/// The acid model of AC10 (union of two overlapping boxes) in the skew frame V3.
fn ac10_v3() -> Model {
    let cell = cells().into_iter().find(|c| c.zone == "AC10" && c.variant == "V3").unwrap();
    audited(&cell.words).model().unwrap()
}
fn refused(d: Draft) -> &'static str {
    d.check().unwrap_err().0
}

#[test]
fn planted_negatives_on_an_acid_model_are_rejected_by_their_checks() {
    // A flipped coedge (sense and pcurve reversed together): the loop no longer closes.
    let mut d = ac10_v3().into_draft();
    d.coedges[7].forward = !d.coedges[7].forward;
    d.coedges[7].pcurve = d.coedges[7].pcurve.reversed();
    assert_eq!(refused(d), "model/g5-loop-open");
    // A missing edge use: one use of an edge moves to a duplicate edge, so both have one.
    let mut d = ac10_v3().into_draft();
    let e = d.coedges[0].edge;
    d.edges.push(d.edges[e.index()].clone());
    d.coedges[0].edge = EdgeId((d.edges.len() - 1) as u32);
    assert_eq!(refused(d), "model/g7-edge-use");
    // A plane coefficient 1 ulp off its carrier: the origin moves by one ulp along the normal axis.
    let mut d = ac10_v3().into_draft();
    match &mut d.surfaces[0].carrier {
        Carrier3::Plane(p) => {
            let k = p.n.iter().position(|x| x != &Q::from_integer(0.into())).unwrap();
            let value: f64 = num_traits::ToPrimitive::to_f64(&p.o[k]).unwrap();
            assert_eq!(q(value), p.o[k], "P1 plane origins are binary64 inputs");
            p.o[k] = q(value.next_up());
        }

        Carrier3::Rotated(_) | Carrier3::RadicalPlane(_) | Carrier3::TranslatedCylinder(_) | Carrier3::Cylinder(_) | Carrier3::Cone(_) | Carrier3::Sphere(_) | Carrier3::Torus(_) => panic!("expected rational planar test carrier"),
    }
    assert_eq!(refused(d), "model/g2-curve-off-carrier");
    // The unedited model still passes.
    assert!(ac10_v3().into_draft().check().is_ok());
}

// ------------------------------------------------------------ P2 bodies

fn key() -> BodyKey {
    BodyKey { id: [7, 2, 9, 1], revision: 0 }
}
fn checked(body: Body) -> Audited {
    let words = wonky_wire::v3::encode(&body).unwrap();
    audit(&wonky_wire::v3::decode(&words).unwrap()).unwrap()
}
fn prism(frame: Affine, cap: &[[f64; 2]], height: f64) -> Audited {
    let segments: Vec<_> = (0..cap.len()).map(|i| [cap[i][0], cap[i][1], cap[(i + 1) % cap.len()][0], cap[(i + 1) % cap.len()][1]]).collect();
    let regions = lines_region(&segments.iter().map(|s| [p2(s[0], s[1]), p2(s[2], s[3])]).collect::<Vec<_>>()).unwrap();
    checked(
        blind_prism(&Prism { key: key(), source: [0; 4], frame, segments: &segments, region: &regions.loops[0], depth: height, reverse: false })
            .unwrap(),
    )
}
fn cube(frame: Affine, a: [f64; 3], b: [f64; 3]) -> Audited {
    let placed = orthogonal::transform(&checked(orthogonal::cuboid(key(), a, b).unwrap()), frame).unwrap();
    checked(placed)
}
fn run(op: u8, a: &Audited, b: &Audited) -> Audited {
    let bodies = analytic::boolean(key(), op, &[Solid::Planar(a.clone()), Solid::Planar(b.clone())]).unwrap();
    assert_eq!(bodies.len(), 1);
    checked(bodies.into_iter().next().unwrap())
}
/// The four acid variant frames (Interpreter frames of AC10's bodies).
fn variant_frames() -> Vec<Affine> {
    ["V0", "V1", "V2", "V3"]
        .into_iter()
        .map(|v| {
            let cell = cells().into_iter().find(|c| c.zone == "AC10" && c.variant == v).unwrap();
            let body = wonky_wire::v3::decode(&cell.words).unwrap();
            let Frame::Interpreter { origin, x, z, .. } = &body.body().frames[1] else { panic!("interpreter frame") };
            let f = |v: &[wonky_contract::Binary64; 3]| v.map(|c| c.get());
            Affine { origin: f(origin), x: f(x), z: f(z) }
        })
        .collect()
}

#[test]
fn p2_bodies_convert_with_rational_vertices_and_are_identical_across_the_acid_variant_frames() {
    // (name, operands, op, 6 V): a chamfered hexagon prism united with a box
    // (V = 60*2 + 4*5*2 - 4*1*2 = 152), and a box cut by a triangle prism
    // whose cut vertex (2, 2/3) is not dyadic (V = 16/3).
    let mut forms: Vec<Vec<Canonical>> = vec![vec![], vec![]];
    for frame in variant_frames() {
        let wall = prism(frame, &[[0., 0.], [8., 0.], [8., 6.], [6., 8.], [2., 8.], [0., 6.]], 2.);
        let joined = run(0, &wall, &cube(frame, [2., 7., 0.], [6., 12., 2.]));
        let triangle = prism(frame, &[[0., 0.], [3., 0.], [0., 2.]], 2.);
        let cut = run(2, &cube(frame, [0.; 3], [2.; 3]), &triangle);
        for (i, (body, volume6)) in [(joined, Q::from_integer(912.into())), (cut, Q::from_integer(32.into()))].into_iter().enumerate() {
            assert!(body.orthogonal.is_none(), "a P2 body");
            let m = body.model().unwrap();
            assert_eq!(m.volume6().unwrap(), vec![volume6]);
            let (form, wc0) = (m.canonical(), &body.body);
            assert_eq!(
                (form.vertices.len(), form.edges.len(), form.faces.len(), form.shells.len()),
                (wc0.vertices.len(), wc0.edges.len(), wc0.faces.len(), wc0.shells.len()),
                "P2 body {i}: model V/E/F/S vs WC0"
            );
            forms[i].push(form);
        }
    }
    let third = Q::new(2.into(), 3.into());
    let rational = forms[1][0].vertices.iter().any(|v| match v {
        wonky_geom::model::VertexKey::Rational(p) => p.contains(&third),

        wonky_geom::model::VertexKey::Quadratic(_) | wonky_geom::model::VertexKey::Real(_) => panic!("expected rational test vertex"),
    });
    assert!(rational, "the cut keeps its exact non-dyadic vertex");
    for body in &forms {
        for (k, form) in body.iter().enumerate().skip(1) {
            assert!(form == &body[0], "V{k} differs from V0 at {}", diff(&body[0], form));
        }
    }
}
