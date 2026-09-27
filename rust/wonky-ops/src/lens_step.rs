//! Budgeted analytic STEP projection of an exact radical-circle lens.
use crate::{
    lens::{axis, no, Lens},
    polyhedron::Refused,
    sphere_step::{bound, pcurve, placement},
    step::{real, Writer},
};
use wonky_num::{Iv, Scalar};
pub(crate) fn append(w: &mut Writer, id: &str, a: &Lens) -> Result<String, Refused> {
    let tolerance = a.tolerance_mm()?;
    let normalize = |v: [f64; 3]| {
        let n = v[0].norm3(v[1], v[2]);
        v.map(|x| x / n)
    };
    let z = normalize(
        a.frame
            .apply(axis(a.axis), 1., false)
            .map_err(|_| no("export-range"))?,
    );
    let x = a
        .frame
        .apply(axis((a.axis + 1) % 3), 1., false)
        .map_err(|_| no("export-range"))?;
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
    let r = Iv::point(a.radius) * Iv::point(1000.);
    let ring = a.ring()? * Iv::point(1000.);
    let latitude = wonky_validated::atan2(Iv::point(a.half), a.ring()?, 1e-14)
        .map_err(|_| no("validated-latitude"))?
        .ball();
    if latitude.r * r.hi() > tolerance || ring.r > tolerance {
        return Err(no("chart-export-budget"));
    }
    let tau = (wonky_validated::pi(1e-14)
        .map_err(|_| no("validated-pi"))?
        .ball()
        * Iv::point(2.))
    .m;
    let context = w.entity(
        "(GEOMETRIC_REPRESENTATION_CONTEXT(2) REPRESENTATION_CONTEXT('','surface parameters'))"
            .into(),
    );
    let mut surfaces = Vec::new();
    let mut centers = Vec::new();
    for center in a.centers {
        let center = a
            .frame
            .apply(center, 1000., true)
            .map_err(|_| no("export-range"))?;
        centers.push(center);
        let place = placement(w, center, z, x);
        surfaces.push(w.entity(format!("SPHERICAL_SURFACE('',{place},{})", real(r.m))));
    }
    let center = a.metric().center_mm()?;
    let place = placement(w, center, z, x);
    let circle = w.entity(format!("CIRCLE('',{place},{})", real(ring.m)));
    let cp0 = pcurve(w, &surfaces[0], &context, [0., latitude.m], [1., 0.]);
    let cp1 = pcurve(w, &surfaces[1], &context, [0., -latitude.m], [1., 0.]);
    let curve = w.entity(format!(
        "SURFACE_CURVE('',{circle},({cp0},{cp1}),.CURVE_3D.)"
    ));
    let vertices = a
        .chart_vertices_mm()?
        .into_iter()
        .map(|p| {
            let p = w.point(p);
            w.entity(format!("VERTEX_POINT('',{p})"))
        })
        .collect::<Vec<_>>();
    let edge = w.entity(format!("EDGE_CURVE('',{0},{0},{curve},.T.)", vertices[0]));
    let mut faces = Vec::new();
    for i in 0..2 {
        let place = placement(w, centers[i], y.map(|v| -v), x);
        let meridian = w.entity(format!("CIRCLE('',{place},{})", real(r.m)));
        let p0 = pcurve(w, &surfaces[i], &context, [0., 0.], [0., 1.]);
        let p1 = pcurve(w, &surfaces[i], &context, [tau, 0.], [0., 1.]);
        let seam = w.entity(format!("SEAM_CURVE('',{meridian},({p0},{p1}),.CURVE_3D.)"));
        let (from, to) = if i == 0 { (0, 1) } else { (2, 0) };
        let seam = w.entity(format!(
            "EDGE_CURVE('',{},{},{seam},.T.)",
            vertices[from], vertices[to]
        ));
        let b = bound(w, &[(&edge, i == 0), (&seam, i == 0), (&seam, i != 0)]);
        faces.push(w.entity(format!("ADVANCED_FACE('',({b}),{},.T.)", surfaces[i])));
    }
    let shell = w.entity(format!("CLOSED_SHELL('',({}))", faces.join(",")));
    let name = id
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
    Ok(w.entity(format!("MANIFOLD_SOLID_BREP('{name}',{shell})")))
}
