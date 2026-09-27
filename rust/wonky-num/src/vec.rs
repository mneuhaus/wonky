//! Generic 3-vectors over f64 or balls (unchanged from the decision spike,
//! rust/planar/src/num.rs section "vectors") and plain 2-points for orient2d.

use crate::ball::{Iv, Scalar};

// ---------------------------------------------------------------- vectors

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct V3<T> {
    pub x: T,
    pub y: T,
    pub z: T,
}

pub type P3 = V3<f64>;
pub type I3 = V3<Iv>;

#[inline]
pub fn v3(x: f64, y: f64, z: f64) -> P3 {
    V3 { x, y, z }
}

impl<T: Scalar> V3<T> {
    #[inline]
    pub fn add(self, o: Self) -> Self {
        V3 { x: self.x + o.x, y: self.y + o.y, z: self.z + o.z }
    }
    #[inline]
    pub fn sub(self, o: Self) -> Self {
        V3 { x: self.x - o.x, y: self.y - o.y, z: self.z - o.z }
    }
    #[inline]
    pub fn scale(self, s: T) -> Self {
        V3 { x: self.x * s, y: self.y * s, z: self.z * s }
    }
    #[inline]
    pub fn dot(self, o: Self) -> T {
        self.x * o.x + self.y * o.y + self.z * o.z
    }
    #[inline]
    pub fn cross(self, o: Self) -> Self {
        V3 { x: self.y * o.z - self.z * o.y, y: self.z * o.x - self.x * o.z, z: self.x * o.y - self.y * o.x }
    }
    /// Bend G.normalize: scale(a, 1 / sqrt(dot(a, a)))
    #[inline]
    pub fn normalize(self) -> Self {
        self.scale(T::c(1.0) / self.length())
    }
    /// Bend I.length
    #[inline]
    pub fn length(self) -> T {
        self.x.norm3(self.y, self.z)
    }
    /// Bend I.magnitude: max |component|
    #[inline]
    pub fn magnitude(self) -> T {
        self.x.abs().max(self.y.abs().max(self.z.abs()))
    }
}

impl P3 {
    #[inline]
    pub fn iv(self) -> I3 {
        V3 { x: Iv::point(self.x), y: Iv::point(self.y), z: Iv::point(self.z) }
    }
    #[inline]
    pub fn finite(self) -> bool {
        self.x.is_finite() && self.y.is_finite() && self.z.is_finite()
    }
}

/// A point in the plane (orient2d input).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct P2 {
    pub x: f64,
    pub y: f64,
}

#[inline]
pub fn p2(x: f64, y: f64) -> P2 {
    P2 { x, y }
}
