//! Analytic STEP carriers of source-frame fillets. For a non-isometric frame
//! these are normalized export approximations, bounded by export_tolerance_mm;
//! the exact native affine image and its predicates are never normalized.
use crate::{
    fillet_prism::no,
    polyhedron::{Audited, Refused},
    step::{real, Writer},
};
use wonky_contract::{Binary64, CurveGeometry, SurfaceGeometry, Vector3};
use wonky_num::Scalar;
type R<T> = Result<T, Refused>;
fn placement(w: &mut Writer, a: &Audited, o: Vector3, z: Vector3, x: Vector3) -> R<String> {
    if a.arcs.is_none() { crate::source_frame::SourceMetric::new(&a.frame)?; }
    // Arc prisms retain the exact affine source image; their export budget
    // encloses the near-isometric circle/carrier serialization defect.
    let map = |v: Vector3, point| {
        a.frame
            .apply(v.map(|x| x.get()), if point { 1000. } else { 1. }, point)
            .map_err(|_| no("export-range"))
    };
    let o = w.point(map(o, true)?);
    let z = w.direction(map(z, false)?);
    let x = w.direction(map(x, false)?);
    Ok(w.entity(format!("AXIS2_PLACEMENT_3D('',{o},{z},{x})")))
}
pub(crate) fn circle(w: &mut Writer, a: &Audited, g: &CurveGeometry) -> R<String> {
    let CurveGeometry::Circle {
        origin,
        normal,
        x,
        radius,
        ..
    } = g
    else {
        return Err(no("export-curve"));
    };
    let p = placement(w, a, *origin, *normal, *x)?;
    Ok(w.entity(format!("CIRCLE('',{p},{})", real(radius.get() * 1000.))))
}
pub(crate) fn surface(w: &mut Writer, a: &Audited, g: &SurfaceGeometry) -> R<String> {
    if let SurfaceGeometry::ConeMeridian { origin, axis, x, start, end } = g {
        let [r0, z0] = start.map(|v| v.get());
        let [r1, z1] = end.map(|v| v.get());
        let dr = wonky_num::Iv::point(r1) - wonky_num::Iv::point(r0);
        let dz = wonky_num::Iv::point(z1) - wonky_num::Iv::point(z0);
        let angle = wonky_validated::atan2(dr.abs(), dz.abs(), 1e-14)
            .map_err(|_| no("validated-cone-angle"))?.ball();
        if angle.r > 32. * f64::EPSILON {
            return Err(no("cone-angle-export-budget"));
        }
        // STEP cones widen along their axis; the exact meridian remains the
        // authority and the semi-angle is a bounded export observation only.
        let sign = if (r1 > r0) == (z1 > z0) { 1. } else { -1. };
        let b = |v| Binary64::new(v).map_err(|_| no("export-range"));
        let at = |k: usize| b(origin[k].get() + z0 * axis[k].get());
        let point = [at(0)?, at(1)?, at(2)?];
        let axis = [b(axis[0].get()*sign)?, b(axis[1].get()*sign)?, b(axis[2].get()*sign)?];
        let p = placement(w, a, point, axis, *x)?;
        return Ok(w.entity(format!("CONICAL_SURFACE('',{p},{},{})", real(r0 * 1000.), real(angle.m))));
    }
    if let SurfaceGeometry::Torus { origin, axis, x, major, minor } = g {
        let p = placement(w, a, *origin, *axis, *x)?;
        return Ok(w.entity(format!("TOROIDAL_SURFACE('',{p},{},{})", real(major.get()*1000.), real(minor.get()*1000.))));
    }
    let (origin, axis, x, radius, kind) = match g {
        SurfaceGeometry::Cylinder { origin, axis, x, radius } => (origin, axis, x, radius, "CYLINDRICAL_SURFACE"),
        SurfaceGeometry::Sphere { origin, axis, x, radius } => (origin, axis, x, radius, "SPHERICAL_SURFACE"),
        _ => return Err(no("export-surface")),
    };
    let p = placement(w, a, *origin, *axis, *x)?;
    Ok(w.entity(format!(
        "{kind}('',{p},{})",
        real(radius.get() * 1000.)
    )))
}

/// Exact vector ellipse -> bounded STEP ellipse. WC0 vectors remain inputs;
/// semiaxis lengths and the placed orthonormal frame are export observations.
pub(crate) fn vector_ellipse(w: &mut Writer, frame: &crate::placement::Placement, g: &CurveGeometry) -> R<String> {
    let CurveGeometry::VectorEllipse { origin, cosine, sine, .. } = g else { return Err(no("export-ellipse")); };
    let get = |v: &Vector3| v.map(|x| x.get());
    let (c, s) = (get(cosine), get(sine));
    let square = |v: [f64; 3]| v.into_iter().map(|x| crate::arc_profile::q(x)*crate::arc_profile::q(x)).sum::<wonky_curve::Q>();
    let (major, minor, x) = if square(c) >= square(s) { (square(c), square(s), c) } else { (square(s), square(c), s) };
    let normal = [c[1]*s[2]-c[2]*s[1], c[2]*s[0]-c[0]*s[2], c[0]*s[1]-c[1]*s[0]];
    let map = |v, point| frame.apply(v, if point {1000.} else {1.}, point).map_err(|_| no("export-range"));
    let place = w.placement(map(get(origin), true)?, map(normal, false)?, map(x, false)?);
    let major = wonky_curve::numeric::enclose(&major).map_err(|e| crate::polyhedron::Refused(e.name().into()))?.sqrt();
    let minor = wonky_curve::numeric::enclose(&minor).map_err(|e| crate::polyhedron::Refused(e.name().into()))?.sqrt();
    Ok(w.entity(format!("ELLIPSE('',{place},{},{})",real(major.m*1000.),real(minor.m*1000.))))
}

