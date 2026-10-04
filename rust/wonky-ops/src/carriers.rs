//! World-space analytic carriers of a WC0 body, for viewers and inspectors.
//!
//! Every face reports its surface carrier and every edge its curve carrier in
//! millimetres, after the exact frame composition (`Placement`) and one final
//! rounding. Nothing is sampled. Points use `apply(p, 1000, true)`, directions
//! `apply(d, 1, false)`, radii are scaled by 1000 and only reported when the
//! placement is an isometry within `UNIT_DEFECT`; otherwise (and for kinds
//! without a closed form here) the entry carries a named refusal instead of a
//! guessed value. Indices are WC0 face and edge ids.
use crate::placement::Placement;
use std::collections::BTreeMap;
use wonky_contract::*;
use std::result::Result as Res;

/// Largest admitted orthonormality defect of a placement carrying a radius.
const UNIT_DEFECT: f64 = 1. / (1u64 << 40) as f64;
type Frames = BTreeMap<u32, Placement>;

/// The exact placement of frame `id`, cached in `frames`. A zero-angle Rigid
/// chart maps p to parent(translation + p); the translation is local, so it is
/// composed before the parent map, never as a world offset after it.
pub(crate) fn frame_placement(body: &Body, id: FrameId, frames: &mut Frames) -> Res<Placement, String> {
    if let Some(f) = frames.get(&id.0) {
        return Ok(f.clone());
    }
    let f = match body.frames.get(id.0 as usize) {
        Some(Frame::Rigid { parent, translation, angle, .. }) if angle.get() == 0. && parent.0 < id.0 => {
            frame_placement(body, *parent, frames)?
                .pre_translated(translation.map(|x| x.get()))
                .map_err(|_| "frame-range".to_string())?
        }
        _ => Placement::from_frames(body, id).map_err(|_| "frame-unsupported".to_string())?,
    };
    f.reversed().map_err(|_| "singular-frame".to_string())?;
    frames.insert(id.0, f.clone());
    Ok(f)
}

fn xyz(v: &Vector3) -> [f64; 3] {
    v.map(|x| x.get())
}
fn arr(v: [f64; 3]) -> String {
    format!("[{}]", v.map(num).join(","))
}
fn num(x: f64) -> String {
    let x = if x == 0.0 { 0.0 } else { x };
    format!("{x:?}")
}
fn quote(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}
fn point(p: &Placement, v: &Vector3) -> Res<[f64; 3], String> {
    p.apply(xyz(v), 1000., true).map_err(|_| "world-range".to_string())
}
fn dir(p: &Placement, v: &Vector3) -> Res<[f64; 3], String> {
    p.apply(xyz(v), 1., false).map_err(|_| "world-range".to_string())
}
/// The radius scaled to millimetres; only for an isometric placement.
fn radius(p: &Placement, r: &Binary64) -> Res<f64, String> {
    let defect = p.orthonormality_defect().map_err(|_| "world-range".to_string())?;
    if defect > UNIT_DEFECT {
        return Err("non-isometric-placement".into());
    }
    Ok(r.get() * 1000.)
}
fn limit(l: &Limit) -> String {
    match l {
        Limit::Finite { value, .. } => num(value.get()),
        _ => "null".into(),
    }
}
fn frame_of(body: &Body, id: FrameId, frames: &mut Frames) -> Res<Placement, String> {
    frame_placement(body, id, frames)
}
fn axes(p: &Placement, origin: &Vector3, axis: &Vector3, x: &Vector3) -> Res<String, String> {
    Ok(format!(
        "\"origin\":{},\"axis\":{},\"x\":{}",
        arr(point(p, origin)?),
        arr(dir(p, axis)?),
        arr(dir(p, x)?)
    ))
}

fn surface(body: &Body, s: &Surface, frames: &mut Frames) -> Res<String, String> {
    let p = frame_of(body, s.frame, frames)?;
    Ok(match &s.geometry {
        SurfaceGeometry::Plane { origin, normal, x } => {
            let n = p.cofactor_observed(xyz(normal)).map_err(|_| "world-range".to_string())?;
            if n.iter().any(|v| !v.is_finite()) {
                return Err("world-range".into());
            }
            format!("\"kind\":\"plane\",\"origin\":{},\"normal\":{},\"x\":{}", arr(point(&p, origin)?), arr(n), arr(dir(&p, x)?))
        }
        SurfaceGeometry::Cylinder { origin, axis, x, radius: r } => {
            format!("\"kind\":\"cylinder\",{},\"radiusMm\":{}", axes(&p, origin, axis, x)?, num(radius(&p, r)?))
        }
        SurfaceGeometry::Sphere { origin, axis, x, radius: r } => {
            format!("\"kind\":\"sphere\",{},\"radiusMm\":{}", axes(&p, origin, axis, x)?, num(radius(&p, r)?))
        }
        SurfaceGeometry::Torus { origin, axis, x, major, minor } => format!(
            "\"kind\":\"torus\",{},\"majorMm\":{},\"minorMm\":{}",
            axes(&p, origin, axis, x)?,
            num(radius(&p, major)?),
            num(radius(&p, minor)?)
        ),
        SurfaceGeometry::ConeSlope { origin, axis, x, radius: r, slope } => format!(
            "\"kind\":\"cone-slope\",{},\"radiusMm\":{},\"slope\":{}",
            axes(&p, origin, axis, x)?,
            num(radius(&p, r)?),
            num(slope.get())
        ),
        SurfaceGeometry::Cone { origin, axis, x, radius: r, angle } => format!(
            "\"kind\":\"cone\",{},\"radiusMm\":{},\"angleRad\":{}",
            axes(&p, origin, axis, x)?,
            num(radius(&p, r)?),
            num(angle.get())
        ),
        SurfaceGeometry::ConeMeridian { origin, axis, x, start, end } => format!(
            "\"kind\":\"cone-meridian\",{},\"startMm\":[{},{}],\"endMm\":[{},{}]",
            axes(&p, origin, axis, x)?,
            num(radius(&p, &start[0])?),
            num(start[1].get() * 1000.),
            num(radius(&p, &end[0])?),
            num(end[1].get() * 1000.)
        ),
        SurfaceGeometry::LinearExtrusion { .. } => return Err("linear-extrusion-unsupported".into()),
    })
}

