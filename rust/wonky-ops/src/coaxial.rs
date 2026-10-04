//! Exact radial/axial arrangement of cylinders in one source frame. Breakpoints
//! are input binary64 coordinates, never rounded intersections. Every boundary
//! ring belongs to an analytic cylinder and (when exposed) a planar annulus.
use crate::{
    affine::Affine,
    cylinder::{self, finite, Cylinder, Spec},
    polyhedron::Refused,
};
use std::collections::BTreeMap;
use wonky_contract::*;
use wonky_num::{
    expansion::{self as ex, Guard},
    Iv,
};
type R<T> = std::result::Result<T, Refused>;
pub(crate) fn no(s: &str) -> Refused {
    Refused(format!("coaxial/{s}"))
}
fn b(x: f64) -> R<Binary64> {
    Binary64::new(x).map_err(|_| no("numeric-range"))
}
fn v(x: [f64; 3]) -> R<Vector3> {
    Ok([b(x[0])?, b(x[1])?, b(x[2])?])
}
fn uv(x: [f64; 2]) -> R<Vector2> {
    Ok([b(x[0])?, b(x[1])?])
}
fn dom() -> Domain {
    Domain {
        lower: Limit::Finite {
            value: Binary64::new(0.).unwrap(),
            closed: true,
        },
        upper: Limit::Finite {
            value: Binary64::new(1.).unwrap(),
            closed: true,
        },
    }
}
fn val(x: &Vector3) -> [f64; 3] {
    x.map(Binary64::get)
}
fn node(op: u8, parents: Vec<NodeId>) -> R<Construction> {
    Ok(Construction {
        operation: Operation::Boolean {},
        rule_version: 1,
        parents,
        parameters: vec![b(op as f64)?],
        frame: FrameId(2),
    })
}
/// One annular slab of the stack: inner <= rho <= outer, z0 <= axial <= z1,
/// in source metres (inner == 0 is a full disk). The solid is the closed union.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Slice {
    pub(crate) z0: f64,
    pub(crate) z1: f64,
    pub(crate) inner: f64,
    pub(crate) outer: f64,
}
#[derive(Clone, Debug)]
pub struct Coaxial {
    pub body: Body,
    pub frame: Affine,
    pub(crate) axis: usize,
    pub(crate) center: [f64; 3],
    pub(crate) slices: Vec<Slice>,
}
impl Coaxial {
    pub fn transform(&self, f: Affine) -> R<Body> {
        if self.frame != Affine::IDENTITY {
            return Err(no("placement-already-applied"));
        }
        let mut body = self.body.clone();
        body.frames[1] = Frame::Interpreter {
            parent: FrameId(0),
            origin: v(f.origin)?,
            x: v(f.x)?,
            z: v(f.z)?,
        };
        body.key.revision = body
            .key
            .revision
            .checked_add(1)
            .ok_or_else(|| no("revision-range"))?;
        // Replacing the placement frame is the whole placement when the body
        // still audits. The tools may carry their own frame nodes, which that
        // leaves in the source frame; the moved body then does not audit, and
        // the placement moves the source cylinders and arranges them again.
        if body.clone().check().map_err(|_| no("construction-carrier-mismatch")).and_then(|c| audit(&c)).is_ok() {
            return Ok(body);
        }
        Ok(self.placed_from_sources(f)?.unwrap_or(body))
    }
    pub fn bbox_mm(&self) -> R<([f64; 3], [f64; 3])> {
        self.bbox_in(None)
    }
    pub fn measure_json(&self, map: Option<[[f64; 4]; 3]>, probes: &[[f64; 3]]) -> R<String> {
        let mapped = match map {
            Some(m) => {
                let (l, h) = self.bbox_in(Some(m))?;
                format!("{{\"min\":{l:?},\"max\":{h:?}}}")
            }
            None => "null".into(),
        };
        let probes = probes
            .iter()
            .map(|&p| match self.probe(p) {
                Ok((d, i, b)) => {
                    format!("{{\"distanceMm\":{d:?},\"inside\":{i},\"boundMm\":{b:?}}}")
                }
                Err(e) => format!("{{\"refused\":\"{}\"}}", e.0),
            })
            .collect::<Vec<_>>()
            .join(",");
        let pi = wonky_validated::pi(1e-14)
            .map_err(|_| no("validated-pi"))?
            .ball();
        let mm = Iv::point(1000.);
        let det = self
            .frame
            .det_exact()
            .map_err(|_| no("frame-range"))?
            .iter()
            .fold(Iv::point(0.), |a, x| a + Iv::point(*x));
        let defect = self
            .frame
            .orthonormality_defect()
            .map_err(|_| no("frame-range"))?;
        let scale = Iv {
            m: 1.,
            r: (3. * defect).next_up(),
        };
        let mut volume = Iv::point(0.);
        let mut area = Iv::point(0.);
        let mut moment = Iv::point(0.);
        let mut fa = Vec::new();
        let mut fp = Vec::new();
        for s in &self.slices {
            let h = (Iv::point(s.z1) - Iv::point(s.z0)) * mm;
            let inner = Iv::point(s.inner) * mm;
            let outer = Iv::point(s.outer) * mm;
            let slab = pi * (outer * outer - inner * inner) * h;
            volume = volume + slab;
            moment = moment + slab * (Iv::point(s.z0) + Iv::point(s.z1)) * mm / Iv::point(2.);
        }
        for face in &self.body.faces {
            let rings = face
                .loops
                .iter()
                .map(|l| {
                    let co =
                        &self.body.coedges[self.body.loops[l.0 as usize].coedges[0].0 as usize];
                    let CurveGeometry::Circle { radius, origin, .. } = self.body.curves
                        [self.body.edges[co.edge.0 as usize].curve.0 as usize]
                        .geometry
                    else {
                        return Err(no("face-ring"));
                    };
                    Ok((radius.get(), origin[self.axis].get()))
                })
                .collect::<R<Vec<_>>>()?;
            let (r, z) = rings[0];
            let circumference = Iv::point(2.) * pi * Iv::point(r) * mm;
            let face_area = if matches!(
                self.body.surfaces[face.surface.0 as usize].geometry,
                SurfaceGeometry::Cylinder { .. }
            ) {
                circumference * (Iv::point(rings[1].1) - Iv::point(z)) * mm * scale
            } else {
                let inner = rings.get(1).map(|p| p.0).unwrap_or(0.);
                pi * (Iv::point(r) * Iv::point(r) - Iv::point(inner) * Iv::point(inner))
                    * mm
                    * mm
                    * scale
            };
            let face_area = finite(face_area)?;
            area = area + face_area;
            fa.push(face_area.m);
            let perimeter = if rings.len() > 1
                && matches!(
                    self.body.surfaces[face.surface.0 as usize].geometry,
                    SurfaceGeometry::Cylinder { .. }
                ) {
                circumference * Iv::point(2.)
                    + (Iv::point(rings[1].1) - Iv::point(z)) * mm * Iv::point(2.)
            } else {
                circumference
                    + if rings.len() > 1 {
                        Iv::point(2.) * pi * Iv::point(rings[1].0) * mm
                    } else {
                        Iv::point(0.)
                    }
            };
            fp.push(finite(perimeter)?.m);
        }
        volume = volume * det; // slab already in mm^3
        if volume.lo() <= 0. || volume.r / volume.m > 1e-8 || area.r / area.m > 1e-8 {
            return Err(no("observation-width"));
        }
        let z = (moment / (volume / det)).m / 1000.;
        let mut center = self.center;
        center[self.axis] = z;
        let centroid = self
            .frame
            .apply(center, 1000., true)
            .map_err(|_| no("centroid-range"))?;
        let (lo, hi) = self.bbox_mm()?;
        let faces = self.body.faces.len();
        let rings = self.body.edges.len();
        let genus = usize::from(self.slices.iter().all(|s| s.inner > 0.));
        let vertices = self
            .body
            .vertices
            .iter()
            .map(|v| {
                let p = val(&v.point);
                let q = [0, 1, 2]
                    .map(|j| checked_sum(p[j], self.center[j]))
                    .into_iter()
                    .collect::<R<Vec<_>>>()?
                    .try_into()
                    .unwrap();
                self.frame
                    .apply(q, 1000., true)
                    .map_err(|_| no("projection-range"))
            })
            .collect::<R<Vec<[f64; 3]>>>()?;
        let edges = self
            .body
            .edges
            .iter()
            .map(|e| [e.vertices[0].0, e.vertices[1].0])
            .collect::<Vec<_>>();
        let face_loops = self
            .body
            .faces
            .iter()
            .map(|f| {
                f.loops
                    .iter()
                    .map(|l| {
                        self.body.loops[l.0 as usize]
                            .coedges
                            .iter()
                            .map(|c| {
                                let co = &self.body.coedges[c.0 as usize];
                                format!("[{},{}]", co.edge.0, co.forward)
                            })
                            .collect::<Vec<_>>()
                            .join(",")
                    })
                    .map(|lp| format!("[{lp}]"))
                    .collect::<Vec<_>>()
                    .join(",")
            })
            .map(|face| format!("[{face}]"))
            .collect::<Vec<_>>()
            .join(",");
        let projection =
            format!("{{\"vertices\":{vertices:?},\"edges\":{edges:?},\"faces\":[{face_loops}]}}");
        Ok(format!("{{\"basis\":\"native-f64-construction\",\"certificate\":\"CoaxialProfile\",\"boundToConstruction\":true,\"volumeMm3\":{},\"volumeRelBound\":{},\"areaMm2\":{},\"areaRelBound\":{},\"faceAreasMm2\":{:?},\"facePerimetersMm\":{:?},\"centroidMm\":{:?},\"bboxMm\":{{\"min\":{:?},\"max\":{:?}}},\"mappedBboxMm\":{mapped},\"topology\":{{\"bodies\":1,\"shells\":1,\"faces\":{faces},\"edges\":{rings},\"vertices\":0,\"loops\":{},\"ringEdges\":{rings},\"closedToroidalFaces\":0,\"genus\":{genus},\"singularPoints\":0,\"pinchPoints\":0}},\"validity\":{{\"brep\":true,\"closed\":true,\"positive\":true}},\"toleranceMm\":{},\"probes\":[{probes}],\"projection\":{projection}}}",volume.m,(volume.r/volume.m).next_up(),area.m,(area.r/area.m).next_up(),fa,fp,centroid,lo,hi,self.body.loops.len(),64.*f64::EPSILON*hi.iter().map(|a|a.abs()).fold(0f64,f64::max)))
    }
}
fn exposed(below: Option<Slice>, above: Option<Slice>) -> (Vec<(f64, f64)>, Vec<(f64, f64)>) {
    let b = below.map(|s| (s.inner, s.outer)).unwrap_or((0., 0.));
    let a = above.map(|s| (s.inner, s.outer)).unwrap_or((0., 0.));
    (difference(b, a), difference(a, b))
}
fn difference((i, o): (f64, f64), (j, p): (f64, f64)) -> Vec<(f64, f64)> {
    if i == o {
        return vec![];
    }
    let mut out = vec![];
    if i < j {
        let end = o.min(j);
        if i < end {
            out.push((i, end));
        }
    }
    if o > p {
        let start = i.max(p);
        if start < o {
            out.push((start, o));
        }
    }
    out
}
fn classify(target: Spec, tools: &[Spec], op: u8) -> R<(usize, [f64; 3], Vec<Slice>)> {
    let k = target.axis()?;
    let mut center = target.bottom;
    center[k] = 0.;
    let mut heights = vec![target.bottom[k], target.top[k]];
    for tool in tools {
        if tool.axis()? != k || (0..3).any(|j| j != k && tool.bottom[j] != center[j]) {
            return Err(no("non-coaxial-operand"));
        }
        heights.extend([tool.bottom[k], tool.top[k]]);
    }
    heights.sort_by(f64::total_cmp);
    heights.dedup();
    if heights.len() > 128 {
        return Err(no("arrangement-resource-limit"));
    }
    let mut slabs = vec![];
    for pair in heights.windows(2) {
        let (lo, hi) = (pair[0], pair[1]);
        let active = |s: &Spec| s.bottom[k] <= lo && s.top[k] >= hi;
        let base = active(&target);
        let radii: Vec<_> = tools
            .iter()
            .filter(|s| active(s))
            .map(|s| s.radius)
            .collect();
        let (inner, outer) = if op == 0 {
            (
                0.,
                (if base { target.radius } else { 0. }).max(radii.into_iter().fold(0f64, f64::max)),
            )
        } else if base {
            (
                radii.into_iter().fold(0f64, f64::max).min(target.radius),
                target.radius,
            )
        } else {
            (0., 0.)
        };
        if outer > inner {
            slabs.push(Slice {
                z0: lo,
                z1: hi,
                inner,
                outer,
            });
        }
    }
    if slabs.is_empty() {
        return Err(Refused::geometric_verdict(no("empty-result").0));
    }
    if slabs
        .windows(2)
        .any(|p| p[0].z1 != p[1].z0 || p[0].inner.max(p[1].inner) >= p[0].outer.min(p[1].outer))
    {
        return Err(no("disconnected-or-point-contact"));
    }
    let mut merged: Vec<Slice> = vec![];
    for s in slabs {
        if let Some(p) = merged.last_mut() {
            if p.z1 == s.z0 && p.inner == s.inner && p.outer == s.outer {
                p.z1 = s.z1;
                continue;
            }
        }
        merged.push(s);
    }
    Ok((k, center, merged))
}
/// Ordered mixed operations `((target op1 t1) op2 t2) ...`. Each slab keeps one
/// annulus; a union disc that misses the annulus hole would leave two rings in
/// one slab and refuses by name.
fn classify_sequence(target: Spec, tools: &[(u8, Spec)]) -> R<(usize, [f64; 3], Vec<Slice>)> {
    let k = target.axis()?;
    let mut center = target.bottom;
    center[k] = 0.;
    let mut heights = vec![target.bottom[k], target.top[k]];
    for (op, tool) in tools {
        if *op > 1 {
            return Err(no("operation"));
        }
        if tool.axis()? != k {
            return Err(no("cross-axis-tool-unimplemented"));
        }
        if (0..3).any(|j| j != k && tool.bottom[j] != center[j]) {
            return Err(no("non-coaxial-operand"));
        }
        heights.extend([tool.bottom[k], tool.top[k]]);
    }
    heights.sort_by(f64::total_cmp);
    heights.dedup();
    if heights.len() > 128 {
        return Err(no("arrangement-resource-limit"));
    }
    let mut slabs = vec![];
    for pair in heights.windows(2) {
        let (lo, hi) = (pair[0], pair[1]);
        let active = |s: &Spec| s.bottom[k] <= lo && s.top[k] >= hi;
        let mut ring = active(&target).then_some((0., target.radius));
        for (op, s) in tools.iter().filter(|(_, s)| active(s)) {
            ring = match (*op, ring) {
                (0, None) => Some((0., s.radius)),
                (0, Some((inner, outer))) if s.radius >= inner => Some((0., outer.max(s.radius))),
                (0, Some(_)) => return Err(no("sequence-disjoint-rings")),
                (_, Some((inner, outer))) if s.radius < outer => Some((inner.max(s.radius), outer)),
                _ => None,
            };
        }
        if let Some((inner, outer)) = ring.filter(|(i, o)| o > i) {
            slabs.push(Slice { z0: lo, z1: hi, inner, outer });
        }
    }
    if slabs.is_empty() {
        return Err(Refused::geometric_verdict(no("empty-result").0));
    }
    if slabs
        .windows(2)
        .any(|p| p[0].z1 != p[1].z0 || p[0].inner.max(p[1].inner) >= p[0].outer.min(p[1].outer))
    {
        return Err(no("disconnected-or-point-contact"));
    }
    let mut merged: Vec<Slice> = vec![];
    for s in slabs {
        if let Some(p) = merged.last_mut() {
            if p.z1 == s.z0 && p.inner == s.inner && p.outer == s.outer {
                p.z1 = s.z1;
                continue;
            }
        }
        merged.push(s);
    }
    Ok((k, center, merged))
}
fn append_nodes(nodes: &mut Vec<Construction>, c: &Cylinder) -> NodeId {
    let offset = nodes.len() as u32;
    let mut clone = c.body.constructions.clone();
    for node in &mut clone {
        for id in &mut node.parents {
            id.0 += offset;
        }
    }
    nodes.extend(clone);
    NodeId(nodes.len() as u32 - 1)
}
fn checked_sum(a: f64, b: f64) -> R<f64> {
    let mut g = Guard::new();
    let (sum, tail) = ex::two_sum(a, b, &mut g);
    if !g.exact() || tail != 0. {
        return Err(no("translated-coordinate-not-binary64"));
    }
    b64_check(sum)
}
fn b64_check(x: f64) -> R<f64> {
    b(x)?;
    Ok(x)
}
fn bridge(target: Affine, tool: Affine, spec: Spec, limit: Option<[f64; 2]>) -> R<Spec> {
    if target == tool {
        return Ok(spec);
    }
    if target.x != tool.x || target.z != tool.z {
        return Err(no("different-exact-axes"));
    }
    let cols = target.columns().map_err(|_| no("frame-range"))?;
    let mut shift = [0.; 3];
    for j in 0..3 {
        let idx = (0..3)
            .find(|&k| cols[j][k].abs() == 1. && (0..3).all(|l| l == k || cols[j][l] == 0.))
            .ok_or_else(|| no("different-frame-basis-not-exact"))?;
        let mut g = Guard::new();
        let (diff, tail) = ex::two_sum(tool.origin[idx], -target.origin[idx], &mut g);
        if !g.exact() || tail != 0. {
            return Err(no("translated-coordinate-not-binary64"));
        }
        shift[j] = diff * cols[j][idx];
    }
    let shifted = |x: f64, j: usize| -> R<f64> {
        let mut g = Guard::new();
        let value = ex::sum(&[x], &[shift[j]], &mut g);
        if !g.exact() {
            return Err(no("translated-coordinate-range"));
        }
        if let Some(bounds) = limit.filter(|_| j == spec.axis().unwrap()) {
            if ex::sign(&ex::sum(&value, &[-bounds[0]], &mut g)) <= 0 {
                return Ok(bounds[0]);
            }
            if ex::sign(&ex::sum(&value, &[-bounds[1]], &mut g)) >= 0 {
                return Ok(bounds[1]);
            }
            if !g.exact() {
                return Err(no("translated-coordinate-range"));
            }
        }
        checked_sum(x, shift[j])
    };
    Ok(Spec {
        bottom: [
            shifted(spec.bottom[0], 0)?,
            shifted(spec.bottom[1], 1)?,
            shifted(spec.bottom[2], 2)?,
        ],
        top: [
            shifted(spec.top[0], 0)?,
            shifted(spec.top[1], 1)?,
            shifted(spec.top[2], 2)?,
        ],
        radius: spec.radius,
    })
}

