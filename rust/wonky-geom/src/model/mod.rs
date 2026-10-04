//! `Model`: the exact in-memory B-rep of the general Boolean (boolean3d plan,
//! strand G1, stage A0). It is never transported: WC0 stays the wire format
//! and replay rebuilds a Model from the construction DAG.
//!
//! **Layers.** A [`Draft`] is plain data (public fields, no invariants). The
//! only way to a [`Model`] is [`Draft::check`], which runs the structural
//! checks and the generic audit G1-G8 (`audit`). A `Model` is immutable;
//! [`Model::into_draft`] hands the data back for an edit, which must be
//! checked again. This is the `Body` / `CheckedBody` pattern of WC0.
//!
//! **Frames.** Every carrier, curve and vertex is exact in ONE construction
//! frame, the model frame. `placement` is the exact affine map (a
//! [`Frame`]: origin and columns in Q) from the model frame to the Source
//! frame. World coordinates exist only as correctly rounded observation
//! caches ([`Model::world_cache`]) and never decide anything (plan rule X1).
//!
//! **Arena.** Entities live in per-kind vectors and refer to each other by
//! typed ids. Array order is emission order; it carries no meaning, and the
//! canonical exact form (`canonical`) is independent of it.
//!
//! **Provenance and label.** Every entity carries the construction node that
//! created it and its output slot in that node (`Provenance`). The model
//! carries one [`Label`]: `Regularized` propagates from any regularized
//! operand (rule X7) and is never set by the kernel on its own.
//!
//! **Extension points** (each is a list of compile errors, never a silent
//! default: no match on these enums has a `_` arm, `if let` or `let else`):
//! * G8 introduces `Carrier3::{Cylinder, Cone, Sphere}`, the two-patch periodic
//!   atlas (a patch index and a winding delta on each coedge), `Curve3::Circle`
//!   (whose vertex-free rings use `Bounds::Ring`) and `VertexDef::Quadratic` /
//!   `VertexKey::Quadratic`. Each curved carrier keeps its own construction
//!   frame (plan G8, C5), stored as an exact `Frame` relative to the model
//!   frame. Full latitude rings, cylindrical/conical bands and collapsed cone
//!   apexes pass the shared audit; unsupported trim classes raise named
//!   capability refusals. P5-P8/P11 expose dark source-replayed adapters. An R3
//!   (non-isometric) image of a circle is not a circle in the
//!   model frame, so a curved carrier must not be re-expressed there;
//! * G2 (crate `wonky-bool`) reads carriers and provenance for the plane
//!   relation table; plane x plane sections are `Curve3::Line`, so it adds no
//!   row (curved section rows arrive with G9);
//! * G6 emits a Model as WC0 under the next free Boolean rule version (7:
//!   rule 6 is taken by mixed-union's `prism_columns`), with the vertex caches
//!   of `world_cache`.
use crate::frame::Frame;
use crate::{cross, dot, sub, Point, Refused, Result, Q};
use num_traits::{Signed, ToPrimitive, Zero};
use wonky_curve::Trimmed;

mod audit;
pub mod translated;
pub mod quadratic_extrusion;
pub use translated::{TranslatedCircle3, TranslatedCylinder3};
pub mod extrusion;
pub mod algebraic;
pub use algebraic::{RPoint, RadicalPlane3, RadicalPolyFace, radical_polyhedron};
mod canonical;
mod placed;
pub mod curved;
mod poly;
mod tangency;
mod periodic;
mod tube;
pub use tube::{sphere_ring_trim, RadicalTubeBand, TubeBand};
mod patch;
pub use patch::{Profile, RevPatch};
pub mod revolution;
pub mod revolution_partial;
pub mod stereo;
pub use tangency::{EdgeTangency, FaceTangency};
pub use periodic::{AtanSum, AtlasPiece, AtlasTrim, MomentValue, PiValue, RadicalBand, RevolutionBand, Membership, SurdPiValue};
pub use curved::{Circle3, Cone3, Cylinder3, QuadraticPoint3, RadicalCircle3, Sphere3, Torus3};

pub use canonical::{Canonical, CanonicalEdge, CanonicalFace, CarrierKey, CurveKey, EdgeEnds};
pub use poly::{polyhedron, PolyFace};

