//! Decision spike (docs/rust-spike.md): the wonky planar Boolean
//! (kernel/ports/planar-boolean.bend and its closure) ported to Rust with plain
//! IEEE f64 geometry. f64 is only a filter: every sign/zero decision is exact
//! (exact.rs), every tolerance comparison is a certified interval decision
//! (num.rs); anything undecidable refuses the operation with a named site.

pub mod arrangement;
pub mod boolean;
pub mod exact;
pub mod face;
pub mod halfspace;
pub mod model;
pub mod num;
pub mod provenance;
pub mod solid;
pub mod topo;
pub mod validate;
pub mod wire;
#[cfg(feature = "plant")]
pub mod plant;
