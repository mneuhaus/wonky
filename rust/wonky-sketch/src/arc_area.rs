//! Certified signed double-area of circular arcs through three f64 points.
//! All point and circle arithmetic is exact rational; atan uses alternating
//! series with a rational remainder enclosure. No libm angle decides a sign.
use num_rational::BigRational as R;
use num_traits::{FromPrimitive, One, Signed, ToPrimitive, Zero};
use std::sync::OnceLock;
use wonky_num::P2;

use crate::Refusal;

fn q(x: f64) -> Result<R, Refusal> {
    R::from_f64(x).ok_or(Refusal::NumericDecision)
}
fn cross(a: (&R, &R), b: (&R, &R)) -> R {
    a.0 * b.1 - a.1 * b.0
}
fn pi_bounds() -> &'static (R, R) {
    static PI: OnceLock<(R, R)> = OnceLock::new();
    PI.get_or_init(|| {
        // Machin's formula pi = 16 atan(1/5) - 4 atan(1/239).
        let (al, ah) = atan_small(&R::new(1.into(), 5.into()));
        let (bl, bh) = atan_small(&R::new(1.into(), 239.into()));
        (
            R::from_integer(16.into()) * al - R::from_integer(4.into()) * bh,
            R::from_integer(16.into()) * ah - R::from_integer(4.into()) * bl,
        )
    })
}
fn atan_small(x: &R) -> (R, R) {
    debug_assert!(*x >= R::zero() && *x <= R::new(1.into(), 2.into()));
    let x2 = x * x;
    let mut term = x.clone();
    let mut partial = R::zero();
    // Alternating series: consecutive partial sums enclose atan(x), including x=0.
    for n in 0..32 {
        let fraction = &term / R::from_integer((2 * n + 1).into());
        if n % 2 == 0 {
            partial += fraction
        } else {
            partial -= fraction
        }
        term *= &x2;
    }
    let next = &term / R::from_integer(65.into());
    (partial.clone(), partial + next)
}
fn atan_positive(x: &R, pi: &(R, R)) -> (R, R) {
    let half = R::new(1.into(), 2.into());
    if x <= &half {
        atan_small(x)
    } else if x <= &R::one() {
        let t = (x - R::one()) / (x + R::one());
        let (lo, hi) = atan_small(&(-t));
        // atan(x) = pi/4 - atan((1-x)/(1+x)).
        (
            &pi.0 / R::from_integer(4.into()) - hi,
            &pi.1 / R::from_integer(4.into()) - lo,
        )
    } else {
        let (lo, hi) = atan_positive(&(R::one() / x), pi);
        (
            &pi.0 / R::from_integer(2.into()) - hi,
            &pi.1 / R::from_integer(2.into()) - lo,
        )
    }
}
fn atan2_bounds(y: &R, x: &R, pi: &(R, R)) -> (R, R) {
    if y.is_zero() {
        if *x < R::zero() {
            return (pi.0.clone(), pi.1.clone());
        }
        return (R::zero(), R::zero());
    }
    let (lo, hi) = if x.is_zero() {
        (
            &pi.0 / R::from_integer(2.into()),
            &pi.1 / R::from_integer(2.into()),
        )
    } else {
        let ratio = y.abs() / x.abs();
        let (lo, hi) = atan_positive(&ratio, pi);
        if *x < R::zero() {
            (&pi.0 - hi, &pi.1 - lo)
        } else {
            (lo, hi)
        }
    };
    if *y < R::zero() {
        (-hi, -lo)
    } else {
        (lo, hi)
    }
}
fn point(p: P2) -> Result<(R, R), Refusal> {
    Ok((q(p.x)?, q(p.y)?))
}

