//! Inward source-frame shell of a box, removing one rectangular face.
//!
//! Thickness and offsets belong to the exact construction frame, just as blend
//! radii do. A Frame::Interpreter maps the result, not the construction inputs.
//! SourceMetric admits the near-isometric observation budget; no constant world
//! thickness is claimed for a non-isometry. Planar export uses the existing
//! affine vertex/carrier rounding budget. Shell history is replayed on decode.
use crate::{
    orthogonal,
    polyhedron::{Audited, Refused},
    source_frame::SourceMetric,
};
use num_rational::BigRational as Q;
use num_traits::{One, Zero};
use wonky_contract::*;
use wonky_num::expansion::{self as ex, Guard};

type R<T> = std::result::Result<T, Refused>;
fn no(s: &str) -> Refused {
    Refused(format!("shell/{s}"))
}
fn scalar(x: f64) -> R<Binary64> {
    Binary64::new(x).map_err(|_| no("numeric-range"))
}

/// Side code = axis * 2 + (1 for max, 0 for min). Removed plane is unchanged;
/// every remaining plane moves inward by the positive source thickness, exactly.
pub(crate) fn cavity(bounds: [[f64; 3]; 2], thickness: f64, side: usize) -> R<[[f64; 3]; 2]> {
    if side >= 6 {
        return Err(no("removed-side"));
    }
    if !thickness.is_finite() || thickness <= 0. {
        return Err(no("nonpositive-thickness"));
    }
    let mut inner = bounds;
    for end in 0..2 {
        for axis in 0..3 {
            if side == axis * 2 + end {
                continue;
            }
            let mut g = Guard::new();
            let (s, e) = ex::two_sum(
                bounds[end][axis],
                if end == 0 { thickness } else { -thickness },
                &mut g,
            );
            if !g.exact() || e != 0. {
                return Err(no("offset-not-binary64"));
            }
            inner[end][axis] = s;
        }
    }
    if !(0..3).all(|k| inner[0][k] < inner[1][k]) {
        return Err(no("collapsed-cavity"));
    }
    Ok(inner)
}

/// Admission by audited geometry, not by vertex count alone.
fn box_bounds(a: &Audited) -> R<[[f64; 3]; 2]> {
    let cells = a.orthogonal.as_ref().ok_or_else(|| no("non-box-source"))?;
    if cells.boxes.len() != 1 {
        return Err(no("non-box-source"));
    }
    Ok(cells.boxes[0])
}

fn face_side(a: &Audited, index: usize, bounds: [[f64; 3]; 2]) -> R<usize> {
    let face = a
        .body
        .faces
        .get(index)
        .ok_or_else(|| no("face-reference"))?;
    let SurfaceGeometry::Plane { origin, normal, .. } =
        &a.body.surfaces[face.surface.0 as usize].geometry
    else {
        return Err(no("non-planar-face"));
    };
    for axis in 0..3 {
        for end in 0..2 {
            let expected = [0, 1, 2].map(|k| {
                if k == axis {
                    if end == 0 {
                        -1.
                    } else {
                        1.
                    }
                } else {
                    0.
                }
            });
            if normal.map(|x| x.get()) == expected && origin[axis].get() == bounds[end][axis] {
                return Ok(axis * 2 + end);
            }
        }
    }
    Err(no("non-box-face"))
}

pub fn shell(a: &Audited, face: usize, thickness: f64) -> R<Body> {
    SourceMetric::new(&a.frame)?;
    let frame = a.frame.as_affine()?;
    let bounds = box_bounds(a)?;
    let side = face_side(a, face, bounds)?;
    cavity(bounds, thickness, side)?;
    let mut nodes = a.body.constructions.clone();
    let root = nodes.len();
    nodes.push(Construction {
        operation: Operation::Shell {},
        rule_version: 1,
        parents: vec![NodeId(orthogonal::root(&a.body)? as u32)],
        parameters: vec![scalar(thickness)?, scalar(side as f64)?],
        frame: a.body.vertices[0].frame,
    });
    let mut key = a.body.key.clone();
    key.revision = key
        .revision
        .checked_add(1)
        .ok_or_else(|| no("revision-range"))?;
    let mut bodies = orthogonal::construct(key, frame, nodes, root)?;
    if bodies.len() != 1 {
        return Err(no("disconnected-result"));
    }
    Ok(bodies.remove(0))
}

