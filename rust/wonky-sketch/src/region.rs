//! Regions of a line-segment sketch from an undirected exact incidence graph.
//!
//! Segments arrive in any order and direction, as the interpreter's binary64
//! coordinates (E9). Two endpoints are incident only when both coordinates are
//! exactly equal (`==`, so -0 and +0 agree); there is no tolerance and no weld.
//! Every other contact (a crossing, a T-junction, a collinear overlap) is decided
//! by exact orientation predicates and refused as `UnsupportedIntersection`,
//! because splitting the arrangement into faces is not implemented here.
//!
//! A connected component whose vertices all have degree 2 is a closed loop and
//! bounds a region; a component with two degree-1 ends is an open wire and
//! bounds nothing (Onshape keeps such wires as sketch geometry, and they do not
//! form regions). A vertex of degree > 2 (a branching or self-touching sketch)
//! is refused as `Branching`. Nested loops (holes) are refused as `Nested`.
//! Whether "no region" is an error is the region consumer's decision.
use crate::Refusal;
use std::collections::BTreeMap;
use wonky_num::expansion::{mul, neg, sign, sum, Exp, Guard};
use wonky_num::{check_range, orient2d, Sign, P2};

/// One closed region boundary, counterclockwise (exact signed area > 0).
#[derive(Clone, Debug, PartialEq)]
pub struct RegionLoop {
    /// The loop's vertices in counterclockwise order, exactly the input values.
    pub points: Vec<P2>,
    /// For each boundary edge points[k] -> points[k+1]: the input segment index
    /// and whether the segment runs forward (start -> end) along the loop.
    pub uses: Vec<(usize, bool)>,
}

/// The regions and the open wires that bound nothing.
#[derive(Clone, Debug, PartialEq)]
pub struct Regions {
    pub loops: Vec<RegionLoop>,
    /// Number of open (degree-1 ended) wire components; they form no region.
    pub open_wires: usize,
}

fn orientation(a: P2, b: P2, c: P2) -> Result<Sign, Refusal> {
    orient2d(a, b, c, "sketch region orientation").map_err(|e| {
        e.into_refusal();
        Refusal::NumericDecision
    })
}

fn same(a: P2, b: P2) -> bool {
    a.x == b.x && a.y == b.y
}

/// q lies in the closed axis box of a..b (exact comparisons).
fn in_box(a: P2, b: P2, q: P2) -> bool {
    q.x >= a.x.min(b.x) && q.x <= a.x.max(b.x) && q.y >= a.y.min(b.y) && q.y <= a.y.max(b.y)
}

/// Exact: q lies on the closed segment a..b.
pub fn on_segment(a: P2, b: P2, q: P2) -> Result<bool, Refusal> {
    Ok(orientation(a, b, q)? == Sign::Zero && in_box(a, b, q))
}

/// Exact contact test of two closed segments.
fn touch(a: P2, b: P2, c: P2, d: P2) -> Result<bool, Refusal> {
    let o1 = orientation(a, b, c)?;
    let o2 = orientation(a, b, d)?;
    let o3 = orientation(c, d, a)?;
    let o4 = orientation(c, d, b)?;
    if o1 != Sign::Zero && o2 != Sign::Zero && o3 != Sign::Zero && o4 != Sign::Zero {
        return Ok(o1 != o2 && o3 != o4);
    }
    Ok((o1 == Sign::Zero && in_box(a, b, c))
        || (o2 == Sign::Zero && in_box(a, b, d))
        || (o3 == Sign::Zero && in_box(c, d, a))
        || (o4 == Sign::Zero && in_box(c, d, b)))
}

/// Two segments sharing exactly the endpoint `s` (a = s = c): they overlap
/// beyond `s` only when collinear and pointing the same way from `s`.
fn overlap_from_shared(s: P2, b: P2, d: P2) -> Result<bool, Refusal> {
    if orientation(s, b, d)? != Sign::Zero {
        return Ok(false);
    }
    // Collinear: same direction iff d lies on the ray s->b side, i.e. the
    // coordinate differences have the same signs (exact comparisons).
    let dir = |from: f64, to: f64| (to > from) as i8 - (to < from) as i8;
    Ok(dir(s.x, b.x) == dir(s.x, d.x) && dir(s.y, b.y) == dir(s.y, d.y))
}

