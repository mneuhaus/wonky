//! Parameters compare in an exact chart; angular parameters never use atan.
use crate::{
    numeric::Q,
    radical::{self, V},
};
use std::cmp::Ordering;
#[derive(Clone, Debug)]
pub enum Param {
    Rational(Q),
    /// Nonzero radial direction in the chart whose seam is the positive x ray.
    Angular(V),
}
impl Ord for Param {
    fn cmp(&self, other: &Self) -> Ordering {
        match (self, other) {
            (Self::Rational(a), Self::Rational(b)) => a.cmp(b),
            (Self::Angular(a), Self::Angular(b)) => radical::direction_cmp(a, b),
            (Self::Rational(_), Self::Angular(_)) => Ordering::Less,
            (Self::Angular(_), Self::Rational(_)) => Ordering::Greater,
        }
    }
}
impl PartialOrd for Param {
    fn partial_cmp(&self, o: &Self) -> Option<Ordering> {
        Some(self.cmp(o))
    }
}
impl PartialEq for Param {
    fn eq(&self, o: &Self) -> bool {
        self.cmp(o) == Ordering::Equal
    }
}
impl Eq for Param {}
