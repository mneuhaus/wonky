//! boolean3d strand G3 (stage P5, planar face split) against independent
//! exact fixtures: tests/data/split_fixtures.py computes, for every face of
//! the 44 G2 configurations and 12 nested ones (section loops around section
//! loops and around holes, several holes each inside its own section loop, a
//! hole crossing a section loop; R0-R3, mirror and far placements), V and E
//! of the split graph, the number of slits and the exact areas of the
//! fragments by a vertical slab decomposition that shares nothing with the
//! arrangement's half-edge walk. Here, independently of the crate's own
//! contracts, every face chart must satisfy Euler (`V - E + F - R = 1`), every
//! witness must lie strictly inside its own cell and outside every other one
//! (exact even-odd test written here), and the fragments must tile the face
//! (exact shoelace areas). The contract checker is shown to catch each
//! defect it names on tampered splits.
use num_rational::BigRational as Q;
use num_traits::{Signed, Zero};
use std::collections::BTreeSet;
use std::str::FromStr;
use wonky_bool::{contract, split, FaceSplit, Lineage, Side, Slit, Source, Split};
use wonky_curve::{Carrier, ExactPoint, Trimmed};
use wonky_geom::frame::Frame;
use wonky_geom::model::{polyhedron, Label, Model, Plane3, PolyFace, Provenance, VertexDef};
use wonky_geom::Point;

struct Config {
    name: String,
    placements: Vec<Frame>,
    faces: [Vec<PolyFace>; 2],
    expected: Vec<String>,
}

fn q(s: &str) -> Q {
    Q::from_str(s).unwrap_or_else(|_| panic!("rational {s}"))
}
fn point(t: &[&str]) -> Point {
    [q(t[0]), q(t[1]), q(t[2])]
}

fn configs() -> Vec<Config> {
    let mut out: Vec<Config> = vec![];
    for line in include_str!("data/split-fixtures.txt").lines().filter(|l| !l.starts_with('#')) {
        let t: Vec<&str> = line.split_whitespace().collect();
        match t[0] {
            "config" => out.push(Config { name: t[1].into(), placements: vec![], faces: [vec![], vec![]], expected: vec![] }),
            "placement" => {
                let v: Vec<Point> = t[2..14].chunks(3).map(point).collect();
                let frame = Frame::new(v[0].clone(), [v[1].clone(), v[2].clone(), v[3].clone()]).unwrap();
                out.last_mut().unwrap().placements.push(frame);
            }
            "face" => {
                let s = usize::from(t[1] == "B");
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
                    provenance: Provenance { node: 1 + s as u32, slot: t[2].parse().unwrap() },
                });
            }
            "split" => out.last_mut().unwrap().expected.push(line.to_string()),
            "end" => {}
            other => panic!("unknown fixture line {other}"),
        }
    }
    out
}

/// Operand `s`; with `reversed`, every carrier normal is negated and every
/// face is `forward: false` (same solid, outer loops clockwise in the chart).
fn model(c: &Config, s: usize, reversed: bool) -> Model {
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
        .unwrap_or_else(|e| panic!("{}: operand {s} is not a valid Model: {}", c.name, e.0))
}

fn run(c: &Config, flip: [bool; 2]) -> Split {
    let (a, b) = (model(c, 0, flip[0]), model(c, 1, flip[1]));
    split(&a, &b, Lineage::Separate).unwrap_or_else(|e| panic!("{} {flip:?}: refused {}", c.name, e.0))
}

// ------------------------------------------------------------ exact chart geometry, written here

