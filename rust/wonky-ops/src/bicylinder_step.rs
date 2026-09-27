//! AP214 boundary export of the exact vector-conic intersection. Only the STEP
//! representation rounds sqrt(2)*r and frame directions; the native carriers
//! retain exact dyadic semiaxis vectors and analytic cylinder pcurves.
use crate::{
    bicylinder::Bicylinder,
    cylinder_step::{flag, text, Writer},
    polyhedron::Refused,
    step::real,
};
use std::result::Result;
use wonky_contract::SurfaceGeometry;
use wonky_num::{Iv, Scalar};
fn no(s: &str) -> Refused {
    Refused(format!("bicylinder/export-{s}"))
}
fn axis(k: usize) -> [f64; 3] {
    let mut p = [0.; 3];
    p[k] = 1.;
    p
}
fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
// STEP has no harmonic 2D curve. Export-only cubic Hermite charts, with the
// analytic fourth-derivative remainder r*h^4/384 and outward arithmetic.
// The exact native harmonic remains authoritative; no polygonal SSI is used.
const PCURVE_BUDGET: f64 = 1e-9; // millimetres after mapping to the cylinder
fn pcurve(
    w: &mut Writer,
    surface: &str,
    ctx: &str,
    r: f64,
    u: f64,
    v: f64,
) -> Result<String, Refused> {
    let pi = wonky_validated::pi(1e-14).map_err(|_| no("pi"))?.ball();
    let mut n = 8usize;
    loop {
        let h = pi / Iv::point(n as f64);
        let rem = Iv::point(r) * h * h * h * h / Iv::point(384.);
        if rem.hi() < PCURVE_BUDGET * 0.25 {
            break;
        }
        n *= 2;
        if n > 4096 {
            return Err(no("pcurve-budget"));
        }
    }
    // Control construction has <32 scalar operations of magnitude at most
    // max(pi,r*pi); this bound also covers knot shifts and midpoint selection.
    // Include the certified pi and sin/cos widths, not only Hermite truncation.
    let rounding =
        Iv::point(r) * (Iv::point(pi.r) + Iv::point(128. * f64::EPSILON) * (pi + Iv::point(1.)));
    if rounding.is_nan() || rounding.hi() > PCURVE_BUDGET * 0.25 {
        return Err(no("pcurve-rounding-budget"));
    }
    let mut points = vec![];
    let mut knots = vec![];
    let value = |theta: f64, end: Option<bool>| -> Result<(f64, f64), Refused> {
        if let Some(top) = end {
            return Ok((0., if top { -1. } else { 1. }));
        }
        let (s, c) =
            wonky_validated::sin_cos(Iv::point(theta), 1e-13).map_err(|_| no("pcurve-trig"))?;
        if (s.width() + c.width()) * r > PCURVE_BUDGET * 0.1 {
            return Err(no("pcurve-trig-width"));
        }
        Ok((s.ball().m, c.ball().m))
    };
    for j in 0..n {
        let a = pi.m * (j as f64) / (n as f64);
        let b = pi.m * ((j + 1) as f64) / (n as f64);
        let h = b - a;
        let (sa, ca) = value(a, if j == 0 { Some(false) } else { None })?;
        let (sb, cb) = value(b, if j + 1 == n { Some(true) } else { None })?;
        let p0 = [u * a, v * r * sa];
        let p1 = [u * b, v * r * sb];
        if j == 0 {
            points.push(w.point(&p0));
        }
        points.push(w.point(&[p0[0] + u * h / 3., p0[1] + v * r * ca * h / 3.]));
        points.push(w.point(&[p1[0] - u * h / 3., p1[1] - v * r * cb * h / 3.]));
        points.push(w.point(&p1));
        knots.push(real(a - pi.m * 0.5));
    }
    knots.push(real(pi.m * 0.5));
    let mult = (0..=n)
        .map(|j| if j == 0 || j == n { "4" } else { "3" })
        .collect::<Vec<_>>();
    let curve=w.entity(format!("B_SPLINE_CURVE_WITH_KNOTS('',3,({}),.UNSPECIFIED.,.F.,.F.,({}),({}),.PIECEWISE_BEZIER_KNOTS.)",points.join(","),mult.join(","),knots.join(",")));
    let rep = w.entity(format!("DEFINITIONAL_REPRESENTATION('',({curve}),{ctx})"));
    Ok(w.entity(format!("PCURVE('',{surface},{rep})")))
}
pub fn write(bodies: &[(String, &Bicylinder)], name: &str) -> Result<String, Refused> {
    let mut w = Writer { lines: vec![] };
    let app = w.entity("APPLICATION_CONTEXT('automotive_design')".into());
    w.entity(format!(
        "APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,{app})"
    ));
    let pc = w.entity(format!("PRODUCT_CONTEXT('',{app},'mechanical')"));
    let product = w.entity(format!("PRODUCT('{0}','{0}','',({pc}))", text(name)));
    let form = w.entity(format!("PRODUCT_DEFINITION_FORMATION('','',{product})"));
    let dc = w.entity(format!(
        "PRODUCT_DEFINITION_CONTEXT('part definition',{app},'design')"
    ));
    let def = w.entity(format!("PRODUCT_DEFINITION('design','',{form},{dc})"));
    let shape = w.entity(format!("PRODUCT_DEFINITION_SHAPE('','',{def})"));
    let mm = w.entity("(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.))".into());
    let rad = w.entity("(NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.))".into());
    let sr = w.entity("(NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT())".into());
    let mut budget = PCURVE_BUDGET;
    for (_, p) in bodies {
        budget = budget.max(p.tolerance_mm()? + PCURVE_BUDGET);
    }
    let unc=w.entity(format!("UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE({}),{mm},'distance_accuracy_value','exact vector-conic boundary; bounded export rounding')",real(budget)));
    let ctx=w.entity(format!("(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT(({unc})) GLOBAL_UNIT_ASSIGNED_CONTEXT(({mm},{rad},{sr})) REPRESENTATION_CONTEXT('','3D'))"));
    let ctx2 = w.entity(
        "(GEOMETRIC_REPRESENTATION_CONTEXT(2) REPRESENTATION_CONTEXT('','cylinder parameters'))"
            .into(),
    );
    let mut items = vec![w.placement([0.; 3], [0., 0., 1.], [1., 0., 0.])];
    for (id, p) in bodies {
        let map = |v, t| {
            p.frame
                .apply(v, if t { 1000. } else { 1. }, t)
                .map_err(|_| no("range"))
        };
        let center = map(p.center, true)?;
        let placement = crate::placement::Placement::from_frames(&p.body, wonky_contract::FrameId(1))
            .map_err(|_| no("frame-range"))?;
        let world = crate::cylinder_chart::vertices_mm(&p.body, &placement)?;
        let vertices = world
            .iter()
            .map(|v| {
                let point = w.point(v);
                w.entity(format!("VERTEX_POINT('',{point})"))
            })
            .collect::<Vec<_>>();
        let mut surfaces = vec![];
        for s in &p.body.surfaces {
            let SurfaceGeometry::Cylinder { axis, x, .. } = &s.geometry else {
                return Err(no("surface"));
            };
            let place = w.placement(
                center,
                map(axis.each_ref().map(|b| b.get()), false)?,
                map(x.each_ref().map(|b| b.get()), false)?,
            );
            surfaces.push(w.entity(format!(
                "CYLINDRICAL_SURFACE('',{place},{})",
                real(p.radius * 1000.)
            )));
        }
        let r = Iv::point(p.radius) * Iv::point(1000.);
        let major = r * Iv::point(2.).sqrt();
        if major.is_nan() {
            return Err(no("ellipse-radius"));
        }
        let (a, b) = ((p.k + 1) % 3, (p.k + 2) % 3);
        let mut edges = vec![];
        for (sa, sb) in [(1., 1.), (1., -1.), (-1., 1.), (-1., -1.)] {
            let mut diagonal = [0.; 3];
            diagonal[a] = sa;
            diagonal[b] = sb;
            // STEP parameter starts at -pi/2 (top), through the chosen sign
            // quadrant at zero, to +pi/2 (bottom), same edge sense as native.
            let place = w.placement(
                center,
                map(cross(axis(p.k), diagonal), false)?,
                map(diagonal, false)?,
            );
            let ellipse = w.entity(format!(
                "ELLIPSE('',{place},{},{})",
                real(major.m),
                real(r.m)
            ));
            let ca = pcurve(&mut w, &surfaces[0], &ctx2, r.m, -sb, sa)?;
            let cb = pcurve(&mut w, &surfaces[1], &ctx2, r.m, sa, sb)?;
            let geometry = w.entity(format!(
                "SURFACE_CURVE('',{ellipse},({ca},{cb}),.CURVE_3D.)"
            ));
            edges.push(w.entity(format!(
                "EDGE_CURVE('',{},{},{geometry},.T.)",
                vertices[0], vertices[1]
            )));
        }
        let mut faces = vec![];
        for face in &p.body.faces {
            let lp = &p.body.loops[face.loops[0].0 as usize];
            let uses = lp
                .coedges
                .iter()
                .map(|u| {
                    let c = &p.body.coedges[u.0 as usize];
                    w.entity(format!(
                        "ORIENTED_EDGE('',*,*,{},{})",
                        edges[c.edge.0 as usize],
                        flag(c.forward)
                    ))
                })
                .collect::<Vec<_>>();
            let lp = w.entity(format!("EDGE_LOOP('',({}))", uses.join(",")));
            let bound = w.entity(format!("FACE_OUTER_BOUND('',{lp},.T.)"));
            faces.push(w.entity(format!(
                "ADVANCED_FACE('',({bound}),{},.T.)",
                surfaces[face.surface.0 as usize]
            )));
        }
        let shell = w.entity(format!("CLOSED_SHELL('',({}))", faces.join(",")));
        items.push(w.entity(format!("MANIFOLD_SOLID_BREP('{}',{shell})", text(id))));
    }
    let rep = w.entity(format!(
        "ADVANCED_BREP_SHAPE_REPRESENTATION('',({}),{ctx})",
        items.join(",")
    ));
    w.entity(format!("SHAPE_DEFINITION_REPRESENTATION({shape},{rep})"));
    Ok(format!("ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('Rust exact vector conics'),'2;1');\nFILE_NAME('{}.step','',(''),(''),'wonky-kernel','Rust bicylinder','');\nFILE_SCHEMA(('AUTOMOTIVE_DESIGN'));\nENDSEC;\nDATA;\n{}\nENDSEC;\nEND-ISO-10303-21;\n",text(name),w.lines.join("\n")))
}
