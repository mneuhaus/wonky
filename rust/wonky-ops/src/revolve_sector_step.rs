//! AP214 analytic sector export from the independently audited solid.
//! World analytic placements are a display approximation of the source affine
//! map, bounded by Sector::tolerance. No chart samples enter this writer.
use crate::{
    polyhedron::Refused,
    revolve_sector::{Sector, ENDS, USES},
    step::real,
};
type R<T> = Result<T, Refused>;
struct Writer {
    lines: Vec<String>,
}
impl Writer {
    fn entity(&mut self, s: String) -> String {
        self.lines.push(format!("#{}={s};", self.lines.len() + 1));
        format!("#{}", self.lines.len())
    }
    fn point(&mut self, p: [f64; 3]) -> String {
        self.entity(format!(
            "CARTESIAN_POINT('',({},{},{}))",
            real(p[0]),
            real(p[1]),
            real(p[2])
        ))
    }
    fn direction(&mut self, p: [f64; 3]) -> String {
        self.entity(format!(
            "DIRECTION('',({},{},{}))",
            real(p[0]),
            real(p[1]),
            real(p[2])
        ))
    }
    fn placement(&mut self, o: [f64; 3], z: [f64; 3], x: [f64; 3]) -> String {
        let (o, z, x) = (self.point(o), self.direction(z), self.direction(x));
        self.entity(format!("AXIS2_PLACEMENT_3D('',{o},{z},{x})"))
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
pub fn write(bodies: &[(String, &Sector)], name: &str) -> R<String> {
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
    let mut budget = 0f64;
    for (_, s) in bodies {
        budget = budget.max(s.tolerance()?);
    }
    let unc=w.entity(format!("UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE({}),{mm},'distance_accuracy_value','analytic affine display rounding')",real(budget)));
    let ctx=w.entity(format!("(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT(({unc})) GLOBAL_UNIT_ASSIGNED_CONTEXT(({mm},{rad},{sr})) REPRESENTATION_CONTEXT('','3D'))"));
    let mut items = vec![w.placement([0.; 3], [0., 0., 1.], [1., 0., 0.])];
    for (id, s) in bodies {
        let map = |p: [f64; 3], translate: bool| {
            s.frame
                .apply(p, if translate { 1000. } else { 1. }, translate)
                .map_err(|_| Refused("revolve/sector/export-range".into()))
        };
        let world = s.world_points()?;
        let local = s.points();
        let points: Vec<_> = world.iter().map(|&p| w.point(p)).collect();
        let vertices: Vec<_> = points
            .iter()
            .map(|p| w.entity(format!("VERTEX_POINT('',{p})")))
            .collect();
        let mut edges = vec![];
        for (i, [a, b]) in ENDS.into_iter().enumerate() {
            let curve = if i < 8 {
                let direction = map(std::array::from_fn(|k| local[b][k] - local[a][k]), false)?;
                let d = w.direction(direction);
                let v = w.entity(format!("VECTOR('',{d},1.)"));
                w.entity(format!("LINE('',{},{v})", points[a]))
            } else {
                let placement =
                    w.placement(map([0., 0., local[a][2]], true)?, s.frame.z, s.frame.x);
                w.entity(format!(
                    "CIRCLE('',{placement},{})",
                    real(local[a][0] * 1000.)
                ))
            };
            edges.push(w.entity(format!(
                "EDGE_CURVE('',{},{},{curve},.T.)",
                vertices[a], vertices[b]
            )));
        }
        let mut faces = vec![];
        for (i, uses) in USES.iter().enumerate() {
            let carrier = if i == 3 || i == 5 {
                let place = w.placement(map([0.; 3], true)?, s.frame.z, s.frame.x);
                w.entity(format!(
                    "CYLINDRICAL_SURFACE('',{place},{})",
                    real(if i == 3 {
                        s.outer * 1000.
                    } else {
                        s.inner * 1000.
                    })
                ))
            } else {
                let (o, x, y) = match i {
                    0 => ([0.; 3], [1., 0., 0.], [0., 0., 1.]),
                    1 => ([0.; 3], [0., 1., 0.], [0., 0., -1.]),
                    2 => ([0., 0., s.bottom], [1., 0., 0.], [0., -1., 0.]),
                    _ => ([0., 0., s.top], [1., 0., 0.], [0., 1., 0.]),
                };
                let (x, y) = (map(x, false)?, map(y, false)?);
                let normal = std::array::from_fn(|k| {
                    x[(k + 1) % 3] * y[(k + 2) % 3] - x[(k + 2) % 3] * y[(k + 1) % 3]
                });
                let place = w.placement(map(o, true)?, normal, x);
                w.entity(format!("PLANE('',{place})"))
            };
            let uses: Vec<_> = uses
                .iter()
                .map(|(e, f)| {
                    w.entity(format!(
                        "ORIENTED_EDGE('',*,*,{},{})",
                        edges[*e],
                        if *f { ".T." } else { ".F." }
                    ))
                })
                .collect();
            let lp = w.entity(format!("EDGE_LOOP('',({}))", uses.join(",")));
            let bound = w.entity(format!("FACE_OUTER_BOUND('',{lp},.T.)"));
            faces.push(w.entity(format!(
                "ADVANCED_FACE('',({bound}),{carrier},{})",
                if i == 5 { ".F." } else { ".T." }
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
    Ok(format!("ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('Rust analytic annular sector'),'2;1');\nFILE_NAME('{}.step','',(''),(''),'wonky-kernel','Rust revolve','');\nFILE_SCHEMA(('AUTOMOTIVE_DESIGN'));\nENDSEC;\nDATA;\n{}\nENDSEC;\nEND-ISO-10303-21;\n",text(name),w.lines.join("\n")))
}
