//! Solid copies under interpreter binary64 affine maps. Near-isometries include
//! rotations AND reflections, but the coefficient matrix is authoritative (E9),
//! never projected onto an ideal orthogonal matrix. Exact determinant signs
//! decide orientation; a singular map or an unsupported metric refuses by name.
use crate::placement::{Placement, Post};
use crate::polyhedron::{audit, Audited, Refused};
use wonky_contract::{BodyKey, FrameId};

pub fn copy(source: &Audited, key: BodyKey, rows: [[f64; 3]; 3], translation: [f64; 3]) -> Result<Audited, Refused> {
    place(source, key, &Post::Rows { translation, rows })
}

/// Place an already built (and possibly already placed) body by one more exact
/// map. The new frame is appended after the body's own frame chain, so the
/// result is the exact product of all placements (`Placement::from_frames`).
pub fn place(source: &Audited, key: BodyKey, post: &Post) -> Result<Audited, Refused> {
    // Its rounded display vertices cannot become authoritative prism inputs
    // through an affine wrapper; the rational chamfer replay must move too.
    if source.chamfer.is_some() { return Err(Refused("pattern/chamfer-placement-unimplemented".into())); }
    let body = place_body(&source.body, key, post)?;
    let checked = body.check().map_err(|e| Refused(format!("pattern/contract: {e:?}")))?;
    audit(&checked)
}

/// Source-frame modifying operations commute with an authenticated placement.
/// Entity indices stay fixed; coefficients are reapplied symbolically, never
/// rounded into fresh interpreter geometry.
pub(crate) fn modify(
    source: &Audited,
    operation: impl FnOnce(&Audited) -> Result<wonky_contract::Body, Refused>,
) -> Result<Option<wonky_contract::Body>, Refused> {
    let Some((inner, post)) = unplace(&source.body) else {
        return Ok(None);
    };
    crate::source_frame::SourceMetric::new(&source.frame)?;
    let inner = audit(
        &inner
            .check()
            .map_err(|e| Refused(format!("pattern/source-contract: {e:?}")))?,
    )?;
    let result = operation(&inner)?;
    Ok(Some(place_body(&result, result.key.clone(), &post)?))
}

/// Undo the last `place_body`: the body it was applied to and the map it used.
/// None unless the last frame is a post image whose every entity is bound to a
/// wrapper node of exactly that frame (what `place_body` produces).
pub(crate) fn unplace(body: &wonky_contract::Body) -> Option<(wonky_contract::Body, Post)> {
    use wonky_contract::{Frame, Operation, Provenance};
    let last = FrameId(body.frames.len().checked_sub(1)? as u32);
    let (base, post) = match body.frames.last()? {
        Frame::RationalImage { base, rows, denominator } => (*base, Post::Rational { rows: rows.map(|r|r.map(|v|v.get())), denominator: denominator.get() }),
        Frame::AffineImage { base, translation, rows } => (*base, Post::Rows {
            translation: translation.map(|c| c.get()),
            rows: rows.clone().map(|r| r.map(|c| c.get())),
        }),
        Frame::InterpreterImage { base, origin, x, z } => (*base, Post::Interpreter(crate::affine::Affine {
            origin: origin.map(|c| c.get()), x: x.map(|c| c.get()), z: z.map(|c| c.get()),
        })),
        Frame::Rigid { parent, translation, axis, angle } => {
            let k = angle.get() / std::f64::consts::FRAC_PI_2;
            if translation.map(|v| v.get()) != [0.;3] || axis.map(|v|v.get()) != [0.,0.,1.] || !(0. ..=3.).contains(&k) || k.fract() != 0. { return None; }
            (*parent, Post::LocalQuarter(k as u32))
        },
        Frame::Source { .. } | Frame::Interpreter { .. } => return None,
    };
    let first = body.constructions.iter()
        .position(|n| n.operation == (Operation::AffineTransform {}) && n.frame == last)?;
    let wrapper = |node: wonky_contract::NodeId| -> Option<wonky_contract::NodeId> {
        let n = body.constructions.get(node.0 as usize).filter(|_| node.0 as usize >= first)?;
        (n.operation == (Operation::AffineTransform {}) && n.frame == last && n.parents.len() == 1).then(|| n.parents[0])
    };
    let mut inner = body.clone();
    inner.frames.pop();
    inner.constructions.truncate(first);
    for v in &mut inner.vertices {
        v.frame = base;
        let Provenance::Construction { node } = &mut v.provenance else { continue };
        *node = wrapper(*node)?;
    }
    for c in &mut inner.curves {
        c.frame = base;
        let Provenance::Construction { node } = &mut c.provenance else { continue };
        *node = wrapper(*node)?;
    }
    for s in &mut inner.surfaces {
        s.frame = base;
        let Provenance::Construction { node } = &mut s.provenance else { continue };
        *node = wrapper(*node)?;
    }
    Some((inner, post))
}

