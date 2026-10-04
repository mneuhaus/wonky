//! Exact planar arrangement of closed cycles of trimmed pieces.
//!
//! Every source piece is cut at every exact contact with every other one,
//! coincident boundaries are merged, and the half-edge graph is walked into
//! face cycles. Bounded cycles become cells; a component's exterior cycle is
//! attached to its unique innermost containing cell as a hole. Leaf membership
//! of a cell is then decided by [`classify`] from exact winding numbers.
//!
//! Nothing here reads a binary64 cache to decide topology except the bounding
//! boxes that skip pairs which cannot touch (see `Trimmed::with_cache` for the
//! invariant those boxes rely on). Every refusal is a typed [`Refusal`]
//! variant with its frozen spelling.
use crate::{
    carrier::Carrier,
    cycle::Cycle,
    point::ExactPoint,
    refusal::{Refusal, R},
    star::{order_rays, order_rays_by_curvature, Star},
    trimmed::{TrimKey, Trimmed},
};
use std::collections::{BTreeMap, VecDeque};

/// Cell of half-edges that bound no cell (the unbounded face).
pub const UNBOUNDED: usize = usize::MAX;

/// Work limits of one arrangement; exceeding either refuses by name.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Budget {
    /// Most source pieces over all cycles.
    pub segments: usize,
    /// Most distinct pieces after splitting.
    pub pieces: usize,
}

/// A trimmed boundary piece in canonical orientation (lines from the
/// lexicographically smaller end, arcs counter-clockwise).
#[derive(Clone, Debug)]
pub struct Piece {
    pub seg: Trimmed,
    pub v: [usize; 2],
    /// (owner cycle or piece set, source piece index in it, the source's
    /// traversal agrees with canonical).
    pub owners: Vec<(usize, usize, bool)>,
}
impl Piece {
    /// A full turn of one circle: both ends are the same arrangement vertex.
    pub fn is_ring(&self) -> bool {
        self.v[0] == self.v[1]
    }
    pub fn shares_source(&self, other: &Piece) -> bool {
        self.owners
            .iter()
            .any(|a| other.owners.iter().any(|b| a.0 == b.0 && a.1 == b.1))
    }
}
#[derive(Clone, Debug)]
pub struct Cell {
    /// Half-edge cycles with the cell on their left; [0] is the outer one.
    pub cycles: Vec<Vec<usize>>,
    /// Membership of each input cycle; filled by [`classify`].
    pub inside: Vec<bool>,
}
#[derive(Clone, Debug)]
pub struct Arrangement {
    pub points: Vec<ExactPoint>,
    /// Half-edge h = 2 * piece (+1 when reversed).
    pub pieces: Vec<Piece>,
    /// Cell on the left of each half-edge, or UNBOUNDED.
    pub face: Vec<usize>,
    pub cells: Vec<Cell>,
}
impl Arrangement {
    pub fn tail(&self, h: usize) -> usize {
        self.pieces[h / 2].v[h % 2]
    }
    pub fn oriented(&self, h: usize) -> Trimmed {
        let s = &self.pieces[h / 2].seg;
        if h % 2 == 0 {
            s.clone()
        } else {
            s.reversed()
        }
    }
    pub fn cycle_profile(&self, cycle: &[usize]) -> Cycle {
        Cycle::new(cycle.iter().map(|&h| self.oriented(h)).collect())
    }
}
fn find(parent: &mut [usize], mut i: usize) -> usize {
    while parent[i] != i {
        parent[i] = parent[parent[i]];
        i = parent[i];
    }
    i
}

/// Arrange the boundaries of `cycles` (their index is the owner id of a piece).
pub fn arrange(cycles: &[&Cycle], budget: Budget) -> R<Arrangement> {
    arrange_pieces(&cycles.iter().map(|c| c.pieces()).collect::<Vec<_>>(), budget)
}

/// Arrange sets of pieces; set `l` is owner `l` of its pieces. A set is a
/// closed cycle or any other collection of pieces, for example a face
/// split's section pieces, whose ends lie on other pieces. A tree of pieces
/// bounds no area: its walk has zero area and refuses as an unresolved
/// orientation, so a consumer removes trees first. [`classify`] needs
/// closed cycles.
pub fn arrange_pieces(sets: &[&[Trimmed]], budget: Budget) -> R<Arrangement> {
    arrange_sets(sets, budget, false, false, false)
}

