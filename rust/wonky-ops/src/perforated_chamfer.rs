//! Equal-offset chamfers of a perforated box in ONE operation: planar
//! setbacks on selected straight box edges and conical countersinks on
//! selected through-hole rims, trimmed together.
//!
//! Every decision is an exact rational predicate on the interpreter binary64
//! inputs replayed from the construction DAG: the face clipping, the exact
//! representability of each countersink ring, the clearance of every bore from
//! every non-cap face, and bore separation. A countersink cone is stored by its
//! two exact rings (`ConeMeridian`), never by a rounded angle. Planar vertices
//! are rounded display witnesses bound by replay (as for planar chamfers);
//! measures and probes use the exact geometry, and export declares the witness
//! displacement in its tolerance. The frame is near-rigid: local geometry is
//! exact and observations carry the frame's orthonormality defect.
use crate::{
    chamfer,
    cylinder::{enclosed, finite},
    perforated::{self, Perforated},
    placement::Placement,
    polyhedron::Refused,
    probe_exact::{enclose, local_point},
};
use num_rational::BigRational as Q;
use num_traits::{Signed, ToPrimitive, Zero};
use std::collections::{BTreeMap, BTreeSet};
use wonky_contract::*;
use wonky_num::{Iv, Scalar};

type R<T> = std::result::Result<T, Refused>;
type V = [Q; 3];
/// Intersection rule 4 on a perforated parent: [width, selected edge indices...].
pub(crate) const RULE: u32 = 4;

fn no(s: &str) -> Refused {
    Refused(format!("chamfer/perforated-{s}"))
}
fn q(x: f64) -> Q {
    Q::from_float(x).expect("finite WC0 input")
}
fn f(x: &Q) -> R<f64> {
    x.to_f64()
        .filter(|x| x.is_finite())
        .ok_or_else(|| no("numeric-range"))
}
/// A derived ring coordinate must be one binary64: the cone is stored by
/// exact rings or the operation refuses by name.
fn exact(x: Q) -> R<f64> {
    let y = f(&x)?;
    if q(y) != x {
        return Err(no("countersink-offset-not-representable"));
    }
    Ok(y)
}
fn b(x: f64) -> R<Binary64> {
    Binary64::new(x).map_err(|_| no("numeric-range"))
}
fn v3(p: [f64; 3]) -> R<Vector3> {
    Ok([b(p[0])?, b(p[1])?, b(p[2])?])
}
fn vq(p: &V) -> R<Vector3> {
    Ok([b(f(&p[0])?)?, b(f(&p[1])?)?, b(f(&p[2])?)?])
}
fn dot(a: &V, c: &V) -> Q {
    (0..3).map(|k| &a[k] * &c[k]).sum()
}
fn sub(a: &V, c: &V) -> V {
    std::array::from_fn(|k| &a[k] - &c[k])
}
fn cross(a: &V, c: &V) -> V {
    std::array::from_fn(|k| &a[(k + 1) % 3] * &c[(k + 2) % 3] - &a[(k + 2) % 3] * &c[(k + 1) % 3])
}
fn unit() -> Domain {
    Domain {
        lower: Limit::Finite { value: Binary64::new(0.).unwrap(), closed: true },
        upper: Limit::Finite { value: Binary64::new(1.).unwrap(), closed: true },
    }
}
fn axis_unit(k: usize, sign: f64) -> [f64; 3] {
    let mut e = [0.; 3];
    e[k] = sign;
    e
}
fn iv(x: &Q) -> R<Iv> {
    enclose(x).map_err(no)
}
fn root_iv(x: &Q) -> R<Iv> {
    finite(iv(x)?.sqrt())
}
fn hull(a: Iv, c: Iv) -> Iv {
    let (lo, hi) = (a.lo().min(c.lo()), a.hi().max(c.hi()));
    let m = 0.5 * lo + 0.5 * hi;
    Iv { m, r: (hi - m).next_up().max((m - lo).next_up()) }
}
fn area_vector(lp: &[V]) -> V {
    let mut n: V = std::array::from_fn(|_| Q::zero());
    for i in 0..lp.len() {
        let c = cross(&lp[i], &lp[(i + 1) % lp.len()]);
        for k in 0..3 {
            n[k] += &c[k];
        }
    }
    n
}
/// Exact squared distance from p to the closed segment [a, c].
fn segment_sq(p: &V, a: &V, c: &V) -> Q {
    let d = sub(c, a);
    let e = sub(p, a);
    let dd = dot(&d, &d);
    let t = dot(&e, &d);
    let t = if !t.is_positive() { Q::zero() } else if t >= dd { q(1.) } else { t / &dd };
    let r: V = std::array::from_fn(|k| &e[k] - &t * &d[k]);
    dot(&r, &r)
}

