//! B-rep data of the planar Boolean (analytic.bend, topology.bend,
//! face-classification.bend, ports/planar-boolean-types.bend) with f64 geometry.

use crate::num::{v3, P3, Scalar};

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Curve {
    Line { origin: P3, direction: P3 },
    /// Circles and ellipses are decoded only to be refused (the planar family admits lines).
    Round,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Surface {
    Plane { origin: P3, normal: P3, x: P3 },
    /// Cylinder, cone, sphere, torus: decoded only to be refused.
    Other,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Use {
    pub edge: u32,
    pub forward: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Edge {
    pub start: u32,
    pub end: u32,
    pub curve: Curve,
    pub same_sense: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Loop {
    pub outer: bool,
    pub uses: Vec<Use>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Face {
    pub surface: Surface,
    pub same_sense: bool,
    pub loops: Vec<Loop>,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct Solid {
    pub vertices: Vec<P3>,
    pub edges: Vec<Edge>,
    pub faces: Vec<Face>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Domain {
    Untrimmed,
    Interval { first: f64, last: f64 },
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum DomainChoice {
    Auto,
    Given(Domain),
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Tolerance {
    pub linear: f64,
    pub angular: f64,
}

// ---------------------------------------------------------------- result types

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reason {
    InvalidInput = 0,
    InvalidTopology = 1,
    UnsupportedSurface = 2,
    UnsupportedCurve = 3,
    UnsupportedDomain = 4,
    SourceTolerance = 5,
    AmbiguousContact = 6,
    UnsupportedArrangement = 7,
    ResolutionLimit = 8,
    ConstructionFailure = 9,
}

impl Reason {
    pub fn name(self) -> &'static str {
        match self {
            Reason::InvalidInput => "InvalidInput",
            Reason::InvalidTopology => "InvalidTopology",
            Reason::UnsupportedSurface => "UnsupportedSurface",
            Reason::UnsupportedCurve => "UnsupportedCurve",
            Reason::UnsupportedDomain => "UnsupportedDomain",
            Reason::SourceTolerance => "SourceTolerance",
            Reason::AmbiguousContact => "AmbiguousContact",
            Reason::UnsupportedArrangement => "UnsupportedArrangement",
            Reason::ResolutionLimit => "ResolutionLimit",
            Reason::ConstructionFailure => "ConstructionFailure",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FaceRef {
    pub operand: u32,
    pub index: u32,
}

#[derive(Clone, Debug, PartialEq)]
pub struct FaceOrigin {
    pub owner: FaceRef,
    pub contributors: Vec<FaceRef>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum EdgeOrigin {
    OriginalEdge { operand: u32, index: u32 },
    FaceIntersection { first: FaceRef, second: FaceRef },
    FaceSubdivision { faces: Vec<FaceRef> },
}

#[derive(Clone, Debug, PartialEq)]
pub struct Body {
    pub solid: Solid,
    pub domains: Vec<DomainChoice>,
    pub face_origins: Vec<FaceOrigin>,
    pub edge_origins: Vec<EdgeOrigin>,
}

#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub struct Stats {
    pub planes: u32,
    pub cells: u32,
    pub selected_cells: u32,
    pub shared_vertices: u32,
    pub boundary_faces: u32,
    pub internal_interfaces: u32,
}

#[derive(Clone, Debug, PartialEq)]
pub enum BoolResult {
    Bodies { bodies: Vec<Body>, stats: Stats },
    Unresolved { reason: Reason, stage: u32, detail: u32, stats: Stats },
    /// Spike-only: an interval comparison or exact predicate could not be decided.
    Undecidable { site: &'static str, stats: Stats },
}

// ---------------------------------------------------------------- helpers shared by the ports

/// A.axis_x(n)
pub fn axis_x<T: Scalar>(n: crate::num::V3<T>, nx_small: bool) -> crate::num::V3<T> {
    let candidate = if nx_small { crate::num::V3 { x: T::c(1.0), y: T::c(0.0), z: T::c(0.0) } } else { crate::num::V3 { x: T::c(0.0), y: T::c(1.0), z: T::c(0.0) } };
    candidate.sub(n.scale(candidate.dot(n))).normalize()
}

/// A.plane(origin, normal) = Plane{origin, n, axis_x(n)}, n = normalize(normal)
pub fn plane(origin: P3, normal: P3) -> Surface {
    let n = normal.normalize();
    Surface::Plane { origin, normal: n, x: axis_x(n, n.x.abs() < 0.9_f32 as f64) }
}

pub fn origin_of(s: &Surface) -> P3 {
    match s {
        Surface::Plane { origin, .. } => *origin,
        Surface::Other => v3(0.0, 0.0, 0.0),
    }
}
pub fn normal_of(s: &Surface) -> P3 {
    match s {
        Surface::Plane { normal, .. } => *normal,
        Surface::Other => v3(0.0, 0.0, 0.0),
    }
}
