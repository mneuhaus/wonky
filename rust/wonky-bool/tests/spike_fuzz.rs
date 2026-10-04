//! boolean3d strand G4: the general Boolean against the planar spike (P0)
//! on 10^3 random orthogonal operand pairs (union and subtraction), frozen
//! in tests/data/spike-fuzz.txt by rust/wonky-replay/src/bin/planar-spike-fuzz.rs
//! (see its header) before retirement R1 deletes the spike.
//!
//! Where the spike returns bodies, the general path must return the same
//! exact result:
//! * no body: `boolean/empty-result`;
//! * otherwise, per shell, the same multiset of (six times the exact signed
//!   volume, Euler characteristic `V - E + F - H`), and as many solids as
//!   the spike has bodies of positive volume.
//!
//! Faces are not compared one to one: the spike emits the convex facets of
//! its cell arrangement (unmerged), the general path the fragments of the
//! operand faces, now normalized; the spike may retain subdivisions of the
//! same surfaces, which the Euler characteristic of each shell does not see.
//!
//! One convention differs, and only where AC12 accepts both answers: two
//! operands whose interiors are disjoint but which touch (the union is not a
//! manifold solid). The spike returns them unchanged as separate bodies
//! (AC12 outcome G) where their contact is a vertex; the general path
//! refuses `boolean/non-manifold-result` (AC12 outcome R), as the family
//! P1 does on AC12 itself. Such a pair counts as agreeing only when the
//! spike's bodies are exactly the operands, the general intersection is
//! empty and P3 records a contact; the count is pinned.
//!
//! Where the spike refuses, the general path's outcome is tallied (it may
//! build, e.g. a cavity, or refuse with FeatureScript semantics). On every
//! pair the general path's volumes must also satisfy inclusion-exclusion
//! with its own intersection: `|A u B| + |A n B| = |A| + |B|` and
//! `|A - B| = |A| - |A n B|` (an empty result has volume 0).
use num_rational::BigRational as Q;
use std::collections::{BTreeMap, BTreeSet};
use wonky_bool::{boolean, intersect, Lineage, Op};
use wonky_geom::frame::Frame;
use wonky_geom::model::{polyhedron, Bounds, Label, Model, Plane3, PolyFace, Provenance, VertexDef, VertexKey};
use wonky_geom::{cross, dot, sub, Point};

fn q(v: i64) -> Q {
    Q::from_integer(v.into())
}

/// `V:x,y,z/... F:i,j,k/...` as a checked Model.
fn operand(text: &str, node: u32) -> Model {
    let (v, f) = text.split_once(' ').unwrap();
    let vertices: Vec<Point> = v
        .strip_prefix("V:")
        .unwrap()
        .split('/')
        .map(|p| {
            let c: Vec<i64> = p.split(',').map(|x| x.parse().unwrap()).collect();
            [q(c[0]), q(c[1]), q(c[2])]
        })
        .collect();
    let faces = f
        .strip_prefix("F:")
        .unwrap()
        .split('/')
        .enumerate()
        .map(|(i, cycle)| {
            let cycle: Vec<usize> = cycle.split(',').map(|x| x.parse().unwrap()).collect();
            // Newell normal (exact): outward for a counter-clockwise cycle.
            let mut n = [q(0), q(0), q(0)];
            for k in 0..cycle.len() {
                let (a, b) = (&vertices[cycle[k]], &vertices[cycle[(k + 1) % cycle.len()]]);
                n[0] += (&a[1] - &b[1]) * (&a[2] + &b[2]);
                n[1] += (&a[2] - &b[2]) * (&a[0] + &b[0]);
                n[2] += (&a[0] - &b[0]) * (&a[1] + &b[1]);
            }
            PolyFace {
                carrier: Plane3 { o: vertices[cycle[0]].clone(), x: sub(&vertices[cycle[1]], &vertices[cycle[0]]), n },
                forward: true,
                loops: vec![cycle.iter().map(|&k| VertexDef::Rational(vertices[k].clone())).collect()],
                provenance: Provenance { node, slot: i as u32 },
            }
        })
        .collect();
    polyhedron(Frame::identity(), Label::Exact, node, faces).unwrap().check().unwrap_or_else(|e| panic!("operand {text}: {}", e.0))
}

