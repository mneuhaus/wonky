//! P5: planar face split.
//!
//! Every face of both operands is split in its OWN chart (its model frame and
//! `Plane3::chart`) by one `wonky-curve` arrangement (`arrange_pieces`) of
//!
//! 1. its old trims: each coedge's pcurve cut at the P3 paves of its edge,
//!    one leaf per loop, outer loop first (these sub-ranges are what the
//!    later sewing identifies edges by);
//! 2. its section pieces: the P4 pieces of every section of this face, in
//!    this face's chart, one leaf per section.
//!
//! Nothing is re-derived (rule X2): the arrangement only has to find the
//! contacts P3 and P4 recorded, and a contact it finds anywhere else is a
//! contract violation. Holes of the face and closed section loops inside it
//! nest by the arrangement's innermost-containing-cell rule.
//!
//! **Slits.** Section pieces that bound no area, i.e. trees of pieces (an
//! edge of the other operand lying in the face and touching it from one
//! side), do not split the face. They are found by removing section pieces
//! with an end of degree one until none is left, and kept as `slits`; the
//! isolated touch points of P4 are kept as `touches`.
//!
//! **Witnesses.** Each bounded cell gets an exact rational witness
//! (`Arrangement::witness`) strictly inside it and off every slit and touch
//! point. A cell is a fragment of the face when the face's loops wind around
//! its witness; the other cells are the face's holes.
//!
//! **Contracts** (every run, `boolean/contract-violation:split/<check>`):
//! `unrecorded-contact` (the arrangement cut a source piece: a contact P3/P4
//! did not record), `contact` (two pieces, slits included, meet away from a
//! shared end), `half-edge-cycles` (each half-edge in exactly one cycle of
//! the cell on its left, and the unbounded side is exactly the outer loop's
//! exterior), `orientation` (exact Green sign: a cell's outer cycle
//! counter-clockwise, its holes clockwise), `witness` (strictly inside its
//! cell and outside every other cell by exact winding, on no piece, slit or
//! touch point), `membership` (the fragments are the cells the face winds
//! around, and every other cell is bounded by hole loops alone, i.e. is a
//! hole) and `euler` (`V - E + F - R = 1` in the chart, `R` the inner cycles
//! of all cells). `chart-identity` guards the premise that each chart point
//! is one P3 point and that the pcurve ends are the chart points of their
//! paves; the model audit (G3 pcurve-curve consistency) already implies it
//! for every checked Model.
//!
//! **No-Claim.** Planar faces with line trims only reach here (the planar
//! Models of stage A0). Vertex-free rings and curved charts are G8; a cell
//! bounded by arcs gets a witness only where the probe meets them rationally
//! (else the storage refusal of `wonky-curve`). Nothing is classified (G4).
use crate::contract;
use crate::operand::{Operands, Side};
use crate::Intersection;
use crate::paves::PointId;
use std::collections::{BTreeMap, BTreeSet};
use wonky_curve::{arrange_pieces, Arrangement, Budget, Cycle, ExactPoint, Refusal, TrimKey, Trimmed, UNBOUNDED};
use wonky_geom::model::{CoedgeId, FaceId};
use wonky_geom::{Refused, Result};

/// Work limits of one face's arrangement (rule X5: a budget ends in a named
/// refusal). A face split cuts no source, so pieces never exceed sources.
pub const BUDGET: Budget = Budget { segments: 4096, pieces: 4096 };
const BUDGET_EXCEEDED: &str = "boolean/budget-exceeded:split-pieces";

fn curve(r: Refusal) -> Refused {
    match r {
        Refusal::ArrangementBudget | Refusal::ArrangementSplitBudget => Refused(BUDGET_EXCEEDED),
        other => Refused(other.name()),
    }
}

/// Where a chart piece comes from.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Source {
    /// The sub-range between two consecutive P3 paves of an old edge, as
    /// coedge `coedge` uses it (`ends` in the coedge's direction).
    Old { coedge: CoedgeId, ends: [PointId; 2] },
    /// Piece `piece` of `Intersection::sections[section]`.
    Section { section: usize, piece: usize },
}

