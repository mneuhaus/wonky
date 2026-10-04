//! boolean3d strand G2 against independent exact fixtures: 44 planar
//! configurations (generic overlaps under R0-R3 and mirror frames, face,
//! edge and vertex contacts, coincident and parallel faces, faces with holes,
//! non-convex faces, non-dyadic vertices, and near-coincident pairs 2^-30
//! apart placed at 2^25), computed with sympy Rationals by
//! tests/data/planar_fixtures.py (see its header for how each expectation is
//! derived without the Rust algorithm). The relation table, every V-V, V-E,
//! E-E, V-F and E-F fact, every edge's paves and every section piece (ends,
//! boundary flags, pcurves in both face charts) and touch point must be
//! exactly equal; the candidate face pairs must contain every pair whose
//! exact boxes meet. The same configurations with the carriers of A, B or
//! both reversed (faces `forward: false`) must give the same facts, changed
//! only where a carrier normal decides (relations, chart handedness, piece
//! direction).
use num_rational::BigRational as Q;
use std::collections::BTreeSet;
use std::str::FromStr;
use wonky_bool::{intersect, Intersection, Lineage, PlaneRelation, Side};
use wonky_curve::Trimmed;
use wonky_geom::frame::{Frame, RelationClass};
use wonky_geom::model::{polyhedron, Label, Model, Plane3, PolyFace, Provenance, VertexDef};
use wonky_geom::Point;

struct Config {
    name: String,
    placements: Vec<Frame>,
    faces: [Vec<PolyFace>; 2],
    expected: Vec<String>,
    box_meets: BTreeSet<[u32; 2]>,
}

fn q(s: &str) -> Q {
    Q::from_str(s).unwrap_or_else(|_| panic!("rational {s}"))
}
fn point(t: &[&str]) -> Point {
    [q(t[0]), q(t[1]), q(t[2])]
}
fn side(t: &str) -> usize {
    match t {
        "A" => 0,
        "B" => 1,
        other => panic!("operand {other}"),
    }
}

fn configs() -> Vec<Config> {
    let mut out: Vec<Config> = vec![];
    for line in include_str!("data/planar-fixtures.txt").lines().filter(|l| !l.starts_with('#')) {
        let t: Vec<&str> = line.split_whitespace().collect();
        match t[0] {
            "config" => out.push(Config {
                name: t[1].into(),
                placements: vec![],
                faces: [vec![], vec![]],
                expected: vec![],
                box_meets: BTreeSet::new(),
            }),
            "placement" => {
                let v: Vec<Point> = t[2..14].chunks(3).map(point).collect();
                let frame = Frame::new(v[0].clone(), [v[1].clone(), v[2].clone(), v[3].clone()]).unwrap();
                out.last_mut().unwrap().placements.push(frame);
            }
            "face" => {
                let s = side(t[1]);
                let index: u32 = t[2].parse().unwrap();
                let (o, x, n) = (point(&t[3..6]), point(&t[6..9]), point(&t[9..12]));
                let count: usize = t[12].parse().unwrap();
                let (mut k, mut loops) = (13, vec![]);
                for _ in 0..count {
                    let len: usize = t[k].parse().unwrap();
                    loops.push(t[k + 1..k + 1 + 3 * len].chunks(3).map(|c| VertexDef::Rational(point(c))).collect());
                    k += 1 + 3 * len;
                }
                assert_eq!(k, t.len());
                out.last_mut().unwrap().faces[s].push(PolyFace {
                    carrier: Plane3 { o, x, n },
                    forward: true,
                    loops,
                    provenance: Provenance { node: 1 + s as u32, slot: index },
                });
            }
            "boxmeet" => {
                out.last_mut().unwrap().box_meets.insert([t[1].parse().unwrap(), t[2].parse().unwrap()]);
            }
            "end" => {}
            _ => out.last_mut().unwrap().expected.push(line.to_string()),
        }
    }
    out
}

fn model(c: &Config, s: usize) -> Model {
    oriented_model(c, s, false)
}

