//! F1a radical-vertex audit (pkg-predicate-audit.fix1, 2026-10-02): replays the
//! independent sympy corpus of tests/data/chamfer-audit.py through the public
//! equal-offset chamfer. The oracle computes in sympy's algebraic number fields,
//! enumerates the vertices of "prism intersected with every cut halfspace" and
//! decides overflow by midpoint tests; it shares no algorithm with chamfer.rs.
//! Cases: random convex prisms with oblique caps (one edge, two edges at a vertex,
//! three-edge corners, unrelated edge sets), exact ties where a cut passes
//! through an unselected vertex and 2^-60 / one-ulp near ties, dihedrals one ulp
//! from flat, and one prism scaled by 2^k for k in -1074, -1022, -500, -300,
//! -60, 60, 300, 500, 1023 (the extremes are refused as inputs, see REFUSED).
use num_bigint::BigInt;
use std::collections::{BTreeMap, BTreeSet};
use wonky_blend::{chamfer, Request, Section};
use wonky_curve::radical::{guard, Radical};
use wonky_geom::frame::Frame;
use wonky_geom::model::*;
use wonky_geom::{cross, sub, Point, Q};

fn q(s: &str) -> Q {
    let (n, d) = s.split_once('/').expect("n/d");
    Q::new(n.parse::<BigInt>().unwrap(), d.parse::<BigInt>().unwrap())
}

/// `<k> r1 c1 ... rk ck` meaning sum ci * sqrt(ri).
fn radical(f: &mut impl Iterator<Item = &'static str>) -> Radical {
    let k: usize = f.next().unwrap().parse().unwrap();
    (0..k).fold(Radical::default(), |s, _| {
        let r = q(f.next().unwrap());
        let c = q(f.next().unwrap());
        s + Radical::quadratic(Q::from_integer(0.into()), c, r).unwrap()
    })
}

fn face(lp: Vec<Point>, slot: u32) -> PolyFace {
    PolyFace {
        carrier: Plane3 {
            o: lp[0].clone(),
            n: cross(&sub(&lp[1], &lp[0]), &sub(&lp[2], &lp[0])),
            x: sub(&lp[1], &lp[0]),
        },
        forward: true,
        loops: vec![lp.into_iter().map(VertexDef::Rational).collect()],
        provenance: Provenance { node: 0, slot },
    }
}

/// Counter-clockwise polygon at z = 0, cap z = height + slope * x.
/// Admission refusals of the input prism are returned, not unwrapped.
fn prism(poly: &[[Q; 2]], height: &Q, slope: &Q) -> Result<(Model, Vec<Point>, Vec<Point>), String> {
    let lo: Vec<Point> = poly
        .iter()
        .map(|p| [p[0].clone(), p[1].clone(), Q::from_integer(0.into())])
        .collect();
    let hi: Vec<Point> = poly
        .iter()
        .map(|p| [p[0].clone(), p[1].clone(), height + slope * &p[0]])
        .collect();
    let mut bottom = lo.clone();
    bottom.reverse();
    let mut faces = vec![face(bottom, 0), face(hi.clone(), 1)];
    for i in 0..lo.len() {
        let j = (i + 1) % lo.len();
        faces.push(face(
            vec![lo[i].clone(), lo[j].clone(), hi[j].clone(), hi[i].clone()],
            (i + 2) as u32,
        ));
    }
    let m = polyhedron(Frame::identity(), Label::Exact, 0, faces)
        .and_then(|d| d.check())
        .map_err(|e| e.0.to_string())?;
    Ok((m, lo, hi))
}

fn edge(m: &Model, a: &Point, b: &Point) -> EdgeId {
    let found: Vec<_> = m
        .draft()
        .edges
        .iter()
        .enumerate()
        .filter_map(|(i, e)| match e.bounds {
            Bounds::Segment([u, v]) => {
                let ends = [m.key(u).rational().unwrap(), m.key(v).rational().unwrap()];
                (ends == [a, b] || ends == [b, a]).then_some(EdgeId(i as u32))
            }
            Bounds::Ring => None,
        })
        .collect();
    assert_eq!(found.len(), 1);
    found[0]
}

