//! Rolling-ball fillets of parallel cuboid edges, including exact face consumption.
//! Radii and topology are exact in the source frame. The interpreter placement
//! is applied only for observation/export with explicit metric/rounding bounds.
//! All trim coordinates must be exactly representable. No epsilon changes topology.
use crate::{
    affine::Affine,
    polyhedron::{Audited, Refused},
};
use std::collections::BTreeMap;
use wonky_contract::*;
use wonky_num::expansion::{self as ex, Guard};
type R<T> = std::result::Result<T, Refused>;
pub(crate) fn no(s: &str) -> Refused {
    Refused(format!("fillet/{s}"))
}
fn b(x: f64) -> R<Binary64> {
    Binary64::new(x).map_err(|_| no("numeric-range"))
}
fn v(x: [f64; 3]) -> R<Vector3> {
    Ok([b(x[0])?, b(x[1])?, b(x[2])?])
}
fn v2(x: [f64; 2]) -> R<Vector2> {
    Ok([b(x[0])?, b(x[1])?])
}
fn domain(arc: bool) -> R<Domain> {
    Ok(Domain {
        lower: Limit::Finite {
            value: b(0.)?,
            closed: true,
        },
        upper: Limit::Finite {
            value: b(if arc { 0.25 } else { 1. })?,
            closed: true,
        },
    })
}
fn add(a: f64, c: f64) -> R<f64> {
    let mut g = Guard::new();
    let (s, e) = ex::two_sum(a, c, &mut g);
    if !g.exact() || e != 0. {
        return Err(no("trim-not-representable"));
    }
    Ok(s)
}
#[derive(Clone, Debug)]
pub(crate) struct RoundedPrism {
    pub(crate) bounds: [[f64; 3]; 2],
    pub(crate) axis: usize,
    pub(crate) radii: [f64; 4],
}
#[derive(Clone, Debug)]
pub(crate) struct Segment {
    pub a: [f64; 2],
    pub b: [f64; 2],
    pub center: Option<[f64; 2]>,
    pub radius: f64,
    pub radial: [f64; 2],
}
impl RoundedPrism {
    pub(crate) fn axes(&self) -> [usize; 3] {
        [(self.axis + 1) % 3, (self.axis + 2) % 3, self.axis]
    }
    pub(crate) fn xyz(&self, p: [f64; 2], z: f64) -> [f64; 3] {
        let [u, v, w] = self.axes();
        let mut q = [0.; 3];
        q[u] = p[0];
        q[v] = p[1];
        q[w] = z;
        q
    }
    pub(crate) fn segments(&self) -> R<Vec<Segment>> {
        let [u, v, _] = self.axes();
        let (l, h) = (self.bounds[0], self.bounds[1]);
        if !self.bounds.iter().flatten().all(|x| x.is_finite())
            || !(0..3).all(|k| l[k] < h[k])
            || self.radii.iter().any(|r| !r.is_finite() || *r < 0.)
        {
            return Err(no("invalid-prism"));
        }
        let mut g = Guard::new();
        for (a, c, k) in [(0, 1, u), (1, 2, v), (2, 3, u), (3, 0, v)] {
            let reach = ex::sum(&[self.radii[a]], &[self.radii[c]], &mut g);
            let width = ex::sum(&[h[k]], &[-l[k]], &mut g);
            let sign = ex::sign(&ex::sum(&reach, &ex::neg(&width), &mut g));
            if !g.exact() {
                return Err(no("numeric-range"));
            }
            if sign > 0 {
                return Err(no("edge-overflow-unimplemented"));
            }
        }
        let corners = [[l[u], l[v]], [h[u], l[v]], [h[u], h[v]], [l[u], h[v]]];
        let inward = [[1., 1.], [-1., 1.], [-1., -1.], [1., -1.]];
        let radial = [[-1., 0.], [0., -1.], [1., 0.], [0., 1.]];
        let mut starts = [[0.; 2]; 4];
        let mut ends = starts;
        let mut centers = starts;
        for i in 0..4 {
            let r = self.radii[i];
            centers[i] = [
                add(corners[i][0], inward[i][0] * r)?,
                add(corners[i][1], inward[i][1] * r)?,
            ];
            starts[i] = [
                add(centers[i][0], radial[i][0] * r)?,
                add(centers[i][1], radial[i][1] * r)?,
            ];
            ends[i] = [
                add(centers[i][0], -radial[i][1] * r)?,
                add(centers[i][1], radial[i][0] * r)?,
            ];
        }
        let mut out = vec![];
        for i in 0..4 {
            if self.radii[i] > 0. {
                out.push(Segment {
                    a: starts[i],
                    b: ends[i],
                    center: Some(centers[i]),
                    radius: self.radii[i],
                    radial: radial[i],
                });
            }
            let next = (i + 1) % 4;
            if ends[i] != starts[next] {
                out.push(Segment {
                    a: ends[i],
                    b: starts[next],
                    center: None,
                    radius: 0.,
                    radial: [0.; 2],
                });
            }
        }
        if out.len() < 3 {
            return Err(no("degenerate-prism"));
        }
        Ok(out)
    }
}

