//! F2 rim blends on the exact `Model` of an audited body (fillets3d design
//! §3 row 2): the body's Model adapter (G1/G8) supplies the input, and
//! `wonky_blend::rim::ring_fillet` replaces each selected ring by its
//! rolling-ball tube band (`ring_chamfer`: by its equal-offset cone band).
//!
//! **Selection.** A wire ring edge is a full `CurveGeometry::Circle` in its
//! curve frame. Its centre, axis and radius are mapped into the Model frame
//! through the exact frame chain (the curve frame's exact image, then the
//! inverse of the Model placement) and must equal one Model ring exactly; no
//! tolerance and no rounded world coordinate takes part. A wire circle that
//! is a rounded cache of an irrational image matches nothing and refuses
//! `fillet/rim-selection-not-in-model`.
//!
//! **Chains.** A bounded wire edge maps to the Model edge whose end vertices
//! are the exact images of its wire vertices (same curve class);
//! `wonky_blend::chain::chain_fillet` then blends the closed G1 cap loop
//! (AC32's obround rim: cylinder and partial torus patches).
//!
//! **Junctions.** Before the source becomes a Model, every junction of a
//! line/arc source profile is decided exactly on its rational witnesses:
//! the arriving and leaving tangents `u`, `v` are rational, `sin²θ =
//! (u × v)² / (|u|²|v|²)`. A kink whose mitre gap `r·sin θ` at the blend
//! distance is within one binary64 ulp of the profile's extent (the tea box's
//! three-point arcs, ≈1e-17 m off tangent) refuses
//! `blend/sub-resolution-feature(min=…)`; a visible kink is a corner
//! (`blend/chain-junction-not-tangent`, the F4 mitre). Nothing is welded and
//! no radius is rounded on the way.
//!
//! Dark: the host does not route here yet (no curved Model wire emission).
//! Consumer: the rim shadow tests (tests/model_rim.rs) over the pc-* rows of
//! the fillet catalogue and AC33; deletion: when a host route owns these
//! selections.
use crate::analytic::Solid;
use crate::placement::Placement;
use crate::polyhedron::Refused;
use num_traits::Zero;
use wonky_contract::{ArcKind, Body, CurveGeometry};
use wonky_geom::model::{Bounds, Curve3, EdgeId, Model};
use wonky_geom::{cross, dot, Point, Q};

type R<T> = std::result::Result<T, Refused>;
fn no(s: &str) -> Refused {
    Refused(format!("fillet/{s}"))
}
fn q(x: f64) -> R<Q> {
    Q::from_float(x).ok_or_else(|| no("rim-numeric-range"))
}

/// The exact map of a wire frame to the Source frame. A `Rigid` frame with a
/// zero angle is its exact translation; a nonzero angle (rotation by a
/// binary64 angle, generally irrational) refuses.
fn exact_frame(body: &Body, id: wonky_contract::FrameId, depth: usize) -> R<wonky_geom::frame::Frame> {
    match body.frames.get(id.0 as usize) {
        Some(wonky_contract::Frame::Rigid { parent, translation, angle, .. }) if depth < 256 => {
            if angle.get() != 0. {
                return Err(no("rim-source-frame"));
            }
            let p = exact_frame(body, *parent, depth + 1)?;
            let t: Point = [q(translation[0].get())?, q(translation[1].get())?, q(translation[2].get())?];
            wonky_geom::frame::Frame::new(p.point(&t), p.columns().clone()).map_err(|e| Refused(e.0.into()))
        }
        _ => Placement::from_frames(body, id).map_err(|_| no("rim-source-frame"))?.exact_frame(),
    }
}

