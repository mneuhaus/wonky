//! Spherical B-reps and exact equatorial sphere/box intersection.
//!
//! Uses WC0's shared Sphere/Circle carriers, not a mesh or a second carrier
//! representation. A closed sphere has no topological pole/seam edges. A
//! hemisphere has one full circle; its single chart vertex is not a canonical
//! vertex. The spherical chart uses longitude in turns and latitude in radians;
//! the equator is exactly latitude zero. A plane circle pcurve is exact, too.
//!
//! Only an equatorial cut is admitted for now. General caps/lenses require
//! construction-linked algebraic circles (their radii need not be binary64).
//! Approximating those radii and pretending incidence is exact is forbidden.
use crate::affine::Affine;
use crate::polyhedron::{Audited, Refused};
use crate::rounding::round;
use wonky_contract::*;
use wonky_num::expansion::{self as ex, Guard};

type R<T> = std::result::Result<T, Refused>;
pub(crate) fn no(s: &str) -> Refused {
    Refused(format!("sphere/{s}"))
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
fn dom() -> Domain {
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
fn axis(k: usize, sign: f64) -> [f64; 3] {
    let mut v = [0.; 3];
    v[k] = sign;
    v
}
fn same(v: Vector3, p: [f64; 3]) -> bool {
    v.map(Binary64::get) == p
}
fn exact_sum(a: f64, c: f64) -> R<f64> {
    let mut g = Guard::new();
    let e = ex::sum(&[a], &[c], &mut g);
    let f = round(&e).map_err(|_| no("numeric-range"))?;
    let d = ex::sum(&e, &[-f], &mut g);
    if !g.exact() || ex::sign(&d) != 0 {
        return Err(no("chart-vertex-not-binary64"));
    }
    Ok(f)
}
fn cmp_sum(a: f64, c: f64, other: f64) -> R<i32> {
    let mut g = Guard::new();
    let e = ex::sum(&ex::sum(&[a], &[c], &mut g), &[-other], &mut g);
    if !g.exact() {
        return Err(no("numeric-range"));
    }
    Ok(ex::sign(&e) as i32)
}
fn valid_input(c: [f64; 3], r: f64) -> R<()> {
    for x in c.into_iter().chain([r]) {
        b(x)?;
    }
    if r <= 0. {
        return Err(no("nonpositive-radius"));
    }
    Ok(())
}
fn frame_value(frame: Affine) -> R<Frame> {
    let determinant = frame.det_exact().map_err(|_| no("frame-range"))?;
    if ex::sign(&determinant) <= 0 {
        return Err(no("degenerate-frame"));
    }
    Ok(Frame::Interpreter {
        parent: FrameId(0),
        origin: v(frame.origin)?,
        x: v(frame.x)?,
        z: v(frame.z)?,
    })
}
/// A unit normal's signed coordinate index; + means keep the greater half.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Cut {
    pub axis: usize,
    pub sign: f64,
}
#[derive(Clone, Debug)]
pub struct Spherical {
    pub(crate) body: Body,
    pub(crate) frame: Affine,
    pub(crate) center: [f64; 3],
    pub(crate) radius: f64,
    pub(crate) cut: Option<Cut>,
}
impl Spherical {
    pub fn body(&self) -> &Body {
        &self.body
    }
    pub(crate) fn axes(&self) -> ([f64; 3], [f64; 3]) {
        let c = self.cut.unwrap_or(Cut { axis: 2, sign: 1. });
        (axis(c.axis, c.sign), axis((c.axis + 1) % 3, 1.))
    }
}
/// Classify from exact extrema c +/- r, not rounded support points. All five
/// uncut box faces must contain the sphere; the sixth must pass its center.
fn classify(c: [f64; 3], r: f64, box3: [[f64; 3]; 2]) -> R<Cut> {
    let mut cut = None;
    for k in 0..3 {
        if box3[0][k] >= box3[1][k] {
            return Err(no("empty-box"));
        }
        for side in 0..2 {
            let bound = box3[side][k];
            b(bound)?;
            let outside = if side == 0 {
                cmp_sum(c[k], -r, bound)? < 0
            } else {
                cmp_sum(c[k], r, bound)? > 0
            };
            if outside {
                if bound != c[k] {
                    return Err(no("non-equatorial-cut-needs-algebraic-circle"));
                }
                if cut.is_some() {
                    return Err(no("multiple-plane-trim"));
                }
                cut = Some(Cut {
                    axis: k,
                    sign: if side == 0 { 1. } else { -1. },
                });
            }
        }
    }
    cut.ok_or_else(|| no("box-does-not-cut"))
}
fn assemble(
    key: BodyKey,
    source: [u32; 4],
    c: [f64; 3],
    r: f64,
    frame: Affine,
    box3: Option<[[f64; 3]; 2]>,
) -> R<Body> {
    valid_input(c, r)?;
    let cut = box3.map(|bx| classify(c, r, bx)).transpose()?;
    let mut nodes = vec![
        Construction {
            operation: Operation::Interpreter {},
            rule_version: 1,
            parents: vec![],
            parameters: c.into_iter().chain([r]).map(b).collect::<R<_>>()?,
            frame: FrameId(0),
        },
        Construction {
            operation: Operation::Sphere {},
            rule_version: 1,
            parents: vec![NodeId(0)],
            parameters: vec![],
            frame: FrameId(1),
        },
    ];
    if let Some(bx) = box3 {
        nodes.push(Construction {
            operation: Operation::Interpreter {},
            rule_version: 1,
            parents: vec![],
            parameters: bx.into_iter().flatten().map(b).collect::<R<_>>()?,
            frame: FrameId(0),
        });
        nodes.push(Construction {
            operation: Operation::Boolean {},
            rule_version: 1,
            parents: vec![NodeId(1), NodeId(2)],
            parameters: vec![b(2.)?],
            frame: FrameId(1),
        });
    }
    let provenance = Provenance::Construction {
        node: NodeId((nodes.len() - 1) as u32),
    };
    let ca = cut.unwrap_or(Cut { axis: 2, sign: 1. });
    let z = axis(ca.axis, ca.sign);
    let x = axis((ca.axis + 1) % 3, 1.);
    let mut body = Body {
        key,
        frames: vec![Frame::Source { source }, frame_value(frame)?],
        constructions: nodes,
        vertices: vec![],
        curves: vec![],
        pcurves: vec![],
        edges: vec![],
        coedges: vec![],
        loops: vec![],
        surfaces: vec![Surface {
            frame: FrameId(1),
            provenance: provenance.clone(),
            geometry: SurfaceGeometry::Sphere {
                origin: v(c)?,
                axis: v(z)?,
                x: v(x)?,
                radius: b(r)?,
            },
        }],
        faces: vec![Face {
            surface: SurfaceId(0),
            forward: true,
            loops: vec![],
        }],
        shells: vec![Shell {
            faces: vec![FaceId(0)],
        }],
        solids: vec![Solid {
            shells: vec![ShellId(0)],
        }],
        facts: vec![],
        budgets: vec![],
    };
    if cut.is_some() {
        let mut p = c;
        let radial = (ca.axis + 1) % 3;
        p[radial] = exact_sum(c[radial], r)?;
        body.vertices.push(Vertex {
            point: v(p)?,
            frame: FrameId(1),
            provenance: provenance.clone(),
        });
        body.surfaces.push(Surface {
            frame: FrameId(1),
            provenance: provenance.clone(),
            geometry: SurfaceGeometry::Plane {
                origin: v(c)?,
                normal: v(z)?,
                x: v(x)?,
            },
        });
        body.curves.push(Curve {
            frame: FrameId(1),
            provenance,
            geometry: CurveGeometry::Circle {
                origin: v(c)?,
                normal: v(z)?,
                x: v(x)?,
                radius: b(r)?,
                arc: ArcKind::Full {},
            },
            domain: dom(),
            supports: vec![
                Support {
                    surface: SurfaceId(0),
                    pcurve: PcurveId(0),
                },
                Support {
                    surface: SurfaceId(1),
                    pcurve: PcurveId(1),
                },
            ],
        });
        body.pcurves = vec![
            Pcurve {
                curve: CurveId(0),
                surface: SurfaceId(0),
                domain: dom(),
                geometry: PcurveGeometry::Line {
                    a: uv([0., 0.])?,
                    b: uv([1., 0.])?,
                },
            },
            Pcurve {
                curve: CurveId(0),
                surface: SurfaceId(1),
                domain: dom(),
                geometry: PcurveGeometry::Circle {
                    origin: uv([0., 0.])?,
                    radius: b(r)?,
                    clockwise: false,
                },
            },
        ];
        body.edges.push(Edge {
            curve: CurveId(0),
            domain: dom(),
            vertices: vec![VertexId(0); 2],
        });
        body.coedges = vec![
            Coedge {
                edge: EdgeId(0),
                forward: true,
                pcurve: PcurveId(0),
            },
            Coedge {
                edge: EdgeId(0),
                forward: false,
                pcurve: PcurveId(1),
            },
        ];
        body.loops = vec![
            Loop {
                outer: true,
                coedges: vec![CoedgeId(0)],
            },
            Loop {
                outer: true,
                coedges: vec![CoedgeId(1)],
            },
        ];
        body.faces[0].loops.push(LoopId(0));
        body.faces.push(Face {
            surface: SurfaceId(1),
            forward: false,
            loops: vec![LoopId(1)],
        });
        body.shells[0].faces.push(FaceId(1));
    }
    body.clone().check().map_err(|_| no("contract"))?;
    Ok(body)
}
pub fn sphere(key: BodyKey, center: [f64; 3], radius: f64) -> R<Body> {
    let source = key.id;
    assemble(key, source, center, radius, Affine::IDENTITY, None)
}
pub fn transform(a: &Spherical, frame: Affine) -> R<Body> {
    if a.frame != Affine::IDENTITY {
        return Err(no("placement-already-applied"));
    }
    let mut b = a.body.clone();
    b.frames[1] = frame_value(frame)?;
    b.key.revision = b
        .key
        .revision
        .checked_add(1)
        .ok_or_else(|| no("revision-range"))?;
    Ok(b)
}
pub fn intersect_box(key: BodyKey, a: &Spherical, b: &Audited) -> R<Body> {
    if a.cut.is_some() {
        return Err(no("retrim-not-supported"));
    }
    if a.frame != b.frame {
        return Err(no("different-exact-frames"));
    }
    let cells = b.orthogonal.as_ref().ok_or_else(|| no("non-box-tool"))?;
    if cells.boxes.len() != 1 {
        return Err(no("non-box-tool"));
    }
    let Frame::Source { source } = a.body.frames[0] else {
        return Err(no("source-frame"));
    };
    assemble(
        key,
        source,
        a.center,
        a.radius,
        a.frame,
        Some(cells.boxes[0]),
    )
}

/// Independent boundary audit. Checks carrier identities, full-circle supports,
/// incidence, shell orientation and the construction grammar. Does not replay
/// the builder: changing a stored surface, vertex, pcurve or face must fail.
pub fn audit(checked: &CheckedBody) -> R<Spherical> {
    let bdy = checked.body();
    let bad = || no("construction-body-mismatch");
    if bdy.frames.len() != 2
        || !matches!(bdy.frames[0], Frame::Source { .. })
        || !bdy.facts.is_empty()
        || !bdy.budgets.is_empty()
    {
        return Err(bad());
    }
    let Frame::Interpreter {
        parent: FrameId(0),
        origin,
        x,
        z,
    } = bdy.frames[1]
    else {
        return Err(bad());
    };
    let frame = Affine {
        origin: origin.map(Binary64::get),
        x: x.map(Binary64::get),
        z: z.map(Binary64::get),
    };
    frame_value(frame)?;
    if bdy.constructions.len() != 2 && bdy.constructions.len() != 4 {
        return Err(bad());
    }
    let ns = &bdy.constructions;
    let root = &ns[0];
    if root.operation != (Operation::Interpreter {})
        || root.rule_version != 1
        || !root.parents.is_empty()
        || root.parameters.len() != 4
        || root.frame != FrameId(0)
    {
        return Err(bad());
    }
    let c = [
        root.parameters[0].get(),
        root.parameters[1].get(),
        root.parameters[2].get(),
    ];
    let r = root.parameters[3].get();
    valid_input(c, r)?;
    if ns[1]
        != (Construction {
            operation: Operation::Sphere {},
            rule_version: 1,
            parents: vec![NodeId(0)],
            parameters: vec![],
            frame: FrameId(1),
        })
    {
        return Err(bad());
    }
    let cut = if ns.len() == 4 {
        let q = &ns[2];
        if q.operation != (Operation::Interpreter {})
            || q.rule_version != 1
            || !q.parents.is_empty()
            || q.parameters.len() != 6
            || q.frame != FrameId(0)
        {
            return Err(bad());
        }
        if ns[3]
            != (Construction {
                operation: Operation::Boolean {},
                rule_version: 1,
                parents: vec![NodeId(1), NodeId(2)],
                parameters: vec![b(2.)?],
                frame: FrameId(1),
            })
        {
            return Err(bad());
        }
        let p: Vec<_> = q.parameters.iter().map(|v| v.get()).collect();
        Some(classify(c, r, [[p[0], p[1], p[2]], [p[3], p[4], p[5]]])?)
    } else {
        None
    };
    let count = if cut.is_some() { 2 } else { 1 };
    if bdy.surfaces.len() != count
        || bdy.faces.len() != count
        || bdy.shells.len() != 1
        || bdy.solids
            != [Solid {
                shells: vec![ShellId(0)],
            }]
        || bdy.shells[0].faces != (0..count).map(|i| FaceId(i as u32)).collect::<Vec<_>>()
    {
        return Err(bad());
    }
    let ca = cut.unwrap_or(Cut { axis: 2, sign: 1. });
    let z = axis(ca.axis, ca.sign);
    let x = axis((ca.axis + 1) % 3, 1.);
    let prov = Provenance::Construction {
        node: NodeId((ns.len() - 1) as u32),
    };
    for s in &bdy.surfaces {
        if s.frame != FrameId(1) || s.provenance != prov {
            return Err(bad());
        }
    }
    let SurfaceGeometry::Sphere {
        origin,
        axis: sz,
        x: sx,
        radius,
    } = bdy.surfaces[0].geometry
    else {
        return Err(bad());
    };
    if !same(origin, c) || !same(sz, z) || !same(sx, x) || radius.get() != r {
        return Err(bad());
    }
    if cut.is_none() {
        if !bdy.vertices.is_empty()
            || !bdy.curves.is_empty()
            || !bdy.pcurves.is_empty()
            || !bdy.edges.is_empty()
            || !bdy.coedges.is_empty()
            || !bdy.loops.is_empty()
            || bdy.faces[0]
                != (Face {
                    surface: SurfaceId(0),
                    forward: true,
                    loops: vec![],
                })
        {
            return Err(bad());
        }
    } else {
        if bdy.vertices.len() != 1
            || bdy.curves.len() != 1
            || bdy.pcurves.len() != 2
            || bdy.edges.len() != 1
            || bdy.coedges.len() != 2
            || bdy.loops.len() != 2
        {
            return Err(bad());
        }
        let SurfaceGeometry::Plane {
            origin,
            normal,
            x: px,
        } = bdy.surfaces[1].geometry
        else {
            return Err(bad());
        };
        if !same(origin, c) || !same(normal, z) || !same(px, x) {
            return Err(bad());
        }
        let cv = &bdy.curves[0];
        let CurveGeometry::Circle {
            origin,
            normal,
            x: cx,
            radius,
            arc: ArcKind::Full {},
        } = cv.geometry
        else {
            return Err(bad());
        };
        if cv.frame != FrameId(1)
            || cv.provenance != prov
            || cv.domain != dom()
            || !same(origin, c)
            || !same(normal, z)
            || !same(cx, x)
            || radius.get() != r
            || cv.supports
                != [
                    Support {
                        surface: SurfaceId(0),
                        pcurve: PcurveId(0),
                    },
                    Support {
                        surface: SurfaceId(1),
                        pcurve: PcurveId(1),
                    },
                ]
        {
            return Err(bad());
        }
        let vertex = &bdy.vertices[0];
        if vertex.frame != FrameId(1) || vertex.provenance != prov {
            return Err(bad());
        }
        // Independent incidence: p-c == r*x, exact (not builder replay).
        for k in 0..3 {
            if cmp_sum(c[k], r * x[k], vertex.point[k].get())? != 0 {
                return Err(bad());
            }
        }
        if bdy.edges[0]
            != (Edge {
                curve: CurveId(0),
                domain: dom(),
                vertices: vec![VertexId(0); 2],
            })
        {
            return Err(bad());
        }
        for i in 0..2 {
            let pc = &bdy.pcurves[i];
            let geometry = if i == 0 {
                PcurveGeometry::Line {
                    a: uv([0., 0.])?,
                    b: uv([1., 0.])?,
                }
            } else {
                PcurveGeometry::Circle {
                    origin: uv([0., 0.])?,
                    radius: b(r)?,
                    clockwise: false,
                }
            };
            if pc.curve != CurveId(0)
                || pc.surface != SurfaceId(i as u32)
                || pc.domain != dom()
                || pc.geometry != geometry
                || bdy.coedges[i]
                    != (Coedge {
                        edge: EdgeId(0),
                        forward: i == 0,
                        pcurve: PcurveId(i as u32),
                    })
                || bdy.loops[i]
                    != (Loop {
                        outer: true,
                        coedges: vec![CoedgeId(i as u32)],
                    })
                || bdy.faces[i]
                    != (Face {
                        surface: SurfaceId(i as u32),
                        forward: i == 0,
                        loops: vec![LoopId(i as u32)],
                    })
            {
                return Err(bad());
            }
        }
    }
    Ok(Spherical {
        body: bdy.clone(),
        frame,
        center: c,
        radius: r,
        cut,
    })
}
