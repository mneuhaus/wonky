//! Quarter-turn rectangular meridians, with analytic 3D circle trims.
//!
//! Pcurves are explicitly bounded, sampled chart descriptions, not geometry
//! or incidence proofs. The audit checks the actual line/circle carriers and
//! their shared vertices. STEP writes analytic curves, never these samples.
use crate::{affine::Affine, polyhedron::Refused};
use wonky_contract::*;
use wonky_num::{expansion as ex, Iv, Scalar};
use wonky_sketch::region::lines_region;
type R<T> = std::result::Result<T, Refused>;
fn no(s: &str) -> Refused {
    Refused(format!("revolve/sector/{s}"))
}
fn b(x: f64) -> R<Binary64> {
    Binary64::new(x).map_err(|_| no("numeric-range"))
}
fn v(p: [f64; 3]) -> R<Vector3> {
    Ok([b(p[0])?, b(p[1])?, b(p[2])?])
}
fn domain(end: f64) -> R<Domain> {
    Ok(Domain {
        lower: Limit::Finite {
            value: b(0.)?,
            closed: true,
        },
        upper: Limit::Finite {
            value: b(end)?,
            closed: true,
        },
    })
}
fn enclose(e: &[f64]) -> Iv {
    e.iter().fold(Iv::point(0.), |a, &x| a + Iv::point(x))
}
fn finite(x: Iv) -> R<Iv> {
    if x.is_nan() || !x.lo().is_finite() || !x.hi().is_finite() {
        Err(no("measurement-range"))
    } else {
        Ok(x)
    }
}
fn pi() -> R<Iv> {
    Ok(wonky_validated::pi(1e-14)
        .map_err(|_| no("validated-pi"))?
        .ball())
}