/// Exact area enclosure for the directed arc from start through mid to end.
/// Returns (lower, upper) for its Green-integral doubled-area contribution.
pub(crate) fn arc_area(start: P2, mid: P2, end: P2) -> Result<(R, R), Refusal> {
    let a = point(start)?;
    let b = point(mid)?;
    let c = point(end)?;
    let ab = (&b.0 - &a.0, &b.1 - &a.1);
    let ac = (&c.0 - &a.0, &c.1 - &a.1);
    let det = cross((&ab.0, &ab.1), (&ac.0, &ac.1));
    if det.is_zero() {
        return Err(Refusal::Degenerate);
    }
    let ab2 = &ab.0 * &ab.0 + &ab.1 * &ab.1;
    let ac2 = &ac.0 * &ac.0 + &ac.1 * &ac.1;
    // Center = start + intersection of the two perpendicular bisectors.
    let ox = &a.0 + (&ab2 * &ac.1 - &ac2 * &ab.1) / (R::from_integer(2.into()) * &det);
    let oy = &a.1 + (&ac2 * &ab.0 - &ab2 * &ac.0) / (R::from_integer(2.into()) * &det);
    let u = (&a.0 - &ox, &a.1 - &oy);
    let v = (&b.0 - &ox, &b.1 - &oy);
    let w = (&c.0 - &ox, &c.1 - &oy);
    let radius2 = &u.0 * &u.0 + &u.1 * &u.1;
    let uv = cross((&u.0, &u.1), (&v.0, &v.1));
    let vw = cross((&v.0, &v.1), (&w.0, &w.1));
    let uw = cross((&u.0, &u.1), (&w.0, &w.1));
    let dot = &u.0 * &w.0 + &u.1 * &w.1;
    // Decide whether the midpoint lies on the CCW sweep start -> end.
    let via_ccw = if uw > R::zero() {
        uv >= R::zero() && vw >= R::zero()
    } else if uw < R::zero() {
        uv >= R::zero() || vw >= R::zero()
    } else {
        uv > R::zero()
    };
    let pi = pi_bounds();
    let (mut low, mut high) = atan2_bounds(&uw, &dot, pi);
    if via_ccw && uw < R::zero() {
        low += R::from_integer(2.into()) * &pi.0;
        high += R::from_integer(2.into()) * &pi.1;
    } else if !via_ccw && uw > R::zero() {
        low -= R::from_integer(2.into()) * &pi.1;
        high -= R::from_integer(2.into()) * &pi.0;
    } else if uw.is_zero() && dot < R::zero() && !via_ccw {
        (low, high) = (-&pi.1, -&pi.0);
    }
    #[cfg(feature = "plant_arc_chord_area")]
    return line_area(start, end).map(|chord| (chord.clone(), chord));
    let base = cross((&a.0, &a.1), (&c.0, &c.1)) - uw;
    Ok((base.clone() + &radius2 * low, base + radius2 * high))
}

pub(crate) fn line_area(start: P2, end: P2) -> Result<R, Refusal> {
    let a = point(start)?;
    let b = point(end)?;
    Ok(cross((&a.0, &a.1), (&b.0, &b.1)))
}

