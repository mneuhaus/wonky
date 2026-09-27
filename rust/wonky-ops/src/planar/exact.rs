//! LEGACY SHIM for the decision spike's planar Boolean (see num.rs): the
//! spike's exact.rs moved to `wonky_num::predicates`; these are the three
//! predicates the planar code calls, with the spike's contract (an undecided
//! predicate sets the sticky flag and answers `false`). Delete with num.rs's
//! shim in package P1.

use crate::num::{sticky, P3};
use wonky_num::Sign;

/// Exact test dot(n, a - b) == 0 (Bend I.coincidence_certificate).
pub fn coincident(n: P3, a: P3, b: P3, site: &'static str) -> bool {
    sticky(wonky_num::plane_side(n, a, b, site).map(|s| s == Sign::Zero))
}

/// Exact test dot(a, b) == 0 (I.perpendicular_certificate / exact_dot zero).
pub fn perpendicular(a: P3, b: P3, site: &'static str) -> bool {
    sticky(wonky_num::perpendicular(a, b, site))
}

/// Exact parallelism: cross(a, b) == 0 componentwise (I.exact_parallel).
pub fn parallel(a: P3, b: P3, site: &'static str) -> bool {
    sticky(wonky_num::parallel(a, b, site))
}