/// Per shell: (six times its signed volume, V - E + F - H), sorted.
fn shells(m: &Model) -> Vec<(Q, i64)> {
    let d = m.draft();
    let point = |v: wonky_geom::model::VertexId| match m.key(v) {
        VertexKey::Rational(p) => p.clone(),

        VertexKey::Quadratic(_) | VertexKey::Real(_) => panic!("expected rational test vertex"),
    };
    let mut out = vec![];
    for s in &d.shells {
        let (mut vs, mut es, mut holes, mut v6) = (BTreeSet::new(), BTreeSet::new(), 0i64, q(0));
        for f in &s.faces {
            let face = &d.faces[f.index()];
            holes += face.loops.len() as i64 - 1;
            for l in &face.loops {
                let mut starts = vec![];
                for c in &d.loops[l.index()].coedges {
                    let co = &d.coedges[c.index()];
                    es.insert(co.edge);
                    match d.edges[co.edge.index()].bounds {
                        Bounds::Segment([a, b]) => {
                            vs.insert(a);
                            vs.insert(b);
                            starts.push(if co.forward { a } else { b });
                        }
                        Bounds::Ring => panic!("planar"),
                    }
                }
                let p0 = point(starts[0]);
                for k in 1..starts.len() - 1 {
                    v6 += dot(&p0, &cross(&point(starts[k]), &point(starts[k + 1])));
                }
            }
        }
        out.push((v6, vs.len() as i64 - es.len() as i64 + s.faces.len() as i64 - holes));
    }
    out.sort();
    out
}

fn total(m: &Model) -> Q {
    m.volume6().unwrap().into_iter().sum()
}