pub(crate) fn apply(a: &Audited, edges: &[usize], radius: f64) -> R<Body> {
    // The replay certificate currently records one interpreter placement.
    // Never drop an affine-image chain while reconstructing the source solid.
    a.frame.as_affine()?;
    crate::source_frame::SourceMetric::new(&a.frame)?;
    let mut spec = if let Some(s) = &a.rounded {
        s.clone()
    } else {
        let cells = a.orthogonal.as_ref().ok_or_else(|| no("requires-box"))?;
        if cells.boxes.len() != 1 {
            return Err(no("requires-single-box"));
        }
        let e = a.body.edges.get(edges[0]).ok_or_else(|| no("edge-index"))?;
        let [p, q] = [e.vertices[0], e.vertices[1]].map(|i| a.body.vertices[i.0 as usize].point.map(|x| x.get()));
        let axes: Vec<_> = (0..3).filter(|&k| p[k] != q[k]).collect();
        if axes.len() != 1 {
            return Err(no("non-box-edge"));
        }
        RoundedPrism {
            bounds: cells.boxes[0],
            axis: axes[0],
            radii: [0.; 4],
        }
    };
    let [u, v, w] = spec.axes();
    for &index in edges {
        let e = a.body.edges.get(index).ok_or_else(|| no("edge-index"))?;
        if !matches!(
            a.body.curves[e.curve.0 as usize].geometry,
            CurveGeometry::Line { .. }
        ) {
            return Err(no("requires-unblended-edge"));
        }
        let [p, q] = [e.vertices[0], e.vertices[1]].map(|i| a.body.vertices[i.0 as usize].point.map(|x| x.get()));
        if p[u] != q[u]
            || p[v] != q[v]
            || p[w].min(q[w]) != spec.bounds[0][w]
            || p[w].max(q[w]) != spec.bounds[1][w]
        {
            return Err(no("nonparallel-edge-set"));
        }
        let high = |k| -> R<bool> {
            if p[k] == spec.bounds[0][k] {
                Ok(false)
            } else if p[k] == spec.bounds[1][k] {
                Ok(true)
            } else {
                Err(no("requires-unblended-edge"))
            }
        };
        let corner = match (high(u)?, high(v)?) {
            (false, false) => 0,
            (true, false) => 1,
            (true, true) => 2,
            (false, true) => 3,
        };
        if spec.radii[corner] != 0. && spec.radii[corner] != radius {
            return Err(no("already-blended-edge"));
        }
        spec.radii[corner] = radius;
    }
    spec.segments()?;
    let parent = match a.body.vertices[0].provenance {
        Provenance::Construction { node } => node,
        _ => return Err(no("construction-parent")),
    };
    let mut nodes = a.body.constructions.clone();
    let root = NodeId(nodes.len() as u32);
    nodes.push(Construction {
        operation: Operation::Fillet {},
        rule_version: 1,
        parents: vec![parent],
        parameters: std::iter::once(radius)
            .chain(edges.iter().map(|&e| e as f64))
            .map(b)
            .collect::<R<_>>()?,
        frame: FrameId(1),
    });
    let key = BodyKey {
        id: a.body.key.id,
        revision: a
            .body
            .key
            .revision
            .checked_add(1)
            .ok_or_else(|| no("revision-range"))?,
    };
    construct(key, a.body.frames.clone(), nodes, root, &spec)
}

