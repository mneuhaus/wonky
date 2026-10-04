//! Exact cylinder membership; shared affine/radial predicates also classify
//! cylindrical voids. Only the distance is rounded, with interval enclosures.
use crate::{
    cylinder::{finite, no, Cylinder},
    polyhedron::Refused,
    probe_exact::{enclose, local_point, q, radial},
};
use num_rational::BigRational as Q;
use num_traits::Zero;
use std::cmp::Ordering;
use wonky_num::{Iv, Scalar};

type R<T> = Result<T, Refused>;
pub(crate) fn probe(c: &Cylinder, point_mm: [f64; 3]) -> R<(f64, bool, f64)> {
    let p = local_point(&c.frame, point_mm).map_err(no)?;
    let k = c.spec.axis()?;
    let radial = radial(&p, k, c.spec.bottom, c.spec.radius).map_err(no)?;
    let axial = (q(c.spec.bottom[k]).map_err(no)? - &p[k])
        .max(&p[k] - q(c.spec.top[k]).map_err(no)?);
    // Boundary belongs to the closed solid. No epsilon or rounded inverse
    // participates in this sign decision, even for next-ulp and huge offsets.
    let inside = radial.comparison != Ordering::Greater && axial <= Q::zero();
    if inside {
        return Ok((0., true, 0.));
    }
    let radial = radial.offset().map_err(no)?.max(Iv::point(0.));
    let axial = enclose(&axial).map_err(no)?.max(Iv::point(0.));
    let local = finite(radial.norm3(axial, Iv::point(0.)) * Iv::point(1000.))?;
    let defect = c.frame.orthonormality_defect().map_err(|_| no("probe-frame"))?;
    let distance = finite(local * Iv { m: 1., r: (3. * defect).next_up() })?;
    Ok((distance.m, false, distance.r))
}
