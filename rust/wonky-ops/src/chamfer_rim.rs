//! Equal-offset cuts of circular cylinder rims. The result uses the reusable
//! axial-band carrier (circles, cylinders and rational-slope cones), not a
//! rounded angle or a mesh. Both end rims and every coordinate axis work.
use crate::{
    affine::Affine,
    cylinder::{self, Cylinder},
    placement::Placement,
    polyhedron::Refused,
    source_frame::SourceMetric,
};
use num_rational::BigRational as Q;
use num_traits::ToPrimitive;
use wonky_contract::*;
pub(crate) type R<T> = std::result::Result<T, Refused>;
pub(crate) fn no(s: &str) -> Refused {
    Refused(format!("chamfer/rim-{s}"))
}
pub(crate) fn q(x: f64) -> Q {
    Q::from_float(x).unwrap()
}
pub(crate) fn exact(v: Q) -> R<f64> {
    let f = v
        .to_f64()
        .filter(|x| x.is_finite())
        .ok_or_else(|| no("coordinate-range"))?;
    if q(f) != v {
        return Err(no("offset-not-representable"));
    }
    Ok(f)
}
pub(crate) fn b(x: f64) -> R<Binary64> {
    Binary64::new(x).map_err(|_| no("numeric-range"))
}
pub(crate) fn v(p: [f64; 3]) -> R<Vector3> {
    Ok([b(p[0])?, b(p[1])?, b(p[2])?])
}
/// Cross-sectional rings, increasing along the source cylinder axis.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Ring {
    pub z: f64,
    pub r: f64,
}
#[derive(Clone, Debug)]
pub struct Conical {
    pub body: Body,
    pub frame: Placement,
    pub(crate) source: cylinder::Spec,
    pub(crate) rings: Vec<Ring>,
}
fn rings(spec: cylinder::Spec, ends: [bool; 2], w: f64) -> R<Vec<Ring>> {
    if !w.is_finite() || w <= 0. {
        return Err(no("width"));
    }
    let k = spec.axis()?;
    if w >= spec.radius {
        return Err(no("cap-consumed"));
    }
    let cuts = (ends[0] as u32 + ends[1] as u32) as f64;
    if q(w) * q(cuts) >= q(spec.top[k]) - q(spec.bottom[k]) {
        return Err(no("bands-meet-or-height-consumed"));
    }
    let r = exact(q(spec.radius) - q(w))?;
    let mut out = vec![Ring {
        z: spec.bottom[k],
        r: if ends[0] { r } else { spec.radius },
    }];
    if ends[0] {
        out.push(Ring {
            z: exact(q(spec.bottom[k]) + q(w))?,
            r: spec.radius,
        });
    }
    if ends[1] {
        out.push(Ring {
            z: exact(q(spec.top[k]) - q(w))?,
            r: spec.radius,
        });
    }
    out.push(Ring {
        z: spec.top[k],
        r: if ends[1] { r } else { spec.radius },
    });
    Ok(out)
}
pub fn equal_offsets(c: &Cylinder, edges: &[usize], width: f64) -> R<Body> {
    SourceMetric::new(&c.frame)?;
    if c.body.frames.len() != 3 {
        return Err(no("pattern-frame-unsupported"));
    }
    if edges.is_empty() || edges.iter().any(|&i| i > 1) {
        return Err(no("circular-edges-required"));
    }
    let ends = [edges.contains(&0), edges.contains(&1)];
    let rings = rings(c.spec, ends, width)?;
    let mut source = c.body.clone();
    let parent = source.constructions.len() - 1;
    source.constructions.push(Construction {
        operation: Operation::Intersection {},
        rule_version: 3,
        parents: vec![NodeId(parent as u32)],
        parameters: vec![
            b(width)?,
            b(ends[0] as u8 as f64)?,
            b(ends[1] as u8 as f64)?,
        ],
        frame: FrameId(1),
    });
    let body = crate::conical_brep::construct(source, c.spec, &rings)?;
    body.clone()
        .check()
        .map_err(|e| no(&format!("contract: {e:?}")))?;
    Ok(body)
}
pub(crate) fn candidate(body: &Body) -> bool {
    body.surfaces
        .iter()
        .any(|s| matches!(s.geometry, SurfaceGeometry::ConeSlope { .. }))
        || body
            .constructions
            .last()
            .is_some_and(|n| n.operation == Operation::Intersection {} && n.rule_version == 3)
}
pub fn audit(checked: &CheckedBody) -> R<Conical> {
    let body = checked.body();
    let n = body
        .constructions
        .last()
        .ok_or_else(|| no("construction"))?;
    let root = body.constructions.len() - 1;
    if root == 0
        || n.operation != (Operation::Intersection {})
        || n.rule_version != 3
        || n.frame != FrameId(1)
        || n.parents != [NodeId(root as u32 - 1)]
        || n.parameters.len() != 3
    {
        return Err(no("construction"));
    }
    let p = n.parameters.iter().map(|x| x.get()).collect::<Vec<_>>();
    if p[1..].iter().any(|&x| x != 0. && x != 1.) || p[1] + p[2] == 0. {
        return Err(no("selection"));
    }
    let [Frame::Source { .. }, Frame::Interpreter { origin, x, z, .. }, Frame::Rigid { .. }] =
        body.frames.as_slice()
    else {
        return Err(no("frame-shape"));
    };
    let frame = Affine {
        origin: origin.map(|v| v.get()),
        x: x.map(|v| v.get()),
        z: z.map(|v| v.get()),
    };
    let nodes = body.constructions[..root].to_vec();
    let spec = cylinder::replay(&nodes, root - 1, &mut 1024)?;
    let source = cylinder::assemble(body.key.clone(), spec, frame, nodes)?;
    let c = cylinder::audit(&source.check().map_err(|_| no("source-contract"))?)?;
    let edges = (0..2).filter(|&i| p[i + 1] == 1.).collect::<Vec<_>>();
    let expected = equal_offsets(&c, &edges, p[0])?;
    if *body != expected {
        return Err(no("construction-carrier-mismatch"));
    }
    // Independently read the geometric section from the actual circular edges.
    // Native integrals do not replay an operation receipt as their geometry.
    let k = spec.axis()?;
    let mut section = vec![];
    for curve in &body.curves {
        if let CurveGeometry::Circle { origin, radius, .. } = curve.geometry {
            section.push(Ring {
                z: origin[k].get(),
                r: radius.get(),
            });
        }
    }
    if section.len() < 3 || section.windows(2).any(|w| w[0].z >= w[1].z) {
        return Err(no("ring-order"));
    }
    for (i, pair) in section.windows(2).enumerate() {
        match body.surfaces[i + 2].geometry {
            SurfaceGeometry::Cylinder { radius, .. }
                if pair[0].r == pair[1].r && radius.get() == pair[0].r => {}
            SurfaceGeometry::ConeSlope { slope, .. }
                if (q(pair[1].r) - q(pair[0].r)).abs()
                    == q(slope.get()) * (q(pair[1].z) - q(pair[0].z)) => {}
            _ => return Err(no("generator-incidence")),
        }
    }
    SourceMetric::new(&c.frame)?;
    Ok(Conical {
        body: body.clone(),
        frame: c.frame,
        source: spec,
        rings: section,
    })
}
use num_traits::Signed;
impl Conical {
    pub(crate) fn center(&self, z: f64) -> [f64; 3] {
        let mut p = self.source.bottom;
        p[self.source.axis().unwrap()] = z;
        p
    }
    pub fn transform(&self, frame: Affine) -> R<Body> {
        if self.frame != Affine::IDENTITY {
            return Err(no("composed-placement"));
        }
        let mut body = self.body.clone();
        body.frames[1] = Frame::Interpreter {
            parent: FrameId(0),
            origin: v(frame.origin)?,
            x: v(frame.x)?,
            z: v(frame.z)?,
        };
        Ok(audit(&body.check().map_err(|_| no("transform-contract"))?)?.body)
    }
}