fn construct(
    key: BodyKey,
    frames: Vec<Frame>,
    constructions: Vec<Construction>,
    root: NodeId,
    s: &RoundedPrism,
) -> R<Body> {
    let segs = s.segments()?;
    let n = segs.len();
    let [u, v, w] = s.axes();
    let levels = [s.bounds[0][w], s.bounds[1][w]];
    let fid = FrameId(1);
    let prov = Provenance::Construction { node: root };
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
            let direction = |a: f64, b: f64| {
                if b > a {
                    1.
                } else if b < a {
                    -1.
                } else {
                    0.
                }
            };
            let dx = direction(seg.a[0], seg.b[0]);
            let dy = direction(seg.a[1], seg.b[1]);
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
                    normal: v3(unit(w, 1.))?,
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
            let dom = domain(seg.center.is_some())?;
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
            domain: domain(false)?,
            supports: vec![],
        });
        body.edges.push(Edge {
            curve: cid,
            domain: domain(false)?,
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
                        clockwise: face == 0,
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
                            0.25
                        };
                        Ok(t)
                    } else {
                        let k = if side.a[0] != side.b[0] { u } else { v };
                        let i = if k == u { 0 } else { 1 };
                        add(point[k], -side.a[i]).map(|d| d * (side.b[i] - side.a[i]).signum())
                    }
                };
                let [p, q] = [e.vertices[0], e.vertices[1]].map(|i| body.vertices[i.0 as usize].point.map(|x| x.get()));
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
            forward: true,
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
        .map_err(|e| Refused(format!("fillet/contract:{e:?}")))?;
    Ok(body)
}
fn v3(x: [f64; 3]) -> R<Vector3> {
    v(x)
}

