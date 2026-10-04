//! P8 planar feature-size certificate. All distances and rounding bounds are
//! rational, in the retained construction frame, never from world caches.
//! Closest features of planar polygons are vertex/face or edge/edge; boundary
//! cases reduce to vertex/edge or vertex/vertex. Incidence is excluded, not
//! interpreted as a zero-size feature. Nothing is snapped or approximated.
//!
//! C9's binary64 term is the actual source-coordinate rounding bound, not
//! epsilon times the model extent: binary64 inputs can have a real one-ulp gap
//! (AC42). The L1 rounding error bounds Euclidean error; interpolation on a
//! segment or a triangulated face is bounded by its largest vertex error.
//! A separation must exceed the sum of those bounds. Placements remain exact
//! and separate: flattening a huge placement is a future writer's obligation.
//! C9's 4*curve-budget term is zero here: Curve3 has only analytic lines.
use num_traits::{Signed, Zero};
use wonky_geom::model::{Bounds, Curve3, Model, VertexId};
use wonky_geom::{dot, sub, Point, Refused, Result, Q};

const SUB_RESOLUTION: &str = "boolean/sub-resolution-feature";
const PAIR_BUDGET: usize = 1 << 20;

/// Exact measured minimum and the number of positive feature separations
/// checked. This is product data returned by the admission routine, not a
/// human certificate or a substitute for the Model audit.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FeatureSize {
    pub minimum_distance2: Q,
    pub checks: usize,
}

fn add(p: &Point, d: &Point, t: &Q) -> Point {
    std::array::from_fn(|k| &p[k] + &d[k] * t)
}
fn norm2(p: &Point) -> Q {
    dot(p, p)
}
fn point_segment(p: &Point, a: &Point, b: &Point) -> Q {
    let d = sub(b, a);
    let n = norm2(&d);
    let t = dot(&sub(p, a), &d);
    if t <= Q::zero() {
        norm2(&sub(p, a))
    } else if t >= n {
        norm2(&sub(p, b))
    } else {
        norm2(&sub(p, &add(a, &d, &(t / n))))
    }
}
fn segment_segment(a: &Point, b: &Point, c: &Point, d: &Point) -> Q {
    let mut best = [
        point_segment(a, c, d),
        point_segment(b, c, d),
        point_segment(c, a, b),
        point_segment(d, a, b),
    ]
    .into_iter()
    .min()
    .unwrap();
    let (u, v, w) = (sub(b, a), sub(d, c), sub(a, c));
    let (uu, uv, vv, uw, vw) = (
        dot(&u, &u),
        dot(&u, &v),
        dot(&v, &v),
        dot(&u, &w),
        dot(&v, &w),
    );
    let det = &uu * &vv - &uv * &uv;
    if det.is_positive() {
        let s = (&uv * &vw - &vv * &uw) / &det;
        let t = (&uu * &vw - &uv * &uw) / det;
        let one = Q::from_integer(1.into());
        if s >= Q::zero() && s <= one && t >= Q::zero() && t <= one {
            best = best.min(norm2(&sub(&add(a, &u, &s), &add(c, &v, &t))));
        }
    }
    best
}

