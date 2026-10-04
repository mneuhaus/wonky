//! Complete cap-paired Model replacement for parallel line/cylinder generators.
//! Source support charts, not WC0 caches or a shape-family tag, authorize it.
use crate::{profile, Refusal, Result};
use wonky_curve::{self as wc, radical::Radical, ExactPoint, Trimmed};
use wonky_geom::model::quadratic_extrusion::{self as qe, SectionCircle, SectionPiece};
use wonky_geom::model::{extrusion, Bounds, Curve3, EdgeId, Model};
use wonky_geom::Q;
fn no(s: &str) -> Refusal {
    Refusal(format!("profile-blend/{s}"))
}
#[derive(Clone, Debug)]
pub struct Replacement {
    pub model: Model,
    pub section: Vec<SectionPiece>,
    pub levels: [Q; 2],
    pub convex_joints: bool,
}
impl Replacement {
    /// Explicit compatibility boundary for the legacy rational-centre wire
    /// profile. A refusal here does not erase the constructed exact Model.
    pub fn legacy_pieces(&self) -> Result<Vec<Trimmed>> {
        self.section
            .iter()
            .map(|p| p.legacy().map_err(Into::into))
            .collect()
    }
}
/// All caps and walls are replaced together, then checked by the shared G1–G8
/// audit. Retained support intervals must remain ordered and the complete
/// resulting cap must be simple: local tangent incidence alone cannot admit it.
pub fn replace(
    input: &Model,
    selected: &[EdgeId],
    width: &Q,
    fillet: bool,
    node: u32,
) -> Result<Replacement> {
    wc::radical::guard(|| build(input, selected, width, fillet, node)).map_err(Refusal::from)?
}
fn build(
    input: &Model,
    selected: &[EdgeId],
    width: &Q,
    fillet: bool,
    node: u32,
) -> Result<Replacement> {
    if selected.is_empty() {
        return Err(no("empty-selection"));
    }
    if !input.draft().placement.is_isometry() {
        return Err(no("non-isometric-source-metric"));
    }
    let (source, levels) = extrusion::section(input)?;
    let source = coalesced(
        source
            .iter()
            .map(SectionPiece::from_piece)
            .collect::<std::result::Result<Vec<_>, _>>()?,
    )?
    .iter()
    .map(SectionPiece::legacy)
    .collect::<std::result::Result<Vec<_>, _>>()?;
    let n = source.len();
    let mut ends = source.iter().map(|s| s.ends().clone()).collect::<Vec<_>>();
    let mut joints = vec![None; n];
    let mut convex_joints = true;
    for &id in selected {
        let edge = input
            .draft()
            .edges
            .get(id.index())
            .ok_or_else(|| no("edge-index"))?;
        if !matches!(
            input.draft().curves[edge.curve.index()].geometry,
            Curve3::Line { .. } | Curve3::RadicalLine { .. }
        ) {
            return Err(no("requires-line-generators"));
        }
        let Bounds::Segment(v) = edge.bounds else {
            return Err(no("requires-line-generators"));
        };
        let [a, b] = v.map(|v| input.key(v).coordinates());
        if a[0] != b[0]
            || a[1] != b[1]
            || !((a[2] == Radical::from(levels[0].clone())
                && b[2] == Radical::from(levels[1].clone()))
                || (b[2] == Radical::from(levels[0].clone())
                    && a[2] == Radical::from(levels[1].clone())))
        {
            return Err(no("nonparallel-or-incomplete-generator"));
        }
        let xy = ExactPoint::from_coordinates([a[0].clone(), a[1].clone()])?;
        let k = source
            .iter()
            .position(|s| s.ends()[0] == xy)
            .ok_or_else(|| no("selection-not-on-cap"))?;
        if joints[k].is_some() {
            continue;
        }
        let prev = (k + n - 1) % n;
        let joint = profile::construct(&source[prev], &source[k], width, fillet)?;
        convex_joints &= joint.convex;
        let section = SectionPiece {
            ends: joint.springs.clone(),
            circle: match &joint.carrier {
                profile::Carrier::Plane => None,
                profile::Carrier::Cylinder {
                    center,
                    radius2,
                    convex,
                } => Some(SectionCircle {
                    center: center.clone(),
                    radius2: radius2.clone(),
                    anchor: None,
                    ccw: *convex,
                }),
            },
        };
        ends[prev][1] = joint.springs[0].clone();
        ends[k][0] = joint.springs[1].clone();
        joints[k] = Some(section);
    }
    let mut pieces = vec![];
    for k in 0..n {
        if ends[k][0] == ends[k][1] {
            return Err(no("adjacent-face-consumed"));
        }
        let ordered = source[k].sorted_cuts(vec![ends[k][0].clone(), ends[k][1].clone()])?;
        if ordered != ends[k] {
            return Err(no("adjacent-face-consumed"));
        }
        if let Some(joint) = joints[k].take() {
            pieces.push(joint);
        }
        pieces.push(SectionPiece::from_piece(
            &source[k].trim(ends[k][0].clone(), ends[k][1].clone())?,
        )?);
    }
    // Remove construction-only circle chart subdivisions from the returned
    // section. Model creates its own safe charts; WC0 keeps analytic supports.
    let pieces = coalesced(pieces)?;
    let model = qe::profile(
        input.draft().placement.clone(),
        input.draft().label,
        node,
        &pieces,
        levels.clone(),
    )?
    .check()?;
    Ok(Replacement {
        model,
        section: pieces,
        levels,
        convex_joints,
    })
}

fn coalesced(pieces: Vec<SectionPiece>) -> Result<Vec<SectionPiece>> {
    let mut merged: Vec<SectionPiece> = vec![];
    for piece in pieces {
        if merged
            .last()
            .is_some_and(|prev| prev.circle.is_some() && prev.circle == piece.circle)
        {
            let prev = merged.last_mut().unwrap();
            prev.ends[1] = piece.ends[1].clone();
        } else {
            merged.push(piece);
        }
    }
    Ok(merged)
}
