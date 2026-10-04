//! AP214 conical bands. Radian angles and slant parameters are export-only
//! projections, enclosed before rounding and charged to the source-frame budget.
use crate::{
    chamfer_rim::{no, Conical, R},
    sphere_step::{bound, pcurve, placement},
    step::{real, Writer},
};
use wonky_num::{Iv, Scalar};
pub(crate) fn append(w: &mut Writer, id: &str, c: &Conical) -> R<String> {
    c.tolerance_mm()?;
    let (local_z, local_x, _) = c.source.axes()?;
    let map = |p, t| {
        c.frame
            .apply(p, if t { 1000. } else { 1. }, t)
            .map_err(|_| no("export-range"))
    };
    let normalize = |p: [f64; 3]| {
        let n = p[0].norm3(p[1], p[2]);
        p.map(|v| v / n)
    };
    let z = normalize(map(local_z, false)?);
    let x = map(local_x, false)?;
    let y = normalize([
        z[1] * x[2] - z[2] * x[1],
        z[2] * x[0] - z[0] * x[2],
        z[0] * x[1] - z[1] * x[0],
    ]);
    let x = [
        y[1] * z[2] - y[2] * z[1],
        y[2] * z[0] - y[0] * z[2],
        y[0] * z[1] - y[1] * z[0],
    ];
    let points = crate::cylinder_chart::vertices_mm(&c.body, &c.frame)?;
    let mut vertices = vec![];
    let mut point_ids = vec![];
    for p in &points {
        let p = w.point(*p);
        vertices.push(w.entity(format!("VERTEX_POINT('',{p})")));
        point_ids.push(p);
    }
    let mut circles = vec![];
    let mut places = vec![];
    for (i, ring) in c.rings.iter().enumerate() {
        let place = placement(w, map(c.center(ring.z), true)?, z, x);
        let circle = w.entity(format!(
            "CIRCLE('',{place},{})",
            real((Iv::point(ring.r) * Iv::point(1000.)).m)
        ));
        circles.push(w.entity(format!("EDGE_CURVE('',{0},{0},{circle},.T.)", vertices[i])));
        places.push(place);
    }
    let n = c.rings.len();
    let mut faces = vec![];
    for (i, forward) in [(0, false), (n - 1, true)] {
        let plane = w.entity(format!("PLANE('',{})", places[i]));
        let lp = bound(w, &[(&circles[i], forward)]);
        faces.push(w.entity(format!(
            "ADVANCED_FACE('',({lp}),{plane},{})",
            if forward { ".T." } else { ".F." }
        )));
    }
    let context = w.entity(
        "(GEOMETRIC_REPRESENTATION_CONTEXT(2) REPRESENTATION_CONTEXT('','surface parameters'))"
            .into(),
    );
    let tau = (crate::analytic_pi::pi() * Iv::point(2.)).m;
    for (i, p) in c.rings.windows(2).enumerate() {
        let h = (Iv::point(p[1].z) - Iv::point(p[0].z)) * Iv::point(1000.);
        let dr = (Iv::point(p[1].r) - Iv::point(p[0].r)) * Iv::point(1000.);
        let (surface, start, sign) = if p[0].r == p[1].r {
            (
                w.entity(format!(
                    "CYLINDRICAL_SURFACE('',{},{})",
                    places[i],
                    real(p[0].r * 1000.)
                )),
                0.,
                1.,
            )
        } else {
            let lower = if p[0].r < p[1].r { 0 } else { 1 };
            let sign = if lower == 0 { 1. } else { -1. };
            let angle = wonky_validated::atan2(dr.abs(), h, 1e-14)
                .map_err(|_| no("cone-angle-export"))?
                .ball();
            if angle.r > 64. * f64::EPSILON {
                return Err(no("cone-angle-export-width"));
            }
            let place = placement(w, map(c.center(p[lower].z), true)?, z.map(|v| v * sign), x);
            let surface = w.entity(format!(
                "CONICAL_SURFACE('',{place},{},{})",
                real(p[lower].r * 1000.),
                real(angle.m)
            ));
            (
                surface,
                if lower == 0 {
                    0.
                } else {
                    h.norm3(dr, Iv::point(0.)).m
                },
                sign,
            )
        };
        let direction = normalize(std::array::from_fn(|k| points[i + 1][k] - points[i][k]));
        let d = w.direction(direction);
        let vector = w.entity(format!("VECTOR('',{d},1.)"));
        let line = w.entity(format!("LINE('',{},{vector})", point_ids[i]));
        let p0 = pcurve(w, &surface, &context, [0., start], [0., sign]);
        let p1 = pcurve(w, &surface, &context, [tau, start], [0., sign]);
        let seam = w.entity(format!("SEAM_CURVE('',{line},({p0},{p1}),.CURVE_3D.)"));
        let seam = w.entity(format!(
            "EDGE_CURVE('',{},{},{seam},.T.)",
            vertices[i],
            vertices[i + 1]
        ));
        let lp = bound(
            w,
            &[
                (&circles[i], true),
                (&seam, true),
                (&circles[i + 1], false),
                (&seam, false),
            ],
        );
        faces.push(w.entity(format!("ADVANCED_FACE('',({lp}),{surface},.T.)")));
    }
    let shell = w.entity(format!("CLOSED_SHELL('',({}))", faces.join(",")));
    Ok(w.entity(format!(
        "MANIFOLD_SOLID_BREP('{}',{shell})",
        id.replace('\'', "''")
    )))
}
