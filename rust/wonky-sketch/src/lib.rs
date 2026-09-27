//! Construction-aware 2D profiles. Coordinates are millimetres in a sketch plane.
//! Endpoint identity is a supplied construction key, never an epsilon cluster.
//! The caller must preserve the key through transforms and solver operations.
mod arc_area;
pub mod region;
pub mod circle_region;

use num_rational::BigRational;
use num_traits::Zero;
use std::collections::{HashMap, HashSet};
use wonky_num::expansion::{difference, mul, neg, product, sign, sum, Exp, Guard};
use wonky_num::{check_range, orient2d, Sign, P2};

#[derive(Clone, Copy, Debug)]
pub struct Point<'a> {
    pub key: &'a str,
    pub xy: P2,
}

#[derive(Clone, Copy, Debug)]
pub enum Primitive<'a> {
    Line {
        start: Point<'a>,
        end: Point<'a>,
    },
    Arc3 {
        start: Point<'a>,
        mid: P2,
        end: Point<'a>,
    },
    Circle {
        center: Point<'a>,
        radius: f64,
    },
}

#[derive(Clone, Copy, Debug)]
pub enum Constraint<'a> {
    Coincident {
        a: &'a str,
        b: &'a str,
    },
    Distance {
        a: &'a str,
        b: &'a str,
        mm: f64,
    },
    /// Incidence witness: the line through a,b has exactly zero orientation at c.
    /// Geometric near-tangency is NOT a witness. Exact point incidence is required.
    TangentLineCircle {
        line_start: &'a str,
        line_end: &'a str,
        circle_center: &'a str,
        at: &'a str,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Refusal {
    InvalidInput,
    Underconstrained,
    Overconstrained,
    OpenProfile,
    Branching,
    Degenerate,
    AmbiguousOrientation,
    UnsupportedIntersection,
    UncertifiedTangency,
    NumericDecision,
    /// A closed loop lies inside another (a region with a hole); not implemented
    /// by the line-region solver.
    Nested,
}

#[derive(Clone, Debug)]
pub struct Loop<'a> {
    pub segment_indices: Vec<usize>,
    pub orientation: Sign,
    pub keys: Vec<&'a str>,
}
#[derive(Clone, Debug)]
pub struct Profile<'a> {
    pub loops: Vec<Loop<'a>>,
    /// Coordinates after explicit construction coincidences and dimensions.
    pub solved_points: HashMap<&'a str, P2>,
}

fn checked(v: &[f64]) -> Result<(), Refusal> {
    check_range(v, "sketch coordinate").map_err(|e| {
        e.into_refusal();
        Refusal::NumericDecision
    })
}
fn orientation(a: P2, b: P2, c: P2) -> Result<Sign, Refusal> {
    orient2d(a, b, c, "sketch orientation").map_err(|e| {
        e.into_refusal();
        Refusal::NumericDecision
    })
}
fn p2_at(x: f64, y: f64) -> P2 {
    wonky_num::p2(x, y)
}
fn point_equal(a: P2, b: P2) -> bool {
    a.x == b.x && a.y == b.y
}
fn is_line(p: &Primitive<'_>) -> bool {
    matches!(p, Primitive::Line { .. })
}

fn compare_squared_distance(a: P2, b: P2, length: f64) -> Result<i32, Refusal> {
    let mut g = Guard::new();
    let dx = difference(a.x, b.x, &mut g);
    let dy = difference(a.y, b.y, &mut g);
    let xy = sum(&mul(&dx, &dx, &mut g), &mul(&dy, &dy, &mut g), &mut g);
    let squared = product(length, length, &mut g);
    let delta = sum(&xy, &neg(&squared), &mut g);
    if !g.exact() {
        return Err(Refusal::NumericDecision);
    }
    Ok(sign(&delta))
}
fn exact_squared_distance(a: P2, b: P2, length: f64) -> Result<bool, Refusal> {
    Ok(compare_squared_distance(a, b, length)? == 0)
}

fn on_segment(a: P2, b: P2, q: P2) -> bool {
    q.x >= a.x.min(b.x) && q.x <= a.x.max(b.x) && q.y >= a.y.min(b.y) && q.y <= a.y.max(b.y)
}

