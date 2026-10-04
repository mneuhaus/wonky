//! Certified quadrature of the rational integrands that spline measures need.
//!
//! An integrand `f(s) = P(s) / W(s)^k` or `sqrt(A(s)) / W(s)^k` (W > 0 on the
//! span) is expanded exactly in rational arithmetic as a Taylor series about the
//! midpoint `c` of a piece `[c - d, c + d]`. The disc `|z| <= R` is chosen so
//! that `W` and (for the root) `A` stay bounded away from zero on it, which
//! gives a Cauchy bound `|f_n| <= M / R^n` for the coefficients. With
//! `d <= R / 4` the tail after `K` terms is at most `2 d M (1/4)^K (4/3)`, added
//! as an explicit rational radius. Nothing is rounded: the result is a rational
//! interval that contains the true integral.
use super::poly;
use crate::numeric::{q, Q};
use crate::refusal::{Refusal, R};
use num_traits::{One, Signed, Zero};
use wonky_alg::{BigInt, Polynomial};

/// Series length. The tail is below `M (1/4)^28 ~ 1.4e-17 M` per unit length,
/// far inside the 1e-12 relative enclosures the measures promise.
const K: usize = 28;
/// Piece budget of one integral.
const MAX_PIECES: usize = 20_000;

/// A closed rational interval; `lo == hi` is an exact value.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct QBound {
    pub lo: Q,
    pub hi: Q,
}

impl QBound {
    pub fn exact(v: Q) -> Self {
        Self { lo: v.clone(), hi: v }
    }
    pub fn zero() -> Self {
        Self::exact(Q::zero())
    }
    pub fn is_exact(&self) -> bool {
        self.lo == self.hi
    }
    pub fn add(&self, o: &Self) -> Self {
        Self { lo: &self.lo + &o.lo, hi: &self.hi + &o.hi }
    }
    pub fn sub(&self, o: &Self) -> Self {
        Self { lo: &self.lo - &o.hi, hi: &self.hi - &o.lo }
    }
    pub fn scale(&self, c: &Q) -> Self {
        if c.is_negative() {
            Self { lo: &self.hi * c, hi: &self.lo * c }
        } else {
            Self { lo: &self.lo * c, hi: &self.hi * c }
        }
    }
    pub fn neg(&self) -> Self {
        self.scale(&-Q::one())
    }
    pub fn contains(&self, v: &Q) -> bool {
        &self.lo <= v && v <= &self.hi
    }
    pub fn width(&self) -> Q {
        &self.hi - &self.lo
    }
    /// The bound widened outward to the dyadic grid `2^-e` that lies at least
    /// `GUARD_BITS` below its own width: `lo` rounded down, `hi` rounded up, so
    /// the result still contains everything the input contains and is at most
    /// `2^-63` (relative to the width) wider. An exact bound stays exact.
    /// Without it, summing the piece enclosures of one integral grows the
    /// denominator by every piece's unrelated denominator (tens of thousands of
    /// bits after 60 pieces) and each addition pays a gcd on the full sum.
    pub fn round_out(&self) -> Self {
        if self.is_exact() {
            return self.clone();
        }
        let w = self.width();
        let log2_w = w.numer().bits() as i64 - w.denom().bits() as i64;
        let e = GUARD_BITS - log2_w + 1;
        Self { lo: dyadic(&self.lo, e, false), hi: dyadic(&self.hi, e, true) }
    }
    /// Certified binary64 enclosure.
    pub fn iv(&self) -> R<wonky_num::Iv> {
        iv_range(&self.lo, &self.hi)
    }
    /// Certified binary64 enclosure of the square root of a non-negative
    /// bound (a squared distance, say). An exact rational square stays exact.
    pub fn sqrt_iv(&self) -> R<wonky_num::Iv> {
        if self.lo.is_negative() {
            return Err(Refusal::ObservationRange);
        }
        let root = |g: &Q, upper: bool| match crate::numeric::exact_root(g) {
            Some(r) => r,
            None if upper => sqrt_bounds(g).1,
            None => sqrt_bounds(g).0,
        };
        iv_range(&root(&self.lo, false), &root(&self.hi, true))
    }
}

/// Guard bits of `QBound::round_out` below an enclosure's width.
const GUARD_BITS: i64 = 64;

