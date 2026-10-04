use crate::{checked_rational, AlgebraError, BigInt, Rational, Sign};
use num_traits::{One, Signed, Zero};

/// Canonical rational polynomial. The zero polynomial has no coefficients and no degree.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Polynomial {
    coefficients: Vec<Rational>,
}

/// `original = unit * product(factor.polynomial ^ factor.multiplicity)`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SquareFreeDecomposition {
    pub unit: Rational,
    /// Monic, pairwise coprime square-free factors, in increasing multiplicity order.
    pub factors: Vec<SquareFreeFactor>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SquareFreeFactor {
    pub polynomial: Polynomial,
    pub multiplicity: usize,
}

/// `original = (x - root)^multiplicity * quotient` with `quotient(root) != 0`.
/// Multiplicity 0 means `root` is not a root and `quotient` is the original.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Deflation {
    pub quotient: Polynomial,
    pub multiplicity: usize,
}

impl Polynomial {
    /// Coefficients in ascending power order; raw rationals are checked and normalized.
    pub fn new(coefficients: Vec<Rational>) -> Result<Self, AlgebraError> {
        Ok(Self::canonical(
            coefficients
                .iter()
                .map(checked_rational)
                .collect::<Result<_, _>>()?,
        ))
    }

    pub fn from_integers(coefficients: &[i64]) -> Self {
        Self::from_bigints(coefficients.iter().copied().map(BigInt::from).collect())
    }

    pub fn from_bigints(coefficients: Vec<BigInt>) -> Self {
        Self::canonical(
            coefficients
                .into_iter()
                .map(Rational::from_integer)
                .collect(),
        )
    }

    pub fn zero() -> Self {
        Self::canonical(Vec::new())
    }

    pub fn one() -> Self {
        Self::canonical(vec![Rational::one()])
    }

    fn canonical(mut coefficients: Vec<Rational>) -> Self {
        while coefficients.last().is_some_and(Zero::is_zero) {
            coefficients.pop();
        }
        Self { coefficients }
    }

    pub fn coefficients(&self) -> &[Rational] {
        &self.coefficients
    }

    pub fn degree(&self) -> Option<usize> {
        self.coefficients.len().checked_sub(1)
    }

    pub fn is_zero(&self) -> bool {
        self.coefficients.is_empty()
    }

    pub fn is_one(&self) -> bool {
        self.coefficients.len() == 1 && self.coefficients[0].is_one()
    }

    pub fn leading_coefficient(&self) -> Option<&Rational> {
        self.coefficients.last()
    }

    pub fn evaluate(&self, x: &Rational) -> Result<Rational, AlgebraError> {
        Ok(self.eval(&checked_rational(x)?))
    }

    pub(crate) fn eval(&self, x: &Rational) -> Rational {
        self.coefficients
            .iter()
            .rev()
            .fold(Rational::zero(), |acc, c| acc * x + c)
    }

    /// Exact sign of the value at `x`, without reducing a single rational: with
    /// the coefficients cleared to integers `c_i` by the (positive) lcm of their
    /// denominators and `x = a / b` (`b > 0`), the value has the sign of the
    /// integer `sum c_i a^i b^(n-i)`. Sign tests (bisection, Sturm counts) need
    /// nothing else, and the reduced Horner pays a gcd per step that grows with
    /// the bits of `x`.
    pub(crate) fn sign_at(&self, x: &Rational) -> Sign {
        let Some((last, rest)) = self.coefficients.split_last() else {
            return Sign::Zero;
        };
        let lcm = self.coefficients.iter().fold(BigInt::one(), |l, c| {
            let shared = Rational::new(l.clone(), c.denom().clone());
            l * shared.denom()
        });
        let int = |c: &Rational| c.numer() * (&lcm / c.denom());
        let (a, b) = if x.denom().is_negative() { (-x.numer(), -x.denom()) } else { (x.numer().clone(), x.denom().clone()) };
        let mut value = int(last);
        let mut b_pow = b.clone();
        for c in rest.iter().rev() {
            value = value * &a + int(c) * &b_pow;
            b_pow *= &b;
        }
        crate::sign(&Rational::from_integer(value))
    }

