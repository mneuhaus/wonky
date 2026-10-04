//! STEP / captured-B-rep decoders share one identity-preserving exact admission.
//! No healing, tolerance signs, polygon substitution or external kernel. Replay
//! re-decodes immutable bytes and re-runs the unchanged Model audit.
mod capture;
mod digest;
pub mod part21;
pub mod reference;
mod step;
use crate::frame::Frame;
use crate::model::*;
use crate::{binary64, cross, dot, sub, Point, Q};
use num_traits::Zero;
use std::collections::BTreeMap;
use wonky_curve::{Carrier, ExactPoint, Trimmed};
pub type Result<T> = std::result::Result<T, Error>;
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Error {
    pub name: String,
}
impl Error {
    pub fn new(name: &str) -> Self {
        Self { name: name.into() }
    }
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.name.fmt(f)
    }
}
impl std::error::Error for Error {}
impl From<crate::Refused> for Error {
    fn from(e: crate::Refused) -> Self {
        Self::new(e.0)
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Limits {
    pub bytes: usize,
    pub entities: usize,
    pub values: usize,
    pub depth: usize,
}
impl Default for Limits {
    fn default() -> Self {
        Self {
            bytes: 16 * 1024 * 1024,
            entities: 100_000,
            values: 1_000_000,
            depth: 64,
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Decoder {
    Part21,
    OnshapeCapture,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Uncertainty {
    Unknown,
    Declared { mm: Q },
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Validation {
    Decoded,
    Reference,
    Exact,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ImportState {
    pub origin: &'static str,
    pub source_digest: [u8; 32],
    pub source_revision: Option<String>,
    pub decoder: Decoder,
    pub decoder_version: &'static str,
    pub unit_to_mm: Q,
    pub instance_path: Vec<String>,
    pub uncertainty: Uncertainty,
    pub validation: Validation,
    /// Original numeric lexemes plus correctly rounded binary64 words. This
    /// records decimal rounding separately from producer uncertainty.
    pub numeric_observations: Vec<(String, u64)>,
    pub source_entity_ids: Vec<String>,
}
#[derive(Clone, Debug)]
pub struct Source {
    pub digest: [u8; 32],
    pub revision: Option<String>,
    pub instance_path: Vec<String>,
}
pub fn source_digest(bytes: &[u8]) -> [u8; 32] {
    digest::sha256(bytes)
}
#[derive(Clone, Debug)]
struct InputVertex {
    id: String,
    point: Point,
}
#[derive(Clone, Debug)]
struct InputEdge {
    id: String,
    vertices: [String; 2],
    p: Point,
    d: Point,
    same_sense: bool,
}
#[derive(Clone, Debug)]
struct InputLoop {
    id: String,
    outer: bool,
    uses: Vec<(String, bool)>,
}
#[derive(Clone, Debug)]
struct InputFace {
    id: String,
    plane: Plane3,
    forward: bool,
    loops: Vec<InputLoop>,
}
#[derive(Clone, Debug)]
pub struct ImportDraft {
    state: ImportState,
    limits: Limits,
    vertices: Vec<InputVertex>,
    edges: Vec<InputEdge>,
    faces: Vec<InputFace>,
}
#[derive(Clone, Debug)]
pub struct ImportedModel {
    model: Model,
    state: ImportState,
    limits: Limits,
}
impl ImportedModel {
    pub fn model(&self) -> &Model {
        &self.model
    }
    pub fn state(&self) -> &ImportState {
        &self.state
    }
    /// Source substitution, altered instance/revision and decoder/unit drift
    /// cannot be replayed as this construction. Geometry is never deserialized.
    pub fn replay(&self, bytes: &[u8]) -> Result<Self> {
        let source = Source {
            digest: self.state.source_digest,
            revision: self.state.source_revision.clone(),
            instance_path: self.state.instance_path.clone(),
        };
        let draft = match self.state.decoder {
            Decoder::Part21 => ImportDraft::step(bytes, source, self.limits)?,
            Decoder::OnshapeCapture => ImportDraft::capture(bytes, source, self.limits)?,
        };
        let result = draft.check()?;
        if result.state != self.state || result.model.canonical() != self.model.canonical() {
            return Err(Error::new("import/replay-mismatch"));
        }
        Ok(result)
    }
}
impl ImportDraft {
    fn new(bytes: &[u8], source: Source, limits: Limits, decoder: Decoder) -> Result<Self> {
        let max = Limits::default();
        if limits.depth > max.depth
            || limits.bytes > max.bytes
            || limits.entities > max.entities
            || limits.values > max.values
        {
            return Err(Error::new("import/limits-invalid"));
        }
        if bytes.len() > limits.bytes {
            return Err(Error::new("import/size-limit"));
        }
        if source_digest(bytes) != source.digest {
            return Err(Error::new("import/source-digest-mismatch"));
        }
        Ok(Self {
            state: ImportState {
                origin: "imported",
                source_digest: source.digest,
                source_revision: source.revision,
                decoder,
                decoder_version: "wonky-import/1",
                unit_to_mm: Q::zero(),
                instance_path: source.instance_path,
                uncertainty: Uncertainty::Unknown,
                validation: Validation::Decoded,
                numeric_observations: vec![],
                source_entity_ids: vec![],
            },
            limits,
            vertices: vec![],
            edges: vec![],
            faces: vec![],
        })
    }
    pub fn state(&self) -> &ImportState {
        &self.state
    }
    pub fn step(bytes: &[u8], source: Source, limits: Limits) -> Result<Self> {
        step::decode(bytes, source, limits)
    }
    pub fn capture(bytes: &[u8], source: Source, limits: Limits) -> Result<Self> {
        capture::decode(bytes, source, limits)
    }
    fn numeric(&mut self, s: &str) -> Result<Q> {
        let f = number(s)?;
        self.state
            .numeric_observations
            .push((s.into(), f.to_bits()));
        Ok(binary64(f)?)
    }
    /// Preserve topology by source IDs, never deduplicate coincident vertices or
    /// edges. Derived pcurves are exact pullbacks of the supplied straight edges.
    pub fn check(mut self) -> Result<ImportedModel> {
        let prov = |slot: usize| Provenance {
            node: 0,
            slot: slot as u32,
        };
        let mut d = Draft {
            placement: Frame::identity(),
            label: Label::Exact,
            surfaces: vec![],
            curves: vec![],
            vertices: vec![],
            edges: vec![],
            coedges: vec![],
            loops: vec![],
            faces: vec![],
            shells: vec![],
            solids: vec![],
        };
        let mut vertices = BTreeMap::new();
        let mut edges = BTreeMap::new();
        let mut all_ids = std::collections::BTreeSet::new();
        let mut loop_ids = std::collections::BTreeSet::new();
        let mut register = |id: &str| -> Result<()> {
            if !all_ids.insert(id.to_string()) {
                return Err(Error::new("import/duplicate-id"));
            }
            Ok(())
        };
        for v in &self.vertices {
            register(&v.id)?;
            vertices.insert(v.id.clone(), VertexId(d.vertices.len() as u32));
            d.vertices.push(Vertex {
                def: VertexDef::Rational(v.point.clone()),
                provenance: prov(d.vertices.len()),
            });
        }
        for e in &self.edges {
            register(&e.id)?;
            let ends = e
                .vertices
                .iter()
                .map(|id| {
                    vertices
                        .get(id)
                        .copied()
                        .ok_or_else(|| Error::new("import/missing-id"))
                })
                .collect::<Result<Vec<_>>>()?;
            let curve = CurveId(d.curves.len() as u32);
            // Validate both source endpoints and the declared curve sense exactly.
            let points = [
                &self.vertices[ends[0].index()].point,
                &self.vertices[ends[1].index()].point,
            ];
            if e.d.iter().all(Q::is_zero)
                || points
                    .iter()
                    .any(|p| cross(&sub(p, &e.p), &e.d).iter().any(|x| !x.is_zero()))
            {
                return Err(Error::new("import/line-incidence"));
            }
            let sense = dot(&sub(points[1], points[0]), &e.d);
            if sense.is_zero() || (sense > Q::zero()) != e.same_sense {
                return Err(Error::new("import/edge-sense"));
            }
            d.curves.push(Curve {
                geometry: Curve3::Line {
                    p: e.p.clone(),
                    d: e.d.clone(),
                },
                provenance: prov(curve.index()),
            });
            edges.insert(e.id.clone(), EdgeId(d.edges.len() as u32));
            d.edges.push(Edge {
                curve,
                bounds: Bounds::Segment([ends[0], ends[1]]),
                provenance: prov(d.edges.len()),
            });
        }
        for f in &self.faces {
            register(&f.id)?;
            let surface = SurfaceId(d.surfaces.len() as u32);
            d.surfaces.push(Surface {
                carrier: Carrier3::Plane(f.plane.clone()),
                provenance: prov(surface.index()),
            });
            if f.loops.iter().filter(|l| l.outer).count() != 1 {
                return Err(Error::new("import/outer-bound"));
            }
            let mut loops = vec![];
            for l in f
                .loops
                .iter()
                .filter(|l| l.outer)
                .chain(f.loops.iter().filter(|l| !l.outer))
            {
                if !loop_ids.insert(&l.id) {
                    return Err(Error::new("import/topology-duplicate-use"));
                }
                let mut coedges = vec![];
                for (id, forward) in &l.uses {
                    let edge = *edges
                        .get(id)
                        .ok_or_else(|| Error::new("import/missing-id"))?;
                    let Bounds::Segment([a, b]) = d.edges[edge.index()].bounds else {
                        unreachable!()
                    };
                    let (a, b) = if *forward { (a, b) } else { (b, a) };
                    let chart = |id: VertexId| -> Result<ExactPoint> {
                        Ok(ExactPoint::from_rational(
                            f.plane.chart(&self.vertices[id.index()].point)?,
                        ))
                    };
                    let pcurve = Trimmed::new([chart(a)?, chart(b)?], Carrier::Line)
                        .map_err(|e| Error::new(e.name()))?;
                    let co = CoedgeId(d.coedges.len() as u32);
                    d.coedges.push(Coedge {
                        edge,
                        forward: *forward,
                        pcurve,
                        atlas: None,
                        provenance: prov(co.index()),
                    });
                    coedges.push(co);
                }
                let id = LoopId(d.loops.len() as u32);
                d.loops.push(Loop {
                    coedges,
                    provenance: prov(id.index()),
                });
                loops.push(id);
            }
            let id = FaceId(d.faces.len() as u32);
            d.faces.push(Face {
                surface,
                forward: f.forward,
                loops,
                provenance: prov(id.index()),
            });
        }
        d.shells.push(Shell {
            faces: (0..d.faces.len()).map(|i| FaceId(i as u32)).collect(),
            provenance: prov(0),
        });
        d.solids.push(Solid {
            shells: vec![ShellId(0)],
            provenance: prov(0),
        });
        let model = d.check()?;
        self.state.validation = Validation::Exact;
        Ok(ImportedModel {
            model,
            state: self.state,
            limits: self.limits,
        })
    }
}
/// Decimal syntax is checked before binary64 parsing (finite/range checks).
/// The exact construction uses the binary64 word, followed by exact unit ratios.
fn number(s: &str) -> Result<f64> {
    if s.len() > 4096 {
        return Err(Error::new("import/number-limit"));
    }
    let b = s.as_bytes();
    let mut i = usize::from(matches!(b.first(), Some(b'+') | Some(b'-')));
    let mut digits = 0;
    while b.get(i).is_some_and(u8::is_ascii_digit) {
        i += 1;
        digits += 1;
    }
    if b.get(i) == Some(&b'.') {
        i += 1;
        while b.get(i).is_some_and(u8::is_ascii_digit) {
            i += 1;
            digits += 1;
        }
    }
    if digits == 0 {
        return Err(Error::new("import/number-invalid"));
    }
    if matches!(b.get(i), Some(b'E') | Some(b'e')) {
        i += 1;
        if matches!(b.get(i), Some(b'+') | Some(b'-')) {
            i += 1
        }
        let start = i;
        while b.get(i).is_some_and(u8::is_ascii_digit) {
            i += 1
        }
        if start == i {
            return Err(Error::new("import/number-invalid"));
        }
    }
    if i != b.len() {
        return Err(Error::new("import/number-invalid"));
    }
    let f = s
        .parse::<f64>()
        .map_err(|_| Error::new("import/number-invalid"))?;
    if !f.is_finite()
        || (f == 0.
            && b.iter()
                .take_while(|c| !matches!(c, b'e' | b'E'))
                .any(|c| matches!(c, b'1'..=b'9')))
    {
        return Err(Error::new("import/number-range"));
    }
    Ok(f)
}
fn q(n: i64) -> Q {
    Q::from_integer(n.into())
}
/// Normalization-invariant rational plane frame: project the supplied reference
/// direction onto the normal complement. No rounded orthonormal matrix.
fn plane(o: Point, n: Point, reference: Option<Point>) -> Result<Plane3> {
    let nn = dot(&n, &n);
    if nn.is_zero() {
        return Err(Error::new("import/direction-zero"));
    }
    let r = reference.unwrap_or_else(|| {
        let k = n.iter().position(Q::is_zero).unwrap_or_else(|| {
            if n[0].clone().abs() <= n[1].clone().abs() {
                0
            } else {
                1
            }
        });
        std::array::from_fn(|i| q(i64::from(i == k)))
    });
    let rn = dot(&r, &n);
    let x = std::array::from_fn(|i| &r[i] - &n[i] * &rn / &nn);
    if dot(&x, &x).is_zero() {
        return Err(Error::new("import/placement-degenerate"));
    }
    Ok(Plane3 { o, n, x })
}
use num_traits::Signed;
