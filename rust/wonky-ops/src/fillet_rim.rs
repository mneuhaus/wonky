//! Whole convex cap bands, not a shape recognizer. For C1 chains the planar
//! offset Q defines a fillet by d(p.xy,Q)^2 + max(z-zc,0)^2 <= r^2, or a
//! chamfer by d(p.xy,Q) + max(z-zc,0) <= r. Sharp line joints instead use
//! exact intersections of shifted supports: linear sections for chamfers,
//! cosine sections with shared elliptic cylinder intersections for fillets.
//! A lower band uses the exact reflected chart. All incidence/convexity and
//! offset decisions are rational; inexact construction coordinates refuse.
use crate::{
    arc_profile::{q, ArcPrism, Profile, P, R},
    polyhedron::{Audited, Refused},
};
use num_rational::BigRational as Q;
use num_traits::ToPrimitive;
use wonky_contract::*;
use wonky_curve as wc;
pub(crate) fn no(s: &str) -> Refused {
    Refused(format!("fillet/rim-{s}"))
}
pub(crate) fn exact(v: Q) -> R<f64> {
    let f = v
        .to_f64()
        .filter(|x| x.is_finite())
        .ok_or_else(|| no("coordinate-range"))?;
    if q(f) != v {
        return Err(no("offset-not-representable"));
    }
    Ok(f)
}
fn vector(v: P) -> R<[f64; 2]> {
    Ok([exact(v[0].clone())?, exact(v[1].clone())?])
}
#[derive(Clone, Debug)]
pub(crate) struct Rim {
    pub inner: Profile,
    pub radius: f64,
    pub center_z: f64,
    pub normals: Vec<[f64; 2]>,
    pub chamfer: bool,
    pub bottom: bool,
    pub outward: bool,
    /// Sharp line mitres: a polynomial polygon section with linear/chamfer
    /// or cosine/fillet height parameterization.
    pub mitred: bool,
}
impl Rim {
    /// Parallel profile offsets define both constant cap blends. Lines sweep
    /// planes/cylinders; circular pieces sweep rational-slope cones/tori.
    /// Offsets, radii and carrier axes must be exact binary64 values; C1 and
    /// positive curvature are decided on exact source normals, never caches.
    pub(crate) fn band(s: &ArcPrism, r: f64, chamfer: bool, bottom: bool) -> R<Self> {
        Self::offset_band(s, r, chamfer, bottom, false)
    }
    pub(crate) fn offset_band(
        s: &ArcPrism,
        r: f64,
        chamfer: bool,
        bottom: bool,
        outward: bool,
    ) -> R<Self> {
        if s.rim.is_some() {
            return Err(no("repeat-unsupported"));
        }
        if !r.is_finite() || r <= 0. {
            return Err(no("radius"));
        }
        if q(r) >= q(s.levels[1]) - q(s.levels[0]) {
            return Err(no("height-consumed"));
        }
        let offset = if outward { -q(r) } else { q(r) };
        let mut pieces = vec![];
        let mut starts = vec![];
        let mut ends = vec![];
        // The offset circles are the torus major radii, not endpoint caches.
        // Preflight all radius combinations before serializing any segment so
        // the named constraint does not depend on the chain's starting piece.
        for seg in s.profile.segments() {
            if let wc::Chart::Circle(c) = seg.chart() {
                let radius =
                    wc::numeric::exact_root(&c.r2).ok_or_else(|| no("radius-not-representable"))?;
                if c.ccw && offset < radius {
                    exact(&radius - &offset).map_err(|_| {
                        no(if chamfer {
                            "cone-radius-not-binary64"
                        } else {
                            "torus-radius-not-binary64"
                        })
                    })?;
                }
            }
        }
        for seg in s.profile.segments() {
            // No rounded arrangement endpoint becomes a band construction.
            vector(seg.ends()[0].rat()?.clone())?;
            vector(seg.ends()[1].rat()?.clone())?;
            let inset = seg.inset(&offset).map_err(|e| {
                no(match e {
                    wc::InsetRefusal::Clockwise => "non-convex-chain",
                    wc::InsetRefusal::IrrationalRadius => "radius-not-representable",
                    wc::InsetRefusal::Curvature => "offset-curvature",
                    wc::InsetRefusal::ZeroLength => "zero-line",
                    wc::InsetRefusal::Spline => "spline-offset-unsupported",
                })
            })?;
            let cache = [vector(inset.ends[0].rat()?.clone())?, vector(inset.ends[1].rat()?.clone())?];

            // Normalized carrier axes are exact f64 too, not a fitted direction.
            let [na, nb] = inset.normals;
            vector(na.clone())?;
            vector(nb.clone())?;
            pieces.push(wc::Trimmed::with_cache(inset.ends, cache, inset.carrier));
            starts.push(na);
            ends.push(nb);
        }
        let mitred = (0..starts.len()).any(|k| ends[k] != starts[(k + 1) % starts.len()]);
        if mitred {
            if pieces.iter().any(|p| !matches!(p.chart(), wc::Chart::Line)) {
                return Err(no("non-tangent-chain"));
            }
            use wc::numeric::{cross, dot, sub};
            let n = pieces.len();
            let mut joints = Vec::with_capacity(n);
            for k in 0..n {
                let prev = &pieces[(k + n - 1) % n];
                let next = &pieces[k];
                let u = sub(prev.ends()[1].rat()?, prev.ends()[0].rat()?);
                let v = sub(next.ends()[1].rat()?, next.ends()[0].rat()?);
                let turn = cross(&u, &v);
                if turn < q(0.) || (turn == q(0.) && dot(&u, &v) <= q(0.)) {
                    return Err(no("non-convex-chain"));
                }
                let point = if turn == q(0.) {
                    next.ends()[0].clone()
                } else {
                    let delta = sub(next.ends()[0].rat()?, prev.ends()[0].rat()?);
                    let t = cross(&delta, &v) / turn;
                    let origin = prev.ends()[0].rat()?;
                    wc::ExactPoint::from_rational(std::array::from_fn(|j| {
                        &origin[j] + &t * &u[j]
                    }))
                };
                let point = if cfg!(feature = "plant_rim_miter_contact") {
                    let original = s.profile.segments()[k].ends()[0].rat()?;
                    let rational = point.rat()?;
                    wc::ExactPoint::from_rational(std::array::from_fn(|j| {
                        (&rational[j] + &original[j]) / q(2.)
                    }))
                } else { point };
                // This cap-band serializer requires exact binary64 vertices.
                vector(point.rat()?.clone())?;
                joints.push(point);
            }
            for k in 0..n {
                let d = sub(pieces[k].ends()[1].rat()?, pieces[k].ends()[0].rat()?);
                let changed = sub(joints[(k + 1) % n].rat()?, joints[k].rat()?);
                if dot(&changed, &d) <= q(0.) {
                    return Err(no("offset-curvature"));
                }
                pieces[k] = wc::Trimmed::new(
                    [joints[k].clone(), joints[(k + 1) % n].clone()], wc::Carrier::Line,
                )?;
            }
        }
        let inner = Profile::from_pieces(pieces);
        // A simple, positively oriented chain with nonnegative curvature and
        // C1 joints or convex line mitres is convex. Recheck rather than assume no
        // collision of distant trim segments.
        inner.simple()?;
        if inner.area()?.lo() <= 0. {
            return Err(no("offset-area-unresolved"));
        }
        let chain = inner.segments();
        for (k, seg) in chain.iter().enumerate() {
            if seg.ends()[1] != chain[(k + 1) % chain.len()].ends()[0] {
                return Err(no("offset-chain"));
            }
        }
        Ok(Self {
            inner,
            radius: r,
            center_z: exact(if bottom {
                q(s.levels[0]) + q(r)
            } else {
                q(s.levels[1]) - q(r)
            })?,
            normals: starts.into_iter().map(vector).collect::<R<_>>()?,
            chamfer,
            bottom,
            outward,
            mitred,
        })
    }
}
pub(crate) fn apply(a: &Audited, edges: &[usize], r: f64) -> R<Body> {
    apply_band(a, edges, r, false)
}
pub(crate) fn apply_band(a: &Audited, edges: &[usize], r: f64, chamfer: bool) -> R<Body> {
    crate::source_frame::SourceMetric::new(&a.frame)?;
    let s = a.arcs.as_ref().ok_or_else(|| no("profile-required"))?;
    if s.rim.is_some() {
        return Err(no("repeat-unsupported"));
    }
    let n = s.profile.segments().len();
    let selected = edges
        .iter()
        .copied()
        .collect::<std::collections::BTreeSet<_>>();
    let bottom = selected == (0..n).collect();
    if !bottom && selected != (n..2 * n).collect() {
        return Err(no("whole-cap-required"));
    }
    construct_band(a.body.clone(), s, r, chamfer, bottom)
}
pub(crate) fn construct_band(
    mut source: Body,
    s: &ArcPrism,
    r: f64,
    chamfer: bool,
    bottom: bool,
) -> R<Body> {
    if source.constructions.len() != 3 {
        return Err(no("blended-generator-source-replay-unimplemented"));
    }
    let rim = Rim::band(s, r, chamfer, bottom)?;
    let parent = source.constructions.len() - 1;
    source.constructions.push(Construction {
        operation: if chamfer {
            Operation::Intersection {}
        } else {
            Operation::Fillet {}
        },
        rule_version: 1,
        parents: vec![NodeId(parent as u32)],
        parameters: if bottom {
            vec![crate::arc_profile::b(r)?, crate::arc_profile::b(1.)?]
        } else {
            vec![crate::arc_profile::b(r)?]
        },
        frame: FrameId(1),
    });
    crate::fillet_rim_brep::construct(source, s, &rim)
}
