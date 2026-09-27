//! Serialization of an audited three-point-arc extrusion. Geometry remains
//! analytic (circle edges and cylindrical sides), never polygonized.
use super::arc_profile::{b, enclose, finite, no, ArcPrism, R};
use wonky_contract::*;
use wonky_num::{Iv, Scalar};
fn v3(p: [f64; 3]) -> R<Vector3> {
    Ok([b(p[0])?, b(p[1])?, b(p[2])?])
}
fn v2(p: [f64; 2]) -> R<Vector2> {
    Ok([b(p[0])?, b(p[1])?])
}
fn domain(t: f64) -> R<Domain> {
    Ok(Domain {
        lower: Limit::Finite {
            value: b(0.)?,
            closed: true,
        },
        upper: Limit::Finite {
            value: b(t)?,
            closed: true,
        },
    })
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
}
impl ArcPrism {
    fn xyz(&self, p: [f64; 2], z: f64) -> [f64; 3] {
        [p[0], p[1], z]
    }
    fn carriers(&self) -> R<Vec<Carrier>> {
        self.profile
            .segments
            .iter()
            .map(|s| {
                let mut out = Carrier {
                    a: s.a,
                    b: s.b,
                    center: None,
                    radius: 0.,
                    radial: [0.; 2],
                    tangent: [0.; 2],
                    turn: 1.,
                    ccw: true,
                };
                let dx = Iv::point(s.b[0]) - Iv::point(s.a[0]);
                let dy = Iv::point(s.b[1]) - Iv::point(s.a[1]);
                let len = finite(dx.norm3(dy, Iv::point(0.)))?;
                if len.lo() <= 0. {
                    return Err(no("edge-length-range"));
                }
                out.tangent = [finite(dx / len)?.mid(), finite(dy / len)?.mid()];
                if let Some(c) = &s.circle {
                    let radius = finite(enclose(&c.r2)?.sqrt())?;
                    if radius.lo() <= 0. {
                        return Err(no("radius-range"));
                    }
                    let center = [enclose(&c.c[0])?, enclose(&c.c[1])?];
                    out.center = Some(center.map(|x| x.mid()));
                    out.radius = radius.mid();
                    out.ccw = c.ccw;
                    out.radial = [
                        finite((Iv::point(s.a[0]) - center[0]) / radius)?.mid(),
                        finite((Iv::point(s.a[1]) - center[1]) / radius)?.mid(),
                    ];
                    out.turn =
                        finite(c.angle.abs() / (Iv::point(2.) * crate::analytic_pi::pi()))?.mid();
                }
                Ok(out)
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
    let fid = FrameId(1);
    let prov = Provenance::Construction { node: NodeId(2) };
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
    for seg in &segs {
        let geometry = if let Some(c) = seg.center {
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
                vertices: vec![
                    VertexId((level * n + i) as u32),
                    VertexId((level * n + (i + 1) % n) as u32),
                ],
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
    for (face, cycle) in face_cycles.into_iter().enumerate() {
        let mut uses = vec![];
        for (edge, forward) in cycle {
            let e = &body.edges[edge];
            let dom = e.domain.clone();
            let seg = &segs[edge % n];
            let geometry = if face < 2 {
                let sign = if face == 0 { -1. } else { 1. };
                let chart = |p: [f64; 2]| [p[0], sign * p[1]];
                if let Some(c) = seg.center {
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
        body.faces.push(Face {
            surface: SurfaceId(face as u32),
            forward: face < 2 || segs[face - 2].center.is_none() || segs[face - 2].ccw,
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
