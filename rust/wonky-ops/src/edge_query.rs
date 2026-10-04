//! Exact closest-line-edge queries in the interpreter's binary64 world frame.
//! Squared segment distances are expansion ratios. Neither world coordinates,
//! projections nor distances are rounded before comparison (E4/E9).
use crate::polyhedron::{Audited, Refused};
use wonky_num::expansion::{self as ex, Exp, Guard};

type R<T> = Result<T, Refused>;
type V = [Exp; 3];
fn no(s: &str) -> Refused {
    Refused(format!("edge-query/{s}"))
}
fn dot(a: &V, b: &V, g: &mut Guard) -> Exp {
    (0..3).fold(vec![], |s, k| ex::sum(&s, &ex::mul(&a[k], &b[k], g), g))
}
fn sub(a: &V, b: &V, g: &mut Guard) -> V {
    std::array::from_fn(|k| ex::sum(&a[k], &ex::neg(&b[k]), g))
}
/// A squared distance as the exact ratio n / d (d > 0).
pub(crate) struct Distance {
    pub(crate) n: Exp,
    pub(crate) d: Exp,
}
fn distance(body: &Audited, edge: usize, point: [f64; 3], g: &mut Guard) -> R<Distance> {
    let e = body.body.edges.get(edge).ok_or_else(|| no("edge-index"))?;
    // Audited is the planar/line-only audit, not merely WC0 structural checking.
    let at = |i: usize| {
        let p = body.body.vertices[e.vertices[i].0 as usize]
            .point
            .map(|v| v.get());
        body.frame
            .apply_exact(p, 1.0, true)
            .map_err(|_| no("numeric-range"))
    };
    segment_distance(&at(0)?, &at(1)?, &point.map(|x| vec![x]), g)
}

/// The squared distance from `point` to the closed segment a..b, exactly.
pub(crate) fn segment_distance(a: &V, b: &V, point: &V, g: &mut Guard) -> R<Distance> {
    let v = sub(b, a, g);
    let w = sub(point, a, g);
    let vv = dot(&v, &v, g);
    let t = dot(&w, &v, g);
    if !g.exact() {
        return Err(no("numeric-range"));
    }
    if ex::sign(&vv) <= 0 {
        return Err(no("degenerate-edge"));
    }
    let d = if ex::sign(&t) <= 0 {
        Distance {
            n: dot(&w, &w, g),
            d: vec![1.0],
        }
    } else if ex::sign(&ex::sum(&t, &ex::neg(&vv), g)) >= 0 {
        let end = sub(&w, &v, g);
        Distance {
            n: dot(&end, &end, g),
            d: vec![1.0],
        }
    } else {
        Distance {
            n: ex::sum(
                &ex::mul(&dot(&w, &w, g), &vv, g),
                &ex::neg(&ex::mul(&t, &t, g)),
                g,
            ),
            d: vv,
        }
    };
    if !g.exact() || ex::sign(&d.n) < 0 {
        return Err(no("numeric-range"));
    }
    Ok(d)
}

/// Return candidate positions, retaining every distance within `tie` metres
/// of the minimum (the query's documented zeroLength tie rule). An empty
/// candidate set is an empty answer. Bad IDs and arithmetic range refuse.
pub fn closest(candidates: &[(&Audited, usize)], point: [f64; 3], tie: f64) -> R<Vec<usize>> {
    if candidates.iter().any(|(a,_)|a.chamfer.is_some()) { return Err(no("chamfer-metric-unimplemented")); }
    if point.iter().any(|v| !v.is_finite()) || !tie.is_finite() || tie < 0.0 {
        return Err(no("invalid-input"));
    }
    // A profile's vertices may be rounded rational offsets, even when every
    // selected carrier is a line. The shared source chart owns those endpoints;
    // never let the all-line expansion fast path reinterpret their caches.
    if candidates.iter().any(|(a,_)| a.arcs.as_ref().is_some_and(|p| p.rim.is_none())) {
        if candidates.iter().any(|(a,_)| a.arrangement.is_some()) {
            return Err(no("mixed-arranged-curved-unsupported"));
        }
        let source = candidates.iter().map(|&(a,i)| crate::curve_query::Candidate::planar(a,i)).collect::<R<Vec<_>>>()?;
        return crate::curve_query::closest(&source, point, tie);
    }
    let arranged = candidates.iter().any(|(a,_)| a.arrangement.is_some());
    if candidates.iter().any(|(a,e)| a.body.edges.get(*e).is_some_and(|e| !matches!(a.body.curves[e.curve.0 as usize].geometry, wonky_contract::CurveGeometry::Line{..} | wonky_contract::CurveGeometry::ConstructionLine{..}))) {
        if arranged { return Err(no("mixed-arranged-curved-unsupported")); }
        let candidates = candidates.iter().map(|&(a, i)| crate::curve_query::Candidate::planar(a, i)).collect::<R<Vec<_>>>()?;
        return crate::curve_query::closest(&candidates, point, tie);
    }
    if arranged { return crate::edge_query_exact::closest(candidates, point, tie); }
    match closest_expansions(candidates, point, tie) {
        Err(e) if e.0 == "edge-query/numeric-range" => {
            crate::edge_query_exact::closest(candidates, point, tie)
        }
        result => result,
    }
}

