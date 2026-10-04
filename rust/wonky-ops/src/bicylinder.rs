//! Intersection of two equal-radius, perpendicular axial cylinders whose caps
//! strictly clear their common lens. The four half-ellipse edges use dyadic
//! vector semiaxes; sqrt(2)*r is never rounded into authoritative geometry.
//! Cylinder charts are analytic harmonics, not sampled polylines. Replay binds
//! the complete boundary to both operands and rechecks all admission predicates.
use crate::{
    affine::Affine,
    cylinder::{self, enclosed, finite, Cylinder, Spec},
    polyhedron::Refused,
};
use std::{result::Result, sync::OnceLock};
use wonky_contract::*;
use wonky_num::{
    expansion::{self as ex, Guard},
    Iv, Scalar,
};
type R<T> = Result<T, Refused>;
fn no(s: &str) -> Refused {
    Refused(format!("bicylinder/{s}"))
}
fn b(x: f64) -> R<Binary64> {
    Binary64::new(x).map_err(|_| no("numeric-range"))
}
fn v(p: [f64; 3]) -> R<Vector3> {
    Ok([b(p[0])?, b(p[1])?, b(p[2])?])
}
fn v2(p: [f64; 2]) -> R<Vector2> {
    Ok([b(p[0])?, b(p[1])?])
}
fn get(p: &Vector3) -> [f64; 3] {
    p.each_ref().map(|x| x.get())
}
fn axis(k: usize) -> [f64; 3] {
    let mut p = [0.; 3];
    p[k] = 1.;
    p
}
fn domain() -> Domain {
    Domain {
        lower: Limit::Finite {
            value: Binary64::new(0.).unwrap(),
            closed: true,
        },
        upper: Limit::Finite {
            value: Binary64::new(0.5).unwrap(),
            closed: true,
        },
    }
}
pub(crate) fn frame_ok(frame: Affine) -> R<()> {
    if ex::sign(&frame.det_exact().map_err(|_| no("frame-range"))?) != 1
        || frame
            .orthonormality_defect()
            .map_err(|_| no("frame-range"))?
            > 1e-10
    {
        return Err(no("non-rigid-frame"));
    }
    Ok(())
}
#[derive(Clone, Debug)]
pub struct Bicylinder {
    pub body: Body,
    pub frame: Affine,
    pub center: [f64; 3],
    pub radius: f64,
    /// Coordinate normal to both cylinder axes; a=(k+1)%3, b=(k+2)%3.
    pub k: usize,
}
fn classify(a: Spec, c: Spec) -> R<([f64; 3], usize)> {
    let (i, j) = (a.axis()?, c.axis()?);
    if i == j || a.radius != c.radius {
        return Err(no("requires-perpendicular-equal-radii"));
    }
    let k = 3 - i - j;
    if a.bottom[k] != c.bottom[k] {
        return Err(no("skew-axes"));
    }
    let mut center = a.bottom;
    center[i] = c.bottom[i];
    let mut g = Guard::new();
    for (s, l) in [(a, i), (c, j)] {
        for terms in [
            [center[l], -s.radius, -s.bottom[l]],
            [s.top[l], -center[l], -s.radius],
        ] {
            let e = terms
                .into_iter()
                .fold(vec![], |e, x| ex::sum(&e, &[x], &mut g));
            if !g.exact() {
                return Err(no("predicate-range"));
            }
            if ex::sign(&e) <= 0 {
                return Err(no("end-cap-arrangement"));
            }
        }
    }
    Ok((center, k))
}
pub fn is_candidate(body: &Body) -> bool {
    body.constructions.last().is_some_and(|n| {
        n.operation == Operation::Boolean {}
            && n.parameters.len() == 1
            && n.parameters[0].get() == 2.
    }) && body
        .curves
        .iter()
        .any(|c| matches!(c.geometry, CurveGeometry::VectorEllipse { .. }))
}
pub fn intersect(key: BodyKey, a: &Cylinder, c: &Cylinder) -> R<Body> {
    if a.frame != c.frame {
        return Err(no("different-exact-frames"));
    }
    let (center, k) = classify(a.spec, c.spec)?;
    let nodes = boolean_nodes(a, c, 2)?;
    assemble(key, center, k, a.spec.radius, a.frame.as_affine()?, nodes)
}
pub(crate) fn boolean_nodes(a: &Cylinder, c: &Cylinder, operation: u8) -> R<Vec<Construction>> {
    let mut nodes = a.body.constructions.clone();
    let offset = nodes.len() as u32;
    for mut n in c.body.constructions.clone() {
        for p in &mut n.parents {
            p.0 += offset;
        }
        nodes.push(n);
    }
    let root = nodes.len() as u32 - 1;
    nodes.push(Construction {
        operation: Operation::Boolean {},
        rule_version: 1,
        parents: vec![NodeId(offset - 1), NodeId(root)],
        parameters: vec![b(operation as f64)?],
        frame: FrameId(1),
    });
    Ok(nodes)
}
fn assemble(
    key: BodyKey,
    center: [f64; 3],
    k: usize,
    r: f64,
    frame: Affine,
    nodes: Vec<Construction>,
) -> R<Body> {
    frame_ok(frame)?;
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
                axis: v(axis(k))?,
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
    let provenance = Provenance::Construction {
        node: NodeId(body.constructions.len() as u32 - 1),
    };
    let (a, c) = ((k + 1) % 3, (k + 2) % 3);
    for sign in [1., -1.] {
        body.vertices.push(Vertex {
            point: v(axis(k).map(|x| x * r * sign))?,
            frame: FrameId(2),
            provenance: Provenance::None {},
        });
    }
    for i in [a, c] {
        body.surfaces.push(Surface {
            frame: FrameId(1),
            provenance: provenance.clone(),
            geometry: SurfaceGeometry::Cylinder {
                origin: v(center)?,
                axis: v(axis(i))?,
                x: v(axis(k))?,
                radius: b(r)?,
            },
        });
    }
    for (e, (sa, sb)) in [(1., 1.), (1., -1.), (-1., 1.), (-1., -1.)]
        .into_iter()
        .enumerate()
    {
        let mut sine = [0.; 3];
        sine[a] = sa * r;
        sine[c] = sb * r;
        body.curves.push(Curve {
            frame: FrameId(1),
            provenance: provenance.clone(),
            geometry: CurveGeometry::VectorEllipse {
                origin: v(center)?,
                cosine: v(axis(k).map(|x| x * r))?,
                sine: v(sine)?,
                arc: ArcKind::Trimmed {},
            },
            domain: domain(),
            supports: vec![],
        });
        body.edges.push(Edge {
            curve: CurveId(e as u32),
            domain: domain(),
            vertices: vec![VertexId(0), VertexId(1)],
        });
        for (s, u, vv) in [(0, -sb, sa * r), (1, sa, sb * r)] {
            let pc = PcurveId(body.pcurves.len() as u32);
            body.pcurves.push(Pcurve {
                curve: CurveId(e as u32),
                surface: SurfaceId(s),
                domain: domain(),
                geometry: PcurveGeometry::Harmonic {
                    offset: v2([0., 0.])?,
                    linear: v2([u, 0.])?,
                    cosine: v2([0., 0.])?,
                    sine: v2([0., vv])?,
                },
            });
            body.curves[e].supports.push(Support {
                surface: SurfaceId(s),
                pcurve: pc,
            });
        }
    }
    // Positive chart orientation: upper v boundary runs in decreasing u.
    for (s, uses) in [
        (0, [(0, true), (2, false)]),
        (0, [(3, true), (1, false)]),
        (1, [(1, true), (0, false)]),
        (1, [(2, true), (3, false)]),
    ] {
        let mut coedges = vec![];
        for (e, forward) in uses {
            coedges.push(CoedgeId(body.coedges.len() as u32));
            body.coedges.push(Coedge {
                edge: EdgeId(e),
                forward,
                pcurve: PcurveId(2 * e + s),
            });
        }
        let l = LoopId(body.loops.len() as u32);
        body.loops.push(Loop {
            outer: true,
            coedges,
        });
        body.faces.push(Face {
            surface: SurfaceId(s),
            forward: true,
            loops: vec![l],
        });
    }
    body.shells.push(Shell {
        faces: (0..4).map(FaceId).collect(),
    });
    body.solids.push(Solid {
        shells: vec![ShellId(0)],
    });
    body.clone().check().map_err(|_| no("contract"))?;
    Ok(body)
}
pub fn audit(checked: &CheckedBody) -> R<Bicylinder> {
    let body = checked.body();
    let n = body
        .constructions
        .last()
        .ok_or_else(|| no("construction"))?;
    if !is_candidate(body) || n.rule_version != 1 || n.frame != FrameId(1) || n.parents.len() != 2 {
        return Err(no("construction"));
    }
    let a = cylinder::replay(&body.constructions, n.parents[0].0 as usize, &mut 1024)?;
    let c = cylinder::replay(&body.constructions, n.parents[1].0 as usize, &mut 1024)?;
    let (center, k) = classify(a, c)?;
    let [Frame::Source { source }, Frame::Interpreter {
        parent,
        origin,
        x,
        z,
    }, Frame::Rigid { .. }] = body.frames.as_slice()
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
    let expected = assemble(
        body.key.clone(),
        center,
        k,
        a.radius,
        frame,
        body.constructions.clone(),
    )?;
    if *body != expected {
        return Err(no("construction-carrier-mismatch"));
    }
    Ok(Bicylinder {
        body: body.clone(),
        frame,
        center,
        radius: a.radius,
        k,
    })
}
fn ball(lo: f64, hi: f64) -> R<Iv> {
    if !lo.is_finite() || !hi.is_finite() || lo > hi {
        return Err(no("observation-range"));
    }
    if lo == hi {
        return Ok(Iv::point(lo));
    }
    let m = lo * 0.5 + hi * 0.5;
    finite(Iv {
        m,
        r: (hi - m).next_up().max((m - lo).next_up()),
    })
}
fn sqrt_nonnegative(x: Iv) -> R<Iv> {
    // Caller has proved the exact radicand nonnegative. Intersect with [0,+inf)
    // before sqrt; rounding a zero into a negative endpoint is not geometry.
    if x.is_nan() || x.hi() < 0. {
        return Err(no("sqrt-range"));
    }
    ball(
        x.lo().max(0.).sqrt().next_down().max(0.),
        x.hi().max(0.).sqrt().next_up(),
    )
}
fn half_ellipse_length() -> R<Iv> {
    static LENGTH: OnceLock<R<Iv>> = OnceLock::new();
    LENGTH
        .get_or_init(|| {
            use wonky_validated::{integrate, pi, Expr};
            let tau = Expr::Bound(pi(1e-14).map_err(|_| no("pi"))?) * Expr::Constant(2.);
            let expr =
                tau.clone() * (Expr::Constant(2.) - (tau * Expr::Variable).sin().square()).sqrt();
            Ok(integrate(&expr, 0., 0.5, 1e-10, 65536)
                .map_err(|_| no("ellipse-length-budget"))?
                .enclosure
                .ball())
        })
        .clone()
}
impl Bicylinder {
    pub fn transform(&self, frame: Affine) -> R<Body> {
        assemble(
            self.body.key.clone(),
            self.center,
            self.k,
            self.radius,
            frame,
            self.body.constructions.clone(),
        )
    }
    fn scale(&self) -> R<Iv> {
        Ok(Iv {
            m: 1.,
            r: (3.
                * self
                    .frame
                    .orthonormality_defect()
                    .map_err(|_| no("frame-range"))?)
            .next_up(),
        })
    }
    pub fn measures_mm(&self) -> R<(Iv, Iv)> {
        let r = Iv::point(self.radius) * Iv::point(1000.);
        let volume = finite(
            Iv::point(16.) * r * r * r / Iv::point(3.)
                * enclosed(&self.frame.det_exact().map_err(|_| no("frame-range"))?),
        )?;
        let area = finite(Iv::point(16.) * r * r * self.scale()?)?;
        if volume.lo() <= 0. || volume.r / volume.m > 1e-9 || area.r / area.m > 1e-9 {
            return Err(no("observation-width"));
        }
        Ok((volume, area))
    }
    pub fn bbox_mm(&self, map: Option<[[f64; 4]; 3]>) -> R<([f64; 3], [f64; 3])> {
        let m = map.unwrap_or([[1., 0., 0., 0.], [0., 1., 0., 0.], [0., 0., 1., 0.]]);
        let center = self
            .frame
            .apply_exact(self.center, 1000., true)
            .map_err(|_| no("frame-range"))?;
        let mut g = Guard::new();
        let y = self.frame.y_exact(&mut g);
        if !g.exact() {
            return Err(no("frame-range"));
        }
        let cols = [
            self.frame.x.map(Iv::point),
            y.each_ref().map(|e| enclosed(e)),
            self.frame.z.map(Iv::point),
        ];
        let (a, b) = ((self.k + 1) % 3, (self.k + 2) % 3);
        let mut lo = [0.; 3];
        let mut hi = [0.; 3];
        for i in 0..3 {
            let mut c = Iv::point(m[i][3]);
            let mut n = [Iv::point(0.); 3];
            for j in 0..3 {
                let w = Iv::point(m[i][j]);
                c = c + w * enclosed(&center[j]);
                for k in 0..3 {
                    n[k] = n[k] + w * cols[k][j];
                }
            }
            // Support function of the square sections: max_z A*sqrt(r²-z²)+n_z*z.
            let h = finite(
                (n[a].abs() + n[b].abs()).norm3(n[self.k], Iv::point(0.))
                    * Iv::point(self.radius)
                    * Iv::point(1000.),
            )?;
            let (l, u) = (finite(c - h)?, finite(c + h)?);
            if l.r > 1e-9 || u.r > 1e-9 {
                return Err(no("bbox-width"));
            }
            lo[i] = l.m;
            hi[i] = u.m;
        }
        Ok((lo, hi))
    }
    pub fn tolerance_mm(&self) -> R<f64> {
        let (lo, hi) = self.bbox_mm(None)?;
        let mag = lo.into_iter().chain(hi).map(f64::abs).fold(0., f64::max);
        Ok((128. * f64::EPSILON * mag + 32. * self.scale()?.r * self.radius * 1000.).next_up())
    }
    /// Distance to the equal-constraint ellipse in the nearest sign octant.
    /// Its stationary equation in s=sin(theta) is monotone after division by
    /// sqrt(1-s²); certified bisection retains a bracket, never picks a root
    /// from an unproved floating-point sign.
    fn ellipse_distance(&self, p: [f64; 3]) -> R<Iv> {
        let (a, b) = ((self.k + 1) % 3, (self.k + 2) % 3);
        let (x, y, z) = (
            Iv::point(p[a].abs()),
            Iv::point(p[b].abs()),
            Iv::point(p[self.k].abs()),
        );
        let r = Iv::point(self.radius);
        let aa = x + y;
        let s = if aa.hi() == 0. {
            Iv::point(0.)
        } else if z.hi() == 0. && aa.lo() >= self.radius {
            Iv::point(1.)
        } else {
            let (mut lo, mut hi) = (0., 1.);
            for _ in 0..64 {
                let mid = lo * 0.5 + hi * 0.5;
                if mid == lo || mid == hi {
                    break;
                }
                let s = Iv::point(mid);
                let f = (r * s - aa) * sqrt_nonnegative(Iv::point(1.) - s * s)? + z * s;
                if f.hi() < 0. {
                    lo = mid;
                } else if f.lo() > 0. {
                    hi = mid;
                } else {
                    break;
                }
            }
            ball(lo, hi)?
        };
        let zz = if s.r == 0. && s.m == 1. {
            Iv::point(0.)
        } else {
            sqrt_nonnegative(Iv::point(1.) - s * s)?
        };
        finite((x - r * s).norm3(y - r * s, z - r * zz))
    }
    pub fn probe(&self, q: [f64; 3]) -> R<(f64, bool, f64)> {
        // Exact adjugate numerators in millimetres, then one enclosed rational
        // division. Subtracting large placements before rounding avoids an
        // arbitrary world-magnitude error that would swamp a tiny local probe.
        let mut g = Guard::new();
        let cols = [
            self.frame.x.map(|x| vec![x]),
            self.frame.y_exact(&mut g),
            self.frame.z.map(|x| vec![x]),
        ];
        let delta = [0, 1, 2].map(|k| {
            ex::sum(
                &[q[k]],
                &ex::neg(&ex::product(self.frame.origin[k], 1000., &mut g)),
                &mut g,
            )
        });
        let det = ex::mul(
            &self.frame.det_exact().map_err(|_| no("probe-frame"))?,
            &[1000.],
            &mut g,
        );
        let mut pb = [Iv::point(0.); 3];
        for i in 0..3 {
            let (u, v) = (&cols[(i + 1) % 3], &cols[(i + 2) % 3]);
            let cross = [0, 1, 2].map(|j| {
                ex::sum(
                    &ex::mul(&u[(j + 1) % 3], &v[(j + 2) % 3], &mut g),
                    &ex::neg(&ex::mul(&u[(j + 2) % 3], &v[(j + 1) % 3], &mut g)),
                    &mut g,
                )
            });
            let mut num = vec![];
            for j in 0..3 {
                num = ex::sum(&num, &ex::mul(&delta[j], &cross[j], &mut g), &mut g);
            }
            num = ex::sum(
                &num,
                &ex::neg(&ex::mul(&[self.center[i]], &det, &mut g)),
                &mut g,
            );
            pb[i] = finite(enclosed(&num) / enclosed(&det))?;
        }
        if !g.exact() {
            return Err(no("probe-range"));
        }
        let p = pb.map(|x| x.m);
        let e = pb.into_iter().map(|x| x.r).fold(0., f64::max);
        let r = Iv::point(self.radius);
        let (a, b) = ((self.k + 1) % 3, (self.k + 2) % 3);
        let radial = [
            pb[a].norm3(pb[self.k], Iv::point(0.)),
            pb[b].norm3(pb[self.k], Iv::point(0.)),
        ];
        let inside = radial.iter().all(|v| v.hi() < self.radius);
        if inside {
            return Ok((0., true, e * 2000.));
        }
        if !radial.iter().any(|v| v.lo() > self.radius) {
            return Err(no("probe-boundary-undecided"));
        }
        let ellipse = self.ellipse_distance(p)?;
        let mut upper = ellipse.hi();
        let norms = [
            Iv::point(p[a]).norm3(Iv::point(p[self.k]), Iv::point(0.)),
            Iv::point(p[b]).norm3(Iv::point(p[self.k]), Iv::point(0.)),
        ];
        let mut lower = norms
            .iter()
            .map(|n| (*n - r).lo().max(0.))
            .fold(0., f64::max);
        let mut both_invalid = true;
        for (j, n) in [(b, norms[0]), (a, norms[1])] {
            if n.lo() <= self.radius {
                both_invalid = false;
                continue;
            }
            let projected_z = Iv::point(p[self.k]) * r / n;
            let other = Iv::point(p[j]).norm3(projected_z, Iv::point(0.));
            if other.hi() <= self.radius {
                upper = upper.min((n - r).hi());
                both_invalid = false;
            } else if other.lo() <= self.radius {
                both_invalid = false;
            }
        }
        if both_invalid {
            lower = ellipse.lo();
        }
        let scale = self.scale()?;
        let allowance =
            finite(Iv::point(4.) * Iv::point(e) + Iv::point(scale.r) * Iv::point(upper))?.hi();
        let dist = finite(
            ball(
                (lower - allowance).next_down().max(0.),
                (upper + allowance).next_up(),
            )? * Iv::point(1000.),
        )?;
        if dist.r > 1e-9 {
            return Err(no("probe-distance-width"));
        }
        Ok((dist.m, false, dist.r))
    }
    pub fn measure_json(&self, map: Option<[[f64; 4]; 3]>, probes: &[[f64; 3]]) -> R<String> {
        let (volume, area) = self.measures_mm()?;
        let (lo, hi) = self.bbox_mm(None)?;
        let mapped = if let Some(m) = map {
            let (l, h) = self.bbox_mm(Some(m))?;
            format!("{{\"min\":{l:?},\"max\":{h:?}}}")
        } else {
            "null".into()
        };
        let centroid = self
            .frame
            .apply(self.center, 1000., true)
            .map_err(|_| no("frame-range"))?;
        let perimeter = finite(
            half_ellipse_length()? * Iv::point(self.radius) * Iv::point(2000.) * self.scale()?,
        )?;
        let areas = [area.m / 4.; 4];
        let perimeters = [perimeter.m; 4];
        let tolerance = self.tolerance_mm()?;
        let probes = probes
            .iter()
            .map(|&q| match self.probe(q) {
                Ok((d, i, b)) => {
                    format!("{{\"distanceMm\":{d:?},\"inside\":{i},\"boundMm\":{b:?}}}")
                }
                Err(e) => format!("{{\"refused\":\"{}\"}}", e.0),
            })
            .collect::<Vec<_>>()
            .join(",");
        let placement = crate::placement::Placement::from_frames(&self.body, FrameId(1))
            .map_err(|_| no("frame-range"))?;
        let vertices = crate::cylinder_chart::vertices_mm(&self.body, &placement)?;
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
                    "[[{}]]",
                    self.body.loops[f.loops[0].0 as usize]
                        .coedges
                        .iter()
                        .map(|u| {
                            let c = &self.body.coedges[u.0 as usize];
                            format!("[{},{}]", c.edge.0, c.forward)
                        })
                        .collect::<Vec<_>>()
                        .join(",")
                )
            })
            .collect::<Vec<_>>()
            .join(",");
        Ok(format!(concat!("{{\"basis\":\"native-f64-construction\",\"certificate\":\"PerpendicularBicylinder\",\"boundToConstruction\":true,",
            "\"volumeMm3\":{:?},\"volumeRelBound\":{:?},\"areaMm2\":{:?},\"areaRelBound\":{:?},\"centroidMm\":{centroid:?},",
            "\"bboxMm\":{{\"min\":{lo:?},\"max\":{hi:?}}},\"mappedBboxMm\":{mapped},",
            "\"topology\":{{\"bodies\":1,\"shells\":1,\"faces\":4,\"edges\":4,\"vertices\":2,\"loops\":4,\"ringEdges\":0,\"closedToroidalFaces\":0,\"genus\":0,\"singularPoints\":0,\"pinchPoints\":0}},",
            "\"validity\":{{\"brep\":true,\"closed\":true,\"positive\":true}},\"toleranceMm\":{tolerance:?},\"probes\":[{probes}],\"faceAreasMm2\":{areas:?},\"facePerimetersMm\":{perimeters:?},",
            "\"projection\":{{\"vertices\":{vertices:?},\"edges\":{edges:?},\"faces\":[{faces}]}}}}"),volume.m,volume.r/volume.m,area.m,area.r/area.m,
            centroid=centroid,lo=lo,hi=hi,mapped=mapped,tolerance=tolerance,probes=probes,areas=areas,perimeters=perimeters,vertices=vertices,edges=edges,faces=faces))
    }
}
