//! Composite two-point Gauss-Legendre with a proved fourth-derivative bound.
//! For one cell [a,b], |integral - Q2| <= (b-a)^5 sup|f''''| / 4320.
//! Jets store f^(k)/k!, so the multiplier of |jet[4]| is (b-a)^5/180.
//! The derivative is evaluated on the WHOLE cell using interval automatic
//! differentiation, never supplied by a caller or inferred from node samples.

use super::interval::I;
use super::transcendental::{exp_interval, log_interval, trig_interval};
use super::{finish, finite, width_budget, Enclosure, Error};
use std::ops::{Add, Div, Mul, Neg, Sub};
use wonky_num::in_range;

/// Analytic expression whose derivatives and value are evaluated together.
/// This closed expression algebra prevents a mismatched derivative callback
/// from certifying an unrelated integrand. `Bound` carries previously proved
/// constants (e.g. pi); `Constant` denotes an exact binary64 input.
#[derive(Clone, Debug)]
pub enum Expr {
    Variable,
    Constant(f64),
    Bound(Enclosure),
    Add(Box<Self>, Box<Self>),
    Mul(Box<Self>, Box<Self>),
    Div(Box<Self>, Box<Self>),
    Neg(Box<Self>),
    Sin(Box<Self>),
    Cos(Box<Self>),
    Exp(Box<Self>),
    Log(Box<Self>),
    Sqrt(Box<Self>),
}
impl Expr {
    pub fn sin(self) -> Self {
        Self::Sin(Box::new(self))
    }
    pub fn cos(self) -> Self {
        Self::Cos(Box::new(self))
    }
    pub fn exp(self) -> Self {
        Self::Exp(Box::new(self))
    }
    pub fn log(self) -> Self {
        Self::Log(Box::new(self))
    }
    pub fn sqrt(self) -> Self {
        Self::Sqrt(Box::new(self))
    }
    pub fn square(self) -> Self {
        self.clone() * self
    }
}
impl Add for Expr {
    type Output = Self;
    fn add(self, rhs: Self) -> Self {
        Self::Add(Box::new(self), Box::new(rhs))
    }
}
impl Mul for Expr {
    type Output = Self;
    fn mul(self, rhs: Self) -> Self {
        Self::Mul(Box::new(self), Box::new(rhs))
    }
}
impl Div for Expr {
    type Output = Self;
    fn div(self, rhs: Self) -> Self {
        Self::Div(Box::new(self), Box::new(rhs))
    }
}
impl Neg for Expr {
    type Output = Self;
    fn neg(self) -> Self {
        Self::Neg(Box::new(self))
    }
}
impl Sub for Expr {
    type Output = Self;
    fn sub(self, rhs: Self) -> Self {
        self + -rhs
    }
}

type Jet = [I; 5];
fn constant(x: I) -> Jet {
    [x, I::ZERO, I::ZERO, I::ZERO, I::ZERO]
}
fn mul(a: Jet, b: Jet) -> Jet {
    std::array::from_fn(|n| (0..=n).fold(I::ZERO, |s, k| s + a[k] * b[n - k]))
}
fn div(a: Jet, b: Jet) -> Jet {
    let mut y = [I::ZERO; 5];
    for n in 0..5 {
        let sum = (1..=n).fold(I::ZERO, |s, k| s + b[k] * y[n - k]);
        y[n] = (a[n] - sum) / b[0];
    }
    y
}
fn trig(a: Jet) -> Result<(Jet, Jet), Error> {
    let (s0, c0) = trig_interval(a[0])?;
    let (mut s, mut c) = (constant(s0), constant(c0));
    for n in 1..5 {
        for k in 1..=n {
            s[n] = s[n] + I::point(k as f64) * a[k] * c[n - k];
            c[n] = c[n] - I::point(k as f64) * a[k] * s[n - k];
        }
        s[n] = s[n] / I::point(n as f64);
        c[n] = c[n] / I::point(n as f64);
    }
    Ok((s, c))
}
fn evaluate(expr: &Expr, x: I, depth: usize) -> Result<Jet, Error> {
    if depth > 64 {
        return Err(Error::Domain("expression depth > 64"));
    }
    let eval = |e| evaluate(e, x, depth + 1);
    let value = match expr {
        Expr::Variable => [x, I::ONE, I::ZERO, I::ZERO, I::ZERO],
        Expr::Constant(c) => {
            if !in_range(*c) {
                return Err(Error::InvalidInput);
            }
            constant(I::point(*c))
        }
        Expr::Bound(c) => constant(c.interval()),
        Expr::Add(a, b) => {
            let (a, b) = (eval(a)?, eval(b)?);
            std::array::from_fn(|n| a[n] + b[n])
        }
        Expr::Mul(a, b) => mul(eval(a)?, eval(b)?),
        Expr::Div(a, b) => div(eval(a)?, eval(b)?),
        Expr::Neg(a) => eval(a)?.map(|v| -v),
        Expr::Sin(a) => trig(eval(a)?)?.0,
        Expr::Cos(a) => trig(eval(a)?)?.1,
        Expr::Exp(a) => {
            let a = eval(a)?;
            let mut y = constant(exp_interval(a[0])?);
            for n in 1..5 {
                y[n] = (1..=n).fold(I::ZERO, |s, k| s + I::point(k as f64) * a[k] * y[n - k])
                    / I::point(n as f64);
            }
            y
        }
        Expr::Log(a) => {
            let a = eval(a)?;
            let derivative = std::array::from_fn(|n| {
                if n < 4 {
                    I::point((n + 1) as f64) * a[n + 1]
                } else {
                    I::ZERO
                }
            });
            let quotient = div(derivative, a);
            let mut y = constant(log_interval(a[0])?);
            for n in 1..5 {
                y[n] = quotient[n - 1] / I::point(n as f64);
            }
            y
        }
        Expr::Sqrt(a) => {
            let a = eval(a)?;
            let mut y = constant(finite(a[0].sqrt())?);
            for n in 1..5 {
                let sum = (1..n).fold(I::ZERO, |s, k| s + y[k] * y[n - k]);
                y[n] = (a[n] - sum) / (I::point(2.0) * y[0]);
            }
            y
        }
    };
    for coefficient in value {
        finite(coefficient)?;
    }
    Ok(value)
}