/// Operand `s`; with `reversed`, every carrier normal is negated and every
/// face is `forward: false`, so the solid is the same point set but each
/// outer loop runs clockwise in its (now left-handed about the outward normal)
/// chart.
fn oriented_model(c: &Config, s: usize, reversed: bool) -> Model {
    let faces = c.faces[s]
        .iter()
        .cloned()
        .map(|mut f| {
            if reversed {
                f.carrier.n = f.carrier.n.clone().map(|x| -x);
                f.forward = false;
            }
            f
        })
        .collect();
    polyhedron(c.placements[s].clone(), Label::Exact, 10 + s as u32, faces)
        .and_then(|d| d.check())
        .unwrap_or_else(|e| panic!("{}: operand {s} (reversed {reversed}) is not a valid Model: {}", c.name, e.0))
}

fn fmt(points: &[&Point]) -> String {
    points.iter().flat_map(|p| p.iter()).map(|x| x.to_string()).collect::<Vec<_>>().join(" ")
}
fn chart_ends(t: &Trimmed) -> String {
    t.ends()
        .iter()
        .flat_map(|e| e.rat().expect("planar fixture endpoints remain rational").clone())
        .map(|x| x.to_string())
        .collect::<Vec<_>>()
        .join(" ")
}
fn tag(s: Side) -> &'static str {
    match s {
        Side::A => "A",
        Side::B => "B",
    }
}

/// The same lines the fixture script prints, from the Rust result.
fn observed(ix: &Intersection) -> Vec<String> {
    let p = &ix.paves;
    let mut out = vec![format!(
        "frame {}",
        match ix.frame {
            RelationClass::R0Identical => "R0",
            RelationClass::R1PermutationTranslation => "R1",
            RelationClass::R2RationalRotation => "R2",
            RelationClass::R3Affine => "R3",
        }
    )];
    for (a, b, r) in ix.relations.iter() {
        let head = format!("relation {} {}", a.0, b.0);
        out.push(match &r.kind {
            PlaneRelation::Identical => format!("{head} identical"),
            PlaneRelation::Opposite => format!("{head} opposite"),
            PlaneRelation::ParallelDisjoint { aligned, above, distance2 } => {
                format!("{head} disjoint {} {} {distance2}", u8::from(*aligned), u8::from(*above))
            }
            PlaneRelation::Transverse { point, direction } => {
                // Canonical line: direction with first nonzero component 1, point with that coordinate 0.
                let k = direction.iter().position(|x| x != &Q::from_integer(0.into())).unwrap();
                let d: Point = direction.clone().map(|x| x / &direction[k]);
                let o: Point = std::array::from_fn(|i| &point[i] - &point[k] * &d[i]);
                format!("{head} transverse {}", fmt(&[&o, &d]))
            }
        });
    }
    let vertex = |s: Side, v: wonky_geom::model::VertexId| p.point(p.vertices[s.index()][v.index()]);
    // An edge by its two end points, smaller first; and whether that reverses it.
    let edge = |s: Side, e: wonky_geom::model::EdgeId| -> (String, bool) {
        let list = &p.edges[s.index()][e.index()];
        let (a, b) = (p.point(list[0]), p.point(*list.last().unwrap()));
        if a <= b {
            (fmt(&[a, b]), false)
        } else {
            (fmt(&[b, a]), true)
        }
    };
    for [a, b] in &p.vv {
        assert_eq!(vertex(Side::A, *a), vertex(Side::B, *b));
        out.push(format!("vv {}", fmt(&[vertex(Side::A, *a)])));
    }
    for r in &p.ve {
        out.push(format!("ve {} {} {}", tag(r.side), fmt(&[vertex(r.side, r.vertex)]), edge(r.side.other(), r.edge).0));
    }
    for r in &p.ee {
        out.push(format!("ee {} {} {}", fmt(&[p.point(r.point)]), edge(Side::A, r.edges[0]).0, edge(Side::B, r.edges[1]).0));
    }
    for r in &p.vf {
        out.push(format!("vf {} {} {}", tag(r.side), fmt(&[vertex(r.side, r.vertex)]), r.face.0));
    }
    for r in &p.ef {
        out.push(format!("ef {} {} {} {}", tag(r.side), edge(r.side, r.edge).0, r.face.0, fmt(&[p.point(r.point)])));
    }
    for s in [Side::A, Side::B] {
        for (e, list) in p.edges[s.index()].iter().enumerate() {
            let (ends, reversed) = edge(s, wonky_geom::model::EdgeId(e as u32));
            let mut points: Vec<&Point> = list.iter().map(|id| p.point(*id)).collect();
            if reversed {
                points.reverse();
            }
            out.push(format!("paves {} {ends} {} {}", tag(s), points.len(), fmt(&points)));
        }
    }
    for s in &ix.sections {
        let [fa, fb] = s.faces;
        for piece in &s.pieces {
            out.push(format!(
                "piece {} {} {} {} {} {} {}",
                fa.0,
                fb.0,
                fmt(&[p.point(piece.ends[0]), p.point(piece.ends[1])]),
                u8::from(piece.boundary[0]),
                u8::from(piece.boundary[1]),
                chart_ends(&piece.pcurves[0]),
                chart_ends(&piece.pcurves[1]),
            ));
        }
        for t in &s.touches {
            out.push(format!("touch {} {} {}", fa.0, fb.0, fmt(&[p.point(*t)])));
        }
    }
    out.sort();
    out
}

