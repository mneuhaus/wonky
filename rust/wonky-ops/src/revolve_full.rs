//! Full-turn polygonal meridians. Source coordinates stay authoritative:
//! an axial-X sketch is revolved in that very sketch frame, never pulled back
//! through rounded world coordinates. Cones carry two exact meridian points,
//! not a rounded atan/slope. STEP alone observes their angles.
use crate::{affine::Affine, polyhedron::Refused};
use num_rational::BigRational as Q;
use num_traits::{ToPrimitive, Zero};
use wonky_contract::*;
use wonky_num::expansion::{self as ex, Guard};
use wonky_sketch::region::lines_region;
pub(crate) type R<T> = std::result::Result<T, Refused>;
pub(crate) fn no(s: &str) -> Refused {
    Refused(format!("revolve/full/{s}"))
}
fn b(x: f64) -> R<Binary64> {
    Binary64::new(x).map_err(|_| no("numeric-range"))
}
fn v(p: [f64; 3]) -> R<Vector3> {
    Ok([b(p[0])?, b(p[1])?, b(p[2])?])
}
fn uv(p: [f64; 2]) -> R<Vector2> {
    Ok([b(p[0])?, b(p[1])?])
}
fn domain() -> Domain {
    Domain {
        lower: Limit::Finite {
            value: Binary64::new(0.).unwrap(),
            closed: true,
        },
        upper: Limit::Finite {
            value: Binary64::new(1.).unwrap(),
            closed: true,
        },
    }
}

