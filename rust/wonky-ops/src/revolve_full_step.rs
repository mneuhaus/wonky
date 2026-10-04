//! AP214 projection of exact source meridians. Only here are cone angles
//! observed with validated atan2. Periodic seams are export-only topology.
use crate::{
    revolve_full::{local, no, FullRevolve, R},
    sphere_step::{bound, pcurve, placement},
    step::{real, Writer},
};
use wonky_contract::{CurveGeometry, SurfaceGeometry};
use wonky_num::{Iv, Scalar};
fn normalized(v: [f64; 3]) -> [f64; 3] {
    let n = v[0].norm3(v[1], v[2]);
    v.map(|x| x / n)
}
pub(crate) fn append(w: &mut Writer, id: &str, a: &FullRevolve) -> R<String> {
    a.tolerance_mm()?;
    let map = |p, scale, translate| {
        a.frame
            .apply(p, scale, translate)
            .map_err(|_| no("export-range"))
    };
    let z = normalized(map(local(a.mode, 0., 0., 1.), 1., false)?);
    let rawx = map(local(a.mode, 1., 0., 0.), 1., false)?;
    let y = normalized(std::array::from_fn(|k| {
        z[(k + 1) % 3] * rawx[(k + 2) % 3] - z[(k + 2) % 3] * rawx[(k + 1) % 3]
    }));
    let x =
        std::array::from_fn(|k| y[(k + 1) % 3] * z[(k + 2) % 3] - y[(k + 2) % 3] * z[(k + 1) % 3]);
    let vertices = a
        .world_vertices()?
        .iter()
        .map(|&p| {
            let p = w.point(p);
            w.entity(format!("VERTEX_POINT('',{p})"))
        })
        .collect::<Vec<_>>();
    let mut rings = vec![];
    for (i, c) in a.body.curves.iter().enumerate() {
        let CurveGeometry::Circle { origin, radius, .. } = c.geometry else {
            return Err(no("export-circle"));
        };
        let o = map(origin.map(|v| v.get()), 1000., true)?;
        let place = placement(w, o, z, x);
        let circle = w.entity(format!("CIRCLE('',{place},{})", real(radius.get() * 1000.)));
        rings.push(w.entity(format!("EDGE_CURVE('',{0},{0},{circle},.T.)", vertices[i])));
    }
    let ctx = w.entity(
        "(GEOMETRIC_REPRESENTATION_CONTEXT(2) REPRESENTATION_CONTEXT('','surface parameters'))"
            .into(),
    );
    let tau = (wonky_validated::pi(1e-14)
        .map_err(|_| no("validated-pi"))?
        .ball()
        * Iv::point(2.))
    .m;
    let mut faces = vec![];
    for (f, apex) in a.body.faces.iter().zip(a.apexes()) {
        let uses = f
            .loops
            .iter()
            .map(|l| {
                let c = &a.body.coedges[a.body.loops[l.0 as usize].coedges[0].0 as usize];
                (c.edge.0 as usize, c.forward)
            })
            .collect::<Vec<_>>();
        let geometry = &a.body.surfaces[f.surface.0 as usize].geometry;
        if let SurfaceGeometry::Plane { origin, .. } = geometry {
            let place = placement(w, map(origin.map(|v| v.get()), 1000., true)?, z, x);
            let surface = w.entity(format!("PLANE('',{place})"));
            let mut bounds = vec![];
            for (l, (e, forward)) in f.loops.iter().zip(&uses) {
                let co = w.entity(format!(
                    "ORIENTED_EDGE('',*,*,{},{})",
                    rings[*e],
                    if *forward { ".T." } else { ".F." }
                ));
                let lp = w.entity(format!("EDGE_LOOP('',({co}))"));
                bounds.push(w.entity(format!(
                    "{}('',{lp},.T.)",
                    if a.body.loops[l.0 as usize].outer {
                        "FACE_OUTER_BOUND"
                    } else {
                        "FACE_BOUND"
                    }
                )));
            }
            faces.push(w.entity(format!(
                "ADVANCED_FACE('',({}),{surface},{})",
                bounds.join(","),
                if f.forward { ".T." } else { ".F." }
            )));
            continue;
        }
        // Seam from the meridian segment's first point to its second. An
        // apex is that seam's end vertex; its ring is degenerate and omitted
        // (a STEP reader adds OCCT's degenerated edge there).
        let point = |i: usize| a.body.vertices[i].point.map(|v| v.get());
        let (ring_a, ring_b, pa, pb, va, vb) = match (apex, uses.as_slice()) {
            (None, [(ia, true), (ib, false)]) => (Some(*ia), Some(*ib), point(*ia), point(*ib), vertices[*ia].clone(), vertices[*ib].clone()),
            (Some(h), [(ia, true)]) => {
                let tip = local(a.mode, 0., 0., h);
                let v = w.point(map(tip, 1000., true)?);
                let v = w.entity(format!("VERTEX_POINT('',{v})"));
                (Some(*ia), None, point(*ia), tip, vertices[*ia].clone(), v)
            }
            (Some(h), [(ib, false)]) => {
                let tip = local(a.mode, 0., 0., h);
                let v = w.point(map(tip, 1000., true)?);
                let v = w.entity(format!("VERTEX_POINT('',{v})"));
                (None, Some(*ib), tip, point(*ib), v, vertices[*ib].clone())
            }
            _ => return Err(no("export-periodic-loops")),
        };
        let axial = local(a.mode, 0., 0., 1.);
        let height = |p: [f64; 3]| (0..3).map(|k| p[k] * axial[k]).sum::<f64>();
        let (h0, h1) = (height(pa), height(pb));
        let (surface, axis_sign) = match geometry {
            SurfaceGeometry::Cylinder { radius, .. } => {
                let place = placement(w, map(local(a.mode, 0., 0., h0), 1000., true)?, z, x);
                (
                    w.entity(format!(
                        "CYLINDRICAL_SURFACE('',{place},{})",
                        real(radius.get() * 1000.)
                    )),
                    1.,
                )
            }
            SurfaceGeometry::ConeMeridian { start, end, .. } => {
                let [r0, z0] = start.map(|v| v.get());
                let [r1, z1] = end.map(|v| v.get());
                let dr = Iv::point(r1) - Iv::point(r0);
                let dz = Iv::point(z1) - Iv::point(z0);
                let angle = wonky_validated::atan2(dr.abs(), dz.abs(), 1e-14)
                    .map_err(|_| no("validated-cone-angle"))?
                    .ball();
                // Source radii/heights determine the cone exactly. Its STEP
                // angle is only an observation with a checked angular budget.
                if angle.r > 32. * f64::EPSILON {
                    return Err(no("cone-angle-export-budget"));
                }
                let sign = if (r1 > r0) == (z1 > z0) { 1. } else { -1. };
                let place = placement(
                    w,
                    map(local(a.mode, 0., 0., h0), 1000., true)?,
                    z.map(|v| v * sign),
                    x,
                );
                (
                    w.entity(format!(
                        "CONICAL_SURFACE('',{place},{},{})",
                        real(r0 * 1000.),
                        real(angle.m)
                    )),
                    sign,
                )
            }
            _ => return Err(no("export-carrier")),
        };
        let world0 = map(pa, 1000., true)?;
        let direction = normalized(map(std::array::from_fn(|k| pb[k] - pa[k]), 1., false)?);
        let point = w.point(world0);
        let d = w.direction(direction);
        let vec = w.entity(format!("VECTOR('',{d},1.)"));
        let line = w.entity(format!("LINE('',{point},{vec})"));
        let sense = if h1 > h0 { axis_sign } else { -axis_sign };
        let pc0 = pcurve(w, &surface, &ctx, [0., 0.], [0., sense]);
        let pc1 = pcurve(w, &surface, &ctx, [tau * axis_sign, 0.], [0., sense]);
        let seam = w.entity(format!("SEAM_CURVE('',{line},({pc0},{pc1}),.CURVE_3D.)"));
        let seam = w.entity(format!("EDGE_CURVE('',{va},{vb},{seam},.T.)"));
        let mut uses = vec![];
        if let Some(i) = ring_a {
            uses.push((rings[i].as_str(), true));
        }
        uses.push((seam.as_str(), true));
        if let Some(i) = ring_b {
            uses.push((rings[i].as_str(), false));
        }
        uses.push((seam.as_str(), false));
        let b = bound(w, &uses);
        faces.push(w.entity(format!(
            "ADVANCED_FACE('',({b}),{surface},{})",
            if f.forward { ".T." } else { ".F." }
        )));
    }
    let shell = w.entity(format!("CLOSED_SHELL('',({}))", faces.join(",")));
    let id = id
        .chars()
        .map(|c| {
            if c == '\'' {
                "''".into()
            } else if c.is_ascii_graphic() || c == ' ' {
                c.to_string()
            } else {
                "_".into()
            }
        })
        .collect::<String>();
    Ok(w.entity(format!("MANIFOLD_SOLID_BREP('{id}',{shell})")))
}
