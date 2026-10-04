use super::{no, Profile, R};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use wonky_curve as wc;

pub(crate) struct Regions {
    pub profiles: Vec<Profile>,
    pub open_wires: usize,
    /// CCW exterior of a single connected, fully selected bounded arrangement.
    pub outer: Option<Profile>,
    pub outer_refusal: Option<String>,
}

// A bridge appears twice, in opposite directions, on the unbounded face
// walk and belongs to no bounded region. Remove only proven identical trimmed
// carriers; a remaining repeated vertex is a pinch and must refuse.
fn exterior_without_bridges(pieces: Vec<wc::Trimmed>) -> R<Profile> {
    let mut by_endpoints = BTreeMap::<(wc::ExactPoint, wc::ExactPoint), Vec<usize>>::new();
    for (i, s) in pieces.iter().enumerate() {
        by_endpoints.entry((s.ends()[0].clone(), s.ends()[1].clone())).or_default().push(i);
    }
    let mut removed = BTreeSet::new();
    for (i, s) in pieces.iter().enumerate() {
        if removed.contains(&i) { continue; }
        let reversed = (s.ends()[1].clone(), s.ends()[0].clone());
        if let Some(matches) = by_endpoints.get(&reversed) {
            let mut twin = vec![];
            for &j in matches {
                if j != i && !removed.contains(&j) && s.retraces(&pieces[j])? { twin.push(j); }
            }
            if twin.len() > 1 { return Err(no("exterior-bridge-ambiguous")); }
            if let Some(&j) = twin.first() { removed.insert(i); removed.insert(j); }
        }
    }
    let kept = pieces.into_iter().enumerate()
        .filter_map(|(i, s)| (!removed.contains(&i)).then_some(s)).collect::<Vec<_>>();
    if kept.len() < 2 || kept.iter().enumerate().any(|(i, s)|
        s.ends()[1] != kept[(i + 1) % kept.len()].ends()[0]) {
        return Err(no("exterior-bridge-disconnect"));
    }
    let mut vertices = BTreeSet::new();
    for piece in &kept {
        if !vertices.insert(piece.ends()[0].clone()) {
            return Err(no("non-simple-exterior-walk"));
        }
    }
    Ok(Profile::from_pieces(kept))
}