pub fn candidate(b: &Body) -> bool {
    b.vertices
        .first()
        .and_then(|v| match v.provenance {
            Provenance::Construction { node } => b.constructions.get(node.0 as usize),
            _ => None,
        })
        .is_some_and(|n| n.operation == Operation::Fillet {})
}
/// Reconstruct from the original interpreter cuboid plus ordered edge/radius
/// operations, then compare all carriers, trim charts, incidences and topology.
/// A serialized output cannot authenticate itself by relabelling its vertices.
pub fn audit(checked: &CheckedBody) -> R<Audited> {
    let body = checked.body();
    if body.frames.len() != 2 {
        return Err(no("frame-chain"));
    }
    let frame = match body.frames[1] {
        Frame::Interpreter {
            parent: FrameId(0),
            origin,
            x,
            z,
        } => Affine {
            origin: origin.map(|x| x.get()),
            x: x.map(|x| x.get()),
            z: z.map(|x| x.get()),
        },
        _ => return Err(no("frame")),
    };
    crate::source_frame::SourceMetric::new(&crate::placement::Placement::from_frames(body, FrameId(1))
        .map_err(|_| no("frame"))?)?;
    let input = body.constructions.first().ok_or_else(|| no("source"))?;
    if input.operation != (Operation::Interpreter {})
        || input.parents.len() != 0
        || input.parameters.len() != 6
        || input.frame != FrameId(0)
    {
        return Err(no("source"));
    }
    let p: Vec<_> = input.parameters.iter().map(|x| x.get()).collect();
    let base = crate::orthogonal::cuboid(
        BodyKey {
            id: body.key.id,
            revision: 0,
        },
        [p[0], p[1], p[2]],
        [p[3], p[4], p[5]],
    )?;
    if body.constructions.len() < 3 || body.constructions[..2] != base.constructions {
        return Err(no("base-construction"));
    }
    let mut base = base;
    base.frames = body.frames.clone();
    let mut a = crate::polyhedron::audit(&base.check().map_err(|_| no("source-contract"))?)?;
    let mut spec = None;
    for i in 2..body.constructions.len() {
        let node = &body.constructions[i];
        if node.operation != (Operation::Fillet {})
            || node.parents != [NodeId(i as u32 - 1)]
            || node.parameters.len() < 2
            || node.frame != FrameId(1)
        {
            return Err(no("construction-chain"));
        }
        let radius = node.parameters[0].get();
        if !(radius > 0.) {
            return Err(no("invalid-radius"));
        }
        let edges = node.parameters[1..]
            .iter()
            .map(|x| {
                let x = x.get();
                if x < 0. || x.fract() != 0. || x > u32::MAX as f64 {
                    Err(no("edge-index"))
                } else {
                    Ok(x as usize)
                }
            })
            .collect::<R<Vec<_>>>()?;
        let rebuilt = apply(&a, &edges, radius)?;
        // Derive the certificate from exact cylinder centres, not chart counts.
        let mut s = a.rounded.clone().unwrap_or(RoundedPrism {
            bounds: [[p[0], p[1], p[2]], [p[3], p[4], p[5]]],
            axis: 0,
            radii: [0.; 4],
        });
        if a.rounded.is_none() {
            let e = &a.body.edges[edges[0]];
            let [v0, v1] = [e.vertices[0], e.vertices[1]].map(|id| a.body.vertices[id.0 as usize].point);
            s.axis = (0..3)
                .find(|&k| v0[k] != v1[k])
                .ok_or_else(|| no("edge-index"))?;
        }
        let [u, v, _] = s.axes();
        for edge in edges {
            let q = a.body.vertices[a.body.edges[edge].vertices[0].0 as usize]
                .point
                .map(|x| x.get());
            let corner = match (q[u] == s.bounds[1][u], q[v] == s.bounds[1][v]) {
                (false, false) => 0,
                (true, false) => 1,
                (true, true) => 2,
                (false, true) => 3,
            };
            s.radii[corner] = radius;
        }
        let face_loops = rebuilt
            .loops
            .iter()
            .map(|lp| {
                lp.coedges
                    .iter()
                    .map(|id| {
                        let co = &rebuilt.coedges[id.0 as usize];
                        rebuilt.edges[co.edge.0 as usize].vertices[usize::from(!co.forward)].0
                            as usize
                    })
                    .collect()
            })
            .collect();
        a = Audited {
            frame: crate::placement::Placement::from_frames(&rebuilt, FrameId(1)).map_err(|_| no("frame-range"))?,
            body: rebuilt,
            axis: s.axis,
            levels: [s.bounds[0][s.axis], s.bounds[1][s.axis]],
            cap: vec![],
            face_loops,
            bound_to_construction: true,
            orthogonal: None,
            arcs: None,
            rounded: Some(s.clone()),
            corner: None,
            chamfer: None,
            arrangement: None,
        };
        spec = Some(s);
    }
    a.body.key = body.key.clone();
    if &a.body != body {
        return Err(no("construction-binding"));
    }
    // Independent manifold check: chained loops and two oppositely oriented uses.
    let mut uses: BTreeMap<u32, Vec<bool>> = BTreeMap::new();
    for lp in &body.loops {
        for (i, id) in lp.coedges.iter().enumerate() {
            let co = &body.coedges[id.0 as usize];
            let next = &body.coedges[lp.coedges[(i + 1) % lp.coedges.len()].0 as usize];
            let e = &body.edges[co.edge.0 as usize];
            let n = &body.edges[next.edge.0 as usize];
            if e.vertices[usize::from(co.forward)] != n.vertices[usize::from(!next.forward)] {
                return Err(no("open-loop"));
            }
            uses.entry(co.edge.0).or_default().push(co.forward);
        }
    }
    if uses.len() != body.edges.len()
        || uses.values().any(|u| u.len() != 2 || u[0] == u[1])
        || body.vertices.len() + body.faces.len() != body.edges.len() + 2
    {
        return Err(no("non-manifold"));
    }
    incidence(body)?;
    a.rounded = spec;
    Ok(a)
}

