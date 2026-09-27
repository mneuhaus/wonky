//! Exact audit and general measurements of a planar WC0 v3 body.
//!
//! The audit works in the body's own frame on its binary64 source coordinates
//! (E4, E9); world coordinates are produced only for measurement and export, by
//! `affine` (exact evaluation, one rounding). It certifies:
//! - structure: one solid, one shell, plane carriers, line curves, one frame;
//! - edges: each curve is the line through its edge's vertices, domain [0, 1];
//! - loops: one outer loop per face, chained vertex to vertex;
//! - a closed oriented 2-manifold: every edge used by exactly two coedges in
//!   opposite senses, connected, Euler characteristic 2 (genus 0);
//! - exact incidence: every loop vertex lies on its face's carrier plane;
//! - orientation: each loop winds counterclockwise about its face's outward
//!   normal (exact Newell vector against the carrier normal);
//! - embedding: the AxisPrism certificate (every vertex on one of two levels of
//!   a coordinate axis, two caps, vertical quad sides, a simple cap polygon by
//!   exact segment tests), which admits nonconvex caps such as an L profile;
//! - positive exact signed volume;
//! - construction binding: vertices of a body built by `extrude` are exactly
//!   (region point, extrude level) of its Sketch/Extrude nodes.
//! Anything else is a named refusal; there is no tolerance anywhere.
use crate::placement::Placement;
use crate::rounding::{round, expansion_ball, finite_ball, norm_ball};
use wonky_num::ball::{Iv, Scalar};
use std::collections::{BTreeMap, BTreeSet};
use wonky_contract::*;
use std::result::Result;
use wonky_num::expansion::{mul, neg, sign, sum, Exp, Guard};
use wonky_num::{plane_side, p2, v3, Sign, P2};
use wonky_sketch::region::{self, Location};

/// A named audit or measurement refusal: `audit/<reason>` or `observe/<reason>`.
#[derive(Clone, Debug, PartialEq)]
pub struct Refused(pub String);
fn refuse<T>(what: impl Into<String>) -> Result<T, Refused> {
    Err(Refused(what.into()))
}
type R<T> = Result<T, Refused>;

fn p(v: &Vector3) -> [f64; 3] {
    [v[0].get(), v[1].get(), v[2].get()]
}
fn unit(d: &Domain) -> bool {
    matches!((&d.lower, &d.upper), (Limit::Finite { value: a, closed: true }, Limit::Finite { value: b, closed: true }) if a.get() == 0.0 && b.get() == 1.0)
}

#[derive(Clone, Debug, PartialEq)]
pub struct Topology {
    pub bodies: usize,
    pub shells: usize,
    pub faces: usize,
    pub edges: usize,
    pub vertices: usize,
    pub loops: usize,
    pub ring_edges: usize,
    pub closed_toroidal_faces: usize,
    pub genus: i64,
    pub singular_points: usize,
    pub pinch_points: usize,
}

/// A body that passed the audit, with its source data.
#[derive(Clone, Debug)]
pub struct Audited {
    pub body: Body,
    pub frame: Placement,
    /// Axis of the AxisPrism certificate and its two levels (source units).
    pub axis: usize,
    pub levels: [f64; 2],
    /// Cap polygon (u, v) of the prism, counterclockwise.
    pub cap: Vec<P2>,
    /// Face loops as vertex ids, counterclockwise about the outward normal.
    pub face_loops: Vec<Vec<usize>>,
    /// Vertices were checked against Sketch/Extrude construction parameters.
    pub bound_to_construction: bool,
    /// Exact rectilinear cell-boundary certificate, when this is not an AxisPrism.
    pub orthogonal: Option<crate::orthogonal::Cells>,
    pub(crate) arcs: Option<crate::arc_profile::ArcPrism>,
    pub(crate) rounded: Option<crate::fillet_prism::RoundedPrism>,
    pub(crate) corner: Option<crate::fillet_corner::Corner>,
    pub(crate) chamfer: Option<crate::chamfer::Chamfered>,
    /// Replayed exact boundary; WC0 coordinates are observations, not inputs.
    pub(crate) arrangement: Option<crate::planar_geometry::Arrangement>,
}

fn frame_of(body: &Body, id: FrameId) -> R<Placement> {
    if matches!(body.frames.get(id.0 as usize), Some(Frame::Rigid { .. })) { return refuse("audit/rigid-frame-unsupported"); }
    Placement::from_frames(body, id).map_err(|_| Refused("audit/frame-unsupported-or-range".into()))
}

fn exact_sign(e: &[f64], g: &Guard) -> R<i32> {
    if !g.exact() {
        return refuse("audit/numeric-not-exact");
    }
    Ok(sign(e))
}

