//! P7: select the classified fragments, sew them by piece identity, nest
//! the shells into solids and emit one checked `Model`.
//!
//! **Selection** (Mantyla 1986 eq. (5) and the GWB code; the printed Table I
//! row for `\` is wrong, see docs/research/sources/m-ntyl-1986-...md):
//!
//! | op | A fragments kept | B fragments kept |
//! |---|---|---|
//! | union | OUT, ON-same | OUT |
//! | subtraction A - B | OUT, ON-opposite | IN, reversed |
//! | intersection | IN, ON-same | IN |
//!
//! B's ON fragments are never kept, so exactly one copy of a shared face
//! survives, and only A's.
//!
//! **Sewing by piece identity.** A kept fragment's boundary is its cell's
//! half-edge cycles; each half-edge runs between two P3 points (`PointId`,
//! the one registry of exact points of P3). A result edge is an unordered
//! pair of P3 points (between two points of a planar B-rep there is one
//! straight edge), never a coordinate match. An edge must have two uses in
//! opposite directions; four or more is FeatureScript's
//! `non-manifold-result` (AC12), an odd count or two uses in one direction
//! is `assemble/edge-use`. A vertex whose link (the corners of the loops at
//! it) is not one cycle, and a point or line contact that sewing cannot see
//! (a kept face touched inside by a vertex or an edge of the result: its
//! P5 touch points and slits), are `non-manifold-result` too. No fragment
//! kept is `empty-result` (AC13, AC15).
//!
//! **Shells and solids.** Shells are the edge-connected components of the
//! result faces. The exact signed volume of a shell is positive for an
//! outer shell and negative for a void (zero is `assemble/shell-volume`).
//! A void belongs to the innermost outer shell that contains one of its
//! vertices by exact ray membership (the one of least volume); a void in
//! none is `assemble/nesting`. Each outer shell with its voids is a solid.
//!
//! **Emission.** Faces keep their operand's carrier, carried into the
//! working frame (`Placed::working_carrier`); a kept face is forward when
//! its operand face was, flipped for reversed B fragments; its loops are
//! oriented by the exact shoelace sign in the carrier's chart (the outer
//! loop counter-clockwise about the outward normal). The draft passes
//! `Draft::check` (G1-G8) or refuses `assemble/audit`.
//!
//! **Re-join.** A piece of a face's arrangement whose two sides are both
//! kept cells of that face, and which no other kept cell uses, only cut the
//! face (typically the other operand's footprint on a coplanar face); the
//! cells on both sides are one result face, bounded by the remaining
//! half-edges linked head to tail. A region that touches itself at a vertex
//! cannot be one face loop and refuses `boolean/merge-unavailable:pinched-face`.
//!
//! **Normalization.** Raw assembly retains source faces. Emission merges
//! edge-connected coplanar faces and globally degree-two straight subdivisions
//! after contact checks, preserving exact shell volumes (see `merge`).
use crate::classify::{membership, Class, FaceSet, Fragment, Member};
use crate::contract;
use crate::operand::{Location, Operands, Side};
use crate::paves::PointId;
use crate::split::FaceSplit;
use crate::Intersection;
use num_traits::{Signed, Zero};
use std::collections::{BTreeMap, BTreeSet};
use wonky_curve::{Carrier, ExactPoint, Trimmed};
use wonky_geom::model::{
    Bounds, Carrier3, Coedge, CoedgeId, Curve, Curve3, CurveId, Draft, Edge, EdgeId, Face, FaceId, Label, Loop, LoopId,
    Model, Plane3, Provenance, Shell, ShellId, Solid, Surface, SurfaceId, Vertex, VertexDef, VertexId,
};
use wonky_geom::{cross, dot, sub, Point, Refused, Result, Q};

/// The Boolean operation, in the order of FeatureScript's `BooleanOperationType`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Op {
    Union,
    Subtraction,
    Intersection,
}

