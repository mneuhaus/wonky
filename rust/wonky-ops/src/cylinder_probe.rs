//! Exact membership of a binary64 query in a composed affine cylinder. Rational
//! Cramer coordinates are transient predicates, not replacement geometry. Only
//! the distance is rounded, with checked rational/interval enclosures.
use crate::{
    cylinder::{finite, no, Cylinder},
    polyhedron::Refused,
};
use num_rational::BigRational as Q;
use num_traits::{ToPrimitive, Zero};
use wonky_num::{Iv, Scalar};

type R<T> = Result<T, Refused>;
type P = [Q; 3];
fn q(x: f64) -> R<Q> {
    Q::from_float(x).ok_or_else(|| no("probe-range"))
}
fn dot(a: &P, b: &P) -> Q {
    (0..3).map(|k| &a[k] * &b[k]).sum()
}
fn cross(a: &P, b: &P) -> P {
    [(1, 2), (2, 0), (0, 1)].map(|(i, j)| &a[i] * &b[j] - &a[j] * &b[i])
}
fn enclose(x: &Q) -> R<Iv> {
    let m = x
        .to_f64()
        .filter(|x| x.is_finite())
        .ok_or_else(|| no("probe-range"))?;
    if q(m)? == *x {
        return Ok(Iv::point(m));
    }
    let lo = m.next_down();
    let hi = m.next_up();
    if !lo.is_finite() || !hi.is_finite() || q(lo)? > *x || q(hi)? < *x {
        return Err(no("probe-range"));
    }
    finite(Iv {
        m,
        r: (m - lo).max(hi - m).next_up(),
    })
}
pub(crate) fn probe(c: &Cylinder, point_mm: [f64; 3]) -> R<(f64, bool, f64)> {
    let map = |p, translate| -> R<P> {
        let e = c
            .frame
            .apply_exact(p, 1000., translate)
            .map_err(|_| no("probe-frame"))?;
        let mut out = std::array::from_fn(|_| Q::zero());
        for k in 0..3 {
            for &x in &e[k] {
                out[k] += q(x)?;
            }
        }
        Ok(out)
    };
    let [x, y, z] = [
        map([1., 0., 0.], false)?,
        map([0., 1., 0.], false)?,
        map([0., 0., 1.], false)?,
    ];
    let origin = map([0.; 3], true)?;
    let mut delta = std::array::from_fn(|_| Q::zero());
    for k in 0..3 {
        delta[k] = q(point_mm[k])? - &origin[k];
    }
    let det = dot(&x, &cross(&y, &z));
    if det <= Q::zero() {
        return Err(no("probe-frame"));
    }
    let p = [
        dot(&delta, &cross(&y, &z)) / &det,
        dot(&delta, &cross(&z, &x)) / &det,
        dot(&delta, &cross(&x, &y)) / &det,
    ];
    let k = c.spec.axis()?;
    let u = &p[(k + 1) % 3] - q(c.spec.bottom[(k + 1) % 3])?;
    let v = &p[(k + 2) % 3] - q(c.spec.bottom[(k + 2) % 3])?;
    let radial_squared = &u * &u + &v * &v;
    let radius = q(c.spec.radius)?;
    let axial = (q(c.spec.bottom[k])? - &p[k]).max(&p[k] - q(c.spec.top[k])?);
    // Boundary belongs to the closed solid. No epsilon or rounded inverse
    // participates in this sign decision, even for next-ulp and huge offsets.
    let inside = radial_squared <= &radius * &radius && axial <= Q::zero();
    if inside {
        return Ok((0., true, 0.));
    }
    let radial = (enclose(&u)?.norm3(enclose(&v)?, Iv::point(0.)) - Iv::point(c.spec.radius))
        .max(Iv::point(0.));
    let axial = enclose(&axial)?.max(Iv::point(0.));
    let local = finite(radial.norm3(axial, Iv::point(0.)) * Iv::point(1000.))?;
    let defect = c
        .frame
        .orthonormality_defect()
        .map_err(|_| no("probe-frame"))?;
    let distance = finite(
        local
            * Iv {
                m: 1.,
                r: (3. * defect).next_up(),
            },
    )?;
    Ok((distance.m, false, distance.r))
}