#[test]
fn equal_offset_chamfers_match_the_sympy_polytope_oracle() {
    let text = include_str!("data/chamfer-audit.txt");
    let (mut solids, mut overflows, mut vertices, mut irrational) = (0, 0, 0, 0);
    let mut refused = BTreeMap::<String, usize>::new();
    for line in text.lines().filter(|l| !l.starts_with('#')) {
        let (case, want) = line.split_once(" | ").unwrap();
        let family = case.split(' ').nth(1).unwrap().trim_end_matches(|c: char| c == '-' || c.is_ascii_digit());
        let mut f = case.split(' ').skip(2);
        let height = q(f.next().unwrap());
        let slope = q(f.next().unwrap());
        let width = q(f.next().unwrap());
        let n: usize = f.next().unwrap().parse().unwrap();
        let poly: Vec<[Q; 2]> = (0..n)
            .map(|_| [q(f.next().unwrap()), q(f.next().unwrap())])
            .collect();
        let (m, lo, hi) = match prism(&poly, &height, &slope) {
            Ok(x) => x,
            Err(code) => {
                // Never reaches the chamfer: the input itself leaves the binary64 range.
                assert!(case.starts_with("case scale"), "{line}: input {code}");
                *refused.entry(format!("{family} input {code}")).or_default() += 1;
                continue;
            }
        };
        let k: usize = f.next().unwrap().parse().unwrap();
        let selected: Vec<_> = (0..k)
            .map(|_| {
                let name = f.next().unwrap();
                let i: usize = name[1..].parse().unwrap();
                let j = (i + 1) % n;
                match &name[..1] {
                    "b" => edge(&m, &lo[i], &lo[j]),
                    "t" => edge(&m, &hi[i], &hi[j]),
                    _ => edge(&m, &lo[i], &hi[i]),
                }
            })
            .collect();
        let request = Request {
            section: Section::EqualOffsets { width },
            tangent_propagation: false,
        };
        let got = chamfer::equal_offsets(&m, &selected, request, 1);
        let mut w = want.split(' ');
        match w.next().unwrap() {
            "overflow" => {
                let e = got.expect_err(line);
                assert!(e.0.starts_with("blend/overflow:"), "{line}: {e:?}");
                overflows += 1;
            }
            "ok" => {
                let b = match got {
                    Ok(b) => b,
                    // The exact answer exists but its bit size passes the
                    // 16384-bit Radical cap: a named capability refusal.
                    Err(e) if e.0 == "chamfer/RadicalBudget" && case.starts_with("case scale") => {
                        *refused.entry(format!("{family} chamfer {}", e.0)).or_default() += 1;
                        continue;
                    }
                    Err(e) => panic!("{line}: {e:?}"),
                };
                let faces: usize = w.next().unwrap().parse().unwrap();
                let volume6 = guard(|| radical(&mut w)).unwrap();
                let count: usize = w.next().unwrap().parse().unwrap();
                let expected: BTreeSet<[Radical; 3]> = guard(|| {
                    (0..count)
                        .map(|_| std::array::from_fn(|_| radical(&mut w)))
                        .collect()
                })
                .unwrap();
                assert_eq!(expected.len(), count, "{line}");
                let actual: BTreeSet<[Radical; 3]> = b
                    .faces
                    .iter()
                    .flat_map(|f| f.loops.iter().flatten())
                    .cloned()
                    .collect();
                assert!(actual == expected, "{line}: vertex set differs");
                assert_eq!(b.faces.len(), faces, "{line}");
                assert!(b.volume6() == volume6, "{line}: volume6 {:?}", b.volume6());
                // The exact boundary above is the audited decision. Admission as
                // a Model is a separate capability: named refusals are counted.
                match b.model(&m, 1) {
                    Ok(model) => {
                        assert!(model.volume6_radical().unwrap() == vec![volume6], "{line}")
                    }
                    Err(e) => *refused.entry(format!("{family} admission {}", e.0)).or_default() += 1,
                }
                solids += 1;
                vertices += count;
                irrational += expected
                    .iter()
                    .filter(|p| p.iter().any(|x| x.rational().is_none()))
                    .count();
            }
            other => panic!("unknown expectation {other}"),
        }
    }
    eprintln!("chamfer audit: {solids} exact solids ({vertices} vertices, {irrational} irrational), {overflows} overflows, refused {refused:?}");
    assert_eq!((solids, overflows, vertices, irrational), (SOLIDS, 111, VERTICES, IRRATIONAL));
    assert_eq!(refused, BTreeMap::from(REFUSED.map(|(k, n)| (k.to_string(), n))));
}

const SOLIDS: usize = 139;
const VERTICES: usize = 1669;
const IRRATIONAL: usize = 489;
/// Named refusals where the oracle has an exact answer. They are capability
/// gaps, never wrong geometry; a change here must be explained, not re-pinned.
/// Admission (Boundary::model, the path of model_boolean.rs) cannot yet key a
/// vertex with more than one square class or recover a rational chart line
/// through radical vertices; binary64-extreme inputs leave the enclosure range.
const REFUSED: [(&str, usize); 9] = [
    ("random admission chamfer/multiquadratic-vertex-unavailable", 24),
    ("random admission curve2/crossing-needs-algebraic-vertex", 41),
    ("scale admission arc-profile/numeric-range", 4),
    ("scale admission curve2/crossing-needs-algebraic-vertex", 3),
    ("scale admission curve2/radical-budget", 2),
    ("scale admission model/g5-orientation-undecided", 2),
    ("scale chamfer chamfer/RadicalBudget", 3),
    ("scale input arc-profile/numeric-range", 6),
    ("scale input model/g5-orientation-undecided", 3),
];
