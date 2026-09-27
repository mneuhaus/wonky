//! Topology queries over audited WC0 bodies. Entity ids are transport indices,
//! not a legacy B-rep projection. Seams are hidden by coedge incidence, and all
//! geometric decisions use expansions of the source carriers and their frame.
use crate::{affine::Affine, analytic::Solid, cylinder::enclosed, polyhedron::Refused};
use std::collections::BTreeSet;
use wonky_contract::*;
use wonky_num::expansion::{self as ex, Exp, Guard};

type R<T> = std::result::Result<T, Refused>;
pub const BODY: u32 = 0;
pub const FACE: u32 = 1;
pub const EDGE: u32 = 2;
pub const VERTEX: u32 = 3;
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Entity {
    pub kind: u32,
    pub index: u32,
}
fn no(s: &str) -> Refused {
    Refused(format!("query/{s}"))
}
fn get(p: &Vector3) -> [f64; 3] {
    p.each_ref().map(|x| x.get())
}
fn body(s: &Solid) -> &Body {
    match s {
        Solid::Planar(a) => &a.body,
        Solid::Cylinder(c) => &c.body,
        Solid::Bicylinder(c) => &c.body,
        Solid::Perforated(p) => &p.body,
        Solid::Spherical(s) => &s.body,
        Solid::Axial(a) => &a.body,
        Solid::Lens(a) => &a.body,
    }
}
fn frame(s: &Solid) -> R<Affine> {
    match s {
        Solid::Planar(a) if a.chamfer.is_some() => Err(no("chamfer-geometry-unimplemented")),
        Solid::Planar(a) => a.frame.as_affine(),
        Solid::Cylinder(c) => c.frame.as_affine(),
        Solid::Bicylinder(c) => Ok(c.frame),
        Solid::Perforated(p) => p.base.frame.as_affine(),
        Solid::Spherical(s) => Ok(s.frame),
        Solid::Axial(a) => Ok(a.frame),
        Solid::Lens(a) => Ok(a.frame),
    }
}
fn validate(body: &Body, e: Entity) -> R<()> {
    let n = match e.kind {
        BODY => 1,
        FACE => body.faces.len(),
        EDGE => body.edges.len(),
        VERTEX => body.vertices.len(),
        _ => return Err(no("entity-kind")),
    };
    if e.index as usize >= n {
        return Err(no("entity-index"));
    }
    Ok(())
}
fn face_edges(body: &Body, face: usize) -> Vec<u32> {
    body.faces[face]
        .loops
        .iter()
        .flat_map(|l| &body.loops[l.0 as usize].coedges)
        .map(|c| body.coedges[c.0 as usize].edge.0)
        .collect()
}
fn seams(body: &Body) -> BTreeSet<u32> {
    let mut uses = vec![vec![]; body.edges.len()];
    for (f, face) in body.faces.iter().enumerate() {
        for l in &face.loops {
            for c in &body.loops[l.0 as usize].coedges {
                let c = &body.coedges[c.0 as usize];
                uses[c.edge.0 as usize].push((f, c.forward));
            }
        }
    }
    uses.iter()
        .enumerate()
        .filter_map(|(e, uses)| match uses.as_slice() {
            [(a, f), (b, g)] if a == b && f != g => Some(e as u32),
            _ => None,
        })
        .collect()
}
pub fn owned(s: &Solid, kind: u32) -> R<Vec<Entity>> {
    let body = body(s);
    let seam = seams(body);
    let n = match kind {
        BODY => 1,
        FACE => body.faces.len(),
        EDGE => body.edges.len(),
        VERTEX => body.vertices.len(),
        _ => return Err(no("entity-kind")),
    };
    let mut open = BTreeSet::new();
    let mut closed = BTreeSet::new();
    if kind == VERTEX {
        for (i, e) in body.edges.iter().enumerate() {
            if e.vertices.is_empty() {
                continue; // Full algebraic rings have no topological vertices.
            }
            if e.vertices[0] == e.vertices[1] {
                closed.insert(e.vertices[0].0);
            } else if !seam.contains(&(i as u32)) {
                open.extend(e.vertices.iter().map(|v| v.0));
            }
        }
        if (0..n as u32).any(|i| !open.contains(&i) && !closed.contains(&i)) {
            return Err(no("singular-vertex-semantics"));
        }
    }
    Ok((0..n as u32)
        .filter(|i| match kind {
            EDGE => !seam.contains(i),
            VERTEX => open.contains(i),
            _ => true,
        })
        .map(|index| Entity { kind, index })
        .collect())
}
pub fn geometry(s: &Solid, entities: &[Entity], name: &str) -> R<Vec<Entity>> {
    const NAMES: &[&str] = &[
        "LINE",
        "CIRCLE",
        "ARC",
        "OTHER_CURVE",
        "PLANE",
        "CYLINDER",
        "CONE",
        "SPHERE",
        "TORUS",
        "REVOLVED",
        "EXTRUDED",
        "OTHER_SURFACE",
        "ALL_MESH",
        "MIXED_MESH",
        "MESH",
    ];
    if !NAMES.contains(&name) {
        return Err(no("geometry-kind"));
    }
    let b = body(s);
    let mut out = vec![];
    for &e in entities {
        validate(b, e)?;
        if matches!(name, "ALL_MESH" | "MIXED_MESH" | "MESH") {
            continue;
        }
        let found = match e.kind {
            FACE => match b.surfaces[b.faces[e.index as usize].surface.0 as usize].geometry {
                SurfaceGeometry::Plane { .. } => "PLANE",
                SurfaceGeometry::Cylinder { .. } => "CYLINDER",
                SurfaceGeometry::Cone { .. } => "CONE",
                SurfaceGeometry::Sphere { .. } => "SPHERE",
                SurfaceGeometry::Torus { .. } => "TORUS",
            },
            EDGE => match &b.curves[b.edges[e.index as usize].curve.0 as usize].geometry {
                CurveGeometry::Line { .. } | CurveGeometry::ConstructionLine { .. } => "LINE",
                CurveGeometry::SphereCircle { .. } => "CIRCLE",
                CurveGeometry::Circle {
                    arc: ArcKind::Full {},
                    ..
                } => "CIRCLE",
                CurveGeometry::Circle { .. } => "ARC",
                _ => "OTHER_CURVE",
            },
            _ => return Err(no("geometry-entity")),
        };
        if name == found {
            out.push(e);
        }
    }
    Ok(out)
}
pub fn adjacent(s: &Solid, seeds: &[Entity], kind: u32) -> R<Vec<Entity>> {
    let b = body(s);
    if kind != EDGE && kind != FACE {
        return Err(no("adjacency-kind"));
    }
    let seam = seams(b);
    let mut out = BTreeSet::new();
    for &seed in seeds {
        validate(b, seed)?;
        if seed.kind != FACE {
            return Err(no("adjacency-seed"));
        }
        let edges: BTreeSet<_> = face_edges(b, seed.index as usize)
            .into_iter()
            .filter(|e| !seam.contains(e))
            .collect();
        if kind == EDGE {
            out.extend(edges);
        } else {
            for f in 0..b.faces.len() {
                if f != seed.index as usize && face_edges(b, f).iter().any(|e| edges.contains(e)) {
                    out.insert(f as u32);
                }
            }
        }
    }
    Ok(out
        .into_iter()
        .map(|index| Entity { kind, index })
        .collect())
}
fn cross(a: &[Exp; 3], b: &[Exp; 3], g: &mut Guard) -> [Exp; 3] {
    [(1, 2), (2, 0), (0, 1)].map(|(i, j)| {
        let x = ex::mul(&a[i], &b[j], g);
        let y = ex::mul(&a[j], &b[i], g);
        ex::sum(&x, &ex::neg(&y), g)
    })
}
fn dot(a: &[Exp; 3], b: &[Exp; 3], g: &mut Guard) -> Exp {
    (0..3).fold(vec![], |s, i| {
        let p = ex::mul(&a[i], &b[i], g);
        ex::sum(&s, &p, g)
    })
}
fn squared(a: &[Exp; 3], g: &mut Guard) -> Exp {
    dot(a, a, g)
}
fn parallel(a: &[Exp; 3], b: &[Exp; 3]) -> R<bool> {
    let mut g = Guard::new();
    let aa = squared(a, &mut g);
    let bb = squared(b, &mut g);
    let c = cross(a, b, &mut g);
    let cc = squared(&c, &mut g);
    let norm = ex::mul(&aa, &bb, &mut g);
    if !g.exact() {
        return Err(no("predicate-range"));
    }
    if ex::sign(&aa) <= 0 || ex::sign(&bb) <= 0 {
        return Err(no("zero-direction"));
    }
    if ex::sign(&cc) == 0 {
        return Ok(true);
    }
    // A tiny but nonzero angle is NOT certified parallel. In particular, a
    // rounded coordinate-system normal is not the affine dual normal. Refuse
    // the unresolved query band instead of tolerance-welding it or returning
    // an empty nominally-coplanar query that a later operation might ignore.
    let sine2 = enclosed(&cc) / enclosed(&norm);
    if !sine2.lo().is_finite() || sine2.lo() <= 1e-16 {
        return Err(no("near-parallel-unproved"));
    }
    Ok(false)
}
fn mapped(frame: Affine, p: [f64; 3], point: bool) -> R<[Exp; 3]> {
    frame
        .apply_exact(p, 1., point)
        .map_err(|_| no("predicate-range"))
}
fn mapped_vector(frame: Affine, p: &[Exp; 3]) -> R<[Exp; 3]> {
    let columns = [
        mapped(frame, [1., 0., 0.], false)?,
        mapped(frame, [0., 1., 0.], false)?,
        mapped(frame, [0., 0., 1.], false)?,
    ];
    let mut g = Guard::new();
    let out = [0, 1, 2].map(|i| {
        (0..3).fold(vec![], |s, j| {
            let x = ex::mul(&columns[j][i], &p[j], &mut g);
            ex::sum(&s, &x, &mut g)
        })
    });
    if !g.exact() {
        return Err(no("predicate-range"));
    }
    Ok(out)
}
fn point(body: &Body, frame: Affine, p: Vector3, id: FrameId) -> R<[Exp; 3]> {
    if id == FrameId(1) {
        return mapped(frame, get(&p), true);
    }
    let Some(Frame::Rigid {
        parent,
        translation,
        angle,
        ..
    }) = body.frames.get(id.0 as usize)
    else {
        return Err(no("chart-frame"));
    };
    if *parent != FrameId(1) || angle.get() != 0. {
        return Err(no("chart-frame"));
    }
    let p = mapped(frame, get(&p), false)?;
    let t = mapped(frame, get(translation), true)?;
    let mut g = Guard::new();
    let out = [0, 1, 2].map(|i| ex::sum(&p[i], &t[i], &mut g));
    if !g.exact() {
        return Err(no("predicate-range"));
    }
    Ok(out)
}
pub fn parallel_edges(s: &Solid, entities: &[Entity], direction: [f64; 3]) -> R<Vec<Entity>> {
    if let Solid::Planar(a) = s {
        if a.arrangement.is_some() {
            for &e in entities { validate(&a.body, e)?; }
            if direction.iter().any(|x| !x.is_finite()) { return Err(no("invalid-direction")); }
            return crate::planar_geometry::parallel_edges(a, entities, direction);
        }
    }
    let b = body(s);
    let frame = frame(s)?;
    let mut out = vec![];
    let d = direction.map(|x| vec![x]);
    // Validate even when no selected line exists: zero is not a direction.
    parallel(&d, &d)?;
    for &e in entities {
        validate(b, e)?;
        if e.kind != EDGE {
            continue;
        }
        let c = &b.curves[b.edges[e.index as usize].curve.0 as usize];
        if let CurveGeometry::Line { a, b: end } = &c.geometry {
            let a = point(b, frame, *a, c.frame)?;
            let end = point(b, frame, *end, c.frame)?;
            let mut g = Guard::new();
            let line = [0, 1, 2].map(|i| ex::sum(&end[i], &ex::neg(&a[i]), &mut g));
            if !g.exact() {
                return Err(no("predicate-range"));
            }
            if parallel(&line, &d)? {
                out.push(e);
            }
        }
    }
    Ok(out)
}
fn incident(p: &[Exp; 3], origin: &[Exp; 3], normal: &[Exp; 3]) -> R<bool> {
    let mut g = Guard::new();
    let delta = [0, 1, 2].map(|i| ex::sum(&p[i], &ex::neg(&origin[i]), &mut g));
    let d = dot(&delta, normal, &mut g);
    let nn = squared(normal, &mut g);
    if !g.exact() {
        return Err(no("predicate-range"));
    }
    if ex::sign(&d) == 0 {
        return Ok(true);
    }
    let distance2 = enclosed(&ex::mul(&d, &d, &mut g)) / enclosed(&nn);
    if !g.exact() || !distance2.lo().is_finite() {
        return Err(no("predicate-range"));
    }
    // SI metres; this is a refusal band, never a snap or positive certificate.
    if distance2.lo() <= 1e-16 {
        return Err(no("near-plane-unproved"));
    }
    Ok(false)
}
pub fn coincides(
    s: &Solid,
    entities: &[Entity],
    origin: [f64; 3],
    normal: [f64; 3],
) -> R<Vec<Entity>> {
    if let Solid::Planar(a) = s {
        if a.arrangement.is_some() {
            if origin.iter().chain(&normal).any(|x| !x.is_finite()) { return Err(no("invalid-plane")); }
            return crate::planar_geometry::coincides(a, entities, origin, normal, false);
        }
    }
    coincides_in_chart(s, frame(s)?, entities, origin, normal)
}

