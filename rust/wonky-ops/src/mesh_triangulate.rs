//! One contour triangulation algorithm, parameterized by its exact source
//! predicates. Export witnesses never decide rational-source topology.
use super::mesh::{no, R};
use std::collections::{BTreeMap, BTreeSet};
use wonky_num::Sign;
pub(crate) trait PlanarPoint: PartialEq {
    fn orientation(a: &Self, b: &Self, c: &Self) -> R<Sign>;
    fn obstructs(a: &Self, b: &Self, c: &Self, d: &Self) -> R<bool>;
    fn area_sign(points: &[Self], cycle: &[usize]) -> R<i32>
    where
        Self: Sized;
    fn midpoint_inside(points: &[Self], cycle: &[usize], a: usize, b: usize) -> R<bool>
    where
        Self: Sized;
    fn in_circle(a: &Self, b: &Self, c: &Self, d: &Self) -> R<Sign>;
    fn simple(points: &[Self], cycle: &[usize]) -> R<()>
    where
        Self: Sized;
    fn locate(points: &[Self], cycle: &[usize], p: &Self) -> R<bool>
    where
        Self: Sized;
}
/// Lawson flips of an exact CCW triangulation into the constrained Delaunay
/// triangulation of its vertices: a non-constrained edge is flipped only when
/// the opposite vertex lies strictly inside the circumcircle (exact incircle)
/// and both replacement triangles are strictly counterclockwise (exact orient).
/// Ear clipping alone yields fans of needle triangles whose apex lies almost on
/// the extension of a short contour chord; binary STL rounds every vertex to
/// float32 and such a needle can turn inside out (export/stl/float32-triangle-
/// inversion, checked afterwards). The Delaunay criterion never keeps a needle
/// that a visible vertex could replace, so only contour-forced slivers remain,
/// and those are still refused by that check. Same vertices, same constraint
/// segments, same triangle count; only interior diagonals change.
pub(crate) fn delaunay_flips<P: PlanarPoint>(
    points: &[P],
    triangles: &mut [[usize; 3]],
    constrained: &BTreeSet<(usize, usize)>,
) -> R<()> {
    let mut owner: BTreeMap<(usize, usize), usize> = BTreeMap::new();
    for (i, t) in triangles.iter().enumerate() {
        for k in 0..3 {
            if owner.insert((t[k], t[(k + 1) % 3]), i).is_some() {
                return Err(no("triangulation-repeated-edge"));
            }
        }
    }
    let undirected = |a: usize, b: usize| (a.min(b), a.max(b));
    let mut pending: Vec<(usize, usize)> = owner
        .keys()
        .filter(|&&(a, b)| a < b && owner.contains_key(&(b, a)) && !constrained.contains(&(a, b)))
        .copied()
        .collect();
    // Every flip removes an edge that Lawson's algorithm never recreates
    // (the lifted surface only moves down), so C(n,2) flips always suffice.
    let vertices: BTreeSet<usize> = triangles.iter().flatten().copied().collect();
    let mut budget = vertices.len() * vertices.len().saturating_sub(1) / 2;
    while let Some((u, v)) = pending.pop() {
        let (Some(&t1), Some(&t2)) = (owner.get(&(u, v)), owner.get(&(v, u))) else {
            continue;
        };
        let third = |t: [usize; 3], a: usize, b: usize| t.into_iter().find(|&k| k != a && k != b);
        let (Some(w), Some(x)) = (third(triangles[t1], u, v), third(triangles[t2], u, v)) else {
            return Err(no("triangulation-repeated-edge"));
        };
        // t1 = (u, v, w) and t2 = (v, u, x), both CCW: quad u, x, v, w.
        if owner.contains_key(&(w, x))
            || owner.contains_key(&(x, w))
            || P::in_circle(&points[u], &points[v], &points[w], &points[x])? != Sign::Positive
            || P::orientation(&points[u], &points[x], &points[w])? != Sign::Positive
            || P::orientation(&points[x], &points[v], &points[w])? != Sign::Positive
        {
            continue;
        }
        if budget == 0 {
            return Err(no("triangulation-flip-limit"));
        }
        budget -= 1;
        for e in [(u, v), (v, u), (v, w), (u, x)] {
            owner.remove(&e);
        }
        triangles[t1] = [u, x, w];
        triangles[t2] = [x, v, w];
        for (e, t) in [
            ((u, x), t1),
            ((x, w), t1),
            ((w, u), t1),
            ((x, v), t2),
            ((v, w), t2),
            ((w, x), t2),
        ] {
            owner.insert(e, t);
        }
        for (a, b) in [(u, x), (x, v), (v, w), (w, u)] {
            if !constrained.contains(&undirected(a, b)) {
                pending.push(undirected(a, b));
            }
        }
    }
    Ok(())
}

