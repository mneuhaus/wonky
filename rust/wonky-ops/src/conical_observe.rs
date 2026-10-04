//! Native axial-band integrals, support extrema and exact solid membership.
//! Only observation rounds; membership uses rational pullback and squared radii.
use crate::{
    arc_profile::{enclose, finite},
    chamfer_rim::{no, q, Conical, R},
    cylinder::enclosed,
    source_frame::{self, SourceMetric},
};
use num_rational::BigRational as Q;
use num_traits::Zero;
use wonky_num::{Iv, Scalar};
impl Conical {
    fn moments(&self) -> (Q, Q) {
        let mut volume = Q::zero();
        let mut moment = Q::zero();
        for p in self.rings.windows(2) {
            let h = q(p[1].z) - q(p[0].z);
            let a = q(p[0].r);
            let d = q(p[1].r) - &a;
            let s = &a * &a + &a * &d + &d * &d / q(3.);
            let v = &h * &s;
            moment += q(p[0].z) * &v
                + &h * &h * (&a * &a / q(2.) + q(2.) * &a * &d / q(3.) + &d * &d / q(4.));
            volume += v;
        }
        (volume, moment)
    }
    pub fn measures_mm(&self) -> R<(Iv, Iv)> {
        let metric = SourceMetric::new(&self.frame)?;
        let volume = metric.volume(finite(
            enclose(&self.moments().0)? * crate::analytic_pi::pi() * Iv::point(1e9),
        )?)?;
        let area = self
            .face_measures()?
            .0
            .into_iter()
            .fold(Iv::point(0.), |a, b| a + b);
        if volume.lo() <= 0. || volume.r / volume.m > 1e-9 || area.r / area.m > 1e-9 {
            return Err(no("observation-width"));
        }
        Ok((volume, finite(area)?))
    }
    pub fn centroid_mm(&self) -> R<[f64; 3]> {
        let (vol, moment) = self.moments();
        let axial = enclose(&(moment / vol))?;
        let k = self.source.axis()?;
        let origin = self
            .frame
            .apply_exact(self.center(0.), 1000., true)
            .map_err(|_| no("centroid-range"))?;
        let cols = self.frame.enclosed_columns();
        let mut p = [0.; 3];
        for i in 0..3 {
            p[i] = finite(enclosed(&origin[i]) + cols[k][i] * axial * Iv::point(1000.))?.m;
        }
        Ok(p)
    }
    pub fn bbox_mm(&self, map: Option<[[f64; 4]; 3]>) -> R<([f64; 3], [f64; 3])> {
        let rows = map.unwrap_or([[1., 0., 0., 0.], [0., 1., 0., 0.], [0., 0., 1., 0.]]);
        if rows.iter().flatten().any(|v| !v.is_finite()) {
            return Err(no("bbox-map"));
        }
        let k = self.source.axis()?;
        let cols = self.frame.enclosed_columns();
        let mut lo = [f64::INFINITY; 3];
        let mut hi = [f64::NEG_INFINITY; 3];
        for ring in &self.rings {
            let center = self
                .frame
                .apply_exact(self.center(ring.z), 1000., true)
                .map_err(|_| no("bbox-frame"))?;
            for i in 0..3 {
                let mut p = Iv::point(rows[i][3]);
                let mut d = [Iv::point(0.); 3];
                for j in 0..3 {
                    let a = Iv::point(rows[i][j]);
                    p = p + a * enclosed(&center[j]);
                    for l in 0..3 {
                        d[l] = d[l] + a * cols[l][j];
                    }
                }
                let e = d[(k + 1) % 3].norm3(d[(k + 2) % 3], Iv::point(0.))
                    * Iv::point(ring.r)
                    * Iv::point(1000.);
                lo[i] = lo[i].min(finite(p - e)?.m);
                hi[i] = hi[i].max(finite(p + e)?.m);
            }
        }
        Ok((lo, hi))
    }
    pub fn tolerance_mm(&self) -> R<f64> {
        let (lo, hi) = self.bbox_mm(None)?;
        let mag = lo.into_iter().chain(hi).fold(0_f64, |a, b| a.max(b.abs()));
        let k = self.source.axis()?;
        let reach = finite(
            (Iv::point(self.source.radius) + Iv::point(self.source.top[k])
                - Iv::point(self.source.bottom[k]))
                * Iv::point(1000.),
        )?
        .hi();
        SourceMetric::new(&self.frame)?.export_budget(reach, mag)
    }
    fn face_measures(&self) -> R<(Vec<Iv>, Vec<Iv>)> {
        let metric = SourceMetric::new(&self.frame)?;
        let pi = crate::analytic_pi::pi();
        let tau = pi * Iv::point(2.);
        let mut areas = vec![];
        let mut perimeters = vec![];
        for ring in [&self.rings[0], self.rings.last().unwrap()] {
            let r = Iv::point(ring.r) * Iv::point(1000.);
            areas.push(metric.area(pi * r * r)?);
            perimeters.push(metric.length(tau * r)?);
        }
        for p in self.rings.windows(2) {
            let a = Iv::point(p[0].r) * Iv::point(1000.);
            let b = Iv::point(p[1].r) * Iv::point(1000.);
            let h = (Iv::point(p[1].z) - Iv::point(p[0].z)) * Iv::point(1000.);
            let slant = h.norm3(b - a, Iv::point(0.));
            areas.push(metric.area(pi * (a + b) * slant)?);
            perimeters.push(metric.length(tau * (a + b) + Iv::point(2.) * slant)?);
        }
        Ok((areas, perimeters))
    }
    pub fn probe(&self, point_mm: [f64; 3]) -> R<(f64, bool, f64)> {
        let p = source_frame::inverse(&self.frame, point_mm, 1000.)?;
        let k = self.source.axis()?;
        let u = &p[(k + 1) % 3] - q(self.source.bottom[(k + 1) % 3]);
        let v = &p[(k + 2) % 3] - q(self.source.bottom[(k + 2) % 3]);
        let r2 = &u * &u + &v * &v;
        for pair in self.rings.windows(2) {
            if p[k] >= q(pair[0].z) && p[k] <= q(pair[1].z) {
                let r = q(pair[0].r)
                    + (&p[k] - q(pair[0].z)) * (q(pair[1].r) - q(pair[0].r))
                        / (q(pair[1].z) - q(pair[0].z));
                if r2 <= &r * &r {
                    return Ok((0., true, 0.));
                }
            }
        }
        let radial = finite(enclose(&u)?.norm3(enclose(&v)?, Iv::point(0.)))?;
        let height = enclose(&p[k])?;
        // Distance to the meridian's segments equals distance to the revolved
        // solid. Interval clamping encloses endpoint transitions, never guesses.
        let segment = |a: [f64; 2], b: [f64; 2]| -> R<Iv> {
            let dx = Iv::point(b[0]) - Iv::point(a[0]);
            let dz = Iv::point(b[1]) - Iv::point(a[1]);
            let x = radial - Iv::point(a[0]);
            let z = height - Iv::point(a[1]);
            let t = ((x * dx + z * dz) / (dx * dx + dz * dz))
                .max(Iv::point(0.))
                .min(Iv::point(1.));
            finite((x - t * dx).norm3(z - t * dz, Iv::point(0.)))
        };
        let mut distance = segment([0., self.rings[0].z], [self.rings[0].r, self.rings[0].z])?;
        let top = self.rings.last().unwrap();
        distance = distance.min(segment([0., top.z], [top.r, top.z])?);
        for pair in self.rings.windows(2) {
            distance = distance.min(segment([pair[0].r, pair[0].z], [pair[1].r, pair[1].z])?);
        }
        let d = SourceMetric::new(&self.frame)?.length(distance * Iv::point(1000.))?;
        Ok((d.m, false, d.r))
    }
    pub fn measure_json(&self, map: Option<[[f64; 4]; 3]>, probes: &[[f64; 3]]) -> R<String> {
        let (volume, area) = self.measures_mm()?;
        let c = self.centroid_mm()?;
        let (lo, hi) = self.bbox_mm(None)?;
        let n = self.rings.len();
        let mapped = if let Some(m) = map {
            let (l, h) = self.bbox_mm(Some(m))?;
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
        let (areas, perimeters) = self.face_measures()?;
        let areas = areas.iter().map(|x| x.m).collect::<Vec<_>>();
        let perimeters = perimeters.iter().map(|x| x.m).collect::<Vec<_>>();
        let vertices = crate::cylinder_chart::vertices_mm(&self.body, &self.frame)?;
        let edges = self
            .body
            .edges
            .iter()
            .map(|e| format!("[{},{}]", e.vertices[0].0, e.vertices[1].0))
            .collect::<Vec<_>>()
            .join(",");
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
                                .map(|co| {
                                    let co = &self.body.coedges[co.0 as usize];
                                    format!("[{},{}]", co.edge.0, co.forward)
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
        Ok(format!(concat!("{{\"basis\":\"native-f64-construction\",\"certificate\":\"ConicalRim\",\"boundToConstruction\":true,",
            "\"volumeMm3\":{:?},\"volumeRelBound\":{:?},\"areaMm2\":{:?},\"areaRelBound\":{:?},\"centroidMm\":{c:?},",
            "\"bboxMm\":{{\"min\":{lo:?},\"max\":{hi:?}}},\"mappedBboxMm\":{mapped},",
            "\"topology\":{{\"bodies\":1,\"shells\":1,\"faces\":{},\"edges\":{n},\"vertices\":0,\"loops\":{},\"ringEdges\":{n},\"closedToroidalFaces\":0,\"genus\":0,\"singularPoints\":0,\"pinchPoints\":0}},",
            "\"validity\":{{\"brep\":true,\"closed\":true,\"positive\":true}},\"toleranceMm\":{:?},\"probes\":[{probes}],",
            "\"faceAreasMm2\":{areas:?},\"facePerimetersMm\":{perimeters:?},\"projection\":{{\"vertices\":{vertices:?},\"edges\":[{edges}],\"faces\":[{faces}]}}}}"),volume.m,volume.r/volume.m,area.m,area.r/area.m,n+1,2*n,self.tolerance_mm()?,c=c,lo=lo,hi=hi,mapped=mapped,n=n,probes=probes,areas=areas,perimeters=perimeters,vertices=vertices,edges=edges,faces=faces))
    }
}