macro_rules! ids {
    ($($name:ident),*) => {$(
        #[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
        pub struct $name(pub u32);
        impl $name {
            pub fn index(self) -> usize {
                self.0 as usize
            }
        }
    )*};
}
ids!(SurfaceId, CurveId, VertexId, EdgeId, CoedgeId, LoopId, FaceId, ShellId, SolidId);

/// The construction node that created an entity and which of that node's
/// outputs it is. A carrier names the operand node whose data define it (for
/// a box leaf: its face `axis * 2 + max`); topology created by an operation
/// names that operation's node, with its slot in the operation's
/// deterministic emission order (a function of exact data only).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Provenance {
    pub node: u32,
    pub slot: u32,
}

/// Exactness class of the whole model.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Label {
    Exact,
    /// Built under the opt-in regularized contact mode; propagates to results.
    Regularized,
}

/// A 3D vertex by definition, never by coordinates.
#[derive(Clone, Debug)]
pub enum VertexDef {
    /// Binary64 construction values in the model frame: interpreter inputs
    /// (E9) or dyadic values the construction itself proves exact (a shell
    /// offset refuses when it is not). Must be finite.
    Input([f64; 3]),
    /// A rational point (plane triples, rational frame images).
    Rational(Point),
    Quadratic(QuadraticPoint3),
    OnCurve(crate::rotation::OnCurve),
    Real(RPoint),
    /// Exact Q(sqrt) coordinates from planar face-distance constructions.
    Radical([wonky_curve::radical::Radical; 3]),
}

/// The exact identity of a vertex: equal points have equal keys whatever
/// `VertexDef` class produced them. G8 adds `Quadratic` in a normal form
/// (a zero radical part is `Rational`).
#[derive(Clone, Debug)]
pub enum VertexKey {
    Rational(Point),
    Quadratic(QuadraticPoint3),
    Real(RPoint),
}

// Storage classes must never decide point identity or ordering. A field tower
// unsupported by exact scalar arithmetic raises a typed refusal at admission.
impl PartialEq for VertexKey {fn eq(&self,b:&Self)->bool {self.cmp(b)==std::cmp::Ordering::Equal}}
impl Eq for VertexKey {}
impl PartialOrd for VertexKey {fn partial_cmp(&self,b:&Self)->Option<std::cmp::Ordering>{Some(self.cmp(b))}}
impl Ord for VertexKey {
    fn cmp(&self,b:&Self)->std::cmp::Ordering {
        match (self,b) {
            (Self::Rational(a),Self::Rational(b))=>a.cmp(b),
            (Self::Quadratic(a),Self::Quadratic(b))=>a.cmp(b),
            (Self::Real(a),Self::Real(b))=>a.cmp(b),
            (Self::Rational(_),Self::Quadratic(_)) | (Self::Quadratic(_),Self::Rational(_)) |
            (Self::Rational(_),Self::Real(_)) | (Self::Real(_),Self::Rational(_)) |
            (Self::Quadratic(_),Self::Real(_)) | (Self::Real(_),Self::Quadratic(_))=>self.coordinates().cmp(&b.coordinates()),
        }
    }
}

impl VertexKey {
    pub fn coordinates(&self) -> RPoint {
        match self { Self::Rational(p) => algebraic::lift(p), Self::Quadratic(p) => p.coordinates().clone(), Self::Real(p)=>p.clone() }
    }
    pub fn rational(&self) -> Result<&Point> {
        match self {
            Self::Rational(p) => Ok(p),
            Self::Quadratic(_) | Self::Real(_) => Err(Refused(
                "boolean/ssi-row-unavailable:quadratic/rational-consumer",
            )),
        }
    }
}
impl Carrier3 {
    pub fn rotated(base: Carrier3, axis: crate::rotation::Line3, turn: crate::Turn) -> Result<Self> {
        let rotated=crate::rotation::Rotated {base:Box::new(base),axis,turn};
        rotated.point(&crate::zero())?;
        if rotated.turn.class()==crate::TurnClass::Rational {rotated.rational_carrier()} else {Ok(Self::Rotated(rotated))}
    }
    pub fn plane(&self) -> Result<&Plane3> {
        match self {
            Self::Rotated(_) => Err(Refused("model/rotated/rational-consumer")),
            Self::Plane(p) => Ok(p),
            Self::RadicalPlane(_) => Err(Refused("model/radical-plane/rational-consumer")),
            Self::Cylinder(_) | Self::TranslatedCylinder(_) | Self::Cone(_) | Self::Sphere(_) => Err(Refused(
                "boolean/ssi-row-unavailable:curved/planar-consumer",
            )),
            Self::Torus(_) => Err(Refused("boolean/ssi-row-unavailable:torus×planar-consumer")),
        }
    }
}

