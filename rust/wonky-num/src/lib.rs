//! wonky-num: the numeric core of the wonky Rust kernel (docs/rust-migration.md 3.2).
//!
//! - Construction is plain IEEE f64.
//! - Every sign, zero or incidence decision goes through an exact predicate
//!   (`predicates`): power-of-two scaling, a static floating-point filter, then
//!   Shewchuk expansion arithmetic (`expansion`) that checks its own exactness.
//! - Every tolerance comparison is a certified ball-arithmetic decision
//!   (`ball`: `decide`, `lt`, `le`).
//! - A decision that cannot be certified is `Err(Undecided { site, kind })`,
//!   never a guess. `Undecided` must be propagated with `?` and finally turned
//!   into a named refusal with `Undecided::into_refusal`; dropping it anywhere
//!   else (a swallowed decision) panics, so a forgotten `?` is a loud failure,
//!   not a silently wrong path. It deliberately has no `Clone`/`PartialEq`, so a
//!   `Decision` cannot be compared with `== Ok(..)` without handling the error.
//! - Inputs that are NaN, infinite, subnormal or outside
//!   [`MIN_MAGNITUDE`, `MAX_MAGNITUDE`] are refused by name (`OutOfRange`).
//!
//! The ball arithmetic and the expansion primitives come from the decision
//! spike (local-development-evidence, rust/planar/src/num.rs and exact.rs); the spike's
//! sticky thread-local undecided flag is replaced by `Result`.
#![deny(unused_must_use)]

pub mod ball;
mod decision;
pub mod expansion;
pub mod predicates;
pub mod vec;

pub use ball::{decide, le, lt, Iv, Scalar};
pub use decision::{check_range, in_range, Decision, Refusal, Sign, Undecided, UndecidedKind, MAX_MAGNITUDE, MIN_MAGNITUDE};
pub use predicates::{dot_sign, line_point_side, orient2d, orient3d, parallel, perpendicular, plane_side, segment_plane, SegmentPlane};
pub use vec::{p2, v3, I3, P2, P3, V3};
