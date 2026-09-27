//! Exact Z-axis cylinders and sphere/coaxial-cylinder subtraction.
//! Full-ring topology and planar/cylindrical charts follow acid-arcs' cylinder
//! owner. The spherical chart stores height, not a rounded asin. A candidate
//! ring height is admitted only after its squared incidence is proved exactly.
use crate::{affine::Affine, polyhedron::Refused, sphere::Spherical};
use wonky_contract::*;
use wonky_num::expansion::{self as ex, Guard};
pub(crate) type R<T> = std::result::Result<T, Refused>;
pub(crate) fn no(s: &str) -> Refused {
    Refused(format!("axial/{s}"))
}
fn b(x: f64) -> R<Binary64> {
    Binary64::new(x).map_err(|_| no("numeric-range"))
}
fn v(a: [f64; 3]) -> R<Vector3> {
    Ok([b(a[0])?, b(a[1])?, b(a[2])?])
}
fn uv(a: [f64; 2]) -> R<Vector2> {
    Ok([b(a[0])?, b(a[1])?])
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
pub(crate) fn exact_add(a: f64, c: f64) -> R<f64> {
    let mut g = Guard::new();
    let (s, e) = ex::two_sum(a, c, &mut g);
    if !g.exact() || e != 0. {
        return Err(no("coordinate-not-binary64"));
    }
    b(s)?;
    Ok(s)
}
fn cmp_add(a: f64, c: f64, d: f64) -> R<i32> {
    let mut g = Guard::new();
    let value = ex::sum(&ex::sum(&[a], &[c], &mut g), &[-d], &mut g);
    if !g.exact() {
        return Err(no("numeric-range"));
    }
    Ok(ex::sign(&value))
}
fn frame_value(f: Affine) -> R<Frame> {
    if ex::sign(&f.det_exact().map_err(|_| no("frame-range"))?) <= 0 {
        return Err(no("singular-frame"));
    }
    Ok(Frame::Interpreter {
        parent: FrameId(0),
        origin: v(f.origin)?,
        x: v(f.x)?,
        z: v(f.z)?,
    })
}
#[derive(Clone, Debug)]
pub struct Axial {
    pub(crate) body: Body,
    pub(crate) frame: Affine,
    pub(crate) center: [f64; 3],
    pub(crate) radius: f64,
    pub(crate) levels: [f64; 2],
    pub(crate) outer: Option<f64>,
}
impl Axial {
    pub fn body(&self) -> &Body {
        &self.body
    }
    /// Reuse the spherical owner's exact affine metric, with a conservative
    /// extent for the cylindrical export error budget. Not a second solid.
    pub(crate) fn metric(&self) -> Spherical {
        Spherical {
            body: self.body.clone(),
            frame: self.frame,
            center: self.center,
            radius: self
                .outer
                .unwrap_or(self.radius + self.levels[0].abs().max(self.levels[1].abs())),
            cut: None,
        }
    }
    pub fn transform(&self, f: Affine) -> R<Body> {
        if self.frame != Affine::IDENTITY {
            return Err(no("placement-already-applied"));
        }
        let mut body = self.body.clone();
        body.frames[1] = frame_value(f)?;
        body.key.revision = body
            .key
            .revision
            .checked_add(1)
            .ok_or_else(|| no("revision-range"))?;
        Ok(body)
    }
}
fn input(params: Vec<f64>) -> R<Construction> {
    Ok(Construction {
        operation: Operation::Interpreter {},
        rule_version: 1,
        parents: vec![],
        parameters: params.into_iter().map(b).collect::<R<_>>()?,
        frame: FrameId(0),
    })
}
fn node(operation: Operation, parents: Vec<NodeId>) -> Construction {
    Construction {
        operation,
        rule_version: 1,
        parents,
        parameters: vec![],
        frame: FrameId(1),
    }
}
fn cylinder_inputs(bottom: [f64; 3], top: [f64; 3], radius: f64) -> R<([f64; 3], [f64; 2])> {
    for a in bottom.into_iter().chain(top).chain([radius]) {
        b(a)?;
    }
    if radius <= 0. {
        return Err(no("positive-radius-required"));
    }
    if bottom[0] != top[0] || bottom[1] != top[1] {
        return Err(no("non-axial-cylinder"));
    }
    if bottom[2] == top[2] {
        return Err(no("zero-cylinder-height"));
    }
    Ok((
        [bottom[0], bottom[1], 0.],
        [bottom[2].min(top[2]), bottom[2].max(top[2])],
    ))
}
pub fn cylinder(key: BodyKey, bottom: [f64; 3], top: [f64; 3], radius: f64) -> R<Body> {
    let (center, levels) = cylinder_inputs(bottom, top, radius)?;
    let nodes = vec![
        input(bottom.into_iter().chain(top).chain([radius]).collect())?,
        node(Operation::Extrude {}, vec![NodeId(0)]),
    ];
    assemble(
        key.clone(),
        key.id,
        Affine::IDENTITY,
        center,
        radius,
        levels,
        None,
        nodes,
    )
}
/// Exact construction classifier. sqrt only proposes a candidate; zero of the
/// expansion residual is the proof. One-ulp gaps/contacts are never snapped.
fn band_height(c: [f64; 3], r: f64, bottom: [f64; 3], top: [f64; 3], bore: f64) -> R<f64> {
    let (axis, levels) = cylinder_inputs(bottom, top, bore)?;
    for a in c.into_iter().chain([r]) {
        b(a)?;
    }
    if r <= 0. || bore >= r {
        return Err(no("empty-or-degenerate-band"));
    }
    if axis[0] != c[0] || axis[1] != c[1] {
        return Err(no("non-coaxial-tool"));
    }
    if cmp_add(c[2], -r, levels[0])? < 0 || cmp_add(c[2], r, levels[1])? > 0 {
        return Err(no("tool-does-not-cover-sphere"));
    }
    let mut g = Guard::new();
    let square = ex::sum(
        &ex::product(r, r, &mut g),
        &ex::neg(&ex::product(bore, bore, &mut g)),
        &mut g,
    );
    let candidate = crate::rounding::round(&square)
        .map_err(|_| no("height-range"))?
        .sqrt();
    let residual = ex::sum(
        &square,
        &ex::neg(&ex::product(candidate, candidate, &mut g)),
        &mut g,
    );
    if !g.exact() {
        return Err(no("height-range"));
    }
    if ex::sign(&residual) != 0 {
        return Err(no("height-needs-algebraic-coordinate"));
    }
    if candidate <= 0. {
        return Err(no("empty-or-degenerate-band"));
    }
    Ok(candidate)
}
/// Re-express an already audited cylinder in the latitude owner's exact chart.
/// Keep the existing cylinder producer, Boolean and query owner unchanged.
pub(crate) fn from_cylinder(c: &crate::cylinder::Cylinder) -> R<Axial> {
    let body = cylinder(c.body.key.clone(), c.spec.bottom, c.spec.top, c.spec.radius)?;
    let axial = audit(&body.check().map_err(|_| no("cylinder-contract"))?)?;
    let body = axial.transform(c.frame.as_affine()?)?;
    audit(&body.check().map_err(|_| no("cylinder-contract"))?)
}
pub fn subtract(key: BodyKey, s: &Spherical, c: &Axial) -> R<Body> {
    if s.cut.is_some() || c.outer.is_some() {
        return Err(no("retrim-not-supported"));
    }
    if s.frame != c.frame {
        return Err(no("different-exact-frames"));
    }
    let p = &c.body.constructions[0].parameters;
    let bottom = [p[0].get(), p[1].get(), p[2].get()];
    let top = [p[3].get(), p[4].get(), p[5].get()];
    let h = band_height(s.center, s.radius, bottom, top, c.radius)?;
    let nodes = vec![
        input(s.center.into_iter().chain([s.radius]).collect())?,
        node(Operation::Sphere {}, vec![NodeId(0)]),
        c.body.constructions[0].clone(),
        node(Operation::Extrude {}, vec![NodeId(2)]),
        node(Operation::Boolean {}, vec![NodeId(1), NodeId(3)]),
    ];
    let Frame::Source { source } = s.body.frames[0] else {
        return Err(no("source-frame"));
    };
    assemble(
        key,
        source,
        s.frame,
        s.center,
        c.radius,
        [-h, h],
        Some(s.radius),
        nodes,
    )
}
fn assemble(
    key: BodyKey,
    source: [u32; 4],
    frame: Affine,
    center: [f64; 3],
    radius: f64,
    levels: [f64; 2],
    outer: Option<f64>,
    nodes: Vec<Construction>,
) -> R<Body> {
    let prov = Provenance::Construction {
        node: NodeId((nodes.len() - 1) as u32),
    };
    let surface = |geometry| Surface {
        frame: FrameId(1),
        provenance: prov.clone(),
        geometry,
    };
    let x = [1., 0., 0.];
    let z = [0., 0., 1.];
    let points = levels.map(|h| -> R<[f64; 3]> {
        Ok([
            exact_add(center[0], radius)?,
            center[1],
            exact_add(center[2], h)?,
        ])
    });
    let points = [points[0].clone()?, points[1].clone()?];
    let mut body = Body {
        key,
        frames: vec![Frame::Source { source }, frame_value(frame)?],
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
    body.surfaces.push(surface(SurfaceGeometry::Cylinder {
        origin: v(center)?,
        axis: v(z)?,
        x: v(x)?,
        radius: b(radius)?,
    }));
    if let Some(r) = outer {
        body.surfaces.push(surface(SurfaceGeometry::Sphere {
            origin: v(center)?,
            axis: v(z)?,
            x: v(x)?,
            radius: b(r)?,
        }));
    } else {
        for h in levels {
            body.surfaces.push(surface(SurfaceGeometry::Plane {
                origin: v([center[0], center[1], exact_add(center[2], h)?])?,
                normal: v(z)?,
                x: v(x)?,
            }));
        }
    }
    for i in 0..2 {
        body.vertices.push(Vertex {
            point: v(points[i])?,
            frame: FrameId(1),
            provenance: prov.clone(),
        });
        body.curves.push(Curve {
            frame: FrameId(1),
            provenance: prov.clone(),
            geometry: CurveGeometry::Circle {
                origin: v([center[0], center[1], points[i][2]])?,
                normal: v(z)?,
                x: v(x)?,
                radius: b(radius)?,
                arc: ArcKind::Full {},
            },
            domain: domain(),
            supports: vec![],
        });
        body.edges.push(Edge {
            curve: CurveId(i as u32),
            domain: domain(),
            vertices: vec![VertexId(i as u32); 2],
        });
        for j in 0..2 {
            let s = if j == 0 {
                0
            } else if outer.is_some() {
                1
            } else {
                i + 1
            };
            let k = body.pcurves.len();
            let geometry = if j == 0 {
                PcurveGeometry::Line {
                    a: uv([0., levels[i]])?,
                    b: uv([1., levels[i]])?,
                }
            } else if outer.is_some() {
                PcurveGeometry::SphereLatitude {
                    height: b(levels[i])?,
                }
            } else {
                PcurveGeometry::Circle {
                    origin: uv([0., 0.])?,
                    radius: b(radius)?,
                    clockwise: false,
                }
            };
            body.pcurves.push(Pcurve {
                curve: CurveId(i as u32),
                surface: SurfaceId(s as u32),
                domain: domain(),
                geometry,
            });
            body.curves[i].supports.push(Support {
                surface: SurfaceId(s as u32),
                pcurve: PcurveId(k as u32),
            });
            // Band: inner cylinder reversed, sphere outward. Cylinder: outward
            // side, bottom reversed, top outward. Every ring has two uses.
            let forward = if j == 0 {
                (i == 0) != outer.is_some()
            } else {
                (i != 0) != outer.is_some()
            };
            body.coedges.push(Coedge {
                edge: EdgeId(i as u32),
                forward,
                pcurve: PcurveId(k as u32),
            });
            body.loops.push(Loop {
                outer: i == 0 || (j == 1 && outer.is_none()),
                coedges: vec![CoedgeId(k as u32)],
            });
        }
    }
    body.faces.push(Face {
        surface: SurfaceId(0),
        forward: outer.is_none(),
        loops: vec![LoopId(0), LoopId(2)],
    });
    if outer.is_some() {
        body.faces.push(Face {
            surface: SurfaceId(1),
            forward: true,
            loops: vec![LoopId(1), LoopId(3)],
        });
    } else {
        for i in 0..2 {
            body.faces.push(Face {
                surface: SurfaceId(i + 1),
                forward: i == 1,
                loops: vec![LoopId(2 * i + 1)],
            });
        }
    }
    body.shells.push(Shell {
        faces: (0..body.faces.len()).map(|i| FaceId(i as u32)).collect(),
    });
    body.solids.push(Solid {
        shells: vec![ShellId(0)],
    });
    body.clone().check().map_err(|_| no("contract"))?;
    Ok(body)
}
/// Audit from the interpreter roots, checking identities and incidence. No
/// builder replay: carrier, chart, topology or provenance corruption is refused.
pub fn audit(checked: &CheckedBody) -> R<Axial> {
    let a = checked.body();
    let bad = || no("construction-body-mismatch");
    if a.frames.len() != 2
        || !matches!(a.frames[0], Frame::Source { .. })
        || !a.facts.is_empty()
        || !a.budgets.is_empty()
    {
        return Err(bad());
    }
    let Frame::Interpreter {
        parent: FrameId(0),
        origin,
        x,
        z,
    } = a.frames[1]
    else {
        return Err(bad());
    };
    let frame = Affine {
        origin: origin.map(Binary64::get),
        x: x.map(Binary64::get),
        z: z.map(Binary64::get),
    };
    frame_value(frame)?;
    let ns = &a.constructions;
    let input_params = |i: usize, n: usize| -> R<Vec<f64>> {
        let c = ns.get(i).ok_or_else(bad)?;
        if c.operation != (Operation::Interpreter {})
            || c.rule_version != 1
            || !c.parents.is_empty()
            || c.frame != FrameId(0)
            || c.parameters.len() != n
        {
            return Err(bad());
        }
        Ok(c.parameters.iter().map(|x| x.get()).collect())
    };
    let (center, radius, levels, outer) = if ns.len() == 2 {
        let p = input_params(0, 7)?;
        let (c, l) = cylinder_inputs([p[0], p[1], p[2]], [p[3], p[4], p[5]], p[6])?;
        if ns[1] != node(Operation::Extrude {}, vec![NodeId(0)]) {
            return Err(bad());
        }
        (c, p[6], l, None)
    } else if ns.len() == 5 {
        let s = input_params(0, 4)?;
        let p = input_params(2, 7)?;
        let c = [s[0], s[1], s[2]];
        if ns[1] != node(Operation::Sphere {}, vec![NodeId(0)])
            || ns[3] != node(Operation::Extrude {}, vec![NodeId(2)])
            || ns[4] != node(Operation::Boolean {}, vec![NodeId(1), NodeId(3)])
        {
            return Err(bad());
        }
        let h = band_height(c, s[3], [p[0], p[1], p[2]], [p[3], p[4], p[5]], p[6])?;
        (c, p[6], [-h, h], Some(s[3]))
    } else {
        return Err(bad());
    };
    let n = if outer.is_some() { 2 } else { 3 };
    if a.vertices.len() != 2
        || a.curves.len() != 2
        || a.edges.len() != 2
        || a.pcurves.len() != 4
        || a.coedges.len() != 4
        || a.loops.len() != 4
        || a.surfaces.len() != n
        || a.faces.len() != n
        || a.shells.len() != 1
        || a.solids
            != [Solid {
                shells: vec![ShellId(0)],
            }]
        || a.shells[0].faces != (0..n).map(|i| FaceId(i as u32)).collect::<Vec<_>>()
    {
        return Err(bad());
    }
    let prov = Provenance::Construction {
        node: NodeId((ns.len() - 1) as u32),
    };
    let z = [0., 0., 1.];
    let x = [1., 0., 0.];
    for (i, s) in a.surfaces.iter().enumerate() {
        if s.frame != FrameId(1) || s.provenance != prov {
            return Err(bad());
        }
        let good = match s.geometry {
            SurfaceGeometry::Cylinder {
                origin,
                axis,
                x: sx,
                radius: r,
            } if i == 0 => {
                origin.map(Binary64::get) == center
                    && axis.map(Binary64::get) == z
                    && sx.map(Binary64::get) == x
                    && r.get() == radius
            }
            SurfaceGeometry::Sphere {
                origin,
                axis,
                x: sx,
                radius: r,
            } if outer.is_some() && i == 1 => {
                origin.map(Binary64::get) == center
                    && axis.map(Binary64::get) == z
                    && sx.map(Binary64::get) == x
                    && Some(r.get()) == outer
            }
            SurfaceGeometry::Plane {
                origin,
                normal,
                x: sx,
            } if outer.is_none() && i > 0 => {
                origin[0].get() == center[0]
                    && origin[1].get() == center[1]
                    && cmp_add(center[2], levels[i - 1], origin[2].get())? == 0
                    && normal.map(Binary64::get) == z
                    && sx.map(Binary64::get) == x
            }
            _ => false,
        };
        if !good {
            return Err(bad());
        }
        let loops = if i == 0 {
            vec![LoopId(0), LoopId(2)]
        } else if outer.is_some() {
            vec![LoopId(1), LoopId(3)]
        } else {
            vec![LoopId((2 * i - 1) as u32)]
        };
        let forward = if i == 0 {
            outer.is_none()
        } else {
            outer.is_some() || i == 2
        };
        if a.faces[i]
            != (Face {
                surface: SurfaceId(i as u32),
                forward,
                loops,
            })
        {
            return Err(bad());
        }
    }
    for i in 0..2 {
        let q = &a.vertices[i];
        let c = &a.curves[i];
        if q.frame != FrameId(1)
            || q.provenance != prov
            || c.frame != FrameId(1)
            || c.provenance != prov
            || c.domain != domain()
        {
            return Err(bad());
        }
        for k in 0..3 {
            let d = if k == 0 {
                radius
            } else if k == 2 {
                levels[i]
            } else {
                0.
            };
            if cmp_add(center[k], d, q.point[k].get())? != 0 {
                return Err(bad());
            }
        }
        let CurveGeometry::Circle {
            origin,
            normal,
            x: cx,
            radius: r,
            arc: ArcKind::Full {},
        } = c.geometry
        else {
            return Err(bad());
        };
        if origin[0].get() != center[0]
            || origin[1].get() != center[1]
            || cmp_add(center[2], levels[i], origin[2].get())? != 0
            || normal.map(Binary64::get) != z
            || cx.map(Binary64::get) != x
            || r.get() != radius
            || c.supports.len() != 2
            || a.edges[i]
                != (Edge {
                    curve: CurveId(i as u32),
                    domain: domain(),
                    vertices: vec![VertexId(i as u32); 2],
                })
        {
            return Err(bad());
        }
        for j in 0..2 {
            let k = 2 * i + j;
            let s = if j == 0 {
                0
            } else if outer.is_some() {
                1
            } else {
                i + 1
            };
            let pc = &a.pcurves[k];
            if c.supports[j]
                != (Support {
                    surface: SurfaceId(s as u32),
                    pcurve: PcurveId(k as u32),
                })
                || pc.curve != CurveId(i as u32)
                || pc.surface != SurfaceId(s as u32)
                || pc.domain != domain()
            {
                return Err(bad());
            }
            let good = match pc.geometry {
                PcurveGeometry::Line { a, b } if j == 0 => {
                    a.map(Binary64::get) == [0., levels[i]]
                        && b.map(Binary64::get) == [1., levels[i]]
                }
                PcurveGeometry::SphereLatitude { height } if j == 1 && outer.is_some() => {
                    height.get() == levels[i]
                }
                PcurveGeometry::Circle {
                    origin,
                    radius: r,
                    clockwise,
                } if j == 1 && outer.is_none() => {
                    origin.map(Binary64::get) == [0., 0.] && r.get() == radius && !clockwise
                }
                _ => false,
            };
            if !good {
                return Err(bad());
            }
            let forward = if j == 0 {
                (i == 0) != outer.is_some()
            } else {
                (i != 0) != outer.is_some()
            };
            if a.coedges[k]
                != (Coedge {
                    edge: EdgeId(i as u32),
                    forward,
                    pcurve: PcurveId(k as u32),
                })
                || a.loops[k]
                    != (Loop {
                        outer: i == 0 || (j == 1 && outer.is_none()),
                        coedges: vec![CoedgeId(k as u32)],
                    })
            {
                return Err(bad());
            }
        }
    }
    Ok(Axial {
        body: a.clone(),
        frame,
        center,
        radius,
        levels,
        outer,
    })
}
