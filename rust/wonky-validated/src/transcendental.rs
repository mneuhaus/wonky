//! Proof ingredients:
//! * pi/2 = sum(PIO2) + delta, |delta| < 2^-160; log(2) has the
//!   same three-word bound. The test oracle verifies these constants using
//!   exact rational Machin/atanh series, independently of mpmath and libm.
//! * Argument reduction subtracts the expansion EXACTLY using K0's guarded
//!   transforms; the constant error is multiplied by |k|, never forgotten.
//! * Trigonometry uses Taylor polynomials on |r| <= 1, with Lagrange
//!   remainders. atan and log use absolutely bounded power-series tails.
//! * No standard-library transcendental result is used as a certificate.

use super::interval::I;
use super::{finish, finite, input, width_budget, Enclosure, Error};
use wonky_num::{expansion as e, Iv};

// Nearest binary64 chunks of the exact constants. See rational verification
// in scripts/rust/validate-va1.py. The literals denote exact dyadic numbers.
const PIO2: [f64; 3] = [
    1.5707963267948966,
    6.123233995736766e-17,
    -1.4973849048591698e-33,
];
const LN2: [f64; 3] = [
    0.6931471805599453,
    2.3190468138462996e-17,
    5.707708438416212e-34,
];
const CONSTANT_REMAINDER: f64 = f64::from_bits((1023 - 160) << 52);
/// k fits exactly in binary64 and i64, with quotient-rounding error far below
/// one quadrant. We still verify |r| <= 1 rather than trust quotient rounding.
const MAX_TRIG_ARGUMENT: f64 = 35184372088832.0; // 2^45, includes 1e10*pi

fn constant(words: &[f64; 3]) -> I {
    (I::point(words[2]) + I::point(words[1]) + I::point(words[0])).expand(CONSTANT_REMAINDER)
}
pub fn pi(max_width: f64) -> Result<Enclosure, Error> {
    finish(constant(&PIO2) * I::point(2.0), max_width)
}

fn reduce(x: f64, k: f64, words: &[f64; 3]) -> Result<I, Error> {
    let mut guard = e::Guard::new();
    let mut result = vec![x];
    for word in words {
        let product = e::product(-k, *word, &mut guard);
        result = e::sum(&result, &product, &mut guard);
    }
    if !guard.exact() {
        return Err(Error::ArithmeticRange);
    }
    let value = result.into_iter().fold(I::ZERO, |a, b| a + I::point(b));
    let tail = (I::point(k.abs()) * I::point(CONSTANT_REMAINDER)).hi;
    finite(value.expand(tail))
}

fn trig_point(x: f64) -> Result<(I, I), Error> {
    if !x.is_finite() || x.abs() > MAX_TRIG_ARGUMENT {
        return Err(Error::ArgumentReductionRange);
    }
    if x == 0.0 {
        return Ok((I::point(x), I::ONE));
    }
    let k = (x / PIO2[0]).round();
    let r = if k == 0.0 {
        I::point(x)
    } else {
        reduce(x, k, &PIO2)?
    };
    if r.abs_max() > 1.0 {
        return Err(Error::ArgumentReductionRange);
    }
    let r2 = r * r;
    let (mut s, mut c) = (r, I::ONE);
    let (mut st, mut ct) = (r, I::ONE);
    for n in 1..=12 {
        st = -(st * r2) / I::point(((2 * n) * (2 * n + 1)) as f64);
        ct = -(ct * r2) / I::point(((2 * n - 1) * (2 * n)) as f64);
        s = s + st;
        c = c + ct;
    }
    // sin degree 25 (degree 26 coefficient zero): |R| <= |r|^27/27!.
    // cos degree 24 (degree 25 coefficient zero): |R| <= |r|^26/26!.
    let sr = (st * r2 / I::point(26.0 * 27.0)).abs_max();
    let cr = (ct * r2 / I::point(25.0 * 26.0)).abs_max();
    s = finite(s.expand(sr))?;
    c = finite(c.expand(cr))?;
    Ok(match (k as i64).rem_euclid(4) {
        0 => (s, c),
        1 => (c, -s),
        2 => (-s, -c),
        _ => (-c, s),
    })
}

