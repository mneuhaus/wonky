//! Sketch regions selected by a point over the exact arrangement of a sketch
//! (std query.fs qContainsPoint and qClosestTo on `qSketchRegion`), curved
//! regions included. `region_query` answers the loose line-only sketches.
//!
//! Every decision is exact. The foot of the world point on the sketch plane is
//! an exact rational point of sketch coordinates (Cramer on the binary64 frame,
//! never normalized) and the squared height over the plane is an exact ratio.
//! A cell (a bounded region of `wonky_curve::arrange`) then contains the foot
//! when it lies on one of the cell's boundary pieces, or inside the outer cycle
//! and outside every hole cycle (exact winding numbers). The distance from the
//! point to a cell is its height when the foot is in or on the cell, and
//! otherwise the certified distance to the nearest boundary piece added in
//! quadrature; sketch distances are widened by the frame's orthonormality
//! defect, since the frame's axes are binary64 directions.
//! - contains: the cells within `tie` metres of the point (TOLERANCE.zeroLength;
//!   a point that toWorld rounded off a rotated plane still lies in its cell);
//! - closest: every cell within `tie` of the closest.
//!
//! A point on the shared edge or vertex of several cells (or within `tie` of
//! several) is not decided: std query.fs documents `qContainsPoint` only as
//! "all entities ... containing a specified point" and does not say whether a
//! point on an edge shared by two regions is contained by both (OM5 in the gear
//! plan is unmeasured), so the selection refuses
//! `sketch-region/point-on-boundary` instead of taking one side or both. A
//! point on the boundary of exactly one candidate is inside it.
use crate::affine::Affine;
use crate::polyhedron::Refused;
use crate::region_query::{CLOSEST, CONTAINS};
use crate::sketch_regions::arranged;
use wonky_curve as wc;
use wonky_curve::numeric::{enclose, q};
use wonky_num::{Iv, Scalar};

type R<T> = Result<T, Refused>;
type V = [wc::Q; 3];
fn no(s: &str) -> Refused {
    Refused(format!("sketch-region/{s}"))
}
fn dot(a: &V, b: &V) -> wc::Q {
    &a[0] * &b[0] + &a[1] * &b[1] + &a[2] * &b[2]
}
fn cross(a: &V, b: &V) -> V {
    [&a[1] * &b[2] - &a[2] * &b[1], &a[2] * &b[0] - &a[0] * &b[2], &a[0] * &b[1] - &a[1] * &b[0]]
}

/// The foot of the point on the sketch plane and its squared height.
struct Foot {
    at: wc::ExactPoint,
    height2: wc::Q,
}
/// Cramer on p - origin = u x + v y + w m with y = z cross x and m = x cross y,
/// det[x, y, m] = m.m (the frame of affine.rs: origin + u x + v y, unnormalized).
fn foot(frame: &Affine, point: [f64; 3]) -> R<Foot> {
    let v = |a: [f64; 3]| a.map(q);
    let (o, x, z) = (v(frame.origin), v(frame.x), v(frame.z));
    let y = cross(&z, &x);
    let m = cross(&x, &y);
    let det = dot(&m, &m);
    if det <= q(0.) {
        return Err(no("degenerate-frame"));
    }
    let p = v(point);
    let d: V = std::array::from_fn(|k| &p[k] - &o[k]);
    let (nu, nv, w) = (dot(&cross(&y, &m), &d), dot(&cross(&m, &x), &d), dot(&m, &d));
    Ok(Foot { at: wc::ExactPoint::from_rational([nu / &det, nv / &det]), height2: &w * &w / &det })
}

enum Where {
    Inside,
    Boundary,
    Outside,
}
/// Where the exact point lies against a bounded cell: on one of its boundary
/// pieces, inside its outer cycle and outside every hole, or outside.
fn locate(arr: &wc::Arrangement, cell: &wc::Cell, p: &wc::ExactPoint) -> R<Where> {
    for &h in cell.cycles.iter().flatten() {
        if arr.pieces[h / 2].seg.contains(p)? {
            return Ok(Where::Boundary);
        }
    }
    // Off every piece of the cell, so the windings are defined; the outer cycle
    // is counter-clockwise and a hole cycle clockwise (the cell on their left).
    if arr.cycle_profile(&cell.cycles[0]).winding(p)? == 0 {
        return Ok(Where::Outside);
    }
    for hole in &cell.cycles[1..] {
        if arr.cycle_profile(hole).winding(p)? != 0 {
            return Ok(Where::Outside);
        }
    }
    Ok(Where::Inside)
}