/// Whether a fragment is kept, and reversed.
pub fn keep(op: Op, side: Side, class: Class) -> Option<bool> {
    match (op, side, class) {
        (Op::Union, Side::A, Class::Out | Class::OnSame) | (Op::Union, Side::B, Class::Out) => Some(false),
        (Op::Subtraction, Side::A, Class::Out | Class::OnOpposite) => Some(false),
        (Op::Subtraction, Side::B, Class::In) => Some(true),
        (Op::Intersection, Side::A, Class::In | Class::OnSame) | (Op::Intersection, Side::B, Class::In) => Some(false),
        (Op::Union, Side::A, Class::In | Class::OnOpposite)
        | (Op::Union, Side::B, Class::In | Class::OnSame | Class::OnOpposite)
        | (Op::Subtraction, Side::A, Class::In | Class::OnSame)
        | (Op::Subtraction, Side::B, Class::Out | Class::OnSame | Class::OnOpposite)
        | (Op::Intersection, Side::A, Class::Out | Class::OnOpposite)
        | (Op::Intersection, Side::B, Class::Out | Class::OnSame | Class::OnOpposite) => None,
    }
}

/// One face of the result.
#[derive(Clone, Debug)]
pub struct ResultFace {
    pub side: Side,
    /// The operand face it is a fragment of.
    pub face: FaceId,
    /// The cells of the face's arrangement it is made of: one fragment, or
    /// several re-joined across pieces that only cut the face.
    pub cells: Vec<usize>,
    /// The operand face's carrier in the working frame.
    pub carrier: Plane3,
    /// The outward normal is the carrier normal.
    pub forward: bool,
    /// The outer loop, then the holes, as P3 points in loop order.
    pub loops: Vec<Vec<PointId>>,
    /// The carrier's provenance.
    pub provenance: Provenance,
}

/// The assembled result: faces, shells (face indices) and solids (shell
/// indices, the outer shell first).
#[derive(Clone, Debug)]
pub struct Assembly {
    pub faces: Vec<ResultFace>,
    pub shells: Vec<Vec<usize>>,
    pub solids: Vec<Vec<usize>>,
}

type EdgeKey = (PointId, PointId);
fn key(a: PointId, b: PointId) -> EdgeKey {
    (a.min(b), a.max(b))
}

/// Twice the signed area of a cycle in a plane's chart (positive:
/// counter-clockwise about the carrier normal).
fn area2(plane: &Plane3, points: &[&Point]) -> Result<Q> {
    let uv = points.iter().map(|p| plane.chart(p)).collect::<Result<Vec<_>>>()?;
    let mut a = Q::zero();
    for k in 0..uv.len() {
        let (p, q) = (&uv[k], &uv[(k + 1) % uv.len()]);
        a += &p[0] * &q[1] - &q[0] * &p[1];
    }
    Ok(a)
}

/// The result faces as a face set for membership rays.
struct Faces<'a> {
    faces: Vec<&'a ResultFace>,
    points: &'a [Point],
}
impl FaceSet for Faces<'_> {
    fn faces(&self) -> usize {
        self.faces.len()
    }
    fn side(&self, f: usize, x: &Point) -> Q {
        let p = &self.faces[f].carrier;
        dot(&p.n, &sub(x, &p.o))
    }
    fn normal(&self, f: usize) -> &Point {
        &self.faces[f].carrier.n
    }
    fn locate(&self, f: usize, x: &Point) -> Result<Location> {
        let face = self.faces[f];
        let at = ExactPoint::from_rational(face.carrier.chart(x)?);
        let mut winding = 0;
        for lp in &face.loops {
            for k in 0..lp.len() {
                let [a, b] = [lp[k], lp[(k + 1) % lp.len()]].map(|p| face.carrier.chart(&self.points[p.index()]));
                let piece = Trimmed::new([ExactPoint::from_rational(a?), ExactPoint::from_rational(b?)], Carrier::Line)
                    .map_err(|r| Refused(r.name()))?;
                if piece.contains(&at).map_err(|r| Refused(r.name()))? {
                    return Ok(Location::Boundary);
                }
                winding += piece.winding(&at).map_err(|r| Refused(r.name()))?;
            }
        }
        Ok(if winding != 0 { Location::Inside } else { Location::Outside })
    }
}

fn find(parent: &mut [usize], mut i: usize) -> usize {
    while parent[i] != i {
        parent[i] = parent[parent[i]];
        i = parent[i];
    }
    i
}

/// Exact point on the closed segment `[a, b]`.
fn on_segment(x: &Point, a: &Point, b: &Point) -> bool {
    let (d, w) = (sub(b, a), sub(x, a));
    let t = dot(&w, &d);
    cross(&d, &w).iter().all(Q::is_zero) && !t.is_negative() && t <= dot(&d, &d)
}