/// Rational circle and oriented arc, also used for conservative intersection
/// rejection. Unknown contacts refuse rather than emitting an invalid face.
pub(crate) struct ArcGeometry {
    center: (R, R),
    radius2: R,
    start: (R, R),
    end: (R, R),
    ccw: bool,
}
fn ray_half(origin: (&R, &R), p: (&R, &R)) -> bool {
    let cp = cross(origin, p);
    cp < R::zero() || (cp.is_zero() && origin.0 * p.0 + origin.1 * p.1 < R::zero())
}
fn ccw_contains(s: (&R, &R), q: (&R, &R), e: (&R, &R)) -> bool {
    let qh = ray_half(s, q);
    let eh = ray_half(s, e);
    (!qh && eh) || (qh == eh && cross(q, e) >= R::zero())
}
impl ArcGeometry {
    pub(crate) fn new(start: P2, mid: P2, end: P2) -> Result<Self, Refusal> {
        let a = point(start)?;
        let b = point(mid)?;
        let c = point(end)?;
        let ab = (&b.0 - &a.0, &b.1 - &a.1);
        let ac = (&c.0 - &a.0, &c.1 - &a.1);
        let det = cross((&ab.0, &ab.1), (&ac.0, &ac.1));
        if det.is_zero() {
            return Err(Refusal::Degenerate);
        }
        let ab2 = &ab.0 * &ab.0 + &ab.1 * &ab.1;
        let ac2 = &ac.0 * &ac.0 + &ac.1 * &ac.1;
        let ox = &a.0 + (&ab2 * &ac.1 - &ac2 * &ab.1) / (R::from_integer(2.into()) * &det);
        let oy = &a.1 + (&ac2 * &ab.0 - &ab2 * &ac.0) / (R::from_integer(2.into()) * &det);
        let u = (&a.0 - &ox, &a.1 - &oy);
        let v = (&b.0 - &ox, &b.1 - &oy);
        let w = (&c.0 - &ox, &c.1 - &oy);
        let ccw = ccw_contains((&u.0, &u.1), (&v.0, &v.1), (&w.0, &w.1));
        let radius2 = &u.0 * &u.0 + &u.1 * &u.1;
        Ok(Self {
            center: (ox, oy),
            radius2,
            start: a,
            end: c,
            ccw,
        })
    }
    fn contains_ray(&self, x: &R, y: &R) -> bool {
        let a = (
            &self.start.0 - &self.center.0,
            &self.start.1 - &self.center.1,
        );
        let b = (&self.end.0 - &self.center.0, &self.end.1 - &self.center.1);
        if self.ccw {
            ccw_contains((&a.0, &a.1), (x, y), (&b.0, &b.1))
        } else {
            ccw_contains((&b.0, &b.1), (x, y), (&a.0, &a.1))
        }
    }
    pub(crate) fn contains(&self, x: &R, y: &R) -> bool {
        self.contains_ray(&(x - &self.center.0), &(y - &self.center.1))
    }
    /// Tight bounding interval except for <=1 ulp of rational radius enclosure.
    pub(crate) fn bounds(&self) -> Result<[(R, R); 2], Refusal> {
        let approximate = self
            .radius2
            .to_f64()
            .ok_or(Refusal::NumericDecision)?
            .sqrt();
        if !approximate.is_finite() || approximate <= 0.0 {
            return Err(Refusal::NumericDecision);
        }
        let mut lo = q(approximate)?;
        let mut hi = lo.clone();
        // sqrt of an exact rational lies between adjacent representable floats.
        for _ in 0..8 {
            if &lo * &lo <= self.radius2 {
                break;
            }
            let bits = lo.to_f64().ok_or(Refusal::NumericDecision)?.to_bits();
            lo = q(f64::from_bits(bits - 1))?;
        }
        for _ in 0..8 {
            if &hi * &hi >= self.radius2 {
                break;
            }
            let bits = hi.to_f64().ok_or(Refusal::NumericDecision)?.to_bits();
            hi = q(f64::from_bits(bits + 1))?;
        }
        if &lo * &lo > self.radius2 || &hi * &hi < self.radius2 {
            return Err(Refusal::NumericDecision);
        }
        let mut bounds = [
            (
                self.start.0.clone().min(self.end.0.clone()),
                self.start.0.clone().max(self.end.0.clone()),
            ),
            (
                self.start.1.clone().min(self.end.1.clone()),
                self.start.1.clone().max(self.end.1.clone()),
            ),
        ];
        for (axis, sign, dx, dy) in [(0, 1, 1, 0), (0, -1, -1, 0), (1, 1, 0, 1), (1, -1, 0, -1)] {
            let direction = (R::from_integer(dx.into()), R::from_integer(dy.into()));
            if self.contains_ray(&direction.0, &direction.1) {
                let val = if sign > 0 {
                    &self.center.0 + &hi
                } else {
                    &self.center.0 - &hi
                };
                let val = if axis == 1 {
                    if sign > 0 {
                        &self.center.1 + &hi
                    } else {
                        &self.center.1 - &hi
                    }
                } else {
                    val
                };
                if sign > 0 {
                    bounds[axis].1 = val;
                } else {
                    bounds[axis].0 = val;
                }
            }
        }
        Ok(bounds)
    }
    /// The only other intersection of two distinct circles given shared point p.
    pub(crate) fn same_circle(&self, other: &Self) -> bool {
        self.center == other.center && self.radius2 == other.radius2
    }
    pub(crate) fn other_circle_intersection(
        &self,
        other: &Self,
        p: P2,
    ) -> Result<Option<(R, R)>, Refusal> {
        let delta = (
            &other.center.0 - &self.center.0,
            &other.center.1 - &self.center.1,
        );
        let den = &delta.0 * &delta.0 + &delta.1 * &delta.1;
        if den.is_zero() {
            return Err(Refusal::UnsupportedIntersection);
        }
        let p = point(p)?;
        let proj = ((&p.0 - &self.center.0) * &delta.0 + (&p.1 - &self.center.1) * &delta.1) / den;
        let q = (
            &self.center.0 * R::from_integer(2.into())
                + &delta.0 * &proj * R::from_integer(2.into())
                - &p.0,
            &self.center.1 * R::from_integer(2.into())
                + &delta.1 * &proj * R::from_integer(2.into())
                - &p.1,
        );
        if q == p {
            Ok(None)
        } else {
            Ok(Some(q))
        }
    }
    pub(crate) fn other_line_intersection(
        &self,
        shared: P2,
        other: P2,
    ) -> Result<Option<(R, R)>, Refusal> {
        let p = point(shared)?;
        let v = point(other)?;
        let d = (&v.0 - &p.0, &v.1 - &p.1);
        let den = &d.0 * &d.0 + &d.1 * &d.1;
        if den.is_zero() {
            return Err(Refusal::Degenerate);
        }
        let factor = R::from_integer((-2).into())
            * ((&p.0 - &self.center.0) * &d.0 + (&p.1 - &self.center.1) * &d.1)
            / den;
        let q = (&p.0 + &factor * &d.0, &p.1 + &factor * &d.1);
        if q == p {
            Ok(None)
        } else {
            Ok(Some(q))
        }
    }
}

pub(crate) fn line_bounds(a: P2, b: P2) -> Result<[(R, R); 2], Refusal> {
    let a = point(a)?;
    let b = point(b)?;
    Ok([
        (a.0.clone().min(b.0.clone()), a.0.max(b.0)),
        (a.1.clone().min(b.1.clone()), a.1.max(b.1)),
    ])
}
pub(crate) fn in_line_segment(p: &(R, R), a: P2, b: P2) -> Result<bool, Refusal> {
    let bounds = line_bounds(a, b)?;
    Ok(p.0 >= bounds[0].0 && p.0 <= bounds[0].1 && p.1 >= bounds[1].0 && p.1 <= bounds[1].1)
}