pub(crate) fn solve(lines: &[[f64; 4]], arcs: &[[f64; 6]]) -> R<Regions> {
    solve_with_cap(lines, arcs, None)
}
pub(crate) fn solve_with_cap(lines: &[[f64; 4]], arcs: &[[f64; 6]], cap: Option<f64>) -> R<Regions> {
    match Profile::with_cap(lines, arcs, cap) {
        Ok(profile) => {
            return Ok(Regions {
                profiles: vec![profile],
                open_wires: 0,
                outer: None,
                outer_refusal: None,
            })
        }
        Err(e)
            if [
                "open-or-branching-chain",
                "multiple-loops",
                "line-arc-intersection",
                "arc-arc-intersection",
                "chord-intersection",
                "requires-closed-chain",
            ]
            .iter()
            .any(|reason| e.0 == format!("arc-profile/{reason}")) => {}
        Err(e) => return Err(e),
    }
    if lines.len() + arcs.len() > 512 {
        return Err(no("arrangement-entity-budget"));
    }
    if !lines
        .iter()
        .flatten()
        .chain(arcs.iter().flatten())
        .all(|x| x.is_finite())
    {
        return Err(no("nonfinite-source"));
    }
    let mut sources = super::regularize::sources(lines, arcs)?;
    if let Some(cap) = cap { super::regularize::apply(&mut sources, cap)?; }
    if sources.iter().any(|s| s.ends()[0] == s.ends()[1]) {
        return Err(no("zero-edge"));
    }
    let mut cuts = sources.iter().map(|s| s.ends().to_vec()).collect::<Vec<_>>();
    let bounds = sources.iter().map(wc::Trimmed::bounds).collect::<Result<Vec<_>, _>>()?;
    for i in 0..sources.len() {
        for j in i + 1..sources.len() {
            if (0..2)
                .any(|k| bounds[i][1][k] < bounds[j][0][k] || bounds[j][1][k] < bounds[i][0][k])
            {
                continue;
            }
            for p in sources[i].contacts(&sources[j])? {
                cuts[i].push(p.clone());
                cuts[j].push(p);
            }
        }
    }
    let mut vertices = BTreeMap::<wc::ExactPoint, usize>::new();
    let mut edges = vec![];
    let mut incidence = vec![];
    for (s, points) in sources.iter().zip(cuts) {
        let points = s.sorted_cuts(points)?;
        for pair in points.windows(2) {
            if edges.len() == 8192 {
                return Err(no("arrangement-split-budget"));
            }
            let mut ids = [0; 2];
            for k in 0..2 {
                let next = vertices.len();
                ids[k] = *vertices.entry(pair[k].clone()).or_insert(next);
            }
            incidence.push(ids);
            edges.push(s.trim(pair[0].clone(), pair[1].clone())?);
        }
    }
    let mut star = vec![vec![]; vertices.len()];
    for (i, ab) in incidence.iter().enumerate() {
        star[ab[0]].push(2 * i);
        star[ab[1]].push(2 * i + 1);
    }
    let mut degree = star.iter().map(Vec::len).collect::<Vec<_>>();
    let mut active = vec![true; edges.len()];
    let mut queue = (0..degree.len())
        .filter(|&v| degree[v] < 2)
        .collect::<VecDeque<_>>();
    while let Some(v) = queue.pop_front() {
        for &h in &star[v] {
            let i = h / 2;
            if !active[i] {
                continue;
            }
            active[i] = false;
            for &u in &incidence[i] {
                degree[u] -= 1;
                if degree[u] == 1 {
                    queue.push_back(u);
                }
            }
        }
    }
    // Count connected open remainders; never weld or extend an open endpoint.
    let mut seen = vec![false; vertices.len()];
    let mut open_wires = 0;
    for v in 0..vertices.len() {
        if seen[v] || star[v].iter().all(|h| active[h / 2]) {
            continue;
        }
        open_wires += 1;
        let mut todo = vec![v];
        seen[v] = true;
        while let Some(u) = todo.pop() {
            for &h in &star[u] {
                if active[h / 2] {
                    continue;
                }
                for &w in &incidence[h / 2] {
                    if !seen[w] {
                        seen[w] = true;
                        todo.push(w);
                    }
                }
            }
        }
    }
    for rays in &mut star {
        rays.retain(|h| active[h / 2]);
        // At a degree-two vertex the continuation is unique, even when
        // both outgoing rays coincide: two distinct carriers can bound a
        // genuine zero-angle cusp (a line tangent to a returning arc).
        // A higher-degree tangent star has no exact branch ordering.
        match wc::order(rays, |h| edges[h / 2].tangent(h % 2 == 0)) {
            wc::Star::Ordered => {}
            wc::Star::Tied => return Err(no("tangent-branch-order")),
        }
    }
    // Disconnected closed components may be nested. Until holes have an exact
    // containment/region representation, do not misreport them as filled disks.
    seen.fill(false);
    let mut components = 0;
    for v in 0..star.len() {
        if seen[v] || star[v].is_empty() {
            continue;
        }
        components += 1;
        let mut todo = vec![v];
        seen[v] = true;
        while let Some(u) = todo.pop() {
            for &h in &star[u] {
                let w = incidence[h / 2][1 - h % 2];
                if !seen[w] {
                    seen[w] = true;
                    todo.push(w);
                }
            }
        }
    }
    if components > 1 {
        return Err(no("disconnected-region-containment"));
    }
    let mut used = vec![false; 2 * edges.len()];
    let mut profiles = vec![];
    let mut outer = None;
    let mut outer_refusal = None;
    for first in 0..used.len() {
        if used[first] || !active[first / 2] {
            continue;
        }
        let mut h = first;
        let mut pieces = vec![];
        let mut visited = BTreeSet::new();
        let mut repeats = false;
        loop {
            if used[h] {
                if h == first {
                    break;
                }
                return Err(no("face-walk"));
            }
            used[h] = true;
            repeats |= !visited.insert(incidence[h / 2][h % 2]);
            pieces.push(if h % 2 == 0 {
                edges[h / 2].clone()
            } else {
                edges[h / 2].reversed()
            });
            let v = incidence[h / 2][1 - h % 2];
            let rays = &star[v];
            let twin = rays
                .iter()
                .position(|&r| r == (h ^ 1))
                .ok_or_else(|| no("face-walk"))?;
            h = rays[(twin + rays.len() - 1) % rays.len()];
        }
        let profile = Profile::from_pieces(pieces);
        // A two-edge circular segment's orientation is its arc sense, even
        // when area cancellation defeats a binary64 observation enclosure.
        let positive = profile.cycle().orientation().map_err(|e| {
            if e == wc::Refusal::UnresolvedCycleOrientation {
                no("unresolved-region-orientation")
            } else {
                e.into()
            }
        })?;
        if repeats && positive {
            return Err(no("non-simple-region-walk"));
        }
        if positive {
            profiles.push(profile);
        } else {
            // The single negative face walk is the unbounded face. Reversing
            // its EXACT trimmed segments removes all interior sketch dividers;
            // no rounded cache participates in the topology decision.
            if outer.is_some() {
                return Err(no("multiple-exterior-boundaries"));
            }
            match exterior_without_bridges(profile.cycle().reversed().pieces().to_vec()) {
                Ok(profile) => outer = Some(profile),
                Err(reason) => outer_refusal = Some(reason.0),
            }
        }
    }
    Ok(Regions {
        profiles,
        open_wires,
        outer,
        outer_refusal,
    })
}
