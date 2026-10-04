//! Opt-in circular-carrier coincidence, before a missing Boolean arrangement.
//!
//! This proves a displacement bound, NOT a sewn topology. Until the curved
//! arrangement consumes the replacement, candidates are explicitly not applied
//! and the Boolean refuses. Source circles come from audited constructions,
//! never rounded WC0 circle caches. No changes to the default exact path.
use crate::{
    analytic::Solid,
    arc_profile::q,
    placement::Placement,
    polyhedron::Refused,
};
use num_rational::BigRational as Q;
use num_traits::{Signed, ToPrimitive, Zero};
use wonky_curve as wc;
type V = [Q; 3];
type R<T> = Result<T, Refused>;
fn no(s: &str) -> Refused {
    Refused(format!("regularization/coincidence/{s}"))
}
fn dot(a: &V, b: &V) -> Q {
    (0..3).map(|i| &a[i] * &b[i]).sum()
}
fn cross(a: &V, b: &V) -> V {
    [(1, 2), (2, 0), (0, 1)].map(|(i, j)| &a[i] * &b[j] - &a[j] * &b[i])
}
fn sub(a: &V, b: &V) -> V {
    std::array::from_fn(|i| &a[i] - &b[i])
}
fn norm1(v: &V) -> Q {
    v.iter().map(Signed::abs).sum()
}
fn signed_equal(a: &V, b: &V) -> bool {
    a == b || a.iter().zip(b).all(|(a, b)| a == &-b)
}

struct Frame {
    origin: V,
    columns: [V; 3],
}
impl Frame {
    fn affine(p: crate::affine::Affine) -> Self {
        let x = p.x.map(q);
        let z = p.z.map(q);
        let y = cross(&z, &x);
        Self {
            origin: p.origin.map(q),
            columns: [x, y, z],
        }
    }
    fn new(p: &Placement) -> R<Self> {
        let apply = |v, translate| -> R<V> {
            Ok(p.apply_exact(v, 1., translate)
                .map_err(|_| no("frame-range"))?
                .map(|e| e.into_iter().map(q).sum()))
        };
        Ok(Self {
            origin: apply([0.; 3], true)?,
            columns: [
                apply([1., 0., 0.], false)?,
                apply([0., 1., 0.], false)?,
                apply([0., 0., 1.], false)?,
            ],
        })
    }
    fn point(&self, p: [f64; 3]) -> V {
        std::array::from_fn(|k| {
            &self.origin[k] + (0..3).map(|j| q(p[j]) * &self.columns[j][k]).sum::<Q>()
        })
    }
    fn inverse(&self, world: &V) -> R<V> {
        let [x, y, z] = &self.columns;
        let det = dot(x, &cross(y, z));
        if det.is_zero() {
            return Err(no("singular-frame"));
        }
        let d = sub(world, &self.origin);
        Ok([
            dot(&d, &cross(y, z)) / &det,
            dot(&d, &cross(z, x)) / &det,
            dot(&d, &cross(x, y)) / det,
        ])
    }
}
struct Ring {
    center: V,
    radial: [V; 2],
    radius: Q,
    // A cylinder can be compared at any height of its axial interval. A cone
    // ring cannot: coincidence at one ring says nothing about the cone surface.
    top: Option<V>,
    index: usize,
    kind: &'static str,
}
fn rings(s: &Solid) -> R<Vec<Ring>> {
    let mut out = vec![];
    let mut push = |f: &Frame,
                    center: [f64; 3],
                    axes: [usize; 2],
                    radius: f64,
                    top: Option<[f64; 3]>,
                    index,
                    kind| {
        if radius > 0. {
            out.push(Ring {
                center: f.point(center),
                radial: axes.map(|k| f.columns[k].clone()),
                radius: q(radius),
                top: top.map(|p| f.point(p)),
                index,
                kind,
            });
        }
    };
    match s {
        Solid::Cylinder(c) => {
            let f = Frame::new(&c.frame)?;
            let k = c.spec.axis()?;
            push(
                &f,
                c.spec.bottom,
                [(k + 1) % 3, (k + 2) % 3],
                c.spec.radius,
                Some(c.spec.top),
                0,
                "cylinder",
            );
        }
        Solid::Conical(c) => {
            let f = Frame::new(&c.frame)?;
            let k = c.source.axis()?;
            for (i, r) in c.rings.iter().enumerate() {
                let neighbors = c
                    .rings
                    .get(i.wrapping_sub(1))
                    .into_iter()
                    .chain(c.rings.get(i + 1));
                if !neighbors.into_iter().any(|a| a.r != r.r && a.z != r.z) {
                    continue;
                }
                let mut p = c.source.bottom;
                p[k] = r.z;
                push(&f, p, [(k + 1) % 3, (k + 2) % 3], r.r, None, i, "cone-rim");
            }
        }
        Solid::Revolved(c) => {
            let f = Frame::affine(c.frame);
            // Only actual circular boundaries of conical bands, not arbitrary
            // samples on the revolved surface. Adjacent meridian endpoints are
            // the authoritative exact ring radii and axial positions.
            for (i, p) in c.points.iter().enumerate() {
                let adjacent = [
                    c.points[(i + c.points.len() - 1) % c.points.len()],
                    c.points[(i + 1) % c.points.len()],
                ];
                if !adjacent.iter().any(|a| a[0] != p[0] && a[1] != p[1]) {
                    continue;
                }
                let axes = match c.mode {
                    0 => [1, 2],
                    1 => [0, 2],
                    _ => [0, 1],
                };
                push(
                    &f,
                    crate::revolve_full::local(c.mode, 0., 0., p[1]),
                    axes,
                    p[0],
                    None,
                    i,
                    "cone-rim",
                );
            }
        }
        _ => {}
    }
    Ok(out)
}