/// First differing line of two sorted line lists.
fn first_difference(expected: &[String], got: &[String]) -> String {
    let (e, g): (BTreeSet<&String>, BTreeSet<&String>) = (expected.iter().collect(), got.iter().collect());
    let missing: Vec<_> = e.difference(&g).take(3).collect();
    let extra: Vec<_> = g.difference(&e).take(3).collect();
    format!("missing {missing:?}\n  extra {extra:?}")
}

#[test]
fn stages_p1_to_p4_equal_the_sympy_fixtures_exactly() {
    let configs = configs();
    assert!(configs.len() >= 40, "at least 40 configurations, got {}", configs.len());
    let mut failures = vec![];
    let (mut pieces, mut paves) = (0, 0);
    for c in &configs {
        let (a, b) = (model(c, 0), model(c, 1));
        let ix = match intersect(&a, &b, Lineage::Separate) {
            Ok(ix) => ix,
            Err(e) => {
                failures.push(format!("{}: refused {}", c.name, e.0));
                continue;
            }
        };
        let got = observed(&ix);
        if got != c.expected {
            failures.push(format!("{}: {}", c.name, first_difference(&c.expected, &got)));
        }
        let candidates: BTreeSet<[u32; 2]> = ix.candidates.iter().map(|[a, b]| [a.0, b.0]).collect();
        let lost: Vec<_> = c.box_meets.difference(&candidates).collect();
        if !lost.is_empty() {
            failures.push(format!("{}: face pairs with meeting exact boxes culled: {lost:?}", c.name));
        }
        pieces += ix.sections.iter().map(|s| s.pieces.len()).sum::<usize>();
        paves += ix.paves.edges.iter().flatten().map(|l| l.len() - 2).sum::<usize>();
    }
    assert!(failures.is_empty(), "{} of {} configurations differ:\n{}", failures.len(), configs.len(), failures.join("\n"));
    // The fixtures are not vacuous: they hold real pieces and interior paves.
    assert!(pieces >= 200 && paves >= 150, "{pieces} pieces, {paves} interior paves");
}

