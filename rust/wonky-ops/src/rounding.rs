//! Correct rounding of exact expansions (round to nearest, ties to even).
//!
//! Export and observation evaluate a quantity exactly as a Shewchuk expansion
//! and round it ONCE here, so every exported coordinate is the binary64 value
//! nearest to the exact quantity (error <= half an ulp), not the result of a
//! chain of rounded operations.
use wonky_num::expansion::{neg, sign, sum, Guard};

/// Why a value could not be rounded (overflow of the exact evaluation).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NotRepresentable;

/// The binary64 nearest to the exact sum of `e` (ties to even).
pub fn round(e: &[f64]) -> Result<f64, NotRepresentable> {
    let mut s = 0.0f64;
    for &x in e {
        s += x;
    }
    if !s.is_finite() {
        return Err(NotRepresentable);
    }
    // At most a few correction steps: the naive sum is within a few ulps.
    for _ in 0..64 {
        let mut g = Guard::new();
        let residual = sum(e, &[-s], &mut g);
        if !g.exact() {
            return Err(NotRepresentable);
        }
        let direction = sign(&residual);
        if direction == 0 {
            return Ok(s);
        }
        let up = direction == 1;
        let next = if up { s.next_up() } else { s.next_down() };
        if !next.is_finite() {
            return Err(NotRepresentable);
        }
        // Half the gap towards `next` is exact (a power-of-two scaling of an
        // exact difference of neighbours), except in the subnormal range, which
        // the exact evaluation refuses anyway.
        let half = (next - s) * 0.5;
        let magnitude = if up { residual } else { neg(&residual) };
        let mut g = Guard::new();
        let excess = sum(&magnitude, &[-half.abs()], &mut g);
        if !g.exact() {
            return Err(NotRepresentable);
        }
        match sign(&excess) {
            -1 => return Ok(s),
            1 => s = next,
            _ => {
                // A tie: the even neighbour (last mantissa bit clear).
                return Ok(if s.to_bits() & 1 == 0 { s } else { next });
            }
        }
    }
    Err(NotRepresentable)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_values_and_ties() {
        assert_eq!(round(&[]).unwrap(), 0.0);
        assert_eq!(round(&[1.0]).unwrap(), 1.0);
        // 1 + 2^-53 is a tie between 1 and 1 + 2^-52: even is 1.
        assert_eq!(round(&[2f64.powi(-53), 1.0]).unwrap(), 1.0);
        // (1 + 2^-52) + 2^-53 ties between 1+2^-52 (odd) and 1+2^-51 (even).
        let odd = 1.0 + 2f64.powi(-52);
        assert_eq!(round(&[2f64.powi(-53), odd]).unwrap(), 1.0 + 2f64.powi(-51));
        // Just above a tie rounds up; just below rounds down. The naive
        // summation double-rounds these (2^-110 is lost before the tie), so
        // the exact correction step decides them.
        assert_eq!(round(&[2f64.powi(-110), 2f64.powi(-53), 1.0]).unwrap(), odd);
        assert_eq!(round(&[-(2f64.powi(-110)), 2f64.powi(-53), 1.0]).unwrap(), 1.0);
        assert_eq!(round(&[-(2f64.powi(-110)), 2f64.powi(-53), odd]).unwrap(), odd);
        assert_eq!(round(&[2f64.powi(-110), -(2f64.powi(-53)), odd]).unwrap(), odd);
        // Below a power of two, just under the tie at 1 - 2^-54: the lower gap.
        assert_eq!(round(&[-(2f64.powi(-110)), -(2f64.powi(-54)), 1.0]).unwrap(), 1.0 - 2f64.powi(-53));
        assert_eq!(round(&[2f64.powi(-110), -(2f64.powi(-54)), 1.0]).unwrap(), 1.0);
        // Below a power of two the gap halves: 1 - 3*2^-55 is nearer to
        // 1 - 2^-53 than to 1, and 1 - 2^-54 is a tie that goes to even 1.
        assert_eq!(round(&[-3.0 * 2f64.powi(-55), 1.0]).unwrap(), 1.0 - 2f64.powi(-53));
        assert_eq!(round(&[-(2f64.powi(-54)), 1.0]).unwrap(), 1.0);
        assert!(round(&[f64::MAX, f64::MAX]).is_err());
    }
}

// Observation arithmetic shares the kernel's outward-rounded intervals. Scaling
// before squaring prevents a representable norm from under/overflowing merely
// because its square is outside binary64. Any unusable enclosure is refused.
pub(crate) fn finite_ball(x: wonky_num::ball::Iv) -> Result<wonky_num::ball::Iv, NotRepresentable> {
    if x.is_nan() || !x.lo().is_finite() || !x.hi().is_finite() {
        Err(NotRepresentable)
    } else {
        Ok(x)
    }
}

pub(crate) fn norm_ball(v: [wonky_num::ball::Iv; 3]) -> Result<wonky_num::ball::Iv, NotRepresentable> {
    use wonky_num::ball::{Iv, Scalar};
    let mut scale = 0.0f64;
    for x in v {
        let x = finite_ball(x)?;
        scale = scale.max(x.lo().abs()).max(x.hi().abs());
    }
    if scale == 0.0 { return Ok(Iv::point(0.0)); }
    let [x, y, z] = v.map(|x| x / Iv::point(scale));
    finite_ball(x.norm3(y, z) * Iv::point(scale))
}

pub(crate) fn expansion_ball(e: &[f64]) -> wonky_num::ball::Iv {
    use wonky_num::ball::Iv;
    e.iter().fold(Iv::point(0.0), |s, &x| s + Iv::point(x))
}
