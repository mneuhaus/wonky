//! wonky-bool: the general exact 3D Boolean on `wonky_geom::model::Model`s
//! (boolean3d plan, decision C19: its own crate, testable without WC0).
//!
//! **Stage A0, strands G2-G5 (dark).** For two planar Models,
//! [`intersect`] runs the first pipeline stages and decides every fact once,
//! in increasing dimension (plan rule X2); [`split`] adds the face split,
//! [`boolean`] classification, selection and sewing into a checked Model,
//! and [`fold`] the n-ary FeatureScript Boolean:
//!
//! | stage | module | output |
//! |---|---|---|
//! | P0 admission | `operand` | both operands' vertices, edges and planes in ONE working frame (A's model frame); B is carried there by the exact frame relation of the two placements (Rule P: any exact affine map preserves planes) |
//! | P1 relation table | `relation` | per carrier pair: identical, opposite, parallel-disjoint (with the exact squared gap) or transverse (with the exact section line); by provenance where the lineage proves identity, always on exact data |
//! | P2 candidates | `boxes` | face pairs whose certified boxes meet |
//! | P3 interference | `paves` | V-V, V-E, E-E, V-F, E-F in this order; the paves of every edge in exact order |
//! | P4 section | `section` | the plane x plane pieces of every transverse candidate pair, trimmed at the P3 paves, with a pcurve in each face's own chart |
//! | P5 split | `split` | per face of both operands: one `wonky-curve` arrangement of its old trims (cut at the paves) and its section pieces in its own chart; cells with nested holes, a strict interior witness per cell, the fragments that lie in the face, and the section pieces that split nothing (slits) |
//! | P6 classify | `classify` | every fragment IN, OUT, ON-same or ON-opposite against the other operand: coplanar faces, exact local side tests at section pieces, propagation across old edge sub-ranges, one exact ray per component without a seed; a second opinion (direct ray membership) on every fragment |
//! | P7 assemble | `assemble` | the corrected Mantyla selection, sewing by P3 point identity, FeatureScript semantics (`empty-result`, `non-manifold-result`), shells by edge connection, voids nested by exact membership, one checked Model |
//! | P8 merge + resolution | `merge`, `resolution` | proved-identical oriented carriers merged, degree-two line subdivisions removed, exact edge extents and nonincident clearances certified against C9 source-coordinate rounding; approximation budget inactive for analytic lines |
//!
//! **Exactness (rules X1, X3/E4).** Every decision is an exact rational
//! test on construction data in the working frame. The frame relation of the
//! operands is exact (`wonky_geom::frame`), so a relation decided here is a
//! proof on the E9 values: a proved gap stays a gap at any size, and contact
//! holds only when the exact data are equal. The only binary64 values are
//! the certified boxes of P2 and of the curve arrangement, rounded outward
//! or monotonically from exact values; they only ever prove disjointness (a
//! strict inequality), never an equality or an order. World caches are never
//! read.
//!
//! **Contracts.** Each stage checks its output on every run and fails
//! closed with `boolean/contract-violation:<stage>/<check>` ([`contract`]).
//! A violation is a kernel defect, never an expected outcome.
//!
//! **Normalization.** After P7's contact and manifold checks, emitted Models
//! merge edge-connected coplanar faces and remove globally degree-two collinear
//! vertices with exact predicates. `resolution::certify` then checks the exact
//! planar feature sizes before any successful output. Raw `Assembly` retains the classified source
//! faces for diagnostics; Models and `Output::solids` are normalized. Pinched
//! face boundaries still refuse `boolean/merge-unavailable:pinched-face`.
//! This crate is not reachable from FeatureScript: only the opt-in shadow harness
//! of wonky-ops (`WONKY_BOOLEAN_SHADOW=1`) calls [`fold_models`]; G7 is the strand that
//! routes a Boolean here. Curved carriers
//! and vertex-free rings use the dark G10 carrier-fragment path in [`curved`].
//! Earlier A0 stages still refuse curved admission by name. Every match on
//! `Carrier3`, `Curve3` and `Bounds` here is exhaustive, without a `_` arm.
#![deny(unused_must_use)]

pub mod a1;
pub mod curved;
pub mod periodic;
pub mod sphere;
pub mod assemble;
pub mod boxes;
pub mod classify;
pub mod contract;
mod merge;
pub mod resolution;
pub mod operand;
pub mod paves;
pub mod relation;
pub mod section;
pub mod split;

pub use assemble::{keep, Assembly, Op, ResultFace};
pub use boxes::CertifiedBox;
pub use classify::{Class, Decided, Fragment};
pub use operand::{Lineage, Location, Side};
pub use paves::{EdgeCrossing, EdgeThroughFace, Paves, PointId, VertexOnEdge, VertexOnFace};
pub use relation::{PlaneRelation, Proof, Relation, RelationTable};
pub use section::{Piece, Section};
pub use split::{FaceSplit, Leaf, Slit, Source};

