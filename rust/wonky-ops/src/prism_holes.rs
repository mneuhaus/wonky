//! Exact axial holes in an extruded line/arc profile or cylinder.
//! Connected coaxial cylinders share one exact stepped-meridian boundary.
//! Caps are split by full SSI circles, uncut side components inherit material
//! membership, and reversed cylinder walls are sewn into the cap inner loops.
//! This is the closed-ring arrangement, not general crossing-curve trimming.
//! Every input keeps its own construction/frame DAG; replay owns all caches.
use crate::{
    affine::Affine,
    analytic::Solid,
    arc_profile::{self, dot, q, ArcPrism, Profile},
    cylinder::{self, Cylinder, Spec},
    placement::Placement,
    polyhedron::{self, Audited, Refused},
};
use num_rational::BigRational as Q;
use num_traits::{ToPrimitive, Zero};
use wonky_contract::*;
use wonky_curve as wc;
pub(crate) type R<T> = std::result::Result<T, Refused>;
pub(crate) fn no(s: &str) -> Refused {
    Refused(format!("prism-holes/{s}"))
}
pub(crate) fn b(x: f64) -> R<Binary64> {
    Binary64::new(x).map_err(|_| no("numeric-range"))
}
fn get(p: &Vector3) -> [f64; 3] {
    p.map(|v| v.get())
}
pub(crate) fn exact_float(x: &Q) -> R<f64> {
    let f = x
        .to_f64()
        .filter(|f| f.is_finite())
        .ok_or_else(|| no("coordinate-range"))?;
    if q(f) != *x {
        return Err(no("non-binary64-related-coordinate"));
    }
    Ok(f)
}
/// Straight profile replay owns rational lateral planes and an exact cap.
/// Do not admit arbitrary planar arrangements by their rounded cap cache.
pub(crate) fn straight_profile(a: &polyhedron::Audited) -> bool {
    // Placement wrappers preserve the source grammar; only their authenticated
    // inverse supplies the leaf, never a reclassified display boundary.
    let mut source = a.body.clone();
    while let Some((inner, _)) = crate::pattern::unplace(&source) {
        source = inner;
    }
    arc_profile::candidate(&source)
        && source.constructions.len() == 3
        && source.constructions[1].parameters.is_empty()
        && !a.cap.is_empty()
        && a.arrangement.is_some()
}
/// A full-turn polygon revolution used as a cutting tool, with the exact
/// composed placement of its own source frame (never a rounded world copy).
#[derive(Clone, Debug)]
pub struct RevolvedTool {
    pub(crate) rev: crate::revolve_full::FullRevolve,
    pub(crate) placement: Placement,
}
#[derive(Clone, Debug)]
pub enum Base {
    Planar(Audited),
    Cylinder(Cylinder),
    /// Tool only: never a hole target.
    Revolved(Box<RevolvedTool>),
}
impl Base {
    pub fn body(&self) -> &Body {
        match self {
            Self::Planar(a) => &a.body,
            Self::Cylinder(c) => &c.body,
            Self::Revolved(t) => &t.rev.body,
        }
    }
    pub fn frame(&self) -> &Placement {
        match self {
            Self::Planar(a) => &a.frame,
            Self::Cylinder(c) => &c.frame,
            Self::Revolved(t) => &t.placement,
        }
    }
    fn carrier_frame(&self) -> R<FrameId> {
        // Seam vertices may use a translated chart. Bore coordinates and
        // their construction witness belong to the base surface carrier.
        self.body().surfaces.first().map(|s| s.frame).ok_or_else(|| no("source-frame"))
    }
    pub(crate) fn kind(&self) -> R<u32> {
        match self {
            Self::Cylinder(_) => Ok(3),
            // Only a plain source revolution (no Boolean history) is a tool.
            Self::Revolved(t)
                if t.rev.body.constructions.len() == 2 && t.rev.body.frames.len() == 2 =>
            {
                Ok(5)
            }
            Self::Revolved(_) => Err(no("revolved-tool-carrier")),
            Self::Planar(a) if a.arcs.as_ref().is_some_and(|s| s.rim.is_none()) => Ok(1),
            Self::Planar(a) if straight_profile(a) => Ok(4),
            Self::Planar(a) if a.orthogonal.is_some() && a.body.shells.len() == 1 => Ok(2),
            Self::Planar(a)
                if !a.cap.is_empty()
                    // Placement arrangements retain the audited source cap;
                    // general Boolean arrangements have no prism cap.
                    && a.rounded.is_none()
                    && a.chamfer.is_none()
                    && a.corner.is_none()
                    && a.axis == 2 =>
            {
                Ok(0)
            }
            _ => Err(no("target-carrier")),
        }
    }
    pub(crate) fn axis_levels(&self) -> R<(usize, [f64; 2])> {
        self.kind()?;
        match self {
            Self::Cylinder(c) => {
                let k = c.spec.axis()?;
                Ok((k, [c.spec.bottom[k], c.spec.top[k]]))
            }
            Self::Planar(a) => {
                if let Some(c) = &a.orthogonal {
                    let bounds = c.source_bbox();
                    Ok((2, [bounds[0][2], bounds[1][2]]))
                } else {
                    Ok((a.axis, a.levels))
                }
            }
            Self::Revolved(_) => Err(no("target-carrier")),
        }
    }
    pub(crate) fn profile(&self) -> Option<ArcPrism> {
        let Self::Planar(a) = self else { return None };
        if let Some(p) = &a.arcs {
            return Some(p.clone());
        }
        let points = if let Some(c) = &a.orthogonal {
            if c.boxes.len() != 1 {
                return None;
            }
            let [lo, hi] = c.boxes[0];
            vec![
                [lo[0], lo[1]],
                [hi[0], lo[1]],
                [hi[0], hi[1]],
                [lo[0], hi[1]],
            ]
        } else {
            a.cap.iter().map(|p| [p.x, p.y]).collect()
        };
        Some(ArcPrism {
            profile: Profile::from_pieces(
                (0..points.len())
                    .map(|i| wc::Trimmed::line(points[i], points[(i + 1) % points.len()]))
                    .collect(),
            ),
            levels: self.axis_levels().ok()?.1,
            rim: None,
            regularization: None,
        })
    }
    pub(crate) fn bbox(&self, map: Option<[[f64; 4]; 3]>) -> R<([f64; 3], [f64; 3])> {
        match self {
            Self::Planar(a) => a.bbox_mm(map),
            Self::Cylinder(c) => c.bbox_mm(map),
            Self::Revolved(_) => Err(no("target-carrier")),
        }
    }
    pub(crate) fn tolerance(&self) -> R<f64> {
        match self {
            Self::Planar(a) => a.export_tolerance_mm(),
            Self::Cylinder(c) => c.tolerance_mm(),
            Self::Revolved(t) => t.rev.tolerance_mm(),
        }
    }
}
#[derive(Clone, Debug)]
pub struct PrismHoles {
    pub body: Body,
    pub base: Base,
    pub(crate) holes: Vec<Spec>,
    pub(crate) caps: Vec<[Option<usize>; 2]>,
    pub(crate) pocket: Option<crate::prism_pocket::Pocket>,
    pub(crate) hole_levels: Vec<[Q; 2]>,
    /// Revolved-tool holes (clipped meridians), after the cylinder holes.
    pub(crate) meridians: Vec<crate::prism_holes_revolved::MeridianHole>,
    pub(crate) meridian_caps: Vec<[Option<usize>; 2]>,
    /// Replayed source tools, in operand order after `base`.
    pub(crate) tools: Vec<Base>,
}
impl PrismHoles {
    /// Source operands `[target, tools...]` of this audited difference, for
    /// re-arranging a further subtraction in one exact pass.
    pub(crate) fn sources(&self) -> Vec<Solid> {
        std::iter::once(&self.base)
            .chain(&self.tools)
            .map(|b| match b {
                Base::Planar(a) => Solid::Planar(a.clone()),
                Base::Cylinder(c) => Solid::Cylinder(c.clone()),
                Base::Revolved(t) => Solid::Revolved(t.rev.clone()),
            })
            .collect()
    }
    /// Move each original operand by the same exact post map and re-arrange
    /// them in the shared stack. Repeated placements remain a symbolic chain.
    pub(crate) fn transform(&self, frame: Affine) -> R<Body> {
        let audited = |body: Body| crate::analytic::audit(&body.check().map_err(|_| no("placement-contract"))?);
        let placed = self.sources().iter().map(|s| audited(s.transform(frame)?)).collect::<R<Vec<_>>>()?;
        let mut result = crate::prism_stack::boolean(self.body.key.clone(), 1, &placed)?;
        Ok(result.remove(0))
    }

}
pub(crate) fn candidate(body: &Body) -> bool {
    body.constructions
        .last()
        .is_some_and(|n| n.operation == Operation::Boolean {} && n.rule_version == 3)
}
fn source_frame(frames: &[Frame]) -> R<Affine> {
    match frames.get(1) {
        Some(Frame::Interpreter {
            parent: FrameId(0),
            origin,
            x,
            z,
        }) => Ok(Affine {
            origin: get(origin),
            x: get(x),
            z: get(z),
        }),
        _ => Err(no("source-frame")),
    }
}
/// Replay appended source-chart images and let the final DAG equality bind
/// every wrapper to its original input. No composed binary64 map is authored.
pub(crate) fn replay_images(mut body: Body, images: &[Frame], key: &BodyKey) -> R<Body> {
    for image in images {
        let post = match image {
            Frame::InterpreterImage { origin, x, z, .. } => crate::placement::Post::Interpreter(Affine {
                origin: get(origin), x: get(x), z: get(z),
            }),
            Frame::AffineImage { translation, rows, .. } => crate::placement::Post::Rows {
                translation: get(translation), rows: rows.map(|r| get(&r)),
            },
            _ => return Err(no("source-frame")),
        };
        body = crate::pattern::place_body(&body, key.clone(), &post)?;
    }
    Ok(body)
}
/// Rebuild a leaf from its original inputs, then compare both source DAGs. The
/// descriptor chooses a grammar, never supplies a replacement geometry cache.
pub(crate) fn rebuild(key: BodyKey, kind: u32, frames: Vec<Frame>, nodes: Vec<Construction>) -> R<Base> {
    if nodes.last().is_some_and(|n| n.operation == Operation::Fillet{} && n.rule_version == 13) {
        let body = crate::fillet_general::rebuild(key,frames,nodes)?;
        return Ok(Base::Planar(crate::fillet_general::audit(&body.check().map_err(|_|no("source-contract"))?)?));
    }

    // Replay placement wrappers before selecting a source grammar. The source
    // DAG and its coordinates stay intact; each image is applied exactly once.
    // Cylinder replay owns its seam chart and placement grammar itself.
    if kind != 3 {
        if frames.len() > 256 { return Err(no("source-frame-budget")); }
        let last = FrameId(frames.len().checked_sub(1).ok_or_else(|| no("source-frame"))? as u32);
        let post = match frames.last() {
            Some(Frame::AffineImage { translation, rows, .. }) => Some(crate::placement::Post::Rows {
                translation: get(translation), rows: rows.map(|r| get(&r)),
            }),
            Some(Frame::InterpreterImage { origin, x, z, .. }) => Some(crate::placement::Post::Interpreter(Affine {
                origin: get(origin), x: get(x), z: get(z),
            })),
            _ => None,
        };
        if let Some(post) = post {
            let first = nodes.iter().position(|n| n.operation == (Operation::AffineTransform {}) && n.frame == last)
                .ok_or_else(|| no("placement-lineage"))?;
            let source = rebuild(key.clone(), kind, frames[..frames.len()-1].to_vec(), nodes[..first].to_vec())?;
            let body = crate::pattern::place_body(source.body(), key, &post)?;
            if body.frames != frames || body.constructions != nodes { return Err(no("placement-replay-mismatch")); }
            return Ok(Base::Planar(polyhedron::audit(&body.check().map_err(|_| no("source-contract"))?)?));
        }
    }
    let frame = source_frame(&frames)?;
    let body = match kind {
        1 | 4 if nodes.len() >= 3 && frames.len() >= 2 => {
            let body = arc_profile::Source::parse(&frames[..2], &nodes[..3])?.build(key.clone())?;
            replay_images(body, &frames[2..], &key)?
        }
        0 if nodes.len() >= 5 => {
            let p = nodes[1]
                .parameters
                .iter()
                .map(|v| v.get())
                .collect::<Vec<_>>();
            if p.len() % 4 != 0 || nodes[2].parameters.len() != 2 {
                return Err(no("polygon-source"));
            }
            let lines = p
                .chunks_exact(4)
                .map(|c| [c[0], c[1], c[2], c[3]])
                .collect::<Vec<_>>();
            let segs = lines
                .iter()
                .map(|c| [wonky_num::p2(c[0], c[1]), wonky_num::p2(c[2], c[3])])
                .collect::<Vec<_>>();
            let regions =
                wonky_sketch::region::lines_region(&segs).map_err(|_| no("polygon-source"))?;
            let [region] = regions.loops.as_slice() else {
                return Err(no("polygon-regions"));
            };
            let Some(Frame::Source { source }) = frames.first() else {
                return Err(no("source-frame"));
            };
            let plane = &nodes[0].parameters;
            if plane.len() != 9 { return Err(no("polygon-source")); }
            let original = Affine {
                origin: std::array::from_fn(|i| plane[i].get()),
                x: std::array::from_fn(|i| plane[3 + i].get()),
                z: std::array::from_fn(|i| plane[6 + i].get()),
            };
            let mut body = crate::extrude::blind_prism(&crate::extrude::Prism {
                key: key.clone(),
                source: *source,
                frame: original,
                segments: &lines,
                region,
                depth: nodes[2].parameters[0].get(),
                reverse: nodes[2].parameters[1].get() == -1.,
            })
            .map_err(|_| no("polygon-source"))?;
            // First placement of an identity prism changes its interpreter
            // frame, while preserving the original plane construction input.
            if original != frame {
                if original != Affine::IDENTITY { return Err(no("source-grammar-mismatch")); }
                let checked = body.check().map_err(|_| no("source-contract"))?;
                body = crate::orthogonal::transform(&polyhedron::audit(&checked)?, frame)?;
                body.key = key.clone();
            }
            body = replay_images(body, &frames[2..], &key)?;
            body
        }
        2 => {
            let mut bodies =
                crate::orthogonal::construct(key, frame, nodes.clone(), nodes.len() - 1)?;
            if bodies.len() != 1 {
                return Err(no("target-components"));
            }
            bodies.pop().unwrap()
        }
        // The frame chain (interpreter, exact placement images, seam chart) is
        // relocated by the owner of the cylinder carrier, image by image.
        3 => cylinder::source_body(key, &frames, &nodes)?,
        5 => crate::prism_holes_revolved::rebuild_tool(key, &frames, &nodes, frame)?,
        _ => return Err(no("source-grammar")),
    };
    if body.constructions != nodes || body.frames != frames {
        return Err(no("source-grammar-mismatch"));
    }
    // Ensure caches have passed their existing, independent owner audit.
    let checked = body.clone().check().map_err(|_| no("source-contract"))?;
    if kind == 3 {
        Ok(Base::Cylinder(cylinder::audit(&checked)?))
    } else if kind == 5 {
        Ok(Base::Revolved(Box::new(RevolvedTool {
            rev: crate::revolve_full::audit(&checked)?,
            placement: Placement::from_frames(&body, FrameId(1))
                .map_err(|_| no("revolved-tool-frame"))?,
        })))
    } else {
        Ok(Base::Planar(polyhedron::audit(&checked)?))
    }
}
fn index(x: f64) -> R<usize> {
    if x < 0. || x > 1_000_000. || x.fract() != 0. {
        return Err(no("source-index"));
    }
    Ok(x as usize)
}
fn move_frame(f: &mut Frame, offset: u32, adding: bool) -> R<()> {
    let parent = match f {
        Frame::Source { .. } => return Ok(()),
        Frame::Interpreter { parent, .. }
        | Frame::Rigid { parent, .. }
        | Frame::AffineImage { base: parent, .. }
        | Frame::InterpreterImage { base: parent, .. }
        | Frame::RationalImage { base: parent, .. } => parent,
    };
    parent.0 = if adding {
        parent.0 + offset
    } else {
        parent
            .0
            .checked_sub(offset)
            .ok_or_else(|| no("source-frame"))?
    };
    Ok(())
}
fn graft(base: &Base, tools: &[Base]) -> R<(Vec<Frame>, Vec<Construction>)> {
    let (frames, mut nodes, parents, descriptors) = graft_sources(base, tools)?;
    let mut parameters = vec![b(1.)?];
    parameters.extend(descriptors);
    nodes.push(Construction {
        operation: Operation::Boolean {},
        rule_version: 3,
        parents,
        parameters,
        frame: base.carrier_frame()?,
    });
    Ok((frames, nodes))
}
/// Concatenate the replay-validated source DAGs of `[base, tools...]`. Returns
/// the frames, the nodes, each operand's root node and its (kind, frame count,
/// node count) descriptor; the caller appends its own Boolean root.
pub(crate) fn graft_sources(
    base: &Base,
    tools: &[Base],
) -> R<(Vec<Frame>, Vec<Construction>, Vec<NodeId>, Vec<Binary64>)> {
    let mut frames = vec![];
    let mut nodes = vec![];
    let mut parents = vec![];
    let mut parameters = vec![];
    for operand in std::iter::once(base).chain(tools) {
        let (body, kind) = (operand.body(), operand.kind()?);
        // Validate exactly the source grammar that the future replay will use.
        rebuild(
            body.key.clone(),
            kind,
            body.frames.clone(),
            body.constructions.clone(),
        )?;
        let fo = frames.len() as u32;
        let noff = nodes.len() as u32;
        parameters.extend([
            b(kind as f64)?,
            b(body.frames.len() as f64)?,
            b(body.constructions.len() as f64)?,
        ]);
        for mut f in body.frames.clone() {
            move_frame(&mut f, fo, true)?;
            frames.push(f)
        }
        for mut n in body.constructions.clone() {
            n.frame.0 += fo;
            for p in &mut n.parents {
                p.0 += noff
            }
            nodes.push(n);
        }
        parents.push(NodeId(nodes.len() as u32 - 1));
    }
    Ok((frames, nodes, parents, parameters))
}
pub(crate) fn related(tool: &Cylinder, target: &Placement) -> R<Spec> {
    let relation = crate::construction_geom::frame(target)?
        .relation_from(&crate::construction_geom::frame(&tool.frame)?);
    relation
        .require_isometry()
        .map_err(|e| Refused(e.0.into()))?;
    let map = |p: [f64; 3]| -> R<[f64; 3]> {
        let p = relation.map.point(&p.map(q));
        Ok([
            exact_float(&p[0])?,
            exact_float(&p[1])?,
            exact_float(&p[2])?,
        ])
    };
    let mut s = Spec {
        bottom: map(tool.spec.bottom)?,
        top: map(tool.spec.top)?,
        radius: tool.spec.radius,
    };
    let k = s.axis()?;
    if s.bottom[k] > s.top[k] {
        std::mem::swap(&mut s.bottom, &mut s.top)
    }
    Ok(s)
}
/// `related`, with the axial coordinate `k` of a cutter clipped to `limit` by
/// exact comparison: beyond the material envelope a cutter removes nothing,
/// so its far end need not be a binary64 there. `None` if nothing of the tool
/// remains inside the envelope.
pub(crate) fn related_clipped(tool: &Cylinder, target: &Placement, k: usize, limit: [f64; 2]) -> R<Option<Spec>> {
    let relation = crate::construction_geom::frame(target)?
        .relation_from(&crate::construction_geom::frame(&tool.frame)?);
    relation
        .require_isometry()
        .map_err(|e| Refused(e.0.into()))?;
    let (lo, hi) = (q(limit[0]), q(limit[1]));
    let map = |p: [f64; 3]| -> R<[f64; 3]> {
        let mut p = relation.map.point(&p.map(q));
        if p[k] <= lo {
            p[k] = lo.clone()
        } else if p[k] >= hi {
            p[k] = hi.clone()
        }
        Ok([
            exact_float(&p[0])?,
            exact_float(&p[1])?,
            exact_float(&p[2])?,
        ])
    };
    let (a, c) = (map(tool.spec.bottom)?, map(tool.spec.top)?);
    if a == c {
        return Ok(None);
    }
    let mut s = Spec { bottom: a, top: c, radius: tool.spec.radius };
    let axis = s.axis()?;
    if s.bottom[axis] > s.top[axis] {
        std::mem::swap(&mut s.bottom, &mut s.top)
    }
    Ok(Some(s))
}
fn classify(base: &Base, tools: &[Cylinder]) -> R<Vec<Spec>> {
    if let Base::Planar(a) = base {
        if a.orthogonal.as_ref().is_some_and(|c| c.boxes.len() > 1) {
            let tools = tools
                .iter()
                .map(|t| related(t, base.frame()))
                .collect::<R<Vec<_>>>()?;
            return crate::prism_holes_cells::classify(a, &tools);
        }
    }
    let (axis, levels) = base.axis_levels()?;
    let profile = base.profile();
    let mut holes: Vec<Spec> = vec![];
    for tool in tools {
        // The far ends of a through cutter lie beyond the envelope: clip them by
        // exact comparison, so a mixed-origin sum need not be a binary64 there.
        let Some(mut s) = related_clipped(tool, base.frame(), axis, levels)? else {
            continue;
        };
        if s.axis()? != axis {
            return Err(no("non-axial-cut"));
        }
        if s.top[axis] <= levels[0] || s.bottom[axis] >= levels[1] {
            continue;
        }
        if s.bottom[axis] > levels[0] && s.top[axis] < levels[1] {
            return Err(no("enclosed-cavity"));
        }
        let p = [q(s.bottom[(axis + 1) % 3]), q(s.bottom[(axis + 2) % 3])];
        let r = q(s.radius);
        let r2 = &r * &r;
        if let Some(profile) = &profile {
            if !profile.contains(&wc::ExactPoint::from_rational(p.clone()))?
                || !profile.profile.clears_disc(&p, &r2)?
            {
                return Err(no("side-contact-or-crossing"));
            }
        } else if let Base::Cylinder(c) = base {
            let delta = [
                &p[0] - q(c.spec.bottom[(axis + 1) % 3]),
                &p[1] - q(c.spec.bottom[(axis + 2) % 3]),
            ];
            let d2 = dot(&delta, &delta);
            let cover = &r - q(c.spec.radius);
            if cover >= Q::zero()
                && d2 <= &cover * &cover
                && s.bottom[axis] <= levels[0]
                && s.top[axis] >= levels[1]
            {
                return Err(Refused::geometric_verdict(no("empty-result").0));
            }
            let gap = q(c.spec.radius) - r;
            if gap > Q::zero() && d2 == &gap * &gap {
                return Err(Refused::geometric_verdict(no("non-manifold-result").0));
            }
            if gap <= Q::zero() || d2 > &gap * &gap {
                return Err(no("side-contact-or-crossing"));
            }
        }
        s.bottom[axis] = s.bottom[axis].max(levels[0]);
        s.top[axis] = s.top[axis].min(levels[1]);
        for h in &holes {
            if (0..3).filter(|&k| k != axis).all(|k| s.bottom[k] == h.bottom[k]) {
                continue;
            }
            if s.top[axis] <= h.bottom[axis] || h.top[axis] <= s.bottom[axis] {
                // Meeting floor discs need merging, rather than an internal membrane.
                if cylinder::radial_relation(s, *h)? <= 0 {
                    return Err(no("holes-cap-contact"));
                }
            } else if cylinder::radial_relation(s, *h)? <= 0 {
                return Err(no("holes-contact-or-overlap"));
            }
        }
        holes.push(s);
    }
    Ok(holes)
}
// The constant-profile observation path needs its two original caps.
pub(super) fn base_caps(base: &Base) -> R<[usize; 2]> {
    let (k, levels) = base.axis_levels()?;
    let mut s = Spec {
        bottom: [0.; 3],
        top: [0.; 3],
        radius: 1.,
    };
    s.bottom[k] = levels[0];
    s.top[k] = levels[1];
    let c = caps(base, &s)?;
    Ok([
        c[0].ok_or_else(|| no("missing-cap"))?,
        c[1].ok_or_else(|| no("missing-cap"))?,
    ])
}
fn caps(base: &Base, hole: &Spec) -> R<[Option<usize>; 2]> {
    caps_on_body(base, base.body(), hole)
}
fn caps_on_body(base: &Base, body: &Body, hole: &Spec) -> R<[Option<usize>; 2]> {
    let k = hole.axis()?;
    let mut caps = [None, None];
    for (i, f) in body.faces.iter().enumerate() {
        if let SurfaceGeometry::Plane { origin, normal, .. } =
            &body.surfaces[f.surface.0 as usize].geometry
        {
            let n = get(normal);
            if (0..3).all(|j| n[j] == if j == k { n[k] } else { 0. }) && n[k].abs() == 1. {
                let side = usize::from((n[k] > 0.) == f.forward);
                let level = if side == 0 {
                    hole.bottom[k]
                } else {
                    hole.top[k]
                };
                if origin[k].get() != level {
                    continue;
                }
                if let Base::Planar(a) = base {
                    if a.orthogonal.as_ref().is_some_and(|c| c.boxes.len() > 1)
                        && !crate::prism_holes_cells::cap_contains(a, i, hole)?
                    {
                        continue;
                    }
                }
                if caps[side].replace(i).is_some() {
                    return Err(no("ambiguous-cap"));
                }
            }
        }
    }
    Ok(caps)
}
fn circle_on_plane(body: &Body, surface: SurfaceId, spec: Spec, side: usize) -> R<PcurveGeometry> {
    let SurfaceGeometry::Plane { origin, normal, x } = &body.surfaces[surface.0 as usize].geometry
    else {
        return Err(no("cap-carrier"));
    };
    let (o, n, x) = (get(origin).map(q), get(normal).map(q), get(x).map(q));
    let y = wonky_geom::cross(&n, &x);
    if wonky_geom::dot(&x, &x) != q(1.) || wonky_geom::dot(&y, &y) != q(1.) {
        return Err(no("cap-chart"));
    }
    let p = if side == 0 { spec.bottom } else { spec.top };
    let delta = std::array::from_fn(|k| q(p[k]) - &o[k]);
    Ok(PcurveGeometry::Circle {
        origin: [
            b(exact_float(&wonky_geom::dot(&delta, &x))?)?,
            b(exact_float(&wonky_geom::dot(&delta, &y))?)?,
        ],
        radius: b(spec.radius)?,
        clockwise: n[spec.axis()?] < q(0.),
    })
}
fn hole_caps(
    base: &Base,
    pocket: Option<&crate::prism_pocket::Pocket>,
    holes: &[Spec],
    levels: &[[Q; 2]],
) -> R<Vec<[Option<usize>; 2]>> {
    holes
        .iter()
        .enumerate()
        .map(|(i, h)| {
            let mut out = caps(base, h)?;
            if let Some(p) = pocket {
                if levels[i][p.entry] == p.levels[1 - p.entry] {
                    // The floor is the first appended face. Match exact source
                    // heights, not rounded coordinates in the serialized B-rep.
                    out[p.entry] = Some(base.body().faces.len());
                }
            }
            Ok(out)
        })
        .collect()
}
#[allow(clippy::too_many_arguments)]
fn assemble(
    key: BodyKey,
    base: &Base,
    holes: &[Spec],
    pocket: Option<&crate::prism_pocket::Pocket>,
    hole_levels: &[[Q; 2]],
    meridians: &[crate::prism_holes_revolved::MeridianHole],
    frames: Vec<Frame>,
    nodes: Vec<Construction>,
) -> R<Body> {
    base.axis_levels()?;
    let mut body = base.body().clone();
    let carrier_frame = base.carrier_frame()?;
    body.key = key;
    body.frames = frames;
    body.constructions = nodes;
    let prov = Provenance::Construction {
        node: NodeId(body.constructions.len() as u32 - 1),
    };
    if let Some(pocket) = pocket {
        crate::prism_pocket::sew(&mut body, pocket)?;
    }
    // Resolve cap identities before adding any bore faces.
    let caps = hole_caps(base, pocket, holes, hole_levels)?;
    let revolved_caps = crate::prism_holes_revolved::caps(base, meridians)?;
    for (s, cap) in holes.iter().zip(caps) {
        let c = cylinder::create(body.key.clone(), *s)?;
        let fo = body.frames.len() as u32;
        // Bore coordinates live in the target's current carrier chart, which
        // may follow source-preserving placement images. Relocate both the
        // carriers and their translated seam chart into that same frame DAG.
        let carrier = carrier_frame;
        let mut seam = c.frames[2].clone();
        let Frame::Rigid { parent, .. } = &mut seam else {
            return Err(no("seam-frame"));
        };
        if *parent != FrameId(1) {
            return Err(no("seam-frame"));
        }
        *parent = carrier;
        body.frames.push(seam);
        let (vo, eo, co, so, po, uo, lo) = (
            body.vertices.len() as u32,
            body.edges.len() as u32,
            body.curves.len() as u32,
            body.surfaces.len() as u32,
            body.pcurves.len() as u32,
            body.coedges.len() as u32,
            body.loops.len() as u32,
        );
        let mut surfaces = [SurfaceId(0); 3];
        let mut open = [false; 2];
        for i in 0..2 {
            open[i] = cap[i].is_some();
            if open[i] {
                surfaces[i] = body.faces[cap[i].ok_or_else(|| no("missing-cap"))?].surface
            } else {
                surfaces[i] = SurfaceId(body.surfaces.len() as u32);
                let mut surface = c.surfaces[i].clone();
                surface.frame = carrier;
                body.surfaces.push(surface)
            }
        }
        surfaces[2] = SurfaceId(body.surfaces.len() as u32);
        let mut wall = c.surfaces[2].clone();
        wall.frame = carrier;
        body.surfaces.push(wall);
        for mut vertex in c.vertices {
            vertex.frame = FrameId(fo);
            vertex.provenance = Provenance::None {};
            body.vertices.push(vertex)
        }
        for mut curve in c.curves {
            curve.frame = match curve.frame {
                FrameId(1) => carrier,
                FrameId(2) => FrameId(fo),
                _ => return Err(no("bore-frame")),
            };
            curve.provenance = if curve.frame == FrameId(fo) {
                Provenance::None {}
            } else {
                prov.clone()
            };
            for support in &mut curve.supports {
                support.surface = surfaces[support.surface.0 as usize];
                support.pcurve.0 += po
            }
            body.curves.push(curve)
        }
        for mut edge in c.edges {
            edge.curve.0 += co;
            for v in &mut edge.vertices {
                v.0 += vo
            }
            body.edges.push(edge)
        }
        for mut pc in c.pcurves {
            let old = pc.surface.0 as usize;
            pc.curve.0 += co;
            pc.surface = surfaces[old];
            if old < 2 {
                pc.geometry = circle_on_plane(&body, pc.surface, *s, old)?
            }
            body.pcurves.push(pc)
        }
        for mut usage in c.coedges {
            usage.edge.0 += eo;
            usage.pcurve.0 += po;
            usage.forward = !usage.forward;
            body.coedges.push(usage)
        }
        for (i, mut lp) in c.loops.into_iter().enumerate() {
            lp.outer = i == 2 || !open[i];
            lp.coedges.reverse();
            for u in &mut lp.coedges {
                u.0 += uo
            }
            body.loops.push(lp)
        }
        for i in 0..2 {
            if open[i] {
                body.faces[cap[i].ok_or_else(|| no("missing-cap"))?]
                    .loops
                    .push(LoopId(lo + i as u32))
            } else {
                body.shells[0].faces.push(FaceId(body.faces.len() as u32));
                body.faces.push(Face {
                    surface: surfaces[i],
                    forward: false,
                    loops: vec![LoopId(lo + i as u32)],
                })
            }
        }
        body.shells[0].faces.push(FaceId(body.faces.len() as u32));
        body.faces.push(Face {
            surface: surfaces[2],
            forward: false,
            loops: vec![LoopId(lo + 2)],
        });
        for surface in &mut body.surfaces[so as usize..] {
            surface.provenance = prov.clone()
        }
    }
    for (hole, cap) in meridians.iter().zip(revolved_caps) {
        crate::prism_holes_revolved::sew(&mut body, hole, cap, &prov)?;
    }
    body.clone()
        .check()
        .map_err(|e| no(&format!("contract:{e:?}")))?;
    // Independent local manifold check: no forgotten cap, seam or duplicate use.
    for e in 0..body.edges.len() {
        let uses = body
            .coedges
            .iter()
            .filter(|c| c.edge.0 as usize == e)
            .collect::<Vec<_>>();
        if uses.len() != 2 || uses[0].forward == uses[1].forward {
            return Err(Refused::geometric_verdict(no("non-manifold-result").0));
        }
    }
    Ok(body)
}
pub(crate) fn subtract(key: BodyKey, target: &Solid, tools: &[Cylinder]) -> R<Body> {
    let base = match target {
        Solid::Planar(a) => Base::Planar(a.clone()),
        Solid::Cylinder(c) => Base::Cylinder(c.clone()),
        _ => return Err(no("target-carrier")),
    };
    if tools.is_empty() || tools.len() > 64 {
        return Err(no("tool-count"));
    }
    let operands = tools.iter().cloned().map(Base::Cylinder).collect::<Vec<_>>();
    let (pocket, holes, levels, meridians) = arrange(&base, &operands)?;
    if holes.is_empty() && meridians.is_empty() {
        return Ok(base.body().clone());
    }
    let (frames, nodes) = graft(&base, &operands)?;
    assemble(key, &base, &holes, pocket.as_ref(), &levels, &meridians, frames, nodes)
}
/// Planar or cylinder target minus cylinder and full-turn revolution tools.
pub(crate) fn subtract_tools(key: BodyKey, bodies: &[Solid]) -> R<Body> {
    let mut operands = bodies
        .iter()
        .map(|s| match s {
            Solid::Planar(p) => Ok(Base::Planar(p.clone())),
            Solid::Cylinder(c) => Ok(Base::Cylinder(c.clone())),
            Solid::Revolved(r) => Ok(Base::Revolved(Box::new(RevolvedTool {
                placement: Placement::from_frames(&r.body, FrameId(1))
                    .map_err(|_| no("revolved-tool-frame"))?,
                rev: r.clone(),
            }))),
            _ => Err(no("tool-carrier")),
        })
        .collect::<R<Vec<_>>>()?;
    if operands.len() < 2 || operands.len() > 65 {
        return Err(no("tool-count"));
    }
    let base = operands.remove(0);
    if matches!(base, Base::Revolved(_)) {
        return Err(no("target-carrier"));
    }
    if operands.iter().any(|b| matches!(b, Base::Planar(_))) {
        return Err(no("pocket-with-revolved-tool"));
    }
    let (pocket, holes, levels, meridians) = arrange(&base, &operands)?;
    if holes.is_empty() && meridians.is_empty() {
        return Ok(base.body().clone());
    }
    let (frames, nodes) = graft(&base, &operands)?;
    assemble(key, &base, &holes, pocket.as_ref(), &levels, &meridians, frames, nodes)
}
pub(crate) fn subtract_pocket(key: BodyKey, bodies: &[Solid]) -> R<Body> {
    let mut operands = bodies
        .iter()
        .map(|s| match s {
            Solid::Planar(p) => Ok(Base::Planar(p.clone())),
            Solid::Cylinder(c) => Ok(Base::Cylinder(c.clone())),
            _ => Err(no("pocket-operand")),
        })
        .collect::<R<Vec<_>>>()?;
    if operands.len() < 2 || operands.len() > 65 {
        return Err(no("tool-count"));
    }
    let base = operands.remove(0);
    let (pocket, holes, levels, meridians) = arrange(&base, &operands)?;
    let (frames, nodes) = graft(&base, &operands)?;
    assemble(key, &base, &holes, pocket.as_ref(), &levels, &meridians, frames, nodes)
}
type Arranged = (
    Option<crate::prism_pocket::Pocket>,
    Vec<Spec>,
    Vec<[Q; 2]>,
    Vec<crate::prism_holes_revolved::MeridianHole>,
);
fn arrange(base: &Base, operands: &[Base]) -> R<Arranged> {
    let polygon = operands
        .iter()
        .filter(|b| matches!(b, Base::Planar(_)))
        .cloned()
        .collect::<Vec<_>>();
    let tools = operands
        .iter()
        .filter_map(|b| {
            if let Base::Cylinder(c) = b {
                Some(c.clone())
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    let pocket = crate::prism_pocket::classify(base, &polygon)?;
    let holes = classify(base, &tools)?;
    let (mut holes, merged) = crate::prism_holes_revolved::coaxial_union(base, holes)?;
    if pocket.is_some() && !merged.is_empty() {
        return Err(no("pocket-with-revolved-tool"));
    }
    let levels = if pocket.is_some() {
        crate::prism_pocket::clip(pocket.as_ref(), &mut holes)?
    } else {
        holes
            .iter()
            .map(|s| {
                let k = s.axis().unwrap();
                [q(s.bottom[k]), q(s.top[k])]
            })
            .collect()
    };
    let revolved = operands
        .iter()
        .filter_map(|b| if let Base::Revolved(t) = b { Some(t.as_ref().clone()) } else { None })
        .collect::<Vec<_>>();
    if pocket.is_some() && !revolved.is_empty() {
        return Err(no("pocket-with-revolved-tool"));
    }
    let mut meridians = crate::prism_holes_revolved::classify(base, &revolved, &holes)?;
    crate::prism_holes_revolved::require_separated(&meridians, &merged)?;
    meridians.extend(merged);
    Ok((pocket, holes, levels, meridians))
}
pub fn audit(checked: &CheckedBody) -> R<PrismHoles> {
    let body = checked.body();
    let root = body
        .constructions
        .last()
        .ok_or_else(|| no("construction"))?;
    if !candidate(body)
        || root.parents.len() < 2
        || root.parents.len() > 65
        || root.parameters.len() != 1 + root.parents.len() * 3
        || root.parameters[0].get() != 1.
    {
        return Err(no("construction"));
    }
    let (mut operands, frame_at) = ungraft(body, &root.parameters[1..], &root.parents)?;
    let base = operands.remove(0);
    if root.frame != base.carrier_frame()? {
        return Err(no("construction-frame"));
    }
    let (pocket, holes, hole_levels, meridians) = arrange(&base, &operands)?;
    if holes.is_empty() && pocket.is_none() && meridians.is_empty() {
        return Err(no("no-hole"));
    }
    let expected = assemble(
        body.key.clone(),
        &base,
        &holes,
        pocket.as_ref(),
        &hole_levels,
        &meridians,
        body.frames[..frame_at].to_vec(),
        body.constructions.clone(),
    )?;
    if *body != expected {
        return Err(no("construction-carrier-mismatch"));
    }
    let caps = hole_caps(&base, pocket.as_ref(), &holes, &hole_levels)?;
    let meridian_caps = crate::prism_holes_revolved::caps(&base, &meridians)?;
    Ok(PrismHoles {
        body: body.clone(),
        base,
        holes,
        caps,
        pocket,
        hole_levels,
        meridians,
        meridian_caps,
        tools: operands,
    })
}
/// Rebuild every grafted operand from its (kind, frame count, node count)
/// descriptor, in operand order. Returns the operands and the number of
/// source frames; the Boolean root must be the only node after them.
pub(crate) fn ungraft(
    body: &Body,
    descriptors: &[Binary64],
    parents: &[NodeId],
) -> R<(Vec<Base>, usize)> {
    let mut frame_at = 0;
    let mut node_at = 0;
    let mut operands = vec![];
    for (i, desc) in descriptors.chunks_exact(3).enumerate() {
        let (kind, nf, nn) = (
            index(desc[0].get())?,
            index(desc[1].get())?,
            index(desc[2].get())?,
        );
        if nn == 0
            || nf < 2
            || node_at + nn >= body.constructions.len()
            || frame_at + nf > body.frames.len()
            || parents.get(i).map(|p| p.0 as usize) != Some(node_at + nn - 1)
        {
            return Err(no("source-layout"));
        }
        let mut frames = body.frames[frame_at..frame_at + nf].to_vec();
        for f in &mut frames {
            move_frame(f, frame_at as u32, false)?
        }
        let mut nodes = body.constructions[node_at..node_at + nn].to_vec();
        for n in &mut nodes {
            n.frame.0 = n
                .frame
                .0
                .checked_sub(frame_at as u32)
                .ok_or_else(|| no("source-layout"))?;
            for p in &mut n.parents {
                p.0 =
                    p.0.checked_sub(node_at as u32)
                        .ok_or_else(|| no("source-layout"))?
            }
        }
        operands.push(rebuild(body.key.clone(), kind as u32, frames, nodes)?);
        frame_at += nf;
        node_at += nn;
    }
    if node_at + 1 != body.constructions.len() {
        return Err(no("source-layout"));
    }
    Ok((operands, frame_at))
}