/// One outer contour followed by holes. Returns CCW triangles, preserving every
/// input contour segment, including collinear vertices. No Steiner points.
/// Bridges are visible vertex-to-vertex diagonals, chosen by exact intersection
/// and rational midpoint tests; the doubled bridge is then ear-clipped, and the
/// result is flipped into the constrained Delaunay triangulation.
pub(crate) fn validate_loops<P: PlanarPoint>(
    points: &[P],
    loops: &[Vec<usize>],
) -> R<Vec<Vec<usize>>> {
    if loops.is_empty() || loops.iter().map(Vec::len).sum::<usize>() > 8192 {
        return Err(no("contour-resource-limit"));
    }
    let mut contours = loops.to_vec();
    for (i, c) in contours.iter_mut().enumerate() {
        if c.len() < 3 || c.iter().any(|&k| k >= points.len()) {
            return Err(no("invalid-contour"));
        }
        P::simple(points, c)?;
        let sign = P::area_sign(points, c)?;
        if sign == 0 {
            return Err(no("zero-area-contour"));
        }
        if (sign > 0) != (i == 0) {
            c.reverse();
        }
    }
    // Distinct contours may not touch or cross. Such a face is not a polygon
    // with disjoint holes and requires a different exact arrangement.
    for i in 0..contours.len() {
        for j in i + 1..contours.len() {
            for a in 0..contours[i].len() {
                for b in 0..contours[j].len() {
                    let (p, q) = (
                        &points[contours[i][a]],
                        &points[contours[i][(a + 1) % contours[i].len()]],
                    );
                    let (r, s) = (
                        &points[contours[j][b]],
                        &points[contours[j][(b + 1) % contours[j].len()]],
                    );
                    if p == r || p == s || q == r || q == s || P::obstructs(p, q, r, s)? {
                        return Err(no("intersecting-contours"));
                    }
                }
            }
        }
    }
    for i in 1..contours.len() {
        let point = &points[contours[i][0]];
        for (j, contour) in contours.iter().enumerate() {
            if i == j {
                continue;
            }
            let location = P::locate(points, contour, point)?;
            let expected = j == 0;
            if location != expected {
                return Err(no("invalid-hole-nesting"));
            }
        }
    }
    Ok(contours)
}

