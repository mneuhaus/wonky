//! Ball intervals for certified comparisons. Invalid operations propagate an
//! invalid ball; the only decision boundary returns named Unresolved, never a
//! finite certificate manufactured from NaN, infinity or an invalid domain.
use crate::decision::{Decision, Sign, Undecided, UndecidedKind};
use crate::expansion::PRODUCT_MIN;
use std::ops::{Add, Div, Mul, Neg, Sub};

// Error-bound audit: endpoint arithmetic rounds OUTWARD, one representable
// step after each correctly-rounded IEEE operation. For finite exact x,
// next_down(fl(x)) <= x <= next_up(fl(x)), including gradual underflow
// (the absolute allowance is one subnormal ulp, 2^-1074). No relative-only
// bound, epsilon inflation or unamplified absolute term is used.
//
// lo/hi enclose m +/- r; add/sub apply monotonicity; mul/div evaluate all
// four endpoint combinations and round each outwards BEFORE taking extrema.
// Thus later multipliers also multiply every earlier rounding allowance.
// Division requires 0 outside the denominator interval. sqrt requires the
// WHOLE interval nonnegative, and rounds sqrt of both endpoints outwards.
// abs/min/max use their monotone endpoint formulas. from_bounds chooses any
// finite midpoint m and r=max(up(hi-m),up(m-lo)), so m +/- r encloses
// both bounds regardless of midpoint rounding. Overflow anywhere refuses.
//
// Exact singleton shortcuts: TwoSum is error-free for finite results;
// FMA residuals are trusted only above PRODUCT_MIN, where the residual is
// representable (see expansion.rs). This includes the PRODUCT in quotient
// and square-root residuals, not just the quotient/root: a large quotient
// may multiply a tiny divisor and lose its residual to underflow.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Iv {
    pub m: f64,
    pub r: f64,
}

