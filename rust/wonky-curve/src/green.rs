//! Exact Green expressions: algebraic + pi coefficient + algebraic * atan.
//! Enclosures are observations of this expression, never its representation.
use crate::{
    numeric::{finite, pi, q},
    radical::{self, Radical},
    refusal::R,
};
use std::collections::BTreeMap;
use wonky_num::Iv;
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Green {
    pub algebraic: Radical,
    pub pi: Radical,
    /// Positive algebraic arguments; the coefficients may have either sign.
    pub atan: BTreeMap<Radical, Radical>,
}
impl Green {
    pub fn add(&mut self, other: Self) -> R<()> {
        radical::guard(|| self.add_exact(other))
    }
    fn add_exact(&mut self, other: Self) {
        self.algebraic = &self.algebraic + other.algebraic;
        self.pi = &self.pi + other.pi;
        for (argument, coefficient) in other.atan {
            let v = self.atan.entry(argument).or_default();
            *v = &*v + coefficient;
        }
        self.atan.retain(|_, v| !v.is_zero());
    }
    /// Add coefficient times the CCW angle of (dot,cross), in [0,2 pi).
    pub(crate) fn sweep(&mut self, dot: Radical, cross: Radical, coefficient: Radical) {
        if cross.is_zero() {
            if dot.is_negative() {
                self.pi = &self.pi + coefficient;
            }
            return;
        }
        if dot.is_zero() {
            self.pi = &self.pi + coefficient * if cross.is_positive() { q(0.5) } else { q(1.5) };
            return;
        }
        let (turns, sign) = if dot.is_positive() {
            if cross.is_positive() {
                (q(0.), q(1.))
            } else {
                (q(2.), q(-1.))
            }
        } else if cross.is_positive() {
            (q(1.), q(-1.))
        } else {
            (q(1.), q(1.))
        };
        self.pi = &self.pi + &coefficient * turns;
        let argument = cross.abs() / dot.abs();
        let factor = coefficient * sign;
        if argument == q(1.) {
            self.pi = &self.pi + factor / q(4.);
        } else {
            let v = self.atan.entry(argument).or_default();
            *v = &*v + factor;
        }
    }
    pub fn enclosure(&self) -> R<Iv> {
        radical::guard(|| {
            let mut out = self.algebraic.enclosure()? + self.pi.enclosure()? * pi();
            for (argument, coefficient) in &self.atan {
                out = out
                    + coefficient.enclosure()?
                        * radical::positive_angle(&Radical::from(q(1.)), argument)?;
            }
            finite(out)
        })?
    }
}
