//! Exact-rational helpers and the certified enclosures every carrier shares.
//! Rationals are decisions; binary64 enclosures are observations. Nothing in
//! here rounds a value that decides topology.
use crate::refusal::{Refusal, R};
use num_rational::BigRational;
use num_traits::{Signed, ToPrimitive, Zero};
use std::sync::OnceLock;
use wonky_num::{Iv, Scalar};

pub type Q = BigRational;
pub type P = [Q; 2];

/// Exact rational of a finite binary64 value (sources are validated finite).
pub fn q(x: f64) -> Q {
    Q::from_float(x).expect("validated finite source")
}
pub fn pt(p: [f64; 2]) -> P {
    p.map(q)
}
pub fn sub(a: &P, b: &P) -> P {
    [&a[0] - &b[0], &a[1] - &b[1]]
}
/// The rational square root of a non-negative rational, when it is one.
pub trait ExactScalar {
    fn as_rational(&self) -> Option<Q>;
    fn enclosed(&self) -> R<Iv>;
}
impl ExactScalar for Q {
    fn as_rational(&self) -> Option<Q> { Some(self.clone()) }
    fn enclosed(&self) -> R<Iv> { enclose_rational(self) }
}
impl ExactScalar for crate::radical::Radical {
    fn as_rational(&self) -> Option<Q> { self.rational() }
    fn enclosed(&self) -> R<Iv> { self.enclosure() }
}
pub fn exact_root(v: &impl ExactScalar) -> Option<Q> {
    let v = v.as_rational()?;
    let n = v.numer().sqrt();
    let d = v.denom().sqrt();
    (&n * &n == *v.numer() && &d * &d == *v.denom()).then(|| Q::new(n, d))
}
pub fn cross(a: &P, b: &P) -> Q {
    &a[0] * &b[1] - &a[1] * &b[0]
}
pub fn dot(a: &P, b: &P) -> Q {
    &a[0] * &b[0] + &a[1] * &b[1]
}

/// Smallest certified binary64 enclosure of an exact rational.
pub fn enclose(x: &impl ExactScalar) -> R<Iv> { x.enclosed() }
fn enclose_rational(x: &Q) -> R<Iv> {
    let m = x
        .to_f64()
        .filter(|v| v.is_finite())
        .ok_or(Refusal::NumericRange)?;
    if q(m) == *x {
        return Ok(Iv::point(m));
    }
    let (l, h) = (m.next_down(), m.next_up());
    if !l.is_finite() || !h.is_finite() || q(l) > *x || q(h) < *x {
        return Err(Refusal::NumericRange);
    }
    finite(Iv {
        m,
        r: (m - l).max(h - m).next_up(),
    })
}

pub fn finite(v: Iv) -> R<Iv> {
    if v.is_nan() || !v.lo().is_finite() || !v.hi().is_finite() {
        Err(Refusal::ObservationRange)
    } else {
        Ok(v)
    }
}

/// Machin's identity pi = 16 atan(1/5) - 4 atan(1/239), with exact alternating
/// rational series bounds. Conversion to binary64 is outward checked, cached.
pub fn pi() -> Iv {
    *PI.get_or_init(|| {
        let q = |n: i64| Q::from_integer(n.into());
        let atan = |d: i64| {
            let x = q(1) / q(d);
            let mut power = x.clone();
            let mut s = Q::zero();
            for k in 0..32 {
                let term = &power / q(2 * k + 1);
                s += if k % 2 == 0 { term } else { -term };
                power *= &x * &x;
            }
            let upper = &s + power / q(65);
            (s, upper)
        };
        let (al, ah) = atan(5);
        let (bl, bh) = atan(239);
        let lo = q(16) * al - q(4) * bh;
        let hi = q(16) * ah - q(4) * bl;
        let mut l = lo.to_f64().unwrap();
        while Q::from_float(l).unwrap() > lo {
            l = l.next_down();
        }
        let mut h = hi.to_f64().unwrap();
        while Q::from_float(h).unwrap() < hi {
            h = h.next_up();
        }
        Iv {
            m: l,
            r: (h - l).next_up(),
        }
    })
}
static PI: OnceLock<Iv> = OnceLock::new();

// atan in [0,1], reduced by the half-angle identity to [0,sqrt(2)-1].
// The alternating-series remainder is enclosed explicitly (no libm premise).
pub(crate) fn atan_unit(x: Iv) -> R<Iv> {
    let one = Iv::point(1.);
    let t = finite(x / (one + (one + x * x).sqrt()))?;
    if t.lo() < 0. || t.hi() >= 0.5 {
        return Err(Refusal::AngleRange);
    }
    let mut power = t;
    let mut sum = Iv::point(0.);
    for k in 0..48 {
        let term = power / Iv::point((2 * k + 1) as f64);
        sum = if k % 2 == 0 { sum + term } else { sum - term };
        power = power * t * t;
    }
    let rem = finite(power / Iv::point(97.))?.abs().hi();
    finite(Iv::point(2.) * (sum + Iv { m: 0., r: rem }))
}

/// Counter-clockwise angle in [0, 2 pi) of the vector (x, y), certified.
pub fn positive_angle(x: &Q, y: &Q) -> R<Iv> {
    let pi = pi();
    if y.is_zero() {
        return Ok(if x >= &Q::zero() { Iv::point(0.) } else { pi });
    }
    if x.is_zero() {
        return Ok(if y > &Q::zero() {
            pi / Iv::point(2.)
        } else {
            pi * Iv::point(1.5)
        });
    }
    let (ax, ay) = (x.abs(), y.abs());
    let acute = if ax >= ay {
        atan_unit(enclose(&(ay / ax))?)?
    } else {
        pi / Iv::point(2.) - atan_unit(enclose(&(ax / ay))?)?
    };
    Ok(match (x.is_positive(), y.is_positive()) {
        (true, true) => acute,
        (false, true) => pi - acute,
        (false, false) => pi + acute,
        (true, false) => pi * Iv::point(2.) - acute,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_root_is_the_rational_root_or_none() {
        assert_eq!(exact_root(&Q::new(9.into(), 4.into())), Some(Q::new(3.into(), 2.into())));
        assert_eq!(exact_root(&q(0.)), Some(q(0.)));
        assert_eq!(exact_root(&q(2.)), None);
        assert_eq!(exact_root(&Q::new(1.into(), 3.into())), None);
        assert_eq!(exact_root(&Q::new(2.into(), 9.into())), None);
    }
}
