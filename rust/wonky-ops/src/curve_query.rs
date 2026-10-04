//! Closest analytic line/circle edges in exact construction charts.
//! Audits supply authoritative source geometry; enclosures only certify world
//! ordering and the documented query tie frontier, never approximate answers.
use crate::{
    arc_profile::ArcPrism,
    placement::Placement,
    polyhedron::{Audited, Refused},
};
use wonky_contract::*;
use wonky_curve as wc;
type R<T> = std::result::Result<T, Refused>;
fn no(s: &str) -> Refused {
    Refused(format!("edge-query/{s}"))
}

/// Authoritative exact geometry when WC0 vertices/carriers are rounded caches.
/// A horizontal edge may expand to several arrangement pieces; the caller
/// maps their results back to the one topological edge.
#[derive(Clone)]
pub(crate) enum SourceEdge {
    Horizontal(wc::Trimmed, num_rational::BigRational),
    Line([[num_rational::BigRational; 3]; 2]),
}

pub(crate) struct Candidate<'a> {
    pub body: &'a Body,
    pub frame: &'a Placement,
    pub quarter_arcs: bool,
    pub arcs: Option<&'a ArcPrism>,
    pub index: usize,
    pub source: Option<SourceEdge>,
}
impl<'a> Candidate<'a> {
    pub fn planar(a: &'a Audited, index: usize) -> R<Self> {
        Ok(Self {
            body: &a.body,
            frame: &a.frame,
            quarter_arcs: a.rounded.is_some()
                || a.corner.is_some()
                || a.arcs.as_ref().is_some_and(|s| s.rim.is_some()),
            arcs: a.arcs.as_ref(),
            index,
            source: a.arcs.as_ref().filter(|s| s.rim.is_none()).map(|s| -> R<Option<SourceEdge>> {
                let n = s.profile.segments().len();
                let Some(edge) = a.body.edges.get(index) else { return Ok(None); };
                if index < 2 * n {
                    Ok(Some(SourceEdge::Horizontal(s.profile.segments()[index % n].clone(), wc::numeric::q(s.levels[index / n]))))
                } else {
                    let at = |id: VertexId| -> R<_> {
                        let xy = s.profile.segments()[id.0 as usize % n].ends()[0].rat()?;
                        Ok([xy[0].clone(), xy[1].clone(), wc::numeric::q(s.levels[id.0 as usize / n])])
                    };
                    Ok(Some(SourceEdge::Line([at(edge.vertices[0])?, at(edge.vertices[1])?])))
                }
            }).transpose()?.flatten(),
        })
    }

    pub fn sourced(body: &'a Body, frame: &'a Placement, index: usize, source: SourceEdge) -> Self {
        Self { body, frame, index, source: Some(source), quarter_arcs: false, arcs: None }
    }
}

// A translated seam chart is not the source frame. Sum its translations as
// rationals before any distance decision; never flatten them to rounded f64.
fn chart_point(body: &Body, p: Vector3, mut id: FrameId) -> R<[num_rational::BigRational; 3]> {
    use num_rational::BigRational as Q;
    let mut p = p.map(|x| Q::from_float(x.get()).unwrap());
    while id != FrameId(1) {
        match body.frames.get(id.0 as usize) {
            Some(Frame::Rigid {
                parent,
                translation,
                angle,
                ..
            }) if parent.0 < id.0 && angle.get() == 0. => {
                for i in 0..3 {
                    p[i] += Q::from_float(translation[i].get()).unwrap();
                }
                id = *parent;
            }
            _ => return Err(no("query-chart-frame-unimplemented")),
        }
    }
    Ok(p)
}