/// STEP has no harmonic pcurve. Export cubic Hermite pieces with a proved
/// fourth-derivative remainder; WC0's exact harmonic remains authoritative.
pub(crate) const HARMONIC_PCURVE_BUDGET_MM: f64 = 1e-9;
pub(crate) fn harmonic_pcurve(w: &mut Writer, surface: &str, ctx: &str, curve: &CurveGeometry, pc: &wonky_contract::PcurveGeometry) -> R<String> {
    use wonky_contract::PcurveGeometry;
    use wonky_num::Iv;
    let PcurveGeometry::Harmonic { offset, linear, cosine, sine } = pc else { return Err(no("export-harmonic-pcurve")); };
    if linear[1].get() != 0. || cosine[0].get() != 0. || sine[0].get() != 0. { return Err(no("export-harmonic-chart")); }
    let CurveGeometry::VectorEllipse { cosine: ec, sine: es, .. } = curve else { return Err(no("export-harmonic-curve")); };
    let square = |v: &Vector3| v.iter().map(|x| crate::arc_profile::q(x.get())*crate::arc_profile::q(x.get())).sum::<wonky_curve::Q>();
    let shifted = square(es)>square(ec);
    let pi = wonky_validated::pi(1e-14).map_err(|_| no("export-pi"))?.ball();
    let tau = pi*Iv::point(2.);
    let (vo, vc, vs) = (offset[1].get()*1000.,cosine[1].get()*1000.,sine[1].get()*1000.);
    let amplitude = Iv::point(vc.abs())+Iv::point(vs.abs());
    let mut n = 8;
    loop {
        let h = pi/Iv::point((2*n) as f64);
        let remainder = amplitude*h*h*h*h/Iv::point(384.);
        if remainder.hi()<HARMONIC_PCURVE_BUDGET_MM/4. { break; }
        n*=2;
        if n>4096 { return Err(no("export-harmonic-budget")); }
    }
    let rounding = Iv::point(128.*f64::EPSILON)*(Iv::point(vo.abs())+amplitude+tau)
        + amplitude*Iv::point(pi.r);
    if rounding.hi()>HARMONIC_PCURVE_BUDGET_MM/4. { return Err(no("export-harmonic-rounding-budget")); }
    let value = |j: usize| -> R<([f64;2],[f64;2])> {
        let angle = pi*Iv::point(j as f64)/Iv::point((2*n) as f64);
        let (sn,cs) = if j==0 { (Iv::point(0.),Iv::point(1.)) } else if j==n { (Iv::point(1.),Iv::point(0.)) } else {
            let (s,c) = wonky_validated::sin_cos(angle,1e-13).map_err(|_| no("export-harmonic-trig"))?;
            (s.ball(),c.ball())
        };
        let v = Iv::point(vo)+Iv::point(vc)*cs+Iv::point(vs)*sn;
        let dv = -Iv::point(vc)*sn+Iv::point(vs)*cs;
        if v.r>HARMONIC_PCURVE_BUDGET_MM/8. || dv.r*pi.hi()>HARMONIC_PCURVE_BUDGET_MM/8. { return Err(no("export-harmonic-trig-width")); }
        Ok(([tau.m*offset[0].get()+linear[0].get()*angle.m,v.m],[linear[0].get(),dv.m]))
    };
    let mut controls = vec![];
    let mut knots = vec![];
    for j in 0..n {
        let (p0,d0) = value(j)?; let (p1,d1) = value(j+1)?;
        let h = pi.m/(2*n) as f64;
        if j==0 { controls.push(w.point(p0)); }
        controls.push(w.point(std::array::from_fn::<_,2,_>(|k| p0[k]+h*d0[k]/3.)));
        controls.push(w.point(std::array::from_fn::<_,2,_>(|k| p1[k]-h*d1[k]/3.)));
        controls.push(w.point(p1));
        knots.push(real(pi.m*j as f64/(2*n) as f64-if shifted {pi.m/2.} else {0.}));
    }
    knots.push(real(if shifted {0.} else {pi.m/2.}));
    let mult = (0..=n).map(|j| if j==0 || j==n {"4"} else {"3"}).collect::<Vec<_>>();
    let spline = w.entity(format!("B_SPLINE_CURVE_WITH_KNOTS('',3,({}),.UNSPECIFIED.,.F.,.F.,({}),({}),.PIECEWISE_BEZIER_KNOTS.)",controls.join(","),mult.join(","),knots.join(",")));
    let rep = w.entity(format!("DEFINITIONAL_REPRESENTATION('',({spline}),{ctx})"));
    Ok(w.entity(format!("PCURVE('',{surface},{rep})")))
}