fn line_intersection(a: P2, b: P2, c: P2, d: P2) -> Result<bool, Refusal> {
    let o1 = orientation(a, b, c)?;
    let o2 = orientation(a, b, d)?;
    let o3 = orientation(c, d, a)?;
    let o4 = orientation(c, d, b)?;
    Ok((o1 == Sign::Zero && on_segment(a, b, c))
        || (o2 == Sign::Zero && on_segment(a, b, d))
        || (o3 == Sign::Zero && on_segment(c, d, a))
        || (o4 == Sign::Zero && on_segment(c, d, b))
        || (o1 != o2 && o3 != o4))
}

/// Ordered-profile adapter: only identical construction keys or exactly equal
/// interpreter f64 endpoint coordinates prove incidence. Adjacency and proximity
/// alone never authorize moving a point; explicit construction witnesses can
/// instead be passed to `solve` as `Constraint::Coincident`.
pub fn solve_ordered_profile<'a>(segments: &[Primitive<'a>]) -> Result<Profile<'a>, Refusal> {
    if segments.len() < 2 {
        return Err(Refusal::Underconstrained);
    }
    let endpoints: Vec<_> = segments
        .iter()
        .map(|segment| match segment {
            Primitive::Line { start, end } | Primitive::Arc3 { start, end, .. } => {
                Ok((*start, *end))
            }
            Primitive::Circle { .. } => Err(Refusal::InvalidInput),
        })
        .collect::<Result<_, _>>()?;
    let mut joints = Vec::with_capacity(endpoints.len());
    for i in 0..endpoints.len() {
        let a = endpoints[i].1;
        let b = endpoints[(i + 1) % endpoints.len()].0;
        checked(&[a.xy.x, a.xy.y, b.xy.x, b.xy.y])?;
        if a.key != b.key && !point_equal(a.xy, b.xy) {
            return Err(Refusal::OpenProfile);
        }
        joints.push(Constraint::Coincident { a: a.key, b: b.key });
    }
    solve(segments, &joints)
}