/// `v` rounded to the grid `2^-e` (down, or up when `up`), as an exact rational.
fn dyadic(v: &Q, e: i64, up: bool) -> Q {
    let shift = e.unsigned_abs() as usize;
    let scaled = if e >= 0 {
        Q::new_raw(v.numer() << shift, v.denom().clone())
    } else {
        Q::new_raw(v.numer().clone(), v.denom() << shift)
    };
    let k = if up { scaled.ceil() } else { scaled.floor() }.to_integer();
    if e >= 0 {
        Q::new(k, BigInt::one() << shift)
    } else {
        Q::from_integer(k << shift)
    }
}

/// Enclosure of the rational range `[lo, hi]`.
pub(crate) fn iv_range(lo: &Q, hi: &Q) -> R<wonky_num::Iv> {
    use crate::numeric::{enclose, finite};
    let (l, h) = (enclose(lo)?.lo(), enclose(hi)?.hi());
    if l == h {
        // l <= lo <= hi <= h: an exact binary64 value, a point enclosure.
        return Ok(wonky_num::Iv::point(l));
    }
    let m = l / 2. + h / 2.;
    finite(wonky_num::Iv { m, r: (m - l).max(h - m).next_up() })
}

fn coeffs(p: &Polynomial, c: &Q) -> Vec<Q> {
    let s = p.compose(&poly(vec![c.clone(), Q::one()]));
    let mut v = s.coefficients().to_vec();
    if v.is_empty() {
        v.push(Q::zero());
    }
    v
}

fn mul_trunc(a: &[Q], b: &[Q]) -> Vec<Q> {
    let mut out = vec![Q::zero(); K];
    for (i, x) in a.iter().enumerate().take(K) {
        if x.is_zero() {
            continue;
        }
        for (j, y) in b.iter().enumerate() {
            if i + j >= K {
                break;
            }
            out[i + j] += x * y;
        }
    }
    out
}

/// Series of 1 / W about z = 0 (W(0) != 0).
fn inverse(w: &[Q]) -> Vec<Q> {
    let mut e = vec![Q::zero(); K];
    e[0] = Q::one() / &w[0];
    for n in 1..K {
        let mut s = Q::zero();
        for i in 1..=n.min(w.len() - 1) {
            s += &w[i] * &e[n - i];
        }
        e[n] = -s * &e[0];
    }
    e
}

fn power(e: &[Q], k: u32) -> Vec<Q> {
    let mut acc = vec![Q::zero(); K];
    acc[0] = Q::one();
    for _ in 0..k {
        acc = mul_trunc(&acc, e);
    }
    acc
}

fn abs_sum(c: &[Q], from: usize, r: &Q) -> Q {
    let mut pow = r.pow(from as i32);
    let mut s = Q::zero();
    for a in c.iter().skip(from) {
        s += a.abs() * &pow;
        pow *= r;
    }
    s
}

/// Largest `r` of the form `2^-j` or `3 * 2^-(j+2)` (`r <= 1`) on which
/// `sum_{i>=1} |c_i| r^i <= |c_0| / 2`. Keeping `r` a short dyadic rational keeps
/// the piece arithmetic small; the search terminates because the sum tends to 0.
fn radius_where_rest_is_small(c: &[Q]) -> Q {
    // The test in integers: with C_i = L |c_i| (L the lcm of the denominators)
    // and r = n / d, it reads 2 sum_{i>=1} C_i n^i d^(N-i) <= C_0 d^N.
    let lcm = c.iter().fold(BigInt::one(), |l, x| {
        let g = gcd(&l, x.denom());
        l / g * x.denom()
    });
    let ints: Vec<BigInt> = c.iter().map(|x| (x.numer() * (&lcm / x.denom())).abs()).collect();
    let small = |r: &Q| {
        let (n, d) = (r.numer(), r.denom());
        let (mut rest, mut n_pow) = (BigInt::zero(), BigInt::one());
        let mut d_pows = vec![BigInt::one(); ints.len()];
        for i in 1..ints.len() {
            d_pows[i] = &d_pows[i - 1] * d;
        }
        let top = ints.len() - 1;
        for (i, x) in ints.iter().enumerate().skip(1) {
            n_pow *= n;
            rest += x * &n_pow * &d_pows[top - i];
        }
        rest * 2 <= &ints[0] * &d_pows[top]
    };
    let mut r = Q::one();
    loop {
        if small(&r) {
            return r;
        }
        let three_quarters = &r * Q::new(BigInt::from(3), BigInt::from(4));
        if small(&three_quarters) {
            return three_quarters;
        }
        r /= q(2.);
    }
}

/// Radius (<= 1) on which `sum_{i>=1} |c_i| r^i <= |c_0| / 2`.
fn safe_radius(c: &[Q]) -> Option<Q> {
    if c[0].is_zero() {
        return None;
    }
    Some(radius_where_rest_is_small(c))
}