/// det[a, b, c] = a . (b x c) as an exact expansion.
fn det3(a: [f64; 3], b: [f64; 3], c: [f64; 3], g: &mut Guard) -> Exp {
    let cross = |i: usize, j: usize, g: &mut Guard| {
        let l = mul(&[b[i]], &[c[j]], g);
        let r = mul(&[b[j]], &[c[i]], g);
        sum(&l, &neg(&r), g)
    };
    let bc = [cross(1, 2, g), cross(2, 0, g), cross(0, 1, g)];
    let mut out = Exp::new();
    for k in 0..3 {
        out = sum(&out, &mul(&bc[k], &[a[k]], g), g);
    }
    out
}

/// Twice the vector area (Newell) of a closed loop, exactly.
fn newell(points: &[[f64; 3]], g: &mut Guard) -> [Exp; 3] {
    let mut out: [Exp; 3] = Default::default();
    for (k, a) in points.iter().enumerate() {
        let b = points[(k + 1) % points.len()];
        for (axis, (i, j)) in [(1, 2), (2, 0), (0, 1)].into_iter().enumerate() {
            let l = mul(&[a[i]], &[b[j]], g);
            let r = mul(&[a[j]], &[b[i]], g);
            out[axis] = sum(&out[axis], &sum(&l, &neg(&r), g), g);
        }
    }
    out
}