/// A planar face of the chamfered box: n.x = offset, outer loop CCW about n.
#[derive(Clone, Debug)]
struct Facet {
    normal: V,
    offset: Q,
    outer: Vec<V>,
}
/// A through-bore along source axis k: exact (height, radius) rings in
/// increasing height; consecutive rings bound a cylinder or a cone band.
#[derive(Clone, Debug)]
struct Bore {
    k: usize,
    center: [f64; 3],
    rings: Vec<[f64; 2]>,
    caps: [usize; 2],
    frame: FrameId,
}
impl Bore {
    fn widest(&self) -> f64 {
        self.rings.iter().map(|r| r[1]).fold(0., f64::max)
    }
    fn end(&self, end: usize) -> [f64; 2] {
        if end == 0 { self.rings[0] } else { self.rings[self.rings.len() - 1] }
    }
    fn ring_center(&self, h: f64) -> V {
        let mut c = self.center.map(q);
        c[self.k] = q(h);
        c
    }
    fn radial_sq(&self, p: &V) -> Q {
        (0..3)
            .filter(|&j| j != self.k)
            .map(|j| {
                let d = &p[j] - q(self.center[j]);
                &d * &d
            })
            .sum()
    }
    /// Exact radius of the removed region at height z, constant past the ends.
    fn radius_at(&self, z: &Q) -> Q {
        for w in self.rings.windows(2) {
            let (h0, h1) = (q(w[0][0]), q(w[1][0]));
            if *z <= h0 {
                return q(w[0][1]);
            }
            if *z <= h1 {
                return q(w[0][1]) + (q(w[1][1]) - q(w[0][1])) * (z - &h0) / (h1 - &h0);
            }
        }
        q(self.end(1)[1])
    }
    /// (Integral of rho^2 dz, first moment / pi) of the removed bore.
    fn integrals(&self) -> (Q, V) {
        let mut volume = Q::zero();
        let mut axial = Q::zero();
        for w in self.rings.windows(2) {
            let (za, ra, zb, rb) = (q(w[0][0]), q(w[0][1]), q(w[1][0]), q(w[1][1]));
            let h = &zb - &za;
            let d = &rb - &ra;
            volume += &h * (&ra * &ra + &ra * &rb + &rb * &rb) / q(3.);
            axial += &h
                * (&za * (&ra * &ra + &ra * &d + &d * &d / q(3.))
                    + &h * (&ra * &ra / q(2.) + q(2.) * &ra * &d / q(3.) + &d * &d / q(4.)));
        }
        let mut moment: V = std::array::from_fn(|j| &volume * q(self.center[j]));
        moment[self.k] = axial;
        (volume, moment)
    }
}

#[derive(Clone, Debug)]
pub struct PerforatedChamfer {
    pub body: Body,
    pub(crate) source: Perforated,
    facets: Vec<Facet>,
    bores: Vec<Bore>,
    /// Exact planar vertices; index = body vertex id of the rounded witness.
    points: Vec<V>,
}

pub(crate) fn candidate(body: &Body) -> bool {
    body.constructions
        .last()
        .is_some_and(|n| n.operation == (Operation::Intersection {}) && n.rule_version == RULE)
}

/// Exact planar faces and bores of the chamfered perforated box.
fn design(p: &Perforated, edges: &[usize], width: f64) -> R<(Vec<Facet>, Vec<Bore>)> {
    if !width.is_finite() || width <= 0. {
        return Err(no("invalid-width"));
    }
    if edges.is_empty() {
        return Err(no("empty-selection"));
    }
    let base_edges = p.base.body.edges.len();
    let mut lines = Vec::new();
    let mut rims = BTreeSet::new();
    for &e in edges {
        let edge = p.body.edges.get(e).ok_or_else(|| no("edge-index"))?;
        let circle = matches!(
            p.body.curves[edge.curve.0 as usize].geometry,
            CurveGeometry::Circle { .. }
        );
        if e < base_edges {
            lines.push(e);
            continue;
        }
        // perforated::assemble appends [bottom rim, top rim, seam] per hole.
        let (hole, slot) = ((e - base_edges) / 3, (e - base_edges) % 3);
        if hole >= p.holes.len() || circle != (slot < 2) {
            return Err(no("edge-layout"));
        }
        if slot == 2 {
            return Err(no("seam-edge"));
        }
        rims.insert((hole, slot));
    }
    let facets = chamfer::clipped_faces(&p.base, &lines, width)?
        .into_iter()
        .map(|(normal, loops)| {
            let [outer] = <[Vec<V>; 1]>::try_from(loops).map_err(|_| no("planar-face-loops"))?;
            Ok(Facet { offset: dot(&normal, &outer[0]), normal, outer })
        })
        .collect::<R<Vec<_>>>()?;
    let w = q(width);
    let base_frames = p.base.body.frames.len() as u32;
    let mut bores: Vec<Bore> = Vec::new();
    for (i, spec) in p.holes.iter().enumerate() {
        let k = spec.axis()?;
        let (z0, z1) = (p.bounds[0][k], p.bounds[1][k]);
        let ends = [rims.contains(&(i, 0)), rims.contains(&(i, 1))];
        let cuts = ends.iter().filter(|&&e| e).count() as f64;
        if &w * q(cuts) >= q(z1) - q(z0) {
            return Err(no("countersink-bore-consumed"));
        }
        let r = spec.radius;
        let wide = || exact(q(r) + &w);
        let mut rings = vec![[z0, if ends[0] { wide()? } else { r }]];
        if ends[0] {
            rings.push([exact(q(z0) + &w)?, r]);
        }
        if ends[1] {
            rings.push([exact(q(z1) - &w)?, r]);
        }
        rings.push([z1, if ends[1] { wide()? } else { r }]);
        let cap = |sign: f64, level: f64| {
            facets
                .iter()
                .position(|s| s.normal == axis_unit(k, sign).map(q) && s.offset == q(sign * level))
                .ok_or_else(|| no("missing-cap"))
        };
        let mut center = spec.bottom;
        center[k] = 0.;
        let bore = Bore {
            k,
            center,
            rings,
            caps: [cap(-1., z0)?, cap(1., z1)?],
            frame: FrameId(base_frames + i as u32),
        };
        // The bore is the union of convex hulls of consecutive rings, so it is
        // strictly inside a halfspace n.x <= offset iff every ring is:
        // n.c + rho |n_perp| < offset, decided exactly after squaring.
        for (fi, s) in facets.iter().enumerate() {
            if bore.caps.contains(&fi) {
                continue;
            }
            let perp: Q = (0..3).filter(|&j| j != k).map(|j| &s.normal[j] * &s.normal[j]).sum();
            for ring in &bore.rings {
                let gap = &s.offset - dot(&s.normal, &bore.ring_center(ring[0]));
                let rho = q(ring[1]);
                if !gap.is_positive() || &gap * &gap <= &rho * &rho * &perp {
                    return Err(no("bore-face-contact"));
                }
            }
        }
        // Separation with the widest rings: same-axis bores by their centre
        // distance, crossing bores in the coordinate normal to both axes.
        for other in &bores {
            let reach = q(bore.widest()) + q(other.widest());
            let gap: Q = if other.k == k {
                (0..3)
                    .filter(|&j| j != k)
                    .map(|j| {
                        let d = q(bore.center[j]) - q(other.center[j]);
                        &d * &d
                    })
                    .sum()
            } else {
                let j = (0..3).find(|&j| j != k && j != other.k).unwrap();
                let d = q(bore.center[j]) - q(other.center[j]);
                &d * &d
            };
            if gap <= &reach * &reach {
                return Err(no("countersink-bores-contact"));
            }
        }
        bores.push(bore);
    }
    Ok((facets, bores))
}