/// Integral of the series over [-d, d] (even terms only).
fn series_integral(f: &[Q], d: &Q) -> Q {
    let mut s = Q::zero();
    let d2 = d * d;
    let mut dpow = d.clone();
    for (n, a) in f.iter().enumerate() {
        if n % 2 == 0 {
            s += a * &dpow / Q::from_integer(BigInt::from(n as i64 + 1));
            dpow *= &d2;
        }
    }
    s * q(2.)
}

fn tail(d: &Q, m: &Q) -> Q {
    // 2 d M (1/4)^K (4/3)
    let quarter = Q::new(BigInt::one(), BigInt::from(4)).pow(K as i32);
    q(2.) * d * m * quarter * Q::new(BigInt::from(4), BigInt::from(3))
}

fn pieces(
    s0: &Q,
    s1: &Q,
    mut piece: impl FnMut(&Q, &Q) -> R<Option<QBound>>,
) -> R<QBound> {
    if s0 == s1 {
        return Ok(QBound::zero());
    }
    let mut stack = vec![(s0.clone(), s1.clone())];
    let mut total = QBound::zero();
    let mut count = 0;
    while let Some((lo, hi)) = stack.pop() {
        count += 1;
        if count > MAX_PIECES {
            return Err(Refusal::SplineBudget);
        }
        let c = (&lo + &hi) / q(2.);
        let d = (&hi - &lo) / q(2.);
        match piece(&c, &d)? {
            Some(b) => total = total.add(&b.round_out()),
            None => {
                stack.push((lo, c.clone()));
                stack.push((c, hi));
            }
        }
    }
    Ok(total)
}

/// `integral_{s0}^{s1} P(s) / W(s)^k ds`, W nonvanishing on [s0, s1].
pub(crate) fn integrate_rational(
    p: &Polynomial,
    w: &Polynomial,
    k: u32,
    s0: &Q,
    s1: &Q,
) -> R<QBound> {
    pieces(s0, s1, |c, d| {
        let (pc, wc) = (coeffs(p, c), coeffs(w, c));
        let r = safe_radius(&wc).ok_or(Refusal::SplineBudget)?;
        if d * q(4.) > r {
            return Ok(None);
        }
        let m = abs_sum(&pc, 0, &r) / (wc[0].abs() / q(2.)).pow(k as i32);
        let f = mul_trunc(&pc, &power(&inverse(&wc), k));
        let mid = series_integral(&f, d);
        let t = tail(d, &m);
        Ok(Some(QBound { lo: &mid - &t, hi: mid + t }))
    })
}

/// Rational bounds `l <= sqrt(g) <= h` (g > 0), 64 fractional bits.
pub(crate) fn sqrt_bounds(g: &Q) -> (Q, Q) {
    let bits = 64usize;
    let (n, d) = (g.numer().clone(), g.denom().clone());
    let scale = BigInt::one() << (2 * bits);
    let s = (&n * &d * scale).sqrt();
    let den = d * (BigInt::one() << bits);
    (Q::new(s.clone(), den.clone()), Q::new(s + 1, den))
}

/// `integral_{s0}^{s1} sqrt(A(s)) / W(s)^k ds`, A > 0 and W > 0 on [s0, s1].
pub(crate) fn integrate_sqrt(
    a: &Polynomial,
    w: &Polynomial,
    k: u32,
    s0: &Q,
    s1: &Q,
) -> R<QBound> {
    pieces(s0, s1, |c, d| {
        let (ac, wc) = (coeffs(a, c), coeffs(w, c));
        if !ac[0].is_positive() {
            return Err(Refusal::SplineCusp);
        }
        let g0 = ac[0].clone();
        let alpha: Vec<Q> = ac.iter().map(|x| x / &g0).collect();
        let (rho, r) = match (safe_radius_root(&alpha), safe_radius(&wc)) {
            (rho, Some(r)) => (rho, r),
            _ => return Err(Refusal::SplineBudget),
        };
        let radius = rho.min(r);
        if d * q(4.) > radius {
            return Ok(None);
        }
        // |t| <= sqrt(3/2) < 5/4 and |1/W| <= 2/|w0| on |z| = radius.
        let m = q(1.25) * (q(2.) / wc[0].abs()).pow(k as i32);
        let tl = tail(d, &m);
        let (mid_lo, mid_hi) = if wc.len() == 1 {
            let scale = (Q::one() / &wc[0]).pow(k as i32);
            sqrt_series_integral(&ac, &scale, d, &tl)
        } else {
            let f = mul_trunc(&sqrt_series(&ac), &power(&inverse(&wc), k));
            let mid = series_integral(&f, d);
            (mid.clone(), mid)
        };
        let (l, h) = sqrt_bounds(&g0);
        let (a, b) = (&mid_lo - &tl, &mid_hi + &tl);
        let lo = if a.is_negative() { &a * &h } else { &a * &l };
        let hi = if b.is_negative() { &b * &l } else { &b * &h };
        Ok(Some(QBound { lo, hi }))
    })
}

