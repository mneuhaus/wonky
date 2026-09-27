//! Three equal rolling-ball fillets incident to a cuboid corner.
//! Exact source-metric construction, with bounded interpreter-frame observations.
//! Canonical solid:
//! 0 <= p <= lengths and sum(max(radius - p[k], 0)^2) <= radius^2.
//! Exact critical-radius face consumption; no approximate tangency or inferred overflow failure.
use crate::{
    fillet_prism::no,
    source_frame::SourceMetric,
    polyhedron::{Audited, Refused},
};
use std::collections::{BTreeMap, BTreeSet};
use wonky_contract::*;
use wonky_num::expansion::{self as ex, Guard};
type R<T> = std::result::Result<T, Refused>;
fn b(x: f64) -> R<Binary64> {
    Binary64::new(x).map_err(|_| no("corner-range"))
}
fn v(p: [f64; 3]) -> R<Vector3> {
    Ok([b(p[0])?, b(p[1])?, b(p[2])?])
}
fn v2(p: [f64; 2]) -> R<Vector2> {
    Ok([b(p[0])?, b(p[1])?])
}
fn add(a: f64, c: f64) -> R<f64> {
    let mut g = Guard::new();
    let (s, e) = ex::two_sum(a, c, &mut g);
    if !g.exact() || e != 0. {
        return Err(no("trim-not-representable"));
    }
    Ok(s)
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
fn axis(k: usize, sign: f64) -> [f64; 3] {
    let mut p = [0.; 3];
    p[k] = sign;
    p
}
fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    std::array::from_fn(|k| a[(k + 1) % 3] * b[(k + 2) % 3] - a[(k + 2) % 3] * b[(k + 1) % 3])
}
fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    (0..3).map(|k| a[k] * b[k]).sum()
}

