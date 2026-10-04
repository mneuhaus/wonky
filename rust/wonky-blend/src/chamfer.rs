//! Exact planar face surgery. Distances are measured along each support in
//! the source normal section; no support is translated by the chamfer width.
use crate::{stripes, Convexity, Refusal, Request, Result, Section};
use num_traits::{One, Zero};
use std::collections::{BTreeMap, BTreeSet};
use wonky_curve::radical::{self, Radical};
use wonky_geom::model::{Bounds, EdgeId, Model, Provenance, VertexDef};
use wonky_geom::{cross, dot, sub, Point, Q};
pub type RPoint = [Radical; 3];
fn rq(q: Q) -> Radical {
    Radical::from(q)
}
fn lift(p: &Point) -> RPoint {
    p.clone().map(rq)
}
fn rsub(a: &RPoint, b: &RPoint) -> RPoint {
    std::array::from_fn(|i| &a[i] - &b[i])
}
fn rdot(a: &RPoint, b: &RPoint) -> Radical {
    (0..3).fold(Radical::default(), |s, i| s + &a[i] * &b[i])
}
fn rcross(a: &RPoint, b: &RPoint) -> RPoint {
    std::array::from_fn(|i| &a[(i + 1) % 3] * &b[(i + 2) % 3] - &a[(i + 2) % 3] * &b[(i + 1) % 3])
}
fn fail<T>(s: &str) -> Result<T> {
    Err(Refusal(format!("chamfer/{s}")))
}
#[derive(Clone, Debug)]
pub struct Plane {
    pub normal: RPoint,
    pub offset: Radical,
}
impl Plane {
    pub fn side(&self, p: &RPoint) -> Radical {
        rdot(&self.normal, p) - &self.offset
    }
}
#[derive(Clone, Debug)]
pub struct Face {
    pub plane: Plane,
    pub loops: Vec<Vec<RPoint>>,
    pub provenance: Provenance,
}
/// Exact, sewn polygon boundary. Observation caches never decide its identity.
#[derive(Clone, Debug)]
pub struct Boundary {
    pub faces: Vec<Face>,
}
impl Boundary {
    pub fn vertices(&self) -> Result<Vec<VertexDef>> {
        self.faces
            .iter()
            .flat_map(|f| f.loops.iter().flatten())
            .cloned()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .map(|p| {
                let def = VertexDef::Radical(p);
                def.key()?;
                Ok(def)
            })
            .collect()
    }