fn xy(p: &ExactPoint) -> [Q; 2] {
    p.rat().expect("planar line contacts remain rational").clone()
}
/// The ends of a line piece (every piece of a planar A0 face).
fn segment(t: &Trimmed) -> [[Q; 2]; 2] {
    match t.carrier() {
        Carrier::Line => [xy(&t.ends()[0]), xy(&t.ends()[1])],
        Carrier::Circle(_) | Carrier::BSpline(_) => panic!("stage A0 face pieces are lines"),
    }
}
fn cross(o: &[Q; 2], a: &[Q; 2], b: &[Q; 2]) -> Q {
    (&a[0] - &o[0]) * (&b[1] - &o[1]) - (&a[1] - &o[1]) * (&b[0] - &o[0])
}
fn on_segment(p: &[Q; 2], [a, b]: &[[Q; 2]; 2]) -> bool {
    let between = |k: usize| (&a[k] <= &p[k] && &p[k] <= &b[k]) || (&b[k] <= &p[k] && &p[k] <= &a[k]);
    cross(a, b, p).is_zero() && between(0) && between(1)
}
/// Even-odd crossing count of the horizontal ray to +x (p off every segment).
fn odd(p: &[Q; 2], segments: &[[[Q; 2]; 2]]) -> bool {
    let mut crossings = 0;
    for [a, b] in segments {
        if (a[1] > p[1]) != (b[1] > p[1]) {
            let x = &a[0] + (&p[1] - &a[1]) * (&b[0] - &a[0]) / (&b[1] - &a[1]);
            if p[0] < x {
                crossings += 1;
            }
        }
    }
    crossings % 2 == 1
}
/// Twice the signed area of a closed chain of segments.
fn area2(segments: &[[[Q; 2]; 2]]) -> Q {
    segments.iter().map(|[a, b]| &a[0] * &b[1] - &a[1] * &b[0]).sum()
}
fn cycle_segments(fs: &FaceSplit, cycle: &[usize]) -> Vec<[[Q; 2]; 2]> {
    cycle.iter().map(|&h| segment(&fs.arrangement.oriented(h))).collect()
}
fn cell_segments(fs: &FaceSplit, k: usize) -> Vec<[[Q; 2]; 2]> {
    fs.arrangement.cells[k].cycles.iter().flat_map(|c| cycle_segments(fs, c)).collect()
}
/// Exact area of a cell (its cycles' signed areas summed).
fn cell_area(fs: &FaceSplit, k: usize) -> Q {
    area2(&cell_segments(fs, k)) / Q::from_integer(2.into())
}

fn tag(s: Side) -> &'static str {
    match s {
        Side::A => "A",
        Side::B => "B",
    }
}

/// The fixture line of one face split.
fn observed(fs: &FaceSplit) -> String {
    let arr = &fs.arrangement;
    let mut areas: Vec<Q> = fs.fragments.iter().map(|&k| cell_area(fs, k)).collect();
    areas.sort();
    let areas: Vec<String> = areas.iter().map(|a| a.to_string()).collect();
    format!(
        "split {} {} {} {} {} {} {}",
        tag(fs.side),
        fs.face.0,
        arr.points.len(),
        arr.pieces.len(),
        fs.slits.len(),
        fs.fragments.len(),
        areas.join(" ")
    )
}

/// The checks this file makes independently of the crate's contracts.
fn independent_failures(name: &str, fs: &FaceSplit) -> Vec<String> {
    let arr = &fs.arrangement;
    let mut out = vec![];
    let at = format!("{name} {} {}", tag(fs.side), fs.face.0);
    // Euler per chart: V - E + F - R = 1 (F all bounded cells, R their inner cycles).
    let inner: usize = arr.cells.iter().map(|c| c.cycles.len() - 1).sum();
    let euler = arr.points.len() as i64 - arr.pieces.len() as i64 + arr.cells.len() as i64 - inner as i64;
    if euler != 1 {
        out.push(format!("{at}: V - E + F - R = {euler}"));
    }
    // Witnesses: strictly inside their own cell, outside every other cell.
    let pieces: Vec<[[Q; 2]; 2]> = arr.pieces.iter().map(|p| segment(&p.seg)).chain(fs.slits.iter().map(|s| segment(&s.piece))).collect();
    for (k, w) in fs.witnesses.iter().enumerate() {
        let w = xy(w);
        if pieces.iter().any(|s| on_segment(&w, s)) {
            out.push(format!("{at}: witness of cell {k} lies on a piece"));
            continue;
        }
        for d in 0..arr.cells.len() {
            if odd(&w, &cell_segments(fs, d)) != (d == k) {
                out.push(format!("{at}: witness of cell {k} is {} cell {d}", if d == k { "outside" } else { "inside" }));
            }
        }
    }
    // The fragments tile the face: positive areas summing to the face's area.
    let face_area: Q = fs.leaves[..fs.loops].iter().flat_map(|l| &l.pieces).map(|t| {
        let [a, b] = segment(t);
        &a[0] * &b[1] - &a[1] * &b[0]
    }).sum::<Q>() / Q::from_integer(2.into());
    let areas: Vec<Q> = fs.fragments.iter().map(|&k| cell_area(fs, k)).collect();
    if areas.iter().any(|a| !a.is_positive()) || areas.iter().sum::<Q>() != face_area.abs() {
        out.push(format!("{at}: fragment areas {areas:?} do not tile the face area {face_area}"));
    }
    out
}