/// The exact plane-chart pcurve of a circle lying in a plane (the trim a
/// planar face uses for a ring or arc edge), for construction primitives
/// outside this crate.
pub fn plane_ring_pcurve(circle: &Circle3, plane: &Plane3, forward: bool) -> Result<Trimmed> {
    periodic::plane_ring(circle, plane, forward)
}

impl VertexDef {
    pub fn key(&self) -> Result<VertexKey> {
        match self {
            VertexDef::OnCurve(p) => {
                let (sin,cos)=p.t.exact_sin_cos()?;
                let coordinates=p.coordinates()?.map(|v| wonky_curve::radical::Radical::from(v.c)+cos.clone()*v.a+sin.clone()*v.b);
                if coordinates.iter().any(|v|v.is_real()) {Ok(VertexKey::Real(coordinates))} else {Ok(QuadraticPoint3::from_coordinates(coordinates)?.key())}
            },
            VertexDef::Real(p) => {
                if let Some(p)=algebraic::rational(p){return Ok(VertexKey::Rational(p));}
                let g=p.iter().find(|v|v.is_real()).ok_or(Refused("exact-real/field-tower"))?;
                if !p.iter().all(|v|v.rational().is_some()||g.same_real_field(v)){return Err(Refused("exact-real/field-tower"));}
                Ok(VertexKey::Real(p.clone()))
            },
            VertexDef::Input(p) => Ok(VertexKey::Rational(crate::point(*p)?)),
            VertexDef::Rational(p) => Ok(VertexKey::Rational(p.clone())),
            VertexDef::Quadratic(p) => Ok(p.key()),
            VertexDef::Radical(p) => Ok(QuadraticPoint3::from_coordinates(p.clone())?.key()),
        }
    }
}

/// An exact 3D curve in the model frame.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Curve3 {
    /// The line `p + t d`; `d` is not normalized and must be nonzero.
    Line {
        p: Point,
        d: Point,
    },
    /// Straight line in the admitted radical field; never a polygonal curve.
    RadicalLine { p: RPoint, d: RPoint },
    Circle(Circle3),
    TranslatedCircle(TranslatedCircle3),
    /// A latitude circle with height and radius in one quadratic field
    /// (cone-rim springs); never a rounded circle.
    RadicalCircle(RadicalCircle3),
}

/// An exact surface carrier in the model frame.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Carrier3 {
    Plane(Plane3),
    /// Planar carrier in the admitted radical field, with an exact chart.
    RadicalPlane(RadicalPlane3),
    Cylinder(Cylinder3),
    TranslatedCylinder(TranslatedCylinder3),
    Cone(Cone3),
    Sphere(Sphere3),
    Rotated(crate::rotation::Rotated),
    /// F2 (fillets3d design §2.3, plan G20's data structure without SSI
    /// rows): ring, spindle (apple sheet) tori; quartic identity, 4-patch
    /// half-angle atlas. Every Boolean consumer refuses
    /// `boolean/ssi-row-unavailable:torus×…` until G20.
    Torus(Torus3),
}

/// The plane `o + a x + b (n × x)` (the Interpreter convention), with `x ⟂ n`
/// exactly. Nothing is normalized. Its chart `(a, b)` is rational both ways,
/// and it is right-handed about `n`: counter-clockwise in the chart is
/// counter-clockwise about `n`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Plane3 {
    pub o: Point,
    pub x: Point,
    pub n: Point,
}