/// The Model ring edge that is exactly the wire ring edge `index` of `body`.
pub fn ring_edge(m: &Model, body: &Body, index: usize) -> R<EdgeId> {
    let e = body.edges.get(index).ok_or_else(|| no("edge-index"))?;
    let c = body.curves.get(e.curve.0 as usize).ok_or_else(|| no("edge-index"))?;
    let CurveGeometry::Circle { origin, normal, x, radius, arc: ArcKind::Full {} } = &c.geometry else {
        return Err(no("rim-requires-ring-edge"));
    };
    let frame = exact_frame(body, c.frame, 0)?;
    let inverse = m.draft().placement.inverse();
    let point = |p: &[wonky_contract::Binary64; 3]| -> R<Point> {
        let p: Point = [q(p[0].get())?, q(p[1].get())?, q(p[2].get())?];
        Ok(inverse.point(&frame.point(&p)))
    };
    let vector = |v: &[wonky_contract::Binary64; 3]| -> R<Point> {
        let v: Point = [q(v[0].get())?, q(v[1].get())?, q(v[2].get())?];
        Ok(inverse.vector(&frame.vector(&v)))
    };
    let center = point(origin)?;
    let axis = vector(normal)?;
    let radial = vector(x)?;
    let x2 = {
        let raw = [q(x[0].get())?, q(x[1].get())?, q(x[2].get())?];
        dot(&raw, &raw)
    };
    if x2.is_zero() {
        return Err(no("rim-source-frame"));
    }
    // Model-frame radius²: the wire radius scaled by the image of its unit
    // radial direction (exact squares, no root).
    let r2 = q(radius.get())? * q(radius.get())? * dot(&radial, &radial) / x2;
    let d = m.draft();
    let found: Vec<EdgeId> = (0..d.edges.len())
        .filter(|&i| {
            let edge = &d.edges[i];
            let Curve3::Circle(circle) = &d.curves[edge.curve.index()].geometry else { return false };
            if !matches!(edge.bounds, Bounds::Ring) {
                return false;
            }
            // A radical-centre circle never has the rational source centre.
            let Ok(frame) = circle.frame() else { return false };
            let cols = frame.columns();
            let n = cross(&cols[0], &cols[1]);
            frame.origin() == &center
                && cross(&n, &axis).iter().all(Q::is_zero)
                && circle.radius2() * dot(&cols[0], &cols[0]) == r2
        })
        .map(|i| EdgeId(i as u32))
        .collect();
    match found[..] {
        [one] => Ok(one),
        _ => Err(no("rim-selection-not-in-model")),
    }
}

/// The Model edge that is exactly the bounded wire edge `index` of `body`:
/// both wire vertices map through the exact frame chain onto the edge's
/// end vertices, and the curve class (line or circle) agrees. More than one
/// such edge refuses instead of guessing.
pub fn segment_edge(m: &Model, body: &Body, index: usize) -> R<EdgeId> {
    let e = body.edges.get(index).ok_or_else(|| no("edge-index"))?;
    let c = body.curves.get(e.curve.0 as usize).ok_or_else(|| no("edge-index"))?;
    let circle = match &c.geometry {
        CurveGeometry::Circle { arc: ArcKind::Trimmed {}, .. } => true,
        CurveGeometry::Circle { arc: ArcKind::Full {}, .. } => return Err(no("chain-requires-bounded-edge")),
        _ => false,
    };
    let [a, b] = e.vertices[..] else { return Err(no("chain-requires-bounded-edge")) };
    let inverse = m.draft().placement.inverse();
    let point = |v: wonky_contract::VertexId| -> R<Point> {
        let v = body.vertices.get(v.0 as usize).ok_or_else(|| no("edge-index"))?;
        let frame = exact_frame(body, v.frame, 0)?;
        let p: Point = [q(v.point[0].get())?, q(v.point[1].get())?, q(v.point[2].get())?];
        Ok(inverse.point(&frame.point(&p)))
    };
    let ends = [point(a)?, point(b)?];
    let d = m.draft();
    let key = |v: wonky_geom::model::VertexId| d.vertices[v.index()].def.key().ok().and_then(|k| k.rational().ok().cloned());
    let found: Vec<EdgeId> = (0..d.edges.len())
        .filter(|&i| {
            let edge = &d.edges[i];
            let Bounds::Segment([u, v]) = edge.bounds else { return false };
            let class = matches!(d.curves[edge.curve.index()].geometry, Curve3::Circle(_));
            let (Some(u), Some(v)) = (key(u), key(v)) else { return false };
            class == circle && ((u == ends[0] && v == ends[1]) || (u == ends[1] && v == ends[0]))
        })
        .map(|i| EdgeId(i as u32))
        .collect();
    match found[..] {
        [one] => Ok(one),
        [] => Err(no("chain-selection-not-in-model")),
        _ => Err(no("chain-selection-ambiguous")),
    }
}

