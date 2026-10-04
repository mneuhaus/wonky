//! Spline prism of the arc-profile path (gear plan strand S9): one closed chain
//! of sketch rule 3 entities (lines, three-point arcs, Bezier curves and
//! non-rational clamped B-splines), extruded along the sketch normal.
//!
//! The source is the rule 3 sketch node itself (`wonky_contract::sketch3`); its
//! binary64 entity data are the exact inputs (E9). Every piece becomes a
//! `wonky_curve::Trimmed` over that data, and every geometric decision goes
//! through the curve crate's operation table:
//!
//! - chaining on exact ends (`arc_profile::chained`);
//! - simplicity: the arrangement of the chain alone (`wonky_curve::arrange`)
//!   must keep every piece whole and bound exactly one cell. A contact away from
//!   the chain's shared ends splits a piece and refuses
//!   `curve-profile/non-simple-chain`; a crossing at an irrational parameter
//!   refuses with the crate's own name (`curve2/crossing-needs-algebraic-vertex`);
//! - orientation: the sign of the certified area.
//!
//! The B-rep (`arc_profile_brep`) writes a spline piece as a
//! `CurveGeometry::BSpline` edge at each level with binary64 observation caches
//! of exact poles, a `SurfaceGeometry::LinearExtrusion` side over the lower
//! edge and `PcurveGeometry::BSpline` cap pcurves; `curve_source::audit` (S7)
//! replays exactly that. The measures are the `ArcPrism` ones: exact volume when
//! every piece has a rational Green term (lines and polynomial splines),
//! certified enclosures for areas, bounding boxes and probe distances. The
//! mesh is `curve_profile_mesh`, the STEP writer `step_carrier` (S7).
//!
//! Construction (frames `[Source, Interpreter]`, frame 1 is the sketch frame):
//!
//! | node | operation | rule | parents | parameters |
//! |------|-----------|------|---------|------------|
//! | 0 | Interpreter | 1 | - | `[depth, reverse]` |
//! | 1 | Sketch | 3 | `[0]` | `sketch3::encode(0, entities)` |
//! | 2 | Extrude | 1 | `[1]` | `[lo, hi]` (the two cap levels) |
//!
//! The audit rebuilds the body from that source and compares it bit for bit.
//!
//! Admission: the builder takes one closed chain with at least one spline
//! (a sketch of lines and arcs alone keeps the rule 1 arc-profile path). A
//! `Circle` entity, a closed fit, a rational B-spline (no STEP
//! writer bound for weights yet) and a region index other than 0 are refused by
//! name. FeatureScript reaches this path through `skBezier` (strand S10): the
//! host's `OP_CURVE_REGION` runs [`profile`] at `skSolve`, `OP_CURVE_EXTRUDE`
//! runs [`build`] at `opExtrude`. Common-axis Booleans use `prism_stack`, whose
//! source replay owns their mixed boundary. No-Claim: patterns and fillets
//! of spline prisms remain outside this path. Open fits use the OM1/D1 exact solve.
use crate::{
    affine::Affine,
    arc_profile::{b, ArcPrism, Profile},
    placement::Placement,
    polyhedron::{Audited, Refused},
};
use std::sync::Arc;
use wonky_contract::sketch3::{self, Entity};
use wonky_contract::*;
use wonky_curve as wc;

type R<T> = std::result::Result<T, Refused>;
pub(crate) fn no(s: &str) -> Refused {
    Refused(format!("curve-profile/{s}"))
}

/// Work budget of the simplicity arrangement: a simple chain keeps its pieces,
/// so twice the source limit is enough to see a split.
const BUDGET: wc::Budget = wc::Budget { segments: 512, pieces: 1024 };