/// Result includes actual expression-jet evaluation count across all attempts,
/// including coarser partitions. It is not a predicted node count.
#[derive(Clone, Copy, Debug)]
pub struct Integral {
    pub enclosure: Enclosure,
    pub panels: usize,
    pub evaluations: usize,
}

fn cell(expr: &Expr, a: f64, b: f64, evaluations: &mut usize) -> Result<I, Error> {
    let mut eval = |x| {
        *evaluations += 1;
        evaluate(expr, x, 0)
    };
    let derivative = eval(I { lo: a, hi: b })?[4];
    let width = I::point(b) - I::point(a);
    let h = width * I::point(0.5);
    let m = (I::point(a) + I::point(b)) * I::point(0.5);
    let offset = h / I::point(3.0).sqrt();
    let q = h * (eval(m - offset)?[0] + eval(m + offset)?[0]);
    let remainder = (width.pow(5) * I::point(derivative.abs_max()) / I::point(180.0)).hi;
    finite(q.expand(remainder))
}

/// Integrate an expression over the complete exact binary64 domain [a,b].
/// Cells partition the domain without gaps: each shared midpoint is stored
/// once and used as both neighbours' endpoint. Reversing endpoints is refused,
/// not silently canonicalized. Resource and width failures return no result.
///
/// `max_panels` caps the final partition (1..=65536); refinements are dyadic.
/// Expressions with a singular derivative on any cell are named refusals.
pub fn integrate(
    expr: &Expr,
    a: f64,
    b: f64,
    max_width: f64,
    max_panels: usize,
) -> Result<Integral, Error> {
    width_budget(max_width)?;
    if !in_range(a) || !in_range(b) || a >= b {
        return Err(Error::InvalidInput);
    }
    if max_panels == 0 || max_panels > 65536 {
        return Err(Error::Domain("quadrature panel budget 1..=65536"));
    }
    let mut cells = vec![(a, b)];
    let mut evaluations = 0;
    loop {
        let mut total = I::ZERO;
        for &(a, b) in &cells {
            total = total + cell(expr, a, b, &mut evaluations)?;
        }
        finite(total)?;
        match finish(total, max_width) {
            Ok(enclosure) => {
                return Ok(Integral {
                    enclosure,
                    panels: cells.len(),
                    evaluations,
                })
            }
            Err(Error::WidthExceeded { .. }) => {}
            Err(error) => return Err(error),
        }
        if cells.len() * 2 > max_panels {
            return Err(Error::QuadratureBudget {
                panels: cells.len(),
            });
        }
        let mut refined = Vec::with_capacity(cells.len() * 2);
        for (a, b) in cells {
            let m = a * 0.5 + b * 0.5;
            if m <= a || m >= b {
                return Err(Error::QuadratureBudget {
                    panels: refined.len() + 1,
                });
            }
            refined.push((a, m));
            refined.push((m, b));
        }
        cells = refined;
    }
}