#[test]
fn every_face_split_equals_the_slab_fixtures_and_passes_the_independent_checks() {
    let configs = configs();
    assert_eq!(configs.len(), 56);
    let (mut failures, mut nested, mut slits, mut split_faces) = (vec![], 0, 0, 0);
    for c in &configs {
        let s = run(c, [false, false]);
        let mut got = vec![];
        for fs in s.faces.iter().flatten() {
            got.push(observed(fs));
            failures.extend(independent_failures(&c.name, fs));
            nested += fs.arrangement.cells.iter().filter(|cell| fs.fragments.len() > 1 && cell.cycles.len() > 1).count();
            slits += fs.slits.len();
            split_faces += usize::from(fs.fragments.len() > 1);
        }
        got.sort();
        if got != c.expected {
            let (e, g): (BTreeSet<&String>, BTreeSet<&String>) = (c.expected.iter().collect(), got.iter().collect());
            failures.push(format!(
                "{}: missing {:?} extra {:?}",
                c.name,
                e.difference(&g).take(3).collect::<Vec<_>>(),
                g.difference(&e).take(3).collect::<Vec<_>>()
            ));
        }
    }
    assert!(failures.is_empty(), "{} failures:\n{}", failures.len(), failures.join("\n"));
    // Not vacuous (measured at G3: 293 split faces, 79 holed cells in split
    // faces, 2 slits): many faces are really split, cells with holes occur
    // inside split faces, and both slit kinds (isolated, attached) occur.
    assert!(split_faces >= 290 && nested >= 75 && slits == 2, "{split_faces} split faces, {nested} holed cells in split faces, {slits} slits");
}