fn frame_node(f: Affine) -> R<Construction> {
    let values = f
        .origin
        .into_iter()
        .chain(f.x)
        .chain(f.z)
        .map(b)
        .collect::<R<Vec<_>>>()?;
    Ok(Construction {
        operation: Operation::Interpreter {},
        rule_version: 1,
        parents: vec![],
        parameters: values,
        frame: FrameId(0),
    })
}
fn replay_frame(nodes: &[Construction], idx: NodeId) -> R<Affine> {
    let n = nodes
        .get(idx.0 as usize)
        .ok_or_else(|| no("construction-reference"))?;
    if n.operation != (Operation::Interpreter {})
        || n.rule_version != 1
        || n.frame != FrameId(0)
        || !n.parents.is_empty()
        || n.parameters.len() != 9
    {
        return Err(no("construction-frame"));
    }
    let q = n.parameters.iter().map(|x| x.get()).collect::<Vec<_>>();
    Ok(Affine {
        origin: [q[0], q[1], q[2]],
        x: [q[3], q[4], q[5]],
        z: [q[6], q[7], q[8]],
    })
}
pub fn boolean(key: BodyKey, op: u8, target: &Cylinder, tools: &[Cylinder]) -> R<Body> {
    if op > 1 || tools.is_empty() {
        return Err(no("operation"));
    }
    let frame = target.frame.as_affine()?;
    let specs = tools
        .iter()
        .map(|c| {
            bridge(
                frame,
                c.frame.as_affine()?,
                c.spec,
                if op == 1 {
                    let k = target.spec.axis()?;
                    Some([target.spec.bottom[k], target.spec.top[k]])
                } else {
                    None
                },
            )
        })
        .collect::<R<Vec<_>>>()?;
    let (axis, center, slices) = classify(target.spec, &specs, op)?;
    let mut nodes = target.body.constructions.clone();
    let mut parents = vec![NodeId(nodes.len() as u32 - 1)];
    for c in tools {
        parents.push(append_nodes(&mut nodes, c));
        nodes.push(frame_node(c.frame.as_affine()?)?);
        parents.push(NodeId(nodes.len() as u32 - 1));
    }
    nodes.push(node(op, parents)?);
    assemble(key, frame, axis, center, &slices, nodes)
}
/// Bridge sequence tools into the target frame. Unions are exact translations;
/// a difference is clipped to the axial envelope of the target and the
/// preceding unions, beyond which it cannot remove material.
fn bridge_sequence(frame: Affine, target: Spec, tools: &[(u8, Cylinder)]) -> R<Vec<(u8, Spec)>> {
    let k = target.axis()?;
    let mut envelope = [target.bottom[k], target.top[k]];
    let mut out = vec![];
    for (op, c) in tools {
        let limit = (*op == 1).then_some(envelope);
        let spec = bridge(frame, c.frame.as_affine()?, c.spec, limit)?;
        if *op == 0 && spec.axis()? == k {
            envelope = [envelope[0].min(spec.bottom[k]), envelope[1].max(spec.top[k])];
        }
        out.push((*op, spec));
    }
    Ok(out)
}
/// `((target op1 t1) op2 t2) ...` with at least two different operations.
/// The root carries one operation per tool, so replay keeps their order.
pub fn sequence(key: BodyKey, target: &Cylinder, tools: &[(u8, Cylinder)]) -> R<Body> {
    if tools.len() < 2 || tools.iter().all(|(op, _)| *op == tools[0].0) {
        return Err(no("operation"));
    }
    let frame = target.frame.as_affine()?;
    let specs = bridge_sequence(frame, target.spec, tools)?;
    let (axis, center, slices) = classify_sequence(target.spec, &specs)?;
    let mut nodes = target.body.constructions.clone();
    let mut parents = vec![NodeId(nodes.len() as u32 - 1)];
    for (_, c) in tools {
        parents.push(append_nodes(&mut nodes, c));
        nodes.push(frame_node(c.frame.as_affine()?)?);
        parents.push(NodeId(nodes.len() as u32 - 1));
    }
    nodes.push(Construction {
        operation: Operation::Boolean {},
        rule_version: 1,
        parents,
        parameters: tools.iter().map(|(op, _)| b(*op as f64)).collect::<R<_>>()?,
        frame: FrameId(2),
    });
    assemble(key, frame, axis, center, &slices, nodes)
}
fn build_ring(
    body: &mut Body,
    k: usize,
    r: f64,
    z: f64,
    prov: &Provenance,
) -> R<u32> {
    let j = (k + 1) % 3;
    let mut at = [0.; 3];
    at[k] = z;
    at[j] = r;
    let mut origin = [0.; 3];
    origin[k] = z;
    let mut axis = [0.; 3];
    axis[k] = 1.;
    let mut x = [0.; 3];
    x[j] = 1.;
    let n = body.vertices.len() as u32;
    body.vertices.push(Vertex {
        point: v(at)?,
        frame: FrameId(2),
        provenance: prov.clone(),
    });
    let index = body.curves.len() as u32;
    body.curves.push(Curve {
        frame: FrameId(2),
        provenance: prov.clone(),
        geometry: CurveGeometry::Circle {
            origin: v(origin)?,
            normal: v(axis)?,
            x: v(x)?,
            radius: b(r)?,
            arc: ArcKind::Full {},
        },
        domain: dom(),
        supports: vec![],
    });
    body.edges.push(Edge {
        curve: CurveId(index),
        domain: dom(),
        vertices: vec![VertexId(n); 2],
    });
    Ok(index)
}
fn add_face(
    body: &mut Body,
    k: usize,
    z0: f64,
    z1: f64,
    inner: f64,
    outer: f64,
    cyl: bool,
    forward: bool,
    rings: &BTreeMap<(u64, u64), u32>,
    prov: &Provenance,
) -> R<()> {
    let mut axis = [0.; 3];
    axis[k] = 1.;
    let mut x = [0.; 3];
    x[(k + 1) % 3] = 1.;
    let mut origin = [0.; 3];
    origin[k] = z0;
    let radius = if cyl { outer } else { 0. };
    let sid = body.surfaces.len() as u32;
    body.surfaces.push(Surface {
        frame: FrameId(2),
        provenance: prov.clone(),
        geometry: if cyl {
            SurfaceGeometry::Cylinder {
                origin: v([0.; 3])?,
                axis: v(axis)?,
                x: v(x)?,
                radius: b(radius)?,
            }
        } else {
            SurfaceGeometry::Plane {
                origin: v(origin)?,
                normal: v(axis)?,
                x: v(x)?,
            }
        },
    });
    let mut loops = vec![];
    let uses = if cyl {
        vec![(outer, z0, forward), (outer, z1, !forward)]
    } else if inner > 0. {
        vec![(outer, z0, forward), (inner, z0, !forward)]
    } else {
        vec![(outer, z0, forward)]
    };
    for (i, (r, z, direction)) in uses.into_iter().enumerate() {
        let edge = *rings
            .get(&(r.to_bits(), z.to_bits()))
            .ok_or_else(|| no("missing-ring"))?;
        let cid = body.pcurves.len() as u32;
        let geometry = if cyl {
            PcurveGeometry::Line {
                a: uv([0., z])?,
                b: uv([1., z])?,
            }
        } else {
            PcurveGeometry::Circle {
                origin: uv([0., 0.])?,
                radius: b(r)?,
                clockwise: !direction,
            }
        };
        body.pcurves.push(Pcurve {
            curve: CurveId(edge),
            surface: SurfaceId(sid),
            domain: dom(),
            geometry,
        });
        body.curves[edge as usize].supports.push(Support {
            surface: SurfaceId(sid),
            pcurve: PcurveId(cid),
        });
        body.coedges.push(Coedge {
            edge: EdgeId(edge),
            forward: direction,
            pcurve: PcurveId(cid),
        });
        let lid = body.loops.len() as u32;
        body.loops.push(Loop {
            outer: i == 0,
            coedges: vec![CoedgeId(cid)],
        });
        loops.push(LoopId(lid));
    }
    body.faces.push(Face {
        surface: SurfaceId(sid),
        forward,
        loops,
    });
    Ok(())
}
fn assemble(
    key: BodyKey,
    frame: Affine,
    k: usize,
    center: [f64; 3],
    slices: &[Slice],
    nodes: Vec<Construction>,
) -> R<Body> {
    let prov = Provenance::Construction {
        node: NodeId(nodes.len() as u32 - 1),
    };
    let mut body = Body {
        key,
        frames: vec![
            Frame::Source { source: [0; 4] },
            Frame::Interpreter {
                parent: FrameId(0),
                origin: v(frame.origin)?,
                x: v(frame.x)?,
                z: v(frame.z)?,
            },
            Frame::Rigid {
                parent: FrameId(1),
                translation: v(center)?,
                axis: v([0., 0., 1.])?,
                angle: b(0.)?,
            },
        ],
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
    let mut sides: Vec<(f64, f64, f64, bool)> = vec![];
    for s in slices {
        for (r, forward) in [(s.outer, true), (s.inner, false)] {
            if r == 0. {
                continue;
            }
            if let Some(side) = sides
                .iter_mut()
                .find(|side| side.0 == r && side.2 == s.z0 && side.3 == forward)
            {
                side.2 = s.z1;
            } else {
                sides.push((r, s.z0, s.z1, forward));
            }
        }
    }
    let mut rings = BTreeMap::new();
    let mut ring_at = |r: f64, z: f64, body: &mut Body| -> R<()> {
        if r > 0. && !rings.contains_key(&(r.to_bits(), z.to_bits())) {
            let idx = build_ring(body, k, r, z, &prov)?;
            rings.insert((r.to_bits(), z.to_bits()), idx);
        }
        Ok(())
    };
    for &(r, lo, hi, _) in &sides {
        ring_at(r, lo, &mut body)?;
        ring_at(r, hi, &mut body)?;
    }
    for z in 0..=slices.len() {
        let below = if z > 0 { Some(slices[z - 1]) } else { None };
        let above = slices.get(z).copied();
        let height = below.map(|s| s.z1).or_else(|| above.map(|s| s.z0)).unwrap();
        let (down, up) = exposed(below, above);
        for (i, o) in down.into_iter().chain(up) {
            ring_at(i, height, &mut body)?;
            ring_at(o, height, &mut body)?;
        }
    }
    for (r, lo, hi, forward) in sides {
        add_face(&mut body, k, lo, hi, 0., r, true, forward, &rings, &prov)?;
    }
    for z in 0..=slices.len() {
        let below = if z > 0 { Some(slices[z - 1]) } else { None };
        let above = slices.get(z).copied();
        let height = below.map(|s| s.z1).or_else(|| above.map(|s| s.z0)).unwrap();
        let (down, up) = exposed(below, above);
        for (inner, outer) in down {
            add_face(
                &mut body, k, height, height, inner, outer, false, true, &rings, &prov,
            )?;
        }
        for (inner, outer) in up {
            add_face(
                &mut body, k, height, height, inner, outer, false, false, &rings, &prov,
            )?;
        }
    }
    body.shells.push(Shell {
        faces: (0..body.faces.len()).map(|i| FaceId(i as u32)).collect(),
    });
    body.solids.push(Solid {
        shells: vec![ShellId(0)],
    });
    body.clone()
        .check()
        .map_err(|e| no(&format!("contract:{e:?}")))?;
    Ok(body)
}
pub fn is_candidate(body: &Body) -> bool {
    body.constructions.last().is_some_and(|n| {
        n.operation == Operation::Boolean {}
            && !n.parameters.is_empty()
            && n.parameters.iter().all(|p| p.get() == 0. || p.get() == 1.)
    }) && body
        .surfaces
        .iter()
        .any(|s| matches!(s.geometry, SurfaceGeometry::Cylinder { .. }))
        && body.frames.len() == 3
        && body.surfaces.iter().all(|s| s.frame == FrameId(2))
}
pub fn audit(checked: &CheckedBody) -> R<Coaxial> {
    let body = checked.body();
    let bad = || no("construction-carrier-mismatch");
    let Frame::Interpreter {
        parent: FrameId(0),
        origin,
        x,
        z,
    } = body.frames.get(1).ok_or_else(bad)?
    else {
        return Err(bad());
    };
    let frame = Affine {
        origin: val(origin),
        x: val(x),
        z: val(z),
    };
    let nodes = &body.constructions;
    let root = nodes.len() - 1;
    let n = &nodes[root];
    if n.operation != (Operation::Boolean {})
        || n.rule_version != 1
        || n.frame != FrameId(2)
        || n.parents.len() < 3
        || (n.parents.len() - 1) % 2 != 0
    {
        return Err(bad());
    }
    let mut fuel = 1024;
    let base = cylinder::replay(nodes, n.parents[0].0 as usize, &mut fuel).map_err(|_| bad())?;
    if n.parameters.len() != 1 {
        // A mixed sequence: one operation per tool, at least two different.
        let ops = n.parameters.iter().map(|p| p.get()).collect::<Vec<_>>();
        if ops.len() != (n.parents.len() - 1) / 2
            || ops.iter().any(|&op| op != 0. && op != 1.)
            || ops.iter().all(|&op| op == ops[0])
        {
            return Err(bad());
        }
        let tools = n.parents[1..]
            .chunks_exact(2)
            .zip(&ops)
            .map(|(pair, &op)| {
                let spec = cylinder::replay(nodes, pair[0].0 as usize, &mut fuel).map_err(|_| bad())?;
                Ok((op as u8, spec, replay_frame(nodes, pair[1])?))
            })
            .collect::<R<Vec<_>>>()?;
        let k = base.axis()?;
        let mut envelope = [base.bottom[k], base.top[k]];
        let mut specs = vec![];
        for (op, spec, tf) in tools {
            let bridged = bridge(frame, tf, spec, (op == 1).then_some(envelope))?;
            if op == 0 && bridged.axis()? == k {
                envelope = [envelope[0].min(bridged.bottom[k]), envelope[1].max(bridged.top[k])];
            }
            specs.push((op, bridged));
        }
        let (axis, center, slices) = classify_sequence(base, &specs)?;
        let expected = assemble(body.key.clone(), frame, axis, center, &slices, nodes.clone())?;
        if body != &expected {
            return Err(bad());
        }
        return Ok(Coaxial { body: body.clone(), frame, axis, center, slices });
    }
    let op = n.parameters[0].get() as u8;
    if op > 1 {
        return Err(bad());
    }
    let tools = n.parents[1..]
        .chunks_exact(2)
        .map(|pair| {
            let spec = cylinder::replay(nodes, pair[0].0 as usize, &mut fuel).map_err(|_| bad())?;
            let tf = replay_frame(nodes, pair[1])?;
            bridge(
                frame,
                tf,
                spec,
                if op == 1 {
                    let k = base.axis()?;
                    Some([base.bottom[k], base.top[k]])
                } else {
                    None
                },
            )
        })
        .collect::<R<Vec<_>>>()?;
    let (axis, center, slices) = classify(base, &tools, op)?;
    let expected = assemble(
        body.key.clone(),
        frame,
        axis,
        center,
        &slices,
        nodes.clone(),
    )?;
    if body != &expected {
        return Err(bad());
    }
    Ok(Coaxial {
        body: body.clone(),
        frame,
        axis,
        center,
        slices,
    })
}
/// Rebuild one unpatterned source cylinder from its node range in a coaxial
/// DAG. The owner audit, not this caller, decides whether it is a cylinder.
fn source_cylinder(key: &BodyKey, frame: Affine, nodes: &[Construction], start: usize) -> R<Cylinder> {
    let bad = || no("sequential-source-grammar");
    let nodes = nodes
        .iter()
        .cloned()
        .map(|mut n| {
            for p in &mut n.parents {
                p.0 = p.0.checked_sub(start as u32).ok_or_else(bad)?;
            }
            Ok(n)
        })
        .collect::<R<Vec<_>>>()?;
    let spec = cylinder::replay(&nodes, nodes.len() - 1, &mut 1024).map_err(|_| bad())?;
    let body = cylinder::assemble(key.clone(), spec, frame, nodes).map_err(|_| bad())?;
    cylinder::audit(&body.check().map_err(|_| bad())?).map_err(|_| bad())
}
impl Coaxial {
    /// The sources of an unplaced arrangement moved by `f` and arranged again,
    /// or `None` when the sources are not plain unplaced cylinders.
    fn placed_from_sources(&self, f: Affine) -> R<Option<Body>> {
        let Ok((sources, ops)) = self.operation_sources() else {
            return Ok(None);
        };
        let placed = sources
            .iter()
            .map(|c| {
                let body = cylinder::transform(c, f)?;
                cylinder::audit(&body.check().map_err(|_| no("construction-carrier-mismatch"))?)
            })
            .collect::<R<Vec<_>>>();
        let Ok(mut placed) = placed else {
            return Ok(None);
        };
        let mut key = self.body.key.clone();
        key.revision = key.revision.checked_add(1).ok_or_else(|| no("revision-range"))?;
        let target = placed.remove(0);
        if ops.iter().all(|&op| op == ops[0]) {
            return boolean(key, ops[0], &target, &placed).map(Some);
        }
        let steps = ops.into_iter().zip(placed).collect::<Vec<_>>();
        sequence(key, &target, &steps).map(Some)
    }
    /// Source cylinders `[target, tools...]` of an audited subtraction, so a
    /// further subtraction is arranged once: (A - B) - C = A - (B ∪ C). A union
    /// does not distribute that way and yields `None`.
    pub(crate) fn subtraction_sources(&self) -> R<Option<Vec<Cylinder>>> {
        let root = self.body.constructions.last().ok_or_else(|| no("sequential-source-grammar"))?;
        if root.parameters.len() != 1 || root.parameters[0].get() != 1. {
            return Ok(None);
        }
        Ok(Some(self.operation_sources()?.0))
    }
    /// Source cylinders `[target, tools...]` and the operation of each tool.
    fn operation_sources(&self) -> R<(Vec<Cylinder>, Vec<u8>)> {
        let bad = || no("sequential-source-grammar");
        let nodes = &self.body.constructions;
        let root = nodes.last().ok_or_else(bad)?;
        let count = (root.parents.len() - 1) / 2;
        let ops = if root.parameters.len() == 1 {
            vec![root.parameters[0].get() as u8; count]
        } else {
            root.parameters.iter().map(|p| p.get() as u8).collect()
        };
        let target = root.parents[0].0 as usize;
        let mut out = vec![source_cylinder(&self.body.key, self.frame, &nodes[..=target], 0)?];
        let mut start = target + 1;
        for pair in root.parents[1..].chunks_exact(2) {
            let (tool, frame) = (pair[0].0 as usize, pair[1].0 as usize);
            if tool < start || frame != tool + 1 {
                return Err(bad());
            }
            let affine = replay_frame(nodes, pair[1])?;
            out.push(source_cylinder(&self.body.key, affine, &nodes[start..=tool], start)?);
            start = frame + 1;
        }
        if start + 1 != nodes.len() || ops.len() + 1 != out.len() {
            return Err(bad());
        }
        Ok((out, ops))
    }
    /// A further union or difference with coaxial cylinders, arranged once
    /// from the replayed sources in their original operation order.
    pub(crate) fn then(&self, key: BodyKey, op: u8, tools: &[Cylinder]) -> R<Body> {
        let (mut sources, ops) = self.operation_sources()?;
        let target = sources.remove(0);
        let mut steps = ops.into_iter().zip(sources).collect::<Vec<_>>();
        steps.extend(tools.iter().map(|c| (op, c.clone())));
        if steps.iter().all(|(o, _)| *o == op) {
            let tools = steps.into_iter().map(|(_, c)| c).collect::<Vec<_>>();
            return boolean(key, op, &target, &tools);
        }
        sequence(key, &target, &steps)
    }
    pub fn tolerance_mm(&self) -> R<f64> {
        let (_, hi) = self.bbox_mm()?;
        Ok((64. * f64::EPSILON * hi.iter().map(|x| x.abs()).fold(0f64, f64::max)).next_up())
    }
}