    pub fn volume6(&self) -> Radical {
        self.faces
            .iter()
            .flat_map(|f| &f.loops)
            .fold(Radical::default(), |mut s, lp| {
                for i in 1..lp.len() - 1 {
                    s = s + rdot(&lp[0], &rcross(&lp[i], &lp[i + 1]));
                }
                s
            })
    }
    /// Exact sewing, incidence and oriented edge-manifold checks. All vertices
    /// must lie on their defining support, including after cache mutation.
    pub fn check(&self) -> Result<()> {
        let mut uses = BTreeMap::<(RPoint, RPoint), Vec<bool>>::new();
        for f in &self.faces {
            if f.plane.normal.iter().all(Radical::is_zero) || f.loops.is_empty() {
                return fail("contract-violation:carrier");
            }
            for (li, lp) in f.loops.iter().enumerate() {
                if lp.len() < 3 || lp.iter().any(|p| !f.plane.side(p).is_zero()) {
                    return fail("contract-violation:exact-incidence");
                }
                let mut area = std::array::from_fn(|_| Radical::default());
                for i in 0..lp.len() {
                    let (a, b) = (&lp[i], &lp[(i + 1) % lp.len()]);
                    if a == b {
                        return fail("contract-violation:zero-edge");
                    }
                    let forward = a < b;
                    let key = if forward {
                        (a.clone(), b.clone())
                    } else {
                        (b.clone(), a.clone())
                    };
                    uses.entry(key).or_default().push(forward);
                    let c = rcross(a, b);
                    for j in 0..3 {
                        area[j] = &area[j] + &c[j];
                    }
                }
                let sign = rdot(&area, &f.plane.normal);
                if sign.is_zero() || sign.is_negative() != (li != 0) {
                    return fail("contract-violation:loop-orientation");
                }
            }
        }
        if uses.values().any(|u| u.len() != 2 || u[0] == u[1]) {
            return fail("contract-violation:sewing");
        }
        if self.volume6() <= Radical::default() {
            return fail("contract-violation:volume");
        }
        Ok(())
    }
    /// Admit the exact sewn boundary through the shared planar Model builder
    /// and full G1–G8 audit. No observation is used to construct topology.
    pub fn rational_model(&self, input: &Model, node: u32) -> Result<Model> {
        self.model(input, node)
    }
    pub fn model(&self, input: &Model, node: u32) -> Result<Model> {
        radical::guard(|| self.admit_model(input, node))
            .map_err(|e| Refusal(format!("chamfer/{e:?}")))?
    }
    fn admit_model(&self, input: &Model, node: u32) -> Result<Model> {
        use wonky_geom::model::{radical_polyhedron, RadicalPlane3, RadicalPolyFace};
        let mut faces = vec![];
        for f in &self.faces {
            let n = f.plane.normal.clone();
            let axis: RPoint = std::array::from_fn(|i| {
                rq(if i == n.iter().position(Radical::is_zero).unwrap_or(0) {
                    Q::one()
                } else {
                    Q::zero()
                })
            });
            let mut x = rcross(&n, &axis);
            if x.iter().all(Radical::is_zero) {
                x = rcross(&n, &lift(&[Q::zero(), Q::one(), Q::zero()]));
            }
            faces.push(RadicalPolyFace {
                carrier: RadicalPlane3 {
                    o: f.loops[0][0].clone(),
                    n,
                    x,
                },
                forward: true,
                loops: f
                    .loops
                    .iter()
                    .map(|lp| lp.iter().cloned().map(VertexDef::Radical).collect())
                    .collect(),
                provenance: f.provenance,
            });
        }
        radical_polyhedron(
            input.draft().placement.clone(),
            input.draft().label,
            node,
            faces,
        )?
        .check()
        .map_err(Into::into)
    }
}
fn intersection(a: &Plane, b: &Plane, c: &Plane) -> Result<RPoint> {
    let bc = rcross(&b.normal, &c.normal);
    let ca = rcross(&c.normal, &a.normal);
    let ab = rcross(&a.normal, &b.normal);
    let det = rdot(&a.normal, &bc);
    if det.is_zero() {
        return fail("corner-degenerate");
    }
    Ok(std::array::from_fn(|i| {
        (&a.offset * &bc[i] + &b.offset * &ca[i] + &c.offset * &ab[i]) / &det
    }))
}
fn clip(faces: &mut Vec<Face>, cut: Plane, node: u32) -> Result<()> {
    let mut boundary = vec![];
    for f in faces.iter_mut() {
        for (li, lp) in f.loops.iter_mut().enumerate() {
            let signs: Vec<_> = lp.iter().map(|p| cut.side(p)).collect();
            let transitions = (0..lp.len())
                .filter(|&i| {
                    (signs[i] > Radical::default())
                        != (signs[(i + 1) % lp.len()] > Radical::default())
                })
                .count();
            if transitions > 2 {
                return fail("disconnected-face-clip-unimplemented");
            }
            if !signs.iter().any(|s| s > &Radical::default()) {
                continue;
            }
            if li != 0 {
                return fail("hole-contact-unimplemented");
            }
            let mut out = vec![];
            for i in 0..lp.len() {
                let j = (i + 1) % lp.len();
                let (a, b) = (&lp[i], &lp[j]);
                let (sa, sb) = (&signs[i], &signs[j]);
                if sa <= &Radical::default() {
                    out.push(a.clone());
                }
                if (sa > &Radical::default() && sb < &Radical::default())
                    || (sa < &Radical::default() && sb > &Radical::default())
                {
                    let t = sa / &(sa - sb);
                    out.push(std::array::from_fn(|k| &a[k] + &t * (&b[k] - &a[k])));
                }
            }
            out.dedup();
            if out.len() > 1 && out.first() == out.last() {
                out.pop();
            }
            if out.len() < 3 {
                return fail("face-consumed-or-overlap");
            }
            for i in 0..out.len() {
                let j = (i + 1) % out.len();
                if cut.side(&out[i]).is_zero() && cut.side(&out[j]).is_zero() {
                    boundary.push((out[j].clone(), out[i].clone()));
                }
            }
            *lp = out;
        }
    }
    if boundary.len() < 3 {
        return fail("empty-or-overlapping-cut");
    }
    let (start, mut end) = boundary.remove(0);
    let mut lp = vec![start.clone()];
    while end != start {
        lp.push(end.clone());
        let matches: Vec<_> = boundary
            .iter()
            .enumerate()
            .filter(|(_, e)| e.0 == end)
            .map(|(i, _)| i)
            .collect();
        if matches.len() != 1 {
            return fail("non-manifold-cut");
        }
        end = boundary.remove(matches[0]).1;
    }
    if !boundary.is_empty() {
        return fail("multiple-cut-loops-unimplemented");
    }
    faces.push(Face {
        plane: cut,
        loops: vec![lp],
        provenance: Provenance {
            node,
            slot: faces.len() as u32,
        },
    });
    Ok(())
}
/// Face-distance mechanism shared by every admitted planar Model, independent
/// of construction family. `TwoOffsets` remains unprobed, even for a box.
pub fn equal_offsets(
    input: &Model,
    selected: &[EdgeId],
    request: Request,
    node: u32,
) -> Result<Boundary> {
    radical::guard(|| build(input, selected, request, node))
        .map_err(|e| Refusal(format!("chamfer/{e:?}")))?
}
fn build(input: &Model, selected: &[EdgeId], request: Request, node: u32) -> Result<Boundary> {
    let width = match &request.section {
        Section::EqualOffsets { width } => width.clone(),
        Section::TwoOffsets { .. } => return fail("two-offsets-side-order-unprobed"),
        Section::Fillet { .. } => return fail("fillet-out-of-scope"),
    };
    if selected.is_empty() {
        return fail("empty-selection");
    }
    let graph = stripes(input, selected, request)?;
    let d = input.draft();
    let mut faces = vec![];
    for (i, f) in d.faces.iter().enumerate() {
        let n = input.outward_normal(wonky_geom::model::FaceId(i as u32))?;
        let mut loops = vec![];
        for l in &f.loops {
            let mut lp = vec![];
            for c in &d.loops[l.index()].coedges {
                let co = &d.coedges[c.index()];
                let v = match d.edges[co.edge.index()].bounds {
                    Bounds::Segment(v) => v[usize::from(!co.forward)],
                    Bounds::Ring => return fail("requires-line-edges"),
                };
                lp.push(lift(input.key(v).rational()?));
            }
            loops.push(lp);
        }
        let normal = lift(&n);
        let offset = rdot(&normal, &loops[0][0]);
        faces.push(Face {
            plane: Plane { normal, offset },
            loops,
            provenance: d.surfaces[f.surface.index()].provenance,
        });
    }
    let source_faces = faces.clone();
    let mut cuts = BTreeMap::new();
    let mut concave = vec![];
    let inverse = d.placement.inverse();
    for e in &graph.edges {
        let [va, vb] = match d.edges[e.edge.index()].bounds {
            Bounds::Segment(v) => v,
            Bounds::Ring => return fail("requires-line-edges"),
        };
        let p = input.key(va).rational()?;
        let dir = d.placement.vector(&sub(input.key(vb).rational()?, p));
        let normals = e
            .supports
            .map(|f| input.source_normal(f))
            .into_iter()
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let mut spring = vec![];
        for i in 0..2 {
            let mut t = cross(&normals[i], &dir);
            if (dot(&t, &normals[1 - i]) > Q::zero()) == (e.convexity == Convexity::Convex) {
                t = t.map(|x| -x);
            }
            let length = Radical::quadratic(Q::zero(), Q::one(), dot(&t, &t))
                .map_err(|e| Refusal(format!("chamfer/{e:?}")))?;
            if length.is_zero() {
                return fail("tangent-edge");
            }
            let local = inverse.vector(&t);
            spring.push(std::array::from_fn::<_, 3, _>(|k| {
                rq(p[k].clone()) + rq(&width * &local[k]) / &length
            }));
        }
        let delta = rsub(&spring[1], &spring[0]);
        let mut n = rcross(&lift(&sub(input.key(vb).rational()?, p)), &delta);
        if rdot(&n, &rsub(&lift(p), &spring[0])).is_negative() == (e.convexity == Convexity::Convex)
        {
            n = n.map(|x| -x);
        }
        #[allow(unused_mut)]
        let mut cut = Plane {
            offset: rdot(&n, &spring[0]),
            normal: n,
        };
        // Planted FP-a negative: interpret width as a face-normal distance.
        #[cfg(feature = "plant_face_offset")]
        {
            let unit_a = Radical::quadratic(Q::zero(), Q::one(), dot(&normals[0], &normals[0]))
                .map_err(|e| Refusal(format!("chamfer/{e:?}")))?;
            let unit_b = Radical::quadratic(Q::zero(), Q::one(), dot(&normals[1], &normals[1]))
                .map_err(|e| Refusal(format!("chamfer/{e:?}")))?;
            let sum: RPoint = std::array::from_fn(|k| {
                rq(normals[0][k].clone()) / &unit_a + rq(normals[1][k].clone()) / &unit_b
            });
            let local_n: RPoint = std::array::from_fn(|i| {
                (0..3).fold(Radical::default(), |v, k| {
                    v + &sum[k] * &d.placement.columns()[i][k]
                })
            });
            cut = Plane {
                offset: rdot(&local_n, &lift(p)) - rq(width.clone()),
                normal: local_n,
            };
        }
        if e.convexity == Convexity::Concave {
            concave.push((e.edge, e.supports, cut));
            continue;
        }
        for &f in &e.supports {
            let pl = &source_faces[f.index()].plane;
            if source_faces
                .iter()
                .flat_map(|f| f.loops.iter().flatten())
                .any(|p| pl.side(p) > Radical::default())
            {
                return fail("non-supporting-edge-unimplemented");
            }
        }
        cuts.insert(e.edge, cut);
    }
    let mut corner_cuts = vec![];
    for v in &graph.vertices {
        if v.selected_edges
            .iter()
            .any(|e| concave.iter().any(|c| c.0 == *e))
        {
            if v.selected_degree > 1 {
                return fail("concave-vertex-network-unavailable");
            }
            continue;
        }
        if v.selected_degree != 3 {
            continue;
        }
        let supports: BTreeSet<_> = graph
            .edges
            .iter()
            .filter(|e| v.selected_edges.contains(&e.edge))
            .flat_map(|e| e.supports)
            .collect();
        if supports.len() != 3 {
            return fail("non-trihedral-corner-unimplemented");
        }
        let mut points = vec![];
        for f in supports {
            let incident: Vec<_> = graph
                .edges
                .iter()
                .filter(|e| v.selected_edges.contains(&e.edge) && e.supports.contains(&f))
                .collect();
            if incident.len() != 2 {
                return fail("corner-incidence");
            }
            points.push(intersection(
                &source_faces[f.index()].plane,
                &cuts[&incident[0].edge],
                &cuts[&incident[1].edge],
            )?);
        }
        let mut n = rcross(&rsub(&points[1], &points[0]), &rsub(&points[2], &points[0]));
        if rdot(
            &n,
            &rsub(&lift(input.key(v.vertex).rational()?), &points[0]),
        )
        .is_negative()
        {
            n = n.map(|x| -x);
        }
        corner_cuts.push(Plane {
            offset: rdot(&n, &points[0]),
            normal: n,
        });
    }
    // Every unselected source edge must retain a positive exact interval.
    // A closed output alone cannot prove that an unrelated short edge was not
    // swallowed by a large setback. Overflow belongs to a later stage.
    for (index, edge) in d.edges.iter().enumerate() {
        if graph.edges.iter().any(|e| e.edge == EdgeId(index as u32)) {
            continue;
        }
        let [a, b] = match edge.bounds {
            Bounds::Segment(v) => v,
            Bounds::Ring => return fail("requires-line-edges"),
        };
        let p = lift(input.key(a).rational()?);
        let delta = rsub(&lift(input.key(b).rational()?), &p);
        let (mut lo, mut hi) = (Radical::default(), rq(Q::one()));
        for cut in cuts.values().chain(&corner_cuts) {
            let start = cut.side(&p);
            let slope = rdot(&cut.normal, &delta);
            if slope.is_zero() {
                if start > Radical::default() {
                    return Err(Refusal(format!("blend/overflow:{index}")));
                }
            } else {
                let t = -start / &slope;
                if slope > Radical::default() {
                    hi = hi.min(t);
                } else {
                    lo = lo.max(t);
                }
            }
        }
        if lo >= hi {
            return Err(Refusal(format!("blend/overflow:{index}")));
        }
    }
    let mut seen = BTreeSet::new();
    for cut in cuts.into_values().chain(corner_cuts) {
        let pivot = cut
            .normal
            .iter()
            .find(|x| !x.is_zero())
            .ok_or_else(|| Refusal("chamfer/cut-degenerate".into()))?
            .abs();
        let key = (cut.normal.clone().map(|x| x / &pivot), &cut.offset / &pivot);
        if !seen.insert(key) {
            continue;
        }
        clip(&mut faces, cut, node)?;
    }
    for (edge, supports, cut) in concave {
        attach(&mut faces, input, edge, supports, cut, node)?;
    }
    let result = Boundary { faces };
    result.check()?;
    Ok(result)
}