/// Analytic audit dispatch for native queries. A cylinder's seam vertices live
/// in a translated chart; sending it through the planar audit is not valid.
/// Keep the exact expansion fast path for all-planar line selections, and
/// compare mixed source frames using the shared line/circle metric.
pub fn closest_solids(candidates: &[(&crate::analytic::Solid, usize)], point: [f64; 3], tie: f64) -> R<Vec<usize>> {
    use crate::{analytic::Solid, curve_query::Candidate};
    if point.iter().any(|v| !v.is_finite()) || !tie.is_finite() || tie < 0. {
        return Err(no("invalid-input"));
    }
    if candidates.iter().any(|(a, _)| a.curved_model()) {
        return Err(crate::polyhedron::Refused("boolean/ssi-row-unavailable:model/curved-edge-query".into()));
    }
    if candidates.iter().all(|(a, _)| matches!(a, Solid::Planar(_) | Solid::Model(_, _))) {
        let planar: Vec<_> = candidates.iter().filter_map(|&(a, i)| match a {
            Solid::Planar(a) | Solid::Model(a, _) => Some((a, i)), _ => None,
        }).collect();
        return closest(&planar, point, tie);
    }
    let mut source = vec![];
    let mut owners = vec![];
    for (owner, &(solid, index)) in candidates.iter().enumerate() {
        let expanded = match solid {
            Solid::Planar(a) if a.chamfer.is_some() => return Err(no("chamfer-metric-unimplemented")),
            Solid::Planar(a) | Solid::Model(a, _) => vec![Candidate::planar(a, index)?],
            Solid::Cylinder(c) => vec![Candidate { body: &c.body, frame: &c.frame, quarter_arcs: false, arcs: None, index, source: None }],
            Solid::Conical(c) => vec![Candidate { body: &c.body, frame: &c.frame, quarter_arcs: false, arcs: None, index, source: None }],
            Solid::Perforated(p) => vec![Candidate { body: &p.body, frame: &p.base.frame, quarter_arcs: false, arcs: None, index, source: None }],
            Solid::PrismStack(p) => p.query_edges(index)?,
            _ => return Err(no("analytic-carrier-unimplemented")),
        };
        owners.extend(std::iter::repeat_n(owner, expanded.len()));
        source.extend(expanded);
    }
    let selected = crate::curve_query::closest(&source, point, tie)?;
    Ok(selected.into_iter().map(|i| owners[i]).collect::<std::collections::BTreeSet<_>>().into_iter().collect())
}

fn closest_expansions(
    candidates: &[(&Audited, usize)],
    point: [f64; 3],
    tie: f64,
) -> R<Vec<usize>> {
    let mut g = Guard::new();
    let ds = candidates
        .iter()
        .map(|(b, e)| distance(b, *e, point, &mut g))
        .collect::<R<Vec<_>>>()?;
    let answer = nearest(&ds, tie, &mut g);
    if !g.exact() {
        return Err(no("numeric-range"));
    }
    Ok(answer)
}

/// The positions of every distance within `tie` metres of the smallest,
/// decided exactly; none for no distances. The caller checks `g.exact()`.
pub(crate) fn nearest(ds: &[Distance], tie: f64, g: &mut Guard) -> Vec<usize> {
    let Some(first) = ds.first() else {
        return vec![];
    };
    let mut best = first;
    for d in &ds[1..] {
        let delta = ex::sum(
            &ex::mul(&d.n, &best.d, g),
            &ex::neg(&ex::mul(&best.n, &d.d, g)),
            g,
        );
        if ex::sign(&delta) < 0 {
            best = d;
        }
    }
    let t2 = ex::product(tie, tie, g);
    let mut answer = vec![];
    for (i, d) in ds.iter().enumerate() {
        // sqrt(n/d) <= sqrt(N/D) + t. With positive denominators,
        // L = nD - Nd - t²dD <= 0 is immediately in. Otherwise square
        // L <= 2t*d*sqrt(ND); squaring is now sign-preserving.
        let dd = ex::mul(&d.d, &best.d, g);
        let l = ex::sum(
            &ex::sum(
                &ex::mul(&d.n, &best.d, g),
                &ex::neg(&ex::mul(&best.n, &d.d, g)),
                g,
            ),
            &ex::neg(&ex::mul(&t2, &dd, g)),
            g,
        );
        if ex::sign(&l) <= 0 {
            answer.push(i);
            continue;
        }
        if tie == 0.0 {
            continue;
        }
        let right = ex::mul(
            &[4.0],
            &ex::mul(
                &t2,
                &ex::mul(&best.n, &ex::mul(&d.d, &dd, g), g),
                g,
            ),
            g,
        );
        let squared = ex::sum(&ex::mul(&l, &l, g), &ex::neg(&right), g);
        if ex::sign(&squared) <= 0 {
            answer.push(i);
        }
    }
    answer
}