impl Iv {
    fn invalid() -> Self {
        Self { m: f64::NAN, r: f64::NAN }
    }
    fn valid(self) -> bool {
        self.m.is_finite() && self.r.is_finite() && self.r >= 0.0 && (self.m - self.r).is_finite() && (self.m + self.r).is_finite()
    }
    pub fn point(x: f64) -> Self {
        if x.is_finite() {
            Self { m: x, r: 0.0 }
        } else {
            Self::invalid()
        }
    }
    pub fn mid(self) -> f64 {
        self.m
    }
    pub fn is_nan(self) -> bool {
        !self.valid()
    }
    // Published outward endpoints may be +/-infinity for a valid finite ball
    // next to +/-f64::MAX. The finite m/r ball remains valid; callers must
    // treat an infinite outward endpoint as an unbounded certificate.
    pub fn lo(self) -> f64 {
        if !self.valid() {
            f64::NAN
        } else if self.r == 0.0 {
            self.m
        } else {
            (self.m - self.r).next_down()
        }
    }
    pub fn hi(self) -> f64 {
        if !self.valid() {
            f64::NAN
        } else if self.r == 0.0 {
            self.m
        } else {
            (self.m + self.r).next_up()
        }
    }
    fn from_bounds(lo: f64, hi: f64) -> Self {
        if !lo.is_finite() || !hi.is_finite() || lo > hi {
            return Self::invalid();
        }
        if lo == hi {
            return Self::point(lo);
        }
        let m = 0.5 * lo + 0.5 * hi;
        let r = (hi - m).next_up().max((m - lo).next_up());
        let out = Self { m, r };
        if out.valid() {
            out
        } else {
            Self::invalid()
        }
    }
    // A Cartesian product evaluated with one outward step per endpoint.
    fn corners(self, o: Self, f: impl Fn(f64, f64) -> f64) -> Self {
        if !self.valid() || !o.valid() {
            return Self::invalid();
        }
        let values = [f(self.lo(), o.lo()), f(self.lo(), o.hi()), f(self.hi(), o.lo()), f(self.hi(), o.hi())];
        if values.iter().any(|x| !x.is_finite()) {
            return Self::invalid();
        }
        let lo = values.iter().copied().fold(f64::INFINITY, f64::min).next_down();
        let hi = values.iter().copied().fold(f64::NEG_INFINITY, f64::max).next_up();
        Self::from_bounds(lo, hi)
    }
}
impl Add for Iv {
    type Output = Self;
    fn add(self, o: Self) -> Self {
        if !self.valid() || !o.valid() {
            return Self::invalid();
        }
        let m = self.m + o.m;
        if self.r == 0.0 && o.r == 0.0 && m.is_finite() {
            let bb = m - self.m;
            let e = (self.m - (m - bb)) + (o.m - bb);
            if e == 0.0 {
                return Self::point(m);
            }
        }
        Self::from_bounds((self.lo() + o.lo()).next_down(), (self.hi() + o.hi()).next_up())
    }
}
impl Neg for Iv {
    type Output = Self;
    fn neg(self) -> Self {
        if self.valid() {
            Self { m: -self.m, r: self.r }
        } else {
            Self::invalid()
        }
    }
}
impl Sub for Iv {
    type Output = Self;
    fn sub(self, o: Self) -> Self {
        self + (-o)
    }
}
impl Mul for Iv {
    type Output = Self;
    fn mul(self, o: Self) -> Self {
        if !self.valid() || !o.valid() {
            return Self::invalid();
        }
        let m = self.m * o.m;
        if self.r == 0.0 && o.r == 0.0 && m.is_finite() && (m.abs() >= PRODUCT_MIN || self.m == 0.0 || o.m == 0.0) && self.m.mul_add(o.m, -m) == 0.0 {
            return Self::point(m);
        }
        self.corners(o, |a, b| a * b)
    }
}
impl Div for Iv {
    type Output = Self;
    fn div(self, o: Self) -> Self {
        if !self.valid() || !o.valid() || (o.lo() <= 0.0 && o.hi() >= 0.0) {
            return Self::invalid();
        }
        let m = self.m / o.m;
        if self.r == 0.0 && o.r == 0.0 && m.is_finite() && (self.m.abs() >= 2.0 * PRODUCT_MIN || self.m == 0.0) && (-m).mul_add(o.m, self.m) == 0.0 {
            return Self::point(m);
        }
        self.corners(o, |a, b| a / b)
    }
}
// ---------------------------------------------------------------- scalar trait

pub trait Scalar: Copy + Add<Output = Self> + Sub<Output = Self> + Mul<Output = Self> + Div<Output = Self> + Neg<Output = Self> {
    fn c(x: f64) -> Self;
    fn sqrt(self) -> Self;
    fn norm3(self, y: Self, z: Self) -> Self {
        (self * self + y * y + z * z).sqrt()
    }
    fn abs(self) -> Self;
    fn max(self, o: Self) -> Self;
    fn min(self, o: Self) -> Self;
}

impl Scalar for f64 {
    #[inline]
    fn c(x: f64) -> f64 {
        x
    }
    #[inline]
    fn sqrt(self) -> f64 {
        f64::sqrt(self)
    }
    #[inline]
    fn abs(self) -> f64 {
        f64::abs(self)
    }
    #[inline]
    fn max(self, o: f64) -> f64 {
        // Bend R.max(a, b) = if less(a, b) then b else a
        if self < o {
            o
        } else {
            self
        }
    }
    #[inline]
    fn min(self, o: f64) -> f64 {
        if self < o {
            self
        } else {
            o
        }
    }
}