    pub fn derivative(&self) -> Self {
        Self::canonical(
            self.coefficients
                .iter()
                .enumerate()
                .skip(1)
                .map(|(i, c)| c * Rational::from_integer(BigInt::from(i)))
                .collect(),
        )
    }

    pub fn add(&self, other: &Self) -> Self {
        let mut coefficients = self.coefficients.clone();
        coefficients.resize(
            coefficients.len().max(other.coefficients.len()),
            Rational::zero(),
        );
        for (c, d) in coefficients.iter_mut().zip(&other.coefficients) {
            *c += d;
        }
        Self::canonical(coefficients)
    }

    pub fn neg(&self) -> Self {
        Self::canonical(self.coefficients.iter().map(|c| -c).collect())
    }

    pub fn sub(&self, other: &Self) -> Self {
        self.add(&other.neg())
    }

    pub fn mul(&self, other: &Self) -> Self {
        if self.is_zero() || other.is_zero() {
            return Self::zero();
        }
        let mut coefficients =
            vec![Rational::zero(); self.coefficients.len() + other.coefficients.len() - 1];
        for (i, a) in self.coefficients.iter().enumerate() {
            for (j, b) in other.coefficients.iter().enumerate() {
                coefficients[i + j] += a * b;
            }
        }
        Self::canonical(coefficients)
    }

    pub fn scale(&self, factor: &Rational) -> Result<Self, AlgebraError> {
        let factor = checked_rational(factor)?;
        Ok(self.scaled(&factor))
    }

    pub(crate) fn scaled(&self, factor: &Rational) -> Self {
        Self::canonical(self.coefficients.iter().map(|c| c * factor).collect())
    }

    /// Zero remains zero. Other polynomials become monic.
    pub fn monic(&self) -> Self {
        match self.leading_coefficient() {
            Some(lead) => self.scaled(&lead.recip()),
            None => Self::zero(),
        }
    }

    /// Euclidean division over Q; remainder degree is strictly below divisor degree.
    pub fn div_rem(&self, divisor: &Self) -> Result<(Self, Self), AlgebraError> {
        let divisor_degree = divisor
            .degree()
            .ok_or(AlgebraError::DivisionByZeroPolynomial)?;
        let Some(degree) = self.degree() else {
            return Ok((Self::zero(), Self::zero()));
        };
        if degree < divisor_degree {
            return Ok((Self::zero(), self.clone()));
        }
        let mut quotient = vec![Rational::zero(); degree - divisor_degree + 1];
        let mut remainder = self.clone();
        while let Some(rd) = remainder.degree() {
            if rd < divisor_degree {
                break;
            }
            let shift = rd - divisor_degree;
            let coefficient = &remainder.coefficients[rd] / &divisor.coefficients[divisor_degree];
            quotient[shift] = coefficient.clone();
            for (i, c) in divisor.coefficients.iter().enumerate() {
                remainder.coefficients[i + shift] -= &coefficient * c;
            }
            remainder = Self::canonical(remainder.coefficients);
        }
        Ok((Self::canonical(quotient), remainder))
    }

    /// `self(inner(x))`, exact (Horner over polynomials); degree `deg self * deg inner`.
    pub fn compose(&self, inner: &Self) -> Self {
        self.coefficients.iter().rev().fold(Self::zero(), |acc, c| {
            acc.mul(inner).add(&Self::canonical(vec![c.clone()]))
        })
    }

    /// Divide out the full power of `(x - root)`, e.g. a shared rational vertex of
    /// two carriers. The zero polynomial is refused: every point is a root of it.
    pub fn deflate(&self, root: &Rational) -> Result<Deflation, AlgebraError> {
        let root = checked_rational(root)?;
        if self.is_zero() {
            return Err(AlgebraError::ZeroPolynomial);
        }
        let mut quotient = self.clone();
        let mut multiplicity = 0;
        loop {
            let (next, remainder) = quotient.divide_by_linear(&root);
            if !remainder.is_zero() {
                return Ok(Deflation {
                    quotient,
                    multiplicity,
                });
            }
            quotient = next;
            multiplicity += 1;
        }
    }