/// Closest trimmed-circle/line queries. Strictly separated enclosures decide
/// ordering; exact coincident distance expressions keep ties. An unresolved
/// radical/tolerance comparison refuses instead of substituting the arc chord.
pub(crate) fn closest(candidates: &[Candidate<'_>], point: [f64; 3], tie: f64) -> R<Vec<usize>> {
    use num_rational::BigRational as Q;
    use num_traits::{ToPrimitive, Zero};
    use wonky_num::ball::{Iv, Scalar};
    let q = |x| Q::from_float(x).unwrap();
    let enclose = |x: &Q| -> R<Iv> {
        let m = x.to_f64().ok_or_else(|| no("query-range"))?;
        if !m.is_finite() {
            return Err(no("query-range"));
        }
        let l = if q(m) > *x { m.next_down() } else { m };
        let h = if q(m) < *x { m.next_up() } else { m };
        crate::rounding::finite_ball(if l == h {
            Iv::point(l)
        } else {
            Iv {
                m: l,
                r: (h - l).next_up(),
            }
        })
        .map_err(|_| no("query-range"))
    };
    let mut values: Vec<(Q, Q, Iv)> = vec![];
    let mut all_isometric = true;
    for a in candidates {
        let metric = crate::source_frame::SourceMetric::new(a.frame)?;
        all_isometric &= metric.is_isometry();
        let e = a.body.edges.get(a.index).ok_or_else(|| no("edge-index"))?;
        let c = &a.body.curves[e.curve.0 as usize];
        let p = crate::source_frame::inverse(a.frame, point, 1.)?;
        let endpoints = || -> R<[[Q; 3]; 2]> {
            match &a.source {
                Some(SourceEdge::Horizontal(seg, level)) => {
                    let at = |p: &wc::ExactPoint| -> R<_> {
                        let xy = p.rat()?;
                        Ok([xy[0].clone(), xy[1].clone(), level.clone()])
                    };
                    return Ok([at(&seg.ends()[0])?, at(&seg.ends()[1])?]);
                },
                Some(SourceEdge::Line(ends)) => return Ok(ends.clone()),
                None => {}
            }
            if e.vertices.len() != 2 {
                return Err(no("query-endpoints-unimplemented"));
            }
            let at = |id: VertexId| {
                let v = &a.body.vertices[id.0 as usize];
                chart_point(a.body, v.point, v.frame)
            };
            Ok([at(e.vertices[0])?, at(e.vertices[1])?])
        };
        let dot = |a: &[Q; 3], b: &[Q; 3]| (0..3).map(|k| &a[k] * &b[k]).sum::<Q>();
        let sub = |a: &[Q; 3], b: &[Q; 3]| std::array::from_fn(|k| &a[k] - &b[k]);
        // Three-point arcs have rational source centres and squared radii.
        // Their serialized circle axes and radius are rounded export caches.
        let source_segment = a
            .arcs
            .and_then(|prism| {
                let count = prism.profile.segments().len();
                let ring = a.index / count;
                let index = a.index % count;
                if let Some(rim) = &prism.rim {
                    match ring {
                        0 => Some((&prism.profile.segments()[index], prism.levels[if rim.bottom { 1 } else { 0 }])),
                        1 => Some((&prism.profile.segments()[index], rim.center_z)),
                        2 => Some((&rim.inner.segments()[index], prism.levels[if rim.bottom { 0 } else { 1 }])),
                        _ => None,
                    }
                } else {
                    (ring < 2).then(|| (&prism.profile.segments()[index], prism.levels[ring]))
                }
            });
        let source_segment = match &a.source {
            Some(SourceEdge::Horizontal(seg, level)) => Some((seg, level.clone())),
            Some(SourceEdge::Line(_)) | None => source_segment.map(|(seg, level)| (seg, q(level))),
        };
        let source_arc = match &source_segment {
            Some((segment, level)) => match segment.chart() {
                wc::Chart::Circle(circle) => Some((*segment, circle, level)),
                wc::Chart::Line => None,
                wc::Chart::BSpline(_) => return Err(wc::Refusal::SplineArrangement.into()),
            },
            None => None,
        };
        let (n, k) = if let Some((segment, circle, level)) = source_arc {
            let centre = circle.c.rat()?;
            let r2 = circle.r2.rational().ok_or_else(|| no("query-circle-radius-class"))?;
            let d = [&p[0] - &centre[0], &p[1] - &centre[1]];
            if segment.angular(&d, false) {
                let radial2 = &d[0] * &d[0] + &d[1] * &d[1];
                let z = &p[2] - level;
                (
                    &radial2 + &z * &z + &r2,
                    q(4.) * &r2 * radial2,
                )
            } else {
                let ends = endpoints()?;
                let u = sub(&p, &ends[0]);
                let v = sub(&p, &ends[1]);
                (dot(&u, &u).min(dot(&v, &v)), Q::zero())
            }
        } else {
            match &c.geometry {
                CurveGeometry::Line { .. } => {
                    let ends = endpoints()?;
                    let d = sub(&ends[1], &ends[0]);
                    let w = sub(&p, &ends[0]);
                    let dd = dot(&d, &d);
                    if dd.is_zero() {
                        return Err(no("query-degenerate-edge"));
                    }
                    let t = (dot(&w, &d) / dd).max(Q::zero()).min(q(1.));
                    let r: [Q; 3] = std::array::from_fn(|k| &w[k] - &t * &d[k]);
                    (dot(&r, &r), Q::zero())
                }
                CurveGeometry::Circle {
                    origin,
                    normal,
                    x,
                    radius,
                    arc,
                } if matches!(arc, ArcKind::Full {}) || a.quarter_arcs => {
                    let o = chart_point(a.body, *origin, c.frame)?;
                    let z = normal.map(|x| q(x.get()));
                    let x = x.map(|x| q(x.get()));
                    let y: [Q; 3] = std::array::from_fn(|k| {
                        &z[(k + 1) % 3] * &x[(k + 2) % 3] - &z[(k + 2) % 3] * &x[(k + 1) % 3]
                    });
                    if dot(&x, &x) != q(1.) || dot(&z, &z) != q(1.) || !dot(&x, &z).is_zero() {
                        return Err(no("query-circle-basis-unproved"));
                    }
                    let d = sub(&p, &o);
                    let alpha = dot(&d, &x);
                    let beta = dot(&d, &y);
                    if matches!(arc, ArcKind::Full {}) || (alpha >= Q::zero() && beta >= Q::zero())
                    {
                        let r = q(radius.get());
                        (
                            dot(&d, &d) + &r * &r,
                            q(4.) * &r * &r * (&alpha * &alpha + &beta * &beta),
                        )
                    } else {
                        let ends = endpoints()?;
                        let u = sub(&p, &ends[0]);
                        let v = sub(&p, &ends[1]);
                        (dot(&u, &u).min(dot(&v, &v)), Q::zero())
                    }
                }
                _ => return Err(no("query-curve-unimplemented")),
            }
        };
        // A shared arc endpoint has zero distance written as n - sqrt(k),
        // whereas its incident line spells it as 0 - sqrt(0). Canonicalize
        // rational square roots exactly before comparing expressions; float
        // enclosure overlap cannot prove (or break) this topological tie.
        let numerator = k.numer().sqrt();
        let denominator = k.denom().sqrt();
        let (n, k) =
            if &numerator * &numerator == *k.numer() && &denominator * &denominator == *k.denom() {
                (n - Q::new(numerator, denominator), Q::zero())
            } else {
                (n, k)
            };
        let squared = enclose(&n)? - enclose(&k)?.sqrt();
        let lo = squared.lo().max(0.).sqrt().next_down().max(0.);
        let hi = squared.hi().max(0.).sqrt().next_up();
        let mid = (lo + hi) * 0.5;
        let distance = Iv {
            m: mid,
            r: (mid - lo).max(hi - mid).next_up(),
        };
        let distance = crate::rounding::finite_ball(distance).map_err(|_| no("query-range"))?;
        values.push((n, k, metric.length(distance)?));
    }
    if values.is_empty() {
        return Ok(vec![]);
    }
    if !all_isometric {
        // Equal source radicals need not be equal world distances. Certify the
        // distance-to-minimum/tie frontier with singular-value bounds instead.
        // Ambiguous ordering is a named refusal, never an approximate tie.
        let lower = values
            .iter()
            .map(|v| v.2.lo().max(0.))
            .fold(f64::INFINITY, f64::min);
        let upper = values
            .iter()
            .map(|v| v.2.hi())
            .fold(f64::INFINITY, f64::min);
        let mut selected = vec![];
        for (index, (n, k, d)) in values.iter().enumerate() {
            let sole_minimum = values
                .iter()
                .enumerate()
                .all(|(j, v)| j == index || d.hi() < v.2.lo());
            if (n.is_zero() && k.is_zero()) || sole_minimum || (*d - Iv::point(lower)).hi() <= tie {
                selected.push(index);
            } else if (*d - Iv::point(upper)).lo() <= tie {
                return Err(no("query-world-metric-unresolved"));
            }
        }
        return Ok(selected);
    }
    let best = (0..values.len())
        .min_by(|&i, &j| values[i].2.mid().total_cmp(&values[j].2.mid()))
        .unwrap();
    let (n, k, d) = &values[best];
    let mut selected = vec![];
    for (index, (m, l, e)) in values.iter().enumerate() {
        if m == n && l == k {
            selected.push(index);
            continue;
        }
        // No rounded-order decision: each candidate must be certified relative
        // to this proposed minimum and to its tolerance frontier.
        if e.hi() < d.lo() {
            return Err(no("query-order-unresolved"));
        }
        if l.is_zero() && k.is_zero() {
            if m < n {
                return Err(no("query-order-unresolved"));
            }
            let t = q(tie);
            let a = m - n - &t * &t;
            if a <= Q::zero() || &a * &a <= q(4.) * &t * &t * n {
                selected.push(index);
            }
            continue;
        }
        if e.lo() >= d.hi() {
            let delta = *e - *d;
            if delta.hi() <= tie {
                selected.push(index);
            } else if delta.lo() <= tie {
                return Err(no("query-tie-unresolved"));
            }
        } else {
            return Err(no("query-order-unresolved"));
        }
    }
    Ok(selected)
}
