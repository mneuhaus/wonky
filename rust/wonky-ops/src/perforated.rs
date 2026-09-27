//! Exact box minus disjoint full-through axial cylinders. The boundary retains
//! planar multi-loop caps and inward cylindrical walls with periodic seams.
//! A replay of the original binary64 construction binds every carrier; neither
//! a tessellation nor STEP healing decides connectivity, tangency or membership.
use crate::{
    affine::Affine,
    cylinder::{self, enclosed, finite, Cylinder, Spec},
    orthogonal,
    polyhedron::{self, Audited, Refused},
};
use std::result::Result;
use wonky_contract::*;
use wonky_num::{
    expansion::{self as ex, Guard},
    Iv,
};
type R<T> = Result<T, Refused>;
fn no(s: &str) -> Refused {
    Refused(format!("perforated/{s}"))
}
fn b(x: f64) -> R<Binary64> {
    Binary64::new(x).map_err(|_| no("numeric-range"))
}
fn get(p: &Vector3) -> [f64; 3] {
    p.each_ref().map(|x| x.get())
}

#[derive(Clone, Debug)]
pub struct Perforated {
    pub body: Body,
    pub base: Audited,
    pub holes: Vec<Spec>,
    pub axis: usize,
    pub bounds: [[f64; 3]; 2],
}

pub fn is_candidate(body: &Body) -> bool {
    body.constructions.last().is_some_and(|n| {
        n.operation == (Operation::Boolean {})
            && n.parameters.len() == 1
            && n.parameters[0].get() == 1.
    })
}

/// Classify strict containment in the two radial slab intervals with exact
/// expansions. Touching a side creates a different face arrangement and refuses.
fn classify(base: &Audited, tools: &[Cylinder]) -> R<(usize, [[f64; 3]; 2], Vec<Spec>)> {
    let cells = base
        .orthogonal
        .as_ref()
        .ok_or_else(|| no("non-box-target"))?;
    let [bounds] = cells.boxes.as_slice() else {
        return Err(no("non-box-target"));
    };
    let mut holes = Vec::new();
    let mut axis = None;
    for tool in tools {
        match cylinder::tangent_box_noop(base, std::slice::from_ref(tool)) {
            Ok(_) => continue,
            Err(e) if e.0 == "cylinder/box-cylinder-cut-arrangement" => {}
            Err(e) => return Err(e),
        }
        let s = tool.spec;
        let k = s.axis()?;
        if axis.is_some_and(|a| a != k) {
            return Err(no("cross-axis-holes"));
        }
        axis = Some(k);
        if s.bottom[k] > bounds[0][k] || s.top[k] < bounds[1][k] {
            return Err(no("blind-or-partial-hole"));
        }
        for j in (0..3).filter(|&j| j != k) {
            for terms in [
                [s.bottom[j], -s.radius, -bounds[0][j]],
                [bounds[1][j], -s.bottom[j], -s.radius],
            ] {
                let mut g = Guard::new();
                let e = terms
                    .into_iter()
                    .fold(vec![], |a, x| ex::sum(&a, &[x], &mut g));
                if !g.exact() {
                    return Err(no("predicate-range"));
                }
                if ex::sign(&e) <= 0 {
                    return Err(no("side-contact-or-crossing"));
                }
            }
        }
        for &other in &holes {
            if cylinder::radial_relation(s, other)? <= 0 {
                return Err(no("holes-contact-or-overlap"));
            }
        }
        holes.push(s);
    }
    Ok((axis.unwrap_or(2), *bounds, holes))
}

pub fn subtract(key: BodyKey, base: &Audited, tools: &[Cylinder]) -> R<Body> {
    let (_, bounds, holes) = classify(base, tools)?;
    if holes.is_empty() {
        return Ok(base.body.clone());
    }
    let mut nodes = base.body.constructions.clone();
    let mut parents = vec![NodeId(nodes.len() as u32 - 1)];
    // Retain all tools, even an outside/no-op tool: replay rechecks its exact
    // separation rather than silently forgetting a construction operand.
    for c in tools {
        let offset = nodes.len() as u32;
        let mut other = c.body.constructions.clone();
        for n in &mut other {
            for p in &mut n.parents {
                p.0 += offset;
            }
        }
        nodes.extend(other);
        parents.push(NodeId(nodes.len() as u32 - 1));
    }
    nodes.push(Construction {
        operation: Operation::Boolean {},
        rule_version: 1,
        parents,
        parameters: vec![b(1.)?],
        frame: FrameId(1),
    });
    assemble(key, base, &holes, bounds, nodes)
}