pub fn audit(checked: &CheckedBody) -> R<Audited> {
    let body = checked.body().clone();
    if crate::chamfer::candidate(&body) { return crate::chamfer::audit(checked); }
    if crate::arc_profile::candidate(&body) { return crate::arc_profile::audit(checked); }
    if crate::fillet_corner::candidate(&body) { return crate::fillet_corner::audit(checked); }
    if crate::fillet_prism::candidate(&body) { return crate::fillet_prism::audit(checked); }
    if crate::planar_boolean::candidate(&body) { return crate::planar_boolean::audit(&body); }
    if crate::orthogonal::is_candidate(&body) {
        let fid = body.vertices[0].frame;
        let frame = frame_of(&body, fid)?;
        if body.constructions.iter().any(|n| matches!(n.operation, Operation::Shell {})) {
            crate::source_frame::SourceMetric::new(&frame)?;
        }
        let cells = crate::orthogonal::audit(&body, frame.as_affine()?)?;
        let face_loops = body.loops.iter().map(|lp| lp.coedges.iter().map(|id| {
            let co = &body.coedges[id.0 as usize];
            body.edges[co.edge.0 as usize].vertices[usize::from(!co.forward)].0 as usize
        }).collect()).collect();
        return Ok(Audited { body, frame, axis: 2, levels: [0.;2], cap: vec![], face_loops,
            bound_to_construction: true, orthogonal: Some(cells), rounded: None, corner: None, chamfer: None, arcs: None, arrangement: None });
    }
    if body.solids.len() != 1 || body.solids[0].shells.len() != 1 || body.shells.len() != 1 {
        return refuse("audit/one-solid-one-shell-required");
    }
    let shell = &body.shells[0];
    let frame_id = body.vertices.first().map(|v| v.frame).ok_or_else(|| Refused("audit/empty-body".into()))?;
    if body.vertices.iter().any(|v| v.frame != frame_id)
        || body.curves.iter().any(|c| c.frame != frame_id)
        || body.surfaces.iter().any(|s| s.frame != frame_id)
    {
        return refuse("audit/mixed-frames");
    }
    let frame = frame_of(&body, frame_id)?;
    let points: Vec<[f64; 3]> = body.vertices.iter().map(|v| p(&v.point)).collect();
    // Edges: the curve is the line through the edge's own vertices.
    for e in &body.edges {
        let c = &body.curves[e.curve.0 as usize];
        let CurveGeometry::Line { a, b } = &c.geometry else { return refuse("audit/non-line-edge") };
        if !unit(&e.domain) || !unit(&c.domain) {
            return refuse("audit/edge-domain");
        }
        let (va, vb) = (points[e.vertices[0].0 as usize], points[e.vertices[1].0 as usize]);
        if p(a) != va || p(b) != vb || va == vb {
            return refuse("audit/edge-curve-binding");
        }
    }
    // Loops: one outer loop per face, chained; collect vertex cycles.
    let mut face_loops = Vec::with_capacity(shell.faces.len());
    let mut uses: BTreeMap<u32, Vec<bool>> = BTreeMap::new();
    let mut loop_count = 0;
    let mut face_set = BTreeSet::new();
    for f in &shell.faces {
        if !face_set.insert(f.0) {
            return refuse("audit/face-repeated");
        }
        let face = &body.faces[f.0 as usize];
        if face.loops.len() != 1 || !body.loops[face.loops[0].0 as usize].outer {
            return refuse("audit/face-loops");
        }
        loop_count += 1;
        let coedges = &body.loops[face.loops[0].0 as usize].coedges;
        if coedges.len() < 3 {
            return refuse("audit/loop-too-short");
        }
        let ends: Vec<[usize; 2]> = coedges
            .iter()
            .map(|c| {
                let co = &body.coedges[c.0 as usize];
                let endpoints = &body.edges[co.edge.0 as usize].vertices;
                let (a, b) = (endpoints[0], endpoints[1]);
                uses.entry(co.edge.0).or_default().push(co.forward);
                if co.forward { [a.0 as usize, b.0 as usize] } else { [b.0 as usize, a.0 as usize] }
            })
            .collect();
        for k in 0..ends.len() {
            if ends[k][1] != ends[(k + 1) % ends.len()][0] {
                return refuse("audit/loop-gap");
            }
        }
        let cycle: Vec<usize> = ends.iter().map(|e| e[0]).collect();
        if cycle.iter().collect::<BTreeSet<_>>().len() != cycle.len() {
            return refuse("audit/loop-repeated-vertex");
        }
        // Exact incidence with the carrier and orientation about the outward normal.
        let SurfaceGeometry::Plane { origin, normal, .. } = &body.surfaces[face.surface.0 as usize].geometry else {
            return refuse("audit/non-plane-face");
        };
        let (o, n) = (p(origin), p(normal));
        for &k in &cycle {
            let q = points[k];
            let side = plane_side(v3(n[0], n[1], n[2]), v3(q[0], q[1], q[2]), v3(o[0], o[1], o[2]), "prism audit carrier incidence")
                .map_err(|e| Refused(format!("audit/numeric: {}", e.into_refusal())))?;
            if side != Sign::Zero {
                return refuse("audit/vertex-off-carrier");
            }
        }
        let mut g = Guard::new();
        let loop_points: Vec<[f64; 3]> = cycle.iter().map(|&k| points[k]).collect();
        let a = newell(&loop_points, &mut g);
        let mut along = Exp::new();
        for k in 0..3 {
            along = sum(&along, &mul(&a[k], &[n[k]], &mut g), &mut g);
        }
        let expected = if face.forward { 1 } else { -1 };
        if exact_sign(&along, &g)? != expected {
            return refuse("audit/loop-orientation");
        }
        face_loops.push(cycle);
    }
    // Closed, oriented edge usage; every edge of the body is used.
    if uses.len() != body.edges.len() || uses.values().any(|u| u.len() != 2 || u[0] == u[1]) {
        return refuse("audit/edge-usage");
    }
    let used_vertices: BTreeSet<usize> = face_loops.iter().flatten().copied().collect();
    if used_vertices.len() != body.vertices.len() {
        return refuse("audit/dangling-vertex");
    }
    // Connectivity over shared edges.
    let mut owner: BTreeMap<u32, Vec<usize>> = BTreeMap::new();
    for (i, f) in shell.faces.iter().enumerate() {
        for c in &body.loops[body.faces[f.0 as usize].loops[0].0 as usize].coedges {
            owner.entry(body.coedges[c.0 as usize].edge.0).or_default().push(i);
        }
    }
    let mut reached = vec![false; shell.faces.len()];
    let mut stack = vec![0usize];
    reached[0] = true;
    while let Some(i) = stack.pop() {
        for faces in owner.values().filter(|f| f.contains(&i)) {
            for &j in faces {
                if !reached[j] {
                    reached[j] = true;
                    stack.push(j);
                }
            }
        }
    }
    if reached.iter().any(|r| !r) {
        return refuse("audit/disconnected-shell");
    }
    let (v, e, f) = (body.vertices.len() as i64, body.edges.len() as i64, shell.faces.len() as i64);
    if v - e + 2 * f - loop_count as i64 != 2 {
        return refuse("audit/euler-characteristic");
    }
    // Embedding: AxisPrism along one coordinate axis of the frame, the source w
    // axis (an extrusion's own direction) first: a box is a prism along all three.
    let mut certificate = None;
    for axis in [2, 0, 1] {
        if let Some(c) = axis_prism(&points, &face_loops, axis)? {
            certificate = Some((axis, c));
            break;
        }
    }
    let Some((axis, (levels, cap))) = certificate else { return refuse("audit/embedding-uncertified") };
    let mut audited = Audited { body, frame, axis, levels, cap, face_loops, bound_to_construction: false, orthogonal: None, rounded: None, corner: None, chamfer: None, arcs: None, arrangement: None };
    // Positive exact signed volume.
    if sign(&audited.volume6_source()?) <= 0 {
        return refuse("audit/inward-or-empty-shell");
    }
    audited.bound_to_construction = binding(&audited)?;
    Ok(audited)
}