/// A body built by [`build`]: a rule 3 sketch extruded (see the module table).
pub(crate) fn candidate(body: &Body) -> bool {
    body.constructions.len() == 3
        && body.constructions[1].operation == (Operation::Sketch {})
        && body.constructions[1].rule_version == SKETCH_RULE
        && body.constructions[2].operation == (Operation::Extrude {})
}
/// The rule version of a sketch node that carries a `sketch3` entity list.
const SKETCH_RULE: u32 = 3;

/// The exact piece of one entity, and whether it is a spline.
fn piece(e: &Entity) -> R<(wc::Trimmed, bool)> {
    let finite = |v: &[f64]| v.iter().all(|x| x.is_finite());
    match e {
        Entity::Line { a, b } => {
            if !finite(&[a[0], a[1], b[0], b[1]]) {
                return Err(no("nonfinite-source"));
            }
            Ok((wc::Trimmed::line(*a, *b), false))
        }
        Entity::Arc3 { start, mid, end } => {
            if !finite(&[start[0], start[1], mid[0], mid[1], end[0], end[1]]) {
                return Err(no("nonfinite-source"));
            }
            Ok((wc::Trimmed::arc_through(*start, *mid, *end)?, false))
        }
        Entity::Bezier { .. } | Entity::BSpline { .. } | Entity::Fit { .. } => {
            let exact = crate::curve_source::exact_spline(e)?.expect("spline entity");
            if exact.is_rational() { return Err(no("rational-spline-unsupported")); }
            let spline = Arc::new(exact);
            let (lo, hi) = spline.domain();
            let (lo, hi) = (lo.clone(), hi.clone());
            Ok((wc::Trimmed::spline(spline, lo, hi)?, true))
        }
        Entity::Circle { .. } => Err(no("circle-in-chain")),
    }
}

/// The counter-clockwise simple profile of the entities (see the module doc).
pub(crate) fn profile(entities: &[Entity]) -> R<Profile> {
    if entities.len() < 2 {
        return Err(no("requires-closed-chain"));
    }
    let mut pieces = Vec::with_capacity(entities.len());
    let mut splines = 0;
    for e in entities {
        let (p, spline) = piece(e)?;
        splines += usize::from(spline);
        pieces.push(p);
    }
    if splines == 0 {
        return Err(no("spline-required"));
    }
    let cycle = wc::Cycle::new(crate::arc_profile::chained(&pieces)?);
    let arrangement = wc::arrange(&[&cycle], BUDGET)?;
    let n = cycle.len();
    if arrangement.points.len() != n || arrangement.pieces.len() != n || arrangement.cells.len() != 1 {
        return Err(no("non-simple-chain"));
    }
    let cycle = if cycle.orientation()? { cycle } else { cycle.reversed() };
    Ok(Profile::from_pieces(cycle.pieces().to_vec()))
}

/// Builds the prism of a closed entity chain in the sketch frame `frame`,
/// `depth` along +z (or -z when `reverse`).
pub fn build(key: BodyKey, frame: Affine, entities: &[Entity], depth: f64, reverse: bool) -> R<Body> {
    Source { source: [0; 4], frame, entities: entities.to_vec(), depth, reverse }.build(key)
}

