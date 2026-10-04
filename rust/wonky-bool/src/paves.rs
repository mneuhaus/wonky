//! P3: interference of the two operands' vertices, edges and faces, decided
//! once each, in increasing dimension (rule X2), and the paves it leaves on
//! every edge.
//!
//! | order | fact | exact test |
//! |---|---|---|
//! | V-V | an A vertex and a B vertex are one point | equal exact points (one registry key) |
//! | V-E | a vertex lies in the interior of an edge of the other operand | `(p - a) x (b - a) = 0` and `0 < t < 1` |
//! | E-E | an A edge and a B edge cross at a point interior to both | coplanar, not parallel, `0 < t, u < 1` |
//! | V-F | a vertex lies in the interior of a face of the other operand | on the carrier, not on a boundary already recorded, winding in the face's own chart |
//! | E-F | an edge crosses the interior of a face of the other operand | end sides of strictly opposite sign, crossing point inside in the face's chart |
//!
//! A later test never re-decides an earlier one: V-F and E-F skip points that
//! V-V, V-E and E-E already put on the face's boundary, and a boundary point
//! they did not record is a contract violation (`vertex-face-boundary`,
//! `edge-face-boundary`). Edge contacts along a common line or plane (an edge
//! on a face, collinear edges) leave no new point: their ends are vertices
//! that V-V and V-E recorded.
//!
//! **Point identity.** Every point, old or new, goes through one registry
//! keyed by its exact coordinates: two points are one only when they are
//! equal, never because they are close (dedup only by exact equality). The
//! planted negative `plant_pave_cache_dedup` keys the registry by binary64
//! world caches instead.
//!
//! **Paves.** Each edge's paves are its end points and the V-E, E-E and E-F
//! points on it, ordered by the exact parameter from its first vertex; each
//! is re-checked to lie on the edge, strictly ordered (`pave-on-edge`).
use crate::boxes::Boxes;
use crate::contract;
use crate::operand::{sign, Location, Operands, Side, SIDES};
use num_traits::{Signed, Zero};
use std::collections::BTreeMap;
use wonky_geom::model::{EdgeId, FaceId, VertexId};
use wonky_geom::{cross, dot, sub, Point, Refused, Result, Q};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct PointId(pub u32);
impl PointId {
    pub fn index(self) -> usize {
        self.0 as usize
    }
}

/// A vertex of `side` in the interior of an edge of the other operand.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VertexOnEdge {
    pub side: Side,
    pub vertex: VertexId,
    pub edge: EdgeId,
}
/// An A edge and a B edge crossing at a point interior to both.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EdgeCrossing {
    pub edges: [EdgeId; 2],
    pub point: PointId,
}
/// A vertex of `side` in the interior of a face of the other operand.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VertexOnFace {
    pub side: Side,
    pub vertex: VertexId,
    pub face: FaceId,
}
/// An edge of `side` crossing the interior of a face of the other operand at
/// a point interior to the edge.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EdgeThroughFace {
    pub side: Side,
    pub edge: EdgeId,
    pub face: FaceId,
    pub point: PointId,
}

/// The P3 record.
#[derive(Clone, Debug)]
pub struct Paves {
    /// Every distinct exact point (working frame): the operands' vertices,
    /// one per V-V identity, then the new E-E and E-F points.
    pub points: Vec<Point>,
    /// Per operand and vertex: its point.
    pub vertices: [Vec<PointId>; 2],
    /// (A vertex, B vertex) pairs that are one point.
    pub vv: Vec<[VertexId; 2]>,
    pub ve: Vec<VertexOnEdge>,
    pub ee: Vec<EdgeCrossing>,
    pub vf: Vec<VertexOnFace>,
    pub ef: Vec<EdgeThroughFace>,
    /// Per operand and edge: its paves from its first vertex to its second.
    pub edges: [Vec<Vec<PointId>>; 2],
}

impl Paves {
    pub fn point(&self, id: PointId) -> &Point {
        &self.points[id.index()]
    }
}

#[cfg(not(feature = "plant_pave_cache_dedup"))]
type Key = Point;
/// PLANTED NEGATIVE: world caches (A's placement, rounded to nearest).
#[cfg(feature = "plant_pave_cache_dedup")]
type Key = [u64; 3];

/// One identity per exact point.
struct Registry {
    points: Vec<Point>,
    index: BTreeMap<Key, PointId>,
    #[cfg(feature = "plant_pave_cache_dedup")]
    placement: wonky_geom::frame::Frame,
}

