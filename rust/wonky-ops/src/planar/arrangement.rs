//! Port of kernel/ports/planar-boolean-arrangement.bend and
//! planar-boolean-selection.bend: the shared convex-cell plane arrangement,
//! cell selection by solid membership, and the boundary pairing.

use crate::exact;
use crate::halfspace::{self, Built, ClipState, Polygon};
use crate::model::*;
use crate::num::*;
use crate::solid::{PSolid, SolidClass};

pub struct Arrangement {
    pub vertices: Vec<P3>,
    pub cells: Vec<Vec<Polygon>>,
    pub planes: u32,
}

pub enum ArrangeError {
    Failed { reason: Reason, stage: u32 },
}

/// D.plane_equal: exactly parallel normals and the origin of b on plane a.
pub fn plane_equal(a: &Surface, b: &Surface) -> bool {
    let (an, bn, ao, bo) = (normal_of(a), normal_of(b), origin_of(a), origin_of(b));
    exact::parallel(an, bn, "plane_equal parallel") && exact::coincident(an, bo, ao, "plane_equal incident")
}

/// D.unique_planes over the faces of both operands, first occurrence kept.
pub fn unique_planes(faces: impl Iterator<Item = Surface>) -> Vec<Surface> {
    let mut planes: Vec<Surface> = Vec::new();
    for s in faces {
        if !planes.iter().any(|p| plane_equal(p, &s)) {
            planes.push(s);
        }
    }
    planes
}

fn cell_flags(polygons: &[Polygon], values: &[halfspace::Side]) -> (bool, bool) {
    let mut negative = false;
    let mut positive = false;
    for p in polygons {
        for i in &p.vertices {
            let k = values.get(*i as usize).map(|s| s.kind).unwrap_or(3);
            negative |= k == 1;
            positive |= k == 2;
        }
    }
    (negative, positive)
}

/// D.cap: close the clipped polygons with one polygon on the cutting plane.
fn cap(mut polygons: Vec<Polygon>, vertices: &[P3], surface: Surface, sense: bool) -> Option<Vec<Polygon>> {
    let mut built = Built::default();
    halfspace::build_polygons(&polygons, vertices, &mut built);
    let open = halfspace::open_uses(&built.edges, &built.faces);
    match halfspace::stitch(&built.edges, vertices.len() as u32, &open) {
        Ok(rings) if rings.len() == 1 => {
            let ids = halfspace::ring_vertices(&rings[0], &built.edges);
            polygons.push(Polygon { surface, sense, vertices: ids });
            Some(polygons)
        }
        _ => None,
    }
}

/// D.initial: an axis box around every source vertex with margin max(1, 1024 * resolution).
pub fn initial(vertices: &[P3], resolution: f64) -> Result<Arrangement, ArrangeError> {
    let first = halfspace::vertex(vertices, 0);
    let (mut lo, mut hi) = (first, first);
    for v in vertices {
        lo = v3(v.x.min(lo.x), v.y.min(lo.y), v.z.min(lo.z));
        hi = v3(v.x.max(hi.x), v.y.max(hi.y), v.z.max(hi.z));
    }
    let margin = 1.0f64.max(resolution * 1024.0);
    let lo = v3(lo.x - margin, lo.y - margin, lo.z - margin);
    let hi = v3(hi.x + margin, hi.y + margin, hi.z + margin);
    if !(vec_valid(lo) && vec_valid(hi)) {
        return Err(ArrangeError::Failed { reason: Reason::ResolutionLimit, stage: 0 });
    }
    let vertices = vec![lo, v3(hi.x, lo.y, lo.z), v3(hi.x, hi.y, lo.z), v3(lo.x, hi.y, lo.z), v3(lo.x, lo.y, hi.z), v3(hi.x, lo.y, hi.z), hi, v3(lo.x, hi.y, hi.z)];
    let poly = |origin: P3, n: P3, ids: [u32; 4]| Polygon { surface: plane(origin, n), sense: true, vertices: ids.to_vec() };
    let polygons = vec![
        poly(lo, v3(0.0, 0.0, -1.0), [0, 3, 2, 1]),
        poly(hi, v3(0.0, 0.0, 1.0), [4, 5, 6, 7]),
        poly(lo, v3(0.0, -1.0, 0.0), [0, 1, 5, 4]),
        poly(hi, v3(1.0, 0.0, 0.0), [1, 2, 6, 5]),
        poly(hi, v3(0.0, 1.0, 0.0), [2, 3, 7, 6]),
        poly(lo, v3(-1.0, 0.0, 0.0), [3, 0, 4, 7]),
    ];
    Ok(Arrangement { vertices, cells: vec![polygons], planes: 0 })
}

