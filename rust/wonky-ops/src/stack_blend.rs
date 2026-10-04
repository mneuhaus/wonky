//! Whole tangent cap loops of an exact stacked-prism arrangement. Convex rims
//! remove material; concave rims complement the same void band. The operation
//! trims existing side faces and sews the same analytic band used by an
//! extrusion. It is driven by incidence, not by source operand or shape names.
//! Rule 9 records the selected source edges; replay authenticates all caches.
use crate::{
    arc_profile::{q, ArcPrism, Profile, R},
    fillet_rim::{exact, Rim},
    polyhedron::{Audited, Refused},
    prism_stack::PrismStack,
    prism_stack_brep::{EdgeGeom, FaceKind},
};
use std::collections::{BTreeMap, BTreeSet};
use wonky_contract::*;
use wonky_num::Iv;
const RULE: u32 = 9;
fn no(s: &str) -> Refused {
    Refused(format!("stack-blend/{s}"))
}
fn b(x: f64) -> R<Binary64> {
    crate::arc_profile::b(x)
}
#[derive(Clone, Debug)]
pub(crate) struct Band {
    pub concave: bool,
    pub cap: usize,
    pub sides: Vec<usize>,
    pub edges: Vec<usize>,
    pub vertices: Vec<usize>,
    pub new_edges: usize,
    pub spec: ArcPrism,
    pub rim: Rim,
    pub carrier: Audited,
}
impl Band {
    pub fn removed(&self) -> R<Iv> {
        Ok(self.spec.profile.area()?
            * crate::arc_profile::enclose(&(q(self.spec.levels[1]) - q(self.spec.levels[0])))?
            * Iv::point(1e9)
            - self.rim.volume(&self.spec, &self.carrier)?)
        .map(|v| {
            if self.rim.outward != self.concave {
                -v
            } else {
                v
            }
        })
    }
    pub fn areas(&self) -> R<Vec<Iv>> {
        self.rim.areas(&self.spec, &self.carrier)
    }
    pub fn moments_removed(&self) -> R<[Iv; 3]> {
        let mut plain = self.spec.clone();
        plain.rim = None;
        let vp = plain.volume(&self.carrier)?;
        let vb = self.rim.volume(&self.spec, &self.carrier)?;
        let (cp, ep) = plain.centroid(&self.carrier)?;
        let (cb, eb) = self.rim.centroid(&self.spec, &self.carrier)?;
        Ok(std::array::from_fn(|k| {
            (vp * Iv { m: cp[k], r: ep[k] } - vb * Iv { m: cb[k], r: eb[k] }) / Iv::point(1000.)
                * Iv::point(if self.rim.outward != self.concave {
                    -1.
                } else {
                    1.
                })
        }))
    }
}
pub(crate) fn candidate(body: &Body) -> bool {
    body.constructions.last().is_some_and(|n| {
        n.rule_version == RULE
            && matches!(
                n.operation,
                Operation::Fillet {} | Operation::Intersection {}
            )
    })
}
pub(crate) fn apply(s: &PrismStack, edges: &[usize], r: f64, chamfer: bool) -> R<Body> {
    if crate::stack_generator::admits(s, edges) {
        return Ok(crate::stack_generator::construct(s.clone(), edges, r, chamfer)?.body);
    }
    Ok(construct(s.clone(), edges, r, chamfer)?.body)
}
fn construct(s: PrismStack, edges: &[usize], r: f64, chamfer: bool) -> R<PrismStack> {
    if !s.blend.is_empty() {
        return Err(no("repeat-unsupported"));
    }
    let mut remaining: BTreeSet<_> = edges.iter().copied().collect();
    let mut groups = vec![];
    for (fi, f) in s.body.faces.iter().enumerate() {
        if !matches!(s.brep.faces[fi].kind, FaceKind::Cap { .. }) {
            continue;
        }
        for &lp in &f.loops {
            let set: BTreeSet<_> = s.body.loops[lp.0 as usize]
                .coedges
                .iter()
                .map(|u| s.body.coedges[u.0 as usize].edge.0 as usize)
                .collect();
            if !set.is_empty() && set.is_subset(&remaining) {
                for e in &set {
                    remaining.remove(e);
                }
                groups.push(set.into_iter().collect::<Vec<_>>());
            }
        }
    }
    if !remaining.is_empty() || groups.is_empty() {
        return Err(no("whole-cap-loop-required"));
    }
    let mut built = groups
        .iter()
        .map(|g| construct_one(s.clone(), g, r, chamfer))
        .collect::<R<Vec<_>>>()?;
    // Independently admitted offsets can still meet each other. This exact
    // pairwise test prevents two opposite setbacks consuming the shared cap.
    for i in 0..built.len() {
        for j in i + 1..built.len() {
            let a = &built[i].blend[0];
            let b = &built[j].blend[0];
            if a.cap == b.cap {
                for x in a.rim.inner.segments() {
                    for y in b.rim.inner.segments() {
                        x.admit(y).map_err(|_| no("bands-collide"))?;
                    }
                }
                if a.rim.outward
                    && b.rim.outward
                    && (a
                        .rim
                        .inner
                        .cycle()
                        .contains(&b.rim.inner.segments()[0].ends()[0])?
                        || b.rim
                            .inner
                            .cycle()
                            .contains(&a.rim.inner.segments()[0].ends()[0])?)
                {
                    return Err(no("bands-collide"));
                }
                let (outer, inner) = if a.rim.outward { (b, a) } else { (a, b) };
                if !outer.rim.outward
                    && inner.rim.outward
                    && !outer
                        .rim
                        .inner
                        .cycle()
                        .contains(&inner.rim.inner.segments()[0].ends()[0])?
                {
                    return Err(no("bands-consume-cap"));
                }
            }
            if a.sides.iter().any(|f| b.sides.contains(f)) {
                return Err(no("bands-share-side-face-unimplemented"));
            }
        }
    }
    let mut result = built.remove(0);
    for (other, g) in built.into_iter().zip(groups.iter().skip(1)) {
        let mut band = other.blend.into_iter().next().ok_or_else(|| no("band"))?;
        let face = &result.body.faces[band.cap];
        let lp = *face
            .loops
            .iter()
            .find(|&&lp| {
                let set: BTreeSet<_> = result.body.loops[lp.0 as usize]
                    .coedges
                    .iter()
                    .map(|u| result.body.coedges[u.0 as usize].edge.0 as usize)
                    .collect();
                set == g.iter().copied().collect()
            })
            .ok_or_else(|| no("merge-loop"))?;
        let source_lp = *s.body.faces[band.cap]
            .loops
            .iter()
            .find(|&&lp| {
                let set: BTreeSet<_> = s.body.loops[lp.0 as usize]
                    .coedges
                    .iter()
                    .map(|u| s.body.coedges[u.0 as usize].edge.0 as usize)
                    .collect();
                set == g.iter().copied().collect()
            })
            .ok_or_else(|| no("source-loop"))?;
        let mut uses = s.body.loops[source_lp.0 as usize]
            .coedges
            .iter()
            .map(|u| s.body.coedges[u.0 as usize].clone())
            .collect::<Vec<_>>();
        if (band.rim.bottom != band.rim.outward) != band.concave {
            uses.reverse();
            for c in &mut uses {
                c.forward = !c.forward;
            }
        }
        band.new_edges = result.body.edges.len();
        splice(
            &mut result.body,
            &band.carrier.body,
            &uses,
            band.cap,
            lp,
            &band.rim,
        )?;
        result.blend.push(band);
    }
    result
        .body
        .constructions
        .last_mut()
        .ok_or_else(|| no("source"))?
        .parameters = std::iter::once(b(r))
        .chain(edges.iter().map(|&e| b(e as f64)))
        .collect::<R<_>>()?;
    result
        .body
        .clone()
        .check()
        .map_err(|e| no(&format!("contract:{e:?}")))?;
    Ok(result)
}
fn construct_one(mut s: PrismStack, edges: &[usize], r: f64, chamfer: bool) -> R<PrismStack> {
    crate::source_frame::SourceMetric::new(&s.frame)?;
    if !r.is_finite() || r <= 0. {
        return Err(no("radius"));
    }
    let selected: BTreeSet<_> = edges.iter().copied().collect();
    let mut found = None;
    for (fi, f) in s.body.faces.iter().enumerate() {
        if let FaceKind::Cap { level, up } = s.brep.faces[fi].kind {
            for &lp in &f.loops {
                let l = &s.body.loops[lp.0 as usize];
                let set: BTreeSet<_> = l
                    .coedges
                    .iter()
                    .map(|c| s.body.coedges[c.0 as usize].edge.0 as usize)
                    .collect();
                if set == selected && !set.is_empty() {
                    if found.is_some() {
                        return Err(no("ambiguous-cap-loop"));
                    }
                    found = Some((fi, lp, level, up, !l.outer));
                }
            }
        }
    }
    let (cap, lp, level, up, hole) = found.ok_or_else(|| no("whole-cap-loop-required"))?;
    let mut uses = s.body.loops[lp.0 as usize]
        .coedges
        .iter()
        .map(|c| s.body.coedges[c.0 as usize].clone())
        .collect::<Vec<_>>();
    if !up != hole {
        uses.reverse();
        for c in &mut uses {
            c.forward = !c.forward;
        }
    }
    let mut pieces = vec![];
    let mut sides = vec![];
    let mut concavity = None;
    for c in &uses {
        let EdgeGeom::Horizontal {
            level: el,
            pieces: ps,
        } = &s.brep.edges[c.edge.0 as usize]
        else {
            return Err(no("horizontal-loop-required"));
        };
        if *el != level || ps.len() != 1 {
            return Err(no("split-carrier-loop-unimplemented"));
        }
        let seg = &s.stack.arr.pieces[ps[0]].seg;
        pieces.push(if c.forward {
            seg.clone()
        } else {
            seg.reversed()
        });
        let incident = s
            .body
            .faces
            .iter()
            .enumerate()
            .filter(|(f, face)| {
                *f != cap
                    && face.loops.iter().any(|l| {
                        s.body.loops[l.0 as usize]
                            .coedges
                            .iter()
                            .any(|u| s.body.coedges[u.0 as usize].edge == c.edge)
                    })
            })
            .map(|(f, _)| f)
            .collect::<Vec<_>>();
        if incident.len() != 1 {
            return Err(no("edge-incidence"));
        }
        let side = incident[0];
        let FaceKind::Side { left, .. } = s.brep.faces[side].kind else {
            return Err(no("side-face-required"));
        };
        // Complement the void's convex rim for a reentrant joint. Incidence,
        // rather than outer/inner loop labels, decides the material quadrant.
        let concave = (left == c.forward) == hole;
        if concavity.is_some_and(|v| v != concave) {
            return Err(no("mixed-dihedral-loop"));
        }
        concavity = Some(concave);
        // Every vertical edge of the adjacent side must extend past the band.
        // Other horizontal boundaries in that band would consume the face.
        for l in &s.body.faces[side].loops {
            for u in &s.body.loops[l.0 as usize].coedges {
                let e = s.body.coedges[u.0 as usize].edge.0 as usize;
                if e == c.edge.0 as usize {
                    continue;
                }
                match &s.brep.edges[e] {
                    EdgeGeom::Horizontal { level: l, .. } => {
                        let h = if up != concave {
                            &s.stack.levels[level] - &s.stack.levels[*l]
                        } else {
                            &s.stack.levels[*l] - &s.stack.levels[level]
                        };
                        if h <= q(r) {
                            return Err(no("adjacent-face-consumed"));
                        }
                    }
                    EdgeGeom::Vertical { span, .. } => {
                        if span.contains(&level)
                            && &s.stack.levels[span[1]] - &s.stack.levels[span[0]] <= q(r)
                        {
                            return Err(no("adjacent-face-consumed"));
                        }
                    }
                    _ => return Err(no("tool-band-intersection-unimplemented")),
                }
            }
        }
        sides.push(side);
    }
    if sides.iter().copied().collect::<BTreeSet<_>>().len() != sides.len() {
        return Err(no("shared-side-face-unimplemented"));
    }
    let profile = Profile::from_pieces(pieces);
    profile.simple()?;
    let concave = concavity.ok_or_else(|| no("empty-loop"))?;
    let bottom = !up != concave;
    let outward = hole;
    let z = exact(s.stack.levels[level].clone())?;
    // A local two-radius prism supplies only the rim patches. Its remote cap
    // and sides are discarded; they are never model geometry of this result.
    let levels = if !bottom {
        [exact(q(z) - q(2.) * q(r))?, z]
    } else {
        [z, exact(q(z) + q(2.) * q(r))?]
    };
    let spec = ArcPrism {
        profile,
        levels,
        rim: None,
        regularization: None,
    };
    let rim = Rim::offset_band(&spec, r, chamfer, bottom, outward)?;
    // Reject any intervening cap, and prove all other boundary cycles stay
    // clear of the complete swept band. Convex inward offsets are nested.
    for (fi, f) in s.brep.faces.iter().enumerate() {
        if let FaceKind::Cap { level: l, .. } = f.kind {
            let delta = if !bottom {
                &s.stack.levels[level] - &s.stack.levels[l]
            } else {
                &s.stack.levels[l] - &s.stack.levels[level]
            };
            if delta > q(0.) && delta <= q(r) {
                return Err(no("intervening-cap"));
            }
        }
        if fi == cap {
            for &other in &s.body.faces[fi].loops {
                if other == lp {
                    continue;
                }
                for &u in &s.body.loops[other.0 as usize].coedges {
                    let e = s.body.coedges[u.0 as usize].edge.0 as usize;
                    let EdgeGeom::Horizontal { pieces, .. } = &s.brep.edges[e] else {
                        return Err(no("tool-clearance-unimplemented"));
                    };
                    for &p in pieces {
                        let seg = &s.stack.arr.pieces[p].seg;
                        for inset in rim.inner.segments() {
                            inset
                                .admit(seg)
                                .map_err(|_| no("offset-boundary-collision"))?;
                        }
                        if !outward && !rim.inner.cycle().contains(&seg.ends()[0])? {
                            return Err(no("adjacent-cap-consumed"));
                        }
                        if outward
                            && s.body.loops[other.0 as usize].outer
                            && !Profile::from_pieces(loop_pieces(&s, other)?)
                                .cycle()
                                .contains(&rim.inner.segments()[0].ends()[0])?
                        {
                            return Err(no("adjacent-cap-consumed"));
                        }
                    }
                }
            }
        }
    }
    let root = s.body.constructions.len();
    s.body.constructions.push(Construction {
        operation: if chamfer {
            Operation::Intersection {}
        } else {
            Operation::Fillet {}
        },
        rule_version: RULE,
        parents: vec![NodeId(root as u32 - 1)],
        parameters: std::iter::once(b(r))
            .chain(edges.iter().map(|&e| b(e as f64)))
            .collect::<R<_>>()?,
        frame: FrameId(1),
    });
    let mut temp = crate::fillet_rim_brep::construct(s.body.clone(), &spec, &rim)?;
    if concave {
        // Reverse the sewn void boundary, retaining its analytic carriers.
        for face in &mut temp.faces {
            face.forward = !face.forward;
        }
        for lp in &mut temp.loops {
            lp.coedges.reverse();
        }
        for c in &mut temp.coedges {
            c.forward = !c.forward;
        }
    }
    let carrier = Audited {
        body: temp.clone(),
        frame: crate::placement::Placement::from_frames(&identity(&temp)?, FrameId(1))
            .map_err(|_| no("identity-frame"))?,
        axis: 2,
        levels,
        cap: vec![],
        face_loops: vec![],
        bound_to_construction: true,
        orthogonal: None,
        arcs: Some(spec.clone()),
        rounded: None,
        corner: None,
        chamfer: None,
        arrangement: None,
    };
    let source_edges = uses.iter().map(|c| c.edge.0 as usize).collect();
    let source_vertices = uses
        .iter()
        .map(|c| s.body.edges[c.edge.0 as usize].vertices[if c.forward { 0 } else { 1 }].0 as usize)
        .collect();
    let new_edges = s.body.edges.len();
    splice(&mut s.body, &temp, &uses, cap, lp, &rim)?;
    s.blend = vec![Band {
        concave,
        cap,
        sides,
        edges: source_edges,
        vertices: source_vertices,
        new_edges,
        spec,
        rim,
        carrier,
    }];
    s.body
        .clone()
        .check()
        .map_err(|e| no(&format!("contract:{e:?}")))?;
    Ok(s)
}
fn loop_pieces(s: &PrismStack, lp: LoopId) -> R<Vec<wonky_curve::Trimmed>> {
    let mut out = vec![];
    for &u in &s.body.loops[lp.0 as usize].coedges {
        let c = &s.body.coedges[u.0 as usize];
        let EdgeGeom::Horizontal { pieces, .. } = &s.brep.edges[c.edge.0 as usize] else {
            return Err(no("cap-loop-carrier"));
        };
        if c.forward {
            out.extend(pieces.iter().map(|&p| s.stack.arr.pieces[p].seg.clone()));
        } else {
            out.extend(
                pieces
                    .iter()
                    .rev()
                    .map(|&p| s.stack.arr.pieces[p].seg.reversed()),
            );
        }
    }
    Ok(out)
}
fn identity(body: &Body) -> R<Body> {
    let mut chart = body.clone();
    // Metric integrals below are in the stack's source chart.
    chart.frames[1] = Frame::Interpreter {
        parent: FrameId(0),
        origin: [b(0.)?; 3],
        x: [b(1.)?, b(0.)?, b(0.)?],
        z: [b(0.)?, b(0.)?, b(1.)?],
    };
    Ok(chart)
}
fn splice(
    body: &mut Body,
    temp: &Body,
    uses: &[Coedge],
    cap: usize,
    cap_loop: LoopId,
    rim: &Rim,
) -> R<()> {
    let n = uses.len();
    let prov = Provenance::Construction {
        node: NodeId(body.constructions.len() as u32 - 1),
    };
    let mut vm = BTreeMap::new();
    let mut em = BTreeMap::new();
    let mut flip = BTreeSet::new();
    let mut moved = BTreeSet::new();
    for (k, c) in uses.iter().enumerate() {
        let old = &body.edges[c.edge.0 as usize];
        let start = old.vertices[if c.forward { 0 } else { 1 }];
        vm.insert(n + k, start);
        moved.insert(start.0 as usize);
        if !c.forward {
            flip.insert(c.edge.0 as usize);
        }
        em.insert(n + k, c.edge);
    }
    for k in 0..n {
        let mut vertex = temp.vertices[2 * n + k].clone();
        vertex.provenance = prov.clone();
        vm.insert(2 * n + k, VertexId(body.vertices.len() as u32));
        body.vertices.push(vertex);
        body.vertices[vm[&(n + k)].0 as usize].point = temp.vertices[n + k].point;
        body.vertices[vm[&(n + k)].0 as usize].provenance = prov.clone();
    }
    // Re-chart the original straight generators after moving their ends.
    for e in &body.edges {
        if !e.vertices.iter().any(|v| moved.contains(&(v.0 as usize))) {
            continue;
        }
        if let CurveGeometry::Line { a, b: vb } = &mut body.curves[e.curve.0 as usize].geometry {
            *a = body.vertices[e.vertices[0].0 as usize].point;
            *vb = body.vertices[e.vertices[1].0 as usize].point;
            body.curves[e.curve.0 as usize].provenance = prov.clone();
        }
    }
    for k in n..3 * n {
        // ring1, ring2
        let mut edge = temp.edges[k].clone();
        let mut curve = temp.curves[edge.curve.0 as usize].clone();
        curve.provenance = prov.clone();
        curve.supports.clear();
        edge.vertices = edge.vertices.iter().map(|v| vm[&(v.0 as usize)]).collect();
        if k < 2 * n {
            let id = em[&k];
            edge.curve = body.edges[id.0 as usize].curve;
            body.curves[edge.curve.0 as usize] = curve;
            body.edges[id.0 as usize] = edge;
        } else {
            edge.curve = CurveId(body.curves.len() as u32);
            body.curves.push(curve);
            em.insert(k, EdgeId(body.edges.len() as u32));
            body.edges.push(edge);
        }
    }
    for k in 4 * n..5 * n {
        let mut edge = temp.edges[k].clone();
        let mut curve = temp.curves[edge.curve.0 as usize].clone();
        curve.provenance = prov.clone();
        curve.supports.clear();
        edge.vertices = edge.vertices.iter().map(|v| vm[&(v.0 as usize)]).collect();
        edge.curve = CurveId(body.curves.len() as u32);
        body.curves.push(curve);
        em.insert(k, EdgeId(body.edges.len() as u32));
        body.edges.push(edge);
    }
    let old = body.clone();
    body.coedges.clear();
    body.pcurves.clear();
    body.loops.clear();
    body.faces.clear();
    for curve in &mut body.curves {
        curve.supports.clear();
    }
    let temp_cap = &temp.faces[1];
    for (fi, f) in old.faces.iter().enumerate() {
        let mut face = f.clone();
        face.loops.clear();
        for &lp in &f.loops {
            let (from, which) = if fi == cap && lp == cap_loop {
                (temp, temp_cap.loops[0])
            } else {
                (&old, lp)
            };
            let mut l = from.loops[which.0 as usize].clone();
            if fi == cap && lp == cap_loop {
                l.outer = old.loops[lp.0 as usize].outer;
            }
            l.coedges.clear();
            for &u in &from.loops[which.0 as usize].coedges {
                let mut c = from.coedges[u.0 as usize].clone();
                let mut pc = from.pcurves[c.pcurve.0 as usize].clone();
                if fi == cap && lp == cap_loop {
                    c.edge = em[&(c.edge.0 as usize)];
                    // Complementary rims use the void's plane chart. The
                    // retained cap can have the opposite normal; pull back its
                    // pcurve into the actual cap chart before sewing it.
                    let SurfaceGeometry::Plane { normal: from, .. } =
                        &temp.surfaces[pc.surface.0 as usize].geometry
                    else {
                        return Err(no("cap-chart"));
                    };
                    let SurfaceGeometry::Plane { normal: to, .. } =
                        &body.surfaces[f.surface.0 as usize].geometry
                    else {
                        return Err(no("cap-chart"));
                    };
                    let dot = (0..3)
                        .map(|k| q(from[k].get()) * q(to[k].get()))
                        .sum::<wonky_curve::Q>();
                    if dot == q(-1.) {
                        match &mut pc.geometry {
                            PcurveGeometry::Line { a, b: bv } => {
                                a[1] = b(-a[1].get())?;
                                bv[1] = b(-bv[1].get())?;
                            }
                            PcurveGeometry::CircularArc {
                                center,
                                x,
                                clockwise,
                                ..
                            } => {
                                center[1] = b(-center[1].get())?;
                                x[1] = b(-x[1].get())?;
                                *clockwise = !*clockwise;
                            }
                            _ => return Err(no("cap-pcurve")),
                        }
                    } else if dot != q(1.) {
                        return Err(no("cap-chart-relation"));
                    }
                    pc.surface = f.surface;
                } else {
                    let oe = &old.edges[c.edge.0 as usize];
                    let surface = &old.surfaces[f.surface.0 as usize].geometry;
                    if let PcurveGeometry::Line { a, b: vb } = &mut pc.geometry {
                        if oe.vertices.iter().any(|v| moved.contains(&(v.0 as usize))) {
                            // Side charts use axial height (cylinder), or height
                            // divided by n cross x's z component (plane).
                            let scale = match surface {
                                SurfaceGeometry::Cylinder { .. } => q(1.),
                                SurfaceGeometry::Plane { normal, x, .. } => {
                                    q(normal[0].get()) * q(x[1].get())
                                        - q(normal[1].get()) * q(x[0].get())
                                }
                                _ => return Err(no("side-chart")),
                            };
                            for (uv, v) in [a, vb].into_iter().zip(&oe.vertices) {
                                if moved.contains(&(v.0 as usize)) {
                                    if scale == q(0.) {
                                        return Err(no("side-chart-height"));
                                    }
                                    // Every selected cap vertex moves axially by
                                    // exactly the common offset; side charts keep
                                    // their original source axes and origin.
                                    let dz = if rim.bottom {
                                        q(rim.radius)
                                    } else {
                                        -q(rim.radius)
                                    };
                                    uv[1] = b(exact(q(uv[1].get()) + dz / &scale)?)?;
                                }
                            }
                        }
                    }
                    if flip.contains(&(c.edge.0 as usize)) {
                        c.forward = !c.forward;
                        match &mut pc.geometry {
                            PcurveGeometry::Line { a, b } => std::mem::swap(a, b),
                            _ => return Err(no("side-pcurve")),
                        };
                    }
                }
                pc.curve = body.edges[c.edge.0 as usize].curve;
                append_use(body, &mut l, c, pc);
            }
            face.loops.push(LoopId(body.loops.len() as u32));
            body.loops.push(l);
        }
        body.faces.push(face);
    }
    for f in temp.faces.iter().skip(2 + n) {
        let mut surface = temp.surfaces[f.surface.0 as usize].clone();
        surface.provenance = prov.clone();
        let sid = SurfaceId(body.surfaces.len() as u32);
        body.surfaces.push(surface);
        let mut face = f.clone();
        face.surface = sid;
        face.loops.clear();
        for &lp in &f.loops {
            let mut l = temp.loops[lp.0 as usize].clone();
            l.coedges.clear();
            for &u in &temp.loops[lp.0 as usize].coedges {
                let mut c = temp.coedges[u.0 as usize].clone();
                let mut pc = temp.pcurves[c.pcurve.0 as usize].clone();
                c.edge = em[&(c.edge.0 as usize)];
                pc.curve = body.edges[c.edge.0 as usize].curve;
                pc.surface = sid;
                append_use(body, &mut l, c, pc);
            }
            face.loops.push(LoopId(body.loops.len() as u32));
            body.loops.push(l);
        }
        body.faces.push(face);
    }
    body.shells = vec![Shell {
        faces: (0..body.faces.len()).map(|k| FaceId(k as u32)).collect(),
    }];
    Ok(())
}
fn append_use(body: &mut Body, l: &mut Loop, mut c: Coedge, pc: Pcurve) {
    c.pcurve = PcurveId(body.pcurves.len() as u32);
    body.curves[pc.curve.0 as usize].supports.push(Support {
        surface: pc.surface,
        pcurve: c.pcurve,
    });
    body.pcurves.push(pc);
    l.coedges.push(CoedgeId(body.coedges.len() as u32));
    body.coedges.push(c);
}
pub(crate) fn audit(checked: &CheckedBody) -> R<PrismStack> {
    let body = checked.body();
    let root = body.constructions.last().ok_or_else(|| no("source"))?;
    if !candidate(body) || root.parents != vec![NodeId(body.constructions.len() as u32 - 2)] {
        return Err(no("source-layout"));
    }
    let mut source = body.clone();
    source.constructions.pop();
    // Replay the parent arrangement; serialized blended boundary is never an input.
    let parent = crate::prism_stack::replay_source(
        source.key.clone(),
        &source.frames,
        &source.constructions,
    )?;
    let edges = root.parameters[1..]
        .iter()
        .map(|x| x.get() as usize)
        .collect::<Vec<_>>();
    let rebuilt = construct(
        parent,
        &edges,
        root.parameters[0].get(),
        root.operation == Operation::Intersection {},
    )?;
    if rebuilt.body != *body {
        return Err(no("construction-mismatch"));
    }
    Ok(rebuilt)
}
