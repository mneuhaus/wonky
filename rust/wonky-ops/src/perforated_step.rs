//! AP214 for the audited plane/cylinder through-hole boundary. Reuses the
//! cylindrical STEP writer's entity and seam representation, preserving inner
//! cap bounds and the inward orientation of hole walls.
use crate::{
    cylinder_step::{flag, text, Writer},
    perforated::Perforated,
    polyhedron::Refused,
    step::real,
};
use std::result::Result;
use wonky_contract::*;
use wonky_num::{Iv, Scalar};
fn no(s: &str) -> Refused {
    Refused(format!("perforated/export-{s}"))
}
fn get(p: &Vector3) -> [f64; 3] {
    p.each_ref().map(|x| x.get())
}
fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
fn normalized(p: [f64; 3]) -> Result<[f64; 3], Refused> {
    let norm = p[0].hypot(p[1]).hypot(p[2]);
    if !norm.is_finite() || norm == 0. {
        return Err(no("direction"));
    }
    Ok(p.map(|x| x / norm))
}
/// +1 when the cone widens along its axis, else -1 (STEP semi-angles are positive).
fn cone_sign(start: &Vector2, end: &Vector2) -> f64 {
    let ([r0, h0], [r1, h1]) = (start.map(|v| v.get()), end.map(|v| v.get()));
    if (r1 > r0) == (h1 > h0) { 1. } else { -1. }
}
pub fn write(bodies: &[(String, &Perforated)], name: &str) -> Result<String, Refused> {
    let solids = bodies.iter().map(|(id, p)| (id.clone(), crate::step::SolidRef::Perforated(p))).collect::<Vec<_>>();
    crate::step::write_solids(&solids, name)
}