fn curve(body: &Body, c: &Curve, domain: &Domain, frames: &mut Frames) -> Res<String, String> {
    let p = frame_of(body, c.frame, frames)?;
    let arc = |a: &ArcKind| match a {
        ArcKind::Full {} => "full",
        ArcKind::Trimmed {} => "trimmed",
    };
    let span = format!("\"domain\":[{},{}]", limit(&domain.lower), limit(&domain.upper));
    Ok(match &c.geometry {
        CurveGeometry::Line { a, b } => {
            format!("\"kind\":\"line\",\"a\":{},\"b\":{},{}", arr(point(&p, a)?), arr(point(&p, b)?), span)
        }
        CurveGeometry::Circle { origin, normal, x, radius: r, arc: a } => format!(
            "\"kind\":\"circle\",\"origin\":{},\"normal\":{},\"x\":{},\"radiusMm\":{},\"arc\":\"{}\",{}",
            arr(point(&p, origin)?),
            arr(dir(&p, normal)?),
            arr(dir(&p, x)?),
            num(radius(&p, r)?),
            arc(a),
            span
        ),
        CurveGeometry::Ellipse { origin, normal, x, major, minor, arc: a } => format!(
            "\"kind\":\"ellipse\",\"origin\":{},\"normal\":{},\"x\":{},\"majorMm\":{},\"minorMm\":{},\"arc\":\"{}\",{}",
            arr(point(&p, origin)?),
            arr(dir(&p, normal)?),
            arr(dir(&p, x)?),
            num(radius(&p, major)?),
            num(radius(&p, minor)?),
            arc(a),
            span
        ),
        CurveGeometry::VectorEllipse { origin, cosine, sine, arc: a } => format!(
            "\"kind\":\"vector-ellipse\",\"origin\":{},\"cosine\":{},\"sine\":{},\"arc\":\"{}\",{}",
            arr(point(&p, origin)?),
            arr(dir(&p, cosine)?.map(|v| v * 1000.)),
            arr(dir(&p, sine)?.map(|v| v * 1000.)),
            arc(a),
            span
        ),
        CurveGeometry::SphereCircle { origin, normal, x, sphere_radius, height } => {
            let (r, h) = (sphere_radius.get(), height.get());
            let ring = radius(&p, &Binary64::new((r * r - h * h).max(0.).sqrt()).map_err(|_| "world-range".to_string())?)?;
            let n = dir(&p, normal)?;
            let o = point(&p, origin)?;
            let o = [0, 1, 2].map(|k| o[k] + n[k] * h * 1000.);
            format!(
                "\"kind\":\"circle\",\"origin\":{},\"normal\":{},\"x\":{},\"radiusMm\":{},\"arc\":\"full\",{}",
                arr(o),
                arr(n),
                arr(dir(&p, x)?),
                num(ring),
                span
            )
        }
        CurveGeometry::ConstructionCurve { .. } => return Err("boolean/ssi-row-unavailable:construction-curve/carrier".into()),
        CurveGeometry::ConstructionLine { .. } => return Err("construction-line-endpoints-only".into()),
        CurveGeometry::CylinderIntersection { .. } => return Err("cylinder-intersection-unsupported".into()),
        CurveGeometry::Parabola { .. } => return Err("parabola-unsupported".into()),
        CurveGeometry::Hyperbola { .. } => return Err("hyperbola-unsupported".into()),
        CurveGeometry::Trace { .. } => return Err("trace-unsupported".into()),
        CurveGeometry::BSpline { .. } => return Err("bspline-unsupported".into()),
    })
}

/// JSON `wonky-carriers/1` for one body: `faces[i]`/`edges[i]` are WC0 ids.
pub fn describe(body: &Body) -> String {
    let mut frames = Frames::new();
    let entry = |index: usize, extra: String, result: Res<String, String>| match result {
        Ok(fields) => format!("{{\"index\":{index},{extra}{fields}}}"),
        Err(why) => format!("{{\"index\":{index},{extra}\"refused\":{}}}", quote(&format!("carriers/{why}"))),
    };
    let faces: Vec<String> = body
        .faces
        .iter()
        .enumerate()
        .map(|(k, f)| {
            let extra = format!("\"surface\":{},\"forward\":{},", f.surface.0, f.forward);
            let result = match body.surfaces.get(f.surface.0 as usize) {
                Some(s) => surface(body, s, &mut frames),
                None => Err("surface-reference".into()),
            };
            entry(k, extra, result)
        })
        .collect();
    let edges: Vec<String> = body
        .edges
        .iter()
        .enumerate()
        .map(|(k, e)| {
            let extra = format!("\"curve\":{},", e.curve.0);
            let result = match body.curves.get(e.curve.0 as usize) {
                Some(c) => curve(body, c, &e.domain, &mut frames),
                None => Err("curve-reference".into()),
            };
            entry(k, extra, result)
        })
        .collect();
    format!("{{\"schema\":\"wonky-carriers/1\",\"faces\":[{}],\"edges\":[{}]}}", faces.join(","), edges.join(","))
}
