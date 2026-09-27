//! Certified observations of a spherical source-frame B-rep. Affine frames
//! retain the interpreter's binary64 axes, including their non-unit defect.
//! Volume includes the exact determinant; area/distance use singular-value
//! bounds. STEP alone projects these near-isometries onto spherical carriers,
//! with the resulting displacement included in its explicit export budget.
use crate::polyhedron::Refused;
use crate::sphere::{no, Spherical};
use wonky_num::expansion::{self as ex, Exp, Guard};
use wonky_num::{Iv, Scalar};

type R<T> = Result<T, Refused>;
fn p(x: f64) -> Iv {
    Iv::point(x)
}
pub(crate) fn enclosed(e: &[f64]) -> Iv {
    e.iter().fold(p(0.), |s, &x| s + p(x))
}
pub(crate) fn finite(v: Iv) -> R<Iv> {
    if v.is_nan() || !v.lo().is_finite() || !v.hi().is_finite() {
        Err(no("measurement-range"))
    } else {
        Ok(v)
    }
}
fn js(x: f64) -> String {
    format!("{:?}", if x == 0. { 0. } else { x })
}
fn xyz(v: [f64; 3]) -> String {
    format!("[{},{},{}]", js(v[0]), js(v[1]), js(v[2]))
}
pub(crate) fn cross(a: &[Exp; 3], b: &[Exp; 3], g: &mut Guard) -> [Exp; 3] {
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
pub(crate) fn dot(a: &[Exp; 3], b: &[Exp; 3], g: &mut Guard) -> Exp {
    let mut s = vec![];
    for k in 0..3 {
        s = ex::sum(&s, &ex::mul(&a[k], &b[k], g), g);
    }
    s
}
impl Spherical {
    pub(crate) fn exact_columns(&self) -> R<[[Exp; 3]; 3]> {
        let mut g = Guard::new();
        let y = self.frame.y_exact(&mut g);
        if !g.exact() {
            return Err(no("frame-range"));
        }
        Ok([
            self.frame.x.map(|x| vec![x]),
            y,
            self.frame.z.map(|x| vec![x]),
        ])
    }
    /// Gershgorin: all eigenvalues of A^T A lie in [1-d,1+d].
    /// Computed on exact columns (the cross-product column is not rounded).
    pub fn metric_defect(&self) -> R<f64> {
        let c = self.exact_columns()?;
        let mut d = 0.0f64;
        for i in 0..3 {
            let mut row = p(0.);
            for j in 0..3 {
                let mut g = Guard::new();
                let v = dot(&c[i], &c[j], &mut g);
                if !g.exact() {
                    return Err(no("frame-range"));
                }
                row = row + (enclosed(&v) - p(if i == j { 1. } else { 0. })).abs();
            }
            d = d.max(finite(row)?.hi());
        }
        // A spherical STEP projection is not an exact export of a general
        // ellipsoid. Refuse large distortions instead of silently exporting one.
        if d >= 1e-9 {
            return Err(no("non-isometric-export-frame"));
        }
        Ok(d)
    }
    pub fn measures_mm(&self) -> R<(Iv, Iv, Vec<Iv>)> {
        let pi = wonky_validated::pi(1e-14)
            .map_err(|_| no("validated-pi"))?
            .ball();
        let r = p(self.radius) * p(1000.);
        let cut = self.cut.is_some();
        let det = enclosed(&self.frame.det_exact().map_err(|_| no("frame-range"))?);
        let volume = finite(p(if cut { 2. } else { 4. }) * pi * r * r * r / p(3.) * det)?;
        let defect = self.metric_defect()?;
        // Products of any two singular values enclose all area scaling.
        let scale = Iv { m: 1., r: defect };
        let mut faces = vec![finite(p(if cut { 2. } else { 4. }) * pi * r * r * scale)?];
        if cut {
            faces.push(finite(pi * r * r * scale)?);
        }
        let area = finite(faces.iter().fold(p(0.), |s, &a| s + a))?;
        if volume.lo() <= 0.
            || area.lo() <= 0.
            || volume.r / volume.m > 1e-8
            || area.r / area.m > 1e-8
        {
            return Err(no("measurement-width"));
        }
        Ok((volume, area, faces))
    }
    pub fn center_mm(&self) -> R<[f64; 3]> {
        self.frame
            .apply(self.center, 1000., true)
            .map_err(|_| no("measurement-range"))
    }
    pub fn centroid_mm(&self) -> R<[f64; 3]> {
        let center = self
            .frame
            .apply_exact(self.center, 1000., true)
            .map_err(|_| no("measurement-range"))?;
        let cols = self.exact_columns()?;
        let mut result = [0.; 3];
        for k in 0..3 {
            let mut v = enclosed(&center[k]);
            if let Some(c) = self.cut {
                v = v + p(1000.) * p(self.radius) * p(3.) / p(8.)
                    * p(c.sign)
                    * enclosed(&cols[c.axis][k]);
            }
            result[k] = finite(v)?.m;
        }
        Ok(result)
    }
    pub fn bbox_mm(&self, map: Option<[[f64; 4]; 3]>) -> R<([f64; 3], [f64; 3])> {
        let map = map.unwrap_or([[1., 0., 0., 0.], [0., 1., 0., 0.], [0., 0., 1., 0.]]);
        let center = self
            .frame
            .apply_exact(self.center, 1000., true)
            .map_err(|_| no("measurement-range"))?;
        let cols = self.exact_columns()?;
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
            let support = |sign: f64| {
                let mut v = d.map(|v| v * p(sign));
                if let Some(c) = self.cut {
                    v[c.axis] = (v[c.axis] * p(c.sign)).max(p(0.));
                }
                p(1000.) * p(self.radius) * v[0].norm3(v[1], v[2])
            };
            lo[k] = finite(c - support(-1.))?.m;
            hi[k] = finite(c + support(1.))?.m;
        }
        Ok((lo, hi))
    }
    pub fn tolerance_mm(&self) -> R<f64> {
        let mag = self
            .center_mm()?
            .into_iter()
            .fold(0.0f64, |a, b| a.max(b.abs()));
        let r = p(self.radius) * p(1000.);
        // The near-isometry projects onto an orthonormal frame in STEP.
        // 8*d*r bounds its displacement; 64 eps bounds final coordinates,
        // direction normalization, radius and periodic chart endpoints.
        Ok(
            finite(p(8.) * p(self.metric_defect()?) * r + p(64. * f64::EPSILON) * (p(mag) + r))?
                .hi(),
        )
    }
    /// Exact adjugate pullback: q_local = numerator / det. Membership compares
    /// squared expansions before any division or square root (E4/E9).
    pub fn probe_mm(&self, q: [f64; 3]) -> R<(Iv, bool)> {
        if q.iter().any(|x| !x.is_finite()) {
            return Err(no("probe-range"));
        }
        let mut g = Guard::new();
        let cols = self.exact_columns()?;
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
        let radius = ex::product(self.radius, 1000., &mut g);
        let scaled = ex::mul(&radius, &det, &mut g);
        let side = ex::sum(
            &dot(&num, &num, &mut g),
            &ex::neg(&ex::mul(&scaled, &scaled, &mut g)),
            &mut g,
        );
        if !g.exact() || ex::sign(&det) <= 0 {
            return Err(no("probe-range"));
        }
        let half = self
            .cut
            .map(|c| ex::sign(&num[c.axis]) as f64 * c.sign >= 0.)
            .unwrap_or(true);
        let inside = ex::sign(&side) <= 0 && half;
        if inside {
            return Ok((p(0.), true));
        }
        let local = num.map(|e| enclosed(&e) / enclosed(&det));
        let rr = enclosed(&radius);
        let d = if !half {
            let c = self.cut.unwrap();
            let z = local[c.axis];
            let mut tangent = local;
            tangent[c.axis] = p(0.);
            (tangent[0].norm3(tangent[1], tangent[2]) - rr)
                .max(p(0.))
                .norm3(z, p(0.))
        } else {
            local[0].norm3(local[1], local[2]) - rr
        };
        let scale = Iv {
            m: 1.,
            r: self.metric_defect()?,
        }
        .sqrt();
        Ok((finite(d * scale)?, false))
    }
    pub fn measure_json(&self, map: Option<[[f64; 4]; 3]>, probes: &[[f64; 3]]) -> R<String> {
        let (volume, area, faces) = self.measures_mm()?;
        let (lo, hi) = self.bbox_mm(None)?;
        let bbox = |l, h| format!("{{\"min\":{},\"max\":{}}}", xyz(l), xyz(h));
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
        let cut = self.cut.is_some();
        let n = if cut { 2 } else { 1 };
        let e = usize::from(cut);
        let perimeter = if cut {
            finite(
                p(2.)
                    * wonky_validated::pi(1e-14)
                        .map_err(|_| no("validated-pi"))?
                        .ball()
                    * p(self.radius)
                    * p(1000.)
                    * Iv {
                        m: 1.,
                        r: self.metric_defect()?,
                    }
                    .sqrt(),
            )?
            .m
        } else {
            0.
        };
        let vertices = self
            .chart_vertices_mm()?
            .into_iter()
            .map(xyz)
            .collect::<Vec<_>>()
            .join(",");
        let projection = if cut {
            format!("{{\"vertices\":[{}],\"edges\":[[0,0],[0,1]],\"faces\":[[[[0,true],[1,true],[1,false]]],[[[0,false]]]]}}",vertices)
        } else {
            format!(
                "{{\"vertices\":[{}],\"edges\":[[0,1]],\"faces\":[[[[0,true],[0,false]]]]}}",
                vertices
            )
        };
        Ok(format!(concat!("{{\"basis\":\"native-f64-construction\",\"certificate\":\"Spherical\",\"boundToConstruction\":true,",
            "\"volumeMm3\":{},\"volumeRelBound\":{},\"volumeEnclosureMm3\":[{},{}],\"areaMm2\":{},\"areaRelBound\":{},\"areaEnclosureMm2\":[{},{}],",
            "\"faceAreasMm2\":[{}],\"facePerimetersMm\":[{}],\"centroidMm\":{},\"bboxMm\":{},\"mappedBboxMm\":{},",
            "\"topology\":{{\"bodies\":1,\"shells\":1,\"faces\":{},\"edges\":{},\"vertices\":0,\"loops\":{},\"ringEdges\":{},\"closedToroidalFaces\":0,\"genus\":0,\"singularPoints\":0,\"pinchPoints\":0}},",
            "\"validity\":{{\"brep\":true,\"closed\":true,\"positive\":true}},\"toleranceMm\":{},\"frame\":{{\"orthonormalityDefect\":{}}},\"probes\":[{}],\"projection\":{}}}"),
            js(volume.m),js((volume.r/volume.m).next_up()),js(volume.lo()),js(volume.hi()),js(area.m),js((area.r/area.m).next_up()),js(area.lo()),js(area.hi()),
            faces.iter().map(|a|js(a.m)).collect::<Vec<_>>().join(","),vec![js(perimeter);n].join(","),xyz(self.centroid_mm()?),bbox(lo,hi),mapped,n,e,2*e,e,js(self.tolerance_mm()?),js(self.metric_defect()?),probe.join(","),projection))
    }
}