#[derive(Clone, Debug)]
pub(crate) struct Corner {
    pub origin: [f64; 3],
    pub signs: [f64; 3],
    pub lengths: [f64; 3],
    pub radius: f64,
}
impl Corner {
    /// Canonical face order: three near planes, three far planes, three
    /// cylinders, then the sphere. At exact equality some trims have zero
    /// area and disappear; strict comparisons keep even one-ulp-wide faces.
    pub(crate) fn face_active(&self, face: usize) -> bool {
        match face {
            0..=2 => {
                self.lengths[(face + 1) % 3] > self.radius
                    && self.lengths[(face + 2) % 3] > self.radius
            }
            6..=8 => self.lengths[face - 6] > self.radius,
            _ => true,
        }
    }
    pub(crate) fn point(&self, p: [f64; 3]) -> R<[f64; 3]> {
        Ok([
            add(self.origin[0], self.signs[0] * p[0])?,
            add(self.origin[1], self.signs[1] * p[1])?,
            add(self.origin[2], self.signs[2] * p[2])?,
        ])
    }
    fn vector(&self, p: [f64; 3]) -> [f64; 3] {
        std::array::from_fn(|k| self.signs[k] * p[k])
    }
}
fn common_vertex(a: &Audited, edges: &[usize]) -> Option<usize> {
    if edges.len() != 3 || edges.iter().copied().collect::<BTreeSet<_>>().len() != 3 {
        return None;
    }
    let first = a.body.edges.get(edges[0])?;
    first
        .vertices
        .iter()
        .find(|v| {
            edges
                .iter()
                .all(|&i| a.body.edges.get(i).is_some_and(|e| e.vertices.contains(v)))
        })
        .map(|v| v.0 as usize)
}
pub(crate) fn applies(a: &Audited, edges: &[usize]) -> bool {
    a.orthogonal.is_some() && common_vertex(a, edges).is_some()
}
fn specification(a: &Audited, edges: &[usize], radius: f64) -> R<Corner> {
    SourceMetric::new(&a.frame)?;
    let cells = a
        .orthogonal
        .as_ref()
        .ok_or_else(|| no("corner-requires-box"))?;
    if cells.boxes.len() != 1 {
        return Err(no("corner-requires-single-box"));
    }
    let vertex =
        common_vertex(a, edges).ok_or_else(|| no("corner-requires-three-incident-edges"))?;
    let origin = a.body.vertices[vertex].point.map(|x| x.get());
    let [lo, hi] = cells.boxes[0];
    let signs = std::array::from_fn(|k| if origin[k] == lo[k] { 1. } else { -1. });
    if (0..3).any(|k| origin[k] != lo[k] && origin[k] != hi[k]) {
        return Err(no("corner-not-box-vertex"));
    }
    let lengths = [
        add(hi[0], -lo[0])?,
        add(hi[1], -lo[1])?,
        add(hi[2], -lo[2])?,
    ];
    if lengths.iter().any(|&l| radius > l) {
        return Err(no("edge-overflow-unimplemented"));
    }
    if !(radius.is_finite() && radius > 0.) {
        return Err(no("invalid-radius"));
    }
    Ok(Corner {
        origin,
        signs,
        lengths,
        radius,
    })
}
pub(crate) fn apply(a: &Audited, edges: &[usize], radius: f64) -> R<Body> {
    let spec = specification(a, edges, radius)?;
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
            .chain(edges.iter().map(|&i| i as f64))
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
    s: &Corner,
) -> R<Body> {
    let r = s.radius;
    let l = s.lengths;
    let det = s.signs.iter().product::<f64>();
    let fid = FrameId(1);
    let provenance = Provenance::Construction { node: root };
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
    let mut points = vec![];
    // Sphere's three cardinal vertices, four old corners, six far-arc ends.
    for k in 0..3 {
        let mut p = [r; 3];
        p[k] = 0.;
        points.push(p);
    }
    points.push(l);
    for k in 0..3 {
        let mut p = l;
        p[k] = 0.;
        points.push(p);
    }
    for k in 0..3 {
        for zero in [(k + 1) % 3, (k + 2) % 3] {
            let mut p = [r; 3];
            p[k] = l[k];
            p[zero] = 0.;
            points.push(p);
        }
    }
    let find = |p: [f64; 3]| {
        points
            .iter()
            .position(|&q| q == p)
            .expect("corner combinatorial vertex")
    };
    let far = |k: usize, zero: usize| {
        let mut p = [r; 3];
        p[k] = l[k];
        p[zero] = 0.;
        find(p)
    };
    let mut cycles = vec![];
    for k in 0..3 {
        let (i, j) = ((k + 1) % 3, (k + 2) % 3);
        cycles.push(vec![k, far(j, k), 4 + k, far(i, k)]);
    }
    for k in 0..3 {
        let (i, j) = ((k + 1) % 3, (k + 2) % 3);
        cycles.push(vec![far(k, j), 4 + j, 3, 4 + i, far(k, i)]);
    }
    for k in 0..3 {
        let (i, j) = ((k + 1) % 3, (k + 2) % 3);
        cycles.push(vec![i, j, far(k, j), far(k, i)]);
    }
    cycles.push(vec![0, 2, 1]);
    // Critical radii identify cardinal and far-arc vertices exactly. Weld only
    // equal source points, remove collapsed uses, and omit zero-area faces.
    let mut unique = vec![];
    let remap: Vec<_> = points
        .iter()
        .map(|&p| {
            if let Some(index) = unique.iter().position(|&q| q == p) {
                index
            } else {
                unique.push(p);
                unique.len() - 1
            }
        })
        .collect();
    let points = unique;
    for &p in &points {
        body.vertices.push(Vertex {
            point: v(s.point(p)?)?,
            frame: fid,
            provenance: provenance.clone(),
        });
    }
    for (face, cycle) in cycles.iter_mut().enumerate() {
        if !s.face_active(face) {
            cycle.clear();
            continue;
        }
        for vertex in cycle.iter_mut() {
            *vertex = remap[*vertex];
        }
        cycle.dedup();
        if cycle.first() == cycle.last() {
            cycle.pop();
        }
        if cycle.len() < 3 {
            return Err(no("corner-degenerate-face"));
        }
    }
    if det < 0. {
        for c in &mut cycles {
            c.reverse();
        }
    }
    for face in 0..10 {
        if !s.face_active(face) {
            continue;
        }
        let geometry = if face < 6 {
            let k = face % 3;
            let mut o = [0.; 3];
            if face >= 3 {
                o[k] = l[k];
            }
            SurfaceGeometry::Plane {
                origin: v(s.point(o)?)?,
                normal: v(s.vector(axis(k, if face < 3 { -1. } else { 1. })))?,
                x: v(s.vector(axis((k + 1) % 3, 1.)))?,
            }
        } else if face < 9 {
            let k = face - 6;
            SurfaceGeometry::Cylinder {
                origin: v(s.point([r; 3])?)?,
                axis: v(s.vector(axis(k, 1.)))?,
                x: v(s.vector(axis((k + 1) % 3, -1.)))?,
                radius: b(r)?,
            }
        } else {
            SurfaceGeometry::Sphere {
                origin: v(s.point([r; 3])?)?,
                axis: v(s.vector(axis(2, 1.)))?,
                x: v(s.vector(axis(0, 1.)))?,
                radius: b(r)?,
            }
        };
        body.surfaces.push(Surface {
            frame: fid,
            provenance: provenance.clone(),
            geometry,
        });
    }
    let mut edge_map = BTreeMap::new();
    for (face, cycle) in cycles.iter().enumerate() {
        if !s.face_active(face) {
            continue;
        }
        let surface = SurfaceId(body.faces.len() as u32);
        let mut uses = vec![];
        for (&start, &end) in cycle.iter().zip(cycle.iter().cycle().skip(1)) {
            let pair = (start.min(end), start.max(end));
            let edge = if let Some(&edge) = edge_map.get(&pair) {
                edge
            } else {
                let (a, c) = (points[start], points[end]);
                let changed: Vec<_> = (0..3).filter(|&k| a[k] != c[k]).collect();
                let arc = changed.len() == 2;
                let geometry = if arc {
                    let k = (0..3).find(|k| !changed.contains(k)).unwrap();
                    let mut o = [r; 3];
                    o[k] = a[k];
                    let radial =
                        |p: [f64; 3]| std::array::from_fn(|j| if p[j] < o[j] { -1. } else { 0. });
                    let x = s.vector(radial(a));
                    let y = s.vector(radial(c));
                    CurveGeometry::Circle {
                        origin: v(s.point(o)?)?,
                        normal: v(cross(x, y))?,
                        x: v(x)?,
                        radius: b(r)?,
                        arc: ArcKind::Trimmed {},
                    }
                } else if changed.len() == 1 {
                    CurveGeometry::Line {
                        a: v(s.point(a)?)?,
                        b: v(s.point(c)?)?,
                    }
                } else {
                    return Err(no("corner-edge"));
                };
                let id = body.edges.len();
                let curve = CurveId(body.curves.len() as u32);
                let domain = domain(arc)?;
                body.curves.push(Curve {
                    frame: fid,
                    provenance: provenance.clone(),
                    geometry,
                    domain: domain.clone(),
                    supports: vec![],
                });
                body.edges.push(Edge {
                    curve,
                    domain,
                    vertices: vec![VertexId(start as u32), VertexId(end as u32)],
                });
                edge_map.insert(pair, id);
                id
            };
            let e = &body.edges[edge];
            let [a, c] = [e.vertices[0], e.vertices[1]].map(|i| points[i.0 as usize]);
            let geometry = if face < 6 {
                let k = face % 3;
                let (i, j) = ((k + 1) % 3, (k + 2) % 3);
                let sign = det * if face < 3 { -1. } else { 1. };
                let chart = |p: [f64; 3]| [p[i], sign * p[j]];
                match body.curves[e.curve.0 as usize].geometry {
                    CurveGeometry::Circle { normal, .. } => {
                        let center = [r, sign * r];
                        let start = chart(a);
                        PcurveGeometry::CircularArc {
                            center: v2(center)?,
                            x: v2([(start[0] - center[0]) / r, (start[1] - center[1]) / r])?,
                            radius: b(r)?,
                            clockwise: dot(
                                normal.map(|x| x.get()),
                                s.vector(axis(k, if face < 3 { -1. } else { 1. })),
                            ) < 0.,
                        }
                    }
                    _ => PcurveGeometry::Line {
                        a: v2(chart(a))?,
                        b: v2(chart(c))?,
                    },
                }
            } else if face < 9 {
                let k = face - 6;
                let i = (k + 1) % 3;
                let chart = |p: [f64; 3]| -> R<Vector2> {
                    v2([if p[i] == 0. { 0. } else { det * 0.25 }, add(p[k], -r)?])
                };
                PcurveGeometry::Line {
                    a: chart(a)?,
                    b: chart(c)?,
                }
            } else {
                // Sphere chart in turns. The south pole has a different u in
                // its two incident meridians; it is one geometric vertex.
                let u = |p: [f64; 3]| if p[0] == 0. { 0.5 } else { 0.5 + det * 0.25 };
                let chart = |p: [f64; 3], other: [f64; 3]| {
                    [
                        u(if p[2] == 0. { other } else { p }),
                        if p[2] == 0. { -0.25 } else { 0. },
                    ]
                };
                PcurveGeometry::Line {
                    a: v2(chart(a, c))?,
                    b: v2(chart(c, a))?,
                }
            };
            let pc = PcurveId(body.pcurves.len() as u32);
            body.pcurves.push(Pcurve {
                curve: e.curve,
                surface,
                domain: e.domain.clone(),
                geometry,
            });
            body.curves[e.curve.0 as usize].supports.push(Support {
                surface,
                pcurve: pc,
            });
            uses.push(CoedgeId(body.coedges.len() as u32));
            body.coedges.push(Coedge {
                edge: EdgeId(edge as u32),
                forward: e.vertices[0].0 as usize == start,
                pcurve: pc,
            });
        }
        let lp = LoopId(body.loops.len() as u32);
        body.loops.push(Loop {
            outer: true,
            coedges: uses,
        });
        body.faces.push(Face {
            surface,
            forward: true,
            loops: vec![lp],
        });
    }
    body.shells.push(Shell {
        faces: (0..body.faces.len() as u32).map(FaceId).collect(),
    });
    body.solids.push(Solid {
        shells: vec![ShellId(0)],
    });
    body.clone()
        .check()
        .map_err(|e| Refused(format!("fillet/corner-contract:{e:?}")))?;
    Ok(body)
}
pub(crate) fn candidate(body: &Body) -> bool {
    crate::fillet_prism::candidate(body)
        && body
            .surfaces
            .iter()
            .any(|s| matches!(s.geometry, SurfaceGeometry::Sphere { .. }))
}
pub(crate) fn audit(checked: &CheckedBody) -> R<Audited> {
    let body = checked.body();
    if body.frames.len() != 2 || body.constructions.len() != 3 {
        return Err(no("corner-construction-chain"));
    }
    if !matches!(body.frames[1], Frame::Interpreter { parent: FrameId(0), .. }) {
        return Err(no("frame"));
    }
    let frame = crate::placement::Placement::from_frames(body, FrameId(1))
        .map_err(|_| no("frame-range"))?;
    SourceMetric::new(&frame)?;
    let input = &body.constructions[0];
    if input.operation != (Operation::Interpreter {}) || input.parameters.len() != 6 {
        return Err(no("source"));
    }
    let p: Vec<_> = input.parameters.iter().map(|x| x.get()).collect();
    let mut base = crate::orthogonal::cuboid(
        BodyKey {
            id: body.key.id,
            revision: 0,
        },
        [p[0], p[1], p[2]],
        [p[3], p[4], p[5]],
    )?;
    if body.constructions[..2] != base.constructions {
        return Err(no("base-construction"));
    }
    base.frames = body.frames.clone();
    let a = crate::polyhedron::audit(&base.check().map_err(|_| no("source-contract"))?)?;
    let node = &body.constructions[2];
    if node.operation != (Operation::Fillet {})
        || node.parents != [NodeId(1)]
        || node.parameters.len() != 4
        || node.frame != FrameId(1)
    {
        return Err(no("corner-construction-chain"));
    }
    let r = node.parameters[0].get();
    let edges = node.parameters[1..]
        .iter()
        .map(|v| {
            let x = v.get();
            if x < 0. || x.fract() != 0. || x > u32::MAX as f64 {
                Err(no("edge-index"))
            } else {
                Ok(x as usize)
            }
        })
        .collect::<R<Vec<_>>>()?;
    let spec = specification(&a, &edges, r)?;
    let mut rebuilt = apply(&a, &edges, r)?;
    rebuilt.key = body.key.clone();
    if &rebuilt != body {
        return Err(no("construction-binding"));
    }
    let mut uses: BTreeMap<u32, Vec<bool>> = BTreeMap::new();
    let mut face_loops = vec![];
    for lp in &body.loops {
        let mut cycle = vec![];
        for (i, id) in lp.coedges.iter().enumerate() {
            let co = &body.coedges[id.0 as usize];
            let next = &body.coedges[lp.coedges[(i + 1) % lp.coedges.len()].0 as usize];
            let e = &body.edges[co.edge.0 as usize];
            let n = &body.edges[next.edge.0 as usize];
            if e.vertices[usize::from(co.forward)] != n.vertices[usize::from(!next.forward)] {
                return Err(no("open-loop"));
            }
            cycle.push(e.vertices[usize::from(!co.forward)].0 as usize);
            uses.entry(co.edge.0).or_default().push(co.forward);
        }
        face_loops.push(cycle);
    }
    if uses.len() != body.edges.len()
        || uses.values().any(|v| v.len() != 2 || v[0] == v[1])
        || body.vertices.len() + body.faces.len() != body.edges.len() + 2
    {
        return Err(no("non-manifold"));
    }
    crate::fillet_prism::incidence(body)?;
    crate::fillet_corner_audit::audit(body)?;
    Ok(Audited {
        frame,
        body: rebuilt,
        axis: 2,
        levels: [0.; 2],
        cap: vec![],
        face_loops,
        bound_to_construction: true,
        orthogonal: None,
        arcs: None,
        rounded: None,
        corner: Some(spec),
        chamfer: None,
        arrangement: None,
    })
}