/// D.arrange: split every cell by every plane in order.
pub fn arrange(planes: &[Surface], mut state: Arrangement, resolution: f64) -> Result<Arrangement, ArrangeError> {
    let margin = Iv::point(resolution);
    for (index, surface) in planes.iter().enumerate() {
        let index = index as u32;
        let sides = halfspace::sides(&state.vertices, origin_of(surface), normal_of(surface), margin);
        if !sides.valid {
            return Err(ArrangeError::Failed { reason: Reason::AmbiguousContact, stage: index });
        }
        let values = sides.values;
        let mut clip = ClipState { vertices: std::mem::take(&mut state.vertices), cuts: Vec::new() };
        let mut cells: Vec<Vec<Polygon>> = Vec::with_capacity(state.cells.len() * 2);
        let old = std::mem::take(&mut state.cells);
        for polygons in old {
            let (negative, positive) = cell_flags(&polygons, &values);
            if negative && positive {
                let neg = halfspace::clip_polygons(&polygons, &values, false, &mut clip);
                let pos = halfspace::clip_polygons(&polygons, &values, true, &mut clip);
                let a = cap(neg, &clip.vertices, *surface, true);
                let b = cap(pos, &clip.vertices, *surface, false);
                match (a, b) {
                    (Some(a), Some(b)) => {
                        cells.push(a);
                        cells.push(b);
                    }
                    _ => return Err(ArrangeError::Failed { reason: Reason::ConstructionFailure, stage: index }),
                }
            } else {
                cells.push(polygons);
            }
            // D.limited: children plus finished cells must stay below 513
            if cells.len() >= 513 {
                return Err(ArrangeError::Failed { reason: Reason::ResolutionLimit, stage: index });
            }
        }
        state = Arrangement { vertices: clip.vertices, cells, planes: index + 1 };
    }
    let n = planes.len() as u32;
    if state.cells.len() >= 513 {
        return Err(ArrangeError::Failed { reason: Reason::ResolutionLimit, stage: n });
    }
    state.planes = n;
    Ok(state)
}

// ---------------------------------------------------------------- selection

/// D.centroid: the average of every polygon vertex occurrence.
pub fn centroid(polygons: &[Polygon], vertices: &[P3]) -> P3 {
    let mut sum = v3(0.0, 0.0, 0.0);
    let mut count = 0u32;
    for p in polygons {
        for i in &p.vertices {
            sum = sum.add(halfspace::vertex(vertices, *i));
            count += 1;
        }
    }
    sum.scale(1.0 / count as f64)
}

/// D.interior: the point is inside every polygon plane by more than the resolution.
fn interior(polygons: &[Polygon], point: P3, resolution: Iv) -> bool {
    polygons.iter().all(|p| {
        let n = normal_of(&p.surface).iv().normalize();
        let outward = if p.sense { n } else { n.scale(Iv::point(-1.0)) };
        let distance = point.iv().sub(origin_of(&p.surface).iv()).dot(outward);
        lt(distance, -resolution, "cell interior")
    })
}

pub enum Selection {
    Selected { polygons: Vec<Polygon>, count: u32 },
    Failed { reason: Reason, stage: u32, index: u32 },
}

/// Q.select: classify every cell's centroid against both operands.
/// Worker threads for the cell classification of `select` (1 = sequential, the measured default).
pub static THREADS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(1);

#[derive(Clone, Copy)]
enum CellOutcome {
    Fail3,
    Fail4,
    Keep(bool),
}

fn classify_cell(cell: &[Polygon], vertices: &[P3], first: &PSolid, second: &PSolid, tol: &Tolerance, res: Iv, subtraction: bool) -> CellOutcome {
    let point = centroid(cell, vertices);
    let volume = halfspace::volume6(cell, vertices, point) / Iv::point(6.0);
    if !(lt(res * res * res, volume, "cell volume") && interior(cell, point, res)) {
        return CellOutcome::Fail3;
    }
    let member = |c: SolidClass| match c {
        SolidClass::Inside => Some(true),
        SolidClass::Outside => Some(false),
        _ => None,
    };
    match (member(first.classify(point, tol, 0.0)), member(second.classify(point, tol, 0.0))) {
        (Some(ai), Some(bi)) => CellOutcome::Keep(if subtraction { ai && !bi } else { ai || bi }),
        _ => CellOutcome::Fail4,
    }
}