fn assemble(p: &Perforated, facets: &[Facet], bores: &[Bore], nodes: Vec<Construction>) -> R<(Body, Vec<V>)> {
    let root = nodes.len() - 1;
    let provenance = Provenance::Construction { node: NodeId(root as u32) };
    let mut out = Body {
        key: p.body.key.clone(),
        frames: p.body.frames.clone(),
        constructions: nodes,
        vertices: vec![],
        curves: vec![],
        surfaces: vec![],
        pcurves: vec![],
        edges: vec![],
        coedges: vec![],
        loops: vec![],
        faces: vec![],
        shells: vec![],
        solids: vec![],
        facts: vec![],
        budgets: vec![],
    };
    let fid = FrameId(1);
    let mut vertex_ids = BTreeMap::<V, u32>::new();
    let mut points: Vec<V> = vec![];
    let mut edge_ids = BTreeMap::<(u32, u32), u32>::new();
    let mut uses = BTreeMap::<u32, Vec<bool>>::new();
    let mut charts = vec![];
    for s in facets {
        let sid = SurfaceId(out.surfaces.len() as u32);
        let x: V = if let Some(k) = s.normal.iter().position(|x| x.is_zero()) {
            std::array::from_fn(|i| q(if i == k { 1. } else { 0. }))
        } else {
            [s.normal[1].clone(), -&s.normal[0], Q::zero()]
        };
        let y = cross(&s.normal, &x);
        let (xx, yy) = (dot(&x, &x), dot(&y, &y));
        if xx.is_zero() || yy.is_zero() {
            return Err(no("degenerate-chart"));
        }
        let origin = s.outer[0].clone();
        out.surfaces.push(Surface {
            frame: fid,
            provenance: provenance.clone(),
            geometry: SurfaceGeometry::Plane { origin: vq(&origin)?, normal: vq(&s.normal)?, x: vq(&x)? },
        });
        let mut ids = vec![];
        for pt in &s.outer {
            let id = match vertex_ids.get(pt) {
                Some(&id) => id,
                None => {
                    let id = out.vertices.len() as u32;
                    vertex_ids.insert(pt.clone(), id);
                    points.push(pt.clone());
                    out.vertices.push(Vertex { point: vq(pt)?, frame: fid, provenance: provenance.clone() });
                    id
                }
            };
            ids.push(id);
        }
        let chart = |pt: &V| -> R<Vector2> {
            let d = sub(pt, &origin);
            Ok([b(f(&(dot(&d, &x) / &xx))?)?, b(f(&(dot(&d, &y) / &yy))?)?])
        };
        let mut coedges = vec![];
        for i in 0..ids.len() {
            let (a, c) = (ids[i], ids[(i + 1) % ids.len()]);
            if a == c {
                return Err(no("degenerate-edge"));
            }
            let pair = (a.min(c), a.max(c));
            let eid = match edge_ids.get(&pair) {
                Some(&e) => e,
                None => {
                    let e = out.edges.len() as u32;
                    edge_ids.insert(pair, e);
                    let cid = CurveId(out.curves.len() as u32);
                    out.curves.push(Curve {
                        frame: fid,
                        provenance: provenance.clone(),
                        geometry: CurveGeometry::Line {
                            a: out.vertices[pair.0 as usize].point,
                            b: out.vertices[pair.1 as usize].point,
                        },
                        domain: unit(),
                        supports: vec![],
                    });
                    out.edges.push(Edge { curve: cid, domain: unit(), vertices: vec![VertexId(pair.0), VertexId(pair.1)] });
                    e
                }
            };
            let cid = out.edges[eid as usize].curve;
            let pc = PcurveId(out.pcurves.len() as u32);
            out.pcurves.push(Pcurve {
                curve: cid,
                surface: sid,
                domain: unit(),
                geometry: PcurveGeometry::Line {
                    a: chart(&points[pair.0 as usize])?,
                    b: chart(&points[pair.1 as usize])?,
                },
            });
            out.curves[cid.0 as usize].supports.push(Support { surface: sid, pcurve: pc });
            coedges.push(CoedgeId(out.coedges.len() as u32));
            out.coedges.push(Coedge { edge: EdgeId(eid), forward: a == pair.0, pcurve: pc });
            uses.entry(eid).or_default().push(a == pair.0);
        }
        let lid = LoopId(out.loops.len() as u32);
        out.loops.push(Loop { outer: true, coedges });
        out.faces.push(Face { surface: sid, forward: true, loops: vec![lid] });
        charts.push((origin, x, y, xx, yy));
    }
    if uses.values().any(|u| u.len() != 2 || u[0] == u[1]) {
        return Err(no("non-manifold-result"));
    }
    // Rounding must not identify distinct exact vertices.
    let rounded: BTreeSet<_> = out.vertices.iter().map(|p| p.point.map(|x| x.get().to_bits())).collect();
    if rounded.len() != out.vertices.len() {
        return Err(no("display-resolution"));
    }
    for bore in bores {
        let k = bore.k;
        let axis = axis_unit(k, 1.);
        let radial = axis_unit((k + 1) % 3, 1.);
        let mut ring_edges = vec![];
        let mut ring_vertices = vec![];
        // Seam vertices live in the hole's exact translated chart (as for the
        // perforated walls): centre + radius need not be one binary64.
        for &[h, rho] in &bore.rings {
            let mut seam = [0.; 3];
            seam[(k + 1) % 3] = rho;
            seam[k] = h;
            let vid = out.vertices.len() as u32;
            out.vertices.push(Vertex { point: v3(seam)?, frame: bore.frame, provenance: Provenance::None {} });
            let mut origin = bore.center;
            origin[k] = h;
            let cid = CurveId(out.curves.len() as u32);
            out.curves.push(Curve {
                frame: fid,
                provenance: provenance.clone(),
                geometry: CurveGeometry::Circle {
                    origin: v3(origin)?,
                    normal: v3(axis)?,
                    x: v3(radial)?,
                    radius: b(rho)?,
                    arc: ArcKind::Full {},
                },
                domain: unit(),
                supports: vec![],
            });
            ring_edges.push(out.edges.len() as u32);
            out.edges.push(Edge { curve: cid, domain: unit(), vertices: vec![VertexId(vid); 2] });
            ring_vertices.push(vid);
        }
        // Hole loops of both caps wind clockwise about the outward cap normal.
        for end in 0..2 {
            let face = bore.caps[end];
            let ri = if end == 0 { 0 } else { bore.rings.len() - 1 };
            let (origin, x, y, xx, yy) = &charts[face];
            let [h, rho] = bore.rings[ri];
            let d = sub(&bore.ring_center(h), origin);
            let sid = out.faces[face].surface;
            let cid = out.edges[ring_edges[ri] as usize].curve;
            let pc = PcurveId(out.pcurves.len() as u32);
            out.pcurves.push(Pcurve {
                curve: cid,
                surface: sid,
                domain: unit(),
                geometry: PcurveGeometry::Circle {
                    origin: [b(f(&(dot(&d, x) / xx))?)?, b(f(&(dot(&d, y) / yy))?)?],
                    radius: b(rho)?,
                    clockwise: end == 0,
                },
            });
            out.curves[cid.0 as usize].supports.push(Support { surface: sid, pcurve: pc });
            let co = CoedgeId(out.coedges.len() as u32);
            out.coedges.push(Coedge { edge: EdgeId(ring_edges[ri]), forward: end == 0, pcurve: pc });
            let lid = LoopId(out.loops.len() as u32);
            out.loops.push(Loop { outer: false, coedges: vec![co] });
            out.faces[face].loops.push(lid);
        }
        // Inward walls, bottom to top. Charts are (turns, source height).
        for j in 0..bore.rings.len() - 1 {
            let ([h0, r0], [h1, r1]) = (bore.rings[j], bore.rings[j + 1]);
            let sid = SurfaceId(out.surfaces.len() as u32);
            let geometry = if r0 == r1 {
                SurfaceGeometry::Cylinder { origin: v3(bore.center)?, axis: v3(axis)?, x: v3(radial)?, radius: b(r0)? }
            } else {
                SurfaceGeometry::ConeMeridian {
                    origin: v3(bore.center)?,
                    axis: v3(axis)?,
                    x: v3(radial)?,
                    start: [b(r0)?, b(h0)?],
                    end: [b(r1)?, b(h1)?],
                }
            };
            out.surfaces.push(Surface { frame: fid, provenance: provenance.clone(), geometry });
            let cid = CurveId(out.curves.len() as u32);
            out.curves.push(Curve {
                frame: bore.frame,
                provenance: Provenance::None {},
                geometry: CurveGeometry::Line {
                    a: out.vertices[ring_vertices[j] as usize].point,
                    b: out.vertices[ring_vertices[j + 1] as usize].point,
                },
                domain: unit(),
                supports: vec![],
            });
            let seam = out.edges.len() as u32;
            out.edges.push(Edge {
                curve: cid,
                domain: unit(),
                vertices: vec![VertexId(ring_vertices[j]), VertexId(ring_vertices[j + 1])],
            });
            let line = |a: [f64; 2], c: [f64; 2]| -> R<PcurveGeometry> {
                Ok(PcurveGeometry::Line { a: [b(a[0])?, b(a[1])?], b: [b(c[0])?, b(c[1])?] })
            };
            let mut coedges = vec![];
            for (edge, forward, geometry) in [
                (seam, true, line([0., h0], [0., h1])?),
                (ring_edges[j + 1], true, line([0., h1], [1., h1])?),
                (seam, false, line([1., h0], [1., h1])?),
                (ring_edges[j], false, line([0., h0], [1., h0])?),
            ] {
                let curve = out.edges[edge as usize].curve;
                let pc = PcurveId(out.pcurves.len() as u32);
                out.pcurves.push(Pcurve { curve, surface: sid, domain: unit(), geometry });
                out.curves[curve.0 as usize].supports.push(Support { surface: sid, pcurve: pc });
                coedges.push(CoedgeId(out.coedges.len() as u32));
                out.coedges.push(Coedge { edge: EdgeId(edge), forward, pcurve: pc });
            }
            let lid = LoopId(out.loops.len() as u32);
            out.loops.push(Loop { outer: true, coedges });
            out.faces.push(Face { surface: sid, forward: false, loops: vec![lid] });
        }
    }
    out.shells.push(Shell { faces: (0..out.faces.len()).map(|i| FaceId(i as u32)).collect() });
    out.solids.push(wonky_contract::Solid { shells: vec![ShellId(0)] });
    out.clone().check().map_err(|e| no(&format!("contract: {e:?}")))?;
    Ok((out, points))
}

