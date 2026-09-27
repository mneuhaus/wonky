//! Private outward-rounded endpoint arithmetic. No libm error assumptions.
//! One adjacent binary64 value covers rounding, including gradual underflow.
//! Invalid operands stay invalid; in particular min/max never erase a NaN.

use std::ops::{Add, Div, Mul, Neg, Sub};

#[derive(Clone, Copy, Debug)]
pub(super) struct I {
    pub lo: f64,
    pub hi: f64,
}

pub(super) fn up(x: f64) -> f64 {
    if x.is_nan() || x == f64::INFINITY {
        return x;
    }
    if x == 0.0 {
        return f64::from_bits(1);
    }
    f64::from_bits(if x > 0.0 {
        x.to_bits() + 1
    } else {
        x.to_bits() - 1
    })
}
pub(super) fn down(x: f64) -> f64 {
    -up(-x)
}

impl I {
    pub const BAD: Self = Self {
        lo: f64::NAN,
        hi: f64::NAN,
    };
    pub const ZERO: Self = Self::point(0.0);
    pub const ONE: Self = Self::point(1.0);
    pub const fn point(x: f64) -> Self {
        Self { lo: x, hi: x }
    }
    pub fn valid(self) -> bool {
        self.lo.is_finite() && self.hi.is_finite() && self.lo <= self.hi
    }
    pub fn abs_max(self) -> f64 {
        if !self.valid() {
            f64::NAN
        } else {
            self.lo.abs().max(self.hi.abs())
        }
    }
    pub fn width(self) -> f64 {
        if !self.valid() {
            f64::NAN
        } else if self.lo == self.hi {
            0.0
        } else {
            up(self.hi - self.lo)
        }
    }
    pub fn hull(self, b: Self) -> Self {
        if !self.valid() || !b.valid() {
            Self::BAD
        } else {
            Self {
                lo: self.lo.min(b.lo),
                hi: self.hi.max(b.hi),
            }
        }
    }
    pub fn expand(self, r: f64) -> Self {
        if !r.is_finite() || r < 0.0 {
            Self::BAD
        } else {
            self + Self { lo: -r, hi: r }
        }
    }
    pub fn sqrt(self) -> Self {
        if !self.valid() || self.lo < 0.0 {
            return Self::BAD;
        }
        Self {
            lo: if self.lo == 0.0 {
                0.0
            } else {
                down(self.lo.sqrt())
            },
            hi: if self.hi == 0.0 {
                0.0
            } else {
                up(self.hi.sqrt())
            },
        }
    }
    pub fn pow(self, n: usize) -> Self {
        let mut y = Self::ONE;
        for _ in 0..n {
            y = y * self;
        }
        y
    }
}
impl Add for I {
    type Output = Self;
    fn add(self, b: Self) -> Self {
        if !self.valid() || !b.valid() {
            return Self::BAD;
        }
        if b.lo == 0.0 && b.hi == 0.0 {
            return self;
        }
        if self.lo == 0.0 && self.hi == 0.0 {
            return b;
        }
        Self {
            lo: down(self.lo + b.lo),
            hi: up(self.hi + b.hi),
        }
    }
}
impl Neg for I {
    type Output = Self;
    fn neg(self) -> Self {
        Self {
            lo: -self.hi,
            hi: -self.lo,
        }
    }
}
impl Sub for I {
    type Output = Self;
    fn sub(self, b: Self) -> Self {
        self + -b
    }
}
impl Mul for I {
    type Output = Self;
    fn mul(self, b: Self) -> Self {
        if !self.valid() || !b.valid() {
            return Self::BAD;
        }
        if (self.lo == 0.0 && self.hi == 0.0) || (b.lo == 0.0 && b.hi == 0.0) {
            return Self::ZERO;
        }
        let p = [
            self.lo * b.lo,
            self.lo * b.hi,
            self.hi * b.lo,
            self.hi * b.hi,
        ];
        if p.iter().any(|x| !x.is_finite()) {
            return Self::BAD;
        }
        Self {
            lo: down(p.iter().copied().fold(f64::INFINITY, f64::min)),
            hi: up(p.iter().copied().fold(f64::NEG_INFINITY, f64::max)),
        }
    }
}
impl Div for I {
    type Output = Self;
    fn div(self, b: Self) -> Self {
        if !self.valid() || !b.valid() || (b.lo <= 0.0 && b.hi >= 0.0) {
            return Self::BAD;
        }
        self * Self {
            lo: down(1.0 / b.hi),
            hi: up(1.0 / b.lo),
        }
    }
}
