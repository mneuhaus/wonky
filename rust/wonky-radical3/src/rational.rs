//! Single-root rational extension for construction-frame SSI. Unlike Dyadic,
//! inverse-frame coefficients need arbitrary rational denominators. The same
//! sign-aware squaring rule as Radical3 is exact without an expansion budget.
use num_rational::BigRational as Q;
use num_traits::{Signed, Zero};
use std::cmp::Ordering;

/// a + b sqrt(d), principal root. No floating-point observation is authority.
// Structural root expressions are not numeric equality (sqrt(9) equals 3).
// Callers decide equality by a supported exact difference and sign().
#[derive(Clone, Debug)]
pub struct Quadratic {
    a: Q,
    b: Q,
    d: Q,
}
impl Quadratic {
    pub fn new(a: Q, b: Q, d: Q) -> Option<Self> {
        if d.is_negative() {
            None
        } else {
            Some(Self { a, b, d })
        }
    }
    pub fn rational(a: Q) -> Self {
        Self {
            a,
            b: Q::zero(),
            d: Q::zero(),
        }
    }
    pub fn shifted_scaled(&self, shift: &Q, scale: &Q) -> Self {
        Self {
            a: shift + scale * &self.a,
            b: scale * &self.b,
            d: self.d.clone(),
        }
    }
    /// Addition remains in the same root field. Different nontrivial roots
    /// require Radical3/a wider rational class; they are never approximated.
    pub fn plus(&self, other: &Self) -> Option<Self> {
        if self.b.is_zero() || self.d.is_zero() {
            Some(other.shifted_scaled(&self.a, &Q::from_integer(1.into())))
        } else if other.b.is_zero() || other.d.is_zero() {
            Some(self.shifted_scaled(&other.a, &Q::from_integer(1.into())))
        } else if self.d == other.d {
            Some(Self {
                a: &self.a + &other.a,
                b: &self.b + &other.b,
                d: self.d.clone(),
            })
        } else {
            None
        }
    }
    pub fn sign(&self) -> Ordering {
        let sa = self.a.cmp(&Q::zero());
        let sb = self.b.cmp(&Q::zero());
        if self.d.is_zero() || sb == Ordering::Equal {
            return sa;
        }
        if sa == Ordering::Equal || sa == sb {
            return sb;
        }
        let delta = &self.a * &self.a - &self.b * &self.b * &self.d;
        let sign = delta.cmp(&Q::zero());
        if sa == Ordering::Less {
            sign.reverse()
        } else {
            sign
        }
    }
    /// Polynomial coefficients for independent incidence checks and clients
    /// that retain the root symbol instead of materializing it as binary64.
    pub fn coefficients(&self) -> (&Q, &Q, &Q) {
        (&self.a, &self.b, &self.d)
    }
}
