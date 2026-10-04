//! Sketch regions selected by a point: std query.fs qContainsPoint and
//! qClosestTo over the regions of a line sketch (wonky_sketch::region).
//!
//! Exact, in the interpreter's binary64 world frame like edge_query: a region
//! is the image of its loop under the sketch frame (affine.rs: origin + u*x +
//! v*(z cross x), never normalized), and every decision is an expansion sign
//! on squared distances held as ratios n / d. The distance from a point p to a
//! region is p's height over the region's plane when the foot of p lies in or
//! on the loop, and otherwise the smallest distance to a boundary segment (the
//! in-plane minimum then lies on the boundary; the height adds in quadrature).
//! - contains: the regions within `tie` metres of p (TOLERANCE.zeroLength), so
//!   a point that toWorld rounded off a rotated plane still lies in its region;
//! - closest: every region within `tie` of the closest (edge_query::nearest).
use crate::affine::Affine;
use crate::edge_query::{nearest, segment_distance, Distance};
use crate::polyhedron::Refused;
use wonky_num::expansion::{self as ex, Exp, Guard};
use wonky_num::P2;
use wonky_sketch::region::RegionLoop;

pub const CONTAINS: u32 = 0;
pub const CLOSEST: u32 = 1;

type R<T> = Result<T, Refused>;
type V = [Exp; 3];
fn no(s: &str) -> Refused {
    Refused(format!("sketch-region/{s}"))
}
fn dot(a: &V, b: &V, g: &mut Guard) -> Exp {
    (0..3).fold(vec![], |s, k| ex::sum(&s, &ex::mul(&a[k], &b[k], g), g))
}
fn cross(a: &V, b: &V, g: &mut Guard) -> V {
    let mut c = |i: usize, j: usize| ex::sum(&ex::mul(&a[i], &b[j], g), &ex::neg(&ex::mul(&a[j], &b[i], g)), g);
    [c(1, 2), c(2, 0), c(0, 1)]
}
fn diff(a: f64, b: f64, g: &mut Guard) -> Exp {
    ex::sum(&[a], &[-b], g)
}

/// The foot of the point in sketch coordinates as (nu, nv) / det, det > 0.
struct Foot {
    nu: Exp,
    nv: Exp,
    det: Exp,
}

/// Whether the foot lies inside or on the loop: region.rs `locate` (winding
/// number, orientation signs, closed-box tests) with every comparison against
/// the foot scaled by det > 0, so no coordinate of the foot is rounded.
fn foot_in_loop(points: &[P2], f: &Foot, g: &mut Guard) -> bool {
    // sign(q.c - a.c) as the sign of n_c - a.c * det.
    let rel = |c: f64, n: &Exp, g: &mut Guard| ex::sum(n, &ex::neg(&ex::mul(&[c], &f.det, g)), g);
    let mut winding = 0i64;
    for (k, &a) in points.iter().enumerate() {
        let b = points[(k + 1) % points.len()];
        let (qa_x, qa_y) = (rel(a.x, &f.nu, g), rel(a.y, &f.nv, g));
        let (qb_x, qb_y) = (rel(b.x, &f.nu, g), rel(b.y, &f.nv, g));
        let (ab_x, ab_y) = (diff(b.x, a.x, g), diff(b.y, a.y, g));
        // orient2d(a, b, q) * det
        let orient = ex::sign(&ex::sum(&ex::mul(&ab_x, &qa_y, g), &ex::neg(&ex::mul(&ab_y, &qa_x, g)), g));
        if orient == 0 && ex::sign(&qa_x) * ex::sign(&qb_x) <= 0 && ex::sign(&qa_y) * ex::sign(&qb_y) <= 0 {
            return true; // on the boundary
        }
        if ex::sign(&qa_y) >= 0 {
            if ex::sign(&qb_y) < 0 && orient > 0 {
                winding += 1;
            }
        } else if ex::sign(&qb_y) >= 0 && orient < 0 {
            winding -= 1;
        }
    }
    winding != 0
}

fn region_distance(frame: &Affine, region: &RegionLoop, p: &V, g: &mut Guard) -> R<Distance> {
    let x: V = frame.x.map(|v| vec![v]);
    let y = frame.y_exact(g);
    let m = cross(&x, &y, g);
    let d: V = std::array::from_fn(|k| ex::sum(&p[k], &[-frame.origin[k]], g));
    // Cramer on p - origin = u x + v y + w m, with det[x, y, m] = m.m.
    let det = dot(&m, &m, g);
    let foot = Foot { nu: dot(&cross(&y, &m, g), &d, g), nv: dot(&cross(&m, &x, g), &d, g), det };
    if !g.exact() {
        return Err(no("numeric-range"));
    }
    if ex::sign(&foot.det) <= 0 {
        return Err(no("degenerate-frame"));
    }
    if foot_in_loop(&region.points, &foot, g) {
        let h = dot(&m, &d, g); // height^2 = (m.d)^2 / m.m
        return Ok(Distance { n: ex::mul(&h, &h, g), d: foot.det });
    }
    let world = |q: P2| frame.apply_exact([q.x, q.y, 0.0], 1.0, true).map_err(|_| no("numeric-range"));
    let mut best: Option<Distance> = None;
    for (k, &a) in region.points.iter().enumerate() {
        let b = region.points[(k + 1) % region.points.len()];
        let s = segment_distance(&world(a)?, &world(b)?, p, g).map_err(|_| no("numeric-range"))?;
        let closer = match &best {
            None => true,
            Some(t) => ex::sign(&ex::sum(&ex::mul(&s.n, &t.d, g), &ex::neg(&ex::mul(&t.n, &s.d, g)), g)) < 0,
        };
        if closer {
            best = Some(s);
        }
    }
    best.ok_or_else(|| no("empty-loop"))
}

