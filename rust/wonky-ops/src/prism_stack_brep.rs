//! Boundary of a stacked-prism arrangement. Side patches (piece x slab) and
//! cap patches (cell x level) separate material from void. Patches merge into
//! maximal faces only across edges that then carry no other patch: sides of
//! one piece across levels, sides of one source carrier across a vertex with
//! exactly two side patches, and equally oriented caps across a piece. Edges
//! meeting at a vertex with no other edge merge along their common carrier.
//! A ring (a full turn anchored at one vertex) carries a periodic side face:
//! its seam is the vertical edge at the anchor, used twice by that face, once
//! at each end of the unrolled parameter interval.
//! Every topology decision reads the exact arrangement; WC0 numbers are
//! rounded caches of it.
use crate::{
    arc_profile::{enclose, finite},
    prism_stack::{find, no, Stack, R, UNBOUNDED},
};
use std::collections::{BTreeMap, BTreeSet};
use wonky_contract::*;
use wonky_curve as wc;
use wonky_num::{Iv, Scalar};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Patch {
    Side(usize, usize),
    Cap(usize, usize),
}
#[derive(Clone, Debug)]
pub(crate) enum EdgeGeom {
    /// Consecutive canonical pieces of one carrier at a level.
    Horizontal { level: usize, pieces: Vec<usize> },
    /// Vertical line at an arrangement vertex from level `span[0]` to `span[1]`.
    Vertical { vertex: usize, span: [usize; 2] },
    /// Half of a tool ring, counter-clockwise from angle `half * pi`.
    Ring { tool: usize, ring: usize, half: usize },
    /// Generator of a tool band at angle `angle * pi`, upwards.
    Seam { tool: usize, band: usize, angle: usize },
}
#[derive(Clone, Debug)]
pub(crate) enum FaceKind {
    Cap { level: usize, up: bool },
    /// `left`: material lies left of the canonical piece direction.
    /// `first`: the canonical first piece of the face's carrier chain.
    Side { left: bool, first: usize },
    /// Half of a tool's cylinder or cone band (material away from the axis).
    Band { tool: usize, band: usize, half: usize },
    /// A tool plate (counterbore step or blind end).
    Plate { tool: usize, plate: usize },
}
#[derive(Clone, Debug)]
pub(crate) struct FaceInfo {
    pub patches: Vec<Patch>,
    pub kind: FaceKind,
    /// Tool rings sewn into a base cap as inner loops: (tool, ring).
    pub holes: Vec<(usize, usize)>,
}
/// WC0 vertex: an arrangement vertex at a level, or a tool ring point at
/// angle 0 or pi.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum VKey {
    Grid(usize, usize),
    Ring(usize, usize, usize),
}
#[derive(Clone, Debug)]
pub(crate) struct Brep {
    pub faces: Vec<FaceInfo>,
    pub edges: Vec<EdgeGeom>,
    pub vertices: Vec<VKey>,
}
type Use = (usize, bool);
struct Real {
    geom: EdgeGeom,
    start: (usize, usize),
    end: (usize, usize),
    uses: [Use; 2],
}
pub(crate) fn b(x: f64) -> R<Binary64> {
    Binary64::new(x).map_err(|_| no("numeric-range"))
}
pub(crate) fn v3(p: [f64; 3]) -> R<Vector3> {
    Ok([b(p[0])?, b(p[1])?, b(p[2])?])
}
fn v2(p: [f64; 2]) -> R<Vector2> {
    Ok([b(p[0])?, b(p[1])?])
}
fn domain(t: f64) -> R<Domain> {
    Ok(Domain {
        lower: Limit::Finite { value: b(0.)?, closed: true },
        upper: Limit::Finite { value: b(t)?, closed: true },
    })
}
pub(crate) fn turns(angle: Iv) -> R<f64> {
    Ok(finite(angle / (Iv::point(2.) * wc::pi()))?.mid())
}
/// The circular chart of a piece: `None` for lines and splines. The match has
/// no wildcard arm, so a new carrier needs an explicit serialization decision.
/// Splines are serialized through their own WC0 chart.
fn circle_chart(seg: &wc::Trimmed) -> R<Option<&wc::Circle>> {
    match seg.chart() {
        wc::Chart::Line => Ok(None),
        wc::Chart::Circle(c) => Ok(Some(c)),
        wc::Chart::BSpline(_) => Ok(None),
    }
}
pub(crate) fn build(
    key: BodyKey,
    frames: Vec<Frame>,
    constructions: Vec<Construction>,
    root: NodeId,
    s: &Stack,
) -> R<(Body, Brep)> {
    let arr = &s.arr;
    let m = s.slabs();
    let mut ids = BTreeMap::<Patch, usize>::new();
    let mut patches = vec![];
    let mut orient = vec![];
    for e in 0..arr.pieces.len() {
        for j in 0..m {
            let (l, r) = (s.at(arr.face[2 * e], j as isize), s.at(arr.face[2 * e + 1], j as isize));
            if l != r {
                ids.insert(Patch::Side(e, j), patches.len());
                patches.push(Patch::Side(e, j));
                orient.push(l);
            }
        }
    }
    for k in 0..arr.cells.len() {
        for j in 0..=m {
            let (below, above) = (s.at(k, j as isize - 1), s.at(k, j as isize));
            if below != above {
                ids.insert(Patch::Cap(k, j), patches.len());
                patches.push(Patch::Cap(k, j));
                orient.push(below);
            }
        }
    }
    let mut parent = (0..patches.len()).collect::<Vec<_>>();
    let mut merged = BTreeSet::new();
    let mut union = |parent: &mut Vec<usize>, a: usize, b: usize| {
        merged.insert((a.min(b), a.max(b)));
        let (a, b) = (find(parent, a), find(parent, b));
        parent[a] = b;
    };
    let side = |e: usize, j: usize| ids.get(&Patch::Side(e, j)).copied();
    let cap = |k: usize, j: usize| if k == UNBOUNDED { None } else { ids.get(&Patch::Cap(k, j)).copied() };
    let mut incident = vec![vec![]; arr.points.len()];
    for (e, p) in arr.pieces.iter().enumerate() {
        incident[p.v[0]].push(e);
        if !p.is_ring() {
            incident[p.v[1]].push(e);
        }
    }
    for e in 0..arr.pieces.len() {
        for j in 0..m.saturating_sub(1) {
            if let (Some(a), Some(c)) = (side(e, j), side(e, j + 1)) {
                if orient[a] == orient[c] {
                    union(&mut parent, a, c);
                }
            }
        }
        for j in 0..=m {
            let (kl, kr) = (arr.face[2 * e], arr.face[2 * e + 1]);
            if let (Some(a), Some(c)) = (cap(kl, j), cap(kr, j)) {
                if orient[a] == orient[c] {
                    union(&mut parent, a, c);
                }
            }
        }
    }
    let continues = |e1: usize, e2: usize, v: usize| {
        let (p, q) = (&arr.pieces[e1], &arr.pieces[e2]);
        p.shares_source(q) && ((p.v[1] == v && q.v[0] == v) || (q.v[1] == v && p.v[0] == v))
    };
    for v in 0..arr.points.len() {
        for j in 0..m {
            let sides = incident[v].iter().filter_map(|&e| side(e, j).map(|p| (e, p))).collect::<Vec<_>>();
            if let [(e1, a), (e2, c)] = sides.as_slice() {
                if orient[*a] == orient[*c] && continues(*e1, *e2, v) {
                    union(&mut parent, *a, *c);
                }
            }
        }
    }
    // A merged side may wrap a periodic source carrier, even when that side
    // has a window in some slabs. Choose one existing source vertex away from
    // all carrier junctions as its chart anchor and retain the vertical seam.
    // This is a carrier/topology rule, not a keyway or cylinder-part path.
    let mut side_pieces = BTreeMap::<usize, BTreeSet<usize>>::new();
    for (i, patch) in patches.iter().enumerate() {
        if let Patch::Side(e, _) = patch {
            side_pieces.entry(find(&mut parent, i)).or_default().insert(*e);
        }
    }
    let mut periodic_anchor = BTreeMap::<usize, usize>::new();
    for (g, set) in &side_pieces {
        let circular = set.iter().map(|&e| circle_chart(&arr.pieces[e].seg).map(|c| c.is_some()))
            .collect::<R<Vec<_>>>()?.into_iter().all(|c| c);
        if circular
            && set.iter().all(|&e| set.iter().any(|&q| arr.pieces[q].v[1] == arr.pieces[e].v[0])) {
            let anchor = set.iter().map(|&e| arr.pieces[e].v[0]).filter(|&v| {
                let es = &incident[v];
                es.len() == 1 && arr.pieces[es[0]].is_ring()
                    || es.len() == 2 && arr.pieces[es[0]].shares_source(&arr.pieces[es[1]])
            }).min().or_else(|| set.iter().map(|&e| arr.pieces[e].v[0]).min())
                .ok_or_else(|| no("periodic-chart-anchor"))?;
            periodic_anchor.insert(*g, anchor);
        }
    }
    // Candidate edges with exactly two patch uses; `forward` is relative to
    // the canonical piece direction (horizontal) or upward (vertical).
    let mut reals = vec![];
    let mut admit = |parent: &mut Vec<usize>, geom: EdgeGeom, start, end, uses: Vec<Use>| -> R<()> {
        match uses.as_slice() {
            [] => Ok(()),
            [a, c] => {
                if a.1 == c.1 {
                    return Err(no("orientation-inconsistent"));
                }
                if a.0 == c.0 {
                    // One patch on both sides of an edge: the seam of a periodic face.
                    reals.push(Real { geom, start, end, uses: [*a, *c] });
                    return Ok(());
                }
                if find(parent, a.0) == find(parent, c.0) {
                    let g = find(parent, a.0);
                    if matches!(&geom, EdgeGeom::Vertical { vertex, .. } if periodic_anchor.get(&g) == Some(vertex)) {
                        reals.push(Real { geom, start, end, uses: [*a, *c] });
                        return Ok(());
                    }
                    if merged.contains(&(a.0.min(c.0), a.0.max(c.0))) {
                        return Ok(());
                    }
                    return Err(no("closed-face-band"));
                }
                reals.push(Real { geom, start, end, uses: [*a, *c] });
                Ok(())
            }
            _ => Err(crate::polyhedron::Refused::geometric_verdict(no("non-manifold-result").0)),
        }
    };
    for (e, piece) in arr.pieces.iter().enumerate() {
        let (kl, kr) = (arr.face[2 * e], arr.face[2 * e + 1]);
        for j in 0..=m {
            let mut uses = vec![];
            if j < m {
                if let Some(p) = side(e, j) {
                    uses.push((p, orient[p]));
                }
            }
            if j > 0 {
                if let Some(p) = side(e, j - 1) {
                    uses.push((p, !orient[p]));
                }
            }
            if let Some(p) = cap(kl, j) {
                uses.push((p, orient[p]));
            }
            if let Some(p) = cap(kr, j) {
                uses.push((p, !orient[p]));
            }
            admit(&mut parent, EdgeGeom::Horizontal { level: j, pieces: vec![e] }, (piece.v[0], j), (piece.v[1], j), uses)?;
        }
    }
    for v in 0..arr.points.len() {
        for j in 0..m {
            let uses = incident[v]
                .iter()
                .filter_map(|&e| side(e, j).map(|p| (e, p)))
                .flat_map(|(e, p)| {
                    if arr.pieces[e].is_ring() {
                        // The ring ends and starts at its anchor: the seam is used both ways.
                        vec![(p, orient[p]), (p, !orient[p])]
                    } else if arr.pieces[e].v[1] == v {
                        vec![(p, orient[p])]
                    } else {
                        vec![(p, !orient[p])]
                    }
                })
                .collect::<Vec<_>>();
            admit(&mut parent, EdgeGeom::Vertical { vertex: v, span: [j, j + 1] }, (v, j), (v, j + 1), uses)?;
        }
    }
    let group = |parent: &mut Vec<usize>, u: Use| (find(parent, u.0), u.1);
    // Merge edge chains through vertices that have exactly these two edges.
    let mut at = BTreeMap::<(usize, usize), Vec<usize>>::new();
    for (i, r) in reals.iter().enumerate() {
        at.entry(r.start).or_default().push(i);
        at.entry(r.end).or_default().push(i);
    }
    let mut next = vec![None; reals.len()];
    let mut prev = vec![None; reals.len()];
    for (key, list) in &at {
        let [a, c] = list.as_slice() else { continue };
        if a == c {
            // A ring edge alone at its anchor closes on itself; it is its own chain.
            continue;
        }
        let (a, c) = if reals[*a].end == *key { (*a, *c) } else { (*c, *a) };
        if reals[a].end != *key || reals[c].start != *key {
            continue;
        }
        let same_carrier = match (&reals[a].geom, &reals[c].geom) {
            (EdgeGeom::Vertical { .. }, EdgeGeom::Vertical { .. }) => true,
            (EdgeGeom::Horizontal { pieces: p, .. }, EdgeGeom::Horizontal { pieces: q, .. }) => {
                arr.pieces[*p.last().unwrap()].shares_source(&arr.pieces[q[0]])
            }
            _ => false,
        };
        let mut ua = reals[a].uses.map(|u| group(&mut parent, u));
        let mut uc = reals[c].uses.map(|u| group(&mut parent, u));
        ua.sort();
        uc.sort();
        if same_carrier && ua == uc {
            next[a] = Some(c);
            prev[c] = Some(a);
        }
    }
    let mut edges: Vec<Real> = vec![];
    let mut seen = vec![false; reals.len()];
    for i in 0..reals.len() {
        if prev[i].is_some() || seen[i] {
            continue;
        }
        let mut chain = vec![i];
        seen[i] = true;
        while let Some(n) = next[*chain.last().unwrap()] {
            seen[n] = true;
            chain.push(n);
        }
        let first = &reals[chain[0]];
        let last = &reals[*chain.last().unwrap()];
        let geom = match &first.geom {
            EdgeGeom::Horizontal { level, .. } => EdgeGeom::Horizontal {
                level: *level,
                pieces: chain
                    .iter()
                    .flat_map(|&c| match &reals[c].geom {
                        EdgeGeom::Horizontal { pieces, .. } => pieces.clone(),
                        _ => vec![],
                    })
                    .collect(),
            },
            EdgeGeom::Vertical { vertex, span } => EdgeGeom::Vertical {
                vertex: *vertex,
                span: [
                    span[0],
                    match &last.geom {
                        EdgeGeom::Vertical { span, .. } => span[1],
                        _ => unreachable!(),
                    },
                ],
            },
            EdgeGeom::Ring { .. } | EdgeGeom::Seam { .. } => unreachable!("tool edges join after merging"),
        };
        let uses = first.uses.map(|u| group(&mut parent, u));
        edges.push(Real { geom, start: first.start, end: last.end, uses });
    }
    if seen.iter().any(|x| !x) {
        return Err(no("closed-edge-chain"));
    }
    // Faces: one per patch group, in first-patch order.
    let mut face_of = BTreeMap::<usize, usize>::new();
    let mut faces: Vec<FaceInfo> = vec![];
    for (i, p) in patches.iter().enumerate() {
        let g = find(&mut parent, i);
        let f = *face_of.entry(g).or_insert_with(|| {
            faces.push(FaceInfo {
                patches: vec![],
                kind: match *p {
                    Patch::Cap(_, level) => FaceKind::Cap { level, up: orient[i] },
                    Patch::Side(..) => FaceKind::Side { left: orient[i], first: usize::MAX },
                },
                holes: vec![],
            });
            faces.len() - 1
        });
        faces[f].patches.push(*p);
    }
    for f in &mut faces {
        if let FaceKind::Side { first, .. } = &mut f.kind {
            let set = f
                .patches
                .iter()
                .filter_map(|p| if let Patch::Side(e, _) = p { Some(*e) } else { None })
                .collect::<BTreeSet<_>>();
            let heads = set
                .iter()
                .copied()
                .filter(|&e| arr.pieces[e].is_ring() || !set.iter().any(|&o| arr.pieces[o].v[1] == arr.pieces[e].v[0]))
                .collect::<Vec<_>>();
            *first = match heads.as_slice() {
                [head] => *head,
                [] => {
                    let group = find(&mut parent, ids[&f.patches[0]]);
                    let anchor = periodic_anchor.get(&group).ok_or_else(|| no("closed-face-band"))?;
                    *set.iter().find(|&&e| arr.pieces[e].v[0] == *anchor).ok_or_else(|| no("closed-face-band"))?
                }
                _ => return Err(no("closed-face-band")),
            };
        }
    }
    let mut coedges = vec![vec![]; faces.len()];
    for (i, r) in edges.iter().enumerate() {
        for &(g, forward) in &r.uses {
            coedges[face_of[&g]].push((i, forward));
        }
    }
    // Loops per face; a vertex with two outgoing uses in one face is a pinch.
    let mut loops_of = vec![];
    for (f, uses) in coedges.iter().enumerate() {
        let ends = |&(i, fw): &(usize, bool)| {
            let r = &edges[i];
            if fw { (r.start, r.end) } else { (r.end, r.start) }
        };
        // An edge used twice by one face is its seam. Around a seam vertex the
        // boundary alternates between the seam and the other edges.
        let seam = |&(i, _): &Use| uses.iter().filter(|o| o.0 == i).count() == 2;
        let mut from = BTreeMap::<(usize, usize), Vec<usize>>::new();
        for (k, u) in uses.iter().enumerate() {
            from.entry(ends(u).0).or_default().push(k);
        }
        for list in from.values() {
            let seams = list.iter().filter(|&&k| seam(&uses[k])).count();
            if list.len() > 2 || (list.len() == 2 && seams != 1) {
                return Err(no("pinched-face"));
            }
        }
        let mut used = vec![false; uses.len()];
        let mut loops = vec![];
        for startk in 0..uses.len() {
            if used[startk] {
                continue;
            }
            let mut lp = vec![];
            let mut k = startk;
            while !used[k] {
                used[k] = true;
                lp.push(uses[k]);
                let out = from.get(&ends(&uses[k]).1).ok_or_else(|| no("open-face-loop"))?;
                k = match out.as_slice() {
                    [only] => *only,
                    [x, y] => if seam(&uses[k]) != seam(&uses[*x]) { *x } else { *y },
                    _ => return Err(no("open-face-loop")),
                };
            }
            if k != startk {
                return Err(no("open-face-loop"));
            }
            loops.push(lp);
        }
        // The outer loop: positive area for caps (as seen along the normal);
        // for sides, the loop through the face's lowest level.
        let outer = match faces[f].kind {
            FaceKind::Cap { up, .. } => loops
                .iter()
                .map(|lp| {
                    let segments = lp
                        .iter()
                        .flat_map(|&(i, fw)| {
                            let EdgeGeom::Horizontal { pieces, .. } = &edges[i].geom else { unreachable!() };
                            let mut segs = pieces.iter().map(|&e| arr.pieces[e].seg.clone()).collect::<Vec<_>>();
                            if !fw {
                                segs = segs.iter().rev().map(wc::Trimmed::reversed).collect();
                            }
                            segs
                        })
                        .collect();
                    Ok(wc::Cycle::new(segments).orientation()? == up)
                })
                .collect::<R<Vec<_>>>()?,
            FaceKind::Band { .. } | FaceKind::Plate { .. } => unreachable!("tool faces join after merging"),
            FaceKind::Side { .. } => {
                let low = |lp: &Vec<(usize, bool)>| lp.iter().map(|u| ends(u).0 .1).min().unwrap();
                let lowest = loops.iter().map(low).min().unwrap();
                loops.iter().map(|lp| low(lp) == lowest).collect()
            }
        };
        if outer.iter().filter(|x| **x).count() != 1 {
            return Err(no("face-outer-loop"));
        }
        let mut ordered = vec![];
        for (lp, o) in loops.into_iter().zip(outer) {
            if o {
                ordered.insert(0, lp);
            } else {
                ordered.push(lp);
            }
        }
        loops_of.push(ordered);
    }
    // Unified edges (geometry, start, end); tool layers append rings,
    // seams, bands and plates and sew rings into base caps as inner loops.
    let mut all: Vec<(EdgeGeom, VKey, VKey)> = edges
        .iter()
        .map(|r| (r.geom.clone(), VKey::Grid(r.start.0, r.start.1), VKey::Grid(r.end.0, r.end.1)))
        .collect();
    let ccw = |e: [usize; 2]| vec![(e[0], true), (e[1], true)];
    let cw = |e: [usize; 2]| vec![(e[1], false), (e[0], false)];
    for (t, tool) in s.tools.iter().enumerate() {
        let mut ring = vec![[0usize; 2]; tool.rings.len()];
        for (ri, halves) in ring.iter_mut().enumerate() {
            for h in 0..2 {
                halves[h] = all.len();
                all.push((EdgeGeom::Ring { tool: t, ring: ri, half: h }, VKey::Ring(t, ri, h), VKey::Ring(t, ri, 1 - h)));
            }
        }
        for (b, &[lo, hi]) in tool.bands.iter().enumerate() {
            let seam = [all.len(), all.len() + 1];
            for angle in 0..2 {
                all.push((EdgeGeom::Seam { tool: t, band: b, angle }, VKey::Ring(t, lo, angle), VKey::Ring(t, hi, angle)));
            }
            for half in 0..2 {
                faces.push(FaceInfo { patches: vec![], kind: FaceKind::Band { tool: t, band: b, half }, holes: vec![] });
                loops_of.push(vec![vec![(ring[lo][half], false), (seam[half], true), (ring[hi][half], true), (seam[1 - half], false)]]);
            }
        }
        for (pi, plate) in tool.plates.iter().enumerate() {
            faces.push(FaceInfo { patches: vec![], kind: FaceKind::Plate { tool: t, plate: pi }, holes: vec![] });
            let mut loops = vec![if plate.up { ccw(ring[plate.outer]) } else { cw(ring[plate.outer]) }];
            if let Some(i) = plate.inner {
                loops.push(if plate.up { cw(ring[i]) } else { ccw(ring[i]) });
            }
            loops_of.push(loops);
        }
        for &(ri, level) in &tool.loops {
            let f = faces
                .iter()
                .position(|f| f.patches.contains(&Patch::Cap(tool.cell, level)))
                .ok_or_else(|| no("tool-cap-face"))?;
            let FaceKind::Cap { up, .. } = faces[f].kind else { return Err(no("tool-cap-face")) };
            loops_of[f].push(if up { cw(ring[ri]) } else { ccw(ring[ri]) });
            faces[f].holes.push((t, ri));
        }
    }
    // Every edge bounds exactly two faces with opposite senses.
    let mut users = vec![vec![]; all.len()];
    for (f, loops) in loops_of.iter().enumerate() {
        for &(e, fw) in loops.iter().flatten() {
            users[e].push((f, fw));
        }
    }
    if users.iter().any(|u| u.len() != 2 || u[0].1 == u[1].1) {
        return Err(no("tool-edge-uses"));
    }
    // Shell connectivity: a second component would be an enclosed void.
    {
        let mut fp = (0..faces.len()).collect::<Vec<_>>();
        for u in &users {
            let (a, c) = (find(&mut fp, u[0].0), find(&mut fp, u[1].0));
            fp[a] = c;
        }
        let root = find(&mut fp, 0);
        if (0..faces.len()).any(|f| find(&mut fp, f) != root) {
            return Err(no("enclosed-void"));
        }
    }
    // ---- WC0 serialization
    let mut vindex = BTreeMap::<VKey, usize>::new();
    let mut vertices = vec![];
    for r in &all {
        for k in [r.1, r.2] {
            vindex.entry(k).or_insert_with(|| {
                vertices.push(k);
                vertices.len() - 1
            });
        }
    }
    let xy = |v: usize| -> R<[f64; 2]> { Ok(arr.points[v].cache()?) };
    let zf = |j: usize| -> R<f64> { Ok(enclose(&s.levels[j])?.m) };
    let ring_at = |t: usize, ri: usize, a: usize| -> R<[f64; 3]> {
        let tool = &s.tools[t];
        let [z, r] = &tool.rings[ri];
        let x = if a == 0 { &tool.c[0] + r } else { &tool.c[0] - r };
        Ok([enclose(&x)?.m, enclose(&tool.c[1])?.m, enclose(z)?.m])
    };
    let point = |k: VKey| -> R<[f64; 3]> {
        match k {
            VKey::Grid(v, j) => {
                let p = xy(v)?;
                Ok([p[0], p[1], zf(j)?])
            }
            VKey::Ring(t, ri, a) => ring_at(t, ri, a),
        }
    };
    let tool_c = |t: usize| -> R<[f64; 2]> { crate::prism_stack::cache(&s.tools[t].c) };
    let ring_zr = |t: usize, ri: usize| -> R<[f64; 2]> {
        let [z, r] = &s.tools[t].rings[ri];
        Ok([enclose(z)?.m, enclose(r)?.m])
    };
    let fid = constructions[root.0 as usize].frame;
    let prov = Provenance::Construction { node: root };
    let mut body = Body {
        key,
        frames,
        constructions,
        vertices: vec![],
        curves: vec![],
        surfaces: vec![],
        pcurves: vec![],
        edges: vec![],
        coedges: vec![],
        loops: vec![],
        faces: vec![],
        shells: vec![],
        solids: vec![],
        facts: vec![],
        budgets: vec![],
    };
    for &k in &vertices {
        body.vertices.push(Vertex { point: v3(point(k)?)?, frame: fid, provenance: prov.clone() });
    }
    // Circle data of a piece: centre, radius, unit radial at a point.
    let circle = |e: usize| -> R<Option<([f64; 2], f64, Iv)>> {
        let Some(c) = circle_chart(&arr.pieces[e].seg)? else { return Ok(None) };
        let r = c.radius()?;
        Ok(Some((c.centre_cache()?, r.mid(), r)))
    };
    let radial = |e: usize, p: &wc::ExactPoint| -> R<[f64; 2]> {
        Ok(circle_chart(&arr.pieces[e].seg)?.unwrap().radial(p)?)
    };
    // Surfaces, one per face.
    let mut side_chart = vec![None; faces.len()];
    for (f, face) in faces.iter().enumerate() {
        let geometry = match face.kind {
            FaceKind::Cap { level, up } => SurfaceGeometry::Plane {
                origin: v3([0., 0., zf(level)?])?,
                normal: v3([0., 0., if up { 1. } else { -1. }])?,
                x: v3([1., 0., 0.])?,
            },
            FaceKind::Side { left, first } => {
                let piece = &arr.pieces[first];
                let p0 = &arr.points[piece.v[0]];
                if matches!(piece.seg.chart(), wc::Chart::BSpline(_)) {
                    // A lower boundary edge on this carrier is the swept curve.
                    let curve = all.iter().enumerate().filter_map(|(i, (g, _, _))| {
                        match g {
                            EdgeGeom::Horizontal { level, pieces } if pieces.contains(&first) => Some((*level, i)),
                            _ => None,
                        }
                    }).min().ok_or_else(|| no("spline-side-without-boundary"))?;
                    side_chart[f] = Some((first, [0., zf(curve.0)?], [0.; 2]));
                    SurfaceGeometry::LinearExtrusion { curve: CurveId(curve.1 as u32), direction: v3([0., 0., 1.])? }
                } else if let Some((c, r, _)) = circle(first)? {
                    let x = radial(first, p0)?;
                    side_chart[f] = Some((first, [0.; 2], [0.; 2]));
                    SurfaceGeometry::Cylinder { origin: v3([c[0], c[1], 0.])?, axis: v3([0., 0., 1.])?, x: v3([x[0], x[1], 0.])?, radius: b(r)? }
                } else {
                    let [dx, dy] = arr.points[piece.v[1]].enclosed_difference(p0)?;
                    let len = finite(dx.norm3(dy, Iv::point(0.)))?;
                    let t = [finite(dx / len)?.mid(), finite(dy / len)?.mid()];
                    let (n, x) = if left { ([t[1], -t[0]], t) } else { ([-t[1], t[0]], [-t[0], -t[1]]) };
                    let o = xy(piece.v[0])?;
                    side_chart[f] = Some((first, o, x));
                    SurfaceGeometry::Plane { origin: v3([o[0], o[1], 0.])?, normal: v3([n[0], n[1], 0.])?, x: v3([x[0], x[1], 0.])? }
                }
            }
            FaceKind::Band { tool, band, half } => {
                let [lo, hi] = s.tools[tool].bands[band];
                let (c, a, e) = (tool_c(tool)?, ring_zr(tool, lo)?, ring_zr(tool, hi)?);
                let x = v3([if half == 0 { 1. } else { -1. }, 0., 0.])?;
                let (origin, axis) = (v3([c[0], c[1], 0.])?, v3([0., 0., 1.])?);
                if s.tools[tool].rings[lo][1] == s.tools[tool].rings[hi][1] {
                    SurfaceGeometry::Cylinder { origin, axis, x, radius: b(a[1])? }
                } else {
                    SurfaceGeometry::ConeMeridian { origin, axis, x, start: v2([a[1], a[0]])?, end: v2([e[1], e[0]])? }
                }
            }
            FaceKind::Plate { tool, plate } => {
                let p = &s.tools[tool].plates[plate];
                SurfaceGeometry::Plane {
                    origin: v3([0., 0., ring_zr(tool, p.outer)?[0]])?,
                    normal: v3([0., 0., if p.up { 1. } else { -1. }])?,
                    x: v3([1., 0., 0.])?,
                }
            }
        };
        body.surfaces.push(Surface { frame: fid, provenance: prov.clone(), geometry });
    }
    // Curves and edges.
    let mut domains = vec![];
    let mut edge_domain = vec![];
    for (geom, start, end) in &all {
        let spline = match geom {
            EdgeGeom::Horizontal { pieces, .. } => match arr.pieces[pieces[0]].seg.chart() {
                wc::Chart::BSpline(k) => Some(crate::arc_profile_brep::Spline::mapped(k)?),
                wc::Chart::Line | wc::Chart::Circle(_) => None,
            },
            _ => None,
        };
        let (geometry, dom) = if let (Some(sp), EdgeGeom::Horizontal { level, .. }) = (&spline, geom) {
            (CurveGeometry::BSpline {
                degree: sp.degree, knots: sp.knots.iter().map(|&x| b(x)).collect::<R<_>>()?,
                controls: sp.controls.iter().map(|p| v3([p[0], p[1], zf(*level)?])).collect::<R<_>>()?,
                weights: vec![], periodic: false,
            }, 1.)
        } else { match geom {
            EdgeGeom::Vertical { .. } | EdgeGeom::Seam { .. } => {
                (CurveGeometry::Line { a: v3(point(*start)?)?, b: v3(point(*end)?)? }, 1.)
            }
            EdgeGeom::Ring { tool, ring, half } => {
                let (c, [z, r]) = (tool_c(*tool)?, ring_zr(*tool, *ring)?);
                (
                    CurveGeometry::Circle {
                        origin: v3([c[0], c[1], z])?,
                        normal: v3([0., 0., 1.])?,
                        x: v3([if *half == 0 { 1. } else { -1. }, 0., 0.])?,
                        radius: b(r)?,
                        arc: ArcKind::Trimmed {},
                    },
                    0.5,
                )
            }
            EdgeGeom::Horizontal { level, pieces } => match circle(pieces[0])? {
                None => (CurveGeometry::Line { a: v3(point(*start)?)?, b: v3(point(*end)?)? }, 1.),
                Some((c, radius, _)) => {
                    let (VKey::Grid(sv, _), VKey::Grid(ev, _)) = (*start, *end) else { return Err(no("edge-key")) };
                    let start = &arr.points[sv];
                    let x = radial(pieces[0], start)?;
                    let cc = circle_chart(&arr.pieces[pieces[0]].seg)?.unwrap();
                    // Only a ring starts and ends at one vertex; it is the whole circle.
                    let (t, arc) = if sv == ev {
                        (1., ArcKind::Full {})
                    } else {
                        (turns(cc.sweep(start, &arr.points[ev])?)?, ArcKind::Trimmed {})
                    };
                    (
                        CurveGeometry::Circle {
                            origin: v3([c[0], c[1], zf(*level)?])?,
                            normal: v3([0., 0., 1.])?,
                            x: v3([x[0], x[1], 0.])?,
                            radius: b(radius)?,
                            arc,
                        },
                        t,
                    )
                }
            },
        }
        };
        let (curve_domain, edge_span) = if let Some(sp) = &spline {
            let EdgeGeom::Horizontal { pieces, .. } = geom else { unreachable!() };
            let wc::Chart::BSpline(last) = arr.pieces[*pieces.last().unwrap()].seg.chart() else { unreachable!() };
            let span = Domain {
                lower: Limit::Finite { value: b(sp.from)?, closed: true },
                upper: Limit::Finite { value: b(enclose(&last.to)?.m)?, closed: true },
            };
            (sp.domain()?, span)
        } else { (domain(dom)?, domain(dom)?) };
        let cid = CurveId(body.curves.len() as u32);
        body.curves.push(Curve { frame: fid, provenance: prov.clone(), geometry, domain: curve_domain, supports: vec![] });
        body.edges.push(Edge { curve: cid, domain: edge_span.clone(), vertices: vec![VertexId(vindex[start] as u32), VertexId(vindex[end] as u32)] });
        domains.push(edge_span);
        edge_domain.push(dom);
    }
    // Pcurves, coedges, loops, faces.
    let periodic_faces = faces.iter().map(|face| {
        matches!(face.kind, FaceKind::Side { first, .. } if arr.pieces[first].is_ring())
            || face.patches.first().is_some_and(|p| periodic_anchor.contains_key(&find(&mut parent, ids[p])))
    }).collect::<Vec<_>>();
    let periodic = |f: usize| periodic_faces[f];
    for (f, face) in faces.iter().enumerate() {
        let mut lids = vec![];
        for (li, lp) in loops_of[f].iter().enumerate() {
            let mut uses = vec![];
            for &(i, forward) in lp {
                let (geom, start, end) = &all[i];
                let grid = |k: &VKey| match *k {
                    VKey::Grid(v, j) => Ok((v, j)),
                    VKey::Ring(..) => Err(no("edge-key")),
                };
                let plane_up = match face.kind {
                    FaceKind::Cap { up, .. } => Some(up),
                    FaceKind::Plate { tool, plate } => Some(s.tools[tool].plates[plate].up),
                    _ => None,
                };
                let geometry = match (face.kind.clone(), plane_up) {
                    (_, Some(up)) => {
                        let sign = if up { 1. } else { -1. };
                        let chart = |p: [f64; 2]| [p[0], sign * p[1]];
                        match geom {
                            EdgeGeom::Ring { tool, ring, half } => {
                                let (c, [_, r]) = (tool_c(*tool)?, ring_zr(*tool, *ring)?);
                                PcurveGeometry::CircularArc {
                                    center: v2(chart(c))?,
                                    x: v2(chart([if *half == 0 { 1. } else { -1. }, 0.]))?,
                                    radius: b(r)?,
                                    clockwise: !up,
                                }
                            }
                            EdgeGeom::Horizontal { pieces, .. } => {
                                let (sv, ev) = (grid(start)?.0, grid(end)?.0);
                                if let wc::Chart::BSpline(k) = arr.pieces[pieces[0]].seg.chart() {
                                    let sp = crate::arc_profile_brep::Spline::mapped(k)?;
                                    PcurveGeometry::BSpline {
                                        degree: sp.degree, knots: sp.knots.iter().map(|&x| b(x)).collect::<R<_>>()?,
                                        controls: sp.controls.iter().map(|&p| v2(chart(p))).collect::<R<_>>()?, weights: vec![],
                                    }
                                } else { match circle(pieces[0])? {
                                    None => PcurveGeometry::Line { a: v2(chart(xy(sv)?))?, b: v2(chart(xy(ev)?))? },
                                    Some((c, radius, _)) => PcurveGeometry::CircularArc {
                                        center: v2(chart(c))?,
                                        x: v2(chart(radial(pieces[0], &arr.points[sv])?))?,
                                        radius: b(radius)?,
                                        clockwise: !up,
                                    },
                                } }
                            }
                            _ => return Err(no("cap-edge")),
                        }
                    }
                    (FaceKind::Side { left, first }, None) if periodic(f)
                        && (start == end || matches!(geom, EdgeGeom::Vertical { vertex, .. } if *vertex == arr.pieces[first].v[0])) => {
                        // Unrolled over u in [0, 1]: rings run the whole interval, the
                        // seam sits at its end where the coedge agrees with the face.
                        let z = |k: &VKey| -> R<f64> { zf(grid(k)?.1) };
                        let u = if forward == left { 1. } else { 0. };
                        match geom {
                            EdgeGeom::Horizontal { .. } => PcurveGeometry::Line { a: v2([0., z(start)?])?, b: v2([1., z(end)?])? },
                            EdgeGeom::Vertical { .. } => PcurveGeometry::Line { a: v2([u, z(start)?])?, b: v2([u, z(end)?])? },
                            EdgeGeom::Ring { .. } | EdgeGeom::Seam { .. } => return Err(no("side-edge")),
                        }
                    }
                    (FaceKind::Band { tool, half, .. }, None) => {
                        let (a, e) = match geom {
                            EdgeGeom::Ring { ring, .. } => {
                                let z = ring_zr(tool, *ring)?[0];
                                ([0., z], [0.5, z])
                            }
                            EdgeGeom::Seam { band, angle, .. } => {
                                let [lo, hi] = s.tools[tool].bands[*band];
                                let u = if *angle == half { 0. } else { 0.5 };
                                ([u, ring_zr(tool, lo)?[0]], [u, ring_zr(tool, hi)?[0]])
                            }
                            _ => return Err(no("band-edge")),
                        };
                        PcurveGeometry::Line { a: v2(a)?, b: v2(e)? }
                    }
                    _ => {
                        let (first, o, x) = side_chart[f].unwrap();
                        let along = |k: (usize, usize)| -> R<[f64; 2]> {
                            let z = zf(k.1)?;
                            if matches!(arr.pieces[first].seg.chart(), wc::Chart::BSpline(_)) {
                                let t = arr.pieces.iter().filter(|p| p.shares_source(&arr.pieces[first]))
                                    .find_map(|p| match p.seg.chart() {
                                        wc::Chart::BSpline(s) if p.v[0] == k.0 => Some(&s.from),
                                        wc::Chart::BSpline(s) if p.v[1] == k.0 => Some(&s.to),
                                        _ => None,
                                    }).ok_or_else(|| no("spline-side-parameter"))?;
                                Ok([enclose(t)?.m, z - o[1]])
                            } else if let Some(c) = circle_chart(&arr.pieces[first].seg)? {
                                let p0 = &arr.points[arr.pieces[first].v[0]];
                                Ok([turns(c.sweep(p0, &arr.points[k.0])?)?, z])
                            } else {
                                let p = xy(k.0)?;
                                Ok([(p[0] - o[0]) * x[0] + (p[1] - o[1]) * x[1], z])
                            }
                        };
                        let a = along(grid(start)?)?;
                        let mut e = along(grid(end)?)?;
                        if periodic(f) && matches!(geom, EdgeGeom::Horizontal { .. }) {
                            // Lift the end into the same unrolled chart as the 3D
                            // edge. Its domain is the certified positive sweep;
                            // reducing each end modulo one loses seam crossings.
                            e[0] = a[0] + edge_domain[i];
                        }
                        PcurveGeometry::Line { a: v2(a)?, b: v2(e)? }
                    }
                };
                let pc = PcurveId(body.pcurves.len() as u32);
                body.pcurves.push(Pcurve { curve: CurveId(i as u32), surface: SurfaceId(f as u32), domain: domains[i].clone(), geometry });
                body.curves[i].supports.push(Support { surface: SurfaceId(f as u32), pcurve: pc });
                uses.push(CoedgeId(body.coedges.len() as u32));
                body.coedges.push(Coedge { edge: EdgeId(i as u32), forward, pcurve: pc });
            }
            lids.push(LoopId(body.loops.len() as u32));
            body.loops.push(Loop { outer: li == 0, coedges: uses });
        }
        let forward = match face.kind {
            FaceKind::Side { left, first } => if arr.pieces[first].seg.is_curved() { left } else { true },
            FaceKind::Band { .. } => false,
            FaceKind::Cap { .. } | FaceKind::Plate { .. } => true,
        };
        body.faces.push(Face { surface: SurfaceId(f as u32), forward, loops: lids });
    }
    body.shells.push(Shell { faces: (0..faces.len()).map(|i| FaceId(i as u32)).collect() });
    body.solids.push(Solid { shells: vec![ShellId(0)] });
    body.clone().check().map_err(|e| no(&format!("contract:{e:?}")))?;
    let brep = Brep {
        faces,
        edges: all.into_iter().map(|r| r.0).collect(),
        vertices,
    };
    Ok((body, brep))
}
