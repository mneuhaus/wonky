//! Transient rational probe predicates in exact composed construction frames.
//! Membership never depends on a rounded inverse or distance. Only observations
//! are converted back to binary64, with checked interval enclosures.
use crate::placement::Placement;
use num_rational::BigRational as Q;
use num_traits::{ToPrimitive, Zero};
use std::cmp::Ordering;
use wonky_num::{Iv, Scalar};

type R<T> = Result<T, &'static str>;
pub(crate) type Point = [Q; 3];
pub(crate) fn q(x: f64) -> R<Q> {
    Q::from_float(x).ok_or("probe-range")
}
fn dot(a: &Point, b: &Point) -> Q {
    (0..3).map(|k| &a[k] * &b[k]).sum()
}
fn cross(a: &Point, b: &Point) -> Point {
    [(1, 2), (2, 0), (0, 1)].map(|(i, j)| &a[i] * &b[j] - &a[j] * &b[i])
}
pub(crate) fn enclose(x: &Q) -> R<Iv> {
    let m = x.to_f64().filter(|x| x.is_finite()).ok_or("probe-range")?;
    if q(m)? == *x {
        return Ok(Iv::point(m));
    }
    let lo = m.next_down();
    let hi = m.next_up();
    if !lo.is_finite() || !hi.is_finite() || q(lo)? > *x || q(hi)? < *x {
        return Err("probe-range");
    }
    let out = Iv { m, r: (m - lo).max(hi - m).next_up() };
    if !out.lo().is_finite() || !out.hi().is_finite() {
        return Err("probe-range");
    }
    Ok(out)
}
pub(crate) fn local_point(frame: &Placement, point_mm: [f64; 3]) -> R<Point> {
    let map = |p, translate| -> R<Point> {
        let e = frame.apply_exact(p, 1000., translate).map_err(|_| "probe-frame")?;
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
        return Err("probe-frame");
    }
    Ok([
        dot(&delta, &cross(&y, &z)) / &det,
        dot(&delta, &cross(&z, &x)) / &det,
        dot(&delta, &cross(&x, &y)) / &det,
    ])
}
pub(crate) struct Radial {
    pub comparison: Ordering,
    u: Q,
    v: Q,
    radius: f64,
}
impl Radial {
    /// Signed radial offset: positive outside the cylinder, negative in it.
    pub fn offset(&self) -> R<Iv> {
        Ok(enclose(&self.u)?.norm3(enclose(&self.v)?, Iv::point(0.)) - Iv::point(self.radius))
    }
}
pub(crate) fn radial(point: &Point, axis: usize, center: [f64; 3], radius: f64) -> R<Radial> {
    let u = &point[(axis + 1) % 3] - q(center[(axis + 1) % 3])?;
    let v = &point[(axis + 2) % 3] - q(center[(axis + 2) % 3])?;
    let r = q(radius)?;
    let comparison = (&u * &u + &v * &v).cmp(&(&r * &r));
    Ok(Radial { comparison, u, v, radius })
}