impl Scalar for Iv {
    fn norm3(self, y: Self, z: Self) -> Self {
        let components = [self, y, z];
        if components.iter().any(|v| !v.valid()) {
            return Self::invalid();
        }
        if components.iter().all(|v| v.r == 0.0) {
            let square = self * self + y * y + z * z;
            if square.r == 0.0 {
                return square.sqrt();
            }
        }
        // Unlike an arbitrary sqrt argument, a sum of squares is KNOWN
        // nonnegative. Compute its lower/upper bounds from |component|,
        // rounding every product and sum outward, then intersect with [0,+inf)
        // using that proof (not by silently clamping a generic sqrt domain).
        let (mut lo, mut hi) = (0.0f64, 0.0f64);
        for c in components {
            let (l, h) = (c.lo(), c.hi());
            let lower = if l <= 0.0 && h >= 0.0 { 0.0 } else { l.abs().min(h.abs()) };
            let upper = l.abs().max(h.abs());
            lo = (lo + (lower * lower).next_down().max(0.0)).next_down().max(0.0);
            hi = (hi + (upper * upper).next_up()).next_up();
        }
        Self::from_bounds(lo.sqrt().next_down().max(0.0), hi.sqrt().next_up())
    }
    fn c(x: f64) -> Self {
        Self::point(x)
    }
    fn sqrt(self) -> Self {
        if !self.valid() || self.lo() < 0.0 {
            return Self::invalid();
        }
        let m = self.m.sqrt();
        if self.r == 0.0 && (self.m >= 2.0 * PRODUCT_MIN || self.m == 0.0) && (-m).mul_add(m, self.m) == 0.0 {
            return Self::point(m);
        }
        Self::from_bounds(self.lo().sqrt().next_down().max(0.0), self.hi().sqrt().next_up())
    }
    fn abs(self) -> Self {
        if !self.valid() {
            return Self::invalid();
        }
        if self.lo() >= 0.0 {
            self
        } else if self.hi() <= 0.0 {
            -self
        } else {
            Self::from_bounds(0.0, self.hi().max(-self.lo()))
        }
    }
    fn max(self, o: Self) -> Self {
        if !self.valid() || !o.valid() {
            return Self::invalid();
        }
        if self.lo() >= o.hi() {
            self
        } else if o.lo() >= self.hi() {
            o
        } else {
            Self::from_bounds(self.lo().max(o.lo()), self.hi().max(o.hi()))
        }
    }
    fn min(self, o: Self) -> Self {
        if !self.valid() || !o.valid() {
            return Self::invalid();
        }
        if self.hi() <= o.lo() {
            self
        } else if o.hi() <= self.lo() {
            o
        } else {
            Self::from_bounds(self.lo().min(o.lo()), self.hi().min(o.hi()))
        }
    }
}

// ---------------------------------------------------------------- decisions

/// Certified sign of the value enclosed by `v`. An exact zero (r == 0) is Zero;
/// a ball that contains zero without being exact is Unresolved.
#[inline]
pub fn decide(v: Iv, site: &'static str) -> Decision {
    if !v.valid() {
        return Err(Undecided::new(site, UndecidedKind::Unresolved));
    }
    if v.lo() > 0.0 {
        Ok(Sign::Positive)
    } else if v.hi() < 0.0 {
        Ok(Sign::Negative)
    } else if v.m == 0.0 && v.r == 0.0 {
        Ok(Sign::Zero)
    } else {
        Err(Undecided::new(site, UndecidedKind::Unresolved))
    }
}

/// a < b, certified (the spike's num::lt without the sticky flag).
#[inline]
pub fn lt(a: Iv, b: Iv, site: &'static str) -> Result<bool, Undecided> {
    if !a.valid() || !b.valid() {
        return Err(Undecided::new(site, UndecidedKind::Unresolved));
    }
    if a.hi() < b.lo() {
        Ok(true)
    } else if a.lo() >= b.hi() {
        Ok(false)
    } else {
        Err(Undecided::new(site, UndecidedKind::Unresolved))
    }
}

/// a <= b, certified (Bend I.at_most; the spike's num::le without the sticky flag).
#[inline]
pub fn le(a: Iv, b: Iv, site: &'static str) -> Result<bool, Undecided> {
    if !a.valid() || !b.valid() {
        return Err(Undecided::new(site, UndecidedKind::Unresolved));
    }
    if a.hi() <= b.lo() {
        Ok(true)
    } else if a.lo() > b.hi() {
        Ok(false)
    } else {
        Err(Undecided::new(site, UndecidedKind::Unresolved))
    }
}