#[test]
fn the_general_path_equals_the_frozen_spike_on_a_thousand_random_pairs() {
    let text = include_str!("data/spike-fuzz.txt");
    let (mut compared, mut empty, mut convention, mut failures) = (0, 0, 0, vec![]);
    let mut tally: BTreeMap<String, usize> = BTreeMap::new();
    let mut ops: BTreeMap<usize, BTreeMap<&str, Result<Q, String>>> = BTreeMap::new();
    let mut operands: BTreeMap<usize, (Model, Model)> = BTreeMap::new();
    let lines: Vec<&str> = text.lines().filter(|l| !l.starts_with('#')).collect();
    assert_eq!(lines.len(), 2000, "1000 pairs, union and subtraction");
    for line in lines {
        let (input, spike) = line.split_once(" -> ").unwrap();
        let mut head = input.splitn(3, ' ');
        let pair: usize = head.next().unwrap().parse().unwrap();
        let op_name = head.next().unwrap();
        let rest = head.next().unwrap();
        let (a_text, b_text) = rest.strip_prefix("A ").unwrap().split_once(" B ").unwrap();
        let (a, b) = operands.entry(pair).or_insert_with(|| (operand(a_text, 1), operand(b_text, 2))).clone();
        let op = match op_name {
            "union" => Op::Union,
            "subtraction" => Op::Subtraction,
            other => panic!("{other}"),
        };
        let general = boolean(&a, &b, op, Lineage::Separate, 0);
        ops.entry(pair).or_default().insert(
            op_name,
            match &general {
                Ok(o) => Ok(total(&o.model)),
                Err(e) if e.0 == "boolean/empty-result" => Ok(q(0)),
                Err(e) => {
                    assert_eq!(e.0, "boolean/non-manifold-result", "pair {pair} {op_name}: unexpected refusal");
                    Err(e.0.to_string())
                },
            },
        );
        let words: Vec<&str> = spike.split_whitespace().collect();
        match words[0] {
            "bodies" => {
                assert_eq!(words.last(), Some(&"integral=true"), "{line}");
                let bodies: Vec<(Q, i64)> = words[2..words.len() - 1]
                    .iter()
                    .map(|b| {
                        let n: Vec<i64> = b.trim_matches(['[', ']']).split(',').map(|x| x.parse().unwrap()).collect();
                        (q(n[4]), n[0] - n[1] + n[2] - n[3])
                    })
                    .collect();
                compared += 1;
                if bodies.is_empty() {
                    empty += 1;
                    if general.as_ref().err().map(|e| e.0) != Some("boolean/empty-result") {
                        failures.push(format!("{pair} {op_name}: spike empty, general {:?}", general.as_ref().map(|o| shells(&o.model)).map_err(|e| e.0)));
                    }
                    continue;
                }
                match &general {
                    Ok(o) => {
                        let mut expected = bodies.clone();
                        expected.sort();
                        let solids = bodies.iter().filter(|b| b.0 > q(0)).count();
                        if shells(&o.model) != expected || o.assembly.solids.len() != solids {
                            failures.push(format!("{pair} {op_name}: spike {expected:?}, general {:?} in {} solid(s)", shells(&o.model), o.assembly.solids.len()));
                        }
                    }
                    Err(e) => {
                        let mut spike_shells = bodies.clone();
                        spike_shells.sort();
                        let mut operand_shells = [shells(&a), shells(&b)].concat();
                        operand_shells.sort();
                        let disjoint = boolean(&a, &b, Op::Intersection, Lineage::Separate, 0).err().map(|e| e.0) == Some("boolean/empty-result");
                        let p3 = intersect(&a, &b, Lineage::Separate).unwrap().paves;
                        let touching = !(p3.vv.is_empty() && p3.ve.is_empty() && p3.ee.is_empty() && p3.vf.is_empty());
                        if op == Op::Union && e.0 == "boolean/non-manifold-result" && spike_shells == operand_shells && disjoint && touching {
                            convention += 1;
                        } else {
                            failures.push(format!("{pair} {op_name}: spike {bodies:?}, general refuses {}", e.0));
                        }
                    }
                }
            }
            "unresolved" | "undecidable" => {
                let general = match &general {
                    Ok(o) => format!("builds {} solid(s)", o.assembly.solids.len()),
                    Err(e) => e.0.to_string(),
                };
                *tally.entry(format!("spike {} {} / general {general}", words[0], words[1..].join(" "))).or_default() += 1;
            }
            other => panic!("{other}"),
        }
    }
    // Inclusion-exclusion with the general intersection.
    let (mut identities, mut skipped) = (0, 0);
    for (pair, (a, b)) in &operands {
        let meet = match boolean(a, b, Op::Intersection, Lineage::Separate, 0) {
            Ok(o) => Ok(total(&o.model)),
            Err(e) if e.0 == "boolean/empty-result" => Ok(q(0)),
            Err(e) => {
                assert_eq!(e.0, "boolean/non-manifold-result", "pair {pair} intersection: unexpected refusal");
                Err(e.0)
            },
        };
        let (va, vb) = (total(a), total(b));
        match (&ops[pair]["union"], &ops[pair]["subtraction"], meet) {
            (Ok(u), Ok(s), Ok(i)) => {
                identities += 1;
                if u + &i != &va + &vb || s != &(&va - &i) {
                    failures.push(format!("{pair}: inclusion-exclusion fails: |A|={va} |B|={vb} |AuB|={u} |A-B|={s} |AnB|={i}"));
                }
            }
            _ => skipped += 1,
        }
    }
    eprintln!("spike fuzz: {compared} spike results compared ({empty} empty, {convention} touching unions: spike separate bodies, general non-manifold-result), inclusion-exclusion on {identities} pairs ({skipped} with a refusal skipped)");
    for (k, n) in &tally {
        eprintln!("  {n:4} {k}");
    }
    assert!(failures.is_empty(), "{} mismatches:\n{}", failures.len(), failures.iter().take(20).cloned().collect::<Vec<_>>().join("\n"));
    assert_eq!(compared, 1930, "every spike result with bodies was compared");
    assert_eq!((identities, skipped), (929, 71), "fixed corpus identity coverage");
    assert_eq!(convention, 2, "touching unions answered by the AC12 convention difference");
}
