//! Exact degree elevation. The elevated knot vector raises every distinct knot
//! multiplicity by one, which keeps the continuity class, so the elevated
//! homogeneous poles are the unique spline-space element that interpolates the
//! original curve at the Greville abscissae (Schoenberg-Whitney): solved by
//! exact rational elimination.
use super::{basis, BSpline, MAX_DEGREE};
use crate::numeric::Q;
use crate::refusal::{Refusal, R};
use num_traits::{One, Signed, Zero};
use wonky_alg::BigInt;

impl BSpline {
    /// The same curve as a spline of degree + 1. Refuses `SplineInvalid` past
    /// degree 7 or when the result would need a non-positive weight.
    pub fn elevated(&self) -> R<Self> {
        let p = self.degree() + 1;
        if p > MAX_DEGREE {
            return Err(Refusal::SplineInvalid);
        }
        let mut knots: Vec<Q> = vec![];
        for (k, m) in self.distinct_knots() {
            knots.extend(std::iter::repeat_n(k, m + 1));
        }
        let n = knots.len() - p - 1;
        let pf = Q::from_integer(BigInt::from(p as i64));
        let hom = self.hom();
        let mut rows: Vec<Vec<Q>> = vec![];
        for i in 0..n {
            let g = knots[i + 1..=i + p].iter().fold(Q::zero(), |a, k| a + k) / &pf;
            let mut row = basis(&knots, p, &g, true);
            let old = basis(self.knots(), self.degree(), &g, true);
            for c in 0..3 {
                row.push(old.iter().zip(&hom).fold(Q::zero(), |a, (w, h)| a + w * &h[c]));
            }
            rows.push(row);
        }
        for col in 0..n {
            let pivot = (col..n).find(|&r| !rows[r][col].is_zero()).ok_or(Refusal::SplineInvalid)?;
            rows.swap(col, pivot);
            let inv = Q::one() / rows[col][col].clone();
            for x in rows[col].iter_mut() {
                *x *= &inv;
            }
            let pivot_row = rows[col].clone();
            for (r, row) in rows.iter_mut().enumerate() {
                if r != col && !row[col].is_zero() {
                    let f = row[col].clone();
                    for (x, y) in row.iter_mut().zip(&pivot_row) {
                        *x -= &f * y;
                    }
                }
            }
        }
        let w: Vec<Q> = rows.iter().map(|r| r[n + 2].clone()).collect();
        if w.iter().any(|x| !x.is_positive()) {
            return Err(Refusal::SplineInvalid);
        }
        let poles = rows.iter().zip(&w).map(|(r, w)| [&r[n] / w, &r[n + 1] / w]).collect();
        Self::new(p, knots, poles, self.is_rational().then_some(w))
    }
}
