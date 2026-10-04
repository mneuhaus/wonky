//! Generator blends operate on exact oriented material boundaries per slab.
//! Rebuild the arrangement from the trimmed cycles; cap transitions are sewn
//! by the ordinary stack boundary builder, including blind-pocket endpoints.
use crate::{
    arc_profile::{self, Profile},
    polyhedron::Refused,
    prism_stack::{Expr, Leaf, Mapped, PrismStack, Stack, R},
    prism_stack_brep::EdgeGeom,
};
use std::collections::{BTreeMap, BTreeSet};
use wc::numeric::{cross, dot, sub};
use wonky_contract::*;
use wonky_curve as wc;
const RULE: u32 = 10;
fn no(s: &str) -> Refused {
    Refused(format!("stack-generator/{s}"))
}
pub(crate) fn candidate_node(n: &Construction) -> bool {
    n.rule_version == RULE
        && matches!(
            n.operation,
            Operation::Fillet {} | Operation::Intersection {}
        )
}
pub(crate) fn candidate(b: &Body) -> bool {
    b.constructions.last().is_some_and(candidate_node)
}
pub(crate) fn admits(s: &PrismStack, edges: &[usize]) -> bool {
    !edges.is_empty()
        && edges
            .iter()
            .all(|&e| matches!(s.brep.edges.get(e), Some(EdgeGeom::Vertical { .. })))
}
fn boundary(s: &Stack, slab: usize) -> R<Vec<Vec<usize>>> {
    let arr = &s.arr;
    let mut left = BTreeSet::new();
    let mut outgoing = BTreeMap::new();
    for e in 0..arr.pieces.len() {
        let a = s.at(arr.face[2 * e], slab as isize);
        let b = s.at(arr.face[2 * e + 1], slab as isize);
        if a != b {
            let h = 2 * e + usize::from(!a);
            left.insert(h);
            if outgoing.insert(arr.tail(h), h).is_some() {
                return Err(crate::polyhedron::Refused::geometric_verdict(no("non-manifold-slab").0));
            }
        }
    }
    let mut cycles = vec![];
    while let Some(&first) = left.first() {
        let mut h = first;
        let mut cycle = vec![];
        loop {
            if !left.remove(&h) {
                return Err(no("boundary-walk"));
            }
            cycle.push(h);
            h = *outgoing
                .get(&arr.tail(h ^ 1))
                .ok_or_else(|| no("open-slab"))?;
            if h == first {
                break;
            }
        }
        cycles.push(cycle);
    }
    Ok(cycles)
}
fn modify(
    s: &Stack,
    hs: &[usize],
    selected: &BTreeSet<usize>,
    r: f64,
    chamfer: bool,
) -> R<wc::Cycle> {
    if !hs.iter().any(|&h| selected.contains(&s.arr.tail(h))) {
        return Ok(s.arr.cycle_profile(hs));
    }
    // Arrangement intersections can split an otherwise straight side at
    // vertices that carry no selected generator. Their partitions do not
    // bound the setback's reach; coalesce exactly before trimming the side.
    let mut segs: Vec<wc::Trimmed> = vec![];
    let mut vertices = vec![];
    let straight = |a: &wc::Trimmed, b: &wc::Trimmed| -> R<bool> {
        if !matches!(a.chart(), wc::Chart::Line) || !matches!(b.chart(), wc::Chart::Line) {
            return Ok(false);
        }
        let u = sub(a.ends()[1].rat()?, a.ends()[0].rat()?);
        let v = sub(b.ends()[1].rat()?, b.ends()[0].rat()?);
        Ok(cross(&u, &v) == arc_profile::q(0.) && dot(&u, &v) > arc_profile::q(0.))
    };
    for &h in hs {
        let seg = s.arr.oriented(h);
        let vertex = s.arr.tail(h);
        if !selected.contains(&vertex) && match segs.last() { Some(last) => straight(last, &seg)?, None => false } {
            let last = segs.last_mut().unwrap();
            *last = wc::Trimmed::new(
                [last.ends()[0].clone(), seg.ends()[1].clone()],
                wc::Carrier::Line,
            )?;
        } else {
            segs.push(seg);
            vertices.push(vertex);
        }
    }
    if segs.len() > 2
        && !selected.contains(&vertices[0])
        && straight(segs.last().unwrap(), &segs[0])?
    {
        let last = segs.pop().unwrap();
        vertices[0] = vertices.pop().unwrap();
        segs[0] = wc::Trimmed::new(
            [last.ends()[0].clone(), segs[0].ends()[1].clone()],
            wc::Carrier::Line,
        )?;
    }
    let n = segs.len();
    let mut ends = segs.iter().map(|s| s.ends().clone()).collect::<Vec<_>>();
    let mut joints = vec![None; n];
    for k in 0..n {
        if !selected.contains(&vertices[k]) {
            continue;
        }
        let prev = (k + n - 1) % n;
        let (a, b, joint, _) = crate::profile_blend::joint(&segs[prev], &segs[k], r, !chamfer)?;
        ends[prev][1] = a;
        ends[k][0] = b;
        joints[k] = Some(joint);
    }
    let mut pieces = vec![];
    for k in 0..n {
        crate::profile_blend::retained_order(&segs[k], &ends[k])?;
        if matches!(segs[k].chart(), wc::Chart::Line) {
            let d = sub(segs[k].ends()[1].rat()?, segs[k].ends()[0].rat()?);
            if dot(&sub(ends[k][1].rat()?, ends[k][0].rat()?), &d) <= arc_profile::q(0.) {
                return Err(no("adjacent-face-consumed"));
            }
        }
        if let Some(j) = joints[k].take() {
            pieces.push(j);
        }
        pieces.push(segs[k].trim(ends[k][0].clone(), ends[k][1].clone())?);
    }
    for i in 0..pieces.len() {
        for j in i + 1..pieces.len() {
            if j == i + 1 || (i == 0 && j + 1 == pieces.len()) {
                continue;
            }
            if pieces[i]
                .ends()
                .iter()
                .any(|a| pieces[j].ends().contains(a))
            {
                return Err(no("nonlocal-corner-contact"));
            }
        }
    }
    let result = wc::Cycle::new(pieces);
    Profile::from_pieces(result.pieces().to_vec()).simple()?;
    Ok(result)
}
pub(crate) fn construct(
    mut s: PrismStack,
    edges: &[usize],
    r: f64,
    chamfer: bool,
) -> R<PrismStack> {
    crate::source_frame::SourceMetric::new(&s.frame)?;
    if !s.blend.is_empty() || !s.stack.tools.is_empty() {
        return Err(no("mixed-blends-or-tools"));
    }
    if !admits(&s, edges) {
        return Err(no("generator-edges-required"));
    }
    let mut selections = vec![BTreeSet::new(); s.stack.slabs()];
    for &e in edges {
        let EdgeGeom::Vertical { vertex, span } = s.brep.edges[e] else {
            unreachable!()
        };
        for slab in span[0]..span[1] {
            selections[slab].insert(vertex);
        }
    }
    let mut mapped: Vec<Mapped> = vec![];
    let mut children = vec![];
    for (slab, selected) in selections.iter().enumerate() {
        let mut seen = BTreeSet::new();
        let mut profiles: Vec<(bool, wc::Cycle, wc::Cycle, usize)> = vec![];
        for hs in boundary(&s.stack, slab)? {
            seen.extend(
                hs.iter()
                    .map(|&h| s.stack.arr.tail(h))
                    .filter(|v| selected.contains(v)),
            );
            let cycle = modify(&s.stack, &hs, selected, r, chamfer)?;
            let original = s.stack.arr.cycle_profile(&hs);
            let positive = original.orientation()?;
            if cycle.orientation()? != positive {
                return Err(no("cycle-consumed"));
            }
            // No pair of independently modified boundaries may meet or change
            // nesting. This rules out consuming a pocket or crossing a wall.
            for (_, old, changed, _) in &profiles {
                for a in cycle.pieces() {
                    for b in changed.pieces() {
                        if a.ends().iter().any(|p| b.ends().contains(p)) {
                            return Err(no("boundaries-touch"));
                        }
                        a.admit(b).map_err(|_| no("boundaries-collide"))?;
                    }
                }
                if original.contains(&old.pieces()[0].ends()[0])?
                    != cycle.contains(&changed.pieces()[0].ends()[0])?
                    || old.contains(&original.pieces()[0].ends()[0])?
                        != changed.contains(&cycle.pieces()[0].ends()[0])?
                {
                    return Err(no("nesting-changed"));
                }
            }
            let id = mapped.len();
            profiles.push((positive, original, cycle.clone(), id));
            mapped.push(Mapped {
                profile: if positive { cycle } else { cycle.reversed() },
                levels: [
                    s.stack.levels[slab].clone(),
                    s.stack.levels[slab + 1].clone(),
                ],
                disc: None,
            });
        }
        if seen != *selected {
            return Err(no("selected-corner-not-boundary"));
        }
        let mut holes = BTreeMap::<usize, Vec<Expr>>::new();
        for (positive, hole, _, hi) in &profiles {
            if *positive {
                continue;
            }
            let candidates = profiles
                .iter()
                .filter(|(p, _, _, _)| *p)
                .filter_map(
                    |(_, cycle, _, id)| match cycle.contains(&hole.pieces()[0].ends()[0]) {
                        Ok(true) => Some(Ok((*id, cycle))),
                        Ok(false) => None,
                        Err(e) => Some(Err(Refused::from(e))),
                    },
                )
                .collect::<R<Vec<_>>>()?;
            let mut owner = None;
            for (id, cycle) in &candidates {
                let mut immediate = true;
                for (other, nested) in &candidates {
                    if id != other && cycle.contains(&nested.pieces()[0].ends()[0])? {
                        immediate = false;
                    }
                }
                if immediate {
                    if owner.replace(*id).is_some() {
                        return Err(no("ambiguous-hole-owner"));
                    }
                }
            }
            holes
                .entry(owner.ok_or_else(|| no("unowned-hole"))?)
                .or_default()
                .push(Expr::Leaf(*hi));
        }
        for (positive, _, _, id) in &profiles {
            if *positive {
                let mut parts = vec![Expr::Leaf(*id)];
                parts.extend(holes.remove(id).unwrap_or_default());
                children.push(Expr::Op(1, parts));
            }
        }
    }
    let expr = Expr::Op(0, children);
    let stack = Stack::new(&mapped, &expr)?;
    let root = s.body.constructions.len();
    s.body.constructions.push(Construction {
        operation: if chamfer {
            Operation::Intersection {}
        } else {
            Operation::Fillet {}
        },
        rule_version: RULE,
        parents: vec![NodeId(root as u32 - 1)],
        frame: FrameId(1),
        parameters: std::iter::once(arc_profile::b(r))
            .chain(edges.iter().map(|&e| arc_profile::b(e as f64)))
            .collect::<R<_>>()?,
    });
    let (body, brep) = crate::prism_stack_brep::build(
        s.body.key,
        s.body.frames,
        s.body.constructions,
        NodeId(root as u32),
        &stack,
    )?;
    let leaves = mapped
        .into_iter()
        .map(|m| {
            Ok(Leaf {
                frame: s.frame.clone(),
                axes: [0, 1, 2],
                profile: m.profile,
                levels: [
                    crate::fillet_rim::exact(m.levels[0].clone())?,
                    crate::fillet_rim::exact(m.levels[1].clone())?,
                ],
                meridian: None,
            })
        })
        .collect::<R<_>>()?;
    Ok(PrismStack {
        body,
        brep,
        stack,
        leaves,
        expr,
        frame: s.frame,
        blend: vec![],
    })
}
