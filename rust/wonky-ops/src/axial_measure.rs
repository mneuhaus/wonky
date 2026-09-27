//! Closed-form enclosures and exact containment for audited axial solids.
use crate::{
    axial::{no, Axial, R},
    sphere_measure::{enclosed, finite},
};
use wonky_num::{
    expansion::{self as ex, Exp, Guard},
    Iv, Scalar,
};
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
fn xyz(v: [f64; 3]) -> String {
    format!("[{},{},{}]", js(v[0]), js(v[1]), js(v[2]))
}
fn dot(a: &[Exp; 3], b: &[Exp; 3], g: &mut Guard) -> Exp {
    (0..3).fold(vec![], |s, k| ex::sum(&s, &ex::mul(&a[k], &b[k], g), g))
}
fn cross(a: &[Exp; 3], b: &[Exp; 3], g: &mut Guard) -> [Exp; 3] {
    std::array::from_fn(|i| {
        let j = (i + 1) % 3;
        let k = (i + 2) % 3;
        ex::sum(
            &ex::mul(&a[j], &b[k], g),
            &ex::neg(&ex::mul(&a[k], &b[j], g)),
            g,
        )
    })
}
impl Axial {
    pub fn measures_mm(&self) -> R<(Iv, Iv, Vec<Iv>)> {
        let pi = wonky_validated::pi(1e-14)
            .map_err(|_| no("validated-pi"))?
            .ball();
        let r = p(self.radius) * p(1000.);
        let h = (p(self.levels[1]) - p(self.levels[0])) * p(1000.);
        let metric = self.metric();
        let det = enclosed(&self.frame.det_exact().map_err(|_| no("frame-range"))?);
        let scale = Iv {
            m: 1.,
            r: metric.metric_defect()?,
        };
        let (volume, faces) = if let Some(outer) = self.outer {
            (
                pi * h * h * h / p(6.) * det,
                vec![
                    p(2.) * pi * r * h * scale,
                    p(2.) * pi * p(outer) * p(1000.) * h * scale,
                ],
            )
        } else {
            (
                pi * r * r * h * det,
                vec![
                    p(2.) * pi * r * h * scale,
                    pi * r * r * scale,
                    pi * r * r * scale,
                ],
            )
        };
        let volume = finite(volume)?;
        let area = finite(faces.iter().fold(p(0.), |s, &x| s + x))?;
        if volume.lo() <= 0.
            || area.lo() <= 0.
            || volume.r / volume.m > 1e-8
            || area.r / area.m > 1e-8
        {
            return Err(no("measurement-width"));
        }
        Ok((volume, area, faces))
    }
    pub fn bbox_mm(&self, map: Option<[[f64; 4]; 3]>) -> R<([f64; 3], [f64; 3])> {
        let map = map.unwrap_or([[1., 0., 0., 0.], [0., 1., 0., 0.], [0., 0., 1., 0.]]);
        let center = self
            .frame
            .apply_exact(self.center, 1000., true)
            .map_err(|_| no("frame-range"))?;
        let cols = self.metric().exact_columns()?;
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
            let radial = d[0].norm3(d[1], p(0.));
            let z = d[2];
            let support = |sign: f64| -> R<Iv> {
                let z = z * p(sign);
                if let Some(r) = self.outer {
                    let norm = radial.norm3(z, p(0.));
                    let full = p(r) * norm;
                    let rim = p(self.radius) * radial + p(self.levels[1]) * z.abs();
                    let test = p(r) * z.abs() - p(self.levels[1]) * norm;
                    // This branch only encloses a metric value; topology was
                    // already decided exactly from the construction in axial.
                    let value = if test.hi() <= 0. {
                        full
                    } else if test.lo() >= 0. {
                        rim
                    } else {
                        hull(full, rim)
                    };
                    finite(p(1000.) * value)
                } else {
                    finite(
                        p(1000.)
                            * (p(self.radius) * radial
                                + (z * p(self.levels[0])).max(z * p(self.levels[1]))),
                    )
                }
            };
            lo[k] = finite(c - support(-1.)?)?.m;
            hi[k] = finite(c + support(1.)?)?.m;
        }
        Ok((lo, hi))
    }
    pub fn probe_mm(&self, q: [f64; 3]) -> R<(Iv, bool)> {
        if q.iter().any(|x| !x.is_finite()) {
            return Err(no("probe-range"));
        }
        let mut g = Guard::new();
        let cols = self.metric().exact_columns()?;
        let center = self
            .frame
            .apply_exact(self.center, 1000., true)
            .map_err(|_| no("probe-range"))?;
        let delta = std::array::from_fn(|k| ex::sum(&[q[k]], &ex::neg(&center[k]), &mut g));
        let adj = [
            cross(&cols[1], &cols[2], &mut g),
            cross(&cols[2], &cols[0], &mut g),
            cross(&cols[0], &cols[1], &mut g),
        ];
        let num: [Exp; 3] = std::array::from_fn(|k| dot(&adj[k], &delta, &mut g));
        let det = dot(&cols[0], &adj[0], &mut g);
        let scale = |a: f64, g: &mut Guard| ex::mul(&ex::product(a, 1000., g), &det, g);
        let radial = ex::sum(
            &ex::mul(&num[0], &num[0], &mut g),
            &ex::mul(&num[1], &num[1], &mut g),
            &mut g,
        );
        let radius = scale(self.radius, &mut g);
        let radial_side = ex::sum(
            &radial,
            &ex::neg(&ex::mul(&radius, &radius, &mut g)),
            &mut g,
        );
        let inside = if let Some(r) = self.outer {
            let r = scale(r, &mut g);
            let sphere_side = ex::sum(
                &dot(&num, &num, &mut g),
                &ex::neg(&ex::mul(&r, &r, &mut g)),
                &mut g,
            );
            ex::sign(&sphere_side) <= 0 && ex::sign(&radial_side) >= 0
        } else {
            let lower = ex::sum(&num[2], &ex::neg(&scale(self.levels[0], &mut g)), &mut g);
            let upper = ex::sum(&num[2], &ex::neg(&scale(self.levels[1], &mut g)), &mut g);
            ex::sign(&radial_side) <= 0 && ex::sign(&lower) >= 0 && ex::sign(&upper) <= 0
        };
        if !g.exact() || ex::sign(&det) <= 0 {
            return Err(no("probe-range"));
        }
        if inside {
            return Ok((p(0.), true));
        }
        let local = num.map(|e| enclosed(&e) / enclosed(&det));
        let rho = local[0].norm3(local[1], p(0.));
        let z = local[2];
        let r = p(self.radius) * p(1000.);
        let distance = if let Some(outer) = self.outer {
            let h = p(self.levels[1]) * p(1000.);
            let big = p(outer) * p(1000.);
            let norm = rho.norm3(z, p(0.));
            let cylinder = (rho - r).norm3((z.abs() - h).max(p(0.)), p(0.));
            let rim = (rho - r).norm3(z.abs() - h, p(0.));
            let test = rho * big - r * norm;
            let sphere = if test.lo() >= 0. {
                (norm - big).abs()
            } else if test.hi() < 0. {
                rim
            } else {
                hull((norm - big).abs(), rim)
            };
            cylinder.min(sphere)
        } else {
            (rho - r).max(p(0.)).norm3(
                (p(self.levels[0]) * p(1000.) - z)
                    .max(z - p(self.levels[1]) * p(1000.))
                    .max(p(0.)),
                p(0.),
            )
        };
        Ok((
            finite(
                distance
                    * Iv {
                        m: 1.,
                        r: self.metric().metric_defect()?,
                    }
                    .sqrt(),
            )?,
            false,
        ))
    }
    pub fn measure_json(&self, map: Option<[[f64; 4]; 3]>, probes: &[[f64; 3]]) -> R<String> {
        let metric = self.metric();
        let (volume, area, faces) = self.measures_mm()?;
        let bbox = |l, h| format!("{{\"min\":{},\"max\":{}}}", xyz(l), xyz(h));
        let (lo, hi) = self.bbox_mm(None)?;
        let mapped = if let Some(m) = map {
            let (l, h) = self.bbox_mm(Some(m))?;
            bbox(l, h)
        } else {
            "null".into()
        };
        let probe = probes
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
        let mut local = self.center;
        local[2] = crate::axial::exact_add(local[2], (self.levels[0] + self.levels[1]) * 0.5)?;
        let centroid = self
            .frame
            .apply(local, 1000., true)
            .map_err(|_| no("centroid-range"))?;
        let circumference = finite(
            p(2.)
                * wonky_validated::pi(1e-14)
                    .map_err(|_| no("validated-pi"))?
                    .ball()
                * p(self.radius)
                * p(1000.)
                * Iv {
                    m: 1.,
                    r: metric.metric_defect()?,
                }
                .sqrt(),
        )?
        .m;
        let perimeters = if self.outer.is_some() {
            vec![2. * circumference; 2]
        } else {
            vec![2. * circumference, circumference, circumference]
        };
        let vertices = self
            .chart_vertices_mm()?
            .into_iter()
            .map(xyz)
            .collect::<Vec<_>>()
            .join(",");
        let projection = if self.outer.is_some() {
            format!("{{\"vertices\":[{vertices}],\"edges\":[[0,0],[1,1],[0,1],[0,1]],\"faces\":[[[[0,false],[2,true],[1,true],[2,false]]],[[[0,true],[3,true],[1,false],[3,false]]]]}}")
        } else {
            format!("{{\"vertices\":[{vertices}],\"edges\":[[0,0],[1,1],[0,1]],\"faces\":[[[[0,true],[2,true],[1,false],[2,false]]],[[[0,false]]],[[[1,true]]]]}}")
        };
        Ok(format!(concat!("{{\"basis\":\"native-f64-construction\",\"certificate\":\"Axial\",\"boundToConstruction\":true,",
            "\"volumeMm3\":{},\"volumeRelBound\":{},\"volumeEnclosureMm3\":[{},{}],\"areaMm2\":{},\"areaRelBound\":{},\"areaEnclosureMm2\":[{},{}],",
            "\"faceAreasMm2\":[{}],\"facePerimetersMm\":[{}],\"centroidMm\":{},\"bboxMm\":{},\"mappedBboxMm\":{},",
            "\"topology\":{{\"bodies\":1,\"shells\":1,\"faces\":{},\"edges\":2,\"vertices\":0,\"loops\":4,\"ringEdges\":2,\"closedToroidalFaces\":0,\"genus\":{},\"singularPoints\":0,\"pinchPoints\":0}},",
            "\"validity\":{{\"brep\":true,\"closed\":true,\"positive\":true}},\"toleranceMm\":{},\"frame\":{{\"orthonormalityDefect\":{}}},\"probes\":[{}],\"projection\":{}}}"),
            js(volume.m),js((volume.r/volume.m).next_up()),js(volume.lo()),js(volume.hi()),js(area.m),js((area.r/area.m).next_up()),js(area.lo()),js(area.hi()),
            faces.iter().map(|a|js(a.m)).collect::<Vec<_>>().join(","),perimeters.into_iter().map(js).collect::<Vec<_>>().join(","),xyz(centroid),bbox(lo,hi),mapped,faces.len(),usize::from(self.outer.is_some()),js(metric.tolerance_mm()?),js(metric.metric_defect()?),probe.join(","),projection))
    }
}