/// Twice the signed area of a closed polygon, as an exact expansion.
pub fn signed_area2(points: &[P2]) -> Result<Exp, Refusal> {
    let mut g = Guard::new();
    let mut total: Exp = Vec::new();
    for (k, a) in points.iter().enumerate() {
        let b = points[(k + 1) % points.len()];
        // a.x*b.y - b.x*a.y
        let l = mul(&[a.x], &[b.y], &mut g);
        let r = mul(&[b.x], &[a.y], &mut g);
        total = sum(&total, &sum(&l, &neg(&r), &mut g), &mut g);
    }
    if !g.exact() {
        return Err(Refusal::NumericDecision);
    }
    Ok(total)
}

/// Exact check that a closed polygon (at least 3 vertices) is simple: no zero
/// edge, no repeated vertex, and no contact between edges other than the shared
/// endpoint of consecutive edges (which must not fold back onto each other).
pub fn simple_polygon(points: &[P2]) -> Result<(), Refusal> {
    let n = points.len();
    if n < 3 {
        return Err(Refusal::Degenerate);
    }
    let coords: Vec<f64> = points.iter().flat_map(|p| [p.x, p.y]).collect();
    check_range(&coords, "sketch region coordinate").map_err(|e| {
        e.into_refusal();
        Refusal::NumericDecision
    })?;
    for i in 0..n {
        for j in i + 1..n {
            if same(points[i], points[j]) {
                return Err(Refusal::Branching);
            }
        }
    }
    for i in 0..n {
        let (a, b) = (points[i], points[(i + 1) % n]);
        for j in i + 1..n {
            let (c, d) = (points[j], points[(j + 1) % n]);
            if j == i + 1 {
                if overlap_from_shared(b, a, d)? {
                    return Err(Refusal::UnsupportedIntersection);
                }
            } else if i == 0 && j == n - 1 {
                if overlap_from_shared(a, b, c)? {
                    return Err(Refusal::UnsupportedIntersection);
                }
            } else if touch(a, b, c, d)? {
                return Err(Refusal::UnsupportedIntersection);
            }
        }
    }
    Ok(())
}

/// Where a point lies relative to a simple closed polygon.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Location {
    Inside,
    Boundary,
    Outside,
}

/// Exact point location by the winding number (orientation predicates and
/// exact coordinate comparisons only).
pub fn locate(points: &[P2], q: P2) -> Result<Location, Refusal> {
    let mut winding = 0i64;
    for (k, &a) in points.iter().enumerate() {
        let b = points[(k + 1) % points.len()];
        if on_segment(a, b, q)? {
            return Ok(Location::Boundary);
        }
        if a.y <= q.y {
            if b.y > q.y && orientation(a, b, q)? == Sign::Positive {
                winding += 1;
            }
        } else if b.y <= q.y && orientation(a, b, q)? == Sign::Negative {
            winding -= 1;
        }
    }
    Ok(if winding == 0 { Location::Outside } else { Location::Inside })
}

