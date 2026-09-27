//! Constant-radius rolling-ball operation boundary.
//!
//! Parallel cuboid edges use source-frame trimmed cylinders, with bounded
//! world observation/export under their original interpreter placement.
//! Three incident edges use a spherical corner patch. General affine metrics
//! remain a named capability. Edge
//! overflow is allowed by default, so unsupported overflow is never reported
//! as geometric infeasibility.
use crate::polyhedron::{Audited, Refused};
use wonky_contract::Body;

pub fn constant_radius(body: &Audited, edges: &[usize], radius: f64) -> Result<Body, Refused> {
    if crate::planar_boolean::candidate(&body.body) {
        return Err(Refused("fillet/arranged-solid-unsupported".into()));
    }
    if !radius.is_finite() || radius <= 0.0 {
        return Err(Refused("fillet/invalid-radius".into()));
    }
    if edges.is_empty() {
        return Err(Refused("fillet/empty-selection".into()));
    }
    if crate::fillet_corner::applies(body, edges) {
        return crate::fillet_corner::apply(body, edges, radius);
    }
    crate::fillet_prism::apply(body, edges, radius)
}
