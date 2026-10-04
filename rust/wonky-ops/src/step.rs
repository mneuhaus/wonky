//! Shared AP214 STEP writer for independently audited WC0 analytic bodies.
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

pub(crate) fn text(s: &str) -> String {
    s.chars().map(|c| if c == '\'' { "''".to_string() } else if (' '..='~').contains(&c) { c.to_string() } else { "_".to_string() }).collect()
}

pub(crate) struct Writer {
    pub(crate) lines: Vec<String>,
}
impl Writer {
    pub(crate) fn entity(&mut self, s: String) -> String {
        self.lines.push(format!("#{}={s};", self.lines.len() + 1));
        format!("#{}", self.lines.len())
    }
    pub(crate) fn point(&mut self, p: impl AsRef<[f64]>) -> String {
        self.entity(format!(
            "CARTESIAN_POINT('',({}))",
            p.as_ref().iter().map(|&x| real(x)).collect::<Vec<_>>().join(",")
        ))
    }
    pub(crate) fn direction(&mut self, p: impl AsRef<[f64]>) -> String {
        self.entity(format!(
            "DIRECTION('',({}))",
            p.as_ref().iter().map(|&x| real(x)).collect::<Vec<_>>().join(",")
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
    pub(crate) fn face(&mut self, surface: &str, uses: &[(&str, bool)], forward: bool) -> String {
        let uses = uses
            .iter()
            .map(|(e, f)| self.entity(format!("ORIENTED_EDGE('',*,*,{e},{})", crate::cylinder_step::flag(*f))))
            .collect::<Vec<_>>();
        let lp = self.entity(format!("EDGE_LOOP('',({}))", uses.join(",")));
        let bound = self.entity(format!("FACE_OUTER_BOUND('',{lp},.T.)"));
        self.entity(format!(
            "ADVANCED_FACE('',({bound}),{surface},{})",
            crate::cylinder_step::flag(forward)
        ))
    }
}

pub(crate) fn normalized(d: [f64; 3]) -> Result<[f64; 3], Refused> {
    let n = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt();
    if !(n > 0.0 && n.is_finite()) {
        return Err(Refused("export/zero-direction".into()));
    }
    Ok([d[0] / n, d[1] / n, d[2] / n])
}

/// Analytic carriers sharing the planar/spherical AP214 writer.
#[derive(Clone, Copy)]
pub enum SolidRef<'a> {
    Columns(&'a crate::prism_columns::Columns),
    PrismHoles(&'a crate::prism_holes::PrismHoles),
    PrismStack(&'a crate::prism_stack::PrismStack),
    Revolved(&'a crate::revolve_full::FullRevolve),
    Planar(&'a Audited),
    Spherical(&'a crate::sphere::Spherical),
    Axial(&'a crate::axial::Axial),
    Lens(&'a crate::lens::Lens),
    Cylinder(&'a crate::cylinder::Cylinder),
    Conical(&'a crate::chamfer_rim::Conical),
    Coaxial(&'a crate::coaxial::Coaxial),
    Bicylinder(&'a crate::bicylinder::Bicylinder),
    CylinderTee(&'a crate::cylinder_tee::Tee),
    Perforated(&'a crate::perforated::Perforated),
    PerforatedChamfer(&'a crate::perforated_chamfer::PerforatedChamfer),
    /// A curved general-Boolean Model (G12), through G11's analytic writer.
    Model(&'a wonky_geom::model::Model),
}
impl SolidRef<'_> {
    fn tolerance_mm(self) -> Result<f64, Refused> {
        match self {
            Self::Revolved(a) => a.tolerance_mm(),
            Self::Columns(a) => a.tolerance_mm(),
            Self::PrismHoles(a) => a.tolerance_mm(),
            Self::PrismStack(a) => a.tolerance_mm().map(|t| t+if a.body.pcurves.iter().any(|p| matches!(p.geometry, wonky_contract::PcurveGeometry::Harmonic { .. })) {crate::fillet_step::HARMONIC_PCURVE_BUDGET_MM} else {0.}),
            Self::Planar(a) => a.export_tolerance_mm().map(|t| t+if a.body.pcurves.iter().any(|p| matches!(p.geometry, wonky_contract::PcurveGeometry::Harmonic { .. })) {crate::fillet_step::HARMONIC_PCURVE_BUDGET_MM} else {0.}),
            Self::Spherical(a) => a.tolerance_mm(),
            Self::Lens(a) => a.tolerance_mm(),
            Self::Axial(a) => a.metric().tolerance_mm(),
            Self::Cylinder(c) => c.tolerance_mm(),
            Self::Conical(c) => c.tolerance_mm(),
            Self::Coaxial(c) => c.tolerance_mm(),
            Self::Bicylinder(c) => crate::bicylinder_step::tolerance_mm(c),
            Self::CylinderTee(c) => crate::cylinder_tee_step::tolerance_mm(c),
            Self::Perforated(c) => c.tolerance_mm(),
            Self::PerforatedChamfer(c) => c.tolerance_mm(),
            Self::Model(m) => crate::model_export::budget_mm(m),
        }
    }
    /// A 3D edge curve is a bounded spline stand-in for an exact native carrier.
    fn approximates_curve(self) -> bool {
        matches!(self, Self::CylinderTee(_))
    }
}

/// The preamble entities the footer refers to.
pub(crate) struct Head {
    shape: String,
    context: String,
    origin: String,
}

/// The shared AP214 preamble: product structure, units, the uncertainty measure
/// (`budget` mm, described by `what`) and the origin placement.
pub(crate) fn begin(name: &str, budget: f64, what: &str) -> (Writer, Head) {
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
    let uncertainty = w.entity(format!(
        "UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE({}),{mm},'distance_accuracy_value','{what}')",
        real(budget)
    ));
    let context = w.entity(format!("(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT(({uncertainty})) GLOBAL_UNIT_ASSIGNED_CONTEXT(({mm},{radian},{steradian})) REPRESENTATION_CONTEXT('','3D'))"));
    let (o, z, x) = (w.point([0.0; 3]), w.direction([0.0, 0.0, 1.0]), w.direction([1.0, 0.0, 0.0]));
    let origin = w.entity(format!("AXIS2_PLACEMENT_3D('',{o},{z},{x})"));
    let head = Head { shape, context, origin };
    (w, head)
}

/// The shared AP214 footer: the shape representation of the origin plus
/// `solids`, wrapped in the file with its `description` header line.
pub(crate) fn finish(mut w: Writer, head: Head, name: &str, description: &str, solids: Vec<String>) -> String {
    let Head { shape, context, origin } = head;
    let mut items = vec![origin];
    items.extend(solids);
    let representation = w.entity(format!("ADVANCED_BREP_SHAPE_REPRESENTATION('',({}),{context})", items.join(",")));
    w.entity(format!("SHAPE_DEFINITION_REPRESENTATION({shape},{representation})"));
    format!(
        "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('{description}'),'2;1');\nFILE_NAME('{}.step','',(''),(''),'wonky-kernel','Rust wonky-ops::step','');\nFILE_SCHEMA(('AUTOMOTIVE_DESIGN'));\nENDSEC;\nDATA;\n{}\nENDSEC;\nEND-ISO-10303-21;\n",
        text(name),
        w.lines.join("\n")
    )
}

/// The AP214 file for named audited bodies.
pub fn write(bodies: &[(String, &Audited)], name: &str) -> Result<String, Refused> {
    let solids=bodies.iter().map(|(id,a)|(id.clone(),SolidRef::Planar(*a))).collect::<Vec<_>>();
    write_solids(&solids,name)
}

pub fn write_solids(bodies: &[(String, SolidRef<'_>)], name: &str) -> Result<String, Refused> {
    let mut budget = 0.0f64;
    for (_, a) in bodies {
        budget = budget.max(a.tolerance_mm()?);
    }
    // The declared budget also covers bounded STEP-only spline curves; the
    // label says so whenever one is written, so no reader mistakes it for rounding.
    let approximated = bodies.iter().any(|(_, a)| a.approximates_curve());
    // Exact source B-splines (curve profiles) round only their controls; the
    // budget holds the partition-of-unity bound of step_carrier.
    let splines = bodies.iter().any(|(_, a)| matches!(a, SolidRef::Planar(p) if crate::curve_profile::candidate(&p.body)));
    let harmonic = bodies.iter().any(|(_, a)| match a {
        SolidRef::Planar(p) => p.body.pcurves.iter().any(|pc| matches!(pc.geometry, wonky_contract::PcurveGeometry::Harmonic { .. })),
        SolidRef::PrismStack(p) => p.body.pcurves.iter().any(|pc| matches!(pc.geometry, wonky_contract::PcurveGeometry::Harmonic { .. })),
        // Keep the export disclosure exhaustive when another solid kind is added.
        SolidRef::Columns(_) | SolidRef::PrismHoles(_) | SolidRef::Revolved(_)
        | SolidRef::Spherical(_) | SolidRef::Axial(_) | SolidRef::Lens(_)
        | SolidRef::Cylinder(_) | SolidRef::Conical(_) | SolidRef::Coaxial(_)
        | SolidRef::Bicylinder(_) | SolidRef::CylinderTee(_) | SolidRef::Perforated(_)
        | SolidRef::PerforatedChamfer(_) | SolidRef::Model(_) => false,
    });
    let what = match (approximated, splines, harmonic) {
        (true, _, _) => "export rounding and bounded STEP-only spline approximation of exact source-frame geometry",
        (false, _, true) => "export rounding and bounded STEP-only harmonic pcurves of exact source-frame geometry (1e-9 mm)",
        (false, true, false) => "export rounding of exact source-frame geometry; B-spline curves by the partition-of-unity bound",
        (false, false, false) => "export rounding of exact source-frame geometry",
    };
    let (mut w, head) = begin(name, budget, what);
    let mut solids = Vec::new();
    for (id, a) in bodies {
        let a=match a {
            SolidRef::Revolved(a)=>{solids.push(crate::revolve_full_step::append(&mut w,id,a)?);continue;}
            SolidRef::Columns(a)=>{
                let planar = match &a.base { crate::prism_holes::Base::Planar(p) => Some(p), _ => None };
                solids.push(crate::perforated_step::append_boundary(&mut w,id,&a.body,a.base.frame(),planar)?);continue;
            }
            SolidRef::PrismHoles(a)=>{
                let planar = match &a.base { crate::prism_holes::Base::Planar(p) => Some(p), _ => None };
                solids.push(crate::perforated_step::append_boundary(&mut w,id,&a.body,a.base.frame(),planar)?);continue;
            }
            SolidRef::PrismStack(a)=>{solids.push(crate::prism_stack_observe::append_step(&mut w,id,a)?);continue;}
            SolidRef::Model(m)=>{solids.extend(crate::model_export::append_model(&mut w,id,m)?);continue;}
            // Spline carriers: B_SPLINE_CURVE_WITH_KNOTS / SURFACE_OF_LINEAR_EXTRUSION.
            SolidRef::Planar(a) if crate::curve_profile::candidate(&a.body)=>{solids.push(crate::step_carrier::append_audited(&mut w,id,a)?);continue;}
            SolidRef::Planar(a) if a.body.curves.iter().any(|c| matches!(c.geometry, CurveGeometry::VectorEllipse { .. })) => {
                solids.push(crate::perforated_step::append_boundary(&mut w,id,&a.body,&a.frame,None)?); continue;
            }
            SolidRef::Planar(a)=>*a,
            SolidRef::Lens(a)=>{solids.push(crate::lens_step::append(&mut w,id,a)?);continue;}
            SolidRef::Spherical(a)=>{solids.push(crate::sphere_step::append(&mut w,id,a)?);continue;}
            SolidRef::Axial(a)=>{solids.push(crate::axial_step::append(&mut w,id,a)?);continue;}
            SolidRef::Cylinder(c)=>{solids.push(crate::cylinder_step::append(&mut w,id,c)?);continue;}
            SolidRef::Conical(c)=>{solids.push(crate::conical_step::append(&mut w,id,c)?);continue;}
            SolidRef::Coaxial(c)=>{solids.push(crate::coaxial_step::append(&mut w,id,c)?);continue;}
            SolidRef::Bicylinder(c)=>{solids.push(crate::bicylinder_step::append(&mut w,id,c)?);continue;}
            SolidRef::CylinderTee(c)=>{solids.push(crate::cylinder_tee_step::append(&mut w,id,c)?);continue;}
            SolidRef::Perforated(c)=>{solids.push(crate::perforated_step::append_boundary(&mut w,id,&c.body,&c.base.frame,Some(&c.base))?);continue;}
            // Chamfer planes export their WC0 carriers; the rounded witness
            // displacement is part of the declared tolerance.
            SolidRef::PerforatedChamfer(c)=>{solids.push(crate::perforated_step::append_boundary(&mut w,id,&c.body,&c.source.base.frame,None)?);continue;}
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

            if let CurveGeometry::VectorEllipse { .. } = &body.curves[e.curve.0 as usize].geometry {
                let ellipse = crate::fillet_step::vector_ellipse(&mut w, &a.frame, &body.curves[e.curve.0 as usize].geometry)?;
                edges.push(w.entity(format!("EDGE_CURVE('',{},{},{ellipse},.T.)", vertices[s], vertices[t])));
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
        for face in &body.faces {
            let geometry = &body.surfaces[face.surface.0 as usize].geometry;
            let plane = if let Some(g) = &a.arrangement {
                let (o, n, x) = g.carrier(&a.face_loops[face.loops[0].0 as usize])?;
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
        for solid in &body.solids {
            let outer = &shells[solid.shells[0].0 as usize];
            if solid.shells.len() == 1 {
                solids.push(w.entity(format!("MANIFOLD_SOLID_BREP('{}',{})", text(id), outer)));
            } else {
                let voids: Vec<String> = solid.shells[1..].iter().map(|s| {
                    w.entity(format!("ORIENTED_CLOSED_SHELL('',*,{},.T.)", shells[s.0 as usize]))
                }).collect();
                solids.push(w.entity(format!("BREP_WITH_VOIDS('{}',{},({}))",text(id),outer,voids.join(","))));
            }
        }
    }
    let description = format!(
        "wonky-kernel Rust analytic B-rep; exact source-frame geometry, world vertices correctly rounded; analytic carrier normalization{}{}{} included in export budget {} mm",
        if approximated { " and bounded spline curves" } else { "" },
        if splines { " and the partition-of-unity bound of B-spline controls" } else { "" },
        if harmonic { " and STEP-only harmonic pcurve approximation (1e-9 mm)" } else { "" },
        real(budget)
    );
    Ok(finish(w, head, name, &description, solids))
}
