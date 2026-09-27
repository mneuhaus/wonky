//! AP214 cylindrical caps/side with an explicit periodic seam. The entity
//! writer and 2D seam associations reuse the revolve strand's analytic chart
//! design. Only export coordinates are rounded; topology stays in source space.
use crate::{
    cylinder::{no, Cylinder},
    polyhedron::Refused,
    step::real,
};
use wonky_num::Iv;
pub(crate) struct Writer {
    pub(crate) lines: Vec<String>,
}
impl Writer {
    pub(crate) fn entity(&mut self, s: String) -> String {
        self.lines.push(format!("#{}={s};", self.lines.len() + 1));
        format!("#{}", self.lines.len())
    }
    pub(crate) fn point(&mut self, p: &[f64]) -> String {
        self.entity(format!(
            "CARTESIAN_POINT('',({}))",
            p.iter().map(|&x| real(x)).collect::<Vec<_>>().join(",")
        ))
    }
    pub(crate) fn direction(&mut self, p: &[f64]) -> String {
        self.entity(format!(
            "DIRECTION('',({}))",
            p.iter().map(|&x| real(x)).collect::<Vec<_>>().join(",")
        ))
    }
    pub(crate) fn placement(&mut self, o: [f64; 3], z: [f64; 3], x: [f64; 3]) -> String {
        let (o, z, x) = (self.point(&o), self.direction(&z), self.direction(&x));
        self.entity(format!("AXIS2_PLACEMENT_3D('',{o},{z},{x})"))
    }
    pub(crate) fn pcurve(&mut self, surface: &str, ctx: &str, p: [f64; 2], d: [f64; 2]) -> String {
        let p = self.point(&p);
        let d = self.direction(&d);
        let v = self.entity(format!("VECTOR('',{d},1.)"));
        let l = self.entity(format!("LINE('',{p},{v})"));
        let r = self.entity(format!("DEFINITIONAL_REPRESENTATION('',({l}),{ctx})"));
        self.entity(format!("PCURVE('',{surface},{r})"))
    }
    fn face(&mut self, surface: &str, uses: &[(&str, bool)], forward: bool) -> String {
        let uses = uses
            .iter()
            .map(|(e, f)| self.entity(format!("ORIENTED_EDGE('',*,*,{e},{})", flag(*f))))
            .collect::<Vec<_>>();
        let lp = self.entity(format!("EDGE_LOOP('',({}))", uses.join(",")));
        let bound = self.entity(format!("FACE_OUTER_BOUND('',{lp},.T.)"));
        self.entity(format!(
            "ADVANCED_FACE('',({bound}),{surface},{})",
            flag(forward)
        ))
    }
}
pub(crate) fn flag(b: bool) -> &'static str {
    if b {
        ".T."
    } else {
        ".F."
    }
}
pub(crate) fn text(s: &str) -> String {
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

pub fn write(bodies: &[(String, &Cylinder)], name: &str) -> Result<String, Refused> {
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
    let mut budget = 0_f64;
    for (_, c) in bodies {
        budget = budget.max(c.tolerance_mm()?);
    }
    let unc=w.entity(format!("UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE({}),{mm},'distance_accuracy_value','analytic cylindrical chart rounding')",real(budget)));
    let ctx=w.entity(format!("(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT(({unc})) GLOBAL_UNIT_ASSIGNED_CONTEXT(({mm},{rad},{sr})) REPRESENTATION_CONTEXT('','3D'))"));
    let ctx2 = w.entity(
        "(GEOMETRIC_REPRESENTATION_CONTEXT(2) REPRESENTATION_CONTEXT('','cylinder parameters'))"
            .into(),
    );
    let mut items = vec![w.placement([0.; 3], [0., 0., 1.], [1., 0., 0.])];
    for (id, c) in bodies {
        let (z, x, _) = c.spec.axes()?;
        let map = |p, t| {
            c.frame
                .apply(p, if t { 1000. } else { 1. }, t)
                .map_err(|_| no("export-range"))
        };
        let (z, x) = (map(z, false)?, map(x, false)?);
        let r = (Iv::point(c.spec.radius) * Iv::point(1000.)).m;
        let mut vertices = Vec::new();
        let mut points = Vec::new();
        for point in crate::cylinder_chart::vertices_mm(&c.body, &c.frame)? {
            let p = w.point(&point);
            vertices.push(w.entity(format!("VERTEX_POINT('',{p})")));
            points.push(p);
        }
        let mut circles = Vec::new();
        let mut planes = Vec::new();
        let mut places = Vec::new();
        for p in [c.spec.bottom, c.spec.top] {
            let place = w.placement(map(p, true)?, z, x);
            planes.push(w.entity(format!("PLANE('',{place})")));
            circles.push(w.entity(format!("CIRCLE('',{place},{})", real(r))));
            places.push(place);
        }
        let side = w.entity(format!("CYLINDRICAL_SURFACE('',{},{})", places[0], real(r)));
        let dir = w.direction(&z);
        let vector = w.entity(format!("VECTOR('',{dir},1.)"));
        let line = w.entity(format!("LINE('',{},{vector})", points[0]));
        // STEP uses radians, WC0 uses turns. Validated pi supplies this export
        // endpoint; its rounding is included in the coordinate export budget.
        let tau = (wonky_validated::pi(1e-14)
            .map_err(|_| no("validated-pi"))?
            .ball()
            * Iv::point(2.))
        .m;
        let p0 = w.pcurve(&side, &ctx2, [0., 0.], [0., 1.]);
        let p1 = w.pcurve(&side, &ctx2, [tau, 0.], [0., 1.]);
        let seam = w.entity(format!("SEAM_CURVE('',{line},({p0},{p1}),.CURVE_3D.)"));
        let bottom = w.entity(format!(
            "EDGE_CURVE('',{0},{0},{1},.T.)",
            vertices[0], circles[0]
        ));
        let top = w.entity(format!(
            "EDGE_CURVE('',{0},{0},{1},.T.)",
            vertices[1], circles[1]
        ));
        let seam = w.entity(format!(
            "EDGE_CURVE('',{},{},{seam},.T.)",
            vertices[0], vertices[1]
        ));
        let bottom_face = w.face(&planes[0], &[(&bottom, false)], false);
        let top_face = w.face(&planes[1], &[(&top, true)], true);
        let side_face = w.face(
            &side,
            &[
                (&bottom, true),
                (&seam, true),
                (&top, false),
                (&seam, false),
            ],
            true,
        );
        let shell = w.entity(format!(
            "CLOSED_SHELL('',({bottom_face},{top_face},{side_face}))"
        ));
        items.push(w.entity(format!("MANIFOLD_SOLID_BREP('{}',{shell})", text(id))));
    }
    let rep = w.entity(format!(
        "ADVANCED_BREP_SHAPE_REPRESENTATION('',({}),{ctx})",
        items.join(",")
    ));
    w.entity(format!("SHAPE_DEFINITION_REPRESENTATION({shape},{rep})"));
    Ok(format!("ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('Rust analytic cylinders, explicit chart seam'),'2;1');\nFILE_NAME('{}.step','',(''),(''),'wonky-kernel','Rust cylinder','');\nFILE_SCHEMA(('AUTOMOTIVE_DESIGN'));\nENDSEC;\nDATA;\n{}\nENDSEC;\nEND-ISO-10303-21;\n",text(name),w.lines.join("\n")))
}