/// The AxisPrism certificate: ([lo, hi], counterclockwise cap polygon) or None.
fn axis_prism(points: &[[f64; 3]], loops: &[Vec<usize>], axis: usize) -> R<Option<([f64; 2], Vec<P2>)>> {
    let (u, w) = ((axis + 1) % 3, (axis + 2) % 3);
    let lo = points.iter().map(|q| q[axis]).fold(f64::INFINITY, f64::min);
    let hi = points.iter().map(|q| q[axis]).fold(f64::NEG_INFINITY, f64::max);
    if !(lo < hi) || points.iter().any(|q| q[axis] != lo && q[axis] != hi) {
        return Ok(None);
    }
    let mut caps = [None, None];
    let mut sides = 0;
    for cycle in loops {
        let low = cycle.iter().filter(|&&k| points[k][axis] == lo).count();
        if low == cycle.len() || low == 0 {
            let slot = if low == 0 { 1 } else { 0 };
            if caps[slot].is_some() {
                return Ok(None);
            }
            caps[slot] = Some(cycle);
            continue;
        }
        if cycle.len() != 4 || low != 2 {
            return Ok(None);
        }
        // A vertical quad: each vertex has a partner on the other level with the
        // same (u, w) coordinates, and the partners are adjacent in the loop.
        for k in 0..4 {
            let (a, b) = (points[cycle[k]], points[cycle[(k + 1) % 4]]);
            let vertical = a[u] == b[u] && a[w] == b[w];
            let level = a[axis] == b[axis];
            if vertical == level {
                return Ok(None);
            }
        }
        sides += 1;
    }
    let [Some(bottom), Some(top)] = caps else { return Ok(None) };
    if bottom.len() != top.len() || sides != bottom.len() {
        return Ok(None);
    }
    let mut cap: Vec<P2> = top.iter().map(|&k| p2(points[k][u], points[k][w])).collect();
    let mut bottom_uv: Vec<(u64, u64)> = bottom.iter().map(|&k| ((points[k][u] + 0.0).to_bits(), (points[k][w] + 0.0).to_bits())).collect();
    let mut top_uv: Vec<(u64, u64)> = cap.iter().map(|q| ((q.x + 0.0).to_bits(), (q.y + 0.0).to_bits())).collect();
    bottom_uv.sort();
    top_uv.sort();
    if bottom_uv != top_uv {
        return Ok(None);
    }
    match region::simple_polygon(&cap) {
        Ok(()) => {}
        Err(_) => return Ok(None),
    }
    if sign(&region::signed_area2(&cap).map_err(|_| Refused("audit/numeric-not-exact".into()))?) < 0 {
        cap.reverse();
    }
    Ok(Some(([lo, hi], cap)))
}

/// Vertices against the Sketch/Extrude nodes: every vertex is exactly
/// (region point, extrude level). False when the body has no such lineage.
fn binding(a: &Audited) -> R<bool> {
    let body = &a.body;
    let nodes = &body.constructions;
    let Some(Provenance::Construction { node }) = body.vertices.first().map(|v| v.provenance.clone()) else { return Ok(false) };
    let mut source = node;
    while matches!(nodes[source.0 as usize].operation, Operation::AffineTransform {}) {
        source = nodes[source.0 as usize].parents[0];
    }
    let extrude = &nodes[source.0 as usize];
    if !matches!(extrude.operation, Operation::Extrude {}) {
        return Ok(false);
    }
    let sketch = extrude.parents.first().map(|n| &nodes[n.0 as usize]);
    let Some(sketch) = sketch.filter(|s| matches!(s.operation, Operation::Sketch {})) else { return refuse("audit/construction-lineage") };
    if extrude.parameters.len() != 2 || sketch.parameters.len() % 2 != 0 {
        return refuse("audit/construction-parameters");
    }
    let levels = [extrude.parameters[0].get(), extrude.parameters[1].get()];
    let region: BTreeSet<(u64, u64)> = sketch.parameters.chunks(2).map(|c| (c[0].bits(), c[1].bits())).collect();
    for v in &body.vertices {
        if v.provenance != (Provenance::Construction { node }) {
            return refuse("audit/construction-lineage");
        }
        let q = p(&v.point);
        if !levels.iter().any(|l| l.to_bits() == q[2].to_bits()) || !region.contains(&(q[0].to_bits(), q[1].to_bits())) {
            return refuse("audit/vertex-not-construction-value");
        }
    }
    if levels != a.levels || a.axis != 2 || region.len() != a.cap.len() {
        return refuse("audit/construction-levels");
    }
    Ok(true)
}

