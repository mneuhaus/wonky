//! Exact, in-memory geometry in construction coordinates. This is not a WC0
//! cache and never rounds values for topology. Frame inverses and SSI use
//! rational arithmetic; the only new roots are checked single square roots.
//! General affine maps preserve planes, not circular curved carriers (Rule P).
//! `model` is the checked exact B-rep (boolean3d strand G1); trimming, sewing
//! and export stay out of this crate.
#![deny(unused_must_use)]

pub mod frame;
pub mod turn;
pub mod rotation;
pub use turn::{Turn, TurnClass, AngleWitness};
pub mod import;
pub mod model;
pub mod ssi;

pub use num_rational::BigRational as Q;
use num_traits::Zero;
pub use wonky_radical3::rational::Quadratic as Real;
pub type Point = [Q; 3];
pub type Result<T> = std::result::Result<T, Refused>;
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Refused(pub &'static str);

pub fn binary64(value: f64) -> Result<Q> {
    Q::from_float(value).ok_or(Refused("real/non-finite-input"))
}
pub fn point(value: [f64; 3]) -> Result<Point> {
    Ok([
        binary64(value[0])?,
        binary64(value[1])?,
        binary64(value[2])?,
    ])
}
pub fn dot(a: &Point, b: &Point) -> Q {
    (0..3).map(|k| &a[k] * &b[k]).sum()
}
pub fn sub(a: &Point, b: &Point) -> Point {
    std::array::from_fn(|k| &a[k] - &b[k])
}
pub fn cross(a: &Point, b: &Point) -> Point {
    [(1, 2), (2, 0), (0, 1)].map(|(i, j)| &a[i] * &b[j] - &a[j] * &b[i])
}
pub fn zero() -> Point {
    std::array::from_fn(|_| Q::zero())
}
mod angle_word;