/// Pair each point of the source circle with the same angular point on the
/// replacement. |sqrt(r2)-r| = |r2-r*r|/(sqrt(r2)+r) <= |r2-r*r|/r.
/// Triangle inequalities in the EXACT world columns then bound every point,
/// including the entire trimmed arc and (for cylinders) its whole axial span.
/// This remains valid for non-isometric frames. No epsilon, sqrt or rounded
/// center participates in the admission predicate.
fn bound_mm(c: &wc::Circle, target: &[Q; 2], radius: &Q, radial: &[V; 2]) -> R<Q> {
    let weights = radial.each_ref().map(norm1);
    let c0 = c.c.rat()?;
    let center =
        &weights[0] * (&c0[0] - &target[0]).abs() + &weights[1] * (&c0[1] - &target[1]).abs();
    let r2=c.r2.rational().ok_or_else(||no("radius-class"))?;
    let dr = (r2 - radius * radius).abs() / radius;
    Ok(q(1000.) * (center + (&weights[0] + &weights[1]) * dr))
}
struct Comparison {
    bodies: [usize; 2],
    arc: usize,
    ring: usize,
    kind: &'static str,
    bound: Q,
}
impl Comparison {
    fn json(&self, cap: &Q) -> R<String> {
        let f = self
            .bound
            .to_f64()
            .filter(|f| f.is_finite())
            .ok_or_else(|| no("report-range"))?;
        let upper = if q(f) < self.bound { f.next_up() } else { f };
        if !upper.is_finite() {
            return Err(no("report-range"));
        }
        Ok(format!(
            concat!("{{\"operation\":\"opBoolean\",\"kind\":\"{}\",\"entities\":[",
            "{{\"bodyIndex\":{},\"profileSegment\":{}}},{{\"bodyIndex\":{},\"carrierIndex\":{}}}],",
            "\"applied\":false,\"withinCap\":{},\"maxResidualMm\":{:?},",
            "\"boundMmExact\":{{\"numerator\":\"{}\",\"denominator\":\"{}\"}}}}"),
            self.kind,
            self.bodies[0],
            self.arc,
            self.bodies[1],
            self.ring,
            self.bound <= *cap,
            upper,
            self.bound.numer(),
            self.bound.denom()
        ))
    }
}