    /// Synthetic division of a nonzero polynomial by `(x - root)`: (quotient, remainder).
    fn divide_by_linear(&self, root: &Rational) -> (Self, Rational) {
        let mut carry = Rational::zero();
        let mut quotient = vec![Rational::zero(); self.coefficients.len() - 1];
        for k in (1..self.coefficients.len()).rev() {
            carry = &self.coefficients[k] + root * &carry;
            quotient[k - 1] = carry.clone();
        }
        let remainder = &self.coefficients[0] + root * &carry;
        (Self::canonical(quotient), remainder)
    }

    pub fn exact_div(&self, divisor: &Self) -> Result<Self, AlgebraError> {
        let (quotient, remainder) = self.div_rem(divisor)?;
        if !remainder.is_zero() {
            return Err(AlgebraError::NonExactDivision);
        }
        Ok(quotient)
    }

    /// Monic gcd, with gcd(0, 0) = 0.
    pub fn gcd(&self, other: &Self) -> Self {
        let (mut a, mut b) = (self.clone(), other.clone());
        while !b.is_zero() {
            // b is nonzero by the loop invariant.
            let r = a.div_rem(&b).expect("nonzero gcd divisor").1;
            a = b;
            b = r.monic();
        }
        a.monic()
    }

    /// Yun's characteristic-zero square-free decomposition over Q.
    pub fn square_free_decomposition(&self) -> Result<SquareFreeDecomposition, AlgebraError> {
        let unit = self
            .leading_coefficient()
            .ok_or(AlgebraError::ZeroPolynomial)?
            .clone();
        let f = self.monic();
        let mut repeated = f.gcd(&f.derivative());
        let mut remaining = f.exact_div(&repeated)?;
        let mut multiplicity = 1;
        let mut factors = Vec::new();
        while !remaining.is_one() {
            let shared = remaining.gcd(&repeated);
            let factor = remaining.exact_div(&shared)?;
            if !factor.is_one() {
                factors.push(SquareFreeFactor {
                    polynomial: factor,
                    multiplicity,
                });
            }
            remaining = shared;
            repeated = repeated.exact_div(&remaining)?;
            multiplicity += 1;
        }
        Ok(SquareFreeDecomposition { unit, factors })
    }

    pub fn square_free_part(&self) -> Result<Self, AlgebraError> {
        if self.is_zero() {
            return Err(AlgebraError::ZeroPolynomial);
        }
        self.exact_div(&self.gcd(&self.derivative()))
            .map(|p| p.monic())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(n: i64, d: i64) -> Rational {
        Rational::new(BigInt::from(n), BigInt::from(d))
    }

    #[test]
    fn integer_sign_matches_the_rational_value() {
        let polys = [
            Polynomial::new(vec![]).unwrap(),
            Polynomial::new(vec![r(-3, 7)]).unwrap(),
            Polynomial::new(vec![r(1, 3), r(-5, 2), r(0, 1), r(7, 11)]).unwrap(),
            // (x - 2/3)^2 (x + 5/4): a double root and a simple one.
            Polynomial::new(vec![r(5, 9), r(-11, 9), r(-1, 12), r(1, 1)]).unwrap(),
            Polynomial::new(vec![r(1, 1), r(0, 1), r(-2, 1)]).unwrap(),
        ];
        let big = Rational::new(BigInt::from(3) << 200u32, (BigInt::from(1) << 201u32) + 1);
        let points = [r(0, 1), r(2, 3), r(-5, 4), r(-1, 1), r(7, 5), r(-99, 7), big.clone(), -big];
        for p in &polys {
            for x in &points {
                assert_eq!(p.sign_at(x), crate::sign(&p.eval(x)), "{p:?} at {x}");
            }
        }
        assert_eq!(polys[3].sign_at(&r(2, 3)), Sign::Zero);
        assert_eq!(polys[3].sign_at(&r(-5, 4)), Sign::Zero);
    }
}