/// Closest trimmed-circle/line queries. Strictly separated enclosures decide
/// ordering; exact coincident distance expressions keep ties. An unresolved
/// radical/tolerance comparison refuses instead of substituting the arc chord.
pub(crate) fn closest(
    candidates: &[(&Audited, usize)],
    point: [f64; 3],
    tie: f64,
) -> R<Vec<usize>> {
    use num_rational::BigRational as Q;
    use num_traits::{ToPrimitive, Zero};
    use wonky_num::ball::{Iv, Scalar};
    let q = |x| Q::from_float(x).unwrap();
    let enclose = |x: &Q| -> R<Iv> {
        let m = x.to_f64().ok_or_else(|| no("query-range"))?;
        if !m.is_finite() {
            return Err(no("query-range"));
        }
        let l = if q(m) > *x { m.next_down() } else { m };
        let h = if q(m) < *x { m.next_up() } else { m };
        crate::rounding::finite_ball(if l == h {
            Iv::point(l)
        } else {
            Iv {
                m: l,
                r: (h - l).next_up(),
            }
        })
        .map_err(|_| no("query-range"))
    };
    let mut values: Vec<(Q, Q, Iv)> = vec![];
    let mut all_isometric = true;
    for &(a, index) in candidates {
        let metric = crate::source_frame::SourceMetric::new(&a.frame)?;
        all_isometric &= metric.is_isometry();
        let e = a.body.edges.get(index).ok_or_else(|| no("edge-index"))?;
        let c = &a.body.curves[e.curve.0 as usize];
        let p = crate::source_frame::inverse(&a.frame, point, 1.)?;
        let endpoints = [e.vertices[0], e.vertices[1]]
            .map(|id| a.body.vertices[id.0 as usize].point.map(|x| q(x.get())));
        let dot = |a: &[Q; 3], b: &[Q; 3]| (0..3).map(|k| &a[k] * &b[k]).sum::<Q>();
        let sub = |a: &[Q; 3], b: &[Q; 3]| std::array::from_fn(|k| &a[k] - &b[k]);
        let (n, k) = match &c.geometry {
            CurveGeometry::Line { .. } => {
                let d = sub(&endpoints[1], &endpoints[0]);
                let w = sub(&p, &endpoints[0]);
                let dd = dot(&d, &d);
                if dd.is_zero() {
                    return Err(no("query-degenerate-edge"));
                }
                let t = (dot(&w, &d) / dd).max(Q::zero()).min(q(1.));
                let r: [Q; 3] = std::array::from_fn(|k| &w[k] - &t * &d[k]);
                (dot(&r, &r), Q::zero())
            }
            CurveGeometry::Circle {
                origin,
                normal,
                x,
                radius,
                arc: ArcKind::Trimmed {},
            } if a.rounded.is_some() || a.corner.is_some() => {
                let o = origin.map(|x| q(x.get()));
                let z = normal.map(|x| q(x.get()));
                let x = x.map(|x| q(x.get()));
                let y: [Q; 3] = std::array::from_fn(|k| {
                    &z[(k + 1) % 3] * &x[(k + 2) % 3] - &z[(k + 2) % 3] * &x[(k + 1) % 3]
                });
                let d = sub(&p, &o);
                let alpha = dot(&d, &x);
                let beta = dot(&d, &y);
                if alpha >= Q::zero() && beta >= Q::zero() {
                    let r = q(radius.get());
                    (
                        dot(&d, &d) + &r * &r,
                        q(4.) * &r * &r * (&alpha * &alpha + &beta * &beta),
                    )
                } else {
                    let a = sub(&p, &endpoints[0]);
                    let b = sub(&p, &endpoints[1]);
                    (dot(&a, &a).min(dot(&b, &b)), Q::zero())
                }
            }
            _ => return Err(no("query-curve-unimplemented")),
        };
        // A shared arc endpoint has zero distance written as n - sqrt(k),
        // whereas its incident line spells it as 0 - sqrt(0). Canonicalize
        // rational square roots exactly before comparing expressions; float
        // enclosure overlap cannot prove (or break) this topological tie.
        let numerator = k.numer().sqrt();
        let denominator = k.denom().sqrt();
        let (n, k) = if &numerator * &numerator == *k.numer()
            && &denominator * &denominator == *k.denom()
        {
            (n - Q::new(numerator, denominator), Q::zero())
        } else {
            (n, k)
        };
        let squared = enclose(&n)? - enclose(&k)?.sqrt();
        let lo = squared.lo().max(0.).sqrt().next_down().max(0.);
        let hi = squared.hi().max(0.).sqrt().next_up();
        let mid = (lo + hi) * 0.5;
        let distance = Iv {
            m: mid,
            r: (mid - lo).max(hi - mid).next_up(),
        };
        let distance = crate::rounding::finite_ball(distance).map_err(|_| no("query-range"))?;
        values.push((n, k, metric.length(distance)?));
    }
    if values.is_empty() {
        return Ok(vec![]);
    }
    if !all_isometric {
        // Equal source radicals need not be equal world distances. Certify the
        // distance-to-minimum/tie frontier with singular-value bounds instead.
        // Ambiguous ordering is a named refusal, never an approximate tie.
        let lower = values.iter().map(|v| v.2.lo().max(0.)).fold(f64::INFINITY, f64::min);
        let upper = values.iter().map(|v| v.2.hi()).fold(f64::INFINITY, f64::min);
        let mut selected = vec![];
        for (index, (n, k, d)) in values.iter().enumerate() {
            let sole_minimum = values.iter().enumerate().all(|(j, v)| j == index || d.hi() < v.2.lo());
            if (n.is_zero() && k.is_zero()) || sole_minimum
                || (*d - Iv::point(lower)).hi() <= tie {
                selected.push(index);
            } else if (*d - Iv::point(upper)).lo() <= tie {
                return Err(no("query-world-metric-unresolved"));
            }
        }
        return Ok(selected);
    }
    let best = (0..values.len())
        .min_by(|&i, &j| values[i].2.mid().total_cmp(&values[j].2.mid()))
        .unwrap();
    let (n, k, d) = &values[best];
    let mut selected = vec![];
    for (index, (m, l, e)) in values.iter().enumerate() {
        if m == n && l == k {
            selected.push(index);
            continue;
        }
        // No rounded-order decision: each candidate must be certified relative
        // to this proposed minimum and to its tolerance frontier.
        if e.hi() < d.lo() {
            return Err(no("query-order-unresolved"));
        }
        if l.is_zero() && k.is_zero() {
            if m < n {
                return Err(no("query-order-unresolved"));
            }
            let t = q(tie);
            let a = m - n - &t * &t;
            if a <= Q::zero() || &a * &a <= q(4.) * &t * &t * n {
                selected.push(index);
            }
            continue;
        }
        if e.lo() >= d.hi() {
            let delta = *e - *d;
            if delta.hi() <= tie {
                selected.push(index);
            } else if delta.lo() <= tie {
                return Err(no("query-tie-unresolved"));
            }
        } else {
            return Err(no("query-order-unresolved"));
        }
    }
    Ok(selected)
}