/// Q.select with the independent cells classified on the rayon pool (Bend forks the same split).
fn select_parallel(cells: &[Vec<Polygon>], vertices: &[P3], first: &PSolid, second: &PSolid, tol: &Tolerance, resolution: f64, subtraction: bool) -> Selection {
    use rayon::prelude::*;
    let res = Iv::point(resolution);
    let outcomes: Vec<(CellOutcome, Option<&'static str>)> = cells
        .par_iter()
        .map(|cell| {
            reset_undecided();
            let o = classify_cell(cell, vertices, first, second, tol, res, subtraction);
            (o, undecided())
        })
        .collect();
    let mut polygons = Vec::new();
    let mut count = 0u32;
    for (index, (o, site)) in outcomes.into_iter().enumerate() {
        if let Some(site) = site {
            mark_undecided(site);
        }
        let index = index as u32;
        match o {
            CellOutcome::Fail3 => return Selection::Failed { reason: Reason::ResolutionLimit, stage: 3, index },
            CellOutcome::Fail4 => return Selection::Failed { reason: Reason::UnsupportedArrangement, stage: 4, index },
            CellOutcome::Keep(true) => {
                polygons.extend(cells[index as usize].iter().cloned());
                count += 1;
            }
            CellOutcome::Keep(false) => {}
        }
    }
    Selection::Selected { polygons, count }
}

pub fn select(cells: &[Vec<Polygon>], vertices: &[P3], first: &PSolid, second: &PSolid, tol: &Tolerance, resolution: f64, subtraction: bool) -> Selection {
    let res = Iv::point(resolution);
    let res3 = res * res * res;
    if THREADS.load(std::sync::atomic::Ordering::Relaxed) > 1 {
        return select_parallel(cells, vertices, first, second, tol, resolution, subtraction);
    }
    let mut polygons = Vec::new();
    let mut count = 0u32;
    for (index, cell) in cells.iter().enumerate() {
        let index = index as u32;
        let point = centroid(cell, vertices);
        let volume = halfspace::volume6(cell, vertices, point) / Iv::point(6.0);
        let valid = lt(res3, volume, "cell volume") && interior(cell, point, res);
        if !valid {
            return Selection::Failed { reason: Reason::ResolutionLimit, stage: 3, index };
        }
        let member = |c: SolidClass| match c {
            SolidClass::Inside => Some(true),
            SolidClass::Outside => Some(false),
            _ => None,
        };
        let a = member(first.classify(point, tol, 0.0));
        let b = member(second.classify(point, tol, 0.0));
        // planted negative (feature "plant", PLANT=flip): the first operand's membership predicate answers wrong for one cell
        #[cfg(feature = "plant")]
        let a = if crate::plant::active("flip") && a == Some(true) && b == Some(false) && crate::plant::once() { Some(false) } else { a };
        match (a, b) {
            (Some(ai), Some(bi)) => {
                let keep = if subtraction { ai && !bi } else { ai || bi };
                if keep {
                    polygons.extend(cell.iter().cloned());
                    count += 1;
                }
            }
            _ => return Selection::Failed { reason: Reason::UnsupportedArrangement, stage: 4, index },
        }
    }
    Selection::Selected { polygons, count }
}

fn cyclic_equal(a: &[u32], b: &[u32]) -> bool {
    let n = a.len();
    if n != b.len() || n == 0 {
        return false;
    }
    (0..n).any(|r| (0..n).all(|i| a[i] == b[(i + r) % n]))
}

fn cyclic_reversed(a: &[u32], b: &[u32]) -> bool {
    let rev: Vec<u32> = b.iter().rev().copied().collect();
    cyclic_equal(a, &rev)
}

/// Q.boundary: drop every pair of cell polygons with the same vertex ring in
/// opposite orientation (an internal interface); anything else invalid.
pub fn boundary(polygons: Vec<Polygon>) -> Option<(Vec<Polygon>, u32)> {
    let mut rest = polygons;
    let mut kept = Vec::new();
    let mut internal = 0u32;
    while !rest.is_empty() {
        let head = rest.remove(0);
        let mut count = 0u32;
        let mut opposite = true;
        let mut remaining = Vec::with_capacity(rest.len());
        for p in rest.into_iter() {
            let reversed = cyclic_reversed(&head.vertices, &p.vertices);
            let same = reversed || cyclic_equal(&head.vertices, &p.vertices);
            if same {
                count += 1;
                opposite &= reversed;
            } else {
                remaining.push(p);
            }
        }
        rest = remaining;
        if !(count < 2 && opposite) {
            return None;
        }
        if count == 0 {
            kept.push(head);
        } else {
            internal += 1;
        }
    }
    Some((kept, internal))
}

// ---------------------------------------------------------------- better algorithm: propagation

/// Spike variant (not in Bend): cell membership by propagation instead of a
/// ray classification per cell. Every operand face lies on an arrangement
/// plane and is a union of arrangement facets, so every cell is wholly inside
/// or outside each operand, and membership flips across a facet exactly when
/// the facet lies in a face of that operand. The cell holding box corner 0
/// is outside both operands (the corner is outside their bounding box). A
/// breadth-first walk over facets shared by two cells (same vertex ring,
/// reversed) classifies one facet centroid against the coplanar source faces
/// per crossing. Cells the walk does not reach, and any facet whose centroid
/// is not clearly inside or outside a coplanar face, fall back to the full
/// classification (`first/second.classify`), so a refusal stays a refusal.
/// The per-cell volume and interior checks of `select` are kept unchanged.
pub fn select_propagate(cells: &[Vec<Polygon>], vertices: &[P3], first: &PSolid, second: &PSolid, sources: [&Solid; 2], tol: &Tolerance, resolution: f64, subtraction: bool) -> Selection {
    use std::collections::HashMap;
    let res = Iv::point(resolution);
    let res3 = res * res * res;
    for (index, cell) in cells.iter().enumerate() {
        let point = centroid(cell, vertices);
        let volume = halfspace::volume6(cell, vertices, point) / Iv::point(6.0);
        if !(lt(res3, volume, "cell volume") && interior(cell, point, res)) {
            return Selection::Failed { reason: Reason::ResolutionLimit, stage: 3, index: index as u32 };
        }
    }
    // facet key: sorted vertex ids -> (cell, polygon) occurrences
    let mut facets: HashMap<Vec<u32>, Vec<(usize, usize)>> = HashMap::new();
    for (c, cell) in cells.iter().enumerate() {
        for (k, p) in cell.iter().enumerate() {
            let mut key = p.vertices.clone();
            key.sort_unstable();
            facets.entry(key).or_default().push((c, k));
        }
    }
    // membership per cell: None = unknown
    let mut member: Vec<Option<(bool, bool)>> = vec![None; cells.len()];
    let seed = cells.iter().position(|cell| cell.iter().any(|p| p.vertices.contains(&0)));
    let pfaces = [first, second];
    // does the facet lie in a face of operand `op`? Some(bool), None = undecided
    let in_face = |op: usize, poly: &Polygon| -> Option<bool> {
        let solid = sources[op];
        let mut inside = false;
        for (i, f) in solid.faces.iter().enumerate() {
            if !plane_equal(&f.surface, &poly.surface) {
                continue;
            }
            let point = centroid(std::slice::from_ref(poly), vertices);
            match pfaces[op].faces[i].classify(point, tol, 0.0) {
                crate::face::FaceClass::Inside => inside = !inside,
                crate::face::FaceClass::Outside => {}
                _ => return None,
            }
        }
        Some(inside)
    };
    if let Some(s) = seed {
        member[s] = Some((false, false));
        let mut queue = std::collections::VecDeque::from([s]);
        while let Some(c) = queue.pop_front() {
            let (ma, mb) = member[c].unwrap();
            for p in &cells[c] {
                let mut key = p.vertices.clone();
                key.sort_unstable();
                let Some(occ) = facets.get(&key) else { continue };
                let [(x, _), (y, j)] = occ.as_slice() else { continue };
                let (other, oj) = if *x == c { (*y, *j) } else { (*x, occ[0].1) };
                if member[other].is_some() || !cyclic_reversed(&p.vertices, &cells[other][oj].vertices) {
                    continue;
                }
                let (Some(fa), Some(fb)) = (in_face(0, p), in_face(1, p)) else { continue };
                member[other] = Some((ma ^ fa, mb ^ fb));
                queue.push_back(other);
            }
        }
    }
    let mut polygons = Vec::new();
    let mut count = 0u32;
    for (index, cell) in cells.iter().enumerate() {
        let (ai, bi) = match member[index] {
            Some(m) => m,
            None => {
                let point = centroid(cell, vertices);
                let member = |c: SolidClass| match c {
                    SolidClass::Inside => Some(true),
                    SolidClass::Outside => Some(false),
                    _ => None,
                };
                match (member(first.classify(point, tol, 0.0)), member(second.classify(point, tol, 0.0))) {
                    (Some(a), Some(b)) => (a, b),
                    _ => return Selection::Failed { reason: Reason::UnsupportedArrangement, stage: 4, index: index as u32 },
                }
            }
        };
        let keep = if subtraction { ai && !bi } else { ai || bi };
        if keep {
            polygons.extend(cell.iter().cloned());
            count += 1;
        }
    }
    Selection::Selected { polygons, count }
}
