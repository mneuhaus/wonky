//! Solid copies under interpreter binary64 affine maps. Near-isometries include
//! rotations AND reflections, but the coefficient matrix is authoritative (E9),
//! never projected onto an ideal orthogonal matrix. Exact determinant signs
//! decide orientation; a singular map or an unsupported metric refuses by name.
use crate::placement::Placement;
use crate::polyhedron::{audit, Audited, Refused};
use wonky_contract::{Binary64, BodyKey, Frame, FrameId};

pub fn copy(source: &Audited, key: BodyKey, rows: [[f64; 3]; 3], translation: [f64; 3]) -> Result<Audited, Refused> {
    // Its rounded display vertices cannot become authoritative prism inputs
    // through an affine wrapper; the rational chamfer replay must move too.
    if source.chamfer.is_some() { return Err(Refused("pattern/chamfer-placement-unimplemented".into())); }
    if crate::planar_boolean::candidate(&source.body) { return Err(Refused("pattern/arranged-placement-unsupported".into())); }
    let mut body = source.body.clone();
    // Resource ceiling only, not a geometric envelope.
    if body.frames.len() >= 256 { return Err(Refused("pattern/frame-depth".into())); }
    let b = |x| Binary64::new(x).map_err(|e| Refused(format!("pattern/coefficient: {e:?}")));
    let v = |a: [f64;3]| Ok([b(a[0])?, b(a[1])?, b(a[2])?]);
    let base = body.vertices[0].frame;
    let frame = FrameId(body.frames.len() as u32);
    body.frames.push(Frame::AffineImage { base, translation: v(translation)?, rows: [v(rows[0])?, v(rows[1])?, v(rows[2])?] });
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
    let checked = body.check().map_err(|e| Refused(format!("pattern/contract: {e:?}")))?;
    audit(&checked)
}