/// The indices of the `regions` a query selects for `point` (world metres),
/// deciding only among the `candidates` (region indices, each named once): a
/// qContainsPoint or qClosestTo whose subquery is a smaller set of regions
/// (qSubtraction, qNthElement, ...) is the containing or closest region of
/// that set, so the closest region outside it must not win the decision.
/// The result is in candidate order.
pub fn select(frame: &Affine, regions: &[RegionLoop], candidates: &[usize], point: [f64; 3], mode: u32, tie: f64) -> R<Vec<usize>> {
    let mut seen = vec![false; regions.len()];
    for &c in candidates {
        if c >= regions.len() || std::mem::replace(&mut seen[c], true) {
            return Err(no("invalid-candidates"));
        }
    }
    if point.iter().chain(&frame.origin).chain(&frame.x).chain(&frame.z).any(|v| !v.is_finite()) || !tie.is_finite() || tie < 0.0 {
        return Err(no("invalid-input"));
    }
    let mut g = Guard::new();
    let p: V = point.map(|v| vec![v]);
    let ds = candidates.iter().map(|&c| region_distance(frame, &regions[c], &p, &mut g)).collect::<R<Vec<_>>>()?;
    if ds.is_empty() && (mode == CONTAINS || mode == CLOSEST) {
        return Ok(vec![]);
    }
    let selected = match mode {
        CONTAINS => {
            let t2 = ex::product(tie, tie, &mut g);
            let mut within = vec![];
            for (i, d) in ds.iter().enumerate() {
                if ex::sign(&ex::sum(&d.n, &ex::neg(&ex::mul(&t2, &d.d, &mut g)), &mut g)) <= 0 {
                    within.push(i);
                }
            }
            within
        }
        CLOSEST => nearest(&ds, tie, &mut g),
        _ => return Err(no("invalid-mode")),
    };
    if !g.exact() {
        return Err(no("numeric-range"));
    }
    Ok(selected.into_iter().map(|i| candidates[i]).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn square(x0: f64, x1: f64) -> RegionLoop {
        let points = vec![P2 { x: x0, y: 0.0 }, P2 { x: x1, y: 0.0 }, P2 { x: x1, y: 1.0 }, P2 { x: x0, y: 1.0 }];
        RegionLoop { points, uses: vec![] }
    }
    fn frame() -> Affine {
        Affine { origin: [0.0; 3], x: [1.0, 0.0, 0.0], z: [0.0, 0.0, 1.0] }
    }
    // Three unit squares at x in [0,1], [2,3], [4,5] (metres).
    fn regions() -> Vec<RegionLoop> {
        vec![square(0.0, 1.0), square(2.0, 3.0), square(4.0, 5.0)]
    }

    #[test]
    fn closest_decides_only_among_the_candidates() {
        // The point lies in region 0; among {1, 2} region 1 is closest, and
        // among {2} only region 2 can be.
        let p = [0.5, 0.5, 0.0];
        assert_eq!(select(&frame(), &regions(), &[0, 1, 2], p, CLOSEST, 1e-8).unwrap(), vec![0]);
        assert_eq!(select(&frame(), &regions(), &[1, 2], p, CLOSEST, 1e-8).unwrap(), vec![1]);
        assert_eq!(select(&frame(), &regions(), &[2], p, CLOSEST, 1e-8).unwrap(), vec![2]);
    }

    #[test]
    fn contains_among_candidates_maps_back_to_region_indices() {
        let p = [2.5, 0.5, 0.0];
        assert_eq!(select(&frame(), &regions(), &[2, 1], p, CONTAINS, 1e-8).unwrap(), vec![1]);
        assert_eq!(select(&frame(), &regions(), &[0, 2], p, CONTAINS, 1e-8).unwrap(), Vec::<usize>::new());
    }

    #[test]
    fn empty_candidates_select_nothing_and_bad_candidates_are_named() {
        let p = [0.5, 0.5, 0.0];
        assert_eq!(select(&frame(), &regions(), &[], p, CLOSEST, 1e-8).unwrap(), Vec::<usize>::new());
        assert_eq!(select(&frame(), &regions(), &[], p, CONTAINS, 1e-8).unwrap(), Vec::<usize>::new());
        for bad in [vec![3], vec![1, 1]] {
            let e = select(&frame(), &regions(), &bad, p, CLOSEST, 1e-8).unwrap_err();
            assert_eq!(e.0, "sketch-region/invalid-candidates");
        }
    }
}