fn gcd(a: &BigInt, b: &BigInt) -> BigInt {
    let (mut a, mut b) = (a.abs(), b.abs());
    while !b.is_zero() {
        let r = &a % &b;
        a = b;
        b = r;
    }
    a
}

/// The series of `t = sqrt(A / A(0))` (`t_0 = 1`, first `K` terms) from the
/// coefficients `a_i` of `A`. Clearing denominators to integers `a'_i = L a_i`
/// (`g = a'_0`) turns the recurrence `t_n = (a_n / a_0 - sum t_i t_{n-i}) / 2`
/// into pure integer arithmetic on `t_n = sigma_n / (g^n 2^(2n-1))`:
/// `sigma_n = a'_n (4 g)^(n-1) - sum_{i=1}^{n-1} sigma_i sigma_{n-i}`. Only one
/// reduction per coefficient remains (instead of one per addition, which
/// dominates the cost once the numerators run to thousands of bits).
fn sqrt_series(a: &[Q]) -> Vec<Q> {
    let (sigma, g) = sqrt_sigma(a);
    let mut t = vec![Q::zero(); K];
    t[0] = Q::one();
    let mut g_pow = BigInt::one();
    for n in 1..K {
        g_pow *= &g;
        t[n] = Q::new(sigma[n].clone(), &g_pow * (BigInt::one() << (2 * n - 1)));
    }
    t
}

/// The integers `sigma_n` (`n >= 1`) and `g` of `sqrt_series`.
fn sqrt_sigma(a: &[Q]) -> (Vec<BigInt>, BigInt) {
    let lcm = a.iter().fold(BigInt::one(), |l, x| {
        let g = gcd(&l, x.denom());
        l / g * x.denom()
    });
    let ints: Vec<BigInt> = a.iter().map(|x| x.numer() * (&lcm / x.denom())).collect();
    let g = ints[0].clone();
    let mut sigma: Vec<BigInt> = vec![BigInt::zero(); K];
    let four_g = &g * BigInt::from(4);
    let mut four_g_pow = BigInt::one(); // (4 g)^(n-1)
    for n in 1..K {
        let mut s = ints.get(n).cloned().unwrap_or_else(BigInt::zero) * &four_g_pow;
        for i in 1..n {
            s -= &sigma[i] * &sigma[n - i];
        }
        four_g_pow *= &four_g;
        sigma[n] = s;
    }
    (sigma, g)
}

/// Dyadic `[lo, hi]` around `series_integral(scale * sqrt_series(a), d)`, on a
/// grid at least `GUARD_BITS` below `tl` (> 0, the tail it is widened by).
/// Same value without a single reduction: with `t_n = sigma_n / (g^n 2^(2n-1))`
/// and `d = p / u`, the even term `t_n d^(n+1) / (n+1)` is
/// `w_n top_n p^(n+1) / ((4 g u)^n u (n+1))` (`top_0 = w_0 = 1`, otherwise
/// `top_n = sigma_n`, `w_n = 2`), so over `D = (4 g u)^N u L` (`N` the last even
/// index, `L` the lcm of the odd `n + 1`) the sum is one integer (Horner in
/// `(4 g u)^2`), rounded outward by a single division.
fn sqrt_series_integral(a: &[Q], scale: &Q, d: &Q, tl: &Q) -> (Q, Q) {
    let (sigma, g) = sqrt_sigma(a);
    let (p, u) = (d.numer(), d.denom());
    let last = (K - 1) / 2 * 2;
    let odd_lcm = (1..=last + 1).step_by(2).fold(BigInt::one(), |l, n| {
        let n = BigInt::from(n as i64);
        let g = gcd(&l, &n);
        l / g * n
    });
    let step = {
        let x = BigInt::from(4) * &g * u;
        &x * &x
    };
    // Term n over D: w_n top_n p^(n+1) (4 g u)^(N - n) L / (n + 1); Horner
    // supplies the powers of (4 g u).
    let mut sum = BigInt::zero();
    let mut p_pow = p.clone(); // p^(n+1)
    let p2 = p * p;
    for n in (0..=last).step_by(2) {
        let weight = &odd_lcm / BigInt::from(n as i64 + 1) * if n == 0 { 1 } else { 2 };
        let top = if n == 0 { BigInt::one() } else { sigma[n].clone() };
        sum = sum * &step + top * &p_pow * weight;
        p_pow *= &p2;
    }
    // series_integral doubles the sum of the terms: 2 scale sum / D.
    let den = BigInt::from(4).pow(last as u32) * g.pow(last as u32) * u.pow(last as u32 + 1) * odd_lcm * scale.denom();
    let num = sum * BigInt::from(2) * scale.numer();
    let log2_tl = tl.numer().bits() as i64 - tl.denom().bits() as i64;
    let e = GUARD_BITS - log2_tl + 1;
    let exact = Q::new_raw(num, den);
    (dyadic(&exact, e, false), dyadic(&exact, e, true))
}