/// Certified distance in metres from the point to the closed cell.
fn distance(arr: &wc::Arrangement, cell: &wc::Cell, f: &Foot, scale: Iv) -> R<Iv> {
    let inplane = match locate(arr, cell, &f.at)? {
        Where::Inside | Where::Boundary => Iv::point(0.),
        Where::Outside => {
            // The least distance lies between the least lower and the least
            // upper bound of the pieces' certified distances.
            let (mut lo, mut hi) = (f64::INFINITY, f64::INFINITY);
            for &h in cell.cycles.iter().flatten() {
                let d = arr.pieces[h / 2].seg.distance(&f.at)?;
                lo = lo.min(d.lo().max(0.));
                hi = hi.min(d.hi());
            }
            if !hi.is_finite() {
                return Err(no("empty-cell"));
            }
            let m = 0.5 * lo + 0.5 * hi;
            Iv { m, r: (hi - m).max(m - lo).next_up() } * scale
        }
    };
    let height = if f.height2 == q(0.) { Iv::point(0.) } else { enclose(&f.height2)?.sqrt() };
    let out = inplane.norm3(height, Iv::point(0.));
    if out.is_nan() {
        return Err(no("numeric-range"));
    }
    Ok(out)
}

/// The indices of the regions (of the sketch's arrangement, numbered as
/// `sketch_regions::regions` numbers them) that a query selects for `point`
/// (world metres), deciding only among the `candidates` (each named once) as
/// `region_query::select` does. The result is in candidate order.
pub fn select(
    frame: &Affine,
    lines: &[[f64; 4]],
    arcs: &[[f64; 6]],
    circles: &[[f64; 3]],
    candidates: &[usize],
    point: [f64; 3],
    mode: u32,
    tie: f64,
) -> R<Vec<usize>> {
    let (arr, order) = arranged(lines, arcs, circles)?;
    let mut seen = vec![false; order.len()];
    for &c in candidates {
        if c >= order.len() || std::mem::replace(&mut seen[c], true) {
            return Err(no("invalid-candidates"));
        }
    }
    if point.iter().chain(&frame.origin).chain(&frame.x).chain(&frame.z).any(|v| !v.is_finite()) || !tie.is_finite() || tie < 0. {
        return Err(no("invalid-input"));
    }
    if candidates.is_empty() {
        return Ok(vec![]);
    }
    let f = foot(frame, point)?;
    // Sketch distances scale into world distances by a factor in [1 - 3d, 1 + 3d]
    // (affine.rs `orthonormality_defect`: d bounds |G - I| entrywise, 3d the
    // spectral norm).
    let defect = frame.orthonormality_defect().map_err(|_| no("numeric-range"))?;
    let scale = Iv { m: 1., r: (3. * defect).next_up() };
    let ds = candidates.iter().map(|&c| distance(&arr, &arr.cells[order[c]], &f, scale)).collect::<R<Vec<_>>>()?;
    let within = |d: Iv, limit: f64| -> R<bool> {
        if d.hi() <= limit {
            Ok(true)
        } else if d.lo() > limit {
            Ok(false)
        } else {
            Err(no("tie-undecided"))
        }
    };
    let chosen = match mode {
        CONTAINS => {
            let mut chosen = vec![];
            for (i, d) in ds.iter().enumerate() {
                if within(*d, tie)? {
                    chosen.push(i);
                }
            }
            // Several cells touch the point: it lies on their shared boundary.
            if chosen.len() > 1 {
                return Err(no("point-on-boundary"));
            }
            chosen
        }
        CLOSEST => {
            // A cell is kept when it is certainly within `tie` of the closest and
            // dropped when it is certainly beyond; anything between is undecided.
            let least_lo = ds.iter().map(|d| d.lo()).fold(f64::INFINITY, f64::min);
            let least_hi = ds.iter().map(|d| d.hi()).fold(f64::INFINITY, f64::min);
            let (keep, drop) = ((least_lo + tie).next_down(), (least_hi + tie).next_up());
            let mut chosen = vec![];
            for (i, d) in ds.iter().enumerate() {
                if d.hi() <= keep {
                    chosen.push(i);
                } else if d.lo() <= drop {
                    return Err(no("tie-undecided"));
                }
            }
            chosen
        }
        _ => return Err(Refused("sketch-region/invalid-mode".into())),
    };
    Ok(chosen.into_iter().map(|i| candidates[i]).collect())
}
