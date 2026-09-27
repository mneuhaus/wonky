//! Arena B-rep spike: closed convex planar faces, exact source incidence,
//! checked construction facts, and symbolic rigid placements.
//! `contract` defines the WC0 transport types; wonky-wire owns their v3 codec.
#![deny(unused_must_use)]
mod audit;
pub use wonky_contract as contract;
mod numeric;
mod placement;
pub use placement::{Placement, Rigid};
use std::collections::{BTreeMap, BTreeSet};
use wonky_num::{v3, Iv, Refusal, Sign, P3};

pub type Result<T> = std::result::Result<T, Error>;
#[derive(Clone, Debug, PartialEq)]
pub enum Error {
    Numeric(Refusal),
    Degenerate(&'static str),
    InvalidReference(&'static str, usize),
    Invalid(Vec<Issue>),
    Unsupported(&'static str),
}

/// Arena-local indices, not global identities or transferable proof tokens.
macro_rules! ids {
    ($($name:ident),*) => { $(
        #[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
        pub struct $name(pub usize);
    )* };
}
ids!(VertexId, CurveId, EdgeId, CoedgeId, LoopId, SurfaceId, FaceId, ShellId, SolidId);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Orientation {
    Forward,
    Reversed,
}
impl Orientation {
    pub fn reversed(self) -> Self {
        match self {
            Self::Forward => Self::Reversed,
            Self::Reversed => Self::Forward,
        }
    }
    pub(crate) fn sign(self) -> f64 {
        if self == Self::Forward {
            1.
        } else {
            -1.
        }
    }
}

#[derive(Clone, Debug)]
pub struct Vertex {
    pub point: P3,
}
/// The affine line a + t*(b-a), evaluated symbolically by incidence predicates.
/// Deliberately minimal geometry adapter, not a second analytic geometry kernel.
#[derive(Clone, Debug)]
pub enum Curve {
    Line { a: P3, b: P3 },
}
#[derive(Clone, Copy, Debug)]
pub struct ParameterRange {
    pub start: f64,
    pub end: f64,
}
#[derive(Clone, Debug)]
pub struct Edge {
    pub curve: CurveId,
    pub range: ParameterRange,
    pub vertices: [VertexId; 2],
}
#[derive(Clone, Debug)]
pub struct Coedge {
    pub edge: EdgeId,
    pub orientation: Orientation,
}
#[derive(Clone, Debug)]
pub struct Loop {
    pub coedges: Vec<CoedgeId>,
}
#[derive(Clone, Debug)]
pub enum Surface {
    Plane { origin: P3, normal: P3 },
}
#[derive(Clone, Debug)]
pub struct Face {
    pub surface: SurfaceId,
    pub orientation: Orientation,
    pub loops: Vec<LoopId>,
}
#[derive(Clone, Debug)]
pub struct Shell {
    pub faces: Vec<FaceId>,
}
#[derive(Clone, Debug)]
pub struct Solid {
    pub shells: Vec<ShellId>,
}

/// Editable construction/import boundary. No cached facts live here. finish()
/// validates ALL geometry/topology and reconstructs facts; edits cannot retain a
/// stale certificate. Geometry in these arrays is always in the source frame.
#[derive(Clone, Debug, Default)]
pub struct Draft {
    pub vertices: Vec<Vertex>,
    pub curves: Vec<Curve>,
    pub edges: Vec<Edge>,
    pub coedges: Vec<Coedge>,
    pub loops: Vec<Loop>,
    pub surfaces: Vec<Surface>,
    pub faces: Vec<Face>,
    pub shells: Vec<Shell>,
    pub solids: Vec<Solid>,
    placement: Placement,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Issue {
    Empty(&'static str),
    Reference(&'static str, usize),
    Ownership(&'static str, usize, usize),
    EndpointIncidence(EdgeId, VertexId),
    FaceIncidence(EdgeId, FaceId),
    LoopGap(LoopId),
    RepeatedVertex(LoopId),
    UnsupportedFace(FaceId),
    DanglingEdge(EdgeId),
    BoundaryEdge(EdgeId),
    NonManifoldEdge(EdgeId),
    OrientationConflict(EdgeId),
    NonManifoldVertex(VertexId),
    DisconnectedShell(ShellId),
    OverlappingFaces(FaceId, FaceId),
    InwardOrZeroShell(ShellId),
    UnsupportedCavities(SolidId),
}

/// Facts are typed, private, and tied to this immutable arena snapshot + frame.
#[derive(Clone, Debug, Default)]
struct Facts {
    vertex_edge: BTreeSet<(VertexId, EdgeId)>,
    edge_face: BTreeSet<(EdgeId, FaceId)>,
    vertex_face: BTreeSet<(VertexId, FaceId)>,
    tangent: BTreeSet<(FaceId, FaceId, EdgeId)>,
}
pub use contract::Incidence;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Evidence {
    Construction,
    ExactSourcePredicate,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct IncidenceDecision {
    pub incidence: Incidence,
    pub evidence: Evidence,
}
impl IncidenceDecision {
    fn proven() -> Self {
        Self {
            incidence: Incidence::Contained,
            evidence: Evidence::Construction,
        }
    }
    fn source(yes: bool) -> Self {
        Self {
            incidence: if yes {
                Incidence::Contained
            } else {
                Incidence::NotContained
            },
            evidence: Evidence::ExactSourcePredicate,
        }
    }
}

/// Read-only validated model. Clone/copy preserves source identity and facts;
/// transformed() appends a proper rigid op to the entire body, not its f64 cache.
#[derive(Clone, Debug)]
pub struct Brep {
    source: Draft,
    facts: Facts,
}

impl Draft {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn add_vertex(&mut self, point: P3) -> VertexId {
        let id = VertexId(self.vertices.len());
        self.vertices.push(Vertex { point });
        id
    }
    pub fn add_plane(&mut self, origin: P3, normal: P3) -> SurfaceId {
        let id = SurfaceId(self.surfaces.len());
        self.surfaces.push(Surface::Plane { origin, normal });
        id
    }
    /// Construct a parameterized edge from source endpoints. Invalid geometry is
    /// rejected at finish(); all references are checked before indexing here.
    pub fn add_line_edge(&mut self, a: VertexId, b: VertexId) -> Result<EdgeId> {
        let pa = self
            .vertices
            .get(a.0)
            .ok_or(Error::InvalidReference("vertex", a.0))?
            .point;
        let pb = self
            .vertices
            .get(b.0)
            .ok_or(Error::InvalidReference("vertex", b.0))?
            .point;
        let curve = CurveId(self.curves.len());
        self.curves.push(Curve::Line { a: pa, b: pb });
        let id = EdgeId(self.edges.len());
        self.edges.push(Edge {
            curve,
            range: ParameterRange { start: 0., end: 1. },
            vertices: [a, b],
        });
        Ok(id)
    }
    /// Add a convex polygon wound along the carrier's positive normal. The face
    /// orientation separately chooses which side of the carrier is outward.
    pub fn add_polygon(
        &mut self,
        surface: SurfaceId,
        orientation: Orientation,
        vertices: &[VertexId],
    ) -> Result<FaceId> {
        if vertices.len() < 3 {
            return Err(Error::Degenerate("polygon"));
        }
        if surface.0 >= self.surfaces.len() {
            return Err(Error::InvalidReference("surface", surface.0));
        }
        for v in vertices {
            if v.0 >= self.vertices.len() {
                return Err(Error::InvalidReference("vertex", v.0));
            }
        }
        let mut coedges = Vec::new();
        for i in 0..vertices.len() {
            let a = vertices[i];
            let b = vertices[(i + 1) % vertices.len()];
            let existing = self
                .edges
                .iter()
                .position(|e| e.vertices == [a, b] || e.vertices == [b, a]);
            let edge = match existing {
                Some(e) => EdgeId(e),
                None => self.add_line_edge(a, b)?,
            };
            let sense = if self.edges[edge.0].vertices == [a, b] {
                Orientation::Forward
            } else {
                Orientation::Reversed
            };
            let id = CoedgeId(self.coedges.len());
            self.coedges.push(Coedge {
                edge,
                orientation: sense,
            });
            coedges.push(id);
        }
        let lp = LoopId(self.loops.len());
        self.loops.push(Loop { coedges });
        let face = FaceId(self.faces.len());
        self.faces.push(Face {
            surface,
            orientation,
            loops: vec![lp],
        });
        Ok(face)
    }
    pub fn finish(self) -> Result<Brep> {
        self.audit()?;
        let mut facts = Facts::default();
        let mut uses: BTreeMap<EdgeId, Vec<FaceId>> = BTreeMap::new();
        for (i, e) in self.edges.iter().enumerate() {
            for v in e.vertices {
                facts.vertex_edge.insert((v, EdgeId(i)));
            }
        }
        for (f, face) in self.faces.iter().enumerate() {
            for lp in &face.loops {
                for c in &self.loops[lp.0].coedges {
                    let edge = self.coedges[c.0].edge;
                    facts.edge_face.insert((edge, FaceId(f)));
                    for v in self.edges[edge.0].vertices {
                        facts.vertex_face.insert((v, FaceId(f)));
                    }
                    uses.entry(edge).or_default().push(FaceId(f));
                }
            }
        }
        for (edge, faces) in uses {
            let (a, b) = (faces[0].min(faces[1]), faces[0].max(faces[1]));
            let Surface::Plane { normal: na, .. } = self.surfaces[self.faces[a.0].surface.0];
            let Surface::Plane { normal: nb, .. } = self.surfaces[self.faces[b.0].surface.0];
            if numeric::parallel(na, nb)? {
                facts.tangent.insert((a, b, edge));
            }
        }
        Ok(Brep {
            source: self,
            facts,
        })
    }
}

impl Brep {
    pub fn topology(&self) -> &Draft {
        &self.source
    }
    /// Edits are not trusted: finish must re-prove facts on the edited snapshot.
    pub fn to_draft(&self) -> Draft {
        self.source.clone()
    }
    pub fn placement(&self) -> &Placement {
        &self.source.placement
    }
    pub fn transformed(&self, by: Rigid) -> Self {
        let mut copy = self.clone();
        copy.source.placement.push(by);
        copy
    }
    pub fn approximate_vertex(&self, v: VertexId) -> Result<P3> {
        let p = self
            .source
            .vertices
            .get(v.0)
            .ok_or(Error::InvalidReference("vertex", v.0))?
            .point;
        self.placement().approximate_point(p)
    }
    pub fn edge_on_face(&self, e: EdgeId, f: FaceId) -> Result<IncidenceDecision> {
        // Provenance first. Even an unusable world-space approximation cannot
        // turn a construction incidence into a point crossing or a gap.
        if self.facts.edge_face.contains(&(e, f)) {
            return Ok(IncidenceDecision::proven());
        }
        Ok(IncidenceDecision::source(self.source.edge_in_plane(e, f)?))
    }
    pub fn vertex_on_face(&self, v: VertexId, f: FaceId) -> Result<IncidenceDecision> {
        if self.facts.vertex_face.contains(&(v, f)) {
            return Ok(IncidenceDecision::proven());
        }
        let p = self
            .source
            .vertices
            .get(v.0)
            .ok_or(Error::InvalidReference("vertex", v.0))?
            .point;
        let face = self
            .source
            .faces
            .get(f.0)
            .ok_or(Error::InvalidReference("face", f.0))?;
        let Surface::Plane { origin, normal } = self.source.surfaces[face.surface.0];
        Ok(IncidenceDecision::source(
            numeric::plane_side(normal, p, origin)? == Sign::Zero,
        ))
    }
    /// Incidence with the trimmed edge, not merely its infinite carrier.
    pub fn vertex_on_edge(&self, v: VertexId, e: EdgeId) -> Result<IncidenceDecision> {
        if self.facts.vertex_edge.contains(&(v, e)) {
            return Ok(IncidenceDecision::proven());
        }
        let p = self
            .source
            .vertices
            .get(v.0)
            .ok_or(Error::InvalidReference("vertex", v.0))?
            .point;
        let edge = self
            .source
            .edges
            .get(e.0)
            .ok_or(Error::InvalidReference("edge", e.0))?;
        // finish() proved these endpoints equal a + t*(b-a) at both range
        // bounds. A trimmed affine line is exactly their closed segment, so
        // collinearity and coordinate bounds decide membership without inverting
        // a parameter (which need not be representable as binary64).
        let [a, b] = edge.vertices.map(|v| self.source.vertices[v.0].point);
        Ok(IncidenceDecision::source(numeric::on_segment(p, a, b)?))
    }
    /// Tangency is carrier tangency along this common boundary, not oriented G1.
    pub fn tangent_along(&self, a: FaceId, b: FaceId, edge: EdgeId) -> Result<bool> {
        for face in [a, b] {
            if face.0 >= self.source.faces.len() {
                return Err(Error::InvalidReference("face", face.0));
            }
        }
        if edge.0 >= self.source.edges.len() {
            return Err(Error::InvalidReference("edge", edge.0));
        }
        if a == b {
            return Err(Error::Degenerate("tangency needs two faces"));
        }
        if !self.facts.edge_face.contains(&(edge, a)) || !self.facts.edge_face.contains(&(edge, b))
        {
            return Err(Error::Degenerate("edge not shared by both faces"));
        }
        Ok(self.facts.tangent.contains(&(a.min(b), a.max(b), edge)))
    }
    /// Certified enclosure of the exact source polyhedron / symbolic rigid image.
    /// It does NOT enclose the volume of independently rounded exported vertices.
    pub fn volume(&self, solid: SolidId) -> Result<Iv> {
        let solid = self
            .source
            .solids
            .get(solid.0)
            .ok_or(Error::InvalidReference("solid", solid.0))?;
        let mut total = Iv::point(0.);
        for shell in &solid.shells {
            total = total + self.source.shell_volume(*shell)?;
        }
        Ok(total)
    }

    pub fn cuboid(size: P3) -> Result<Self> {
        for d in numeric::xyz(size) {
            if numeric::compare(d, 0.)? != Sign::Positive {
                return Err(Error::Degenerate("box size"));
            }
        }
        let mut d = Draft::new();
        let (x, y, z) = (size.x, size.y, size.z);
        for p in [
            v3(0., 0., 0.),
            v3(x, 0., 0.),
            v3(x, y, 0.),
            v3(0., y, 0.),
            v3(0., 0., z),
            v3(x, 0., z),
            v3(x, y, z),
            v3(0., y, z),
        ] {
            d.add_vertex(p);
        }
        let specs = [
            (v3(0., 0., 0.), v3(0., 0., -1.), [0, 3, 2, 1]),
            (v3(0., 0., z), v3(0., 0., 1.), [4, 5, 6, 7]),
            (v3(0., 0., 0.), v3(0., -1., 0.), [0, 1, 5, 4]),
            (v3(x, 0., 0.), v3(1., 0., 0.), [1, 2, 6, 5]),
            (v3(0., y, 0.), v3(0., 1., 0.), [2, 3, 7, 6]),
            (v3(0., 0., 0.), v3(-1., 0., 0.), [3, 0, 4, 7]),
        ];
        let mut faces = Vec::new();
        for (origin, normal, vertices) in specs {
            let surface = d.add_plane(origin, normal);
            faces.push(d.add_polygon(surface, Orientation::Forward, &vertices.map(VertexId))?);
        }
        d.shells.push(Shell { faces });
        d.solids.push(Solid {
            shells: vec![ShellId(0)],
        });
        d.finish()
    }
}
