//! Enclosed measures, bounding boxes, export budget, STEP and a
//! deviation-bounded mesh of an audited stacked-prism arrangement. Areas and
//! moments are Green integrals of the exact cells (arc_profile_observe);
//! heights are exact level differences. No polygonized carrier decides
//! anything; the mesh is an explicit observation with a stated budget.
use crate::{
    arc_profile::{enclose, finite, q},
    mesh::{Mesh, MeshEdge},
    prism_stack::{no, PrismStack, R},
    prism_stack_brep::{EdgeGeom, FaceKind, Patch, VKey},
};
use num_rational::BigRational as Q;
use num_traits::Zero;
use std::collections::BTreeMap;
use wonky_curve as wc;
use wonky_num::{Iv, Scalar};

fn i(x: f64) -> Iv {
    Iv::point(x)
}
type P3 = [Q; 3];
impl PrismStack {
    fn stretch(&self, power: f64) -> R<Iv> {
        let d = self.frame.orthonormality_defect().map_err(|_| no("frame-range"))?;
        if d > 1e-9 {
            return Err(no("non-near-rigid-frame"));
        }
        Ok(Iv { m: 1., r: (power * d).next_up() })
    }
    fn det(&self) -> R<Iv> {
        Ok(self
            .frame
            .det_exact()
            .map_err(|_| no("frame-range"))?
            .iter()
            .fold(i(0.), |s, &v| s + i(v)))
    }
    fn height(&self, lo: usize, hi: usize) -> R<Iv> {
        enclose(&(&self.stack.levels[hi] - &self.stack.levels[lo]))
    }
    fn cell_profile(&self, k: usize) -> Vec<wc::Cycle> {
        self.stack.arr.cells[k]
            .cycles
            .iter()
            .map(|c| self.stack.arr.cycle_profile(c))
            .collect()
    }
    fn cell_area(&self, k: usize) -> R<Iv> {
        let mut a = i(0.);
        for p in self.cell_profile(k) {
            a = a + p.area()?;
        }
        finite(a)
    }
    fn piece_length(&self, e: usize) -> R<Iv> {
        Ok(self.stack.arr.pieces[e].seg.length()?)
    }
    fn ring(&self, t: usize, ri: usize) -> R<[Iv; 2]> {
        let [z, r] = &self.stack.tools[t].rings[ri];
        Ok([enclose(z)?, enclose(r)?])
    }
    /// Removed volume and z-moment of a tool band (a frustum about the axis).
    fn band_frustum(&self, t: usize, band: usize) -> R<[Iv; 2]> {
        let [lo, hi] = self.stack.tools[t].bands[band];
        let rings = &self.stack.tools[t].rings;
        let h = enclose(&(&rings[hi][0] - &rings[lo][0]))?;
        let ([z0, r0], [_, r1]) = (self.ring(t, lo)?, self.ring(t, hi)?);
        let d = r1 - r0;
        let pi = crate::analytic_pi::pi();
        let volume = pi * h * (r0 * r0 + r0 * r1 + r1 * r1) / i(3.);
        let moment = pi * h * (z0 * (r0 * r0 + r0 * d + d * d / i(3.)) + h * (r0 * r0 / i(2.) + i(2.) * r0 * d / i(3.) + d * d / i(4.)));
        Ok([finite(volume)?, finite(moment)?])
    }
    fn band_area(&self, t: usize, band: usize) -> R<Iv> {
        let [lo, hi] = self.stack.tools[t].bands[band];
        let rings = &self.stack.tools[t].rings;
        let h = enclose(&(&rings[hi][0] - &rings[lo][0]))?;
        let ([_, r0], [_, r1]) = (self.ring(t, lo)?, self.ring(t, hi)?);
        let d = r1 - r0;
        finite(crate::analytic_pi::pi() * (r0 + r1) * (h * h + d * d).sqrt())
    }
    fn disc_area(&self, t: usize, ri: usize) -> R<Iv> {
        let r = self.ring(t, ri)?[1];
        finite(crate::analytic_pi::pi() * r * r)
    }
    /// Volume in mm^3 with its enclosure.
    pub fn volume(&self) -> R<Iv> {
        let mut v = i(0.);
        for (k, slabs) in self.stack.material.iter().enumerate() {
            let area = self.cell_area(k)?;
            for (j, &m) in slabs.iter().enumerate() {
                if m {
                    v = v + area * self.height(j, j + 1)?;
                }
            }
        }
        for (t, tool) in self.stack.tools.iter().enumerate() {
            for b in 0..tool.bands.len() {
                v = v - self.band_frustum(t, b)?[0];
            }
        }
        for b in &self.blend { v=v-b.removed()?/i(1e9); }
        finite(v * self.det()? * i(1e9))
    }
    fn face_areas(&self) -> R<Vec<Iv>> {
        let scale = self.stretch(3.)? * i(1e6);
        let mut areas = self.brep
            .faces
            .iter()
            .map(|f| {
                let mut a = i(0.);
                for p in &f.patches {
                    a = a + match *p {
                        Patch::Cap(k, _) => self.cell_area(k)?,
                        Patch::Side(e, j) => self.piece_length(e)? * self.height(j, j + 1)?,
                    };
                }
                for &(t, ri) in &f.holes {
                    a = a - self.disc_area(t, ri)?;
                }
                match f.kind {
                    FaceKind::Band { tool, band, .. } => a = a + self.band_area(tool, band)? / i(2.),
                    FaceKind::Plate { tool, plate } => {
                        let p = &self.stack.tools[tool].plates[plate];
                        a = a + self.disc_area(tool, p.outer)?;
                        if let Some(inner) = p.inner {
                            a = a - self.disc_area(tool, inner)?;
                        }
                    }
                    _ => {}
                }
                finite(a * scale)
            })
            .collect::<R<Vec<_>>>()?;
        for b in &self.blend {
            let band=b.areas()?;
            areas[b.cap]=areas[b.cap]+(band[1]-band[0])*i(if b.rim.outward{-1.}else{1.})*self.stretch(3.)?;
            let lengths=b.spec.lengths()?;
            for (k,&side) in b.sides.iter().enumerate(){areas[side]=areas[side]-lengths[k]*i(b.rim.radius)*scale;}
            let stretch=self.stretch(3.)?; areas.extend(band[2+b.sides.len()..].iter().map(|&a|a*stretch));
        }
        Ok(areas)
    }
    fn edge_length(&self, e: &EdgeGeom) -> R<Iv> {
        match e {
            EdgeGeom::Horizontal { pieces, .. } => {
                let mut l = i(0.);
                for &p in pieces {
                    l = l + self.piece_length(p)?;
                }
                finite(l)
            }
            EdgeGeom::Vertical { span, .. } => self.height(span[0], span[1]),
            EdgeGeom::Ring { tool, ring, .. } => finite(crate::analytic_pi::pi() * self.ring(*tool, *ring)?[1]),
            EdgeGeom::Seam { tool, band, .. } => {
                let [lo, hi] = self.stack.tools[*tool].bands[*band];
                let ([z0, r0], [z1, r1]) = (self.ring(*tool, lo)?, self.ring(*tool, hi)?);
                finite(((z1 - z0) * (z1 - z0) + (r1 - r0) * (r1 - r0)).sqrt())
            }
        }
    }
    fn face_perimeters(&self) -> R<Vec<f64>> {
        if !self.blend.is_empty(){return self.blended_perimeters();}
        let scale = self.stretch(2.)? * i(1000.);
        let b = &self.body;
        b.faces
            .iter()
            .map(|f| {
                let mut l = i(0.);
                for lp in &f.loops {
                    for c in &b.loops[lp.0 as usize].coedges {
                        let e = b.coedges[c.0 as usize].edge.0 as usize;
                        l = l + self.edge_length(&self.brep.edges[e])?;
                    }
                }
                Ok(finite(l * scale)?.mid())
            })
            .collect()
    }
    fn exact_map(&self) -> R<(P3, [P3; 3])> {
        let map = |p, translate| -> R<P3> {
            let e = self.frame.apply_exact(p, 1., translate).map_err(|_| no("frame-range"))?;
            Ok(e.map(|e| e.into_iter().map(q).sum()))
        };
        Ok((
            map([0.; 3], true)?,
            [map([1., 0., 0.], false)?, map([0., 1., 0.], false)?, map([0., 0., 1.], false)?],
        ))
    }
    fn centroid(&self) -> R<([f64; 3], [f64; 3])> {
        let (mut vol, mut mx, mut my, mut mz) = (i(0.), i(0.), i(0.), i(0.));
        for (k, slabs) in self.stack.material.iter().enumerate() {
            let area = self.cell_area(k)?;
            let mut moment = [i(0.); 2];
            for p in self.cell_profile(k) {
                let m = p.moments()?;
                moment = [moment[0] + m[0], moment[1] + m[1]];
            }
            for (j, &m) in slabs.iter().enumerate() {
                if m {
                    let h = self.height(j, j + 1)?;
                    let mid = (enclose(&self.stack.levels[j])? + enclose(&self.stack.levels[j + 1])?) / i(2.);
                    vol = vol + area * h;
                    mx = mx + moment[0] * h;
                    my = my + moment[1] * h;
                    mz = mz + area * h * mid;
                }
            }
        }
        for (t, tool) in self.stack.tools.iter().enumerate() {
            let (cx, cy) = (enclose(&tool.c[0])?, enclose(&tool.c[1])?);
            for b in 0..tool.bands.len() {
                let [v, m] = self.band_frustum(t, b)?;
                vol = vol - v;
                mx = mx - v * cx;
                my = my - v * cy;
                mz = mz - m;
            }
        }
        for b in &self.blend {let m=b.moments_removed()?; vol=vol-b.removed()?/i(1e9); mx=mx-m[0]/i(1e9);my=my-m[1]/i(1e9);mz=mz-m[2]/i(1e9);}
        let local = [mx / vol, my / vol, mz / vol];
        let cols = self.frame.enclosed_columns();
        let origin = self.frame.apply_exact([0.; 3], 1., true).map_err(|_| no("frame-range"))?;
        let mut out = [i(0.); 3];
        for k in 0..3 {
            out[k] = origin[k].iter().fold(i(0.), |s, &x| s + i(x));
            for j in 0..3 {
                out[k] = out[k] + cols[j][k] * local[j];
            }
            out[k] = finite(out[k] * i(1000.))?;
        }
        Ok((out.map(|x| x.mid()), out.map(|x| x.r)))
    }
    pub(crate) fn bbox_mm(&self, map: Option<[[f64; 4]; 3]>) -> R<([f64; 3], [f64; 3])> {
        let mapping = map.unwrap_or([[1., 0., 0., 0.], [0., 1., 0., 0.], [0., 0., 1., 0.]]);
        let (origin, cols) = self.exact_map()?;
        let arr = &self.stack.arr;
        let mut lo = [f64::INFINITY; 3];
        let mut hi = [f64::NEG_INFINITY; 3];
        for k in 0..3 {
            let mut offset = q(mapping[k][3]);
            let mut linear = [Q::zero(), Q::zero(), Q::zero()];
            for j in 0..3 {
                offset += q(mapping[k][j]) * &origin[j] * q(1000.);
                for u in 0..3 {
                    linear[u] += q(mapping[k][j]) * &cols[u][j] * q(1000.);
                }
            }
            for (vi,&key) in self.brep.vertices.iter().enumerate() {
                // Tool rings lie strictly inside base faces: never extreme.
                let VKey::Grid(v, j) = key else { continue };
                let z = if let Some(b)=self.blend.iter().find(|b|b.vertices.contains(&vi)){q(b.rim.center_z)}else{self.stack.levels[j].clone()};
                let base = &offset + &linear[2] * z;
                let x = arr.points[v].linear_form(&base, [&linear[0], &linear[1]])?;
                lo[k] = lo[k].min(x.lo());
                hi[k] = hi[k].max(x.hi());
            }
            for (ei,e) in self.brep.edges.iter().enumerate() {
                let EdgeGeom::Horizontal { level, pieces } = e else { continue };
                let z=if let Some(b)=self.blend.iter().find(|b|b.edges.contains(&ei)){q(b.rim.center_z)}else{self.stack.levels[*level].clone()};
                let base = &offset + &linear[2] * z;
                for &piece in pieces {
                    let reach = arr.pieces[piece].seg.extrema(&base, [&linear[0], &linear[1]])?;
                    if let Some(h) = reach.hi {
                        hi[k] = hi[k].max(h);
                    }
                    if let Some(l) = reach.lo {
                        lo[k] = lo[k].min(l);
                    }
                }
            }
        }
        for b in self.blend.iter().filter(|b|!b.rim.outward) {
            let mut band=b.spec.clone();
            if b.rim.bottom{band.levels[1]=b.rim.center_z;}else{band.levels[0]=b.rim.center_z;}
            let mut carrier=b.carrier.clone();carrier.frame=self.frame.clone();
            let (bl,bh)=b.rim.bbox(&band,&carrier,map)?;
            for k in 0..3{lo[k]=lo[k].min(bl[k]);hi[k]=hi[k].max(bh[k]);}
        }
        Ok((lo, hi))
    }
    pub fn tolerance_mm(&self) -> R<f64> {
        let (lo, hi) = self.bbox_mm(None)?;
        let mut magnitude = lo.into_iter().chain(hi).fold(0.0f64, |m, v| m.max(v.abs()));
        let mut cache = 0.0f64;
        for p in &self.stack.arr.points {
            cache = cache.max(p.rounding()? * 1000.);
        }
        for l in &self.stack.levels {
            cache = cache.max(enclose(l)?.r * 1000.);
        }
        for piece in &self.stack.arr.pieces {
            let extent = piece.seg.extent()?;
            magnitude = magnitude.max(extent.magnitude * 1000.);
            cache = cache.max(extent.rounding * 1000.);
        }
        for tool in &self.stack.tools {
            for [z, r] in &tool.rings {
                let (cx, cy, r, z) = (enclose(&tool.c[0])?, enclose(&tool.c[1])?, enclose(r)?, enclose(z)?);
                magnitude = magnitude.max((cx.abs() + r).hi() * 1000.).max(cy.abs().hi() * 1000.);
                cache = cache.max((cx.r + cy.r + r.r + z.r) * 1000.);
            }
        }
        let defect = self.frame.orthonormality_defect().map_err(|_| no("frame-range"))?;
        let error = finite(i(128. * f64::EPSILON + 16. * defect) * i(magnitude) + i(8.) * i(cache))?.hi();
        if error <= 0. || !error.is_finite() {
            return Err(no("export-budget-range"));
        }
        if self.body.curves.iter().any(|c| matches!(c.geometry, wonky_contract::CurveGeometry::BSpline { .. })) {
            Ok(error.max(crate::step_carrier::budget_of(&self.body, &self.frame)?))
        } else { Ok(error) }
    }
    fn blended_perimeters(&self)->R<Vec<f64>> {
        // Lengths stay attached to exact source trims. The rounded WC0 circle
        // angle and endpoint caches are never an observation's authority.
        let scale=self.stretch(2.)?*i(1000.);
        let lengths=(0..self.body.edges.len()).map(|ei| {
            for b in &self.blend {
                if let Some(k)=b.edges.iter().position(|&e|e==ei){return Ok(b.spec.lengths()?[k]*scale);}
                let n=b.edges.len();
                if (b.new_edges..b.new_edges+n).contains(&ei){return Ok(b.rim.inner.segments()[ei-b.new_edges].length()?*scale);}
                if (b.new_edges+n..b.new_edges+2*n).contains(&ei) {
                    if b.rim.mitred {
                        let k = ei - b.new_edges - n;
                        return Ok(b.rim.joint_length(&b.spec, k)? * scale);
                    }
                    return Ok(i(b.rim.radius)*if b.rim.chamfer{i(2.).sqrt()}else{crate::analytic_pi::pi()/i(2.)}*scale);
                }
            }
            let e=self.brep.edges.get(ei).ok_or_else(||no("band-edge-length"))?;
            if let EdgeGeom::Vertical{span,..}=e {
                let vs=&self.body.edges[ei].vertices;
                let mut zs=span.map(|l|self.stack.levels[l].clone());
                for (k,v) in vs.iter().enumerate(){if let Some(b)=self.blend.iter().find(|b|b.vertices.contains(&(v.0 as usize))){zs[k]=q(b.rim.center_z);}}
                return Ok(enclose(&(&zs[1]-&zs[0]))?.abs()*scale);
            }
            Ok(self.edge_length(e)?*scale)
        }).collect::<R<Vec<_>>>()?;
        self.body.faces.iter().map(|f|{let mut l=i(0.);for lp in &f.loops{for u in &self.body.loops[lp.0 as usize].coedges{l=l+lengths[self.body.coedges[u.0 as usize].edge.0 as usize];}}Ok(l.mid())}).collect()
    }
    fn probe(&self, world: [f64; 3]) -> R<(f64, bool, f64)> {
        let p = crate::probe_exact::local_point(&self.frame, world).map_err(no)?;
        let levels = &self.stack.levels;
        let chart_xy: wc::P = [p[0].clone(), p[1].clone()];
        let xy = wc::ExactPoint::from_rational(chart_xy.clone());
        let slab = (0..levels.len() - 1).find(|&j| levels[j] < p[2] && p[2] < levels[j + 1]);
        let on_boundary = levels.contains(&p[2])
            || self.stack.arr.pieces.iter().map(|piece| piece.seg.contains(&xy)).collect::<wc::R<Vec<_>>>()?.into_iter().any(|on| on);
        if on_boundary {
            return Err(no("probe-on-boundary-unimplemented"));
        }
        let mut cell = None;
        for k in 0..self.stack.arr.cells.len() {
            let mut winding = 0;
            for c in self.cell_profile(k) {
                winding += c.winding(&xy)?;
            }
            if winding != 0 {
                cell = Some(k);
                break;
            }
        }
        match (slab, cell) {
            (Some(j), Some(k)) if self.stack.material[k][j] => {
                for tool in &self.stack.tools {
                    match tool.contains(&chart_xy, &p[2]) {
                        None => return Err(no("probe-on-boundary-unimplemented")),
                        Some(true) => return Err(no("probe-outside-distance-unimplemented")),
                        Some(false) => {}
                    }
                }
                Ok((0., true, 0.))
            }
            // Outside the material (or in a void between cells): the solid is the
            // union of its material cell x slab prisms, so the distance is the
            // minimum over those prisms of sqrt(planar distance^2 + height gap^2).
            _ if self.stack.tools.is_empty() => self.distance_outside(&xy, &p[2]),
            _ => Err(no("probe-outside-distance-unimplemented")),
        }
    }
    fn distance_outside(&self, xy: &wc::ExactPoint, z: &Q) -> R<(f64, bool, f64)> {
        let (arr, levels) = (&self.stack.arr, &self.stack.levels);
        let mut best: Option<Iv> = None;
        for k in 0..arr.cells.len() {
            let slabs = (0..levels.len() - 1).filter(|&j| self.stack.material[k][j]).collect::<Vec<_>>();
            if slabs.is_empty() {
                continue;
            }
            let mut winding = 0;
            for c in self.cell_profile(k) {
                winding += c.winding(xy)?;
            }
            let planar = if winding != 0 {
                i(0.)
            } else {
                let mut nearest: Option<Iv> = None;
                for &h in arr.cells[k].cycles.iter().flatten() {
                    let d = arr.pieces[h / 2].seg.distance(xy)?;
                    nearest = Some(nearest.map_or(d, |m| m.min(d)));
                }
                nearest.ok_or_else(|| no("probe-outside-distance-unimplemented"))?
            };
            for j in slabs {
                let gap = if *z < levels[j] {
                    &levels[j] - z
                } else if *z > levels[j + 1] {
                    z - &levels[j + 1]
                } else {
                    Q::zero()
                };
                let gap = enclose(&gap)?;
                let d = finite(planar * planar + gap * gap)?.sqrt();
                best = Some(best.map_or(d, |m| m.min(d)));
            }
        }
        // The minimum above is measured in the construction chart. Enclose
        // its world-space metric distortion just as for edge lengths.
        let d = finite(best.ok_or_else(|| no("probe-outside-distance-unimplemented"))? * self.stretch(2.)? * i(1000.))?;
        Ok((d.m, false, d.r))
    }
    pub fn measure_json(&self, map: Option<[[f64; 4]; 3]>, probes: &[[f64; 3]]) -> R<String> {
        if !self.blend.is_empty() && !probes.is_empty() {return Err(no("blended-probes-unimplemented"));}
        let volume = self.volume()?;
        let areas = self.face_areas()?;
        let area = finite(areas.iter().fold(i(0.), |s, &a| s + a))?;
        let perimeters = self.face_perimeters()?;
        let (center, center_bound) = self.centroid()?;
        let (lo, hi) = self.bbox_mm(None)?;
        let mapped = match map {
            Some(m) => {
                let (lo, hi) = self.bbox_mm(Some(m))?;
                format!("{{\"min\":{lo:?},\"max\":{hi:?}}}")
            }
            None => "null".into(),
        };
        let probes = probes
            .iter()
            .map(|&p| match self.probe(p) {
                Ok((d, inside, b)) => format!("{{\"distanceMm\":{d:?},\"inside\":{inside},\"boundMm\":{b:?}}}"),
                Err(e) => format!("{{\"refused\":\"{}\"}}", e.0),
            })
            .collect::<Vec<_>>()
            .join(",");
        let b = &self.body;
        let (faces, edges, vertices, loops, rings, genus) = crate::prism_holes_observe::periodic_topology(b);
        let tolerance = self.tolerance_mm()?;
        let defect = self.frame.orthonormality_defect().map_err(|_| no("frame-range"))?;
        let world = crate::cylinder_chart::vertices_mm(b, &self.frame)?;
        let projected_edges = b.edges.iter().map(|e| [e.vertices[0].0, e.vertices[1].0]).collect::<Vec<_>>();
        let projected_faces = b
            .faces
            .iter()
            .map(|f| {
                format!(
                    "[{}]",
                    f.loops
                        .iter()
                        .map(|l| format!(
                            "[{}]",
                            b.loops[l.0 as usize]
                                .coedges
                                .iter()
                                .map(|u| {
                                    let c = &b.coedges[u.0 as usize];
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
        let face_areas = areas.iter().map(|a| a.mid()).collect::<Vec<_>>();
        Ok(format!(
            concat!(
                "{{\"basis\":\"native-f64-construction\",\"certificate\":\"StackedPrismArrangement\",\"boundToConstruction\":true,",
                "\"volumeMm3\":{:?},\"volumeRelBound\":{:?},\"areaMm2\":{:?},\"areaRelBound\":{:?},\"faceAreasMm2\":{:?},\"facePerimetersMm\":{:?},",
                "\"centroidMm\":{:?},\"centroidBoundMm\":{:?},\"bboxMm\":{{\"min\":{:?},\"max\":{:?}}},\"mappedBboxMm\":{},",
                "\"topology\":{{\"bodies\":1,\"shells\":1,\"faces\":{},\"edges\":{},\"vertices\":{},\"loops\":{},\"ringEdges\":{},\"genus\":{},\"closedToroidalFaces\":0,\"singularPoints\":0,\"pinchPoints\":0}},",
                "\"validity\":{{\"brep\":true,\"closed\":true,\"positive\":{}}},\"toleranceMm\":{:?},\"frame\":{{\"orthonormalityDefect\":{:?}}},\"probes\":[{}],",
                "\"projection\":{{\"vertices\":{:?},\"edges\":{:?},\"faces\":[{}]}}}}"
            ),
            volume.m,
            volume.r / volume.lo(),
            area.m,
            area.r / area.lo(),
            face_areas,
            perimeters,
            center,
            center_bound,
            lo,
            hi,
            mapped,
            faces,
            edges,
            vertices,
            loops,
            rings,
            genus,
            volume.lo() > 0.,
            tolerance,
            defect,
            probes,
            world,
            projected_edges,
            projected_faces
        ))
    }
    /// Deviation-bounded export observation. Sampling enclosure, exact world
    /// mapping and nonincident-contour refinement share the single-profile
    /// mesher's certificate; a Boolean identity cannot bypass those guards.
    /// Ordered chart witnesses retain micro-edges within the same error budget.
    pub(crate) fn tessellate(&self, deviation_mm: f64) -> R<Mesh> {
        if !self.blend.is_empty(){return crate::mesh_curved::tessellate(&self.body,deviation_mm);}
        if !deviation_mm.is_finite() || deviation_mm <= 0. {
            return Err(no("mesh-deviation"));
        }
        let metric = crate::mesh_boundary::Metric::new(&self.frame)?;
        let mut budget = deviation_mm;
        for _ in 0..crate::mesh_boundary::MAX_REFINEMENTS {
            if let Some(mesh) = self.sample_mesh(&metric, budget, deviation_mm)? {
                return Ok(mesh);
            }
            budget /= 2.;
        }
        Err(crate::polyhedron::Refused("export/stl/sub-resolution-separation".into()))
    }
    fn sample_mesh(&self, metric: &crate::mesh_boundary::Metric, budget: f64, requested: f64) -> R<Option<Mesh>> {
        wc::radical::guard(|| self.sample_mesh_exact(metric, budget, requested))?
    }
    fn sample_mesh_exact(&self, metric: &crate::mesh_boundary::Metric, budget: f64, requested: f64) -> R<Option<Mesh>> {
        let arr = &self.stack.arr;
        let scale = metric.scale;
        // Check authoritative endpoints before selecting displaced witnesses:
        // an unrepresentable world placement is a vertex-precision refusal,
        // not a request to move the source geometry onto a coarser lattice.
        for point in &arr.points {
            let p = point.enclosure()?;
            for level in &self.stack.levels {
                let (_, error) = metric.sample(&self.frame, [p[0], p[1], enclose(level)?])?;
                metric.deviation(0., error, requested)?;
            }
        }
        // Micro-edges of an exact arrangement must survive both binary64
        // placement and float32 STL. Choose distinct ordered chart witnesses,
        // reserving a quarter of the tessellation budget for displacement
        // and a quarter for sampling/placement evaluation.
        let (lo, hi) = self.bbox_mm(None)?;
        let reach = lo.into_iter().chain(hi).fold(1.0_f64, |a, b| a.max(b.abs()));
        let quantum = 2_f64.powi(reach.log2().ceil() as i32 - 33);
        let mut column_l1 = 0.0_f64;
        for column in &self.frame.enclosed_columns() {
            let bound = column.iter().fold(i(0.), |s, v| s + v.abs());
            column_l1 = column_l1.max(finite(bound * i(1000.))?.hi());
        }
        let witness_budget = finite(i(budget) / (i(12.) * i(column_l1)))?.lo();
        let points = arr.points.iter().map(|p| p.coordinates()).collect::<Vec<_>>();
        let x = points.iter().map(|p| p[0].clone()).collect::<Vec<_>>();
        let y = points.iter().map(|p| p[1].clone()).collect::<Vec<_>>();
        let xs = crate::mesh::ordered_witnesses(&x, quantum, witness_budget)?;
        let ys = crate::mesh::ordered_witnesses(&y, quantum, witness_budget)?;
        let mut zvalues = self.stack.levels.clone();
        zvalues.extend(self.stack.tools.iter().flat_map(|tool| tool.rings.iter().map(|ring| ring[0].clone())));
        let zs = crate::mesh::ordered_witnesses(&zvalues, quantum, witness_budget)?;
        let witnesses = points.iter().map(|p| [xs[&p[0]], ys[&p[1]]]).collect::<Vec<_>>();
        let mut counts = vec![1usize; arr.pieces.len()];
        for (e, piece) in arr.pieces.iter().enumerate() {
            let n = piece.seg.subdivisions(scale, budget / 2.)?;
            if !n.is_finite() || n > 65536. {
                return Err(no("mesh-resource-limit"));
            }
            counts[e] = n as usize;
        }
        // Tool rings: 2n samples per ring at equal turns, n from the tool's
        // largest radius; bands between rings of one tool are quad strips.
        let mut ring_n = vec![];
        for tool in &self.stack.tools {
            let radius = finite(enclose(&tool.rmax)? * scale)?.hi();
            let n = finite(crate::analytic_pi::pi() / (i(4.) * i(budget) / i(radius)).sqrt())?.hi().ceil().max(2.);
            if !n.is_finite() || n > 65536. {
                return Err(no("mesh-resource-limit"));
            }
            ring_n.push(n as usize);
        }
        #[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
        enum Key {
            Vertex(usize, usize),
            Sample(usize, usize, usize),
            Ring(usize, usize, usize),
        }
        let mut index = BTreeMap::<Key, usize>::new();
        let mut local2 = vec![];
        let mut source = vec![];
        let displacement = finite(scale * i(3.).sqrt() * i(witness_budget))?.hi();
        let mut rounding = displacement;
        let mut mesh = Mesh::default();
        let reversed = self.frame.reversed().map_err(|_| no("frame-range"))?;
        let mut id = |key: Key, mesh: &mut Mesh, local2: &mut Vec<[f64; 2]>| -> R<usize> {
            if let Some(&v) = index.get(&key) {
                return Ok(v);
            }
            let (p, z) = match key {
                Key::Vertex(v, j) => (witnesses[v].map(i), i(zs[&self.stack.levels[j]])),
                Key::Sample(e, s, j) => {
                    let piece = &arr.pieces[e];
                    let t = q(s as f64) / q(counts[e] as f64);
                    let original = piece.seg.sample_enclosure(s, counts[e], crate::mesh_curved::sin_cos)?;
                    let shifted = [0, 1].map(|k| {
                        let da = wc::radical::Radical::from(q(witnesses[piece.v[0]][k])) - &points[piece.v[0]][k];
                        let db = wc::radical::Radical::from(q(witnesses[piece.v[1]][k])) - &points[piece.v[1]][k];
                        finite(original[k] + (da * (q(1.) - &t) + db * &t).enclosure()?)
                    }).into_iter().collect::<R<Vec<_>>>()?;
                    ([shifted[0], shifted[1]], i(zs[&self.stack.levels[j]]))
                },
                Key::Ring(t, ri, k) => {
                    let tool = &self.stack.tools[t];
                    let [z, r] = &tool.rings[ri];
                    let n = ring_n[t];
                    let p = if k % n == 0 {
                        // The B-rep vertices at angle 0 and pi, exactly.
                        let x = if k == 0 { &tool.c[0] + r } else { &tool.c[0] - r };
                        [enclose(&x)?, enclose(&tool.c[1])?]
                    } else {
                        let (sin, cos) = crate::mesh_curved::sin_cos(finite(i(k as f64) / i(2. * n as f64))?)?;
                        let (cx, cy, r) = (enclose(&tool.c[0])?, enclose(&tool.c[1])?, enclose(r)?);
                        [finite(cx + r * cos)?, finite(cy + r * sin)?]
                    };
                    (p, i(zs[z]))
                }
            };
            let (w, error) = metric.sample(&self.frame, [p[0], p[1], z])?;
            rounding = rounding.max(finite(i(error) + i(displacement))?.hi());
            source.push([p[0].mid(), p[1].mid(), z.mid()]);
            mesh.vertices.push(w);
            local2.push(p.map(|v| v.mid()));
            index.insert(key, mesh.vertices.len() - 1);
            Ok(mesh.vertices.len() - 1)
        };
        // Samples of a piece at a level (canonical order), or of a tool ring
        // half counter-clockwise from angle half * pi.
        enum Along {
            Piece(usize, usize),
            Ring(usize, usize, usize),
            /// A vertical line at an arrangement vertex between two levels.
            Vertical(usize, [usize; 2]),
            /// A band generator (tool, band, angle / pi), upwards.
            Seam(usize, usize, usize),
        }
        let mut seq = |along: Along, mesh: &mut Mesh, local2: &mut Vec<[f64; 2]>| -> R<Vec<usize>> {
            match along {
                Along::Piece(e, j) => {
                    let piece = &arr.pieces[e];
                    let mut out = vec![id(Key::Vertex(piece.v[0], j), mesh, local2)?];
                    // A line has one span and so no interior samples.
                    for s in 1..counts[e] {
                        out.push(id(Key::Sample(e, s, j), mesh, local2)?);
                    }
                    out.push(id(Key::Vertex(piece.v[1], j), mesh, local2)?);
                    Ok(out)
                }
                Along::Ring(t, ri, half) => {
                    let n = ring_n[t];
                    (0..=n).map(|s| id(Key::Ring(t, ri, (half * n + s) % (2 * n)), mesh, local2)).collect()
                }
                Along::Vertical(v, [lo, hi]) => Ok(vec![
                    id(Key::Vertex(v, lo), mesh, local2)?,
                    id(Key::Vertex(v, hi), mesh, local2)?,
                ]),
                Along::Seam(t, band, angle) => {
                    let n = ring_n[t];
                    let [lo, hi] = self.stack.tools[t].bands[band];
                    let k = (angle * n) % (2 * n);
                    Ok(vec![id(Key::Ring(t, lo, k), mesh, local2)?, id(Key::Ring(t, hi, k), mesh, local2)?])
                }
            }
        };
        // Every triangle carries the WC0 face id it belongs to (brep faces index
        // like the body's faces).
        let push = |mesh: &mut Mesh, face: usize, t: [usize; 3], flip: bool| {
            mesh.triangles.push(if flip != reversed { [t[0], t[2], t[1]] } else { t });
            mesh.faces.push(face as u32);
        };
        let b = &self.body;
        let mut caps = vec![];
        for (f, face) in self.brep.faces.iter().enumerate() {
            let plane_up = match face.kind {
                FaceKind::Cap { up, .. } => Some(up),
                FaceKind::Plate { tool, plate } => Some(self.stack.tools[tool].plates[plate].up),
                _ => None,
            };
            match (face.kind.clone(), plane_up) {
                (_, Some(up)) => {
                    let mut ids = vec![];
                    let mut map = BTreeMap::new();
                    let mut loops = vec![];
                    for lp in &b.faces[f].loops {
                        let mut ring = vec![];
                        for c in &b.loops[lp.0 as usize].coedges {
                            let co = &b.coedges[c.0 as usize];
                            let mut chain = vec![];
                            match &self.brep.edges[co.edge.0 as usize] {
                                EdgeGeom::Horizontal { level, pieces } => {
                                    for &e in pieces {
                                        let s = seq(Along::Piece(e, *level), &mut mesh, &mut local2)?;
                                        if chain.last() == s.first() {
                                            chain.pop();
                                        }
                                        chain.extend(s);
                                    }
                                }
                                EdgeGeom::Ring { tool, ring, half } => {
                                    chain = seq(Along::Ring(*tool, *ring, *half), &mut mesh, &mut local2)?;
                                }
                                _ => return Err(no("cap-edge")),
                            }
                            if !co.forward {
                                chain.reverse();
                            }
                            chain.pop();
                            ring.extend(chain);
                        }
                        if !up {
                            ring.reverse();
                        }
                        let ring = ring
                            .into_iter()
                            .map(|g| {
                                *map.entry(g).or_insert_with(|| {
                                    ids.push(g);
                                    ids.len() - 1
                                })
                            })
                            .collect::<Vec<_>>();
                        loops.push(ring);
                    }
                    caps.push((f, up, ids, loops));
                }
                (FaceKind::Side { left, .. }, None) => {
                    for p in &face.patches {
                        let Patch::Side(e, j) = *p else { continue };
                        let low = seq(Along::Piece(e, j), &mut mesh, &mut local2)?;
                        let high = seq(Along::Piece(e, j + 1), &mut mesh, &mut local2)?;
                        for k in 0..low.len() - 1 {
                            push(&mut mesh, f, [low[k], low[k + 1], high[k + 1]], !left);
                            push(&mut mesh, f, [low[k], high[k + 1], high[k]], !left);
                        }
                    }
                }
                // Material lies outside the ring (right of its CCW direction).
                (FaceKind::Band { tool, band, half }, None) => {
                    let [lo, hi] = self.stack.tools[tool].bands[band];
                    let low = seq(Along::Ring(tool, lo, half), &mut mesh, &mut local2)?;
                    let high = seq(Along::Ring(tool, hi, half), &mut mesh, &mut local2)?;
                    for k in 0..low.len() - 1 {
                        push(&mut mesh, f, [low[k], low[k + 1], high[k + 1]], true);
                        push(&mut mesh, f, [low[k], high[k + 1], high[k]], true);
                    }
                }
                _ => return Err(no("mesh-face-kind")),
            }
        }
        // One polyline per WC0 edge (brep edges index like the body's edges), from
        // the same samples the faces use, so edges and faces meet exactly.
        let mut edges = Vec::with_capacity(self.brep.edges.len());
        for geom in &self.brep.edges {
            let mut chain = match geom {
                EdgeGeom::Horizontal { level, pieces } => {
                    let mut chain: Vec<usize> = vec![];
                    for &e in pieces {
                        let s = seq(Along::Piece(e, *level), &mut mesh, &mut local2)?;
                        if chain.last() == s.first() {
                            chain.pop();
                        }
                        chain.extend(s);
                    }
                    chain
                }
                EdgeGeom::Ring { tool, ring, half } => seq(Along::Ring(*tool, *ring, *half), &mut mesh, &mut local2)?,
                EdgeGeom::Vertical { vertex, span } => seq(Along::Vertical(*vertex, *span), &mut mesh, &mut local2)?,
                EdgeGeom::Seam { tool, band, angle } => seq(Along::Seam(*tool, *band, *angle), &mut mesh, &mut local2)?,
            };
            let closed = chain.len() > 2 && chain.first() == chain.last();
            if closed {
                chain.pop();
            }
            edges.push(MeshEdge { vertices: chain, closed });
        }
        if edges.len() != self.body.edges.len() || mesh.faces.len() != mesh.triangles.len() {
            return Err(no("mesh-attribution"));
        }
        mesh.edges = edges;
        drop(seq);
        drop(id);
        let deviation = metric.deviation(budget, rounding, requested)?;
        let quantization = crate::mesh_boundary::quantization(&mesh.vertices)?;
        // Test every cap before triangulating any: the coarse contour may
        // cross a thin feature even though the authoritative curve does not.
        for (_, _, ids, loops) in &caps {
            let points = ids.iter().map(|&g| local2[g]).collect::<Vec<_>>();
            if metric.separation(&points, loops, deviation, quantization, rounding)?.is_none() {
                return Ok(None);
            }
        }
        for (f, up, ids, loops) in caps {
            let points = ids.iter().map(|&g| mesh.vertices[g]).collect::<Vec<_>>();
            let normal = self.frame.cofactor_exact([0., 0., 1.]).map_err(|_| no("cap-normal-range"))?;
            for t in crate::mesh::triangulate_planar_cap(&points, &loops, &normal)? {
                push(&mut mesh, f, t.map(|k| ids[k]), !up);
            }
        }
        // Caps wait for the certificate, not for their place in the output.
        // Restore the original face traversal order without changing samples
        // or within-face triangulation (stable sort), preserving STL bytes.
        let mut order: Vec<_> = (0..mesh.triangles.len()).collect();
        order.sort_by_key(|&k| mesh.faces[k]);
        mesh.triangles = order.iter().map(|&k| mesh.triangles[k]).collect();
        mesh.faces = order.into_iter().map(|k| mesh.faces[k]).collect();
        let source = Mesh { vertices: source, triangles: mesh.triangles.clone(), ..Default::default() };
        crate::mesh::preserve_shell_orientation(&source, &mesh, reversed)?;
        Ok(Some(mesh))
    }
}
pub(crate) fn append_step(w: &mut crate::cylinder_step::Writer, id: &str, s: &PrismStack) -> R<String> {
    // A stacked side face is a strip between generator lines, or a whole-circle
    // band whose one generator line is its own seam. A generator line between
    // two different faces is a plain edge, and one used twice
    // by a single face is written as its SEAM_CURVE.
    crate::perforated_step::append_boundary(w, id, &s.body, &s.frame, None)
}