impl Registry {
    fn new(_ops: &Operands) -> Self {
        Registry {
            points: vec![],
            index: BTreeMap::new(),
            #[cfg(feature = "plant_pave_cache_dedup")]
            placement: _ops.placed[0].model.draft().placement.clone(),
        }
    }
    #[cfg(not(feature = "plant_pave_cache_dedup"))]
    fn key(&self, p: &Point) -> Result<Key> {
        Ok(p.clone())
    }
    /// PLANTED NEGATIVE (wrong on purpose): identity by binary64 world cache.
    #[cfg(feature = "plant_pave_cache_dedup")]
    fn key(&self, p: &Point) -> Result<Key> {
        let w = self.placement.point(p);
        let n = |x: &Q| crate::boxes::nearest(x).map(f64::to_bits);
        Ok([n(&w[0])?, n(&w[1])?, n(&w[2])?])
    }
    fn find(&self, p: &Point) -> Result<Option<PointId>> {
        Ok(self.index.get(&self.key(p)?).copied())
    }
    /// The point's identity, and whether it is new.
    fn intern(&mut self, p: Point) -> Result<(PointId, bool)> {
        let key = self.key(&p)?;
        if let Some(id) = self.index.get(&key) {
            return Ok((*id, false));
        }
        let id = PointId(self.points.len() as u32);
        self.points.push(p);
        self.index.insert(key, id);
        Ok((id, true))
    }
}

/// `p` lies strictly between `a` and `b` on their segment.
fn strictly_inside(p: &Point, a: &Point, b: &Point) -> bool {
    let (d, w) = (sub(b, a), sub(p, a));
    let t = dot(&w, &d);
    cross(&d, &w).iter().all(Q::is_zero) && t.is_positive() && t < dot(&d, &d)
}

fn add(list: &mut Vec<PointId>, id: PointId) {
    if !list.contains(&id) {
        list.push(id);
    }
}

