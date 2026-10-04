//! Serialization of an audited profile extrusion (three-point arcs, lines and,
//! for the rule 3 curve profiles of `curve_profile`, B-splines). Geometry
//! remains analytic, never polygonized: circle edges on cylindrical sides, and a
//! spline piece as `CurveGeometry::BSpline` edges (certified binary64 pole
//! caches at each level) on a `SurfaceGeometry::LinearExtrusion` side over
//! the lower edge, with `PcurveGeometry::BSpline` cap pcurves and (u, v) line
//! pcurves on the side (u the spline parameter, v the height above the lower
//! cap). A spline edge runs along its parameter; when the profile traverses the
//! piece the other way, the edge is stored reversed and its coedges flip.
use super::arc_profile::{b, no, ArcPrism, R};
use num_traits::ToPrimitive;
use wonky_contract::*;
use wonky_curve as wc;
fn v3(p: [f64; 3]) -> R<Vector3> {
    Ok([b(p[0])?, b(p[1])?, b(p[2])?])
}
fn v2(p: [f64; 2]) -> R<Vector2> {
    Ok([b(p[0])?, b(p[1])?])
}
fn domain(t: f64) -> R<Domain> {
    span(0., t)
}
fn span(lower: f64, upper: f64) -> R<Domain> {
    Ok(Domain {
        lower: Limit::Finite {
            value: b(lower)?,
            closed: true,
        },
        upper: Limit::Finite {
            value: b(upper)?,
            closed: true,
        },
    })
}
/// Knot and trim parameters must be exactly representable in binary64.
fn exact(x: &wc::Q) -> R<f64> {
    let f = x.to_f64().filter(|f| f.is_finite()).ok_or_else(|| no("spline-data-range"))?;
    if wc::numeric::q(f) != *x {
        return Err(no("spline-data-not-binary64"));
    }
    Ok(f)
}
/// A spline piece's binary64 observation cache. Knots and trim parameters
/// are exact; rational poles are rounded and checked by source replay.
pub(crate) struct Spline {
    pub(crate) degree: u32,
    pub(crate) knots: Vec<f64>,
    pub(crate) controls: Vec<[f64; 2]>,
    /// Spline parameters of the piece's first and second end.
    pub(crate) from: f64,
    pub(crate) to: f64,
}
impl Spline {
    /// Observation caches of an exact mapped carrier. The caller replays the
    /// rational map and includes control rounding in its export budget.
    pub(crate) fn mapped(k: &wc::carrier::SplineCarrier) -> R<Self> {
        if k.spline.is_rational() { return Err(no("rational-spline-unsupported")); }
        let cache = |q: &wc::Q| -> R<f64> { Ok(wc::numeric::enclose(q)?.m) };
        Ok(Self {
            degree: k.spline.degree() as u32,
            knots: k.spline.knots().iter().map(cache).collect::<R<_>>()?,
            controls: k.spline.poles().iter().map(|p| Ok([cache(&p[0])?, cache(&p[1])?])).collect::<R<_>>()?,
            from: cache(&k.from)?, to: cache(&k.to)?,
        })
    }

