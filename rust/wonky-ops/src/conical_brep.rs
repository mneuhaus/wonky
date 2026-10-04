//! Sewn solid of revolution from positive-radius, ordered axial rings.
//! ConeSlope uses axial v (not slant length) and angular u in turns. A
//! translated seam chart keeps center+radius exact without rounding a vertex.
use crate::{
    chamfer_rim::{b, exact, no, q, v, Ring, R},
    cylinder::Spec,
};
use wonky_contract::*;
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
fn line(a: [f64; 2], c: [f64; 2]) -> R<PcurveGeometry> {
    Ok(PcurveGeometry::Line {
        a: [b(a[0])?, b(a[1])?],
        b: [b(c[0])?, b(c[1])?],
    })
}
pub(crate) fn construct(mut body: Body, spec: Spec, rings: &[Ring]) -> R<Body> {
    let k = spec.axis()?;
    let radial = (k + 1) % 3;
    let (z, x, _) = spec.axes()?;
    let n = rings.len();
    let prov = Provenance::Construction {
        node: NodeId(body.constructions.len() as u32 - 1),
    };
    body.vertices.clear();
    body.curves.clear();
    body.edges.clear();
    body.surfaces.clear();
    body.pcurves.clear();
    body.coedges.clear();
    body.loops.clear();
    body.faces.clear();
    body.shells.clear();
    body.solids.clear();
    let center = |h| {
        let mut p = spec.bottom;
        p[k] = h;
        p
    };
    for (i, ring) in rings.iter().enumerate() {
        let mut seam = [0.; 3];
        seam[k] = ring.z;
        seam[radial] = ring.r;
        body.vertices.push(Vertex {
            point: v(seam)?,
            frame: FrameId(2),
            provenance: Provenance::None {},
        });
        body.curves.push(Curve {
            frame: FrameId(1),
            provenance: prov.clone(),
            geometry: CurveGeometry::Circle {
                origin: v(center(ring.z))?,
                normal: v(z)?,
                x: v(x)?,
                radius: b(ring.r)?,
                arc: ArcKind::Full {},
            },
            domain: dom(),
            supports: vec![],
        });
        body.edges.push(Edge {
            curve: CurveId(i as u32),
            domain: dom(),
            vertices: vec![VertexId(i as u32); 2],
        });
    }
    for i in 0..n - 1 {
        let eid = body.curves.len() as u32;
        body.curves.push(Curve {
            frame: FrameId(2),
            provenance: Provenance::None {},
            geometry: CurveGeometry::Line {
                a: body.vertices[i].point,
                b: body.vertices[i + 1].point,
            },
            domain: dom(),
            supports: vec![],
        });
        body.edges.push(Edge {
            curve: CurveId(eid),
            domain: dom(),
            vertices: vec![VertexId(i as u32), VertexId(i as u32 + 1)],
        });
    }
    for (i, normal) in [(0, z.map(|c| -c)), (n - 1, z)] {
        body.surfaces.push(Surface {
            frame: FrameId(1),
            provenance: prov.clone(),
            geometry: SurfaceGeometry::Plane {
                origin: v(center(rings[i].z))?,
                normal: v(normal)?,
                x: v(x)?,
            },
        });
    }
    for pair in rings.windows(2) {
        let geometry = if pair[0].r == pair[1].r {
            SurfaceGeometry::Cylinder {
                origin: v(center(0.))?,
                axis: v(z)?,
                x: v(x)?,
                radius: b(pair[0].r)?,
            }
        } else {
            let lower = if pair[0].r < pair[1].r { 0 } else { 1 };
            let axis = if lower == 0 { z } else { z.map(|c| -c) };
            let slope = exact((q(pair[1].r) - q(pair[0].r)).abs() / (q(pair[1].z) - q(pair[0].z)))?;
            SurfaceGeometry::ConeSlope {
                origin: v(center(pair[lower].z))?,
                axis: v(axis)?,
                x: v(x)?,
                radius: b(pair[lower].r)?,
                slope: b(slope)?,
            }
        };
        body.surfaces.push(Surface {
            frame: FrameId(1),
            provenance: prov.clone(),
            geometry,
        });
    }
    let mut face = |sid: usize, uses: Vec<(usize, bool, PcurveGeometry)>| -> R<()> {
        let mut coedges = vec![];
        for (e, forward, geometry) in uses {
            let pc = PcurveId(body.pcurves.len() as u32);
            body.pcurves.push(Pcurve {
                curve: CurveId(e as u32),
                surface: SurfaceId(sid as u32),
                domain: dom(),
                geometry,
            });
            body.curves[e].supports.push(Support {
                surface: SurfaceId(sid as u32),
                pcurve: pc,
            });
            coedges.push(CoedgeId(body.coedges.len() as u32));
            body.coedges.push(Coedge {
                edge: EdgeId(e as u32),
                forward,
                pcurve: pc,
            });
        }
        let lid = LoopId(body.loops.len() as u32);
        body.loops.push(Loop {
            outer: true,
            coedges,
        });
        body.faces.push(Face {
            surface: SurfaceId(sid as u32),
            forward: true,
            loops: vec![lid],
        });
        Ok(())
    };
    face(
        0,
        vec![(
            0,
            false,
            PcurveGeometry::Circle {
                origin: [b(0.)?; 2],
                radius: b(rings[0].r)?,
                clockwise: true,
            },
        )],
    )?;
    face(
        1,
        vec![(
            n - 1,
            true,
            PcurveGeometry::Circle {
                origin: [b(0.)?; 2],
                radius: b(rings[n - 1].r)?,
                clockwise: false,
            },
        )],
    )?;
    for i in 0..n - 1 {
        let (sign, base) = if rings[i].r == rings[i + 1].r {
            (1., 0.)
        } else if rings[i].r < rings[i + 1].r {
            (1., rings[i].z)
        } else {
            (-1., rings[i + 1].z)
        };
        let a = exact(q(sign) * (q(rings[i].z) - q(base)))?;
        let c = exact(q(sign) * (q(rings[i + 1].z) - q(base)))?;
        face(
            i + 2,
            vec![
                (i, true, line([0., a], [sign, a])?),
                (n + i, true, line([sign, a], [sign, c])?),
                (i + 1, false, line([0., c], [sign, c])?),
                (n + i, false, line([0., a], [0., c])?),
            ],
        )?;
    }
    body.shells.push(Shell {
        faces: (0..n + 1).map(|i| FaceId(i as u32)).collect(),
    });
    body.solids.push(Solid {
        shells: vec![ShellId(0)],
    });
    if body.faces.len() != n + 1 {
        return Err(no("band-count"));
    }
    Ok(body)
}
use num_traits::Signed;