impl Plane3 {
    /// Second chart axis `n × x`.
    pub fn y(&self) -> Point {
        cross(&self.n, &self.x)
    }
    /// `n · (p - o)`: zero exactly on the plane.
    pub fn side(&self, p: &Point) -> Q {
        dot(&self.n, &sub(p, &self.o))
    }
    /// Chart coordinates of the projection of `p` onto the plane. Refuses a
    /// plane without two nonzero chart axes (not G1-admissible).
    pub fn chart(&self, p: &Point) -> Result<[Q; 2]> {
        let y = self.y();
        let (xx, yy) = (dot(&self.x, &self.x), dot(&y, &y));
        if xx.is_zero() || yy.is_zero() {
            return Err(Refused("model/g1-plane-degenerate"));
        }
        let d = sub(p, &self.o);
        Ok([dot(&d, &self.x) / xx, dot(&d, &y) / yy])
    }
    /// The point with chart coordinates `uv`.
    pub fn point(&self, uv: &[Q; 2]) -> Point {
        let y = self.y();
        std::array::from_fn(|k| &self.o[k] + &uv[0] * &self.x[k] + &uv[1] * &y[k])
    }
}

/// How an edge is bounded: two vertices, or none for a closed ring (G8's
/// circles; the CAD-Acid convention has no seam vertices).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Bounds {
    Segment([VertexId; 2]),
    Ring,
}

#[derive(Clone, Debug)]
pub struct Surface {
    pub carrier: Carrier3,
    pub provenance: Provenance,
}
#[derive(Clone, Debug)]
pub struct Curve {
    pub geometry: Curve3,
    pub provenance: Provenance,
}
#[derive(Clone, Debug)]
pub struct Vertex {
    pub def: VertexDef,
    pub provenance: Provenance,
}
/// A segment edge runs from `vertices[0]` to `vertices[1]` along its curve.
#[derive(Clone, Debug)]
pub struct Edge {
    pub curve: CurveId,
    pub bounds: Bounds,
    pub provenance: Provenance,
}
/// One use of an edge by a face loop. `pcurve` is the exact 2D piece in the
/// face carrier's chart, traversed in the coedge's direction (from the edge's
/// first vertex when `forward`).
#[derive(Clone, Debug)]
pub struct Coedge {
    pub edge: EdgeId,
    pub forward: bool,
    pub pcurve: Trimmed,
    /// The exact patch pieces of a periodic trim; seams own no topology.
    pub atlas: Option<AtlasTrim>,
    pub provenance: Provenance,
}
#[derive(Clone, Debug)]
pub struct Loop {
    pub coedges: Vec<CoedgeId>,
    pub provenance: Provenance,
}
/// `loops[0]` is the outer loop; it runs counter-clockwise about the outward
/// normal (`n` when `forward`, else `-n`), holes clockwise.
#[derive(Clone, Debug)]
pub struct Face {
    pub surface: SurfaceId,
    pub forward: bool,
    pub loops: Vec<LoopId>,
    pub provenance: Provenance,
}
#[derive(Clone, Debug)]
pub struct Shell {
    pub faces: Vec<FaceId>,
    pub provenance: Provenance,
}
#[derive(Clone, Debug)]
pub struct Solid {
    pub shells: Vec<ShellId>,
    pub provenance: Provenance,
}

/// Unchecked model data.
#[derive(Clone, Debug)]
pub struct Draft {
    pub placement: Frame,
    pub label: Label,
    pub surfaces: Vec<Surface>,
    pub curves: Vec<Curve>,
    pub vertices: Vec<Vertex>,
    pub edges: Vec<Edge>,
    pub coedges: Vec<Coedge>,
    pub loops: Vec<Loop>,
    pub faces: Vec<Face>,
    pub shells: Vec<Shell>,
    pub solids: Vec<Solid>,
}

/// A Draft that passed the structural checks and G1-G8, with its vertex keys.
#[derive(Clone, Debug)]
pub struct Model {
    draft: Draft,
    keys: Vec<VertexKey>,
}

impl Draft {
    /// Structural checks, then G1-G8 in order; the first failure is the
    /// named refusal (`model/structure-*`, `model/g<k>-*`).
    pub fn check(self) -> Result<Model> {
        let keys = wonky_curve::radical::guard(|| audit::check(&self))
            .map_err(|e|match e {
                wonky_curve::Refusal::RealFieldTower|wonky_curve::Refusal::RealBudget|wonky_curve::Refusal::RealUndecided=>Refused(e.name()),
                _=>Refused("boolean/budget-exceeded:vertex-identity"),
            })??;
        Ok(Model { draft: self, keys })
    }
}