/// Radius (<= 1) on which `sum_{i>=1} |alpha_i| r^i <= 1/2` (alpha_0 = 1).
fn safe_radius_root(alpha: &[Q]) -> Q {
    radius_where_rest_is_small(alpha)
}

/// Exact `integral_{s0}^{s1}` of a polynomial.
pub(crate) fn integrate_poly(p: &Polynomial, s0: &Q, s1: &Q) -> Q {
    let anti: Vec<Q> = std::iter::once(Q::zero())
        .chain(
            p.coefficients()
                .iter()
                .enumerate()
                .map(|(i, a)| a / Q::from_integer(BigInt::from(i as i64 + 1))),
        )
        .collect();
    super::horner(&anti, s1) - super::horner(&anti, s0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(n: i64, d: i64) -> Q {
        Q::new(BigInt::from(n), BigInt::from(d))
    }

    #[test]
    fn integer_sqrt_series_integral_encloses_the_rational_route() {
        // Squared-speed coefficients about a piece midpoint (A(0) > 0), weight
        // scales and half-widths with odd and dyadic denominators.
        let cases = [
            (vec![r(5, 1), r(-2, 3), r(7, 5), r(1, 9), r(3, 7)], r(1, 1), r(1, 64)),
            (vec![r(1_000_003, 1024), r(-17, 2048), r(9, 7), r(0, 1), r(1, 3)], r(4, 9), r(3, 1000)),
            (vec![Q::from_float(0.1234567890123).unwrap(), Q::from_float(-1.0e-3).unwrap(), Q::from_float(2.5e-7).unwrap()], r(1, 1), r(1, 7)),
        ];
        for (a, scale, d) in cases {
            let exact = series_integral(&sqrt_series(&a).iter().map(|x| x * &scale).collect::<Vec<_>>(), &d);
            let tl = tail(&d, &q(1.25));
            let (lo, hi) = sqrt_series_integral(&a, &scale, &d, &tl);
            assert!(lo <= exact && exact <= hi, "{lo} <= {exact} <= {hi}");
            assert!((&hi - &lo) * Q::from_integer(BigInt::one() << 62u32) <= tl, "grid not below the tail");
        }
    }
}

#[cfg(test)]
mod radius_tests {
    use super::*;

    #[test]
    fn integer_radius_test_matches_the_rational_sums() {
        // The rational search the integer inequality replaced.
        fn reference(c: &[Q]) -> Q {
            let limit = c[0].abs() / q(2.);
            let mut r = Q::one();
            loop {
                if abs_sum(c, 1, &r) <= limit {
                    return r;
                }
                let three_quarters = &r * Q::new(BigInt::from(3), BigInt::from(4));
                if abs_sum(c, 1, &three_quarters) <= limit {
                    return three_quarters;
                }
                r /= q(2.);
            }
        }
        let r = |n: i64, d: i64| Q::new(BigInt::from(n), BigInt::from(d));
        let cases = [
            vec![r(1, 1)],
            vec![r(5, 1), r(-2, 3), r(7, 5), r(1, 9), r(3, 7)],
            vec![r(-1, 1024), r(3, 1), r(0, 1), r(-5, 2)],
            vec![r(2, 1), r(-1, 1), r(1, 2)],
            vec![Q::from_float(0.1234567890123).unwrap(), Q::from_float(-1.0e-3).unwrap(), Q::from_float(2.5e-7).unwrap(), Q::from_float(-3.0e4).unwrap()],
        ];
        for c in cases {
            assert_eq!(radius_where_rest_is_small(&c), reference(&c), "{c:?}");
        }
    }
}