/// One owner of arrangement pieces: a loop of the face or a section that
/// cuts it. Source index `i` of an arrangement owner is `sources[i]`, with
/// its chart piece `pieces[i]` (in the coedge's or the section's direction).
#[derive(Clone, Debug)]
pub struct Leaf {
    pub sources: Vec<Source>,
    pub pieces: Vec<Trimmed>,
}

/// A section piece that bounds no cell (canonical orientation), with every
/// section that produced it.
#[derive(Clone, Debug)]
pub struct Slit {
    pub piece: Trimmed,
    pub sources: Vec<Source>,
}

/// One face of one operand, split.
#[derive(Clone, Debug)]
pub struct FaceSplit {
    pub side: Side,
    pub face: FaceId,
    /// The face's `forward` flag: its outer loop runs counter-clockwise in
    /// the chart when set, clockwise otherwise.
    pub forward: bool,
    /// The arrangement in the face's chart.
    pub arrangement: Arrangement,
    /// Per arrangement vertex: its P3 point.
    pub points: Vec<PointId>,
    /// Arrangement owners: the face's loops (the first `loops`, outer loop
    /// first), then each section with a piece that splits the face.
    pub leaves: Vec<Leaf>,
    pub loops: usize,
    pub slits: Vec<Slit>,
    /// Isolated contact points of the face with the other operand.
    pub touches: Vec<ExactPoint>,
    /// Per cell: an exact point strictly inside it.
    pub witnesses: Vec<ExactPoint>,
    /// The cells that lie in the face (the others are its holes).
    pub fragments: Vec<usize>,
}

/// Chart points of P3 points on one face, each chart point one P3 point.
struct Charts<'a, 'm> {
    ops: &'a Operands<'m>,
    ix: &'a Intersection,
    side: Side,
    face: FaceId,
    known: BTreeMap<ExactPoint, PointId>,
}

impl Charts<'_, '_> {
    fn at(&mut self, id: PointId) -> Result<ExactPoint> {
        let p = ExactPoint::from_rational(self.ops.get(self.side).chart(self.face, self.ix.paves.point(id))?);
        if *self.known.entry(p.clone()).or_insert(id) != id {
            return Err(Refused(contract::SPLIT_CHART_IDENTITY));
        }
        Ok(p)
    }
}

/// P5 for every face of both operands.
pub(crate) fn faces(ops: &Operands, ix: &Intersection) -> Result<[Vec<FaceSplit>; 2]> {
    let one = |side: Side| {
        (0..ops.get(side).model.draft().faces.len())
            .map(|f| face(ops, ix, side, FaceId(f as u32)))
            .collect::<Result<Vec<_>>>()
    };
    Ok([one(Side::A)?, one(Side::B)?])
}