const MM: f64 = 1000.0;

/// One probe distance observation.
#[derive(Clone, Debug, PartialEq)]
pub enum Probe {
    Measured { distance_mm: f64, inside: bool, bound_mm: f64 },
    Refused(String),
}

impl Audited {
    fn points(&self) -> Vec<[f64; 3]> {
        self.body.vertices.iter().map(|v| p(&v.point)).collect()
    }

    /// 6 * signed volume in source units (exact).
    pub fn volume6_source(&self) -> R<Exp> {
        if self.arrangement.is_some() { return refuse("observe/rational-volume-not-expansion"); }
        if self.arcs.is_some() || self.rounded.is_some() || self.corner.is_some() || self.chamfer.is_some() { return refuse("observe/non-polynomial-volume"); }
        let points = self.points();
        let mut g = Guard::new();
        let mut total = Exp::new();
        for cycle in &self.face_loops {
            let p0 = points[cycle[0]];
            for k in 1..cycle.len() - 1 {
                total = sum(&total, &det3(p0, points[cycle[k]], points[cycle[k + 1]], &mut g), &mut g);
            }
        }
        exact_sign(&total, &g)?;
        Ok(total)
    }

    /// World volume in mm^3: det(frame) * source volume * 1e9, evaluated exactly
    /// and rounded once, then divided by 6 (one more rounding): relative error
    /// at most 2^-52.
    pub fn volume_mm3(&self) -> R<f64> {
        if let Some(s)=&self.chamfer { return s.volume().map(|v|v.m); }
        if let Some(s)=&self.arcs { return s.volume(self).map(|v|v.mid()); }
        if let Some(s)=&self.corner { return s.volume(self).map(|v|v.mid()); }
        if let Some(a) = &self.arrangement { return a.volume_mm3(&self.face_loops); }
        if let Some(s)=&self.rounded { return s.volume(self).map(|v|v.mid()); }
        let v6 = self.volume6_source()?;
        let det = self.frame.det_exact().map_err(|_| Refused("observe/frame-det".into()))?;
        let det = if sign(&det) < 0 { neg(&det) } else { det };
        let mut g = Guard::new();
        let world = mul(&mul(&v6, &det, &mut g), &[MM * MM * MM], &mut g);
        exact_sign(&world, &g)?;
        let volume = round(&world).map_err(|_| Refused("observe/volume-range".into()))? / 6.0;
        // The published relative-only error bound requires a normal result.
        if !volume.is_normal() || volume <= 0.0 { return refuse("observe/volume-range"); }
        Ok(volume)
    }

    /// World vertices in mm, each coordinate the correctly rounded exact image.
    pub fn world_vertices_mm(&self) -> R<Vec<[f64; 3]>> {
        if let Some(s)=&self.chamfer { return s.world_vertices(self); }
        if let Some(a) = &self.arrangement { return a.vertices_mm(); }
        #[allow(unused_mut)]
        let mut w: Vec<[f64; 3]> = self.points().into_iter().map(|q| self.frame.apply(q, MM, true).map_err(|_| Refused("observe/vertex-range".into()))).collect::<R<_>>()?;
        #[cfg(feature = "plant_v1_vertex")]
        if w[0][0].abs() > 1e4 {
            w[0][0] += 1e-9;
        }
        Ok(w)
    }

    /// Bound on the distance between an exported vertex and its exact image:
    /// half an ulp per coordinate, i.e. sqrt(3)/2 ulp <= 1 ulp of the largest.
    pub fn export_tolerance_mm(&self) -> R<f64> {
        if let Some(s)=&self.arcs { return s.tolerance(self); }
        if let Some(a) = &self.arrangement { return a.export_tolerance_mm(&self.face_loops); }
        let w = self.world_vertices_mm()?;
        let max = w.iter().flatten().fold(0.0f64, |m, c| m.max(c.abs()));
        let mut tolerance = 2.0 * (max.next_up() - max).max(f64::MIN_POSITIVE);
        if self.rounded.is_some() || self.corner.is_some() {
            let reach = self.points().iter().flatten().fold(0.0f64, |m, c| m.max(c.abs()));
            tolerance = tolerance.max(crate::source_frame::SourceMetric::new(&self.frame)?
                .export_budget(reach * 1000., max)?);
        }
        if self.chamfer.is_some() {
            // STEP plane origins also round in source coordinates before placement.
            let reach=self.points().iter().flatten().fold(0.0f64,|m,x|m.max(x.abs()));
            tolerance=tolerance.max(8.0 * (reach.next_up()-reach) * MM);
        }
        if !tolerance.is_finite() { return refuse("observe/tolerance-range"); }
        Ok(tolerance)
    }

