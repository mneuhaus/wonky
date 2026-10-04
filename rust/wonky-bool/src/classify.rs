//! P6: every fragment of both operands (a cell of a face split that lies in
//! the face) is classified against the OTHER operand as IN, OUT, ON-same or
//! ON-opposite. Every decision is an exact rational test in the working
//! frame; no binary64 value is read (rule X1).
//!
//! 1. **Coplanar (ON).** The fragment's witness is located in every face of
//!    the other operand whose carrier the relation table (P1) proved
//!    identical or opposite. In such a face (or on its boundary: two coplanar
//!    faces of one operand may share an edge) the fragment is ON; the outward
//!    normals decide same or opposite. Two coplanar faces that disagree are
//!    `classify/on-orientation`.
//! 2. **Local side test.** At each section piece on a fragment's boundary
//!    that lies in the relative interior of the other operand's face `g`
//!    (P4's `boundary` flag), the other operand's boundary near the piece is
//!    `g` alone. The direction `d` from the piece's midpoint into the
//!    fragment (the left normal of the fragment's half-edge, carried to 3D
//!    by the face's exact chart) then decides: `outward(g) . d < 0` is IN,
//!    `> 0` is OUT; zero cannot happen at a transverse pair
//!    (`classify/local`, also when two local tests of one fragment disagree).
//!    Pieces on `g`'s boundary (a contact along an edge of the other
//!    operand) are not tested locally.
//! 3. **Propagation.** Two fragments that use one old edge sub-range (between
//!    two consecutive P3 paves) from its two sides have the same class when
//!    the sub-range's midpoint is off the other operand's boundary: the
//!    paves are every point where the edge meets that boundary, so the open
//!    sub-range does not touch it. Propagation never crosses a section piece
//!    (the planted negative `plant_classify_cross_section` does). A
//!    propagated class that contradicts a seed is `classify/propagation`;
//!    every old sub-range must have exactly two fragment uses
//!    (`classify/edge-uses`).
//! 4. **Ray parity per untouched component.** A connected component without
//!    a seed (no section piece interior to a face of the other operand, e.g.
//!    a tool strictly inside the target) gets one exact membership test of
//!    its first fragment's witness: a ray with a rational direction from a
//!    fixed list, re-chosen when it meets an edge, a vertex or lies in a face
//!    plane; the list running out is `boolean/classification-undecided`.
//! 5. **Second opinion (plan C12, every fragment).** Each fragment's witness
//!    is classified again by direct ray membership, with the direction list
//!    in reverse order; on the boundary, by the exact sign of the two
//!    outward normals' dot product (not the relation table). Any
//!    disagreement is `classify/second-opinion`. Propagation and direct
//!    membership share only the face predicates (`Placed::locate`,
//!    `WorkingPlane::side`).
//!
//! **No-Claim.** Tangent contacts of curved carriers (second-order data) are
//! G9; here every carrier is a plane.
use crate::contract;
use crate::operand::{Location, Operands, Placed, Side, SIDES};
use crate::relation::PlaneRelation;
use crate::split::{FaceSplit, Source};
use crate::Intersection;
use num_traits::{Signed, Zero};
use std::collections::BTreeMap;
use wonky_curve::Carrier;
use wonky_geom::model::{EdgeId, FaceId};
use wonky_geom::{dot, sub, Point, Refused, Result, Q};

/// The class of a fragment against the other operand.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Class {
    In,
    Out,
    /// On the other operand's boundary, outward normals the same way.
    OnSame,
    /// On the other operand's boundary, outward normals opposite.
    OnOpposite,
}

/// Which step decided a fragment's class.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Decided {
    Coplanar,
    Local,
    Propagated,
    Ray,
}

/// One fragment and its class.
#[derive(Clone, Debug)]
pub struct Fragment {
    pub side: Side,
    pub face: FaceId,
    /// Its cell in the face's arrangement.
    pub cell: usize,
    /// Its witness in the working frame.
    pub witness: Point,
    pub class: Class,
    pub decided: Decided,
}