/// Winding of a cell's cycles around a chart point off them.
fn in_cell(split: &FaceSplit, cell: usize, p: &ExactPoint) -> Result<bool> {
    let arr = &split.arrangement;
    let mut winding = 0;
    for cycle in &arr.cells[cell].cycles {
        winding += arr.cycle_profile(cycle).winding(p).map_err(|r| Refused(r.name()))?;
    }
    Ok(winding != 0)
}

/// The boundary cycles (as P3 points) of a region of kept cells of one
/// face, without the internal pieces between them: its half-edges linked
/// head to tail. A vertex with two outgoing boundary half-edges is a pinch,
/// which a face loop cannot carry.
fn region_loops(split: &FaceSplit, cells: &[usize], internal: &BTreeSet<usize>) -> Result<Vec<Vec<PointId>>> {
    let arr = &split.arrangement;
    let boundary: Vec<usize> = cells.iter().flat_map(|&c| arr.cells[c].cycles.iter().flatten().copied()).filter(|h| !internal.contains(&(h / 2))).collect();
    let mut next: BTreeMap<usize, usize> = BTreeMap::new();
    for &h in &boundary {
        if next.insert(arr.tail(h), h).is_some() {
            return Err(Refused(contract::MERGE_PINCH));
        }
    }
    let mut seen = BTreeSet::new();
    let mut loops = vec![];
    for &start in &boundary {
        if seen.contains(&start) {
            continue;
        }
        let mut lp = vec![];
        let mut h = start;
        while seen.insert(h) {
            lp.push(split.points[arr.tail(h)]);
            h = *next.get(&arr.tail(h ^ 1)).ok_or(Refused(contract::ASSEMBLE_EDGE))?;
        }
        if h != start {
            return Err(Refused(contract::ASSEMBLE_EDGE));
        }
        loops.push(lp);
    }
    Ok(loops)
}

/// The loops of a region ordered outer first (the largest exact area) and
/// oriented counter-clockwise about the outward normal, holes clockwise.
pub(crate) fn orient(carrier: &Plane3, forward: bool, loops: Vec<Vec<PointId>>, points: &[Point]) -> Result<Vec<Vec<PointId>>> {
    let mut areas: Vec<(Q, Vec<PointId>)> = loops
        .into_iter()
        .map(|lp| {
            let ps: Vec<&Point> = lp.iter().map(|p| &points[p.index()]).collect();
            area2(carrier, &ps).map(|a| (a, lp))
        })
        .collect::<Result<_>>()?;
    let outer = (0..areas.len()).max_by(|&i, &j| areas[i].0.abs().cmp(&areas[j].0.abs())).ok_or(Refused(contract::ASSEMBLE_EDGE))?;
    areas.swap(0, outer);
    let flip = areas[0].0.is_positive() != forward;
    let mut out = vec![];
    for (k, (a, mut lp)) in areas.into_iter().enumerate() {
        if a.is_zero() || (a.is_positive() != forward) != (flip != (k > 0)) {
            return Err(Refused(contract::ASSEMBLE_EDGE));
        }
        if flip {
            lp.reverse();
        }
        out.push(lp);
    }
    Ok(out)
}