    /// Face areas in mm^2, in face order: the exact source vector area mapped
    /// by the cofactor of the frame (f64), relative error <= 64 eps.
    pub fn face_areas_mm2(&self) -> R<Vec<f64>> {
        if let Some(s)=&self.chamfer { return s.areas().map(|v|v.into_iter().map(|x|x.m).collect()); }
        if let Some(s)=&self.arcs { return s.areas(self).map(|v|v.into_iter().map(|x|x.mid()).collect()); }
        if let Some(s)=&self.corner { return s.areas(self).map(|v|v.into_iter().map(|x|x.mid()).collect()); }
        if let Some(a) = &self.arrangement { return a.areas_mm2(&self.face_loops); }
        if let Some(s)=&self.rounded { return s.areas(self).map(|v|v.into_iter().map(|x|x.mid()).collect()); }
        let points = self.points();
        let [x, y, z] = self.frame.enclosed_columns();
        let cross = |a: [Iv; 3], b: [Iv; 3]| [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
        let cof = [cross(y, z), cross(z, x), cross(x, y)];
        let mut out = Vec::new();
        for face in &self.body.faces {
            let mut g = Guard::new();
            let mut a: [Exp;3] = Default::default();
            for lp in &face.loops {
                let cycle = &self.face_loops[lp.0 as usize];
                let loop_points: Vec<[f64;3]> = cycle.iter().map(|&k| points[k]).collect();
                let n = newell(&loop_points, &mut g);
                for k in 0..3 { a[k] = sum(&a[k], &n[k], &mut g); }
            }
            exact_sign(&a[0], &g)?;
            let a = a.map(|e| expansion_ball(&e));
            let w = [0, 1, 2].map(|k| cof[0][k] * a[0] + cof[1][k] * a[1] + cof[2][k] * a[2]);
            let area = norm_ball(w).and_then(|n| finite_ball(n * Iv::point(0.5 * MM * MM)))
                .map_err(|_| Refused("observe/area-range".into()))?;
            // Never publish the relative certificate for an unresolved norm.
            if area.lo() <= 0.0 || !area.m.is_normal() || area.r / area.m > 48.0 * f64::EPSILON {
                return refuse("observe/area-range");
            }
            out.push(area.m);
        }
        Ok(out)
    }

    /// Face perimeters in mm from the exported (rounded) vertices.
    pub fn face_perimeters_mm(&self) -> R<Vec<f64>> {
        if let Some(s)=&self.arcs { return s.perimeters(self); }
        if let Some(s)=&self.corner { return s.perimeters(self); }
        if let Some(a) = &self.arrangement { return a.perimeters_mm(&self.face_loops); }
        if let Some(s)=&self.rounded { return s.perimeters(self); }
        let w = self.world_vertices_mm()?;
        self.body.faces.iter().map(|f| {
            let mut perimeter = Iv::point(0.0);
            for l in &f.loops {
                let c = &self.face_loops[l.0 as usize];
                for k in 0..c.len() {
                    let (a, b) = (w[c[k]], w[c[(k + 1) % c.len()]]);
                    let d = [0, 1, 2].map(|i| Iv::point(a[i]) - Iv::point(b[i]));
                    perimeter = perimeter + norm_ball(d).map_err(|_| Refused("observe/perimeter-range".into()))?;
                }
            }
            let perimeter = finite_ball(perimeter).map_err(|_| Refused("observe/perimeter-range".into()))?;
            if perimeter.lo() <= 0.0 { return refuse("observe/perimeter-range"); }
            Ok(perimeter.m)
        }).collect()
    }

    /// Axis-aligned box of the exported vertices, optionally after an affine
    /// map q = A[.][0..3] . p + A[.][3] given by the caller (f64). The box of a
    /// polyhedron is attained at its vertices.
    pub fn bbox_mm(&self, map: Option<[[f64; 4]; 3]>) -> R<([f64; 3], [f64; 3])> {
        if let Some(a) = &self.arrangement { return a.bbox_mm(map); }
        if let Some(s)=&self.corner { return s.bbox(self,map); }
        if let Some(s)=&self.arcs { return s.bbox(self,map); }
        if let Some(s)=&self.rounded { return s.bbox(self,map); }
        let mut lo = [f64::INFINITY; 3];
        let mut hi = [f64::NEG_INFINITY; 3];
        for w in self.world_vertices_mm()? {
            let q = match map {
                None => w,
                Some(a) => {
                    let mut g = Guard::new();
                    let mut q = [0.0; 3];
                    for i in 0..3 {
                        let mut e = vec![a[i][3]];
                        for k in 0..3 { e = sum(&e, &mul(&[a[i][k]], &[w[k]], &mut g), &mut g); }
                        if !g.exact() { return refuse("observe/bbox-range"); }
                        q[i] = round(&e).map_err(|_| Refused("observe/bbox-range".into()))?;
                    }
                    q
                },
            };
            for k in 0..3 {
                lo[k] = lo[k].min(q[k]);
                hi[k] = hi[k].max(q[k]);
            }
        }
        Ok((lo, hi))
    }

    /// Centroid of the exported vertices, with an outward-rounded absolute
    /// enclosure. Normalize before forming tetrahedron volumes and moments:
    /// their cubic/fourth-degree intermediates need not fit even when C does.
    pub fn centroid_with_bound_mm(&self) -> R<([f64; 3], [f64; 3])> {
        if let Some(s)=&self.chamfer { return s.centroid(self); }
        if let Some(a) = &self.arrangement { return a.centroid_mm(&self.face_loops); }
        if let Some(s)=&self.corner { return s.centroid(self); }
        if let Some(s)=&self.arcs { return s.centroid(self); }
        if let Some(s)=&self.rounded { return s.centroid(self); }
        let w = self.world_vertices_mm()?;
        let r = w[0];
        let mut scale = 0.0f64;
        let mut d = Vec::new();
        for q in w {
            let v = [0, 1, 2].map(|i| Iv::point(q[i]) - Iv::point(r[i]));
            for x in v {
                let x = finite_ball(x).map_err(|_| Refused("observe/centroid-range".into()))?;
                scale = scale.max(x.lo().abs()).max(x.hi().abs());
            }
            d.push(v);
        }
        if scale == 0.0 { return refuse("observe/centroid-range"); }
        for v in &mut d { *v = v.map(|x| x / Iv::point(scale)); }
        let (mut m, mut c) = (Iv::point(0.0), [Iv::point(0.0); 3]);
        for cycle in &self.face_loops {
            let a = d[cycle[0]];
            for k in 1..cycle.len() - 1 {
                let (b, e) = (d[cycle[k]], d[cycle[k + 1]]);
                let vol = a[0] * (b[1] * e[2] - b[2] * e[1]) + a[1] * (b[2] * e[0] - b[0] * e[2]) + a[2] * (b[0] * e[1] - b[1] * e[0]);
                m = m + vol;
                for i in 0..3 { c[i] = c[i] + vol * (a[i] + b[i] + e[i]) / Iv::point(4.0); }
            }
        }
        if m.is_nan() || (m.lo() <= 0.0 && m.hi() >= 0.0) { return refuse("observe/centroid-range"); }
        let mut mid = [0.0; 3];
        let mut bound = [0.0; 3];
        for i in 0..3 {
            let x = finite_ball(c[i] / m * Iv::point(scale) + Iv::point(r[i]))
                .map_err(|_| Refused("observe/centroid-range".into()))?;
            mid[i] = x.m;
            bound[i] = x.r;
        }
        Ok((mid, bound))
    }

    pub fn centroid_mm(&self) -> R<[f64; 3]> {
        self.centroid_with_bound_mm().map(|(mid, _)| mid)
    }

    pub fn topology(&self) -> Topology {
        let (v, e, f) = (self.body.vertices.len() as i64, self.body.edges.len() as i64, self.body.faces.len() as i64);
        let loops = self.face_loops.len() as i64;
        let euler = v - e + 2 * f - loops;
        Topology {
            bodies: 1,
            shells: self.body.shells.len(),
            faces: f as usize,
            edges: e as usize,
            vertices: v as usize,
            loops: loops as usize,
            ring_edges: 0,
            closed_toroidal_faces: 0,
            genus: (2 * self.body.shells.len() as i64 - euler) / 2,
            // Only plane carriers were admitted: no apex or pinch points exist.
            singular_points: 0,
            pinch_points: 0,
        }
    }

    /// Distance (mm) from a world point (mm) to the solid, 0 inside. The point
    /// is mapped to the source frame in f64 with a stated bound; the inside
    /// decision is exact on that mapped point, and a point closer to the
    /// boundary than the mapping bound is refused by name.
    pub fn distance_mm(&self, point_mm: [f64; 3]) -> Probe {
        if self.chamfer.is_some() { return Probe::Refused("chamfer/probe-unimplemented".into()); }
        if let Some(s)=&self.arcs { return s.probe(self,point_mm); }
        if crate::planar_boolean::candidate(&self.body) { return Probe::Refused("planar-boolean/point-distance-unsupported".into()); }
        if let Some(s)=&self.corner { return s.probe(self,point_mm); }
        if let Some(s)=&self.rounded { return s.probe(self,point_mm); }
        let defect = match self.frame.orthonormality_defect() {
            Ok(d) if d <= 1e-9 => d,
            _ => return Probe::Refused("observe/frame-not-near-orthonormal".into()),
        };
        let q = [point_mm[0] / MM, point_mm[1] / MM, point_mm[2] / MM];
        let Ok((s, bound)) = self.frame.inverse_approx(q) else { return Probe::Refused("observe/probe-mapping".into()) };
        if let Some(cells) = &self.orthogonal {
            let Ok((source, inside)) = cells.probe(s) else { return Probe::Refused("observe/probe-range".into()); };
            // Membership near an exterior boundary is not certified by an
            // approximate inverse. Interior cell interfaces are not boundaries.
            if inside {
                if !cells.boxes.iter().any(|b| (0..3).all(|k| s[k]-b[0][k] > 2.*bound && b[1][k]-s[k] > 2.*bound)) {
                    return Probe::Refused("observe/interior-probe-within-mapping-budget".into());
                }
                return probe_result(Iv::point(0.0), true, bound, defect);
            }
            if source.lo() <= 2. * bound { return Probe::Refused("observe/probe-within-mapping-budget".into()); }
            return probe_result(source, inside, bound, defect);
        }
        let (u, w) = ((self.axis + 1) % 3, (self.axis + 2) % 3);
        let (lo, hi) = (self.levels[0], self.levels[1]);
        let at = p2(s[u], s[w]);
        let location = match region::locate(&self.cap, at) {
            Ok(l) => l,
            Err(_) => return Probe::Refused("observe/probe-location".into()),
        };
        let mut edge: Option<Iv> = None;
        for k in 0..self.cap.len() {
            let (a, b) = (self.cap[k], self.cap[(k + 1) % self.cap.len()]);
            let (dx, dy) = (Iv::point(b.x) - Iv::point(a.x), Iv::point(b.y) - Iv::point(a.y));
            let (px, py) = (Iv::point(at.x) - Iv::point(a.x), Iv::point(at.y) - Iv::point(a.y));
            let t = ((px * dx + py * dy) / (dx * dx + dy * dy)).max(Iv::point(0.0)).min(Iv::point(1.0));
            let Ok(n) = norm_ball([px - t * dx, py - t * dy, Iv::point(0.0)]) else {
                return Probe::Refused("observe/probe-range".into());
            };
            edge = Some(match edge { Some(e) => e.min(n), None => n });
        }
        let Some(edge) = edge else { return Probe::Refused("observe/probe-range".into()); };
        let h = s[self.axis];
        let axial = (Iv::point(lo) - Iv::point(h)).max(Iv::point(h) - Iv::point(hi)).max(Iv::point(0.0));
        let inside2 = location == Location::Inside;
        let inside = inside2 && h >= lo && h <= hi;
        let source = if inside {
            edge.min(Iv::point(h) - Iv::point(lo)).min(Iv::point(hi) - Iv::point(h))
        } else {
            let Ok(n) = norm_ball([if inside2 { Iv::point(0.0) } else { edge }, axial, Iv::point(0.0)]) else {
                return Probe::Refused("observe/probe-range".into());
            };
            n
        };
        if source.is_nan() || source.lo() <= 2.0 * bound {
            return Probe::Refused("observe/probe-within-mapping-budget".into());
        }
        probe_result(source, inside, bound, defect)
    }
}

fn probe_result(source: Iv, inside: bool, mapping_bound: f64, defect: f64) -> Probe {
    let distance = if inside { Iv::point(0.0) } else { source * Iv::point(MM) };
    let budget = Iv::point(mapping_bound) * Iv::point(2.0 * MM)
        + distance.abs() * Iv::point(3.0 * defect + 16.0 * f64::EPSILON)
        + Iv::point(distance.r);
    match (finite_ball(distance), finite_ball(budget)) {
        (Ok(d), Ok(b)) if inside || d.lo() > 0.0 => Probe::Measured {
            distance_mm: d.m, inside, bound_mm: b.hi(),
        },
        _ => Probe::Refused("observe/probe-range".into()),
    }
}