/// Produces one loop per independent closed ring. Arc3 orientation is certified
/// by exact rational interval bounds for its signed circular-segment area.
/// A full circle is oriented counterclockwise by its construction.
pub fn solve<'a>(
    primitives: &[Primitive<'a>],
    constraints: &[Constraint<'a>],
) -> Result<Profile<'a>, Refusal> {
    if primitives.is_empty() {
        return Err(Refusal::Underconstrained);
    }
    let mut points = HashMap::<&'a str, P2>::new();
    let mut edges = Vec::new();
    let mut circles = Vec::new();
    for (i, primitive) in primitives.iter().enumerate() {
        match *primitive {
            Primitive::Line { start, end } | Primitive::Arc3 { start, end, .. } => {
                for p in [start, end] {
                    if p.key.is_empty() {
                        return Err(Refusal::Underconstrained);
                    }
                    checked(&[p.xy.x, p.xy.y])?;
                    // The same construction key is one point even if separate
                    // transform paths produced different rounded seed values.
                    points.entry(p.key).or_insert(p.xy);
                }
                if start.key == end.key {
                    return Err(Refusal::Degenerate);
                }
                if let Primitive::Arc3 { mid, .. } = primitive {
                    checked(&[mid.x, mid.y])?;
                    if orientation(start.xy, *mid, end.xy)? == Sign::Zero {
                        return Err(Refusal::Degenerate);
                    }
                }
                edges.push((i, start.key, end.key));
            }
            Primitive::Circle { center, radius } => {
                if center.key.is_empty() || !radius.is_finite() || radius <= 0.0 {
                    return Err(Refusal::InvalidInput);
                }
                checked(&[center.xy.x, center.xy.y, radius])?;
                points.entry(center.key).or_insert(center.xy);
                circles.push((i, center.key));
            }
        }
    }
    let mut aliases: HashMap<&str, &str> = points.keys().map(|&k| (k, k)).collect();
    // Explicit construction incidence joins keys regardless of their seed coordinates.
    // Unlike a tolerance weld this identity is declared by the caller.
    for constraint in constraints {
        if let Constraint::Coincident { a, b } = constraint {
            #[cfg(feature = "plant_ignore_coincident")]
            {
                let _ = (a, b);
                continue;
            }
            let (Some(_), Some(_)) = (points.get(a), points.get(b)) else {
                return Err(Refusal::Underconstrained);
            };
            let old = aliases[a];
            let new = aliases[b];
            for target in aliases.values_mut() {
                if *target == old {
                    *target = new;
                }
            }
        }
    }
    // Every aliased point takes the first construction seed; the solved geometry
    // (not the raw seeds) is used throughout subsequent predicates and output.
    let mut canonical = HashMap::<&str, P2>::new();
    for primitive in primitives {
        let candidates: &[Point<'a>] = match primitive {
            Primitive::Line { start, end } | Primitive::Arc3 { start, end, .. } => &[*start, *end],
            Primitive::Circle { center, .. } => std::slice::from_ref(center),
        };
        for p in candidates {
            canonical.entry(aliases[p.key]).or_insert(p.xy);
        }
    }
    // A distance constraint moves its free endpoint along the seeded bearing.
    // Every constructed coordinate is checked against the exact dimension;
    // representationally impossible or conflicting cases refuse.
    let mut dimensioned = HashSet::new();
    for constraint in constraints {
        if let Constraint::Distance { a, b, mm } = *constraint {
            let (Some(&ak), Some(&bk)) = (aliases.get(a), aliases.get(b)) else {
                return Err(Refusal::Underconstrained);
            };
            checked(&[mm])?;
            if mm < 0.0 {
                return Err(Refusal::InvalidInput);
            }
            let (pa, pb) = (canonical[ak], canonical[bk]);
            if !exact_squared_distance(pa, pb, mm)? {
                if ak == bk || dimensioned.contains(bk) {
                    return Err(Refusal::Overconstrained);
                }
                let dx = pb.x - pa.x;
                let dy = pb.y - pa.y;
                let seed_length = dx.hypot(dy);
                if !seed_length.is_finite() || seed_length == 0.0 {
                    return Err(Refusal::Underconstrained);
                }
                let scale = mm / seed_length;
                let next = p2_at(pa.x + dx * scale, pa.y + dy * scale);
                checked(&[next.x, next.y])?;
                if !exact_squared_distance(pa, next, mm)? {
                    return Err(Refusal::NumericDecision);
                }
                canonical.insert(bk, next);
            }
            dimensioned.insert(bk);
        }
    }
    let solved_points: HashMap<_, _> = aliases
        .iter()
        .map(|(&key, &alias)| (key, canonical[alias]))
        .collect();
    let resolved: Vec<_> = primitives
        .iter()
        .map(|p| match *p {
            Primitive::Line { mut start, mut end } => {
                start.xy = solved_points[start.key];
                end.xy = solved_points[end.key];
                Primitive::Line { start, end }
            }
            Primitive::Arc3 {
                mut start,
                mid,
                mut end,
            } => {
                start.xy = solved_points[start.key];
                end.xy = solved_points[end.key];
                Primitive::Arc3 { start, mid, end }
            }
            Primitive::Circle { mut center, radius } => {
                center.xy = solved_points[center.key];
                Primitive::Circle { center, radius }
            }
        })
        .collect();
    let primitives = resolved.as_slice();
    for &(i, a, b) in &edges {
        let (start, end) = (solved_points[a], solved_points[b]);
        if aliases[a] == aliases[b] || point_equal(start, end) {
            return Err(Refusal::Degenerate);
        }
        if let Primitive::Arc3 { mid, .. } = primitives[i] {
            if orientation(start, mid, end)? == Sign::Zero {
                return Err(Refusal::Degenerate);
            }
        }
    }
    for constraint in constraints {
        match *constraint {
            Constraint::Coincident { .. } => (),
            Constraint::Distance { a, b, mm } => {
                let (Some(pa), Some(pb)) = (solved_points.get(a), solved_points.get(b)) else {
                    return Err(Refusal::Underconstrained);
                };
                checked(&[mm])?;
                if mm < 0.0 {
                    return Err(Refusal::InvalidInput);
                }
                // Squared distance equality is evaluated on expansions of the
                // original coordinates; rounded sqrt equality is not evidence.
                if !exact_squared_distance(*pa, *pb, mm)? {
                    return Err(Refusal::Overconstrained);
                }
                if mm == 0.0 && aliases[a] != aliases[b] {
                    return Err(Refusal::Overconstrained);
                }
            }
            Constraint::TangentLineCircle {
                line_start,
                line_end,
                circle_center,
                at,
            } => {
                let (Some(a), Some(b), Some(c), Some(t)) = (
                    solved_points.get(line_start),
                    solved_points.get(line_end),
                    solved_points.get(circle_center),
                    solved_points.get(at),
                ) else {
                    return Err(Refusal::Underconstrained);
                };
                if aliases[at] != aliases[line_start] && aliases[at] != aliases[line_end] {
                    return Err(Refusal::UncertifiedTangency);
                }
                if !edges.iter().any(|(i, start, end)| {
                    matches!(primitives[*i], Primitive::Line { .. })
                        && ((aliases[start] == aliases[line_start]
                            && aliases[end] == aliases[line_end])
                            || (aliases[start] == aliases[line_end]
                                && aliases[end] == aliases[line_start]))
                }) {
                    return Err(Refusal::UncertifiedTangency);
                }
                // Both the radius incidence and perpendicularity are exact
                // expressions of the original f64 inputs, not rounded deltas.
                let Some(radius) = circles.iter().find_map(|(i, key)| {
                    if aliases[key] == aliases[circle_center] {
                        if let Primitive::Circle { radius, .. } = primitives[*i] {
                            Some(radius)
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                }) else {
                    return Err(Refusal::UncertifiedTangency);
                };
                if !exact_squared_distance(*t, *c, radius)? {
                    return Err(Refusal::Overconstrained);
                }
                let mut g = Guard::new();
                let dx = difference(b.x, a.x, &mut g);
                let dy = difference(b.y, a.y, &mut g);
                let rx = difference(t.x, c.x, &mut g);
                let ry = difference(t.y, c.y, &mut g);
                let dot = sum(&mul(&dx, &rx, &mut g), &mul(&dy, &ry, &mut g), &mut g);
                if !g.exact() {
                    return Err(Refusal::NumericDecision);
                }
                if sign(&dot) != 0 {
                    return Err(Refusal::Overconstrained);
                }
            }
        }
    }
    #[cfg(feature = "plant_epsilon_weld")]
    for &(_, a, b) in &edges {
        if aliases[a] != aliases[b] {
            for &(_, c, _) in &edges {
                let p = points[b];
                let q = points[c];
                if aliases[b] != aliases[c] && (p.x - q.x).abs() < 1e-9 && (p.y - q.y).abs() < 1e-9
                {
                    let old = aliases[b];
                    let new = aliases[c];
                    for target in aliases.values_mut() {
                        if *target == old {
                            *target = new;
                        }
                    }
                }
            }
        }
    }
    let mut outgoing = HashMap::<&str, usize>::new();
    let mut incoming = HashMap::<&str, usize>::new();
    for (i, a, b) in &edges {
        let (a, b) = (aliases[a], aliases[b]);
        if a == b {
            return Err(Refusal::Degenerate);
        }
        if outgoing.insert(a, *i).is_some() || incoming.insert(b, *i).is_some() {
            return Err(Refusal::Branching);
        }
    }
    if outgoing.len() != incoming.len() || outgoing.keys().any(|k| !incoming.contains_key(k)) {
        return Err(Refusal::OpenProfile);
    }
    if edges.iter().any(|(i, _, _)| !is_line(&primitives[*i])) {
        check_arc_intersections(primitives, &edges, &aliases, &solved_points)?;
    } else {
        // Regions cannot be emitted until every segment-pair crossing is decided.
        // Touching distinct rings and self-crossings are currently refused instead
        // of manufacturing a face from a signed shoelace sum.
        for (pos, &(i, ai, bi)) in edges.iter().enumerate() {
            let Primitive::Line { start: a, end: b } = primitives[i] else {
                unreachable!()
            };
            for &(j, cj, dj) in edges.iter().skip(pos + 1) {
                let Primitive::Line { start: c, end: d } = primitives[j] else {
                    unreachable!()
                };
                let shared = [aliases[ai], aliases[bi]]
                    .into_iter()
                    .find(|&key| key == aliases[cj] || key == aliases[dj]);
                if let Some(key) = shared {
                    let common = solved_points[key];
                    let other_a = if aliases[ai] == key { b.xy } else { a.xy };
                    let other_b = if aliases[cj] == key { d.xy } else { c.xy };
                    if orientation(common, other_a, other_b)? == Sign::Zero
                        && (on_segment(common, other_a, other_b)
                            || on_segment(common, other_b, other_a))
                    {
                        return Err(Refusal::UnsupportedIntersection);
                    }
                } else if line_intersection(a.xy, b.xy, c.xy, d.xy)? {
                    return Err(Refusal::UnsupportedIntersection);
                }
            }
        }
    }
    let mut loops = Vec::new();
    let mut visited = HashSet::new();
    for &(index, start, _) in &edges {
        if visited.contains(&index) {
            continue;
        }
        let first = aliases[start];
        let mut key = first;
        let mut segment_indices = Vec::new();
        let mut keys = Vec::new();
        loop {
            let Some(&edge) = outgoing.get(key) else {
                return Err(Refusal::OpenProfile);
            };
            if !visited.insert(edge) {
                return Err(Refusal::Branching);
            }
            segment_indices.push(edge);
            keys.push(key);
            let (_, _, end) = edges
                .iter()
                .find(|e| e.0 == edge)
                .expect("edge index from map");
            key = aliases[end];
            if key == first {
                break;
            }
        }
        if segment_indices.len() < 2 {
            return Err(Refusal::Degenerate);
        }
        // Green's integral. Lines use exact expansions; circular arcs require
        // exact-rational interval bounds for their transcendental sweep angle.
        let all_lines = segment_indices.iter().all(|&i| is_line(&primitives[i]));
        let s = if all_lines {
            let mut g = Guard::new();
            let mut area: Exp = Vec::new();
            for &i in &segment_indices {
                let Primitive::Line { start, end } = primitives[i] else {
                    unreachable!()
                };
                let forward = product(start.xy.x, end.xy.y, &mut g);
                let backward = product(start.xy.y, end.xy.x, &mut g);
                area = sum(&area, &sum(&forward, &neg(&backward), &mut g), &mut g);
            }
            if !g.exact() {
                return Err(Refusal::NumericDecision);
            }
            let exact = Sign::of_exact(sign(&area) as f64);
            #[cfg(feature = "plant_float_area")]
            let exact = {
                let naive: f64 = segment_indices
                    .iter()
                    .map(|&i| {
                        let Primitive::Line { start, end } = primitives[i] else {
                            unreachable!()
                        };
                        start.xy.x * end.xy.y - start.xy.y * end.xy.x
                    })
                    .sum();
                Sign::of_exact(naive)
            };
            exact
        } else {
            let mut low = BigRational::zero();
            let mut high = BigRational::zero();
            for &i in &segment_indices {
                let (lo, hi) = match primitives[i] {
                    Primitive::Line { start, end } => {
                        let area = arc_area::line_area(start.xy, end.xy)?;
                        (area.clone(), area)
                    }
                    Primitive::Arc3 { start, mid, end } => {
                        arc_area::arc_area(start.xy, mid, end.xy)?
                    }
                    Primitive::Circle { .. } => unreachable!(),
                };
                low += lo;
                high += hi;
            }
            if low > BigRational::zero() {
                Sign::Positive
            } else if high < BigRational::zero() {
                Sign::Negative
            } else {
                return Err(Refusal::AmbiguousOrientation);
            }
        };
        if s == Sign::Zero {
            return Err(Refusal::Degenerate);
        }
        loops.push(Loop {
            segment_indices,
            orientation: s,
            keys,
        });
    }
    for (i, center) in circles {
        if primitives.len() != 1 {
            return Err(Refusal::UnsupportedIntersection);
        }
        loops.push(Loop {
            segment_indices: vec![i],
            orientation: Sign::Positive,
            keys: vec![center],
        });
    }
    Ok(Profile {
        loops,
        solved_points,
    })
}

/// Nonadjacent arc pairs must have disjoint certified boxes. Adjacent arcs
/// are tested for a second intersection on their supporting exact circles;
/// unknown shared-circle overlaps refuse instead of inventing a region.
fn check_arc_intersections(
    primitives: &[Primitive<'_>],
    edges: &[(usize, &str, &str)],
    aliases: &HashMap<&str, &str>,
    points: &HashMap<&str, P2>,
) -> Result<(), Refusal> {
    use arc_area::{in_line_segment, line_bounds, ArcGeometry};
    let geometry: Vec<_> = primitives
        .iter()
        .map(|primitive| match primitive {
            Primitive::Arc3 { start, mid, end } => {
                ArcGeometry::new(start.xy, *mid, end.xy).map(Some)
            }
            _ => Ok(None),
        })
        .collect::<Result<_, _>>()?;
    let bounds: Vec<_> = primitives
        .iter()
        .enumerate()
        .map(|(i, p)| match p {
            Primitive::Line { start, end } => line_bounds(start.xy, end.xy),
            Primitive::Arc3 { .. } => geometry[i].as_ref().expect("arc geometry").bounds(),
            Primitive::Circle { .. } => Ok([
                (BigRational::zero(), BigRational::zero()),
                (BigRational::zero(), BigRational::zero()),
            ]),
        })
        .collect::<Result<_, _>>()?;
    for (pos, &(i, ai, bi)) in edges.iter().enumerate() {
        for &(j, aj, bj) in edges.iter().skip(pos + 1) {
            let a = &bounds[i];
            let b = &bounds[j];
            if (0..2).any(|axis| a[axis].1 < b[axis].0 || b[axis].1 < a[axis].0) {
                continue;
            }
            let shared = [ai, bi]
                .into_iter()
                .find(|&k| aliases[k] == aliases[aj] || aliases[k] == aliases[bj]);
            let Some(shared) = shared else {
                return Err(Refusal::UnsupportedIntersection);
            };
            let p = points[shared];
            match (&geometry[i], &geometry[j]) {
                (Some(left), Some(right)) => {
                    if left.same_circle(right) {
                        // Two arcs on the same supporting circle are safe here
                        // only as complementary arcs with both endpoints shared.
                        // A midpoint test alone misses short overlaps between
                        // two longer arcs whose midpoints lie outside the overlap.
                        if !((aliases[ai] == aliases[aj] && aliases[bi] == aliases[bj])
                            || (aliases[ai] == aliases[bj] && aliases[bi] == aliases[aj]))
                        {
                            return Err(Refusal::UnsupportedIntersection);
                        }
                        let (left_mid, right_mid) = match (primitives[i], primitives[j]) {
                            (Primitive::Arc3 { mid: a, .. }, Primitive::Arc3 { mid: b, .. }) => {
                                (a, b)
                            }
                            _ => unreachable!(),
                        };
                        if left.contains(
                            &BigRational::from_float(right_mid.x)
                                .ok_or(Refusal::NumericDecision)?,
                            &BigRational::from_float(right_mid.y)
                                .ok_or(Refusal::NumericDecision)?,
                        ) || right.contains(
                            &BigRational::from_float(left_mid.x).ok_or(Refusal::NumericDecision)?,
                            &BigRational::from_float(left_mid.y).ok_or(Refusal::NumericDecision)?,
                        ) {
                            return Err(Refusal::UnsupportedIntersection);
                        }
                        continue;
                    }
                    if let Some((x, y)) = left.other_circle_intersection(right, p)? {
                        if left.contains(&x, &y) && right.contains(&x, &y) {
                            return Err(Refusal::UnsupportedIntersection);
                        }
                    }
                }
                (Some(arc), None) | (None, Some(arc)) => {
                    let (start, end) = if geometry[i].is_none() {
                        (
                            match primitives[i] {
                                Primitive::Line { start, .. } => start.xy,
                                _ => unreachable!(),
                            },
                            match primitives[i] {
                                Primitive::Line { end, .. } => end.xy,
                                _ => unreachable!(),
                            },
                        )
                    } else {
                        (
                            match primitives[j] {
                                Primitive::Line { start, .. } => start.xy,
                                _ => unreachable!(),
                            },
                            match primitives[j] {
                                Primitive::Line { end, .. } => end.xy,
                                _ => unreachable!(),
                            },
                        )
                    };
                    let other = if start == p { end } else { start };
                    if let Some(q) = arc.other_line_intersection(p, other)? {
                        if arc.contains(&q.0, &q.1) && in_line_segment(&q, start, end)? {
                            let also_shared = (aliases[ai] == aliases[aj]
                                && aliases[bi] == aliases[bj])
                                || (aliases[ai] == aliases[bj] && aliases[bi] == aliases[aj]);
                            let other_q =
                                BigRational::from_float(other.x).ok_or(Refusal::NumericDecision)?;
                            let other_y =
                                BigRational::from_float(other.y).ok_or(Refusal::NumericDecision)?;
                            if !also_shared || q != (other_q, other_y) {
                                return Err(Refusal::UnsupportedIntersection);
                            }
                        }
                    }
                }
                (None, None) => {
                    let (a, b, c, d) = match (primitives[i], primitives[j]) {
                        (
                            Primitive::Line { start: a, end: b },
                            Primitive::Line { start: c, end: d },
                        ) => (a.xy, b.xy, c.xy, d.xy),
                        _ => unreachable!(),
                    };
                    let other_a = if a == p { b } else { a };
                    let other_b = if c == p { d } else { c };
                    if orientation(p, other_a, other_b)? == Sign::Zero
                        && (on_segment(p, other_a, other_b) || on_segment(p, other_b, other_a))
                    {
                        return Err(Refusal::UnsupportedIntersection);
                    }
                }
            }
        }
    }
    Ok(())
}