/// Re-entrant attachment replaces the selected line on each support and the
/// corner on each cap. Its bounded wedge fills air locally; a global halfspace
/// intersection would wrongly discard the remote portions of a concave solid.
fn attach(
    faces: &mut Vec<Face>,
    input: &Model,
    edge: EdgeId,
    supports: [wonky_geom::model::FaceId; 2],
    cut: Plane,
    node: u32,
) -> Result<()> {
    let vs = match input.draft().edges[edge.index()].bounds {
        Bounds::Segment(v) => v,
        Bounds::Ring => return fail("requires-line-edges"),
    };
    let mut springs = vec![];
    for v in vs {
        let p = lift(input.key(v).rational()?);
        let caps: Vec<_> = faces
            .iter()
            .enumerate()
            .filter(|(i, f)| {
                !supports.iter().any(|s| s.index() == *i)
                    && f.loops.iter().flatten().any(|q| q == &p)
            })
            .map(|(i, _)| i)
            .collect();
        if caps.len() != 1 {
            return fail("concave-cap-incidence-unavailable");
        }
        let cap = caps[0];
        let mut points = vec![];
        for support in supports {
            points.push(intersection(
                &faces[support.index()].plane,
                &faces[cap].plane,
                &cut,
            )?);
        }
        // Both setback points must remain strictly within their existing cap
        // edges. This is an exact overflow proof, independent of observations.
        for lp in &mut faces[cap].loops {
            let Some(k) = lp.iter().position(|q| q == &p) else {
                continue;
            };
            let prev = &lp[(k + lp.len() - 1) % lp.len()];
            let next = &lp[(k + 1) % lp.len()];
            let on_segment = |q: &RPoint, end: &RPoint| {
                let d = rsub(end, &p);
                let delta = rsub(q, &p);
                rcross(&d, &delta).iter().all(Radical::is_zero)
                    && rdot(&delta, &d) > Radical::default()
                    && rdot(&delta, &d) < rdot(&d, &d)
            };
            let first = points
                .iter()
                .find(|q| on_segment(q, prev))
                .cloned()
                .ok_or_else(|| Refusal(format!("blend/overflow:{}", edge.0)))?;
            let last = points
                .iter()
                .find(|q| on_segment(q, next))
                .cloned()
                .ok_or_else(|| Refusal(format!("blend/overflow:{}", edge.0)))?;
            lp.splice(k..=k, [first, last]);
        }
        for (j, support) in supports.iter().enumerate() {
            for lp in &mut faces[support.index()].loops {
                for q in lp {
                    if q == &p {
                        *q = points[j].clone();
                    }
                }
            }
        }
        springs.push(points);
    }
    let mut lp = vec![
        springs[0][0].clone(),
        springs[1][0].clone(),
        springs[1][1].clone(),
        springs[0][1].clone(),
    ];
    let area = rcross(&rsub(&lp[1], &lp[0]), &rsub(&lp[2], &lp[0]));
    if rdot(&area, &cut.normal).is_negative() {
        lp.reverse();
    }
    faces.push(Face {
        plane: cut,
        loops: vec![lp],
        provenance: Provenance {
            node,
            slot: faces.len() as u32,
        },
    });
    Ok(())
}

#[cfg(test)]
#[path = "corner_audit.rs"]
mod corner_audit;