/// A set of planar faces a ray can be shot at: the other operand, or the
/// shells of an assembled result (nesting).
pub(crate) trait FaceSet {
    fn faces(&self) -> usize;
    /// `n . (x - o)` of face `f`'s carrier.
    fn side(&self, f: usize, x: &Point) -> Q;
    /// The carrier normal of face `f`.
    fn normal(&self, f: usize) -> &Point;
    /// Exact location of a point of face `f`'s carrier.
    fn locate(&self, f: usize, x: &Point) -> Result<Location>;
}

impl FaceSet for Placed<'_> {
    fn faces(&self) -> usize {
        self.model.draft().faces.len()
    }
    fn side(&self, f: usize, x: &Point) -> Q {
        self.face_plane(FaceId(f as u32)).side(x)
    }
    fn normal(&self, f: usize) -> &Point {
        &self.face_plane(FaceId(f as u32)).n
    }
    fn locate(&self, f: usize, x: &Point) -> Result<Location> {
        Placed::locate(self, FaceId(f as u32), x)
    }
}

/// Exact membership of a point in the solid bounded by a face set.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Member {
    In,
    Out,
    /// On face `f` (in it or on its boundary).
    On(usize),
}

/// Ray directions, tried in order (or in reverse for the second opinion)
/// until one ray meets no edge and lies in no face plane.
const DIRECTIONS: [[i64; 3]; 12] = [
    [2, 3, 5],
    [3, -5, 7],
    [-5, 7, 11],
    [7, 11, -13],
    [11, -13, 17],
    [-13, 17, 19],
    [17, 19, -23],
    [19, -23, 29],
    [-23, 29, 31],
    [29, 31, -37],
    [31, -37, 41],
    [-37, 41, 43],
];

/// Membership of `x` by exact ray parity: on the boundary when it lies in a
/// face; else the parity of the faces a ray crosses in their interiors.
pub(crate) fn membership(set: &impl FaceSet, x: &Point, reverse: bool) -> Result<Member> {
    for f in 0..set.faces() {
        if set.side(f, x).is_zero() && set.locate(f, x)? != Location::Outside {
            return Ok(Member::On(f));
        }
    }
    let order: Vec<&[i64; 3]> = if reverse { DIRECTIONS.iter().rev().collect() } else { DIRECTIONS.iter().collect() };
    'ray: for direction in order {
        let d: Point = direction.map(|c| Q::from_integer(c.into()));
        let mut crossings = 0u32;
        for f in 0..set.faces() {
            let (nd, s) = (dot(set.normal(f), &d), set.side(f, x));
            if nd.is_zero() {
                if s.is_zero() {
                    continue 'ray; // the ray lies in this face's plane
                }
                continue;
            }
            let t = -s / &nd;
            if !t.is_positive() {
                continue; // behind the start, or the start on the plane outside the face
            }
            let hit: Point = std::array::from_fn(|k| &x[k] + &t * &d[k]);
            match set.locate(f, &hit)? {
                Location::Inside => crossings += 1,
                Location::Boundary => continue 'ray, // through an edge or a vertex
                Location::Outside => {}
            }
        }
        return Ok(if crossings % 2 == 1 { Member::In } else { Member::Out });
    }
    Err(Refused(contract::CLASSIFICATION_UNDECIDED))
}

fn faces(placed: &Placed) -> impl Iterator<Item = FaceId> {
    (0..placed.model.draft().faces.len()).map(|f| FaceId(f as u32))
}

/// Step 1: ON against the coplanar faces of the other operand.
fn coplanar(ops: &Operands, ix: &Intersection, side: Side, f: FaceId, w: &Point) -> Result<Option<Class>> {
    let (me, other) = (ops.get(side), ops.get(side.other()));
    let fs = me.model.draft().faces[f.index()].surface;
    let forward = me.model.draft().faces[f.index()].forward;
    let mut found = None;
    for g in faces(other) {
        let gface = &other.model.draft().faces[g.index()];
        let relation = match side {
            Side::A => ix.relations.get(fs, gface.surface),
            Side::B => ix.relations.get(gface.surface, fs),
        };
        let aligned = match relation.kind {
            PlaneRelation::Identical => true,
            PlaneRelation::Opposite => false,
            PlaneRelation::ParallelDisjoint { .. } | PlaneRelation::Transverse { .. } => continue,
        };
        if other.locate(g, w)? == Location::Outside {
            continue;
        }
        let class = if aligned == (forward == gface.forward) { Class::OnSame } else { Class::OnOpposite };
        if found.is_some_and(|c| c != class) {
            return Err(Refused(contract::CLASSIFY_ON));
        }
        found = Some(class);
    }
    Ok(found)
}