/// Append a replay-audited plane/cylinder boundary, including trimmed arcs.
pub(crate) fn append_boundary(
    w: &mut Writer,
    id: &str,
    body: &Body,
    frame: &crate::placement::Placement,
    planar_base: Option<&crate::polyhedron::Audited>,
) -> Result<String, Refused> {
    let ctx2 = w.entity(
        "(GEOMETRIC_REPRESENTATION_CONTEXT(2) REPRESENTATION_CONTEXT('','cylinder parameters'))"
            .into(),
    );
    let tau = (wonky_validated::pi(1e-14).map_err(|_| no("pi"))?.ball() * Iv::point(2.)).m;
    let map = |v, t| {
        frame
            .apply(v, if t { 1000. } else { 1. }, t)
            .map_err(|_| no("range"))
    };
    let world = crate::cylinder_chart::vertices_mm(body, frame)?;
    let points = world.iter().map(|p| w.point(p)).collect::<Vec<_>>();
    let vertices = points
        .iter()
        .map(|p| w.entity(format!("VERTEX_POINT('',{p})")))
        .collect::<Vec<_>>();
    let mut splines = std::collections::BTreeMap::new();
    for (i, c) in body.curves.iter().enumerate() {
        if let CurveGeometry::BSpline { controls, .. } = &c.geometry {
            let controls = controls.iter().map(|p| map(get(p), true)).collect::<Result<Vec<_>, _>>()?;
            splines.insert(i, crate::step_carrier::emit_spline(w, &c.geometry, &controls)?);
        }
    }
    let mut surfaces = Vec::new();
    for (index, s) in body.surfaces.iter().enumerate() {
        // Drilling leaves the base faces and their outer loops unchanged.
        // Rational-profile side normals are observation caches in WC0; export
        // their authoritative replayed plane, not that rounded normal.
        if let Some(base) = planar_base {
            if let Some(exact) = &base.arrangement {
                if let Some(face) = base.body.faces.iter().find(|f| f.surface.0 as usize == index) {
                    let (o, n, x) = exact.carrier(&base.face_loops[face.loops[0].0 as usize])?;
                    let place = w.placement(o, n, x);
                    surfaces.push(w.entity(format!("PLANE('',{place})")));
                    continue;
                }
            }
        }
        let entity = match &s.geometry {
            SurfaceGeometry::Plane { origin, normal, x } => {
                let wx = map(get(x), false)?;
                let wy = map(cross(get(normal), get(x)), false)?;
                let place = w.placement(
                    map(get(origin), true)?,
                    normalized(cross(wx, wy))?,
                    normalized(wx)?,
                );
                w.entity(format!("PLANE('',{place})"))
            }
            SurfaceGeometry::Cylinder {
                origin,
                axis,
                x,
                radius,
            } => {
                let place = w.placement(
                    map(get(origin), true)?,
                    map(get(axis), false)?,
                    map(get(x), false)?,
                );
                w.entity(format!(
                    "CYLINDRICAL_SURFACE('',{place},{})",
                    real(radius.get() * 1000.)
                ))
            }
            // Two exact rings own the cone; only its STEP semi-angle is an
            // observation (validated atan2 with a checked angular budget).
            // Shared with periodic_face's ring-only cones via cone_frame.
            SurfaceGeometry::ConeMeridian { origin, axis, x, start, end } => {
                let cone = cone_frame(get(origin), get(axis), start, end)?;
                let place = w.placement(
                    map(cone.location, true)?,
                    map(get(axis).map(|v| v * cone.sign), false)?,
                    map(get(x), false)?,
                );
                w.entity(format!(
                    "CONICAL_SURFACE('',{place},{},{})",
                    real(cone.radius * 1000.),
                    real(cone.angle)
                ))
            }
            SurfaceGeometry::LinearExtrusion { curve, direction } => {
                let swept = splines.get(&(curve.0 as usize)).ok_or_else(|| no("swept-curve"))?;
                let d = normalized(map(get(direction), false)?)?;
                let dir = w.direction(&d);
                let v = w.entity(format!("VECTOR('',{dir},1.)"));
                w.entity(format!("SURFACE_OF_LINEAR_EXTRUSION('',{swept},{v})"))
            }
            SurfaceGeometry::Torus{origin,axis,x,major,minor} => {
                let place=w.placement(map(get(origin),true)?,map(get(axis),false)?,map(get(x),false)?);
                w.entity(format!("TOROIDAL_SURFACE('',{place},{},{})",real(major.get()*1000.),real(minor.get()*1000.)))
            }
            _ => return Err(no("surface")),
        };
        surfaces.push(entity);
    }
    let mut edges = Vec::new();
    for e in &body.edges {
        let a = e.vertices[0].0 as usize;
        let b = e.vertices[1].0 as usize;
        let curve = &body.curves[e.curve.0 as usize];
        let mut geometry = match &curve.geometry {
            CurveGeometry::Line { .. } => {
                let d = normalized([0, 1, 2].map(|j| world[b][j] - world[a][j]))?;
                let dir = w.direction(&d);
                let v = w.entity(format!("VECTOR('',{dir},1.)"));
                w.entity(format!("LINE('',{},{v})", points[a]))
            }
            CurveGeometry::Circle {
                origin,
                normal,
                x,
                radius,
                ..
            } => {
                let place = w.placement(
                    map(get(origin), true)?,
                    map(get(normal), false)?,
                    map(get(x), false)?,
                );
                w.entity(format!("CIRCLE('',{place},{})", real(radius.get() * 1000.)))
            }
            CurveGeometry::VectorEllipse { .. } => crate::fillet_step::vector_ellipse(w, frame, &curve.geometry)?,
            CurveGeometry::BSpline { .. } => splines[&(e.curve.0 as usize)].clone(),
            _ => return Err(no("curve")),
        };
        if matches!(curve.geometry, CurveGeometry::VectorEllipse { .. }) {
            if curve.supports.len()!=2 { return Err(no("ellipse-support-count")); }
            let pcs = curve.supports.iter().map(|support| {
                crate::fillet_step::harmonic_pcurve(w, &surfaces[support.surface.0 as usize], &ctx2,
                    &curve.geometry, &body.pcurves[support.pcurve.0 as usize].geometry)
            }).collect::<Result<Vec<_>,_>>()?;
            geometry = w.entity(format!("SURFACE_CURVE('',{geometry},({}),.CURVE_3D.)", pcs.join(",")));
        }
        if matches!(curve.geometry, CurveGeometry::Line { .. }) {
            let sides = curve
                .supports
                .iter()
                .filter(|s| {
                    matches!(
                        body.surfaces[s.surface.0 as usize].geometry,
                        SurfaceGeometry::Cylinder { .. } | SurfaceGeometry::ConeMeridian { .. }
                    )
                })
                .collect::<Vec<_>>();
            match sides.as_slice() {
                [s0, s1] if s0.surface == s1.surface => {
                    // A cone placed against its axis runs v (and u) the other way.
                    let (sense, turn) = match (&body.surfaces[s0.surface.0 as usize].geometry, &curve.geometry) {
                        (SurfaceGeometry::ConeMeridian { axis, start, end, .. }, CurveGeometry::Line { a, b }) => {
                            let sign = cone_sign(start, end);
                            let rise: f64 = (0..3).map(|j| (b[j].get() - a[j].get()) * axis[j].get()).sum();
                            (if rise > 0. { sign } else { -sign }, tau * sign)
                        }
                        _ => (1., tau),
                    };
                    let s = &surfaces[s0.surface.0 as usize];
                    let a = w.pcurve(s, &ctx2, [0., 0.], [0., sense]);
                    let b = w.pcurve(s, &ctx2, [turn, 0.], [0., sense]);
                    geometry = w.entity(format!("SEAM_CURVE('',{geometry},({a},{b}),.CURVE_3D.)"));
                }
                // Distinct supports belong to adjacent strips. This is a
                // shared generator edge, not a periodic seam. Its 3D LINE
                // and the two face loops already describe it exactly.
                [_, _] => {},
                [_, _, _, ..] => return Err(no("seam-support-count")),
                _ => {}
            }
        }
        edges.push(w.entity(format!(
            "EDGE_CURVE('',{},{},{geometry},.T.)",
            vertices[a], vertices[b]
        )));
    }
    let mut faces = Vec::new();
    for f in &body.faces {
        if ring_only_periodic(body, f) {
            let face = periodic_face(w, body, f, &surfaces, &edges, &vertices, &world, &map, tau, &ctx2)?;
            faces.push(face);
            continue;
        }
        let mut bounds = Vec::new();
        for l in &f.loops {
            let lp = &body.loops[l.0 as usize];
            let uses = lp
                .coedges
                .iter()
                .map(|u| {
                    let co = &body.coedges[u.0 as usize];
                    w.entity(format!(
                        "ORIENTED_EDGE('',*,*,{},{})",
                        edges[co.edge.0 as usize],
                        flag(co.forward)
                    ))
                })
                .collect::<Vec<_>>();
            let wire = w.entity(format!("EDGE_LOOP('',({}))", uses.join(",")));
            let kind = if lp.outer {
                "FACE_OUTER_BOUND"
            } else {
                "FACE_BOUND"
            };
            bounds.push(w.entity(format!("{kind}('',{wire},.T.)")));
        }
        faces.push(w.entity(format!(
            "ADVANCED_FACE('',({}),{},{})",
            bounds.join(","),
            surfaces[f.surface.0 as usize],
            flag(f.forward)
        )));
    }
    let shell = w.entity(format!(
        "CLOSED_SHELL('',({}))",
        body.shells[0]
            .faces
            .iter()
            .map(|f| faces[f.0 as usize].as_str())
            .collect::<Vec<_>>()
            .join(",")
    ));
    Ok(w.entity(format!("MANIFOLD_SOLID_BREP('{}',{shell})", text(id))))
}