/// P7: selection, sewing, the manifold checks, shells and solids.
pub(crate) fn assemble(
    ops: &Operands,
    ix: &Intersection,
    splits: &[Vec<FaceSplit>; 2],
    fragments: &[Fragment],
    op: Op,
) -> Result<Assembly> {
    let points = &ix.paves.points;
    // Selection: the kept cells of every operand face, with their reversal.
    let mut kept: BTreeMap<(Side, FaceId), (Vec<usize>, bool)> = BTreeMap::new();
    for fr in fragments {
        let Some(reversed) = keep(op, fr.side, fr.class) else { continue };
        let entry = kept.entry((fr.side, fr.face)).or_insert((vec![], reversed));
        if entry.1 != reversed {
            return Err(Refused(contract::ASSEMBLE_EDGE));
        }
        entry.0.push(fr.cell);
    }
    if kept.is_empty() {
        return Err(Refused(contract::EMPTY_RESULT));
    }
    // Uses of every piece by the kept cells, before any re-join.
    let mut raw: BTreeMap<EdgeKey, usize> = BTreeMap::new();
    for ((side, face), (cells, _)) in &kept {
        let split = &splits[side.index()][face.index()];
        let arr = &split.arrangement;
        for &cell in cells {
            for &h in arr.cells[cell].cycles.iter().flatten() {
                *raw.entry(key(split.points[arr.tail(h)], split.points[arr.tail(h ^ 1)])).or_default() += 1;
            }
        }
    }
    if raw.values().any(|&n| n > 2) {
        return Err(Refused(contract::NON_MANIFOLD_RESULT));
    }
    // Re-join: a piece whose two sides are kept cells of the same face only
    // cut that face; it is not an edge. (Nothing else uses it: its two uses
    // are those cells, and no piece has more than two.)
    let mut faces = vec![];
    for ((side, face), (cells, reversed)) in &kept {
        let placed = ops.get(*side);
        let split = &splits[side.index()][face.index()];
        let arr = &split.arrangement;
        let mut parent: Vec<usize> = (0..arr.cells.len()).collect();
        let mut internal = BTreeSet::new();
        for p in 0..arr.pieces.len() {
            let (l, r) = (arr.face[2 * p], arr.face[2 * p + 1]);
            if cells.contains(&l) && cells.contains(&r) {
                internal.insert(p);
                let (a, b) = (find(&mut parent, l), find(&mut parent, r));
                parent[a] = b;
            }
        }
        let mut groups: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
        for &cell in cells {
            let root = find(&mut parent, cell);
            groups.entry(root).or_default().push(cell);
        }
        let carrier = placed.working_carrier(*face);
        let forward = placed.model.draft().faces[face.index()].forward != *reversed;
        let provenance = placed.provenance[placed.model.draft().faces[face.index()].surface.index()];
        for group in groups.into_values() {
            let loops = region_loops(split, &group, &internal)?;
            let loops = orient(&carrier, forward, loops, points)?;
            faces.push(ResultFace { side: *side, face: *face, cells: group, carrier: carrier.clone(), forward, loops, provenance });
        }
    }

    // Sewing: uses of every edge.
    let mut uses: BTreeMap<EdgeKey, Vec<(usize, bool)>> = BTreeMap::new();
    let mut corners: BTreeMap<PointId, Vec<(EdgeKey, EdgeKey)>> = BTreeMap::new();
    for (f, face) in faces.iter().enumerate() {
        for lp in &face.loops {
            let n = lp.len();
            for k in 0..n {
                let (a, b, c) = (lp[k], lp[(k + 1) % n], lp[(k + 2) % n]);
                uses.entry(key(a, b)).or_default().push((f, a < b));
                corners.entry(b).or_default().push((key(a, b), key(b, c)));
            }
        }
    }
    for list in uses.values() {
        let ahead = list.iter().filter(|u| u.1).count();
        if list.len() % 2 == 1 || 2 * ahead != list.len() {
            return Err(Refused(contract::ASSEMBLE_EDGE));
        }
    }
    if uses.values().any(|l| l.len() > 2) {
        return Err(Refused(contract::NON_MANIFOLD_RESULT));
    }
    // Vertex links: one cycle of edges around every vertex.
    for links in corners.values() {
        let first = links[0].0;
        let mut reached = BTreeSet::from([first]);
        let mut todo = vec![first];
        while let Some(e) = todo.pop() {
            for &(x, y) in links {
                for (p, q) in [(x, y), (y, x)] {
                    if p == e && reached.insert(q) {
                        todo.push(q);
                    }
                }
            }
        }
        let incident: BTreeSet<EdgeKey> = links.iter().flat_map(|&(x, y)| [x, y]).collect();
        if reached != incident {
            return Err(Refused(contract::NON_MANIFOLD_RESULT));
        }
    }
    // Point and line contacts inside a kept face: a P5 touch point that is a
    // result vertex, or a slit whose midpoint lies on a result edge.
    let vertices: BTreeSet<&Point> = corners.keys().map(|p| &points[p.index()]).collect();
    let segments: Vec<[&Point; 2]> = uses.keys().map(|(a, b)| [&points[a.index()], &points[b.index()]]).collect();
    let two = Q::from_integer(2.into());
    for face in &faces {
        let placed = ops.get(face.side);
        let split = &splits[face.side.index()][face.face.index()];
        let inside = |p: &ExactPoint| -> Result<bool> {
            for &cell in &face.cells {
                if in_cell(split, cell, p)? {
                    return Ok(true);
                }
            }
            Ok(false)
        };
        for t in &split.touches {
            // A touch at a vertex of the arrangement is part of the sewn
            // topology (the vertex links see it); only one strictly inside a
            // cell is invisible to sewing.
            if split.arrangement.points.contains(t) {
                continue;
            }
            if inside(t)? && vertices.contains(&placed.point(face.face, t.rat().map_err(|r| Refused(r.name()))?)) {
                return Err(Refused(contract::NON_MANIFOLD_RESULT));
            }
        }
        for slit in &split.slits {
            let [p, q] = [slit.piece.ends()[0].rat().map_err(|r| Refused(r.name()))?, slit.piece.ends()[1].rat().map_err(|r| Refused(r.name()))?];
            let mid = [(&p[0] + &q[0]) / &two, (&p[1] + &q[1]) / &two];
            if !inside(&ExactPoint::from_rational(mid.clone()))? {
                continue;
            }
            let m = placed.point(face.face, &mid);
            if vertices.contains(&m) || segments.iter().any(|[a, b]| on_segment(&m, a, b)) {
                return Err(Refused(contract::NON_MANIFOLD_RESULT));
            }
        }
    }

    // Shells: edge-connected face components, in order of their first face.
    let mut parent: Vec<usize> = (0..faces.len()).collect();
    for list in uses.values() {
        let (a, b) = (find(&mut parent, list[0].0), find(&mut parent, list[1].0));
        parent[a] = b;
    }
    let mut by_root: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for f in 0..faces.len() {
        let root = find(&mut parent, f);
        by_root.entry(root).or_default().push(f);
    }
    let mut shells: Vec<Vec<usize>> = by_root.into_values().collect();
    shells.sort();
    // Signed volumes (six times; divergence theorem, a fan per loop).
    let volume6 = |shell: &[usize]| {
        let mut v = Q::zero();
        for &f in shell {
            for lp in &faces[f].loops {
                let p0 = &points[lp[0].index()];
                for k in 1..lp.len() - 1 {
                    v += dot(p0, &cross(&points[lp[k].index()], &points[lp[k + 1].index()]));
                }
            }
        }
        v
    };
    let volumes: Vec<Q> = shells.iter().map(|s| volume6(s)).collect();
    if volumes.iter().any(Q::is_zero) {
        return Err(Refused(contract::ASSEMBLE_VOLUME));
    }
    let outer: Vec<usize> = (0..shells.len()).filter(|&s| volumes[s].is_positive()).collect();
    let mut solids: Vec<Vec<usize>> = outer.iter().map(|&s| vec![s]).collect();
    for void in (0..shells.len()).filter(|&s| volumes[s].is_negative()) {
        let x = &points[faces[shells[void][0]].loops[0][0].index()];
        let mut best: Option<usize> = None;
        for (k, &o) in outer.iter().enumerate() {
            let set = Faces { faces: shells[o].iter().map(|&f| &faces[f]).collect(), points };
            match membership(&set, x, false)? {
                Member::In => {
                    if best.is_none_or(|b| volumes[o] < volumes[outer[b]]) {
                        best = Some(k);
                    }
                }
                Member::Out => {}
                Member::On(_) => return Err(Refused(contract::NON_MANIFOLD_RESULT)),
            }
        }
        match best {
            Some(k) => solids[k].push(void),
            None => return Err(Refused(contract::ASSEMBLE_NESTING)),
        }
    }
    Ok(Assembly { faces, shells, solids })
}