/// Step 2: the local side tests at the fragment's section pieces.
fn local(ops: &Operands, ix: &Intersection, split: &FaceSplit, cell: usize) -> Result<Option<Class>> {
    let arr = &split.arrangement;
    let me = ops.get(split.side);
    let o = split.side.other();
    let two = Q::from_integer(2.into());
    let mut found = None;
    for &h in arr.cells[cell].cycles.iter().flatten() {
        for &(leaf, index, _) in &arr.pieces[h / 2].owners {
            let (section, piece) = match split.leaves[leaf].sources[index] {
                Source::Section { section, piece } => (section, piece),
                Source::Old { .. } => continue,
            };
            let s = &ix.sections[section];
            if s.pieces[piece].boundary[o.index()] {
                continue; // on an edge of the other operand: no single face there
            }
            let seg = arr.oriented(h);
            match seg.carrier() {
                Carrier::Line => {}
                Carrier::Circle(_) | Carrier::BSpline(_) => return Err(Refused(contract::CLASSIFY_LOCAL)),
            }
            let [t0, t1] = [seg.ends()[0].rat().map_err(|r| Refused(r.name()))?, seg.ends()[1].rat().map_err(|r| Refused(r.name()))?];
            let mid = [(&t0[0] + &t1[0]) / &two, (&t0[1] + &t1[1]) / &two];
            let left = [&mid[0] - (&t1[1] - &t0[1]), &mid[1] + (&t1[0] - &t0[0])];
            let d = sub(&me.point(split.face, &left), &me.point(split.face, &mid));
            let sign = dot(&ops.get(o).outward(s.faces[o.index()]), &d);
            #[cfg(feature = "plant_classify_side_flip")]
            let sign = -sign;
            let class = if sign.is_negative() {
                Class::In
            } else if sign.is_positive() {
                Class::Out
            } else {
                return Err(Refused(contract::CLASSIFY_LOCAL));
            };
            if found.is_some_and(|c| c != class) {
                return Err(Refused(contract::CLASSIFY_LOCAL));
            }
            found = Some(class);
        }
    }
    Ok(found)
}

fn find(parent: &mut [usize], mut i: usize) -> usize {
    while parent[i] != i {
        parent[i] = parent[parent[i]];
        i = parent[i];
    }
    i
}

/// Exact point on the other operand's boundary.
fn on_boundary(other: &Placed, x: &Point) -> Result<bool> {
    for g in faces(other) {
        if other.face_plane(g).side(x).is_zero() && other.locate(g, x)? != Location::Outside {
            return Ok(true);
        }
    }
    Ok(false)
}

