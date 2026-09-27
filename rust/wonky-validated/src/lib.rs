//! Validated elementary functions and quadrature (VA1).
//!
//! Consumers GE1 and VO1 use `Enclosure`, never a difference-of-orders estimate.
//! Input balls denote whole sets; a domain violation anywhere in the ball is a
//! refusal. Every returned enclosure is finite and satisfies the caller's
//! absolute maximum width (not merely an overlap test). Arithmetic here is
//! deliberately separate from the P0 ball implementation while its fixes land.
//!
//! Supported input centers follow `wonky_num::in_range` (zero or magnitude
//! 1e-150..=1e150). Radii must be finite, nonnegative and not subnormal.
//! Trigonometric arguments are limited to |x| <= 2^45, exp to [-700,700],
//! log to positive normal arguments and acos to [-1,1]. atan2 has range
//! (-pi,pi], treating either signed zero above the negative x axis as +pi;
//! a ball containing the origin or crossing that branch cut is refused.
//! Rounding can conservatively broaden input balls; near a domain boundary
//! this can cause a named refusal. Quadrature supports the closed expression
//! algebra `Expr`, finite fourth derivatives and at most 65536 dyadic panels.
//! These are explicit capability limits, not a geometry or volume API.
//! Arithmetic assumes IEEE-754 binary64 round-to-nearest, gradual underflow,
//! and no fast-math reassociation (the pinned workspace build's defaults).
//! All enclosure widths are ABSOLUTE; callers translate their relative budget.
//! Separate crate placement is temporary to avoid conflicts with P0 changes.
//! No geometry/export/certificate wire implementation is introduced here.
//!
//! No conversion from an estimate to a certificate exists:
//! ```compile_fail
//! use wonky_validated::{Enclosure, Estimate};
//! let certificate: Enclosure = Estimate { value: 1.0, estimated_error: 0.01 }.into();
//! ```
//! No unchecked certificate constructor or writable endpoint fields exist:
//! ```compile_fail
//! use wonky_validated::Enclosure;
//! let forged = Enclosure { lower: 0.0, upper: 0.0 };
//! ```

mod interval;
mod quadrature;
mod transcendental;

use interval::{down, up, I};
pub use quadrature::{integrate, Expr, Integral};
use std::fmt;
pub use transcendental::{acos, atan2, cos, exp, log, pi, sin, sin_cos};
use wonky_num::{in_range, Iv};

/// An a posteriori estimate. This is NOT a bound and cannot be promoted into
/// `Enclosure`. In particular a difference of Gauss orders has this type.
#[derive(Clone, Copy, Debug)]
pub struct Estimate {
    pub value: f64,
    pub estimated_error: f64,
}

/// A proved, finite closed interval; fields and construction are private.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Enclosure {
    lower: f64,
    upper: f64,
}
impl Enclosure {
    pub fn lower(self) -> f64 {
        self.lower
    }
    pub fn upper(self) -> f64 {
        self.upper
    }
    /// Outward-rounded width (zero for a singleton).
    pub fn width(self) -> f64 {
        self.interval().width()
    }
    /// Recheck when crossing an acceptance boundary with a stricter budget.
    pub fn require_width(self, max_width: f64) -> Result<Self, Error> {
        finish(self.interval(), max_width)
    }
    /// Convert to the public P0 ball format without narrowing the enclosure.
    /// The caller must check its own later arithmetic's error budget again.
    pub fn ball(self) -> Iv {
        let m = self.lower * 0.5 + self.upper * 0.5;
        let r = if self.lower == self.upper {
            0.0
        } else {
            up(up(m - self.lower).max(up(self.upper - m)))
        };
        Iv {
            m: if r == 0.0 { self.lower } else { m },
            r,
        }
    }
    fn interval(self) -> I {
        I {
            lo: self.lower,
            hi: self.upper,
        }
    }
}

/// Named refusals, not a non-finite interval masquerading as a certificate.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Error {
    InvalidInput,
    InvalidWidth,
    Domain(&'static str),
    ArgumentReductionRange,
    ArithmeticRange,
    WidthExceeded { width: f64, max_width: f64 },
    QuadratureBudget { panels: usize },
}
impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "validated::{self:?}")
    }
}
impl std::error::Error for Error {}

fn width_budget(max_width: f64) -> Result<(), Error> {
    if max_width.is_finite() && max_width >= 0.0 {
        Ok(())
    } else {
        Err(Error::InvalidWidth)
    }
}
fn input(ball: Iv) -> Result<I, Error> {
    // Radius is an uncertainty, not a coordinate: small normal radii are valid.
    // Negative, NaN, infinite and subnormal encodings are never canonical balls.
    if !in_range(ball.m) || !ball.r.is_finite() || ball.r < 0.0 || ball.r.is_subnormal() {
        return Err(Error::InvalidInput);
    }
    let result = if ball.r == 0.0 {
        I::point(ball.m)
    } else {
        I {
            lo: down(ball.m - ball.r),
            hi: up(ball.m + ball.r),
        }
    };
    if result.valid() {
        Ok(result)
    } else {
        Err(Error::InvalidInput)
    }
}
fn finite(value: I) -> Result<I, Error> {
    if value.valid() {
        Ok(value)
    } else {
        Err(Error::ArithmeticRange)
    }
}
fn finish(value: I, max_width: f64) -> Result<Enclosure, Error> {
    width_budget(max_width)?;
    finite(value)?;
    let width = value.width();
    if !width.is_finite() || width > max_width {
        return Err(Error::WidthExceeded { width, max_width });
    }
    Ok(Enclosure {
        lower: value.lo,
        upper: value.hi,
    })
}
