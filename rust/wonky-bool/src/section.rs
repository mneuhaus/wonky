//! P4: plane x plane section pieces, trimmed at the P3 paves.
//!
//! For a candidate pair (A face `fa`, B face `fb`) whose carriers are
//! transverse, the section is `fa ∩ fb`, a closed subset of the relation's
//! line `L` (reused from P1, never re-derived). Its pieces are cut at the P3
//! paves and nowhere else:
//!
//! 1. the paves of `fa`'s and `fb`'s edges that satisfy both plane equations
//!    (so lie on `L`) and lie in both closed faces, ordered along `L`;
//! 2. between two consecutive such paves, the exact midpoint decides the
//!    whole open interval: it lies in both closed faces or the interval is
//!    not part of the section;
//! 3. a kept pave that ends no piece is an isolated contact point (`touches`).
//!
//! Why this is complete: along `L` the location in a face changes only where
//! `L` meets the face's boundary. Such a point `z` in the other closed face
//! is a pave: a vertex of either face; or an edge of one face crossing the
//! other face's plane at `z`, which is a V-E, E-E or E-F point on that edge
//! depending on where `z` lies in the other face; or, for an edge running
//! along `L`, a point where the other face's boundary meets it (V-E or E-E).
//! So no location changes inside an open interval between consecutive paves.
//!
//! Each piece carries a pcurve in each face's own chart (the chart of its
//! model frame), traversed along `L`'s direction `n_a x n_b`, and whether it
//! lies on the boundary of each face (then it splits nothing there).
use crate::operand::{Location, Operands, Side};
use crate::paves::{Paves, PointId};
use crate::relation::{PlaneRelation, RelationTable};
use num_traits::Zero;
use std::collections::BTreeSet;
use wonky_curve::{Carrier, ExactPoint, Trimmed};
use wonky_geom::model::FaceId;
use wonky_geom::{dot, sub, Point, Refused, Result, Q};

#[derive(Clone, Debug)]
pub struct Piece {
    /// Its ends, in the order of the line's direction.
    pub ends: [PointId; 2],
    /// It lies on the boundary of the A face / the B face.
    pub boundary: [bool; 2],
    /// Its pcurve in the A face's chart / the B face's chart.
    pub pcurves: [Trimmed; 2],
}

#[derive(Clone, Debug)]
pub struct Section {
    /// (A face, B face).
    pub faces: [FaceId; 2],
    /// The line `point + t direction` of the relation table.
    pub point: Point,
    pub direction: Point,
    /// Disjoint pieces in the order of `direction`.
    pub pieces: Vec<Piece>,
    /// Paves where the faces meet in an isolated point.
    pub touches: Vec<PointId>,
}

fn pcurve(ops: &Operands, side: Side, face: FaceId, ends: [&Point; 2]) -> Result<Trimmed> {
    let placed = ops.get(side);
    let chart = |x: &Point| placed.chart(face, x).map(ExactPoint::from_rational);
    Trimmed::new([chart(ends[0])?, chart(ends[1])?], Carrier::Line).map_err(|r| Refused(r.name()))
}

pub(crate) fn sections(
    ops: &Operands,
    relations: &RelationTable,
    candidates: &[[FaceId; 2]],
    paves: &Paves,
) -> Result<Vec<Section>> {
    let (a, b) = (ops.get(Side::A), ops.get(Side::B));
    let mut out = vec![];
    for &[fa, fb] in candidates {
        let surfaces = (a.model.draft().faces[fa.index()].surface, b.model.draft().faces[fb.index()].surface);
        let (point, direction) = match &relations.get(surfaces.0, surfaces.1).kind {
            PlaneRelation::Transverse { point, direction } => (point, direction),
            PlaneRelation::Identical | PlaneRelation::Opposite | PlaneRelation::ParallelDisjoint { .. } => continue,
        };
        let (pa, pb) = (a.face_plane(fa), b.face_plane(fb));
        let on_line = |x: &Point| pa.side(x).is_zero() && pb.side(x).is_zero();
        let mut candidates: BTreeSet<PointId> = BTreeSet::new();
        for (side, face) in [(Side::A, fa), (Side::B, fb)] {
            for e in &ops.get(side).face_edges[face.index()] {
                candidates.extend(paves.edges[side.index()][e.index()].iter().filter(|id| on_line(paves.point(**id))));
            }
        }
        let inside = |x: &Point| -> Result<[Location; 2]> { Ok([a.locate(fa, x)?, b.locate(fb, x)?]) };
        let mut kept: Vec<(Q, PointId)> = vec![];
        for id in candidates {
            let x = paves.point(id);
            if !inside(x)?.contains(&Location::Outside) {
                kept.push((dot(&sub(x, point), direction), id));
            }
        }
        kept.sort();
        let mut pieces = vec![];
        for w in kept.windows(2) {
            let (x, y) = (paves.point(w[0].1), paves.point(w[1].1));
            let two = Q::from_integer(2.into());
            let mid: Point = std::array::from_fn(|k| (&x[k] + &y[k]) / &two);
            let at = inside(&mid)?;
            if at.contains(&Location::Outside) {
                continue;
            }
            pieces.push(Piece {
                ends: [w[0].1, w[1].1],
                boundary: at.map(|l| l == Location::Boundary),
                pcurves: [pcurve(ops, Side::A, fa, [x, y])?, pcurve(ops, Side::B, fb, [x, y])?],
            });
        }
        let touches: Vec<PointId> = kept
            .iter()
            .map(|(_, id)| *id)
            .filter(|id| !pieces.iter().any(|p| p.ends.contains(id)))
            .collect();
        if !pieces.is_empty() || !touches.is_empty() {
            out.push(Section { faces: [fa, fb], point: point.clone(), direction: direction.clone(), pieces, touches });
        }
    }
    Ok(out)
}