pub(crate) fn triangulate_loops<P: PlanarPoint>(
    points: &[P],
    loops: &[Vec<usize>],
) -> R<Vec<[usize; 3]>> {
    let contours = validate_loops(points, loops)?;
    let mut polygon = contours[0].clone();
    for hole in contours.iter().skip(1) {
        let mut bridge = None;
        'candidate: for (i, &a) in polygon.iter().enumerate() {
            let n = polygon.len();
            let (prev, next) = (
                &points[polygon[(i + n - 1) % n]],
                &points[polygon[(i + 1) % n]],
            );
            let convex = P::orientation(prev, &points[a], next)? == Sign::Positive;
            for (j, &b) in hole.iter().enumerate() {
                // A vertex that earlier bridges repeated owns one interior
                // wedge per occurrence. The bridge must leave through this
                // occurrence's wedge (left of prev->a and/or a->next), or the
                // joined polygon is not weakly simple and no ear remains.
                let left_in = P::orientation(prev, &points[a], &points[b])? == Sign::Positive;
                let left_out = P::orientation(&points[a], next, &points[b])? == Sign::Positive;
                if !(if convex {
                    left_in && left_out
                } else {
                    left_in || left_out
                }) {
                    continue;
                }
                let mut blocked = false;
                for contour in contours.iter().chain(std::iter::once(&polygon)) {
                    for k in 0..contour.len() {
                        if P::obstructs(
                            &points[a],
                            &points[b],
                            &points[contour[k]],
                            &points[contour[(k + 1) % contour.len()]],
                        )? {
                            blocked = true;
                            break;
                        }
                    }
                    if blocked {
                        break;
                    }
                }
                if blocked || !P::midpoint_inside(points, &contours[0], a, b)? {
                    continue;
                }
                for h in contours.iter().skip(1) {
                    if P::midpoint_inside(points, h, a, b)? {
                        blocked = true;
                        break;
                    }
                }
                if !blocked {
                    bridge = Some((i, j));
                    break 'candidate;
                }
            }
        }
        let (i, j) = bridge.ok_or_else(|| no("hole-bridge-undecided"))?;
        let mut joined = polygon[..=i].to_vec();
        joined.extend((0..hole.len()).map(|k| hole[(j + k) % hole.len()]));
        joined.extend([hole[j], polygon[i]]);
        joined.extend_from_slice(&polygon[i + 1..]);
        polygon = joined;
    }
    let mut triangles = Vec::with_capacity(polygon.len() - 2);
    while polygon.len() > 3 {
        let n = polygon.len();
        let mut ear = None;
        for i in 0..n {
            let ids = [polygon[(i + n - 1) % n], polygon[i], polygon[(i + 1) % n]];
            let [a, b, c] = ids.map(|k| &points[k]);
            if P::orientation(a, b, c)? != Sign::Positive {
                continue;
            }
            let mut blocked = false;
            for &k in &polygon {
                let p = &points[k];
                if p == a || p == b || p == c {
                    continue;
                }
                if P::orientation(a, b, p)? != Sign::Negative
                    && P::orientation(b, c, p)? != Sign::Negative
                    && P::orientation(c, a, p)? != Sign::Negative
                {
                    blocked = true;
                    break;
                }
            }
            if blocked {
                continue;
            }
            for j in 0..n {
                let (p, q) = (&points[polygon[j]], &points[polygon[(j + 1) % n]]);
                // Edges incident on an ear's diagonal endpoints are admissible
                // except for overlap, tested above by the inclusive point test.
                if p == a || p == c || q == a || q == c {
                    continue;
                }
                if P::obstructs(a, c, p, q)? {
                    blocked = true;
                    break;
                }
            }
            if !blocked {
                ear = Some((i, ids));
                break;
            }
        }
        let (i, t) = ear.ok_or_else(|| no("triangulation-undecided"))?;
        triangles.push(t);
        polygon.remove(i);
    }
    let t = [polygon[0], polygon[1], polygon[2]];
    if P::orientation(&points[t[0]], &points[t[1]], &points[t[2]])? != Sign::Positive {
        return Err(no("degenerate-final-triangle"));
    }
    triangles.push(t);
    let constrained: BTreeSet<(usize, usize)> = contours
        .iter()
        .flat_map(|c| {
            (0..c.len()).map(move |i| {
                (
                    c[i].min(c[(i + 1) % c.len()]),
                    c[i].max(c[(i + 1) % c.len()]),
                )
            })
        })
        .collect();
    delaunay_flips(points, &mut triangles, &constrained)?;
    Ok(triangles)
}