fn assemble(
    key: BodyKey,
    base: &Audited,
    holes: &[Spec],
    bounds: [[f64; 3]; 2],
    nodes: Vec<Construction>,
) -> R<Body> {
    let k = holes[0].axis()?;
    let mut body = base.body.clone();
    body.key = key;
    body.constructions = nodes;
    let provenance = Provenance::Construction {
        node: NodeId(body.constructions.len() as u32 - 1),
    };
    for v in &mut body.vertices {
        v.provenance = provenance.clone();
    }
    for c in &mut body.curves {
        c.provenance = provenance.clone();
    }
    for s in &mut body.surfaces {
        s.provenance = provenance.clone();
    }
    let mut caps = [None; 2];
    for (fi, face) in body.faces.iter().enumerate() {
        if let SurfaceGeometry::Plane { normal, origin, .. } =
            &body.surfaces[face.surface.0 as usize].geometry
        {
            let n = get(normal);
            if n[k] != 0. {
                let cap = usize::from(n[k] > 0.);
                if get(origin)[k] == bounds[cap][k] {
                    caps[cap] = Some(fi);
                }
            }
        }
    }
    let caps = [
        caps[0].ok_or_else(|| no("missing-cap"))?,
        caps[1].ok_or_else(|| no("missing-cap"))?,
    ];
    for &input in holes {
        let mut s = input;
        s.bottom[k] = bounds[0][k];
        s.top[k] = bounds[1][k];
        // Reuse the cylinder's exact circle/line charts, but never claim the
        // clipped endpoints were fresh interpreter values: provenance is the
        // Boolean node carrying the original box and cylinder inputs.
        let c = cylinder::assemble(body.key.clone(), s, base.frame.as_affine()?, body.constructions.clone())?;
        let frame_id = body.frames.len() as u32;
        body.frames.push(c.frames[2].clone());
        let vo = body.vertices.len() as u32;
        let eo = body.edges.len() as u32;
        let co = body.curves.len() as u32;
        let so = body.surfaces.len() as u32;
        let po = body.pcurves.len() as u32;
        let uo = body.coedges.len() as u32;
        let lo = body.loops.len() as u32;
        for mut vertex in c.vertices {
            vertex.frame = FrameId(frame_id);
            body.vertices.push(vertex);
        }
        let surfaces = [
            body.faces[caps[0]].surface.0,
            body.faces[caps[1]].surface.0,
            so,
        ];
        for mut curve in c.curves {
            if curve.frame == FrameId(2) {
                curve.frame = FrameId(frame_id);
            }
            for support in &mut curve.supports {
                support.surface.0 = surfaces[support.surface.0 as usize];
                support.pcurve.0 += po;
            }
            body.curves.push(curve);
        }
        body.surfaces.push(c.surfaces[2].clone());
        for mut edge in c.edges {
            edge.curve.0 += co;
            for v in &mut edge.vertices {
                v.0 += vo;
            }
            body.edges.push(edge);
        }
        for mut pc in c.pcurves {
            let old_surface = pc.surface.0 as usize;
            pc.curve.0 += co;
            pc.surface.0 = surfaces[old_surface];
            if old_surface < 2 {
                let u = (k + 1) % 3;
                let v = (k + 2) % 3;
                pc.geometry = PcurveGeometry::Circle {
                    origin: [
                        b(s.bottom[u])?,
                        b(if old_surface == 0 {
                            -s.bottom[v]
                        } else {
                            s.bottom[v]
                        })?,
                    ],
                    radius: b(s.radius)?,
                    clockwise: old_surface == 0,
                };
            }
            body.pcurves.push(pc);
        }
        for mut usage in c.coedges {
            usage.edge.0 += eo;
            usage.pcurve.0 += po;
            usage.forward = !usage.forward;
            body.coedges.push(usage);
        }
        for (i, mut lp) in c.loops.into_iter().enumerate() {
            lp.outer = i == 2;
            lp.coedges.reverse();
            for usage in &mut lp.coedges {
                usage.0 += uo;
            }
            body.loops.push(lp);
        }
        for i in 0..2 {
            body.faces[caps[i]].loops.push(LoopId(lo + i as u32));
        }
        body.shells[0].faces.push(FaceId(body.faces.len() as u32));
        body.faces.push(Face {
            surface: SurfaceId(so),
            forward: false,
            loops: vec![LoopId(lo + 2)],
        });
    }
    body.clone().check().map_err(|_| no("contract"))?;
    Ok(body)
}