#[derive(Clone, Debug)]
pub struct FullRevolve {
    pub(crate) body: Body,
    pub(crate) frame: Affine,
    /// Right-handed canonical (radial, tangential, axial) basis in source space.
    pub(crate) mode: usize,
    pub(crate) points: Vec<[f64; 2]>, // (radius, axial height), CCW
}
/// Signed permutations only; no coordinate arithmetic or hidden normalization.
pub(crate) fn local(mode: usize, r: f64, t: f64, h: f64) -> [f64; 3] {
    match mode {
        0 => [h, r, t],
        1 => [r, h, -t],
        _ => [r, t, h],
    }
}
fn parallel(a: [f64; 3], c: [ex::Exp; 3], g: &mut Guard) -> bool {
    (0..3).all(|k| {
        let (i, j) = ((k + 1) % 3, (k + 2) % 3);
        ex::sign(&ex::sum(
            &ex::mul(&[a[i]], &c[j], g),
            &ex::neg(&ex::mul(&[a[j]], &c[i], g)),
            g,
        )) == 0
    })
}
/// Rebase the source sketch onto an exactly incident axis origin. A rational
/// inverse proves incidence in span(x, z cross x); no rounded world point is
/// used as a replacement construction. The current carrier stores binary64
/// coordinates, so every translated coordinate must be exactly representable.
fn rebase_segments(frame: Affine, origin: [f64; 3], segments: &[[f64; 4]]) -> R<Vec<[f64; 4]>> {
    if origin == frame.origin {
        return Ok(segments.to_vec());
    }
    // in_sketch range-checks all source scalars before this exact fallback.
    let q = |x| Q::from_float(x).expect("finite source scalar");
    let cross = |a: &[Q; 3], b: &[Q; 3]| -> [Q; 3] {
        [(1, 2), (2, 0), (0, 1)].map(|(i, j)| &a[i] * &b[j] - &a[j] * &b[i])
    };
    let dot = |a: &[Q; 3], b: &[Q; 3]| -> Q { (0..3).map(|k| &a[k] * &b[k]).sum() };
    let x = frame.x.map(q);
    let y = cross(&frame.z.map(q), &x);
    let n = cross(&x, &y);
    let delta = std::array::from_fn(|k| q(origin[k]) - q(frame.origin[k]));
    let det = dot(&n, &n);
    if det.is_zero() || !dot(&delta, &n).is_zero() {
        return Err(no("axis-frame-proof-unavailable"));
    }
    let offset = [dot(&cross(&delta, &y), &n) / &det, dot(&cross(&x, &delta), &n) / det];
    segments.iter().map(|p| {
        let mut out = [0.; 4];
        for k in 0..4 {
            let exact = q(p[k]) - &offset[k % 2];
            let f = exact.to_f64().filter(|f| f.is_finite())
                .ok_or_else(|| no("axis-coordinate-not-representable"))?;
            if q(f) != exact { return Err(no("axis-coordinate-not-representable")); }
            out[k] = f;
        }
        Ok(out)
    }).collect()
}
/// Independent world axis must be parallel to a source sketch coordinate axis
/// and lie in the sketch plane. Equality is proved over exact expansions and
/// rationals, including the implicit sketch-y cross product. A one-ulp tilt or
/// out-of-plane offset is never snapped into place.
pub fn in_sketch(
    key: BodyKey,
    source: [u32; 4],
    frame: Affine,
    origin: [f64; 3],
    axis: [f64; 3],
    segments: &[[f64; 4]],
    angle: f64,
) -> R<Body> {
    let values = frame.origin.into_iter().chain(frame.x).chain(frame.z)
        .chain(origin).chain(axis).chain(segments.iter().flatten().copied()).collect::<Vec<_>>();
    wonky_num::check_range(&values, "polygon revolve axis").map_err(|e| {
        e.into_refusal(); no("numeric-range")
    })?;
    if axis == [0.; 3] {
        return Err(no("axis-frame-proof-unavailable"));
    }
    let mut g = Guard::new();
    let mode = if parallel(axis, frame.x.map(|x| vec![x]), &mut g) {
        0
    } else if parallel(axis, frame.y_exact(&mut g), &mut g) {
        1
    } else {
        return Err(no("axis-frame-proof-unavailable"));
    };
    if !g.exact() {
        return Err(no("numeric-range"));
    }
    let seg = rebase_segments(frame, origin, segments)?
        .iter()
        .map(|p| {
            if mode == 0 {
                [p[1], p[0], p[3], p[2]]
            } else {
                *p
            }
        })
        .collect::<Vec<_>>();
    build(key, source, Affine { origin, ..frame }, mode, &seg, angle)
}
fn profile(segments: &[[f64; 4]]) -> R<Vec<[f64; 2]>> {
    let seg = segments
        .iter()
        .map(|s| [wonky_num::p2(s[0], s[1]), wonky_num::p2(s[2], s[3])])
        .collect::<Vec<_>>();
    let r = lines_region(&seg).map_err(|_| no("invalid-profile"))?;
    if r.loops.len() != 1 || r.open_wires != 0 {
        return Err(no("one-closed-region-required"));
    }
    let p = r.loops[0]
        .points
        .iter()
        .map(|p| [p.x, p.y])
        .collect::<Vec<_>>();
    if p.iter().any(|p| p[0] < 0.) {
        return Err(no("axis-crossing-profile"));
    }
    let n = p.len();
    // Every axis vertex ends an axis interval. From there the next meridian
    // segment is either a disk (same height) or a cone to an exact apex: a
    // singular point of one conical face, still a manifold solid. An axis
    // vertex between two off-axis segments is a pinch (two apexes touching).
    for i in 0..n {
        let c = p[(i + 1) % n];
        if p[i][0] == 0. && p[(i + n - 1) % n][0] != 0. && c[0] != 0. {
            return Err(no("isolated-axis-contact"));
        }
    }
    // Multiple separated intervals touching the axis create separate pinches
    // after revolution. Admit a single connected axis boundary or an annulus.
    if (0..n)
        .filter(|&i| p[i][0] == 0. && p[(i + n - 1) % n][0] > 0.)
        .count()
        > 1
    {
        return Err(no("multiple-axis-intervals"));
    }
    Ok(p)
}
pub fn candidate(body: &Body) -> bool {
    body.constructions
        .iter()
        .any(|n| matches!(n.operation, Operation::Revolve {}) && n.rule_version == 2)
}
pub fn build(
    key: BodyKey,
    source: [u32; 4],
    frame: Affine,
    mode: usize,
    segments: &[[f64; 4]],
    angle: f64,
) -> R<Body> {
    if !wonky_geom::turn::sentinel(angle, 360) {
        return Err(no("angle-not-full-turn"));
    }
    if mode > 2 || ex::sign(&frame.det_exact().map_err(|_| no("frame-range"))?) <= 0 {
        return Err(no("degenerate-frame"));
    }
    let points = profile(segments)?;
    let params = std::iter::once(mode as f64)
        .chain(frame.origin)
        .chain(frame.x)
        .chain(frame.z)
        .chain(points.iter().flatten().copied())
        .map(b)
        .collect::<R<Vec<_>>>()?;
    let prov = Provenance::Construction { node: NodeId(1) };
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
                parameters: params,
                frame: FrameId(0),
            },
            Construction {
                operation: Operation::Revolve {},
                rule_version: 2,
                parents: vec![NodeId(0)],
                parameters: vec![],
                frame: FrameId(1),
            },
        ],
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
    let axis = v(local(mode, 0., 0., 1.))?;
    let radial = v(local(mode, 1., 0., 0.))?;
    let mut rings = vec![None; points.len()];
    for (i, p) in points.iter().enumerate().filter(|(_, p)| p[0] > 0.) {
        let e = body.edges.len() as u32;
        rings[i] = Some(e);
        body.vertices.push(Vertex {
            point: v(local(mode, p[0], 0., p[1]))?,
            frame: FrameId(1),
            provenance: prov.clone(),
        });
        body.curves.push(Curve {
            frame: FrameId(1),
            provenance: prov.clone(),
            geometry: CurveGeometry::Circle {
                origin: v(local(mode, 0., 0., p[1]))?,
                normal: axis,
                x: radial,
                radius: b(p[0])?,
                arc: ArcKind::Full {},
            },
            domain: domain(),
            supports: vec![],
        });
        body.edges.push(Edge {
            curve: CurveId(e),
            domain: domain(),
            vertices: vec![VertexId(e); 2],
        });
    }
    for i in 0..points.len() {
        let j = (i + 1) % points.len();
        let (a, c) = (points[i], points[j]);
        if a[0] == 0. && c[0] == 0. {
            continue;
        }
        let f = body.faces.len() as u32;
        let planar = a[1] == c[1];
        let geometry = if planar {
            SurfaceGeometry::Plane {
                origin: v(local(mode, 0., 0., a[1]))?,
                normal: axis,
                x: radial,
            }
        } else if a[0] == c[0] {
            SurfaceGeometry::Cylinder {
                origin: v([0.; 3])?,
                axis,
                x: radial,
                radius: b(a[0])?,
            }
        } else {
            SurfaceGeometry::ConeMeridian {
                origin: v([0.; 3])?,
                axis,
                x: radial,
                start: uv(a)?,
                end: uv(c)?,
            }
        };
        body.surfaces.push(Surface {
            frame: FrameId(1),
            provenance: prov.clone(),
            geometry,
        });
        let mut loops = vec![];
        // An apex face (one end on the axis) is a disk: its only ring is outer.
        let apex = !planar && (a[0] == 0. || c[0] == 0.);
        for (point, forward) in [(i, true), (j, false)] {
            let Some(e) = rings[point] else {
                continue;
            };
            let p = points[point];
            let k = body.coedges.len() as u32;
            let geometry = if planar {
                PcurveGeometry::Circle {
                    origin: uv([0., 0.])?,
                    radius: b(p[0])?,
                    clockwise: false,
                }
            } else {
                PcurveGeometry::Line {
                    a: uv([0., p[1]])?,
                    b: uv([1., p[1]])?,
                }
            };
            body.pcurves.push(Pcurve {
                curve: CurveId(e),
                surface: SurfaceId(f),
                domain: domain(),
                geometry,
            });
            body.curves[e as usize].supports.push(Support {
                surface: SurfaceId(f),
                pcurve: PcurveId(k),
            });
            body.coedges.push(Coedge {
                edge: EdgeId(e),
                forward,
                pcurve: PcurveId(k),
            });
            // Outer planar ring is the larger radius; periodic side charts have
            // their first ring outer. Opposite coedge senses close every ring.
            body.loops.push(Loop {
                outer: if planar {
                    p[0] == a[0].max(c[0])
                } else {
                    forward || apex
                },
                coedges: vec![CoedgeId(k)],
            });
            loops.push(LoopId(k));
        }
        body.faces.push(Face {
            surface: SurfaceId(f),
            forward: if planar { a[0] > c[0] } else { c[1] > a[1] },
            loops,
        });
    }
    body.shells.push(Shell {
        faces: (0..body.faces.len()).map(|i| FaceId(i as u32)).collect(),
    });
    body.solids.push(Solid {
        shells: vec![ShellId(0)],
    });
    let checked = body
        .clone()
        .check()
        .map_err(|e| no(&format!("contract: {e:?}")))?;
    audit(&checked)?;
    Ok(body)
}
/// Audit the actual rings, carriers, trims, winding and source binding. Does
/// not rebuild the body or use the builder as a geometry oracle.
pub fn audit(checked: &CheckedBody) -> R<FullRevolve> {
    if crate::revolve_boolean::candidate(checked.body()) {
        return crate::revolve_boolean::audit(checked);
    }
    let body = checked.body();
    let bad = || no("construction-body-mismatch");
    if body.constructions.len() != 2
        || body.frames.len() != 2
        || !body.facts.is_empty()
        || !body.budgets.is_empty()
    {
        return Err(bad());
    }
    let n = &body.constructions[0];
    if n.operation != (Operation::Interpreter {})
        || n.rule_version != 1
        || !n.parents.is_empty()
        || n.frame != FrameId(0)
        || n.parameters.len() < 16
        || n.parameters.len() % 2 != 0
    {
        return Err(bad());
    }
    if body.constructions[1]
        != (Construction {
            operation: Operation::Revolve {},
            rule_version: 2,
            parents: vec![NodeId(0)],
            parameters: vec![],
            frame: FrameId(1),
        })
    {
        return Err(bad());
    }
    let p = n.parameters.iter().map(|v| v.get()).collect::<Vec<_>>();
    if ![0., 1., 2.].contains(&p[0]) {
        return Err(bad());
    }
    let mode = p[0] as usize;
    let frame = Affine {
        origin: [p[1], p[2], p[3]],
        x: [p[4], p[5], p[6]],
        z: [p[7], p[8], p[9]],
    };
    if !matches!(body.frames[0], Frame::Source { .. })
        || body.frames[1]
            != (Frame::Interpreter {
                parent: FrameId(0),
                origin: v(frame.origin)?,
                x: v(frame.x)?,
                z: v(frame.z)?,
            })
        || ex::sign(&frame.det_exact().map_err(|_| bad())?) <= 0
    {
        return Err(bad());
    }
    let points = p[10..]
        .chunks_exact(2)
        .map(|a| [a[0], a[1]])
        .collect::<Vec<_>>();
    let segments = (0..points.len())
        .map(|i| {
            let (a, c) = (points[i], points[(i + 1) % points.len()]);
            [a[0], a[1], c[0], c[1]]
        })
        .collect::<Vec<_>>();
    // Region solver revalidates a simple, positively oriented source boundary.
    let valid = profile(&segments)?;
    if !(0..points.len())
        .any(|shift| (0..points.len()).all(|i| points[i] == valid[(i + shift) % valid.len()]))
    {
        return Err(bad());
    }
    let mut rings = vec![None; points.len()];
    let mut e = 0;
    let prov = Provenance::Construction { node: NodeId(1) };
    let axis = v(local(mode, 0., 0., 1.))?;
    let radial = v(local(mode, 1., 0., 0.))?;
    for (i, p) in points.iter().enumerate().filter(|(_, p)| p[0] > 0.) {
        let (Some(vertex), Some(curve), Some(edge)) =
            (body.vertices.get(e), body.curves.get(e), body.edges.get(e))
        else {
            return Err(bad());
        };
        if vertex.frame != FrameId(1)
            || vertex.provenance != prov
            || vertex.point != v(local(mode, p[0], 0., p[1]))?
            || curve.frame != FrameId(1)
            || curve.provenance != prov
            || curve.domain != domain()
            || edge.curve != CurveId(e as u32)
            || edge.domain != domain()
            || edge.vertices != [VertexId(e as u32); 2]
        {
            return Err(bad());
        }
        let CurveGeometry::Circle {
            origin,
            normal,
            x,
            radius,
            arc,
        } = &curve.geometry
        else {
            return Err(bad());
        };
        if *origin != v(local(mode, 0., 0., p[1]))?
            || *normal != axis
            || *x != radial
            || radius.get() != p[0]
            || *arc != (ArcKind::Full {})
        {
            return Err(bad());
        }
        rings[i] = Some(e);
        e += 1;
    }
    if body.vertices.len() != e
        || body.curves.len() != e
        || body.edges.len() != e
        || body.coedges.len() != 2 * e
        || body.loops.len() != 2 * e
        || body.pcurves.len() != 2 * e
    {
        return Err(bad());
    }
    let mut f = 0;
    let mut used = vec![false; 2 * e];
    let mut uses = vec![vec![]; e];
    for i in 0..points.len() {
        let j = (i + 1) % points.len();
        let (a, c) = (points[i], points[j]);
        if a[0] == 0. && c[0] == 0. {
            continue;
        }
        let (Some(face), Some(s)) = (body.faces.get(f), body.surfaces.get(f)) else {
            return Err(bad());
        };
        let planar = a[1] == c[1];
        if face.surface != SurfaceId(f as u32)
            || face.forward != if planar { a[0] > c[0] } else { c[1] > a[1] }
            || s.frame != FrameId(1)
            || s.provenance != prov
        {
            return Err(bad());
        }
        match &s.geometry {
            SurfaceGeometry::Plane { origin, normal, x } if planar => {
                if *origin != v(local(mode, 0., 0., a[1]))? || *normal != axis || *x != radial {
                    return Err(bad());
                }
            }
            SurfaceGeometry::Cylinder {
                origin,
                axis: z,
                x,
                radius,
            } if !planar && a[0] == c[0] => {
                if *origin != v([0.; 3])? || *z != axis || *x != radial || radius.get() != a[0] {
                    return Err(bad());
                }
            }
            SurfaceGeometry::ConeMeridian {
                origin,
                axis: z,
                x,
                start,
                end,
            } if !planar && a[0] != c[0] => {
                if *origin != v([0.; 3])?
                    || *z != axis
                    || *x != radial
                    || *start != uv(a)?
                    || *end != uv(c)?
                {
                    return Err(bad());
                }
            }
            _ => return Err(bad()),
        }
        let ends = [(i, true), (j, false)]
            .into_iter()
            .filter(|(i, _)| rings[*i].is_some())
            .collect::<Vec<_>>();
        if face.loops.len() != ends.len() {
            return Err(bad());
        }
        let apex = !planar && (a[0] == 0. || c[0] == 0.);
        for (l, (pi, forward)) in face.loops.iter().zip(ends) {
            let lp = &body.loops[l.0 as usize];
            let p = points[pi];
            let e = rings[pi].unwrap();
            if lp.coedges.len() != 1
                || lp.outer
                    != if planar {
                        p[0] == a[0].max(c[0])
                    } else {
                        forward || apex
                    }
            {
                return Err(bad());
            }
            let k = lp.coedges[0].0 as usize;
            let co = &body.coedges[k];
            let pc = &body.pcurves[co.pcurve.0 as usize];
            if used[k]
                || co.edge != EdgeId(e as u32)
                || co.forward != forward
                || co.pcurve != PcurveId(k as u32)
                || l.0 as usize != k
                || pc.curve != CurveId(e as u32)
                || pc.surface != SurfaceId(f as u32)
                || pc.domain != domain()
            {
                return Err(bad());
            }
            let good = match &pc.geometry {
                PcurveGeometry::Circle {
                    origin,
                    radius,
                    clockwise,
                } if planar => *origin == uv([0., 0.])? && radius.get() == p[0] && !clockwise,
                PcurveGeometry::Line { a, b } if !planar => {
                    *a == uv([0., p[1]])? && *b == uv([1., p[1]])?
                }
                _ => false,
            };
            if !good {
                return Err(bad());
            }
            used[k] = true;
            uses[e].push((
                forward,
                Support {
                    surface: SurfaceId(f as u32),
                    pcurve: PcurveId(k as u32),
                },
            ));
        }
        f += 1;
    }
    if body.faces.len() != f
        || body.surfaces.len() != f
        || used.contains(&false)
        || body.shells.len() != 1
        || body.solids.len() != 1
        || body.solids[0].shells != [ShellId(0)]
        || body.shells[0].faces != (0..f).map(|i| FaceId(i as u32)).collect::<Vec<_>>()
    {
        return Err(bad());
    }
    for (i, uses) in uses.iter().enumerate() {
        if uses.len() != 2
            || uses[0].0 == uses[1].0
            || body.curves[i].supports != uses.iter().map(|(_, s)| s.clone()).collect::<Vec<_>>()
        {
            return Err(bad());
        }
    }
    Ok(FullRevolve {
        body: body.clone(),
        frame,
        mode,
        points,
    })
}
