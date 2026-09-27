//! Planar AP214 STEP writer for audited WC0 bodies (the planar subset of ST1).
//!
//! Coordinates are world millimetres: each is the correctly rounded exact image
//! of a source coordinate under the body's frame (`affine`), printed with the
//! shortest digits that round-trip. The export budget (distance of a written
//! vertex from its exact image) is stated in the header and in the
//! uncertainty measure. There is no +-10,000 mm envelope: the magnitude limit
//! is the WC0 domain (docs/rust-wire-v3.md), not a Bend F32 limit.
use crate::polyhedron::{Audited, Refused};
use wonky_contract::*;
use std::result::Result;

/// STEP REAL with shortest round-trip digits.
pub fn real(x: f64) -> String {
    let x = if x == 0.0 { 0.0 } else { x };
    let s = format!("{x:?}");
    match s.split_once('e') {
        Some((mantissa, exponent)) => {
            let mantissa = if mantissa.contains('.') { mantissa.to_string() } else { format!("{mantissa}.") };
            format!("{mantissa}E{exponent}")
        }
        None if s.contains('.') => s,
        None => format!("{s}."),
    }
}

fn text(s: &str) -> String {
    s.chars().map(|c| if c == '\'' { "''".to_string() } else if (' '..='~').contains(&c) { c.to_string() } else { "_".to_string() }).collect()
}

pub(crate) struct Writer {
    lines: Vec<String>,
}
impl Writer {
    pub(crate) fn entity(&mut self, e: String) -> String {
        self.lines.push(format!("#{}={};", self.lines.len() + 1, e));
        format!("#{}", self.lines.len())
    }
    pub(crate) fn point(&mut self, p: [f64; 3]) -> String {
        self.entity(format!("CARTESIAN_POINT('',({},{},{}))", real(p[0]), real(p[1]), real(p[2])))
    }
    pub(crate) fn direction(&mut self, d: [f64; 3]) -> String {
        self.entity(format!("DIRECTION('',({},{},{}))", real(d[0]), real(d[1]), real(d[2])))
    }
}

fn normalized(d: [f64; 3]) -> Result<[f64; 3], Refused> {
    let n = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt();
    if !(n > 0.0 && n.is_finite()) {
        return Err(Refused("export/zero-direction".into()));
    }
    Ok([d[0] / n, d[1] / n, d[2] / n])
}