pub fn audit(checked: &CheckedBody) -> R<Perforated> {
    let body = checked.body();
    let root = body
        .constructions
        .len()
        .checked_sub(1)
        .ok_or_else(|| no("construction"))?;
    let n = &body.constructions[root];
    if !is_candidate(body)
        || n.rule_version != 1
        || n.frame != FrameId(1)
        || n.parents.len() < 2
        || n.parents.len() > 65
    {
        return Err(no("construction"));
    }
    let [Frame::Source { source }, Frame::Interpreter {
        parent,
        origin,
        x,
        z,
    }, ..] = body.frames.as_slice()
    else {
        return Err(no("frame"));
    };
    if *source != [0; 4] || *parent != FrameId(0) {
        return Err(no("frame"));
    }
    let frame = Affine {
        origin: get(origin),
        x: get(x),
        z: get(z),
    };
    if ex::sign(&frame.det_exact().map_err(|_| no("frame"))?) != 1
        || frame.orthonormality_defect().map_err(|_| no("frame"))? > 1e-10
    {
        return Err(no("non-rigid-frame"));
    }
    let target_root = n.parents[0].0 as usize;
    if n.parents.iter().any(|p| p.0 as usize >= root) {
        return Err(no("construction-order"));
    }
    let mut bases = orthogonal::construct(
        body.key.clone(),
        frame,
        body.constructions[..=target_root].to_vec(),
        target_root,
    )?;
    if bases.len() != 1 {
        return Err(no("target-components"));
    }
    let base = polyhedron::audit(
        &bases
            .pop()
            .unwrap()
            .check()
            .map_err(|_| no("target-contract"))?,
    )?;
    let mut tools = Vec::new();
    for p in &n.parents[1..] {
        let spec = cylinder::replay(&body.constructions, p.0 as usize, &mut 1024)?;
        let tool = cylinder::assemble(
            body.key.clone(),
            spec,
            frame,
            body.constructions[..=p.0 as usize].to_vec(),
        )?;
        tools.push(Cylinder {
            frame: crate::placement::Placement::from_frames(&tool, FrameId(1)).map_err(|_|no("frame"))?,
            body: tool,
            spec,
        });
    }
    let (axis, bounds, holes) = classify(&base, &tools)?;
    if holes.is_empty() {
        return Err(no("no-hole"));
    }
    let expected = assemble(
        body.key.clone(),
        &base,
        &holes,
        bounds,
        body.constructions.clone(),
    )?;
    if *body != expected {
        return Err(no("construction-carrier-mismatch"));
    }
    Ok(Perforated {
        body: body.clone(),
        base,
        holes,
        axis,
        bounds,
    })
}

