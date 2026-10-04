//! Exact real-root handling shared by the spline measures: roots of a
//! polynomial strictly inside a parameter interval, rationalized when they are
//! rational (isolation intervals never hit a non-dyadic rational exactly), and
//! rigorous ranges of a rational function over a small parameter interval by
//! the convex-hull property of Bezier control ratios.
use super::{alg, peval, poly};
use crate::numeric::{q, Q};
use crate::refusal::{Refusal, R};
use num_traits::{One, Signed, Zero};
use wonky_alg::{isolate_real_roots, AlgebraicReal, BigInt, Limits, Polynomial, RationalInterval, SturmSequence};

use super::quad::QBound;

/// A real root of a rational polynomial.
pub(crate) enum Root {
    Rat(Q),
    Irr(AlgebraicReal),
}

/// The rational with the smallest denominator in `[lo, hi]` (`lo <= hi`).
pub(crate) fn simplest_between(lo: &Q, hi: &Q) -> Q {
    // The continued fraction on integer pairs: lo = a / b, hi = c / d (b, d > 0).
    // Each level takes f = floor(lo) and recurses on 1 / (hi - f) = d / (c - f d)
    // and 1 / (lo - f) = b / (a - f b), so no rational is reduced until the
    // value is rebuilt from its partial quotients.
    let (mut a, mut b) = (lo.numer().clone(), lo.denom().clone());
    let (mut c, mut d) = (hi.numer().clone(), hi.denom().clone());
    let mut quotients = vec![];
    let last = loop {
        let f = Q::new_raw(a.clone(), b.clone()).floor().to_integer();
        let rest = &a - &f * &b;
        if rest.is_zero() {
            break f;
        }
        let next = &f + BigInt::one();
        if &next * &d <= c {
            break next;
        }
        quotients.push(f.clone());
        let hi_rest = &c - &f * &d;
        (a, b, c, d) = (d, hi_rest, b, rest);
    };
    // f + 1 / (p / q) = (f p + q) / p; every inner value is > 1, so p > 0.
    let (p, q) = quotients.into_iter().rev().fold((last, BigInt::one()), |(p, q), f| (&f * &p + q, p));
    Q::new(p, q)
}

/// Width to which irrational roots are refined for value enclosures: 2^-120.
pub(crate) fn tight() -> Q {
    Q::new(BigInt::one(), BigInt::one() << 120)
}

/// Roots of `g` strictly inside `(s0, s1)`. The zero polynomial has none here
/// (callers treat it separately). Irrational roots come back with an isolation
/// interval strictly inside `(s0, s1)`.
pub(crate) fn roots_open(g: &Polynomial, s0: &Q, s1: &Q) -> R<Vec<Root>> {
    if g.degree().unwrap_or(0) == 0 || s0 >= s1 {
        return Ok(vec![]);
    }
    let sturm = SturmSequence::new(g).map_err(alg)?;
    let span = RationalInterval::new(s0.clone(), s1.clone()).map_err(alg)?;
    if sturm.count_open(&span) == 0 {
        return Ok(vec![]);
    }
    let mut out = vec![];
    for mut r in isolate_real_roots(g, Limits::default()).map_err(alg)? {
        let (mut lo, mut hi) = (r.interval().lower().clone(), r.interval().upper().clone());
        if lo == hi {
            if s0 < &lo && &lo < s1 {
                out.push(Root::Rat(lo));
            }
            continue;
        }
        // Endpoints of the parameter range that are exact roots are excluded.
        if (peval(g, s0).is_zero() && &lo <= s0 && s0 <= &hi)
            || (peval(g, s1).is_zero() && &lo <= s1 && s1 <= &hi)
        {
            continue;
        }
        r.refine(&tight(), Limits::default()).map_err(alg)?;
        lo = r.interval().lower().clone();
        hi = r.interval().upper().clone();
        let cand = simplest_between(&lo, &hi);
        if peval(g, &cand).is_zero() {
            if s0 < &cand && &cand < s1 {
                out.push(Root::Rat(cand));
            }
            continue;
        }
        // The root is irrational: it is not s0 or s1, so refine until decided.
        let mut guard = 0;
        while (&lo <= s0 && s0 <= &hi) || (&lo <= s1 && s1 <= &hi) {
            r.refine(&((&hi - &lo) / q(2.)), Limits::default()).map_err(alg)?;
            lo = r.interval().lower().clone();
            hi = r.interval().upper().clone();
            guard += 1;
            if guard > 256 {
                return Err(Refusal::SplineBudget);
            }
        }
        if s0 < &lo && &hi < s1 {
            out.push(Root::Irr(r));
        }
    }
    Ok(out)
}

