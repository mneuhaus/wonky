//! Frozen WC0 tags and field order. Also generates the JSON diagnostic schema.
//! Changing a tag, field order, or meaning requires a new schema version.
use super::*;
macro_rules! indices { ($($name:ident),*) => { $(
    impl Value for $name {
        fn put(&self, out: &mut Vec<u32>) -> Result<()> { self.0.put(out) }
        fn get(r: &mut Reader<'_>) -> Result<Self> { Ok(Self(u32::get(r)?)) }
        fn json(&self) -> String { self.0.json() }
        fn schema() -> String { u32::schema() }
    }
)* }; }
indices!(
    FrameId, NodeId, VertexId, CurveId, SurfaceId, PcurveId, EdgeId, CoedgeId, LoopId, FaceId,
    ShellId, SolidId
);
record!(BodyKey {
    id: [u32; 4],
    revision: u32
});
choice!(Provenance { 0 => None {}, 1 => Construction { node: NodeId } });
choice!(Frame {
    5 => RationalImage { base: FrameId, rows: [Vector3; 3], denominator: Binary64 },
    0 => Source { source: [u32; 4] },
    1 => Rigid { parent: FrameId, translation: Vector3, axis: Vector3, angle: Binary64 },
    2 => Interpreter { parent: FrameId, origin: Vector3, x: Vector3, z: Vector3 },
    3 => AffineImage { base: FrameId, translation: Vector3, rows: [Vector3; 3] },
    4 => InterpreterImage { base: FrameId, origin: Vector3, x: Vector3, z: Vector3 },
});
choice!(Operation {
    0 => Interpreter {}, 1 => LineThrough {}, 2 => Plane {}, 3 => RigidTransform {},
    4 => Sketch {}, 5 => Extrude {}, 6 => Revolve {}, 7 => Intersection {}, 8 => Boolean {}, 9 => Point {}, 10 => Sphere {}, 11 => AffineTransform {}, 12 => Fillet {}, 13 => Shell {}, 14 => Loft {},
});
record!(Construction { operation: Operation, rule_version: u32, parents: Vec<NodeId>, parameters: Vec<Binary64>, frame: FrameId });
choice!(Limit { 0 => NegativeInfinity {}, 1 => Finite { value: Binary64, closed: bool }, 2 => PositiveInfinity {} });
record!(Domain {
    lower: Limit,
    upper: Limit
});
choice!(ArcKind { 0 => Full {}, 1 => Trimmed {} });
choice!(HyperbolaBranch { 0 => Negative {}, 1 => Positive {} });
choice!(ParabolaBranch { 0 => Whole {}, 1 => Negative {}, 2 => Positive {} });
record!(Estimate {
    magnitude: Binary64
});
record!(EnclosureClaim {
    magnitude: Binary64,
    witness: ProofRef
});
record!(ProofRef { rule: u32, nodes: Vec<NodeId> });
choice!(Bound { 0 => Estimated { estimate: Estimate }, 1 => Enclosed { claim: EnclosureClaim } });
choice!(Quantity { 0 => Length {}, 1 => Area {}, 2 => VolumeClosed {}, 3 => VolumeQuadrature {}, 4 => Angle {} });
record!(Budget {
    quantity: Quantity,
    approximation: Bound,
    construction: Bound,
    integration: Bound,
    export: Bound,
    total: Bound,
    maximum: Binary64,
    scale: Binary64,
    reference_width: Binary64
});
record!(TubeSegment {
    domain: Domain,
    start: Vector3,
    end: Vector3,
    radius: Bound
});
record!(Tube { segments: Vec<TubeSegment>, budget: u32 });
choice!(CurveGeometry {
    8 => ConstructionLine { edge: EdgeId },
    11 => ConstructionCurve { slot: u32, closed: bool },
    9 => CylinderIntersection { origin: Vector3, large_axis: Vector3, small_axis: Vector3, large_radius: Binary64, small_radius: Binary64 },
    7 => VectorEllipse { origin: Vector3, cosine: Vector3, sine: Vector3, arc: ArcKind },
    0 => Line { a: Vector3, b: Vector3 },
    1 => Circle { origin: Vector3, normal: Vector3, x: Vector3, radius: Binary64, arc: ArcKind },
    2 => Ellipse { origin: Vector3, normal: Vector3, x: Vector3, major: Binary64, minor: Binary64, arc: ArcKind },
    3 => Parabola { origin: Vector3, axis: Vector3, x: Vector3, focal: Binary64, branch: ParabolaBranch },
    4 => Hyperbola { origin: Vector3, axis: Vector3, x: Vector3, major: Binary64, minor: Binary64, branch: HyperbolaBranch },
    5 => Trace { surfaces: [SurfaceId; 2], tube: Tube },
    6 => SphereCircle { origin: Vector3, normal: Vector3, x: Vector3, sphere_radius: Binary64, height: Binary64 },
    10 => BSpline { degree: u32, knots: Vec<Binary64>, controls: Vec<Vector3>, weights: Vec<Binary64>, periodic: bool },
});
record!(Support {
    surface: SurfaceId,
    pcurve: PcurveId
});
record!(Curve { frame: FrameId, provenance: Provenance, geometry: CurveGeometry, domain: Domain, supports: Vec<Support> });
choice!(SurfaceGeometry {
    6 => ConeMeridian { origin: Vector3, axis: Vector3, x: Vector3, start: Vector2, end: Vector2 },
    0 => Plane { origin: Vector3, normal: Vector3, x: Vector3 },
    1 => Cylinder { origin: Vector3, axis: Vector3, x: Vector3, radius: Binary64 },
    2 => Cone { origin: Vector3, axis: Vector3, x: Vector3, radius: Binary64, angle: Binary64 },
    3 => Sphere { origin: Vector3, axis: Vector3, x: Vector3, radius: Binary64 },
    4 => Torus { origin: Vector3, axis: Vector3, x: Vector3, major: Binary64, minor: Binary64 },
    5 => ConeSlope { origin: Vector3, axis: Vector3, x: Vector3, radius: Binary64, slope: Binary64 },
    7 => LinearExtrusion { curve: CurveId, direction: Vector3 },
});
record!(Surface {
    frame: FrameId,
    provenance: Provenance,
    geometry: SurfaceGeometry
});
choice!(PcurveGeometry {
    7 => CylinderIntersection {},
    6 => Harmonic { offset: Vector2, linear: Vector2, cosine: Vector2, sine: Vector2 },
    5 => SphereLatitude { height: Binary64 },
    4 => CircularArc { center: Vector2, x: Vector2, radius: Binary64, clockwise: bool },
    3 => Circle { origin: Vector2, radius: Binary64, clockwise: bool },
    0 => Line { a: Vector2, b: Vector2 },
    1 => RationalBezier { controls: Vec<Vector2>, weights: Vec<Binary64> },
    2 => Samples { parameters: Vec<Binary64>, points: Vec<Vector2>, error: Bound },
    8 => BSpline { degree: u32, knots: Vec<Binary64>, controls: Vec<Vector2>, weights: Vec<Binary64> },
});
record!(Pcurve {
    curve: CurveId,
    surface: SurfaceId,
    domain: Domain,
    geometry: PcurveGeometry
});
record!(Vertex {
    point: Vector3,
    frame: FrameId,
    provenance: Provenance
});
record!(Edge {
    curve: CurveId,
    domain: Domain,
    vertices: Vec<VertexId>
});
record!(Coedge {
    edge: EdgeId,
    forward: bool,
    pcurve: PcurveId
});
record!(Loop { outer: bool, coedges: Vec<CoedgeId> });
record!(Face { surface: SurfaceId, forward: bool, loops: Vec<LoopId> });
record!(Shell { faces: Vec<FaceId> });
record!(Solid { shells: Vec<ShellId> });
record!(ContainedClaim {
    body: BodyKey,
    curve: CurveId,
    surface: SurfaceId,
    rule: u32
});
choice!(Fact {
    0 => CurveOnSurface { claim: ContainedClaim },
    1 => VertexOnEdge { body: BodyKey, vertex: VertexId, edge: EdgeId, parameter: Binary64, rule: u32 },
    2 => EdgeOnSurface { body: BodyKey, edge: EdgeId, surface: SurfaceId, domain: Domain, rule: u32 },
    3 => VertexOnSurface { body: BodyKey, vertex: VertexId, surface: SurfaceId, rule: u32 },
    4 => TangentAlong { body: BodyKey, face_a: FaceId, face_b: FaceId, edge: EdgeId, domain: Domain, rule: u32 },
});
record!(Body {
    key: BodyKey, frames: Vec<Frame>, constructions: Vec<Construction>,
    vertices: Vec<Vertex>, curves: Vec<Curve>, surfaces: Vec<Surface>, pcurves: Vec<Pcurve>,
    edges: Vec<Edge>, coedges: Vec<Coedge>, loops: Vec<Loop>, faces: Vec<Face>,
    shells: Vec<Shell>, solids: Vec<Solid>, facts: Vec<Fact>, budgets: Vec<Budget>,
});
pub(super) fn definitions() -> String {
    macro_rules! defs { ($($ty:ident),*) => { vec![$(format!("\"{}\":{}", stringify!($ty), $ty::definition())),*].join(",") }; }
    defs!(
        BodyKey,
        Provenance,
        Frame,
        Operation,
        Construction,
        Limit,
        Domain,
        ArcKind,
        HyperbolaBranch,
        ParabolaBranch,
        Estimate,
        EnclosureClaim,
        ProofRef,
        Bound,
        Quantity,
        Budget,
        TubeSegment,
        Tube,
        CurveGeometry,
        Support,
        Curve,
        SurfaceGeometry,
        Surface,
        PcurveGeometry,
        Pcurve,
        Vertex,
        Edge,
        Coedge,
        Loop,
        Face,
        Shell,
        Solid,
        ContainedClaim,
        Fact,
        Body
    )
}