/// The exact junction decision of a line/arc source profile (see the module
/// notes): `Ok` when every junction is G1.
fn profile_junctions(solid: &Solid, distance: f64) -> R<()> {
    use num_traits::Signed;
    use wonky_curve::Chart;
    let Solid::Planar(a) = solid else { return Ok(()) };
    let Some(prism) = &a.arcs else { return Ok(()) };
    let pieces = prism.profile.segments();
    // Unit-free direction of travel at an end of a piece; `None` when the
    // piece is not rational there (its class is decided elsewhere).
    let direction = |piece: &wonky_curve::Trimmed, at_end: bool| -> Option<[Q; 2]> {
        let ends = piece.ends();
        let (s, e) = (ends[0].rat().ok()?, ends[1].rat().ok()?);
        Some(match piece.chart() {
            Chart::Line => [&e[0] - &s[0], &e[1] - &s[1]],
            Chart::Circle(c) => {
                let p = if at_end { e } else { s };
                let centre = c.c.rat().ok()?;
                let v = [&p[0] - &centre[0], &p[1] - &centre[1]];
                if c.ccw { [-&v[1], v[0].clone()] } else { [v[1].clone(), -&v[0]] }
            }
            Chart::BSpline(_) => return None,
        })
    };
    let mut extent = 0f64;
    for piece in pieces {
        for p in piece.ends() {
            if let Ok(p) = p.rat() {
                for x in p {
                    extent = extent.max(num_traits::ToPrimitive::to_f64(x).unwrap_or(f64::INFINITY).abs());
                }
            }
        }
    }
    let ulp = q(extent)? * q(f64::EPSILON)?;
    let r = q(distance)?;
    for k in 0..pieces.len() {
        let (a, b) = (&pieces[k], &pieces[(k + 1) % pieces.len()]);
        let (Some(u), Some(v)) = (direction(a, true), direction(b, false)) else { continue };
        let cross = &u[0] * &v[1] - &u[1] * &v[0];
        let along = &u[0] * &v[0] + &u[1] * &v[1];
        if cross.is_zero() && along.is_positive() {
            continue;
        }
        let norms = (&u[0] * &u[0] + &u[1] * &u[1]) * (&v[0] * &v[0] + &v[1] * &v[1]);
        let gap2 = &r * &r * &cross * &cross / norms;
        if along.is_positive() && gap2 <= &ulp * &ulp {
            let gap = num_traits::ToPrimitive::to_f64(&gap2).unwrap_or(0.).sqrt();
            return Err(Refused(format!("blend/sub-resolution-feature(min={gap:e})")));
        }
        return Err(Refused("blend/chain-junction-not-tangent".into()));
    }
    Ok(())
}

/// Fillet a closed G1 chain of bounded wire edges (one planar cap loop, as
/// tangent propagation selects it: AC32's obround rim) on the body's Model.
pub fn chain_fillet(solid: &Solid, body: &Body, edges: &[usize], radius: f64, node: u32) -> R<Model> {
    if !radius.is_finite() || radius <= 0. {
        return Err(no("invalid-radius"));
    }
    profile_junctions(solid, radius)?;
    let m = solid.model()?;
    let ids = edges.iter().map(|&i| segment_edge(&m, body, i)).collect::<R<Vec<_>>>()?;
    wonky_blend::chain::chain_fillet(&m, &ids, &q(radius)?, node).map_err(|e| Refused(e.0))
}

/// Equal-offset chamfer of a closed G1 chain of bounded wire edges, as
/// [`chain_fillet`].
pub fn chain_chamfer(solid: &Solid, body: &Body, edges: &[usize], width: f64, node: u32) -> R<Model> {
    if !width.is_finite() || width <= 0. {
        return Err(Refused("chamfer/invalid-width".into()));
    }
    profile_junctions(solid, width)?;
    let m = solid.model()?;
    let ids = edges.iter().map(|&i| segment_edge(&m, body, i)).collect::<R<Vec<_>>>()?;
    wonky_blend::chain::chain_chamfer(&m, &ids, &q(width)?, node).map_err(|e| Refused(e.0))
}

/// Fillet the selected wire ring edges of an audited body on its Model, in
/// selection order. `node` owns the new entities' provenance.
pub fn rim_fillet(solid: &Solid, body: &Body, edges: &[usize], radius: f64, node: u32) -> R<Model> {
    if !radius.is_finite() || radius <= 0. {
        return Err(no("invalid-radius"));
    }
    rim_blend(solid, body, edges, radius, node, wonky_blend::rim::ring_fillet)
}

/// Equal-offset chamfer of the selected wire ring edges (AC33), as
/// [`rim_fillet`].
pub fn rim_chamfer(solid: &Solid, body: &Body, edges: &[usize], width: f64, node: u32) -> R<Model> {
    if !width.is_finite() || width <= 0. {
        return Err(Refused("chamfer/invalid-width".into()));
    }
    rim_blend(solid, body, edges, width, node, wonky_blend::rim::ring_chamfer)
}

type RingBlend = fn(&Model, EdgeId, &Q, u32) -> Result<(Model, wonky_blend::rim::Rim), wonky_blend::Refusal>;
fn rim_blend(solid: &Solid, body: &Body, edges: &[usize], distance: f64, node: u32, blend: RingBlend) -> R<Model> {
    if edges.is_empty() {
        return Err(no("empty-selection"));
    }
    let mut m = solid.model()?;
    let ids = edges.iter().map(|&i| ring_edge(&m, body, i)).collect::<R<Vec<_>>>()?;
    let r = q(distance)?;
    for id in ids {
        // The surgery keeps every other edge id: the band spring reuses the
        // selected ring's id, the plane spring is appended.
        m = blend(&m, id, &r, node).map_err(|e| Refused(e.0))?.0;
    }
    Ok(m)
}
