//! Analytic periodic STEP charts. Seams exist only in the STEP projection.
use crate::{
    axial::{no, Axial, R},
    sphere_step::{bound, pcurve, placement},
    step::{real, Writer},
};
use wonky_num::{Iv, Scalar};
impl Axial {
    pub(crate) fn chart_vertices_mm(&self) -> R<Vec<[f64; 3]>> {
        self.body
            .vertices
            .iter()
            .map(|v| {
                self.frame
                    .apply(v.point.map(|x| x.get()), 1000., true)
                    .map_err(|_| no("export-range"))
            })
            .collect()
    }
}
pub(crate) fn append(w: &mut Writer, id: &str, a: &Axial) -> R<String> {
    append_ordered(w, id, a, false)
}
pub(crate) fn append_cylinder(w: &mut Writer, id: &str, c: &crate::cylinder::Cylinder) -> R<String> {
    append_ordered(w, id, &crate::axial::from_cylinder(c)?, true)
}
fn append_ordered(w: &mut Writer, id: &str, a: &Axial, caps_first: bool) -> R<String> {
    a.metric().tolerance_mm()?;
    let normalize = |v: [f64; 3]| {
        let n = v[0].norm3(v[1], v[2]);
        v.map(|x| x / n)
    };
    let z = normalize(a.frame.z);
    let y = normalize([
        z[1] * a.frame.x[2] - z[2] * a.frame.x[1],
        z[2] * a.frame.x[0] - z[0] * a.frame.x[2],
        z[0] * a.frame.x[1] - z[1] * a.frame.x[0],
    ]);
    let x = [
        y[1] * z[2] - y[2] * z[1],
        y[2] * z[0] - y[0] * z[2],
        y[0] * z[1] - y[1] * z[0],
    ];
    let center = a
        .frame
        .apply(a.center, 1000., true)
        .map_err(|_| no("export-range"))?;
    let axis = placement(w, center, z, x);
    let radius = a.radius * 1000.;
    let cylinder = w.entity(format!("CYLINDRICAL_SURFACE('',{axis},{})", real(radius)));
    let sphere = if let Some(r) = a.outer {
        Some(w.entity(format!("SPHERICAL_SURFACE('',{axis},{})", real(r * 1000.))))
    } else {
        None
    };
    let context = w.entity(
        "(GEOMETRIC_REPRESENTATION_CONTEXT(2) REPRESENTATION_CONTEXT('','surface parameters'))"
            .into(),
    );
    let tau = (wonky_validated::pi(1e-14)
        .map_err(|_| no("validated-pi"))?
        .ball()
        * Iv::point(2.))
    .m;
    let vertices = a
        .chart_vertices_mm()?
        .into_iter()
        .map(|p| {
            let p = w.point(p);
            w.entity(format!("VERTEX_POINT('',{p})"))
        })
        .collect::<Vec<_>>();
    let mut rings = Vec::new();
    let mut planes = Vec::new();
    for i in 0..2 {
        let h = a.levels[i];
        let mut c = a.center;
        c[2] = crate::axial::exact_add(c[2], h)?;
        let c = a
            .frame
            .apply(c, 1000., true)
            .map_err(|_| no("export-range"))?;
        let place = placement(w, c, z, x);
        let circle = w.entity(format!("CIRCLE('',{place},{})", real(radius)));
        let cp = pcurve(w, &cylinder, &context, [0., h * 1000.], [1., 0.]);
        let other = if let Some(ref s) = sphere {
            let latitude = wonky_validated::atan2(Iv::point(h), Iv::point(a.radius), 1e-13)
                .map_err(|_| no("validated-latitude"))?
                .ball();
            // Angular projection error is included in the 64 eps extent budget.
            if latitude.r > 32. * f64::EPSILON {
                return Err(no("latitude-export-budget"));
            }
            pcurve(w, s, &context, [0., latitude.m], [1., 0.])
        } else {
            let plane = w.entity(format!("PLANE('',{place})"));
            planes.push(plane.clone());
            let o = w.entity("CARTESIAN_POINT('',(0.,0.))".into());
            let d = w.entity("DIRECTION('',(1.,0.))".into());
            let place = w.entity(format!("AXIS2_PLACEMENT_2D('',{o},{d})"));
            let c = w.entity(format!("CIRCLE('',{place},{})", real(radius)));
            let rep = w.entity(format!("DEFINITIONAL_REPRESENTATION('',({c}),{context})"));
            w.entity(format!("PCURVE('',{plane},{rep})"))
        };
        let curve = w.entity(format!(
            "SURFACE_CURVE('',{circle},({cp},{other}),.CURVE_3D.)"
        ));
        rings.push(w.entity(format!("EDGE_CURVE('',{0},{0},{curve},.T.)", vertices[i])));
    }
    let mut at = a.center;
    at[0] = crate::axial::exact_add(at[0], a.radius)?;
    let at = a
        .frame
        .apply(at, 1000., true)
        .map_err(|_| no("export-range"))?;
    let point = w.point(at);
    let dir = w.direction(z);
    let vector = w.entity(format!("VECTOR('',{dir},1.)"));
    let line = w.entity(format!("LINE('',{point},{vector})"));
    let c0 = pcurve(w, &cylinder, &context, [0., 0.], [0., 1.]);
    let c1 = pcurve(w, &cylinder, &context, [tau, 0.], [0., 1.]);
    let seam = w.entity(format!("SEAM_CURVE('',{line},({c0},{c1}),.CURVE_3D.)"));
    let seam = w.entity(format!(
        "EDGE_CURVE('',{},{},{seam},.T.)",
        vertices[0], vertices[1]
    ));
    let forward = a.outer.is_none();
    let b = bound(
        w,
        &[
            (&rings[0], forward),
            (&seam, true),
            (&rings[1], !forward),
            (&seam, false),
        ],
    );
    let mut faces = vec![w.entity(format!(
        "ADVANCED_FACE('',({b}),{cylinder},{})",
        if forward { ".T." } else { ".F." }
    ))];
    if let Some(surface) = sphere {
        let place = placement(w, center, y.map(|v| -v), x);
        let meridian = w.entity(format!(
            "CIRCLE('',{place},{})",
            real(a.outer.unwrap() * 1000.)
        ));
        let s0 = pcurve(w, &surface, &context, [0., 0.], [0., 1.]);
        let s1 = pcurve(w, &surface, &context, [tau, 0.], [0., 1.]);
        let seam = w.entity(format!("SEAM_CURVE('',{meridian},({s0},{s1}),.CURVE_3D.)"));
        let seam = w.entity(format!(
            "EDGE_CURVE('',{},{},{seam},.T.)",
            vertices[0], vertices[1]
        ));
        let b = bound(
            w,
            &[
                (&rings[0], true),
                (&seam, true),
                (&rings[1], false),
                (&seam, false),
            ],
        );
        faces.push(w.entity(format!("ADVANCED_FACE('',({b}),{surface},.T.)")));
    } else {
        for i in 0..2 {
            let b = bound(w, &[(&rings[i], i == 1)]);
            faces.push(w.entity(format!(
                "ADVANCED_FACE('',({b}),{},{})",
                planes[i],
                if i == 1 { ".T." } else { ".F." }
            )));
        }
    }
    if caps_first {
        faces.rotate_left(1);
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