/// A source-plane query carries the same construction frame as the solid.
/// Incidence and coplanarity are invariant under that invertible affine map;
/// cancel it instead of rounding a world origin or treating a primal column
/// as a dual normal. A caller's unrelated frame must never be cancelled.
/// The body's audit has already proved the frame nondegenerate.
pub fn coincides_in_frame(
    s: &Solid,
    entities: &[Entity],
    source_frame: Affine,
    origin: [f64; 3],
    normal: [f64; 3],
) -> R<Vec<Entity>> {
    if source_frame != frame(s)? {
        return Err(no("different-exact-frames"));
    }
    if let Solid::Planar(a) = s {
        if a.arrangement.is_some() {
            if origin.iter().chain(&normal).any(|x| !x.is_finite()) { return Err(no("invalid-plane")); }
            return crate::planar_geometry::coincides(a, entities, origin, normal, true);
        }
    }
    coincides_in_chart(s, Affine::IDENTITY, entities, origin, normal)
}

fn coincides_in_chart(
    s: &Solid,
    frame: Affine,
    entities: &[Entity],
    origin: [f64; 3],
    normal: [f64; 3],
) -> R<Vec<Entity>> {
    let b = body(s);
    let o = origin.map(|x| vec![x]);
    let n = normal.map(|x| vec![x]);
    parallel(&n, &n)?;
    let mut out = vec![];
    for &e in entities {
        validate(b, e)?;
        let matched = match e.kind {
            FACE => {
                let surf = &b.surfaces[b.faces[e.index as usize].surface.0 as usize];
                if let SurfaceGeometry::Plane { origin, normal, x } = &surf.geometry {
                    // A mixed-profile side plane carries a rounded unit tangent.
                    // Its construction source is authoritative; this predicate
                    // has not yet been ported to that source-witness chart.
                    if e.index >= 2 && matches!(s, Solid::Planar(a) if a.arcs.is_some()) {
                        return Err(no("arc-profile-side-plane-unimplemented"));
                    }
                    let mut g = Guard::new();
                    let y = cross(
                        &get(normal).map(|v| vec![v]),
                        &get(x).map(|v| vec![v]),
                        &mut g,
                    );
                    let u = mapped(frame, get(x), false)?;
                    let v = mapped_vector(frame, &y)?;
                    let world_normal = cross(&u, &v, &mut g);
                    if !g.exact() {
                        return Err(no("predicate-range"));
                    }
                    parallel(&world_normal, &n)?
                        && incident(&point(b, frame, *origin, surf.frame)?, &o, &n)?
                } else {
                    false
                }
            }
            VERTEX => {
                let v = &b.vertices[e.index as usize];
                incident(&point(b, frame, v.point, v.frame)?, &o, &n)?
            }
            _ => return Err(no("plane-entity")),
        };
        if matched {
            out.push(e);
        }
    }
    Ok(out)
}