pub(super) fn trig_interval(x: I) -> Result<(I, I), Error> {
    finite(x)?;
    if x.lo.abs().max(x.hi.abs()) > MAX_TRIG_ARGUMENT {
        return Err(Error::ArgumentReductionRange);
    }
    if x.lo == x.hi {
        return trig_point(x.lo);
    }
    let midpoint = x.lo * 0.5 + x.hi * 0.5;
    let radius = (x - I::point(midpoint)).abs_max();
    let (s, c) = trig_point(midpoint)?;
    // Global Lipschitz constants |sin'|, |cos'| <= 1 cover the ENTIRE
    // interval, including extrema and multiple periods, not just endpoints.
    let unit = |a: I| -> Result<I, Error> {
        let a = finite(a.expand(radius))?;
        finite(I {
            lo: a.lo.max(-1.0),
            hi: a.hi.min(1.0),
        })
    };
    Ok((unit(s)?, unit(c)?))
}

pub fn sin_cos(x: Iv, max_width: f64) -> Result<(Enclosure, Enclosure), Error> {
    width_budget(max_width)?;
    let (s, c) = trig_interval(input(x)?)?;
    Ok((finish(s, max_width)?, finish(c, max_width)?))
}
pub fn sin(x: Iv, max_width: f64) -> Result<Enclosure, Error> {
    width_budget(max_width)?;
    finish(trig_interval(input(x)?)?.0, max_width)
}
pub fn cos(x: Iv, max_width: f64) -> Result<Enclosure, Error> {
    width_budget(max_width)?;
    finish(trig_interval(input(x)?)?.1, max_width)
}

fn atan_unit(t: I) -> Result<I, Error> {
    // The caller supplies 0 <= t <= 1 mathematically; outward rounding may
    // exceed 1 by a few ulps. This transformation is valid for all t >= 0.
    let (r, offset) = if t.hi > 0.5 {
        ((t - I::ONE) / (t + I::ONE), constant(&PIO2) * I::point(0.5))
    } else {
        (t, I::ZERO)
    };
    if r.abs_max() > 0.51 {
        return Err(Error::ArithmeticRange);
    }
    let r2 = r * r;
    let mut power = r;
    let mut sum = r;
    for n in 1..32 {
        power = -(power * r2);
        sum = sum + power / I::point((2 * n + 1) as f64);
    }
    // Absolute geometric majorant for the omitted odd powers, starting 65.
    let rho2 = I::point(r.abs_max()).pow(2);
    let tail = (I::point((power * r2).abs_max()) / I::point(65.0) / (I::ONE - rho2)).hi;
    finite((offset + sum).expand(tail))
}

fn atan2_point(y: f64, x: f64) -> Result<I, Error> {
    if x == 0.0 && y == 0.0 {
        return Err(Error::Domain("atan2 origin"));
    }
    if y == 0.0 {
        return Ok(if x > 0.0 {
            I::ZERO
        } else {
            constant(&PIO2) * I::point(2.0)
        });
    }
    if x == 0.0 {
        return Ok(if y > 0.0 {
            constant(&PIO2)
        } else {
            -constant(&PIO2)
        });
    }
    let (a, b) = (y.abs(), x.abs());
    let mut angle = if a <= b {
        atan_unit(I::point(a) / I::point(b))?
    } else {
        constant(&PIO2) - atan_unit(I::point(b) / I::point(a))?
    };
    if x < 0.0 {
        angle = constant(&PIO2) * I::point(2.0) - angle;
    }
    if y < 0.0 {
        angle = -angle;
    }
    finite(angle)
}

fn atan2_interval(y: I, x: I) -> Result<I, Error> {
    finite(x)?;
    finite(y)?;
    if x.lo <= 0.0 && x.hi >= 0.0 && y.lo <= 0.0 && y.hi >= 0.0 {
        return Err(Error::Domain("atan2 origin"));
    }
    // Canonical convention: atan2(+/-0, negative) = +pi, range (-pi,pi].
    if x.lo < 0.0 && y.lo < 0.0 && y.hi >= 0.0 {
        return Err(Error::Domain("atan2 branch cut"));
    }
    if x.lo == x.hi && y.lo == y.hi {
        return atan2_point(y.lo, x.lo);
    }
    // Away from origin/cut, extrema of angle on a rectangle are at corners
    // (partial derivatives -y/r², x/r²; axis crossings add no extrema).
    let mut result = atan2_point(y.lo, x.lo)?;
    for (yy, xx) in [(y.lo, x.hi), (y.hi, x.lo), (y.hi, x.hi)] {
        result = result.hull(atan2_point(yy, xx)?);
    }
    finite(result)
}
pub fn atan2(y: Iv, x: Iv, max_width: f64) -> Result<Enclosure, Error> {
    width_budget(max_width)?;
    finish(atan2_interval(input(y)?, input(x)?)?, max_width)
}