/// The same arrangement with exact midpoint admission for quadratic lines.
/// This arithmetic capability stays dark until its consumer is routed; all
/// contact, star-order, cycle and nesting predicates are the common engine.
pub fn arrange_pieces_exact(sets: &[&[Trimmed]], budget: Budget) -> R<Arrangement> {
    arrange_sets(sets, budget, false, true, false)
}

/// A face split of the general Boolean: `arrange_pieces` (exact quadratic
/// midpoints when `quadratic`) whose vertex stars order tangent rays by
/// exact curvature for lines and circles too (`order_rays_by_curvature`).
pub fn arrange_faces(sets: &[&[Trimmed]], budget: Budget, quadratic: bool) -> R<Arrangement> {
    arrange_sets(sets, budget, false, quadratic, true)
}

/// Sketch boundaries: split all contacts, then remove only graph leaves.
/// Dangling wires bound no cell; closed boundaries and chords remain exact.
pub fn arrange_sketch(sets: &[&[Trimmed]], budget: Budget) -> R<Arrangement> {
    arrange_sets(sets, budget, true, false, false)
}

fn arrange_sets(sets: &[&[Trimmed]], budget: Budget, prune: bool, quadratic: bool, curvature: bool) -> R<Arrangement> {
    let sources = sets
        .iter()
        .enumerate()
        .flat_map(|(l, c)| c.iter().enumerate().map(move |(i, s)| (l, i, s)))
        .collect::<Vec<_>>();
    if sources.len() > budget.segments {
        return Err(Refusal::ArrangementBudget);
    }
    // A closed spline over its whole range is one piece whose two ends are the
    // same point. Cuts are keyed by point, so its cut list would collapse to a
    // single point and the piece (with its cell) would silently vanish; it
    // refuses by name instead. Only a spline closes on itself; the match is
    // exhaustive so a new carrier kind decides here too.
    let closed = |s: &Trimmed| match s.carrier() {
        Carrier::BSpline(_) => s.ends()[0] == s.ends()[1],
        Carrier::Line | Carrier::Circle(_) => false,
    };
    if sources.iter().any(|(_, _, s)| closed(s)) {
        return Err(Refusal::SplineArrangement);
    }
    let bounds = sources
        .iter()
        .map(|(_, _, s)| s.bounds())
        .collect::<R<Vec<_>>>()?;
    let mut cuts = sources
        .iter()
        .map(|(_, _, s)| s.cut_seed())
        .collect::<Vec<_>>();
    for i in 0..sources.len() {
        for j in i + 1..sources.len() {
            if (0..2)
                .any(|k| bounds[i][1][k] < bounds[j][0][k] || bounds[j][1][k] < bounds[i][0][k])
            {
                continue;
            }
            let (a, b) = (sources[i].2, sources[j].2);
            if a.coincident_with(b)? {
                // A ring's seam is an anchor, not a cut: only real ends are shared.
                for p in b.cut_seed() {
                    if a.contains(&p)? {
                        cuts[i].push(p);
                    }
                }
                for p in a.cut_seed() {
                    if b.contains(&p)? {
                        cuts[j].push(p);
                    }
                }
                continue;
            }
            let contacts = a.contacts(b).map_err(|e| {
                if e == Refusal::QuadraticSplitVertexStorage {
                    Refusal::ArrangementQuadraticCrossing
                } else {
                    e
                }
            })?;
            for p in contacts {
                cuts[i].push(p.clone());
                cuts[j].push(p);
            }
        }
    }
    let mut vertices = BTreeMap::<ExactPoint, usize>::new();
    let mut keyed = BTreeMap::<TrimKey, usize>::new();
    let mut pieces: Vec<Piece> = vec![];
    for ((leaf, index, s), points) in sources.iter().zip(cuts) {
        for piece in s.split(points)? {
            let (seg, forward) = piece.canonical();
            let key = seg.key();
            let id = match keyed.get(&key) {
                Some(&id) => id,
                None => {
                    if pieces.len() == budget.pieces {
                        return Err(Refusal::ArrangementSplitBudget);
                    }
                    let mut v = [0; 2];
                    for (slot, end) in v.iter_mut().zip(seg.ends()) {
                        let next = vertices.len();
                        *slot = *vertices.entry(end.clone()).or_insert(next);
                    }
                    keyed.insert(key, pieces.len());
                    pieces.push(Piece {
                        seg,
                        v,
                        owners: vec![],
                    });
                    pieces.len() - 1
                }
            };
            if pieces[id].owners.iter().any(|o| o.0 == *leaf) {
                return Err(Refusal::LeafSelfOverlap);
            }
            pieces[id].owners.push((*leaf, *index, forward));
        }
    }
    let mut points = vec![ExactPoint::from_f64([0., 0.]); vertices.len()];
    for (p, i) in vertices {
        points[i] = p;
    }
    let mut star = vec![vec![]; points.len()];
    for (e, piece) in pieces.iter().enumerate() {
        star[piece.v[0]].push(2 * e);
        star[piece.v[1]].push(2 * e + 1);
    }
    if prune {
        let mut degree = star.iter().map(Vec::len).collect::<Vec<_>>();
        let mut active = vec![true; pieces.len()];
        let mut queue = (0..degree.len()).filter(|&v| degree[v] < 2).collect::<VecDeque<_>>();
        while let Some(v) = queue.pop_front() {
            for &h in &star[v] {
                let e = h / 2;
                if !active[e] { continue; }
                active[e] = false;
                for &u in &pieces[e].v {
                    degree[u] -= 1;
                    if degree[u] == 1 { queue.push_back(u); }
                }
            }
        }
        pieces = pieces.into_iter().enumerate().filter_map(|(e, p)| active[e].then_some(p)).collect();
        star.iter_mut().for_each(Vec::clear);
        for (e, p) in pieces.iter().enumerate() {
            star[p.v[0]].push(2 * e);
            star[p.v[1]].push(2 * e + 1);
        }
    }
    let rays = (0..2 * pieces.len())
        .map(|h| pieces[h / 2].seg.ray(h % 2 == 0))
        .collect::<R<Vec<_>>>()?;
    for at in &mut star {
        match if curvature { order_rays_by_curvature(at, &rays) } else { order_rays(at, &rays) } {
            Star::Tied => return Err(Refusal::TangentBranchOrder),
            Star::Ordered => {}
        }
    }
    // Face walk: every half-edge has its face on the left.
    let mut cycle_of = vec![usize::MAX; 2 * pieces.len()];
    let mut walks: Vec<Vec<usize>> = vec![];
    for first in 0..2 * pieces.len() {
        if cycle_of[first] != usize::MAX {
            continue;
        }
        let mut walk = vec![];
        let mut h = first;
        loop {
            if cycle_of[h] != usize::MAX {
                if h == first {
                    break;
                }
                return Err(Refusal::FaceWalk);
            }
            cycle_of[h] = walks.len();
            walk.push(h);
            let w = pieces[h / 2].v[1 - h % 2];
            let rays = &star[w];
            let twin = rays
                .iter()
                .position(|&r| r == (h ^ 1))
                .ok_or(Refusal::FaceWalk)?;
            h = rays[(twin + rays.len() - 1) % rays.len()];
        }
        walks.push(walk);
    }
    let arr = Arrangement {
        points,
        pieces,
        face: vec![],
        cells: vec![],
    };
    let positive = walks
        .iter()
        .map(|c| arr.cycle_profile(c).orientation())
        .collect::<R<Vec<_>>>()?;
    // Components and their unique negative (exterior) cycle.
    let mut parent = (0..arr.points.len()).collect::<Vec<_>>();
    for piece in &arr.pieces {
        let (a, b) = (find(&mut parent, piece.v[0]), find(&mut parent, piece.v[1]));
        parent[a] = b;
    }
    let component = |parent: &mut [usize], c: &[usize]| find(parent, arr.tail(c[0]));
    let mut exterior = BTreeMap::<usize, usize>::new();
    for (i, c) in walks.iter().enumerate() {
        if !positive[i] && exterior.insert(component(&mut parent, c), i).is_some() {
            return Err(Refusal::ComponentExterior);
        }
    }
    let bounded = (0..walks.len()).filter(|&i| positive[i]).collect::<Vec<_>>();
    let mut cell_of_cycle = vec![UNBOUNDED; walks.len()];
    let mut cells = bounded
        .iter()
        .enumerate()
        .map(|(k, &i)| {
            cell_of_cycle[i] = k;
            Cell {
                cycles: vec![walks[i].clone()],
                inside: vec![],
            }
        })
        .collect::<Vec<_>>();
    let profiles = bounded
        .iter()
        .map(|&i| arr.cycle_profile(&walks[i]))
        .collect::<Vec<_>>();
    let profile_bounds = profiles.iter().map(Cycle::bounds).collect::<R<Vec<_>>>()?;
    for (&comp, &neg) in &exterior {
        // Components are disjoint, so any point on a boundary piece has the
        // same containment in every other component. Use a certified strict
        // interior point of the piece, not an endpoint on another boundary.
        // Quadratic-line admission retains its exact construction point.
        let seg = &arr.pieces[walks[neg][0] / 2].seg;
        let probe = if quadratic {seg.exact_interior_point()?} else {seg.interior_point()?};
        let enclosure = probe.enclosure()?;

        let mut containing = Vec::new();
        for (k, &i) in bounded.iter().enumerate() {
            if component(&mut parent, &walks[i]) != comp
                && !outside(&enclosure, &profile_bounds[k])
                && profiles[k].winding(&probe)? != 0 {
                containing.push(k);
            }
        }
        let mut inner = Vec::new();
        for &k in &containing {
            let seg = &arr.pieces[walks[bounded[k]][0] / 2].seg;
            let witness = if quadratic {seg.exact_interior_point()?} else {seg.interior_point()?};
            let mut all = true;
            for &d in &containing {
                if d != k && profiles[d].winding(&witness)? == 0 {
                    all = false;
                    break;
                }
            }
            if all {
                inner.push(k);
            }
        }
        match inner.as_slice() {
            [] if containing.is_empty() => {}
            [] => return Err(Refusal::NestingOrder),
            [k] => {
                cell_of_cycle[neg] = *k;
                cells[*k].cycles.push(walks[neg].clone());
            }
            [_, _, ..] => return Err(Refusal::NestingOrder),
        }
    }
    let mut face = vec![UNBOUNDED; 2 * arr.pieces.len()];
    for (i, c) in walks.iter().enumerate() {
        for &h in c {
            face[h] = cell_of_cycle[i];
        }
    }
    Ok(Arrangement { face, cells, ..arr })
}