/// Analytic carriers sharing the planar/spherical AP214 writer.
#[derive(Clone, Copy)]
pub enum SolidRef<'a> {
    Planar(&'a Audited),
    Spherical(&'a crate::sphere::Spherical),
    Axial(&'a crate::axial::Axial),
    Lens(&'a crate::lens::Lens),
    Cylinder(&'a crate::cylinder::Cylinder),
}
impl SolidRef<'_> {
    fn tolerance_mm(self) -> Result<f64, Refused> {
        match self {
            Self::Planar(a) => a.export_tolerance_mm(),
            Self::Spherical(a) => a.tolerance_mm(),
            Self::Lens(a) => a.tolerance_mm(),
            Self::Axial(a) => a.metric().tolerance_mm(),
            Self::Cylinder(c) => c.tolerance_mm(),
        }
    }
}

/// The AP214 file for named audited bodies.
pub fn write(bodies: &[(String, &Audited)], name: &str) -> Result<String, Refused> {
    let solids=bodies.iter().map(|(id,a)|(id.clone(),SolidRef::Planar(*a))).collect::<Vec<_>>();
    write_solids(&solids,name)
}

pub fn write_solids(bodies: &[(String, SolidRef<'_>)], name: &str) -> Result<String, Refused> {
    let mut w = Writer { lines: Vec::new() };
    let app = w.entity("APPLICATION_CONTEXT('automotive_design')".into());
    w.entity(format!("APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,{app})"));
    let product_context = w.entity(format!("PRODUCT_CONTEXT('',{app},'mechanical')"));
    let product = w.entity(format!("PRODUCT('{0}','{0}','',({product_context}))", text(name)));
    let formation = w.entity(format!("PRODUCT_DEFINITION_FORMATION('','',{product})"));
    let definition_context = w.entity(format!("PRODUCT_DEFINITION_CONTEXT('part definition',{app},'design')"));
    let definition = w.entity(format!("PRODUCT_DEFINITION('design','',{formation},{definition_context})"));
    let shape = w.entity(format!("PRODUCT_DEFINITION_SHAPE('','',{definition})"));
    let mm = w.entity("(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.))".into());
    let radian = w.entity("(NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.))".into());
    let steradian = w.entity("(NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT())".into());
    let mut budget = 0.0f64;
    for (_, a) in bodies {
        budget = budget.max(a.tolerance_mm()?);
    }
    let uncertainty = w.entity(format!(
        "UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE({}),{mm},'distance_accuracy_value','export rounding of exact source-frame geometry')",
        real(budget)
    ));
    let context = w.entity(format!("(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT(({uncertainty})) GLOBAL_UNIT_ASSIGNED_CONTEXT(({mm},{radian},{steradian})) REPRESENTATION_CONTEXT('','3D'))"));
    let (o, z, x) = (w.point([0.0; 3]), w.direction([0.0, 0.0, 1.0]), w.direction([1.0, 0.0, 0.0]));
    let origin = w.entity(format!("AXIS2_PLACEMENT_3D('',{o},{z},{x})"));
    let mut solids = Vec::new();
    for (id, a) in bodies {
        let a=match a {
            SolidRef::Planar(a)=>*a,
            SolidRef::Lens(a)=>{solids.push(crate::lens_step::append(&mut w,id,a)?);continue;}
            SolidRef::Spherical(a)=>{solids.push(crate::sphere_step::append(&mut w,id,a)?);continue;}
            SolidRef::Axial(a)=>{solids.push(crate::axial_step::append(&mut w,id,a)?);continue;}
            SolidRef::Cylinder(c)=>{solids.push(crate::axial_step::append_cylinder(&mut w,id,c)?);continue;}
        };
        let body = &a.body;
        let world = a.world_vertices_mm()?;
        let points: Vec<String> = world.iter().map(|&q| w.point(q)).collect();
        let vertices: Vec<String> = points.iter().map(|q| w.entity(format!("VERTEX_POINT('',{q})"))).collect();
        let mut edges = Vec::with_capacity(body.edges.len());
        for e in &body.edges {
            let (s, t) = (e.vertices[0].0 as usize, e.vertices[1].0 as usize);
            if let CurveGeometry::Circle { .. } = &body.curves[e.curve.0 as usize].geometry {
                let circle = crate::fillet_step::circle(&mut w, a, &body.curves[e.curve.0 as usize].geometry)?;
                edges.push(w.entity(format!("EDGE_CURVE('',{},{},{circle},.T.)", vertices[s], vertices[t])));
                continue;
            }

            if a.arrangement.is_some() && world[s] == world[t] {
                return Err(Refused("export/rational-boundary-below-binary64-resolution".into()));
            }
            let d = normalized([world[t][0] - world[s][0], world[t][1] - world[s][1], world[t][2] - world[s][2]])?;
            let dir = w.direction(d);
            let vector = w.entity(format!("VECTOR('',{dir},1.)"));
            let line = w.entity(format!("LINE('',{},{vector})", points[s]));
            edges.push(w.entity(format!("EDGE_CURVE('',{},{},{line},.T.)", vertices[s], vertices[t])));
        }
        let reflected = a.frame.reversed().map_err(|_| Refused("export/frame-orientation".into()))?;
        let mut faces = Vec::new();
        for (face_index, face) in body.faces.iter().enumerate() {
            let geometry = &body.surfaces[face.surface.0 as usize].geometry;
            let plane = if let Some(g) = &a.arrangement {
                let (o, n, x) = g.carrier(&a.face_loops[face_index])?;
                let n = if reflected { n.map(|v| -v) } else { n };
                let (o, n, x) = (w.point(o), w.direction(n), w.direction(x));
                let placement = w.entity(format!("AXIS2_PLACEMENT_3D('',{o},{n},{x})"));
                w.entity(format!("PLANE('',{placement})"))
            } else if let SurfaceGeometry::Plane { origin: po, normal, x: px } = geometry {
            let get = |v: &Vector3| [v[0].get(), v[1].get(), v[2].get()];
            // World carrier: its origin's image, the image of the in-plane x, and
            // the normal of the image plane (the cross product of the images of
            // two in-plane directions: x and n cross x).
            let map = |d: [f64; 3], t: bool| a.frame.apply(d, if t { 1000.0 } else { 1.0 }, t).map_err(|_| Refused("export/range".into()));
            let (n, xs) = (get(normal), get(px));
            let ys = [n[1] * xs[2] - n[2] * xs[1], n[2] * xs[0] - n[0] * xs[2], n[0] * xs[1] - n[1] * xs[0]];
            let (wx, wy) = (map(xs, false)?, map(ys, false)?);
            let wn = normalized([wx[1] * wy[2] - wx[2] * wy[1], wx[2] * wy[0] - wx[0] * wy[2], wx[0] * wy[1] - wx[1] * wy[0]])?;
            let wn = if reflected { wn.map(|x| -x) } else { wn };
            let wx = normalized(wx)?;
            let (loc, axis, refd) = (w.point(map(get(po), true)?), w.direction(wn), w.direction(wx));
            let placement = w.entity(format!("AXIS2_PLACEMENT_3D('',{loc},{axis},{refd})"));
            w.entity(format!("PLANE('',{placement})"))
            } else { crate::fillet_step::surface(&mut w, a, geometry)? };
            let mut bounds = Vec::new();
            for l in &face.loops {
            let lp = &body.loops[l.0 as usize];
            let mut coedges = lp.coedges.clone();
            if reflected { coedges.reverse(); }
            let oriented: Vec<String> = coedges
                .iter()
                .map(|c| {
                    let co = &body.coedges[c.0 as usize];
                    w.entity(format!("ORIENTED_EDGE('',*,*,{},{})", edges[co.edge.0 as usize], if co.forward != reflected { ".T." } else { ".F." }))
                })
                .collect();
            let edge_loop = w.entity(format!("EDGE_LOOP('',({}))", oriented.join(",")));
            let kind = if lp.outer { "FACE_OUTER_BOUND" } else { "FACE_BOUND" };
            bounds.push(w.entity(format!("{kind}('',{edge_loop},.T.)")));
            }
            faces.push(w.entity(format!("ADVANCED_FACE('',({}),{plane},{})", bounds.join(","), if face.forward { ".T." } else { ".F." })));
        }
        let shells: Vec<String> = body.shells.iter().map(|s| w.entity(format!("CLOSED_SHELL('',({}))",s.faces.iter().map(|f|faces[f.0 as usize].clone()).collect::<Vec<_>>().join(",")))).collect();
        if shells.len()==1 {
            solids.push(w.entity(format!("MANIFOLD_SOLID_BREP('{}',{})", text(id), shells[0])));
        } else {
            let voids: Vec<String> = shells[1..].iter().map(|s| w.entity(format!("ORIENTED_CLOSED_SHELL('',*,{s},.T.)"))).collect();
            solids.push(w.entity(format!("BREP_WITH_VOIDS('{}',{},({}))",text(id),shells[0],voids.join(","))));
        }
    }
    let mut items = vec![origin];
    items.extend(solids);
    let representation = w.entity(format!("ADVANCED_BREP_SHAPE_REPRESENTATION('',({}),{context})", items.join(",")));
    w.entity(format!("SHAPE_DEFINITION_REPRESENTATION({shape},{representation})"));
    Ok(format!(
        "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('wonky-kernel Rust planar B-rep; exact source-frame geometry, world vertices correctly rounded; analytic carrier normalization included in export budget {} mm'),'2;1');\nFILE_NAME('{}.step','',(''),(''),'wonky-kernel','Rust wonky-ops::step','');\nFILE_SCHEMA(('AUTOMOTIVE_DESIGN'));\nENDSEC;\nDATA;\n{}\nENDSEC;\nEND-ISO-10303-21;\n",
        real(budget),
        text(name),
        w.lines.join("\n")
    ))
}
