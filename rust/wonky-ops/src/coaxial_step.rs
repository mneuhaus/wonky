//! Export-only periodic seam for radial-profile analytic WC0 rings.
use crate::{
    coaxial::Coaxial,
    polyhedron::Refused,
    sphere_step::{pcurve, placement},
    step::{real, Writer},
};
use std::collections::BTreeMap;
use wonky_contract::*;
use wonky_num::{Iv, Scalar};
fn no(s: &str) -> Refused {
    Refused(format!("coaxial/export-{s}"))
}
fn flag(f: bool) -> &'static str {
    if f {
        ".T."
    } else {
        ".F."
    }
}
fn bound(w: &mut Writer, edge: &str, forward: bool, outer: bool) -> String {
    let oe = w.entity(format!("ORIENTED_EDGE('',*,*,{edge},{})", flag(forward)));
    let lp = w.entity(format!("EDGE_LOOP('',({oe}))"));
    w.entity(format!(
        "{}('',{lp},.T.)",
        if outer {
            "FACE_OUTER_BOUND"
        } else {
            "FACE_BOUND"
        }
    ))
}
pub(crate) fn append(
    w: &mut Writer,
    id: &str,
    a: &Coaxial,
) -> std::result::Result<String, Refused> {
    a.tolerance_mm()?;
    let body = &a.body;
    let mut axis = [0.; 3];
    axis[a.axis] = 1.;
    let mut x = [0.; 3];
    x[(a.axis + 1) % 3] = 1.;
    let z = a.frame.apply(axis, 1., false).map_err(|_| no("frame"))?;
    let x = a.frame.apply(x, 1., false).map_err(|_| no("frame"))?;
    let ctx = w.entity(
        "(GEOMETRIC_REPRESENTATION_CONTEXT(2) REPRESENTATION_CONTEXT('','coaxial chart'))".into(),
    );
    let tau = (wonky_validated::pi(1e-14).map_err(|_| no("pi"))?.ball() * Iv::point(2.)).m;
    let mut rings = BTreeMap::new();
    for (i, edge) in body.edges.iter().enumerate() {
        let CurveGeometry::Circle { origin, radius, .. } =
            body.curves[edge.curve.0 as usize].geometry
        else {
            return Err(no("nonring"));
        };
        let r = radius.get() * 1000.;
        let center = a
            .frame
            .apply(
                [0, 1, 2].map(|j| origin[j].get() + a.center[j]),
                1000.,
                true,
            )
            .map_err(|_| no("frame"))?;
        let place = placement(w, center, z, x);
        let c = w.entity(format!("CIRCLE('',{place},{})", real(r)));
        let mut seam_point = center;
        for j in 0..3 {
            seam_point[j] += r * x[j];
        }
        let v = w.point(seam_point);
        let v = w.entity(format!("VERTEX_POINT('',{v})"));
        rings.insert(i as u32, (c, v));
    }
    let mut surfaces = Vec::new();
    for s in &body.surfaces {
        let (origin, radial) = match s.geometry {
            SurfaceGeometry::Cylinder { origin, radius, .. } => {
                (origin.map(Binary64::get), Some(radius.get()))
            }
            SurfaceGeometry::Plane { origin, .. } => (origin.map(Binary64::get), None),
            _ => return Err(no("surface")),
        };
        let center = a
            .frame
            .apply([0, 1, 2].map(|j| origin[j] + a.center[j]), 1000., true)
            .map_err(|_| no("frame"))?;
        let place = placement(w, center, z, x);
        surfaces.push(if let Some(r) = radial {
            w.entity(format!(
                "CYLINDRICAL_SURFACE('',{place},{})",
                real(r * 1000.)
            ))
        } else {
            w.entity(format!("PLANE('',{place})"))
        });
    }
    let mut edges = Vec::new();
    for (i, edge) in body.edges.iter().enumerate() {
        let (curve, vertex) = rings.get(&(i as u32)).ok_or_else(|| no("missing-ring"))?;
        let mut pcs = vec![];
        for support in &body.curves[edge.curve.0 as usize].supports {
            let surface = &surfaces[support.surface.0 as usize];
            let pc = &body.pcurves[support.pcurve.0 as usize];
            let pcurve = match pc.geometry {
                PcurveGeometry::Circle { radius, .. } => {
                    let o = w.entity("CARTESIAN_POINT('',(0.,0.))".into());
                    let d = w.entity("DIRECTION('',(1.,0.))".into());
                    let place = w.entity(format!("AXIS2_PLACEMENT_2D('',{o},{d})"));
                    let c = w.entity(format!("CIRCLE('',{place},{})", real(radius.get() * 1000.)));
                    let rep = w.entity(format!("DEFINITIONAL_REPRESENTATION('',({c}),{ctx})"));
                    w.entity(format!("PCURVE('',{surface},{rep})"))
                }
                PcurveGeometry::Line { a, .. } => {
                    pcurve(w, surface, &ctx, [0., a[1].get() * 1000.], [1., 0.])
                }
                _ => return Err(no("chart")),
            };
            pcs.push(pcurve);
        }
        if pcs.len() != 2 {
            return Err(no("ring-incidence"));
        }
        let c = w.entity(format!(
            "SURFACE_CURVE('',{curve},({}),.CURVE_3D.)",
            pcs.join(",")
        ));
        edges.push(w.entity(format!("EDGE_CURVE('',{vertex},{vertex},{c},.T.)")));
    }
    let mut faces = vec![];
    for face in &body.faces {
        let surface = &surfaces[face.surface.0 as usize];
        let mut bounds = vec![];
        for lid in &face.loops {
            let lp = &body.loops[lid.0 as usize];
            let co = &body.coedges[lp.coedges[0].0 as usize];
            bounds.push(bound(w, &edges[co.edge.0 as usize], co.forward, lp.outer));
        }
        if matches!(
            body.surfaces[face.surface.0 as usize].geometry,
            SurfaceGeometry::Cylinder { .. }
        ) {
            if bounds.len() != 2 {
                return Err(no("cylinder-bounds"));
            }
            let r = body.curves[body.edges[body.coedges
                [body.loops[face.loops[0].0 as usize].coedges[0].0 as usize]
                .edge
                .0 as usize]
                .curve
                .0 as usize]
                .clone();
            let CurveGeometry::Circle { origin, radius, .. } = r.geometry else {
                return Err(no("ring"));
            };
            let mut pos = [0.; 3];
            pos[a.axis] = origin[a.axis].get();
            pos[(a.axis + 1) % 3] = radius.get();
            let pos = a
                .frame
                .apply([0, 1, 2].map(|j| pos[j] + a.center[j]), 1000., true)
                .map_err(|_| no("frame"))?;
            let p = w.point(pos);
            let d = w.direction(z);
            let vv = w.entity(format!("VECTOR('',{d},1.)"));
            let line = w.entity(format!("LINE('',{p},{vv})"));
            let left = pcurve(w, surface, &ctx, [0., 0.], [0., 1.]);
            let right = pcurve(w, surface, &ctx, [tau, 0.], [0., 1.]);
            let s = w.entity(format!("SEAM_CURVE('',{line},({left},{right}),.CURVE_3D.)"));
            let mut ids = vec![];
            for lid in &face.loops {
                let co = &body.coedges[body.loops[lid.0 as usize].coedges[0].0 as usize];
                let (_, vertex) = rings.get(&co.edge.0).ok_or_else(|| no("seam-vertex"))?;
                ids.push(vertex.clone());
            }
            let seam = w.entity(format!("EDGE_CURVE('',{},{},{s},.T.)", ids[0], ids[1]));
            let low = &edges[body.coedges
                [body.loops[face.loops[0].0 as usize].coedges[0].0 as usize]
                .edge
                .0 as usize];
            let high = &edges[body.coedges
                [body.loops[face.loops[1].0 as usize].coedges[0].0 as usize]
                .edge
                .0 as usize];
            let orientations = if face.forward {
                [
                    (low.as_str(), true),
                    (&seam, true),
                    (high.as_str(), false),
                    (&seam, false),
                ]
            } else {
                [
                    (low.as_str(), false),
                    (&seam, true),
                    (high.as_str(), true),
                    (&seam, false),
                ]
            };
            let oe = orientations
                .iter()
                .map(|(edge, d)| w.entity(format!("ORIENTED_EDGE('',*,*,{edge},{})", flag(*d))))
                .collect::<Vec<_>>();
            let lp = w.entity(format!("EDGE_LOOP('',({}))", oe.join(",")));
            bounds = vec![w.entity(format!("FACE_OUTER_BOUND('',{lp},.T.)"))];
        }
        faces.push(w.entity(format!(
            "ADVANCED_FACE('',({}),{surface},{})",
            bounds.join(","),
            flag(face.forward)
        )));
    }
    let shell = w.entity(format!("CLOSED_SHELL('',({}))", faces.join(",")));
    Ok(w.entity(format!(
        "MANIFOLD_SOLID_BREP('{}',{shell})",
        id.replace('\'', "''")
    )))
}
