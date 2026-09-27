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
use wonky_num::Iv;
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
pub fn write(bodies: &[(String, &Perforated)], name: &str) -> Result<String, Refused> {
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
    for (_, p) in bodies {
        budget = budget.max(p.tolerance_mm()?);
    }
    let unc=w.entity(format!("UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE({}),{mm},'distance_accuracy_value','exact source charts, bounded export rounding')",real(budget)));
    let ctx=w.entity(format!("(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT(({unc})) GLOBAL_UNIT_ASSIGNED_CONTEXT(({mm},{rad},{sr})) REPRESENTATION_CONTEXT('','3D'))"));
    let ctx2 = w.entity(
        "(GEOMETRIC_REPRESENTATION_CONTEXT(2) REPRESENTATION_CONTEXT('','cylinder parameters'))"
            .into(),
    );
    let mut items = vec![w.placement([0.; 3], [0., 0., 1.], [1., 0., 0.])];
    let tau = (wonky_validated::pi(1e-14).map_err(|_| no("pi"))?.ball() * Iv::point(2.)).m;
    for (id, p) in bodies {
        let body = &p.body;
        let map = |v, t| {
            p.base
                .frame
                .apply(v, if t { 1000. } else { 1. }, t)
                .map_err(|_| no("range"))
        };
        let world = crate::cylinder_chart::vertices_mm(body, &p.base.frame)?;
        let points = world.iter().map(|p| w.point(p)).collect::<Vec<_>>();
        let vertices = points
            .iter()
            .map(|p| w.entity(format!("VERTEX_POINT('',{p})")))
            .collect::<Vec<_>>();
        let mut surfaces = Vec::new();
        for s in &body.surfaces {
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
                _ => return Err(no("curve")),
            };
            if matches!(curve.geometry, CurveGeometry::Line { .. }) {
                let sides = curve
                    .supports
                    .iter()
                    .filter(|s| {
                        matches!(
                            body.surfaces[s.surface.0 as usize].geometry,
                            SurfaceGeometry::Cylinder { .. }
                        )
                    })
                    .collect::<Vec<_>>();
                if let [s0, s1] = sides.as_slice() {
                    if s0.surface != s1.surface {
                        return Err(no("seam-support"));
                    }
                    let s = &surfaces[s0.surface.0 as usize];
                    let a = w.pcurve(s, &ctx2, [0., 0.], [0., 1.]);
                    let b = w.pcurve(s, &ctx2, [tau, 0.], [0., 1.]);
                    geometry = w.entity(format!("SEAM_CURVE('',{geometry},({a},{b}),.CURVE_3D.)"));
                }
            }
            edges.push(w.entity(format!(
                "EDGE_CURVE('',{},{},{geometry},.T.)",
                vertices[a], vertices[b]
            )));
        }
        let mut faces = Vec::new();
        for f in &body.faces {
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
        items.push(w.entity(format!("MANIFOLD_SOLID_BREP('{}',{shell})", text(id))));
    }
    let rep = w.entity(format!(
        "ADVANCED_BREP_SHAPE_REPRESENTATION('',({}),{ctx})",
        items.join(",")
    ));
    w.entity(format!("SHAPE_DEFINITION_REPRESENTATION({shape},{rep})"));
    Ok(format!("ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('Rust exact through-hole charts'),'2;1');\nFILE_NAME('{}.step','',(''),(''),'wonky-kernel','Rust perforated','');\nFILE_SCHEMA(('AUTOMOTIVE_DESIGN'));\nENDSEC;\nDATA;\n{}\nENDSEC;\nEND-ISO-10303-21;\n",text(name),w.lines.join("\n")))
}