fn acos_point(x: f64) -> Result<I, Error> {
    if x == 1.0 {
        return Ok(I::ZERO);
    }
    if x == -1.0 {
        return Ok(constant(&PIO2) * I::point(2.0));
    }
    // Factored radicand avoids cancellation at +/-1; x is a fixed input.
    let radicand = (I::ONE - I::point(x)) * (I::ONE + I::point(x));
    let y = finite(radicand.sqrt())?;
    atan2_interval(y, I::point(x))
}
pub fn acos(x: Iv, max_width: f64) -> Result<Enclosure, Error> {
    width_budget(max_width)?;
    let x = input(x)?;
    if x.lo < -1.0 || x.hi > 1.0 {
        return Err(Error::Domain("acos [-1,1]"));
    }
    finish(acos_point(x.lo)?.hull(acos_point(x.hi)?), max_width)
}

fn exp_point(x: f64) -> Result<I, Error> {
    // Finite-normal scaling factors; overflow/underflow are named refusals.
    if !(-700.0..=700.0).contains(&x) {
        return Err(Error::Domain("exp [-700,700]"));
    }
    if x == 0.0 {
        return Ok(I::ONE);
    }
    let k = (x / LN2[0]).round();
    let r = if k == 0.0 {
        I::point(x)
    } else {
        reduce(x, k, &LN2)?
    };
    if r.abs_max() > 1.0 {
        return Err(Error::ArgumentReductionRange);
    }
    let (mut sum, mut term) = (I::ONE, I::ONE);
    for n in 1..=18 {
        term = term * r / I::point(n as f64);
        sum = sum + term;
    }
    // exp(|r|) <= e < 3 for |r| <= 1, Lagrange remainder after degree 18.
    let tail = (I::point(3.0) * I::point((term * r / I::point(19.0)).abs_max())).hi;
    let scale = f64::from_bits(((k as i64 + 1023) as u64) << 52);
    finite(sum.expand(tail) * I::point(scale))
}
pub(super) fn exp_interval(x: I) -> Result<I, Error> {
    finite(x)?;
    Ok(exp_point(x.lo)?.hull(exp_point(x.hi)?))
}
pub fn exp(x: Iv, max_width: f64) -> Result<Enclosure, Error> {
    width_budget(max_width)?;
    finish(exp_interval(input(x)?)?, max_width)
}

fn log_point(x: f64) -> Result<I, Error> {
    if x <= 0.0 || !x.is_normal() {
        return Err(Error::Domain("log positive normal"));
    }
    if x == 1.0 {
        return Ok(I::ZERO);
    }
    let bits = x.to_bits();
    let k = ((bits >> 52) & 0x7ff) as i32 - 1023;
    let m = f64::from_bits((bits & ((1u64 << 52) - 1)) | (1023u64 << 52));
    let t = (I::point(m) - I::ONE) / (I::point(m) + I::ONE);
    let t2 = t * t;
    let (mut sum, mut power) = (t, t);
    for n in 1..32 {
        power = power * t2;
        sum = sum + power / I::point((2 * n + 1) as f64);
    }
    // log(m) = 2 atanh(t), |t| <= 1/3; tail <= 2 |t|^65/(65(1-t²)).
    let tail = (I::point(2.0) * I::point((power * t2).abs_max())
        / I::point(65.0)
        / (I::ONE - I::point(t.abs_max()).pow(2)))
    .hi;
    finite((sum * I::point(2.0)).expand(tail) + constant(&LN2) * I::point(k as f64))
}
pub(super) fn log_interval(x: I) -> Result<I, Error> {
    finite(x)?;
    Ok(log_point(x.lo)?.hull(log_point(x.hi)?))
}
pub fn log(x: Iv, max_width: f64) -> Result<Enclosure, Error> {
    width_budget(max_width)?;
    finish(log_interval(input(x)?)?, max_width)
}