#[derive(Clone, Copy)]
pub struct Sector {
    pub(crate) frame: Affine,
    pub(crate) inner: f64,
    pub(crate) outer: f64,
    pub(crate) bottom: f64,
    pub(crate) top: f64,
}
fn parameters(frame: Affine, segments: &[[f64; 4]], angle: f64) -> R<Sector> {
    if !wonky_geom::turn::sentinel(angle, 90) {
        return Err(no("partial-angle-not-quarter-turn"));
    }
    let values: Vec<_> = frame
        .origin
        .into_iter()
        .chain(frame.x)
        .chain(frame.z)
        .collect();
    wonky_num::check_range(&values, "sector frame").map_err(|e| {
        e.into_refusal();
        no("numeric-range")
    })?;
    if ex::sign(&frame.det_exact().map_err(|_| no("numeric-range"))?) <= 0 {
        return Err(no("degenerate-frame"));
    }
    let seg: Vec<_> = segments
        .iter()
        .map(|s| [wonky_num::p2(s[0], s[1]), wonky_num::p2(s[2], s[3])])
        .collect();
    let regions = lines_region(&seg).map_err(|_| no("invalid-profile"))?;
    if regions.open_wires != 0 || regions.loops.len() != 1 || regions.loops[0].points.len() != 4 {
        return Err(no("one-rectangle-required"));
    }
    let p = &regions.loops[0].points;
    let inner = p.iter().map(|p| p.x).fold(f64::INFINITY, f64::min);
    let outer = p.iter().map(|p| p.x).fold(f64::NEG_INFINITY, f64::max);
    let bottom = p.iter().map(|p| p.y).fold(f64::INFINITY, f64::min);
    let top = p.iter().map(|p| p.y).fold(f64::NEG_INFINITY, f64::max);
    if inner <= 0. {
        return Err(no("axis-contact"));
    }
    for i in 0..4 {
        let a = p[i];
        let c = p[(i + 1) % 4];
        if !(a.x == inner || a.x == outer)
            || !(a.y == bottom || a.y == top)
            || !(a.x == c.x || a.y == c.y)
        {
            return Err(no("one-rectangle-required"));
        }
    }
    Ok(Sector {
        frame,
        inner,
        outer,
        bottom,
        top,
    })
}
impl Sector {
    pub fn points(&self) -> [[f64; 3]; 8] {
        let (r, s, a, z) = (self.inner, self.outer, self.bottom, self.top);
        [
            [r, 0., a],
            [s, 0., a],
            [s, 0., z],
            [r, 0., z],
            [0., r, a],
            [0., s, a],
            [0., s, z],
            [0., r, z],
        ]
    }
    pub fn world_points(&self) -> R<Vec<[f64; 3]>> {
        self.points()
            .iter()
            .map(|&p| {
                self.frame
                    .apply(p, 1000., true)
                    .map_err(|_| no("export-range"))
            })
            .collect()
    }
    fn columns(&self, g: &mut ex::Guard) -> [[ex::Exp; 3]; 3] {
        [
            self.frame.x.map(|x| vec![x]),
            self.frame.y_exact(g),
            self.frame.z.map(|x| vec![x]),
        ]
    }
    pub fn metric_defect(&self) -> R<f64> {
        let mut g = ex::Guard::new();
        let c = self.columns(&mut g);
        let mut worst = 0f64;
        for i in 0..3 {
            let mut row = Iv::point(0.);
            for j in 0..3 {
                let mut s = vec![];
                for k in 0..3 {
                    s = ex::sum(&s, &ex::mul(&c[i][k], &c[j][k], &mut g), &mut g);
                }
                if i == j {
                    s = ex::sum(&s, &[-1.], &mut g);
                }
                let s = enclose(&s);
                row = row + Iv::point(s.lo().abs().max(s.hi().abs()));
            }
            worst = worst.max(row.hi());
        }
        if !g.exact() || !worst.is_finite() || worst >= 0.5 {
            return Err(no("frame-metric-range"));
        }
        Ok(worst)
    }
    pub fn measures(&self) -> R<(Iv, Iv)> {
        let p = pi()?;
        let r = Iv::point(self.inner) * Iv::point(1000.);
        let s = Iv::point(self.outer) * Iv::point(1000.);
        let h = (Iv::point(self.top) - Iv::point(self.bottom)) * Iv::point(1000.);
        let annulus = (s - r) * (s + r);
        let det = enclose(
            &self
                .frame
                .det_exact()
                .map_err(|_| no("measurement-range"))?,
        );
        let volume = finite(p / Iv::point(4.) * annulus * h * det)?;
        let area = finite(
            (p / Iv::point(2.) * (annulus + (s + r) * h) + Iv::point(2.) * (s - r) * h)
                * Iv {
                    m: 1.,
                    r: self.metric_defect()?,
                },
        )?;
        if volume.lo() <= 0. || volume.r / volume.m > 1e-9 || area.r / area.m > 1e-9 {
            return Err(no("measurement-width"));
        }
        Ok((volume, area))
    }
    pub fn tolerance(&self) -> R<f64> {
        let reach = Iv::point(1000.)
            * (Iv::point(self.outer) + Iv::point(self.bottom.abs().max(self.top.abs())));
        let o = self
            .frame
            .origin
            .into_iter()
            .fold(0f64, |a, x| a.max(x.abs()))
            * 1000.;
        Ok(finite(
            Iv::point(64. * f64::EPSILON) * (Iv::point(o) + reach)
                + Iv::point(8. * self.metric_defect()?) * reach,
        )?
        .hi())
    }
    pub fn bbox(&self, map: Option<[[f64; 4]; 3]>) -> R<([f64; 3], [f64; 3])> {
        let m = map.unwrap_or([[1., 0., 0., 0.], [0., 1., 0., 0.], [0., 0., 1., 0.]]);
        let mut g = ex::Guard::new();
        let cols = self.columns(&mut g);
        let mut lo = [0.; 3];
        let mut hi = [0.; 3];
        for k in 0..3 {
            let mut d: [ex::Exp; 3] = Default::default();
            let mut center = vec![m[k][3]];
            for j in 0..3 {
                center = ex::sum(
                    &center,
                    &ex::mul(
                        &[m[k][j]],
                        &ex::product(self.frame.origin[j], 1000., &mut g),
                        &mut g,
                    ),
                    &mut g,
                );
                for a in 0..3 {
                    d[a] = ex::sum(&d[a], &ex::mul(&[m[k][j]], &cols[a][j], &mut g), &mut g);
                }
            }
            let a = enclose(&d[0]);
            let b = enclose(&d[1]);
            let norm = a.norm3(b, Iv::point(0.));
            let minimum = if ex::sign(&d[0]) < 0 && ex::sign(&d[1]) < 0 {
                -norm
            } else {
                min_iv(a, b)
            };
            let maximum = if ex::sign(&d[0]) > 0 && ex::sign(&d[1]) > 0 {
                norm
            } else {
                max_iv(a, b)
            };
            // All extrema over radius occur at a radial endpoint; no numerical
            // sign guess is needed even when the support enclosure meets zero.
            let r = Iv::point(self.inner);
            let s = Iv::point(self.outer);
            let z = enclose(&d[2]);
            let z0 = z * Iv::point(self.bottom);
            let z1 = z * Iv::point(self.top);
            lo[k] = finite(
                enclose(&center)
                    + Iv::point(1000.) * (min_iv(r * minimum, s * minimum) + min_iv(z0, z1)),
            )?
            .m;
            hi[k] = finite(
                enclose(&center)
                    + Iv::point(1000.) * (max_iv(r * maximum, s * maximum) + max_iv(z0, z1)),
            )?
            .m;
        }
        if !g.exact() {
            return Err(no("measurement-range"));
        }
        Ok((lo, hi))
    }
    pub fn probe(&self, q: [f64; 3]) -> R<(Iv, bool)> {
        let mut g = ex::Guard::new();
        let c = self.columns(&mut g);
        let cross = |a: &[ex::Exp; 3], b: &[ex::Exp; 3], g: &mut ex::Guard| {
            std::array::from_fn(|k| {
                let i = (k + 1) % 3;
                let j = (k + 2) % 3;
                ex::sum(
                    &ex::mul(&a[i], &b[j], g),
                    &ex::neg(&ex::mul(&a[j], &b[i], g)),
                    g,
                )
            })
        };
        let dot = |a: &[ex::Exp; 3], b: &[ex::Exp; 3], g: &mut ex::Guard| {
            let mut s = vec![];
            for k in 0..3 {
                s = ex::sum(&s, &ex::mul(&a[k], &b[k], g), g);
            }
            s
        };
        let adj = [
            cross(&c[1], &c[2], &mut g),
            cross(&c[2], &c[0], &mut g),
            cross(&c[0], &c[1], &mut g),
        ];
        let det = dot(&c[0], &adj[0], &mut g);
        let delta: [ex::Exp; 3] = std::array::from_fn(|k| {
            ex::sum(
                &[q[k]],
                &ex::neg(&ex::product(self.frame.origin[k], 1000., &mut g)),
                &mut g,
            )
        });
        let n: [ex::Exp; 3] = std::array::from_fn(|k| dot(&adj[k], &delta, &mut g));
        let radius2 = ex::sum(
            &ex::mul(&n[0], &n[0], &mut g),
            &ex::mul(&n[1], &n[1], &mut g),
            &mut g,
        );
        let sign_radius = |r: f64, g: &mut ex::Guard| {
            let scaled = ex::mul(&ex::product(r, 1000., g), &det, g);
            ex::sign(&ex::sum(
                &radius2,
                &ex::neg(&ex::mul(&scaled, &scaled, g)),
                g,
            ))
        };
        let lower = ex::sum(
            &n[2],
            &ex::neg(&ex::mul(
                &ex::product(self.bottom, 1000., &mut g),
                &det,
                &mut g,
            )),
            &mut g,
        );
        let upper = ex::sum(
            &n[2],
            &ex::neg(&ex::mul(
                &ex::product(self.top, 1000., &mut g),
                &det,
                &mut g,
            )),
            &mut g,
        );
        let quadrant = ex::sign(&n[0]) >= 0 && ex::sign(&n[1]) >= 0;
        let inside = quadrant
            && sign_radius(self.inner, &mut g) >= 0
            && sign_radius(self.outer, &mut g) <= 0
            && ex::sign(&lower) >= 0
            && ex::sign(&upper) <= 0;
        if !g.exact() {
            return Err(no("probe-range"));
        }
        if inside {
            return Ok((Iv::point(0.), true));
        }
        let [x, y, z] = n.map(|e| enclose(&e) / enclose(&det));
        let r = Iv::point(self.inner) * Iv::point(1000.);
        let s = Iv::point(self.outer) * Iv::point(1000.);
        let clamp = |x: Iv| max_iv(r, min_iv(s, x));
        let planar = if quadrant {
            let rho = x.norm3(y, Iv::point(0.));
            max_iv(r - rho, max_iv(rho - s, Iv::point(0.)))
        } else {
            min_iv(
                (x - clamp(x)).norm3(y, Iv::point(0.)),
                x.norm3(y - clamp(y), Iv::point(0.)),
            )
        };
        let dz = max_iv(
            Iv::point(self.bottom) * Iv::point(1000.) - z,
            max_iv(z - Iv::point(self.top) * Iv::point(1000.), Iv::point(0.)),
        );
        Ok((
            finite(
                planar.norm3(dz, Iv::point(0.))
                    * Iv {
                        m: 1.,
                        r: self.metric_defect()?,
                    },
            )?,
            false,
        ))
    }
}
fn min_iv(a: Iv, b: Iv) -> Iv {
    a.min(b)
}
fn max_iv(a: Iv, b: Iv) -> Iv {
    a.max(b)
}