/// One equal-offset chamfer on a perforated box: straight box edges get
/// planar setbacks, circular hole rims get exact two-ring countersink cones.
pub fn equal_offsets(p: &Perforated, edges: &[usize], width: f64) -> R<Body> {
    let (facets, bores) = design(p, edges, width)?;
    let mut nodes = p.body.constructions.clone();
    let parent = nodes.len().checked_sub(1).ok_or_else(|| no("construction-parent"))?;
    nodes.push(Construction {
        operation: Operation::Intersection {},
        rule_version: RULE,
        parents: vec![NodeId(parent as u32)],
        parameters: std::iter::once(width)
            .chain(edges.iter().map(|&e| e as f64))
            .map(b)
            .collect::<R<_>>()?,
        frame: FrameId(1),
    });
    let (mut body, _) = assemble(p, &facets, &bores, nodes)?;
    body.key.revision = body.key.revision.checked_add(1).ok_or_else(|| no("revision-range"))?;
    Ok(body)
}

/// Replay the perforated parent from the DAG, rebuild this operation from its
/// receipt and require identity with the transported body.
pub fn audit(checked: &CheckedBody) -> R<PerforatedChamfer> {
    let body = checked.body();
    let root = body.constructions.len().checked_sub(1).ok_or_else(|| no("construction"))?;
    let n = &body.constructions[root];
    if !candidate(body)
        || root == 0
        || n.parents != [NodeId(root as u32 - 1)]
        || n.parameters.len() < 2
        || n.frame != FrameId(1)
    {
        return Err(no("construction-grammar"));
    }
    let width = n.parameters[0].get();
    let edges = n.parameters[1..]
        .iter()
        .map(|x| {
            let x = x.get();
            if x < 0. || x.fract() != 0. || x > u32::MAX as f64 {
                Err(no("edge-index"))
            } else {
                Ok(x as usize)
            }
        })
        .collect::<R<Vec<_>>>()?;
    let source = perforated::replay(body.key.clone(), &body.frames, &body.constructions[..root])?;
    let (facets, bores) = design(&source, &edges, width)?;
    let (rebuilt, points) = assemble(&source, &facets, &bores, body.constructions.clone())?;
    if rebuilt != *body {
        return Err(no("construction-binding"));
    }
    let solid = PerforatedChamfer { body: body.clone(), source, facets, bores, points };
    let (v6, _) = solid.prism();
    let removed: Q = solid.bores.iter().map(|b| b.integrals().0).sum();
    // pi < 22/7 bounds the removed volume from above without rounding.
    if v6 <= q(6.) * q(22.) / q(7.) * removed {
        return Err(no("nonpositive-volume"));
    }
    Ok(solid)
}