use operand::Operands;
use wonky_geom::frame::RelationClass;
use wonky_geom::model::{FaceId, Model};
use wonky_geom::{Refused, Result};

/// Everything stages P0-P4 decided for one operand pair. Points are exact
/// and in the working frame (A's model frame); B's own frame is reached by
/// the inverse of the exact frame relation.
#[derive(Clone, Debug)]
pub struct Intersection {
    /// Class of the exact map from B's model frame to A's.
    pub frame: RelationClass,
    /// P1: one relation per carrier pair (A surface, B surface).
    pub relations: RelationTable,
    /// P2: (A face, B face) pairs whose certified boxes meet, in order.
    pub candidates: Vec<[FaceId; 2]>,
    /// P3: vertex identities, interferences and the ordered paves of every edge.
    pub paves: Paves,
    /// P4: one entry per transverse candidate pair with a non-empty section.
    pub sections: Vec<Section>,
}

/// Stages P0-P5 for one operand pair.
#[derive(Clone, Debug)]
pub struct Split {
    pub intersection: Intersection,
    /// P5: per operand, per face (in the model's face order): its split.
    pub faces: [Vec<FaceSplit>; 2],
}

fn stages<'m>(a: &'m Model, b: &'m Model, lineage: Lineage) -> Result<(Operands<'m>, Intersection)> {
    let ops = operand::admit(a, b, lineage)?;
    let relations = relation::table(&ops)?;
    let boxes = boxes::Boxes::of(&ops)?;
    let candidates = boxes.face_pairs();
    let paves = paves::interfere(&ops, &boxes)?;
    let sections = section::sections(&ops, &relations, &candidates, &paves)?;
    let ix = Intersection { frame: ops.frame, relations, candidates, paves, sections };
    Ok((ops, ix))
}

/// Stages P0-P4 of the Boolean of `a` and `b` (planar Models). `lineage`
/// says whether the provenance node ids of both models index one
/// construction DAG; only then can provenance prove a carrier identity.
pub fn intersect(a: &Model, b: &Model, lineage: Lineage) -> Result<Intersection> {
    Ok(stages(a, b, lineage)?.1)
}

/// Stages P0-P5: [`intersect`], then every face of both operands split in
/// its own chart.
pub fn split(a: &Model, b: &Model, lineage: Lineage) -> Result<Split> {
    let (ops, intersection) = stages(a, b, lineage)?;
    let faces = split::faces(&ops, &intersection)?;
    Ok(Split { intersection, faces })
}

/// Stages P0-P7 of one Boolean: everything it decided, and its result.
#[derive(Clone, Debug)]
pub struct Output {
    pub split: Split,
    /// P6: every fragment of both operands with its class.
    pub fragments: Vec<Fragment>,
    /// P7: the kept faces, sewn into shells and solids.
    pub assembly: Assembly,
    /// Every solid of the result in one checked Model, in the working frame
    /// (A's model frame) with A's placement.
    pub model: Model,
}

impl Output {
    /// One checked Model per solid of the result (an outer shell with its
    /// voids), in the order of `Assembly::solids`.
    pub fn solids(&self) -> Result<Vec<Model>> {
        let d = self.model.draft();
        let node = d.solids[0].provenance.node;
        (0..self.assembly.solids.len())
            .map(|s| self.assembly.model(&self.split.intersection.paves.points, d.placement.clone(), d.label, node, Some(s)))
            .collect()
    }
}

/// Stages P0-P7 of `a op b`: split, classify (with the second opinion on
/// every fragment), select, sew, nest and emit. Topology of the result is
/// created by construction node `node`. FeatureScript semantics: an empty
/// result refuses `boolean/empty-result`, a non-manifold one
/// `boolean/non-manifold-result`.
/// No-Claim of fillets3d F2 / boolean3d G20: a torus carrier has no SSI
/// row yet, so a Boolean with a torus-faced operand refuses by name before
/// any stage runs (`torus×<the other operand's first carrier kind>`).
pub fn torus_guard(a: &Model, b: &Model) -> Result<()> {
    use wonky_geom::model::Carrier3;
    let kind = |c: &Carrier3| match c {
        Carrier3::Plane(_) | Carrier3::RadicalPlane(_) => "plane",
        Carrier3::Cylinder(_) | Carrier3::TranslatedCylinder(_) => "cylinder",
        Carrier3::Cone(_) => "cone",
        Carrier3::Sphere(_) => "sphere",
        Carrier3::Torus(_) => "torus",
        Carrier3::Rotated(_) => "rotated",
    };
    let torus = |m: &Model| m.draft().surfaces.iter().any(|s| matches!(s.carrier, Carrier3::Torus(_)));
    for (t, other) in [(a, b), (b, a)] {
        if torus(t) {
            let o = other
                .draft()
                .surfaces
                .iter()
                .map(|s| kind(&s.carrier))
                .find(|k| *k != "plane")
                .unwrap_or("plane");
            return Err(Refused(match o {
                "plane" => "boolean/ssi-row-unavailable:torus×plane",
                "cylinder" => "boolean/ssi-row-unavailable:torus×cylinder",
                "cone" => "boolean/ssi-row-unavailable:torus×cone",
                "sphere" => "boolean/ssi-row-unavailable:torus×sphere",
                _ => "boolean/ssi-row-unavailable:torus×torus",
            }));
        }
    }
    Ok(())
}
pub fn boolean(a: &Model, b: &Model, op: Op, lineage: Lineage, node: u32) -> Result<Output> {
    torus_guard(a, b)?;
    let (ops, intersection) = stages(a, b, lineage)?;
    let faces = split::faces(&ops, &intersection)?;
    let fragments = classify::classify(&ops, &intersection, &faces)?;
    let assembly = assemble::assemble(&ops, &intersection, &faces, &fragments, op)?;
    let label = a.draft().label.max(b.draft().label);
    let model = assembly.model(&intersection.paves.points, a.draft().placement.clone(), label, node, None)?;
    Ok(Output { split: Split { intersection, faces }, fragments, assembly, model })
}