pub const ENDS: [[usize; 2]; 12] = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
];
pub const USES: [[(usize, bool); 4]; 6] = [
    [(0, true), (1, true), (2, true), (3, true)],
    [(7, false), (6, false), (5, false), (4, false)],
    [(8, true), (4, true), (9, false), (0, false)],
    [(9, true), (5, true), (10, false), (1, false)],
    [(10, true), (6, true), (11, false), (2, false)],
    [(11, true), (7, true), (8, false), (3, false)],
];
fn carriers(s: &Sector) -> R<Vec<SurfaceGeometry>> {
    let plane = |o, n, x| -> R<SurfaceGeometry> {
        Ok(SurfaceGeometry::Plane {
            origin: v(o)?,
            normal: v(n)?,
            x: v(x)?,
        })
    };
    let cylinder = |r| -> R<SurfaceGeometry> {
        Ok(SurfaceGeometry::Cylinder {
            origin: v([0.; 3])?,
            axis: v([0., 0., 1.])?,
            x: v([1., 0., 0.])?,
            radius: b(r)?,
        })
    };
    Ok(vec![
        plane([0.; 3], [0., -1., 0.], [1., 0., 0.])?,
        plane([0.; 3], [-1., 0., 0.], [0., 1., 0.])?,
        plane([0., 0., s.bottom], [0., 0., -1.], [1., 0., 0.])?,
        cylinder(s.outer)?,
        plane([0., 0., s.top], [0., 0., 1.], [1., 0., 0.])?,
        cylinder(s.inner)?,
    ])
}
pub fn build(
    key: BodyKey,
    source: [u32; 4],
    frame: Affine,
    segments: &[[f64; 4]],
    angle: f64,
) -> R<Body> {
    let s = parameters(frame, segments, angle)?;
    let points = s.points();
    let provenance = Provenance::Construction { node: NodeId(1) };
    let mut parameters: Vec<f64> = frame
        .origin
        .into_iter()
        .chain(frame.x)
        .chain(frame.z)
        .chain([angle])
        .collect();
    parameters.extend(segments.iter().flatten());
    let mut body = Body {
        key,
        frames: vec![
            Frame::Source { source },
            Frame::Interpreter {
                parent: FrameId(0),
                origin: v(frame.origin)?,
                x: v(frame.x)?,
                z: v(frame.z)?,
            },
        ],
        constructions: vec![
            Construction {
                operation: Operation::Interpreter {},
                rule_version: 1,
                parents: vec![],
                parameters: parameters.into_iter().map(b).collect::<R<_>>()?,
                frame: FrameId(0),
            },
            Construction {
                operation: Operation::Revolve {},
                rule_version: 1,
                parents: vec![NodeId(0)],
                parameters: vec![],
                frame: FrameId(1),
            },
        ],
        vertices: vec![],
        curves: vec![],
        pcurves: vec![],
        surfaces: vec![],
        edges: vec![],
        coedges: vec![],
        loops: vec![],
        faces: vec![],
        shells: vec![],
        solids: vec![],
        facts: vec![],
        budgets: vec![],
    };
    for p in points {
        body.vertices.push(Vertex {
            point: v(p)?,
            frame: FrameId(1),
            provenance: provenance.clone(),
        });
    }
    for geometry in carriers(&s)? {
        body.surfaces.push(Surface {
            geometry,
            frame: FrameId(1),
            provenance: provenance.clone(),
        });
    }
    for (i, [a, c]) in ENDS.into_iter().enumerate() {
        let geometry = if i < 8 {
            CurveGeometry::Line {
                a: v(points[a])?,
                b: v(points[c])?,
            }
        } else {
            CurveGeometry::Circle {
                origin: v([0., 0., points[a][2]])?,
                normal: v([0., 0., 1.])?,
                x: v([1., 0., 0.])?,
                radius: b(points[a][0])?,
                arc: ArcKind::Trimmed {},
            }
        };
        let domain = domain(if i < 8 { 1. } else { 0.25 })?;
        body.curves.push(Curve {
            geometry,
            frame: FrameId(1),
            provenance: provenance.clone(),
            domain: domain.clone(),
            supports: vec![],
        });
        body.edges.push(Edge {
            curve: CurveId(i as u32),
            domain,
            vertices: vec![VertexId(a as u32), VertexId(c as u32)],
        });
    }
    for (surface, uses) in USES.iter().enumerate() {
        let mut coedges = vec![];
        for &(edge, forward) in uses {
            let id = PcurveId(body.pcurves.len() as u32);
            let [a, c] = ENDS[edge];
            let chart = |p: [f64; 3], end: bool| -> R<[Binary64; 2]> {
                let q = match surface {
                    0 => [p[0], p[2]],
                    1 => [p[1], -p[2]],
                    2 => [p[0], -p[1]],
                    4 => [p[0], p[1]],
                    _ => [if end { std::f64::consts::FRAC_PI_2 } else { 0. }, p[2]],
                };
                Ok([b(q[0])?, b(q[1])?])
            };
            let is_end = |p: [f64; 3]| p[0] == 0.;
            // A coarse but explicit diagnostic enclosure. Source circles and
            // their analytic carrier incidence, not this chart polyline, own
            // the exact trim. The exporter emits an analytic circle directly.
            let geometry = if edge >= 8 || surface == 3 || surface == 5 {
                let error = if surface == 3 || surface == 5 {
                    pi()?.r + 4. * f64::EPSILON
                } else {
                    2. * s.outer
                };
                PcurveGeometry::Samples {
                    parameters: vec![b(0.)?, b(if edge >= 8 { 0.25 } else { 1. })?],
                    points: vec![
                        chart(points[a], is_end(points[a]))?,
                        chart(points[c], is_end(points[c]))?,
                    ],
                    error: Bound::Estimated {
                        estimate: Estimate {
                            magnitude: b(error)?,
                        },
                    },
                }
            } else {
                PcurveGeometry::Line {
                    a: chart(points[a], is_end(points[a]))?,
                    b: chart(points[c], is_end(points[c]))?,
                }
            };
            body.pcurves.push(Pcurve {
                curve: CurveId(edge as u32),
                surface: SurfaceId(surface as u32),
                domain: body.edges[edge].domain.clone(),
                geometry,
            });
            body.curves[edge].supports.push(Support {
                surface: SurfaceId(surface as u32),
                pcurve: id,
            });
            coedges.push(CoedgeId(body.coedges.len() as u32));
            body.coedges.push(Coedge {
                edge: EdgeId(edge as u32),
                forward,
                pcurve: id,
            });
        }
        body.loops.push(Loop {
            outer: true,
            coedges,
        });
        body.faces.push(Face {
            surface: SurfaceId(surface as u32),
            forward: surface != 5,
            loops: vec![LoopId(surface as u32)],
        });
    }
    body.shells.push(Shell {
        faces: (0..6).map(FaceId).collect(),
    });
    body.solids.push(Solid {
        shells: vec![ShellId(0)],
    });
    body.clone().check().map_err(|_| no("contract"))?;
    Ok(body)
}

