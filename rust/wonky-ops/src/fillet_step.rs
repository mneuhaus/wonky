//! Analytic STEP carriers of source-frame fillets. For a non-isometric frame
//! these are normalized export approximations, bounded by export_tolerance_mm;
//! the exact native affine image and its predicates are never normalized.
use crate::{
    fillet_prism::no,
    polyhedron::{Audited, Refused},
    step::{real, Writer},
};
use wonky_contract::{CurveGeometry, SurfaceGeometry, Vector3};
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