/// Range of `num(s) / den(s)` over `s` in `[lo, hi]`, where `den` stays positive.
/// The Bernstein coefficients of both over the subinterval bound the ratio by
/// the convex-hull property of a rational Bezier curve. Refuses `SplineBudget`
/// when a Bernstein weight is not positive (the interval is too wide).
pub(crate) fn ratio_range(num: &Polynomial, den: &Polynomial, lo: &Q, hi: &Q) -> R<QBound> {
    let map = poly(vec![lo.clone(), hi - lo]);
    let (n, d) = (num.compose(&map), den.compose(&map));
    let deg = n.degree().unwrap_or(0).max(d.degree().unwrap_or(0));
    let (nb, db) = (n.to_bernstein(deg).map_err(alg)?, d.to_bernstein(deg).map_err(alg)?);
    let mut range: Option<QBound> = None;
    for (a, b) in nb.iter().zip(&db) {
        if !b.is_positive() {
            return Err(Refusal::SplineBudget);
        }
        let v = a / b;
        range = Some(match range {
            None => QBound { lo: v.clone(), hi: v },
            Some(r) => QBound { lo: r.lo.min(v.clone()), hi: r.hi.max(v) },
        });
    }
    range.ok_or(Refusal::SplineBudget)
}

/// The value bound of `num / den` at a root.
pub(crate) fn value_at(root: &Root, num: &Polynomial, den: &Polynomial) -> R<QBound> {
    match root {
        Root::Rat(r) => Ok(QBound::exact(peval(num, r) / peval(den, r))),
        Root::Irr(a) => ratio_range(num, den, a.interval().lower(), a.interval().upper()),
    }
}

/// A representative rational parameter of the root (exact for rational roots).
pub(crate) fn rational_of(root: &Root) -> Option<Q> {
    match root {
        Root::Rat(r) => Some(r.clone()),
        Root::Irr(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The rational recursion `simplest_between` replaced.
    fn reference(lo: &Q, hi: &Q) -> Q {
        let f = lo.floor();
        if &f == lo {
            return f;
        }
        if &f + Q::one() <= *hi {
            return f + Q::one();
        }
        let inner = reference(&(Q::one() / (hi - &f)), &(Q::one() / (lo - &f)));
        f + Q::one() / inner
    }

    #[test]
    fn integer_simplest_between_matches_the_rational_recursion() {
        let r = |n: i64, d: i64| Q::new(BigInt::from(n), BigInt::from(d));
        let sqrt2_lo = Q::new(BigInt::from(6369051672525773_i64), BigInt::one() << 52u32);
        let tiny = Q::new(BigInt::one(), BigInt::one() << 120u32);
        let cases = [
            (r(1, 3), r(1, 2)),
            (r(-7, 5), r(-4, 3)),
            (r(355, 113), r(22, 7)),
            (r(3, 1), r(7, 2)),
            (r(-1, 1000), r(1, 1000)),
            (sqrt2_lo.clone(), &sqrt2_lo + &tiny),
            (-(&sqrt2_lo + &tiny), -sqrt2_lo),
        ];
        for (lo, hi) in cases {
            let s = simplest_between(&lo, &hi);
            assert_eq!(s, reference(&lo, &hi), "[{lo}, {hi}]");
            assert!(lo <= s && s <= hi);
        }
    }
}