/// Independent boundary audit: exact carrier/endpoint incidence, paired edge
/// uses, oriented closed loops, and a bijection to the source rectangle.
/// Does not call the builder or accept a volume/construction receipt as proof.
pub fn audit(checked: &CheckedBody) -> R<Sector> {
    let body = checked.body();
    let fail = || no("construction-body-mismatch");
    if body.frames.len() != 2
        || body.constructions.len() != 2
        || body.vertices.len() != 8
        || body.curves.len() != 12
        || body.edges.len() != 12
        || body.surfaces.len() != 6
        || body.faces.len() != 6
        || body.loops.len() != 6
        || body.coedges.len() != 24
        || body.pcurves.len() != 24
        || body.shells.len() != 1
        || body.solids.len() != 1
        || !body.facts.is_empty()
        || !body.budgets.is_empty()
    {
        return Err(fail());
    }
    let n = &body.constructions[0];
    let p: Vec<_> = n.parameters.iter().map(|x| x.get()).collect();
    if p.len() != 26
        || n.operation != (Operation::Interpreter {})
        || n.rule_version != 1
        || !n.parents.is_empty()
        || n.frame != FrameId(0)
        || body.constructions[1]
            != (Construction {
                operation: Operation::Revolve {},
                rule_version: 1,
                parents: vec![NodeId(0)],
                parameters: vec![],
                frame: FrameId(1),
            })
    {
        return Err(fail());
    }
    let frame = Affine {
        origin: [p[0], p[1], p[2]],
        x: [p[3], p[4], p[5]],
        z: [p[6], p[7], p[8]],
    };
    let segments: Vec<_> = p[10..]
        .chunks_exact(4)
        .map(|s| [s[0], s[1], s[2], s[3]])
        .collect();
    let s = parameters(frame, &segments, p[9])?;
    if !matches!(body.frames[0], Frame::Source { .. })
        || body.frames[1]
            != (Frame::Interpreter {
                parent: FrameId(0),
                origin: v(frame.origin)?,
                x: v(frame.x)?,
                z: v(frame.z)?,
            })
        || body.solids[0].shells != [ShellId(0)]
    {
        return Err(fail());
    }
    let provenance = Provenance::Construction { node: NodeId(1) };
    let mut codes = vec![];
    let mut points = vec![];
    for vertex in &body.vertices {
        let q = vertex.point.map(Binary64::get);
        if vertex.frame != FrameId(1)
            || vertex.provenance != provenance
            || !(q[2] == s.bottom || q[2] == s.top)
        {
            return Err(fail());
        }
        let radius = if q[1] == 0. {
            q[0]
        } else if q[0] == 0. {
            q[1]
        } else {
            return Err(fail());
        };
        if radius != s.inner && radius != s.outer {
            return Err(fail());
        }
        let code = (q[0] == 0.) as u8 * 4 + (radius == s.outer) as u8 * 2 + (q[2] == s.top) as u8;
        if codes.contains(&code) {
            return Err(fail());
        }
        codes.push(code);
        points.push(q);
    }
    let mut surface_kind = vec![];
    for surface in &body.surfaces {
        if surface.frame != FrameId(1) || surface.provenance != provenance {
            return Err(fail());
        }
        let kind = match &surface.geometry {
            SurfaceGeometry::Plane { origin, normal, x } => {
                let (o, n, x) = (
                    origin.map(Binary64::get),
                    normal.map(Binary64::get),
                    x.map(Binary64::get),
                );
                match (o, n, x) {
                    ([0., 0., 0.], [0., -1., 0.], [1., 0., 0.]) => 0,
                    ([0., 0., 0.], [-1., 0., 0.], [0., 1., 0.]) => 1,
                    ([0., 0., z], [0., 0., -1.], [1., 0., 0.]) if z == s.bottom => 2,
                    ([0., 0., z], [0., 0., 1.], [1., 0., 0.]) if z == s.top => 4,
                    _ => return Err(fail()),
                }
            }
            SurfaceGeometry::Cylinder {
                origin,
                axis,
                x,
                radius,
            } => {
                if origin.map(Binary64::get) != [0.; 3]
                    || axis.map(Binary64::get) != [0., 0., 1.]
                    || x.map(Binary64::get) != [1., 0., 0.]
                {
                    return Err(fail());
                }
                if radius.get() == s.outer {
                    3
                } else if radius.get() == s.inner {
                    5
                } else {
                    return Err(fail());
                }
            }
            _ => return Err(fail()),
        };
        if surface_kind.contains(&kind) {
            return Err(fail());
        }
        surface_kind.push(kind);
    }
    let on = |kind: usize, q: [f64; 3]| match kind {
        0 => q[1] == 0.,
        1 => q[0] == 0.,
        2 => q[2] == s.bottom,
        4 => q[2] == s.top,
        3 => q[0] + q[1] == s.outer,
        5 => q[0] + q[1] == s.inner,
        _ => false,
    };
    let mut edge_pairs = vec![];
    let mut circular = vec![];
    for (i, edge) in body.edges.iter().enumerate() {
        if edge.curve.0 as usize != i {
            return Err(fail());
        }
        let [a, bv] = [edge.vertices[0], edge.vertices[1]].map(|i| i.0 as usize);
        let (qa, qb) = (points[a], points[bv]);
        let pair = if a < bv { (a, bv) } else { (bv, a) };
        if a == bv || edge_pairs.contains(&pair) {
            return Err(fail());
        }
        edge_pairs.push(pair);
        let curve = &body.curves[i];
        if curve.frame != FrameId(1) || curve.provenance != provenance || curve.supports.len() != 2
        {
            return Err(fail());
        }
        let circle = match &curve.geometry {
            CurveGeometry::Line { a, b } => {
                if a.map(Binary64::get) != qa
                    || b.map(Binary64::get) != qb
                    || (qa[0] == 0.) != (qb[0] == 0.)
                    || (0..3).filter(|&k| qa[k] != qb[k]).count() != 1
                {
                    return Err(fail());
                }
                false
            }
            CurveGeometry::Circle {
                origin,
                normal,
                x,
                radius,
                arc,
            } => {
                let r = radius.get();
                if qa != [r, 0., qa[2]]
                    || qb != [0., r, qa[2]]
                    || origin.map(Binary64::get) != [0., 0., qa[2]]
                    || normal.map(Binary64::get) != [0., 0., 1.]
                    || x.map(Binary64::get) != [1., 0., 0.]
                    || *arc != (ArcKind::Trimmed {})
                {
                    return Err(fail());
                }
                true
            }
            _ => return Err(fail()),
        };
        let d = domain(if circle { 0.25 } else { 1. })?;
        if edge.domain != d || curve.domain != d {
            return Err(fail());
        }
        circular.push(circle);
    }
    let mut surfaces_seen = vec![];
    let mut faces_seen = vec![];
    let mut loops_seen = vec![];
    let mut co_seen = vec![];
    let mut pc_seen = vec![];
    let mut uses = vec![vec![]; 12];
    for face_id in &body.shells[0].faces {
        if faces_seen.contains(face_id) {
            return Err(fail());
        }
        faces_seen.push(*face_id);
        let face = &body.faces[face_id.0 as usize];
        let surface = face.surface.0 as usize;
        let kind = surface_kind[surface];
        if surfaces_seen.contains(&surface) {
            return Err(fail());
        }
        surfaces_seen.push(surface);
        if face.forward != (kind != 5) || face.loops.len() != 1 {
            return Err(fail());
        }
        let lp_id = face.loops[0];
        if loops_seen.contains(&lp_id) {
            return Err(fail());
        }
        loops_seen.push(lp_id);
        let lp = &body.loops[lp_id.0 as usize];
        if !lp.outer || lp.coedges.len() != 4 {
            return Err(fail());
        }
        let mut starts = vec![];
        let mut ends = vec![];
        let mut winding = vec![];
        let mut g = ex::Guard::new();
        for cid in &lp.coedges {
            if co_seen.contains(cid) {
                return Err(fail());
            }
            co_seen.push(*cid);
            let co = &body.coedges[cid.0 as usize];
            let edge = co.edge.0 as usize;
            uses[edge].push(co.forward);
            let [a, bv] = [body.edges[edge].vertices[0], body.edges[edge].vertices[1]].map(|i| i.0 as usize);
            let (qa, qb) = (points[a], points[bv]);
            if !on(kind, qa) || !on(kind, qb) || (circular[edge] && (kind == 0 || kind == 1)) {
                return Err(fail());
            }
            starts.push(if co.forward { a } else { bv });
            ends.push(if co.forward { bv } else { a });
            if circular[edge] {
                let expected = match kind {
                    2 => qa[0] == s.inner,
                    4 => qa[0] == s.outer,
                    3 => qa[2] == s.bottom,
                    5 => qa[2] == s.top,
                    _ => return Err(fail()),
                };
                if co.forward != expected {
                    return Err(fail());
                }
            }
            // Meridian cap winding, independently accumulated in its own chart.
            if kind == 0 || kind == 1 {
                let k = if kind == 0 { 0 } else { 1 };
                let w = ex::sum(
                    &ex::product(qa[k], qb[2], &mut g),
                    &ex::neg(&ex::product(qb[k], qa[2], &mut g)),
                    &mut g,
                );
                winding = ex::sum(&winding, &if co.forward { w } else { ex::neg(&w) }, &mut g);
            }
            if pc_seen.contains(&co.pcurve) {
                return Err(fail());
            }
            pc_seen.push(co.pcurve);
            let pc = &body.pcurves[co.pcurve.0 as usize];
            if pc.curve != body.edges[edge].curve
                || pc.surface != face.surface
                || pc.domain != body.edges[edge].domain
            {
                return Err(fail());
            }
            let chart = |q: [f64; 3]| match kind {
                0 => [q[0], q[2]],
                1 => [q[1], -q[2]],
                2 => [q[0], -q[1]],
                4 => [q[0], q[1]],
                _ => [
                    if q[0] == 0. {
                        std::f64::consts::FRAC_PI_2
                    } else {
                        0.
                    },
                    q[2],
                ],
            };
            let expected = [chart(qa), chart(qb)];
            match &pc.geometry {
                PcurveGeometry::Line { a, b } if !circular[edge] && kind != 3 && kind != 5 => {
                    if a.map(Binary64::get) != expected[0] || b.map(Binary64::get) != expected[1] {
                        return Err(fail());
                    }
                }
                PcurveGeometry::Samples {
                    parameters,
                    points,
                    error: Bound::Estimated { estimate },
                } => {
                    let minimum = if kind == 3 || kind == 5 {
                        pi()?.r + 4. * f64::EPSILON
                    } else {
                        2. * s.outer
                    };
                    if parameters.len() != 2
                        || points.len() != 2
                        || parameters[0].get() != 0.
                        || parameters[1].get() != if circular[edge] { 0.25 } else { 1. }
                        || points[0].map(Binary64::get) != expected[0]
                        || points[1].map(Binary64::get) != expected[1]
                        || estimate.magnitude.get() < minimum
                    {
                        return Err(fail());
                    }
                }
                _ => return Err(fail()),
            }
        }
        if (0..4).any(|i| ends[i] != starts[(i + 1) % 4])
            || !g.exact()
            || (kind == 0 && ex::sign(&winding) <= 0)
            || (kind == 1 && ex::sign(&winding) >= 0)
        {
            return Err(fail());
        }
    }
    if faces_seen.len() != 6
        || loops_seen.len() != 6
        || co_seen.len() != 24
        || pc_seen.len() != 24
        || uses.iter().any(|u| u.len() != 2 || u[0] == u[1])
    {
        return Err(fail());
    }
    Ok(s)
}
fn js(x: f64) -> String {
    format!("{:?}", if x == 0. { 0. } else { x })
}
fn xyz(p: [f64; 3]) -> String {
    format!("[{},{},{}]", js(p[0]), js(p[1]), js(p[2]))
}
impl Sector {
    pub fn measure_json(&self, map: Option<[[f64; 4]; 3]>, probes: &[[f64; 3]]) -> R<String> {
        let (vol, area) = self.measures()?;
        let bbox =
            |p: ([f64; 3], [f64; 3])| format!("{{\"min\":{},\"max\":{}}}", xyz(p.0), xyz(p.1));
        let mapped = match map {
            Some(m) => bbox(self.bbox(Some(m))?),
            None => "null".into(),
        };
        let probes = probes
            .iter()
            .map(|&p| {
                self.probe(p).map(|(d, inside)| {
                    format!(
                        "{{\"distanceMm\":{},\"inside\":{inside},\"boundMm\":{}}}",
                        js(d.m),
                        js(d.r)
                    )
                })
            })
            .collect::<R<Vec<_>>>()?;
        let a = Iv::point(self.inner);
        let b = Iv::point(self.outer);
        let c = Iv::point(4.) / (Iv::point(3.) * pi()?) * (b * b + a * b + a * a) / (a + b);
        let z = (Iv::point(self.bottom) + Iv::point(self.top)) / Iv::point(2.);
        let centroid = self
            .frame
            .apply([c.m, c.m, z.m], 1000., true)
            .map_err(|_| no("measurement-range"))?;
        let mm = Iv::point(1000.);
        let r = Iv::point(self.inner) * mm;
        let outer = Iv::point(self.outer) * mm;
        let h = (Iv::point(self.top) - Iv::point(self.bottom)) * mm;
        let width = outer - r;
        let turn = pi()? / Iv::point(2.);
        let cap = width * h;
        let annulus = turn / Iv::point(2.) * (outer - r) * (outer + r);
        let areas = [cap, cap, annulus, turn * outer * h, annulus, turn * r * h];
        let lengths = [
            Iv::point(2.) * (width + h),
            Iv::point(2.) * (width + h),
            turn * (r + outer) + Iv::point(2.) * width,
            Iv::point(2.) * (turn * outer + h),
            turn * (r + outer) + Iv::point(2.) * width,
            Iv::point(2.) * (turn * r + h),
        ];
        let distortion = Iv {
            m: 1.,
            r: self.metric_defect()?,
        };
        let areas = areas
            .into_iter()
            .map(|a| finite(a * distortion).map(|a| js(a.m)))
            .collect::<R<Vec<_>>>()?
            .join(",");
        let lengths = lengths
            .into_iter()
            .map(|a| finite(a * distortion).map(|a| js(a.m)))
            .collect::<R<Vec<_>>>()?
            .join(",");
        let points = self.world_points()?;
        let edges = ENDS
            .iter()
            .map(|[a, b]| format!("[{a},{b}]"))
            .collect::<Vec<_>>()
            .join(",");
        let faces = USES
            .iter()
            .map(|u| {
                format!(
                    "[[{}]]",
                    u.iter()
                        .map(|(e, f)| format!("[{e},{f}]"))
                        .collect::<Vec<_>>()
                        .join(",")
                )
            })
            .collect::<Vec<_>>()
            .join(",");
        Ok(format!(concat!("{{\"basis\":\"native-f64-construction\",\"certificate\":\"QuarterAnnularSector\",\"boundToConstruction\":true,",
            "\"volumeMm3\":{},\"volumeRelBound\":{},\"volumeEnclosureMm3\":[{},{}],\"areaMm2\":{},\"areaRelBound\":{},\"areaEnclosureMm2\":[{},{}],",
            "\"faceAreasMm2\":[{}],\"facePerimetersMm\":[{}],\"centroidMm\":{},\"bboxMm\":{},\"mappedBboxMm\":{},\"topology\":{{\"bodies\":1,\"shells\":1,\"faces\":6,\"edges\":12,\"vertices\":8,\"loops\":6,\"ringEdges\":0,\"closedToroidalFaces\":0,\"genus\":0,\"singularPoints\":0,\"pinchPoints\":0}},",
            "\"validity\":{{\"brep\":true,\"closed\":true,\"positive\":true}},\"toleranceMm\":{},\"frame\":{{\"orthonormalityDefect\":{}}},\"probes\":[{}],",
            "\"projection\":{{\"vertices\":[{}],\"edges\":[{}],\"faces\":[{}]}}}}"),
            js(vol.m),js((vol.r/vol.m).next_up()),js(vol.lo()),js(vol.hi()),js(area.m),js((area.r/area.m).next_up()),js(area.lo()),js(area.hi()),
            areas,lengths,xyz(centroid),bbox(self.bbox(None)?),mapped,js(self.tolerance()?),js(self.metric_defect()?),probes.join(","),points.into_iter().map(xyz).collect::<Vec<_>>().join(","),edges,faces))
    }
}
