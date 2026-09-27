//! Floating-point expansion arithmetic after Shewchuk (two-sum, FMA
//! two-product, zero-eliminating grow/scale/sum), from the decision spike
//! (rust/planar/src/exact.rs), with one addition: every primitive reports to a
//! `Guard` when its error-free transform stops being exact.
//!
//! An expansion is a list of nonoverlapping f64 components in increasing
//! magnitude whose exact sum is the value; its sign is the sign of its largest
//! (last) component. two_sum is exact for all finite results (subnormal sums
//! are exact). two_prod via FMA is exact when the product does not overflow and
//! |a*b| >= 2^-960 (then e_a + e_b >= -967 >= emin + p - 1 = -970, so the
//! error a*b - p is representable; Boldo and Daumas). Anything else marks the
//! guard, and the caller refuses with NotExact instead of trusting the sign.

/// Exactness witness of one expansion evaluation.
#[derive(Debug)]
pub struct Guard {
    exact: bool,
}

impl Guard {
    #[inline]
    #[allow(clippy::new_without_default)]
    pub fn new() -> Guard {
        Guard { exact: true }
    }
    #[inline]
    pub fn exact(&self) -> bool {
        self.exact
    }
    #[cold]
    fn fail(&mut self) {
        self.exact = false;
    }
}

/// 2^-960: below this a product's rounding error may not be representable.
pub const PRODUCT_MIN: f64 = f64::from_bits(((1023 - 960) as u64) << 52);

pub type Exp = Vec<f64>;

/// s + e == a + b exactly (while s is finite).
#[inline]
pub fn two_sum(a: f64, b: f64, g: &mut Guard) -> (f64, f64) {
    let s = a + b;
    if !s.is_finite() {
        g.fail();
    }
    let bb = s - a;
    let e = (a - (s - bb)) + (b - bb);
    (s, e)
}

/// p + e == a * b exactly (while p is finite and |p| >= PRODUCT_MIN or a*b == 0).
#[inline]
pub fn two_prod(a: f64, b: f64, g: &mut Guard) -> (f64, f64) {
    let p = a * b;
    if !p.is_finite() || (p.abs() < PRODUCT_MIN && a != 0.0 && b != 0.0) {
        g.fail();
    }
    #[cfg(not(feature = "plant_two_prod"))]
    let e = a.mul_add(b, -p);
    // Planted negative (docs/rust-migration.md 6, K0): the FMA error term is dropped.
    #[cfg(feature = "plant_two_prod")]
    let e = 0.0;
    (p, e)
}

/// Exact a - b as an expansion.
#[inline]
pub fn difference(a: f64, b: f64, g: &mut Guard) -> Exp {
    let (s, e) = two_sum(a, -b, g);
    let mut v = Exp::with_capacity(2);
    if e != 0.0 {
        v.push(e);
    }
    if s != 0.0 {
        v.push(s);
    }
    v
}

/// Exact a * b as an expansion.
#[inline]
pub fn product(a: f64, b: f64, g: &mut Guard) -> Exp {
    let (p, e) = two_prod(a, b, g);
    let mut v = Exp::with_capacity(2);
    if e != 0.0 {
        v.push(e);
    }
    if p != 0.0 {
        v.push(p);
    }
    v
}

/// Exact expansion + scalar (grow_expansion_zeroelim).
pub fn grow(e: &[f64], b: f64, g: &mut Guard) -> Exp {
    let mut q = b;
    let mut h = Vec::with_capacity(e.len() + 1);
    for &x in e {
        let (s, err) = two_sum(q, x, g);
        q = s;
        if err != 0.0 {
            h.push(err);
        }
    }
    if q != 0.0 {
        h.push(q);
    }
    h
}

/// Exact sum of two expansions (by repeated grow, as in the spike).
pub fn sum(a: &[f64], b: &[f64], g: &mut Guard) -> Exp {
    let mut out: Exp = a.to_vec();
    for &x in b {
        out = grow(&out, x, g);
    }
    out
}

/// Exact expansion * scalar (scale_expansion_zeroelim).
pub fn scale(e: &[f64], b: f64, g: &mut Guard) -> Exp {
    let mut h = Vec::with_capacity(2 * e.len());
    if e.is_empty() || b == 0.0 {
        return h;
    }
    let (mut q, lo) = two_prod(e[0], b, g);
    if lo != 0.0 {
        h.push(lo);
    }
    for &x in &e[1..] {
        let (p1, p0) = two_prod(x, b, g);
        let (s, err) = two_sum(q, p0, g);
        if err != 0.0 {
            h.push(err);
        }
        let (s2, err2) = two_sum(p1, s, g);
        if err2 != 0.0 {
            h.push(err2);
        }
        q = s2;
    }
    if q != 0.0 {
        h.push(q);
    }
    h
}

pub fn neg(e: &[f64]) -> Exp {
    e.iter().map(|x| -x).collect()
}

/// Exact product of two expansions.
pub fn mul(a: &[f64], b: &[f64], g: &mut Guard) -> Exp {
    let mut out = Exp::new();
    for &x in b {
        let s = scale(a, x, g);
        out = sum(&out, &s, g);
    }
    out
}

/// Sign of an expansion: the sign of its largest nonzero component.
pub fn sign(e: &[f64]) -> i32 {
    match e.iter().rev().find(|x| **x != 0.0) {
        None => 0,
        Some(x) if *x > 0.0 => 1,
        Some(_) => -1,
    }
}