/// P6 for both operands. `splits` are P5's face splits.
pub(crate) fn classify(ops: &Operands, ix: &Intersection, splits: &[Vec<FaceSplit>; 2]) -> Result<Vec<Fragment>> {
    let mut out = vec![];
    for side in SIDES {
        let me = ops.get(side);
        let other = ops.get(side.other());
        let d = me.model.draft();
        // Steps 1 and 2: seeds.
        let mut frags: Vec<Fragment> = vec![];
        let mut seeded: Vec<bool> = vec![];
        for split in &splits[side.index()] {
            for &cell in &split.fragments {
                let witness = me.point(split.face, split.witnesses[cell].rat().map_err(|r| Refused(r.name()))?);
                let (class, decided) = match coplanar(ops, ix, side, split.face, &witness)? {
                    Some(c) => (Some(c), Decided::Coplanar),
                    None => (local(ops, ix, split, cell)?, Decided::Local),
                };
                seeded.push(class.is_some());
                frags.push(Fragment { side, face: split.face, cell, witness, class: class.unwrap_or(Class::Out), decided });
            }
        }
        // Step 3: fragments that share an old edge sub-range off the other boundary.
        let index: BTreeMap<(FaceId, usize), usize> = frags.iter().enumerate().map(|(i, f)| ((f.face, f.cell), i)).collect();
        let mut uses: BTreeMap<(EdgeId, crate::PointId, crate::PointId), Vec<usize>> = BTreeMap::new();
        for (i, fr) in frags.iter().enumerate() {
            let split = &splits[side.index()][fr.face.index()];
            let arr = &split.arrangement;
            for &h in arr.cells[fr.cell].cycles.iter().flatten() {
                for &(leaf, source, _) in &arr.pieces[h / 2].owners {
                    match split.leaves[leaf].sources[source] {
                        Source::Old { coedge, ends } => {
                            let e = d.coedges[coedge.index()].edge;
                            let list = uses.entry((e, ends[0].min(ends[1]), ends[0].max(ends[1]))).or_default();
                            if !list.contains(&i) {
                                list.push(i);
                            }
                        }
                        Source::Section { .. } => {}
                    }
                }
            }
        }
        let mut parent: Vec<usize> = (0..frags.len()).collect();
        let two = Q::from_integer(2.into());
        for ((_, p, q), list) in &uses {
            if list.len() != 2 {
                return Err(Refused(contract::CLASSIFY_EDGE_USES));
            }
            let (x, y) = (ix.paves.point(*p), ix.paves.point(*q));
            let mid: Point = std::array::from_fn(|k| (&x[k] + &y[k]) / &two);
            if !on_boundary(other, &mid)? {
                let (a, b) = (find(&mut parent, list[0]), find(&mut parent, list[1]));
                parent[a] = b;
            }
        }
        #[cfg(feature = "plant_classify_cross_section")]
        for split in &splits[side.index()] {
            // PLANTED NEGATIVE (wrong on purpose): propagation also crosses
            // the section pieces between two fragments of one face.
            let arr = &split.arrangement;
            for (p, piece) in arr.pieces.iter().enumerate() {
                let section = piece.owners.iter().any(|&(leaf, _, _)| leaf >= split.loops);
                let cells = [arr.face[2 * p], arr.face[2 * p + 1]];
                if let (true, Some(&a), Some(&b)) = (section, index.get(&(split.face, cells[0])), index.get(&(split.face, cells[1]))) {
                    let (a, b) = (find(&mut parent, a), find(&mut parent, b));
                    parent[a] = b;
                }
            }
        }
        let _ = &index;
        // Step 4: propagate the seeds; one ray per component without one.
        let mut components: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
        for i in 0..frags.len() {
            let root = find(&mut parent, i);
            components.entry(root).or_default().push(i);
        }
        for members in components.values() {
            let seeds: Vec<Class> = members.iter().filter(|&&i| seeded[i]).map(|&i| frags[i].class).collect();
            let class = match seeds.first() {
                Some(&c) => {
                    if seeds.iter().any(|&s| s != c) || (members.len() > 1 && matches!(c, Class::OnSame | Class::OnOpposite)) {
                        return Err(Refused(contract::CLASSIFY_PROPAGATION));
                    }
                    c
                }
                None => match membership(other, &frags[members[0]].witness, false)? {
                    Member::In => Class::In,
                    Member::Out => Class::Out,
                    Member::On(_) => return Err(Refused(contract::CLASSIFY_RAY)),
                },
            };
            for &i in members {
                if !seeded[i] {
                    frags[i].class = class;
                    frags[i].decided = if seeds.is_empty() { Decided::Ray } else { Decided::Propagated };
                }
            }
        }
        // Step 5: the second opinion on every fragment.
        for fr in &frags {
            let agrees = match membership(other, &fr.witness, true)? {
                Member::In => fr.class == Class::In,
                Member::Out => fr.class == Class::Out,
                Member::On(g) => {
                    let s = dot(&me.outward(fr.face), &other.outward(FaceId(g as u32)));
                    (s.is_positive() && fr.class == Class::OnSame) || (s.is_negative() && fr.class == Class::OnOpposite)
                }
            };
            if !agrees {
                return Err(Refused(contract::CLASSIFY_SECOND_OPINION));
            }
        }
        out.extend(frags);
    }
    Ok(out)
}