/// The placed body itself, before its audit. Deterministic in (body, key, post),
/// so an audit can replay a placement from the unplaced body and compare.
pub(crate) fn place_body(source: &wonky_contract::Body, key: BodyKey, post: &Post) -> Result<wonky_contract::Body, Refused> {
    let mut body = source.clone();
    // Resource ceiling only, not a geometric envelope.
    if body.frames.len() >= 256 { return Err(Refused("pattern/frame-depth".into())); }
    let base = body.vertices[0].frame;
    let frame = FrameId(body.frames.len() as u32);
    body.frames.push(post.frame(base)?);
    body.key = key;
    for vertex in &mut body.vertices { vertex.frame = frame; }
    for curve in &mut body.curves { curve.frame = frame; }
    for surface in &mut body.surfaces { surface.frame = frame; }
    // Explicit lineage wrappers bind each copied entity to the transform frame;
    // source nodes and their inputs stay unchanged. No source fact is relabelled.
    use wonky_contract::{Construction, NodeId, Operation, Provenance};
    let mut wrappers = std::collections::BTreeMap::new();
    for provenance in body.vertices.iter_mut().map(|v| &mut v.provenance)
        .chain(body.curves.iter_mut().map(|c| &mut c.provenance))
        .chain(body.surfaces.iter_mut().map(|s| &mut s.provenance)) {
        if let Provenance::Construction { node } = provenance {
            let parent = *node;
            let copied = *wrappers.entry(parent.0).or_insert_with(|| {
                let id = NodeId(body.constructions.len() as u32);
                body.constructions.push(Construction { operation: Operation::AffineTransform {}, rule_version: 1, parents: vec![parent], parameters: vec![], frame });
                id
            });
            *node = copied;
        }
    }
    // Refuse non-isometric metrics, without changing any coefficient. All
    // accepted geometry is still the exact affine image, including its defect.
    let map = Placement::from_frames(&body, frame).map_err(|_| Refused("pattern/numeric-range".into()))?;
    if map.orthonormality_defect().map_err(|_| Refused("pattern/numeric-range".into()))? > 1e-9 {
        return Err(Refused("pattern/metric-not-near-isometric".into()));
    }
    Ok(body)
}

/// Source-relative R is valid in the requested chart F only when the exact
/// relative map H=F^-1 M commutes with R: M R = F R F^-1 M.
pub(crate) fn require_local_chart(body: &wonky_contract::Body, chart: crate::affine::Affine, k: u32) -> Result<(), Refused> {
    use wonky_contract::Frame;
    let id = body.constructions.last().ok_or_else(|| Refused("placement/missing-source".into()))?.frame;
    let m = Placement::from_frames(body,id).map_err(|_| Refused("placement/source-range".into()))?.exact_frame()?;
    let mut source = body.clone();
    source.frames = vec![Frame::Source { source:[0;4] }, Post::Interpreter(chart).frame(FrameId(0))?];
    // InterpreterImage under Source is handled by the same exact composition.
    let f = Placement::from_frames(&source,FrameId(1)).map_err(|_| Refused("placement/chart-range".into()))?.exact_frame()?;
    let h = f.relation_from(&m).map;
    let q = |x:f64| num_rational::BigRational::from_float(x).unwrap();
    let (c,s) = [(1.,0.),(0.,1.),(-1.,0.),(0.,-1.)][k as usize];
    let r = wonky_geom::frame::Frame::new([q(0.),q(0.),q(0.)], [[q(c),q(s),q(0.)],[q(-s),q(c),q(0.)],[q(0.),q(0.),q(1.)]]).unwrap();
    if r.point(h.origin()) != *h.origin() || h.columns().iter().enumerate().any(|(i,col)| r.vector(col) != h.vector(&r.columns()[i])) {
        return Err(Refused("placement/source-chart-mismatch".into()));
    }
    Ok(())
}
