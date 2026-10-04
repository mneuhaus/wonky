//! Exact change of basis between the power basis and the degree-n Bernstein basis
//! `B(n, k)(t) = C(n, k) t^k (1 - t)^(n - k)` on [0, 1]. Bézier span coordinates are
//! Bernstein coefficients; substitution into implicit carriers needs power form.
//! Other intervals are reached by composing with an affine map first.
use crate::{checked_rational, AlgebraError, BigInt, Polynomial, Rational};
use num_traits::{One, Zero};

impl Polynomial {
    /// `sum_k b[k] * C(n, k) t^k (1 - t)^(n - k)` with `n = b.len() - 1`, i.e.
    /// `a[j] = C(n, j) * sum_{k <= j} (-1)^(j - k) C(j, k) b[k]`.
    pub fn from_bernstein(coefficients: &[Rational]) -> Result<Self, AlgebraError> {
        if coefficients.is_empty() {
            return Err(AlgebraError::EmptyBernstein);
        }
        let b = coefficients
            .iter()
            .map(checked_rational)
            .collect::<Result<Vec<_>, _>>()?;
        let n = b.len() - 1;
        let binomial = pascal(n);
        let power = (0..=n)
            .map(|j| {
                let alternating = (0..=j).fold(Rational::zero(), |sum, k| {
                    let term = &b[k] * Rational::from_integer(binomial[j][k].clone());
                    if (j - k) % 2 == 0 {
                        sum + term
                    } else {
                        sum - term
                    }
                });
                alternating * Rational::from_integer(binomial[n][j].clone())
            })
            .collect();
        Polynomial::new(power)
    }

    /// Degree-`degree` Bernstein coefficients on [0, 1]:
    /// `b[k] = sum_{j <= k} C(k, j) / C(degree, j) * a[j]`. Refuses a degree below the
    /// polynomial's own; the zero polynomial has `degree + 1` zero coefficients.
    pub fn to_bernstein(&self, degree: usize) -> Result<Vec<Rational>, AlgebraError> {
        let own = self.degree().unwrap_or(0);
        if own > degree {
            return Err(AlgebraError::DegreeTooLow {
                degree,
                required: own,
            });
        }
        if self.is_zero() {
            return Ok(vec![Rational::zero(); degree + 1]);
        }
        let binomial = pascal(degree);
        // Clear coefficient and binomial denominators once. The defining
        // change of basis is then an integer matrix product, with one rational
        // reduction per output instead of one gcd per summand. High-degree
        // import certificates otherwise spend minutes in repeated gcds.
        let coefficient_denominator = self
            .coefficients()
            .iter()
            .fold(BigInt::one(), |d, a| positive_lcm(d, a.denom()));
        let binomial_denominator = binomial[degree]
            .iter()
            .take(self.coefficients().len())
            .fold(BigInt::one(), positive_lcm);
        let denominator = &coefficient_denominator * &binomial_denominator;
        let weighted = self
            .coefficients()
            .iter()
            .enumerate()
            .map(|(j, a)| {
                a.numer()
                    * (&coefficient_denominator / a.denom())
                    * (&binomial_denominator / &binomial[degree][j])
            })
            .collect::<Vec<_>>();
        Ok((0..=degree)
            .map(|k| {
                let numerator = weighted
                    .iter()
                    .take(k + 1)
                    .enumerate()
                    .fold(BigInt::zero(), |sum, (j, a)| sum + a * &binomial[k][j]);
                Rational::new(numerator, denominator.clone())
            })
            .collect())
    }
}

fn positive_lcm(a: BigInt, b: &BigInt) -> BigInt {
    // For positive integers, numerator(reduce(a/b)) * b = lcm(a,b).
    // Reuse the rational crate's exact gcd without a new dependency.
    Rational::new(a, b.clone()).numer() * b
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn integer_batch_matches_defining_bernstein_formula_with_mixed_denominators() {
        for own in [0, 3, 7, 31] {
            let coefficients = (0..=own)
                .map(|j| {
                    let numerator = (BigInt::one() << (128 + j)) + BigInt::from(j + 1);
                    let denominator = BigInt::from([2, 3, 5][j % 3]).pow((16 + j) as u32);
                    Rational::new(if j % 2 == 0 { numerator } else { -numerator }, denominator)
                })
                .collect::<Vec<_>>();
            let p = Polynomial::new(coefficients).unwrap();
            for degree in [own, own + 7, 64] {
                let binomial = pascal(degree);
                let expected = (0..=degree)
                    .map(|k| {
                        p.coefficients().iter().take(k + 1).enumerate().fold(
                            Rational::zero(),
                            |sum, (j, a)| {
                                sum + a * Rational::new(
                                    binomial[k][j].clone(),
                                    binomial[degree][j].clone(),
                                )
                            },
                        )
                    })
                    .collect::<Vec<_>>();
                assert_eq!(p.to_bernstein(degree).unwrap(), expected);
                assert_eq!(Polynomial::from_bernstein(&expected).unwrap(), p);
            }
        }
        assert_eq!(
            Polynomial::zero().to_bernstein(64).unwrap(),
            vec![Rational::zero(); 65]
        );
        let cubic = Polynomial::new(vec![
            Rational::zero(),
            Rational::zero(),
            Rational::zero(),
            Rational::one(),
        ])
        .unwrap();
        assert!(matches!(
            cubic.to_bernstein(2),
            Err(AlgebraError::DegreeTooLow {
                degree: 2,
                required: 3
            })
        ));
    }
}

/// Rows 0..=n of Pascal's triangle.
fn pascal(n: usize) -> Vec<Vec<BigInt>> {
    let mut rows = vec![vec![BigInt::one()]];
    while rows.len() <= n {
        let previous = &rows[rows.len() - 1];
        let mut row = vec![BigInt::one()];
        row.extend(previous.windows(2).map(|pair| &pair[0] + &pair[1]));
        row.push(BigInt::one());
        rows.push(row);
    }
    rows
}