impl Model {
    /// Audited latitude trim of a revolution face; a plane has no band.
    /// The tube band (torus or sphere) of a face, `None` for other carriers.
    pub fn tube_band(&self, face: FaceId) -> Result<Option<TubeBand>> {
        tube::band(&self.draft, face)
    }
    /// The tube band with a major and band ends in Q or one quadratic field.
    pub fn radical_tube_band(&self, face: FaceId) -> Result<Option<RadicalTubeBand>> {
        if face.index() >= self.draft.faces.len() { return Err(Refused("model/structure-face-index")); }
        tube::radical_band(&self.draft, face)
    }
    /// Whether a face is a strip: a cylinder face whose one loop is a polygon
    /// of latitude arcs and rulings in its half-angle chart.
    pub fn is_strip(&self, face: FaceId) -> bool {
        face.index() < self.draft.faces.len() && extrusion::strip(&self.draft, face)
    }
    /// Rational bounds on the area of one face, also for strips and planar
    /// faces whose sweeps leave the quarter grid (atan terms enclosed).
    pub fn face_area_enclosure(&self, face: FaceId, terms: usize) -> Result<(Q, Q)> {
        if face.index() >= self.draft.faces.len() { return Err(Refused("model/structure-face-index")); }
        wonky_curve::radical::guard(|| periodic::face_area_surd(&self.draft, face))
            .map_err(|_| Refused("boolean/budget-exceeded:area"))??
            .enclosure(terms)
    }
    /// The exact area of one face (a planar face signed by its sense).
    pub fn face_area_pi(&self, face: FaceId) -> Result<PiValue> {
        if face.index() >= self.draft.faces.len() { return Err(Refused("model/structure-face-index")); }
        periodic::face_area(&self.draft, face)
    }
    /// The audited partial revolution patch (cylinder or torus chart
    /// rectangle) of a face, `None` for every other face.
    pub fn rev_patch(&self, face: FaceId) -> Result<Option<RevPatch>> {
        if face.index() >= self.draft.faces.len() { return Err(Refused("model/structure-face-index")); }
        patch::patch(&self.draft, face)
    }
    pub fn revolution_band(&self, face: FaceId) -> Result<Option<RevolutionBand>> {
        if face.index() >= self.draft.faces.len() { return Err(Refused("model/structure-face-index")); }
        periodic::band(&self.draft, face)
    }
    /// Exact membership in this Model's construction frame. `reverse` changes
    /// the rational ray order for the classification cross-check.
    pub fn membership(&self, point: &Point, reverse: bool) -> Result<Membership> {
        wonky_curve::radical::guard(|| periodic::membership(&self.draft, point, reverse))
            .map_err(|_| Refused("boolean/budget-exceeded:classification-arithmetic"))?
    }
    pub fn draft(&self) -> &Draft {
        &self.draft
    }
    pub fn into_draft(self) -> Draft {
        self.draft
    }
    /// The exact identity of a vertex.
    pub fn key(&self, v: VertexId) -> &VertexKey {
        &self.keys[v.index()]
    }
    /// The canonical exact form (faces by carrier and orientation, loops as
    /// cyclic edge lists, edges by curve and exact endpoints).
    pub fn canonical(&self) -> Canonical {
        canonical::of(&self.draft, &self.keys)
    }
    /// Six times the exact signed volume of each solid (positive, by G8).
    pub fn volume6_pi(&self) -> Result<Vec<PiValue>> {
        wonky_curve::radical::guard(|| periodic::volumes6(&self.draft)).map_err(|_|Refused("boolean/budget-exceeded:volume"))?
    }
    /// Exact first moments (model frame) and six times the volume of each
    /// solid, cross-checked against `volume6_pi`.
    pub fn moments_pi(&self) -> Result<Vec<([MomentValue; 3], SurdPiValue)>> {
        wonky_curve::radical::guard(|| periodic::moments(&self.draft)).map_err(|_|Refused("boolean/budget-exceeded:moment"))?
    }
    /// Six times the exact signed volume of each solid in Q(√d)[π]: the
    /// form for Models with Q(√d) ring data (cone-rim chamfers), where
    /// `volume6_pi` refuses by name.
    /// G14: six times the volume and the area of each solid as certified
    /// enclosures, for Models with a stereographic sphere patch (whose arc
    /// sweeps and turning angles leave Q(√d)[π]); other Models refuse here
    /// and use the exact forms.
    pub fn patch_measures(&self) -> Result<Vec<(wonky_num::Iv, wonky_num::Iv)>> {
        if !self.sphere_measured() {
            return Err(Refused("model/patch-measures/no-patch"));
        }
        stereo::measures(&self.draft)
    }
    /// G14: first moments (model frame) and volume of each solid of a Model
    /// with a stereographic sphere patch, as certified enclosures.
    pub fn patch_moments(&self) -> Result<Vec<([wonky_num::Iv; 3], wonky_num::Iv)>> {
        if !self.sphere_measured() {
            return Err(Refused("model/patch-measures/no-patch"));
        }
        stereo::moments(&self.draft)
    }
    /// G14: area and flux enclosures of one face of a Model with a patch.
    pub fn patch_face_measure(&self, face: FaceId) -> Result<(wonky_num::Iv, wonky_num::Iv)> {
        if face.index() >= self.draft.faces.len() || !self.sphere_measured() {
            return Err(Refused("model/patch-measures/no-patch"));
        }
        stereo::face_measure(&self.draft, face)
    }
    /// G14: whether an exact point of a sphere face's carrier lies in the
    /// closed face: a stereographic patch by its chart cycles, a ring-bounded
    /// sphere band by its exact band location.
    pub fn sphere_face_contains(&self, face: FaceId, p: &RPoint) -> Result<bool> {
        if face.index() >= self.draft.faces.len() {
            return Err(Refused("model/structure-face-index"));
        }
        if self.is_sphere_patch(face) {
            return stereo::patch_contains(&self.draft, face, p);
        }
        if !matches!(self.draft.surfaces[self.draft.faces[face.index()].surface.index()].carrier, Carrier3::Sphere(_)) {
            return Err(Refused("model/sphere-face-expected"));
        }
        wonky_curve::radical::guard(|| periodic::closed_face_contains(&self.draft, face, p))
            .map_err(|_| Refused("boolean/budget-exceeded:classification-arithmetic"))?
    }
    /// G14: whether this Model's measures come from the certified enclosure
    /// route (a sphere face; otherwise only planar faces and full-turn
    /// cylinder or cone bands).
    pub fn sphere_measured(&self) -> bool {
        stereo::sphere_measured(&self.draft)
    }
    /// Whether a face is a stereographic sphere patch (G14).
    pub fn is_sphere_patch(&self, face: FaceId) -> bool {
        face.index() < self.draft.faces.len() && stereo::is_patch(&self.draft, face)
    }
    pub fn volume6_surd(&self) -> Result<Vec<SurdPiValue>> {
        wonky_curve::radical::guard(|| periodic::surd_volumes6(&self.draft)).map_err(|_|Refused("boolean/budget-exceeded:volume"))?
    }
    /// The audited full-turn band of a face, with ring data in Q or in one
    /// quadratic field; `None` for every other face.
    pub fn radical_band(&self, face: FaceId) -> Result<Option<RadicalBand>> {
        if face.index() >= self.draft.faces.len() { return Err(Refused("model/structure-face-index")); }
        periodic::radical_band(&self.draft, face)
    }
    /// Closed-form metric area of each solid. Analytic ring/cap values are
    /// rational plus rational multiples of pi; other metrics refuse by name.
    pub fn area_pi(&self) -> Result<Vec<PiValue>> {
        wonky_curve::radical::guard(|| periodic::areas(&self.draft)).map_err(|_|Refused("boolean/budget-exceeded:area"))?
    }
    /// Rational bounds on the metric area of each solid: `area_pi` with
    /// Machin pi bounds of `terms` terms, plus every face with an irrational
    /// metric factor (cone slant, oblique plane chart) enclosed by rational
    /// square-root bounds. Without such a face the bounds are exactly those
    /// of `area_pi()[k].enclosure(terms)`.
    pub fn area_enclosure(&self, terms: usize) -> Result<Vec<(Q, Q)>> {
        let solids = wonky_curve::radical::guard(|| periodic::area_terms(&self.draft))
            .map_err(|_| Refused("boolean/budget-exceeded:area"))??;
        solids.into_iter().map(|(area, roots, general)| {
            let (mut lo, mut hi) = area.enclosure(terms)?;
            if general != SurdPiValue::default() {
                let (g0, g1) = general.enclosure(terms)?;
                lo += g0;
                hi += g1;
            }
            for t in roots {
                let (s0, s1) = periodic::sqrt_bounds(&t.radicand, 4 * terms)?;
                let (v0, v1) = t.value.enclosure(terms)?;
                lo += if v0.is_negative() { &v0 * &s1 } else { &v0 * &s0 };
                hi += if v1.is_negative() { v1 * s0 } else { v1 * s1 };
            }
            Ok((lo, hi))
        }).collect()
    }
    /// Exact Green area of one planar face, including its holes.
    pub fn planar_area_pi(&self, face: FaceId) -> Result<PiValue> {
        wonky_curve::radical::guard(|| periodic::planar_area(&self.draft,face)).map_err(|_|Refused("boolean/budget-exceeded:area"))?
    }
    pub fn volume6_radical(&self) -> Result<Vec<wonky_curve::radical::Radical>> {
        wonky_curve::radical::guard(|| algebraic::volumes6(&self.draft)).map_err(|_| Refused("model/radical-budget:volume"))?
    }
    pub fn volume6(&self) -> Result<Vec<Q>> {
        audit::volumes6(&self.draft)
    }
    /// Exact L1 bound on rounding this construction-frame vertex to
    /// binary64. Admission may compare clearances against this declared
    /// export measure; it never reads the world observation cache. Reuses
    /// the same nearest-even rounding as export, including subnormals.
    pub fn source_rounding_error(&self, v: VertexId) -> Result<Q> {
        let p = match self.key(v) {
            VertexKey::Rational(p) => p,
            VertexKey::Quadratic(_) | VertexKey::Real(_) => {
                return Err(Refused(
                    "boolean/ssi-row-unavailable:quadratic/rounding-measure",
                ))
            }
        };
        p.iter()
            .map(|x| {
                let rounded =
                    Q::from_float(nearest(x)?).ok_or(Refused("model/observation-range"))?;
                Ok((rounded - x).abs())
            })
            .sum()
    }
    /// Observation cache of a vertex: its world (Source frame) image, each
    /// coordinate rounded to the nearest binary64. For export and WC0 emit
    /// only; no decision reads it (X1).
    pub fn world_cache(&self, v: VertexId) -> Result<[f64; 3]> {
        let world = match self.key(v) {
            VertexKey::Rational(p) => self.draft.placement.point(p),
            VertexKey::Real(p) => return algebraic::observe(&algebraic::mapped(p,&self.draft.placement)),
            VertexKey::Quadratic(p) => {
                let p = p.mapped(&self.draft.placement)?;
                return algebraic::observe(p.coordinates());
            }
        };
        Ok([
            nearest(&world[0])?,
            nearest(&world[1])?,
            nearest(&world[2])?,
        ])
    }
}

/// The binary64 nearest to `x` (ties to even). `to_f64` is within one ulp;
/// the exact comparison against both neighbours makes the rounding correct.
pub(crate) fn nearest(x: &Q) -> Result<f64> {
    let m = x
        .to_f64()
        .filter(|m| m.is_finite())
        .ok_or(Refused("model/observation-range"))?;
    let error = |c: f64| Q::from_float(c).map(|c| (c - x).abs());
    let mut best = (m, error(m).ok_or(Refused("model/observation-range"))?);
    for c in [m.next_down(), m.next_up()] {
        let Some(e) = error(c) else { continue };
        if e < best.1 || (e == best.1 && c.to_bits() & 1 == 0) {
            best = (c, e);
        }
    }
    Ok(if best.0 == 0. { 0. } else { best.0 })
}

pub(crate) fn is_zero(p: &Point) -> bool {
    p.iter().all(Q::is_zero)
}
