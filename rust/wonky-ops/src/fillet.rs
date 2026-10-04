//! Constant-radius rolling-ball operation boundary.
//!
//! Parallel cuboid edges use source-frame trimmed cylinders, with bounded
//! world observation/export under their original interpreter placement.
//! Three incident edges use a spherical corner patch. General affine metrics
//! remain a named capability. Edge
//! overflow is allowed by default, so unsupported overflow is never reported
//! as geometric infeasibility.
//!
//! Admission-last: a family's capability refusal on a planar body is retried on
//! the general plane/plane surgery. A family's geometric verdict is final.
use crate::polyhedron::{Audited, Refused};
use wonky_contract::Body;

/// Family refusals whose general retry reports its own refusal (the F1b
/// routes); any other family refusal is kept when the retry refuses too.
const GENERAL_REPORTS: [&str; 2] = [
    "profile-blend/non-convex-or-tangent-joint",
    "fillet/requires-single-box",
];

pub fn constant_radius(body: &Audited, edges: &[usize], radius: f64) -> Result<Body, Refused> {
    if crate::planar_boolean::candidate(&body.body) {
        return crate::fillet_general::apply(body, edges, radius);
    }
    if !radius.is_finite() || radius <= 0.0 {
        return Err(Refused("fillet/invalid-radius".into()));
    }
    if edges.is_empty() {
        return Err(Refused("fillet/empty-selection".into()));
    }
    if let Some(result) =
        crate::pattern::modify(body, |source| constant_radius(source, edges, radius))?
    {
        return Ok(result);
    }
    match family(body, edges, radius) {
        Err(e) if e.is_capability() && body.arcs.is_none() => {
            crate::fillet_general::apply(body, edges, radius).map_err(|general| {
                if GENERAL_REPORTS.contains(&e.0.as_str()) {
                    general
                } else {
                    e
                }
            })
        }
        result => result,
    }
}

fn family(body: &Audited, edges: &[usize], radius: f64) -> Result<Body, Refused> {
    if body.orthogonal.is_none() && crate::profile_blend::admits(body, edges) {
        return crate::profile_blend::apply(body, edges, radius, true);
    }
    if body.arcs.is_some() {
        return crate::fillet_rim::apply(body, edges, radius);
    }
    if crate::fillet_corner::applies(body, edges) {
        return crate::fillet_corner::apply(body, edges, radius);
    }
    match crate::fillet_prism::apply(body, edges, radius) {
        Err(e)
            if e.0 == "fillet/trim-not-representable"
                && crate::profile_blend::admits(body, edges) =>
        {
            crate::profile_blend::apply(body, edges, radius, true)
        }
        result => result,
    }
}
