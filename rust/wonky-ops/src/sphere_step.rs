//! Analytic spherical STEP charts. Chart pole vertices and a meridian seam
//! are export-only, never canonical topology. Explicit seam pcurves prevent
//! the reader from fitting a tolerance-expanded replacement meridian.
use crate::{
    polyhedron::Refused,
    sphere::{no, Spherical},
    step::{real, Writer},
};
use wonky_num::{Iv, Scalar};

pub(crate) fn placement(w: &mut Writer, o: [f64; 3], z: [f64; 3], x: [f64; 3]) -> String {
    let (o, z, x) = (w.point(o), w.direction(z), w.direction(x));
    w.entity(format!("AXIS2_PLACEMENT_3D('',{o},{z},{x})"))
}
pub(crate) fn pcurve(w: &mut Writer, surface: &str, context: &str, p: [f64; 2], d: [f64; 2]) -> String {
    let p = w.entity(format!(
        "CARTESIAN_POINT('',({},{}))",
        real(p[0]),
        real(p[1])
    ));
    let d = w.entity(format!("DIRECTION('',({},{}))", real(d[0]), real(d[1])));
    let v = w.entity(format!("VECTOR('',{d},1.)"));
    let line = w.entity(format!("LINE('',{p},{v})"));
    let rep = w.entity(format!(
        "DEFINITIONAL_REPRESENTATION('',({line}),{context})"
    ));
    w.entity(format!("PCURVE('',{surface},{rep})"))
}
pub(crate) fn bound(w: &mut Writer, uses: &[(&str, bool)]) -> String {
    let co = uses
        .iter()
        .map(|(e, f)| {
            w.entity(format!(
                "ORIENTED_EDGE('',*,*,{e},{})",
                if *f { ".T." } else { ".F." }
            ))
        })
        .collect::<Vec<_>>();
    let lp = w.entity(format!("EDGE_LOOP('',({}))", co.join(",")));
    w.entity(format!("FACE_OUTER_BOUND('',{lp},.T.)"))
}
/// Projection consumed by the STEP roundtrip validator, not solid topology.
impl Spherical {
    pub(crate) fn chart_point_mm(&self, direction: [f64; 3]) -> Result<[f64; 3], Refused> {
        let center = self
            .frame
            .apply_exact(self.center, 1000., true)
            .map_err(|_| no("export-range"))?;
        let direction = self
            .frame
            .apply_exact(direction, 1000., false)
            .map_err(|_| no("export-range"))?;
        let mut p = [0.; 3];
        let mut guard = wonky_num::expansion::Guard::new();
        for k in 0..3 {
            let value = wonky_num::expansion::sum(
                &center[k],
                &wonky_num::expansion::mul(&[self.radius], &direction[k], &mut guard),
                &mut guard,
            );
            p[k] = crate::rounding::round(&value).map_err(|_| no("export-range"))?;
        }
        if !guard.exact() {
            return Err(no("export-range"));
        }
        Ok(p)
    }
    pub(crate) fn chart_vertices_mm(&self) -> Result<Vec<[f64; 3]>, Refused> {
        let (z, x) = self.axes();
        Ok(vec![
            self.chart_point_mm(if self.cut.is_some() { x } else { z.map(|v| -v) })?,
            self.chart_point_mm(z)?,
        ])
    }
}
pub(crate) fn append(w: &mut Writer, id: &str, a: &Spherical) -> Result<String, Refused> {
    a.tolerance_mm()?;
    let (local_z, local_x) = a.axes();
    let z = a
        .frame
        .apply(local_z, 1., false)
        .map_err(|_| no("export-range"))?;
    let x = a
        .frame
        .apply(local_x, 1., false)
        .map_err(|_| no("export-range"))?;
    // Orthonormal spherical export chart. The small difference from the exact
    // affine frame is bounded by tolerance_mm, never fed back into decisions.
    let normalize = |v: [f64; 3]| {
        let n = v[0].norm3(v[1], v[2]);
        v.map(|a| a / n)
    };
    let z = normalize(z);
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
    let place = placement(w, a.center_mm()?, z, x);
    let radius = crate::sphere_measure::finite(Iv::point(a.radius) * Iv::point(1000.))?;
    let surface = w.entity(format!("SPHERICAL_SURFACE('',{place},{})", real(radius.m)));
    let ctx = w.entity(
        "(GEOMETRIC_REPRESENTATION_CONTEXT(2) REPRESENTATION_CONTEXT('','surface parameters'))"
            .into(),
    );
    let vertices = a
        .chart_vertices_mm()?
        .iter()
        .map(|&p| {
            let p = w.point(p);
            w.entity(format!("VERTEX_POINT('',{p})"))
        })
        .collect::<Vec<_>>();
    let meridian_place = placement(w, a.center_mm()?, y.map(|v| -v), x);
    let meridian = w.entity(format!("CIRCLE('',{meridian_place},{})", real(radius.m)));
    let tau = (wonky_validated::pi(1e-14)
        .map_err(|_| no("validated-pi"))?
        .ball()
        * Iv::point(2.))
    .m;
    let p0 = pcurve(w, &surface, &ctx, [0., 0.], [0., 1.]);
    let p1 = pcurve(w, &surface, &ctx, [tau, 0.], [0., 1.]);
    let seam = w.entity(format!("SEAM_CURVE('',{meridian},({p0},{p1}),.CURVE_3D.)"));
    let seam = w.entity(format!(
        "EDGE_CURVE('',{},{},{seam},.T.)",
        vertices[0], vertices[1]
    ));
    let mut faces = Vec::new();
    if a.cut.is_some() {
        let circle = w.entity(format!("CIRCLE('',{place},{})", real(radius.m)));
        let plane = w.entity(format!("PLANE('',{place})"));
        let sp = pcurve(w, &surface, &ctx, [0., 0.], [1., 0.]);
        let o = w.entity("CARTESIAN_POINT('',(0.,0.))".into());
        let x = w.entity("DIRECTION('',(1.,0.))".into());
        let axis = w.entity(format!("AXIS2_PLACEMENT_2D('',{o},{x})"));
        let circle2 = w.entity(format!("CIRCLE('',{axis},{})", real(radius.m)));
        let rep = w.entity(format!("DEFINITIONAL_REPRESENTATION('',({circle2}),{ctx})"));
        let pp = w.entity(format!("PCURVE('',{plane},{rep})"));
        let curve = w.entity(format!("SURFACE_CURVE('',{circle},({sp},{pp}),.CURVE_3D.)"));
        let edge = w.entity(format!("EDGE_CURVE('',{0},{0},{curve},.T.)", vertices[0]));
        let b = bound(w, &[(&edge, true), (&seam, true), (&seam, false)]);
        faces.push(w.entity(format!("ADVANCED_FACE('',({b}),{surface},.T.)")));
        let b = bound(w, &[(&edge, false)]);
        faces.push(w.entity(format!("ADVANCED_FACE('',({b}),{plane},.F.)")));
    } else {
        let b = bound(w, &[(&seam, true), (&seam, false)]);
        faces.push(w.entity(format!("ADVANCED_FACE('',({b}),{surface},.T.)")));
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