pub(crate) fn interfere(ops: &Operands, boxes: &Boxes) -> Result<Paves> {
    let mut reg = Registry::new(ops);
    let (a, b) = (ops.get(Side::A), ops.get(Side::B));

    // V-V: every vertex gets its point; equal points are one.
    let mut vertices: [Vec<PointId>; 2] = [vec![], vec![]];
    for s in SIDES {
        for p in &ops.get(s).points {
            vertices[s.index()].push(reg.intern(p.clone())?.0);
        }
    }
    let first_a: BTreeMap<PointId, VertexId> =
        vertices[0].iter().enumerate().rev().map(|(v, id)| (*id, VertexId(v as u32))).collect();
    let vv: Vec<[VertexId; 2]> = vertices[1]
        .iter()
        .enumerate()
        .filter_map(|(v, id)| first_a.get(id).map(|va| [*va, VertexId(v as u32)]))
        .collect();
    let mut on: [Vec<Vec<PointId>>; 2] = [0, 1].map(|s| {
        ops.placed[s].ends.iter().map(|[v0, v1]| vec![vertices[s][v0.index()], vertices[s][v1.index()]]).collect()
    });

    // V-E.
    let mut ve = vec![];
    for s in SIDES {
        let (me, other, o) = (ops.get(s), ops.get(s.other()), s.other().index());
        for (v, p) in me.points.iter().enumerate() {
            for (e, [e0, e1]) in other.ends.iter().enumerate() {
                if !boxes.vertices[s.index()][v].meets(&boxes.edges[o][e]) {
                    continue;
                }
                if strictly_inside(p, &other.points[e0.index()], &other.points[e1.index()]) {
                    ve.push(VertexOnEdge { side: s, vertex: VertexId(v as u32), edge: EdgeId(e as u32) });
                    add(&mut on[o][e], vertices[s.index()][v]);
                }
            }
        }
    }

    // E-E.
    let mut ee = vec![];
    for (ea, [a0, a1]) in a.ends.iter().enumerate() {
        for (eb, [b0, b1]) in b.ends.iter().enumerate() {
            if !boxes.edges[0][ea].meets(&boxes.edges[1][eb]) {
                continue;
            }
            let (p, q) = (&a.points[a0.index()], &b.points[b0.index()]);
            let (d, e) = (sub(&a.points[a1.index()], p), sub(&b.points[b1.index()], q));
            let c = cross(&d, &e);
            let w = sub(q, p);
            if c.iter().all(Q::is_zero) || !dot(&w, &c).is_zero() {
                continue; // parallel (collinear overlaps end at V-E points) or skew
            }
            let cc = dot(&c, &c);
            let t = dot(&cross(&w, &e), &c) / &cc;
            let u = dot(&cross(&w, &d), &c) / &cc;
            let one = Q::from_integer(1.into());
            if !(t.is_positive() && t < one && u.is_positive() && u < one) {
                continue; // apart, or at an end (a V-E or V-V fact)
            }
            let x = std::array::from_fn(|k| &p[k] + &t * &d[k]);
            let (id, new) = reg.intern(x)?;
            if !new {
                return Err(Refused(contract::POINT_IDENTITY));
            }
            ee.push(EdgeCrossing { edges: [EdgeId(ea as u32), EdgeId(eb as u32)], point: id });
            add(&mut on[0][ea], id);
            add(&mut on[1][eb], id);
        }
    }

    // V-F.
    let mut vf = vec![];
    for s in SIDES {
        let (me, other, o) = (ops.get(s), ops.get(s.other()), s.other().index());
        for (v, p) in me.points.iter().enumerate() {
            let id = vertices[s.index()][v];
            for (f, edges) in other.face_edges.iter().enumerate() {
                let face = FaceId(f as u32);
                if !boxes.vertices[s.index()][v].meets(&boxes.faces[o][f])
                    || !other.face_plane(face).side(p).is_zero()
                    || edges.iter().any(|e| on[o][e.index()].contains(&id))
                {
                    continue;
                }
                match other.locate(face, p)? {
                    Location::Inside => vf.push(VertexOnFace { side: s, vertex: VertexId(v as u32), face }),
                    Location::Boundary => return Err(Refused(contract::VERTEX_FACE_BOUNDARY)),
                    Location::Outside => {}
                }
            }
        }
    }

    // E-F.
    let mut ef = vec![];
    for s in SIDES {
        let (me, other, o) = (ops.get(s), ops.get(s.other()), s.other().index());
        for (e, [e0, e1]) in me.ends.iter().enumerate() {
            let (p0, p1) = (&me.points[e0.index()], &me.points[e1.index()]);
            for f in 0..other.face_edges.len() {
                let face = FaceId(f as u32);
                if !boxes.edges[s.index()][e].meets(&boxes.faces[o][f]) {
                    continue;
                }
                let plane = other.face_plane(face);
                let (s0, s1) = (plane.side(p0), plane.side(p1));
                if sign(&s0) * sign(&s1) >= 0 {
                    continue; // one side, an end on the plane (V-F, V-E, V-V) or in the plane (E-E, V-E)
                }
                let t = &s0 / (&s0 - &s1);
                let x: Point = std::array::from_fn(|k| &p0[k] + &t * (&p1[k] - &p0[k]));
                if let Some(id) = reg.find(&x)? {
                    if on[s.index()][e].contains(&id) {
                        continue; // decided by V-E or E-E
                    }
                    return Err(Refused(contract::POINT_IDENTITY));
                }
                match other.locate(face, &x)? {
                    Location::Inside => {
                        let (id, _) = reg.intern(x)?;
                        ef.push(EdgeThroughFace { side: s, edge: EdgeId(e as u32), face, point: id });
                        add(&mut on[s.index()][e], id);
                    }
                    Location::Boundary => return Err(Refused(contract::EDGE_FACE_BOUNDARY)),
                    Location::Outside => {}
                }
            }
        }
    }

    // Order every edge's paves by the exact parameter from its first vertex.
    for s in SIDES {
        let me = ops.get(s);
        for (e, list) in on[s.index()].iter_mut().enumerate() {
            let [v0, v1] = me.ends[e];
            let p0 = &me.points[v0.index()];
            let d = sub(&me.points[v1.index()], p0);
            let dd = dot(&d, &d);
            let mut keyed = list
                .iter()
                .map(|id| {
                    let w = sub(&reg.points[id.index()], p0);
                    let t = dot(&w, &d);
                    if !cross(&d, &w).iter().all(Q::is_zero) || t.is_negative() || t > dd {
                        return Err(Refused(contract::PAVE_ON_EDGE));
                    }
                    Ok((t, *id))
                })
                .collect::<Result<Vec<_>>>()?;
            keyed.sort();
            if keyed.windows(2).any(|w| w[0].0 == w[1].0) {
                return Err(Refused(contract::PAVE_ON_EDGE));
            }
            *list = keyed.into_iter().map(|(_, id)| id).collect();
        }
    }
    Ok(Paves { points: reg.points, vertices, vv, ve, ee, vf, ef, edges: on })
}
