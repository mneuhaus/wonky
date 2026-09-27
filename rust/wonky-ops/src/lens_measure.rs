//! Validated lens observations. Membership is decided before metric rounding;
//! support and closest-point alternatives are enclosed through interval ties.
use crate::{
    lens::{no, Lens},
    polyhedron::Refused,
    sphere_measure::{cross, dot, enclosed, finite},
};
use wonky_num::{
    expansion::{self as ex, Exp, Guard},
    Iv, Scalar,
};
type R<T> = Result<T, Refused>;
fn p(x: f64) -> Iv {
    Iv::point(x)
}
fn hull(a: Iv, b: Iv) -> Iv {
    Iv {
        m: a.m,
        r: a.r.max(((a.m - b.m).abs().next_up() + b.r).next_up()),
    }
}
fn js(x: f64) -> String {
    format!("{:?}", if x == 0. { 0. } else { x })
}
fn xyz(a: [f64; 3]) -> String {
    format!("[{},{},{}]", js(a[0]), js(a[1]), js(a[2]))
}
impl Lens {
    pub(crate) fn ring(&self) -> R<Iv> {
        let square = (p(self.radius) - p(self.half)) * (p(self.radius) + p(self.half));
        if square.lo() <= 0. {
            return Err(no("radical-enclosure-width"));
        }
        finite(square.sqrt())
    }
    pub fn measures_mm(&self) -> R<(Iv, Iv, Vec<Iv>)> {
        let pi = wonky_validated::pi(1e-14)
            .map_err(|_| no("validated-pi"))?
            .ball();
        let r = p(self.radius) * p(1000.);
        let h = (p(self.radius) - p(self.half)) * p(1000.);
        let det = enclosed(&self.frame.det_exact().map_err(|_| no("frame-range"))?);
        let volume = finite(p(2.) * pi * h * h * (p(3.) * r - h) / p(3.) * det)?;
        let face = finite(
            p(2.)
                * pi
                * r
                * h
                * Iv {
                    m: 1.,
                    r: self.metric().metric_defect()?,
                },
        )?;
        let area = finite(p(2.) * face)?;
        if volume.lo() <= 0.
            || area.lo() <= 0.
            || volume.r / volume.m > 1e-8
            || area.r / area.m > 1e-8
        {
            return Err(no("measurement-width"));
        }
        Ok((volume, area, vec![face; 2]))
    }
    pub fn bbox_mm(&self, map: Option<[[f64; 4]; 3]>) -> R<([f64; 3], [f64; 3])> {
        let map = map.unwrap_or([[1., 0., 0., 0.], [0., 1., 0., 0.], [0., 0., 1., 0.]]);
        let center = self
            .frame
            .apply_exact(self.center, 1000., true)
            .map_err(|_| no("frame-range"))?;
        let cols = self.metric().exact_columns()?;
        let ring = self.ring()?;
        let mut lo = [0.; 3];
        let mut hi = [0.; 3];
        for k in 0..3 {
            let mut c = p(map[k][3]);
            let mut d = [p(0.); 3];
            for j in 0..3 {
                c = c + p(map[k][j]) * enclosed(&center[j]);
                for a in 0..3 {
                    d[a] = d[a] + p(map[k][j]) * enclosed(&cols[a][j]);
                }
            }
            let axial = d[self.axis].abs();
            d[self.axis] = p(0.);
            let radial = d[0].norm3(d[1], d[2]);
            let norm = axial.norm3(radial, p(0.));
            let test = p(self.radius) * axial - p(self.half) * norm;
            let cap = p(self.radius) * norm - p(self.half) * axial;
            let rim = ring * radial;
            let support = if test.lo() >= 0. {
                cap
            } else if test.hi() < 0. {
                rim
            } else {
                hull(cap, rim)
            } * p(1000.);
            lo[k] = finite(c - support)?.m;
            hi[k] = finite(c + support)?.m;
        }
        Ok((lo, hi))
    }
    pub fn probe_mm(&self, q: [f64; 3]) -> R<(Iv, bool)> {
        if q.iter().any(|x| !x.is_finite()) {
            return Err(no("probe-range"));
        }
        let cols = self.metric().exact_columns()?;
        let center = self
            .frame
            .apply_exact(self.center, 1000., true)
            .map_err(|_| no("probe-range"))?;
        let mut g = Guard::new();
        let delta = std::array::from_fn(|k| ex::sum(&[q[k]], &ex::neg(&center[k]), &mut g));
        let adj = [
            cross(&cols[1], &cols[2], &mut g),
            cross(&cols[2], &cols[0], &mut g),
            cross(&cols[0], &cols[1], &mut g),
        ];
        let num: [Exp; 3] = std::array::from_fn(|k| dot(&adj[k], &delta, &mut g));
        let det = dot(&cols[0], &adj[0], &mut g);
        let scale = |a, g: &mut Guard| ex::mul(&ex::product(a, 1000., g), &det, g);
        let r = scale(self.radius, &mut g);
        let h = scale(self.half, &mut g);
        let mut inside = true;
        for sign in [-1., 1.] {
            let mut n = num.clone();
            n[self.axis] = ex::sum(&n[self.axis], &ex::mul(&[sign], &h, &mut g), &mut g);
            let side = ex::sum(
                &dot(&n, &n, &mut g),
                &ex::neg(&ex::mul(&r, &r, &mut g)),
                &mut g,
            );
            inside &= ex::sign(&side) <= 0;
        }
        if !g.exact() || ex::sign(&det) <= 0 {
            return Err(no("probe-range"));
        }
        if inside {
            return Ok((p(0.), true));
        }
        let mut local = num.map(|e| enclosed(&e) / enclosed(&det));
        let z = local[self.axis].abs();
        local[self.axis] = p(0.);
        let rho = local[0].norm3(local[1], local[2]);
        let r = p(self.radius) * p(1000.);
        let h = p(self.half) * p(1000.);
        let norm = rho.norm3(z + h, p(0.));
        let test = r * (z + h) - h * norm;
        let cap = norm - r;
        let rim = (rho - self.ring()? * p(1000.)).norm3(z, p(0.));
        let d = if test.lo() >= 0. {
            cap
        } else if test.hi() < 0. {
            rim
        } else {
            hull(cap, rim)
        };
        Ok((
            finite(
                d * Iv {
                    m: 1.,
                    r: self.metric().metric_defect()?,
                }
                .sqrt(),
            )?,
            false,
        ))
    }
    pub(crate) fn chart_vertices_mm(&self) -> R<Vec<[f64; 3]>> {
        let ring = self.ring()?;
        let mut out = Vec::new();
        for i in 0..3 {
            let mut point = self.center.map(p);
            if i == 0 {
                point[(self.axis + 1) % 3] = point[(self.axis + 1) % 3] + ring;
            } else {
                point[self.axis] = point[self.axis]
                    + p(if i == 1 { 1. } else { -1. }) * (p(self.radius) - p(self.half));
            }
            let cols = self.metric().exact_columns()?;
            let mut world = [0.; 3];
            for k in 0..3 {
                let mut value = p(self.frame.origin[k]);
                for j in 0..3 {
                    value = value + point[j] * enclosed(&cols[j][k]);
                }
                let value = finite(value * p(1000.))?;
                if value.r > self.tolerance_mm()? {
                    return Err(no("vertex-export-budget"));
                }
                world[k] = value.m;
            }
            out.push(world);
        }
        Ok(out)
    }
    pub fn tolerance_mm(&self) -> R<f64> {
        Ok(finite(p(self.metric().tolerance_mm()?) + p(8.) * p(self.ring()?.r) * p(1000.))?.hi())
    }
    pub fn measure_json(&self, map: Option<[[f64; 4]; 3]>, probes: &[[f64; 3]]) -> R<String> {
        let (volume, area, faces) = self.measures_mm()?;
        let bbox = |l, h| format!("{{\"min\":{},\"max\":{}}}", xyz(l), xyz(h));
        let (lo, hi) = self.bbox_mm(None)?;
        let mapped = if let Some(m) = map {
            let (l, h) = self.bbox_mm(Some(m))?;
            bbox(l, h)
        } else {
            "null".into()
        };
        let probes = probes
            .iter()
            .map(|&q| {
                let (d, inside) = self.probe_mm(q)?;
                Ok(format!(
                    "{{\"distanceMm\":{},\"inside\":{inside},\"boundMm\":{}}}",
                    js(d.m),
                    js(d.r)
                ))
            })
            .collect::<R<Vec<_>>>()?;
        let perimeter = finite(
            p(2.)
                * wonky_validated::pi(1e-14)
                    .map_err(|_| no("validated-pi"))?
                    .ball()
                * self.ring()?
                * p(1000.)
                * Iv {
                    m: 1.,
                    r: self.metric().metric_defect()?,
                }
                .sqrt(),
        )?
        .m;
        let vertices = self
            .chart_vertices_mm()?
            .into_iter()
            .map(xyz)
            .collect::<Vec<_>>()
            .join(",");
        let projection = format!("{{\"vertices\":[{vertices}],\"edges\":[[0,0],[0,1],[2,0]],\"faces\":[[[[0,true],[1,true],[1,false]]],[[[0,false],[2,false],[2,true]]]]}}");
        Ok(format!(concat!("{{\"basis\":\"native-f64-construction\",\"certificate\":\"Lens\",\"boundToConstruction\":true,",
            "\"volumeMm3\":{},\"volumeRelBound\":{},\"volumeEnclosureMm3\":[{},{}],\"areaMm2\":{},\"areaRelBound\":{},\"areaEnclosureMm2\":[{},{}],",
            "\"faceAreasMm2\":[{}],\"facePerimetersMm\":[{},{}],\"centroidMm\":{},\"bboxMm\":{},\"mappedBboxMm\":{},",
            "\"topology\":{{\"bodies\":1,\"shells\":1,\"faces\":2,\"edges\":1,\"vertices\":0,\"loops\":2,\"ringEdges\":1,\"closedToroidalFaces\":0,\"genus\":0,\"singularPoints\":0,\"pinchPoints\":0}},",
            "\"validity\":{{\"brep\":true,\"closed\":true,\"positive\":true}},\"toleranceMm\":{},\"frame\":{{\"orthonormalityDefect\":{}}},\"probes\":[{}],\"projection\":{}}}"),
            js(volume.m),js((volume.r/volume.m).next_up()),js(volume.lo()),js(volume.hi()),js(area.m),js((area.r/area.m).next_up()),js(area.lo()),js(area.hi()),
            faces.iter().map(|a|js(a.m)).collect::<Vec<_>>().join(","),js(perimeter),js(perimeter),xyz(self.metric().center_mm()?),bbox(lo,hi),mapped,js(self.tolerance_mm()?),js(self.metric().metric_defect()?),probes.join(","),projection))
    }
}