#[test]
fn reversed_carriers_give_the_same_split() {
    // A reversed face's outer loop runs clockwise in its (left-handed) chart;
    // the chart is mirrored, so counts and areas are unchanged, and the
    // unbounded side is still exactly the outer loop's exterior (contract).
    let mut failures = vec![];
    for c in &configs() {
        for flip in [[true, false], [false, true], [true, true]] {
            let s = run(c, flip);
            let mut got: Vec<String> = s.faces.iter().flatten().map(observed).collect();
            got.sort();
            if got != c.expected {
                failures.push(format!("{} {flip:?}", c.name));
            }
            for fs in s.faces.iter().flatten() {
                failures.extend(independent_failures(&c.name, fs));
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

fn config(name: &str) -> Config {
    configs().into_iter().find(|c| c.name == name).unwrap_or_else(|| panic!("no config {name}"))
}
fn face(s: &Split, side: Side, f: u32) -> &FaceSplit {
    &s.faces[side.index()][f as usize]
}
/// Per fragment of a face: (world-free chart area, cycle count), sorted.
fn fragment_shapes(fs: &FaceSplit) -> Vec<(Q, usize)> {
    let mut v: Vec<(Q, usize)> = fs.fragments.iter().map(|&k| (cell_area(fs, k), fs.arrangement.cells[k].cycles.len())).collect();
    v.sort();
    v
}

#[test]
fn nested_section_loops_and_holes_nest_by_innermost_containment() {
    // A plate 12 x 12 with a hole 5..7 on its top face (A face 1), crossed by
    // a tube 2..10 with bore 4..8: outer ring 144 - 64, tube wall 64 - 16,
    // bore ring 16 - 4, each with exactly one hole. The chart of the top face
    // has x = (12, 0, 0) and y = n x x with |n| = 288, so a world area W has
    // chart area W / (12 * 12 * 288).
    let s = run(&config("tube-around-hole"), [false, false]);
    let top = face(&s, Side::A, 1);
    let scale = Q::from_integer((12 * 12 * 288).into());
    let world: Vec<(Q, usize)> = fragment_shapes(top).into_iter().map(|(a, n)| (a * &scale, n)).collect();
    let w = |x: i64| Q::from_integer(x.into());
    assert_eq!(world, vec![(w(12), 2), (w(48), 2), (w(80), 2)]);
    assert_eq!(top.arrangement.cells.len(), 4, "three fragments and the hole");
    // Two holes each inside its own sleeve: the sleeve wall has two holes.
    let s = run(&config("sleeves-around-two-holes"), [false, false]);
    let shapes = fragment_shapes(face(&s, Side::A, 1));
    assert_eq!(shapes.iter().map(|(_, n)| *n).collect::<Vec<_>>(), vec![2, 2, 2, 3], "{shapes:?}");
}

#[test]
fn a_slit_splits_nothing_and_the_witness_avoids_it() {
    // A tetrahedron edge lies on the cube's top face (A face 1), inside it.
    let s = run(&config("edge-on-face-inside"), [false, false]);
    let top = face(&s, Side::A, 1);
    assert_eq!((top.fragments.len(), top.slits.len()), (1, 1));
    // Both B faces through that edge produced it.
    assert_eq!(top.slits[0].sources.len(), 2);
    assert!(!top.slits[0].piece.contains(&top.witnesses[top.fragments[0]]).unwrap());
}

// ------------------------------------------------------------ the contract checker catches what it names

/// A split of the nested fixture with holes inside split cells.
fn nested_top() -> FaceSplit {
    face(&run(&config("tube-around-hole"), [false, false]), Side::A, 1).clone()
}
fn refusal(fs: &FaceSplit) -> &'static str {
    fs.check().expect_err("a tampered split must fail its contracts").0
}

#[test]
fn a_half_edge_in_two_cycles_is_a_contract_violation() {
    let fs = nested_top();
    assert_eq!(fs.check(), Ok(()));
    // Each fragment's hole also attached to every other cell, before and
    // after its own cell in cell order.
    let cells = fs.arrangement.cells.len();
    let mut tried = 0;
    for &k in &fs.fragments {
        for other in (0..cells).filter(|&d| d != k) {
            let mut bad = fs.clone();
            let hole = bad.arrangement.cells[k].cycles[1].clone();
            bad.arrangement.cells[other].cycles.push(hole);
            assert_eq!(refusal(&bad), contract::SPLIT_HALF_EDGE, "hole of cell {k} also in cell {other}");
            tried += 1;
        }
    }
    assert_eq!(tried, 9, "three holed fragments, four cells");
}

#[test]
fn each_other_contract_catches_its_defect() {
    let base = nested_top();
    let holed = base.fragments[0];
    assert_eq!(base.arrangement.cells[holed].cycles.len(), 2);

    // half-edge-cycles, unbounded side: read as the reversed face, the outer
    // loop's own half-edges would be the exterior.
    let mut fs = base.clone();
    fs.forward = !fs.forward;
    assert_eq!(refusal(&fs), contract::SPLIT_HALF_EDGE);

    // orientation: a cell's hole listed as its outer cycle.
    let mut fs = base.clone();
    fs.arrangement.cells[holed].cycles.swap(0, 1);
    assert_eq!(refusal(&fs), contract::SPLIT_ORIENTATION);

    // witness: on the cell's boundary.
    let mut fs = base.clone();
    let h = fs.arrangement.cells[holed].cycles[0][0];
    fs.witnesses[holed] = fs.arrangement.points[fs.arrangement.tail(h)].clone();
    assert_eq!(refusal(&fs), contract::SPLIT_WITNESS);

    // membership: a fragment dropped.
    let mut fs = base.clone();
    fs.fragments.remove(0);
    assert_eq!(refusal(&fs), contract::SPLIT_MEMBERSHIP);
    // ... or a cell outside the face that no hole loop bounds.
    let mut fs = base.clone();
    let outside = (0..fs.arrangement.cells.len()).find(|k| !fs.fragments.contains(k)).unwrap();
    let loops = fs.loops;
    for h in fs.arrangement.cells[outside].cycles[0].clone() {
        fs.arrangement.pieces[h / 2].owners.retain(|o| o.0 == 0 || o.0 >= loops);
    }
    assert_eq!(refusal(&fs), contract::SPLIT_MEMBERSHIP);

    // unrecorded-contact: a piece that is not its owner's source.
    let mut fs = base.clone();
    let owner = &mut fs.arrangement.pieces[0].owners[0];
    owner.1 = (owner.1 + 1) % fs.leaves[owner.0].pieces.len();
    assert_eq!(refusal(&fs), contract::SPLIT_UNRECORDED);
    // ... or that runs the other way than its source.
    let mut fs = base.clone();
    let owner = &mut fs.arrangement.pieces[0].owners[0];
    owner.2 = !owner.2;
    assert_eq!(refusal(&fs), contract::SPLIT_UNRECORDED);

    // contact: a slit crossing the pieces between two witnesses.
    let mut fs = base.clone();
    let (a, b) = (fs.witnesses[base.fragments[0]].clone(), fs.witnesses[base.fragments[1]].clone());
    fs.slits.push(Slit { piece: Trimmed::new([a, b], Carrier::Line).unwrap(), sources: vec![Source::Section { section: 0, piece: 0 }] });
    assert_eq!(refusal(&fs), contract::SPLIT_CONTACT);

    // ... or a slit that ends inside a boundary piece: the contact is its
    // own end but not the piece's, so the piece was not cut where it is met.
    let mut fs = base.clone();
    let h = fs.arrangement.cells[holed].cycles[0][0];
    let m = fs.arrangement.oriented(h).interior_point().unwrap();
    let [wx, wy] = xy(&fs.witnesses[holed]);
    let [mx, my] = xy(&m);
    let start = ExactPoint::from_rational([(&wx + &mx) / Q::from_integer(2.into()), (&wy + &my) / Q::from_integer(2.into())]);
    fs.slits.push(Slit { piece: Trimmed::new([start, m], Carrier::Line).unwrap(), sources: vec![Source::Section { section: 0, piece: 0 }] });
    assert_eq!(refusal(&fs), contract::SPLIT_CONTACT);

    // euler: an isolated vertex left in the arrangement.
    let mut fs = base.clone();
    let lone = ExactPoint::from_rational([Q::from_integer(7.into()), Q::from_integer(7.into())]);
    fs.arrangement.points.push(lone);
    fs.points.push(fs.points[0]);
    assert_eq!(refusal(&fs), contract::SPLIT_EULER);
}

#[test]
fn a_hole_attached_to_the_wrong_cell_is_a_contract_violation() {
    // tube-around-hole, top face: the plate hole is the hole of the bore
    // fragment. Move it to another fragment (the tube wall and the outer ring
    // both surround it too).
    let base = nested_top();
    let arr = &base.arrangement;
    let hole_cell = (0..arr.cells.len()).find(|k| !base.fragments.contains(k)).unwrap();
    let hole_outer = &arr.cells[hole_cell].cycles[0];
    let twins = |c: &Vec<usize>| c.iter().all(|&h| hole_outer.contains(&(h ^ 1)));
    let bore = (0..arr.cells.len()).find(|&k| arr.cells[k].cycles[1..].iter().any(twins)).unwrap();
    let other = *base.fragments.iter().find(|&&k| k != bore).unwrap();
    let moved = |update_face: bool| {
        let mut fs = base.clone();
        let at = fs.arrangement.cells[bore].cycles.iter().position(twins).unwrap();
        let hole = fs.arrangement.cells[bore].cycles.remove(at);
        if update_face {
            for &h in &hole {
                fs.arrangement.face[h] = other;
            }
        }
        fs.arrangement.cells[other].cycles.push(hole);
        fs
    };
    // The cells disagree with the walk's cell on the left of each half-edge.
    assert_eq!(refusal(&moved(false)), contract::SPLIT_HALF_EDGE);
    // Consistently mis-nested: every cycle still has one cell, the right
    // orientation and the old witnesses, but the hole's witness now lies in
    // two cells (the bore without its hole, and itself).
    assert_eq!(refusal(&moved(true)), contract::SPLIT_WITNESS);
}
