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

pub mod reference;
pub mod planar;

#[cfg(feature = "plant")]
pub(crate) use planar::plant;
pub(crate) use planar::{arrangement, exact, face, halfspace, model, num, provenance, solid, topo, validate, wire};

// The planar extrusion slice on strict `rust`: sketch region ->
// exact BLIND prism as a WC0 v3 body in its Frame::Interpreter -> exact audit
// -> general measurements -> planar STEP. Reached through `host::host_op`.
mod curve_query;
mod model_curved;
mod edge_query_exact;
pub mod edge_query;
pub mod region_query;
pub mod sketch_pick;
pub mod fillet;
pub mod chamfer;
pub mod chamfer_rim;
mod conical_brep;
mod conical_observe;
mod conical_step;
mod fillet_corner;
mod fillet_corner_audit;
mod fillet_corner_observe;
pub mod fillet_prism;
mod fillet_observe;
mod analytic_pi;
mod fillet_step;
mod profile_blend;
mod fillet_rim;
mod stack_blend;
mod stack_generator;
mod fillet_rim_brep;
mod fillet_rim_observe;
mod source_frame;
mod carrier_coincidence;
pub mod orthogonal;
mod planar_boolean;
pub mod planar_shell;
mod planar_geometry;
mod planar_region;
pub mod affine;
pub mod extrude;
pub mod loft;
mod broad_phase;
pub mod interference_proof;
pub mod host;
pub mod shadow;
pub mod carriers;
pub mod polyhedron;
pub mod rounding;
pub mod step;
pub mod curve_source;
pub mod step_carrier;
pub mod cylinder;
mod construction_geom;
pub mod bicylinder;
pub mod bicylinder_step;
pub mod cylinder_tee;
mod cylinder_tee_step;
mod cylinder_probe;
mod probe_exact;
pub mod circle_profile;
pub mod sketch_regions;
pub mod coaxial;
mod coaxial_probe;
mod coaxial_step;
pub mod cylinder_chart;
pub mod cylinder_step;
pub mod analytic;
pub mod model_boolean;
pub mod model_export;
mod model_wire;
pub mod model_rim;
pub mod sphere;
pub mod axial;
mod axial_measure;
mod axial_step;
mod sphere_measure;
pub mod sphere_step;
pub mod prism_holes;
pub mod prism_stack;
mod prism_stack_brep;
mod prism_stack_observe;
pub mod prism_columns;
mod prism_columns_distance;
mod prism_holes_observe;
mod prism_holes_distance;
mod prism_holes_revolved;
mod prism_holes_cells;
mod prism_pocket;
pub mod perforated;
pub mod perforated_step;
pub mod perforated_chamfer;
pub mod revolve;
pub mod revolve_full;
mod revolve_boolean;
mod revolve_full_observe;
mod revolve_full_step;
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
mod mesh_boundary;
mod mesh_curved;
pub mod arc_profile;
pub mod curve_profile;
pub mod curve_profile_mesh;
mod arc_profile_brep;
mod arc_profile_observe;

mod mesh_triangulate;
mod mesh_planar_exact;

mod fillet_general;
