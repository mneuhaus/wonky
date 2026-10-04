//! Sewn analytic cap-rim patches. Three vertex rings, five edge rings, one
//! plane/cone/cylinder/torus patches; shared straight, circular or elliptic joints.
use crate::{
    arc_profile::{b, finite, q, ArcPrism, Profile, R},
    fillet_rim::{exact, no, Rim},
};
use wonky_contract::*;
use wonky_curve as wc;
use wonky_num::Iv;
fn v(p: [f64; 3]) -> R<Vector3> {
    Ok([b(p[0])?, b(p[1])?, b(p[2])?])
}
fn v2(p: [f64; 2]) -> R<Vector2> {
    Ok([b(p[0])?, b(p[1])?])
}
fn xyz(p: [f64; 2], z: f64) -> [f64; 3] {
    [p[0], p[1], z]
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
/// The circle a curved piece rides on, as the serializer's view of it.
fn circle(profile: &Profile, k: usize) -> R<&wc::Circle> {
    match profile.segments()[k].chart() {
        wc::Chart::Circle(c) => Ok(c),
        wc::Chart::Line => Err(no("chart-vertex")),
        wc::Chart::BSpline(_) => Err(wc::Refusal::SplineArrangement.into()),
    }
}
fn radius(profile: &Profile, k: usize) -> R<f64> {
    let c = circle(profile, k)?;
    let r = c.radius()?.mid();
    if q(r) * q(r) != c.r2 {
        return Err(no("radius-not-representable"));
    }
    Ok(r)
}
fn center(profile: &Profile, k: usize) -> R<[f64; 2]> {
    let c = circle(profile, k)?;
    let centre = c.c.rat()?;
    Ok([exact(centre[0].clone())?, exact(centre[1].clone())?])
}
/// Reflection is an exact chart operation, not a second lower-cap geometry
/// implementation. Curve normals are axial vectors; surface normals are
/// polar vectors. Their pcurves and oriented loops must reflect with them.
fn reflect_z(body: &mut Body) -> R<()> {
    let point = |p: &mut Vector3| -> R<()> {
        p[2] = b(-p[2].get())?;
        Ok(())
    };
    for vertex in &mut body.vertices {
        point(&mut vertex.point)?;
    }
    for curve in &mut body.curves {
        match &mut curve.geometry {
            CurveGeometry::Line { a, b } => {
                point(a)?;
                point(b)?;
            }
            CurveGeometry::Circle {
                origin, normal, x, ..
            } => {
                point(origin)?;
                point(x)?;
                normal[0] = b(-normal[0].get())?;
                normal[1] = b(-normal[1].get())?;
            }
            CurveGeometry::VectorEllipse { origin, cosine, sine, .. } => {
                point(origin)?; point(cosine)?; point(sine)?;
            }
            _ => return Err(no("reflection-curve")),
        }
    }
    for surface in &mut body.surfaces {
        match &mut surface.geometry {
            SurfaceGeometry::Plane { origin, normal, x } => {
                point(origin)?;
                point(normal)?;
                point(x)?;
            }
            SurfaceGeometry::Cylinder {
                origin, axis, x, ..
            }
            | SurfaceGeometry::Torus {
                origin, axis, x, ..
            }
            | SurfaceGeometry::ConeMeridian {
                origin, axis, x, ..
            } => {
                point(origin)?;
                point(axis)?;
                point(x)?;
            }
            _ => return Err(no("reflection-surface")),
        }
    }
    for pc in &mut body.pcurves {
        let plane = matches!(
            body.surfaces[pc.surface.0 as usize].geometry,
            SurfaceGeometry::Plane { .. }
        );
        match &mut pc.geometry {
            PcurveGeometry::Line { a, b: bv } => {
                let k = if plane { 1 } else { 0 };
                a[k] = b(-a[k].get())?;
                bv[k] = b(-bv[k].get())?;
            }
            PcurveGeometry::CircularArc {
                center,
                x,
                clockwise,
                ..
            } if plane => {
                center[1] = b(-center[1].get())?;
                x[1] = b(-x[1].get())?;
                *clockwise = !*clockwise;
            }
            PcurveGeometry::Harmonic { offset, linear, cosine, sine } if !plane => {
                for value in [offset, linear, cosine, sine] { value[0] = b(-value[0].get())?; }
            }
            _ => return Err(no("reflection-pcurve")),
        }
    }
    for coedge in &mut body.coedges {
        coedge.forward = !coedge.forward;
    }
    for lp in &mut body.loops {
        lp.coedges.reverse();
    }
    Ok(())
}
pub(crate) fn construct(mut body: Body, s: &ArcPrism, rim: &Rim) -> R<Body> {
    if rim.bottom {
        let mirrored = ArcPrism {
            levels: [-s.levels[1], -s.levels[0]],
            rim: None,
            ..s.clone()
        };
        let band = Rim::offset_band(&mirrored, rim.radius, rim.chamfer, false, rim.outward)?;
        body = construct(body, &mirrored, &band)?;
        reflect_z(&mut body)?;
        if !rim.outward {
            body.clone()
                .check()
                .map_err(|e| no(&format!("contract:{e:?}")))?;
        }
        return Ok(body);
    }
    let n = s.profile.segments().len();
    let fid = FrameId(1);
    let prov = Provenance::Construction {
        node: NodeId(body.constructions.len() as u32 - 1),
    };
    body.vertices.clear();
    body.curves.clear();
    body.surfaces.clear();
    body.edges.clear();
    body.coedges.clear();
    body.pcurves.clear();
    body.loops.clear();
    body.faces.clear();
    body.shells.clear();
    body.solids.clear();
    let heights = [s.levels[0], rim.center_z, s.levels[1]];
    let profiles = [&s.profile, &s.profile, &rim.inner];
    let z = [0., 0., 1.];
    let mut turns = vec![];
    let mut lengths = vec![];
    for (k, seg) in s.profile.segments().iter().enumerate() {
        let [a, b] = *seg.cache();
        match seg.chart() {
            wc::Chart::Circle(c) => {
                turns.push(finite(c.angle / (Iv::point(2.) * crate::analytic_pi::pi()))?.mid());
                lengths.push(0.);
            }
            wc::Chart::Line => {
                turns.push(1.);
                let normal = rim.normals[k];
                lengths.push(exact(
                    (q(b[0]) - q(a[0])) * q(-normal[1]) + (q(b[1]) - q(a[1])) * q(normal[0]),
                )?);
            }
            wc::Chart::BSpline(_) => return Err(wc::Refusal::SplineArrangement.into()),
        }
    }
    for ring in 0..3 {
        for seg in profiles[ring].segments() {
            body.vertices.push(Vertex {
                point: v(xyz(seg.cache()[0], heights[ring]))?,
                frame: fid,
                provenance: prov.clone(),
            });
        }
    }
    let mut add_edge = |geometry: CurveGeometry, t: f64, a: usize, bv: usize| -> R<()> {
        let dom = domain(t)?;
        let curve = CurveId(body.curves.len() as u32);
        body.curves.push(Curve {
            frame: fid,
            provenance: prov.clone(),
            geometry,
            domain: dom.clone(),
            supports: vec![],
        });
        body.edges.push(Edge {
            curve,
            domain: dom,
            vertices: vec![VertexId(a as u32), VertexId(bv as u32)],
        });
        Ok(())
    };
    for ring in 0..3 {
        for (k, seg) in profiles[ring].segments().iter().enumerate() {
            let geometry = if seg.is_curved() {
                CurveGeometry::Circle {
                    origin: v(xyz(center(profiles[ring], k)?, heights[ring]))?,
                    normal: v(z)?,
                    x: v(xyz(rim.normals[k], 0.))?,
                    radius: b(radius(profiles[ring], k)?)?,
                    arc: ArcKind::Trimmed {},
                }
            } else {
                CurveGeometry::Line {
                    a: v(xyz(seg.cache()[0], heights[ring]))?,
                    b: v(xyz(seg.cache()[1], heights[ring]))?,
                }
            };
            add_edge(geometry, turns[k], ring * n + k, ring * n + (k + 1) % n)?;
        }
    }
    for (k, seg) in s.profile.segments().iter().enumerate() {
        add_edge(
            CurveGeometry::Line {
                a: v(xyz(seg.cache()[0], heights[0]))?,
                b: v(xyz(seg.cache()[0], heights[1]))?,
            },
            1.,
            k,
            n + k,
        )?;
    }
    for (k, seg) in rim.inner.segments().iter().enumerate() {
        let normal = rim.normals[k];
        add_edge(
            if rim.chamfer {
                CurveGeometry::Line {
                    a: v(xyz(s.profile.segments()[k].cache()[0], rim.center_z))?,
                    b: v(xyz(seg.cache()[0], s.levels[1]))?,
                }
            } else if rim.mitred {
                let original = s.profile.segments()[k].ends()[0].rat()?;
                let joint = seg.ends()[0].rat()?;
                CurveGeometry::VectorEllipse {
                    origin: v(xyz(seg.cache()[0], rim.center_z))?,
                    cosine: v([exact(&original[0] - &joint[0])?, exact(&original[1] - &joint[1])?, 0.])?,
                    sine: v([0., 0., rim.radius])?,
                    arc: ArcKind::Trimmed {},
                }
            } else {
                CurveGeometry::Circle {
                    origin: v(xyz(seg.cache()[0], rim.center_z))?,
                    normal: v(if rim.outward {
                        [-normal[1], normal[0], 0.]
                    } else {
                        [normal[1], -normal[0], 0.]
                    })?,
                    x: v(xyz(
                        if rim.outward {
                            normal.map(|v| -v)
                        } else {
                            normal
                        },
                        0.,
                    ))?,
                    radius: b(rim.radius)?,
                    arc: ArcKind::Trimmed {},
                }
            },
            if rim.chamfer { 1. } else { 0.25 },
            n + k,
            2 * n + k,
        )?;
    }
    for (height, sign) in [(heights[0], -1.), (heights[2], 1.)] {
        body.surfaces.push(Surface {
            frame: fid,
            provenance: prov.clone(),
            geometry: SurfaceGeometry::Plane {
                origin: v([0., 0., height])?,
                normal: v([0., 0., sign])?,
                x: v([1., 0., 0.])?,
            },
        });
    }
    for (k, seg) in s.profile.segments().iter().enumerate() {
        let normal = rim.normals[k];
        let geometry = if seg.is_curved() {
            SurfaceGeometry::Cylinder {
                origin: v(xyz(center(&s.profile, k)?, 0.))?,
                axis: v(z)?,
                x: v(xyz(normal, 0.))?,
                radius: b(radius(&s.profile, k)?)?,
            }
        } else {
            SurfaceGeometry::Plane {
                origin: v(xyz(seg.cache()[0], 0.))?,
                normal: v(xyz(normal, 0.))?,
                x: v([-normal[1], normal[0], 0.])?,
            }
        };
        body.surfaces.push(Surface {
            frame: fid,
            provenance: prov.clone(),
            geometry,
        });
    }
    for (k, seg) in rim.inner.segments().iter().enumerate() {
        let normal = rim.normals[k];
        let geometry = if rim.chamfer && seg.is_curved() {
            SurfaceGeometry::ConeMeridian {
                origin: v(xyz(center(&rim.inner, k)?, 0.))?,
                axis: v(z)?,
                x: v(xyz(normal, 0.))?,
                start: v2([radius(&s.profile, k)?, rim.center_z])?,
                end: v2([radius(&rim.inner, k)?, s.levels[1]])?,
            }
        } else if rim.chamfer {
            SurfaceGeometry::Plane {
                origin: v(xyz(s.profile.segments()[k].cache()[0], rim.center_z))?,
                normal: v([normal[0], normal[1], if rim.outward { -1. } else { 1. }])?,
                x: v([-normal[1], normal[0], 0.])?,
            }
        } else if seg.is_curved() {
            SurfaceGeometry::Torus {
                origin: v(xyz(center(&rim.inner, k)?, rim.center_z))?,
                axis: v(z)?,
                x: v(xyz(normal, 0.))?,
                major: b(radius(&rim.inner, k)?)?,
                minor: b(rim.radius)?,
            }
        } else {
            SurfaceGeometry::Cylinder {
                origin: v(xyz(seg.cache()[0], rim.center_z))?,
                axis: v(if rim.outward {
                    [-normal[1], normal[0], 0.]
                } else {
                    [normal[1], -normal[0], 0.]
                })?,
                x: v(xyz(
                    if rim.outward {
                        normal.map(|v| -v)
                    } else {
                        normal
                    },
                    0.,
                ))?,
                radius: b(rim.radius)?,
            }
        };
        body.surfaces.push(Surface {
            frame: fid,
            provenance: prov.clone(),
            geometry,
        });
    }
    let mut cycles = vec![
        (0..n).rev().map(|k| (k, false)).collect::<Vec<_>>(),
        (0..n).map(|k| (2 * n + k, true)).collect(),
    ];
    for k in 0..n {
        cycles.push(vec![
            (k, true),
            (3 * n + (k + 1) % n, true),
            (n + k, false),
            (3 * n + k, false),
        ]);
    }
    for k in 0..n {
        cycles.push(vec![
            (n + k, true),
            (4 * n + (k + 1) % n, true),
            (2 * n + k, false),
            (4 * n + k, false),
        ]);
    }
    for (face, cycle) in cycles.into_iter().enumerate() {
        let mut uses = vec![];
        for (edge, forward) in cycle {
            let e = &body.edges[edge];
            let geometry = if face < 2 {
                let profile = if face == 0 { &s.profile } else { &rim.inner };
                let k = edge % n;
                let seg = &profile.segments()[k];
                let sign = if face == 0 { -1. } else { 1. };
                let chart = |p: [f64; 2]| [p[0], sign * p[1]];
                if seg.is_curved() {
                    PcurveGeometry::CircularArc {
                        center: v2(chart(center(profile, k)?))?,
                        x: v2(chart(rim.normals[k]))?,
                        radius: b(radius(profile, k)?)?,
                        clockwise: face == 0,
                    }
                } else {
                    PcurveGeometry::Line {
                        a: v2(chart(seg.cache()[0]))?,
                        b: v2(chart(seg.cache()[1]))?,
                    }
                }
            } else {
                let blend = face >= 2 + n;
                let k = if blend { face - 2 - n } else { face - 2 };
                let curved = s.profile.segments()[k].is_curved();
                let normal = rim.normals[k];
                let uv = |id: VertexId| -> R<[f64; 2]> {
                    let ring = id.0 as usize / n;
                    let at = id.0 as usize % n;
                    if blend && rim.mitred && rim.chamfer {
                        // The mitre changes the along-face coordinate too.
                        // Project the actual rational vertex onto this plane's
                        // exact chart, rather than reusing the old edge length.
                        let point = &body.vertices[id.0 as usize].point;
                        let origin = s.profile.segments()[k].ends()[0].rat()?;
                        let normal = rim.normals[k];
                        let along = exact(
                            (q(point[0].get()) - &origin[0]) * q(-normal[1])
                                + (q(point[1].get()) - &origin[1]) * q(normal[0]),
                        )?;
                        return Ok([along, if ring == 1 { 0. } else { rim.radius }]);
                    }
                    let along = if at == k {
                        0.
                    } else if at == (k + 1) % n {
                        if curved {
                            turns[k]
                        } else {
                            lengths[k]
                        }
                    } else {
                        return Err(no("chart-vertex"));
                    };
                    if !blend {
                        Ok([along, heights[ring]])
                    } else if rim.chamfer {
                        // ConeMeridian's V is absolute axial height. Plane V
                        // multiplies n cross x (not its unit normalization), so
                        // the exact equal offset is r, not the slant length.
                        Ok([
                            along,
                            if curved {
                                heights[ring]
                            } else if ring == 1 {
                                0.
                            } else {
                                rim.radius
                            },
                        ])
                    } else if curved {
                        Ok([
                            along,
                            if ring == 1 {
                                if rim.outward {
                                    0.5
                                } else {
                                    0.
                                }
                            } else {
                                0.25
                            },
                        ])
                    } else {
                        let along = if rim.mitred {
                            let p = &body.vertices[id.0 as usize].point;
                            let o = rim.inner.segments()[k].ends()[0].rat()?;
                            exact((q(p[0].get()) - &o[0]) * q(-normal[1])
                                + (q(p[1].get()) - &o[1]) * q(normal[0]))?
                        } else { along };
                        Ok([
                            if ring == 1 { 0. } else { 0.25 },
                            if rim.outward { along } else { -along },
                        ])
                    }
                };
                if blend && rim.mitred && !rim.chamfer && edge >= 4 * n {
                    // Each ellipse is the exact intersection of the two side
                    // cylinders. Its cylinder u is t; its axial coordinate
                    // is an affine function of cos(2*pi*t), not a line.
                    let at = edge - 4 * n;
                    let p = rim.inner.segments()[at].ends()[0].rat()?;
                    let original = s.profile.segments()[at].ends()[0].rat()?;
                    let o = rim.inner.segments()[k].ends()[0].rat()?;
                    let axis = if rim.outward { [-normal[1], normal[0]] } else { [normal[1], -normal[0]] };
                    let along = |a: &wc::P, b: &wc::P| exact(
                        (&a[0] - &b[0]) * q(axis[0]) + (&a[1] - &b[1]) * q(axis[1])
                    );
                    PcurveGeometry::Harmonic {
                        offset: v2([0., along(p, o)?])?,
                        linear: v2([1., 0.])?,
                        cosine: v2([0., along(original, p)?])?,
                        sine: v2([0., 0.])?,
                    }
                } else {
                    PcurveGeometry::Line {
                        a: v2(uv(e.vertices[0])?)?,
                        b: v2(uv(e.vertices[1])?)?,
                    }
                }
            };
            let pc = PcurveId(body.pcurves.len() as u32);
            body.pcurves.push(Pcurve {
                curve: e.curve,
                surface: SurfaceId(face as u32),
                domain: e.domain.clone(),
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
            forward: true,
            loops: vec![lp],
        });
    }
    body.shells.push(Shell {
        faces: (0..2 + 2 * n).map(|k| FaceId(k as u32)).collect(),
    });
    body.solids.push(Solid {
        shells: vec![ShellId(0)],
    });
    if rim.outward {
        // Inner-cap and band loops bound void instead of a convex solid. The
        // torus/cylinder charts point into the void already; cone/plane charts
        // need reversed surface sense for their outward-growing meridian.
        for fi in std::iter::once(1).chain(2 + n..2 + 2 * n) {
            let face = &mut body.faces[fi];
            if fi >= 2 + n && rim.chamfer {
                face.forward = !face.forward;
            }
            for &lp in &face.loops {
                let l = &mut body.loops[lp.0 as usize];
                l.coedges.reverse();
                for &u in &l.coedges {
                    body.coedges[u.0 as usize].forward = !body.coedges[u.0 as usize].forward;
                }
            }
        }
    }
    if !rim.outward {
        body.clone()
            .check()
            .map_err(|e| no(&format!("contract:{e:?}")))?;
    }
    Ok(body)
}