fn face(ops: &Operands, ix: &Intersection, side: Side, f: FaceId) -> Result<FaceSplit> {
    let d = ops.get(side).model.draft();
    let face = &d.faces[f.index()];
    let mut charts = Charts { ops, ix, side, face: f, known: BTreeMap::new() };

    // Old trims, cut at the paves of their edges.
    let mut leaves = vec![];
    for l in &face.loops {
        let mut leaf = Leaf { sources: vec![], pieces: vec![] };
        for &c in &d.loops[l.index()].coedges {
            let co = &d.coedges[c.index()];
            let mut ids = ix.paves.edges[side.index()][co.edge.index()].clone();
            if !co.forward {
                ids.reverse();
            }
            let points = ids.iter().map(|&id| charts.at(id)).collect::<Result<Vec<_>>>()?;
            let ends = co.pcurve.ends();
            if points.first() != Some(&ends[0]) || points.last() != Some(&ends[1]) || !points.iter().map(|p| co.pcurve.contains(p).map_err(curve)).collect::<Result<Vec<_>>>()?.into_iter().all(|on| on) {
                return Err(Refused(contract::SPLIT_CHART_IDENTITY));
            }
            for (p, id) in points.windows(2).zip(ids.windows(2)) {
                leaf.sources.push(Source::Old { coedge: c, ends: [id[0], id[1]] });
                leaf.pieces.push(co.pcurve.trim(p[0].clone(), p[1].clone()).map_err(curve)?);
            }
        }
        leaves.push(leaf);
    }
    let loops = leaves.len();

    // Section pieces and touch points of this face.
    let mut cuts: Vec<Leaf> = vec![];
    let mut touches: BTreeSet<ExactPoint> = BTreeSet::new();
    for (si, s) in ix.sections.iter().enumerate() {
        if s.faces[side.index()] != f {
            continue;
        }
        let mut leaf = Leaf { sources: vec![], pieces: vec![] };
        for (pi, piece) in s.pieces.iter().enumerate() {
            let pcurve = &piece.pcurves[side.index()];
            if pcurve.ends() != &[charts.at(piece.ends[0])?, charts.at(piece.ends[1])?] {
                return Err(Refused(contract::SPLIT_CHART_IDENTITY));
            }
            leaf.sources.push(Source::Section { section: si, piece: pi });
            leaf.pieces.push(pcurve.clone());
        }
        for &t in &s.touches {
            touches.insert(charts.at(t)?);
        }
        cuts.push(leaf);
    }

    // Trees of section pieces split nothing: prune them into slits.
    let slit_keys = trees(&leaves, &cuts, &charts.known)?;
    let mut slits: BTreeMap<TrimKey, Slit> = BTreeMap::new();
    for cut in cuts {
        let mut kept = Leaf { sources: vec![], pieces: vec![] };
        for (source, piece) in cut.sources.into_iter().zip(cut.pieces) {
            let (canonical, _) = piece.canonical();
            let key = canonical.key();
            if slit_keys.contains(&key) {
                slits.entry(key).or_insert_with(|| Slit { piece: canonical, sources: vec![] }).sources.push(source);
            } else {
                kept.sources.push(source);
                kept.pieces.push(piece);
            }
        }
        if !kept.pieces.is_empty() {
            leaves.push(kept);
        }
    }
    let slits: Vec<Slit> = slits.into_values().collect();
    let touches: Vec<ExactPoint> = touches.into_iter().collect();

    let sets: Vec<&[Trimmed]> = leaves.iter().map(|l| l.pieces.as_slice()).collect();
    let arrangement = arrange_pieces(&sets, BUDGET).map_err(curve)?;
    #[cfg(feature = "plant_split_hole_in_two_cells")]
    let arrangement = plant_hole_in_two_cells(arrangement);
    let points = arrangement
        .points
        .iter()
        .map(|p| charts.known.get(p).copied().ok_or(Refused(contract::SPLIT_UNRECORDED)))
        .collect::<Result<Vec<_>>>()?;
    let obstacles: Vec<Trimmed> = slits.iter().map(|s| s.piece.clone()).collect();
    let witnesses = (0..arrangement.cells.len())
        .map(|k| arrangement.witness(k, &obstacles, &touches).map_err(curve))
        .collect::<Result<Vec<_>>>()?;
    let mut split = FaceSplit {
        side,
        face: f,
        forward: face.forward,
        arrangement,
        points,
        leaves,
        loops,
        slits,
        touches,
        witnesses,
        fragments: vec![],
    };
    split.fragments = split.winding_cells()?;
    split.check()?;
    Ok(split)
}