struct ConeFrame {
    location: [f64; 3],
    sign: f64,
    radius: f64,
    angle: f64,
    reference: f64,
}
/// STEP placement of an exact meridian cone: at its start ring, axis turned
/// so the radius grows along it. The angle is a validated observation.
fn cone_frame(origin: [f64; 3], axis: [f64; 3], start: &Vector2, end: &Vector2) -> Result<ConeFrame, Refused> {
    let [r0, z0] = start.map(|v| v.get());
    let [r1, z1] = end.map(|v| v.get());
    let dr = Iv::point(r1) - Iv::point(r0);
    let dz = Iv::point(z1) - Iv::point(z0);
    let angle = wonky_validated::atan2(dr.abs(), dz.abs(), 1e-14)
        .map_err(|_| no("validated-cone-angle"))?
        .ball();
    if angle.r > 32. * f64::EPSILON {
        return Err(no("cone-angle-budget"));
    }
    Ok(ConeFrame {
        location: std::array::from_fn(|k| origin[k] + z0 * axis[k]),
        sign: if (r1 > r0) == (z1 > z0) { 1. } else { -1. },
        radius: r0,
        angle: angle.m,
        reference: z0,
    })
}
/// A periodic face bounded only by full rings (and possibly an apex): WC0
/// keeps no seam there, STEP needs one. Export-only topology, as for
/// full-turn revolutions.
fn ring_only_periodic(body: &Body, f: &Face) -> bool {
    matches!(
        body.surfaces[f.surface.0 as usize].geometry,
        SurfaceGeometry::Cylinder { .. } | SurfaceGeometry::ConeMeridian { .. }
    ) && f.loops.iter().all(|l| {
        let lp = &body.loops[l.0 as usize];
        lp.coedges.len() == 1 && {
            let e = &body.edges[body.coedges[lp.coedges[0].0 as usize].edge.0 as usize];
            e.vertices[0] == e.vertices[1]
                && matches!(body.curves[e.curve.0 as usize].geometry, CurveGeometry::Circle { .. })
        }
    })
}
#[allow(clippy::too_many_arguments)]
fn periodic_face(
    w: &mut Writer,
    body: &Body,
    f: &Face,
    surfaces: &[String],
    edges: &[String],
    vertices: &[String],
    world: &[[f64; 3]],
    map: &dyn Fn([f64; 3], bool) -> Result<[f64; 3], Refused>,
    tau: f64,
    ctx: &str,
) -> Result<String, Refused> {
    let (origin, axis, sign, reference, apex) = match &body.surfaces[f.surface.0 as usize].geometry {
        SurfaceGeometry::Cylinder { origin, axis, .. } => {
            // Placed at its own origin: the chart height is the ring height.
            (get(origin), get(axis), 1., 0., None)
        }
        SurfaceGeometry::ConeMeridian { origin, axis, start, end, .. } => {
            let (o, a) = (get(origin), get(axis));
            let cone = cone_frame(o, a, start, end)?;
            let apex = if start[0].get() == 0. {
                Some((start[1].get(), true))
            } else if end[0].get() == 0. {
                Some((end[1].get(), false))
            } else {
                None
            };
            (o, a, cone.sign, cone.reference, apex)
        }
        _ => return Err(no("periodic-surface")),
    };
    // (edge, sense, vertex, axial height) of each ring in WC0 loop order.
    let rings = f
        .loops
        .iter()
        .map(|l| {
            let co = &body.coedges[body.loops[l.0 as usize].coedges[0].0 as usize];
            let e = &body.edges[co.edge.0 as usize];
            let CurveGeometry::Circle { origin: c, .. } = &body.curves[e.curve.0 as usize].geometry else {
                return Err(no("periodic-ring"));
            };
            let c = get(c);
            let h = (0..3).map(|k| (c[k] - origin[k]) * axis[k]).sum::<f64>();
            Ok((co.edge.0 as usize, co.forward, e.vertices[0].0 as usize, h))
        })
        .collect::<Result<Vec<_>, Refused>>()?;
    let tip = |w: &mut Writer, h: f64| -> Result<(String, [f64; 3]), Refused> {
        let p = map(std::array::from_fn(|k| origin[k] + h * axis[k]), true)?;
        let point = w.point(p);
        Ok((w.entity(format!("VERTEX_POINT('',{point})")), p))
    };
    // Seam from end A to end B: two rings in loop order, or ring and apex.
    let (a, b) = match (rings.as_slice(), apex) {
        ([ra, rb], None) => (Some(*ra), Some(*rb)),
        ([r], Some((_, true))) => (None, Some(*r)),
        ([r], Some((_, false))) => (Some(*r), None),
        _ => return Err(no("periodic-loops")),
    };
    let end = |w: &mut Writer, ring: Option<(usize, bool, usize, f64)>| -> Result<(String, [f64; 3], f64), Refused> {
        match ring {
            Some((_, _, v, h)) => Ok((vertices[v].clone(), world[v], h)),
            None => {
                let h = apex.ok_or_else(|| no("periodic-loops"))?.0;
                let (v, p) = tip(w, h)?;
                Ok((v, p, h))
            }
        }
    };
    let (va, pa, ha) = end(w, a)?;
    let (vb, pb, hb) = end(w, b)?;
    let d = normalized([0, 1, 2].map(|j| pb[j] - pa[j]))?;
    let (point, dir) = (w.point(pa), w.direction(d));
    let vec = w.entity(format!("VECTOR('',{dir},1.)"));
    let line = w.entity(format!("LINE('',{point},{vec})"));
    let surface = &surfaces[f.surface.0 as usize];
    let v0 = (ha - reference) * 1000. * sign;
    let sense = if hb > ha { sign } else { -sign };
    let pc0 = w.pcurve(surface, ctx, [0., v0], [0., sense]);
    let pc1 = w.pcurve(surface, ctx, [tau * sign, v0], [0., sense]);
    let seam = w.entity(format!("SEAM_CURVE('',{line},({pc0},{pc1}),.CURVE_3D.)"));
    let seam = w.entity(format!("EDGE_CURVE('',{va},{vb},{seam},.T.)"));
    let mut uses: Vec<(&str, bool)> = vec![];
    if let Some((e, forward, _, _)) = a {
        uses.push((edges[e].as_str(), forward));
    }
    uses.push((seam.as_str(), true));
    if let Some((e, forward, _, _)) = b {
        uses.push((edges[e].as_str(), forward));
    }
    uses.push((seam.as_str(), false));
    Ok(w.face(surface, &uses, f.forward))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn planted_third_periodic_support_is_refused() {
        let cylinder = crate::cylinder::audit(
            &crate::cylinder::create(
                BodyKey { id: [1, 2, 3, 4], revision: 0 },
                crate::cylinder::Spec { bottom: [0., 0., 0.], top: [0., 0., 0.01], radius: 0.005 },
            ).unwrap().check().unwrap(),
        ).unwrap();
        let mut body = cylinder.body.clone();
        let curve = body.curves.iter_mut().find(|c| {
            matches!(c.geometry, CurveGeometry::Line { .. }) && c.supports.len() == 2
        }).expect("cylinder generator seam");
        curve.supports.push(curve.supports[0].clone());
        let mut writer = Writer { lines: vec![] };
        assert_eq!(append_boundary(&mut writer, "corrupt", &body, &cylinder.frame, None)
            .unwrap_err().0, "perforated/export-seam-support-count");
    }
}