/// A fixture line as it must read after reversing the carriers of A
/// (`flip[0]`) and/or B (`flip[1]`). A reversed normal swaps identical and
/// opposite and toggles `aligned` when exactly one operand is reversed;
/// `above` is measured along A's normal, so it toggles when A is reversed.
/// A reversed chart normal negates that face's second chart coordinate, and
/// the section direction `n_a x n_b` flips when exactly one operand is
/// reversed, which reverses each piece. Canonical transverse lines, touches
/// and every V-V..E-F fact and pave list are orientation-free.
fn reversed_line(line: &str, flip: [bool; 2]) -> String {
    let mut t: Vec<String> = line.split_whitespace().map(String::from).collect();
    let one = flip[0] != flip[1];
    let toggle = |s: &mut String| *s = if s == "0" { "1".into() } else { "0".into() };
    let negate = |s: &mut String| *s = (-q(s)).to_string();
    match (t[0].as_str(), t.get(3).map(String::as_str)) {
        ("relation", Some("identical")) if one => t[3] = "opposite".into(),
        ("relation", Some("opposite")) if one => t[3] = "identical".into(),
        ("relation", Some("disjoint")) => {
            if one {
                toggle(&mut t[4]);
            }
            if flip[0] {
                toggle(&mut t[5]);
            }
        }
        ("piece", _) => {
            // piece fa fb | x0 y0 z0 x1 y1 z1 | bA bB | uA0 vA0 uA1 vA1 | uB0 vB0 uB1 vB1
            assert_eq!(t.len(), 19, "{line}");
            for (on, [v0, v1]) in [(flip[0], [12, 14]), (flip[1], [16, 18])] {
                if on {
                    negate(&mut t[v0]);
                    negate(&mut t[v1]);
                }
            }
            if one {
                for (a, b) in [(3, 6), (4, 7), (5, 8), (11, 13), (12, 14), (15, 17), (16, 18)] {
                    t.swap(a, b);
                }
            }
        }
        _ => {}
    }
    t.join(" ")
}

#[test]
fn reversed_carriers_change_only_what_orientation_decides() {
    // Every adapter emits forward faces today; G3's fragments and G4's
    // reversed B faces will not. Point location must hold for an outer loop
    // that runs clockwise in its chart (winding -1 inside), and relations and
    // pieces must follow the carrier normals, not the face senses.
    let configs = configs();
    let mut failures = vec![];
    for c in &configs {
        for flip in [[true, false], [false, true], [true, true]] {
            let (a, b) = (oriented_model(c, 0, flip[0]), oriented_model(c, 1, flip[1]));
            let mut expected: Vec<String> = c.expected.iter().map(|l| reversed_line(l, flip)).collect();
            expected.sort();
            match intersect(&a, &b, Lineage::Separate) {
                Ok(ix) => {
                    let got = observed(&ix);
                    if got != expected {
                        failures.push(format!("{} {flip:?}: {}", c.name, first_difference(&expected, &got)));
                    }
                }
                Err(e) => failures.push(format!("{} {flip:?}: refused {}", c.name, e.0)),
            }
        }
    }
    assert!(failures.is_empty(), "{} of {} runs differ:\n{}", failures.len(), 3 * configs.len(), failures.join("\n"));
}

#[test]
fn the_near_coincident_configurations_keep_their_2_pow_minus_30_pairs_apart() {
    // Direct statements of what the planted cache dedup must break (the full
    // comparison above covers them too; these name the facts).
    let configs = configs();
    let get = |name: &str| configs.iter().find(|c| c.name == name).unwrap();
    let run = |name: &str| {
        let c = get(name);
        intersect(&model(c, 0), &model(c, 1), Lineage::Separate).unwrap()
    };
    // Two vertices 2^-30 apart (at 2^25) are two points: no V-V.
    let ix = run("near-vertex-2^-30");
    assert!(ix.paves.vv.is_empty());
    assert_eq!(ix.paves.points.len(), 16);
    // The overlap sliver: B's vertex lies 2^-30 before A's end vertex on A's edge.
    let ix = run("near-overlap-2^-30");
    assert!(ix.paves.vv.is_empty());
    assert_eq!(ix.paves.ve.len(), 8, "4 B vertices on A edges and 4 A vertices on B edges");
    // The apex 2^-30 below the top face: four edge-face points 2^-30 from it.
    let ix = run("near-apex-2^-30-deep");
    assert_eq!(ix.paves.ef.len(), 4);
}
