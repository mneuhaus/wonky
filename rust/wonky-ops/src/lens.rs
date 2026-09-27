//! Two transverse equal spheres in a shared exact affine frame.
//! The intersection circle retains R and H, so its radius sqrt(R²-H²) is
//! never rounded back into geometry. A full ring has no canonical endpoints.
use crate::{affine::Affine, axial::exact_add, polyhedron::Refused, sphere::Spherical};
use wonky_contract::*;
type R<T> = std::result::Result<T, Refused>;
pub(crate) fn no(s: &str) -> Refused {
    Refused(format!("lens/{s}"))
}
fn b(x: f64) -> R<Binary64> {
    Binary64::new(x).map_err(|_| no("numeric-range"))
}
fn v(p: [f64; 3]) -> R<Vector3> {
    Ok([b(p[0])?, b(p[1])?, b(p[2])?])
}
pub(crate) fn axis(k: usize) -> [f64; 3] {
    let mut p = [0.; 3];
    p[k] = 1.;
    p
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
#[derive(Clone, Debug)]
pub struct Lens {
    pub(crate) body: Body,
    pub(crate) frame: Affine,
    pub(crate) center: [f64; 3],
    pub(crate) radius: f64,
    pub(crate) half: f64,
    pub(crate) axis: usize,
    pub(crate) centers: [[f64; 3]; 2],
}
impl Lens {
    pub fn body(&self) -> &Body {
        &self.body
    }
    pub(crate) fn metric(&self) -> Spherical {
        Spherical {
            body: self.body.clone(),
            frame: self.frame,
            center: self.center,
            radius: self.radius,
            cut: None,
        }
    }
    pub fn transform(&self, frame: Affine) -> R<Body> {
        if self.frame != Affine::IDENTITY {
            return Err(no("placement-already-applied"));
        }
        let mut out = self.body.clone();
        out.frames[1] = frame_value(frame)?;
        out.key.revision = out
            .key
            .revision
            .checked_add(1)
            .ok_or_else(|| no("revision-range"))?;
        Ok(out)
    }
}
fn frame_value(f: Affine) -> R<Frame> {
    if wonky_num::expansion::sign(&f.det_exact().map_err(|_| no("frame-range"))?) <= 0 {
        return Err(no("singular-frame"));
    }
    Ok(Frame::Interpreter {
        parent: FrameId(0),
        origin: v(f.origin)?,
        x: v(f.x)?,
        z: v(f.z)?,
    })
}
fn geometry(mut centers: [[f64; 3]; 2], radius: f64) -> R<([[f64; 3]; 2], [f64; 3], f64, usize)> {
    for x in centers.into_iter().flatten().chain([radius]) {
        b(x)?;
    }
    if radius <= 0. {
        return Err(no("positive-radius-required"));
    }
    let axes = (0..3)
        .filter(|&k| centers[0][k] != centers[1][k])
        .collect::<Vec<_>>();
    if axes.len() != 1 {
        return Err(no("centers-need-one-source-axis"));
    }
    let k = axes[0];
    if centers[0][k] > centers[1][k] {
        centers.swap(0, 1);
    }
    let distance = exact_add(centers[1][k], -centers[0][k])?;
    let half = distance * 0.5;
    // Multiplication is only a proposal; exact recomposition proves the value.
    if half <= 0. || exact_add(half, half)? != distance {
        return Err(no("height-range"));
    }
    if half >= radius {
        return Err(no("non-transverse-spheres"));
    }
    let mut center = centers[0];
    center[k] = exact_add(center[k], half)?;
    Ok((centers, center, half, k))
}
pub fn intersect(key: BodyKey, a: &Spherical, b: &Spherical) -> R<Body> {
    if a.cut.is_some() || b.cut.is_some() {
        return Err(no("retrim-not-supported"));
    }
    if a.frame != b.frame {
        return Err(no("different-exact-frames"));
    }
    if a.radius != b.radius {
        return Err(no("unequal-radii"));
    }
    let Frame::Source { source } = a.body.frames[0] else {
        return Err(no("source-frame"));
    };
    assemble(key, source, a.frame, [a.center, b.center], a.radius)
}
fn assemble(
    key: BodyKey,
    source: [u32; 4],
    frame: Affine,
    centers: [[f64; 3]; 2],
    radius: f64,
) -> R<Body> {
    let (centers, center, half, k) = geometry(centers, radius)?;
    let mut nodes = Vec::new();
    for c in centers {
        let input = nodes.len() as u32;
        nodes.push(Construction {
            operation: Operation::Interpreter {},
            rule_version: 1,
            parents: vec![],
            parameters: c.into_iter().chain([radius]).map(b).collect::<R<_>>()?,
            frame: FrameId(0),
        });
        nodes.push(Construction {
            operation: Operation::Sphere {},
            rule_version: 1,
            parents: vec![NodeId(input)],
            parameters: vec![],
            frame: FrameId(1),
        });
    }
    nodes.push(Construction {
        operation: Operation::Boolean {},
        rule_version: 1,
        parents: vec![NodeId(1), NodeId(3)],
        parameters: vec![b(2.)?],
        frame: FrameId(1),
    });
    let prov = Provenance::Construction { node: NodeId(4) };
    let z = v(axis(k))?;
    let x = v(axis((k + 1) % 3))?;
    Ok(Body {
        key,
        frames: vec![Frame::Source { source }, frame_value(frame)?],
        constructions: nodes,
        vertices: vec![],
        curves: vec![Curve {
            frame: FrameId(1),
            provenance: prov.clone(),
            geometry: CurveGeometry::SphereCircle {
                origin: v(center)?,
                normal: z,
                x,
                sphere_radius: b(radius)?,
                height: b(half)?,
            },
            domain: domain(),
            supports: (0..2)
                .map(|i| Support {
                    surface: SurfaceId(i),
                    pcurve: PcurveId(i),
                })
                .collect(),
        }],
        surfaces: centers
            .into_iter()
            .map(|c| {
                Ok(Surface {
                    frame: FrameId(1),
                    provenance: prov.clone(),
                    geometry: SurfaceGeometry::Sphere {
                        origin: v(c)?,
                        axis: z,
                        x,
                        radius: b(radius)?,
                    },
                })
            })
            .collect::<R<_>>()?,
        pcurves: (0..2)
            .map(|i| {
                Ok(Pcurve {
                    curve: CurveId(0),
                    surface: SurfaceId(i),
                    domain: domain(),
                    geometry: PcurveGeometry::SphereLatitude {
                        height: b(if i == 0 { half } else { -half })?,
                    },
                })
            })
            .collect::<R<_>>()?,
        edges: vec![Edge {
            curve: CurveId(0),
            domain: domain(),
            vertices: vec![],
        }],
        coedges: (0..2)
            .map(|i| Coedge {
                edge: EdgeId(0),
                forward: i == 0,
                pcurve: PcurveId(i),
            })
            .collect(),
        loops: (0..2)
            .map(|i| Loop {
                outer: true,
                coedges: vec![CoedgeId(i)],
            })
            .collect(),
        faces: (0..2)
            .map(|i| Face {
                surface: SurfaceId(i),
                forward: true,
                loops: vec![LoopId(i)],
            })
            .collect(),
        shells: vec![Shell {
            faces: vec![FaceId(0), FaceId(1)],
        }],
        solids: vec![Solid {
            shells: vec![ShellId(0)],
        }],
        facts: vec![],
        budgets: vec![],
    })
}
pub fn audit(checked: &CheckedBody) -> R<Lens> {
    let body = checked.body();
    let bad = || no("construction-binding");
    if body.frames.len() != 2 || body.constructions.len() != 5 {
        return Err(bad());
    }
    let Frame::Source { source } = body.frames[0] else {
        return Err(bad());
    };
    let Frame::Interpreter {
        parent: FrameId(0),
        origin,
        x,
        z,
    } = body.frames[1]
    else {
        return Err(bad());
    };
    let frame = Affine {
        origin: origin.map(Binary64::get),
        x: x.map(Binary64::get),
        z: z.map(Binary64::get),
    };
    let a = &body.constructions[0].parameters;
    let b = &body.constructions[2].parameters;
    if a.len() != 4 || b.len() != 4 || a[3] != b[3] {
        return Err(bad());
    }
    let centers = [
        [a[0].get(), a[1].get(), a[2].get()],
        [b[0].get(), b[1].get(), b[2].get()],
    ];
    let radius = a[3].get();
    let (centers, center, half, axis) = geometry(centers, radius)?;
    // Reconstruct the canonical encoding only from the two source inputs. No
    // output circle, surface, pcurve, winding or advertised measure is trusted.
    let expected = assemble(body.key.clone(), source, frame, centers, radius)?;
    if *body != expected {
        return Err(bad());
    }
    Ok(Lens {
        body: body.clone(),
        frame,
        center,
        radius,
        half,
        axis,
        centers,
    })
}