/// Membership of every bounded cell in each of `cycles` (the ones the
/// arrangement was built from, in the same order), decided on one boundary
/// piece of the cell.
// Both arguments enclose the exact geometry. Only strict separation proves
// zero winding; boundary contact and an overlapping enclosure still use the
// exact winding predicate. In particular, no point serialization cache enters
// the decision. This prunes the quadratic cell x leaf winding work for sparse
// arrangements without changing topology or admission.
fn outside(point: &[wonky_num::Iv; 2], bounds: &[[f64; 2]; 2]) -> bool {
    (0..2).any(|k| point[k].hi() < bounds[0][k] || point[k].lo() > bounds[1][k])
}
pub fn classify(arr: &mut Arrangement, cycles: &[&Cycle]) -> R<()> {
    let bounds = cycles.iter().map(|c| c.bounds()).collect::<R<Vec<_>>>()?;
    for k in 0..arr.cells.len() {
        let h = arr.cells[k].cycles[0][0];
        let piece = &arr.pieces[h / 2];
        let witness = piece.seg.interior_point()?;
        let enclosure = witness.enclosure()?;
        let inside = cycles
            .iter()
            .enumerate()
            .map(|(i, cycle)| {
                Ok(match piece.owners.iter().find(|o| o.0 == i) {
                    Some(owner) => owner.2 == (h % 2 == 0),
                    None if outside(&enclosure, &bounds[i]) => false,
                    None => cycle.winding(&witness)? != 0,
                })
            })
            .collect::<R<Vec<bool>>>()?;
        arr.cells[k].inside = inside;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::trimmed::fixtures::*;

    const BUDGET: Budget = Budget {
        segments: 64,
        pieces: 256,
    };

    fn rect(x0: f64, y0: f64, x1: f64, y1: f64) -> Cycle {
        Cycle::polygon(&[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]).unwrap()
    }
    /// Full circle of radius `r` about `c` as four quarter arcs (an exactly
    /// representable `r` keeps the quarter points exact).
    fn circle(c: [f64; 2], r: f64) -> Cycle {
        let [x, y] = c;
        let pts = [[x + r, y], [x, y + r], [x - r, y], [x, y - r]];
        Cycle::new(
            (0..4)
                .map(|i| arc(c, r * r, pts[i], pts[(i + 1) % 4], true))
                .collect(),
        )
    }
    fn arranged(cycles: &[Cycle]) -> R<Arrangement> {
        let refs = cycles.iter().collect::<Vec<_>>();
        let mut arr = arrange(&refs, BUDGET)?;
        classify(&mut arr, &refs)?;
        Ok(arr)
    }
    fn area(arr: &Arrangement, cycle: &[usize]) -> f64 {
        arr.cycle_profile(cycle).area().unwrap().m
    }
    /// The piece whose canonical ends are exactly `a` and `b`.
    fn piece_between(arr: &Arrangement, a: [f64; 2], b: [f64; 2]) -> &Piece {
        arr.pieces
            .iter()
            .find(|pc| pc.seg.ends() == &[p(a[0], a[1]), p(b[0], b[1])])
            .unwrap_or_else(|| panic!("no piece {a:?}-{b:?}"))
    }

    #[test]
    fn a_disjoint_inner_cycle_becomes_a_hole_of_the_enclosing_cell() {
        let arr = arranged(&[rect(0., 0., 10., 10.), rect(3., 3., 7., 7.)]).unwrap();
        assert_eq!((arr.pieces.len(), arr.cells.len()), (8, 2));
        assert!(arr.pieces.iter().all(|pc| pc.owners.len() == 1));
        let holed = arr.cells.iter().position(|c| c.cycles.len() == 2).unwrap();
        let plain = 1 - holed;
        assert_eq!(arr.cells[plain].cycles.len(), 1);
        // The outer cycle is the 10x10 square, the hole the inner one, reversed.
        assert_eq!(area(&arr, &arr.cells[holed].cycles[0]), 100.);
        assert_eq!(area(&arr, &arr.cells[holed].cycles[1]), -16.);
        assert_eq!(area(&arr, &arr.cells[plain].cycles[0]), 16.);
        // Half-edges of the hole have the holed cell on their left; the inner
        // square's own half-edges bound the plain cell; the outside is unbounded.
        for &h in &arr.cells[holed].cycles[1] {
            assert_eq!(arr.face[h], holed);
        }
        for &h in &arr.cells[plain].cycles[0] {
            assert_eq!(arr.face[h], plain);
        }
        assert_eq!(arr.face.iter().filter(|&&f| f == UNBOUNDED).count(), 4);
        // Leaf membership: the holed cell is in the outer square only; the plain
        // cell is in both (the leaves overlap there).
        assert_eq!(arr.cells[holed].inside, vec![true, false]);
        assert_eq!(arr.cells[plain].inside, vec![true, true]);
    }

    #[test]
    fn a_component_is_never_a_hole_of_its_own_cell() {
        // Listed from the top-left corner, the square's exterior walk starts on
        // its left edge at the bottom-left corner. That probe lies on the
        // square's own boundary, where the half-open winding of the square is
        // 1 (the right edge owns its lower end): only the own-component
        // exclusion keeps the exterior from becoming a hole of its own cell.
        let square = Cycle::polygon(&[[0., 1.], [0., 0.], [1., 0.], [1., 1.]]).unwrap();
        assert_eq!(square.winding(&p(0., 0.)).unwrap(), 1);
        let arr = arranged(&[square]).unwrap();
        assert_eq!(arr.cells.len(), 1);
        assert_eq!(arr.cells[0].cycles.len(), 1);
        assert_eq!(area(&arr, &arr.cells[0].cycles[0]), 1.);
        assert_eq!(arr.face.iter().filter(|&&f| f == UNBOUNDED).count(), 4);
        assert_eq!(arr.cells[0].inside, vec![true]);
    }

    #[test]
    fn a_shared_edge_is_one_piece_with_both_owners_in_opposite_senses() {
        // B sits on the middle third of A's top edge (a T junction).
        let arr = arranged(&[rect(0., 0., 4., 2.), rect(1., 2., 3., 4.)]).unwrap();
        assert_eq!((arr.points.len(), arr.pieces.len(), arr.cells.len()), (8, 9, 2));
        let shared = piece_between(&arr, [1., 2.], [3., 2.]);
        let mut owners = shared.owners.clone();
        owners.sort();
        // Leaf 0 walks its top edge from x=4 to x=0 (against canonical), leaf 1
        // walks its bottom edge from x=1 to x=3 (with canonical).
        assert_eq!(owners.iter().map(|o| (o.0, o.2)).collect::<Vec<_>>(), [(0, false), (1, true)]);
        // A's top edge is split at x=1 and x=3; all three parts share that source.
        let left = piece_between(&arr, [0., 2.], [1., 2.]);
        let right = piece_between(&arr, [3., 2.], [4., 2.]);
        assert_eq!(left.owners.len() + right.owners.len(), 2);
        assert!(shared.shares_source(left) && shared.shares_source(right) && left.shares_source(right));
        // B's bottom edge is another source: the left part does not share it.
        let b_left = piece_between(&arr, [1., 2.], [1., 4.]);
        assert!(!left.shares_source(b_left) && !shared.shares_source(b_left));
        // Each side of the shared piece is a different cell, each in one leaf only.
        let h = 2 * arr.pieces.iter().position(|pc| std::ptr::eq(pc, shared)).unwrap();
        assert_ne!(arr.face[h], arr.face[h + 1]);
        assert!(arr.face[h] != UNBOUNDED && arr.face[h + 1] != UNBOUNDED);
        let mut inside = arr.cells.iter().map(|c| c.inside.clone()).collect::<Vec<_>>();
        inside.sort();
        assert_eq!(inside, vec![vec![false, true], vec![true, false]]);
    }

    #[test]
    fn face_arrangements_order_tangent_rays_by_curvature() {
        // The internally tangent circles `arrange` refuses (below): a face
        // split orders the four rays at (2, 0) by curvature 1/2 vs 1 and
        // finds the small disc and the crescent around it.
        let sets = [circle([0., 0.], 2.), circle([1., 0.], 1.)];
        let refs = sets.iter().map(|c| c.pieces()).collect::<Vec<_>>();
        let arr = arrange_faces(&refs, BUDGET, false).unwrap();
        assert_eq!(arr.cells.len(), 2);
        let mut areas = arr
            .cells
            .iter()
            .map(|cell| cell.cycles.iter().fold(wonky_num::Iv::point(0.), |a, c| a + arr.cycle_profile(c).area().unwrap()))
            .collect::<Vec<_>>();
        areas.sort_by(|a, b| a.m.total_cmp(&b.m));
        for (area, expected) in areas.iter().zip([std::f64::consts::PI, 3. * std::f64::consts::PI]) {
            assert!(area.lo() <= expected && expected <= area.hi() && area.r < 1e-12, "{area:?} vs {expected}");
        }
    }

    #[test]
    fn a_tied_star_of_tangent_rays_refuses_by_name() {
        // Two circles touching internally at (2, 0): both have the vertical
        // tangent there, so the four rays at that vertex fall into two tied
        // pairs (up, down) and no exact branch order exists.
        let tied = arranged(&[circle([0., 0.], 2.), circle([1., 0.], 1.)]);
        assert_eq!(tied.unwrap_err(), Refusal::TangentBranchOrder);
        assert_eq!(Refusal::TangentBranchOrder.name(), "prism-stack/tangent-branch-order");
        // Each circle alone (two rays at each quarter point) arranges fine.
        assert_eq!(arranged(&[circle([1., 0.], 1.)]).unwrap().cells.len(), 1);
    }

    #[test]
    fn a_closed_spline_piece_refuses_instead_of_vanishing() {
        // The teardrop (0,0),(10,10),(-10,10),(0,0) closes on itself: as one
        // piece over its whole range its ends coincide, its cut list would be a
        // single point, and the cell of area 30 would vanish. It refuses by
        // name; split into two pieces it is one cell of exactly that area.
        use crate::bspline::BSpline;
        use crate::numeric::q;
        use std::sync::Arc;
        let s = Arc::new(BSpline::bezier_f64(&[[0., 0.], [10., 10.], [-10., 10.], [0., 0.]]).unwrap());
        let (zero, half, one) = (q(0.), q(0.5), q(1.));
        let whole = Cycle::new(vec![Trimmed::spline(Arc::clone(&s), zero.clone(), one.clone()).unwrap()]);
        assert_eq!(whole.winding(&p(0., 5.)).unwrap(), 1);
        assert_eq!(arrange(&[&whole], BUDGET).unwrap_err(), Refusal::SplineArrangement);
        let halves = Cycle::new(vec![
            Trimmed::spline(Arc::clone(&s), zero, half.clone()).unwrap(),
            Trimmed::spline(s, half, one).unwrap(),
        ]);
        let arr = arranged(&[halves]).unwrap();
        assert_eq!((arr.points.len(), arr.pieces.len(), arr.cells.len()), (2, 2, 1));
        assert_eq!(arr.cells[0].inside, vec![true]);
        let area = arr.cycle_profile(&arr.cells[0].cycles[0]).area().unwrap();
        assert!(area.lo() <= 30. && 30. <= area.hi(), "{area:?}");
    }

    #[test]
    fn a_hole_attaches_to_its_innermost_containing_cell() {
        // Three nested squares, pairwise disjoint: each exterior belongs to the
        // cell directly around it, never to an outer one.
        let arr = arranged(&[rect(0., 0., 12., 12.), rect(2., 2., 10., 10.), rect(4., 4., 8., 8.)]).unwrap();
        assert_eq!(arr.cells.len(), 3);
        let by_outer = |a: f64| {
            arr.cells
                .iter()
                .find(|c| area(&arr, &c.cycles[0]) == a)
                .unwrap_or_else(|| panic!("no cell of area {a}"))
        };
        let (a, b, c) = (by_outer(144.), by_outer(64.), by_outer(16.));
        assert_eq!(a.cycles.len(), 2);
        assert_eq!(area(&arr, &a.cycles[1]), -64., "the middle square's exterior is A's hole");
        assert_eq!(b.cycles.len(), 2);
        assert_eq!(area(&arr, &b.cycles[1]), -16., "the inner square's exterior is B's hole, not A's");
        assert_eq!(c.cycles.len(), 1);
        assert_eq!(a.inside, vec![true, false, false]);
        assert_eq!(b.inside, vec![true, true, false]);
        assert_eq!(c.inside, vec![true, true, true]);
    }

    #[test]
    fn resolution_certifies_crossings_but_refuses_a_sub_reader_lens() {
        let disc = circle([0., 0.], 1.);
        for (height, admitted) in [(0.5, true), (1. - 2f64.powi(-40), false)] {
            let cut = rect(-2., height, 2., 2.);
            let arr = arrange(&[&disc, &cut], BUDGET).unwrap();
            assert_eq!(arr.points.iter().filter(|p| p.rat().is_err()).count(), 2);
            if admitted {
                arr.certify_resolution(2.2e-10).unwrap();
            } else {
                assert_eq!(arr.certify_resolution(2.2e-10).unwrap_err(), Refusal::SubResolutionFeature);
            }
        }
        // External circle tangency has one exact contact, never two nearly
        // equal crossing points or a lens of invented positive area.
        let tangent = line([-2., 1.], [2., 1.]);
        let contacts = disc.pieces().iter().flat_map(|s| s.contacts(&tangent).unwrap()).collect::<std::collections::BTreeSet<_>>();
        assert_eq!(contacts.len(), 1);
        assert_eq!(contacts.into_iter().next().unwrap(), p(0., 1.));
        let other = circle([1., 0.], 1.);
        let arr = arranged(&[disc, other]).unwrap();
        assert_eq!(arr.points.iter().filter(|p| p.rat().is_err()).count(), 2);
        arr.certify_resolution(2.2e-10).unwrap();
        let overlap = arr.cells.iter().find(|c| c.inside == [true, true]).unwrap();
        let profile = arr.cycle_profile(&overlap.cycles[0]);
        let expected = 2. * std::f64::consts::PI / 3. - 3f64.sqrt() / 2.;
        let area = profile.area().unwrap();
        assert!(area.lo() <= expected && expected <= area.hi());
        let moments = profile.moments().unwrap();
        assert!(moments[0].lo() <= expected / 2. && expected / 2. <= moments[0].hi());
        assert!(moments[1].lo() <= 0. && 0. <= moments[1].hi());
    }

    #[test]
    fn work_budgets_and_overlaps_refuse_with_their_frozen_spellings() {
        let square = rect(0., 0., 2., 2.);
        let refs = [&square];
        let few = |segments, pieces| arrange(&refs, Budget { segments, pieces }).map(|_| ());
        assert_eq!(few(4, 4), Ok(()));
        assert_eq!(few(3, 4), Err(Refusal::ArrangementBudget));
        assert_eq!(few(4, 3), Err(Refusal::ArrangementSplitBudget));
        // A digon of a line and its own reverse owns one split piece twice.
        let digon = Cycle::new(vec![line([0., 0.], [1., 0.]), line([1., 0.], [0., 0.])]);
        assert_eq!(arrange(&[&digon], BUDGET).map(|_| ()), Err(Refusal::LeafSelfOverlap));
        // The hypotenuse y = (9x - 3)/8 meets the unit circle where
        // 145x^2 - 54x - 55 = 0; its discriminant 34816 is no square, so both
        // crossings are irrational.
        let cut = Cycle::polygon(&[[-1., -1.5], [3., -1.5], [3., 3.]]).unwrap();
        let unit = circle([0., 0.], 1.);
        let mut arr = arrange(&[&cut, &unit], BUDGET).unwrap();
        classify(&mut arr, &[&cut, &unit]).unwrap();
        assert_eq!((arr.points.len(), arr.pieces.len(), arr.cells.len()), (9, 11, 3));
        let radicals = arr.points.iter().filter(|p| p.rat().is_err()).collect::<Vec<_>>();
        assert_eq!(radicals.len(), 2);
        for point in radicals {
            let [x, y] = point.coordinates();
            assert_eq!(&x * &x + &y * &y, crate::numeric::q(1.));
            assert_eq!(&x * crate::numeric::q(9.) - &y * crate::numeric::q(8.), crate::numeric::q(3.));
            assert!(unit.pieces().iter().any(|s| s.contains(point).unwrap()));
            assert!(cut.pieces().iter().any(|s| s.contains(point).unwrap()));
        }
        let mut memberships = arr.cells.iter().map(|c| c.inside.clone()).collect::<Vec<_>>();
        memberships.sort();
        assert_eq!(memberships, vec![vec![false, true], vec![true, false], vec![true, true]]);
        for (leaf, expected) in [(0, 9.), (1, std::f64::consts::PI)] {
            let total = arr.cells.iter().filter(|c| c.inside[leaf]).flat_map(|c| &c.cycles)
                .fold(wonky_num::Iv::point(0.), |a, c| a + arr.cycle_profile(c).area().unwrap());
            assert!(total.lo() <= expected && expected <= total.hi(), "leaf {leaf}: {total:?}");
            assert!(total.r < 1e-12);
        }
        for (r, name) in [
            (Refusal::ArrangementBudget, "prism-stack/arrangement-budget"),
            (Refusal::ArrangementSplitBudget, "prism-stack/arrangement-split-budget"),
            (Refusal::LeafSelfOverlap, "prism-stack/leaf-self-overlap"),
            (Refusal::TangentBranchOrder, "prism-stack/tangent-branch-order"),
            (Refusal::FaceWalk, "prism-stack/face-walk"),
            (Refusal::ComponentExterior, "prism-stack/component-exterior"),
            (Refusal::NestingOrder, "prism-stack/nesting-order"),
            (
                Refusal::ArrangementQuadraticCrossing,
                "prism-stack/quadratic-crossing: an irrational line/arc crossing needs exact radical vertex storage",
            ),
        ] {
            assert_eq!(r.name(), name);
        }
    }
}