impl PerforatedChamfer {
    fn frame(&self) -> &Placement {
        &self.source.base.frame
    }
    fn scale(&self) -> R<Iv> {
        let defect = self.frame().orthonormality_defect().map_err(|_| no("frame-range"))?;
        Ok(Iv { m: 1., r: (3. * defect).next_up() })
    }
    fn pi() -> R<Iv> {
        Ok(wonky_validated::pi(1e-14).map_err(|_| no("validated-pi"))?.ball())
    }
    /// Six times the exact prism volume and 24 times its first moment (m).
    fn prism(&self) -> (Q, V) {
        let mut v6 = Q::zero();
        let mut m: V = std::array::from_fn(|_| Q::zero());
        for s in &self.facets {
            let lp = &s.outer;
            for i in 1..lp.len() - 1 {
                let d = dot(&lp[0], &cross(&lp[i], &lp[i + 1]));
                for k in 0..3 {
                    m[k] += &d * (&lp[0][k] + &lp[i][k] + &lp[i + 1][k]);
                }
                v6 += d;
            }
        }
        (v6, m)
    }
    pub fn transform(&self, _frame: crate::affine::Affine) -> R<Body> {
        Err(no("placement-unimplemented"))
    }
    pub fn measures_mm(&self) -> R<(Iv, Iv, Vec<f64>, Vec<f64>)> {
        let pi = Self::pi()?;
        let (v6, _) = self.prism();
        let removed: Q = self.bores.iter().map(|b| b.integrals().0).sum();
        let det = enclosed(&self.frame().det_exact().map_err(|_| no("frame-range"))?);
        let volume = finite((iv(&(v6 / q(6.) * q(1e9)))? - pi * iv(&(removed * q(1e9)))?) * det)?;
        let scale = self.scale()?;
        let mm = Iv::point(1000.);
        let (mut total, mut areas, mut perimeters) = (Iv::point(0.), vec![], vec![]);
        for (fi, s) in self.facets.iter().enumerate() {
            let a2 = area_vector(&s.outer);
            let mut area = root_iv(&(dot(&a2, &a2) * q(2.5e11)))?;
            let mut perimeter = Iv::point(0.);
            for i in 0..s.outer.len() {
                let d = sub(&s.outer[(i + 1) % s.outer.len()], &s.outer[i]);
                perimeter = perimeter + root_iv(&(dot(&d, &d) * q(1e6)))?;
            }
            for bore in &self.bores {
                for end in 0..2 {
                    if bore.caps[end] == fi {
                        let r = Iv::point(bore.end(end)[1]) * mm;
                        area = area - pi * r * r;
                        perimeter = perimeter + Iv::point(2.) * pi * r;
                    }
                }
            }
            total = total + area;
            areas.push(finite(area * scale)?.m);
            perimeters.push(finite(perimeter * scale)?.m);
        }
        for bore in &self.bores {
            for w in bore.rings.windows(2) {
                let (za, ra, zb, rb) = (q(w[0][0]), q(w[0][1]), q(w[1][0]), q(w[1][1]));
                let slant = root_iv(&(((&rb - &ra) * (&rb - &ra) + (&zb - &za) * (&zb - &za)) * q(1e6)))?;
                let radii = iv(&((&ra + &rb) * q(1000.)))?;
                // Cone band pi (r_a + r_b) s; for a cylinder s is its height.
                let area = pi * radii * slant;
                total = total + area;
                areas.push(finite(area * scale)?.m);
                perimeters.push(finite((Iv::point(2.) * pi * radii + Iv::point(2.) * slant) * scale)?.m);
            }
        }
        let area = finite(total * scale)?;
        if volume.lo() <= 0. || volume.r / volume.m > 1e-9 || area.lo() <= 0. || area.r / area.m > 1e-9 {
            return Err(no("observation-width"));
        }
        Ok((volume, area, areas, perimeters))
    }
    pub fn centroid_mm(&self) -> R<[f64; 3]> {
        let pi = Self::pi()?;
        let (v6, m24) = self.prism();
        let mut removed = Q::zero();
        let mut moment: V = std::array::from_fn(|_| Q::zero());
        for bore in &self.bores {
            let (v, m) = bore.integrals();
            removed += v;
            for j in 0..3 {
                moment[j] += &m[j];
            }
        }
        let volume = iv(&(v6 / q(6.)))? - pi * iv(&removed)?;
        let mut p = [0.; 3];
        for j in 0..3 {
            let c = finite((iv(&(&m24[j] / q(24.)))? - pi * iv(&moment[j])?) / volume)?;
            if c.r > 1e-12 {
                return Err(no("centroid-width"));
            }
            p[j] = c.m;
        }
        self.frame().apply(p, 1000., true).map_err(|_| no("frame-range"))
    }
    /// Exact world-millimetre image of a source point under the frame.
    fn world(&self) -> R<impl Fn(&V) -> V> {
        let e = |p: [f64; 3], t: bool| -> R<V> {
            let x = self.frame().apply_exact(p, 1000., t).map_err(|_| no("frame-range"))?;
            Ok(x.map(|c| c.iter().map(|&v| q(v)).sum()))
        };
        let origin = e([0.; 3], true)?;
        let columns = [e([1., 0., 0.], false)?, e([0., 1., 0.], false)?, e([0., 0., 1.], false)?];
        Ok(move |p: &V| -> V {
            std::array::from_fn(|k| {
                &origin[k] + &p[0] * &columns[0][k] + &p[1] * &columns[1][k] + &p[2] * &columns[2][k]
            })
        })
    }
    /// The bores stay strictly inside every face that is not their cap, so no
    /// prism vertex is removed: the box of the solid is the box of the prism.
    pub fn bbox_mm(&self, map: Option<[[f64; 4]; 3]>) -> R<([f64; 3], [f64; 3])> {
        let world = self.world()?;
        let mut lo = [f64::INFINITY; 3];
        let mut hi = [f64::NEG_INFINITY; 3];
        for p in &self.points {
            let w = world(p);
            let t: V = match map {
                None => w,
                Some(a) => std::array::from_fn(|i| {
                    q(a[i][3]) + (0..3).map(|k| q(a[i][k]) * &w[k]).sum::<Q>()
                }),
            };
            for k in 0..3 {
                let x = f(&t[k])?;
                lo[k] = lo[k].min(x);
                hi[k] = hi[k].max(x);
            }
        }
        Ok((lo, hi))
    }
    /// Bound (mm) on the distance of a rounded planar witness from its exact vertex.
    pub(crate) fn witness_mm(&self) -> R<f64> {
        let mut worst = Q::zero();
        for (i, exact) in self.points.iter().enumerate() {
            let w = &self.body.vertices[i].point;
            for k in 0..3 {
                worst = worst.max((q(w[k].get()) - &exact[k]).abs());
            }
        }
        let bound = (f(&worst)? * 1000.).next_up() * 3f64.sqrt().next_up() * self.scale()?.hi();
        let bound = bound.next_up();
        if !bound.is_finite() {
            return Err(no("witness-range"));
        }
        Ok(bound)
    }
    pub fn tolerance_mm(&self) -> R<f64> {
        let reach = self
            .points
            .iter()
            .flatten()
            .map(|x| f(x).map(f64::abs))
            .collect::<R<Vec<_>>>()?
            .into_iter()
            .fold(0., f64::max);
        // STEP plane origins also round in source coordinates before placement.
        let planes = 8. * (reach.next_up() - reach) * 1000.;
        let t = (self.source.tolerance_mm()? + self.witness_mm()? + planes).next_up();
        if !t.is_finite() {
            return Err(no("tolerance-range"));
        }
        Ok(t)
    }
    fn face_distance(&self, fi: usize, p: &V) -> R<Iv> {
        let s = &self.facets[fi];
        let nn = dot(&s.normal, &s.normal);
        let side = dot(&s.normal, p) - &s.offset;
        let t = &side / &nn;
        let foot: V = std::array::from_fn(|k| &p[k] - &t * &s.normal[k]);
        let plane_sq = &side * &t;
        let n = s.outer.len();
        let inside = (0..n).all(|i| {
            let (a, c) = (&s.outer[i], &s.outer[(i + 1) % n]);
            !dot(&cross(&sub(c, a), &sub(&foot, a)), &s.normal).is_negative()
        });
        if !inside {
            // The nearest point lies on the outer boundary: discs are interior.
            let best = (0..n).map(|i| segment_sq(p, &s.outer[i], &s.outer[(i + 1) % n])).min().unwrap();
            return root_iv(&best);
        }
        for bore in &self.bores {
            for end in 0..2 {
                if bore.caps[end] != fi {
                    continue;
                }
                let [h, rho] = bore.end(end);
                let d = sub(&foot, &bore.ring_center(h));
                let d2 = dot(&d, &d);
                if d2 < q(rho) * q(rho) {
                    let gap = Iv::point(rho) - root_iv(&d2)?;
                    return finite(root_iv(&plane_sq)?.norm3(gap, Iv::point(0.)));
                }
            }
        }
        root_iv(&plane_sq)
    }
    /// Distance to a full-turn band: the meridian distance from (rho, z) to
    /// its generator segment. An undecided clamp encloses both branches.
    fn band_distance(bore: &Bore, w: &[[f64; 2]], p: &V) -> R<Iv> {
        let rho = root_iv(&bore.radial_sq(p))?;
        let z = iv(&p[bore.k])?;
        let (za, ra, zb, rb) = (w[0][0], w[0][1], w[1][0], w[1][1]);
        let (dr, dz) = (Iv::point(rb) - Iv::point(ra), Iv::point(zb) - Iv::point(za));
        let (er, ez) = (rho - Iv::point(ra), z - Iv::point(za));
        let length = dr.norm3(dz, Iv::point(0.));
        let t = (er * dr + ez * dz) / (length * length);
        let mut out: Option<Iv> = None;
        let mut add = |x: Iv| out = Some(out.map_or(x, |o| hull(o, x)));
        if t.lo() <= 0. {
            add(er.norm3(ez, Iv::point(0.)));
        }
        if t.hi() >= 1. {
            add((rho - Iv::point(rb)).norm3(z - Iv::point(zb), Iv::point(0.)));
        }
        if t.hi() >= 0. && t.lo() <= 1. {
            add((er * dz - ez * dr).abs() / length);
        }
        finite(out.ok_or_else(|| no("probe-range"))?)
    }
    pub fn probe(&self, point_mm: [f64; 3]) -> R<(f64, bool, f64)> {
        let p = local_point(self.frame(), point_mm).map_err(no)?;
        let in_prism = self.facets.iter().all(|s| dot(&s.normal, &p) <= s.offset);
        // Removed bores are open: their exact walls stay material.
        let in_bore = self.bores.iter().any(|b| {
            let r = b.radius_at(&p[b.k]);
            b.radial_sq(&p) < &r * &r
        });
        if in_prism && !in_bore {
            return Ok((0., true, 0.));
        }
        let mut best: Option<Iv> = None;
        for fi in 0..self.facets.len() {
            let d = self.face_distance(fi, &p)?;
            best = Some(best.map_or(d, |b| b.min(d)));
        }
        for bore in &self.bores {
            for w in bore.rings.windows(2) {
                let d = Self::band_distance(bore, w, &p)?;
                best = Some(best.map_or(d, |b| b.min(d)));
            }
        }
        let d = finite(best.ok_or_else(|| no("probe-range"))? * Iv::point(1000.) * self.scale()?)?;
        Ok((d.m, false, d.r))
    }
    pub fn measure_json(&self, map: Option<[[f64; 4]; 3]>, probes: &[[f64; 3]]) -> R<String> {
        let (volume, area, areas, perimeters) = self.measures_mm()?;
        let (lo, hi) = self.bbox_mm(None)?;
        let mapped = if let Some(m) = map {
            let (l, h) = self.bbox_mm(Some(m))?;
            format!("{{\"min\":{l:?},\"max\":{h:?}}}")
        } else {
            "null".into()
        };
        let probes = probes
            .iter()
            .map(|&p| match self.probe(p) {
                Ok((d, i, b)) => format!("{{\"distanceMm\":{d:?},\"inside\":{i},\"boundMm\":{b:?}}}"),
                Err(e) => format!("{{\"refused\":\"{}\"}}", e.0),
            })
            .collect::<Vec<_>>()
            .join(",");
        let vertices = crate::cylinder_chart::vertices_mm(&self.body, self.frame())?;
        let edges = self.body.edges.iter().map(|e| [e.vertices[0].0, e.vertices[1].0]).collect::<Vec<_>>();
        let faces = self
            .body
            .faces
            .iter()
            .map(|f| {
                let loops = f
                    .loops
                    .iter()
                    .map(|l| {
                        let uses = self.body.loops[l.0 as usize]
                            .coedges
                            .iter()
                            .map(|u| {
                                let c = &self.body.coedges[u.0 as usize];
                                format!("[{},{}]", c.edge.0, c.forward)
                            })
                            .collect::<Vec<_>>();
                        format!("[{}]", uses.join(","))
                    })
                    .collect::<Vec<_>>();
                format!("[{}]", loops.join(","))
            })
            .collect::<Vec<_>>()
            .join(",");
        let rings: usize = self.bores.iter().map(|b| b.rings.len()).sum();
        let bands = rings - self.bores.len();
        // Canonical topology: periodic seams and their chart vertices are
        // export structure, not model edges or vertices.
        let topology = format!(
            "{{\"bodies\":1,\"shells\":1,\"faces\":{},\"edges\":{},\"vertices\":{},\"loops\":{},\"ringEdges\":{rings},\"closedToroidalFaces\":0,\"genus\":{},\"singularPoints\":0,\"pinchPoints\":0}}",
            self.body.faces.len(),
            self.body.edges.len() - bands,
            self.points.len(),
            self.facets.len() + 2 * self.bores.len() + 2 * bands,
            self.bores.len()
        );
        let centroid = self.centroid_mm()?;
        let tolerance = self.tolerance_mm()?;
        Ok(format!(concat!("{{\"basis\":\"native-f64-construction\",\"certificate\":\"PerforatedChamfer\",\"boundToConstruction\":true,",
            "\"volumeMm3\":{:?},\"volumeRelBound\":{:?},\"areaMm2\":{:?},\"areaRelBound\":{:?},\"centroidMm\":{:?},",
            "\"bboxMm\":{{\"min\":{:?},\"max\":{:?}}},\"mappedBboxMm\":{},\"topology\":{},",
            "\"validity\":{{\"brep\":true,\"closed\":true,\"positive\":true}},\"toleranceMm\":{:?},\"probes\":[{}],\"faceAreasMm2\":{:?},\"facePerimetersMm\":{:?},",
            "\"projection\":{{\"vertices\":{:?},\"edges\":{:?},\"faces\":[{}]}}}}"),
            volume.m, volume.r / volume.m, area.m, area.r / area.m, centroid, lo, hi, mapped, topology,
            tolerance, probes, areas, perimeters, vertices, edges, faces))
    }
}