    fn new(k: &wc::carrier::SplineCarrier) -> R<Self> {
        if k.spline.is_rational() {
            return Err(no("rational-spline-unsupported"));
        }
        Ok(Self {
            degree: k.spline.degree() as u32,
            knots: k.spline.knots().iter().map(exact).collect::<R<_>>()?,
            controls: k.spline.poles().iter().map(|p| Ok([wc::numeric::enclose(&p[0])?.m, wc::numeric::enclose(&p[1])?.m])).collect::<R<_>>()?,
            from: exact(&k.from)?,
            to: exact(&k.to)?,
        })
    }
    /// The piece runs against the spline parameter.
    fn reversed(&self) -> bool {
        self.from > self.to
    }
    pub(crate) fn domain(&self) -> R<Domain> {
        span(self.knots[0], self.knots[self.knots.len() - 1])
    }
}
struct Carrier {
    a: [f64; 2],
    b: [f64; 2],
    center: Option<[f64; 2]>,
    radius: f64,
    radial: [f64; 2],
    tangent: [f64; 2],
    turn: f64,
    ccw: bool,
    spline: Option<Spline>,
}
impl ArcPrism {
    fn xyz(&self, p: [f64; 2], z: f64) -> [f64; 3] {
        [p[0], p[1], z]
    }
    fn carriers(&self) -> R<Vec<Carrier>> {
        self.profile
            .segments()
            .iter()
            .map(|s| {
                let [a, b] = *s.cache();
                let line_or_arc = || -> R<Carrier> {
                    let frame = s.frame()?;
                    Ok(match frame.arc {
                        None => Carrier {
                            a,
                            b,
                            center: None,
                            radius: 0.,
                            radial: [0.; 2],
                            tangent: frame.tangent,
                            turn: 1.,
                            ccw: true,
                            spline: None,
                        },
                        Some(arc) => Carrier {
                            a,
                            b,
                            center: Some(arc.centre),
                            radius: arc.radius,
                            radial: arc.radial,
                            tangent: frame.tangent,
                            turn: arc.turn,
                            ccw: arc.ccw,
                            spline: None,
                        },
                    })
                };
                match s.chart() {
                    wc::Chart::Line | wc::Chart::Circle(_) => line_or_arc(),
                    wc::Chart::BSpline(k) => Ok(Carrier {
                        a,
                        b,
                        center: None,
                        radius: 0.,
                        radial: [0.; 2],
                        tangent: [0.; 2],
                        turn: 1.,
                        ccw: true,
                        spline: Some(Spline::new(k)?),
                    }),
                }
            })
            .collect()
    }
}
pub(crate) fn construct(
    key: BodyKey,
    frames: Vec<Frame>,
    constructions: Vec<Construction>,
    s: &ArcPrism,
) -> R<Body> {
    let segs = s.carriers()?;
    let n = segs.len();
    let [u, v, w] = [0, 1, 2];
    let levels = s.levels;
    let fid = constructions.last().ok_or_else(|| no("construction"))?.frame;
    // The serializer also serves replayed profile blends. Their geometry
    // belongs to the new root, not to a fixed source-extrusion node index.
    let prov = Provenance::Construction { node: NodeId((constructions.len() - 1) as u32) };
    let mut body = Body {
        key,
        frames,
        constructions,
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
    for z in levels {
        for seg in &segs {
            body.vertices.push(Vertex {
                point: v3(s.xyz(seg.a, z))?,
                frame: fid,
                provenance: prov.clone(),
            });
        }
    }
    let unit = |k, sign| {
        let mut d = [0.; 3];
        d[k] = sign;
        d
    };
    for (i, z) in levels.into_iter().enumerate() {
        body.surfaces.push(Surface {
            frame: fid,
            provenance: prov.clone(),
            geometry: SurfaceGeometry::Plane {
                origin: v3(unit(w, z))?,
                normal: v3(unit(w, if i == 0 { -1. } else { 1. }))?,
                x: v3(unit(u, 1.))?,
            },
        });
    }
    for (i, seg) in segs.iter().enumerate() {
        let geometry = if seg.spline.is_some() {
            // Swept along +z from the lower cap edge of this piece (curve i).
            SurfaceGeometry::LinearExtrusion {
                curve: CurveId(i as u32),
                direction: v3(unit(w, 1.))?,
            }
        } else if let Some(c) = seg.center {
            SurfaceGeometry::Cylinder {
                origin: v3(s.xyz(c, 0.))?,
                axis: v3(unit(w, 1.))?,
                x: v3(s.xyz(seg.radial, 0.))?,
                radius: b(seg.radius)?,
            }
        } else {
            let dx = seg.tangent[0];
            let dy = seg.tangent[1];
            SurfaceGeometry::Plane {
                origin: v3(s.xyz(seg.a, 0.))?,
                normal: v3(s.xyz([dy, -dx], 0.))?,
                x: v3(s.xyz([dx, dy], 0.))?,
            }
        };
        body.surfaces.push(Surface {
            frame: fid,
            provenance: prov.clone(),
            geometry,
        });
    }
    for level in 0..2 {
        for (i, seg) in segs.iter().enumerate() {
            let [start, end] = [VertexId((level * n + i) as u32), VertexId((level * n + (i + 1) % n) as u32)];
            if let Some(sp) = &seg.spline {
                // The entity's own controls at this level; the sketch-plane edge
                // names the sketch node, the other cap the extrusion (the
                // provenance `curve_source` replays).
                let z = levels[level];
                let cid = CurveId(body.curves.len() as u32);
                body.curves.push(Curve {
                    frame: fid,
                    provenance: Provenance::Construction { node: NodeId(if z == 0. { 1 } else { 2 }) },
                    geometry: CurveGeometry::BSpline {
                        degree: sp.degree,
                        knots: sp.knots.iter().map(|&k| b(k)).collect::<R<_>>()?,
                        controls: sp.controls.iter().map(|&p| v3(s.xyz(p, z))).collect::<R<_>>()?,
                        weights: vec![],
                        periodic: false,
                    },
                    domain: sp.domain()?,
                    supports: vec![],
                });
                body.edges.push(Edge {
                    curve: cid,
                    domain: sp.domain()?,
                    vertices: if sp.reversed() { vec![end, start] } else { vec![start, end] },
                });
                continue;
            }
            let geometry = if let Some(c) = seg.center {
                CurveGeometry::Circle {
                    origin: v3(s.xyz(c, levels[level]))?,
                    normal: v3(unit(w, if seg.ccw { 1. } else { -1. }))?,
                    x: v3(s.xyz(seg.radial, 0.))?,
                    radius: b(seg.radius)?,
                    arc: ArcKind::Trimmed {},
                }
            } else {
                CurveGeometry::Line {
                    a: v3(s.xyz(seg.a, levels[level]))?,
                    b: v3(s.xyz(seg.b, levels[level]))?,
                }
            };
            let dom = domain(if seg.center.is_some() { seg.turn } else { 1. })?;
            let cid = CurveId(body.curves.len() as u32);
            body.curves.push(Curve {
                frame: fid,
                provenance: prov.clone(),
                geometry,
                domain: dom.clone(),
                supports: vec![],
            });
            body.edges.push(Edge {
                curve: cid,
                domain: dom,
                vertices: vec![start, end],
            });
        }
    }
    for (i, seg) in segs.iter().enumerate() {
        let cid = CurveId(body.curves.len() as u32);
        body.curves.push(Curve {
            frame: fid,
            provenance: prov.clone(),
            geometry: CurveGeometry::Line {
                a: v3(s.xyz(seg.a, levels[0]))?,
                b: v3(s.xyz(seg.a, levels[1]))?,
            },
            domain: domain(1.)?,
            supports: vec![],
        });
        body.edges.push(Edge {
            curve: cid,
            domain: domain(1.)?,
            vertices: vec![VertexId(i as u32), VertexId((n + i) as u32)],
        });
    }
    // Each face use owns a chart and every geometric edge has two opposite uses.
    let mut face_cycles: Vec<Vec<(usize, bool)>> = vec![
        (0..n).rev().map(|i| (i, false)).collect(),
        (0..n).map(|i| (n + i, true)).collect(),
    ];
    for i in 0..n {
        face_cycles.push(vec![
            (i, true),
            (2 * n + (i + 1) % n, true),
            (n + i, false),
            (2 * n + i, false),
        ]);
    }
    // A spline edge stored against the profile direction flips its coedges.
    let stored_reversed = |edge: usize| edge < 2 * n && segs[edge % n].spline.as_ref().is_some_and(Spline::reversed);
    for (face, cycle) in face_cycles.into_iter().enumerate() {
        let mut uses = vec![];
        for (edge, forward) in cycle {
            let forward = forward != stored_reversed(edge);
            let e = &body.edges[edge];
            let dom = e.domain.clone();
            let seg = &segs[edge % n];
            let geometry = if face < 2 {
                let sign = if face == 0 { -1. } else { 1. };
                let chart = |p: [f64; 2]| [p[0], sign * p[1]];
                if let Some(sp) = &seg.spline {
                    PcurveGeometry::BSpline {
                        degree: sp.degree,
                        knots: sp.knots.iter().map(|&k| b(k)).collect::<R<_>>()?,
                        controls: sp.controls.iter().map(|&p| v2(chart(p))).collect::<R<_>>()?,
                        weights: vec![],
                    }
                } else if let Some(c) = seg.center {
                    PcurveGeometry::CircularArc {
                        center: v2(chart(c))?,
                        x: v2(chart(seg.radial))?,
                        radius: b(seg.radius)?,
                        clockwise: (face == 0) == seg.ccw,
                    }
                } else {
                    PcurveGeometry::Line {
                        a: v2(chart(seg.a))?,
                        b: v2(chart(seg.b))?,
                    }
                }
            } else if let Some(sp) = &segs[face - 2].spline {
                // Chart (u, v) of the extrusion: u the spline parameter, v the
                // height above the swept lower edge. Cap edges run along u in
                // the parameter direction; a generator stands at the parameter
                // of its vertex (the side's first end `from`, its second `to`).
                let height = levels[1] - levels[0];
                if edge < 2 * n {
                    let v = if edge < n { 0. } else { height };
                    PcurveGeometry::Line {
                        a: v2([sp.knots[0], v])?,
                        b: v2([sp.knots[sp.knots.len() - 1], v])?,
                    }
                } else {
                    let u = if edge - 2 * n == face - 2 { sp.from } else { sp.to };
                    PcurveGeometry::Line { a: v2([u, 0.])?, b: v2([u, height])? }
                }
            } else {
                let side = &segs[face - 2];
                let along = |point: [f64; 3]| -> R<f64> {
                    if side.center.is_some() {
                        let t = if point[u] == side.a[0] && point[v] == side.a[1] {
                            0.
                        } else {
                            if side.ccw {
                                side.turn
                            } else {
                                -side.turn
                            }
                        };
                        Ok(t)
                    } else {
                        Ok((point[u] - side.a[0]) * side.tangent[0]
                            + (point[v] - side.a[1]) * side.tangent[1])
                    }
                };
                let [p, q] = [e.vertices[0], e.vertices[1]]
                    .map(|i| body.vertices[i.0 as usize].point.map(|x| x.get()));
                PcurveGeometry::Line {
                    a: v2([along(p)?, p[w]])?,
                    b: v2([along(q)?, q[w]])?,
                }
            };
            let pc = PcurveId(body.pcurves.len() as u32);
            body.pcurves.push(Pcurve {
                curve: e.curve,
                surface: SurfaceId(face as u32),
                domain: dom,
                geometry,
            });
            body.curves[e.curve.0 as usize].supports.push(Support {
                surface: SurfaceId(face as u32),
                pcurve: pc,
            });
            uses.push(CoedgeId(body.coedges.len() as u32));
            body.coedges.push(Coedge {
                edge: EdgeId(edge as u32),
                forward,
                pcurve: pc,
            });
        }
        let lp = LoopId(body.loops.len() as u32);
        body.loops.push(Loop {
            outer: true,
            coedges: uses,
        });
        let forward = face < 2 || {
            let side = &segs[face - 2];
            match &side.spline {
                // An extrusion's normal C'(u) x z points right of the parameter
                // direction: outward exactly when the counter-clockwise profile
                // runs along the parameter.
                Some(sp) => !sp.reversed(),
                None => side.center.is_none() || side.ccw,
            }
        };
        body.faces.push(Face {
            surface: SurfaceId(face as u32),
            forward,
            loops: vec![lp],
        });
    }
    body.shells.push(Shell {
        faces: (0..n + 2).map(|i| FaceId(i as u32)).collect(),
    });
    body.solids.push(Solid {
        shells: vec![ShellId(0)],
    });
    body.clone()
        .check()
        .map_err(|e| no(&format!("contract:{e:?}")))?;
    Ok(body)
}