/// Reached only when exact Boolean construction is unavailable. Return a typed
/// refusal plus carrier evidence, not a successful body or an applied merge.
pub(crate) fn refusal(inputs: &[Solid], cap_mm: f64, original: &str) -> R<Option<String>> {
    if !cap_mm.is_finite() || cap_mm < 0. {
        return Err(no("invalid-cap"));
    }
    let cap = q(cap_mm);
    let mut comparisons = vec![];
    let mut visited = 0usize;
    for (i, input) in inputs.iter().enumerate() {
        let Solid::Planar(a) = input else { continue };
        let Some(arcs) = &a.arcs else { continue };
        // A fillet changes these surfaces. Never classify its untrimmed source
        // circles as if they were the resulting carrier.
        if arcs.rim.is_some() {
            continue;
        }
        let f = Frame::new(&a.frame)?;
        for (j, other) in inputs.iter().enumerate() {
            if i == j {
                continue;
            }
            for ring in rings(other)? {
                // Exact signed permutation of the radial basis. General
                // rotated/scaled frame relations remain outside this rule.
                let [x, y, _] = &f.columns;
                if !(signed_equal(x, &ring.radial[0]) && signed_equal(y, &ring.radial[1])
                    || signed_equal(x, &ring.radial[1]) && signed_equal(y, &ring.radial[0]))
                {
                    continue;
                }
                let c = f.inverse(&ring.center)?;
                let (lo, hi) = (q(arcs.levels[0]), q(arcs.levels[1]));
                if let Some(top) = &ring.top {
                    let t = f.inverse(top)?;
                    if c[0] != t[0] || c[1] != t[1] {
                        continue;
                    }
                    let (l, h) = if c[2] < t[2] {
                        (&c[2], &t[2])
                    } else {
                        (&t[2], &c[2])
                    };
                    if h < &lo || l > &hi {
                        continue;
                    }
                } else if c[2] < lo || c[2] > hi {
                    continue;
                }
                for (arc, s) in arcs.profile.segments().iter().enumerate() {
                    // Exhaustive: a new carrier class must decide here whether
                    // it can coincide with a ring, not be skipped silently.
                    let circle = match s.chart() {
                        wc::Chart::Circle(circle) => circle,
                        wc::Chart::Line => continue,
                        // A rational spline can ride a circle exactly, so this is a refusal, not a skip.
                        wc::Chart::BSpline(_) => return Err(wc::Refusal::SplineArrangement.into()),
                    };
                    visited += 1;
                    if visited > 4096 {
                        return Err(no("pair-budget"));
                    }
                    let bound = bound_mm(
                        circle,
                        &[c[0].clone(), c[1].clone()],
                        &ring.radius,
                        &[x.clone(), y.clone()],
                    )?;
                    comparisons.push(Comparison {
                        bodies: [i, j],
                        arc,
                        ring: ring.index,
                        kind: ring.kind,
                        bound,
                    });
                }
            }
        }
    }
    if comparisons.is_empty() {
        return Ok(None);
    }
    let reason = if comparisons.iter().any(|c| c.bound <= cap) {
        "boolean-arrangement-unimplemented"
    } else {
        "residual-bound-above-cap"
    };
    // `original` is a kernel-generated code. Debug formatting escapes it as a
    // JSON string, and all numeric fields above have finite outward values.
    Ok(Some(format!(concat!("{{\"schema\":\"wonky-carrier-refusal/1\",\"reason\":\"regularization/coincidence/{}\",",
        "\"originalReason\":{:?},\"capMm\":{:?},\"coincidences\":[{}]}}"),reason,original,cap_mm,
        comparisons.iter().map(|c|c.json(&cap)).collect::<R<Vec<_>>>()?.join(","))))
}

#[cfg(test)]
mod tests {
    use super::*;
    // Owning mathematical contract: the full-carrier bound must include both
    // center and radius displacement in the world metric, and cap admission
    // must distinguish adjacent rational values. JS tests own wire/reporting.
    #[test]
    fn whole_carrier_bound_includes_radius_center_and_world_metric() {
        let source = crate::arc_profile::regularize::sources(&[], &[[5., 0., 3., 4., 0., 5.]])
            .unwrap()
            .remove(0);
        let wc::Chart::Circle(circle) = source.chart() else { panic!("an arc source") };
        let mut circle = circle.clone();
        let radial = [[q(2.), q(0.), q(0.)], [q(0.), q(3.), q(0.)]];
        assert_eq!(bound_mm(&circle, &[q(0.), q(0.)], &q(5.), &radial).unwrap(), q(0.));
        circle.c = wc::ExactPoint::from_rational([q(1.), q(-2.)]);
        assert_eq!(
            bound_mm(&circle, &[q(0.), q(0.)], &q(5.), &radial).unwrap(),
            q(8000.)
        );
        // Actual radial movement is 1; rationalized upper bound is 9/4.
        let b = bound_mm(&circle, &[q(0.), q(0.)], &q(4.), &radial).unwrap();
        assert_eq!(b, q(19250.));
    }
}
