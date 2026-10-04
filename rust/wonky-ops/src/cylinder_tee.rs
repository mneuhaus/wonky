//! Union of transverse unequal perpendicular cylinders with an interior branch
//! cap. Extends the bicylinder analytic-carrier/replay design to radical SSI.
//! Admission is parametric in both radii, all coordinate axes, both branch
//! directions and cap positions. Other cap arrangements and skew axes refuse.
//! The ring is the exact simultaneous zero set of the two cylinder quadrics;
//! R>r proves two disjoint regular branches, of which the union retains one.
use crate::{
    affine::Affine,
    cylinder::{self, Cylinder, Spec},
    polyhedron::Refused,
};
use wonky_contract::*;
use wonky_num::{
    expansion::{self as ex, Guard},
    Iv,
};
use wonky_validated::{integrate, Expr};
type R<T> = std::result::Result<T, Refused>;
pub(crate) fn no(s: &str) -> Refused {
    Refused(format!("cylinder-tee/{s}"))
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
pub(crate) fn axis(k: usize, sign: f64) -> [f64; 3] {
    let mut a = [0.; 3];
    a[k] = sign;
    a
}
pub(crate) fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
fn domain() -> Domain {
    Domain {
        lower: Limit::Finite {
            value: b(0.).unwrap(),
            closed: true,
        },
        upper: Limit::Finite {
            value: b(1.).unwrap(),
            closed: true,
        },
    }
}
fn positive_sum(terms: &[f64]) -> R<bool> {
    let mut g = Guard::new();
    let e = terms.iter().fold(vec![], |a, &x| ex::sum(&a, &[x], &mut g));
    if !g.exact() {
        return Err(no("predicate-range"));
    }
    Ok(ex::sign(&e) > 0)
}
#[derive(Clone, Copy, Debug)]
pub(crate) struct Arrangement {
    pub post: Spec,
    pub branch: Spec,
    pub center: [f64; 3],
    pub i: usize,
    pub j: usize,
    pub sign: f64,
}
impl Arrangement {
    pub fn axes(&self) -> ([f64; 3], [f64; 3], [f64; 3]) {
        let (z, x) = (axis(self.i, 1.), axis(self.j, self.sign));
        (x, cross(z, x), z)
    }
    pub fn end(&self) -> [f64; 3] {
        if self.sign > 0. {
            self.branch.top
        } else {
            self.branch.bottom
        }
    }
}
fn classify(a: Spec, b: Spec) -> R<Arrangement> {
    let (post, branch) = if a.radius > b.radius { (a, b) } else { (b, a) };
    let (i, j) = (post.axis()?, branch.axis()?);
    if i == j {
        return Err(no("parallel-axes"));
    }
    if post.radius == branch.radius {
        return Err(no("equal-radius-tangency"));
    }
    let k = 3 - i - j;
    if post.bottom[k] != branch.bottom[k] {
        return Err(no("skew-axes"));
    }
    let mut center = post.bottom;
    center[i] = branch.bottom[i];
    let sign = if branch.bottom[j] == center[j] {
        1.
    } else if branch.top[j] == center[j] {
        -1.
    } else {
        return Err(no("branch-cap-arrangement"));
    };
    let end = if sign > 0. {
        branch.top[j]
    } else {
        branch.bottom[j]
    };
    if !positive_sum(&[sign * end, -sign * center[j], -post.radius])?
        || !positive_sum(&[center[i], -branch.radius, -post.bottom[i]])?
        || !positive_sum(&[post.top[i], -center[i], -branch.radius])?
    {
        return Err(no("end-cap-arrangement"));
    }
    Ok(Arrangement {
        post,
        branch,
        center,
        i,
        j,
        sign,
    })
}
#[derive(Clone, Debug)]
pub struct Tee {
    pub body: Body,
    pub frame: Affine,
    pub(crate) arrangement: Arrangement,
}
pub fn is_candidate(body: &Body) -> bool {
    body.curves
        .iter()
        .any(|c| matches!(c.geometry, CurveGeometry::CylinderIntersection { .. }))
}
pub fn union(key: BodyKey, a: &Cylinder, b: &Cylinder) -> R<Body> {
    if a.frame != b.frame {
        return Err(no("different-exact-frames"));
    }
    let arrangement = classify(a.spec, b.spec)?;
    let nodes = crate::bicylinder::boolean_nodes(a, b, 0)?;
    assemble(key, arrangement, a.frame.as_affine()?, nodes)
}
fn assemble(key: BodyKey, s: Arrangement, frame: Affine, nodes: Vec<Construction>) -> R<Body> {
    crate::bicylinder::frame_ok(frame)?;
    let mut out = Body {
        key,
        frames: vec![
            Frame::Source { source: [0; 4] },
            Frame::Interpreter {
                parent: FrameId(0),
                origin: v(frame.origin)?,
                x: v(frame.x)?,
                z: v(frame.z)?,
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
        node: NodeId(out.constructions.len() as u32 - 1),
    };
    let (x, _y, z) = s.axes();
    // Source origins are retained verbatim. No rounded endpoint differences
    // enter a surface, a ring, or its exact pullback.
    for (o, n, xx, r) in [
        (s.center, z, x, s.post.radius),
        (s.center, x, z, s.branch.radius),
    ] {
        out.surfaces.push(Surface {
            frame: FrameId(1),
            provenance: provenance.clone(),
            geometry: SurfaceGeometry::Cylinder {
                origin: v(o)?,
                axis: v(n)?,
                x: v(xx)?,
                radius: b(r)?,
            },
        });
    }
    for (o, n, xx, r) in [
        (s.post.bottom, z, x, s.post.radius),
        (s.post.top, z, x, s.post.radius),
        (s.end(), x, z, s.branch.radius),
    ] {
        out.surfaces.push(Surface {
            frame: FrameId(1),
            provenance: provenance.clone(),
            geometry: SurfaceGeometry::Plane {
                origin: v(o)?,
                normal: v(n)?,
                x: v(xx)?,
            },
        });
        out.curves.push(Curve {
            frame: FrameId(1),
            provenance: provenance.clone(),
            geometry: CurveGeometry::Circle {
                origin: v(o)?,
                normal: v(n)?,
                x: v(xx)?,
                radius: b(r)?,
                arc: ArcKind::Full {},
            },
            domain: domain(),
            supports: vec![],
        });
    }
    out.curves.push(Curve {
        frame: FrameId(1),
        provenance: provenance.clone(),
        geometry: CurveGeometry::CylinderIntersection {
            origin: v(s.center)?,
            large_axis: v(z)?,
            small_axis: v(x)?,
            large_radius: b(s.post.radius)?,
            small_radius: b(s.branch.radius)?,
        },
        domain: domain(),
        supports: vec![],
    });
    for e in 0..4 {
        out.edges.push(Edge {
            curve: CurveId(e),
            domain: domain(),
            vertices: vec![],
        });
    }
    // Pcurves for circles use exact representability or a named refusal; the
    // quartic uses an analytic pullback, not samples pretending to be exact.
    for (e, side, cap, origin, ax) in [
        (0, 0, 2, s.post.bottom, s.i),
        (1, 0, 3, s.post.top, s.i),
        (2, 1, 4, s.end(), s.j),
    ] {
        let h = crate::axial::exact_add(origin[ax], -s.center[ax])?
            * if side == 1 { s.sign } else { 1. };
        for (surface, geometry) in [
            (
                side,
                PcurveGeometry::Line {
                    a: v2([0., h])?,
                    b: v2([1., h])?,
                },
            ),
            (
                cap,
                PcurveGeometry::Circle {
                    origin: v2([0., 0.])?,
                    radius: b(if side == 0 {
                        s.post.radius
                    } else {
                        s.branch.radius
                    })?,
                    clockwise: false,
                },
            ),
        ] {
            let pc = PcurveId(out.pcurves.len() as u32);
            out.pcurves.push(Pcurve {
                curve: CurveId(e),
                surface: SurfaceId(surface),
                domain: domain(),
                geometry,
            });
            out.curves[e as usize].supports.push(Support {
                surface: SurfaceId(surface),
                pcurve: pc,
            });
        }
    }
    for surface in 0..2 {
        let pc = PcurveId(out.pcurves.len() as u32);
        out.pcurves.push(Pcurve {
            curve: CurveId(3),
            surface: SurfaceId(surface),
            domain: domain(),
            geometry: PcurveGeometry::CylinderIntersection {},
        });
        out.curves[3].supports.push(Support {
            surface: SurfaceId(surface),
            pcurve: pc,
        });
    }
    for (surface, forward, uses) in [
        (0, true, vec![(0, true), (1, false), (3, false)]),
        (1, true, vec![(3, true), (2, false)]),
        (2, false, vec![(0, false)]),
        (3, true, vec![(1, true)]),
        (4, true, vec![(2, true)]),
    ] {
        let mut loops = vec![];
        for (e, sense) in uses {
            let pcurve = out.curves[e]
                .supports
                .iter()
                .find(|p| p.surface == SurfaceId(surface))
                .unwrap()
                .pcurve;
            let u = CoedgeId(out.coedges.len() as u32);
            out.coedges.push(Coedge {
                edge: EdgeId(e as u32),
                forward: sense,
                pcurve,
            });
            loops.push(LoopId(out.loops.len() as u32));
            out.loops.push(Loop {
                outer: !(surface == 0 && e == 3),
                coedges: vec![u],
            });
        }
        out.faces.push(Face {
            surface: SurfaceId(surface),
            forward,
            loops,
        });
    }
    out.shells.push(Shell {
        faces: (0..5).map(FaceId).collect(),
    });
    out.solids.push(Solid {
        shells: vec![ShellId(0)],
    });
    out.clone()
        .check()
        .map_err(|e| no(&format!("contract-{e:?}")))?;
    Ok(out)
}
pub fn audit(checked: &CheckedBody) -> R<Tee> {
    let body = checked.body();
    let n = body
        .constructions
        .last()
        .ok_or_else(|| no("construction"))?;
    if !is_candidate(body)
        || n.operation != (Operation::Boolean {})
        || n.rule_version != 1
        || n.frame != FrameId(1)
        || n.parents.len() != 2
        || n.parameters.len() != 1
        || n.parameters[0].get() != 0.
    {
        return Err(no("construction"));
    }
    let a = cylinder::replay(&body.constructions, n.parents[0].0 as usize, &mut 1024)?;
    let b = cylinder::replay(&body.constructions, n.parents[1].0 as usize, &mut 1024)?;
    let arrangement = classify(a, b)?;
    let [Frame::Source { source }, Frame::Interpreter {
        parent,
        origin,
        x,
        z,
    }] = body.frames.as_slice()
    else {
        return Err(no("frame"));
    };
    if *source != [0; 4] || *parent != FrameId(0) {
        return Err(no("frame"));
    }
    let frame = Affine {
        origin: origin.each_ref().map(|b| b.get()),
        x: x.each_ref().map(|b| b.get()),
        z: z.each_ref().map(|b| b.get()),
    };
    let expected = assemble(
        body.key.clone(),
        arrangement,
        frame,
        body.constructions.clone(),
    )?;
    if *body != expected {
        return Err(no("construction-carrier-mismatch"));
    }
    Ok(Tee {
        body: body.clone(),
        frame,
        arrangement,
    })
}
impl Tee {
    pub fn transform(&self, frame: Affine) -> R<Body> {
        assemble(
            self.body.key.clone(),
            self.arrangement,
            frame,
            self.body.constructions.clone(),
        )
    }
    pub(crate) fn operands(&self) -> R<[Cylinder; 2]> {
        [self.arrangement.post, self.arrangement.branch]
            .map(|spec| {
                let c = cylinder::audit(
                    &cylinder::create(self.body.key.clone(), spec)?
                        .check()
                        .map_err(|_| no("operand-contract"))?,
                )?;
                cylinder::audit(
                    &cylinder::transform(&c, self.frame)?
                        .check()
                        .map_err(|_| no("operand-contract"))?,
                )
            })
            .into_iter()
            .collect::<R<Vec<_>>>()?
            .try_into()
            .map_err(|_| no("operands"))
    }
    /// Exact expressions in turns; units are millimetres for coordinates and
    /// radians for STEP cylinder angles. The native model stores no evaluated
    /// radical or trigonometric coordinate.
    pub(crate) fn ring_expressions(&self) -> R<([Expr; 3], [Expr; 2], [Expr; 2])> {
        let s = self.arrangement;
        let (x, y, z) = s.axes();
        let c = Expr::Constant;
        let tau = Expr::Bound(wonky_validated::pi(1e-14).map_err(|_| no("pi"))?) * c(2.);
        let theta = tau.clone() * Expr::Variable;
        let sn = theta.clone().sin();
        let cs = theta.clone().cos();
        let r = c(s.branch.radius) * c(1000.);
        let big = c(s.post.radius) * c(1000.);
        let xx = (big.clone().square() - (r.clone() * sn.clone()).square()).sqrt();
        let yy = -r.clone() * sn.clone();
        let zz = r.clone() * cs;
        let coords = std::array::from_fn(|k| {
            c(s.center[k]) * c(1000.)
                + c(x[k]) * xx.clone()
                + c(y[k]) * yy.clone()
                + c(z[k]) * zz.clone()
        });
        let post = [(-(c(s.branch.radius) / c(s.post.radius)) * sn).asin(), zz];
        let branch = [theta, xx];
        Ok((coords, post, branch))
    }
    fn measures(&self) -> R<(Iv, [Iv; 5], Iv, [Iv; 3])> {
        use cylinder::{enclosed, finite};
        let p = Iv::point;
        let c = Expr::Constant;
        let s = self.arrangement;
        let pi_e = wonky_validated::pi(1e-14).map_err(|_| no("pi"))?;
        let pi = pi_e.ball();
        let half_pi = Expr::Bound(pi_e) * c(0.5);
        let theta = half_pi.clone() * Expr::Variable;
        let sn = theta.clone().sin();
        let cs = theta.cos();
        let k = c(s.branch.radius) / c(s.post.radius);
        let radical = (c(1.) - (k.clone() * sn.clone()).square()).sqrt();
        let quad = |f: Expr| -> R<Iv> {
            Ok(integrate(&(half_pi.clone() * f), 0., 1., 2e-12, 65536)
                .map_err(|e| no(&format!("integration-{e}")))?
                .enclosure
                .ball())
        };
        let e = quad(radical.clone())?;
        let vcap = quad(cs.clone().square() * radical.clone())?;
        let hole = quad(cs.clone().square() / radical.clone())?;
        let length = quad((c(1.) + (k * sn * cs / radical).square()).sqrt())?;
        let big = p(s.post.radius) * p(1000.);
        let r = p(s.branch.radius) * p(1000.);
        let h = (p(s.post.top[s.i]) - p(s.post.bottom[s.i])) * p(1000.);
        let l = (p(s.end()[s.j]) - p(s.center[s.j])) * p(s.sign) * p(1000.);
        let overlap = p(4.) * r * r * big * vcap;
        let post_v = pi * big * big * h;
        let branch_v = pi * r * r * l;
        let v = post_v + branch_v - overlap;
        let defect = self
            .frame
            .orthonormality_defect()
            .map_err(|_| no("frame-range"))?;
        let scale = Iv {
            m: 1.,
            r: (3. * defect).next_up(),
        };
        let areas = [
            p(2.) * pi * big * h - p(4.) * r * r * hole,
            p(2.) * pi * r * l - p(4.) * r * big * e,
            pi * big * big,
            pi * big * big,
            pi * r * r,
        ]
        .map(|a| a * scale);
        for a in areas {
            finite(a)?;
        }
        let volume = finite(v * enclosed(&self.frame.det_exact().map_err(|_| no("frame-range"))?))?;
        if volume.lo() <= 0.
            || volume.r / volume.m > 1e-9
            || areas.iter().any(|a| a.lo() <= 0. || a.r / a.m > 1e-9)
        {
            return Err(no("observation-width"));
        }
        let mut centroid = s.center.map(|x| p(x) * p(1000.));
        // First moments of the overlap are polynomial despite its elliptic volume.
        centroid[s.j] = centroid[s.j]
            + p(s.sign)
                * (branch_v * l * p(0.5) - pi * r * r * p(0.5) * (big * big - r * r * p(0.25)))
                / v;
        centroid[s.i] = centroid[s.i]
            + post_v
                * ((p(s.post.bottom[s.i]) + p(s.post.top[s.i])) * p(0.5) - p(s.center[s.i]))
                * p(1000.)
                / v;
        for coordinate in centroid {
            finite(coordinate)?;
        }
        Ok((volume, areas, finite(p(4.) * r * length * scale)?, centroid))
    }
    pub fn measures_mm(&self) -> R<(Iv, Iv)> {
        let (v, a, _, _) = self.measures()?;
        Ok((v, a.into_iter().fold(Iv::point(0.), |s, a| s + a)))
    }
    pub fn bbox_mm(&self, map: Option<[[f64; 4]; 3]>) -> R<([f64; 3], [f64; 3])> {
        let [a, b] = self.operands()?;
        let (al, ah) = a.bbox_mm(map)?;
        let (bl, bh) = b.bbox_mm(map)?;
        Ok((
            std::array::from_fn(|i| al[i].min(bl[i])),
            std::array::from_fn(|i| ah[i].max(bh[i])),
        ))
    }
    pub fn tolerance_mm(&self) -> R<f64> {
        let [a, b] = self.operands()?;
        Ok(a.tolerance_mm()?.max(b.tolerance_mm()?))
    }
    pub fn probe(&self, q: [f64; 3]) -> R<(f64, bool, f64)> {
        let [a, b] = self.operands()?;
        let (da, ia, ea) = a.probe(q)?;
        let (db, ib, eb) = b.probe(q)?;
        if ia || ib {
            return Ok((0., true, 0.));
        }
        // Distance to a union is the minimum of distances, including bounds.
        let aa = Iv { m: da, r: ea };
        let bb = Iv { m: db, r: eb };
        let lo = aa.lo().min(bb.lo()).max(0.);
        let hi = aa.hi().min(bb.hi()).max(0.);
        let m = lo * 0.5 + hi * 0.5;
        Ok((m, false, (hi - m).max(m - lo).next_up()))
    }
    /// Raw export topology has four ring seam vertices and two periodic seams;
    /// they are deliberately absent from the canonical native boundary.
    pub(crate) fn export_vertices_mm(&self) -> R<[[f64; 3]; 4]> {
        let s = self.arrangement;
        let (x, _, z) = s.axes();
        let rings = [
            (s.post.bottom, x.map(|v| -v * s.post.radius)),
            (s.post.top, x.map(|v| -v * s.post.radius)),
            (s.end(), z.map(|v| v * s.branch.radius)),
            (
                s.center,
                std::array::from_fn(|k| x[k] * s.post.radius + z[k] * s.branch.radius),
            ),
        ];
        let mut points = [[0.; 3]; 4];
        for (i, (o, d)) in rings.into_iter().enumerate() {
            let a = self
                .frame
                .apply_exact(o, 1000., true)
                .map_err(|_| no("export-range"))?;
            let d = self
                .frame
                .apply_exact(d, 1000., false)
                .map_err(|_| no("export-range"))?;
            let mut g = Guard::new();
            for k in 0..3 {
                points[i][k] = crate::rounding::round(&ex::sum(&a[k], &d[k], &mut g))
                    .map_err(|_| no("export-range"))?;
            }
            if !g.exact() {
                return Err(no("export-range"));
            }
        }
        Ok(points)
    }
    pub fn measure_json(&self, map: Option<[[f64; 4]; 3]>, probes: &[[f64; 3]]) -> R<String> {
        let (volume, areas, ring, centroid) = self.measures()?;
        let area = areas.iter().fold(Iv::point(0.), |s, &a| s + a);
        let (lo, hi) = self.bbox_mm(None)?;
        let mapped = if let Some(m) = map {
            let (l, h) = self.bbox_mm(Some(m))?;
            format!("{{\"min\":{l:?},\"max\":{h:?}}}")
        } else {
            "null".into()
        };
        let mut g = Guard::new();
        let y = self.frame.y_exact(&mut g);
        if !g.exact() {
            return Err(no("frame-range"));
        }
        let cols = [
            self.frame.x.map(Iv::point),
            y.each_ref().map(|x| cylinder::enclosed(x)),
            self.frame.z.map(Iv::point),
        ];
        let centroid: [f64; 3] = std::array::from_fn(|i| {
            (Iv::point(self.frame.origin[i]) * Iv::point(1000.)
                + (0..3).fold(Iv::point(0.), |a, k| a + cols[k][i] * centroid[k]))
            .m
        });
        let pi = wonky_validated::pi(1e-14).map_err(|_| no("pi"))?.ball();
        let s = self.arrangement;
        let big = 2. * pi.m * s.post.radius * 1000.;
        let small = 2. * pi.m * s.branch.radius * 1000.;
        let post_seam = (s.post.top[s.i] - s.post.bottom[s.i]) * 1000.;
        let branch_seam = ((s.end()[s.j] - s.center[s.j]) * s.sign - s.post.radius) * 1000.;
        let perimeters = [
            2. * big + ring.m + 2. * post_seam,
            small + ring.m + 2. * branch_seam,
            big,
            big,
            small,
        ];
        let vertices = self.export_vertices_mm()?;
        let areas = areas.map(|a| a.m);
        let tolerance = self.tolerance_mm()?;
        // Declared, not silent: STEP carries the exact ring as bounded cubic
        // B-splines. The native carrier and every measure above stay exact.
        let step_budget = crate::cylinder_tee_step::tolerance_mm(self)?;
        let probes = probes
            .iter()
            .map(|&q| match self.probe(q) {
                Ok((d, i, e)) => {
                    format!("{{\"distanceMm\":{d:?},\"inside\":{i},\"boundMm\":{e:?}}}")
                }
                Err(e) => format!("{{\"refused\":\"{}\"}}", e.0),
            })
            .collect::<Vec<_>>()
            .join(",");
        Ok(format!(concat!("{{\"basis\":\"native-f64-construction\",\"certificate\":\"PerpendicularCylinderUnion\",\"boundToConstruction\":true,",
            "\"volumeMm3\":{:?},\"volumeRelBound\":{:?},\"areaMm2\":{:?},\"areaRelBound\":{:?},\"centroidMm\":{centroid:?},",
            "\"bboxMm\":{{\"min\":{lo:?},\"max\":{hi:?}}},\"mappedBboxMm\":{mapped},",
            "\"topology\":{{\"bodies\":1,\"shells\":1,\"faces\":5,\"edges\":4,\"vertices\":0,\"loops\":8,\"ringEdges\":4,\"closedToroidalFaces\":0,\"genus\":0,\"singularPoints\":0,\"pinchPoints\":0}},",
            "\"validity\":{{\"brep\":true,\"closed\":true,\"positive\":true}},\"toleranceMm\":{tolerance:?},\"exportApproximation\":{{\"format\":\"step\",\"curves\":\"bounded cubic B-spline\",\"budgetMm\":{step_budget:?}}},\"probes\":[{probes}],\"faceAreasMm2\":{areas:?},\"facePerimetersMm\":{perimeters:?},",
            "\"projection\":{{\"vertices\":{vertices:?},\"edges\":[[0,0],[1,1],[2,2],[3,3],[0,1],[3,2]],\"faces\":[[[[0,true],[4,true],[1,false],[4,false]],[[3,false]]],[[[3,true],[5,true],[2,false],[5,false]]],[[[0,false]]],[[[1,true]]],[[[2,true]]]]}}}}"),volume.m,volume.r/volume.m,area.m,area.r/area.m,centroid=centroid,lo=lo,hi=hi,mapped=mapped,tolerance=tolerance,step_budget=step_budget,probes=probes,areas=areas,perimeters=perimeters,vertices=vertices))
    }
}