/// Certify edge extents and every nonincident planar clearance. Called on
/// normalized, audited output before Boolean success (including solids()).
pub fn certify(model: &Model) -> Result<FeatureSize> {
    let d = model.draft();
    let points: Vec<&Point> = (0..d.vertices.len())
        .map(|v| model.key(VertexId(v as u32)).rational())
        .collect::<wonky_geom::Result<Vec<_>>>()
        .map_err(|e| Refused(e.0))?;
    let errors = (0..points.len())
        .map(|v| {
            model
                .source_rounding_error(VertexId(v as u32))
                .map_err(|_| Refused("boolean/budget-exceeded:binary64-range"))
        })
        .collect::<Result<Vec<_>>>()?;
    let edges: Vec<[usize; 2]> = d
        .edges
        .iter()
        .map(|e| match &d.curves[e.curve.index()].geometry {
            Curve3::Circle(_) | Curve3::TranslatedCircle(_) | Curve3::RadicalCircle(_) => Err(Refused("boolean/ssi-row-unavailable:circle/feature-size")),
            Curve3::Line { .. } | Curve3::RadicalLine { .. } => match e.bounds {
                Bounds::Segment(v) => Ok(v.map(|v| v.index())),
                Bounds::Ring => Err(Refused("boolean/contract-violation:merge/line-ring")),
            },
        })
        .collect::<Result<_>>()?;
    let n = points
        .len()
        .checked_add(edges.len())
        .and_then(|n| n.checked_add(d.faces.len()))
        .ok_or(Refused("boolean/budget-exceeded:feature-size"))?;
    if n.checked_mul(n).is_none_or(|n| n > PAIR_BUDGET) {
        return Err(Refused("boolean/budget-exceeded:feature-size"));
    }
    let mut minimum: Option<Q> = None;
    let mut checks = 0;
    let mut check = |distance2: Q, floor: Q| -> Result<()> {
        if distance2.is_zero() {
            return Err(Refused(
                "boolean/contract-violation:merge/nonincident-contact",
            ));
        }
        if distance2 <= &floor * &floor {
            return Err(Refused(SUB_RESOLUTION));
        }
        minimum = Some(
            minimum
                .take()
                .map_or(distance2.clone(), |m| m.min(distance2)),
        );
        checks += 1;
        Ok(())
    };
    for (i, p) in points.iter().enumerate() {
        for j in i + 1..points.len() {
            check(norm2(&sub(p, points[j])), &errors[i] + &errors[j])?;
        }
    }
    let edge_error = |e: [usize; 2]| errors[e[0]].clone().max(errors[e[1]].clone());
    for (i, &[a, b]) in edges.iter().enumerate() {
        check(norm2(&sub(points[a], points[b])), &errors[a] + &errors[b])?;
        for (v, p) in points.iter().enumerate() {
            if v != a && v != b {
                check(
                    point_segment(p, points[a], points[b]),
                    &errors[v] + edge_error([a, b]),
                )?;
            }
        }
        for &[c, e] in &edges[i + 1..] {
            if [a, b].iter().any(|v| [c, e].contains(v)) {
                continue;
            }
            check(
                segment_segment(points[a], points[b], points[c], points[e]),
                edge_error([a, b]) + edge_error([c, e]),
            )?;
        }
    }
    for f in &d.faces {
        let plane = d.surfaces[f.surface.index()]
            .carrier
            .plane()
            .map_err(|e| Refused(e.0))?;
        let loops: Vec<Vec<usize>> = f
            .loops
            .iter()
            .map(|lp| {
                d.loops[lp.index()]
                    .coedges
                    .iter()
                    .map(|c| {
                        let co = &d.coedges[c.index()];
                        let [a, b] = edges[co.edge.index()];
                        if co.forward {
                            a
                        } else {
                            b
                        }
                    })
                    .collect()
            })
            .collect();
        let vertices: Vec<usize> = loops.iter().flatten().copied().collect();
        let error = vertices.iter().map(|&v| errors[v].clone()).max().unwrap();
        let n2 = norm2(&plane.n);
        for (v, p) in points.iter().enumerate() {
            if vertices.contains(&v) {
                continue;
            }
            let side = plane.side(p);
            let projection = add(p, &plane.n, &(-&side / &n2));
            // Exact winding in the existing chart engine; holes retain sense.
            let at = wonky_curve::ExactPoint::from_rational(plane.chart(&projection)?);
            let mut winding = 0;
            let mut boundary = false;
            for lp in &loops {
                for k in 0..lp.len() {
                    let seg = wonky_curve::Trimmed::new(
                        [
                            wonky_curve::ExactPoint::from_rational(plane.chart(points[lp[k]])?),
                            wonky_curve::ExactPoint::from_rational(
                                plane.chart(points[lp[(k + 1) % lp.len()]])?,
                            ),
                        ],
                        wonky_curve::Carrier::Line,
                    )
                    .map_err(|e| Refused(e.name()))?;
                    if seg.contains(&at).map_err(|e| Refused(e.name()))? {
                        boundary = true;
                    } else {
                        winding += seg.winding(&at).map_err(|e| Refused(e.name()))?;
                    }
                }
            }
            if boundary || winding != 0 {
                check(&side * &side / &n2, &errors[v] + &error)?;
            }
        }
    }
    Ok(FeatureSize {
        minimum_distance2: minimum
            .ok_or(Refused("boolean/contract-violation:merge/no-features"))?,
        checks,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use wonky_geom::point;
    #[test]
    fn skew_edges_have_an_interior_minimum_not_seen_by_endpoints() {
        let [a, b, c, d] = [
            [-1., 0., 0.],
            [1., 0., 0.],
            [0., -1., 0.125],
            [0., 1., 0.125],
        ]
        .map(|p| point(p).unwrap());
        assert_eq!(
            segment_segment(&a, &b, &c, &d),
            Q::from_float(0.125 * 0.125).unwrap()
        );
        assert!(point_segment(&a, &c, &d) > segment_segment(&a, &b, &c, &d));
    }
}
