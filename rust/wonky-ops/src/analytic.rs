//! Dispatch by audited analytic carrier, never by caller-provided geometry tags.
use crate::{
    affine::Affine,
    cylinder::{self, Cylinder},
    polyhedron::{self, Audited, Refused},
};
use wonky_contract::{Body, BodyKey, CheckedBody};

type R<T> = Result<T, Refused>;
#[derive(Clone, Debug)]
pub enum Solid {
    Planar(Audited),
    Cylinder(Cylinder),
    Bicylinder(crate::bicylinder::Bicylinder),
    Spherical(crate::sphere::Spherical),
    Axial(crate::axial::Axial),
    Lens(crate::lens::Lens),
    Perforated(crate::perforated::Perforated),
}
pub fn audit(body: &CheckedBody) -> R<Solid> {
    if crate::bicylinder::is_candidate(body.body()) {
        crate::bicylinder::audit(body).map(Solid::Bicylinder)
    } else if body.body().curves.iter().any(|c| matches!(c.geometry, wonky_contract::CurveGeometry::SphereCircle { .. })) {
        crate::lens::audit(body).map(Solid::Lens)
    } else if crate::arc_profile::candidate(body.body()) || crate::fillet_prism::candidate(body.body()) {
        polyhedron::audit(body).map(Solid::Planar)
    } else if body.body().surfaces.iter().any(|s| matches!(s.geometry, wonky_contract::SurfaceGeometry::Sphere { .. })) {
        if cylinder::has_cylinder(body.body()) {
            crate::axial::audit(body).map(Solid::Axial)
        } else {
            crate::sphere::audit(body).map(Solid::Spherical)
        }
    } else if cylinder::has_cylinder(body.body()) && crate::perforated::is_candidate(body.body()) {
        crate::perforated::audit(body).map(Solid::Perforated)
    } else if cylinder::has_cylinder(body.body()) {
        cylinder::audit(body).map(Solid::Cylinder)
    } else {
        polyhedron::audit(body).map(Solid::Planar)
    }
}
impl Solid {
    pub fn transform(&self, frame: Affine) -> R<Body> {
        match self {
            Self::Planar(a) => crate::orthogonal::transform(a, frame),
            Self::Cylinder(c) => cylinder::transform(c, frame),
            Self::Bicylinder(c) => c.transform(frame),
            Self::Spherical(s) => crate::sphere::transform(s, frame),
            Self::Axial(a) => a.transform(frame),
            Self::Lens(a) => a.transform(frame),
            Self::Perforated(p) => p.transform(frame),
        }
    }
    pub fn measure(&self, map: Option<[[f64; 4]; 3]>, probes: &[[f64; 3]]) -> R<String> {
        match self {
            Self::Planar(a) => crate::host::measure_json(a, map, probes),
            Self::Cylinder(c) => c.measure_json(map, probes),
            Self::Bicylinder(c) => c.measure_json(map, probes),
            Self::Spherical(s) => s.measure_json(map, probes),
            Self::Axial(a) => a.measure_json(map, probes),
            Self::Lens(a) => a.measure_json(map, probes),
            Self::Perforated(p) => p.measure_json(map, probes),
        }
    }
    pub fn extents(&self) -> R<[f64; 3]> {
        match self {
            Self::Planar(a) => a
                .orthogonal
                .as_ref()
                .ok_or_else(|| Refused("bbox/non-orthogonal".into()))?
                .extents_mm(),
            Self::Perforated(p) => p.base.orthogonal.as_ref().ok_or_else(|| Refused("bbox/non-box".into()))?.extents_mm(),
            Self::Spherical(_) | Self::Axial(_) | Self::Lens(_) => Err(Refused("bbox/spherical-source-extents".into())),
            Self::Bicylinder(c) => Ok([c.radius * 2000.; 3]),
            Self::Cylinder(c) => {
                let k = c.spec.axis()?;
                let mut d = [c.spec.radius * 2000.; 3];
                d[k] = (c.spec.top[k] - c.spec.bottom[k]) * 1000.;
                Ok(d)
            }
        }
    }
}
pub fn boolean(key: BodyKey, op: u8, bodies: &[Solid]) -> R<Vec<Body>> {
    if bodies.iter().all(|b| matches!(b, Solid::Planar(_))) {
        return crate::orthogonal::boolean(
            key,
            op,
            &bodies
                .iter()
                .filter_map(|b| {
                    if let Solid::Planar(a) = b {
                        Some(a.clone())
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>(),
        );
    }
    if op == 1 {
        if let [Solid::Spherical(s), Solid::Cylinder(c)] = bodies {
            let tool = crate::axial::from_cylinder(c)?;
            return Ok(vec![crate::axial::subtract(key, s, &tool)?]);
        }
    }
    if bodies.iter().any(|b| matches!(b, Solid::Spherical(_))) {
        if op == 2 {
            match bodies {
                [Solid::Spherical(a), Solid::Planar(b)] | [Solid::Planar(b), Solid::Spherical(a)] =>
                    return Ok(vec![crate::sphere::intersect_box(key, a, b)?]),
                [Solid::Spherical(a), Solid::Spherical(b)] =>
                    return Ok(vec![crate::lens::intersect(key, a, b)?]),
                _ => {}
            }
        }
        return Err(Refused("sphere/unsupported-boolean".into()));
    }
    if let [Solid::Cylinder(a), Solid::Cylinder(b)] = bodies {
        if op == 2 && a.spec.axis()? != b.spec.axis()? {
            return Ok(vec![crate::bicylinder::intersect(key, a, b)?]);
        }
        return cylinder::boolean(key, op, a, b);
    }
    if let Some(Solid::Planar(a)) = bodies.first() {
        if op == 1
            && bodies.len() > 1
            && bodies[1..].iter().all(|b| matches!(b, Solid::Cylinder(_)))
        {
            let tools = bodies[1..]
                .iter()
                .filter_map(|b| {
                    if let Solid::Cylinder(c) = b {
                        Some(c.clone())
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>();
            return match cylinder::tangent_box_noop(a, &tools) {
                Ok(body) => Ok(vec![body]),
                Err(e) if e.0 == "cylinder/box-cylinder-cut-arrangement" =>
                    Ok(vec![crate::perforated::subtract(key, a, &tools)?]),
                Err(e) => Err(e),
            };
        }
    }
    Err(Refused("cylinder/mixed-boolean-arrangement".into()))
}
pub fn distance(a: &Solid, b: &Solid) -> R<(f64, f64)> {
    match (a, b) {
        (Solid::Cylinder(a), Solid::Cylinder(b)) => cylinder::distance_mm(a, b),
        (Solid::Planar(a), Solid::Planar(b)) => {
            if a.arcs.is_some() || b.arcs.is_some() { return Err(Refused("distance/arc-prism-pair-unimplemented".into())); }
            if a.orthogonal.is_none() || b.orthogonal.is_none() {
                let d = crate::distance::between(a,b)?;
                return Ok((d.distance_mm, (d.distance_mm-d.lower_mm).max(d.upper_mm-d.distance_mm)));
            }
            if a.frame != b.frame {
                return Err(Refused("distance/different-exact-frames".into()));
            }
            let (Some(c), Some(d)) = (&a.orthogonal, &b.orthogonal) else {
                return Err(Refused("distance/non-orthogonal".into()));
            };
            c.distance_mm(d, a.frame.as_affine()?)
        }
        _ => Err(Refused("distance/mixed-carriers".into())),
    }
}
pub fn step(bodies: &[(String, Solid)], name: &str) -> R<String> {
    if bodies.iter().all(|(_, b)| matches!(b, Solid::Planar(_))) {
        return crate::step::write(
            &bodies
                .iter()
                .filter_map(|(id, b)| {
                    if let Solid::Planar(a) = b {
                        Some((id.clone(), a))
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>(),
            name,
        );
    }
    // Retained cylinder tools share the band's writer, preserving their native
    // face order and the established all-cylinder export path.
    let has_axial = bodies.iter().any(|(_, b)| matches!(b, Solid::Axial(_)));
    if bodies.iter().all(|(_, b)| matches!(b, Solid::Planar(_) | Solid::Spherical(_) | Solid::Axial(_) | Solid::Lens(_))
        || (has_axial && matches!(b, Solid::Cylinder(_)))) {
        let named = bodies.iter().map(|(id, b)| (id.clone(), match b {
            Solid::Planar(a) => crate::step::SolidRef::Planar(a),
            Solid::Spherical(a) => crate::step::SolidRef::Spherical(a),
            Solid::Axial(a) => crate::step::SolidRef::Axial(a),
            Solid::Lens(a) => crate::step::SolidRef::Lens(a),
            Solid::Cylinder(c) => crate::step::SolidRef::Cylinder(c),
            _ => unreachable!(),
        })).collect::<Vec<_>>();
        return crate::step::write_solids(&named, name);
    }
    if bodies.iter().all(|(_, b)| matches!(b, Solid::Cylinder(_))) {
        return crate::cylinder_step::write(
            &bodies
                .iter()
                .filter_map(|(id, b)| {
                    if let Solid::Cylinder(c) = b {
                        Some((id.clone(), c))
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>(),
            name,
        );
    }
    if bodies.iter().all(|(_, b)| matches!(b, Solid::Bicylinder(_))) {
        return crate::bicylinder_step::write(&bodies.iter().filter_map(|(id, b)| {
            if let Solid::Bicylinder(p) = b { Some((id.clone(), p)) } else { None }
        }).collect::<Vec<_>>(), name);
    }
    if bodies.iter().all(|(_, b)| matches!(b, Solid::Perforated(_))) {
        return crate::perforated_step::write(&bodies.iter().filter_map(|(id,b)| {
            if let Solid::Perforated(p)=b {Some((id.clone(),p))} else {None}
        }).collect::<Vec<_>>(), name);
    }
    Err(Refused("export/mixed-carriers".into()))
}
