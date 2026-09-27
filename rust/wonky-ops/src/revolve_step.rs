//! AP214 periodic chart for an audited ring torus. The two chart seams are
//! explicit SEAM_CURVEs with analytic 2D LINE pcurves, not solid boundary edges.
use crate::polyhedron::Refused;
use crate::revolve::Torus;
use crate::step::real;
use wonky_num::Iv;

struct Writer {
    lines: Vec<String>,
}
impl Writer {
    fn entity(&mut self, s: String) -> String {
        self.lines.push(format!("#{}={s};", self.lines.len() + 1));
        format!("#{}", self.lines.len())
    }
    fn point(&mut self, p: &[f64]) -> String {
        self.entity(format!(
            "CARTESIAN_POINT('',({}))",
            p.iter().map(|&v| real(v)).collect::<Vec<_>>().join(",")
        ))
    }
    fn direction(&mut self, p: &[f64]) -> String {
        self.entity(format!(
            "DIRECTION('',({}))",
            p.iter().map(|&v| real(v)).collect::<Vec<_>>().join(",")
        ))
    }
    fn placement(&mut self, o: [f64; 3], z: [f64; 3], x: [f64; 3]) -> String {
        let (o, z, x) = (self.point(&o), self.direction(&z), self.direction(&x));
        self.entity(format!("AXIS2_PLACEMENT_3D('',{o},{z},{x})"))
    }
    fn pcurve(&mut self, surface: &str, context: &str, p: [f64; 2], d: [f64; 2]) -> String {
        let p = self.point(&p);
        let d = self.direction(&d);
        let v = self.entity(format!("VECTOR('',{d},1.)"));
        let l = self.entity(format!("LINE('',{p},{v})"));
        let r = self.entity(format!("DEFINITIONAL_REPRESENTATION('',({l}),{context})"));
        self.entity(format!("PCURVE('',{surface},{r})"))
    }
}
fn text(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c == '\'' {
                "''".into()
            } else if (' '..='~').contains(&c) {
                c.to_string()
            } else {
                "_".into()
            }
        })
        .collect()
}

pub fn write(bodies: &[(String, &Torus)], name: &str) -> Result<String, Refused> {
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
    let mut budget = 0.0f64;
    for (_, t) in bodies {
        budget = budget.max(t.tolerance_mm()?);
    }
    let unc=w.entity(format!("UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE({}),{mm},'distance_accuracy_value','analytic chart export rounding')",real(budget)));
    let ctx=w.entity(format!("(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT(({unc})) GLOBAL_UNIT_ASSIGNED_CONTEXT(({mm},{rad},{sr})) REPRESENTATION_CONTEXT('','3D'))"));
    let ctx2=w.entity("(GEOMETRIC_REPRESENTATION_CONTEXT(2) REPRESENTATION_CONTEXT('','torus angular parameters'))".into());
    let mut items = vec![w.placement([0.; 3], [0., 0., 1.], [1., 0., 0.])];
    let map_err = |_| Refused("revolve/export-range".into());
    for (id, t) in bodies {
        let columns = t.frame.columns().map_err(map_err)?;
        let center = t.center_mm()?;
        let place = w.placement(center, t.frame.z, t.frame.x);
        let major = Iv::point(t.major) * Iv::point(1000.);
        let minor = Iv::point(t.minor) * Iv::point(1000.);
        if major.is_nan() || minor.is_nan() {
            return Err(Refused("revolve/export-range".into()));
        }
        let surface = w.entity(format!(
            "TOROIDAL_SURFACE('',{place},{},{})",
            real(major.m),
            real(minor.m)
        ));
        let p = w.point(&t.seam_vertex_mm()?);
        let vertex = w.entity(format!("VERTEX_POINT('',{p})"));
        let outer = major + minor;
        let circle_u = w.entity(format!("CIRCLE('',{place},{})", real(outer.m)));
        let meridian_center = t
            .frame
            .apply([t.major, 0., t.height], 1000., true)
            .map_err(map_err)?;
        let meridian = w.placement(meridian_center, columns[1].map(|x| -x), t.frame.x);
        let circle_v = w.entity(format!("CIRCLE('',{meridian},{})", real(minor.m)));
        // 2π here is a STEP chart endpoint, with rounding covered by the
        // export length budget. Geometry/measurements retain validated π.
        let tau = wonky_validated::pi(1e-14)
            .map_err(|_| Refused("revolve/validated-pi".into()))?
            .ball()
            * Iv::point(2.);
        let p0 = w.pcurve(&surface, &ctx2, [0., 0.], [1., 0.]);
        let p1 = w.pcurve(&surface, &ctx2, [0., tau.m], [1., 0.]);
        let u = w.entity(format!("SEAM_CURVE('',{circle_u},({p0},{p1}),.CURVE_3D.)"));
        let p0 = w.pcurve(&surface, &ctx2, [0., 0.], [0., 1.]);
        let p1 = w.pcurve(&surface, &ctx2, [tau.m, 0.], [0., 1.]);
        let v = w.entity(format!("SEAM_CURVE('',{circle_v},({p0},{p1}),.CURVE_3D.)"));
        let u = w.entity(format!("EDGE_CURVE('',{vertex},{vertex},{u},.T.)"));
        let v = w.entity(format!("EDGE_CURVE('',{vertex},{vertex},{v},.T.)"));
        let uses = [(&u, true), (&v, true), (&u, false), (&v, false)].map(|(e, f)| {
            w.entity(format!(
                "ORIENTED_EDGE('',*,*,{e},{})",
                if f { ".T." } else { ".F." }
            ))
        });
        let lp = w.entity(format!("EDGE_LOOP('',({}))", uses.join(",")));
        let bound = w.entity(format!("FACE_OUTER_BOUND('',{lp},.T.)"));
        let face = w.entity(format!("ADVANCED_FACE('',({bound}),{surface},.T.)"));
        let shell = w.entity(format!("CLOSED_SHELL('',({face}))"));
        items.push(w.entity(format!("MANIFOLD_SOLID_BREP('{}',{shell})", text(id))));
    }
    let rep = w.entity(format!(
        "ADVANCED_BREP_SHAPE_REPRESENTATION('',({}),{ctx})",
        items.join(",")
    ));
    w.entity(format!("SHAPE_DEFINITION_REPRESENTATION({shape},{rep})"));
    Ok(format!("ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('Rust analytic ring torus, chart seams only'),'2;1');\nFILE_NAME('{}.step','',(''),(''),'wonky-kernel','Rust revolve','');\nFILE_SCHEMA(('AUTOMOTIVE_DESIGN'));\nENDSEC;\nDATA;\n{}\nENDSEC;\nEND-ISO-10303-21;\n",text(name),w.lines.join("\n")))
}
