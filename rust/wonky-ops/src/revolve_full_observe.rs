//! Bounded observations of exact polygon revolutions; no tessellation.
use crate::revolve_full::{local, no, FullRevolve, R};
use crate::sphere_measure::{cross, dot, enclosed, finite};
use wonky_contract::SurfaceGeometry;
use num_rational::BigRational as Q;
use wonky_num::expansion::{self as ex, Exp, Guard};
use wonky_num::{Iv, Scalar};
fn p(v: f64) -> Iv {
    Iv::point(v)
}
fn js(v: f64) -> String {
    format!("{:?}", if v == 0. { 0. } else { v })
}
fn xyz(v: [f64; 3]) -> String {
    format!("[{},{},{}]", js(v[0]), js(v[1]), js(v[2]))
}
impl FullRevolve {
    pub(crate) fn metric(&self) -> crate::sphere::Spherical {
        let reach = self
            .points
            .iter()
            .map(|v| v[0] + v[1].abs())
            .fold(0., f64::max);
        crate::sphere::Spherical {
            body: self.body.clone(),
            frame: self.frame,
            center: [0.; 3],
            radius: reach,
            cut: None,
        }
    }
    pub fn tolerance_mm(&self) -> R<f64> {
        self.metric().tolerance_mm()
    }
    /// Signed frusta, equivalent to the radial Green moment of the polygon.
    /// The axial first moment is the exact integral of z*r^2 along each edge.
    pub fn measures(&self) -> R<(Iv, Iv, Vec<Iv>, Iv)> {
        let pi = wonky_validated::pi(1e-14)
            .map_err(|_| no("validated-pi"))?
            .ball();
        let (mut v, mut moment) = (p(0.), p(0.));
        let mut areas = vec![];
        let defect = self.metric().metric_defect()?;
        for i in 0..self.points.len() {
            let a = self.points[i].map(|v| p(v) * p(1000.));
            let b = self.points[(i + 1) % self.points.len()].map(|v| p(v) * p(1000.));
            let (dr, dz) = (b[0] - a[0], b[1] - a[1]);
            v = v + dz * (a[0] * a[0] + a[0] * b[0] + b[0] * b[0]) / p(3.);
            moment = moment
                + dz * (a[0] * a[0] * (p(3.) * a[1] + b[1])
                    + p(2.) * a[0] * b[0] * (a[1] + b[1])
                    + b[0] * b[0] * (a[1] + p(3.) * b[1]))
                    / p(12.);
            if self.points[i][0] != 0. || self.points[(i + 1) % self.points.len()][0] != 0. {
                areas.push(finite(
                    pi * (a[0] + b[0]) * dr.norm3(dz, p(0.)) * Iv { m: 1., r: defect },
                )?);
            }
        }
        let height = finite(moment / v)?;
        let volume =
            finite(pi * v * enclosed(&self.frame.det_exact().map_err(|_| no("frame-range"))?))?;
        let area = finite(areas.iter().fold(p(0.), |a, &b| a + b))?;
        if volume.lo() <= 0.
            || area.lo() <= 0.
            || volume.r / volume.m > 1e-9
            || area.r / area.m > 1e-9
        {
            return Err(no("measurement-width"));
        }
        Ok((volume, area, areas, height))
    }
    pub fn bbox(&self, map: Option<[[f64; 4]; 3]>) -> R<([f64; 3], [f64; 3])> {
        let map = map.unwrap_or([[1., 0., 0., 0.], [0., 1., 0., 0.], [0., 0., 1., 0.]]);
        if map.iter().flatten().any(|v| !v.is_finite()) {
            return Err(no("observation-map-range"));
        }
        let cols = self.metric().exact_columns()?;
        let directions = [
            local(self.mode, 1., 0., 0.),
            local(self.mode, 0., 1., 0.),
            local(self.mode, 0., 0., 1.),
        ];
        let mut lo = [0.; 3];
        let mut hi = [0.; 3];
        for k in 0..3 {
            let mut o = p(map[k][3]);
            let mut d = [p(0.); 3];
            for j in 0..3 {
                o = o + p(map[k][j]) * p(self.frame.origin[j]) * p(1000.);
                for a in 0..3 {
                    for b in 0..3 {
                        d[a] = d[a] + p(map[k][j]) * enclosed(&cols[b][j]) * p(directions[a][b]);
                    }
                }
            }
            let radial = d[0].norm3(d[1], p(0.));
            let mut lower = f64::INFINITY;
            let mut upper = f64::NEG_INFINITY;
            for q in &self.points {
                let c = o + p(q[1]) * p(1000.) * d[2];
                let extent = p(q[0]) * p(1000.) * radial;
                lower = lower.min(finite(c - extent)?.lo());
                upper = upper.max(finite(c + extent)?.hi());
            }
            lo[k] = lower;
            hi[k] = upper;
        }
        Ok((lo, hi))
    }
    pub(crate) fn world_vertices(&self) -> R<Vec<[f64; 3]>> {
        self.body
            .vertices
            .iter()
            .map(|v| {
                self.frame
                    .apply(v.point.map(|v| v.get()), 1000., true)
                    .map_err(|_| no("export-range"))
            })
            .collect()
    }
    /// Exact homogeneous pullback (adjugate numerators over det, as for
    /// spheres): membership in the meridian region compares exact rational
    /// squares, so boundary contact and one-ulp gaps have exact sides.
    /// Outside, rotation symmetry makes the distance the 2D distance to the
    /// meridian polygon in the point's half-plane, enclosed, then scaled by
    /// the frame's singular-value bounds. Boundary points are inside.
    pub fn probe_mm(&self, q: [f64; 3]) -> R<(Iv, bool)> {
        if q.iter().any(|x| !x.is_finite()) {
            return Err(no("probe-range"));
        }
        let mut g = Guard::new();
        let cols = self.metric().exact_columns().map_err(|_| no("probe-range"))?;
        let origin = self
            .frame
            .apply_exact([0.; 3], 1000., true)
            .map_err(|_| no("probe-range"))?;
        let delta: [Exp; 3] = std::array::from_fn(|k| ex::sum(&[q[k]], &ex::neg(&origin[k]), &mut g));
        let adj = [
            cross(&cols[1], &cols[2], &mut g),
            cross(&cols[2], &cols[0], &mut g),
            cross(&cols[0], &cols[1], &mut g),
        ];
        // num / det = 1000 * source coordinates (mm in the source metric).
        let num: [Exp; 3] = std::array::from_fn(|k| dot(&adj[k], &delta, &mut g));
        let det = dot(&cols[0], &adj[0], &mut g);
        if !g.exact() || ex::sign(&det) <= 0 {
            return Err(no("probe-range"));
        }
        // Decisions run on exact rationals (local = num / det, mm in the
        // source metric): high-degree expansion products of rotated frames
        // would leave the binary64 exponent range.
        let rational = |e: &Exp| -> R<Q> {
            e.iter()
                .map(|&x| Q::from_float(x).ok_or_else(|| no("probe-range")))
                .sum()
        };
        let det_q = rational(&det)?;
        let local = [rational(&num[0])? / &det_q, rational(&num[1])? / &det_q, rational(&num[2])? / &det_q];
        let axial = self.mode.min(2);
        let [i, j] = [(axial + 1) % 3, (axial + 2) % 3];
        let rho2 = &local[i] * &local[i] + &local[j] * &local[j];
        let height = &local[axial];
        let mm = |v: f64| Q::from_float(v).expect("audited binary64") * Q::from_integer(1000.into());
        let n = self.points.len();
        let mut inside = false;
        for e in 0..n {
            let (a, b) = (self.points[e], self.points[(e + 1) % n]);
            let (ra, ha, rb, hb) = (mm(a[0]), mm(a[1]), mm(b[0]), mm(b[1]));
            if ha == hb {
                let (lo, hi) = if ra < rb { (ra, rb) } else { (rb, ra) };
                if *height == ha && rho2 >= &lo * &lo && rho2 <= &hi * &hi {
                    inside = true;
                    break;
                }
                continue;
            }
            let ((r0, h0), (r1, h1)) = if ha < hb { ((ra, ha), (rb, hb)) } else { ((rb, hb), (ra, ha)) };
            if *height < h0 || *height > h1 {
                continue;
            }
            // Crossing radius at this height (>= 0 on a meridian edge).
            let crossing = &r0 + (&r1 - &r0) * (height - &h0) / (&h1 - &h0);
            let square = &crossing * &crossing;
            if rho2 == square {
                inside = true;
                break;
            }
            // Half-open height rule: a crossing at the upper end is counted
            // by the next edge, never twice.
            if *height < h1 && rho2 < square {
                inside = !inside;
            }
        }
        if inside {
            return Ok((p(0.), true));
        }
        let d = enclosed(&det);
        let at = |k: usize| enclosed(&num[k]) / d;
        let point = [finite(at(i).norm3(at(j), p(0.)))?, finite(at(axial))?];
        let mut best: Option<Iv> = None;
        for e in 0..n {
            let (a, b) = (self.points[e].map(|v| p(v) * p(1000.)), self.points[(e + 1) % n].map(|v| p(v) * p(1000.)));
            let (ex_, ey) = (b[0] - a[0], b[1] - a[1]);
            let (px, py) = (point[0] - a[0], point[1] - a[1]);
            let da = px.norm3(py, p(0.));
            let db = (point[0] - b[0]).norm3(point[1] - b[1], p(0.));
            let length2 = ex_ * ex_ + ey * ey;
            let t = (px * ex_ + py * ey) / length2;
            let perp = (px * ey - py * ex_).abs() / length2.sqrt();
            let segment = if t.hi() < 0. {
                da
            } else if t.lo() > 1. {
                db
            } else if t.lo() >= 0. && t.hi() <= 1. {
                perp
            } else {
                // Distance to the segment lies between the line distance and
                // the nearer endpoint distance.
                let (lo, hi) = (perp.lo(), da.hi().min(db.hi()));
                let m = 0.5 * lo + 0.5 * hi;
                Iv { m, r: ((hi - m).max(m - lo)).next_up().next_up() }
            };
            let segment = finite(segment)?;
            best = Some(match best {
                None => segment,
                Some(b) => b.min(segment),
            });
        }
        let distance = best.ok_or_else(|| no("probe-range"))?;
        let scale = Iv { m: 1., r: self.metric().metric_defect()? }.sqrt();
        Ok((finite(distance * scale)?, false))
    }
    /// Exact apex heights, one per face whose meridian segment ends on the
    /// axis. `None` for every other face (faces are in WC0 order).
    pub(crate) fn apexes(&self) -> Vec<Option<f64>> {
        let n = self.points.len();
        (0..n)
            .filter_map(|i| {
                let (a, c) = (self.points[i], self.points[(i + 1) % n]);
                if a[0] == 0. && c[0] == 0. {
                    return None;
                }
                Some(if a[1] == c[1] {
                    None
                } else if a[0] == 0. {
                    Some(a[1])
                } else if c[0] == 0. {
                    Some(c[1])
                } else {
                    None
                })
            })
            .collect()
    }
    /// Projection includes STEP chart seams and apex vertices; the WC0
    /// topology carries neither (an apex is a singular chart point).
    #[allow(clippy::type_complexity)]
    pub(crate) fn projection(&self) -> R<(Vec<[f64; 3]>, Vec<[usize; 2]>, Vec<Vec<Vec<(usize, bool)>>>)> {
        let mut vertices = self.world_vertices()?;
        let mut edges = self
            .body
            .edges
            .iter()
            .enumerate()
            .map(|(i, _)| [i, i])
            .collect::<Vec<_>>();
        let mut faces = vec![];
        for (f, apex) in self.body.faces.iter().zip(self.apexes()) {
            let uses = f
                .loops
                .iter()
                .map(|l| {
                    let c = &self.body.coedges[self.body.loops[l.0 as usize].coedges[0].0 as usize];
                    (c.edge.0 as usize, c.forward)
                })
                .collect::<Vec<_>>();
            if matches!(
                self.body.surfaces[f.surface.0 as usize].geometry,
                SurfaceGeometry::Plane { .. }
            ) {
                faces.push(uses.into_iter().map(|u| vec![u]).collect());
            } else if let Some(h) = apex {
                // The two-ring loop without its degenerate ring: the seam still
                // runs from the segment's first point to its second.
                let tip = vertices.len();
                vertices.push(
                    self.frame
                        .apply(local(self.mode, 0., 0., h), 1000., true)
                        .map_err(|_| no("export-range"))?,
                );
                let seam = edges.len();
                faces.push(vec![if uses[0].1 {
                    edges.push([uses[0].0, tip]);
                    vec![uses[0], (seam, true), (seam, false)]
                } else {
                    edges.push([tip, uses[0].0]);
                    vec![(seam, true), uses[0], (seam, false)]
                }]);
            } else {
                let seam = edges.len();
                edges.push([uses[0].0, uses[1].0]);
                faces.push(vec![vec![uses[0], (seam, true), uses[1], (seam, false)]]);
            }
        }
        Ok((vertices, edges, faces))
    }
    pub fn measure_json(&self, map: Option<[[f64; 4]; 3]>, probes: &[[f64; 3]]) -> R<String> {
        let (v, a, areas, h) = self.measures()?;
        let cols = self.metric().exact_columns()?;
        let axial = local(self.mode, 0., 0., 1.);
        let center: [Iv; 3] = std::array::from_fn(|k| {
            p(self.frame.origin[k]) * p(1000.)
                + (0..3).fold(p(0.), |s, j| s + enclosed(&cols[j][k]) * p(axial[j])) * h
        });
        let (lo, hi) = self.bbox(None)?;
        let bbox = |l, h| format!("{{\"min\":{},\"max\":{}}}", xyz(l), xyz(h));
        let mapped = if let Some(m) = map {
            let (l, h) = self.bbox(Some(m))?;
            bbox(l, h)
        } else {
            "null".into()
        };
        let pi = wonky_validated::pi(1e-14)
            .map_err(|_| no("validated-pi"))?
            .ball();
        let mut perimeters = vec![];
        for f in &self.body.faces {
            let mut sum = p(0.);
            for l in &f.loops {
                let c = &self.body.coedges[self.body.loops[l.0 as usize].coedges[0].0 as usize];
                if let wonky_contract::CurveGeometry::Circle { radius, .. } =
                    self.body.curves[c.edge.0 as usize].geometry
                {
                    sum = sum + p(2.) * pi * p(radius.get()) * p(1000.);
                }
            }
            perimeters.push(sum.m);
        }
        let (vertices, edges, faces) = self.projection()?;
        let singular = self.apexes().iter().flatten().count();
        let projection_faces = faces
            .iter()
            .map(|f| {
                format!(
                    "[{}]",
                    f.iter()
                        .map(|l| format!(
                            "[{}]",
                            l.iter()
                                .map(|(e, f)| format!("[{e},{f}]"))
                                .collect::<Vec<_>>()
                                .join(",")
                        ))
                        .collect::<Vec<_>>()
                        .join(",")
                )
            })
            .collect::<Vec<_>>()
            .join(",");
        Ok(format!(concat!("{{\"basis\":\"native-f64-construction\",\"certificate\":\"PolygonRevolution\",\"boundToConstruction\":true,",
          "\"volumeMm3\":{},\"volumeRelBound\":{},\"volumeEnclosureMm3\":[{},{}],\"areaMm2\":{},\"areaRelBound\":{},\"areaEnclosureMm2\":[{},{}],",
          "\"faceAreasMm2\":[{}],\"facePerimetersMm\":[{}],\"centroidMm\":{},\"centroidBoundMm\":{},\"bboxMm\":{},\"mappedBboxMm\":{},",
          "\"topology\":{{\"bodies\":1,\"shells\":1,\"faces\":{},\"edges\":{},\"vertices\":0,\"loops\":{},\"ringEdges\":{},\"closedToroidalFaces\":0,\"genus\":{},\"singularPoints\":{},\"pinchPoints\":0}},",
          "\"validity\":{{\"brep\":true,\"closed\":true,\"positive\":true}},\"toleranceMm\":{},\"frame\":{{\"orthonormalityDefect\":{}}},\"probes\":[{}],",
          "\"projection\":{{\"vertices\":[{}],\"edges\":[{}],\"faces\":[{}]}}}}"),
          js(v.m),js((v.r/v.m).next_up()),js(v.lo()),js(v.hi()),js(a.m),js((a.r/a.m).next_up()),js(a.lo()),js(a.hi()),
          areas.iter().map(|a|js(a.m)).collect::<Vec<_>>().join(","),perimeters.iter().map(|&a|js(a)).collect::<Vec<_>>().join(","),xyz(center.map(|v|v.m)),xyz(center.map(|v|v.r)),bbox(lo,hi),mapped,
          self.body.faces.len(),self.body.edges.len(),self.body.loops.len(),self.body.edges.len(),if self.points.iter().any(|p|p[0]==0.){0}else{1},singular,
          js(self.tolerance_mm()?),js(self.metric().metric_defect()?),probes.iter().map(|&q|self.probe_mm(q).map(|(d,inside)|format!("{{\"distanceMm\":{},\"inside\":{inside},\"boundMm\":{}}}",js(d.m),js(d.r)))).collect::<R<Vec<_>>>()?.join(","),
          vertices.into_iter().map(xyz).collect::<Vec<_>>().join(","),edges.iter().map(|[a,b]|format!("[{a},{b}]")).collect::<Vec<_>>().join(","),projection_faces))
    }
}
