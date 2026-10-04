//! Exact blend admission (F0) and planar chamfer boundary surgery.
//! Rational output enters Model through its full audit; radical planar Model
//! carriers remain an explicit capability gap.
//! Propagation expands the selection to its exact tangent-chain closure.
//! The graph records added edges; all Model predicates use Q.
pub mod chain;
pub mod chamfer;
pub mod fillet;
pub mod profile;
pub mod profile_model;
pub mod rim;
use num_traits::{Signed, Zero};
use std::collections::{BTreeMap, BTreeSet};
use wonky_geom::model::{Bounds, Carrier3, EdgeId, FaceId, Model, VertexId};
use wonky_geom::{cross, dot, sub, Q};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Refusal(pub String);
impl std::fmt::Display for Refusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for Refusal {}
impl From<wonky_geom::Refused> for Refusal {
    fn from(e: wonky_geom::Refused) -> Self {
        Self(e.0.into())
    }
}
impl From<wonky_curve::Refusal> for Refusal {
    fn from(e: wonky_curve::Refusal) -> Self { Self(e.name().into()) }
}
type Result<T> = std::result::Result<T, Refusal>;
fn refuse<T>(code: &str) -> Result<T> {
    Err(Refusal(code.into()))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Convexity {
    Convex,
    Concave,
}
/// Interior angle of the material, not the angle between outward normals.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Dihedral {
    Acute,
    Right,
    Obtuse,
    Reflex,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Section {
    Fillet {
        radius: Q,
    },
    EqualOffsets {
        width: Q,
    },
    TwoOffsets {
        first: Q,
        second: Q,
        opposite_direction: bool,
    },
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Request {
    pub section: Section,
    pub tangent_propagation: bool,
}
impl Section {
    /// Fillets offset supports by r. Chamfer distances are setbacks along
    /// the supports in the normal section, not face-normal offsets.
    pub fn support_distances(&self) -> [Q; 2] {
        match self {
            Self::Fillet { radius } => [radius.clone(), radius.clone()],
            Self::EqualOffsets { width } => [width.clone(), width.clone()],
            Self::TwoOffsets {
                first,
                second,
                opposite_direction,
            } => {
                if *opposite_direction {
                    [second.clone(), first.clone()]
                } else {
                    [first.clone(), second.clone()]
                }
            }
        }
    }
    fn validate(&self) -> Result<()> {
        if self.support_distances().iter().any(|q| !q.is_positive()) {
            refuse("blend/invalid-size")
        } else {
            Ok(())
        }
    }
}
/// Named admission refusals for feature modes, before any geometry work.
#[derive(Clone, Copy, Debug)]
pub enum Unsupported {
    VariableRadius,
    Conic,
    Curvature,
    Partial,
    FullRound,
    ApexRange,
    OffsetAngle,
    VaryingDihedralChamfer,
}
impl Unsupported {
    pub fn refusal(self) -> Refusal {
        Refusal(
            match self {
                Self::VariableRadius => "blend/variable-radius-unsupported",
                Self::Conic => "blend/cross-section-unsupported:CONIC",
                Self::Curvature => "blend/cross-section-unsupported:CURVATURE",
                Self::Partial => "blend/partial-fillet-unsupported",
                Self::FullRound => "blend/full-round-unsupported",
                Self::ApexRange => "chamfer/apex-range-unsupported",
                Self::OffsetAngle => "chamfer/offset-angle-transcendental",
                Self::VaryingDihedralChamfer => "chamfer/varying-dihedral-semantics-unprobed",
            }
            .into(),
        )
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EdgeClass {
    pub edge: EdgeId,
    pub supports: [FaceId; 2],
    pub convexity: Convexity,
    pub dihedral: Dihedral,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EndCondition {
    PerpendicularCap,
    ObliqueCap,
    CurvedCap,
    ChamferMitre,
    EqualFilletMitre,
    ChamferConeMitre,
    SphereCorner,
    ChamferTriangle,
    MixedConvexityCorner,
    TangentJunction,
    ConsumedEdge,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Setback {
    Zero,
    Radius(Q),
    ChamferPoints(Vec<[Q; 2]>),
    Deferred,
}
/// Table inputs are construction facts. Curved rows are recorded here for
/// future Model carriers; F0's planar extractor never invents these facts.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Cap {
    Perpendicular,
    Oblique,
    Curved,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Junction {
    Ordinary,
    Tangent,
    Consumed,
    ChamferCone,
    Extended,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct End {
    pub condition: EndCondition,
    pub setback: Setback,
}
pub fn end_condition(
    s: usize,
    b: usize,
    cap: Cap,
    junction: Junction,
    convexities: &[Convexity],
    sections: &[Section],
) -> Result<End> {
    if s == 0 || s > b || convexities.len() != s || sections.len() != s {
        return refuse("blend/contract-violation:ends/incidence");
    }
    for section in sections {
        section.validate()?;
    }
    let chamfers = sections
        .iter()
        .all(|x| !matches!(x, Section::Fillet { .. }));
    let radii: Vec<_> = sections
        .iter()
        .filter_map(|x| match x {
            Section::Fillet { radius } => Some(radius),
            _ => None,
        })
        .collect();
    let equal_fillets = radii.len() == s && radii.iter().all(|r| *r == radii[0]);
    let same_convexity = convexities.iter().all(|c| *c == convexities[0]);
    let (condition, setback) = match (s, b, junction) {
        (_, _, _) if s >= 4 => return refuse("blend/vertex-network-unsupported:degree"),
        // FP08 is a probed planar extended mitre (15 faces), not an unprobed quartic.
        (_, _, Junction::Extended) => return refuse("blend/extended-mitre-not-implemented"),
        (2, _, Junction::Tangent) => (EndCondition::TangentJunction, Setback::Zero),
        (_, _, Junction::Consumed) => (EndCondition::ConsumedEdge, Setback::Deferred),
        (1, 3, Junction::Ordinary) => (
            match cap {
                Cap::Perpendicular => EndCondition::PerpendicularCap,
                Cap::Oblique => EndCondition::ObliqueCap,
                Cap::Curved => EndCondition::CurvedCap,
            },
            Setback::Zero,
        ),
        (2, 3, Junction::ChamferCone) if chamfers => {
            (EndCondition::ChamferConeMitre, Setback::Zero)
        }
        (2, 3, Junction::Ordinary) if chamfers => (EndCondition::ChamferMitre, Setback::Zero),
        (2, 3, Junction::Ordinary) if equal_fillets && same_convexity => {
            (EndCondition::EqualFilletMitre, Setback::Zero)
        }
        (2, 3, Junction::Ordinary) if radii.len() == s && !equal_fillets => {
            return refuse("blend/setback-mitre-unprobed")
        }
        (3, 3, Junction::Ordinary) if chamfers => (
            EndCondition::ChamferTriangle,
            Setback::ChamferPoints(sections.iter().map(Section::support_distances).collect()),
        ),
        (3, 3, Junction::Ordinary) if equal_fillets && same_convexity => (
            EndCondition::SphereCorner,
            Setback::Radius(radii[0].clone()),
        ),
        (3, 3, Junction::Ordinary) if radii.len() == s && !same_convexity => {
            (EndCondition::MixedConvexityCorner, Setback::Deferred)
        }
        _ => return refuse("blend/vertex-network-unsupported:configuration"),
    };
    Ok(End { condition, setback })
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Stripe {
    pub edges: Vec<EdgeId>,
    pub closed: bool,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Vertex {
    pub vertex: VertexId,
    pub selected_degree: usize,
    pub body_degree: usize,
    pub selected_edges: Vec<EdgeId>,
    pub body_edges: Vec<EdgeId>,
    pub end: End,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Graph {
    pub edges: Vec<EdgeClass>,
    /// Edges added by propagation, in stable EdgeId order.
    pub added_edges: Vec<EdgeId>,
    pub stripes: Vec<Stripe>,
    pub vertices: Vec<Vertex>,
    pub request: Request,
}
fn direction(m: &Model, e: EdgeId) -> Result<wonky_geom::Point> {
    match m.draft().edges[e.index()].bounds {
        Bounds::Segment([a, b]) => {
            let a = m.key(a).rational()?;
            let b = m.key(b).rational()?;
            Ok(sub(b, a))
        }
        Bounds::Ring => refuse("blend/contract-violation:stripe/ring-on-open-carrier"),
    }
}
fn classify(m: &Model, edge: EdgeId) -> Result<EdgeClass> {
    let uses = m.edge_uses(edge)?;
    if m.face_tangency(edge)?.is_some() {
        return refuse("blend/tangent-edge");
    }
    let supports = uses.map(|u| u.0);
    let a = m.outward_normal(supports[0])?;
    let b = m.outward_normal(supports[1])?;
    let mut t = direction(m, edge)?;
    if !m.draft().coedges[uses[0].1.index()].forward {
        t = t.map(|x| -x);
    }
    let turn = dot(&cross(&a, &b), &t);
    if turn.is_zero() {
        return refuse("blend/contract-violation:stripe/flat-fold");
    }
    let convexity = if turn.is_positive() {
        Convexity::Convex
    } else {
        Convexity::Concave
    };
    let cosine = dot(
        &m.source_normal(supports[0])?,
        &m.source_normal(supports[1])?,
    );
    let dihedral = if convexity == Convexity::Concave {
        Dihedral::Reflex
    } else if cosine.is_zero() {
        Dihedral::Right
    } else if cosine.is_negative() {
        Dihedral::Acute
    } else {
        Dihedral::Obtuse
    };
    Ok(EdgeClass {
        edge,
        supports,
        convexity,
        dihedral,
    })
}

/// Traverse only proved tangent continuations. The callback must decide exactly
/// or return a named refusal; it must never substitute a tolerance comparison.
fn tangent_selection(
    initial: &BTreeSet<EdgeId>,
    incident: &BTreeMap<VertexId, Vec<EdgeId>>,
    propagate: bool,
    mut tangent: impl FnMut(VertexId, [EdgeId; 2]) -> Result<bool>,
) -> Result<(BTreeSet<EdgeId>, BTreeMap<EdgeId, BTreeSet<EdgeId>>)> {
    let mut endpoints: BTreeMap<EdgeId, Vec<VertexId>> = BTreeMap::new();
    for (&v, es) in incident {
        for &e in es {
            endpoints.entry(e).or_default().push(v);
        }
    }
    let mut selected = initial.clone();
    let mut pending = initial.clone();
    let mut adjacency: BTreeMap<EdgeId, BTreeSet<EdgeId>> = BTreeMap::new();
    while let Some(e) = pending.pop_first() {
        adjacency.entry(e).or_default();
        for &v in endpoints.get(&e).into_iter().flatten() {
            for &other in &incident[&v] {
                if e == other || (!propagate && !selected.contains(&other)) {
                    continue;
                }
                if tangent(v, [e, other])? {
                    if selected.insert(other) {
                        pending.insert(other);
                    }
                    adjacency.entry(e).or_default().insert(other);
                    adjacency.entry(other).or_default().insert(e);
                }
            }
        }
    }
    Ok((selected, adjacency))
}

pub fn stripes(m: &Model, selection: &[EdgeId], request: Request) -> Result<Graph> {
    request.section.validate()?;
    let selected: BTreeSet<_> = selection.iter().copied().collect();
    if selected.is_empty() {
        return refuse("blend/empty-selection");
    }
    let mut edges = Vec::new();
    for &e in &selected {
        edges.push(classify(m, e)?);
    }
    let mut incident: BTreeMap<VertexId, Vec<EdgeId>> = BTreeMap::new();
    for (i, e) in m.draft().edges.iter().enumerate() {
        match e.bounds {
            Bounds::Segment(vs) => {
                for v in vs {
                    incident.entry(v).or_default().push(EdgeId(i as u32));
                }
            }
            Bounds::Ring => {}
        }
    }
    let (expanded, adjacency) = tangent_selection(
        &selected,
        &incident,
        request.tangent_propagation,
        |v, es| Ok(m.edge_tangency(v, es)?.is_some()),
    )?;
    let added_edges: Vec<_> = expanded.difference(&selected).copied().collect();
    for &e in &added_edges {
        edges.push(classify(m, e)?);
    }
    edges.sort_by_key(|e| e.edge);
    let selected = expanded;
    let mut vertices = Vec::new();
    for (v, body_edges) in incident {
        let local: Vec<_> = body_edges
            .iter()
            .copied()
            .filter(|e| selected.contains(e))
            .collect();
        if local.is_empty() {
            continue;
        }
        let tangent = local
            .iter()
            .any(|e| local.iter().any(|other| adjacency[e].contains(other)));
        let cap = if local.len() == 1 && body_edges.len() == 3 {
            let class = edges.iter().find(|e| e.edge == local[0]).unwrap();
            let faces: BTreeSet<_> = body_edges
                .iter()
                .flat_map(|&e| m.edge_uses(e).unwrap().map(|u| u.0))
                .collect();
            let third: Vec<_> = faces
                .into_iter()
                .filter(|f| !class.supports.contains(f))
                .collect();
            if third.len() != 1 {
                return refuse("blend/vertex-network-unsupported:cap-faces");
            }
            match &m.draft().surfaces[m.draft().faces[third[0].index()].surface.index()].carrier {
                Carrier3::Rotated(_) => return refuse("blend/rotated-source-normal-unavailable"),
                Carrier3::RadicalPlane(_) => return refuse("blend/radical-source-normal-unavailable"),
                Carrier3::Plane(_) => {
                    let t = m.draft().placement.vector(&direction(m, local[0])?);
                    let n = m.source_normal(third[0])?;
                    if cross(&t, &n).iter().all(Q::is_zero) {
                        Cap::Perpendicular
                    } else {
                        Cap::Oblique
                    }
                }
                Carrier3::TranslatedCylinder(_) | Carrier3::Cylinder(_) | Carrier3::Cone(_) | Carrier3::Sphere(_) | Carrier3::Torus(_) => {
                    return refuse("blend/vertex-network-unsupported:curved-cap");
                }
            }
        } else {
            Cap::Perpendicular
        };
        let convexities: Vec<_> = local
            .iter()
            .map(|e| edges.iter().find(|c| c.edge == *e).unwrap().convexity)
            .collect();
        let sections = vec![request.section.clone(); local.len()];
        let end = end_condition(
            local.len(),
            body_edges.len(),
            cap,
            if tangent {
                Junction::Tangent
            } else {
                Junction::Ordinary
            },
            &convexities,
            &sections,
        )?;
        vertices.push(Vertex {
            vertex: v,
            selected_degree: local.len(),
            body_degree: body_edges.len(),
            selected_edges: local,
            body_edges,
            end,
        });
    }
    let stripes = stripe_components(selected, &adjacency);
    Ok(Graph {
        edges,
        added_edges,
        stripes,
        vertices,
        request,
    })
}

fn stripe_components(
    selected: BTreeSet<EdgeId>,
    adjacency: &BTreeMap<EdgeId, BTreeSet<EdgeId>>,
) -> Vec<Stripe> {
    let mut remaining = selected;
    let mut stripes = Vec::new();
    while let Some(&first) = remaining.iter().next() {
        let mut stack = vec![first];
        let mut component = BTreeSet::new();
        while let Some(e) = stack.pop() {
            if !remaining.remove(&e) {
                continue;
            }
            component.insert(e);
            stack.extend(adjacency[&e].iter().copied());
        }
        let closed = component.iter().all(|e| adjacency[e].len() == 2);
        stripes.push(Stripe {
            edges: component.into_iter().collect(),
            closed,
        });
    }
    stripes
}

#[cfg(test)]
mod tangent_tests;