type V = [Q; 3];
fn q(x: f64) -> Q {
    Q::from_float(x).unwrap()
}
fn dot(a: &V, b: &V) -> Q {
    (0..3).map(|k| &a[k] * &b[k]).sum()
}
fn sub(a: &V, b: &V) -> V {
    std::array::from_fn(|k| &a[k] - &b[k])
}
fn segment_distance(a: &V, b: &V, p: &V) -> R<Q> {
    let v = sub(b, a);
    let w = sub(p, a);
    let vv = dot(&v, &v);
    if vv.is_zero() {
        return Err(no("query-degenerate-face"));
    }
    let t = (dot(&w, &v) / vv).max(Q::zero()).min(Q::one());
    let d = std::array::from_fn(|k| &w[k] - &t * &v[k]);
    Ok(dot(&d, &d))
}

/// Exact WORLD distance to a finite face, not to its infinite plane or to a
/// source-coordinate rectangle under a falsely isometric transpose inverse.
/// A box face maps to a parallelogram. Its minimum is the interior Gram solve
/// (when within the trims) or one of four closed edges. Rationals are temporary
/// predicate operands only; no rounded point becomes construction geometry.
fn face_distance(a: &Audited, bounds: [[f64; 3]; 2], side: usize, point: &V) -> R<Q> {
    let axis = side / 2;
    let u = (axis + 1) % 3;
    let v = (axis + 2) % 3;
    let mut corners = Vec::with_capacity(4);
    for (i, j) in [(0, 0), (1, 0), (1, 1), (0, 1)] {
        let mut p = bounds[0];
        p[axis] = bounds[side % 2][axis];
        p[u] = bounds[i][u];
        p[v] = bounds[j][v];
        corners.push(
            a.frame
                .apply_exact(p, 1., true)
                .map_err(|_| no("query-numeric-range"))?
                .map(|e| e.into_iter().map(q).sum()),
        );
    }
    let x = sub(&corners[1], &corners[0]);
    let y = sub(&corners[3], &corners[0]);
    let w = sub(point, &corners[0]);
    let xx = dot(&x, &x);
    let yy = dot(&y, &y);
    let xy = dot(&x, &y);
    let det = &xx * &yy - &xy * &xy;
    if det <= Q::zero() {
        return Err(no("query-degenerate-face"));
    }
    let wx = dot(&w, &x);
    let wy = dot(&w, &y);
    let s = (&wx * &yy - &wy * &xy) / &det;
    let t = (&wy * &xx - &wx * &xy) / &det;
    if s >= Q::zero() && s <= Q::one() && t >= Q::zero() && t <= Q::one() {
        let d = std::array::from_fn(|k| &w[k] - &s * &x[k] - &t * &y[k]);
        return Ok(dot(&d, &d));
    }
    (0..4)
        .map(|i| segment_distance(&corners[i], &corners[(i + 1) % 4], point))
        .collect::<R<Vec<_>>>()?
        .into_iter()
        .min()
        .ok_or_else(|| no("query-empty-face"))
}

/// The point is the interpreter's WORLD binary64 value. The tie tolerance is
/// explicit query input, never a construction weld or topology tolerance.
pub fn closest_faces(
    a: &Audited,
    candidates: &[usize],
    point: [f64; 3],
    tolerance: f64,
) -> R<Vec<usize>> {
    let bounds = box_bounds(a)?;
    if !point.iter().all(|x| x.is_finite()) || !tolerance.is_finite() || tolerance < 0. {
        return Err(no("query-numeric-range"));
    }
    let point = point.map(q);
    let distances = candidates
        .iter()
        .map(|&f| face_distance(a, bounds, face_side(a, f, bounds)?, &point))
        .collect::<R<Vec<_>>>()?;
    let Some(minimum) = distances.iter().min() else {
        return Ok(vec![]);
    };
    let t = q(tolerance);
    let t2 = &t * &t;
    let rhs = Q::from_integer(4.into()) * minimum * &t2;
    Ok(candidates
        .iter()
        .zip(&distances)
        .filter_map(|(&id, d)| {
            // sqrt(d) <= sqrt(min) + t iff d-min-t² <= 0 or
            // (d-min-t²)² <= 4*min*t². No rounded sqrt makes this decision.
            let residual = d - minimum - &t2;
            (residual <= Q::zero() || &residual * &residual <= rhs).then_some(id)
        })
        .collect())
}