impl Perforated {
    pub fn transform(&self, frame: Affine) -> R<Body> {
        let base = orthogonal::transform(&self.base, frame)?;
        let base = polyhedron::audit(&base.check().map_err(|_| no("target-contract"))?)?;
        assemble(
            self.body.key.clone(),
            &base,
            &self.holes,
            self.bounds,
            self.body.constructions.clone(),
        )
    }
    fn lengths(&self) -> [Iv; 3] {
        [0, 1, 2].map(|k| {
            (Iv::point(self.bounds[1][k]) - Iv::point(self.bounds[0][k])) * Iv::point(1000.)
        })
    }
    fn pi() -> R<Iv> {
        Ok(wonky_validated::pi(1e-14)
            .map_err(|_| no("validated-pi"))?
            .ball())
    }
    fn scale(&self) -> R<Iv> {
        let defect = self
            .base
            .frame
            .orthonormality_defect()
            .map_err(|_| no("frame-range"))?;
        Ok(Iv {
            m: 1.,
            r: (3. * defect).next_up(),
        })
    }
    pub fn measures_mm(&self) -> R<(Iv, Iv, Vec<f64>, Vec<f64>)> {
        let d = self.lengths();
        let pi = Self::pi()?;
        let k = self.axis;
        let mut volume = d[0] * d[1] * d[2];
        let mut cut_area = Iv::point(0.);
        let mut circumference = Iv::point(0.);
        let mut side_areas = Vec::new();
        let mut side_perimeters = Vec::new();
        for h in &self.holes {
            let r = Iv::point(h.radius) * Iv::point(1000.);
            let disc = pi * r * r;
            let ring = Iv::point(2.) * pi * r;
            volume = volume - disc * d[k];
            cut_area = cut_area + disc;
            circumference = circumference + ring;
            side_areas.push(ring * d[k]);
            side_perimeters.push(Iv::point(2.) * (ring + d[k]));
        }
        let det = enclosed(&self.base.frame.det_exact().map_err(|_| no("frame-range"))?);
        volume = finite(volume * det)?;
        let mut area = Iv::point(0.);
        let mut areas = Vec::new();
        let mut perimeters = Vec::new();
        let scale = self.scale()?;
        for face in &self.base.body.faces {
            let SurfaceGeometry::Plane { normal, .. } =
                &self.base.body.surfaces[face.surface.0 as usize].geometry
            else {
                return Err(no("base-carrier"));
            };
            let axis = (0..3)
                .find(|&i| normal[i].get() != 0.)
                .ok_or_else(|| no("base-carrier"))?;
            let mut a = d[(axis + 1) % 3] * d[(axis + 2) % 3];
            let mut p = Iv::point(2.) * (d[(axis + 1) % 3] + d[(axis + 2) % 3]);
            if axis == k {
                a = a - cut_area;
                p = p + circumference;
            }
            area = area + a;
            areas.push(finite(a * scale)?.m);
            perimeters.push(finite(p * scale)?.m);
        }
        for (a, p) in side_areas.into_iter().zip(side_perimeters) {
            area = area + a;
            areas.push(finite(a * scale)?.m);
            perimeters.push(finite(p * scale)?.m);
        }
        area = finite(area * scale)?;
        if volume.lo() <= 0.
            || volume.r / volume.m > 1e-9
            || area.lo() <= 0.
            || area.r / area.m > 1e-9
        {
            return Err(no("observation-width"));
        }
        Ok((volume, area, areas, perimeters))
    }
    pub fn centroid_mm(&self) -> R<[f64; 3]> {
        let d = self.lengths();
        let pi = Self::pi()?;
        let k = self.axis;
        let base = d[0] * d[1] * d[2];
        let mut volume = base;
        let center = [0, 1, 2].map(|j| {
            (Iv::point(self.bounds[0][j]) + Iv::point(self.bounds[1][j])) * Iv::point(500.)
        });
        let mut moment = center.map(|c| c * base);
        for hole in &self.holes {
            let r = Iv::point(hole.radius) * Iv::point(1000.);
            let v = pi * r * r * d[k];
            volume = volume - v;
            for j in 0..3 {
                let c = if j == k {
                    center[j]
                } else {
                    Iv::point(hole.bottom[j]) * Iv::point(1000.)
                };
                moment[j] = moment[j] - v * c;
            }
        }
        let mut p = [0.; 3];
        for j in 0..3 {
            let c = finite(moment[j] / volume)?;
            if c.r > 1e-9 {
                return Err(no("centroid-width"));
            }
            p[j] = c.m / 1000.;
        }
        self.base
            .frame
            .apply(p, 1000., true)
            .map_err(|_| no("frame-range"))
    }
    pub fn tolerance_mm(&self) -> R<f64> {
        let (lo, hi) = self.base.bbox_mm(None)?;
        let mag = lo.into_iter().chain(hi).fold(0_f64, |a, b| a.max(b.abs()));
        let reach = self
            .lengths()
            .into_iter()
            .map(|d| d.hi())
            .fold(0_f64, f64::max);
        Ok((self.base.export_tolerance_mm()?
            + 64. * f64::EPSILON * mag
            + 16. * self.scale()?.r * reach)
            .next_up())
    }
    pub fn probe(&self, q: [f64; 3]) -> R<(f64, bool, f64)> {
        let (p, error) = self
            .base
            .frame
            .inverse_approx(q.map(|v| v / 1000.))
            .map_err(|_| no("probe-frame"))?;
        let magnitude = p.into_iter().map(f64::abs).fold(0_f64, f64::max);
        let e = (8. * error + 64. * f64::EPSILON * magnitude).next_up();
        let k = self.axis;
        let delta = [0, 1, 2].map(|j| (self.bounds[0][j] - p[j]).max(p[j] - self.bounds[1][j]));
        if delta.iter().any(|d| d.abs() <= e) {
            return Err(no("probe-boundary-undecided"));
        }
        let mut radial = 0_f64;
        let mut in_hole = false;
        for h in &self.holes {
            let distance = (p[(k + 1) % 3] - h.bottom[(k + 1) % 3])
                .hypot(p[(k + 2) % 3] - h.bottom[(k + 2) % 3]);
            let gap = h.radius - distance;
            if gap.abs() <= e {
                return Err(no("probe-boundary-undecided"));
            }
            if gap > 0. {
                in_hole = true;
                radial = gap;
            }
        }
        let inside = delta.iter().all(|&d| d < 0.) && !in_hole;
        let distance = if in_hole {
            radial.hypot(delta[k].max(0.))
        } else {
            delta[0]
                .max(0.)
                .hypot(delta[1].max(0.))
                .hypot(delta[2].max(0.))
        };
        let bound = (4. * e + self.scale()?.r * distance) * 1000.;
        if !distance.is_finite() || !bound.is_finite() {
            return Err(no("probe-range"));
        }
        Ok((distance * 1000., inside, bound))
    }
    pub fn measure_json(&self, map: Option<[[f64; 4]; 3]>, probes: &[[f64; 3]]) -> R<String> {
        let (volume, area, areas, perimeters) = self.measures_mm()?;
        let (lo, hi) = self.base.bbox_mm(None)?;
        let mapped = if let Some(m) = map {
            let (l, h) = self.base.bbox_mm(Some(m))?;
            format!("{{\"min\":{l:?},\"max\":{h:?}}}")
        } else {
            "null".into()
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
        let vertices = crate::cylinder_chart::vertices_mm(&self.body, &self.base.frame)?;
        let edges = self
            .body
            .edges
            .iter()
            .map(|e| [e.vertices[0].0, e.vertices[1].0])
            .collect::<Vec<_>>();
        let faces = self
            .body
            .faces
            .iter()
            .map(|f| {
                format!(
                    "[{}]",
                    f.loops
                        .iter()
                        .map(|l| format!(
                            "[{}]",
                            self.body.loops[l.0 as usize]
                                .coedges
                                .iter()
                                .map(|u| {
                                    let c = &self.body.coedges[u.0 as usize];
                                    format!("[{},{}]", c.edge.0, c.forward)
                                })
                                .collect::<Vec<_>>()
                                .join(",")
                        ))
                        .collect::<Vec<_>>()
                        .join(",")
                )
            })
            .collect::<Vec<_>>()
            .join(",");
        let n = self.holes.len();
        let centroid = self.centroid_mm()?;
        let tolerance = self.tolerance_mm()?;
        Ok(format!(concat!("{{\"basis\":\"native-f64-construction\",\"certificate\":\"PerforatedBox\",\"boundToConstruction\":true,",
            "\"volumeMm3\":{:?},\"volumeRelBound\":{:?},\"areaMm2\":{:?},\"areaRelBound\":{:?},\"centroidMm\":{centroid:?},",
            "\"bboxMm\":{{\"min\":{lo:?},\"max\":{hi:?}}},\"mappedBboxMm\":{mapped},",
            "\"topology\":{{\"bodies\":1,\"shells\":1,\"faces\":{},\"edges\":{},\"vertices\":8,\"loops\":{},\"ringEdges\":{},\"closedToroidalFaces\":0,\"genus\":{n},\"singularPoints\":0,\"pinchPoints\":0}},",
            "\"validity\":{{\"brep\":true,\"closed\":true,\"positive\":true}},\"toleranceMm\":{tolerance:?},\"probes\":[{probes}],\"faceAreasMm2\":{areas:?},\"facePerimetersMm\":{perimeters:?},",
            "\"projection\":{{\"vertices\":{vertices:?},\"edges\":{edges:?},\"faces\":[{faces}]}}}}"),
            volume.m,volume.r/volume.m,area.m,area.r/area.m,6+n,12+2*n,6+4*n,2*n,
            centroid=centroid,lo=lo,hi=hi,mapped=mapped,n=n,tolerance=tolerance,probes=probes,areas=areas,perimeters=perimeters,vertices=vertices,edges=edges,faces=faces))
    }
}