/// Canonical keys of the section pieces that form trees: repeatedly drop a
/// piece no old loop owns that has an end of degree one.
fn trees(loops: &[Leaf], cuts: &[Leaf], known: &BTreeMap<ExactPoint, PointId>) -> Result<BTreeSet<TrimKey>> {
    // Per distinct piece: its end points and whether an old loop owns it.
    let mut pieces: BTreeMap<TrimKey, ([PointId; 2], bool)> = BTreeMap::new();
    for (old, leaf) in loops.iter().map(|l| (true, l)).chain(cuts.iter().map(|l| (false, l))) {
        for piece in &leaf.pieces {
            let (canonical, _) = piece.canonical();
            let id = |p: &ExactPoint| known.get(p).copied().ok_or(Refused(contract::SPLIT_CHART_IDENTITY));
            let ends = [id(&canonical.ends()[0])?, id(&canonical.ends()[1])?];
            pieces.entry(canonical.key()).or_insert((ends, false)).1 |= old;
        }
    }
    let mut degree: BTreeMap<PointId, usize> = BTreeMap::new();
    for (ends, _) in pieces.values() {
        for e in ends {
            *degree.entry(*e).or_default() += 1;
        }
    }
    let mut dropped = BTreeSet::new();
    loop {
        let leaf = pieces
            .iter()
            .find(|(key, (ends, old))| !old && !dropped.contains(*key) && ends.iter().any(|e| degree[e] == 1))
            .map(|(key, (ends, _))| (key.clone(), *ends));
        let Some((key, ends)) = leaf else { break };
        for e in ends {
            *degree.get_mut(&e).expect("counted above") -= 1;
        }
        dropped.insert(key);
    }
    Ok(dropped)
}

/// PLANTED NEGATIVE (wrong on purpose): a component's exterior cycle is
/// attached as a hole to every cell whose outer cycle contains it, not only
/// to the innermost one. Its half-edges then lie in two cycles.
#[cfg(feature = "plant_split_hole_in_two_cells")]
fn plant_hole_in_two_cells(mut arr: Arrangement) -> Arrangement {
    let mut extra = vec![];
    for (k, cell) in arr.cells.iter().enumerate() {
        for hole in &cell.cycles[1..] {
            let probe = arr.points[arr.tail(hole[0])].clone();
            for (d, other) in arr.cells.iter().enumerate() {
                let shares = other.cycles[0].iter().any(|h| hole.contains(h) || hole.contains(&(h ^ 1)));
                if d != k && !shares && arr.cycle_profile(&other.cycles[0]).winding(&probe).is_ok_and(|w| w != 0) {
                    extra.push((d, hole.clone()));
                }
            }
        }
    }
    for (d, hole) in extra {
        arr.cells[d].cycles.push(hole);
    }
    arr
}

impl FaceSplit {
    /// Winding of the face's own loops around a chart point off them.
    pub fn loop_winding(&self, p: &ExactPoint) -> Result<i32> {
        let mut winding = 0;
        for s in self.leaves[..self.loops].iter().flat_map(|l| &l.pieces) {
            winding += s.winding(p).map_err(curve)?;
        }
        Ok(winding)
    }

    /// The cells whose witness the face's loops wind around.
    fn winding_cells(&self) -> Result<Vec<usize>> {
        let mut cells = vec![];
        for (k, w) in self.witnesses.iter().enumerate() {
            if self.loop_winding(w)? != 0 {
                cells.push(k);
            }
        }
        Ok(cells)
    }

