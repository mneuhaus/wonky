//! Exact axial cylinders and the decidable parallel-cylinder Boolean subfamily.
//! Geometry uses WC0's shared Cylinder/Circle carriers (not a mesh). All input
//! lengths are interpreter binary64 metres. Periodic parameters are turns.
//! An affine placement stays symbolic; topology is decided in the common
//! source frame. Nonparallel SSI and cut circles are explicitly unsupported.
use crate::{affine::Affine, placement::{Placement, Post}, polyhedron::Refused};
use std::result::Result;
use wonky_contract::*;
use wonky_num::{
    expansion::{self as ex, Exp, Guard},
    Iv, Scalar,
};

type R<T> = Result<T, Refused>;
pub(crate) fn no(s: &str) -> Refused {
    Refused(format!("cylinder/{s}"))
}
fn b(x: f64) -> R<Binary64> {
    Binary64::new(x).map_err(|_| no("numeric-range"))
}
fn v(p: [f64; 3]) -> R<Vector3> {
    Ok([b(p[0])?, b(p[1])?, b(p[2])?])
}
fn get(p: &Vector3) -> [f64; 3] {
    p.each_ref().map(|x| x.get())
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
pub(crate) fn finite(x: Iv) -> R<Iv> {
    if x.is_nan() || !x.lo().is_finite() || !x.hi().is_finite() {
        Err(no("observation-range"))
    } else {
        Ok(x)
    }
}
pub(crate) fn enclosed(e: &[f64]) -> Iv {
    e.iter().fold(Iv::point(0.), |a, &x| a + Iv::point(x))
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Spec {
    pub bottom: [f64; 3],
    pub top: [f64; 3],
    pub radius: f64,
}
impl Spec {
    pub fn axis(self) -> R<usize> {
        if !self
            .bottom
            .iter()
            .chain(self.top.iter())
            .chain([self.radius].iter())
            .all(|x| x.is_finite())
            || self.radius <= 0.
        {
            return Err(no("invalid-input"));
        }
        let axes: Vec<_> = (0..3).filter(|&i| self.bottom[i] != self.top[i]).collect();
        if axes.len() != 1 {
            return Err(no("non-coordinate-axis"));
        }
        Ok(axes[0])
    }
    fn canonical(mut self) -> R<Self> {
        let k = self.axis()?;
        if self.bottom[k] > self.top[k] {
            std::mem::swap(&mut self.bottom, &mut self.top);
        }
        Ok(self)
    }
    pub fn axes(self) -> R<([f64; 3], [f64; 3], [f64; 3])> {
        let k = self.axis()?;
        let mut z = [0.; 3];
        z[k] = 1.;
        // The seam is stored in an exact translated chart, so center + radius
        // need not be representable as one binary64 coordinate.
        let mut x = [0.; 3];
        x[(k + 1) % 3] = 1.;
        let mut seam = [0.; 3];
        seam[(k + 1) % 3] = self.radius;
        seam[k] = self.bottom[k];
        Ok((z, x, seam))
    }

    fn params(self) -> Vec<f64> {
        self.bottom
            .into_iter()
            .chain(self.top)
            .chain([self.radius])
            .collect()
    }
}

pub fn create(key: BodyKey, input: Spec) -> R<Body> {
    let spec = input.canonical()?;
    let nodes = vec![
        Construction {
            operation: Operation::Interpreter {},
            rule_version: 1,
            parents: vec![],
            parameters: input.params().into_iter().map(b).collect::<R<_>>()?,
            frame: FrameId(0),
        },
        Construction {
            operation: Operation::Extrude {},
            rule_version: 1,
            parents: vec![NodeId(0)],
            parameters: vec![],
            frame: FrameId(1),
        },
    ];
    assemble(key, spec, Affine::IDENTITY, nodes)
}

pub(crate) fn assemble(
    key: BodyKey,
    spec: Spec,
    frame: Affine,
    nodes: Vec<Construction>,
) -> R<Body> {
    let body = carrier(key, spec, frame, nodes)?;
    body.clone()
        .check()
        .map_err(|e| no(&format!("contract: {e:?}")))?;
    Ok(body)
}

// A pattern's final frame chain is attached before contract validation.
fn carrier(key: BodyKey, spec: Spec, frame: Affine, nodes: Vec<Construction>) -> R<Body> {
    let (z, x, bottom_seam) = spec.axes()?;
    let k = spec.axis()?;
    let mut top_seam = bottom_seam;
    top_seam[k] = spec.top[k];
    let mut translation = spec.bottom;
    translation[k] = 0.;
    let mut body = Body {
        key,
        frames: vec![
            Frame::Source { source: [0; 4] },
            Frame::Interpreter {
                parent: FrameId(0),
                origin: v(frame.origin)?,
                x: v(frame.x)?,
                z: v(frame.z)?,
            },
            Frame::Rigid {
                parent: FrameId(1),
                translation: v(translation)?,
                axis: v(z)?,
                angle: b(0.)?,
            },
        ],
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
    let provenance = Provenance::Construction {
        node: NodeId((body.constructions.len() - 1) as u32),
    };
    let fr = FrameId(1);
    for p in [bottom_seam, top_seam] {
        body.vertices.push(Vertex {
            point: v(p)?,
            frame: FrameId(2),
            provenance: Provenance::None {},
        });
    }
    for (i, p) in [spec.bottom, spec.top].into_iter().enumerate() {
        body.curves.push(Curve {
            frame: fr,
            provenance: provenance.clone(),
            geometry: CurveGeometry::Circle {
                origin: v(p)?,
                normal: v(z)?,
                x: v(x)?,
                radius: b(spec.radius)?,
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
    body.curves.push(Curve {
        frame: FrameId(2),
        provenance: Provenance::None {},
        geometry: CurveGeometry::Line {
            a: v(bottom_seam)?,
            b: v(top_seam)?,
        },
        domain: dom(),
        supports: vec![],
    });
    body.edges.push(Edge {
        curve: CurveId(2),
        domain: dom(),
        vertices: vec![VertexId(0), VertexId(1)],
    });
    for (p, n) in [(spec.bottom, z.map(|c| -c)), (spec.top, z)] {
        body.surfaces.push(Surface {
            frame: fr,
            provenance: provenance.clone(),
            geometry: SurfaceGeometry::Plane {
                origin: v(p)?,
                normal: v(n)?,
                x: v(x)?,
            },
        });
    }
    #[cfg(feature = "plant_cylinder_radius")]
    let side_radius = spec.radius * 2.;
    #[cfg(not(feature = "plant_cylinder_radius"))]
    let side_radius = spec.radius;
    let mut axis_origin = spec.bottom;
    axis_origin[k] = 0.;
    body.surfaces.push(Surface {
        frame: fr,
        provenance,
        geometry: SurfaceGeometry::Cylinder {
            origin: v(axis_origin)?,
            axis: v(z)?,
            x: v(x)?,
            radius: b(side_radius)?,
        },
    });
    let line = |a: [f64; 2], c: [f64; 2]| -> R<PcurveGeometry> {
        Ok(PcurveGeometry::Line {
            a: [b(a[0])?, b(a[1])?],
            b: [b(c[0])?, b(c[1])?],
        })
    };
    // Cylinder v is the absolute source axial coordinate. This avoids inventing
    // a rounded height parameter when top-bottom is not representable.
    let pcs = [
        (
            0,
            0,
            false,
            PcurveGeometry::Circle {
                origin: [b(0.)?; 2],
                radius: b(spec.radius)?,
                clockwise: true,
            },
        ),
        (
            1,
            1,
            true,
            PcurveGeometry::Circle {
                origin: [b(0.)?; 2],
                radius: b(spec.radius)?,
                clockwise: false,
            },
        ),
        (
            0,
            2,
            true,
            line([0., spec.bottom[k]], [1., spec.bottom[k]])?,
        ),
        (2, 2, true, line([1., spec.bottom[k]], [1., spec.top[k]])?),
        (1, 2, false, line([0., spec.top[k]], [1., spec.top[k]])?),
        (2, 2, false, line([0., spec.bottom[k]], [0., spec.top[k]])?),
    ];
    for (i, (edge, surface, forward, geometry)) in pcs.into_iter().enumerate() {
        body.pcurves.push(Pcurve {
            curve: CurveId(edge),
            surface: SurfaceId(surface),
            domain: dom(),
            geometry,
        });
        body.curves[edge as usize].supports.push(Support {
            surface: SurfaceId(surface),
            pcurve: PcurveId(i as u32),
        });
        body.coedges.push(Coedge {
            edge: EdgeId(edge),
            forward,
            pcurve: PcurveId(i as u32),
        });
    }
    for ids in [vec![0], vec![1], vec![2, 3, 4, 5]] {
        body.loops.push(Loop {
            outer: true,
            coedges: ids.into_iter().map(CoedgeId).collect(),
        });
    }
    for i in 0..3 {
        body.faces.push(Face {
            surface: SurfaceId(i),
            forward: true,
            loops: vec![LoopId(i)],
        });
    }
    body.shells.push(Shell {
        faces: (0..3).map(FaceId).collect(),
    });
    body.solids.push(Solid {
        shells: vec![ShellId(0)],
    });
    Ok(body)
}

// Construction replay: merged endpoints remain tied to the original inputs,
// never reintroduced as fresh interpreter coordinates.
pub(crate) fn replay(nodes: &[Construction], root: usize, fuel: &mut usize) -> R<Spec> {
    if *fuel == 0 {
        return Err(no("construction-budget"));
    }
    *fuel -= 1;
    let n = nodes
        .get(root)
        .ok_or_else(|| no("construction-reference"))?;
    if n.operation == (Operation::AffineTransform {})
        && n.rule_version == 1
        && n.parameters.is_empty()
        && n.parents.len() == 1
        && n.parents[0].0 < root as u32
    {
        return replay(nodes, n.parents[0].0 as usize, fuel);
    }
    if n.frame != FrameId(1) || n.rule_version != 1 {
        return Err(no("construction-frame"));
    }
    if n.operation == (Operation::Extrude {}) && n.parents.len() == 1 && n.parameters.is_empty() {
        let p = &nodes[n.parents[0].0 as usize];
        if p.operation != (Operation::Interpreter {})
            || p.parameters.len() != 7
            || !p.parents.is_empty()
            || p.frame != FrameId(0)
        {
            return Err(no("construction-input"));
        }
        let p: Vec<_> = p.parameters.iter().map(|x| x.get()).collect();
        return Spec {
            bottom: [p[0], p[1], p[2]],
            top: [p[3], p[4], p[5]],
            radius: p[6],
        }
        .canonical();
    }
    if n.operation == (Operation::Boolean {})
        && n.parents.len() == 2
        && n.parameters.len() == 1
        && n.parameters[0].get() == 0.
    {
        let a = replay(nodes, n.parents[0].0 as usize, fuel)?;
        let b = replay(nodes, n.parents[1].0 as usize, fuel)?;
        return merge(a, b)?.ok_or_else(|| no("construction-union"));
    }
    Err(no("unsupported-construction"))
}

#[derive(Clone, Debug)]
pub struct Cylinder {
    pub body: Body,
    pub spec: Spec,
    pub frame: Placement,
}
pub fn has_cylinder(body: &Body) -> bool {
    body.surfaces
        .iter()
        .any(|s| matches!(s.geometry, SurfaceGeometry::Cylinder { .. }))
}
pub fn audit(checked: &CheckedBody) -> R<Cylinder> {
    let body = checked.body();
    if body.constructions.is_empty() {
        return Err(no("missing-construction"));
    }
    let spec = replay(&body.constructions, body.constructions.len() - 1, &mut 1024)?;
    let [Frame::Source { source }, Frame::Interpreter { parent, .. }, ..] = body.frames.as_slice() else {
        return Err(no("frame-shape"));
    };
    if *source != [0; 4] || *parent != FrameId(0) {
        return Err(no("source-frame"));
    }
    if body.frames.len() < 3 || body.frames.len() > 256 {
        return Err(no("frame-depth"));
    }
    let map_id = FrameId((body.frames.len() - 2) as u32);
    for (i, image) in body.frames[2..body.frames.len() - 1].iter().enumerate() {
        if !matches!(image, Frame::AffineImage { base, .. } | Frame::InterpreterImage { base, .. } | Frame::Rigid { parent: base, .. } if base.0 == i as u32 + 1) {
            return Err(no("pattern-frame-chain"));
        }
    }
    let wrappers: Vec<_> = body
        .constructions
        .iter()
        .enumerate()
        .filter(|(_, n)| n.operation == (Operation::AffineTransform {}))
        .collect();
    if wrappers.len() != body.frames.len() - 3 {
        return Err(no("pattern-lineage"));
    }
    for (i, (index, n)) in wrappers.iter().enumerate() {
        if n.frame.0 != i as u32 + 2
            || n.parents.len() != 1
            || n.parents[0].0 as usize + 1 != *index
            || *index != body.constructions.len() - wrappers.len() + i
        {
            return Err(no("pattern-lineage"));
        }
    }
    let frame = Placement::from_frames(body, map_id).map_err(|_| no("frame-range"))?;
    let det = frame.det_exact().map_err(|_| no("frame-range"))?;
    match ex::sign(&det) {
        1 => {}
        -1 => return Err(no("reflected-placement")),
        _ => return Err(no("degenerate-frame")),
    }
    // Interpreter frames retain their explicit source-metric semantics. Raw
    // matrix pattern images, however, need a rigid witness for circular
    // carriers: a small Gram defect cannot certify a rotation. Check every
    // image, including serialized bodies and composed placement chains.
    for image in &body.frames {
        if let Frame::AffineImage { translation, rows, .. } = image {
            let post = Post::Rows { translation: get(translation), rows: rows.map(|r| get(&r)) };
            if !post.is_isometry().map_err(|_| no("frame-range"))? {
                return Err(no("non-rigid-placement"));
            }
        }
    }
    if frame
        .orthonormality_defect()
        .map_err(|_| no("frame-range"))?
        > 1e-10
    {
        return Err(no("non-rigid-placement"));
    }
    let expected = source_body(body.key.clone(), &body.frames, &body.constructions)?;
    if *body != expected {
        return Err(no("construction-carrier-mismatch"));
    }
    // Independent carrier consistency, deliberately not a replay of the builder:
    // every circular cap and the lateral surface must have the input radius.
    for s in &body.surfaces {
        if let SurfaceGeometry::Cylinder { radius, .. } = s.geometry {
            if radius.get() != spec.radius {
                return Err(no("side-radius-mismatch"));
            }
        }
    }
    Ok(Cylinder {
        body: body.clone(),
        spec,
        frame,
    })
}
/// The cylinder body a construction and frame chain describe: the carrier of the
/// replayed spec in the interpreter frame, relocated through the image chain.
pub(crate) fn source_body(key: BodyKey, frames: &[Frame], nodes: &[Construction]) -> R<Body> {
    let spec = replay(nodes, nodes.len().checked_sub(1).ok_or_else(|| no("missing-construction"))?, &mut 1024)?;
    let [Frame::Source { .. }, Frame::Interpreter { origin, x, z, .. }, _, ..] = frames else {
        return Err(no("frame-shape"));
    };
    let base = Affine {
        origin: get(origin),
        x: get(x),
        z: get(z),
    };
    let mut body = carrier(key, spec, base, nodes.to_vec())?;
    place_images(&mut body, &frames[2..frames.len() - 1])?;
    Ok(body)
}
pub fn transform(a: &Cylinder, frame: Affine) -> R<Body> {
    if a.frame != Affine::IDENTITY {
        // Already placed: append the exact map to the frame chain (`copy`); the
        // interpreter frame is never overwritten by a rounded product.
        let mut key = a.body.key.clone();
        key.revision = key.revision.checked_add(1).ok_or_else(|| no("revision-range"))?;
        return copy(a, key, &Post::Interpreter(frame));
    }
    assemble(
        a.body.key.clone(),
        a.spec,
        frame,
        a.body.constructions.clone(),
    )
}

/// Keep the translated seam chart after the exact affine-image chain. Every
/// geometry reference is relocated; the source construction remains untouched.
fn place_images(body: &mut Body, images: &[Frame]) -> R<()> {
    let map = FrameId(1 + images.len() as u32);
    let chart = FrameId(map.0 + 1);
    let mut seam = body.frames[2].clone();
    if let Frame::Rigid { parent, .. } = &mut seam {
        *parent = map;
    }
    body.frames.truncate(2);
    body.frames.extend_from_slice(images);
    body.frames.push(seam);
    let relocate = |id: &mut FrameId| -> R<()> {
        *id = match id.0 {
            1 => map,
            2 => chart,
            _ => return Err(no("carrier-frame")),
        };
        Ok(())
    };
    for v in &mut body.vertices {
        relocate(&mut v.frame)?;
    }
    for c in &mut body.curves {
        relocate(&mut c.frame)?;
    }
    for s in &mut body.surfaces {
        relocate(&mut s.frame)?;
    }
    Ok(())
}

/// Exact placement copy (an affine pattern image or a second interpreter
/// placement): never round the composed matrix into a new interpreter frame.
/// Reflection currently refuses, since its cylindrical STEP orientation needs a
/// separate chart proof; positive near-isometries retain all coefficients.
pub fn copy(a: &Cylinder, key: BodyKey, post: &Post) -> R<Body> {
    if a.body.frames.len() >= 256 {
        return Err(no("frame-depth"));
    }
    let map = FrameId((a.body.frames.len() - 1) as u32);
    let mut images = a.body.frames[2..a.body.frames.len() - 1].to_vec();
    images.push(post.frame(FrameId(map.0 - 1))?);
    let mut nodes = a.body.constructions.clone();
    nodes.push(Construction {
        operation: Operation::AffineTransform {},
        rule_version: 1,
        parents: vec![NodeId(nodes.len() as u32 - 1)],
        parameters: vec![],
        frame: map,
    });
    let Frame::Interpreter { origin, x, z, .. } = a.body.frames[1] else {
        return Err(no("source-frame"));
    };
    let mut body = carrier(
        key,
        a.spec,
        Affine {
            origin: get(&origin),
            x: get(&x),
            z: get(&z),
        },
        nodes,
    )?;
    place_images(&mut body, &images)?;
    Ok(audit(&body.check().map_err(|_| no("pattern-contract"))?)?.body)
}

fn diff(a: f64, b: f64, g: &mut Guard) -> Exp {
    ex::sum(&[a], &[-b], g)
}
/// Sign of squared perpendicular axis distance minus squared sum of radii.
/// Zero means exact external tangency, including sub-ulp construction gaps.
pub fn radial_relation(a: Spec, b: Spec) -> R<i32> {
    let k = a.axis()?;
    if b.axis()? != k {
        return Err(no("general-quadric-ssi"));
    }
    let mut g = Guard::new();
    let mut d = vec![];
    for j in 0..3 {
        if j != k {
            let e = diff(a.bottom[j], b.bottom[j], &mut g);
            d = ex::sum(&d, &ex::mul(&e, &e, &mut g), &mut g);
        }
    }
    let r = ex::sum(&[a.radius], &[b.radius], &mut g);
    let r2 = ex::mul(&r, &r, &mut g);
    let s = ex::sum(&d, &ex::neg(&r2), &mut g);
    if !g.exact() {
        return Err(no("predicate-range"));
    }
    Ok(ex::sign(&s))
}
fn merge(a: Spec, b: Spec) -> R<Option<Spec>> {
    let k = a.axis()?;
    if b.axis()? != k {
        return Err(no("general-quadric-ssi"));
    }
    if (0..3).any(|j| j != k && a.bottom[j] != b.bottom[j]) || a.radius != b.radius {
        return Ok(None);
    }
    if a.top[k] < b.bottom[k] || b.top[k] < a.bottom[k] {
        return Ok(None);
    }
    let mut c = a;
    c.bottom[k] = a.bottom[k].min(b.bottom[k]);
    c.top[k] = a.top[k].max(b.top[k]);
    Ok(Some(c))
}
pub fn boolean(key: BodyKey, op: u8, a: &Cylinder, b: &Cylinder) -> R<Vec<Body>> {
    if a.frame != b.frame {
        return crate::construction_geom::separated_boolean(op, a, b);
    }
    let k = a.spec.axis()?;
    if b.spec.axis()? != k {
        return Err(no("general-quadric-ssi"));
    }
    if op == 0 {
        if let Some(spec) = merge(a.spec, b.spec)? {
            let mut nodes = a.body.constructions.clone();
            let offset = nodes.len() as u32;
            let mut other = b.body.constructions.clone();
            for n in &mut other {
                for p in &mut n.parents {
                    p.0 += offset;
                }
            }
            nodes.extend(other);
            let rootb = nodes.len() as u32 - 1;
            nodes.push(Construction {
                operation: Operation::Boolean {},
                rule_version: 1,
                parents: vec![NodeId(offset - 1), NodeId(rootb)],
                parameters: vec![b64_zero()],
                frame: FrameId(1),
            });
            return Ok(vec![assemble(key, spec, a.frame.as_affine()?, nodes)?]);
        }
    }
    let axial_disjoint = a.spec.top[k] <= b.spec.bottom[k] || b.spec.top[k] <= a.spec.bottom[k];
    let radial = radial_relation(a.spec, b.spec)?;
    let shared_cap = a.spec.top[k] == b.spec.bottom[k] || b.spec.top[k] == a.spec.bottom[k];
    if op == 0 && shared_cap && radial < 0 {
        return Err(no("cap-contact-arrangement"));
    }
    if axial_disjoint || radial >= 0 {
        return match op {
            0 => Ok(vec![a.body.clone(), b.body.clone()]),
            1 => Ok(vec![a.body.clone()]),
            2 => Err(Refused::geometric_verdict(no("empty-result").0)),
            _ => Err(no("operation")),
        };
    }
    Err(no("parallel-overlap-arrangement"))
}
fn b64_zero() -> Binary64 {
    Binary64::new(0.).unwrap()
}

/// Exact separation from a union of orthogonal cells. Tangency removes no
/// volume; requiring every cell to be separated proves subtraction is a no-op.
pub fn tangent_box_noop(target: &crate::polyhedron::Audited, tools: &[Cylinder]) -> R<Body> {
    let cells = target
        .orthogonal
        .as_ref()
        .ok_or_else(|| no("non-orthogonal-target"))?;
    for c in tools {
        if c.frame != target.frame {
            crate::construction_geom::tangent_box_noop(target, c)?;
            continue;
        }
        let k = c.spec.axis()?;
        for cell in &cells.boxes {
            if c.spec.top[k] <= cell[0][k] || c.spec.bottom[k] >= cell[1][k] {
                continue;
            }
            let mut g = Guard::new();
            let mut dist = vec![];
            for j in 0..3 {
                if j != k {
                    let q = c.spec.bottom[j].clamp(cell[0][j], cell[1][j]);
                    let d = diff(c.spec.bottom[j], q, &mut g);
                    dist = ex::sum(&dist, &ex::mul(&d, &d, &mut g), &mut g);
                }
            }
            let r2 = ex::product(c.spec.radius, c.spec.radius, &mut g);
            let d = ex::sum(&dist, &ex::neg(&r2), &mut g);
            if !g.exact() {
                return Err(no("predicate-range"));
            }
            if ex::sign(&d) < 0 {
                return Err(no("box-cylinder-cut-arrangement"));
            }
        }
    }
    Ok(target.body.clone())
}

impl Cylinder {
    pub fn measures_mm(&self) -> R<(Iv, Iv)> {
        // The same VA1 pi enclosure API as the revolve strand, not std::PI.
        let pi = wonky_validated::pi(1e-14)
            .map_err(|_| no("validated-pi"))?
            .ball();
        let k = self.spec.axis()?;
        let r = Iv::point(self.spec.radius) * Iv::point(1000.);
        let h = (Iv::point(self.spec.top[k]) - Iv::point(self.spec.bottom[k])) * Iv::point(1000.);
        let det = enclosed(&self.frame.det_exact().map_err(|_| no("frame-range"))?);
        let volume = finite(pi * r * r * h * det)?;
        let base = Iv::point(2.) * pi * r * (r + h);
        let defect = self
            .frame
            .orthonormality_defect()
            .map_err(|_| no("frame-range"))?;
        // Singular-value bound on all surface Jacobians, including the curved
        // side. Unlike a rigid approximation this encloses the affine image.
        let scale = Iv {
            m: 1.,
            r: (3. * defect).next_up(),
        };
        let area = finite(base * scale)?;
        if volume.lo() <= 0. || scale.lo() <= 0. || area.r / area.m > 1e-9 {
            return Err(no("observation-width"));
        }
        Ok((volume, area))
    }
    pub fn bbox_mm(&self, map: Option<[[f64; 4]; 3]>) -> R<([f64; 3], [f64; 3])> {
        envelope_mm(&self.frame, self.spec, map)
    }
    pub fn tolerance_mm(&self) -> R<f64> {
        let (lo, hi) = self.bbox_mm(None)?;
        let mag = lo.into_iter().chain(hi).fold(0_f64, |a, b| a.max(b.abs()));
        let defect = self
            .frame
            .orthonormality_defect()
            .map_err(|_| no("frame-range"))?;
        let k = self.spec.axis()?;
        let reach = self.spec.radius + (self.spec.top[k] - self.spec.bottom[k]).abs();
        Ok((64. * f64::EPSILON * mag + 16. * defect * reach * 1000.).next_up())
    }
    pub fn centroid_mm(&self) -> R<[f64; 3]> {
        let k = self.spec.axis()?;
        let mut p = self.spec.bottom;
        p[k] = self.spec.bottom[k] * 0.5 + self.spec.top[k] * 0.5;
        self.frame
            .apply(p, 1000., true)
            .map_err(|_| no("frame-range"))
    }
    pub fn probe(&self, q: [f64; 3]) -> R<(f64, bool, f64)> {
        crate::cylinder_probe::probe(self, q)
    }
    pub fn measure_json(&self, map: Option<[[f64; 4]; 3]>, probes: &[[f64; 3]]) -> R<String> {
        let (volume, area) = self.measures_mm()?;
        let (lo, hi) = self.bbox_mm(None)?;
        let mapped = if let Some(m) = map {
            let (l, h) = self.bbox_mm(Some(m))?;
            format!("{{\"min\":{l:?},\"max\":{h:?}}}")
        } else {
            "null".into()
        };
        let probes = probes
            .iter()
            .map(|&p| match self.probe(p) {
                Ok((d, i, b)) => {
                    format!("{{\"distanceMm\":{d:?},\"inside\":{i},\"boundMm\":{b:?}}}")
                }
                Err(e) => format!("{{\"refused\":\"{}\"}}", e.0),
            })
            .collect::<Vec<_>>()
            .join(",");
        let c = self.centroid_mm()?;
        let tol = self.tolerance_mm()?;
        let pi = wonky_validated::pi(1e-14)
            .map_err(|_| no("validated-pi"))?
            .ball();
        let r = Iv::point(self.spec.radius) * Iv::point(1000.);
        let k = self.spec.axis()?;
        let h = (Iv::point(self.spec.top[k]) - Iv::point(self.spec.bottom[k])) * Iv::point(1000.);
        let cap = (pi * r * r).m;
        let side = (Iv::point(2.) * pi * r * h).m;
        let ring = (Iv::point(2.) * pi * r).m;
        let vertices = crate::cylinder_chart::vertices_mm(&self.body, &self.frame)?;
        let projection=format!("{{\"vertices\":{vertices:?},\"edges\":[[0,0],[1,1],[0,1]],\"faces\":[[[[0,false]]],[[[1,true]]],[[[0,true],[2,true],[1,false],[2,false]]]]}}");
        Ok(format!(concat!("{{\"basis\":\"native-f64-construction\",\"certificate\":\"AxialCylinder\",\"boundToConstruction\":true,",
            "\"volumeMm3\":{:?},\"volumeRelBound\":{:?},\"areaMm2\":{:?},\"areaRelBound\":{:?},\"centroidMm\":{:?},",
            "\"bboxMm\":{{\"min\":{:?},\"max\":{:?}}},\"mappedBboxMm\":{},",
            "\"topology\":{{\"bodies\":1,\"shells\":1,\"faces\":3,\"edges\":2,\"vertices\":0,\"loops\":4,\"ringEdges\":2,\"closedToroidalFaces\":0,\"genus\":0,\"singularPoints\":0,\"pinchPoints\":0}},",
            "\"validity\":{{\"brep\":true,\"closed\":true,\"positive\":true}},\"toleranceMm\":{:?},\"probes\":[{}],\"faceAreasMm2\":[{cap:?},{cap:?},{side:?}],\"facePerimetersMm\":[{ring:?},{ring:?},{perimeter:?}],\"projection\":{projection}}}"),volume.m,volume.r/volume.m,area.m,area.r/area.m,c,lo,hi,mapped,tol,probes,cap=cap,side=side,ring=ring,perimeter=2.*ring+2.*h.m,projection=projection))
    }
}

/// Axis-aligned box of a finite axial cylinder placed by `frame` (source
/// metres to world mm), then mapped by `map` (world mm to target mm, identity
/// when absent). Rim centres are exact images; each coordinate's radial reach
/// is r * |(d_u, d_v)| from the enclosed mapped chart columns (the support of
/// the affine image of a rim disk). Reported values are the midpoints of those
/// interval enclosures, one rounding from the exact extremes.
pub(crate) fn envelope_mm(
    frame: &Placement,
    spec: Spec,
    map: Option<[[f64; 4]; 3]>,
) -> R<([f64; 3], [f64; 3])> {
    let m = map.unwrap_or([[1., 0., 0., 0.], [0., 1., 0., 0.], [0., 0., 1., 0.]]);
    let k = spec.axis()?;
    let cols = frame.enclosed_columns();
    let bottom = frame
        .apply_exact(spec.bottom, 1000., true)
        .map_err(|_| no("frame-range"))?;
    let top = frame
        .apply_exact(spec.top, 1000., true)
        .map_err(|_| no("frame-range"))?;
    let mut lo = [0.; 3];
    let mut hi = [0.; 3];
    for i in 0..3 {
        let mut p = Iv::point(m[i][3]);
        let mut q = p;
        let mut d = [Iv::point(0.); 3];
        for j in 0..3 {
            let a = Iv::point(m[i][j]);
            p = p + a * enclosed(&bottom[j]);
            q = q + a * enclosed(&top[j]);
            for l in 0..3 {
                d[l] = d[l] + a * cols[l][j];
            }
        }
        let extent = finite(
            d[(k + 1) % 3].norm3(d[(k + 2) % 3], Iv::point(0.))
                * Iv::point(spec.radius)
                * Iv::point(1000.),
        )?;
        lo[i] = finite(p - extent)?.m.min(finite(q - extent)?.m);
        hi[i] = finite(p + extent)?.m.max(finite(q + extent)?.m);
    }
    Ok((lo, hi))
}

pub fn distance_mm(a: &Cylinder, b: &Cylinder) -> R<(f64, f64)> {
    if a.frame != b.frame {
        return crate::construction_geom::distance_mm(a, b);
    }
    let k = a.spec.axis()?;
    if b.spec.axis()? != k {
        return Err(no("general-quadric-ssi"));
    }
    if a.spec.top[k] < b.spec.bottom[k] || b.spec.top[k] < a.spec.bottom[k] {
        return Err(no("distance-disjoint-axial-intervals"));
    }
    let mut g = Guard::new();
    let mut d2 = vec![];
    for j in 0..3 {
        if j != k {
            let d = diff(a.spec.bottom[j], b.spec.bottom[j], &mut g);
            d2 = ex::sum(&d2, &ex::mul(&d, &d, &mut g), &mut g);
        }
    }
    let rs = ex::sum(&[a.spec.radius], &[b.spec.radius], &mut g);
    let r2 = ex::mul(&rs, &rs, &mut g);
    let numerator = ex::sum(&d2, &ex::neg(&r2), &mut g);
    if !g.exact() {
        return Err(no("predicate-range"));
    }
    if ex::sign(&numerator) <= 0 {
        return Ok((0., 0.));
    }
    // Rationalized difference avoids cancellation for arbitrarily small gaps.
    let gap = enclosed(&numerator) / (enclosed(&d2).sqrt() + enclosed(&rs)) * Iv::point(1000.);
    let defect = a
        .frame
        .orthonormality_defect()
        .map_err(|_| no("frame-range"))?;
    let gap = finite(
        gap * Iv {
            m: 1.,
            r: (3. * defect).next_up(),
        },
    )?;
    Ok((gap.m, gap.r))
}
