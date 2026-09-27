//! WC0 transport contract. This is NOT a second geometry kernel or a solid audit.
//! The editable Body carries claims; CheckedBody rechecks the supported incidence
//! witnesses. Bounds remain explicitly untrusted claims until their producer's
//! verifier (VA1/N1/SI4/VO1) discharges them. See docs/rust-wire-v3.md.
mod validate;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Incidence {
    Contained,
    NotContained,
}
mod numeric;
pub use validate::CheckedBody;
use wonky_num::{v3, P3};

pub type Result<T> = std::result::Result<T, ContractError>;
#[derive(Clone, Debug, PartialEq)]
pub enum ContractError {
    Numeric(wonky_num::Refusal),
    Invalid(&'static str),
    Reference(&'static str, u32),
    NonCanonical(&'static str),
    NoProvenance,
    CrossFrameUnproved,
    UnsupportedWitness(u32),
    FalseWitness,
    WidthExceeded,
}

/// Exact IEEE-754 bits, including negative zero. Construction input policy is
/// enforced at creation, not after NaN/Inf have entered a purported certificate.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Binary64(u64);
impl Binary64 {
    pub fn new(value: f64) -> Result<Self> {
        numeric::check(&[value], "wire v3 binary64").map_err(ContractError::Numeric)?;
        Ok(Self(value.to_bits()))
    }
    pub fn from_bits(bits: u64) -> Result<Self> {
        Self::new(f64::from_bits(bits))
    }
    pub fn bits(self) -> u64 {
        self.0
    }
    pub fn get(self) -> f64 {
        f64::from_bits(self.0)
    }
}
pub type Vector3 = [Binary64; 3];
pub type Vector2 = [Binary64; 2];
pub fn vector(p: P3) -> Result<Vector3> {
    Ok([
        Binary64::new(p.x)?,
        Binary64::new(p.y)?,
        Binary64::new(p.z)?,
    ])
}
pub(crate) fn point(p: Vector3) -> P3 {
    v3(p[0].get(), p[1].get(), p[2].get())
}

macro_rules! ids { ($($name:ident),*) => { $(
    #[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
    pub struct $name(pub u32);
)* }; }
ids!(
    FrameId, NodeId, VertexId, CurveId, SurfaceId, PcurveId, EdgeId, CoedgeId, LoopId, FaceId,
    ShellId, SolidId
);
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BodyKey {
    pub id: [u32; 4],
    pub revision: u32,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Provenance {
    None {},
    Construction { node: NodeId },
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Frame {
    /// The exact affine image of a prior source-to-world map. Unlike Rigid,
    /// coefficients are the interpreter's binary64 matrix, NOT a certificate
    /// of mathematical rigidity. World image = translation + rows * base(p).
    /// Geometry and oriented loops stay in source coordinates; a negative
    /// determinant reverses world winding at export. No cross-frame facts.
    AffineImage {
        base: FrameId,
        translation: Vector3,
        rows: [Vector3; 3],
    },

    Source {
        source: [u32; 4],
    },
    Rigid {
        parent: FrameId,
        translation: Vector3,
        axis: Vector3,
        angle: Binary64,
    },
    /// An interpreter coordinate system (a sketch plane or `toWorld(cs)`), taken
    /// exactly as the interpreter passed its binary64 values (E9):
    /// `p_parent = origin + p.x*x + p.y*(z cross x) + p.z*z`, evaluated in exact real
    /// arithmetic. Nothing is normalized, orthogonalized or repaired, so the map is
    /// affine and in general not exactly rigid. Its parent is a Source frame.
    /// It is applied only by export and observation, each with a stated budget.
    /// It is never a proof basis between frames: facts compare frame ids, so any
    /// fact across it refuses `CrossFrameUnproved`, and Interpreter/LineThrough/
    /// Plane/Point nodes (source rules 1-3) cannot live in it.
    Interpreter {
        parent: FrameId,
        origin: Vector3,
        x: Vector3,
        z: Vector3,
    },
}
/// The only authoritative input basis (E9, DECIDED). Operation outputs never
/// silently become new Interpreter inputs. Unknown op/rule versions are refused.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Operation {
    Interpreter {},
    LineThrough {},
    Plane {},
    Point {},
    RigidTransform {},
    /// Exact image with interpreter binary64 affine coefficients.
    AffineTransform {},
    Sketch {},
    Extrude {},
    Revolve {},
    Intersection {},
    Boolean {},
    Sphere {},
    Fillet {},
    /// Exact inward offset in the construction frame.
    Shell {},
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Construction {
    pub operation: Operation,
    pub rule_version: u32,
    pub parents: Vec<NodeId>,
    pub parameters: Vec<Binary64>,
    pub frame: FrameId,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Limit {
    NegativeInfinity {},
    Finite { value: Binary64, closed: bool },
    PositiveInfinity {},
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Domain {
    pub lower: Limit,
    pub upper: Limit,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ArcKind {
    Full {},
    Trimmed {},
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum HyperbolaBranch {
    Negative {},
    Positive {},
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ParabolaBranch {
    Whole {},
    Negative {},
    Positive {},
}

/// A heuristic magnitude. It cannot be passed to a consumer of EnclosureClaim,
/// let alone a verified enclosure. There is deliberately no From conversion.
/// ```
/// use wonky_contract::EnclosureClaim;
/// fn certificate(_: EnclosureClaim) {}
/// fn pass_claim(x: EnclosureClaim) { certificate(x); }
/// ```
/// ```compile_fail
/// use wonky_contract::{Estimate, EnclosureClaim};
/// fn certificate(_: EnclosureClaim) {}
/// fn promote(x: Estimate) { certificate(x); }
/// ```
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Estimate {
    pub magnitude: Binary64,
}
/// A TRANSPORT CLAIM, never a validated numerical certificate. A verifier must
/// check the named rule against its operation inputs; the wire tag is not proof.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EnclosureClaim {
    pub magnitude: Binary64,
    pub witness: ProofRef,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProofRef {
    pub rule: u32,
    pub nodes: Vec<NodeId>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Bound {
    Estimated { estimate: Estimate },
    Enclosed { claim: EnclosureClaim },
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Quantity {
    Length {},
    Area {},
    VolumeClosed {},
    VolumeQuadrature {},
    Angle {},
}
/// Absolute budgets in final output units, AFTER all downstream magnifiers.
/// This is not a pipeline of unscaled intermediate rounding errors.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Budget {
    pub quantity: Quantity,
    pub approximation: Bound,
    pub construction: Bound,
    pub integration: Bound,
    pub export: Bound,
    pub total: Bound,
    pub maximum: Binary64,
    pub scale: Binary64,
    pub reference_width: Binary64,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TubeSegment {
    pub domain: Domain,
    pub start: Vector3,
    pub end: Vector3,
    pub radius: Bound,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Tube {
    pub segments: Vec<TubeSegment>,
    pub budget: u32,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CurveGeometry {
    /// Exact line through the replayed endpoints of a plane-arrangement edge.
    /// Endpoint observations may coincide in binary64; they are not its inputs.
    /// Requires Boolean construction kind 2 and the operation's geometric audit.
    ConstructionLine { edge: EdgeId },
    /// o + cosine*cos(2*pi*t) + sine*sin(2*pi*t). Nonzero orthogonal
    /// vectors keep irrational semiaxis lengths out of authoritative inputs.
    VectorEllipse { origin: Vector3, cosine: Vector3, sine: Vector3, arc: ArcKind },
    /// Exact full circle with radius sqrt(sphere_radius^2 - height^2).
    /// These are construction inputs, not a rounded radius or a tolerance tube.
    SphereCircle {
        origin: Vector3,
        normal: Vector3,
        x: Vector3,
        sphere_radius: Binary64,
        height: Binary64,
    },
    Line {
        a: Vector3,
        b: Vector3,
    },
    Circle {
        origin: Vector3,
        normal: Vector3,
        x: Vector3,
        radius: Binary64,
        arc: ArcKind,
    },
    Ellipse {
        origin: Vector3,
        normal: Vector3,
        x: Vector3,
        major: Binary64,
        minor: Binary64,
        arc: ArcKind,
    },
    Parabola {
        origin: Vector3,
        axis: Vector3,
        x: Vector3,
        focal: Binary64,
        branch: ParabolaBranch,
    },
    Hyperbola {
        origin: Vector3,
        axis: Vector3,
        x: Vector3,
        major: Binary64,
        minor: Binary64,
        branch: HyperbolaBranch,
    },
    Trace {
        surfaces: [SurfaceId; 2],
        tube: Tube,
    },
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Support {
    pub surface: SurfaceId,
    pub pcurve: PcurveId,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Curve {
    pub frame: FrameId,
    pub provenance: Provenance,
    pub geometry: CurveGeometry,
    pub domain: Domain,
    pub supports: Vec<Support>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SurfaceGeometry {
    Plane {
        origin: Vector3,
        normal: Vector3,
        x: Vector3,
    },
    Cylinder {
        origin: Vector3,
        axis: Vector3,
        x: Vector3,
        radius: Binary64,
    },
    Cone {
        origin: Vector3,
        axis: Vector3,
        x: Vector3,
        radius: Binary64,
        angle: Binary64,
    },
    Sphere {
        origin: Vector3,
        axis: Vector3,
        x: Vector3,
        radius: Binary64,
    },
    Torus {
        origin: Vector3,
        axis: Vector3,
        x: Vector3,
        major: Binary64,
        minor: Binary64,
    },
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Surface {
    pub frame: FrameId,
    pub provenance: Provenance,
    pub geometry: SurfaceGeometry,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PcurveGeometry {
    /// offset + linear*t + cosine*cos(2*pi*t) + sine*sin(2*pi*t).
    /// In cylinder charts u is in turns and v is in metres.
    Harmonic { offset: Vector2, linear: Vector2, cosine: Vector2, sine: Vector2 },
    /// Full longitude circle with exact signed height: sin(latitude) = height / radius.
    SphereLatitude { height: Binary64 },
    /// Circular chart curve, x is the unit start direction. Parameter is turns.
    CircularArc { center: Vector2, x: Vector2, radius: Binary64, clockwise: bool },
    /// Full analytic circle, parameterized by turns (0..1), never a sampled polygon.
    Circle { origin: Vector2, radius: Binary64, clockwise: bool },
    Line {
        a: Vector2,
        b: Vector2,
    },
    RationalBezier {
        controls: Vec<Vector2>,
        weights: Vec<Binary64>,
    },
    Samples {
        parameters: Vec<Binary64>,
        points: Vec<Vector2>,
        error: Bound,
    },
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Pcurve {
    pub curve: CurveId,
    pub surface: SurfaceId,
    pub domain: Domain,
    pub geometry: PcurveGeometry,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Vertex {
    pub point: Vector3,
    pub frame: FrameId,
    pub provenance: Provenance,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Edge {
    pub curve: CurveId,
    pub domain: Domain,
    /// Empty for a full algebraic ring, otherwise two endpoint references.
    pub vertices: Vec<VertexId>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Coedge {
    pub edge: EdgeId,
    pub forward: bool,
    pub pcurve: PcurveId,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Loop {
    pub outer: bool,
    pub coedges: Vec<CoedgeId>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Face {
    pub surface: SurfaceId,
    pub forward: bool,
    pub loops: Vec<LoopId>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Shell {
    pub faces: Vec<FaceId>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Solid {
    pub shells: Vec<ShellId>,
}
/// Currently supported rule 1: exact source LineThrough in source Plane,
/// carried by identical symbolic rigid frame. Unsupported rules never pass.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContainedClaim {
    pub body: BodyKey,
    pub curve: CurveId,
    pub surface: SurfaceId,
    pub rule: u32,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Fact {
    CurveOnSurface {
        claim: ContainedClaim,
    },
    VertexOnEdge {
        body: BodyKey,
        vertex: VertexId,
        edge: EdgeId,
        parameter: Binary64,
        rule: u32,
    },
    EdgeOnSurface {
        body: BodyKey,
        edge: EdgeId,
        surface: SurfaceId,
        domain: Domain,
        rule: u32,
    },
    VertexOnSurface {
        body: BodyKey,
        vertex: VertexId,
        surface: SurfaceId,
        rule: u32,
    },
    TangentAlong {
        body: BodyKey,
        face_a: FaceId,
        face_b: FaceId,
        edge: EdgeId,
        domain: Domain,
        rule: u32,
    },
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Body {
    pub key: BodyKey,
    pub frames: Vec<Frame>,
    pub constructions: Vec<Construction>,
    pub vertices: Vec<Vertex>,
    pub curves: Vec<Curve>,
    pub surfaces: Vec<Surface>,
    pub pcurves: Vec<Pcurve>,
    pub edges: Vec<Edge>,
    pub coedges: Vec<Coedge>,
    pub loops: Vec<Loop>,
    pub faces: Vec<Face>,
    pub shells: Vec<Shell>,
    pub solids: Vec<Solid>,
    pub facts: Vec<Fact>,
    pub budgets: Vec<Budget>,
}