    /// The P5 contracts (see the module documentation).
    pub fn check(&self) -> Result<()> {
        let arr = &self.arrangement;
        let fail = |code: &'static str| Err(Refused(code));

        // unrecorded-contact: every piece is each of its sources, uncut.
        for piece in &arr.pieces {
            for &(leaf, index, forward) in &piece.owners {
                let (canonical, agrees) = self.leaves[leaf].pieces[index].canonical();
                if canonical.key() != piece.seg.key() || agrees != forward {
                    return fail(contract::SPLIT_UNRECORDED);
                }
            }
        }
        if self.points.len() != arr.points.len() {
            return fail(contract::SPLIT_UNRECORDED);
        }

        // contact: pieces and slits meet only at shared ends.
        let all: Vec<&Trimmed> = arr.pieces.iter().map(|p| &p.seg).chain(self.slits.iter().map(|s| &s.piece)).collect();
        let bounds = all.iter().map(|s| s.bounds().map_err(curve)).collect::<Result<Vec<_>>>()?;
        for i in 0..all.len() {
            for j in i + 1..all.len() {
                if (0..2).any(|k| bounds[i][1][k] < bounds[j][0][k] || bounds[j][1][k] < bounds[i][0][k]) {
                    continue; // certified boxes apart: a strict inequality
                }
                let Ok(contacts) = all[i].contacts(all[j]) else { return fail(contract::SPLIT_CONTACT) };
                if contacts.iter().any(|c| !all[i].ends().contains(c) || !all[j].ends().contains(c)) {
                    return fail(contract::SPLIT_CONTACT);
                }
            }
        }

        // half-edge-cycles.
        let mut cell_of = vec![UNBOUNDED; 2 * arr.pieces.len()];
        for (k, cell) in arr.cells.iter().enumerate() {
            for &h in cell.cycles.iter().flatten() {
                if cell_of[h] != UNBOUNDED {
                    return fail(contract::SPLIT_HALF_EDGE);
                }
                cell_of[h] = k;
            }
        }
        for (h, &k) in cell_of.iter().enumerate() {
            let piece = &arr.pieces[h / 2];
            // The outer loop's half-edge with the face's exterior on its left.
            let exterior = piece.owners.iter().any(|&(leaf, _, forward)| leaf == 0 && (2 * (h / 2) + usize::from(!forward)) ^ usize::from(self.forward) == h);
            if arr.face[h] != k || (k == UNBOUNDED) != exterior {
                return fail(contract::SPLIT_HALF_EDGE);
            }
        }

        // orientation: exact Green sign of every cycle.
        for cell in &arr.cells {
            for (i, cycle) in cell.cycles.iter().enumerate() {
                if arr.cycle_profile(cycle).orientation() != Ok(i == 0) {
                    return fail(contract::SPLIT_ORIENTATION);
                }
            }
        }

        // witness: strictly inside its own cell and in no other one (a hole
        // attached to the wrong containing cell leaves the hole's witness in
        // two cells).
        if self.witnesses.len() != arr.cells.len() {
            return fail(contract::SPLIT_WITNESS);
        }
        let profiles: Vec<Vec<Cycle>> = arr.cells.iter().map(|cell| cell.cycles.iter().map(|c| arr.cycle_profile(c)).collect()).collect();
        for (k, w) in self.witnesses.iter().enumerate() {
            if all.iter().map(|s| s.contains(w).map_err(curve)).collect::<Result<Vec<_>>>()?.into_iter().any(|on| on) || self.touches.contains(w) {
                return fail(contract::SPLIT_WITNESS);
            }
            for (d, cycles) in profiles.iter().enumerate() {
                if cycles.iter().map(|c| c.winding(w)).sum::<std::result::Result<i32, Refusal>>().map_err(curve)? != i32::from(d == k) {
                    return fail(contract::SPLIT_WITNESS);
                }
            }
        }

        // membership: fragments are the cells in the face; every other cell
        // is bounded by hole loops alone, so it is the interior of a hole (a
        // hole cut by a piece would leave a cell bounded by that piece).
        let fragments = self.winding_cells()?;
        if fragments != self.fragments {
            return fail(contract::SPLIT_MEMBERSHIP);
        }
        for (k, cell) in arr.cells.iter().enumerate() {
            let hole_side = |h: &usize| arr.pieces[h / 2].owners.iter().any(|o| (1..self.loops).contains(&o.0));
            if !fragments.contains(&k) && !cell.cycles.iter().flatten().all(hole_side) {
                return fail(contract::SPLIT_MEMBERSHIP);
            }
        }

        // euler: V - E + F - R = 1 in the chart.
        let inner: usize = arr.cells.iter().map(|c| c.cycles.len() - 1).sum();
        if arr.points.len() + arr.cells.len() != arr.pieces.len() + inner + 1 {
            return fail(contract::SPLIT_EULER);
        }
        Ok(())
    }
}