/// The regions bounded by `segments` ([start, end] each).
pub fn lines_region(segments: &[[P2; 2]]) -> Result<Regions, Refusal> {
    if segments.is_empty() {
        return Err(Refusal::InvalidInput);
    }
    let coords: Vec<f64> = segments.iter().flat_map(|s| [s[0].x, s[0].y, s[1].x, s[1].y]).collect();
    if coords.iter().any(|x| !x.is_finite()) {
        return Err(Refusal::InvalidInput);
    }
    check_range(&coords, "sketch region coordinate").map_err(|e| {
        e.into_refusal();
        Refusal::NumericDecision
    })?;
    // Vertices by exact coordinate equality; -0 is keyed as +0 (they are equal).
    let key = |p: P2| ((p.x + 0.0).to_bits(), (p.y + 0.0).to_bits());
    let mut ids: BTreeMap<(u64, u64), usize> = BTreeMap::new();
    let mut vertices: Vec<P2> = Vec::new();
    let mut ends: Vec<[usize; 2]> = Vec::with_capacity(segments.len());
    for s in segments {
        if same(s[0], s[1]) {
            return Err(Refusal::Degenerate);
        }
        let mut e = [0; 2];
        for (k, p) in s.iter().enumerate() {
            e[k] = *ids.entry(key(*p)).or_insert_with(|| {
                vertices.push(*p);
                vertices.len() - 1
            });
        }
        ends.push(e);
    }
    // Exact contact tests between every pair of segments.
    for i in 0..segments.len() {
        let [a, b] = segments[i];
        for j in i + 1..segments.len() {
            let [c, d] = segments[j];
            let shared: Vec<usize> = ends[i].iter().copied().filter(|v| ends[j].contains(v)).collect();
            match shared.len() {
                2 => return Err(Refusal::UnsupportedIntersection), // duplicate edge
                1 => {
                    let s = vertices[shared[0]];
                    let far_i = if same(a, s) { b } else { a };
                    let far_j = if same(c, s) { d } else { c };
                    if overlap_from_shared(s, far_i, far_j)? {
                        return Err(Refusal::UnsupportedIntersection);
                    }
                }
                _ => {
                    if touch(a, b, c, d)? {
                        return Err(Refusal::UnsupportedIntersection);
                    }
                }
            }
        }
    }
    let mut incident: Vec<Vec<usize>> = vec![Vec::new(); vertices.len()];
    for (s, e) in ends.iter().enumerate() {
        incident[e[0]].push(s);
        incident[e[1]].push(s);
    }
    if incident.iter().any(|x| x.len() > 2) {
        return Err(Refusal::Branching);
    }
    // Components: walk each unvisited segment's component.
    let mut seen = vec![false; segments.len()];
    let mut loops = Vec::new();
    let mut open_wires = 0;
    for first in 0..segments.len() {
        if seen[first] {
            continue;
        }
        // Collect the component.
        let mut stack = vec![first];
        let mut component = Vec::new();
        seen[first] = true;
        while let Some(s) = stack.pop() {
            component.push(s);
            for v in ends[s] {
                for &t in &incident[v] {
                    if !seen[t] {
                        seen[t] = true;
                        stack.push(t);
                    }
                }
            }
        }
        let closed = component.iter().all(|&s| ends[s].iter().all(|&v| incident[v].len() == 2));
        if !closed {
            open_wires += 1;
            continue;
        }
        // Walk the cycle from the smallest segment index, forward.
        let start = *component.iter().min().expect("nonempty component");
        let mut uses = vec![(start, true)];
        let mut at = ends[start][1];
        let mut previous = start;
        while at != ends[start][0] {
            let next = *incident[at].iter().find(|&&t| t != previous).expect("degree 2");
            let forward = ends[next][0] == at;
            uses.push((next, forward));
            at = if forward { ends[next][1] } else { ends[next][0] };
            previous = next;
        }
        let point = |&(s, forward): &(usize, bool)| vertices[ends[s][if forward { 0 } else { 1 }]];
        let mut points: Vec<P2> = uses.iter().map(point).collect();
        let area = sign(&signed_area2(&points)?);
        if area == 0 {
            return Err(Refusal::Degenerate);
        }
        if area < 0 {
            // Traverse the same cycle backwards: edge k of the reversed loop is
            // the original edge (m-1-k), run in the opposite sense.
            uses = uses.iter().rev().map(|&(s, forward)| (s, !forward)).collect();
            points = uses.iter().map(point).collect();
        }
        loops.push(RegionLoop { points, uses });
    }
    // Nesting: with no contacts, one vertex decides containment exactly.
    for i in 0..loops.len() {
        for j in 0..loops.len() {
            if i != j && locate(&loops[j].points, loops[i].points[0])? != Location::Outside {
                return Err(Refusal::Nested);
            }
        }
    }
    Ok(Regions { loops, open_wires })
}
