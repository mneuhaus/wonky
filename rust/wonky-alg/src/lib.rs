//! Exact univariate algebra for intersection equations, with no floating-point decisions.
//!
//! Coefficients are arbitrary-precision rationals in ascending power order. Integers
//! embed exactly. Root intervals are closed, rational, and pairwise strictly disjoint;
//! a point interval denotes an exactly rational root. Multiplicities are preserved.
//! [`AlgebraicReal`] cannot be constructed without a checked isolation certificate.
//!
//! All public rational inputs are validated, including `BigRational::new_raw` values
//! with a zero or negative denominator. A zero denominator is a named error, never
//! an arithmetic panic. Limits bound bisections, not total time or integer bit sizes;
//! every exhausted limit is `AlgebraError::BudgetExceeded`, never a partial result.
//! Root counts are over distinct real roots; the interval convention is in the
//! method name (open, half-open `[lower, upper)`, closed).
//! No-Claim: this crate does not derive surface intersection equations, resolve
//! geometric degeneracies, approximate coordinates, or establish R20 acceptance.
#![deny(unused_must_use)]

mod bernstein;
mod polynomial;
mod roots;

pub use num_bigint::BigInt;
pub use num_rational::BigRational as Rational;
pub use polynomial::{Deflation, Polynomial, SquareFreeDecomposition, SquareFreeFactor};
pub use roots::{isolate_real_roots, AlgebraicReal, Limits, RationalInterval, SturmSequence};
pub use wonky_num::Sign;

use num_traits::{Signed, Zero};
use std::fmt;

/// Named invalid-input or resource refusals; no partial root list is returned.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AlgebraError {
    ZeroDenominator,
    DivisionByZeroPolynomial,
    NonExactDivision,
    ZeroPolynomial,
    ReversedInterval,
    EndpointIsRoot,
    NotIsolating {
        roots: usize,
    },
    NonPositiveWidth,
    BudgetExceeded {
        operation: &'static str,
        limit: usize,
    },
    /// A Bernstein coefficient list must have at least one entry (degree 0).
    EmptyBernstein,
    /// A degree-`degree` basis cannot represent a polynomial of degree `required`.
    DegreeTooLow {
        degree: usize,
        required: usize,
    },
}

impl fmt::Display for AlgebraError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "wonky-alg::{self:?}")
    }
}
impl std::error::Error for AlgebraError {}

pub(crate) fn checked_rational(value: &Rational) -> Result<Rational, AlgebraError> {
    if value.denom().is_zero() {
        return Err(AlgebraError::ZeroDenominator);
    }
    Ok(Rational::new(value.numer().clone(), value.denom().clone()))
}

pub(crate) fn sign(value: &Rational) -> Sign {
    if value.is_zero() {
        Sign::Zero
    } else if value.is_positive() {
        Sign::Positive
    } else {
        Sign::Negative
    }
}
