//! Local filter over the committed expansion API. This does not depend on
//! P0's still-changing Iv sqrt/NaN behavior. Invalid intermediates propagate
//! None, including 0 * invalid. The exact evaluator is then tried.
use wonky_num::Sign;

#[derive(Clone, Copy)]
pub(crate) struct Ball {
    pub m: f64,
    pub r: f64,
}

// Each nonnegative bound operation rounds upward; next_up(0) also covers
// underflow. No absolute-error term is ever dropped before a later multiplier.
fn up(x: f64) -> f64 {
    x.next_up()
}
impl Ball {
    pub fn point(m: f64) -> Self {
        Self { m, r: 0.0 }
    }
    fn valid(self) -> bool {
        self.m.is_finite() && self.r.is_finite() && self.r >= 0.0
    }
    fn checked(m: f64, r: f64) -> Option<Self> {
        let v = Self { m, r };
        v.valid().then_some(v)
    }
    pub fn add(self, b: Self) -> Option<Self> {
        if !self.valid() || !b.valid() {
            return None;
        }
        let m = self.m + b.m;
        // Knuth two-sum, exact even for subnormal sums (finite intermediates).
        let bb = m - self.m;
        let error = ((self.m - (m - bb)) + (b.m - bb)).abs();
        if self.r == 0.0 && b.r == 0.0 && error == 0.0 {
            return Self::checked(m, 0.0);
        }
        Self::checked(m, up(up(self.r + b.r) + error))
    }
    pub fn sub(self, b: Self) -> Option<Self> {
        self.add(Self { m: -b.m, r: b.r })
    }
    pub fn mul(self, b: Self) -> Option<Self> {
        if !self.valid() || !b.valid() {
            return None;
        }
        let m = self.m * b.m;
        let error = self.m.mul_add(b.m, -m).abs();
        // FMA residual can underflow: next_up of the residual covers that too.
        let exact = error == 0.0
            && (self.m == 0.0 || b.m == 0.0 || m.abs() >= wonky_num::expansion::PRODUCT_MIN);
        if self.r == 0.0 && b.r == 0.0 && exact {
            return Self::checked(m, 0.0);
        }
        let r = up(up(up(self.m.abs() * b.r) + up(b.m.abs() * self.r)) + up(self.r * b.r));
        Self::checked(m, up(r + up(error)))
    }
    pub fn sqrt(self) -> Option<Self> {
        if !self.valid() || self.m < 0.0 {
            return None;
        }
        if self.m == 0.0 && self.r == 0.0 {
            return Some(self);
        }
        let m = self.m.sqrt();
        let lo = (self.m - self.r).next_down();
        if lo <= 0.0 {
            return None;
        }
        let error = (-m).mul_add(m, self.m).abs();
        if self.r == 0.0 && error == 0.0 && self.m >= wonky_num::expansion::PRODUCT_MIN {
            return Some(Self::point(m));
        }
        // |sqrt(x)-m| = |x-m^2|/(sqrt(x)+m). Numerator upward,
        // denominator downward. sqrt is IEEE correctly rounded; next_down
        // gives a lower bound. This is much tighter than u*|sqrt(x)|.
        let denominator = (lo.sqrt().next_down() + m).next_down();
        if denominator <= 0.0 {
            return None;
        }
        Self::checked(m, up(up(self.r + up(error)) / denominator))
    }
}

pub(crate) fn sign(v: Ball) -> Option<Sign> {
    if !v.valid() {
        return None;
    }
    if v.m.abs() > v.r {
        Some(Sign::of_exact(v.m))
    } else if v.m == 0.0 && v.r == 0.0 {
        Some(Sign::Zero)
    } else {
        None
    }
}

/// Determinant ball before constructing expansions. Every rounding/error term
/// follows the same add/mul rules as the radical filter, without a magic band.
pub(crate) fn incircle(a: [f64; 2], b: [f64; 2], c: [f64; 2], d: [f64; 2]) -> Option<Sign> {
    let relative = |p: [f64; 2]| -> Option<[Ball; 2]> {
        Some([
            Ball::point(p[0]).sub(Ball::point(d[0]))?,
            Ball::point(p[1]).sub(Ball::point(d[1]))?,
        ])
    };
    let a = relative(a)?;
    let b = relative(b)?;
    let c = relative(c)?;
    let norm = |p: [Ball; 2]| p[0].mul(p[0])?.add(p[1].mul(p[1])?);
    let cross = |p: [Ball; 2], q: [Ball; 2]| p[0].mul(q[1])?.sub(p[1].mul(q[0])?);
    sign(
        norm(a)?
            .mul(cross(b, c)?)?
            .add(norm(b)?.mul(cross(c, a)?)?)?
            .add(norm(c)?.mul(cross(a, b)?)?)?,
    )
}