// Independent carrier incidence, not a second call to the constructor. This
// catches shared generation/replay defects (e.g. signum(0) as a tangent axis).
pub(crate) fn incidence(body: &Body) -> R<()> {
    use num_rational::BigRational as Q;
    use num_traits::Zero;
    let q = |x: f64| Q::from_float(x).unwrap();
    let point = |x: Vector3| x.map(|x| q(x.get()));
    let dot = |a: &[Q; 3], b: &[Q; 3]| (0..3).map(|k| &a[k] * &b[k]).sum::<Q>();
    let sub = |a: [Q; 3], b: [Q; 3]| std::array::from_fn(|k| &a[k] - &b[k]);
    for face in &body.faces {
        let surface = &body.surfaces[face.surface.0 as usize].geometry;
        for lp in &face.loops {
            for co in &body.loops[lp.0 as usize].coedges {
                let e = &body.edges[body.coedges[co.0 as usize].edge.0 as usize];
                for id in &e.vertices {
                    let p = point(body.vertices[id.0 as usize].point);
                    let good = match surface {
                        SurfaceGeometry::Plane { origin, normal, .. } => {
                            dot(&sub(p, point(*origin)), &point(*normal)).is_zero()
                        }
                        SurfaceGeometry::Cylinder {
                            origin,
                            axis,
                            radius,
                            ..
                        } => {
                            let d = sub(p, point(*origin));
                            let z = point(*axis);
                            let t = dot(&d, &z);
                            dot(&d, &d) - &t * &t == q(radius.get()) * q(radius.get())
                        }
                        SurfaceGeometry::Sphere { origin, radius, .. } => {
                            let d = sub(p, point(*origin));
                            dot(&d, &d) == q(radius.get()) * q(radius.get())
                        }
                        _ => false,
                    };
                    if !good {
                        return Err(no("carrier-incidence"));
                    }
                }
                if let CurveGeometry::Circle {
                    origin,
                    normal,
                    radius,
                    ..
                } = body.curves[e.curve.0 as usize].geometry
                {
                    for id in &e.vertices {
                        let d = sub(point(body.vertices[id.0 as usize].point), point(origin));
                        if !dot(&d, &point(normal)).is_zero()
                            || dot(&d, &d) != q(radius.get()) * q(radius.get())
                        {
                            return Err(no("arc-incidence"));
                        }
                    }
                }
            }
        }
    }
    Ok(())
}