/// The replayable source of a curve-profile prism (the module table).
#[derive(Clone, Debug)]
pub(crate) struct Source {
    pub source: [u32; 4],
    pub frame: Affine,
    pub entities: Vec<Entity>,
    pub depth: f64,
    pub reverse: bool,
}
impl Source {
    fn levels(&self) -> [f64; 2] {
        if self.reverse { [-self.depth, 0.] } else { [0., self.depth] }
    }
    pub(crate) fn build(&self, key: BodyKey) -> R<Body> {
        if !self.depth.is_finite() || self.depth <= 0. {
            return Err(no("depth"));
        }
        self.frame.det_exact().map_err(|_| no("frame"))?;
        let profile = profile(&self.entities)?;
        let levels = self.levels();
        let node = |operation, rule_version, parents: Vec<NodeId>, parameters: Vec<f64>, frame| -> R<Construction> {
            Ok(Construction {
                operation,
                rule_version,
                parents,
                parameters: parameters.into_iter().map(b).collect::<R<_>>()?,
                frame: FrameId(frame),
            })
        };
        let nodes = vec![
            node(Operation::Interpreter {}, 1, vec![], vec![self.depth, if self.reverse { 1. } else { 0. }], 0)?,
            node(Operation::Sketch {}, SKETCH_RULE, vec![NodeId(0)], sketch3::encode(0, &self.entities), 1)?,
            node(Operation::Extrude {}, 1, vec![NodeId(1)], levels.to_vec(), 1)?,
        ];
        let v = |p: [f64; 3]| -> R<Vector3> { Ok([b(p[0])?, b(p[1])?, b(p[2])?]) };
        let frames = vec![
            Frame::Source { source: self.source },
            Frame::Interpreter { parent: FrameId(0), origin: v(self.frame.origin)?, x: v(self.frame.x)?, z: v(self.frame.z)? },
        ];
        crate::arc_profile_brep::construct(key, frames, nodes, &ArcPrism { regularization: None, rim: None, profile, levels })
    }
    /// Reads exactly the grammar [`Source::build`] writes.
    pub(crate) fn parse(frames: &[Frame], nodes: &[Construction]) -> R<Self> {
        let (Some(&Frame::Source { source }), Some(&Frame::Interpreter { parent: FrameId(0), origin, x, z }), 2) =
            (frames.first(), frames.get(1), frames.len())
        else {
            return Err(no("frame"));
        };
        let frame = Affine { origin: origin.map(|v| v.get()), x: x.map(|v| v.get()), z: z.map(|v| v.get()) };
        let [interpreter, sketch, _] = nodes else { return Err(no("construction-shape")) };
        let (depth, reverse) = match interpreter.parameters.as_slice() {
            [depth, reverse] if [0., 1.].contains(&reverse.get()) => (depth.get(), reverse.get() == 1.),
            _ => return Err(no("source")),
        };
        let parameters: Vec<f64> = sketch.parameters.iter().map(|p| p.get()).collect();
        let (region, entities) = sketch3::parse(&parameters).map_err(|_| no("sketch-parameters"))?;
        if region != 0 {
            return Err(no("region-unsupported"));
        }
        Ok(Self { source, frame, entities, depth, reverse })
    }
}

/// Audit of a curve-profile prism: rebuild from the rule 3 source, compare bit
/// for bit, and hand the exact profile to the `ArcPrism` measures.
pub(crate) fn audit(checked: &CheckedBody) -> R<Audited> {
    let body = checked.body();
    if !candidate(body) {
        return Err(no("construction-shape"));
    }
    let source = Source::parse(&body.frames, &body.constructions)?;
    if source.build(body.key.clone())? != *body {
        return Err(no("construction-mismatch"));
    }
    let frame = Placement::from_frames(body, FrameId(1)).map_err(|_| no("frame"))?;
    if frame.reversed().map_err(|_| no("frame"))? || frame.orthonormality_defect().map_err(|_| no("frame"))? > 1e-9 {
        return Err(no("non-near-rigid-frame"));
    }
    let levels = source.levels();
    let face_loops = body
        .loops
        .iter()
        .map(|lp| {
            lp.coedges
                .iter()
                .map(|id| {
                    let co = &body.coedges[id.0 as usize];
                    body.edges[co.edge.0 as usize].vertices[usize::from(!co.forward)].0 as usize
                })
                .collect()
        })
        .collect();
    Ok(Audited {
        body: body.clone(),
        frame,
        axis: 2,
        levels,
        cap: vec![],
        face_loops,
        bound_to_construction: true,
        arrangement: None,
        orthogonal: None,
        rounded: None,
        corner: None,
        arcs: Some(ArcPrism { regularization: None, rim: None, profile: profile(&source.entities)?, levels }),
        chamfer: None,
    })
}