impl Assembly {
    /// The draft of the given solids (all when `only` is `None`), in the
    /// working frame with `placement`. Normalize coplanar faces and straight
    /// edge subdivisions after the raw assembly's contact checks. Rebaked
    /// carriers get fresh, globally stable slots in construction node `node`:
    /// two source carriers with equal provenance in different placements must
    /// not claim identity once both live in this working frame. Normalizing
    /// all solids before extraction keeps those slots stable in `solids()`.
    pub fn draft(&self, points: &[Point], placement: wonky_geom::frame::Frame, label: Label, node: u32, only: Option<usize>) -> Result<Draft> {
        let normalized = crate::merge::normalize(self, points)?;
        let created = |slot: usize| Provenance { node, slot: slot as u32 };
        let mut d = Draft {
            placement,
            label,
            surfaces: vec![],
            curves: vec![],
            vertices: vec![],
            edges: vec![],
            coedges: vec![],
            loops: vec![],
            faces: vec![],
            shells: vec![],
            solids: vec![],
        };
        let mut vertex_ids: BTreeMap<PointId, VertexId> = BTreeMap::new();
        let mut edge_ids: BTreeMap<EdgeKey, EdgeId> = BTreeMap::new();
        // Visit every preceding solid even when extracting: construction slots
        // belong to the combined result, never to an extraction-local index.
        let mut offsets = [0usize; 8];
        for (solid_index, solid) in self.solids.iter().enumerate() {
            let mut shell_ids = vec![];
            for &s in solid {
                let mut face_ids = vec![];
                for &f in &normalized.shells[s] {
                    let face = &normalized.faces[f];
                    let surface = SurfaceId(d.surfaces.len() as u32);
                    d.surfaces.push(Surface { carrier: Carrier3::Plane(face.carrier.clone()), provenance: created(f) });
                    let mut loop_ids = vec![];
                    for lp in &face.loops {
                        let mut coedges = vec![];
                        for k in 0..lp.len() {
                            let (a, b) = (lp[k], lp[(k + 1) % lp.len()]);
                            for p in [a, b] {
                                if !vertex_ids.contains_key(&p) {
                                    let id = VertexId(d.vertices.len() as u32);
                                    d.vertices.push(Vertex { def: VertexDef::Rational(points[p.index()].clone()), provenance: created(offsets[0] + id.index()) });
                                    vertex_ids.insert(p, id);
                                }
                            }
                            let (lo, hi) = key(a, b);
                            let edge = match edge_ids.get(&(lo, hi)) {
                                Some(&e) => e,
                                None => {
                                    let e = EdgeId(d.edges.len() as u32);
                                    let curve = CurveId(d.curves.len() as u32);
                                    let (p, q) = (&points[lo.index()], &points[hi.index()]);
                                    d.curves.push(Curve { geometry: Curve3::Line { p: p.clone(), d: sub(q, p) }, provenance: created(offsets[1] + curve.index()) });
                                    d.edges.push(Edge { curve, bounds: Bounds::Segment([vertex_ids[&lo], vertex_ids[&hi]]), provenance: created(offsets[2] + e.index()) });
                                    edge_ids.insert((lo, hi), e);
                                    e
                                }
                            };
                            let chart = |p: PointId| face.carrier.chart(&points[p.index()]).map(ExactPoint::from_rational);
                            let pcurve = Trimmed::new([chart(a)?, chart(b)?], Carrier::Line).map_err(|r| Refused(r.name()))?;
                            let id = CoedgeId(d.coedges.len() as u32);
                            d.coedges.push(Coedge { edge, forward: a == lo, pcurve, atlas: None, provenance: created(offsets[3] + id.index()) });
                            coedges.push(id);
                        }
                        let id = LoopId(d.loops.len() as u32);
                        d.loops.push(Loop { coedges, provenance: created(offsets[4] + id.index()) });
                        loop_ids.push(id);
                    }
                    let id = FaceId(d.faces.len() as u32);
                    d.faces.push(Face { surface, forward: face.forward, loops: loop_ids, provenance: created(offsets[5] + id.index()) });
                    face_ids.push(id);
                }
                let id = ShellId(d.shells.len() as u32);
                d.shells.push(Shell { faces: face_ids, provenance: created(offsets[6] + id.index()) });
                shell_ids.push(id);
            }
            let id = d.solids.len();
            d.solids.push(Solid { shells: shell_ids, provenance: created(offsets[7] + id) });
            if only == Some(solid_index) { return Ok(d); }
            if only.is_some() {
                let counts = [d.vertices.len(), d.curves.len(), d.edges.len(), d.coedges.len(), d.loops.len(), d.faces.len(), d.shells.len(), d.solids.len()];
                for (offset, count) in offsets.iter_mut().zip(counts) { *offset += count; }
                d.vertices.clear(); d.curves.clear(); d.edges.clear(); d.coedges.clear();
                d.loops.clear(); d.faces.clear(); d.shells.clear(); d.solids.clear(); d.surfaces.clear();
                vertex_ids.clear(); edge_ids.clear();
            }
        }
        Ok(d)
    }

    /// The checked Model of the given solids (all when `only` is `None`).
    pub fn model(&self, points: &[Point], placement: wonky_geom::frame::Frame, label: Label, node: u32, only: Option<usize>) -> Result<Model> {
        let model = self.draft(points, placement, label, node, only)?.check().map_err(|_| Refused(contract::ASSEMBLE_AUDIT))?;
        crate::resolution::certify(&model)?;
        Ok(model)
    }
}
