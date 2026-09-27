//! Kernel operations of the wonky Rust kernel (docs/rust-migration.md 3.1).
//!
//! `planar` is the decision spike's planar Boolean (docs/rust-spike.md),
//! adopted in K0: its op files (planar/*.rs except num.rs and exact.rs, and
//! mod.rs = the spike's lib.rs) are byte-identical to the spike's
//! rust/planar/src; only its numeric core (planar/num.rs, planar/exact.rs) is
//! a legacy shim over `wonky-num`.
//! The spike's modules address each other as `crate::<module>`, so the
//! re-exports below keep those paths valid without editing them.
#![deny(unused_must_use)]

pub mod planar;

#[cfg(feature = "plant")]
pub(crate) use planar::plant;
pub(crate) use planar::{arrangement, exact, face, halfspace, model, num, provenance, solid, topo, validate, wire};

// The planar extrusion slice on strict `rust`: sketch region ->
// exact BLIND prism as a WC0 v3 body in its Frame::Interpreter -> exact audit
// -> general measurements -> planar STEP. Reached through `host::host_op`.
mod edge_query_exact;
pub mod edge_query;
pub mod fillet;
pub mod chamfer;
mod fillet_corner;
mod fillet_corner_audit;
mod fillet_corner_observe;
pub mod fillet_prism;
mod fillet_observe;
mod analytic_pi;
mod fillet_step;
mod source_frame;
pub mod orthogonal;
mod planar_boolean;
pub mod planar_shell;
mod planar_geometry;
pub mod affine;
pub mod extrude;
pub mod host;
pub mod polyhedron;
pub mod rounding;
pub mod step;
pub mod cylinder;
pub mod bicylinder;
pub mod bicylinder_step;
mod cylinder_probe;
pub mod circle_profile;
pub mod cylinder_chart;
pub mod cylinder_step;
pub mod analytic;
pub mod sphere;
pub mod axial;
mod axial_measure;
mod axial_step;
mod sphere_measure;
pub mod sphere_step;
pub mod perforated;
pub mod perforated_step;
pub mod revolve;
pub mod revolve_step;
pub mod revolve_polygon;
pub mod revolve_sector;
pub mod revolve_sector_step;

pub mod pattern;
pub mod distance;
pub mod placement;
pub mod query;

pub mod lens;
mod lens_measure;
mod lens_step;

pub mod mesh;
mod mesh_curved;
pub mod arc_profile;
mod arc_profile_brep;
mod arc_profile_observe;