/// An n-ary FeatureScript Boolean as a left fold: union and intersection of
/// all operands in order, subtraction of every later operand from the
/// first. An empty or non-manifold intermediate result refuses with its
/// FeatureScript code (No-Claim: a simultaneous evaluation could still
/// build where an intermediate union touches itself along an edge that a
/// later operand fills).
pub fn fold(op: Op, operands: &[&Model], node: u32) -> Result<Output> {
    let [first, second, rest @ ..] = operands else { return Err(Refused("boolean/operand-count")) };
    let mut out = boolean(first, second, op, Lineage::Separate, node)?;
    for m in rest {
        out = boolean(&out.model, m, op, Lineage::Separate, node)?;
    }
    Ok(out)
}

/// General checked solid results. Curved operands enter the carrier-fragment
/// pipeline; line-trimmed planes retain the established A0 pipeline.
/// This is the dark comparison entrypoint, without production routing.
pub fn fold_models(op: Op, operands: &[&Model], node: u32) -> Result<Vec<Model>> {
    let [first, rest @ ..] = operands else {
        return Err(Refused("boolean/operand-count"));
    };
    let mut solids = vec![(*first).clone()];
    for other in rest {
        // A multi-solid result is retained as one checked operand so the next
        // subtraction/intersection sees the entire exact point set.
        let own = if solids.len() == 1 {
            solids[0].clone()
        } else {
            combine_models(&solids)?
        };
        torus_guard(&own, other)?;
        // A closed sphere has no curve at all: its carrier routes it.
        let curved = [&own, *other].iter().any(|m| {
            m.draft()
                .curves
                .iter()
                .any(|c| matches!(c.geometry, wonky_geom::model::Curve3::Circle(_)))
                || m.draft().surfaces.iter().any(|s| matches!(s.carrier, wonky_geom::model::Carrier3::Sphere(_)))
        });
        solids = if curved {
            curved::boolean(&own, other, op, node)?
        } else {
            boolean(&own, other, op, Lineage::Separate, node)?.solids()?
        };
    }
    Ok(solids)
}
/// One checked Model holding every solid of `models` (in the first one's frame).
pub fn combine_models(models: &[Model]) -> Result<Model> {
    use wonky_geom::model::*;
    let mut d = models[0].clone().into_draft();
    for m in &models[1..] {
        let m = m.reframed(&d.placement)?;
        let mut next = m.into_draft();
        let (su, cu, ve, ed, co, lo, fa, sh) = (
            d.surfaces.len() as u32,
            d.curves.len() as u32,
            d.vertices.len() as u32,
            d.edges.len() as u32,
            d.coedges.len() as u32,
            d.loops.len() as u32,
            d.faces.len() as u32,
            d.shells.len() as u32,
        );
        for e in &mut next.edges {
            e.curve.0 += cu;
            if let Bounds::Segment(vs) = &mut e.bounds {
                for v in vs {
                    v.0 += ve;
                }
            }
        }
        for c in &mut next.coedges {
            c.edge.0 += ed;
        }
        for l in &mut next.loops {
            for c in &mut l.coedges {
                c.0 += co;
            }
        }
        for f in &mut next.faces {
            f.surface.0 += su;
            for l in &mut f.loops {
                l.0 += lo;
            }
        }
        for s in &mut next.shells {
            for f in &mut s.faces {
                f.0 += fa;
            }
        }
        for s in &mut next.solids {
            for shell in &mut s.shells {
                shell.0 += sh;
            }
        }
        d.surfaces.extend(next.surfaces);
        d.curves.extend(next.curves);
        d.vertices.extend(next.vertices);
        d.edges.extend(next.edges);
        d.coedges.extend(next.coedges);
        d.loops.extend(next.loops);
        d.faces.extend(next.faces);
        d.shells.extend(next.shells);
        d.solids.extend(next.solids);
    }
    d.check()
}
